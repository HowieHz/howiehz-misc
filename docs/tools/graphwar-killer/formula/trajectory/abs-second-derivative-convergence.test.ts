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

  it("stops when a state inside the one-pixel position band repeats", () => {
    const probes = installAbsRefinementSamples(
      () => targetErrorSample(0),
      (_terminalProbeIndex, centerX) => terminalSampleForPulseDeltaSlope(-1, centerX),
    );
    const resolved = resolveTrajectory();

    expect(probes.terminalProbeCount).toBe(3);
    expect(probes.executionStates).toHaveLength(3);
    expectResolvedPulseState(resolved, probes.executionStates[0]);
  });

  it("restores the best state when a two-state cycle returns to the first key", () => {
    let cycleCenterX: number | undefined;
    let cycleDeltaSlope: number | undefined;
    const probes = installAbsRefinementSamples(
      (targetProbeIndex, state) => {
        if (targetProbeIndex === 0) {
          return targetErrorSample(4);
        }
        if (targetProbeIndex === 1) {
          cycleCenterX = state.centerX;
          cycleDeltaSlope = state.deltaSlope;
          // shifted 初态右移 2；下一状态用更小幅度返回同一中心，再恢复本幅度触发 key 重复。
          return targetPointSample(2 * state.deltaSlope);
        }
        if (targetProbeIndex === 2 && cycleCenterX !== undefined) {
          return targetPointSample(-state.deltaSlope * (state.centerX - cycleCenterX));
        }
        return targetErrorSample(0);
      },
      (terminalProbeIndex, centerX) => {
        const deltaSlope =
          (terminalProbeIndex === 2 || terminalProbeIndex === 3) && cycleDeltaSlope !== undefined
            ? cycleDeltaSlope / 2
            : terminalProbeIndex === 1
              ? -0.75
              : -1;
        return terminalSampleForPulseDeltaSlope(deltaSlope, centerX);
      },
    );
    const resolved = resolveTrajectory();

    expect(probes.terminalProbeCount).toBe(3);
    expect(probes.executionStates).toHaveLength(7);
    expectResolvedPulseState(resolved, probes.executionStates[3]);
  });

  it.each([
    ["stays level", 3],
    ["gets worse", 3.5],
  ] as const)("restores the best state when the residual %s", (_name, finalError) => {
    const probes = installAbsRefinementSamples((targetProbeIndex) =>
      targetErrorSample([4, 3, finalError][targetProbeIndex] ?? finalError),
    );
    const resolved = resolveTrajectory();

    expect(probes.terminalProbeCount).toBe(2);
    expect(probes.executionStates).toHaveLength(6);
    expectResolvedPulseState(resolved, probes.executionStates[1]);
  });

  it("restores the last improving state after the work limit", () => {
    const probes = installAbsRefinementSamples(
      (targetProbeIndex) => targetErrorSample(targetProbeIndex < 100 ? 101 - targetProbeIndex : 2),
      (_terminalProbeIndex, centerX) => terminalSampleForPulseDeltaSlope(-1_000, centerX),
    );
    const resolved = resolveTrajectory();

    expect(probes.terminalProbeCount).toBe(2);
    expect(probes.executionStates).toHaveLength(103);
    expectResolvedPulseState(resolved, probes.executionStates[99]);
  });

  it("does not replace a finite best state with a non-finite residual", () => {
    const probes = installAbsRefinementSamples((targetProbeIndex) =>
      targetProbeIndex === 0
        ? targetErrorSample(4)
        : targetProbeIndex === 1
          ? targetPointSample(Number.MAX_VALUE)
          : targetErrorSample(4),
    );
    const resolved = resolveTrajectory();

    expect(probes.terminalProbeCount).toBe(2);
    expect(probes.executionStates).toHaveLength(5);
    expectResolvedPulseState(resolved, probes.executionStates[0]);
  });

  it("fails when every residual is non-finite", () => {
    const probes = installAbsRefinementSamples(() => targetPointSample(Number.MAX_VALUE));

    expect(() => resolveTrajectory()).toThrow(GraphwarFormulaConvergenceError);
    expect(probes.terminalProbeCount).toBe(1);
    expect(probes.executionStates).toHaveLength(1);
  });
});

/** 一轮 ABS y'' 完整回放真正消费的末脉冲原子状态。 */
interface AbsPulseExecutionState {
  centerX: number;
  deltaSlope: number;
}

/** Separates pulse-free terminal probes from complete execution states and records each atomic pulse pair. */
function installAbsRefinementSamples(
  createTargetSample: (targetProbeIndex: number, state: AbsPulseExecutionState) => GraphwarTrajectorySample,
  createTerminalSample: (terminalProbeIndex: number, centerX: number | undefined) => GraphwarTrajectorySample = () =>
    terminalSample(1),
) {
  const executionStates: AbsPulseExecutionState[] = [];
  let terminalProbeCount = 0;
  sampleTrajectory.mockImplementation((options) => {
    const pulse = options.compiledFormulaMaterials?.absSecondDerivativeFormula?.pulses[0];
    let sample: GraphwarTrajectorySample;
    if (pulse) {
      const state = {
        centerX: pulse.formulaCenterX,
        deltaSlope:
          pulse.coefficient / (options.compiledFormulaMaterials?.absSecondDerivativeFormula?.formulaSteepness ?? 1),
      };
      sample = createTargetSample(executionStates.push(state) - 1, state);
    } else if (options.formulaEvaluation?.absSecondDerivativePulseDeltaSlopes?.[0] === 0) {
      // 本组只隔离主 refinement 状态机；零末脉冲候选由 sampling 回归单独覆盖。
      sample = targetPointSample(Number.MAX_VALUE);
    } else {
      sample = createTerminalSample(
        terminalProbeCount,
        options.formulaEvaluation?.absSecondDerivativePulseCenterXs?.[0],
      );
      terminalProbeCount += 1;
    }
    if (sample.endState) {
      options.shouldStop?.(
        sample.endState.currentPoint,
        sample.endState.previousPoint,
        sample.endState.sampleIndex,
        sample.endState,
      );
    }
    return sample;
  });
  return {
    executionStates,
    get terminalProbeCount() {
      return terminalProbeCount;
    },
  };
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

/** Builds the incoming y' that resolves to one requested pulse amplitude at the current fixed center. */
function terminalSampleForPulseDeltaSlope(deltaSlope: number, centerX: number | undefined) {
  if (centerX === undefined) {
    return terminalSample(-deltaSlope);
  }
  const progress = (x: number) => 1 / (1 + Math.exp(-(x - centerX)));
  return terminalSample(-deltaSlope * (progress(points[1].x) - progress(points[0].x)));
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

/** Verifies that convergence restored the center and coefficient from the same recorded execution state. */
function expectResolvedPulseState(
  resolved: ReturnType<typeof resolveTrajectory>,
  expected: AbsPulseExecutionState | undefined,
) {
  expect(expected).toBeDefined();
  expect(resolved.context.compiledMaterials.absSecondDerivativeFormula?.pulses[0]?.formulaCenterX).toBe(
    expected?.centerX,
  );
  expect(resolved.context.formulaEvaluation.absSecondDerivativePulseDeltaSlopes?.[0]).toBe(expected?.deltaSlope);
}
