import { clampNumber, nearlyEqual } from "./numbers";
import { createGraphPoint, createPixelPoint } from "./types";
import type { BoundsRect, GraphBounds, GraphPoint, PixelPoint } from "./types";

/** 判断 Graphwar 的 x 递增方向是否对应标定图片边界的右侧。 */
export function xPlusGoesRight(bounds: GraphBounds) {
  return bounds.maxX > bounds.minX;
}

/** 将截图像素点转换为 Graphwar 笛卡尔坐标。 */
export function imageToGraphPoint(point: PixelPoint, bounds: GraphBounds, rect: BoundsRect): GraphPoint {
  return createGraphPoint(
    bounds.minX + ((point.x - rect.x) / rect.width) * (bounds.maxX - bounds.minX),
    bounds.maxY - ((point.y - rect.y) / rect.height) * (bounds.maxY - bounds.minY),
  );
}

/** 将 Graphwar 笛卡尔坐标转换回截图像素坐标。 */
export function graphToImagePoint(point: GraphPoint, bounds: GraphBounds, rect: BoundsRect): PixelPoint {
  return createPixelPoint(
    rect.x + ((point.x - bounds.minX) / (bounds.maxX - bounds.minX)) * rect.width,
    rect.y + ((bounds.maxY - point.y) / (bounds.maxY - bounds.minY)) * rect.height,
  );
}

/** 根据任意两个点击的边界角点生成正宽高矩形。 */
export function normalizeBoundsRect(start: PixelPoint, end: PixelPoint): BoundsRect {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const right = Math.max(start.x, end.x);
  const bottom = Math.max(start.y, end.y);
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

/** 在替换截图尺寸变化时，按比例缩放已有标定边界。 */
export function scaleBoundsRectToImageSize(
  rect: BoundsRect,
  fromWidth: number,
  fromHeight: number,
  toWidth: number,
  toHeight: number,
): BoundsRect {
  const xRatio = fromWidth > 0 ? toWidth / fromWidth : 1;
  const yRatio = fromHeight > 0 ? toHeight / fromHeight : 1;
  return clampBoundsRectToCanvas(
    {
      x: rect.x * xRatio,
      y: rect.y * yRatio,
      width: rect.width * xRatio,
      height: rect.height * yRatio,
    },
    toWidth,
    toHeight,
  );
}

/** 将标定边界限制在截图画布内部。 */
export function clampBoundsRectToCanvas(rect: BoundsRect, canvasWidth: number, canvasHeight: number): BoundsRect {
  const width = clampNumber(rect.width, 4, canvasWidth);
  const height = clampNumber(rect.height, 4, canvasHeight);
  return {
    x: clampNumber(rect.x, 0, canvasWidth - width),
    y: clampNumber(rect.y, 0, canvasHeight - height),
    width,
    height,
  };
}

/** 将指针换算得到的原始像素点限制在截图画布内部。 */
export function clampPixelPointToCanvas(point: PixelPoint, canvasWidth: number, canvasHeight: number): PixelPoint {
  return createPixelPoint(clampNumber(point.x, 0, canvasWidth), clampNumber(point.y, 0, canvasHeight));
}

/** 将点击路径点限制在边界内，并把 x- 方向点击转为从上一点垂直移动。 */
export function normalizePathPoint(
  point: PixelPoint,
  rect: BoundsRect,
  bounds: GraphBounds,
  lastPoint: PixelPoint | undefined,
): PixelPoint {
  let x = clampNumber(point.x, rect.x, rect.x + rect.width);
  if (lastPoint) {
    const xPlusIsRight = xPlusGoesRight(bounds);
    if ((xPlusIsRight && point.x < lastPoint.x) || (!xPlusIsRight && point.x > lastPoint.x)) {
      x = lastPoint.x;
    }
  }

  return createPixelPoint(x, clampNumber(point.y, rect.y, rect.y + rect.height));
}

/** 判断图形坐标中的 x 变化量是否足够小，可以视为垂直移动。 */
export function isVerticalGraphDelta(deltaX: number, bounds: GraphBounds, rect: BoundsRect, pixelTolerance: number) {
  if (rect.width <= 0) {
    return nearlyEqual(deltaX, 0);
  }

  const graphTolerance = (Math.abs(bounds.maxX - bounds.minX) / rect.width) * pixelTolerance;
  return Math.abs(deltaX) <= graphTolerance;
}
