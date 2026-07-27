import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  compileFormulaEvaluator,
  compileGraphwarFormulaMaterials,
  type CompiledFormulaEvaluator,
} from "../../formula/generation/build";
import type { FormulaEvaluationOptions } from "../../formula/generation/step-numeric-strategy";
import { createGraphPoint, type EquationMode, type GraphBounds, type GraphPoint } from "../types";
import { runGraphwarWasmFormulaBatch, type GraphwarWasmFormulaValue } from "./formula-adapter";
import { instantiateGraphwarWasmRuntime } from "./runtime";
import type { GraphwarWasmFormulaInputDescriptor } from "./task-adapter";

const kernelPath = resolve("packages/graphwar-killer-wasm/build/graphwar-kernel.wasm");
const equations = ["y", "dy", "ddy"] as const satisfies readonly EquationMode[];

interface StepRangeFixture {
  bounds: GraphBounds;
  expectedMaterialKinds: readonly ("direct" | "stable")[];
  isOverflowProtectionEnabled: boolean;
  name: string;
  points: readonly GraphPoint[];
  steepness: number;
  values: readonly GraphwarWasmFormulaValue[];
}

const directPoints = [
  createGraphPoint(-2, 1),
  createGraphPoint(-1, -3),
  createGraphPoint(0, 4),
  createGraphPoint(2, -2),
] as const;
const extremePoints = [
  createGraphPoint(-25, 1),
  createGraphPoint(-24, -3),
  createGraphPoint(0, 4),
  createGraphPoint(24, -2),
] as const;

const fixtures = [
  {
    bounds: { maxX: 5, maxY: 15, minX: -5, minY: -15 },
    expectedMaterialKinds: ["direct", "direct", "direct"],
    isOverflowProtectionEnabled: true,
    name: "enabled protection retains direct materials in a safe range",
    points: directPoints,
    steepness: 3.25,
    values: [
      { dy: -2, x: -2, y: 1 },
      { dy: 0, x: -1, y: -3 },
      { dy: 1.5, x: 0.5, y: 2 },
      { dy: 3, x: 5, y: -4 },
    ],
  },
  {
    bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
    expectedMaterialKinds: ["direct", "stable", "stable"],
    isOverflowProtectionEnabled: true,
    name: "enabled protection selects mixed direct and stable materials in an extreme range",
    points: extremePoints,
    steepness: 210,
    values: [
      { dy: -2, x: -25, y: 1 },
      { dy: 0, x: -24, y: -3 },
      { dy: 1.5, x: 0, y: 4 },
      { dy: 3, x: 24, y: -2 },
      { dy: -4, x: 25, y: 6 },
    ],
  },
  {
    bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
    expectedMaterialKinds: ["direct", "direct", "direct"],
    isOverflowProtectionEnabled: false,
    name: "disabled protection preserves direct materials and overflow classification",
    points: extremePoints,
    steepness: 210,
    values: [
      { dy: -2, x: -25, y: 1 },
      { dy: 0, x: -24, y: -3 },
      { dy: 1.5, x: 0, y: 4 },
      { dy: 3, x: 24, y: -2 },
      { dy: -4, x: 25, y: 6 },
    ],
  },
  {
    bounds: { maxX: -25, maxY: -15, minX: 25, minY: 15 },
    expectedMaterialKinds: ["direct", "stable", "stable"],
    isOverflowProtectionEnabled: true,
    name: "coordinate-mirrored bounds retain the extreme-range material selection",
    points: extremePoints,
    steepness: 210,
    values: [
      { dy: -2, x: -25, y: 1 },
      { dy: 0, x: -24, y: -3 },
      { dy: 1.5, x: 0, y: 4 },
      { dy: 3, x: 24, y: -2 },
      { dy: -4, x: 25, y: 6 },
    ],
  },
] as const satisfies readonly StepRangeFixture[];

let kernelModule: WebAssembly.Module;

beforeAll(async () => {
  kernelModule = await WebAssembly.compile(await readFile(kernelPath));
});

describe("Graphwar WASM Step overflow-range differential", () => {
  for (const equation of equations) {
    for (const fixture of fixtures) {
      it(`${equation}: ${fixture.name}`, async () => {
        const descriptor = createDescriptor(fixture, equation);
        const formulaEvaluation = createFormulaEvaluation(fixture, equation);
        const expectedMaterials = compileGraphwarFormulaMaterials(
          fixture.points,
          fixture.steepness,
          "step",
          formulaEvaluation,
        );
        const expectedEvaluator = compileFormulaEvaluator(
          fixture.points,
          fixture.steepness,
          "step",
          formulaEvaluation,
          expectedMaterials,
        );
        const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 65_536 });
        const actual = runGraphwarWasmFormulaBatch(runtime, {
          descriptor,
          formulaEvaluation,
          values: fixture.values,
        });

        expect(actual.compiledMaterials).toEqual(expectedMaterials);
        expect(actual.compiledMaterials.algorithm).toBe("step");
        if (actual.compiledMaterials.algorithm !== "step") {
          return;
        }
        const actualStepFormula = actual.compiledMaterials.stepFormula;
        expect(actualStepFormula).toBeDefined();
        if (!actualStepFormula) {
          throw new Error("Expected Step materials to include the canonical Step formula descriptor");
        }
        expect(actualStepFormula.equation).toBe(equation);
        expect(
          actualStepFormula.terms.map((term) => (term.isDerivativeOverflowProtected ? "stable" : "direct")),
        ).toEqual(fixture.expectedMaterialKinds);

        for (let index = 0; index < fixture.values.length; index += 1) {
          const value = fixture.values[index];
          expectFloatEquivalent(
            actual.values[index],
            evaluateFormulaValue(expectedEvaluator, equation, value),
            `${equation}:${fixture.name}:${index}`,
          );
        }

        if (fixture.name === "disabled protection preserves direct materials and overflow classification") {
          const firstValue = actual.values[0];
          expect(Number.isNaN(firstValue), `${equation} disabled-protection first value classification`).toBe(
            equation !== "y",
          );
        }
      });
    }
  }

  it("keeps every enabled derivative term stable when the overflow range is absent", async () => {
    const fixture = fixtures[1];
    const descriptor = createDescriptor(fixture, "dy");
    const formulaEvaluation = {
      equation: "dy",
      formulaDecimalPlaces: 4,
      isStepOverflowProtectionEnabled: true,
    } satisfies FormulaEvaluationOptions;
    const expectedMaterials = compileGraphwarFormulaMaterials(
      fixture.points,
      fixture.steepness,
      "step",
      formulaEvaluation,
    );
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 65_536 });
    const actual = runGraphwarWasmFormulaBatch(runtime, { descriptor, formulaEvaluation, values: [] });

    expect(actual.compiledMaterials).toEqual(expectedMaterials);
    expect(actual.compiledMaterials.stepFormula?.terms.every((term) => term.isDerivativeOverflowProtected)).toBe(true);
  });

  it("uses the caller's narrow overflow range instead of reconstructing one from descriptor bounds", async () => {
    const fixture = {
      bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
      expectedMaterialKinds: ["direct"],
      isOverflowProtectionEnabled: true,
      name: "custom narrow range",
      points: [createGraphPoint(-2, 0), createGraphPoint(4, 1)],
      steepness: 210,
      values: [],
    } as const satisfies StepRangeFixture;
    const descriptor = createDescriptor(fixture, "dy");
    const formulaEvaluation = {
      equation: "dy",
      formulaDecimalPlaces: 4,
      isStepOverflowProtectionEnabled: true,
      stepOverflowProtectionRange: { maxX: 5, minX: 3 },
    } satisfies FormulaEvaluationOptions;
    const expectedMaterials = compileGraphwarFormulaMaterials(
      fixture.points,
      fixture.steepness,
      "step",
      formulaEvaluation,
    );
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 65_536 });
    const actual = runGraphwarWasmFormulaBatch(runtime, { descriptor, formulaEvaluation, values: [] });

    expect(actual.compiledMaterials).toEqual(expectedMaterials);
    expect(actual.compiledMaterials.stepFormula?.terms[0]?.isDerivativeOverflowProtected).toBe(false);
  });
});

function createDescriptor(fixture: StepRangeFixture, equation: EquationMode): GraphwarWasmFormulaInputDescriptor {
  return {
    bounds: fixture.bounds,
    points: fixture.points,
    settings: {
      algorithm: "step",
      decimalPlaces: 4,
      equation,
      isStepGlitchModeEnabled: false,
      isStepOverflowProtectionEnabled: fixture.isOverflowProtectionEnabled,
      secondOrderLaunchAngleMode: "full-precision",
      steepness: fixture.steepness,
    },
    soldierCenter: fixture.points[0],
  };
}

function createFormulaEvaluation(fixture: StepRangeFixture, equation: EquationMode) {
  return {
    equation,
    formulaDecimalPlaces: 4,
    isStepOverflowProtectionEnabled: fixture.isOverflowProtectionEnabled,
    stepOverflowProtectionRange: {
      maxX: Math.max(fixture.bounds.minX, fixture.bounds.maxX),
      minX: fixture.points[0].x,
    },
  } satisfies FormulaEvaluationOptions;
}

function evaluateFormulaValue(
  evaluator: CompiledFormulaEvaluator,
  equation: EquationMode,
  value: GraphwarWasmFormulaValue,
) {
  if (equation === "y") {
    return evaluator.evaluateY(value.x);
  }
  if (equation === "dy") {
    return evaluator.evaluateFirstDerivativeY(value.x, value.y);
  }
  return evaluator.evaluateSecondDerivativeY(value.x, value.y, value.dy);
}

function expectFloatEquivalent(actual: number, expected: number, label: string) {
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
  expect(ulpDistance(actual, expected), `${label} ULP distance`).toBeLessThanOrEqual(64n);
}

function ulpDistance(left: number, right: number) {
  const leftBits = orderedFloatBits(left);
  const rightBits = orderedFloatBits(right);
  return leftBits > rightBits ? leftBits - rightBits : rightBits - leftBits;
}

function orderedFloatBits(value: number) {
  const buffer = new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false);
  const bits = view.getBigUint64(0, false);
  return bits >> 63n === 0n ? bits | (1n << 63n) : ~bits;
}
