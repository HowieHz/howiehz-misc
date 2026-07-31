import {
  createGraphwarTypescriptWorkerBackendConfiguration,
  graphwarBackendAttemptIdentitiesAreEqual,
  type GraphwarBackendAttemptIdentity,
  type GraphwarWorkerBackendConfiguration,
  type GraphwarWorkerBackendSelection,
} from "./algorithm-backend";
import { createGraphwarBackendAttemptGate } from "./backend-attempt";

/** 用户取消 outer task；backend attempt revoke 使用 replacement，不使用本错误结算公开 Promise。 */
export class GraphwarAuthoritativeTaskCancelledError extends Error {
  constructor() {
    super("Graphwar authoritative task cancelled");
    this.name = "GraphwarAuthoritativeTaskCancelledError";
  }
}

/** 单次 backend attempt 的执行上下文；所有事件发布都必须经过 `publish`。 */
export interface GraphwarAuthoritativeAttemptContext<TSnapshot, TEvent> {
  readonly attempt: GraphwarBackendAttemptIdentity;
  readonly backendConfiguration: GraphwarWorkerBackendConfiguration;
  readonly publish: (event: TEvent) => boolean;
  readonly snapshot: TSnapshot;
}

/** Workflow 返回的 attempt 句柄；coordinator 用 cancel 先撤销 Worker 与排队副作用。 */
export interface GraphwarAuthoritativeAttemptExecution<TResult> {
  cancel: () => void;
  result: Promise<TResult>;
}

interface GraphwarAuthoritativeTaskCoordinatorOptions<TInput, TSnapshot, TResult, TEvent> {
  /** 在第一次 backend selection await 前固定 caller-owned 输入。 */
  cloneInput: (input: TInput) => TSnapshot;
  /** 每个 attempt 从 coordinator 私有 master snapshot 派生独占副本，允许安全 transfer。 */
  cloneSnapshotForAttempt: (snapshot: TSnapshot) => TSnapshot;
  /** 为当前 replacement attempt 启动一次完整 backend 执行。 */
  executeAttempt: (
    context: GraphwarAuthoritativeAttemptContext<TSnapshot, TEvent>,
  ) => GraphwarAuthoritativeAttemptExecution<TResult>;
}

/** Workflow commit can cross paint boundaries while every actual side effect remains identity-gated. */
export interface GraphwarAuthoritativeResultCommitContext {
  readonly attempt: GraphwarBackendAttemptIdentity;
  readonly commit: (publish: () => void) => boolean;
}

interface GraphwarAuthoritativeTaskOptions<TResult, TEvent> {
  commitResult?: (result: TResult, context: GraphwarAuthoritativeResultCommitContext) => Promise<void> | void;
  onEvent?: (event: TEvent) => void;
}

interface ActiveAuthoritativeTask<TSnapshot, TResult, TEvent> {
  attempt: GraphwarBackendAttemptIdentity;
  cancelAttempt: (() => void) | undefined;
  commitResult:
    | ((result: TResult, context: GraphwarAuthoritativeResultCommitContext) => Promise<void> | void)
    | undefined;
  isSettled: boolean;
  onEvent: ((event: TEvent) => void) | undefined;
  reject: (reason?: unknown) => void;
  resolve: (result: TResult) => void;
  snapshot: TSnapshot;
}

/** 公开任务句柄保留同一 Promise；只有显式用户取消才终止 outer task。 */
export interface GraphwarAuthoritativeTask<TResult> {
  cancel: (reason?: unknown) => boolean;
  fail: (reason: unknown) => boolean;
  getAttempt: () => GraphwarBackendAttemptIdentity | undefined;
  promise: Promise<TResult>;
}

/**
 * 协调稳定 outer task、可替换 backend attempt、generation CAS 与 single-settle。
 *
 * 该层不解释 detection/pathfinding 等业务结果，也不拥有 Worker 池；workflow 只提供输入复制和单次 attempt 执行，因而所有调用面共享同一套换代顺序与 commit gate。
 */
export function createGraphwarAuthoritativeTaskCoordinator<TInput, TSnapshot, TResult, TEvent>(
  options: GraphwarAuthoritativeTaskCoordinatorOptions<TInput, TSnapshot, TResult, TEvent>,
) {
  const attemptGate = createGraphwarBackendAttemptGate();
  const activeTasks = new Map<number, ActiveAuthoritativeTask<TSnapshot, TResult, TEvent>>();

  /** 在公开入口同步固定 snapshot/outer identity，再异步等待这一次选择的 backend。 */
  function beginTask(
    input: TInput,
    backendSelection: GraphwarWorkerBackendSelection,
    taskOptions: GraphwarAuthoritativeTaskOptions<TResult, TEvent> = {},
  ): GraphwarAuthoritativeTask<TResult> {
    const snapshot = options.cloneInput(input);
    const attempt = attemptGate.beginOuterTask(backendSelection.generation);
    let rejectTask: (reason?: unknown) => void = () => undefined;
    let resolveTask: (result: TResult) => void = () => undefined;
    const promise = new Promise<TResult>((resolve, reject) => {
      rejectTask = reject;
      resolveTask = resolve;
    });
    const activeTask: ActiveAuthoritativeTask<TSnapshot, TResult, TEvent> = {
      attempt,
      cancelAttempt: undefined,
      commitResult: taskOptions.commitResult,
      isSettled: false,
      onEvent: taskOptions.onEvent,
      reject: rejectTask,
      resolve: resolveTask,
      snapshot,
    };
    activeTasks.set(attempt.outerTaskId, activeTask);
    void backendSelection.promise.then(
      (configuration) => startSelectedBackend(activeTask, attempt, configuration),
      (error) => failTaskIfCurrent(activeTask, attempt, error),
    );

    return {
      cancel: (reason = new GraphwarAuthoritativeTaskCancelledError()) => cancelTask(activeTask, reason),
      fail: (reason) => failTask(activeTask, reason),
      getAttempt: () => (activeTask.isSettled ? undefined : copyAttemptIdentity(activeTask.attempt)),
      promise,
    };
  }

  /** 同 generation 首个 fault 胜出：先撤销全部旧执行和 event lease，再替换 identity，最后启动 TS cold attempts。 */
  function replayGenerationAsTypescript(
    failedGeneration: number,
    replacementGeneration: number,
    fallbackReason?: string,
  ) {
    assertNewerGeneration(failedGeneration, replacementGeneration);
    if (!attemptGate.revokeGeneration(failedGeneration)) {
      return false;
    }
    const replayTasks = [...activeTasks.values()].filter(
      (task) => !task.isSettled && task.attempt.backendGeneration === failedGeneration,
    );
    for (const task of replayTasks) {
      cancelAttemptSafely(task);
    }

    const replacements: ActiveAuthoritativeTask<TSnapshot, TResult, TEvent>[] = [];
    for (const task of replayTasks) {
      if (task.isSettled || activeTasks.get(task.attempt.outerTaskId) !== task) {
        continue;
      }
      task.attempt = attemptGate.replaceAttempt(task.attempt, replacementGeneration);
      replacements.push(task);
    }
    const configuration = createGraphwarTypescriptWorkerBackendConfiguration(replacementGeneration, fallbackReason);
    for (const task of replacements) {
      startAttempt(task, configuration);
    }
    return true;
  }

  /** Loading-off 可返回新 generation 的 TS 配置；只替换 attempt，不追随后续重新开启。 */
  function startSelectedBackend(
    task: ActiveAuthoritativeTask<TSnapshot, TResult, TEvent>,
    selectionAttempt: GraphwarBackendAttemptIdentity,
    configuration: GraphwarWorkerBackendConfiguration,
  ) {
    if (!isCurrentTaskAttempt(task, selectionAttempt)) {
      return;
    }
    if (configuration.generation !== selectionAttempt.backendGeneration) {
      if (
        configuration.backend.type !== "typescript" ||
        configuration.generation <= selectionAttempt.backendGeneration
      ) {
        failTaskIfCurrent(
          task,
          selectionAttempt,
          new Error("Graphwar backend selection returned an invalid replacement generation"),
        );
        return;
      }
      task.attempt = attemptGate.replaceAttempt(selectionAttempt, configuration.generation);
    }
    startAttempt(task, configuration);
  }

  /** 启动 execution，并让所有 terminal/event 回调捕获本次不可变 identity。 */
  function startAttempt(
    task: ActiveAuthoritativeTask<TSnapshot, TResult, TEvent>,
    configuration: GraphwarWorkerBackendConfiguration,
  ) {
    const attempt = task.attempt;
    let execution: GraphwarAuthoritativeAttemptExecution<TResult>;
    try {
      const snapshot = options.cloneSnapshotForAttempt(task.snapshot);
      execution = options.executeAttempt({
        attempt: copyAttemptIdentity(attempt),
        backendConfiguration: configuration,
        publish: (event) => {
          if (!isCurrentTaskAttempt(task, attempt)) {
            return false;
          }
          task.onEvent?.(event);
          return true;
        },
        snapshot,
      });
    } catch (error) {
      failTaskIfCurrent(task, attempt, error);
      return;
    }
    if (!isCurrentTaskAttempt(task, attempt)) {
      cancelExecutionSafely(execution.cancel);
      return;
    }
    task.cancelAttempt = execution.cancel;
    void execution.result.then(
      (result) => commitTaskResult(task, attempt, result),
      (error) => failTaskIfCurrent(task, attempt, error),
    );
  }

  /** Algorithm success remains provisional until the workflow finishes its generation-gated commit. */
  async function commitTaskResult(
    task: ActiveAuthoritativeTask<TSnapshot, TResult, TEvent>,
    attempt: GraphwarBackendAttemptIdentity,
    result: TResult,
  ) {
    if (!isCurrentTaskAttempt(task, attempt)) {
      return;
    }
    try {
      await task.commitResult?.(result, {
        attempt: copyAttemptIdentity(attempt),
        commit: (publish) => {
          if (!isCurrentTaskAttempt(task, attempt)) {
            return false;
          }
          publish();
          completeTaskIfCurrent(task, attempt, result);
          return true;
        },
      });
    } catch (error) {
      failTaskIfCurrent(task, attempt, error);
      return;
    }
    completeTaskIfCurrent(task, attempt, result);
  }

  /** 用户取消优先于迟到 selection/result，并只结算一次公开 Promise。 */
  function cancelTask(task: ActiveAuthoritativeTask<TSnapshot, TResult, TEvent>, reason: unknown) {
    if (task.isSettled) {
      return false;
    }
    attemptGate.cancelOuterTask(task.attempt);
    activeTasks.delete(task.attempt.outerTaskId);
    task.isSettled = true;
    cancelAttemptSafely(task);
    task.reject(reason);
    return true;
  }

  /** Ordinary attempt infrastructure failure is terminal, but remains distinct from user cancellation and replay. */
  function failTask(task: ActiveAuthoritativeTask<TSnapshot, TResult, TEvent>, reason: unknown) {
    if (task.isSettled || !isCurrentTaskAttempt(task, task.attempt)) {
      return false;
    }
    const attempt = task.attempt;
    attemptGate.completeOuterTask(attempt);
    activeTasks.delete(attempt.outerTaskId);
    task.isSettled = true;
    cancelAttemptSafely(task);
    task.reject(reason);
    return true;
  }

  function completeTaskIfCurrent(
    task: ActiveAuthoritativeTask<TSnapshot, TResult, TEvent>,
    attempt: GraphwarBackendAttemptIdentity,
    result: TResult,
  ) {
    if (!isCurrentTaskAttempt(task, attempt)) {
      return;
    }
    attemptGate.completeOuterTask(attempt);
    activeTasks.delete(attempt.outerTaskId);
    task.cancelAttempt = undefined;
    task.isSettled = true;
    task.resolve(result);
  }

  function failTaskIfCurrent(
    task: ActiveAuthoritativeTask<TSnapshot, TResult, TEvent>,
    attempt: GraphwarBackendAttemptIdentity,
    error: unknown,
  ) {
    if (!isCurrentTaskAttempt(task, attempt)) {
      return;
    }
    attemptGate.completeOuterTask(attempt);
    activeTasks.delete(attempt.outerTaskId);
    task.cancelAttempt = undefined;
    task.isSettled = true;
    task.reject(error);
  }

  /** Map ownership、完整 identity 与 generation gate 必须同时允许提交。 */
  function isCurrentTaskAttempt(
    task: ActiveAuthoritativeTask<TSnapshot, TResult, TEvent>,
    attempt: GraphwarBackendAttemptIdentity,
  ) {
    return (
      !task.isSettled &&
      activeTasks.get(attempt.outerTaskId) === task &&
      graphwarBackendAttemptIdentitiesAreEqual(task.attempt, attempt) &&
      attemptGate.canCommit(attempt)
    );
  }

  /** Cleanup 不能恢复已撤销权限，也不能阻止 outer task 结算或 replacement 安装。 */
  function cancelAttemptSafely(task: ActiveAuthoritativeTask<TSnapshot, TResult, TEvent>) {
    const cancelAttempt = task.cancelAttempt;
    task.cancelAttempt = undefined;
    cancelExecutionSafely(cancelAttempt);
  }

  return { beginTask, replayGenerationAsTypescript };
}

/** Workflow 只得到冻结副本，不能改写 coordinator/gate 持有的权威 identity。 */
function copyAttemptIdentity(attempt: GraphwarBackendAttemptIdentity) {
  return Object.freeze({ ...attempt });
}

/** 权限撤销后 Worker 终止只负责释放资源，失败不能改变任务结算或 replacement。 */
function cancelExecutionSafely(cancel: (() => void) | undefined) {
  try {
    cancel?.();
  } catch {
    // 权限已经撤销；迟到 event/result 仍由 commit gate 拒绝。
  }
}

function assertNewerGeneration(failedGeneration: number, replacementGeneration: number) {
  if (
    !Number.isSafeInteger(failedGeneration) ||
    failedGeneration < 0 ||
    !Number.isSafeInteger(replacementGeneration) ||
    replacementGeneration <= failedGeneration
  ) {
    throw new RangeError("Graphwar replacement generation must be newer than the failed generation");
  }
}
