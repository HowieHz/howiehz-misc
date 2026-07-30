import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { imageToGraphPoint, pixelPointsEqual } from "../../core/geometry";
import { graphXAdvancesStrictly } from "../../core/numbers";
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
import {
  GraphwarWasmAdapterError,
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
const STEP_GLITCH_CREATE_INPUT_BYTE_LENGTH = 52;
const STEP_GLITCH_CONTEXT_BYTE_LENGTH = 72;
const STEP_GLITCH_CONTEXT_MAGIC = 0x5347_4354;
const STEP_GLITCH_CONTEXT_FLAG_MIRRORED = 1;
const STEP_GLITCH_PREFIX_EVIDENCE_BYTE_LENGTH = 156;
const STEP_GLITCH_PLANE_CELL_COUNT = GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT;

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
}

export type GraphwarWasmStepGlitchGeometryContextCreateResult =
  | { status: "invalid-input" | "unsupported" }
  | { context: GraphwarWasmStepGlitchGeometryTestContext; status: "ready" };

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
      },
      status: "ready",
    };
  } catch (error) {
    runtime.resetArenaAfterFault(contextMark);
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
