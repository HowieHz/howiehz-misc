/** 提供 Graphwar 原始 770x450 平面网格与截图像素之间的纯坐标换算。 */
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "./graphwar";
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
  const rawPoint = imagePointToRawPlaneGridPoint(point, edgeRect);
  return {
    x: clampNumber(rawPoint.x, 0, GRAPHWAR_PLANE_LENGTH - 1),
    y: clampNumber(rawPoint.y, 0, GRAPHWAR_PLANE_HEIGHT - 1),
  };
}

/** 将实际平面点镜像到 x+ 搜索坐标系；mirrored=false 时应保持点不变。 */
export function mirrorPlaneGridPoint(point: PlaneGridPoint, mirrored: boolean): PlaneGridPoint {
  return {
    x: mirrored ? GRAPHWAR_PLANE_LENGTH - 1 - point.x : point.x,
    y: point.y,
  };
}

/** 将截图像素点映射到未裁剪的平面网格坐标，供裁剪入口复用。 */
function imagePointToRawPlaneGridPoint(point: PixelPoint, edgeRect: BoundsRect): PlaneGridPoint {
  return {
    x: Math.floor(((point.x - edgeRect.x) / edgeRect.width) * GRAPHWAR_PLANE_LENGTH),
    y: Math.floor(((point.y - edgeRect.y) / edgeRect.height) * GRAPHWAR_PLANE_HEIGHT),
  };
}
