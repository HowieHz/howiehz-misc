/** Formula evaluator work shared by every instrumented trajectory replay. */
export interface GraphwarFormulaDebugCounters {
  /** Number of compiled formula terms evaluated across all calls. */
  formulaTermEvaluationCount: number;
}

/** Deterministic trajectory work collected only while debug mode is active. */
export interface GraphwarTrajectoryDebugCounters extends GraphwarFormulaDebugCounters {
  /** Accepted sample points, accumulated from completed replay result lengths. */
  acceptedSamplePointCount: number;
  /** RK4 trial steps, including retries caused by step bisection. */
  rk4StepCount: number;
  /** Number of times an oversized step was halved. */
  stepBisectionCount: number;
  /** Complete trajectory replays, including failed candidates and preparation probes. */
  trajectoryReplayCount: number;
}

/** Natural trajectory boundaries measured without timing per-sample callbacks. */
export interface GraphwarTrajectoryDebugTimings {
  /** Final expression construction after the numeric formula state is stable. */
  expressionFinalizationElapsedMs: number;
  /** Pixel path to Graphwar coordinate conversion. */
  formulaPointMappingElapsedMs: number;
  /** Formula point preparation, material compilation, and protection solving. */
  formulaPreparationElapsedMs: number;
  /** Path quality measurement after trajectory sampling. */
  pathErrorElapsedMs: number;
  /** Whole replay time, including integration and target/obstacle checks. */
  trajectoryReplayElapsedMs: number;
  /** Copying the visible trajectory into a stable externally publishable snapshot. */
  visibleTrajectoryCopyElapsedMs: number;
}

/** Mutable trajectory diagnostics shared by all replays in one Worker request. */
export interface GraphwarTrajectoryDebugMetrics {
  counters: GraphwarTrajectoryDebugCounters;
  timings: GraphwarTrajectoryDebugTimings;
}

/** Creates zeroed trajectory diagnostics only for an explicitly instrumented request. */
export function createGraphwarTrajectoryDebugMetrics(): GraphwarTrajectoryDebugMetrics {
  return {
    counters: {
      acceptedSamplePointCount: 0,
      formulaTermEvaluationCount: 0,
      rk4StepCount: 0,
      stepBisectionCount: 0,
      trajectoryReplayCount: 0,
    },
    timings: {
      expressionFinalizationElapsedMs: 0,
      formulaPointMappingElapsedMs: 0,
      formulaPreparationElapsedMs: 0,
      pathErrorElapsedMs: 0,
      trajectoryReplayElapsedMs: 0,
      visibleTrajectoryCopyElapsedMs: 0,
    },
  };
}
