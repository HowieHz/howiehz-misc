import { planeGridCellCenterToImagePoint } from "../../core/plane-grid";
import type { BoundsRect, GraphBounds } from "../../core/types";
import {
  buildGraphwarVisibilityGraphPathForMask,
  type GraphwarVisibilityGraphObstacleData,
} from "../routing/visibility-graph";
import type { GraphwarOneClickClearEdgeWorkerJobResult } from "../runtime/protocol";
/** 一键清图 DAG 单边建路；master 串行 fallback 和 edge Worker 并行消费者共用同一条路线规则。 */
import type { GraphwarOneClickClearDagEdgeBuildJob } from "./search";

/** 单边建路所需的共享上下文；visibilityGraphObstacleData 的生命周期由调用方控制。 */
export interface GraphwarOneClickClearDagEdgeRouteBuildContext {
  /** 当前 Graphwar 坐标边界。 */
  bounds: GraphBounds;
  /** 截图内 Graphwar 棋盘矩形。 */
  boundsRect: BoundsRect;
  /** 障碍和棋盘边界命中检测的内收值，单位为 Graphwar 原始平面像素。 */
  boundaryExpansion: number;
  /** 已按 route tolerance 处理后的障碍 mask。 */
  routeMask: Uint8Array;
  /** 当前 route tolerance，单位为 Graphwar 原始平面像素，供可视图轮廓简化使用。 */
  routeTolerancePlanePixels: number;
  /** 与 routeMask 同生命周期的可视图数据；调用方负责决定复用范围。 */
  visibilityGraphObstacleData: GraphwarVisibilityGraphObstacleData;
}

/**
 * 构建单条一键清图 DAG 边路线。
 *
 * 平面寻路只负责绕障；输出路线的首尾点使用 job 中的原始截图像素点，避免格点中心映射把士兵命中点挪开。
 *
 * 找不到有效路线时省略 route 字段，调用方仍可用 jobId 把失败边合并回 DAG 结果。
 */
export async function buildOneClickClearDagEdgeRoute(
  context: GraphwarOneClickClearDagEdgeRouteBuildContext,
  job: GraphwarOneClickClearDagEdgeBuildJob,
): Promise<GraphwarOneClickClearEdgeWorkerJobResult> {
  const pathfindingStartedAt = performance.now();
  const route = await buildGraphwarVisibilityGraphPathForMask({
    bounds: context.bounds,
    boundsRect: context.boundsRect,
    boundaryExpansion: context.boundaryExpansion,
    routeMask: context.routeMask,
    routeTolerancePlanePixels: context.routeTolerancePlanePixels,
    startPoint: job.startPoint,
    targetPoint: job.targetPoint,
    visibilityGraphObstacleData: context.visibilityGraphObstacleData,
  });
  const routePathfindingElapsedMs = performance.now() - pathfindingStartedAt;

  // 没有至少一段可画路线时不做像素映射；route-map-pixels 只统计实际映射工作。
  if (!route || route.length < 2) {
    return {
      jobId: job.id,
      routeMapPixelsElapsedMs: 0,
      routePathfindingElapsedMs,
    };
  }

  const mapStartedAt = performance.now();
  const pixelRoute = route.map((point) => planeGridCellCenterToImagePoint(point, context.boundsRect));
  const routeMapPixelsElapsedMs = performance.now() - mapStartedAt;

  // 首尾必须回到原始截图控制点；中间点才来自平面格点中心映射。
  pixelRoute[0] = job.startPoint;
  pixelRoute[pixelRoute.length - 1] = job.targetPoint;
  return {
    jobId: job.id,
    route: pixelRoute,
    routeMapPixelsElapsedMs,
    routePathfindingElapsedMs,
  };
}
