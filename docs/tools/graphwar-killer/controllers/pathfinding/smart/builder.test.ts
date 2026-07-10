import { describe, expect, it, vi } from "vitest";

import { createPixelPoint } from "../../../core/types";
import type {
  GraphwarSmartPathfindingPathInput,
  GraphwarSmartPathfindingPathResult,
} from "../../../pathfinding/runtime/protocol";
import { useGraphwarSmartPathfindingBuilder } from "./builder";

const startPoint = createPixelPoint(32, 100);
const centerPoint = createPixelPoint(38, 100);
const edgePoint = createPixelPoint(44, 100);

describe("Step single-target fallback", () => {
  it("retries the hit-circle x+ edge after the center has no usable path", async () => {
    const requests: GraphwarSmartPathfindingPathInput[] = [];
    const findSmartPath = vi.fn(async (input: GraphwarSmartPathfindingPathInput) => {
      requests.push(input);
      return input.targetPoint === centerPoint
        ? { failureReason: "trajectory" as const, timings: [] }
        : { path: [startPoint, edgePoint], timings: [] };
    });
    const builder = createBuilder(findSmartPath);

    const result = await builder.buildPath(
      {
        fallbackTargetPoint: edgePoint,
        hitCircle: { center: centerPoint, radius: 7 },
        targetPoint: centerPoint,
      },
      1,
    );

    expect(result).toEqual({ cacheHit: false, path: [startPoint, edgePoint], type: "success" });
    expect(requests.map((request) => request.targetPoint)).toEqual([centerPoint, edgePoint]);
    expect(requests.every((request) => request.hitTarget.center === centerPoint)).toBe(true);
  });

  it("does not retry a target-independent invalid prefix segment", async () => {
    const findSmartPath = vi.fn(async () => ({ invalidSegmentIndex: 0, timings: [] }));
    const builder = createBuilder(findSmartPath);

    await builder.buildPath(
      {
        fallbackTargetPoint: edgePoint,
        hitCircle: { center: centerPoint, radius: 7 },
        targetPoint: centerPoint,
      },
      1,
    );

    expect(findSmartPath).toHaveBeenCalledTimes(1);
  });
});

function createBuilder(
  findSmartPath: (input: GraphwarSmartPathfindingPathInput) => Promise<GraphwarSmartPathfindingPathResult>,
) {
  return useGraphwarSmartPathfindingBuilder({
    debug: { addWorkerTimings: () => undefined },
    effects: {
      flashBlockedPoint: () => undefined,
      flashBlockedSegment: () => undefined,
    },
    input: {
      boundsRect: { value: { height: 450, width: 770, x: 0, y: 0 } },
      getBounds: () => ({ maxX: 25, maxY: 15, minX: -25, minY: -15 }),
      getFormulaSettings: () => ({
        algorithm: "step",
        decimalPlaces: 4,
        equation: "y",
        steepness: 67,
        stepGlitchMode: false,
        stepOverflowProtection: true,
      }),
      getObstacleMask: () => new Uint8Array(770 * 450),
      getPathPixels: () => [startPoint],
      getRouteMode: () => "visibility-graph",
      getSimulationMask: () => undefined,
      getTargetHitRadiusPixels: () => 1,
      getTolerances: () => ({
        routeBoundaryInsetPlanePixels: 0,
        routePlanningTolerancePlanePixels: 2,
        simulationBoundaryInsetPlanePixels: 0,
      }),
      isPathfindingWorkerCountValid: () => true,
    },
    pathfinding: {
      cache: {
        cacheSmartPathfindingResult: () => undefined,
        createSmartPathfindingResultCacheKey: (input) => String(input.targetPoint.x),
        getCachedSmartPathfindingResult: () => undefined,
        getRouteObstacleMaskCacheId: () => 1,
      },
      runner: { findSmartPath },
    },
    preview: {
      isSearchAnimationEnabled: () => false,
      setConnection: () => undefined,
      setPath: () => undefined,
      setSearch: () => undefined,
    },
    run: {
      enterSearchPhase: () => undefined,
      isCurrent: () => true,
    },
  });
}
