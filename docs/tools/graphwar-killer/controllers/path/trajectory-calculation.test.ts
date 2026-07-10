import { describe, expect, it } from "vitest";

import { graphToImagePoint } from "../../core/geometry";
import { createGraphPoint } from "../../core/types";
import { calculateGraphwarTrajectory } from "./trajectory-calculation";

const bounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
const boundsRect = { height: 450, width: 770, x: 0, y: 0 };

describe("main trajectory calculation", () => {
  it("solves a y'' formula and returns its angle and visible trajectory atomically", () => {
    const start = createGraphPoint(-10, 0);
    const target = createGraphPoint(10, 0);
    const outcome = calculateGraphwarTrajectory({
      bounds,
      boundsRect,
      points: [start, target],
      settings: {
        algorithm: "step",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 67,
        stepGlitchMode: false,
        stepOverflowProtection: true,
      },
      targetHitRadiusPixels: 7,
      targetPoint: graphToImagePoint(target, bounds, boundsRect),
      type: "solver",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.result.formulaResult?.expression).toBeTruthy();
    expect(outcome.result.secondOrderLaunchAngleDegrees).toBeCloseTo(0);
    expect(outcome.result.curvePoints.split(" ").length).toBeGreaterThan(1);
    expect(outcome.result.warningReason).toBeUndefined();
  });

  it("simulates a user expression without producing solver-only fields", () => {
    const outcome = calculateGraphwarTrajectory({
      bounds,
      boundsRect,
      equation: "y",
      expression: "0",
      soldierCenter: createGraphPoint(-10, 0),
      type: "simulator",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.result.curvePoints.split(" ").length).toBeGreaterThan(1);
    expect(outcome.result.formulaResult).toBeUndefined();
    expect(outcome.result.secondOrderLaunchAngleDegrees).toBeUndefined();
    expect(outcome.result.warningReason).toBe("out-of-bounds");
  });

  it("returns normal sampling stop reasons as successful warnings", () => {
    const outcome = calculateGraphwarTrajectory({
      bounds,
      boundsRect,
      equation: "y",
      expression: "1/0",
      soldierCenter: createGraphPoint(-10, 0),
      type: "simulator",
    });

    expect(outcome).toEqual({
      ok: true,
      result: {
        curvePoints: "",
        warningReason: "invalid",
      },
    });
  });

  it("returns an obstacle stop as a successful warning", () => {
    const outcome = calculateGraphwarTrajectory({
      bounds,
      boundsRect,
      collision: { mask: new Uint8Array(770 * 450).fill(1) },
      equation: "y",
      expression: "0",
      soldierCenter: createGraphPoint(-10, 0),
      type: "simulator",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.result.warningReason).toBe("obstacle");
  });
});
