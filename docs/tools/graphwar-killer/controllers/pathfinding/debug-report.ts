import type { BoundsRect, EquationMode, GraphBounds, PixelPoint } from "../../core/types";
import type { GraphwarDetectionBox } from "../../detection/objects";
import type { GraphwarTrajectoryFormulaSettings } from "../../formula/trajectory/sampling";
import type {
  GraphwarPathfindingDebugCounters,
  GraphwarPathfindingDebugTimings,
  GraphwarPathfindingDiagnostics,
  GraphwarStepGlitchDebugCounters,
} from "../../pathfinding/runtime/diagnostics";
import {
  graphwarPathfindingDebugCounterKeys,
  graphwarPathfindingDebugTimingKeys,
  graphwarStepGlitchDebugCounterKeys,
} from "../../pathfinding/runtime/diagnostics";
import type {
  GraphwarOneClickClearPathWorkerInput,
  GraphwarOneClickClearPathWorkerResult,
  GraphwarSmartPathfindingPathInput,
  GraphwarSmartPathfindingPathResult,
} from "../../pathfinding/runtime/protocol";
import type { GraphwarAgentAvailableState } from "../agent/client";
import {
  createGraphwarDebugFileNameSuffix,
  createGraphwarDebugSceneDownloads,
  type GraphwarAgentDebugDownloadOptions,
  type GraphwarDebugDownload,
} from "../agent/debug-files";
import type { SmartPathfindingDebugTimingEntry } from "../debug/timings";

export const GRAPHWAR_PATHFINDING_DEBUG_REPORT_SCHEMA_VERSION = 1;

/** Screenshot-only source scene saved beside the original obstacle mask. */
export interface GraphwarPathfindingScreenshotSceneState {
  bounds: GraphBounds;
  boundsRect: BoundsRect;
  equationMode: EquationMode;
  isViewMirrored: boolean;
  mask: {
    blockedValue: 1;
    emptyValue: 0;
    height: number;
    width: number;
  };
  pathOrigin?: PixelPoint;
  schemaVersion: 1;
  soldiers: GraphwarDetectionBox[];
  source: "screenshot";
}

export type GraphwarPathfindingDebugSceneState = GraphwarAgentAvailableState | GraphwarPathfindingScreenshotSceneState;

/** Formula settings without the large mask already exported as the source .bin file. */
export type GraphwarPathfindingDebugFormulaSettings = Omit<
  GraphwarTrajectoryFormulaSettings,
  "stepGlitchObstacleMask"
> & {
  stepGlitchObstacleMaskLength?: number;
};

/** Settings frozen before any task-side preparation or Worker dispatch. */
export interface GraphwarPathfindingDebugTaskSettings {
  formula: GraphwarPathfindingDebugFormulaSettings;
  isDeleteOptimizationEnabled: boolean;
  isFriendlyFireEnabled: boolean;
  isResultCacheEnabled: boolean;
  isSearchAnimationEnabled: boolean;
  pathfindingWorkerCount?: number;
  routeMode: GraphwarSmartPathfindingPathInput["routeMode"];
  tolerances?: {
    routeBoundaryInsetPlanePixels: number;
    routePlanningTolerancePlanePixels: number;
    simulationBoundaryInsetPlanePixels: number;
    simulationTolerancePlanePixels: number;
  };
}

/** Mask-free input summary for one Worker attempt. */
export type GraphwarPathfindingDebugAttemptInput =
  | {
      hitTarget: GraphwarSmartPathfindingPathInput["hitTarget"];
      kind: "smart-pathfinding";
      prefixTarget?: GraphwarSmartPathfindingPathInput["prefixTarget"];
      sourcePath: PixelPoint[];
      targetPoint: PixelPoint;
    }
  | {
      candidateIds: string[];
      hitCandidateIds: string[];
      kind: "one-click-clear";
      pathPoints: PixelPoint[];
      prefixTarget?: GraphwarOneClickClearPathWorkerInput["prefixTarget"];
    };

/** One cache lookup or Worker execution within a user-visible pathfinding task. */
export interface GraphwarPathfindingDebugAttempt {
  diagnostics?: GraphwarPathfindingDiagnostics;
  errorType?: string;
  input: GraphwarPathfindingDebugAttemptInput;
  result?:
    | GraphwarOneClickClearPathWorkerResult["result"]
    | Omit<GraphwarSmartPathfindingPathResult, "diagnostics" | "timings">;
  source: "result-cache" | "worker";
  workerTimings?: GraphwarOneClickClearPathWorkerResult["timings"] | GraphwarSmartPathfindingPathResult["timings"];
}

/** Stable final outcome for successful, failed, cancelled, and exceptional tasks. */
export interface GraphwarPathfindingDebugOutcome {
  reason?: string;
  type: "cancelled" | "failure" | "preflight-failure" | "success" | "worker-exception";
}

/** Latest completed task report; source state and mask remain separate download files. */
export interface GraphwarPathfindingDebugReport {
  attempts: GraphwarPathfindingDebugAttempt[];
  completedAt: string;
  elapsedMs: number;
  outcome: GraphwarPathfindingDebugOutcome;
  pageTimings: SmartPathfindingDebugTimingEntry[];
  path: PixelPoint[];
  sceneSource: "agent" | "screenshot";
  schemaVersion: typeof GRAPHWAR_PATHFINDING_DEBUG_REPORT_SCHEMA_VERSION;
  settings: GraphwarPathfindingDebugTaskSettings;
  startedAt: string;
  taskType: "one-click-clear" | "smart-pathfinding";
}

/** Mutable task-local capture that is never exposed as the latest report until completion. */
export interface GraphwarPathfindingDebugCapture {
  attempts: GraphwarPathfindingDebugAttempt[];
  pageTimings?: SmartPathfindingDebugTimingEntry[];
  path: PixelPoint[];
  sceneSource: GraphwarPathfindingDebugReport["sceneSource"];
  sceneState: GraphwarPathfindingDebugSceneState;
  settings: GraphwarPathfindingDebugTaskSettings;
  sourceObstacleMask?: Uint8Array;
  startedAt: Date;
  startedAtMs: number;
  taskType: GraphwarPathfindingDebugReport["taskType"];
}

/** Latest completed report plus its task-start source files. */
export interface GraphwarPathfindingDebugBundle {
  report: GraphwarPathfindingDebugReport;
  sceneState: GraphwarPathfindingDebugSceneState;
  sourceObstacleMask?: Uint8Array;
}

/** Export-time browser metadata useful for comparing machines without recording page identity. */
export interface GraphwarPathfindingDebugEnvironment {
  crossOriginIsolated: boolean;
  deviceMemory?: number;
  hardwareConcurrency: number;
  userAgent: string;
}

/** JSON payload adds matching source filenames and export-time environment to the task report. */
export interface GraphwarPathfindingDebugExport extends GraphwarPathfindingDebugReport {
  environment: GraphwarPathfindingDebugEnvironment;
  exportedAt: string;
  files: {
    obstacleMask: string;
    state: string;
  };
}

/** Three timestamp-matched downloads produced by one debug-panel action. */
export interface GraphwarPathfindingDebugDownloads {
  debug: GraphwarDebugDownload;
  obstacle: GraphwarDebugDownload;
  state: GraphwarDebugDownload;
}

/** Creates a task-local capture and clones only data needed by the eventual three-file export. */
export function createGraphwarPathfindingDebugCapture(options: {
  path: readonly PixelPoint[];
  sceneSource: GraphwarPathfindingDebugCapture["sceneSource"];
  sceneState: GraphwarPathfindingDebugSceneState;
  settings: GraphwarPathfindingDebugTaskSettings;
  sourceObstacleMask?: Uint8Array;
  startedAt?: Date;
  startedAtMs: number;
  taskType: GraphwarPathfindingDebugCapture["taskType"];
}): GraphwarPathfindingDebugCapture {
  return {
    attempts: [],
    path: options.path.map((point) => ({ ...point })),
    sceneSource: options.sceneSource,
    sceneState: structuredClone(options.sceneState),
    settings: structuredClone(options.settings),
    ...(options.sourceObstacleMask ? { sourceObstacleMask: options.sourceObstacleMask.slice() } : {}),
    startedAt: options.startedAt ?? new Date(),
    startedAtMs: options.startedAtMs,
    taskType: options.taskType,
  };
}

/** Atomically converts a completed capture into the only retained report bundle. */
export function finishGraphwarPathfindingDebugCapture(
  capture: GraphwarPathfindingDebugCapture,
  outcome: GraphwarPathfindingDebugOutcome,
  completedAtMs: number,
  completedAt = new Date(),
): GraphwarPathfindingDebugBundle {
  return {
    report: {
      attempts: structuredClone(capture.attempts),
      completedAt: completedAt.toISOString(),
      elapsedMs: Math.max(0, completedAtMs - capture.startedAtMs),
      outcome: { ...outcome },
      pageTimings: structuredClone(capture.pageTimings ?? []),
      path: structuredClone(capture.path),
      sceneSource: capture.sceneSource,
      schemaVersion: GRAPHWAR_PATHFINDING_DEBUG_REPORT_SCHEMA_VERSION,
      settings: structuredClone(capture.settings),
      startedAt: capture.startedAt.toISOString(),
      taskType: capture.taskType,
    },
    sceneState: structuredClone(capture.sceneState),
    ...(capture.sourceObstacleMask ? { sourceObstacleMask: capture.sourceObstacleMask.slice() } : {}),
  };
}

/** Records a smart-path attempt without retaining route or simulation mask bytes. */
export function createGraphwarSmartPathfindingDebugAttempt(
  input: GraphwarSmartPathfindingPathInput,
  source: GraphwarPathfindingDebugAttempt["source"],
  result?: GraphwarSmartPathfindingPathResult,
  error?: unknown,
): GraphwarPathfindingDebugAttempt {
  const businessResult = result
    ? {
        ...(result.blockedPoint ? { blockedPoint: structuredClone(result.blockedPoint) } : {}),
        ...(result.failureReason ? { failureReason: result.failureReason } : {}),
        ...(result.invalidSegmentIndex === undefined ? {} : { invalidSegmentIndex: result.invalidSegmentIndex }),
        ...(result.path ? { path: structuredClone(result.path) } : {}),
      }
    : undefined;
  return {
    ...(result?.diagnostics ? { diagnostics: structuredClone(result.diagnostics) } : {}),
    ...(error === undefined ? {} : { errorType: getGraphwarPathfindingDebugErrorType(error) }),
    input: {
      hitTarget: structuredClone(input.hitTarget),
      kind: "smart-pathfinding",
      ...(input.prefixTarget ? { prefixTarget: structuredClone(input.prefixTarget) } : {}),
      sourcePath: input.sourcePath.map((point) => ({ ...point })),
      targetPoint: structuredClone(input.targetPoint),
    },
    ...(businessResult ? { result: businessResult } : {}),
    source,
    ...(result && source === "worker" ? { workerTimings: structuredClone(result.timings) } : {}),
  };
}

/** Records a one-click-clear attempt without retaining derived masks or duplicated formula settings. */
export function createGraphwarOneClickClearDebugAttempt(
  input: GraphwarOneClickClearPathWorkerInput,
  source: GraphwarPathfindingDebugAttempt["source"],
  result?: GraphwarOneClickClearPathWorkerResult,
  error?: unknown,
): GraphwarPathfindingDebugAttempt {
  return {
    ...(result?.diagnostics ? { diagnostics: structuredClone(result.diagnostics) } : {}),
    ...(error === undefined ? {} : { errorType: getGraphwarPathfindingDebugErrorType(error) }),
    input: {
      candidateIds: input.candidates.map((candidate) => candidate.id),
      hitCandidateIds: input.hitCandidates.map((candidate) => candidate.id),
      kind: "one-click-clear",
      pathPoints: input.pathPoints.map((point) => ({ ...point })),
      ...(input.prefixTarget ? { prefixTarget: structuredClone(input.prefixTarget) } : {}),
    },
    ...(result ? { result: structuredClone(result.result) } : {}),
    source,
    ...(result && source === "worker" ? { workerTimings: structuredClone(result.timings) } : {}),
  };
}

/** Removes the Step-glitch mask from settings because the source .bin file already owns mask bytes. */
export function createGraphwarPathfindingDebugFormulaSettings(
  settings: GraphwarTrajectoryFormulaSettings,
): GraphwarPathfindingDebugFormulaSettings {
  const { stepGlitchObstacleMask, ...serializableSettings } = settings;
  return {
    ...serializableSettings,
    ...(stepGlitchObstacleMask ? { stepGlitchObstacleMaskLength: stepGlitchObstacleMask.length } : {}),
  };
}

/** Aggregates all Worker attempts for the latest task without inventing diagnostics for cache hits. */
export function summarizeGraphwarPathfindingDiagnostics(
  report: GraphwarPathfindingDebugReport,
): GraphwarPathfindingDiagnostics | undefined {
  let summary: GraphwarPathfindingDiagnostics | undefined;
  for (const attempt of report.attempts) {
    if (!attempt.diagnostics) {
      continue;
    }
    summary ??= createEmptyGraphwarPathfindingDiagnostics();
    addGraphwarPathfindingDebugCounters(summary.counters, attempt.diagnostics.counters);
    addGraphwarPathfindingDebugTimings(summary.timings, attempt.diagnostics.timings);
    if (attempt.diagnostics.stepGlitch) {
      summary.stepGlitch ??= { candidateReplayCount: 0, directReplayCount: 0 };
      addGraphwarStepGlitchDebugCounters(summary.stepGlitch, attempt.diagnostics.stepGlitch);
    }
  }
  return summary;
}

/** Creates matching state, bin, and debug JSON downloads from the latest completed task. */
export function createGraphwarPathfindingDebugDownloads(
  bundle: GraphwarPathfindingDebugBundle & { sourceObstacleMask: Uint8Array },
  options: GraphwarAgentDebugDownloadOptions & {
    environment?: GraphwarPathfindingDebugEnvironment;
  } = {},
): GraphwarPathfindingDebugDownloads {
  const exportedAt = options.exportedAt ?? new Date();
  const sceneDownloads = createGraphwarDebugSceneDownloads(bundle.sceneState, bundle.sourceObstacleMask, {
    exportedAt,
    ...(options.failureKind ? { failureKind: options.failureKind } : {}),
  });
  const prefix = options.failureKind ? `clear-failure-${options.failureKind}-` : "";
  const debugFileName = `${prefix}pathfinding-debug-${createGraphwarDebugFileNameSuffix(exportedAt)}.json`;
  const exportedReport: GraphwarPathfindingDebugExport = {
    ...structuredClone(bundle.report),
    environment: options.environment ?? readGraphwarPathfindingDebugEnvironment(),
    exportedAt: exportedAt.toISOString(),
    files: {
      obstacleMask: sceneDownloads.obstacle.fileName,
      state: sceneDownloads.state.fileName,
    },
  };
  return {
    debug: {
      content: `${JSON.stringify(exportedReport, undefined, 2)}\n`,
      fileName: debugFileName,
      mediaType: "application/json",
    },
    obstacle: sceneDownloads.obstacle,
    state: sceneDownloads.state,
  };
}

/** Reads coarse browser capabilities only; URLs, storage, tokens, and filesystem paths are intentionally absent. */
export function readGraphwarPathfindingDebugEnvironment(): GraphwarPathfindingDebugEnvironment {
  const browserNavigator = typeof navigator === "undefined" ? undefined : navigator;
  const deviceMemory = (browserNavigator as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory;
  return {
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    ...(deviceMemory === undefined ? {} : { deviceMemory }),
    hardwareConcurrency: browserNavigator?.hardwareConcurrency ?? 0,
    userAgent: browserNavigator?.userAgent ?? "",
  };
}

/** Worker exception reports use a fixed category so writable names and messages cannot leak sensitive text. */
function getGraphwarPathfindingDebugErrorType(error: unknown) {
  return error instanceof Error ? "Error" : typeof error;
}

/** Creates a zero accumulator only after at least one real Worker diagnostics object exists. */
function createEmptyGraphwarPathfindingDiagnostics(): GraphwarPathfindingDiagnostics {
  return {
    counters: {
      acceptedSamplePointCount: 0,
      formulaTermEvaluationCount: 0,
      incumbentReportCount: 0,
      incumbentTrajectoryPointLoad: 0,
      rk4StepCount: 0,
      stepBisectionCount: 0,
      trajectoryReplayCount: 0,
    },
    timings: {
      expressionFinalizationElapsedMs: 0,
      formulaPointMappingElapsedMs: 0,
      formulaPreparationElapsedMs: 0,
      incumbentBuildElapsedMs: 0,
      incumbentMessageSendElapsedMs: 0,
      pathErrorElapsedMs: 0,
      trajectoryReplayElapsedMs: 0,
      visibleTrajectoryCopyElapsedMs: 0,
    },
  };
}

/** Adds common counters in their stable display/export order. */
function addGraphwarPathfindingDebugCounters(
  target: GraphwarPathfindingDebugCounters,
  source: GraphwarPathfindingDebugCounters,
) {
  for (const key of graphwarPathfindingDebugCounterKeys) {
    target[key] += source[key];
  }
}

/** Adds natural Worker timings in their stable display/export order. */
function addGraphwarPathfindingDebugTimings(
  target: GraphwarPathfindingDebugTimings,
  source: GraphwarPathfindingDebugTimings,
) {
  for (const key of graphwarPathfindingDebugTimingKeys) {
    target[key] += source[key];
  }
}

/** Adds optional Step-glitch counters without creating the extension for other algorithms. */
function addGraphwarStepGlitchDebugCounters(
  target: GraphwarStepGlitchDebugCounters,
  source: GraphwarStepGlitchDebugCounters,
) {
  for (const key of graphwarStepGlitchDebugCounterKeys) {
    target[key] += source[key];
  }
}

export type GraphwarPathfindingDebugCounterKey = keyof GraphwarPathfindingDebugCounters;
export type GraphwarPathfindingDebugTimingKey = keyof GraphwarPathfindingDebugTimings;
export type GraphwarStepGlitchDebugCounterKey = keyof GraphwarStepGlitchDebugCounters;
