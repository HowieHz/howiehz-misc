/** 主线程侧 Graphwar 几何寻路 runner，集中管理 Worker 生命周期和取消。 */
import {
  createGraphwarTypescriptWorkerBackendConfiguration,
  createGraphwarWasmRequestNonce,
  graphwarBackendAttemptIdentitiesAreEqual,
  isGraphwarBackendControlMessage,
  type GraphwarBackendAttemptIdentity,
  type GraphwarBackendControlMessage,
  type GraphwarBackendExecution,
  type GraphwarWorkerBackendConfiguration,
  type GraphwarWorkerBackendSelection,
  GraphwarWasmFault,
} from "../../core/algorithm-backend";
import { createGraphwarBackendAttemptGate } from "../../core/backend-attempt";
import { clonePixelPoint } from "../../core/types";
import { createGraphwarWorkerBackendSlot } from "../../core/worker-backend";
import type {
  GraphwarOneClickClearDagEdgeBuildJob,
  GraphwarOneClickClearDagEdgeBuildRequest,
  GraphwarOneClickClearDagEdgeBuildResult,
} from "../one-click-clear/search";
import type { GraphwarPathfindingPreview } from "../routing/visibility-graph";
import type {
  GraphwarOneClickClearPathWorkerInput,
  GraphwarOneClickClearPathWorkerResult,
  GraphwarOneClickClearProgress,
  GraphwarPathfindingRouteInput,
  GraphwarPathfindingRouteResult,
  GraphwarPathfindingWorkerRequest,
  GraphwarPathfindingWorkerResponse,
  GraphwarPathfindingWorkerSuccessResponse,
  GraphwarSmartPathfindingPathInput,
  GraphwarSmartPathfindingPathResult,
} from "./protocol";

/** 几何寻路任务被用户取消或新任务替代。 */
export class GraphwarPathfindingCancelledError extends Error {
  constructor() {
    super("Graphwar pathfinding cancelled");
    this.name = "GraphwarPathfindingCancelledError";
  }
}

/** 判断错误是否只是寻路任务被取消，页面不应当展示为失败。 */
export function isGraphwarPathfindingCancelledError(error: unknown) {
  return error instanceof GraphwarPathfindingCancelledError;
}

/** 单次几何寻路运行时的页面回调。 */
export interface GraphwarPathfindingRunOptions {
  /** 一键清图最终回放验证后的 best-so-far；其他任务不会调用。 */
  onIncumbent?: (progress: GraphwarOneClickClearProgress) => void;
  /** 普通智能寻路搜索动画快照。 */
  onPreview?: (preview: GraphwarPathfindingPreview) => void;
  /** 请求 Worker 返回调试计数器和自然边界耗时。 */
  shouldCollectDiagnostics?: boolean;
}

/** 当前等待 Worker 响应的主线程任务，用 request id 防止旧响应覆盖新结果。 */
interface PendingPathfindingWorkerTaskBase {
  /** Stable public task plus the currently authoritative backend attempt. */
  attempt: GraphwarBackendAttemptIdentity;
  /** Requested/effective backend remains attached to the stable outer task across replay. */
  backendExecution: GraphwarBackendExecution;
  /** 发送给 Worker 的请求 id。 */
  id: number;
  /** 搜索动画回调；只有普通智能寻路会使用。 */
  onPreview?: (preview: GraphwarPathfindingPreview) => void;
  /** 一键清图当前最优方案回调；请求取消或换代后不会再调用。 */
  onIncumbent?: GraphwarPathfindingRunOptions["onIncumbent"];
  /** Last accepted request-local incumbent event sequence. */
  lastIncumbentSequence?: number;
  /** Promise 失败回调。 */
  reject: (reason?: unknown) => void;
  /** Promise 成功回调。 */
  resolve: (value: GraphwarPathfindingWorkerSuccessResponse["result"]) => void;
  /** 当前请求要求每个一键清图进度都携带累计诊断。 */
  shouldCollectDiagnostics: boolean;
  /** Immutable request snapshot reused by a typed-fault TS cold replay. */
  request: Omit<GraphwarPathfindingWorkerRequest, "attempt">;
}

/** DAG job 集合只和对应 task 分支原子出现，其他请求不能携带这份提交证据。 */
type PendingPathfindingWorkerTask = PendingPathfindingWorkerTaskBase &
  (
    | {
        expectedDagJobTypes: ReadonlyMap<number, GraphwarOneClickClearDagEdgeBuildJob["type"]>;
        taskType: "build-one-click-clear-dag-edges";
      }
    | {
        taskType: Exclude<GraphwarPathfindingWorkerRequest["task"]["type"], "build-one-click-clear-dag-edges">;
      }
  );

/** Backend selection 尚未完成时持有 owned request 与公开 Promise，确保取消不会漏过 loading 任务。 */
interface PendingPathfindingAdmission {
  backendGeneration: number;
  isSettled: boolean;
  onIncumbent?: GraphwarPathfindingRunOptions["onIncumbent"];
  onPreview?: GraphwarPathfindingRunOptions["onPreview"];
  reject: (reason?: unknown) => void;
  request: Omit<GraphwarPathfindingWorkerRequest, "attempt">;
  resolve: (value: GraphwarPathfindingWorkerSuccessResponse["result"]) => void;
  shouldCollectDiagnostics: boolean;
}

/** Pathfinding master 与 nested edge Worker 共用的 backend 生命周期注入点。 */
export interface GraphwarPathfindingRunnerOptions {
  backendConfiguration?: GraphwarWorkerBackendConfiguration;
  createBackendSelection?: () => GraphwarWorkerBackendSelection;
  onWasmFault?: (message: Extract<GraphwarBackendControlMessage, { type: "wasm-fault" }>) => number | undefined;
}

/**
 * 创建页面可复用的几何寻路 runner。
 *
 * 正常完成后保留 master Worker 及其派生 cache，除非任务期间已标记 cache 失效。当前 UI 入口会阻止寻路期间再次提交目标，runner 仍会防御性取消重叠调用。
 *
 * 取消直接终止并丢弃 Worker，既能立即停止同步搜索，也避免所有正常搜索为低频取消持续承担分片调度开销；后续请求再按需创建。
 */
export function createGraphwarPathfindingRunner(options: GraphwarPathfindingRunnerOptions = {}) {
  if (options.backendConfiguration && options.createBackendSelection) {
    throw new TypeError("Pathfinding runner cannot combine fixed and dynamic backend selection");
  }
  const attemptGate = createGraphwarBackendAttemptGate();
  let backendConfiguration = options.backendConfiguration ?? createGraphwarTypescriptWorkerBackendConfiguration(0);
  const createBackendSelection =
    options.createBackendSelection ??
    (() => ({
      generation: backendConfiguration.generation,
      promise: Promise.resolve(backendConfiguration),
    }));
  let worker: Worker | undefined;
  let workerBackendSlot: ReturnType<typeof createGraphwarWorkerBackendSlot> | undefined;
  let cleanupWorkerListeners: (() => void) | undefined;
  let nextRequestId = 1;
  let pendingAdmission: PendingPathfindingAdmission | undefined;
  let pendingTask: PendingPathfindingWorkerTask | undefined;
  let shouldResetWorkerAfterCurrentTask = false;

  /** 懒创建 master Worker；不支持 Worker 的环境由调用方按寻路失败处理。 */
  function ensureWorker() {
    if (typeof Worker === "undefined") {
      return undefined;
    }
    if (worker) {
      return worker;
    }

    const createdWorker = new Worker(new URL("../../workers/pathfinding/main.worker.ts", import.meta.url), {
      name: "graphwar-pathfinding",
      type: "module",
    });
    worker = createdWorker;
    const handleMessage = (event: MessageEvent<GraphwarBackendControlMessage | GraphwarPathfindingWorkerResponse>) => {
      if (worker === createdWorker) {
        handleWorkerMessage(createdWorker, event);
      }
    };
    const handleMessageError = () => {
      if (worker !== createdWorker) {
        return;
      }
      rejectPendingTask(new Error("Graphwar pathfinding worker message could not be deserialized"));
    };
    const handleError = (event: ErrorEvent) => {
      if (worker !== createdWorker) {
        return;
      }
      rejectPendingTask(event.error instanceof Error ? event.error : new Error(event.message));
    };
    createdWorker.addEventListener("message", handleMessage);
    createdWorker.addEventListener("messageerror", handleMessageError);
    createdWorker.addEventListener("error", handleError);
    cleanupWorkerListeners = () => {
      createdWorker.removeEventListener("message", handleMessage);
      createdWorker.removeEventListener("messageerror", handleMessageError);
      createdWorker.removeEventListener("error", handleError);
    };
    let initializationError: Error | undefined;
    const createdBackendSlot = createGraphwarWorkerBackendSlot({
      configuration: backendConfiguration,
      onInfrastructureFailure: (error) => {
        if (workerBackendSlot) {
          rejectPendingTask(error);
        } else {
          initializationError = error;
        }
      },
      onWasmFault: (message) => {
        if (workerBackendSlot) {
          handleWasmFaultFromWorker(createdWorker, message);
        } else {
          initializationError = new GraphwarWasmFault(message.fault.code, message.fault.message);
        }
      },
      role: "pathfinding-master",
      worker: createdWorker,
    });
    workerBackendSlot = createdBackendSlot;
    const backendState = createdBackendSlot.getState();
    if (initializationError) {
      resetWorker();
      throw initializationError;
    }
    if (backendState.type === "failed") {
      resetWorker();
      throw backendState.error;
    }
    return createdWorker;
  }

  /** 在 master Worker 中执行普通智能寻路几何搜索。 */
  function findRoute(input: GraphwarPathfindingRouteInput, options?: GraphwarPathfindingRunOptions) {
    cancel();
    return withBackend<GraphwarPathfindingRouteResult>(
      {
        id: nextRequestId,
        task: {
          input,
          type: "find-route",
        },
      },
      options,
    );
  }

  /** 在 master Worker 中执行完整智能寻路，主线程只负责写回结果。 */
  function findSmartPath(input: GraphwarSmartPathfindingPathInput, options?: GraphwarPathfindingRunOptions) {
    cancel();
    return withBackend<GraphwarSmartPathfindingPathResult>(
      {
        id: nextRequestId,
        task: {
          ...(options?.shouldCollectDiagnostics ? { shouldCollectDiagnostics: true as const } : {}),
          input,
          type: "find-smart-path",
        },
      },
      options,
    );
  }

  /** 在 master Worker 中建立一键清图 DAG 边。 */
  function buildOneClickClearDagEdges(input: GraphwarOneClickClearDagEdgeBuildRequest) {
    cancel();
    return withBackend<GraphwarOneClickClearDagEdgeBuildResult>({
      id: nextRequestId,
      task: {
        input,
        type: "build-one-click-clear-dag-edges",
      },
    });
  }

  /** 在 master Worker 中执行完整一键清图搜索，避免主线程同步采样卡顿。 */
  function buildOneClickClearPath(
    input: GraphwarOneClickClearPathWorkerInput,
    options?: GraphwarPathfindingRunOptions,
  ) {
    cancel();
    return withBackend<GraphwarOneClickClearPathWorkerResult>(
      {
        id: nextRequestId,
        task: {
          ...(options?.shouldCollectDiagnostics ? { shouldCollectDiagnostics: true as const } : {}),
          input,
          shouldReportIncumbents: options?.onIncumbent !== undefined,
          type: "build-one-click-clear-path",
        },
      },
      options,
    );
  }

  /** 先固定 request 并建立 cancellable admission，再等待动态 backend。 */
  function withBackend<TResult>(
    request: Omit<GraphwarPathfindingWorkerRequest, "attempt">,
    runOptions?: GraphwarPathfindingRunOptions,
  ) {
    let ownedRequest: Omit<GraphwarPathfindingWorkerRequest, "attempt">;
    try {
      ownedRequest = cloneGraphwarPathfindingWorkerRequestWithoutAttempt(request);
    } catch (error) {
      return Promise.reject<TResult>(normalizeError(error, "Graphwar pathfinding input could not be cloned"));
    }
    nextRequestId += 1;
    return new Promise<TResult>((resolve, reject) => {
      const admission: PendingPathfindingAdmission = {
        backendGeneration: backendConfiguration.generation,
        isSettled: false,
        onIncumbent: runOptions?.onIncumbent,
        onPreview: runOptions?.onPreview,
        reject,
        request: ownedRequest,
        resolve: resolve as PendingPathfindingAdmission["resolve"],
        shouldCollectDiagnostics: runOptions?.shouldCollectDiagnostics === true,
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
        rejectAdmission(admission, normalizeError(error, "Graphwar pathfinding backend selection failed"));
        return;
      }
      void selection.promise.then(
        (configuration) => {
          try {
            startAdmission(admission, configuration);
          } catch (error) {
            resetWorker();
            rejectAdmission(admission, normalizeError(error, "Graphwar pathfinding task could not start"));
          }
        },
        (error: unknown) =>
          rejectAdmission(admission, normalizeError(error, "Graphwar pathfinding backend selection failed")),
      );
    });
  }

  /** 只有仍权威的 admission 可以选择 backend、创建 Worker 并安装 outer task。 */
  function startAdmission(admission: PendingPathfindingAdmission, configuration: GraphwarWorkerBackendConfiguration) {
    if (pendingAdmission !== admission || admission.isSettled) {
      return;
    }
    if (!areBackendConfigurationsEqual(configuration, backendConfiguration)) {
      resetWorker();
      backendConfiguration = configuration;
    }
    let activeWorker: Worker;
    try {
      const selectedWorker = ensureWorker();
      if (!selectedWorker) {
        throw new Error("Graphwar pathfinding worker is unavailable");
      }
      activeWorker = selectedWorker;
    } catch (error) {
      if (!(error instanceof GraphwarWasmFault) || backendConfiguration.backend.type !== "wasm") {
        rejectAdmission(admission, normalizeError(error, "Graphwar pathfinding worker is unavailable"));
        return;
      }
      const faultMessage = {
        fault: error.toDescriptor(),
        generation: backendConfiguration.generation,
        role: "pathfinding-master",
        type: "wasm-fault",
        context: { type: "initialization" },
      } satisfies Extract<GraphwarBackendControlMessage, { type: "wasm-fault" }>;
      const replacementGeneration = options.onWasmFault?.(faultMessage);
      const fallbackReason = `${error.code}: ${error.message}`;
      resetWorker();
      backendConfiguration = createGraphwarTypescriptWorkerBackendConfiguration(
        replacementGeneration ?? backendConfiguration.generation + 1,
        fallbackReason,
      );
      try {
        const fallbackWorker = ensureWorker();
        if (!fallbackWorker) {
          throw new Error("Graphwar pathfinding worker is unavailable", { cause: error });
        }
        activeWorker = fallbackWorker;
      } catch (fallbackError) {
        resetWorker();
        rejectAdmission(
          admission,
          normalizeError(fallbackError, "Graphwar pathfinding TypeScript fallback worker is unavailable"),
        );
        return;
      }
    }

    pendingAdmission = undefined;
    const attempt = attemptGate.beginOuterTask(backendConfiguration.generation);
    const authoritativeRequest = { ...admission.request, attempt } satisfies GraphwarPathfindingWorkerRequest;
    const ownedRequest = cloneGraphwarPathfindingWorkerRequest(authoritativeRequest);
    const taskIdentity =
      admission.request.task.type === "build-one-click-clear-dag-edges"
        ? {
            expectedDagJobTypes: new Map(admission.request.task.input.jobs.map((job) => [job.id, job.type])),
            taskType: admission.request.task.type,
          }
        : { taskType: admission.request.task.type };
    pendingTask = {
      attempt,
      backendExecution: backendConfiguration.backendExecution,
      id: admission.request.id,
      onIncumbent: admission.onIncumbent,
      onPreview: admission.onPreview,
      reject: admission.reject,
      resolve: admission.resolve,
      shouldCollectDiagnostics: admission.shouldCollectDiagnostics,
      request: { id: ownedRequest.id, task: ownedRequest.task },
      ...taskIdentity,
    };
    try {
      activeWorker.postMessage(ownedRequest);
    } catch (error) {
      attemptGate.cancelOuterTask(attempt);
      pendingTask = undefined;
      admission.isSettled = true;
      admission.reject(error);
    }
  }

  /** Selection 失败只拒绝仍在等待的 admission。 */
  function rejectAdmission(admission: PendingPathfindingAdmission, error: Error) {
    if (pendingAdmission !== admission || admission.isSettled) {
      return;
    }
    pendingAdmission = undefined;
    admission.isSettled = true;
    admission.reject(error);
  }

  function cancelAdmission() {
    const admission = pendingAdmission;
    if (!admission) {
      return;
    }
    pendingAdmission = undefined;
    if (!admission.isSettled) {
      admission.isSettled = true;
      admission.reject(new GraphwarPathfindingCancelledError());
    }
  }

  /** 取消当前寻路并重建 Worker，避免旧任务继续占用 CPU。 */
  function cancel() {
    cancelAdmission();
    if (!pendingTask) {
      return;
    }

    attemptGate.cancelOuterTask(pendingTask.attempt);
    pendingTask.reject(new GraphwarPathfindingCancelledError());
    pendingTask = undefined;
    resetWorker();
  }

  /** 输入语义失效时 cache 本就不可复用；空闲时立即丢弃，忙碌时标记为任务结算后丢弃，后续请求再按需创建。 */
  function clearCache() {
    if (pendingTask) {
      shouldResetWorkerAfterCurrentTask = true;
      return;
    }
    resetWorker();
  }

  /** 关闭 runner 时释放 Worker，并让挂起任务按取消处理。 */
  function close() {
    cancel();
    resetWorker();
  }

  /** 只接收当前请求 id 对应的 Worker 消息，丢弃过期响应。 */
  function handleWorkerMessage(
    sourceWorker: Worker,
    event: MessageEvent<GraphwarBackendControlMessage | GraphwarPathfindingWorkerResponse>,
  ) {
    const response = event.data;
    if (isGraphwarBackendControlMessage(response)) {
      if (response.role === "pathfinding-master") {
        workerBackendSlot?.handleMessage(response);
      } else if (response.role === "one-click-clear-edge" && response.type === "wasm-fault") {
        handleWasmFaultFromWorker(sourceWorker, response);
      } else {
        rejectPendingTask(new Error("Pathfinding Worker returned invalid backend control"));
      }
      return;
    }
    if (!pendingTask) {
      return;
    }
    if (
      response.id !== pendingTask.id ||
      !graphwarBackendAttemptIdentitiesAreEqual(response.attempt, pendingTask.attempt) ||
      !attemptGate.canCommit(response.attempt)
    ) {
      return;
    }
    if (response.type === "preview") {
      if (!pendingTask.onPreview) {
        rejectPendingProtocolResponse();
        return;
      }
      pendingTask.onPreview(response.preview);
      return;
    }
    if (response.type === "one-click-clear-incumbent") {
      if (
        pendingTask.taskType !== "build-one-click-clear-path" ||
        !pendingTask.onIncumbent ||
        pendingTask.shouldCollectDiagnostics !== (response.progress.diagnostics !== undefined)
      ) {
        rejectPendingProtocolResponse();
        return;
      }
      const sequence = response.progress.sequence;
      if (sequence !== undefined) {
        if (!Number.isSafeInteger(sequence) || sequence <= 0) {
          rejectPendingProtocolResponse();
          return;
        }
        if (pendingTask.lastIncumbentSequence !== undefined && sequence <= pendingTask.lastIncumbentSequence) {
          return;
        }
        pendingTask.lastIncumbentSequence = sequence;
      }
      if (response.progress.diagnostics) {
        response.progress.diagnostics.backendExecution = pendingTask.backendExecution;
      }
      pendingTask.onIncumbent(response.progress);
      return;
    }

    if (response.type === "error") {
      const completedTask = pendingTask;
      pendingTask = undefined;
      attemptGate.completeOuterTask(completedTask.attempt);
      completedTask.reject(new Error(response.message));
      resetWorkerIfCacheInvalidated();
      return;
    }
    if (response.type !== "success") {
      rejectPendingProtocolResponse();
      return;
    }
    if (pendingTask.taskType === "build-one-click-clear-dag-edges") {
      if (response.taskType !== "build-one-click-clear-dag-edges") {
        rejectPendingProtocolResponse();
        return;
      }
      const expectedDagJobTypes = pendingTask.expectedDagJobTypes;
      const returnedDagJobIds = new Set(response.result.routes.map((route) => route.jobId));
      if (
        returnedDagJobIds.size !== expectedDagJobTypes.size ||
        !response.result.routes.every((route) => {
          const expectedType = expectedDagJobTypes.get(route.jobId);
          return expectedType !== undefined && (route.type === "unreachable" || route.type === expectedType);
        })
      ) {
        rejectPendingProtocolResponse();
        return;
      }
    } else if (response.taskType !== pendingTask.taskType) {
      rejectPendingProtocolResponse();
      return;
    }
    const completedTask = pendingTask;
    pendingTask = undefined;
    if ("diagnostics" in response.result && response.result.diagnostics) {
      response.result.diagnostics.backendExecution = completedTask.backendExecution;
    }
    attemptGate.completeOuterTask(completedTask.attempt);
    completedTask.resolve(response.result as GraphwarPathfindingWorkerSuccessResponse["result"]);
    resetWorkerIfCacheInvalidated();
  }

  /** Root 或 nested Worker typed fault 直接进入页面 fuse callback，不能伪装成普通 search error。 */
  function handleWasmFaultFromWorker(
    sourceWorker: Worker,
    message: Extract<GraphwarBackendControlMessage, { type: "wasm-fault" }>,
  ) {
    if (worker !== sourceWorker) {
      return;
    }
    if (
      message.context.type !== "initialization" &&
      (!pendingTask || !graphwarBackendAttemptIdentitiesAreEqual(message.context.attempt, pendingTask.attempt))
    ) {
      return;
    }
    options.onWasmFault?.(message);
    if (pendingTask) {
      void replayAfterWasmFault(pendingTask, message);
    } else {
      replayGenerationAsTypescript(
        message.generation,
        Math.max(message.generation + 1, backendConfiguration.generation + 1),
        `${message.fault.code}: ${message.fault.message}`,
      );
    }
  }

  /** Typed WASM faults keep the public task alive and rerun its owned request with TS. */
  async function replayAfterWasmFault(
    task: PendingPathfindingWorkerTask,
    message: Extract<GraphwarBackendControlMessage, { type: "wasm-fault" }>,
  ) {
    if (pendingTask !== task) {
      return;
    }
    replayGenerationAsTypescript(
      message.generation,
      Math.max(message.generation + 1, backendConfiguration.generation + 1),
      `${message.fault.code}: ${message.fault.message}`,
    );
  }

  /** 页面级 fuse 终止 master，并从当前 owned request 安装同一公开任务的 TS attempt。 */
  function replayGenerationAsTypescript(failedGeneration: number, fallbackGeneration: number, fallbackReason: string) {
    const admission = pendingAdmission;
    if (backendConfiguration.generation !== failedGeneration && admission?.backendGeneration !== failedGeneration) {
      return false;
    }
    const task = pendingTask;
    resetWorker();
    backendConfiguration = createGraphwarTypescriptWorkerBackendConfiguration(fallbackGeneration, fallbackReason);
    if (admission?.backendGeneration === failedGeneration) {
      startAdmission(admission, backendConfiguration);
    }
    if (!task || task.attempt.backendGeneration !== failedGeneration) {
      return true;
    }
    task.attempt = attemptGate.replaceAttempt(task.attempt, fallbackGeneration);
    task.backendExecution = backendConfiguration.backendExecution;
    try {
      const fallbackWorker = ensureWorker();
      if (!fallbackWorker) {
        rejectPendingTask(new Error("Graphwar pathfinding worker is unavailable"));
        return;
      }
      fallbackWorker.postMessage(cloneGraphwarPathfindingWorkerRequest({ ...task.request, attempt: task.attempt }));
    } catch (error) {
      rejectPendingTask(error instanceof Error ? error : new Error(String(error)));
    }
    return true;
  }

  /** 将当前请求的畸形消息作为协议错误拒绝，并丢弃不可信 Worker。 */
  function rejectPendingProtocolResponse() {
    rejectPendingTask(new Error("Graphwar pathfinding worker returned an invalid response"));
  }

  /** 统一拒绝挂起任务并丢弃当前 Worker。 */
  function rejectPendingTask(error: Error) {
    if (!pendingTask) {
      return;
    }
    attemptGate.cancelOuterTask(pendingTask.attempt);
    pendingTask.reject(error);
    pendingTask = undefined;
    resetWorker();
  }

  /** 若任务运行期间有配置换代，成功/失败响应发回页面后立即释放旧 Worker cache。 */
  function resetWorkerIfCacheInvalidated() {
    if (!shouldResetWorkerAfterCurrentTask) {
      return;
    }
    resetWorker();
  }

  /** 终止当前 Worker；下一次寻路会重新懒创建。 */
  function resetWorker() {
    shouldResetWorkerAfterCurrentTask = false;
    const activeWorker = worker;
    if (!activeWorker) {
      return;
    }
    worker = undefined;
    cleanupWorkerListeners?.();
    cleanupWorkerListeners = undefined;
    workerBackendSlot = undefined;
    activeWorker.terminate();
  }

  return {
    buildOneClickClearDagEdges,
    buildOneClickClearPath,
    cancel,
    clearCache,
    close,
    findSmartPath,
    findRoute,
    replayGenerationAsTypescript,
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

/** PostMessage 不能克隆 Vue reactive proxy；runner 边界统一复制成纯数据。 */
function cloneGraphwarPathfindingWorkerRequest(
  request: GraphwarPathfindingWorkerRequest,
): GraphwarPathfindingWorkerRequest {
  const clonedRequest = cloneGraphwarPathfindingWorkerRequestWithoutAttempt(request);
  const task =
    clonedRequest.task.type === "build-one-click-clear-path"
      ? {
          ...clonedRequest.task,
          input: {
            ...clonedRequest.task.input,
            wasmRequestNonce: createGraphwarWasmRequestNonce(request.attempt, request.id),
          },
        }
      : clonedRequest.task;
  return {
    attempt: cloneGraphwarBackendAttemptIdentity(request.attempt),
    id: clonedRequest.id,
    task,
  };
}

/** 在任何异步 backend 等待前拥有完整 request，attempt 仅在真正开始时附加。 */
function cloneGraphwarPathfindingWorkerRequestWithoutAttempt(
  request: Omit<GraphwarPathfindingWorkerRequest, "attempt">,
): Omit<GraphwarPathfindingWorkerRequest, "attempt"> {
  if (request.task.type === "find-route") {
    return {
      id: request.id,
      task: {
        input: cloneGraphwarPathfindingRouteInput(request.task.input),
        type: "find-route",
      },
    };
  }
  if (request.task.type === "find-smart-path") {
    return {
      id: request.id,
      task: {
        ...(request.task.shouldCollectDiagnostics ? { shouldCollectDiagnostics: true as const } : {}),
        input: cloneGraphwarSmartPathfindingPathInput(request.task.input),
        type: "find-smart-path",
      },
    };
  }
  if (request.task.type === "build-one-click-clear-dag-edges") {
    return {
      id: request.id,
      task: {
        input: cloneGraphwarOneClickClearDagEdgeBuildRequest(request.task.input),
        type: "build-one-click-clear-dag-edges",
      },
    };
  }

  return {
    id: request.id,
    task: {
      ...(request.task.shouldCollectDiagnostics ? { shouldCollectDiagnostics: true as const } : {}),
      input: cloneGraphwarOneClickClearPathWorkerInput(request.task.input),
      shouldReportIncumbents: request.task.shouldReportIncumbents,
      type: "build-one-click-clear-path",
    },
  };
}

function normalizeError(error: unknown, fallbackMessage: string) {
  return error instanceof Error ? error : new Error(error === undefined ? fallbackMessage : String(error));
}

/** Copies attempt identity without retaining a reactive or caller-owned object. */
function cloneGraphwarBackendAttemptIdentity(attempt: GraphwarBackendAttemptIdentity): GraphwarBackendAttemptIdentity {
  return {
    attemptId: attempt.attemptId,
    backendGeneration: attempt.backendGeneration,
    outerTaskId: attempt.outerTaskId,
  };
}

/** Own binary replay inputs at task admission; later caller mutations cannot alter a cold replay. */
function cloneUint8Array(value: Uint8Array) {
  return new Uint8Array(value);
}

/** 复制普通几何路由输入；大型 mask 保留引用，交由 structured clone 复制。 */
function cloneGraphwarPathfindingRouteInput(input: GraphwarPathfindingRouteInput): GraphwarPathfindingRouteInput {
  return {
    boundaryExpansion: input.boundaryExpansion,
    bounds: cloneGraphBounds(input.bounds),
    boundsRect: cloneBoundsRect(input.boundsRect),
    isPreviewEnabled: input.isPreviewEnabled,
    routeMask: cloneUint8Array(input.routeMask),
    routeMaskCacheId: input.routeMaskCacheId,
    routeMode: input.routeMode,
    routeTolerancePlanePixels: input.routeTolerancePlanePixels,
    startPoint: clonePixelPoint(input.startPoint),
    targetPoint: clonePixelPoint(input.targetPoint),
  };
}

/** 复制完整智能寻路输入，隔离页面响应式对象。 */
function cloneGraphwarSmartPathfindingPathInput(
  input: GraphwarSmartPathfindingPathInput,
): GraphwarSmartPathfindingPathInput {
  return {
    boundaryExpansion: input.boundaryExpansion,
    bounds: cloneGraphBounds(input.bounds),
    boundsRect: cloneBoundsRect(input.boundsRect),
    isDeleteOptimizationEnabled: input.isDeleteOptimizationEnabled,
    hitTarget: cloneGraphwarTrajectoryTargetCircle(input.hitTarget),
    isPreviewEnabled: input.isPreviewEnabled,
    routeMaskCacheId: input.routeMaskCacheId,
    routeMode: input.routeMode,
    routeObstacleMask: cloneUint8Array(input.routeObstacleMask),
    routeTolerancePlanePixels: input.routeTolerancePlanePixels,
    settings: cloneGraphwarTrajectoryFormulaSettings(input.settings),
    simulationBoundaryExpansion: input.simulationBoundaryExpansion,
    ...(input.simulationMask ? { simulationMask: cloneUint8Array(input.simulationMask) } : {}),
    simulationMaskCacheId: input.simulationMaskCacheId,
    sourcePath: input.sourcePath.map(clonePixelPoint),
    ...(input.prefixTarget ? { prefixTarget: cloneGraphwarTrajectoryTargetCircle(input.prefixTarget) } : {}),
    targetPoint: clonePixelPoint(input.targetPoint),
  };
}

/** 复制 DAG 建边批次及其精简公式设置。 */
function cloneGraphwarOneClickClearDagEdgeBuildRequest(
  input: GraphwarOneClickClearDagEdgeBuildRequest,
): GraphwarOneClickClearDagEdgeBuildRequest {
  return {
    boundaryExpansion: input.boundaryExpansion,
    bounds: cloneGraphBounds(input.bounds),
    boundsRect: cloneBoundsRect(input.boundsRect),
    jobs: input.jobs.map((job) =>
      job.type === "step-stateful"
        ? {
            from: job.from,
            id: job.id,
            startPoint: clonePixelPoint(job.startPoint),
            stepRouteStartState: {
              resolvedStateKey: job.stepRouteStartState.resolvedStateKey,
              resolvedY: job.stepRouteStartState.resolvedY,
            },
            targetPoint: clonePixelPoint(job.targetPoint),
            to: job.to,
            type: job.type,
          }
        : {
            from: job.from,
            id: job.id,
            startPoint: clonePixelPoint(job.startPoint),
            targetPoint: clonePixelPoint(job.targetPoint),
            to: job.to,
            type: job.type,
          },
    ),
    routeMask: cloneUint8Array(input.routeMask),
    routeOriginPoint: clonePixelPoint(input.routeOriginPoint),
    routeMode: input.routeMode,
    routeTolerancePlanePixels: input.routeTolerancePlanePixels,
    settings: {
      algorithm: input.settings.algorithm,
      decimalPlaces: input.settings.decimalPlaces,
      equation: input.settings.equation,
      ...(input.settings.formulaPathSteepness === undefined
        ? {}
        : { formulaPathSteepness: input.settings.formulaPathSteepness }),
      steepness: input.settings.steepness,
    },
    workerCount: input.workerCount,
  };
}

/** 复制完整一键清图输入，保留 mask buffer 并深复制小型结构。 */
function cloneGraphwarOneClickClearPathWorkerInput(
  input: GraphwarOneClickClearPathWorkerInput,
): GraphwarOneClickClearPathWorkerInput {
  return {
    boundaryExpansion: input.boundaryExpansion,
    bounds: cloneGraphBounds(input.bounds),
    boundsRect: cloneBoundsRect(input.boundsRect),
    candidates: input.candidates.map(cloneGraphwarOneClickClearCandidate),
    dagEdgeWorkerCount: input.dagEdgeWorkerCount,
    isDeleteOptimizationEnabled: input.isDeleteOptimizationEnabled,
    deleteHitCheckRadiusPixels: input.deleteHitCheckRadiusPixels,
    hitCandidates: input.hitCandidates.map(cloneGraphwarOneClickClearCandidate),
    pathPoints: input.pathPoints.map(clonePixelPoint),
    ...(input.prefixTarget ? { prefixTarget: cloneGraphwarTrajectoryTargetCircle(input.prefixTarget) } : {}),
    routeMaskCacheId: input.routeMaskCacheId,
    routeMode: input.routeMode,
    routeObstacleMask: cloneUint8Array(input.routeObstacleMask),
    routeTolerancePlanePixels: input.routeTolerancePlanePixels,
    ...(input.wasmRequestNonce === undefined ? {} : { wasmRequestNonce: input.wasmRequestNonce }),
    settings: cloneGraphwarTrajectoryFormulaSettings(input.settings),
    simulationBoundaryExpansion: input.simulationBoundaryExpansion,
    ...(input.simulationMask ? { simulationMask: cloneUint8Array(input.simulationMask) } : {}),
    simulationMaskCacheId: input.simulationMaskCacheId,
  };
}

/** 复制一键清图候选目标，避免命中圆携带页面代理。 */
function cloneGraphwarOneClickClearCandidate(candidate: GraphwarOneClickClearPathWorkerInput["candidates"][number]) {
  return {
    isEnemy: candidate.isEnemy,
    hitCenter: clonePixelPoint(candidate.hitCenter),
    hitRadius: candidate.hitRadius,
    id: candidate.id,
  };
}

/** 将轨迹目标圆复制成可结构化克隆的纯数据。 */
function cloneGraphwarTrajectoryTargetCircle(
  target:
    | GraphwarSmartPathfindingPathInput["hitTarget"]
    | NonNullable<GraphwarOneClickClearPathWorkerInput["prefixTarget"]>,
) {
  return {
    center: clonePixelPoint(target.center),
    radius: target.radius,
  };
}

/** 复制公式采样设置，并保持可选邪道障碍 mask 的原始二进制引用。 */
function cloneGraphwarTrajectoryFormulaSettings(
  settings: GraphwarSmartPathfindingPathInput["settings"] | GraphwarOneClickClearPathWorkerInput["settings"],
) {
  return {
    algorithm: settings.algorithm,
    decimalPlaces: settings.decimalPlaces,
    equation: settings.equation,
    ...(settings.secondOrderLaunchAngleMode === undefined
      ? {}
      : { secondOrderLaunchAngleMode: settings.secondOrderLaunchAngleMode }),
    ...(settings.formulaPathSteepness === undefined ? {} : { formulaPathSteepness: settings.formulaPathSteepness }),
    steepness: settings.steepness,
    isStepGlitchModeEnabled: settings.isStepGlitchModeEnabled,
    ...(settings.stepGlitchObstacleMask
      ? { stepGlitchObstacleMask: cloneUint8Array(settings.stepGlitchObstacleMask) }
      : {}),
    isStepOverflowProtectionEnabled: settings.isStepOverflowProtectionEnabled,
  };
}

/** 将 Graphwar 坐标范围复制成纯数据。 */
function cloneGraphBounds(bounds: GraphwarPathfindingRouteInput["bounds"]) {
  return {
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    minX: bounds.minX,
    minY: bounds.minY,
  };
}

/** 将截图边界矩形复制成纯数据。 */
function cloneBoundsRect(boundsRect: GraphwarPathfindingRouteInput["boundsRect"]) {
  return {
    height: boundsRect.height,
    width: boundsRect.width,
    x: boundsRect.x,
    y: boundsRect.y,
  };
}
