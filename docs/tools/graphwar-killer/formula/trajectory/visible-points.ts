import { nowMs } from "../../core/time";
import type { PixelPoint } from "../../core/types";
import type { GraphwarTrajectoryDebugMetrics } from "../debug-metrics";

/** 返回 Graphwar 在首次障碍碰撞前实际绘制的轨迹点数；碰撞采样点本身不可见。 */
export function getGraphwarVisibleTrajectoryPointCount(points: readonly PixelPoint[], obstacleHitIndex: number) {
  return obstacleHitIndex >= 0 ? Math.min(points.length, obstacleHitIndex) : points.length;
}

/** 固化 Graphwar 可绘制的轨迹前缀，隔离后续搜索和 Worker 消息使用的数组引用。 */
export function snapshotGraphwarVisibleTrajectoryPoints(
  points: readonly PixelPoint[],
  obstacleHitIndex: number,
  debugMetrics?: GraphwarTrajectoryDebugMetrics,
): PixelPoint[] {
  if (!debugMetrics) {
    return points.slice(0, getGraphwarVisibleTrajectoryPointCount(points, obstacleHitIndex));
  }
  const startedAt = nowMs();
  try {
    return points.slice(0, getGraphwarVisibleTrajectoryPointCount(points, obstacleHitIndex));
  } finally {
    debugMetrics.timings.visibleTrajectoryCopyElapsedMs += nowMs() - startedAt;
  }
}
