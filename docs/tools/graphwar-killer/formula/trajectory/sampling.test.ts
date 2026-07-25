import { describe, expect, it, vi } from "vitest";

import {
  GRAPHWAR_GAME_SOLDIER_RADIUS,
  GRAPHWAR_PLANE_HEIGHT,
  GRAPHWAR_PLANE_LENGTH,
  GRAPHWAR_STEP_SIZE,
} from "../../core/game/constants";
import { graphToImagePoint } from "../../core/geometry";
import { graphwarToolDefaults } from "../../core/tool/defaults";
import { createGraphPoint, createPixelPoint } from "../../core/types";
import type { AlgorithmMode, BoundsRect, EquationMode, GraphBounds, GraphPoint } from "../../core/types";
import { createGraphwarTrajectoryDebugMetrics } from "../debug-metrics";
import {
  buildFormula,
  compileFormulaEvaluator,
  compileGraphwarFormulaMaterials,
  GraphwarSignRole,
} from "../generation/build";
import { sampleGraphwarExpressionTrajectory, sampleGraphwarTrajectory } from "../simulation/simulator";
import {
  compareGraphwarPathErrors,
  continueResolvedGraphwarTrajectory,
  createGraphwarResolvedTrajectoryContinuationEvidence,
  createGraphwarTrajectoryFormulaMode,
  getGraphwarTrajectoryLaunchAngle,
  type GraphwarTrajectoryFormulaContext,
  GraphwarTrajectoryResolutionError,
  graphwarTrajectoryReachesGraphXAfterTargetsBeforeObstacle,
  measureGraphwarFormulaPathError,
  sampleGraphwarPathTargetSequence,
  resolveGraphwarTrajectory,
  tryResolveGraphwarTrajectoryCandidate,
} from "./sampling";

const buildMockState = vi.hoisted(() => ({
  materialIdentityNonce: 0,
  shouldForceMaterialIdentityMismatch: false,
}));

vi.mock("../generation/build", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../generation/build")>();
  return {
    ...actual,
    compileGraphwarFormulaMaterials: vi.fn((...args: Parameters<typeof actual.compileGraphwarFormulaMaterials>) => {
      const compiledMaterials = actual.compileGraphwarFormulaMaterials(...args);
      return buildMockState.shouldForceMaterialIdentityMismatch
        ? Object.assign(compiledMaterials, { testMaterialIdentityNonce: buildMockState.materialIdentityNonce++ })
        : compiledMaterials;
    }),
  };
});

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
  isStepGlitchModeEnabled: false,
  isStepOverflowProtectionEnabled: false,
};
const horizontalPoints = [createGraphPoint(-1, 0), createGraphPoint(1, 0)];
const ordinaryFormulaModes = [
  ["step", "y"],
  ["step", "dy"],
  ["step", "ddy"],
  ["abs", "y"],
  ["abs", "dy"],
  ["abs", "ddy"],
  ["pchip", "y"],
  ["pchip", "dy"],
  ["pchip", "ddy"],
  ["akima", "y"],
  ["akima", "dy"],
  ["akima", "ddy"],
] as const;

describe("Graphwar trajectory formula modes", () => {
  it("freezes a settings snapshot with its resolved contract", () => {
    const mutableSettings = { ...settings };
    const formulaMode = createGraphwarTrajectoryFormulaMode(mutableSettings);

    mutableSettings.steepness = 99;

    expect(formulaMode.settings.steepness).toBe(settings.steepness);
    expect(formulaMode.contract.formulaRefinement.type).toBe("direct");
    expect(Object.isFrozen(formulaMode)).toBe(true);
    expect(Object.isFrozen(formulaMode.contract)).toBe(true);
    expect(Object.isFrozen(formulaMode.settings)).toBe(true);
  });
});

describe("Graphwar trajectory target tracking", () => {
  it.each(ordinaryFormulaModes)(
    "keeps fixed-formula %s %s continuation identical through required, tracked, and collision boundaries",
    (algorithm, equation) => {
      const points = [createGraphPoint(-20, 0), createGraphPoint(-15, 0), createGraphPoint(-10, 0)];
      const requiredTargets = [{ center: toPixel(-15, 0), radius: 2 }];
      const targetSequence = [{ center: toPixel(-10, 0), radius: 2 }];
      const trackedTargets = [
        { center: toPixel(-15, 0), radius: 2 },
        { center: toPixel(-10, 0), radius: 2 },
        { center: toPixel(0, 0), radius: 2 },
      ];
      const obstaclePixel = toPixel(5, 0);
      const obstacleMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
      obstacleMask[Math.floor(obstaclePixel.y) * GRAPHWAR_PLANE_LENGTH + Math.floor(obstaclePixel.x)] = 1;
      const common = {
        bounds,
        boundsRect,
        collision: { mask: obstacleMask },
        collectVisiblePixels: true,
        points,
        requiredTargets,
        formulaMode: createGraphwarTrajectoryFormulaMode({
          ...settings,
          algorithm,
          equation,
          steepness: 67,
          isStepOverflowProtectionEnabled: true,
        }),
        soldierCenter: points[0],
        targetSequence,
        trackedTargets,
      } satisfies Parameters<typeof resolveGraphwarTrajectory>[0];
      const prefix = resolveGraphwarTrajectory(common);
      const evidence = createGraphwarResolvedTrajectoryContinuationEvidence(prefix);
      expect(evidence).toBeDefined();
      if (!evidence) {
        return;
      }
      const continued = continueResolvedGraphwarTrajectory({
        bounds,
        boundsRect,
        collision: common.collision,
        collectVisiblePixels: true,
        evidence,
        qualityPoints: [],
        requiredTargets,
        stopOnTargetsComplete: false,
        targetSequence,
        trackedTargets,
      });
      expect(continued.status).toBe("continued");
      if (continued.status !== "continued") {
        return;
      }
      const cold = resolveGraphwarTrajectory({ ...common, stopOnTargetsComplete: false });
      const combinedPoints = mergeContinuationTestPoints(prefix.result.sample.points, continued.result.sample.points);
      const combinedVisiblePixels = mergeContinuationTestPoints(
        prefix.result.visiblePixels,
        continued.result.visiblePixels,
      );
      const trackedTargetHitIndexes = trackedTargets.map((_target, targetIndex) => {
        const prefixHitIndex = prefix.result.trackedTargetHitIndexes[targetIndex] ?? -1;
        return prefixHitIndex >= 0 ? prefixHitIndex : (continued.result.trackedTargetHitIndexes[targetIndex] ?? -1);
      });

      expect(prefix.context.formulaResult.expression).toBe(cold.context.formulaResult.expression);
      expect(getGraphwarTrajectoryLaunchAngle(prefix.context)).toBe(getGraphwarTrajectoryLaunchAngle(cold.context));
      expect(prefix.context.signProtection).toEqual(cold.context.signProtection);
      expect(combinedPoints).toEqual(cold.result.sample.points);
      expect(continued.result.sample.endState).toEqual(cold.result.sample.endState);
      expect(continued.result.sample.stopReason).toBe(cold.result.sample.stopReason);
      expect(combinedVisiblePixels).toEqual(cold.result.visiblePixels);
      expect(continued.result.earlyStopReason).toBe(cold.result.earlyStopReason);
      expect(continued.result.obstacleHitIndex).toBe(cold.result.obstacleHitIndex);
      expect(continued.result.reachedRequiredTargetCount).toBe(cold.result.reachedRequiredTargetCount);
      expect(continued.result.reachedTargetCount).toBe(cold.result.reachedTargetCount);
      expect(prefix.result.requiredTargetsHitIndex).toBe(cold.result.requiredTargetsHitIndex);
      expect(prefix.result.targetHitIndex).toBe(cold.result.targetHitIndex);
      expect(trackedTargetHitIndexes).toEqual(cold.result.trackedTargetHitIndexes);
    },
  );

  it("requires a cold replay when resolved-continuation sign identity mismatches", () => {
    const target = { center: toPixel(0, 0), radius: 2 };
    const prefix = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: horizontalPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode(settings),
      soldierCenter: horizontalPoints[0],
      targetSequence: [target],
    });
    const evidence = createGraphwarResolvedTrajectoryContinuationEvidence(prefix);
    expect(evidence).toBeDefined();
    if (!evidence) {
      return;
    }
    const incompatibleSignProtection = [...prefix.context.signProtection];
    incompatibleSignProtection[0] = (incompatibleSignProtection[0] ?? 0) ^ GraphwarSignRole.StartX;
    const debugMetrics = createGraphwarTrajectoryDebugMetrics();

    const continued = continueResolvedGraphwarTrajectory({
      bounds,
      boundsRect,
      debugMetrics,
      evidence: {
        ...evidence,
        start: { ...evidence.start, signProtection: incompatibleSignProtection },
      },
      stopOnTargetsComplete: false,
      targetSequence: [target],
    });

    expect(continued).toEqual({ status: "cold-required" });
    expect(debugMetrics.counters.trajectoryReplayCount).toBe(0);
  });

  it("rechecks collision at a target-completion continuation seam", () => {
    const points = [createGraphPoint(-20, 0), createGraphPoint(-10, 0)];
    const target = { center: toPixel(-10, 0), radius: 2 };
    const probe = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      collectVisiblePixels: true,
      points,
      formulaMode: createGraphwarTrajectoryFormulaMode(settings),
      soldierCenter: points[0],
      targetSequence: [target],
    });
    const seamPixel = probe.result.visiblePixels.at(-1);
    if (!seamPixel) {
      throw new Error("Expected the target-completion sample to expose a visible seam point");
    }
    const obstacleMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    obstacleMask[Math.floor(seamPixel.y) * GRAPHWAR_PLANE_LENGTH + Math.floor(seamPixel.x)] = 1;
    const common = {
      bounds,
      boundsRect,
      collision: { mask: obstacleMask },
      collectVisiblePixels: true,
      points,
      formulaMode: createGraphwarTrajectoryFormulaMode(settings),
      soldierCenter: points[0],
      targetSequence: [target],
    } satisfies Parameters<typeof resolveGraphwarTrajectory>[0];
    const prefix = resolveGraphwarTrajectory(common);
    const evidence = createGraphwarResolvedTrajectoryContinuationEvidence(prefix);
    if (!evidence) {
      throw new Error("Expected target completion to expose a resumable state");
    }

    const continued = continueResolvedGraphwarTrajectory({
      bounds,
      boundsRect,
      collision: common.collision,
      collectVisiblePixels: true,
      evidence,
      stopOnTargetsComplete: false,
      targetSequence: [target],
    });
    const cold = resolveGraphwarTrajectory({ ...common, stopOnTargetsComplete: false });

    expect(prefix.result.earlyStopReason).toBe("target");
    expect(continued.status).toBe("continued");
    if (continued.status === "continued") {
      expect(continued.result.obstacleHitIndex).toBe(cold.result.obstacleHitIndex);
      expect(mergeContinuationTestPoints(prefix.result.visiblePixels, continued.result.visiblePixels)).toEqual(
        cold.result.visiblePixels,
      );
    }
  });

  it("requires a cold replay when resolved context and continuation state come from different formulas", () => {
    const target = { center: toPixel(0, 0), radius: 2 };
    const first = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: horizontalPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode(settings),
      soldierCenter: horizontalPoints[0],
      targetSequence: [target],
    });
    const secondPoints = [createGraphPoint(-1, 1), createGraphPoint(1, 2)];
    const second = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: secondPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode(settings),
      soldierCenter: secondPoints[0],
      targetSequence: [{ center: toPixel(0, 1.5), radius: 2 }],
    });
    const evidence = createGraphwarResolvedTrajectoryContinuationEvidence(first);
    if (!evidence) {
      throw new Error("Expected the first formula to expose a resumable state");
    }

    expect(
      continueResolvedGraphwarTrajectory({
        bounds,
        boundsRect,
        evidence: { ...evidence, context: second.context },
        stopOnTargetsComplete: false,
      }),
    ).toEqual({ status: "cold-required" });
  });

  it("preserves exact required, ordered, and tracked indexes across multiple fixed-formula continuations", () => {
    const points = [
      createGraphPoint(-20, 0),
      createGraphPoint(-15, 0),
      createGraphPoint(-10, 0),
      createGraphPoint(-5, 0),
    ];
    const targets = [
      { center: toPixel(-15, 0), radius: 2 },
      { center: toPixel(-10, 0), radius: 2 },
      { center: toPixel(-5, 0), radius: 2 },
    ];
    const first = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      collectVisiblePixels: true,
      points,
      formulaMode: createGraphwarTrajectoryFormulaMode(settings),
      soldierCenter: points[0],
      targetSequence: [targets[0]],
      trackedTargets: targets,
    });
    const firstEvidence = createGraphwarResolvedTrajectoryContinuationEvidence(first, {
      reachedRequiredTargetCount: 1,
      reachedTargetCount: 0,
    });
    if (!firstEvidence) {
      throw new Error("Expected the first target to expose continuation evidence");
    }
    const second = continueResolvedGraphwarTrajectory({
      bounds,
      boundsRect,
      collectVisiblePixels: true,
      evidence: firstEvidence,
      requiredTargets: [targets[0]],
      targetSequence: [targets[1]],
      trackedTargets: targets,
    });
    if (second.status !== "continued") {
      throw new Error("Expected the second target to continue the fixed formula");
    }
    const secondEvidence = createGraphwarResolvedTrajectoryContinuationEvidence(
      { context: first.context, result: second.result },
      { reachedRequiredTargetCount: 2, reachedTargetCount: 0 },
    );
    if (!secondEvidence) {
      throw new Error("Expected the second target to expose continuation evidence");
    }
    const third = continueResolvedGraphwarTrajectory({
      bounds,
      boundsRect,
      collectVisiblePixels: true,
      evidence: secondEvidence,
      requiredTargets: targets.slice(0, 2),
      stopOnTargetsComplete: false,
      targetSequence: [targets[2]],
      trackedTargets: targets,
    });
    if (third.status !== "continued") {
      throw new Error("Expected the third target to continue the fixed formula");
    }
    const cold = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      collectVisiblePixels: true,
      points,
      requiredTargets: targets.slice(0, 2),
      formulaMode: createGraphwarTrajectoryFormulaMode(settings),
      soldierCenter: points[0],
      stopOnTargetsComplete: false,
      targetSequence: [targets[2]],
      trackedTargets: targets,
    });
    const mergedPoints = mergeContinuationTestPoints(
      mergeContinuationTestPoints(first.result.sample.points, second.result.sample.points),
      third.result.sample.points,
    );
    const mergedVisiblePixels = mergeContinuationTestPoints(
      mergeContinuationTestPoints(first.result.visiblePixels, second.result.visiblePixels),
      third.result.visiblePixels,
    );
    const mergedTrackedTargetHitIndexes = targets.map((_target, targetIndex) =>
      [first.result, second.result, third.result]
        .map((result) => result.trackedTargetHitIndexes[targetIndex] ?? -1)
        .find((index) => index >= 0),
    );

    expect(second.result.requiredTargetsHitIndex).toBe(first.result.targetHitIndex);
    expect(third.result.requiredTargetsHitIndex).toBe(second.result.targetHitIndex);
    expect(third.result.requiredTargetsHitIndex).toBe(cold.result.requiredTargetsHitIndex);
    expect(third.result.targetHitIndex).toBe(cold.result.targetHitIndex);
    expect(mergedTrackedTargetHitIndexes).toEqual(cold.result.trackedTargetHitIndexes);
    expect(mergedPoints).toEqual(cold.result.sample.points);
    expect(mergedVisiblePixels).toEqual(cold.result.visiblePixels);
  });

  it("tracks every strict-circle hit after the launch point while continuing past the ordered sequence", () => {
    const launchPixel = toPixel(0, 0);
    const firstPixel = toPixel(GRAPHWAR_STEP_SIZE, 0);
    const secondPixel = toPixel(GRAPHWAR_STEP_SIZE * 2, 0);
    const { result } = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: horizontalPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode(settings),
      soldierCenter: horizontalPoints[0],
      start: {
        reachedRequiredTargetCount: 0,
        reachedTargetCount: 0,
        samplingState: {
          currentPoint: createGraphPoint(0, 0),
          sampleIndex: 0,
        },
        shouldSkipInitialStop: false,
        signProtection: [],
        type: "continuation",
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

    const { result } = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      collision: { mask: obstacleMask },
      points: horizontalPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode(settings),
      soldierCenter: horizontalPoints[0],
      start: {
        reachedRequiredTargetCount: 0,
        reachedTargetCount: 0,
        samplingState: {
          currentPoint: createGraphPoint(0, 0),
          sampleIndex: 0,
        },
        shouldSkipInitialStop: true,
        signProtection: [],
        type: "continuation",
      },
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
      points: horizontalPoints,
      // 故意按实际命中顺序的反序传入，证明 requiredTargets 不携带顺序约束。
      requiredTargets: [
        { center: fartherRequiredTarget, radius: 0.01 },
        { center: nearerRequiredTarget, radius: 0.01 },
      ],
      formulaMode: createGraphwarTrajectoryFormulaMode(settings),
      soldierCenter: horizontalPoints[0],
      start: {
        reachedRequiredTargetCount: 0,
        reachedTargetCount: 0,
        samplingState: {
          currentPoint: createGraphPoint(0, 0),
          sampleIndex: 0,
        },
        shouldSkipInitialStop: false,
        signProtection: [],
        type: "continuation",
      },
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
      points,
      requiredTargets: [requiredTarget],
      formulaMode: createGraphwarTrajectoryFormulaMode({ ...settings, equation: "dy" as const }),
      soldierCenter: points[0],
      start: {
        reachedRequiredTargetCount: 1,
        reachedTargetCount: 0,
        samplingState: { currentPoint: createGraphPoint(0, 1), sampleIndex: 200 },
        shouldSkipInitialStop: false,
        signProtection: [],
        type: "continuation" as const,
      },
      targetSequence: [{ center: toPixel(1, 10), radius: 0.01 }],
    };

    const restarted = resolveGraphwarTrajectory(options);
    const reused = resolveGraphwarTrajectory({
      ...options,
      start: {
        ...options.start,
        signProtection: [
          GraphwarSignRole.StartX | GraphwarSignRole.EndX,
          GraphwarSignRole.StartX | GraphwarSignRole.EndX,
        ],
      },
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
      formulaMode: createGraphwarTrajectoryFormulaMode(settings),
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

describe("formula path quality", () => {
  it("uses the first accepted x+ point and reports undefined or Infinity without masking missing controls", () => {
    const samplePoints = [createGraphPoint(0, 0), createGraphPoint(1, 2), createGraphPoint(2, 4)];

    expect(measureGraphwarFormulaPathError(samplePoints, [], bounds)).toBeUndefined();
    expect(measureGraphwarFormulaPathError(samplePoints, [createGraphPoint(0.5, 1)], bounds)).toBe(15);
    expect(measureGraphwarFormulaPathError(samplePoints, [createGraphPoint(3, 4)], bounds)).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(
      measureGraphwarFormulaPathError(samplePoints, [createGraphPoint(0.5, 1)], {
        maxX: -25,
        maxY: -15,
        minX: 25,
        minY: 15,
      }),
    ).toBe(15);
  });

  it("keeps Infinity ordering stable and ignores absent quality sets", () => {
    expect(compareGraphwarPathErrors(1, Number.POSITIVE_INFINITY)).toBeLessThan(0);
    expect(compareGraphwarPathErrors(Number.POSITIVE_INFINITY, 1)).toBeGreaterThan(0);
    expect(compareGraphwarPathErrors(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(0);
    expect(compareGraphwarPathErrors(undefined, 1)).toBe(0);
  });

  it("excludes every control point already constrained by a real target circle", () => {
    const start = toPixel(-10, 0);
    const middle = toPixel(-5, 0);
    const target = toPixel(1, 0);
    const result = sampleGraphwarPathTargetSequence({
      bounds,
      boundsRect,
      points: [start, middle, target],
      formulaMode: createGraphwarTrajectoryFormulaMode(settings),
      targetCircles: [{ center: target, radius: 1 }],
      targetControlPoints: [middle, target],
      targetHitRadiusPixels: 1,
      targetPoints: [target],
    });

    expect(result.pathError).toBeUndefined();
  });
});

describe("Generated formula evaluator equivalence", () => {
  const decimalPlacesCases = [0, 4, 15] as const;
  const cases: readonly { algorithm: AlgorithmMode; equation: EquationMode }[] = [
    { algorithm: "abs", equation: "y" },
    { algorithm: "abs", equation: "dy" },
    { algorithm: "abs", equation: "ddy" },
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
    for (const decimalPlaces of decimalPlacesCases) {
      it(`matches parsed ${testCase.algorithm} ${testCase.equation} output exactly at ${decimalPlaces} decimals`, () => {
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
          formulaMode: createGraphwarTrajectoryFormulaMode({
            algorithm: testCase.algorithm,
            decimalPlaces,
            equation: testCase.equation,
            steepness: 210,
            isStepGlitchModeEnabled: false,
            isStepOverflowProtectionEnabled: true,
          }),
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
  }

  it("matches the parsed Step y'' trajectory with mirrored coordinate bounds", () => {
    const mirroredBounds = { maxX: -25, maxY: -15, minX: 25, minY: 15 };
    const points = [
      createGraphPoint(-10, -1),
      createGraphPoint(-7, 2),
      createGraphPoint(-3, -2),
      createGraphPoint(1, 1),
    ];
    const resolved = resolveGraphwarTrajectory({
      bounds: mirroredBounds,
      boundsRect,
      points,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "step",
        decimalPlaces: 15,
        equation: "ddy",
        steepness: 210,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: points[0],
    });

    expectTrajectorySamplesToBeIdentical(
      resolved.result.sample,
      sampleGraphwarExpressionTrajectory({
        bounds: mirroredBounds,
        equation: "ddy",
        expression: resolved.context.formulaResult.expression,
        launchAngleRadians: getGraphwarTrajectoryLaunchAngle(resolved.context),
        soldierCenter: points[0],
      }),
    );
  });

  it("matches omitted zero and right-associated ABS segments on exact protected control lines", () => {
    const soldierCenter = createGraphPoint(-GRAPHWAR_GAME_SOLDIER_RADIUS, 0);
    const points = [
      createGraphPoint(0, 0),
      createGraphPoint(GRAPHWAR_STEP_SIZE, 0),
      createGraphPoint(2 * GRAPHWAR_STEP_SIZE, 0.0001),
      createGraphPoint(3 * GRAPHWAR_STEP_SIZE, -0.0001),
      createGraphPoint(4 * GRAPHWAR_STEP_SIZE, 0.0002),
    ];
    const formulaEvaluation = {
      equation: "dy" as const,
      formulaDecimalPlaces: 4,
      signProtection: [
        0,
        GraphwarSignRole.StartX | GraphwarSignRole.EndX,
        GraphwarSignRole.StartX | GraphwarSignRole.EndX,
        GraphwarSignRole.StartX | GraphwarSignRole.EndX,
      ],
    };
    const initialState = { currentPoint: points[0], sampleIndex: 0 };
    const compiledMaterials = compileGraphwarFormulaMaterials(points, 1, "abs", formulaEvaluation);
    const expression = buildFormula(points, 1, "dy", "abs", 4, {
      compiledMaterials,
      signProtection: formulaEvaluation.signProtection,
    }).expression;
    const compiled = sampleGraphwarTrajectory({
      algorithm: "abs",
      bounds,
      compiledFormulaMaterials: compiledMaterials,
      equation: "dy",
      formulaEvaluation,
      initialState,
      points,
      soldierCenter,
      steepness: 1,
    });
    const parsed = sampleGraphwarExpressionTrajectory({
      bounds,
      equation: "dy",
      expression,
      initialState,
      soldierCenter,
    });

    expect(compiledMaterials.absSegments?.map((segment) => segment.sourceSegmentIndex)).toEqual([1, 2, 3]);
    for (const controlX of [
      GRAPHWAR_STEP_SIZE,
      2 * GRAPHWAR_STEP_SIZE,
      3 * GRAPHWAR_STEP_SIZE,
      4 * GRAPHWAR_STEP_SIZE,
    ]) {
      const controlIndex = compiled.points.findIndex((point) => Object.is(point.x, controlX));
      expect(controlIndex).toBeGreaterThan(0);
      expect(compiled.points[controlIndex - 1]?.x).toBeLessThan(controlX);
      expect(compiled.points[controlIndex + 1]?.x).toBeGreaterThan(controlX);
    }
    expectTrajectorySamplesToBeIdentical(compiled, parsed);
  });

  it("matches the complete Step y'' trajectory before, on, and after protected high-precision gates", () => {
    const soldierCenter = createGraphPoint(-GRAPHWAR_GAME_SOLDIER_RADIUS, 0);
    const points = [createGraphPoint(0, 0), createGraphPoint(1, 0)];
    const startX = GRAPHWAR_STEP_SIZE;
    const pulseEndX = 2 * GRAPHWAR_STEP_SIZE;
    const formulaEvaluation = {
      equation: "ddy" as const,
      formulaDecimalPlaces: 4,
      signProtection: [
        GraphwarSignRole.StartX | GraphwarSignRole.EndX | GraphwarSignRole.GateY | GraphwarSignRole.BrakingGateY,
      ],
      stepGlitchSegments: [
        {
          acceleration: 0.123456789012345,
          accelerationGateY: 1.123456789012345,
          braking: -0.123456789012345,
          brakingGateY: 1.123456789012345,
          endX: 3 * GRAPHWAR_STEP_SIZE,
          equation: "ddy" as const,
          formulaDecimalPlaces: 15,
          pulseEndX,
          startX,
          targetY: 0,
        },
      ],
      isStepOverflowProtectionEnabled: true,
    };
    const compiledMaterials = compileGraphwarFormulaMaterials(points, 210, "step", formulaEvaluation);
    const expression = buildFormula(points, 210, "ddy", "step", 4, {
      compiledMaterials,
      signProtection: formulaEvaluation.signProtection,
      isStepOverflowProtectionEnabled: true,
    }).expression;
    const compiled = sampleGraphwarTrajectory({
      algorithm: "step",
      bounds,
      compiledFormulaMaterials: compiledMaterials,
      equation: "ddy",
      formulaEvaluation,
      launchAngleRadians: 0,
      points,
      soldierCenter,
      steepness: 210,
    });
    const parsed = sampleGraphwarExpressionTrajectory({
      bounds,
      equation: "ddy",
      expression,
      launchAngleRadians: 0,
      soldierCenter,
    });

    expect(compiledMaterials.stepFormula?.terms[0]?.glitchSegment?.formulaDecimalPlaces).toBe(15);
    for (const gateX of [startX, pulseEndX]) {
      const gateIndex = compiled.points.findIndex((point) => Object.is(point.x, gateX));
      expect(gateIndex).toBeGreaterThan(0);
      expect(compiled.points[gateIndex - 1]?.x).toBeLessThan(gateX);
      expect(compiled.points[gateIndex + 1]?.x).toBeGreaterThan(gateX);
    }
    expectTrajectorySamplesToBeIdentical(compiled, parsed);
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

describe("Canonical formula settings behavior", () => {
  const points = [createGraphPoint(-10, -1), createGraphPoint(-7, 2), createGraphPoint(-3, -2), createGraphPoint(1, 1)];
  const cases = [
    {
      changedSettings: { isStepOverflowProtectionEnabled: true },
      name: "Step y overflow protection",
      settings: {
        algorithm: "step" as const,
        decimalPlaces: 4,
        equation: "y" as const,
        steepness: 210,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: false,
      },
    },
    {
      changedSettings: { secondOrderLaunchAngleMode: "display-rounded" as const },
      name: "non-second-order launch angle mode",
      settings: {
        algorithm: "step" as const,
        decimalPlaces: 4,
        equation: "dy" as const,
        secondOrderLaunchAngleMode: "full-precision" as const,
        steepness: 210,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      },
    },
    {
      changedSettings: { formulaPathSteepness: 211 },
      name: "non-Step formula-path steepness",
      settings: {
        algorithm: "abs" as const,
        decimalPlaces: 4,
        equation: "dy" as const,
        formulaPathSteepness: 210,
        steepness: 67,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      },
    },
  ];

  for (const testCase of cases) {
    it(`keeps real ${testCase.name} trajectories identical`, () => {
      const baseline = resolveGraphwarTrajectory({
        bounds,
        boundsRect,
        points,
        formulaMode: createGraphwarTrajectoryFormulaMode(testCase.settings),
        soldierCenter: points[0],
      });
      const changed = resolveGraphwarTrajectory({
        bounds,
        boundsRect,
        points,
        formulaMode: createGraphwarTrajectoryFormulaMode({ ...testCase.settings, ...testCase.changedSettings }),
        soldierCenter: points[0],
      });

      expect(changed.context.formulaResult.expression).toBe(baseline.context.formulaResult.expression);
      expect(changed.context.formulaPoints).toEqual(baseline.context.formulaPoints);
      expectTrajectorySamplesToBeIdentical(changed.result.sample, baseline.result.sample);
    });
  }
});

describe("ODE segment position compensation", () => {
  const points = [
    createGraphPoint(-23.376623376623378, 2.5974025974025974),
    ...Array.from({ length: 8 }, (_, index) => createGraphPoint(-19 + 2 * index, -2 * index)),
  ];

  it.each(["dy", "ddy"] as const)(
    "falls back to a real hard Step for the adjacent %s target when soft Step cannot connect",
    (equation) => {
      const reproductionPoints = [
        createGraphPoint(-22.857142857142858, 13.571428571428571),
        createGraphPoint(-22.467532467532468, 1.7532467532467528),
      ];
      const targetPoint = toPixel(reproductionPoints[1].x, reproductionPoints[1].y);
      const baseSettings = {
        algorithm: "step" as const,
        decimalPlaces: 4,
        equation,
        steepness: 210,
        isStepOverflowProtectionEnabled: true,
      };
      const soft = resolveGraphwarTrajectory({
        bounds,
        boundsRect,
        points: reproductionPoints,
        formulaMode: createGraphwarTrajectoryFormulaMode({ ...baseSettings, isStepGlitchModeEnabled: false }),
        soldierCenter: reproductionPoints[0],
        targetHitRadiusPixels: 7,
        targetPoint,
      });
      const hard = resolveGraphwarTrajectory({
        bounds,
        boundsRect,
        points: reproductionPoints,
        formulaMode: createGraphwarTrajectoryFormulaMode({ ...baseSettings, isStepGlitchModeEnabled: true }),
        soldierCenter: reproductionPoints[0],
        stopOnTargetsComplete: false,
        targetHitRadiusPixels: 7,
        targetPoint,
      });

      expect(soft.result.targetHitIndex).toBe(-1);
      expect(soft.context.compiledMaterials.stepFormula?.terms[0]?.glitchSegment).toBeUndefined();
      expect(hard.result.targetHitIndex).toBeGreaterThanOrEqual(0);
      const hardSegment = hard.context.compiledMaterials.stepFormula?.terms[0]?.glitchSegment;
      expect(hardSegment).toMatchObject({ equation });
      if (equation === "dy") {
        expect(hard.context.formulaPoints[0]).not.toEqual(soft.context.formulaPoints[0]);
      } else {
        const launchAngleRadians = hard.context.launchAngleRadians;
        expect(launchAngleRadians).toBeDefined();
        if (launchAngleRadians === undefined) {
          return;
        }
        expect(Math.abs(launchAngleRadians)).toBeGreaterThan(0);
        expect(hard.context.stepGlitchFormulaEvidence?.prefix.launchAngleRadians).toBe(launchAngleRadians);
        expect(hardSegment?.equation).toBe("ddy");
        if (hardSegment?.equation === "ddy") {
          const landingState = sampleResolvedSecondOrderStateAtX(hard.context, reproductionPoints[0], hardSegment.endX);
          expect(landingState?.dy).toBeDefined();
          expect(Math.abs(landingState?.dy ?? Number.POSITIVE_INFINITY)).toBeLessThan(
            Math.abs(Math.tan(launchAngleRadians)) / 4,
          );
        }
      }
      expectTrajectorySamplesToBeIdentical(
        hard.result.sample,
        sampleGraphwarExpressionTrajectory({
          bounds,
          equation,
          expression: hard.context.formulaResult.expression,
          ...(equation === "ddy" ? { launchAngleRadians: getGraphwarTrajectoryLaunchAngle(hard.context) } : {}),
          soldierCenter: reproductionPoints[0],
        }),
      );
    },
  );

  it.each(["dy", "ddy"] as const)("replaces only a later failed %s segment with hard Step", (equation) => {
    const pathPoints = [
      createGraphPoint(-24, 12),
      createGraphPoint(-22.857142857142858, 13.571428571428571),
      createGraphPoint(-22.84714285714286, 1.7532467532467528),
    ];
    const resolved = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: pathPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "step",
        decimalPlaces: 4,
        equation,
        steepness: 210,
        isStepGlitchModeEnabled: true,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: pathPoints[0],
      targetHitRadiusPixels: 7,
      targetPoint: toPixel(pathPoints[2].x, pathPoints[2].y),
    });

    const terms = resolved.context.compiledMaterials.stepFormula?.terms;
    expect(terms).toBeDefined();
    if (!terms) {
      return;
    }
    expect(terms.some((term) => term.sourceSegmentIndex === 0 && term.glitchSegment !== undefined)).toBe(false);
    expect(terms.find((term) => term.sourceSegmentIndex === 1)?.glitchSegment).toMatchObject({ equation });
    expect(resolved.result.targetHitIndex).toBeGreaterThanOrEqual(0);
  });

  it("continues a later hard y'' Step from its exact boundary within the same solve", () => {
    const pathPoints = [
      createGraphPoint(-24, 12),
      createGraphPoint(-22.857142857142858, 13.571428571428571),
      createGraphPoint(-22.84714285714286, 1.7532467532467528),
      createGraphPoint(-20, 0),
    ];
    const options = {
      bounds,
      boundsRect,
      points: pathPoints,
      qualityPoints: pathPoints.slice(1),
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "step",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 210,
        isStepGlitchModeEnabled: true,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: pathPoints[0],
    } satisfies Parameters<typeof resolveGraphwarTrajectory>[0];
    const baseline = resolveGraphwarTrajectory(options);
    const fixedOptions = {
      ...options,
      start: { signProtection: [GraphwarSignRole.StartX], type: "cold" as const },
      stepGlitchXWindows: baseline.context.stepGlitchFormulaEvidence?.prefix.stepGlitchSegments.map((segment) =>
        segment ? { endX: segment.endX, startX: segment.startX } : undefined,
      ),
    } satisfies Parameters<typeof resolveGraphwarTrajectory>[0];
    const debugMetrics = createGraphwarTrajectoryDebugMetrics();
    const resolved = resolveGraphwarTrajectory({
      ...fixedOptions,
      debugMetrics,
    });
    const forcedColdMetrics = createGraphwarTrajectoryDebugMetrics();
    const forcedCold = resolveWithForcedMaterialIdentityMismatch({
      ...fixedOptions,
      debugMetrics: forcedColdMetrics,
    });

    expect(resolved.context.signProtection).toEqual([GraphwarSignRole.StartX]);
    expect(resolved.context.stepGlitchFormulaEvidence?.prefix.stepGlitchRequirements).toEqual([false, true, false]);
    // 同一 matcher 同时复用前一 soft 段和当前 hard 段的精确边界，各省一次 cold replay。
    expect(forcedColdMetrics.counters.trajectoryReplayCount - debugMetrics.counters.trajectoryReplayCount).toBe(2);
    expect(debugMetrics.counters.rk4StepCount).toBeLessThan(forcedColdMetrics.counters.rk4StepCount);
    expect(resolved.context.formulaResult.expression).toBe(forcedCold.context.formulaResult.expression);
    expect(getGraphwarTrajectoryLaunchAngle(resolved.context)).toBe(
      getGraphwarTrajectoryLaunchAngle(forcedCold.context),
    );
    expect(resolved.context.signProtection).toEqual(forcedCold.context.signProtection);
    expectTrajectorySamplesToBeIdentical(resolved.result.sample, forcedCold.result.sample);
    expectTrajectorySamplesToBeIdentical(
      resolved.result.sample,
      sampleGraphwarExpressionTrajectory({
        bounds,
        equation: "ddy",
        expression: resolved.context.formulaResult.expression,
        launchAngleRadians: getGraphwarTrajectoryLaunchAngle(resolved.context),
        soldierCenter: pathPoints[0],
      }),
    );
  });

  it("continues a hard y' Step boundary through the same-solve matcher", () => {
    const pathPoints = [
      createGraphPoint(-24, 12),
      createGraphPoint(-22.857142857142858, 13.571428571428571),
      createGraphPoint(-22.84714285714286, 1.7532467532467528),
    ];
    const options = {
      bounds,
      boundsRect,
      points: pathPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "step" as const,
        decimalPlaces: 4,
        equation: "dy" as const,
        steepness: 210,
        isStepGlitchModeEnabled: true,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: pathPoints[0],
    } satisfies Parameters<typeof resolveGraphwarTrajectory>[0];
    const baseline = resolveGraphwarTrajectory(options);
    const hardSegment = baseline.context.stepGlitchFormulaEvidence?.prefix.stepGlitchSegments[1];
    expect(hardSegment?.equation).toBe("dy");
    if (!hardSegment) {
      return;
    }
    const fixedOptions = {
      ...options,
      stepGlitchXWindows: [undefined, { endX: hardSegment.endX, startX: hardSegment.startX }],
    } satisfies Parameters<typeof resolveGraphwarTrajectory>[0];
    const debugMetrics = createGraphwarTrajectoryDebugMetrics();
    const resolved = resolveGraphwarTrajectory({ ...fixedOptions, debugMetrics });
    const forcedColdMetrics = createGraphwarTrajectoryDebugMetrics();
    const forcedCold = resolveWithForcedMaterialIdentityMismatch({ ...fixedOptions, debugMetrics: forcedColdMetrics });

    expect(debugMetrics.counters.trajectoryReplayCount).toBeLessThan(forcedColdMetrics.counters.trajectoryReplayCount);
    expect(debugMetrics.counters.rk4StepCount).toBeLessThan(forcedColdMetrics.counters.rk4StepCount);
    expect(resolved.context.formulaResult.expression).toBe(forcedCold.context.formulaResult.expression);
    expectTrajectorySamplesToBeIdentical(resolved.result.sample, forcedCold.result.sample);
  });

  it("retries a resumed hard y'' gate with real sign protection", () => {
    const pathPoints = [
      createGraphPoint(-24, 12),
      createGraphPoint(-22.857142857142858, 13.571428571428571),
      createGraphPoint(-22.84714285714286, 1.7532467532467528),
      createGraphPoint(-20, 0),
    ];
    const options = {
      bounds,
      boundsRect,
      points: pathPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "step",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 210,
        isStepGlitchModeEnabled: true,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: pathPoints[0],
    } satisfies Parameters<typeof resolveGraphwarTrajectory>[0];
    const baseline = resolveGraphwarTrajectory(options);
    const prefix = baseline.context.stepGlitchFormulaEvidence?.prefix;
    const hardSegment = prefix?.stepGlitchSegments[1];
    expect(hardSegment?.equation).toBe("ddy");
    if (!prefix || hardSegment?.equation !== "ddy") {
      return;
    }
    const resumedOptions = {
      ...options,
      start: {
        reachedRequiredTargetCount: 0,
        reachedTargetCount: 0,
        samplingState: {
          currentPoint: createGraphPoint(hardSegment.startX, hardSegment.accelerationGateY),
          dy: 0,
          sampleIndex: 0,
        },
        shouldSkipInitialStop: false,
        signProtection: prefix.signProtection,
        type: "continuation" as const,
      },
      stepGlitchFormulaEvidence: { prefix },
    } satisfies Parameters<typeof resolveGraphwarTrajectory>[0];
    const debugMetrics = createGraphwarTrajectoryDebugMetrics();
    const resolved = resolveGraphwarTrajectory({ ...resumedOptions, debugMetrics });
    const forcedColdMetrics = createGraphwarTrajectoryDebugMetrics();
    const forcedCold = resolveWithForcedMaterialIdentityMismatch({
      ...resumedOptions,
      debugMetrics: forcedColdMetrics,
    });

    expect(resolved.context.signProtection.some((roles) => roles !== 0)).toBe(true);
    expect(resolved.context.signProtection).toEqual(forcedCold.context.signProtection);
    expect(forcedColdMetrics.counters.trajectoryReplayCount).toBeGreaterThan(
      debugMetrics.counters.trajectoryReplayCount,
    );
    expect(debugMetrics.counters.rk4StepCount).toBeLessThan(forcedColdMetrics.counters.rk4StepCount);
    expect(resolved.context.formulaResult.expression).toBe(forcedCold.context.formulaResult.expression);
    expect(getGraphwarTrajectoryLaunchAngle(resolved.context)).toBe(
      getGraphwarTrajectoryLaunchAngle(forcedCold.context),
    );
    expectTrajectorySamplesToBeIdentical(resolved.result.sample, forcedCold.result.sample);
  });

  it.each(["dy", "ddy"] as const)("keeps a successful soft %s segment when glitch mode is enabled", (equation) => {
    const pathPoints = [createGraphPoint(-10, 0), createGraphPoint(-5, 3)];
    const resolved = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: pathPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "step",
        decimalPlaces: 4,
        equation,
        steepness: 210,
        isStepGlitchModeEnabled: true,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: pathPoints[0],
    });

    expect(resolved.context.compiledMaterials.stepFormula?.terms[0]?.glitchSegment).toBeUndefined();
    expect(resolved.context.stepGlitchFormulaEvidence?.prefix.stepGlitchRequirements).toEqual([false]);
  });

  it("reuses a Step prefix across an irrelevant launch-angle setting change", () => {
    const pathPoints = [createGraphPoint(-10, 0), createGraphPoint(-5, 3)];
    const options = {
      bounds,
      boundsRect,
      points: pathPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "step" as const,
        decimalPlaces: 4,
        equation: "dy" as const,
        secondOrderLaunchAngleMode: "full-precision" as const,
        steepness: 67,
        isStepGlitchModeEnabled: true,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: pathPoints[0],
    } satisfies Parameters<typeof resolveGraphwarTrajectory>[0];
    const initial = resolveGraphwarTrajectory(options);
    const prefix = initial.context.stepGlitchFormulaEvidence?.prefix;

    expect(prefix).toBeDefined();
    if (!prefix) {
      return;
    }
    const changedOptions = {
      ...options,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        ...options.formulaMode.settings,
        secondOrderLaunchAngleMode: "display-rounded" as const,
      }),
    };
    const compileMaterials = vi.mocked(compileGraphwarFormulaMaterials);
    compileMaterials.mockClear();
    const reused = resolveGraphwarTrajectory({ ...changedOptions, stepGlitchFormulaEvidence: { prefix } });
    const reusedCompileCount = compileMaterials.mock.calls.length;
    compileMaterials.mockClear();
    const cold = resolveGraphwarTrajectory(changedOptions);
    const coldCompileCount = compileMaterials.mock.calls.length;

    expect(reusedCompileCount).toBeLessThan(coldCompileCount);
    expect(reused.context.formulaResult.expression).toBe(cold.context.formulaResult.expression);
    expect(reused.context.formulaPoints).toEqual(cold.context.formulaPoints);
    expectTrajectorySamplesToBeIdentical(reused.result.sample, cold.result.sample);
  });

  it("discards an incompatible prefix before merging its hard-Step requirement", () => {
    const pathPoints = [createGraphPoint(-10, 0), createGraphPoint(-5, 3)];
    const options = {
      bounds,
      boundsRect,
      points: pathPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "step" as const,
        decimalPlaces: 4,
        equation: "dy" as const,
        steepness: 67,
        isStepGlitchModeEnabled: true,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: pathPoints[0],
    } satisfies Parameters<typeof resolveGraphwarTrajectory>[0];
    const cold = resolveGraphwarTrajectory(options);
    const prefix = cold.context.stepGlitchFormulaEvidence?.prefix;

    expect(prefix?.stepGlitchRequirements).toEqual([false]);
    if (!prefix) {
      return;
    }
    const incompatibleSignProtection = [...prefix.signProtection];
    incompatibleSignProtection[0] = (incompatibleSignProtection[0] ?? 0) ^ GraphwarSignRole.StartX;
    const incompatible = resolveGraphwarTrajectory({
      ...options,
      start: { signProtection: prefix.signProtection, type: "cold" },
      stepGlitchFormulaEvidence: {
        prefix: {
          ...prefix,
          signProtection: incompatibleSignProtection,
          stepGlitchRequirements: [true],
          stepGlitchSegments: [
            {
              derivative: 1,
              endX: -5.5,
              equation: "dy",
              gateY: 0,
              startX: -6,
              targetY: 3,
            },
          ],
        },
      },
    });

    expect(incompatible.context.formulaResult.expression).toBe(cold.context.formulaResult.expression);
    expect(incompatible.context.formulaPoints).toEqual(cold.context.formulaPoints);
    expect(incompatible.context.stepGlitchFormulaEvidence?.prefix.stepGlitchRequirements).toEqual(
      cold.context.stepGlitchFormulaEvidence?.prefix.stepGlitchRequirements,
    );
    expect(incompatible.context.stepGlitchFormulaEvidence?.prefix.stepGlitchSegments).toEqual(
      cold.context.stepGlitchFormulaEvidence?.prefix.stepGlitchSegments,
    );
  });

  it("discards every prefix requirement when a later segment is incompatible", () => {
    const pathPoints = [
      createGraphPoint(-24, 12),
      createGraphPoint(-22.857142857142858, 13.571428571428571),
      createGraphPoint(-22.84714285714286, 1.7532467532467528),
    ];
    const options = {
      bounds,
      boundsRect,
      points: pathPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "step" as const,
        decimalPlaces: 4,
        equation: "dy" as const,
        steepness: 210,
        isStepGlitchModeEnabled: true,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: pathPoints[0],
      targetHitRadiusPixels: 7,
      targetPoint: toPixel(pathPoints[2].x, pathPoints[2].y),
    } satisfies Parameters<typeof resolveGraphwarTrajectory>[0];
    const baseline = resolveGraphwarTrajectory(options);
    const prefix = baseline.context.stepGlitchFormulaEvidence?.prefix;

    expect(prefix?.stepGlitchRequirements).toEqual([false, true]);
    const hardSegment = prefix?.stepGlitchSegments[1];
    expect(hardSegment).toBeDefined();
    if (!prefix || !hardSegment) {
      return;
    }
    const fixedOptions = {
      ...options,
      stepGlitchXWindows: [undefined, { endX: hardSegment.endX, startX: hardSegment.startX }],
    };
    const cold = resolveGraphwarTrajectory(fixedOptions);
    const incompatible = resolveGraphwarTrajectory({
      ...fixedOptions,
      stepGlitchFormulaEvidence: {
        prefix: {
          ...prefix,
          stepGlitchRequirements: [true, false],
          stepGlitchSegments: [hardSegment, undefined],
        },
      },
    });

    expect(incompatible.context.formulaResult.expression).toBe(cold.context.formulaResult.expression);
    expect(incompatible.context.formulaPoints).toEqual(cold.context.formulaPoints);
    expect(incompatible.context.stepGlitchFormulaEvidence?.prefix.stepGlitchRequirements).toEqual([false, true]);
    expectTrajectorySamplesToBeIdentical(incompatible.result.sample, cold.result.sample);
  });

  it("prefers the lower-velocity soft Step y'' coefficient inside the one-pixel position band", () => {
    const pathPoints = [createGraphPoint(-20, 0), createGraphPoint(-15, 0.05)];
    const resolved = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: pathPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "step",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 153,
        isStepGlitchModeEnabled: true,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: pathPoints[0],
    });
    const targetState = sampleResolvedSecondOrderStateAtX(resolved.context, pathPoints[0], pathPoints[1].x);

    expect(resolved.context.compiledMaterials.stepFormula?.terms[0]?.glitchSegment).toBeUndefined();
    expect(resolved.context.formulaEvaluation.stepSegmentDeltaYs?.[0]).toBeCloseTo(0, 12);
    expect(Math.abs(targetState?.dy ?? Number.POSITIVE_INFINITY)).toBeLessThan(1e-8);
    expect(
      Math.abs((targetState?.currentPoint.y ?? Number.POSITIVE_INFINITY) - pathPoints[1].y) *
        (GRAPHWAR_PLANE_HEIGHT / Math.abs(bounds.maxY - bounds.minY)),
    ).toBeLessThanOrEqual(1);
  });

  it.each(["dy", "ddy"] as const)(
    "keeps a finite soft %s path when no improving hard Step candidate exists",
    (equation) => {
      const pathPoints = [
        createGraphPoint(-12, 0),
        createGraphPoint(-10, 0),
        createGraphPoint(-9.99999, 10),
        createGraphPoint(-5, 0),
      ];
      const options = {
        bounds,
        boundsRect,
        points: pathPoints,
        qualityPoints: pathPoints.slice(1),
        formulaMode: createGraphwarTrajectoryFormulaMode({
          algorithm: "step" as const,
          decimalPlaces: 4,
          equation,
          steepness: 210,
          isStepGlitchModeEnabled: true,
          isStepOverflowProtectionEnabled: true,
        }),
        soldierCenter: pathPoints[0],
      } satisfies Parameters<typeof resolveGraphwarTrajectory>[0];

      const resolved = resolveGraphwarTrajectory(options);

      expect(resolved.context.compiledMaterials.stepFormula?.terms.every((term) => !term.glitchSegment)).toBe(true);
      expect(resolved.result.pathError).toBeGreaterThan(graphwarToolDefaults.formulaPathQualityTargetPlanePixels);
      expect(tryResolveGraphwarTrajectoryCandidate(options)).toBeDefined();
    },
  );

  it("keeps an obstacle-only soft fallback only when the final replay can validate its collision", () => {
    const obstacleBounds = { maxX: -4, maxY: 10, minX: -12, minY: -10 };
    const obstacleMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    const obstaclePixel = graphToImagePoint(createGraphPoint(-8, 0), obstacleBounds, boundsRect);
    obstacleMask[Math.floor(obstaclePixel.y) * GRAPHWAR_PLANE_LENGTH + Math.floor(obstaclePixel.x)] = 1;
    const pathPoints = [createGraphPoint(-11, 0), createGraphPoint(-6, 0)];
    const options = {
      bounds: obstacleBounds,
      boundsRect,
      points: pathPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "step" as const,
        decimalPlaces: 4,
        equation: "dy" as const,
        steepness: 67,
        isStepGlitchModeEnabled: true,
        stepGlitchObstacleMask: obstacleMask,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: pathPoints[0],
    } satisfies Parameters<typeof resolveGraphwarTrajectory>[0];

    expect(() => resolveGraphwarTrajectory(options)).toThrow(GraphwarTrajectoryResolutionError);
    const withCollision = resolveGraphwarTrajectory({ ...options, collision: { mask: obstacleMask } });
    expect(withCollision.result.earlyStopReason).toBe("obstacle");
    const collisionDependentPrefix = withCollision.context.stepGlitchFormulaEvidence?.prefix;
    expect(collisionDependentPrefix).toBeDefined();
    if (!collisionDependentPrefix) {
      return;
    }
    expect(() =>
      resolveGraphwarTrajectory({
        ...options,
        stepGlitchFormulaEvidence: { prefix: collisionDependentPrefix },
      }),
    ).toThrow(GraphwarTrajectoryResolutionError);
  });

  it("compiles each ABS y'' refinement target sweep only once", () => {
    const compileMaterials = vi.mocked(compileGraphwarFormulaMaterials);
    const shortPoints = points.slice(0, 5);
    compileMaterials.mockClear();

    resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: shortPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 10,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: shortPoints[0],
    });
    const shortCompileCount = compileMaterials.mock.calls.length;

    compileMaterials.mockClear();
    resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 10,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: points[0],
    });
    const longCompileCount = compileMaterials.mock.calls.length;

    // 目标加倍只应增加初始化和少量整组回放，不应为每个目标再编译一遍。
    expect(longCompileCount - shortCompileCount).toBeLessThanOrEqual(8);
  });

  it.each([
    { algorithm: "step", equation: "dy", steepness: 210 },
    { algorithm: "step", equation: "ddy", steepness: 153 },
    { algorithm: "abs", equation: "dy", steepness: 210 },
    { algorithm: "abs", equation: "ddy", steepness: 153 },
  ] satisfies readonly { algorithm: AlgorithmMode; equation: EquationMode; steepness: number }[])(
    "uses each real accepted point to start the next $algorithm $equation segment",
    ({ algorithm, equation, steepness }) => {
      const resolved = resolveGraphwarTrajectory({
        bounds,
        boundsRect,
        points,
        formulaMode: createGraphwarTrajectoryFormulaMode({
          algorithm,
          decimalPlaces: 4,
          equation,
          steepness,
          isStepGlitchModeEnabled: false,
          isStepOverflowProtectionEnabled: true,
        }),
        soldierCenter: points[0],
      });
      const segmentStartPoints = resolved.context.formulaEvaluation.segmentStartPoints;

      expect(segmentStartPoints).toHaveLength(points.length - 1);
      expect(segmentStartPoints?.[0]).toBeUndefined();
      for (let index = 1; index < points.length - 1; index += 1) {
        const start = segmentStartPoints?.[index];
        expect(start?.x).toBeGreaterThanOrEqual(points[index].x);
        expect(Number.isFinite(start?.y)).toBe(true);
      }
    },
  );

  it.each([
    { name: "long descending path", pathPoints: points, steepness: 10 },
    {
      name: "alternating-slope path",
      pathPoints: [
        points[0],
        createGraphPoint(-19, 0),
        createGraphPoint(-17, -1.2),
        createGraphPoint(-15, 2),
        createGraphPoint(-13, -2),
        createGraphPoint(-11, 2),
        createGraphPoint(-9, -2),
        createGraphPoint(-7, 0),
      ],
      steepness: 10,
    },
    {
      name: "single steep segment",
      pathPoints: [points[0], createGraphPoint(-19, -6)],
      steepness: 153,
    },
  ])("keeps every ABS y'' target within one plane pixel on a $name", ({ pathPoints, steepness }) => {
    const sample = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: pathPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "ddy",
        steepness,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: pathPoints[0],
    }).result.sample;

    for (const target of pathPoints.slice(1)) {
      const acceptedPoint = sample.points.find((point) => point.x >= target.x);
      expect(acceptedPoint).toBeDefined();
      if (acceptedPoint) {
        expect(
          Math.abs(acceptedPoint.y - target.y) * (GRAPHWAR_PLANE_HEIGHT / Math.abs(bounds.maxY - bounds.minY)),
          `target (${target.x}, ${target.y})`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  it("falls back to finite control-line centers when shifted ABS y'' initialization exits bounds", () => {
    const pathPoints = [
      createGraphPoint(-22.5835789591074, -3.5372675713151693),
      createGraphPoint(-16.856478302348407, -5.57771117426455),
      createGraphPoint(-13.867602446731182, 5.952161388471723),
    ];
    const sample = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: pathPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 1,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: pathPoints[0],
    }).result.sample;

    for (const target of pathPoints.slice(1)) {
      const acceptedPoint = sample.points.find((point) => point.x >= target.x);
      expect(acceptedPoint).toBeDefined();
      if (acceptedPoint) {
        expect(
          Math.abs(acceptedPoint.y - target.y) * (GRAPHWAR_PLANE_HEIGHT / Math.abs(bounds.maxY - bounds.minY)),
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  it("resolves ABS y'' terminal braking when the pulse-free baseline exits vertical bounds", () => {
    const pathPoints = [
      createGraphPoint(-21.012923390138894, 1.9939800314605236),
      createGraphPoint(-17.63011127007194, -5.462831843644381),
      createGraphPoint(-17.35236822059378, -5.993274023756385),
      createGraphPoint(-13.90852712360211, -9.619064398109913),
      createGraphPoint(-13.093770099151882, 11.852192124351859),
    ];
    const sample = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: pathPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 1,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: pathPoints[0],
    }).result.sample;

    const finalTarget = pathPoints.at(-1);
    expect(finalTarget).toBeDefined();
    expect(sample.points.some((point) => finalTarget !== undefined && point.x >= finalTarget.x)).toBe(true);
  });

  it.each([1, 10])(
    "keeps an in-band pulse-free ABS y'' terminal state when braking would miss at steepness %d",
    (steepness) => {
      const pathPoints = [createGraphPoint(-20, 0), createGraphPoint(-15, 10)];
      const resolved = resolveGraphwarTrajectory({
        bounds,
        boundsRect,
        points: pathPoints,
        formulaMode: createGraphwarTrajectoryFormulaMode({
          algorithm: "abs",
          decimalPlaces: 4,
          equation: "ddy",
          steepness,
          isStepGlitchModeEnabled: false,
          isStepOverflowProtectionEnabled: true,
        }),
        soldierCenter: pathPoints[0],
      });
      const targetState = sampleResolvedSecondOrderStateAtX(resolved.context, pathPoints[0], pathPoints[1].x);

      expect(Number.isFinite(targetState?.dy)).toBe(true);
      expect(
        Math.abs((targetState?.currentPoint.y ?? Number.POSITIVE_INFINITY) - pathPoints[1].y) *
          (GRAPHWAR_PLANE_HEIGHT / Math.abs(bounds.maxY - bounds.minY)),
      ).toBeLessThanOrEqual(1);
    },
  );

  it("does not reduce terminal ABS y'' velocity by worsening an earlier right derivative", () => {
    const pathPoints = [
      createGraphPoint(-22, -1.0491845551878214),
      createGraphPoint(-21.467671938030982, -0.811212245374918),
      createGraphPoint(-20.541042321827263, 0.5483070379123092),
      createGraphPoint(-19.65015974340495, 2.680323550477624),
      createGraphPoint(-19.02240197919309, 2.535522018559277),
    ];
    const resolved = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: pathPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 10,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: pathPoints[0],
    });
    const quality = measureResolvedSecondOrderControlQuality(resolved.context, pathPoints, bounds);

    expect(quality.maximumPositionError).toBeLessThanOrEqual(1);
    expect(quality.maximumDerivativeError).toBeLessThan(1.158);
  });

  it("compares a zero terminal pulse after freezing refined ABS y'' interior pulses", () => {
    const pathPoints = [
      createGraphPoint(-21.62599334376864, -2.4155505280941725),
      createGraphPoint(-18.80634746765718, -1.2850833758711815),
      createGraphPoint(-16.052303848927842, -8.952934484928846),
      createGraphPoint(-15.353948607202621, -7.4924518167972565),
      createGraphPoint(-14.257015920756388, 2.689184557646513),
      createGraphPoint(-10.600464272778485, 1.498513363301754),
    ];
    const resolved = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: pathPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 0.5,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: pathPoints[0],
    });
    const quality = measureResolvedSecondOrderControlQuality(resolved.context, pathPoints, bounds);

    expect(quality.maximumPositionError).toBeLessThan(80);
    expect(quality.maximumDerivativeError).toBeLessThan(5.6);
  });

  it("bisects ABS y'' terminal braking when the direct zero-velocity step leaves the position band", () => {
    const pathPoints = [
      createGraphPoint(-21.051426488440484, 7.964645493775606),
      createGraphPoint(-19.499049228895455, 1.213296476751566),
      createGraphPoint(-18.53511652080342, -2.7887472957372665),
    ];
    const resolved = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: pathPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 10,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: pathPoints[0],
    });
    const quality = measureResolvedSecondOrderControlQuality(resolved.context, pathPoints, bounds);

    expect(quality.maximumPositionError).toBeLessThanOrEqual(1);
    expect(quality.maximumDerivativeError).toBeLessThan(3);
  });

  it("lets an out-of-band ABS y'' terminal pulse improve position before terminal velocity", () => {
    const pathPoints = [
      createGraphPoint(-21.366648801136762, -6.235762229189277),
      createGraphPoint(-18.547285165917128, -7.804884888231754),
      createGraphPoint(-16.97277726801112, 7.21820330992341),
      createGraphPoint(-13.75109699917957, 4.762492373585701),
    ];
    const resolved = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: pathPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 1,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: pathPoints[0],
    });
    const quality = measureResolvedSecondOrderControlQuality(resolved.context, pathPoints, bounds);

    expect(quality.maximumPositionError).toBeLessThan(67);
    expect(quality.maximumDerivativeError).toBeLessThan(3.9);
  });

  it("keeps the baseline ABS y'' state when shifted initialization is strictly worse", () => {
    const pathPoints = [
      createGraphPoint(-22.21006666496396, -5.94690552726388),
      createGraphPoint(-19.068092084955424, -4.327485705725849),
      createGraphPoint(-16.423833050299436, -4.199997507967055),
      createGraphPoint(-11.956480401568115, -4.608122534118593),
    ];
    const resolved = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: pathPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 10,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: pathPoints[0],
    });
    const quality = measureResolvedSecondOrderControlQuality(resolved.context, pathPoints, bounds);

    expect(quality.maximumPositionError).toBeLessThanOrEqual(1);
    expect(quality.maximumDerivativeError).toBeLessThan(0.25);
  });

  it("prefers an in-band ABS y'' baseline over an out-of-band shifted state", () => {
    const pathPoints = [
      createGraphPoint(-21.48980218358338, -5.074931778945029),
      createGraphPoint(-19.51429943786934, 10.507857907097787),
      createGraphPoint(-15.246956859249622, 9.178474145475775),
    ];
    const resolved = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: pathPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 153,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: pathPoints[0],
    });
    const quality = measureResolvedSecondOrderControlQuality(resolved.context, pathPoints, bounds);

    expect(quality.maximumPositionError).toBeLessThan(0.5);
    expect(quality.maximumDerivativeError).toBeLessThan(1.8);
  });

  it("brakes the terminal ABS y'' state when center quantization displaces the pulse from the target", () => {
    const pathPoints = [createGraphPoint(-21, 0), createGraphPoint(-19, -6)];
    const resolved = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: pathPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 153,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: pathPoints[0],
    });
    const targetState = sampleResolvedSecondOrderStateAtX(resolved.context, pathPoints[0], pathPoints[1].x);

    const terminalCenterX = resolved.context.compiledMaterials.absSecondDerivativeFormula?.pulses[0]?.formulaCenterX;
    expect(Number.isFinite(terminalCenterX)).toBe(true);
    expect(terminalCenterX).not.toBe(pathPoints[1].x);
    expect(Math.abs(targetState?.dy ?? Number.POSITIVE_INFINITY)).toBeLessThan(0.2);
    expect(
      Math.abs((targetState?.currentPoint.y ?? Number.POSITIVE_INFINITY) - pathPoints[1].y) *
        (GRAPHWAR_PLANE_HEIGHT / Math.abs(bounds.maxY - bounds.minY)),
    ).toBeLessThanOrEqual(1);
  });

  it("optimizes ABS y'' control states toward the polyline right derivative", () => {
    const pathPoints = [
      createGraphPoint(-20, 0),
      createGraphPoint(-15, 4),
      createGraphPoint(-10, -2),
      createGraphPoint(-5, 1),
    ];
    const resolved = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: pathPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 153,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: pathPoints[0],
    });

    for (let targetIndex = 1; targetIndex < pathPoints.length; targetIndex += 1) {
      const target = pathPoints[targetIndex];
      const state = sampleResolvedSecondOrderStateAtX(resolved.context, pathPoints[0], target.x);
      expect(state?.dy).toBeDefined();
      if (!state || state.dy === undefined) {
        continue;
      }
      const nextTarget = pathPoints[targetIndex + 1];
      const targetDerivative = nextTarget
        ? (nextTarget.y - state.currentPoint.y) / (nextTarget.x - state.currentPoint.x)
        : 0;
      expect(Math.abs(state.dy - targetDerivative), `target ${targetIndex}`).toBeLessThan(0.1);
    }
  });

  it("damps the worst in-band ABS y'' derivative without moving the whole pulse vector", () => {
    const pathPoints = [
      createGraphPoint(-21.71140972734429, 4.596602194942534),
      createGraphPoint(-17.39680150244385, 6.194855257868767),
      createGraphPoint(-11.63892913539894, 3.7827049419283867),
      createGraphPoint(-9.788756974972785, 4.786154270172119),
    ];
    const resolved = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: pathPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 153,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      }),
      soldierCenter: pathPoints[0],
    });
    const quality = measureResolvedSecondOrderControlQuality(resolved.context, pathPoints, bounds);

    expect(quality.maximumPositionError).toBeLessThanOrEqual(1);
    expect(quality.maximumDerivativeError).toBeLessThan(0.03);
  });

  it.each([
    { algorithm: "abs", equation: "ddy", steepness: 10 },
    { algorithm: "step", equation: "dy", steepness: 67 },
  ] satisfies readonly { algorithm: AlgorithmMode; equation: EquationMode; steepness: number }[])(
    "uses custom vertical bounds for the $algorithm $equation one-pixel contract",
    ({ algorithm, equation, steepness }) => {
      const customBounds: GraphBounds = { maxX: 25, maxY: 0.5, minX: -25, minY: -0.5 };
      const customPoints = [
        createGraphPoint(-20, 0),
        createGraphPoint(-15, 0.4),
        createGraphPoint(-10, -0.4),
        createGraphPoint(-5, 0.3),
      ];
      const sample = resolveGraphwarTrajectory({
        bounds: customBounds,
        boundsRect,
        points: customPoints,
        formulaMode: createGraphwarTrajectoryFormulaMode({
          algorithm,
          decimalPlaces: 4,
          equation,
          steepness,
          isStepGlitchModeEnabled: false,
          isStepOverflowProtectionEnabled: true,
        }),
        soldierCenter: customPoints[0],
      }).result.sample;

      for (const target of customPoints.slice(1)) {
        const acceptedPoint = sample.points.find((point) => point.x >= target.x);
        expect(acceptedPoint).toBeDefined();
        if (acceptedPoint) {
          expect(
            Math.abs(acceptedPoint.y - target.y) *
              (GRAPHWAR_PLANE_HEIGHT / Math.abs(customBounds.maxY - customBounds.minY)),
            `target (${target.x}, ${target.y})`,
          ).toBeLessThanOrEqual(1);
        }
      }
    },
  );

  it.each([
    { algorithm: "step", steepness: 67 },
    { algorithm: "abs", steepness: 67 },
  ] satisfies readonly { algorithm: AlgorithmMode; steepness: number }[])(
    "keeps every $algorithm y' target within one plane pixel instead of accumulating drift",
    ({ algorithm, steepness }) => {
      const sample = resolveGraphwarTrajectory({
        bounds,
        boundsRect,
        points,
        formulaMode: createGraphwarTrajectoryFormulaMode({
          algorithm,
          decimalPlaces: 4,
          equation: "dy",
          steepness,
          isStepGlitchModeEnabled: false,
          isStepOverflowProtectionEnabled: true,
        }),
        soldierCenter: points[0],
      }).result.sample;

      for (const target of points.slice(1)) {
        const acceptedPoint = sample.points.find((point) => point.x >= target.x);
        expect(acceptedPoint).toBeDefined();
        if (acceptedPoint) {
          expect(
            Math.abs(acceptedPoint.y - target.y) * (GRAPHWAR_PLANE_HEIGHT / Math.abs(bounds.maxY - bounds.minY)),
          ).toBeLessThanOrEqual(1);
        }
      }
    },
  );

  it.each([
    { algorithm: "step", isStepGlitchModeEnabled: false },
    { algorithm: "abs", isStepGlitchModeEnabled: true },
  ] as const)(
    "ignores glitch inputs for $algorithm y' when the mode is disabled or unsupported",
    ({ algorithm, isStepGlitchModeEnabled }) => {
      const directPoints = [createGraphPoint(-11, 0), createGraphPoint(-6, 4)];
      const obstacleMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
      const obstacle = toPixel(-8.5, 2);
      obstacleMask[Math.floor(obstacle.y) * GRAPHWAR_PLANE_LENGTH + Math.floor(obstacle.x)] = 1;
      const settings = {
        algorithm,
        decimalPlaces: 4,
        equation: "dy" as const,
        steepness: 67,
        isStepGlitchModeEnabled,
        isStepOverflowProtectionEnabled: true,
      };
      const plain = resolveGraphwarTrajectory({
        bounds,
        boundsRect,
        points: directPoints,
        formulaMode: createGraphwarTrajectoryFormulaMode(settings),
        soldierCenter: directPoints[0],
      }).context;
      const withStaleMask = resolveGraphwarTrajectory({
        bounds,
        boundsRect,
        points: directPoints,
        formulaMode: createGraphwarTrajectoryFormulaMode({ ...settings, stepGlitchObstacleMask: obstacleMask }),
        soldierCenter: directPoints[0],
      }).context;

      expect(withStaleMask.formulaResult.expression).toBe(plain.formulaResult.expression);
      expect(withStaleMask.compiledMaterials.stepFormula?.terms.some((term) => term.glitchSegment)).not.toBe(true);
    },
  );

  it("rejects a stale hard-Step prefix while preserving ABS y' position compensation", () => {
    const prefixPoints = points.slice(0, 2);
    const absSettings = {
      algorithm: "abs" as const,
      decimalPlaces: 4,
      equation: "dy" as const,
      steepness: 67,
      isStepGlitchModeEnabled: true,
      isStepOverflowProtectionEnabled: true,
    };
    const options = {
      bounds,
      boundsRect,
      points: points.slice(0, 3),
      formulaMode: createGraphwarTrajectoryFormulaMode(absSettings),
      soldierCenter: points[0],
    };
    const plain = resolveGraphwarTrajectory(options).context;
    const withStalePrefix = resolveGraphwarTrajectory({
      ...options,
      stepGlitchFormulaEvidence: {
        prefix: {
          bounds: { ...bounds },
          initialFormulaPoints: prefixPoints,
          points: prefixPoints,
          refinedFormulaPoints: prefixPoints,
          segmentStartPoints: [undefined],
          settings: absSettings,
          signProtection: [],
          soldierCenter: points[0],
          stepGlitchRequirements: [true],
          stepGlitchSegments: [{ derivative: 1, endX: -5.5, equation: "dy", gateY: 0, startX: -6, targetY: 0 }],
          stepSegmentDeltaYs: [-2],
        },
      },
    }).context;

    expect(withStalePrefix.formulaResult.expression).toBe(plain.formulaResult.expression);
    expect(withStalePrefix.formulaEvaluation.segmentStartPoints).toEqual(plain.formulaEvaluation.segmentStartPoints);
  });
});

describe("pathfinding formula convergence", () => {
  it("validates the restored best formula state instead of rejecting a work-limit result", () => {
    const target = toPixel(1, 1);
    const result = sampleGraphwarPathTargetSequence({
      bounds,
      boundsRect,
      points: [toPixel(-10, -1), toPixel(-7, 2), toPixel(-3, -2), target],
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "pchip",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 210,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      }),
      targetHitRadiusPixels: 1,
      targetPoints: [target],
    });

    expect(result.reachesTargetSequenceBeforeObstacle).toBe(true);
    expect(result.sample.stopReason).not.toBe("unsupported");
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
      isStepGlitchModeEnabled: true,
      stepGlitchObstacleMask: obstacleMask,
      isStepOverflowProtectionEnabled: true,
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
      formulaMode: createGraphwarTrajectoryFormulaMode(stepSettings),
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
      formulaMode: createGraphwarTrajectoryFormulaMode(stepSettings),
      soldierCenter: appendedPoints[0],
    });
    const prefixOnlyMetrics = createGraphwarTrajectoryDebugMetrics();
    const prefixOnly = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      debugMetrics: prefixOnlyMetrics,
      points: appendedPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode(stepSettings),
      soldierCenter: appendedPoints[0],
      ...(prefix.stepGlitchFormulaEvidence
        ? { stepGlitchFormulaEvidence: { prefix: prefix.stepGlitchFormulaEvidence.prefix } }
        : {}),
    });
    const reusedMetrics = createGraphwarTrajectoryDebugMetrics();
    const reused = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      debugMetrics: reusedMetrics,
      points: appendedPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode(stepSettings),
      soldierCenter: appendedPoints[0],
      ...(prefix.stepGlitchFormulaEvidence ? { stepGlitchFormulaEvidence: prefix.stepGlitchFormulaEvidence } : {}),
    });
    const prefixFormula = prefix.stepGlitchFormulaEvidence?.prefix;
    const rebuiltWithFixedWindows = prefixFormula
      ? resolveGraphwarTrajectory({
          bounds,
          boundsRect,
          points: appendedPoints,
          formulaMode: createGraphwarTrajectoryFormulaMode(stepSettings),
          start: { signProtection: [], type: "cold" },
          soldierCenter: appendedPoints[0],
          // 强制保护快照失配，覆盖未来段新增 epsilon 后必须重算旧段的分支。
          stepGlitchFormulaEvidence: { prefix: { ...prefixFormula, signProtection: [1] } },
          stepGlitchXWindows: prefixFormula.stepGlitchSegments.map((segment) =>
            segment ? { endX: segment.endX, startX: segment.startX } : undefined,
          ),
        }).context
      : undefined;

    expect(prefix.stepGlitchFormulaEvidence?.prefix.stepGlitchSegments[0]).toBeDefined();
    expect(prefix.stepGlitchFormulaEvidence?.boundaryState).toBeDefined();
    expect(reusedMetrics.counters.trajectoryReplayCount).toBeLessThan(prefixOnlyMetrics.counters.trajectoryReplayCount);
    expect(prefixOnlyMetrics.counters.trajectoryReplayCount - reusedMetrics.counters.trajectoryReplayCount).toBe(1);
    expect(reusedMetrics.counters.rk4StepCount).toBeLessThan(prefixOnlyMetrics.counters.rk4StepCount);
    expect(reused.context.stepGlitchFormulaEvidence?.prefix.stepGlitchSegments[0]).toBe(
      prefix.stepGlitchFormulaEvidence?.prefix.stepGlitchSegments[0],
    );
    expect(reused.context.formulaResult.expression).toBe(cold.context.formulaResult.expression);
    expect(reused.context.formulaPoints).toEqual(cold.context.formulaPoints);
    expect(reused.context.stepGlitchFormulaEvidence?.prefix.refinedFormulaPoints).toEqual(
      cold.context.stepGlitchFormulaEvidence?.prefix.refinedFormulaPoints,
    );
    expect(reused.context.stepGlitchFormulaEvidence?.prefix.stepGlitchRequirements).toEqual(
      cold.context.stepGlitchFormulaEvidence?.prefix.stepGlitchRequirements,
    );
    expect(reused.context.stepGlitchFormulaEvidence?.prefix.stepGlitchSegments).toEqual(
      cold.context.stepGlitchFormulaEvidence?.prefix.stepGlitchSegments,
    );
    expect(reused.context.stepGlitchFormulaEvidence?.prefix.stepSegmentDeltaYs).toEqual(
      cold.context.stepGlitchFormulaEvidence?.prefix.stepSegmentDeltaYs,
    );
    expectTrajectorySamplesToBeIdentical(prefixOnly.result.sample, cold.result.sample);
    expectTrajectorySamplesToBeIdentical(reused.result.sample, cold.result.sample);
    expect(rebuiltWithFixedWindows?.stepGlitchFormulaEvidence?.prefix.stepGlitchSegments[0]).toMatchObject({
      endX: prefixFormula?.stepGlitchSegments[0]?.endX,
      startX: prefixFormula?.stepGlitchSegments[0]?.startX,
    });
  });

  it("falls back to muzzle replay when any local boundary field is stale", () => {
    const prefixPoints = [createGraphPoint(-10, 0), createGraphPoint(-5, 3)];
    const stepSettings = {
      algorithm: "step" as const,
      decimalPlaces: 4,
      equation: "dy" as const,
      steepness: 67,
      isStepGlitchModeEnabled: true,
      isStepOverflowProtectionEnabled: true,
    };
    const prefix = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: prefixPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode(stepSettings),
      soldierCenter: prefixPoints[0],
    }).context;
    const formulaPrefix = prefix.stepGlitchFormulaEvidence?.prefix;
    const boundaryState = prefix.stepGlitchFormulaEvidence?.boundaryState;
    expect(formulaPrefix).toBeDefined();
    expect(boundaryState).toBeDefined();
    if (!formulaPrefix || !boundaryState) {
      return;
    }

    const appendedPoints = [...prefixPoints, createGraphPoint(0, 1)];
    const fallbackMetrics = createGraphwarTrajectoryDebugMetrics();
    const fallback = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      debugMetrics: fallbackMetrics,
      points: appendedPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode(stepSettings),
      soldierCenter: appendedPoints[0],
      stepGlitchFormulaEvidence: { prefix: formulaPrefix },
    });
    const staleBoundaries = [
      {
        name: "formula materials",
        state: { ...boundaryState, formulaMaterialsIdentity: `${boundaryState.formulaMaterialsIdentity} ` },
      },
      { name: "launch angle", state: { ...boundaryState, launchAngleRadians: 0 } },
      { name: "segment count", state: { ...boundaryState, segmentCount: boundaryState.segmentCount + 1 } },
      { name: "boundary x", state: { ...boundaryState, stopX: boundaryState.stopX + GRAPHWAR_STEP_SIZE } },
      {
        name: "sampling state",
        state: {
          ...boundaryState,
          state: {
            ...boundaryState.state,
            currentPoint: createGraphPoint(
              boundaryState.stopX - GRAPHWAR_STEP_SIZE,
              boundaryState.state.currentPoint.y,
            ),
          },
        },
      },
    ];

    for (const stale of staleBoundaries) {
      const metrics = createGraphwarTrajectoryDebugMetrics();
      const resolved = resolveGraphwarTrajectory({
        bounds,
        boundsRect,
        debugMetrics: metrics,
        points: appendedPoints,
        formulaMode: createGraphwarTrajectoryFormulaMode(stepSettings),
        soldierCenter: appendedPoints[0],
        stepGlitchFormulaEvidence: { boundaryState: stale.state, prefix: formulaPrefix },
      });

      expect(metrics.counters.trajectoryReplayCount, stale.name).toBe(fallbackMetrics.counters.trajectoryReplayCount);
      expect(metrics.counters.rk4StepCount, stale.name).toBe(fallbackMetrics.counters.rk4StepCount);
      expectTrajectorySamplesToBeIdentical(resolved.result.sample, fallback.result.sample);
    }
  });

  it("rejects a boundary from a different exact prefix even when its serialized identity matches", () => {
    const stepSettings = {
      algorithm: "step" as const,
      decimalPlaces: 4,
      equation: "dy" as const,
      steepness: 210,
      isStepGlitchModeEnabled: true,
      isStepOverflowProtectionEnabled: true,
    };
    const firstPrefixPoints = [createGraphPoint(-10, 0), createGraphPoint(-5, 3)];
    const secondPrefixPoints = [createGraphPoint(-10, 1), createGraphPoint(-5, 4)];
    const firstPrefix = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: firstPrefixPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode(stepSettings),
      soldierCenter: firstPrefixPoints[0],
    }).context;
    const secondPrefix = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: secondPrefixPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode(stepSettings),
      soldierCenter: secondPrefixPoints[0],
    }).context;
    const formulaPrefix = firstPrefix.stepGlitchFormulaEvidence?.prefix;
    const matchingBoundaryState = firstPrefix.stepGlitchFormulaEvidence?.boundaryState;
    const crossedBoundaryState = secondPrefix.stepGlitchFormulaEvidence?.boundaryState;
    expect(formulaPrefix).toBeDefined();
    expect(matchingBoundaryState).toBeDefined();
    expect(crossedBoundaryState).toBeDefined();
    if (!formulaPrefix || !matchingBoundaryState || !crossedBoundaryState) {
      return;
    }

    // 平移后的另一条合法路径具有相同公式材料和边界字段，但物理 y 状态不同。
    expect(crossedBoundaryState.formulaMaterialsIdentity).toBe(matchingBoundaryState.formulaMaterialsIdentity);
    expect(crossedBoundaryState.segmentCount).toBe(matchingBoundaryState.segmentCount);
    expect(crossedBoundaryState.stopX).toBe(matchingBoundaryState.stopX);
    expect(crossedBoundaryState.state.currentPoint.y).not.toBe(matchingBoundaryState.state.currentPoint.y);
    expect(crossedBoundaryState.prefix).not.toBe(formulaPrefix);

    const appendedPoints = [...firstPrefixPoints, createGraphPoint(0, 1)];
    const fallbackMetrics = createGraphwarTrajectoryDebugMetrics();
    const fallback = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      debugMetrics: fallbackMetrics,
      points: appendedPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode(stepSettings),
      soldierCenter: appendedPoints[0],
      stepGlitchFormulaEvidence: { prefix: formulaPrefix },
    });
    const crossedMetrics = createGraphwarTrajectoryDebugMetrics();
    const crossed = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      debugMetrics: crossedMetrics,
      points: appendedPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode(stepSettings),
      soldierCenter: appendedPoints[0],
      stepGlitchFormulaEvidence: { boundaryState: crossedBoundaryState, prefix: formulaPrefix },
    });
    const matchingMetrics = createGraphwarTrajectoryDebugMetrics();
    const matching = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      debugMetrics: matchingMetrics,
      points: appendedPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode(stepSettings),
      soldierCenter: appendedPoints[0],
      stepGlitchFormulaEvidence: { boundaryState: matchingBoundaryState, prefix: formulaPrefix },
    });

    expect(crossedMetrics.counters.trajectoryReplayCount).toBe(fallbackMetrics.counters.trajectoryReplayCount);
    expect(crossedMetrics.counters.rk4StepCount).toBe(fallbackMetrics.counters.rk4StepCount);
    expect(fallbackMetrics.counters.trajectoryReplayCount - matchingMetrics.counters.trajectoryReplayCount).toBe(1);
    expect(matchingMetrics.counters.rk4StepCount).toBeLessThan(fallbackMetrics.counters.rk4StepCount);
    expect(crossed.context.formulaResult.expression).toBe(fallback.context.formulaResult.expression);
    expect(matching.context.formulaResult.expression).toBe(fallback.context.formulaResult.expression);
    expectTrajectorySamplesToBeIdentical(crossed.result.sample, fallback.result.sample);
    expectTrajectorySamplesToBeIdentical(matching.result.sample, fallback.result.sample);
  });

  it("restores the exact y'' RK4 boundary without changing the appended trajectory", () => {
    const prefixPoints = [createGraphPoint(-20, 0), createGraphPoint(-15, 0.05)];
    const stepSettings = {
      algorithm: "step" as const,
      decimalPlaces: 4,
      equation: "ddy" as const,
      steepness: 153,
      isStepGlitchModeEnabled: true,
      isStepOverflowProtectionEnabled: true,
    };
    const prefix = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: prefixPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode(stepSettings),
      soldierCenter: prefixPoints[0],
    }).context;
    const appendedPoints = [...prefixPoints, createGraphPoint(-10, -0.05)];
    const fallbackMetrics = createGraphwarTrajectoryDebugMetrics();
    const fallback = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      debugMetrics: fallbackMetrics,
      points: appendedPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode(stepSettings),
      soldierCenter: appendedPoints[0],
      ...(prefix.stepGlitchFormulaEvidence
        ? { stepGlitchFormulaEvidence: { prefix: prefix.stepGlitchFormulaEvidence.prefix } }
        : {}),
    });
    const reusedMetrics = createGraphwarTrajectoryDebugMetrics();
    const reused = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      debugMetrics: reusedMetrics,
      points: appendedPoints,
      formulaMode: createGraphwarTrajectoryFormulaMode(stepSettings),
      soldierCenter: appendedPoints[0],
      ...(prefix.stepGlitchFormulaEvidence ? { stepGlitchFormulaEvidence: prefix.stepGlitchFormulaEvidence } : {}),
    });

    expect(prefix.stepGlitchFormulaEvidence?.boundaryState?.state.dy).toBeDefined();
    expect(fallbackMetrics.counters.trajectoryReplayCount - reusedMetrics.counters.trajectoryReplayCount).toBe(1);
    expect(reusedMetrics.counters.rk4StepCount).toBeLessThan(fallbackMetrics.counters.rk4StepCount);
    expect(reused.context.formulaResult.expression).toBe(fallback.context.formulaResult.expression);
    expect(getGraphwarTrajectoryLaunchAngle(reused.context)).toBe(getGraphwarTrajectoryLaunchAngle(fallback.context));
    expectTrajectorySamplesToBeIdentical(reused.result.sample, fallback.result.sample);
  });
});

/** Converts a Graphwar coordinate pair into the shared test fixture's image space. */
function toPixel(x: number, y: number) {
  return graphToImagePoint(createGraphPoint(x, y), bounds, boundsRect);
}

/** Mirrors the production continuation seam: the simulator may include the resume point or start at its successor. */
function mergeContinuationTestPoints<TPoint extends { readonly x: number; readonly y: number }>(
  prefix: readonly TPoint[],
  suffix: readonly TPoint[],
) {
  const prefixEnd = prefix.at(-1);
  const suffixStart = suffix[0];
  return [
    ...prefix,
    ...suffix.slice(prefixEnd && suffixStart && prefixEnd.x === suffixStart.x && prefixEnd.y === suffixStart.y ? 1 : 0),
  ];
}

/** 让语义无关的材料 nonce 禁用局部边界复用，生成逐点等价的 forced-cold 对照。 */
function resolveWithForcedMaterialIdentityMismatch(options: Parameters<typeof resolveGraphwarTrajectory>[0]) {
  buildMockState.shouldForceMaterialIdentityMismatch = true;
  try {
    return resolveGraphwarTrajectory(options);
  } finally {
    buildMockState.shouldForceMaterialIdentityMismatch = false;
  }
}

/** Replays one resolved y'' formula to the first real accepted state on or after a control line. */
function sampleResolvedSecondOrderStateAtX(
  context: GraphwarTrajectoryFormulaContext,
  soldierCenter: ReturnType<typeof createGraphPoint>,
  stopX: number,
) {
  return sampleGraphwarTrajectory({
    algorithm: context.settings.algorithm,
    bounds,
    compiledFormulaMaterials: context.compiledMaterials,
    equation: "ddy",
    formulaEvaluation: context.formulaEvaluation,
    launchAngleRadians: getGraphwarTrajectoryLaunchAngle(context),
    points: context.formulaPoints,
    secondOrderLaunchAngleMode: context.settings.secondOrderLaunchAngleMode,
    shouldStop: (point) => point.x >= stopX,
    soldierCenter,
    steepness: context.settings.steepness,
  }).endState;
}

/** Measures the same accepted-position and polyline-right-derivative contract across all y'' control lines. */
function measureResolvedSecondOrderControlQuality(
  context: GraphwarTrajectoryFormulaContext,
  pathPoints: readonly GraphPoint[],
  qualityBounds: GraphBounds,
) {
  let maximumDerivativeError = 0;
  let maximumPositionError = 0;
  for (let targetIndex = 1; targetIndex < pathPoints.length; targetIndex += 1) {
    const target = pathPoints[targetIndex];
    const state = sampleResolvedSecondOrderStateAtX(context, pathPoints[0], target.x);
    expect(state?.dy).toBeDefined();
    if (!state || state.dy === undefined) {
      continue;
    }
    const nextTarget = pathPoints[targetIndex + 1];
    maximumDerivativeError = Math.max(
      maximumDerivativeError,
      Math.abs(
        state.dy - (nextTarget ? (nextTarget.y - state.currentPoint.y) / (nextTarget.x - state.currentPoint.x) : 0),
      ),
    );
    maximumPositionError = Math.max(
      maximumPositionError,
      Math.abs(state.currentPoint.y - target.y) *
        (GRAPHWAR_PLANE_HEIGHT / Math.abs(qualityBounds.maxY - qualityBounds.minY)),
    );
  }
  return { maximumDerivativeError, maximumPositionError };
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
