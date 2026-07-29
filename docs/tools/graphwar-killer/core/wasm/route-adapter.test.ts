import { beforeAll, describe, expect, it, vi } from "vitest";

import { addSoldierAreasToObstacleMask, dilateObstacleMask } from "../../detection/objects";
import {
  countPlaneMaskRegionObstacles,
  createGraphwarPlaneMaskSummedArea,
  graphClosedRegionHitsPlaneMask,
} from "../../pathfinding/routing/step-envelope";
import { lineHitsPlaneMask, pointHitsPlaneMask } from "../../pathfinding/routing/visibility-graph";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../game/constants";
import { readGraphwarKernelBytes } from "./kernel-test-fixture";
import { createGraphwarWasmRouteContext } from "./route-adapter";
import { instantiateGraphwarWasmRuntime } from "./runtime";

const planeCellCount = GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT;
const boundsRect = { height: 450, width: 770, x: 0, y: 0 };
const bounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
let kernelModule: WebAssembly.Module;

beforeAll(async () => {
  kernelModule = await WebAssembly.compile(await readGraphwarKernelBytes());
});

describe("Graphwar WASM route context", () => {
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
      sourceMask,
    });

    expect(context.routeMask).toEqual(expectedRouteMask);
    expect(context.simulationMask).toEqual(expectedSimulationMask);
    expect(context.routeObstacleCount).toBe(countObstacles(expectedRouteMask));
    expect(context.simulationObstacleCount).toBe(countObstacles(expectedSimulationMask));
    context.dispose();
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
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
    expect(() => context.dispose()).toThrow(/disposed/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
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
  ])("rejects a malformed retained $name", async ({ corrupt, expectedMessage }) => {
    const runtime = await createRuntime();
    const sourceMask = new Uint8Array(planeCellCount);
    sourceMask[50 * GRAPHWAR_PLANE_LENGTH + 100] = 1;
    const originalRunRouteTask = runtime.runRouteTask.bind(runtime);
    vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = originalRunRouteTask(command, inputPointer, inputByteLength);
      if (command === 1) {
        corrupt(runtime, new DataView(runtime.buffer, resultPointer, 152));
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
