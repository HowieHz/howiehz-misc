/** 在当前 Graphwar 路径后追加最佳努力清图路线。 */
import { graphToImagePoint, imageToGraphPoint } from "./geometry";
import { GRAPHWAR_PLANE_LENGTH } from "./graphwar";
import { buildSmartPathfindingPathForMask, planeGridCellCenterToImagePoint } from "./graphwar-pathfinding";
import type { PlaneGridPoint } from "./graphwar-pathfinding";
import { graphXAdvancesEnough, roundToDecimalPlaces } from "./numbers";
import type { GraphwarTrajectorySamplingState } from "./simulator";
import {
  createGraphwarTrajectoryFormulaContext,
  sampleGraphwarFormulaTrajectory,
  sampleGraphwarPathTargetSequence,
} from "./trajectory-sampling";
import type { GraphwarTrajectoryFormulaSettings, GraphwarTrajectoryTargetCircle } from "./trajectory-sampling";
import type { BoundsRect, GraphBounds, GraphPoint, PixelPoint } from "./types";

/** 一键清图可选择和验证的士兵目标。 */
export interface GraphwarOneClickClearCandidate {
  /** 识别结果里的稳定士兵 id。 */
  id: string;
  /** 是否按当前敌我规则视作敌方。 */
  enemy: boolean;
  /** 命中圈圆心，截图像素坐标。 */
  hitCenter: PixelPoint;
  /** 命中圈半径，截图像素。 */
  hitRadius: number;
}

/** 传给一键清图的 route mask。 */
export interface GraphwarOneClickClearRouteMask {
  /** 已按 tolerance 膨胀或腐蚀后的 mask。 */
  mask: Uint8Array;
  /** 与 mask 对应的路线容差，参与 cache key。 */
  routeTolerancePlanePixels: number;
}

/** 一键清图内部调试阶段；页面按这些阶段聚合耗时。 */
export type GraphwarOneClickClearDebugStage =
  | "build-targets"
  | "optimize-path"
  | "route-cache-lookup"
  | "route-map-pixels"
  | "route-pathfinding"
  | "search-state-overhead"
  | "segment-build-formula"
  | "segment-collect-hits"
  | "segment-graph-rule"
  | "segment-sample-trajectory"
  | "validate-final"
  | "validate-prefix";

/** 一键清图内部调试耗时记录。 */
export interface GraphwarOneClickClearDebugTiming {
  /** 被测量的一键清图内部阶段。 */
  stage: GraphwarOneClickClearDebugStage;
  /** 阶段耗时，单位毫秒。 */
  elapsedMs: number;
}

/** 运行一键清图所需的纯数据。 */
export interface GraphwarOneClickClearOptions {
  /** 当前障碍边界收缩值，单位为 Graphwar 原始平面像素。 */
  boundaryExpansion: number;
  /** 当前 Graphwar 坐标边界。 */
  bounds: GraphBounds;
  /** 截图内 Graphwar 棋盘矩形。 */
  boundsRect: BoundsRect;
  /** 候选士兵。 */
  candidates: readonly GraphwarOneClickClearCandidate[];
  /** 长循环取消检查。 */
  isCancelled?: () => boolean;
  /** 内部调试耗时回调；调用方负责聚合同类阶段，避免刷屏。 */
  onDebugTiming?: (timing: GraphwarOneClickClearDebugTiming) => void;
  /** 当前路径已有像素点。 */
  pathPoints: readonly PixelPoint[];
  /** 当前最后路径点的验证目标；传入士兵命中圈时可复用现有路径预检语义。 */
  prefixTarget?: GraphwarTrajectoryTargetCircle;
  /** 当前输出小数位对应的最小 Graphwar x 前进步长。 */
  minimumGraphXStep: number;
  /** 障碍路线 mask，按尝试顺序排列。 */
  routeMasks: readonly GraphwarOneClickClearRouteMask[];
  /** 函数模拟用障碍 mask。 */
  simulationMask?: Uint8Array;
  /** 函数模拟边界收缩值，单位为 Graphwar 原始平面像素。 */
  simulationBoundaryExpansion: number;
  /** 当前公式采样设置。 */
  settings: GraphwarTrajectoryFormulaSettings;
  /** 让出主线程控制权；页面用于响应取消和刷新状态。 */
  yieldControl?: () => Promise<void> | void;
}

/** 一键清图失败分类，页面用它给出可解释状态。 */
export type GraphwarOneClickClearFailureReason =
  | "no-candidate"
  | "no-usable-target"
  | "preflight-blocked"
  | "unsupported";

/** 一键清图搜索结果。 */
export type GraphwarOneClickClearResult =
  | {
      elapsedMs: number;
      expandedStates: number;
      pathPoints: PixelPoint[];
      reason?: undefined;
      targetIds: string[];
      targetSequence: GraphwarTrajectoryTargetCircle[];
      type: "success";
    }
  | {
      elapsedMs: number;
      expandedStates: number;
      reason: GraphwarOneClickClearFailureReason;
      type: "failure";
    };

interface OneClickClearTarget extends GraphwarOneClickClearCandidate {
  /** 几何寻路先进入命中圈的位置，尽量靠左。 */
  entryPoint: PixelPoint;
  /** 命中后给后续公式控制的离开位置，尽量靠右；空间不足时等于 entryPoint。 */
  exitPoint: PixelPoint;
  /** 命中圈最早稳定可瞄准的 Graphwar x，用于按 x 从低到高清图。 */
  minHitGraphX: number;
  /** 命中圈中心 Graphwar x，用于稳定排序。 */
  centerGraphX: number;
  /** 命中圈最晚稳定可瞄准的 Graphwar x，用于判断当前状态能否继续打它。 */
  maxHitGraphX: number;
  /** 命中圈参与最终顺序验证。 */
  hitCircle: GraphwarTrajectoryTargetCircle;
  /** 按当前起点排序后的位置，用于稳定 tie-break。 */
  orderIndex: number;
  /** 输入候选序号；只用于相同 x 时保持稳定。 */
  sourceIndex: number;
}

interface OneClickClearState {
  /** 已扩展出的完整像素路径。 */
  pathPoints: PixelPoint[];
  /** 当前路径最后点。 */
  lastPoint: PixelPoint;
  /** 已命中目标中最大的 x 排序序号；后续扩展只能选择更靠后的目标。 */
  lastTargetOrderIndex: number;
  /** 已明确命中的目标。 */
  targetSequence: OneClickClearTarget[];
  /** 终点处缓存的采样前缀状态，下一次扩展从这里继续。 */
  trajectoryState?: GraphwarTrajectorySamplingState;
}

interface OneClickClearSearchContext {
  candidates: readonly OneClickClearTarget[];
  options: GraphwarOneClickClearOptions;
  routeCache: Map<string, PixelPoint[] | undefined>;
  routeMaskIdCount: number;
  routeMaskIds: WeakMap<Uint8Array, number>;
}

const MAX_GLOBAL_DELETE_PASSES = 2;
/** 命中判断是严格小于半径，瞄边缘会丢命中；向圈内收一点保持稳定。 */
const ONE_CLICK_CLEAR_AIM_EDGE_INSET_PIXELS = 0.75;

/** 完整遍历 x 单调可达状态，返回当前搜索模型下击杀最多的追加路径。 */
export async function buildGraphwarOneClickClearPath(
  options: GraphwarOneClickClearOptions,
): Promise<GraphwarOneClickClearResult> {
  const startedAt = nowMs();
  if (options.settings.algorithm !== "abs" || options.settings.equation === "ddy") {
    return createOneClickClearFailure("unsupported", startedAt, 0);
  }
  if (options.pathPoints.length === 0) {
    return createOneClickClearFailure("preflight-blocked", startedAt, 0);
  }

  const prefixState =
    options.pathPoints.length >= 2
      ? measureOneClickClearDebugTiming(options, "validate-prefix", () => validateOneClickClearPrefix(options))
      : undefined;
  if (options.pathPoints.length >= 2 && !prefixState) {
    return createOneClickClearFailure("preflight-blocked", startedAt, 0);
  }

  const targets = measureOneClickClearDebugTiming(options, "build-targets", () =>
    collectReachableOneClickClearTargets(options),
  );
  if (targets.length === 0) {
    return createOneClickClearFailure("no-candidate", startedAt, 0);
  }

  const context: OneClickClearSearchContext = {
    candidates: targets,
    options,
    routeCache: new Map(),
    routeMaskIdCount: 0,
    routeMaskIds: new WeakMap(),
  };
  const initialState: OneClickClearState = {
    lastPoint: options.pathPoints.at(-1) ?? options.pathPoints[0],
    lastTargetOrderIndex: -1,
    pathPoints: [...options.pathPoints],
    targetSequence: [],
    trajectoryState: prefixState,
  };

  const pendingStates: OneClickClearState[] = [initialState];
  let best = initialState;
  let expandedStates = 0;
  while (pendingStates.length > 0) {
    const state = pendingStates.pop();
    if (!state) {
      continue;
    }
    if (options.isCancelled?.()) {
      return createOneClickClearFailure("no-usable-target", startedAt, expandedStates);
    }

    expandedStates += 1;
    for (const target of targets) {
      const stateTarget = measureOneClickClearDebugTiming(options, "search-state-overhead", () =>
        target.orderIndex <= state.lastTargetOrderIndex
          ? undefined
          : createStateOneClickClearTarget(options, state, target),
      );
      if (!stateTarget) {
        continue;
      }

      const nextState = await expandOneClickClearState(context, state, stateTarget);
      if (!nextState) {
        continue;
      }
      best = measureOneClickClearDebugTiming(options, "search-state-overhead", () => {
        pendingStates.push(nextState);
        return compareOneClickClearStates(nextState, best) < 0 ? nextState : best;
      });
    }
    const yielded = options.yieldControl?.();
    if (yielded) {
      await yielded;
    }
  }

  if (best.targetSequence.length === 0) {
    return createOneClickClearFailure("no-usable-target", startedAt, expandedStates);
  }

  const optimized = await measureOneClickClearDebugTimingAsync(options, "optimize-path", () =>
    optimizeOneClickClearPath(context, best, expandedStates),
  );
  const finalState = optimized.state;
  expandedStates = optimized.expandedStates;
  const finalValidation = measureOneClickClearDebugTiming(options, "validate-final", () =>
    validateOneClickClearTargetSequence(options, finalState),
  );
  if (!finalValidation) {
    return createOneClickClearFailure("no-usable-target", startedAt, expandedStates);
  }

  return {
    elapsedMs: Math.max(0, nowMs() - startedAt),
    expandedStates,
    pathPoints: finalState.pathPoints,
    targetIds: finalState.targetSequence.map((target) => target.id),
    targetSequence: finalState.targetSequence.map((target) => target.hitCircle),
    type: "success",
  };
}

/** 当前 prefix 已经命中当前最后路径点后，后续扩展才能使用其采样状态。 */
function validateOneClickClearPrefix(options: GraphwarOneClickClearOptions) {
  if (options.pathPoints.length < 2) {
    return undefined;
  }

  const target = options.prefixTarget ?? {
    center: options.pathPoints.at(-1) ?? options.pathPoints[0],
    radius: 1,
  };
  const result = sampleGraphwarPathTargetSequence({
    boundaryExpansion: options.simulationBoundaryExpansion,
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    obstacleMask: options.simulationMask,
    points: options.pathPoints,
    settings: options.settings,
    soldierMarkerRadius: target.radius,
    targetCircles: [target],
    targetPoints: [target.center],
  });
  return result.reachesTargetSequenceBeforeObstacle ? result.sample.endState : undefined;
}

/** 收集从当前路径末端 x+ 侧可选的士兵目标，并按 Graphwar x 从低到高稳定排序。 */
function collectReachableOneClickClearTargets(options: GraphwarOneClickClearOptions): OneClickClearTarget[] {
  const startPoint = options.pathPoints.at(-1);
  if (!startPoint) {
    return [];
  }

  const targets: OneClickClearTarget[] = [];
  for (let sourceIndex = 0; sourceIndex < options.candidates.length; sourceIndex += 1) {
    const candidate = options.candidates[sourceIndex];
    if (!candidate) {
      continue;
    }

    const target = createOneClickClearTarget(options, startPoint, candidate, sourceIndex);
    if (target) {
      targets.push(target);
    }
  }
  return targets.sort(compareOneClickClearTargetOrder).map((target, orderIndex) => ({ ...target, orderIndex }));
}

/** 构造清图目标；默认尝试从命中圈左侧进入、右侧离开，给后续目标留出更平滑的 x+ 走势。 */
function createOneClickClearTarget(
  options: GraphwarOneClickClearOptions,
  startPoint: PixelPoint,
  candidate: GraphwarOneClickClearCandidate,
  sourceIndex: number,
) {
  const centerGraph = imageToGraphPoint(candidate.hitCenter, options.bounds, options.boundsRect);
  const aimRadius = Math.max(0, candidate.hitRadius - ONE_CLICK_CLEAR_AIM_EDGE_INSET_PIXELS);
  const graphRadiusX = (aimRadius / options.boundsRect.width) * Math.abs(options.bounds.maxX - options.bounds.minX);
  const target: OneClickClearTarget = {
    ...candidate,
    entryPoint: candidate.hitCenter,
    exitPoint: candidate.hitCenter,
    centerGraphX: centerGraph.x,
    hitCircle: {
      center: candidate.hitCenter,
      radius: candidate.hitRadius,
    },
    maxHitGraphX: centerGraph.x + graphRadiusX,
    minHitGraphX: centerGraph.x - graphRadiusX,
    orderIndex: 0,
    sourceIndex,
  };
  const targetPoints = createOneClickClearTargetPoints(options, startPoint, target);
  return targetPoints ? { ...target, ...targetPoints } : undefined;
}

/** 按命中圈最早可打到的 x 排序；同 x 时用中心和输入序号保持稳定。 */
function compareOneClickClearTargetOrder(left: OneClickClearTarget, right: OneClickClearTarget) {
  return (
    left.minHitGraphX - right.minHitGraphX ||
    left.centerGraphX - right.centerGraphX ||
    left.hitCenter.y - right.hitCenter.y ||
    left.sourceIndex - right.sourceIndex
  );
}

/** 目标控制点尽量左进右出；空间不足时退化成左进左出或右进右出。 */
function createOneClickClearTargetPoints(
  options: GraphwarOneClickClearOptions,
  startPoint: PixelPoint,
  target: OneClickClearTarget,
) {
  const entryMinimumGraphX = getMinimumForwardGraphX(options, startPoint);
  if (entryMinimumGraphX === undefined) {
    return undefined;
  }

  if (!graphXReachesMinimumForward(target.maxHitGraphX, entryMinimumGraphX, options)) {
    return undefined;
  }

  const entryGraphX = Math.max(target.minHitGraphX, entryMinimumGraphX);
  const entryPoint = createOneClickClearTargetPointAtGraphX(options, target, entryGraphX);
  if (!entryPoint) {
    return undefined;
  }

  const exitMinimumGraphX = getMinimumForwardGraphX(options, entryPoint);
  const exitPoint =
    exitMinimumGraphX !== undefined && graphXReachesMinimumForward(target.maxHitGraphX, exitMinimumGraphX, options)
      ? (createOneClickClearTargetPointAtGraphX(options, target, target.maxHitGraphX) ?? entryPoint)
      : entryPoint;

  return { entryPoint, exitPoint };
}

function createOneClickClearTargetPointAtGraphX(
  options: GraphwarOneClickClearOptions,
  target: OneClickClearTarget,
  graphX: number,
) {
  const centerGraph = imageToGraphPoint(target.hitCenter, options.bounds, options.boundsRect);
  const point = graphToImagePoint({ ...centerGraph, x: graphX } as GraphPoint, options.bounds, options.boundsRect);
  return pointHitsTargetCircle(point, target.hitCenter, target.hitRadius) ? point : undefined;
}

/** 每个搜索状态都要按当前 lastPoint 重新选择当前命中圈里的左进右出控制点。 */
function createStateOneClickClearTarget(
  options: GraphwarOneClickClearOptions,
  state: OneClickClearState,
  target: OneClickClearTarget,
) {
  if (target.orderIndex <= state.lastTargetOrderIndex) {
    return undefined;
  }

  const targetPoints = createOneClickClearTargetPoints(options, state.lastPoint, target);
  return targetPoints ? { ...target, ...targetPoints } : undefined;
}

/** 扩展一个目标：几何路线缓存命中后仍必须跑增量轨迹验证。 */
async function expandOneClickClearState(
  context: OneClickClearSearchContext,
  state: OneClickClearState,
  target: OneClickClearTarget,
) {
  for (const routeMask of context.options.routeMasks) {
    const route = await getCachedOneClickClearRoute(context, state.lastPoint, target.entryPoint, routeMask);
    if (!route || route.length < 2) {
      continue;
    }

    const nextPath = appendOneClickClearRoute(context.options, state.pathPoints, route, target);
    const nextState = validateOneClickClearExtension(context, state, target, nextPath);
    if (nextState) {
      return nextState;
    }
  }
  return undefined;
}

/** 几何 route cache 的 key 覆盖实际点、mask、边界和 x+ 前进参数。 */
async function getCachedOneClickClearRoute(
  context: OneClickClearSearchContext,
  startPoint: PixelPoint,
  targetPoint: PixelPoint,
  routeMask: GraphwarOneClickClearRouteMask,
) {
  const cacheEntry = measureOneClickClearDebugTiming(context.options, "route-cache-lookup", () => {
    const key = createOneClickClearRouteCacheKey(context, startPoint, targetPoint, routeMask);
    return context.routeCache.has(key)
      ? { hit: true as const, key, route: context.routeCache.get(key) }
      : { hit: false as const, key };
  });
  if (cacheEntry.hit) {
    return cacheEntry.route;
  }

  const route = await measureOneClickClearDebugTimingAsync(context.options, "route-pathfinding", () =>
    buildSmartPathfindingPathForMask({
      bounds: context.options.bounds,
      boundsRect: context.options.boundsRect,
      boundaryExpansion: context.options.boundaryExpansion,
      canAdvance: (previous, next) => pathfindingPlaneSegmentAdvancesEnough(context.options, previous, next),
      isCancelled: context.options.isCancelled,
      routeMask: routeMask.mask,
      routeTolerancePlanePixels: routeMask.routeTolerancePlanePixels,
      startPoint,
      targetPoint,
      yieldControl: context.options.yieldControl,
    }),
  );
  const pixelRoute = measureOneClickClearDebugTiming(context.options, "route-map-pixels", () =>
    route?.map((point) => planeGridCellCenterToImagePoint(point, context.options.boundsRect)),
  );
  context.routeCache.set(cacheEntry.key, pixelRoute);
  return pixelRoute;
}

/** 创建几何 route cache key；士兵 id 不参与，因为几何只关心点到点路线。 */
function createOneClickClearRouteCacheKey(
  context: OneClickClearSearchContext,
  startPoint: PixelPoint,
  targetPoint: PixelPoint,
  routeMask: GraphwarOneClickClearRouteMask,
) {
  return [
    formatPointKey(startPoint),
    formatPointKey(targetPoint),
    getRouteMaskId(context, routeMask.mask),
    routeMask.routeTolerancePlanePixels,
    context.options.boundaryExpansion,
    formatBoundsKey(context.options.bounds),
    formatBoundsRectKey(context.options.boundsRect),
    context.options.minimumGraphXStep,
    context.options.settings.decimalPlaces,
    context.options.settings.equation,
  ].join("|");
}

/** WeakMap 只在单次搜索内标识 mask 身份，避免对 770x450 mask 做高频哈希。 */
function getRouteMaskId(context: OneClickClearSearchContext, mask: Uint8Array) {
  const existing = context.routeMaskIds.get(mask);
  if (existing !== undefined) {
    return existing;
  }
  const id = context.routeMaskIdCount;
  context.routeMaskIdCount += 1;
  context.routeMaskIds.set(mask, id);
  return id;
}

/** 把 route 追加到当前路径，首点是已有 lastPoint，需要跳过。 */
function appendOneClickClearRoute(
  options: GraphwarOneClickClearOptions,
  sourcePath: readonly PixelPoint[],
  route: readonly PixelPoint[],
  target: OneClickClearTarget,
) {
  const appended = route
    .slice(1)
    .map((point, index, points) => (index === points.length - 1 ? target.entryPoint : point));
  if (!pointsNearlyEqual(target.entryPoint, target.exitPoint)) {
    appended.push(target.exitPoint);
  }
  return normalizeOneClickClearPath(options, [...sourcePath, ...appended]);
}

/** 增量验证下一段路线，并把采样 endState 缓存到搜索状态里。 */
function validateOneClickClearExtension(
  searchContext: OneClickClearSearchContext,
  state: OneClickClearState,
  target: OneClickClearTarget,
  nextPath: PixelPoint[],
) {
  const options = searchContext.options;
  const followsGraphRule = measureOneClickClearDebugTiming(options, "segment-graph-rule", () =>
    oneClickClearPathFollowsGraphRule(options, nextPath),
  );
  if (!followsGraphRule) {
    return undefined;
  }

  const formulaContext = measureOneClickClearDebugTiming(options, "segment-build-formula", () => {
    const mappedPoints = nextPath.map((point) => imageToGraphPoint(point, options.bounds, options.boundsRect));
    return createGraphwarTrajectoryFormulaContext({
      bounds: options.bounds,
      points: mappedPoints,
      settings: options.settings,
      soldierCenter: mappedPoints[0],
    });
  });
  if (formulaContext.formulaPoints.length < 2) {
    return undefined;
  }

  const exitGraphX = imageToGraphPoint(target.exitPoint, options.bounds, options.boundsRect).x;
  const shouldContinueToExit = !pointsNearlyEqual(target.entryPoint, target.exitPoint);
  const result = measureOneClickClearDebugTiming(options, "segment-sample-trajectory", () =>
    sampleGraphwarFormulaTrajectory({
      bounds: options.bounds,
      boundsRect: options.boundsRect,
      collision: {
        boundaryExpansion: options.simulationBoundaryExpansion,
        mask: options.simulationMask,
      },
      collectVisiblePixels: true,
      context: formulaContext,
      initialState: state.trajectoryState,
      skipInitialStop: Boolean(state.trajectoryState),
      ...(shouldContinueToExit
        ? {
            continueAfterTargetSequenceUntilGraphX: exitGraphX,
            stopOnTargetSequenceComplete: false,
          }
        : {}),
      targetSequence: [target.hitCircle],
    }),
  );
  if (
    result.reachedTargetCount < 1 ||
    !result.sample.endState ||
    result.earlyStopReason === "obstacle" ||
    (shouldContinueToExit && result.sample.endState.currentPoint.x < exitGraphX)
  ) {
    return undefined;
  }

  const hitTargets = measureOneClickClearDebugTiming(options, "segment-collect-hits", () =>
    collectOneClickClearSegmentHits(searchContext, state, target, result.visiblePixels),
  );
  if (!hitTargets.some((hitTarget) => hitTarget.id === target.id)) {
    return undefined;
  }

  const lastHitTarget = hitTargets.at(-1) ?? target;
  return {
    lastPoint: nextPath.at(-1) ?? state.lastPoint,
    lastTargetOrderIndex: lastHitTarget.orderIndex,
    pathPoints: nextPath,
    targetSequence: [...state.targetSequence, ...hitTargets],
    trajectoryState: result.sample.endState,
  };
}

/** 扫描这一段真实轨迹，把显式目标前顺手命中的候选也计入击杀序列。 */
function collectOneClickClearSegmentHits(
  context: OneClickClearSearchContext,
  state: OneClickClearState,
  target: OneClickClearTarget,
  visiblePixels: readonly PixelPoint[],
) {
  const hitTargets: OneClickClearTarget[] = [];
  let lastOrderIndex = state.lastTargetOrderIndex;

  for (const pixel of visiblePixels) {
    for (const candidate of context.candidates) {
      if (
        candidate.orderIndex <= lastOrderIndex ||
        candidate.orderIndex > target.orderIndex ||
        !pointHitsTargetCircle(pixel, candidate.hitCenter, candidate.hitRadius)
      ) {
        continue;
      }

      const hitTarget = candidate.id === target.id ? target : candidate;
      hitTargets.push(hitTarget);
      lastOrderIndex = hitTarget.orderIndex;
    }
  }

  return hitTargets;
}

/** 最终整路验证必须重采样完整路径，不能只信增量状态。 */
function validateOneClickClearTargetSequence(options: GraphwarOneClickClearOptions, state: OneClickClearState) {
  const targetSequence = state.targetSequence.map((target) => target.hitCircle);
  const result = sampleGraphwarPathTargetSequence({
    boundaryExpansion: options.simulationBoundaryExpansion,
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    obstacleMask: options.simulationMask,
    points: state.pathPoints,
    settings: options.settings,
    soldierMarkerRadius: 1,
    targetCircles: targetSequence,
    targetPoints: targetSequence.map((target) => target.center),
  });
  return result.reachesTargetSequenceBeforeObstacle;
}

/** 全局删点只删除生成的中间 route 点，不碰原 prefix 和目标命中点。 */
async function optimizeOneClickClearPath(
  context: OneClickClearSearchContext,
  state: OneClickClearState,
  expandedStates: number,
) {
  let optimized = state;
  const firstGeneratedIndex = context.options.pathPoints.length;
  for (let pass = 0; pass < MAX_GLOBAL_DELETE_PASSES; pass += 1) {
    let changed = false;
    for (let index = firstGeneratedIndex; index < optimized.pathPoints.length - 1; index += 1) {
      if (context.options.isCancelled?.()) {
        return { expandedStates, state: optimized };
      }
      if (oneClickClearDeleteIndexIsProtected(context.options, optimized, index)) {
        continue;
      }

      const candidatePath = [...optimized.pathPoints.slice(0, index), ...optimized.pathPoints.slice(index + 1)];
      expandedStates += 1;
      if (!oneClickClearPathFollowsGraphRule(context.options, candidatePath)) {
        continue;
      }
      const candidateState = {
        ...optimized,
        pathPoints: candidatePath,
        lastPoint: candidatePath.at(-1) ?? optimized.lastPoint,
      };
      if (validateOneClickClearTargetSequence(context.options, candidateState)) {
        optimized = candidateState;
        changed = true;
        break;
      }

      const yielded = context.options.yieldControl?.();
      if (yielded) {
        await yielded;
      }
    }
    if (!changed) {
      break;
    }
  }
  return { expandedStates, state: optimized };
}

/** 保护原 prefix 和目标命中点；删除后索引会漂移，所以每次按当前路径重新判断。 */
function oneClickClearDeleteIndexIsProtected(
  options: GraphwarOneClickClearOptions,
  state: OneClickClearState,
  index: number,
) {
  if (index < options.pathPoints.length) {
    return true;
  }

  const point = state.pathPoints[index];
  return Boolean(
    point &&
    state.targetSequence.some(
      (target) => pointsNearlyEqual(point, target.entryPoint) || pointsNearlyEqual(point, target.exitPoint),
    ),
  );
}

/** 搜索完整遍历，比较器只决定最终相同击杀数时选哪条更短、更靠左的路线。 */
function compareOneClickClearStates(left: OneClickClearState, right: OneClickClearState) {
  return (
    right.targetSequence.length - left.targetSequence.length ||
    countEnemyTargets(right) - countEnemyTargets(left) ||
    left.pathPoints.length - right.pathPoints.length ||
    left.lastTargetOrderIndex - right.lastTargetOrderIndex
  );
}

function countEnemyTargets(state: OneClickClearState) {
  return state.targetSequence.filter((target) => target.enemy).length;
}

function getMinimumForwardGraphX(options: GraphwarOneClickClearOptions, startPoint: PixelPoint) {
  const startGraph = imageToGraphPoint(startPoint, options.bounds, options.boundsRect);
  const roundedStartX = roundToDecimalPlaces(startGraph.x, options.settings.decimalPlaces);
  return roundToDecimalPlaces(roundedStartX + options.minimumGraphXStep, options.settings.decimalPlaces);
}

function graphXReachesMinimumForward(graphX: number, minimumGraphX: number, options: GraphwarOneClickClearOptions) {
  return graphXAdvancesEnough(
    roundToDecimalPlaces(graphX, options.settings.decimalPlaces) - minimumGraphX + options.minimumGraphXStep,
    options.minimumGraphXStep,
    minimumGraphX - options.minimumGraphXStep,
    graphX,
  );
}

function pathfindingPlaneSegmentAdvancesEnough(
  options: GraphwarOneClickClearOptions,
  previous: PlaneGridPoint,
  next: PlaneGridPoint,
) {
  const previousGraphX = planeGridPointToGraphX(options, previous);
  const nextGraphX = planeGridPointToGraphX(options, next);
  return graphXAdvancesEnough(
    roundToDecimalPlaces(nextGraphX, options.settings.decimalPlaces) -
      roundToDecimalPlaces(previousGraphX, options.settings.decimalPlaces),
    options.minimumGraphXStep,
    previousGraphX,
    nextGraphX,
  );
}

function planeGridPointToGraphX(options: GraphwarOneClickClearOptions, point: PlaneGridPoint) {
  return options.bounds.minX + ((point.x + 0.5) / GRAPHWAR_PLANE_LENGTH) * (options.bounds.maxX - options.bounds.minX);
}

function normalizeOneClickClearPath(options: GraphwarOneClickClearOptions, points: readonly PixelPoint[]) {
  if (points.length < 2) {
    return [...points];
  }

  const normalized = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const previous = normalized.at(-1);
    const current = points[index];
    if (!previous || !current) {
      continue;
    }

    const currentGraph = imageToGraphPoint(current, options.bounds, options.boundsRect);
    const minimumGraphX = getMinimumForwardGraphX(options, previous);
    if (minimumGraphX !== undefined && !graphXReachesMinimumForward(currentGraph.x, minimumGraphX, options)) {
      normalized.push(
        graphToImagePoint({ ...currentGraph, x: minimumGraphX } as GraphPoint, options.bounds, options.boundsRect),
      );
    } else {
      normalized.push(current);
    }
  }
  return normalized;
}

function oneClickClearPathFollowsGraphRule(options: GraphwarOneClickClearOptions, points: readonly PixelPoint[]) {
  for (let index = 1; index < points.length; index += 1) {
    const previous = imageToGraphPoint(points[index - 1], options.bounds, options.boundsRect);
    const next = imageToGraphPoint(points[index], options.bounds, options.boundsRect);
    if (
      !graphXAdvancesEnough(
        roundToDecimalPlaces(next.x, options.settings.decimalPlaces) -
          roundToDecimalPlaces(previous.x, options.settings.decimalPlaces),
        options.minimumGraphXStep,
        previous.x,
        next.x,
      )
    ) {
      return false;
    }
  }
  return true;
}

function pointHitsTargetCircle(point: PixelPoint, center: PixelPoint, radius: number) {
  return Math.hypot(point.x - center.x, point.y - center.y) < radius;
}

function createOneClickClearFailure(
  reason: GraphwarOneClickClearFailureReason,
  startedAt: number,
  expandedStates: number,
): GraphwarOneClickClearResult {
  return {
    elapsedMs: Math.max(0, nowMs() - startedAt),
    expandedStates,
    reason,
    type: "failure",
  };
}

function measureOneClickClearDebugTiming<TResult>(
  options: GraphwarOneClickClearOptions,
  stage: GraphwarOneClickClearDebugStage,
  task: () => TResult,
) {
  if (!options.onDebugTiming) {
    return task();
  }

  const startedAt = nowMs();
  try {
    return task();
  } finally {
    options.onDebugTiming({
      elapsedMs: nowMs() - startedAt,
      stage,
    });
  }
}

async function measureOneClickClearDebugTimingAsync<TResult>(
  options: GraphwarOneClickClearOptions,
  stage: GraphwarOneClickClearDebugStage,
  task: () => Promise<TResult>,
) {
  if (!options.onDebugTiming) {
    return task();
  }

  const startedAt = nowMs();
  try {
    return await task();
  } finally {
    options.onDebugTiming({
      elapsedMs: nowMs() - startedAt,
      stage,
    });
  }
}

function formatPointKey(point: PixelPoint) {
  return `${roundToDecimalPlaces(point.x, 6)},${roundToDecimalPlaces(point.y, 6)}`;
}

function formatBoundsKey(bounds: GraphBounds) {
  return `${bounds.minX},${bounds.maxX},${bounds.minY},${bounds.maxY}`;
}

function formatBoundsRectKey(rect: BoundsRect) {
  return `${rect.x},${rect.y},${rect.width},${rect.height}`;
}

function pointsNearlyEqual(left: PixelPoint, right: PixelPoint) {
  return Math.abs(left.x - right.x) <= 0.001 && Math.abs(left.y - right.y) <= 0.001;
}

function nowMs() {
  return performance.now();
}
