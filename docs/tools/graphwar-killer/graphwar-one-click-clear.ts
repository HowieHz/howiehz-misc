/** 在当前 Graphwar 路径后追加中心点 DAG 清图路线。 */
import { imageToGraphPoint } from "./geometry";
import { GRAPHWAR_PLANE_LENGTH } from "./graphwar";
import {
  buildSmartPathfindingPathForMask,
  createGraphwarVisibilityGraphObstacleData,
  planeGridCellCenterToImagePoint,
} from "./graphwar-pathfinding";
import type { GraphwarVisibilityGraphObstacleData, PlaneGridPoint } from "./graphwar-pathfinding";
import { graphXAdvancesStrictly } from "./numbers";
import {
  createGraphwarTrajectoryFormulaContext,
  sampleGraphwarFormulaTrajectory,
  sampleGraphwarPathTargetSequence,
} from "./trajectory-sampling";
import type { GraphwarTrajectoryFormulaSettings, GraphwarTrajectoryTargetCircle } from "./trajectory-sampling";
import type { BoundsRect, GraphBounds, PixelPoint } from "./types";

/** 一键清图默认只用单个 1px 几何 route tolerance，避免旧版 min/max/step 扫描。 */
export const GRAPHWAR_ONE_CLICK_CLEAR_DEFAULT_ROUTE_TOLERANCE_PLANE_PIXELS = 1;

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

/** 传给一键清图的单值 route mask。 */
export interface GraphwarOneClickClearRouteMask {
  /** 已按当前一键清图 route tolerance 处理后的 mask。 */
  mask: Uint8Array;
  /** 与 mask 对应的路线容差，参与底层可视图简化。 */
  routeTolerancePlanePixels: number;
}

/** 一键清图内部调试阶段；页面按这些阶段聚合耗时。 */
export type GraphwarOneClickClearDebugStage =
  | "build-dag-edges"
  | "build-dag-targets"
  | "dag-longest-path"
  | "optimize-path"
  | "remove-failed-edge"
  | "route-map-pixels"
  | "route-pathfinding"
  | "segment-build-formula"
  | "segment-graph-rule"
  | "segment-sample-trajectory"
  | "validate-final"
  | "validate-prefix"
  | "validate-route";

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
  /** 候选士兵；友伤开关过滤由调用方负责。 */
  candidates: readonly GraphwarOneClickClearCandidate[];
  /** 用于统计整条弹道击杀数的士兵；不受 DAG 起点右侧过滤影响。 */
  hitCandidates: readonly GraphwarOneClickClearCandidate[];
  /** 长循环取消检查。 */
  isCancelled?: () => boolean;
  /** 内部调试耗时回调；调用方负责聚合同类阶段，避免刷屏。 */
  onDebugTiming?: (timing: GraphwarOneClickClearDebugTiming) => void;
  /** 当前路径已有像素点。 */
  pathPoints: readonly PixelPoint[];
  /** 当前最后路径点的验证目标；传入士兵命中圈时可复用现有路径预检语义。 */
  prefixTarget?: GraphwarTrajectoryTargetCircle;
  /** 一键清图单值几何路线 mask。 */
  routeMask: GraphwarOneClickClearRouteMask;
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
  /** 中心点 Graphwar x；DAG 稳定排序使用，x+ 可达性在平面像素层判断。 */
  centerGraphX: number;
  /** 目标仍瞄准中心点，但验证使用士兵真实命中圈。 */
  centerTarget: GraphwarTrajectoryTargetCircle;
  /** 按中心 x 排序后的位置，用于稳定 tie-break。 */
  orderIndex: number;
  /** 输入候选序号；只用于相同 x 时保持稳定。 */
  sourceIndex: number;
}

interface OneClickClearDagEdge {
  /** True 表示函数验证失败后从 DAG 中删除。 */
  active: boolean;
  /** 本边追加到已有路径时新增的点数，用于最长路 tie-break。 */
  addedPointCount: number;
  /** From 为空表示 START -> target。 */
  from?: number;
  /** 边 id，删除失败边时直接定位。 */
  id: number;
  /** 已按截图像素映射且首尾替换为精确控制点的几何路径。 */
  route: PixelPoint[];
  /** 目标士兵下标。 */
  to: number;
}

interface OneClickClearDag {
  /** 全部建好的几何边；失败验证只把 active 置 false。 */
  edges: OneClickClearDagEdge[];
  /** START 和每个目标的出边表。 */
  outgoingEdges: Map<number, OneClickClearDagEdge[]>;
  /** 按中心 x 排序后的目标。 */
  targets: OneClickClearTarget[];
}

interface OneClickClearBestEntry {
  /** 到达该目标时的显式击杀数。 */
  killCount: number;
  /** 到达该目标时的几何路径点数。 */
  routePointCount: number;
  /** 上一条边，用于回溯路径。 */
  previousEdge: OneClickClearDagEdge;
}

interface OneClickClearValidatedRoute {
  /** 当前清图结果的完整路径。 */
  pathPoints: PixelPoint[];
  /** 已按 DAG 序列验证命中的目标。 */
  targetSequence: OneClickClearTarget[];
}

interface OneClickClearHitTarget extends GraphwarOneClickClearCandidate {
  /** 首次命中该目标时的采样点数量，用于按弹道顺序稳定显示结果。 */
  hitSamplePointCount: number;
}

interface OneClickClearRouteValidationResult {
  /** 失败的边；存在时调用方应删除该边并重新跑 DP。 */
  failedEdge?: OneClickClearDagEdge;
  /** 验证成功的完整路线。 */
  route?: OneClickClearValidatedRoute;
  /** 本轮验证做过的公式模拟次数。 */
  validationCount: number;
}

interface OneClickClearSearchContext {
  options: GraphwarOneClickClearOptions;
}

const START_NODE_INDEX = -1;
const MAX_GLOBAL_DELETE_PASSES = 1;
const FALLBACK_TARGET_RADIUS_PIXELS = 1;

/** 用中心点 DAG 找到当前模型下显式击杀最多的追加路径。 */
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

  const prefixValid =
    options.pathPoints.length >= 2
      ? measureOneClickClearDebugTiming(options, "validate-prefix", () => validateOneClickClearPrefix(options))
      : true;
  if (!prefixValid) {
    return createOneClickClearFailure("preflight-blocked", startedAt, 0);
  }

  const targets = measureOneClickClearDebugTiming(options, "build-dag-targets", () =>
    collectOneClickClearDagTargets(options),
  );
  if (targets.length === 0) {
    return createOneClickClearFailure("no-candidate", startedAt, 0);
  }

  const context: OneClickClearSearchContext = { options };
  const dag = await measureOneClickClearDebugTimingAsync(options, "build-dag-edges", () =>
    buildOneClickClearDag(context, targets),
  );
  let workUnits = dag.edges.length;
  if (dag.edges.length === 0) {
    return createOneClickClearFailure("no-usable-target", startedAt, workUnits);
  }

  while (true) {
    if (options.isCancelled?.()) {
      return createOneClickClearFailure("no-usable-target", startedAt, workUnits);
    }

    const selectedEdges = measureOneClickClearDebugTiming(options, "dag-longest-path", () =>
      findOneClickClearLongestPath(dag),
    );
    if (selectedEdges.length === 0) {
      return createOneClickClearFailure("no-usable-target", startedAt, workUnits);
    }

    const validation = measureOneClickClearDebugTiming(options, "validate-route", () =>
      validateOneClickClearDagRoute(context, dag, selectedEdges),
    );
    workUnits += validation.validationCount;
    const validatedRoute = validation.route;
    if (validatedRoute) {
      const optimized = await measureOneClickClearDebugTimingAsync(options, "optimize-path", () =>
        optimizeOneClickClearPath(context, validatedRoute, workUnits),
      );
      workUnits = optimized.workUnits;

      const finalValidation = measureOneClickClearDebugTiming(options, "validate-final", () =>
        validateOneClickClearTargetSequence(options, optimized.route),
      );
      if (!finalValidation) {
        return createOneClickClearFailure("no-usable-target", startedAt, workUnits);
      }
      const hitTargets = collectOneClickClearHitTargets(options, optimized.route.pathPoints);

      return {
        elapsedMs: Math.max(0, nowMs() - startedAt),
        expandedStates: workUnits,
        pathPoints: optimized.route.pathPoints,
        targetIds: hitTargets.map((target) => target.id),
        targetSequence: hitTargets.map((target) => createOneClickClearTargetCircle(target)),
        type: "success",
      };
    }

    const failedEdge = validation.failedEdge;
    if (!failedEdge) {
      return createOneClickClearFailure("no-usable-target", startedAt, workUnits);
    }
    measureOneClickClearDebugTiming(options, "remove-failed-edge", () => {
      failedEdge.active = false;
    });
  }
}

/** 当前已有路径必须能先命中尾点；追加清图路线前先挡住已经无效的前缀。 */
function validateOneClickClearPrefix(options: GraphwarOneClickClearOptions) {
  if (options.pathPoints.length < 2) {
    return true;
  }

  const target = options.prefixTarget ?? {
    center: options.pathPoints.at(-1) ?? options.pathPoints[0],
    radius: FALLBACK_TARGET_RADIUS_PIXELS,
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
  return result.reachesTargetSequenceBeforeObstacle;
}

/** 收集从当前路径末端中心 x+ 侧可选的士兵，并按中心 x 稳定排序。 */
function collectOneClickClearDagTargets(options: GraphwarOneClickClearOptions): OneClickClearTarget[] {
  const startPoint = options.pathPoints.at(-1);
  if (!startPoint) {
    return [];
  }

  const startGraphX = imageToGraphPoint(startPoint, options.bounds, options.boundsRect).x;
  const targets: OneClickClearTarget[] = [];
  for (let sourceIndex = 0; sourceIndex < options.candidates.length; sourceIndex += 1) {
    const candidate = options.candidates[sourceIndex];
    if (!candidate) {
      continue;
    }

    const centerGraphX = imageToGraphPoint(candidate.hitCenter, options.bounds, options.boundsRect).x;
    if (!graphXAdvancesStrictly(startGraphX, centerGraphX)) {
      continue;
    }

    targets.push({
      ...candidate,
      centerGraphX,
      centerTarget: {
        center: candidate.hitCenter,
        radius: candidate.hitRadius,
      },
      orderIndex: 0,
      sourceIndex,
    });
  }

  return targets.sort(compareOneClickClearTargetOrder).map((target, orderIndex) => ({ ...target, orderIndex }));
}

/** 按中心点排序；同 x 不建边，但排序仍需稳定。 */
function compareOneClickClearTargetOrder(left: OneClickClearTarget, right: OneClickClearTarget) {
  return (
    left.centerGraphX - right.centerGraphX ||
    left.hitCenter.y - right.hitCenter.y ||
    left.sourceIndex - right.sourceIndex
  );
}

/** 建立 START 和士兵中心点之间的几何 DAG；这里只做寻路，不做公式模拟。 */
async function buildOneClickClearDag(
  context: OneClickClearSearchContext,
  targets: readonly OneClickClearTarget[],
): Promise<OneClickClearDag> {
  const options = context.options;
  const startPoint = options.pathPoints.at(-1) ?? options.pathPoints[0];
  const edges: OneClickClearDagEdge[] = [];
  const outgoingEdges = new Map<number, OneClickClearDagEdge[]>();
  const visibilityGraphObstacleData = createGraphwarVisibilityGraphObstacleData({
    bounds: options.bounds,
    routeMask: options.routeMask.mask,
    routeTolerancePlanePixels: options.routeMask.routeTolerancePlanePixels,
  });

  for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
    const target = targets[targetIndex];
    if (!target) {
      continue;
    }
    const route = await buildOneClickClearEdgeRoute(context, startPoint, target.hitCenter, visibilityGraphObstacleData);
    if (route) {
      addOneClickClearDagEdge(edges, outgoingEdges, undefined, targetIndex, route);
    }
    await yieldOneClickClearControl(options);
  }

  for (let fromIndex = 0; fromIndex < targets.length; fromIndex += 1) {
    const from = targets[fromIndex];
    if (!from) {
      continue;
    }
    for (let toIndex = fromIndex + 1; toIndex < targets.length; toIndex += 1) {
      const to = targets[toIndex];
      if (!to || !graphXAdvancesStrictly(from.centerGraphX, to.centerGraphX)) {
        continue;
      }

      const route = await buildOneClickClearEdgeRoute(
        context,
        from.hitCenter,
        to.hitCenter,
        visibilityGraphObstacleData,
      );
      if (route) {
        addOneClickClearDagEdge(edges, outgoingEdges, fromIndex, toIndex, route);
      }
      await yieldOneClickClearControl(options);
    }
  }

  return {
    edges,
    outgoingEdges,
    targets: [...targets],
  };
}

function addOneClickClearDagEdge(
  edges: OneClickClearDagEdge[],
  outgoingEdges: Map<number, OneClickClearDagEdge[]>,
  from: number | undefined,
  to: number,
  route: PixelPoint[],
) {
  const edge: OneClickClearDagEdge = {
    active: true,
    addedPointCount: Math.max(0, route.length - 1),
    from,
    id: edges.length,
    route,
    to,
  };
  edges.push(edge);

  const fromKey = from ?? START_NODE_INDEX;
  const existing = outgoingEdges.get(fromKey);
  if (existing) {
    existing.push(edge);
  } else {
    outgoingEdges.set(fromKey, [edge]);
  }
}

/** 中心点到中心点寻路；首尾替换为精确中心，避免 cell-center 映射漂移。 */
async function buildOneClickClearEdgeRoute(
  context: OneClickClearSearchContext,
  startPoint: PixelPoint,
  targetPoint: PixelPoint,
  visibilityGraphObstacleData: GraphwarVisibilityGraphObstacleData,
) {
  const route = await measureOneClickClearDebugTimingAsync(context.options, "route-pathfinding", () =>
    buildSmartPathfindingPathForMask({
      bounds: context.options.bounds,
      boundsRect: context.options.boundsRect,
      boundaryExpansion: context.options.boundaryExpansion,
      canAdvance: (previous, next) => pathfindingPlaneSegmentAdvancesEnough(context.options, previous, next),
      isCancelled: context.options.isCancelled,
      routeMask: context.options.routeMask.mask,
      routeTolerancePlanePixels: context.options.routeMask.routeTolerancePlanePixels,
      startPoint,
      targetPoint,
      visibilityGraphObstacleData,
      yieldControl: context.options.yieldControl,
    }),
  );
  const pixelRoute = measureOneClickClearDebugTiming(context.options, "route-map-pixels", () =>
    route?.map((point) => planeGridCellCenterToImagePoint(point, context.options.boundsRect)),
  );
  if (!pixelRoute || pixelRoute.length < 2) {
    return undefined;
  }

  const exactRoute = [...pixelRoute];
  exactRoute[0] = startPoint;
  exactRoute[exactRoute.length - 1] = targetPoint;
  return exactRoute;
}

/** 在中心点有序 DAG 上做最长路 DP；同分时选几何点更少、终点更靠前。 */
function findOneClickClearLongestPath(dag: OneClickClearDag) {
  const bestEntries: (OneClickClearBestEntry | undefined)[] = Array.from({ length: dag.targets.length });

  for (const edge of dag.outgoingEdges.get(START_NODE_INDEX) ?? []) {
    if (!edge.active) {
      continue;
    }
    updateOneClickClearBestEntry(bestEntries, edge.to, {
      killCount: 1,
      previousEdge: edge,
      routePointCount: edge.addedPointCount,
    });
  }

  for (let targetIndex = 0; targetIndex < dag.targets.length; targetIndex += 1) {
    const entry = bestEntries[targetIndex];
    if (!entry) {
      continue;
    }

    for (const edge of dag.outgoingEdges.get(targetIndex) ?? []) {
      if (!edge.active) {
        continue;
      }
      updateOneClickClearBestEntry(bestEntries, edge.to, {
        killCount: entry.killCount + 1,
        previousEdge: edge,
        routePointCount: entry.routePointCount + edge.addedPointCount,
      });
    }
  }

  let bestTargetIndex: number | undefined;
  for (let targetIndex = 0; targetIndex < bestEntries.length; targetIndex += 1) {
    const entry = bestEntries[targetIndex];
    if (!entry) {
      continue;
    }
    const bestEntry = bestTargetIndex === undefined ? undefined : bestEntries[bestTargetIndex];
    if (
      !bestEntry ||
      compareOneClickClearBestEntry(entry, targetIndex, bestEntry, bestTargetIndex ?? targetIndex) < 0
    ) {
      bestTargetIndex = targetIndex;
    }
  }

  if (bestTargetIndex === undefined) {
    return [];
  }
  return reconstructOneClickClearDagPath(bestEntries, bestTargetIndex);
}

function updateOneClickClearBestEntry(
  bestEntries: (OneClickClearBestEntry | undefined)[],
  targetIndex: number,
  candidate: OneClickClearBestEntry,
) {
  const previous = bestEntries[targetIndex];
  if (!previous || compareOneClickClearBestEntry(candidate, targetIndex, previous, targetIndex) < 0) {
    bestEntries[targetIndex] = candidate;
  }
}

function compareOneClickClearBestEntry(
  left: OneClickClearBestEntry,
  leftTargetIndex: number,
  right: OneClickClearBestEntry,
  rightTargetIndex: number,
) {
  return (
    right.killCount - left.killCount ||
    left.routePointCount - right.routePointCount ||
    leftTargetIndex - rightTargetIndex
  );
}

function reconstructOneClickClearDagPath(
  bestEntries: readonly (OneClickClearBestEntry | undefined)[],
  targetIndex: number,
) {
  const edges: OneClickClearDagEdge[] = [];
  let currentTargetIndex = targetIndex;
  while (true) {
    const entry: OneClickClearBestEntry | undefined = bestEntries[currentTargetIndex];
    if (!entry) {
      break;
    }
    const edge: OneClickClearDagEdge = entry.previousEdge;
    edges.push(edge);
    if (edge.from === undefined) {
      break;
    }
    currentTargetIndex = edge.from;
  }
  return edges.reverse();
}

/** 按选中的 DAG 路线逐边追加并验证；失败时返回刚失败的边。 */
function validateOneClickClearDagRoute(
  context: OneClickClearSearchContext,
  dag: OneClickClearDag,
  edges: readonly OneClickClearDagEdge[],
): OneClickClearRouteValidationResult {
  let pathPoints = [...context.options.pathPoints];
  const targetSequence: OneClickClearTarget[] = [];
  let validationCount = 0;

  for (const edge of edges) {
    const target = dag.targets[edge.to];
    if (!target) {
      return { failedEdge: edge, validationCount };
    }

    const nextPath = appendOneClickClearEdgeRoute(pathPoints, edge.route);
    const nextTargetSequence = [...targetSequence, target];
    validationCount += 1;
    if (!validateOneClickClearRouteSegment(context, nextPath, nextTargetSequence)) {
      return { failedEdge: edge, validationCount };
    }

    pathPoints = nextPath;
    targetSequence.push(target);
  }

  return {
    route: {
      pathPoints,
      targetSequence,
    },
    validationCount,
  };
}

/** 把边 route 追加到完整路径；route 首点已经是当前路径尾点，需要跳过。 */
function appendOneClickClearEdgeRoute(sourcePath: readonly PixelPoint[], route: readonly PixelPoint[]) {
  return [...sourcePath, ...route.slice(1)];
}

/** 用当前完整路径重采样已接受目标序列，避免复用旧公式状态导致逐段验证和最终验证不一致。 */
function validateOneClickClearRouteSegment(
  context: OneClickClearSearchContext,
  nextPath: readonly PixelPoint[],
  targetSequence: readonly OneClickClearTarget[],
) {
  const options = context.options;
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

  const result = measureOneClickClearDebugTiming(options, "segment-sample-trajectory", () =>
    sampleGraphwarFormulaTrajectory({
      bounds: options.bounds,
      boundsRect: options.boundsRect,
      collision: {
        boundaryExpansion: options.simulationBoundaryExpansion,
        mask: options.simulationMask,
      },
      context: formulaContext,
      targetSequence: targetSequence.map((target) => target.centerTarget),
    }),
  );
  return result.reachedTargetCount >= targetSequence.length;
}

/** 最终整路验证按显式目标命中圈序列重采样，作为增量验证后的安全网。 */
function validateOneClickClearTargetSequence(
  options: GraphwarOneClickClearOptions,
  route: Pick<OneClickClearValidatedRoute, "pathPoints" | "targetSequence">,
) {
  const result = sampleGraphwarPathTargetSequence({
    boundaryExpansion: options.simulationBoundaryExpansion,
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    obstacleMask: options.simulationMask,
    points: route.pathPoints,
    settings: options.settings,
    soldierMarkerRadius: FALLBACK_TARGET_RADIUS_PIXELS,
    targetCircles: route.targetSequence.map((target) => target.centerTarget),
    targetPoints: route.targetSequence.map((target) => target.hitCenter),
  });
  return result.reachesTargetSequenceBeforeObstacle;
}

/** 最终统计当前完整弹道实际命中的候选士兵，包含非 DAG 节点的顺路命中。 */
function collectOneClickClearHitTargets(
  options: GraphwarOneClickClearOptions,
  pathPoints: readonly PixelPoint[],
): OneClickClearHitTarget[] {
  return options.hitCandidates
    .flatMap<OneClickClearHitTarget>((candidate) => {
      const samplePointCount = sampleOneClickClearTargetHit(options, pathPoints, candidate);
      return samplePointCount === undefined ? [] : [{ ...candidate, hitSamplePointCount: samplePointCount }];
    })
    .sort(compareOneClickClearHitTargets);
}

function compareOneClickClearHitTargets(left: OneClickClearHitTarget, right: OneClickClearHitTarget) {
  return (
    left.hitSamplePointCount - right.hitSamplePointCount ||
    left.hitCenter.x - right.hitCenter.x ||
    left.hitCenter.y - right.hitCenter.y ||
    left.id.localeCompare(right.id)
  );
}

function createOneClickClearTargetCircle(target: Pick<GraphwarOneClickClearCandidate, "hitCenter" | "hitRadius">) {
  return {
    center: target.hitCenter,
    radius: target.hitRadius,
  };
}

/** 全局删点只保护原 prefix；显式目标中心可删，由命中圈序列验证兜底。 */
async function optimizeOneClickClearPath(
  context: OneClickClearSearchContext,
  route: OneClickClearValidatedRoute,
  workUnits: number,
) {
  let optimized = route;
  const firstGeneratedIndex = context.options.pathPoints.length;
  for (let pass = 0; pass < MAX_GLOBAL_DELETE_PASSES; pass += 1) {
    for (let index = firstGeneratedIndex; index < optimized.pathPoints.length; ) {
      if (context.options.isCancelled?.()) {
        return { route: optimized, workUnits };
      }

      const candidatePath = [...optimized.pathPoints.slice(0, index), ...optimized.pathPoints.slice(index + 1)];
      workUnits += 1;
      if (
        oneClickClearPathFollowsGraphRule(context.options, candidatePath) &&
        validateOneClickClearTargetSequence(context.options, { ...optimized, pathPoints: candidatePath })
      ) {
        optimized = { ...optimized, pathPoints: candidatePath };
        continue;
      }
      index += 1;

      await yieldOneClickClearControl(context.options);
    }
  }
  return { route: optimized, workUnits };
}

function sampleOneClickClearTargetHit(
  options: GraphwarOneClickClearOptions,
  pathPoints: readonly PixelPoint[],
  target: GraphwarOneClickClearCandidate,
) {
  const result = sampleGraphwarPathTargetSequence({
    boundaryExpansion: options.simulationBoundaryExpansion,
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    obstacleMask: options.simulationMask,
    points: pathPoints,
    settings: options.settings,
    soldierMarkerRadius: target.hitRadius,
    targetCircles: [createOneClickClearTargetCircle(target)],
    targetPoints: [target.hitCenter],
  });
  return result.reachesTargetSequenceBeforeObstacle ? result.samplePointCount : undefined;
}

function graphXAdvancesFromX(fromGraphX: number, toGraphX: number) {
  return graphXAdvancesStrictly(fromGraphX, toGraphX);
}

function pathfindingPlaneSegmentAdvancesEnough(
  options: GraphwarOneClickClearOptions,
  previous: PlaneGridPoint,
  next: PlaneGridPoint,
) {
  return graphXAdvancesStrictly(
    planeGridPointToGraphX(options.bounds, previous),
    planeGridPointToGraphX(options.bounds, next),
  );
}

function oneClickClearPathFollowsGraphRule(options: GraphwarOneClickClearOptions, points: readonly PixelPoint[]) {
  for (let index = 1; index < points.length; index += 1) {
    const previous = imageToGraphPoint(points[index - 1], options.bounds, options.boundsRect);
    const next = imageToGraphPoint(points[index], options.bounds, options.boundsRect);
    if (!graphXAdvancesFromX(previous.x, next.x)) {
      return false;
    }
  }
  return true;
}

function planeGridPointToGraphX(bounds: GraphBounds, point: PlaneGridPoint) {
  return bounds.minX + ((point.x + 0.5) / GRAPHWAR_PLANE_LENGTH) * (bounds.maxX - bounds.minX);
}

async function yieldOneClickClearControl(options: GraphwarOneClickClearOptions) {
  const yielded = options.yieldControl?.();
  if (yielded) {
    await yielded;
  }
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

function nowMs() {
  return performance.now();
}
