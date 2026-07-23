import { describe, expect, it } from "vitest";

import { createPixelPoint } from "../../core/types";
import { getGraphwarVisibleTrajectoryPointCount, snapshotGraphwarVisibleTrajectoryPoints } from "./visible-points";

describe("Graphwar visible trajectory points", () => {
  it("keeps the complete trajectory when no obstacle was hit", () => {
    const points = [createPixelPoint(1, 1), createPixelPoint(2, 2)];

    expect(getGraphwarVisibleTrajectoryPointCount(points, -1)).toBe(2);
    expect(snapshotGraphwarVisibleTrajectoryPoints(points, -1)).toEqual(points);
  });

  it("excludes the obstacle collision sample from an independent snapshot", () => {
    const points = [createPixelPoint(1, 1), createPixelPoint(2, 2), createPixelPoint(3, 3)];
    const snapshot = snapshotGraphwarVisibleTrajectoryPoints(points, 2);

    expect(snapshot).toEqual(points.slice(0, 2));
    expect(snapshot).not.toBe(points);
  });
});
