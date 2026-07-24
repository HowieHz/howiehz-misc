import { formatSvgNumber } from "../../core/numbers";
import type { PixelPoint } from "../../core/types";
import { getGraphwarVisibleTrajectoryPointCount } from "../../formula/trajectory/visible-points";

/**
 * 将截图像素点格式化为 SVG polyline 的 points 属性。
 *
 * 少于两个点时返回空字符串，避免调用方为不可见折线重复写长度判断。
 */
export function formatSvgPolylinePoints(points: readonly PixelPoint[]) {
  return points.length < 2 ? "" : formatSvgPolylinePointRange(points, 0, points.length);
}

/**
 * 将截图像素轨迹格式化为只包含可见段的 SVG polyline points 属性。
 *
 * `hitIndex` 是第一个障碍命中点；Graphwar 原版碰撞后只绘制到 numSteps - 1。因此这里排除命中点本身；-1 表示保留完整轨迹。
 */
export function formatVisibleTrajectoryPoints(points: readonly PixelPoint[], hitIndex: number) {
  const visiblePointCount = getGraphwarVisibleTrajectoryPointCount(points, hitIndex);
  return visiblePointCount < 2 ? "" : formatSvgPolylinePointRange(points, 0, visiblePointCount);
}

/** 格式化 points 的半开区间；直接遍历原数组，避免渐进轨迹每帧额外 slice。 */
export function formatSvgPolylinePointRange(points: readonly PixelPoint[], startIndex: number, endIndex: number) {
  const boundedStartIndex = Math.max(0, Math.min(points.length, startIndex));
  const boundedEndIndex = Math.max(boundedStartIndex, Math.min(points.length, endIndex));
  if (boundedEndIndex - boundedStartIndex < 1) {
    return "";
  }

  const formattedPoints = new Array<string>(boundedEndIndex - boundedStartIndex);
  for (let index = boundedStartIndex; index < boundedEndIndex; index += 1) {
    const point = points[index];
    formattedPoints[index - boundedStartIndex] = `${formatSvgNumber(point.x)},${formatSvgNumber(point.y)}`;
  }
  return formattedPoints.join(" ");
}
