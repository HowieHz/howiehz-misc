/** 在当前 Graphwar 路径后追加一键清图路线；几何建路点和弹道命中圈分开建模。 */
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { imageToGraphPoint, pixelCirclesEqual, pixelPointsEqual } from "../../core/geometry";
import { graphXAdvancesStrictly } from "../../core/numbers";
import { nowMs } from "../../core/time";
import type { BoundsRect, GraphBounds, GraphPoint, PixelPoint } from "../../core/types";
import type { GraphwarSignProtection } from "../../formula/generation/build";
import { formulaModeUsesStepGlitch } from "../../formula/generation/capabilities";
import { resolveStepFormula } from "../../formula/generation/step-numeric-strategy";
import type { GraphwarTrajectorySamplingState } from "../../formula/simulation/simulator";
import {
  compareGraphwarPathErrors,
  getGraphwarTrajectoryLaunchAngle,
  graphwarTrajectoryReachesGraphXAfterTargetsBeforeObstacle,
  graphwarTrajectoryReachesGraphXBeforeObstacle,
  measureGraphwarFormulaPathError,
  sampleGraphwarPathTargetSequence,
  tryResolveGraphwarTrajectoryCandidate,
} from "../../formula/trajectory/sampling";
import type {
  GraphwarStepGlitchFormulaPrefix,
  GraphwarTrajectoryFormulaContext,
  GraphwarTrajectoryFormulaSettings,
  GraphwarTrajectorySampleResult,
  GraphwarTrajectoryTargetCircle,
} from "../../formula/trajectory/sampling";
import { snapshotGraphwarVisibleTrajectoryPoints } from "../../formula/trajectory/visible-points";
import type { GraphwarPathfindingRouteMode } from "../routing/mode";
import {
  createGraphwarStepGlitchPrefixScanner,
  createGraphwarStepGlitchScanMaskIndex,
  findGraphwarStepGlitchAcceptedPointAtOrAfterControlX,
} from "../routing/step-glitch-scan";
import type {
  GraphwarStepGlitchPrefixEvidence,
  GraphwarStepGlitchPrefixScanner,
  GraphwarStepGlitchScanTimingStage,
} from "../routing/step-glitch-scan";
import type { GraphwarPathfindingDebugMetrics } from "../runtime/diagnostics";
import { supportsOneClickClear } from "./support";
import { assignGraphwarOneClickClearTargetRoutePoints } from "./target-assignment";

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
  | "assign-clear-targets"
  | "build-dag-edges"
  | "dag-longest-path"
  | "optimize-path"
  | "outside-search-stages"
  | "prefix-evidence-hit"
  | "prefix-evidence-miss"
  | "prepare-pathfinding-prefix"
  | "remove-failed-edge"
  | "route-mask-cache-hit"
  | "route-mask-cache-miss"
  | "route-map-pixels"
  | "route-pathfinding"
  | "scan-step-glitch"
  | "segment-graph-rule"
  | "segment-sample-trajectory"
  | "validate-final"
  | "validate-direct-trajectory"
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
  /** 本边起点的具体 DAG node id；START 使用固定虚拟 node id。 */
  from: number;
  /** Step 本边开始前的实际累计高度；ABS 建路忽略该字段。 */
  resolvedStartY?: number;
  /** Step 本边开始前的 canonical 打印系数累计身份。 */
  resolvedStartStateKey?: string;
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
  /** 截图内 Graphwar 坐标系矩形。 */
  boundsRect: BoundsRect;
  /** 障碍和坐标系边界命中检测的内收值，单位为 Graphwar 原始平面像素。 */
  boundaryExpansion: number;
  /** 待尝试的 DAG 边，已按稳定顺序生成。 */
  jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[];
  /** 已按 route tolerance 处理后的障碍 mask。 */
  routeMask: Uint8Array;
  /** Step 解析累计高度的固定起点；ABS 建路忽略该字段。 */
  routeOriginPoint: PixelPoint;
  /** 几何路线算法模式；由页面寻路算法选择统一控制。 */
  routeMode: GraphwarPathfindingRouteMode;
  /** 当前 route tolerance，单位为 Graphwar 原始平面像素，供可视图轮廓简化使用。 */
  routeTolerancePlanePixels: number;
  /** Step 边判定所需的最终公式数值设置；不携带仅供轨迹模拟使用的 mask。 */
  settings: Pick<
    GraphwarTrajectoryFormulaSettings,
    "algorithm" | "decimalPlaces" | "equation" | "formulaPathSteepness" | "steepness"
  >;
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
  /** Step route 逐段解析后的实际累计高度；ABS 建路不返回该字段。 */
  resolvedEndY?: number;
  /** Step route 终点的 canonical 打印系数累计身份。 */
  resolvedEndStateKey?: string;
  /** 已按截图像素映射且首尾替换为精确控制点的几何路径。 */
  route?: PixelPoint[];
}

/** 已通过本次最终量化公式模拟、可直接交给 Agent 发射的当前最优方案。 */
export interface GraphwarOneClickClearIncumbent {
  /** 与前缀验证使用相同公式上下文生成的 Graphwar 表达式。 */
  expression: string;
  /** Y'' 模式需要的发射角；其他模式省略，单位为弧度，可直接用于 /shots。 */
  launchAngleRadians?: number;
  /** 已验证方案的完整截图像素路径。 */
  pathPoints: PixelPoint[];
  /** 与表达式和可选发射角来自同一次权威验证的可绘制轨迹快照。 */
  trajectoryPoints: readonly PixelPoint[];
}

/** 运行一键清图所需的纯数据。 */
export interface GraphwarOneClickClearOptions {
  /** 当前障碍边界收缩值，单位为 Graphwar 原始平面像素。 */
  boundaryExpansion: number;
  /** 当前 Graphwar 坐标边界。 */
  bounds: GraphBounds;
  /** 截图内 Graphwar 坐标系矩形。 */
  boundsRect: BoundsRect;
  /** 候选士兵；友伤开关过滤由调用方负责。 */
  candidates: readonly GraphwarOneClickClearCandidate[];
  /** 调试开启时跨全部候选累计的计数器与细分耗时。 */
  debugMetrics?: GraphwarPathfindingDebugMetrics;
  /** 用于统计整条弹道击杀数的士兵；不受 DAG 起点右侧过滤影响。 */
  hitCandidates: readonly GraphwarOneClickClearCandidate[];
  /** 长循环取消检查。 */
  isCancelled?: () => boolean;
  /** 内部调试耗时回调；调用方负责聚合同类阶段，避免刷屏。 */
  onDebugTiming?: (timing: GraphwarOneClickClearDebugTiming) => void;
  /** 主搜索自然验证出更长前缀时发布；回调本身不会触发额外轨迹回放。 */
  onValidatedIncumbent?: (incumbent: GraphwarOneClickClearIncumbent) => void;
  /** Master 注入的最后一条精确旧整式证据；搜索内成功前缀只在本请求局部提升。 */
  stepGlitchPrefixEvidence?: GraphwarStepGlitchPrefixEvidence;
  /** 最终整路成功后把 exact path evidence 交回 Master 事务性发布。 */
  onValidatedStepGlitchPath?: (evidence: {
    acceptedPoint: GraphPoint;
    path: readonly PixelPoint[];
    prefixTarget: GraphwarTrajectoryTargetCircle;
    stepGlitchFormulaPrefix?: GraphwarStepGlitchFormulaPrefix;
    targetSequence: readonly GraphwarTrajectoryTargetCircle[];
  }) => void;
  /** 批量 DAG 建边入口；即使串行也交给 master Worker，避免在主线程跑几何搜索。 */
  buildDagEdges: (
    request: GraphwarOneClickClearDagEdgeBuildRequest,
  ) => Promise<GraphwarOneClickClearDagEdgeBuildResult>;
  /** DAG 建边最大并行数；1 表示让 master Worker 串行建边。 */
  dagEdgeWorkerCount?: number;
  /** 一键清图删点局部命中检查半径，单位为截图像素；0 表示每次候选删点都走整路验证。 */
  deleteHitCheckRadiusPixels: number;
  /** 是否尝试删除控制点；关闭时仍执行最终整路验证和命中统计。 */
  isDeleteOptimizationEnabled?: boolean;
  /** 当前路径已有像素点。 */
  pathPoints: readonly PixelPoint[];
  /** 当前最后路径点的验证目标；传入士兵命中圈时可复用现有路径预检语义。 */
  prefixTarget?: GraphwarTrajectoryTargetCircle;
  /** 一键清图单值几何路线 mask。 */
  routeMask: GraphwarOneClickClearRouteMask;
  /** 几何路线算法模式；DAG 建边和普通寻路保持一致。 */
  routeMode: GraphwarPathfindingRouteMode;
  /** 函数模拟用障碍 mask。 */
  simulationMask?: Uint8Array;
  /** 页面侧 simulation mask 的稳定快照 id。 */
  simulationMaskCacheId: number;
  /** 函数模拟边界收缩值，单位为 Graphwar 原始平面像素。 */
  simulationBoundaryExpansion: number;
  /** 当前公式采样设置。 */
  settings: GraphwarTrajectoryFormulaSettings;
  /** Step 严格包络整路校验；由持有共用 summed-area 的 master Worker 注入。 */
  validateStepRoute?: (points: readonly PixelPoint[]) => boolean;
  /** 让出主线程控制权；页面用于响应取消和刷新状态。 */
  yieldControl?: () => Promise<void> | void;
}

/** Worker 边界只能传纯数据；回调在 worker 内部重新挂接。 */
export type GraphwarOneClickClearSearchInput = Omit<
  GraphwarOneClickClearOptions,
  | "buildDagEdges"
  | "debugMetrics"
  | "isCancelled"
  | "onDebugTiming"
  | "onValidatedIncumbent"
  | "onValidatedStepGlitchPath"
  | "routeMask"
  | "stepGlitchPrefixEvidence"
  | "validateStepRoute"
  | "yieldControl"
> & {
  /** Worker 请求显式传递删点偏好，不依赖直接调用 API 的兼容默认值。 */
  isDeleteOptimizationEnabled: boolean;
  /** 页面侧基础障碍 mask；worker 内部按 route tolerance 派生 route mask。 */
  routeObstacleMask: Uint8Array;
  /** 页面侧基础障碍 mask 的稳定 id，用于 worker 内 route mask cache。 */
  routeMaskCacheId: number;
  /** 当前 route tolerance，单位为 Graphwar 原始平面像素，供 worker 派生可视图 route mask。 */
  routeTolerancePlanePixels: number;
};

/** 一键清图失败分类，页面用它给出可解释状态。 */
export type GraphwarOneClickClearFailureReason =
  | "no-candidate"
  | "no-usable-target"
  | "pathfinding-worker-failed"
  | "preflight-blocked"
  | "unsupported";

/** 一键清图搜索结果；成功分支直接携带最终验证的公式方案，页面不得只按路径重新解算。 */
export type GraphwarOneClickClearResult =
  | (GraphwarOneClickClearIncumbent & {
      elapsedMs: number;
      expandedStates: number;
      reason?: undefined;
      targetIds: string[];
      type: "success";
    })
  | {
      elapsedMs: number;
      expandedStates: number;
      /** Step 已有路径严格域失败时的首个段下标。 */
      invalidSegmentIndex?: number;
      reason: GraphwarOneClickClearFailureReason;
      type: "failure";
    };

/** 一键清图内部统一的建路点、命中圈和排序信息。 */
interface OneClickClearTarget extends GraphwarOneClickClearCandidate {
  /** 几何建路目标点；共享分配器可在真实命中圆内调整 x。 */
  routePoint: PixelPoint;
  /** 弹道验证命中圆；和几何建路目标点是两个概念。 */
  hitCircle: GraphwarTrajectoryTargetCircle;
  /** 建路目标点的 Graphwar x；DAG 稳定排序使用，x+ 可达性在平面像素层判断。 */
  sortGraphX: number;
}

/** 从一个 DAG 节点到下一个目标状态的已建路线。 */
interface OneClickClearDagEdge {
  /** True 表示函数验证失败后从 DAG 中删除。 */
  active: boolean;
  /** 本边追加到已有路径时新增的点数，用于最长路 tie-break。 */
  addedPointCount: number;
  /** 本边起点的具体 DAG node id；START 使用固定虚拟 node id。 */
  from: number;
  /** 边 id，删除失败边时直接定位。 */
  id: number;
  /** 已按截图像素映射且首尾替换为精确控制点的几何路径。 */
  route: PixelPoint[];
  /** 本边终点的具体 DAG node id。 */
  to: number;
  /** 本边控制点在 Graphwar 坐标中的累计纵向变化。 */
  verticalVariation: number;
}

/** 目标及公式平台状态共同确定的 DAG 节点。 */
interface OneClickClearDagNode {
  /** 稳定 node id；边和 DP 都只引用该 id。 */
  id: number;
  /** Step 到达该目标后的实际累计高度；ABS 节点不需要状态。 */
  resolvedY?: number;
  /** Step 到达该目标后的 canonical 打印系数累计身份。 */
  resolvedStateKey?: string;
  /** 本节点对应的目标士兵下标。 */
  targetIndex: number;
}

/** 一键清图目标节点、邻接边和目标分层索引。 */
interface OneClickClearDag {
  /** 全部建好的几何边；失败验证通过 active=false 禁用边。 */
  edges: OneClickClearDagEdge[];
  /** 全部具体状态节点；id 与数组下标一致。 */
  nodes: OneClickClearDagNode[];
  /** 按目标下标分组的节点；DP 依目标 x 层迭代，避免依赖节点发现顺序。 */
  nodesByTargetIndex: OneClickClearDagNode[][];
  /** START 和每个具体状态节点的出边表。 */
  outgoingEdges: Map<number, OneClickClearDagEdge[]>;
  /** 按建路目标 x 排序后的目标。 */
  targets: OneClickClearTarget[];
}

/** 到达某个 DAG 节点的当前最佳累计路径。 */
interface OneClickClearBestEntry {
  /** 到达该具体状态节点时的显式击杀数。 */
  killCount: number;
  /** 到达该目标时的几何路径点数。 */
  routePointCount: number;
  /** 上一条边，用于回溯路径。 */
  previousEdge: OneClickClearDagEdge;
  /** 到达该目标时累计的 Graphwar 纵向变化。 */
  verticalVariation: number;
}

/** 通过公式回放的路径、目标序列和可选公式上下文。 */
interface OneClickClearValidatedRoute {
  /** 最后一次段验证已经构造的精确公式上下文；路径变更后必须丢弃。 */
  formulaContext?: GraphwarTrajectoryFormulaContext;
  /** 最终整路回放的普通控制点最大误差；只用于同业务指标 incumbent 的末级排序。 */
  pathError?: number;
  /** 当前清图结果的完整路径。 */
  pathPoints: PixelPoint[];
  /** 已按 DAG 序列验证命中的目标。 */
  targetSequence: OneClickClearTarget[];
  /** 与 formulaContext 同一次验证得到的可绘制轨迹；路径变更时必须一并丢弃。 */
  trajectoryPoints?: PixelPoint[];
}

/** 最终回放中需记录命中时刻的目标。 */
interface OneClickClearTrackedTarget {
  /** 最终路径仍保留的显式目标控制点。 */
  anchor?: PixelPoint;
  /** 当前识别快照中的 id。 */
  id?: string;
  hitCircle: GraphwarTrajectoryTargetCircle;
}

/** 已命中目标及其首次命中采样位置。 */
interface OneClickClearHitTarget extends OneClickClearTrackedTarget {
  /** 首次命中该目标时的采样点数量，用于按弹道顺序稳定显示结果。 */
  hitSamplePointCount: number;
}

/** DAG 路线验证结果及失败边统计。 */
interface OneClickClearRouteValidationResult {
  /** 失败的边；存在时调用方应删除该边并重新跑 DP。 */
  failedEdge?: OneClickClearDagEdge;
  /** 验证成功的完整路线。 */
  route?: OneClickClearValidatedRoute;
  /** 本轮验证做过的公式模拟次数。 */
  validationCount: number;
}

/** 可供下一条 DAG 候选恢复的已验证前缀快照。 */
interface OneClickClearRouteValidationSnapshot {
  /** 本快照已经验证到的最后一条边；重选路线只复用连续相同的 edge id 前缀。 */
  edgeId: number;
  /** 已验证前缀的完整路径。 */
  pathPoints: PixelPoint[];
  /** ABS 可从物理状态续播；Step 只复用目标和路径，追加后缀仍从发射点回放。 */
  segmentState: OneClickClearRouteSegmentValidationState;
  /** 已验证前缀按顺序命中的目标。 */
  targetSequence: OneClickClearTarget[];
}

/** 删点优化后的路线、工作量和可选最终回放。 */
interface OneClickClearPathOptimizationResult {
  /** 局部快检删点后的精确路径若已完整复验，调用方可直接复用结果及其公式上下文。 */
  finalValidation?: ReturnType<typeof sampleOneClickClearTargetSequence>;
  route: OneClickClearValidatedRoute;
  workUnits: number;
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
      /** 最终整路复验同一次回放统计出的全部实际命中。 */
      hitTargets: OneClickClearHitTarget[];
      type: "validated";
      /** 已累计的建边、验证和优化工作量。 */
      workUnits: number;
    };
/** 单次一键清图搜索共享的选项、incumbent 和前缀缓存。 */
interface OneClickClearSearchContext {
  /** 只按本轮显式目标数筛选消息；完整取消检查点由主线程持有，Worker 不重复缓存路径。 */
  bestValidatedTargetCount: number;
  /** 当前 incumbent 的控制点数；显式目标数相同时优先较短路径。 */
  bestValidatedPointCount: number;
  /** 当前 incumbent 的末级路径质量；undefined 表示没有质量点，不参与比较。 */
  bestValidatedPathError?: number;
  options: GraphwarOneClickClearOptions;
  /** DAG 禁边重选时复用上一轮完全相同的已验证边前缀。 */
  routeValidationPrefix?: OneClickClearRouteValidationSnapshot[];
}

/** 增量验证下一条边时可恢复的轨迹状态。 */
interface OneClickClearRouteSegmentValidationState {
  /** 上一个增量采样段结束时可恢复的物理状态。 */
  initialState?: GraphwarTrajectorySamplingState;
  /** 物理状态只对生成它的局部 sign 保护集合有效。 */
  signProtection?: GraphwarSignProtection;
  /** 已验证前缀的普通控制点最大路径误差；续播后与新增段误差取最大值。 */
  pathError?: number;
  /** ABS 从物理状态续播时已经验证过的可绘制轨迹前缀。 */
  trajectoryPoints?: PixelPoint[];
}

/** 单条新增边的公式上下文和采样结果。 */
interface OneClickClearRouteSegmentValidationResult {
  formulaContext: GraphwarTrajectoryFormulaContext;
  sampleResult: GraphwarTrajectorySampleResult;
  /** 当前完整路径对应的可绘制轨迹；ABS 续播结果已和旧前缀拼接。 */
  trajectoryPoints: PixelPoint[];
}

const START_NODE_INDEX = -1;
// 截图像素：缺省 prefixTarget 和目标序列默认半径都会用它；显式 targetCircles 会覆盖。
const FALLBACK_TARGET_RADIUS_IMAGE_PIXELS = 1;

/** 用共享目标分配和当前公式模式找到显式击杀最多的追加路径。 */
export async function buildGraphwarOneClickClearPath(
  options: GraphwarOneClickClearOptions,
): Promise<GraphwarOneClickClearResult> {
  const startedAt = nowMs();
  if (!supportsOneClickClear(options.settings.algorithm)) {
    return createOneClickClearFailure("unsupported", startedAt, 0);
  }
  if (options.pathPoints.length === 0) {
    return createOneClickClearFailure("preflight-blocked", startedAt, 0);
  }

  const stepGlitchMode = formulaModeUsesStepGlitch(
    options.settings.algorithm,
    options.settings.equation,
    options.settings.stepGlitchMode,
  );
  const prefixValid = stepGlitchMode
    ? true
    : options.pathPoints.length >= 2
      ? measureOneClickClearDebugTiming(
          options,
          "validate-prefix",
          () => oneClickClearStepRouteIsValid(options, options.pathPoints) && validateOneClickClearPrefix(options),
        )
      : true;
  if (!prefixValid) {
    return createOneClickClearFailure("preflight-blocked", startedAt, 0);
  }

  const targets = measureOneClickClearDebugTiming(options, "assign-clear-targets", () =>
    collectOneClickClearTargets(options),
  );
  if (targets.length === 0) {
    return createOneClickClearFailure("no-candidate", startedAt, 0);
  }

  const context: OneClickClearSearchContext = {
    bestValidatedPointCount: Number.POSITIVE_INFINITY,
    bestValidatedTargetCount: 0,
    options,
  };
  // 失败仍按失败返回，让主线程明确显示“已保留当前最优结果”；检查点已通过回调独立保存。
  return stepGlitchMode
    ? await buildOneClickClearStepGlitchPath(context, targets, startedAt)
    : await buildOneClickClearDagPath(context, targets, startedAt);
}

/** 建立完整 DAG，并反复禁用公式验证失败的边，直到得到最终复验成功的路线。 */
async function buildOneClickClearDagPath(
  context: OneClickClearSearchContext,
  targets: readonly OneClickClearTarget[],
  startedAt: number,
): Promise<GraphwarOneClickClearResult> {
  const options = context.options;
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
      publishOneClickClearValidatedRoute(context, attempt.route);
      return createOneClickClearSuccessResult(options, attempt.route, attempt.hitTargets, startedAt, workUnits);
    }

    const failedEdge = attempt.failedEdge;
    // 验证失败只禁用定位到的边；下一轮最长路 DP 会在剩余 DAG 中重新选择全局最优路线。
    measureOneClickClearDebugTiming(options, "remove-failed-edge", () => {
      failedEdge.active = false;
    });
  }
}

/** 邪道清图按分配后的目标 x 顺序扫描；跳过单个目标不应回到普通 DAG。 */
async function buildOneClickClearStepGlitchPath(
  context: OneClickClearSearchContext,
  targets: readonly OneClickClearTarget[],
  startedAt: number,
): Promise<GraphwarOneClickClearResult> {
  const options = context.options;
  const simulationMask = options.simulationMask ?? options.settings.stepGlitchObstacleMask;
  if (!simulationMask) {
    return createOneClickClearFailure("preflight-blocked", startedAt, 0);
  }

  const maskIndex = createGraphwarStepGlitchScanMaskIndex({
    boundaryExpansion: options.simulationBoundaryExpansion,
    bounds: options.bounds,
    simulationMask,
  });
  let route: OneClickClearValidatedRoute = {
    pathPoints: [...options.pathPoints],
    targetSequence: [],
  };
  let prefixScanner: GraphwarStepGlitchPrefixScanner | undefined;
  let prefixEvidence = options.stepGlitchPrefixEvidence;
  let stepGlitchFormulaPrefix = options.stepGlitchPrefixEvidence?.stepGlitchFormulaPrefix;
  let workUnits = 0;
  let acceptedLayerGraphX: number | undefined;

  for (const target of targets) {
    // 同 x 保底目标是替代候选；该层已有控制点后直接进入下一层，顺路命中仍由最终弹道统计。
    if (acceptedLayerGraphX === target.sortGraphX) {
      continue;
    }
    if (options.isCancelled?.()) {
      return createOneClickClearFailure("no-usable-target", startedAt, workUnits);
    }

    prefixScanner ??= createGraphwarStepGlitchPrefixScanner({
      bounds: options.bounds,
      boundsRect: options.boundsRect,
      debugMetrics: options.debugMetrics,
      maskIndex,
      ...(prefixEvidence ? { prefixEvidence } : {}),
      ...(stepGlitchFormulaPrefix ? { stepGlitchFormulaPrefix } : {}),
      ...(route.targetSequence.length === 0 && options.prefixTarget ? { prefixTarget: options.prefixTarget } : {}),
      requiredTargets: createOneClickClearPreviousTargets(route.targetSequence),
      settings: options.settings,
      simulationBoundaryExpansion: options.simulationBoundaryExpansion,
      simulationMask,
      sourcePath: route.pathPoints,
    });
    const scan = prefixScanner.scan({ hitTarget: target.hitCircle, targetPoint: target.routePoint });
    appendOneClickClearStepGlitchScanTimings(options, scan.timings);
    workUnits += scan.expandedStates;

    // 只有命中才提交路线；其他结果保留最近命中的路线，让更右目标重新选择上下通道。
    if (scan.status === "hit") {
      acceptedLayerGraphX = target.sortGraphX;
      route = {
        ...(scan.formulaContext ? { formulaContext: scan.formulaContext } : {}),
        pathPoints: scan.path,
        targetSequence: [...route.targetSequence, target],
        trajectoryPoints: scan.trajectoryPoints,
      };
      // hit 已包含精确整式模拟；此时发布不会为了预览再做一次昂贵采样。
      if (route.formulaContext) {
        publishOneClickClearValidatedRoute(context, route);
      }
      // 成功候选已完整模拟；下一目标复用 exact path 的恢复点，不再重算刚提交的 prefix。
      prefixEvidence = { acceptedPoint: scan.acceptedPoint };
      stepGlitchFormulaPrefix = scan.stepGlitchFormulaPrefix;
      // 每个 hit 都是可独立采用的精确路径；最终失败时 Master 仍应能复用被页面保留的这个前缀。
      publishOneClickClearStepGlitchHitEvidence(options, route, scan.acceptedPoint, scan.stepGlitchFormulaPrefix);
      prefixScanner = undefined;
    } else if (scan.status === "invalid-input" || scan.status === "unsupported") {
      return createOneClickClearFailure("preflight-blocked", startedAt, workUnits);
    }

    await yieldOneClickClearControl(options);
  }

  const finalized =
    options.isDeleteOptimizationEnabled !== false
      ? await measureOneClickClearDebugTimingAsync(options, "optimize-path", () =>
          optimizeOneClickClearPath(context, route, workUnits),
        )
      : { route, workUnits };
  workUnits = finalized.workUnits;
  const finalValidation = measureOneClickClearDebugTiming(options, "validate-final", () =>
    sampleOneClickClearTargetSequence(options, finalized.route, true),
  );
  if (!finalValidation.reachesTargetSequenceBeforeObstacle || !finalValidation.formulaContext) {
    return createOneClickClearFailure("no-usable-target", startedAt, workUnits);
  }
  const finalRoute = {
    ...finalized.route,
    formulaContext: finalValidation.formulaContext,
    ...(finalValidation.pathError === undefined ? {} : { pathError: finalValidation.pathError }),
    trajectoryPoints: snapshotGraphwarVisibleTrajectoryPoints(
      finalValidation.visiblePixels,
      finalValidation.obstacleHitIndex,
      options.debugMetrics,
    ),
  };
  publishOneClickClearValidatedRoute(context, finalRoute);

  const hitTargets = collectOneClickClearHitTargets(
    finalValidation.trackedTargets,
    finalValidation.trackedTargetHitIndexes,
  );
  // 顺路命中不应把“没有任何扫描目标可达”伪装成一次成功清图。
  if (finalized.route.targetSequence.length === 0) {
    return createOneClickClearFailure("no-usable-target", startedAt, workUnits);
  }
  publishOneClickClearStepGlitchEvidence(
    options,
    finalRoute,
    finalValidation,
    // 最终验证可能新增局部保护；恢复证据必须绑定它实际验证的精确公式前缀。
    finalValidation.formulaContext.stepGlitchFormulaPrefix,
  );
  return createOneClickClearSuccessResult(options, finalRoute, hitTargets, startedAt, workUnits);
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

  // 即使关闭删点也保留最终整路复验；它负责裁决后缀对本轮先前目标和碰撞的影响。
  const optimized =
    options.isDeleteOptimizationEnabled !== false
      ? await measureOneClickClearDebugTimingAsync(options, "optimize-path", () =>
          optimizeOneClickClearPath(context, validatedRoute, nextWorkUnits),
        )
      : { route: validatedRoute, workUnits: nextWorkUnits };
  const finalValidation =
    optimized.finalValidation ??
    measureOneClickClearDebugTiming(options, "validate-final", () =>
      sampleOneClickClearTargetSequence(options, optimized.route, true),
    );
  if (
    oneClickClearStepRouteIsValid(options, optimized.route.pathPoints) &&
    finalValidation.reachesTargetSequenceBeforeObstacle &&
    finalValidation.formulaContext
  ) {
    return {
      hitTargets: collectOneClickClearHitTargets(
        finalValidation.trackedTargets,
        finalValidation.trackedTargetHitIndexes,
      ),
      route: {
        ...optimized.route,
        formulaContext: finalValidation.formulaContext,
        ...(finalValidation.pathError === undefined ? {} : { pathError: finalValidation.pathError }),
        trajectoryPoints: snapshotGraphwarVisibleTrajectoryPoints(
          finalValidation.visiblePixels,
          finalValidation.obstacleHitIndex,
          options.debugMetrics,
        ),
      },
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
    radius: FALLBACK_TARGET_RADIUS_IMAGE_PIXELS,
  };
  const result = sampleGraphwarPathTargetSequence({
    boundaryExpansion: options.simulationBoundaryExpansion,
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    obstacleMask: options.simulationMask,
    points: options.pathPoints,
    settings: options.settings,
    targetControlPoints: options.pathPoints.slice(-1),
    targetHitRadiusPixels: target.radius,
    targetCircles: [target],
    targetPoints: [target.center],
  });
  return result.reachesTargetSequenceBeforeObstacle;
}

/** 收集圆心或安全边缘候选，统一分配后按最终 x 建立普通 DAG 层或邪道扫描层。 */
function collectOneClickClearTargets(options: GraphwarOneClickClearOptions): OneClickClearTarget[] {
  const pathTail = options.pathPoints.at(-1);
  if (!pathTail) {
    return [];
  }

  const horizontalBoundaryInsetPixels =
    (Math.max(0, Math.floor(options.simulationBoundaryExpansion)) / GRAPHWAR_PLANE_LENGTH) * options.boundsRect.width;
  const verticalBoundaryInsetPixels =
    (Math.max(0, Math.floor(options.simulationBoundaryExpansion)) / GRAPHWAR_PLANE_HEIGHT) * options.boundsRect.height;
  const assignedTargets = assignGraphwarOneClickClearTargetRoutePoints({
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    candidates: options.candidates.map((candidate, sourceIndex) => ({
      center: candidate.hitCenter,
      hitCircle: candidate,
      hitRadius: candidate.hitRadius,
      sourceIndex,
    })),
    pathTail,
    // 单个半开矩形直接表达地图边界；目标分配只离散化 x，y 仍保留真实士兵中心。
    usableRect: {
      height: options.boundsRect.height - verticalBoundaryInsetPixels * 2,
      width: options.boundsRect.width - horizontalBoundaryInsetPixels * 2,
      x: options.boundsRect.x + horizontalBoundaryInsetPixels,
      y: options.boundsRect.y + verticalBoundaryInsetPixels,
    },
  });
  return assignedTargets.map((assigned) => ({
    ...assigned.hitCircle,
    hitCircle: {
      center: assigned.hitCircle.hitCenter,
      radius: assigned.hitCircle.hitRadius,
    },
    routePoint: assigned.routePoint,
    sortGraphX: imageToGraphPoint(assigned.routePoint, options.bounds, options.boundsRect).x,
  }));
}

/** 建立 START 和士兵建路点之间的几何 DAG；Step 必须把累计舍入高度纳入节点标签。 */
async function buildOneClickClearDag(
  context: OneClickClearSearchContext,
  targets: readonly OneClickClearTarget[],
): Promise<OneClickClearDag> {
  return context.options.settings.algorithm === "step"
    ? buildOneClickClearStepDag(context, targets)
    : buildOneClickClearAbsDag(context, targets);
}

/** ABS 的后继只由目标坐标决定，继续使用一目标一节点的静态 DAG。 */
async function buildOneClickClearAbsDag(
  context: OneClickClearSearchContext,
  targets: readonly OneClickClearTarget[],
): Promise<OneClickClearDag> {
  const options = context.options;
  const startPoint = options.pathPoints.at(-1) ?? options.pathPoints[0];
  const edges: OneClickClearDagEdge[] = [];
  const nodes = targets.map<OneClickClearDagNode>((_, targetIndex) => ({ id: targetIndex, targetIndex }));
  const nodesByTargetIndex = nodes.map((node) => [node]);
  const outgoingEdges = new Map<number, OneClickClearDagEdge[]>();
  const jobs = collectOneClickClearAbsDagEdgeBuildJobs(startPoint, targets, nodes);
  const result = await buildOneClickClearDagEdgeRoutes(context, jobs);
  emitOneClickClearDebugTimings(options, result.timings);

  const routesByJobId = new Map(result.routes.map((route) => [route.jobId, route.route]));
  for (const job of jobs) {
    const route = routesByJobId.get(job.id);
    const targetNode = nodes[job.to];
    if (route && targetNode) {
      addOneClickClearDagEdge(options, edges, outgoingEdges, job.from, targetNode.id, route);
    }
  }

  return {
    edges,
    nodes,
    nodesByTargetIndex,
    outgoingEdges,
    targets: [...targets],
  };
}

/** 枚举 ABS 的静态候选边；ABS node id 按目标顺序创建，保持原有稳定顺序。 */
function collectOneClickClearAbsDagEdgeBuildJobs(
  startPoint: PixelPoint,
  targets: readonly OneClickClearTarget[],
  nodes: readonly OneClickClearDagNode[],
) {
  const jobs: GraphwarOneClickClearDagEdgeBuildJob[] = [];
  for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
    const target = targets[targetIndex];
    if (!target) {
      continue;
    }
    // START 可以尝试直达每个 x+ 侧目标，后续由几何寻路和公式验证过滤不可用边。
    jobs.push({
      from: START_NODE_INDEX,
      id: jobs.length,
      startPoint,
      targetPoint: target.routePoint,
      to: targetIndex,
    });
  }

  for (let fromIndex = 0; fromIndex < targets.length; fromIndex += 1) {
    const from = targets[fromIndex];
    const fromNode = nodes[fromIndex];
    if (!from || !fromNode) {
      continue;
    }
    for (let toIndex = fromIndex + 1; toIndex < targets.length; toIndex += 1) {
      const to = targets[toIndex];
      // 目标已按 sortGraphX 排序；同 x 不能构成 Graphwar x+ 边。
      if (!to || !graphXAdvancesStrictly(from.sortGraphX, to.sortGraphX)) {
        continue;
      }

      jobs.push({
        from: fromNode.id,
        id: jobs.length,
        startPoint: from.routePoint,
        targetPoint: to.routePoint,
        to: toIndex,
      });
    }
  }
  return jobs;
}

/**
 * Step 的同一目标可能因前缀舍入得到多个实际高度；按目标 x 层发现状态，避免错误合并后继。
 *
 * 每层只向严格更右侧目标批量发 job。新状态会落在后续层，因此一次正向遍历即可建完整 DAG。
 */
async function buildOneClickClearStepDag(
  context: OneClickClearSearchContext,
  targets: readonly OneClickClearTarget[],
): Promise<OneClickClearDag> {
  const options = context.options;
  const edges: OneClickClearDagEdge[] = [];
  const nodes: OneClickClearDagNode[] = [];
  const nodesByTargetIndex = Array.from({ length: targets.length }, (): OneClickClearDagNode[] => []);
  const nodesByTargetState = Array.from({ length: targets.length }, (): Map<string, OneClickClearDagNode> => new Map());
  const outgoingEdges = new Map<number, OneClickClearDagEdge[]>();
  const startPoint = options.pathPoints.at(-1) ?? options.pathPoints[0];
  const startState = resolveOneClickClearStepStartState(options);
  if (!startState) {
    return { edges, nodes, nodesByTargetIndex, outgoingEdges, targets: [...targets] };
  }

  let nextJobId = 0;
  const addBuiltRoutes = async (jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[]) => {
    if (jobs.length === 0) {
      return;
    }
    const result = await buildOneClickClearDagEdgeRoutes(context, jobs);
    emitOneClickClearDebugTimings(options, result.timings);
    const routesByJobId = new Map(result.routes.map((route) => [route.jobId, route]));
    for (const job of jobs) {
      const builtRoute = routesByJobId.get(job.id);
      const resolvedEndY = builtRoute?.resolvedEndY;
      const resolvedEndStateKey = builtRoute?.resolvedEndStateKey;
      if (
        !builtRoute?.route ||
        resolvedEndY === undefined ||
        !Number.isFinite(resolvedEndY) ||
        resolvedEndStateKey === undefined
      ) {
        continue;
      }

      // 状态身份来自打印系数整数累计；浮点 resolvedY 只用于下一段数值计算和调试。
      const stateNodes = nodesByTargetState[job.to];
      const targetNodes = nodesByTargetIndex[job.to];
      if (!stateNodes || !targetNodes) {
        continue;
      }
      let targetNode = stateNodes.get(resolvedEndStateKey);
      if (!targetNode) {
        targetNode = {
          id: nodes.length,
          resolvedStateKey: resolvedEndStateKey,
          resolvedY: resolvedEndY,
          targetIndex: job.to,
        };
        nodes.push(targetNode);
        targetNodes.push(targetNode);
        stateNodes.set(resolvedEndStateKey, targetNode);
      }
      addOneClickClearDagEdge(options, edges, outgoingEdges, job.from, targetNode.id, builtRoute.route);
    }
  };

  const startJobs: GraphwarOneClickClearDagEdgeBuildJob[] = [];
  for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
    const target = targets[targetIndex];
    if (!target) {
      continue;
    }
    startJobs.push({
      from: START_NODE_INDEX,
      id: nextJobId,
      resolvedStartStateKey: startState.resolvedStateKey,
      resolvedStartY: startState.resolvedY,
      startPoint,
      targetPoint: target.routePoint,
      to: targetIndex,
    });
    nextJobId += 1;
  }
  await addBuiltRoutes(startJobs);

  let layerStart = 0;
  while (layerStart < targets.length) {
    const layerGraphX = targets[layerStart]?.sortGraphX;
    let layerEnd = layerStart + 1;
    while (layerEnd < targets.length && targets[layerEnd]?.sortGraphX === layerGraphX) {
      layerEnd += 1;
    }

    const jobs: GraphwarOneClickClearDagEdgeBuildJob[] = [];
    for (let sourceTargetIndex = layerStart; sourceTargetIndex < layerEnd; sourceTargetIndex += 1) {
      const sourceTarget = targets[sourceTargetIndex];
      if (!sourceTarget) {
        continue;
      }
      for (const sourceNode of nodesByTargetIndex[sourceTargetIndex] ?? []) {
        const resolvedStartY = sourceNode.resolvedY;
        const resolvedStartStateKey = sourceNode.resolvedStateKey;
        if (resolvedStartY === undefined || !Number.isFinite(resolvedStartY) || resolvedStartStateKey === undefined) {
          continue;
        }
        for (let targetIndex = layerEnd; targetIndex < targets.length; targetIndex += 1) {
          const target = targets[targetIndex];
          if (!target || !graphXAdvancesStrictly(sourceTarget.sortGraphX, target.sortGraphX)) {
            continue;
          }
          jobs.push({
            from: sourceNode.id,
            id: nextJobId,
            resolvedStartStateKey,
            resolvedStartY,
            startPoint: sourceTarget.routePoint,
            targetPoint: target.routePoint,
            to: targetIndex,
          });
          nextJobId += 1;
        }
      }
    }
    await addBuiltRoutes(jobs);
    layerStart = layerEnd;
  }

  return { edges, nodes, nodesByTargetIndex, outgoingEdges, targets: [...targets] };
}

/** 从第一条用户路径点开始逐段结算，得到 START 续接新边时的 canonical Step 状态。 */
function resolveOneClickClearStepStartState(options: GraphwarOneClickClearOptions) {
  const graphPoints = options.pathPoints.map((point) => imageToGraphPoint(point, options.bounds, options.boundsRect));
  const firstPoint = graphPoints[0];
  if (!firstPoint) {
    return undefined;
  }
  const resolved = resolveStepFormula(
    graphPoints,
    options.settings.formulaPathSteepness ?? options.settings.steepness,
    options.settings.equation,
    { formulaDecimalPlaces: options.settings.decimalPlaces },
  );
  if (!(resolved.formulaSteepness > 0) || !Number.isFinite(resolved.formulaSteepness)) {
    return undefined;
  }

  for (const transition of resolved.transitions) {
    if (!transition.isValid || !Number.isFinite(transition.resolvedEndY)) {
      return undefined;
    }
  }
  const resolvedStateKey = resolved.plateauState.coefficientUnits?.toString();
  return Number.isFinite(resolved.plateauState.resolvedY) && resolvedStateKey !== undefined
    ? { resolvedStateKey, resolvedY: resolved.plateauState.resolvedY }
    : undefined;
}

/** 批量建立 DAG 边，并允许外部 runner 并行执行几何寻路。 */
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

/** 从搜索设置和建边作业生成最小 Worker 请求。 */
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
    routeOriginPoint: options.pathPoints[0],
    routeMode: options.routeMode,
    routeTolerancePlanePixels: options.routeMask.routeTolerancePlanePixels,
    settings: options.settings,
    workerCount: options.dagEdgeWorkerCount ?? 1,
  };
}

/** 向 DAG 和源节点邻接表同时登记一条已验证边。 */
function addOneClickClearDagEdge(
  options: Pick<GraphwarOneClickClearOptions, "bounds" | "boundsRect">,
  edges: OneClickClearDagEdge[],
  outgoingEdges: Map<number, OneClickClearDagEdge[]>,
  from: number,
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
    verticalVariation: calculateOneClickClearRouteVerticalVariation(options, route),
  };
  edges.push(edge);

  const existing = outgoingEdges.get(from);
  if (existing) {
    existing.push(edge);
  } else {
    outgoingEdges.set(from, [edge]);
  }
}

/** 边成本只统计相邻控制点的 Graphwar 纵向变化；各边首尾相接，因此可以直接在 DP 中累加。 */
function calculateOneClickClearRouteVerticalVariation(
  options: Pick<GraphwarOneClickClearOptions, "bounds" | "boundsRect">,
  route: readonly PixelPoint[],
) {
  const graphYPerImagePixel = Math.abs((options.bounds.maxY - options.bounds.minY) / options.boundsRect.height);
  let variation = 0;
  for (let index = 1; index < route.length; index += 1) {
    variation += Math.abs(route[index].y - route[index - 1].y) * graphYPerImagePixel;
  }
  return variation;
}

/** 在具体状态节点 DAG 上做最长路 DP；同分时依次选点更少、纵向变化更小的稳定路线。 */
function findOneClickClearLongestPath(dag: OneClickClearDag) {
  const bestEntries: (OneClickClearBestEntry | undefined)[] = Array.from({ length: dag.nodes.length });

  for (const edge of dag.outgoingEdges.get(START_NODE_INDEX) ?? []) {
    if (!edge.active) {
      continue;
    }
    updateOneClickClearBestEntry(bestEntries, edge.to, {
      killCount: 1,
      previousEdge: edge,
      routePointCount: edge.addedPointCount,
      verticalVariation: edge.verticalVariation,
    });
  }

  // node id 是按状态发现顺序生成的，不保证拓扑有序；目标 x 顺序才是稳定的 DAG 层序。
  for (let targetIndex = 0; targetIndex < dag.targets.length; targetIndex += 1) {
    for (const node of dag.nodesByTargetIndex[targetIndex] ?? []) {
      const entry = bestEntries[node.id];
      if (!entry) {
        continue;
      }

      for (const edge of dag.outgoingEdges.get(node.id) ?? []) {
        if (!edge.active) {
          continue;
        }
        updateOneClickClearBestEntry(bestEntries, edge.to, {
          killCount: entry.killCount + 1,
          previousEdge: edge,
          routePointCount: entry.routePointCount + edge.addedPointCount,
          verticalVariation: entry.verticalVariation + edge.verticalVariation,
        });
      }
    }
  }

  let bestNodeId: number | undefined;
  for (const node of dag.nodes) {
    const entry = bestEntries[node.id];
    if (!entry) {
      continue;
    }
    const bestEntry = bestNodeId === undefined ? undefined : bestEntries[bestNodeId];
    const bestNode = bestNodeId === undefined ? undefined : dag.nodes[bestNodeId];
    if (!bestEntry || !bestNode || compareOneClickClearBestEntry(entry, node, bestEntry, bestNode) < 0) {
      bestNodeId = node.id;
    }
  }

  if (bestNodeId === undefined) {
    return [];
  }
  return reconstructOneClickClearDagPath(bestEntries, bestNodeId);
}

/** 只在候选排序更优时更新节点的最佳路径条目。 */
function updateOneClickClearBestEntry(
  bestEntries: (OneClickClearBestEntry | undefined)[],
  nodeId: number,
  candidate: OneClickClearBestEntry,
) {
  const previous = bestEntries[nodeId];
  // 完全同分时保留按稳定 job 顺序先到的前缀，避免并行建边结果顺序影响输出。
  if (!previous || compareOneClickClearBestEntryForSameNode(candidate, previous) < 0) {
    bestEntries[nodeId] = candidate;
  }
}

/** 比较落在同一 DAG 节点上的击杀数、点数和纵向变化。 */
function compareOneClickClearBestEntryForSameNode(left: OneClickClearBestEntry, right: OneClickClearBestEntry) {
  return (
    right.killCount - left.killCount ||
    left.routePointCount - right.routePointCount ||
    left.verticalVariation - right.verticalVariation
  );
}

/** 在同节点质量相同时用目标和节点顺序稳定打破平局。 */
function compareOneClickClearBestEntry(
  left: OneClickClearBestEntry,
  leftNode: OneClickClearDagNode,
  right: OneClickClearBestEntry,
  rightNode: OneClickClearDagNode,
) {
  return (
    right.killCount - left.killCount ||
    left.routePointCount - right.routePointCount ||
    left.verticalVariation - right.verticalVariation ||
    leftNode.targetIndex - rightNode.targetIndex ||
    leftNode.id - rightNode.id
  );
}

/** 沿前驱条目迭代回溯 DAG 路径，避免递归占用调用栈。 */
function reconstructOneClickClearDagPath(bestEntries: readonly (OneClickClearBestEntry | undefined)[], nodeId: number) {
  const edges: OneClickClearDagEdge[] = [];
  let currentNodeId = nodeId;
  while (true) {
    const entry: OneClickClearBestEntry | undefined = bestEntries[currentNodeId];
    if (!entry) {
      break;
    }
    const edge: OneClickClearDagEdge = entry.previousEdge;
    edges.push(edge);
    if (edge.from === START_NODE_INDEX) {
      break;
    }
    currentNodeId = edge.from;
  }
  return edges.reverse();
}

/** 按选中的 DAG 路线逐边追加并验证；失败时返回刚失败的边。 */
function validateOneClickClearDagRoute(
  context: OneClickClearSearchContext,
  dag: OneClickClearDag,
  edges: readonly OneClickClearDagEdge[],
): OneClickClearRouteValidationResult {
  const cachedPrefix = context.routeValidationPrefix ?? [];
  let sharedPrefixLength = 0;
  while (
    sharedPrefixLength < edges.length &&
    cachedPrefix[sharedPrefixLength]?.edgeId === edges[sharedPrefixLength]?.id
  ) {
    sharedPrefixLength += 1;
  }

  const reused = sharedPrefixLength > 0 ? cachedPrefix[sharedPrefixLength - 1] : undefined;
  let pathPoints = reused ? [...reused.pathPoints] : [...context.options.pathPoints];
  let formulaContext: GraphwarTrajectoryFormulaContext | undefined;
  let pathError: number | undefined;
  let trajectoryPoints = reused?.segmentState.trajectoryPoints;
  let segmentState: OneClickClearRouteSegmentValidationState = reused ? { ...reused.segmentState } : {};
  const targetSequence: OneClickClearTarget[] = reused ? [...reused.targetSequence] : [];
  const validatedPrefix = cachedPrefix.slice(0, sharedPrefixLength);
  let validationCount = 0;

  for (let edgeIndex = sharedPrefixLength; edgeIndex < edges.length; edgeIndex += 1) {
    const edge = edges[edgeIndex];
    if (!edge) {
      context.routeValidationPrefix = validatedPrefix;
      return { validationCount };
    }
    const targetNode = dag.nodes[edge.to];
    const target = targetNode ? dag.targets[targetNode.targetIndex] : undefined;
    if (!targetNode || !target) {
      context.routeValidationPrefix = validatedPrefix;
      return { failedEdge: edge, validationCount };
    }

    // 边 route 首点已经是当前路径尾点，追加时必须跳过。
    const nextPath = [...pathPoints, ...edge.route.slice(1)];
    validationCount += 1;
    const validation = validateOneClickClearRouteSegment(context, nextPath, [...targetSequence, target], segmentState);
    if (!validation) {
      context.routeValidationPrefix = validatedPrefix;
      return { failedEdge: edge, validationCount };
    }

    pathPoints = nextPath;
    formulaContext = validation.formulaContext;
    pathError = validation.sampleResult.pathError;
    trajectoryPoints = validation.trajectoryPoints;
    segmentState = {
      ...(validation.sampleResult.sample.endState ? { initialState: validation.sampleResult.sample.endState } : {}),
      ...(pathError === undefined ? {} : { pathError }),
      signProtection: validation.formulaContext.signProtection,
      trajectoryPoints,
    };
    targetSequence.push(target);
    validatedPrefix.push({
      edgeId: edge.id,
      pathPoints,
      segmentState,
      targetSequence: [...targetSequence],
    });
    // 独立前缀已被本次 segment 回放证明，后续边失败不会使它失效。
    publishOneClickClearValidatedRoute(context, {
      formulaContext,
      ...(pathError === undefined ? {} : { pathError }),
      pathPoints,
      targetSequence,
      trajectoryPoints,
    });
  }

  context.routeValidationPrefix = validatedPrefix;

  return {
    route: {
      ...(formulaContext ? { formulaContext } : {}),
      ...(pathError === undefined ? {} : { pathError }),
      pathPoints,
      targetSequence,
      ...(trajectoryPoints ? { trajectoryPoints } : {}),
    },
    validationCount,
  };
}

/** 只续采样新增段；若保护扩大而退回发射点，完整历史目标会自动重新验证。 */
function validateOneClickClearRouteSegment(
  context: OneClickClearSearchContext,
  nextPath: readonly PixelPoint[],
  targetSequence: readonly OneClickClearTarget[],
  state: OneClickClearRouteSegmentValidationState,
): OneClickClearRouteSegmentValidationResult | undefined {
  const options = context.options;
  const followsGraphRule = measureOneClickClearDebugTiming(options, "segment-graph-rule", () =>
    oneClickClearPathFollowsGraphRule(options, nextPath),
  );
  if (!followsGraphRule) {
    return undefined;
  }

  const mappedPoints = measureOneClickClearMetric(options.debugMetrics, "formulaPointMappingElapsedMs", () =>
    nextPath.map((point) => imageToGraphPoint(point, options.bounds, options.boundsRect)),
  );
  if (mappedPoints.length < 2) {
    return undefined;
  }

  const currentTarget = targetSequence.at(-1);
  if (!currentTarget) {
    return undefined;
  }
  const reusableInitialState =
    options.settings.algorithm === "abs" &&
    options.settings.equation !== "ddy" &&
    state.initialState &&
    graphXAdvancesStrictly(
      state.initialState.currentPoint.x,
      imageToGraphPoint(currentTarget.routePoint, options.bounds, options.boundsRect).x,
    )
      ? state.initialState
      : undefined;
  const validationTargets = createOneClickClearValidationTargets(options, targetSequence, true);
  const targetControlPoints = createOneClickClearTargetControlPoints(options, targetSequence);
  const qualityPoints = mappedPoints.filter((_point, index) => {
    const sourcePoint = nextPath[index];
    return (
      index > 0 &&
      sourcePoint !== undefined &&
      !targetControlPoints.some((targetPoint) => pixelPointsEqual(targetPoint, sourcePoint))
    );
  });
  const resolved = measureOneClickClearDebugTiming(options, "segment-sample-trajectory", () =>
    tryResolveGraphwarTrajectoryCandidate({
      bounds: options.bounds,
      boundsRect: options.boundsRect,
      collision: {
        boundaryExpansion: options.simulationBoundaryExpansion,
        mask: options.simulationMask,
      },
      collectVisiblePixels: true,
      debugMetrics: options.debugMetrics,
      // Step 后续项会反向改变旧段；ABS y'' 的平滑脉冲也有折点前尾值，两者都必须从发射点完整回放。
      initialState: reusableInitialState,
      initialReachedRequiredTargetCount: reusableInitialState ? validationTargets.requiredTargets.length : 0,
      points: mappedPoints,
      qualityPoints: reusableInitialState
        ? qualityPoints.filter((point) => graphXAdvancesStrictly(reusableInitialState.currentPoint.x, point.x))
        : qualityPoints,
      requiredTargets: validationTargets.requiredTargets,
      settings: options.settings,
      signProtection: reusableInitialState ? state.signProtection : undefined,
      skipInitialStop: reusableInitialState !== undefined,
      soldierCenter: mappedPoints[0],
      targetSequence: validationTargets.orderedTargets,
    }),
  );
  if (!resolved) {
    return undefined;
  }
  const { context: formulaContext, result } = resolved;
  if (
    result.reachedTargetCount < validationTargets.orderedTargets.length ||
    result.reachedRequiredTargetCount < validationTargets.requiredTargets.length
  ) {
    return undefined;
  }

  const firstSamplePoint = result.sample.points[0];
  const isResumedFromRequestedState = Boolean(
    reusableInitialState &&
    firstSamplePoint &&
    firstSamplePoint.x === reusableInitialState.currentPoint.x &&
    firstSamplePoint.y === reusableInitialState.currentPoint.y,
  );
  let pathError = isResumedFromRequestedState
    ? result.pathError
    : measureGraphwarFormulaPathError(result.sample.points, qualityPoints, options.bounds);
  if (isResumedFromRequestedState && state.pathError !== undefined) {
    pathError = pathError === undefined ? state.pathError : Math.max(state.pathError, pathError);
  }
  const sampleResult = pathError === undefined ? result : { ...result, pathError };
  const sampledTrajectoryPoints = snapshotGraphwarVisibleTrajectoryPoints(
    result.visiblePixels,
    result.obstacleHitIndex,
    options.debugMetrics,
  );
  const trajectoryPoints =
    isResumedFromRequestedState && state.trajectoryPoints
      ? [
          ...state.trajectoryPoints,
          ...sampledTrajectoryPoints.slice(
            state.trajectoryPoints.length > 0 &&
              sampledTrajectoryPoints.length > 0 &&
              pixelPointsEqual(state.trajectoryPoints[state.trajectoryPoints.length - 1], sampledTrajectoryPoints[0])
              ? 1
              : 0,
          ),
        ]
      : sampledTrajectoryPoints;

  if (options.settings.algorithm !== "step") {
    return { formulaContext, sampleResult, trajectoryPoints };
  }
  return {
    formulaContext,
    sampleResult: {
      ...sampleResult,
      reachedTargetCount: sampleResult.reachedTargetCount - validationTargets.prefixTargetCount,
    },
    trajectoryPoints,
  };
}

/** Step 的严格包络是硬边条件；删点和最终安全网都必须重新检查整条候选路径。 */
function oneClickClearStepRouteIsValid(options: GraphwarOneClickClearOptions, pathPoints: readonly PixelPoint[]) {
  return (
    options.settings.algorithm !== "step" ||
    formulaModeUsesStepGlitch(options.settings.algorithm, options.settings.equation, options.settings.stepGlitchMode) ||
    options.validateStepRoute?.(pathPoints) === true
  );
}

/** 返回整条弹道复验结果；routePoint 提供目标采样点，hitCircle 提供真实命中半径。 */
function sampleOneClickClearTargetSequence(
  options: GraphwarOneClickClearOptions,
  route: Pick<OneClickClearValidatedRoute, "pathPoints" | "targetSequence">,
  trackActualHits = false,
) {
  const validationTargets = createOneClickClearValidationTargets(options, route.targetSequence, true);
  const lastPathPoint = route.pathPoints.at(-1);
  const targetControlGraphX =
    formulaModeUsesStepGlitch(options.settings.algorithm, options.settings.equation, options.settings.stepGlitchMode) &&
    lastPathPoint
      ? imageToGraphPoint(lastPathPoint, options.bounds, options.boundsRect).x
      : undefined;
  const trackedTargets = trackActualHits ? createOneClickClearTrackedTargets(options, route) : [];
  const result = sampleGraphwarPathTargetSequence({
    boundaryExpansion: options.simulationBoundaryExpansion,
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    collectVisiblePixels: true,
    debugMetrics: options.debugMetrics,
    ...(targetControlGraphX === undefined || trackActualHits
      ? {}
      : { continueAfterTargetsUntilGraphX: targetControlGraphX }),
    obstacleMask: options.simulationMask,
    points: route.pathPoints,
    requiredTargets: validationTargets.requiredTargets,
    settings: options.settings,
    targetControlPoints: createOneClickClearTargetControlPoints(options, route.targetSequence),
    ...(trackActualHits
      ? {
          stopOnTargetsComplete: false,
          trackedTargets: trackedTargets.map((target) => target.hitCircle),
        }
      : {}),
    targetHitRadiusPixels: FALLBACK_TARGET_RADIUS_IMAGE_PIXELS,
    targetCircles: validationTargets.orderedTargets,
    targetPoints: validationTargets.orderedTargets.map((target) => target.center),
  });

  const reachesTargetControl =
    targetControlGraphX === undefined ||
    (trackActualHits
      ? graphwarTrajectoryReachesGraphXAfterTargetsBeforeObstacle(result, targetControlGraphX)
      : graphwarTrajectoryReachesGraphXBeforeObstacle(result, targetControlGraphX));
  const reachedRouteTargetCount = trackActualHits
    ? countOneClickClearReachedRouteTargets(route.targetSequence, trackedTargets, result.trackedTargetHitIndexes)
    : Math.max(0, result.reachedTargetCount - validationTargets.prefixTargetCount);
  return {
    ...result,
    reachedTargetCount: reachedRouteTargetCount,
    reachesTargetSequenceBeforeObstacle: result.reachesTargetSequenceBeforeObstacle && reachesTargetControl,
    trackedTargets,
  };
}

/** 把本次 route 的旧目标降为无序要求，当前新增目标继续使用有序命中语义。 */
function createOneClickClearValidationTargets(
  options: GraphwarOneClickClearOptions,
  targetSequence: readonly OneClickClearTarget[],
  includePreviousTargets: boolean,
) {
  const currentTarget = targetSequence.at(-1);
  const requiredTargets = includePreviousTargets ? createOneClickClearPreviousTargets(targetSequence.slice(0, -1)) : [];
  const orderedTargets: GraphwarTrajectoryTargetCircle[] = [];
  let prefixTargetCount = 0;
  // 普通 Step 仍需先命中旧尾点；邪道允许新最终整式修复无效旧前缀。
  if (
    options.settings.algorithm === "step" &&
    !formulaModeUsesStepGlitch(
      options.settings.algorithm,
      options.settings.equation,
      options.settings.stepGlitchMode,
    ) &&
    options.pathPoints.length >= 2
  ) {
    const prefixTarget = options.prefixTarget ?? {
      center: options.pathPoints.at(-1) ?? options.pathPoints[0],
      radius: FALLBACK_TARGET_RADIUS_IMAGE_PIXELS,
    };
    if (!requiredTargets.some((target) => pixelCirclesEqual(target, prefixTarget))) {
      appendOneClickClearTargetCircle(orderedTargets, prefixTarget);
      prefixTargetCount = orderedTargets.length;
    }
  }
  if (currentTarget) {
    appendOneClickClearTargetCircle(orderedTargets, currentTarget.hitCircle);
  }
  return { orderedTargets, prefixTargetCount, requiredTargets };
}

/** 收集已有尾点和本轮士兵目标对应的真实命中圆控制点，统一排除出路径质量统计。 */
function createOneClickClearTargetControlPoints(
  options: GraphwarOneClickClearOptions,
  targetSequence: readonly OneClickClearTarget[],
) {
  const targetControlPoints = targetSequence.map((target) => target.routePoint);
  const existingPathTarget =
    options.prefixTarget !== undefined ||
    (options.settings.algorithm === "step" &&
      !formulaModeUsesStepGlitch(
        options.settings.algorithm,
        options.settings.equation,
        options.settings.stepGlitchMode,
      ) &&
      options.pathPoints.length >= 2)
      ? options.pathPoints.at(-1)
      : undefined;
  if (existingPathTarget && !targetControlPoints.some((point) => pixelPointsEqual(point, existingPathTarget))) {
    targetControlPoints.unshift(existingPathTarget);
  }
  return targetControlPoints;
}

/** 同一次清图的旧目标保持必达；上一轮士兵不会进入本请求。 */
function createOneClickClearPreviousTargets(targetSequence: readonly OneClickClearTarget[]) {
  const targets: GraphwarTrajectoryTargetCircle[] = [];
  for (const target of targetSequence) {
    appendOneClickClearTargetCircle(targets, target.hitCircle);
  }
  return targets;
}

/** 最终统计模拟已经证明 exact path；只在整次清图成功时把它交给 Master 发布。 */
function publishOneClickClearStepGlitchEvidence(
  options: GraphwarOneClickClearOptions,
  route: OneClickClearValidatedRoute,
  validation: ReturnType<typeof sampleOneClickClearTargetSequence>,
  stepGlitchFormulaPrefix: GraphwarStepGlitchFormulaPrefix | undefined,
) {
  const lastPathPoint = route.pathPoints.at(-1);
  if (!options.onValidatedStepGlitchPath || !lastPathPoint) {
    return;
  }
  const controlX = imageToGraphPoint(lastPathPoint, options.bounds, options.boundsRect).x;
  const acceptedPoint = findGraphwarStepGlitchAcceptedPointAtOrAfterControlX(
    validation.sample.points,
    validation.obstacleHitIndex,
    controlX,
    // 本轮先前目标或顺路命中可能在更右侧；下一次扫描仍从末尾显式目标恢复。
    Math.max(0, validation.targetHitIndex),
  );
  if (!acceptedPoint) {
    return;
  }
  publishOneClickClearStepGlitchHitEvidence(options, route, acceptedPoint, stepGlitchFormulaPrefix);
}

/** 发布自然 hit 的精确恢复证据；exact path key 让未被页面采用的证据自然失配。 */
function publishOneClickClearStepGlitchHitEvidence(
  options: GraphwarOneClickClearOptions,
  route: OneClickClearValidatedRoute,
  acceptedPoint: GraphPoint,
  stepGlitchFormulaPrefix: GraphwarStepGlitchFormulaPrefix | undefined,
) {
  const lastPathPoint = route.pathPoints.at(-1);
  if (!options.onValidatedStepGlitchPath || !lastPathPoint) {
    return;
  }
  const prefixTarget =
    route.targetSequence.find((target) => pixelPointsEqual(target.routePoint, lastPathPoint))?.hitCircle ??
    ({ center: lastPathPoint, radius: FALLBACK_TARGET_RADIUS_IMAGE_PIXELS } satisfies GraphwarTrajectoryTargetCircle);
  options.onValidatedStepGlitchPath({
    acceptedPoint,
    path: route.pathPoints,
    prefixTarget,
    ...(stepGlitchFormulaPrefix ? { stepGlitchFormulaPrefix } : {}),
    targetSequence: route.targetSequence.map((target) => target.hitCircle),
  });
}

/** 按目标 id 去重并追加实际命中圆。 */
function appendOneClickClearTargetCircle(
  targets: GraphwarTrajectoryTargetCircle[],
  target: GraphwarTrajectoryTargetCircle,
) {
  if (
    targets.some(
      (existing) =>
        existing.center.x === target.center.x &&
        existing.center.y === target.center.y &&
        existing.radius === target.radius,
    )
  ) {
    return;
  }
  targets.push(target);
}

/**
 * 提交主搜索自然产生的已验证前缀。
 *
 * 这里仅从现有控制点生成公式，不采样轨迹或统计顺路命中；动画因此不会增加搜索验证工作。
 */
function publishOneClickClearValidatedRoute(context: OneClickClearSearchContext, route: OneClickClearValidatedRoute) {
  const targetCount = route.targetSequence.length;
  if (targetCount === 0 || targetCount < context.bestValidatedTargetCount) {
    return;
  }
  if (
    targetCount === context.bestValidatedTargetCount &&
    (route.pathPoints.length > context.bestValidatedPointCount ||
      (route.pathPoints.length === context.bestValidatedPointCount &&
        compareGraphwarPathErrors(route.pathError, context.bestValidatedPathError) >= 0))
  ) {
    return;
  }
  let incumbent: GraphwarOneClickClearIncumbent | undefined;
  if (context.options.onValidatedIncumbent) {
    incumbent = measureOneClickClearMetric(context.options.debugMetrics, "incumbentBuildElapsedMs", () =>
      createOneClickClearIncumbent(context.options, route),
    );
    if (!incumbent) {
      return;
    }
  }

  context.bestValidatedPathError = route.pathError;
  context.bestValidatedPointCount = route.pathPoints.length;
  context.bestValidatedTargetCount = targetCount;
  if (incumbent) {
    context.options.onValidatedIncumbent?.(incumbent);
  }
}

/** 从已验证路径生成不可变 shot plan；公式和角度共享同一份数值上下文。 */
function createOneClickClearIncumbent(
  options: GraphwarOneClickClearOptions,
  route: OneClickClearValidatedRoute,
): GraphwarOneClickClearIncumbent | undefined {
  if (!route.formulaContext || !route.trajectoryPoints || route.formulaContext.formulaPoints.length < 2) {
    return undefined;
  }

  const launchAngleRadians =
    options.settings.equation === "ddy" ? getGraphwarTrajectoryLaunchAngle(route.formulaContext) : Number.NaN;
  return {
    expression: route.formulaContext.formulaResult.expression,
    ...(Number.isFinite(launchAngleRadians) ? { launchAngleRadians } : {}),
    pathPoints: [...route.pathPoints],
    trajectoryPoints: [...route.trajectoryPoints],
  };
}

/** 将最终验证使用的同一公式上下文固化进成功结果，禁止页面只拿路径重新解算。 */
function createOneClickClearSuccessResult(
  options: GraphwarOneClickClearOptions,
  route: OneClickClearValidatedRoute,
  hitTargets: readonly OneClickClearHitTarget[],
  startedAt: number,
  expandedStates: number,
): GraphwarOneClickClearResult {
  const incumbent = measureOneClickClearMetric(options.debugMetrics, "incumbentBuildElapsedMs", () =>
    createOneClickClearIncumbent(options, route),
  );
  if (!incumbent) {
    return createOneClickClearFailure("no-usable-target", startedAt, expandedStates);
  }

  return {
    ...incumbent,
    elapsedMs: Math.max(0, nowMs() - startedAt),
    expandedStates,
    targetIds: hitTargets.flatMap((target) => (target.id ? [target.id] : [])),
    type: "success",
  };
}

/** 最终统计当前完整弹道实际命中的候选士兵，包含非 DAG 节点的顺路命中。 */
function collectOneClickClearHitTargets(
  trackedTargets: readonly OneClickClearTrackedTarget[],
  trackedTargetHitIndexes: readonly number[],
): OneClickClearHitTarget[] {
  return trackedTargets
    .flatMap<OneClickClearHitTarget>((target, targetIndex) => {
      const hitIndex = trackedTargetHitIndexes[targetIndex];
      return hitIndex === undefined || hitIndex < 0 ? [] : [{ ...target, hitSamplePointCount: hitIndex + 1 }];
    })
    .sort(compareOneClickClearHitTargets);
}

/** 最终回放按每个 route 目标是否实际命中定位首条失败边，不依赖实际命中先后。 */
function countOneClickClearReachedRouteTargets(
  routeTargets: readonly OneClickClearTarget[],
  trackedTargets: readonly OneClickClearTrackedTarget[],
  trackedTargetHitIndexes: readonly number[],
) {
  let reachedCount = 0;
  for (const routeTarget of routeTargets) {
    const trackedIndex = trackedTargets.findIndex((target) =>
      pixelCirclesEqual(target.hitCircle, routeTarget.hitCircle),
    );
    if (trackedIndex < 0 || (trackedTargetHitIndexes[trackedIndex] ?? -1) < 0) {
      break;
    }
    reachedCount += 1;
  }
  return reachedCount;
}

/** 最终统计合并当前识别候选与显式 route 目标，并为仍在路径中的目标保留锚点。 */
function createOneClickClearTrackedTargets(
  options: GraphwarOneClickClearOptions,
  route: Pick<OneClickClearValidatedRoute, "pathPoints" | "targetSequence">,
) {
  const tracked: OneClickClearTrackedTarget[] = [];
  for (const candidate of options.hitCandidates) {
    upsertOneClickClearTrackedTarget(tracked, {
      hitCircle: {
        center: candidate.hitCenter,
        radius: candidate.hitRadius,
      },
      id: candidate.id,
    });
  }
  for (const target of route.targetSequence) {
    upsertOneClickClearTrackedTarget(tracked, {
      ...(route.pathPoints.some((point) => pixelPointsEqual(point, target.routePoint))
        ? { anchor: target.routePoint }
        : {}),
      hitCircle: target.hitCircle,
      id: target.id,
    });
  }
  return tracked;
}

/** 按命中圆合并跟踪目标，并优先保留新锚点和 id。 */
function upsertOneClickClearTrackedTarget(targets: OneClickClearTrackedTarget[], target: OneClickClearTrackedTarget) {
  const index = targets.findIndex((existing) => pixelCirclesEqual(existing.hitCircle, target.hitCircle));
  if (index < 0) {
    targets.push(target);
    return;
  }
  const existing = targets[index];
  if (!existing) {
    return;
  }
  targets[index] = {
    ...(target.anchor ? { anchor: target.anchor } : existing.anchor ? { anchor: existing.anchor } : {}),
    hitCircle: target.hitCircle,
    ...(target.id ? { id: target.id } : existing.id ? { id: existing.id } : {}),
  };
}

/** 按命中时刻、位置和 id 稳定排序实际目标。 */
function compareOneClickClearHitTargets(left: OneClickClearHitTarget, right: OneClickClearHitTarget) {
  return (
    left.hitSamplePointCount - right.hitSamplePointCount ||
    left.hitCircle.center.x - right.hitCircle.center.x ||
    left.hitCircle.center.y - right.hitCircle.center.y ||
    (left.id ?? "").localeCompare(right.id ?? "")
  );
}

/** 全局删点保护原 prefix；邪道还要保留每条已提交边精确结束的目标锚点。 */
async function optimizeOneClickClearPath(
  context: OneClickClearSearchContext,
  route: OneClickClearValidatedRoute,
  workUnits: number,
): Promise<OneClickClearPathOptimizationResult> {
  let optimized = route;
  const firstGeneratedIndex = context.options.pathPoints.length;
  const protectedTargetPoints = formulaModeUsesStepGlitch(
    context.options.settings.algorithm,
    context.options.settings.equation,
    context.options.settings.stepGlitchMode,
  )
    ? new Set(route.targetSequence.map((target) => target.routePoint))
    : undefined;
  const localHitCheckCanSkipFullValidation =
    context.options.deleteHitCheckRadiusPixels > 0 &&
    context.options.settings.algorithm === "abs" &&
    context.options.settings.equation !== "ddy";
  // 只做一轮全局删点，防止反复扫描让大路径的优化时间失控。
  for (let index = firstGeneratedIndex; index < optimized.pathPoints.length;) {
    if (context.options.isCancelled?.()) {
      return { route: optimized, workUnits };
    }
    const point = optimized.pathPoints[index];
    if (point && protectedTargetPoints?.has(point)) {
      index += 1;
      continue;
    }

    workUnits += 1;
    if (
      localHitCheckCanSkipFullValidation &&
      !oneClickClearPointDeleteKeepsLocalSoldierHits(context.options, optimized.pathPoints, index)
    ) {
      index += 1;
      await yieldOneClickClearControl(context.options);
      continue;
    }

    const candidatePath = [...optimized.pathPoints.slice(0, index), ...optimized.pathPoints.slice(index + 1)];
    if (
      localHitCheckCanSkipFullValidation ||
      (oneClickClearStepRouteIsValid(context.options, candidatePath) &&
        sampleOneClickClearTargetSequence(context.options, {
          ...optimized,
          pathPoints: candidatePath,
        }).reachesTargetSequenceBeforeObstacle)
    ) {
      // 任何删点都会改变完整公式；旧段验证上下文不能继续用于 incumbent。
      optimized = { pathPoints: candidatePath, targetSequence: optimized.targetSequence };
      continue;
    }
    index += 1;

    await yieldOneClickClearControl(context.options);
  }
  if (localHitCheckCanSkipFullValidation && optimized !== route) {
    workUnits += 1;
    // 局部快检只证明不漏打士兵；这里一次补齐障碍验证和最终实际命中统计。
    const finalValidation = measureOneClickClearDebugTiming(context.options, "validate-final", () =>
      sampleOneClickClearTargetSequence(context.options, optimized, true),
    );
    if (
      !oneClickClearStepRouteIsValid(context.options, optimized.pathPoints) ||
      !finalValidation.reachesTargetSequenceBeforeObstacle
    ) {
      return { route, workUnits };
    }
    return { finalValidation, route: optimized, workUnits };
  }
  return { route: optimized, workUnits };
}

/** 判断整条像素路径是否满足 Graphwar 严格 x+ 规则。 */
function oneClickClearPathFollowsGraphRule(options: GraphwarOneClickClearOptions, points: readonly PixelPoint[]) {
  const firstPoint = points[0];
  if (!firstPoint) {
    return true;
  }
  let previous = imageToGraphPoint(firstPoint, options.bounds, options.boundsRect);
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (!point) {
      return false;
    }
    const next = imageToGraphPoint(point, options.bounds, options.boundsRect);
    if (!graphXAdvancesStrictly(previous.x, next.x)) {
      return false;
    }
    previous = next;
  }
  return true;
}

/** 快速验证删点前后相邻线段仍命中同一批局部士兵。 */
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

  // 0 跳过删点局部命中检查；调用方随后会对这个候选删点做整路验证。
  if (options.deleteHitCheckRadiusPixels <= 0) {
    return true;
  }

  // abs 删除一个控制点时，只会把 previous->deleted->next 替换成 previous->next；先证明局部士兵命中不丢。
  // 页面应先把 Graphwar 原始平面半径换成截图像素。
  const checkRadiusSquared = options.deleteHitCheckRadiusPixels * options.deleteHitCheckRadiusPixels;
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

/** 判断像素线段是否严格穿过给定圆内。 */
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

/** 在可用时让出执行权，保持取消和进度回调可响应。 */
async function yieldOneClickClearControl(options: GraphwarOneClickClearOptions) {
  const yielded = options.yieldControl?.();
  if (yielded) {
    await yielded;
  }
}

/** 统一构造包含耗时和展开状态数的一键清图失败结果。 */
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

/** 仅在启用调试回调时测量同步搜索阶段。 */
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

/** 仅在启用调试回调时测量异步搜索阶段。 */
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

/** 把邪道扫描子阶段转换成一键清图调试明细。 */
function appendOneClickClearStepGlitchScanTimings(
  options: GraphwarOneClickClearOptions,
  timings: readonly { elapsedMs: number; stage: GraphwarStepGlitchScanTimingStage }[],
) {
  for (const timing of timings) {
    emitOneClickClearDebugTiming(options, {
      elapsedMs: timing.elapsedMs,
      stage:
        timing.stage === "validate-direct"
          ? "validate-direct-trajectory"
          : timing.stage === "prepare-prefix"
            ? "prepare-pathfinding-prefix"
            : timing.stage === "scan-candidates"
              ? "scan-step-glitch"
              : timing.stage,
    });
  }
}

/** 按原顺序批量发送调试耗时。 */
function emitOneClickClearDebugTimings(
  options: GraphwarOneClickClearOptions,
  timings: readonly GraphwarOneClickClearDebugTiming[],
) {
  for (const timing of timings) {
    emitOneClickClearDebugTiming(options, timing);
  }
}

/** 发送单条调试耗时；未配置回调时为空操作。 */
function emitOneClickClearDebugTiming(options: GraphwarOneClickClearOptions, timing: GraphwarOneClickClearDebugTiming) {
  options.onDebugTiming?.(timing);
}

/** Measures a low-level diagnostic phase only when request metrics are enabled. */
function measureOneClickClearMetric<TResult>(
  metrics: GraphwarPathfindingDebugMetrics | undefined,
  timing: keyof GraphwarPathfindingDebugMetrics["timings"],
  task: () => TResult,
) {
  if (!metrics) {
    return task();
  }
  const startedAt = nowMs();
  try {
    return task();
  } finally {
    metrics.timings[timing] += nowMs() - startedAt;
  }
}
