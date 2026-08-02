import { beforeAll, describe, expect, it } from "vitest";

import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { graphToImagePoint } from "../../core/geometry";
import { imagePointToPlaneGridPoint } from "../../core/plane-grid";
import {
  createGraphPoint,
  createPixelPoint,
  type BoundsRect,
  type GraphBounds,
  type PixelPoint,
} from "../../core/types";
import { readGraphwarKernelBytes } from "../../core/wasm/kernel-test-fixture";
import { instantiateGraphwarWasmRuntime } from "../../core/wasm/runtime";
import { createGraphwarTrajectoryFormulaMode } from "../../formula/trajectory/sampling";
import {
  createGraphwarStepRouteModel,
  createGraphwarStepRouteSummedArea,
  validateGraphwarStepRoutePath,
} from "../routing/step-route";
import type {
  GraphwarOneClickClearBuildOptions,
  GraphwarOneClickClearDagEdgeBuildJob,
  GraphwarOneClickClearDagEdgeBuildRequest,
  GraphwarOneClickClearDagEdgeRoute,
} from "./search";
import { buildGraphwarOneClickClearPath } from "./search";

const bounds: GraphBounds = { maxX: -25, maxY: 15, minX: 25, minY: -15 };
const boundsRect: BoundsRect = { height: GRAPHWAR_PLANE_HEIGHT, width: GRAPHWAR_PLANE_LENGTH, x: 0, y: 0 };
const emptyMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
let kernelModule: WebAssembly.Module;

beforeAll(async () => {
  kernelModule = await WebAssembly.compile(await readGraphwarKernelBytes());
});

describe("one-click-clear mirrored WASM guard", () => {
  it("falls back to forward-ordered TypeScript edge jobs", async () => {
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule);
    const start = createPixelPoint(700, 225);
    const candidates = [
      { id: "left", isEnemy: true, hitCenter: createPixelPoint(650, 225), hitRadius: 30 },
      { id: "far-left", isEnemy: true, hitCenter: createPixelPoint(550, 225), hitRadius: 30 },
    ];
    const requests: GraphwarOneClickClearDagEdgeBuildRequest[] = [];

    const result = await buildGraphwarOneClickClearPath({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      buildDagEdges: async (request) => {
        requests.push(request);
        return { routes: [], timings: [] };
      },
      candidates,
      deleteHitCheckRadiusPixels: 0,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "y",
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
        steepness: 67,
      }),
      hitCandidates: candidates,
      isDeleteOptimizationEnabled: false,
      pathPoints: [start],
      routeMask: { mask: emptyMask, routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      simulationBoundaryExpansion: 0,
      simulationMaskCacheId: 0,
      wasmRequestNonce: 17,
      wasmRuntime: runtime,
    } satisfies GraphwarOneClickClearBuildOptions);

    expect(result.type).toBe("failure");
    const jobs = requests.flatMap(({ jobs: batch }) => batch);
    expect(jobs).toHaveLength(3);
    expect(jobs.filter(({ from }) => from === -1).map(({ targetPoint }) => targetPoint.x)).toEqual([650, 550]);
    expect(jobs.every(isStatelessJob)).toBe(true);
  });

  it("keeps a selected WASM job identity when an earlier job is unreachable", async () => {
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule);
    const start = createPixelPoint(100, 225);
    const candidates = [
      { id: "unreachable", isEnemy: true, hitCenter: createPixelPoint(250, 300), hitRadius: 2 },
      { id: "selected", isEnemy: true, hitCenter: createPixelPoint(400, 225), hitRadius: 30 },
    ];

    const result = await buildGraphwarOneClickClearPath({
      boundaryExpansion: 0,
      bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
      boundsRect,
      buildDagEdges: async (request) => ({
        routes: request.jobs
          .filter(isStatelessJob)
          .flatMap((job) => (job.targetPoint.x === 400 ? [createSuccessfulEdgeRoute(job)] : [])),
        timings: [],
      }),
      candidates,
      deleteHitCheckRadiusPixels: 0,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "y",
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
        steepness: 67,
      }),
      hitCandidates: candidates,
      isDeleteOptimizationEnabled: false,
      pathPoints: [start],
      routeMask: { mask: emptyMask, routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      simulationBoundaryExpansion: 0,
      simulationMask: emptyMask,
      simulationMaskCacheId: 1,
      wasmRequestNonce: 18,
      wasmRuntime: runtime,
    } satisfies GraphwarOneClickClearBuildOptions);

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.targetIds).toEqual(["selected"]);
      expect(result.pathPoints.at(-1)).toEqual(createPixelPoint(400, 225));
    }
  });

  it("keeps multi-target optimization on the exact WASM trajectory fallback", async () => {
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule);
    const start = createPixelPoint(100, 225);
    const first = createPixelPoint(300, 225);
    const second = createPixelPoint(500, 225);
    const candidates = [
      { id: "first", isEnemy: true, hitCenter: first, hitRadius: 20 },
      { id: "second", isEnemy: true, hitCenter: second, hitRadius: 20 },
    ];
    const result = await buildGraphwarOneClickClearPath({
      boundaryExpansion: 0,
      bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
      boundsRect,
      buildDagEdges: async (request) => ({
        routes: request.jobs.filter(isStatelessJob).map((job) => createSuccessfulEdgeRoute(job)),
        timings: [],
      }),
      candidates,
      deleteHitCheckRadiusPixels: 0,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "y",
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
        steepness: 67,
      }),
      hitCandidates: candidates,
      isDeleteOptimizationEnabled: true,
      pathPoints: [start],
      routeMask: { mask: emptyMask, routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      simulationBoundaryExpansion: 0,
      simulationMask: emptyMask,
      simulationMaskCacheId: 1,
      wasmRequestNonce: 19,
      wasmRuntime: runtime,
    } satisfies GraphwarOneClickClearBuildOptions);

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.targetIds).toEqual(["first", "second"]);
    }
  });

  it("drops the ordinary WASM obstacle terminal sample from the incumbent", async () => {
    const baselineRuntime = await instantiateGraphwarWasmRuntime(kernelModule);
    const ordinaryBounds: GraphBounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
    const start = createPixelPoint(100, 225);
    const target = createPixelPoint(400, 225);
    const candidates = [
      { id: "unreachable", isEnemy: true, hitCenter: createPixelPoint(250, 300), hitRadius: 2 },
      { id: "target", isEnemy: true, hitCenter: target, hitRadius: 30 },
    ];
    const createOptions = (
      simulationMask: Uint8Array,
      runtime: Awaited<ReturnType<typeof instantiateGraphwarWasmRuntime>>,
    ) =>
      ({
        boundaryExpansion: 0,
        bounds: ordinaryBounds,
        boundsRect,
        buildDagEdges: async (request: GraphwarOneClickClearDagEdgeBuildRequest) => ({
          routes: request.jobs
            .filter(isStatelessJob)
            .filter((job) => job.targetPoint.x === target.x)
            .map((job) => createSuccessfulEdgeRoute(job)),
          timings: [],
        }),
        candidates,
        deleteHitCheckRadiusPixels: 0,
        formulaMode: createGraphwarTrajectoryFormulaMode({
          algorithm: "abs",
          decimalPlaces: 4,
          equation: "y",
          isStepGlitchModeEnabled: false,
          isStepOverflowProtectionEnabled: true,
          steepness: 67,
        }),
        hitCandidates: candidates,
        isDeleteOptimizationEnabled: false,
        pathPoints: [start],
        routeMask: { mask: simulationMask, routeTolerancePlanePixels: 2 },
        routeMode: "visibility-graph" as const,
        simulationBoundaryExpansion: 0,
        simulationMask,
        simulationMaskCacheId: 1,
        wasmRuntime: runtime,
      }) satisfies GraphwarOneClickClearBuildOptions;

    const baseline = await buildGraphwarOneClickClearPath(
      createOptions(new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT), baselineRuntime),
    );
    expect(baseline.type).toBe("success");
    if (baseline.type !== "success") {
      return;
    }
    const obstaclePoint = baseline.trajectoryPoints.at(-2);
    if (!obstaclePoint) {
      throw new Error("expected a natural trajectory beyond the target");
    }
    const simulationMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    simulationMask[toMaskIndex(obstaclePoint)] = 1;

    const result = await buildGraphwarOneClickClearPath(
      createOptions(simulationMask, await instantiateGraphwarWasmRuntime(kernelModule)),
    );
    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.trajectoryPoints.some((point) => toMaskIndex(point) === toMaskIndex(obstaclePoint))).toBe(false);
      expect(result.trajectoryPoints.length).toBeLessThan(baseline.trajectoryPoints.length);
    }
  });

  it("keeps a strict Step control point when WASM deletion rejects the shortcut", async () => {
    const forwardBounds: GraphBounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
    const start = graphToImagePoint(createGraphPoint(-20, 0), forwardBounds, boundsRect);
    const middle = graphToImagePoint(createGraphPoint(-15, 4), forwardBounds, boundsRect);
    const target = graphToImagePoint(createGraphPoint(-10, 4), forwardBounds, boundsRect);
    const routeMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    const obstacle = imagePointToPlaneGridPoint(
      graphToImagePoint(createGraphPoint(-10.1, 2), forwardBounds, boundsRect),
      boundsRect,
    );
    routeMask[obstacle.y * GRAPHWAR_PLANE_LENGTH + obstacle.x] = 1;
    const stepSettings = {
      algorithm: "step" as const,
      decimalPlaces: 4,
      equation: "y" as const,
      isStepGlitchModeEnabled: false,
      isStepOverflowProtectionEnabled: true,
      steepness: 67,
    };
    const model = createGraphwarStepRouteModel(0, stepSettings);
    if (!model) {
      throw new Error("expected a strict Step route model");
    }
    const summedArea = createGraphwarStepRouteSummedArea(routeMask);
    const validateStepRoute = (points: readonly PixelPoint[]) =>
      validateGraphwarStepRoutePath({
        boundaryInset: 0,
        bounds: forwardBounds,
        boundsRect,
        model,
        points,
        summedArea,
      }).ok;
    expect(validateStepRoute([start, middle, target])).toBe(true);
    expect(validateStepRoute([start, target])).toBe(false);

    const candidate = { id: "target", isEnemy: true, hitCenter: target, hitRadius: 2 };
    let yieldCount = 0;
    const result = await buildGraphwarOneClickClearPath({
      boundaryExpansion: 0,
      bounds: forwardBounds,
      boundsRect,
      buildDagEdges: async (request) => ({
        routes: request.jobs
          .filter(isStepStatefulJob)
          .map((job) => createSuccessfulStepRoute(job, [job.startPoint, middle, job.targetPoint])),
        timings: [],
      }),
      candidates: [candidate],
      deleteHitCheckRadiusPixels: 0,
      formulaMode: createGraphwarTrajectoryFormulaMode(stepSettings),
      hitCandidates: [candidate],
      isDeleteOptimizationEnabled: true,
      pathPoints: [start],
      routeMask: { mask: routeMask, routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      simulationBoundaryExpansion: 0,
      simulationMaskCacheId: 0,
      validateStepRoute,
      wasmRuntime: await instantiateGraphwarWasmRuntime(kernelModule),
      yieldControl: () => {
        yieldCount += 1;
      },
    } satisfies GraphwarOneClickClearBuildOptions);

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.pathPoints).toEqual([start, middle]);
      expect(result.targetIds).toEqual(["target"]);
    }
    expect(yieldCount).toBeGreaterThan(0);
  });

  it("removes the edge that owns an invalid Step segment before retrying the DAG", async () => {
    const forwardBounds: GraphBounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
    const start = graphToImagePoint(createGraphPoint(-20, 0), forwardBounds, boundsRect);
    const middle = graphToImagePoint(createGraphPoint(-15, 4), forwardBounds, boundsRect);
    const firstTarget = graphToImagePoint(createGraphPoint(-10, 4), forwardBounds, boundsRect);
    const secondTarget = graphToImagePoint(createGraphPoint(-5, 4), forwardBounds, boundsRect);
    const routeMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    const obstacle = imagePointToPlaneGridPoint(
      graphToImagePoint(createGraphPoint(-10.1, 2), forwardBounds, boundsRect),
      boundsRect,
    );
    routeMask[obstacle.y * GRAPHWAR_PLANE_LENGTH + obstacle.x] = 1;
    const stepSettings = {
      algorithm: "step" as const,
      decimalPlaces: 4,
      equation: "y" as const,
      isStepGlitchModeEnabled: false,
      isStepOverflowProtectionEnabled: true,
      steepness: 67,
    };
    const model = createGraphwarStepRouteModel(0, stepSettings);
    if (!model) {
      throw new Error("expected a strict Step route model");
    }
    const summedArea = createGraphwarStepRouteSummedArea(routeMask);
    const validateStepRoute = (points: readonly PixelPoint[]) =>
      validateGraphwarStepRoutePath({
        boundaryInset: 0,
        bounds: forwardBounds,
        boundsRect,
        model,
        points,
        summedArea,
      });
    expect(validateStepRoute([start, firstTarget]).ok).toBe(false);
    expect(validateStepRoute([start, middle, secondTarget]).ok).toBe(true);
    expect(validateStepRoute([firstTarget, secondTarget]).ok).toBe(true);

    const candidates = [
      { id: "first", isEnemy: true, hitCenter: firstTarget, hitRadius: 3 },
      { id: "second", isEnemy: true, hitCenter: secondTarget, hitRadius: 3 },
    ];
    const removedEdges: string[] = [];
    const result = await buildGraphwarOneClickClearPath({
      boundaryExpansion: 0,
      bounds: forwardBounds,
      boundsRect,
      buildDagEdges: async (request) => ({
        routes: request.jobs.filter(isStepStatefulJob).flatMap((job) => {
          if (job.from === -1 && samePixelPoint(job.targetPoint, firstTarget)) {
            return [createSuccessfulStepRoute(job, [job.startPoint, job.targetPoint])];
          }
          if (job.from === -1 && samePixelPoint(job.targetPoint, secondTarget)) {
            return [createSuccessfulStepRoute(job, [job.startPoint, middle, job.targetPoint])];
          }
          if (samePixelPoint(job.startPoint, firstTarget) && samePixelPoint(job.targetPoint, secondTarget)) {
            return [createSuccessfulStepRoute(job, [job.startPoint, job.targetPoint])];
          }
          return [];
        }),
        timings: [],
      }),
      candidates,
      deleteHitCheckRadiusPixels: 0,
      formulaMode: createGraphwarTrajectoryFormulaMode(stepSettings),
      hitCandidates: candidates,
      isDeleteOptimizationEnabled: false,
      onDebugTiming: ({ stage }) => {
        if (stage === "remove-failed-edge") {
          removedEdges.push(stage);
        }
      },
      pathPoints: [start],
      routeMask: { mask: routeMask, routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      simulationBoundaryExpansion: 0,
      simulationMaskCacheId: 0,
      validateStepRoute,
      wasmRuntime: await instantiateGraphwarWasmRuntime(kernelModule),
    } satisfies GraphwarOneClickClearBuildOptions);

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.targetIds).toEqual(["first", "second"]);
    }
    expect(removedEdges).toHaveLength(1);
  });
});

function isStatelessJob(
  job: GraphwarOneClickClearDagEdgeBuildJob,
): job is Extract<GraphwarOneClickClearDagEdgeBuildJob, { type: "stateless" }> {
  return job.type === "stateless";
}

function isStepStatefulJob(
  job: GraphwarOneClickClearDagEdgeBuildJob,
): job is Extract<GraphwarOneClickClearDagEdgeBuildJob, { type: "step-stateful" }> {
  return job.type === "step-stateful";
}

function createSuccessfulEdgeRoute(job: Extract<GraphwarOneClickClearDagEdgeBuildJob, { type: "stateless" }>) {
  return {
    jobId: job.id,
    route: [job.startPoint, job.targetPoint],
    type: "stateless",
  } satisfies GraphwarOneClickClearDagEdgeRoute;
}

function createSuccessfulStepRoute(
  job: Extract<GraphwarOneClickClearDagEdgeBuildJob, { type: "step-stateful" }>,
  route: PixelPoint[],
) {
  return {
    jobId: job.id,
    route,
    stepRouteEndState: { resolvedStateKey: "40000", resolvedY: 4 },
    type: "step-stateful",
  } satisfies GraphwarOneClickClearDagEdgeRoute;
}

function toMaskIndex(point: PixelPoint) {
  const x = Math.max(0, Math.min(GRAPHWAR_PLANE_LENGTH - 1, Math.trunc(point.x)));
  const y = Math.max(0, Math.min(GRAPHWAR_PLANE_HEIGHT - 1, Math.trunc(point.y)));
  return y * GRAPHWAR_PLANE_LENGTH + x;
}

function samePixelPoint(left: PixelPoint, right: PixelPoint) {
  return left.x === right.x && left.y === right.y;
}
