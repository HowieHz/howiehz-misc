/** 主线程侧 Graphwar 几何寻路 runner，集中管理 Worker 生命周期和取消。 */
import { clonePixelPoint } from "../../core/types";
import type {
  GraphwarOneClickClearDagEdgeBuildRequest,
  GraphwarOneClickClearDagEdgeBuildResult,
  GraphwarOneClickClearIncumbent,
} from "../one-click-clear/search";
import type { GraphwarPathfindingPreview } from "../routing/visibility-graph";
import { isGraphwarOneClickClearIncumbent, isGraphwarOneClickClearPathWorkerResult } from "./protocol";
import type {
  GraphwarOneClickClearPathWorkerInput,
  GraphwarOneClickClearPathWorkerResult,
  GraphwarPathfindingRouteInput,
  GraphwarPathfindingRouteResult,
  GraphwarPathfindingWorkerRequest,
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
  onIncumbent?: (incumbent: GraphwarOneClickClearIncumbent) => void;
  /** 普通智能寻路搜索动画快照。 */
  onPreview?: (preview: GraphwarPathfindingPreview) => void;
  /** 请求 Worker 返回调试计数器和自然边界耗时。 */
  shouldCollectDiagnostics?: boolean;
}

/** 当前等待 Worker 响应的主线程任务，用 request id 防止旧响应覆盖新结果。 */
interface PendingPathfindingWorkerTask {
  /** 发送给 Worker 的请求 id。 */
  id: number;
  /** 搜索动画回调；只有普通智能寻路会使用。 */
  onPreview?: (preview: GraphwarPathfindingPreview) => void;
  /** 一键清图当前最优方案回调；请求取消或换代后不会再调用。 */
  onIncumbent?: (incumbent: GraphwarOneClickClearIncumbent) => void;
  /** Promise 失败回调。 */
  reject: (reason?: unknown) => void;
  /** Promise 成功回调。 */
  resolve: (value: GraphwarPathfindingWorkerSuccessResponse["result"]) => void;
  /** 当前请求任务类型，用于拒绝错配的成功和进度消息。 */
  taskType: GraphwarPathfindingWorkerRequest["task"]["type"];
}

/**
 * 创建页面可复用的几何寻路 runner。
 *
 * 正常完成后保留 master Worker 及其派生 cache，除非任务期间已标记 cache 失效。当前 UI 入口会阻止寻路期间再次提交目标，runner 仍会防御性取消重叠调用。
 *
 * 取消直接终止并丢弃 Worker，既能立即停止同步搜索，也避免所有正常搜索为低频取消持续承担分片调度开销；后续请求再按需创建。
 */
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

    worker = new Worker(new URL("../../workers/pathfinding/main.worker.ts", import.meta.url), {
      name: "graphwar-pathfinding",
      type: "module",
    });
    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("messageerror", () => {
      rejectPendingTask(new Error("Graphwar pathfinding worker message could not be deserialized"));
    });
    worker.addEventListener("error", (event: ErrorEvent) => {
      rejectPendingTask(event.error instanceof Error ? event.error : new Error(event.message));
    });
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

  /** 在 master Worker 中执行完整智能寻路，主线程只负责写回结果。 */
  function findSmartPath(input: GraphwarSmartPathfindingPathInput, options?: GraphwarPathfindingRunOptions) {
    cancel();
    const activeWorker = ensureWorker();
    if (!activeWorker) {
      return Promise.reject(new Error("Graphwar pathfinding worker is unavailable"));
    }
    return runWorkerTask<GraphwarSmartPathfindingPathResult>(
      activeWorker,
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

  /** 在 master Worker 中执行完整一键清图搜索，避免主线程同步采样卡顿。 */
  function buildOneClickClearPath(
    input: GraphwarOneClickClearPathWorkerInput,
    options?: GraphwarPathfindingRunOptions,
  ) {
    cancel();
    const activeWorker = ensureWorker();
    if (!activeWorker) {
      return Promise.reject(new Error("Graphwar pathfinding worker is unavailable"));
    }
    return runWorkerTask<GraphwarOneClickClearPathWorkerResult>(
      activeWorker,
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
        onIncumbent: options?.onIncumbent,
        onPreview: options?.onPreview,
        reject,
        resolve: resolve as PendingPathfindingWorkerTask["resolve"],
        taskType: request.task.type,
      };
      try {
        activeWorker.postMessage(cloneGraphwarPathfindingWorkerRequest(request));
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

  /** 输入语义失效时 cache 本就不可复用；空闲时立即丢弃，忙碌时标记为任务结算后丢弃，后续请求再按需创建。 */
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
  function handleWorkerMessage(event: MessageEvent<unknown>) {
    const response = event.data;
    if (!pendingTask) {
      return;
    }
    if (!isRecord(response) || typeof response.id !== "number" || !Number.isInteger(response.id)) {
      rejectPendingProtocolResponse();
      return;
    }
    if (response.id !== pendingTask.id) {
      return;
    }
    if (response.type === "preview") {
      if (!isRecord(response.preview) || !pendingTask.onPreview) {
        rejectPendingProtocolResponse();
        return;
      }
      pendingTask.onPreview(response.preview as unknown as GraphwarPathfindingPreview);
      return;
    }
    if (response.type === "one-click-clear-incumbent") {
      if (
        pendingTask.taskType !== "build-one-click-clear-path" ||
        !pendingTask.onIncumbent ||
        !isGraphwarOneClickClearIncumbent(response.incumbent)
      ) {
        rejectPendingProtocolResponse();
        return;
      }
      pendingTask.onIncumbent(response.incumbent);
      return;
    }

    const completedTask = pendingTask;
    pendingTask = undefined;
    if (response.type === "error") {
      if (typeof response.message !== "string") {
        completedTask.reject(new Error("Graphwar pathfinding worker returned an invalid response"));
        resetWorker();
        return;
      }
      completedTask.reject(new Error(response.message));
      resetWorkerIfCacheInvalidated();
      return;
    }
    if (
      response.type !== "success" ||
      response.taskType !== completedTask.taskType ||
      (completedTask.taskType === "build-one-click-clear-path" &&
        !isGraphwarOneClickClearPathWorkerResult(response.result))
    ) {
      completedTask.reject(new Error("Graphwar pathfinding worker returned an invalid response"));
      resetWorker();
      return;
    }
    completedTask.resolve(response.result as GraphwarPathfindingWorkerSuccessResponse["result"]);
    resetWorkerIfCacheInvalidated();
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
    buildOneClickClearPath,
    cancel,
    clearCache,
    close,
    findSmartPath,
    findRoute,
  };
}

/** 判断未知 Worker 消息是否可安全按字段读取。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** PostMessage 不能克隆 Vue reactive proxy；runner 边界统一复制成纯数据。 */
function cloneGraphwarPathfindingWorkerRequest(
  request: GraphwarPathfindingWorkerRequest,
): GraphwarPathfindingWorkerRequest {
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

/** 复制普通几何路由输入；大型 mask 保留引用，交由 structured clone 复制。 */
function cloneGraphwarPathfindingRouteInput(input: GraphwarPathfindingRouteInput): GraphwarPathfindingRouteInput {
  return {
    boundaryExpansion: input.boundaryExpansion,
    bounds: cloneGraphBounds(input.bounds),
    boundsRect: cloneBoundsRect(input.boundsRect),
    isPreviewEnabled: input.isPreviewEnabled,
    routeMask: input.routeMask,
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
    routeObstacleMask: input.routeObstacleMask,
    routeTolerancePlanePixels: input.routeTolerancePlanePixels,
    settings: cloneGraphwarTrajectoryFormulaSettings(input.settings),
    simulationBoundaryExpansion: input.simulationBoundaryExpansion,
    ...(input.simulationMask ? { simulationMask: input.simulationMask } : {}),
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
    jobs: input.jobs.map((job) => ({
      from: job.from,
      id: job.id,
      ...(job.resolvedStartStateKey === undefined ? {} : { resolvedStartStateKey: job.resolvedStartStateKey }),
      ...(job.resolvedStartY === undefined ? {} : { resolvedStartY: job.resolvedStartY }),
      startPoint: clonePixelPoint(job.startPoint),
      targetPoint: clonePixelPoint(job.targetPoint),
      to: job.to,
    })),
    routeMask: input.routeMask,
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
    routeObstacleMask: input.routeObstacleMask,
    routeTolerancePlanePixels: input.routeTolerancePlanePixels,
    settings: cloneGraphwarTrajectoryFormulaSettings(input.settings),
    simulationBoundaryExpansion: input.simulationBoundaryExpansion,
    ...(input.simulationMask ? { simulationMask: input.simulationMask } : {}),
    simulationMaskCacheId: input.simulationMaskCacheId,
  };
}

/** 复制一键清图候选目标，避免命中圆携带页面代理。 */
function cloneGraphwarOneClickClearCandidate(candidate: GraphwarOneClickClearPathWorkerInput["candidates"][number]) {
  return {
    enemy: candidate.enemy,
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
    stepGlitchMode: settings.stepGlitchMode,
    ...(settings.stepGlitchObstacleMask ? { stepGlitchObstacleMask: settings.stepGlitchObstacleMask } : {}),
    stepOverflowProtection: settings.stepOverflowProtection,
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
