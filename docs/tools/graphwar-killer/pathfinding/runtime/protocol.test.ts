import { describe, expect, it } from "vitest";

import type { GraphwarBackendAttemptIdentity } from "../../core/algorithm-backend";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { MAX_FORMULA_DECIMAL_PLACES } from "../../core/numbers";
import { createPixelPoint } from "../../core/types";
import {
  isGraphwarOneClickClearDagEdgeBuildResult,
  isGraphwarOneClickClearEdgeWorkerRequest,
  isGraphwarOneClickClearEdgeWorkerResponse,
  isGraphwarOneClickClearPathWorkerResult,
  isGraphwarPathfindingPreview,
  isGraphwarPathfindingRouteResult,
  isGraphwarPathfindingWorkerRequest,
  isGraphwarSmartPathfindingPathResult,
} from "./protocol";

const bounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
const boundsRect = { height: 450, width: 770, x: 0, y: 0 };
const startPoint = createPixelPoint(100, 225);
const targetPoint = createPixelPoint(200, 225);
const attempt = {
  attemptId: 1,
  backendGeneration: 0,
  outerTaskId: 1,
} satisfies GraphwarBackendAttemptIdentity;

describe("Graphwar pathfinding Worker request validation", () => {
  it("accepts all four complete task types", () => {
    expect(
      isGraphwarPathfindingWorkerRequest({ attempt, id: 1, task: { input: createRouteInput(), type: "find-route" } }),
    ).toBe(true);
    expect(
      isGraphwarPathfindingWorkerRequest({
        attempt,
        id: 2,
        task: { input: createSmartPathInput(), type: "find-smart-path" },
      }),
    ).toBe(true);
    expect(
      isGraphwarPathfindingWorkerRequest({
        attempt,
        id: 3,
        task: { input: createDagEdgeInput(), type: "build-one-click-clear-dag-edges" },
      }),
    ).toBe(true);
    expect(
      isGraphwarPathfindingWorkerRequest({
        attempt,
        id: 4,
        task: {
          input: createOneClickClearInput(),
          shouldReportIncumbents: false,
          type: "build-one-click-clear-path",
        },
      }),
    ).toBe(true);
  });

  it("rejects unknown tasks, non-finite geometry, and incomplete masks", () => {
    expect(
      isGraphwarPathfindingWorkerRequest({ attempt, id: 1, task: { input: createRouteInput(), type: "unknown" } }),
    ).toBe(false);
    expect(
      isGraphwarPathfindingWorkerRequest({
        attempt,
        id: 1,
        task: { input: { ...createRouteInput(), boundaryExpansion: Number.NaN }, type: "find-route" },
      }),
    ).toBe(false);
    const duplicateJobs = createDagEdgeInput();
    duplicateJobs.jobs = [duplicateJobs.jobs[0], duplicateJobs.jobs[0]];
    expect(
      isGraphwarPathfindingWorkerRequest({
        attempt,
        id: 1,
        task: { input: duplicateJobs, type: "build-one-click-clear-dag-edges" },
      }),
    ).toBe(false);
    expect(
      isGraphwarPathfindingWorkerRequest({
        attempt,
        id: 1,
        task: { input: { ...createRouteInput(), routeMask: new Uint8Array(1) }, type: "find-route" },
      }),
    ).toBe(false);
  });

  it("requires a complete backend attempt identity", () => {
    expect(isGraphwarPathfindingWorkerRequest({ id: 1, task: { input: createRouteInput(), type: "find-route" } })).toBe(
      false,
    );
    expect(
      isGraphwarPathfindingWorkerRequest({
        attempt: { ...attempt, backendGeneration: -1 },
        id: 1,
        task: { input: createRouteInput(), type: "find-route" },
      }),
    ).toBe(false);
  });

  it("requires Step-glitch runtime and its canonical route identity", () => {
    const input = createSmartPathInput();
    const settings = { ...input.settings, algorithm: "step", equation: "dy", isStepGlitchModeEnabled: true };
    expect(
      isGraphwarPathfindingWorkerRequest({
        attempt,
        id: 1,
        task: { input: { ...input, settings, simulationMask: undefined }, type: "find-smart-path" },
      }),
    ).toBe(false);
    expect(
      isGraphwarPathfindingWorkerRequest({
        attempt,
        id: 1,
        task: {
          input: { ...input, routeMode: "theta-star", settings, simulationMask: createPlaneMask() },
          type: "find-smart-path",
        },
      }),
    ).toBe(false);
  });

  it("rejects both Step runtime half-states in DAG jobs", () => {
    const stateless = createDagEdgeInput();
    const state = { resolvedStateKey: "0", resolvedY: 0 };
    expect(
      isGraphwarPathfindingWorkerRequest({
        attempt,
        id: 1,
        task: {
          input: { ...stateless, jobs: [{ ...stateless.jobs[0], stepRouteStartState: state }] },
          type: "build-one-click-clear-dag-edges",
        },
      }),
    ).toBe(false);

    const step = { ...stateless, settings: { ...stateless.settings, algorithm: "step" } };
    expect(
      isGraphwarPathfindingWorkerRequest({
        attempt,
        id: 1,
        task: { input: step, type: "build-one-click-clear-dag-edges" },
      }),
    ).toBe(false);
    expect(
      isGraphwarPathfindingWorkerRequest({
        attempt,
        id: 1,
        task: {
          input: { ...step, jobs: [{ ...step.jobs[0], stepRouteStartState: state }] },
          type: "build-one-click-clear-dag-edges",
        },
      }),
    ).toBe(true);
    expect(
      isGraphwarPathfindingWorkerRequest({
        attempt,
        id: 1,
        task: {
          input: {
            ...step,
            jobs: [
              {
                ...step.jobs[0],
                stepRouteStartState: { resolvedStateKey: "01", resolvedY: 0 },
              },
            ],
          },
          type: "build-one-click-clear-dag-edges",
        },
      }),
    ).toBe(false);
  });

  it("rejects formula settings outside the validated numeric domain", () => {
    const smartInput = createSmartPathInput();
    for (const settings of [
      { ...smartInput.settings, decimalPlaces: MAX_FORMULA_DECIMAL_PLACES + 1 },
      { ...smartInput.settings, formulaPathSteepness: 0 },
      { ...smartInput.settings, steepness: 0 },
    ]) {
      expect(
        isGraphwarPathfindingWorkerRequest({
          attempt,
          id: 1,
          task: { input: { ...smartInput, settings }, type: "find-smart-path" },
        }),
      ).toBe(false);
    }

    const dagInput = createDagEdgeInput();
    expect(
      isGraphwarPathfindingWorkerRequest({
        attempt,
        id: 1,
        task: {
          input: { ...dagInput, settings: { ...dagInput.settings, decimalPlaces: MAX_FORMULA_DECIMAL_PLACES + 1 } },
          type: "build-one-click-clear-dag-edges",
        },
      }),
    ).toBe(false);
  });

  it("validates edge Worker init masks and job payloads before dispatch", () => {
    const input = createDagEdgeInput();
    const context = {
      bounds,
      boundsRect,
      boundaryExpansion: 0,
      routeMask: createPlaneMask(),
      routeMode: "visibility-graph",
      routeOriginPoint: startPoint,
      routeTolerancePlanePixels: 2,
      settings: input.settings,
      workerIndex: 1,
    };
    expect(isGraphwarOneClickClearEdgeWorkerRequest({ attempt, context, type: "init" })).toBe(true);
    expect(
      isGraphwarOneClickClearEdgeWorkerRequest({
        attempt,
        context: { ...context, routeMask: new Uint8Array(1) },
        type: "init",
      }),
    ).toBe(false);
    expect(isGraphwarOneClickClearEdgeWorkerRequest({ attempt, job: input.jobs[0], requestId: 1, type: "job" })).toBe(
      true,
    );
    expect(isGraphwarOneClickClearEdgeWorkerRequest({ context, type: "init" })).toBe(false);
    expect(
      isGraphwarOneClickClearEdgeWorkerRequest({
        attempt,
        job: { ...input.jobs[0], targetPoint: { x: Number.POSITIVE_INFINITY, y: 0 } },
        requestId: 1,
        type: "job",
      }),
    ).toBe(false);
  });

  it("validates complete edge Worker responses", () => {
    expect(isGraphwarOneClickClearEdgeWorkerResponse({ attempt, type: "ready", workerIndex: 1 })).toBe(true);
    expect(isGraphwarOneClickClearEdgeWorkerResponse({ type: "ready", workerIndex: 1 })).toBe(false);
    expect(
      isGraphwarOneClickClearEdgeWorkerResponse({
        attempt,
        requestId: 1,
        result: {
          jobId: 0,
          route: [startPoint, targetPoint],
          routeMapPixelsElapsedMs: 1,
          routePathfindingElapsedMs: 2,
          stepRouteEndState: { resolvedStateKey: "0", resolvedY: 0 },
        },
        type: "job-result",
        workerIndex: 1,
      }),
    ).toBe(true);
    expect(isGraphwarOneClickClearEdgeWorkerResponse(undefined)).toBe(false);
    expect(
      isGraphwarOneClickClearEdgeWorkerResponse({
        attempt,
        requestId: 1,
        result: {
          jobId: 0,
          routeMapPixelsElapsedMs: Number.NaN,
          routePathfindingElapsedMs: 2,
        },
        type: "job-result",
        workerIndex: 1,
      }),
    ).toBe(false);
    expect(
      isGraphwarOneClickClearEdgeWorkerResponse({
        attempt,
        requestId: 1,
        result: {
          jobId: 0,
          routeMapPixelsElapsedMs: 1,
          routePathfindingElapsedMs: 2,
          stepRouteEndState: { resolvedStateKey: "01", resolvedY: 0 },
        },
        type: "job-result",
        workerIndex: 1,
      }),
    ).toBe(false);
    expect(
      isGraphwarOneClickClearEdgeWorkerResponse({
        attempt,
        requestId: 1,
        result: {
          jobId: 0,
          routeMapPixelsElapsedMs: 1,
          routePathfindingElapsedMs: 2,
          stepRouteEndState: { resolvedStateKey: "0", resolvedY: 0 },
        },
        type: "job-result",
        workerIndex: 1,
      }),
    ).toBe(false);
  });
});

describe("Graphwar pathfinding Worker result validation", () => {
  it("validates complete route and preview payloads", () => {
    expect(
      isGraphwarPathfindingRouteResult({
        path: [startPoint],
        searchElapsedMs: 1,
        visibilityCache: "hit",
        visibilityCacheElapsedMs: 2,
      }),
    ).toBe(true);
    expect(
      isGraphwarPathfindingRouteResult({
        path: [{ x: 1.5, y: 2 }],
        searchElapsedMs: 1,
        visibilityCache: "hit",
        visibilityCacheElapsedMs: 2,
      }),
    ).toBe(false);

    const preview = {
      acceptedEdges: [
        [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      ],
      bestPath: [{ x: 1, y: 2 }],
      candidates: [],
      current: { x: 3, y: 4 },
      isMirrored: false,
    };
    expect(isGraphwarPathfindingPreview(preview)).toBe(true);
    expect(isGraphwarPathfindingPreview({ ...preview, acceptedEdges: [[{ x: 1, y: 2 }]] })).toBe(false);
  });

  it("rejects smart-path half-states and malformed timing domains", () => {
    expect(
      isGraphwarSmartPathfindingPathResult({
        path: [startPoint, targetPoint],
        timings: [{ elapsedMs: 1, stage: "search-route" }],
      }),
    ).toBe(true);
    expect(isGraphwarSmartPathfindingPathResult({ timings: [] })).toBe(false);
    expect(
      isGraphwarSmartPathfindingPathResult({
        failureReason: "route",
        path: [startPoint, targetPoint],
        timings: [],
      }),
    ).toBe(false);
    expect(
      isGraphwarSmartPathfindingPathResult({
        failureReason: "route",
        timings: [{ elapsedMs: -1, stage: "search-route" }],
      }),
    ).toBe(false);
  });

  it("rejects duplicate DAG result ids and detached Step state", () => {
    const route = { jobId: 1, route: [startPoint, targetPoint] };
    expect(
      isGraphwarOneClickClearDagEdgeBuildResult({
        routes: [route],
        timings: [{ elapsedMs: 1, stage: "build-dag-edges" }],
      }),
    ).toBe(true);
    expect(isGraphwarOneClickClearDagEdgeBuildResult({ routes: [route, route], timings: [] })).toBe(false);
    expect(
      isGraphwarOneClickClearDagEdgeBuildResult({
        routes: [{ jobId: 1, stepRouteEndState: { resolvedStateKey: "0", resolvedY: 0 } }],
        timings: [],
      }),
    ).toBe(false);
  });

  it("rejects one-click result branch mixing and invalid metric domains", () => {
    const success = {
      result: {
        elapsedMs: 1,
        expandedStates: 1,
        expression: "x",
        pathPoints: [startPoint, targetPoint],
        targetIds: ["target"],
        trajectoryPoints: [startPoint, targetPoint],
        type: "success",
      },
      timings: [],
    };
    expect(isGraphwarOneClickClearPathWorkerResult(success)).toBe(true);
    expect(
      isGraphwarOneClickClearPathWorkerResult({
        ...success,
        result: { ...success.result, reason: "no-candidate" },
      }),
    ).toBe(false);
    expect(
      isGraphwarOneClickClearPathWorkerResult({
        result: {
          elapsedMs: 1,
          expandedStates: 1,
          expression: "x",
          reason: "no-candidate",
          type: "failure",
        },
        timings: [],
      }),
    ).toBe(false);
    expect(
      isGraphwarOneClickClearPathWorkerResult({
        ...success,
        result: { ...success.result, elapsedMs: -1 },
      }),
    ).toBe(false);
    expect(
      isGraphwarOneClickClearPathWorkerResult({
        ...success,
        result: { ...success.result, expandedStates: 1.5 },
      }),
    ).toBe(false);
  });
});

function createRouteInput() {
  return {
    boundaryExpansion: 0,
    bounds,
    boundsRect,
    isPreviewEnabled: false,
    routeMask: createPlaneMask(),
    routeMaskCacheId: 1,
    routeMode: "visibility-graph",
    routeTolerancePlanePixels: 2,
    startPoint,
    targetPoint,
  };
}

function createSmartPathInput() {
  return {
    ...createRouteInput(),
    hitTarget: { center: targetPoint, radius: 10 },
    isDeleteOptimizationEnabled: false,
    routeObstacleMask: createPlaneMask(),
    settings: createFormulaSettings(),
    simulationBoundaryExpansion: 0,
    simulationMask: createPlaneMask(),
    simulationMaskCacheId: 1,
    sourcePath: [startPoint],
  };
}

function createOneClickClearInput() {
  return {
    boundaryExpansion: 0,
    bounds,
    boundsRect,
    candidates: [],
    dagEdgeWorkerCount: 1,
    deleteHitCheckRadiusPixels: 0,
    hitCandidates: [],
    isDeleteOptimizationEnabled: false,
    pathPoints: [startPoint],
    routeMaskCacheId: 1,
    routeMode: "visibility-graph",
    routeObstacleMask: createPlaneMask(),
    routeTolerancePlanePixels: 2,
    settings: createFormulaSettings(),
    simulationBoundaryExpansion: 0,
    simulationMaskCacheId: 1,
  };
}

function createDagEdgeInput() {
  return {
    boundaryExpansion: 0,
    bounds,
    boundsRect,
    jobs: [{ from: -1, id: 0, startPoint, targetPoint, to: 0 }],
    routeMask: createPlaneMask(),
    routeMode: "visibility-graph",
    routeOriginPoint: startPoint,
    routeTolerancePlanePixels: 2,
    settings: {
      algorithm: "abs",
      decimalPlaces: 4,
      equation: "y",
      steepness: 67,
    },
    workerCount: 1,
  };
}

function createFormulaSettings() {
  return {
    algorithm: "abs",
    decimalPlaces: 4,
    equation: "y",
    isStepGlitchModeEnabled: false,
    isStepOverflowProtectionEnabled: true,
    steepness: 67,
  };
}

function createPlaneMask() {
  return new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
}
