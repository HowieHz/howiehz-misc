import { describe, expect, it } from "vitest";

import {
  forwardColumnToPlaneColumn,
  imageXToNearestPlaneColumn,
  imageXToPlaneX,
  imagePointToPlaneGridPoint,
  planeColumnToForwardColumn,
  planeGridPointDistance,
  planeGridPointFromIndex,
  planeGridPointsEqual,
  planeGridPointToIndex,
  planePointIsInsideBoundaryExpansion,
  planePointIsInsideBounds,
  planeXToForwardX,
  planeXToImageX,
} from "./plane-grid";
import { createPixelPoint } from "./types";

describe("Graphwar plane grid", () => {
  it("clamps projected screenshot points to native mask cells", () => {
    const bounds = { height: 900, width: 1540, x: 10, y: 20 };

    expect(imagePointToPlaneGridPoint(createPixelPoint(-100, -100), bounds)).toEqual({ x: 0, y: 0 });
    expect(imagePointToPlaneGridPoint(createPixelPoint(2000, 2000), bounds)).toEqual({ x: 769, y: 449 });
    expect(imagePointToPlaneGridPoint(createPixelPoint(12, 22), bounds)).toEqual({ x: 1, y: 1 });
  });

  it("shares stable mask indexing and geometry across routing modules", () => {
    const point = { x: 123, y: 45 };

    expect(planeGridPointFromIndex(planeGridPointToIndex(point))).toEqual(point);
    expect(planeGridPointsEqual(point, { ...point })).toBe(true);
    expect(planeGridPointDistance(point, { x: 126, y: 49 })).toBe(5);
  });

  it("uses half-open native and boundary-expanded plane ranges", () => {
    expect(planePointIsInsideBounds(0, 0)).toBe(true);
    expect(planePointIsInsideBounds(770, 449)).toBe(false);
    expect(planePointIsInsideBoundaryExpansion(2, 2, 2)).toBe(true);
    expect(planePointIsInsideBoundaryExpansion(1, 2, 2)).toBe(false);
    expect(planePointIsInsideBoundaryExpansion(768, 447, 2)).toBe(false);
  });

  it.each([0.5, 1, 2])("round-trips continuous native x at %sx screenshot scale", (scale) => {
    const rect = { height: 450 * scale, width: 770 * scale, x: 10.25, y: 20.75 };
    const imageX = planeXToImageX(419.25, rect);

    expect(imageXToPlaneX(imageX, rect)).toBeCloseTo(419.25, 12);
    expect(planeXToForwardX(419.25, false)).toBe(419.25);
    expect(planeXToForwardX(419.25, true)).toBe(349.75);
  });

  it("chooses x+ on exact nearest-column ties and mirrors column identities", () => {
    const rect = { height: 450, width: 770, x: 0, y: 0 };

    expect(imageXToNearestPlaneColumn(10.5, rect, false)).toBe(11);
    expect(imageXToNearestPlaneColumn(10.5, rect, true)).toBe(10);
    expect(planeColumnToForwardColumn(10, true)).toBe(759);
    expect(forwardColumnToPlaneColumn(759, true)).toBe(10);
  });

  it("absorbs translated screenshot round-trip residue at integer and half columns", () => {
    const rect = { height: 225, width: 385, x: 814.6, y: 20.75 };

    expect(imageXToPlaneX(planeXToImageX(419, rect), rect)).toBe(419);
    expect(imageXToNearestPlaneColumn(planeXToImageX(419.5, rect), rect, false)).toBe(420);
    expect(imageXToNearestPlaneColumn(planeXToImageX(419.5, rect), rect, true)).toBe(419);
  });

  it("rejects non-finite coordinates and invalid integer columns", () => {
    const rect = { height: 450, width: 770, x: 0, y: 0 };

    expect(() => imageXToPlaneX(Number.NaN, rect)).toThrow(RangeError);
    expect(() => planeColumnToForwardColumn(1.5, false)).toThrow(RangeError);
    expect(() => forwardColumnToPlaneColumn(770, false)).toThrow(RangeError);
  });
});
