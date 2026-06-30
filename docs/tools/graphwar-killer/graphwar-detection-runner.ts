/** 主线程侧 Graphwar 截图识别 runner，集中管理 Worker 生命周期、取消和同步 fallback。 */
import { detectGraphwarObjectsInBounds, detectGraphwarPlayArea } from "./graphwar-detection";
import type { GraphwarObjectsDetectionResult } from "./graphwar-detection";
import type {
  GraphwarAutoDetectionInput,
  GraphwarAutoDetectionResult,
  GraphwarBoundsDetectionInput,
  GraphwarDetectionWorkerRequest,
  GraphwarDetectionWorkerResponse,
  GraphwarDetectionWorkerStage,
  GraphwarDetectionWorkerSuccessResponse,
} from "./graphwar-detection-worker-types";

export type { GraphwarDetectionWorkerStage };

/** 检测任务被用户取消或新任务替代。 */
export class GraphwarDetectionCancelledError extends Error {
  constructor() {
    super("Graphwar detection cancelled");
    this.name = "GraphwarDetectionCancelledError";
  }
}

export function isGraphwarDetectionCancelledError(error: unknown) {
  return error instanceof GraphwarDetectionCancelledError;
}

export interface GraphwarDetectionRunOptions {
  /** Worker 进入耗时阶段时通知页面更新状态。 */
  onStage?: (stage: GraphwarDetectionWorkerStage) => void;
}

interface PendingWorkerTask {
  id: number;
  onStage?: (stage: GraphwarDetectionWorkerStage) => void;
  reject: (reason?: unknown) => void;
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

    worker = new Worker(new URL("./graphwar-detection.worker.ts", import.meta.url), {
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
  const edgeRect = detectGraphwarPlayArea(input.imageData);
  if (!edgeRect) {
    return { edgeRect: undefined };
  }

  options?.onStage?.("detecting-objects");
  return {
    edgeRect,
    objects: detectGraphwarObjectsInBounds(input.imageData, edgeRect, input.thresholds),
  };
}

function detectObjectsInBoundsSynchronously(
  input: GraphwarBoundsDetectionInput,
  options?: GraphwarDetectionRunOptions,
) {
  options?.onStage?.("detecting-objects");
  return detectGraphwarObjectsInBounds(input.imageData, input.edgeRect, input.thresholds);
}

function collectRequestTransferList(request: GraphwarDetectionWorkerRequest) {
  const buffer = request.task.imageData.data.buffer;
  return buffer instanceof ArrayBuffer ? [buffer] : [];
}
