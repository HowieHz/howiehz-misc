import { describe, expect, it, vi } from "vitest";

import { createPixelPoint } from "../../../core/types";
import type { GraphwarPathfindingPreview } from "../../../pathfinding/routing/visibility-graph";
import type {
  GraphwarSmartPathfindingPathInput,
  GraphwarSmartPathfindingPathResult,
} from "../../../pathfinding/runtime/protocol";
import type { GraphwarPathfindingRunOptions } from "../../../pathfinding/runtime/runner";
import type { GraphwarPathfindingPreviewSnapshot } from "../../../pathfinding/smart/preview";
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

    expect(result).toEqual({ hasResultCacheHit: false, path: [startPoint, edgePoint], type: "success" });
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

  it("ignores a preview that arrives after search animation is disabled", async () => {
    let animationEnabled = true;
    const setSearch = vi.fn();
    const findSmartPath = vi.fn(
      async (_input: GraphwarSmartPathfindingPathInput, options?: GraphwarPathfindingRunOptions) => {
        animationEnabled = false;
        options?.onPreview?.(createPreview());
        return { path: [startPoint, centerPoint], timings: [] };
      },
    );
    const builder = createBuilder(findSmartPath, {
      isSearchAnimationEnabled: () => animationEnabled,
      setSearch,
    });

    await builder.buildPath(centerPoint, 1);

    expect(setSearch).not.toHaveBeenCalled();
  });

  it("keeps debug runs on the normal result-cache path and bypasses reads and writes only when disabled", async () => {
    const cachedResult = { path: [startPoint, centerPoint], timings: [] };
    const findSmartPath = vi.fn(async () => cachedResult);
    const getCachedResult = vi.fn(() => cachedResult);
    const cacheResult = vi.fn();
    const attempts: { source: string }[] = [];
    const cachedBuilder = createBuilder(
      findSmartPath,
      {},
      {
        cacheResult,
        getCachedResult,
        recordAttempt: (attempt) => attempts.push(attempt),
      },
    );

    await expect(cachedBuilder.buildPath(centerPoint, 1, [])).resolves.toMatchObject({
      hasResultCacheHit: true,
      type: "success",
    });
    expect(findSmartPath).not.toHaveBeenCalled();
    expect(cacheResult).not.toHaveBeenCalled();
    expect(attempts).toMatchObject([{ source: "result-cache" }]);

    const uncachedBuilder = createBuilder(
      findSmartPath,
      {},
      {
        cacheResult,
        getCachedResult,
        isResultCacheEnabled: false,
      },
    );
    await expect(uncachedBuilder.buildPath(centerPoint, 1, [])).resolves.toMatchObject({
      hasResultCacheHit: false,
      type: "success",
    });
    expect(getCachedResult).toHaveBeenCalledTimes(1);
    expect(findSmartPath).toHaveBeenCalledOnce();
    expect(findSmartPath).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ shouldCollectDiagnostics: true }),
    );
    expect(cacheResult).not.toHaveBeenCalled();
  });

  it("freezes the result-cache preference before yielding for the connection preview", async () => {
    const cachedResult = { path: [startPoint, centerPoint], timings: [] };
    const findSmartPath = vi.fn(async () => cachedResult);
    const attempts: { source: string }[] = [];
    const controls = {
      getCachedResult: vi.fn(() => cachedResult),
      isResultCacheEnabled: true,
      recordAttempt: (attempt: { source: string }) => attempts.push(attempt),
    };
    const builder = createBuilder(findSmartPath, {}, controls);

    const task = builder.buildPath(centerPoint, 1, []);
    controls.isResultCacheEnabled = false;

    await expect(task).resolves.toMatchObject({ hasResultCacheHit: true, type: "success" });
    expect(controls.getCachedResult).toHaveBeenCalledOnce();
    expect(findSmartPath).not.toHaveBeenCalled();
    expect(attempts).toMatchObject([{ source: "result-cache" }]);
  });
});

function createBuilder(
  findSmartPath: (
    input: GraphwarSmartPathfindingPathInput,
    options?: GraphwarPathfindingRunOptions,
  ) => Promise<GraphwarSmartPathfindingPathResult>,
  preview: {
    isSearchAnimationEnabled?: () => boolean;
    setSearch?: (snapshot: GraphwarPathfindingPreviewSnapshot) => void;
  } = {},
  controls: {
    cacheResult?: () => void;
    getCachedResult?: () => GraphwarSmartPathfindingPathResult | undefined;
    isResultCacheEnabled?: boolean;
    recordAttempt?: (attempt: { source: string }) => void;
  } = {},
) {
  return useGraphwarSmartPathfindingBuilder({
    debug: {
      addWorkerTimings: () => undefined,
      recordAttempt: controls.recordAttempt ?? (() => undefined),
    },
    effects: {
      flashBlockedPoint: () => undefined,
      flashBlockedSegment: () => undefined,
    },
    input: {
      boundsRect: { value: { height: 450, width: 770, x: 0, y: 0 } },
      getBounds: () => ({ maxX: 25, maxY: 15, minX: -25, minY: -15 }),
      getDeleteOptimizationEnabled: () => false,
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
      getPrefixTarget: () => undefined,
      getRouteMode: () => "visibility-graph",
      getSimulationMask: () => undefined,
      getTargetHitRadiusPixels: () => 1,
      getTolerances: () => ({
        routeBoundaryInsetPlanePixels: 0,
        routePlanningTolerancePlanePixels: 2,
        simulationBoundaryInsetPlanePixels: 0,
      }),
    },
    pathfinding: {
      cache: {
        cacheSmartPathfindingResult: controls.cacheResult ?? (() => undefined),
        createSmartPathfindingResultCacheKey: (input) => String(input.targetPoint.x),
        getCachedSmartPathfindingResult: controls.getCachedResult ?? (() => undefined),
        getMaskCacheId: () => 1,
      },
      isResultCacheEnabled: () => controls.isResultCacheEnabled ?? true,
      runner: { findSmartPath },
    },
    preview: {
      isSearchAnimationEnabled: preview.isSearchAnimationEnabled ?? (() => false),
      setConnection: () => undefined,
      setPath: () => undefined,
      setSearch: preview.setSearch ?? (() => undefined),
    },
    run: {
      enterSearchPhase: () => undefined,
      isCurrent: () => true,
    },
  });
}

/** Builds the smallest valid Worker preview for late-frame preference tests. */
function createPreview(): GraphwarPathfindingPreview {
  return {
    acceptedEdges: [],
    bestPath: [],
    candidates: [],
    mirrored: false,
  };
}
