import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  createGraphwarTrajectoryFormulaMode,
  type GraphwarStepGlitchFormulaPrefix,
} from "../../formula/trajectory/sampling";
import {
  createGraphwarStepGlitchPrefixEvidence,
  createGraphwarStepGlitchGeometryFrontierTraceForTest,
  createGraphwarStepGlitchScanMaskIndex,
} from "../../pathfinding/routing/step-glitch-scan";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../game/constants";
import { imageToGraphPoint } from "../geometry";
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

  it.each([
    { bounds: { maxX: 12, maxY: 10, minX: 4, minY: -10 }, isMirrored: false, name: "direct" },
    { bounds: { maxX: 4, maxY: 10, minX: 12, minY: -10 }, isMirrored: true, name: "mirrored" },
  ])("matches stable B-1/B-2/B-3 frontier ordering for $name coordinates", async ({ bounds, isMirrored }) => {
    const mask = new Uint8Array(planeCellCount);
    setForwardMaskCell(mask, 700, 200, isMirrored);
    setForwardMaskCell(mask, 650, 199, isMirrored);
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
    const contextResult = createGraphwarWasmStepGlitchGeometryTestContext(runtime, createContextInput(bounds, mask, 0));
    expect(contextResult.status).toBe("ready");
    if (contextResult.status !== "ready") {
      throw new Error("expected a retained Step-glitch geometry context");
    }
    const input = createFrontierInput(bounds, isMirrored, 300);
    const expected = createGraphwarStepGlitchGeometryFrontierTraceForTest(createPrefixOptions(bounds, mask, 0), input);

    expect(contextResult.context.traceGateFrontier(input)).toEqual(expected);
    expect(expected.batches.map((batch) => batch.backoffColumns)).toEqual([1, 2, 3]);
    expect(expected.batches.map((batch) => batch.windowCount)).toEqual([11, 11, 11]);
    expect(expected.windows.filter((window) => window.windowOrdinal === 0)).toHaveLength(3);
    expect(expected.rows[0]?.row).toBe(201);
    expect(expected.rows.findIndex((row) => row.row === 202)).toBeLessThan(
      expected.rows.findIndex((row) => row.row === 198),
    );
    const rowTieTrace = contextResult.context.traceGateFrontier({ ...input, row: 200, targetRow: 200 });
    expect(rowTieTrace.rows.findIndex((row) => row.row === 198)).toBeLessThan(
      rowTieTrace.rows.findIndex((row) => row.row === 202),
    );
    contextResult.context.dispose();
  });

  it("matches low-precision per-window lookup and duplicate suppression", async () => {
    const bounds = { maxX: 12, maxY: 10, minX: 4, minY: -10 };
    const mask = new Uint8Array(planeCellCount);
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
    const contextResult = createGraphwarWasmStepGlitchGeometryTestContext(
      runtime,
      createContextInput(bounds, mask, 0, false, 0),
    );
    expect(contextResult.status).toBe("ready");
    if (contextResult.status !== "ready") {
      throw new Error("expected a retained Step-glitch geometry context");
    }
    const input = createFrontierInput(bounds, false, 300);
    const expected = createGraphwarStepGlitchGeometryFrontierTraceForTest(
      createPrefixOptions(bounds, mask, 0, 0),
      input,
    );
    const actual = contextResult.context.traceGateFrontier(input);

    expect(actual).toEqual(expected);
    expect(actual.windows.length).toBeLessThanOrEqual(33);
    expect(actual.batches.some((batch) => batch.sharedWindowSearchX === undefined)).toBe(true);
    for (const batch of actual.batches) {
      const windows = actual.windows.slice(batch.windowStart, batch.windowStart + batch.windowCount);
      expect(new Set(windows.map((window) => window.controlX)).size).toBe(windows.length);
    }
    contextResult.context.dispose();
  });

  it("queries B-2 lazily and prunes a row only after its B-1 candidates", async () => {
    const bounds = { maxX: 770, maxY: 225, minX: 0, minY: -225 };
    const mask = new Uint8Array(planeCellCount);
    setForwardMaskCell(mask, 298, 250, false);
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
    const contextResult = createGraphwarWasmStepGlitchGeometryTestContext(runtime, createContextInput(bounds, mask, 0));
    expect(contextResult.status).toBe("ready");
    if (contextResult.status !== "ready") {
      throw new Error("expected a retained Step-glitch geometry context");
    }
    const input = createFrontierInput(bounds, false, 300);
    const expected = createGraphwarStepGlitchGeometryFrontierTraceForTest(createPrefixOptions(bounds, mask, 0), input);
    const actual = contextResult.context.traceGateFrontier(input);

    expect(actual).toEqual(expected);
    expect(actual.rows.find((row) => row.row === 250)?.usableWindowBatchMask).toBe(1);
    expect(
      actual.candidates
        .filter((candidate) => candidate.row === 250)
        .every((candidate) => candidate.backoffColumns === 1),
    ).toBe(true);
    contextResult.context.dispose();
  });

  it("returns one normal empty trace when no blocked frontier can be expanded", async () => {
    const bounds = { maxX: 12, maxY: 10, minX: 4, minY: -10 };
    const mask = new Uint8Array(planeCellCount);
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
    const contextResult = createGraphwarWasmStepGlitchGeometryTestContext(runtime, createContextInput(bounds, mask, 0));
    expect(contextResult.status).toBe("ready");
    if (contextResult.status !== "ready") {
      throw new Error("expected a retained Step-glitch geometry context");
    }
    const input = createFrontierInput(bounds, false, 0);

    expect(contextResult.context.traceGateFrontier(input)).toEqual({
      batches: [],
      candidates: [],
      firstBlockedSearchX: 0,
      rows: [],
      windows: [],
    });
    contextResult.context.dispose();
  });

  it("rejects malformed trace output without invalidating the retained context", async () => {
    const bounds = { maxX: 12, maxY: 10, minX: 4, minY: -10 };
    const mask = new Uint8Array(planeCellCount);
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
    const contextResult = createGraphwarWasmStepGlitchGeometryTestContext(runtime, createContextInput(bounds, mask, 0));
    expect(contextResult.status).toBe("ready");
    if (contextResult.status !== "ready") {
      throw new Error("expected a retained Step-glitch geometry context");
    }
    const retainedCursor = runtime.arenaCursor;
    const runRouteTask = runtime.runRouteTask.bind(runtime);
    vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = runRouteTask(command, inputPointer, inputByteLength);
      if (command === 12) {
        new DataView(runtime.buffer).setUint32(resultPointer, 0, true);
      }
      return resultPointer;
    });

    expect(() => contextResult.context.traceGateFrontier(createFrontierInput(bounds, false, 300))).toThrowError();
    expect(runtime.arenaCursor).toBe(retainedCursor);
    expect(contextResult.context.copyFarthestFreeX()).toHaveLength(planeCellCount);
    contextResult.context.dispose();
  });
});

function createContextInput(
  bounds: { maxX: number; maxY: number; minX: number; minY: number },
  mask: Uint8Array,
  simulationBoundaryExpansion: number,
  hasPrefixEvidence = false,
  decimalPlaces = 4,
) {
  const settings = createSettings(mask, decimalPlaces);
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

function createSettings(mask: Uint8Array, decimalPlaces: number) {
  return {
    algorithm: "step" as const,
    decimalPlaces,
    equation: "dy" as const,
    isStepGlitchModeEnabled: true,
    isStepOverflowProtectionEnabled: true,
    steepness: 67,
    stepGlitchObstacleMask: mask,
  };
}

function createPrefixOptions(
  bounds: { maxX: number; maxY: number; minX: number; minY: number },
  mask: Uint8Array,
  simulationBoundaryExpansion: number,
  decimalPlaces = 4,
) {
  return {
    bounds,
    boundsRect,
    formulaMode: createGraphwarTrajectoryFormulaMode(createSettings(mask, decimalPlaces)),
    simulationBoundaryExpansion,
    simulationMask: mask,
    sourcePath: [createPixelPoint(96, 225), createPixelPoint(337, 225)],
  };
}

function createFrontierInput(
  bounds: { maxX: number; maxY: number; minX: number; minY: number },
  isMirrored: boolean,
  firstBlockedSearchX: number,
) {
  const graphXAtBoundary = (searchBoundaryX: number) => {
    const planeBoundaryX = isMirrored ? GRAPHWAR_PLANE_LENGTH - searchBoundaryX : searchBoundaryX;
    return imageToGraphPoint(
      createPixelPoint((planeBoundaryX / GRAPHWAR_PLANE_LENGTH) * boundsRect.width, boundsRect.y),
      bounds,
      boundsRect,
    ).x;
  };
  return {
    acceptedPoint: createGraphPoint(graphXAtBoundary(100), 0),
    firstBlockedSearchX,
    row: 220,
    target: createGraphPoint(graphXAtBoundary(600), 0),
    targetRow: 200,
  };
}

function setForwardMaskCell(mask: Uint8Array, forwardX: number, row: number, isMirrored: boolean) {
  const planeX = isMirrored ? GRAPHWAR_PLANE_LENGTH - 1 - forwardX : forwardX;
  mask[row * GRAPHWAR_PLANE_LENGTH + planeX] = 1;
}

function createMask() {
  const mask = new Uint8Array(planeCellCount);
  mask[225 * GRAPHWAR_PLANE_LENGTH + 300] = 2;
  mask.fill(1, 100 * GRAPHWAR_PLANE_LENGTH + 200, 100 * GRAPHWAR_PLANE_LENGTH + 220);
  mask.fill(1, 350 * GRAPHWAR_PLANE_LENGTH + 500, 350 * GRAPHWAR_PLANE_LENGTH + 540);
  return mask;
}
