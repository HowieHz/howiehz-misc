import { pointAdvancesByMinimumAutomaticForwardStep } from "../../core/game/forward-rule";
import { planeGridCellCenterToImagePoint } from "../../core/plane-grid";
import { nowMs } from "../../core/time";
import type { BoundsRect, GraphBounds } from "../../core/types";
import type { GraphwarPathfindingRouteMode } from "../routing/mode";
import type { GraphwarPlaneMaskSummedArea } from "../routing/step-envelope";
import type { GraphwarStepRouteModel } from "../routing/step-route";
import { createGraphwarStepPathfindingEdgeEvaluator, validateGraphwarStepRoutePath } from "../routing/step-route";
import { buildGraphwarThetaStarPathForMask } from "../routing/theta-star";
import type { GraphwarThetaStarScratch } from "../routing/theta-star";
import {
  buildGraphwarVisibilityGraphPathForMask,
  type GraphwarVisibilityGraphObstacleData,
} from "../routing/visibility-graph";
import type { GraphwarOneClickClearEdgeWorkerJobResult } from "../runtime/protocol";
/** 一键清图 DAG 单边建路；master 串行 fallback 和 edge Worker 并行消费者共用同一条路线规则。 */
import type { GraphwarOneClickClearDagEdgeBuildJob } from "./search";

/** 单边建路所需的共享上下文；可视图轮廓 cache 的生命周期由调用方控制。 */
export interface GraphwarOneClickClearDagEdgeRouteBuildContext {
  /** 当前 Graphwar 坐标边界。 */
  bounds: GraphBounds;
  /** 截图内 Graphwar 坐标系矩形。 */
  boundsRect: BoundsRect;
  /** 障碍和坐标系边界命中检测的内收值，单位为 Graphwar 原始平面像素。 */
  boundaryExpansion: number;
  /** 已按 route tolerance 处理后的障碍 mask。 */
  routeMask: Uint8Array;
  /** True 时缺少完整 Step runtime 应直接把边判为不可用。 */
  stepRouteRequired: boolean;
  /** Step 批次共用的数值模型；ABS 批次保持 undefined。 */
  stepRouteModel?: GraphwarStepRouteModel;
  /** Step 批次共用的 route mask 二维前缀和。 */
  stepRouteSummedArea?: GraphwarPlaneMaskSummedArea;
  /** 几何路线算法模式；和单目标路径规划共用页面上的寻路算法选择。 */
  routeMode: GraphwarPathfindingRouteMode;
  /** 当前 route tolerance，单位为 Graphwar 原始平面像素，供可视图轮廓简化使用。 */
  routeTolerancePlanePixels: number;
  /** 与当前 worker 或串行批次同生命周期的 Theta* 工作区；可减少一键清图重复分配。 */
  thetaStarScratch?: GraphwarThetaStarScratch;
  /** 与 routeMask 同生命周期的可视图数据；Theta* 模式不需要。 */
  visibilityGraphObstacleData?: GraphwarVisibilityGraphObstacleData;
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
  const stepRoute = createOneClickClearStepRouteRuntime(context, job);
  if (context.stepRouteRequired && !stepRoute) {
    return {
      jobId: job.id,
      routeMapPixelsElapsedMs: 0,
      routePathfindingElapsedMs: 0,
    };
  }

  const pathfindingStartedAt = nowMs();
  const route =
    context.routeMode === "theta-star"
      ? await buildGraphwarThetaStarPathForMask({
          bounds: context.bounds,
          boundsRect: context.boundsRect,
          boundaryExpansion: context.boundaryExpansion,
          ...stepRoute?.runtime,
          routeMask: context.routeMask,
          routeTolerancePlanePixels: context.routeTolerancePlanePixels,
          scratch: context.thetaStarScratch,
          startPoint: job.startPoint,
          targetPoint: job.targetPoint,
        })
      : await buildGraphwarVisibilityGraphPathForMask({
          bounds: context.bounds,
          boundsRect: context.boundsRect,
          boundaryExpansion: context.boundaryExpansion,
          ...stepRoute?.runtime,
          routeMask: context.routeMask,
          routeTolerancePlanePixels: context.routeTolerancePlanePixels,
          startPoint: job.startPoint,
          targetPoint: job.targetPoint,
          visibilityGraphObstacleData: context.visibilityGraphObstacleData,
        });
  const routePathfindingElapsedMs = nowMs() - pathfindingStartedAt;

  // 没有至少一段可画路线时不做像素映射；route-map-pixels 只统计实际映射工作。
  if (!route || route.length < 2) {
    return {
      jobId: job.id,
      routeMapPixelsElapsedMs: 0,
      routePathfindingElapsedMs,
    };
  }

  const mapStartedAt = nowMs();
  const pixelRoute = route.map((point) => planeGridCellCenterToImagePoint(point, context.boundsRect));
  const routeMapPixelsElapsedMs = nowMs() - mapStartedAt;

  // 首尾必须回到原始截图控制点；中间点才来自平面格点中心映射。
  pixelRoute[0] = job.startPoint;
  pixelRoute[pixelRoute.length - 1] = job.targetPoint;
  for (let index = 1; index < pixelRoute.length; index += 1) {
    const previousPoint = pixelRoute[index - 1];
    const point = pixelRoute[index];
    if (
      previousPoint &&
      point &&
      !pointAdvancesByMinimumAutomaticForwardStep(previousPoint, point, context.bounds, context.boundsRect)
    ) {
      return {
        jobId: job.id,
        routeMapPixelsElapsedMs,
        routePathfindingElapsedMs,
      };
    }
  }
  if (stepRoute) {
    const validation = validateGraphwarStepRoutePath({
      boundaryInset: context.boundaryExpansion,
      bounds: context.bounds,
      boundsRect: context.boundsRect,
      initialResolvedY: stepRoute.resolvedStartY,
      ...(stepRoute.resolvedStartStateKey === undefined
        ? {}
        : { initialRouteStateKey: stepRoute.resolvedStartStateKey }),
      model: stepRoute.model,
      points: pixelRoute,
      summedArea: stepRoute.summedArea,
    });
    if (!validation.ok || validation.resolvedEndY === undefined) {
      return {
        jobId: job.id,
        routeMapPixelsElapsedMs,
        routePathfindingElapsedMs,
      };
    }
    return {
      jobId: job.id,
      ...(validation.routeStateKey === undefined ? {} : { resolvedEndStateKey: validation.routeStateKey }),
      resolvedEndY: validation.resolvedEndY,
      route: pixelRoute,
      routeMapPixelsElapsedMs,
      routePathfindingElapsedMs,
    };
  }
  return {
    jobId: job.id,
    route: pixelRoute,
    routeMapPixelsElapsedMs,
    routePathfindingElapsedMs,
  };
}

/** 把具体 DAG 标签的累计高度适配成两种路由器共用的 Step runtime。 */
function createOneClickClearStepRouteRuntime(
  context: GraphwarOneClickClearDagEdgeRouteBuildContext,
  job: GraphwarOneClickClearDagEdgeBuildJob,
) {
  const model = context.stepRouteModel;
  const summedArea = context.stepRouteSummedArea;
  const resolvedStartY = job.resolvedStartY;
  const resolvedStartStateKey = job.resolvedStartStateKey;
  if (
    !model ||
    !summedArea ||
    resolvedStartY === undefined ||
    !Number.isFinite(resolvedStartY) ||
    resolvedStartStateKey === undefined
  ) {
    return undefined;
  }
  return {
    model,
    resolvedStartStateKey,
    resolvedStartY,
    runtime: createGraphwarStepPathfindingEdgeEvaluator({
      boundaryInset: context.boundaryExpansion,
      bounds: context.bounds,
      boundsRect: context.boundsRect,
      exactStartPoint: job.startPoint,
      exactTargetPoint: job.targetPoint,
      model,
      resolvedStartStateKey,
      resolvedStartY,
      summedArea,
    }),
    summedArea,
  };
}
