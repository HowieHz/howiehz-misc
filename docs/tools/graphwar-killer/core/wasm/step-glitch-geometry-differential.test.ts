import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  createGraphwarTrajectoryFormulaMode,
  type GraphwarStepGlitchFormulaPrefix,
} from "../../formula/trajectory/sampling";
import {
  createGraphwarStepGlitchPrefixEvidence,
  createGraphwarStepGlitchScanMaskIndex,
} from "../../pathfinding/routing/step-glitch-scan";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../game/constants";
import { createGraphPoint, createPixelPoint } from "../types";
import { readGraphwarKernelBytes } from "./kernel-test-fixture";
import { instantiateGraphwarWasmRuntime } from "./runtime";
import {
  createGraphwarWasmStepGlitchContextInput,
  createGraphwarWasmStepGlitchGeometryTestContext,
} from "./step-glitch-adapter";

const boundsRect = { height: 450, width: 770, x: 0, y: 0 };
const planeCellCount = GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT;
let kernelModule: WebAssembly.Module;

beforeAll(async () => {
  kernelModule = await WebAssembly.compile(await readGraphwarKernelBytes());
});

describe("Graphwar WASM Step-glitch retained geometry context", () => {
  it.each([
    { bounds: { maxX: 12, maxY: 10, minX: 4, minY: -10 }, isMirrored: false, name: "direct" },
    { bounds: { maxX: 4, maxY: 10, minX: 12, minY: -10 }, isMirrored: true, name: "mirrored" },
  ])("matches the complete TS farthest-free index for $name coordinates", async ({ bounds, isMirrored }) => {
    const mask = createMask();
    const boundaryExpansion = 2;
    const expected = createGraphwarStepGlitchScanMaskIndex({ boundaryExpansion, bounds, simulationMask: mask });
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
    const initialCursor = runtime.arenaCursor;
    const oldBuffer = runtime.buffer;
    const result = createGraphwarWasmStepGlitchGeometryTestContext(
      runtime,
      createContextInput(bounds, mask, boundaryExpansion),
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      throw new Error("expected a retained Step-glitch geometry context");
    }
    expect(result.context.isMirrored).toBe(isMirrored);
    expect(result.context.copyFarthestFreeX()).toEqual(expected.farthestFreeX);
    expect(runtime.buffer).not.toBe(oldBuffer);
    expect(oldBuffer.byteLength).toBe(0);
    result.context.dispose();
    expect(runtime.arenaCursor).toBe(initialCursor);
    expect(() => result.context.copyFarthestFreeX()).toThrowError();
  });

  it("blocks the full plane when expansion reaches a plane dimension", async () => {
    const bounds = { maxX: 12, maxY: 10, minX: 4, minY: -10 };
    const mask = new Uint8Array(planeCellCount);
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
    const result = createGraphwarWasmStepGlitchGeometryTestContext(
      runtime,
      createContextInput(bounds, mask, GRAPHWAR_PLANE_HEIGHT),
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      throw new Error("expected a retained Step-glitch geometry context");
    }
    expect(result.context.copyFarthestFreeX().every((value) => value === -1)).toBe(true);
    result.context.dispose();
  });

  it("turns malformed raw ranges into a typed fault and restores the context mark", async () => {
    const bounds = { maxX: 12, maxY: 10, minX: 4, minY: -10 };
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
    const initialCursor = runtime.arenaCursor;
    const runRouteTask = runtime.runRouteTask.bind(runtime);
    vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      new DataView(runtime.buffer).setUint32(inputPointer + 24, 0, true);
      return runRouteTask(command, inputPointer, inputByteLength);
    });

    expect(() =>
      createGraphwarWasmStepGlitchGeometryTestContext(
        runtime,
        createContextInput(bounds, new Uint8Array(planeCellCount), 0),
      ),
    ).toThrowError();
    expect(runtime.arenaCursor).toBe(initialCursor);
    expect(runtime.getArenaDiagnostics().isCanaryIntact).toBe(true);
  });

  it("retains nonempty required targets and prefix evidence in one raw context", async () => {
    const bounds = { maxX: 12, maxY: 10, minX: 4, minY: -10 };
    const mask = new Uint8Array(planeCellCount);
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
    const result = createGraphwarWasmStepGlitchGeometryTestContext(runtime, createContextInput(bounds, mask, 2, true));

    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      throw new Error("expected a retained Step-glitch geometry context");
    }
    expect(result.context.copyFarthestFreeX()).toHaveLength(planeCellCount);
    result.context.dispose();
  });

  it("rejects a malformed farthest-free output length", async () => {
    const bounds = { maxX: 12, maxY: 10, minX: 4, minY: -10 };
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
    const initialCursor = runtime.arenaCursor;
    const runRouteTask = runtime.runRouteTask.bind(runtime);
    vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      const contextPointer = runRouteTask(command, inputPointer, inputByteLength);
      new DataView(runtime.buffer).setUint32(contextPointer + 64, 1, true);
      return contextPointer;
    });

    expect(() =>
      createGraphwarWasmStepGlitchGeometryTestContext(
        runtime,
        createContextInput(bounds, new Uint8Array(planeCellCount), 0),
      ),
    ).toThrowError();
    expect(runtime.arenaCursor).toBe(initialCursor);
  });

  it.each([
    {
      mutate(view: DataView, settingsPointer: number) {
        view.setFloat64(settingsPointer + 2 * 8, 4.5, true);
      },
      name: "fractional decimal places",
    },
    {
      mutate(view: DataView, settingsPointer: number) {
        view.setFloat64(settingsPointer + 1 * 8, 99, true);
      },
      name: "unknown equation",
    },
    {
      mutate(view: DataView, settingsPointer: number) {
        view.setFloat64(settingsPointer + 6 * 8, 8, true);
      },
      name: "unknown flags",
    },
    {
      mutate(view: DataView, settingsPointer: number) {
        view.setFloat64(settingsPointer + 4 * 8, -1, true);
        view.setFloat64(settingsPointer + 6 * 8, view.getFloat64(settingsPointer + 6 * 8, true) | 4, true);
      },
      name: "negative present formula path steepness",
    },
  ])("rejects raw Formula Mode corruption: $name", async ({ mutate }) => {
    const bounds = { maxX: 12, maxY: 10, minX: 4, minY: -10 };
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
    const initialCursor = runtime.arenaCursor;
    const runRouteTask = runtime.runRouteTask.bind(runtime);
    vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      const view = new DataView(runtime.buffer);
      mutate(view, view.getUint32(inputPointer + 8, true));
      return runRouteTask(command, inputPointer, inputByteLength);
    });

    expect(() =>
      createGraphwarWasmStepGlitchGeometryTestContext(
        runtime,
        createContextInput(bounds, new Uint8Array(planeCellCount), 0),
      ),
    ).toThrowError();
    expect(runtime.arenaCursor).toBe(initialCursor);
  });
});

function createContextInput(
  bounds: { maxX: number; maxY: number; minX: number; minY: number },
  mask: Uint8Array,
  simulationBoundaryExpansion: number,
  hasPrefixEvidence = false,
) {
  const settings = {
    algorithm: "step" as const,
    decimalPlaces: 4,
    equation: "dy" as const,
    isStepGlitchModeEnabled: true,
    isStepOverflowProtectionEnabled: true,
    steepness: 67,
    stepGlitchObstacleMask: mask,
  };
  const sourcePath = [createPixelPoint(96, 225), createPixelPoint(337, 225)];
  const prefixTarget = { center: sourcePath[1], radius: 12 };
  const graphPoints = [createGraphPoint(-11, 0), createGraphPoint(-8.5, 0)];
  const formulaEvidence = {
    prefix: {
      bounds,
      initialFormulaPoints: graphPoints,
      points: graphPoints,
      refinedFormulaPoints: graphPoints,
      segmentStartPoints: [undefined],
      settings,
      signProtection: [0],
      soldierCenter: graphPoints[0],
      stepGlitchRequirements: [false],
      stepGlitchSegments: [undefined],
      stepSegmentDeltaYs: [undefined],
    } satisfies GraphwarStepGlitchFormulaPrefix,
  };
  const prefixEvidence = createGraphwarStepGlitchPrefixEvidence({
    acceptedPoint: graphPoints[1],
    formulaEvidence,
    prefixTarget,
    simulationBoundaryExpansion,
    simulationMask: mask,
  });
  return createGraphwarWasmStepGlitchContextInput({
    bounds,
    boundsRect,
    formulaMode: createGraphwarTrajectoryFormulaMode(settings),
    ...(hasPrefixEvidence ? { prefixEvidence, prefixTarget, requiredTargets: [prefixTarget] } : {}),
    simulationBoundaryExpansion,
    simulationMask: mask,
    sourcePath,
  });
}

function createMask() {
  const mask = new Uint8Array(planeCellCount);
  mask[225 * GRAPHWAR_PLANE_LENGTH + 300] = 2;
  mask.fill(1, 100 * GRAPHWAR_PLANE_LENGTH + 200, 100 * GRAPHWAR_PLANE_LENGTH + 220);
  mask.fill(1, 350 * GRAPHWAR_PLANE_LENGTH + 500, 350 * GRAPHWAR_PLANE_LENGTH + 540);
  return mask;
}
