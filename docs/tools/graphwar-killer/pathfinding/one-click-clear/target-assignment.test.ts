import { describe, expect, it } from "vitest";

import { imageToGraphPoint } from "../../core/geometry";
import { graphXAdvancesStrictly } from "../../core/numbers";
import {
  forwardColumnToPlaneColumn,
  imageXToNearestPlaneColumn,
  imageXToPlaneX,
  planeColumnToForwardColumn,
  planeXToForwardX,
  planeXToImageX,
} from "../../core/plane-grid";
import { createPixelPoint } from "../../core/types";
import type { BoundsRect, GraphBounds } from "../../core/types";
import { sampleGraphwarPathTargetSequence } from "../../formula/trajectory/sampling";
import {
  assignGraphwarOneClickClearTargetRoutePoints,
  type GraphwarOneClickClearAssignedTarget,
  type GraphwarOneClickClearAssignmentCandidate,
  type GraphwarOneClickClearTargetAssignmentOptions,
} from "./target-assignment";

interface TestHitCircle {
  id: string;
}

type TestTarget = GraphwarOneClickClearAssignmentCandidate<TestHitCircle>;

const bounds: GraphBounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
const boundsRect: BoundsRect = { height: 450, width: 770, x: 0, y: 0 };
const defaultAssignmentOptions = {
  bounds,
  boundsRect,
  pathTail: createPixelPoint(0, 225),
  usableRect: boundsRect,
};

describe("one-click-clear native-column target assignment", () => {
  it("projects a singleton center to its nearest native column and preserves the hit object", () => {
    const hitCircle = { id: "only" };
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [createTarget("only", 10.25, 30, 2, 0, hitCircle)],
    });

    expect(assigned).toHaveLength(1);
    expect(assigned[0]?.routePoint).toEqual(createPixelPoint(10, 30));
    expect(assigned[0]?.hitCircle).toBe(hitCircle);
  });

  it("uses the first strict-circle column when the preferred center column cannot advance", () => {
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [createTarget("edge", 10.25, 30, 2, 0)],
      pathTail: createPixelPoint(10.5, 225),
    });

    expect(assigned.map((target) => target.routePoint)).toEqual([createPixelPoint(12, 30)]);
  });

  it("uses half-open usable boundaries for integer columns and fixed center y", () => {
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [createTarget("right", 769.5, 449.999, 2, 0), createTarget("bottom", 100, 450, 2, 1)],
      pathTail: createPixelPoint(760, 225),
    });

    expect(assigned.map((target) => target.hitCircle.id)).toEqual(["right"]);
    expect(assigned[0]?.routePoint).toEqual(createPixelPoint(769, 449.999));
  });

  it("orders one preferred-column group by descending y and stable source index", () => {
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [
        createTarget("small-y", 10, 20, 7, 0),
        createTarget("equal-y-first", 10, 30, 7, 1),
        createTarget("large-y", 10, 40, 7, 2),
        createTarget("equal-y-later", 10, 30, 7, 3),
      ],
    });

    expect(assigned.map((target) => target.hitCircle.id)).toEqual([
      "large-y",
      "equal-y-first",
      "equal-y-later",
      "small-y",
    ]);
    expect(assigned.map((target) => target.routePoint.x)).toEqual([4, 5, 6, 7]);
    expectAssignmentsValid(defaultAssignmentOptions, assigned);
  });

  it("excludes a radius boundary column instead of moving it inward with a ULP", () => {
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [createTarget("strict", 50, 30, 7, 0)],
      pathTail: createPixelPoint(42, 225),
      usableRect: { ...boundsRect, width: 47 },
    });

    expect(assigned[0]?.routePoint.x).toBe(44);
    expect((assigned[0]?.routePoint.x ?? 0) - 50).not.toBe(-7);
  });

  it("assigns executable distinct columns for the reported 419/426 same-x regression", () => {
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [createTarget("lower", 426, 292, 7, 0), createTarget("upper", 426, 100, 7, 1)],
      pathTail: createPixelPoint(419, 100),
    });

    expect(assigned.map((target) => target.routePoint.x)).toEqual([420, 421]);
    expectAssignmentsValid({ ...defaultAssignmentOptions, pathTail: createPixelPoint(419, 100) }, assigned);
  });

  it("omits an unassignable target without blocking later preferred columns", () => {
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [
        createTarget("first-small", 10, 40, 0.1, 0),
        createTarget("middle-large", 10, 30, 5, 1),
        createTarget("failed-small", 10, 20, 0.1, 2),
        createTarget("later", 20, 30, 1, 3),
      ],
    });

    expect(assigned.map((target) => target.hitCircle.id)).toEqual(["first-small", "middle-large", "later"]);
    expect(assigned.map((target) => target.routePoint.x)).toEqual([10, 11, 20]);
  });

  it("absorbs near-integer path-tail residue but requires a full pixel after fractional tails", () => {
    const nearInteger = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [createTarget("near", 426, 30, 7, 0)],
      pathTail: createPixelPoint(419.00000000000006, 225),
    });
    const fractional = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [createTarget("fractional", 426, 30, 7, 0)],
      pathTail: createPixelPoint(419.25, 225),
    });

    expect(nearInteger[0]?.routePoint.x).toBe(426);
    expect(fractional[0]?.routePoint.x).toBe(426);

    const forcedNearInteger = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [createTarget("near", 420, 30, 2, 0)],
      pathTail: createPixelPoint(419.00000000000006, 225),
    });
    const forcedFractional = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      candidates: [createTarget("fractional", 420, 30, 2, 0)],
      pathTail: createPixelPoint(419.25, 225),
    });
    expect(forcedNearInteger[0]?.routePoint.x).toBe(420);
    expect(forcedFractional[0]?.routePoint.x).toBe(421);
  });

  it("keeps forward columns increasing when mirrored screenshot x decreases", () => {
    const mirroredBounds: GraphBounds = { ...bounds, maxX: -25, minX: 25 };
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      ...defaultAssignmentOptions,
      bounds: mirroredBounds,
      candidates: [createTarget("large-y", 80, 40, 3, 0), createTarget("small-y", 80, 20, 3, 1)],
      pathTail: createPixelPoint(90, 225),
    });
    const graphXs = assigned.map((target) => imageToGraphPoint(target.routePoint, mirroredBounds, boundsRect).x);

    expect(assigned.map((target) => target.routePoint.x)).toEqual([82, 81]);
    expect(graphXAdvancesStrictly(graphXs[0] ?? Number.NaN, graphXs[1] ?? Number.NaN)).toBe(true);
  });

  it("preserves both same-x hits after Step formula quantization and sampling", () => {
    const replayBounds: GraphBounds = {
      maxX: 25,
      maxY: 14.61038961038961,
      minX: -25,
      minY: -14.61038961038961,
    };
    const firstCenter = createPixelPoint(609, 370);
    const secondCenter = createPixelPoint(609, 280);
    const pathTail = createPixelPoint(599, 146);
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
      pathTail,
    ];
    const assigned = assignGraphwarOneClickClearTargetRoutePoints({
      bounds: replayBounds,
      boundsRect,
      candidates: [
        createTarget("first", firstCenter.x, firstCenter.y, 7, 0),
        createTarget("second", secondCenter.x, secondCenter.y, 7, 1),
      ],
      pathTail,
      usableRect: boundsRect,
    });
    const result = sampleGraphwarPathTargetSequence({
      bounds: replayBounds,
      boundsRect,
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

    expect(assigned.map((target) => target.routePoint.x)).toEqual([603, 604]);
    expect(result.reachesTargetSequenceBeforeObstacle).toBe(true);
    expect(result.reachedTargetCount).toBe(2);
  });

  it("keeps bounded exhaustive assignments finite, half-open, strict-circle, and at least one pixel forward", () => {
    for (const scale of [0.5, 1, 2]) {
      const scaledRect = { height: 450 * scale, width: 770 * scale, x: 10.25, y: 20.75 };
      for (const mirrored of [false, true]) {
        for (const centerColumn of [0, 1, 7, 384, 763, 769]) {
          const centerForwardColumn = planeColumnToForwardColumn(centerColumn, mirrored);
          for (const hitRadiusPlanePixels of [1.1, 3, 7]) {
            for (const pathTailOffset of [-8, 0, 8]) {
              const pathTailForwardX = centerForwardColumn + pathTailOffset;
              const pathTailPlaneX = mirrored ? 769 - pathTailForwardX : pathTailForwardX;
              for (const targetCount of [1, 2, 3]) {
                const options: GraphwarOneClickClearTargetAssignmentOptions<TestTarget> = {
                  bounds: mirrored ? { ...bounds, maxX: -25, minX: 25 } : bounds,
                  boundsRect: scaledRect,
                  candidates: Array.from({ length: targetCount }, (_, index) =>
                    createTarget(
                      `target-${index}`,
                      planeXToImageX(centerColumn, scaledRect),
                      scaledRect.y + 100 * scale + index,
                      hitRadiusPlanePixels * scale,
                      index,
                    ),
                  ),
                  pathTail: createPixelPoint(planeXToImageX(pathTailPlaneX, scaledRect), scaledRect.y + 200 * scale),
                  usableRect: scaledRect,
                };
                const assigned = assignGraphwarOneClickClearTargetRoutePoints(options);

                expect(assigned.map(summarizeAssignment)).toEqual(createNaiveAssignment(options));
                expectAssignmentsValid(options, assigned);
              }
            }
          }
        }
      }
    }
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

/** 用直接枚举全部 770 列的测试 oracle 计算稳定贪心结果。 */
function createNaiveAssignment(options: GraphwarOneClickClearTargetAssignmentOptions<TestTarget>) {
  const mirrored = options.bounds.maxX < options.bounds.minX;
  const prepared = options.candidates
    .filter(
      (candidate) =>
        Number.isFinite(candidate.center.x) &&
        Number.isFinite(candidate.center.y) &&
        Number.isFinite(candidate.hitRadius) &&
        candidate.hitRadius > 0 &&
        candidate.center.y >= options.usableRect.y &&
        candidate.center.y < options.usableRect.y + options.usableRect.height,
    )
    .map((candidate) => ({
      candidate,
      preferredForwardColumn: planeColumnToForwardColumn(
        imageXToNearestPlaneColumn(candidate.center.x, options.boundsRect, mirrored),
        mirrored,
      ),
    }))
    .sort(
      (left, right) =>
        left.preferredForwardColumn - right.preferredForwardColumn ||
        right.candidate.center.y - left.candidate.center.y ||
        left.candidate.sourceIndex - right.candidate.sourceIndex,
    );
  const result: ReturnType<typeof summarizeAssignment>[] = [];
  let previousForwardX = planeXToForwardX(imageXToPlaneX(options.pathTail.x, options.boundsRect), mirrored);

  let groupStart = 0;
  while (groupStart < prepared.length) {
    let groupEnd = groupStart + 1;
    while (
      groupEnd < prepared.length &&
      prepared[groupEnd]?.preferredForwardColumn === prepared[groupStart]?.preferredForwardColumn
    ) {
      groupEnd += 1;
    }
    const preferCenterColumn = groupEnd - groupStart === 1;
    for (let index = groupStart; index < groupEnd; index += 1) {
      const target = prepared[index];
      if (!target) {
        continue;
      }

      const minimumForwardColumn = Math.max(0, Math.ceil(previousForwardX + 1));
      const legalColumns: { forwardColumn: number; imageX: number }[] = [];
      for (let forwardColumn = minimumForwardColumn; forwardColumn < 770; forwardColumn += 1) {
        const imageX = planeXToImageX(forwardColumnToPlaneColumn(forwardColumn, mirrored), options.boundsRect);
        if (
          imageX >= options.usableRect.x &&
          imageX < options.usableRect.x + options.usableRect.width &&
          (imageX - target.candidate.center.x) ** 2 < target.candidate.hitRadius ** 2
        ) {
          legalColumns.push({ forwardColumn, imageX });
        }
      }
      const preferred = preferCenterColumn
        ? legalColumns.find((column) => column.forwardColumn === target.preferredForwardColumn)
        : undefined;
      const assigned = preferred ?? legalColumns[0];
      if (assigned) {
        result.push({ id: target.candidate.hitCircle.id, x: assigned.imageX, y: target.candidate.center.y });
        previousForwardX = assigned.forwardColumn;
      }
    }
    groupStart = groupEnd;
  }
  return result;
}

/** 把生产与 oracle 结果收窄成精确可比较字段。 */
function summarizeAssignment(target: GraphwarOneClickClearAssignedTarget<TestTarget>) {
  return { id: target.hitCircle.id, x: target.routePoint.x, y: target.routePoint.y };
}

/** 统一验证原生列分配器的几何和顺序不变量。 */
function expectAssignmentsValid(
  options: Omit<GraphwarOneClickClearTargetAssignmentOptions<TestTarget>, "candidates">,
  assigned: readonly GraphwarOneClickClearAssignedTarget<TestTarget>[],
) {
  const mirrored = options.bounds.maxX < options.bounds.minX;
  let previousForwardX = planeXToForwardX(imageXToPlaneX(options.pathTail.x, options.boundsRect), mirrored);
  for (const target of assigned) {
    const planeX = imageXToPlaneX(target.routePoint.x, options.boundsRect);
    const forwardX = planeXToForwardX(planeX, mirrored);
    expect(Number.isFinite(target.routePoint.x)).toBe(true);
    expect(planeX).toBeCloseTo(Math.round(planeX), 12);
    expect(target.routePoint.x).toBeGreaterThanOrEqual(options.usableRect.x);
    expect(target.routePoint.x).toBeLessThan(options.usableRect.x + options.usableRect.width);
    expect(target.routePoint.y).toBeGreaterThanOrEqual(options.usableRect.y);
    expect(target.routePoint.y).toBeLessThan(options.usableRect.y + options.usableRect.height);
    expect((target.routePoint.x - target.center.x) ** 2).toBeLessThan(target.hitRadius ** 2);
    expect(forwardX - previousForwardX).toBeGreaterThanOrEqual(1 - Number.EPSILON);
    previousForwardX = forwardX;
  }
}
