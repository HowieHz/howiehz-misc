/** 提供截图像素坐标、Graphwar 坐标和标定矩形之间的转换工具。 */
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "./game/constants";
import { clampNumber } from "./numbers";
import { createGraphPoint, createPixelPoint } from "./types";
import type { BoundsRect, GraphBounds, GraphPoint, PixelPoint } from "./types";

/** 判断 Graphwar 的 x 递增方向是否对应标定图片边界的右侧。 */
export function xPlusGoesRight(bounds: GraphBounds) {
  return bounds.maxX > bounds.minX;
}

/** 将 Graphwar x 映射到原生平面的连续 x；取整和裁剪由具体 mask 语义决定。 */
export function graphXToPlaneX(x: number, bounds: GraphBounds) {
  return ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * GRAPHWAR_PLANE_LENGTH;
}

/** 将 Graphwar y 映射到原生平面的连续 y；Graphwar 笛卡尔 y+ 对应平面向上。 */
export function graphYToPlaneY(y: number, bounds: GraphBounds) {
  return ((bounds.maxY - y) / (bounds.maxY - bounds.minY)) * GRAPHWAR_PLANE_HEIGHT;
}

/** 将原生平面像素距离换算为指定坐标轴上的 Graphwar 图单位距离。 */
export function planePixelsToGraphUnits(pixels: number, bounds: GraphBounds, axis: "x" | "y") {
  const graphSpan = axis === "x" ? bounds.maxX - bounds.minX : bounds.maxY - bounds.minY;
  const planePixels = axis === "x" ? GRAPHWAR_PLANE_LENGTH : GRAPHWAR_PLANE_HEIGHT;
  return (Math.abs(graphSpan) * Math.abs(pixels)) / planePixels;
}

/** 判断两个点是否表示同一截图像素坐标。 */
export function pixelPointsEqual(left: PixelPoint, right: PixelPoint) {
  return left.x === right.x && left.y === right.y;
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
