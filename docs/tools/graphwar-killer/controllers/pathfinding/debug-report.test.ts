import { describe, expect, it } from "vitest";

import { createPixelPoint } from "../../core/types";
import { createGraphwarOneClickClearSearchInput } from "../../pathfinding/one-click-clear/input";
import { createGraphwarPathfindingDebugMetrics } from "../../pathfinding/runtime/diagnostics";
import {
  createGraphwarPathfindingDebugCapture,
  createGraphwarPathfindingDebugDownloads,
  createGraphwarPathfindingDebugFormulaSettings,
  createGraphwarOneClickClearDebugAttempt,
  finishGraphwarPathfindingDebugCapture,
  summarizeGraphwarPathfindingDiagnostics,
} from "./debug-report";

const startedAt = new Date("2026-07-24T01:02:03.004Z");
const completedAt = new Date("2026-07-24T01:02:04.004Z");

describe("Graphwar pathfinding debug reports", () => {
  it("exports one timestamp-matched state, mask, and versioned debug JSON without embedding mask bytes", () => {
    const capture = createCapture();
    capture.attempts.push({
      input: {
        hitTarget: { center: createPixelPoint(30, 40), radius: 7 },
        kind: "smart-pathfinding",
        sourcePath: [createPixelPoint(10, 20)],
        targetPoint: createPixelPoint(30, 40),
      },
      result: { path: [createPixelPoint(10, 20), createPixelPoint(30, 40)] },
      source: "result-cache",
    });
    const bundle = finishGraphwarPathfindingDebugCapture(capture, { type: "success" }, 2000, completedAt);
    if (!bundle.sourceObstacleMask) {
      throw new Error("Expected the source obstacle mask to be retained by the debug capture");
    }

    const downloads = createGraphwarPathfindingDebugDownloads(
      { ...bundle, sourceObstacleMask: bundle.sourceObstacleMask },
      {
        environment: {
          crossOriginIsolated: false,
          deviceMemory: 8,
          hardwareConcurrency: 12,
          userAgent: "test-agent",
        },
        exportedAt: startedAt,
      },
    );
    const debug = JSON.parse(downloads.debug.content as string) as Record<string, unknown>;

    expect(downloads.state.fileName).toBe("state-2026-07-24T01-02-03-004Z.json");
    expect(downloads.obstacle.fileName).toBe("obstacle-mask-2026-07-24T01-02-03-004Z.bin");
    expect(downloads.debug.fileName).toBe("pathfinding-debug-2026-07-24T01-02-03-004Z.json");
    expect(debug).toMatchObject({
      environment: { hardwareConcurrency: 12, userAgent: "test-agent" },
      files: {
        obstacleMask: downloads.obstacle.fileName,
        state: downloads.state.fileName,
      },
      schemaVersion: 1,
    });
    expect(downloads.debug.content).not.toContain("sourceObstacleMask");
    expect(downloads.debug.content).not.toContain('"stepGlitchObstacleMask":');
    expect(new Uint8Array(downloads.obstacle.content as ArrayBuffer)).toEqual(new Uint8Array([0, 1, 0, 1]));
    expect(JSON.parse(downloads.state.content as string)).toMatchObject({
      mask: { height: 450, width: 770 },
      source: "screenshot",
    });
  });

  it("aggregates real Worker diagnostics across attempts while leaving cache hits diagnostic-free", () => {
    const capture = createCapture();
    const first = createGraphwarPathfindingDebugMetrics(true);
    first.counters.trajectoryReplayCount = 2;
    first.timings.trajectoryReplayElapsedMs = 12;
    if (!first.stepGlitch) {
      throw new Error("Expected Step-glitch diagnostics to be created");
    }
    first.stepGlitch.candidateReplayCount = 3;
    const second = createGraphwarPathfindingDebugMetrics(false);
    second.counters.trajectoryReplayCount = 5;
    second.timings.trajectoryReplayElapsedMs = 20;
    capture.attempts.push(
      {
        diagnostics: first,
        input: {
          hitTarget: { center: createPixelPoint(30, 40), radius: 7 },
          kind: "smart-pathfinding",
          sourcePath: [createPixelPoint(10, 20)],
          targetPoint: createPixelPoint(30, 40),
        },
        source: "worker",
      },
      {
        input: {
          hitTarget: { center: createPixelPoint(40, 40), radius: 7 },
          kind: "smart-pathfinding",
          sourcePath: [createPixelPoint(10, 20)],
          targetPoint: createPixelPoint(40, 40),
        },
        source: "result-cache",
      },
      {
        diagnostics: second,
        input: {
          hitTarget: { center: createPixelPoint(50, 40), radius: 7 },
          kind: "smart-pathfinding",
          sourcePath: [createPixelPoint(10, 20)],
          targetPoint: createPixelPoint(50, 40),
        },
        source: "worker",
      },
    );
    const summary = summarizeGraphwarPathfindingDiagnostics(
      finishGraphwarPathfindingDebugCapture(capture, { type: "failure" }, 2000, completedAt).report,
    );

    expect(summary?.counters.trajectoryReplayCount).toBe(7);
    expect(summary?.timings.trajectoryReplayElapsedMs).toBe(32);
    expect(summary?.stepGlitch).toEqual({ candidateReplayCount: 3, directReplayCount: 0 });
  });

  it("does not export writable Error names or messages", () => {
    const capture = createCapture();
    const unsafeError = new Error("token=message-secret");
    unsafeError.name = "C:\\Users\\me\\path-secret";
    capture.attempts.push(
      createGraphwarOneClickClearDebugAttempt(createOneClickClearInput(), "worker", undefined, unsafeError),
    );
    const bundle = finishGraphwarPathfindingDebugCapture(capture, { type: "worker-exception" }, 2000, completedAt);
    if (!bundle.sourceObstacleMask) {
      throw new Error("Expected the source obstacle mask to be retained by the debug capture");
    }

    const downloads = createGraphwarPathfindingDebugDownloads({
      ...bundle,
      sourceObstacleMask: bundle.sourceObstacleMask,
    });

    expect(bundle.report.attempts[0]?.errorType).toBe("Error");
    expect(downloads.debug.content).not.toContain("message-secret");
    expect(downloads.debug.content).not.toContain("path-secret");
  });
});

/** Creates a minimal mask-bearing input whose debug summary intentionally keeps only ids and path points. */
function createOneClickClearInput() {
  const point = createPixelPoint(10, 20);
  return createGraphwarOneClickClearSearchInput({
    bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
    boundsRect: { height: 450, width: 770, x: 0, y: 0 },
    candidates: [],
    dagEdgeWorkerCount: 1,
    isDeleteOptimizationEnabled: false,
    hitCandidates: [],
    pathPoints: [point],
    prefixTarget: undefined,
    routeMaskCacheId: 1,
    routeMode: "visibility-graph",
    routeObstacleMask: new Uint8Array(1),
    settings: {
      algorithm: "step",
      decimalPlaces: 4,
      equation: "y",
      steepness: 67,
      stepGlitchMode: false,
      stepOverflowProtection: true,
    },
    simulationMask: undefined,
    simulationMaskCacheId: 0,
    tolerances: {
      oneClickClearDeleteCheckRadiusPlanePixels: 0,
      routeBoundaryInsetPlanePixels: 0,
      routePlanningTolerancePlanePixels: 0,
      simulationBoundaryInsetPlanePixels: 0,
    },
  });
}

/** Creates the smallest screenshot-source task capture that still reconstructs a search scene. */
function createCapture() {
  return createGraphwarPathfindingDebugCapture({
    path: [createPixelPoint(10, 20)],
    sceneSource: "screenshot",
    sceneState: {
      bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
      boundsRect: { height: 450, width: 770, x: 0, y: 0 },
      equationMode: "y",
      isViewMirrored: false,
      mask: { blockedValue: 1, emptyValue: 0, height: 450, width: 770 },
      pathOrigin: createPixelPoint(10, 20),
      schemaVersion: 1,
      soldiers: [],
      source: "screenshot",
    },
    settings: {
      formula: createGraphwarPathfindingDebugFormulaSettings({
        algorithm: "step",
        decimalPlaces: 4,
        equation: "y",
        steepness: 67,
        stepGlitchMode: true,
        stepGlitchObstacleMask: new Uint8Array([1, 0]),
        stepOverflowProtection: true,
      }),
      isDeleteOptimizationEnabled: false,
      isFriendlyFireEnabled: false,
      isResultCacheEnabled: true,
      isSearchAnimationEnabled: true,
      routeMode: "visibility-graph",
    },
    sourceObstacleMask: new Uint8Array([0, 1, 0, 1]),
    startedAt,
    startedAtMs: 1000,
    taskType: "smart-pathfinding",
  });
}
