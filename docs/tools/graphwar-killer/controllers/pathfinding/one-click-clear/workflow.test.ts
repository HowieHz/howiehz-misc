import { describe, expect, it } from "vitest";

import { createPixelPoint } from "../../../core/types";
import type { GraphwarOneClickClearTargetSoldier } from "../../../pathfinding/one-click-clear/targets";
import type { GraphwarOneClickClearPathWorkerResult } from "../../../pathfinding/runtime/protocol";
import { useGraphwarOneClickClearRunWorkflow } from "./workflow";

describe("one-click clear workflow", () => {
  it("submits a managed success before publishing final page effects", async () => {
    const start = createPixelPoint(10, 20);
    const target = createPixelPoint(30, 40);
    const order: string[] = [];
    let now = 0;
    let current = true;
    let runnerMode: "error" | "failure" | "pending" | "success" = "success";
    let resolvePending: ((result: GraphwarOneClickClearPathWorkerResult) => void) | undefined;
    const workflow = useGraphwarOneClickClearRunWorkflow<GraphwarOneClickClearTargetSoldier>({
      debug: {
        appendSearchWorkerTimings: () => undefined,
        clearTimings: () => undefined,
        finishTimings: () => undefined,
        measureStage: (_timings, _stage, task) => task(),
        measureStageAsync: (_timings, _stage, task) => task(),
      },
      effects: {
        applyIncumbent: () => order.push("apply-incumbent"),
        applyValidatedPath: () => order.push("apply"),
        flashBlockedSegment: () => undefined,
        flashHitSoldiers: () => order.push("flash"),
        setStatus: () => order.push("status"),
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
        getPathPoints: () => [start],
        getPathfindingWorkerCount: () => 1,
        getRouteMode: () => "visibility-graph",
        requiresDagWorker: () => true,
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
        getRetainedMessage: () => "retained",
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
          buildOneClickClearPath: async (_input, runnerOptions) => {
            if (runnerMode !== "success") {
              runnerOptions?.onIncumbent?.({ expression: "x", pathPoints: [start, target] });
              if (runnerMode === "error") {
                throw new Error("worker failed after incumbent");
              }
              if (runnerMode === "pending") {
                return new Promise((resolve) => {
                  resolvePending = resolve;
                });
              }
              return {
                result: { elapsedMs: 10, expandedStates: 1, reason: "no-usable-target", type: "failure" },
                timings: [],
              };
            }
            return {
              result: {
                elapsedMs: 10,
                expandedStates: 1,
                pathPoints: [start, target],
                targetIds: ["target"],
                type: "success",
              },
              timings: [],
            };
          },
        },
      },
      run: {
        finish: () => {
          order.push("finish");
          return true;
        },
        isCurrent: () => current,
        start: () => {
          current = true;
          return 1;
        },
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

    order.length = 0;
    runnerMode = "failure";
    await expect(workflow.run({ useResultCache: false })).resolves.toBe(true);
    expect(order).toContain("apply-incumbent");
    expect(order).not.toContain("apply");
    expect(order).not.toContain("flash");

    order.length = 0;
    runnerMode = "error";
    await expect(workflow.run({ useResultCache: false })).resolves.toBe(true);
    expect(order).toContain("apply-incumbent");
    expect(order).not.toContain("apply");

    order.length = 0;
    runnerMode = "pending";
    const pendingRun = workflow.run({ useResultCache: false });
    await Promise.resolve();
    expect(workflow.finalizeActiveIncumbent()).toBe(true);
    expect(order).toEqual(["apply-incumbent", "status"]);
    current = false;
    resolvePending?.({
      result: { elapsedMs: 10, expandedStates: 1, reason: "no-usable-target", type: "failure" },
      timings: [],
    });
    await expect(pendingRun).resolves.toBe(false);
  });
});
