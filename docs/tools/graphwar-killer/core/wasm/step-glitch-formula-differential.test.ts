import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  createGraphwarTrajectoryFormulaMode,
  getGraphwarTrajectoryLaunchAngle,
  resolveGraphwarTrajectory,
  type GraphwarStepGlitchXWindow,
  type GraphwarTrajectoryFormulaSettings,
} from "../../formula/trajectory/sampling";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../game/constants";
import { graphToImagePoint, imageToGraphPoint } from "../geometry";
import { createGraphPoint } from "../types";
import type { BoundsRect, EquationMode, GraphBounds, GraphPoint } from "../types";
import type { GraphwarWasmFormulaLaunchResult } from "./formula-adapter";
import { readGraphwarKernelBytes } from "./kernel-test-fixture";
import { instantiateGraphwarWasmRuntime } from "./runtime";
import {
  createGraphwarWasmStepGlitchContextInput,
  createGraphwarWasmStepGlitchGeometryTestContext,
} from "./step-glitch-adapter";

const directBounds: GraphBounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
const directBoundsRect: BoundsRect = {
  height: GRAPHWAR_PLANE_HEIGHT,
  width: GRAPHWAR_PLANE_LENGTH,
  x: 0,
  y: 0,
};
const hardPath = [
  createGraphPoint(-24, 12),
  createGraphPoint(-22.857142857142858, 13.571428571428571),
  createGraphPoint(-22.84714285714286, 1.7532467532467528),
];
const planeCellCount = GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT;
let kernelModule: WebAssembly.Module;

beforeAll(async () => {
  kernelModule = await WebAssembly.compile(await readGraphwarKernelBytes());
});

describe("Graphwar WASM Step-glitch candidate formula construction", () => {
  it.each(["dy", "ddy"] satisfies readonly EquationMode[])(
    "matches the TypeScript automatic material oracle for %s",
    async (equation) => {
      const fixture = createFixture({ equation, graphPath: hardPath });
      const { context, runtime } = await createContext(fixture, 2);
      const retainedCursor = runtime.arenaCursor;
      const actual = context.prepareCandidateFormulaForTest({
        path: fixture.pixelPath,
        windows: { type: "automatic" },
      });
      const expected = resolveFixture(fixture, { type: "automatic" });

      expectLaunchToMatchOracle(actual, expected);
      expect(runtime.arenaCursor).toBe(retainedCursor);
      expect(runtime.getArenaDiagnostics().isCanaryIntact).toBe(true);
      context.dispose();
    },
  );

  it.each(["dy", "ddy"] satisfies readonly EquationMode[])(
    "preserves the selected fixed window and source-segment identity for %s",
    async (equation) => {
      const fixture = createFixture({ equation, graphPath: hardPath });
      const automatic = resolveFixture(fixture, { type: "automatic" });
      const segments = automatic.context.stepGlitchFormulaEvidence?.prefix.stepGlitchSegments;
      expect(segments?.some((segment) => segment !== undefined)).toBe(true);
      if (!segments) {
        throw new Error("expected Step-glitch formula evidence");
      }
      const windows = segments.map((segment) =>
        segment === undefined ? undefined : { endX: segment.endX, startX: segment.startX },
      );
      const fixedInput = { segments: windows, type: "explicit" } as const;
      const { context } = await createContext(fixture, 2);
      const automaticActual = context.prepareCandidateFormulaForTest({
        path: fixture.pixelPath,
        windows: { type: "automatic" },
      });
      if (automaticActual.status === "success" && automaticActual.compiledMaterials.algorithm === "step") {
        expect(
          automaticActual.compiledMaterials.stepFormula?.terms
            .map((term) => term.glitchSegment)
            .filter(Boolean)
            .map((segment) => ({ endX: segment?.endX, startX: segment?.startX })),
        ).toEqual(segments.filter(Boolean).map((segment) => ({ endX: segment?.endX, startX: segment?.startX })));
      }
      const actual = context.prepareCandidateFormulaForTest({ path: fixture.pixelPath, windows: fixedInput });
      const expected = resolveFixture(fixture, fixedInput);
      expect(expected.context.stepGlitchFormulaEvidence?.prefix.stepGlitchSegments).toEqual(segments);

      expectLaunchToMatchOracle(actual, expected);
      if (actual.status === "success" && actual.compiledMaterials.algorithm === "step") {
        expect(actual.compiledMaterials.stepFormula?.terms.map((term) => term.sourceSegmentIndex)).toEqual(
          expected.context.compiledMaterials.algorithm === "step"
            ? expected.context.compiledMaterials.stepFormula?.terms.map((term) => term.sourceSegmentIndex)
            : [],
        );
      }
      context.dispose();
    },
  );

  it("uses the retained mirrored bounds and non-zero bounds rect without TS graph-point precomputation", async () => {
    const bounds = { maxX: -25, maxY: 15, minX: 25, minY: -15 };
    const boundsRect = { height: 405, width: 693, x: 31, y: 17 };
    const fixture = createFixture({ bounds, boundsRect, equation: "dy", graphPath: hardPath });
    const { context } = await createContext(fixture, 2);
    const actual = context.prepareCandidateFormulaForTest({ path: fixture.pixelPath, windows: { type: "automatic" } });
    const expected = resolveFixture(fixture, { type: "automatic" });

    expectLaunchToMatchOracle(actual, expected);
    context.dispose();
  });

  it("matches a mirrored explicit window under a non-zero bounds rect", async () => {
    const bounds = { maxX: -25, maxY: 15, minX: 25, minY: -15 };
    const boundsRect = { height: 405, width: 693, x: 31, y: 17 };
    const fixture = createFixture({ bounds, boundsRect, equation: "dy", graphPath: hardPath });
    const automatic = resolveFixture(fixture, { type: "automatic" });
    const segments = automatic.context.stepGlitchFormulaEvidence?.prefix.stepGlitchSegments;
    expect(segments?.some((segment) => segment !== undefined)).toBe(true);
    if (!segments) {
      throw new Error("expected Step-glitch formula evidence");
    }
    const windows = {
      segments: segments.map((segment) =>
        segment === undefined ? undefined : { endX: segment.endX, startX: segment.startX },
      ),
      type: "explicit",
    } as const;
    const { context } = await createContext(fixture, 2);
    const actual = context.prepareCandidateFormulaForTest({ path: fixture.pixelPath, windows });
    const expected = resolveFixture(fixture, windows);

    expectLaunchToMatchOracle(actual, expected);
    context.dispose();
  });

  it("keeps low precision, path steepness, quality target, and overflow protection in the WASM-owned request", async () => {
    const fixture = createFixture({
      decimalPlaces: 0,
      equation: "dy",
      formulaPathSteepness: 7.5,
      graphPath: hardPath,
    });
    const { context } = await createContext(fixture, 1);
    const actual = context.prepareCandidateFormulaForTest({ path: fixture.pixelPath, windows: { type: "automatic" } });
    const expected = resolveFixture(fixture, { type: "automatic" });
    const equalSteepnessExpected = resolveFixture(
      createFixture({ decimalPlaces: 0, equation: "dy", graphPath: hardPath }),
      { type: "automatic" },
    );

    expectLaunchToMatchOracle(actual, expected);
    expect(expected.context.formulaPoints).not.toEqual(equalSteepnessExpected.context.formulaPoints);
    context.dispose();
  });

  it("returns an invalid business result when an explicit fixed window cannot produce a hard candidate", async () => {
    const fixture = createFixture({ equation: "dy", graphPath: hardPath });
    const { context } = await createContext(fixture, 2);
    const actual = context.prepareCandidateFormulaForTest({
      path: fixture.pixelPath,
      windows: { segments: [undefined, { endX: -30, startX: -31 }], type: "explicit" },
    });

    expect(actual.status).toBe("invalid");
    context.dispose();
  });

  it("clears reused fixed-window records when explicit segments alternate between present and absent", async () => {
    const fixture = createFixture({ equation: "dy", graphPath: hardPath });
    const automatic = resolveFixture(fixture, { type: "automatic" });
    const segments = automatic.context.stepGlitchFormulaEvidence?.prefix.stepGlitchSegments;
    const hardSegment = segments?.[1];
    expect(hardSegment).toBeDefined();
    if (!hardSegment) {
      throw new Error("expected a hard second segment");
    }
    const { context, runtime } = await createContext(fixture, 2);
    const retainedCursor = runtime.arenaCursor;
    const withWindow = {
      path: fixture.pixelPath,
      windows: {
        segments: [undefined, { endX: hardSegment.endX, startX: hardSegment.startX }],
        type: "explicit",
      },
    } as const;
    const withoutWindow = {
      path: fixture.pixelPath,
      windows: { segments: [undefined, undefined], type: "explicit" },
    } as const;

    expect(context.prepareCandidateFormulaForTest(withWindow).status).toBe("success");
    expect(context.prepareCandidateFormulaForTest(withoutWindow).status).toBe("success");
    expect(context.prepareCandidateFormulaForTest(withWindow).status).toBe("success");
    expect(runtime.arenaCursor).toBe(retainedCursor);
    expect(runtime.getArenaDiagnostics().isCanaryIntact).toBe(true);
    context.dispose();
  });

  it("refreshes output views after command-owned formula construction grows memory", async () => {
    const fixture = createFixture({ equation: "dy", graphPath: hardPath });
    const { context, runtime } = await createContext(fixture, 2);
    const byteLengthBeforeCommand = runtime.buffer.byteLength;
    const remainingByteLength = byteLengthBeforeCommand - runtime.arenaCursor;
    runtime.reserveArena(remainingByteLength - 8, 1);
    const retainedCursor = runtime.arenaCursor;
    const actual = context.prepareCandidateFormulaForTest({
      path: fixture.pixelPath,
      windows: { type: "automatic" },
    });

    expect(actual.status).toBe("success");
    expect(runtime.buffer.byteLength).toBeGreaterThan(byteLengthBeforeCommand);
    expect(runtime.arenaCursor).toBe(retainedCursor);
    expect(runtime.getArenaDiagnostics().isCanaryIntact).toBe(true);
    context.dispose();
  });

  it("rejects source-prefix changes and malformed fixed-window half states while preserving the retained context", async () => {
    const fixture = createFixture({ equation: "dy", graphPath: hardPath });
    const { context, runtime } = await createContext(fixture, 2);
    const retainedCursor = runtime.arenaCursor;
    const changedPath = [...fixture.pixelPath];
    changedPath[0] = { ...changedPath[0], x: changedPath[0].x + 1 };

    expect(() =>
      context.prepareCandidateFormulaForTest({ path: changedPath, windows: { type: "automatic" } }),
    ).toThrowError();
    expect(() =>
      context.prepareCandidateFormulaForTest({
        path: fixture.pixelPath,
        windows: { segments: [undefined], type: "explicit" },
      }),
    ).toThrowError();
    expect(runtime.arenaCursor).toBe(retainedCursor);
    expect(runtime.getArenaDiagnostics().isCanaryIntact).toBe(true);
    context.dispose();
  });

  it.each([
    {
      mutate(view: DataView, inputPointer: number) {
        view.setUint32(inputPointer + 28, 1, true);
      },
      name: "command reserved field",
      windows: { type: "automatic" } as const,
    },
    {
      mutate(view: DataView, inputPointer: number) {
        const pathXPointer = view.getUint32(inputPointer + 4, true);
        view.setFloat64(pathXPointer, view.getFloat64(pathXPointer, true) + 0.25, true);
      },
      name: "packed source prefix",
      windows: { type: "automatic" } as const,
    },
    {
      mutate(view: DataView, inputPointer: number) {
        const windowPointer = view.getUint32(inputPointer + 16, true);
        view.setUint32(windowPointer, 2, true);
      },
      name: "fixed-window presence enum",
      windows: { segments: [undefined, { endX: -22.85, startX: -22.86 }], type: "explicit" } as const,
    },
    {
      mutate(view: DataView, inputPointer: number) {
        const windowPointer = view.getUint32(inputPointer + 16, true);
        view.setUint32(windowPointer + 24 + 4, 1, true);
      },
      name: "fixed-window reserved field",
      windows: { segments: [undefined, { endX: -22.85, startX: -22.86 }], type: "explicit" } as const,
    },
    {
      mutate(view: DataView, inputPointer: number) {
        const windowPointer = view.getUint32(inputPointer + 16, true);
        view.setFloat64(windowPointer + 8, -23, true);
      },
      name: "absent fixed-window coordinates",
      windows: { segments: [undefined, { endX: -22.85, startX: -22.86 }], type: "explicit" } as const,
    },
    {
      mutate(view: DataView, inputPointer: number) {
        const windowPointer = view.getUint32(inputPointer + 16, true) + 24;
        view.setFloat64(windowPointer + 16, view.getFloat64(windowPointer + 8, true), true);
      },
      name: "non-increasing fixed-window coordinates",
      windows: { segments: [undefined, { endX: -22.85, startX: -22.86 }], type: "explicit" } as const,
    },
  ])("rejects a malformed $name at the WASM construction boundary", async ({ mutate, windows }) => {
    const fixture = createFixture({ equation: "dy", graphPath: hardPath });
    const { context, runtime } = await createContext(fixture, 2);
    const retainedCursor = runtime.arenaCursor;
    const runRouteTask = runtime.runRouteTask.bind(runtime);
    vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      if (command === 15) {
        mutate(new DataView(runtime.buffer), inputPointer);
      }
      return runRouteTask(command, inputPointer, inputByteLength);
    });

    expect(() => context.prepareCandidateFormulaForTest({ path: fixture.pixelPath, windows })).toThrowError();
    expect(runtime.arenaCursor).toBe(retainedCursor);
    expect(runtime.getArenaDiagnostics().isCanaryIntact).toBe(true);
    context.dispose();
  });
});

function createFixture({
  bounds = directBounds,
  boundsRect = directBoundsRect,
  decimalPlaces = 4,
  equation,
  formulaPathSteepness,
  graphPath,
}: {
  bounds?: GraphBounds;
  boundsRect?: BoundsRect;
  decimalPlaces?: number;
  equation: Extract<EquationMode, "ddy" | "dy">;
  formulaPathSteepness?: number;
  graphPath: readonly GraphPoint[];
}) {
  const mask = new Uint8Array(planeCellCount);
  const settings = {
    algorithm: "step",
    decimalPlaces,
    equation,
    ...(formulaPathSteepness === undefined ? {} : { formulaPathSteepness }),
    isStepGlitchModeEnabled: true,
    isStepOverflowProtectionEnabled: true,
    secondOrderLaunchAngleMode: "full-precision",
    steepness: 210,
    stepGlitchObstacleMask: mask,
  } satisfies GraphwarTrajectoryFormulaSettings;
  const pixelPath = graphPath.map((point) => graphToImagePoint(point, bounds, boundsRect));
  return { bounds, boundsRect, mask, pixelPath, settings };
}

async function createContext(fixture: ReturnType<typeof createFixture>, sourcePointCount: number) {
  const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
  const result = createGraphwarWasmStepGlitchGeometryTestContext(
    runtime,
    createGraphwarWasmStepGlitchContextInput({
      bounds: fixture.bounds,
      boundsRect: fixture.boundsRect,
      formulaMode: createGraphwarTrajectoryFormulaMode(fixture.settings),
      simulationMask: fixture.mask,
      sourcePath: fixture.pixelPath.slice(0, sourcePointCount),
    }),
  );
  expect(result.status).toBe("ready");
  if (result.status !== "ready") {
    throw new Error("expected retained Step-glitch context");
  }
  return { context: result.context, runtime };
}

function resolveFixture(
  fixture: ReturnType<typeof createFixture>,
  windows: { type: "automatic" } | { segments: readonly (GraphwarStepGlitchXWindow | undefined)[]; type: "explicit" },
) {
  const graphPath = fixture.pixelPath.map((point) => imageToGraphPoint(point, fixture.bounds, fixture.boundsRect));
  return resolveGraphwarTrajectory({
    bounds: fixture.bounds,
    boundsRect: fixture.boundsRect,
    formulaMode: createGraphwarTrajectoryFormulaMode(fixture.settings),
    points: graphPath,
    soldierCenter: graphPath[0],
    ...(windows.type === "automatic" ? {} : { stepGlitchXWindows: windows.segments }),
  });
}

function expectLaunchToMatchOracle(
  actual: GraphwarWasmFormulaLaunchResult,
  expected: ReturnType<typeof resolveFixture>,
) {
  expect(actual.status).toBe("success");
  if (actual.status !== "success") {
    return;
  }
  expect(actual.formulaPoints).toEqual(expected.context.formulaPoints);
  expect(actual.compiledMaterials).toEqual(expected.context.compiledMaterials);
  expect(actual.observedSignProtection).toEqual(
    Array.from(
      { length: expected.context.formulaPoints.length - 1 },
      (_value, index) => expected.context.signProtection[index] ?? 0,
    ),
  );
  expect(actual.launch.point).toEqual(expected.result.sample.points[0]);
  if (actual.launch.equation === "ddy") {
    expect(actual.launch.angleRadians).toBe(getGraphwarTrajectoryLaunchAngle(expected.context));
    expect(actual.launch.initialDy).toBe(Math.tan(actual.launch.angleRadians));
    expect(actual.launch.isUserAngle).toBe(false);
  } else if (actual.launch.equation === "dy") {
    expect(actual.launch.angleRadians).toBe(getGraphwarTrajectoryLaunchAngle(expected.context));
  }
}
