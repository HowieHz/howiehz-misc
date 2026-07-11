import { beforeEach, describe, expect, it, vi } from "vitest";

import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { graphToImagePoint } from "../../core/geometry";
import { createGraphPoint } from "../../core/types";
import type { BoundsRect, GraphBounds } from "../../core/types";

const replayMockState = vi.hoisted(() => ({
  callCount: 0,
  directSuccess: false,
  farRequiredScenario: false,
  targetHitIndex: 1,
}));
const sampleFormulaTrajectory = vi.hoisted(() => vi.fn());

vi.mock("../../formula/trajectory/sampling", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../formula/trajectory/sampling")>();
  return {
    ...original,
    sampleGraphwarFormulaTrajectory: sampleFormulaTrajectory.mockImplementation(
      (options: { requiredTargets?: readonly unknown[]; targetSequence?: readonly unknown[] }) => {
        replayMockState.callCount += 1;
        const requiredTargetCount = options.requiredTargets?.length ?? 0;
        const targetCount = options.targetSequence?.length ?? 0;
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
    replayMockState.directSuccess = false;
    replayMockState.farRequiredScenario = false;
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

  it("reuses prefix evidence and does not replay the failed direct candidate", () => {
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
    expect(result.expandedStates).toBe(1);
    expect(result.timings.map((timing) => timing.stage)).toEqual([
      "validate-direct",
      "prefix-evidence-hit",
      "scan-candidates",
    ]);
    expect(sampleFormulaTrajectory).toHaveBeenCalledTimes(1);
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
