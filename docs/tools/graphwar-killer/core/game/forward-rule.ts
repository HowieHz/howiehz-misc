/** Graphwar x+ 前进规则；页面和寻路 Worker 共用，避免两边的数值边界慢慢漂移。 */
import { graphToImagePoint, imageToGraphPoint, normalizePathPoint, xPlusGoesRight } from "../geometry";
import { graphXAdvancesStrictly } from "../numbers";
import { forwardColumnToPlaneColumn, imageXToPlaneX, planeXToForwardX, planeXToImageX } from "../plane-grid";
import { createGraphPoint, createPixelPoint } from "../types";
import type { BoundsRect, GraphBounds, PixelPoint } from "../types";
import { GRAPHWAR_AUTO_CONTROL_POINT_MIN_FORWARD_PLANE_PIXELS, GRAPHWAR_PLANE_LENGTH } from "./constants";

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
 * 将手工路径中不满足 x+ 的点逐个推进到下一合法原生列。
 *
 * 返回点仍是截图像素坐标；bounds 是否镜像只影响像素 x 推进方向，Graphwar x+ 判断始终按坐标值递增执行。 第一个点是当前发射/路径起点，保持调用方给出的精确坐标；后续控制点才会按需推进。
 */
export function normalizePathForStrictForward(
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

/**
 * 规范化一个普通几何寻路新建的空间点，并要求相对前一点真实前进至少一个原生平面像素。
 *
 * 已有手工前缀和精确用户目标不能调用此 API；Step glitch 的亚像素公式门同样绕过普通几何规范化。
 */
export function normalizeAutomaticPathPointForMinimumForwardStep(
  point: PixelPoint,
  previousPoint: PixelPoint | undefined,
  bounds: GraphBounds,
  boundsRect: BoundsRect,
) {
  const normalizedPoint = normalizePathPoint(point, boundsRect, bounds, undefined, 0);
  if (!previousPoint) {
    return normalizedPoint;
  }

  if (pointAdvancesByMinimumAutomaticForwardStep(previousPoint, normalizedPoint, bounds, boundsRect)) {
    return normalizedPoint;
  }

  return normalizePathPointToNextNativeColumn(normalizedPoint, previousPoint, bounds, boundsRect);
}

/** 判断普通自动空间点是否相对前一点真实前进了至少一个 Graphwar 原生平面像素。 */
export function pointAdvancesByMinimumAutomaticForwardStep(
  previousPoint: PixelPoint,
  point: PixelPoint,
  bounds: GraphBounds,
  boundsRect: BoundsRect,
) {
  const mirrored = !xPlusGoesRight(bounds);
  return (
    planeXToForwardX(imageXToPlaneX(point.x, boundsRect), mirrored) -
      planeXToForwardX(imageXToPlaneX(previousPoint.x, boundsRect), mirrored) >=
    GRAPHWAR_AUTO_CONTROL_POINT_MIN_FORWARD_PLANE_PIXELS
  );
}

/** 先限制到标定边界内，再只把不满足 x+ 的点推到下一合法原生列。 */
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
  // 用户手工点只需满足严格 x+；亚像素连续位置是有效输入，不参与自动列量化。
  if (graphXAdvancesFromPoint(previousPoint, normalizedGraph.x, bounds, boundsRect)) {
    return normalizedPoint;
  }

  return normalizePathPointToNextNativeColumn(normalizedPoint, previousPoint, bounds, boundsRect);
}

/**
 * 在指定 Graphwar y 上创建至少前进一个原生平面像素的下一整数列点。
 *
 * 自动空间点必须具有游戏平面上可分辨的真实位移，不能用 ULP 或 RK4 最后二分档位表达可达性。
 */
export function createNextNativePlaneColumnPointAtGraphY(
  startPoint: PixelPoint,
  graphY: number,
  bounds: GraphBounds,
  boundsRect: BoundsRect,
) {
  if (!Number.isFinite(graphY)) {
    return undefined;
  }

  const mirrored = !xPlusGoesRight(bounds);
  const forwardColumn = Math.max(
    0,
    Math.ceil(
      planeXToForwardX(imageXToPlaneX(startPoint.x, boundsRect), mirrored) +
        GRAPHWAR_AUTO_CONTROL_POINT_MIN_FORWARD_PLANE_PIXELS,
    ),
  );
  if (forwardColumn >= GRAPHWAR_PLANE_LENGTH) {
    return undefined;
  }

  return createPixelPoint(
    planeXToImageX(forwardColumnToPlaneColumn(forwardColumn, mirrored), boundsRect),
    graphToImagePoint(createGraphPoint(bounds.minX, graphY), bounds, boundsRect).y,
  );
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

/** 保持点的 Graphwar y，把需要自动修复的 x 移到下一合法原生列。 */
function normalizePathPointToNextNativeColumn(
  point: PixelPoint,
  previousPoint: PixelPoint,
  bounds: GraphBounds,
  boundsRect: BoundsRect,
) {
  const minimumForwardPoint = createNextNativePlaneColumnPointAtGraphY(
    previousPoint,
    imageToGraphPoint(point, bounds, boundsRect).y,
    bounds,
    boundsRect,
  );
  return minimumForwardPoint ? normalizePathPoint(minimumForwardPoint, boundsRect, bounds, undefined, 0) : point;
}
