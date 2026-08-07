import { beforeAll, describe, expect, it, vi } from "vitest";

import { addSoldierAreasToObstacleMask, dilateObstacleMask } from "../../detection/objects";
import {
  countPlaneMaskRegionObstacles,
  createGraphwarPlaneMaskSummedArea,
  graphClosedRegionHitsPlaneMask,
} from "../../pathfinding/routing/step-envelope";
import {
  createGraphwarStepRouteModel,
  createGraphwarStepPathfindingEdgeEvaluator,
  createGraphwarStepRouteSummedArea,
  evaluateGraphwarStepRouteTransition,
  validateGraphwarStepRoutePath,
} from "../../pathfinding/routing/step-route";
import { buildGraphwarThetaStarPathForMask } from "../../pathfinding/routing/theta-star";
import {
  buildGraphwarVisibilityGraphPathForMask,
  lineHitsPlaneMask,
  pointHitsPlaneMask,
  type GraphwarPathfindingEdgeEvaluator,
  type GraphwarPathfindingPreview,
} from "../../pathfinding/routing/visibility-graph";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../game/constants";
import { graphToImagePoint, imageToGraphPoint } from "../geometry";
import { mirrorPlaneGridPoint, type PlaneGridPoint } from "../plane-grid";
import { graphwarToolDefaults } from "../tool/defaults";
import { createGraphPoint, createPixelPoint } from "../types";
import { readGraphwarKernelBytes } from "./kernel-test-fixture";
import { createGraphwarWasmRouteContext } from "./route-adapter";
import { instantiateGraphwarWasmRuntime } from "./runtime";
import type { GraphwarWasmRouteContextInput } from "./task-adapter";

const planeCellCount = GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT;
const boundsRect = { height: 450, width: 770, x: 0, y: 0 };
const bounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
let kernelModule: WebAssembly.Module;

beforeAll(async () => {
  kernelModule = await WebAssembly.compile(await readGraphwarKernelBytes());
});

describe("Graphwar WASM route context", () => {
  it.each([
    { equation: "y" as const, isMirrored: false, name: "y", routeState: 0x1_0000_0000_0000_0001n },
    { equation: "dy" as const, isMirrored: false, name: "dy", routeState: -0x1_0000_0000_0000_0001n },
    { equation: "ddy" as const, isMirrored: true, name: "mirrored ddy", routeState: 0n },
  ])("matches one canonical Step transition for $name", async ({ equation, isMirrored, routeState }) => {
    const runtime = await createRuntime();
    const routeBounds = isMirrored ? { ...bounds, maxX: bounds.minX, minX: bounds.maxX } : bounds;
    const decimalPlaces = 4;
    const scale = equation === "y" ? 1 : equation === "dy" ? 2 : 4;
    const originY = -Number(routeState) / 10 ** decimalPlaces / scale;
    const model = createGraphwarStepRouteModel(originY, {
      decimalPlaces,
      equation,
      formulaPathSteepness: 2,
      steepness: 2,
    });
    expect(model).toBeDefined();
    if (!model) {
      throw new Error("Expected a valid Step route model");
    }
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds: routeBounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 120, y: 225 },
      routeTolerancePlanePixels: 0,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask: new Uint8Array(planeCellCount),
      stepRouteModel: {
        ...model,
        qualityTargetPlanePixels: graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
      },
    });
    const stepRoute = context.stepRoute;
    expect(stepRoute).toBeDefined();
    if (!stepRoute) {
      throw new Error("Expected a retained Step route capability");
    }
    const contextCursor = runtime.arenaCursor;
    const previous = createGraphPoint(-20, 0);
    const next = createGraphPoint(-5, 5);
    const routeStateKey = routeState.toString();
    const expected = evaluateGraphwarStepRouteTransition(
      model,
      0,
      previous,
      next,
      {
        boundaryInset: 0,
        bounds: routeBounds,
        summedArea: createGraphwarPlaneMaskSummedArea(context.routeMask),
      },
      routeStateKey,
    );
    const actual = stepRoute.evaluateTransition(previous, next, { resolvedY: 0, routeStateKey });

    expect(expected.ok).toBe(true);
    expect(actual.type).toBe("success");
    if (expected.ok && actual.type === "success") {
      expect(actual.transition).toEqual({
        envelope: expected.transition.envelope,
        resolvedEndY: expected.transition.resolvedEndY,
        resolvedStartY: expected.transition.resolvedStartY,
        routeState: {
          resolvedY: expected.transition.resolvedEndY,
          routeStateKey: expected.transition.routeStateKey,
        },
        secondaryCost: expected.transition.secondaryCost,
      });
    }
    expect(runtime.arenaCursor).toBe(contextCursor);
    context.dispose();
  });

  it.each([
    { isMirrored: false, name: "direct" },
    { isMirrored: true, name: "mirrored" },
  ])("validates a complete Step path in one WASM command for $name", async ({ isMirrored }) => {
    const runtime = await createRuntime();
    const routeBounds = isMirrored ? { ...bounds, maxX: bounds.minX, minX: bounds.maxX } : bounds;
    const model = createGraphwarStepRouteModel(0, {
      decimalPlaces: 4,
      equation: "y",
      formulaPathSteepness: 2,
      steepness: 2,
    });
    if (!model) {
      throw new Error("Expected a valid Step route model");
    }
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds: routeBounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 120, y: 225 },
      routeTolerancePlanePixels: 0,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask: new Uint8Array(planeCellCount),
      stepRouteModel: {
        ...model,
        qualityTargetPlanePixels: graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
      },
    });
    const stepRoute = context.stepRoute;
    if (!stepRoute) {
      throw new Error("Expected a retained Step route capability");
    }
    const graphPoints = [createGraphPoint(-20, 0), createGraphPoint(-5, 5), createGraphPoint(10, 5)];
    const expected = validateGraphwarStepRoutePath({
      boundaryInset: 0,
      bounds: routeBounds,
      boundsRect,
      model,
      points: graphPoints.map((point) => graphToImagePoint(point, routeBounds, boundsRect)),
      summedArea: createGraphwarStepRouteSummedArea(context.routeMask),
    });
    const runRouteTask = vi.spyOn(runtime, "runRouteTask");
    const actual = stepRoute.validatePath(graphPoints);

    expect(actual).toEqual(expected);
    expect(runRouteTask.mock.calls.filter(([command]) => command === 23)).toHaveLength(1);
    expect(runRouteTask.mock.calls.some(([command]) => command === 8)).toBe(false);
    expect(runtime.arenaCursor).toBeGreaterThan(runtime.arenaBase);
    context.dispose();
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("returns the first invalid Step segment and preserves normal failure semantics", async () => {
    const runtime = await createRuntime();
    const model = createGraphwarStepRouteModel(0, {
      decimalPlaces: 4,
      equation: "y",
      formulaPathSteepness: 2,
      steepness: 2,
    });
    if (!model) {
      throw new Error("Expected a valid Step route model");
    }
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 120, y: 225 },
      routeTolerancePlanePixels: 0,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask: new Uint8Array(planeCellCount),
      stepRouteModel: {
        ...model,
        qualityTargetPlanePixels: graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
      },
    });
    const stepRoute = context.stepRoute;
    if (!stepRoute) {
      throw new Error("Expected a retained Step route capability");
    }
    const graphPoints = [createGraphPoint(-20, 0), createGraphPoint(-5, 5), createGraphPoint(-5, 5)];
    const expected = validateGraphwarStepRoutePath({
      boundaryInset: 0,
      bounds,
      boundsRect,
      model,
      points: graphPoints.map((point) => graphToImagePoint(point, bounds, boundsRect)),
      summedArea: createGraphwarStepRouteSummedArea(context.routeMask),
    });
    const runRouteTask = vi.spyOn(runtime, "runRouteTask");
    const actual = stepRoute.validatePath(graphPoints);

    expect(expected).toEqual({ invalidSegmentIndex: 1, ok: false, reason: "non-forward" });
    expect(actual).toEqual(expected);
    expect(runRouteTask.mock.calls.filter(([command]) => command === 23)).toHaveLength(1);
    expect(runRouteTask.mock.calls.some(([command]) => command === 8)).toBe(false);
    context.dispose();
  });

  it("keeps empty and single-point Step validation on the normal path", async () => {
    const runtime = await createRuntime();
    const model = createGraphwarStepRouteModel(0, {
      decimalPlaces: 4,
      equation: "y",
      formulaPathSteepness: 2,
      steepness: 2,
    });
    if (!model) {
      throw new Error("Expected a valid Step route model");
    }
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 120, y: 225 },
      routeTolerancePlanePixels: 0,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask: new Uint8Array(planeCellCount),
      stepRouteModel: {
        ...model,
        qualityTargetPlanePixels: graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
      },
    });
    const stepRoute = context.stepRoute;
    if (!stepRoute) {
      throw new Error("Expected a retained Step route capability");
    }
    const runRouteTask = vi.spyOn(runtime, "runRouteTask");
    expect(stepRoute.validatePath([])).toEqual({ ok: false, reason: "numeric" });
    expect(stepRoute.validatePath([createGraphPoint(-20, 0)])).toEqual({
      ok: true,
      resolvedEndY: 0,
      routeStateKey: "0",
    });
    expect(runRouteTask.mock.calls.filter(([command]) => command === 23)).toHaveLength(1);
    context.dispose();
  });

  it("rejects a WASM Step path result with an out-of-range failure segment", async () => {
    const runtime = await createRuntime();
    const model = createGraphwarStepRouteModel(0, {
      decimalPlaces: 4,
      equation: "y",
      formulaPathSteepness: 2,
      steepness: 2,
    });
    if (!model) {
      throw new Error("Expected a valid Step route model");
    }
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 120, y: 225 },
      routeTolerancePlanePixels: 0,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask: new Uint8Array(planeCellCount),
      stepRouteModel: {
        ...model,
        qualityTargetPlanePixels: graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
      },
    });
    const stepRoute = context.stepRoute;
    if (!stepRoute) {
      throw new Error("Expected a retained Step route capability");
    }
    const runRouteTask = runtime.runRouteTask.bind(runtime);
    vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = runRouteTask(command, inputPointer, inputByteLength);
      if (command === 23) {
        const result = new DataView(runtime.buffer, resultPointer, 40);
        result.setUint32(4, 1, true);
        result.setInt32(8, 100, true);
        result.setFloat64(16, 0, true);
        result.setInt32(24, 0, true);
        result.setUint32(28, 0, true);
        result.setUint32(32, 0, true);
      }
      return resultPointer;
    });
    expect(() => stepRoute.validatePath([createGraphPoint(-20, 0), createGraphPoint(-5, 5)])).toThrow(
      /failure segment is outside its path/u,
    );
    context.dispose();
  });

  it("rejects terminal state evidence on a failed Step path", async () => {
    const runtime = await createRuntime();
    const model = createGraphwarStepRouteModel(0, {
      decimalPlaces: 4,
      equation: "y",
      formulaPathSteepness: 2,
      steepness: 2,
    });
    if (!model) {
      throw new Error("Expected a valid Step route model");
    }
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 120, y: 225 },
      routeTolerancePlanePixels: 0,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask: new Uint8Array(planeCellCount),
      stepRouteModel: {
        ...model,
        qualityTargetPlanePixels: graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
      },
    });
    const stepRoute = context.stepRoute;
    if (!stepRoute) {
      throw new Error("Expected a retained Step route capability");
    }
    const runRouteTask = runtime.runRouteTask.bind(runtime);
    vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = runRouteTask(command, inputPointer, inputByteLength);
      if (command === 23) {
        new DataView(runtime.buffer, resultPointer, 40).setInt32(24, 1, true);
      }
      return resultPointer;
    });
    expect(() => stepRoute.validatePath([createGraphPoint(-20, 0), createGraphPoint(-20, 5)])).toThrow(
      /failed Step path validation contains terminal state/u,
    );
    context.dispose();
  });

  it("matches Step edge rejection and keeps invalid results state-free", async () => {
    const runtime = await createRuntime();
    const sourceMask = new Uint8Array(planeCellCount);
    sourceMask[187 * GRAPHWAR_PLANE_LENGTH + 277] = 1;
    const model = createGraphwarStepRouteModel(0, {
      decimalPlaces: 4,
      equation: "y",
      formulaPathSteepness: 2,
      steepness: 2,
    });
    if (!model) {
      throw new Error("Expected a valid Step route model");
    }
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 120, y: 225 },
      routeTolerancePlanePixels: 0,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask,
      stepRouteModel: {
        ...model,
        qualityTargetPlanePixels: graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
      },
    });
    const stepRoute = context.stepRoute;
    if (!stepRoute) {
      throw new Error("Expected a retained Step route capability");
    }
    const summedArea = createGraphwarPlaneMaskSummedArea(context.routeMask);
    const zeroTransition = stepRoute.evaluateTransition(createGraphPoint(-20, 0), createGraphPoint(-5, 0), {
      resolvedY: 0,
      routeStateKey: "0",
    });
    expect(zeroTransition).toMatchObject({
      transition: { routeState: { resolvedY: 0, routeStateKey: "0" } },
      type: "success",
    });
    for (const [previous, next] of [
      [createGraphPoint(-20, 0), createGraphPoint(-5, 5)],
      [createGraphPoint(-5, 0), createGraphPoint(-20, 5)],
    ] as const) {
      const expected = evaluateGraphwarStepRouteTransition(
        model,
        0,
        previous,
        next,
        { boundaryInset: 0, bounds, summedArea },
        "0",
      );
      const actual = stepRoute.evaluateTransition(previous, next, { resolvedY: 0, routeStateKey: "0" });
      expect(actual).toEqual(
        expected.ok ? expect.objectContaining({ type: "success" }) : { reason: expected.reason, type: "invalid" },
      );
    }
    context.dispose();
  });

  it.each(["result", "state"] as const)(
    "rejects a Step transition %s pointing into retained context",
    async (field) => {
      const runtime = await createRuntime();
      const model = createGraphwarStepRouteModel(0, {
        decimalPlaces: 4,
        equation: "y",
        formulaPathSteepness: 2,
        steepness: 2,
      });
      if (!model) {
        throw new Error("Expected a valid Step route model");
      }
      let contextPointer = 0;
      const originalRunRouteTask = runtime.runRouteTask.bind(runtime);
      vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
        const resultPointer = originalRunRouteTask(command, inputPointer, inputByteLength);
        if (command === 1) {
          contextPointer = resultPointer;
        } else if (command === 8) {
          if (field === "result") {
            return contextPointer;
          }
          const resultView = new DataView(runtime.buffer, resultPointer, 160);
          resultView.setInt32(144, 1, true);
          resultView.setUint32(148, contextPointer, true);
          resultView.setUint32(152, 1, true);
        }
        return resultPointer;
      });
      const context = createGraphwarWasmRouteContext(runtime, {
        boundaryExpansion: 0,
        bounds,
        boundsRect,
        friendlySoldierCenters: [],
        routeOriginPoint: { x: 120, y: 225 },
        routeTolerancePlanePixels: 0,
        simulationTolerancePlanePixels: 0,
        soldierHitRadiusPixels: 7,
        sourceMaskType: "base",
        sourceMask: new Uint8Array(planeCellCount),
        stepRouteModel: {
          ...model,
          qualityTargetPlanePixels: graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
        },
      });
      const stepRoute = context.stepRoute;
      if (!stepRoute) {
        throw new Error("Expected a retained Step route capability");
      }

      let caught: unknown;
      try {
        stepRoute.evaluateTransition(createGraphPoint(-20, 0), createGraphPoint(-5, 5), {
          resolvedY: 0,
          routeStateKey: "0",
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ faultDomain: "abi" });
      expect(caught).toEqual(expect.objectContaining({ message: expect.stringMatching(/outside the raw arena/u) }));
      context.dispose();
    },
  );

  it.each([
    {
      corrupt(resultView: DataView) {
        resultView.setUint32(4, 0, true);
      },
      name: "non-forward success",
      next: createGraphPoint(-20, 5),
      previous: createGraphPoint(-5, 0),
    },
    {
      corrupt(resultView: DataView) {
        resultView.setFloat64(24, resultView.getFloat64(24, true) + 1, true);
      },
      name: "secondary cost",
      next: createGraphPoint(-5, 5),
      previous: createGraphPoint(-20, 0),
    },
    {
      corrupt(resultView: DataView) {
        resultView.setFloat64(40, resultView.getFloat64(40, true) + 1, true);
      },
      name: "midpoint",
      next: createGraphPoint(-5, 5),
      previous: createGraphPoint(-20, 0),
    },
    {
      corrupt(resultView: DataView) {
        resultView.setFloat64(48, resultView.getFloat64(48, true) + 1, true);
      },
      name: "envelope region",
      next: createGraphPoint(-5, 5),
      previous: createGraphPoint(-20, 0),
    },
  ])("rejects an inconsistent Step transition $name", async ({ corrupt, next, previous }) => {
    const runtime = await createRuntime();
    const model = createGraphwarStepRouteModel(0, {
      decimalPlaces: 4,
      equation: "y",
      formulaPathSteepness: 2,
      steepness: 2,
    });
    if (!model) {
      throw new Error("Expected a valid Step route model");
    }
    const originalRunRouteTask = runtime.runRouteTask.bind(runtime);
    vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = originalRunRouteTask(command, inputPointer, inputByteLength);
      if (command === 8) {
        corrupt(new DataView(runtime.buffer, resultPointer, 160));
      }
      return resultPointer;
    });
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 120, y: 225 },
      routeTolerancePlanePixels: 0,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask: new Uint8Array(planeCellCount),
      stepRouteModel: {
        ...model,
        qualityTargetPlanePixels: graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
      },
    });
    const stepRoute = context.stepRoute;
    if (!stepRoute) {
      throw new Error("Expected a retained Step route capability");
    }

    expect(() => stepRoute.evaluateTransition(previous, next, { resolvedY: 0, routeStateKey: "0" })).toThrow(
      /inconsistent with its request/u,
    );
    context.dispose();
  });

  it.each(
    [
      {
        equation: "y" as const,
        isMirrored: false,
        name: "direct",
        obstacle: "none" as const,
        routeState: 0n,
        routeTolerance: 0,
      },
      {
        equation: "dy" as const,
        isMirrored: false,
        name: "routed multi-label",
        obstacle: "two-wide-gaps" as const,
        routeState: 0n,
        routeTolerance: 0,
      },
      {
        equation: "y" as const,
        isMirrored: false,
        name: "no route",
        obstacle: "wall" as const,
        routeState: 0n,
        routeTolerance: 0,
      },
      {
        equation: "y" as const,
        isMirrored: true,
        name: "mirrored oversized parent-key tie",
        obstacle: "staggered-walls" as const,
        routeState: -0x1_0000_0000_0000_0001n,
        routeTolerance: 0,
      },
      {
        equation: "dy" as const,
        isMirrored: false,
        name: "negative tolerance",
        obstacle: "wall" as const,
        routeState: -0x1_0000_0000_0000_0001n,
        routeTolerance: -2.25,
      },
      {
        equation: "y" as const,
        isMirrored: false,
        name: "visibility routed rectangle",
        obstacle: "rectangle" as const,
        routeState: 0n,
        routeTolerance: 0,
      },
      {
        equation: "y" as const,
        isMirrored: true,
        name: "mirrored visibility routed rectangle",
        obstacle: "rectangle" as const,
        routeState: 0n,
        routeTolerance: 0,
      },
    ].flatMap((fixture) =>
      (["Theta*", "visibility"] as const).map((routeAlgorithm) => ({ ...fixture, routeAlgorithm })),
    ),
  )(
    "matches stateful Step $routeAlgorithm for $name",
    { timeout: 120_000 },
    async ({ equation, isMirrored, name, obstacle, routeAlgorithm, routeState, routeTolerance }) => {
      const runtime = await createRuntime();
      const sourceMask = new Uint8Array(planeCellCount);
      if (obstacle === "rectangle") {
        fillRectangle(sourceMask, 297, 303, 224, 226);
      } else if (obstacle === "staggered-walls") {
        let seed = 10 * 0x9e37_79b1;
        for (const x of [180, 260, 340, 420, 500]) {
          seed = Math.imul(seed ^ (seed >>> 16), 0x45d9_f3b);
          const center = 30 + ((seed >>> 0) % 390);
          const radius = 6 + ((seed >>> 8) % 24);
          for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
            if (Math.abs(y - center) > radius) sourceMask[y * GRAPHWAR_PLANE_LENGTH + x] = 1;
          }
        }
      } else if (obstacle !== "none") {
        for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
          if (obstacle === "two-wide-gaps" && ((y >= 80 && y <= 120) || (y >= 330 && y <= 370))) {
            continue;
          }
          sourceMask[y * GRAPHWAR_PLANE_LENGTH + 300] = 1;
        }
      }
      const routeBounds = isMirrored ? { ...bounds, maxX: bounds.minX, minX: bounds.maxX } : bounds;
      const decimalPlaces = 4;
      const scale = equation === "y" ? 1 : equation === "dy" ? 2 : 4;
      const originY = -Number(routeState) / 10 ** decimalPlaces / scale;
      const model = createGraphwarStepRouteModel(originY, {
        decimalPlaces,
        equation,
        formulaPathSteepness: 2,
        steepness: 2,
      });
      if (!model) {
        throw new Error("Expected a valid Step route model");
      }
      const context = createGraphwarWasmRouteContext(runtime, {
        boundaryExpansion: 0,
        bounds: routeBounds,
        boundsRect,
        friendlySoldierCenters: [],
        routeOriginPoint: { x: obstacle === "staggered-walls" ? 90 : 100, y: 225 },
        routeTolerancePlanePixels: routeTolerance,
        simulationTolerancePlanePixels: 0,
        soldierHitRadiusPixels: 7,
        sourceMaskType: "base",
        sourceMask,
        stepRouteModel: {
          ...model,
          qualityTargetPlanePixels: graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
        },
      });
      const stepRoute = context.stepRoute;
      if (!stepRoute) {
        throw new Error("Expected a retained Step route capability");
      }
      const isParentKeyFixture = obstacle === "staggered-walls";
      const start = { x: isParentKeyFixture ? 90 : 100, y: 225 };
      const target = { x: isParentKeyFixture ? 620 : 600, y: 225 };
      const physicalStart = mirrorPlaneGridPoint(start, isMirrored);
      const physicalTarget = mirrorPlaneGridPoint(target, isMirrored);
      const exactStartPoint = createPixelPoint(
        physicalStart.x + (isParentKeyFixture ? 0.17 : 0.25),
        physicalStart.y + (isParentKeyFixture ? 0.31 : 0.25),
      );
      const exactTargetPoint = createPixelPoint(
        physicalTarget.x + (isParentKeyFixture ? 0.79 : 0.75),
        physicalTarget.y + (isParentKeyFixture ? 0.63 : 0.75),
      );
      const evaluator = createGraphwarStepPathfindingEdgeEvaluator({
        boundaryInset: 0,
        bounds: routeBounds,
        boundsRect,
        exactStartPoint,
        exactTargetPoint,
        model,
        resolvedStartStateKey: routeState.toString(),
        resolvedStartY: 0,
        summedArea: createGraphwarStepRouteSummedArea(context.routeMask),
      });
      const expectedPreviews: unknown[] = [];
      const searchOptions = {
        boundaryExpansion: 0,
        bounds: routeBounds,
        boundsRect,
        estimateRemainingSecondaryCost: evaluator.estimateRemainingSecondaryCost,
        evaluateEdge: evaluator.evaluateEdge,
        initialRouteState: evaluator.initialRouteState,
        initialRouteStateKey: evaluator.initialRouteStateKey,
        onPreview: (preview: GraphwarPathfindingPreview) => expectedPreviews.push(structuredClone(preview)),
        routeMask: context.routeMask,
        startPoint: exactStartPoint,
        targetPoint: exactTargetPoint,
      };
      const expected = await (routeAlgorithm === "Theta*"
        ? buildGraphwarThetaStarPathForMask(searchOptions)
        : buildGraphwarVisibilityGraphPathForMask(searchOptions));
      if (name.includes("visibility routed") && routeAlgorithm === "visibility") {
        expect(expected?.length).toBeGreaterThan(2);
      }
      const request = {
        exactStart: imageToGraphPoint(exactStartPoint, routeBounds, boundsRect),
        exactTarget: imageToGraphPoint(exactTargetPoint, routeBounds, boundsRect),
        initialState: { resolvedY: 0, routeStateKey: routeState.toString() },
        shouldCollectPreviews: true,
        start,
        target,
      } as const;
      const contextCursor = runtime.arenaCursor;
      const actual =
        routeAlgorithm === "Theta*" ? stepRoute.findThetaStarPath(request) : stepRoute.findVisibilityGraphPath(request);
      expect(runtime.arenaCursor).toBe(contextCursor);
      if (!expected) {
        expect(actual).toEqual({ expansionCount: expect.any(Number), previews: expectedPreviews, type: "no-route" });
      } else {
        expect(actual.type).toBe("success");
        if (actual.type === "success") {
          expect(actual.path).toEqual(expected.map((point) => mirrorPlaneGridPoint(point, isMirrored)));
          expect(actual.terminalState).toEqual(
            evaluateExpectedStepTerminalState(expected, evaluator.evaluateEdge, {
              resolvedY: 0,
              routeStateKey: routeState.toString(),
            }),
          );
        }
      }
      expect(actual.previews).toEqual(expectedPreviews);
      if (name === "routed multi-label" || (name.includes("visibility routed") && routeAlgorithm === "visibility")) {
        const growMark = runtime.markArena();
        runtime.reserveArena(runtime.buffer.byteLength * 2, 16);
        runtime.resetArena(growMark);
        expect(
          routeAlgorithm === "Theta*"
            ? stepRoute.findThetaStarPath(request)
            : stepRoute.findVisibilityGraphPath(request),
        ).toEqual(actual);
        expect(runtime.arenaCursor).toBe(contextCursor);
      }
      context.dispose();
      expect(runtime.arenaCursor).toBe(runtime.arenaBase);
    },
  );

  it("preserves the initial canonical state for a single-cell Step Theta* path", async () => {
    const runtime = await createRuntime();
    const model = createGraphwarStepRouteModel(0, {
      decimalPlaces: 4,
      equation: "y",
      formulaPathSteepness: 2,
      steepness: 2,
    });
    if (!model) throw new Error("Expected a valid Step route model");
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 100, y: 225 },
      routeTolerancePlanePixels: 0,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask: new Uint8Array(planeCellCount),
      stepRouteModel: {
        ...model,
        qualityTargetPlanePixels: graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
      },
    });
    const point = { x: 100, y: 225 };
    const exactPoint = imageToGraphPoint(createPixelPoint(100.25, 225.25), bounds, boundsRect);
    const stepRoute = context.stepRoute;
    if (!stepRoute) throw new Error("Expected a retained Step route capability");
    expect(
      stepRoute.findThetaStarPath({
        exactStart: exactPoint,
        exactTarget: exactPoint,
        initialState: { resolvedY: 0, routeStateKey: "0" },
        shouldCollectPreviews: true,
        start: point,
        target: point,
      }),
    ).toMatchObject({
      expansionCount: 0,
      path: [point],
      terminalState: { resolvedY: 0, routeStateKey: "0" },
      type: "success",
    });
    expect(
      stepRoute.findVisibilityGraphPath({
        exactStart: exactPoint,
        exactTarget: exactPoint,
        initialState: { resolvedY: 0, routeStateKey: "0" },
        shouldCollectPreviews: true,
        start: point,
        target: point,
      }),
    ).toEqual({ expansionCount: 1, previews: [], type: "no-route" });
    context.dispose();
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it.each(
    [
      {
        corrupt(_runtime: Awaited<ReturnType<typeof createRuntime>>, resultView: DataView) {
          resultView.setUint32(4, 2, true);
        },
        expectedMessage: /status/u,
        name: "status",
      },
      {
        corrupt(_runtime: Awaited<ReturnType<typeof createRuntime>>, resultView: DataView) {
          resultView.setUint32(4, 0, true);
          resultView.setUint32(8, 0, true);
          resultView.setUint32(12, 0, true);
          resultView.setUint32(16, 0, true);
        },
        expectedMessage: /no-route result contains path state/u,
        name: "no-route half-state",
      },
      {
        corrupt(_runtime: Awaited<ReturnType<typeof createRuntime>>, resultView: DataView) {
          resultView.setInt32(40, 2, true);
        },
        expectedMessage: /sign is not canonical/u,
        name: "state sign",
      },
      {
        corrupt(runtime: Awaited<ReturnType<typeof createRuntime>>, resultView: DataView) {
          resultView.setUint32(44, runtime.arenaBase, true);
        },
        expectedMessage: /outside the raw arena/u,
        name: "state pointing into retained context",
      },
      {
        corrupt(_runtime: Awaited<ReturnType<typeof createRuntime>>, resultView: DataView) {
          resultView.setFloat64(32, Number.NaN, true);
        },
        expectedMessage: /must be finite/u,
        name: "non-finite runtime height",
      },
      {
        corrupt(_runtime: Awaited<ReturnType<typeof createRuntime>>, resultView: DataView) {
          resultView.setFloat64(32, resultView.getFloat64(32, true) + 1, true);
        },
        expectedMessage: /runtime height does not match/u,
        name: "runtime height",
      },
      {
        corrupt(runtime: Awaited<ReturnType<typeof createRuntime>>, resultView: DataView) {
          const statePointer = resultView.getUint32(44, true);
          const stateCount = resultView.getUint32(48, true);
          new DataView(runtime.buffer).setUint32(statePointer + (stateCount - 1) * 4, 0, true);
        },
        expectedMessage: /magnitude is not canonical/u,
        name: "state magnitude",
      },
      {
        corrupt(_runtime: Awaited<ReturnType<typeof createRuntime>>, resultView: DataView) {
          resultView.setUint32(44, resultView.getUint32(44, true) + 2, true);
        },
        expectedMessage: /element alignment/u,
        name: "unaligned state limbs",
      },
      {
        corrupt(runtime: Awaited<ReturnType<typeof createRuntime>>, resultView: DataView) {
          const pathXPointer = resultView.getUint32(8, true);
          const pathLength = resultView.getUint32(16, true);
          const pathView = new DataView(runtime.buffer);
          pathView.setFloat64(
            pathXPointer + (pathLength - 1) * Float64Array.BYTES_PER_ELEMENT,
            pathView.getFloat64(pathXPointer, true),
            true,
          );
        },
        expectedMessage: /does not advance in x\+ order/u,
        name: "non-forward path",
      },
      {
        corrupt(runtime: Awaited<ReturnType<typeof createRuntime>>, resultView: DataView) {
          const pathYPointer = resultView.getUint32(12, true);
          const pathLength = resultView.getUint32(16, true);
          const terminalOffset = pathYPointer + (pathLength - 1) * Float64Array.BYTES_PER_ELEMENT;
          const pathView = new DataView(runtime.buffer);
          pathView.setFloat64(terminalOffset, pathView.getFloat64(terminalOffset, true) + 1, true);
        },
        expectedMessage: /path endpoints do not match/u,
        name: "endpoint identity",
      },
      {
        corrupt(_runtime: Awaited<ReturnType<typeof createRuntime>>, resultView: DataView) {
          resultView.setUint32(8, resultView.getUint32(8, true) + 4, true);
        },
        expectedMessage: /element alignment/u,
        name: "unaligned path",
      },
      {
        corrupt(runtime: Awaited<ReturnType<typeof createRuntime>>, resultView: DataView) {
          resultView.setUint32(8, runtime.arenaBase, true);
        },
        expectedMessage: /outside the raw arena/u,
        name: "path pointing into retained context",
      },
    ].flatMap((fixture) =>
      (["Theta*", "visibility"] as const).map((routeAlgorithm) => ({ ...fixture, routeAlgorithm })),
    ),
  )("rejects a malformed Step $routeAlgorithm $name", async ({ corrupt, expectedMessage, routeAlgorithm }) => {
    const runtime = await createRuntime();
    const model = createGraphwarStepRouteModel(0, {
      decimalPlaces: 4,
      equation: "y",
      formulaPathSteepness: 2,
      steepness: 2,
    });
    if (!model) throw new Error("Expected a valid Step route model");
    const originalRunRouteTask = runtime.runRouteTask.bind(runtime);
    vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = originalRunRouteTask(command, inputPointer, inputByteLength);
      if (command === (routeAlgorithm === "Theta*" ? 9 : 10)) {
        corrupt(runtime, new DataView(runtime.buffer, resultPointer, 56));
      }
      return resultPointer;
    });
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 100, y: 225 },
      routeTolerancePlanePixels: 0,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask: new Uint8Array(planeCellCount),
      stepRouteModel: {
        ...model,
        qualityTargetPlanePixels: graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
      },
    });
    const stepRoute = context.stepRoute;
    if (!stepRoute) throw new Error("Expected a retained Step route capability");
    const request = {
      exactStart: imageToGraphPoint(createPixelPoint(100.25, 225.25), bounds, boundsRect),
      exactTarget: imageToGraphPoint(createPixelPoint(300.75, 150.75), bounds, boundsRect),
      initialState: { resolvedY: 0, routeStateKey: "0" },
      start: { x: 100, y: 225 },
      target: { x: 300, y: 150 },
    } as const;
    expect(() =>
      routeAlgorithm === "Theta*" ? stepRoute.findThetaStarPath(request) : stepRoute.findVisibilityGraphPath(request),
    ).toThrow(expectedMessage);
    context.dispose();
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects a Step search whose runtime height and canonical identity disagree", async () => {
    const runtime = await createRuntime();
    const model = createGraphwarStepRouteModel(0, {
      decimalPlaces: 4,
      equation: "y",
      formulaPathSteepness: 2,
      steepness: 2,
    });
    if (!model) throw new Error("Expected a valid Step route model");
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 100, y: 225 },
      routeTolerancePlanePixels: 0,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask: new Uint8Array(planeCellCount),
      stepRouteModel: {
        ...model,
        qualityTargetPlanePixels: graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
      },
    });
    const stepRoute = context.stepRoute;
    if (!stepRoute) throw new Error("Expected a retained Step route capability");
    const request = {
      exactStart: imageToGraphPoint(createPixelPoint(100.25, 225.25), bounds, boundsRect),
      exactTarget: imageToGraphPoint(createPixelPoint(300.75, 150.75), bounds, boundsRect),
      initialState: { resolvedY: 1, routeStateKey: "0" },
      start: { x: 100, y: 225 },
      target: { x: 300, y: 150 },
    } as const;
    expect(() => stepRoute.findThetaStarPath(request)).toThrow(/runtime height does not match/u);
    expect(() => stepRoute.findVisibilityGraphPath(request)).toThrow(/runtime height does not match/u);
    context.dispose();
  });

  it("rejects exact Step endpoints that do not identify their declared grid cells", async () => {
    const runtime = await createRuntime();
    const model = createGraphwarStepRouteModel(0, {
      decimalPlaces: 4,
      equation: "y",
      formulaPathSteepness: 2,
      steepness: 2,
    });
    if (!model) throw new Error("Expected a valid Step route model");
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 100, y: 225 },
      routeTolerancePlanePixels: 0,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask: new Uint8Array(planeCellCount),
      stepRouteModel: {
        ...model,
        qualityTargetPlanePixels: graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
      },
    });
    const stepRoute = context.stepRoute;
    if (!stepRoute) throw new Error("Expected a retained Step route capability");
    const request = {
      exactStart: imageToGraphPoint(createPixelPoint(100.25, 225.25), bounds, boundsRect),
      exactTarget: imageToGraphPoint(createPixelPoint(300.75, 150.75), bounds, boundsRect),
      initialState: { resolvedY: 0, routeStateKey: "0" },
      start: { x: 100, y: 225 },
      target: { x: 300, y: 150 },
    } as const;
    for (const search of [stepRoute.findThetaStarPath, stepRoute.findVisibilityGraphPath]) {
      expect(() =>
        search({
          ...request,
          exactStart: imageToGraphPoint(createPixelPoint(101.25, 225.25), bounds, boundsRect),
        }),
      ).toThrow(/exactStart does not identify/u);
      expect(() =>
        search({
          ...request,
          exactTarget: imageToGraphPoint(createPixelPoint(301.75, 150.75), bounds, boundsRect),
        }),
      ).toThrow(/exactTarget does not identify/u);
    }
    context.dispose();
  });

  it.each([
    { name: "stationary", target: { x: 100, y: 225 } },
    { name: "reverse", target: { x: 50, y: 225 } },
  ])("rejects a Step visibility success for a $name request", async ({ target }) => {
    const runtime = await createRuntime();
    const model = createGraphwarStepRouteModel(0, {
      decimalPlaces: 4,
      equation: "y",
      formulaPathSteepness: 2,
      steepness: 2,
    });
    if (!model) throw new Error("Expected a valid Step route model");
    const forwardExactTarget = imageToGraphPoint(createPixelPoint(300.75, 150.75), bounds, boundsRect);
    const originalRunRouteTask = runtime.runRouteTask.bind(runtime);
    vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      if (command === 10) {
        const inputView = new DataView(runtime.buffer, inputPointer, inputByteLength);
        inputView.setFloat64(24, 300, true);
        inputView.setFloat64(32, 150, true);
        inputView.setFloat64(88, forwardExactTarget.x, true);
        inputView.setFloat64(96, forwardExactTarget.y, true);
      }
      return originalRunRouteTask(command, inputPointer, inputByteLength);
    });
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 100, y: 225 },
      routeTolerancePlanePixels: 0,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask: new Uint8Array(planeCellCount),
      stepRouteModel: {
        ...model,
        qualityTargetPlanePixels: graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
      },
    });
    const stepRoute = context.stepRoute;
    if (!stepRoute) throw new Error("Expected a retained Step route capability");
    expect(() =>
      stepRoute.findVisibilityGraphPath({
        exactStart: imageToGraphPoint(createPixelPoint(100.25, 225.25), bounds, boundsRect),
        exactTarget: imageToGraphPoint(createPixelPoint(target.x + 0.25, target.y + 0.25), bounds, boundsRect),
        initialState: { resolvedY: 0, routeStateKey: "0" },
        start: { x: 100, y: 225 },
        target,
      }),
    ).toThrow(/requires forward progress/u);
    context.dispose();
  });

  it.each([
    { routeTolerance: 2.25, simulationTolerance: 1.5 },
    { routeTolerance: 0, simulationTolerance: 0 },
    { routeTolerance: -2.25, simulationTolerance: -1.5 },
  ])("matches TS masks for $routeTolerance route tolerance", async ({ routeTolerance, simulationTolerance }) => {
    const runtime = await createRuntime();
    const sourceMask = createSparseMask();
    const friendlySoldierCenters = [{ x: 325, y: 341 }];
    const baseMask = sourceMask.slice();
    addSoldierAreasToObstacleMask(
      baseMask,
      boundsRect,
      friendlySoldierCenters.map((center, index) => createFriendlySoldier(center, index)),
      7,
    );
    const expectedRouteMask = dilateObstacleMask(baseMask, routeTolerance);
    const expectedSimulationMask = dilateObstacleMask(baseMask, simulationTolerance);

    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 2.75,
      bounds,
      boundsRect,
      friendlySoldierCenters,
      routeOriginPoint: { x: 120, y: 225 },
      routeTolerancePlanePixels: routeTolerance,
      simulationTolerancePlanePixels: simulationTolerance,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask,
    });

    expect(context.routeMask).toEqual(expectedRouteMask);
    expect(context.simulationMask).toEqual(expectedSimulationMask);
    expect(context.routeObstacleCount).toBe(countObstacles(expectedRouteMask));
    expect(context.simulationObstacleCount).toBe(countObstacles(expectedSimulationMask));
    context.dispose();
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("keeps nonzero visibility contour tolerance for a preprocessed route mask", async () => {
    const runtime = await createRuntime();
    const sourceMask = createDeterministicThetaMask(4);
    const routeTolerancePlanePixels = 4;
    const routeMask = dilateObstacleMask(sourceMask, routeTolerancePlanePixels);
    const common = {
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      routeOriginPoint: { x: 100, y: 225 },
      routeTolerancePlanePixels,
    } as const;
    const start = { x: 100, y: 225 };
    const target = { x: 600, y: 225 };
    const baseContext = createGraphwarWasmRouteContext(runtime, {
      ...common,
      friendlySoldierCenters: [],
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 0,
      sourceMask,
      sourceMaskType: "base",
    });
    const expected = baseContext.findVisibilityGraphPath(start, target, true);
    const expectedComponentCount = baseContext.routeComponentCount;
    const expectedBoundaryEdgeCount = baseContext.routeBoundaryEdgeCount;
    baseContext.dispose();

    const preprocessedContext = createGraphwarWasmRouteContext(runtime, {
      ...common,
      sourceMask: routeMask,
      sourceMaskType: "route",
    });
    expect(preprocessedContext.routeMask).toEqual(routeMask);
    expect(preprocessedContext.routeComponentCount).toBe(expectedComponentCount);
    expect(preprocessedContext.routeBoundaryEdgeCount).toBe(expectedBoundaryEdgeCount);
    expect(preprocessedContext.findVisibilityGraphPath(start, target, true)).toEqual(expected);
    preprocessedContext.dispose();
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it.each([
    { boundaryExpansion: 0, isMirrored: false, name: "direct", obstacle: "none" as const, routeTolerance: 0 },
    {
      boundaryExpansion: 0,
      isMirrored: false,
      name: "routed tie-break",
      obstacle: "two-gaps" as const,
      routeTolerance: 0,
    },
    {
      boundaryExpansion: 0,
      isMirrored: true,
      name: "mirrored routed tie-break",
      obstacle: "two-gaps" as const,
      routeTolerance: 0,
    },
    { boundaryExpansion: 0, isMirrored: false, name: "no route", obstacle: "wall" as const, routeTolerance: 0 },
    {
      boundaryExpansion: 0,
      isMirrored: false,
      name: "positive tolerance",
      obstacle: "two-wide-gaps" as const,
      routeTolerance: 2.25,
    },
    {
      boundaryExpansion: 0,
      isMirrored: false,
      name: "negative tolerance",
      obstacle: "wall" as const,
      routeTolerance: -2.25,
    },
    {
      boundaryExpansion: 3.75,
      isMirrored: false,
      name: "boundary expansion",
      obstacle: "two-wide-gaps" as const,
      routeTolerance: 0,
    },
  ])("matches stateless Theta* for $name", async ({ boundaryExpansion, isMirrored, obstacle, routeTolerance }) => {
    const runtime = await createRuntime();
    const sourceMask = new Uint8Array(planeCellCount);
    if (obstacle !== "none") {
      for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
        if (
          (obstacle === "two-gaps" && (y === 100 || y === 350)) ||
          (obstacle === "two-wide-gaps" && ((y >= 90 && y <= 110) || (y >= 340 && y <= 360)))
        ) {
          continue;
        }
        sourceMask[y * GRAPHWAR_PLANE_LENGTH + 300] = 1;
      }
    }
    const routeBounds = isMirrored ? { ...bounds, maxX: bounds.minX, minX: bounds.maxX } : bounds;
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion,
      bounds: routeBounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 100, y: 225 },
      routeTolerancePlanePixels: routeTolerance,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask,
    });
    const start = { x: 100, y: 225 };
    const target = { x: 600, y: 225 };
    const physicalStart = mirrorPlaneGridPoint(start, isMirrored);
    const physicalTarget = mirrorPlaneGridPoint(target, isMirrored);
    const expectedPreviews: unknown[] = [];
    const expected = await buildGraphwarThetaStarPathForMask({
      boundaryExpansion,
      bounds: routeBounds,
      boundsRect,
      onPreview: (preview) => expectedPreviews.push(structuredClone(preview)),
      routeMask: context.routeMask,
      startPoint: createPixelPoint(physicalStart.x + 0.5, physicalStart.y + 0.5),
      targetPoint: createPixelPoint(physicalTarget.x + 0.5, physicalTarget.y + 0.5),
    });

    const actual = context.findThetaStarPath(start, target, true);
    if (!expected) {
      expect(actual).toEqual({ expansionCount: expect.any(Number), previews: expectedPreviews, type: "no-route" });
    } else {
      expect(actual.type).toBe("success");
      if (actual.type === "success") {
        expect(actual.path).toEqual(expected.map((point) => mirrorPlaneGridPoint(point, isMirrored)));
      }
    }
    expect(actual.previews).toEqual(expectedPreviews);
    context.dispose();
  });

  it.each([
    { boundaryExpansion: 0, isMirrored: false, name: "direct", obstacle: "none" as const, routeTolerance: 0 },
    {
      boundaryExpansion: 0,
      isMirrored: false,
      name: "routed tie-break",
      obstacle: "two-gaps" as const,
      routeTolerance: 0,
    },
    {
      boundaryExpansion: 0,
      isMirrored: true,
      name: "mirrored routed tie-break",
      obstacle: "two-gaps" as const,
      routeTolerance: 0,
    },
    { boundaryExpansion: 0, isMirrored: false, name: "no route", obstacle: "wall" as const, routeTolerance: 0 },
    {
      boundaryExpansion: 0,
      isMirrored: false,
      name: "positive tolerance",
      obstacle: "two-wide-gaps" as const,
      routeTolerance: 2.25,
    },
    {
      boundaryExpansion: 0,
      isMirrored: false,
      name: "negative tolerance",
      obstacle: "wall" as const,
      routeTolerance: -2.25,
    },
    {
      boundaryExpansion: 3.75,
      isMirrored: false,
      name: "boundary expansion",
      obstacle: "two-wide-gaps" as const,
      routeTolerance: 0,
    },
  ])(
    "matches stateless visibility graph for $name",
    async ({ boundaryExpansion, isMirrored, obstacle, routeTolerance }) => {
      const runtime = await createRuntime();
      const sourceMask = new Uint8Array(planeCellCount);
      if (obstacle !== "none") {
        for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
          if (
            (obstacle === "two-gaps" && (y === 100 || y === 350)) ||
            (obstacle === "two-wide-gaps" && ((y >= 90 && y <= 110) || (y >= 340 && y <= 360)))
          ) {
            continue;
          }
          sourceMask[y * GRAPHWAR_PLANE_LENGTH + 300] = 1;
        }
      }
      const routeBounds = isMirrored ? { ...bounds, maxX: bounds.minX, minX: bounds.maxX } : bounds;
      const context = createGraphwarWasmRouteContext(runtime, {
        boundaryExpansion,
        bounds: routeBounds,
        boundsRect,
        friendlySoldierCenters: [],
        routeOriginPoint: { x: 100, y: 225 },
        routeTolerancePlanePixels: routeTolerance,
        simulationTolerancePlanePixels: 0,
        soldierHitRadiusPixels: 7,
        sourceMaskType: "base",
        sourceMask,
      });
      const start = { x: 100, y: 225 };
      const target = { x: 600, y: 225 };
      const physicalStart = mirrorPlaneGridPoint(start, isMirrored);
      const physicalTarget = mirrorPlaneGridPoint(target, isMirrored);
      const expectedPreviews: unknown[] = [];
      const expected = await buildGraphwarVisibilityGraphPathForMask({
        boundaryExpansion,
        bounds: routeBounds,
        boundsRect,
        onPreview: (preview) => expectedPreviews.push(structuredClone(preview)),
        routeMask: context.routeMask,
        routeTolerancePlanePixels: routeTolerance,
        startPoint: createPixelPoint(physicalStart.x + 0.5, physicalStart.y + 0.5),
        targetPoint: createPixelPoint(physicalTarget.x + 0.5, physicalTarget.y + 0.5),
      });

      const actual = context.findVisibilityGraphPath(start, target, true);
      if (!expected) {
        expect(actual).toEqual({ expansionCount: expect.any(Number), previews: expectedPreviews, type: "no-route" });
      } else {
        expect(actual.type).toBe("success");
        if (actual.type === "success") {
          expect(actual.path).toEqual(expected.map((point) => mirrorPlaneGridPoint(point, isMirrored)));
        }
      }
      expect(actual.previews).toEqual(expectedPreviews);
      context.dispose();
    },
  );

  it.each([
    { fixture: 2, isMirrored: false, routeTolerance: 0 },
    { fixture: 7, isMirrored: true, routeTolerance: 2.25 },
  ])(
    "matches complex visibility path and preview ordering for fixture $fixture",
    async ({ fixture, isMirrored, routeTolerance }) => {
      const runtime = await createRuntime();
      const routeBounds = isMirrored ? { ...bounds, maxX: bounds.minX, minX: bounds.maxX } : bounds;
      const context = createGraphwarWasmRouteContext(runtime, {
        boundaryExpansion: fixture % 3,
        bounds: routeBounds,
        boundsRect,
        friendlySoldierCenters: [],
        routeOriginPoint: { x: 100, y: 225 },
        routeTolerancePlanePixels: routeTolerance,
        simulationTolerancePlanePixels: 0,
        soldierHitRadiusPixels: 7,
        sourceMaskType: "base",
        sourceMask: createDeterministicThetaMask(fixture),
      });
      const start = { x: 100, y: 225 };
      const target = { x: 600, y: 225 };
      const physicalStart = mirrorPlaneGridPoint(start, isMirrored);
      const physicalTarget = mirrorPlaneGridPoint(target, isMirrored);
      const expectedPreviews: unknown[] = [];
      const expected = await buildGraphwarVisibilityGraphPathForMask({
        boundaryExpansion: fixture % 3,
        bounds: routeBounds,
        boundsRect,
        onPreview: (preview) => expectedPreviews.push(structuredClone(preview)),
        routeMask: context.routeMask,
        routeTolerancePlanePixels: routeTolerance,
        startPoint: createPixelPoint(physicalStart.x + 0.5, physicalStart.y + 0.5),
        targetPoint: createPixelPoint(physicalTarget.x + 0.5, physicalTarget.y + 0.5),
      });

      const actual = context.findVisibilityGraphPath(start, target, true);
      expect(actual.type).toBe(expected ? "success" : "no-route");
      if (actual.type === "success") {
        expect(actual.path).toEqual(expected?.map((point) => mirrorPlaneGridPoint(point, isMirrored)));
      }
      expect(actual.previews).toEqual(expectedPreviews);
      context.dispose();
    },
  );

  it("matches visibility search for a stationary request and across arena growth", async () => {
    const runtime = await createRuntime();
    const input = {
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 100, y: 225 },
      routeTolerancePlanePixels: 1.5,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask: createDeterministicThetaMask(4),
    } satisfies GraphwarWasmRouteContextInput;
    const context = createGraphwarWasmRouteContext(runtime, input);
    const point = { x: 100, y: 225 };
    const expectedPreviews: unknown[] = [];
    const expected = await buildGraphwarVisibilityGraphPathForMask({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      onPreview: (preview) => expectedPreviews.push(structuredClone(preview)),
      routeMask: context.routeMask,
      routeTolerancePlanePixels: 1.5,
      startPoint: createPixelPoint(point.x + 0.5, point.y + 0.5),
      targetPoint: createPixelPoint(point.x + 0.5, point.y + 0.5),
    });
    const expectedResult = context.findVisibilityGraphPath(point, point, true);
    expect(expected).toBeUndefined();
    expect(expectedResult).toEqual({
      expansionCount: expect.any(Number),
      previews: expectedPreviews,
      type: "no-route",
    });
    const contextCursor = runtime.arenaCursor;
    expect(context.findVisibilityGraphPath({ x: 100, y: 225 }, { x: 600, y: 225 }, true)).toEqual(
      context.findVisibilityGraphPath({ x: 100, y: 225 }, { x: 600, y: 225 }, true),
    );
    expect(runtime.arenaCursor).toBe(contextCursor);
    const scratchMark = runtime.markArena();
    runtime.reserveArena(runtime.buffer.byteLength * 2, 16);
    runtime.resetArena(scratchMark);
    expect(context.findVisibilityGraphPath(point, point, true)).toEqual(expectedResult);
    expect(runtime.arenaCursor).toBe(contextCursor);
    context.dispose();
  });

  it("reuses Theta* scratch across searches, memory growth, and replacement contexts", async () => {
    const runtime = await createRuntime();
    let contextPointer = 0;
    const originalRunRouteTask = runtime.runRouteTask.bind(runtime);
    vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = originalRunRouteTask(command, inputPointer, inputByteLength);
      if (command === 1) contextPointer = resultPointer;
      return resultPointer;
    });
    const sourceMask = new Uint8Array(planeCellCount);
    for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
      if ((y >= 90 && y <= 110) || (y >= 340 && y <= 360)) continue;
      sourceMask[y * GRAPHWAR_PLANE_LENGTH + 300] = 1;
    }
    const input = {
      boundaryExpansion: 2.75,
      bounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 100, y: 225 },
      routeTolerancePlanePixels: 1.5,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask,
    } satisfies GraphwarWasmRouteContextInput;
    const start = { x: 100, y: 225 };
    const target = { x: 600, y: 225 };
    const context = createGraphwarWasmRouteContext(runtime, input);
    const contextView = new DataView(runtime.buffer, contextPointer, 200);
    const retainedScratchPointers = [168, 172, 176, 180, 188, 192].map((offset) => contextView.getUint32(offset, true));
    const contextCursor = runtime.arenaCursor;
    const expected = context.findThetaStarPath(start, target, true);
    const firstTouchedCount = new DataView(runtime.buffer, contextPointer, 200).getUint32(184, true);
    expect(firstTouchedCount).toBeGreaterThan(0);
    expect(firstTouchedCount).toBeLessThan(planeCellCount);
    expect(runtime.arenaCursor).toBe(contextCursor);
    expect(context.findThetaStarPath(start, target, true)).toEqual(expected);
    const reusedContextView = new DataView(runtime.buffer, contextPointer, 200);
    expect([168, 172, 176, 180, 188, 192].map((offset) => reusedContextView.getUint32(offset, true))).toEqual(
      retainedScratchPointers,
    );
    expect(reusedContextView.getUint32(184, true)).toBe(firstTouchedCount);
    expect(runtime.arenaCursor).toBe(contextCursor);

    const scratchMark = runtime.markArena();
    runtime.reserveArena(runtime.buffer.byteLength * 2, 16);
    runtime.resetArena(scratchMark);
    expect(context.findThetaStarPath(start, target, true)).toEqual(expected);
    expect(runtime.arenaCursor).toBe(contextCursor);
    context.dispose();
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);

    const replacement = createGraphwarWasmRouteContext(runtime, input);
    expect(replacement.findThetaStarPath(start, target, true)).toEqual(expected);
    replacement.dispose();
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("does not count terminal-column dead ends as Theta* expansions", async () => {
    const runtime = await createRuntime();
    const sourceMask = new Uint8Array(planeCellCount);
    sourceMask[226 * GRAPHWAR_PLANE_LENGTH + 101] = 1;
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 100, y: 225 },
      routeTolerancePlanePixels: 0,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask,
    });
    const start = { x: 100, y: 225 };
    const target = { x: 101, y: 227 };
    const expected = await buildGraphwarThetaStarPathForMask({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      routeMask: context.routeMask,
      startPoint: createPixelPoint(start.x + 0.5, start.y + 0.5),
      targetPoint: createPixelPoint(target.x + 0.5, target.y + 0.5),
    });

    expect(expected).toBeUndefined();
    expect(context.findThetaStarPath(start, target, true)).toEqual({
      expansionCount: 1,
      previews: [],
      type: "no-route",
    });
    context.dispose();
  });

  it("matches the single-point Theta* path and its zero-edge preview", async () => {
    const runtime = await createRuntime();
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 100, y: 225 },
      routeTolerancePlanePixels: 0,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask: new Uint8Array(planeCellCount),
    });
    const point = { x: 100, y: 225 };
    const expectedPreviews: unknown[] = [];
    const expected = await buildGraphwarThetaStarPathForMask({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      onPreview: (preview) => expectedPreviews.push(structuredClone(preview)),
      routeMask: context.routeMask,
      startPoint: createPixelPoint(point.x + 0.5, point.y + 0.5),
      targetPoint: createPixelPoint(point.x + 0.5, point.y + 0.5),
    });

    expect(context.findThetaStarPath(point, point, true)).toEqual({
      expansionCount: 0,
      path: expected,
      previews: expectedPreviews,
      type: "success",
    });
    context.dispose();
  });

  it.each([0, 1.5, Number.POSITIVE_INFINITY])("rejects invalid Theta* preview policy value %s", async (value) => {
    const runtime = await createRuntime();
    const originalRunRouteTask = runtime.runRouteTask.bind(runtime);
    vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      if (command === 1) {
        const inputView = new DataView(runtime.buffer, inputPointer, inputByteLength);
        const policyPointer = inputView.getUint32(28, true);
        new DataView(runtime.buffer).setFloat64(policyPointer + 9 * Float64Array.BYTES_PER_ELEMENT, value, true);
      }
      return originalRunRouteTask(command, inputPointer, inputByteLength);
    });

    expect(() =>
      createGraphwarWasmRouteContext(runtime, {
        boundaryExpansion: 0,
        bounds,
        boundsRect,
        friendlySoldierCenters: [],
        routeOriginPoint: { x: 100, y: 225 },
        routeTolerancePlanePixels: 0,
        simulationTolerancePlanePixels: 0,
        soldierHitRadiusPixels: 7,
        sourceMaskType: "base",
        sourceMask: new Uint8Array(planeCellCount),
      }),
    ).toThrow();
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it.each([
    { index: 0, value: -1 },
    { index: 2, value: 1.5 },
    { index: 4, value: 0.5 },
    { index: 6, value: 0 },
    { index: 8, value: Number.POSITIVE_INFINITY },
  ])("rejects invalid visibility policy index $index value $value", async ({ index, value }) => {
    const runtime = await createRuntime();
    const originalRunRouteTask = runtime.runRouteTask.bind(runtime);
    vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      if (command === 1) {
        const inputView = new DataView(runtime.buffer, inputPointer, inputByteLength);
        const policyPointer = inputView.getUint32(28, true);
        new DataView(runtime.buffer).setFloat64(policyPointer + index * Float64Array.BYTES_PER_ELEMENT, value, true);
      }
      return originalRunRouteTask(command, inputPointer, inputByteLength);
    });

    expect(() =>
      createGraphwarWasmRouteContext(runtime, {
        boundaryExpansion: 0,
        bounds,
        boundsRect,
        friendlySoldierCenters: [],
        routeOriginPoint: { x: 100, y: 225 },
        routeTolerancePlanePixels: 0,
        simulationTolerancePlanePixels: 0,
        soldierHitRadiusPixels: 7,
        sourceMaskType: "base",
        sourceMask: new Uint8Array(planeCellCount),
      }),
    ).toThrow();
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it.each([
    { fixture: 1, isMirrored: true },
    { fixture: 6, isMirrored: false },
  ])("matches complex Theta* path and preview ordering for fixture $fixture", async ({ fixture, isMirrored }) => {
    const runtime = await createRuntime();
    const routeBounds = isMirrored ? { ...bounds, maxX: bounds.minX, minX: bounds.maxX } : bounds;
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: fixture % 3,
      bounds: routeBounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 100, y: 225 },
      routeTolerancePlanePixels: 0,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask: createDeterministicThetaMask(fixture),
    });
    const start = { x: 100, y: 225 };
    const target = { x: 600, y: 225 };
    const physicalStart = mirrorPlaneGridPoint(start, isMirrored);
    const physicalTarget = mirrorPlaneGridPoint(target, isMirrored);
    const expectedPreviews: unknown[] = [];
    const expected = await buildGraphwarThetaStarPathForMask({
      boundaryExpansion: fixture % 3,
      bounds: routeBounds,
      boundsRect,
      onPreview: (preview) => expectedPreviews.push(structuredClone(preview)),
      routeMask: context.routeMask,
      startPoint: createPixelPoint(physicalStart.x + 0.5, physicalStart.y + 0.5),
      targetPoint: createPixelPoint(physicalTarget.x + 0.5, physicalTarget.y + 0.5),
    });

    const actual = context.findThetaStarPath(start, target, true);
    expect(actual.type).toBe("success");
    if (actual.type === "success") {
      expect(actual.path).toEqual(expected?.map((point) => mirrorPlaneGridPoint(point, isMirrored)));
    }
    expect(actual.previews).toEqual(expectedPreviews);
    context.dispose();
  });

  it.each([
    {
      corrupt(runtime: Awaited<ReturnType<typeof createRuntime>>, resultView: DataView) {
        const previewPointer = resultView.getUint32(20, true);
        const pointsXPointer = new DataView(runtime.buffer, previewPointer, 48).getUint32(0, true);
        new DataView(runtime.buffer).setFloat64(pointsXPointer, 100.25, true);
      },
      expectedMessage: /plane cell/u,
      name: "fractional preview point",
    },
    {
      corrupt(runtime: Awaited<ReturnType<typeof createRuntime>>, resultView: DataView) {
        const pathXPointer = resultView.getUint32(8, true);
        new DataView(runtime.buffer).setFloat64(pathXPointer + 8, 100, true);
      },
      expectedMessage: /does not advance/u,
      name: "non-advancing result path",
    },
    {
      corrupt(runtime: Awaited<ReturnType<typeof createRuntime>>, resultView: DataView) {
        resultView.setUint32(8, runtime.arenaBase, true);
      },
      faultDomain: "abi" as const,
      expectedMessage: /outside the raw arena/u,
      name: "result path pointing into retained context memory",
    },
    {
      corrupt(_runtime: Awaited<ReturnType<typeof createRuntime>>, resultView: DataView) {
        resultView.setUint32(4, 0, true);
        resultView.setUint32(8, 0, true);
        resultView.setUint32(12, 0, true);
        resultView.setUint32(16, 0, true);
      },
      expectedMessage: /preview range/u,
      name: "no-route result with a terminal preview",
    },
    {
      corrupt(_runtime: Awaited<ReturnType<typeof createRuntime>>, resultView: DataView) {
        resultView.setUint32(20, 0, true);
        resultView.setUint32(24, 0, true);
      },
      expectedMessage: /preview range/u,
      name: "success result without a terminal preview",
    },
  ])("rejects malformed Theta* $name as output", async ({ corrupt, expectedMessage, faultDomain = "output" }) => {
    const runtime = await createRuntime();
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 100, y: 225 },
      routeTolerancePlanePixels: 0,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask: new Uint8Array(planeCellCount),
    });
    const originalRunRouteTask = runtime.runRouteTask.bind(runtime);
    vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = originalRunRouteTask(command, inputPointer, inputByteLength);
      if (command === 6) corrupt(runtime, new DataView(runtime.buffer, resultPointer, 32));
      return resultPointer;
    });

    let caught: unknown;
    try {
      context.findThetaStarPath({ x: 100, y: 225 }, { x: 600, y: 225 }, true);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ faultDomain });
    expect(caught).toEqual(expect.objectContaining({ message: expect.stringMatching(expectedMessage) }));
    context.dispose();
  });

  it("rejects a stationary visibility success while preserving Theta single-point success", async () => {
    const runtime = await createRuntime();
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 100, y: 225 },
      routeTolerancePlanePixels: 0,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask: new Uint8Array(planeCellCount),
    });
    const point = { x: 100, y: 225 };
    expect(context.findThetaStarPath(point, point)).toMatchObject({ path: [point], type: "success" });
    const originalRunRouteTask = runtime.runRouteTask.bind(runtime);
    vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = originalRunRouteTask(command, inputPointer, inputByteLength);
      if (command !== 7) return resultPointer;
      const pathXPointer = runtime.reserveArena(Float64Array.BYTES_PER_ELEMENT, Float64Array.BYTES_PER_ELEMENT);
      const pathYPointer = runtime.reserveArena(Float64Array.BYTES_PER_ELEMENT, Float64Array.BYTES_PER_ELEMENT);
      const memoryView = new DataView(runtime.buffer);
      memoryView.setFloat64(pathXPointer, point.x, true);
      memoryView.setFloat64(pathYPointer, point.y, true);
      const resultView = new DataView(runtime.buffer, resultPointer, 32);
      resultView.setUint32(4, 1, true);
      resultView.setUint32(8, pathXPointer, true);
      resultView.setUint32(12, pathYPointer, true);
      resultView.setUint32(16, 1, true);
      return resultPointer;
    });

    expect(() => context.findVisibilityGraphPath(point, point)).toThrow(/requires forward progress/u);
    context.dispose();
  });

  it.each([
    { boundsRect: { ...boundsRect, width: Number.MIN_VALUE }, soldierHitRadiusPixels: 7 },
    { boundsRect, soldierHitRadiusPixels: 1e9 },
  ])("matches TS friendly circles for extreme finite radius inputs", async (input) => {
    const runtime = await createRuntime();
    const sourceMask = new Uint8Array(planeCellCount);
    const friendlySoldierCenters = [{ x: 325, y: 341 }];
    const expected = sourceMask.slice();
    addSoldierAreasToObstacleMask(
      expected,
      input.boundsRect,
      friendlySoldierCenters.map((center, index) => createFriendlySoldier(center, index)),
      input.soldierHitRadiusPixels,
    );

    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds,
      boundsRect: input.boundsRect,
      friendlySoldierCenters,
      routeOriginPoint: { x: 120, y: 225 },
      routeTolerancePlanePixels: 0,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: input.soldierHitRadiusPixels,
      sourceMaskType: "base",
      sourceMask,
    });

    expect(context.routeMask).toEqual(expected);
    expect(context.routeObstacleCount).toBe(planeCellCount);
    context.dispose();
  });

  it("handles extreme finite positive and negative tolerances without enumerating irrelevant offsets", async () => {
    const runtime = await createRuntime();
    const sourceMask = new Uint8Array(planeCellCount);
    sourceMask[225 * GRAPHWAR_PLANE_LENGTH + 385] = 1;

    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 120, y: 225 },
      routeTolerancePlanePixels: Number.MAX_VALUE,
      simulationTolerancePlanePixels: -Number.MAX_VALUE,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask,
    });

    expect(context.routeMask.every((value) => value === 1)).toBe(true);
    expect(context.routeObstacleCount).toBe(planeCellCount);
    expect(context.simulationObstacleCount).toBe(0);
    context.dispose();
  });

  it("matches point, line, closed-region, component, and boundary-edge semantics", async () => {
    const runtime = await createRuntime();
    const sourceMask = new Uint8Array(planeCellCount);
    fillRectangle(sourceMask, 100, 110, 50, 60);
    fillRectangle(sourceMask, 200, 205, 100, 105);
    sourceMask[106 * GRAPHWAR_PLANE_LENGTH + 206] = 1;
    const summedArea = createGraphwarPlaneMaskSummedArea(sourceMask);
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 2.75,
      bounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 80, y: 225 },
      routeTolerancePlanePixels: 0,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask,
    });

    for (const point of [
      { x: 0, y: 0 },
      { x: 2, y: 2 },
      { x: 100, y: 50 },
      { x: 111, y: 61 },
    ]) {
      expect(context.pointHitsObstacle(point)).toBe(pointHitsPlaneMask(point, sourceMask, false, 2.75));
    }
    for (const [start, end] of [
      [
        { x: 20, y: 55 },
        { x: 150, y: 55 },
      ],
      [
        { x: 20, y: 20 },
        { x: 150, y: 20 },
      ],
      [
        { x: 1, y: 10 },
        { x: 10, y: 10 },
      ],
    ] as const) {
      expect(context.lineHitsObstacle(start, end)).toBe(lineHitsPlaneMask(start, end, sourceMask, false, 2.75));
    }

    const planeRegion = { maxX: 205, maxY: 105, minX: 200, minY: 100 };
    expect(context.countPlaneRegionObstacles(planeRegion)).toBe(countPlaneMaskRegionObstacles(summedArea, planeRegion));
    const graphRegion = { maxX: -17, maxY: 12, minX: -19, minY: 10 };
    expect(context.graphRegionHitsObstacle(graphRegion)).toBe(
      graphClosedRegionHitsPlaneMask(graphRegion, bounds, summedArea, 2.75),
    );
    expect(context.routeComponentCount).toBe(2);
    expect(context.routeBoundaryEdgeCount).toBe(72);

    context.dispose();
  });

  it("keeps a mirrored context valid across memory growth and rejects use after disposal", async () => {
    const runtime = await createRuntime();
    const sourceMask = new Uint8Array(planeCellCount);
    sourceMask[40 * GRAPHWAR_PLANE_LENGTH + 700] = 1;
    sourceMask[300 * GRAPHWAR_PLANE_LENGTH + 100] = 1;
    const mirroredBounds = { ...bounds, maxX: bounds.minX, minX: bounds.maxX };
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds: mirroredBounds,
      boundsRect,
      friendlySoldierCenters: [],
      routeOriginPoint: { x: 720, y: 225 },
      routeTolerancePlanePixels: 0,
      simulationTolerancePlanePixels: 0,
      soldierHitRadiusPixels: 7,
      sourceMaskType: "base",
      sourceMask,
    });

    expect(context.isMirrored).toBe(true);
    expect(context.pointHitsObstacle({ x: 69, y: 40 })).toBe(true);
    expect(context.pointHitsObstacle({ x: 669, y: 300 })).toBe(true);
    expect(context.lineHitsObstacle({ x: 20, y: 40 }, { x: 100, y: 40 })).toBe(true);
    expect(context.routeComponentCount).toBe(2);
    expect(context.routeBoundaryEdgeCount).toBe(8);

    const scratchMark = runtime.markArena();
    runtime.reserveArena(runtime.buffer.byteLength * 2, 16);
    runtime.resetArena(scratchMark);
    expect(context.pointHitsObstacle({ x: 69, y: 40 })).toBe(true);

    context.dispose();
    expect(() => context.pointHitsObstacle({ x: 69, y: 40 })).toThrow(/disposed/u);
    expect(() =>
      context.runSmartPathfinding({
        isDeleteOptimizationEnabled: false,
        points: [{ x: 100, y: 225 }],
        sourcePointCount: 1,
        target: { x: 100, y: 225 },
        targetRadius: 0,
        trajectoryValidation: { type: "route-only" },
      }),
    ).toThrow(/disposed/u);
    expect(() => context.dispose()).toThrow(/disposed/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("validates smart graph order and retained route obstacles inside WASM", async () => {
    const runtime = await createRuntime();
    const routeMask = new Uint8Array(planeCellCount);
    routeMask[225 * GRAPHWAR_PLANE_LENGTH + 385] = 1;
    routeMask[1 * GRAPHWAR_PLANE_LENGTH + 1] = 1;
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      routeOriginPoint: { x: -25, y: 0 },
      routeTolerancePlanePixels: 0,
      sourceMask: routeMask,
      sourceMaskType: "route",
    });

    expect(
      context.runSmartPathfinding({
        isDeleteOptimizationEnabled: true,
        points: [
          { x: 100, y: 225 },
          { x: 150, y: 225 },
          { x: 200, y: 225 },
        ],
        sourcePointCount: 1,
        target: { x: 200, y: 225 },
        targetRadius: 0,
        trajectoryValidation: { type: "route-only" },
      }),
    ).toMatchObject({ removedPointCount: 1, status: "success" });

    expect(
      context.runSmartPathfinding({
        isDeleteOptimizationEnabled: false,
        points: [
          { x: 100, y: 225 },
          { x: 100, y: 225 },
          { x: 200, y: 225 },
        ],
        sourcePointCount: 1,
        target: { x: 200, y: 225 },
        targetRadius: 0,
        trajectoryValidation: { type: "route-only" },
      }),
    ).toMatchObject({ failureReason: "graph-rule", status: "failure" });

    expect(
      context.runSmartPathfinding({
        isDeleteOptimizationEnabled: false,
        points: [
          { x: 100, y: 225 },
          { x: 200, y: 225 },
        ],
        sourcePointCount: 1,
        target: { x: 600, y: 225 },
        targetRadius: 0,
        trajectoryValidation: { type: "route-only" },
      }),
    ).toMatchObject({ failureReason: "target", status: "failure" });

    expect(
      context.runSmartPathfinding({
        isDeleteOptimizationEnabled: false,
        points: [{ x: 1, y: 1 }],
        sourcePointCount: 1,
        target: { x: 1, y: 1 },
        targetRadius: 0,
        trajectoryValidation: { type: "route-only" },
      }),
    ).toMatchObject({ failureReason: "route-obstacle", status: "failure" });

    expect(
      context.runSmartPathfinding({
        isDeleteOptimizationEnabled: false,
        points: [{ x: -1, y: 1 }],
        sourcePointCount: 1,
        target: { x: -1, y: 1 },
        targetRadius: 0,
        trajectoryValidation: { type: "route-only" },
      }),
    ).toMatchObject({ failureReason: "route-obstacle", status: "failure" });

    expect(
      context.runSmartPathfinding({
        isDeleteOptimizationEnabled: false,
        points: [
          { x: 100, y: 225 },
          { x: 100, y: 225 },
          { x: 200, y: 225 },
        ],
        sourcePointCount: 1,
        target: { x: 600, y: 225 },
        targetRadius: 0,
        trajectoryValidation: { type: "route-only" },
      }),
    ).toMatchObject({ failureReason: "graph-rule", status: "failure" });

    expect(
      context.runSmartPathfinding({
        isDeleteOptimizationEnabled: false,
        points: [
          { x: 100, y: 225 },
          { x: 600, y: 225 },
        ],
        sourcePointCount: 1,
        target: { x: 600, y: 225 },
        targetRadius: 0,
        trajectoryValidation: { type: "route-only" },
      }),
    ).toMatchObject({ failureReason: "route-obstacle", status: "failure" });
    context.dispose();
  });

  it("preserves graph order and route-mask identity for mirrored smart paths", async () => {
    const runtime = await createRuntime();
    const mirroredBounds = { ...bounds, maxX: bounds.minX, minX: bounds.maxX };
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds: mirroredBounds,
      boundsRect,
      routeOriginPoint: { x: 25, y: 0 },
      routeTolerancePlanePixels: 0,
      sourceMask: new Uint8Array(planeCellCount),
      sourceMaskType: "route",
    });

    expect(
      context.runSmartPathfinding({
        isDeleteOptimizationEnabled: false,
        points: [
          { x: 600, y: 225 },
          { x: 100, y: 225 },
        ],
        sourcePointCount: 1,
        target: { x: 100, y: 225 },
        targetRadius: 0,
        trajectoryValidation: { type: "route-only" },
      }),
    ).toMatchObject({ status: "success" });
    context.dispose();
  });

  it("quantizes mirrored smart route points directly in the plane domain", async () => {
    const runtime = await createRuntime();
    const mirroredBounds = { ...bounds, maxX: bounds.minX, minX: bounds.maxX };
    const sourceMask = new Uint8Array(planeCellCount);
    sourceMask[1 * GRAPHWAR_PLANE_LENGTH + 1] = 1;
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds: mirroredBounds,
      boundsRect,
      routeOriginPoint: { x: 25, y: 0 },
      routeTolerancePlanePixels: 0,
      sourceMask,
      sourceMaskType: "route",
    });

    expect(
      context.runSmartPathfinding({
        isDeleteOptimizationEnabled: false,
        points: [{ x: 1, y: 1 }],
        sourcePointCount: 1,
        target: { x: 1, y: 1 },
        targetRadius: 0,
        trajectoryValidation: { type: "route-only" },
      }),
    ).toMatchObject({ failureReason: "route-obstacle", status: "failure" });
    context.dispose();
  });

  it.each([
    { name: "normal", isMirrored: false },
    { name: "mirrored", isMirrored: true },
  ])("keeps continuous Graphwar x+ for subpixel points in a scaled $name map", async ({ isMirrored }) => {
    const runtime = await createRuntime();
    const scaledBoundsRect = { height: 900, width: 1540, x: 10.25, y: 20.75 };
    const routeBounds = isMirrored ? { ...bounds, maxX: bounds.minX, minX: bounds.maxX } : bounds;
    const firstPoint = createPixelPoint(scaledBoundsRect.x + (isMirrored ? 200.4 : 200.1), scaledBoundsRect.y + 450);
    const targetPoint = createPixelPoint(scaledBoundsRect.x + (isMirrored ? 200.1 : 200.4), scaledBoundsRect.y + 450);
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds: routeBounds,
      boundsRect: scaledBoundsRect,
      routeOriginPoint: imageToGraphPoint(firstPoint, routeBounds, scaledBoundsRect),
      routeTolerancePlanePixels: 0,
      sourceMask: new Uint8Array(planeCellCount),
      sourceMaskType: "route",
    });

    expect(
      context.runSmartPathfinding({
        isDeleteOptimizationEnabled: false,
        points: [firstPoint, targetPoint],
        sourcePointCount: 1,
        target: targetPoint,
        targetRadius: 0,
        trajectoryValidation: { type: "route-only" },
      }),
    ).toMatchObject({ status: "success" });
    context.dispose();
  });

  it.each([
    {
      corrupt(runtime: Awaited<ReturnType<typeof createRuntime>>, contextView: DataView) {
        const componentPointer = contextView.getUint32(48, true);
        new Uint32Array(runtime.buffer, componentPointer, planeCellCount)[50 * GRAPHWAR_PLANE_LENGTH + 100] = 0;
      },
      expectedMessage: /component cache/u,
      name: "component label",
    },
    {
      corrupt(runtime: Awaited<ReturnType<typeof createRuntime>>, contextView: DataView) {
        const edgePointer = contextView.getUint32(56, true);
        new Uint32Array(runtime.buffer, edgePointer, contextView.getUint32(60, true))[1] = 999;
      },
      expectedMessage: /boundary-edge cache/u,
      name: "boundary edge",
    },
    {
      corrupt(runtime: Awaited<ReturnType<typeof createRuntime>>, contextView: DataView) {
        const spanOffsetsPointer = contextView.getUint32(152, true);
        new Uint32Array(runtime.buffer, spanOffsetsPointer, GRAPHWAR_PLANE_LENGTH + 1)[0] = 1;
      },
      expectedMessage: /free-span offsets/u,
      name: "free span",
    },
    {
      corrupt(_runtime: Awaited<ReturnType<typeof createRuntime>>, contextView: DataView) {
        contextView.setUint32(172, contextView.getUint32(176, true), true);
      },
      expectedMessage: /ranges overlap/u,
      name: "aliased Theta scratch",
    },
    {
      corrupt(runtime: Awaited<ReturnType<typeof createRuntime>>, contextView: DataView) {
        const closedPointer = contextView.getUint32(168, true);
        new Uint8Array(runtime.buffer, closedPointer, planeCellCount)[0] = 1;
      },
      expectedMessage: /invalid initial state/u,
      name: "dirty Theta scratch",
    },
    {
      corrupt(_runtime: Awaited<ReturnType<typeof createRuntime>>, contextView: DataView) {
        contextView.setUint32(228, contextView.getUint32(232, true), true);
      },
      expectedMessage: /ranges overlap/u,
      name: "aliased visibility contours",
    },
    {
      corrupt(runtime: Awaited<ReturnType<typeof createRuntime>>, contextView: DataView) {
        const offsetsPointer = contextView.getUint32(216, true);
        new Uint32Array(runtime.buffer, offsetsPointer, contextView.getUint32(220, true))[0] = 1;
      },
      expectedMessage: /contour ranges/u,
      name: "invalid visibility contour offset",
    },
    {
      corrupt(runtime: Awaited<ReturnType<typeof createRuntime>>, contextView: DataView) {
        const areaPointer = contextView.getUint32(236, true);
        new Float64Array(runtime.buffer, areaPointer, contextView.getUint32(240, true))[0] = Number.NaN;
      },
      expectedMessage: /contour area/u,
      name: "invalid visibility contour area",
    },
    {
      corrupt(runtime: Awaited<ReturnType<typeof createRuntime>>, contextView: DataView) {
        const xPointer = contextView.getUint32(228, true);
        new Uint32Array(runtime.buffer, xPointer, contextView.getUint32(244, true))[0] = 0;
      },
      expectedMessage: /component boundary/u,
      name: "visibility contour point outside its component boundary",
    },
  ])("rejects a malformed retained $name", async ({ corrupt, expectedMessage }) => {
    const runtime = await createRuntime();
    const sourceMask = new Uint8Array(planeCellCount);
    sourceMask[50 * GRAPHWAR_PLANE_LENGTH + 100] = 1;
    const originalRunRouteTask = runtime.runRouteTask.bind(runtime);
    vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = originalRunRouteTask(command, inputPointer, inputByteLength);
      if (command === 1) {
        corrupt(runtime, new DataView(runtime.buffer, resultPointer, 264));
      }
      return resultPointer;
    });

    expect(() =>
      createGraphwarWasmRouteContext(runtime, {
        boundaryExpansion: 0,
        bounds,
        boundsRect,
        friendlySoldierCenters: [],
        routeOriginPoint: { x: 120, y: 225 },
        routeTolerancePlanePixels: 0,
        simulationTolerancePlanePixels: 0,
        soldierHitRadiusPixels: 7,
        sourceMaskType: "base",
        sourceMask,
      }),
    ).toThrow(expectedMessage);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });
});

async function createRuntime() {
  return instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
}

function createSparseMask() {
  const mask = new Uint8Array(planeCellCount);
  fillRectangle(mask, 0, 4, 0, 4);
  fillRectangle(mask, 380, 390, 220, 230);
  fillRectangle(mask, 760, 769, 440, 449);
  return mask;
}

function createDeterministicThetaMask(fixture: number) {
  const mask = new Uint8Array(planeCellCount);
  let state = (fixture + 1) * 0x9e37_79b1;
  for (const x of [180, 260, 340, 420, 500]) {
    state = Math.imul(state ^ (state >>> 16), 0x45d9_f3b);
    const gapCenter = 35 + ((state >>> 0) % 380);
    const gapRadius = 4 + ((state >>> 8) % 20);
    for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
      if (Math.abs(y - gapCenter) <= gapRadius) continue;
      mask[y * GRAPHWAR_PLANE_LENGTH + x] = 1;
    }
  }
  return mask;
}

function evaluateExpectedStepTerminalState(
  path: readonly PlaneGridPoint[],
  evaluateEdge: GraphwarPathfindingEdgeEvaluator,
  initialState: { resolvedY: number; routeStateKey: string },
) {
  let resolvedY = initialState.resolvedY;
  let routeStateKey = initialState.routeStateKey;
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const next = path[index];
    if (!previous || !next) {
      throw new Error("Expected a complete TS Step path");
    }
    const edge = evaluateEdge(previous, next, resolvedY, routeStateKey);
    if (!edge?.nextRouteStateKey) {
      throw new Error("Expected the TS Step path to preserve its canonical route state");
    }
    resolvedY = edge.nextRouteState;
    routeStateKey = edge.nextRouteStateKey;
  }
  return { resolvedY, routeStateKey };
}

function fillRectangle(mask: Uint8Array, minX: number, maxX: number, minY: number, maxY: number) {
  for (let y = minY; y <= maxY; y += 1) {
    mask.fill(1, y * GRAPHWAR_PLANE_LENGTH + minX, y * GRAPHWAR_PLANE_LENGTH + maxX + 1);
  }
}

function countObstacles(mask: Uint8Array) {
  let count = 0;
  for (const value of mask) {
    count += value ? 1 : 0;
  }
  return count;
}

function createFriendlySoldier(center: { x: number; y: number }, index: number) {
  return {
    confidence: 1,
    height: 14,
    hitRadius: 7,
    id: `friendly-${index}`,
    kind: "soldier" as const,
    isMirrored: false,
    selectionRadius: 7,
    sourceCenterX: center.x,
    sourceCenterY: center.y,
    templateName: "soldier1.png",
    visualCenterX: center.x,
    visualCenterY: center.y,
    visualRadius: 7,
    width: 14,
    x: center.x - 7,
    y: center.y - 7,
  };
}
