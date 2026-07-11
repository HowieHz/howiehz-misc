import { describe, expect, it } from "vitest";

import { createPixelPoint } from "../../../core/types";
import type { GraphwarOneClickClearTargetSoldier } from "../../../pathfinding/one-click-clear/targets";
import { useGraphwarOneClickClearRunWorkflow } from "./workflow";

describe("one-click clear workflow", () => {
  it("submits a managed success before publishing final page effects", async () => {
    const start = createPixelPoint(10, 20);
    const target = createPixelPoint(30, 40);
    const order: string[] = [];
    let now = 0;
    const workflow = useGraphwarOneClickClearRunWorkflow<GraphwarOneClickClearTargetSoldier>({
      debug: {
        appendSearchWorkerTimings: () => undefined,
        clearTimings: () => undefined,
        finishTimings: () => undefined,
        measureStage: (_timings, _stage, task) => task(),
        measureStageAsync: (_timings, _stage, task) => task(),
      },
      effects: {
        applyValidatedPath: () => order.push("apply"),
        flashBlockedSegment: () => undefined,
        flashHitSoldiers: () => order.push("flash"),
        setStatus: () => order.push("status"),
      },
      input: {
        boundsRect: { value: { height: 450, width: 770, x: 0, y: 0 } },
        getBounds: () => ({ maxX: 25, maxY: 15, minX: -25, minY: -15 }),
        getCommittedTargets: () => [],
        getFormulaSettings: () => ({
          algorithm: "step",
          decimalPlaces: 4,
          equation: "y",
          steepness: 67,
          stepGlitchMode: false,
          stepOverflowProtection: true,
        }),
        getObstacleMask: () => new Uint8Array(770 * 450),
        getPathPoints: () => [start],
        getPathfindingWorkerCount: () => 1,
        getRouteMode: () => "visibility-graph",
        getSimulationMask: () => undefined,
        getTolerances: () => ({
          oneClickClearDeleteCheckRadiusPlanePixels: 0,
          routeBoundaryInsetPlanePixels: 0,
          routePlanningTolerancePlanePixels: 0,
          simulationBoundaryInsetPlanePixels: 0,
        }),
        isUnsupportedMode: () => false,
      },
      messages: {
        getFailureMessage: () => "failure",
        getInProgressMessage: () => "running",
        getPreflightFailureStatus: () => ({ kind: "error", message: "preflight failure" }),
        getSuccessMessage: () => "success",
      },
      pathfinding: {
        cache: {
          cacheOneClickClearResult: () => undefined,
          createOneClickClearResultCacheKey: () => "cache-key",
          getCachedOneClickClearResult: () => undefined,
          getMaskCacheId: () => 1,
        },
        runner: {
          buildOneClickClearPath: async () => ({
            result: {
              elapsedMs: 10,
              expandedStates: 1,
              pathPoints: [start, target],
              targetIds: ["target"],
              targetSequence: [],
              type: "success",
            },
            timings: [],
          }),
        },
      },
      run: {
        finish: () => {
          order.push("finish");
          return true;
        },
        isCurrent: () => true,
        start: () => 1,
      },
      targets: {
        createGeometry: () => undefined,
        getFriendlyFireEnabled: () => false,
        getPrefixTarget: () => undefined,
        getSoldiers: () => [],
        isFriendlySoldier: () => undefined,
      },
      time: { now: () => ++now },
    });

    await expect(
      workflow.run({
        onSuccessBeforeEffects: () => order.push("submit"),
        useResultCache: false,
      }),
    ).resolves.toBe(true);

    expect(order.slice(0, 5)).toEqual(["submit", "finish", "apply", "flash", "status"]);
  });
});
