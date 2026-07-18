import { describe, expect, it } from "vitest";

import { imageToGraphPoint } from "../../core/geometry";
import { graphXAdvancesStrictly, nextDownDouble } from "../../core/numbers";
import { createPixelPoint } from "../../core/types";
import type { BoundsRect, GraphBounds, PixelPoint } from "../../core/types";
import { sampleGraphwarPathTargetSequence } from "../../formula/trajectory/sampling";
import {
  assignGraphwarOneClickClearTargetRoutePoints,
  type GraphwarOneClickClearAssignmentCandidate,
} from "./target-assignment";

interface TestHitCircle {
  id: string;
}

type TestTarget = GraphwarOneClickClearAssignmentCandidate<TestHitCircle>;

const bounds: GraphBounds = { maxX: 100, maxY: 50, minX: 0, minY: -50 };
const boundsRect: BoundsRect = { height: 100, width: 100, x: 0, y: 0 };
const defaultAssignmentOptions = {
  bounds,
  boundsRect,
  pathTail: createPixelPoint(0, 50),
  usableMaxX: nextDownDouble(100),
  usableMaxY: nextDownDouble(100),
  usableMinX: 0,
  usableMinY: 0,
};

describe("one-click-clear target assignment", () => {
  it("keeps an unobstructed singleton center and its original hit object", () => {
    const hitCircle = { id: "only" };
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [createTarget("only", 10.25, 30, 2, 0, hitCircle)],
    });

    expect(assigned).toHaveLength(1);
    expect(assigned[0]?.routePoint).toEqual(createPixelPoint(10.25, 30));
    expect(assigned[0]?.hitCircle).toBe(hitCircle);
  });

  it("uses the outermost strict integer pixel when only the hit-circle edge advances", () => {
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [createTarget("edge", 10.25, 30, 2, 0)],
      pathTail: createPixelPoint(10.5, 50),
    });

    expect(assigned.map((target) => target.routePoint)).toEqual([createPixelPoint(12, 30)]);
  });

  it("clips an edge target to the outermost available safe pixel", () => {
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [createTarget("clipped", 98, 30, 5, 0)],
      pathTail: createPixelPoint(98.5, 50),
    });

    expect(assigned.map((target) => target.routePoint.x)).toEqual([99]);
  });

  it("keeps a fractional center inside the half-open usable boundary", () => {
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [createTarget("fractional", 99.5, 30, 1, 0)],
      pathTail: createPixelPoint(90, 50),
    });

    expect(assigned.map((target) => target.routePoint)).toEqual([createPixelPoint(99.5, 30)]);
  });

  it("omits a soldier whose entire strict hit circle is not on the x+ side", () => {
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [createTarget("behind", 10, 30, 2, 0)],
      pathTail: createPixelPoint(12, 50),
    });

    expect(assigned).toEqual([]);
  });

  it("orders equal initial x by descending screenshot y and then stable input index", () => {
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [
        createTarget("small-y", 10, 20, 2, 0),
        createTarget("equal-y-first", 10, 30, 2, 1),
        createTarget("large-y", 10, 40, 2, 2),
        createTarget("equal-y-later", 10, 30, 2, 3),
      ],
    });

    expect(assigned.map((target) => target.hitCircle.id)).toEqual([
      "large-y",
      "equal-y-first",
      "equal-y-later",
      "small-y",
    ]);
    expectStrictlyIncreasingGraphXs(assigned.map((target) => target.routePoint));
    for (const target of assigned) {
      expect((target.routePoint.x - target.center.x) ** 2).toBeLessThan(target.hitRadius ** 2);
    }
  });

  it("lets a larger hit circle use space outside a smaller target's interval", () => {
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [createTarget("small", 10, 40, 0.25, 0), createTarget("large", 10, 20, 5, 1)],
    });

    expect(assigned.map((target) => target.hitCircle.id)).toEqual(["small", "large"]);
    expect(assigned[0]?.routePoint.x).toBeGreaterThan(9.7);
    expect(assigned[1]?.routePoint.x).toBeGreaterThan(10.25);
    expectStrictlyIncreasingGraphXs(assigned.map((target) => target.routePoint));
  });

  it("keeps the last equal-center target away from the strict x+ circle boundary", () => {
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [createTarget("lower", 50, 60, 7, 0), createTarget("upper", 50, 40, 7, 1)],
    });

    expect(assigned[1]?.routePoint.x).toBe(50);
    expectStrictlyIncreasingGraphXs(assigned.map((target) => target.routePoint));
  });

  it("preserves both same-x hits after Step formula quantization and sampling", () => {
    const replayBounds: GraphBounds = {
      maxX: 25,
      maxY: 14.61038961038961,
      minX: -25,
      minY: -14.61038961038961,
    };
    const replayBoundsRect: BoundsRect = { height: 450, width: 770, x: 0, y: 0 };
    const firstCenter = createPixelPoint(609, 370);
    const secondCenter = createPixelPoint(609, 280);
    const prefix = [
      createPixelPoint(243, 356),
      createPixelPoint(413, 251),
      createPixelPoint(416, 230),
      createPixelPoint(443, 49),
      createPixelPoint(462, 93),
      createPixelPoint(472, 199),
      createPixelPoint(483, 251),
      createPixelPoint(485, 406),
      createPixelPoint(495, 355),
      createPixelPoint(527, 290),
      createPixelPoint(544, 318),
      createPixelPoint(545, 98),
      createPixelPoint(561, 199),
      createPixelPoint(574, 25),
      createPixelPoint(587, 225),
      createPixelPoint(599, 146),
    ];
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      bounds: replayBounds,
      boundsRect: replayBoundsRect,
      candidates: [
        createTarget("first", firstCenter.x, firstCenter.y, 7, 0),
        createTarget("second", secondCenter.x, secondCenter.y, 7, 1),
      ],
      pathTail: prefix.at(-1) ?? prefix[0],
      usableMaxX: nextDownDouble(770),
      usableMaxY: nextDownDouble(450),
      usableMinX: 0,
      usableMinY: 0,
    });
    const result = sampleGraphwarPathTargetSequence({
      bounds: replayBounds,
      boundsRect: replayBoundsRect,
      points: [...prefix, ...assigned.map((target) => target.routePoint)],
      settings: {
        algorithm: "step",
        decimalPlaces: 4,
        equation: "dy",
        formulaPathSteepness: 210,
        steepness: 210,
        stepGlitchMode: true,
        stepOverflowProtection: true,
      },
      targetCircles: [
        { center: firstCenter, radius: 7 },
        { center: secondCenter, radius: 7 },
      ],
      targetControlPoints: assigned.map((target) => target.routePoint),
      targetHitRadiusPixels: 7,
      targetPoints: assigned.map((target) => target.routePoint),
    });

    expect(result.reachesTargetSequenceBeforeObstacle).toBe(true);
    expect(result.reachedTargetCount).toBe(2);
  });

  it("retains a failed target at its initial point and continues with later groups", () => {
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [
        createTarget("first-small", 10, 40, 0.1, 0),
        createTarget("middle-large", 10, 30, 5, 1),
        createTarget("failed-small", 10, 20, 0.1, 2),
        createTarget("later", 20, 30, 1, 3),
      ],
    });

    expect(assigned.map((target) => target.hitCircle.id)).toEqual([
      "first-small",
      "failed-small",
      "middle-large",
      "later",
    ]);
    expect(assigned.find((target) => target.hitCircle.id === "failed-small")?.routePoint.x).toBe(10);
    expect(assigned.find((target) => target.hitCircle.id === "later")?.routePoint.x).toBe(20);
  });

  it("processes edge targets before center targets that share the same initial x", () => {
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [createTarget("center", 12, 40, 0.25, 0), createTarget("edge", 10.25, 20, 2, 1)],
      pathTail: createPixelPoint(11.5, 50),
    });

    expect(assigned.map((target) => target.hitCircle.id)).toEqual(["edge", "center"]);
    expect(assigned[0]?.routePoint.x).toBe(12);
    expect(assigned[1]?.routePoint.x).toBeGreaterThan(12);
  });

  it("pushes a rounded equal slot to the next usable Graphwar double", () => {
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [
        createTarget("edge", 0.25, 10, 1, 0),
        ...Array.from({ length: 20 }, (_, index) => createTarget(`center-${index}`, 1, 80 - index, 2e-15, index + 1)),
      ],
      pathTail: createPixelPoint(0.9, 50),
    });
    const firstCenter = assigned.find((target) => target.hitCircle.id === "center-0");

    expect(firstCenter?.routePoint.x).toBeGreaterThan(1);
    expect((firstCenter?.routePoint.x ?? Number.POSITIVE_INFINITY) - 1).toBeLessThan(2e-15);
  });

  it("keeps Graph x increasing when mirrored screenshot x decreases", () => {
    const mirroredBounds: GraphBounds = { ...bounds, maxX: 0, minX: 100 };
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      bounds: mirroredBounds,
      candidates: [createTarget("large-y", 80, 40, 3, 0), createTarget("small-y", 80, 20, 3, 1)],
      pathTail: createPixelPoint(90, 50),
    });
    const graphXs = assigned.map((target) => imageToGraphPoint(target.routePoint, mirroredBounds, boundsRect).x);

    expect(assigned.map((target) => target.hitCircle.id)).toEqual(["large-y", "small-y"]);
    expect(assigned[0]?.routePoint.x).toBeGreaterThan(assigned[1]?.routePoint.x ?? Number.POSITIVE_INFINITY);
    expect(graphXAdvancesStrictly(graphXs[0] ?? Number.NaN, graphXs[1] ?? Number.NaN)).toBe(true);
  });

  it("uses the mirrored strict integer edge when a mirrored center does not advance", () => {
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      bounds: { ...bounds, maxX: 0, minX: 100 },
      candidates: [createTarget("edge", 89.75, 30, 2, 0)],
      pathTail: createPixelPoint(89.5, 50),
    });

    expect(assigned.map((target) => target.routePoint)).toEqual([createPixelPoint(88, 30)]);
  });

  it("omits targets whose fixed center y is outside the usable boundary", () => {
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [createTarget("outside-y", 10, 2, 3, 0)],
      usableMinY: 5,
    });

    expect(assigned).toEqual([]);
  });
});

/** 创建只包含共享分配协议字段的测试目标。 */
function createTarget(
  id: string,
  centerX: number,
  centerY: number,
  hitRadius: number,
  sourceIndex: number,
  hitCircle: TestHitCircle = { id },
): TestTarget {
  return {
    center: createPixelPoint(centerX, centerY),
    hitCircle,
    hitRadius,
    sourceIndex,
  };
}

/** 断言截图点映射后的 Graph x 严格递增。 */
function expectStrictlyIncreasingGraphXs(points: readonly PixelPoint[]) {
  let previousGraphX = imageToGraphPoint(defaultAssignmentOptions.pathTail, bounds, boundsRect).x;
  for (const point of points) {
    const graphX = imageToGraphPoint(point, bounds, boundsRect).x;
    expect(graphXAdvancesStrictly(previousGraphX, graphX)).toBe(true);
    previousGraphX = graphX;
  }
}
