import { describe, expect, it } from "vitest";

import { graphToImagePoint, imageToGraphPoint } from "../../core/geometry";
import { graphXAdvancesStrictly } from "../../core/numbers";
import { createGraphPoint, createPixelPoint } from "../../core/types";
import type { BoundsRect, GraphBounds } from "../../core/types";
import {
  assignGraphwarStepGlitchTargetRoutePoints,
  type GraphwarStepGlitchTargetCandidate,
} from "./step-glitch-targets";

interface TestHitCircle {
  id: string;
  sourcePixelX?: number;
}

type TestTarget = GraphwarStepGlitchTargetCandidate<TestHitCircle>;

const defaultAssignmentOptions = {
  pathTailX: 0,
  usableMaxX: 100,
  usableMinX: -100,
  xPlusIsRight: true,
};

describe("Step glitch one-click-clear target assignment", () => {
  it("uses the center for an unanchored singleton and preserves its hit circle", () => {
    const hitCircle = { id: "only" };
    const target = createTarget("only", 10, 3, 2, 0, hitCircle);

    const assigned = assignGraphwarStepGlitchTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [target],
    });

    expect(assigned).toHaveLength(1);
    expect(assigned[0]?.routePoint).toEqual(createPixelPoint(10, 3));
    expect(assigned[0]?.hitCircle).toBe(hitCircle);
  });

  it("keeps a singleton at its center when the previous point is inside its hit circle", () => {
    const assigned = assignGraphwarStepGlitchTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [createTarget("only", 10, 3, 2, 0)],
      pathTailX: 9,
    });

    expect(assigned.map((target) => target.routePoint)).toEqual([createPixelPoint(10, 3)]);
  });

  it("keeps a singleton at its center when the next column is inside its hit circle", () => {
    const assigned = assignGraphwarStepGlitchTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [createTarget("only", 10, 3, 5, 0), createTarget("next", 12, 4, 1, 1)],
    });

    expect(assigned.map((target) => target.routePoint)).toEqual([createPixelPoint(10, 3), createPixelPoint(12, 4)]);
  });

  it("spans the strict shared hit interval and gives larger map y the more-left x", () => {
    const candidates = [
      createTarget("smallest-y", 10, -4, 2, 0),
      createTarget("equal-y-first", 10, 2, 2.5, 1),
      createTarget("largest-y", 10, 8, 2, 2),
      createTarget("equal-y-later", 10, 2, 3, 3),
    ];

    const assigned = assignGraphwarStepGlitchTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates,
    });
    const assignedXs = assigned.map((target) => target.routePoint.x);

    expect(assigned.map((target) => target.hitCircle.id)).toEqual([
      "largest-y",
      "equal-y-first",
      "equal-y-later",
      "smallest-y",
    ]);
    expectStrictlyIncreasing(assignedXs, 0);
    expect(assignedXs[0]).toBeGreaterThan(8);
    expect(assignedXs.at(-1)).toBeLessThan(12);
    for (let index = 2; index < assignedXs.length; index += 1) {
      expect((assignedXs[index] ?? 0) - (assignedXs[index - 1] ?? 0)).toBeCloseTo(
        (assignedXs[1] ?? 0) - (assignedXs[0] ?? 0),
        12,
      );
    }
  });

  it("uses the outermost integer pixel centers inside a shared hit circle", () => {
    const assigned = assignGraphwarStepGlitchTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [createTarget("a", 10.25, -1, 2, 0), createTarget("b", 10.25, 1, 2, 1)],
    });

    expect(assigned.map((target) => target.routePoint.x)).toEqual([9, 12]);
  });

  it("distributes after a left anchor through the safe right edge", () => {
    const assigned = assignGraphwarStepGlitchTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [createTarget("a", 10, -1, 2, 0), createTarget("b", 10, 1, 2, 1)],
      pathTailX: 9,
    });
    const assignedXs = assigned.map((target) => target.routePoint.x);
    const right = assignedXs[1] ?? Number.NaN;

    expect(assignedXs[0]).toBeCloseTo(9 + (right - 9) / 2, 12);
    expect(right).toBeLessThan(12);
    expectStrictlyIncreasing(assignedXs, 9);
  });

  it("uses the previous group assignment as the next group left anchor", () => {
    const assigned = assignGraphwarStepGlitchTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [
        createTarget("first", 8, 0, 0.5, 0),
        createTarget("next-a", 10, -1, 3, 1),
        createTarget("next-b", 10, 1, 3, 2),
      ],
    });
    const assignedXs = assigned.map((target) => target.routePoint.x);
    const right = assignedXs[2] ?? Number.NaN;

    expect(assignedXs[0]).toBe(8);
    expect(assignedXs[1]).toBeCloseTo(8 + (right - 8) / 2, 12);
    expectStrictlyIncreasing(assignedXs, 0);
  });

  it("distributes before a right anchor from the safe left edge", () => {
    const rightAnchor = 12;
    const assigned = assignGraphwarStepGlitchTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [
        createTarget("a", 10, -1, 5, 0),
        createTarget("b", 10, 1, 5, 1),
        createTarget("next", rightAnchor, 0, 1, 2),
      ],
    });
    const assignedXs = assigned.map((target) => target.routePoint.x);
    const left = assignedXs[0] ?? Number.NaN;

    expect(left).toBeGreaterThan(5);
    expect(assignedXs[1]).toBeCloseTo(left + (rightAnchor - left) / 2, 12);
    expect(assignedXs[2]).toBe(rightAnchor);
    expectStrictlyIncreasing(assignedXs, 0);
  });

  it("places a group strictly between left and right anchors", () => {
    const leftAnchor = 8;
    const rightAnchor = 12;
    const assigned = assignGraphwarStepGlitchTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [
        createTarget("a", 10, -1, 5, 0),
        createTarget("b", 10, 1, 5, 1),
        createTarget("next", rightAnchor, 0, 1, 2),
      ],
      pathTailX: leftAnchor,
    });

    expect(assigned.slice(0, 2).map((target) => target.routePoint.x)).toEqual([
      leftAnchor + (rightAnchor - leftAnchor) / 3,
      leftAnchor + ((rightAnchor - leftAnchor) * 2) / 3,
    ]);
    expectStrictlyIncreasing(
      assigned.map((target) => target.routePoint.x),
      leftAnchor,
    );
  });

  it("skips a group when its hit interval cannot represent distinct points", () => {
    const centerX = 1;
    const radius = Number.EPSILON / 2;
    const assigned = assignGraphwarStepGlitchTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [createTarget("a", centerX, -1, radius, 0), createTarget("b", centerX, 1, radius, 1)],
    });

    expect(assigned).toEqual([]);
  });

  it("keeps Graph x increasing while mirrored pixel x decreases", () => {
    const bounds: GraphBounds = { maxX: -25, maxY: 15, minX: 25, minY: -15 };
    const boundsRect: BoundsRect = { height: 450, width: 770, x: 0, y: 0 };
    const first = graphToImagePoint(createGraphPoint(-10, 0), bounds, boundsRect);
    const second = graphToImagePoint(createGraphPoint(10, 0), bounds, boundsRect);
    const tail = graphToImagePoint(createGraphPoint(-20, 0), bounds, boundsRect);
    const assigned = assignGraphwarStepGlitchTargetRoutePoints({
      candidates: [
        createTarget("left-graph", first.x, first.y, 10, 0, { id: "left-graph", sourcePixelX: first.x }),
        createTarget("right-graph", second.x, second.y, 10, 1, { id: "right-graph", sourcePixelX: second.x }),
      ],
      pathTailX: tail.x,
      usableMaxX: 770,
      usableMinX: 0,
      xPlusIsRight: false,
    });
    const graphXs = assigned.map((target) => imageToGraphPoint(target.routePoint, bounds, boundsRect).x);

    expectStrictlyIncreasing(graphXs, -20);
    expect(assigned[0]?.routePoint.x).toBeGreaterThan(assigned[1]?.routePoint.x ?? Number.POSITIVE_INFINITY);
    expect(assigned.map((target) => target.hitCircle.sourcePixelX)).toEqual([first.x, second.x]);
  });

  it.each([
    { bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 }, xPlusIsRight: true },
    { bounds: { maxX: -25, maxY: 15, minX: 25, minY: -15 }, xPlusIsRight: false },
  ] as const)(
    "orders same-x targets by map y and keeps them inside their circles after $xPlusIsRight round-trip",
    (test) => {
      const boundsRect: BoundsRect = { height: 450, width: 770, x: 0, y: 0 };
      const center = graphToImagePoint(createGraphPoint(10, 0), test.bounds, boundsRect);
      const tail = graphToImagePoint(createGraphPoint(0, 0), test.bounds, boundsRect);
      const hitRadius = (boundsRect.width / 50) * 1;
      const assigned = assignGraphwarStepGlitchTargetRoutePoints({
        candidates: [
          createTarget("smaller-y", center.x, center.y - 1, hitRadius, 0),
          createTarget("larger-y", center.x, center.y + 1, hitRadius, 1),
        ],
        pathTailX: tail.x,
        usableMaxX: 770,
        usableMinX: 0,
        xPlusIsRight: test.xPlusIsRight,
      });
      const graphXs = assigned.map((target) => imageToGraphPoint(target.routePoint, test.bounds, boundsRect).x);

      expect(assigned).toHaveLength(2);
      expect(assigned.map((target) => target.hitCircle.id)).toEqual(["larger-y", "smaller-y"]);
      expectStrictlyIncreasing(graphXs, 0);
      expect(
        test.xPlusIsRight
          ? (assigned[0]?.routePoint.x ?? 0) < (assigned[1]?.routePoint.x ?? 0)
          : (assigned[0]?.routePoint.x ?? 0) > (assigned[1]?.routePoint.x ?? 0),
      ).toBe(true);
      for (const target of assigned) {
        expect(
          (target.routePoint.x - target.center.x) ** 2 + (target.routePoint.y - target.center.y) ** 2,
        ).toBeLessThan(hitRadius ** 2);
      }
    },
  );
});

function createTarget(
  id: string,
  centerX: number,
  centerY: number,
  hitRadius: number,
  sourceIndex: number,
  hitCircle: TestHitCircle = { id },
): TestTarget {
  const center = createPixelPoint(centerX, centerY);
  return {
    center,
    hitCircle,
    hitRadius,
    routePoint: center,
    sourceIndex,
  };
}

function expectStrictlyIncreasing(values: readonly number[], startX: number) {
  let previous = startX;
  for (const value of values) {
    expect(graphXAdvancesStrictly(previous, value)).toBe(true);
    previous = value;
  }
}
