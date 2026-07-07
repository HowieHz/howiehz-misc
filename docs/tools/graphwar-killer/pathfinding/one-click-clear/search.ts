/** 在当前 Graphwar 路径后追加 DAG 清图路线；几何建路点和弹道命中圈分开建模。 */
import { imageToGraphPoint } from "../../core/geometry";
import { graphXAdvancesStrictly } from "../../core/numbers";
import type { BoundsRect, GraphBounds, PixelPoint } from "../../core/types";
import type { GraphwarTrajectorySamplingState } from "../../formula/simulator";
import {
  createGraphwarTrajectoryFormulaContext,
  sampleGraphwarFormulaTrajectory,
  sampleGraphwarPathTargetSequence,
} from "../../formula/trajectory-sampling";
import type {
  GraphwarTrajectoryFormulaSettings,
  GraphwarTrajectorySampleResult,
  GraphwarTrajectoryTargetCircle,
} from "../../formula/trajectory-sampling";

/** 路线规划默认使用单个 2px 几何 route tolerance，普通寻路和一键清图保持一致。 */
export const GRAPHWAR_DEFAULT_ROUTE_PLANNING_TOLERANCE_PLANE_PIXELS = 2;

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
  | "route-mask-cache-hit"
  | "route-mask-cache-miss"
  | "route-map-pixels"
  | "route-pathfinding"
  | "segment-build-formula"
  | "segment-graph-rule"
  | "segment-sample-trajectory"
  | "validate-final"
  | "visibility-cache-hit"
  | "visibility-cache-miss"
  | "visibility-cache-skipped"
  | "validate-prefix"
  | "validate-route";

/** 一键清图内部调试细分信息；动态标签用对象承载，避免为每个 worker 造固定 stage。 */
export type GraphwarOneClickClearDebugDetail =
  | {
      /** DAG 建边实际调度模式。 */
      mode: "serial" | "parallel" | "parallel-fallback";
      /** 实际使用或尝试使用的 worker 数量。 */
      workerCount: number;
      /** 明细类型标记。 */
      type: "dag-edge-mode";
    }
  | {
      /** 明细类型标记。 */
      type: "dag-edge-worker";
      /** 子 Worker 序号。 */
      workerIndex: number;
    };

/** 一键清图内部调试耗时记录。 */
export interface GraphwarOneClickClearDebugTiming {
  /** 被测量的一键清图内部阶段。 */
  stage: GraphwarOneClickClearDebugStage;
  /** 阶段耗时，单位毫秒。 */
  elapsedMs: number;
  /** 阶段内动态明细；存在时页面按类型生成标签。 */
  detail?: GraphwarOneClickClearDebugDetail;
}

/** 一键清图 DAG 边批量建路 job；按生成顺序合并结果，保证 edge id 稳定。 */
export interface GraphwarOneClickClearDagEdgeBuildJob {
  /** 稳定 job id。 */
  id: number;
  /** From 为空表示 START -> target。 */
  from?: number;
  /** 本边起点，截图像素坐标。 */
  startPoint: PixelPoint;
  /** 本边几何建路终点，截图像素坐标。 */
  targetPoint: PixelPoint;
  /** 目标士兵下标。 */
  to: number;
}

/** 一键清图 DAG 边批量建路请求。 */
export interface GraphwarOneClickClearDagEdgeBuildRequest {
  /** 当前 Graphwar 坐标边界。 */
  bounds: GraphBounds;
  /** 截图内 Graphwar 棋盘矩形。 */
  boundsRect: BoundsRect;
  /** 障碍和棋盘边界命中检测的内收像素。 */
  boundaryExpansion: number;
  /** 待尝试的 DAG 边，已按稳定顺序生成。 */
  jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[];
  /** 已按 route tolerance 处理后的障碍 mask。 */
  routeMask: Uint8Array;
  /** 当前 route tolerance，供可视图轮廓简化使用。 */
  routeTolerancePlanePixels: number;
  /** 用户配置的最大并行消费者数量。 */
  workerCount: number;
}

/** 一键清图 DAG 边批量建路结果。 */
export interface GraphwarOneClickClearDagEdgeBuildResult {
  /** 每个 job 的可用路线；route 为空表示该边不可达。 */
  routes: readonly GraphwarOneClickClearDagEdgeRoute[];
  /** 批量 builder 内部测得的调试耗时。 */
  timings: readonly GraphwarOneClickClearDebugTiming[];
}

/** 一键清图 DAG 边 job 的路线结果。 */
export interface GraphwarOneClickClearDagEdgeRoute {
  /** 对应 job id。 */
  jobId: number;
  /** 已按截图像素映射且首尾替换为精确控制点的几何路径。 */
  route?: PixelPoint[];
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
  /** 批量 DAG 建边入口；即使串行也交给 master Worker，避免在主线程跑几何搜索。 */
  buildDagEdges: (
    request: GraphwarOneClickClearDagEdgeBuildRequest,
  ) => Promise<GraphwarOneClickClearDagEdgeBuildResult>;
  /** DAG 建边最大并行数；1 表示让 master Worker 串行建边。 */
  dagEdgeWorkerCount?: number;
  /** 一键清图删点局部保护半径；调用方已限制到当前士兵命中圈内，最终整路验证仍使用真实命中圈。 */
  deleteCheckRadiusPixels: number;
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

/** Worker 边界只能传纯数据；回调在 worker 内部重新挂接。 */
export type GraphwarOneClickClearSearchInput = Omit<
  GraphwarOneClickClearOptions,
  "buildDagEdges" | "isCancelled" | "onDebugTiming" | "routeMask" | "yieldControl"
> & {
  /** 页面侧基础障碍 mask；worker 内部按 route tolerance 派生 route mask。 */
  routeObstacleMask: Uint8Array;
  /** 页面侧基础障碍 mask 的稳定 id，用于 worker 内 route mask cache。 */
  routeMaskCacheId: number;
  /** 当前 route tolerance，供 worker 派生可视图 route mask。 */
  routeTolerancePlanePixels: number;
};

/** 一键清图失败分类，页面用它给出可解释状态。 */
export type GraphwarOneClickClearFailureReason =
  | "no-candidate"
  | "no-usable-target"
  | "pathfinding-worker-failed"
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
  /** 几何 DAG 建路目标点，使用士兵命中圆中心。 */
  routePoint: PixelPoint;
  /** 弹道验证命中圆；和几何建路目标点是两个概念。 */
  hitCircle: GraphwarTrajectoryTargetCircle;
  /** 建路目标点的 Graphwar x；DAG 稳定排序使用，x+ 可达性在平面像素层判断。 */
  sortGraphX: number;
  /** 按建路目标 x 排序后的位置，用于稳定 tie-break。 */
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
  /** 全部建好的几何边；失败验证通过 active=false 禁用边。 */
  edges: OneClickClearDagEdge[];
  /** START 和每个目标的出边表。 */
  outgoingEdges: Map<number, OneClickClearDagEdge[]>;
  /** 按建路目标 x 排序后的目标。 */
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

/** 一次清图搜索尝试的控制流：失败直接结束，retry 禁边后重跑 DP，validated 进入成功落地。 */
type OneClickClearSearchAttemptResult =
  | {
      /** 当前 DAG 没有可继续使用的路线。 */
      reason: GraphwarOneClickClearFailureReason;
      type: "failure";
      /** 已累计的建边、验证和优化工作量。 */
      workUnits: number;
    }
  | {
      /** 验证失败的边；外层负责禁用后重跑 DAG DP。 */
      failedEdge: OneClickClearDagEdge;
      type: "retry";
      /** 已累计的建边、验证和优化工作量。 */
      workUnits: number;
    }
  | {
      /** 已通过增量验证、删点优化和最终整路复验的路线。 */
      route: OneClickClearValidatedRoute;
      type: "validated";
      /** 已累计的建边、验证和优化工作量。 */
      workUnits: number;
    };
interface OneClickClearSearchContext {
  options: GraphwarOneClickClearOptions;
}

interface OneClickClearRouteSegmentValidationState {
  /** 已经由上一个增量采样段确认命中的目标数。 */
  initialReachedTargetCount: number;
  /** 上一个增量采样段结束时可恢复的物理状态。 */
  initialState?: GraphwarTrajectorySamplingState;
}

const START_NODE_INDEX = -1;
const MAX_GLOBAL_DELETE_PASSES = 1;
const FALLBACK_TARGET_RADIUS_PIXELS = 1;

/** 用建路目标点 DAG 找到显式击杀最多的追加路径。 */
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
  let dag: OneClickClearDag;
  try {
    dag = await measureOneClickClearDebugTimingAsync(options, "build-dag-edges", () =>
      buildOneClickClearDag(context, targets),
    );
  } catch {
    return createOneClickClearFailure(
      options.isCancelled?.() ? "no-usable-target" : "pathfinding-worker-failed",
      startedAt,
      0,
    );
  }
  let workUnits = dag.edges.length;
  if (dag.edges.length === 0) {
    return createOneClickClearFailure("no-usable-target", startedAt, workUnits);
  }

  while (true) {
    const attempt = await runOneClickClearSearchAttempt(context, dag, workUnits);
    workUnits = attempt.workUnits;
    if (attempt.type === "failure") {
      return createOneClickClearFailure(attempt.reason, startedAt, workUnits);
    }
    if (attempt.type === "validated") {
      const hitTargets = collectOneClickClearHitTargets(options, attempt.route.pathPoints);
      return {
        elapsedMs: Math.max(0, nowMs() - startedAt),
        expandedStates: workUnits,
        pathPoints: attempt.route.pathPoints,
        targetIds: hitTargets.map((target) => target.id),
        targetSequence: hitTargets.map((target) => createOneClickClearTargetCircle(target)),
        type: "success",
      };
    }

    const failedEdge = attempt.failedEdge;
    // 验证失败只禁用定位到的边；下一轮最长路 DP 会在剩余 DAG 中重新选择全局最优路线。
    measureOneClickClearDebugTiming(options, "remove-failed-edge", () => {
      failedEdge.active = false;
    });
  }
}

/** 执行一次候选路线生命周期：DAG 选路、增量验证、删点优化、最终复验。 */
async function runOneClickClearSearchAttempt(
  context: OneClickClearSearchContext,
  dag: OneClickClearDag,
  workUnits: number,
): Promise<OneClickClearSearchAttemptResult> {
  const options = context.options;
  if (options.isCancelled?.()) {
    return {
      reason: "no-usable-target",
      type: "failure",
      workUnits,
    };
  }

  const selectedEdges = measureOneClickClearDebugTiming(options, "dag-longest-path", () =>
    findOneClickClearLongestPath(dag),
  );
  if (selectedEdges.length === 0) {
    return {
      reason: "no-usable-target",
      type: "failure",
      workUnits,
    };
  }

  const validation = measureOneClickClearDebugTiming(options, "validate-route", () =>
    validateOneClickClearDagRoute(context, dag, selectedEdges),
  );
  const nextWorkUnits = workUnits + validation.validationCount;
  const validatedRoute = validation.route;
  if (!validatedRoute) {
    // 增量验证失败时优先返回精确失败边；没有失败边代表 DAG 已无法提供可用路线。
    return validation.failedEdge
      ? {
          failedEdge: validation.failedEdge,
          type: "retry",
          workUnits: nextWorkUnits,
        }
      : {
          reason: "no-usable-target",
          type: "failure",
          workUnits: nextWorkUnits,
        };
  }

  // 删点优化可能改变后续弹道形状，优化后必须对完整目标序列做一次整路复验。
  const optimized = await measureOneClickClearDebugTimingAsync(options, "optimize-path", () =>
    optimizeOneClickClearPath(context, validatedRoute, nextWorkUnits),
  );
  const finalValidation = measureOneClickClearDebugTiming(options, "validate-final", () =>
    sampleOneClickClearTargetSequence(options, optimized.route),
  );
  if (finalValidation.reachesTargetSequenceBeforeObstacle) {
    return {
      route: optimized.route,
      type: "validated",
      workUnits: optimized.workUnits,
    };
  }

  // 整路公式会受后续控制点影响；复验失败时删掉第一个未命中目标对应的边，再让 DAG 回退搜索。
  const failedEdge = selectedEdges[finalValidation.reachedTargetCount] ?? selectedEdges.at(-1);
  return failedEdge
    ? {
        failedEdge,
        type: "retry",
        workUnits: optimized.workUnits,
      }
    : {
        reason: "no-usable-target",
        type: "failure",
        workUnits: optimized.workUnits,
      };
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

/**
 * 收集从当前路径末端建路点 x+ 侧可选的士兵，并按建路点 x 稳定排序。
 *
 * 几何 DAG 使用士兵中心作为建路点；弹道验证使用同一中心加士兵半径组成的命中圆。
 */
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

    const target = createOneClickClearTarget(candidate, sourceIndex, options);
    // DAG 只允许从当前路径尾点继续 x+；判断使用建路目标的 Graphwar x。
    if (!graphXAdvancesStrictly(startGraphX, target.sortGraphX)) {
      continue;
    }

    targets.push(target);
  }

  return targets.sort(compareOneClickClearTargetOrder).map((target, orderIndex) => ({ ...target, orderIndex }));
}

/** 集中构造一键清图内部目标，避免调用点混用“建路点”和“命中圈”。 */
function createOneClickClearTarget(
  candidate: GraphwarOneClickClearCandidate,
  sourceIndex: number,
  options: Pick<GraphwarOneClickClearOptions, "bounds" | "boundsRect">,
): OneClickClearTarget {
  // 建路点使用命中圆中心；命中验证由 hitCircle 保存中心和半径。
  const routePoint = candidate.hitCenter;
  return {
    ...candidate,
    hitCircle: {
      center: candidate.hitCenter,
      radius: candidate.hitRadius,
    },
    orderIndex: 0,
    routePoint,
    sortGraphX: imageToGraphPoint(routePoint, options.bounds, options.boundsRect).x,
    sourceIndex,
  };
}

/** 按建路目标点排序；同 x 不建边，但排序仍需稳定，y 和输入序号只负责 tie-break。 */
function compareOneClickClearTargetOrder(left: OneClickClearTarget, right: OneClickClearTarget) {
  return (
    left.sortGraphX - right.sortGraphX || left.routePoint.y - right.routePoint.y || left.sourceIndex - right.sourceIndex
  );
}

/** 建立 START 和士兵建路点之间的几何 DAG；这里只做寻路，不做公式模拟。 */
async function buildOneClickClearDag(
  context: OneClickClearSearchContext,
  targets: readonly OneClickClearTarget[],
): Promise<OneClickClearDag> {
  const options = context.options;
  const startPoint = options.pathPoints.at(-1) ?? options.pathPoints[0];
  const edges: OneClickClearDagEdge[] = [];
  const outgoingEdges = new Map<number, OneClickClearDagEdge[]>();
  const jobs = collectOneClickClearDagEdgeBuildJobs(startPoint, targets);
  const result = await buildOneClickClearDagEdgeRoutes(context, jobs);
  emitOneClickClearDebugTimings(options, result.timings);

  const routesByJobId = new Map(result.routes.map((route) => [route.jobId, route.route]));
  for (const job of jobs) {
    const route = routesByJobId.get(job.id);
    if (route) {
      addOneClickClearDagEdge(edges, outgoingEdges, job.from, job.to, route);
    }
  }

  return {
    edges,
    outgoingEdges,
    targets: [...targets],
  };
}

/** 枚举 START 和目标之间的候选几何边；建边只看 routePoint，不做公式模拟。 */
function collectOneClickClearDagEdgeBuildJobs(startPoint: PixelPoint, targets: readonly OneClickClearTarget[]) {
  const jobs: GraphwarOneClickClearDagEdgeBuildJob[] = [];
  for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
    const target = targets[targetIndex];
    if (!target) {
      continue;
    }
    // START 可以尝试直达每个 x+ 侧目标，后续由几何寻路和公式验证过滤不可用边。
    jobs.push({
      id: jobs.length,
      startPoint,
      targetPoint: target.routePoint,
      to: targetIndex,
    });
  }

  for (let fromIndex = 0; fromIndex < targets.length; fromIndex += 1) {
    const from = targets[fromIndex];
    if (!from) {
      continue;
    }
    for (let toIndex = fromIndex + 1; toIndex < targets.length; toIndex += 1) {
      const to = targets[toIndex];
      // 目标已按 sortGraphX 排序；同 x 不能构成 Graphwar x+ 边。
      if (!to || !graphXAdvancesStrictly(from.sortGraphX, to.sortGraphX)) {
        continue;
      }

      jobs.push({
        from: fromIndex,
        id: jobs.length,
        startPoint: from.routePoint,
        targetPoint: to.routePoint,
        to: toIndex,
      });
    }
  }
  return jobs;
}

async function buildOneClickClearDagEdgeRoutes(
  context: OneClickClearSearchContext,
  jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[],
): Promise<GraphwarOneClickClearDagEdgeBuildResult> {
  const options = context.options;
  const request = createOneClickClearDagEdgeBuildRequest(options, jobs);
  try {
    return await options.buildDagEdges(request);
  } catch {
    if (options.isCancelled?.()) {
      return { routes: [], timings: [] };
    }
    throw new Error("One-Click Clear pathfinding worker failed");
  }
}

function createOneClickClearDagEdgeBuildRequest(
  options: GraphwarOneClickClearOptions,
  jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[],
): GraphwarOneClickClearDagEdgeBuildRequest {
  return {
    boundaryExpansion: options.boundaryExpansion,
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    jobs,
    routeMask: options.routeMask.mask,
    routeTolerancePlanePixels: options.routeMask.routeTolerancePlanePixels,
    workerCount: options.dagEdgeWorkerCount ?? 1,
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

/** 在建路目标点有序 DAG 上做最长路 DP；同分时选几何点更少、终点更靠前。 */
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
  let segmentState: OneClickClearRouteSegmentValidationState = { initialReachedTargetCount: 0 };
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
    const validation = validateOneClickClearRouteSegment(context, nextPath, nextTargetSequence, segmentState);
    if (!validation) {
      return { failedEdge: edge, validationCount };
    }

    pathPoints = nextPath;
    segmentState = {
      initialReachedTargetCount: validation.reachedTargetCount,
      ...(validation.sample.endState ? { initialState: validation.sample.endState } : {}),
    };
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

/** 只续采样新增段；目标命中验证使用 hitCircle，最终整路验证仍会重采样一次。 */
function validateOneClickClearRouteSegment(
  context: OneClickClearSearchContext,
  nextPath: readonly PixelPoint[],
  targetSequence: readonly OneClickClearTarget[],
  state: OneClickClearRouteSegmentValidationState,
): GraphwarTrajectorySampleResult | undefined {
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
      initialReachedTargetCount: state.initialReachedTargetCount,
      initialState: state.initialState,
      skipInitialStop: state.initialState !== undefined,
      targetSequence: targetSequence.map((target) => target.hitCircle),
    }),
  );
  return result.reachedTargetCount >= targetSequence.length ? result : undefined;
}

/** 最终整路验证按显式目标命中圈序列重采样，作为增量验证后的安全网。 */
function validateOneClickClearTargetSequence(
  options: GraphwarOneClickClearOptions,
  route: Pick<OneClickClearValidatedRoute, "pathPoints" | "targetSequence">,
) {
  return sampleOneClickClearTargetSequence(options, route).reachesTargetSequenceBeforeObstacle;
}

/** 返回整条弹道复验结果；routePoint 提供目标采样点，hitCircle 提供真实命中半径。 */
function sampleOneClickClearTargetSequence(
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
    targetCircles: route.targetSequence.map((target) => target.hitCircle),
    targetPoints: route.targetSequence.map((target) => target.routePoint),
  });
  return result;
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

/** 全局删点只保护原 prefix；新增序列一直到末尾都可尝试删除。 */
async function optimizeOneClickClearPath(
  context: OneClickClearSearchContext,
  route: OneClickClearValidatedRoute,
  workUnits: number,
) {
  let optimized = route;
  const firstGeneratedIndex = context.options.pathPoints.length;
  const localDeleteProofIsEnough = oneClickClearLocalDeleteProofIsEnough(context.options);
  for (let pass = 0; pass < MAX_GLOBAL_DELETE_PASSES; pass += 1) {
    for (let index = firstGeneratedIndex; index < optimized.pathPoints.length; ) {
      if (context.options.isCancelled?.()) {
        return { route: optimized, workUnits };
      }

      workUnits += 1;
      if (!oneClickClearPointDeleteKeepsLocalSoldierHits(context.options, optimized.pathPoints, index)) {
        index += 1;
        await yieldOneClickClearControl(context.options);
        continue;
      }

      const candidatePath = [...optimized.pathPoints.slice(0, index), ...optimized.pathPoints.slice(index + 1)];
      if (
        localDeleteProofIsEnough ||
        validateOneClickClearTargetSequence(context.options, { ...optimized, pathPoints: candidatePath })
      ) {
        optimized = { ...optimized, pathPoints: candidatePath };
        continue;
      }
      index += 1;

      await yieldOneClickClearControl(context.options);
    }
  }
  if (localDeleteProofIsEnough && optimized !== route) {
    workUnits += 1;
    // y=/y'= abs 的删点可由局部折线命中证明；这里保留一次整体验证，防止障碍/边界等非士兵因素漏判。
    if (!validateOneClickClearTargetSequence(context.options, optimized)) {
      return { route, workUnits };
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

function oneClickClearPointDeleteKeepsLocalSoldierHits(
  options: GraphwarOneClickClearOptions,
  points: readonly PixelPoint[],
  deletedIndex: number,
) {
  const previousPoint = points[deletedIndex - 1];
  const deletedPoint = points[deletedIndex];
  const nextPoint = points[deletedIndex + 1];
  if (!previousPoint || !deletedPoint) {
    return false;
  }

  // abs 删除一个控制点时，只会把 previous->deleted->next 替换成 previous->next；先证明局部士兵命中不丢。
  // 页面已保证删点检验半径为正数；热点循环只传半径平方，避免每段重复乘法和点命中 helper。
  const checkRadiusSquared = options.deleteCheckRadiusPixels * options.deleteCheckRadiusPixels;
  for (const target of options.hitCandidates) {
    const targetCenter = target.hitCenter;
    const oldLocalPathHitsTarget =
      pixelSegmentHitsCircle(previousPoint, deletedPoint, targetCenter, checkRadiusSquared) ||
      (nextPoint ? pixelSegmentHitsCircle(deletedPoint, nextPoint, targetCenter, checkRadiusSquared) : false);
    if (!oldLocalPathHitsTarget) {
      continue;
    }

    let newLocalPathHitsTarget: boolean;
    if (nextPoint) {
      newLocalPathHitsTarget = pixelSegmentHitsCircle(previousPoint, nextPoint, targetCenter, checkRadiusSquared);
    } else {
      const pointDx = targetCenter.x - previousPoint.x;
      const pointDy = targetCenter.y - previousPoint.y;
      newLocalPathHitsTarget = pointDx * pointDx + pointDy * pointDy < checkRadiusSquared;
    }
    if (!newLocalPathHitsTarget) {
      return false;
    }
  }
  return true;
}

function oneClickClearLocalDeleteProofIsEnough(options: GraphwarOneClickClearOptions) {
  return options.settings.algorithm === "abs" && options.settings.equation !== "ddy";
}

function pixelSegmentHitsCircle(start: PixelPoint, end: PixelPoint, center: PixelPoint, radiusSquared: number) {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (segmentLengthSquared === 0) {
    const pointDx = center.x - start.x;
    const pointDy = center.y - start.y;
    return pointDx * pointDx + pointDy * pointDy < radiusSquared;
  }

  // 删点优化会反复调用这里；展开 clamp、最近点和距离计算，避免短命对象和额外函数层级。
  let ratio = ((center.x - start.x) * segmentX + (center.y - start.y) * segmentY) / segmentLengthSquared;
  if (ratio < 0) {
    ratio = 0;
  } else if (ratio > 1) {
    ratio = 1;
  }

  const closestX = start.x + segmentX * ratio;
  const closestY = start.y + segmentY * ratio;
  const closestDx = center.x - closestX;
  const closestDy = center.y - closestY;
  return closestDx * closestDx + closestDy * closestDy < radiusSquared;
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
    emitOneClickClearDebugTiming(options, {
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
    emitOneClickClearDebugTiming(options, {
      elapsedMs: nowMs() - startedAt,
      stage,
    });
  }
}

function emitOneClickClearDebugTimings(
  options: GraphwarOneClickClearOptions,
  timings: readonly GraphwarOneClickClearDebugTiming[],
) {
  for (const timing of timings) {
    emitOneClickClearDebugTiming(options, timing);
  }
}

function emitOneClickClearDebugTiming(options: GraphwarOneClickClearOptions, timing: GraphwarOneClickClearDebugTiming) {
  options.onDebugTiming?.(timing);
}

function nowMs() {
  return performance.now();
}
