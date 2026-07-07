import type { BoundsRect, GraphBounds, PixelPoint } from "../../core/types";
import { sampleGraphwarPathTrajectory } from "../../formula/trajectory/sampling";
import type {
  GraphwarTrajectoryFormulaSettings,
  GraphwarTrajectoryTargetCircle,
} from "../../formula/trajectory/sampling";

export type GraphwarSmartPathfindingHitTarget = PixelPoint | GraphwarTrajectoryTargetCircle;

/** 智能寻路候选路径的真实弹道验证结果。 */
export interface GraphwarSmartPathfindingTrajectoryResult {
  /** 未命中目标前碰到障碍或边界的位置。 */
  blockedPoint?: PixelPoint;
  /** 是否先命中目标再碰障碍。 */
  reachesTargetBeforeObstacle: boolean;
  /** 可绘制轨迹。 */
  visiblePixels: PixelPoint[];
}

interface GraphwarSmartPathfindingTrajectoryOptions {
  /** 障碍和棋盘边界命中检测的内收像素。 */
  boundaryExpansion: number;
  /** 当前 Graphwar 坐标边界；缺失时应沿用页面原来的预检失败语义。 */
  bounds: GraphBounds | undefined;
  /** 截图内 Graphwar 棋盘矩形。 */
  boundsRect: BoundsRect;
  /** 普通点击目标点或士兵真实命中圈。 */
  hitTarget: GraphwarSmartPathfindingHitTarget | undefined;
  /** 函数模拟用障碍 mask。 */
  obstacleMask: Uint8Array | undefined;
  /** 待验证的完整像素路径。 */
  points: readonly PixelPoint[];
  /** 当前公式采样设置。 */
  settings: GraphwarTrajectoryFormulaSettings;
  /** 普通点击目标点使用的默认真实命中半径；无有效 bounds 时不可用。 */
  targetHitRadiusPixels: number | undefined;
}

/** 提取新增路径段并保留连接点，供搜索动画绘制。 */
export function getGraphwarSmartPathfindingAppendedSegment(points: readonly PixelPoint[], sourcePathLength: number) {
  return points.slice(Math.max(0, sourcePathLength - 1));
}

/** 普通点击应使用默认半径；士兵目标应保留真实命中圈。 */
export function createGraphwarSmartPathfindingHitTarget(
  hitTarget: GraphwarSmartPathfindingHitTarget,
  targetHitRadiusPixels: number | undefined,
): GraphwarTrajectoryTargetCircle | undefined {
  if ("center" in hitTarget) {
    return { center: hitTarget.center, radius: hitTarget.radius };
  }
  return targetHitRadiusPixels === undefined ? undefined : { center: hitTarget, radius: targetHitRadiusPixels };
}

/** 使用共享采样模块验证像素路径的弹道命中结果。 */
export function createGraphwarSmartPathfindingTrajectoryResult(
  options: GraphwarSmartPathfindingTrajectoryOptions,
): GraphwarSmartPathfindingTrajectoryResult {
  if (!options.bounds) {
    return { reachesTargetBeforeObstacle: false, visiblePixels: [] };
  }

  const target = options.hitTarget
    ? createGraphwarSmartPathfindingHitTarget(options.hitTarget, options.targetHitRadiusPixels)
    : undefined;
  if (!target) {
    return { reachesTargetBeforeObstacle: false, visiblePixels: [] };
  }

  // 智能寻路候选路径和当前路径预检应共用同一套“目标前无障碍”判定。
  const result = sampleGraphwarPathTrajectory({
    boundaryExpansion: options.boundaryExpansion,
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    hitTargetPoint: target?.center,
    obstacleMask: options.obstacleMask,
    points: options.points,
    settings: options.settings,
    targetHitRadiusPixels: target.radius,
  });
  return {
    blockedPoint: result.earlyStopReason === "obstacle" ? result.visiblePixels.at(-1) : undefined,
    reachesTargetBeforeObstacle: result.reachesTargetBeforeObstacle,
    visiblePixels: result.visiblePixels,
  };
}
