/** 主线程侧 Graphwar 截图识别 runner，集中管理 Worker 生命周期、取消和同步 fallback。 */
import {
  createGraphwarTypescriptWorkerBackendConfiguration,
  graphwarBackendAttemptIdentitiesAreEqual,
  isGraphwarBackendControlMessage,
  type GraphwarBackendAttemptIdentity,
  type GraphwarBackendControlMessage,
  type GraphwarWorkerBackendConfiguration,
  GraphwarWasmFault,
} from "../../core/algorithm-backend";
import { createGraphwarBackendAttemptGate } from "../../core/backend-attempt";
import { createGraphwarWorkerBackendSlot } from "../../core/worker-backend";
import { detectGraphwarObjectsInBounds, detectGraphwarPlayArea } from "../objects";
import type {
  GraphwarObjectDetectionInstrumentation,
  GraphwarObjectDetectionStage,
  GraphwarObjectsDetectionResult,
} from "../objects";
import type {
  GraphwarAutoDetectionInput,
  GraphwarAutoDetectionResult,
  GraphwarBoundsDetectionInput,
  GraphwarBoundsOnlyDetectionInput,
  GraphwarBoundsOnlyDetectionResult,
  GraphwarDetectionWorkerRequest,
  GraphwarDetectionWorkerResponse,
  GraphwarDetectionWorkerStage,
  GraphwarDetectionWorkerSuccessResponse,
  GraphwarDetectionWorkerTimingDetail,
  GraphwarDetectionWorkerTimingEntry,
} from "./protocol";
import { measureDetectionStage } from "./timing";

export type { GraphwarDetectionWorkerStage };
export type { GraphwarDetectionWorkerTimingDetail };
export type { GraphwarDetectionWorkerTimingEntry };

/** 检测任务被用户取消或新任务替代。 */
export class GraphwarDetectionCancelledError extends Error {
  constructor() {
    super("Graphwar detection cancelled");
    this.name = "GraphwarDetectionCancelledError";
  }
}

/** 判断错误是否只是检测任务被取消，页面不应当展示为失败。 */
export function isGraphwarDetectionCancelledError(error: unknown) {
  return error instanceof GraphwarDetectionCancelledError;
}

/** 单次检测运行时的页面回调。 */
export interface GraphwarDetectionRunOptions {
  /** Worker 进入耗时阶段时通知页面更新状态。 */
  onStage?: (stage: GraphwarDetectionWorkerStage) => void;
  /** Worker 或同步 fallback 完成后返回各识别阶段的准确耗时。 */
  onTimings?: (timings: readonly GraphwarDetectionWorkerTimingEntry[]) => void;
}

/** 当前权威 detection outer task；Worker 与同步 fallback 共用同一 commit gate。 */
interface PendingDetectionTask {
  /** 当前 outer task 中唯一可提交的 backend attempt。 */
  attempt: GraphwarBackendAttemptIdentity;
  /** 发送给 Worker 的请求 id。 */
  id: number;
  /** Worker 阶段通知回调。 */
  onStage?: (stage: GraphwarDetectionWorkerStage) => void;
  /** Worker 完成后的阶段耗时回调。 */
  onTimings?: (timings: readonly GraphwarDetectionWorkerTimingEntry[]) => void;
  /** Promise 失败回调。 */
  reject: (reason?: unknown) => void;
  /** Promise 成功回调。 */
  resolve: (value: GraphwarDetectionWorkerSuccessResponse["result"]) => void;
  /** 当前请求的任务类型；成功响应必须与它一致。 */
  taskType: GraphwarDetectionWorkerRequest["task"]["type"];
}

/** Detection main Worker 与 nested template Worker 共用的 backend 生命周期注入点。 */
export interface GraphwarDetectionRunnerOptions {
  backendConfiguration?: GraphwarWorkerBackendConfiguration;
  onWasmFault?: (message: Extract<GraphwarBackendControlMessage, { type: "wasm-fault" }>) => void;
}

/** 创建页面可复用的检测 runner。 */
export function createGraphwarDetectionRunner(options: GraphwarDetectionRunnerOptions = {}) {
  const attemptGate = createGraphwarBackendAttemptGate();
  const backendConfiguration = options.backendConfiguration ?? createGraphwarTypescriptWorkerBackendConfiguration(0);
  let worker: Worker | undefined;
  let workerBackendSlot: ReturnType<typeof createGraphwarWorkerBackendSlot> | undefined;
  let nextRequestId = 1;
  let pendingTask: PendingDetectionTask | undefined;

  /** 懒创建检测 Worker；不支持 Worker 的环境会走同步 fallback。 */
  function ensureWorker() {
    if (typeof Worker === "undefined") {
      return undefined;
    }
    if (worker) {
      return worker;
    }

    const createdWorker = new Worker(new URL("../../workers/detection/main.worker.ts", import.meta.url), {
      name: "graphwar-detection",
      type: "module",
    });
    worker = createdWorker;
    createdWorker.addEventListener(
      "message",
      (event: MessageEvent<GraphwarBackendControlMessage | GraphwarDetectionWorkerResponse>) => {
        handleWorkerMessage(createdWorker, event);
      },
    );
    createdWorker.addEventListener("messageerror", () => {
      rejectPendingTaskFromWorker(
        createdWorker,
        new Error("Graphwar detection worker message could not be deserialized"),
      );
    });
    createdWorker.addEventListener("error", (event: ErrorEvent) => {
      rejectPendingTaskFromWorker(createdWorker, event.error instanceof Error ? event.error : new Error(event.message));
    });
    let initializationError: Error | undefined;
    const createdBackendSlot = createGraphwarWorkerBackendSlot({
      configuration: backendConfiguration,
      onInfrastructureFailure: (error) => {
        if (workerBackendSlot) {
          rejectPendingTaskFromWorker(createdWorker, error);
        } else {
          initializationError = error;
        }
      },
      onWasmFault: (message) => {
        if (workerBackendSlot) {
          handleWasmFaultFromWorker(createdWorker, message);
        } else {
          options.onWasmFault?.(message);
          initializationError = new GraphwarWasmFault(message.fault.code, message.fault.message);
        }
      },
      role: "detection-main",
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

  /** 执行自动检测流程，先识别坐标系边界，再在边界内识别对象。 */
  function detectAuto(input: GraphwarAutoDetectionInput, options?: GraphwarDetectionRunOptions) {
    cancel();
    const activeWorker = ensureWorker();
    return runDetectionTask<GraphwarAutoDetectionResult>(
      activeWorker,
      {
        imageData: input.imageData,
        soldierSettings: input.soldierSettings,
        thresholds: input.thresholds,
        type: "detect-auto",
      },
      options,
      (onStage) => detectAutoSynchronously(input, onStage),
    );
  }

  /** 只识别坐标系边界，供手动“识别边界”按钮使用。 */
  function detectBounds(input: GraphwarBoundsOnlyDetectionInput, options?: GraphwarDetectionRunOptions) {
    cancel();
    const activeWorker = ensureWorker();
    return runDetectionTask<GraphwarBoundsOnlyDetectionResult>(
      activeWorker,
      {
        imageData: input.imageData,
        type: "detect-bounds-only",
      },
      options,
      (onStage) => detectBoundsSynchronously(input, onStage),
    );
  }

  /** 执行已知边界内的对象识别，复用自动检测的 Worker 管线。 */
  function detectObjectsInBounds(input: GraphwarBoundsDetectionInput, options?: GraphwarDetectionRunOptions) {
    cancel();
    const activeWorker = ensureWorker();
    return runDetectionTask<GraphwarObjectsDetectionResult>(
      activeWorker,
      {
        edgeRect: input.edgeRect,
        imageData: input.imageData,
        soldierSettings: input.soldierSettings,
        thresholds: input.thresholds,
        type: "detect-bounds",
      },
      options,
      (onStage) => detectObjectsInBoundsSynchronously(input, onStage),
    );
  }

  /** 为一次公开检测建立稳定 outer task，并安装当前唯一 TypeScript attempt。 */
  function runDetectionTask<TResult extends GraphwarDetectionWorkerSuccessResponse["result"]>(
    activeWorker: Worker | undefined,
    taskInput: GraphwarDetectionWorkerRequest["task"],
    options: GraphwarDetectionRunOptions | undefined,
    runSynchronously: (onStage: (stage: GraphwarDetectionWorkerStage) => void) => {
      result: TResult;
      timings: readonly GraphwarDetectionWorkerTimingEntry[];
    },
  ) {
    const request: GraphwarDetectionWorkerRequest = {
      attempt: attemptGate.beginOuterTask(backendConfiguration.generation),
      id: nextRequestId,
      task: taskInput,
    };
    nextRequestId += 1;
    if (!activeWorker) {
      try {
        const completed = runSynchronously((stage) => {
          if (attemptGate.canCommit(request.attempt)) {
            options?.onStage?.(stage);
          }
        });
        attemptGate.completeOuterTask(request.attempt);
        options?.onTimings?.(completed.timings);
        return Promise.resolve(completed.result);
      } catch (error) {
        if (attemptGate.canCommit(request.attempt)) {
          attemptGate.completeOuterTask(request.attempt);
        }
        throw error;
      }
    }
    return new Promise<TResult>((resolve, reject) => {
      const task: PendingDetectionTask = {
        attempt: request.attempt,
        id: request.id,
        onStage: options?.onStage,
        onTimings: options?.onTimings,
        reject,
        resolve: resolve as PendingDetectionTask["resolve"],
        taskType: request.task.type,
      };
      pendingTask = task;
      try {
        const cloneableRequest = cloneGraphwarDetectionWorkerRequest(request);
        const imageBuffer = cloneableRequest.task.imageData.data.buffer;
        activeWorker.postMessage(cloneableRequest, imageBuffer instanceof ArrayBuffer ? [imageBuffer] : []);
      } catch (error) {
        completeTask(task, () => task.reject(error));
      }
    });
  }

  /** 取消当前检测并丢弃 Worker，避免旧任务继续占用资源或回写状态。 */
  function cancel() {
    const task = pendingTask;
    if (!task) {
      return;
    }

    cancelTask(task, () => task.reject(new GraphwarDetectionCancelledError()));
    resetWorker();
  }

  /** 关闭 runner 时释放 Worker，并让挂起任务按取消处理。 */
  function close() {
    cancel();
    resetWorker();
  }

  /** 只接收当前 request id、attempt 和 commit gate 都仍权威的 Worker 消息。 */
  function handleWorkerMessage(
    sourceWorker: Worker,
    event: MessageEvent<GraphwarBackendControlMessage | GraphwarDetectionWorkerResponse>,
  ) {
    if (worker !== sourceWorker) {
      return;
    }
    if (isGraphwarBackendControlMessage(event.data)) {
      if (event.data.role === "detection-main") {
        workerBackendSlot?.handleMessage(event.data);
      } else if (event.data.role === "detection-template" && event.data.type === "wasm-fault") {
        handleWasmFaultFromWorker(sourceWorker, event.data);
      } else {
        rejectPendingTaskFromWorker(sourceWorker, new Error("Detection Worker returned invalid backend control"));
      }
      return;
    }
    const task = pendingTask;
    if (!task) {
      return;
    }
    const response = event.data;
    if (response.id !== task.id || !graphwarBackendAttemptIdentitiesAreEqual(response.attempt, task.attempt)) {
      // Backend replacement 会沿用 outer task；旧 attempt 的迟到消息只作废，不能使新 attempt 失败。
      return;
    }
    if (response.type === "stage") {
      publishStage(task, response.stage);
      return;
    }

    if (response.type === "error") {
      completeTask(task, () => task.reject(new Error(response.message)));
      return;
    }
    if (response.taskType !== task.taskType) {
      completeTask(task, () => task.reject(new Error("Detection Worker returned a mismatched task result")));
      return;
    }
    completeTask(task, () => {
      try {
        task.onTimings?.(response.timings);
      } catch (error) {
        task.reject(error);
        return;
      }
      task.resolve(response.result);
    });
  }

  /** Root 或 nested Worker 的 typed fault 直接通知页面 fuse，不进入 detection infrastructure fallback。 */
  function handleWasmFaultFromWorker(
    sourceWorker: Worker,
    message: Extract<GraphwarBackendControlMessage, { type: "wasm-fault" }>,
  ) {
    if (worker !== sourceWorker) {
      return;
    }
    options.onWasmFault?.(message);
    const task = pendingTask;
    if (task) {
      completeTask(task, () => task.reject(new GraphwarWasmFault(message.fault.code, message.fault.message)));
    }
    resetWorker();
  }

  /** 统一拒绝挂起任务并丢弃当前 Worker。 */
  function rejectPendingTask(error: Error) {
    const task = pendingTask;
    if (!task) {
      return;
    }
    completeTask(task, () => task.reject(error));
    resetWorker();
  }

  /** 迟到的旧 Worker 基础设施事件不得使当前 outer task 失败。 */
  function rejectPendingTaskFromWorker(sourceWorker: Worker, error: Error) {
    if (worker === sourceWorker) {
      rejectPendingTask(error);
    }
  }

  /** 只向当前 attempt 发布非终态阶段事件。 */
  function publishStage(task: PendingDetectionTask, stage: GraphwarDetectionWorkerStage) {
    if (isCurrentTask(task)) {
      task.onStage?.(stage);
    }
  }

  /** 当前 pending task、完整 attempt 与 generation gate 必须同时仍权威。 */
  function isCurrentTask(task: PendingDetectionTask) {
    return pendingTask === task && attemptGate.canCommit(task.attempt);
  }

  /** 先关闭 commit gate，再原子发布 timing/result 或终端 error。 */
  function completeTask(task: PendingDetectionTask, callback: () => void) {
    if (!isCurrentTask(task)) {
      return;
    }
    attemptGate.completeOuterTask(task.attempt);
    pendingTask = undefined;
    callback();
  }

  /** 用户取消或输入替换先撤销 outer task，再结算取消 Promise。 */
  function cancelTask(task: PendingDetectionTask, callback: () => void) {
    if (!isCurrentTask(task)) {
      return;
    }
    attemptGate.cancelOuterTask(task.attempt);
    pendingTask = undefined;
    callback();
  }

  /** 终止当前 Worker；下一次检测会重新懒创建。 */
  function resetWorker() {
    if (!worker) {
      return;
    }
    worker.terminate();
    worker = undefined;
    workerBackendSlot = undefined;
  }

  return {
    cancel,
    close,
    detectAuto,
    detectBounds,
    detectObjectsInBounds,
  };
}

/** 在无 Worker 环境中同步执行完整自动检测，并保留阶段耗时回调。 */
function detectAutoSynchronously(
  input: GraphwarAutoDetectionInput,
  onStage: (stage: GraphwarDetectionWorkerStage) => void,
): { result: GraphwarAutoDetectionResult; timings: readonly GraphwarDetectionWorkerTimingEntry[] } {
  onStage("detecting-bounds");
  const timings: GraphwarDetectionWorkerTimingEntry[] = [];
  const edgeRect = measureDetectionStage(timings, "detecting-bounds", () => detectGraphwarPlayArea(input.imageData));
  if (!edgeRect) {
    return { result: { edgeRect: undefined }, timings };
  }

  onStage("detecting-objects");
  const objects = detectGraphwarObjectsInBounds(
    input.imageData,
    edgeRect,
    input.thresholds,
    input.soldierSettings,
    createObjectDetectionInstrumentation(timings),
  );
  return {
    result: {
      edgeRect,
      objects,
    },
    timings,
  };
}

/** 在无 Worker 环境中同步执行边界识别。 */
function detectBoundsSynchronously(
  input: GraphwarBoundsOnlyDetectionInput,
  onStage: (stage: GraphwarDetectionWorkerStage) => void,
): { result: GraphwarBoundsOnlyDetectionResult; timings: readonly GraphwarDetectionWorkerTimingEntry[] } {
  onStage("detecting-bounds");
  const timings: GraphwarDetectionWorkerTimingEntry[] = [];
  const edgeRect = measureDetectionStage(timings, "detecting-bounds", () => detectGraphwarPlayArea(input.imageData));
  return { result: { edgeRect }, timings };
}

/** 在无 Worker 环境中同步执行边界内对象检测。 */
function detectObjectsInBoundsSynchronously(
  input: GraphwarBoundsDetectionInput,
  onStage: (stage: GraphwarDetectionWorkerStage) => void,
) {
  onStage("detecting-objects");
  const timings: GraphwarDetectionWorkerTimingEntry[] = [];
  return {
    result: detectGraphwarObjectsInBounds(
      input.imageData,
      input.edgeRect,
      input.thresholds,
      input.soldierSettings,
      createObjectDetectionInstrumentation(timings),
    ),
    timings,
  };
}

/** 复制 Worker 请求外壳；ImageData 应保留原对象，以便继续转移原始 buffer。 */
function cloneGraphwarDetectionWorkerRequest(request: GraphwarDetectionWorkerRequest): GraphwarDetectionWorkerRequest {
  if (request.task.type === "detect-bounds-only") {
    return {
      attempt: request.attempt,
      id: request.id,
      task: {
        imageData: request.task.imageData,
        type: "detect-bounds-only",
      },
    };
  }

  const soldierSettings = request.task.soldierSettings;
  const cloneableSharedInput = {
    imageData: request.task.imageData,
    soldierSettings: soldierSettings
      ? {
          candidateTopRatio: soldierSettings.candidateTopRatio,
          maximumSoldierCount: soldierSettings.maximumSoldierCount,
          templateMatchingWorkerCount: soldierSettings.templateMatchingWorkerCount,
        }
      : undefined,
    thresholds: {
      minArea: request.task.thresholds.minArea,
    },
  };

  if (request.task.type === "detect-auto") {
    return {
      attempt: request.attempt,
      id: request.id,
      task: {
        ...cloneableSharedInput,
        type: "detect-auto",
      },
    };
  }

  return {
    attempt: request.attempt,
    id: request.id,
    task: {
      ...cloneableSharedInput,
      edgeRect: {
        height: request.task.edgeRect.height,
        width: request.task.edgeRect.width,
        x: request.task.edgeRect.x,
        y: request.task.edgeRect.y,
      },
      type: "detect-bounds",
    },
  };
}

/** 将对象识别内部阶段计时接入 Worker timing 列表。 */
function createObjectDetectionInstrumentation(
  timings: GraphwarDetectionWorkerTimingEntry[],
): GraphwarObjectDetectionInstrumentation {
  return {
    measureStage: <TResult>(stage: GraphwarObjectDetectionStage, task: () => TResult) =>
      measureDetectionStage(timings, stage, task),
  };
}
