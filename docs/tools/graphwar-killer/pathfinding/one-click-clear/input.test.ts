import { describe, expect, it } from "vitest";

import { createPixelPoint } from "../../core/types";
import { createGraphwarOneClickClearSearchInput, createGraphwarOneClickClearSearchPreflight } from "./input";

describe("one-click-clear input semantics", () => {
  it("requires a worker count only when the selected algorithm builds a DAG", () => {
    expect(createPreflight(true)).toEqual({ ok: false, reason: "invalid-settings" });
    expect(createPreflight(false)).toMatchObject({ dagEdgeWorkerCount: 1, ok: true });
  });

  it("canonicalises deletion radius and ordinary routing for Step y' glitch", () => {
    const input = createInput(false, "theta-star");

    expect(input.deleteHitCheckRadiusPixels).toBe(0);
    expect(input.routeMode).toBe("visibility-graph");
    expect(input.settings.stepGlitchObstacleMask).toBe(input.simulationMask);
  });

  it("retains the deletion radius only while deletion optimisation is enabled", () => {
    expect(createInput(true, "visibility-graph").deleteHitCheckRadiusPixels).toBe(3);
  });
});

/** Builds the minimal preflight needed to isolate the conditional DAG worker rule. */
function createPreflight(shouldUseDagWorker: boolean) {
  return createGraphwarOneClickClearSearchPreflight({
    bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
    createPrefixTarget: () => undefined,
    getObstacleMask: () => new Uint8Array(1),
    pathPointCount: 1,
    pathfindingWorkerCount: undefined,
    shouldUseDagWorker,
    tolerances: {
      oneClickClearDeleteCheckRadiusPlanePixels: 0,
      routeBoundaryInsetPlanePixels: 0,
      routePlanningTolerancePlanePixels: 0,
      simulationBoundaryInsetPlanePixels: 0,
    },
    isModeSupported: () => true,
  });
}

/** Builds a Step y' glitch input whose dormant settings have deliberately non-canonical values. */
function createInput(isDeleteOptimizationEnabled: boolean, routeMode: "theta-star" | "visibility-graph") {
  const mask = new Uint8Array(1);
  const point = createPixelPoint(10, 10);
  return createGraphwarOneClickClearSearchInput({
    bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
    boundsRect: { height: 450, width: 770, x: 0, y: 0 },
    candidates: [],
    dagEdgeWorkerCount: 1,
    isDeleteOptimizationEnabled,
    hitCandidates: [],
    pathPoints: [point],
    prefixTarget: undefined,
    routeMaskCacheId: 1,
    routeMode,
    routeObstacleMask: mask,
    settings: {
      algorithm: "step",
      decimalPlaces: 4,
      equation: "dy",
      steepness: 67,
      stepGlitchMode: true,
      stepOverflowProtection: true,
    },
    simulationMask: mask,
    simulationMaskCacheId: 1,
    tolerances: {
      oneClickClearDeleteCheckRadiusPlanePixels: 3,
      routeBoundaryInsetPlanePixels: 0,
      routePlanningTolerancePlanePixels: 0,
      simulationBoundaryInsetPlanePixels: 0,
    },
  });
}
