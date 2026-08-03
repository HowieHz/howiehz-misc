/** 在当前 Graphwar 路径后追加一键清图路线；几何建路点和弹道命中圈分开建模。 */
import { GraphwarWasmFault, isGraphwarWasmFault } from "../../core/algorithm-backend";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { imageToGraphPoint, pixelCirclesEqual, pixelPointsEqual, xPlusGoesRight } from "../../core/geometry";
import { graphXAdvancesStrictly } from "../../core/numbers";
import { imageXToNearestPlaneColumn, planeColumnToForwardColumn } from "../../core/plane-grid";
import { nowMs } from "../../core/time";
import { graphwarToolDefaults } from "../../core/tool/defaults";
import { clonePixelPoint, createGraphPoint, createPixelPoint } from "../../core/types";
import type { BoundsRect, GraphBounds, PixelPoint } from "../../core/types";
import { GraphwarWasmAdapterError } from "../../core/wasm/abi";
import {
  assignGraphwarWasmOneClickTargetRoutePoints,
  beginGraphwarWasmOneClickClear,
  internGraphwarWasmOneClickStepStates,
  runGraphwarWasmSmartPathfinding,
  runGraphwarWasmOneClickTrajectoryValidation,
  type GraphwarWasmOneClickEdgeJob,
  type GraphwarWasmOneClickDagJob,
  type GraphwarWasmOneClickEdgeResult,
  type GraphwarWasmOneClickStepStateEvidence,
} from "../../core/wasm/composition-adapter";
import { createGraphwarWasmRouteContext } from "../../core/wasm/route-adapter";
import type { GraphwarWasmRouteContext } from "../../core/wasm/route-adapter";
import type { GraphwarWasmKernelRuntime } from "../../core/wasm/runtime";
import {
  createGraphwarWasmStepGlitchContext,
  createGraphwarWasmStepGlitchContextInput,
  createGraphwarWasmStepGlitchScanCommandInput,
} from "../../core/wasm/step-glitch-adapter";
import type {
  GraphwarWasmStepGlitchGeometryTestContext,
  GraphwarWasmStepGlitchOwnedEvidence,
} from "../../core/wasm/step-glitch-adapter";
import { buildFormula } from "../../formula/generation/build";
import { createStepOverflowProtectionRange, resolveStepFormula } from "../../formula/generation/step-numeric-strategy";
import {
  graphwarByteArraysEqual,
  graphwarFinalReplaySnapshotMatches,
} from "../../formula/trajectory/final-replay-snapshot";
import {
  compareGraphwarPathErrors,
  createGraphwarTrajectoryFormulaMode,
  createGraphwarResolvedTrajectoryContinuationEvidence,
  getGraphwarTrajectoryLaunchAngle,
  graphwarTrajectoryReachesGraphXAfterTargetsBeforeObstacle,
  graphwarTrajectoryReachesGraphXBeforeObstacle,
  measureGraphwarFormulaPathError,
  sampleGraphwarPathTargetSequence,
  tryContinueResolvedGraphwarTrajectory,
  tryResolveGraphwarTrajectoryCandidate,
} from "../../formula/trajectory/sampling";
import type {
  GraphwarStepGlitchFormulaEvidence,
  GraphwarResolvedTrajectoryContinuationEvidence,
  GraphwarTrajectoryFormulaContext,
  GraphwarTrajectoryFormulaMode,
  GraphwarTrajectoryFormulaSettings,
  GraphwarTrajectorySampleResult,
  GraphwarTrajectoryTargetCircle,
} from "../../formula/trajectory/sampling";
import { snapshotGraphwarVisibleTrajectoryPoints } from "../../formula/trajectory/visible-points";
import type { GraphwarPathfindingRouteMode } from "../routing/mode";
import {
  createGraphwarStepGlitchPrefixEvidence,
  createGraphwarStepGlitchPrefixScanner,
  createGraphwarStepGlitchScanMaskIndex,
  findGraphwarStepGlitchAcceptedPointAtOrAfterControlX,
} from "../routing/step-glitch-scan";
import type {
  GraphwarStepGlitchPrefixEvidence,
  GraphwarStepGlitchPrefixScanner,
  GraphwarStepGlitchReplayEvidence,
  GraphwarStepGlitchScanTimingStage,
} from "../routing/step-glitch-scan";
import type { GraphwarStepRoutePathValidation } from "../routing/step-route";
import { createGraphwarStepRouteModel } from "../routing/step-route";
import type { GraphwarPathfindingDebugMetrics } from "../runtime/diagnostics";
import { isGraphwarOneClickClearStepRouteState, type GraphwarOneClickClearStepRouteState } from "./step-route-state";
import { assignGraphwarOneClickClearTargetRoutePoints } from "./target-assignment";

export type { GraphwarOneClickClearStepRouteState } from "./step-route-state";

/** 路线规划默认使用单个 2px 几何 route tolerance，普通寻路和一键清图保持一致。 */
export const GRAPHWAR_DEFAULT_ROUTE_PLANNING_TOLERANCE_PLANE_PIXELS = 2;

/** 一键清图可选择和验证的士兵目标。 */
export interface GraphwarOneClickClearCandidate {
  /** 识别结果里的稳定士兵 id。 */
  id: string;
  /** 是否按当前敌我规则视作敌方。 */
  isEnemy: boolean;
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

/** 一键清图 DAG 边批量建路 job 的共享身份；按生成顺序合并结果，保证 edge id 稳定。 */
interface GraphwarOneClickClearDagEdgeBuildJobBase {
  /** 稳定 job id。 */
  id: number;
  /** 本边起点的具体 DAG node id；START 使用固定虚拟 node id。 */
  from: number;
  /** 本边起点，截图像素坐标。 */
  startPoint: PixelPoint;
  /** 本边几何建路终点，截图像素坐标。 */
  targetPoint: PixelPoint;
  /** 目标士兵下标。 */
  to: number;
}

/** 路由策略与 Step 起点状态必须原子同行，避免跨 Worker 静默降为 stateless route。 */
export type GraphwarOneClickClearDagEdgeBuildJob = GraphwarOneClickClearDagEdgeBuildJobBase &
  (
    | { stepRouteStartState?: never; type: "stateless" }
    | { stepRouteStartState: GraphwarOneClickClearStepRouteState; type: "step-stateful" }
  );

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
  /** Step 解析累计高度的固定起点；stateless route 建路忽略该字段。 */
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
  /** 每个 job 的原子路线结果；`unreachable` 表示该边不可达。 */
  routes: readonly GraphwarOneClickClearDagEdgeRoute[];
  /** 批量 builder 内部测得的调试耗时。 */
  timings: readonly GraphwarOneClickClearDebugTiming[];
}

/** 一键清图 DAG 边 job 的共享结果身份。 */
interface GraphwarOneClickClearDagEdgeRouteBase {
  /** 对应 job id。 */
  jobId: number;
}

/** 路径、路由策略与 Step 终点状态来自同一次建边结果，不允许可达半状态。 */
export type GraphwarOneClickClearDagEdgeRoute = GraphwarOneClickClearDagEdgeRouteBase &
  (
    | { route?: never; stepRouteEndState?: never; type: "unreachable" }
    | { route: PixelPoint[]; stepRouteEndState?: never; type: "stateless" }
    | { route: PixelPoint[]; stepRouteEndState: GraphwarOneClickClearStepRouteState; type: "step-stateful" }
  );

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
    path: readonly PixelPoint[];
    prefixEvidence: GraphwarStepGlitchPrefixEvidence;
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
  isDeleteOptimizationEnabled: boolean;
  /** 当前路径已有像素点。 */
  pathPoints: readonly PixelPoint[];
  /** 当前最后路径点的验证目标；传入士兵命中圈时可复用现有路径预检语义。 */
  prefixTarget?: GraphwarTrajectoryTargetCircle;
  /** 一键清图单值几何路线 mask。 */
  routeMask: GraphwarOneClickClearRouteMask;
  /** 页面侧 route mask 的稳定身份，仅用于路线缓存。 */
  routeMaskCacheId?: number;
  /** 独立的 outer-task nonce；直接单测调用方可省略并使用本地回退值。 */
  wasmRequestNonce?: number;
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
  /** Effective WASM backend; present only for the Worker-owned Step-glitch production branch. */
  wasmRuntime?: GraphwarWasmKernelRuntime;
  /** Step 严格包络整路校验；由持有共用 summed-area 的 master Worker 注入。 */
  validateStepRoute?: (points: readonly PixelPoint[]) => boolean | GraphwarStepRoutePathValidation;
  /** 让出主线程控制权；页面用于响应取消和刷新状态。 */
  yieldControl?: () => Promise<void> | void;
}

/** Adapter 快照后的内部搜索输入；公式设置与解析契约只能作为同一个 branded mode 存在。 */
type GraphwarOneClickClearSearchOptions = Omit<GraphwarOneClickClearOptions, "settings"> & {
  formulaMode: GraphwarTrajectoryFormulaMode;
};

/** 内部构建入口只接收 Worker Adapter 已构造的原子公式模式。 */
export type GraphwarOneClickClearBuildOptions = GraphwarOneClickClearSearchOptions;

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
  | "preflight-blocked";

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

/** 所有 DAG 节点共享的稳定目标身份。 */
interface OneClickClearDagNodeBase {
  /** 稳定 node id；边和 DP 都只引用该 id。 */
  id: number;
  /** 本节点对应的目标士兵下标。 */
  targetIndex: number;
}

/** 节点策略与 Step 平台状态原子同行，DAG 后继不再处理缺状态的 Step 节点。 */
type OneClickClearDagNode = OneClickClearDagNodeBase &
  (
    | { stepRouteState?: never; type: "stateless" }
    | { stepRouteState: GraphwarOneClickClearStepRouteState; type: "step-stateful" }
  );

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
  /** Stable edge ids selected by the WASM composition core before formula validation. */
  preferredEdgeIds?: readonly number[];
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

/** 固定最终公式续播所需的原子前缀；采样状态、命中历史和完整前缀结果来自同一次验证。 */
interface OneClickClearFinalContinuationEvidence {
  /** 已解析公式、物理状态、命中历史和停止语义来自同一次验证。 */
  continuation: GraphwarResolvedTrajectoryContinuationEvidence;
  /** 已验证前缀的完整采样结果；续播成功后与自然后缀逐项合并。 */
  prefixResult: GraphwarTrajectorySampleResult;
}

/** Step replay 沿调用链保持原子；普通验证分支明确禁止携带 final replay 半状态。 */
type OneClickClearIncumbentEvidence =
  | GraphwarStepGlitchReplayEvidence
  | {
      finalValidation?: never;
      /** 该分支没有可恢复终态，只保存已解析公式。 */
      finalContinuation?: never;
      /** 已构造的精确公式上下文。 */
      formulaContext: GraphwarTrajectoryFormulaContext;
      /** 与公式上下文来自同一次回放的可绘制轨迹。 */
      trajectoryPoints: PixelPoint[];
    }
  | {
      finalValidation?: never;
      /** 路径未变化时可从末目标状态继续同一公式，而不重复采样已接受前缀。 */
      finalContinuation: OneClickClearFinalContinuationEvidence;
      /** Continuation atom 内已经携带唯一公式上下文，禁止再并列第二份身份。 */
      formulaContext?: never;
      /** 与 continuation atom 来自同一次回放的可绘制轨迹。 */
      trajectoryPoints: PixelPoint[];
    };

/** 一键清图候选路线、目标序列和可选权威验证证据。 */
interface OneClickClearRoute {
  /** 路径未改变时可直接构造 incumbent 的权威证据。 */
  incumbentEvidence?: OneClickClearIncumbentEvidence;
  /** 最终整路回放的普通控制点最大误差；只用于同业务指标 incumbent 的末级排序。 */
  pathError?: number;
  /** 当前清图结果的完整路径。 */
  pathPoints: PixelPoint[];
  /** 已按 DAG 序列验证命中的目标。 */
  targetSequence: OneClickClearTarget[];
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

/** DAG 路线验证的互斥结果及本轮公式模拟次数。 */
type OneClickClearRouteValidationResult =
  | {
      /** 失败的边；调用方应删除该边并重新跑 DP。 */
      failedEdge: OneClickClearDagEdge;
      type: "failed";
      validationCount: number;
    }
  | {
      /** 验证成功的完整路线。 */
      route: OneClickClearRoute;
      type: "validated";
      validationCount: number;
    };

/** 可供下一条 DAG 候选恢复的已验证前缀快照。 */
interface OneClickClearRouteValidationSnapshot {
  /** 本快照已经验证到的最后一条边；重选路线只复用连续相同的 edge id 前缀。 */
  edgeId: number;
  /** 已验证前缀的完整路径。 */
  pathPoints: PixelPoint[];
  /** Append-stable 公式可从物理状态续播；其他公式只复用目标和路径并 cold replay。 */
  segmentState: OneClickClearRouteSegmentValidationStart;
  /** 已验证前缀按顺序命中的目标。 */
  targetSequence: OneClickClearTarget[];
}

/** 删点优化后的路线、工作量和可选最终回放。 */
interface OneClickClearPathOptimizationResult {
  /** 局部快检删点后的精确路径若已完整复验，调用方可直接复用结果及其公式上下文。 */
  finalValidation?: ReturnType<typeof sampleOneClickClearTargetSequence>;
  route: OneClickClearRoute;
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
      route: OneClickClearRoute;
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
  options: GraphwarOneClickClearSearchOptions;
  /** DAG 禁边重选时复用上一轮完全相同的已验证边前缀。 */
  routeValidationPrefix?: OneClickClearRouteValidationSnapshot[];
}

/** Append-stable 增量验证可续播的原子起点及其同次历史证据。 */
interface OneClickClearRouteContinuationEvidence {
  /** 已解析公式、状态、命中历史、首点停止语义和 sign protection 不允许拆开更新。 */
  continuation: GraphwarResolvedTrajectoryContinuationEvidence;
  /** 已验证前缀的普通控制点最大路径误差；续播后与新增段误差取最大值。 */
  pathError?: number;
  /** 已验证物理前缀的完整采样；后续同公式 final continuation 需要精确拼回 Graphwar 点。 */
  sampleResult: GraphwarTrajectorySampleResult;
  /** 从物理状态续播时已经验证过的可绘制轨迹前缀。 */
  trajectoryPoints: PixelPoint[];
}

/** 增量验证下一条边的互斥起点；cold 分支不能携带 continuation 半状态。 */
type OneClickClearRouteSegmentValidationStart =
  | { type: "cold" }
  | { evidence: OneClickClearRouteContinuationEvidence; type: "continuation" };

/** 单条新增边的公式上下文和采样结果。 */
interface OneClickClearRouteSegmentValidationResult {
  /** 当前完整路径保持不变时，可直接续播到自然停止位置。 */
  finalContinuation?: OneClickClearFinalContinuationEvidence;
  formulaContext: GraphwarTrajectoryFormulaContext;
  sampleResult: GraphwarTrajectorySampleResult;
  /** 当前完整路径对应的可绘制轨迹；ABS 续播结果已和旧前缀拼接。 */
  trajectoryPoints: PixelPoint[];
}

const START_NODE_INDEX = -1;
// 截图像素：缺省 prefixTarget 和目标序列默认半径都会用它；显式 targetCircles 会覆盖。
const FALLBACK_TARGET_RADIUS_IMAGE_PIXELS = 1;

/** 在唯一入口冻结请求数据；回调、yield 和外部 Worker adapter 只能观察自己的副本。 */
function snapshotOneClickClearOptions(input: GraphwarOneClickClearBuildOptions): GraphwarOneClickClearSearchOptions {
  const { formulaMode: providedFormulaMode, ...inputBase } = input;
  const sourceSettings = providedFormulaMode.settings;
  const maskSnapshots = new Map<Uint8Array, Uint8Array>();
  const routeMask = input.routeMask.mask.slice();
  maskSnapshots.set(input.routeMask.mask, routeMask);
  const snapshotMask = (mask: Uint8Array | undefined) => {
    if (!mask) {
      return undefined;
    }
    const existing = maskSnapshots.get(mask);
    if (existing) {
      return existing;
    }
    const snapshot = mask.slice();
    maskSnapshots.set(mask, snapshot);
    return snapshot;
  };
  const simulationMask = snapshotMask(input.simulationMask);
  const stepGlitchObstacleMask = snapshotMask(sourceSettings.stepGlitchObstacleMask);
  const settings = {
    ...sourceSettings,
    ...(stepGlitchObstacleMask ? { stepGlitchObstacleMask } : {}),
  };
  // 含 mask 的设置必须和复制后的 mask 重新绑定；无 mask 的 Worker 内部 job 保留 Adapter 创建的同一 mode。
  const formulaMode =
    stepGlitchObstacleMask === undefined ? providedFormulaMode : createGraphwarTrajectoryFormulaMode(settings);
  return {
    ...inputBase,
    bounds: { ...input.bounds },
    boundsRect: { ...input.boundsRect },
    candidates: input.candidates.map(snapshotOneClickClearCandidate),
    hitCandidates: input.hitCandidates.map(snapshotOneClickClearCandidate),
    pathPoints: input.pathPoints.map(clonePixelPoint),
    ...(input.prefixTarget
      ? {
          prefixTarget: {
            center: clonePixelPoint(input.prefixTarget.center),
            radius: input.prefixTarget.radius,
          },
        }
      : {}),
    routeMask: {
      mask: routeMask,
      routeTolerancePlanePixels: input.routeMask.routeTolerancePlanePixels,
    },
    formulaMode,
    ...(simulationMask ? { simulationMask } : {}),
    ...(input.stepGlitchPrefixEvidence
      ? { stepGlitchPrefixEvidence: structuredClone(input.stepGlitchPrefixEvidence) }
      : {}),
  };
}

/** 复制候选和圆心，避免 candidates/hitCandidates 保留页面代理或共享可变点。 */
function snapshotOneClickClearCandidate(candidate: GraphwarOneClickClearCandidate): GraphwarOneClickClearCandidate {
  return {
    isEnemy: candidate.isEnemy,
    hitCenter: clonePixelPoint(candidate.hitCenter),
    hitRadius: candidate.hitRadius,
    id: candidate.id,
  };
}

/** 用共享目标分配和当前公式模式找到显式击杀最多的追加路径。 */
export async function buildGraphwarOneClickClearPath(
  inputOptions: GraphwarOneClickClearBuildOptions,
): Promise<GraphwarOneClickClearResult> {
  const startedAt = nowMs();
  const options = snapshotOneClickClearOptions(inputOptions);
  if (options.pathPoints.length === 0) {
    return createOneClickClearFailure("preflight-blocked", startedAt, 0);
  }

  const pathSearchPolicy = options.formulaMode.contract.pathSearchPolicy;
  const isPrefixValid =
    pathSearchPolicy.type === "step-glitch"
      ? true
      : options.pathPoints.length >= 2
        ? measureOneClickClearDebugTiming(
            options,
            "validate-prefix",
            () => oneClickClearStepRouteIsValid(options, options.pathPoints) && validateOneClickClearPrefix(options),
          )
        : true;
  if (!isPrefixValid) {
    return createOneClickClearFailure("preflight-blocked", startedAt, 0);
  }

  const assignedTargets = measureOneClickClearDebugTiming(options, "assign-clear-targets", () =>
    collectOneClickClearTargets(options),
  );
  if (assignedTargets.length === 0) {
    return createOneClickClearFailure("no-candidate", startedAt, 0);
  }

  // Assignment already emits the canonical forward-column order. The
  // retained composition session consumes that order for DAG construction;
  // starting a second session just to sort would duplicate ownership.
  const targets = assignedTargets;

  const context: OneClickClearSearchContext = {
    bestValidatedPointCount: Number.POSITIVE_INFINITY,
    bestValidatedTargetCount: 0,
    options,
  };
  // 失败仍按失败返回，让主线程明确显示“已保留当前最优结果”；检查点已通过回调独立保存。
  return pathSearchPolicy.type === "step-glitch"
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
  } catch (error) {
    if (isGraphwarWasmFault(error) || error instanceof GraphwarWasmAdapterError) {
      throw error;
    }
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
  let options = context.options;
  let formulaMode = options.formulaMode;
  const settings = formulaMode.settings;
  const simulationMask = options.simulationMask ?? settings.stepGlitchObstacleMask;
  if (!simulationMask) {
    return createOneClickClearFailure("preflight-blocked", startedAt, 0);
  }
  if (options.simulationMask !== simulationMask || settings.stepGlitchObstacleMask !== simulationMask) {
    formulaMode = createGraphwarTrajectoryFormulaMode({ ...settings, stepGlitchObstacleMask: simulationMask });
    options = {
      ...options,
      formulaMode,
      simulationMask,
    };
    context.options = options;
  }

  if (options.wasmRuntime) {
    return buildOneClickClearStepGlitchPathWithWasm(context, targets, startedAt);
  }

  const maskIndex = createGraphwarStepGlitchScanMaskIndex({
    boundaryExpansion: options.simulationBoundaryExpansion,
    bounds: options.bounds,
    simulationMask,
  });
  let route: OneClickClearRoute = {
    pathPoints: [...options.pathPoints],
    targetSequence: [],
  };
  let prefixScanner: GraphwarStepGlitchPrefixScanner | undefined;
  let prefixEvidence = options.stepGlitchPrefixEvidence;
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

    const requiredTargets = createOneClickClearPreviousTargets(route.targetSequence);
    prefixScanner ??= createGraphwarStepGlitchPrefixScanner({
      bounds: options.bounds,
      boundsRect: options.boundsRect,
      debugMetrics: options.debugMetrics,
      maskIndex,
      ...(prefixEvidence ? { prefixEvidence } : {}),
      ...(route.targetSequence.length === 0 && options.prefixTarget ? { prefixTarget: options.prefixTarget } : {}),
      requiredTargets,
      formulaMode,
      simulationBoundaryExpansion: options.simulationBoundaryExpansion,
      simulationMask,
      sourcePath: route.pathPoints,
    });
    const nextTargetSequence = [...route.targetSequence, target];
    const isFinalTarget = target === targets.at(-1);
    const scan = prefixScanner.scan({
      ...(isFinalTarget
        ? {
            finalValidation: {
              simulationMaskCacheId: options.simulationMaskCacheId,
              targetControlPoints: createOneClickClearTargetControlPoints(options, nextTargetSequence),
              trackedTargets: createOneClickClearTrackedTargets(options, {
                pathPoints: [...route.pathPoints, target.routePoint],
                targetSequence: nextTargetSequence,
              }).map((trackedTarget) => trackedTarget.hitCircle),
            },
          }
        : {}),
      hitTarget: target.hitCircle,
      targetPoint: target.routePoint,
    });
    appendOneClickClearStepGlitchScanTimings(options, scan.timings);
    workUnits += scan.expandedStates;

    // 只有命中才提交路线；其他结果保留最近命中的路线，让更右目标重新选择上下通道。
    if (scan.status === "hit") {
      acceptedLayerGraphX = target.sortGraphX;
      route = {
        incumbentEvidence: scan.replayEvidence,
        pathPoints: scan.path,
        targetSequence: nextTargetSequence,
      };
      // hit 已包含精确整式模拟；此时发布不会为了预览再做一次昂贵采样。
      publishOneClickClearValidatedRoute(context, route);
      // 成功候选已完整模拟；下一目标复用 exact path 的恢复点，不再重算刚提交的 prefix。
      prefixEvidence = createGraphwarStepGlitchPrefixEvidence({
        acceptedPoint: scan.acceptedPoint,
        formulaEvidence: scan.replayEvidence.formulaContext.stepGlitchFormulaEvidence,
        prefixTarget: target.hitCircle,
        requiredTargets,
        simulationBoundaryExpansion: options.simulationBoundaryExpansion,
        simulationMask,
      });
      // 每个 hit 都是可独立采用的精确路径；最终失败时 Master 仍应能复用被页面保留的这个前缀。
      publishOneClickClearStepGlitchHitEvidence(options, route, prefixEvidence);
      prefixScanner = undefined;
    } else if (scan.status === "invalid-input" || scan.status === "unsupported") {
      return createOneClickClearFailure("preflight-blocked", startedAt, workUnits);
    }

    await yieldOneClickClearControl(options);
  }

  const finalized = options.isDeleteOptimizationEnabled
    ? await measureOneClickClearDebugTimingAsync(options, "optimize-path", () =>
        optimizeOneClickClearPath(context, route, workUnits),
      )
    : { route, workUnits };
  workUnits = finalized.workUnits;
  const finalValidation =
    finalized.finalValidation ??
    createOneClickClearFinalValidationFromStepGlitchEvidence(options, finalized.route) ??
    measureOneClickClearDebugTiming(options, "validate-final", () =>
      sampleOneClickClearTargetSequence(options, finalized.route, true),
    );
  if (!finalValidation.reachesTargetSequenceBeforeObstacle || !finalValidation.formulaContext) {
    return createOneClickClearFailure("no-usable-target", startedAt, workUnits);
  }
  const finalFormulaEvidence = finalValidation.formulaContext.stepGlitchFormulaEvidence;
  if (!finalFormulaEvidence) {
    throw new Error("Validated Step glitch path is missing its formula evidence.");
  }
  const finalRoute = {
    ...finalized.route,
    incumbentEvidence: {
      formulaContext: finalValidation.formulaContext,
      trajectoryPoints: snapshotGraphwarVisibleTrajectoryPoints(
        finalValidation.visiblePixels,
        finalValidation.obstacleHitIndex,
        options.debugMetrics,
      ),
    },
    ...(finalValidation.pathError === undefined ? {} : { pathError: finalValidation.pathError }),
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
    finalFormulaEvidence,
  );
  return createOneClickClearSuccessResult(options, finalRoute, hitTargets, startedAt, workUnits);
}

/**
 * Effective WASM Step-glitch search. The context is retained while the source prefix is unchanged; a successful target
 * replaces that prefix and therefore replaces the context. Owned evidence is used directly for incumbent publication.
 * It deliberately cannot become TS prefix evidence because the production ABI does not carry the complete prefix
 * identity.
 */
async function buildOneClickClearStepGlitchPathWithWasm(
  context: OneClickClearSearchContext,
  targets: readonly OneClickClearTarget[],
  startedAt: number,
): Promise<GraphwarOneClickClearResult> {
  const options = context.options;
  const simulationMask = options.simulationMask;
  const formulaMode = options.formulaMode;
  if (!simulationMask || !options.wasmRuntime) {
    return createOneClickClearFailure("preflight-blocked", startedAt, 0);
  }

  let route: OneClickClearRoute = {
    pathPoints: [...options.pathPoints],
    targetSequence: [],
  };
  let prefixEvidence = options.stepGlitchPrefixEvidence;
  let scanner: GraphwarWasmStepGlitchGeometryTestContext | undefined;
  let finalEvidence: GraphwarWasmStepGlitchOwnedEvidence | undefined;
  let workUnits = 0;
  let acceptedLayerGraphX: number | undefined;

  try {
    for (const target of targets) {
      if (acceptedLayerGraphX === target.sortGraphX) {
        continue;
      }
      if (options.isCancelled?.()) {
        return createOneClickClearFailure("no-usable-target", startedAt, workUnits);
      }

      const requiredTargets = createOneClickClearPreviousTargets(route.targetSequence);
      if (!scanner) {
        const created = createOneClickClearStepGlitchWasmScanner(
          options,
          formulaMode,
          simulationMask,
          route.pathPoints,
          requiredTargets,
          prefixEvidence,
          route.targetSequence.length === 0 ? options.prefixTarget : undefined,
        );
        if (created.status !== "ready") {
          return createOneClickClearFailure("preflight-blocked", startedAt, workUnits);
        }
        scanner = created.context;
      }

      const nextTargetSequence = [...route.targetSequence, target];
      const isFinalTarget = target === targets.at(-1);
      const scanStartedAt = nowMs();
      const scan = scanner.scanRaw(
        createGraphwarWasmStepGlitchScanCommandInput({
          ...(isFinalTarget
            ? {
                finalValidation: {
                  simulationMaskCacheId: options.simulationMaskCacheId,
                  targetControlPoints: createOneClickClearTargetControlPoints(options, nextTargetSequence),
                  trackedTargets: createOneClickClearTrackedTargets(options, {
                    pathPoints: [...route.pathPoints, target.routePoint],
                    targetSequence: nextTargetSequence,
                  }).map((trackedTarget) => trackedTarget.hitCircle),
                },
              }
            : {}),
          hitTarget: target.hitCircle,
          targetPoint: target.routePoint,
        }),
      );
      options.onDebugTiming?.({
        elapsedMs: Math.max(0, nowMs() - scanStartedAt),
        stage: "scan-step-glitch",
      });
      workUnits += scan.expandedStates;

      if (scan.status === "hit") {
        const evidence = scan.evidence?.owned;
        if (!evidence) {
          throw new GraphwarWasmFault("abi", "One-Click Clear WASM scan returned no owned evidence");
        }
        acceptedLayerGraphX = target.sortGraphX;
        route = {
          incumbentEvidence: createOneClickClearWasmIncumbentEvidence(evidence, options.debugMetrics),
          pathPoints: evidence.path.map(clonePixelPoint),
          targetSequence: nextTargetSequence,
        };
        publishOneClickClearValidatedRoute(context, route);
        finalEvidence = isFinalTarget ? evidence : undefined;
        // The source path and required target set changed. Drop all old state, including any stale prefix evidence.
        scanner.dispose();
        scanner = undefined;
        prefixEvidence = undefined;
      } else if (scan.status === "invalid-input" || scan.status === "unsupported") {
        return createOneClickClearFailure("preflight-blocked", startedAt, workUnits);
      }

      await yieldOneClickClearControl(options);
    }

    if (route.targetSequence.length === 0) {
      return createOneClickClearFailure("no-usable-target", startedAt, workUnits);
    }

    let optimizedRoute = route;
    if (options.isDeleteOptimizationEnabled) {
      const optimized = await measureOneClickClearDebugTimingAsync(options, "optimize-path", () =>
        optimizeOneClickClearStepGlitchPathWithWasm(context, route, workUnits),
      );
      workUnits = optimized.workUnits;
      if (optimized.status !== "ready") {
        return createOneClickClearFailure("preflight-blocked", startedAt, workUnits);
      }
      optimizedRoute = optimized.route;
      finalEvidence = optimized.evidence;
    }

    if (!finalEvidence) {
      const replay = measureOneClickClearDebugTiming(options, "validate-final", () =>
        runOneClickClearStepGlitchWasmReplay(options, formulaMode, simulationMask, optimizedRoute),
      );
      workUnits += replay.expandedStates;
      if (replay.status !== "hit" || !replay.evidence) {
        return createOneClickClearFailure("no-usable-target", startedAt, workUnits);
      }
      finalEvidence = replay.evidence;
    }

    const finalRoute: OneClickClearRoute = {
      ...optimizedRoute,
      incumbentEvidence: createOneClickClearWasmIncumbentEvidence(finalEvidence, options.debugMetrics),
      ...(finalEvidence.trajectory.pathError === undefined ? {} : { pathError: finalEvidence.trajectory.pathError }),
    };
    publishOneClickClearValidatedRoute(context, finalRoute);
    const trackedTargets = createOneClickClearTrackedTargets(options, finalRoute);
    const hitTargets = collectOneClickClearHitTargets(trackedTargets, finalEvidence.trajectory.trackedTargetHitIndexes);
    return createOneClickClearSuccessResult(options, finalRoute, hitTargets, startedAt, workUnits);
  } finally {
    scanner?.dispose();
  }
}

type OneClickClearStepGlitchWasmContextResult =
  | { context: GraphwarWasmStepGlitchGeometryTestContext; status: "ready" }
  | { status: "invalid-input" | "unsupported" };

/** Packs one immutable source-prefix descriptor; no Worker-local scanner copy is allowed. */
function createOneClickClearStepGlitchWasmScanner(
  options: GraphwarOneClickClearSearchOptions,
  formulaMode: GraphwarTrajectoryFormulaMode,
  simulationMask: Uint8Array,
  sourcePath: readonly PixelPoint[],
  requiredTargets: readonly GraphwarTrajectoryTargetCircle[],
  prefixEvidence: GraphwarStepGlitchPrefixEvidence | undefined,
  prefixTarget: GraphwarTrajectoryTargetCircle | undefined,
): OneClickClearStepGlitchWasmContextResult {
  if (!options.wasmRuntime) {
    return { status: "unsupported" };
  }
  return createGraphwarWasmStepGlitchContext(
    options.wasmRuntime,
    createGraphwarWasmStepGlitchContextInput({
      bounds: options.bounds,
      boundsRect: options.boundsRect,
      formulaMode,
      ...(prefixEvidence ? { prefixEvidence } : {}),
      ...(prefixTarget ? { prefixTarget } : {}),
      requiredTargets,
      simulationBoundaryExpansion: options.simulationBoundaryExpansion,
      simulationMask,
      sourcePath,
    }),
  );
}

interface OneClickClearStepGlitchWasmOptimizationResult {
  evidence?: GraphwarWasmStepGlitchOwnedEvidence;
  route: OneClickClearRoute;
  status: "invalid-input" | "ready" | "unsupported";
  workUnits: number;
}

/** Uses command 19 for every accepted/rejected deletion while retaining one source-prefix context. */
async function optimizeOneClickClearStepGlitchPathWithWasm(
  context: OneClickClearSearchContext,
  route: OneClickClearRoute,
  workUnits: number,
): Promise<OneClickClearStepGlitchWasmOptimizationResult> {
  const options = context.options;
  const simulationMask = options.simulationMask;
  if (!simulationMask || !options.wasmRuntime) {
    return { route, status: "unsupported", workUnits };
  }
  const created = createOneClickClearStepGlitchWasmScanner(
    options,
    options.formulaMode,
    simulationMask,
    options.pathPoints,
    [],
    options.stepGlitchPrefixEvidence,
    options.prefixTarget,
  );
  if (created.status !== "ready") {
    return { route, status: created.status, workUnits };
  }

  const scanner = created.context;
  let optimized = route;
  let evidence: GraphwarWasmStepGlitchOwnedEvidence | undefined;
  const protectedTargetPoints = route.targetSequence.map((target) => target.routePoint);
  const targetSequence = route.targetSequence.map((target) => target.hitCircle);
  const controlPoint = route.pathPoints.at(-1) ?? options.pathPoints.at(-1);
  if (!controlPoint) {
    scanner.dispose();
    return { route, status: "ready", workUnits };
  }
  const controlX = imageToGraphPoint(controlPoint, options.bounds, options.boundsRect).x;
  try {
    for (let index = options.pathPoints.length; index < optimized.pathPoints.length;) {
      if (options.isCancelled?.()) {
        break;
      }
      const point = optimized.pathPoints[index];
      if (point && protectedTargetPoints.some((protectedPoint) => pixelPointsEqual(protectedPoint, point))) {
        index += 1;
        continue;
      }
      const candidatePath = [...optimized.pathPoints.slice(0, index), ...optimized.pathPoints.slice(index + 1)];
      if (!oneClickClearPathFollowsGraphRule(options, candidatePath)) {
        index += 1;
        continue;
      }
      workUnits += 1;
      const candidateRoute = { ...optimized, pathPoints: candidatePath };
      const replay = scanner.replayRaw({
        controlX,
        finalValidation: {
          simulationMaskCacheId: options.simulationMaskCacheId,
          targetControlPoints: createOneClickClearTargetControlPoints(options, candidateRoute.targetSequence),
          trackedTargets: createOneClickClearTrackedTargets(options, candidateRoute).map(
            (trackedTarget) => trackedTarget.hitCircle,
          ),
          type: "validate",
        },
        path: candidatePath,
        targetSequence,
        type: "replay",
        windows: { type: "automatic" },
      });
      if (replay.status === "hit" && replay.evidence) {
        optimized = candidateRoute;
        evidence = replay.evidence.owned;
        continue;
      }
      index += 1;
      await yieldOneClickClearControl(options);
    }
  } finally {
    scanner.dispose();
  }
  return { ...(evidence ? { evidence } : {}), route: optimized, status: "ready", workUnits };
}

/** Final command-19 safety replay for a route changed by deletion or by a same-x target skip. */
function runOneClickClearStepGlitchWasmReplay(
  options: GraphwarOneClickClearSearchOptions,
  formulaMode: GraphwarTrajectoryFormulaMode,
  simulationMask: Uint8Array,
  route: OneClickClearRoute,
) {
  const created = createOneClickClearStepGlitchWasmScanner(
    options,
    formulaMode,
    simulationMask,
    options.pathPoints,
    [],
    options.stepGlitchPrefixEvidence,
    options.prefixTarget,
  );
  if (created.status !== "ready") {
    return { expandedStates: 0, status: created.status } as const;
  }
  const scanner = created.context;
  try {
    const controlPoint = route.pathPoints.at(-1) ?? options.pathPoints.at(-1);
    if (!controlPoint) {
      return { expandedStates: 0, status: "miss" as const };
    }
    const replay = scanner.replayRaw({
      controlX: imageToGraphPoint(controlPoint, options.bounds, options.boundsRect).x,
      finalValidation: {
        simulationMaskCacheId: options.simulationMaskCacheId,
        targetControlPoints: createOneClickClearTargetControlPoints(options, route.targetSequence),
        trackedTargets: createOneClickClearTrackedTargets(options, route).map(
          (trackedTarget) => trackedTarget.hitCircle,
        ),
        type: "validate",
      },
      path: route.pathPoints,
      targetSequence: route.targetSequence.map((target) => target.hitCircle),
      type: "replay",
      windows: { type: "automatic" },
    });
    return {
      expandedStates: replay.expandedStates,
      ...(replay.evidence ? { evidence: replay.evidence.owned } : {}),
      status: replay.status,
    } as const;
  } finally {
    scanner.dispose();
  }
}

/** Converts owned WASM evidence to the existing incumbent union without rebuilding formula/trajectory state. */
function createOneClickClearWasmIncumbentEvidence(
  evidence: GraphwarWasmStepGlitchOwnedEvidence,
  debugMetrics?: GraphwarPathfindingDebugMetrics,
) {
  return {
    formulaContext: evidence.formulaContext,
    trajectoryPoints: snapshotGraphwarVisibleTrajectoryPoints(
      evidence.trajectory.visiblePixels,
      evidence.trajectory.obstacleHitIndex,
      debugMetrics,
    ),
  } satisfies Extract<OneClickClearIncumbentEvidence, { formulaContext: GraphwarTrajectoryFormulaContext }>;
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

  const canReuseWasmPreferredPath =
    dag.preferredEdgeIds !== undefined &&
    dag.preferredEdgeIds.length > 0 &&
    dag.preferredEdgeIds.every((edgeId) => dag.edges[edgeId]?.active === true);
  const wasmSelectedEdges =
    options.wasmRuntime && !canReuseWasmPreferredPath
      ? dag.nodes.every((node) => node.type === "stateless")
        ? await selectOneClickClearStatelessDagPathWithWasm(context, dag)
        : await selectOneClickClearStepDagPathWithWasm(context, dag)
      : undefined;
  const selectedEdges =
    wasmSelectedEdges ??
    measureOneClickClearDebugTiming(options, "dag-longest-path", () => findOneClickClearLongestPath(dag));
  if (selectedEdges.length === 0) {
    return {
      reason: "no-usable-target",
      type: "failure",
      workUnits,
    };
  }

  // The effective normal WASM path owns trajectory validation and deletion
  // replay. The TypeScript implementation remains the cold-replay backend and
  // is selected only when this request has no validated WASM runtime.
  if (options.wasmRuntime && options.formulaMode.contract.pathSearchPolicy.type !== "step-glitch") {
    return runOneClickClearSearchAttemptWithWasm(context, dag, selectedEdges, workUnits);
  }

  const validation = measureOneClickClearDebugTiming(options, "validate-route", () =>
    validateOneClickClearDagRoute(context, dag, selectedEdges),
  );
  const nextWorkUnits = workUnits + validation.validationCount;
  if (validation.type === "failed") {
    return {
      failedEdge: validation.failedEdge,
      type: "retry",
      workUnits: nextWorkUnits,
    };
  }
  const validatedRoute = validation.route;

  // 即使关闭删点也保留最终整路复验；它负责裁决后缀对本轮先前目标和碰撞的影响。
  const optimized = options.isDeleteOptimizationEnabled
    ? await measureOneClickClearDebugTimingAsync(options, "optimize-path", () =>
        optimizeOneClickClearPath(context, validatedRoute, nextWorkUnits),
      )
    : { route: validatedRoute, workUnits: nextWorkUnits };
  const finalValidation =
    optimized.finalValidation ??
    measureOneClickClearDebugTiming(
      options,
      "validate-final",
      () =>
        createOneClickClearFinalValidationFromContinuation(options, optimized.route) ??
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
        incumbentEvidence: {
          formulaContext: finalValidation.formulaContext,
          trajectoryPoints: snapshotGraphwarVisibleTrajectoryPoints(
            finalValidation.visiblePixels,
            finalValidation.obstacleHitIndex,
            options.debugMetrics,
          ),
        },
        ...(finalValidation.pathError === undefined ? {} : { pathError: finalValidation.pathError }),
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

/** Re-runs retained WASM DAG selection after a formula-invalid edge is disabled. */
async function selectOneClickClearStatelessDagPathWithWasm(
  context: OneClickClearSearchContext,
  dag: OneClickClearDag,
): Promise<OneClickClearDagEdge[] | undefined> {
  const options = context.options;
  const wasmRuntime = options.wasmRuntime;
  const activeEdges = dag.edges.filter((edge) => edge.active);
  if (!wasmRuntime || dag.nodes.some((node) => node.type !== "stateless")) {
    return undefined;
  }
  if (activeEdges.length === 0) {
    return [];
  }
  const edgesByJobId = new Map<number, OneClickClearDagEdge>();
  const dagJobs = activeEdges.map<GraphwarWasmOneClickDagJob>((edge, id) => {
    const targetNode = dag.nodes[edge.to];
    if (!targetNode || targetNode.type !== "stateless") {
      throw new GraphwarWasmFault("abi", "one-click stateless retry lost its target node identity");
    }
    const startPoint = edge.route[0];
    const targetPoint = edge.route.at(-1);
    if (!startPoint || !targetPoint) {
      throw new GraphwarWasmFault("abi", "one-click stateless retry lost its edge endpoints");
    }
    edgesByJobId.set(id, edge);
    return {
      from: edge.from,
      fromNodeId: edge.from === START_NODE_INDEX ? 0xffff_ffff : edge.from,
      id,
      startPoint,
      targetPoint,
      to: targetNode.targetIndex,
      toNodeId: targetNode.id,
    };
  });
  const composition = beginGraphwarWasmOneClickClear(wasmRuntime, {
    candidates: dag.targets.map((target) => ({
      hitCenter: target.routePoint,
      hitRadius: target.hitCircle.radius,
      isEnemy: true,
    })),
    dagJobs,
    isDeleteOptimizationEnabled: options.isDeleteOptimizationEnabled,
    isStepStateful: false,
    isTargetOrderDescending: !xPlusGoesRight(options.bounds),
    path: options.pathPoints,
    requestNonce: options.wasmRequestNonce ?? 1,
    targetOrderKeys: createOneClickClearWasmTargetOrderKeys(options, dag.targets),
    verticalVariationScale: calculateOneClickClearVerticalVariationScale(options),
  });
  if (composition.status !== "waiting-edge-batch") {
    return [];
  }
  try {
    assertOneClickClearWasmDagJobDescriptors(composition.edgeJobs, dagJobs, "one-click stateless retry");
    const result = composition.handle.resume(
      composition.edgeJobs.map((job) => {
        const edge = edgesByJobId.get(job.id);
        return edge
          ? {
              jobId: job.id,
              reachable: true,
              requestNonce: composition.handle.requestNonce,
              route: edge.route,
              sessionNonce: composition.handle.nonce,
            }
          : {
              jobId: job.id,
              reachable: false,
              requestNonce: composition.handle.requestNonce,
              sessionNonce: composition.handle.nonce,
            };
      }),
    );
    if (result.status === "waiting-edge-batch") {
      throw new GraphwarWasmFault("abi", "one-click stateless retry returned an unexpected pending batch");
    }
    if (result.status !== "complete" || result.selectedEdgeIds.length === 0) {
      return [];
    }
    const selectedEdgeIds = mapOneClickClearSelectedJobIdsToEdgeIds(result.selectedEdgeIds, edgesByJobId);
    return selectedEdgeIds.flatMap((edgeId) => {
      const edge = dag.edges[edgeId];
      return edge ? [edge] : [];
    });
  } finally {
    composition.handle.cancel();
  }
}

interface OneClickClearWasmRouteValidation {
  readonly formulaContext: GraphwarTrajectoryFormulaContext;
  readonly pathError?: number;
  readonly reachedTargetCount: number;
  readonly reachesTargetSequenceBeforeObstacle: boolean;
  readonly trackedTargetHitIndexes: readonly number[];
  readonly trackedTargets: readonly OneClickClearTrackedTarget[];
  readonly trajectoryPoints: readonly PixelPoint[];
}

/** Runs the selected complete route through the multi-target WASM trajectory command. */
async function runOneClickClearSearchAttemptWithWasm(
  context: OneClickClearSearchContext,
  dag: OneClickClearDag,
  selectedEdges: readonly OneClickClearDagEdge[],
  workUnits: number,
): Promise<OneClickClearSearchAttemptResult> {
  const options = context.options;
  const selectedRoute = createOneClickClearRouteFromEdges(options, dag, selectedEdges);
  if (!selectedRoute) {
    return { reason: "no-usable-target", type: "failure", workUnits };
  }

  const validation = measureOneClickClearDebugTiming(options, "validate-route", () =>
    runOneClickClearWasmRouteValidation(options, selectedRoute.pathPoints, selectedRoute.targetSequence, false),
  );
  const nextWorkUnits = workUnits + 1;
  if (!validation?.reachesTargetSequenceBeforeObstacle) {
    const reachedTargetCount = validation?.reachedTargetCount ?? 0;
    const failedEdge = selectedEdges[Math.min(reachedTargetCount, selectedEdges.length - 1)];
    return failedEdge
      ? { failedEdge, type: "retry", workUnits: nextWorkUnits }
      : { reason: "no-usable-target", type: "failure", workUnits: nextWorkUnits };
  }

  let optimizedRoute: OneClickClearRoute = {
    ...selectedRoute,
    incumbentEvidence: {
      formulaContext: validation.formulaContext,
      trajectoryPoints: [...validation.trajectoryPoints],
    },
    ...(validation.pathError === undefined ? {} : { pathError: validation.pathError }),
  } satisfies OneClickClearRoute;
  let optimizedWorkUnits = nextWorkUnits;
  if (options.isDeleteOptimizationEnabled) {
    const optimized = await measureOneClickClearDebugTimingAsync(options, "optimize-path", () =>
      optimizeOneClickClearPathWithWasm(context, optimizedRoute, optimizedWorkUnits),
    );
    optimizedRoute = optimized.route;
    optimizedWorkUnits = optimized.workUnits;
  }

  const finalValidation = measureOneClickClearDebugTiming(options, "validate-final", () =>
    runOneClickClearWasmRouteValidation(options, optimizedRoute.pathPoints, optimizedRoute.targetSequence, true),
  );
  const finalStepValidation = validateOneClickClearStepRoute(options, optimizedRoute.pathPoints);
  if (finalStepValidation.ok && finalValidation?.reachesTargetSequenceBeforeObstacle) {
    const route: OneClickClearRoute = {
      ...optimizedRoute,
      incumbentEvidence: {
        formulaContext: finalValidation.formulaContext,
        trajectoryPoints: [...finalValidation.trajectoryPoints],
      },
      ...(finalValidation.pathError === undefined ? {} : { pathError: finalValidation.pathError }),
    };
    return {
      hitTargets: collectOneClickClearHitTargets(
        finalValidation.trackedTargets,
        finalValidation.trackedTargetHitIndexes,
      ),
      route,
      type: "validated",
      workUnits: optimizedWorkUnits + 1,
    };
  }

  if (!finalStepValidation.ok) {
    const failedEdge = findOneClickClearStepRouteFailedEdge(
      options,
      selectedEdges,
      finalStepValidation.invalidSegmentIndex,
    );
    return failedEdge
      ? { failedEdge, type: "retry", workUnits: optimizedWorkUnits + 1 }
      : { reason: "no-usable-target", type: "failure", workUnits: optimizedWorkUnits + 1 };
  }

  const reachedTargetCount = finalValidation?.reachedTargetCount ?? 0;
  const failedEdge = selectedEdges[Math.min(reachedTargetCount, selectedEdges.length - 1)];
  return failedEdge
    ? { failedEdge, type: "retry", workUnits: optimizedWorkUnits + 1 }
    : { reason: "no-usable-target", type: "failure", workUnits: optimizedWorkUnits + 1 };
}

/** Builds the selected edge chain without asking TS to validate its formula. */
function createOneClickClearRouteFromEdges(
  options: GraphwarOneClickClearSearchOptions,
  dag: OneClickClearDag,
  edges: readonly OneClickClearDagEdge[],
) {
  const pathPoints = [...options.pathPoints];
  const targetSequence: OneClickClearTarget[] = [];
  for (const edge of edges) {
    const targetNode = dag.nodes[edge.to];
    const target = targetNode ? dag.targets[targetNode.targetIndex] : undefined;
    const previousPoint = pathPoints.at(-1);
    const routeStart = edge.route[0];
    if (!target || !previousPoint || !routeStart || !pixelPointsEqual(previousPoint, routeStart)) {
      return undefined;
    }
    pathPoints.push(...edge.route.slice(1));
    targetSequence.push(target);
  }
  return { pathPoints, targetSequence };
}

/** Runs a complete path or deletion candidate through WASM's canonical trajectory core. */
function runOneClickClearWasmRouteValidation(
  options: GraphwarOneClickClearSearchOptions,
  pathPoints: readonly PixelPoint[],
  targetSequence: readonly OneClickClearTarget[],
  trackActualHits: boolean,
): OneClickClearWasmRouteValidation | undefined {
  const wasmRuntime = options.wasmRuntime;
  if (!wasmRuntime) {
    return undefined;
  }
  if (pathPoints.length < 2) {
    return undefined;
  }
  if (!oneClickClearPathFollowsGraphRule(options, pathPoints)) {
    return undefined;
  }
  const graphPoints = pathPoints.map((point) => imageToGraphPoint(point, options.bounds, options.boundsRect));
  const soldierCenter = graphPoints[0];
  if (!soldierCenter) {
    return undefined;
  }
  const validationTargets = createOneClickClearValidationTargets(options, targetSequence, true);
  const targetControlPoints = createOneClickClearTargetControlPoints(options, targetSequence);
  const qualityPoints = graphPoints.filter((_point, index) => {
    const sourcePoint = pathPoints[index];
    return (
      index > 0 &&
      sourcePoint !== undefined &&
      !targetControlPoints.some((targetPoint) => pixelPointsEqual(targetPoint, sourcePoint))
    );
  });
  const trackedTargets = trackActualHits
    ? createOneClickClearTrackedTargets(options, {
        pathPoints: [...pathPoints],
        targetSequence: [...targetSequence],
      })
    : [];
  const outcome = runGraphwarWasmOneClickTrajectoryValidation(wasmRuntime, {
    descriptor: {
      bounds: options.bounds,
      points: graphPoints,
      settings: options.formulaMode.settings,
      soldierCenter,
    },
    stop: {
      boundsRect: options.boundsRect,
      collision: options.simulationMask
        ? {
            boundaryExpansion: options.simulationBoundaryExpansion,
            mask: options.simulationMask,
            type: "mask",
          }
        : { type: "none" },
      continueAfterTargetsUntilGraphX: { type: "none" },
      orderedTargets: validationTargets.orderedTargets,
      qualityPoints,
      requiredTargets: validationTargets.requiredTargets,
      shouldCollectVisiblePixels: true,
      shouldStopOnTargetsComplete: !trackActualHits,
      trackedTargets: trackedTargets.map((target) => target.hitCircle),
      type: "targets",
    },
  });
  if (!outcome) {
    return undefined;
  }

  const { formula, trajectory } = outcome;
  const signProtection = trajectory.continuationEvidence.observedSignProtection;
  const formulaPoints = formula.formulaPoints.map((point) => createGraphPoint(point.x, point.y));
  const stepOverflowProtectionRange = createStepOverflowProtectionRange(options.bounds, formulaPoints);
  const formulaEvaluation = {
    equation: options.formulaMode.settings.equation,
    formulaDecimalPlaces: options.formulaMode.settings.decimalPlaces,
    isStepOverflowProtectionEnabled: options.formulaMode.settings.isStepOverflowProtectionEnabled,
    signProtection,
    stepOverflowProtectionRange,
  };
  const formulaContext: GraphwarTrajectoryFormulaContext = {
    compiledMaterials: formula.compiledMaterials,
    formulaEvaluation,
    formulaPoints,
    formulaResult: buildFormula(
      formulaPoints,
      options.formulaMode.settings.steepness,
      options.formulaMode.settings.equation,
      options.formulaMode.settings.algorithm,
      options.formulaMode.settings.decimalPlaces,
      {
        compiledMaterials: formula.compiledMaterials,
        signProtection,
        isStepOverflowProtectionEnabled: options.formulaMode.settings.isStepOverflowProtectionEnabled,
        stepOverflowProtectionRange,
      },
    ),
    ...(trajectory.launchAngleRadians === undefined ? {} : { launchAngleRadians: trajectory.launchAngleRadians }),
    settings: options.formulaMode.settings,
    signProtection,
    soldierCenter,
  };
  const requiredCount = validationTargets.requiredTargets.length;
  const orderedCount = validationTargets.orderedTargets.length;
  const targetCountsComplete =
    trajectory.reachedRequiredTargetCount >= requiredCount && trajectory.reachedTargetCount >= orderedCount;
  const obstacleSampleIndex = trajectory.obstacle.type === "hit" ? trajectory.obstacle.sampleIndex : -1;
  const reachesTargetSequenceBeforeObstacle =
    targetCountsComplete &&
    (obstacleSampleIndex < 0 || (trajectory.targetHitIndex >= 0 && trajectory.targetHitIndex <= obstacleSampleIndex));
  const reachedTargetCount = Math.min(
    targetSequence.length,
    Math.max(
      0,
      trajectory.reachedRequiredTargetCount + trajectory.reachedTargetCount - validationTargets.prefixTargetCount,
    ),
  );
  const trajectoryPoints = snapshotGraphwarVisibleTrajectoryPoints(
    trajectory.visiblePixels,
    trajectory.obstacle.type === "hit" ? trajectory.obstacle.sampleIndex : -1,
    options.debugMetrics,
  );
  return {
    formulaContext,
    ...(trajectory.pathError === undefined ? {} : { pathError: trajectory.pathError }),
    reachedTargetCount,
    reachesTargetSequenceBeforeObstacle,
    trackedTargetHitIndexes: trajectory.trackedTargetHitIndexes,
    trackedTargets,
    trajectoryPoints,
  };
}

/** Deletes points by repeatedly asking the same WASM trajectory core to prove the shortened path. */
async function optimizeOneClickClearPathWithWasm(
  context: OneClickClearSearchContext,
  route: OneClickClearRoute,
  workUnits: number,
) {
  const options = context.options;
  const finalTarget = route.targetSequence.at(-1);
  if (!options.wasmRuntime || !finalTarget || route.pathPoints.length < 2) {
    return { route, workUnits };
  }
  const graphPoints = route.pathPoints.map((point) => imageToGraphPoint(point, options.bounds, options.boundsRect));
  const soldierCenter = graphPoints[0];
  if (!soldierCenter) {
    return { route, workUnits };
  }
  const validationTargets = createOneClickClearValidationTargets(options, route.targetSequence, true);
  const targetControlPoints = createOneClickClearTargetControlPoints(options, route.targetSequence);
  const qualityPoints = graphPoints.filter((_point, index) => {
    const sourcePoint = route.pathPoints[index];
    return (
      index > 0 &&
      sourcePoint !== undefined &&
      !targetControlPoints.some((targetPoint) => pixelPointsEqual(targetPoint, sourcePoint))
    );
  });
  const smartInput = {
    allowTerminalPointDeletion: true,
    isDeleteOptimizationEnabled: true,
    points: route.pathPoints,
    sourcePointCount: options.pathPoints.length,
    target: finalTarget.hitCircle.center,
    targetRadius: finalTarget.hitCircle.radius,
    trajectoryValidation: {
      descriptor: {
        bounds: options.bounds,
        points: graphPoints,
        settings: options.formulaMode.settings,
        soldierCenter,
      },
      stop: {
        boundsRect: options.boundsRect,
        collision: options.simulationMask
          ? {
              boundaryExpansion: options.simulationBoundaryExpansion,
              mask: options.simulationMask,
              type: "mask",
            }
          : { type: "none" },
        continueAfterTargetsUntilGraphX: { type: "none" },
        orderedTargets: validationTargets.orderedTargets,
        qualityPoints,
        requiredTargets: validationTargets.requiredTargets,
        shouldCollectVisiblePixels: false,
        shouldStopOnTargetsComplete: true,
        trackedTargets: [],
        type: "targets",
      },
      type: "trajectory",
    },
  } satisfies Parameters<typeof runGraphwarWasmSmartPathfinding>[1];
  const isStatefulStep = options.formulaMode.contract.pathSearchPolicy.type === "step-stateful";
  const routeContext = isStatefulStep
    ? (() => {
        const model = createGraphwarStepRouteModel(soldierCenter.y, options.formulaMode.settings);
        if (!model) {
          throw new GraphwarWasmFault("abi", "one-click Step smart optimization lost its route model");
        }
        return createOneClickClearStepRouteContext(options, soldierCenter, model);
      })()
    : undefined;
  let optimized;
  try {
    optimized = routeContext
      ? routeContext.runSmartPathfinding(smartInput)
      : runGraphwarWasmSmartPathfinding(options.wasmRuntime, smartInput);
  } finally {
    routeContext?.dispose();
  }
  if (optimized.status !== "success") {
    await yieldOneClickClearControl(options);
    return { route, workUnits };
  }
  await yieldOneClickClearControl(options);
  return {
    route: {
      ...route,
      pathPoints: optimized.points.map(({ x, y }) => createPixelPoint(x, y)),
    },
    workUnits: workUnits + Math.max(1, optimized.removedPointCount),
  };
}

/** 当前已有路径必须能先命中尾点；追加清图路线前先挡住已经无效的前缀。 */
function validateOneClickClearPrefix(options: GraphwarOneClickClearSearchOptions) {
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
    formulaMode: options.formulaMode,
    obstacleMask: options.simulationMask,
    points: options.pathPoints,
    targetControlPoints: options.pathPoints.slice(-1),
    targetHitRadiusPixels: target.radius,
    targetCircles: [target],
    targetPoints: [target.center],
  });
  return result.reachesTargetSequenceBeforeObstacle;
}

/** 收集圆心或安全边缘候选，统一分配后按最终 x 建立普通 DAG 层或邪道扫描层。 */
function collectOneClickClearTargets(options: GraphwarOneClickClearSearchOptions): OneClickClearTarget[] {
  const pathTail = options.pathPoints.at(-1);
  if (!pathTail) {
    return [];
  }

  const boundaryExpansion = Math.max(0, Math.floor(options.simulationBoundaryExpansion));
  const horizontalBoundaryInsetPixels = (boundaryExpansion / GRAPHWAR_PLANE_LENGTH) * options.boundsRect.width;
  const verticalBoundaryInsetPixels = (boundaryExpansion / GRAPHWAR_PLANE_HEIGHT) * options.boundsRect.height;
  // 单个半开矩形直接表达地图边界；目标分配只离散化 x，y 仍保留真实士兵中心。
  const usableRect = {
    height: options.boundsRect.height - verticalBoundaryInsetPixels * 2,
    width: options.boundsRect.width - horizontalBoundaryInsetPixels * 2,
    x: options.boundsRect.x + horizontalBoundaryInsetPixels,
    y: options.boundsRect.y + verticalBoundaryInsetPixels,
  };
  if (usableRect.width <= 0 || usableRect.height <= 0) {
    return [];
  }
  const assignmentCandidates = options.candidates.map((candidate, sourceIndex) => ({
    center: candidate.hitCenter,
    hitRadius: candidate.hitRadius,
    sourceIndex,
  }));
  const targetAssignmentRuntime = options.wasmRuntime;
  const assignedTargets =
    targetAssignmentRuntime && typeof targetAssignmentRuntime.assignOneClickTargets === "function"
      ? assignGraphwarWasmOneClickTargetRoutePoints(targetAssignmentRuntime, {
          boundaryExpansion,
          boundsRect: options.boundsRect,
          candidates: assignmentCandidates,
          isMirrored: !xPlusGoesRight(options.bounds),
          pathTail,
          usableRect,
        })
      : assignGraphwarOneClickClearTargetRoutePoints({
          bounds: options.bounds,
          boundsRect: options.boundsRect,
          candidates: options.candidates.map((candidate, sourceIndex) => ({
            center: candidate.hitCenter,
            hitCircle: candidate,
            hitRadius: candidate.hitRadius,
            sourceIndex,
          })),
          pathTail,
          usableRect,
        }).map((assigned) => ({ sourceIndex: assigned.sourceIndex, routePoint: assigned.routePoint }));
  return assignedTargets.flatMap((assigned) => {
    const candidate = options.candidates[assigned.sourceIndex];
    if (!candidate) {
      throw new GraphwarWasmFault("abi", "one-click target assignment returned an unknown source index");
    }
    const routePoint = createPixelPoint(assigned.routePoint.x, assigned.routePoint.y);
    return [
      {
        ...candidate,
        hitCircle: {
          center: candidate.hitCenter,
          radius: candidate.hitRadius,
        },
        routePoint,
        sortGraphX: imageToGraphPoint(routePoint, options.bounds, options.boundsRect).x,
      },
    ];
  });
}

/** 建立 START 和士兵建路点之间的几何 DAG；Step 必须把累计舍入高度纳入节点标签。 */
async function buildOneClickClearDag(
  context: OneClickClearSearchContext,
  targets: readonly OneClickClearTarget[],
): Promise<OneClickClearDag> {
  const policy = context.options.formulaMode.contract.pathSearchPolicy;
  if (policy.type === "step-glitch") {
    throw new Error("Step-glitch must use its scanner instead of the ordinary DAG");
  }
  if (policy.type === "step-stateful") {
    const dag = await buildOneClickClearStepDag(context, targets);
    return applyWasmPreferredStepDagPath(context, dag);
  }
  return buildOneClickClearStatelessDag(context, targets);
}

/** Stateless route 的后继只由目标坐标决定，使用一目标一节点的静态 DAG。 */
async function buildOneClickClearStatelessDag(
  context: OneClickClearSearchContext,
  targets: readonly OneClickClearTarget[],
): Promise<OneClickClearDag> {
  const options = context.options;
  if (options.wasmRuntime) {
    return buildOneClickClearStatelessDagWithWasm(context, targets);
  }
  const startPoint = options.pathPoints.at(-1) ?? options.pathPoints[0];
  const edges: OneClickClearDagEdge[] = [];
  const nodes = targets.map<Extract<OneClickClearDagNode, { type: "stateless" }>>((_, targetIndex) => ({
    id: targetIndex,
    targetIndex,
    type: "stateless",
  }));
  const nodesByTargetIndex: OneClickClearDagNode[][] = nodes.map((node) => [node]);
  const outgoingEdges = new Map<number, OneClickClearDagEdge[]>();
  const typescriptJobs = collectOneClickClearStatelessDagEdgeBuildJobs(startPoint, targets, nodes);
  const result = await buildOneClickClearDagEdgeRoutes(context, typescriptJobs);
  emitOneClickClearDebugTimings(options, result.timings);

  const routesByJobId = new Map(result.routes.map((route) => [route.jobId, route]));
  const edgesByJobId = new Map<number, OneClickClearDagEdge>();
  for (const job of typescriptJobs) {
    const route = routesByJobId.get(job.id);
    const targetNode = nodes[job.to];
    if (route?.type === "stateless" && targetNode) {
      addOneClickClearDagEdge(options, edges, outgoingEdges, job.from, targetNode.id, route.route);
      const edge = edges.at(-1);
      if (!edge || edgesByJobId.has(job.id)) {
        throw new GraphwarWasmFault("abi", "one-click stateless edge identity is duplicated or missing");
      }
      edgesByJobId.set(job.id, edge);
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

/**
 * Effective WASM stateless composition. The retained session owns target order, implicit DAG/job descriptors, and
 * longest-path selection. TypeScript only dispatches the returned jobs to edge Workers and materializes validated edge
 * routes for the independent cold validation backend.
 */
async function buildOneClickClearStatelessDagWithWasm(
  context: OneClickClearSearchContext,
  targets: readonly OneClickClearTarget[],
): Promise<OneClickClearDag> {
  const options = context.options;
  const wasmRuntime = options.wasmRuntime;
  if (!wasmRuntime) {
    throw new GraphwarWasmFault("abi", "one-click WASM runtime disappeared before stateless composition");
  }
  const composition = beginGraphwarWasmOneClickClear(wasmRuntime, {
    candidates: targets.map((target) => ({
      hitCenter: target.routePoint,
      hitRadius: target.hitCircle.radius,
      isEnemy: true,
    })),
    isDeleteOptimizationEnabled: options.isDeleteOptimizationEnabled,
    isStepStateful: false,
    isTargetOrderDescending: !xPlusGoesRight(options.bounds),
    path: options.pathPoints,
    requestNonce: options.wasmRequestNonce ?? 1,
    targetOrderKeys: createOneClickClearWasmTargetOrderKeys(options, targets),
    verticalVariationScale: calculateOneClickClearVerticalVariationScale(options),
  });
  if (composition.status !== "waiting-edge-batch") {
    return {
      edges: [],
      nodes: [],
      nodesByTargetIndex: [],
      outgoingEdges: new Map(),
      targets: [],
    };
  }

  try {
    const orderedTargets = composition.targetOrder.map((targetIndex) => {
      const target = targets[targetIndex];
      if (!target) {
        throw new GraphwarWasmFault("abi", "one-click WASM target order references an unknown target");
      }
      return target;
    });
    assertOneClickClearWasmStatelessJobDescriptors(composition.edgeJobs, orderedTargets, options.pathPoints);
    const nodes = orderedTargets.map<Extract<OneClickClearDagNode, { type: "stateless" }>>((_, targetIndex) => ({
      id: targetIndex,
      targetIndex,
      type: "stateless",
    }));
    const nodesByTargetIndex: OneClickClearDagNode[][] = nodes.map((node) => [node]);
    const edges: OneClickClearDagEdge[] = [];
    const outgoingEdges = new Map<number, OneClickClearDagEdge[]>();
    const jobs = composition.edgeJobs.map<GraphwarOneClickClearDagEdgeBuildJob>((job) => ({
      from: job.from,
      id: job.id,
      startPoint: createPixelPoint(job.startPoint.x, job.startPoint.y),
      targetPoint: createPixelPoint(job.targetPoint.x, job.targetPoint.y),
      to: job.to,
      type: "stateless",
    }));

    const result = await buildOneClickClearDagEdgeRoutes(context, jobs);
    emitOneClickClearDebugTimings(options, result.timings);
    const routesByJobId = new Map(result.routes.map((route) => [route.jobId, route]));
    const edgeResults: GraphwarWasmOneClickEdgeResult[] = jobs.map((job) => {
      const route = routesByJobId.get(job.id);
      return route?.type === "stateless"
        ? {
            jobId: job.id,
            reachable: true,
            requestNonce: composition.handle.requestNonce,
            route: route.route,
            sessionNonce: composition.handle.nonce,
          }
        : {
            jobId: job.id,
            reachable: false,
            requestNonce: composition.handle.requestNonce,
            sessionNonce: composition.handle.nonce,
          };
    });
    const composed = composition.handle.resume(edgeResults);
    if (composed.status === "waiting-edge-batch") {
      throw new GraphwarWasmFault("abi", "one-click stateless session returned an unexpected pending batch");
    }

    const edgesByJobId = new Map<number, OneClickClearDagEdge>();
    for (const job of jobs) {
      const route = routesByJobId.get(job.id);
      const targetNode = nodes[job.to];
      if (route?.type !== "stateless" || !targetNode) {
        continue;
      }
      addOneClickClearDagEdge(options, edges, outgoingEdges, job.from, targetNode.id, route.route);
      const edge = edges.at(-1);
      if (!edge || edgesByJobId.has(job.id)) {
        throw new GraphwarWasmFault("abi", "one-click stateless edge identity is duplicated or missing");
      }
      edgesByJobId.set(job.id, edge);
    }
    const preferredEdgeIds =
      composed.status === "complete" && composed.selectedEdgeIds.length > 0
        ? mapOneClickClearSelectedJobIdsToEdgeIds(composed.selectedEdgeIds, edgesByJobId)
        : undefined;
    return {
      edges,
      nodes,
      nodesByTargetIndex,
      outgoingEdges,
      ...(preferredEdgeIds ? { preferredEdgeIds } : {}),
      targets: [...orderedTargets],
    };
  } finally {
    composition.handle.cancel();
  }
}

/** Maps validated WASM job identities to compact IDs of reachable DAG edges. */
function mapOneClickClearSelectedJobIdsToEdgeIds(
  selectedJobIds: readonly number[],
  edgesByJobId: ReadonlyMap<number, OneClickClearDagEdge>,
) {
  if (selectedJobIds.length === 0) {
    throw new GraphwarWasmFault("abi", "one-click stateless composition selected no edge");
  }
  const selectedEdgeIds: number[] = [];
  const seenJobIds = new Set<number>();
  let previousNode = START_NODE_INDEX;
  for (const jobId of selectedJobIds) {
    if (seenJobIds.has(jobId)) {
      throw new GraphwarWasmFault("abi", "one-click stateless composition selected a duplicate edge");
    }
    seenJobIds.add(jobId);
    const edge = edgesByJobId.get(jobId);
    if (!edge || !edge.active) {
      throw new GraphwarWasmFault("abi", "one-click stateless composition selected an unreachable edge");
    }
    if (edge.from !== previousNode) {
      throw new GraphwarWasmFault("abi", "one-click stateless composition selected a discontinuous chain");
    }
    selectedEdgeIds.push(edge.id);
    previousNode = edge.to;
  }
  return selectedEdgeIds;
}

/** Validates that a retained composition session still describes the caller's exact DAG jobs. */
function assertOneClickClearWasmDagJobDescriptors(
  actualJobs: readonly GraphwarWasmOneClickEdgeJob[],
  expectedJobs: readonly GraphwarWasmOneClickDagJob[],
  message: string,
) {
  if (actualJobs.length !== expectedJobs.length) {
    throw new GraphwarWasmFault("abi", `${message} changed job count`);
  }
  for (const [index, actual] of actualJobs.entries()) {
    const expected = expectedJobs[index];
    if (
      !expected ||
      actual.id !== expected.id ||
      actual.from !== expected.from ||
      actual.to !== expected.to ||
      actual.fromNodeId !== expected.fromNodeId ||
      actual.toNodeId !== expected.toNodeId ||
      actual.startPoint.x !== expected.startPoint.x ||
      actual.startPoint.y !== expected.startPoint.y ||
      actual.targetPoint.x !== expected.targetPoint.x ||
      actual.targetPoint.y !== expected.targetPoint.y
    ) {
      throw new GraphwarWasmFault("abi", `${message} changed job descriptor ${index}`);
    }
  }
}

/** Validates implicit stateless jobs against the ordered target and source-path identities. */
function assertOneClickClearWasmStatelessJobDescriptors(
  jobs: readonly GraphwarWasmOneClickEdgeJob[],
  orderedTargets: readonly OneClickClearTarget[],
  sourcePath: readonly PixelPoint[],
) {
  const sourcePoint = sourcePath.at(-1) ?? sourcePath[0];
  for (const [index, job] of jobs.entries()) {
    if (job.id !== index || job.to < 0 || job.to >= orderedTargets.length) {
      throw new GraphwarWasmFault("abi", "one-click stateless WASM job identity is invalid");
    }
    const target = orderedTargets[job.to];
    const expectedStart =
      job.from === START_NODE_INDEX ? sourcePoint : job.from >= 0 ? orderedTargets[job.from]?.routePoint : undefined;
    if (
      !target ||
      !expectedStart ||
      job.startPoint.x !== expectedStart.x ||
      job.startPoint.y !== expectedStart.y ||
      job.targetPoint.x !== target.routePoint.x ||
      job.targetPoint.y !== target.routePoint.y ||
      (job.fromNodeId !== undefined && job.fromNodeId !== (job.from === START_NODE_INDEX ? 0xffff_ffff : job.from)) ||
      (job.toNodeId !== undefined && job.toNodeId !== job.to)
    ) {
      throw new GraphwarWasmFault("abi", `one-click stateless WASM job ${index} changed endpoint identity`);
    }
  }
}

/** 枚举 stateless route 的静态候选边；node id 按目标顺序创建，保持原有稳定顺序。 */
function collectOneClickClearStatelessDagEdgeBuildJobs(
  startPoint: PixelPoint,
  targets: readonly OneClickClearTarget[],
  nodes: readonly Extract<OneClickClearDagNode, { type: "stateless" }>[],
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
      type: "stateless",
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
        type: "stateless",
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
  type StepDagNode = Extract<OneClickClearDagNode, { type: "step-stateful" }>;
  const nodes: StepDagNode[] = [];
  const nodesByTargetIndex = Array.from({ length: targets.length }, (): StepDagNode[] => []);
  const wasmStateEvidence: GraphwarWasmOneClickStepStateEvidence[] = [];
  const typescriptNodesByTargetState = options.wasmRuntime
    ? undefined
    : Array.from({ length: targets.length }, (): Map<string, StepDagNode> => new Map());
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
    const successfulRoutes = jobs.flatMap((job) => {
      const builtRoute = routesByJobId.get(job.id);
      return builtRoute?.type === "step-stateful" && isGraphwarOneClickClearStepRouteState(builtRoute.stepRouteEndState)
        ? [{ builtRoute, job }]
        : [];
    });
    if (options.wasmRuntime) {
      const batchEvidence = successfulRoutes.map<GraphwarWasmOneClickStepStateEvidence>(({ builtRoute, job }) => ({
        resolvedStateKey: builtRoute.stepRouteEndState.resolvedStateKey,
        resolvedY: builtRoute.stepRouteEndState.resolvedY,
        targetIndex: job.to,
      }));
      const interned = internGraphwarWasmOneClickStepStates(options.wasmRuntime, [
        ...wasmStateEvidence,
        ...batchEvidence,
      ]);
      const previousEvidenceCount = wasmStateEvidence.length;
      if (interned.nodeIds.length !== previousEvidenceCount + batchEvidence.length) {
        throw new GraphwarWasmFault("abi", "one-click Step state dedup returned an incomplete mapping");
      }
      for (const [index, evidence] of batchEvidence.entries()) {
        const nodeId = interned.nodeIds[previousEvidenceCount + index];
        if (nodeId === undefined) {
          throw new GraphwarWasmFault("abi", "one-click Step state dedup returned a missing node id");
        }
        let targetNode = nodes[nodeId];
        if (!targetNode) {
          if (nodeId !== nodes.length) {
            throw new GraphwarWasmFault("abi", "one-click Step state dedup returned a sparse node id");
          }
          targetNode = {
            id: nodeId,
            stepRouteState: { resolvedStateKey: evidence.resolvedStateKey, resolvedY: evidence.resolvedY },
            targetIndex: evidence.targetIndex,
            type: "step-stateful",
          };
          nodes.push(targetNode);
          nodesByTargetIndex[evidence.targetIndex]?.push(targetNode);
          wasmStateEvidence.push(evidence);
        } else if (
          targetNode.targetIndex !== evidence.targetIndex ||
          targetNode.stepRouteState.resolvedStateKey !== evidence.resolvedStateKey ||
          !Object.is(targetNode.stepRouteState.resolvedY, evidence.resolvedY)
        ) {
          throw new GraphwarWasmFault("abi", "one-click Step state dedup changed node evidence");
        }
        const route = successfulRoutes[index]?.builtRoute.route;
        const job = successfulRoutes[index]?.job;
        if (!route || !job) {
          throw new GraphwarWasmFault("abi", "one-click Step state dedup lost route evidence");
        }
        addOneClickClearDagEdge(options, edges, outgoingEdges, job.from, targetNode.id, route);
      }
      return;
    }
    for (const { builtRoute, job } of successfulRoutes) {
      const stepRouteEndState = builtRoute.stepRouteEndState;
      const stateNodes = typescriptNodesByTargetState?.[job.to];
      const targetNodes = nodesByTargetIndex[job.to];
      if (!stateNodes || !targetNodes) {
        continue;
      }
      let targetNode = stateNodes.get(stepRouteEndState.resolvedStateKey);
      if (!targetNode) {
        targetNode = {
          id: nodes.length,
          stepRouteState: stepRouteEndState,
          targetIndex: job.to,
          type: "step-stateful",
        };
        nodes.push(targetNode);
        targetNodes.push(targetNode);
        stateNodes.set(stepRouteEndState.resolvedStateKey, targetNode);
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
      startPoint,
      stepRouteStartState: startState,
      targetPoint: target.routePoint,
      to: targetIndex,
      type: "step-stateful",
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
        const stepRouteStartState = sourceNode.stepRouteState;
        for (let targetIndex = layerEnd; targetIndex < targets.length; targetIndex += 1) {
          const target = targets[targetIndex];
          if (!target || !graphXAdvancesStrictly(sourceTarget.sortGraphX, target.sortGraphX)) {
            continue;
          }
          jobs.push({
            from: sourceNode.id,
            id: nextJobId,
            startPoint: sourceTarget.routePoint,
            stepRouteStartState,
            targetPoint: target.routePoint,
            to: targetIndex,
            type: "step-stateful",
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

/** Re-selects an active stateful DAG after a formula-invalid edge is removed. */
async function selectOneClickClearStepDagPathWithWasm(
  context: OneClickClearSearchContext,
  dag: OneClickClearDag,
): Promise<OneClickClearDagEdge[] | undefined> {
  const options = context.options;
  const wasmRuntime = options.wasmRuntime;
  const activeEdges = dag.edges.filter((edge) => edge.active);
  if (!wasmRuntime || dag.nodes.some((node) => node.type !== "step-stateful")) {
    return undefined;
  }
  if (activeEdges.length === 0) {
    return [];
  }

  const edgesByJobId = new Map<number, OneClickClearDagEdge>();
  const dagJobs = activeEdges.map<GraphwarWasmOneClickDagJob>((edge, id) => {
    const fromNode = edge.from === START_NODE_INDEX ? undefined : dag.nodes[edge.from];
    const toNode = dag.nodes[edge.to];
    const startPoint = edge.route[0];
    const targetPoint = edge.route.at(-1);
    if (!toNode || toNode.type !== "step-stateful" || !startPoint || !targetPoint) {
      throw new GraphwarWasmFault("abi", "stateful one-click retry lost its edge identity");
    }
    if (edge.from !== START_NODE_INDEX && (!fromNode || fromNode.type !== "step-stateful")) {
      throw new GraphwarWasmFault("abi", "stateful one-click retry lost its source node identity");
    }
    edgesByJobId.set(id, edge);
    if (edge.from === START_NODE_INDEX) {
      return {
        from: START_NODE_INDEX,
        fromNodeId: 0xffff_ffff,
        id,
        startPoint,
        targetPoint,
        to: toNode.targetIndex,
        toNodeId: toNode.id,
      };
    }
    if (!fromNode) {
      throw new GraphwarWasmFault("abi", "stateful one-click retry lost its source node identity");
    }
    return {
      from: fromNode.targetIndex,
      fromNodeId: fromNode.id,
      id,
      startPoint,
      targetPoint,
      to: toNode.targetIndex,
      toNodeId: toNode.id,
    };
  });

  const composition = beginGraphwarWasmOneClickClear(wasmRuntime, {
    candidates: dag.targets.map((target) => ({
      hitCenter: target.routePoint,
      hitRadius: target.hitCircle.radius,
      isEnemy: true,
    })),
    dagJobs,
    isDeleteOptimizationEnabled: options.isDeleteOptimizationEnabled,
    isStepStateful: true,
    isTargetOrderDescending: !xPlusGoesRight(options.bounds),
    path: options.pathPoints,
    requestNonce: options.wasmRequestNonce ?? 1,
    targetOrderKeys: createOneClickClearWasmTargetOrderKeys(options, dag.targets),
    verticalVariationScale: calculateOneClickClearVerticalVariationScale(options),
  });
  if (composition.status !== "waiting-edge-batch") {
    return [];
  }
  try {
    if (composition.targetOrder.some((targetIndex, index) => targetIndex !== index)) {
      throw new GraphwarWasmFault("abi", "stateful one-click retry changed DAG ordering");
    }
    assertOneClickClearWasmDagJobDescriptors(composition.edgeJobs, dagJobs, "stateful one-click retry");
    const result = composition.handle.resume(
      composition.edgeJobs.map((job) => {
        const edge = edgesByJobId.get(job.id);
        return edge
          ? {
              jobId: job.id,
              reachable: true,
              requestNonce: composition.handle.requestNonce,
              route: edge.route,
              sessionNonce: composition.handle.nonce,
            }
          : {
              jobId: job.id,
              reachable: false,
              requestNonce: composition.handle.requestNonce,
              sessionNonce: composition.handle.nonce,
            };
      }),
    );
    if (result.status === "waiting-edge-batch") {
      throw new GraphwarWasmFault("abi", "stateful one-click retry returned an unexpected edge batch");
    }
    if (result.status !== "complete" || result.selectedEdgeIds.length === 0) {
      return [];
    }
    return mapOneClickClearSelectedJobIdsToEdgeIds(result.selectedEdgeIds, edgesByJobId).flatMap((edgeId) =>
      dag.edges[edgeId] ? [dag.edges[edgeId]] : [],
    );
  } finally {
    composition.handle.cancel();
  }
}

/** Lets WASM choose the target chain while retaining the state-labelled Step edges for validation. */
async function applyWasmPreferredStepDagPath(
  context: OneClickClearSearchContext,
  dag: OneClickClearDag,
): Promise<OneClickClearDag> {
  const options = context.options;
  if (!options.wasmRuntime || dag.edges.length === 0) {
    return dag;
  }
  const dagJobs = dag.edges.map<GraphwarWasmOneClickDagJob>((edge, id) => {
    const fromNode = edge.from === START_NODE_INDEX ? undefined : dag.nodes[edge.from];
    const toNode = dag.nodes[edge.to];
    const startPoint = edge.route[0];
    const targetPoint = edge.route.at(-1);
    if (!toNode || !startPoint || !targetPoint || (edge.from !== START_NODE_INDEX && !fromNode)) {
      throw new GraphwarWasmFault("abi", "stateful one-click DAG edge lost its node or endpoint identity");
    }
    if (edge.from === START_NODE_INDEX) {
      return {
        from: START_NODE_INDEX,
        fromNodeId: 0xffff_ffff,
        id,
        startPoint,
        targetPoint,
        to: toNode.targetIndex,
        toNodeId: toNode.id,
      };
    }
    if (!fromNode) {
      throw new GraphwarWasmFault("abi", "stateful one-click DAG edge lost its source node identity");
    }
    return {
      from: fromNode.targetIndex,
      fromNodeId: fromNode.id,
      id,
      startPoint,
      targetPoint,
      to: toNode.targetIndex,
      toNodeId: toNode.id,
    };
  });
  const composition = beginGraphwarWasmOneClickClear(options.wasmRuntime, {
    candidates: dag.targets.map((target) => ({
      hitCenter: target.routePoint,
      hitRadius: target.hitCircle.radius,
      isEnemy: true,
    })),
    isDeleteOptimizationEnabled: options.isDeleteOptimizationEnabled,
    isStepStateful: true,
    isTargetOrderDescending: !xPlusGoesRight(options.bounds),
    path: options.pathPoints,
    requestNonce: options.wasmRequestNonce ?? 1,
    targetOrderKeys: createOneClickClearWasmTargetOrderKeys(options, dag.targets),
    verticalVariationScale: calculateOneClickClearVerticalVariationScale(options),
    dagJobs,
  });
  if (composition.status !== "waiting-edge-batch") {
    return dag;
  }

  // Explicit state-node identities keep duplicate target pairs distinct. The
  // adapter has already checked the descriptor, but the target order remains a
  // caller-owned identity that must match the retained DAG before publication.
  if (
    composition.targetOrder.some((targetIndex, index) => targetIndex !== index) ||
    composition.edgeJobs.length !== dagJobs.length ||
    composition.edgeJobs.some((job, index) => {
      const expected = dagJobs[index];
      return (
        !expected ||
        job.id !== expected.id ||
        job.from !== expected.from ||
        job.to !== expected.to ||
        job.fromNodeId !== expected.fromNodeId ||
        job.toNodeId !== expected.toNodeId
      );
    })
  ) {
    composition.handle.cancel();
    return dag;
  }

  const session = composition.handle;
  const edgesByJobId = new Map(dag.edges.map((edge, id) => [id, edge]));
  const edgesForJobs = composition.edgeJobs.map((job) => {
    return edgesByJobId.get(job.id);
  });
  if (edgesForJobs.some((edge) => edge === undefined)) {
    session.cancel();
    return dag;
  }
  try {
    const edgeResults: GraphwarWasmOneClickEdgeResult[] = composition.edgeJobs.map((job, index) => {
      const edge = edgesForJobs[index];
      return edge
        ? {
            jobId: job.id,
            reachable: true,
            requestNonce: session.requestNonce,
            route: edge.route,
            sessionNonce: session.nonce,
          }
        : {
            jobId: job.id,
            reachable: false,
            requestNonce: session.requestNonce,
            sessionNonce: session.nonce,
          };
    });
    const result = session.resume(edgeResults);
    if (result.status === "waiting-edge-batch") {
      throw new GraphwarWasmFault("abi", "stateful one-click WASM session returned an unexpected edge batch");
    }
    if (result.status === "complete") {
      const preferredEdgeIds = mapOneClickClearSelectedJobIdsToEdgeIds(result.selectedEdgeIds, edgesByJobId);
      if (preferredEdgeIds.length > 0) {
        return { ...dag, preferredEdgeIds };
      }
    }
    return dag;
  } finally {
    session.cancel();
  }
}

/** 目标分配已经按该统一 forward 列排序；把相同量化列身份显式带入 WASM。 */
function createOneClickClearWasmTargetOrderKeys(
  options: Pick<GraphwarOneClickClearOptions, "bounds" | "boundsRect">,
  targets: readonly Pick<OneClickClearTarget, "routePoint">[],
) {
  const isMirrored = !xPlusGoesRight(options.bounds);
  return targets.map((target) =>
    planeColumnToForwardColumn(
      imageXToNearestPlaneColumn(target.routePoint.x, options.boundsRect, isMirrored),
      isMirrored,
    ),
  );
}

/** 从第一条用户路径点开始逐段结算，得到 START 续接新边时的 canonical Step 状态。 */
function resolveOneClickClearStepStartState(options: GraphwarOneClickClearSearchOptions) {
  const settings = options.formulaMode.settings;
  const graphPoints = options.pathPoints.map((point) => imageToGraphPoint(point, options.bounds, options.boundsRect));
  const firstPoint = graphPoints[0];
  if (!firstPoint) {
    return undefined;
  }

  if (options.wasmRuntime) {
    const model = createGraphwarStepRouteModel(firstPoint.y, settings);
    if (!model) {
      return undefined;
    }
    const routeContext = createOneClickClearStepRouteContext(options, firstPoint, model);
    try {
      const stepRoute = routeContext.stepRoute;
      if (!stepRoute) {
        throw new GraphwarWasmFault("abi", "one-click Step start-state context lost its route model");
      }
      let state = { resolvedY: firstPoint.y, routeStateKey: "0" };
      for (let index = 1; index < graphPoints.length; index += 1) {
        const previous = graphPoints[index - 1];
        const next = graphPoints[index];
        if (!previous || !next) {
          return undefined;
        }
        const transition = stepRoute.evaluateTransition(previous, next, state);
        if (transition.type !== "success") {
          return undefined;
        }
        state = transition.transition.routeState;
      }
      return { resolvedStateKey: state.routeStateKey, resolvedY: state.resolvedY };
    } finally {
      routeContext.dispose();
    }
  }

  const resolved = resolveStepFormula(
    graphPoints,
    settings.formulaPathSteepness ?? settings.steepness,
    settings.equation,
    { formulaDecimalPlaces: settings.decimalPlaces },
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

/** Creates the retained Step route context used by start-state and smart-composition validation. */
function createOneClickClearStepRouteContext(
  options: GraphwarOneClickClearSearchOptions,
  routeOriginPoint: ReturnType<typeof imageToGraphPoint>,
  model: NonNullable<ReturnType<typeof createGraphwarStepRouteModel>>,
): GraphwarWasmRouteContext {
  if (!options.wasmRuntime) {
    throw new GraphwarWasmFault("abi", "one-click Step route context requires a WASM runtime");
  }
  return createGraphwarWasmRouteContext(options.wasmRuntime, {
    boundaryExpansion: options.boundaryExpansion,
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    routeOriginPoint,
    routeTolerancePlanePixels: options.routeMask.routeTolerancePlanePixels,
    sourceMask: options.routeMask.mask,
    sourceMaskType: "route",
    stepRouteModel: {
      decimalPlaces: model.decimalPlaces,
      equation: model.equation,
      formulaSteepness: model.formulaSteepness,
      originY: model.originY,
      qualityTargetPlanePixels: graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
    },
  });
}

/** 批量建立 DAG 边，并允许外部 runner 并行执行几何寻路。 */
async function buildOneClickClearDagEdgeRoutes(
  context: OneClickClearSearchContext,
  jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[],
): Promise<GraphwarOneClickClearDagEdgeBuildResult> {
  const options = context.options;
  const request = createOneClickClearDagEdgeBuildRequest(options, jobs);
  try {
    return snapshotOneClickClearDagEdgeBuildResult(await options.buildDagEdges(request));
  } catch (error) {
    if (options.isCancelled?.()) {
      return { routes: [], timings: [] };
    }
    throw error;
  }
}

/** 从搜索设置和建边作业生成最小 Worker 请求。 */
function createOneClickClearDagEdgeBuildRequest(
  options: GraphwarOneClickClearSearchOptions,
  jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[],
): GraphwarOneClickClearDagEdgeBuildRequest {
  const settings = options.formulaMode.settings;
  return {
    boundaryExpansion: options.boundaryExpansion,
    bounds: { ...options.bounds },
    boundsRect: { ...options.boundsRect },
    jobs: jobs.map((job) =>
      job.type === "step-stateful"
        ? {
            from: job.from,
            id: job.id,
            startPoint: clonePixelPoint(job.startPoint),
            stepRouteStartState: {
              resolvedStateKey: job.stepRouteStartState.resolvedStateKey,
              resolvedY: job.stepRouteStartState.resolvedY,
            },
            targetPoint: clonePixelPoint(job.targetPoint),
            to: job.to,
            type: job.type,
          }
        : {
            from: job.from,
            id: job.id,
            startPoint: clonePixelPoint(job.startPoint),
            targetPoint: clonePixelPoint(job.targetPoint),
            to: job.to,
            type: job.type,
          },
    ),
    routeMask: options.routeMask.mask.slice(),
    routeOriginPoint: clonePixelPoint(options.pathPoints[0]),
    routeMode: options.routeMode,
    routeTolerancePlanePixels: options.routeMask.routeTolerancePlanePixels,
    settings: {
      algorithm: settings.algorithm,
      decimalPlaces: settings.decimalPlaces,
      equation: settings.equation,
      ...(settings.formulaPathSteepness === undefined ? {} : { formulaPathSteepness: settings.formulaPathSteepness }),
      steepness: settings.steepness,
    },
    workerCount: options.dagEdgeWorkerCount ?? 1,
  };
}

/** Worker/callback 响应进入搜索前复制可变点和明细，避免返回值继续泄漏内部路线引用。 */
function snapshotOneClickClearDagEdgeBuildResult(
  result: GraphwarOneClickClearDagEdgeBuildResult,
): GraphwarOneClickClearDagEdgeBuildResult {
  return {
    routes: result.routes.map((route) => {
      if (route.type === "unreachable") {
        return { jobId: route.jobId, type: route.type };
      }
      if (route.type === "stateless") {
        return { jobId: route.jobId, route: route.route.map(clonePixelPoint), type: route.type };
      }
      return {
        jobId: route.jobId,
        route: route.route.map(clonePixelPoint),
        stepRouteEndState: {
          resolvedStateKey: route.stepRouteEndState.resolvedStateKey,
          resolvedY: route.stepRouteEndState.resolvedY,
        },
        type: route.type,
      };
    }),
    timings: result.timings.map((timing) => ({
      ...(timing.detail ? { detail: { ...timing.detail } } : {}),
      elapsedMs: timing.elapsedMs,
      stage: timing.stage,
    })),
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
  const graphYPerImagePixel = calculateOneClickClearVerticalVariationScale(options);
  let variation = 0;
  for (let index = 1; index < route.length; index += 1) {
    variation += Math.abs(route[index].y - route[index - 1].y) * graphYPerImagePixel;
  }
  return variation;
}

/** Keeps the composition core's per-segment variation in the same Graphwar units as the TS DP. */
function calculateOneClickClearVerticalVariationScale(
  options: Pick<GraphwarOneClickClearOptions, "bounds" | "boundsRect">,
) {
  return Math.abs((options.bounds.maxY - options.bounds.minY) / options.boundsRect.height);
}

/** 在具体状态节点 DAG 上做最长路 DP；同分时依次选点更少、纵向变化更小的稳定路线。 */
function findOneClickClearLongestPath(dag: OneClickClearDag) {
  const preferredPath = reconstructOneClickClearPreferredPath(dag);
  if (preferredPath) {
    return preferredPath;
  }
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

/** Keeps the composition core's stable choice ahead of the TypeScript fallback DP. */
function reconstructOneClickClearPreferredPath(dag: OneClickClearDag) {
  if (!dag.preferredEdgeIds || dag.preferredEdgeIds.length === 0) {
    return undefined;
  }
  const edgesById = new Map(dag.edges.map((edge) => [edge.id, edge]));
  const preferredEdges: OneClickClearDagEdge[] = [];
  let from = START_NODE_INDEX;
  for (const edgeId of dag.preferredEdgeIds) {
    const edge = edgesById.get(edgeId);
    if (!edge || !edge.active || edge.from !== from) {
      return undefined;
    }
    preferredEdges.push(edge);
    from = edge.to;
  }
  return preferredEdges;
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
  let incumbentEvidence: OneClickClearIncumbentEvidence | undefined;
  let pathError: number | undefined;
  let segmentState: OneClickClearRouteSegmentValidationStart = reused?.segmentState ?? { type: "cold" };
  const targetSequence: OneClickClearTarget[] = reused ? [...reused.targetSequence] : [];
  const validatedPrefix = cachedPrefix.slice(0, sharedPrefixLength);
  let validationCount = 0;

  for (let edgeIndex = sharedPrefixLength; edgeIndex < edges.length; edgeIndex += 1) {
    const edge = edges[edgeIndex];
    const targetNode = dag.nodes[edge.to];
    const target = targetNode ? dag.targets[targetNode.targetIndex] : undefined;
    if (!targetNode || !target) {
      context.routeValidationPrefix = validatedPrefix;
      return { failedEdge: edge, type: "failed", validationCount };
    }

    // 边 route 首点已经是当前路径尾点，追加时必须跳过。
    const nextPath = [...pathPoints, ...edge.route.slice(1)];
    validationCount += 1;
    const validation = validateOneClickClearRouteSegment(context, nextPath, [...targetSequence, target], segmentState);
    if (!validation) {
      context.routeValidationPrefix = validatedPrefix;
      return { failedEdge: edge, type: "failed", validationCount };
    }

    pathPoints = nextPath;
    pathError = validation.sampleResult.pathError;
    incumbentEvidence = validation.finalContinuation
      ? {
          finalContinuation: validation.finalContinuation,
          trajectoryPoints: validation.trajectoryPoints,
        }
      : {
          formulaContext: validation.formulaContext,
          trajectoryPoints: validation.trajectoryPoints,
        };
    const continuation =
      context.options.formulaMode.contract.appendPrefixContinuation.type === "physical-continuation"
        ? createGraphwarResolvedTrajectoryContinuationEvidence(
            { context: validation.formulaContext, result: validation.sampleResult },
            {
              reachedRequiredTargetCount: createOneClickClearPreviousTargets([...targetSequence, target]).length,
              reachedTargetCount: 0,
            },
          )
        : undefined;
    segmentState = continuation
      ? {
          evidence: {
            continuation,
            ...(pathError === undefined ? {} : { pathError }),
            sampleResult: validation.sampleResult,
            trajectoryPoints: validation.trajectoryPoints,
          },
          type: "continuation",
        }
      : { type: "cold" };
    targetSequence.push(target);
    validatedPrefix.push({
      edgeId: edge.id,
      pathPoints,
      segmentState,
      targetSequence: [...targetSequence],
    });
    // 独立前缀已被本次 segment 回放证明，后续边失败不会使它失效。
    publishOneClickClearValidatedRoute(context, {
      incumbentEvidence,
      ...(pathError === undefined ? {} : { pathError }),
      pathPoints,
      targetSequence,
    });
  }

  context.routeValidationPrefix = validatedPrefix;

  return {
    route: {
      ...(incumbentEvidence ? { incumbentEvidence } : {}),
      ...(pathError === undefined ? {} : { pathError }),
      pathPoints,
      targetSequence,
    },
    type: "validated",
    validationCount,
  };
}

/** Append-stable 公式只续采样新增段；若保护扩大而 cold replay，完整历史目标会自动重验。 */
function validateOneClickClearRouteSegment(
  context: OneClickClearSearchContext,
  nextPath: readonly PixelPoint[],
  targetSequence: readonly OneClickClearTarget[],
  state: OneClickClearRouteSegmentValidationStart,
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
  const continuationEvidence = state.type === "continuation" ? state.evidence : undefined;
  const reusableEvidence =
    continuationEvidence &&
    graphXAdvancesStrictly(
      continuationEvidence.continuation.start.samplingState.currentPoint.x,
      imageToGraphPoint(currentTarget.routePoint, options.bounds, options.boundsRect).x,
    )
      ? continuationEvidence
      : undefined;
  const reusableStart = reusableEvidence?.continuation.start;
  const reusableInitialState = reusableStart?.samplingState;
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
      formulaMode: options.formulaMode,
      // Append-unstable 公式会反向改变旧段，必须从发射点完整回放并重新命中已有 prefix。
      points: mappedPoints,
      qualityPoints: reusableInitialState
        ? qualityPoints.filter((point) => graphXAdvancesStrictly(reusableInitialState.currentPoint.x, point.x))
        : qualityPoints,
      requiredTargets: validationTargets.requiredTargets,
      start: reusableStart,
      soldierCenter: mappedPoints[0],
      targetSequence: validationTargets.orderedTargets,
    }),
  );
  if (!resolved) {
    return undefined;
  }
  const { context: formulaContext, result, startType } = resolved;
  if (
    result.reachedTargetCount < validationTargets.orderedTargets.length ||
    result.reachedRequiredTargetCount < validationTargets.requiredTargets.length
  ) {
    return undefined;
  }

  const isResumedFromRequestedState = startType === "continuation" && reusableEvidence !== undefined;
  let pathError = isResumedFromRequestedState
    ? result.pathError
    : measureGraphwarFormulaPathError(result.sample.points, qualityPoints, options.bounds);
  if (isResumedFromRequestedState && reusableEvidence?.pathError !== undefined) {
    pathError = pathError === undefined ? reusableEvidence.pathError : Math.max(reusableEvidence.pathError, pathError);
  }
  const previousRequiredTargetsHitIndex =
    isResumedFromRequestedState && reusableEvidence ? reusableEvidence.sampleResult.targetHitIndex : -1;
  const resolvedSampleResult: GraphwarTrajectorySampleResult = {
    ...result,
    requiredTargetsHitIndex:
      previousRequiredTargetsHitIndex >= 0 ? previousRequiredTargetsHitIndex : result.requiredTargetsHitIndex,
    sample:
      isResumedFromRequestedState && reusableEvidence
        ? {
            ...result.sample,
            points: mergeOneClickClearContinuationPoints(
              reusableEvidence.sampleResult.sample.points,
              result.sample.points,
            ),
          }
        : result.sample,
    ...(pathError === undefined ? {} : { pathError }),
    visiblePixels:
      isResumedFromRequestedState && reusableEvidence
        ? mergeOneClickClearContinuationPoints(reusableEvidence.sampleResult.visiblePixels, result.visiblePixels)
        : result.visiblePixels,
  };
  const trajectoryPoints = snapshotGraphwarVisibleTrajectoryPoints(
    resolvedSampleResult.visiblePixels,
    resolvedSampleResult.obstacleHitIndex,
    options.debugMetrics,
  );
  const continuation = createGraphwarResolvedTrajectoryContinuationEvidence({
    context: formulaContext,
    result: resolvedSampleResult,
  });
  const finalContinuation = continuation ? { continuation, prefixResult: resolvedSampleResult } : undefined;

  if (validationTargets.prefixTargetCount === 0) {
    return {
      ...(finalContinuation ? { finalContinuation } : {}),
      formulaContext,
      sampleResult: resolvedSampleResult,
      trajectoryPoints,
    };
  }
  return {
    ...(finalContinuation ? { finalContinuation } : {}),
    formulaContext,
    sampleResult: {
      ...resolvedSampleResult,
      reachedTargetCount: resolvedSampleResult.reachedTargetCount - validationTargets.prefixTargetCount,
    },
    trajectoryPoints,
  };
}

/** 拼接同一条 x+ 轨迹的前后两次采样；模拟器是否重发恢复点由 skipInitialStop 决定。 */
function mergeOneClickClearContinuationPoints<TPoint extends { readonly x: number; readonly y: number }>(
  prefix: readonly TPoint[],
  suffix: readonly TPoint[],
) {
  const prefixEnd = prefix.at(-1);
  const suffixStart = suffix[0];
  const suffixStartIndex =
    prefixEnd && suffixStart && prefixEnd.x === suffixStart.x && prefixEnd.y === suffixStart.y ? 1 : 0;
  return [...prefix, ...suffix.slice(suffixStartIndex)];
}

/** Step 的严格包络是硬边条件；删点和最终安全网都必须重新检查整条候选路径。 */
interface OneClickClearStepRouteValidation {
  readonly invalidSegmentIndex?: number;
  readonly ok: boolean;
}

function validateOneClickClearStepRoute(
  options: GraphwarOneClickClearSearchOptions,
  pathPoints: readonly PixelPoint[],
): OneClickClearStepRouteValidation {
  if (options.formulaMode.contract.pathSearchPolicy.type !== "step-stateful") {
    return { ok: true };
  }
  const validation = options.validateStepRoute?.(pathPoints.map(clonePixelPoint));
  if (validation === undefined) {
    return { ok: false };
  }
  return typeof validation === "boolean" ? { ok: validation } : validation;
}

/** Maps a final Step boundary failure back to the edge that introduced it. */
function findOneClickClearStepRouteFailedEdge(
  options: GraphwarOneClickClearSearchOptions,
  edges: readonly OneClickClearDagEdge[],
  invalidSegmentIndex: number | undefined,
) {
  if (invalidSegmentIndex === undefined) {
    return edges.at(-1);
  }
  let firstEdgeSegmentIndex = Math.max(0, options.pathPoints.length - 1);
  for (const edge of edges) {
    const segmentCount = Math.max(0, edge.route.length - 1);
    if (invalidSegmentIndex >= firstEdgeSegmentIndex && invalidSegmentIndex < firstEdgeSegmentIndex + segmentCount) {
      return edge;
    }
    firstEdgeSegmentIndex += segmentCount;
  }
  return edges.at(-1);
}

function oneClickClearStepRouteIsValid(options: GraphwarOneClickClearSearchOptions, pathPoints: readonly PixelPoint[]) {
  return validateOneClickClearStepRoute(options, pathPoints).ok;
}

/** 返回整条弹道复验结果；routePoint 提供目标采样点，hitCircle 提供真实命中半径。 */
function sampleOneClickClearTargetSequence(
  options: GraphwarOneClickClearSearchOptions,
  route: Pick<OneClickClearRoute, "pathPoints" | "targetSequence">,
  trackActualHits = false,
) {
  const validationTargets = createOneClickClearValidationTargets(options, route.targetSequence, true);
  const lastPathPoint = route.pathPoints.at(-1);
  const targetControlGraphX =
    options.formulaMode.contract.pathSearchPolicy.type === "step-glitch" && lastPathPoint
      ? imageToGraphPoint(lastPathPoint, options.bounds, options.boundsRect).x
      : undefined;
  const trackedTargets = trackActualHits ? createOneClickClearTrackedTargets(options, route) : [];
  const result = sampleGraphwarPathTargetSequence({
    boundaryExpansion: options.simulationBoundaryExpansion,
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    collectVisiblePixels: true,
    debugMetrics: options.debugMetrics,
    formulaMode: options.formulaMode,
    ...(targetControlGraphX === undefined || trackActualHits
      ? {}
      : { continueAfterTargetsUntilGraphX: targetControlGraphX }),
    obstacleMask: options.simulationMask,
    points: route.pathPoints,
    requiredTargets: validationTargets.requiredTargets,
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

/** 将一次成功的完整路径验证提升为该新公式自己的 continuation evidence；不继承删点前的任何状态。 */
function createOneClickClearIncumbentEvidenceFromValidation(
  options: GraphwarOneClickClearSearchOptions,
  route: OneClickClearRoute,
  validation: ReturnType<typeof sampleOneClickClearTargetSequence>,
) {
  const formulaContext = validation.formulaContext;
  if (!formulaContext) {
    return undefined;
  }
  const validationTargets = createOneClickClearValidationTargets(options, route.targetSequence, true);
  const reachedTargetCount = validation.reachedTargetCount + validationTargets.prefixTargetCount;
  const prefixResult: GraphwarTrajectorySampleResult = {
    earlyStopReason: validation.earlyStopReason,
    obstacleHitIndex: validation.obstacleHitIndex,
    reachedRequiredTargetCount: validation.reachedRequiredTargetCount,
    reachedTargetCount,
    requiredTargetsHitIndex: validation.requiredTargetsHitIndex,
    sample: validation.sample,
    ...(validation.pathError === undefined ? {} : { pathError: validation.pathError }),
    targetHitIndex: validation.targetHitIndex,
    trackedTargetHitIndexes: validation.trackedTargetHitIndexes,
    visiblePixels: validation.visiblePixels,
  };
  const continuation = createGraphwarResolvedTrajectoryContinuationEvidence({
    context: formulaContext,
    result: prefixResult,
  });
  if (!continuation) {
    return undefined;
  }
  return {
    finalContinuation: {
      continuation,
      prefixResult,
    },
    trajectoryPoints: snapshotGraphwarVisibleTrajectoryPoints(
      validation.visiblePixels,
      validation.obstacleHitIndex,
      options.debugMetrics,
    ),
  };
}

/**
 * 末目标验证与最终自然回放使用同一路径和公式；路径未改变时从原子前缀证据继续到碰撞或边界。
 *
 * Sign protection 若在后缀扩大，底层 resolver 会自动丢弃 continuation 并 cold replay；此处只在实际从请求状态 继续时拼接前缀。路径删改会由
 * optimizeOneClickClearPath 构造不含 incumbentEvidence 的新 route，因而不会误复用。
 */
function createOneClickClearFinalValidationFromContinuation(
  options: GraphwarOneClickClearSearchOptions,
  route: OneClickClearRoute,
) {
  const incumbentEvidence = route.incumbentEvidence;
  if (!incumbentEvidence || !("finalContinuation" in incumbentEvidence)) {
    return undefined;
  }
  const evidence = incumbentEvidence.finalContinuation;
  if (!evidence) {
    return undefined;
  }
  const resolvedContinuation = evidence.continuation;

  const mappedPoints = route.pathPoints.map((point) => imageToGraphPoint(point, options.bounds, options.boundsRect));
  if (mappedPoints.length < 2) {
    return undefined;
  }
  const validationTargets = createOneClickClearValidationTargets(options, route.targetSequence, true);
  const targetControlPoints = createOneClickClearTargetControlPoints(options, route.targetSequence);
  const qualityPoints = mappedPoints.filter((_point, index) => {
    const sourcePoint = route.pathPoints[index];
    return (
      index > 0 &&
      sourcePoint !== undefined &&
      !targetControlPoints.some((targetPoint) => pixelPointsEqual(targetPoint, sourcePoint))
    );
  });
  const trackedTargets = createOneClickClearTrackedTargets(options, route);
  const trackedTargetCircles = trackedTargets.map((target) => target.hitCircle);
  const collision = {
    boundaryExpansion: options.simulationBoundaryExpansion,
    mask: options.simulationMask,
  };
  const continuation = tryContinueResolvedGraphwarTrajectory({
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    collision,
    collectVisiblePixels: true,
    debugMetrics: options.debugMetrics,
    evidence: resolvedContinuation,
    qualityPoints: qualityPoints.filter((point) =>
      graphXAdvancesStrictly(resolvedContinuation.start.samplingState.currentPoint.x, point.x),
    ),
    requiredTargets: validationTargets.requiredTargets,
    stopOnTargetsComplete: false,
    targetSequence: validationTargets.orderedTargets,
    trackedTargets: trackedTargetCircles,
  });
  if (!continuation) {
    return undefined;
  }

  const prefixResult = evidence.prefixResult;
  let formulaContext = resolvedContinuation.context;
  let finalResult: GraphwarTrajectorySampleResult;
  if (continuation.status === "continued") {
    const suffixResult = continuation.result;
    finalResult = {
      ...suffixResult,
      pathError:
        prefixResult.pathError === undefined
          ? suffixResult.pathError
          : suffixResult.pathError === undefined
            ? prefixResult.pathError
            : Math.max(prefixResult.pathError, suffixResult.pathError),
      requiredTargetsHitIndex:
        prefixResult.requiredTargetsHitIndex >= 0
          ? prefixResult.requiredTargetsHitIndex
          : suffixResult.requiredTargetsHitIndex,
      sample: {
        ...suffixResult.sample,
        points: mergeOneClickClearContinuationPoints(prefixResult.sample.points, suffixResult.sample.points),
      },
      targetHitIndex: prefixResult.targetHitIndex >= 0 ? prefixResult.targetHitIndex : suffixResult.targetHitIndex,
      trackedTargetHitIndexes: mergeOneClickClearTrackedTargetHitIndexes(
        prefixResult.visiblePixels,
        trackedTargets,
        suffixResult.trackedTargetHitIndexes,
      ),
      visiblePixels: mergeOneClickClearContinuationPoints(prefixResult.visiblePixels, suffixResult.visiblePixels),
    };
  } else {
    const cold = tryResolveGraphwarTrajectoryCandidate({
      bounds: options.bounds,
      boundsRect: options.boundsRect,
      collision,
      collectVisiblePixels: true,
      debugMetrics: options.debugMetrics,
      formulaMode: options.formulaMode,
      points: mappedPoints,
      qualityPoints,
      requiredTargets: validationTargets.requiredTargets,
      soldierCenter: mappedPoints[0],
      stopOnTargetsComplete: false,
      targetSequence: validationTargets.orderedTargets,
      trackedTargets: trackedTargetCircles,
    });
    if (!cold) {
      return undefined;
    }
    formulaContext = cold.context;
    finalResult = cold.result;
  }
  const reachesTargetSequenceBeforeObstacle =
    finalResult.reachedTargetCount >= validationTargets.orderedTargets.length &&
    finalResult.reachedRequiredTargetCount >= validationTargets.requiredTargets.length;
  return {
    earlyStopReason: finalResult.earlyStopReason,
    formulaContext,
    obstacleHitIndex: finalResult.obstacleHitIndex,
    reachedRequiredTargetCount: finalResult.reachedRequiredTargetCount,
    reachedTargetCount: countOneClickClearReachedRouteTargets(
      route.targetSequence,
      trackedTargets,
      finalResult.trackedTargetHitIndexes,
    ),
    reachesTargetSequenceBeforeObstacle,
    requiredTargetsHitIndex: finalResult.requiredTargetsHitIndex,
    sample: finalResult.sample,
    ...(finalResult.pathError === undefined ? {} : { pathError: finalResult.pathError }),
    samplePointCount: finalResult.sample.points.length,
    targetHitIndex: finalResult.targetHitIndex,
    trackedTargetHitIndexes: finalResult.trackedTargetHitIndexes,
    trackedTargets,
    visiblePixels: finalResult.visiblePixels,
  };
}

/** 已验证前缀可能命中过最终统计目标；保留首次全局采样下标，后缀只补尚未命中的目标。 */
function mergeOneClickClearTrackedTargetHitIndexes(
  prefixPoints: readonly PixelPoint[],
  trackedTargets: readonly OneClickClearTrackedTarget[],
  suffixHitIndexes: readonly number[],
) {
  return trackedTargets.map((target, targetIndex) => {
    const radiusSquared = target.hitCircle.radius * target.hitCircle.radius;
    for (let pointIndex = 1; pointIndex < prefixPoints.length; pointIndex += 1) {
      const point = prefixPoints[pointIndex];
      if (!point) {
        continue;
      }
      const dx = point.x - target.hitCircle.center.x;
      const dy = point.y - target.hitCircle.center.y;
      if (dx * dx + dy * dy < radiusSquared) {
        return pointIndex;
      }
    }
    return suffixHitIndexes[targetIndex] ?? -1;
  });
}

/** 把末目标自然完整回放提升为最终验证；证据不完整或路径已变化时保持 cold fallback。 */
function createOneClickClearFinalValidationFromStepGlitchEvidence(
  options: GraphwarOneClickClearSearchOptions,
  route: OneClickClearRoute,
) {
  const replayEvidence = route.incumbentEvidence;
  const evidence = replayEvidence?.finalValidation;
  const lastPathPoint = route.pathPoints.at(-1);
  if (!evidence || !lastPathPoint) {
    return undefined;
  }

  const trackedTargets = createOneClickClearTrackedTargets(options, route);
  const validationTargets = createOneClickClearValidationTargets(options, route.targetSequence, true);
  const targetControlPoints = createOneClickClearTargetControlPoints(options, route.targetSequence);
  const settings = options.formulaMode.settings;
  const simulationMask = options.simulationMask ?? settings.stepGlitchObstacleMask;
  const result = evidence.result;
  if (
    !simulationMask ||
    !settings.stepGlitchObstacleMask ||
    !graphwarByteArraysEqual(simulationMask, settings.stepGlitchObstacleMask) ||
    !graphwarFinalReplaySnapshotMatches(evidence, {
      boundaryExpansion: options.simulationBoundaryExpansion,
      bounds: options.bounds,
      boundsRect: options.boundsRect,
      formulaSettings: settings,
      path: route.pathPoints,
      replaySemantics: "full-natural-visible",
      requiredTargets: validationTargets.requiredTargets,
      simulationMask,
      simulationMaskCacheId: options.simulationMaskCacheId,
      targetControlPoints,
      targetSequence: validationTargets.orderedTargets,
      trackedTargets: trackedTargets.map((target) => target.hitCircle),
    })
  ) {
    return undefined;
  }

  const targetControlGraphX = imageToGraphPoint(lastPathPoint, options.bounds, options.boundsRect).x;
  return {
    earlyStopReason: result.earlyStopReason,
    formulaContext: replayEvidence.formulaContext,
    obstacleHitIndex: result.obstacleHitIndex,
    reachedRequiredTargetCount: result.reachedRequiredTargetCount,
    reachedTargetCount: countOneClickClearReachedRouteTargets(
      route.targetSequence,
      trackedTargets,
      result.trackedTargetHitIndexes,
    ),
    reachesTargetSequenceBeforeObstacle: graphwarTrajectoryReachesGraphXAfterTargetsBeforeObstacle(
      result,
      targetControlGraphX,
    ),
    requiredTargetsHitIndex: result.requiredTargetsHitIndex,
    sample: result.sample,
    ...(result.pathError === undefined ? {} : { pathError: result.pathError }),
    samplePointCount: result.sample.points.length,
    targetHitIndex: result.targetHitIndex,
    trackedTargetHitIndexes: result.trackedTargetHitIndexes,
    trackedTargets,
    visiblePixels: result.visiblePixels,
  };
}

/** 把本次 route 的旧目标降为无序要求，当前新增目标继续使用有序命中语义。 */
function createOneClickClearValidationTargets(
  options: GraphwarOneClickClearSearchOptions,
  targetSequence: readonly OneClickClearTarget[],
  includePreviousTargets: boolean,
) {
  const currentTarget = targetSequence.at(-1);
  const requiredTargets = includePreviousTargets ? createOneClickClearPreviousTargets(targetSequence.slice(0, -1)) : [];
  const orderedTargets: GraphwarTrajectoryTargetCircle[] = [];
  let prefixTargetCount = 0;
  // Append-unstable 公式必须重新证明旧尾点；邪道使用自己的完整 prefix evidence contract。
  if (shouldValidateOneClickClearPrefixTarget(options)) {
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
  options: GraphwarOneClickClearSearchOptions,
  targetSequence: readonly OneClickClearTarget[],
) {
  const targetControlPoints = targetSequence.map((target) => target.routePoint);
  const existingPathTarget =
    options.prefixTarget !== undefined || shouldValidateOneClickClearPrefixTarget(options)
      ? options.pathPoints.at(-1)
      : undefined;
  if (existingPathTarget && !targetControlPoints.some((point) => pixelPointsEqual(point, existingPathTarget))) {
    targetControlPoints.unshift(existingPathTarget);
  }
  return targetControlPoints;
}

/** 追加可能反向改变旧公式时，当前已有路径尾目标必须进入每次增量和最终回放。 */
function shouldValidateOneClickClearPrefixTarget(options: GraphwarOneClickClearSearchOptions) {
  return (
    options.pathPoints.length >= 2 &&
    options.formulaMode.contract.pathSearchPolicy.type !== "step-glitch" &&
    options.formulaMode.contract.appendPrefixContinuation.type === "cold-replay"
  );
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
  options: GraphwarOneClickClearSearchOptions,
  route: OneClickClearRoute,
  validation: ReturnType<typeof sampleOneClickClearTargetSequence>,
  formulaEvidence: GraphwarStepGlitchFormulaEvidence,
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
  const simulationMask = options.simulationMask ?? options.formulaMode.settings.stepGlitchObstacleMask;
  if (!simulationMask) {
    throw new Error("Validated Step glitch path is missing its simulation mask.");
  }
  const prefixTarget = createOneClickClearStepGlitchPrefixTarget(route, lastPathPoint);
  publishOneClickClearStepGlitchHitEvidence(
    options,
    route,
    createGraphwarStepGlitchPrefixEvidence({
      acceptedPoint,
      formulaEvidence,
      prefixTarget,
      requiredTargets: createOneClickClearPreviousTargets(route.targetSequence.slice(0, -1)),
      simulationBoundaryExpansion: options.simulationBoundaryExpansion,
      simulationMask,
    }),
  );
}

/** 发布自然 hit 的精确恢复证据；exact path key 让未被页面采用的证据自然失配。 */
function publishOneClickClearStepGlitchHitEvidence(
  options: GraphwarOneClickClearSearchOptions,
  route: OneClickClearRoute,
  prefixEvidence: GraphwarStepGlitchPrefixEvidence,
) {
  const lastPathPoint = route.pathPoints.at(-1);
  if (!options.onValidatedStepGlitchPath || !lastPathPoint) {
    return;
  }
  options.onValidatedStepGlitchPath({
    path: route.pathPoints.map(clonePixelPoint),
    prefixEvidence: structuredClone(prefixEvidence),
    targetSequence: route.targetSequence.map((target) => ({
      center: clonePixelPoint(target.hitCircle.center),
      radius: target.hitCircle.radius,
    })),
  });
}

/** 找出路径尾点对应的命中圈；普通控制点保持既有兜底半径语义。 */
function createOneClickClearStepGlitchPrefixTarget(route: OneClickClearRoute, lastPathPoint: PixelPoint) {
  return (
    route.targetSequence.find((target) => pixelPointsEqual(target.routePoint, lastPathPoint))?.hitCircle ??
    ({ center: lastPathPoint, radius: FALLBACK_TARGET_RADIUS_IMAGE_PIXELS } satisfies GraphwarTrajectoryTargetCircle)
  );
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
function publishOneClickClearValidatedRoute(context: OneClickClearSearchContext, route: OneClickClearRoute) {
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
  options: GraphwarOneClickClearSearchOptions,
  route: OneClickClearRoute,
): GraphwarOneClickClearIncumbent | undefined {
  const evidence = route.incumbentEvidence;
  if (!evidence) {
    return undefined;
  }
  const formulaContext =
    "finalContinuation" in evidence && evidence.finalContinuation
      ? evidence.finalContinuation.continuation.context
      : evidence.formulaContext;
  if (formulaContext.formulaPoints.length < 2) {
    return undefined;
  }

  const launchAngleRadians =
    options.formulaMode.contract.equation === "ddy" ? getGraphwarTrajectoryLaunchAngle(formulaContext) : Number.NaN;
  return {
    expression: formulaContext.formulaResult.expression,
    ...(Number.isFinite(launchAngleRadians) ? { launchAngleRadians } : {}),
    pathPoints: route.pathPoints.map(clonePixelPoint),
    trajectoryPoints: evidence.trajectoryPoints.map(clonePixelPoint),
  };
}

/** 将最终验证使用的同一公式上下文固化进成功结果，禁止页面只拿路径重新解算。 */
function createOneClickClearSuccessResult(
  options: GraphwarOneClickClearSearchOptions,
  route: OneClickClearRoute,
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
  options: GraphwarOneClickClearSearchOptions,
  route: Pick<OneClickClearRoute, "pathPoints" | "targetSequence">,
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
  route: OneClickClearRoute,
  workUnits: number,
): Promise<OneClickClearPathOptimizationResult> {
  let optimized = route;
  const firstGeneratedIndex = context.options.pathPoints.length;
  const protectedTargetPoints =
    context.options.formulaMode.contract.pathSearchPolicy.type === "step-glitch"
      ? new Set(route.targetSequence.map((target) => target.routePoint))
      : undefined;
  const canLocalHitCheckSkipFullValidation =
    context.options.deleteHitCheckRadiusPixels > 0 &&
    context.options.formulaMode.contract.deleteInfluence.type === "adjacent-local";
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
      canLocalHitCheckSkipFullValidation &&
      !oneClickClearPointDeleteKeepsLocalSoldierHits(context.options, optimized.pathPoints, index)
    ) {
      index += 1;
      await yieldOneClickClearControl(context.options);
      continue;
    }

    const candidatePath = [...optimized.pathPoints.slice(0, index), ...optimized.pathPoints.slice(index + 1)];
    const candidateRoute = { pathPoints: candidatePath, targetSequence: optimized.targetSequence };
    const candidateValidation =
      canLocalHitCheckSkipFullValidation || !oneClickClearStepRouteIsValid(context.options, candidatePath)
        ? undefined
        : sampleOneClickClearTargetSequence(context.options, candidateRoute);
    if (canLocalHitCheckSkipFullValidation || candidateValidation?.reachesTargetSequenceBeforeObstacle) {
      // 旧公式证据随路径一起丢弃；完整验证成功时立即为新公式构造一份新的原子 continuation evidence。
      const incumbentEvidence = candidateValidation
        ? createOneClickClearIncumbentEvidenceFromValidation(context.options, candidateRoute, candidateValidation)
        : undefined;
      optimized = {
        ...(incumbentEvidence ? { incumbentEvidence } : {}),
        ...candidateRoute,
      };
      continue;
    }
    index += 1;

    await yieldOneClickClearControl(context.options);
  }
  if (canLocalHitCheckSkipFullValidation && optimized !== route) {
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
function oneClickClearPathFollowsGraphRule(options: GraphwarOneClickClearSearchOptions, points: readonly PixelPoint[]) {
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
  options: GraphwarOneClickClearSearchOptions,
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
async function yieldOneClickClearControl(options: GraphwarOneClickClearSearchOptions) {
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
  options: GraphwarOneClickClearSearchOptions,
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
  options: GraphwarOneClickClearSearchOptions,
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
  options: GraphwarOneClickClearSearchOptions,
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
  options: GraphwarOneClickClearSearchOptions,
  timings: readonly GraphwarOneClickClearDebugTiming[],
) {
  for (const timing of timings) {
    emitOneClickClearDebugTiming(options, timing);
  }
}

/** 发送单条调试耗时；未配置回调时为空操作。 */
function emitOneClickClearDebugTiming(
  options: GraphwarOneClickClearSearchOptions,
  timing: GraphwarOneClickClearDebugTiming,
) {
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
