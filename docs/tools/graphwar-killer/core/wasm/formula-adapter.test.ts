import { beforeAll, describe, expect, it, vi } from "vitest";

import { parseGraphwarExpressionProgram } from "../../formula/expression/evaluator";
import { createGraphwarExpressionProgramEvaluator } from "../../formula/expression/program";
import {
  compileFormulaEvaluator,
  compileGraphwarFormulaMaterials,
  GraphwarSignRole,
} from "../../formula/generation/build";
import type { FormulaEvaluationOptions } from "../../formula/generation/step-numeric-strategy";
import { createGraphwarTrajectoryFormulaMode, resolveGraphwarTrajectory } from "../../formula/trajectory/sampling";
import { GraphwarWasmFault } from "../algorithm-backend";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../game/constants";
import { graphwarToolDefaults } from "../tool/defaults";
import { createGraphPoint, type AlgorithmMode, type EquationMode, type GraphPoint } from "../types";
import { GraphwarWasmAdapterError } from "./abi";
import {
  prepareGraphwarWasmFormulaLaunch,
  runGraphwarWasmExpressionBatch,
  runGraphwarWasmFormulaBatch,
} from "./formula-adapter";
import { readGraphwarKernelBytes } from "./kernel-test-fixture";
import { instantiateGraphwarWasmRuntime, type GraphwarWasmKernelRuntime } from "./runtime";
import type { GraphwarWasmFormulaInputDescriptor } from "./task-adapter";

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

  it("packs only raw Step refinement inputs for production launch", async () => {
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
});

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

async function createRuntime() {
  return instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 65_536 });
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
