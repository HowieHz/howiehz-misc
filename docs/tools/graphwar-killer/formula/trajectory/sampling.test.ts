import { describe, expect, it, vi } from "vitest";

import {
  GRAPHWAR_GAME_SOLDIER_RADIUS,
  GRAPHWAR_PLANE_HEIGHT,
  GRAPHWAR_PLANE_LENGTH,
  GRAPHWAR_STEP_SIZE,
} from "../../core/game/constants";
import { graphToImagePoint } from "../../core/geometry";
import { createGraphPoint, createPixelPoint } from "../../core/types";
import type { AlgorithmMode, BoundsRect, EquationMode, GraphBounds } from "../../core/types";
import {
  buildFormula,
  compileFormulaEvaluator,
  compileGraphwarFormulaMaterials,
  GraphwarSignRole,
} from "../generation/build";
import { sampleGraphwarExpressionTrajectory, sampleGraphwarTrajectory } from "../simulation/simulator";
import {
  compareGraphwarPathErrors,
  getGraphwarTrajectoryLaunchAngle,
  GraphwarTrajectoryResolutionError,
  graphwarTrajectoryReachesGraphXAfterTargetsBeforeObstacle,
  measureGraphwarFormulaPathError,
  sampleGraphwarPathTargetSequence,
  resolveGraphwarTrajectory,
  tryResolveGraphwarTrajectoryCandidate,
} from "./sampling";

vi.mock("../generation/build", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../generation/build")>();
  return {
    ...actual,
    compileGraphwarFormulaMaterials: vi.fn(actual.compileGraphwarFormulaMaterials),
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
      settings,
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
          settings: {
            algorithm: testCase.algorithm,
            decimalPlaces,
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
      settings: {
        algorithm: "step",
        decimalPlaces: 15,
        equation: "ddy",
        steepness: 210,
        stepGlitchMode: false,
        stepOverflowProtection: true,
      },
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
      stepOverflowProtection: true,
    };
    const compiledMaterials = compileGraphwarFormulaMaterials(points, 210, "step", formulaEvaluation);
    const expression = buildFormula(points, 210, "ddy", "step", 4, {
      compiledMaterials,
      signProtection: formulaEvaluation.signProtection,
      stepOverflowProtection: true,
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
        stepOverflowProtection: true,
      };
      const soft = resolveGraphwarTrajectory({
        bounds,
        boundsRect,
        points: reproductionPoints,
        settings: { ...baseSettings, stepGlitchMode: false },
        soldierCenter: reproductionPoints[0],
        targetHitRadiusPixels: 7,
        targetPoint,
      });
      const hard = resolveGraphwarTrajectory({
        bounds,
        boundsRect,
        points: reproductionPoints,
        settings: { ...baseSettings, stepGlitchMode: true },
        soldierCenter: reproductionPoints[0],
        stopOnTargetsComplete: false,
        targetHitRadiusPixels: 7,
        targetPoint,
      });

      expect(soft.result.targetHitIndex).toBe(-1);
      expect(soft.context.compiledMaterials.stepFormula?.terms[0]?.glitchSegment).toBeUndefined();
      expect(hard.result.targetHitIndex).toBeGreaterThanOrEqual(0);
      expect(hard.context.compiledMaterials.stepFormula?.terms[0]?.glitchSegment).toMatchObject({ equation });
      if (equation === "dy") {
        expect(hard.context.formulaPoints[0]).not.toEqual(soft.context.formulaPoints[0]);
      } else {
        const launchAngleRadians = hard.context.launchAngleRadians;
        expect(launchAngleRadians).toBeDefined();
        if (launchAngleRadians === undefined) {
          return;
        }
        expect(Math.abs(launchAngleRadians)).toBeGreaterThan(0);
        expect(hard.context.stepGlitchFormulaPrefix?.launchAngleRadians).toBe(launchAngleRadians);
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
      settings: {
        algorithm: "step",
        decimalPlaces: 4,
        equation,
        steepness: 210,
        stepGlitchMode: true,
        stepOverflowProtection: true,
      },
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

  it.each(["dy", "ddy"] as const)("keeps a successful soft %s segment when glitch mode is enabled", (equation) => {
    const pathPoints = [createGraphPoint(-10, 0), createGraphPoint(-5, 3)];
    const resolved = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: pathPoints,
      settings: {
        algorithm: "step",
        decimalPlaces: 4,
        equation,
        steepness: 210,
        stepGlitchMode: true,
        stepOverflowProtection: true,
      },
      soldierCenter: pathPoints[0],
    });

    expect(resolved.context.compiledMaterials.stepFormula?.terms[0]?.glitchSegment).toBeUndefined();
    expect(resolved.context.stepGlitchFormulaPrefix?.stepGlitchRequirements).toEqual([false]);
  });

  it.each(["dy", "ddy"] as const)(
    "rejects a %s path when a failed soft segment has no valid hard Step candidate",
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
        settings: {
          algorithm: "step" as const,
          decimalPlaces: 4,
          equation,
          steepness: 210,
          stepGlitchMode: true,
          stepOverflowProtection: true,
        },
        soldierCenter: pathPoints[0],
      } satisfies Parameters<typeof resolveGraphwarTrajectory>[0];

      expect(() => resolveGraphwarTrajectory(options)).toThrow(GraphwarTrajectoryResolutionError);
      expect(tryResolveGraphwarTrajectoryCandidate(options)).toBeUndefined();
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
      settings: {
        algorithm: "step" as const,
        decimalPlaces: 4,
        equation: "dy" as const,
        steepness: 67,
        stepGlitchMode: true,
        stepGlitchObstacleMask: obstacleMask,
        stepOverflowProtection: true,
      },
      soldierCenter: pathPoints[0],
    } satisfies Parameters<typeof resolveGraphwarTrajectory>[0];

    expect(() => resolveGraphwarTrajectory(options)).toThrow(GraphwarTrajectoryResolutionError);
    const withCollision = resolveGraphwarTrajectory({ ...options, collision: { mask: obstacleMask } });
    expect(withCollision.result.earlyStopReason).toBe("obstacle");
    const collisionDependentPrefix = withCollision.context.stepGlitchFormulaPrefix;
    expect(collisionDependentPrefix).toBeDefined();
    if (!collisionDependentPrefix) {
      return;
    }
    expect(() => resolveGraphwarTrajectory({ ...options, stepGlitchFormulaPrefix: collisionDependentPrefix })).toThrow(
      GraphwarTrajectoryResolutionError,
    );
  });

  it("compiles each ABS y'' refinement target sweep only once", () => {
    const compileMaterials = vi.mocked(compileGraphwarFormulaMaterials);
    const shortPoints = points.slice(0, 5);
    compileMaterials.mockClear();

    resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points: shortPoints,
      settings: {
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 10,
        stepGlitchMode: false,
        stepOverflowProtection: true,
      },
      soldierCenter: shortPoints[0],
    });
    const shortCompileCount = compileMaterials.mock.calls.length;

    compileMaterials.mockClear();
    resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      points,
      settings: {
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 10,
        stepGlitchMode: false,
        stepOverflowProtection: true,
      },
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
        settings: {
          algorithm,
          decimalPlaces: 4,
          equation,
          steepness,
          stepGlitchMode: false,
          stepOverflowProtection: true,
        },
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
      settings: {
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "ddy",
        steepness,
        stepGlitchMode: false,
        stepOverflowProtection: true,
      },
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
        settings: {
          algorithm,
          decimalPlaces: 4,
          equation,
          steepness,
          stepGlitchMode: false,
          stepOverflowProtection: true,
        },
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
        settings: {
          algorithm,
          decimalPlaces: 4,
          equation: "dy",
          steepness,
          stepGlitchMode: false,
          stepOverflowProtection: true,
        },
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
    { algorithm: "step", stepGlitchMode: false },
    { algorithm: "abs", stepGlitchMode: true },
  ] as const)(
    "ignores glitch inputs for $algorithm y' when the mode is disabled or unsupported",
    ({ algorithm, stepGlitchMode }) => {
      const directPoints = [createGraphPoint(-11, 0), createGraphPoint(-6, 4)];
      const obstacleMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
      const obstacle = toPixel(-8.5, 2);
      obstacleMask[Math.floor(obstacle.y) * GRAPHWAR_PLANE_LENGTH + Math.floor(obstacle.x)] = 1;
      const settings = {
        algorithm,
        decimalPlaces: 4,
        equation: "dy" as const,
        steepness: 67,
        stepGlitchMode,
        stepOverflowProtection: true,
      };
      const plain = resolveGraphwarTrajectory({
        bounds,
        boundsRect,
        points: directPoints,
        settings,
        soldierCenter: directPoints[0],
      }).context;
      const withStaleMask = resolveGraphwarTrajectory({
        bounds,
        boundsRect,
        points: directPoints,
        settings: { ...settings, stepGlitchObstacleMask: obstacleMask },
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
      stepGlitchMode: true,
      stepOverflowProtection: true,
    };
    const options = {
      bounds,
      boundsRect,
      points: points.slice(0, 3),
      settings: absSettings,
      soldierCenter: points[0],
    };
    const plain = resolveGraphwarTrajectory(options).context;
    const withStalePrefix = resolveGraphwarTrajectory({
      ...options,
      stepGlitchFormulaPrefix: {
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
      settings: {
        algorithm: "pchip",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 210,
        stepGlitchMode: false,
        stepOverflowProtection: true,
      },
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
