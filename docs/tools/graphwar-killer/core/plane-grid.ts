/** 提供 Graphwar 原始 770x450 平面网格与截图像素之间的纯坐标换算。 */
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "./game/constants";
import { clampNumber } from "./numbers";
import { createPixelPoint } from "./types";
import type { BoundsRect, PixelPoint } from "./types";

/** Graphwar 原始 770x450 平面网格点；mask、寻路和障碍编辑应使用同一坐标语义。 */
export interface PlaneGridPoint {
  /** 平面网格 x。 */
  x: number;
  /** 平面网格 y。 */
  y: number;
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
