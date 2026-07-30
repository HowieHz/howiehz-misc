import { GRAPHWAR_FUNC_MAX_STEPS, GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { graphToImagePoint, imageToGraphPoint, pixelPointsEqual } from "../../core/geometry";
import { graphXAdvancesStrictly } from "../../core/numbers";
import { imagePointToPlaneGridPoint, planeColumnToForwardColumn } from "../../core/plane-grid";
import { createGraphPoint, createPixelPoint } from "../../core/types";
import type { BoundsRect, GraphBounds, GraphPoint, PixelPoint } from "../../core/types";
import type { StepGlitchSegment } from "../../formula/generation/step-numeric-strategy";
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
const STEP_GLITCH_CREATE_INPUT_BYTE_LENGTH = 52;
const STEP_GLITCH_CONTEXT_BYTE_LENGTH = 72;
const STEP_GLITCH_CONTEXT_MAGIC = 0x5347_4354;
const STEP_GLITCH_CONTEXT_FLAG_MIRRORED = 1;
const STEP_GLITCH_PREFIX_EVIDENCE_BYTE_LENGTH = 156;
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
const STEP_GLITCH_REPLAY_RESULT_BYTE_LENGTH = 168;
const STEP_GLITCH_REPLAY_RESULT_MAGIC = 0x5347_5252;
const STEP_GLITCH_REAL_DFS_INPUT_BYTE_LENGTH = 16;
const STEP_GLITCH_REAL_DFS_TARGET_VALUE_COUNT = 5;
const STEP_GLITCH_REAL_DFS_RESULT_BYTE_LENGTH = 40;
const STEP_GLITCH_REAL_DFS_RESULT_MAGIC = 0x5347_5244;
const STEP_GLITCH_REAL_DFS_TRACE_BYTE_LENGTH = 200;

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
      path: readonly PixelPoint[];
      targetSequence: readonly GraphwarTrajectoryTargetCircle[];
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
      path: GraphwarWasmPackedPointSoA;
      targetSequenceRecords: GraphwarWasmMemorySlice;
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
  status: "hit" | "no-path";
}

export type GraphwarWasmStepGlitchRealDfsReplaySummary =
  | {
      acceptedSamplePointCount: number;
      bisectionCount: number;
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
      launchStatus: "success";
      minStepJumpCount: number;
      obstacleHitIndex: number;
      observedSignProtection: readonly number[];
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
  formulaContext: GraphwarTrajectoryFormulaContext & {
    stepGlitchFormulaEvidence: GraphwarStepGlitchFormulaEvidence;
  };
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
): GraphwarWasmStepGlitchCommandInput {
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
    const prefixTargetSnapshot =
      input.prefixTarget.type === "target"
        ? {
            center: createPixelPoint(input.prefixTarget.target.center.x, input.prefixTarget.target.center.y),
            radius: input.prefixTarget.target.radius,
          }
        : undefined;
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
  runtime: GraphwarWasmKernelRuntime,
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
        stateFlags !== 0
      ) {
        throwGraphwarWasmStepGlitchReplayResultError("Invalid launch replay contains physical output");
      }
      const result = {
        acceptedSamplePointCount,
        bisectionCount,
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
      launchStatus: "success",
      minStepJumpCount,
      obstacleHitIndex,
      observedSignProtection,
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
    if (resultView.getUint32(0, true) !== STEP_GLITCH_REAL_DFS_RESULT_MAGIC || resultView.getUint32(20, true) !== 0) {
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
      if (traceView.getUint32(offset + 192, true) !== 0 || traceView.getUint32(offset + 196, true) !== 0) {
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
      const acceptedX = traceView.getFloat64(offset + 64, true);
      const acceptedY = traceView.getFloat64(offset + 72, true);
      const blockedX = traceView.getFloat64(offset + 80, true);
      const blockedY = traceView.getFloat64(offset + 88, true);
      const replay =
        launchStatus === 0
          ? ({
              acceptedSamplePointCount,
              bisectionCount,
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
              if (pointCount === 0 || replayCount < 1 || acceptedSamplePointCount < pointCount) {
                throw new GraphwarWasmAdapterError(
                  "invalid-session-state",
                  "Real Step-glitch DFS physical summary is invalid",
                  "output",
                );
              }
              const hasObstacleHit = obstacleHitIndex >= 0;
              if (
                targetHitIndex < -1 ||
                targetHitIndex >= pointCount ||
                requiredTargetsHitIndex < -1 ||
                requiredTargetsHitIndex >= pointCount ||
                obstacleHitIndex < -1 ||
                obstacleHitIndex >= pointCount ||
                (replayStatus === 1) !== (acceptedFlag === 1) ||
                (replayStatus === 1 &&
                  (reachedTargetCount !== expectedOrderedTargetCount ||
                    reachedRequiredTargetCount !== requiredTargets.length ||
                    acceptedFlag !== 1)) ||
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
              const stateFlags = traceView.getUint32(offset + 188, true);
              const expectedStateFlags =
                (stateFlags & 1) |
                (settings.equation === "ddy" ? 2 : 0) |
                ((stateFlags & 1) !== 0 && settings.equation === "ddy" ? 4 : 0);
              if (stateFlags !== expectedStateFlags) {
                throw new GraphwarWasmAdapterError(
                  "invalid-session-state",
                  "Real Step-glitch DFS terminal state flags are invalid",
                  "output",
                );
              }
              const hasPreviousPoint = (stateFlags & 1) !== 0;
              const currentPoint = createGraphPoint(
                validateGraphwarWasmFiniteNumber(
                  traceView.getFloat64(offset + 136, true),
                  "realDfs.replay.currentX",
                  "output",
                ),
                validateGraphwarWasmFiniteNumber(
                  traceView.getFloat64(offset + 144, true),
                  "realDfs.replay.currentY",
                  "output",
                ),
              );
              const previousPoint = hasPreviousPoint
                ? createGraphPoint(
                    validateGraphwarWasmFiniteNumber(
                      traceView.getFloat64(offset + 160, true),
                      "realDfs.replay.previousX",
                      "output",
                    ),
                    validateGraphwarWasmFiniteNumber(
                      traceView.getFloat64(offset + 168, true),
                      "realDfs.replay.previousY",
                      "output",
                    ),
                  )
                : undefined;
              const sampleIndex = validateGraphwarWasmU32(
                traceView.getUint32(offset + 184, true),
                "realDfs.replay.sampleIndex",
              );
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
                      dy: validateGraphwarWasmFiniteNumber(
                        traceView.getFloat64(offset + 152, true),
                        "realDfs.replay.currentDy",
                        "output",
                      ),
                      ...(previousPoint
                        ? {
                            previousDy: validateGraphwarWasmFiniteNumber(
                              traceView.getFloat64(offset + 176, true),
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
          acceptedFlag !== 0 ||
          blockedFlag !== 0 ||
          pointCount !== 0 ||
          reachedTargetCount !== 0 ||
          reachedRequiredTargetCount !== 0 ||
          targetHitIndex !== -1 ||
          requiredTargetsHitIndex !== -1 ||
          obstacleHitIndex !== -1 ||
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
    const expandedStates = validateGraphwarWasmU32(resultView.getUint32(8, true), "realDfs.expandedStates");
    const expectedExpandedStates = candidates.filter((candidate) => candidate.kind !== "prefix").length;
    if (
      expandedStates !== expectedExpandedStates ||
      validateGraphwarWasmU32(resultView.getUint32(12, true), "realDfs.bestReachedTargetCount") !==
        expectedBestReachedTargetCount ||
      (expectedBlockedX === undefined
        ? resultView.getUint32(16, true) !== 0
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
    return {
      bestReachedTargetCount: expectedBestReachedTargetCount,
      ...(expectedBlockedX === undefined ? {} : { blockedX: expectedBlockedX }),
      candidates,
      expandedStates,
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
    return {
      input: {
        controlX: command.controlX,
        path: packGraphwarWasmPointSoA(arena, command.path, minimumPointer),
        targetSequenceRecords: packTargets(arena, command.targetSequence, minimumPointer),
        type: "replay",
      },
      status: "ready",
    };
  }

  const finalValidation = command.finalValidation;
  let simulationMaskCacheId = 0;
  if (finalValidation.type === "validate") {
    simulationMaskCacheId = validateGraphwarWasmU32(
      finalValidation.simulationMaskCacheId,
      "simulationMaskCacheId",
      "input",
    );
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
  if (finalValidation.type === "validate") {
    if (
      !finalValidation.targetControlPoints.every(isGraphwarTrajectoryPoint) ||
      !targetsAreValid(finalValidation.trackedTargets)
    ) {
      return { status: "invalid-input" };
    }
  }
  return {
    input: {
      finalValidation:
        finalValidation.type === "none"
          ? { type: "none" }
          : {
              simulationMaskCacheId,
              targetControlPoints: packGraphwarWasmPointSoA(arena, finalValidation.targetControlPoints, minimumPointer),
              trackedTargetRecords: packTargets(arena, finalValidation.trackedTargets, minimumPointer),
              type: "validate",
            },
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
