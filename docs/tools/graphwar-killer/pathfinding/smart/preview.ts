import { mirrorPlaneGridPoint, planeGridCellCenterToImagePoint, type PlaneGridPoint } from "../../core/plane-grid";
import type { BoundsRect, PixelPoint } from "../../core/types";
import type { GraphwarPathfindingPreview } from "../routing/visibility-graph";

/** SVG 线段 DTO，避免模板里重复计算 x1/y1/x2/y2。 */
export interface GraphwarPathfindingLineSegment {
  /** 起点 x。 */
  x1: number;
  /** 终点 x。 */
  x2: number;
  /** 起点 y。 */
  y1: number;
  /** 终点 y。 */
  y2: number;
}

/** 页面搜索动画使用的截图坐标快照。 */
export interface GraphwarPathfindingPreviewSnapshot {
  /** 已通过可见性检查的边，坐标已投影到截图像素。 */
  acceptedEdges: readonly GraphwarPathfindingLineSegment[];
  /** 当前扩展点，坐标已投影到截图像素。 */
  current?: PixelPoint;
  /** 当前最优路径，坐标已投影到截图像素。 */
  path: readonly PixelPoint[];
  /** 当前候选点，坐标已投影到截图像素。 */
  points: readonly PixelPoint[];
}

/** 创建 SVG 线段 DTO。 */
export function createGraphwarPathfindingLineSegment(
  startPoint: PixelPoint,
  targetPoint: PixelPoint,
): GraphwarPathfindingLineSegment {
  return {
    x1: startPoint.x,
    y1: startPoint.y,
    x2: targetPoint.x,
    y2: targetPoint.y,
  };
}

/** 按路径点圆半径截短线段，避免线条穿过点心。 */
export function createGraphwarPathLineSegments(points: readonly PixelPoint[], radius: number) {
  const segments: GraphwarPathfindingLineSegment[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= radius * 2) {
      continue;
    }

    const offsetX = (deltaX / distance) * radius;
    const offsetY = (deltaY / distance) * radius;
    segments.push({
      x1: start.x + offsetX,
      y1: start.y + offsetY,
      x2: end.x - offsetX,
      y2: end.y - offsetY,
    });
  }
  return segments;
}

/** 把共享寻路模块的图搜索快照投影回截图，用于搜索动画。 */
export function createGraphwarPathfindingPreviewSnapshot(
  preview: GraphwarPathfindingPreview,
  boundsRect: BoundsRect,
): GraphwarPathfindingPreviewSnapshot {
  const { acceptedEdges, bestPath, candidates, current, mirrored } = preview;
  return {
    acceptedEdges: acceptedEdges.map(([start, end]) =>
      createGraphwarPathfindingLineSegment(
        previewPlanePointToImagePoint(start, mirrored, boundsRect),
        previewPlanePointToImagePoint(end, mirrored, boundsRect),
      ),
    ),
    current: current ? previewPlanePointToImagePoint(current, mirrored, boundsRect) : undefined,
    path: bestPath.map((point) => previewPlanePointToImagePoint(point, mirrored, boundsRect)),
    points: candidates.map((point) => previewPlanePointToImagePoint(point, mirrored, boundsRect)),
  };
}

/** 将搜索坐标系里的平面点投影成截图像素点。 */
function previewPlanePointToImagePoint(point: PlaneGridPoint, mirrored: boolean, boundsRect: BoundsRect) {
  return planeGridCellCenterToImagePoint(mirrorPlaneGridPoint(point, mirrored), boundsRect);
}
