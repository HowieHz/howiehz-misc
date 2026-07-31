import { GRAPHWAR_FUNC_MAX_STEPS, GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { graphToImagePoint, imageToGraphPoint, pixelPointsEqual } from "../../core/geometry";
import { graphXAdvancesStrictly } from "../../core/numbers";
import { imagePointToPlaneGridPoint, planeColumnToForwardColumn } from "../../core/plane-grid";
import { createGraphPoint, createPixelPoint } from "../../core/types";
import type { BoundsRect, GraphBounds, GraphPoint, PixelPoint } from "../../core/types";
import { buildFormula } from "../../formula/generation/build";
import type { CompiledGraphwarFormulaMaterials } from "../../formula/generation/build";
import type { FormulaEvaluationOptions, StepGlitchSegment } from "../../formula/generation/step-numeric-strategy";
import { graphwarByteArraysEqual } from "../../formula/trajectory/final-replay-snapshot";
import type { GraphwarFinalReplaySnapshot } from "../../formula/trajectory/final-replay-snapshot";
import {
  isGraphwarTrajectoryFormulaSettings,
  isGraphwarTrajectoryPoint,
} from "../../formula/trajectory/input-validation";
import type {
  GraphwarStepGlitchFormulaEvidence,
  GraphwarStepGlitchFormulaPrefix,
  GraphwarStepGlitchXWindow,
  GraphwarTrajectoryFormulaContext,
  GraphwarTrajectoryFormulaMode,
  GraphwarTrajectoryFormulaSettings,
  GraphwarTrajectoryTargetCircle,
} from "../../formula/trajectory/sampling";
import {
  graphwarStepGlitchPrefixEvidenceHasValidIdentity,
  graphwarStepGlitchPrefixEvidenceMatchesContext,
} from "../../pathfinding/routing/step-glitch-scan";
import type {
  GraphwarStepGlitchPrefixEvidence,
  GraphwarStepGlitchPrefixOptions,
  GraphwarStepGlitchTargetOptions,
} from "../../pathfinding/routing/step-glitch-scan";
import { graphwarToolDefaults } from "../tool/defaults";
import {
  GraphwarWasmAdapterError,
  copyGraphwarWasmFloat64Values,
  copyGraphwarWasmUint32Values,
  validateGraphwarWasmEnumValue,
  validateGraphwarWasmFiniteNumber,
  validateGraphwarWasmMemoryRange,
  validateGraphwarWasmPathError,
  validateGraphwarWasmProtectionBits,
  validateGraphwarWasmU32,
  writeGraphwarWasmBytes,
  writeGraphwarWasmFloat64Values,
  writeGraphwarWasmUint32Values,
  type GraphwarWasmArenaMemorySource,
  type GraphwarWasmMemorySlice,
} from "./abi";
import {
  readGraphwarWasmFormulaLaunchResultForStepGlitchTest,
  type GraphwarWasmFormulaLaunchResult,
  type GraphwarWasmTrajectoryPhysicalState,
} from "./formula-adapter";
import { GraphwarWasmKernelRuntime } from "./runtime";
import {
  getGraphwarWasmFormulaAlgorithmTag,
  getGraphwarWasmFormulaEquationTag,
  packGraphwarPlaneMask,
  packGraphwarWasmPointSoA,
  type GraphwarWasmPackedPointSoA,
} from "./task-adapter";
import { createGraphwarWasmTrajectoryPhysicalStateFromSamplingState } from "./trajectory-state-adapter";

const STEP_GLITCH_SEGMENT_RECORD_LENGTH = 10;
const ALLOWED_SIGN_PROTECTION_BITS = 0b1_1111;
const STEP_GLITCH_COMMAND_CREATE_CONTEXT = 11;
const STEP_GLITCH_COMMAND_TRACE_FRONTIER = 12;
const STEP_GLITCH_COMMAND_TRACE_DFS = 13;
const STEP_GLITCH_COMMAND_PREPARE_CANDIDATE_FORMULA_FOR_TEST = 15;
const STEP_GLITCH_COMMAND_REPLAY_CANDIDATE_FOR_TEST = 16;
const STEP_GLITCH_COMMAND_TRACE_REAL_DFS_FOR_TEST = 17;
const STEP_GLITCH_COMMAND_SCAN = 18;
const STEP_GLITCH_COMMAND_REPLAY = 19;
const STEP_GLITCH_CREATE_INPUT_BYTE_LENGTH = 52;
const STEP_GLITCH_CONTEXT_BYTE_LENGTH = 72;
const STEP_GLITCH_CONTEXT_MAGIC = 0x5347_4354;
const STEP_GLITCH_CONTEXT_FLAG_MIRRORED = 1;
const STEP_GLITCH_PREFIX_EVIDENCE_BYTE_LENGTH = 164;
const STEP_GLITCH_PLANE_CELL_COUNT = GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT;
const STEP_GLITCH_TRACE_INPUT_BYTE_LENGTH = 48;
const STEP_GLITCH_TRACE_RESULT_BYTE_LENGTH = 40;
const STEP_GLITCH_TRACE_MAGIC = 0x5347_5452;
const STEP_GLITCH_TRACE_BATCH_BYTE_LENGTH = 24;
const STEP_GLITCH_TRACE_WINDOW_BYTE_LENGTH = 32;
const STEP_GLITCH_TRACE_ROW_BYTE_LENGTH = 20;
const STEP_GLITCH_TRACE_CANDIDATE_BYTE_LENGTH = 56;
const STEP_GLITCH_DFS_INPUT_BYTE_LENGTH = 88;
const STEP_GLITCH_DFS_SCRIPT_BYTE_LENGTH = 40;
const STEP_GLITCH_DFS_RESULT_BYTE_LENGTH = 40;
const STEP_GLITCH_DFS_TRACE_BYTE_LENGTH = 56;
const STEP_GLITCH_DFS_RESULT_MAGIC = 0x5347_4452;
const STEP_GLITCH_FORMULA_INPUT_BYTE_LENGTH = 32;
const STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH = 24;
const STEP_GLITCH_REPLAY_INPUT_BYTE_LENGTH = 48;
const STEP_GLITCH_REPLAY_RESULT_BYTE_LENGTH = 180;
const STEP_GLITCH_REPLAY_RESULT_MAGIC = 0x5347_5252;
const STEP_GLITCH_REAL_DFS_INPUT_BYTE_LENGTH = 16;
const STEP_GLITCH_REAL_DFS_TARGET_VALUE_COUNT = 5;
const STEP_GLITCH_REAL_DFS_RESULT_BYTE_LENGTH = 40;
const STEP_GLITCH_REAL_DFS_RESULT_MAGIC = 0x5347_5244;
const STEP_GLITCH_REAL_DFS_TRACE_BYTE_LENGTH = 212;
const STEP_GLITCH_REAL_DFS_PREFIX_PREPARATION_NONE = 0;
const STEP_GLITCH_REAL_DFS_PREFIX_PREPARATION_COLD = 1;
const STEP_GLITCH_REAL_DFS_PREFIX_PREPARATION_EVIDENCE = 2;
const STEP_GLITCH_PRODUCTION_SCAN_INPUT_BYTE_LENGTH = 24;
const STEP_GLITCH_PRODUCTION_REPLAY_INPUT_BYTE_LENGTH = 64;
const STEP_GLITCH_FINAL_VALIDATION_BYTE_LENGTH = 32;
const STEP_GLITCH_PRODUCTION_RESULT_BYTE_LENGTH = 72;
const STEP_GLITCH_PRODUCTION_RESULT_MAGIC = 0x5347_5052;
const STEP_GLITCH_PRODUCTION_EVIDENCE_MAGIC = 0x5347_4556;
const STEP_GLITCH_PRODUCTION_EVIDENCE_VERSION = 1;
const STEP_GLITCH_PRODUCTION_EVIDENCE_HEADER_BYTE_LENGTH = 296;
const STEP_GLITCH_PRODUCTION_EVIDENCE_BYTE_LENGTH_OFFSET = 248;
const FORMULA_INPUT_BYTE_LENGTH = 176;
const FORMULA_RESULT_BYTE_LENGTH = 48;
const FORMULA_LAUNCH_RESULT_BYTE_LENGTH = 80;
const TRAJECTORY_EVIDENCE_BYTE_LENGTH = 104;
const TRAJECTORY_EVIDENCE_CURRENT_X_OFFSET = 40;
const TRAJECTORY_EVIDENCE_CURRENT_Y_OFFSET = 48;
const TRAJECTORY_EVIDENCE_CURRENT_DY_OFFSET = 56;
const TRAJECTORY_EVIDENCE_PREVIOUS_X_OFFSET = 64;
const TRAJECTORY_EVIDENCE_PREVIOUS_Y_OFFSET = 72;
const TRAJECTORY_EVIDENCE_PREVIOUS_DY_OFFSET = 80;
const TRAJECTORY_EVIDENCE_SAMPLE_INDEX_OFFSET = 88;
const TRAJECTORY_EVIDENCE_REACHED_ORDERED_COUNT_OFFSET = 92;
const TRAJECTORY_EVIDENCE_REACHED_REQUIRED_COUNT_OFFSET = 96;
const FORMULA_ALGORITHM_STEP = 2;
const FORMULA_EQUATION_DY = 2;
const FORMULA_EQUATION_DDY = 3;
const FORMULA_FLAG_STEP_OVERFLOW_PROTECTION = 1;
const FORMULA_FLAG_DISPLAY_ROUNDED_ANGLE = 2;
const FORMULA_FLAG_STEP_GLITCH_MODE = 8;
const FORMULA_FLAG_STEP_GLITCH_FIXED_WINDOWS = 16;
const TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_POINT = 1;
const TRAJECTORY_EVIDENCE_FLAG_HAS_DY = 2;
const TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_DY = 4;
const TRAJECTORY_EVIDENCE_FLAG_SKIP_INITIAL_STOP = 8;
const TRAJECTORY_EVIDENCE_FLAG_CAN_CONTINUE_TO_LATER_FRONTIER = 16;
const TRAJECTORY_STOP_REASON_STOP_X = 1;
const TRAJECTORY_STOP_REASON_MAX_STEPS = 3;
const TRAJECTORY_STOP_REASON_OUT_OF_BOUNDS = 4;
const TRAJECTORY_STOP_REASON_OBSTACLE = 6;
const TRAJECTORY_STOP_REASON_TARGET = 7;
const TRAJECTORY_RESULT_FLAG_OBSTACLE_HIT = 1;
const TRAJECTORY_RESULT_FLAG_HAS_PATH_ERROR = 2;
const TRAJECTORY_RESULT_FLAG_USED_CONTINUATION = 4;
const FORMULA_INPUT_ALGORITHM_OFFSET = 0;
const FORMULA_INPUT_EQUATION_OFFSET = 4;
const FORMULA_INPUT_DECIMAL_PLACES_OFFSET = 8;
const FORMULA_INPUT_FLAGS_OFFSET = 12;
const FORMULA_INPUT_POINT_COUNT_OFFSET = 16;
const FORMULA_INPUT_POINT_X_POINTER_OFFSET = 20;
const FORMULA_INPUT_POINT_Y_POINTER_OFFSET = 24;
const FORMULA_INPUT_SIGN_PROTECTION_POINTER_OFFSET = 28;
const FORMULA_INPUT_SIGN_PROTECTION_COUNT_OFFSET = 32;
const FORMULA_INPUT_STEP_OVERFLOW_RANGE_POINTER_OFFSET = 52;
const FORMULA_INPUT_STEEPNESS_OFFSET = 56;
const FORMULA_INPUT_BOUNDS_MIN_X_OFFSET = 64;
const FORMULA_INPUT_BOUNDS_MAX_X_OFFSET = 72;
const FORMULA_INPUT_BOUNDS_MIN_Y_OFFSET = 80;
const FORMULA_INPUT_BOUNDS_MAX_Y_OFFSET = 88;
const FORMULA_INPUT_SOLDIER_X_OFFSET = 96;
const FORMULA_INPUT_SOLDIER_Y_OFFSET = 104;
const FORMULA_INPUT_GLITCH_SEGMENT_POINTER_OFFSET = 136;
const FORMULA_INPUT_STEP_OVERFLOW_RANGE_COUNT_OFFSET = 148;
const FORMULA_INPUT_PATH_STEEPNESS_OFFSET = 152;
const FORMULA_INPUT_MASK_POINTER_OFFSET = 160;
const FORMULA_INPUT_MASK_BYTE_LENGTH_OFFSET = 164;
const FORMULA_RESULT_MATERIAL_POINTER_OFFSET = 4;
const FORMULA_RESULT_PROTECTION_POINTER_OFFSET = 32;
const FORMULA_RESULT_PROTECTION_COUNT_OFFSET = 36;
const FORMULA_LAUNCH_RESULT_STATUS_OFFSET = 0;
const FORMULA_LAUNCH_RESULT_MATERIAL_RESULT_POINTER_OFFSET = 48;
const FORMULA_LAUNCH_RESULT_PROTECTION_POINTER_OFFSET = 60;
const FORMULA_LAUNCH_RESULT_PROTECTION_COUNT_OFFSET = 64;
const FORMULA_LAUNCH_RESULT_FORMULA_POINT_COUNT_OFFSET = 68;
const FORMULA_LAUNCH_RESULT_FORMULA_POINT_X_POINTER_OFFSET = 72;
const FORMULA_LAUNCH_RESULT_FORMULA_POINT_Y_POINTER_OFFSET = 76;
const TRAJECTORY_EVIDENCE_PROTECTION_POINTER_OFFSET = 32;
const TRAJECTORY_EVIDENCE_PROTECTION_COUNT_OFFSET = 36;
const TRAJECTORY_EVIDENCE_FLAGS_OFFSET = 100;

/** WASM context 永远显式携带 evidence 分支，避免存在性被拆成多份可选字段。 */
export type GraphwarWasmStepGlitchPrefixEvidenceInput =
  | { type: "none" }
  | { evidence: GraphwarStepGlitchPrefixEvidence; type: "candidate" };

/** Prefix target 的缺省状态也进入判别联合，避免用零半径或零坐标充当 sentinel。 */
export type GraphwarWasmStepGlitchPrefixTargetInput =
  | { type: "none" }
  | { target: GraphwarTrajectoryTargetCircle; type: "target" };

/** Retained scanner context 的完整输入；TS diagnostics 与旧 TS mask index 不跨 WASM 边界。 */
export interface GraphwarWasmStepGlitchContextInput {
  bounds: GraphBounds;
  boundsRect: BoundsRect;
  formulaMode: GraphwarTrajectoryFormulaMode;
  prefixEvidence: GraphwarWasmStepGlitchPrefixEvidenceInput;
  prefixTarget: GraphwarWasmStepGlitchPrefixTargetInput;
  requiredTargets: readonly GraphwarTrajectoryTargetCircle[];
  simulationBoundaryExpansion: number;
  simulationMask: Uint8Array;
  sourcePath: readonly PixelPoint[];
}

/** Final validation 的全部身份同进同出，不能只携带 cache id 或 tracked targets。 */
export type GraphwarWasmStepGlitchFinalValidationInput =
  | { type: "none" }
  | {
      simulationMaskCacheId: number;
      targetControlPoints: readonly PixelPoint[];
      trackedTargets: readonly GraphwarTrajectoryTargetCircle[];
      type: "validate";
    };

/** 同一 retained context 支持 scan 与 deletion replay，两者不共享不合法的可选字段。 */
export type GraphwarWasmStepGlitchCommandInput =
  | {
      finalValidation: GraphwarWasmStepGlitchFinalValidationInput;
      hitTarget: GraphwarTrajectoryTargetCircle;
      targetPoint: PixelPoint;
      type: "scan";
    }
  | {
      controlX: number;
      finalValidation: GraphwarWasmStepGlitchFinalValidationInput;
      path: readonly PixelPoint[];
      targetSequence: readonly GraphwarTrajectoryTargetCircle[];
      windows?:
        | { type: "automatic" }
        | { segments: readonly (GraphwarStepGlitchXWindow | undefined)[]; type: "explicit" };
      type: "replay";
    };

/** Formula settings 的 raw 数值记录和可选 mask 是一个原子范围集合。 */
export interface GraphwarWasmPackedStepGlitchFormulaSettings {
  mask: { type: "context-mask" | "evidence-mask" | "mismatch" | "none" };
  values: GraphwarWasmMemorySlice;
}

/** Optional point arrays use an explicit presence bitmap rather than NaN sentinels. */
export interface GraphwarWasmPackedOptionalPointSoA {
  points: GraphwarWasmPackedPointSoA;
  presence: GraphwarWasmMemorySlice;
}

/** Optional scalar arrays preserve undefined independently from every legal finite value. */
export interface GraphwarWasmPackedOptionalFloat64Values {
  presence: GraphwarWasmMemorySlice;
  values: GraphwarWasmMemorySlice;
}

/** Prefix formula is flattened into aligned SoA/ranges with one shared segment count. */
export interface GraphwarWasmPackedStepGlitchFormulaPrefix {
  initialFormulaPoints: GraphwarWasmPackedPointSoA;
  metadata: GraphwarWasmMemorySlice;
  points: GraphwarWasmPackedPointSoA;
  refinedFormulaPoints: GraphwarWasmPackedPointSoA;
  segmentStartPoints: GraphwarWasmPackedOptionalPointSoA;
  settings: GraphwarWasmPackedStepGlitchFormulaSettings;
  signProtection: GraphwarWasmMemorySlice;
  stepGlitchRequirements: GraphwarWasmMemorySlice;
  stepGlitchSegments: GraphwarWasmMemorySlice;
  stepSegmentDeltaYs: GraphwarWasmPackedOptionalFloat64Values;
}

/** Boundary state is optional as one atom and always references the enclosing packed prefix. */
export type GraphwarWasmPackedStepGlitchBoundaryState =
  | { type: "none" }
  | {
      formulaMaterialsIdentity: GraphwarWasmMemorySlice;
      state: GraphwarWasmMemorySlice;
      type: "state";
    };

/** Complete formula evidence; boundary state cannot exist without its prefix ranges. */
export interface GraphwarWasmPackedStepGlitchFormulaEvidence {
  boundaryState: GraphwarWasmPackedStepGlitchBoundaryState;
  prefix: GraphwarWasmPackedStepGlitchFormulaPrefix;
}

/** Prefix reuse candidate retains its own exact mask snapshot and target identity. */
export type GraphwarWasmPackedStepGlitchPrefixEvidence =
  | { type: "none" }
  | {
      formulaEvidence: GraphwarWasmPackedStepGlitchFormulaEvidence;
      identityMask: GraphwarWasmMemorySlice;
      requiredTargetRecords: GraphwarWasmMemorySlice;
      values: GraphwarWasmMemorySlice;
      type: "candidate";
    };

/** Packed retained context contains no TS callback, diagnostics object, or precomputed TS mask index. */
export interface GraphwarWasmPackedStepGlitchContextInput {
  formulaSettings: GraphwarWasmPackedStepGlitchFormulaSettings;
  prefixEvidence: GraphwarWasmPackedStepGlitchPrefixEvidence;
  requiredTargetRecords: GraphwarWasmMemorySlice;
  simulationMask: GraphwarWasmMemorySlice;
  sourcePath: GraphwarWasmPackedPointSoA;
  values: GraphwarWasmMemorySlice;
}

export type GraphwarWasmPackedStepGlitchFinalValidation =
  | { type: "none" }
  | {
      simulationMaskCacheId: number;
      targetControlPoints: GraphwarWasmPackedPointSoA;
      trackedTargetRecords: GraphwarWasmMemorySlice;
      type: "validate";
    };

export type GraphwarWasmPackedStepGlitchCommandInput =
  | {
      finalValidation: GraphwarWasmPackedStepGlitchFinalValidation;
      targetValues: GraphwarWasmMemorySlice;
      type: "scan";
    }
  | {
      controlX: number;
      finalValidation: GraphwarWasmPackedStepGlitchFinalValidation;
      path: GraphwarWasmPackedPointSoA;
      targetSequenceRecords: GraphwarWasmMemorySlice;
      windows: { count: number; mode: number; pointer: number };
      type: "replay";
    };

/** Descriptor preflight can produce only normal scanner outcomes or a fully packed context. */
export type GraphwarWasmStepGlitchContextPackResult =
  | { status: "invalid-input" | "unsupported" }
  | { input: GraphwarWasmPackedStepGlitchContextInput; status: "ready" };

/** Command preflight mirrors scanner invalid-input without converting it into a WASM fault. */
export type GraphwarWasmStepGlitchCommandPackResult =
  | { status: "invalid-input" }
  | { input: GraphwarWasmPackedStepGlitchCommandInput; status: "ready" };

export type GraphwarWasmStepGlitchBusinessStatus = "hit" | "invalid-input" | "no-path" | "unsupported";

/** 8B1 geometry test seam retains one raw context without exposing a geometry-only production path. */
export interface GraphwarWasmStepGlitchGeometryTestContext {
  copyFarthestFreeX: () => Int16Array;
  dispose: () => void;
  isMirrored: boolean;
  prepareCandidateFormulaForTest: (
    input: GraphwarWasmStepGlitchFormulaCandidateTestInput,
  ) => GraphwarWasmFormulaLaunchResult;
  replayCandidateForTest: (
    input: GraphwarWasmStepGlitchRealReplayTestInput,
  ) => GraphwarWasmStepGlitchRealReplayTestOutput;
  /** Production raw ABI; deep evidence decoding is intentionally a later 8B3 boundary. */
  replayRaw: (
    input: Extract<GraphwarWasmStepGlitchCommandInput, { type: "replay" }>,
  ) => GraphwarWasmStepGlitchRawReplayOutput;
  scanRaw: (
    input: Extract<GraphwarWasmStepGlitchCommandInput, { type: "scan" }>,
  ) => GraphwarWasmStepGlitchRawScanOutput;
  traceGateFrontier: (
    input: GraphwarWasmStepGlitchGeometryFrontierInput,
  ) => GraphwarWasmStepGlitchGeometryFrontierTrace;
  traceScriptedDfs: (input: GraphwarWasmStepGlitchGeometryDfsInput) => GraphwarWasmStepGlitchGeometryDfsTrace;
  traceRealDfsForTest: (input: GraphwarWasmStepGlitchRealDfsTestInput) => GraphwarWasmStepGlitchRealDfsTestTrace;
}

export interface GraphwarWasmStepGlitchFormulaCandidateTestInput {
  path: readonly PixelPoint[];
  windows: { type: "automatic" } | { segments: readonly (GraphwarStepGlitchXWindow | undefined)[]; type: "explicit" };
}

/** One scanner candidate replay is kept as a cold, target-aware command input. */
export interface GraphwarWasmStepGlitchRealReplayTestInput {
  controlX: number;
  orderedTargets: readonly GraphwarTrajectoryTargetCircle[];
  path: readonly PixelPoint[];
  windows: { type: "automatic" } | { segments: readonly (GraphwarStepGlitchXWindow | undefined)[]; type: "explicit" };
}

export interface GraphwarWasmStepGlitchRealDfsTestInput {
  hitTarget: GraphwarTrajectoryTargetCircle;
  targetPoint: PixelPoint;
}

export interface GraphwarWasmStepGlitchRealDfsTestTrace {
  bestReachedTargetCount: number;
  blockedX?: number;
  candidates: readonly {
    acceptedPoint?: GraphPoint;
    blockedPoint?: GraphPoint;
    controlX: number;
    expansionOrdinal: number;
    kind: "direct" | "prefix" | "gate" | "target";
    path: readonly PixelPoint[];
    replay: GraphwarWasmStepGlitchRealDfsReplaySummary;
    windows: { type: "automatic" } | { segments: readonly (GraphwarStepGlitchXWindow | undefined)[]; type: "explicit" };
  }[];
  expandedStates: number;
  prefixPreparation: "cold" | "evidence" | "none";
  status: "hit" | "no-path";
}

export type GraphwarWasmStepGlitchRealDfsReplaySummary =
  | {
      acceptedSamplePointCount: number;
      bisectionCount: number;
      finalAcceptedSamplePointCount: number;
      finalBisectionCount: number;
      finalRk4StepCount: number;
      launchStatus: "invalid";
      minStepJumpCount: number;
      reachedRequiredTargetCount: number;
      reachedTargetCount: number;
      replayCount: number;
      rk4StepCount: number;
      status: "miss";
      stopReason: number;
    }
  | {
      acceptedPoint?: GraphPoint;
      acceptedSamplePointCount: number;
      bisectionCount: number;
      blockedPoint?: GraphPoint;
      finalAcceptedSamplePointCount: number;
      finalBisectionCount: number;
      finalRk4StepCount: number;
      launchStatus: "success";
      minStepJumpCount: number;
      obstacleHitIndex: number;
      reachedRequiredTargetCount: number;
      reachedTargetCount: number;
      replayCount: number;
      requiredTargetsHitIndex: number;
      rk4StepCount: number;
      state: GraphwarWasmTrajectoryPhysicalState;
      status: "hit" | "miss";
      stopReason: number;
      targetHitIndex: number;
      pointCount: number;
    };

export type GraphwarWasmStepGlitchRealReplayTestOutput =
  | {
      acceptedSamplePointCount: number;
      bisectionCount: number;
      finalAcceptedSamplePointCount: number;
      finalBisectionCount: number;
      finalRk4StepCount: number;
      launchStatus: "invalid";
      minStepJumpCount: number;
      observedSignProtection: readonly number[];
      reachedRequiredTargetCount: number;
      reachedTargetCount: number;
      replayCount: number;
      rk4StepCount: number;
      status: "miss";
      stopReason: number;
    }
  | {
      acceptedPoint?: GraphPoint;
      acceptedSamplePointCount: number;
      bisectionCount: number;
      blockedPoint?: GraphPoint;
      finalAcceptedSamplePointCount: number;
      finalBisectionCount: number;
      finalRk4StepCount: number;
      initialDy: number;
      launchStatus: "success";
      minStepJumpCount: number;
      obstacleHitIndex: number;
      observedSignProtection: readonly number[];
      pointDys: readonly number[];
      points: readonly GraphPoint[];
      reachedRequiredTargetCount: number;
      reachedTargetCount: number;
      replayCount: number;
      requiredTargetsHitIndex: number;
      rk4StepCount: number;
      state: GraphwarWasmTrajectoryPhysicalState;
      status: "hit" | "miss";
      stopReason: number;
      targetHitIndex: number;
      visiblePixels: readonly PixelPoint[];
    };

export interface GraphwarWasmStepGlitchGeometryFrontierInput {
  acceptedPoint: GraphPoint;
  firstBlockedSearchX: number;
  row: number;
  target: GraphPoint;
  targetRow: number;
}

export interface GraphwarWasmStepGlitchGeometryFrontierTrace {
  batches: readonly {
    backoffColumns: number;
    canUseMonotonicBackoffPruning: boolean;
    searchX: number;
    sharedWindowSearchX: number | undefined;
    windowCount: number;
    windowStart: number;
  }[];
  candidates: readonly {
    backoffColumns: number;
    controlPoint: PixelPoint;
    controlX: number;
    decimalPlaces: number;
    expansionOrdinal: number;
    row: number;
    startX: number;
    windowOrdinal: number;
  }[];
  firstBlockedSearchX: number;
  rows: readonly {
    farthestX: number;
    row: number;
    startDeltaY: number;
    targetDeltaY: number;
    usableWindowBatchMask: number;
  }[];
  windows: readonly {
    controlX: number;
    decimalPlaces: number;
    searchX: number;
    startX: number;
    windowOrdinal: number;
  }[];
}

export type GraphwarWasmStepGlitchGeometryReplayOutcome =
  | { blockedX?: number; reachedTargetCount: number; status: "miss" }
  | {
      acceptedPoint: GraphPoint;
      blockedX?: number;
      reachedTargetCount: number;
      status: "hit";
    };

export interface GraphwarWasmStepGlitchGeometryDfsInput {
  hitTargetCenter: PixelPoint;
  prefixAcceptedPoint: GraphPoint;
  prefixBlockedX?: number;
  prefixReachedTargetCount: number;
  replayMode:
    | { type: "all-miss" }
    | { outcomes: readonly GraphwarWasmStepGlitchGeometryReplayOutcome[]; type: "scripted" };
  targetPoint: PixelPoint;
}

export type GraphwarWasmStepGlitchGeometryDfsCandidateTrace = {
  blockedX?: number;
  expansionOrdinal: number;
  kind: "direct" | "gate" | "target";
  path: readonly PixelPoint[];
  reachedTargetCount: number;
} & ({ acceptedPoint?: never; status: "miss" } | { acceptedPoint: GraphPoint; status: "hit" });

export interface GraphwarWasmStepGlitchGeometryDfsTrace {
  bestReachedTargetCount: number;
  blockedX?: number;
  candidates: readonly GraphwarWasmStepGlitchGeometryDfsCandidateTrace[];
  expandedStates: number;
  scriptConsumed: number;
  status: "hit" | "no-path";
}

export type GraphwarWasmStepGlitchGeometryContextCreateResult =
  | { status: "invalid-input" | "unsupported" }
  | { context: GraphwarWasmStepGlitchGeometryTestContext; status: "ready" };

function graphwarWasmPixelPathsEqual(left: readonly PixelPoint[], right: readonly PixelPoint[]) {
  return (
    left.length === right.length &&
    left.every((point, index) => {
      const rightPoint = right[index];
      return rightPoint !== undefined && pixelPointsEqual(point, rightPoint);
    })
  );
}

/** Optional final replay snapshot remains an explicit result branch, never a detached cache id. */
export type GraphwarWasmStepGlitchFinalValidationEvidence =
  | { type: "none" }
  | { snapshot: GraphwarFinalReplaySnapshot; type: "validated" };

/** Owned success evidence is copied from one WASM result before the command arena resets. */
export interface GraphwarWasmStepGlitchReplayEvidence {
  finalValidation: GraphwarWasmStepGlitchFinalValidationEvidence;
  /**
   * Formula context reconstructed from fields carried by the production ABI. Prefix evidence is deliberately absent
   * until that ABI carries its full identity.
   */
  formulaContext: GraphwarTrajectoryFormulaContext;
  trajectoryPoints: readonly PixelPoint[];
}

interface GraphwarWasmStepGlitchResultBase {
  expandedStates: number;
  reachedTargetCount: number;
}

/** Scan output forbids every success-only field on normal business failures. */
export type GraphwarWasmStepGlitchScanOutput =
  | (GraphwarWasmStepGlitchResultBase & {
      acceptedPoint: GraphPoint;
      blockedPoint?: never;
      path: readonly PixelPoint[];
      replayEvidence: GraphwarWasmStepGlitchReplayEvidence;
      status: "hit";
    })
  | (GraphwarWasmStepGlitchResultBase & {
      acceptedPoint?: never;
      blockedPoint?: GraphPoint;
      path?: never;
      replayEvidence?: never;
      status: "invalid-input" | "no-path" | "unsupported";
    });

/** Explicit replay has the same atomic success evidence but only hit/miss business outcomes. */
export type GraphwarWasmStepGlitchReplayOutput =
  | {
      acceptedPoint: GraphPoint;
      blockedPoint?: GraphPoint;
      path: readonly PixelPoint[];
      reachedTargetCount: number;
      replayEvidence: GraphwarWasmStepGlitchReplayEvidence;
      status: "hit";
    }
  | {
      acceptedPoint?: never;
      blockedPoint?: GraphPoint;
      path?: never;
      reachedTargetCount: number;
      replayEvidence?: never;
      status: "miss";
    };

export interface GraphwarWasmStepGlitchOwnedFormulaInput {
  readonly bounds: GraphBounds;
  readonly equation: "dy" | "ddy";
  readonly flags: number;
  readonly formulaPathSteepness: number;
  readonly mask: Uint8Array;
  readonly overflowProtectionRange?: { maxX: number; minX: number };
  readonly points: readonly GraphPoint[];
  readonly settings: Readonly<GraphwarTrajectoryFormulaSettings>;
  readonly steepness: number;
  readonly stepGlitchWindows: readonly ({ endX: number; isPresent: boolean; startX: number } | undefined)[];
}

export interface GraphwarWasmStepGlitchOwnedTrajectory {
  readonly acceptedSamplePointCount: number;
  readonly bisectionCount: number;
  readonly blockedPoint?: GraphPoint;
  readonly currentPoint: GraphPoint;
  readonly currentDy: number;
  readonly finalAcceptedSamplePointCount: number;
  readonly finalBisectionCount: number;
  readonly finalRk4StepCount: number;
  readonly obstacleHitIndex: number;
  readonly pathError?: number;
  readonly pointDys: readonly number[];
  readonly points: readonly GraphPoint[];
  readonly previousPoint?: GraphPoint;
  readonly previousDy: number;
  readonly reachedRequiredTargetCount: number;
  readonly reachedTargetCount: number;
  readonly replayCount: number;
  readonly requiredTargetsHitIndex: number;
  readonly rk4StepCount: number;
  readonly sampleIndex: number;
  readonly stopReason: number;
  readonly targetHitIndex: number;
  readonly trackedTargetHitIndexes: readonly number[];
  readonly visiblePixels: readonly PixelPoint[];
}

export interface GraphwarWasmStepGlitchOwnedContinuation {
  readonly flags: number;
  readonly protection: readonly number[];
  readonly sampleIndex: number;
}

export type GraphwarWasmStepGlitchOwnedFinalValidation =
  | { type: "none" }
  | {
      simulationMaskCacheId: number;
      targetControlPoints: readonly PixelPoint[];
      trackedTargets: readonly GraphwarTrajectoryTargetCircle[];
      type: "validated";
    };

/**
 * Stable evidence copied from one successful replay. Pointer-bearing records are decoded while the arena is live;
 * callers only retain these owned values.
 */
export interface GraphwarWasmStepGlitchOwnedEvidence {
  readonly bytes: Uint8Array;
  readonly finalValidation: GraphwarWasmStepGlitchOwnedFinalValidation;
  /**
   * Canonical formula context proved by the production ABI. Prefix evidence is intentionally absent until the ABI
   * carries every prefix field it needs.
   */
  readonly formulaContext: GraphwarTrajectoryFormulaContext;
  readonly formulaInput: GraphwarWasmStepGlitchOwnedFormulaInput;
  readonly formulaLaunch: GraphwarWasmFormulaLaunchResult & { status: "success" };
  readonly formulaMaterials: CompiledGraphwarFormulaMaterials;
  readonly continuation?: GraphwarWasmStepGlitchOwnedContinuation;
  readonly path: readonly PixelPoint[];
  readonly pointerEncoding: "relative-to-evidence";
  readonly protection: readonly number[];
  readonly trackedTargetHitIndexes: readonly number[];
  readonly trajectory: GraphwarWasmStepGlitchOwnedTrajectory;
}

/** Raw production evidence is copied before the command mark is released and deeply decoded once. */
export interface GraphwarWasmStepGlitchRawEvidence {
  readonly bytes: Uint8Array;
  readonly magic: number;
  readonly owned: GraphwarWasmStepGlitchOwnedEvidence;
  readonly pointerEncoding: "relative-to-evidence";
  readonly version: number;
}

export interface GraphwarWasmStepGlitchRawResultBase {
  readonly acceptedPoint?: GraphPoint;
  readonly blockedPoint?: GraphPoint;
  readonly expandedStates: number;
  readonly reachedTargetCount: number;
  readonly status: "hit" | "invalid-input" | "miss" | "no-path" | "unsupported";
  readonly evidence?: GraphwarWasmStepGlitchRawEvidence;
}

export type GraphwarWasmStepGlitchRawScanOutput = GraphwarWasmStepGlitchRawResultBase;
export type GraphwarWasmStepGlitchRawReplayOutput = GraphwarWasmStepGlitchRawResultBase;

/** Maps the existing scanner options once; debug metrics and the TS-only mask index stay in the Worker shell. */
export function createGraphwarWasmStepGlitchContextInput(
  options: GraphwarStepGlitchPrefixOptions,
): GraphwarWasmStepGlitchContextInput {
  return {
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    formulaMode: options.formulaMode,
    prefixEvidence: options.prefixEvidence ? { evidence: options.prefixEvidence, type: "candidate" } : { type: "none" },
    prefixTarget: options.prefixTarget ? { target: options.prefixTarget, type: "target" } : { type: "none" },
    requiredTargets: options.requiredTargets ?? [],
    simulationBoundaryExpansion: Math.max(0, Math.floor(options.simulationBoundaryExpansion ?? 0)),
    simulationMask: options.simulationMask,
    sourcePath: options.sourcePath,
  };
}

/** Maps target options without splitting the optional final-validation identity. */
export function createGraphwarWasmStepGlitchScanCommandInput(
  target: GraphwarStepGlitchTargetOptions,
): Extract<GraphwarWasmStepGlitchCommandInput, { type: "scan" }> {
  return {
    finalValidation: target.finalValidation ? { ...target.finalValidation, type: "validate" } : { type: "none" },
    hitTarget: target.hitTarget,
    targetPoint: target.targetPoint,
    type: "scan",
  };
}

/** Packs every retained scanner dependency exactly once. */
export function packGraphwarWasmStepGlitchContextInput(
  arena: GraphwarWasmArenaMemorySource,
  input: GraphwarWasmStepGlitchContextInput,
  minimumPointer = 0,
): GraphwarWasmStepGlitchContextPackResult {
  if (!hasFiniteBounds(input.bounds) || !hasFiniteBoundsRect(input.boundsRect) || input.sourcePath.length === 0) {
    return { status: "invalid-input" };
  }
  if (input.formulaMode.contract.pathSearchPolicy.type !== "step-glitch") {
    return { status: "unsupported" };
  }
  const settings = input.formulaMode.settings;
  if (
    !isGraphwarTrajectoryFormulaSettings(settings) ||
    settings.algorithm !== "step" ||
    (settings.equation !== "dy" && settings.equation !== "ddy") ||
    settings.stepGlitchObstacleMask !== input.simulationMask
  ) {
    return { status: "invalid-input" };
  }
  if (
    !Number.isInteger(input.simulationBoundaryExpansion) ||
    input.simulationBoundaryExpansion < 0 ||
    input.simulationBoundaryExpansion > 0xffff_ffff
  ) {
    return { status: "invalid-input" };
  }
  if (
    !input.sourcePath.every(isGraphwarTrajectoryPoint) ||
    !targetsAreValid(input.requiredTargets) ||
    !isGraphwarPlaneMask(input.simulationMask)
  ) {
    return { status: "invalid-input" };
  }
  if (input.prefixTarget.type === "target" && !targetIsValid(input.prefixTarget.target)) {
    return { status: "invalid-input" };
  }

  const simulationMask = packGraphwarPlaneMask(arena, input.simulationMask, minimumPointer);
  const prefixTarget = input.prefixTarget.type === "target" ? input.prefixTarget.target : undefined;
  const contextValues = new Float64Array([
    input.bounds.minX,
    input.bounds.maxX,
    input.bounds.minY,
    input.bounds.maxY,
    input.boundsRect.x,
    input.boundsRect.y,
    input.boundsRect.width,
    input.boundsRect.height,
    input.simulationBoundaryExpansion,
    prefixTarget?.center.x ?? 0,
    prefixTarget?.center.y ?? 0,
    prefixTarget?.radius ?? 0,
    input.prefixTarget.type === "target" ? 1 : 0,
    graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
  ]);
  return {
    input: {
      formulaSettings: packFormulaSettings(arena, settings, { type: "context-mask" }, minimumPointer),
      prefixEvidence: packPrefixEvidence(arena, input.prefixEvidence, minimumPointer),
      requiredTargetRecords: packTargets(arena, input.requiredTargets, minimumPointer),
      simulationMask,
      sourcePath: packGraphwarWasmPointSoA(arena, input.sourcePath, minimumPointer),
      values: writeGraphwarWasmFloat64Values(arena, contextValues, minimumPointer),
    },
    status: "ready",
  };
}

function packGraphwarWasmStepGlitchFinalValidationDescriptor(
  runtime: GraphwarWasmKernelRuntime,
  finalValidation: GraphwarWasmPackedStepGlitchFinalValidation,
): GraphwarWasmMemorySlice {
  if (finalValidation.type === "none") {
    return { length: 0, pointer: 0 };
  }
  const pointer = runtime.reserveArena(STEP_GLITCH_FINAL_VALIDATION_BYTE_LENGTH, 4);
  const view = new DataView(runtime.buffer, pointer, STEP_GLITCH_FINAL_VALIDATION_BYTE_LENGTH);
  view.setUint32(0, finalValidation.targetControlPoints.x.pointer, true);
  view.setUint32(4, finalValidation.targetControlPoints.y.pointer, true);
  view.setUint32(8, finalValidation.targetControlPoints.length, true);
  view.setUint32(12, finalValidation.trackedTargetRecords.pointer, true);
  view.setUint32(16, finalValidation.trackedTargetRecords.length / 3, true);
  view.setUint32(20, finalValidation.simulationMaskCacheId, true);
  view.setUint32(24, 1, true);
  view.setUint32(28, 0, true);
  return { length: STEP_GLITCH_FINAL_VALIDATION_BYTE_LENGTH, pointer };
}

function decodeGraphwarWasmStepGlitchProductionRawResult(
  runtime: GraphwarWasmKernelRuntime,
  context: GraphwarWasmStepGlitchContextInput,
  command: GraphwarWasmStepGlitchCommandInput,
  resultPointer: number,
  outputMinimumPointer: number,
): GraphwarWasmStepGlitchRawResultBase {
  const range = validateGraphwarWasmMemoryRange(
    runtime,
    { length: 1, pointer: resultPointer },
    {
      alignment: 8,
      elementByteLength: STEP_GLITCH_PRODUCTION_RESULT_BYTE_LENGTH,
      minimumPointer: outputMinimumPointer,
    },
  );
  const view = new DataView(range.buffer, range.byteOffset, range.byteLength);
  if (view.getUint32(0, true) !== STEP_GLITCH_PRODUCTION_RESULT_MAGIC || view.getUint32(64, true) !== 0) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "Step-glitch production result header is invalid",
      "output",
    );
  }
  const statusValue = validateGraphwarWasmEnumValue(
    view.getUint32(4, true),
    [1, 2, 3, 4] as const,
    "stepGlitch.production.status",
  );
  const status =
    statusValue === 1
      ? "hit"
      : statusValue === 2
        ? command.type === "scan"
          ? "no-path"
          : "miss"
        : statusValue === 3
          ? "invalid-input"
          : "unsupported";
  const evidencePointer = view.getUint32(8, true);
  const evidenceByteLength = view.getUint32(12, true);
  const hasAcceptedPoint =
    validateGraphwarWasmEnumValue(view.getUint32(24, true), [0, 1] as const, "stepGlitch.production.acceptedFlag") ===
    1;
  if (hasAcceptedPoint !== (status === "hit")) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "Step-glitch production accepted-point presence disagrees with status",
      "output",
    );
  }
  if ((evidencePointer === 0) !== (evidenceByteLength === 0) || (status === "hit") !== (evidencePointer !== 0)) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "Step-glitch production evidence presence disagrees with status",
      "output",
    );
  }
  let evidence: GraphwarWasmStepGlitchRawEvidence | undefined;
  if (status === "hit") {
    if (evidenceByteLength < STEP_GLITCH_PRODUCTION_EVIDENCE_HEADER_BYTE_LENGTH) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Step-glitch production evidence is truncated",
        "output",
      );
    }
    const evidenceRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: evidenceByteLength, pointer: evidencePointer },
      { alignment: 8, elementByteLength: 1, minimumPointer: outputMinimumPointer },
    );
    const evidenceBytes = new Uint8Array(
      evidenceRange.buffer,
      evidenceRange.byteOffset,
      evidenceRange.byteLength,
    ).slice();
    const evidenceView = new DataView(evidenceBytes.buffer, evidenceBytes.byteOffset, evidenceBytes.byteLength);
    if (
      evidenceView.getUint32(0, true) !== STEP_GLITCH_PRODUCTION_EVIDENCE_MAGIC ||
      evidenceView.getUint32(4, true) !== STEP_GLITCH_PRODUCTION_EVIDENCE_VERSION ||
      evidenceView.getUint32(STEP_GLITCH_PRODUCTION_EVIDENCE_BYTE_LENGTH_OFFSET, true) !== evidenceByteLength
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Step-glitch production evidence header is invalid",
        "output",
      );
    }
    const owned = decodeGraphwarWasmStepGlitchOwnedEvidence(
      runtime,
      context,
      command,
      evidencePointer,
      evidenceByteLength,
      evidenceBytes,
      outputMinimumPointer,
    );
    evidence = {
      bytes: evidenceBytes,
      magic: STEP_GLITCH_PRODUCTION_EVIDENCE_MAGIC,
      owned,
      pointerEncoding: "relative-to-evidence",
      version: STEP_GLITCH_PRODUCTION_EVIDENCE_VERSION,
    };
  }
  const hasBlockedPoint =
    validateGraphwarWasmEnumValue(view.getUint32(28, true), [0, 1] as const, "stepGlitch.production.blockedFlag") === 1;
  const acceptedX = view.getFloat64(32, true);
  const acceptedY = view.getFloat64(40, true);
  const blockedX = view.getFloat64(48, true);
  const blockedY = view.getFloat64(56, true);
  if (hasAcceptedPoint && (!Number.isFinite(acceptedX) || !Number.isFinite(acceptedY))) {
    throw new GraphwarWasmAdapterError("invalid-session-state", "Step-glitch accepted point is non-finite", "output");
  }
  if (hasBlockedPoint && (!Number.isFinite(blockedX) || !Number.isFinite(blockedY))) {
    throw new GraphwarWasmAdapterError("invalid-session-state", "Step-glitch blocked point is non-finite", "output");
  }
  if (status === "hit" && evidence) {
    const evidenceView = new DataView(evidence.bytes.buffer, evidence.bytes.byteOffset, evidence.bytes.byteLength);
    const evidenceAcceptedX = productionEvidenceFinite(
      evidenceView.getFloat64(96, true),
      "stepGlitch.evidence.acceptedX",
    );
    const evidenceAcceptedY = productionEvidenceFinite(
      evidenceView.getFloat64(104, true),
      "stepGlitch.evidence.acceptedY",
    );
    if (!Object.is(evidenceAcceptedX, acceptedX) || !Object.is(evidenceAcceptedY, acceptedY)) {
      productionEvidenceFault("Step-glitch result accepted point differs from its evidence");
    }
    const acceptedPointMatches = evidence.owned.trajectory.points.some(
      (point) => Object.is(point.x, acceptedX) && Object.is(point.y, acceptedY),
    );
    if (!acceptedPointMatches) productionEvidenceFault("Step-glitch accepted point is absent from its trajectory");
    const evidenceBlockedX = evidenceView.getFloat64(112, true);
    const evidenceBlockedY = evidenceView.getFloat64(120, true);
    if (hasBlockedPoint) {
      if (
        !Number.isFinite(evidenceBlockedX) ||
        !Number.isFinite(evidenceBlockedY) ||
        !Object.is(evidenceBlockedX, blockedX) ||
        !Object.is(evidenceBlockedY, blockedY)
      ) {
        productionEvidenceFault("Step-glitch result blocked point differs from its evidence");
      }
    } else if (!Object.is(evidenceBlockedX, 0) || !Object.is(evidenceBlockedY, 0)) {
      productionEvidenceFault("Step-glitch evidence contains an unexpected blocked point");
    }
    const expectedReachedTargetCount =
      evidence.owned.trajectory.reachedTargetCount + evidence.owned.trajectory.reachedRequiredTargetCount;
    if (view.getUint32(20, true) !== expectedReachedTargetCount) {
      productionEvidenceFault("Step-glitch result target count differs from its evidence");
    }
  }
  return {
    ...(hasAcceptedPoint ? { acceptedPoint: createGraphPoint(acceptedX, acceptedY) } : {}),
    ...(hasBlockedPoint ? { blockedPoint: createGraphPoint(blockedX, blockedY) } : {}),
    expandedStates: validateGraphwarWasmU32(view.getUint32(16, true), "stepGlitch.production.expandedStates"),
    ...(evidence ? { evidence } : {}),
    reachedTargetCount: validateGraphwarWasmU32(view.getUint32(20, true), "stepGlitch.production.reachedTargetCount"),
    status,
  };
}

function productionEvidenceFault(message: string): never {
  throw new GraphwarWasmAdapterError("invalid-session-state", message, "output");
}

function checkedProductionEvidenceByteLength(count: number, stride: number, fieldName: string) {
  if (!Number.isSafeInteger(count) || count < 0 || count > 0xffff_ffff || count * stride > 0xffff_ffff) {
    productionEvidenceFault(`${fieldName} byte length overflows the WASM ABI`);
  }
  return count * stride;
}

function validateOwnedProductionEvidenceRange(
  runtime: GraphwarWasmKernelRuntime,
  evidencePointer: number,
  evidenceByteLength: number,
  pointer: number,
  byteLength: number,
  alignment: number,
  fieldName: string,
  minimumPointer: number,
) {
  if (byteLength === 0) {
    if (pointer !== 0) productionEvidenceFault(`${fieldName} has a pointer without a range`);
    return undefined;
  }
  if (pointer === 0 || pointer < evidencePointer || pointer + byteLength > evidencePointer + evidenceByteLength) {
    productionEvidenceFault(`${fieldName} escapes the owned evidence range`);
  }
  try {
    return validateGraphwarWasmMemoryRange(
      runtime,
      { length: byteLength, pointer },
      { alignment, elementByteLength: 1, minimumPointer },
    );
  } catch (error) {
    if (error instanceof GraphwarWasmAdapterError) {
      throw new GraphwarWasmAdapterError(error.code, `${fieldName}: ${error.message}`, "output");
    }
    throw error;
  }
}

function readOwnedProductionEvidenceFloat64Values(
  runtime: GraphwarWasmKernelRuntime,
  evidencePointer: number,
  evidenceByteLength: number,
  pointer: number,
  count: number,
  fieldName: string,
  minimumPointer: number,
) {
  const byteLength = checkedProductionEvidenceByteLength(count, Float64Array.BYTES_PER_ELEMENT, fieldName);
  const range = validateOwnedProductionEvidenceRange(
    runtime,
    evidencePointer,
    evidenceByteLength,
    pointer,
    byteLength,
    Float64Array.BYTES_PER_ELEMENT,
    fieldName,
    minimumPointer,
  );
  if (!range) return new Float64Array();
  return new Float64Array(range.buffer, range.byteOffset, count).slice();
}

function readOwnedProductionEvidenceUint32Values(
  runtime: GraphwarWasmKernelRuntime,
  evidencePointer: number,
  evidenceByteLength: number,
  pointer: number,
  count: number,
  fieldName: string,
  minimumPointer: number,
) {
  const byteLength = checkedProductionEvidenceByteLength(count, Uint32Array.BYTES_PER_ELEMENT, fieldName);
  const range = validateOwnedProductionEvidenceRange(
    runtime,
    evidencePointer,
    evidenceByteLength,
    pointer,
    byteLength,
    Uint32Array.BYTES_PER_ELEMENT,
    fieldName,
    minimumPointer,
  );
  if (!range) return new Uint32Array();
  return new Uint32Array(range.buffer, range.byteOffset, count).slice();
}

function readOwnedProductionEvidenceInt32Values(
  runtime: GraphwarWasmKernelRuntime,
  evidencePointer: number,
  evidenceByteLength: number,
  pointer: number,
  count: number,
  fieldName: string,
  minimumPointer: number,
) {
  const byteLength = checkedProductionEvidenceByteLength(count, Int32Array.BYTES_PER_ELEMENT, fieldName);
  const range = validateOwnedProductionEvidenceRange(
    runtime,
    evidencePointer,
    evidenceByteLength,
    pointer,
    byteLength,
    Int32Array.BYTES_PER_ELEMENT,
    fieldName,
    minimumPointer,
  );
  if (!range) return new Int32Array();
  return new Int32Array(range.buffer, range.byteOffset, count).slice();
}

function readOwnedProductionEvidenceBytes(
  runtime: GraphwarWasmKernelRuntime,
  evidencePointer: number,
  evidenceByteLength: number,
  pointer: number,
  byteLength: number,
  fieldName: string,
  minimumPointer: number,
) {
  const range = validateOwnedProductionEvidenceRange(
    runtime,
    evidencePointer,
    evidenceByteLength,
    pointer,
    byteLength,
    1,
    fieldName,
    minimumPointer,
  );
  return range ? new Uint8Array(range.buffer, range.byteOffset, byteLength).slice() : new Uint8Array();
}

function productionEvidenceFinite(value: number, fieldName: string) {
  if (!Number.isFinite(value)) productionEvidenceFault(`${fieldName} is not finite`);
  return value;
}

function productionEvidenceValue<T>(values: ArrayLike<T>, index: number, fieldName: string): T {
  const value = values[index];
  if (value === undefined) productionEvidenceFault(`${fieldName} is missing`);
  return value;
}

function productionEvidencePointsEqual(left: readonly GraphPoint[], right: readonly GraphPoint[]) {
  return (
    left.length === right.length &&
    left.every((point, index) => {
      const other = right[index];
      return other !== undefined && Object.is(point.x, other.x) && Object.is(point.y, other.y);
    })
  );
}

function productionEvidencePixelsEqual(left: readonly PixelPoint[], right: readonly PixelPoint[]) {
  return (
    left.length === right.length &&
    left.every((point, index) => {
      const other = right[index];
      return other !== undefined && Object.is(point.x, other.x) && Object.is(point.y, other.y);
    })
  );
}

function productionEvidenceTargetHit(pixel: PixelPoint, target: GraphwarTrajectoryTargetCircle) {
  const dx = pixel.x - target.center.x;
  const dy = pixel.y - target.center.y;
  return dx * dx + dy * dy < target.radius * target.radius;
}

function productionEvidenceDecodeTargetRecords(
  values: readonly number[],
  fieldName: string,
): GraphwarTrajectoryTargetCircle[] {
  if (values.length % 3 !== 0) productionEvidenceFault(`${fieldName} has a partial target record`);
  const targets: GraphwarTrajectoryTargetCircle[] = [];
  for (let index = 0; index < values.length; index += 3) {
    const center = createPixelPoint(
      productionEvidenceFinite(
        productionEvidenceValue(values, index, `${fieldName}[${index}].x`),
        `${fieldName}[${index}].x`,
      ),
      productionEvidenceFinite(
        productionEvidenceValue(values, index + 1, `${fieldName}[${index}].y`),
        `${fieldName}[${index}].y`,
      ),
    );
    const radius = productionEvidenceFinite(
      productionEvidenceValue(values, index + 2, `${fieldName}[${index}].radius`),
      `${fieldName}[${index}].radius`,
    );
    if (radius < 0) productionEvidenceFault(`${fieldName}[${index}].radius is negative`);
    targets.push({ center, radius });
  }
  return targets;
}

function productionEvidenceTargetSequencesEqual(
  left: readonly GraphwarTrajectoryTargetCircle[],
  right: readonly GraphwarTrajectoryTargetCircle[],
) {
  return (
    left.length === right.length &&
    left.every((target, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        Object.is(target.center.x, other.center.x) &&
        Object.is(target.center.y, other.center.y) &&
        Object.is(target.radius, other.radius)
      );
    })
  );
}

function productionEvidenceUint32ArraysEqual(left: readonly number[], right: readonly number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateOwnedProductionWindowIdentity(
  command: GraphwarWasmStepGlitchCommandInput,
  windows: readonly ({ endX: number; isPresent: boolean; startX: number } | undefined)[],
  segmentCount: number,
  flags: number,
) {
  if (command.type !== "replay") return;
  const commandWindows = command.windows ?? { type: "automatic" as const };
  const hasFixedWindows = (flags & FORMULA_FLAG_STEP_GLITCH_FIXED_WINDOWS) !== 0;
  if (commandWindows.type === "automatic") {
    if (hasFixedWindows || windows.some((window) => window !== undefined)) {
      productionEvidenceFault("Automatic replay evidence carries fixed Step-glitch windows");
    }
    return;
  }
  if (!hasFixedWindows || commandWindows.segments.length !== segmentCount || windows.length !== segmentCount) {
    productionEvidenceFault("Explicit replay evidence window identity has an invalid segment count");
  }
  for (let index = 0; index < segmentCount; index += 1) {
    const expected = commandWindows.segments[index];
    const actual = windows[index];
    if (expected === undefined) {
      if (actual !== undefined && (actual.isPresent || !Object.is(actual.startX, 0) || !Object.is(actual.endX, 0))) {
        productionEvidenceFault(`Explicit replay evidence absent window ${index} is not canonical`);
      }
      continue;
    }
    if (
      actual === undefined ||
      !actual.isPresent ||
      !Object.is(actual.startX, expected.startX) ||
      !Object.is(actual.endX, expected.endX)
    ) {
      productionEvidenceFault(`Explicit replay evidence window ${index} differs from the command`);
    }
  }
}

function productionEvidenceRewriteRelativePointer(
  bytes: Uint8Array,
  evidencePointer: number,
  evidenceByteLength: number,
  recordOffset: number,
  fieldOffset: number,
  pointer: number,
  fieldName: string,
) {
  if (pointer === 0) {
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(recordOffset + fieldOffset, 0, true);
    return;
  }
  if (pointer < evidencePointer || pointer >= evidencePointer + evidenceByteLength) {
    productionEvidenceFault(`${fieldName} cannot be made evidence-relative`);
  }
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    recordOffset + fieldOffset,
    pointer - evidencePointer,
    true,
  );
}

function decodeGraphwarWasmStepGlitchOwnedEvidence(
  runtime: GraphwarWasmKernelRuntime,
  context: GraphwarWasmStepGlitchContextInput,
  command: GraphwarWasmStepGlitchCommandInput,
  evidencePointer: number,
  evidenceByteLength: number,
  evidenceBytes: Uint8Array,
  outputMinimumPointer: number,
): GraphwarWasmStepGlitchOwnedEvidence {
  const header = new DataView(runtime.buffer, evidencePointer, evidenceByteLength);
  const pathCount = validateGraphwarWasmU32(header.getUint32(20, true), "stepGlitch.evidence.pathCount");
  const pointCount = validateGraphwarWasmU32(header.getUint32(36, true), "stepGlitch.evidence.pointCount");
  const visibleCount = validateGraphwarWasmU32(header.getUint32(48, true), "stepGlitch.evidence.visibleCount");
  const protectionCount = validateGraphwarWasmU32(header.getUint32(56, true), "stepGlitch.evidence.protectionCount");
  if (pathCount < 2 || pointCount === 0 || visibleCount === 0) {
    productionEvidenceFault("Step-glitch evidence has an empty physical range");
  }
  if (protectionCount !== pathCount - 1) {
    productionEvidenceFault("Step-glitch evidence protection count differs from the source path");
  }
  const pathXs = readOwnedProductionEvidenceFloat64Values(
    runtime,
    evidencePointer,
    evidenceByteLength,
    header.getUint32(12, true),
    pathCount,
    "stepGlitch.evidence.pathX",
    outputMinimumPointer,
  );
  const pathYs = readOwnedProductionEvidenceFloat64Values(
    runtime,
    evidencePointer,
    evidenceByteLength,
    header.getUint32(16, true),
    pathCount,
    "stepGlitch.evidence.pathY",
    outputMinimumPointer,
  );
  const path = Array.from({ length: pathCount }, (_value, index) =>
    createPixelPoint(
      productionEvidenceFinite(
        productionEvidenceValue(pathXs, index, `stepGlitch.evidence.path[${index}].x`),
        `stepGlitch.evidence.path[${index}].x`,
      ),
      productionEvidenceFinite(
        productionEvidenceValue(pathYs, index, `stepGlitch.evidence.path[${index}].y`),
        `stepGlitch.evidence.path[${index}].y`,
      ),
    ),
  );
  const pointXs = readOwnedProductionEvidenceFloat64Values(
    runtime,
    evidencePointer,
    evidenceByteLength,
    header.getUint32(24, true),
    pointCount,
    "stepGlitch.evidence.pointX",
    outputMinimumPointer,
  );
  const pointYs = readOwnedProductionEvidenceFloat64Values(
    runtime,
    evidencePointer,
    evidenceByteLength,
    header.getUint32(28, true),
    pointCount,
    "stepGlitch.evidence.pointY",
    outputMinimumPointer,
  );
  const pointDys = readOwnedProductionEvidenceFloat64Values(
    runtime,
    evidencePointer,
    evidenceByteLength,
    header.getUint32(32, true),
    pointCount,
    "stepGlitch.evidence.pointDy",
    outputMinimumPointer,
  );
  for (let index = 0; index < pointDys.length; index += 1) {
    productionEvidenceFinite(
      productionEvidenceValue(pointDys, index, `stepGlitch.evidence.pointDy[${index}]`),
      `stepGlitch.evidence.pointDy[${index}]`,
    );
  }
  const points = Array.from({ length: pointCount }, (_value, index) =>
    createGraphPoint(
      productionEvidenceFinite(
        productionEvidenceValue(pointXs, index, `stepGlitch.evidence.points[${index}].x`),
        `stepGlitch.evidence.points[${index}].x`,
      ),
      productionEvidenceFinite(
        productionEvidenceValue(pointYs, index, `stepGlitch.evidence.points[${index}].y`),
        `stepGlitch.evidence.points[${index}].y`,
      ),
    ),
  );
  const visibleXs = readOwnedProductionEvidenceFloat64Values(
    runtime,
    evidencePointer,
    evidenceByteLength,
    header.getUint32(40, true),
    visibleCount,
    "stepGlitch.evidence.visibleX",
    outputMinimumPointer,
  );
  const visibleYs = readOwnedProductionEvidenceFloat64Values(
    runtime,
    evidencePointer,
    evidenceByteLength,
    header.getUint32(44, true),
    visibleCount,
    "stepGlitch.evidence.visibleY",
    outputMinimumPointer,
  );
  const visiblePixels = Array.from({ length: visibleCount }, (_value, index) =>
    createPixelPoint(
      productionEvidenceFinite(
        productionEvidenceValue(visibleXs, index, `stepGlitch.evidence.visiblePixels[${index}].x`),
        `stepGlitch.evidence.visiblePixels[${index}].x`,
      ),
      productionEvidenceFinite(
        productionEvidenceValue(visibleYs, index, `stepGlitch.evidence.visiblePixels[${index}].y`),
        `stepGlitch.evidence.visiblePixels[${index}].y`,
      ),
    ),
  );
  if (visibleCount !== pointCount) productionEvidenceFault("Step-glitch evidence visible count differs from points");
  for (let index = 0; index < pointCount; index += 1) {
    const expected = graphToImagePoint(
      productionEvidenceValue(points, index, `stepGlitch.evidence.points[${index}]`),
      context.bounds,
      context.boundsRect,
    );
    if (
      !pixelPointsEqual(
        expected,
        productionEvidenceValue(visiblePixels, index, `stepGlitch.evidence.visiblePixels[${index}]`),
      )
    ) {
      productionEvidenceFault(`Step-glitch evidence visible point ${index} differs from its physical point`);
    }
    if (context.formulaMode.settings.equation !== "ddy" && !Object.is(pointDys[index], 0)) {
      productionEvidenceFault("First-order Step-glitch evidence contains second-order point state");
    }
  }
  const protection = [
    ...readOwnedProductionEvidenceUint32Values(
      runtime,
      evidencePointer,
      evidenceByteLength,
      header.getUint32(52, true),
      protectionCount,
      "stepGlitch.evidence.protection",
      outputMinimumPointer,
    ),
  ];
  for (let index = 0; index < protection.length; index += 1) {
    validateGraphwarWasmProtectionBits(
      productionEvidenceValue(protection, index, `evidence.protection[${index}]`),
      ALLOWED_SIGN_PROTECTION_BITS,
      `evidence.protection[${index}]`,
    );
  }

  const formulaInputPointer = header.getUint32(60, true);
  const formulaInputLength = header.getUint32(64, true);
  if (formulaInputLength !== FORMULA_INPUT_BYTE_LENGTH) {
    productionEvidenceFault("Step-glitch evidence formula input has an invalid byte length");
  }
  validateOwnedProductionEvidenceRange(
    runtime,
    evidencePointer,
    evidenceByteLength,
    formulaInputPointer,
    formulaInputLength,
    8,
    "stepGlitch.evidence.formulaInput",
    outputMinimumPointer,
  );
  const formulaInput = new DataView(runtime.buffer, formulaInputPointer, formulaInputLength);
  if (
    formulaInput.getInt32(FORMULA_INPUT_ALGORITHM_OFFSET, true) !== FORMULA_ALGORITHM_STEP ||
    formulaInput.getUint32(FORMULA_INPUT_POINT_COUNT_OFFSET, true) !== pathCount ||
    formulaInput.getUint32(FORMULA_INPUT_SIGN_PROTECTION_COUNT_OFFSET, true) !== protectionCount ||
    formulaInput.getUint32(FORMULA_INPUT_SIGN_PROTECTION_POINTER_OFFSET, true) !== header.getUint32(52, true)
  ) {
    productionEvidenceFault("Step-glitch evidence formula input does not match its enclosing ranges");
  }
  const formulaInputPointsX = readOwnedProductionEvidenceFloat64Values(
    runtime,
    evidencePointer,
    evidenceByteLength,
    formulaInput.getUint32(FORMULA_INPUT_POINT_X_POINTER_OFFSET, true),
    pathCount,
    "stepGlitch.evidence.formulaInput.pointsX",
    outputMinimumPointer,
  );
  const formulaInputPointsY = readOwnedProductionEvidenceFloat64Values(
    runtime,
    evidencePointer,
    evidenceByteLength,
    formulaInput.getUint32(FORMULA_INPUT_POINT_Y_POINTER_OFFSET, true),
    pathCount,
    "stepGlitch.evidence.formulaInput.pointsY",
    outputMinimumPointer,
  );
  const formulaInputPoints = Array.from({ length: pathCount }, (_value, index) =>
    createGraphPoint(
      productionEvidenceFinite(
        productionEvidenceValue(formulaInputPointsX, index, `formulaInput.points[${index}].x`),
        `formulaInput.points[${index}].x`,
      ),
      productionEvidenceFinite(
        productionEvidenceValue(formulaInputPointsY, index, `formulaInput.points[${index}].y`),
        `formulaInput.points[${index}].y`,
      ),
    ),
  );
  const expectedFormulaInputPoints = path.map((point) => imageToGraphPoint(point, context.bounds, context.boundsRect));
  if (!productionEvidencePointsEqual(formulaInputPoints, expectedFormulaInputPoints)) {
    productionEvidenceFault("Step-glitch evidence formula input path differs from the copied candidate path");
  }
  if (!productionEvidencePixelsEqual(path.slice(0, context.sourcePath.length), context.sourcePath)) {
    productionEvidenceFault("Step-glitch evidence source path identity differs from the retained context");
  }
  const equationValue = formulaInput.getInt32(FORMULA_INPUT_EQUATION_OFFSET, true);
  const equation =
    equationValue === FORMULA_EQUATION_DY ? "dy" : equationValue === FORMULA_EQUATION_DDY ? "ddy" : undefined;
  if (!equation || context.formulaMode.settings.equation !== equation) {
    productionEvidenceFault("Step-glitch evidence equation differs from the retained Formula Mode");
  }
  const decimalPlaces = formulaInput.getInt32(FORMULA_INPUT_DECIMAL_PLACES_OFFSET, true);
  const steepness = productionEvidenceFinite(
    formulaInput.getFloat64(FORMULA_INPUT_STEEPNESS_OFFSET, true),
    "formulaInput.steepness",
  );
  const formulaPathSteepness = productionEvidenceFinite(
    formulaInput.getFloat64(FORMULA_INPUT_PATH_STEEPNESS_OFFSET, true),
    "formulaInput.formulaPathSteepness",
  );
  const flags = formulaInput.getUint32(FORMULA_INPUT_FLAGS_OFFSET, true);
  if (
    (flags &
      ~(
        FORMULA_FLAG_STEP_OVERFLOW_PROTECTION |
        FORMULA_FLAG_DISPLAY_ROUNDED_ANGLE |
        FORMULA_FLAG_STEP_GLITCH_MODE |
        FORMULA_FLAG_STEP_GLITCH_FIXED_WINDOWS
      )) !==
    0
  ) {
    productionEvidenceFault("Step-glitch evidence formula input contains unsupported flags");
  }
  const expectedSettings = context.formulaMode.settings;
  if (
    decimalPlaces !== expectedSettings.decimalPlaces ||
    !Object.is(steepness, expectedSettings.steepness) ||
    !Object.is(formulaPathSteepness, expectedSettings.formulaPathSteepness ?? expectedSettings.steepness) ||
    ((flags & FORMULA_FLAG_STEP_GLITCH_MODE) !== 0) !== expectedSettings.isStepGlitchModeEnabled ||
    ((flags & FORMULA_FLAG_STEP_OVERFLOW_PROTECTION) !== 0) !== expectedSettings.isStepOverflowProtectionEnabled ||
    ((flags & FORMULA_FLAG_DISPLAY_ROUNDED_ANGLE) !== 0) !==
      (equation === "ddy" && expectedSettings.secondOrderLaunchAngleMode === "display-rounded")
  ) {
    productionEvidenceFault("Step-glitch evidence formula settings differ from the retained Formula Mode");
  }
  for (const [offset, expected] of [
    [FORMULA_INPUT_BOUNDS_MIN_X_OFFSET, context.bounds.minX],
    [FORMULA_INPUT_BOUNDS_MAX_X_OFFSET, context.bounds.maxX],
    [FORMULA_INPUT_BOUNDS_MIN_Y_OFFSET, context.bounds.minY],
    [FORMULA_INPUT_BOUNDS_MAX_Y_OFFSET, context.bounds.maxY],
  ] as const) {
    if (!Object.is(formulaInput.getFloat64(offset, true), expected)) {
      productionEvidenceFault("Step-glitch evidence bounds identity differs from the retained context");
    }
  }
  const formulaMaskPointer = formulaInput.getUint32(FORMULA_INPUT_MASK_POINTER_OFFSET, true);
  const formulaMaskLength = formulaInput.getUint32(FORMULA_INPUT_MASK_BYTE_LENGTH_OFFSET, true);
  if (formulaMaskLength !== context.simulationMask.length) {
    productionEvidenceFault("Step-glitch evidence mask length differs from the retained context");
  }
  const formulaMask = readOwnedProductionEvidenceBytes(
    runtime,
    evidencePointer,
    evidenceByteLength,
    formulaMaskPointer,
    formulaMaskLength,
    "stepGlitch.evidence.formulaInput.mask",
    outputMinimumPointer,
  );
  if (!graphwarByteArraysEqual(formulaMask, context.simulationMask)) {
    productionEvidenceFault("Step-glitch evidence mask identity differs from the retained context");
  }
  const overflowPointer = formulaInput.getUint32(FORMULA_INPUT_STEP_OVERFLOW_RANGE_POINTER_OFFSET, true);
  const overflowCount = formulaInput.getUint32(FORMULA_INPUT_STEP_OVERFLOW_RANGE_COUNT_OFFSET, true);
  if ((overflowPointer === 0) !== (overflowCount === 0)) {
    productionEvidenceFault("Step-glitch evidence overflow range is a half-state");
  }
  const overflowValues = readOwnedProductionEvidenceFloat64Values(
    runtime,
    evidencePointer,
    evidenceByteLength,
    overflowPointer,
    overflowPointer === 0 ? 0 : overflowCount,
    "stepGlitch.evidence.formulaInput.overflowRange",
    outputMinimumPointer,
  );
  if (overflowPointer !== 0 && overflowCount !== 2)
    productionEvidenceFault("Step-glitch evidence overflow range count is invalid");
  const overflowProtectionRange =
    overflowPointer === 0
      ? undefined
      : {
          maxX: productionEvidenceFinite(
            productionEvidenceValue(overflowValues, 1, "formulaInput.overflowRange.maxX"),
            "formulaInput.overflowRange.maxX",
          ),
          minX: productionEvidenceFinite(
            productionEvidenceValue(overflowValues, 0, "formulaInput.overflowRange.minX"),
            "formulaInput.overflowRange.minX",
          ),
        };
  const segmentCount = pathCount - 1;
  const glitchPointer = formulaInput.getUint32(FORMULA_INPUT_GLITCH_SEGMENT_POINTER_OFFSET, true);
  const hasFixedWindows = (flags & FORMULA_FLAG_STEP_GLITCH_FIXED_WINDOWS) !== 0;
  const glitchValues = readOwnedProductionEvidenceBytes(
    runtime,
    evidencePointer,
    evidenceByteLength,
    glitchPointer,
    hasFixedWindows
      ? checkedProductionEvidenceByteLength(
          segmentCount,
          STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH,
          "formulaInput.glitchWindows",
        )
      : 0,
    "stepGlitch.evidence.formulaInput.glitchWindows",
    outputMinimumPointer,
  );
  const glitchView = new DataView(glitchValues.buffer, glitchValues.byteOffset, glitchValues.byteLength);
  const stepGlitchWindows = Array.from({ length: segmentCount }, (_value, index) => {
    if (!hasFixedWindows) return undefined;
    const offset = index * STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH;
    const presence = glitchView.getUint32(offset, true);
    if (presence > 1) productionEvidenceFault("Step-glitch evidence window presence is invalid");
    const isPresent = presence === 1;
    if (glitchView.getUint32(offset + 4, true) !== 0)
      productionEvidenceFault("Step-glitch evidence window has a nonzero reserved field");
    const startX = glitchView.getFloat64(offset + 8, true);
    const endX = glitchView.getFloat64(offset + 16, true);
    if (isPresent && (!Number.isFinite(startX) || !Number.isFinite(endX) || !(endX > startX))) {
      productionEvidenceFault(`Step-glitch evidence window ${index} is invalid`);
    }
    if (!isPresent && (!Object.is(startX, 0) || !Object.is(endX, 0))) {
      productionEvidenceFault(`Step-glitch evidence absent window ${index} contains values`);
    }
    return { endX, isPresent, startX };
  });
  validateOwnedProductionWindowIdentity(command, stepGlitchWindows, segmentCount, flags);

  const formulaPointCount = validateGraphwarWasmU32(
    header.getUint32(264, true),
    "stepGlitch.evidence.formulaPointCount",
  );
  if (formulaPointCount !== pathCount) {
    productionEvidenceFault("Step-glitch evidence formula point count differs from the source path");
  }
  const formulaPointXPointer = header.getUint32(256, true);
  const formulaPointYPointer = header.getUint32(260, true);
  const formulaPointXs = readOwnedProductionEvidenceFloat64Values(
    runtime,
    evidencePointer,
    evidenceByteLength,
    formulaPointXPointer,
    formulaPointCount,
    "stepGlitch.evidence.formulaPointX",
    outputMinimumPointer,
  );
  const formulaPointYs = readOwnedProductionEvidenceFloat64Values(
    runtime,
    evidencePointer,
    evidenceByteLength,
    formulaPointYPointer,
    formulaPointCount,
    "stepGlitch.evidence.formulaPointY",
    outputMinimumPointer,
  );
  const formulaLaunchPointer = header.getUint32(68, true);
  const formulaLaunchLength = header.getUint32(72, true);
  const formulaMaterialResultPointer = header.getUint32(76, true);
  const formulaMaterialResultLength = header.getUint32(80, true);
  if (
    formulaPointCount < 2 ||
    formulaLaunchLength !== FORMULA_LAUNCH_RESULT_BYTE_LENGTH ||
    formulaMaterialResultLength !== FORMULA_RESULT_BYTE_LENGTH
  ) {
    productionEvidenceFault("Step-glitch evidence formula result ranges are incomplete");
  }
  validateOwnedProductionEvidenceRange(
    runtime,
    evidencePointer,
    evidenceByteLength,
    formulaLaunchPointer,
    formulaLaunchLength,
    8,
    "stepGlitch.evidence.launchResult",
    outputMinimumPointer,
  );
  validateOwnedProductionEvidenceRange(
    runtime,
    evidencePointer,
    evidenceByteLength,
    formulaMaterialResultPointer,
    formulaMaterialResultLength,
    8,
    "stepGlitch.evidence.materialResult",
    outputMinimumPointer,
  );
  const launchView = new DataView(runtime.buffer, formulaLaunchPointer, formulaLaunchLength);
  const materialResultView = new DataView(runtime.buffer, formulaMaterialResultPointer, formulaMaterialResultLength);
  if (
    launchView.getInt32(FORMULA_LAUNCH_RESULT_STATUS_OFFSET, true) !== 1 ||
    launchView.getUint32(FORMULA_LAUNCH_RESULT_FORMULA_POINT_COUNT_OFFSET, true) !== formulaPointCount ||
    launchView.getUint32(FORMULA_LAUNCH_RESULT_FORMULA_POINT_X_POINTER_OFFSET, true) !== formulaPointXPointer ||
    launchView.getUint32(FORMULA_LAUNCH_RESULT_FORMULA_POINT_Y_POINTER_OFFSET, true) !== formulaPointYPointer ||
    launchView.getUint32(FORMULA_LAUNCH_RESULT_MATERIAL_RESULT_POINTER_OFFSET, true) !== formulaMaterialResultPointer ||
    launchView.getUint32(FORMULA_LAUNCH_RESULT_PROTECTION_POINTER_OFFSET, true) !== header.getUint32(52, true) ||
    launchView.getUint32(FORMULA_LAUNCH_RESULT_PROTECTION_COUNT_OFFSET, true) !== protectionCount
  ) {
    productionEvidenceFault("Step-glitch evidence launch result does not match its enclosing records");
  }
  if (
    materialResultView.getUint32(FORMULA_RESULT_MATERIAL_POINTER_OFFSET, true) === 0 ||
    materialResultView.getUint32(FORMULA_RESULT_PROTECTION_POINTER_OFFSET, true) !== header.getUint32(52, true) ||
    materialResultView.getUint32(FORMULA_RESULT_PROTECTION_COUNT_OFFSET, true) !== protectionCount
  ) {
    productionEvidenceFault("Step-glitch evidence material result does not match its protection range");
  }
  const formulaLaunch = readGraphwarWasmFormulaLaunchResultForStepGlitchTest(
    runtime,
    expectedSettings,
    formulaPointCount,
    formulaLaunchPointer,
    outputMinimumPointer,
  );
  if (formulaLaunch.status !== "success")
    productionEvidenceFault("Step-glitch evidence contains an invalid launch result");
  if (
    !productionEvidencePointsEqual(
      formulaLaunch.formulaPoints,
      pointsFromFloatArrays(Array.from(formulaPointXs), Array.from(formulaPointYs)),
    )
  ) {
    productionEvidenceFault("Step-glitch evidence formula points differ from the launch result");
  }
  if (!productionEvidenceUint32ArraysEqual(formulaLaunch.observedSignProtection, protection)) {
    productionEvidenceFault("Step-glitch evidence launch protection differs from trajectory protection");
  }

  const finalValidationPointer = header.getUint32(240, true);
  const finalValidationLength = header.getUint32(244, true);
  const finalValidation = decodeOwnedProductionFinalValidation(
    runtime,
    command,
    evidencePointer,
    evidenceByteLength,
    finalValidationPointer,
    finalValidationLength,
    outputMinimumPointer,
  );
  const trackedTargetHitIndexes = [
    ...readOwnedProductionEvidenceInt32Values(
      runtime,
      evidencePointer,
      evidenceByteLength,
      header.getUint32(276, true),
      validateGraphwarWasmU32(header.getUint32(280, true), "stepGlitch.evidence.trackedHitCount"),
      "stepGlitch.evidence.trackedHitIndexes",
      outputMinimumPointer,
    ),
  ];
  for (const value of trackedTargetHitIndexes) {
    if (value < -1 || value >= pointCount)
      productionEvidenceFault("Step-glitch evidence tracked hit index is outside points");
  }
  const expectedTrackedTargetCount = finalValidation.type === "validated" ? finalValidation.trackedTargets.length : 0;
  if (trackedTargetHitIndexes.length !== expectedTrackedTargetCount) {
    productionEvidenceFault("Step-glitch evidence tracked target count differs from final validation");
  }
  const trajectory = decodeOwnedProductionTrajectory(
    header,
    path,
    points,
    [...pointDys],
    visiblePixels,
    trackedTargetHitIndexes,
    context.formulaMode.settings.equation,
    context,
    command,
  );
  if (command.type === "replay") {
    if (!productionEvidencePixelsEqual(path, command.path))
      productionEvidenceFault("Replay evidence path differs from the command path");
  } else if (!productionEvidencePixelsEqual(path.slice(0, context.sourcePath.length), context.sourcePath)) {
    productionEvidenceFault("Scan evidence path does not retain its source path prefix");
  }
  validateOwnedProductionTargetIdentity(command, context, visiblePixels, trajectory);

  const formulaSettings = {
    ...expectedSettings,
    ...(formulaMask.length > 0 ? { stepGlitchObstacleMask: formulaMask.slice() } : {}),
  };
  const formulaEvaluation: FormulaEvaluationOptions = {
    equation,
    formulaDecimalPlaces: decimalPlaces,
    isStepOverflowProtectionEnabled: formulaSettings.isStepOverflowProtectionEnabled,
    signProtection: [...protection],
    ...(overflowProtectionRange ? { stepOverflowProtectionRange: overflowProtectionRange } : {}),
  };
  const formulaContext = {
    compiledMaterials: formulaLaunch.compiledMaterials,
    formulaEvaluation,
    formulaPoints: formulaLaunch.formulaPoints.map((point) => createGraphPoint(point.x, point.y)),
    formulaResult: buildFormula(
      formulaLaunch.formulaPoints,
      formulaSettings.steepness,
      formulaSettings.equation,
      formulaSettings.algorithm,
      formulaSettings.decimalPlaces,
      {
        compiledMaterials: formulaLaunch.compiledMaterials,
        isStepOverflowProtectionEnabled: formulaSettings.isStepOverflowProtectionEnabled,
        ...(overflowProtectionRange ? { stepOverflowProtectionRange: overflowProtectionRange } : {}),
        signProtection: [...protection],
      },
    ),
    ...(formulaLaunch.launch.equation === "y" ? {} : { launchAngleRadians: formulaLaunch.launch.angleRadians }),
    settings: formulaSettings,
    signProtection: [...protection],
    soldierCenter: createGraphPoint(
      productionEvidenceFinite(
        formulaInput.getFloat64(FORMULA_INPUT_SOLDIER_X_OFFSET, true),
        "formulaInput.soldierCenter.x",
      ),
      productionEvidenceFinite(
        formulaInput.getFloat64(FORMULA_INPUT_SOLDIER_Y_OFFSET, true),
        "formulaInput.soldierCenter.y",
      ),
    ),
  } satisfies GraphwarTrajectoryFormulaContext;

  const continuation = decodeOwnedProductionContinuation(
    runtime,
    evidencePointer,
    evidenceByteLength,
    header,
    protection,
    outputMinimumPointer,
    trajectory,
    context.formulaMode.settings.equation,
    trajectory.stopReason,
  );
  rewriteProductionEvidencePointersRelativeToBase(
    evidenceBytes,
    evidencePointer,
    evidenceByteLength,
    header,
    formulaInputPointer,
    formulaLaunchPointer,
    formulaMaterialResultPointer,
    finalValidationPointer,
  );
  return {
    bytes: evidenceBytes,
    finalValidation,
    formulaContext,
    formulaInput: {
      bounds: {
        maxX: formulaInput.getFloat64(FORMULA_INPUT_BOUNDS_MAX_X_OFFSET, true),
        maxY: formulaInput.getFloat64(FORMULA_INPUT_BOUNDS_MAX_Y_OFFSET, true),
        minX: formulaInput.getFloat64(FORMULA_INPUT_BOUNDS_MIN_X_OFFSET, true),
        minY: formulaInput.getFloat64(FORMULA_INPUT_BOUNDS_MIN_Y_OFFSET, true),
      },
      equation,
      flags,
      formulaPathSteepness,
      mask: formulaMask,
      ...(overflowProtectionRange ? { overflowProtectionRange } : {}),
      points: formulaInputPoints,
      settings: formulaSettings,
      steepness,
      stepGlitchWindows,
    },
    formulaLaunch,
    formulaMaterials: formulaLaunch.compiledMaterials,
    path,
    pointerEncoding: "relative-to-evidence",
    protection,
    ...(continuation ? { continuation } : {}),
    trackedTargetHitIndexes,
    trajectory,
  };
}

function pointsFromFloatArrays(xs: readonly number[], ys: readonly number[]) {
  if (xs.length !== ys.length) productionEvidenceFault("Formula point arrays have different lengths");
  return Array.from(xs, (x, index) =>
    createGraphPoint(x, productionEvidenceValue(ys, index, `formulaPoints[${index}].y`)),
  );
}

function decodeOwnedProductionFinalValidation(
  runtime: GraphwarWasmKernelRuntime,
  command: GraphwarWasmStepGlitchCommandInput,
  evidencePointer: number,
  evidenceByteLength: number,
  pointer: number,
  byteLength: number,
  outputMinimumPointer: number,
): GraphwarWasmStepGlitchOwnedFinalValidation {
  const expected = command.finalValidation;
  if (expected.type === "none") {
    if (pointer !== 0 || byteLength !== 0) productionEvidenceFault("Unexpected final-validation evidence");
    return { type: "none" };
  }
  if (byteLength !== STEP_GLITCH_FINAL_VALIDATION_BYTE_LENGTH)
    productionEvidenceFault("Final-validation evidence has an invalid byte length");
  validateOwnedProductionEvidenceRange(
    runtime,
    evidencePointer,
    evidenceByteLength,
    pointer,
    byteLength,
    4,
    "finalValidation",
    outputMinimumPointer,
  );
  const view = new DataView(runtime.buffer, pointer, byteLength);
  if (view.getUint32(24, true) !== 1 || view.getUint32(28, true) !== 0)
    productionEvidenceFault("Final-validation evidence flags are invalid");
  const targetCount = view.getUint32(8, true);
  const trackedCount = view.getUint32(16, true);
  const targetXs = readOwnedProductionEvidenceFloat64Values(
    runtime,
    evidencePointer,
    evidenceByteLength,
    view.getUint32(0, true),
    targetCount,
    "finalValidation.targetControlX",
    outputMinimumPointer,
  );
  const targetYs = readOwnedProductionEvidenceFloat64Values(
    runtime,
    evidencePointer,
    evidenceByteLength,
    view.getUint32(4, true),
    targetCount,
    "finalValidation.targetControlY",
    outputMinimumPointer,
  );
  const trackedValues = readOwnedProductionEvidenceFloat64Values(
    runtime,
    evidencePointer,
    evidenceByteLength,
    view.getUint32(12, true),
    trackedCount * 3,
    "finalValidation.trackedTargets",
    outputMinimumPointer,
  );
  const targetControlPoints = Array.from(targetXs, (x, index) =>
    createPixelPoint(
      productionEvidenceFinite(x, `finalValidation.targetControlPoints[${index}].x`),
      productionEvidenceFinite(
        productionEvidenceValue(targetYs, index, `finalValidation.targetControlPoints[${index}].y`),
        `finalValidation.targetControlPoints[${index}].y`,
      ),
    ),
  );
  const trackedTargets = productionEvidenceDecodeTargetRecords([...trackedValues], "finalValidation.trackedTargets");
  if (
    view.getUint32(20, true) !== expected.simulationMaskCacheId ||
    !productionEvidencePixelsEqual(targetControlPoints, expected.targetControlPoints) ||
    !productionEvidenceTargetSequencesEqual(trackedTargets, expected.trackedTargets)
  ) {
    productionEvidenceFault("Final-validation identity differs from the command input");
  }
  return { simulationMaskCacheId: view.getUint32(20, true), targetControlPoints, trackedTargets, type: "validated" };
}

function decodeOwnedProductionTrajectory(
  header: DataView,
  path: readonly PixelPoint[],
  points: readonly GraphPoint[],
  pointDys: readonly number[],
  visiblePixels: readonly PixelPoint[],
  trackedTargetHitIndexes: readonly number[],
  equation: "dy" | "ddy",
  context: GraphwarWasmStepGlitchContextInput,
  command: GraphwarWasmStepGlitchCommandInput,
): GraphwarWasmStepGlitchOwnedTrajectory {
  const stopReason = validateGraphwarWasmEnumValue(
    header.getInt32(128, true),
    [1, 2, 3, 4, 5, 6, 7] as const,
    "stepGlitch.evidence.stopReason",
  );
  if (stopReason === TRAJECTORY_STOP_REASON_TARGET) {
    productionEvidenceFault("Step-glitch evidence stopped on target completion without the required command flag");
  }
  const stateFlags = header.getUint32(236, true);
  if (
    (stateFlags &
      ~(
        TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_POINT |
        TRAJECTORY_EVIDENCE_FLAG_HAS_DY |
        TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_DY
      )) !==
    0
  ) {
    productionEvidenceFault("Step-glitch evidence state flags are invalid");
  }
  const hasPreviousPoint = (stateFlags & TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_POINT) !== 0;
  const hasDy = (stateFlags & TRAJECTORY_EVIDENCE_FLAG_HAS_DY) !== 0;
  const hasPreviousDy = (stateFlags & TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_DY) !== 0;
  const sampleIndex = header.getUint32(232, true);
  const expectedStateFlags =
    (sampleIndex > 0 ? TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_POINT : 0) |
    (equation === "ddy" ? TRAJECTORY_EVIDENCE_FLAG_HAS_DY : 0) |
    (equation === "ddy" && sampleIndex > 0 ? TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_DY : 0);
  if (stateFlags !== expectedStateFlags) {
    productionEvidenceFault("Step-glitch evidence state flags do not match its equation and sample index");
  }
  const currentDy = productionEvidenceFinite(header.getFloat64(200, true), "stepGlitch.evidence.currentDy");
  const previousDy = productionEvidenceFinite(header.getFloat64(224, true), "stepGlitch.evidence.previousDy");
  if (!hasDy && !Object.is(currentDy, 0)) {
    productionEvidenceFault("Step-glitch evidence contains a current derivative without its flag");
  }
  if (!hasPreviousDy && !Object.is(previousDy, 0)) {
    productionEvidenceFault("Step-glitch evidence contains an absent previous derivative");
  }
  if (
    !hasPreviousPoint &&
    (!Object.is(header.getFloat64(208, true), 0) || !Object.is(header.getFloat64(216, true), 0))
  ) {
    productionEvidenceFault("Step-glitch evidence contains an absent previous point");
  }
  const expectedSampleIndex = stopReason === TRAJECTORY_STOP_REASON_OUT_OF_BOUNDS ? points.length : points.length - 1;
  if (sampleIndex !== expectedSampleIndex) {
    productionEvidenceFault("Step-glitch evidence sample index does not match its published points");
  }
  const targetHitIndex = header.getInt32(132, true);
  const requiredTargetsHitIndex = header.getInt32(136, true);
  if (
    targetHitIndex < -1 ||
    targetHitIndex >= points.length ||
    requiredTargetsHitIndex < -1 ||
    requiredTargetsHitIndex >= points.length
  ) {
    productionEvidenceFault("Step-glitch evidence target hit index is outside points");
  }
  const rk4StepCount = header.getUint32(152, true);
  const bisectionCount = header.getUint32(156, true);
  const acceptedSamplePointCount = header.getUint32(164, true);
  const replayCount = header.getUint32(168, true);
  const finalRk4StepCount = header.getUint32(172, true);
  const finalBisectionCount = header.getUint32(176, true);
  const finalAcceptedSamplePointCount = header.getUint32(180, true);
  if (
    finalRk4StepCount > rk4StepCount ||
    finalBisectionCount > bisectionCount ||
    finalAcceptedSamplePointCount > acceptedSamplePointCount
  ) {
    productionEvidenceFault("Step-glitch evidence final counters exceed aggregate counters");
  }
  if (replayCount < 1 || acceptedSamplePointCount < points.length || finalAcceptedSamplePointCount < points.length) {
    productionEvidenceFault("Step-glitch evidence counters do not cover its published points");
  }
  const currentPoint = createGraphPoint(
    productionEvidenceFinite(header.getFloat64(184, true), "stepGlitch.evidence.currentX"),
    productionEvidenceFinite(header.getFloat64(192, true), "stepGlitch.evidence.currentY"),
  );
  const previousPoint = hasPreviousPoint
    ? createGraphPoint(
        productionEvidenceFinite(header.getFloat64(208, true), "stepGlitch.evidence.previousX"),
        productionEvidenceFinite(header.getFloat64(216, true), "stepGlitch.evidence.previousY"),
      )
    : undefined;
  const lastPoint = points.at(-1);
  if (!lastPoint) productionEvidenceFault("Step-glitch evidence has no terminal point");
  const lastPointDy = pointDys.at(-1);
  if (lastPointDy === undefined) productionEvidenceFault("Step-glitch evidence has no terminal derivative");
  if (stopReason === TRAJECTORY_STOP_REASON_OUT_OF_BOUNDS) {
    if (
      !previousPoint ||
      !productionEvidencePointsEqual([previousPoint], [lastPoint]) ||
      (equation === "ddy" && !Object.is(previousDy, lastPointDy))
    ) {
      productionEvidenceFault("Out-of-bounds Step-glitch evidence does not retain its last published point");
    }
    const minX = Math.min(context.bounds.minX, context.bounds.maxX);
    const maxX = Math.max(context.bounds.minX, context.bounds.maxX);
    const minY = Math.min(context.bounds.minY, context.bounds.maxY);
    const maxY = Math.max(context.bounds.minY, context.bounds.maxY);
    if (currentPoint.x >= minX && currentPoint.x <= maxX && currentPoint.y >= minY && currentPoint.y <= maxY) {
      productionEvidenceFault("Out-of-bounds Step-glitch evidence retained an in-bounds state");
    }
  } else {
    if (!productionEvidencePointsEqual([currentPoint], [lastPoint])) {
      productionEvidenceFault("Step-glitch evidence terminal state differs from its last published point");
    }
    if (equation === "ddy" && !Object.is(currentDy, lastPointDy)) {
      productionEvidenceFault("Step-glitch evidence terminal derivative differs from its last published point");
    }
    if (points.length > 1) {
      const penultimatePoint = points[points.length - 2];
      const penultimateDy = pointDys[pointDys.length - 2];
      if (
        !previousPoint ||
        !penultimatePoint ||
        !productionEvidencePointsEqual([previousPoint], [penultimatePoint]) ||
        (equation === "ddy" && !Object.is(previousDy, penultimateDy))
      ) {
        productionEvidenceFault("Step-glitch evidence previous state differs from its penultimate point");
      }
    }
  }
  if (stopReason === TRAJECTORY_STOP_REASON_STOP_X && command.type === "replay" && currentPoint.x < command.controlX) {
    productionEvidenceFault("Step-glitch evidence stopped before its requested frontier");
  }
  if (stopReason === TRAJECTORY_STOP_REASON_MAX_STEPS && sampleIndex !== GRAPHWAR_FUNC_MAX_STEPS - 1) {
    productionEvidenceFault("Step-glitch evidence max-steps state stopped early");
  }
  const obstacleHitIndex = header.getInt32(140, true);
  const blockedPoint = obstacleHitIndex >= 0 ? points[obstacleHitIndex] : undefined;
  if (
    obstacleHitIndex < -1 ||
    obstacleHitIndex >= points.length ||
    (obstacleHitIndex >= 0 && !blockedPoint) ||
    obstacleHitIndex >= 0 !== (stopReason === TRAJECTORY_STOP_REASON_OBSTACLE) ||
    (obstacleHitIndex >= 0 && obstacleHitIndex !== points.length - 1)
  ) {
    productionEvidenceFault("Step-glitch evidence obstacle index is invalid");
  }
  const resultFlags = header.getUint32(284, true);
  if (
    (resultFlags &
      ~(
        TRAJECTORY_RESULT_FLAG_OBSTACLE_HIT |
        TRAJECTORY_RESULT_FLAG_HAS_PATH_ERROR |
        TRAJECTORY_RESULT_FLAG_USED_CONTINUATION
      )) !==
    0
  ) {
    productionEvidenceFault("Step-glitch evidence trajectory flags are invalid");
  }
  if (((resultFlags & TRAJECTORY_RESULT_FLAG_OBSTACLE_HIT) !== 0) !== obstacleHitIndex >= 0) {
    productionEvidenceFault("Step-glitch evidence obstacle flag disagrees with its stop state");
  }
  const finalValidation = command.finalValidation;
  const hasExpectedPathError =
    finalValidation.type === "validate" &&
    path.some(
      (point, index) =>
        index > 0 && !finalValidation.targetControlPoints.some((targetPoint) => pixelPointsEqual(targetPoint, point)),
    );
  if (((resultFlags & TRAJECTORY_RESULT_FLAG_HAS_PATH_ERROR) !== 0) !== hasExpectedPathError) {
    productionEvidenceFault("Step-glitch evidence path-error state differs from final validation");
  }
  const rawPathError = header.getFloat64(288, true);
  if (!hasExpectedPathError && !Object.is(rawPathError, 0)) {
    productionEvidenceFault("Step-glitch evidence contains a path error without final validation");
  }
  const pathError = hasExpectedPathError ? validateGraphwarWasmPathError(rawPathError) : undefined;
  const orderedTargets =
    command.type === "replay"
      ? command.targetSequence
      : orderedTargetSequence(context.requiredTargets, command.hitTarget);
  if (
    header.getUint32(144, true) > orderedTargets.length ||
    header.getUint32(148, true) > context.requiredTargets.length
  ) {
    productionEvidenceFault("Step-glitch evidence target state exceeds its command identity");
  }
  if (
    targetHitIndex >= 0 !== (orderedTargets.length > 0 && header.getUint32(144, true) === orderedTargets.length) ||
    requiredTargetsHitIndex >= 0 !==
      (context.requiredTargets.length > 0 && header.getUint32(148, true) === context.requiredTargets.length)
  ) {
    productionEvidenceFault("Step-glitch evidence target completion indexes disagree with reached counts");
  }
  if (
    obstacleHitIndex >= 0 &&
    ((targetHitIndex >= 0 && targetHitIndex >= obstacleHitIndex) ||
      (requiredTargetsHitIndex >= 0 && requiredTargetsHitIndex >= obstacleHitIndex))
  ) {
    productionEvidenceFault("Step-glitch evidence target completion occurs after its obstacle stop");
  }
  return {
    acceptedSamplePointCount: header.getUint32(164, true),
    bisectionCount: header.getUint32(156, true),
    ...(blockedPoint ? { blockedPoint: createGraphPoint(blockedPoint.x, blockedPoint.y) } : {}),
    currentDy,
    currentPoint,
    finalAcceptedSamplePointCount,
    finalBisectionCount,
    finalRk4StepCount,
    obstacleHitIndex,
    ...(pathError === undefined ? {} : { pathError }),
    pointDys: [...pointDys],
    points: points.map((point) => createGraphPoint(point.x, point.y)),
    ...(hasPreviousPoint
      ? {
          previousPoint,
        }
      : {}),
    previousDy,
    reachedRequiredTargetCount: header.getUint32(148, true),
    reachedTargetCount: header.getUint32(144, true),
    replayCount: header.getUint32(168, true),
    requiredTargetsHitIndex,
    rk4StepCount,
    sampleIndex,
    stopReason,
    targetHitIndex,
    trackedTargetHitIndexes: [...trackedTargetHitIndexes],
    visiblePixels: visiblePixels.map((point) => createPixelPoint(point.x, point.y)),
  };
}

function validateOwnedProductionTargetIdentity(
  command: GraphwarWasmStepGlitchCommandInput,
  context: GraphwarWasmStepGlitchContextInput,
  visiblePixels: readonly PixelPoint[],
  trajectory: GraphwarWasmStepGlitchOwnedTrajectory,
) {
  const requiredTargets = context.requiredTargets;
  const orderedTargets =
    command.type === "replay"
      ? command.targetSequence
      : orderedTargetSequence(context.requiredTargets, command.hitTarget);
  let reachedRequiredTargetCount = 0;
  const requiredHit = requiredTargets.map(() => false);
  let requiredTargetsHitIndex = -1;
  let reachedTargetCount = 0;
  let targetHitIndex = -1;
  const trackedTargets = command.finalValidation.type === "validate" ? command.finalValidation.trackedTargets : [];
  const trackedTargetHitIndexes = trackedTargets.map(() => -1);
  for (let index = 1; index < visiblePixels.length; index += 1) {
    for (let targetIndex = 0; targetIndex < requiredTargets.length; targetIndex += 1) {
      if (
        !requiredHit[targetIndex] &&
        productionEvidenceTargetHit(
          productionEvidenceValue(visiblePixels, index, `evidence.visiblePixels[${index}]`),
          productionEvidenceValue(requiredTargets, targetIndex, `context.requiredTargets[${targetIndex}]`),
        )
      ) {
        requiredHit[targetIndex] = true;
        reachedRequiredTargetCount += 1;
      }
    }
    while (
      reachedTargetCount < orderedTargets.length &&
      productionEvidenceTargetHit(
        productionEvidenceValue(visiblePixels, index, `evidence.visiblePixels[${index}]`),
        productionEvidenceValue(orderedTargets, reachedTargetCount, `command.orderedTargets[${reachedTargetCount}]`),
      )
    ) {
      reachedTargetCount += 1;
    }
    if (reachedTargetCount === orderedTargets.length && targetHitIndex < 0 && orderedTargets.length > 0)
      targetHitIndex = index;
    if (
      reachedRequiredTargetCount === requiredTargets.length &&
      requiredTargets.length > 0 &&
      requiredTargetsHitIndex < 0
    )
      requiredTargetsHitIndex = index;
    for (let trackedIndex = 0; trackedIndex < trackedTargets.length; trackedIndex += 1) {
      if (
        trackedTargetHitIndexes[trackedIndex] === -1 &&
        productionEvidenceTargetHit(
          productionEvidenceValue(visiblePixels, index, `evidence.visiblePixels[${index}]`),
          productionEvidenceValue(trackedTargets, trackedIndex, `command.trackedTargets[${trackedIndex}]`),
        )
      ) {
        trackedTargetHitIndexes[trackedIndex] = index;
      }
    }
  }
  if (
    trajectory.reachedTargetCount !== reachedTargetCount ||
    trajectory.reachedRequiredTargetCount !== reachedRequiredTargetCount ||
    trajectory.targetHitIndex !== targetHitIndex ||
    trajectory.requiredTargetsHitIndex !== requiredTargetsHitIndex
  ) {
    productionEvidenceFault("Step-glitch evidence target order/count differs from the command identity");
  }
  if (orderedTargets.length > 0 && reachedTargetCount < orderedTargets.length)
    productionEvidenceFault("Step-glitch evidence did not reach its ordered target");
  if (!productionEvidenceUint32ArraysEqual(trajectory.trackedTargetHitIndexes, trackedTargetHitIndexes)) {
    productionEvidenceFault("Step-glitch evidence tracked target indexes differ from the command identity");
  }
}

function decodeOwnedProductionContinuation(
  runtime: GraphwarWasmKernelRuntime,
  evidencePointer: number,
  evidenceByteLength: number,
  header: DataView,
  protection: readonly number[],
  outputMinimumPointer: number,
  trajectory: GraphwarWasmStepGlitchOwnedTrajectory,
  equation: "dy" | "ddy",
  stopReason: number,
): GraphwarWasmStepGlitchOwnedContinuation | undefined {
  const pointer = header.getUint32(268, true);
  const byteLength = header.getUint32(272, true);
  if ((pointer === 0) !== (byteLength === 0))
    productionEvidenceFault("Continuation evidence pointer/length is a half-state");
  if (pointer === 0) return undefined;
  if (byteLength !== TRAJECTORY_EVIDENCE_BYTE_LENGTH)
    productionEvidenceFault("Continuation evidence has an invalid byte length");
  validateOwnedProductionEvidenceRange(
    runtime,
    evidencePointer,
    evidenceByteLength,
    pointer,
    byteLength,
    8,
    "continuation",
    outputMinimumPointer,
  );
  const view = new DataView(runtime.buffer, pointer, byteLength);
  const flags = view.getUint32(TRAJECTORY_EVIDENCE_FLAGS_OFFSET, true);
  if ((flags & ~31) !== 0) productionEvidenceFault("Continuation evidence contains unsupported flags");
  const hasPreviousPoint = (flags & TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_POINT) !== 0;
  const hasDy = (flags & TRAJECTORY_EVIDENCE_FLAG_HAS_DY) !== 0;
  const hasPreviousDy = (flags & TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_DY) !== 0;
  const expectedStateFlags =
    (trajectory.previousPoint ? TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_POINT : 0) |
    (equation === "ddy" ? TRAJECTORY_EVIDENCE_FLAG_HAS_DY : 0) |
    (equation === "ddy" && trajectory.previousPoint ? TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_DY : 0);
  if (
    view.getUint32(TRAJECTORY_EVIDENCE_PROTECTION_POINTER_OFFSET, true) !== header.getUint32(52, true) ||
    view.getUint32(TRAJECTORY_EVIDENCE_PROTECTION_COUNT_OFFSET, true) !== protection.length ||
    (flags & 7) !== expectedStateFlags ||
    hasPreviousPoint !== (trajectory.previousPoint !== undefined) ||
    hasDy !== (equation === "ddy") ||
    hasPreviousDy !== (equation === "ddy" && trajectory.previousPoint !== undefined) ||
    view.getUint32(TRAJECTORY_EVIDENCE_SAMPLE_INDEX_OFFSET, true) !== trajectory.sampleIndex ||
    view.getUint32(TRAJECTORY_EVIDENCE_REACHED_ORDERED_COUNT_OFFSET, true) !== trajectory.reachedTargetCount ||
    view.getUint32(TRAJECTORY_EVIDENCE_REACHED_REQUIRED_COUNT_OFFSET, true) !== trajectory.reachedRequiredTargetCount
  ) {
    productionEvidenceFault("Continuation evidence does not match its protection or flags");
  }
  const currentX = productionEvidenceFinite(
    view.getFloat64(TRAJECTORY_EVIDENCE_CURRENT_X_OFFSET, true),
    "continuation.currentX",
  );
  const currentY = productionEvidenceFinite(
    view.getFloat64(TRAJECTORY_EVIDENCE_CURRENT_Y_OFFSET, true),
    "continuation.currentY",
  );
  const currentDy = view.getFloat64(TRAJECTORY_EVIDENCE_CURRENT_DY_OFFSET, true);
  if (!Object.is(currentX, trajectory.currentPoint.x) || !Object.is(currentY, trajectory.currentPoint.y)) {
    productionEvidenceFault("Continuation evidence current point differs from the trajectory state");
  }
  if (hasDy) {
    if (!Number.isFinite(currentDy) || !Object.is(currentDy, trajectory.currentDy)) {
      productionEvidenceFault("Continuation evidence current derivative differs from the trajectory state");
    }
  } else if (!Object.is(currentDy, 0)) {
    productionEvidenceFault("Continuation evidence contains an absent current derivative");
  }
  const previousX = view.getFloat64(TRAJECTORY_EVIDENCE_PREVIOUS_X_OFFSET, true);
  const previousY = view.getFloat64(TRAJECTORY_EVIDENCE_PREVIOUS_Y_OFFSET, true);
  const previousDy = view.getFloat64(TRAJECTORY_EVIDENCE_PREVIOUS_DY_OFFSET, true);
  if (hasPreviousPoint) {
    if (
      !trajectory.previousPoint ||
      !Object.is(productionEvidenceFinite(previousX, "continuation.previousX"), trajectory.previousPoint.x) ||
      !Object.is(productionEvidenceFinite(previousY, "continuation.previousY"), trajectory.previousPoint.y)
    ) {
      productionEvidenceFault("Continuation evidence previous point differs from the trajectory state");
    }
  } else if (!Object.is(previousX, 0) || !Object.is(previousY, 0)) {
    productionEvidenceFault("Continuation evidence contains an absent previous point");
  }
  if (hasPreviousDy) {
    if (!Number.isFinite(previousDy) || !trajectory.previousPoint || !Object.is(previousDy, trajectory.previousDy)) {
      productionEvidenceFault("Continuation evidence previous derivative differs from the trajectory state");
    }
  } else if (!Object.is(previousDy, 0)) {
    productionEvidenceFault("Continuation evidence contains an absent previous derivative");
  }
  const shouldSkipInitialStop = stopReason !== TRAJECTORY_STOP_REASON_TARGET;
  const canContinueToLaterFrontier = stopReason === TRAJECTORY_STOP_REASON_STOP_X;
  if (
    ((flags & TRAJECTORY_EVIDENCE_FLAG_SKIP_INITIAL_STOP) !== 0) !== shouldSkipInitialStop ||
    ((flags & TRAJECTORY_EVIDENCE_FLAG_CAN_CONTINUE_TO_LATER_FRONTIER) !== 0) !== canContinueToLaterFrontier
  ) {
    productionEvidenceFault("Continuation evidence stop flags differ from the trajectory result");
  }
  return {
    flags,
    protection: [...protection],
    sampleIndex: view.getUint32(TRAJECTORY_EVIDENCE_SAMPLE_INDEX_OFFSET, true),
  };
}

function rewriteProductionEvidencePointersRelativeToBase(
  bytes: Uint8Array,
  evidencePointer: number,
  evidenceByteLength: number,
  header: DataView,
  formulaInputPointer: number,
  formulaLaunchPointer: number,
  formulaMaterialResultPointer: number,
  finalValidationPointer: number,
) {
  const rewrite = (recordPointer: number, fieldOffset: number, fieldName: string) => {
    const recordOffset = recordPointer - evidencePointer;
    if (recordOffset < 0 || recordOffset + fieldOffset + 4 > bytes.byteLength)
      productionEvidenceFault(`${fieldName} record is outside evidence`);
    const value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
      recordOffset + fieldOffset,
      true,
    );
    productionEvidenceRewriteRelativePointer(
      bytes,
      evidencePointer,
      evidenceByteLength,
      recordOffset,
      fieldOffset,
      value,
      fieldName,
    );
  };
  for (const [offset, value, name] of [
    [12, header.getUint32(12, true), "pathX"],
    [16, header.getUint32(16, true), "pathY"],
    [24, header.getUint32(24, true), "pointX"],
    [28, header.getUint32(28, true), "pointY"],
    [32, header.getUint32(32, true), "pointDy"],
    [40, header.getUint32(40, true), "visibleX"],
    [44, header.getUint32(44, true), "visibleY"],
    [52, header.getUint32(52, true), "protection"],
    [60, header.getUint32(60, true), "formulaInput"],
    [68, header.getUint32(68, true), "launchResult"],
    [76, header.getUint32(76, true), "materialResult"],
    [84, header.getUint32(84, true), "material"],
    [240, header.getUint32(240, true), "finalValidation"],
    [256, header.getUint32(256, true), "formulaPointX"],
    [260, header.getUint32(260, true), "formulaPointY"],
    [268, header.getUint32(268, true), "continuation"],
    [276, header.getUint32(276, true), "trackedHit"],
  ] as const) {
    productionEvidenceRewriteRelativePointer(
      bytes,
      evidencePointer,
      evidenceByteLength,
      0,
      offset,
      value,
      `evidence.${name}`,
    );
  }
  rewrite(formulaInputPointer, FORMULA_INPUT_POINT_X_POINTER_OFFSET, "formulaInput.pointX");
  rewrite(formulaInputPointer, FORMULA_INPUT_POINT_Y_POINTER_OFFSET, "formulaInput.pointY");
  rewrite(formulaInputPointer, FORMULA_INPUT_SIGN_PROTECTION_POINTER_OFFSET, "formulaInput.protection");
  rewrite(formulaInputPointer, FORMULA_INPUT_STEP_OVERFLOW_RANGE_POINTER_OFFSET, "formulaInput.overflowRange");
  rewrite(formulaInputPointer, FORMULA_INPUT_GLITCH_SEGMENT_POINTER_OFFSET, "formulaInput.glitchWindows");
  rewrite(formulaInputPointer, FORMULA_INPUT_MASK_POINTER_OFFSET, "formulaInput.mask");
  rewrite(formulaLaunchPointer, 48, "launchResult.materialResult");
  rewrite(formulaLaunchPointer, FORMULA_LAUNCH_RESULT_PROTECTION_POINTER_OFFSET, "launchResult.protection");
  rewrite(formulaLaunchPointer, FORMULA_LAUNCH_RESULT_FORMULA_POINT_X_POINTER_OFFSET, "launchResult.formulaPointX");
  rewrite(formulaLaunchPointer, FORMULA_LAUNCH_RESULT_FORMULA_POINT_Y_POINTER_OFFSET, "launchResult.formulaPointY");
  rewrite(formulaMaterialResultPointer, FORMULA_RESULT_MATERIAL_POINTER_OFFSET, "materialResult.material");
  rewrite(formulaMaterialResultPointer, 16, "materialResult.values");
  rewrite(formulaMaterialResultPointer, FORMULA_RESULT_PROTECTION_POINTER_OFFSET, "materialResult.protection");
  if (finalValidationPointer !== 0) {
    rewrite(finalValidationPointer, 0, "finalValidation.targetControlX");
    rewrite(finalValidationPointer, 4, "finalValidation.targetControlY");
    rewrite(finalValidationPointer, 12, "finalValidation.trackedTargets");
  }
  const continuationPointer = header.getUint32(268, true);
  if (continuationPointer !== 0)
    rewrite(continuationPointer, TRAJECTORY_EVIDENCE_PROTECTION_POINTER_OFFSET, "continuation.protection");
}

function runGraphwarWasmStepGlitchProductionRaw(
  runtime: GraphwarWasmKernelRuntime,
  contextPointer: number,
  context: GraphwarWasmStepGlitchContextInput,
  command: GraphwarWasmStepGlitchCommandInput,
): GraphwarWasmStepGlitchRawResultBase {
  const commandMark = runtime.markArena();
  try {
    const packed = packGraphwarWasmStepGlitchCommandInput(runtime, context, command, runtime.arenaBase);
    if (packed.status !== "ready") {
      runtime.resetArena(commandMark);
      return { expandedStates: 0, reachedTargetCount: 0, status: packed.status };
    }
    const inputPointer = runtime.reserveArena(
      packed.input.type === "scan"
        ? STEP_GLITCH_PRODUCTION_SCAN_INPUT_BYTE_LENGTH
        : STEP_GLITCH_PRODUCTION_REPLAY_INPUT_BYTE_LENGTH,
      8,
    );
    const inputView = new DataView(
      runtime.buffer,
      inputPointer,
      packed.input.type === "scan"
        ? STEP_GLITCH_PRODUCTION_SCAN_INPUT_BYTE_LENGTH
        : STEP_GLITCH_PRODUCTION_REPLAY_INPUT_BYTE_LENGTH,
    );
    inputView.setUint32(0, contextPointer, true);
    let commandId: number;
    let inputByteLength: number;
    if (command.type === "scan") {
      if (packed.input.type !== "scan") {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Step-glitch command pack changed the scan input variant",
          "output",
        );
      }
      const finalValidation = packGraphwarWasmStepGlitchFinalValidationDescriptor(
        runtime,
        packed.input.finalValidation,
      );
      inputView.setUint32(4, packed.input.targetValues.pointer, true);
      inputView.setUint32(8, packed.input.targetValues.length, true);
      inputView.setUint32(12, finalValidation.pointer, true);
      inputView.setUint32(16, finalValidation.length, true);
      inputView.setUint32(20, 0, true);
      commandId = STEP_GLITCH_COMMAND_SCAN;
      inputByteLength = STEP_GLITCH_PRODUCTION_SCAN_INPUT_BYTE_LENGTH;
    } else {
      if (packed.input.type !== "replay") {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Step-glitch command pack changed the replay input variant",
          "output",
        );
      }
      const finalValidation = packGraphwarWasmStepGlitchFinalValidationDescriptor(
        runtime,
        packed.input.finalValidation,
      );
      inputView.setUint32(4, packed.input.path.x.pointer, true);
      inputView.setUint32(8, packed.input.path.y.pointer, true);
      inputView.setUint32(12, packed.input.path.length, true);
      inputView.setUint32(28, packed.input.targetSequenceRecords.pointer, true);
      inputView.setUint32(32, packed.input.targetSequenceRecords.length / 3, true);
      inputView.setUint32(16, packed.input.windows.pointer, true);
      inputView.setUint32(20, packed.input.windows.count, true);
      inputView.setUint32(24, packed.input.windows.mode, true);
      inputView.setUint32(36, 0, true);
      inputView.setFloat64(40, packed.input.controlX, true);
      inputView.setUint32(48, finalValidation.pointer, true);
      inputView.setUint32(52, finalValidation.length, true);
      inputView.setUint32(56, 0, true);
      inputView.setUint32(60, 0, true);
      commandId = STEP_GLITCH_COMMAND_REPLAY;
      inputByteLength = STEP_GLITCH_PRODUCTION_REPLAY_INPUT_BYTE_LENGTH;
    }
    const outputMinimumPointer = runtime.arenaCursor;
    const resultPointer = runtime.runRouteTask(commandId, inputPointer, inputByteLength);
    const result = decodeGraphwarWasmStepGlitchProductionRawResult(
      runtime,
      context,
      command,
      resultPointer,
      outputMinimumPointer,
    );
    runtime.resetArena(commandMark);
    return result;
  } catch (error) {
    runtime.resetArenaAfterFault(commandMark);
    throw error;
  }
}

/** Creates the retained 8B1 mask-index context below one Adapter-owned arena mark. */
export function createGraphwarWasmStepGlitchGeometryTestContext(
  runtime: GraphwarWasmKernelRuntime,
  input: GraphwarWasmStepGlitchContextInput,
): GraphwarWasmStepGlitchGeometryContextCreateResult {
  const contextMark = runtime.markArena();
  let isDisposed = false;
  try {
    const packedResult = packGraphwarWasmStepGlitchContextInput(runtime, input, runtime.arenaBase);
    if (packedResult.status !== "ready") {
      runtime.resetArena(contextMark);
      return packedResult;
    }
    const boundsSnapshot = { ...input.bounds };
    const boundsRectSnapshot = { ...input.boundsRect };
    const formulaSettingsSnapshot = { ...input.formulaMode.settings };
    const sourcePathSnapshot = input.sourcePath.map((point) => createPixelPoint(point.x, point.y));
    const requiredTargetsSnapshot = input.requiredTargets.map((target) => ({
      center: createPixelPoint(target.center.x, target.center.y),
      radius: target.radius,
    }));
    const contextSnapshot: GraphwarWasmStepGlitchContextInput = {
      ...input,
      bounds: boundsSnapshot,
      boundsRect: boundsRectSnapshot,
      requiredTargets: requiredTargetsSnapshot,
      simulationMask: input.simulationMask.slice(),
      sourcePath: sourcePathSnapshot,
    };
    const prefixTargetSnapshot =
      input.prefixTarget.type === "target"
        ? {
            center: createPixelPoint(input.prefixTarget.target.center.x, input.prefixTarget.target.center.y),
            radius: input.prefixTarget.target.radius,
          }
        : undefined;
    const canReusePrefixEvidence =
      input.prefixEvidence.type === "candidate" &&
      graphwarStepGlitchPrefixEvidenceMatchesContext(
        {
          bounds: boundsSnapshot,
          formulaMode: input.formulaMode,
          graphPoints: sourcePathSnapshot.map((point) => imageToGraphPoint(point, boundsSnapshot, boundsRectSnapshot)),
          ...(prefixTargetSnapshot ? { prefixTarget: prefixTargetSnapshot } : {}),
          requiredTargets: requiredTargetsSnapshot,
          simulationBoundaryExpansion: input.simulationBoundaryExpansion,
          simulationMask: input.simulationMask,
        },
        input.prefixEvidence.evidence,
      );
    const packed = packedResult.input;
    const prefixEvidenceDescriptor = writePrefixEvidenceDescriptor(runtime, packed.prefixEvidence);
    const inputPointer = runtime.reserveArena(STEP_GLITCH_CREATE_INPUT_BYTE_LENGTH, 4);
    const inputView = new DataView(runtime.buffer, inputPointer, STEP_GLITCH_CREATE_INPUT_BYTE_LENGTH);
    inputView.setUint32(0, packed.values.pointer, true);
    inputView.setUint32(4, packed.values.length, true);
    inputView.setUint32(8, packed.formulaSettings.values.pointer, true);
    inputView.setUint32(12, packed.formulaSettings.values.length, true);
    inputView.setUint32(16, packed.simulationMask.pointer, true);
    inputView.setUint32(20, packed.simulationMask.length, true);
    inputView.setUint32(24, packed.sourcePath.x.pointer, true);
    inputView.setUint32(28, packed.sourcePath.y.pointer, true);
    inputView.setUint32(32, packed.sourcePath.length, true);
    inputView.setUint32(36, packed.requiredTargetRecords.pointer, true);
    inputView.setUint32(40, packed.requiredTargetRecords.length, true);
    inputView.setUint32(44, prefixEvidenceDescriptor.pointer, true);
    inputView.setUint32(48, prefixEvidenceDescriptor.length, true);

    const contextPointer = runtime.runRouteTask(
      STEP_GLITCH_COMMAND_CREATE_CONTEXT,
      inputPointer,
      STEP_GLITCH_CREATE_INPUT_BYTE_LENGTH,
    );
    const contextRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: 1, pointer: contextPointer },
      { alignment: 8, elementByteLength: STEP_GLITCH_CONTEXT_BYTE_LENGTH, minimumPointer: runtime.arenaBase },
    );
    const contextView = new DataView(contextRange.buffer, contextRange.byteOffset, contextRange.byteLength);
    const flags = contextView.getUint32(4, true);
    const isMirrored = (flags & STEP_GLITCH_CONTEXT_FLAG_MIRRORED) !== 0;
    if (
      contextView.getUint32(0, true) !== STEP_GLITCH_CONTEXT_MAGIC ||
      (flags & ~STEP_GLITCH_CONTEXT_FLAG_MIRRORED) !== 0 ||
      isMirrored !== input.bounds.minX > input.bounds.maxX ||
      contextView.getUint32(8, true) !== packed.values.pointer ||
      contextView.getUint32(12, true) !== packed.values.length ||
      contextView.getUint32(16, true) !== packed.formulaSettings.values.pointer ||
      contextView.getUint32(20, true) !== packed.formulaSettings.values.length ||
      contextView.getUint32(24, true) !== packed.simulationMask.pointer ||
      contextView.getUint32(28, true) !== packed.simulationMask.length ||
      contextView.getUint32(32, true) !== packed.sourcePath.x.pointer ||
      contextView.getUint32(36, true) !== packed.sourcePath.y.pointer ||
      contextView.getUint32(40, true) !== packed.sourcePath.length ||
      contextView.getUint32(44, true) !== packed.requiredTargetRecords.pointer ||
      contextView.getUint32(48, true) !== packed.requiredTargetRecords.length ||
      contextView.getUint32(52, true) !== prefixEvidenceDescriptor.pointer ||
      contextView.getUint32(56, true) !== prefixEvidenceDescriptor.length
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        "Graphwar WASM Step-glitch geometry context mutated its retained identity",
        "output",
      );
    }
    const farthestFreeXPointer = contextView.getUint32(60, true);
    const farthestFreeXLength = contextView.getUint32(64, true);
    if (farthestFreeXLength !== STEP_GLITCH_PLANE_CELL_COUNT) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM Step-glitch geometry context returned an incomplete farthest-free index",
        "output",
      );
    }
    const assertActive = () => {
      if (isDisposed) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Graphwar WASM Step-glitch geometry context has been disposed",
          "input",
        );
      }
    };
    return {
      context: {
        copyFarthestFreeX() {
          assertActive();
          const range = validateGraphwarWasmMemoryRange(
            runtime,
            { length: farthestFreeXLength, pointer: farthestFreeXPointer },
            { alignment: 2, elementByteLength: 2, minimumPointer: runtime.arenaBase },
          );
          const values = new Int16Array(range.buffer, range.byteOffset, farthestFreeXLength).slice();
          for (const value of values) {
            if (value < -1 || value >= GRAPHWAR_PLANE_LENGTH) {
              throw new GraphwarWasmAdapterError(
                "invalid-session-state",
                "Graphwar WASM Step-glitch farthest-free index contains an invalid column",
                "output",
              );
            }
          }
          return values;
        },
        dispose() {
          assertActive();
          runtime.resetArena(contextMark);
          isDisposed = true;
        },
        isMirrored,
        prepareCandidateFormulaForTest(candidateInput) {
          assertActive();
          return prepareGraphwarWasmStepGlitchCandidateFormula(
            runtime,
            contextPointer,
            formulaSettingsSnapshot,
            sourcePathSnapshot,
            candidateInput,
          );
        },
        replayCandidateForTest(replayInput) {
          assertActive();
          return replayGraphwarWasmStepGlitchCandidate(
            runtime,
            contextPointer,
            boundsSnapshot,
            boundsRectSnapshot,
            formulaSettingsSnapshot,
            sourcePathSnapshot,
            requiredTargetsSnapshot,
            replayInput,
          );
        },
        replayRaw(replayInput) {
          assertActive();
          return runGraphwarWasmStepGlitchProductionRaw(runtime, contextPointer, contextSnapshot, replayInput);
        },
        scanRaw(scanInput) {
          assertActive();
          return runGraphwarWasmStepGlitchProductionRaw(runtime, contextPointer, contextSnapshot, scanInput);
        },
        traceGateFrontier(input) {
          assertActive();
          return traceGraphwarWasmStepGlitchGeometryFrontier(runtime, contextPointer, input);
        },
        traceScriptedDfs(dfsInput) {
          assertActive();
          return traceGraphwarWasmStepGlitchGeometryDfs(
            runtime,
            contextPointer,
            boundsSnapshot,
            boundsRectSnapshot,
            sourcePathSnapshot,
            isMirrored,
            dfsInput,
          );
        },
        traceRealDfsForTest(dfsInput) {
          assertActive();
          return traceGraphwarWasmStepGlitchRealDfs(
            runtime,
            contextPointer,
            boundsSnapshot,
            boundsRectSnapshot,
            formulaSettingsSnapshot,
            sourcePathSnapshot,
            requiredTargetsSnapshot,
            prefixTargetSnapshot,
            canReusePrefixEvidence,
            dfsInput,
          );
        },
      },
      status: "ready",
    };
  } catch (error) {
    runtime.resetArenaAfterFault(contextMark);
    throw error;
  }
}

/** Production smart/one-click callers use the same retained command context as the focused adapter tests. */
export function createGraphwarWasmStepGlitchContext(
  runtime: GraphwarWasmKernelRuntime,
  input: GraphwarWasmStepGlitchContextInput,
): GraphwarWasmStepGlitchGeometryContextCreateResult {
  return createGraphwarWasmStepGlitchGeometryTestContext(runtime, input);
}

function prepareGraphwarWasmStepGlitchCandidateFormula(
  runtime: GraphwarWasmKernelRuntime,
  contextPointer: number,
  settings: GraphwarTrajectoryFormulaSettings,
  sourcePath: readonly PixelPoint[],
  input: GraphwarWasmStepGlitchFormulaCandidateTestInput,
): GraphwarWasmFormulaLaunchResult {
  if (
    input.path.length < 2 ||
    input.path.length < sourcePath.length ||
    !input.path.every(isGraphwarTrajectoryPoint) ||
    !sourcePath.every((point, index) => pixelPointsEqual(point, input.path[index]))
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Graphwar WASM Step-glitch candidate path must preserve the retained source prefix",
      "input",
    );
  }
  const segmentCount = input.path.length - 1;
  if (input.windows.type === "explicit" && input.windows.segments.length !== segmentCount) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Graphwar WASM Step-glitch fixed windows must match the candidate segment count",
      "input",
    );
  }

  const commandMark = runtime.markArena();
  try {
    const packedPath = packGraphwarWasmPointSoA(runtime, input.path, runtime.arenaBase);
    const packedWindows = packGraphwarWasmStepGlitchCandidateWindows(runtime, segmentCount, input.windows);

    const inputPointer = runtime.reserveArena(STEP_GLITCH_FORMULA_INPUT_BYTE_LENGTH, 4);
    const inputView = new DataView(runtime.buffer, inputPointer, STEP_GLITCH_FORMULA_INPUT_BYTE_LENGTH);
    inputView.setUint32(0, contextPointer, true);
    inputView.setUint32(4, packedPath.x.pointer, true);
    inputView.setUint32(8, packedPath.y.pointer, true);
    inputView.setUint32(12, packedPath.length, true);
    inputView.setUint32(16, packedWindows.pointer, true);
    inputView.setUint32(20, packedWindows.count, true);
    inputView.setUint32(24, packedWindows.mode, true);
    inputView.setUint32(28, 0, true);
    const outputMinimumPointer = runtime.arenaCursor;
    const resultPointer = runtime.runRouteTask(
      STEP_GLITCH_COMMAND_PREPARE_CANDIDATE_FORMULA_FOR_TEST,
      inputPointer,
      STEP_GLITCH_FORMULA_INPUT_BYTE_LENGTH,
    );
    const result = readGraphwarWasmFormulaLaunchResultForStepGlitchTest(
      runtime,
      settings,
      packedPath.length,
      resultPointer,
      outputMinimumPointer,
    );
    runtime.resetArena(commandMark);
    return result;
  } catch (error) {
    runtime.resetArenaAfterFault(commandMark);
    throw error;
  }
}

function packGraphwarWasmStepGlitchCandidateWindows(
  runtime: GraphwarWasmArenaMemorySource,
  segmentCount: number,
  windows: GraphwarWasmStepGlitchFormulaCandidateTestInput["windows"],
) {
  if (windows.type === "automatic") {
    return { count: 0, mode: 0, pointer: 0 };
  }
  if (windows.segments.length !== segmentCount) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Graphwar WASM Step-glitch fixed windows must match the candidate segment count",
      "input",
    );
  }
  const byteLength = windows.segments.length * STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH;
  const pointer = runtime.reserveArena(byteLength, 8);
  new Uint8Array(runtime.buffer, pointer, byteLength).fill(0);
  const view = new DataView(runtime.buffer, pointer, byteLength);
  for (let index = 0; index < windows.segments.length; index += 1) {
    const window = windows.segments[index];
    if (window === undefined) {
      continue;
    }
    if (!Number.isFinite(window.startX) || !Number.isFinite(window.endX) || !(window.endX > window.startX)) {
      throw new GraphwarWasmAdapterError(
        "invalid-formula-input",
        `Graphwar WASM Step-glitch fixed window ${index} is invalid`,
        "input",
      );
    }
    const offset = index * STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH;
    view.setUint32(offset, 1, true);
    view.setFloat64(offset + 8, window.startX, true);
    view.setFloat64(offset + 16, window.endX, true);
  }
  return { count: windows.segments.length, mode: 1, pointer };
}

function throwGraphwarWasmStepGlitchReplayResultError(message: string): never {
  throw new GraphwarWasmAdapterError("invalid-formula-result", message, "output");
}

function replayGraphwarWasmStepGlitchCandidate(
  runtime: GraphwarWasmKernelRuntime,
  contextPointer: number,
  bounds: GraphBounds,
  boundsRect: BoundsRect,
  settings: GraphwarTrajectoryFormulaSettings,
  sourcePath: readonly PixelPoint[],
  requiredTargets: readonly GraphwarTrajectoryTargetCircle[],
  input: GraphwarWasmStepGlitchRealReplayTestInput,
): GraphwarWasmStepGlitchRealReplayTestOutput {
  if (
    !Number.isFinite(input.controlX) ||
    input.path.length < 2 ||
    input.path.length < sourcePath.length ||
    !input.path.every(isGraphwarTrajectoryPoint) ||
    !sourcePath.every((point, index) => pixelPointsEqual(point, input.path[index])) ||
    !targetsAreValid(input.orderedTargets)
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Graphwar WASM Step-glitch replay input is malformed",
      "input",
    );
  }

  const commandMark = runtime.markArena();
  try {
    const packedPath = packGraphwarWasmPointSoA(runtime, input.path, runtime.arenaBase);
    const packedWindows = packGraphwarWasmStepGlitchCandidateWindows(runtime, input.path.length - 1, input.windows);
    const packedTargets = packTargets(runtime, input.orderedTargets, runtime.arenaBase);
    const inputPointer = runtime.reserveArena(STEP_GLITCH_REPLAY_INPUT_BYTE_LENGTH, 8);
    const inputView = new DataView(runtime.buffer, inputPointer, STEP_GLITCH_REPLAY_INPUT_BYTE_LENGTH);
    inputView.setUint32(0, contextPointer, true);
    inputView.setUint32(4, packedPath.x.pointer, true);
    inputView.setUint32(8, packedPath.y.pointer, true);
    inputView.setUint32(12, packedPath.length, true);
    inputView.setUint32(16, packedWindows.pointer, true);
    inputView.setUint32(20, packedWindows.count, true);
    inputView.setUint32(24, packedWindows.mode, true);
    inputView.setUint32(28, packedTargets.pointer, true);
    inputView.setUint32(32, input.orderedTargets.length, true);
    inputView.setUint32(36, 0, true);
    inputView.setFloat64(40, input.controlX, true);
    const outputMinimumPointer = runtime.arenaCursor;
    const replayResultPointer = runtime.runRouteTask(
      STEP_GLITCH_COMMAND_REPLAY_CANDIDATE_FOR_TEST,
      inputPointer,
      STEP_GLITCH_REPLAY_INPUT_BYTE_LENGTH,
    );
    const replayRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: 1, pointer: replayResultPointer },
      { alignment: 8, elementByteLength: STEP_GLITCH_REPLAY_RESULT_BYTE_LENGTH, minimumPointer: outputMinimumPointer },
    );
    const replayView = new DataView(replayRange.buffer, replayRange.byteOffset, replayRange.byteLength);
    const status = validateGraphwarWasmEnumValue(replayView.getUint32(4, true), [0, 1] as const, "replay.status");
    const launchStatus = validateGraphwarWasmEnumValue(
      replayView.getInt32(12, true),
      [0, 1] as const,
      "replay.launchStatus",
    );
    if (replayView.getUint32(0, true) !== STEP_GLITCH_REPLAY_RESULT_MAGIC) {
      throwGraphwarWasmStepGlitchReplayResultError("Graphwar WASM Step-glitch replay result has invalid magic");
    }
    const trajectoryPointer = replayView.getUint32(8, true);
    const trajectoryRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: 1, pointer: trajectoryPointer },
      { alignment: 8, elementByteLength: 224, minimumPointer: outputMinimumPointer },
    );
    const trajectoryView = new DataView(trajectoryRange.buffer, trajectoryRange.byteOffset, trajectoryRange.byteLength);
    const mirroredFields: readonly [number, number, "i32" | "u32"][] = [
      [12, 0, "i32"],
      [16, 100, "u32"],
      [20, 104, "u32"],
      [64, 4, "i32"],
      [68, 108, "i32"],
      [72, 112, "i32"],
      [76, 116, "i32"],
      [80, 8, "u32"],
      [84, 12, "u32"],
      [88, 16, "u32"],
      [92, 20, "u32"],
      [96, 212, "u32"],
      [100, 216, "u32"],
      [104, 136, "u32"],
      [108, 140, "u32"],
      [160, 192, "u32"],
      [164, 196, "u32"],
    ];
    for (const [replayOffset, trajectoryOffset, type] of mirroredFields) {
      const replayValue =
        type === "i32" ? replayView.getInt32(replayOffset, true) : replayView.getUint32(replayOffset, true);
      const trajectoryValue =
        type === "i32"
          ? trajectoryView.getInt32(trajectoryOffset, true)
          : trajectoryView.getUint32(trajectoryOffset, true);
      if (replayValue !== trajectoryValue) {
        throwGraphwarWasmStepGlitchReplayResultError("Graphwar WASM Step-glitch replay fields disagree");
      }
    }
    for (const [replayOffset, trajectoryOffset] of [
      [112, 32],
      [120, 40],
      [128, 48],
      [136, 168],
      [144, 176],
      [152, 184],
    ] as const) {
      if (!Object.is(replayView.getFloat64(replayOffset, true), trajectoryView.getFloat64(trajectoryOffset, true))) {
        throwGraphwarWasmStepGlitchReplayResultError("Graphwar WASM Step-glitch replay state disagrees");
      }
    }

    const reachedTargetCount = validateGraphwarWasmU32(replayView.getUint32(16, true), "replay.reachedTargetCount");
    const reachedRequiredTargetCount = validateGraphwarWasmU32(
      replayView.getUint32(20, true),
      "replay.reachedRequiredTargetCount",
    );
    if (reachedTargetCount > input.orderedTargets.length || reachedRequiredTargetCount > requiredTargets.length) {
      throwGraphwarWasmStepGlitchReplayResultError("Graphwar WASM Step-glitch replay target counts overflow input");
    }
    const stopReason = validateGraphwarWasmEnumValue(
      replayView.getInt32(64, true),
      [1, 2, 3, 4, 5, 6, 7] as const,
      "replay.stopReason",
    );
    const acceptedSamplePointCount = validateGraphwarWasmU32(
      replayView.getUint32(96, true),
      "replay.acceptedSamplePointCount",
    );
    const bisectionCount = validateGraphwarWasmU32(replayView.getUint32(88, true), "replay.bisectionCount");
    const minStepJumpCount = validateGraphwarWasmU32(replayView.getUint32(92, true), "replay.minStepJumpCount");
    const replayCount = validateGraphwarWasmU32(replayView.getUint32(100, true), "replay.replayCount");
    const rk4StepCount = validateGraphwarWasmU32(replayView.getUint32(84, true), "replay.rk4StepCount");
    const finalRk4StepCount = validateGraphwarWasmU32(replayView.getUint32(168, true), "replay.finalRk4StepCount");
    const finalBisectionCount = validateGraphwarWasmU32(replayView.getUint32(172, true), "replay.finalBisectionCount");
    const finalAcceptedSamplePointCount = validateGraphwarWasmU32(
      replayView.getUint32(176, true),
      "replay.finalAcceptedSamplePointCount",
    );
    if (
      finalRk4StepCount > rk4StepCount ||
      finalBisectionCount > bisectionCount ||
      finalAcceptedSamplePointCount > acceptedSamplePointCount
    ) {
      throwGraphwarWasmStepGlitchReplayResultError("Final Step-glitch counters exceed their command aggregates");
    }
    const protectionCount = validateGraphwarWasmU32(replayView.getUint32(108, true), "replay.protectionCount");
    if (protectionCount !== input.path.length - 1) {
      throwGraphwarWasmStepGlitchReplayResultError("Graphwar WASM Step-glitch replay protection length differs");
    }
    const observedSignProtection = [
      ...copyGraphwarWasmUint32Values(
        runtime,
        { length: protectionCount, pointer: replayView.getUint32(104, true) },
        outputMinimumPointer,
      ),
    ];
    for (let index = 0; index < observedSignProtection.length; index += 1) {
      validateGraphwarWasmProtectionBits(
        observedSignProtection[index],
        ALLOWED_SIGN_PROTECTION_BITS,
        `replay.protection[${index}]`,
      );
    }
    const pointCount = validateGraphwarWasmU32(replayView.getUint32(80, true), "replay.pointCount");
    const acceptedFlag = validateGraphwarWasmEnumValue(
      replayView.getUint32(24, true),
      [0, 1] as const,
      "replay.acceptedFlag",
    );
    const blockedFlag = validateGraphwarWasmEnumValue(
      replayView.getUint32(28, true),
      [0, 1] as const,
      "replay.blockedFlag",
    );
    const obstacleHitIndex = replayView.getInt32(76, true);
    const targetHitIndex = replayView.getInt32(68, true);
    const requiredTargetsHitIndex = replayView.getInt32(72, true);
    const stateFlags = replayView.getUint32(164, true);
    if (launchStatus === 0) {
      if (
        status !== 0 ||
        pointCount !== 0 ||
        acceptedFlag !== 0 ||
        blockedFlag !== 0 ||
        reachedTargetCount !== 0 ||
        reachedRequiredTargetCount !== 0 ||
        targetHitIndex !== -1 ||
        requiredTargetsHitIndex !== -1 ||
        obstacleHitIndex !== -1 ||
        stateFlags !== 0 ||
        finalAcceptedSamplePointCount !== 0 ||
        finalRk4StepCount !== 0 ||
        finalBisectionCount !== 0
      ) {
        throwGraphwarWasmStepGlitchReplayResultError("Invalid launch replay contains physical output");
      }
      const result = {
        acceptedSamplePointCount,
        bisectionCount,
        finalAcceptedSamplePointCount,
        finalBisectionCount,
        finalRk4StepCount,
        launchStatus: "invalid",
        minStepJumpCount,
        observedSignProtection,
        reachedRequiredTargetCount,
        reachedTargetCount,
        replayCount,
        rk4StepCount,
        status: "miss",
        stopReason,
      } satisfies GraphwarWasmStepGlitchRealReplayTestOutput;
      runtime.resetArena(commandMark);
      return result;
    }

    if (pointCount === 0) {
      throwGraphwarWasmStepGlitchReplayResultError("Successful Step-glitch replay has no physical points");
    }
    if (finalAcceptedSamplePointCount < pointCount) {
      throwGraphwarWasmStepGlitchReplayResultError("Final Step-glitch samples do not cover its physical points");
    }
    if (replayCount < 1 || acceptedSamplePointCount < pointCount) {
      throwGraphwarWasmStepGlitchReplayResultError("Step-glitch replay counters disagree with its physical points");
    }
    const pointXs = copyGraphwarWasmFloat64Values(
      runtime,
      { length: pointCount, pointer: trajectoryView.getUint32(24, true) },
      outputMinimumPointer,
    );
    const pointYs = copyGraphwarWasmFloat64Values(
      runtime,
      { length: pointCount, pointer: trajectoryView.getUint32(28, true) },
      outputMinimumPointer,
    );
    const pointDys = copyGraphwarWasmFloat64Values(
      runtime,
      { length: pointCount, pointer: trajectoryView.getUint32(208, true) },
      outputMinimumPointer,
    );
    const points: GraphPoint[] = [];
    for (let index = 0; index < pointCount; index += 1) {
      if (settings.equation === "ddy") {
        validateGraphwarWasmFiniteNumber(pointDys[index], `replay.points[${index}].dy`);
      } else if (!Object.is(pointDys[index], 0)) {
        throwGraphwarWasmStepGlitchReplayResultError("First-order replay contains second-order point state");
      }
      points.push(
        createGraphPoint(
          validateGraphwarWasmFiniteNumber(pointXs[index], `replay.points[${index}].x`),
          validateGraphwarWasmFiniteNumber(pointYs[index], `replay.points[${index}].y`),
        ),
      );
    }
    const initialDy = trajectoryView.getFloat64(80, true);
    if (settings.equation === "ddy") {
      validateGraphwarWasmFiniteNumber(initialDy, "replay.initialDy");
    } else if (!Object.is(initialDy, 0)) {
      throwGraphwarWasmStepGlitchReplayResultError("First-order replay contains a second-order initial derivative");
    }
    const visiblePointCount = validateGraphwarWasmU32(trajectoryView.getUint32(152, true), "replay.visiblePointCount");
    if (visiblePointCount !== pointCount) {
      throwGraphwarWasmStepGlitchReplayResultError("Cold scanner replay did not collect every visible point");
    }
    const visibleXs = copyGraphwarWasmFloat64Values(
      runtime,
      { length: visiblePointCount, pointer: trajectoryView.getUint32(144, true) },
      outputMinimumPointer,
    );
    const visibleYs = copyGraphwarWasmFloat64Values(
      runtime,
      { length: visiblePointCount, pointer: trajectoryView.getUint32(148, true) },
      outputMinimumPointer,
    );
    const visiblePixels = Array.from({ length: visiblePointCount }, (_value, index) =>
      createPixelPoint(
        validateGraphwarWasmFiniteNumber(visibleXs[index], `replay.visiblePixels[${index}].x`),
        validateGraphwarWasmFiniteNumber(visibleYs[index], `replay.visiblePixels[${index}].y`),
      ),
    );
    for (let index = 0; index < visiblePixels.length; index += 1) {
      const expectedPixel = graphToImagePoint(points[index], bounds, boundsRect);
      if (!Object.is(visiblePixels[index].x, expectedPixel.x) || !Object.is(visiblePixels[index].y, expectedPixel.y)) {
        throwGraphwarWasmStepGlitchReplayResultError("Step-glitch replay visible pixels disagree with its samples");
      }
    }
    if (
      targetHitIndex < -1 ||
      targetHitIndex >= pointCount ||
      requiredTargetsHitIndex < -1 ||
      requiredTargetsHitIndex >= pointCount
    ) {
      throwGraphwarWasmStepGlitchReplayResultError("Step-glitch replay target index is outside its samples");
    }
    const hasObstacleHit = obstacleHitIndex >= 0;
    if (
      obstacleHitIndex < -1 ||
      obstacleHitIndex >= pointCount ||
      hasObstacleHit !== (blockedFlag === 1) ||
      hasObstacleHit !== (stopReason === 6) ||
      (hasObstacleHit && obstacleHitIndex !== pointCount - 1)
    ) {
      throwGraphwarWasmStepGlitchReplayResultError("Step-glitch replay blocked point disagrees with obstacle index");
    }

    const requiredTargetHits = new Uint8Array(requiredTargets.length);
    let expectedReachedTargetCount = 0;
    let expectedReachedRequiredTargetCount = 0;
    let expectedTargetHitIndex = -1;
    let expectedRequiredTargetsHitIndex = -1;
    for (let pointIndex = 1; pointIndex < visiblePixels.length; pointIndex += 1) {
      const pixel = visiblePixels[pointIndex];
      for (let targetIndex = 0; targetIndex < requiredTargets.length; targetIndex += 1) {
        if (requiredTargetHits[targetIndex] !== 0) {
          continue;
        }
        const target = requiredTargets[targetIndex];
        const dx = pixel.x - target.center.x;
        const dy = pixel.y - target.center.y;
        if (dx * dx + dy * dy < target.radius * target.radius) {
          requiredTargetHits[targetIndex] = 1;
          expectedReachedRequiredTargetCount += 1;
        }
      }
      while (expectedReachedTargetCount < input.orderedTargets.length) {
        const target = input.orderedTargets[expectedReachedTargetCount];
        const dx = pixel.x - target.center.x;
        const dy = pixel.y - target.center.y;
        if (!(dx * dx + dy * dy < target.radius * target.radius)) {
          break;
        }
        expectedReachedTargetCount += 1;
      }
      if (
        input.orderedTargets.length > 0 &&
        expectedReachedTargetCount === input.orderedTargets.length &&
        expectedTargetHitIndex < 0
      ) {
        expectedTargetHitIndex = pointIndex;
      }
      if (
        requiredTargets.length > 0 &&
        expectedReachedRequiredTargetCount === requiredTargets.length &&
        expectedRequiredTargetsHitIndex < 0
      ) {
        expectedRequiredTargetsHitIndex = pointIndex;
      }
    }
    if (
      reachedTargetCount !== expectedReachedTargetCount ||
      reachedRequiredTargetCount !== expectedReachedRequiredTargetCount ||
      targetHitIndex !== expectedTargetHitIndex ||
      requiredTargetsHitIndex !== expectedRequiredTargetsHitIndex
    ) {
      throwGraphwarWasmStepGlitchReplayResultError("Step-glitch replay target state disagrees with its samples");
    }

    const lastSafeIndex = hasObstacleHit ? obstacleHitIndex - 1 : pointCount - 1;
    const completionIndex = Math.max(expectedTargetHitIndex, expectedRequiredTargetsHitIndex);
    const hasReachedTargets =
      expectedReachedTargetCount === input.orderedTargets.length &&
      expectedReachedRequiredTargetCount === requiredTargets.length;
    const isCompletionSafe =
      input.orderedTargets.length === 0 && requiredTargets.length === 0
        ? true
        : completionIndex >= 0 && completionIndex <= lastSafeIndex;
    let expectedAcceptedPointIndex = -1;
    if (hasReachedTargets && isCompletionSafe) {
      for (
        let pointIndex = Math.max(expectedTargetHitIndex, 0);
        pointIndex < pointCount && (!hasObstacleHit || pointIndex < obstacleHitIndex);
        pointIndex += 1
      ) {
        if (points[pointIndex].x >= input.controlX) {
          expectedAcceptedPointIndex = pointIndex;
          break;
        }
      }
    }
    const hasAcceptedPoint = expectedAcceptedPointIndex >= 0;
    if ((status === 1) !== hasAcceptedPoint || (acceptedFlag === 1) !== hasAcceptedPoint) {
      throwGraphwarWasmStepGlitchReplayResultError("Step-glitch replay hit status disagrees with its samples");
    }
    const acceptedX = replayView.getFloat64(32, true);
    const acceptedY = replayView.getFloat64(40, true);
    const acceptedPoint = hasAcceptedPoint
      ? createGraphPoint(
          validateGraphwarWasmFiniteNumber(acceptedX, "replay.acceptedPoint.x"),
          validateGraphwarWasmFiniteNumber(acceptedY, "replay.acceptedPoint.y"),
        )
      : undefined;
    if (
      acceptedPoint
        ? !Object.is(acceptedPoint.x, points[expectedAcceptedPointIndex].x) ||
          !Object.is(acceptedPoint.y, points[expectedAcceptedPointIndex].y)
        : !Object.is(acceptedX, 0) || !Object.is(acceptedY, 0)
    ) {
      throwGraphwarWasmStepGlitchReplayResultError("Step-glitch replay accepted point is not canonical");
    }
    const blockedX = replayView.getFloat64(48, true);
    const blockedY = replayView.getFloat64(56, true);
    const blockedPoint = hasObstacleHit
      ? createGraphPoint(
          validateGraphwarWasmFiniteNumber(blockedX, "replay.blockedPoint.x"),
          validateGraphwarWasmFiniteNumber(blockedY, "replay.blockedPoint.y"),
        )
      : undefined;
    if (
      blockedPoint
        ? !Object.is(blockedPoint.x, points[obstacleHitIndex].x) ||
          !Object.is(blockedPoint.y, points[obstacleHitIndex].y)
        : !Object.is(blockedX, 0) || !Object.is(blockedY, 0)
    ) {
      throwGraphwarWasmStepGlitchReplayResultError("Step-glitch replay blocked point is not canonical");
    }
    const hasPreviousPoint = (stateFlags & 1) !== 0;
    const expectedStateFlags =
      (hasPreviousPoint ? 1 : 0) |
      (settings.equation === "ddy" ? 2 : 0) |
      (hasPreviousPoint && settings.equation === "ddy" ? 4 : 0);
    if (stateFlags !== expectedStateFlags) {
      throwGraphwarWasmStepGlitchReplayResultError("Step-glitch replay terminal state flags are inconsistent");
    }
    const currentPoint = createGraphPoint(
      validateGraphwarWasmFiniteNumber(replayView.getFloat64(112, true), "replay.state.currentPoint.x"),
      validateGraphwarWasmFiniteNumber(replayView.getFloat64(120, true), "replay.state.currentPoint.y"),
    );
    const previousPoint = hasPreviousPoint
      ? createGraphPoint(
          validateGraphwarWasmFiniteNumber(replayView.getFloat64(136, true), "replay.state.previousPoint.x"),
          validateGraphwarWasmFiniteNumber(replayView.getFloat64(144, true), "replay.state.previousPoint.y"),
        )
      : undefined;
    const sampleIndex = validateGraphwarWasmU32(replayView.getUint32(160, true), "replay.state.sampleIndex");
    const state = createGraphwarWasmTrajectoryPhysicalStateFromSamplingState(
      settings.equation === "ddy"
        ? {
            currentPoint,
            dy: validateGraphwarWasmFiniteNumber(replayView.getFloat64(128, true), "replay.state.currentDy"),
            ...(previousPoint
              ? {
                  previousDy: validateGraphwarWasmFiniteNumber(
                    replayView.getFloat64(152, true),
                    "replay.state.previousDy",
                  ),
                  previousPoint,
                }
              : {}),
            sampleIndex,
          }
        : { currentPoint, ...(previousPoint ? { previousPoint } : {}), sampleIndex },
      settings.equation,
      "replay.state",
    );
    const statePreviousPoint = state.equation === "ddy" ? state.previous?.point : state.previousPoint;
    const statePreviousDy = state.equation === "ddy" ? state.previous?.dy : undefined;
    const stateCurrentDy = state.equation === "ddy" ? state.currentDy : undefined;
    const expectedSampleIndex = stopReason === 4 ? pointCount : pointCount - 1;
    if (state.sampleIndex !== expectedSampleIndex) {
      throwGraphwarWasmStepGlitchReplayResultError("Step-glitch replay sample index disagrees with its points");
    }
    const lastPoint = points[pointCount - 1];
    const lastPointDy = pointDys[pointCount - 1];
    if (stopReason === 4) {
      if (
        !statePreviousPoint ||
        !Object.is(statePreviousPoint.x, lastPoint.x) ||
        !Object.is(statePreviousPoint.y, lastPoint.y) ||
        (settings.equation === "ddy" && !Object.is(statePreviousDy, lastPointDy))
      ) {
        throwGraphwarWasmStepGlitchReplayResultError(
          "Out-of-bounds Step-glitch replay does not retain its last published point",
        );
      }
      const minX = Math.min(bounds.minX, bounds.maxX);
      const maxX = Math.max(bounds.minX, bounds.maxX);
      const minY = Math.min(bounds.minY, bounds.maxY);
      const maxY = Math.max(bounds.minY, bounds.maxY);
      if (
        state.currentPoint.x >= minX &&
        state.currentPoint.x <= maxX &&
        state.currentPoint.y >= minY &&
        state.currentPoint.y <= maxY
      ) {
        throwGraphwarWasmStepGlitchReplayResultError("Out-of-bounds Step-glitch replay retained an in-bounds state");
      }
    } else if (
      !Object.is(state.currentPoint.x, lastPoint.x) ||
      !Object.is(state.currentPoint.y, lastPoint.y) ||
      (settings.equation === "ddy" && !Object.is(stateCurrentDy, lastPointDy))
    ) {
      throwGraphwarWasmStepGlitchReplayResultError("Step-glitch replay terminal state disagrees with its last point");
    }
    if (pointCount > 1 && stopReason !== 4) {
      const penultimatePoint = points[pointCount - 2];
      if (
        !statePreviousPoint ||
        !Object.is(statePreviousPoint.x, penultimatePoint.x) ||
        !Object.is(statePreviousPoint.y, penultimatePoint.y) ||
        (settings.equation === "ddy" && !Object.is(statePreviousDy, pointDys[pointCount - 2]))
      ) {
        throwGraphwarWasmStepGlitchReplayResultError(
          "Step-glitch replay previous state disagrees with its penultimate point",
        );
      }
    }
    if (stopReason === 1 && state.currentPoint.x < input.controlX) {
      throwGraphwarWasmStepGlitchReplayResultError("Step-glitch replay stopped before its requested frontier");
    }
    if (stopReason === 3 && state.sampleIndex !== GRAPHWAR_FUNC_MAX_STEPS - 1) {
      throwGraphwarWasmStepGlitchReplayResultError("Step-glitch replay max-steps state stopped early");
    }
    if (stopReason === 7) {
      throwGraphwarWasmStepGlitchReplayResultError("Cold Step-glitch replay unexpectedly stopped on target completion");
    }
    const result = {
      ...(acceptedPoint ? { acceptedPoint } : {}),
      acceptedSamplePointCount,
      bisectionCount,
      ...(blockedPoint ? { blockedPoint } : {}),
      finalAcceptedSamplePointCount,
      finalBisectionCount,
      finalRk4StepCount,
      initialDy,
      launchStatus: "success",
      minStepJumpCount,
      obstacleHitIndex,
      observedSignProtection,
      pointDys: [...pointDys],
      points,
      reachedRequiredTargetCount,
      reachedTargetCount,
      replayCount,
      requiredTargetsHitIndex,
      rk4StepCount,
      state,
      status: status === 1 ? "hit" : "miss",
      stopReason,
      targetHitIndex,
      visiblePixels,
    } satisfies GraphwarWasmStepGlitchRealReplayTestOutput;
    runtime.resetArena(commandMark);
    return result;
  } catch (error) {
    runtime.resetArenaAfterFault(commandMark);
    throw error;
  }
}

function traceGraphwarWasmStepGlitchRealDfs(
  runtime: GraphwarWasmKernelRuntime,
  contextPointer: number,
  bounds: GraphBounds,
  boundsRect: BoundsRect,
  settings: GraphwarTrajectoryFormulaSettings,
  sourcePath: readonly PixelPoint[],
  requiredTargets: readonly GraphwarTrajectoryTargetCircle[],
  prefixTarget: GraphwarTrajectoryTargetCircle | undefined,
  canReusePrefixEvidence: boolean,
  input: GraphwarWasmStepGlitchRealDfsTestInput,
): GraphwarWasmStepGlitchRealDfsTestTrace {
  if (!targetIsValid(input.hitTarget) || !isGraphwarTrajectoryPoint(input.targetPoint)) {
    throw new GraphwarWasmAdapterError("invalid-formula-input", "Real Step-glitch DFS target is malformed", "input");
  }
  const targetGraphPoint = imageToGraphPoint(input.targetPoint, bounds, boundsRect);
  const sourcePoint = sourcePath.at(-1);
  if (!sourcePoint) {
    throw new GraphwarWasmAdapterError("invalid-formula-input", "Real Step-glitch DFS source is empty", "input");
  }
  const sourceGraphPoint = imageToGraphPoint(sourcePoint, bounds, boundsRect);
  if (!graphXAdvancesStrictly(sourceGraphPoint.x, targetGraphPoint.x)) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Real Step-glitch DFS target does not advance from the source",
      "input",
    );
  }
  const commandMark = runtime.markArena();
  try {
    const targetValues = writeGraphwarWasmFloat64Values(
      runtime,
      new Float64Array([
        input.hitTarget.center.x,
        input.hitTarget.center.y,
        input.hitTarget.radius,
        input.targetPoint.x,
        input.targetPoint.y,
      ]),
      runtime.arenaBase,
    );
    const inputPointer = runtime.reserveArena(STEP_GLITCH_REAL_DFS_INPUT_BYTE_LENGTH, 8);
    const inputView = new DataView(runtime.buffer, inputPointer, STEP_GLITCH_REAL_DFS_INPUT_BYTE_LENGTH);
    inputView.setUint32(0, contextPointer, true);
    inputView.setUint32(4, targetValues.pointer, true);
    inputView.setUint32(8, STEP_GLITCH_REAL_DFS_TARGET_VALUE_COUNT, true);
    inputView.setUint32(12, 0, true);
    const outputMinimumPointer = runtime.arenaCursor;
    const resultPointer = runtime.runRouteTask(
      STEP_GLITCH_COMMAND_TRACE_REAL_DFS_FOR_TEST,
      inputPointer,
      STEP_GLITCH_REAL_DFS_INPUT_BYTE_LENGTH,
    );
    const resultRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: 1, pointer: resultPointer },
      {
        alignment: 8,
        elementByteLength: STEP_GLITCH_REAL_DFS_RESULT_BYTE_LENGTH,
        minimumPointer: outputMinimumPointer,
      },
    );
    const resultView = new DataView(resultRange.buffer, resultRange.byteOffset, resultRange.byteLength);
    const prefixPreparationValue = resultView.getUint32(20, true);
    if (
      resultView.getUint32(0, true) !== STEP_GLITCH_REAL_DFS_RESULT_MAGIC ||
      ![
        STEP_GLITCH_REAL_DFS_PREFIX_PREPARATION_NONE,
        STEP_GLITCH_REAL_DFS_PREFIX_PREPARATION_COLD,
        STEP_GLITCH_REAL_DFS_PREFIX_PREPARATION_EVIDENCE,
      ].includes(prefixPreparationValue)
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Real Step-glitch DFS result header is invalid",
        "output",
      );
    }
    const resultStatus = validateGraphwarWasmEnumValue(
      resultView.getUint32(4, true),
      [0, 1] as const,
      "realDfs.status",
    );
    const traceCount = validateGraphwarWasmU32(resultView.getUint32(28, true), "realDfs.traceCount");
    if (traceCount === 0) {
      throw new GraphwarWasmAdapterError("invalid-session-state", "Real Step-glitch DFS returned no trace", "output");
    }
    const traceRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: traceCount, pointer: resultView.getUint32(24, true) },
      { alignment: 8, elementByteLength: STEP_GLITCH_REAL_DFS_TRACE_BYTE_LENGTH, minimumPointer: outputMinimumPointer },
    );
    const traceView = new DataView(traceRange.buffer, traceRange.byteOffset, traceRange.byteLength);
    const candidates: GraphwarWasmStepGlitchRealDfsTestTrace["candidates"][number][] = [];
    let expectedBestReachedTargetCount = 0;
    let expectedBlockedX: number | undefined;
    for (let index = 0; index < traceCount; index += 1) {
      const offset = index * STEP_GLITCH_REAL_DFS_TRACE_BYTE_LENGTH;
      const kindValue = traceView.getUint32(offset, true);
      const pathCount = validateGraphwarWasmU32(traceView.getUint32(offset + 12, true), "realDfs.pathCount");
      const pathXRange = validateGraphwarWasmMemoryRange(
        runtime,
        { length: pathCount, pointer: traceView.getUint32(offset + 4, true) },
        { alignment: 8, elementByteLength: 8, minimumPointer: runtime.arenaBase },
      );
      const pathYRange = validateGraphwarWasmMemoryRange(
        runtime,
        { length: pathCount, pointer: traceView.getUint32(offset + 8, true) },
        { alignment: 8, elementByteLength: 8, minimumPointer: runtime.arenaBase },
      );
      const pathXs = new Float64Array(pathXRange.buffer, pathXRange.byteOffset, pathCount);
      const pathYs = new Float64Array(pathYRange.buffer, pathYRange.byteOffset, pathCount);
      const path = Array.from({ length: pathCount }, (_value, pathIndex) => {
        const point = createPixelPoint(pathXs[pathIndex] ?? Number.NaN, pathYs[pathIndex] ?? Number.NaN);
        if (!isGraphwarTrajectoryPoint(point)) {
          throw new GraphwarWasmAdapterError(
            "invalid-session-state",
            "Real Step-glitch DFS path is non-finite",
            "output",
          );
        }
        return point;
      });
      const windowMode = validateGraphwarWasmEnumValue(
        traceView.getUint32(offset + 24, true),
        [0, 1] as const,
        "realDfs.windowMode",
      );
      const windowCount = validateGraphwarWasmU32(traceView.getUint32(offset + 20, true), "realDfs.windowCount");
      let windows: GraphwarWasmStepGlitchRealDfsTestTrace["candidates"][number]["windows"] = { type: "automatic" };
      if (windowMode === 1) {
        if (windowCount !== pathCount - 1) {
          throw new GraphwarWasmAdapterError(
            "invalid-session-state",
            "Real Step-glitch DFS window count disagrees",
            "output",
          );
        }
        const windowRange = validateGraphwarWasmMemoryRange(
          runtime,
          { length: windowCount, pointer: traceView.getUint32(offset + 16, true) },
          { alignment: 8, elementByteLength: STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH, minimumPointer: runtime.arenaBase },
        );
        const windowView = new DataView(windowRange.buffer, windowRange.byteOffset, windowRange.byteLength);
        windows = {
          segments: Array.from({ length: windowCount }, (_value, windowIndex) => {
            const windowOffset = windowIndex * STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH;
            const presence = windowView.getUint32(windowOffset, true);
            if (presence > 1 || windowView.getUint32(windowOffset + 4, true) !== 0) {
              throw new GraphwarWasmAdapterError(
                "invalid-session-state",
                "Real Step-glitch DFS window record is invalid",
                "output",
              );
            }
            if (presence === 0) return undefined;
            const startX = windowView.getFloat64(windowOffset + 8, true);
            const endX = windowView.getFloat64(windowOffset + 16, true);
            if (!Number.isFinite(startX) || !Number.isFinite(endX) || !(endX > startX)) {
              throw new GraphwarWasmAdapterError(
                "invalid-session-state",
                "Real Step-glitch DFS window is invalid",
                "output",
              );
            }
            return { endX, startX };
          }),
          type: "explicit",
        };
      } else if (windowCount !== 0 || traceView.getUint32(offset + 16, true) !== 0) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Automatic DFS candidate carries fixed windows",
          "output",
        );
      }
      const controlX = validateGraphwarWasmFiniteNumber(
        traceView.getFloat64(offset + 32, true),
        "realDfs.controlX",
        "output",
      );
      const kind = validateGraphwarWasmEnumValue(kindValue, [0, 1, 2, 3] as const, "realDfs.kind");
      const expansionOrdinal = validateGraphwarWasmU32(
        traceView.getUint32(offset + 28, true),
        "realDfs.expansionOrdinal",
      );
      const finalPoint = path.at(-1);
      const hasSourcePrefix = sourcePath.every((point, pathIndex) => pixelPointsEqual(point, path[pathIndex]));
      const explicitSegments = windows.type === "explicit" ? windows.segments : undefined;
      const expectedControlX = kind === 1 ? sourceGraphPoint.x : kind === 2 ? undefined : targetGraphPoint.x;
      if (
        expansionOrdinal !== index ||
        !hasSourcePrefix ||
        !finalPoint ||
        (expectedControlX !== undefined && !Object.is(controlX, expectedControlX)) ||
        (kind === 0 &&
          (index !== 0 ||
            windows.type !== "automatic" ||
            path.length !== sourcePath.length + 1 ||
            !pixelPointsEqual(finalPoint, input.targetPoint))) ||
        (kind === 1 &&
          (index !== 1 || windows.type !== "automatic" || !graphwarWasmPixelPathsEqual(path, sourcePath))) ||
        ((kind === 2 || kind === 3) && windows.type !== "explicit") ||
        (kind === 2 &&
          (pixelPointsEqual(finalPoint, input.targetPoint) ||
            explicitSegments?.at(-1) === undefined ||
            !Object.is(explicitSegments.at(-1)?.endX, controlX))) ||
        (kind === 3 && (!pixelPointsEqual(finalPoint, input.targetPoint) || explicitSegments?.at(-1) !== undefined))
      ) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Real Step-glitch DFS candidate identity is invalid",
          "output",
        );
      }
      const replayStatus = validateGraphwarWasmEnumValue(
        traceView.getUint32(offset + 40, true),
        [0, 1] as const,
        "realDfs.replay.status",
      );
      const launchStatus = validateGraphwarWasmEnumValue(
        traceView.getInt32(offset + 44, true),
        [0, 1] as const,
        "realDfs.replay.launchStatus",
      );
      const reachedTargetCount = validateGraphwarWasmU32(
        traceView.getUint32(offset + 48, true),
        "realDfs.replay.reachedTargetCount",
      );
      const reachedRequiredTargetCount = validateGraphwarWasmU32(
        traceView.getUint32(offset + 52, true),
        "realDfs.replay.reachedRequiredTargetCount",
      );
      if (
        reachedTargetCount >
          (kind === 1 && prefixTarget
            ? 1
            : kind === 0 || kind === 3
              ? orderedTargetSequence(requiredTargets, input.hitTarget).length
              : 0) ||
        reachedRequiredTargetCount > requiredTargets.length
      ) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Real Step-glitch DFS target counts overflow",
          "output",
        );
      }
      const expectedOrderedTargetCount =
        kind === 1 && prefixTarget
          ? 1
          : kind === 0 || kind === 3
            ? orderedTargetSequence(requiredTargets, input.hitTarget).length
            : 0;
      const acceptedFlag = validateGraphwarWasmEnumValue(
        traceView.getUint32(offset + 56, true),
        [0, 1] as const,
        "realDfs.replay.acceptedFlag",
      );
      const blockedFlag = validateGraphwarWasmEnumValue(
        traceView.getUint32(offset + 60, true),
        [0, 1] as const,
        "realDfs.replay.blockedFlag",
      );
      const stopReason = validateGraphwarWasmEnumValue(
        traceView.getInt32(offset + 96, true),
        [1, 2, 3, 4, 5, 6, 7] as const,
        "realDfs.replay.stopReason",
      );
      const targetHitIndex = traceView.getInt32(offset + 100, true);
      const requiredTargetsHitIndex = traceView.getInt32(offset + 104, true);
      const obstacleHitIndex = traceView.getInt32(offset + 108, true);
      const pointCount = validateGraphwarWasmU32(traceView.getUint32(offset + 112, true), "realDfs.replay.pointCount");
      if (traceView.getUint32(offset + 204, true) !== 0 || traceView.getUint32(offset + 208, true) !== 0) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Real Step-glitch DFS trace reserved fields are nonzero",
          "output",
        );
      }
      const acceptedSamplePointCount = validateGraphwarWasmU32(
        traceView.getUint32(offset + 128, true),
        "realDfs.replay.acceptedSamplePointCount",
      );
      const bisectionCount = validateGraphwarWasmU32(
        traceView.getUint32(offset + 120, true),
        "realDfs.replay.bisectionCount",
      );
      const minStepJumpCount = validateGraphwarWasmU32(
        traceView.getUint32(offset + 124, true),
        "realDfs.replay.minStepJumpCount",
      );
      const replayCount = validateGraphwarWasmU32(
        traceView.getUint32(offset + 132, true),
        "realDfs.replay.replayCount",
      );
      const rk4StepCount = validateGraphwarWasmU32(
        traceView.getUint32(offset + 116, true),
        "realDfs.replay.rk4StepCount",
      );
      const finalRk4StepCount = validateGraphwarWasmU32(
        traceView.getUint32(offset + 192, true),
        "realDfs.replay.finalRk4StepCount",
      );
      const finalBisectionCount = validateGraphwarWasmU32(
        traceView.getUint32(offset + 196, true),
        "realDfs.replay.finalBisectionCount",
      );
      const finalAcceptedSamplePointCount = validateGraphwarWasmU32(
        traceView.getUint32(offset + 200, true),
        "realDfs.replay.finalAcceptedSamplePointCount",
      );
      if (
        finalRk4StepCount > rk4StepCount ||
        finalBisectionCount > bisectionCount ||
        finalAcceptedSamplePointCount > acceptedSamplePointCount
      ) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Real Step-glitch DFS final counters exceed their command aggregates",
          "output",
        );
      }
      const acceptedX = traceView.getFloat64(offset + 64, true);
      const acceptedY = traceView.getFloat64(offset + 72, true);
      const blockedX = traceView.getFloat64(offset + 80, true);
      const blockedY = traceView.getFloat64(offset + 88, true);
      const replay =
        launchStatus === 0
          ? ({
              acceptedSamplePointCount,
              bisectionCount,
              finalAcceptedSamplePointCount,
              finalBisectionCount,
              finalRk4StepCount,
              launchStatus: "invalid",
              minStepJumpCount,
              reachedRequiredTargetCount,
              reachedTargetCount,
              replayCount,
              rk4StepCount,
              status: "miss",
              stopReason,
            } satisfies GraphwarWasmStepGlitchRealDfsReplaySummary)
          : (() => {
              if (
                pointCount === 0 ||
                replayCount < 1 ||
                acceptedSamplePointCount < pointCount ||
                finalAcceptedSamplePointCount < pointCount
              ) {
                throw new GraphwarWasmAdapterError(
                  "invalid-session-state",
                  "Real Step-glitch DFS physical summary is invalid",
                  "output",
                );
              }
              const hasObstacleHit = obstacleHitIndex >= 0;
              const hasCompletedOrderedTargets =
                expectedOrderedTargetCount > 0 && reachedTargetCount === expectedOrderedTargetCount;
              const hasCompletedRequiredTargets =
                requiredTargets.length > 0 && reachedRequiredTargetCount === requiredTargets.length;
              const targetCompletionIndex = Math.max(targetHitIndex, requiredTargetsHitIndex);
              if (
                targetHitIndex < -1 ||
                targetHitIndex >= pointCount ||
                requiredTargetsHitIndex < -1 ||
                requiredTargetsHitIndex >= pointCount ||
                obstacleHitIndex < -1 ||
                obstacleHitIndex >= pointCount ||
                targetHitIndex >= 0 !== hasCompletedOrderedTargets ||
                requiredTargetsHitIndex >= 0 !== hasCompletedRequiredTargets ||
                (replayStatus === 1) !== (acceptedFlag === 1) ||
                (replayStatus === 1 &&
                  (reachedTargetCount !== expectedOrderedTargetCount ||
                    reachedRequiredTargetCount !== requiredTargets.length ||
                    acceptedFlag !== 1)) ||
                (replayStatus === 1 &&
                  hasObstacleHit &&
                  (expectedOrderedTargetCount > 0 || requiredTargets.length > 0) &&
                  targetCompletionIndex >= obstacleHitIndex) ||
                hasObstacleHit !== (blockedFlag === 1) ||
                hasObstacleHit !== (stopReason === 6) ||
                (hasObstacleHit && obstacleHitIndex !== pointCount - 1) ||
                (acceptedFlag === 0 && (!Object.is(acceptedX, 0) || !Object.is(acceptedY, 0))) ||
                (acceptedFlag === 1 && acceptedX < controlX) ||
                (blockedFlag === 0 && (!Object.is(blockedX, 0) || !Object.is(blockedY, 0)))
              ) {
                throw new GraphwarWasmAdapterError(
                  "invalid-session-state",
                  "Real Step-glitch DFS replay summary fields disagree",
                  "output",
                );
              }
              const sampleIndex = validateGraphwarWasmU32(
                traceView.getUint32(offset + 184, true),
                "realDfs.replay.sampleIndex",
              );
              const stateFlags = traceView.getUint32(offset + 188, true);
              const hasPreviousPoint = sampleIndex > 0;
              const expectedStateFlags =
                (hasPreviousPoint ? 1 : 0) |
                (settings.equation === "ddy" ? 2 : 0) |
                (hasPreviousPoint && settings.equation === "ddy" ? 4 : 0);
              if (stateFlags !== expectedStateFlags) {
                throw new GraphwarWasmAdapterError(
                  "invalid-session-state",
                  "Real Step-glitch DFS terminal state flags are invalid",
                  "output",
                );
              }
              const currentX = traceView.getFloat64(offset + 136, true);
              const currentY = traceView.getFloat64(offset + 144, true);
              const currentDy = traceView.getFloat64(offset + 152, true);
              const previousX = traceView.getFloat64(offset + 160, true);
              const previousY = traceView.getFloat64(offset + 168, true);
              const previousDy = traceView.getFloat64(offset + 176, true);
              if (
                (!hasPreviousPoint && (!Object.is(previousX, 0) || !Object.is(previousY, 0))) ||
                (settings.equation !== "ddy" && (!Object.is(currentDy, 0) || !Object.is(previousDy, 0))) ||
                (settings.equation === "ddy" && !hasPreviousPoint && !Object.is(previousDy, 0))
              ) {
                throw new GraphwarWasmAdapterError(
                  "invalid-session-state",
                  "Real Step-glitch DFS terminal state contains scalars without their flags",
                  "output",
                );
              }
              const currentPoint = createGraphPoint(
                validateGraphwarWasmFiniteNumber(currentX, "realDfs.replay.currentX", "output"),
                validateGraphwarWasmFiniteNumber(currentY, "realDfs.replay.currentY", "output"),
              );
              const previousPoint = hasPreviousPoint
                ? createGraphPoint(
                    validateGraphwarWasmFiniteNumber(previousX, "realDfs.replay.previousX", "output"),
                    validateGraphwarWasmFiniteNumber(previousY, "realDfs.replay.previousY", "output"),
                  )
                : undefined;
              if (sampleIndex !== (stopReason === 4 ? pointCount : pointCount - 1)) {
                throw new GraphwarWasmAdapterError(
                  "invalid-session-state",
                  "Real Step-glitch DFS terminal sample index is invalid",
                  "output",
                );
              }
              const state = createGraphwarWasmTrajectoryPhysicalStateFromSamplingState(
                settings.equation === "ddy"
                  ? {
                      currentPoint,
                      dy: validateGraphwarWasmFiniteNumber(currentDy, "realDfs.replay.currentDy", "output"),
                      ...(previousPoint
                        ? {
                            previousDy: validateGraphwarWasmFiniteNumber(
                              previousDy,
                              "realDfs.replay.previousDy",
                              "output",
                            ),
                            previousPoint,
                          }
                        : {}),
                      sampleIndex,
                    }
                  : { currentPoint, ...(previousPoint ? { previousPoint } : {}), sampleIndex },
                settings.equation,
                "realDfs.replay.state",
              );
              if (acceptedFlag === 1 && (!Number.isFinite(acceptedX) || !Number.isFinite(acceptedY))) {
                throw new GraphwarWasmAdapterError(
                  "invalid-session-state",
                  "Real Step-glitch DFS accepted point is non-finite",
                  "output",
                );
              }
              if (blockedFlag === 1 && (!Number.isFinite(blockedX) || !Number.isFinite(blockedY))) {
                throw new GraphwarWasmAdapterError(
                  "invalid-session-state",
                  "Real Step-glitch DFS blocked point is non-finite",
                  "output",
                );
              }
              return {
                ...(acceptedFlag === 1 ? { acceptedPoint: createGraphPoint(acceptedX, acceptedY) } : {}),
                acceptedSamplePointCount,
                bisectionCount,
                ...(blockedFlag === 1 ? { blockedPoint: createGraphPoint(blockedX, blockedY) } : {}),
                finalAcceptedSamplePointCount,
                finalBisectionCount,
                finalRk4StepCount,
                launchStatus: "success",
                minStepJumpCount,
                obstacleHitIndex,
                reachedRequiredTargetCount,
                reachedTargetCount,
                replayCount,
                requiredTargetsHitIndex,
                rk4StepCount,
                state,
                status: replayStatus === 1 ? "hit" : "miss",
                stopReason,
                targetHitIndex,
                pointCount,
              } satisfies GraphwarWasmStepGlitchRealDfsReplaySummary;
            })();
      if (
        launchStatus === 0 &&
        (replayStatus !== 0 ||
          stopReason !== 2 ||
          acceptedFlag !== 0 ||
          blockedFlag !== 0 ||
          pointCount !== 0 ||
          reachedTargetCount !== 0 ||
          reachedRequiredTargetCount !== 0 ||
          targetHitIndex !== -1 ||
          requiredTargetsHitIndex !== -1 ||
          obstacleHitIndex !== -1 ||
          finalRk4StepCount !== 0 ||
          finalBisectionCount !== 0 ||
          finalAcceptedSamplePointCount !== 0 ||
          !Object.is(acceptedX, 0) ||
          !Object.is(acceptedY, 0) ||
          !Object.is(blockedX, 0) ||
          !Object.is(blockedY, 0) ||
          !Object.is(traceView.getFloat64(offset + 136, true), 0) ||
          !Object.is(traceView.getFloat64(offset + 144, true), 0) ||
          !Object.is(traceView.getFloat64(offset + 152, true), 0) ||
          !Object.is(traceView.getFloat64(offset + 160, true), 0) ||
          !Object.is(traceView.getFloat64(offset + 168, true), 0) ||
          !Object.is(traceView.getFloat64(offset + 176, true), 0) ||
          traceView.getUint32(offset + 184, true) !== 0 ||
          traceView.getUint32(offset + 188, true) !== 0)
      ) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Real Step-glitch DFS invalid launch carries physical output",
          "output",
        );
      }
      expectedBestReachedTargetCount = Math.max(
        expectedBestReachedTargetCount,
        replay.reachedTargetCount + replay.reachedRequiredTargetCount,
      );
      if (expectedBlockedX === undefined && replay.launchStatus === "success" && replay.blockedPoint) {
        expectedBlockedX = replay.blockedPoint.x;
      }
      candidates.push({
        controlX,
        expansionOrdinal,
        kind: kind === 0 ? "direct" : kind === 1 ? "prefix" : kind === 2 ? "gate" : "target",
        path,
        replay,
        windows,
      });
    }
    if (prefixPreparationValue === STEP_GLITCH_REAL_DFS_PREFIX_PREPARATION_EVIDENCE) {
      expectedBestReachedTargetCount = Math.max(
        expectedBestReachedTargetCount,
        requiredTargets.length + (prefixTarget ? 1 : 0),
      );
    }
    const hasPrefixTrace = candidates.some((candidate) => candidate.kind === "prefix");
    if (
      (prefixPreparationValue === STEP_GLITCH_REAL_DFS_PREFIX_PREPARATION_COLD) !== hasPrefixTrace ||
      (prefixPreparationValue === STEP_GLITCH_REAL_DFS_PREFIX_PREPARATION_EVIDENCE &&
        (hasPrefixTrace || !canReusePrefixEvidence))
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Real Step-glitch DFS prefix preparation source disagrees with its trace",
        "output",
      );
    }
    const expandedStates = validateGraphwarWasmU32(resultView.getUint32(8, true), "realDfs.expandedStates");
    const expectedExpandedStates = candidates.filter((candidate) => candidate.kind !== "prefix").length;
    if (
      expandedStates !== expectedExpandedStates ||
      validateGraphwarWasmU32(resultView.getUint32(12, true), "realDfs.bestReachedTargetCount") !==
        expectedBestReachedTargetCount ||
      (expectedBlockedX === undefined
        ? resultView.getUint32(16, true) !== 0 || !Object.is(resultView.getFloat64(32, true), 0)
        : resultView.getUint32(16, true) !== 1 || !Object.is(resultView.getFloat64(32, true), expectedBlockedX)) ||
      (resultStatus === 1 && candidates.at(-1)?.kind !== "direct" && candidates.at(-1)?.kind !== "target") ||
      (resultStatus === 1 && candidates.at(-1)?.replay.status !== "hit") ||
      (resultStatus === 0 &&
        candidates.at(-1)?.replay.status === "hit" &&
        (candidates.at(-1)?.kind === "direct" || candidates.at(-1)?.kind === "target"))
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Real Step-glitch DFS trace is inconsistent",
        "output",
      );
    }
    runtime.resetArena(commandMark);
    const prefixPreparation =
      prefixPreparationValue === STEP_GLITCH_REAL_DFS_PREFIX_PREPARATION_EVIDENCE
        ? "evidence"
        : prefixPreparationValue === STEP_GLITCH_REAL_DFS_PREFIX_PREPARATION_COLD
          ? "cold"
          : "none";
    return {
      bestReachedTargetCount: expectedBestReachedTargetCount,
      ...(expectedBlockedX === undefined ? {} : { blockedX: expectedBlockedX }),
      candidates,
      expandedStates,
      prefixPreparation,
      status: resultStatus === 1 ? "hit" : "no-path",
    };
  } catch (error) {
    runtime.resetArenaAfterFault(commandMark);
    throw error;
  }
}

function traceGraphwarWasmStepGlitchGeometryFrontier(
  runtime: GraphwarWasmKernelRuntime,
  contextPointer: number,
  input: GraphwarWasmStepGlitchGeometryFrontierInput,
): GraphwarWasmStepGlitchGeometryFrontierTrace {
  const integers = [input.firstBlockedSearchX, input.row, input.targetRow];
  if (
    !integers.every(Number.isInteger) ||
    input.firstBlockedSearchX < -0x8000_0000 ||
    input.firstBlockedSearchX > 0x7fff_ffff ||
    input.row < 0 ||
    input.row >= GRAPHWAR_PLANE_HEIGHT ||
    input.targetRow < 0 ||
    input.targetRow >= GRAPHWAR_PLANE_HEIGHT ||
    !Number.isFinite(input.acceptedPoint.x) ||
    !Number.isFinite(input.acceptedPoint.y) ||
    !Number.isFinite(input.target.x) ||
    !Number.isFinite(input.target.y)
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Graphwar WASM Step-glitch frontier input is outside the scanner geometry domain",
      "input",
    );
  }

  const commandMark = runtime.markArena();
  try {
    const inputPointer = runtime.reserveArena(STEP_GLITCH_TRACE_INPUT_BYTE_LENGTH, 8);
    const inputView = new DataView(runtime.buffer, inputPointer, STEP_GLITCH_TRACE_INPUT_BYTE_LENGTH);
    inputView.setUint32(0, contextPointer, true);
    inputView.setInt32(4, input.firstBlockedSearchX, true);
    inputView.setInt32(8, input.targetRow, true);
    inputView.setInt32(12, input.row, true);
    inputView.setFloat64(16, input.acceptedPoint.x, true);
    inputView.setFloat64(24, input.acceptedPoint.y, true);
    inputView.setFloat64(32, input.target.x, true);
    inputView.setFloat64(40, input.target.y, true);
    const resultPointer = runtime.runRouteTask(
      STEP_GLITCH_COMMAND_TRACE_FRONTIER,
      inputPointer,
      STEP_GLITCH_TRACE_INPUT_BYTE_LENGTH,
    );
    const resultRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: 1, pointer: resultPointer },
      { alignment: 8, elementByteLength: STEP_GLITCH_TRACE_RESULT_BYTE_LENGTH, minimumPointer: runtime.arenaBase },
    );
    const resultView = new DataView(resultRange.buffer, resultRange.byteOffset, resultRange.byteLength);
    const batchPointer = resultView.getUint32(4, true);
    const batchCount = resultView.getUint32(8, true);
    const windowPointer = resultView.getUint32(12, true);
    const windowCount = resultView.getUint32(16, true);
    const rowPointer = resultView.getUint32(20, true);
    const rowCount = resultView.getUint32(24, true);
    const firstBlockedSearchX = resultView.getInt32(28, true);
    const candidatePointer = resultView.getUint32(32, true);
    const candidateCount = resultView.getUint32(36, true);
    if (
      resultView.getUint32(0, true) !== STEP_GLITCH_TRACE_MAGIC ||
      batchCount > 3 ||
      windowCount > 33 ||
      rowCount > GRAPHWAR_PLANE_HEIGHT ||
      candidateCount > rowCount * windowCount ||
      firstBlockedSearchX !== input.firstBlockedSearchX
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM Step-glitch frontier returned an invalid result header",
        "output",
      );
    }
    const batchRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: batchCount, pointer: batchPointer },
      { alignment: 4, elementByteLength: STEP_GLITCH_TRACE_BATCH_BYTE_LENGTH, minimumPointer: runtime.arenaBase },
    );
    const windowRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: windowCount, pointer: windowPointer },
      { alignment: 8, elementByteLength: STEP_GLITCH_TRACE_WINDOW_BYTE_LENGTH, minimumPointer: runtime.arenaBase },
    );
    const rowRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: rowCount, pointer: rowPointer },
      { alignment: 4, elementByteLength: STEP_GLITCH_TRACE_ROW_BYTE_LENGTH, minimumPointer: runtime.arenaBase },
    );
    const candidateRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: candidateCount, pointer: candidatePointer },
      { alignment: 8, elementByteLength: STEP_GLITCH_TRACE_CANDIDATE_BYTE_LENGTH, minimumPointer: runtime.arenaBase },
    );
    const batchView = new DataView(batchRange.buffer, batchRange.byteOffset, batchRange.byteLength);
    let previousBackoffColumns = 0;
    let expectedWindowStart = 0;
    const batches = Array.from({ length: batchCount }, (_, index) => {
      const offset = index * STEP_GLITCH_TRACE_BATCH_BYTE_LENGTH;
      const backoffColumns = batchView.getInt32(offset, true);
      const searchX = batchView.getInt32(offset + 4, true);
      const sharedWindowSearchXValue = batchView.getInt32(offset + 8, true);
      const canPruneValue = batchView.getInt32(offset + 12, true);
      const windowStart = batchView.getUint32(offset + 16, true);
      const batchWindowCount = batchView.getUint32(offset + 20, true);
      if (
        backoffColumns <= previousBackoffColumns ||
        backoffColumns > 3 ||
        searchX < 0 ||
        searchX >= GRAPHWAR_PLANE_LENGTH ||
        sharedWindowSearchXValue < -1 ||
        sharedWindowSearchXValue >= GRAPHWAR_PLANE_LENGTH ||
        (canPruneValue !== 0 && canPruneValue !== 1) ||
        batchWindowCount === 0 ||
        windowStart !== expectedWindowStart ||
        windowStart + batchWindowCount > windowCount
      ) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Graphwar WASM Step-glitch frontier returned an invalid batch",
          "output",
        );
      }
      previousBackoffColumns = backoffColumns;
      expectedWindowStart += batchWindowCount;
      return {
        backoffColumns,
        canUseMonotonicBackoffPruning: canPruneValue === 1,
        searchX,
        sharedWindowSearchX: sharedWindowSearchXValue < 0 ? undefined : sharedWindowSearchXValue,
        windowCount: batchWindowCount,
        windowStart,
      };
    });
    if (expectedWindowStart !== windowCount) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM Step-glitch frontier returned disjoint window batches",
        "output",
      );
    }
    const windowView = new DataView(windowRange.buffer, windowRange.byteOffset, windowRange.byteLength);
    const windows = Array.from({ length: windowCount }, (_, index) => {
      const offset = index * STEP_GLITCH_TRACE_WINDOW_BYTE_LENGTH;
      const startX = windowView.getFloat64(offset, true);
      const controlX = windowView.getFloat64(offset + 8, true);
      const searchX = windowView.getInt32(offset + 16, true);
      const decimalPlaces = windowView.getInt32(offset + 20, true);
      const windowOrdinal = windowView.getInt32(offset + 24, true);
      if (
        !Number.isFinite(startX) ||
        !Number.isFinite(controlX) ||
        searchX < 0 ||
        searchX >= GRAPHWAR_PLANE_LENGTH ||
        decimalPlaces < 0 ||
        decimalPlaces > 15 ||
        windowOrdinal < 0 ||
        windowOrdinal > 10
      ) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Graphwar WASM Step-glitch frontier returned an invalid window",
          "output",
        );
      }
      return { controlX, decimalPlaces, searchX, startX, windowOrdinal };
    });
    const rowView = new DataView(rowRange.buffer, rowRange.byteOffset, rowRange.byteLength);
    const rows = Array.from({ length: rowCount }, (_, index) => {
      const offset = index * STEP_GLITCH_TRACE_ROW_BYTE_LENGTH;
      const farthestX = rowView.getInt32(offset, true);
      const row = rowView.getInt32(offset + 4, true);
      const targetDeltaY = rowView.getInt32(offset + 8, true);
      const startDeltaY = rowView.getInt32(offset + 12, true);
      const usableWindowBatchMask = rowView.getInt32(offset + 16, true);
      if (
        farthestX < 0 ||
        farthestX >= GRAPHWAR_PLANE_LENGTH ||
        row < 0 ||
        row >= GRAPHWAR_PLANE_HEIGHT ||
        targetDeltaY < 0 ||
        targetDeltaY >= GRAPHWAR_PLANE_HEIGHT ||
        startDeltaY < 0 ||
        startDeltaY >= GRAPHWAR_PLANE_HEIGHT ||
        usableWindowBatchMask < 0 ||
        usableWindowBatchMask > 0b111
      ) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Graphwar WASM Step-glitch frontier returned an invalid landing row",
          "output",
        );
      }
      return { farthestX, row, startDeltaY, targetDeltaY, usableWindowBatchMask };
    });
    const candidateView = new DataView(candidateRange.buffer, candidateRange.byteOffset, candidateRange.byteLength);
    const candidates = Array.from({ length: candidateCount }, (_, index) => {
      const offset = index * STEP_GLITCH_TRACE_CANDIDATE_BYTE_LENGTH;
      const row = candidateView.getInt32(offset, true);
      const backoffColumns = candidateView.getInt32(offset + 4, true);
      const windowOrdinal = candidateView.getInt32(offset + 8, true);
      const decimalPlaces = candidateView.getInt32(offset + 12, true);
      const startX = candidateView.getFloat64(offset + 16, true);
      const controlX = candidateView.getFloat64(offset + 24, true);
      const controlPointX = candidateView.getFloat64(offset + 32, true);
      const controlPointY = candidateView.getFloat64(offset + 40, true);
      const expansionOrdinal = candidateView.getUint32(offset + 48, true);
      if (
        row < 0 ||
        row >= GRAPHWAR_PLANE_HEIGHT ||
        backoffColumns < 1 ||
        backoffColumns > 3 ||
        windowOrdinal < 0 ||
        windowOrdinal > 10 ||
        decimalPlaces < 0 ||
        decimalPlaces > 15 ||
        !Number.isFinite(startX) ||
        !Number.isFinite(controlX) ||
        !Number.isFinite(controlPointX) ||
        !Number.isFinite(controlPointY) ||
        expansionOrdinal !== index
      ) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Graphwar WASM Step-glitch frontier returned an invalid candidate",
          "output",
        );
      }
      return {
        backoffColumns,
        controlPoint: createPixelPoint(controlPointX, controlPointY),
        controlX,
        decimalPlaces,
        expansionOrdinal,
        row,
        startX,
        windowOrdinal,
      };
    });
    runtime.resetArena(commandMark);
    return { batches, candidates, firstBlockedSearchX, rows, windows };
  } catch (error) {
    runtime.resetArenaAfterFault(commandMark);
    throw error;
  }
}

function traceGraphwarWasmStepGlitchGeometryDfs(
  runtime: GraphwarWasmKernelRuntime,
  contextPointer: number,
  bounds: GraphBounds,
  boundsRect: BoundsRect,
  sourcePath: readonly PixelPoint[],
  isMirrored: boolean,
  input: GraphwarWasmStepGlitchGeometryDfsInput,
): GraphwarWasmStepGlitchGeometryDfsTrace {
  const points = [input.prefixAcceptedPoint, input.targetPoint, input.hitTargetCenter];
  if (
    !points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) ||
    !Number.isInteger(input.prefixReachedTargetCount) ||
    input.prefixReachedTargetCount < 0 ||
    input.prefixReachedTargetCount > 0xffff_ffff ||
    (input.prefixBlockedX !== undefined && !Number.isFinite(input.prefixBlockedX)) ||
    (input.replayMode.type === "scripted" && input.replayMode.outcomes.length === 0)
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Graphwar WASM Step-glitch DFS input is outside the scanner geometry domain",
      "input",
    );
  }
  const outcomes = input.replayMode.type === "scripted" ? input.replayMode.outcomes : [];
  if (outcomes.length > 0xffff_ffff) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Graphwar WASM Step-glitch DFS replay script is too large",
      "input",
    );
  }
  for (const outcome of outcomes) {
    if (
      !Number.isInteger(outcome.reachedTargetCount) ||
      outcome.reachedTargetCount < 0 ||
      outcome.reachedTargetCount > 0xffff_ffff ||
      (outcome.blockedX !== undefined && !Number.isFinite(outcome.blockedX)) ||
      (outcome.status === "hit" &&
        (!Number.isFinite(outcome.acceptedPoint.x) || !Number.isFinite(outcome.acceptedPoint.y)))
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-formula-input",
        "Graphwar WASM Step-glitch DFS replay outcome is invalid",
        "input",
      );
    }
  }

  const commandMark = runtime.markArena();
  try {
    const scriptPointer =
      outcomes.length === 0 ? 0 : runtime.reserveArena(outcomes.length * STEP_GLITCH_DFS_SCRIPT_BYTE_LENGTH, 8);
    if (outcomes.length > 0) {
      new Uint8Array(runtime.buffer, scriptPointer, outcomes.length * STEP_GLITCH_DFS_SCRIPT_BYTE_LENGTH).fill(0);
      const scriptView = new DataView(
        runtime.buffer,
        scriptPointer,
        outcomes.length * STEP_GLITCH_DFS_SCRIPT_BYTE_LENGTH,
      );
      outcomes.forEach((outcome, index) => {
        const offset = index * STEP_GLITCH_DFS_SCRIPT_BYTE_LENGTH;
        scriptView.setUint32(offset, outcome.status === "hit" ? 1 : 0, true);
        scriptView.setUint32(offset + 4, outcome.reachedTargetCount, true);
        scriptView.setUint32(offset + 8, outcome.blockedX === undefined ? 0 : 1, true);
        if (outcome.status === "hit") {
          scriptView.setFloat64(offset + 16, outcome.acceptedPoint.x, true);
          scriptView.setFloat64(offset + 24, outcome.acceptedPoint.y, true);
        }
        if (outcome.blockedX !== undefined) {
          scriptView.setFloat64(offset + 32, outcome.blockedX, true);
        }
      });
    }
    const target = imageToGraphPoint(input.targetPoint, bounds, boundsRect);
    const targetGrid = imagePointToPlaneGridPoint(input.targetPoint, boundsRect);
    const hitTargetGrid = imagePointToPlaneGridPoint(input.hitTargetCenter, boundsRect);
    const inputPointer = runtime.reserveArena(STEP_GLITCH_DFS_INPUT_BYTE_LENGTH, 8);
    const inputView = new DataView(runtime.buffer, inputPointer, STEP_GLITCH_DFS_INPUT_BYTE_LENGTH);
    inputView.setUint32(0, contextPointer, true);
    inputView.setUint32(4, input.replayMode.type === "scripted" ? 1 : 0, true);
    inputView.setUint32(8, scriptPointer, true);
    inputView.setUint32(12, outcomes.length, true);
    inputView.setFloat64(16, input.prefixAcceptedPoint.x, true);
    inputView.setFloat64(24, input.prefixAcceptedPoint.y, true);
    inputView.setFloat64(32, target.x, true);
    inputView.setFloat64(40, target.y, true);
    inputView.setFloat64(48, input.targetPoint.x, true);
    inputView.setFloat64(56, input.targetPoint.y, true);
    inputView.setInt32(64, hitTargetGrid.y, true);
    inputView.setInt32(68, planeColumnToForwardColumn(targetGrid.x, isMirrored), true);
    inputView.setUint32(72, input.prefixReachedTargetCount, true);
    inputView.setUint32(76, input.prefixBlockedX === undefined ? 0 : 1, true);
    inputView.setFloat64(80, input.prefixBlockedX ?? 0, true);
    const resultPointer = runtime.runRouteTask(
      STEP_GLITCH_COMMAND_TRACE_DFS,
      inputPointer,
      STEP_GLITCH_DFS_INPUT_BYTE_LENGTH,
    );
    const resultRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: 1, pointer: resultPointer },
      { alignment: 8, elementByteLength: STEP_GLITCH_DFS_RESULT_BYTE_LENGTH, minimumPointer: runtime.arenaBase },
    );
    const resultView = new DataView(resultRange.buffer, resultRange.byteOffset, resultRange.byteLength);
    const resultStatus = resultView.getUint32(4, true);
    const expandedStates = resultView.getUint32(8, true);
    const bestReachedTargetCount = resultView.getUint32(12, true);
    const hasBlockedX = resultView.getUint32(16, true);
    const scriptConsumed = resultView.getUint32(20, true);
    const tracePointer = resultView.getUint32(24, true);
    const traceCount = resultView.getUint32(28, true);
    const blockedX = resultView.getFloat64(32, true);
    const maximumAllMissTraceCount = 1 + 3 * 11 * GRAPHWAR_PLANE_HEIGHT;
    if (
      resultView.getUint32(0, true) !== STEP_GLITCH_DFS_RESULT_MAGIC ||
      resultStatus > 1 ||
      hasBlockedX > 1 ||
      (hasBlockedX === 0 ? blockedX !== 0 : !Number.isFinite(blockedX)) ||
      traceCount === 0 ||
      expandedStates !== traceCount ||
      (input.replayMode.type === "scripted"
        ? scriptConsumed !== outcomes.length || traceCount !== outcomes.length
        : scriptConsumed !== 0 || traceCount > maximumAllMissTraceCount)
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM Step-glitch DFS returned an invalid result header",
        "output",
      );
    }
    const traceRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: traceCount, pointer: tracePointer },
      { alignment: 8, elementByteLength: STEP_GLITCH_DFS_TRACE_BYTE_LENGTH, minimumPointer: runtime.arenaBase },
    );
    const traceView = new DataView(traceRange.buffer, traceRange.byteOffset, traceRange.byteLength);
    let expectedBestReachedTargetCount = input.prefixReachedTargetCount;
    let expectedBlockedX: number | undefined;
    const candidates = Array.from({ length: traceCount }, (_, index) => {
      const offset = index * STEP_GLITCH_DFS_TRACE_BYTE_LENGTH;
      const kindValue = traceView.getUint32(offset, true);
      const statusValue = traceView.getUint32(offset + 4, true);
      const pathXPointer = traceView.getUint32(offset + 8, true);
      const pathYPointer = traceView.getUint32(offset + 12, true);
      const pathCount = traceView.getUint32(offset + 16, true);
      const reachedTargetCount = traceView.getUint32(offset + 20, true);
      const hasCandidateBlockedX = traceView.getUint32(offset + 24, true);
      const expansionOrdinal = traceView.getUint32(offset + 28, true);
      const acceptedX = traceView.getFloat64(offset + 32, true);
      const acceptedY = traceView.getFloat64(offset + 40, true);
      const candidateBlockedX = traceView.getFloat64(offset + 48, true);
      const expectedOutcome = outcomes[index];
      if (
        kindValue > 2 ||
        (index === 0 ? kindValue !== 0 : kindValue === 0) ||
        statusValue > 1 ||
        hasCandidateBlockedX > 1 ||
        expansionOrdinal !== index ||
        pathCount < sourcePath.length + 1 ||
        pathCount > sourcePath.length + traceCount ||
        (statusValue === 0
          ? acceptedX !== 0 || acceptedY !== 0
          : !Number.isFinite(acceptedX) || !Number.isFinite(acceptedY)) ||
        (hasCandidateBlockedX === 0 ? candidateBlockedX !== 0 : !Number.isFinite(candidateBlockedX)) ||
        (input.replayMode.type === "all-miss" &&
          (statusValue !== 0 || reachedTargetCount !== 0 || hasCandidateBlockedX !== 0)) ||
        (expectedOutcome !== undefined &&
          (statusValue !== (expectedOutcome.status === "hit" ? 1 : 0) ||
            reachedTargetCount !== expectedOutcome.reachedTargetCount ||
            hasCandidateBlockedX !== (expectedOutcome.blockedX === undefined ? 0 : 1) ||
            (expectedOutcome.status === "hit" &&
              (acceptedX !== expectedOutcome.acceptedPoint.x || acceptedY !== expectedOutcome.acceptedPoint.y)) ||
            (expectedOutcome.blockedX !== undefined && candidateBlockedX !== expectedOutcome.blockedX)))
      ) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Graphwar WASM Step-glitch DFS returned an invalid candidate trace",
          "output",
        );
      }
      const pathXRange = validateGraphwarWasmMemoryRange(
        runtime,
        { length: pathCount, pointer: pathXPointer },
        { alignment: 8, elementByteLength: 8, minimumPointer: runtime.arenaBase },
      );
      const pathYRange = validateGraphwarWasmMemoryRange(
        runtime,
        { length: pathCount, pointer: pathYPointer },
        { alignment: 8, elementByteLength: 8, minimumPointer: runtime.arenaBase },
      );
      const pathXs = new Float64Array(pathXRange.buffer, pathXRange.byteOffset, pathCount);
      const pathYs = new Float64Array(pathYRange.buffer, pathYRange.byteOffset, pathCount);
      const path = Array.from({ length: pathCount }, (_, pathIndex) => {
        const x = pathXs[pathIndex];
        const y = pathYs[pathIndex];
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          throw new GraphwarWasmAdapterError(
            "invalid-session-state",
            "Graphwar WASM Step-glitch DFS returned a non-finite path",
            "output",
          );
        }
        return createPixelPoint(x, y);
      });
      const finalPathPoint = path.at(-1);
      if (
        sourcePath.some((point, pathIndex) => {
          const pathPoint = path[pathIndex];
          return pathPoint === undefined || !pixelPointsEqual(point, pathPoint);
        }) ||
        !finalPathPoint ||
        (kindValue === 0 &&
          (path.length !== sourcePath.length + 1 || !pixelPointsEqual(finalPathPoint, input.targetPoint))) ||
        (kindValue === 1 && pixelPointsEqual(finalPathPoint, input.targetPoint)) ||
        (kindValue === 2 &&
          (path.length === sourcePath.length + 1 || !pixelPointsEqual(finalPathPoint, input.targetPoint)))
      ) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Graphwar WASM Step-glitch DFS returned an invalid candidate path",
          "output",
        );
      }
      expectedBestReachedTargetCount = Math.max(expectedBestReachedTargetCount, reachedTargetCount);
      if (expectedBlockedX === undefined && hasCandidateBlockedX === 1) {
        expectedBlockedX = candidateBlockedX;
      }
      if (index === 0 && expectedBlockedX === undefined) {
        expectedBlockedX = input.prefixBlockedX;
      }
      const kind: GraphwarWasmStepGlitchGeometryDfsCandidateTrace["kind"] =
        kindValue === 0 ? "direct" : kindValue === 1 ? "gate" : "target";
      const candidate = {
        ...(hasCandidateBlockedX === 1 ? { blockedX: candidateBlockedX } : {}),
        expansionOrdinal,
        kind,
        path,
        reachedTargetCount,
      } satisfies Omit<GraphwarWasmStepGlitchGeometryDfsCandidateTrace, "acceptedPoint" | "status">;
      return statusValue === 1
        ? ({
            ...candidate,
            acceptedPoint: createGraphPoint(acceptedX, acceptedY),
            status: "hit",
          } satisfies GraphwarWasmStepGlitchGeometryDfsCandidateTrace)
        : ({ ...candidate, status: "miss" } satisfies GraphwarWasmStepGlitchGeometryDfsCandidateTrace);
    });
    for (let index = 1; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (!candidate) {
        continue;
      }
      const parentPath = candidate.path.slice(0, -1);
      const hasValidParent =
        graphwarWasmPixelPathsEqual(parentPath, sourcePath) ||
        candidates
          .slice(1, index)
          .some(
            (parentCandidate) =>
              parentCandidate.kind === "gate" &&
              parentCandidate.status === "hit" &&
              parentCandidate.acceptedPoint.x < target.x &&
              graphwarWasmPixelPathsEqual(parentCandidate.path, parentPath),
          );
      if (!hasValidParent) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Graphwar WASM Step-glitch DFS returned a path without a successful parent",
          "output",
        );
      }
    }
    const terminalHitIndex = candidates.findIndex(
      (candidate) => candidate.status === "hit" && (candidate.kind === "direct" || candidate.kind === "target"),
    );
    if (
      bestReachedTargetCount !== expectedBestReachedTargetCount ||
      (expectedBlockedX === undefined ? hasBlockedX !== 0 : hasBlockedX !== 1 || blockedX !== expectedBlockedX) ||
      terminalHitIndex !== (resultStatus === 1 ? candidates.length - 1 : -1)
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM Step-glitch DFS returned an inconsistent terminal trace",
        "output",
      );
    }
    runtime.resetArena(commandMark);
    return {
      bestReachedTargetCount,
      ...(hasBlockedX === 1 ? { blockedX } : {}),
      candidates,
      expandedStates,
      scriptConsumed,
      status: resultStatus === 1 ? "hit" : "no-path",
    };
  } catch (error) {
    runtime.resetArenaAfterFault(commandMark);
    throw error;
  }
}

/** Serializes every nested 8B0 evidence range once so later raw commands never need TS-side splicing. */
function writePrefixEvidenceDescriptor(
  runtime: GraphwarWasmKernelRuntime,
  evidence: GraphwarWasmPackedStepGlitchPrefixEvidence,
): GraphwarWasmMemorySlice {
  const pointer = runtime.reserveArena(STEP_GLITCH_PREFIX_EVIDENCE_BYTE_LENGTH, 4);
  const view = new DataView(runtime.buffer, pointer, STEP_GLITCH_PREFIX_EVIDENCE_BYTE_LENGTH);
  if (evidence.type === "none") {
    new Uint8Array(runtime.buffer, pointer, STEP_GLITCH_PREFIX_EVIDENCE_BYTE_LENGTH).fill(0);
    return { length: STEP_GLITCH_PREFIX_EVIDENCE_BYTE_LENGTH, pointer };
  }

  const prefix = evidence.formulaEvidence.prefix;
  const boundary = evidence.formulaEvidence.boundaryState;
  const maskTag =
    prefix.settings.mask.type === "none"
      ? 0
      : prefix.settings.mask.type === "context-mask"
        ? 1
        : prefix.settings.mask.type === "evidence-mask"
          ? 2
          : 3;
  const fields = [
    1,
    evidence.identityMask.pointer,
    evidence.identityMask.length,
    evidence.values.pointer,
    evidence.values.length,
    boundary.type === "state" ? 1 : 0,
    boundary.type === "state" ? boundary.formulaMaterialsIdentity.pointer : 0,
    boundary.type === "state" ? boundary.formulaMaterialsIdentity.length : 0,
    boundary.type === "state" ? boundary.state.pointer : 0,
    boundary.type === "state" ? boundary.state.length : 0,
    prefix.initialFormulaPoints.x.pointer,
    prefix.initialFormulaPoints.y.pointer,
    prefix.initialFormulaPoints.length,
    prefix.metadata.pointer,
    prefix.metadata.length,
    prefix.points.x.pointer,
    prefix.points.y.pointer,
    prefix.points.length,
    prefix.refinedFormulaPoints.x.pointer,
    prefix.refinedFormulaPoints.y.pointer,
    prefix.refinedFormulaPoints.length,
    prefix.segmentStartPoints.points.x.pointer,
    prefix.segmentStartPoints.points.y.pointer,
    prefix.segmentStartPoints.points.length,
    prefix.segmentStartPoints.presence.pointer,
    prefix.segmentStartPoints.presence.length,
    maskTag,
    prefix.settings.values.pointer,
    prefix.settings.values.length,
    prefix.signProtection.pointer,
    prefix.signProtection.length,
    prefix.stepGlitchRequirements.pointer,
    prefix.stepGlitchRequirements.length,
    prefix.stepGlitchSegments.pointer,
    prefix.stepGlitchSegments.length,
    prefix.stepSegmentDeltaYs.values.pointer,
    prefix.stepSegmentDeltaYs.values.length,
    prefix.stepSegmentDeltaYs.presence.pointer,
    prefix.stepSegmentDeltaYs.presence.length,
    evidence.requiredTargetRecords.pointer,
    evidence.requiredTargetRecords.length,
  ];
  for (let index = 0; index < fields.length; index += 1) {
    view.setUint32(index * 4, fields[index], true);
  }
  return { length: STEP_GLITCH_PREFIX_EVIDENCE_BYTE_LENGTH, pointer };
}

/** Packs scan or replay work only after its point/target ranges satisfy the scanner's business contract. */
export function packGraphwarWasmStepGlitchCommandInput(
  arena: GraphwarWasmArenaMemorySource,
  context: GraphwarWasmStepGlitchContextInput,
  command: GraphwarWasmStepGlitchCommandInput,
  minimumPointer = 0,
): GraphwarWasmStepGlitchCommandPackResult {
  const packedFinalValidation = packGraphwarWasmStepGlitchCommandFinalValidation(
    arena,
    command.finalValidation,
    minimumPointer,
  );
  if (!packedFinalValidation) {
    return { status: "invalid-input" };
  }
  if (command.type === "replay") {
    if (
      !Number.isFinite(command.controlX) ||
      command.path.length < 2 ||
      command.path.length < context.sourcePath.length ||
      !command.path.every(isGraphwarTrajectoryPoint) ||
      !context.sourcePath.every((point, index) => pixelPointsEqual(point, command.path[index])) ||
      !targetsAreValid(command.targetSequence)
    ) {
      return { status: "invalid-input" };
    }
    const windows = command.windows ?? { type: "automatic" as const };
    if (windows.type === "explicit" && windows.segments.length !== command.path.length - 1) {
      return { status: "invalid-input" };
    }
    return {
      input: {
        controlX: command.controlX,
        finalValidation: packedFinalValidation,
        path: packGraphwarWasmPointSoA(arena, command.path, minimumPointer),
        targetSequenceRecords: packTargets(arena, command.targetSequence, minimumPointer),
        windows: packGraphwarWasmStepGlitchCandidateWindows(arena, command.path.length - 1, windows),
        type: "replay",
      },
      status: "ready",
    };
  }

  if (!targetIsValid(command.hitTarget) || !isGraphwarTrajectoryPoint(command.targetPoint)) {
    return { status: "invalid-input" };
  }
  const sourcePoint = context.sourcePath.at(-1);
  if (!sourcePoint) {
    return { status: "invalid-input" };
  }
  const sourceGraphPoint = imageToGraphPoint(sourcePoint, context.bounds, context.boundsRect);
  const targetGraphPoint = imageToGraphPoint(command.targetPoint, context.bounds, context.boundsRect);
  if (!graphXAdvancesStrictly(sourceGraphPoint.x, targetGraphPoint.x)) {
    return { status: "invalid-input" };
  }
  return {
    input: {
      finalValidation: packedFinalValidation,
      targetValues: writeGraphwarWasmFloat64Values(
        arena,
        new Float64Array([
          command.hitTarget.center.x,
          command.hitTarget.center.y,
          command.hitTarget.radius,
          command.targetPoint.x,
          command.targetPoint.y,
        ]),
        minimumPointer,
      ),
      type: "scan",
    },
    status: "ready",
  };
}

function packGraphwarWasmStepGlitchCommandFinalValidation(
  arena: GraphwarWasmArenaMemorySource,
  finalValidation: GraphwarWasmStepGlitchFinalValidationInput,
  minimumPointer: number,
): GraphwarWasmPackedStepGlitchFinalValidation | undefined {
  if (finalValidation.type === "none") {
    return { type: "none" };
  }
  const simulationMaskCacheId = validateGraphwarWasmU32(
    finalValidation.simulationMaskCacheId,
    "simulationMaskCacheId",
    "input",
  );
  if (
    !finalValidation.targetControlPoints.every(isGraphwarTrajectoryPoint) ||
    !targetsAreValid(finalValidation.trackedTargets)
  ) {
    return undefined;
  }
  return {
    simulationMaskCacheId,
    targetControlPoints: packGraphwarWasmPointSoA(arena, finalValidation.targetControlPoints, minimumPointer),
    trackedTargetRecords: packTargets(arena, finalValidation.trackedTargets, minimumPointer),
    type: "validate",
  };
}

/** Raw status tags are business outcomes; only an unknown tag is an ABI/output fault. */
export function decodeGraphwarWasmStepGlitchBusinessStatus(value: unknown): GraphwarWasmStepGlitchBusinessStatus {
  switch (validateGraphwarWasmEnumValue(value, [1, 2, 3, 4] as const, "stepGlitchStatus")) {
    case 1:
      return "hit";
    case 2:
      return "no-path";
    case 3:
      return "invalid-input";
    case 4:
      return "unsupported";
  }
}

function packPrefixEvidence(
  arena: GraphwarWasmArenaMemorySource,
  input: GraphwarWasmStepGlitchPrefixEvidenceInput,
  minimumPointer: number,
): GraphwarWasmPackedStepGlitchPrefixEvidence {
  if (input.type === "none") {
    return { type: "none" };
  }
  const evidence = input.evidence;
  const identity = evidence.replayIdentity;
  if (!isGraphwarPlaneMask(identity.simulationMask)) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Step-glitch prefix evidence mask is incomplete",
      "input",
    );
  }
  return {
    formulaEvidence: packFormulaEvidence(arena, evidence.formulaEvidence, identity.simulationMask, minimumPointer),
    identityMask: packGraphwarPlaneMask(arena, identity.simulationMask, minimumPointer),
    requiredTargetRecords: packTargets(arena, identity.requiredTargets, minimumPointer),
    type: "candidate",
    values: writeGraphwarWasmFloat64Values(
      arena,
      new Float64Array([
        validateGraphwarWasmFiniteNumber(evidence.acceptedPoint.x, "prefixEvidence.acceptedPoint.x", "input"),
        validateGraphwarWasmFiniteNumber(evidence.acceptedPoint.y, "prefixEvidence.acceptedPoint.y", "input"),
        validateNonNegativeFiniteNumber(identity.boundaryExpansion, "prefixEvidence.boundaryExpansion"),
        validateGraphwarWasmFiniteNumber(
          identity.prefixTarget.center.x,
          "prefixEvidence.prefixTarget.center.x",
          "input",
        ),
        validateGraphwarWasmFiniteNumber(
          identity.prefixTarget.center.y,
          "prefixEvidence.prefixTarget.center.y",
          "input",
        ),
        validateNonNegativeFiniteNumber(identity.prefixTarget.radius, "prefixEvidence.prefixTarget.radius"),
        graphwarStepGlitchPrefixEvidenceHasValidIdentity(evidence) ? 1 : 0,
      ]),
      minimumPointer,
    ),
  };
}

function packFormulaEvidence(
  arena: GraphwarWasmArenaMemorySource,
  evidence: GraphwarStepGlitchFormulaEvidence,
  evidenceMask: Uint8Array,
  minimumPointer: number,
): GraphwarWasmPackedStepGlitchFormulaEvidence {
  const prefix = packFormulaPrefix(arena, evidence.prefix, evidenceMask, minimumPointer);
  const boundaryState = evidence.boundaryState;
  if (!boundaryState) {
    return { boundaryState: { type: "none" }, prefix };
  }
  if (boundaryState.prefix !== evidence.prefix) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Step-glitch boundary state is not bound to its enclosing prefix",
      "input",
    );
  }
  if (boundaryState.segmentCount !== evidence.prefix.points.length - 1) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Step-glitch boundary state does not describe the complete prefix",
      "input",
    );
  }
  const physicalState = createGraphwarWasmTrajectoryPhysicalStateFromSamplingState(
    boundaryState.state,
    evidence.prefix.settings.equation,
    "boundaryState",
  );
  const isSecondOrder = physicalState.equation === "ddy";
  const previousPoint = isSecondOrder ? physicalState.previous?.point : physicalState.previousPoint;
  const previousDy = isSecondOrder ? physicalState.previous?.dy : undefined;
  const hasLaunchAngle = boundaryState.launchAngleRadians !== undefined;
  return {
    boundaryState: {
      formulaMaterialsIdentity: writeGraphwarWasmBytes(
        arena,
        new TextEncoder().encode(boundaryState.formulaMaterialsIdentity),
        minimumPointer,
      ),
      state: writeGraphwarWasmFloat64Values(
        arena,
        new Float64Array([
          validateGraphwarWasmFiniteNumber(boundaryState.stopX, "boundaryState.stopX", "input"),
          validateGraphwarWasmU32(boundaryState.segmentCount, "boundaryState.segmentCount", "input"),
          hasLaunchAngle
            ? validateGraphwarWasmFiniteNumber(
                boundaryState.launchAngleRadians,
                "boundaryState.launchAngleRadians",
                "input",
              )
            : 0,
          physicalState.currentPoint.x,
          physicalState.currentPoint.y,
          isSecondOrder ? physicalState.currentDy : 0,
          previousPoint?.x ?? 0,
          previousPoint?.y ?? 0,
          previousDy ?? 0,
          physicalState.sampleIndex,
          (hasLaunchAngle ? 1 : 0) |
            (isSecondOrder ? 2 : 0) |
            (previousPoint ? 4 : 0) |
            (previousDy === undefined ? 0 : 8),
        ]),
        minimumPointer,
      ),
      type: "state",
    },
    prefix,
  };
}

function packFormulaPrefix(
  arena: GraphwarWasmArenaMemorySource,
  prefix: GraphwarStepGlitchFormulaPrefix,
  evidenceMask: Uint8Array,
  minimumPointer: number,
): GraphwarWasmPackedStepGlitchFormulaPrefix {
  const segmentCount = prefix.points.length - 1;
  if (
    segmentCount < 0 ||
    prefix.initialFormulaPoints.length !== prefix.points.length ||
    prefix.refinedFormulaPoints.length !== prefix.points.length ||
    prefix.segmentStartPoints.length !== segmentCount ||
    prefix.stepGlitchRequirements.length !== segmentCount ||
    prefix.stepGlitchSegments.length !== segmentCount ||
    prefix.stepSegmentDeltaYs.length !== segmentCount ||
    prefix.stepGlitchRequirements.some((isRequired, index) => isRequired && !prefix.stepGlitchSegments[index])
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Step-glitch prefix arrays do not describe one complete segment range",
      "input",
    );
  }
  for (let index = segmentCount; index < prefix.signProtection.length; index += 1) {
    const protection = validateGraphwarWasmProtectionBits(
      prefix.signProtection[index],
      ALLOWED_SIGN_PROTECTION_BITS,
      `formulaEvidence.signProtection[${index}]`,
      "input",
    );
    if (protection !== 0) {
      throw new GraphwarWasmAdapterError(
        "invalid-formula-input",
        "Step-glitch sign protection has a nonzero entry beyond the complete segment range",
        "input",
      );
    }
  }
  const hasLaunchAngle = prefix.launchAngleRadians !== undefined;
  const hasSoldierCenter = prefix.soldierCenter !== undefined;
  return {
    initialFormulaPoints: packGraphwarWasmPointSoA(arena, prefix.initialFormulaPoints, minimumPointer),
    metadata: writeGraphwarWasmFloat64Values(
      arena,
      new Float64Array([
        validateGraphwarWasmFiniteNumber(prefix.bounds.minX, "formulaEvidence.bounds.minX", "input"),
        validateGraphwarWasmFiniteNumber(prefix.bounds.maxX, "formulaEvidence.bounds.maxX", "input"),
        validateGraphwarWasmFiniteNumber(prefix.bounds.minY, "formulaEvidence.bounds.minY", "input"),
        validateGraphwarWasmFiniteNumber(prefix.bounds.maxY, "formulaEvidence.bounds.maxY", "input"),
        hasLaunchAngle
          ? validateGraphwarWasmFiniteNumber(prefix.launchAngleRadians, "formulaEvidence.launchAngleRadians", "input")
          : 0,
        hasSoldierCenter
          ? validateGraphwarWasmFiniteNumber(prefix.soldierCenter.x, "formulaEvidence.soldierCenter.x", "input")
          : 0,
        hasSoldierCenter
          ? validateGraphwarWasmFiniteNumber(prefix.soldierCenter.y, "formulaEvidence.soldierCenter.y", "input")
          : 0,
        (hasLaunchAngle ? 1 : 0) | (hasSoldierCenter ? 2 : 0),
        Math.max(0, segmentCount),
      ]),
      minimumPointer,
    ),
    points: packGraphwarWasmPointSoA(arena, prefix.points, minimumPointer),
    refinedFormulaPoints: packGraphwarWasmPointSoA(arena, prefix.refinedFormulaPoints, minimumPointer),
    segmentStartPoints: packOptionalPoints(arena, prefix.segmentStartPoints, minimumPointer),
    settings: packFormulaSettings(
      arena,
      prefix.settings,
      prefix.settings.stepGlitchObstacleMask === undefined
        ? { type: "none" }
        : graphwarByteArraysEqual(prefix.settings.stepGlitchObstacleMask, evidenceMask)
          ? { type: "evidence-mask" }
          : { type: "mismatch" },
      minimumPointer,
    ),
    // Missing trailing zero protection entries are semantically identical; normalize the ABI to one value per segment.
    signProtection: writeGraphwarWasmUint32Values(
      arena,
      Uint32Array.from({ length: segmentCount }, (_value, index) =>
        validateGraphwarWasmProtectionBits(
          prefix.signProtection[index] ?? 0,
          ALLOWED_SIGN_PROTECTION_BITS,
          `formulaEvidence.signProtection[${index}]`,
          "input",
        ),
      ),
      minimumPointer,
    ),
    stepGlitchRequirements: writeGraphwarWasmBytes(
      arena,
      Uint8Array.from(prefix.stepGlitchRequirements, (isRequired) => (isRequired ? 1 : 0)),
      minimumPointer,
    ),
    stepGlitchSegments: packStepGlitchSegments(arena, prefix.stepGlitchSegments, minimumPointer),
    stepSegmentDeltaYs: packOptionalFloat64Values(arena, prefix.stepSegmentDeltaYs, minimumPointer),
  };
}

function packFormulaSettings(
  arena: GraphwarWasmArenaMemorySource,
  settings: Readonly<GraphwarTrajectoryFormulaSettings>,
  mask: GraphwarWasmPackedStepGlitchFormulaSettings["mask"],
  minimumPointer: number,
): GraphwarWasmPackedStepGlitchFormulaSettings {
  if (!isGraphwarTrajectoryFormulaSettings(settings)) {
    throw new GraphwarWasmAdapterError("invalid-formula-input", "Step-glitch formula settings are invalid", "input");
  }
  return {
    mask,
    values: writeGraphwarWasmFloat64Values(
      arena,
      new Float64Array([
        getGraphwarWasmFormulaAlgorithmTag(settings.algorithm),
        getGraphwarWasmFormulaEquationTag(settings.equation),
        settings.decimalPlaces,
        settings.steepness,
        settings.formulaPathSteepness ?? 0,
        settings.secondOrderLaunchAngleMode === "display-rounded"
          ? 2
          : settings.secondOrderLaunchAngleMode === "full-precision"
            ? 1
            : 0,
        (settings.isStepGlitchModeEnabled ? 1 : 0) |
          (settings.isStepOverflowProtectionEnabled ? 2 : 0) |
          (settings.formulaPathSteepness === undefined ? 0 : 4),
      ]),
      minimumPointer,
    ),
  };
}

function packOptionalPoints(
  arena: GraphwarWasmArenaMemorySource,
  points: readonly (GraphPoint | undefined)[],
  minimumPointer: number,
): GraphwarWasmPackedOptionalPointSoA {
  return {
    points: packGraphwarWasmPointSoA(
      arena,
      points.map((point) => point ?? { x: 0, y: 0 }),
      minimumPointer,
    ),
    presence: writeGraphwarWasmBytes(
      arena,
      Uint8Array.from(points, (point) => (point === undefined ? 0 : 1)),
      minimumPointer,
    ),
  };
}

function packOptionalFloat64Values(
  arena: GraphwarWasmArenaMemorySource,
  values: readonly (number | undefined)[],
  minimumPointer: number,
): GraphwarWasmPackedOptionalFloat64Values {
  return {
    presence: writeGraphwarWasmBytes(
      arena,
      Uint8Array.from(values, (value) => (value === undefined ? 0 : 1)),
      minimumPointer,
    ),
    values: writeGraphwarWasmFloat64Values(
      arena,
      Float64Array.from(values, (value, index) =>
        value === undefined
          ? 0
          : validateGraphwarWasmFiniteNumber(value, `formulaEvidence.optionalValues[${index}]`, "input"),
      ),
      minimumPointer,
    ),
  };
}

function packStepGlitchSegments(
  arena: GraphwarWasmArenaMemorySource,
  segments: readonly (StepGlitchSegment | undefined)[],
  minimumPointer: number,
) {
  const records = new Float64Array(segments.length * STEP_GLITCH_SEGMENT_RECORD_LENGTH);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment) {
      continue;
    }
    const offset = index * STEP_GLITCH_SEGMENT_RECORD_LENGTH;
    records[offset] = segment.equation === "dy" ? 1 : 2;
    records[offset + 1] = validateGraphwarWasmFiniteNumber(segment.startX, `segments[${index}].startX`, "input");
    records[offset + 2] = validateGraphwarWasmFiniteNumber(segment.endX, `segments[${index}].endX`, "input");
    records[offset + 3] = validateGraphwarWasmFiniteNumber(segment.targetY, `segments[${index}].targetY`, "input");
    if (
      segment.formulaDecimalPlaces !== undefined &&
      (!Number.isInteger(segment.formulaDecimalPlaces) ||
        segment.formulaDecimalPlaces < 0 ||
        segment.formulaDecimalPlaces > 15)
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-formula-input",
        `segments[${index}].formulaDecimalPlaces must be between 0 and 15`,
        "input",
      );
    }
    records[offset + 4] = segment.formulaDecimalPlaces ?? -1;
    if (segment.equation === "dy") {
      records[offset + 5] = validateGraphwarWasmFiniteNumber(
        segment.derivative,
        `segments[${index}].derivative`,
        "input",
      );
      records[offset + 6] = validateGraphwarWasmFiniteNumber(segment.gateY, `segments[${index}].gateY`, "input");
    } else {
      records[offset + 5] = validateGraphwarWasmFiniteNumber(
        segment.acceleration,
        `segments[${index}].acceleration`,
        "input",
      );
      records[offset + 6] = validateGraphwarWasmFiniteNumber(
        segment.accelerationGateY,
        `segments[${index}].accelerationGateY`,
        "input",
      );
      records[offset + 7] = validateGraphwarWasmFiniteNumber(segment.braking, `segments[${index}].braking`, "input");
      records[offset + 8] = validateGraphwarWasmFiniteNumber(
        segment.brakingGateY,
        `segments[${index}].brakingGateY`,
        "input",
      );
      records[offset + 9] = validateGraphwarWasmFiniteNumber(
        segment.pulseEndX,
        `segments[${index}].pulseEndX`,
        "input",
      );
    }
  }
  return writeGraphwarWasmFloat64Values(arena, records, minimumPointer);
}

function packTargets(
  arena: GraphwarWasmArenaMemorySource,
  targets: readonly GraphwarTrajectoryTargetCircle[],
  minimumPointer: number,
) {
  const records = new Float64Array(targets.length * 3);
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const offset = index * 3;
    records[offset] = target.center.x;
    records[offset + 1] = target.center.y;
    records[offset + 2] = target.radius;
  }
  return writeGraphwarWasmFloat64Values(arena, records, minimumPointer);
}

function targetIsValid(target: GraphwarTrajectoryTargetCircle) {
  return isGraphwarTrajectoryPoint(target.center) && Number.isFinite(target.radius) && target.radius >= 0;
}

function targetsAreValid(targets: readonly GraphwarTrajectoryTargetCircle[]) {
  return Array.isArray(targets) && targets.every(targetIsValid);
}

function orderedTargetSequence(
  requiredTargets: readonly GraphwarTrajectoryTargetCircle[],
  target: GraphwarTrajectoryTargetCircle,
) {
  return requiredTargets.some(
    (required) =>
      required.center.x === target.center.x &&
      required.center.y === target.center.y &&
      required.radius === target.radius,
  )
    ? []
    : [target];
}

function isGraphwarPlaneMask(mask: unknown): mask is Uint8Array {
  return mask instanceof Uint8Array && mask.length === GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT;
}

function hasFiniteBounds(bounds: GraphBounds) {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxY) &&
    bounds.minX !== bounds.maxX &&
    bounds.minY !== bounds.maxY
  );
}

function hasFiniteBoundsRect(boundsRect: BoundsRect) {
  return (
    Number.isFinite(boundsRect.x) &&
    Number.isFinite(boundsRect.y) &&
    Number.isFinite(boundsRect.width) &&
    boundsRect.width > 0 &&
    Number.isFinite(boundsRect.height) &&
    boundsRect.height > 0
  );
}

function validateNonNegativeFiniteNumber(value: unknown, fieldName: string) {
  const result = validateGraphwarWasmFiniteNumber(value, fieldName, "input");
  if (result < 0) {
    throw new GraphwarWasmAdapterError("invalid-finite-number", `${fieldName} must be non-negative`, "input");
  }
  return result;
}
