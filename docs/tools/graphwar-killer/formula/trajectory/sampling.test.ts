import { describe, expect, it } from "vitest";

import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH, GRAPHWAR_STEP_SIZE } from "../../core/game/constants";
import { graphToImagePoint } from "../../core/geometry";
import { createGraphPoint, createPixelPoint } from "../../core/types";
import type { BoundsRect, GraphBounds } from "../../core/types";
import {
  createGraphwarTrajectoryFormulaContext,
  graphwarTrajectoryReachesGraphXAfterTargetsBeforeObstacle,
  sampleGraphwarFormulaTrajectory,
  sampleGraphwarPathTargetSequence,
} from "./sampling";

const bounds: GraphBounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
const boundsRect: BoundsRect = {
  height: GRAPHWAR_PLANE_HEIGHT,
  width: GRAPHWAR_PLANE_LENGTH,
  x: 0,
  y: 0,
};
const settings = {
  algorithm: "abs" as const,
  decimalPlaces: 4,
  equation: "y" as const,
  steepness: 1,
  stepGlitchMode: false,
  stepOverflowProtection: false,
};

describe("Graphwar trajectory target tracking", () => {
  it("tracks every strict-circle hit after the launch point while continuing past the ordered sequence", () => {
    const launchPixel = toPixel(0, 0);
    const firstPixel = toPixel(GRAPHWAR_STEP_SIZE, 0);
    const secondPixel = toPixel(GRAPHWAR_STEP_SIZE * 2, 0);
    const result = sampleGraphwarFormulaTrajectory({
      bounds,
      boundsRect,
      context: createHorizontalFormulaContext(),
      initialState: {
        currentPoint: createGraphPoint(0, 0),
        sampleIndex: 0,
      },
      stopOnTargetSequenceComplete: false,
      targetSequence: [{ center: firstPixel, radius: 0.01 }],
      trackedTargets: [
        { center: launchPixel, radius: 0.01 },
        { center: firstPixel, radius: 0.01 },
        { center: firstPixel, radius: 0.02 },
        { center: createPixelPoint(firstPixel.x, firstPixel.y + 1), radius: 1 },
        { center: secondPixel, radius: 0.01 },
      ],
    });

    expect(result.reachedTargetCount).toBe(1);
    expect(result.targetHitIndex).toBe(1);
    expect(result.trackedTargetHitIndexes).toEqual([-1, 1, 1, -1, 2]);
  });

  it("records all target hits on the terminal obstacle sample", () => {
    const firstPixel = toPixel(GRAPHWAR_STEP_SIZE, 0);
    const obstacleMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    const obstacleX = Math.floor(firstPixel.x);
    const obstacleY = Math.floor(firstPixel.y);
    obstacleMask[obstacleY * GRAPHWAR_PLANE_LENGTH + obstacleX] = 1;

    const result = sampleGraphwarFormulaTrajectory({
      bounds,
      boundsRect,
      collision: { mask: obstacleMask },
      context: createHorizontalFormulaContext(),
      initialState: {
        currentPoint: createGraphPoint(0, 0),
        sampleIndex: 0,
      },
      skipInitialStop: true,
      stopOnTargetSequenceComplete: false,
      targetSequence: [{ center: firstPixel, radius: 0.01 }],
      trackedTargets: [
        { center: firstPixel, radius: 0.01 },
        { center: firstPixel, radius: 0.02 },
      ],
    });

    expect(result.earlyStopReason).toBe("obstacle");
    expect(result.obstacleHitIndex).toBe(1);
    expect(result.reachedTargetCount).toBe(1);
    expect(result.targetHitIndex).toBe(1);
    expect(result.trackedTargetHitIndexes).toEqual([1, 1]);
  });

  it("exposes unordered hits and obstacle state through path target-sequence sampling", () => {
    const start = toPixel(-10, 0);
    const orderedTarget = toPixel(-8, 0);
    const trackedTarget = toPixel(-6, 0);
    const obstacleMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    obstacleMask[Math.floor(trackedTarget.y) * GRAPHWAR_PLANE_LENGTH + Math.floor(trackedTarget.x)] = 1;
    const options = {
      bounds,
      boundsRect,
      obstacleMask,
      points: [start, trackedTarget],
      settings,
      targetCircles: [{ center: orderedTarget, radius: 1 }],
      targetHitRadiusPixels: 1,
      targetPoints: [orderedTarget],
      trackedTargets: [{ center: trackedTarget, radius: 1 }],
    };

    const stopped = sampleGraphwarPathTargetSequence(options);
    const continued = sampleGraphwarPathTargetSequence({
      ...options,
      stopOnTargetSequenceComplete: false,
    });

    expect(stopped.trackedTargetHitIndexes).toEqual([-1]);
    expect(continued.reachesTargetSequenceBeforeObstacle).toBe(true);
    expect(continued.obstacleHitIndex).toBeGreaterThan(stopped.samplePointCount - 1);
    expect(continued.trackedTargetHitIndexes[0]).toBeGreaterThan(stopped.samplePointCount - 1);
    expect(continued.trackedTargetHitIndexes[0]).toBeLessThanOrEqual(continued.obstacleHitIndex);
  });

  it("requires a safe control-x sample after the ordered sequence is complete", () => {
    const sample = {
      points: [createGraphPoint(0, 0), createGraphPoint(1, 0), createGraphPoint(2, 0), createGraphPoint(3, 0)],
      stopReason: "stopped" as const,
    };

    expect(
      graphwarTrajectoryReachesGraphXAfterTargetsBeforeObstacle({ obstacleHitIndex: 3, sample, targetHitIndex: 1 }, 2),
    ).toBe(true);
    expect(
      graphwarTrajectoryReachesGraphXAfterTargetsBeforeObstacle({ obstacleHitIndex: 3, sample, targetHitIndex: 3 }, 2),
    ).toBe(false);
    expect(
      graphwarTrajectoryReachesGraphXAfterTargetsBeforeObstacle({ obstacleHitIndex: 3, sample, targetHitIndex: 1 }, 3),
    ).toBe(false);
  });
});

function createHorizontalFormulaContext() {
  const soldierCenter = createGraphPoint(-1, 0);
  return createGraphwarTrajectoryFormulaContext({
    bounds,
    points: [soldierCenter, createGraphPoint(1, 0)],
    settings,
    soldierCenter,
  });
}

function toPixel(x: number, y: number) {
  return graphToImagePoint(createGraphPoint(x, y), bounds, boundsRect);
}
