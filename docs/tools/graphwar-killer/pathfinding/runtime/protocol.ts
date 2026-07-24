import type { PlaneGridPoint } from "../../core/plane-grid";
import type { BoundsRect, GraphBounds, PixelPoint } from "../../core/types";
import type {
  GraphwarTrajectoryFormulaSettings,
  GraphwarTrajectoryTargetCircle,
} from "../../formula/trajectory/sampling";
/** Web Worker 和主线程之间传递 Graphwar 几何寻路任务的协议类型。 */
import type {
  GraphwarOneClickClearDagEdgeBuildRequest,
  GraphwarOneClickClearDagEdgeBuildJob,
  GraphwarOneClickClearDagEdgeBuildResult,
  GraphwarOneClickClearDebugTiming,
  GraphwarOneClickClearIncumbent,
  GraphwarOneClickClearResult,
  GraphwarOneClickClearSearchInput,
} from "../one-click-clear/search";
import type { GraphwarPathfindingRouteMode } from "../routing/mode";
import type { GraphwarPathfindingPreview } from "../routing/visibility-graph";
import type { GraphwarPathfindingDiagnostics } from "./diagnostics";

/** 普通智能寻路的一条几何搜索请求。 */
export interface GraphwarPathfindingRouteInput {
  /** 当前 Graphwar 坐标边界。 */
  bounds: GraphBounds;
  /** 截图内 Graphwar 坐标系矩形。 */
  boundsRect: BoundsRect;
  /** 障碍和坐标系边界命中检测的内收值，单位为 Graphwar 原始平面像素。 */
  boundaryExpansion: number;
  /** 页面 route mask 缓存项的稳定 id，供 master Worker 复用私有可视图 cache。 */
  routeMaskCacheId: number;
  /** 已按 route tolerance 处理后的障碍 mask。 */
  routeMask: Uint8Array;
  /** 当前 route tolerance，单位为 Graphwar 原始平面像素，供可视图轮廓简化使用。 */
  routeTolerancePlanePixels: number;
  /** 路径起点，截图像素坐标。 */
  startPoint: PixelPoint;
  /** 路径终点，截图像素坐标。 */
  targetPoint: PixelPoint;
  /** 是否需要把搜索动画快照发回主线程。 */
  isPreviewEnabled: boolean;
  /** 几何路线算法模式；默认页面会传 visibility graph，复杂地形可切到 Theta*。 */
  routeMode: GraphwarPathfindingRouteMode;
}

/** 普通智能寻路几何搜索返回的耗时和路径。 */
export interface GraphwarPathfindingRouteResult {
  /** 平面网格路径；undefined 表示无可用几何路线。 */
  path?: PlaneGridPoint[];
  /** 搜索是否进入了可视图 cache。 */
  visibilityCache: "hit" | "miss" | "skipped";
  /** 可视图 cache 查询或构建耗时。 */
  visibilityCacheElapsedMs: number;
  /** 扣除可视图 cache 后的几何搜索耗时。 */
  searchElapsedMs: number;
}

/** 智能寻路 worker 内部耗时阶段；主线程只负责展示。 */
export type GraphwarSmartPathfindingWorkerTimingStage =
  | "prefix-evidence-hit"
  | "prefix-evidence-miss"
  | "prepare-pathfinding-prefix"
  | "optimize-path"
  | "route-mask-cache-hit"
  | "route-mask-cache-miss"
  | "search-route"
  | "validate-direct-trajectory"
  | "validate-trajectory"
  | "visibility-cache-hit"
  | "visibility-cache-miss"
  | "visibility-cache-skipped";

/** 智能寻路 worker 内部耗时记录。 */
export interface GraphwarSmartPathfindingWorkerTiming {
  /** 被测量的智能寻路阶段。 */
  stage: GraphwarSmartPathfindingWorkerTimingStage;
  /** 阶段耗时，单位毫秒。 */
  elapsedMs: number;
}

/** 智能寻路完整路径请求；worker 内完成几何搜索、轨迹验证和删点优化。 */
export interface GraphwarSmartPathfindingPathInput {
  /** 当前 Graphwar 坐标边界。 */
  bounds: GraphBounds;
  /** 是否尝试删除新增控制点；关闭时仍保留最终轨迹验证。 */
  isDeleteOptimizationEnabled: boolean;
  /** 截图内 Graphwar 坐标系矩形。 */
  boundsRect: BoundsRect;
  /** 障碍和坐标系边界命中检测的内收值，单位为 Graphwar 原始平面像素。 */
  boundaryExpansion: number;
  /** 命中目标圆；普通点击使用士兵默认半径。 */
  hitTarget: GraphwarTrajectoryTargetCircle;
  /** 是否需要把搜索动画快照发回主线程。 */
  isPreviewEnabled: boolean;
  /** 几何路线算法模式；普通寻路和一键清图保持同一个选择。 */
  routeMode: GraphwarPathfindingRouteMode;
  /** 页面侧基础障碍 mask；worker 内部按 route tolerance 派生 route mask。 */
  routeObstacleMask: Uint8Array;
  /** 页面侧基础障碍 mask 的稳定 id，用于 worker 内 route mask cache。 */
  routeMaskCacheId: number;
  /** 当前 route tolerance，单位为 Graphwar 原始平面像素，供可视图轮廓简化使用。 */
  routeTolerancePlanePixels: number;
  /** 函数模拟边界收缩值，单位为 Graphwar 原始平面像素。 */
  simulationBoundaryExpansion: number;
  /** 函数模拟用障碍 mask。 */
  simulationMask?: Uint8Array;
  /** 当前公式采样设置。 */
  settings: GraphwarTrajectoryFormulaSettings;
  /** 当前已有路径，最后一点是几何搜索起点。 */
  sourcePath: readonly PixelPoint[];
  /** 旧公式必须命中的当前尾控制点；evidence miss 时用于合并旧 preflight。 */
  prefixTarget?: GraphwarTrajectoryTargetCircle;
  /** 页面侧 simulation mask 的稳定快照 id，供 master Worker 跨消息识别同一 mask。 */
  simulationMaskCacheId: number;
  /** 路径终点，截图像素坐标。 */
  targetPoint: PixelPoint;
}

/** 智能寻路完整路径结果。 */
export interface GraphwarSmartPathfindingPathResult {
  /** 轨迹验证失败时最后一个可解释阻挡点。 */
  blockedPoint?: PixelPoint;
  /** 无可用路径时的失败阶段，页面用它保留原来的状态语义。 */
  failureReason?: "graph-rule" | "route" | "trajectory";
  /** 调试模式请求的 Worker 内部计数器和自然边界耗时。 */
  diagnostics?: GraphwarPathfindingDiagnostics;
  /** Step 已有路径严格域失败时的首个段下标；页面用它高亮整段。 */
  invalidSegmentIndex?: number;
  /** 可写回页面的完整像素路径；undefined 表示没有可用路径。 */
  path?: PixelPoint[];
  /** Worker 内部细分耗时。 */
  timings: GraphwarSmartPathfindingWorkerTiming[];
}

/** 一键清图 DAG 建边请求。 */
export type GraphwarOneClickClearDagEdgesWorkerInput = GraphwarOneClickClearDagEdgeBuildRequest;

/** 一键清图完整搜索请求；回调在 master worker 内部补齐。 */
export type GraphwarOneClickClearPathWorkerInput = GraphwarOneClickClearSearchInput;

/** 一键清图完整搜索结果，携带 worker 内部聚合的调试耗时。 */
export interface GraphwarOneClickClearPathWorkerResult {
  /** 调试模式请求的 Worker 内部计数器和自然边界耗时。 */
  diagnostics?: GraphwarPathfindingDiagnostics;
  /** 一键清图搜索成功或失败结果。 */
  result: GraphwarOneClickClearResult;
  /** Worker 内部收集到的细分耗时。 */
  timings: GraphwarOneClickClearDebugTiming[];
}

/** 在 Worker 信任边界校验可直接落地或发射的一键清图 incumbent。 */
export function isGraphwarOneClickClearIncumbent(value: unknown): value is GraphwarOneClickClearIncumbent {
  if (
    !isRecord(value) ||
    typeof value.expression !== "string" ||
    !value.expression.trim() ||
    !isPixelPointArray(value.pathPoints) ||
    !isPixelPointArray(value.trajectoryPoints, 0)
  ) {
    return false;
  }
  return value.launchAngleRadians === undefined || isFiniteNumber(value.launchAngleRadians);
}

/** 校验一键清图 Worker 最终响应，协议畸形必须由页面归类为 search-error。 */
export function isGraphwarOneClickClearPathWorkerResult(
  value: unknown,
): value is GraphwarOneClickClearPathWorkerResult {
  if (
    !isRecord(value) ||
    (value.diagnostics !== undefined && !isGraphwarPathfindingDiagnostics(value.diagnostics)) ||
    !Array.isArray(value.timings) ||
    !value.timings.every(
      (timing) => isRecord(timing) && typeof timing.stage === "string" && isFiniteNumber(timing.elapsedMs),
    ) ||
    !isRecord(value.result) ||
    !isFiniteNumber(value.result.elapsedMs) ||
    !isFiniteNumber(value.result.expandedStates)
  ) {
    return false;
  }
  if (value.result.type === "success") {
    return (
      isGraphwarOneClickClearIncumbent(value.result) &&
      Array.isArray(value.result.targetIds) &&
      value.result.targetIds.every((targetId) => typeof targetId === "string")
    );
  }
  if (value.result.type !== "failure" || !isGraphwarOneClickClearFailureReason(value.result.reason)) {
    return false;
  }
  return (
    value.result.invalidSegmentIndex === undefined ||
    (typeof value.result.invalidSegmentIndex === "number" &&
      Number.isInteger(value.result.invalidSegmentIndex) &&
      value.result.invalidSegmentIndex >= 0)
  );
}

/** 校验可选 Worker 诊断；缓存命中结果不携带该字段。 */
function isGraphwarPathfindingDiagnostics(value: unknown): value is GraphwarPathfindingDiagnostics {
  if (!isRecord(value) || !isRecord(value.counters) || !isRecord(value.timings)) {
    return false;
  }
  const counters = [
    value.counters.acceptedSamplePointCount,
    value.counters.formulaTermEvaluationCount,
    value.counters.incumbentReportCount,
    value.counters.incumbentTrajectoryPointLoad,
    value.counters.rk4StepCount,
    value.counters.stepBisectionCount,
    value.counters.trajectoryReplayCount,
  ].every((counter) => isFiniteNumber(counter) && Number.isInteger(counter) && counter >= 0);
  const timings = [
    value.timings.expressionFinalizationElapsedMs,
    value.timings.formulaPointMappingElapsedMs,
    value.timings.formulaPreparationElapsedMs,
    value.timings.incumbentBuildElapsedMs,
    value.timings.incumbentMessageSendElapsedMs,
    value.timings.pathErrorElapsedMs,
    value.timings.trajectoryReplayElapsedMs,
    value.timings.visibleTrajectoryCopyElapsedMs,
  ].every((timing) => isFiniteNumber(timing) && timing >= 0);
  if (!counters || !timings || value.stepGlitch === undefined) {
    return counters && timings;
  }
  return (
    isRecord(value.stepGlitch) &&
    [value.stepGlitch.candidateReplayCount, value.stepGlitch.directReplayCount].every(
      (counter) => isFiniteNumber(counter) && Number.isInteger(counter) && counter >= 0,
    )
  );
}

/** 判断未知值是否为可安全读取字段的普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 校验协议中的有限数值字段。 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 校验 Worker 返回的截图像素路径。 */
function isPixelPointArray(value: unknown, minimumLength = 1): value is PixelPoint[] {
  return (
    Array.isArray(value) &&
    value.length >= minimumLength &&
    value.every((point) => isRecord(point) && isFiniteNumber(point.x) && isFiniteNumber(point.y))
  );
}

/** 收窄一键清图失败 reason，防止未知协议值进入本地化和分支判定。 */
function isGraphwarOneClickClearFailureReason(value: unknown) {
  return (
    value === "no-candidate" ||
    value === "no-usable-target" ||
    value === "pathfinding-worker-failed" ||
    value === "preflight-blocked" ||
    value === "unsupported"
  );
}

/** Pathfinding master Worker 可执行的任务。 */
export type GraphwarPathfindingWorkerTask =
  | {
      input: GraphwarPathfindingRouteInput;
      type: "find-route";
    }
  | {
      /** 调试模式才请求 Worker 内部诊断。 */
      shouldCollectDiagnostics?: true;
      input: GraphwarSmartPathfindingPathInput;
      type: "find-smart-path";
    }
  | {
      input: GraphwarOneClickClearDagEdgesWorkerInput;
      type: "build-one-click-clear-dag-edges";
    }
  | {
      /** 调试模式才请求 Worker 内部诊断。 */
      shouldCollectDiagnostics?: true;
      input: GraphwarOneClickClearPathWorkerInput;
      /** True 时 master 会发布主搜索自然验证出的当前最优前缀。 */
      shouldReportIncumbents: boolean;
      type: "build-one-click-clear-path";
    };

/** 主线程发给 pathfinding master Worker 的请求。 */
export interface GraphwarPathfindingWorkerRequest {
  /** 单调递增请求 id，用于忽略过期响应。 */
  id: number;
  /** 具体几何寻路任务。 */
  task: GraphwarPathfindingWorkerTask;
}

/** Pathfinding master Worker 的成功响应。 */
export type GraphwarPathfindingWorkerSuccessResponse =
  | {
      id: number;
      result: GraphwarPathfindingRouteResult;
      taskType: "find-route";
      type: "success";
    }
  | {
      id: number;
      result: GraphwarSmartPathfindingPathResult;
      taskType: "find-smart-path";
      type: "success";
    }
  | {
      id: number;
      result: GraphwarOneClickClearDagEdgeBuildResult;
      taskType: "build-one-click-clear-dag-edges";
      type: "success";
    }
  | {
      id: number;
      result: GraphwarOneClickClearPathWorkerResult;
      taskType: "build-one-click-clear-path";
      type: "success";
    };

/** Pathfinding master Worker 发回主线程的完整响应集合。 */
export type GraphwarPathfindingWorkerResponse =
  | GraphwarPathfindingWorkerSuccessResponse
  | {
      id: number;
      message: string;
      type: "error";
    }
  | {
      id: number;
      preview: GraphwarPathfindingPreview;
      type: "preview";
    }
  | {
      id: number;
      /** 可在截止时直接发射的当前最优方案。 */
      incumbent: GraphwarOneClickClearIncumbent;
      type: "one-click-clear-incumbent";
    };

/** Edge Worker 初始化上下文；一个 worker 生命周期内只初始化一次。 */
export interface GraphwarOneClickClearEdgeWorkerInit {
  /** 当前 Graphwar 坐标边界。 */
  bounds: GraphBounds;
  /** 截图内 Graphwar 坐标系矩形。 */
  boundsRect: BoundsRect;
  /** 障碍和坐标系边界命中检测的内收值，单位为 Graphwar 原始平面像素。 */
  boundaryExpansion: number;
  /** 已按 route tolerance 处理后的障碍 mask。 */
  routeMask: Uint8Array;
  /** Step 累计高度的首路径点；ABS 建路忽略该字段。 */
  routeOriginPoint: PixelPoint;
  /** 几何路线算法模式；edge Worker 内按它决定是否建立可视图 cache。 */
  routeMode: GraphwarPathfindingRouteMode;
  /** 当前 route tolerance，单位为 Graphwar 原始平面像素，供可视图轮廓简化使用。 */
  routeTolerancePlanePixels: number;
  /** Step 严格边判定需要的精简公式设置。 */
  settings: GraphwarOneClickClearDagEdgeBuildRequest["settings"];
  /** 子 Worker 序号，仅用于调试错误信息。 */
  workerIndex: number;
}

/** Master Worker 发给 edge Worker 的消息。 */
export type GraphwarOneClickClearEdgeWorkerRequest =
  | {
      context: GraphwarOneClickClearEdgeWorkerInit;
      type: "init";
    }
  | {
      job: GraphwarOneClickClearDagEdgeBuildJob;
      requestId: number;
      type: "job";
    };

/** Edge Worker 的单边寻路成功结果。 */
export interface GraphwarOneClickClearEdgeWorkerJobResult {
  /** 已完成的 DAG 边 job id。 */
  jobId: number;
  /** 路线映射为像素前的几何寻路耗时。 */
  routePathfindingElapsedMs: number;
  /** 平面路径转截图像素路径的耗时。 */
  routeMapPixelsElapsedMs: number;
  /** 已按截图像素映射且首尾替换为精确控制点的路线。 */
  route?: PixelPoint[];
  /** Step 路线终点的实际累计高度；ABS 结果保持 undefined。 */
  resolvedEndY?: number;
  /** Step 路线终点的 canonical 打印系数累计身份。 */
  resolvedEndStateKey?: string;
}

/** Edge Worker 发回 master Worker 的消息。 */
export type GraphwarOneClickClearEdgeWorkerResponse =
  | {
      type: "ready";
      workerIndex: number;
    }
  | {
      requestId: number;
      result: GraphwarOneClickClearEdgeWorkerJobResult;
      type: "job-result";
      workerIndex: number;
    }
  | {
      message: string;
      type: "error";
      workerIndex: number;
    };
