import { describe, expect, it } from "vitest";

import { createPixelPoint } from "../../core/types";
import { createGraphwarOneClickClearSearchInput } from "../one-click-clear/input";
import { createGraphwarPathfindingCacheController } from "./cache";

describe("Graphwar pathfinding result cache keys", () => {
  it("separates one-click-clear inputs with different current path prefixes", () => {
    const cache = createGraphwarPathfindingCacheController();

    const firstKey = cache.createOneClickClearResultCacheKey(createInput({ middleX: 20 }));
    const secondKey = cache.createOneClickClearResultCacheKey(createInput({ middleX: 21 }));

    expect(firstKey).not.toBe(secondKey);
  });

  it("keeps ordinary route mode and deletion preference as independent result identities", () => {
    const cache = createGraphwarPathfindingCacheController();
    const keys = (["visibility-graph", "theta-star"] as const).flatMap((routeMode) =>
      [false, true].map((deleteOptimizationEnabled) =>
        cache.createOneClickClearResultCacheKey(createInput({ deleteOptimizationEnabled, routeMode })),
      ),
    );

    expect(new Set(keys).size).toBe(4);
  });

  it("canonicalises the unused ordinary route mode for Step y' glitch inputs", () => {
    const cache = createGraphwarPathfindingCacheController();

    const visibilityKey = cache.createOneClickClearResultCacheKey(
      createInput({ routeMode: "visibility-graph", stepGlitchMode: true }),
    );
    const thetaKey = cache.createOneClickClearResultCacheKey(
      createInput({ routeMode: "theta-star", stepGlitchMode: true }),
    );

    expect(visibilityKey).toBe(thetaKey);
  });

  it("separates Step glitch fallback masks when no simulation mask is available", () => {
    const cache = createGraphwarPathfindingCacheController();
    const first = createInput({ stepGlitchMode: true });
    const second = createInput({ stepGlitchMode: true });
    first.simulationMask = undefined;
    first.simulationMaskCacheId = 0;
    first.settings = { ...first.settings, stepGlitchObstacleMask: new Uint8Array(1) };
    second.simulationMask = undefined;
    second.simulationMaskCacheId = 0;
    second.settings = { ...second.settings, stepGlitchObstacleMask: new Uint8Array(1) };

    expect(cache.createOneClickClearResultCacheKey(first)).not.toBe(cache.createOneClickClearResultCacheKey(second));
  });

  it("preserves the validated formula when caching a one-click-clear success", () => {
    const cache = createGraphwarPathfindingCacheController();
    const result = {
      result: {
        elapsedMs: 12,
        expression: "x",
        expandedStates: 34,
        launchAngleRadians: Math.PI / 4,
        pathPoints: [createPixelPoint(10, 20), createPixelPoint(30, 40)],
        targetIds: ["target"],
        type: "success" as const,
      },
      timings: [],
    };

    cache.cacheOneClickClearResult("success", result);
    const cached = cache.getCachedOneClickClearResult("success");

    expect(cached).toEqual(result);
    expect(cached?.result).not.toBe(result.result);
    if (cached?.result.type === "success") {
      expect(cached.result.pathPoints).not.toBe(result.result.pathPoints);
    }
  });
});

function createInput(
  options: {
    deleteOptimizationEnabled?: boolean;
    middleX?: number;
    routeMode?: "theta-star" | "visibility-graph";
    stepGlitchMode?: boolean;
  } = {},
) {
  const mask = new Uint8Array(1);
  const start = createPixelPoint(10, 20);
  const hitCircle = { center: createPixelPoint(22, 20), radius: 8 };
  return createGraphwarOneClickClearSearchInput({
    bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
    boundsRect: { height: 450, width: 770, x: 0, y: 0 },
    candidates: [],
    dagEdgeWorkerCount: 1,
    deleteOptimizationEnabled: options.deleteOptimizationEnabled ?? false,
    hitCandidates: [],
    pathPoints: [start, createPixelPoint(options.middleX ?? 20, 20), createPixelPoint(24, 20)],
    prefixTarget: hitCircle,
    routeMaskCacheId: 1,
    routeMode: options.routeMode ?? "visibility-graph",
    routeObstacleMask: mask,
    settings: {
      algorithm: options.stepGlitchMode ? "step" : "abs",
      decimalPlaces: 4,
      equation: options.stepGlitchMode ? "dy" : "y",
      steepness: 67,
      stepGlitchMode: options.stepGlitchMode ?? false,
      stepOverflowProtection: true,
    },
    simulationMask: mask,
    simulationMaskCacheId: 1,
    tolerances: {
      oneClickClearDeleteCheckRadiusPlanePixels: 3,
      routeBoundaryInsetPlanePixels: 0,
      routePlanningTolerancePlanePixels: 2,
      simulationBoundaryInsetPlanePixels: 0,
    },
  });
}
