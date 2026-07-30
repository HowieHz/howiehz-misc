import { GraphwarWasmFault } from "../../core/algorithm-backend";
import { pointAdvancesByMinimumAutomaticForwardStep } from "../../core/game/forward-rule";
import { imageToGraphPoint, xPlusGoesRight } from "../../core/geometry";
import {
  imagePointToPlaneGridPoint,
  mirrorPlaneGridPoint,
  planeGridCellCenterToImagePoint,
  type PlaneGridPoint,
} from "../../core/plane-grid";
import { nowMs } from "../../core/time";
import type { BoundsRect, GraphBounds } from "../../core/types";
import type { GraphwarWasmRouteContext } from "../../core/wasm/route-adapter";
import type { GraphwarPathSearchRuntimePolicy } from "../routing/policy";
import type { GraphwarStepRouteRuntime } from "../routing/step-route";
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
import { isGraphwarOneClickClearStepRouteState } from "./step-route-state";

/** 单边建路所需的共享上下文；可视图轮廓 cache 的生命周期由调用方控制。 */
interface GraphwarOneClickClearDagEdgeRouteBuildContextBase {
  /** 当前 Graphwar 坐标边界。 */
  bounds: GraphBounds;
  /** 截图内 Graphwar 坐标系矩形。 */
  boundsRect: BoundsRect;
  /** 障碍和坐标系边界命中检测的内收值，单位为 Graphwar 原始平面像素。 */
  boundaryExpansion: number;
  /** 已按 route tolerance 处理后的障碍 mask。 */
  routeMask: Uint8Array;
  /** 当前 route tolerance，单位为 Graphwar 原始平面像素，供可视图轮廓简化使用。 */
  routeTolerancePlanePixels: number;
  /** 与当前 worker 或串行批次同生命周期的 Theta* 工作区；可减少一键清图重复分配。 */
  thetaStarScratch?: GraphwarThetaStarScratch;
  /** 与 routeMask 同生命周期的可视图数据；Theta* 模式不需要。 */
  visibilityGraphObstacleData?: GraphwarVisibilityGraphObstacleData;
  /** Optional coarse WASM route core retained for the edge-session lifetime. */
  wasmRouteContext?: GraphwarWasmRouteContext;
}

/** 单边建路的路线选择与 Step runtime 是同一判别联合，不允许出现两种半状态。 */
export type GraphwarOneClickClearDagEdgeRouteBuildContext = GraphwarOneClickClearDagEdgeRouteBuildContextBase &
  Exclude<GraphwarPathSearchRuntimePolicy<GraphwarStepRouteRuntime, never>, { type: "step-glitch" }>;

/**
 * 构建单条一键清图 DAG 边路线。
 *
 * 平面寻路只负责绕障；输出路线的首尾点使用 job 中的原始截图像素点，避免格点中心映射把士兵命中点挪开。
 *
 * 找不到有效路线时返回 `unreachable`，调用方仍可用 jobId 把失败边合并回 DAG 结果。
 */
export async function buildOneClickClearDagEdgeRoute(
  context: GraphwarOneClickClearDagEdgeRouteBuildContext,
  job: GraphwarOneClickClearDagEdgeBuildJob,
): Promise<GraphwarOneClickClearEdgeWorkerJobResult> {
  if (context.type !== job.type) {
    throw createOneClickClearEdgeIdentityError(context, "One-Click Clear edge job does not match its route policy");
  }
  if (job.type === "step-stateful" && !isGraphwarOneClickClearStepRouteState(job.stepRouteStartState)) {
    throw createOneClickClearEdgeIdentityError(context, "One-Click Clear edge job has an invalid canonical Step state");
  }
  const stepRoute =
    context.type === "step-stateful" && job.type === "step-stateful"
      ? createOneClickClearStepRouteRuntime(context, job)
      : undefined;

  const pathfindingStartedAt = nowMs();
  const wasmRouteContext = context.wasmRouteContext;
  const hasWasmRouteBackend = wasmRouteContext !== undefined;
  const wasmRoute = wasmRouteContext ? findWasmRoute(wasmRouteContext, context, job, stepRoute) : undefined;
  const route = hasWasmRouteBackend
    ? wasmRoute?.path
    : context.routeMode === "theta-star"
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
      type: "unreachable",
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
        type: "unreachable",
      };
    }
  }
  if (wasmRoute?.type === "step-stateful") {
    return {
      jobId: job.id,
      route: pixelRoute,
      routeMapPixelsElapsedMs,
      routePathfindingElapsedMs,
      stepRouteEndState: {
        resolvedStateKey: wasmRoute.terminalState.routeStateKey,
        resolvedY: wasmRoute.terminalState.resolvedY,
      },
      type: "step-stateful",
    };
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
    if (!validation.ok) {
      return {
        jobId: job.id,
        routeMapPixelsElapsedMs,
        routePathfindingElapsedMs,
        type: "unreachable",
      };
    }
    if (validation.routeStateKey === undefined) {
      throw createOneClickClearEdgeIdentityError(
        context,
        "One-Click Clear Step route validation did not produce a canonical terminal state",
      );
    }
    return {
      jobId: job.id,
      route: pixelRoute,
      routeMapPixelsElapsedMs,
      routePathfindingElapsedMs,
      stepRouteEndState: {
        resolvedStateKey: validation.routeStateKey,
        resolvedY: validation.resolvedEndY,
      },
      type: "step-stateful",
    };
  }
  return {
    jobId: job.id,
    route: pixelRoute,
    routeMapPixelsElapsedMs,
    routePathfindingElapsedMs,
    type: "stateless",
  };
}

/** Internal policy/state mismatches become ABI faults only after WASM was selected for this edge. */
function createOneClickClearEdgeIdentityError(context: GraphwarOneClickClearDagEdgeRouteBuildContext, message: string) {
  return context.wasmRouteContext ? new GraphwarWasmFault("abi", message) : new Error(message);
}

/** Maps the coarse WASM route command to this edge's stable pixel endpoints. */
type GraphwarOneClickClearWasmEdgeRoute =
  | { path: PlaneGridPoint[]; type: "stateless" }
  | {
      path: PlaneGridPoint[];
      terminalState: { resolvedY: number; routeStateKey: string };
      type: "step-stateful";
    };

function findWasmRoute(
  wasmRouteContext: GraphwarWasmRouteContext,
  context: GraphwarOneClickClearDagEdgeRouteBuildContext,
  job: GraphwarOneClickClearDagEdgeBuildJob,
  stepRoute: ReturnType<typeof createOneClickClearStepRouteRuntime> | undefined,
): GraphwarOneClickClearWasmEdgeRoute | undefined {
  const isMirrored = !xPlusGoesRight(context.bounds);
  const start = mirrorPlaneGridPoint(imagePointToPlaneGridPoint(job.startPoint, context.boundsRect), isMirrored);
  const target = mirrorPlaneGridPoint(imagePointToPlaneGridPoint(job.targetPoint, context.boundsRect), isMirrored);
  const exactStart = imageToGraphPoint(job.startPoint, context.bounds, context.boundsRect);
  const exactTarget = imageToGraphPoint(job.targetPoint, context.bounds, context.boundsRect);
  if (context.type === "step-stateful") {
    if (!wasmRouteContext.stepRoute || !stepRoute) {
      throw new GraphwarWasmFault("abi", "One-Click Clear WASM route context did not retain its Step model");
    }
    const result =
      context.routeMode === "theta-star"
        ? wasmRouteContext.stepRoute.findThetaStarPath({
            exactStart,
            exactTarget,
            initialState: {
              resolvedY: stepRoute.resolvedStartY,
              routeStateKey: stepRoute.resolvedStartStateKey,
            },
            start,
            target,
          })
        : wasmRouteContext.stepRoute.findVisibilityGraphPath({
            exactStart,
            exactTarget,
            initialState: {
              resolvedY: stepRoute.resolvedStartY,
              routeStateKey: stepRoute.resolvedStartStateKey,
            },
            start,
            target,
          });
    return result.type === "success"
      ? {
          path: result.path.map((point) => mirrorPlaneGridPoint(point, isMirrored)),
          terminalState: result.terminalState,
          type: "step-stateful",
        }
      : undefined;
  }
  const result =
    context.routeMode === "theta-star"
      ? wasmRouteContext.findThetaStarPath(start, target)
      : wasmRouteContext.findVisibilityGraphPath(start, target);
  return result.type === "success"
    ? { path: result.path.map((point) => mirrorPlaneGridPoint(point, isMirrored)), type: "stateless" }
    : undefined;
}

/** 把具体 DAG 标签的累计高度适配成两种路由器共用的 Step runtime。 */
function createOneClickClearStepRouteRuntime(
  context: Extract<GraphwarOneClickClearDagEdgeRouteBuildContext, { type: "step-stateful" }>,
  job: Extract<GraphwarOneClickClearDagEdgeBuildJob, { type: "step-stateful" }>,
) {
  const runtime = context.runtime;
  const startState = job.stepRouteStartState;
  const { model, summedArea } = runtime;
  const { resolvedStateKey: resolvedStartStateKey, resolvedY: resolvedStartY } = startState;
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
