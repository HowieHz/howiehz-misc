import { beforeAll, describe, expect, it, vi } from "vitest";

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
import { graphwarWasmCompositionLayout } from "../../core/wasm/composition-adapter";
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

  it("runs the existing prefix proof through the WASM trajectory adapter", async () => {
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule);
    const runTrajectory = vi.spyOn(runtime, "runTrajectory");
    const start = createPixelPoint(700, 225);
    const prefix = createPixelPoint(650, 225);
    const candidate = { id: "target", isEnemy: true, hitCenter: createPixelPoint(500, 225), hitRadius: 30 };

    try {
      const result = await buildGraphwarOneClickClearPath({
        boundaryExpansion: 0,
        bounds,
        boundsRect,
        buildDagEdges: async () => ({ routes: [], timings: [] }),
        candidates: [candidate],
        deleteHitCheckRadiusPixels: 0,
        formulaMode: createGraphwarTrajectoryFormulaMode({
          algorithm: "abs",
          decimalPlaces: 4,
          equation: "y",
          isStepGlitchModeEnabled: false,
          isStepOverflowProtectionEnabled: true,
          steepness: 67,
        }),
        hitCandidates: [candidate],
        isDeleteOptimizationEnabled: false,
        pathPoints: [start, prefix],
        routeMask: { mask: emptyMask, routeTolerancePlanePixels: 2 },
        routeMode: "visibility-graph",
        simulationBoundaryExpansion: 0,
        simulationMask: emptyMask,
        simulationMaskCacheId: 1,
        wasmRequestNonce: 25,
        wasmRuntime: runtime,
      } satisfies GraphwarOneClickClearBuildOptions);

      expect(result.type).toBe("failure");
      expect(runTrajectory).toHaveBeenCalledTimes(1);
    } finally {
      runTrajectory.mockRestore();
    }
  });

  it("validates selected route geometry through the WASM route-only composition", async () => {
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule);
    const runSmartPathfinding = vi.spyOn(runtime, "runSmartPathfinding");
    const start = createPixelPoint(700, 225);
    const target = createPixelPoint(500, 225);
    const candidates = [{ id: "target", isEnemy: true, hitCenter: target, hitRadius: 30 }];

    const result = await buildGraphwarOneClickClearPath({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      buildDagEdges: async (request) => ({
        routes: request.jobs.filter(isStatelessJob).map((job) => ({
          jobId: job.id,
          route: [job.startPoint, createPixelPoint(job.startPoint.x, job.startPoint.y - 10), job.targetPoint],
          type: "stateless" as const,
        })),
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
      wasmRequestNonce: 24,
      wasmRuntime: runtime,
    } satisfies GraphwarOneClickClearBuildOptions);

    expect(result).toMatchObject({ reason: "no-usable-target", type: "failure" });
    expect(runSmartPathfinding).toHaveBeenCalled();
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

  it("does not fall back to the TypeScript longest-path DP after a normal WASM no-route result", async () => {
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule);
    const start = createPixelPoint(700, 225);
    const target = createPixelPoint(500, 225);
    const candidates = [{ id: "target", isEnemy: true, hitCenter: target, hitRadius: 30 }];
    const resume = runtime.resumeOneClickClear.bind(runtime);
    const resumeSpy = vi.spyOn(runtime, "resumeOneClickClear").mockImplementation((inputPointer, inputByteLength) => {
      const input = new DataView(runtime.buffer, inputPointer, inputByteLength);
      const sessionPointer = input.getUint32(0, true);
      const session = new DataView(
        runtime.buffer,
        sessionPointer,
        graphwarWasmCompositionLayout.oneClickSessionByteLength,
      );
      const sourcePathX = session.getUint32(32, true);
      const sourcePathY = session.getUint32(36, true);
      const sourcePathCount = session.getUint32(40, true);
      const resultPointer = resume(inputPointer, inputByteLength);
      const result = new DataView(
        runtime.buffer,
        resultPointer,
        graphwarWasmCompositionLayout.oneClickResultByteLength,
      );
      // Force a valid terminal business failure with the retained source path.
      // This models an authoritative WASM no-route result; the search must not
      // reinterpret the already-built edges through its TypeScript DP.
      result.setUint32(4, 2, true);
      result.setUint32(28, sourcePathX, true);
      result.setUint32(32, sourcePathY, true);
      result.setUint32(36, sourcePathCount, true);
      result.setUint32(40, 0, true);
      result.setUint32(52, 0, true);
      result.setUint32(56, 0, true);
      result.setUint32(60, 0, true);
      return resultPointer;
    });

    try {
      const result = await buildGraphwarOneClickClearPath({
        boundaryExpansion: 0,
        bounds,
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
        isDeleteOptimizationEnabled: false,
        pathPoints: [start],
        routeMask: { mask: emptyMask, routeTolerancePlanePixels: 2 },
        routeMode: "visibility-graph",
        simulationBoundaryExpansion: 0,
        simulationMask: emptyMask,
        simulationMaskCacheId: 1,
        wasmRequestNonce: 21,
        wasmRuntime: runtime,
      } satisfies GraphwarOneClickClearBuildOptions);

      expect(result).toMatchObject({ reason: "no-usable-target", type: "failure" });
    } finally {
      resumeSpy.mockRestore();
    }
  });

  it("does not fall back to the TypeScript longest-path DP after a stateful WASM no-route result", async () => {
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule);
    const resume = runtime.resumeOneClickClear.bind(runtime);
    const resumeSpy = vi.spyOn(runtime, "resumeOneClickClear").mockImplementation((inputPointer, inputByteLength) => {
      const input = new DataView(runtime.buffer, inputPointer, inputByteLength);
      const sessionPointer = input.getUint32(0, true);
      const session = new DataView(
        runtime.buffer,
        sessionPointer,
        graphwarWasmCompositionLayout.oneClickSessionByteLength,
      );
      const sourcePathX = session.getUint32(32, true);
      const sourcePathY = session.getUint32(36, true);
      const sourcePathCount = session.getUint32(40, true);
      const resultPointer = resume(inputPointer, inputByteLength);
      const result = new DataView(
        runtime.buffer,
        resultPointer,
        graphwarWasmCompositionLayout.oneClickResultByteLength,
      );
      result.setUint32(4, 2, true);
      result.setUint32(28, sourcePathX, true);
      result.setUint32(32, sourcePathY, true);
      result.setUint32(36, sourcePathCount, true);
      result.setUint32(40, 0, true);
      result.setUint32(52, 0, true);
      result.setUint32(56, 0, true);
      result.setUint32(60, 0, true);
      return resultPointer;
    });

    try {
      const start = createPixelPoint(100, 225);
      const target = createPixelPoint(400, 225);
      const candidates = [{ id: "target", isEnemy: true, hitCenter: target, hitRadius: 30 }];
      const stepSettings = {
        algorithm: "step" as const,
        decimalPlaces: 4,
        equation: "y" as const,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
        steepness: 67,
      };
      const result = await buildGraphwarOneClickClearPath({
        boundaryExpansion: 0,
        bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
        boundsRect,
        buildDagEdges: async (request) => ({
          routes: request.jobs
            .filter(isStepStatefulJob)
            .map((job) => createSuccessfulStepRoute(job, [job.startPoint, job.targetPoint])),
          timings: [],
        }),
        candidates,
        deleteHitCheckRadiusPixels: 0,
        formulaMode: createGraphwarTrajectoryFormulaMode(stepSettings),
        hitCandidates: candidates,
        isDeleteOptimizationEnabled: false,
        pathPoints: [start],
        routeMask: { mask: emptyMask, routeTolerancePlanePixels: 2 },
        routeMode: "visibility-graph",
        simulationBoundaryExpansion: 0,
        simulationMask: emptyMask,
        simulationMaskCacheId: 1,
        validateStepRoute: () => true,
        wasmRequestNonce: 23,
        wasmRuntime: runtime,
      } satisfies GraphwarOneClickClearBuildOptions);

      expect(result).toMatchObject({ reason: "no-usable-target", type: "failure" });
    } finally {
      resumeSpy.mockRestore();
    }
  });

  it("runs trajectory deletion proof after route-only composition", async () => {
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule);
    const runSmartPathfinding = runtime.runSmartPathfinding.bind(runtime);
    let trajectorySmartCallCount = 0;
    vi.spyOn(runtime, "runSmartPathfinding").mockImplementation((inputPointer, inputByteLength) => {
      const flags = new DataView(runtime.buffer, inputPointer, inputByteLength).getUint32(8, true);
      if ((flags & 8) !== 0) {
        trajectorySmartCallCount += 1;
      }
      return runSmartPathfinding(inputPointer, inputByteLength);
    });
    const start = createPixelPoint(100, 225);
    const first = createPixelPoint(300, 225);
    const second = createPixelPoint(500, 225);
    const middle = createPixelPoint(200, 225);
    const candidates = [
      { id: "first", isEnemy: true, hitCenter: first, hitRadius: 20 },
      { id: "second", isEnemy: true, hitCenter: second, hitRadius: 20 },
    ];
    const result = await buildGraphwarOneClickClearPath({
      boundaryExpansion: 0,
      bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
      boundsRect,
      buildDagEdges: async (request) => ({
        routes: request.jobs.filter(isStatelessJob).map((job) => ({
          jobId: job.id,
          route: [job.startPoint, middle, job.targetPoint],
          type: "stateless" as const,
        })),
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
      expect(result.pathPoints.some((point) => samePixelPoint(point, middle))).toBe(false);
    }
    expect(trajectorySmartCallCount).toBeGreaterThan(0);
  });

  it("does not revalidate an unchanged route-only composition path", async () => {
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule);
    const resume = runtime.resumeOneClickClear.bind(runtime);
    const runTrajectory = vi.spyOn(runtime, "runTrajectory");
    const resumeSpy = vi.spyOn(runtime, "resumeOneClickClear").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = resume(inputPointer, inputByteLength);
      const result = new DataView(
        runtime.buffer,
        resultPointer,
        graphwarWasmCompositionLayout.oneClickResultByteLength,
      );
      // Preserve the exact path while exposing zero-removal route evidence.
      // This models a retained route-only session that performed no deletion.
      result.setUint32(56, 1, true);
      result.setUint32(60, 0, true);
      return resultPointer;
    });
    const start = createPixelPoint(700, 225);
    const target = createPixelPoint(500, 225);
    const simulationMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    simulationMask[toMaskIndex(createPixelPoint(600, 225))] = 1;
    const candidates = [{ id: "blocked", isEnemy: true, hitCenter: target, hitRadius: 30 }];

    try {
      const result = await buildGraphwarOneClickClearPath({
        boundaryExpansion: 0,
        bounds,
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
        isDeleteOptimizationEnabled: false,
        pathPoints: [start],
        routeMask: { mask: emptyMask, routeTolerancePlanePixels: 2 },
        routeMode: "visibility-graph",
        simulationBoundaryExpansion: 0,
        simulationMask,
        simulationMaskCacheId: 1,
        wasmRequestNonce: 32,
        wasmRuntime: runtime,
      } satisfies GraphwarOneClickClearBuildOptions);

      expect(result).toMatchObject({ reason: "no-usable-target", type: "failure" });
      expect(runTrajectory).toHaveBeenCalledTimes(0);
    } finally {
      resumeSpy.mockRestore();
      runTrajectory.mockRestore();
    }
  });

  it("does not report success after ordinary WASM incumbent cancellation", async () => {
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule);
    const runRouteTask = vi.spyOn(runtime, "runRouteTask");
    const start = createPixelPoint(100, 225);
    const first = createPixelPoint(300, 225);
    const second = createPixelPoint(500, 225);
    const candidates = [
      { id: "first", isEnemy: true, hitCenter: first, hitRadius: 20 },
      { id: "second", isEnemy: true, hitCenter: second, hitRadius: 20 },
    ];
    let isCancelled = false;
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
      isCancelled: () => isCancelled,
      isDeleteOptimizationEnabled: true,
      onValidatedIncumbent: () => {
        isCancelled = true;
      },
      pathPoints: [start],
      routeMask: { mask: emptyMask, routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      simulationBoundaryExpansion: 0,
      simulationMask: emptyMask,
      simulationMaskCacheId: 1,
      wasmRequestNonce: 22,
      wasmRuntime: runtime,
    } satisfies GraphwarOneClickClearBuildOptions);

    expect(result).toMatchObject({ reason: "no-usable-target", type: "failure" });
    expect(runRouteTask.mock.calls.some(([command]) => command === 24)).toBe(true);
  });

  it("treats a command-24 result mutation as a WASM fault before publishing", async () => {
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule);
    const originalRunRouteTask = runtime.runRouteTask.bind(runtime);
    const runRouteTask = vi
      .spyOn(runtime, "runRouteTask")
      .mockImplementation((command, inputPointer, inputByteLength) => {
        const resultPointer = originalRunRouteTask(command, inputPointer, inputByteLength);
        if (command === 24) {
          new DataView(
            runtime.buffer,
            resultPointer,
            graphwarWasmCompositionLayout.oneClickIncumbentCompareResultByteLength,
          ).setUint32(4, 2, true);
        }
        return resultPointer;
      });
    const start = createPixelPoint(100, 225);
    const target = createPixelPoint(300, 225);
    const candidates = [{ id: "target", isEnemy: true, hitCenter: target, hitRadius: 20 }];
    const incumbents: unknown[] = [];

    await expect(
      buildGraphwarOneClickClearPath({
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
        isDeleteOptimizationEnabled: false,
        onValidatedIncumbent: (incumbent) => incumbents.push(incumbent),
        pathPoints: [start],
        routeMask: { mask: emptyMask, routeTolerancePlanePixels: 2 },
        routeMode: "visibility-graph",
        simulationBoundaryExpansion: 0,
        simulationMask: emptyMask,
        simulationMaskCacheId: 1,
        wasmRequestNonce: 24,
        wasmRuntime: runtime,
      } satisfies GraphwarOneClickClearBuildOptions),
    ).rejects.toThrow(/incumbent comparison/u);
    expect(runRouteTask.mock.calls.some(([command]) => command === 24)).toBe(true);
    expect(incumbents).toEqual([]);
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

  it("keeps strict Step control and selected target anchors in WASM composition output", async () => {
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
    let typescriptValidationCount = 0;
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
      validateStepRoute: (points) => {
        typescriptValidationCount += 1;
        return validateStepRoute(points);
      },
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
    expect(typescriptValidationCount).toBe(0);
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

  it("derives a WASM Step start state from retained transitions and matches the TS fallback", async () => {
    const forwardBounds: GraphBounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
    const start = graphToImagePoint(createGraphPoint(-20, 0), forwardBounds, boundsRect);
    const prefix = graphToImagePoint(createGraphPoint(-15, 4), forwardBounds, boundsRect);
    const target = graphToImagePoint(createGraphPoint(-10, 4), forwardBounds, boundsRect);
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
    const emptyRouteMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    const expectedPrefix = validateGraphwarStepRoutePath({
      boundaryInset: 0,
      bounds: forwardBounds,
      boundsRect,
      model,
      points: [start, prefix],
      summedArea: createGraphwarStepRouteSummedArea(emptyRouteMask),
    });
    expect(expectedPrefix.ok).toBe(true);
    if (!expectedPrefix.ok) {
      return;
    }

    const candidate = { id: "target", isEnemy: true, hitCenter: target, hitRadius: 4 };
    const createOptions = (
      requests: GraphwarOneClickClearDagEdgeBuildRequest[],
      wasmRuntime?: Awaited<ReturnType<typeof instantiateGraphwarWasmRuntime>>,
    ) =>
      ({
        boundaryExpansion: 0,
        bounds: forwardBounds,
        boundsRect,
        buildDagEdges: async (request: GraphwarOneClickClearDagEdgeBuildRequest) => {
          requests.push(request);
          return { routes: [], timings: [] };
        },
        candidates: [candidate],
        deleteHitCheckRadiusPixels: 0,
        formulaMode: createGraphwarTrajectoryFormulaMode(stepSettings),
        hitCandidates: [candidate],
        isDeleteOptimizationEnabled: false,
        pathPoints: [start, prefix],
        prefixTarget: { center: prefix, radius: 100 },
        routeMask: { mask: emptyRouteMask, routeTolerancePlanePixels: 2 },
        routeMode: "visibility-graph" as const,
        simulationBoundaryExpansion: 0,
        simulationMaskCacheId: 0,
        validateStepRoute: (points: readonly PixelPoint[]) =>
          validateGraphwarStepRoutePath({
            boundaryInset: 0,
            bounds: forwardBounds,
            boundsRect,
            model,
            points,
            summedArea: createGraphwarStepRouteSummedArea(emptyRouteMask),
          }),
        ...(wasmRuntime ? { wasmRuntime } : {}),
      }) satisfies GraphwarOneClickClearBuildOptions;

    const wasmRequests: GraphwarOneClickClearDagEdgeBuildRequest[] = [];
    const wasmRuntime = await instantiateGraphwarWasmRuntime(kernelModule);
    const runRouteTask = vi.spyOn(wasmRuntime, "runRouteTask");
    const wasmResult = await buildGraphwarOneClickClearPath(createOptions(wasmRequests, wasmRuntime));
    const tsRequests: GraphwarOneClickClearDagEdgeBuildRequest[] = [];
    const tsResult = await buildGraphwarOneClickClearPath(createOptions(tsRequests));

    expect(wasmResult.type).toBe("failure");
    expect(tsResult.type).toBe("failure");
    const wasmJob = wasmRequests[0]?.jobs[0];
    const tsJob = tsRequests[0]?.jobs[0];
    expect(wasmJob?.type).toBe("step-stateful");
    expect(tsJob?.type).toBe("step-stateful");
    if (wasmJob?.type !== "step-stateful" || tsJob?.type !== "step-stateful") {
      return;
    }
    expect(wasmJob.stepRouteStartState).toEqual({
      resolvedStateKey: expectedPrefix.routeStateKey ?? "0",
      resolvedY: expectedPrefix.resolvedEndY,
    });
    expect(wasmJob.stepRouteStartState).toEqual(tsJob.stepRouteStartState);
    expect(runRouteTask.mock.calls.some(([command]) => command === 8)).toBe(false);
    expect(runRouteTask.mock.calls.some(([command]) => command === 23)).toBe(true);
    expect(runRouteTask.mock.calls.some(([command]) => command === 22)).toBe(true);
    runRouteTask.mockRestore();
  });

  it("rejects stateful composition when WASM node evidence changes identity", async () => {
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule);
    const beginOneClickClear = runtime.beginOneClickClear.bind(runtime);
    const beginOneClickClearSpy = vi
      .spyOn(runtime, "beginOneClickClear")
      .mockImplementation((inputPointer, inputByteLength) => {
        if (inputByteLength === graphwarWasmCompositionLayout.oneClickInputEvidenceByteLength) {
          const input = new DataView(runtime.buffer, inputPointer, inputByteLength);
          const nodeTargetsPointer = input.getUint32(92, true);
          const nodeTargets = new Uint32Array(runtime.buffer, nodeTargetsPointer, 2);
          const firstTarget = nodeTargets[0];
          const secondTarget = nodeTargets[1];
          if (firstTarget === undefined || secondTarget === undefined) {
            throw new Error("expected two stateful DAG target bindings");
          }
          [nodeTargets[0], nodeTargets[1]] = [secondTarget, firstTarget];
        }
        return beginOneClickClear(inputPointer, inputByteLength);
      });

    const start = createPixelPoint(100, 225);
    const candidates = [
      { id: "first", isEnemy: true, hitCenter: createPixelPoint(300, 225), hitRadius: 4 },
      { id: "second", isEnemy: true, hitCenter: createPixelPoint(500, 225), hitRadius: 4 },
    ];
    const options = {
      boundaryExpansion: 0,
      bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
      boundsRect,
      buildDagEdges: async (request) => ({
        routes: request.jobs
          .filter(isStepStatefulJob)
          .map((job) => createSuccessfulStepRoute(job, [job.startPoint, job.targetPoint])),
        timings: [],
      }),
      candidates,
      deleteHitCheckRadiusPixels: 0,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "step",
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
      validateStepRoute: () => true,
      wasmRequestNonce: 31,
      wasmRuntime: runtime,
    } satisfies GraphwarOneClickClearBuildOptions;

    try {
      await expect(buildGraphwarOneClickClearPath(options)).rejects.toThrow();
    } finally {
      beginOneClickClearSpy.mockRestore();
    }
  });

  it("rejects duplicate Step edge result identities before merging a retained layer", async () => {
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule);
    const start = createPixelPoint(100, 225);
    const candidates = [
      { id: "first", isEnemy: true, hitCenter: createPixelPoint(300, 225), hitRadius: 4 },
      { id: "second", isEnemy: true, hitCenter: createPixelPoint(500, 225), hitRadius: 4 },
    ];
    const options = {
      boundaryExpansion: 0,
      bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
      boundsRect,
      buildDagEdges: async (request: GraphwarOneClickClearDagEdgeBuildRequest) => {
        const job = request.jobs.find(isStepStatefulJob);
        if (!job) {
          return { routes: [], timings: [] };
        }
        const route = createSuccessfulStepRoute(job, [job.startPoint, job.targetPoint]);
        return { routes: [route, { ...route }], timings: [] };
      },
      candidates,
      deleteHitCheckRadiusPixels: 0,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "step",
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
      validateStepRoute: () => true,
      wasmRequestNonce: 32,
      wasmRuntime: runtime,
    } satisfies GraphwarOneClickClearBuildOptions;

    await expect(buildGraphwarOneClickClearPath(options)).rejects.toThrow(/stable job identity/u);
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
