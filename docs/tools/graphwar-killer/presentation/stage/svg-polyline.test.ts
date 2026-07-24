import { describe, expect, it } from "vitest";

import { createPixelPoint } from "../../core/types";
import { formatSvgPolylinePointRange, formatSvgPolylinePoints, formatVisibleTrajectoryPoints } from "./svg-polyline";

describe("SVG polyline formatting", () => {
  it("keeps complete and collision-truncated polylines invisible below two points", () => {
    const points = [createPixelPoint(1, 2), createPixelPoint(3, 4)];

    expect(formatSvgPolylinePoints(points.slice(0, 1))).toBe("");
    expect(formatVisibleTrajectoryPoints(points, 1)).toBe("");
    expect(formatVisibleTrajectoryPoints(points, -1)).toBe("1.00,2.00 3.00,4.00");
  });

  it("formats a one-point suffix for incremental playback appends", () => {
    expect(formatSvgPolylinePointRange([createPixelPoint(1, 2), createPixelPoint(3, 4)], 1, 2)).toBe("3.00,4.00");
  });
});
