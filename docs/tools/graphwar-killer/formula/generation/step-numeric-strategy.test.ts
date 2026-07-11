import { describe, expect, it } from "vitest";

import { createGraphPoint } from "../../core/types";
import {
  calculateStepFormulaCenterX,
  quantizeStepFormulaSteepness,
  resolveStepFormulaCenterX,
  resolveStepFormula,
  resolveStepFormulaTransition,
} from "./step-numeric-strategy";

describe("Step numeric compensation", () => {
  it("uses the printed coefficient as the canonical value for every equation", () => {
    const y = resolveStepFormulaTransition(0, 0.5, "y", 2, 0);
    expect(y.activeCoefficient).toBe(1);
    expect(y.effectiveDeltaY).toBe(1);
    expect(y.firstDerivativeCoefficient).toBe(2);
    expect(y.secondDerivativeCoefficient).toBe(4);

    const dy = resolveStepFormulaTransition(0, 0.25, "dy", 2, 0);
    expect(dy.activeCoefficient).toBe(1);
    expect(dy.effectiveDeltaY).toBe(0.5);
    expect(dy.yCoefficient).toBe(0.5);
    expect(dy.secondDerivativeCoefficient).toBe(2);

    const ddy = resolveStepFormulaTransition(0, 0.125, "ddy", 2, 0);
    expect(ddy.activeCoefficient).toBe(1);
    expect(ddy.effectiveDeltaY).toBe(0.25);
    expect(ddy.firstDerivativeCoefficient).toBe(0.5);
    expect(ddy.yCoefficient).toBe(0.25);
  });

  it("carries the previous resolved plateau through half-away-from-zero ties", () => {
    const points = [createGraphPoint(0, 0), createGraphPoint(1, 1), createGraphPoint(2, 0.5)];
    const resolved = resolveStepFormula(points, 2, "y", { formulaDecimalPlaces: 0 });
    const direct = resolveStepFormulaTransition(0, 0.5, "y", 2, 0);

    expect(resolved.transitions.map((transition) => transition.resolvedEndY)).toEqual([1, 0]);
    expect(direct.resolvedEndY).toBe(1);
  });

  it("gives equivalent target plateaus the same integer state after different histories", () => {
    const origin = Math.PI;
    const direct = resolveStepFormula([createGraphPoint(0, origin), createGraphPoint(2, 1.25)], 67, "ddy", {
      formulaDecimalPlaces: 3,
    });
    const viaAnotherPlateau = resolveStepFormula(
      [createGraphPoint(0, origin), createGraphPoint(1, -2.5), createGraphPoint(2, 1.25)],
      67,
      "ddy",
      { formulaDecimalPlaces: 3 },
    );

    expect(viaAnotherPlateau.plateauState.coefficientUnits).toBe(direct.plateauState.coefficientUnits);
    expect(viaAnotherPlateau.plateauState.resolvedY).toBe(direct.plateauState.resolvedY);
  });

  it("resets the canonical origin after a glitch jump lands exactly on its control point", () => {
    const resolved = resolveStepFormula(
      [createGraphPoint(0, 0), createGraphPoint(1, 0.25), createGraphPoint(2, 1)],
      2,
      "dy",
      {
        formulaDecimalPlaces: 0,
        // 段 0 被邪道项替换并实际落到 0.25；几何 ΔY 恰好仍是默认 0.75。
        stepSegmentDeltaYs: [undefined, 0.75],
      },
    );

    expect(resolved.transitions[1]?.resolvedStartY).toBe(0.25);
    expect(resolved.transitions[1]?.activeCoefficient).toBe(2);
  });

  it("rounds steepness before deriving derivative scales", () => {
    const formulaSteepness = quantizeStepFormulaSteepness(1.234, 2);
    const transition = resolveStepFormulaTransition(0, 1, "ddy", formulaSteepness, 2);

    expect(formulaSteepness).toBe(1.23);
    expect(transition.activeCoefficient).toBe(1.51);
    expect(transition.resolvedEndY).toBeCloseTo(1.51 / 1.23 ** 2, 12);
  });

  it("rejects a zero steepness instead of inventing an advancing state", () => {
    const transition = resolveStepFormulaTransition(2, 5, "dy", 0, 2);

    expect(transition.isValid).toBe(false);
    expect(transition.effectiveDeltaY).toBe(0);
    expect(transition.resolvedEndY).toBe(2);
  });

  it.each([0, 1])("keeps the printed center inside the 1px target-tail contract at precision %i", (precision) => {
    const rawCenter = calculateStepFormulaCenterX(0, 1, 4, 67);
    const center = resolveStepFormulaCenterX(0, 1, 4, 67, precision);
    const progressAtTarget = 1 / (1 + Math.exp(-67 * (1 - center)));
    const tailErrorPlanePixels = Math.abs(4 * (1 - progressAtTarget)) * (770 / 50);

    expect(center).toBeLessThanOrEqual(rawCenter);
    expect(tailErrorPlanePixels).toBeLessThanOrEqual(1);
  });
});
