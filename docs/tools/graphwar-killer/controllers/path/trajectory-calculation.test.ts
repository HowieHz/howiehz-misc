import { describe, expect, it } from "vitest";

import { graphToImagePoint } from "../../core/geometry";
import { createGraphPoint, createPixelPoint } from "../../core/types";
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
    expect(Number(outcome.result.curvePoints.split(" ").at(-1)?.split(",")[0])).toBeGreaterThan(
      graphToImagePoint(target, bounds, boundsRect).x,
    );
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

  it("keeps a target hit when the same sample also reaches an obstacle", () => {
    const start = createGraphPoint(-10, 0);
    const target = createGraphPoint(10, 0);
    const input = {
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
      type: "solver",
    } satisfies Parameters<typeof calculateGraphwarTrajectory>[0];
    const baseline = calculateGraphwarTrajectory(input);
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) {
      return;
    }
    const sampledPixels = baseline.result.curvePoints.split(" ").map((point) => point.split(",").map(Number));
    const collisionPixel = sampledPixels.find(([x]) => Math.floor(x) >= Math.floor(sampledPixels[0][0]) + 2);
    expect(collisionPixel).toBeDefined();
    if (!collisionPixel) {
      return;
    }
    const [sampleX, sampleY] = collisionPixel;
    const mask = new Uint8Array(770 * 450);
    mask[Math.floor(sampleY) * 770 + Math.floor(sampleX)] = 1;
    const obstacleOnly = calculateGraphwarTrajectory({ ...input, collision: { mask } });
    expect(obstacleOnly.ok && obstacleOnly.result.warningReason).toBe("obstacle");
    const outcome = calculateGraphwarTrajectory({
      ...input,
      collision: { mask },
      targetHitRadiusPixels: 0.01,
      targetPoint: createPixelPoint(sampleX, sampleY),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    // 主轨迹一直按“先命中、后碰撞”结算；合并扫描不能把同点命中改成障碍警告。
    expect(outcome.result.warningReason).toBeUndefined();
  });
});
