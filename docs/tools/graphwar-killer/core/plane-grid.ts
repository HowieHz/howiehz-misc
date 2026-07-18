/** 提供 Graphwar 原始 770x450 平面网格与截图像素之间的纯坐标换算。 */
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "./game/constants";
import { clampNumber, doublePrecisionTolerance } from "./numbers";
import { createPixelPoint } from "./types";
import type { BoundsRect, PixelPoint } from "./types";

/** Graphwar 原始 770x450 平面网格点；mask、寻路和障碍编辑应使用同一坐标语义。 */
export interface PlaneGridPoint {
  /** 平面网格 x。 */
  x: number;
  /** 平面网格 y。 */
  y: number;
}

/** 将截图 x 投影到原生平面的连续 x；结果不裁剪，便于调用方判断边界外位置。 */
export function imageXToPlaneX(imageX: number, edgeRect: BoundsRect) {
  assertFiniteNumber(imageX, "imageX");
  assertFiniteHorizontalRect(edgeRect);
  const planeX = ((imageX - edgeRect.x) * GRAPHWAR_PLANE_LENGTH) / edgeRect.width;
  const nearestHalfColumn = Math.round(planeX * 2) / 2;
  // 截图平移消减误差由 imageX/rect 的尺度决定，不能只按换算后的 planeX 估算。
  const projectionTolerance =
    (doublePrecisionTolerance(imageX, edgeRect.x, edgeRect.width) * GRAPHWAR_PLANE_LENGTH * 2) / edgeRect.width;
  return Math.abs(planeX - nearestHalfColumn) <= projectionTolerance ? nearestHalfColumn : planeX;
}

/** 将原生平面的连续 x 映射到截图 x；输入可位于平面外。 */
export function planeXToImageX(planeX: number, edgeRect: BoundsRect) {
  assertFiniteNumber(planeX, "planeX");
  assertFiniteHorizontalRect(edgeRect);
  return edgeRect.x + (planeX * edgeRect.width) / GRAPHWAR_PLANE_LENGTH;
}

/**
 * 将原生连续 x 映射到统一递增的 x+ 坐标。
 *
 * 镜像使用 769-x，因为普通整数列身份是 0..769；同一变换也可直接还原连续坐标。
 */
export function planeXToForwardX(planeX: number, mirrored: boolean) {
  assertFiniteNumber(planeX, "planeX");
  return mirrored ? GRAPHWAR_PLANE_LENGTH - 1 - planeX : planeX;
}

/** 将原生整数列映射到统一递增的 x+ 整数列。 */
export function planeColumnToForwardColumn(column: number, mirrored: boolean) {
  assertPlaneColumn(column, "column");
  return mirrored ? GRAPHWAR_PLANE_LENGTH - 1 - column : column;
}

/** 将统一递增的 x+ 整数列还原成截图从左到右的原生列。 */
export function forwardColumnToPlaneColumn(forwardColumn: number, mirrored: boolean) {
  assertPlaneColumn(forwardColumn, "forwardColumn");
  return mirrored ? GRAPHWAR_PLANE_LENGTH - 1 - forwardColumn : forwardColumn;
}

/** 把截图 x 映射到最近的原生列；恰好位于两列中间时选择 Graphwar x+ 方向。 */
export function imageXToNearestPlaneColumn(imageX: number, edgeRect: BoundsRect, mirrored: boolean) {
  return forwardColumnToPlaneColumn(
    clampNumber(Math.round(planeXToForwardX(imageXToPlaneX(imageX, edgeRect), mirrored)), 0, GRAPHWAR_PLANE_LENGTH - 1),
    mirrored,
  );
}

/** 将 Graphwar 原始平面坐标映射到截图像素。 */
export function planeToImagePoint(point: PlaneGridPoint, edgeRect: BoundsRect) {
  return createPixelPoint(
    edgeRect.x + (point.x / GRAPHWAR_PLANE_LENGTH) * edgeRect.width,
    edgeRect.y + (point.y / GRAPHWAR_PLANE_HEIGHT) * edgeRect.height,
  );
}

/** 将平面 cell 中心映射回截图像素，避免路径和笔刷预览贴 cell 边缘。 */
export function planeGridCellCenterToImagePoint(point: PlaneGridPoint, edgeRect: BoundsRect) {
  return planeToImagePoint({ x: point.x + 0.5, y: point.y + 0.5 }, edgeRect);
}

/** 将截图像素映射到平面网格，并裁剪到 770x450 内。 */
export function imagePointToPlaneGridPoint(point: PixelPoint, edgeRect: BoundsRect): PlaneGridPoint {
  // Keep the unbounded projection local: every caller of this interface needs a valid mask cell.
  return {
    x: clampNumber(
      Math.floor(((point.x - edgeRect.x) / edgeRect.width) * GRAPHWAR_PLANE_LENGTH),
      0,
      GRAPHWAR_PLANE_LENGTH - 1,
    ),
    y: clampNumber(
      Math.floor(((point.y - edgeRect.y) / edgeRect.height) * GRAPHWAR_PLANE_HEIGHT),
      0,
      GRAPHWAR_PLANE_HEIGHT - 1,
    ),
  };
}

/** 将实际平面点镜像到 x+ 搜索坐标系；mirrored=false 时应保持点不变。 */
export function mirrorPlaneGridPoint(point: PlaneGridPoint, mirrored: boolean): PlaneGridPoint {
  return {
    x: mirrored ? GRAPHWAR_PLANE_LENGTH - 1 - point.x : point.x,
    y: point.y,
  };
}

/** 将平面网格点编码为固定 770x450 mask 的一维下标。 */
export function planeGridPointToIndex(point: PlaneGridPoint) {
  return point.y * GRAPHWAR_PLANE_LENGTH + point.x;
}

/** 将固定 770x450 mask 的一维下标还原为平面网格点。 */
export function planeGridPointFromIndex(index: number): PlaneGridPoint {
  return {
    x: index % GRAPHWAR_PLANE_LENGTH,
    y: Math.floor(index / GRAPHWAR_PLANE_LENGTH),
  };
}

/** 返回两个平面网格点之间的欧氏距离。 */
export function planeGridPointDistance(left: PlaneGridPoint, right: PlaneGridPoint) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

/** 判断两个平面网格点是否表示同一个 mask cell。 */
export function planeGridPointsEqual(left: PlaneGridPoint, right: PlaneGridPoint) {
  return left.x === right.x && left.y === right.y;
}

/** 判断坐标是否位于固定 Graphwar 平面内。 */
export function planePointIsInsideBounds(x: number, y: number) {
  return x >= 0 && x < GRAPHWAR_PLANE_LENGTH && y >= 0 && y < GRAPHWAR_PLANE_HEIGHT;
}

/** 判断平面点是否位于边界内收后的可用区域内。 */
export function planePointIsInsideBoundaryExpansion(x: number, y: number, boundaryExpansion: number) {
  return (
    x >= boundaryExpansion &&
    x < GRAPHWAR_PLANE_LENGTH - boundaryExpansion &&
    y >= boundaryExpansion &&
    y < GRAPHWAR_PLANE_HEIGHT - boundaryExpansion
  );
}

/** 拒绝让 NaN/Infinity 静默进入列选择和镜像运算。 */
function assertFiniteNumber(value: number, name: string) {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite.`);
  }
}

/** 原生列和 forward 列共享同一个 0..769 整数域。 */
function assertPlaneColumn(column: number, name: string) {
  if (!Number.isInteger(column) || column < 0 || column >= GRAPHWAR_PLANE_LENGTH) {
    throw new RangeError(`${name} must be an integer Graphwar plane column.`);
  }
}

/** X 换算只依赖矩形左边界和正宽度，单独校验可避免无效比例污染搜索。 */
function assertFiniteHorizontalRect(rect: BoundsRect) {
  if (!Number.isFinite(rect.x) || !Number.isFinite(rect.width) || rect.width <= 0) {
    throw new RangeError("edgeRect must have a finite x and positive finite width.");
  }
}
