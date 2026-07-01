/** 在当前 Graphwar 路径后追加最佳努力清图路线。 */
import { buildFormula } from "./formula";
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

/** 一键清图的预算设置。 */
export interface GraphwarOneClickClearBudget {
  /** Beam search 每层保留的状态数。 */
  beamWidth: number;
  /** 单次最多扩展状态数。 */
  maxExpandedStates: number;
  /** 单次最多运行时间，单位毫秒。 */
  maxElapsedMs: number;
}

/** 传给一键清图的 route mask。 */
export interface GraphwarOneClickClearRouteMask {
  /** 已按 tolerance 膨胀或腐蚀后的 mask。 */
  mask: Uint8Array;
  /** 与 mask 对应的路线容差，参与 cache key。 */
  routeTolerancePlanePixels: number;
}

/** 运行一键清图所需的纯数据。 */
export interface GraphwarOneClickClearOptions {
  /** 当前障碍边界收缩值，单位为 Graphwar 原始平面像素。 */
  boundaryExpansion: number;
  /** 当前 Graphwar 坐标边界。 */
  bounds: GraphBounds;
  /** 截图内 Graphwar 棋盘矩形。 */
  boundsRect: BoundsRect;
  /** 搜索预算。 */
  budget: GraphwarOneClickClearBudget;
  /** 候选士兵。 */
  candidates: readonly GraphwarOneClickClearCandidate[];
  /** 长循环取消检查。 */
  isCancelled?: () => boolean;
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
  | "budget-exhausted"
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
  /** 几何寻路优先瞄准点。 */
  aimPoint: PixelPoint;
  /** 命中圈最早可打到的 Graphwar x，用于按 x 从低到高清图。 */
  minHitGraphX: number;
  /** 命中圈中心 Graphwar x，用于稳定排序。 */
  centerGraphX: number;
  /** 命中圈最晚可打到的 Graphwar x，用于判断当前状态能否继续打它。 */
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
  /** 已击杀士兵 id。 */
  killedIds: Set<string>;
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
  budget: GraphwarOneClickClearBudget;
  candidates: readonly OneClickClearTarget[];
  options: GraphwarOneClickClearOptions;
  routeCache: Map<string, PixelPoint[] | undefined>;
  routeMaskIdCount: number;
  routeMaskIds: WeakMap<Uint8Array, number>;
  startedAt: number;
}

const MAX_GLOBAL_DELETE_PASSES = 2;

/** 运行预算 beam search，返回能击杀最多目标的追加路径。 */
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

  const prefixState = options.pathPoints.length >= 2 ? validateOneClickClearPrefix(options) : undefined;
  if (options.pathPoints.length >= 2 && !prefixState) {
    return createOneClickClearFailure("preflight-blocked", startedAt, 0);
  }

  const targets = collectReachableOneClickClearTargets(options);
  if (targets.length === 0) {
    return createOneClickClearFailure("no-candidate", startedAt, 0);
  }

  const context: OneClickClearSearchContext = {
    budget: options.budget,
    candidates: targets,
    options,
    routeCache: new Map(),
    routeMaskIdCount: 0,
    routeMaskIds: new WeakMap(),
    startedAt,
  };
  const initialState: OneClickClearState = {
    killedIds: new Set(),
    lastPoint: options.pathPoints.at(-1) ?? options.pathPoints[0],
    lastTargetOrderIndex: -1,
    pathPoints: [...options.pathPoints],
    targetSequence: [],
    trajectoryState: prefixState,
  };

  let beam: OneClickClearState[] = [initialState];
  let best = initialState;
  let expandedStates = 0;
  let exhausted = false;
  while (beam.length > 0) {
    const nextBeam: OneClickClearState[] = [];
    for (const state of beam) {
      if (options.isCancelled?.()) {
        return createOneClickClearFailure("budget-exhausted", startedAt, expandedStates);
      }
      if (oneClickClearBudgetExceeded(context, expandedStates)) {
        exhausted = true;
        break;
      }
      if (!stateCanBeatBest(state, best, targets.length)) {
        continue;
      }

      expandedStates += 1;
      for (const target of targets) {
        if (target.orderIndex <= state.lastTargetOrderIndex || state.killedIds.has(target.id)) {
          continue;
        }

        const stateTarget = createStateOneClickClearTarget(options, state, target);
        if (!stateTarget) {
          continue;
        }

        const nextState = await expandOneClickClearState(context, state, stateTarget);
        if (!nextState) {
          continue;
        }
        nextBeam.push(nextState);
        if (compareOneClickClearStates(nextState, best, options) < 0) {
          best = nextState;
        }
      }
    }
    if (exhausted) {
      break;
    }
    beam = nextBeam
      .sort((left, right) => compareOneClickClearBeamStates(left, right, options))
      .slice(0, context.budget.beamWidth);
    const yielded = options.yieldControl?.();
    if (yielded) {
      await yielded;
    }
  }

  if (best.targetSequence.length === 0) {
    return createOneClickClearFailure(exhausted ? "budget-exhausted" : "no-usable-target", startedAt, expandedStates);
  }

  const optimized = await optimizeOneClickClearPath(context, best, expandedStates);
  const finalState = optimized.state;
  expandedStates = optimized.expandedStates;
  const finalValidation = validateOneClickClearTargetSequence(options, finalState);
  if (!finalValidation) {
    return createOneClickClearFailure(exhausted ? "budget-exhausted" : "no-usable-target", startedAt, expandedStates);
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

/** 构造清图目标；aim point 刻意取命中圈里最靠低 x 的可用点，给后续目标留出更多 x 空间。 */
function createOneClickClearTarget(
  options: GraphwarOneClickClearOptions,
  startPoint: PixelPoint,
  candidate: GraphwarOneClickClearCandidate,
  sourceIndex: number,
) {
  const centerGraph = imageToGraphPoint(candidate.hitCenter, options.bounds, options.boundsRect);
  const graphRadiusX =
    (candidate.hitRadius / options.boundsRect.width) * Math.abs(options.bounds.maxX - options.bounds.minX);
  const target: OneClickClearTarget = {
    ...candidate,
    aimPoint: candidate.hitCenter,
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
  const aimPoint = createOneClickClearAimPoint(options, startPoint, target);
  return aimPoint ? { ...target, aimPoint } : undefined;
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

/** 瞄准命中圈里满足最小 x+ 步长的最小 Graphwar x。 */
function createOneClickClearAimPoint(
  options: GraphwarOneClickClearOptions,
  startPoint: PixelPoint,
  target: OneClickClearTarget,
) {
  const minimumGraphX = getMinimumForwardGraphX(options, startPoint);
  if (minimumGraphX === undefined) {
    return undefined;
  }

  if (!graphXReachesMinimumForward(target.maxHitGraphX, minimumGraphX, options)) {
    return undefined;
  }

  const aimGraphX = Math.max(target.minHitGraphX, minimumGraphX);
  const centerGraph = imageToGraphPoint(target.hitCenter, options.bounds, options.boundsRect);
  const minimumPoint = graphToImagePoint(
    { ...centerGraph, x: aimGraphX } as GraphPoint,
    options.bounds,
    options.boundsRect,
  );
  return pointHitsTargetCircle(minimumPoint, target.hitCenter, target.hitRadius) ? minimumPoint : undefined;
}

/** 每个搜索状态都要按当前 lastPoint 重新选择命中圈里最靠低 x 的可用瞄点。 */
function createStateOneClickClearTarget(
  options: GraphwarOneClickClearOptions,
  state: OneClickClearState,
  target: OneClickClearTarget,
) {
  if (target.orderIndex <= state.lastTargetOrderIndex) {
    return undefined;
  }

  const aimPoint = createOneClickClearAimPoint(options, state.lastPoint, target);
  return aimPoint ? { ...target, aimPoint } : undefined;
}

/** 扩展一个目标：几何路线缓存命中后仍必须跑增量轨迹验证。 */
async function expandOneClickClearState(
  context: OneClickClearSearchContext,
  state: OneClickClearState,
  target: OneClickClearTarget,
) {
  for (const routeMask of context.options.routeMasks) {
    const route = await getCachedOneClickClearRoute(context, state.lastPoint, target.aimPoint, routeMask);
    if (!route || route.length < 2) {
      continue;
    }

    const nextPath = appendOneClickClearRoute(context.options, state.pathPoints, route, target.aimPoint);
    const nextState = validateOneClickClearExtension(context.options, state, target, nextPath);
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
  const key = createOneClickClearRouteCacheKey(context, startPoint, targetPoint, routeMask);
  if (context.routeCache.has(key)) {
    return context.routeCache.get(key);
  }

  const route = await buildSmartPathfindingPathForMask({
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
  });
  const pixelRoute = route?.map((point) => planeGridCellCenterToImagePoint(point, context.options.boundsRect));
  context.routeCache.set(key, pixelRoute);
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
  targetPoint: PixelPoint,
) {
  const appended = route.slice(1).map((point, index, points) => (index === points.length - 1 ? targetPoint : point));
  return normalizeOneClickClearPath(options, [...sourcePath, ...appended]);
}

/** 增量验证下一段路线，并把采样 endState 缓存到搜索状态里。 */
function validateOneClickClearExtension(
  options: GraphwarOneClickClearOptions,
  state: OneClickClearState,
  target: OneClickClearTarget,
  nextPath: PixelPoint[],
) {
  if (!oneClickClearPathFollowsGraphRule(options, nextPath)) {
    return undefined;
  }

  const mappedPoints = nextPath.map((point) => imageToGraphPoint(point, options.bounds, options.boundsRect));
  const context = createGraphwarTrajectoryFormulaContext({
    bounds: options.bounds,
    points: mappedPoints,
    settings: options.settings,
    soldierCenter: mappedPoints[0],
  });
  if (context.formulaPoints.length < 2) {
    return undefined;
  }

  if (!state.trajectoryState) {
    return validateOneClickClearFullExtension(options, state, target, nextPath);
  }

  const result = sampleGraphwarFormulaTrajectory({
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    collision: {
      boundaryExpansion: options.simulationBoundaryExpansion,
      mask: options.simulationMask,
    },
    context,
    initialReachedTargetCount: state.targetSequence.length,
    initialState: state.trajectoryState,
    skipInitialStop: true,
    targetSequence: [...state.targetSequence.map((item) => item.hitCircle), target.hitCircle],
  });
  if (result.reachedTargetCount < state.targetSequence.length + 1 || !result.sample.endState) {
    return undefined;
  }

  const killedIds = new Set(state.killedIds);
  killedIds.add(target.id);
  return {
    killedIds,
    lastPoint: nextPath.at(-1) ?? state.lastPoint,
    lastTargetOrderIndex: target.orderIndex,
    pathPoints: nextPath,
    targetSequence: [...state.targetSequence, target],
    trajectoryState: result.sample.endState,
  };
}

/** 没有可恢复前缀时完整验证当前序列，通常只发生在路径只有起点的第一次扩展。 */
function validateOneClickClearFullExtension(
  options: GraphwarOneClickClearOptions,
  state: OneClickClearState,
  target: OneClickClearTarget,
  nextPath: PixelPoint[],
) {
  const targetSequence = [...state.targetSequence.map((item) => item.hitCircle), target.hitCircle];
  const result = sampleGraphwarPathTargetSequence({
    boundaryExpansion: options.simulationBoundaryExpansion,
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    obstacleMask: options.simulationMask,
    points: nextPath,
    settings: options.settings,
    soldierMarkerRadius: 1,
    targetCircles: targetSequence,
    targetPoints: targetSequence.map((item) => item.center),
  });
  if (result.reachedTargetCount < state.targetSequence.length + 1 || !result.sample.endState) {
    return undefined;
  }

  const killedIds = new Set(state.killedIds);
  killedIds.add(target.id);
  return {
    killedIds,
    lastPoint: nextPath.at(-1) ?? state.lastPoint,
    lastTargetOrderIndex: target.orderIndex,
    pathPoints: nextPath,
    targetSequence: [...state.targetSequence, target],
    trajectoryState: result.sample.endState,
  };
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
      if (oneClickClearBudgetExceeded(context, expandedStates) || context.options.isCancelled?.()) {
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
  return Boolean(point && state.targetSequence.some((target) => pointsNearlyEqual(point, target.aimPoint)));
}

/** 按计划的得分顺序比较搜索状态。 */
function compareOneClickClearStates(
  left: OneClickClearState,
  right: OneClickClearState,
  options: GraphwarOneClickClearOptions,
) {
  return (
    right.targetSequence.length - left.targetSequence.length ||
    countEnemyTargets(right) - countEnemyTargets(left) ||
    left.pathPoints.length - right.pathPoints.length ||
    estimateFormulaTextLength(left, options) - estimateFormulaTextLength(right, options) ||
    compareTargetSequencesByXOrder(left.targetSequence, right.targetSequence)
  );
}

/** Beam 保留策略偏向低 x 序列，避免早期可扩展路线被较短的远处路线挤掉。 */
function compareOneClickClearBeamStates(
  left: OneClickClearState,
  right: OneClickClearState,
  options: GraphwarOneClickClearOptions,
) {
  return (
    right.targetSequence.length - left.targetSequence.length ||
    compareTargetSequencesByXOrder(left.targetSequence, right.targetSequence) ||
    countEnemyTargets(right) - countEnemyTargets(left) ||
    left.pathPoints.length - right.pathPoints.length ||
    estimateFormulaTextLength(left, options) - estimateFormulaTextLength(right, options)
  );
}

function countEnemyTargets(state: OneClickClearState) {
  return state.targetSequence.filter((target) => target.enemy).length;
}

/** 只用表达式长度作 tie-break；上下文校验失败时退化到点数。 */
function estimateFormulaTextLength(state: OneClickClearState, options: GraphwarOneClickClearOptions) {
  const mappedPoints = state.pathPoints.map((point) => imageToGraphPoint(point, options.bounds, options.boundsRect));
  const context = createGraphwarTrajectoryFormulaContext({
    bounds: options.bounds,
    points: mappedPoints,
    settings: options.settings,
    soldierCenter: mappedPoints[0],
  });
  if (context.formulaPoints.length < 2) {
    return state.pathPoints.length;
  }
  return buildFormula(
    context.formulaPoints,
    options.settings.steepness,
    options.settings.equation,
    options.settings.algorithm,
    options.settings.decimalPlaces,
    context.formulaEvaluation,
  ).expression.length;
}

function compareTargetSequencesByXOrder(left: readonly OneClickClearTarget[], right: readonly OneClickClearTarget[]) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index]?.orderIndex ?? 0) - (right[index]?.orderIndex ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return left.length - right.length;
}

function stateCanBeatBest(state: OneClickClearState, best: OneClickClearState, totalCandidateCount: number) {
  const remainingOrderedTargets = Math.max(0, totalCandidateCount - state.lastTargetOrderIndex - 1);
  return state.targetSequence.length + remainingOrderedTargets >= best.targetSequence.length;
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
  return Math.hypot(point.x - center.x, point.y - center.y) <= radius;
}

function oneClickClearBudgetExceeded(context: OneClickClearSearchContext, expandedStates: number) {
  return (
    expandedStates >= context.budget.maxExpandedStates || nowMs() - context.startedAt >= context.budget.maxElapsedMs
  );
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
