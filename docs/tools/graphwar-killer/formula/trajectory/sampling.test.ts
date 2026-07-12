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
      stopOnTargetsComplete: false,
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
      stopOnTargetsComplete: false,
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

  it("stops only after the ordered target and every unordered required target are hit", () => {
    const orderedTarget = toPixel(GRAPHWAR_STEP_SIZE, 0);
    const nearerRequiredTarget = toPixel(GRAPHWAR_STEP_SIZE * 2, 0);
    const fartherRequiredTarget = toPixel(GRAPHWAR_STEP_SIZE * 3, 0);

    const result = sampleGraphwarFormulaTrajectory({
      bounds,
      boundsRect,
      context: createHorizontalFormulaContext(),
      initialState: {
        currentPoint: createGraphPoint(0, 0),
        sampleIndex: 0,
      },
      // 故意按实际命中顺序的反序传入，证明 requiredTargets 不携带顺序约束。
      requiredTargets: [
        { center: fartherRequiredTarget, radius: 0.01 },
        { center: nearerRequiredTarget, radius: 0.01 },
      ],
      targetSequence: [{ center: orderedTarget, radius: 0.01 }],
    });

    expect(result.earlyStopReason).toBe("target");
    expect(result.reachedTargetCount).toBe(1);
    expect(result.reachedRequiredTargetCount).toBe(2);
    expect(result.targetHitIndex).toBe(1);
    expect(result.requiredTargetsHitIndex).toBe(3);
    expect(result.sample.points.at(-1)).toEqual(createGraphPoint(GRAPHWAR_STEP_SIZE * 3, 0));
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
      stopOnTargetsComplete: false,
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
      graphwarTrajectoryReachesGraphXAfterTargetsBeforeObstacle(
        { obstacleHitIndex: 3, requiredTargetsHitIndex: -1, sample, targetHitIndex: 1 },
        2,
      ),
    ).toBe(true);
    expect(
      graphwarTrajectoryReachesGraphXAfterTargetsBeforeObstacle(
        { obstacleHitIndex: 3, requiredTargetsHitIndex: -1, sample, targetHitIndex: 3 },
        2,
      ),
    ).toBe(false);
    expect(
      graphwarTrajectoryReachesGraphXAfterTargetsBeforeObstacle(
        { obstacleHitIndex: 3, requiredTargetsHitIndex: -1, sample, targetHitIndex: 1 },
        3,
      ),
    ).toBe(false);
  });
});

describe("Step glitch formula prefix", () => {
  it("reuses an exact causal prefix without changing the appended formula", () => {
    const obstacleMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    const obstaclePixel = toPixel(-8, 0);
    obstacleMask[Math.floor(obstaclePixel.y) * GRAPHWAR_PLANE_LENGTH + Math.floor(obstaclePixel.x)] = 1;
    const stepSettings = {
      algorithm: "step" as const,
      decimalPlaces: 4,
      equation: "dy" as const,
      steepness: 67,
      stepGlitchMode: true,
      stepGlitchObstacleMask: obstacleMask,
      stepOverflowProtection: true,
    };
    const prefixPoints = [
      createGraphPoint(-11, 0),
      createGraphPoint(-6, 4),
      createGraphPoint(-5, 3),
      createGraphPoint(-4, 2),
    ];
    const prefix = createGraphwarTrajectoryFormulaContext({
      bounds,
      points: prefixPoints,
      settings: stepSettings,
      soldierCenter: prefixPoints[0],
    });
    const appendedPoints = [...prefixPoints, createGraphPoint(-3, 1)];
    const cold = createGraphwarTrajectoryFormulaContext({
      bounds,
      points: appendedPoints,
      settings: stepSettings,
      soldierCenter: appendedPoints[0],
    });
    const reused = createGraphwarTrajectoryFormulaContext({
      bounds,
      points: appendedPoints,
      settings: stepSettings,
      soldierCenter: appendedPoints[0],
      stepGlitchFormulaPrefix: prefix.stepGlitchFormulaPrefix,
    });
    const prefixFormula = prefix.stepGlitchFormulaPrefix;
    const rebuiltWithFixedWindows = prefixFormula
      ? createGraphwarTrajectoryFormulaContext({
          bounds,
          points: appendedPoints,
          settings: stepSettings,
          soldierCenter: appendedPoints[0],
          // 强制 prefix 身份失配，覆盖 sign epsilon 改变后必须重算旧段的分支。
          stepGlitchFormulaPrefix: { ...prefixFormula, signEpsilon: prefixFormula.signEpsilon + 1 },
          stepGlitchXWindows: prefixFormula.stepGlitchSegments.map((segment) =>
            segment ? { endX: segment.endX, startX: segment.startX } : undefined,
          ),
        })
      : undefined;

    expect(prefix.stepGlitchFormulaPrefix?.stepGlitchSegments[0]).toBeDefined();
    expect(reused.stepGlitchFormulaPrefix?.stepGlitchSegments[0]).toBe(
      prefix.stepGlitchFormulaPrefix?.stepGlitchSegments[0],
    );
    expect(reused.playbackExpression).toBe(cold.playbackExpression);
    expect(reused.formulaPoints).toEqual(cold.formulaPoints);
    expect(reused.stepGlitchFormulaPrefix?.refinedFormulaPoints).toEqual(
      cold.stepGlitchFormulaPrefix?.refinedFormulaPoints,
    );
    expect(reused.stepGlitchFormulaPrefix?.stepGlitchRequirements).toEqual(
      cold.stepGlitchFormulaPrefix?.stepGlitchRequirements,
    );
    expect(reused.stepGlitchFormulaPrefix?.stepGlitchSegments).toEqual(
      cold.stepGlitchFormulaPrefix?.stepGlitchSegments,
    );
    expect(reused.stepGlitchFormulaPrefix?.stepSegmentDeltaYs).toEqual(
      cold.stepGlitchFormulaPrefix?.stepSegmentDeltaYs,
    );
    expect(rebuiltWithFixedWindows?.stepGlitchFormulaPrefix?.stepGlitchSegments[0]).toMatchObject({
      endX: prefixFormula?.stepGlitchSegments[0]?.endX,
      startX: prefixFormula?.stepGlitchSegments[0]?.startX,
    });
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
