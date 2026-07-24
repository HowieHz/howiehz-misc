import {
  createGraphwarTrajectoryDebugMetrics,
  type GraphwarTrajectoryDebugCounters,
  type GraphwarTrajectoryDebugMetrics,
  type GraphwarTrajectoryDebugTimings,
} from "../../formula/debug-metrics";

/** Work counters shared by smart pathfinding and one-click clear. */
export interface GraphwarPathfindingDebugCounters extends GraphwarTrajectoryDebugCounters {
  /** Incumbent messages actually sent across the Worker boundary. */
  incumbentReportCount: number;
  /** Total trajectory points carried by incumbent messages. */
  incumbentTrajectoryPointLoad: number;
}

/** Natural internal timing boundaries shared by pathfinding Worker tasks. */
export interface GraphwarPathfindingDebugTimings extends GraphwarTrajectoryDebugTimings {
  /** Construction and defensive copying of publishable incumbent data. */
  incumbentBuildElapsedMs: number;
  /** Synchronous Worker message clone/enqueue cost for incumbent messages. */
  incumbentMessageSendElapsedMs: number;
}

/** Extra counters that exist only when Step-glitch scanning actually runs. */
export interface GraphwarStepGlitchDebugCounters {
  /** Candidate formulas replayed after the direct attempt. */
  candidateReplayCount: number;
  /** Direct target formulas replayed before candidate scanning. */
  directReplayCount: number;
}

/** Optional Worker diagnostics; cached business results deliberately omit this object. */
export interface GraphwarPathfindingDiagnostics {
  counters: GraphwarPathfindingDebugCounters;
  timings: GraphwarPathfindingDebugTimings;
  stepGlitch?: GraphwarStepGlitchDebugCounters;
}

/** Mutable diagnostics used only by a Worker request that opted into debug collection. */
export interface GraphwarPathfindingDebugMetrics
  extends GraphwarTrajectoryDebugMetrics, GraphwarPathfindingDiagnostics {
  counters: GraphwarPathfindingDebugCounters;
  timings: GraphwarPathfindingDebugTimings;
}

/** Stable display/export order for common pathfinding work counters. */
export const graphwarPathfindingDebugCounterKeys = [
  "trajectoryReplayCount",
  "formulaTermEvaluationCount",
  "rk4StepCount",
  "stepBisectionCount",
  "acceptedSamplePointCount",
  "incumbentReportCount",
  "incumbentTrajectoryPointLoad",
] as const satisfies readonly (keyof GraphwarPathfindingDebugCounters)[];

/** Stable display/export order for natural Worker timing boundaries. */
export const graphwarPathfindingDebugTimingKeys = [
  "formulaPointMappingElapsedMs",
  "formulaPreparationElapsedMs",
  "trajectoryReplayElapsedMs",
  "pathErrorElapsedMs",
  "expressionFinalizationElapsedMs",
  "visibleTrajectoryCopyElapsedMs",
  "incumbentBuildElapsedMs",
  "incumbentMessageSendElapsedMs",
] as const satisfies readonly (keyof GraphwarPathfindingDebugTimings)[];

/** Stable display/export order for optional Step-glitch counters. */
export const graphwarStepGlitchDebugCounterKeys = [
  "directReplayCount",
  "candidateReplayCount",
] as const satisfies readonly (keyof GraphwarStepGlitchDebugCounters)[];

/** Creates request-local diagnostics without adding any normal-mode allocation. */
export function createGraphwarPathfindingDebugMetrics(
  shouldCollectStepGlitchCounters: boolean,
): GraphwarPathfindingDebugMetrics {
  const trajectory = createGraphwarTrajectoryDebugMetrics();
  return {
    counters: {
      ...trajectory.counters,
      incumbentReportCount: 0,
      incumbentTrajectoryPointLoad: 0,
    },
    timings: {
      ...trajectory.timings,
      incumbentBuildElapsedMs: 0,
      incumbentMessageSendElapsedMs: 0,
    },
    ...(shouldCollectStepGlitchCounters ? { stepGlitch: { candidateReplayCount: 0, directReplayCount: 0 } } : {}),
  };
}
