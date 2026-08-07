import type { GraphwarBackendAttemptIdentity, GraphwarWasmSessionIdentity } from "../../core/algorithm-backend";
import type { PlaneGridPoint } from "../../core/plane-grid";
import type { BoundsRect, GraphBounds, PixelPoint } from "../../core/types";
import type {
  GraphwarTrajectoryFormulaSettings,
  GraphwarTrajectoryTargetCircle,
} from "../../formula/trajectory/sampling";
import type {
  GraphwarOneClickClearDagEdgeBuildRequest,
  GraphwarOneClickClearDagEdgeBuildJob,
  GraphwarOneClickClearDagEdgeBuildResult,
  GraphwarOneClickClearDagEdgeRoute,
  GraphwarOneClickClearDebugTiming,
  GraphwarOneClickClearIncumbent,
  GraphwarOneClickClearResult,
  GraphwarOneClickClearSearchInput,
} from "../one-click-clear/search";
import type { GraphwarPathfindingRouteMode } from "../routing/mode";
import type { GraphwarStepRouteRuntime } from "../routing/step-route";
import type { GraphwarPathfindingPreview, GraphwarVisibilityGraphObstacleData } from "../routing/visibility-graph";
import type { GraphwarPathfindingDiagnostics } from "./diagnostics";

/** 普通几何寻路请求。 */
export interface GraphwarPathfindingRouteInput {
  /** 当前 Graphwar 坐标边界。 */
  bounds: GraphBounds;
  /** 截图内 Graphwar 坐标系矩形。 */
  boundsRect: BoundsRect;
  /** 碰撞边界内收值，单位为 Graphwar 原始平面像素。 */
  boundaryExpansion: number;
  /** 页面 route mask 快照 id，供 Worker 复用私有可视图 cache。 */
  routeMaskCacheId: number;
  /** 已按 route tolerance 处理的障碍 mask。 */
  routeMask: Uint8Array;
  /** 可视图轮廓简化容差，单位为 Graphwar 原始平面像素。 */
  routeTolerancePlanePixels: number;
  startPoint: PixelPoint;
  targetPoint: PixelPoint;
  isPreviewEnabled: boolean;
  routeMode: GraphwarPathfindingRouteMode;
}

/** 普通几何寻路结果及 cache 耗时。 */
export interface GraphwarPathfindingRouteResult {
  /** Undefined 表示无可用几何路线。 */
  path?: PlaneGridPoint[];
  /** 本次搜索是否复用了 Worker 私有可视图。 */
  visibilityCache: "hit" | "miss" | "skipped";
  visibilityCacheElapsedMs: number;
  searchElapsedMs: number;
}

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

/** 智能寻路 Worker 内一个自然阶段耗时。 */
export interface GraphwarSmartPathfindingWorkerTiming {
  stage: GraphwarSmartPathfindingWorkerTimingStage;
  /** 阶段耗时，单位毫秒。 */
  elapsedMs: number;
}

/** 在 Worker 内完成几何搜索和轨迹验证的智能寻路输入。 */
export interface GraphwarSmartPathfindingPathInput {
  bounds: GraphBounds;
  isDeleteOptimizationEnabled: boolean;
  boundsRect: BoundsRect;
  boundaryExpansion: number;
  hitTarget: GraphwarTrajectoryTargetCircle;
  isPreviewEnabled: boolean;
  routeMode: GraphwarPathfindingRouteMode;
  /** 页面基础障碍 mask；Worker 按 route tolerance 派生 route mask。 */
  routeObstacleMask: Uint8Array;
  /** 基础 mask 快照 id，用于 Worker cache 身份。 */
  routeMaskCacheId: number;
  routeTolerancePlanePixels: number;
  simulationBoundaryExpansion: number;
  /** 公式模拟使用的障碍 mask；与 route mask 语义不同。 */
  simulationMask?: Uint8Array;
  settings: GraphwarTrajectoryFormulaSettings;
  /** 当前已有路径，最后一点是几何搜索起点。 */
  sourcePath: readonly PixelPoint[];
  /** 旧公式必须命中的尾控制点，用于前缀 evidence。 */
  prefixTarget?: GraphwarTrajectoryTargetCircle;
  /** Simulation mask 快照 id，用于判定 evidence/cache 身份。 */
  simulationMaskCacheId: number;
  targetPoint: PixelPoint;
}

/** 智能寻路的完整路径或可解释失败结果。 */
export interface GraphwarSmartPathfindingPathResult {
  /** 失败时最后一个可解释阻挡点。 */
  blockedPoint?: PixelPoint;
  failureReason?: "graph-rule" | "route" | "trajectory";
  /** 仅在请求诊断时存在。 */
  diagnostics?: GraphwarPathfindingDiagnostics;
  /** Step 已有路径严格域失败时的首个段下标。 */
  invalidSegmentIndex?: number;
  path?: PixelPoint[];
  timings: GraphwarSmartPathfindingWorkerTiming[];
}

export type GraphwarOneClickClearDagEdgesWorkerInput = GraphwarOneClickClearDagEdgeBuildRequest;
export type GraphwarOneClickClearPathWorkerInput = GraphwarOneClickClearSearchInput;

/** 一键清图搜索结果及可选诊断。 */
export interface GraphwarOneClickClearPathWorkerResult {
  /** 仅在请求诊断时存在。 */
  diagnostics?: GraphwarPathfindingDiagnostics;
  result: GraphwarOneClickClearResult;
  timings: GraphwarOneClickClearDebugTiming[];
}

/** 同一检查点产生的 incumbent 与诊断证据。 */
export interface GraphwarOneClickClearProgress {
  /** 调试模式下与 incumbent 同一检查点的累计诊断。 */
  diagnostics?: GraphwarPathfindingDiagnostics;
  /** Worker-generated snapshots carry a request-local identity; locally synthesized UI snapshots may omit it. */
  sequence?: number;
  incumbent: GraphwarOneClickClearIncumbent;
}

/** Worker response progress always carries the request-local event identity. */
export interface GraphwarOneClickClearWorkerProgress extends GraphwarOneClickClearProgress {
  sequence: number;
}

export type GraphwarPathfindingWorkerTask =
  | { input: GraphwarPathfindingRouteInput; type: "find-route" }
  | {
      /** 调试模式才请求 Worker 内部诊断。 */
      shouldCollectDiagnostics?: true;
      input: GraphwarSmartPathfindingPathInput;
      type: "find-smart-path";
    }
  | { input: GraphwarOneClickClearDagEdgesWorkerInput; type: "build-one-click-clear-dag-edges" }
  | {
      /** 调试模式才请求 Worker 内部诊断。 */
      shouldCollectDiagnostics?: true;
      input: GraphwarOneClickClearPathWorkerInput;
      /** 是否发布主搜索自然验证出的当前最优前缀。 */
      shouldReportIncumbents: boolean;
      type: "build-one-click-clear-path";
    };

/** 主线程发给独占 Pathfinding master Worker 的请求。 */
export interface GraphwarPathfindingWorkerRequest {
  /** Stable outer task and current replaceable backend attempt. */
  attempt: GraphwarBackendAttemptIdentity;
  /** 单调递增，用于忽略迟到响应。 */
  id: number;
  task: GraphwarPathfindingWorkerTask;
}

export type GraphwarPathfindingWorkerSuccessResponse =
  | {
      attempt: GraphwarBackendAttemptIdentity;
      id: number;
      result: GraphwarPathfindingRouteResult;
      taskType: "find-route";
      type: "success";
    }
  | {
      attempt: GraphwarBackendAttemptIdentity;
      id: number;
      result: GraphwarSmartPathfindingPathResult;
      taskType: "find-smart-path";
      type: "success";
    }
  | {
      attempt: GraphwarBackendAttemptIdentity;
      id: number;
      result: GraphwarOneClickClearDagEdgeBuildResult;
      taskType: "build-one-click-clear-dag-edges";
      type: "success";
    }
  | {
      attempt: GraphwarBackendAttemptIdentity;
      id: number;
      result: GraphwarOneClickClearPathWorkerResult;
      taskType: "build-one-click-clear-path";
      type: "success";
    };

export type GraphwarPathfindingWorkerResponse =
  | GraphwarPathfindingWorkerSuccessResponse
  | { attempt: GraphwarBackendAttemptIdentity; id: number; message: string; type: "error" }
  | {
      attempt: GraphwarBackendAttemptIdentity;
      id: number;
      preview: GraphwarPathfindingPreview;
      type: "preview";
    }
  | {
      attempt: GraphwarBackendAttemptIdentity;
      id: number;
      /** 同一检查点的方案和诊断证据原子传递。 */
      progress: GraphwarOneClickClearWorkerProgress;
      type: "one-click-clear-incumbent";
    };

/** Edge Worker 生命周期内只设置一次的共享上下文。 */
interface GraphwarOneClickClearEdgeWorkerInitBase {
  bounds: GraphBounds;
  boundsRect: BoundsRect;
  boundaryExpansion: number;
  /** 与 Step model 身份一起保留的原始路线起点。 */
  routeOriginPoint: PixelPoint;
  routeMask: Uint8Array;
  routeTolerancePlanePixels: number;
}

/** Edge Worker 的路线预处理；visibility cache 必须与所属 mask 原子同行。 */
export type GraphwarOneClickClearEdgeWorkerRouteInit =
  | {
      routeMode: "visibility-graph";
      routePreprocessing:
        | { type: "wasm" }
        | { type: "typescript"; visibilityGraphObstacleData: GraphwarVisibilityGraphObstacleData };
    }
  | {
      routeMode: Exclude<GraphwarPathfindingRouteMode, "visibility-graph">;
      routePreprocessing?: never;
    };

type GraphwarOneClickClearEdgeWorkerFormulaInit =
  | { stepRouteRuntime?: never; type: "stateless" }
  | { stepRouteRuntime: GraphwarStepRouteRuntime; type: "step-stateful" };

/** 请求级共享初始化证据；只能整体构造、复用和丢弃。 */
export type GraphwarOneClickClearEdgeWorkerSharedInit = GraphwarOneClickClearEdgeWorkerInitBase &
  GraphwarOneClickClearEdgeWorkerRouteInit &
  GraphwarOneClickClearEdgeWorkerFormulaInit;

/** 单个 Edge Worker 的完整 init；只在请求级共享证据上增加 lane 身份。 */
export type GraphwarOneClickClearEdgeWorkerInit = GraphwarOneClickClearEdgeWorkerSharedInit & {
  workerIndex: number;
};

export type GraphwarOneClickClearEdgeWorkerRequest =
  | {
      attempt: GraphwarBackendAttemptIdentity;
      context: GraphwarOneClickClearEdgeWorkerInit;
      /** Master one-click session；typed init fault 必须带回同一份来源身份。 */
      session: GraphwarWasmSessionIdentity;
      type: "init";
    }
  | {
      attempt: GraphwarBackendAttemptIdentity;
      job: GraphwarOneClickClearDagEdgeBuildJob;
      requestId: number;
      /** 与 init 相同的请求级 session 身份。 */
      session: GraphwarWasmSessionIdentity;
      type: "job";
    };

/** Edge Worker 的路径证据与计时来自同一次 DAG 边 job。 */
export type GraphwarOneClickClearEdgeWorkerJobResult = GraphwarOneClickClearDagEdgeRoute & {
  /** 几何寻路耗时，单位毫秒。 */
  routePathfindingElapsedMs: number;
  /** 平面路径映射到截图像素的耗时，单位毫秒。 */
  routeMapPixelsElapsedMs: number;
};

export type GraphwarOneClickClearEdgeWorkerResponse =
  | { attempt: GraphwarBackendAttemptIdentity; type: "ready"; workerIndex: number }
  | {
      attempt: GraphwarBackendAttemptIdentity;
      requestId: number;
      result: GraphwarOneClickClearEdgeWorkerJobResult;
      type: "job-result";
      workerIndex: number;
    }
  | {
      attempt: GraphwarBackendAttemptIdentity;
      message: string;
      type: "error";
      workerIndex: number;
    };
