/** 主线程侧 Graphwar 截图识别 runner，集中管理 Worker 生命周期、取消和同步 fallback。 */
import { detectGraphwarObjectsInBounds, detectGraphwarPlayArea } from "./graphwar-detection";
import type {
  GraphwarObjectDetectionInstrumentation,
  GraphwarObjectDetectionStage,
  GraphwarObjectsDetectionResult,
} from "./graphwar-detection";
import type {
  GraphwarAutoDetectionInput,
  GraphwarAutoDetectionResult,
  GraphwarBoundsDetectionInput,
  GraphwarDetectionWorkerRequest,
  GraphwarDetectionWorkerResponse,
  GraphwarDetectionWorkerStage,
  GraphwarDetectionWorkerSuccessResponse,
  GraphwarDetectionWorkerTimingDetail,
  GraphwarDetectionWorkerTimingEntry,
} from "./graphwar-detection-worker-types";

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

/** 当前等待 Worker 响应的主线程任务，用 request id 防止旧响应覆盖新结果。 */
interface PendingWorkerTask {
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
}

/** 创建页面可复用的检测 runner。 */
export function createGraphwarDetectionRunner() {
  let worker: Worker | undefined;
  let nextRequestId = 1;
  let pendingTask: PendingWorkerTask | undefined;

  function ensureWorker() {
    if (typeof Worker === "undefined") {
      return undefined;
    }
    if (worker) {
      return worker;
    }

    worker = new Worker(new URL("./workers/graphwar-detection.worker.ts", import.meta.url), {
      name: "graphwar-detection",
      type: "module",
    });
    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("messageerror", handleWorkerMessageError);
    worker.addEventListener("error", handleWorkerError);
    return worker;
  }

  function detectAuto(input: GraphwarAutoDetectionInput, options?: GraphwarDetectionRunOptions) {
    cancel();
    const activeWorker = ensureWorker();
    if (!activeWorker) {
      return Promise.resolve(detectAutoSynchronously(input, options));
    }
    return runWorkerTask<GraphwarAutoDetectionResult>(
      activeWorker,
      {
        id: nextRequestId,
        task: {
          imageData: input.imageData,
          soldierSettings: input.soldierSettings,
          thresholds: input.thresholds,
          type: "detect-auto",
        },
      },
      options,
    );
  }

  function detectObjectsInBounds(input: GraphwarBoundsDetectionInput, options?: GraphwarDetectionRunOptions) {
    cancel();
    const activeWorker = ensureWorker();
    if (!activeWorker) {
      return Promise.resolve(detectObjectsInBoundsSynchronously(input, options));
    }
    return runWorkerTask<GraphwarObjectsDetectionResult>(
      activeWorker,
      {
        id: nextRequestId,
        task: {
          edgeRect: input.edgeRect,
          imageData: input.imageData,
          soldierSettings: input.soldierSettings,
          thresholds: input.thresholds,
          type: "detect-bounds",
        },
      },
      options,
    );
  }

  function runWorkerTask<TResult>(
    activeWorker: Worker,
    request: GraphwarDetectionWorkerRequest,
    options?: GraphwarDetectionRunOptions,
  ) {
    nextRequestId += 1;
    return new Promise<TResult>((resolve, reject) => {
      pendingTask = {
        id: request.id,
        onStage: options?.onStage,
        onTimings: options?.onTimings,
        reject,
        resolve: resolve as PendingWorkerTask["resolve"],
      };
      try {
        activeWorker.postMessage(request, collectRequestTransferList(request));
      } catch (error) {
        pendingTask = undefined;
        reject(error);
      }
    });
  }

  function cancel() {
    if (!pendingTask) {
      return;
    }

    pendingTask.reject(new GraphwarDetectionCancelledError());
    pendingTask = undefined;
    resetWorker();
  }

  function close() {
    if (pendingTask) {
      pendingTask.reject(new GraphwarDetectionCancelledError());
      pendingTask = undefined;
    }
    resetWorker();
  }

  function handleWorkerMessage(event: MessageEvent<GraphwarDetectionWorkerResponse>) {
    const response = event.data;
    if (!pendingTask || response.id !== pendingTask.id) {
      return;
    }
    if (response.type === "stage") {
      pendingTask.onStage?.(response.stage);
      return;
    }

    const completedTask = pendingTask;
    pendingTask = undefined;
    if (response.type === "error") {
      completedTask.reject(new Error(response.message));
      return;
    }
    completedTask.onTimings?.(response.timings);
    completedTask.resolve(response.result);
  }

  function handleWorkerMessageError() {
    rejectPendingTask(new Error("Graphwar detection worker message could not be deserialized"));
  }

  function handleWorkerError(event: ErrorEvent) {
    rejectPendingTask(event.error instanceof Error ? event.error : new Error(event.message));
  }

  function rejectPendingTask(error: Error) {
    if (!pendingTask) {
      return;
    }
    pendingTask.reject(error);
    pendingTask = undefined;
    resetWorker();
  }

  function resetWorker() {
    if (!worker) {
      return;
    }
    worker.terminate();
    worker = undefined;
  }

  return {
    cancel,
    close,
    detectAuto,
    detectObjectsInBounds,
  };
}

function detectAutoSynchronously(
  input: GraphwarAutoDetectionInput,
  options?: GraphwarDetectionRunOptions,
): GraphwarAutoDetectionResult {
  options?.onStage?.("detecting-bounds");
  const timings: GraphwarDetectionWorkerTimingEntry[] = [];
  const edgeRect = measureDetectionStage(timings, "detecting-bounds", () => detectGraphwarPlayArea(input.imageData));
  if (!edgeRect) {
    options?.onTimings?.(timings);
    return { edgeRect: undefined };
  }

  options?.onStage?.("detecting-objects");
  const objects = detectGraphwarObjectsInBounds(
    input.imageData,
    edgeRect,
    input.thresholds,
    input.soldierSettings,
    createObjectDetectionInstrumentation(timings),
  );
  options?.onTimings?.(timings);
  return {
    edgeRect,
    objects,
  };
}

function detectObjectsInBoundsSynchronously(
  input: GraphwarBoundsDetectionInput,
  options?: GraphwarDetectionRunOptions,
) {
  options?.onStage?.("detecting-objects");
  const timings: GraphwarDetectionWorkerTimingEntry[] = [];
  const objects = detectGraphwarObjectsInBounds(
    input.imageData,
    input.edgeRect,
    input.thresholds,
    input.soldierSettings,
    createObjectDetectionInstrumentation(timings),
  );
  options?.onTimings?.(timings);
  return objects;
}

function collectRequestTransferList(request: GraphwarDetectionWorkerRequest) {
  const buffer = request.task.imageData.data.buffer;
  return buffer instanceof ArrayBuffer ? [buffer] : [];
}

function measureDetectionStage<TResult>(
  timings: GraphwarDetectionWorkerTimingEntry[],
  stage: GraphwarDetectionWorkerStage,
  task: () => TResult,
) {
  const startedAt = nowMs();
  try {
    return task();
  } finally {
    timings.push({
      elapsedMs: nowMs() - startedAt,
      stage,
    });
  }
}

function createObjectDetectionInstrumentation(
  timings: GraphwarDetectionWorkerTimingEntry[],
): GraphwarObjectDetectionInstrumentation {
  return {
    measureStage: <TResult>(stage: GraphwarObjectDetectionStage, task: () => TResult) =>
      measureDetectionStage(timings, stage, task),
  };
}

function nowMs() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
