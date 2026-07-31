import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  createGraphwarTrajectoryFormulaMode,
  type GraphwarStepGlitchFormulaPrefix,
} from "../../formula/trajectory/sampling";
import {
  createGraphwarStepGlitchPrefixEvidence,
  createGraphwarStepGlitchGeometryDfsTraceForTest,
  createGraphwarStepGlitchGeometryFrontierTraceForTest,
  createGraphwarStepGlitchScanMaskIndex,
  type GraphwarStepGlitchGeometryReplayOutcome,
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

  it("runs direct replay first and terminates without geometry work", async () => {
    const bounds = { maxX: 12, maxY: 10, minX: 4, minY: -10 };
    const mask = new Uint8Array(planeCellCount);
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
    const contextResult = createGraphwarWasmStepGlitchGeometryTestContext(runtime, createContextInput(bounds, mask, 0));
    expect(contextResult.status).toBe("ready");
    if (contextResult.status !== "ready") {
      throw new Error("expected a retained Step-glitch geometry context");
    }
    const input = createDfsInput(bounds, false, [
      {
        acceptedPoint: createGraphPoint(graphXAtBoundary(bounds, false, 600), 0),
        reachedTargetCount: 2,
        status: "hit",
      },
    ]);

    expect(contextResult.context.traceScriptedDfs(input)).toEqual(
      createGraphwarStepGlitchGeometryDfsTraceForTest(createPrefixOptions(bounds, mask, 0), input),
    );
    expect(contextResult.context.traceScriptedDfs(input)).toMatchObject({
      candidates: [{ expansionOrdinal: 0, kind: "direct", status: "hit" }],
      expandedStates: 1,
      scriptConsumed: 1,
      status: "hit",
    });
    contextResult.context.dispose();
  });

  it("continues nested gate hits depth-first before the parent frontier", async () => {
    const bounds = { maxX: 12, maxY: 10, minX: 4, minY: -10 };
    const mask = new Uint8Array(planeCellCount);
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
    const contextResult = createGraphwarWasmStepGlitchGeometryTestContext(runtime, createContextInput(bounds, mask, 0));
    expect(contextResult.status).toBe("ready");
    if (contextResult.status !== "ready") {
      throw new Error("expected a retained Step-glitch geometry context");
    }
    const directBlockedX = graphXAtBoundary(bounds, false, 300);
    const input = {
      ...createDfsInput(bounds, false, [
        { blockedX: directBlockedX, reachedTargetCount: 1, status: "miss" },
        {
          acceptedPoint: createGraphPoint(graphXAtBoundary(bounds, false, 350), 0),
          blockedX: graphXAtBoundary(bounds, false, 450),
          reachedTargetCount: 2,
          status: "hit",
        },
        {
          acceptedPoint: createGraphPoint(graphXAtBoundary(bounds, false, 500), 0),
          reachedTargetCount: 3,
          status: "hit",
        },
        {
          acceptedPoint: createGraphPoint(graphXAtBoundary(bounds, false, 600), 0),
          reachedTargetCount: 4,
          status: "hit",
        },
      ]),
      prefixBlockedX: graphXAtBoundary(bounds, false, 275),
    };
    const expected = createGraphwarStepGlitchGeometryDfsTraceForTest(createPrefixOptions(bounds, mask, 0), input);
    const actual = contextResult.context.traceScriptedDfs(input);

    expect(actual).toEqual(expected);
    expect(actual.candidates.map((candidate) => candidate.kind)).toEqual(["direct", "gate", "gate", "target"]);
    expect(actual.candidates.map((candidate) => candidate.path.length)).toEqual([3, 3, 4, 5]);
    expect(actual).toMatchObject({
      bestReachedTargetCount: 4,
      blockedX: directBlockedX,
      expandedStates: 4,
      scriptConsumed: 4,
      status: "hit",
    });
    contextResult.context.dispose();
  });

  it("finishes a mirrored nested miss subtree before resuming the parent frontier", async () => {
    const bounds = { maxX: 4, maxY: 10, minX: 12, minY: -10 };
    const mask = new Uint8Array(planeCellCount);
    const options = createPrefixOptions(bounds, mask, 0);
    const directBlockedX = graphXAtBoundary(bounds, true, 300);
    const nestedBlockedX = graphXAtBoundary(bounds, true, 450);
    const nestedAcceptedPoint = createGraphPoint(graphXAtBoundary(bounds, true, 350), 0);
    const baseInput = createDfsInput(bounds, true, []);
    const target = imageToGraphPoint(baseInput.targetPoint, bounds, boundsRect);
    const rootFrontier = createGraphwarStepGlitchGeometryFrontierTraceForTest(options, {
      acceptedPoint: baseInput.prefixAcceptedPoint,
      firstBlockedSearchX: 300,
      row: 225,
      target,
      targetRow: 200,
    });
    const nestedFrontier = createGraphwarStepGlitchGeometryFrontierTraceForTest(options, {
      acceptedPoint: nestedAcceptedPoint,
      firstBlockedSearchX: 450,
      row: 225,
      target,
      targetRow: 200,
    });
    expect(rootFrontier.candidates.length).toBeGreaterThan(1);
    expect(nestedFrontier.candidates.length).toBeGreaterThan(0);
    const outcomes: GraphwarStepGlitchGeometryReplayOutcome[] = [
      { blockedX: directBlockedX, reachedTargetCount: 1, status: "miss" },
      {
        acceptedPoint: nestedAcceptedPoint,
        blockedX: nestedBlockedX,
        reachedTargetCount: 2,
        status: "hit",
      },
      ...Array.from({ length: nestedFrontier.candidates.length + rootFrontier.candidates.length - 1 }, () => ({
        reachedTargetCount: 2,
        status: "miss" as const,
      })),
    ];
    const input = createDfsInput(bounds, true, outcomes);
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
    const contextResult = createGraphwarWasmStepGlitchGeometryTestContext(runtime, createContextInput(bounds, mask, 0));
    expect(contextResult.status).toBe("ready");
    if (contextResult.status !== "ready") {
      throw new Error("expected a retained Step-glitch geometry context");
    }

    const actual = contextResult.context.traceScriptedDfs(input);
    expect(actual).toEqual(createGraphwarStepGlitchGeometryDfsTraceForTest(options, input));
    expect(
      actual.candidates.slice(2, 2 + nestedFrontier.candidates.length).every(({ path }) => path.length === 4),
    ).toBe(true);
    expect(actual.candidates.at(2 + nestedFrontier.candidates.length)?.path).toHaveLength(3);
    expect(actual.status).toBe("no-path");
    contextResult.context.dispose();
  });

  it("keeps prefix blocked x ahead of later candidate evidence without steering initial geometry", async () => {
    const bounds = { maxX: 12, maxY: 10, minX: 4, minY: -10 };
    const mask = new Uint8Array(planeCellCount);
    setForwardMaskCell(mask, 300, 225, false);
    const prefixBlockedX = graphXAtBoundary(bounds, false, 250);
    const laterBlockedX = graphXAtBoundary(bounds, false, 650);
    const baseInput = createDfsInput(bounds, false, []);
    const target = imageToGraphPoint(baseInput.targetPoint, bounds, boundsRect);
    const frontier = createGraphwarStepGlitchGeometryFrontierTraceForTest(createPrefixOptions(bounds, mask, 0), {
      acceptedPoint: baseInput.prefixAcceptedPoint,
      firstBlockedSearchX: 300,
      row: 225,
      target,
      targetRow: 200,
    });
    expect(frontier.candidates.length).toBeGreaterThan(0);
    const input = {
      ...createDfsInput(bounds, false, [
        { reachedTargetCount: 1, status: "miss" },
        { blockedX: laterBlockedX, reachedTargetCount: 2, status: "miss" },
        ...Array.from({ length: frontier.candidates.length - 1 }, () => ({
          reachedTargetCount: 2,
          status: "miss" as const,
        })),
      ]),
      prefixBlockedX,
    };
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
    const contextResult = createGraphwarWasmStepGlitchGeometryTestContext(runtime, createContextInput(bounds, mask, 0));
    expect(contextResult.status).toBe("ready");
    if (contextResult.status !== "ready") {
      throw new Error("expected a retained Step-glitch geometry context");
    }

    const actual = contextResult.context.traceScriptedDfs(input);
    expect(actual).toEqual(
      createGraphwarStepGlitchGeometryDfsTraceForTest(createPrefixOptions(bounds, mask, 0), input),
    );
    expect(actual.candidates[0]?.kind).toBe("direct");
    expect(actual.candidates.slice(1).every(({ kind }) => kind === "gate")).toBe(true);
    expect(actual.blockedX).toBe(prefixBlockedX);
    contextResult.context.dispose();
  });

  it("treats all-candidates-miss and duplicate initial direct suppression as a normal no-path", async () => {
    const bounds = { maxX: 12, maxY: 10, minX: 4, minY: -10 };
    const mask = new Uint8Array(planeCellCount);
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
    const contextResult = createGraphwarWasmStepGlitchGeometryTestContext(runtime, createContextInput(bounds, mask, 0));
    expect(contextResult.status).toBe("ready");
    if (contextResult.status !== "ready") {
      throw new Error("expected a retained Step-glitch geometry context");
    }
    const input = { ...createDfsInput(bounds, false, []), replayMode: { type: "all-miss" as const } };
    const actual = contextResult.context.traceScriptedDfs(input);

    expect(actual).toEqual(
      createGraphwarStepGlitchGeometryDfsTraceForTest(createPrefixOptions(bounds, mask, 0), input),
    );
    expect(actual).toMatchObject({
      candidates: [{ kind: "direct", status: "miss" }],
      expandedStates: 1,
      scriptConsumed: 0,
      status: "no-path",
    });
    contextResult.context.dispose();
  });

  it("exhausts a real gate frontier normally in explicit all-candidates-miss mode", async () => {
    const bounds = { maxX: 12, maxY: 10, minX: 4, minY: -10 };
    const mask = new Uint8Array(planeCellCount);
    for (let row = 0; row < GRAPHWAR_PLANE_HEIGHT; row += 1) {
      if (row !== 200) {
        setForwardMaskCell(mask, 300, row, false);
      }
    }
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
    const contextResult = createGraphwarWasmStepGlitchGeometryTestContext(runtime, createContextInput(bounds, mask, 0));
    expect(contextResult.status).toBe("ready");
    if (contextResult.status !== "ready") {
      throw new Error("expected a retained Step-glitch geometry context");
    }
    const input = { ...createDfsInput(bounds, false, []), replayMode: { type: "all-miss" as const } };
    const actual = contextResult.context.traceScriptedDfs(input);

    expect(actual).toEqual(
      createGraphwarStepGlitchGeometryDfsTraceForTest(createPrefixOptions(bounds, mask, 0), input),
    );
    expect(actual.status).toBe("no-path");
    expect(actual.candidates[0]).toMatchObject({ kind: "direct", status: "miss" });
    expect(
      actual.candidates.slice(1).every((candidate) => candidate.kind === "gate" && candidate.status === "miss"),
    ).toBe(true);
    expect(actual.expandedStates).toBeGreaterThan(1);
    contextResult.context.dispose();
  });

  it.each([
    {
      name: "script exhaustion",
      outcomes: [{ blockedX: 7, reachedTargetCount: 0, status: "miss" as const }],
    },
    {
      name: "script leftovers",
      outcomes: [
        { acceptedPoint: createGraphPoint(9, 0), reachedTargetCount: 1, status: "hit" as const },
        { reachedTargetCount: 0, status: "miss" as const },
      ],
    },
  ])("faults on exact replay $name and restores the retained mark", async ({ outcomes }) => {
    const bounds = { maxX: 12, maxY: 10, minX: 4, minY: -10 };
    const mask = new Uint8Array(planeCellCount);
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
    const contextResult = createGraphwarWasmStepGlitchGeometryTestContext(runtime, createContextInput(bounds, mask, 0));
    expect(contextResult.status).toBe("ready");
    if (contextResult.status !== "ready") {
      throw new Error("expected a retained Step-glitch geometry context");
    }
    const retainedCursor = runtime.arenaCursor;
    const input = createDfsInput(bounds, false, outcomes);

    expect(() => contextResult.context.traceScriptedDfs(input)).toThrowError();
    expect(() =>
      createGraphwarStepGlitchGeometryDfsTraceForTest(createPrefixOptions(bounds, mask, 0), input),
    ).toThrowError();
    expect(runtime.arenaCursor).toBe(retainedCursor);
    expect(contextResult.context.copyFarthestFreeX()).toHaveLength(planeCellCount);
    contextResult.context.dispose();
  });

  it.each([
    {
      mutate(view: DataView, resultPointer: number) {
        view.setUint32(resultPointer + 28, 0xffff_ffff, true);
      },
      name: "oversized trace count",
    },
    {
      mutate(view: DataView, resultPointer: number) {
        view.setUint32(resultPointer + 4, 0, true);
      },
      name: "no-path status with a direct hit",
    },
  ])("rejects malformed DFS output ($name) and keeps the retained context usable", async ({ mutate }) => {
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
      if (command === 13) {
        mutate(new DataView(runtime.buffer), resultPointer);
      }
      return resultPointer;
    });

    expect(() =>
      contextResult.context.traceScriptedDfs(
        createDfsInput(bounds, false, [
          { acceptedPoint: createGraphPoint(9, 0), reachedTargetCount: 1, status: "hit" },
        ]),
      ),
    ).toThrowError();
    expect(runtime.arenaCursor).toBe(retainedCursor);
    expect(contextResult.context.copyFarthestFreeX()).toHaveLength(planeCellCount);
    contextResult.context.dispose();
  });

  it("rejects a non-terminal direct hit followed by a no-path trace", async () => {
    const bounds = { maxX: 12, maxY: 10, minX: 4, minY: -10 };
    const mask = new Uint8Array(planeCellCount);
    const directBlockedX = graphXAtBoundary(bounds, false, 300);
    const outcomes: GraphwarStepGlitchGeometryReplayOutcome[] = [
      { blockedX: directBlockedX, reachedTargetCount: 1, status: "miss" },
      {
        acceptedPoint: createGraphPoint(graphXAtBoundary(bounds, false, 350), 0),
        reachedTargetCount: 2,
        status: "hit",
      },
      {
        acceptedPoint: createGraphPoint(graphXAtBoundary(bounds, false, 600), 0),
        reachedTargetCount: 3,
        status: "hit",
      },
    ];
    const input = createDfsInput(bounds, false, outcomes);
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
      if (command === 13) {
        const view = new DataView(runtime.buffer);
        const tracePointer = view.getUint32(resultPointer + 24, true);
        const finalTracePointer = tracePointer + 2 * 56;
        outcomes[0] = {
          acceptedPoint: createGraphPoint(graphXAtBoundary(bounds, false, 600), 0),
          blockedX: directBlockedX,
          reachedTargetCount: 1,
          status: "hit",
        };
        outcomes[2] = { reachedTargetCount: 3, status: "miss" };
        view.setUint32(resultPointer + 4, 0, true);
        view.setUint32(tracePointer + 4, 1, true);
        view.setFloat64(tracePointer + 32, outcomes[0].acceptedPoint.x, true);
        view.setFloat64(tracePointer + 40, outcomes[0].acceptedPoint.y, true);
        view.setUint32(finalTracePointer + 4, 0, true);
        view.setFloat64(finalTracePointer + 32, 0, true);
        view.setFloat64(finalTracePointer + 40, 0, true);
      }
      return resultPointer;
    });

    expect(() => contextResult.context.traceScriptedDfs(input)).toThrowError();
    expect(runtime.arenaCursor).toBe(retainedCursor);
    expect(contextResult.context.copyFarthestFreeX()).toHaveLength(planeCellCount);
    contextResult.context.dispose();
  });

  it("rejects malformed raw replay scripts and restores the command mark", async () => {
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
      if (command === 13) {
        const view = new DataView(runtime.buffer);
        view.setUint32(view.getUint32(inputPointer + 8, true), 2, true);
      }
      return runRouteTask(command, inputPointer, inputByteLength);
    });

    expect(() =>
      contextResult.context.traceScriptedDfs(
        createDfsInput(bounds, false, [
          { acceptedPoint: createGraphPoint(9, 0), reachedTargetCount: 1, status: "hit" },
        ]),
      ),
    ).toThrowError();
    expect(runtime.arenaCursor).toBe(retainedCursor);
    expect(runtime.getArenaDiagnostics().isCanaryIntact).toBe(true);
    contextResult.context.dispose();
  });

  it("stabilizes after alternating large and small DFS traces across arena growth", async () => {
    const bounds = { maxX: 12, maxY: 10, minX: 4, minY: -10 };
    const mask = new Uint8Array(planeCellCount);
    for (let row = 50; row < GRAPHWAR_PLANE_HEIGHT; row += 1) {
      setForwardMaskCell(mask, 300, row, false);
    }
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
    const contextResult = createGraphwarWasmStepGlitchGeometryTestContext(runtime, createContextInput(bounds, mask, 0));
    expect(contextResult.status).toBe("ready");
    if (contextResult.status !== "ready") {
      throw new Error("expected a retained Step-glitch geometry context");
    }
    const retainedCursor = runtime.arenaCursor;
    const directBlockedX = graphXAtBoundary(bounds, false, 300);
    const largeInput = createDfsInput(bounds, false, [
      { blockedX: directBlockedX, reachedTargetCount: 0, status: "miss" },
      ...Array.from({ length: 50 * 3 * 11 }, () => ({ reachedTargetCount: 0, status: "miss" as const })),
    ]);
    const smallInput = createDfsInput(bounds, false, [
      { acceptedPoint: createGraphPoint(9, 0), reachedTargetCount: 1, status: "hit" },
    ]);
    const expectedLarge = createGraphwarStepGlitchGeometryDfsTraceForTest(
      createPrefixOptions(bounds, mask, 0),
      largeInput,
    );

    expect(contextResult.context.traceScriptedDfs(largeInput)).toEqual(expectedLarge);
    const highWaterByteLength = runtime.buffer.byteLength;
    expect(contextResult.context.traceScriptedDfs(smallInput).status).toBe("hit");
    expect(contextResult.context.traceScriptedDfs(largeInput)).toEqual(expectedLarge);
    expect(runtime.arenaCursor).toBe(retainedCursor);
    expect(runtime.buffer.byteLength).toBe(highWaterByteLength);
    expect(runtime.getArenaDiagnostics().isCanaryIntact).toBe(true);
    contextResult.context.dispose();
  });

  it("reuses one retained context for 5,000 DFS commands at the arena high-water mark", async () => {
    const bounds = { maxX: 12, maxY: 10, minX: 4, minY: -10 };
    const mask = new Uint8Array(planeCellCount);
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
    const contextResult = createGraphwarWasmStepGlitchGeometryTestContext(runtime, createContextInput(bounds, mask, 0));
    expect(contextResult.status).toBe("ready");
    if (contextResult.status !== "ready") {
      throw new Error("expected a retained Step-glitch geometry context");
    }
    const retainedCursor = runtime.arenaCursor;
    const input = createDfsInput(bounds, false, [
      { acceptedPoint: createGraphPoint(9, 0), reachedTargetCount: 1, status: "hit" },
    ]);
    contextResult.context.traceScriptedDfs(input);
    const highWaterByteLength = runtime.buffer.byteLength;

    for (let iteration = 0; iteration < 5_000; iteration += 1) {
      expect(contextResult.context.traceScriptedDfs(input).status).toBe("hit");
    }
    expect(runtime.arenaCursor).toBe(retainedCursor);
    expect(runtime.buffer.byteLength).toBe(highWaterByteLength);
    expect(runtime.getArenaDiagnostics().isCanaryIntact).toBe(true);
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
    requiredTargets: [prefixTarget],
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
  return {
    acceptedPoint: createGraphPoint(graphXAtBoundary(bounds, isMirrored, 100), 0),
    firstBlockedSearchX,
    row: 220,
    target: createGraphPoint(graphXAtBoundary(bounds, isMirrored, 600), 0),
    targetRow: 200,
  };
}

function createDfsInput(
  bounds: { maxX: number; maxY: number; minX: number; minY: number },
  isMirrored: boolean,
  outcomes: readonly (
    | { blockedX?: number; reachedTargetCount: number; status: "miss" }
    | {
        acceptedPoint: ReturnType<typeof createGraphPoint>;
        blockedX?: number;
        reachedTargetCount: number;
        status: "hit";
      }
  )[],
) {
  const targetPointX = isMirrored ? GRAPHWAR_PLANE_LENGTH - 600 : 600;
  return {
    hitTargetCenter: createPixelPoint(targetPointX, 200.5),
    prefixAcceptedPoint: createGraphPoint(graphXAtBoundary(bounds, isMirrored, 100), 0),
    prefixReachedTargetCount: 1,
    replayMode: { outcomes, type: "scripted" as const },
    targetPoint: createPixelPoint(targetPointX, 225),
  };
}

function graphXAtBoundary(
  bounds: { maxX: number; maxY: number; minX: number; minY: number },
  isMirrored: boolean,
  searchBoundaryX: number,
) {
  const planeBoundaryX = isMirrored ? GRAPHWAR_PLANE_LENGTH - searchBoundaryX : searchBoundaryX;
  return imageToGraphPoint(
    createPixelPoint((planeBoundaryX / GRAPHWAR_PLANE_LENGTH) * boundsRect.width, boundsRect.y),
    bounds,
    boundsRect,
  ).x;
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
