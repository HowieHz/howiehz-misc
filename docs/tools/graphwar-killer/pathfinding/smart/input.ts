import type { BoundsRect, GraphBounds, PixelPoint } from "../../core/types";
import { formulaModeUsesStepGlitch } from "../../formula/generation/capabilities";
import type {
  GraphwarTrajectoryFormulaSettings,
  GraphwarTrajectoryTargetCircle,
} from "../../formula/trajectory/sampling";
import type { GraphwarPathfindingRouteMode } from "../routing/mode";
import type { GraphwarSmartPathfindingPathInput } from "../runtime/protocol";

/** 智能寻路搜索只消费已经解析成功的寻路容差，避免底层知道输入框和本地化文案。 */
export interface GraphwarSmartPathfindingSearchTolerances {
  /** 几何路线边界内收值，和 route tolerance 同源。 */
  routeBoundaryInsetPlanePixels: number;
  /** 几何路线规划容差，单位为 Graphwar 原始平面像素。 */
  routePlanningTolerancePlanePixels: number;
  /** 函数模拟边界内收值，和 simulation tolerance 同源。 */
  simulationBoundaryInsetPlanePixels: number;
}

/** 生成单目标智能寻路 Worker 输入所需的快照。 */
interface GraphwarSmartPathfindingSearchInputOptions {
  /** 当前 Graphwar 坐标边界。 */
  bounds: GraphBounds;
  /** 是否尝试删除新增控制点。 */
  deleteOptimizationEnabled: boolean;
  /** 截图内 Graphwar 坐标系矩形。 */
  boundsRect: BoundsRect;
  /** 命中目标圆；页面负责把普通点击转换为默认半径目标。 */
  hitTarget: GraphwarTrajectoryTargetCircle;
  /** 是否需要把搜索动画快照发回主线程。 */
  previewEnabled: boolean;
  /** 页面侧基础障碍 mask 的稳定 id，用于 worker 内 route mask cache。 */
  routeMaskCacheId: number;
  /** 普通几何路线算法；Step ODE 邪道会在协议边界改用规范值。 */
  routeMode: GraphwarPathfindingRouteMode;
  /** 页面侧基础障碍 mask；worker 内部按 route tolerance 派生 route mask。 */
  routeObstacleMask: Uint8Array;
  /** 当前公式采样设置。 */
  settings: GraphwarTrajectoryFormulaSettings;
  /** 函数模拟用障碍 mask。 */
  simulationMask: Uint8Array | undefined;
  /** 当前路径快照；最后一点应是几何搜索起点。 */
  sourcePath: readonly PixelPoint[];
  /** 旧公式当前尾点的验证圆。 */
  prefixTarget?: GraphwarTrajectoryTargetCircle;
  /** 页面侧 simulation mask 的稳定快照 id。 */
  simulationMaskCacheId: number;
  /** 路径终点，截图像素坐标。 */
  targetPoint: PixelPoint;
  /** 成功解析后的寻路容差。 */
  tolerances: GraphwarSmartPathfindingSearchTolerances;
}

/** 构造可跨 Worker 传递的智能寻路输入；页面仍负责运行态、缓存和预览回调。 */
export function createGraphwarSmartPathfindingSearchInput(
  options: GraphwarSmartPathfindingSearchInputOptions,
): GraphwarSmartPathfindingPathInput {
  return {
    boundaryExpansion: options.tolerances.routeBoundaryInsetPlanePixels,
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    deleteOptimizationEnabled: options.deleteOptimizationEnabled,
    hitTarget: options.hitTarget,
    previewEnabled: options.previewEnabled,
    routeMaskCacheId: options.routeMaskCacheId,
    // 邪道扫描不消费普通路由算法；规范值避免无关偏好污染结果缓存和 evidence。
    routeMode: formulaModeUsesStepGlitch(
      options.settings.algorithm,
      options.settings.equation,
      options.settings.stepGlitchMode,
    )
      ? "visibility-graph"
      : options.routeMode,
    routeObstacleMask: options.routeObstacleMask,
    routeTolerancePlanePixels: options.tolerances.routePlanningTolerancePlanePixels,
    settings: options.settings,
    simulationBoundaryExpansion: options.tolerances.simulationBoundaryInsetPlanePixels,
    simulationMask: options.simulationMask,
    simulationMaskCacheId: options.simulationMaskCacheId,
    sourcePath: options.sourcePath,
    ...(options.prefixTarget ? { prefixTarget: options.prefixTarget } : {}),
    targetPoint: options.targetPoint,
  };
}
