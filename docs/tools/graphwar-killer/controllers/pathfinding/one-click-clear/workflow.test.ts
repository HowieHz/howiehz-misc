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
    const appliedExpressions: string[] = [];
    const candidateSoldiers: GraphwarOneClickClearTargetSoldier[] = [
      { hitRadius: 7, id: "target", sourceCenterX: 30, sourceCenterY: 40 },
      { hitRadius: 7, id: "target", sourceCenterX: 35, sourceCenterY: 45 },
      { hitRadius: 7, id: "missed", sourceCenterX: 50, sourceCenterY: 60 },
      { hitRadius: 7, id: "incidental", sourceCenterX: 5, sourceCenterY: 80 },
    ];
    const formulaObstacleMask = new Uint8Array(770 * 450);
    const simulationMask = new Uint8Array(770 * 450);
    let now = 0;
    let current = true;
    let cachedResult: GraphwarOneClickClearPathWorkerResult | undefined;
    let clearFailureCount = 0;
    let runnerCallCount = 0;
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
        applyIncumbent: (incumbent) => {
          appliedExpressions.push(incumbent.expression);
          order.push("apply-incumbent");
        },
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
          equation: "dy",
          steepness: 67,
          stepGlitchMode: true,
          stepGlitchObstacleMask: formulaObstacleMask,
          stepOverflowProtection: true,
        }),
        getObstacleMask: () => new Uint8Array(770 * 450),
        getPathPoints: () => [start],
        getPathfindingWorkerCount: () => 1,
        getRouteMode: () => "visibility-graph",
        requiresDagWorker: () => false,
        getSimulationMask: () => simulationMask,
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
          getCachedOneClickClearResult: () => cachedResult,
          getMaskCacheId: () => 1,
        },
        runner: {
          buildOneClickClearPath: async (input, runnerOptions) => {
            runnerCallCount += 1;
            expect(input.candidates.map((candidate) => candidate.id)).toEqual(["target", "target", "missed"]);
            expect(input.settings.stepGlitchObstacleMask).toBe(simulationMask);
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
                expression: "final",
                expandedStates: 1,
                pathPoints: [start, target],
                targetIds: ["target", "target", "incidental"],
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
        createGeometry: () => ({
          bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
          boundsRect: { height: 450, width: 770, x: 0, y: 0 },
        }),
        getFriendlyFireEnabled: () => false,
        getPrefixTarget: () => undefined,
        getSoldiers: () => candidateSoldiers,
        isFriendlySoldier: () => false,
      },
      time: { now: () => ++now },
    });

    await expect(
      workflow.run({
        onClearFailure: () => {
          clearFailureCount += 1;
          order.push("clear-failure");
        },
        onSuccessBeforeEffects: () => order.push("submit"),
        useResultCache: false,
      }),
    ).resolves.toBe(true);

    expect(order.slice(0, 6)).toEqual(["clear-failure", "submit", "finish", "apply-incumbent", "flash", "status"]);
    expect(clearFailureCount).toBe(1);
    expect(appliedExpressions).toContain("final");

    cachedResult = {
      result: {
        elapsedMs: 10,
        expression: "cached",
        expandedStates: 1,
        pathPoints: [start, target],
        targetIds: ["target", "missed", "incidental"],
        type: "success",
      },
      timings: [],
    };
    const callsBeforeCacheHit = runnerCallCount;
    order.length = 0;
    await expect(
      workflow.run({
        onClearFailure: () => {
          clearFailureCount += 1;
        },
      }),
    ).resolves.toBe(true);
    expect(runnerCallCount).toBe(callsBeforeCacheHit);
    expect(appliedExpressions.at(-1)).toBe("cached");
    expect(order.slice(0, 4)).toEqual(["finish", "apply-incumbent", "flash", "status"]);
    expect(clearFailureCount).toBe(1);
    cachedResult = undefined;

    order.length = 0;
    runnerMode = "failure";
    await expect(
      workflow.run({
        onClearFailure: () => {
          clearFailureCount += 1;
        },
        useResultCache: false,
      }),
    ).resolves.toBe(true);
    expect(order).toContain("apply-incumbent");
    expect(order).not.toContain("apply");
    expect(order).not.toContain("flash");
    expect(clearFailureCount).toBe(1);

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
