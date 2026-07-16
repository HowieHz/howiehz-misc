import { afterEach, describe, expect, it, vi } from "vitest";

import { createGraphPoint } from "../../core/types";
import {
  GraphwarFormulaConvergenceError,
  sampleGraphwarTrajectory,
  type GraphwarTrajectorySample,
} from "../simulation/simulator";
import { resolveGraphwarTrajectory } from "./sampling";

vi.mock("../simulation/simulator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../simulation/simulator")>();
  return {
    ...actual,
    sampleGraphwarTrajectory: vi.fn(actual.sampleGraphwarTrajectory),
  };
});

const bounds = { maxX: 1_000_000_001, maxY: 225, minX: -1, minY: -225 };
const points = [createGraphPoint(0, 0), createGraphPoint(1_000_000_000, 0)];
const settings = {
  algorithm: "abs" as const,
  decimalPlaces: 4,
  equation: "ddy" as const,
  secondOrderLaunchAngleMode: "display-rounded" as const,
  steepness: 1,
  stepGlitchMode: false,
  stepOverflowProtection: false,
};
const sampleTrajectory = vi.mocked(sampleGraphwarTrajectory);

describe("ABS y'' refinement convergence", () => {
  afterEach(() => sampleTrajectory.mockReset());

  it("stops when the first finite state reaches the one-pixel quality target", () => {
    const resolved = resolveWithSamples([
      terminalSample(1),
      targetErrorSample(0.5),
      terminalSample(1),
      targetErrorSample(0),
      targetErrorSample(0),
    ]);

    expect(sampleTrajectory).toHaveBeenCalledTimes(5);
    expect(resolved.context.formulaPoints[1].y).toBe(0);
    expect(resolved.context.formulaEvaluation.absSecondDerivativePulseDeltaSlopes).toEqual([-1]);
  });

  it("restores the best state when the next quantized state repeats", () => {
    const resolved = resolveWithSamples([
      terminalSample(1),
      targetErrorSample(4),
      targetErrorSample(0),
      terminalSample(1),
      terminalSample(1),
      targetErrorSample(0),
      targetErrorSample(0),
    ]);

    expect(sampleTrajectory).toHaveBeenCalledTimes(7);
    expect(resolved.context.formulaPoints[1].y).toBe(0);
    expect(resolved.context.formulaEvaluation.absSecondDerivativePulseDeltaSlopes).toEqual([-1]);
  });

  it("restores the best state when a two-state cycle returns to the first key", () => {
    const resolved = resolveWithSamples([
      terminalSample(1),
      targetErrorSample(4),
      targetErrorSample(0),
      terminalSample(2),
      targetErrorSample(3),
      targetErrorSample(0),
      terminalSample(1),
      terminalSample(2),
      targetErrorSample(0),
      targetErrorSample(0),
    ]);

    expect(sampleTrajectory).toHaveBeenCalledTimes(10);
    expect(resolved.context.formulaPoints[1].y).toBe(4);
    expect(resolved.context.formulaEvaluation.absSecondDerivativePulseDeltaSlopes).toEqual([-2]);
  });

  it.each([
    ["stays level", 3],
    ["gets worse", 3.5],
  ] as const)("restores the best state when the residual %s", (_name, finalError) => {
    const resolved = resolveWithSamples([
      terminalSample(1),
      targetErrorSample(4),
      targetErrorSample(0),
      terminalSample(2),
      targetErrorSample(3),
      targetErrorSample(0),
      terminalSample(3),
      targetErrorSample(finalError),
      terminalSample(2),
      targetErrorSample(0),
      targetErrorSample(0),
    ]);

    expect(sampleTrajectory).toHaveBeenCalledTimes(11);
    expect(resolved.context.formulaPoints[1].y).toBe(4);
    expect(resolved.context.formulaEvaluation.absSecondDerivativePulseDeltaSlopes).toEqual([-2]);
  });

  it("restores the last improving state after the work limit", () => {
    const samples: GraphwarTrajectorySample[] = [];
    let expectedTargetY = 0;
    for (let index = 0; index < 100; index += 1) {
      const error = 101 - index;
      samples.push(terminalSample(index + 1), targetErrorSample(error), targetErrorSample(0));
      if (index < 99) {
        expectedTargetY += error;
      }
    }
    samples.push(terminalSample(100), targetErrorSample(0), targetErrorSample(0));

    const resolved = resolveWithSamples(samples);

    expect(sampleTrajectory).toHaveBeenCalledTimes(303);
    expect(resolved.context.formulaPoints[1].y).toBe(expectedTargetY);
    expect(resolved.context.formulaEvaluation.absSecondDerivativePulseDeltaSlopes).toEqual([-100]);
  });

  it("does not replace a finite best state with a non-finite residual", () => {
    const resolved = resolveWithSamples([
      terminalSample(1),
      targetErrorSample(4),
      targetErrorSample(0),
      terminalSample(2),
      targetPointSample(Number.MAX_VALUE),
      terminalSample(1),
      targetErrorSample(0),
      targetErrorSample(0),
    ]);

    expect(sampleTrajectory).toHaveBeenCalledTimes(8);
    expect(resolved.context.formulaPoints[1].y).toBe(0);
    expect(resolved.context.formulaEvaluation.absSecondDerivativePulseDeltaSlopes).toEqual([-1]);
  });

  it("fails when every residual is non-finite", () => {
    installSamples([terminalSample(1), targetPointSample(Number.MAX_VALUE)]);

    expect(() => resolveTrajectory()).toThrow(GraphwarFormulaConvergenceError);
    expect(sampleTrajectory).toHaveBeenCalledTimes(2);
  });
});

/** Runs the public trajectory resolver and verifies that the scripted physical samples were consumed exactly once. */
function resolveWithSamples(samples: readonly GraphwarTrajectorySample[]) {
  const remainingSamples = installSamples(samples);
  const resolved = resolveTrajectory();
  expect(remainingSamples).toHaveLength(0);
  return resolved;
}

/** Installs one deterministic sample per ABS refinement probe; an unexpected extra probe fails the test immediately. */
function installSamples(samples: readonly GraphwarTrajectorySample[]) {
  const remainingSamples = [...samples];
  sampleTrajectory.mockImplementation(() => {
    const sample = remainingSamples.shift();
    if (!sample) {
      throw new Error("Unexpected ABS y'' trajectory probe");
    }
    return sample;
  });
  return remainingSamples;
}

/** Resolves the same long, nearly horizontal path so display rounding keeps angle identity stable across test states. */
function resolveTrajectory() {
  return resolveGraphwarTrajectory({
    bounds,
    boundsRect: { height: 450, width: 770, x: 0, y: 0 },
    points,
    settings,
    soldierCenter: points[0],
  });
}

/** Creates a stopped prefix sample whose terminal slope determines the quantized pulse state. */
function terminalSample(dy: number) {
  return createSample(0, dy);
}

/** Creates a target-line sample with a requested signed correction toward the real target y. */
function targetErrorSample(error: number) {
  return targetPointSample(-error);
}

/** Creates a finite target-line sample; Number.MAX_VALUE intentionally overflows only the derived pixel residual. */
function targetPointSample(y: number) {
  return createSample(y, 0);
}

/** Builds the minimal resumable Graphwar sample consumed by ABS prefix and final trajectory paths. */
function createSample(y: number, dy: number): GraphwarTrajectorySample {
  const point = createGraphPoint(points[1].x, y);
  return {
    endState: { currentPoint: point, dy, sampleIndex: 1 },
    points: [point],
    stopReason: "stopped",
  };
}
