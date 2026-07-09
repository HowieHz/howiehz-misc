import { normalizePathForMinimumForwardStep, pathFollowsGraphRule } from "../../core/game/forward-rule";
import { planeGridCellCenterToImagePoint } from "../../core/plane-grid";
import type { GraphBounds, PixelPoint } from "../../core/types";
/** Graphwar 几何寻路 master worker：普通寻路直接跑，一键清图 DAG 边交给子 worker pool。 */
import { dilateObstacleMask } from "../../detection/objects";
import { sampleGraphwarPathTrajectory } from "../../formula/trajectory/sampling";
import { buildOneClickClearDagEdgeRoute } from "../../pathfinding/one-click-clear/edge-route";
import type {
  GraphwarOneClickClearDagEdgeBuildJob,
  GraphwarOneClickClearDagEdgeBuildResult,
  GraphwarOneClickClearDagEdgeRoute,
  GraphwarOneClickClearDebugTiming,
} from "../../pathfinding/one-click-clear/search";
import { buildGraphwarOneClickClearPath } from "../../pathfinding/one-click-clear/search";
import {
  buildGraphwarThetaStarPathForMask,
  createGraphwarThetaStarScratch,
} from "../../pathfinding/routing/theta-star";
import type { GraphwarThetaStarScratch } from "../../pathfinding/routing/theta-star";
import {
  buildGraphwarVisibilityGraphPathForMask,
  createRouteMaskCacheKey,
  createGraphwarVisibilityGraphObstacleData,
} from "../../pathfinding/routing/visibility-graph";
import type {
  GraphwarPathfindingPreview,
  GraphwarVisibilityGraphObstacleData,
} from "../../pathfinding/routing/visibility-graph";
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
  GraphwarSmartPathfindingPathInput,
  GraphwarSmartPathfindingPathResult,
  GraphwarSmartPathfindingWorkerTiming,
} from "../../pathfinding/runtime/protocol";

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

interface MasterRouteMaskLookup {
  /** Worker 查询是否复用了已按 tolerance 派生的 route mask。 */
  cacheHit: boolean;
  /** 查询或构建耗时。 */
  elapsedMs: number;
  /** 可直接交给几何寻路的 route mask。 */
  mask: Uint8Array;
}

interface MasterRouteMaskSourceInput {
  /** 当前 Graphwar 坐标边界。 */
  bounds: GraphBounds;
  /** 页面侧基础障碍 mask；worker 内部按 route tolerance 派生 route mask。 */
  routeObstacleMask: Uint8Array;
  /** 页面侧基础障碍 mask 的稳定 id。 */
  routeMaskCacheId: number;
  /** 当前 route tolerance。 */
  routeTolerancePlanePixels: number;
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

const masterRouteMaskCache = new Map<string, Uint8Array>();
const masterThetaStarScratch = createGraphwarThetaStarScratch();
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

    if (request.task.type === "find-smart-path") {
      const result = await findSmartPath(request.id, request.task.input);
      postResponse({
        id: request.id,
        result,
        taskType: "find-smart-path",
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
  const routeMask = getMasterRouteMask(input);
  return findRouteForMask(id, input, routeMask);
}

async function findRouteForMask(
  id: number,
  input: GraphwarPathfindingRouteInput,
  routeMask: Uint8Array,
): Promise<GraphwarPathfindingRouteResult> {
  let visibilityCache: GraphwarPathfindingRouteResult["visibilityCache"] = "skipped";
  let visibilityCacheElapsedMs = 0;
  const searchStartedAt = nowMs();
  const postPreview = input.previewEnabled
    ? (preview: GraphwarPathfindingPreview) =>
        postResponse({
          id,
          preview,
          type: "preview",
        })
    : undefined;
  const path =
    input.routeMode === "theta-star"
      ? await buildGraphwarThetaStarPathForMask({
          bounds: input.bounds,
          boundsRect: input.boundsRect,
          boundaryExpansion: input.boundaryExpansion,
          onPreview: postPreview,
          routeMask,
          routeTolerancePlanePixels: input.routeTolerancePlanePixels,
          scratch: masterThetaStarScratch,
          startPoint: input.startPoint,
          targetPoint: input.targetPoint,
        })
      : await buildGraphwarVisibilityGraphPathForMask({
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
          onPreview: postPreview,
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

async function findSmartPath(
  id: number,
  input: GraphwarSmartPathfindingPathInput,
): Promise<GraphwarSmartPathfindingPathResult> {
  const timings: GraphwarSmartPathfindingWorkerTiming[] = [];
  const startPoint = input.sourcePath.at(-1);
  if (!startPoint) {
    return { failureReason: "route", timings };
  }

  const routeMaskLookup = getMasterRouteMaskFromBase(input);
  timings.push({
    elapsedMs: routeMaskLookup.elapsedMs,
    stage: routeMaskLookup.cacheHit ? "route-mask-cache-hit" : "route-mask-cache-miss",
  });

  const routeResult = await findRouteForMask(
    id,
    {
      boundaryExpansion: input.boundaryExpansion,
      bounds: input.bounds,
      boundsRect: input.boundsRect,
      previewEnabled: input.previewEnabled,
      routeMask: routeMaskLookup.mask,
      routeMaskCacheId: input.routeMaskCacheId,
      routeMode: input.routeMode,
      routeTolerancePlanePixels: input.routeTolerancePlanePixels,
      startPoint,
      targetPoint: input.targetPoint,
    },
    routeMaskLookup.mask,
  );
  addSmartPathfindingRouteTimings(timings, routeResult);
  if (!routeResult.path || routeResult.path.length < 2) {
    return { failureReason: "route", timings };
  }

  const normalizedPath = normalizeSmartPathfindingPathFromPlanePath(routeResult.path, input.targetPoint, input);
  const validation = measureSmartPathfindingWorkerTiming(timings, "validate-trajectory", () =>
    validateSmartPathfindingTrajectory(input, normalizedPath),
  );
  if (!validation.followsGraphRule) {
    return { failureReason: "graph-rule", timings };
  }
  if (!validation.reachesTargetBeforeObstacle) {
    return {
      ...(validation.blockedPoint ? { blockedPoint: validation.blockedPoint } : {}),
      failureReason: "trajectory",
      timings,
    };
  }

  const path =
    normalizedPath.length > 3
      ? measureSmartPathfindingWorkerTiming(timings, "optimize-path", () =>
          optimizeSmartPathfindingPath(input, normalizedPath),
        )
      : normalizedPath;
  return { path, timings };
}

function addSmartPathfindingRouteTimings(
  timings: GraphwarSmartPathfindingWorkerTiming[],
  result: GraphwarPathfindingRouteResult,
) {
  timings.push({
    elapsedMs: result.visibilityCacheElapsedMs,
    stage:
      result.visibilityCache === "hit"
        ? "visibility-cache-hit"
        : result.visibilityCache === "miss"
          ? "visibility-cache-miss"
          : "visibility-cache-skipped",
  });
  timings.push({
    elapsedMs: result.searchElapsedMs,
    stage: "search-route",
  });
}

function getMasterRouteMask(input: GraphwarPathfindingRouteInput) {
  const cacheKey = createMasterVisibilityGraphCacheKey(input);
  return masterVisibilityGraphCache.get(cacheKey)?.routeMask ?? input.routeMask;
}

function getMasterRouteMaskFromBase(input: MasterRouteMaskSourceInput): MasterRouteMaskLookup {
  const startedAt = nowMs();
  const cacheKey = createMasterRouteMaskCacheKey(input);
  const cached = masterRouteMaskCache.get(cacheKey);
  if (cached) {
    return {
      cacheHit: true,
      elapsedMs: nowMs() - startedAt,
      mask: cached,
    };
  }

  const mask = dilateObstacleMask(input.routeObstacleMask, input.routeTolerancePlanePixels);
  masterRouteMaskCache.set(cacheKey, mask);
  return {
    cacheHit: false,
    elapsedMs: nowMs() - startedAt,
    mask,
  };
}

function getMasterVisibilityGraphObstacleData(
  input: Pick<GraphwarPathfindingRouteInput, "bounds" | "routeMaskCacheId" | "routeTolerancePlanePixels">,
  routeMask: Uint8Array,
) {
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

function createMasterRouteMaskCacheKey(
  input: Pick<MasterRouteMaskSourceInput, "routeMaskCacheId" | "routeTolerancePlanePixels">,
) {
  return [input.routeMaskCacheId, createRouteMaskCacheKey(input.routeTolerancePlanePixels)].join("|");
}

function createMasterVisibilityGraphCacheKey(
  input: Pick<GraphwarPathfindingRouteInput, "bounds" | "routeMaskCacheId" | "routeTolerancePlanePixels">,
) {
  return [
    input.routeMaskCacheId,
    input.bounds.maxX > input.bounds.minX ? "x-right" : "x-left",
    input.routeTolerancePlanePixels,
  ].join("|");
}

function normalizeSmartPathfindingPathFromPlanePath(
  pathfindingPath: readonly { x: number; y: number }[],
  targetPoint: PixelPoint,
  input: Pick<GraphwarSmartPathfindingPathInput, "bounds" | "boundsRect" | "sourcePath">,
) {
  const appendPoints = pathfindingPath
    .slice(1)
    .map((pathPoint, index, points) =>
      index === points.length - 1 ? targetPoint : planeGridCellCenterToImagePoint(pathPoint, input.boundsRect),
    );
  return normalizePathForMinimumForwardStep([...input.sourcePath, ...appendPoints], input.bounds, input.boundsRect);
}

function validateSmartPathfindingTrajectory(input: GraphwarSmartPathfindingPathInput, points: readonly PixelPoint[]) {
  if (!pathFollowsGraphRule(points, input.bounds, input.boundsRect)) {
    return {
      followsGraphRule: false,
      reachesTargetBeforeObstacle: false,
    };
  }

  const result = sampleGraphwarPathTrajectory({
    boundaryExpansion: input.simulationBoundaryExpansion,
    bounds: input.bounds,
    boundsRect: input.boundsRect,
    hitTargetPoint: input.hitTarget.center,
    obstacleMask: input.simulationMask,
    points,
    settings: input.settings,
    targetHitRadiusPixels: input.hitTarget.radius,
  });
  return {
    blockedPoint: result.earlyStopReason === "obstacle" ? result.visiblePixels.at(-1) : undefined,
    followsGraphRule: true,
    reachesTargetBeforeObstacle: result.reachesTargetBeforeObstacle,
  };
}

function optimizeSmartPathfindingPath(input: GraphwarSmartPathfindingPathInput, points: readonly PixelPoint[]) {
  let optimized = [...points];
  let changed = true;
  const firstOptimizableIndex = Math.max(1, input.sourcePath.length);
  while (changed) {
    changed = false;
    for (let index = firstOptimizableIndex; index < optimized.length - 1 && optimized.length > 2; index += 1) {
      const candidatePath = [...optimized.slice(0, index), ...optimized.slice(index + 1)];
      const validation = validateSmartPathfindingTrajectory(input, candidatePath);
      if (validation.followsGraphRule && validation.reachesTargetBeforeObstacle) {
        optimized = candidatePath;
        changed = true;
        break;
      }
    }
  }
  return optimized;
}

function measureSmartPathfindingWorkerTiming<TResult>(
  timings: GraphwarSmartPathfindingWorkerTiming[],
  stage: GraphwarSmartPathfindingWorkerTiming["stage"],
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

async function buildOneClickClearPath(
  input: GraphwarOneClickClearPathWorkerInput,
): Promise<GraphwarOneClickClearPathWorkerResult> {
  const timings: GraphwarOneClickClearDebugTiming[] = [];
  const routeMaskLookup = getMasterRouteMaskFromBase(input);
  timings.push({
    elapsedMs: routeMaskLookup.elapsedMs,
    stage: routeMaskLookup.cacheHit ? "route-mask-cache-hit" : "route-mask-cache-miss",
  });
  const result = await buildGraphwarOneClickClearPath({
    boundaryExpansion: input.boundaryExpansion,
    buildDagEdges: (request) => buildOneClickClearDagEdges(request),
    bounds: input.bounds,
    boundsRect: input.boundsRect,
    candidates: input.candidates,
    dagEdgeWorkerCount: input.dagEdgeWorkerCount,
    deleteHitCheckRadiusPixels: input.deleteHitCheckRadiusPixels,
    hitCandidates: input.hitCandidates,
    isCancelled: () => false,
    onDebugTiming: (timing) => timings.push(timing),
    pathPoints: input.pathPoints,
    ...(input.prefixTarget ? { prefixTarget: input.prefixTarget } : {}),
    routeMask: {
      mask: routeMaskLookup.mask,
      routeTolerancePlanePixels: input.routeTolerancePlanePixels,
    },
    routeMode: input.routeMode,
    settings: input.settings,
    simulationBoundaryExpansion: input.simulationBoundaryExpansion,
    ...(input.simulationMask ? { simulationMask: input.simulationMask } : {}),
  });
  return { result, timings };
}

async function buildOneClickClearDagEdges(
  input: GraphwarOneClickClearDagEdgesWorkerInput,
): Promise<GraphwarOneClickClearDagEdgeBuildResult> {
  // 单 lane、单 job 或缺少 Worker API 时没有调度收益，直接走串行建边。
  if (input.workerCount <= 1 || input.jobs.length <= 1 || typeof Worker === "undefined") {
    return buildOneClickClearDagEdgesSerial(input, input.jobs, "serial", 1);
  }

  return runOneClickClearDagEdgeWorkerPool(input, Math.min(input.workerCount, input.jobs.length));
}

/** 并行调度 DAG 单边 job；任一子 worker 出错时，未完成边交给串行路径补跑。 */
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
      routes.push(createOneClickClearDagEdgeRoute(result));
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
      const worker = new Worker(new URL("./one-click-clear/edge.worker.ts", import.meta.url), {
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
            routeMode: context.routeMode,
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

/** 按顺序构建 DAG 边；用于小任务串行模式，也用于并行 worker 失败后的剩余 job 补跑。 */
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
  const visibilityGraphObstacleData =
    input.routeMode === "visibility-graph"
      ? createGraphwarVisibilityGraphObstacleData({
          bounds: input.bounds,
          routeMask: input.routeMask,
          routeTolerancePlanePixels: input.routeTolerancePlanePixels,
        })
      : undefined;
  const thetaStarScratch: GraphwarThetaStarScratch | undefined =
    input.routeMode === "theta-star" ? createGraphwarThetaStarScratch() : undefined;
  // 串行和 fallback 按批次复用可视图轮廓或 Theta* 工作区，避免每条 DAG 边重复预处理。
  const routeBuildContext = {
    boundaryExpansion: input.boundaryExpansion,
    bounds: input.bounds,
    boundsRect: input.boundsRect,
    routeMask: input.routeMask,
    routeMode: input.routeMode,
    routeTolerancePlanePixels: input.routeTolerancePlanePixels,
    ...(thetaStarScratch ? { thetaStarScratch } : {}),
    ...(visibilityGraphObstacleData ? { visibilityGraphObstacleData } : {}),
  };

  for (const job of jobs) {
    const result = await buildOneClickClearDagEdgeRoute(routeBuildContext, job);
    totals.routePathfindingElapsedMs += result.routePathfindingElapsedMs;
    totals.routeMapPixelsElapsedMs += result.routeMapPixelsElapsedMs;
    routes.push(createOneClickClearDagEdgeRoute(result));
  }

  return {
    routes,
    timings: [...timings, ...createRouteTimingEntries(totals)],
  };
}

/** 把单边 worker 结果合并回 DAG 边结果；默认没有 route 表示不可达边，jobId 仍用于稳定匹配边。 */
function createOneClickClearDagEdgeRoute(
  result: Pick<GraphwarOneClickClearEdgeWorkerJobResult, "jobId" | "route">,
): GraphwarOneClickClearDagEdgeRoute {
  return result.route ? { jobId: result.jobId, route: result.route } : { jobId: result.jobId };
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

function postResponse(response: GraphwarPathfindingWorkerResponse) {
  workerScope.postMessage(response);
}

function nowMs() {
  return performance.now();
}
