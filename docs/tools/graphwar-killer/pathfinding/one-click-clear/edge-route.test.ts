import { beforeAll, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  imagePointToPlaneGridPoint,
  mirrorPlaneGridPoint,
  planeGridCellCenterToImagePoint,
} from "../../core/plane-grid";
import { graphwarToolDefaults } from "../../core/tool/defaults";
import { createPixelPoint } from "../../core/types";
import { readGraphwarKernelBytes } from "../../core/wasm/kernel-test-fixture";
import type {
  GraphwarWasmRouteContext,
  GraphwarWasmStepRouteSearchInput,
  GraphwarWasmStepRouteSearchResult,
} from "../../core/wasm/route-adapter";
import { createGraphwarWasmRouteContext } from "../../core/wasm/route-adapter";
import { instantiateGraphwarWasmRuntime } from "../../core/wasm/runtime";
import { createGraphwarStepRouteModel, createGraphwarStepRouteSummedArea } from "../routing/step-route";
import type { GraphwarOneClickClearEdgeWorkerJobResult } from "../runtime/protocol";

const mocks = vi.hoisted(() => ({
  buildThetaRoute: vi.fn(),
  buildVisibilityRoute: vi.fn(),
}));

vi.mock("../routing/theta-star", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../routing/theta-star")>()),
  buildGraphwarThetaStarPathForMask: mocks.buildThetaRoute,
}));

vi.mock("../routing/visibility-graph", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../routing/visibility-graph")>()),
  buildGraphwarVisibilityGraphPathForMask: mocks.buildVisibilityRoute,
}));

import { buildOneClickClearDagEdgeRoute } from "./edge-route";
import type { GraphwarOneClickClearDagEdgeBuildJob } from "./search";
import type { GraphwarOneClickClearStepRouteState } from "./step-route-state";

const context = {
  boundaryExpansion: 0,
  bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
  boundsRect: { height: 450, width: 770, x: 0, y: 0 },
  routeMask: new Uint8Array(770 * 450),
  routeMode: "visibility-graph" as const,
  routeTolerancePlanePixels: 0,
  type: "stateless" as const,
};
let kernelModule: WebAssembly.Module;

beforeAll(async () => {
  kernelModule = await WebAssembly.compile(await readGraphwarKernelBytes());
});

describe("one-click-clear DAG edge native forward distance", () => {
  beforeEach(() => {
    mocks.buildThetaRoute.mockReset();
    mocks.buildVisibilityRoute.mockReset();
  });

  it.each([
    { isMirrored: false, routeMode: "theta-star" as const },
    { isMirrored: true, routeMode: "theta-star" as const },
    { isMirrored: false, routeMode: "visibility-graph" as const },
    { isMirrored: true, routeMode: "visibility-graph" as const },
  ])(
    "uses the retained Step WASM $routeMode route and exact state when mirrored=$isMirrored",
    async ({ isMirrored, routeMode }) => {
      const routeStateKey = "0";
      const startX = isMirrored ? 668.6 : 100.4;
      const targetX = isMirrored ? 666 : 103;
      const findStepPath = vi.fn((input: GraphwarWasmStepRouteSearchInput) => ({
        expansionCount: 1,
        path: [input.start, { x: input.start.x + 1, y: input.start.y }, input.target],
        previews: [],
        terminalState: { resolvedY: 0.25, routeStateKey },
        type: "success" as const,
      }));
      const wasmRouteContext = createWasmRouteContext(findStepPath, isMirrored);
      const bounds = isMirrored
        ? { ...context.bounds, maxX: context.bounds.minX, minX: context.bounds.maxX }
        : context.bounds;
      const routeRuntime = createStepRouteRuntime();
      const job = {
        ...createJob(startX, targetX),
        stepRouteStartState: { resolvedStateKey: routeStateKey, resolvedY: 0 },
        type: "step-stateful" as const,
      };
      const startForward = mirrorPlaneGridPoint(
        imagePointToPlaneGridPoint(job.startPoint, context.boundsRect),
        isMirrored,
      ).x;
      const targetForward = mirrorPlaneGridPoint(
        imagePointToPlaneGridPoint(job.targetPoint, context.boundsRect),
        isMirrored,
      ).x;

      const result = await buildOneClickClearDagEdgeRoute(
        {
          ...context,
          bounds,
          routeMode,
          runtime: { ...routeRuntime, model: { ...routeRuntime.model, originY: 0 } },
          type: "step-stateful",
          wasmRouteContext,
        },
        job,
      );

      expect(findStepPath).toHaveBeenCalledOnce();
      expect(findStepPath).toHaveBeenCalledWith(
        expect.objectContaining({
          initialState: { resolvedY: 0, routeStateKey },
          start: { x: startForward, y: 225 },
          target: { x: targetForward, y: 225 },
        }),
      );
      expect(result).toMatchObject({
        route: [
          job.startPoint,
          planeGridCellCenterToImagePoint(
            mirrorPlaneGridPoint({ x: startForward + 1, y: 225 }, isMirrored),
            context.boundsRect,
          ),
          job.targetPoint,
        ],
        stepRouteEndState: { resolvedStateKey: routeStateKey, resolvedY: 0.25 },
      });
      expect(mocks.buildThetaRoute).not.toHaveBeenCalled();
      expect(mocks.buildVisibilityRoute).not.toHaveBeenCalled();
    },
  );

  it("keeps a Step WASM no-route result on the WASM backend", async () => {
    const findStepPath = vi.fn(() => ({ expansionCount: 1, previews: [], type: "no-route" as const }));
    const result = await buildOneClickClearDagEdgeRoute(
      {
        ...context,
        runtime: createStepRouteRuntime(),
        type: "step-stateful",
        wasmRouteContext: createWasmRouteContext(findStepPath, false),
      },
      {
        ...createJob(100.4, 103),
        stepRouteStartState: { resolvedStateKey: "0", resolvedY: 0 },
        type: "step-stateful",
      },
    );

    expect(result.route).toBeUndefined();
    expect(findStepPath).toHaveBeenCalledOnce();
    expect(mocks.buildThetaRoute).not.toHaveBeenCalled();
    expect(mocks.buildVisibilityRoute).not.toHaveBeenCalled();
  });

  it.each([
    { command: 9, isMirrored: false, routeMode: "theta-star" as const },
    { command: 9, isMirrored: true, routeMode: "theta-star" as const },
    { command: 10, isMirrored: false, routeMode: "visibility-graph" as const },
    { command: 10, isMirrored: true, routeMode: "visibility-graph" as const },
  ])(
    "runs real retained Step WASM command $command when mirrored=$isMirrored",
    async ({ command, isMirrored, routeMode }) => {
      const routeState = 0x1_0000_0000_0000_0001n;
      const routeStateKey = routeState.toString();
      const bounds = isMirrored
        ? { ...context.bounds, maxX: context.bounds.minX, minX: context.bounds.maxX }
        : context.bounds;
      const startPoint = createPixelPoint(isMirrored ? 668.75 : 100.25, 225.25);
      const targetPoint = createPixelPoint(isMirrored ? 665.25 : 103.75, 225.75);
      const model = createGraphwarStepRouteModel(-Number(routeState) / 10 ** 4, {
        decimalPlaces: 4,
        equation: "y",
        formulaPathSteepness: 2,
        steepness: 2,
      });
      if (!model) {
        throw new Error("Expected valid Step route model");
      }
      const runtime = await instantiateGraphwarWasmRuntime(kernelModule);
      const runRouteTask = vi.spyOn(runtime, "runRouteTask");
      const wasmRouteContext = createGraphwarWasmRouteContext(runtime, {
        boundaryExpansion: 0,
        bounds,
        boundsRect: context.boundsRect,
        routeOriginPoint: startPoint,
        routeTolerancePlanePixels: 0,
        sourceMask: context.routeMask,
        sourceMaskType: "route",
        stepRouteModel: {
          ...model,
          qualityTargetPlanePixels: graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
        },
      });
      const job = {
        ...createJob(startPoint.x, targetPoint.x),
        startPoint,
        stepRouteStartState: { resolvedStateKey: routeStateKey, resolvedY: 0 },
        targetPoint,
        type: "step-stateful" as const,
      };

      const result = await buildOneClickClearDagEdgeRoute(
        {
          ...context,
          bounds,
          routeMode,
          runtime: {
            model,
            routeMask: context.routeMask,
            summedArea: createGraphwarStepRouteSummedArea(context.routeMask),
          },
          type: "step-stateful",
          wasmRouteContext,
        },
        job,
      );

      expect(runRouteTask.mock.calls.filter(([actualCommand]) => actualCommand === command)).toHaveLength(1);
      expect(result.route?.[0]).toEqual(startPoint);
      expect(result.route?.at(-1)).toEqual(targetPoint);
      expect(result.stepRouteEndState).toEqual({
        resolvedStateKey: expect.stringMatching(/^-?\d+$/u),
        resolvedY: expect.any(Number),
      });
      expect(BigInt(result.stepRouteEndState?.resolvedStateKey ?? "0")).toBeGreaterThan(0x7fff_ffff_ffff_ffffn);
      expect(mocks.buildThetaRoute).not.toHaveBeenCalled();
      expect(mocks.buildVisibilityRoute).not.toHaveBeenCalled();
      expect(runtime.arenaCursor).toBeGreaterThan(runtime.arenaBase);

      wasmRouteContext.dispose();
      expect(runtime.arenaCursor).toBe(runtime.arenaBase);
    },
  );

  it("keeps a real Step WASM no-route result without TypeScript fallback", async () => {
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule);
    const routeMask = new Uint8Array(context.routeMask.length).fill(1);
    const routeRuntime = createStepRouteRuntime(routeMask);
    const wasmRouteContext = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds: context.bounds,
      boundsRect: context.boundsRect,
      routeOriginPoint: createPixelPoint(100.25, 225.25),
      routeTolerancePlanePixels: 0,
      sourceMask: routeMask,
      sourceMaskType: "route",
      stepRouteModel: {
        ...routeRuntime.model,
        qualityTargetPlanePixels: graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
      },
    });

    const result = await buildOneClickClearDagEdgeRoute(
      {
        ...context,
        routeMask,
        routeMode: "theta-star",
        runtime: routeRuntime,
        type: "step-stateful",
        wasmRouteContext,
      },
      {
        ...createJob(100.25, 103.75),
        stepRouteStartState: { resolvedStateKey: "0", resolvedY: 0 },
        type: "step-stateful",
      },
    );

    expect(result.route).toBeUndefined();
    expect(mocks.buildThetaRoute).not.toHaveBeenCalled();
    expect(mocks.buildVisibilityRoute).not.toHaveBeenCalled();
    wasmRouteContext.dispose();
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it.each([
    {
      name: "first automatic cell center is too close to the exact start",
      route: [
        { x: 100, y: 224 },
        { x: 101, y: 224 },
        { x: 110, y: 224 },
      ],
      startX: 100.9,
      targetX: 111,
    },
    {
      name: "exact target is too close to the previous automatic cell center",
      route: [
        { x: 100, y: 224 },
        { x: 101, y: 224 },
        { x: 102, y: 224 },
      ],
      startX: 100,
      targetX: 102,
    },
  ])("rejects an edge when $name", async ({ route, startX, targetX }) => {
    mocks.buildVisibilityRoute.mockResolvedValue(route);

    const result = await buildOneClickClearDagEdgeRoute(context, createJob(startX, targetX));

    expect(result.route).toBeUndefined();
  });

  it("keeps cell centers when every mapped segment advances by at least one native pixel", async () => {
    mocks.buildVisibilityRoute.mockResolvedValue([
      { x: 100, y: 224 },
      { x: 101, y: 224 },
      { x: 103, y: 224 },
    ]);

    const result = await buildOneClickClearDagEdgeRoute(context, createJob(100.4, 103));

    expect(result.route).toEqual([
      createPixelPoint(100.4, 225),
      planeGridCellCenterToImagePoint({ x: 101, y: 224 }, context.boundsRect),
      createPixelPoint(103, 225),
    ]);
  });

  it("returns an atomic Step end state for a job with matching runtime", async () => {
    mocks.buildVisibilityRoute.mockResolvedValue([
      { x: 100, y: 224 },
      { x: 101, y: 224 },
      { x: 103, y: 224 },
    ]);
    const result = await buildOneClickClearDagEdgeRoute(
      {
        ...context,
        runtime: createStepRouteRuntime(),
        type: "step-stateful",
      },
      {
        ...createJob(100.4, 103),
        stepRouteStartState: { resolvedStateKey: "0", resolvedY: 0 },
        type: "step-stateful",
      },
    );

    expect(result.stepRouteEndState).toEqual({ resolvedStateKey: "0", resolvedY: 0 });
  });

  it("makes the Step start state mandatory only for a Step-stateful job", () => {
    expectTypeOf<
      Extract<GraphwarOneClickClearDagEdgeBuildJob, { type: "step-stateful" }>["stepRouteStartState"]
    >().toEqualTypeOf<GraphwarOneClickClearStepRouteState>();
    expectTypeOf<
      Extract<GraphwarOneClickClearDagEdgeBuildJob, { type: "stateless" }>["stepRouteStartState"]
    >().toEqualTypeOf<undefined>();
    expectTypeOf<
      Extract<GraphwarOneClickClearEdgeWorkerJobResult, { type: "step-stateful" }>["stepRouteEndState"]
    >().toEqualTypeOf<GraphwarOneClickClearStepRouteState>();
    expectTypeOf<
      Extract<GraphwarOneClickClearEdgeWorkerJobResult, { type: "unreachable" }>["route"]
    >().toEqualTypeOf<undefined>();
  });

  it("rejects a job whose route policy does not match its context", async () => {
    await expect(
      buildOneClickClearDagEdgeRoute(context, {
        ...createJob(100.4, 103),
        stepRouteStartState: { resolvedStateKey: "0", resolvedY: 0 },
        type: "step-stateful",
      }),
    ).rejects.toThrow("does not match its route policy");
    await expect(
      buildOneClickClearDagEdgeRoute(
        { ...context, runtime: createStepRouteRuntime(), type: "step-stateful" },
        createJob(100.4, 103),
      ),
    ).rejects.toThrow("does not match its route policy");
    expect(mocks.buildVisibilityRoute).not.toHaveBeenCalled();
  });

  it.each([
    { name: "resolvedY is not finite", stepRouteStartState: { resolvedStateKey: "0", resolvedY: Number.NaN } },
    { name: "state key is not an integer", stepRouteStartState: { resolvedStateKey: "invalid", resolvedY: 0 } },
    { name: "state key is not canonical", stepRouteStartState: { resolvedStateKey: "01", resolvedY: 0 } },
  ])("rejects an invalid Step state when $name", async ({ stepRouteStartState }) => {
    await expect(
      buildOneClickClearDagEdgeRoute(
        { ...context, runtime: createStepRouteRuntime(), type: "step-stateful" },
        { ...createJob(100.4, 103), stepRouteStartState, type: "step-stateful" },
      ),
    ).rejects.toThrow("invalid canonical Step state");
    expect(mocks.buildVisibilityRoute).not.toHaveBeenCalled();
  });
});

/** 创建只携带单边建路必需字段的测试 job。 */
function createJob(startX: number, targetX: number): GraphwarOneClickClearDagEdgeBuildJob {
  return {
    from: -1,
    id: 1,
    startPoint: createPixelPoint(startX, 225),
    targetPoint: createPixelPoint(targetX, 225),
    to: 0,
    type: "stateless",
  };
}

/** 创建测试共享的完整 Step runtime；无效测试设置应立即暴露。 */
function createStepRouteRuntime(routeMask = context.routeMask) {
  const model = createGraphwarStepRouteModel(0, {
    decimalPlaces: 2,
    equation: "y",
    steepness: 1,
  });
  if (!model) {
    throw new Error("Expected valid Step route model");
  }
  return {
    model,
    routeMask,
    summedArea: createGraphwarStepRouteSummedArea(routeMask),
  };
}

/** Minimal retained context used to verify the production composition point without duplicating route semantics. */
function createWasmRouteContext(
  findStepPath: (input: GraphwarWasmStepRouteSearchInput) => GraphwarWasmStepRouteSearchResult,
  isMirrored: boolean,
): GraphwarWasmRouteContext {
  const noRoute = () => ({ expansionCount: 0, previews: [], type: "no-route" as const });
  return {
    contextPointer: 1,
    countPlaneRegionObstacles: () => 0,
    dispose: () => undefined,
    findThetaStarPath: noRoute,
    findVisibilityGraphPath: noRoute,
    graphRegionHitsObstacle: () => false,
    isMirrored,
    lineHitsObstacle: () => false,
    pointHitsObstacle: () => false,
    runSmartPathfinding: () => ({
      points: [],
      reachedRequiredTargetCount: 0,
      reachedTargetCount: 0,
      removedPointCount: 0,
      status: "failure" as const,
    }),
    routeBoundaryEdgeCount: 0,
    routeComponentCount: 0,
    routeMask: context.routeMask,
    routeObstacleCount: 0,
    simulationMask: context.routeMask,
    simulationObstacleCount: 0,
    stepRoute: {
      evaluateTransition: () => ({ reason: "numeric", type: "invalid" }),
      validatePath: () => ({ ok: false, reason: "numeric" as const }),
      findThetaStarPath: findStepPath,
      findVisibilityGraphPath: findStepPath,
    },
  };
}
