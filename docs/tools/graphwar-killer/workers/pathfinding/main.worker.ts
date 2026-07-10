import { normalizePathForMinimumForwardStep, pathFollowsGraphRule } from "../../core/game/forward-rule";
import { imageToGraphPoint } from "../../core/geometry";
import { planeGridCellCenterToImagePoint } from "../../core/plane-grid";
import { nowMs } from "../../core/time";
import type { GraphBounds, PixelPoint } from "../../core/types";
/** Graphwar 几何寻路 master worker：普通寻路直接跑，一键清图 DAG 边交给子 worker pool。 */
import { dilateObstacleMask } from "../../detection/objects";
import { sampleGraphwarPathTrajectory } from "../../formula/trajectory/sampling";
import { buildOneClickClearDagEdgeRoute } from "../../pathfinding/one-click-clear/edge-route";
import type { GraphwarOneClickClearDagEdgeRouteBuildContext } from "../../pathfinding/one-click-clear/edge-route";
import type {
  GraphwarOneClickClearDagEdgeBuildJob,
  GraphwarOneClickClearDagEdgeBuildResult,
  GraphwarOneClickClearDagEdgeRoute,
  GraphwarOneClickClearDebugTiming,
} from "../../pathfinding/one-click-clear/search";
import { buildGraphwarOneClickClearPath } from "../../pathfinding/one-click-clear/search";
import type { GraphwarPlaneMaskSummedArea } from "../../pathfinding/routing/step-envelope";
import {
  createGraphwarStepPathfindingEdgeEvaluator,
  createGraphwarStepRouteModel,
  createGraphwarStepRouteSummedArea,
  validateGraphwarStepRoutePath,
} from "../../pathfinding/routing/step-route";
import type { GraphwarStepRouteModel } from "../../pathfinding/routing/step-route";
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
  GraphwarPathfindingOptions,
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
  /** Step 请求按需构建的二维前缀和；ABS 请求保持 undefined。 */
  summedArea?: GraphwarPlaneMaskSummedArea;
}

interface MasterRouteMaskCacheEntry {
  mask: Uint8Array;
  summedArea?: GraphwarPlaneMaskSummedArea;
}

type RouteRuntimeOptions = Pick<
  GraphwarPathfindingOptions,
  "estimateRemainingSecondaryCost" | "evaluateEdge" | "initialRouteState" | "initialRouteStateKey"
>;

interface SmartStepRouteContext {
  model: GraphwarStepRouteModel;
  summedArea: GraphwarPlaneMaskSummedArea;
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
  /** 当前 job 的 session 内请求号；复用 worker 后用于拒绝迟到结果。 */
  activeRequestId?: number;
  /** 清理事件监听器。 */
  cleanup: () => void;
  /** 是否已结束并记录耗时。 */
  finished: boolean;
  /** 是否已完成初始化，可接收 DAG 边 job。 */
  ready: boolean;
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

type OneClickClearDagEdgeSessionState = "disposed" | "fallback" | "idle" | "running";

interface OneClickClearDagEdgeBatch {
  /** 已完成 job id；worker 失败时只串行补跑剩余项。 */
  completedJobIds: Set<number>;
  /** 本批输入 job，顺序也是最终结果的稳定顺序。 */
  jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[];
  /** 下一个尚未分配给 worker 的 job 下标。 */
  nextJobIndex: number;
  /** Promise 失败出口。 */
  reject: (error: Error) => void;
  /** 按 job id 保存结果，避免并行完成顺序影响输出。 */
  routesByJobId: Map<number, GraphwarOneClickClearDagEdgeRoute>;
  /** Promise 成功出口。 */
  resolve: (result: GraphwarOneClickClearDagEdgeBuildResult) => void;
  /** 本批是否已结束；迟到消息必须忽略。 */
  settled: boolean;
  /** 本批累计的实际建路耗时。 */
  totals: EdgeRouteTimingTotals;
  /** 本批实际可参与调度的 worker 数。 */
  workerCount: number;
}

interface OneClickClearDagEdgeSession {
  /** 结束本次一键清图请求，并返回每个 child worker 唯一的一条生命周期 timing。 */
  dispose: () => GraphwarOneClickClearDebugTiming[];
  /** 使用同一静态上下文构建下一批动态 DAG 边。批次必须串行调用。 */
  runBatch: (jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[]) => Promise<GraphwarOneClickClearDagEdgeBuildResult>;
}

const masterRouteMaskCache = new Map<string, MasterRouteMaskCacheEntry>();
const masterStepSummedAreaCache = new WeakMap<Uint8Array, GraphwarPlaneMaskSummedArea>();
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
  runtimeOptions?: RouteRuntimeOptions,
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
          ...runtimeOptions,
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
          ...runtimeOptions,
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
  const routeOriginPoint = input.sourcePath[0];
  if (!startPoint || !routeOriginPoint) {
    return { failureReason: "route", timings };
  }

  const isStepRoute = input.settings.algorithm === "step";
  const routeMaskLookup = getMasterRouteMaskFromBase(input, isStepRoute);
  timings.push({
    elapsedMs: routeMaskLookup.elapsedMs,
    stage: routeMaskLookup.cacheHit ? "route-mask-cache-hit" : "route-mask-cache-miss",
  });

  let stepContext: SmartStepRouteContext | undefined;
  let routeRuntimeOptions: RouteRuntimeOptions | undefined;
  if (isStepRoute) {
    const model = createGraphwarStepRouteModel(
      imageToGraphPoint(routeOriginPoint, input.bounds, input.boundsRect).y,
      input.settings,
    );
    if (!model || !routeMaskLookup.summedArea) {
      return { failureReason: "route", timings };
    }

    const prefixValidation = validateGraphwarStepRoutePath({
      boundaryInset: input.boundaryExpansion,
      bounds: input.bounds,
      boundsRect: input.boundsRect,
      model,
      points: input.sourcePath,
      summedArea: routeMaskLookup.summedArea,
    });
    if (!prefixValidation.ok) {
      return {
        failureReason: "route",
        ...(prefixValidation.invalidSegmentIndex === undefined
          ? {}
          : { invalidSegmentIndex: prefixValidation.invalidSegmentIndex }),
        timings,
      };
    }
    if (prefixValidation.resolvedEndY === undefined) {
      return { failureReason: "route", timings };
    }

    stepContext = {
      model,
      summedArea: routeMaskLookup.summedArea,
    };
    routeRuntimeOptions = createGraphwarStepPathfindingEdgeEvaluator({
      boundaryInset: input.boundaryExpansion,
      bounds: input.bounds,
      boundsRect: input.boundsRect,
      exactStartPoint: startPoint,
      exactTargetPoint: input.targetPoint,
      model,
      resolvedStartY: prefixValidation.resolvedEndY,
      ...(prefixValidation.routeStateKey === undefined
        ? {}
        : { resolvedStartStateKey: prefixValidation.routeStateKey }),
      summedArea: routeMaskLookup.summedArea,
    });
  }

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
    routeRuntimeOptions,
  );
  addSmartPathfindingRouteTimings(timings, routeResult);
  if (!routeResult.path || routeResult.path.length < 2) {
    return { failureReason: "route", timings };
  }

  const normalizedPath = normalizeSmartPathfindingPathFromPlanePath(routeResult.path, input.targetPoint, input);
  const validation = measureSmartPathfindingWorkerTiming(timings, "validate-trajectory", () =>
    validateSmartPathfindingTrajectory(input, normalizedPath, stepContext),
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
          optimizeSmartPathfindingPath(input, normalizedPath, stepContext),
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

function getMasterRouteMaskFromBase(input: MasterRouteMaskSourceInput, needsSummedArea = false): MasterRouteMaskLookup {
  const startedAt = nowMs();
  const cacheKey = createMasterRouteMaskCacheKey(input);
  const cached = masterRouteMaskCache.get(cacheKey);
  if (cached) {
    if (needsSummedArea && !cached.summedArea) {
      cached.summedArea = getOrCreateMasterStepSummedArea(cached.mask);
    }
    return {
      cacheHit: true,
      elapsedMs: nowMs() - startedAt,
      mask: cached.mask,
      ...(cached.summedArea ? { summedArea: cached.summedArea } : {}),
    };
  }

  const mask = dilateObstacleMask(input.routeObstacleMask, input.routeTolerancePlanePixels);
  const entry: MasterRouteMaskCacheEntry = {
    mask,
    ...(needsSummedArea ? { summedArea: getOrCreateMasterStepSummedArea(mask) } : {}),
  };
  masterRouteMaskCache.set(cacheKey, entry);
  return {
    cacheHit: false,
    elapsedMs: nowMs() - startedAt,
    mask,
    ...(entry.summedArea ? { summedArea: entry.summedArea } : {}),
  };
}

/** Master 内同一个 route mask 的 Step 前缀和只构建一次，供 smart 与多批 DAG 建边复用。 */
function getOrCreateMasterStepSummedArea(mask: Uint8Array) {
  const cached = masterStepSummedAreaCache.get(mask);
  if (cached) {
    return cached;
  }
  const summedArea = createGraphwarStepRouteSummedArea(mask);
  masterStepSummedAreaCache.set(mask, summedArea);
  return summedArea;
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

function validateSmartPathfindingTrajectory(
  input: GraphwarSmartPathfindingPathInput,
  points: readonly PixelPoint[],
  stepContext?: SmartStepRouteContext,
) {
  if (!pathFollowsGraphRule(points, input.bounds, input.boundsRect)) {
    return {
      followsGraphRule: false,
      reachesTargetBeforeObstacle: false,
    };
  }
  if (
    stepContext &&
    !validateGraphwarStepRoutePath({
      boundaryInset: input.boundaryExpansion,
      bounds: input.bounds,
      boundsRect: input.boundsRect,
      model: stepContext.model,
      points,
      summedArea: stepContext.summedArea,
    }).ok
  ) {
    return {
      followsGraphRule: true,
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

function optimizeSmartPathfindingPath(
  input: GraphwarSmartPathfindingPathInput,
  points: readonly PixelPoint[],
  stepContext?: SmartStepRouteContext,
) {
  let optimized = [...points];
  let changed = true;
  const firstOptimizableIndex = Math.max(1, input.sourcePath.length);
  while (changed) {
    changed = false;
    for (let index = firstOptimizableIndex; index < optimized.length - 1 && optimized.length > 2; index += 1) {
      const candidatePath = [...optimized.slice(0, index), ...optimized.slice(index + 1)];
      const validation = validateSmartPathfindingTrajectory(input, candidatePath, stepContext);
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
  const startedAt = nowMs();
  const timings: GraphwarOneClickClearDebugTiming[] = [];
  const isStepRoute = input.settings.algorithm === "step";
  const routeMaskLookup = getMasterRouteMaskFromBase(input, isStepRoute);
  timings.push({
    elapsedMs: routeMaskLookup.elapsedMs,
    stage: routeMaskLookup.cacheHit ? "route-mask-cache-hit" : "route-mask-cache-miss",
  });
  let stepRouteValidationContext: SmartStepRouteContext | undefined;
  if (isStepRoute && routeMaskLookup.summedArea) {
    const originPoint = input.pathPoints[0];
    const model = originPoint
      ? createGraphwarStepRouteModel(imageToGraphPoint(originPoint, input.bounds, input.boundsRect).y, input.settings)
      : undefined;
    if (model) {
      stepRouteValidationContext = { model, summedArea: routeMaskLookup.summedArea };
      const validationStartedAt = nowMs();
      const prefixValidation = validateGraphwarStepRoutePath({
        boundaryInset: input.boundaryExpansion,
        bounds: input.bounds,
        boundsRect: input.boundsRect,
        model,
        points: input.pathPoints,
        summedArea: routeMaskLookup.summedArea,
      });
      timings.push({
        elapsedMs: nowMs() - validationStartedAt,
        stage: "validate-prefix",
      });
      if (!prefixValidation.ok) {
        return {
          result: {
            elapsedMs: nowMs() - startedAt,
            expandedStates: 0,
            ...(prefixValidation.invalidSegmentIndex === undefined
              ? {}
              : { invalidSegmentIndex: prefixValidation.invalidSegmentIndex }),
            reason: "preflight-blocked",
            type: "failure",
          },
          timings,
        };
      }
    }
  }
  let dagEdgeSession: OneClickClearDagEdgeSession | undefined;
  let result: GraphwarOneClickClearPathWorkerResult["result"];
  try {
    result = await buildGraphwarOneClickClearPath({
      boundaryExpansion: input.boundaryExpansion,
      buildDagEdges: (request) => {
        dagEdgeSession ??= createOneClickClearDagEdgeSession(request);
        return dagEdgeSession.runBatch(request.jobs);
      },
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
      ...(stepRouteValidationContext
        ? {
            validateStepRoute: (points) =>
              validateGraphwarStepRoutePath({
                boundaryInset: input.boundaryExpansion,
                bounds: input.bounds,
                boundsRect: input.boundsRect,
                model: stepRouteValidationContext.model,
                points,
                summedArea: stepRouteValidationContext.summedArea,
              }).ok,
          }
        : {}),
    });
  } finally {
    if (dagEdgeSession) {
      timings.push(...dagEdgeSession.dispose());
    }
  }
  return { result, timings };
}

async function buildOneClickClearDagEdges(
  input: GraphwarOneClickClearDagEdgesWorkerInput,
): Promise<GraphwarOneClickClearDagEdgeBuildResult> {
  const session = createOneClickClearDagEdgeSession(input);
  try {
    const result = await session.runBatch(input.jobs);
    return {
      routes: result.routes,
      timings: [...result.timings, ...session.dispose()],
    };
  } catch (error) {
    session.dispose();
    throw error;
  }
}

/**
 * 一次一键清图请求共用的 DAG 建边 session。
 *
 * Step 动态 DAG 会按 x 层多次提交批次；session 让 child worker、可视图预处理和 Theta* scratch 跨批次复用。
 */
function createOneClickClearDagEdgeSession(
  input: GraphwarOneClickClearDagEdgesWorkerInput,
): OneClickClearDagEdgeSession {
  const requestedWorkerCount = Math.floor(input.workerCount);
  const configuredWorkerCount =
    Number.isFinite(requestedWorkerCount) && requestedWorkerCount > 0 ? requestedWorkerCount : 1;
  const handles: EdgeWorkerHandle[] = [];
  const workerTimings: GraphwarOneClickClearDebugTiming[] = [];
  let activeBatch: OneClickClearDagEdgeBatch | undefined;
  let fallbackWorkerCount = 1;
  let nextRequestId = 1;
  let serialBatchRunning = false;
  let serialRouteContext: GraphwarOneClickClearDagEdgeRouteBuildContext | undefined;
  let state: OneClickClearDagEdgeSessionState = "idle";

  const getSerialRouteContext = () => {
    serialRouteContext ??= createOneClickClearSerialRouteContext(input);
    return serialRouteContext;
  };

  const finishWorker = (handle: EdgeWorkerHandle) => {
    if (handle.finished) {
      return;
    }
    handle.finished = true;
    handle.activeJob = undefined;
    handle.activeRequestId = undefined;
    handle.cleanup();
    handle.worker.terminate();
    workerTimings.push({
      detail: {
        type: "dag-edge-worker",
        workerIndex: handle.workerIndex,
      },
      elapsedMs: nowMs() - handle.startedAt,
      stage: "build-dag-edges",
    });
  };

  const dispose = () => {
    if (state === "disposed") {
      return [];
    }
    state = "disposed";
    const batch = activeBatch;
    activeBatch = undefined;
    if (batch && !batch.settled) {
      batch.settled = true;
      batch.reject(new Error("One-Click Clear DAG edge session was disposed"));
    }
    for (const handle of handles) {
      finishWorker(handle);
    }
    return workerTimings.splice(0);
  };

  const runSerialJobs = async (jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[]) => {
    if (serialBatchRunning) {
      throw new Error("One-Click Clear DAG edge batches must run sequentially");
    }
    serialBatchRunning = true;
    try {
      return await runOneClickClearDagEdgeJobsSerial(getSerialRouteContext(), jobs);
    } finally {
      serialBatchRunning = false;
    }
  };

  const runSerialBatch = async (
    jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[],
    mode: "parallel-fallback" | "serial",
    workerCount: number,
  ) => {
    const serial = await runSerialJobs(jobs);
    return createOneClickClearDagEdgeBuildResult(serial.routes, mode, workerCount, serial.totals);
  };

  const resolveParallelBatch = (batch: OneClickClearDagEdgeBatch) => {
    if (batch.settled || batch.completedJobIds.size < batch.jobs.length) {
      return;
    }
    batch.settled = true;
    activeBatch = undefined;
    state = "idle";
    batch.resolve(
      createOneClickClearDagEdgeBuildResult(
        collectOneClickClearDagEdgeBatchRoutes(batch),
        "parallel",
        batch.workerCount,
        batch.totals,
      ),
    );
  };

  const switchToSerialFallback = () => {
    if (state === "disposed" || state === "fallback") {
      return;
    }
    const batch = activeBatch;
    fallbackWorkerCount = Math.max(fallbackWorkerCount, batch?.workerCount ?? handles.length, 1);
    state = "fallback";
    for (const handle of handles) {
      finishWorker(handle);
    }
    if (!batch || batch.settled) {
      return;
    }

    batch.settled = true;
    activeBatch = undefined;
    const remainingJobs = batch.jobs.filter((job) => !batch.completedJobIds.has(job.id));
    void runSerialJobs(remainingJobs)
      .then((serial) => {
        for (const route of serial.routes) {
          batch.routesByJobId.set(route.jobId, route);
        }
        batch.resolve(
          createOneClickClearDagEdgeBuildResult(
            collectOneClickClearDagEdgeBatchRoutes(batch),
            "parallel-fallback",
            fallbackWorkerCount,
            {
              routeMapPixelsElapsedMs: batch.totals.routeMapPixelsElapsedMs + serial.totals.routeMapPixelsElapsedMs,
              routePathfindingElapsedMs:
                batch.totals.routePathfindingElapsedMs + serial.totals.routePathfindingElapsedMs,
            },
          ),
        );
      })
      .catch((error: unknown) => {
        batch.reject(error instanceof Error ? error : new Error(String(error)));
      });
  };

  const assignNextJob = (handle: EdgeWorkerHandle) => {
    const batch = activeBatch;
    if (state !== "running" || !batch || batch.settled || handle.finished || !handle.ready || handle.activeJob) {
      return;
    }
    const job = batch.jobs[batch.nextJobIndex];
    if (!job) {
      resolveParallelBatch(batch);
      return;
    }
    batch.nextJobIndex += 1;

    const requestId = nextRequestId;
    nextRequestId += 1;
    handle.activeJob = job;
    handle.activeRequestId = requestId;
    try {
      handle.worker.postMessage({
        job,
        requestId,
        type: "job",
      } satisfies GraphwarOneClickClearEdgeWorkerRequest);
    } catch {
      handle.activeJob = undefined;
      handle.activeRequestId = undefined;
      switchToSerialFallback();
    }
  };

  const handleJobResult = (
    handle: EdgeWorkerHandle,
    requestId: number,
    result: GraphwarOneClickClearEdgeWorkerJobResult,
  ) => {
    const batch = activeBatch;
    const activeJob = handle.activeJob;
    if (
      state !== "running" ||
      !batch ||
      batch.settled ||
      !activeJob ||
      handle.activeRequestId !== requestId ||
      activeJob.id !== result.jobId
    ) {
      return;
    }

    batch.completedJobIds.add(result.jobId);
    batch.totals.routePathfindingElapsedMs += result.routePathfindingElapsedMs;
    batch.totals.routeMapPixelsElapsedMs += result.routeMapPixelsElapsedMs;
    batch.routesByJobId.set(result.jobId, createOneClickClearDagEdgeRoute(result));
    handle.activeJob = undefined;
    handle.activeRequestId = undefined;
    assignNextJob(handle);
    resolveParallelBatch(batch);
  };

  const createEdgeWorkerHandle = (workerIndex: number) => {
    const worker = new Worker(new URL("./one-click-clear/edge.worker.ts", import.meta.url), {
      name: `graphwar-one-click-clear-edge-${workerIndex}`,
      type: "module",
    });
    const handle: EdgeWorkerHandle = {
      cleanup: () => cleanup(),
      finished: false,
      ready: false,
      startedAt: nowMs(),
      worker,
      workerIndex,
    };
    const handleMessage = (event: MessageEvent<GraphwarOneClickClearEdgeWorkerResponse>) => {
      const response = event.data;
      if (response.workerIndex !== handle.workerIndex || handle.finished) {
        return;
      }
      if (response.type === "ready") {
        handle.ready = true;
        assignNextJob(handle);
        return;
      }
      if (response.type === "error") {
        switchToSerialFallback();
        return;
      }
      handleJobResult(handle, response.requestId, response.result);
    };
    const handleMessageError = () => switchToSerialFallback();
    const handleError = () => switchToSerialFallback();
    const cleanup = () => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("messageerror", handleMessageError);
      worker.removeEventListener("error", handleError);
    };
    worker.addEventListener("message", handleMessage);
    worker.addEventListener("messageerror", handleMessageError);
    worker.addEventListener("error", handleError);
    handles.push(handle);
    try {
      worker.postMessage({
        context: {
          bounds: input.bounds,
          boundsRect: input.boundsRect,
          boundaryExpansion: input.boundaryExpansion,
          routeMask: input.routeMask,
          routeOriginPoint: input.routeOriginPoint,
          routeMode: input.routeMode,
          routeTolerancePlanePixels: input.routeTolerancePlanePixels,
          settings: input.settings,
          workerIndex,
        },
        type: "init",
      } satisfies GraphwarOneClickClearEdgeWorkerRequest);
    } catch {
      switchToSerialFallback();
    }
  };

  const ensureWorkerCount = (workerCount: number) => {
    while (handles.length < workerCount && state === "running") {
      try {
        createEdgeWorkerHandle(handles.length + 1);
      } catch {
        switchToSerialFallback();
      }
    }
  };

  const runParallelBatch = (jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[], workerCount: number) =>
    new Promise<GraphwarOneClickClearDagEdgeBuildResult>((resolve, reject) => {
      const batch: OneClickClearDagEdgeBatch = {
        completedJobIds: new Set(),
        jobs,
        nextJobIndex: 0,
        reject,
        resolve,
        routesByJobId: new Map(),
        settled: false,
        totals: {
          routeMapPixelsElapsedMs: 0,
          routePathfindingElapsedMs: 0,
        },
        workerCount,
      };
      activeBatch = batch;
      state = "running";
      ensureWorkerCount(workerCount);
      for (const handle of handles) {
        assignNextJob(handle);
      }
    });

  const runBatch = async (jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[]) => {
    if (state === "disposed") {
      throw new Error("One-Click Clear DAG edge session is disposed");
    }
    if (state === "running" || serialBatchRunning) {
      throw new Error("One-Click Clear DAG edge batches must run sequentially");
    }
    if (jobs.length === 0) {
      return { routes: [], timings: [] };
    }
    if (state === "fallback") {
      return runSerialBatch(jobs, "parallel-fallback", fallbackWorkerCount);
    }

    const workerApiAvailable = typeof Worker !== "undefined";
    if (!workerApiAvailable || configuredWorkerCount <= 1 || (handles.length === 0 && jobs.length <= 1)) {
      state = "running";
      try {
        return await runSerialBatch(jobs, "serial", 1);
      } finally {
        if (state === "running") {
          state = "idle";
        }
      }
    }

    const workerCount = Math.min(configuredWorkerCount, jobs.length);
    return runParallelBatch(jobs, workerCount);
  };

  return { dispose, runBatch };
}

/** 串行与 parallel-fallback 共用同一份请求级预处理材料。 */
function createOneClickClearSerialRouteContext(
  input: GraphwarOneClickClearDagEdgesWorkerInput,
): GraphwarOneClickClearDagEdgeRouteBuildContext {
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
  const stepRouteModel = createGraphwarStepRouteModel(
    imageToGraphPoint(input.routeOriginPoint, input.bounds, input.boundsRect).y,
    input.settings,
  );
  return {
    boundaryExpansion: input.boundaryExpansion,
    bounds: input.bounds,
    boundsRect: input.boundsRect,
    routeMask: input.routeMask,
    routeMode: input.routeMode,
    routeTolerancePlanePixels: input.routeTolerancePlanePixels,
    stepRouteRequired: input.settings.algorithm === "step",
    ...(stepRouteModel
      ? {
          stepRouteModel,
          stepRouteSummedArea: getOrCreateMasterStepSummedArea(input.routeMask),
        }
      : {}),
    ...(thetaStarScratch ? { thetaStarScratch } : {}),
    ...(visibilityGraphObstacleData ? { visibilityGraphObstacleData } : {}),
  };
}

/** 按输入顺序串行建边；调用方负责 session 状态与 mode timing。 */
async function runOneClickClearDagEdgeJobsSerial(
  context: GraphwarOneClickClearDagEdgeRouteBuildContext,
  jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[],
) {
  const routes: GraphwarOneClickClearDagEdgeRoute[] = [];
  const totals: EdgeRouteTimingTotals = {
    routeMapPixelsElapsedMs: 0,
    routePathfindingElapsedMs: 0,
  };
  for (const job of jobs) {
    const result = await buildOneClickClearDagEdgeRoute(context, job);
    totals.routePathfindingElapsedMs += result.routePathfindingElapsedMs;
    totals.routeMapPixelsElapsedMs += result.routeMapPixelsElapsedMs;
    routes.push(createOneClickClearDagEdgeRoute(result));
  }
  return { routes, totals };
}

function createOneClickClearDagEdgeBuildResult(
  routes: readonly GraphwarOneClickClearDagEdgeRoute[],
  mode: "parallel" | "parallel-fallback" | "serial",
  workerCount: number,
  totals: EdgeRouteTimingTotals,
): GraphwarOneClickClearDagEdgeBuildResult {
  return {
    routes,
    timings: [
      {
        detail: {
          mode,
          type: "dag-edge-mode",
          workerCount,
        },
        elapsedMs: 0,
        stage: "build-dag-edges",
      },
      ...createRouteTimingEntries(totals),
    ],
  };
}

/** 并行完成顺序不稳定；最终始终按提交 jobs 顺序合并。 */
function collectOneClickClearDagEdgeBatchRoutes(batch: OneClickClearDagEdgeBatch) {
  return batch.jobs.map((job) => batch.routesByJobId.get(job.id) ?? { jobId: job.id });
}

/** 把单边 worker 结果合并回 DAG 边结果；默认没有 route 表示不可达边，jobId 仍用于稳定匹配边。 */
function createOneClickClearDagEdgeRoute(
  result: Pick<GraphwarOneClickClearEdgeWorkerJobResult, "jobId" | "resolvedEndStateKey" | "resolvedEndY" | "route">,
): GraphwarOneClickClearDagEdgeRoute {
  return result.route
    ? {
        jobId: result.jobId,
        ...(result.resolvedEndStateKey === undefined ? {} : { resolvedEndStateKey: result.resolvedEndStateKey }),
        ...(result.resolvedEndY === undefined ? {} : { resolvedEndY: result.resolvedEndY }),
        route: result.route,
      }
    : { jobId: result.jobId };
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
