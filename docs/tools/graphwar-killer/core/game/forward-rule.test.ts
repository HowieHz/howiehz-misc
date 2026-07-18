import { describe, expect, it } from "vitest";

import { createPixelPoint } from "../types";
import type { BoundsRect, GraphBounds } from "../types";
import {
  createNextNativePlaneColumnPointAtGraphY,
  normalizeAutomaticPathPointForMinimumForwardStep,
  normalizePathPointForStrictForward,
  normalizePathForStrictForward,
} from "./forward-rule";

const bounds: GraphBounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
const boundsRect: BoundsRect = { height: 450, width: 770, x: 0, y: 0 };

describe("Graphwar automatic forward columns", () => {
  it("moves integer, fractional, and near-integer starts by at least one native plane pixel", () => {
    expect(createNextNativePlaneColumnPointAtGraphY(createPixelPoint(419, 100), 0, bounds, boundsRect)?.x).toBe(420);
    expect(createNextNativePlaneColumnPointAtGraphY(createPixelPoint(419.25, 100), 0, bounds, boundsRect)?.x).toBe(421);
    expect(
      createNextNativePlaneColumnPointAtGraphY(createPixelPoint(419.00000000000006, 100), 0, bounds, boundsRect)?.x,
    ).toBe(420);
  });

  it.each([0.5, 1, 2])("keeps the native-column rule at %sx screenshot scale", (scale) => {
    const scaledRect = { height: 450 * scale, width: 770 * scale, x: 10.25, y: 20.75 };
    const start = createPixelPoint(scaledRect.x + 419.25 * scale, scaledRect.y + 100 * scale);

    expect(createNextNativePlaneColumnPointAtGraphY(start, 0, bounds, scaledRect)?.x).toBe(scaledRect.x + 421 * scale);
  });

  it("maps the next forward column toward screen left for mirrored bounds", () => {
    const mirroredBounds = { ...bounds, maxX: -25, minX: 25 };

    expect(
      createNextNativePlaneColumnPointAtGraphY(createPixelPoint(350.75, 100), 0, mirroredBounds, boundsRect)?.x,
    ).toBe(349);
  });

  it("does not skip a mirrored column after scaled projection with a large screenshot offset", () => {
    const mirroredBounds = { ...bounds, maxX: -25, minX: 25 };
    const translatedRect = { height: 225, width: 385, x: 814.6, y: 20.75 };
    const start = createPixelPoint(814.6 + (419 * 385) / 770, 100);

    expect(createNextNativePlaneColumnPointAtGraphY(start, 0, mirroredBounds, translatedRect)?.x).toBe(
      814.6 + (418 * 385) / 770,
    );
  });

  it("keeps valid manual points and repairs only invalid successors", () => {
    const validSubpixel = createPixelPoint(100.25, 120);
    const previous = createPixelPoint(100, 200);

    expect(normalizePathPointForStrictForward(validSubpixel, previous, bounds, boundsRect)).toEqual(validSubpixel);
    expect(normalizePathPointForStrictForward(createPixelPoint(100, 120), previous, bounds, boundsRect)).toEqual(
      createPixelPoint(101, 120),
    );
  });

  it("does not requantize an already valid hand-authored path prefix", () => {
    const path = [createPixelPoint(100, 200), createPixelPoint(100.25, 180), createPixelPoint(101.1, 160)];

    expect(normalizePathForStrictForward(path, bounds, boundsRect)).toEqual(path);
  });

  it("preserves a hand-authored prefix while giving new geometry points one real pixel of clearance", () => {
    const prefixTail = createPixelPoint(100.9, 200);
    const automaticPoint = normalizeAutomaticPathPointForMinimumForwardStep(
      createPixelPoint(101.5, 180),
      prefixTail,
      bounds,
      boundsRect,
    );
    const exactUserTarget = normalizePathPointForStrictForward(
      createPixelPoint(102.25, 160),
      automaticPoint,
      bounds,
      boundsRect,
    );

    expect(prefixTail.x).toBe(100.9);
    expect(automaticPoint.x).toBe(102);
    expect(exactUserTarget.x).toBe(102.25);
  });

  it("returns no automatic point after the final forward column", () => {
    expect(createNextNativePlaneColumnPointAtGraphY(createPixelPoint(769, 100), 0, bounds, boundsRect)).toBeUndefined();
  });
});
