import type { BoundsRect, GraphBounds, PixelPoint } from "../../core/types";
import type {
  GraphwarTrajectoryFormulaSettings,
  GraphwarTrajectoryTargetCircle,
} from "../../formula/trajectory/sampling";
import type { GraphwarSmartPathfindingPathInput } from "../runtime/protocol";

/** 智能寻路搜索只消费已经解析成功的寻路容差，避免底层知道输入框和本地化文案。 */
export interface GraphwarSmartPathfindingSearchTolerances {
  /** 障碍和坐标系边界命中检测的内收值，单位为 Graphwar 原始平面像素。 */
  boundaryExpansionPlanePixels: number;
  /** 几何路线规划容差，单位为 Graphwar 原始平面像素。 */
  routePlanningTolerancePlanePixels: number;
}

interface GraphwarSmartPathfindingSearchInputOptions {
  /** 当前 Graphwar 坐标边界。 */
  bounds: GraphBounds;
  /** 截图内 Graphwar 坐标系矩形。 */
  boundsRect: BoundsRect;
  /** 命中目标圆；页面负责把普通点击转换为默认半径目标。 */
  hitTarget: GraphwarTrajectoryTargetCircle;
  /** 是否需要把搜索动画快照发回主线程。 */
  previewEnabled: boolean;
  /** 页面侧基础障碍 mask 的稳定 id，用于 worker 内 route mask cache。 */
  routeMaskCacheId: number;
  /** 页面侧基础障碍 mask；worker 内部按 route tolerance 派生 route mask。 */
  routeObstacleMask: Uint8Array;
  /** 当前公式采样设置。 */
  settings: GraphwarTrajectoryFormulaSettings;
  /** 函数模拟用障碍 mask。 */
  simulationMask: Uint8Array | undefined;
  /** 当前路径快照；最后一点应是几何搜索起点。 */
  sourcePath: readonly PixelPoint[];
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
    boundaryExpansion: options.tolerances.boundaryExpansionPlanePixels,
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    hitTarget: options.hitTarget,
    previewEnabled: options.previewEnabled,
    routeMaskCacheId: options.routeMaskCacheId,
    routeObstacleMask: options.routeObstacleMask,
    routeTolerancePlanePixels: options.tolerances.routePlanningTolerancePlanePixels,
    settings: options.settings,
    simulationBoundaryExpansion: options.tolerances.boundaryExpansionPlanePixels,
    simulationMask: options.simulationMask,
    sourcePath: options.sourcePath,
    targetPoint: options.targetPoint,
  };
}
