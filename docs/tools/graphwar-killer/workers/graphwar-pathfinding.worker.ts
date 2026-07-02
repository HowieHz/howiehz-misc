import type {
  GraphwarOneClickClearDagEdgeBuildJob,
  GraphwarOneClickClearDagEdgeBuildResult,
  GraphwarOneClickClearDagEdgeRoute,
  GraphwarOneClickClearDebugTiming,
} from "../graphwar-one-click-clear";
/** Graphwar 几何寻路 master worker：普通寻路直接跑，一键清图 DAG 边交给子 worker pool。 */
import { buildGraphwarOneClickClearPath } from "../graphwar-one-click-clear";
import {
  buildSmartPathfindingPathForMask,
  createGraphwarVisibilityGraphObstacleData,
  planeGridCellCenterToImagePoint,
} from "../graphwar-pathfinding";
import type { GraphwarVisibilityGraphObstacleData } from "../graphwar-pathfinding";
import type {
  GraphwarOneClickClearDagEdgesWorkerInput,
  GraphwarOneClickClearEdgeWorkerRequest,
  GraphwarOneClickClearEdgeWorkerResponse,
  GraphwarOneClickClearEdgeWorkerJobResult,
  GraphwarOneClickClearPathWorkerInput,
  GraphwarOneClickClearPathWorkerResult,
  GraphwarPathfindingRouteInput,
  GraphwarPathfindingRouteResult,
  GraphwarPathfindingWorkerRequest,
  GraphwarPathfindingWorkerResponse,
} from "../graphwar-pathfinding-worker-types";
import type { PixelPoint } from "../types";

/** 当前 master Worker 暴露给 TypeScript 的最小消息接口。 */
interface GraphwarPathfindingWorkerScope {
  /** 接收主线程几何寻路请求。 */
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<GraphwarPathfindingWorkerRequest>) => void,
  ) => void;
  /** 返回预览、成功或错误响应。 */
  postMessage: (message: GraphwarPathfindingWorkerResponse) => void;
}

const workerScope = self as unknown as GraphwarPathfindingWorkerScope;

interface MasterVisibilityGraphCacheEntry {
  /** Master worker 内部保留的 route mask 引用；cache 引用相等检查必须用它。 */
  routeMask: Uint8Array;
  /** 与 routeMask、方向和 route tolerance 绑定的可视图 cache。 */
  visibilityGraphObstacleData: GraphwarVisibilityGraphObstacleData;
}

interface EdgeWorkerHandle {
  /** 子 worker 当前正在处理的 job；失败 fallback 时会补跑所有未完成 job。 */
  activeJob?: GraphwarOneClickClearDagEdgeBuildJob;
  /** 清理事件监听器。 */
  cleanup: () => void;
  /** 是否已结束并记录耗时。 */
  finished: boolean;
  /** 子 worker 创建时间。 */
  startedAt: number;
  /** 实际子 worker。 */
  worker: Worker;
  /** 子 worker 序号。 */
  workerIndex: number;
}

interface EdgeRouteTimingTotals {
  /** 平面几何寻路累计耗时。 */
  routePathfindingElapsedMs: number;
  /** 平面路线映射到截图像素的累计耗时。 */
  routeMapPixelsElapsedMs: number;
}

const masterVisibilityGraphCache = new Map<string, MasterVisibilityGraphCacheEntry>();

workerScope.addEventListener("message", (event: MessageEvent<GraphwarPathfindingWorkerRequest>) => {
  void handleRequest(event.data);
});

async function handleRequest(request: GraphwarPathfindingWorkerRequest) {
  try {
    if (request.task.type === "find-route") {
      const result = await findRoute(request.id, request.task.input);
      postResponse({
        id: request.id,
        result,
        taskType: "find-route",
        type: "success",
      });
      return;
    }

    if (request.task.type === "build-one-click-clear-dag-edges") {
      const result = await buildOneClickClearDagEdges(request.task.input);
      postResponse({
        id: request.id,
        result,
        taskType: "build-one-click-clear-dag-edges",
        type: "success",
      });
      return;
    }

    const result = await buildOneClickClearPath(request.task.input);
    postResponse({
      id: request.id,
      result,
      taskType: "build-one-click-clear-path",
      type: "success",
    });
  } catch (error) {
    postResponse({
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
      type: "error",
    });
  }
}

async function findRoute(id: number, input: GraphwarPathfindingRouteInput): Promise<GraphwarPathfindingRouteResult> {
  let visibilityCache: GraphwarPathfindingRouteResult["visibilityCache"] = "skipped";
  let visibilityCacheElapsedMs = 0;
  const routeMask = getMasterRouteMask(input);
  const searchStartedAt = nowMs();
  const path = await buildSmartPathfindingPathForMask({
    bounds: input.bounds,
    boundsRect: input.boundsRect,
    boundaryExpansion: input.boundaryExpansion,
    getVisibilityGraphObstacleData: () => {
      const startedAt = nowMs();
      const lookup = getMasterVisibilityGraphObstacleData(input, routeMask);
      visibilityCache = lookup.cacheHit ? "hit" : "miss";
      visibilityCacheElapsedMs += nowMs() - startedAt;
      return lookup.data;
    },
    onPreview: input.previewEnabled
      ? (preview) =>
          postResponse({
            id,
            preview,
            type: "preview",
          })
      : undefined,
    routeMask,
    routeTolerancePlanePixels: input.routeTolerancePlanePixels,
    startPoint: input.startPoint,
    targetPoint: input.targetPoint,
  });

  return {
    ...(path ? { path } : {}),
    searchElapsedMs: Math.max(0, nowMs() - searchStartedAt - visibilityCacheElapsedMs),
    visibilityCache,
    visibilityCacheElapsedMs,
  };
}

function getMasterRouteMask(input: GraphwarPathfindingRouteInput) {
  const cacheKey = createMasterVisibilityGraphCacheKey(input);
  return masterVisibilityGraphCache.get(cacheKey)?.routeMask ?? input.routeMask;
}

function getMasterVisibilityGraphObstacleData(input: GraphwarPathfindingRouteInput, routeMask: Uint8Array) {
  const cacheKey = createMasterVisibilityGraphCacheKey(input);
  const cached = masterVisibilityGraphCache.get(cacheKey);
  if (cached) {
    return {
      cacheHit: true,
      data: cached.visibilityGraphObstacleData,
    };
  }

  const data = createGraphwarVisibilityGraphObstacleData({
    bounds: input.bounds,
    routeMask,
    routeTolerancePlanePixels: input.routeTolerancePlanePixels,
  });
  masterVisibilityGraphCache.set(cacheKey, {
    routeMask,
    visibilityGraphObstacleData: data,
  });
  return {
    cacheHit: false,
    data,
  };
}

function createMasterVisibilityGraphCacheKey(input: GraphwarPathfindingRouteInput) {
  return [
    input.routeMaskCacheId,
    input.bounds.maxX > input.bounds.minX ? "x-right" : "x-left",
    input.routeTolerancePlanePixels,
  ].join("|");
}

async function buildOneClickClearPath(
  input: GraphwarOneClickClearPathWorkerInput,
): Promise<GraphwarOneClickClearPathWorkerResult> {
  const timings: GraphwarOneClickClearDebugTiming[] = [];
  const result = await buildGraphwarOneClickClearPath({
    ...input,
    buildDagEdges: (request) => buildOneClickClearDagEdges(request),
    isCancelled: () => false,
    onDebugTiming: (timing) => timings.push(timing),
  });
  return { result, timings };
}

async function buildOneClickClearDagEdges(
  input: GraphwarOneClickClearDagEdgesWorkerInput,
): Promise<GraphwarOneClickClearDagEdgeBuildResult> {
  if (input.workerCount <= 1 || input.jobs.length <= 1 || typeof Worker === "undefined") {
    return buildOneClickClearDagEdgesSerial(input, input.jobs, "serial", 1);
  }

  return runOneClickClearDagEdgeWorkerPool(input, Math.min(input.workerCount, input.jobs.length));
}

function runOneClickClearDagEdgeWorkerPool(
  input: GraphwarOneClickClearDagEdgesWorkerInput,
  laneCount: number,
): Promise<GraphwarOneClickClearDagEdgeBuildResult> {
  return new Promise((resolve, reject) => {
    const handles: EdgeWorkerHandle[] = [];
    const completedJobIds = new Set<number>();
    const routes: GraphwarOneClickClearDagEdgeRoute[] = [];
    const timings: GraphwarOneClickClearDebugTiming[] = [
      {
        detail: {
          mode: "parallel",
          type: "dag-edge-mode",
          workerCount: laneCount,
        },
        elapsedMs: 0,
        stage: "build-dag-edges",
      },
    ];
    const totals: EdgeRouteTimingTotals = {
      routeMapPixelsElapsedMs: 0,
      routePathfindingElapsedMs: 0,
    };
    let nextJobIndex = 0;
    let nextRequestId = 1;
    let settled = false;

    const finishWorker = (handle: EdgeWorkerHandle) => {
      if (handle.finished) {
        return;
      }
      handle.finished = true;
      handle.cleanup();
      handle.worker.terminate();
      timings.push({
        detail: {
          type: "dag-edge-worker",
          workerIndex: handle.workerIndex,
        },
        elapsedMs: nowMs() - handle.startedAt,
        stage: "build-dag-edges",
      });
    };

    const resolveWithParallelResult = () => {
      if (settled || completedJobIds.size < input.jobs.length) {
        return;
      }
      settled = true;
      for (const handle of handles) {
        finishWorker(handle);
      }
      resolve({
        routes,
        timings: [...timings, ...createRouteTimingEntries(totals)],
      });
    };

    const fallbackWithRemainingJobs = (failedHandle: EdgeWorkerHandle | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      for (const timing of timings) {
        if (timing.detail?.type === "dag-edge-mode") {
          timing.detail = {
            mode: "parallel-fallback",
            type: "dag-edge-mode",
            workerCount: laneCount,
          };
          break;
        }
      }
      for (const handle of handles) {
        finishWorker(handle);
      }
      if (failedHandle && !handles.includes(failedHandle)) {
        finishWorker(failedHandle);
      }

      const remainingJobs = input.jobs.filter((job) => !completedJobIds.has(job.id));
      void buildOneClickClearDagEdgesSerial(input, remainingJobs, "parallel-fallback", laneCount)
        .then((serial) => {
          resolve({
            routes: [...routes, ...serial.routes],
            timings: [
              ...timings,
              ...serial.timings.filter((timing) => timing.detail?.type !== "dag-edge-mode"),
              ...createRouteTimingEntries(totals),
            ],
          });
        })
        .catch((error: unknown) => {
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    };

    const assignNextJob = (handle: EdgeWorkerHandle) => {
      if (settled) {
        return;
      }
      const job = input.jobs[nextJobIndex];
      nextJobIndex += 1;
      if (!job) {
        finishWorker(handle);
        resolveWithParallelResult();
        return;
      }

      handle.activeJob = job;
      try {
        handle.worker.postMessage({
          job,
          requestId: nextRequestId,
          type: "job",
        } satisfies GraphwarOneClickClearEdgeWorkerRequest);
        nextRequestId += 1;
      } catch {
        handle.activeJob = undefined;
        fallbackWithRemainingJobs(handle);
      }
    };

    try {
      for (let workerIndex = 1; workerIndex <= laneCount; workerIndex += 1) {
        const handle = createEdgeWorkerHandle(workerIndex, input, assignNextJob, (failed) =>
          fallbackWithRemainingJobs(failed),
        );
        handles.push(handle);
      }
    } catch {
      fallbackWithRemainingJobs(undefined);
    }

    function handleJobResult(handle: EdgeWorkerHandle, result: GraphwarOneClickClearEdgeWorkerJobResult) {
      if (settled || !handle.activeJob) {
        return;
      }
      completedJobIds.add(result.jobId);
      totals.routePathfindingElapsedMs += result.routePathfindingElapsedMs;
      totals.routeMapPixelsElapsedMs += result.routeMapPixelsElapsedMs;
      routes.push(createOneClickClearDagEdgeRoute(result.jobId, result.route));
      handle.activeJob = undefined;
      assignNextJob(handle);
      resolveWithParallelResult();
    }

    function createEdgeWorkerHandle(
      workerIndex: number,
      context: GraphwarOneClickClearDagEdgesWorkerInput,
      onReady: (handle: EdgeWorkerHandle) => void,
      onFailed: (handle: EdgeWorkerHandle) => void,
    ): EdgeWorkerHandle {
      const worker = new Worker(new URL("./graphwar-one-click-clear-edge.worker.ts", import.meta.url), {
        name: `graphwar-one-click-clear-edge-${workerIndex}`,
        type: "module",
      });
      const handle: EdgeWorkerHandle = {
        cleanup: () => cleanup(),
        finished: false,
        startedAt: nowMs(),
        worker,
        workerIndex,
      };
      const handleMessage = (event: MessageEvent<GraphwarOneClickClearEdgeWorkerResponse>) => {
        const response = event.data;
        if (response.workerIndex !== workerIndex) {
          return;
        }
        if (response.type === "ready") {
          onReady(handle);
          return;
        }
        if (response.type === "error") {
          onFailed(handle);
          return;
        }
        handleJobResult(handle, response.result);
      };
      const handleMessageError = () => onFailed(handle);
      const handleError = () => onFailed(handle);
      const cleanup = () => {
        worker.removeEventListener("message", handleMessage);
        worker.removeEventListener("messageerror", handleMessageError);
        worker.removeEventListener("error", handleError);
      };
      worker.addEventListener("message", handleMessage);
      worker.addEventListener("messageerror", handleMessageError);
      worker.addEventListener("error", handleError);
      try {
        worker.postMessage({
          context: {
            bounds: context.bounds,
            boundsRect: context.boundsRect,
            boundaryExpansion: context.boundaryExpansion,
            routeMask: context.routeMask,
            routeTolerancePlanePixels: context.routeTolerancePlanePixels,
            workerIndex,
          },
          type: "init",
        } satisfies GraphwarOneClickClearEdgeWorkerRequest);
      } catch {
        onFailed(handle);
      }
      return handle;
    }
  });
}

async function buildOneClickClearDagEdgesSerial(
  input: GraphwarOneClickClearDagEdgesWorkerInput,
  jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[],
  mode: "serial" | "parallel-fallback",
  workerCount: number,
): Promise<GraphwarOneClickClearDagEdgeBuildResult> {
  const routes: GraphwarOneClickClearDagEdgeRoute[] = [];
  const timings: GraphwarOneClickClearDebugTiming[] = [
    {
      detail: {
        mode,
        type: "dag-edge-mode",
        workerCount,
      },
      elapsedMs: 0,
      stage: "build-dag-edges",
    },
  ];
  const totals: EdgeRouteTimingTotals = {
    routeMapPixelsElapsedMs: 0,
    routePathfindingElapsedMs: 0,
  };
  const visibilityGraphObstacleData = createGraphwarVisibilityGraphObstacleData({
    bounds: input.bounds,
    routeMask: input.routeMask,
    routeTolerancePlanePixels: input.routeTolerancePlanePixels,
  });

  for (const job of jobs) {
    const result = await buildOneClickClearDagEdgeSerial(input, job, visibilityGraphObstacleData);
    totals.routePathfindingElapsedMs += result.routePathfindingElapsedMs;
    totals.routeMapPixelsElapsedMs += result.routeMapPixelsElapsedMs;
    routes.push(createOneClickClearDagEdgeRoute(result.jobId, result.route));
  }

  return {
    routes,
    timings: [...timings, ...createRouteTimingEntries(totals)],
  };
}

async function buildOneClickClearDagEdgeSerial(
  input: GraphwarOneClickClearDagEdgesWorkerInput,
  job: GraphwarOneClickClearDagEdgeBuildJob,
  visibilityGraphObstacleData: GraphwarVisibilityGraphObstacleData,
): Promise<GraphwarOneClickClearEdgeWorkerJobResult> {
  const pathfindingStartedAt = nowMs();
  const route = await buildSmartPathfindingPathForMask({
    bounds: input.bounds,
    boundsRect: input.boundsRect,
    boundaryExpansion: input.boundaryExpansion,
    routeMask: input.routeMask,
    routeTolerancePlanePixels: input.routeTolerancePlanePixels,
    startPoint: job.startPoint,
    targetPoint: job.targetPoint,
    visibilityGraphObstacleData,
  });
  const routePathfindingElapsedMs = nowMs() - pathfindingStartedAt;

  const mapStartedAt = nowMs();
  const pixelRoute = route?.map((point) => planeGridCellCenterToImagePoint(point, input.boundsRect));
  const routeMapPixelsElapsedMs = nowMs() - mapStartedAt;
  const exactRoute = normalizeEdgeRoute(pixelRoute, job.startPoint, job.targetPoint);
  return {
    jobId: job.id,
    ...(exactRoute ? { route: exactRoute } : {}),
    routeMapPixelsElapsedMs,
    routePathfindingElapsedMs,
  };
}

function createOneClickClearDagEdgeRoute(jobId: number, route: PixelPoint[] | undefined) {
  return route ? { jobId, route } : { jobId };
}

function createRouteTimingEntries(totals: EdgeRouteTimingTotals): GraphwarOneClickClearDebugTiming[] {
  return [
    {
      elapsedMs: totals.routePathfindingElapsedMs,
      stage: "route-pathfinding",
    },
    {
      elapsedMs: totals.routeMapPixelsElapsedMs,
      stage: "route-map-pixels",
    },
  ];
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

function postResponse(response: GraphwarPathfindingWorkerResponse) {
  workerScope.postMessage(response);
}

function nowMs() {
  return performance.now();
}
