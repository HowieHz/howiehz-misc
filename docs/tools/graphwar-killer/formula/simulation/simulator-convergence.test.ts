import { afterEach, describe, expect, it, vi } from "vitest";

import { createGraphPoint } from "../../core/types";
import { getGraphwarLaunchAngle, GraphwarFormulaConvergenceError, sampleGraphwarTrajectory } from "./simulator";

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
});
