import { describe, expect, it } from "vitest";

import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { createPixelPoint } from "../../core/types";
import type { GraphwarDetectionBox } from "../../detection/objects";
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

  it("ignores the dormant glitch preference and mask for ABS ODE inputs", () => {
    const cache = createGraphwarPathfindingCacheController();
    const enabled = createInput();
    const disabled = createInput();
    enabled.settings = {
      ...enabled.settings,
      algorithm: "abs",
      equation: "dy",
      stepGlitchMode: true,
      stepGlitchObstacleMask: new Uint8Array(1),
    };
    disabled.settings = {
      ...disabled.settings,
      algorithm: "abs",
      equation: "dy",
      stepGlitchMode: false,
      stepGlitchObstacleMask: new Uint8Array(1),
    };

    expect(cache.createOneClickClearResultCacheKey(enabled)).toBe(cache.createOneClickClearResultCacheKey(disabled));
  });

  it("separates full-precision and display-rounded Y'' execution modes", () => {
    const cache = createGraphwarPathfindingCacheController();
    const implicitFullPrecision = createInput();
    const fullPrecision = createInput();
    const displayRounded = createInput();
    implicitFullPrecision.settings = {
      ...implicitFullPrecision.settings,
      algorithm: "abs",
      equation: "ddy",
    };
    fullPrecision.settings = {
      ...fullPrecision.settings,
      algorithm: "abs",
      equation: "ddy",
      secondOrderLaunchAngleMode: "full-precision",
    };
    displayRounded.settings = {
      ...displayRounded.settings,
      algorithm: "abs",
      equation: "ddy",
      secondOrderLaunchAngleMode: "display-rounded",
    };

    expect(cache.createOneClickClearResultCacheKey(implicitFullPrecision)).toBe(
      cache.createOneClickClearResultCacheKey(fullPrecision),
    );
    expect(cache.createOneClickClearResultCacheKey(fullPrecision)).not.toBe(
      cache.createOneClickClearResultCacheKey(displayRounded),
    );
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

  it("fills exactly the friendly-mask cells intersecting the soldier hit circle", () => {
    const cache = createGraphwarPathfindingCacheController();
    const mask = cache.getCachedFriendlyObstacleMask(
      new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT),
      { height: GRAPHWAR_PLANE_HEIGHT, width: GRAPHWAR_PLANE_LENGTH, x: 0, y: 0 },
      [
        {
          confidence: 1,
          height: 14,
          hitRadius: 7,
          id: "friendly",
          kind: "soldier",
          mirrored: false,
          selectionRadius: 7,
          sourceCenterX: 325,
          sourceCenterY: 341,
          templateName: "soldier1.png",
          visualCenterX: 325,
          visualCenterY: 341,
          visualRadius: 7,
          width: 14,
          x: 318,
          y: 334,
        } satisfies GraphwarDetectionBox,
      ],
      7,
    );

    for (let y = 332; y <= 349; y += 1) {
      const nearestY = Math.max(y, Math.min(341, y + 1));
      for (let x = 316; x <= 333; x += 1) {
        const nearestX = Math.max(x, Math.min(325, x + 1));
        const intersects = (nearestX - 325) ** 2 + (nearestY - 341) ** 2 <= 7 ** 2;
        expect(mask[y * GRAPHWAR_PLANE_LENGTH + x], `cell (${x}, ${y})`).toBe(Number(intersects));
      }
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
