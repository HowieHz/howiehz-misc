import { afterEach, describe, expect, it, vi } from "vitest";

import { createGraphPoint } from "../../core/types";
import { getGraphwarLaunchAngle, GraphwarFormulaConvergenceError } from "./simulator";

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

  it("fails when the tool-owned y'' suggested-angle iteration reaches the same safety limit", () => {
    let callCount = 0;
    vi.spyOn(Math, "atan").mockImplementation(() => {
      callCount += 1;
      return callCount % 2;
    });

    expect(() =>
      getGraphwarLaunchAngle({ algorithm: "step", equation: "ddy", points: horizontalPoints, steepness: 210 }),
    ).toThrow(GraphwarFormulaConvergenceError);
    expect(callCount).toBe(101);
  });
});
