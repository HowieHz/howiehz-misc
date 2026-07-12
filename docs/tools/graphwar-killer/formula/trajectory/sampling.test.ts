import { describe, expect, it } from "vitest";

import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH, GRAPHWAR_STEP_SIZE } from "../../core/game/constants";
import { graphToImagePoint } from "../../core/geometry";
import { createGraphPoint, createPixelPoint } from "../../core/types";
import type { AlgorithmMode, BoundsRect, EquationMode, GraphBounds } from "../../core/types";
import { compileFormulaEvaluator, GraphwarSignRole } from "../generation/build";
import { sampleGraphwarExpressionTrajectory } from "../simulation/simulator";
import {
  getGraphwarTrajectoryLaunchAngle,
  graphwarTrajectoryReachesGraphXAfterTargetsBeforeObstacle,
  sampleGraphwarPathTargetSequence,
  resolveGraphwarTrajectory,
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
const horizontalPoints = [createGraphPoint(-1, 0), createGraphPoint(1, 0)];

describe("Graphwar trajectory target tracking", () => {
  it("tracks every strict-circle hit after the launch point while continuing past the ordered sequence", () => {
    const launchPixel = toPixel(0, 0);
    const firstPixel = toPixel(GRAPHWAR_STEP_SIZE, 0);
    const secondPixel = toPixel(GRAPHWAR_STEP_SIZE * 2, 0);
    const { result } = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      initialState: {
        currentPoint: createGraphPoint(0, 0),
        sampleIndex: 0,
      },
      points: horizontalPoints,
      settings,
      soldierCenter: horizontalPoints[0],
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

    const { result } = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      collision: { mask: obstacleMask },
      initialState: {
        currentPoint: createGraphPoint(0, 0),
        sampleIndex: 0,
      },
      points: horizontalPoints,
      settings,
      skipInitialStop: true,
      soldierCenter: horizontalPoints[0],
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

    const { result } = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      initialState: {
        currentPoint: createGraphPoint(0, 0),
        sampleIndex: 0,
      },
      points: horizontalPoints,
      // 故意按实际命中顺序的反序传入，证明 requiredTargets 不携带顺序约束。
      requiredTargets: [
        { center: fartherRequiredTarget, radius: 0.01 },
        { center: nearerRequiredTarget, radius: 0.01 },
      ],
      settings,
      soldierCenter: horizontalPoints[0],
      targetSequence: [{ center: orderedTarget, radius: 0.01 }],
    });

    expect(result.earlyStopReason).toBe("target");
    expect(result.reachedTargetCount).toBe(1);
    expect(result.reachedRequiredTargetCount).toBe(2);
    expect(result.targetHitIndex).toBe(1);
    expect(result.requiredTargetsHitIndex).toBe(3);
    expect(result.sample.points.at(-1)).toEqual(createGraphPoint(GRAPHWAR_STEP_SIZE * 3, 0));
  });

  it("revalidates seeded required targets after new sign protection invalidates the physical prefix", () => {
    const points = [createGraphPoint(-2, 0), createGraphPoint(0, 1), createGraphPoint(2, 2)];
    const requiredTarget = { center: toPixel(-1, 10), radius: 0.01 };
    const options = {
      bounds,
      boundsRect,
      initialReachedRequiredTargetCount: 1,
      initialState: { currentPoint: createGraphPoint(0, 1), sampleIndex: 200 },
      points,
      requiredTargets: [requiredTarget],
      settings: { ...settings, equation: "dy" as const },
      soldierCenter: points[0],
      targetSequence: [{ center: toPixel(1, 10), radius: 0.01 }],
    };

    const restarted = resolveGraphwarTrajectory(options);
    const reused = resolveGraphwarTrajectory({
      ...options,
      signProtection: [
        GraphwarSignRole.StartX | GraphwarSignRole.EndX,
        GraphwarSignRole.StartX | GraphwarSignRole.EndX,
      ],
    });

    // 未保护公式会在发射点确认零值并整路重跑；旧状态携带的命中计数不能跟着留下。
    expect(restarted.result.reachedRequiredTargetCount).toBe(0);
    expect(reused.result.reachedRequiredTargetCount).toBe(1);
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

describe("Generated formula evaluator equivalence", () => {
  const cases: readonly { algorithm: AlgorithmMode; equation: EquationMode }[] = [
    { algorithm: "abs", equation: "y" },
    { algorithm: "abs", equation: "dy" },
    { algorithm: "step", equation: "y" },
    { algorithm: "step", equation: "dy" },
    { algorithm: "step", equation: "ddy" },
    { algorithm: "pchip", equation: "y" },
    { algorithm: "pchip", equation: "dy" },
    { algorithm: "pchip", equation: "ddy" },
    { algorithm: "akima", equation: "y" },
    { algorithm: "akima", equation: "dy" },
    { algorithm: "akima", equation: "ddy" },
  ];

  for (const testCase of cases) {
    it(`matches parsed ${testCase.algorithm} ${testCase.equation} output exactly`, () => {
      const points = [
        createGraphPoint(-10, -1),
        createGraphPoint(-7, 2),
        createGraphPoint(-3, -2),
        createGraphPoint(1, 1),
      ];
      const resolved = resolveGraphwarTrajectory({
        bounds,
        boundsRect,
        points,
        settings: {
          algorithm: testCase.algorithm,
          decimalPlaces: 4,
          equation: testCase.equation,
          steepness: 210,
          stepGlitchMode: false,
          stepOverflowProtection: true,
        },
        soldierCenter: points[0],
      });
      const parsed = sampleGraphwarExpressionTrajectory({
        bounds,
        equation: testCase.equation,
        expression: resolved.context.formulaResult.expression,
        ...(testCase.equation === "ddy"
          ? { launchAngleRadians: getGraphwarTrajectoryLaunchAngle(resolved.context) }
          : {}),
        soldierCenter: points[0],
      });
      expectTrajectorySamplesToBeIdentical(resolved.result.sample, parsed);
    });
  }

  it("keeps protected multi-segment abs derivatives in Graphwar's right-associated order", () => {
    const points = [
      createGraphPoint(-10, -1),
      createGraphPoint(-5, 2),
      createGraphPoint(0, -2),
      createGraphPoint(5, 1),
    ];
    const resolved = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points,
      settings: { ...settings, equation: "dy" as const },
      signProtection: points.slice(1).map(() => GraphwarSignRole.StartX | GraphwarSignRole.EndX),
      soldierCenter: points[0],
    });
    const parsed = sampleGraphwarExpressionTrajectory({
      bounds,
      equation: "dy",
      expression: resolved.context.formulaResult.expression,
      soldierCenter: points[0],
    });

    expectTrajectorySamplesToBeIdentical(resolved.result.sample, parsed);
  });

  it("keeps soft ddy weighting finite when Graphwar divides before multiplying by two", () => {
    const evaluator = compileFormulaEvaluator(
      [
        createGraphPoint(0, 0),
        createGraphPoint(0.01, 1),
        createGraphPoint(53_950_000, 0),
        createGraphPoint(53_950_000.01, 1),
      ],
      1,
      "pchip",
      { equation: "ddy", formulaDecimalPlaces: 15 },
    );

    expect(Number.isNaN(evaluator.evaluateSecondDerivativeY(53_950_000))).toBe(false);
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
    const prefixResolution = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: prefixPoints,
      settings: stepSettings,
      soldierCenter: prefixPoints[0],
    });
    const prefix = prefixResolution.context;
    expectTrajectorySamplesToBeIdentical(
      prefixResolution.result.sample,
      sampleGraphwarExpressionTrajectory({
        bounds,
        equation: "dy",
        expression: prefix.formulaResult.expression,
        soldierCenter: prefixPoints[0],
      }),
    );
    const appendedPoints = [...prefixPoints, createGraphPoint(-3, 1)];
    const cold = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: appendedPoints,
      settings: stepSettings,
      soldierCenter: appendedPoints[0],
    }).context;
    const reused = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: appendedPoints,
      settings: stepSettings,
      soldierCenter: appendedPoints[0],
      stepGlitchFormulaPrefix: prefix.stepGlitchFormulaPrefix,
    }).context;
    const prefixFormula = prefix.stepGlitchFormulaPrefix;
    const rebuiltWithFixedWindows = prefixFormula
      ? resolveGraphwarTrajectory({
          bounds,
          boundsRect,
          points: appendedPoints,
          settings: stepSettings,
          signProtection: [],
          soldierCenter: appendedPoints[0],
          // 强制保护快照失配，覆盖未来段新增 epsilon 后必须重算旧段的分支。
          stepGlitchFormulaPrefix: { ...prefixFormula, signProtection: [1] },
          stepGlitchXWindows: prefixFormula.stepGlitchSegments.map((segment) =>
            segment ? { endX: segment.endX, startX: segment.startX } : undefined,
          ),
        }).context
      : undefined;

    expect(prefix.stepGlitchFormulaPrefix?.stepGlitchSegments[0]).toBeDefined();
    expect(reused.stepGlitchFormulaPrefix?.stepGlitchSegments[0]).toBe(
      prefix.stepGlitchFormulaPrefix?.stepGlitchSegments[0],
    );
    expect(reused.formulaResult.expression).toBe(cold.formulaResult.expression);
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

function toPixel(x: number, y: number) {
  return graphToImagePoint(createGraphPoint(x, y), bounds, boundsRect);
}

/**
 * Generated evaluators are authoritative only while every Graphwar double operation remains bit-for-bit text
 * equivalent.
 */
function expectTrajectorySamplesToBeIdentical(
  actual: { points: readonly { x: number; y: number }[]; stopReason: string },
  expected: { points: readonly { x: number; y: number }[]; stopReason: string },
) {
  expect(actual.stopReason).toBe(expected.stopReason);
  expect(actual.points).toHaveLength(expected.points.length);
  for (let index = 0; index < actual.points.length; index += 1) {
    expect(
      Object.is(actual.points[index]?.x, expected.points[index]?.x),
      `x differs at sample ${index}: ${actual.points[index]?.x} !== ${expected.points[index]?.x}`,
    ).toBe(true);
    expect(
      Object.is(actual.points[index]?.y, expected.points[index]?.y),
      `y differs at sample ${index}, x=${actual.points[index]?.x}: ${actual.points[index]?.y} !== ${expected.points[index]?.y}`,
    ).toBe(true);
  }
}
