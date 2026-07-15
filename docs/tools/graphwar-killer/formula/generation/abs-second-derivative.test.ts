import { describe, expect, it } from "vitest";

import { GRAPHWAR_GAME_SOLDIER_RADIUS } from "../../core/game/constants";
import { createGraphPoint } from "../../core/types";
import {
  createGraphwarFormulaPathPoints,
  getGraphwarLaunchAngle,
  sampleGraphwarTrajectory,
} from "../simulation/simulator";
import { buildFormula, compileGraphwarFormulaMaterials } from "./build";

describe("ABS second-derivative formula", () => {
  it.each(["y", "ddy"] as const)("ignores stale position points in %s mode", (equation) => {
    const points = [createGraphPoint(0, 0), createGraphPoint(2, 2), createGraphPoint(4, 2)];
    const plain = compileGraphwarFormulaMaterials(points, 210, "abs", { equation, formulaDecimalPlaces: 4 });
    const withStaleStart = compileGraphwarFormulaMaterials(points, 210, "abs", {
      equation,
      formulaDecimalPlaces: 4,
      segmentStartPoints: [undefined, createGraphPoint(2.5, 2.5)],
    });

    expect(withStaleStart).toEqual(plain);
  });

  it("uses resolved pulse deltas and allows unresolved pulses to stay disabled", () => {
    const points = [createGraphPoint(0, 0), createGraphPoint(2, 2), createGraphPoint(4, 2)];
    const materials = compileGraphwarFormulaMaterials(points, 210, "abs", {
      equation: "ddy",
      formulaDecimalPlaces: 4,
      absSecondDerivativePulseDeltaSlopes: [undefined, 0.5],
    });

    expect(materials.absSecondDerivativeFormula?.pulses).toEqual([{ coefficient: 105, formulaCenterX: 4 }]);
  });

  it("emits internal slope changes and a terminal flattening pulse without a launch pulse", () => {
    const points = [createGraphPoint(0, 0), createGraphPoint(2, 2), createGraphPoint(4, 2), createGraphPoint(6, 6)];
    const materials = compileGraphwarFormulaMaterials(points, 210, "abs", {
      equation: "ddy",
      formulaDecimalPlaces: 4,
    });

    expect(materials.absSecondDerivativeFormula).toEqual({
      formulaSteepness: 210,
      pulses: [
        { coefficient: -210, formulaCenterX: 2 },
        { coefficient: 420, formulaCenterX: 4 },
        { coefficient: -420, formulaCenterX: 6 },
      ],
    });
    expect(materials.absSecondDerivativeFormula?.pulses.some((pulse) => pulse.formulaCenterX === 0)).toBe(false);
  });

  it("always uses the stable pulse form and ignores the Step overflow switch", () => {
    const points = [createGraphPoint(-10, 0), createGraphPoint(-5, 3), createGraphPoint(0, -1)];
    const stable = buildFormula(points, 210, "ddy", "abs", 4, { stepOverflowProtection: true }).expression;
    const switchDisabled = buildFormula(points, 210, "ddy", "abs", 4, {
      stepOverflowProtection: false,
    }).expression;

    expect(switchDisabled).toBe(stable);
    expect(stable).toContain("exp(-abs(");
    expect(stable.match(/exp\(/g)).toHaveLength(stable.match(/exp\(-abs\(/g)?.length ?? 0);
    expect(stable).not.toContain("exp(-210*(");
  });

  it("uses the analytic launch angle and the real muzzle point at full precision", () => {
    const center = createGraphPoint(0, 0);
    const target = createGraphPoint(4, 3);
    const points = [center, target, createGraphPoint(8, 3)];
    const angle = Math.atan2(target.y - center.y, target.x - center.x);
    const formulaPoints = createGraphwarFormulaPathPoints({
      algorithm: "abs",
      bounds: { maxX: 20, maxY: 20, minX: -20, minY: -20 },
      equation: "ddy",
      points,
      steepness: 210,
    });
    const staleGlitchFormulaPoints = createGraphwarFormulaPathPoints({
      algorithm: "abs",
      bounds: { maxX: 20, maxY: 20, minX: -20, minY: -20 },
      equation: "ddy",
      formulaEvaluation: {
        equation: "ddy",
        stepGlitchSegments: [{ derivative: 1, endX: 1, equation: "dy", gateY: 1, startX: 0, targetY: 1 }],
      },
      points,
      steepness: 210,
    });

    expect(staleGlitchFormulaPoints).toEqual(formulaPoints);
    expect(formulaPoints[0].x).toBeCloseTo(center.x + GRAPHWAR_GAME_SOLDIER_RADIUS * Math.cos(angle), 15);
    expect(formulaPoints[0].y).toBeCloseTo(center.y + GRAPHWAR_GAME_SOLDIER_RADIUS * Math.sin(angle), 15);
    expect(
      getGraphwarLaunchAngle({ algorithm: "abs", equation: "ddy", points: formulaPoints, steepness: 210 }, center),
    ).toBeCloseTo(angle, 15);

    const sample = sampleGraphwarTrajectory({
      algorithm: "abs",
      bounds: { maxX: 20, maxY: 20, minX: -20, minY: -20 },
      equation: "ddy",
      points: formulaPoints,
      soldierCenter: center,
      steepness: 210,
    });
    expect(sample.stopReason).not.toBe("unsupported");
    expect(sample.stopReason).not.toBe("invalid");
    expect(sample.points.length).toBeGreaterThan(1);
    expect(sample.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  });

  it("fails explicitly when the tool-owned launch-point iteration exhausts its safety budget", () => {
    const points = [
      createGraphPoint(-10, -1),
      createGraphPoint(-7, 2),
      createGraphPoint(-3, -2),
      createGraphPoint(1, 1),
    ];

    expect(() =>
      createGraphwarFormulaPathPoints({
        algorithm: "pchip",
        bounds: { maxX: 20, maxY: 20, minX: -20, minY: -20 },
        equation: "ddy",
        formulaEvaluation: { equation: "ddy", formulaDecimalPlaces: 4 },
        points,
        steepness: 210,
      }),
    ).toThrow("Formula launch point did not converge.");
  });
});
