import { describe, expect, it } from "vitest";

import { graphToImagePoint } from "../core/geometry";
import { createGraphPoint, createPixelPoint } from "../core/types";
import { sampleGraphwarPathTargetSequence } from "../formula/trajectory/sampling";
import type { GraphwarTargetingArea, GraphwarTargetingSoldier } from "./targeting";
import {
  createAllowedTargetRect,
  createMinimumForwardTargetPoint,
  createSmartPathfindingSoldierTarget,
} from "./targeting";

const area: GraphwarTargetingArea = {
  bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
  boundsRect: { height: 450, width: 770, x: 0, y: 0 },
  targetBoundsRect: { height: 450, width: 770, x: 0, y: 0 },
};
const soldier: GraphwarTargetingSoldier = {
  hitRadius: 7,
  sourceCenterX: 38,
  sourceCenterY: 100,
};

describe("Step single-target soldier aiming", () => {
  it("keeps the center primary and adds the x+ inner edge as fallback", () => {
    const target = createSmartPathfindingSoldierTarget(createPixelPoint(32, 100), soldier, area, true);

    expect(target?.targetPoint).toEqual(createPixelPoint(38, 100));
    expect(target?.fallbackTargetPoint?.x).toBeGreaterThan(38);
    expect(target?.fallbackTargetPoint?.x).toBeLessThan(45);
    expect(target?.fallbackTargetPoint?.y).toBe(100);
  });

  it("uses the edge directly when the center is not x+ but the hit circle still crosses the start", () => {
    const target = createSmartPathfindingSoldierTarget(createPixelPoint(40, 100), soldier, area, true);

    expect(target?.targetPoint.x).toBeGreaterThan(40);
    expect(target?.targetPoint.x).toBeLessThan(45);
    expect(target?.fallbackTargetPoint).toBeUndefined();
  });

  it("does not add a second attempt to the existing ABS target semantics", () => {
    const target = createSmartPathfindingSoldierTarget(createPixelPoint(32, 100), soldier, area, false);

    expect(target?.targetPoint).toEqual(createPixelPoint(38, 100));
    expect(target?.fallbackTargetPoint).toBeUndefined();
  });

  it("uses the screen-left edge when mirrored bounds make it the x+ direction", () => {
    const mirroredArea = { ...area, bounds: { ...area.bounds, maxX: -25, minX: 25 } };
    const target = createSmartPathfindingSoldierTarget(createPixelPoint(44, 100), soldier, mirroredArea, true);

    expect(target?.targetPoint).toEqual(createPixelPoint(38, 100));
    expect(target?.fallbackTargetPoint?.x).toBeLessThan(38);
    expect(target?.fallbackTargetPoint?.x).toBeGreaterThan(31);
  });

  it("makes the reported 6px Step target reachable through its hit-circle edge", () => {
    const start = graphToImagePoint(
      createGraphPoint(-22.92207792207792, -9.220779220779221),
      area.bounds,
      area.boundsRect,
    );
    const center = graphToImagePoint(
      createGraphPoint(-22.532467532467532, -6.948051948051948),
      area.bounds,
      area.boundsRect,
    );
    const closeSoldier = { hitRadius: 7, sourceCenterX: center.x, sourceCenterY: center.y };
    const target = createSmartPathfindingSoldierTarget(start, closeSoldier, area, true);
    expect(target?.fallbackTargetPoint).toBeDefined();
    if (!target?.fallbackTargetPoint) {
      return;
    }

    const settings = {
      algorithm: "step" as const,
      decimalPlaces: 4,
      equation: "y" as const,
      steepness: 67,
      stepGlitchMode: false,
      stepOverflowProtection: true,
    };
    const centerResult = sampleGraphwarPathTargetSequence({
      bounds: area.bounds,
      boundsRect: area.boundsRect,
      points: [start, center],
      settings,
      targetCircles: [target.hitCircle],
      targetHitRadiusPixels: closeSoldier.hitRadius,
      targetPoints: [center],
    });
    const edgeResult = sampleGraphwarPathTargetSequence({
      bounds: area.bounds,
      boundsRect: area.boundsRect,
      points: [start, target.fallbackTargetPoint],
      settings,
      targetCircles: [target.hitCircle],
      targetHitRadiusPixels: closeSoldier.hitRadius,
      targetPoints: [target.fallbackTargetPoint],
    });

    expect(centerResult.reachesTargetSequenceBeforeObstacle).toBe(false);
    expect(edgeResult.reachesTargetSequenceBeforeObstacle).toBe(true);
  });

  it("clamps boundary soldiers to native cell centers at fractional screenshot scales", () => {
    for (const scale of [0.5, 1, 2]) {
      const scaledArea: GraphwarTargetingArea = {
        bounds: area.bounds,
        boundsRect: { height: 450 * scale, width: 770 * scale, x: 10.25, y: 20.75 },
        targetBoundsRect: { height: 450 * scale, width: 770 * scale, x: 10.25, y: 20.75 },
      };
      const edgeSoldier: GraphwarTargetingSoldier = {
        hitRadius: 7,
        sourceCenterX: scaledArea.targetBoundsRect.x + scaledArea.targetBoundsRect.width,
        sourceCenterY: scaledArea.targetBoundsRect.y + scaledArea.targetBoundsRect.height,
      };
      const target = createSmartPathfindingSoldierTarget(
        createPixelPoint(scaledArea.targetBoundsRect.x, edgeSoldier.sourceCenterY),
        edgeSoldier,
        scaledArea,
      );

      expect(target?.targetPoint).toEqual(
        createPixelPoint(edgeSoldier.sourceCenterX - scale / 2, edgeSoldier.sourceCenterY - scale / 2),
      );
    }
  });
});

describe("manual target forward semantics", () => {
  it("keeps a strict subpixel x+ click instead of quantizing it to a native column", () => {
    const point = createPixelPoint(100.25, 120);

    expect(createMinimumForwardTargetPoint(point, area, createPixelPoint(100, 200))).toBe(point);
  });

  it("repairs equal and backward clicks to the next native column with one real pixel of clearance", () => {
    const start = createPixelPoint(100.25, 200);

    expect(createMinimumForwardTargetPoint(createPixelPoint(100.25, 120), area, start)).toEqual(
      createPixelPoint(102, 120),
    );
    expect(createMinimumForwardTargetPoint(createPixelPoint(90, 120), area, start)).toEqual(createPixelPoint(102, 120));
  });

  it("uses the unshifted path-tail x only for the clickable-area preview", () => {
    const start = createPixelPoint(100.25, 200);

    expect(createAllowedTargetRect(area, start)).toEqual({ height: 450, width: 669.75, x: 100.25, y: 0 });
  });

  it("preserves mirrored subpixel clicks and repairs non-forward clicks toward screen left", () => {
    const mirroredArea = { ...area, bounds: { ...area.bounds, maxX: -25, minX: 25 } };
    const start = createPixelPoint(100.25, 200);
    const forwardPoint = createPixelPoint(100, 120);

    expect(createMinimumForwardTargetPoint(forwardPoint, mirroredArea, start)).toBe(forwardPoint);
    expect(createMinimumForwardTargetPoint(createPixelPoint(101, 120), mirroredArea, start)).toEqual(
      createPixelPoint(99, 120),
    );
  });
});
