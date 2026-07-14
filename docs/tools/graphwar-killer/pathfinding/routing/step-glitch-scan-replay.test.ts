import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE,
  GRAPHWAR_PLANE_HEIGHT,
  GRAPHWAR_PLANE_LENGTH,
  GRAPHWAR_STEP_SIZE,
} from "../../core/game/constants";
import { graphToImagePoint, imageToGraphPoint } from "../../core/geometry";
import { createGraphPoint, createPixelPoint } from "../../core/types";
import type { BoundsRect, GraphBounds } from "../../core/types";

const replayMockState = vi.hoisted(() => ({
  callCount: 0,
  convergenceFailure: false,
  directSuccess: false,
  farRequiredScenario: false,
  orderedGateSuccessAttempt: 2,
  orderedRowScenario: false,
  testedGateYs: [] as number[],
  testedWindowWidths: [] as number[],
  targetHitIndex: 1,
}));
const sampleFormulaTrajectory = vi.hoisted(() => vi.fn());

vi.mock("../../formula/trajectory/sampling", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../formula/trajectory/sampling")>();
  sampleFormulaTrajectory.mockImplementation(
    (options: Parameters<typeof original.tryResolveGraphwarTrajectoryCandidate>[0]) => {
      replayMockState.callCount += 1;
      const requiredTargetCount = options.requiredTargets?.length ?? 0;
      const targetCount = options.targetSequence?.length ?? 0;
      if (replayMockState.orderedRowScenario) {
        const lastPoint = options.points?.at(-1) ?? { x: -11, y: 0 };
        const controlX = options.continueAfterTargetsUntilGraphX ?? lastPoint.x;
        if (replayMockState.callCount === 1) {
          return {
            earlyStopReason: "obstacle" as const,
            obstacleHitIndex: 1,
            reachedRequiredTargetCount: 0,
            reachedTargetCount: 0,
            requiredTargetsHitIndex: -1,
            sample: {
              points: [
                { x: -9, y: 0 },
                { x: -8, y: 0 },
              ],
              stopReason: "stopped" as const,
            },
            targetHitIndex: -1,
            trackedTargetHitIndexes: [],
            visiblePixels: [],
          };
        }
        if (targetCount === 0) {
          replayMockState.testedGateYs.push(lastPoint.y);
          const window = options.stepGlitchXWindows?.at(-1);
          if (window) {
            replayMockState.testedWindowWidths.push(window.endX - window.startX);
          }
          if (replayMockState.testedGateYs.length < replayMockState.orderedGateSuccessAttempt) {
            return {
              earlyStopReason: "obstacle" as const,
              obstacleHitIndex: 0,
              reachedRequiredTargetCount: 0,
              reachedTargetCount: 0,
              requiredTargetsHitIndex: -1,
              sample: { points: [{ x: controlX, y: lastPoint.y }], stopReason: "stopped" as const },
              targetHitIndex: -1,
              trackedTargetHitIndexes: [],
              visiblePixels: [],
            };
          }
        }
        return {
          earlyStopReason: "stopped" as const,
          obstacleHitIndex: -1,
          reachedRequiredTargetCount: requiredTargetCount,
          reachedTargetCount: targetCount,
          requiredTargetsHitIndex: requiredTargetCount > 0 ? 0 : -1,
          sample: { points: [{ x: controlX, y: lastPoint.y }], stopReason: "stopped" as const },
          targetHitIndex: targetCount > 0 ? 0 : -1,
          trackedTargetHitIndexes: [],
          visiblePixels: [],
        };
      }
      if (replayMockState.farRequiredScenario) {
        if (replayMockState.callCount === 1) {
          return {
            earlyStopReason: "obstacle" as const,
            obstacleHitIndex: 1,
            reachedRequiredTargetCount: 0,
            reachedTargetCount: 0,
            requiredTargetsHitIndex: -1,
            sample: {
              points: [
                { x: -9, y: 0 },
                { x: -8, y: 0 },
              ],
              stopReason: "stopped" as const,
            },
            targetHitIndex: -1,
            trackedTargetHitIndexes: [],
            visiblePixels: [],
          };
        }

        const finalCandidate = replayMockState.callCount >= 4;
        return {
          earlyStopReason: "stopped" as const,
          obstacleHitIndex: -1,
          reachedRequiredTargetCount: requiredTargetCount,
          reachedTargetCount: targetCount,
          requiredTargetsHitIndex: requiredTargetCount > 0 ? 1 : -1,
          sample: {
            // Prefix/gate proof may finish at the farther historical target, but navigation resumes at index 0.
            points: finalCandidate
              ? [
                  { x: -6, y: 4 },
                  { x: -5, y: 2 },
                ]
              : [
                  { x: replayMockState.callCount === 2 ? -9 : -7.5, y: replayMockState.callCount === 2 ? 0 : 4 },
                  { x: -5, y: 2 },
                ],
            stopReason: "stopped" as const,
          },
          targetHitIndex: targetCount > 0 ? 0 : -1,
          trackedTargetHitIndexes: [],
          visiblePixels: [],
        };
      }
      return replayMockState.directSuccess
        ? {
            earlyStopReason: "target" as const,
            obstacleHitIndex: -1,
            reachedRequiredTargetCount: requiredTargetCount,
            reachedTargetCount: targetCount,
            requiredTargetsHitIndex: requiredTargetCount > 0 ? 1 : -1,
            sample: {
              points: [
                { x: -11, y: 0 },
                { x: -8.5, y: 0 },
                { x: -6, y: 0 },
              ],
              stopReason: "stopped" as const,
            },
            targetHitIndex: targetCount,
            trackedTargetHitIndexes: [],
            visiblePixels: [],
          }
        : {
            earlyStopReason: "obstacle" as const,
            obstacleHitIndex: 2,
            reachedRequiredTargetCount: 0,
            reachedTargetCount: 1,
            requiredTargetsHitIndex: -1,
            sample: {
              points: [
                { x: -7, y: 0 },
                { x: -6, y: 0 },
                { x: -5.99, y: 0 },
              ],
              stopReason: "stopped" as const,
            },
            targetHitIndex: replayMockState.targetHitIndex,
            trackedTargetHitIndexes: [],
            visiblePixels: [],
          };
    },
  );
  return {
    ...original,
    tryResolveGraphwarTrajectoryCandidate: vi.fn(
      (options: Parameters<typeof original.tryResolveGraphwarTrajectoryCandidate>[0]) =>
        replayMockState.convergenceFailure
          ? undefined
          : {
              // Scanner acceptance only reads the resolved points and optional prefix; context construction has its own tests.
              context: {
                formulaPoints: [...options.points],
              } as ReturnType<typeof original.resolveGraphwarTrajectory>["context"],
              result: sampleFormulaTrajectory(options),
            },
    ),
  };
});

import { scanGraphwarStepGlitchPath } from "./step-glitch-scan";

const bounds: GraphBounds = { maxX: -4, maxY: 10, minX: -12, minY: -10 };
const boundsRect: BoundsRect = {
  height: GRAPHWAR_PLANE_HEIGHT,
  width: GRAPHWAR_PLANE_LENGTH,
  x: 0,
  y: 0,
};

describe("Step glitch scanner replay acceptance", () => {
  beforeEach(() => {
    replayMockState.callCount = 0;
    replayMockState.convergenceFailure = false;
    replayMockState.directSuccess = false;
    replayMockState.farRequiredScenario = false;
    replayMockState.orderedGateSuccessAttempt = 2;
    replayMockState.orderedRowScenario = false;
    replayMockState.testedGateYs.length = 0;
    replayMockState.testedWindowWidths.length = 0;
    replayMockState.targetHitIndex = 1;
    sampleFormulaTrajectory.mockClear();
  });

  it("accepts a target sequence completed at a safe control-x sample", () => {
    expect(scanDirectTarget().status).toBe("hit");
  });

  it("rejects a target sequence completed only on the obstacle sample", () => {
    replayMockState.targetHitIndex = 2;

    expect(scanDirectTarget().status).toBe("no-path");
  });

  it("rejects a candidate when strict formula resolution does not converge", () => {
    replayMockState.convergenceFailure = true;

    expect(scanDirectTarget().status).toBe("no-path");
  });

  it("replays only the final direct formula when it succeeds", () => {
    replayMockState.directSuccess = true;
    const start = graphToImagePoint(createGraphPoint(-11, 0), bounds, boundsRect);
    const prefixTarget = graphToImagePoint(createGraphPoint(-8.5, 0), bounds, boundsRect);
    const target = graphToImagePoint(createGraphPoint(-6, 0), bounds, boundsRect);

    const result = scanGraphwarStepGlitchPath({
      bounds,
      boundsRect,
      hitTarget: { center: target, radius: 12 },
      requiredTargets: [{ center: prefixTarget, radius: 12 }],
      settings: {
        algorithm: "step",
        decimalPlaces: 4,
        equation: "dy",
        steepness: 67,
        stepGlitchMode: true,
        stepOverflowProtection: true,
      },
      simulationMask: new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT),
      sourcePath: [start, prefixTarget],
      targetPoint: target,
    });

    expect(result.status).toBe("hit");
    expect(sampleFormulaTrajectory).toHaveBeenCalledTimes(1);
  });

  it("reuses prefix evidence before scanning post-collision gate candidates", () => {
    const start = graphToImagePoint(createGraphPoint(-11, 0), bounds, boundsRect);
    const prefixTarget = graphToImagePoint(createGraphPoint(-8.5, 0), bounds, boundsRect);
    const targetPoint = graphToImagePoint(createGraphPoint(-6, 0), bounds, boundsRect);
    const missedTarget = graphToImagePoint(createGraphPoint(-6, 8), bounds, boundsRect);

    const result = scanGraphwarStepGlitchPath({
      bounds,
      boundsRect,
      hitTarget: { center: missedTarget, radius: 2 },
      prefixEvidence: { acceptedPoint: createGraphPoint(-8.5, 0) },
      requiredTargets: [{ center: prefixTarget, radius: 12 }],
      settings: {
        algorithm: "step",
        decimalPlaces: 4,
        equation: "dy",
        steepness: 67,
        stepGlitchMode: true,
        stepOverflowProtection: true,
      },
      simulationMask: new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT),
      sourcePath: [start, prefixTarget],
      targetPoint,
    });

    expect(result.status).toBe("no-path");
    expect(result.expandedStates).toBeGreaterThan(1);
    expect(result.timings.map((timing) => timing.stage)).toEqual([
      "validate-direct",
      "prefix-evidence-hit",
      "scan-candidates",
    ]);
    expect(sampleFormulaTrajectory.mock.calls.length).toBeGreaterThan(1);
  });

  it("starts gate scanning at the prefix control x when a required hit lies beyond the new target", () => {
    replayMockState.farRequiredScenario = true;
    const start = graphToImagePoint(createGraphPoint(-11, 0), bounds, boundsRect);
    const prefixTarget = graphToImagePoint(createGraphPoint(-9, 0), bounds, boundsRect);
    const target = graphToImagePoint(createGraphPoint(-6, 4), bounds, boundsRect);
    const fartherRequired = graphToImagePoint(createGraphPoint(-5, 2), bounds, boundsRect);
    const simulationMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    const wallX = Math.floor(graphToImagePoint(createGraphPoint(-8, 0), bounds, boundsRect).x);
    for (let row = 180; row <= 270; row += 1) {
      simulationMask[row * GRAPHWAR_PLANE_LENGTH + wallX] = 1;
    }

    const result = scanGraphwarStepGlitchPath({
      bounds,
      boundsRect,
      hitTarget: { center: target, radius: 12 },
      prefixTarget: { center: prefixTarget, radius: 12 },
      requiredTargets: [{ center: fartherRequired, radius: 12 }],
      settings: {
        algorithm: "step",
        decimalPlaces: 4,
        equation: "dy",
        steepness: 67,
        stepGlitchMode: true,
        stepOverflowProtection: true,
      },
      simulationMask,
      sourcePath: [start, prefixTarget],
      targetPoint: target,
    });

    expect(result.status).toBe("hit");
    expect(sampleFormulaTrajectory).toHaveBeenCalledTimes(4);
  });

  it("prefers the hit-circle row after farthest x before trying narrower windows", () => {
    replayMockState.orderedRowScenario = true;
    const start = graphToImagePoint(createGraphPoint(-11, 0), bounds, boundsRect);
    const target = graphToImagePoint(createGraphPoint(-6, 8), bounds, boundsRect);
    const hitCenter = graphToImagePoint(createGraphPoint(-6, 6), bounds, boundsRect);

    const result = scanGraphwarStepGlitchPath({
      bounds,
      boundsRect,
      hitTarget: { center: hitCenter, radius: 12 },
      settings: {
        algorithm: "step",
        decimalPlaces: 4,
        equation: "dy",
        steepness: 67,
        stepGlitchMode: true,
        stepOverflowProtection: true,
      },
      simulationMask: new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT),
      sourcePath: [start],
      targetPoint: target,
    });

    expect(result.status).toBe("hit");
    expect(replayMockState.testedGateYs[0]).toBeCloseTo(
      imageToGraphPoint(createPixelPoint(0, Math.floor(hitCenter.y) + 0.5), bounds, boundsRect).y,
    );
    expect(replayMockState.testedGateYs[1]).toBeCloseTo(replayMockState.testedGateYs[0] ?? Number.NaN);
    expect(replayMockState.testedWindowWidths[0]).toBeCloseTo(GRAPHWAR_STEP_SIZE);
    expect(replayMockState.testedWindowWidths[1]).toBeCloseTo(GRAPHWAR_STEP_SIZE / 2);
  });

  it("uses distance from the current row before the row number when target distances tie", () => {
    replayMockState.orderedRowScenario = true;
    const start = graphToImagePoint(createGraphPoint(-11, 0), bounds, boundsRect);
    const targetX = graphToImagePoint(createGraphPoint(-6, 0), bounds, boundsRect).x;
    const target = createPixelPoint(targetX, 150.5);
    const simulationMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    const blockedX = Math.floor(graphToImagePoint(createGraphPoint(-8, 0), bounds, boundsRect).x);
    const lowerRowNumber = 100;
    const nearerStartRow = 200;
    for (let row = 0; row < GRAPHWAR_PLANE_HEIGHT; row += 1) {
      if (row !== lowerRowNumber && row !== nearerStartRow) {
        simulationMask[row * GRAPHWAR_PLANE_LENGTH + blockedX] = 1;
      }
    }

    const result = scanGraphwarStepGlitchPath({
      bounds,
      boundsRect,
      hitTarget: { center: target, radius: 12 },
      settings: {
        algorithm: "step",
        decimalPlaces: 4,
        equation: "dy",
        steepness: 67,
        stepGlitchMode: true,
        stepOverflowProtection: true,
      },
      simulationMask,
      sourcePath: [start],
      targetPoint: target,
    });

    expect(result.status).toBe("hit");
    expect(replayMockState.testedGateYs[0]).toBeCloseTo(
      imageToGraphPoint(createPixelPoint(0, nearerStartRow + 0.5), bounds, boundsRect).y,
    );
    expect(replayMockState.testedGateYs[1]).toBeCloseTo(replayMockState.testedGateYs[0] ?? Number.NaN);
    expect(replayMockState.testedWindowWidths[0]).toBeCloseTo(GRAPHWAR_STEP_SIZE);
    expect(replayMockState.testedWindowWidths[1]).toBeCloseTo(GRAPHWAR_STEP_SIZE / 2);
  });

  it("uses the row number only when both vertical distances tie", () => {
    replayMockState.orderedRowScenario = true;
    const start = graphToImagePoint(createGraphPoint(-11, 0), bounds, boundsRect);
    const target = graphToImagePoint(createGraphPoint(-6, 0), bounds, boundsRect);
    const simulationMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    const blockedX = Math.floor(graphToImagePoint(createGraphPoint(-8, 0), bounds, boundsRect).x);
    const lowerRowNumber = 200;
    const higherRowNumber = 250;
    for (let row = 0; row < GRAPHWAR_PLANE_HEIGHT; row += 1) {
      if (row !== lowerRowNumber && row !== higherRowNumber) {
        simulationMask[row * GRAPHWAR_PLANE_LENGTH + blockedX] = 1;
      }
    }

    const result = scanGraphwarStepGlitchPath({
      bounds,
      boundsRect,
      hitTarget: { center: target, radius: 12 },
      settings: {
        algorithm: "step",
        decimalPlaces: 4,
        equation: "dy",
        steepness: 67,
        stepGlitchMode: true,
        stepOverflowProtection: true,
      },
      simulationMask,
      sourcePath: [start],
      targetPoint: target,
    });

    expect(result.status).toBe("hit");
    expect(replayMockState.testedGateYs[0]).toBeCloseTo(
      imageToGraphPoint(createPixelPoint(0, lowerRowNumber + 0.5), bounds, boundsRect).y,
    );
    expect(replayMockState.testedGateYs[1]).toBeCloseTo(replayMockState.testedGateYs[0] ?? Number.NaN);
    expect(replayMockState.testedWindowWidths[0]).toBeCloseTo(GRAPHWAR_STEP_SIZE);
    expect(replayMockState.testedWindowWidths[1]).toBeCloseTo(GRAPHWAR_STEP_SIZE / 2);
  });

  it("exhausts every width on the farthest row before restarting at the widest width on the next row", () => {
    replayMockState.orderedGateSuccessAttempt = Number.POSITIVE_INFINITY;
    replayMockState.orderedRowScenario = true;
    const start = graphToImagePoint(createGraphPoint(-11, 0), bounds, boundsRect);
    const target = graphToImagePoint(createGraphPoint(-6, 8), bounds, boundsRect);
    const simulationMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    const blockedX = Math.floor(graphToImagePoint(createGraphPoint(-8, 0), bounds, boundsRect).x);
    const nearerRow = 100;
    const fartherRow = 400;
    for (let row = 0; row < GRAPHWAR_PLANE_HEIGHT; row += 1) {
      if (row !== nearerRow && row !== fartherRow) {
        simulationMask[row * GRAPHWAR_PLANE_LENGTH + blockedX] = 1;
      }
    }
    simulationMask[nearerRow * GRAPHWAR_PLANE_LENGTH + 500] = 1;

    const result = scanGraphwarStepGlitchPath({
      bounds,
      boundsRect,
      hitTarget: { center: target, radius: 12 },
      settings: {
        algorithm: "step",
        decimalPlaces: 4,
        equation: "dy",
        steepness: 67,
        stepGlitchMode: true,
        stepOverflowProtection: true,
      },
      simulationMask,
      sourcePath: [start],
      targetPoint: target,
    });
    let minimumWidth = GRAPHWAR_STEP_SIZE;
    while (minimumWidth > GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE) {
      minimumWidth /= 2;
    }
    const expectedWidths: number[] = [];
    for (let width = GRAPHWAR_STEP_SIZE; width >= minimumWidth; width /= 2) {
      expectedWidths.push(width);
    }
    const fartherY = imageToGraphPoint(createPixelPoint(0, fartherRow + 0.5), bounds, boundsRect).y;
    const nearerY = imageToGraphPoint(createPixelPoint(0, nearerRow + 0.5), bounds, boundsRect).y;

    expect(result.status).toBe("no-path");
    expect(result.expandedStates).toBe(1 + expectedWidths.length * 2);
    expect(replayMockState.testedGateYs).toEqual([
      ...Array.from({ length: expectedWidths.length }, () => fartherY),
      ...Array.from({ length: expectedWidths.length }, () => nearerY),
    ]);
    expect(replayMockState.testedWindowWidths).toHaveLength(expectedWidths.length * 2);
    for (let index = 0; index < replayMockState.testedWindowWidths.length; index += 1) {
      expect(replayMockState.testedWindowWidths[index]).toBeCloseTo(expectedWidths[index % expectedWidths.length] ?? 0);
    }
  });
});

function scanDirectTarget() {
  const start = graphToImagePoint(createGraphPoint(-11, 0), bounds, boundsRect);
  const target = graphToImagePoint(createGraphPoint(-6, 0), bounds, boundsRect);
  return scanGraphwarStepGlitchPath({
    bounds,
    boundsRect,
    hitTarget: { center: target, radius: 12 },
    settings: {
      algorithm: "step",
      decimalPlaces: 4,
      equation: "dy",
      steepness: 67,
      stepGlitchMode: true,
      stepOverflowProtection: true,
    },
    simulationMask: new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT),
    sourcePath: [start],
    targetPoint: target,
  });
}
