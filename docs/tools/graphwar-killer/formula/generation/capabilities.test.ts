import { describe, expect, it } from "vitest";

import { graphToImagePoint } from "../../core/geometry";
import { createGraphPoint, createPixelPoint } from "../../core/types";
import type { AlgorithmMode, BoundsRect, EquationMode, GraphBounds, PixelPoint } from "../../core/types";
import { sampleGraphwarPathTargetSequence } from "../trajectory/sampling";
import {
  formulaModePreservesPrefixWhenAppending,
  formulaModeSupportsLocalDeleteHitProof,
  formulaModeSupportsStepGlitch,
  formulaModeUsesPositionCompensation,
  formulaModeUsesStepGlitch,
} from "./capabilities";

describe("formula mode capabilities", () => {
  it.each([
    ["abs", "y", true],
    ["abs", "dy", true],
    ["abs", "ddy", false],
    ["step", "y", false],
    ["step", "dy", false],
    ["step", "ddy", false],
    ["pchip", "y", false],
    ["pchip", "dy", false],
    ["pchip", "ddy", false],
    ["akima", "y", false],
    ["akima", "dy", false],
    ["akima", "ddy", false],
  ] satisfies [AlgorithmMode, EquationMode, boolean][])(
    "reports whether appending preserves the %s %s physical prefix",
    (algorithm, equation, expected) => {
      expect(formulaModePreservesPrefixWhenAppending(algorithm, equation)).toBe(expected);
    },
  );

  it.each([
    ["abs", "y", true],
    ["abs", "dy", true],
    ["abs", "ddy", false],
    ["step", "y", false],
    ["step", "dy", false],
    ["step", "ddy", false],
    ["pchip", "y", false],
    ["pchip", "dy", false],
    ["pchip", "ddy", false],
    ["akima", "y", false],
    ["akima", "dy", false],
    ["akima", "ddy", false],
  ] satisfies [AlgorithmMode, EquationMode, boolean][])(
    "reports whether %s %s deletion has a local incidental-hit proof",
    (algorithm, equation, expected) => {
      expect(formulaModeSupportsLocalDeleteHitProof(algorithm, equation)).toBe(expected);
    },
  );

  it.each(["y", "dy", "ddy"] satisfies EquationMode[])("disables ABS %s glitch semantics", (equation) => {
    expect(formulaModeSupportsStepGlitch("abs", equation)).toBe(false);
    expect(formulaModeUsesStepGlitch("abs", equation, true)).toBe(false);
  });

  it("enables position compensation for both ABS ODE modes and Step ODE modes", () => {
    expect(formulaModeUsesPositionCompensation("abs", "y")).toBe(false);
    expect(formulaModeUsesPositionCompensation("abs", "dy")).toBe(true);
    expect(formulaModeUsesPositionCompensation("abs", "ddy")).toBe(true);
    expect(formulaModeUsesPositionCompensation("step", "dy")).toBe(true);
    expect(formulaModeUsesPositionCompensation("step", "ddy")).toBe(true);
  });

  it("keeps the local delete proof off a PCHIP curve with a non-local incidental hit", () => {
    const bounds: GraphBounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
    const boundsRect: BoundsRect = { height: 450, width: 770, x: 0, y: 0 };
    const points = [
      createGraphPoint(-21, 2.0120756812393665),
      createGraphPoint(-16, 2.5630031526088715),
      createGraphPoint(-11, 7.543955738656223),
      createGraphPoint(-6, 7.647246206179261),
    ];
    const path = points.map((point) => graphToImagePoint(point, bounds, boundsRect));
    const [start, deleted, next, end] = path;
    if (!start || !deleted || !next || !end) {
      throw new Error("Expected the PCHIP deletion fixture to contain four points");
    }
    const incidentalTarget = { center: createPixelPoint(86.00199961983783, 194.21420612600411), radius: 2 };
    const settings = {
      algorithm: "pchip" as const,
      decimalPlaces: 4,
      equation: "y" as const,
      steepness: 67,
      isStepGlitchModeEnabled: false,
      isStepOverflowProtectionEnabled: true,
    };
    const oldResult = sampleGraphwarPathTargetSequence({
      bounds,
      boundsRect,
      points: path,
      settings,
      targetHitRadiusPixels: incidentalTarget.radius,
      targetPoints: [],
      trackedTargets: [incidentalTarget],
    });
    const newResult = sampleGraphwarPathTargetSequence({
      bounds,
      boundsRect,
      points: [start, next, end],
      settings,
      targetHitRadiusPixels: incidentalTarget.radius,
      targetPoints: [],
      trackedTargets: [incidentalTarget],
    });
    const oldLocalDistanceSquared = Math.min(
      pixelPointToSegmentDistanceSquared(incidentalTarget.center, start, deleted),
      pixelPointToSegmentDistanceSquared(incidentalTarget.center, deleted, next),
    );

    expect(oldLocalDistanceSquared).toBeGreaterThanOrEqual(incidentalTarget.radius ** 2);
    expect(oldResult.trackedTargetHitIndexes[0]).toBeGreaterThanOrEqual(0);
    expect(newResult.trackedTargetHitIndexes[0]).toBe(-1);
    expect(formulaModeSupportsLocalDeleteHitProof("pchip", "y")).toBe(false);
  });
});

/** 与删点热路径相同的线段最近距离，用于固定非局部公式反例。 */
function pixelPointToSegmentDistanceSquared(point: PixelPoint, start: PixelPoint, end: PixelPoint) {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
  const ratio =
    segmentLengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / segmentLengthSquared),
        );
  const closestX = start.x + segmentX * ratio;
  const closestY = start.y + segmentY * ratio;
  return (point.x - closestX) ** 2 + (point.y - closestY) ** 2;
}
