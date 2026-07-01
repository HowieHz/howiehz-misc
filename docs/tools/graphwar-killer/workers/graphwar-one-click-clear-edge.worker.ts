import type { GraphwarOneClickClearDagEdgeBuildJob } from "../graphwar-one-click-clear";
/** 一键清图 DAG 边消费者 worker：初始化一次私有可视图 cache，然后按需处理单条边。 */
import {
  buildSmartPathfindingPathForMask,
  createGraphwarVisibilityGraphObstacleData,
  planeGridCellCenterToImagePoint,
} from "../graphwar-pathfinding";
import type { GraphwarVisibilityGraphObstacleData } from "../graphwar-pathfinding";
import type {
  GraphwarOneClickClearEdgeWorkerInit,
  GraphwarOneClickClearEdgeWorkerRequest,
  GraphwarOneClickClearEdgeWorkerResponse,
  GraphwarOneClickClearEdgeWorkerJobResult,
} from "../graphwar-pathfinding-worker-types";
import type { PixelPoint } from "../types";

/** 当前 edge Worker 暴露给 TypeScript 的最小消息接口。 */
interface GraphwarOneClickClearEdgeWorkerScope {
  /** 接收 master Worker 发来的初始化和单边 job。 */
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<GraphwarOneClickClearEdgeWorkerRequest>) => void,
  ) => void;
  /** 返回 ready、单边结果或错误。 */
  postMessage: (message: GraphwarOneClickClearEdgeWorkerResponse) => void;
}

const workerScope = self as unknown as GraphwarOneClickClearEdgeWorkerScope;

interface EdgeWorkerContext extends GraphwarOneClickClearEdgeWorkerInit {
  /** 本 worker 私有可视图 cache，绑定本 worker 自己收到的 routeMask 引用。 */
  visibilityGraphObstacleData: GraphwarVisibilityGraphObstacleData;
}

let context: EdgeWorkerContext | undefined;

workerScope.addEventListener("message", (event: MessageEvent<GraphwarOneClickClearEdgeWorkerRequest>) => {
  void handleRequest(event.data);
});

async function handleRequest(request: GraphwarOneClickClearEdgeWorkerRequest) {
  try {
    if (request.type === "init") {
      context = createEdgeWorkerContext(request.context);
      postResponse({
        type: "ready",
        workerIndex: request.context.workerIndex,
      });
      return;
    }

    const activeContext = context;
    if (!activeContext) {
      throw new Error("Edge worker was not initialized");
    }
    const result = await buildEdgeRoute(activeContext, request.job);
    postResponse({
      requestId: request.requestId,
      result,
      type: "job-result",
      workerIndex: activeContext.workerIndex,
    });
  } catch (error) {
    postResponse({
      message: error instanceof Error ? error.message : String(error),
      type: "error",
      workerIndex: request.type === "init" ? request.context.workerIndex : (context?.workerIndex ?? 0),
    });
  }
}

function createEdgeWorkerContext(source: GraphwarOneClickClearEdgeWorkerInit): EdgeWorkerContext {
  /*
   * Do not clone the main-thread visibility cache into edge workers.
   * The cache validates compatibility with routeMask by reference equality; building it here keeps
   * cache.routeMask === routeMask inside this worker and avoids cloning the large contour object graph.
   */
  const visibilityGraphObstacleData = createGraphwarVisibilityGraphObstacleData({
    bounds: source.bounds,
    routeMask: source.routeMask,
    routeTolerancePlanePixels: source.routeTolerancePlanePixels,
  });
  return {
    ...source,
    visibilityGraphObstacleData,
  };
}

async function buildEdgeRoute(
  activeContext: EdgeWorkerContext,
  job: GraphwarOneClickClearDagEdgeBuildJob,
): Promise<GraphwarOneClickClearEdgeWorkerJobResult> {
  const pathfindingStartedAt = nowMs();
  const route = await buildSmartPathfindingPathForMask({
    bounds: activeContext.bounds,
    boundsRect: activeContext.boundsRect,
    boundaryExpansion: activeContext.boundaryExpansion,
    routeMask: activeContext.routeMask,
    routeTolerancePlanePixels: activeContext.routeTolerancePlanePixels,
    startPoint: job.startPoint,
    targetPoint: job.targetPoint,
    visibilityGraphObstacleData: activeContext.visibilityGraphObstacleData,
  });
  const routePathfindingElapsedMs = nowMs() - pathfindingStartedAt;

  const mapStartedAt = nowMs();
  const pixelRoute = route?.map((point) => planeGridCellCenterToImagePoint(point, activeContext.boundsRect));
  const routeMapPixelsElapsedMs = nowMs() - mapStartedAt;
  const exactRoute = normalizeEdgeRoute(pixelRoute, job.startPoint, job.targetPoint);
  return {
    jobId: job.id,
    ...(exactRoute ? { route: exactRoute } : {}),
    routeMapPixelsElapsedMs,
    routePathfindingElapsedMs,
  };
}

function normalizeEdgeRoute(route: PixelPoint[] | undefined, startPoint: PixelPoint, targetPoint: PixelPoint) {
  if (!route || route.length < 2) {
    return undefined;
  }

  const exactRoute = [...route];
  exactRoute[0] = startPoint;
  exactRoute[exactRoute.length - 1] = targetPoint;
  return exactRoute;
}

function postResponse(response: GraphwarOneClickClearEdgeWorkerResponse) {
  workerScope.postMessage(response);
}

function nowMs() {
  return performance.now();
}
