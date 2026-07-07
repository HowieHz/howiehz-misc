/** Graphwar x+ 前进规则；页面和寻路 Worker 共用，避免两边的数值边界慢慢漂移。 */
import { graphToImagePoint, imageToGraphPoint, normalizePathPoint, xPlusGoesRight } from "../geometry";
import { doublePrecisionTolerance, graphXAdvancesStrictly, nextDownDouble, nextUpDouble } from "../numbers";
import { createGraphPoint, createPixelPoint } from "../types";
import type { BoundsRect, GraphBounds, PixelPoint } from "../types";

/**
 * 按 Graphwar 规则判断路径是否始终沿 x+ 推进。
 *
 * Bounds 被水平镜像时，截图像素 x 可能向左变小；这里统一先映射到 Graphwar 坐标，再判断后一个 Graphwar x 是否严格大于前一个 Graphwar x。
 */
export function pathFollowsGraphRule(points: readonly PixelPoint[], bounds: GraphBounds, boundsRect: BoundsRect) {
  for (let index = 1; index < points.length; index += 1) {
    const previousPoint = points[index - 1];
    const nextPoint = points[index];
    // 调用方通常传入完整 PixelPoint[]；这里保留防御分支，避免稀疏数组误判为不满足规则。
    if (!previousPoint || !nextPoint) {
      continue;
    }

    const previousGraph = imageToGraphPoint(previousPoint, bounds, boundsRect);
    const nextGraph = imageToGraphPoint(nextPoint, bounds, boundsRect);
    if (!graphXAdvancesStrictly(previousGraph.x, nextGraph.x)) {
      return false;
    }
  }
  return true;
}

/**
 * 将路径点逐个推进到最小可表示 x+ 步长，保证 Graphwar 只能沿 x+ 方向推进。
 *
 * 返回点仍是截图像素坐标；bounds 是否镜像只影响像素 x 推进方向，Graphwar x+ 判断始终按坐标值递增执行。 第一个点是当前发射/路径起点，保持调用方给出的精确坐标；后续控制点才会按需推进。
 */
export function normalizePathForMinimumForwardStep(
  points: readonly PixelPoint[],
  bounds: GraphBounds,
  boundsRect: BoundsRect,
) {
  if (points.length < 2) {
    return [...points];
  }

  const firstPoint = points[0];
  // 理论上 points.length >= 2 时应存在首点；保留空分支只处理异常稀疏数组。
  if (!firstPoint) {
    return [];
  }

  const normalizedPoints: PixelPoint[] = [firstPoint];
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (point) {
      normalizedPoints.push(normalizePathPointForStrictForward(point, normalizedPoints.at(-1), bounds, boundsRect));
    }
  }
  return normalizedPoints;
}

/** 先限制到标定边界内，再按需把点推到前一点之后的下一个 Graphwar double x。 */
export function normalizePathPointForStrictForward(
  point: PixelPoint,
  previousPoint: PixelPoint | undefined,
  bounds: GraphBounds,
  boundsRect: BoundsRect,
) {
  const normalizedPoint = normalizePathPoint(point, boundsRect, bounds, undefined, 0);
  // 没有前一点时只做边界归一化，不能凭空改变路径起点。
  if (!previousPoint) {
    return normalizedPoint;
  }

  const normalizedGraph = imageToGraphPoint(normalizedPoint, bounds, boundsRect);
  // 已经满足严格 x+ 时保持原点，避免无意义的 ULP 推进改变用户控制点。
  if (graphXAdvancesFromPoint(previousPoint, normalizedGraph.x, bounds, boundsRect)) {
    return normalizedPoint;
  }

  const minimumForwardPoint = createMinimumForwardPointAtGraphY(previousPoint, normalizedGraph.y, bounds, boundsRect);
  return minimumForwardPoint
    ? normalizePathPoint(minimumForwardPoint, boundsRect, bounds, undefined, 0)
    : normalizedPoint;
}

/**
 * 在指定 Graphwar y 上创建起点之后的最小 x+ 截图点。
 *
 * Graphwar x+ 总是 Graphwar 坐标增加；当 bounds 水平镜像时，x+ 在截图上表现为向左，所以按 xPlusGoesRight 选择 nextUpDouble 或 nextDownDouble 推开像素 x。
 */
export function createMinimumForwardPointAtGraphY(
  startPoint: PixelPoint,
  graphY: number,
  bounds: GraphBounds,
  boundsRect: BoundsRect,
) {
  const minimumGraphX = nextUpDouble(imageToGraphPoint(startPoint, bounds, boundsRect).x);
  const minimumGraphPoint = graphToImagePoint(createGraphPoint(minimumGraphX, graphY), bounds, boundsRect);
  const pixelRoundTripPadding = doublePrecisionTolerance(startPoint.x, minimumGraphPoint.x) * 2;
  // 理论最小 Graphwar x 映射回截图后可能仍落在同一个像素 double；按实际 x+ 方向再推开一点。
  const pixelX = xPlusGoesRight(bounds)
    ? nextUpDouble(Math.max(minimumGraphPoint.x, startPoint.x) + pixelRoundTripPadding)
    : nextDownDouble(Math.min(minimumGraphPoint.x, startPoint.x) - pixelRoundTripPadding);
  const point = createPixelPoint(pixelX, minimumGraphPoint.y);

  // 截图像素点往返 Graphwar 坐标可能丢 ULP；补 padding 后再验一次严格 x+。
  return graphXAdvancesFromPoint(startPoint, imageToGraphPoint(point, bounds, boundsRect).x, bounds, boundsRect)
    ? point
    : undefined;
}

/** 判断给定 Graphwar x 是否已经严格位于截图起点对应的 Graphwar x+ 方向。 */
export function graphXAdvancesFromPoint(
  startPoint: PixelPoint,
  graphX: number,
  bounds: GraphBounds,
  boundsRect: BoundsRect,
) {
  const startGraph = imageToGraphPoint(startPoint, bounds, boundsRect);
  return graphXAdvancesStrictly(startGraph.x, graphX);
}
