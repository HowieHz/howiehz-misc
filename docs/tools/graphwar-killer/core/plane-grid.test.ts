import { describe, expect, it } from "vitest";

import {
  imagePointToPlaneGridPoint,
  planeGridPointDistance,
  planeGridPointFromIndex,
  planeGridPointsEqual,
  planeGridPointToIndex,
  planePointIsInsideBoundaryExpansion,
  planePointIsInsideBounds,
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
});
