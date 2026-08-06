import { beforeAll, describe, expect, it } from "vitest";

import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { graphToImagePoint } from "../../core/geometry";
import { createGraphPoint } from "../../core/types";
import type { BoundsRect, GraphBounds } from "../../core/types";
import { readGraphwarKernelBytes } from "../../core/wasm/kernel-test-fixture";
import { instantiateGraphwarWasmRuntime, type GraphwarWasmKernelRuntime } from "../../core/wasm/runtime";
import { createGraphwarTrajectoryFormulaMode } from "../../formula/trajectory/sampling";
import { createGraphwarSmartPathfindingTrajectoryResult } from "./trajectory";

const bounds: GraphBounds = { maxX: -4, maxY: 10, minX: -12, minY: -10 };
const boundsRect: BoundsRect = { height: GRAPHWAR_PLANE_HEIGHT, width: GRAPHWAR_PLANE_LENGTH, x: 0, y: 0 };
let kernelModule: WebAssembly.Module;

beforeAll(async () => {
  kernelModule = await WebAssembly.compile(await readGraphwarKernelBytes());
});

describe("Step glitch smart trajectory validation", () => {
  it("rejects an early circle hit when an obstacle blocks the assigned target x", () => {
    const start = toPixel(-11, 0);
    const target = toPixel(-6, 0);
    const obstacleMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    const wallX = Math.floor(toPixel(-8, 0).x);
    for (let row = 0; row < GRAPHWAR_PLANE_HEIGHT; row += 1) {
      obstacleMask[row * GRAPHWAR_PLANE_LENGTH + wallX] = 1;
    }

    const formulaMode = createGraphwarTrajectoryFormulaMode({
      algorithm: "step",
      decimalPlaces: 4,
      equation: "dy",
      steepness: 67,
      isStepGlitchModeEnabled: true,
      stepGlitchObstacleMask: obstacleMask,
      isStepOverflowProtectionEnabled: true,
    });
    const result = createGraphwarSmartPathfindingTrajectoryResult({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      formulaMode,
      hitTarget: { center: target, radius: 300 },
      obstacleMask,
      points: [start, target],
      targetHitRadiusPixels: 300,
    });

    expect(result.reachesTargetBeforeObstacle).toBe(false);
    expect(result.blockedPoint).toBeDefined();
  });

  it("validates only the target requested by this single-target search", () => {
    const start = toPixel(-11, 0);
    const target = toPixel(-8, 0);

    const formulaMode = createGraphwarTrajectoryFormulaMode({
      algorithm: "step",
      decimalPlaces: 4,
      equation: "y",
      steepness: 67,
      isStepGlitchModeEnabled: false,
      isStepOverflowProtectionEnabled: true,
    });
    const result = createGraphwarSmartPathfindingTrajectoryResult({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      formulaMode,
      hitTarget: { center: target, radius: 2 },
      obstacleMask: new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT),
      points: [start, target],
      targetHitRadiusPixels: 2,
    });

    expect(result.reachesTargetBeforeObstacle).toBe(true);
  });

  it("keeps the ordinary obstacle preview identical across TS and WASM", async () => {
    const start = toPixel(-11, 0);
    const target = toPixel(-6, 0);
    const obstacleMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    const wallX = Math.floor(toPixel(-8, 0).x);
    for (let row = 0; row < GRAPHWAR_PLANE_HEIGHT; row += 1) {
      obstacleMask[row * GRAPHWAR_PLANE_LENGTH + wallX] = 1;
    }
    const options = {
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "step",
        decimalPlaces: 4,
        equation: "y",
        steepness: 67,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      }),
      hitTarget: { center: target, radius: 2 },
      obstacleMask,
      points: [start, toPixel(-9, 1), target],
      targetHitRadiusPixels: 2,
    };

    const typescript = createGraphwarSmartPathfindingTrajectoryResult(options);
    const wasm = createGraphwarSmartPathfindingTrajectoryResult({ ...options, wasmRuntime: await createRuntime() });

    expect(typescript.blockedPoint).toEqual(typescript.visiblePixels.at(-1));
    expect(typescript.pathError).toEqual(expect.any(Number));
    expect(wasm).toEqual(typescript);
  });
});

function toPixel(x: number, y: number) {
  return graphToImagePoint(createGraphPoint(x, y), bounds, boundsRect);
}

async function createRuntime(): Promise<GraphwarWasmKernelRuntime> {
  return instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 65_536 });
}
