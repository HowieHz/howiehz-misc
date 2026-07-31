import {
  createGraphwarBackendFallbackExecution,
  createGraphwarTypescriptWorkerBackendConfiguration,
  graphwarBackendAttemptIdentitiesAreEqual,
  type GraphwarBackendAttemptIdentity,
  type GraphwarBackendControlMessage,
  type GraphwarBackendExecution,
  type GraphwarWorkerBackendConfiguration,
  type GraphwarWorkerBackendSelection,
} from "../../core/algorithm-backend";
import { createGraphwarBackendAttemptGate } from "../../core/backend-attempt";
import { nowMs } from "../../core/time";
import { createGraphPoint, createPixelPoint } from "../../core/types";
import { createGraphwarWorkerBackendSlot } from "../../core/worker-backend";
import type {
  GraphwarTrajectoryCalculationInput,
  GraphwarTrajectoryCalculationOutcome,
  GraphwarTrajectoryCalculationWorkerRequest,
  GraphwarTrajectoryCalculationWorkerResponse,
} from "./trajectory-calculation";
import { calculateGraphwarTrajectory } from "./trajectory-calculation";

/** 主轨迹任务被取消、被更新输入替代，或 runner 已关闭。 */
export class GraphwarTrajectoryCancelledError extends Error {
  constructor() {
    super("Graphwar trajectory calculation cancelled");
    this.name = "GraphwarTrajectoryCancelledError";
  }
}

/** 取消属于正常的 latest-wins 流程，不应作为解算失败展示。 */
export function isGraphwarTrajectoryCancelledError(error: unknown) {
  return error instanceof GraphwarTrajectoryCancelledError;
}

/** 单次轨迹任务的原子结果和端到端耗时。 */
export interface GraphwarTrajectoryRunResult {
  /** Requested/effective algorithm backend for this stable outer task. */
  backendExecution: GraphwarBackendExecution;
  /** 函数解算和轨迹模拟的原子结果。 */
  outcome: GraphwarTrajectoryCalculationOutcome;
  /** 从 run 调用到结果可写回页面的端到端耗时。 */
  elapsedMs: number;
}

/** 轨迹 runner 的 Worker、计时与降级注入点。 */
export interface GraphwarTrajectoryRunnerOptions {
  /** 当前 runner 生命周期内每个新槽共用的 backend generation 与 module。 */
  backendConfiguration?: GraphwarWorkerBackendConfiguration;
  /** 页面 composition root 的动态选择；loading 任务在此 promise 上等待。 */
  createBackendSelection?: () => GraphwarWorkerBackendSelection;
  /** 测试注入点；页面默认创建专用 module Worker。 */
  createWorker?: () => Worker;
  /** 端到端计时入口。 */
  now?: () => number;
  /** Worker 永久不可用时通知页面显示持续降级警告。 */
  onFallback?: (reason: string) => void;
  /** 任一 active/standby Worker 的明确 WASM fault，包含空闲初始化故障。 */
  onWasmFault?: (message: Extract<GraphwarBackendControlMessage, { type: "wasm-fault" }>) => number | undefined;
  /** 每次主线程降级任务前先让浏览器绘制状态，再执行可能很慢的同步计算。 */
  waitForFallbackPaint?: () => Promise<void>;
}

/** 当前权威轨迹任务及其换代和结算状态。 */
interface PendingTrajectoryTask {
  attempt: GraphwarBackendAttemptIdentity;
  backendExecution: GraphwarBackendExecution;
  id: number;
  input: GraphwarTrajectoryCalculationInput;
  reject: (reason?: unknown) => void;
  resolve: (value: GraphwarTrajectoryRunResult) => void;
  isSettled: boolean;
  startedAt: number;
  workerFailureCount: number;
}

/** Backend selection 尚未完成时也必须拥有可取消的公开任务和输入快照。 */
interface PendingTrajectoryAdmission {
  backendGeneration: number;
  input: GraphwarTrajectoryCalculationInput;
  reject: (reason?: unknown) => void;
  resolve: (value: GraphwarTrajectoryRunResult) => void;
  isSettled: boolean;
  startedAt: number;
}

/** 一个可复用 Worker 及其当前绑定任务。 */
interface TrajectoryWorkerSlot {
  activeTask?: PendingTrajectoryTask;
  backendSlot: ReturnType<typeof createGraphwarWorkerBackendSlot>;
  worker: Worker;
}

interface TrajectoryWorkerInitializationWasmFault {
  message: Extract<GraphwarBackendControlMessage, { type: "wasm-fault" }>;
  replacementGeneration: number | undefined;
}

const WORKER_SLOT_TARGET = 2;

/**
 * 创建主轨迹 runner。
 *
 * 同一时刻只有一个权威任务；首个任务投递后，第二个槽位会预创建备用 Worker，让其初始化尽量与当前计算重叠。新输入会终止旧计算，并在固定输入快照后向备用投递，无需等待旧同步循环自行结束；若备用尚未
 * ready，浏览器会排队消息，因此这里不承诺完全消除冷启动等待。
 */
export function createGraphwarTrajectoryRunner(options: GraphwarTrajectoryRunnerOptions = {}) {
  if (options.backendConfiguration && options.createBackendSelection) {
    throw new TypeError("Trajectory runner cannot combine fixed and dynamic backend selection");
  }
  const attemptGate = createGraphwarBackendAttemptGate();
  let backendConfiguration = options.backendConfiguration ?? createGraphwarTypescriptWorkerBackendConfiguration(0);
  const createBackendSelection =
    options.createBackendSelection ??
    (() => ({
      generation: backendConfiguration.generation,
      promise: Promise.resolve(backendConfiguration),
    }));
  const createWorker = options.createWorker ?? createDefaultTrajectoryWorker;
  const now = options.now ?? nowMs;
  const workerSlots: TrajectoryWorkerSlot[] = [];
  let isClosed = false;
  let pendingAdmission: PendingTrajectoryAdmission | undefined;
  let currentTask: PendingTrajectoryTask | undefined;
  let nextRequestId = 1;
  let workerFallback: { reason: string } | undefined;

  /** 固定输入快照并启动 latest-wins 主轨迹任务。 */
  function run(input: GraphwarTrajectoryCalculationInput) {
    const startedAt = now();
    if (isClosed) {
      return Promise.reject<GraphwarTrajectoryRunResult>(new GraphwarTrajectoryCancelledError());
    }

    cancel();
    // PostMessage 不能克隆 Vue reactive proxy；进入 runner 时统一固定为本次任务的纯数据快照。
    let taskInput: GraphwarTrajectoryCalculationInput;
    try {
      taskInput = cloneGraphwarTrajectoryCalculationInput(input);
    } catch (error) {
      return Promise.reject<GraphwarTrajectoryRunResult>(
        normalizeError(error, "Graphwar trajectory input could not be cloned"),
      );
    }
    return new Promise<GraphwarTrajectoryRunResult>((resolve, reject) => {
      const admission: PendingTrajectoryAdmission = {
        backendGeneration: backendConfiguration.generation,
        input: taskInput,
        reject,
        resolve,
        isSettled: false,
        startedAt,
      };
      pendingAdmission = admission;
      if (!options.createBackendSelection) {
        startAdmission(admission, backendConfiguration);
        return;
      }

      let selection: GraphwarWorkerBackendSelection;
      try {
        selection = createBackendSelection();
        admission.backendGeneration = selection.generation;
      } catch (error) {
        rejectAdmission(admission, normalizeError(error, "Graphwar trajectory backend selection failed"));
        return;
      }
      void selection.promise.then(
        (configuration) => startAdmission(admission, configuration),
        (error: unknown) =>
          rejectAdmission(admission, normalizeError(error, "Graphwar trajectory backend selection failed")),
      );
    });
  }

  /** 只有仍权威的 admission 可以创建 backend attempt 和 Worker。 */
  function startAdmission(admission: PendingTrajectoryAdmission, configuration: GraphwarWorkerBackendConfiguration) {
    if (isClosed || pendingAdmission !== admission || admission.isSettled) {
      return;
    }
    pendingAdmission = undefined;
    if (!areBackendConfigurationsEqual(configuration, backendConfiguration)) {
      for (const slot of [...workerSlots]) {
        terminateWorkerSlot(slot);
      }
      backendConfiguration = configuration;
      workerFallback = undefined;
    }
    const requestId = nextRequestId;
    nextRequestId += 1;
    const attempt = attemptGate.beginOuterTask(backendConfiguration.generation);

    const task: PendingTrajectoryTask = {
      attempt,
      backendExecution: backendConfiguration.backendExecution,
      id: requestId,
      input: admission.input,
      reject: admission.reject,
      resolve: admission.resolve,
      isSettled: false,
      startedAt: admission.startedAt,
      workerFailureCount: 0,
    };
    currentTask = task;
    if (workerFallback) {
      if (task.backendExecution.requested === "wasm") {
        task.backendExecution = createGraphwarBackendFallbackExecution(workerFallback.reason);
      }
      void runOnMainThread(task);
      return;
    }
    startWorkerTask(task);
  }

  /** Selection 失败只拒绝仍在等待的公开任务。 */
  function rejectAdmission(admission: PendingTrajectoryAdmission, error: Error) {
    if (pendingAdmission !== admission || admission.isSettled) {
      return;
    }
    pendingAdmission = undefined;
    admission.isSettled = true;
    admission.reject(error);
  }

  /** 显式取消和 supersede 必须在 module 仍 loading 时立即结算 Promise。 */
  function cancelAdmission() {
    const admission = pendingAdmission;
    if (!admission) {
      return;
    }
    pendingAdmission = undefined;
    if (!admission.isSettled) {
      admission.isSettled = true;
      admission.reject(new GraphwarTrajectoryCancelledError());
    }
  }

  /** 取消权威任务；忙碌 Worker 必须硬终止，避免过期 Step 计算继续占用 CPU。 */
  function cancel() {
    cancelAdmission();
    cancelCurrentTask();
  }

  /** 页面卸载后永久关闭 runner，并释放热备 Worker。 */
  function close() {
    if (isClosed) {
      return;
    }
    isClosed = true;
    cancel();
    for (const slot of [...workerSlots]) {
      terminateWorkerSlot(slot);
    }
  }

  /** 拒绝当前任务，并硬终止真正承载它的 Worker。 */
  function cancelCurrentTask() {
    const task = currentTask;
    if (!task) {
      return;
    }

    currentTask = undefined;
    const activeSlot = workerSlots.find((slot) => slot.activeTask === task);
    if (activeSlot) {
      terminateWorkerSlot(activeSlot);
    }
    cancelTask(task, () => task.reject(new GraphwarTrajectoryCancelledError()));
  }

  /** 优先复用空闲槽，并在没有可用槽时创建新的 Worker。 */
  function startWorkerTask(task: PendingTrajectoryTask) {
    if (!isCurrentTask(task)) {
      return;
    }

    const idleSlot = workerSlots.find((slot) => !slot.activeTask);
    if (idleSlot) {
      postWorkerTask(idleSlot, task);
      return;
    }

    const created = tryCreateWorkerSlot();
    if (created.slot) {
      postWorkerTask(created.slot, task);
      return;
    }
    if (created.wasmFault) {
      replayInitializationFault(created.wasmFault);
      return;
    }
    handleWorkerInfrastructureFailure(task, created.error);
  }

  /** 将任务绑定到槽位并投递，同时维持一个热备槽。 */
  function postWorkerTask(slot: TrajectoryWorkerSlot, task: PendingTrajectoryTask) {
    slot.activeTask = task;
    try {
      slot.worker.postMessage({
        attempt: task.attempt,
        id: task.id,
        input: task.input,
      } satisfies GraphwarTrajectoryCalculationWorkerRequest);
    } catch (error) {
      slot.activeTask = undefined;
      terminateWorkerSlot(slot);
      handleWorkerInfrastructureFailure(task, normalizeError(error, "Graphwar trajectory worker request failed"));
      return;
    }

    while (!isClosed && !workerFallback && workerSlots.length < WORKER_SLOT_TARGET) {
      const standby = tryCreateWorkerSlot();
      if (standby.slot) {
        continue;
      }
      if (standby.wasmFault) {
        replayInitializationFault(standby.wasmFault);
      }
      return;
    }
  }

  /** 同步 backend-init fault 与异步 typed fault 一样替换当前 attempt，不经过普通换槽重试。 */
  function replayInitializationFault(fault: TrajectoryWorkerInitializationWasmFault) {
    replayGenerationAsTypescript(
      fault.message.generation,
      fault.replacementGeneration ?? Math.max(fault.message.generation + 1, backendConfiguration.generation + 1),
      `${fault.message.fault.code}: ${fault.message.fault.message}`,
    );
  }

  /** 创建槽位并绑定协议事件，将构造失败统一转换成 Error。 */
  function tryCreateWorkerSlot():
    | {
        error: Error;
        slot?: undefined;
        wasmFault?: TrajectoryWorkerInitializationWasmFault;
      }
    | { error?: undefined; slot: TrajectoryWorkerSlot; wasmFault?: undefined } {
    let worker: Worker | undefined;
    try {
      worker = createWorker();
      let initializationFailure: Error | undefined;
      let initializationWasmFault: TrajectoryWorkerInitializationWasmFault | undefined;
      let isInitializing = true;
      const backendSlot = createGraphwarWorkerBackendSlot({
        configuration: backendConfiguration,
        onInfrastructureFailure: (error) => {
          if (isInitializing) {
            initializationFailure = error;
          } else {
            handleWorkerFailure(slot, error);
          }
        },
        onWasmFault: (message) => {
          if (isInitializing) {
            initializationWasmFault = {
              message,
              replacementGeneration: options.onWasmFault?.(message),
            };
          } else {
            handleWorkerWasmFault(slot, message);
          }
        },
        role: "trajectory",
        worker,
      });
      const slot: TrajectoryWorkerSlot = { backendSlot, worker };
      isInitializing = false;
      if (initializationFailure || backendSlot.getState().type === "failed") {
        worker.terminate();
        const failedState = backendSlot.getState();
        return {
          error:
            initializationFailure ??
            (failedState.type === "failed"
              ? failedState.error
              : new Error("Graphwar trajectory worker backend initialization failed")),
          ...(initializationWasmFault ? { wasmFault: initializationWasmFault } : {}),
        };
      }
      worker.addEventListener(
        "message",
        (event: MessageEvent<GraphwarBackendControlMessage | GraphwarTrajectoryCalculationWorkerResponse>) =>
          handleWorkerMessage(slot, event),
      );
      worker.addEventListener("messageerror", () =>
        handleWorkerFailure(slot, new Error("Graphwar trajectory worker response could not be deserialized")),
      );
      worker.addEventListener("error", (event: ErrorEvent) =>
        handleWorkerFailure(
          slot,
          event.error instanceof Error ? event.error : new Error(event.message || "Graphwar trajectory worker failed"),
        ),
      );
      workerSlots.push(slot);
      return { slot };
    } catch (error) {
      worker?.terminate();
      return { error: normalizeError(error, "Graphwar trajectory worker is unavailable") };
    }
  }

  /** 校验当前槽位的响应，并只提交权威任务的完整结果。 */
  function handleWorkerMessage(
    slot: TrajectoryWorkerSlot,
    event: MessageEvent<GraphwarBackendControlMessage | GraphwarTrajectoryCalculationWorkerResponse>,
  ) {
    if (workerSlots.indexOf(slot) < 0) {
      return;
    }
    const response = event.data;
    if (slot.backendSlot.handleMessage(response)) {
      return;
    }
    const task = slot.activeTask;
    if (!task || !isCurrentTask(task)) {
      return;
    }
    if (response.id !== task.id) {
      handleWorkerFailure(slot, new Error("Graphwar trajectory worker returned an unexpected request id"));
      return;
    }
    if (!graphwarBackendAttemptIdentitiesAreEqual(response.attempt, task.attempt)) {
      handleWorkerFailure(slot, new Error("Graphwar trajectory worker returned an unexpected backend attempt"));
      return;
    }
    slot.activeTask = undefined;
    completeTask(task, () =>
      task.resolve({
        backendExecution: task.backendExecution,
        elapsedMs: getElapsedMs(now, task.startedAt),
        outcome: response.outcome,
      }),
    );
  }

  /** Typed WASM fault 不进入换槽/主线程基础设施 fallback；页面 fuse callback 决定 cold replay。 */
  function handleWorkerWasmFault(
    slot: TrajectoryWorkerSlot,
    message: Extract<GraphwarBackendControlMessage, { type: "wasm-fault" }>,
  ) {
    if (workerSlots.indexOf(slot) < 0) {
      return;
    }
    const task = slot.activeTask;
    if (
      message.context.type !== "initialization" &&
      (!task ||
        !isCurrentTask(task) ||
        !graphwarBackendAttemptIdentitiesAreEqual(message.context.attempt, task.attempt))
    ) {
      return;
    }
    options.onWasmFault?.(message);
    terminateWorkerSlot(slot);
    void replayAfterWasmFault(task ?? currentTask, message);
  }

  /** 保留同一个 outer task，从原始输入切换到 TS cold attempt；standby fault 也必须撤销旧 generation。 */
  async function replayAfterWasmFault(
    task: PendingTrajectoryTask | undefined,
    message: Extract<GraphwarBackendControlMessage, { type: "wasm-fault" }>,
  ) {
    if (!task || !isCurrentTask(task)) {
      return;
    }
    replayGenerationAsTypescript(
      message.generation,
      Math.max(message.generation + 1, backendConfiguration.generation + 1),
      `${message.fault.code}: ${message.fault.message}`,
    );
  }

  /** 页面级 fuse 撤销同 generation 的全部槽，并从当前任务快照安装 TS cold attempt。 */
  function replayGenerationAsTypescript(failedGeneration: number, fallbackGeneration: number, fallbackReason: string) {
    const admission = pendingAdmission;
    if (backendConfiguration.generation !== failedGeneration && admission?.backendGeneration !== failedGeneration) {
      return false;
    }
    for (const workerSlot of [...workerSlots]) {
      terminateWorkerSlot(workerSlot);
    }
    const fallbackConfiguration = createGraphwarTypescriptWorkerBackendConfiguration(
      fallbackGeneration,
      fallbackReason,
    );
    backendConfiguration = fallbackConfiguration;
    workerFallback = undefined;
    if (admission?.backendGeneration === failedGeneration) {
      startAdmission(admission, fallbackConfiguration);
    }
    const task = currentTask;
    if (task && !task.isSettled && task.attempt.backendGeneration === failedGeneration) {
      task.attempt = attemptGate.replaceAttempt(task.attempt, fallbackGeneration);
      task.backendExecution = fallbackConfiguration.backendExecution;
      task.workerFailureCount = 0;
      startWorkerTask(task);
    }
    return true;
  }

  /** 移除故障槽，并决定当前任务是否需要换槽重试。 */
  function handleWorkerFailure(slot: TrajectoryWorkerSlot, error: Error) {
    if (workerSlots.indexOf(slot) < 0) {
      return;
    }

    const task = slot.activeTask;
    slot.activeTask = undefined;
    terminateWorkerSlot(slot);
    if (!task || !isCurrentTask(task)) {
      // 空闲 Worker 异步失败时等下一次任务再补建，避免故障环境中连续创建失败 Worker。
      return;
    }
    handleWorkerInfrastructureFailure(task, error);
  }

  /** 首次基础设施失败换槽并优先复用热备，重试仍失败则永久降级到主线程。 */
  function handleWorkerInfrastructureFailure(task: PendingTrajectoryTask, error: Error) {
    if (!isCurrentTask(task)) {
      return;
    }

    // 第一次基础设施失败换槽并优先复用热备；重试仍失败才永久回退主线程。
    if (task.workerFailureCount === 0) {
      task.workerFailureCount = 1;
      startWorkerTask(task);
      return;
    }

    if (!workerFallback) {
      workerFallback = { reason: error.message };
      if (task.backendExecution.requested === "wasm") {
        task.backendExecution = createGraphwarBackendFallbackExecution(error.message);
      }
      for (const slot of [...workerSlots]) {
        terminateWorkerSlot(slot);
      }
      try {
        options.onFallback?.(error.message);
      } catch {
        // 状态渲染回调异常不能阻止保底计算继续执行。
      }
    }
    void runOnMainThread(task);
  }

  /** 等待降级状态绘制后，同步计算并仅提交仍然权威的任务。 */
  async function runOnMainThread(task: PendingTrajectoryTask) {
    // 保留独立异步边界，让已排队的取消先于阻塞计算生效。
    try {
      await options.waitForFallbackPaint?.();
    } catch {
      // 浏览器绘制等待失败时仍需继续执行主线程保底计算。
    }
    if (!isCurrentTask(task)) {
      return;
    }

    let outcome: GraphwarTrajectoryCalculationOutcome;
    try {
      outcome = calculateGraphwarTrajectory(task.input);
    } catch (error) {
      if (!isCurrentTask(task)) {
        return;
      }
      completeTask(task, () => task.reject(normalizeError(error, "Graphwar trajectory main-thread fallback failed")));
      return;
    }
    if (!isCurrentTask(task)) {
      return;
    }
    completeTask(task, () =>
      task.resolve({
        backendExecution: task.backendExecution,
        elapsedMs: getElapsedMs(now, task.startedAt),
        outcome,
      }),
    );
  }

  /** 判断任务是否仍是唯一可写回页面的权威任务。 */
  function isCurrentTask(task: PendingTrajectoryTask) {
    return !isClosed && currentTask === task && !task.isSettled && attemptGate.canCommit(task.attempt);
  }

  /** 通过 attempt gate 完成唯一终态提交，再结算公开 Promise。 */
  function completeTask(task: PendingTrajectoryTask, callback: () => void) {
    if (!isCurrentTask(task)) {
      return;
    }
    attemptGate.completeOuterTask(task.attempt);
    currentTask = undefined;
    settleTask(task, callback);
  }

  /** 用户取消或输入替换撤销整个 outer task，不安装 backend replay。 */
  function cancelTask(task: PendingTrajectoryTask, callback: () => void) {
    if (attemptGate.canCommit(task.attempt)) {
      attemptGate.cancelOuterTask(task.attempt);
    }
    settleTask(task, callback);
  }

  /** 保证每个任务的 Promise 只结算一次。 */
  function settleTask(task: PendingTrajectoryTask, callback: () => void) {
    if (task.isSettled) {
      return;
    }
    task.isSettled = true;
    callback();
  }

  /** 从池中移除槽位并释放其 Worker。 */
  function terminateWorkerSlot(slot: TrajectoryWorkerSlot) {
    const index = workerSlots.indexOf(slot);
    if (index >= 0) {
      workerSlots.splice(index, 1);
    }
    slot.activeTask = undefined;
    slot.worker.terminate();
  }

  return {
    cancel,
    close,
    replayGenerationAsTypescript,
    run,
  };
}

function areBackendConfigurationsEqual(
  left: GraphwarWorkerBackendConfiguration,
  right: GraphwarWorkerBackendConfiguration,
) {
  return (
    left.generation === right.generation &&
    left.backend.type === right.backend.type &&
    (left.backend.type === "typescript" ||
      (right.backend.type === "wasm" && left.backend.module === right.backend.module))
  );
}

/** 创建页面默认使用的主轨迹 module Worker。 */
function createDefaultTrajectoryWorker() {
  if (typeof Worker === "undefined") {
    throw new Error("Web Worker is unavailable");
  }
  return new Worker(new URL("../../workers/trajectory/main.worker.ts", import.meta.url), {
    name: "graphwar-main-trajectory",
    type: "module",
  });
}

/** 计算非负且有限的端到端耗时。 */
function getElapsedMs(now: () => number, startedAt: number) {
  const elapsedMs = now() - startedAt;
  return Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
}

/** 将跨边界抛出的任意值收敛为可展示的 Error。 */
function normalizeError(error: unknown, fallbackMessage: string) {
  return error instanceof Error ? error : new Error(error === undefined ? fallbackMessage : String(error));
}

/** 深拷贝输入，且让同源的碰撞 mask 和邪道障碍 mask 在请求快照里继续共用同一份副本。 */
function cloneGraphwarTrajectoryCalculationInput(
  input: GraphwarTrajectoryCalculationInput,
): GraphwarTrajectoryCalculationInput {
  const sourceCollisionMask = input.collision?.mask;
  const collisionMask = sourceCollisionMask ? new Uint8Array(sourceCollisionMask) : undefined;
  const base = {
    bounds: {
      maxX: input.bounds.maxX,
      maxY: input.bounds.maxY,
      minX: input.bounds.minX,
      minY: input.bounds.minY,
    },
    boundsRect: {
      height: input.boundsRect.height,
      width: input.boundsRect.width,
      x: input.boundsRect.x,
      y: input.boundsRect.y,
    },
    ...(input.collision
      ? {
          collision: {
            ...(input.collision.boundaryExpansion === undefined
              ? {}
              : { boundaryExpansion: input.collision.boundaryExpansion }),
            ...(collisionMask ? { mask: collisionMask } : {}),
          },
        }
      : {}),
  };

  if (input.type === "simulator") {
    return {
      ...base,
      equation: input.equation,
      expression: input.expression,
      ...(input.launchAngleRadians === undefined ? {} : { launchAngleRadians: input.launchAngleRadians }),
      ...(input.parser ? { parser: { ...input.parser } } : {}),
      soldierCenter: createGraphPoint(input.soldierCenter.x, input.soldierCenter.y),
      type: "simulator",
    };
  }

  const sourceGlitchMask = input.settings.stepGlitchObstacleMask;
  const glitchMask = sourceGlitchMask
    ? sourceGlitchMask === sourceCollisionMask && collisionMask
      ? collisionMask
      : new Uint8Array(sourceGlitchMask)
    : undefined;
  return {
    ...base,
    points: input.points.map((point) => createGraphPoint(point.x, point.y)),
    settings: {
      algorithm: input.settings.algorithm,
      decimalPlaces: input.settings.decimalPlaces,
      equation: input.settings.equation,
      ...(input.settings.secondOrderLaunchAngleMode === undefined
        ? {}
        : { secondOrderLaunchAngleMode: input.settings.secondOrderLaunchAngleMode }),
      ...(input.settings.formulaPathSteepness === undefined
        ? {}
        : { formulaPathSteepness: input.settings.formulaPathSteepness }),
      steepness: input.settings.steepness,
      isStepGlitchModeEnabled: input.settings.isStepGlitchModeEnabled,
      ...(glitchMask ? { stepGlitchObstacleMask: glitchMask } : {}),
      isStepOverflowProtectionEnabled: input.settings.isStepOverflowProtectionEnabled,
    },
    ...(input.target
      ? {
          target: {
            hitRadiusPixels: input.target.hitRadiusPixels,
            point: createPixelPoint(input.target.point.x, input.target.point.y),
          },
        }
      : {}),
    type: "solver",
  };
}
