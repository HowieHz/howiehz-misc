/** 主线程侧 Graphwar 几何寻路 runner，集中管理 Worker 生命周期和取消。 */
import type {
  GraphwarOneClickClearDagEdgeBuildRequest,
  GraphwarOneClickClearDagEdgeBuildResult,
} from "./graphwar-one-click-clear";
import type { GraphwarPathfindingPreview } from "./graphwar-pathfinding";
import type {
  GraphwarPathfindingRouteInput,
  GraphwarPathfindingRouteResult,
  GraphwarPathfindingWorkerRequest,
  GraphwarPathfindingWorkerResponse,
  GraphwarPathfindingWorkerSuccessResponse,
} from "./graphwar-pathfinding-worker-types";

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
  /** 普通智能寻路搜索动画快照。 */
  onPreview?: (preview: GraphwarPathfindingPreview) => void;
}

/** 当前等待 Worker 响应的主线程任务，用 request id 防止旧响应覆盖新结果。 */
interface PendingPathfindingWorkerTask {
  /** 发送给 Worker 的请求 id。 */
  id: number;
  /** 搜索动画回调；只有普通智能寻路会使用。 */
  onPreview?: (preview: GraphwarPathfindingPreview) => void;
  /** Promise 失败回调。 */
  reject: (reason?: unknown) => void;
  /** Promise 成功回调。 */
  resolve: (value: GraphwarPathfindingWorkerSuccessResponse["result"]) => void;
}

/** 创建页面可复用的几何寻路 runner。 */
export function createGraphwarPathfindingRunner() {
  let worker: Worker | undefined;
  let nextRequestId = 1;
  let pendingTask: PendingPathfindingWorkerTask | undefined;
  let resetWorkerAfterCurrentTask = false;

  /** 懒创建 master Worker；不支持 Worker 的环境由调用方按寻路失败处理。 */
  function ensureWorker() {
    if (typeof Worker === "undefined") {
      return undefined;
    }
    if (worker) {
      return worker;
    }

    worker = new Worker(new URL("./workers/graphwar-pathfinding.worker.ts", import.meta.url), {
      name: "graphwar-pathfinding",
      type: "module",
    });
    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("messageerror", handleWorkerMessageError);
    worker.addEventListener("error", handleWorkerError);
    return worker;
  }

  /** 在 master Worker 中执行普通智能寻路几何搜索。 */
  function findRoute(input: GraphwarPathfindingRouteInput, options?: GraphwarPathfindingRunOptions) {
    cancel();
    const activeWorker = ensureWorker();
    if (!activeWorker) {
      return Promise.reject(new Error("Graphwar pathfinding worker is unavailable"));
    }
    return runWorkerTask<GraphwarPathfindingRouteResult>(
      activeWorker,
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

  /** 在 master Worker 中建立一键清图 DAG 边。 */
  function buildOneClickClearDagEdges(input: GraphwarOneClickClearDagEdgeBuildRequest) {
    cancel();
    const activeWorker = ensureWorker();
    if (!activeWorker) {
      return Promise.reject(new Error("Graphwar pathfinding worker is unavailable"));
    }
    return runWorkerTask<GraphwarOneClickClearDagEdgeBuildResult>(activeWorker, {
      id: nextRequestId,
      task: {
        input,
        type: "build-one-click-clear-dag-edges",
      },
    });
  }

  /** 发送单个 Worker 请求，并记录当前等待响应的任务。 */
  function runWorkerTask<TResult>(
    activeWorker: Worker,
    request: GraphwarPathfindingWorkerRequest,
    options?: GraphwarPathfindingRunOptions,
  ) {
    nextRequestId += 1;
    return new Promise<TResult>((resolve, reject) => {
      pendingTask = {
        id: request.id,
        onPreview: options?.onPreview,
        reject,
        resolve: resolve as PendingPathfindingWorkerTask["resolve"],
      };
      try {
        activeWorker.postMessage(request);
      } catch (error) {
        pendingTask = undefined;
        reject(error);
      }
    });
  }

  /** 取消当前寻路并重建 Worker，避免旧任务继续占用 CPU。 */
  function cancel() {
    if (!pendingTask) {
      return;
    }

    pendingTask.reject(new GraphwarPathfindingCancelledError());
    pendingTask = undefined;
    resetWorker();
  }

  /** 让 master Worker 内部 cache 失效；忙碌时等当前任务收尾后重建。 */
  function clearCache() {
    if (pendingTask) {
      resetWorkerAfterCurrentTask = true;
      return;
    }
    resetWorker();
  }

  /** 关闭 runner 时释放 Worker，并让挂起任务按取消处理。 */
  function close() {
    if (pendingTask) {
      pendingTask.reject(new GraphwarPathfindingCancelledError());
      pendingTask = undefined;
    }
    resetWorker();
  }

  /** 只接收当前请求 id 对应的 Worker 消息，丢弃过期响应。 */
  function handleWorkerMessage(event: MessageEvent<GraphwarPathfindingWorkerResponse>) {
    const response = event.data;
    if (!pendingTask || response.id !== pendingTask.id) {
      return;
    }
    if (response.type === "preview") {
      pendingTask.onPreview?.(response.preview);
      return;
    }

    const completedTask = pendingTask;
    pendingTask = undefined;
    if (response.type === "error") {
      completedTask.reject(new Error(response.message));
      resetWorkerIfCacheInvalidated();
      return;
    }
    completedTask.resolve(response.result);
    resetWorkerIfCacheInvalidated();
  }

  /** 把 Worker 消息反序列化失败转换成当前任务失败。 */
  function handleWorkerMessageError() {
    rejectPendingTask(new Error("Graphwar pathfinding worker message could not be deserialized"));
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

  /** 若任务运行期间有配置换代，成功/失败响应发回页面后立即释放旧 Worker cache。 */
  function resetWorkerIfCacheInvalidated() {
    if (!resetWorkerAfterCurrentTask) {
      return;
    }
    resetWorker();
  }

  /** 终止当前 Worker；下一次寻路会重新懒创建。 */
  function resetWorker() {
    resetWorkerAfterCurrentTask = false;
    if (!worker) {
      return;
    }
    worker.terminate();
    worker = undefined;
  }

  return {
    buildOneClickClearDagEdges,
    cancel,
    clearCache,
    close,
    findRoute,
  };
}
