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
  GraphwarOneClickClearResult,
  GraphwarOneClickClearSearchInput,
} from "../one-click-clear/search";
import type { GraphwarPathfindingRouteMode } from "../routing/mode";
import type { GraphwarPathfindingPreview } from "../routing/visibility-graph";

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
  previewEnabled: boolean;
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
  | "optimize-path"
  | "route-mask-cache-hit"
  | "route-mask-cache-miss"
  | "search-route"
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
  /** 截图内 Graphwar 坐标系矩形。 */
  boundsRect: BoundsRect;
  /** 障碍和坐标系边界命中检测的内收值，单位为 Graphwar 原始平面像素。 */
  boundaryExpansion: number;
  /** 命中目标圆；普通点击使用士兵默认半径。 */
  hitTarget: GraphwarTrajectoryTargetCircle;
  /** 是否需要把搜索动画快照发回主线程。 */
  previewEnabled: boolean;
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
  /** 路径终点，截图像素坐标。 */
  targetPoint: PixelPoint;
}

/** 智能寻路完整路径结果。 */
export interface GraphwarSmartPathfindingPathResult {
  /** 轨迹验证失败时最后一个可解释阻挡点。 */
  blockedPoint?: PixelPoint;
  /** 无可用路径时的失败阶段，页面用它保留原来的状态语义。 */
  failureReason?: "graph-rule" | "route" | "trajectory";
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
  /** 一键清图搜索成功或失败结果。 */
  result: GraphwarOneClickClearResult;
  /** Worker 内部收集到的细分耗时。 */
  timings: GraphwarOneClickClearDebugTiming[];
}

/** Pathfinding master Worker 可执行的任务。 */
export type GraphwarPathfindingWorkerTask =
  | {
      input: GraphwarPathfindingRouteInput;
      type: "find-route";
    }
  | {
      input: GraphwarSmartPathfindingPathInput;
      type: "find-smart-path";
    }
  | {
      input: GraphwarOneClickClearDagEdgesWorkerInput;
      type: "build-one-click-clear-dag-edges";
    }
  | {
      input: GraphwarOneClickClearPathWorkerInput;
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
