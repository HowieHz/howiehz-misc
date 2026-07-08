/** 提供截图像素坐标、Graphwar 坐标和标定矩形之间的转换工具。 */
import { clampNumber } from "./numbers";
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

/** 将点击路径点限制在边界内，并把 x- 或过近点击推进到最小 x+ 步长。 */
export function normalizePathPoint(
  point: PixelPoint,
  rect: BoundsRect,
  bounds: GraphBounds,
  lastPoint: PixelPoint | undefined,
  minGraphXStep = 0,
): PixelPoint {
  let x = clampNumber(point.x, rect.x, rect.x + rect.width);
  if (lastPoint && minGraphXStep > 0) {
    const xPlusIsRight = xPlusGoesRight(bounds);
    const minPixelXStep = Math.abs(minGraphXStep / (bounds.maxX - bounds.minX)) * rect.width;
    if (xPlusIsRight) {
      x = Math.max(x, lastPoint.x + minPixelXStep);
    } else {
      x = Math.min(x, lastPoint.x - minPixelXStep);
    }
  }

  return createPixelPoint(
    clampNumber(x, rect.x, rect.x + rect.width),
    clampNumber(point.y, rect.y, rect.y + rect.height),
  );
}
