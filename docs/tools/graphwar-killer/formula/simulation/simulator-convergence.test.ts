import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GRAPHWAR_FUNC_LAST_BISECTED_X_STEP_DISTANCE,
  GRAPHWAR_FUNC_MAX_STEP_DISTANCE_SQUARED,
  GRAPHWAR_GAME_SOLDIER_RADIUS,
} from "../../core/game/constants";
import { createGraphPoint } from "../../core/types";
import { createGraphwarTrajectoryDebugMetrics } from "../debug-metrics";
import {
  createGraphwarFormulaPathPoints,
  getGraphwarLaunchAngle,
  GraphwarFormulaConvergenceError,
  sampleGraphwarTrajectory,
  sampleGraphwarExpressionTrajectory,
} from "./simulator";

const horizontalPoints = [createGraphPoint(-10, 0), createGraphPoint(0, 0)];

describe("Graphwar launch-angle convergence contracts", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["y", 101],
    ["dy", 100],
  ] as const)("keeps the source-compatible %s loop's final angle after its 100-iteration limit", (equation, calls) => {
    let callCount = 0;
    vi.spyOn(Math, "atan").mockImplementation(() => {
      callCount += 1;
      return callCount % 2;
    });

    const angle = getGraphwarLaunchAngle({ algorithm: "step", equation, points: horizontalPoints, steepness: 210 });

    expect(callCount).toBe(calls);
    expect(Number.isFinite(angle)).toBe(true);
  });

  it("restores the best y'' suggested angle when the residual stops strictly improving", () => {
    let callCount = 0;
    vi.spyOn(Math, "atan").mockImplementation(() => {
      callCount += 1;
      return callCount % 2;
    });

    expect(
      getGraphwarLaunchAngle({ algorithm: "step", equation: "ddy", points: horizontalPoints, steepness: 210 }),
    ).toBe(1);
    expect(callCount).toBe(3);
  });

  it("restores the best y'' state after the tool-owned work limit", () => {
    const angles: number[] = [];
    let nextAngle = 0;
    for (let index = 0; index < 100; index += 1) {
      angles.push(nextAngle);
      nextAngle += 0.005 * 0.99 ** index;
    }
    angles.push(nextAngle);
    let callCount = 0;
    vi.spyOn(Math, "atan").mockImplementation(() => angles[callCount++] ?? Number.NaN);

    const angle = getGraphwarLaunchAngle({
      algorithm: "step",
      equation: "ddy",
      points: horizontalPoints,
      steepness: 210,
    });

    expect(callCount).toBe(101);
    expect(Object.is(angle, angles[99])).toBe(true);
  });

  it("fails only when the y'' iteration has no finite execution state", () => {
    vi.spyOn(Math, "atan").mockReturnValue(Number.NaN);

    expect(() =>
      getGraphwarLaunchAngle({ algorithm: "step", equation: "ddy", points: horizontalPoints, steepness: 210 }),
    ).toThrow(GraphwarFormulaConvergenceError);
  });

  it("continues launch-point refinement while a sub-micro residual still strictly improves", () => {
    const center = createGraphPoint(-10, 0);
    const firstAngle = 0.1;
    const improvedAngle = firstAngle + 0.000001;
    let callCount = 0;
    vi.spyOn(Math, "atan").mockImplementation(() => {
      callCount += 1;
      return callCount <= 2 ? firstAngle : improvedAngle;
    });

    const formulaPoints = createGraphwarFormulaPathPoints({
      algorithm: "pchip",
      bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
      equation: "ddy",
      formulaEvaluation: { equation: "ddy", formulaDecimalPlaces: 15 },
      points: [center, createGraphPoint(0, 1), createGraphPoint(10, 0)],
      steepness: 210,
    });

    expect(callCount).toBe(6);
    expect(Object.is(formulaPoints[0].x, center.x + GRAPHWAR_GAME_SOLDIER_RADIUS * Math.cos(improvedAngle))).toBe(true);
    expect(Object.is(formulaPoints[0].y, center.y + GRAPHWAR_GAME_SOLDIER_RADIUS * Math.sin(improvedAngle))).toBe(true);
  });

  it("rejects a second-order resume state without its required slope", () => {
    expect(() =>
      sampleGraphwarTrajectory({
        algorithm: "abs",
        bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
        equation: "ddy",
        initialState: { currentPoint: createGraphPoint(-5, 0), sampleIndex: 10 },
        points: horizontalPoints,
        soldierCenter: horizontalPoints[0],
        steepness: 210,
      }),
    ).toThrow("Second-order trajectory resume state is missing dy.");
  });

  it("stops y= before accepting a segment that remains too steep at the final bisection step", () => {
    const result = sampleGraphwarExpressionTrajectory({
      bounds: { maxX: 1e9, maxY: 1e9, minX: -1e9, minY: -1e9 },
      equation: "y",
      expression: "1000000*x",
      initialState: { currentPoint: createGraphPoint(0, 0), sampleIndex: 0 },
      soldierCenter: createGraphPoint(0, 0),
    });

    expect(result.stopReason).toBe("too-steep");
    expect(result.points).toEqual([createGraphPoint(0, 0)]);
  });

  it.each([
    ["dy", "1000000"],
    ["ddy", "1000000000000"],
  ] as const)("keeps the source-compatible %s acceptance of an overlong final-step point", (equation, expression) => {
    const result = sampleGraphwarExpressionTrajectory({
      bounds: { maxX: 1e9, maxY: 1e9, minX: -1e9, minY: -1e9 },
      equation,
      expression,
      ...(equation === "ddy" ? { launchAngleRadians: 0 } : {}),
      initialState: {
        currentPoint: createGraphPoint(0, 0),
        ...(equation === "ddy" ? { dy: 0 } : {}),
        sampleIndex: 0,
      },
      shouldStop: (_point, _previousPoint, index) => index === 1,
      soldierCenter: createGraphPoint(0, 0),
    });
    const acceptedPoint = result.points[1];

    expect(result.stopReason).toBe("stopped");
    expect(acceptedPoint?.x).toBe(GRAPHWAR_FUNC_LAST_BISECTED_X_STEP_DISTANCE);
    expect((acceptedPoint?.x ?? 0) ** 2 + (acceptedPoint?.y ?? 0) ** 2).toBeGreaterThan(
      GRAPHWAR_FUNC_MAX_STEP_DISTANCE_SQUARED,
    );
  });

  it("counts launch solving, RK4 retries, bisections, formula terms, and accepted samples", () => {
    const debugMetrics = createGraphwarTrajectoryDebugMetrics();
    const result = sampleGraphwarTrajectory({
      algorithm: "abs",
      bounds: { maxX: 1e9, maxY: 1e9, minX: -1e9, minY: -1e9 },
      debugMetrics,
      equation: "dy",
      initialState: { currentPoint: createGraphPoint(0, 0), sampleIndex: 0 },
      points: [createGraphPoint(-10, 0), createGraphPoint(10, 1e9)],
      shouldStop: (_point, _previousPoint, index) => index === 1,
      soldierCenter: createGraphPoint(-10, 0),
      steepness: 210,
    });

    expect(result.stopReason).toBe("stopped");
    expect(debugMetrics.counters.acceptedSamplePointCount).toBe(2);
    expect(debugMetrics.counters.trajectoryReplayCount).toBe(1);
    expect(debugMetrics.counters.stepBisectionCount).toBeGreaterThan(0);
    expect(debugMetrics.counters.rk4StepCount).toBeGreaterThan(debugMetrics.counters.stepBisectionCount);
    expect(debugMetrics.counters.formulaTermEvaluationCount).toBe(debugMetrics.counters.rk4StepCount * 4);
  });
});
