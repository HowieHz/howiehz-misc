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
import { graphwarToolDefaults } from "../tool/defaults";
import { createGraphPoint, type AlgorithmMode, type EquationMode, type GraphBounds, type GraphPoint } from "../types";
import {
  GraphwarWasmAdapterError,
  copyGraphwarWasmFloat64Values,
  copyGraphwarWasmUint32Values,
  validateGraphwarWasmMemoryRange,
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
  validateGraphwarWasmSecondOrderLaunchAngle,
  type GraphwarWasmFormulaInputDescriptor,
} from "./task-adapter";

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
    for (let index = 0; index < result.values.length; index += 1) {
      if (result.values[index] === Number.POSITIVE_INFINITY || result.values[index] === Number.NEGATIVE_INFINITY) {
        throwFormulaResultError(`Expression result values[${index}] was not normalized`);
      }
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

function withFormulaArenaScope<TResult>(runtime: GraphwarWasmKernelRuntime, run: () => TResult): TResult {
  const mark = runtime.markArena();
  try {
    return run();
  } finally {
    runtime.resetArena(mark);
  }
}

function packFormulaValues(runtime: GraphwarWasmKernelRuntime, values: readonly GraphwarWasmFormulaValue[]) {
  if (!Array.isArray(values)) {
    throw new GraphwarWasmAdapterError("invalid-formula-input", "Formula values must be an array");
  }
  const length = validateGraphwarWasmU32(values.length, "values.length");
  const x = new Float64Array(length);
  const y = new Float64Array(length);
  const dy = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    const value = values[index];
    if (typeof value !== "object" || value === null) {
      throw new GraphwarWasmAdapterError("invalid-formula-input", `values[${index}] must be an object`);
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
    throw new GraphwarWasmAdapterError("invalid-formula-input", "Formula descriptor must be an object");
  }
  if (!isGraphwarFormulaBounds(descriptor.bounds)) {
    throw new GraphwarWasmAdapterError("invalid-formula-input", "Formula bounds are invalid");
  }
  if (!isGraphwarTrajectoryFormulaSettings(descriptor.settings)) {
    throw new GraphwarWasmAdapterError("invalid-formula-input", "Formula settings are invalid");
  }
  if (!Array.isArray(descriptor.points) || descriptor.points.length < 2) {
    throw new GraphwarWasmAdapterError("invalid-formula-input", "Formula descriptor requires at least two points");
  }
  if (!isGraphwarTrajectoryPoint(descriptor.soldierCenter)) {
    throw new GraphwarWasmAdapterError("invalid-formula-input", "Formula soldier center is invalid");
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
    throw new GraphwarWasmAdapterError("invalid-formula-input", "Formula evaluation options must be an object");
  }
  const { algorithm, decimalPlaces, equation, isStepOverflowProtectionEnabled } = descriptor.settings;
  const segmentCount = descriptor.points.length - 1;
  if (formulaEvaluation.equation !== undefined && formulaEvaluation.equation !== equation) {
    throw new GraphwarWasmAdapterError("invalid-formula-input", "Formula evaluation equation does not match settings");
  }
  if (
    formulaEvaluation.formulaDecimalPlaces !== undefined &&
    formulaEvaluation.formulaDecimalPlaces !== decimalPlaces
  ) {
    throw new GraphwarWasmAdapterError("invalid-formula-input", "Formula evaluation precision does not match settings");
  }
  if (
    formulaEvaluation.isStepOverflowProtectionEnabled !== undefined &&
    formulaEvaluation.isStepOverflowProtectionEnabled !== isStepOverflowProtectionEnabled
  ) {
    throw new GraphwarWasmAdapterError("invalid-formula-input", "Formula overflow protection does not match settings");
  }
  if (formulaEvaluation.onZeroSignArgument !== undefined) {
    throw new GraphwarWasmAdapterError("invalid-formula-input", "Formula callbacks cannot cross the WASM boundary");
  }
  const stepOverflowProtectionRange = formulaEvaluation.stepOverflowProtectionRange;
  if (stepOverflowProtectionRange !== undefined) {
    if (
      algorithm !== "step" ||
      !isRecord(stepOverflowProtectionRange) ||
      !isFiniteFormulaBound(stepOverflowProtectionRange.minX) ||
      !isFiniteFormulaBound(stepOverflowProtectionRange.maxX)
    ) {
      throw new GraphwarWasmAdapterError("invalid-formula-input", "Formula Step overflow range is invalid");
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
      validateGraphwarWasmProtectionBits(value, ALLOWED_SIGN_PROTECTION_BITS);
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
    throw new GraphwarWasmAdapterError("invalid-formula-input", `${fieldName} is invalid`);
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
    throw new GraphwarWasmAdapterError("invalid-formula-input", `${fieldName} must be a number`);
  }
  return value;
}

function throwFormulaResultError(message: string): never {
  throw new GraphwarWasmAdapterError("invalid-formula-result", message);
}
