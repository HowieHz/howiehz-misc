import { describe, expect, it } from "vitest";

import {
  GRAPHWAR_FUNC_MAX_STEP_DISTANCE_SQUARED,
  GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE,
  GRAPHWAR_PLANE_HEIGHT,
  GRAPHWAR_PLANE_LENGTH,
  GRAPHWAR_STEP_SIZE,
} from "../../core/game/constants";
import { graphToImagePoint, imageToGraphPoint } from "../../core/geometry";
import { floorToDecimalPlaces } from "../../core/numbers";
import { createGraphPoint, createPixelPoint } from "../../core/types";
import type { BoundsRect, GraphBounds } from "../../core/types";
import { sampleGraphwarExpressionTrajectory } from "../../formula/simulation/simulator";
import type { GraphwarTrajectoryFormulaSettings } from "../../formula/trajectory/sampling";
import { getGraphwarTrajectoryLaunchAngle, resolveGraphwarTrajectory } from "../../formula/trajectory/sampling";
import {
  createGraphwarStepGlitchScanMaskIndex,
  replayGraphwarStepGlitchPathToControlX,
  scanGraphwarStepGlitchPath,
} from "./step-glitch-scan";

const bounds: GraphBounds = { maxX: -4, maxY: 10, minX: -12, minY: -10 };
const boundsRect: BoundsRect = { height: GRAPHWAR_PLANE_HEIGHT, width: GRAPHWAR_PLANE_LENGTH, x: 0, y: 0 };
const settings: GraphwarTrajectoryFormulaSettings = {
  algorithm: "step",
  decimalPlaces: 4,
  equation: "dy",
  steepness: 67,
  stepGlitchMode: true,
  stepOverflowProtection: true,
};

describe("Step ODE glitch scan", () => {
  it("precomputes the farthest same-row free column in x+ order", () => {
    const mask = createEmptyMask();
    mask[2 * GRAPHWAR_PLANE_LENGTH + 4] = 1;
    const index = createGraphwarStepGlitchScanMaskIndex({ bounds, simulationMask: mask });

    expect(index.farthestFreeX[2 * GRAPHWAR_PLANE_LENGTH]).toBe(3);
    expect(index.farthestFreeX[2 * GRAPHWAR_PLANE_LENGTH + 3]).toBe(3);
    expect(index.farthestFreeX[2 * GRAPHWAR_PLANE_LENGTH + 4]).toBe(-1);
    expect(index.farthestFreeX[2 * GRAPHWAR_PLANE_LENGTH + 5]).toBe(GRAPHWAR_PLANE_LENGTH - 1);
  });

  it("builds the same reachability index for mirrored x+ bounds", () => {
    const mask = createEmptyMask();
    mask[2 * GRAPHWAR_PLANE_LENGTH + 4] = 1;
    const index = createGraphwarStepGlitchScanMaskIndex({
      bounds: { ...bounds, maxX: bounds.minX, minX: bounds.maxX },
      simulationMask: mask,
    });
    const blockedSearchX = GRAPHWAR_PLANE_LENGTH - 1 - 4;

    expect(index.mirrored).toBe(true);
    expect(index.farthestFreeX[2 * GRAPHWAR_PLANE_LENGTH]).toBe(blockedSearchX - 1);
    expect(index.farthestFreeX[2 * GRAPHWAR_PLANE_LENGTH + blockedSearchX]).toBe(-1);
  });

  it("rejects modes other than an effective Step ODE glitch", () => {
    const start = toPixel(-11, 0);
    const target = toPixel(-6, 0);
    const result = scanGraphwarStepGlitchPath({
      bounds,
      boundsRect,
      hitTarget: { center: target, radius: 8 },
      settings: { ...settings, equation: "y" },
      simulationMask: createEmptyMask(),
      sourcePath: [start],
      targetPoint: target,
    });

    expect(result).toMatchObject({ expandedStates: 0, status: "unsupported" });
  });

  it("returns hit after replaying the complete final expression", () => {
    const start = toPixel(-11, 0);
    const target = toPixel(-6, 2);
    const result = scanGraphwarStepGlitchPath({
      bounds,
      boundsRect,
      hitTarget: { center: target, radius: 12 },
      settings,
      simulationMask: createEmptyMask(),
      sourcePath: [start],
      targetPoint: target,
    });

    expect(result.status).toBe("hit");
    expect(result.expandedStates).toBe(1);
    expect(result.reachedTargetCount).toBe(1);
    if (result.status === "hit") {
      expect(result.path.at(-1)).toBe(target);
    }
  });

  it("allows the current target before a farther unordered required hit", () => {
    const start = toPixel(-11, 0);
    const target = toPixel(-8, 0);
    const required = toPixel(-6, 0);
    const result = scanGraphwarStepGlitchPath({
      bounds,
      boundsRect,
      hitTarget: { center: target, radius: 12 },
      requiredTargets: [{ center: required, radius: 12 }],
      settings,
      simulationMask: createEmptyMask(),
      sourcePath: [start],
      targetPoint: target,
    });

    expect(result.status).toBe("hit");
    expect(result.reachedTargetCount).toBe(2);
    if (result.status === "hit") {
      expect(result.path.at(-1)).toBe(target);
    }
  });

  it("rejects a required-only gate replay when the last required hit is on an obstacle sample", () => {
    const start = toPixel(-11, 0);
    const required = toPixel(-8, 0);
    const end = toPixel(-6, 0);
    const simulationMask = createEmptyMask();
    simulationMask[Math.floor(required.y) * GRAPHWAR_PLANE_LENGTH + Math.floor(required.x)] = 1;

    const replay = replayGraphwarStepGlitchPathToControlX({
      bounds,
      boundsRect,
      controlX: -8,
      path: [start, end],
      requiredTargets: [{ center: required, radius: 12 }],
      settings,
      simulationMask,
      sourcePath: [start],
      targetSequence: [],
    });

    expect(replay.targetsHit).toBe(true);
    expect(replay.acceptedPoint).toBeUndefined();
  });

  it("returns no-path when the formula reaches the control x without hitting the requested circle", () => {
    const start = toPixel(-11, 0);
    const targetPoint = toPixel(-6, 0);
    const missedTarget = toPixel(-6, 8);
    const result = scanGraphwarStepGlitchPath({
      bounds,
      boundsRect,
      hitTarget: { center: missedTarget, radius: 2 },
      settings,
      simulationMask: createEmptyMask(),
      sourcePath: [start],
      targetPoint,
    });

    expect(result.status).toBe("no-path");
    expect(result.expandedStates).toBe(1);
  });

  it("jumps to a disjoint free row when the trajectory collides outside the clear source row", () => {
    const start = toPixel(-11, 0);
    const target = toPixel(-6, 4);
    const mask = createEmptyMask();
    const wallX = Math.floor(((toPixel(-6.5, 0).x - boundsRect.x) / boundsRect.width) * GRAPHWAR_PLANE_LENGTH);
    for (let row = 180; row <= 270; row += 1) {
      if (row !== Math.floor(start.y)) {
        mask[row * GRAPHWAR_PLANE_LENGTH + wallX] = 1;
      }
    }
    const result = scanGraphwarStepGlitchPath({
      bounds,
      boundsRect,
      hitTarget: { center: target, radius: 12 },
      settings,
      simulationMask: mask,
      sourcePath: [start],
      targetPoint: target,
    });

    expect(result.status).toBe("hit");
    if (result.status === "hit") {
      const gate = result.path.at(-2);
      expect(result.path).toHaveLength(3);
      expect(result.formulaContext?.formulaEvaluation.segmentStartPoints?.[1]).toEqual(
        result.formulaContext?.stepGlitchFormulaPrefix?.segmentStartPoints[1],
      );
      expect(result.formulaContext?.formulaEvaluation.segmentStartPoints?.[1]).toBeDefined();
      expect(gate?.x).toBeGreaterThan(start.x);
      expect(gate?.x).toBeLessThan(target.x);
      expect(result.path.at(-1)).toBe(target);
    }
  });

  it("replays one physical jump with a second-order Step formula", () => {
    const start = toPixel(-11, 0);
    const target = toPixel(-6, 4);
    const mask = createEmptyMask();
    const obstacleStartX = Math.floor(toPixel(-6.5, 0).x);
    const obstacleEndX = Math.floor(toPixel(-6.3, 0).x);
    for (let row = Math.floor(target.y) + 1; row < Math.floor(start.y); row += 1) {
      for (let x = obstacleStartX; x <= obstacleEndX; x += 1) {
        mask[row * GRAPHWAR_PLANE_LENGTH + x] = 1;
      }
    }
    mask[Math.floor(start.y) * GRAPHWAR_PLANE_LENGTH + obstacleEndX] = 1;

    const points = [start, target].map((point) => imageToGraphPoint(point, bounds, boundsRect));
    const resolved = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      collision: { mask },
      points,
      settings: { ...settings, equation: "ddy", stepGlitchObstacleMask: mask },
      soldierCenter: points[0],
      stepGlitchXWindows: [{ endX: -6.5977, startX: -6.6077 }],
    });
    const segment = resolved.context.stepGlitchFormulaPrefix?.stepGlitchSegments[0];
    expect(segment).toEqual(expect.objectContaining({ equation: "ddy" }));
    expect(resolved.result.obstacleHitIndex).toBe(-1);
    expect(countPhysicalStepGlitchJumps(resolved.result.sample.points)).toBe(1);
    expect(
      sampleGraphwarExpressionTrajectory({
        bounds,
        equation: "ddy",
        expression: resolved.context.formulaResult.expression,
        launchAngleRadians: getGraphwarTrajectoryLaunchAngle(resolved.context),
        soldierCenter: points[0],
      }),
    ).toEqual(resolved.result.sample);
  });

  it("preserves the intended decimal right gate through the pixel round-trip", () => {
    const start = toPixel(-11, 0);
    const target = toPixel(-5.5, 4);
    const mask = createEmptyMask();
    const wallX = 516;
    const landingRow = 100;
    for (let row = 0; row < GRAPHWAR_PLANE_HEIGHT; row += 1) {
      if (row !== landingRow) {
        mask[row * GRAPHWAR_PLANE_LENGTH + wallX] = 1;
      }
    }
    const result = scanGraphwarStepGlitchPath({
      bounds,
      boundsRect,
      hitTarget: { center: target, radius: 12 },
      settings: { ...settings, decimalPlaces: 2 },
      simulationMask: mask,
      sourcePath: [start],
      targetPoint: target,
    });

    expect(result.status).toBe("hit");
    if (result.status === "hit") {
      expect(result.formulaContext?.stepGlitchFormulaPrefix?.stepGlitchSegments[0]).toBeDefined();
      const controlPoint = result.path.at(-2);
      const rawLeftGateX = imageToGraphPoint(createPixelPoint(wallX - 1, 0), bounds, boundsRect).x;
      const leftGateX = -floorToDecimalPlaces(-rawLeftGateX, 2);
      expect(controlPoint).toBeDefined();
      expect(result.path.at(-1)).toBe(target);
      if (controlPoint) {
        const controlX = imageToGraphPoint(controlPoint, bounds, boundsRect).x;
        expect(floorToDecimalPlaces(controlX, 2)).toBe(leftGateX + GRAPHWAR_STEP_SIZE);
      }
      const segment = result.formulaContext?.stepGlitchFormulaPrefix?.stepGlitchSegments.find(
        (candidate) => candidate !== undefined,
      );
      expect(segment?.startX).toBe(leftGateX);
      expect(segment?.endX).toBe(leftGateX + GRAPHWAR_STEP_SIZE);
    }
  });

  it("extends formula precision when the configured ceiling reaches the obstacle cell", () => {
    const start = toPixel(-11, 0);
    const target = toPixel(-5.5, 4);
    const mask = createEmptyMask();
    const wallX = 516;
    for (let row = 180; row <= 270; row += 1) {
      mask[row * GRAPHWAR_PLANE_LENGTH + wallX] = 1;
    }
    const result = scanGraphwarStepGlitchPath({
      bounds,
      boundsRect,
      hitTarget: { center: target, radius: 12 },
      settings: { ...settings, decimalPlaces: 0 },
      simulationMask: mask,
      sourcePath: [start],
      targetPoint: target,
    });

    expect(result.status).toBe("hit");
    if (result.status === "hit") {
      expect(result.formulaContext?.stepGlitchFormulaPrefix?.stepGlitchSegments[0]).toBeDefined();
      const controlPoint = result.path.at(-2);
      const rawLeftGateX = imageToGraphPoint(createPixelPoint(wallX - 1, 0), bounds, boundsRect).x;
      const leftGateX = -floorToDecimalPlaces(-rawLeftGateX, 2);
      expect(controlPoint).toBeDefined();
      if (controlPoint) {
        expect(floorToDecimalPlaces(imageToGraphPoint(controlPoint, bounds, boundsRect).x, 2)).toBe(
          leftGateX + GRAPHWAR_STEP_SIZE,
        );
      }
    }
  });

  it("rejects only the current gate when 15 decimals still collapse onto the obstacle", () => {
    const collapsedBounds: GraphBounds = {
      maxX: 10_000_000_000_001,
      maxY: 10,
      minX: 10_000_000_000_000,
      minY: -10,
    };
    const wallX = 500;
    const rawLeftGateX = imageToGraphPoint(createPixelPoint(wallX - 1, 0), collapsedBounds, boundsRect).x;
    expect(rawLeftGateX).toBe(imageToGraphPoint(createPixelPoint(wallX, 0), collapsedBounds, boundsRect).x);

    const start = toPixelForBounds(collapsedBounds.minX, 0, collapsedBounds);
    const target = toPixelForBounds(collapsedBounds.minX + 0.95, 0, collapsedBounds);
    const mask = createEmptyMask();
    for (let row = 1; row < GRAPHWAR_PLANE_HEIGHT; row += 1) {
      mask[row * GRAPHWAR_PLANE_LENGTH + wallX] = 1;
    }
    const result = scanGraphwarStepGlitchPath({
      bounds: collapsedBounds,
      boundsRect,
      hitTarget: { center: target, radius: 12 },
      settings,
      simulationMask: mask,
      sourcePath: [start],
      targetPoint: target,
    });

    expect(result.status).toBe("no-path");
    // 没有可提交的左门时不生成公式候选；外层扫描以普通 no-path 结束，不抛实现异常。
    expect(result.expandedStates).toBe(1);
  });

  it("keeps the pixel-derived right gate that used to exceed the fixed ULP retry limit", () => {
    const wideBounds: GraphBounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
    const start = toPixelForBounds(-1.5, 0, wideBounds);
    const target = toPixelForBounds(-0.9737, 2, wideBounds);
    const hitCenter = toPixelForBounds(-0.9737, 4, wideBounds);
    const mask = createEmptyMask();
    for (let row = 200; row <= 250; row += 1) {
      mask[row * GRAPHWAR_PLANE_LENGTH + 370] = 1;
    }
    const result = scanGraphwarStepGlitchPath({
      bounds: wideBounds,
      boundsRect,
      hitTarget: { center: hitCenter, radius: 12 },
      settings,
      simulationMask: mask,
      sourcePath: [start],
      targetPoint: target,
    });

    expect(result.status).toBe("hit");
    if (result.status === "hit") {
      const controlPoint = result.path.at(-2);
      expect(controlPoint).toBeDefined();
      if (controlPoint) {
        const rawLeftGateX = imageToGraphPoint(createPixelPoint(369, 0), wideBounds, boundsRect).x;
        expect(
          floorToDecimalPlaces(imageToGraphPoint(controlPoint, wideBounds, boundsRect).x, settings.decimalPlaces),
        ).toBe(-floorToDecimalPlaces(-rawLeftGateX, settings.decimalPlaces) + GRAPHWAR_STEP_SIZE);
      }
    }
  });

  it("preserves the intended decimal right gate with mirrored x+ bounds", () => {
    const mirroredBounds: GraphBounds = { ...bounds, maxX: bounds.minX, minX: bounds.maxX };
    const start = toPixelForBounds(-11, 0, mirroredBounds);
    const target = toPixelForBounds(-5.5, 4, mirroredBounds);
    const mask = createEmptyMask();
    const wallX = 263;
    for (let row = 180; row <= 270; row += 1) {
      mask[row * GRAPHWAR_PLANE_LENGTH + wallX] = 1;
    }
    const directReplay = replayGraphwarStepGlitchPathToControlX({
      bounds: mirroredBounds,
      boundsRect,
      controlX: imageToGraphPoint(target, mirroredBounds, boundsRect).x,
      path: [start, target],
      settings,
      simulationMask: mask,
      sourcePath: [start],
      targetSequence: [{ center: target, radius: 12 }],
    });
    expect(directReplay.blockedPoint).toBeDefined();
    const result = scanGraphwarStepGlitchPath({
      bounds: mirroredBounds,
      boundsRect,
      hitTarget: { center: target, radius: 12 },
      settings,
      simulationMask: mask,
      sourcePath: [start],
      targetPoint: target,
    });

    expect(result.status).toBe("hit");
    if (result.status === "hit") {
      const controlPoint = result.path.at(-2);
      expect(controlPoint).toBeDefined();
      expect(result.path.at(-1)).toBe(target);
      if (controlPoint) {
        const controlX = imageToGraphPoint(controlPoint, mirroredBounds, boundsRect).x;
        const blockedSearchX = GRAPHWAR_PLANE_LENGTH - 1 - wallX;
        const rawLeftGateX = imageToGraphPoint(
          createPixelPoint(GRAPHWAR_PLANE_LENGTH - (blockedSearchX - 1), 0),
          mirroredBounds,
          boundsRect,
        ).x;
        expect(floorToDecimalPlaces(controlX, settings.decimalPlaces)).toBe(
          -floorToDecimalPlaces(-rawLeftGateX, settings.decimalPlaces) + GRAPHWAR_STEP_SIZE,
        );
      }
    }
  });

  it("exhausts every finite landing branch before returning no-path", () => {
    const start = toPixel(-11, 0);
    const target = toPixel(-6, 4);
    const mask = createEmptyMask();
    const wallX = Math.floor(((toPixel(-8, 0).x - boundsRect.x) / boundsRect.width) * GRAPHWAR_PLANE_LENGTH);
    for (let row = 1; row < GRAPHWAR_PLANE_HEIGHT - 1; row += 1) {
      mask[row * GRAPHWAR_PLANE_LENGTH + wallX] = 1;
    }
    const result = scanGraphwarStepGlitchPath({
      bounds,
      boundsRect,
      hitTarget: { center: target, radius: 0 },
      settings,
      simulationMask: mask,
      sourcePath: [start],
      targetPoint: target,
    });

    expect(result.status).toBe("no-path");
    expect(result.expandedStates).toBeGreaterThan(1);
    expect(result).not.toHaveProperty("limitReached");
  });

  it("returns no-path when a full-height wall has no landing row", () => {
    const start = toPixel(-11, 0);
    const target = toPixel(-6, 0);
    const mask = createEmptyMask();
    const wallX = Math.floor(((toPixel(-8, 0).x - boundsRect.x) / boundsRect.width) * GRAPHWAR_PLANE_LENGTH);
    for (let row = 0; row < GRAPHWAR_PLANE_HEIGHT; row += 1) {
      mask[row * GRAPHWAR_PLANE_LENGTH + wallX] = 1;
    }
    const result = scanGraphwarStepGlitchPath({
      bounds,
      boundsRect,
      hitTarget: { center: target, radius: 8 },
      settings,
      simulationMask: mask,
      sourcePath: [start],
      targetPoint: target,
    });

    expect(result.status).toBe("no-path");
    expect(result.expandedStates).toBe(1);
  });

  it("returns invalid-input when the assigned target does not advance x", () => {
    const start = toPixel(-11, 0);
    const target = toPixel(-11.5, 0);
    const result = scanGraphwarStepGlitchPath({
      bounds,
      boundsRect,
      hitTarget: { center: target, radius: 8 },
      settings,
      simulationMask: createEmptyMask(),
      sourcePath: [start],
      targetPoint: target,
    });

    expect(result).toMatchObject({ expandedStates: 0, status: "invalid-input" });
  });
});

function createEmptyMask() {
  return new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
}

/** Counts accepted minimum-step segments whose vertical displacement still exceeds Graphwar's distance limit. */
function countPhysicalStepGlitchJumps(points: readonly { x: number; y: number }[]) {
  let count = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (
      point.x - previous.x <= GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE &&
      (point.x - previous.x) ** 2 + (point.y - previous.y) ** 2 > GRAPHWAR_FUNC_MAX_STEP_DISTANCE_SQUARED
    ) {
      count += 1;
    }
  }
  return count;
}

function toPixel(x: number, y: number) {
  return toPixelForBounds(x, y, bounds);
}

function toPixelForBounds(x: number, y: number, pointBounds: GraphBounds) {
  return graphToImagePoint(createGraphPoint(x, y), pointBounds, boundsRect);
}
