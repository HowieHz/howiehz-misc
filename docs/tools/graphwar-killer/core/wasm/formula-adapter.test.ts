import { beforeAll, describe, expect, it, vi } from "vitest";

import { createGraphwarTrajectoryDebugMetrics } from "../../formula/debug-metrics";
import { parseGraphwarExpressionProgram } from "../../formula/expression/evaluator";
import {
  createGraphwarExpressionProgram,
  createGraphwarExpressionProgramEvaluator,
  GraphwarExpressionOpcode,
} from "../../formula/expression/program";
import {
  compileFormulaEvaluator,
  compileGraphwarFormulaMaterials,
  GraphwarSignRole,
} from "../../formula/generation/build";
import type { FormulaEvaluationOptions } from "../../formula/generation/step-numeric-strategy";
import { createGraphwarTrajectoryFormulaMode, resolveGraphwarTrajectory } from "../../formula/trajectory/sampling";
import { GraphwarWasmFault } from "../algorithm-backend";
import {
  GRAPHWAR_FUNC_MAX_STEPS,
  GRAPHWAR_GAME_SOLDIER_RADIUS,
  GRAPHWAR_PLANE_HEIGHT,
  GRAPHWAR_PLANE_LENGTH,
} from "../game/constants";
import { graphwarToolDefaults } from "../tool/defaults";
import { createGraphPoint, type AlgorithmMode, type EquationMode, type GraphPoint } from "../types";
import { GraphwarWasmAdapterError } from "./abi";
import {
  prepareGraphwarWasmFormulaLaunch,
  runGraphwarWasmExpressionBatch,
  runGraphwarWasmFormulaBatch,
  runGraphwarWasmTrajectory,
  runGraphwarWasmTrajectoryThroughStepGlitchTestSeam,
  type GraphwarWasmTrajectoryInput,
  type GraphwarWasmTrajectoryPhysicalState,
} from "./formula-adapter";
import { readGraphwarKernelBytes } from "./kernel-test-fixture";
import { instantiateGraphwarWasmRuntime, type GraphwarWasmKernelRuntime } from "./runtime";
import type { GraphwarWasmFormulaInputDescriptor, GraphwarWasmStopPolicy } from "./task-adapter";

const DEFAULT_MAX_ULP_DISTANCE = 64n;
// V8 12.x and the WASM-native pow implementation round the high powers used by
// soft-cubic ddy differently; cancellation can amplify that difference.
const SOFT_CUBIC_DDY_MAX_ULP_DISTANCE = 256n;
const bounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
const points = [
  createGraphPoint(-2, 1),
  createGraphPoint(-0.25, 2.5),
  createGraphPoint(1.5, -1.25),
  createGraphPoint(4, 3.75),
] as const satisfies readonly GraphPoint[];
const values = [
  { dy: -0.75, x: -3, y: 0.5 },
  { dy: 0, x: -0.25, y: 2.5 },
  { dy: 1.25, x: 0.75, y: -2 },
  { dy: -3, x: 5, y: 4 },
] as const;

let kernelModule: WebAssembly.Module;

beforeAll(async () => {
  kernelModule = await WebAssembly.compile(await readGraphwarKernelBytes());
});

describe("Graphwar WASM formula Adapter", () => {
  it("runs a canonical expression batch and returns an owned result", async () => {
    const runtime = await createRuntime();
    const program = parseGraphwarExpressionProgram("sqrt(abs(x))+log(100)+sin(y)+cos(y)+tan(y')+ln(e)+pi+x/y^2");
    if (!program) {
      throw new Error("Expected the expression to parse");
    }
    const evaluate = createGraphwarExpressionProgramEvaluator(program);
    const result = runGraphwarWasmExpressionBatch(runtime, { program, values });
    const snapshot = [...result];
    expect(result).toHaveLength(values.length);
    for (let index = 0; index < values.length; index += 1) {
      expectFloatEquivalent(
        result[index],
        evaluate(values[index].x, values[index].y, values[index].dy),
        `expression:${index}`,
      );
    }

    runGraphwarWasmExpressionBatch(runtime, {
      program,
      values: Array.from({ length: 16_384 }, (_, index) => ({ dy: index / 5, x: index / 3, y: index / 7 })),
    });
    expect([...result]).toEqual(snapshot);
  });

  it("returns owned Java-compatible terminal non-finite expression results", async () => {
    const runtime = await createRuntime();
    const canonicalNonFinitePrograms = [
      { expected: Number.POSITIVE_INFINITY, program: parseGraphwarExpressionProgram("1/0") },
      { expected: Number.NEGATIVE_INFINITY, program: parseGraphwarExpressionProgram("-1/0") },
      {
        expected: Number.NEGATIVE_INFINITY,
        program: createGraphwarExpressionProgram(
          new Uint8Array([GraphwarExpressionOpcode.Constant]),
          new Float64Array([Number.NEGATIVE_INFINITY]),
        ),
      },
      {
        expected: Number.POSITIVE_INFINITY,
        program: createGraphwarExpressionProgram(
          new Uint8Array([GraphwarExpressionOpcode.Constant]),
          new Float64Array([Number.POSITIVE_INFINITY]),
        ),
      },
      {
        expected: Number.NaN,
        program: createGraphwarExpressionProgram(
          new Uint8Array([GraphwarExpressionOpcode.Constant]),
          new Float64Array([Number.NaN]),
        ),
      },
    ] as const;

    for (const entry of canonicalNonFinitePrograms) {
      const { program } = entry;
      expect(program).toBeDefined();
      if (!program) {
        continue;
      }
      const result = runGraphwarWasmExpressionBatch(runtime, {
        program,
        values: [{ dy: 0, x: 0, y: 0 }],
      });
      expect(Object.is(result[0], entry.expected)).toBe(true);

      runGraphwarWasmExpressionBatch(runtime, {
        program,
        values: Array.from({ length: 1_024 }, (_, index) => ({ dy: 0, x: index, y: 0 })),
      });
      expect(Object.is(result[0], entry.expected)).toBe(true);
    }
  });

  for (const algorithm of ["abs", "step", "pchip", "akima"] as const) {
    for (const equation of ["y", "dy", "ddy"] as const) {
      it(`packs, runs, and owns ${algorithm}:${equation} materials`, async () => {
        const runtime = await createRuntime();
        const descriptor = createDescriptor(algorithm, equation);
        const formulaEvaluation = createFormulaEvaluation(equation, algorithm);
        const expectedMaterials = compileGraphwarFormulaMaterials(
          points,
          descriptor.settings.steepness,
          algorithm,
          formulaEvaluation,
        );
        const expectedEvaluator = compileFormulaEvaluator(
          points,
          descriptor.settings.steepness,
          algorithm,
          formulaEvaluation,
          expectedMaterials,
        );
        const result = runGraphwarWasmFormulaBatch(runtime, { descriptor, formulaEvaluation, values });
        expect(result.compiledMaterials).toEqual(
          algorithm === "abs" && equation === "ddy" ? { ...expectedMaterials, absSegments: [] } : expectedMaterials,
        );
        expect(result.observedSignProtection).toHaveLength(points.length - 1);
        for (let index = 0; index < values.length; index += 1) {
          const value = values[index];
          const expected =
            equation === "y"
              ? expectedEvaluator.evaluateY(value.x)
              : equation === "dy"
                ? expectedEvaluator.evaluateFirstDerivativeY(value.x, value.y)
                : expectedEvaluator.evaluateSecondDerivativeY(value.x, value.y, value.dy);
          expectFormulaValueEquivalent(
            result.values[index],
            expected,
            algorithm,
            equation,
            `${algorithm}:${equation}:${index}`,
          );
        }
      });
    }
  }

  it("returns an atomic launch success and preserves explicit second-order angle identity", async () => {
    const runtime = await createRuntime();
    const angleRadians = Math.PI / 6;
    const descriptor = {
      ...createDescriptor("step", "ddy"),
      secondOrderLaunchAngle: { degrees: (angleRadians * 180) / Math.PI, radians: angleRadians },
    } satisfies GraphwarWasmFormulaInputDescriptor;
    const result = prepareGraphwarWasmFormulaLaunch(runtime, descriptor);
    expect(result.status).toBe("success");
    if (result.status !== "success") {
      return;
    }
    expect(result.launch).toEqual({
      angleRadians,
      equation: "ddy",
      initialDy: Math.tan(angleRadians),
      isUserAngle: true,
      point: createGraphPoint(
        descriptor.soldierCenter.x + (7 * 50 * Math.cos(angleRadians)) / 770,
        descriptor.soldierCenter.y + (7 * 50 * Math.sin(angleRadians)) / 770,
      ),
    });
    expect(result.formulaPoints).toHaveLength(points.length);
    expect(result.compiledMaterials.algorithm).toBe("step");
  });

  it.each([
    { candidateBounds: bounds, label: "forward" },
    {
      candidateBounds: { maxX: -25, maxY: -15, minX: 25, minY: 15 },
      label: "coordinate-mirrored",
    },
  ] as const)("accepts $label finite nondegenerate Formula bounds", async ({ candidateBounds }) => {
    const runtime = await createRuntime();
    const descriptor = { ...createDescriptor("step", "y"), bounds: candidateBounds };
    const result = runGraphwarWasmFormulaBatch(runtime, {
      descriptor,
      formulaEvaluation: createFormulaEvaluation("y"),
      values: [],
    });
    expect(result.compiledMaterials.algorithm).toBe("step");
  });

  it.each([
    { candidateBounds: { ...bounds, maxX: bounds.minX }, label: "equal x endpoints" },
    { candidateBounds: { ...bounds, maxY: bounds.minY }, label: "equal y endpoints" },
  ] as const)("rejects Formula bounds with $label", async ({ candidateBounds }) => {
    const runtime = await createRuntime();
    const descriptor = { ...createDescriptor("step", "y"), bounds: candidateBounds };
    const runFormulaSpy = vi.spyOn(runtime, "runFormula");
    expect(() =>
      runGraphwarWasmFormulaBatch(runtime, {
        descriptor,
        formulaEvaluation: createFormulaEvaluation("y"),
        values: [],
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-formula-input" }));
    expect(runFormulaSpy).not.toHaveBeenCalled();
  });

  it.each([
    { field: "minX", value: Number.NaN },
    { field: "maxX", value: Number.POSITIVE_INFINITY },
    { field: "minY", value: Number.NEGATIVE_INFINITY },
    { field: "maxY", value: Number.NaN },
  ] as const)("rejects a non-finite Formula bounds $field", async ({ field, value }) => {
    const runtime = await createRuntime();
    const descriptor = {
      ...createDescriptor("step", "y"),
      bounds: { ...bounds, [field]: value },
    };
    const runFormulaSpy = vi.spyOn(runtime, "runFormula");
    expect(() =>
      runGraphwarWasmFormulaBatch(runtime, {
        descriptor,
        formulaEvaluation: createFormulaEvaluation("y"),
        values: [],
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-formula-input" }));
    expect(runFormulaSpy).not.toHaveBeenCalled();
  });

  it("packs only raw Step refinement inputs for production launch", { timeout: 30_000 }, async () => {
    const runtime = await createRuntime();
    const mask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    mask[0] = 1;
    mask[mask.length - 1] = 255;
    const baseDescriptor = createDescriptor("step", "dy");
    const descriptor = {
      ...baseDescriptor,
      settings: {
        ...baseDescriptor.settings,
        isStepGlitchModeEnabled: true,
        stepGlitchObstacleMask: mask,
      },
    } satisfies GraphwarWasmFormulaInputDescriptor;
    const runFormula = runtime.runFormula.bind(runtime);
    const runFormulaSpy = vi
      .spyOn(runtime, "runFormula")
      .mockImplementation((command, inputPointer, inputByteLength) => {
        expect(command).toBe(4);
        expect(inputByteLength).toBe(176);
        const view = new DataView(runtime.buffer);
        expect(view.getUint32(inputPointer + 12, true) & 8).toBe(8);
        for (const offset of [120, 124, 128, 132, 136, 140, 144]) {
          expect(view.getUint32(inputPointer + offset, true), `precomputed pointer at ${offset}`).toBe(0);
        }
        const overflowRangePointer = view.getUint32(inputPointer + 52, true);
        expect(view.getUint32(inputPointer + 148, true)).toBe(2);
        expect([...new Float64Array(runtime.buffer, overflowRangePointer, 2)]).toEqual([
          descriptor.points[0].x,
          Math.max(descriptor.bounds.minX, descriptor.bounds.maxX),
        ]);
        const maskPointer = view.getUint32(inputPointer + 160, true);
        expect(view.getUint32(inputPointer + 164, true)).toBe(mask.length);
        expect(new Uint8Array(runtime.buffer, maskPointer, mask.length)).toEqual(mask);
        expect(view.getFloat64(inputPointer + 168, true)).toBe(
          graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
        );
        return runFormula(command, inputPointer, inputByteLength);
      });

    prepareGraphwarWasmFormulaLaunch(runtime, descriptor);
    expect(runFormulaSpy).toHaveBeenCalledOnce();
  });

  it.each([
    {
      label: "missing range pointer",
      mutate(view: DataView, inputPointer: number) {
        view.setUint32(inputPointer + 52, 0, true);
      },
    },
    {
      label: "missing range count",
      mutate(view: DataView, inputPointer: number) {
        view.setUint32(inputPointer + 148, 0, true);
      },
    },
    {
      label: "non-finite range value",
      mutate(view: DataView, inputPointer: number) {
        view.setFloat64(view.getUint32(inputPointer + 52, true), Number.NaN, true);
      },
    },
  ])("rejects a raw Step launch with $label", async ({ mutate }) => {
    const runtime = await createRuntime();
    const runFormula = runtime.runFormula.bind(runtime);
    vi.spyOn(runtime, "runFormula").mockImplementation((command, inputPointer, inputByteLength) => {
      mutate(new DataView(runtime.buffer), inputPointer);
      return runFormula(command, inputPointer, inputByteLength);
    });

    expect(() => prepareGraphwarWasmFormulaLaunch(runtime, createDescriptor("step", "dy"))).toThrowError(
      GraphwarWasmFault,
    );
  });

  it.each([
    { range: { maxX: 1 }, type: "half-state" },
    { range: { maxX: 1, minX: Number.NaN }, type: "non-finite" },
  ])("rejects a $type Step overflow range at the Adapter boundary", async ({ range }) => {
    const runtime = await createRuntime();
    const runFormulaSpy = vi.spyOn(runtime, "runFormula");
    const formulaEvaluation = {
      ...createFormulaEvaluation("dy"),
      stepOverflowProtectionRange: range,
    } as FormulaEvaluationOptions;

    expect(() =>
      runGraphwarWasmFormulaBatch(runtime, {
        descriptor: createDescriptor("step", "dy"),
        formulaEvaluation,
        values: [],
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-formula-input" }));
    expect(runFormulaSpy).not.toHaveBeenCalled();
  });

  it("rejects Step overflow range state for a curve formula", async () => {
    const runtime = await createRuntime();
    const runFormulaSpy = vi.spyOn(runtime, "runFormula");
    const formulaEvaluation = {
      ...createFormulaEvaluation("dy"),
      stepOverflowProtectionRange: { maxX: 1, minX: 0 },
    } satisfies FormulaEvaluationOptions;

    expect(() =>
      runGraphwarWasmFormulaBatch(runtime, {
        descriptor: createDescriptor("abs", "dy"),
        formulaEvaluation,
        values: [],
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-formula-input" }));
    expect(runFormulaSpy).not.toHaveBeenCalled();
  });

  it("returns numerical invalid without exposing placeholder launch state", async () => {
    const runtime = await createRuntime();
    const descriptor = {
      ...createDescriptor("pchip", "y"),
      points: [createGraphPoint(0, Number.MAX_VALUE), createGraphPoint(1, -Number.MAX_VALUE)],
      soldierCenter: createGraphPoint(0, Number.MAX_VALUE),
    } satisfies GraphwarWasmFormulaInputDescriptor;
    const result = prepareGraphwarWasmFormulaLaunch(runtime, descriptor);
    expect(result).toEqual({
      formulaPointIterationCount: 0,
      iterationCount: 0,
      observedSignProtection: [0],
      status: "invalid",
    });
  });

  it("rejects success-only state on an invalid trajectory launch", async () => {
    const runtime = await createRuntime();
    const descriptor = {
      ...createDescriptor("pchip", "y"),
      points: [createGraphPoint(0, Number.MAX_VALUE), createGraphPoint(1, -Number.MAX_VALUE)],
      soldierCenter: createGraphPoint(0, Number.MAX_VALUE),
    } satisfies GraphwarWasmFormulaInputDescriptor;
    expect(
      runGraphwarWasmTrajectory(runtime, {
        descriptor,
        start: { type: "cold" },
        stop: { type: "natural" },
      }),
    ).toBeUndefined();

    const runTrajectory = runtime.runTrajectory.bind(runtime);
    vi.spyOn(runtime, "runTrajectory").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runTrajectory(inputPointer, inputByteLength);
      new DataView(runtime.buffer).setUint32(resultPointer + 8, 1, true);
      return resultPointer;
    });
    expect(() =>
      runGraphwarWasmTrajectory(runtime, {
        descriptor,
        start: { type: "cold" },
        stop: { type: "natural" },
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-formula-result" }));
  });

  it("rejects malformed angle evidence and invalid-result half-state", async () => {
    const runtime = await createRuntime();
    const descriptor = {
      ...createDescriptor("step", "ddy"),
      secondOrderLaunchAngle: { degrees: 45, radians: 0 },
    } satisfies GraphwarWasmFormulaInputDescriptor;
    expect(() => prepareGraphwarWasmFormulaLaunch(runtime, descriptor)).toThrowError(GraphwarWasmAdapterError);

    const outOfRangeAngle = Math.PI / 2 + Number.EPSILON;
    const outOfRangeDescriptor = {
      ...createDescriptor("step", "ddy"),
      secondOrderLaunchAngle: {
        degrees: (outOfRangeAngle * 180) / Math.PI,
        radians: outOfRangeAngle,
      },
    } satisfies GraphwarWasmFormulaInputDescriptor;
    expect(() => prepareGraphwarWasmFormulaLaunch(runtime, outOfRangeDescriptor)).toThrowError(
      GraphwarWasmAdapterError,
    );

    const validDescriptor = createDescriptor("step", "y");
    vi.spyOn(runtime, "runFormula").mockImplementation(() => writeMalformedInvalidLaunch(runtime));
    expect(() => prepareGraphwarWasmFormulaLaunch(runtime, validDescriptor)).toThrowError(
      expect.objectContaining({ code: "invalid-formula-result" }),
    );
  });

  it.each([
    { equation: "y", label: "normal angle", offset: 8, value: Number.POSITIVE_INFINITY },
    { equation: "y", label: "normal initial dy", offset: 32, value: -0 },
    { equation: "dy", label: "first-order initial dy", offset: 32, value: -0 },
    { equation: "dy", label: "first-order y offset", offset: 40, value: -0 },
    { equation: "ddy", label: "second-order y offset", offset: 40, value: -0 },
  ] as const)("rejects a non-canonical $label success slot", async ({ equation, offset, value }) => {
    const runtime = await createRuntime();
    const runFormula = runtime.runFormula.bind(runtime);
    vi.spyOn(runtime, "runFormula").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = runFormula(command, inputPointer, inputByteLength);
      new DataView(runtime.buffer).setFloat64(resultPointer + offset, value, true);
      return resultPointer;
    });

    expect(() => prepareGraphwarWasmFormulaLaunch(runtime, createDescriptor("step", equation))).toThrowError(
      expect.objectContaining({ code: "invalid-formula-result" }),
    );
  });

  it("rejects a user-angle launch result that does not preserve the requested identity", async () => {
    const runtime = await createRuntime();
    const angleRadians = Math.PI / 6;
    const descriptor = {
      ...createDescriptor("step", "ddy"),
      secondOrderLaunchAngle: { degrees: (angleRadians * 180) / Math.PI, radians: angleRadians },
    } satisfies GraphwarWasmFormulaInputDescriptor;
    const runFormula = runtime.runFormula.bind(runtime);
    vi.spyOn(runtime, "runFormula").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = runFormula(command, inputPointer, inputByteLength);
      new DataView(runtime.buffer).setFloat64(resultPointer + 8, angleRadians + Number.EPSILON, true);
      return resultPointer;
    });

    expect(() => prepareGraphwarWasmFormulaLaunch(runtime, descriptor)).toThrowError(
      expect.objectContaining({ code: "invalid-formula-result" }),
    );
  });

  it.each([
    { algorithm: "abs", equation: "y", materialByteOffset: 0, value: Number.NaN },
    { algorithm: "abs", equation: "ddy", materialByteOffset: 8, value: Number.POSITIVE_INFINITY },
    { algorithm: "step", equation: "dy", materialByteOffset: 16, value: Number.NEGATIVE_INFINITY },
    { algorithm: "pchip", equation: "y", materialByteOffset: 80, value: Number.NaN },
  ] as const)(
    "rejects malformed $algorithm:$equation winning launch materials",
    async ({ algorithm, equation, materialByteOffset, value }) => {
      const runtime = await createRuntime();
      const runFormula = runtime.runFormula.bind(runtime);
      vi.spyOn(runtime, "runFormula").mockImplementation((command, inputPointer, inputByteLength) => {
        const resultPointer = runFormula(command, inputPointer, inputByteLength);
        const view = new DataView(runtime.buffer);
        const materialResultPointer = view.getUint32(resultPointer + 48, true);
        const materialPointer = view.getUint32(materialResultPointer + 4, true);
        view.setFloat64(materialPointer + materialByteOffset, value, true);
        return resultPointer;
      });

      expect(() => prepareGraphwarWasmFormulaLaunch(runtime, createDescriptor(algorithm, equation))).toThrowError(
        expect.objectContaining({ code: "invalid-formula-result" }),
      );
    },
  );

  it("retains non-finite compiled material values for diagnostic formula batches", async () => {
    const runtime = await createRuntime();
    const runFormula = runtime.runFormula.bind(runtime);
    vi.spyOn(runtime, "runFormula").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = runFormula(command, inputPointer, inputByteLength);
      const view = new DataView(runtime.buffer);
      const materialPointer = view.getUint32(resultPointer + 4, true);
      view.setFloat64(materialPointer, Number.NaN, true);
      return resultPointer;
    });

    const descriptor = createDescriptor("abs", "y");
    const result = runGraphwarWasmFormulaBatch(runtime, {
      descriptor,
      formulaEvaluation: createFormulaEvaluation("y", "abs"),
      values: [],
    });
    expect(Number.isNaN(result.compiledMaterials.absSegments?.[0]?.coefficient)).toBe(true);
  });

  it("matches the existing formula-point construction contract through the typed launch entry", async () => {
    const runtime = await createRuntime();
    const descriptor = createDescriptor("step", "dy");
    const oracle = resolveGraphwarTrajectory({
      bounds,
      boundsRect: { height: GRAPHWAR_PLANE_HEIGHT, width: GRAPHWAR_PLANE_LENGTH, x: 0, y: 0 },
      formulaMode: createGraphwarTrajectoryFormulaMode(descriptor.settings),
      points,
      soldierCenter: createGraphPoint(descriptor.soldierCenter.x, descriptor.soldierCenter.y),
      start: { type: "cold" },
    });
    const result = prepareGraphwarWasmFormulaLaunch(runtime, descriptor);
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.formulaPoints).toEqual(oracle.context.formulaPoints);
    }
  });

  it("runs a complete owned trajectory and preserves a stop-x terminal state", async () => {
    const runtime = await createRuntime();
    const descriptor = createDescriptor("pchip", "y");
    const result = runGraphwarWasmTrajectory(runtime, {
      descriptor,
      start: { type: "cold" },
      stop: { observationXs: [], stopX: 3, type: "stop-x-observations" },
    });
    expect(result).toBeDefined();
    if (!result) {
      return;
    }
    expect(result.points.length).toBeGreaterThan(1);
    expect(result.points[0]).toEqual(result.launchPoint);
    expect(result.continuationEvidence.state.currentPoint).toEqual(result.points.at(-1));
    expect(result.continuationEvidence.state.currentPoint.x).toBeGreaterThanOrEqual(3);
    expect(result.continuationEvidence.canContinueToLaterFrontier).toBe(true);
    expect(result.stopReason).toBe(1);
    expect(result.continuationEvidence.state.equation).toBe("y");
    expect(Object.is(result.initialDy, 0)).toBe(true);
    expect(result.continuationEvidence.state.sampleIndex).toBe(result.points.length - 1);
    expect(result.startType).toBe("cold");
  });

  it("normalizes identical results through the public and Step-glitch trajectory commands", async () => {
    const invalidLaunchDescriptor = {
      ...createDescriptor("pchip", "y"),
      points: [createGraphPoint(0, Number.MAX_VALUE), createGraphPoint(1, -Number.MAX_VALUE)],
      soldierCenter: createGraphPoint(0, Number.MAX_VALUE),
    } satisfies GraphwarWasmFormulaInputDescriptor;
    const nonFiniteTrialDescriptor = {
      ...createDescriptor("pchip", "ddy"),
      bounds: { maxX: 1e308, maxY: 1e308, minX: -1e308, minY: -1e308 },
      points: [createGraphPoint(0, 0), createGraphPoint(1, 1e308)],
      secondOrderLaunchAngle: { degrees: 0, radians: 0 },
      soldierCenter: createGraphPoint(0, 0),
    } satisfies GraphwarWasmFormulaInputDescriptor;
    const collisionMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    collisionMask[0] = 1;
    const vectors = [
      {
        input: {
          descriptor: createDescriptor("step", "dy"),
          start: { type: "cold" },
          stop: { observationXs: [-1, 1], stopX: 3, type: "stop-x-observations" },
        },
        name: "dy stop-x",
      },
      {
        input: {
          descriptor: createDescriptor("step", "ddy"),
          start: { type: "cold" },
          stop: createTargetStop({
            requiredTargets: [{ center: createGraphPoint(2, 0), radius: 1 }],
          }),
        },
        name: "ddy targets",
      },
      {
        input: {
          descriptor: createDescriptor("step", "dy"),
          start: { type: "cold" },
          stop: { type: "natural" },
        },
        name: "dy natural",
      },
      {
        input: {
          descriptor: invalidLaunchDescriptor,
          start: { type: "cold" },
          stop: { type: "natural" },
        },
        name: "invalid launch",
      },
      {
        input: {
          descriptor: nonFiniteTrialDescriptor,
          start: { type: "cold" },
          stop: { type: "natural" },
        },
        name: "non-finite trial",
      },
      {
        input: {
          descriptor: nonFiniteTrialDescriptor,
          start: { type: "cold" },
          stop: createTargetStop({ collision: { boundaryExpansion: 0, mask: collisionMask, type: "mask" } }),
        },
        name: "collision before non-finite classification",
      },
    ] as const satisfies readonly { input: GraphwarWasmTrajectoryInput; name: string }[];

    for (const vector of vectors) {
      const expected = runGraphwarWasmTrajectory(await createRuntime(), vector.input);
      const actual = runGraphwarWasmTrajectoryThroughStepGlitchTestSeam(await createRuntime(), vector.input);
      expect(actual, vector.name).toEqual(expected);
    }
  });

  it(
    "restores the caller mark and stabilizes the Step-glitch trajectory seam after growth",
    { timeout: 30_000 },
    async () => {
      const runtime = await createRuntime(64);
      const input = {
        descriptor: createDescriptor("step", "ddy"),
        start: { type: "cold" },
        stop: createTargetStop({ shouldCollectVisiblePixels: true }),
      } satisfies GraphwarWasmTrajectoryInput;
      const expected = runGraphwarWasmTrajectory(await createRuntime(), input);
      const arenaCursor = runtime.arenaCursor;
      expect(runGraphwarWasmTrajectoryThroughStepGlitchTestSeam(runtime, input)).toEqual(expected);
      const highWaterByteLength = runtime.buffer.byteLength;

      for (let iteration = 0; iteration < 100; iteration += 1) {
        expect(runGraphwarWasmTrajectoryThroughStepGlitchTestSeam(runtime, input)).toEqual(expected);
      }
      expect(runtime.arenaCursor).toBe(arenaCursor);
      expect(runtime.buffer.byteLength).toBe(highWaterByteLength);
      expect(runtime.getArenaDiagnostics().isCanaryIntact).toBe(true);
    },
  );

  it("unwinds a trajectory attempt mark after a nested kernel fault", async () => {
    const runtime = await createRuntime();
    const input = {
      descriptor: createDescriptor("step", "ddy"),
      start: { type: "cold" },
      stop: { type: "natural" },
    } satisfies GraphwarWasmTrajectoryInput;
    const arenaCursor = runtime.arenaCursor;
    const runTrajectory = runtime.runTrajectory.bind(runtime);
    vi.spyOn(runtime, "runTrajectory").mockImplementationOnce((inputPointer, inputByteLength) => {
      // Trajectory validates this field only when launch runs below its internal attempt mark.
      new DataView(runtime.buffer).setInt32(inputPointer, 0, true);
      return runTrajectory(inputPointer, inputByteLength);
    });

    expect(() => runGraphwarWasmTrajectory(runtime, input)).toThrowError(
      expect.objectContaining({ code: "trap", message: "unreachable" }),
    );
    expect(runtime.arenaCursor).toBe(arenaCursor);
  });

  it("stabilizes launch-only zero-sign protection before publishing the result", async () => {
    const launchX = 0.44;
    const descriptor = {
      ...createDescriptor("abs", "dy"),
      points: [createGraphPoint(-1, 0), createGraphPoint(launchX, 0), createGraphPoint(2, 1)],
      soldierCenter: createGraphPoint(launchX - GRAPHWAR_GAME_SOLDIER_RADIUS, 0),
    } satisfies GraphwarWasmFormulaInputDescriptor;
    const result = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop: { observationXs: [], stopX: launchX, type: "stop-x-observations" },
    });

    expect(result?.launchPoint.x).toBe(launchX);
    expect(result?.points).toEqual(result ? [result.launchPoint] : undefined);
    expect(result?.continuationEvidence.observedSignProtection.some((roles) => roles !== 0)).toBe(true);
    expect(result?.replayCount).toBeGreaterThan(1);
  });

  it("continues an identical trajectory to a later stop-x frontier", async () => {
    const runtime = await createRuntime();
    const descriptor = createDescriptor("pchip", "y");
    const first = runGraphwarWasmTrajectory(runtime, {
      descriptor,
      start: { type: "cold" },
      stop: { observationXs: [], stopX: 1, type: "stop-x-observations" },
    });
    expect(first).toBeDefined();
    if (!first) {
      return;
    }
    const continued = runGraphwarWasmTrajectory(runtime, {
      descriptor,
      start: { evidence: first.continuationEvidence, type: "continuation" },
      stop: { observationXs: [], stopX: 3, type: "stop-x-observations" },
    });
    const cold = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop: { observationXs: [], stopX: 3, type: "stop-x-observations" },
    });
    expect(continued?.startType).toBe("continuation");
    expect(continued?.points[0]).toEqual(first.continuationEvidence.state.currentPoint);
    expect(continued?.continuationEvidence.state).toEqual(cold?.continuationEvidence.state);
    expect([...first.points, ...(continued?.points.slice(1) ?? [])]).toEqual(cold?.points);
  });

  it("cold-replays valid continuation evidence when formula or stop identity changes", async () => {
    const runtime = await createRuntime();
    const descriptor = createDescriptor("pchip", "y");
    const first = runGraphwarWasmTrajectory(runtime, {
      descriptor,
      start: { type: "cold" },
      stop: { observationXs: [], stopX: 1, type: "stop-x-observations" },
    });
    expect(first).toBeDefined();
    if (!first) {
      return;
    }
    const changedDescriptor = {
      ...descriptor,
      settings: { ...descriptor.settings, steepness: descriptor.settings.steepness + 1 },
    } satisfies GraphwarWasmFormulaInputDescriptor;
    const changedFormula = runGraphwarWasmTrajectory(runtime, {
      descriptor: changedDescriptor,
      start: { evidence: first.continuationEvidence, type: "continuation" },
      stop: { observationXs: [], stopX: 3, type: "stop-x-observations" },
    });
    const changedStop = runGraphwarWasmTrajectory(runtime, {
      descriptor,
      start: { evidence: first.continuationEvidence, type: "continuation" },
      stop: { observationXs: [2], stopX: 3, type: "stop-x-observations" },
    });
    const changedProof = runGraphwarWasmTrajectory(runtime, {
      descriptor,
      start: {
        evidence: {
          ...first.continuationEvidence,
          proofHash: [
            (first.continuationEvidence.proofHash[0] ^ 1) >>> 0,
            first.continuationEvidence.proofHash[1],
            first.continuationEvidence.proofHash[2],
            first.continuationEvidence.proofHash[3],
          ],
        },
        type: "continuation",
      },
      stop: { observationXs: [], stopX: 3, type: "stop-x-observations" },
    });
    expect(changedFormula?.startType).toBe("cold");
    expect(changedStop?.startType).toBe("cold");
    expect(changedProof?.startType).toBe("cold");
  });

  it("cold-replays continuation evidence when the second-order launch angle changes", async () => {
    const runtime = await createRuntime();
    const descriptor = createDescriptor("pchip", "ddy");
    const first = runGraphwarWasmTrajectory(runtime, {
      descriptor,
      start: { type: "cold" },
      stop: { observationXs: [], stopX: 1, type: "stop-x-observations" },
    });
    expect(first).toBeDefined();
    if (!first) {
      return;
    }
    const changedAngle = runGraphwarWasmTrajectory(runtime, {
      descriptor: {
        ...descriptor,
        secondOrderLaunchAngle: { degrees: 0, radians: 0 },
      },
      start: { evidence: first.continuationEvidence, type: "continuation" },
      stop: { observationXs: [], stopX: 3, type: "stop-x-observations" },
    });
    expect(changedAngle?.startType).toBe("cold");
  });

  it.each([
    {
      label: "collision mask",
      mutate: (stop: ReturnType<typeof createTargetStop>) => {
        const collision = stop.collision;
        if (collision.type !== "mask") {
          throw new Error("Expected a mask collision policy");
        }
        const mask = collision.mask.slice();
        mask[mask.length - 1] = 1;
        return { ...stop, collision: { ...collision, mask } };
      },
    },
    {
      label: "bounds mapping",
      mutate: (stop: ReturnType<typeof createTargetStop>) => ({
        ...stop,
        boundsRect: { ...stop.boundsRect, x: stop.boundsRect.x + 1 },
      }),
    },
    {
      label: "visible-pixel collection",
      mutate: (stop: ReturnType<typeof createTargetStop>) => ({ ...stop, shouldCollectVisiblePixels: true }),
    },
    {
      label: "target-stop flag",
      mutate: (stop: ReturnType<typeof createTargetStop>) => ({ ...stop, shouldStopOnTargetsComplete: true }),
    },
    {
      label: "quality points",
      mutate: (stop: ReturnType<typeof createTargetStop>) => ({
        ...stop,
        qualityPoints: [createGraphPoint(2, 0)],
      }),
    },
    {
      label: "tracked targets",
      mutate: (stop: ReturnType<typeof createTargetStop>) => ({
        ...stop,
        trackedTargets: [{ center: createGraphPoint(100, 100), radius: 1 }],
      }),
    },
  ])("cold-replays target continuation evidence when $label changes", async ({ mutate }) => {
    const runtime = await createRuntime();
    const descriptor = createDescriptor("pchip", "y");
    const mask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    const stop = createTargetStop({
      collision: { boundaryExpansion: 0, mask, type: "mask" },
      continueAfterTargetsUntilGraphX: { graphX: 1, type: "value" },
      qualityPoints: [createGraphPoint(1, 0)],
      shouldStopOnTargetsComplete: false,
    });
    const first = runGraphwarWasmTrajectory(runtime, {
      descriptor,
      start: { type: "cold" },
      stop,
    });
    expect(first).toBeDefined();
    if (!first) {
      return;
    }
    const changed = mutate({
      ...stop,
      continueAfterTargetsUntilGraphX: { graphX: 3, type: "value" },
    });
    const result = runGraphwarWasmTrajectory(runtime, {
      descriptor,
      start: { evidence: first.continuationEvidence, type: "continuation" },
      stop: changed,
    });
    expect(result?.startType).toBe("cold");
  });

  it.each([
    { label: "natural stop", stop: { type: "natural" } as const },
    {
      label: "the same frontier",
      stop: { observationXs: [], stopX: 1, type: "stop-x-observations" } as const,
    },
    {
      label: "a leftward frontier",
      stop: { observationXs: [], stopX: 0.5, type: "stop-x-observations" } as const,
    },
  ])("cold-replays continuation evidence for $label", async ({ stop }) => {
    const runtime = await createRuntime();
    const descriptor = createDescriptor("pchip", "y");
    const first = runGraphwarWasmTrajectory(runtime, {
      descriptor,
      start: { type: "cold" },
      stop: { observationXs: [], stopX: 1, type: "stop-x-observations" },
    });
    expect(first).toBeDefined();
    if (!first) {
      return;
    }
    const result = runGraphwarWasmTrajectory(runtime, {
      descriptor,
      start: { evidence: first.continuationEvidence, type: "continuation" },
      stop,
    });
    expect(result?.startType).toBe("cold");
  });

  it("cold-replays obstacle terminal evidence instead of skipping the blocked point", async () => {
    const runtime = await createRuntime();
    const descriptor = createDescriptor("pchip", "y");
    const mask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT).fill(1);
    const firstStop = createTargetStop({
      collision: { boundaryExpansion: 0, mask, type: "mask" },
      continueAfterTargetsUntilGraphX: { graphX: 1, type: "value" },
      shouldStopOnTargetsComplete: false,
    });
    const first = runGraphwarWasmTrajectory(runtime, {
      descriptor,
      start: { type: "cold" },
      stop: firstStop,
    });
    expect(first?.stopReason).toBe(6);
    expect(first?.continuationEvidence.canContinueToLaterFrontier).toBe(false);
    if (!first) {
      return;
    }
    const continued = runGraphwarWasmTrajectory(runtime, {
      descriptor,
      start: { evidence: first.continuationEvidence, type: "continuation" },
      stop: {
        ...firstStop,
        continueAfterTargetsUntilGraphX: { graphX: 3, type: "value" },
      },
    });
    expect(continued?.startType).toBe("cold");
    expect(continued?.obstacle).toEqual({ sampleIndex: 0, type: "hit" });
  });

  it("cold-replays out-of-bounds terminal evidence for a later stop-x frontier", async () => {
    const runtime = await createRuntime();
    const descriptor = {
      ...createDescriptor("pchip", "y"),
      bounds: { maxX: 1, maxY: 10, minX: -1, minY: -10 },
      points: [createGraphPoint(-0.9, 0), createGraphPoint(0.9, 0)],
      soldierCenter: createGraphPoint(-0.9, 0),
    } satisfies GraphwarWasmFormulaInputDescriptor;
    const first = runGraphwarWasmTrajectory(runtime, {
      descriptor,
      start: { type: "cold" },
      stop: { observationXs: [], stopX: 2, type: "stop-x-observations" },
    });
    expect(first?.stopReason).toBe(4);
    expect(first?.continuationEvidence.canContinueToLaterFrontier).toBe(false);
    if (!first) {
      return;
    }
    const continued = runGraphwarWasmTrajectory(runtime, {
      descriptor,
      start: { evidence: first.continuationEvidence, type: "continuation" },
      stop: { observationXs: [], stopX: 3, type: "stop-x-observations" },
    });
    expect(continued?.startType).toBe("cold");
    expect(continued?.stopReason).toBe(4);
  });

  it("rejects a continuation half-state before calling WASM", async () => {
    const runtime = await createRuntime();
    const descriptor = createDescriptor("pchip", "y");
    const first = runGraphwarWasmTrajectory(runtime, {
      descriptor,
      start: { type: "cold" },
      stop: { observationXs: [], stopX: 1, type: "stop-x-observations" },
    });
    expect(first).toBeDefined();
    if (!first || first.continuationEvidence.state.equation === "ddy") {
      return;
    }
    const runTrajectorySpy = vi.spyOn(runtime, "runTrajectory");
    expect(() =>
      runGraphwarWasmTrajectory(runtime, {
        descriptor,
        start: {
          evidence: {
            ...first.continuationEvidence,
            state: { ...first.continuationEvidence.state, sampleIndex: 0 },
          },
          type: "continuation",
        },
        stop: { observationXs: [], stopX: 3, type: "stop-x-observations" },
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-formula-input" }));
    expect(runTrajectorySpy).not.toHaveBeenCalled();
  });

  it("skips the resumed point for visible pixels and uses global observation indexes", async () => {
    const runtime = await createRuntime();
    const descriptor = createDescriptor("pchip", "y");
    const first = runGraphwarWasmTrajectory(runtime, {
      descriptor,
      start: { type: "cold" },
      stop: createTargetStop({
        continueAfterTargetsUntilGraphX: { graphX: 1, type: "value" },
        shouldCollectVisiblePixels: true,
        shouldStopOnTargetsComplete: false,
      }),
    });
    expect(first).toBeDefined();
    if (!first) {
      return;
    }
    const continued = runGraphwarWasmTrajectory(runtime, {
      descriptor,
      start: { evidence: first.continuationEvidence, type: "continuation" },
      stop: createTargetStop({
        continueAfterTargetsUntilGraphX: { graphX: 3, type: "value" },
        shouldCollectVisiblePixels: true,
        shouldStopOnTargetsComplete: false,
      }),
    });
    expect(continued?.startType).toBe("continuation");
    expect(continued?.visiblePixels).toHaveLength((continued?.points.length ?? 0) - 1);

    const firstObserved = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop: { observationXs: [3], stopX: 2, type: "stop-x-observations" },
    });
    expect(firstObserved).toBeDefined();
    if (!firstObserved) {
      return;
    }
    const continuedObserved = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { evidence: firstObserved.continuationEvidence, type: "continuation" },
      stop: { observationXs: [3], stopX: 3, type: "stop-x-observations" },
    });
    expect(continuedObserved?.startType).toBe("continuation");
    expect(continuedObserved?.observations[0]?.sampleIndex).toBeGreaterThan(
      firstObserved.continuationEvidence.state.sampleIndex,
    );
  });

  it("records ordered observation states from real accepted points", async () => {
    const result = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor: createDescriptor("pchip", "y"),
      start: { type: "cold" },
      stop: { observationXs: [1, 1.001], stopX: 2, type: "stop-x-observations" },
    });
    expect(result?.observations).toHaveLength(2);
    expect(result?.observations[0]?.x).toBeGreaterThanOrEqual(1);
    expect(result?.observations[1]?.x).toBeGreaterThanOrEqual(1.001);
    expect(result?.points[result.observations[0]?.sampleIndex ?? -1]).toEqual(
      result?.observations[0] ? createGraphPoint(result.observations[0].x, result.observations[0].y) : undefined,
    );
  });

  it("stops on an initial obstacle without publishing provisional points", async () => {
    const runtime = await createRuntime();
    const mask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT).fill(1);
    const result = runGraphwarWasmTrajectory(runtime, {
      descriptor: createDescriptor("pchip", "y"),
      start: { type: "cold" },
      stop: createTargetStop({ collision: { boundaryExpansion: 0, mask, type: "mask" } }),
    });
    expect(result?.stopReason).toBe(6);
    expect(result?.points).toEqual(result ? [result.launchPoint] : undefined);
  });

  it("does not confuse second-order launch flags with an obstacle hit", async () => {
    const result = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor: createDescriptor("pchip", "ddy"),
      start: { type: "cold" },
      stop: { observationXs: [], stopX: 3, type: "stop-x-observations" },
    });
    expect(result?.obstacle).toEqual({ type: "none" });
  });

  it("does not apply boundary expansion without a collision mask", async () => {
    const result = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor: createDescriptor("pchip", "y"),
      start: { type: "cold" },
      stop: createTargetStop({
        continueAfterTargetsUntilGraphX: { graphX: 1, type: "value" },
        shouldStopOnTargetsComplete: false,
      }),
    });
    expect(result?.stopReason).toBe(1);
    expect(result?.obstacle).toEqual({ type: "none" });
  });

  it("updates the terminal state but excludes an out-of-bounds trial from stable points", async () => {
    const runtime = await createRuntime();
    const descriptor = {
      ...createDescriptor("pchip", "y"),
      bounds: { maxX: 1, maxY: 10, minX: -1, minY: -10 },
      points: [createGraphPoint(-0.9, 0), createGraphPoint(0.9, 0)],
      soldierCenter: createGraphPoint(-0.9, 0),
    } satisfies GraphwarWasmFormulaInputDescriptor;
    const result = runGraphwarWasmTrajectory(runtime, {
      descriptor,
      start: { type: "cold" },
      stop: { type: "natural" },
    });
    expect(result?.stopReason).toBe(4);
    expect(result?.continuationEvidence.state.currentPoint.x).toBeGreaterThan(descriptor.bounds.maxX);
    expect(result?.points.at(-1)?.x).toBeLessThanOrEqual(descriptor.bounds.maxX);
  });

  it("keeps the first natural out-of-bounds trial only in the terminal state", async () => {
    const maxX = GRAPHWAR_GAME_SOLDIER_RADIUS + 0.01;
    const descriptor = {
      ...createDescriptor("pchip", "y"),
      bounds: { maxX, maxY: 1, minX: -1, minY: -1 },
      points: [createGraphPoint(0, 0), createGraphPoint(1, 0)],
      soldierCenter: createGraphPoint(0, 0),
    } satisfies GraphwarWasmFormulaInputDescriptor;
    const result = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop: { type: "natural" },
    });
    expect(result?.stopReason).toBe(4);
    expect(result?.continuationEvidence.state.currentPoint.x).toBe(maxX + 0.01);
    expect(result?.points.at(-1)?.x).toBe(maxX);
    expect(result?.continuationEvidence.state.sampleIndex).toBe(2);
  });

  it("preserves the graph-to-image-to-plane collision rounding boundary", async () => {
    const descriptor = {
      ...createDescriptor("pchip", "y"),
      bounds: { maxX: 175, maxY: 1, minX: 0, minY: -1 },
      points: [createGraphPoint(0, 0), createGraphPoint(200, 0)],
      soldierCenter: createGraphPoint(0, 0),
    } satisfies GraphwarWasmFormulaInputDescriptor;
    const mask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    mask[225 * GRAPHWAR_PLANE_LENGTH + 1] = 1;
    const result = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop: createTargetStop({
        boundsRect: { height: 450, width: 785, x: 17, y: 0 },
        collision: { boundaryExpansion: 0, mask, type: "mask" },
      }),
    });
    expect(result).toBeDefined();
    if (!result) {
      return;
    }
    expect(result.launchPoint.x / descriptor.bounds.maxX).toBe(2 / GRAPHWAR_PLANE_LENGTH);
    expect(result.stopReason).toBe(6);
    expect(result.obstacle).toEqual({ sampleIndex: 0, type: "hit" });
  });

  it("returns finite and positive-infinity path errors without treating them as faults", async () => {
    const descriptor = createDescriptor("pchip", "y");
    const finite = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop: createTargetStop({
        continueAfterTargetsUntilGraphX: { graphX: 1, type: "value" },
        qualityPoints: [descriptor.points[0]],
        shouldStopOnTargetsComplete: false,
      }),
    });
    const infinite = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop: createTargetStop({
        continueAfterTargetsUntilGraphX: { graphX: 1, type: "value" },
        qualityPoints: [createGraphPoint(20, 0)],
        shouldStopOnTargetsComplete: false,
      }),
    });
    expect(Number.isFinite(finite?.pathError)).toBe(true);
    expect(infinite?.pathError).toBe(Number.POSITIVE_INFINITY);
  });

  it("preserves target-before-obstacle ordering in the production stop tracker", async () => {
    const descriptor = createDescriptor("pchip", "y");
    const baseline = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop: { observationXs: [], stopX: 3, type: "stop-x-observations" },
    });
    const targetPoint = baseline?.points[3];
    expect(targetPoint).toBeDefined();
    if (!targetPoint) {
      return;
    }
    const targetCenter = createGraphPoint(
      ((targetPoint.x - bounds.minX) / (bounds.maxX - bounds.minX)) * GRAPHWAR_PLANE_LENGTH,
      ((bounds.maxY - targetPoint.y) / (bounds.maxY - bounds.minY)) * GRAPHWAR_PLANE_HEIGHT,
    );
    const mask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    mask[
      javaPixelCoordinateForTest(targetCenter.y) * GRAPHWAR_PLANE_LENGTH + javaPixelCoordinateForTest(targetCenter.x)
    ] = 1;
    const result = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop: {
        ...createTargetStop({ collision: { boundaryExpansion: 0, mask, type: "mask" } }),
        orderedTargets: [{ center: targetCenter, radius: 0.25 }],
        trackedTargets: [{ center: targetCenter, radius: 0.25 }],
      },
    });
    expect(result?.stopReason).toBe(7);
    expect(result?.reachedTargetCount).toBe(1);
    expect(result?.targetHitIndex).toBe(3);
    expect(result?.obstacle).toEqual({ type: "none" });
    expect(result?.trackedTargetHitIndexes).toEqual([3]);
  });

  it("matches ordered, required, tracked, and visible target state in one stop pass", async () => {
    const descriptor = createDescriptor("pchip", "y");
    const baseline = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop: { observationXs: [], stopX: 1, type: "stop-x-observations" },
    });
    const requiredPoint = baseline?.points[2];
    const orderedPoint = baseline?.points[3];
    expect(requiredPoint).toBeDefined();
    expect(orderedPoint).toBeDefined();
    if (!requiredPoint || !orderedPoint) {
      return;
    }
    const toPixel = (point: GraphPoint) =>
      createGraphPoint(
        ((point.x - bounds.minX) / (bounds.maxX - bounds.minX)) * GRAPHWAR_PLANE_LENGTH,
        ((bounds.maxY - point.y) / (bounds.maxY - bounds.minY)) * GRAPHWAR_PLANE_HEIGHT,
      );
    const requiredTarget = { center: toPixel(requiredPoint), radius: 0.01 };
    const orderedTarget = { center: toPixel(orderedPoint), radius: 0.01 };
    const result = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop: createTargetStop({
        orderedTargets: [orderedTarget],
        requiredTargets: [requiredTarget],
        shouldCollectVisiblePixels: true,
        trackedTargets: [requiredTarget, orderedTarget],
      }),
    });
    expect(result).toBeDefined();
    if (!result) {
      return;
    }
    expect(result.stopReason).toBe(7);
    expect(result.reachedTargetCount).toBe(1);
    expect(result.reachedRequiredTargetCount).toBe(1);
    expect(result.targetHitIndex).toBe(3);
    expect(result.requiredTargetsHitIndex).toBe(2);
    expect(result.trackedTargetHitIndexes).toEqual([2, 3]);
    expect(result.visiblePixels).toHaveLength(result.points.length);
  });

  it("skips target hits at sample zero but checks the first accepted point", async () => {
    const descriptor = createDescriptor("pchip", "y");
    const baseline = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop: { observationXs: [], stopX: 1, type: "stop-x-observations" },
    });
    const firstAcceptedPoint = baseline?.points[1];
    expect(firstAcceptedPoint).toBeDefined();
    if (!firstAcceptedPoint) {
      return;
    }
    const target = {
      center: createGraphPoint(
        ((firstAcceptedPoint.x - bounds.minX) / (bounds.maxX - bounds.minX)) * GRAPHWAR_PLANE_LENGTH,
        ((bounds.maxY - firstAcceptedPoint.y) / (bounds.maxY - bounds.minY)) * GRAPHWAR_PLANE_HEIGHT,
      ),
      radius: 0.01,
    };
    const result = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop: createTargetStop({ orderedTargets: [target] }),
    });
    expect(result?.stopReason).toBe(7);
    expect(result?.targetHitIndex).toBe(1);
  });

  it("stops on completed targets before a later continuation frontier", async () => {
    const descriptor = createDescriptor("pchip", "y");
    const baseline = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop: { observationXs: [], stopX: 1, type: "stop-x-observations" },
    });
    const firstAcceptedPoint = baseline?.points[1];
    expect(firstAcceptedPoint).toBeDefined();
    if (!firstAcceptedPoint) {
      return;
    }
    const target = {
      center: createGraphPoint(
        ((firstAcceptedPoint.x - bounds.minX) / (bounds.maxX - bounds.minX)) * GRAPHWAR_PLANE_LENGTH,
        ((bounds.maxY - firstAcceptedPoint.y) / (bounds.maxY - bounds.minY)) * GRAPHWAR_PLANE_HEIGHT,
      ),
      radius: 0.01,
    };
    const result = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop: createTargetStop({
        continueAfterTargetsUntilGraphX: { graphX: 10, type: "value" },
        orderedTargets: [target],
        shouldStopOnTargetsComplete: true,
      }),
    });
    expect(result?.stopReason).toBe(7);
    expect(result?.targetHitIndex).toBe(1);
    expect(result?.points).toHaveLength(2);
  });

  it("returns max-steps for a long finite natural trajectory", async () => {
    const descriptor = {
      ...createDescriptor("pchip", "y"),
      bounds: { maxX: 1e9, maxY: 1e9, minX: -1e9, minY: -1e9 },
      points: [createGraphPoint(0, 0), createGraphPoint(1, 0)],
      soldierCenter: createGraphPoint(0, 0),
    } satisfies GraphwarWasmFormulaInputDescriptor;
    const result = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop: { type: "natural" },
    });
    expect(result?.stopReason).toBe(3);
    expect(result?.points).toHaveLength(GRAPHWAR_FUNC_MAX_STEPS);
  });

  it("returns too-steep before publishing a y segment that remains overlong at minimum step", async () => {
    const descriptor = {
      ...createDescriptor("pchip", "y"),
      bounds: { maxX: 1e9, maxY: 1e9, minX: -1e9, minY: -1e9 },
      points: [createGraphPoint(0, 0), createGraphPoint(1, 1_000_000)],
      soldierCenter: createGraphPoint(0, 0),
    } satisfies GraphwarWasmFormulaInputDescriptor;
    const result = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop: { type: "natural" },
    });
    expect(result?.stopReason).toBe(5);
    expect(result?.points).toEqual(result ? [result.launchPoint] : undefined);
  });

  it("returns numerical invalid when a valid second-order launch produces a non-finite trial", async () => {
    const descriptor = {
      ...createDescriptor("pchip", "ddy"),
      bounds: { maxX: 1e308, maxY: 1e308, minX: -1e308, minY: -1e308 },
      points: [createGraphPoint(0, 0), createGraphPoint(1, 1e308)],
      secondOrderLaunchAngle: { degrees: 0, radians: 0 },
      soldierCenter: createGraphPoint(0, 0),
    } satisfies GraphwarWasmFormulaInputDescriptor;
    const result = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop: { type: "natural" },
    });
    expect(result?.stopReason).toBe(2);
    expect(result?.points.length).toBeGreaterThan(1);
    expect(result?.continuationEvidence.state.currentPoint).toEqual(result?.points.at(-1));
  });

  it("checks the Java-mapped mask cell before classifying a non-finite trial", async () => {
    const descriptor = {
      ...createDescriptor("pchip", "ddy"),
      bounds: { maxX: 1e308, maxY: 1e308, minX: -1e308, minY: -1e308 },
      points: [createGraphPoint(0, 0), createGraphPoint(1, 1e308)],
      secondOrderLaunchAngle: { degrees: 0, radians: 0 },
      soldierCenter: createGraphPoint(0, 0),
    } satisfies GraphwarWasmFormulaInputDescriptor;
    const mask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    mask[0] = 1;
    const result = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop: createTargetStop({
        collision: { boundaryExpansion: 0, mask, type: "mask" },
      }),
    });
    const emptyMaskResult = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop: createTargetStop({
        collision: {
          boundaryExpansion: 0,
          mask: new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT),
          type: "mask",
        },
      }),
    });
    expect(result?.stopReason).toBe(6);
    expect(result?.obstacle).toEqual({ sampleIndex: 0, type: "hit" });
    expect(emptyMaskResult?.stopReason).toBe(2);
    expect(emptyMaskResult?.obstacle).toEqual({ type: "none" });
    expect(emptyMaskResult?.points.length).toBeGreaterThan(1);
  });

  it("loads an interior Java-mapped mask cell rather than relying on boundary expansion", async () => {
    const descriptor = createDescriptor("pchip", "y");
    const baseline = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop: { type: "natural" },
    });
    const launchPoint = baseline?.points[0];
    expect(launchPoint).toBeDefined();
    if (!launchPoint) {
      return;
    }
    const pixelX = javaPixelCoordinateForTest(
      ((launchPoint.x - bounds.minX) / (bounds.maxX - bounds.minX)) * GRAPHWAR_PLANE_LENGTH,
    );
    const pixelY = javaPixelCoordinateForTest(
      ((bounds.maxY - launchPoint.y) / (bounds.maxY - bounds.minY)) * GRAPHWAR_PLANE_HEIGHT,
    );
    expect(pixelX).toBeGreaterThan(0);
    expect(pixelX).toBeLessThan(GRAPHWAR_PLANE_LENGTH);
    expect(pixelY).toBeGreaterThan(0);
    expect(pixelY).toBeLessThan(GRAPHWAR_PLANE_HEIGHT);
    const mask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    mask[pixelY * GRAPHWAR_PLANE_LENGTH + pixelX] = 1;
    const result = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop: createTargetStop({ collision: { boundaryExpansion: 0, mask, type: "mask" } }),
    });
    expect(result?.stopReason).toBe(6);
    expect(result?.obstacle).toEqual({ sampleIndex: 0, type: "hit" });
  });

  it("reuses the arena high-water mark across long-lived large and small formula/trajectory commands", async () => {
    const runtime = await createRuntime(1_024);
    const program = parseGraphwarExpressionProgram("x+y+y'");
    if (!program) {
      throw new Error("Expected the soak expression to parse");
    }
    const largeValues = Array.from({ length: 32_768 }, (_, index) => ({
      dy: index / 7,
      x: index / 3,
      y: index / 5,
    }));
    const descriptor = createDescriptor("pchip", "y");
    const runLargeCommands = () => {
      runGraphwarWasmExpressionBatch(runtime, { program, values: largeValues });
      runGraphwarWasmTrajectory(runtime, {
        descriptor,
        start: { type: "cold" },
        stop: { observationXs: [], stopX: 20, type: "stop-x-observations" },
      });
    };
    const runSmallCommands = () => {
      runGraphwarWasmExpressionBatch(runtime, { program, values: [{ dy: 0, x: 0, y: 0 }] });
      runGraphwarWasmTrajectory(runtime, {
        descriptor,
        start: { type: "cold" },
        stop: { observationXs: [], stopX: 1, type: "stop-x-observations" },
      });
    };

    runLargeCommands();
    const stableByteLength = runtime.buffer.byteLength;
    const stableDiagnostics = runtime.getArenaDiagnostics();
    for (let iteration = 0; iteration < 3; iteration += 1) {
      runSmallCommands();
      runLargeCommands();
      expect(runtime.buffer.byteLength).toBe(stableByteLength);
      expect(runtime.getArenaDiagnostics()).toEqual(stableDiagnostics);
    }
    expect(stableDiagnostics).toMatchObject({
      allocatorCallCount: 1,
      cursor: runtime.arenaBase,
      isCanaryIntact: true,
    });
    expect(stableDiagnostics.peakUsedBytes).toBeGreaterThan(65_536);
  });

  it("refreshes trajectory result views after the export grows memory", async () => {
    const descriptor = createDescriptor("pchip", "y");
    const stop = { observationXs: [1, 2], stopX: 3, type: "stop-x-observations" } as const;
    const baseline = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop,
    });
    const runtime = await createRuntime();
    const runTrajectory = runtime.runTrajectory.bind(runtime);
    vi.spyOn(runtime, "runTrajectory").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runTrajectory(inputPointer, inputByteLength);
      const previousBuffer = runtime.buffer;
      runtime.reserveArena(previousBuffer.byteLength, 8);
      expect(runtime.buffer).not.toBe(previousBuffer);
      return resultPointer;
    });
    const grown = runGraphwarWasmTrajectory(runtime, {
      descriptor,
      start: { type: "cold" },
      stop,
    });
    expect(grown).toEqual(baseline);
  });

  it.each([
    {
      label: "boundary expansion without a mask",
      mutate: (view: DataView, inputPointer: number) => view.setUint32(inputPointer + 220, 1, true),
      stop: createTargetStop({ shouldStopOnTargetsComplete: false }),
    },
    {
      label: "observation count whose byte length exceeds memory32",
      mutate: (view: DataView, inputPointer: number) => view.setUint32(inputPointer + 260, 0x4000_0000, true),
      stop: { observationXs: [], stopX: 3, type: "stop-x-observations" } as const,
    },
  ])("rejects a non-canonical raw trajectory input with $label", async ({ mutate, stop }) => {
    const runtime = await createRuntime();
    const runTrajectory = runtime.runTrajectory.bind(runtime);
    vi.spyOn(runtime, "runTrajectory").mockImplementation((inputPointer, inputByteLength) => {
      mutate(new DataView(runtime.buffer), inputPointer);
      return runTrajectory(inputPointer, inputByteLength);
    });
    expect(() =>
      runGraphwarWasmTrajectory(runtime, {
        descriptor: createDescriptor("pchip", "y"),
        start: { type: "cold" },
        stop,
      }),
    ).toThrowError(GraphwarWasmFault);
  });

  it.each([
    { label: "stop reason", offset: 4, value: 0 },
    { label: "point count", offset: 8, value: 0 },
    { label: "result flags", offset: 96, value: 8 },
    { label: "state flags", offset: 196, value: 0 },
    { label: "evidence byte length", offset: 204, value: 0 },
    { label: "accepted sample count", offset: 212, value: 0 },
    { label: "replay count", offset: 216, value: 0 },
  ])("rejects a malformed trajectory $label", async ({ offset, value }) => {
    const runtime = await createRuntime();
    const runTrajectory = runtime.runTrajectory.bind(runtime);
    vi.spyOn(runtime, "runTrajectory").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runTrajectory(inputPointer, inputByteLength);
      new DataView(runtime.buffer).setUint32(resultPointer + offset, value, true);
      return resultPointer;
    });
    expect(() =>
      runGraphwarWasmTrajectory(runtime, {
        descriptor: createDescriptor("pchip", "y"),
        start: { type: "cold" },
        stop: { observationXs: [], stopX: 3, type: "stop-x-observations" },
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-formula-result" }));
  });

  it("permits replay starts whose invalid launch produced no accepted sample point", async () => {
    const runtime = await createRuntime();
    const runTrajectory = runtime.runTrajectory.bind(runtime);
    let replayCount = 0;
    vi.spyOn(runtime, "runTrajectory").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runTrajectory(inputPointer, inputByteLength);
      const view = new DataView(runtime.buffer);
      replayCount = view.getUint32(resultPointer + 212, true) + 1;
      view.setUint32(resultPointer + 216, replayCount, true);
      return resultPointer;
    });
    expect(
      runGraphwarWasmTrajectory(runtime, {
        descriptor: createDescriptor("pchip", "y"),
        start: { type: "cold" },
        stop: { observationXs: [], stopX: 3, type: "stop-x-observations" },
      }),
    ).toEqual(expect.objectContaining({ replayCount }));
  });

  it("rejects an obstacle result when the stop policy has no collision mask", async () => {
    const runtime = await createRuntime();
    const runTrajectory = runtime.runTrajectory.bind(runtime);
    vi.spyOn(runtime, "runTrajectory").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runTrajectory(inputPointer, inputByteLength);
      const view = new DataView(runtime.buffer);
      view.setInt32(resultPointer + 4, 6, true);
      view.setUint32(resultPointer + 96, view.getUint32(resultPointer + 96, true) | 1, true);
      view.setInt32(resultPointer + 116, 0, true);
      return resultPointer;
    });
    expect(() =>
      runGraphwarWasmTrajectory(runtime, {
        descriptor: createDescriptor("pchip", "y"),
        start: { type: "cold" },
        stop: createTargetStop({
          continueAfterTargetsUntilGraphX: { graphX: 1, type: "value" },
          shouldStopOnTargetsComplete: false,
        }),
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-formula-result" }));
  });

  it.each([
    { label: "ordered-target", offset: 108 },
    { label: "required-target", offset: 112 },
  ])("rejects a completed $label count without its completion index", async ({ offset }) => {
    const runtime = await createRuntime();
    const runTrajectory = runtime.runTrajectory.bind(runtime);
    vi.spyOn(runtime, "runTrajectory").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runTrajectory(inputPointer, inputByteLength);
      new DataView(runtime.buffer).setInt32(resultPointer + offset, -1, true);
      return resultPointer;
    });
    const target = { center: createGraphPoint(0, 0), radius: 10_000 };
    expect(() =>
      runGraphwarWasmTrajectory(runtime, {
        descriptor: createDescriptor("pchip", "y"),
        start: { type: "cold" },
        stop: createTargetStop({ orderedTargets: [target], requiredTargets: [target] }),
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-formula-result" }));
  });

  it.each([
    { label: "ordered-target", offset: 108 },
    { label: "required-target", offset: 112 },
  ])("rejects a $label completion index for an empty target set", async ({ offset }) => {
    const runtime = await createRuntime();
    const runTrajectory = runtime.runTrajectory.bind(runtime);
    vi.spyOn(runtime, "runTrajectory").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runTrajectory(inputPointer, inputByteLength);
      new DataView(runtime.buffer).setInt32(resultPointer + offset, 0, true);
      return resultPointer;
    });
    expect(() =>
      runGraphwarWasmTrajectory(runtime, {
        descriptor: createDescriptor("pchip", "y"),
        start: { type: "cold" },
        stop: createTargetStop({
          continueAfterTargetsUntilGraphX: { graphX: 1, type: "value" },
          shouldStopOnTargetsComplete: false,
        }),
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-formula-result" }));
  });

  it("rejects a stop-x result that has not reached the requested frontier", async () => {
    const runtime = await createRuntime();
    const runTrajectory = runtime.runTrajectory.bind(runtime);
    vi.spyOn(runtime, "runTrajectory").mockImplementation((inputPointer, inputByteLength) => {
      new DataView(runtime.buffer).setFloat64(inputPointer + 184, 1, true);
      return runTrajectory(inputPointer, inputByteLength);
    });
    expect(() =>
      runGraphwarWasmTrajectory(runtime, {
        descriptor: createDescriptor("pchip", "y"),
        start: { type: "cold" },
        stop: { observationXs: [], stopX: 3, type: "stop-x-observations" },
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-formula-result" }));
  });

  it("rejects an omitted observation that accepted points already crossed", async () => {
    const runtime = await createRuntime();
    const runTrajectory = runtime.runTrajectory.bind(runtime);
    vi.spyOn(runtime, "runTrajectory").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runTrajectory(inputPointer, inputByteLength);
      const view = new DataView(runtime.buffer);
      view.setUint32(resultPointer + 128, 0, true);
      view.setUint32(resultPointer + 132, 0, true);
      return resultPointer;
    });
    expect(() =>
      runGraphwarWasmTrajectory(runtime, {
        descriptor: createDescriptor("pchip", "y"),
        start: { type: "cold" },
        stop: { observationXs: [1], stopX: 3, type: "stop-x-observations" },
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-formula-result" }));
  });

  it.each(["y", "dy", "ddy"] as const)("rejects a malformed %s observation derivative", async (equation) => {
    const runtime = await createRuntime();
    const runTrajectory = runtime.runTrajectory.bind(runtime);
    vi.spyOn(runtime, "runTrajectory").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runTrajectory(inputPointer, inputByteLength);
      const view = new DataView(runtime.buffer);
      const observationPointer = view.getUint32(resultPointer + 128, true);
      view.setFloat64(observationPointer + 16, view.getFloat64(observationPointer + 16, true) + 1, true);
      return resultPointer;
    });
    expect(() =>
      runGraphwarWasmTrajectory(runtime, {
        descriptor: createDescriptor("pchip", equation),
        start: { type: "cold" },
        stop: { observationXs: [1], stopX: 3, type: "stop-x-observations" },
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-formula-result" }));
  });

  it("rejects an obstacle index that does not identify the terminal accepted point", async () => {
    const descriptor = createDescriptor("pchip", "y");
    const baseline = runGraphwarWasmTrajectory(await createRuntime(), {
      descriptor,
      start: { type: "cold" },
      stop: { observationXs: [], stopX: 3, type: "stop-x-observations" },
    });
    const obstaclePoint = baseline?.points[3];
    expect(obstaclePoint).toBeDefined();
    if (!obstaclePoint) {
      return;
    }
    const pixelX = javaPixelCoordinateForTest(
      ((obstaclePoint.x - bounds.minX) / (bounds.maxX - bounds.minX)) * GRAPHWAR_PLANE_LENGTH,
    );
    const pixelY = javaPixelCoordinateForTest(
      ((bounds.maxY - obstaclePoint.y) / (bounds.maxY - bounds.minY)) * GRAPHWAR_PLANE_HEIGHT,
    );
    const mask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    mask[pixelY * GRAPHWAR_PLANE_LENGTH + pixelX] = 1;
    const runtime = await createRuntime();
    const runTrajectory = runtime.runTrajectory.bind(runtime);
    vi.spyOn(runtime, "runTrajectory").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runTrajectory(inputPointer, inputByteLength);
      new DataView(runtime.buffer).setInt32(resultPointer + 116, 0, true);
      return resultPointer;
    });
    expect(() =>
      runGraphwarWasmTrajectory(runtime, {
        descriptor,
        start: { type: "cold" },
        stop: createTargetStop({ collision: { boundaryExpansion: 0, mask, type: "mask" } }),
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-formula-result" }));
  });

  it("rejects an out-of-bounds reason whose terminal state remains inside the requested bounds", async () => {
    const runtime = await createRuntime();
    const runTrajectory = runtime.runTrajectory.bind(runtime);
    vi.spyOn(runtime, "runTrajectory").mockImplementation((inputPointer, inputByteLength) => {
      const view = new DataView(runtime.buffer);
      view.setFloat64(inputPointer + 64, -3, true);
      view.setFloat64(inputPointer + 72, -1.5, true);
      return runTrajectory(inputPointer, inputByteLength);
    });
    expect(() =>
      runGraphwarWasmTrajectory(runtime, {
        descriptor: createDescriptor("pchip", "y"),
        start: { type: "cold" },
        stop: { type: "natural" },
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-formula-result" }));
  });

  it("rejects a max-steps reason below the Graphwar sampling limit", async () => {
    const descriptor = {
      ...createDescriptor("pchip", "y"),
      bounds: { maxX: 1e9, maxY: 1e9, minX: -1e9, minY: -1e9 },
      points: [createGraphPoint(0, 0), createGraphPoint(1, 1_000_000)],
      soldierCenter: createGraphPoint(0, 0),
    } satisfies GraphwarWasmFormulaInputDescriptor;
    const runtime = await createRuntime();
    const runTrajectory = runtime.runTrajectory.bind(runtime);
    vi.spyOn(runtime, "runTrajectory").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runTrajectory(inputPointer, inputByteLength);
      new DataView(runtime.buffer).setInt32(resultPointer + 4, 3, true);
      return resultPointer;
    });
    expect(() =>
      runGraphwarWasmTrajectory(runtime, {
        descriptor,
        start: { type: "cold" },
        stop: { type: "natural" },
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-formula-result" }));
  });

  it.each([
    { equation: "y", label: "normal angle", offset: 56, value: Number.POSITIVE_INFINITY },
    { equation: "y", label: "normal initial dy", offset: 80, value: -0 },
    { equation: "dy", label: "first-order initial dy", offset: 80, value: -0 },
    { equation: "dy", label: "first-order y offset", offset: 88, value: -0 },
    { equation: "ddy", label: "second-order y offset", offset: 88, value: -0 },
    { equation: "y", label: "launch point", offset: 64, value: 123 },
  ] as const)("rejects a non-canonical trajectory $label slot", async ({ equation, offset, value }) => {
    const runtime = await createRuntime();
    const runTrajectory = runtime.runTrajectory.bind(runtime);
    vi.spyOn(runtime, "runTrajectory").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runTrajectory(inputPointer, inputByteLength);
      new DataView(runtime.buffer).setFloat64(resultPointer + offset, value, true);
      return resultPointer;
    });
    expect(() =>
      runGraphwarWasmTrajectory(runtime, {
        descriptor: createDescriptor("step", equation),
        start: { type: "cold" },
        stop: { observationXs: [], stopX: 3, type: "stop-x-observations" },
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-formula-result" }));
  });

  it.each([
    { equation: "y", label: "current x", offset: 32, value: Number.NaN },
    { equation: "y", label: "current y", offset: 40, value: Number.POSITIVE_INFINITY },
    { equation: "ddy", label: "current derivative", offset: 48, value: Number.NaN },
    { equation: "y", label: "previous x", offset: 168, value: Number.NaN },
    { equation: "y", label: "previous y", offset: 176, value: Number.NEGATIVE_INFINITY },
    { equation: "ddy", label: "previous derivative", offset: 184, value: Number.NaN },
  ] as const)("rejects a malformed trajectory $label", async ({ equation, offset, value }) => {
    const runtime = await createRuntime();
    const runTrajectory = runtime.runTrajectory.bind(runtime);
    vi.spyOn(runtime, "runTrajectory").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runTrajectory(inputPointer, inputByteLength);
      new DataView(runtime.buffer).setFloat64(resultPointer + offset, value, true);
      return resultPointer;
    });
    expect(() =>
      runGraphwarWasmTrajectory(runtime, {
        descriptor: createDescriptor("pchip", equation),
        start: { type: "cold" },
        stop: { observationXs: [], stopX: 3, type: "stop-x-observations" },
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-finite-number" }));
  });

  it("rejects a trajectory sample index inconsistent with its physical state", async () => {
    const runtime = await createRuntime();
    const runTrajectory = runtime.runTrajectory.bind(runtime);
    vi.spyOn(runtime, "runTrajectory").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runTrajectory(inputPointer, inputByteLength);
      new DataView(runtime.buffer).setUint32(resultPointer + 192, 0, true);
      return resultPointer;
    });
    expect(() =>
      runGraphwarWasmTrajectory(runtime, {
        descriptor: createDescriptor("pchip", "y"),
        start: { type: "cold" },
        stop: { observationXs: [], stopX: 3, type: "stop-x-observations" },
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-formula-result" }));
  });

  it("rejects a malformed trajectory evidence proof", async () => {
    const runtime = await createRuntime();
    const runTrajectory = runtime.runTrajectory.bind(runtime);
    vi.spyOn(runtime, "runTrajectory").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runTrajectory(inputPointer, inputByteLength);
      const view = new DataView(runtime.buffer);
      const evidencePointer = view.getUint32(resultPointer + 200, true);
      view.setUint32(evidencePointer + 16, view.getUint32(evidencePointer + 16, true) ^ 1, true);
      return resultPointer;
    });
    expect(() =>
      runGraphwarWasmTrajectory(runtime, {
        descriptor: createDescriptor("pchip", "y"),
        start: { type: "cold" },
        stop: { observationXs: [], stopX: 3, type: "stop-x-observations" },
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-formula-result" }));
  });

  it.each([Number.NaN, Number.NEGATIVE_INFINITY, -1])("rejects malformed path error %s", async (pathError) => {
    const runtime = await createRuntime();
    const runTrajectory = runtime.runTrajectory.bind(runtime);
    vi.spyOn(runtime, "runTrajectory").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runTrajectory(inputPointer, inputByteLength);
      new DataView(runtime.buffer).setFloat64(resultPointer + 160, pathError, true);
      return resultPointer;
    });
    expect(() =>
      runGraphwarWasmTrajectory(runtime, {
        descriptor: createDescriptor("pchip", "y"),
        start: { type: "cold" },
        stop: createTargetStop({
          continueAfterTargetsUntilGraphX: { graphX: 1, type: "value" },
          qualityPoints: [createGraphPoint(20, 0)],
          shouldStopOnTargetsComplete: false,
        }),
      }),
    ).toThrowError(GraphwarWasmAdapterError);
  });

  it.each([
    {
      label: "tracked-target count",
      mutate: (runtime: GraphwarWasmKernelRuntime, resultPointer: number) => {
        new DataView(runtime.buffer).setUint32(resultPointer + 124, 0, true);
      },
    },
    {
      label: "tracked-target index",
      mutate: (runtime: GraphwarWasmKernelRuntime, resultPointer: number) => {
        const view = new DataView(runtime.buffer);
        view.setInt32(view.getUint32(resultPointer + 120, true), 0x7fff_ffff, true);
      },
    },
  ])("rejects a malformed trajectory $label", async ({ mutate }) => {
    const runtime = await createRuntime();
    const runTrajectory = runtime.runTrajectory.bind(runtime);
    vi.spyOn(runtime, "runTrajectory").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runTrajectory(inputPointer, inputByteLength);
      mutate(runtime, resultPointer);
      return resultPointer;
    });
    expect(() =>
      runGraphwarWasmTrajectory(runtime, {
        descriptor: createDescriptor("pchip", "y"),
        start: { type: "cold" },
        stop: createTargetStop({
          continueAfterTargetsUntilGraphX: { graphX: 1, type: "value" },
          shouldStopOnTargetsComplete: false,
          trackedTargets: [{ center: createGraphPoint(100, 100), radius: 1 }],
        }),
      }),
    ).toThrowError(GraphwarWasmAdapterError);
  });

  it("differentially matches complete TS trajectories for all formula modes", async () => {
    for (const algorithm of ["abs", "step", "pchip", "akima"] as const) {
      for (const equation of ["y", "dy", "ddy"] as const) {
        const descriptor = createDescriptor(algorithm, equation);
        const runtime = await createRuntime();
        const launch = prepareGraphwarWasmFormulaLaunch(runtime, descriptor);
        expect(launch.status, `${algorithm}:${equation} launch`).toBe("success");
        if (launch.status !== "success") {
          continue;
        }
        const wasm = runGraphwarWasmTrajectory(runtime, {
          descriptor,
          start: { type: "cold" },
          stop: { observationXs: [], stopX: 3, type: "stop-x-observations" },
        });
        expect(wasm, `${algorithm}:${equation} WASM result`).toBeDefined();
        if (!wasm) {
          continue;
        }
        const debugMetrics = createGraphwarTrajectoryDebugMetrics();
        const signProtection = [...launch.observedSignProtection];
        const tsResolution = resolveGraphwarTrajectory({
          bounds,
          boundsRect: { height: GRAPHWAR_PLANE_HEIGHT, width: GRAPHWAR_PLANE_LENGTH, x: 0, y: 0 },
          continueAfterTargetsUntilGraphX: 3,
          debugMetrics,
          formulaMode: createGraphwarTrajectoryFormulaMode(descriptor.settings),
          points: descriptor.points.map((point) => createGraphPoint(point.x, point.y)),
          soldierCenter: createGraphPoint(descriptor.soldierCenter.x, descriptor.soldierCenter.y),
        });
        const ts = tsResolution.result.sample;
        expect(wasm.points.length, `${algorithm}:${equation} point count`).toBe(ts.points.length);
        expect(wasm.stopReason, `${algorithm}:${equation} stop reason`).toBe(1);
        expect(ts.stopReason, `${algorithm}:${equation} TS stop reason`).toBe("stopped");
        expect(
          {
            acceptedSamplePointCount: wasm.acceptedSamplePointCount,
            bisectionCount: wasm.bisectionCount,
            replayCount: wasm.replayCount,
            rk4StepCount: wasm.rk4StepCount,
          },
          `${algorithm}:${equation} debug counters`,
        ).toEqual({
          acceptedSamplePointCount: debugMetrics.counters.acceptedSamplePointCount,
          bisectionCount: debugMetrics.counters.stepBisectionCount,
          replayCount: debugMetrics.counters.trajectoryReplayCount,
          rk4StepCount: debugMetrics.counters.rk4StepCount,
        });
        expect(wasm.minStepJumpCount, `${algorithm}:${equation} minimum-step jumps`).toBe(0);
        expect(wasm.continuationEvidence.observedSignProtection, `${algorithm}:${equation} protection`).toEqual(
          signProtection,
        );
        expect(wasm.continuationEvidence.state.sampleIndex, `${algorithm}:${equation} sample index`).toBe(
          ts.endState?.sampleIndex,
        );
        expect(wasm.continuationEvidence.state.currentPoint, `${algorithm}:${equation} current point`).toEqual(
          ts.endState?.currentPoint,
        );
        expect(
          getGraphwarWasmTestPreviousPoint(wasm.continuationEvidence.state),
          `${algorithm}:${equation} previous point`,
        ).toEqual(ts.endState?.previousPoint);
        if (equation === "ddy" && wasm.continuationEvidence.state.equation === "ddy") {
          expect(wasm.continuationEvidence.state.currentDy, `${algorithm}:${equation} current dy`).toBe(
            ts.endState?.dy,
          );
          expect(wasm.continuationEvidence.state.previous?.dy, `${algorithm}:${equation} previous dy`).toBe(
            ts.endState?.previousDy,
          );
        }
        for (let index = 0; index < ts.points.length; index += 1) {
          expect(
            Math.abs(wasm.points[index].x - ts.points[index].x),
            `${algorithm}:${equation}:${index}:x`,
          ).toBeLessThanOrEqual(1e-12);
          expect(
            Math.abs(wasm.points[index].y - ts.points[index].y),
            `${algorithm}:${equation}:${index}:y`,
          ).toBeLessThanOrEqual(1e-12);
        }
      }
    }
  });

  it.each([
    {
      algorithm: "abs",
      equation: "dy",
      label: "ABS first-order post-refinement launch identity",
      points: [
        createGraphPoint(-1.341283624060452, 5.0580352419056),
        createGraphPoint(-1.0872874894645066, 1.1070912964642048),
        createGraphPoint(1.0133794643450527, 2.2286983393132687),
        createGraphPoint(2.887202304601669, -0.962669488042593),
        createGraphPoint(4.863218688312918, -0.012183446437120438),
        createGraphPoint(5.915760804666206, 6.822678226977587),
      ],
      stopX: 6.665760804666206,
    },
    {
      algorithm: "step",
      equation: "ddy",
      label: "Step second-order two-point replay ownership",
      points: [
        createGraphPoint(-3.5380588804837316, -1.165888569317758),
        createGraphPoint(-0.47953188584651807, -2.413776397705078),
      ],
      stopX: 0.27046811415348193,
    },
    {
      algorithm: "step",
      equation: "ddy",
      label: "Step second-order multi-segment boundary reuse",
      points: [
        createGraphPoint(-3.0906359646469355, -2.897300101350993),
        createGraphPoint(-1.977198375063017, 0.13732606545090675),
        createGraphPoint(-1.2920960109215232, -0.7364090271294117),
        createGraphPoint(-1.023707421217114, -3.001071374863386),
        createGraphPoint(2.0677895042113956, -5.732403222471476),
      ],
      stopX: 2.8177895042113956,
    },
    {
      algorithm: "step",
      equation: "ddy",
      label: "Step second-order first-segment candidate fixed-point identity",
      points: [
        createGraphPoint(-2.5288573056459427, 0.007110160309821367),
        createGraphPoint(-2.0427219743374736, 7.947813186794519),
        createGraphPoint(-1.559820193378255, -4.968278635293245),
        createGraphPoint(1.1674214483238754, -5.851921629160643),
      ],
      stopX: 1.9174214483238754,
    },
  ] as const)("matches the TS trajectory for $label", async ({ algorithm, equation, points, stopX }) => {
    await expectGraphwarWasmTrajectoryToMatchTypescript({
      descriptor: {
        ...createDescriptor(algorithm, equation),
        points,
        soldierCenter: points[0],
      },
      stopX,
    });
  });
});

async function expectGraphwarWasmTrajectoryToMatchTypescript(options: {
  descriptor: GraphwarWasmFormulaInputDescriptor;
  stopX: number;
}) {
  const debugMetrics = createGraphwarTrajectoryDebugMetrics();
  const wasm = runGraphwarWasmTrajectory(await createRuntime(), {
    descriptor: options.descriptor,
    start: { type: "cold" },
    stop: { observationXs: [], stopX: options.stopX, type: "stop-x-observations" },
  });
  const ts = resolveGraphwarTrajectory({
    bounds,
    boundsRect: { height: GRAPHWAR_PLANE_HEIGHT, width: GRAPHWAR_PLANE_LENGTH, x: 0, y: 0 },
    continueAfterTargetsUntilGraphX: options.stopX,
    debugMetrics,
    formulaMode: createGraphwarTrajectoryFormulaMode(options.descriptor.settings),
    points: options.descriptor.points.map((point) => createGraphPoint(point.x, point.y)),
    soldierCenter: createGraphPoint(options.descriptor.soldierCenter.x, options.descriptor.soldierCenter.y),
  }).result.sample;
  expect(wasm?.points.length).toBe(ts.points.length);
  expect(wasm?.stopReason).toBe(1);
  expect(ts.stopReason).toBe("stopped");
  expect({
    acceptedSamplePointCount: wasm?.acceptedSamplePointCount,
    bisectionCount: wasm?.bisectionCount,
    replayCount: wasm?.replayCount,
    rk4StepCount: wasm?.rk4StepCount,
  }).toEqual({
    acceptedSamplePointCount: debugMetrics.counters.acceptedSamplePointCount,
    bisectionCount: debugMetrics.counters.stepBisectionCount,
    replayCount: debugMetrics.counters.trajectoryReplayCount,
    rk4StepCount: debugMetrics.counters.rk4StepCount,
  });
  for (let index = 0; index < ts.points.length; index += 1) {
    expect(Math.abs((wasm?.points[index]?.x ?? Number.NaN) - ts.points[index].x)).toBeLessThanOrEqual(1e-12);
    expect(Math.abs((wasm?.points[index]?.y ?? Number.NaN) - ts.points[index].y)).toBeLessThanOrEqual(1e-12);
  }
}

function getGraphwarWasmTestPreviousPoint(state: GraphwarWasmTrajectoryPhysicalState) {
  return state.equation === "ddy" ? state.previous?.point : state.previousPoint;
}

function createDescriptor(algorithm: AlgorithmMode, equation: EquationMode): GraphwarWasmFormulaInputDescriptor {
  return {
    bounds,
    points,
    settings: {
      algorithm,
      decimalPlaces: 4,
      equation,
      formulaPathSteepness: algorithm === "step" ? 7.5 : undefined,
      isStepGlitchModeEnabled: false,
      isStepOverflowProtectionEnabled: true,
      secondOrderLaunchAngleMode: "full-precision",
      steepness: 3.25,
    },
    soldierCenter: points[0],
  };
}

function createTargetStop(
  overrides: Partial<Extract<GraphwarWasmStopPolicy, { type: "targets" }>> = {},
): Extract<GraphwarWasmStopPolicy, { type: "targets" }> {
  return {
    boundsRect: { height: GRAPHWAR_PLANE_HEIGHT, width: GRAPHWAR_PLANE_LENGTH, x: 0, y: 0 },
    collision: { type: "none" },
    continueAfterTargetsUntilGraphX: { type: "none" },
    orderedTargets: [],
    qualityPoints: [],
    requiredTargets: [],
    shouldCollectVisiblePixels: false,
    shouldStopOnTargetsComplete: true,
    trackedTargets: [],
    type: "targets",
    ...overrides,
  };
}

function createFormulaEvaluation(
  equation: EquationMode,
  algorithm: AlgorithmMode = "step",
  segmentCount = points.length - 1,
) {
  return {
    equation,
    formulaDecimalPlaces: 4,
    isStepOverflowProtectionEnabled: true,
    signProtection: Array.from(
      { length: segmentCount },
      () => GraphwarSignRole.StartX | GraphwarSignRole.EndX | GraphwarSignRole.CenterX,
    ),
    ...(algorithm === "step" ? { stepOverflowProtectionRange: { maxX: bounds.maxX, minX: points[0].x } } : {}),
  } satisfies FormulaEvaluationOptions;
}

async function createRuntime(initialArenaCapacity = 65_536) {
  return instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity });
}

function writeMalformedInvalidLaunch(runtime: GraphwarWasmKernelRuntime) {
  const protectionPointer = runtime.reserveArena(Uint32Array.BYTES_PER_ELEMENT * 3, Uint32Array.BYTES_PER_ELEMENT);
  new Uint32Array(runtime.buffer, protectionPointer, 3).fill(0);
  const resultPointer = runtime.reserveArena(80, 8);
  new Uint8Array(runtime.buffer, resultPointer, 80).fill(0);
  const view = new DataView(runtime.buffer);
  view.setUint32(resultPointer + 48, resultPointer, true);
  view.setUint32(resultPointer + 60, protectionPointer, true);
  view.setUint32(resultPointer + 64, 3, true);
  return resultPointer;
}

function expectFloatEquivalent(
  actual: number,
  expected: number,
  label: string,
  maxUlpDistance = DEFAULT_MAX_ULP_DISTANCE,
) {
  expect(Number.isNaN(actual), `${label} NaN classification`).toBe(Number.isNaN(expected));
  expect(actual === Number.POSITIVE_INFINITY, `${label} +Infinity classification`).toBe(
    expected === Number.POSITIVE_INFINITY,
  );
  expect(actual === Number.NEGATIVE_INFINITY, `${label} -Infinity classification`).toBe(
    expected === Number.NEGATIVE_INFINITY,
  );
  if (Number.isNaN(expected) || !Number.isFinite(expected)) {
    return;
  }
  if (expected === 0) {
    expect(Object.is(actual, expected), `${label} signed zero`).toBe(true);
    return;
  }
  expect(ulpDistance(actual, expected), `${label} ULP distance`).toBeLessThanOrEqual(maxUlpDistance);
}

function expectFormulaValueEquivalent(
  actual: number,
  expected: number,
  algorithm: AlgorithmMode,
  equation: EquationMode,
  label: string,
) {
  const maxUlpDistance =
    equation === "ddy" && (algorithm === "pchip" || algorithm === "akima")
      ? SOFT_CUBIC_DDY_MAX_ULP_DISTANCE
      : DEFAULT_MAX_ULP_DISTANCE;
  expectFloatEquivalent(actual, expected, label, maxUlpDistance);
}

function ulpDistance(left: number, right: number) {
  return orderedFloatBits(left) > orderedFloatBits(right)
    ? orderedFloatBits(left) - orderedFloatBits(right)
    : orderedFloatBits(right) - orderedFloatBits(left);
}

function orderedFloatBits(value: number) {
  const buffer = new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT);
  new DataView(buffer).setFloat64(0, value, false);
  const bits = new DataView(buffer).getBigUint64(0, false);
  return bits >> 63n === 0n ? bits | (1n << 63n) : ~bits;
}

/** Mirrors Java's `(int)` conversion for mask fixture coordinates. */
function javaPixelCoordinateForTest(value: number) {
  if (Number.isNaN(value)) return 0;
  if (value >= 2_147_483_647) return 2_147_483_647;
  if (value <= -2_147_483_648) return -2_147_483_648;
  return Math.trunc(value);
}
