import { describe, expect, it } from "vitest";

import { formatDoublePrecisionDecimal, nextDownDouble, nextUpDouble } from "../../core/numbers";
import { createGraphPoint } from "../../core/types";
import { createGraphwarExpressionEvaluator } from "../expression/evaluator";
import { buildFormula, compileFormulaEvaluator, compileGraphwarFormulaMaterials, GraphwarSignRole } from "./build";
import { graphwarSignProtectionEquals } from "./sign-protection";

const epsilonText = formatDoublePrecisionDecimal(Number.EPSILON);

describe("Graphwar local sign protection", () => {
  it("keeps source segment identities after zero abs terms are omitted", () => {
    const points = [createGraphPoint(-2, 0), createGraphPoint(0, 0), createGraphPoint(2, 2)];
    const formulaEvaluation = {
      equation: "dy" as const,
      formulaDecimalPlaces: 4,
      signProtection: [0, GraphwarSignRole.StartX],
    };
    const compiledMaterials = compileGraphwarFormulaMaterials(points, 1, "abs", formulaEvaluation);
    const expression = buildFormula(points, 1, "dy", "abs", 4, {
      compiledMaterials,
      signProtection: formulaEvaluation.signProtection,
    }).expression;

    expect(compiledMaterials.absSegments).toHaveLength(1);
    expect(compiledMaterials.absSegments?.[0]?.sourceSegmentIndex).toBe(1);
    expect(countOccurrences(expression, epsilonText)).toBe(1);
  });

  it("reports the exact abs endpoint role and protects no neighboring sign", () => {
    const points = [createGraphPoint(-2, 0), createGraphPoint(0, 2)];
    const zeroSites: [number, GraphwarSignRole][] = [];
    const unprotected = compileFormulaEvaluator(points, 1, "abs", {
      equation: "dy",
      formulaDecimalPlaces: 4,
      onZeroSignArgument: (segmentIndex, role) => zeroSites.push([segmentIndex, role]),
      signProtection: [],
    });

    expect(unprotected.evaluateFirstDerivativeY(-2, 0)).toBeNaN();
    expect(zeroSites).toEqual([[0, GraphwarSignRole.StartX]]);
    expect(
      Number.isFinite(
        compileFormulaEvaluator(points, 1, "abs", {
          equation: "dy",
          formulaDecimalPlaces: 4,
          signProtection: [GraphwarSignRole.StartX],
        }).evaluateFirstDerivativeY(-2, 0),
      ),
    ).toBe(true);
  });

  it("formats only the selected glitch gate role with epsilon", () => {
    const points = [createGraphPoint(-2, 0), createGraphPoint(0, 2)];
    const formulaEvaluation = {
      equation: "dy" as const,
      formulaDecimalPlaces: 4,
      signProtection: [GraphwarSignRole.GateY],
      stepGlitchSegments: [
        {
          derivative: 100.123456,
          endX: -0.990001,
          equation: "dy" as const,
          formulaDecimalPlaces: 6,
          gateY: 1.123456,
          startX: -1.000001,
          targetY: 2.123456,
        },
      ],
      stepOverflowProtection: true,
    };
    const compiledMaterials = compileGraphwarFormulaMaterials(points, 210, "step", formulaEvaluation);
    const expression = buildFormula(points, 210, "dy", "step", 4, {
      compiledMaterials,
      signProtection: formulaEvaluation.signProtection,
      stepOverflowProtection: true,
    }).expression;

    expect(countOccurrences(expression, epsilonText)).toBe(1);
    expect(compiledMaterials.stepFormula?.terms[0]?.glitchSegment?.formulaDecimalPlaces).toBe(6);
    const parsed = createGraphwarExpressionEvaluator(expression);
    if (!parsed) {
      throw new Error("Expected the generated Step glitch expression to parse");
    }
    const compiled = compileFormulaEvaluator(points, 210, "step", formulaEvaluation, compiledMaterials);
    for (const x of [
      nextDownDouble(-1.000001),
      -1.000001,
      nextUpDouble(-1.000001),
      nextDownDouble(-0.990001),
      -0.990001,
      nextUpDouble(-0.990001),
    ]) {
      for (const y of [nextDownDouble(1.123456), 1.123456, nextUpDouble(1.123456)]) {
        expect(Object.is(compiled.evaluateFirstDerivativeY(x, y), parsed(x, y, 0))).toBe(true);
      }
    }
  });

  it("treats absent and trailing zero protection entries as the same snapshot", () => {
    expect(graphwarSignProtectionEquals([GraphwarSignRole.StartX], [GraphwarSignRole.StartX, 0, 0])).toBe(true);
    expect(graphwarSignProtectionEquals(undefined, [])).toBe(true);
    expect(graphwarSignProtectionEquals([GraphwarSignRole.StartX], [GraphwarSignRole.EndX])).toBe(false);
  });
});

/** Counts literal epsilon text without involving regular-expression escaping. */
function countOccurrences(text: string, value: string) {
  let count = 0;
  let start = 0;
  while (true) {
    const index = text.indexOf(value, start);
    if (index < 0) {
      return count;
    }
    count += 1;
    start = index + value.length;
  }
}
