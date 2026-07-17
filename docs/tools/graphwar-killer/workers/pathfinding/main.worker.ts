import { normalizePathForMinimumForwardStep, pathFollowsGraphRule } from "../../core/game/forward-rule";
import { graphToImagePoint, imageToGraphPoint } from "../../core/geometry";
import { planeGridCellCenterToImagePoint } from "../../core/plane-grid";
import { measureSyncStage, nowMs } from "../../core/time";
import { createGraphPoint, type GraphBounds, type GraphPoint, type PixelPoint } from "../../core/types";
/** Graphwar 几何寻路 master worker：普通寻路直接跑，一键清图 DAG 边交给子 worker pool。 */
import { dilateObstacleMask } from "../../detection/objects";
import { formulaModeUsesStepGlitch } from "../../formula/generation/capabilities";
import type {
  GraphwarTrajectoryFormulaSettings,
  GraphwarTrajectoryTargetCircle,
} from "../../formula/trajectory/sampling";
import { compareGraphwarPathErrors } from "../../formula/trajectory/sampling";
import { createGraphwarTrajectoryFormulaSettingsIdentity } from "../../formula/trajectory/settings-identity";
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
  replayGraphwarStepGlitchPathToControlX,
  scanGraphwarStepGlitchPath,
  type GraphwarStepGlitchPrefixEvidence,
  type GraphwarStepGlitchScanTimingStage,
} from "../../pathfinding/routing/step-glitch-scan";
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
import { createGraphwarSmartPathfindingTrajectoryResult } from "../../pathfinding/smart/trajectory";

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

/** Master Worker 缓存的一份可视图障碍数据。 */
interface MasterVisibilityGraphCacheEntry {
  /** Master worker 内部保留的 route mask 引用；cache 引用相等检查必须用它。 */
  routeMask: Uint8Array;
  /** 与 routeMask、方向和 route tolerance 绑定的可视图 cache。 */
  visibilityGraphObstacleData: GraphwarVisibilityGraphObstacleData;
}

/** Route mask 查询结果及其缓存耗时。 */
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

/** 基础 mask 派生后的路线 mask 与可选可视图数据。 */
interface MasterRouteMaskCacheEntry {
  mask: Uint8Array;
  summedArea?: GraphwarPlaneMaskSummedArea;
}

type RouteRuntimeOptions = Pick<
  GraphwarPathfindingOptions,
  "estimateRemainingSecondaryCost" | "evaluateEdge" | "initialRouteState" | "initialRouteStateKey"
>;

/** Step 智能寻路复用的包络和前缀平台状态。 */
interface SmartStepRouteContext {
  model: GraphwarStepRouteModel;
  summedArea: GraphwarPlaneMaskSummedArea;
}

/** Master route mask 缓存只需读取的输入字段。 */
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

/** 一个边 Worker 的就绪、任务与完成状态。 */
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

/** 边 Worker 批次聚合的建模、寻路和映射耗时。 */
interface EdgeRouteTimingTotals {
  /** 平面几何寻路累计耗时。 */
  routePathfindingElapsedMs: number;
  /** 平面路线映射到截图像素的累计耗时。 */
  routeMapPixelsElapsedMs: number;
}

type OneClickClearDagEdgeSessionState = "disposed" | "fallback" | "idle" | "running";

/** 当前 DAG 建边批次的作业、结果和结算状态。 */
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

/** 一次复用 edge Worker 池的请求级会话。 */
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
let masterStepGlitchEvidence: MasterStepGlitchEvidence | undefined;

/** Master 缓存的邪道前缀证据及其输入身份。 */
interface MasterStepGlitchEvidence extends GraphwarStepGlitchPrefixEvidence {
  /** 只有精确最终整式输入相同才能复用 acceptedPoint。 */
  key: string;
}

/** 接收页面请求，并将异步搜索交给统一的 master 分派入口。 */
workerScope.addEventListener("message", (event: MessageEvent<GraphwarPathfindingWorkerRequest>) => {
  void handleRequest(event.data);
});

/** 将单个 master 请求分派到对应搜索流程，并统一序列化异常。 */
async function handleRequest(request: GraphwarPathfindingWorkerRequest) {
  try {
    if (request.task.type === "find-route") {
      const input = request.task.input;
      postResponse({
        id: request.id,
        result: await findRouteForMask(
          request.id,
          input,
          masterVisibilityGraphCache.get(createMasterVisibilityGraphCacheKey(input))?.routeMask ?? input.routeMask,
        ),
        taskType: "find-route",
        type: "success",
      });
      return;
    }

    if (request.task.type === "find-smart-path") {
      postResponse({
        id: request.id,
        result: await findSmartPath(request.id, request.task.input),
        taskType: "find-smart-path",
        type: "success",
      });
      return;
    }

    if (request.task.type === "build-one-click-clear-dag-edges") {
      postResponse({
        id: request.id,
        result: await buildOneClickClearDagEdges(request.task.input),
        taskType: "build-one-click-clear-dag-edges",
        type: "success",
      });
      return;
    }

    postResponse({
      id: request.id,
      result: await buildOneClickClearPath(request.id, request.task.input, request.task.reportIncumbents),
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

/** 在给定 route mask 上运行所选几何路由器，并归集搜索与可视图缓存耗时。 */
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

/** 完成智能寻路的几何搜索、轨迹验证和路径删点。 */
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

  if (formulaModeUsesStepGlitch(input.settings.algorithm, input.settings.equation, input.settings.stepGlitchMode)) {
    return findStepGlitchSmartPath(input, timings);
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
  timings.push(
    {
      elapsedMs: routeResult.visibilityCacheElapsedMs,
      stage:
        routeResult.visibilityCache === "hit"
          ? "visibility-cache-hit"
          : routeResult.visibilityCache === "miss"
            ? "visibility-cache-miss"
            : "visibility-cache-skipped",
    },
    {
      elapsedMs: routeResult.searchElapsedMs,
      stage: "search-route",
    },
  );
  if (!routeResult.path || routeResult.path.length < 2) {
    return { failureReason: "route", timings };
  }

  const normalizedPath = normalizeSmartPathfindingPathFromPlanePath(routeResult.path, input.targetPoint, input);
  const validation = measureSyncStage(timings, "validate-trajectory", () =>
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
    input.deleteOptimizationEnabled && normalizedPath.length > 3
      ? measureSyncStage(timings, "optimize-path", () =>
          optimizeSmartPathfindingPath(input, normalizedPath, stepContext),
        )
      : normalizedPath;
  return { path, timings };
}

/** Step ODE 邪道单目标直接扫描控制点；不经过普通 route mask、Theta* 或可视图。 */
function findStepGlitchSmartPath(
  input: GraphwarSmartPathfindingPathInput,
  timings: GraphwarSmartPathfindingWorkerTiming[],
): GraphwarSmartPathfindingPathResult {
  const simulationMask = input.simulationMask;
  if (!simulationMask) {
    return { failureReason: "route", timings };
  }
  const prefixEvidence = getMasterStepGlitchEvidence(input, input.sourcePath, input.prefixTarget);
  const scanResult = scanGraphwarStepGlitchPath({
    bounds: input.bounds,
    boundsRect: input.boundsRect,
    hitTarget: input.hitTarget,
    ...(prefixEvidence ? { prefixEvidence } : {}),
    ...(prefixEvidence?.stepGlitchFormulaPrefix
      ? { stepGlitchFormulaPrefix: prefixEvidence.stepGlitchFormulaPrefix }
      : {}),
    ...(input.prefixTarget ? { prefixTarget: input.prefixTarget } : {}),
    // 单目标请求只从当前尾点继续；更早运行命中的士兵不属于本次目标。
    requiredTargets: [],
    settings: input.settings,
    simulationBoundaryExpansion: input.simulationBoundaryExpansion,
    simulationMask,
    sourcePath: input.sourcePath,
    targetPoint: input.targetPoint,
  });
  appendStepGlitchScanTimings(timings, scanResult.timings);
  if (!scanResult) {
    return { failureReason: "route", timings };
  }
  if (scanResult.status !== "hit") {
    const blockedPoint = scanResult.blockedPoint
      ? graphToImagePoint(scanResult.blockedPoint, input.bounds, input.boundsRect)
      : undefined;
    return {
      ...(blockedPoint ? { blockedPoint } : {}),
      failureReason: blockedPoint ? "trajectory" : "route",
      timings,
    };
  }

  const validation = measureSyncStage(timings, "validate-trajectory", () => {
    if (input.settings.stepGlitchObstacleMask !== input.simulationMask) {
      return validateSmartPathfindingTrajectory(input, scanResult.path, undefined);
    }

    // Scanner 已用同一公式 mask 完整回放到目标控制点；这里只保留不依赖轨迹采样的 x+ 规则检查。
    const followsGraphRule = pathFollowsGraphRule(scanResult.path, input.bounds, input.boundsRect);
    return {
      followsGraphRule,
      reachesTargetBeforeObstacle: followsGraphRule,
    };
  });
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

  let path = scanResult.path;
  let acceptedPoint = scanResult.acceptedPoint;
  let stepGlitchFormulaPrefix = scanResult.stepGlitchFormulaPrefix;
  if (input.deleteOptimizationEnabled && input.settings.stepGlitchObstacleMask === simulationMask) {
    const optimized = measureSyncStage(timings, "optimize-path", () =>
      optimizeStepGlitchSmartPath(
        input,
        path,
        input.hitTarget,
        acceptedPoint,
        stepGlitchFormulaPrefix,
        prefixEvidence?.stepGlitchFormulaPrefix,
      ),
    );
    path = optimized.path;
    acceptedPoint = optimized.acceptedPoint;
    stepGlitchFormulaPrefix = optimized.stepGlitchFormulaPrefix;
  } else if (input.deleteOptimizationEnabled) {
    path = measureSyncStage(timings, "optimize-path", () => optimizeSmartPathfindingPath(input, path, undefined));
  }
  setMasterStepGlitchEvidence(input, path, input.hitTarget, acceptedPoint, stepGlitchFormulaPrefix);
  return { path, timings };
}

/** 删除单目标邪道路线的非锚点，并随精确成功路径更新可发布公式前缀。 */
function optimizeStepGlitchSmartPath(
  input: GraphwarSmartPathfindingPathInput,
  points: readonly PixelPoint[],
  target: GraphwarTrajectoryTargetCircle,
  acceptedPoint: GraphPoint,
  stepGlitchFormulaPrefix: GraphwarStepGlitchPrefixEvidence["stepGlitchFormulaPrefix"],
  sourceFormulaPrefix: GraphwarStepGlitchPrefixEvidence["stepGlitchFormulaPrefix"],
) {
  let optimized = [...points];
  let optimizedAcceptedPoint = acceptedPoint;
  let optimizedFormulaPrefix = stepGlitchFormulaPrefix;
  const firstOptimizableIndex = Math.max(1, input.sourcePath.length);
  for (let index = firstOptimizableIndex; index < optimized.length - 1 && optimized.length > 2;) {
    const candidatePath = [...optimized.slice(0, index), ...optimized.slice(index + 1)];
    if (!pathFollowsGraphRule(candidatePath, input.bounds, input.boundsRect) || !input.simulationMask) {
      index += 1;
      continue;
    }
    const replay = replayGraphwarStepGlitchPathToControlX({
      bounds: input.bounds,
      boundsRect: input.boundsRect,
      controlX: imageToGraphPoint(input.targetPoint, input.bounds, input.boundsRect).x,
      path: candidatePath,
      requiredTargets: [],
      settings: input.settings,
      ...(sourceFormulaPrefix ? { stepGlitchFormulaPrefix: sourceFormulaPrefix } : {}),
      simulationBoundaryExpansion: input.simulationBoundaryExpansion,
      simulationMask: input.simulationMask,
      sourcePath: input.sourcePath,
      targetSequence: [target],
    });
    if (!replay.targetsHit || !replay.acceptedPoint) {
      index += 1;
      continue;
    }
    optimized = candidatePath;
    optimizedAcceptedPoint = replay.acceptedPoint;
    optimizedFormulaPrefix = replay.stepGlitchFormulaPrefix;
  }
  return {
    acceptedPoint: optimizedAcceptedPoint,
    path: optimized,
    ...(optimizedFormulaPrefix ? { stepGlitchFormulaPrefix: optimizedFormulaPrefix } : {}),
  };
}

/** 判断邪道证据是否可复用所需的最小输入。 */
interface MasterStepGlitchEvidenceContext {
  bounds: GraphBounds;
  boundsRect: GraphwarSmartPathfindingPathInput["boundsRect"];
  settings: GraphwarTrajectoryFormulaSettings;
  simulationBoundaryExpansion: number;
  simulationMask?: Uint8Array;
  simulationMaskCacheId: number;
}

/** 只在 Master 精确 key 命中时返回恢复点，并把等价 mask 设置重绑到本次请求。 */
function getMasterStepGlitchEvidence(
  input: MasterStepGlitchEvidenceContext,
  path: readonly PixelPoint[],
  prefixTarget: GraphwarTrajectoryTargetCircle | undefined,
): GraphwarStepGlitchPrefixEvidence | undefined {
  if (!masterStepGlitchEvidence || !masterStepGlitchEvidenceIsEnabled(input)) {
    return undefined;
  }
  const key = createMasterStepGlitchEvidenceKey(input, path, prefixTarget);
  return masterStepGlitchEvidence.key === key
    ? {
        acceptedPoint: createGraphPoint(
          masterStepGlitchEvidence.acceptedPoint.x,
          masterStepGlitchEvidence.acceptedPoint.y,
        ),
        ...(masterStepGlitchEvidence.stepGlitchFormulaPrefix
          ? {
              stepGlitchFormulaPrefix: {
                ...masterStepGlitchEvidence.stepGlitchFormulaPrefix,
                settings: input.settings,
              },
            }
          : {}),
      }
    : undefined;
}

/** 保存最近一条完整验证成功的邪道路径证据；下一次写入直接替换旧证据。 */
function setMasterStepGlitchEvidence(
  input: MasterStepGlitchEvidenceContext,
  path: readonly PixelPoint[],
  prefixTarget: GraphwarTrajectoryTargetCircle,
  acceptedPoint: GraphPoint,
  stepGlitchFormulaPrefix?: GraphwarStepGlitchPrefixEvidence["stepGlitchFormulaPrefix"],
) {
  if (!masterStepGlitchEvidenceIsEnabled(input)) {
    return;
  }
  masterStepGlitchEvidence = {
    acceptedPoint: createGraphPoint(acceptedPoint.x, acceptedPoint.y),
    key: createMasterStepGlitchEvidenceKey(input, path, prefixTarget),
    ...(stepGlitchFormulaPrefix ? { stepGlitchFormulaPrefix } : {}),
  };
}

/** 判断 master Worker 是否应保存 Step 邪道前缀证据。 */
function masterStepGlitchEvidenceIsEnabled(input: MasterStepGlitchEvidenceContext) {
  return Boolean(input.simulationMask && input.settings.stepGlitchObstacleMask === input.simulationMask);
}

/** Evidence 证明的是精确最终整式；任何会改变公式或碰撞语义的输入都进入 key。 */
function createMasterStepGlitchEvidenceKey(
  input: MasterStepGlitchEvidenceContext,
  path: readonly PixelPoint[],
  prefixTarget: GraphwarTrajectoryTargetCircle | undefined,
) {
  return JSON.stringify([
    "step-glitch-evidence-v1",
    [input.bounds.minX, input.bounds.maxX, input.bounds.minY, input.bounds.maxY],
    [input.boundsRect.x, input.boundsRect.y, input.boundsRect.width, input.boundsRect.height],
    input.simulationBoundaryExpansion,
    input.simulationMaskCacheId,
    createGraphwarTrajectoryFormulaSettingsIdentity(input.settings),
    path.map((point) => [point.x, point.y]),
    // Evidence 只恢复精确公式前缀，不保存历史士兵：后续请求从路径尾点继续，但不承诺重命中旧目标。
    prefixTarget ? [prefixTarget.center.x, prefixTarget.center.y, prefixTarget.radius] : undefined,
  ]);
}

/** 把邪道扫描阶段追加到智能寻路 Worker 耗时。 */
function appendStepGlitchScanTimings(
  timings: GraphwarSmartPathfindingWorkerTiming[],
  scanTimings: readonly { elapsedMs: number; stage: GraphwarStepGlitchScanTimingStage }[],
) {
  for (const timing of scanTimings) {
    timings.push({
      elapsedMs: timing.elapsedMs,
      stage:
        timing.stage === "validate-direct"
          ? "validate-direct-trajectory"
          : timing.stage === "prepare-prefix"
            ? "prepare-pathfinding-prefix"
            : timing.stage === "scan-candidates"
              ? "search-route"
              : timing.stage,
    });
  }
}

/** 获取或派生 master 私有 route mask，并按需补齐 Step 前缀和。 */
function getMasterRouteMaskFromBase(input: MasterRouteMaskSourceInput, needsSummedArea = false): MasterRouteMaskLookup {
  const startedAt = nowMs();
  const cacheKey = [input.routeMaskCacheId, createRouteMaskCacheKey(input.routeTolerancePlanePixels)].join("|");
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

/** 获取与 mask、方向和容差匹配的可视图预处理数据。 */
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

/** 为可视图预处理生成包含方向语义的稳定 cache key。 */
function createMasterVisibilityGraphCacheKey(
  input: Pick<GraphwarPathfindingRouteInput, "bounds" | "routeMaskCacheId" | "routeTolerancePlanePixels">,
) {
  return [
    input.routeMaskCacheId,
    input.bounds.maxX > input.bounds.minX ? "x-right" : "x-left",
    input.routeTolerancePlanePixels,
  ].join("|");
}

/** 将平面网格路线映射回截图路径，并恢复精确目标点。 */
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

/** 用 Graphwar 规则、Step 包络和真实轨迹共同验证候选路径。 */
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

  const result = createGraphwarSmartPathfindingTrajectoryResult({
    boundaryExpansion: input.simulationBoundaryExpansion,
    bounds: input.bounds,
    boundsRect: input.boundsRect,
    hitTarget: input.hitTarget,
    obstacleMask: input.simulationMask,
    points,
    settings: input.settings,
    targetHitRadiusPixels: input.hitTarget.radius,
  });
  return {
    ...(result.blockedPoint ? { blockedPoint: result.blockedPoint } : {}),
    followsGraphRule: true,
    ...(result.pathError === undefined ? {} : { pathError: result.pathError }),
    reachesTargetBeforeObstacle: result.reachesTargetBeforeObstacle,
  };
}

/** 反复移除新增控制点；同一轮都少一个点时，路径质量只作为硬验收后的最后一级 tie-break。 */
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
    let bestCandidate: PixelPoint[] | undefined;
    let bestPathError: number | undefined;
    for (let index = firstOptimizableIndex; index < optimized.length - 1 && optimized.length > 2; index += 1) {
      const candidatePath = [...optimized.slice(0, index), ...optimized.slice(index + 1)];
      const validation = validateSmartPathfindingTrajectory(input, candidatePath, stepContext);
      if (
        validation.followsGraphRule &&
        validation.reachesTargetBeforeObstacle &&
        (!bestCandidate || compareGraphwarPathErrors(validation.pathError, bestPathError) < 0)
      ) {
        bestCandidate = candidatePath;
        bestPathError = validation.pathError;
      }
    }
    if (bestCandidate) {
      optimized = bestCandidate;
      changed = true;
    }
  }
  return optimized;
}

/** 在 master 内执行完整一键清图，并管理请求级 edge Worker session。 */
async function buildOneClickClearPath(
  requestId: number,
  input: GraphwarOneClickClearPathWorkerInput,
  reportIncumbents: boolean,
): Promise<GraphwarOneClickClearPathWorkerResult> {
  const startedAt = nowMs();
  const timings: GraphwarOneClickClearDebugTiming[] = [];
  const isStepRoute = input.settings.algorithm === "step";
  const isStepGlitchRoute = formulaModeUsesStepGlitch(
    input.settings.algorithm,
    input.settings.equation,
    input.settings.stepGlitchMode,
  );
  const routeMaskLookup = getMasterRouteMaskFromBase(input, isStepRoute && !isStepGlitchRoute);
  timings.push({
    elapsedMs: routeMaskLookup.elapsedMs,
    stage: routeMaskLookup.cacheHit ? "route-mask-cache-hit" : "route-mask-cache-miss",
  });
  let stepRouteValidationContext: SmartStepRouteContext | undefined;
  if (isStepRoute && !isStepGlitchRoute && routeMaskLookup.summedArea) {
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
  let validatedStepGlitchEvidence:
    | {
        acceptedPoint: GraphPoint;
        path: readonly PixelPoint[];
        prefixTarget: GraphwarTrajectoryTargetCircle;
        stepGlitchFormulaPrefix?: GraphwarStepGlitchPrefixEvidence["stepGlitchFormulaPrefix"];
      }
    | undefined;
  let result: GraphwarOneClickClearPathWorkerResult["result"];
  try {
    // incumbent 只是观察通道；开启搜索动画或托管上报不能改变精确前缀 evidence 的复用语义。
    const prefixEvidence = isStepGlitchRoute
      ? getMasterStepGlitchEvidence(input, input.pathPoints, input.prefixTarget)
      : undefined;
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
      deleteOptimizationEnabled: input.deleteOptimizationEnabled,
      deleteHitCheckRadiusPixels: input.deleteHitCheckRadiusPixels,
      hitCandidates: input.hitCandidates,
      isCancelled: () => false,
      onDebugTiming: (timing) => timings.push(timing),
      ...(reportIncumbents
        ? {
            onValidatedIncumbent: (incumbent) =>
              postResponse({
                id: requestId,
                incumbent,
                type: "one-click-clear-incumbent",
              }),
          }
        : {}),
      ...(isStepGlitchRoute
        ? {
            onValidatedStepGlitchPath: (evidence) => {
              validatedStepGlitchEvidence = evidence;
            },
            ...(prefixEvidence ? { stepGlitchPrefixEvidence: prefixEvidence } : {}),
          }
        : {}),
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
      simulationMaskCacheId: input.simulationMaskCacheId,
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
  if (validatedStepGlitchEvidence) {
    // failure 也可能由主线程提升最后一个自然 incumbent；exact path key 可安全保存该恢复证据。
    setMasterStepGlitchEvidence(
      input,
      validatedStepGlitchEvidence.path,
      validatedStepGlitchEvidence.prefixTarget,
      validatedStepGlitchEvidence.acceptedPoint,
      validatedStepGlitchEvidence.stepGlitchFormulaPrefix,
    );
  }
  return { result, timings };
}

/** 复用请求级 edge session 构建一批 DAG 边并收集子 Worker 耗时。 */
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

  /** 终止并解绑单个 edge Worker，且只记录一次生命周期耗时。 */
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

  /** 结束请求级 session，并拒绝尚未结算的活动批次。 */
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

  /** 串行执行一组 jobs，并保护批次不得重入。 */
  const runSerialJobs = async (jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[]) => {
    if (serialBatchRunning) {
      throw new Error("One-Click Clear DAG edge batches must run sequentially");
    }
    serialBatchRunning = true;
    try {
      // 只有真正进入串行路径时才支付预处理成本；后续 fallback 批次复用同一上下文。
      serialRouteContext ??= createOneClickClearSerialRouteContext(input);
      return await runOneClickClearDagEdgeJobsSerial(serialRouteContext, jobs);
    } finally {
      serialBatchRunning = false;
    }
  };

  /** 将串行结果包装成与并行路径一致的批次响应。 */
  const runSerialBatch = async (
    jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[],
    mode: "parallel-fallback" | "serial",
    workerCount: number,
  ) => {
    const serial = await runSerialJobs(jobs);
    return createOneClickClearDagEdgeBuildResult(serial.routes, mode, workerCount, serial.totals);
  };

  /** 在所有 jobs 完成后按提交顺序结算并行批次。 */
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

  /** 子 Worker 不可用时终止池，并只补跑尚未完成的 jobs。 */
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
    // 已完成的并行 job 已写入 batch，串行 fallback 只补跑剩余部分。
    void runSerialJobs(batch.jobs.filter((job) => !batch.completedJobIds.has(job.id)))
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

  /** 向空闲且就绪的 edge Worker 分配当前批次的下一个 job。 */
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

  /** 校验请求身份后合并单边结果，并继续驱动该 Worker。 */
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

  /** 创建并初始化一个绑定当前 session 静态上下文的 edge Worker。 */
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
    /** 将 edge Worker 响应路由到就绪、失败或 job 结算流程。 */
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
    /** 将消息反序列化失败切换到串行 fallback。 */
    const handleMessageError = () => switchToSerialFallback();
    /** 将 edge Worker 运行时失败切换到串行 fallback。 */
    const handleError = () => switchToSerialFallback();
    /** 统一解绑 edge Worker 的事件监听器。 */
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

  /** 初始化并行批次状态，并启动所有可用 Worker。 */
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
      while (handles.length < workerCount && state === "running") {
        try {
          createEdgeWorkerHandle(handles.length + 1);
        } catch {
          switchToSerialFallback();
        }
      }
      for (const handle of handles) {
        assignNextJob(handle);
      }
    });

  /** 选择空批次、串行、fallback 或并行执行路径，并强制批次串行提交。 */
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

    if (typeof Worker === "undefined" || configuredWorkerCount <= 1 || (handles.length === 0 && jobs.length <= 1)) {
      state = "running";
      try {
        return await runSerialBatch(jobs, "serial", 1);
      } finally {
        if (state === "running") {
          state = "idle";
        }
      }
    }

    return runParallelBatch(jobs, Math.min(configuredWorkerCount, jobs.length));
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

/** 统一构造 DAG 建边结果及其执行模式和几何耗时。 */
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
      {
        elapsedMs: totals.routePathfindingElapsedMs,
        stage: "route-pathfinding",
      },
      {
        elapsedMs: totals.routeMapPixelsElapsedMs,
        stage: "route-map-pixels",
      },
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

/** 将 master 响应发送到主线程。 */
function postResponse(response: GraphwarPathfindingWorkerResponse) {
  workerScope.postMessage(response);
}
