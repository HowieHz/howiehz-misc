import { formatSvgNumber } from "../../core/numbers";
import type { PixelPoint } from "../../core/types";

/**
 * 将截图像素点格式化为 SVG polyline 的 points 属性。
 *
 * 少于两个点时返回空字符串，避免调用方为不可见折线重复写长度判断。
 */
export function formatSvgPolylinePoints(points: readonly PixelPoint[]) {
  return formatSvgPolylinePointSlice(points, points.length);
}

/**
 * 将截图像素轨迹格式化为只包含可见段的 SVG polyline points 属性。
 *
 * `hitIndex` 是第一个障碍命中点；Graphwar 原版碰撞后只绘制到 numSteps - 1。因此这里排除命中点本身；-1 表示保留完整轨迹。
 */
export function formatVisibleTrajectoryPoints(points: readonly PixelPoint[], hitIndex: number) {
  const visiblePointCount = hitIndex >= 0 ? Math.min(points.length, hitIndex) : points.length;
  return formatSvgPolylinePointSlice(points, visiblePointCount);
}

/** 格式化 points 前缀，供命中截断复用；直接遍历前 N 个点，避免为了截断额外 slice 一份数组。 */
function formatSvgPolylinePointSlice(points: readonly PixelPoint[], pointCount: number) {
  if (pointCount < 2) {
    return "";
  }

  const formattedPoints = new Array<string>(pointCount);
  for (let index = 0; index < pointCount; index += 1) {
    const point = points[index];
    formattedPoints[index] = `${formatSvgNumber(point.x)},${formatSvgNumber(point.y)}`;
  }
  return formattedPoints.join(" ");
}
