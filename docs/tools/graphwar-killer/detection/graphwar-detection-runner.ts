/** 主线程侧 Graphwar 截图识别 runner，集中管理 Worker 生命周期、取消和同步 fallback。 */
import type { BoundsRect } from "../core/types";
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

  /** 懒创建检测 Worker；不支持 Worker 的环境会走同步 fallback。 */
  function ensureWorker() {
    if (typeof Worker === "undefined") {
      return undefined;
    }
    if (worker) {
      return worker;
    }

    worker = new Worker(new URL("../workers/graphwar-detection.worker.ts", import.meta.url), {
      name: "graphwar-detection",
      type: "module",
    });
    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("messageerror", handleWorkerMessageError);
    worker.addEventListener("error", handleWorkerError);
    return worker;
  }

  /** 执行自动检测流程，先识别棋盘边界，再在边界内识别对象。 */
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

  /** 执行已知边界内的对象识别，复用自动检测的 Worker 管线。 */
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

  /** 发送单个 Worker 请求，并记录当前等待响应的任务。 */
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
        const cloneableRequest = cloneGraphwarDetectionWorkerRequest(request);
        activeWorker.postMessage(cloneableRequest, collectRequestTransferList(cloneableRequest));
      } catch (error) {
        pendingTask = undefined;
        reject(error);
      }
    });
  }

  /** 取消当前检测并重建 Worker，避免旧任务继续占用资源或回写状态。 */
  function cancel() {
    if (!pendingTask) {
      return;
    }

    pendingTask.reject(new GraphwarDetectionCancelledError());
    pendingTask = undefined;
    resetWorker();
  }

  /** 关闭 runner 时释放 Worker，并让挂起任务按取消处理。 */
  function close() {
    if (pendingTask) {
      pendingTask.reject(new GraphwarDetectionCancelledError());
      pendingTask = undefined;
    }
    resetWorker();
  }

  /** 只接收当前请求 id 对应的 Worker 消息，丢弃过期响应。 */
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

  /** 把 Worker 消息反序列化失败转换成当前任务失败。 */
  function handleWorkerMessageError() {
    rejectPendingTask(new Error("Graphwar detection worker message could not be deserialized"));
  }

  /** 把 Worker 运行时错误转换成当前任务失败。 */
  function handleWorkerError(event: ErrorEvent) {
    rejectPendingTask(event.error instanceof Error ? event.error : new Error(event.message));
  }

  /** 统一拒绝挂起任务并丢弃当前 Worker。 */
  function rejectPendingTask(error: Error) {
    if (!pendingTask) {
      return;
    }
    pendingTask.reject(error);
    pendingTask = undefined;
    resetWorker();
  }

  /** 终止当前 Worker；下一次检测会重新懒创建。 */
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

/** 在无 Worker 环境中同步执行完整自动检测，并保留阶段耗时回调。 */
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

/** 在无 Worker 环境中同步执行边界内对象检测。 */
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

/** 收集可转移的 ImageData buffer，避免主线程和 Worker 间复制大图。 */
function collectRequestTransferList(request: GraphwarDetectionWorkerRequest) {
  const buffer = request.task.imageData.data.buffer;
  return buffer instanceof ArrayBuffer ? [buffer] : [];
}

/** PostMessage 不能克隆 Vue reactive proxy；Worker 边界应统一复制成纯数据。 */
function cloneGraphwarDetectionWorkerRequest(request: GraphwarDetectionWorkerRequest): GraphwarDetectionWorkerRequest {
  const cloneableInput = {
    imageData: request.task.imageData,
    soldierSettings: cloneGraphwarSoldierDetectionSettings(request.task.soldierSettings),
    thresholds: cloneGraphwarObstacleDetectionThresholds(request.task.thresholds),
  };

  if (request.task.type === "detect-auto") {
    return {
      id: request.id,
      task: {
        ...cloneableInput,
        type: "detect-auto",
      },
    };
  }

  return {
    id: request.id,
    task: {
      ...cloneableInput,
      edgeRect: cloneBoundsRect(request.task.edgeRect),
      type: "detect-bounds",
    },
  };
}

function cloneGraphwarObstacleDetectionThresholds(
  thresholds: GraphwarAutoDetectionInput["thresholds"],
): GraphwarAutoDetectionInput["thresholds"] {
  return {
    minArea: thresholds.minArea,
  };
}

function cloneGraphwarSoldierDetectionSettings(
  settings: GraphwarAutoDetectionInput["soldierSettings"],
): GraphwarAutoDetectionInput["soldierSettings"] {
  if (!settings) {
    return undefined;
  }

  return {
    candidateTopRatio: settings.candidateTopRatio,
    maximumSoldierCount: settings.maximumSoldierCount,
    templateMatchingWorkerCount: settings.templateMatchingWorkerCount,
  };
}

function cloneBoundsRect(rect: BoundsRect): BoundsRect {
  return {
    height: rect.height,
    width: rect.width,
    x: rect.x,
    y: rect.y,
  };
}

/** 包装检测阶段计时，让同步 fallback 的调试数据和 Worker 结果一致。 */
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

/** 将对象识别内部阶段计时接入 worker timing 列表。 */
function createObjectDetectionInstrumentation(
  timings: GraphwarDetectionWorkerTimingEntry[],
): GraphwarObjectDetectionInstrumentation {
  return {
    measureStage: <TResult>(stage: GraphwarObjectDetectionStage, task: () => TResult) =>
      measureDetectionStage(timings, stage, task),
  };
}

/** 获取高精度时间戳，兼容没有 performance 的运行环境。 */
function nowMs() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
