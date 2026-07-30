import type { GraphwarExpressionProgram } from "../../formula/expression/program";
import type {
  CompiledAbsConnectorSegment,
  CompiledAbsSecondDerivativePulse,
  CompiledGraphwarFormulaMaterials,
  CompiledSoftCubicSegment,
  CompiledStepTerm,
} from "../../formula/generation/build";
import { GraphwarSignRole } from "../../formula/generation/build";
import type { FormulaEvaluationOptions, StepGlitchSegment } from "../../formula/generation/step-numeric-strategy";
import { resolveFormulaModeContract } from "../../formula/mode-contract";
import {
  isGraphwarTrajectoryFormulaSettings,
  isGraphwarTrajectoryPoint,
} from "../../formula/trajectory/input-validation";
import { GRAPHWAR_FUNC_MAX_STEPS } from "../game/constants";
import { graphwarToolDefaults } from "../tool/defaults";
import {
  createGraphPoint,
  createPixelPoint,
  type AlgorithmMode,
  type EquationMode,
  type GraphBounds,
  type GraphPoint,
  type PixelPoint,
} from "../types";
import {
  GraphwarWasmAdapterError,
  copyGraphwarWasmFloat64Values,
  copyGraphwarWasmUint32Values,
  validateGraphwarWasmMemoryRange,
  validateGraphwarWasmFiniteNumber,
  validateGraphwarWasmPathError,
  validateGraphwarWasmProtectionBits,
  validateGraphwarWasmU32,
  writeGraphwarWasmBytes,
  writeGraphwarWasmFloat64Values,
  writeGraphwarWasmUint32Values,
} from "./abi";
import { GraphwarWasmKernelRuntime } from "./runtime";
import {
  getGraphwarWasmFormulaAlgorithmTag,
  getGraphwarWasmFormulaEquationTag,
  packGraphwarWasmExpressionProgram,
  packGraphwarWasmPointSoA,
  packGraphwarWasmStopPolicy,
  validateGraphwarWasmSecondOrderLaunchAngle,
  type GraphwarWasmFormulaInputDescriptor,
  type GraphwarWasmStopPolicy,
} from "./task-adapter";
import type { GraphwarWasmTrajectoryPhysicalState } from "./trajectory-state-adapter";

export type { GraphwarWasmTrajectoryPhysicalState } from "./trajectory-state-adapter";

const EXPRESSION_INPUT_BYTE_LENGTH = 36;
const FORMULA_INPUT_BYTE_LENGTH = 176;
const FORMULA_RESULT_BYTE_LENGTH = 48;
const FORMULA_LAUNCH_RESULT_BYTE_LENGTH = 80;
const STEP_GLITCH_RECORD_BYTE_LENGTH = 72;
const ABS_CONNECTOR_BYTE_LENGTH = 40;
const ABS_PULSE_BYTE_LENGTH = 16;
const SOFT_CUBIC_BYTE_LENGTH = 144;
const STEP_MATERIAL_BYTE_LENGTH = 112;

const FORMULA_COMMAND_EVALUATE_EXPRESSION_BATCH = 1;
const FORMULA_COMMAND_EVALUATE_CURVE_BATCH = 2;
const FORMULA_COMMAND_EVALUATE_STEP_BATCH = 3;
const FORMULA_COMMAND_PREPARE_LAUNCH = 4;

const FORMULA_MATERIAL_ABS_CONNECTOR = 1;
const FORMULA_MATERIAL_ABS_SECOND_DERIVATIVE = 2;
const FORMULA_MATERIAL_SOFT_CUBIC = 3;
const FORMULA_MATERIAL_STEP = 4;

const FORMULA_FLAG_STEP_OVERFLOW_PROTECTION = 1;
const FORMULA_FLAG_DISPLAY_ROUNDED_ANGLE = 2;
const FORMULA_FLAG_HAS_USER_LAUNCH_ANGLE = 4;
const FORMULA_FLAG_STEP_GLITCH_MODE = 8;

const FORMULA_LAUNCH_STATUS_INVALID = 0;
const FORMULA_LAUNCH_STATUS_SUCCESS = 1;
const FORMULA_LAUNCH_FLAG_HAS_INITIAL_DY = 1;
const FORMULA_LAUNCH_FLAG_HAS_Y_OFFSET = 2;
const FORMULA_LAUNCH_FLAG_USED_USER_ANGLE = 4;
const TRAJECTORY_INPUT_BYTE_LENGTH = 284;
const STEP_GLITCH_COMMAND_REPLAY_TRAJECTORY_FOR_TEST = 14;
const TRAJECTORY_RESULT_BYTE_LENGTH = 224;
const TRAJECTORY_EVIDENCE_BYTE_LENGTH = 104;
const TRAJECTORY_STOP_TYPE_NATURAL = 0;
const TRAJECTORY_STOP_TYPE_STOP_X = 1;
const TRAJECTORY_STOP_TYPE_TARGETS = 2;
const TRAJECTORY_FLAG_HAS_CONTINUE_GRAPH_X = 2;
const TRAJECTORY_FLAG_COLLECT_VISIBLE_PIXELS = 4;
const TRAJECTORY_FLAG_HAS_CONTINUATION_EVIDENCE = 8;
const TRAJECTORY_FLAG_STOP_ON_TARGETS_COMPLETE = 16;
const TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_POINT = 1;
const TRAJECTORY_EVIDENCE_FLAG_HAS_DY = 2;
const TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_DY = 4;
const TRAJECTORY_EVIDENCE_FLAG_SKIP_INITIAL_STOP = 8;
const TRAJECTORY_EVIDENCE_FLAG_CAN_CONTINUE_TO_LATER_FRONTIER = 16;
const TRAJECTORY_RESULT_FLAG_OBSTACLE_HIT = 1;
const TRAJECTORY_RESULT_FLAG_HAS_PATH_ERROR = 2;
const TRAJECTORY_RESULT_FLAG_USED_CONTINUATION = 4;
const TRAJECTORY_RESULT_STATE_FLAG_HAS_PREVIOUS_POINT = 1;
const TRAJECTORY_RESULT_STATE_FLAG_HAS_DY = 2;
const TRAJECTORY_RESULT_STATE_FLAG_HAS_PREVIOUS_DY = 4;
const TRAJECTORY_STOP_REASON_STOP_X = 1;
const TRAJECTORY_STOP_REASON_INVALID = 2;
const TRAJECTORY_STOP_REASON_MAX_STEPS = 3;
const TRAJECTORY_STOP_REASON_OUT_OF_BOUNDS = 4;
const TRAJECTORY_STOP_REASON_TOO_STEEP = 5;
const TRAJECTORY_STOP_REASON_OBSTACLE = 6;
const TRAJECTORY_STOP_REASON_TARGET = 7;
const TRAJECTORY_HASH_MASK = (1n << 64n) - 1n;
const TRAJECTORY_HASH_PRIME = 1_099_511_628_211n;
const TRAJECTORY_HASH_A_SEED = 14_695_981_039_346_656_037n;
const TRAJECTORY_HASH_B_SEED = 7_809_847_782_465_536_322n;

const STEP_MATERIAL_FLAG_OVERFLOW_PROTECTED = 1;
const ALLOWED_SIGN_PROTECTION_BITS =
  GraphwarSignRole.StartX |
  GraphwarSignRole.EndX |
  GraphwarSignRole.CenterX |
  GraphwarSignRole.GateY |
  GraphwarSignRole.BrakingGateY;

/** One expression VM call evaluates a whole x/y/y' SoA batch. */
export interface GraphwarWasmExpressionBatchInput {
  program: GraphwarExpressionProgram;
  values: readonly GraphwarWasmFormulaValue[];
}

/** Formula batch inputs retain all three variables because Step-glitch evaluators consume y/y'. */
export interface GraphwarWasmFormulaValue {
  dy: number;
  x: number;
  y: number;
}

/** Structured formula material construction and evaluator batch share one atomic input. */
export interface GraphwarWasmFormulaBatchInput {
  descriptor: GraphwarWasmFormulaInputDescriptor;
  formulaEvaluation?: FormulaEvaluationOptions;
  values: readonly GraphwarWasmFormulaValue[];
}

/** Formula batch results own every copied byte and may outlive the runtime arena scope. */
export interface GraphwarWasmFormulaBatchResult {
  compiledMaterials: CompiledGraphwarFormulaMaterials;
  observedSignProtection: readonly number[];
  values: Float64Array;
}

/** Launch preparation returns no success-only placeholders when numerical preparation is invalid. */
export type GraphwarWasmFormulaLaunchResult =
  | {
      formulaPointIterationCount: number;
      iterationCount: number;
      observedSignProtection: readonly number[];
      status: "invalid";
    }
  | {
      compiledMaterials: CompiledGraphwarFormulaMaterials;
      formulaPointIterationCount: number;
      formulaPoints: readonly GraphPoint[];
      iterationCount: number;
      launch:
        | { equation: "y"; point: GraphPoint; yOffset: number }
        | { angleRadians: number; equation: "dy"; point: GraphPoint }
        | { angleRadians: number; equation: "ddy"; initialDy: number; isUserAngle: boolean; point: GraphPoint };
      observedSignProtection: readonly number[];
      status: "success";
    };

export interface GraphwarWasmTrajectoryResult {
  acceptedSamplePointCount: number;
  bisectionCount: number;
  continuationEvidence: GraphwarWasmTrajectoryContinuationEvidence;
  initialDy: number;
  launchAngleRadians?: number;
  launchPoint: GraphPoint;
  minStepJumpCount: number;
  obstacle: { type: "none" } | { sampleIndex: number; type: "hit" };
  observations: readonly { dy: number; sampleIndex: number; x: number; y: number }[];
  pathError?: number;
  points: readonly GraphPoint[];
  reachedRequiredTargetCount: number;
  reachedTargetCount: number;
  replayCount: number;
  requiredTargetsHitIndex: number;
  rk4StepCount: number;
  startType: "cold" | "continuation";
  stopReason: GraphwarWasmTrajectoryStopReason;
  targetHitIndex: number;
  trackedTargetHitIndexes: readonly number[];
  visiblePixels: readonly PixelPoint[];
  yOffset: number;
}

export type GraphwarWasmTrajectoryStopReason = 1 | 2 | 3 | 4 | 5 | 6 | 7;

type GraphwarWasmIdentityHash = readonly [number, number, number, number];

/** Owned continuation atom; hashes bind the physical state to every formula and stop-policy dependency. */
export interface GraphwarWasmTrajectoryContinuationEvidence {
  canContinueToLaterFrontier: boolean;
  dependencyHash: GraphwarWasmIdentityHash;
  observedSignProtection: readonly number[];
  proofHash: GraphwarWasmIdentityHash;
  reachedRequiredTargetCount: number;
  reachedTargetCount: number;
  shouldSkipInitialStop: boolean;
  state: GraphwarWasmTrajectoryPhysicalState;
}

export interface GraphwarWasmTrajectoryInput {
  descriptor: GraphwarWasmFormulaInputDescriptor;
  start: { type: "cold" } | { evidence: GraphwarWasmTrajectoryContinuationEvidence; type: "continuation" };
  stop: GraphwarWasmStopPolicy;
}

interface PackedFormulaInput {
  inputPointer: number;
  pointCount: number;
  segmentCount: number;
}

interface RawFormulaBatchResult {
  auxiliaryValue: number;
  flags: number;
  materialCount: number;
  materialPointer: number;
  materialStride: number;
  materialType: number;
  observedSignProtection: readonly number[];
  values: Float64Array;
}

/** Runs the canonical expression program without reparsing or retaining WASM-backed views. */
export function runGraphwarWasmExpressionBatch(
  runtime: GraphwarWasmKernelRuntime,
  input: GraphwarWasmExpressionBatchInput,
): Float64Array {
  return withFormulaArenaScope(runtime, () => {
    const packedProgram = packGraphwarWasmExpressionProgram(runtime, input.program);
    const packedValues = packFormulaValues(runtime, input.values);
    const inputPointer = runtime.reserveArena(EXPRESSION_INPUT_BYTE_LENGTH, 4);
    new Uint8Array(runtime.buffer, inputPointer, EXPRESSION_INPUT_BYTE_LENGTH).fill(0);
    const inputView = new DataView(runtime.buffer);
    inputView.setUint32(inputPointer, packedProgram.opcodes.pointer, true);
    inputView.setUint32(inputPointer + 4, packedProgram.opcodes.length, true);
    inputView.setUint32(inputPointer + 8, packedProgram.constants.pointer, true);
    inputView.setUint32(inputPointer + 12, packedProgram.constants.length, true);
    inputView.setUint32(inputPointer + 16, packedProgram.maximumStackSize, true);
    inputView.setUint32(inputPointer + 20, packedValues.x.pointer, true);
    inputView.setUint32(inputPointer + 24, packedValues.y.pointer, true);
    inputView.setUint32(inputPointer + 28, packedValues.dy.pointer, true);
    inputView.setUint32(inputPointer + 32, packedValues.length, true);

    const outputMinimumPointer = runtime.arenaCursor;
    const resultPointer = runtime.runFormula(
      FORMULA_COMMAND_EVALUATE_EXPRESSION_BATCH,
      inputPointer,
      EXPRESSION_INPUT_BYTE_LENGTH,
    );
    const result = readRawFormulaBatchResult(runtime, resultPointer, outputMinimumPointer, {
      expectedMaterialCountMaximum: 0,
      expectedMaterialStride: 0,
      expectedMaterialType: 0,
      expectedProtectionCount: 0,
      expectedValueCount: packedValues.length,
    });
    if (
      result.auxiliaryValue !== 0 ||
      result.flags !== 0 ||
      result.materialPointer !== 0 ||
      result.observedSignProtection.length !== 0
    ) {
      throwFormulaResultError("Expression result contains unexpected formula material fields");
    }
    return result.values;
  });
}

/** Builds exact formula materials and evaluates all requested values in one WASM command. */
export function runGraphwarWasmFormulaBatch(
  runtime: GraphwarWasmKernelRuntime,
  input: GraphwarWasmFormulaBatchInput,
): GraphwarWasmFormulaBatchResult {
  return withFormulaArenaScope(runtime, () => {
    const packedInput = packFormulaInput(runtime, input.descriptor, input.formulaEvaluation, input.values, false);
    const { algorithm, equation } = input.descriptor.settings;
    const outputMinimumPointer = runtime.arenaCursor;
    const resultPointer = runtime.runFormula(
      algorithm === "step" ? FORMULA_COMMAND_EVALUATE_STEP_BATCH : FORMULA_COMMAND_EVALUATE_CURVE_BATCH,
      packedInput.inputPointer,
      FORMULA_INPUT_BYTE_LENGTH,
    );
    const result = readRawFormulaBatchResult(runtime, resultPointer, outputMinimumPointer, {
      expectedMaterialCountMaximum: packedInput.segmentCount,
      expectedMaterialStride: getExpectedMaterialStride(algorithm, equation),
      expectedMaterialType: getExpectedMaterialType(algorithm, equation),
      expectedProtectionCount: packedInput.segmentCount,
      expectedValueCount: input.values.length,
    });
    return {
      compiledMaterials: decodeFormulaMaterials(
        runtime,
        result,
        algorithm,
        equation,
        input.descriptor.settings.decimalPlaces,
        packedInput.segmentCount,
        outputMinimumPointer,
      ),
      observedSignProtection: result.observedSignProtection,
      values: result.values,
    };
  });
}

/** Builds winning formula points/materials and returns one legal launch-state variant. */
export function prepareGraphwarWasmFormulaLaunch(
  runtime: GraphwarWasmKernelRuntime,
  descriptor: GraphwarWasmFormulaInputDescriptor,
): GraphwarWasmFormulaLaunchResult {
  return withFormulaArenaScope(runtime, () => {
    const packedInput = packFormulaInput(runtime, descriptor, undefined, [], true);
    const outputMinimumPointer = runtime.arenaCursor;
    const resultPointer = runtime.runFormula(
      FORMULA_COMMAND_PREPARE_LAUNCH,
      packedInput.inputPointer,
      FORMULA_INPUT_BYTE_LENGTH,
    );
    const resultRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: 1, pointer: resultPointer },
      {
        alignment: 8,
        elementByteLength: FORMULA_LAUNCH_RESULT_BYTE_LENGTH,
        minimumPointer: outputMinimumPointer,
      },
    );
    const resultView = new DataView(resultRange.buffer, resultRange.byteOffset, resultRange.byteLength);
    const status = resultView.getInt32(0, true);
    const iterationCount = resultView.getUint32(4, true);
    const formulaPointIterationCount = resultView.getUint32(56, true);
    const materialResultPointer = resultView.getUint32(48, true);
    const flags = resultView.getUint32(52, true);
    const protectionPointer = resultView.getUint32(60, true);
    const protectionCount = resultView.getUint32(64, true);
    const formulaPointCount = resultView.getUint32(68, true);
    const formulaPointXPointer = resultView.getUint32(72, true);
    const formulaPointYPointer = resultView.getUint32(76, true);
    if (protectionCount !== packedInput.segmentCount) {
      throwFormulaResultError("Launch result protection count does not match the source segments");
    }
    const observedSignProtection = copyAndValidateProtection(
      runtime,
      protectionPointer,
      protectionCount,
      outputMinimumPointer,
    );

    if (status === FORMULA_LAUNCH_STATUS_INVALID) {
      if (
        materialResultPointer !== 0 ||
        flags !== 0 ||
        formulaPointCount !== 0 ||
        formulaPointXPointer !== 0 ||
        formulaPointYPointer !== 0
      ) {
        throwFormulaResultError("Invalid launch result leaked success-only state");
      }
      return {
        formulaPointIterationCount,
        iterationCount,
        observedSignProtection,
        status: "invalid",
      };
    }
    if (status !== FORMULA_LAUNCH_STATUS_SUCCESS) {
      throwFormulaResultError("Launch result contains an unsupported status");
    }
    if (formulaPointCount !== packedInput.pointCount) {
      throwFormulaResultError("Launch result formula point count does not match the source path");
    }
    const formulaPointXs = copyGraphwarWasmFloat64Values(
      runtime,
      { length: formulaPointCount, pointer: formulaPointXPointer },
      outputMinimumPointer,
    );
    const formulaPointYs = copyGraphwarWasmFloat64Values(
      runtime,
      { length: formulaPointCount, pointer: formulaPointYPointer },
      outputMinimumPointer,
    );
    const formulaPoints: GraphPoint[] = [];
    for (let index = 0; index < formulaPointCount; index += 1) {
      const x = formulaPointXs[index];
      const y = formulaPointYs[index];
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throwFormulaResultError(`Launch result formulaPoints[${index}] is not finite`);
      }
      formulaPoints.push(createGraphPoint(x, y));
    }

    const { algorithm, decimalPlaces, equation } = descriptor.settings;
    const materialResult = readRawFormulaBatchResult(runtime, materialResultPointer, outputMinimumPointer, {
      expectedMaterialCountMaximum: packedInput.segmentCount,
      expectedMaterialStride: getExpectedMaterialStride(algorithm, equation),
      expectedMaterialType: getExpectedMaterialType(algorithm, equation),
      expectedProtectionCount: packedInput.segmentCount,
      expectedValueCount: 0,
    });
    if (!uint32ArraysEqual(materialResult.observedSignProtection, observedSignProtection)) {
      throwFormulaResultError("Launch result and nested material protection evidence do not match");
    }
    const compiledMaterials = decodeFormulaMaterials(
      runtime,
      materialResult,
      algorithm,
      equation,
      decimalPlaces,
      packedInput.segmentCount,
      outputMinimumPointer,
    );
    validateFiniteLaunchFormulaMaterials(compiledMaterials, equation);
    const pointX = resultView.getFloat64(16, true);
    const pointY = resultView.getFloat64(24, true);
    if (!Number.isFinite(pointX) || !Number.isFinite(pointY)) {
      throwFormulaResultError("Launch result point is not finite");
    }
    const point = createGraphPoint(pointX, pointY);
    const angleRadians = resultView.getFloat64(8, true);
    const initialDy = resultView.getFloat64(32, true);
    const yOffset = resultView.getFloat64(40, true);

    if (equation === "y") {
      if (
        flags !== FORMULA_LAUNCH_FLAG_HAS_Y_OFFSET ||
        !Number.isFinite(yOffset) ||
        angleRadians === Number.POSITIVE_INFINITY ||
        angleRadians === Number.NEGATIVE_INFINITY ||
        !Object.is(initialDy, 0)
      ) {
        throwFormulaResultError("Normal launch result has inconsistent y-offset state");
      }
      return {
        compiledMaterials,
        formulaPointIterationCount,
        formulaPoints,
        iterationCount,
        launch: { equation, point, yOffset },
        observedSignProtection,
        status: "success",
      };
    }
    if (equation === "dy") {
      if (flags !== 0 || !Number.isFinite(angleRadians) || !Object.is(initialDy, 0) || !Object.is(yOffset, 0)) {
        throwFormulaResultError("First-order launch result has inconsistent angle state");
      }
      return {
        compiledMaterials,
        formulaPointIterationCount,
        formulaPoints,
        iterationCount,
        launch: { angleRadians, equation, point },
        observedSignProtection,
        status: "success",
      };
    }

    const secondOrderLaunchAngle = descriptor.secondOrderLaunchAngle;
    const isUserAngle = secondOrderLaunchAngle !== undefined;
    const expectedFlags = FORMULA_LAUNCH_FLAG_HAS_INITIAL_DY | (isUserAngle ? FORMULA_LAUNCH_FLAG_USED_USER_ANGLE : 0);
    if (
      flags !== expectedFlags ||
      !Number.isFinite(angleRadians) ||
      !Number.isFinite(initialDy) ||
      !Object.is(yOffset, 0) ||
      (isUserAngle && !Object.is(angleRadians, secondOrderLaunchAngle.radians))
    ) {
      throwFormulaResultError("Second-order launch result has inconsistent angle state");
    }
    return {
      compiledMaterials,
      formulaPointIterationCount,
      formulaPoints,
      iterationCount,
      launch: { angleRadians, equation, initialDy, isUserAngle, point },
      observedSignProtection,
      status: "success",
    };
  });
}

/** Executes launch preparation and trajectory sampling without exposing WASM-backed views. */
export function runGraphwarWasmTrajectory(
  runtime: GraphwarWasmKernelRuntime,
  input: GraphwarWasmTrajectoryInput,
): GraphwarWasmTrajectoryResult | undefined {
  return runGraphwarWasmTrajectoryCommand(runtime, input, "production");
}

/** Test-only route seam proving Step-glitch reuses the complete trajectory command and Adapter contract. */
export function runGraphwarWasmTrajectoryThroughStepGlitchTestSeam(
  runtime: GraphwarWasmKernelRuntime,
  input: GraphwarWasmTrajectoryInput,
): GraphwarWasmTrajectoryResult | undefined {
  return runGraphwarWasmTrajectoryCommand(runtime, input, "step-glitch-test");
}

function runGraphwarWasmTrajectoryCommand(
  runtime: GraphwarWasmKernelRuntime,
  input: GraphwarWasmTrajectoryInput,
  execution: "production" | "step-glitch-test",
): GraphwarWasmTrajectoryResult | undefined {
  return withFormulaArenaScope(runtime, () => {
    const { descriptor, start, stop } = input;
    const packedFormula = packFormulaInput(runtime, descriptor, undefined, [], true);
    const commandPointer = runtime.reserveArena(TRAJECTORY_INPUT_BYTE_LENGTH, 8);
    if (commandPointer !== packedFormula.inputPointer + FORMULA_INPUT_BYTE_LENGTH) {
      throw new GraphwarWasmAdapterError(
        "invalid-memory-buffer",
        "Trajectory command is not adjacent to formula input",
      );
    }
    new Uint8Array(runtime.buffer, commandPointer, FORMULA_INPUT_BYTE_LENGTH).set(
      new Uint8Array(runtime.buffer, packedFormula.inputPointer, FORMULA_INPUT_BYTE_LENGTH),
    );
    new Uint8Array(
      runtime.buffer,
      commandPointer + FORMULA_INPUT_BYTE_LENGTH,
      TRAJECTORY_INPUT_BYTE_LENGTH - FORMULA_INPUT_BYTE_LENGTH,
    ).fill(0);
    const packedStop = packGraphwarWasmStopPolicy(runtime, stop);
    const packedEvidence =
      start.type === "cold"
        ? { byteLength: 0, pointer: 0 }
        : packGraphwarWasmTrajectoryEvidence(
            runtime,
            start.evidence,
            descriptor.settings.equation,
            packedFormula.segmentCount,
          );
    const commandView = new DataView(runtime.buffer, commandPointer, TRAJECTORY_INPUT_BYTE_LENGTH);
    let commandFlags = start.type === "continuation" ? TRAJECTORY_FLAG_HAS_CONTINUATION_EVIDENCE : 0;
    commandView.setUint32(
      176,
      packedStop.type === "natural"
        ? TRAJECTORY_STOP_TYPE_NATURAL
        : packedStop.type === "stop-x-observations"
          ? TRAJECTORY_STOP_TYPE_STOP_X
          : TRAJECTORY_STOP_TYPE_TARGETS,
      true,
    );
    commandView.setUint32(200, 0, true);
    if (packedStop.type === "stop-x-observations") {
      commandView.setFloat64(184, packedStop.stopX, true);
      commandView.setUint32(256, packedStop.observationXs.pointer, true);
      commandView.setUint32(260, packedStop.observationXs.length, true);
    } else if (packedStop.type === "targets") {
      const packedCollision = packedStop.collision;
      const packedContinueGraphX = packedStop.continueAfterTargetsUntilGraphX;
      const hasContinueGraphX = packedContinueGraphX.type === "value";
      commandFlags |=
        (hasContinueGraphX ? TRAJECTORY_FLAG_HAS_CONTINUE_GRAPH_X : 0) |
        (packedStop.shouldCollectVisiblePixels ? TRAJECTORY_FLAG_COLLECT_VISIBLE_PIXELS : 0) |
        (packedStop.shouldStopOnTargetsComplete ? TRAJECTORY_FLAG_STOP_ON_TARGETS_COMPLETE : 0);
      commandView.setFloat64(184, packedContinueGraphX.type === "value" ? packedContinueGraphX.graphX : 0, true);
      commandView.setUint32(192, packedCollision.type === "mask" ? packedCollision.mask.pointer : 0, true);
      commandView.setUint32(196, packedCollision.type === "mask" ? packedCollision.mask.length : 0, true);
      commandView.setUint32(204, packedStop.orderedTargetCount, true);
      commandView.setUint32(208, packedStop.requiredTargetCount, true);
      commandView.setUint32(212, packedStop.trackedTargetCount, true);
      commandView.setUint32(216, packedStop.targetRecords.pointer, true);
      commandView.setUint32(
        220,
        packedCollision.type === "mask"
          ? validateGraphwarWasmU32(
              Math.floor(packedCollision.boundaryExpansion),
              "collision.boundaryExpansion",
              "input",
            )
          : 0,
        true,
      );
      commandView.setFloat64(224, packedStop.boundsRect.x, true);
      commandView.setFloat64(232, packedStop.boundsRect.y, true);
      commandView.setFloat64(240, packedStop.boundsRect.width, true);
      commandView.setFloat64(248, packedStop.boundsRect.height, true);
      commandView.setUint32(264, packedStop.qualityPoints.x.pointer, true);
      commandView.setUint32(268, packedStop.qualityPoints.y.pointer, true);
      commandView.setUint32(272, packedStop.qualityPoints.length, true);
    }
    commandView.setUint32(180, commandFlags, true);
    commandView.setUint32(276, packedEvidence.pointer, true);
    commandView.setUint32(280, packedEvidence.byteLength, true);
    const outputMinimumPointer = runtime.arenaCursor;
    const resultPointer =
      execution === "production"
        ? runtime.runTrajectory(commandPointer, TRAJECTORY_INPUT_BYTE_LENGTH)
        : runtime.runRouteTask(
            STEP_GLITCH_COMMAND_REPLAY_TRAJECTORY_FOR_TEST,
            commandPointer,
            TRAJECTORY_INPUT_BYTE_LENGTH,
          );
    const resultRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: 1, pointer: resultPointer },
      { alignment: 8, elementByteLength: TRAJECTORY_RESULT_BYTE_LENGTH, minimumPointer: outputMinimumPointer },
    );
    const resultView = new DataView(resultRange.buffer, resultRange.byteOffset, resultRange.byteLength);
    const launchStatus = resultView.getInt32(0, true);
    if (launchStatus !== FORMULA_LAUNCH_STATUS_INVALID && launchStatus !== FORMULA_LAUNCH_STATUS_SUCCESS) {
      throwFormulaResultError("Trajectory result contains an invalid launch status");
    }
    if (launchStatus === FORMULA_LAUNCH_STATUS_INVALID) {
      validateGraphwarWasmInvalidTrajectoryResult(
        runtime,
        resultView,
        packedFormula.segmentCount,
        outputMinimumPointer,
      );
      return undefined;
    }
    const stopReason = validateGraphwarWasmTrajectoryStopReason(resultView.getInt32(4, true));
    const pointCount = validateGraphwarWasmU32(resultView.getUint32(8, true), "trajectory.pointCount");
    if (pointCount === 0) {
      throwFormulaResultError("Trajectory result must contain its initial physical point");
    }
    const pointXs = copyGraphwarWasmFloat64Values(
      runtime,
      { length: pointCount, pointer: resultView.getUint32(24, true) },
      outputMinimumPointer,
    );
    const pointYs = copyGraphwarWasmFloat64Values(
      runtime,
      { length: pointCount, pointer: resultView.getUint32(28, true) },
      outputMinimumPointer,
    );
    const pointDys = copyGraphwarWasmFloat64Values(
      runtime,
      { length: pointCount, pointer: resultView.getUint32(208, true) },
      outputMinimumPointer,
    );
    const points: GraphPoint[] = [];
    const equation = descriptor.settings.equation;
    for (let index = 0; index < pointCount; index += 1) {
      if (equation === "ddy") {
        validateGraphwarWasmFiniteNumber(pointDys[index], `trajectory.points[${index}].dy`);
      } else if (!Object.is(pointDys[index], 0)) {
        throwFormulaResultError(`Trajectory point ${index} contains derivative state for a non-second-order equation`);
      }
      points.push(
        createGraphPoint(
          validateGraphwarWasmFiniteNumber(pointXs[index], `trajectory.points[${index}].x`),
          validateGraphwarWasmFiniteNumber(pointYs[index], `trajectory.points[${index}].y`),
        ),
      );
    }
    const resultFlags = resultView.getUint32(96, true);
    if (
      (resultFlags &
        ~(
          TRAJECTORY_RESULT_FLAG_OBSTACLE_HIT |
          TRAJECTORY_RESULT_FLAG_HAS_PATH_ERROR |
          TRAJECTORY_RESULT_FLAG_USED_CONTINUATION
        )) !==
      0
    ) {
      throwFormulaResultError("Trajectory result contains unsupported flags");
    }
    const isContinuationUsed = (resultFlags & TRAJECTORY_RESULT_FLAG_USED_CONTINUATION) !== 0;
    if (isContinuationUsed && start.type !== "continuation") {
      throwFormulaResultError("Cold trajectory result cannot claim continuation state");
    }
    const visiblePointCount = validateGraphwarWasmU32(resultView.getUint32(152, true), "trajectory.visiblePointCount");
    const visibleXs = copyGraphwarWasmFloat64Values(
      runtime,
      { length: visiblePointCount, pointer: resultView.getUint32(144, true) },
      outputMinimumPointer,
    );
    const visibleYs = copyGraphwarWasmFloat64Values(
      runtime,
      { length: visiblePointCount, pointer: resultView.getUint32(148, true) },
      outputMinimumPointer,
    );
    const visiblePixels: PixelPoint[] = [];
    for (let index = 0; index < visiblePointCount; index += 1) {
      visiblePixels.push(
        createPixelPoint(
          validateGraphwarWasmFiniteNumber(visibleXs[index], `trajectory.visiblePixels[${index}].x`),
          validateGraphwarWasmFiniteNumber(visibleYs[index], `trajectory.visiblePixels[${index}].y`),
        ),
      );
    }
    const shouldCollectVisiblePixels = packedStop.type === "targets" && packedStop.shouldCollectVisiblePixels;
    const shouldSkipPublishedInitialPoint =
      isContinuationUsed && start.type === "continuation" && start.evidence.shouldSkipInitialStop;
    const expectedVisiblePointCount = shouldCollectVisiblePixels
      ? pointCount - (shouldSkipPublishedInitialPoint ? 1 : 0)
      : 0;
    if (visiblePointCount !== expectedVisiblePointCount) {
      throwFormulaResultError("Trajectory visible-point count does not match the stop policy");
    }
    const hasExpectedPathError = packedStop.type === "targets" && packedStop.qualityPoints.length > 0;
    if (((resultFlags & TRAJECTORY_RESULT_FLAG_HAS_PATH_ERROR) !== 0) !== hasExpectedPathError) {
      throwFormulaResultError("Trajectory path-error state does not match the quality-point input");
    }
    const pathError =
      (resultFlags & TRAJECTORY_RESULT_FLAG_HAS_PATH_ERROR) === 0
        ? undefined
        : validateGraphwarWasmPathError(resultView.getFloat64(160, true));
    const trackedTargetCount = validateGraphwarWasmU32(
      resultView.getUint32(124, true),
      "trajectory.trackedTargetCount",
    );
    const trackedTargetRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: trackedTargetCount, pointer: resultView.getUint32(120, true) },
      {
        alignment: Int32Array.BYTES_PER_ELEMENT,
        elementByteLength: Int32Array.BYTES_PER_ELEMENT,
        minimumPointer: outputMinimumPointer,
      },
    );
    const trackedTargetHitIndexes = [
      ...new Int32Array(trackedTargetRange.buffer, trackedTargetRange.byteOffset, trackedTargetRange.elementLength),
    ];
    const observationCount = validateGraphwarWasmU32(resultView.getUint32(132, true), "trajectory.observationCount");
    const observationRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: observationCount, pointer: resultView.getUint32(128, true) },
      { alignment: 8, elementByteLength: 32, minimumPointer: outputMinimumPointer },
    );
    const observationView = new DataView(
      observationRange.buffer,
      observationRange.byteOffset,
      observationRange.byteLength,
    );
    const observations: { dy: number; sampleIndex: number; x: number; y: number }[] = [];
    for (let index = 0; index < observationCount; index += 1) {
      const offset = index * 32;
      observations.push({
        dy: validateGraphwarWasmFiniteNumber(observationView.getFloat64(offset + 16, true), "observation.dy"),
        sampleIndex: validateGraphwarWasmU32(observationView.getUint32(offset + 24, true), "observation.sampleIndex"),
        x: validateGraphwarWasmFiniteNumber(observationView.getFloat64(offset, true), "observation.x"),
        y: validateGraphwarWasmFiniteNumber(observationView.getFloat64(offset + 8, true), "observation.y"),
      });
    }
    const rawLaunchAngleRadians = resultView.getFloat64(56, true);
    const rawInitialDy = resultView.getFloat64(80, true);
    const rawYOffset = resultView.getFloat64(88, true);
    if (equation === "y") {
      if (
        rawLaunchAngleRadians === Number.POSITIVE_INFINITY ||
        rawLaunchAngleRadians === Number.NEGATIVE_INFINITY ||
        !Object.is(rawInitialDy, 0) ||
        !Number.isFinite(rawYOffset)
      ) {
        throwFormulaResultError("Normal trajectory launch state is inconsistent");
      }
    } else if (equation === "dy") {
      if (!Number.isFinite(rawLaunchAngleRadians) || !Object.is(rawInitialDy, 0) || !Object.is(rawYOffset, 0)) {
        throwFormulaResultError("First-order trajectory launch state is inconsistent");
      }
    } else if (
      !Number.isFinite(rawLaunchAngleRadians) ||
      !Number.isFinite(rawInitialDy) ||
      !Object.is(rawYOffset, 0) ||
      (descriptor.secondOrderLaunchAngle !== undefined &&
        !Object.is(rawLaunchAngleRadians, descriptor.secondOrderLaunchAngle.radians))
    ) {
      throwFormulaResultError("Second-order trajectory launch state is inconsistent");
    }
    const launchPoint = createGraphPoint(
      validateGraphwarWasmFiniteNumber(resultView.getFloat64(64, true), "trajectory.launchPoint.x"),
      validateGraphwarWasmFiniteNumber(resultView.getFloat64(72, true), "trajectory.launchPoint.y"),
    );
    if (!isContinuationUsed && !graphwarPointsEqual(launchPoint, points[0])) {
      throwFormulaResultError("Trajectory launch point does not match its first published point");
    }
    const observedSignProtection = copyAndValidateProtection(
      runtime,
      resultView.getUint32(136, true),
      resultView.getUint32(140, true),
      outputMinimumPointer,
    );
    if (observedSignProtection.length !== packedFormula.segmentCount) {
      throwFormulaResultError("Trajectory protection count does not match the formula segments");
    }
    const reachedTargetCount = validateGraphwarWasmU32(
      resultView.getUint32(100, true),
      "trajectory.reachedTargetCount",
    );
    const reachedRequiredTargetCount = validateGraphwarWasmU32(
      resultView.getUint32(104, true),
      "trajectory.reachedRequiredTargetCount",
    );
    const targetHitIndex = resultView.getInt32(108, true);
    const requiredTargetsHitIndex = resultView.getInt32(112, true);
    const obstacleHitIndex = resultView.getInt32(116, true);
    const state = unpackGraphwarWasmTrajectoryResultState(resultView, descriptor.settings.equation);
    const acceptedSamplePointCount = validateGraphwarWasmU32(
      resultView.getUint32(212, true),
      "trajectory.acceptedSamplePointCount",
    );
    const replayCount = validateGraphwarWasmU32(resultView.getUint32(216, true), "trajectory.replayCount");
    const continuationEvidence = unpackGraphwarWasmTrajectoryEvidence(
      runtime,
      {
        byteLength: resultView.getUint32(204, true),
        pointer: resultView.getUint32(200, true),
      },
      descriptor.settings.equation,
      packedFormula.segmentCount,
      outputMinimumPointer,
    );
    validateGraphwarWasmTrajectoryResultConsistency({
      bounds: descriptor.bounds,
      acceptedSamplePointCount,
      continuationEvidence,
      isContinuationUsed,
      observations,
      obstacleHitIndex,
      pointCount,
      pointDys,
      points,
      replayCount,
      reachedRequiredTargetCount,
      reachedTargetCount,
      requiredTargetsHitIndex,
      resultFlags,
      start,
      state,
      stop,
      stopReason,
      targetHitIndex,
      trackedTargetHitIndexes,
    });
    if (!uint32ArraysEqual(observedSignProtection, continuationEvidence.observedSignProtection)) {
      throwFormulaResultError("Trajectory result and continuation evidence protection differ");
    }
    return {
      acceptedSamplePointCount,
      bisectionCount: validateGraphwarWasmU32(resultView.getUint32(16, true), "trajectory.bisectionCount"),
      continuationEvidence,
      initialDy: rawInitialDy,
      ...(equation === "y"
        ? {}
        : {
            launchAngleRadians: rawLaunchAngleRadians,
          }),
      launchPoint,
      minStepJumpCount: validateGraphwarWasmU32(resultView.getUint32(20, true), "trajectory.minStepJumpCount"),
      obstacle:
        (resultFlags & TRAJECTORY_RESULT_FLAG_OBSTACLE_HIT) === 0
          ? { type: "none" }
          : { sampleIndex: obstacleHitIndex, type: "hit" },
      observations,
      ...(pathError === undefined ? {} : { pathError }),
      points,
      reachedRequiredTargetCount,
      reachedTargetCount,
      replayCount,
      requiredTargetsHitIndex,
      rk4StepCount: validateGraphwarWasmU32(resultView.getUint32(12, true), "trajectory.rk4StepCount"),
      startType: isContinuationUsed ? "continuation" : "cold",
      stopReason,
      targetHitIndex,
      trackedTargetHitIndexes,
      visiblePixels,
      yOffset: rawYOffset,
    };
  });
}

function withFormulaArenaScope<TResult>(runtime: GraphwarWasmKernelRuntime, run: () => TResult): TResult {
  const mark = runtime.markArena();
  try {
    const result = run();
    runtime.resetArena(mark);
    return result;
  } catch (error) {
    try {
      runtime.resetArenaAfterFault(mark);
    } catch {
      // The page fuse discards this runtime; preserve the fault that made the command unusable.
    }
    throw error;
  }
}

function validateGraphwarWasmInvalidTrajectoryResult(
  runtime: GraphwarWasmKernelRuntime,
  view: DataView,
  segmentCount: number,
  outputMinimumPointer: number,
): void {
  if (
    view.getInt32(4, true) !== TRAJECTORY_STOP_REASON_INVALID ||
    view.getUint32(8, true) !== 0 ||
    !graphwarWasmBytesAreZero(view, 24, 84) ||
    view.getInt32(108, true) !== -1 ||
    view.getInt32(112, true) !== -1 ||
    view.getInt32(116, true) !== -1 ||
    !graphwarWasmBytesAreZero(view, 120, 16) ||
    !graphwarWasmBytesAreZero(view, 144, 64) ||
    view.getUint32(208, true) !== 0
  ) {
    throwFormulaResultError("Invalid trajectory result leaked success-only state");
  }
  const protection = copyAndValidateProtection(
    runtime,
    view.getUint32(136, true),
    view.getUint32(140, true),
    outputMinimumPointer,
  );
  if (protection.length !== segmentCount) {
    throwFormulaResultError("Invalid trajectory protection count does not match the formula segments");
  }
  validateGraphwarWasmU32(view.getUint32(12, true), "trajectory.rk4StepCount");
  validateGraphwarWasmU32(view.getUint32(16, true), "trajectory.bisectionCount");
  validateGraphwarWasmU32(view.getUint32(20, true), "trajectory.minStepJumpCount");
  validateGraphwarWasmU32(view.getUint32(212, true), "trajectory.acceptedSamplePointCount");
  validateGraphwarWasmU32(view.getUint32(216, true), "trajectory.replayCount");
}

function graphwarWasmBytesAreZero(view: DataView, offset: number, byteLength: number) {
  for (let index = 0; index < byteLength; index += 1) {
    if (view.getUint8(offset + index) !== 0) {
      return false;
    }
  }
  return true;
}

function unpackGraphwarWasmTrajectoryResultState(
  view: DataView,
  equation: EquationMode,
): GraphwarWasmTrajectoryPhysicalState {
  return createGraphwarWasmTrajectoryPhysicalState(
    {
      currentDy: view.getFloat64(48, true),
      currentX: view.getFloat64(32, true),
      currentY: view.getFloat64(40, true),
      flags: view.getUint32(196, true),
      previousDy: view.getFloat64(184, true),
      previousX: view.getFloat64(168, true),
      previousY: view.getFloat64(176, true),
      sampleIndex: view.getUint32(192, true),
    },
    equation,
    "trajectory.state",
  );
}

function unpackGraphwarWasmTrajectoryEvidence(
  runtime: GraphwarWasmKernelRuntime,
  slice: { byteLength: number; pointer: number },
  equation: EquationMode,
  segmentCount: number,
  outputMinimumPointer: number,
): GraphwarWasmTrajectoryContinuationEvidence {
  if (slice.byteLength !== TRAJECTORY_EVIDENCE_BYTE_LENGTH) {
    throwFormulaResultError("Trajectory continuation evidence has an invalid byte length");
  }
  const range = validateGraphwarWasmMemoryRange(
    runtime,
    { length: slice.byteLength, pointer: slice.pointer },
    { alignment: 8, elementByteLength: 1, minimumPointer: outputMinimumPointer },
  );
  const view = new DataView(range.buffer, range.byteOffset, range.byteLength);
  const evidenceFlags = view.getUint32(100, true);
  if ((evidenceFlags & ~31) !== 0) {
    throwFormulaResultError("Trajectory continuation evidence contains unsupported flags");
  }
  const observedSignProtection = copyAndValidateProtection(
    runtime,
    view.getUint32(32, true),
    view.getUint32(36, true),
    outputMinimumPointer,
  );
  if (observedSignProtection.length !== segmentCount) {
    throwFormulaResultError("Trajectory continuation protection count does not match the formula segments");
  }
  const protectionRange = validateGraphwarWasmMemoryRange(
    runtime,
    { length: observedSignProtection.length, pointer: view.getUint32(32, true) },
    {
      alignment: Uint32Array.BYTES_PER_ELEMENT,
      elementByteLength: Uint32Array.BYTES_PER_ELEMENT,
      minimumPointer: outputMinimumPointer,
    },
  );
  validateGraphwarWasmTrajectoryEvidenceProof(
    view,
    new Uint8Array(protectionRange.buffer, protectionRange.byteOffset, protectionRange.byteLength),
  );
  const state = createGraphwarWasmTrajectoryPhysicalState(
    {
      currentDy: view.getFloat64(56, true),
      currentX: view.getFloat64(40, true),
      currentY: view.getFloat64(48, true),
      flags:
        evidenceFlags &
        (TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_POINT |
          TRAJECTORY_EVIDENCE_FLAG_HAS_DY |
          TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_DY),
      previousDy: view.getFloat64(80, true),
      previousX: view.getFloat64(64, true),
      previousY: view.getFloat64(72, true),
      sampleIndex: view.getUint32(88, true),
    },
    equation,
    "trajectory.evidence.state",
  );
  return {
    canContinueToLaterFrontier: (evidenceFlags & TRAJECTORY_EVIDENCE_FLAG_CAN_CONTINUE_TO_LATER_FRONTIER) !== 0,
    dependencyHash: readGraphwarWasmIdentityHash(view, 0),
    observedSignProtection,
    proofHash: readGraphwarWasmIdentityHash(view, 16),
    reachedRequiredTargetCount: validateGraphwarWasmU32(
      view.getUint32(96, true),
      "trajectory.evidence.reachedRequiredTargetCount",
    ),
    reachedTargetCount: validateGraphwarWasmU32(view.getUint32(92, true), "trajectory.evidence.reachedTargetCount"),
    shouldSkipInitialStop: (evidenceFlags & TRAJECTORY_EVIDENCE_FLAG_SKIP_INITIAL_STOP) !== 0,
    state,
  };
}

function createGraphwarWasmTrajectoryPhysicalState(
  raw: {
    currentDy: number;
    currentX: number;
    currentY: number;
    flags: number;
    previousDy: number;
    previousX: number;
    previousY: number;
    sampleIndex: number;
  },
  equation: EquationMode,
  fieldName: string,
): GraphwarWasmTrajectoryPhysicalState {
  const allowedFlags =
    TRAJECTORY_RESULT_STATE_FLAG_HAS_PREVIOUS_POINT |
    TRAJECTORY_RESULT_STATE_FLAG_HAS_DY |
    TRAJECTORY_RESULT_STATE_FLAG_HAS_PREVIOUS_DY;
  if ((raw.flags & ~allowedFlags) !== 0) {
    throwFormulaResultError(`${fieldName} contains unsupported flags`);
  }
  const hasPreviousPoint = (raw.flags & TRAJECTORY_RESULT_STATE_FLAG_HAS_PREVIOUS_POINT) !== 0;
  const hasDy = (raw.flags & TRAJECTORY_RESULT_STATE_FLAG_HAS_DY) !== 0;
  const hasPreviousDy = (raw.flags & TRAJECTORY_RESULT_STATE_FLAG_HAS_PREVIOUS_DY) !== 0;
  const sampleIndex = validateGraphwarWasmU32(raw.sampleIndex, `${fieldName}.sampleIndex`);
  if (hasPreviousPoint === (sampleIndex === 0)) {
    throwFormulaResultError(`${fieldName} previous point does not match its sample index`);
  }
  const currentPoint = createGraphPoint(
    validateGraphwarWasmFiniteNumber(raw.currentX, `${fieldName}.currentPoint.x`),
    validateGraphwarWasmFiniteNumber(raw.currentY, `${fieldName}.currentPoint.y`),
  );
  const previousPoint = hasPreviousPoint
    ? createGraphPoint(
        validateGraphwarWasmFiniteNumber(raw.previousX, `${fieldName}.previousPoint.x`),
        validateGraphwarWasmFiniteNumber(raw.previousY, `${fieldName}.previousPoint.y`),
      )
    : undefined;
  if (!hasPreviousPoint && (!Object.is(raw.previousX, 0) || !Object.is(raw.previousY, 0))) {
    throwFormulaResultError(`${fieldName} contains a previous point without its flag`);
  }
  if (equation === "ddy") {
    if (!hasDy || hasPreviousDy !== hasPreviousPoint) {
      throwFormulaResultError(`${fieldName} second-order derivative flags are inconsistent`);
    }
    const currentDy = validateGraphwarWasmFiniteNumber(raw.currentDy, `${fieldName}.currentDy`);
    if (hasPreviousPoint) {
      if (!previousPoint) {
        throwFormulaResultError(`${fieldName} previous point flag has no point`);
      }
      return {
        currentDy,
        currentPoint,
        equation,
        previous: {
          dy: validateGraphwarWasmFiniteNumber(raw.previousDy, `${fieldName}.previousDy`),
          point: previousPoint,
        },
        sampleIndex,
      };
    }
    if (!Object.is(raw.previousDy, 0)) {
      throwFormulaResultError(`${fieldName} contains a previous derivative without its flag`);
    }
    return { currentDy, currentPoint, equation, sampleIndex };
  }
  if (hasDy || hasPreviousDy || !Object.is(raw.currentDy, 0) || !Object.is(raw.previousDy, 0)) {
    throwFormulaResultError(`${fieldName} contains derivative state for a non-second-order equation`);
  }
  return {
    currentPoint,
    equation,
    ...(previousPoint === undefined ? {} : { previousPoint }),
    sampleIndex,
  };
}

function validateGraphwarWasmTrajectoryResultConsistency(options: {
  acceptedSamplePointCount: number;
  bounds: GraphBounds;
  continuationEvidence: GraphwarWasmTrajectoryContinuationEvidence;
  isContinuationUsed: boolean;
  observations: readonly { dy: number; sampleIndex: number; x: number; y: number }[];
  obstacleHitIndex: number;
  pointCount: number;
  pointDys: Float64Array;
  points: readonly GraphPoint[];
  replayCount: number;
  reachedRequiredTargetCount: number;
  reachedTargetCount: number;
  requiredTargetsHitIndex: number;
  resultFlags: number;
  start: GraphwarWasmTrajectoryInput["start"];
  state: GraphwarWasmTrajectoryPhysicalState;
  stop: GraphwarWasmStopPolicy;
  stopReason: GraphwarWasmTrajectoryStopReason;
  targetHitIndex: number;
  trackedTargetHitIndexes: readonly number[];
}): void {
  const {
    acceptedSamplePointCount,
    bounds,
    continuationEvidence,
    isContinuationUsed,
    observations,
    obstacleHitIndex,
    pointCount,
    pointDys,
    points,
    replayCount,
    reachedRequiredTargetCount,
    reachedTargetCount,
    requiredTargetsHitIndex,
    resultFlags,
    start,
    state,
    stop,
    stopReason,
    targetHitIndex,
    trackedTargetHitIndexes,
  } = options;
  if (replayCount < 1 || acceptedSamplePointCount < pointCount) {
    throwFormulaResultError("Trajectory debug counters are inconsistent with the published result");
  }
  if (!graphwarWasmTrajectoryStatesEqual(state, continuationEvidence.state)) {
    throwFormulaResultError("Trajectory result and continuation evidence physical states differ");
  }
  if (
    continuationEvidence.canContinueToLaterFrontier !== (stopReason === TRAJECTORY_STOP_REASON_STOP_X) ||
    continuationEvidence.reachedTargetCount !== reachedTargetCount ||
    continuationEvidence.reachedRequiredTargetCount !== reachedRequiredTargetCount ||
    continuationEvidence.shouldSkipInitialStop !== (stopReason !== TRAJECTORY_STOP_REASON_TARGET)
  ) {
    throwFormulaResultError("Trajectory continuation evidence does not match its result state");
  }
  const initialSampleIndex = isContinuationUsed && start.type === "continuation" ? start.evidence.state.sampleIndex : 0;
  const acceptedTerminalOffset = stopReason === TRAJECTORY_STOP_REASON_OUT_OF_BOUNDS ? pointCount : pointCount - 1;
  const expectedSampleIndex = initialSampleIndex + acceptedTerminalOffset;
  if (expectedSampleIndex > 0xffff_ffff || state.sampleIndex !== expectedSampleIndex) {
    throwFormulaResultError("Trajectory terminal sample index does not match its published points");
  }
  const lastPoint = points.at(-1);
  if (!lastPoint) {
    throwFormulaResultError("Trajectory result must publish at least one point");
  }
  if (stopReason === TRAJECTORY_STOP_REASON_OUT_OF_BOUNDS) {
    const previousPoint = getGraphwarWasmTrajectoryPreviousPoint(state);
    if (!previousPoint || !graphwarPointsEqual(previousPoint, lastPoint)) {
      throwFormulaResultError("Out-of-bounds trajectory state must retain the last published point as previous");
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
      throwFormulaResultError("Out-of-bounds trajectory state remained inside its graph bounds");
    }
  } else if (!graphwarPointsEqual(state.currentPoint, lastPoint)) {
    throwFormulaResultError("Trajectory terminal state does not match its last published point");
  }
  if (pointCount > 1 && stopReason !== TRAJECTORY_STOP_REASON_OUT_OF_BOUNDS) {
    const previousPoint = getGraphwarWasmTrajectoryPreviousPoint(state);
    if (!previousPoint || !graphwarPointsEqual(previousPoint, points[pointCount - 2])) {
      throwFormulaResultError("Trajectory previous state does not match its penultimate published point");
    }
  }

  const lastPublishedSampleIndex = initialSampleIndex + pointCount - 1;
  const hasObstacleHit = (resultFlags & TRAJECTORY_RESULT_FLAG_OBSTACLE_HIT) !== 0;
  validateGraphwarWasmTrajectoryHitIndex(obstacleHitIndex, initialSampleIndex, lastPublishedSampleIndex, "obstacle");
  const canHitObstacle = stop.type === "targets" && stop.collision.type === "mask";
  if (
    hasObstacleHit !== obstacleHitIndex >= 0 ||
    hasObstacleHit !== (stopReason === TRAJECTORY_STOP_REASON_OBSTACLE) ||
    (hasObstacleHit && (!canHitObstacle || obstacleHitIndex !== lastPublishedSampleIndex))
  ) {
    throwFormulaResultError("Trajectory obstacle flag, index, and stop reason are inconsistent");
  }

  if (stop.type === "targets") {
    if (
      reachedTargetCount > stop.orderedTargets.length ||
      reachedRequiredTargetCount > stop.requiredTargets.length ||
      trackedTargetHitIndexes.length !== stop.trackedTargets.length
    ) {
      throwFormulaResultError("Trajectory target counts exceed the stop policy");
    }
    validateGraphwarWasmTrajectoryHitIndex(targetHitIndex, initialSampleIndex, lastPublishedSampleIndex, "target");
    validateGraphwarWasmTrajectoryHitIndex(
      requiredTargetsHitIndex,
      initialSampleIndex,
      lastPublishedSampleIndex,
      "required target",
    );
    const hasCompletedOrderedTargets =
      stop.orderedTargets.length > 0 && reachedTargetCount === stop.orderedTargets.length;
    const hasCompletedRequiredTargets =
      stop.requiredTargets.length > 0 && reachedRequiredTargetCount === stop.requiredTargets.length;
    if (
      targetHitIndex >= 0 !== hasCompletedOrderedTargets ||
      requiredTargetsHitIndex >= 0 !== hasCompletedRequiredTargets
    ) {
      throwFormulaResultError("Trajectory target completion indexes do not match reached counts");
    }
    for (let index = 0; index < trackedTargetHitIndexes.length; index += 1) {
      validateGraphwarWasmTrajectoryHitIndex(
        trackedTargetHitIndexes[index],
        initialSampleIndex,
        lastPublishedSampleIndex,
        `tracked target ${index}`,
      );
    }
    if (
      stopReason === TRAJECTORY_STOP_REASON_TARGET &&
      (!stop.shouldStopOnTargetsComplete ||
        (stop.orderedTargets.length === 0 && stop.requiredTargets.length === 0) ||
        reachedTargetCount !== stop.orderedTargets.length ||
        reachedRequiredTargetCount !== stop.requiredTargets.length)
    ) {
      throwFormulaResultError("Trajectory target stop reason does not match the stop policy");
    }
    if (stopReason === TRAJECTORY_STOP_REASON_STOP_X && stop.continueAfterTargetsUntilGraphX.type !== "value") {
      throwFormulaResultError("Target trajectory stopped on x without a continuation boundary");
    }
  } else if (
    reachedTargetCount !== 0 ||
    reachedRequiredTargetCount !== 0 ||
    targetHitIndex !== -1 ||
    requiredTargetsHitIndex !== -1 ||
    trackedTargetHitIndexes.length !== 0 ||
    stopReason === TRAJECTORY_STOP_REASON_TARGET ||
    stopReason === TRAJECTORY_STOP_REASON_OBSTACLE
  ) {
    throwFormulaResultError("Non-target trajectory returned target or obstacle state");
  }
  if (stopReason === TRAJECTORY_STOP_REASON_STOP_X && stop.type === "natural") {
    throwFormulaResultError("Natural trajectory returned an explicit stop-x reason");
  }
  const requestedStopX =
    stop.type === "stop-x-observations"
      ? stop.stopX
      : stop.type === "targets" && stop.continueAfterTargetsUntilGraphX.type === "value"
        ? stop.continueAfterTargetsUntilGraphX.graphX
        : undefined;
  if (
    stopReason === TRAJECTORY_STOP_REASON_STOP_X &&
    (requestedStopX === undefined || state.currentPoint.x < requestedStopX)
  ) {
    throwFormulaResultError("Trajectory stop-x state did not reach its requested frontier");
  }
  if (stopReason === TRAJECTORY_STOP_REASON_MAX_STEPS && state.sampleIndex !== GRAPHWAR_FUNC_MAX_STEPS - 1) {
    throwFormulaResultError("Max-steps trajectory state did not reach the sampling limit");
  }

  if (stop.type !== "stop-x-observations" && observations.length !== 0) {
    throwFormulaResultError("Trajectory returned observations for a stop policy without observations");
  }
  if (stop.type === "stop-x-observations") {
    const firstObservablePointIndex =
      isContinuationUsed && start.type === "continuation" && start.evidence.shouldSkipInitialStop ? 1 : 0;
    const expectedObservationPointIndexes: number[] = [];
    let expectedObservationIndex = 0;
    for (
      let pointIndex = firstObservablePointIndex;
      pointIndex < points.length && expectedObservationIndex < stop.observationXs.length;
      pointIndex += 1
    ) {
      while (
        expectedObservationIndex < stop.observationXs.length &&
        points[pointIndex].x >= stop.observationXs[expectedObservationIndex]
      ) {
        expectedObservationPointIndexes.push(pointIndex);
        expectedObservationIndex += 1;
      }
    }
    if (observations.length !== expectedObservationPointIndexes.length) {
      throwFormulaResultError("Trajectory observation count does not match its accepted points");
    }
    for (let index = 0; index < observations.length; index += 1) {
      const observation = observations[index];
      const expectedPointIndex = expectedObservationPointIndexes[index];
      const localIndex = observation.sampleIndex - initialSampleIndex;
      if (
        localIndex !== expectedPointIndex ||
        !graphwarPointsEqual(points[expectedPointIndex], observation) ||
        !Object.is(pointDys[expectedPointIndex], observation.dy)
      ) {
        throwFormulaResultError("Trajectory observation state does not match its accepted point");
      }
    }
  }
}

function validateGraphwarWasmTrajectoryStopReason(value: number): GraphwarWasmTrajectoryStopReason {
  if (
    value !== TRAJECTORY_STOP_REASON_STOP_X &&
    value !== TRAJECTORY_STOP_REASON_INVALID &&
    value !== TRAJECTORY_STOP_REASON_MAX_STEPS &&
    value !== TRAJECTORY_STOP_REASON_OUT_OF_BOUNDS &&
    value !== TRAJECTORY_STOP_REASON_TOO_STEEP &&
    value !== TRAJECTORY_STOP_REASON_OBSTACLE &&
    value !== TRAJECTORY_STOP_REASON_TARGET
  ) {
    throwFormulaResultError("Trajectory result contains an invalid stop reason");
  }
  return value;
}

function validateGraphwarWasmTrajectoryHitIndex(
  value: number,
  minimum: number,
  maximum: number,
  fieldName: string,
): void {
  if (value !== -1 && (!Number.isInteger(value) || value < minimum || value > maximum)) {
    throwFormulaResultError(`Trajectory ${fieldName} hit index is outside the published sample range`);
  }
}

function validateGraphwarWasmTrajectoryEvidenceProof(view: DataView, protectionBytes: Uint8Array): void {
  const dependencyBytes = new Uint8Array(view.buffer, view.byteOffset, 16);
  const protectionCountBytes = new Uint8Array(view.buffer, view.byteOffset + 36, 4);
  const stateBytes = new Uint8Array(view.buffer, view.byteOffset + 40, 64);
  const calculate = (seed: bigint) => {
    let hash = hashGraphwarWasmTrajectoryBytes(seed, dependencyBytes);
    hash = hashGraphwarWasmTrajectoryBytes(hash, protectionCountBytes);
    hash = hashGraphwarWasmTrajectoryBytes(hash, stateBytes);
    return hashGraphwarWasmTrajectoryBytes(hash, protectionBytes);
  };
  if (
    view.getBigUint64(16, true) !== calculate(TRAJECTORY_HASH_A_SEED) ||
    view.getBigUint64(24, true) !== calculate(TRAJECTORY_HASH_B_SEED)
  ) {
    throwFormulaResultError("Trajectory continuation evidence proof is invalid");
  }
}

function hashGraphwarWasmTrajectoryBytes(seed: bigint, bytes: Uint8Array) {
  let hash = seed;
  for (const value of bytes) {
    hash = ((hash ^ BigInt(value)) * TRAJECTORY_HASH_PRIME) & TRAJECTORY_HASH_MASK;
  }
  return hash;
}

function readGraphwarWasmIdentityHash(view: DataView, offset: number): GraphwarWasmIdentityHash {
  return [
    view.getUint32(offset, true),
    view.getUint32(offset + 4, true),
    view.getUint32(offset + 8, true),
    view.getUint32(offset + 12, true),
  ];
}

function graphwarWasmTrajectoryStatesEqual(
  left: GraphwarWasmTrajectoryPhysicalState,
  right: GraphwarWasmTrajectoryPhysicalState,
) {
  if (
    left.equation !== right.equation ||
    left.sampleIndex !== right.sampleIndex ||
    !graphwarPointsEqual(left.currentPoint, right.currentPoint)
  ) {
    return false;
  }
  if (left.equation === "ddy" && right.equation === "ddy") {
    return (
      Object.is(left.currentDy, right.currentDy) &&
      ((left.previous === undefined && right.previous === undefined) ||
        (left.previous !== undefined &&
          right.previous !== undefined &&
          Object.is(left.previous.dy, right.previous.dy) &&
          graphwarPointsEqual(left.previous.point, right.previous.point)))
    );
  }
  return (
    left.equation !== "ddy" &&
    right.equation !== "ddy" &&
    ((left.previousPoint === undefined && right.previousPoint === undefined) ||
      (left.previousPoint !== undefined &&
        right.previousPoint !== undefined &&
        graphwarPointsEqual(left.previousPoint, right.previousPoint)))
  );
}

function getGraphwarWasmTrajectoryPreviousPoint(state: GraphwarWasmTrajectoryPhysicalState) {
  return state.equation === "ddy" ? state.previous?.point : state.previousPoint;
}

function graphwarPointsEqual(left: { x: number; y: number }, right: { x: number; y: number }) {
  return Object.is(left.x, right.x) && Object.is(left.y, right.y);
}

function packGraphwarWasmTrajectoryEvidence(
  runtime: GraphwarWasmKernelRuntime,
  evidence: GraphwarWasmTrajectoryContinuationEvidence,
  equation: EquationMode,
  segmentCount: number,
) {
  if (!isRecord(evidence) || !isRecord(evidence.state)) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Trajectory continuation evidence is malformed",
      "input",
    );
  }
  const dependencyHash = validateGraphwarWasmIdentityHash(evidence.dependencyHash, "evidence.dependencyHash");
  const proofHash = validateGraphwarWasmIdentityHash(evidence.proofHash, "evidence.proofHash");
  if (!Array.isArray(evidence.observedSignProtection) || evidence.observedSignProtection.length !== segmentCount) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Trajectory continuation protection must match the formula segments",
      "input",
    );
  }
  const protection = Uint32Array.from(evidence.observedSignProtection, (value, index) =>
    validateGraphwarWasmProtectionBits(value, ALLOWED_SIGN_PROTECTION_BITS, `evidence.protection[${index}]`, "input"),
  );
  if (typeof evidence.canContinueToLaterFrontier !== "boolean" || typeof evidence.shouldSkipInitialStop !== "boolean") {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Trajectory continuation capability flags must be boolean",
      "input",
    );
  }
  const reachedTargetCount = validateGraphwarWasmU32(
    evidence.reachedTargetCount,
    "evidence.reachedTargetCount",
    "input",
  );
  const reachedRequiredTargetCount = validateGraphwarWasmU32(
    evidence.reachedRequiredTargetCount,
    "evidence.reachedRequiredTargetCount",
    "input",
  );
  const state = evidence.state;
  if (state.equation !== equation) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Trajectory continuation equation does not match the descriptor",
      "input",
    );
  }
  const sampleIndex = validateGraphwarWasmU32(state.sampleIndex, "evidence.state.sampleIndex", "input");
  const currentX = validateGraphwarWasmFiniteNumber(state.currentPoint.x, "evidence.state.currentPoint.x", "input");
  const currentY = validateGraphwarWasmFiniteNumber(state.currentPoint.y, "evidence.state.currentPoint.y", "input");
  let currentDy = 0;
  let previousX = 0;
  let previousY = 0;
  let previousDy = 0;
  let evidenceFlags =
    (evidence.shouldSkipInitialStop ? TRAJECTORY_EVIDENCE_FLAG_SKIP_INITIAL_STOP : 0) |
    (evidence.canContinueToLaterFrontier ? TRAJECTORY_EVIDENCE_FLAG_CAN_CONTINUE_TO_LATER_FRONTIER : 0);
  if (state.equation === "ddy") {
    currentDy = validateGraphwarWasmFiniteNumber(state.currentDy, "evidence.state.currentDy", "input");
    evidenceFlags |= TRAJECTORY_EVIDENCE_FLAG_HAS_DY;
    if (state.previous !== undefined) {
      previousX = validateGraphwarWasmFiniteNumber(state.previous.point.x, "evidence.state.previous.point.x", "input");
      previousY = validateGraphwarWasmFiniteNumber(state.previous.point.y, "evidence.state.previous.point.y", "input");
      previousDy = validateGraphwarWasmFiniteNumber(state.previous.dy, "evidence.state.previous.dy", "input");
      evidenceFlags |= TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_POINT | TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_DY;
    }
  } else if (state.previousPoint !== undefined) {
    previousX = validateGraphwarWasmFiniteNumber(state.previousPoint.x, "evidence.state.previousPoint.x", "input");
    previousY = validateGraphwarWasmFiniteNumber(state.previousPoint.y, "evidence.state.previousPoint.y", "input");
    evidenceFlags |= TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_POINT;
  }
  const hasPreviousPoint = (evidenceFlags & TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_POINT) !== 0;
  if ((sampleIndex === 0) === hasPreviousPoint) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Trajectory continuation previous state does not match its sample index",
      "input",
    );
  }
  const protectionSlice = writeGraphwarWasmUint32Values(runtime, protection);
  const pointer = runtime.reserveArena(TRAJECTORY_EVIDENCE_BYTE_LENGTH, 8);
  new Uint8Array(runtime.buffer, pointer, TRAJECTORY_EVIDENCE_BYTE_LENGTH).fill(0);
  const view = new DataView(runtime.buffer, pointer, TRAJECTORY_EVIDENCE_BYTE_LENGTH);
  for (let index = 0; index < dependencyHash.length; index += 1) {
    view.setUint32(index * 4, dependencyHash[index], true);
    view.setUint32(16 + index * 4, proofHash[index], true);
  }
  view.setUint32(32, protectionSlice.pointer, true);
  view.setUint32(36, protectionSlice.length, true);
  view.setFloat64(40, currentX, true);
  view.setFloat64(48, currentY, true);
  view.setFloat64(56, currentDy, true);
  view.setFloat64(64, previousX, true);
  view.setFloat64(72, previousY, true);
  view.setFloat64(80, previousDy, true);
  view.setUint32(88, sampleIndex, true);
  view.setUint32(92, reachedTargetCount, true);
  view.setUint32(96, reachedRequiredTargetCount, true);
  view.setUint32(100, evidenceFlags, true);
  return { byteLength: TRAJECTORY_EVIDENCE_BYTE_LENGTH, pointer };
}

function validateGraphwarWasmIdentityHash(value: unknown, fieldName: string): GraphwarWasmIdentityHash {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new GraphwarWasmAdapterError("invalid-formula-input", `${fieldName} must contain four u32 limbs`, "input");
  }
  return [
    validateGraphwarWasmU32(value[0], `${fieldName}[0]`, "input"),
    validateGraphwarWasmU32(value[1], `${fieldName}[1]`, "input"),
    validateGraphwarWasmU32(value[2], `${fieldName}[2]`, "input"),
    validateGraphwarWasmU32(value[3], `${fieldName}[3]`, "input"),
  ];
}

function packFormulaValues(runtime: GraphwarWasmKernelRuntime, values: readonly GraphwarWasmFormulaValue[]) {
  if (!Array.isArray(values)) {
    throw new GraphwarWasmAdapterError("invalid-formula-input", "Formula values must be an array", "input");
  }
  const length = validateGraphwarWasmU32(values.length, "values.length", "input");
  const x = new Float64Array(length);
  const y = new Float64Array(length);
  const dy = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    const value = values[index];
    if (typeof value !== "object" || value === null) {
      throw new GraphwarWasmAdapterError("invalid-formula-input", `values[${index}] must be an object`, "input");
    }
    x[index] = validateFormulaNumber(value.x, `values[${index}].x`);
    y[index] = validateFormulaNumber(value.y, `values[${index}].y`);
    dy[index] = validateFormulaNumber(value.dy, `values[${index}].dy`);
  }
  return {
    dy: writeGraphwarWasmFloat64Values(runtime, dy),
    length,
    x: writeGraphwarWasmFloat64Values(runtime, x),
    y: writeGraphwarWasmFloat64Values(runtime, y),
  };
}

function packFormulaInput(
  runtime: GraphwarWasmKernelRuntime,
  descriptor: GraphwarWasmFormulaInputDescriptor,
  formulaEvaluation: FormulaEvaluationOptions | undefined,
  values: readonly GraphwarWasmFormulaValue[],
  isLaunchPreparation: boolean,
): PackedFormulaInput {
  validateFormulaDescriptor(descriptor);
  validateFormulaEvaluation(descriptor, formulaEvaluation);
  const packedPoints = packGraphwarWasmPointSoA(runtime, descriptor.points);
  const pointCount = packedPoints.length;
  const segmentCount = pointCount - 1;
  const packedValues = packFormulaValues(runtime, values);
  const packedEvaluation = packFormulaEvaluation(runtime, segmentCount, pointCount, formulaEvaluation);
  const settings = descriptor.settings;
  const stepOverflowProtectionRange =
    settings.algorithm === "step"
      ? isLaunchPreparation
        ? {
            maxX: Math.max(descriptor.bounds.minX, descriptor.bounds.maxX),
            minX: descriptor.points[0].x,
          }
        : formulaEvaluation?.stepOverflowProtectionRange
      : undefined;
  const packedStepOverflowProtectionRange =
    stepOverflowProtectionRange === undefined
      ? { length: 0, pointer: 0 }
      : writeGraphwarWasmFloat64Values(
          runtime,
          new Float64Array([stepOverflowProtectionRange.minX, stepOverflowProtectionRange.maxX]),
        );
  const isStepGlitchModeActive =
    isLaunchPreparation &&
    resolveFormulaModeContract(settings.algorithm, settings.equation, settings.isStepGlitchModeEnabled).pathSearchPolicy
      .type === "step-glitch";
  const stepGlitchMask =
    isStepGlitchModeActive && settings.stepGlitchObstacleMask
      ? writeGraphwarWasmBytes(runtime, settings.stepGlitchObstacleMask)
      : { length: 0, pointer: 0 };
  const signProtection = formulaEvaluation?.signProtection ?? [];
  const protection = writeGraphwarWasmUint32Values(runtime, Uint32Array.from(signProtection));
  const inputPointer = runtime.reserveArena(FORMULA_INPUT_BYTE_LENGTH, 8);
  new Uint8Array(runtime.buffer, inputPointer, FORMULA_INPUT_BYTE_LENGTH).fill(0);
  const inputView = new DataView(runtime.buffer);
  inputView.setUint32(inputPointer, getGraphwarWasmFormulaAlgorithmTag(settings.algorithm), true);
  inputView.setUint32(inputPointer + 4, getGraphwarWasmFormulaEquationTag(settings.equation), true);
  inputView.setInt32(inputPointer + 8, settings.decimalPlaces, true);
  inputView.setUint32(
    inputPointer + 12,
    (settings.algorithm === "step" && settings.isStepOverflowProtectionEnabled
      ? FORMULA_FLAG_STEP_OVERFLOW_PROTECTION
      : 0) |
      (isLaunchPreparation && settings.equation === "ddy" && settings.secondOrderLaunchAngleMode === "display-rounded"
        ? FORMULA_FLAG_DISPLAY_ROUNDED_ANGLE
        : 0) |
      (isLaunchPreparation && descriptor.secondOrderLaunchAngle !== undefined
        ? FORMULA_FLAG_HAS_USER_LAUNCH_ANGLE
        : 0) |
      (isStepGlitchModeActive ? FORMULA_FLAG_STEP_GLITCH_MODE : 0),
    true,
  );
  inputView.setUint32(inputPointer + 16, pointCount, true);
  inputView.setUint32(inputPointer + 20, packedPoints.x.pointer, true);
  inputView.setUint32(inputPointer + 24, packedPoints.y.pointer, true);
  inputView.setUint32(inputPointer + 28, protection.pointer, true);
  inputView.setUint32(inputPointer + 32, protection.length, true);
  inputView.setUint32(inputPointer + 36, packedValues.length, true);
  inputView.setUint32(inputPointer + 40, packedValues.x.pointer, true);
  inputView.setUint32(inputPointer + 44, packedValues.y.pointer, true);
  inputView.setUint32(inputPointer + 48, packedValues.dy.pointer, true);
  inputView.setUint32(inputPointer + 52, packedStepOverflowProtectionRange.pointer, true);
  inputView.setFloat64(inputPointer + 56, settings.steepness, true);
  inputView.setFloat64(inputPointer + 64, descriptor.bounds.minX, true);
  inputView.setFloat64(inputPointer + 72, descriptor.bounds.maxX, true);
  inputView.setFloat64(inputPointer + 80, descriptor.bounds.minY, true);
  inputView.setFloat64(inputPointer + 88, descriptor.bounds.maxY, true);
  inputView.setFloat64(inputPointer + 96, descriptor.soldierCenter.x, true);
  inputView.setFloat64(inputPointer + 104, descriptor.soldierCenter.y, true);
  inputView.setFloat64(inputPointer + 112, descriptor.secondOrderLaunchAngle?.radians ?? 0, true);
  inputView.setUint32(inputPointer + 120, packedEvaluation.disabledSegments.pointer, true);
  inputView.setUint32(inputPointer + 124, packedEvaluation.segmentStartX.pointer, true);
  inputView.setUint32(inputPointer + 128, packedEvaluation.segmentStartY.pointer, true);
  inputView.setUint32(inputPointer + 132, packedEvaluation.stepDeltaY.pointer, true);
  inputView.setUint32(inputPointer + 136, packedEvaluation.stepGlitchSegments.pointer, true);
  inputView.setUint32(inputPointer + 140, packedEvaluation.absPulseDeltaSlope.pointer, true);
  inputView.setUint32(inputPointer + 144, packedEvaluation.absPulseCenterX.pointer, true);
  inputView.setUint32(inputPointer + 148, packedStepOverflowProtectionRange.length, true);
  inputView.setFloat64(inputPointer + 152, settings.formulaPathSteepness ?? settings.steepness, true);
  inputView.setUint32(inputPointer + 160, stepGlitchMask.pointer, true);
  inputView.setUint32(inputPointer + 164, stepGlitchMask.length, true);
  inputView.setFloat64(inputPointer + 168, graphwarToolDefaults.formulaPathQualityTargetPlanePixels, true);
  return { inputPointer, pointCount, segmentCount };
}

function validateFormulaDescriptor(descriptor: GraphwarWasmFormulaInputDescriptor): void {
  if (typeof descriptor !== "object" || descriptor === null) {
    throw new GraphwarWasmAdapterError("invalid-formula-input", "Formula descriptor must be an object", "input");
  }
  if (!isGraphwarFormulaBounds(descriptor.bounds)) {
    throw new GraphwarWasmAdapterError("invalid-formula-input", "Formula bounds are invalid", "input");
  }
  if (!isGraphwarTrajectoryFormulaSettings(descriptor.settings)) {
    throw new GraphwarWasmAdapterError("invalid-formula-input", "Formula settings are invalid", "input");
  }
  if (!Array.isArray(descriptor.points) || descriptor.points.length < 2) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Formula descriptor requires at least two points",
      "input",
    );
  }
  if (!isGraphwarTrajectoryPoint(descriptor.soldierCenter)) {
    throw new GraphwarWasmAdapterError("invalid-formula-input", "Formula soldier center is invalid", "input");
  }
  validateGraphwarWasmSecondOrderLaunchAngle(descriptor.settings.equation, descriptor.secondOrderLaunchAngle);
}

/** Formula coordinates may be mirrored on either axis, but a zero-width axis cannot define a coordinate transform. */
function isGraphwarFormulaBounds(value: unknown): value is GraphBounds {
  return (
    isRecord(value) &&
    isFiniteFormulaBound(value.minX) &&
    isFiniteFormulaBound(value.maxX) &&
    isFiniteFormulaBound(value.minY) &&
    isFiniteFormulaBound(value.maxY) &&
    value.minX !== value.maxX &&
    value.minY !== value.maxY
  );
}

function isFiniteFormulaBound(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateFormulaEvaluation(
  descriptor: GraphwarWasmFormulaInputDescriptor,
  formulaEvaluation: FormulaEvaluationOptions | undefined,
): void {
  if (formulaEvaluation === undefined) {
    return;
  }
  if (typeof formulaEvaluation !== "object" || formulaEvaluation === null) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Formula evaluation options must be an object",
      "input",
    );
  }
  const { algorithm, decimalPlaces, equation, isStepOverflowProtectionEnabled } = descriptor.settings;
  const segmentCount = descriptor.points.length - 1;
  if (formulaEvaluation.equation !== undefined && formulaEvaluation.equation !== equation) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Formula evaluation equation does not match settings",
      "input",
    );
  }
  if (
    formulaEvaluation.formulaDecimalPlaces !== undefined &&
    formulaEvaluation.formulaDecimalPlaces !== decimalPlaces
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Formula evaluation precision does not match settings",
      "input",
    );
  }
  if (
    formulaEvaluation.isStepOverflowProtectionEnabled !== undefined &&
    formulaEvaluation.isStepOverflowProtectionEnabled !== isStepOverflowProtectionEnabled
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Formula overflow protection does not match settings",
      "input",
    );
  }
  if (formulaEvaluation.onZeroSignArgument !== undefined) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Formula callbacks cannot cross the WASM boundary",
      "input",
    );
  }
  const stepOverflowProtectionRange = formulaEvaluation.stepOverflowProtectionRange;
  if (stepOverflowProtectionRange !== undefined) {
    if (
      algorithm !== "step" ||
      !isRecord(stepOverflowProtectionRange) ||
      !isFiniteFormulaBound(stepOverflowProtectionRange.minX) ||
      !isFiniteFormulaBound(stepOverflowProtectionRange.maxX)
    ) {
      throw new GraphwarWasmAdapterError("invalid-formula-input", "Formula Step overflow range is invalid", "input");
    }
  }
  validateOptionalFormulaArray(
    formulaEvaluation.disabledSegments,
    segmentCount,
    "disabledSegments",
    (value) => typeof value === "boolean",
  );
  validateOptionalFormulaArray(
    formulaEvaluation.segmentStartPoints,
    segmentCount,
    "segmentStartPoints",
    (value) => value === undefined || isGraphwarTrajectoryPoint(value),
  );
  validateOptionalFormulaArray(
    formulaEvaluation.stepSegmentDeltaYs,
    segmentCount,
    "stepSegmentDeltaYs",
    (value) => value === undefined || (typeof value === "number" && Number.isFinite(value)),
  );
  validateOptionalFormulaArray(
    formulaEvaluation.absSecondDerivativePulseDeltaSlopes,
    segmentCount,
    "absSecondDerivativePulseDeltaSlopes",
    (value) => value === undefined || (typeof value === "number" && Number.isFinite(value)),
  );
  validateOptionalFormulaArray(
    formulaEvaluation.absSecondDerivativePulseCenterXs,
    segmentCount,
    "absSecondDerivativePulseCenterXs",
    (value) => value === undefined || (typeof value === "number" && Number.isFinite(value)),
  );
  validateOptionalFormulaArray(formulaEvaluation.signProtection, segmentCount, "signProtection", (value) => {
    try {
      validateGraphwarWasmProtectionBits(value, ALLOWED_SIGN_PROTECTION_BITS, "protectionBits", "input");
      return true;
    } catch {
      return false;
    }
  });
  if (
    formulaEvaluation.signProtection !== undefined &&
    ![0, segmentCount].includes(formulaEvaluation.signProtection.length)
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Formula sign protection must be empty or match the segment count",
      "input",
    );
  }
  validateOptionalFormulaArray(formulaEvaluation.stepGlitchSegments, segmentCount, "stepGlitchSegments", (segment) => {
    if (segment === undefined) {
      return true;
    }
    return algorithm === "step" && equation !== "y" && validateStepGlitchSegment(segment, equation);
  });
}

function validateOptionalFormulaArray<TValue>(
  values: readonly TValue[] | undefined,
  maximumLength: number,
  fieldName: string,
  validateValue: (value: TValue) => boolean,
): void {
  if (values === undefined) {
    return;
  }
  if (!Array.isArray(values) || values.length > maximumLength || !values.every(validateValue)) {
    throw new GraphwarWasmAdapterError("invalid-formula-input", `${fieldName} is invalid`, "input");
  }
}

function validateStepGlitchSegment(segment: StepGlitchSegment, equation: EquationMode): boolean {
  if (
    typeof segment !== "object" ||
    segment === null ||
    segment.equation !== equation ||
    (segment.formulaDecimalPlaces !== undefined &&
      (!Number.isInteger(segment.formulaDecimalPlaces) ||
        segment.formulaDecimalPlaces < 0 ||
        segment.formulaDecimalPlaces > 15)) ||
    ![segment.startX, segment.endX, segment.targetY].every(Number.isFinite)
  ) {
    return false;
  }
  return segment.equation === "dy"
    ? [segment.derivative, segment.gateY].every(Number.isFinite)
    : [segment.acceleration, segment.accelerationGateY, segment.braking, segment.brakingGateY, segment.pulseEndX].every(
        Number.isFinite,
      );
}

function packFormulaEvaluation(
  runtime: GraphwarWasmKernelRuntime,
  segmentCount: number,
  pointCount: number,
  formulaEvaluation: FormulaEvaluationOptions | undefined,
) {
  const disabledSegments =
    formulaEvaluation?.disabledSegments === undefined
      ? { length: 0, pointer: 0 }
      : writeGraphwarWasmBytes(
          runtime,
          Uint8Array.from({ length: segmentCount }, (_, index) =>
            formulaEvaluation.disabledSegments?.[index] ? 1 : 0,
          ),
        );
  let segmentStartX = { length: 0, pointer: 0 };
  let segmentStartY = { length: 0, pointer: 0 };
  if (formulaEvaluation?.segmentStartPoints !== undefined) {
    const x = new Float64Array(pointCount).fill(Number.NaN);
    const y = new Float64Array(pointCount).fill(Number.NaN);
    for (let index = 0; index < formulaEvaluation.segmentStartPoints.length; index += 1) {
      const point = formulaEvaluation.segmentStartPoints[index];
      if (point !== undefined) {
        x[index] = point.x;
        y[index] = point.y;
      }
    }
    segmentStartX = writeGraphwarWasmFloat64Values(runtime, x);
    segmentStartY = writeGraphwarWasmFloat64Values(runtime, y);
  }
  const stepDeltaY = packOptionalFormulaNumbers(runtime, formulaEvaluation?.stepSegmentDeltaYs, segmentCount);
  const absPulseDeltaSlope = packOptionalFormulaNumbers(
    runtime,
    formulaEvaluation?.absSecondDerivativePulseDeltaSlopes,
    segmentCount,
  );
  const absPulseCenterX = packOptionalFormulaNumbers(
    runtime,
    formulaEvaluation?.absSecondDerivativePulseCenterXs,
    segmentCount,
  );
  const stepGlitchSegments = packStepGlitchSegments(runtime, formulaEvaluation?.stepGlitchSegments, segmentCount);
  return {
    absPulseCenterX,
    absPulseDeltaSlope,
    disabledSegments,
    segmentStartX,
    segmentStartY,
    stepDeltaY,
    stepGlitchSegments,
  };
}

function packOptionalFormulaNumbers(
  runtime: GraphwarWasmKernelRuntime,
  values: readonly (number | undefined)[] | undefined,
  segmentCount: number,
) {
  return values === undefined
    ? { length: 0, pointer: 0 }
    : writeGraphwarWasmFloat64Values(
        runtime,
        Float64Array.from({ length: segmentCount }, (_, index) => values[index] ?? Number.NaN),
      );
}

function packStepGlitchSegments(
  runtime: GraphwarWasmKernelRuntime,
  segments: readonly (StepGlitchSegment | undefined)[] | undefined,
  segmentCount: number,
) {
  if (segments === undefined) {
    return { length: 0, pointer: 0 };
  }
  const bytes = new Uint8Array(segmentCount * STEP_GLITCH_RECORD_BYTE_LENGTH);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) {
      continue;
    }
    const offset = index * STEP_GLITCH_RECORD_BYTE_LENGTH;
    view.setInt32(offset, segment.equation === "dy" ? 2 : 3, true);
    view.setInt32(offset + 4, segment.formulaDecimalPlaces ?? -1, true);
    view.setFloat64(offset + 8, segment.startX, true);
    view.setFloat64(offset + 16, segment.endX, true);
    view.setFloat64(offset + 24, segment.targetY, true);
    if (segment.equation === "dy") {
      view.setFloat64(offset + 32, segment.derivative, true);
      view.setFloat64(offset + 40, segment.gateY, true);
    } else {
      view.setFloat64(offset + 32, segment.acceleration, true);
      view.setFloat64(offset + 40, segment.accelerationGateY, true);
      view.setFloat64(offset + 48, segment.braking, true);
      view.setFloat64(offset + 56, segment.brakingGateY, true);
      view.setFloat64(offset + 64, segment.pulseEndX, true);
    }
  }
  const pointer = runtime.reserveArena(bytes.length, 8);
  new Uint8Array(runtime.buffer, pointer, bytes.length).set(bytes);
  return { length: segmentCount, pointer };
}

function readRawFormulaBatchResult(
  runtime: GraphwarWasmKernelRuntime,
  resultPointer: number,
  outputMinimumPointer: number,
  expected: {
    expectedMaterialCountMaximum: number;
    expectedMaterialStride: number;
    expectedMaterialType: number;
    expectedProtectionCount: number;
    expectedValueCount: number;
  },
): RawFormulaBatchResult {
  const resultRange = validateGraphwarWasmMemoryRange(
    runtime,
    { length: 1, pointer: resultPointer },
    { alignment: 8, elementByteLength: FORMULA_RESULT_BYTE_LENGTH, minimumPointer: outputMinimumPointer },
  );
  const view = new DataView(resultRange.buffer, resultRange.byteOffset, resultRange.byteLength);
  const materialType = view.getInt32(0, true);
  const materialPointer = view.getUint32(4, true);
  const materialCount = view.getUint32(8, true);
  const materialStride = view.getUint32(12, true);
  const valuePointer = view.getUint32(16, true);
  const valueCount = view.getUint32(20, true);
  const protectionPointer = view.getUint32(32, true);
  const protectionCount = view.getUint32(36, true);
  if (
    materialType !== expected.expectedMaterialType ||
    materialStride !== expected.expectedMaterialStride ||
    materialCount > expected.expectedMaterialCountMaximum ||
    valueCount !== expected.expectedValueCount ||
    protectionCount !== expected.expectedProtectionCount
  ) {
    throwFormulaResultError("Formula result layout does not match the command contract");
  }
  validateGraphwarWasmMemoryRange(
    runtime,
    { length: materialCount, pointer: materialPointer },
    {
      alignment: expected.expectedMaterialStride === 0 ? 1 : 8,
      elementByteLength: expected.expectedMaterialStride === 0 ? 1 : expected.expectedMaterialStride,
      minimumPointer: outputMinimumPointer,
    },
  );
  return {
    auxiliaryValue: view.getFloat64(24, true),
    flags: view.getUint32(40, true),
    materialCount,
    materialPointer,
    materialStride,
    materialType,
    observedSignProtection: copyAndValidateProtection(
      runtime,
      protectionPointer,
      protectionCount,
      outputMinimumPointer,
    ),
    values: copyGraphwarWasmFloat64Values(runtime, { length: valueCount, pointer: valuePointer }, outputMinimumPointer),
  };
}

function copyAndValidateProtection(
  runtime: GraphwarWasmKernelRuntime,
  pointer: number,
  count: number,
  outputMinimumPointer: number,
) {
  const values = copyGraphwarWasmUint32Values(runtime, { length: count, pointer }, outputMinimumPointer);
  for (let index = 0; index < values.length; index += 1) {
    try {
      validateGraphwarWasmProtectionBits(values[index], ALLOWED_SIGN_PROTECTION_BITS, `protection[${index}]`);
    } catch (error) {
      if (error instanceof GraphwarWasmAdapterError) {
        throwFormulaResultError(error.message);
      }
      throw error;
    }
  }
  return [...values];
}

function decodeFormulaMaterials(
  runtime: GraphwarWasmKernelRuntime,
  result: RawFormulaBatchResult,
  algorithm: AlgorithmMode,
  equation: EquationMode,
  decimalPlaces: number,
  segmentCount: number,
  outputMinimumPointer: number,
): CompiledGraphwarFormulaMaterials {
  const range = validateGraphwarWasmMemoryRange(
    runtime,
    { length: result.materialCount, pointer: result.materialPointer },
    { alignment: 8, elementByteLength: result.materialStride, minimumPointer: outputMinimumPointer },
  );
  const view = new DataView(range.buffer);
  if (algorithm === "abs" && equation !== "ddy") {
    if (result.flags !== 0) {
      throwFormulaResultError("ABS connector result contains unsupported flags");
    }
    const absSegments: CompiledAbsConnectorSegment[] = [];
    let previousSourceSegmentIndex = -1;
    for (let index = 0; index < result.materialCount; index += 1) {
      const pointer = range.byteOffset + index * result.materialStride;
      const sourceSegmentIndex = view.getUint32(pointer + 32, true);
      validateMaterialSourceIndex(sourceSegmentIndex, previousSourceSegmentIndex, segmentCount);
      previousSourceSegmentIndex = sourceSegmentIndex;
      absSegments.push({
        coefficient: view.getFloat64(pointer, true),
        endX: view.getFloat64(pointer + 16, true),
        sourceSegmentIndex,
        startX: view.getFloat64(pointer + 8, true),
        width: view.getFloat64(pointer + 24, true),
      });
    }
    return { absSegments, algorithm };
  }
  if (algorithm === "abs") {
    if (result.flags !== 0) {
      throwFormulaResultError("ABS second-derivative result contains unsupported flags");
    }
    const pulses: CompiledAbsSecondDerivativePulse[] = [];
    for (let index = 0; index < result.materialCount; index += 1) {
      const pointer = range.byteOffset + index * result.materialStride;
      pulses.push({
        coefficient: view.getFloat64(pointer, true),
        formulaCenterX: view.getFloat64(pointer + 8, true),
      });
    }
    return {
      absSecondDerivativeFormula: { formulaSteepness: result.auxiliaryValue, pulses },
      absSegments: [],
      algorithm,
    };
  }
  if (algorithm === "step") {
    if ((result.flags & ~1) !== 0) {
      throwFormulaResultError("Step material result contains unsupported flags");
    }
    const terms: CompiledStepTerm[] = [];
    let previousSourceSegmentIndex = -1;
    for (let index = 0; index < result.materialCount; index += 1) {
      const pointer = range.byteOffset + index * result.materialStride;
      const sourceSegmentIndex = view.getUint32(pointer + 32, true);
      validateMaterialSourceIndex(sourceSegmentIndex, previousSourceSegmentIndex, segmentCount);
      previousSourceSegmentIndex = sourceSegmentIndex;
      const materialFlags = view.getUint32(pointer + 36, true);
      if ((materialFlags & ~STEP_MATERIAL_FLAG_OVERFLOW_PROTECTED) !== 0) {
        throwFormulaResultError("Step material contains unsupported flags");
      }
      const glitchEquation = view.getInt32(pointer + 40, true);
      let glitchSegment: StepGlitchSegment | undefined;
      if (glitchEquation === 0) {
        if (view.getInt32(pointer + 44, true) !== decimalPlaces) {
          throwFormulaResultError("Inactive Step glitch record has inconsistent precision");
        }
      } else if (glitchEquation === 2) {
        if (equation !== "dy") {
          throwFormulaResultError("Step material glitch equation does not match the Formula Mode");
        }
        const formulaDecimalPlaces = validateGlitchDecimalPlaces(view.getInt32(pointer + 44, true));
        glitchSegment = {
          derivative: view.getFloat64(pointer + 72, true),
          endX: view.getFloat64(pointer + 56, true),
          equation: "dy",
          formulaDecimalPlaces,
          gateY: view.getFloat64(pointer + 80, true),
          startX: view.getFloat64(pointer + 48, true),
          targetY: view.getFloat64(pointer + 64, true),
        };
      } else if (glitchEquation === 3) {
        if (equation !== "ddy") {
          throwFormulaResultError("Step material glitch equation does not match the Formula Mode");
        }
        const formulaDecimalPlaces = validateGlitchDecimalPlaces(view.getInt32(pointer + 44, true));
        glitchSegment = {
          acceleration: view.getFloat64(pointer + 72, true),
          accelerationGateY: view.getFloat64(pointer + 80, true),
          braking: view.getFloat64(pointer + 88, true),
          brakingGateY: view.getFloat64(pointer + 96, true),
          endX: view.getFloat64(pointer + 56, true),
          equation: "ddy",
          formulaDecimalPlaces,
          pulseEndX: view.getFloat64(pointer + 104, true),
          startX: view.getFloat64(pointer + 48, true),
          targetY: view.getFloat64(pointer + 64, true),
        };
      } else {
        throwFormulaResultError("Step material contains an unsupported glitch equation");
      }
      terms.push({
        firstDerivativeCoefficient: view.getFloat64(pointer + 8, true),
        formulaCenterX: view.getFloat64(pointer, true),
        ...(glitchSegment === undefined ? {} : { glitchSegment }),
        isDerivativeOverflowProtected: (materialFlags & STEP_MATERIAL_FLAG_OVERFLOW_PROTECTED) !== 0,
        secondDerivativeCoefficient: view.getFloat64(pointer + 16, true),
        sourceSegmentIndex,
        yCoefficient: view.getFloat64(pointer + 24, true),
      });
    }
    return { algorithm, stepFormula: { equation, formulaSteepness: result.auxiliaryValue, terms } };
  }

  if (result.materialCount !== segmentCount || result.flags !== 0) {
    throwFormulaResultError("Soft cubic material count or flags are inconsistent");
  }
  const softCubicSegments: CompiledSoftCubicSegment[] = [];
  for (let index = 0; index < result.materialCount; index += 1) {
    const pointer = range.byteOffset + index * result.materialStride;
    softCubicSegments.push({
      cubicCoefficients: readTuple4(view, pointer),
      firstCubicCoefficients: readTuple4(view, pointer + 32),
      firstPowerCoefficient: view.getFloat64(pointer + 64, true),
      halfWidth: view.getFloat64(pointer + 72, true),
      secondCubicCoefficients: readTuple4(view, pointer + 80),
      secondPowerCoefficient: view.getFloat64(pointer + 112, true),
      softCenterX: view.getFloat64(pointer + 120, true),
      startX: view.getFloat64(pointer + 128, true),
      width: view.getFloat64(pointer + 136, true),
    });
  }
  return { algorithm, softCubicSegments };
}

function getExpectedMaterialType(algorithm: AlgorithmMode, equation: EquationMode) {
  return algorithm === "step"
    ? FORMULA_MATERIAL_STEP
    : algorithm === "abs"
      ? equation === "ddy"
        ? FORMULA_MATERIAL_ABS_SECOND_DERIVATIVE
        : FORMULA_MATERIAL_ABS_CONNECTOR
      : FORMULA_MATERIAL_SOFT_CUBIC;
}

/** Winning launch materials cross the WASM boundary once; batch evaluation intentionally retains IEEE-754 results. */
function validateFiniteLaunchFormulaMaterials(
  compiledMaterials: CompiledGraphwarFormulaMaterials,
  equation: EquationMode,
): void {
  if (compiledMaterials.algorithm === "abs") {
    if (equation === "ddy") {
      const formula = compiledMaterials.absSecondDerivativeFormula;
      if (formula === undefined) {
        throwFormulaResultError("ABS second-derivative launch materials are missing");
      }
      validateFiniteLaunchFormulaValue(formula.formulaSteepness, "absSecondDerivativeFormula.formulaSteepness");
      for (let index = 0; index < formula.pulses.length; index += 1) {
        const pulse = formula.pulses[index];
        validateFiniteLaunchFormulaValue(pulse.coefficient, `absSecondDerivativeFormula.pulses[${index}].coefficient`);
        validateFiniteLaunchFormulaValue(
          pulse.formulaCenterX,
          `absSecondDerivativeFormula.pulses[${index}].formulaCenterX`,
        );
      }
      return;
    }

    const segments = compiledMaterials.absSegments;
    if (segments === undefined) {
      throwFormulaResultError("ABS connector launch materials are missing");
    }
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      validateFiniteLaunchFormulaValue(segment.coefficient, `absSegments[${index}].coefficient`);
      validateFiniteLaunchFormulaValue(segment.endX, `absSegments[${index}].endX`);
      validateFiniteLaunchFormulaValue(segment.startX, `absSegments[${index}].startX`);
      validateFiniteLaunchFormulaValue(segment.width, `absSegments[${index}].width`);
    }
    return;
  }

  if (compiledMaterials.algorithm === "step") {
    const formula = compiledMaterials.stepFormula;
    if (formula === undefined) {
      throwFormulaResultError("Step launch materials are missing");
    }
    validateFiniteLaunchFormulaValue(formula.formulaSteepness, "stepFormula.formulaSteepness");
    for (let index = 0; index < formula.terms.length; index += 1) {
      const term = formula.terms[index];
      validateFiniteLaunchFormulaValue(
        term.firstDerivativeCoefficient,
        `stepFormula.terms[${index}].firstDerivativeCoefficient`,
      );
      validateFiniteLaunchFormulaValue(term.formulaCenterX, `stepFormula.terms[${index}].formulaCenterX`);
      validateFiniteLaunchFormulaValue(
        term.secondDerivativeCoefficient,
        `stepFormula.terms[${index}].secondDerivativeCoefficient`,
      );
      validateFiniteLaunchFormulaValue(term.yCoefficient, `stepFormula.terms[${index}].yCoefficient`);
      const glitchSegment = term.glitchSegment;
      if (glitchSegment === undefined) {
        continue;
      }
      validateFiniteLaunchFormulaValue(glitchSegment.endX, `stepFormula.terms[${index}].glitchSegment.endX`);
      validateFiniteLaunchFormulaValue(glitchSegment.startX, `stepFormula.terms[${index}].glitchSegment.startX`);
      validateFiniteLaunchFormulaValue(glitchSegment.targetY, `stepFormula.terms[${index}].glitchSegment.targetY`);
      if (glitchSegment.equation === "dy") {
        validateFiniteLaunchFormulaValue(
          glitchSegment.derivative,
          `stepFormula.terms[${index}].glitchSegment.derivative`,
        );
        validateFiniteLaunchFormulaValue(glitchSegment.gateY, `stepFormula.terms[${index}].glitchSegment.gateY`);
      } else {
        validateFiniteLaunchFormulaValue(
          glitchSegment.acceleration,
          `stepFormula.terms[${index}].glitchSegment.acceleration`,
        );
        validateFiniteLaunchFormulaValue(
          glitchSegment.accelerationGateY,
          `stepFormula.terms[${index}].glitchSegment.accelerationGateY`,
        );
        validateFiniteLaunchFormulaValue(glitchSegment.braking, `stepFormula.terms[${index}].glitchSegment.braking`);
        validateFiniteLaunchFormulaValue(
          glitchSegment.brakingGateY,
          `stepFormula.terms[${index}].glitchSegment.brakingGateY`,
        );
        validateFiniteLaunchFormulaValue(
          glitchSegment.pulseEndX,
          `stepFormula.terms[${index}].glitchSegment.pulseEndX`,
        );
      }
    }
    return;
  }

  const segments = compiledMaterials.softCubicSegments;
  if (segments === undefined) {
    throwFormulaResultError("Soft cubic launch materials are missing");
  }
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    for (let coefficientIndex = 0; coefficientIndex < 4; coefficientIndex += 1) {
      validateFiniteLaunchFormulaValue(
        segment.cubicCoefficients[coefficientIndex],
        `softCubicSegments[${index}].cubicCoefficients[${coefficientIndex}]`,
      );
      validateFiniteLaunchFormulaValue(
        segment.firstCubicCoefficients[coefficientIndex],
        `softCubicSegments[${index}].firstCubicCoefficients[${coefficientIndex}]`,
      );
      validateFiniteLaunchFormulaValue(
        segment.secondCubicCoefficients[coefficientIndex],
        `softCubicSegments[${index}].secondCubicCoefficients[${coefficientIndex}]`,
      );
    }
    validateFiniteLaunchFormulaValue(
      segment.firstPowerCoefficient,
      `softCubicSegments[${index}].firstPowerCoefficient`,
    );
    validateFiniteLaunchFormulaValue(segment.halfWidth, `softCubicSegments[${index}].halfWidth`);
    validateFiniteLaunchFormulaValue(
      segment.secondPowerCoefficient,
      `softCubicSegments[${index}].secondPowerCoefficient`,
    );
    validateFiniteLaunchFormulaValue(segment.softCenterX, `softCubicSegments[${index}].softCenterX`);
    validateFiniteLaunchFormulaValue(segment.startX, `softCubicSegments[${index}].startX`);
    validateFiniteLaunchFormulaValue(segment.width, `softCubicSegments[${index}].width`);
  }
}

function validateFiniteLaunchFormulaValue(value: number, fieldName: string): void {
  if (!Number.isFinite(value)) {
    throwFormulaResultError(`Launch material ${fieldName} is not finite`);
  }
}

function getExpectedMaterialStride(algorithm: AlgorithmMode, equation: EquationMode) {
  return algorithm === "step"
    ? STEP_MATERIAL_BYTE_LENGTH
    : algorithm === "abs"
      ? equation === "ddy"
        ? ABS_PULSE_BYTE_LENGTH
        : ABS_CONNECTOR_BYTE_LENGTH
      : SOFT_CUBIC_BYTE_LENGTH;
}

function validateMaterialSourceIndex(
  sourceSegmentIndex: number,
  previousSourceSegmentIndex: number,
  segmentCount: number,
) {
  if (sourceSegmentIndex >= segmentCount || sourceSegmentIndex <= previousSourceSegmentIndex) {
    throwFormulaResultError("Formula material source segments are not strictly ordered");
  }
}

function validateGlitchDecimalPlaces(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 15) {
    throwFormulaResultError("Step glitch material precision is invalid");
  }
  return value;
}

function readTuple4(view: DataView, pointer: number): [number, number, number, number] {
  return [
    view.getFloat64(pointer, true),
    view.getFloat64(pointer + 8, true),
    view.getFloat64(pointer + 16, true),
    view.getFloat64(pointer + 24, true),
  ];
}

function uint32ArraysEqual(left: readonly number[], right: readonly number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateFormulaNumber(value: unknown, fieldName: string) {
  if (typeof value !== "number") {
    throw new GraphwarWasmAdapterError("invalid-formula-input", `${fieldName} must be a number`, "input");
  }
  return value;
}

function throwFormulaResultError(message: string): never {
  throw new GraphwarWasmAdapterError("invalid-formula-result", message, "output");
}
