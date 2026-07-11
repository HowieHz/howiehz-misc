import { describe, expect, it } from "vitest";

import { createPixelPoint } from "../../core/types";
import { createGraphwarOneClickClearSearchInput } from "../one-click-clear/input";
import { createGraphwarPathfindingCacheController } from "./cache";

describe("Graphwar pathfinding result cache keys", () => {
  it("separates one-click-clear inputs with different committed target anchors", () => {
    const cache = createGraphwarPathfindingCacheController();
    const firstAnchor = createPixelPoint(20, 20);
    const secondAnchor = createPixelPoint(24, 20);

    const firstKey = cache.createOneClickClearResultCacheKey(createInput(firstAnchor));
    const secondKey = cache.createOneClickClearResultCacheKey(createInput(secondAnchor));

    expect(firstKey).not.toBe(secondKey);
  });
});

function createInput(anchor: ReturnType<typeof createPixelPoint>) {
  const mask = new Uint8Array(1);
  const start = createPixelPoint(10, 20);
  const hitCircle = { center: createPixelPoint(22, 20), radius: 8 };
  return createGraphwarOneClickClearSearchInput({
    bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
    boundsRect: { height: 450, width: 770, x: 0, y: 0 },
    candidates: [],
    committedTargets: [{ anchor, hitCircle }],
    dagEdgeWorkerCount: 1,
    hitCandidates: [],
    pathPoints: [start, createPixelPoint(20, 20), createPixelPoint(24, 20)],
    prefixTarget: hitCircle,
    routeMaskCacheId: 1,
    routeMode: "visibility-graph",
    routeObstacleMask: mask,
    settings: {
      algorithm: "abs",
      decimalPlaces: 4,
      equation: "y",
      steepness: 67,
      stepGlitchMode: false,
      stepOverflowProtection: true,
    },
    simulationMask: mask,
    simulationMaskCacheId: 1,
    tolerances: {
      oneClickClearDeleteCheckRadiusPlanePixels: 0,
      routeBoundaryInsetPlanePixels: 0,
      routePlanningTolerancePlanePixels: 2,
      simulationBoundaryInsetPlanePixels: 0,
    },
  });
}
