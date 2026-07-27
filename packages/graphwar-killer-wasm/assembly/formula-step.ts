import { floorFormulaDecimal, quantizeFormulaCoefficient, quantizeFormulaOffsetCenter } from "./decimal";
import {
  FORMULA_ALGORITHM_STEP,
  FORMULA_EQUATION_DDY,
  FORMULA_EQUATION_DY,
  FORMULA_EQUATION_Y,
  FORMULA_FLAG_STEP_OVERFLOW_PROTECTION,
  FORMULA_INPUT_ALGORITHM_OFFSET,
  FORMULA_INPUT_BYTE_LENGTH,
  FORMULA_INPUT_DECIMAL_PLACES_OFFSET,
  FORMULA_INPUT_DISABLED_SEGMENT_POINTER_OFFSET,
  FORMULA_INPUT_EQUATION_OFFSET,
  FORMULA_INPUT_FLAGS_OFFSET,
  FORMULA_INPUT_GLITCH_SEGMENT_POINTER_OFFSET,
  FORMULA_INPUT_POINT_COUNT_OFFSET,
  FORMULA_INPUT_POINT_X_POINTER_OFFSET,
  FORMULA_INPUT_POINT_Y_POINTER_OFFSET,
  FORMULA_INPUT_SIGN_PROTECTION_COUNT_OFFSET,
  FORMULA_INPUT_SIGN_PROTECTION_POINTER_OFFSET,
  FORMULA_INPUT_STEEPNESS_OFFSET,
  FORMULA_INPUT_STEP_OVERFLOW_RANGE_COUNT_OFFSET,
  FORMULA_INPUT_STEP_OVERFLOW_RANGE_POINTER_OFFSET,
  FORMULA_INPUT_STEP_DELTA_Y_POINTER_OFFSET,
  FORMULA_INPUT_VALUE_COUNT_OFFSET,
  FORMULA_INPUT_VALUE_DY_POINTER_OFFSET,
  FORMULA_INPUT_VALUE_X_POINTER_OFFSET,
  FORMULA_INPUT_VALUE_Y_POINTER_OFFSET,
  FORMULA_MATERIAL_STEP,
  FORMULA_RESULT_AUXILIARY_VALUE_OFFSET,
  FORMULA_RESULT_BYTE_LENGTH,
  FORMULA_RESULT_FLAGS_OFFSET,
  FORMULA_RESULT_MATERIAL_COUNT_OFFSET,
  FORMULA_RESULT_MATERIAL_POINTER_OFFSET,
  FORMULA_RESULT_MATERIAL_STRIDE_OFFSET,
  FORMULA_RESULT_MATERIAL_TYPE_OFFSET,
  FORMULA_RESULT_PROTECTION_COUNT_OFFSET,
  FORMULA_RESULT_PROTECTION_POINTER_OFFSET,
  FORMULA_RESULT_VALUE_COUNT_OFFSET,
  FORMULA_RESULT_VALUE_POINTER_OFFSET,
  STEP_GLITCH_RECORD_BRAKING_GATE_Y_OFFSET,
  STEP_GLITCH_RECORD_BRAKING_OFFSET,
  STEP_GLITCH_RECORD_BYTE_LENGTH,
  STEP_GLITCH_RECORD_DECIMAL_PLACES_OFFSET,
  STEP_GLITCH_RECORD_END_X_OFFSET,
  STEP_GLITCH_RECORD_EQUATION_OFFSET,
  STEP_GLITCH_RECORD_GATE_Y_OFFSET,
  STEP_GLITCH_RECORD_PRIMARY_OFFSET,
  STEP_GLITCH_RECORD_PULSE_END_X_OFFSET,
  STEP_GLITCH_RECORD_START_X_OFFSET,
  STEP_GLITCH_RECORD_TARGET_Y_OFFSET,
  STEP_MATERIAL_BYTE_LENGTH,
  STEP_MATERIAL_CENTER_X_OFFSET,
  STEP_MATERIAL_FIRST_COEFFICIENT_OFFSET,
  STEP_MATERIAL_FLAGS_OFFSET,
  STEP_MATERIAL_FLAG_OVERFLOW_PROTECTED,
  STEP_MATERIAL_GLITCH_BRAKING_GATE_Y_OFFSET,
  STEP_MATERIAL_GLITCH_BRAKING_OFFSET,
  STEP_MATERIAL_GLITCH_DECIMAL_PLACES_OFFSET,
  STEP_MATERIAL_GLITCH_END_X_OFFSET,
  STEP_MATERIAL_GLITCH_EQUATION_OFFSET,
  STEP_MATERIAL_GLITCH_GATE_Y_OFFSET,
  STEP_MATERIAL_GLITCH_PRIMARY_OFFSET,
  STEP_MATERIAL_GLITCH_PULSE_END_X_OFFSET,
  STEP_MATERIAL_GLITCH_START_X_OFFSET,
  STEP_MATERIAL_GLITCH_TARGET_Y_OFFSET,
  STEP_MATERIAL_SECOND_COEFFICIENT_OFFSET,
  STEP_MATERIAL_SOURCE_SEGMENT_OFFSET,
  STEP_MATERIAL_Y_COEFFICIENT_OFFSET,
} from "./formula-layout";
import { requireArenaRange, reserveArena } from "./memory";
import {
  createStepFormulaResolution,
  getStepFormulaResolutionSteepness,
  resolveStepFormulaTransition,
  STEP_TRANSITION_ACTIVE_COEFFICIENT_OFFSET,
  STEP_TRANSITION_BYTE_LENGTH,
  STEP_TRANSITION_FIRST_COEFFICIENT_OFFSET,
  STEP_TRANSITION_IS_VALID_OFFSET,
  STEP_TRANSITION_SECOND_COEFFICIENT_OFFSET,
  STEP_TRANSITION_Y_COEFFICIENT_OFFSET,
} from "./formula-step-resolution";

const SIGN_ROLE_START_X: u32 = 1;
const SIGN_ROLE_END_X: u32 = 2;
const SIGN_ROLE_CENTER_X: u32 = 4;
const SIGN_ROLE_GATE_Y: u32 = 8;
const SIGN_ROLE_BRAKING_GATE_Y: u32 = 16;

@inline
function trap(): void {
  unreachable();
}

@inline
function isFiniteValue(value: f64): bool {
  return value == value && value != f64.POSITIVE_INFINITY && value != f64.NEGATIVE_INFINITY;
}

@inline
function checkedByteLength(count: u32, stride: u32): u32 {
  const byteLength = <u64>count * stride;
  if (byteLength > 0xffff_ffff) {
    trap();
  }
  return <u32>byteLength;
}

@inline
function requireOptionalRange(pointer: u32, byteLength: u32, alignment: u32): void {
  if (pointer == 0) {
    return;
  }
  requireArenaRange(pointer, byteLength, alignment);
}

@inline
function evaluateStepExp(argument: f64): f64 {
  return NativeMath.pow(NativeMath.E, argument);
}

@inline
function evaluateDirectFirstDerivativeBody(t: f64): f64 {
  const exp = evaluateStepExp(-t);
  const denominator = 1 + exp;
  return exp / NativeMath.pow(denominator, 2);
}

@inline
function evaluateStableFirstDerivativeBody(t: f64): f64 {
  const q = evaluateStepExp(-NativeMath.abs(t));
  const denominator = 1 + q;
  return q / NativeMath.pow(denominator, 2);
}

@inline
function evaluateDirectSecondDerivativeBody(t: f64): f64 {
  const exp = evaluateStepExp(-t);
  const denominator = 1 + exp;
  return exp * ((exp - 1) / NativeMath.pow(denominator, 3));
}

@inline
function evaluateStableSecondDerivativeBody(t: f64): f64 {
  const q = evaluateStepExp(-NativeMath.abs(t));
  const denominator = 1 + q;
  return q * ((1 - q) / NativeMath.pow(denominator, 3));
}

@inline
function observeSignRole(observedPointer: u32, sourceSegmentIndex: u32, role: u32): void {
  const rolePointer = observedPointer + sourceSegmentIndex * sizeof<u32>();
  store<u32>(rolePointer, load<u32>(rolePointer) | role);
}

@inline
function evaluateSignRatio(
  value: f64,
  sourceSegmentIndex: u32,
  role: u32,
  protectionPointer: u32,
  observedPointer: u32,
): f64 {
  if (value == 0) {
    observeSignRole(observedPointer, sourceSegmentIndex, role);
  }
  const protection = protectionPointer == 0 ? 0 : load<u32>(protectionPointer + sourceSegmentIndex * sizeof<u32>());
  const epsilon = (protection & role) == 0 ? 0 : f64.EPSILON;
  return value / (NativeMath.abs(value) + epsilon);
}

@inline
function getMaterialPointer(materialPointer: u32, index: u32): u32 {
  return materialPointer + index * STEP_MATERIAL_BYTE_LENGTH;
}

function evaluateGlitchFirstDerivative(
  x: f64,
  y: f64,
  material: u32,
  protectionPointer: u32,
  observedPointer: u32,
): f64 {
  const derivative = load<f64>(material + STEP_MATERIAL_GLITCH_PRIMARY_OFFSET);
  const direction: f64 = derivative < 0 ? -1 : 1;
  const sourceSegmentIndex = load<u32>(material + STEP_MATERIAL_SOURCE_SEGMENT_OFFSET);
  const xGate =
    1 +
    evaluateSignRatio(
      x - load<f64>(material + STEP_MATERIAL_GLITCH_START_X_OFFSET),
      sourceSegmentIndex,
      SIGN_ROLE_START_X,
      protectionPointer,
      observedPointer,
    );
  const xLimitGate =
    1 -
    evaluateSignRatio(
      x - load<f64>(material + STEP_MATERIAL_GLITCH_END_X_OFFSET),
      sourceSegmentIndex,
      SIGN_ROLE_END_X,
      protectionPointer,
      observedPointer,
    );
  const gateY = load<f64>(material + STEP_MATERIAL_GLITCH_GATE_Y_OFFSET);
  const yGate =
    1 +
    evaluateSignRatio(
      direction * (gateY - y),
      sourceSegmentIndex,
      SIGN_ROLE_GATE_Y,
      protectionPointer,
      observedPointer,
    );
  return (derivative / 8) * (xGate * (xLimitGate * yGate));
}

function foldGlitchSecondDerivative(
  x: f64,
  y: f64,
  material: u32,
  protectionPointer: u32,
  observedPointer: u32,
  hasTail: bool,
  tail: f64,
): f64 {
  const acceleration = load<f64>(material + STEP_MATERIAL_GLITCH_PRIMARY_OFFSET);
  const braking = load<f64>(material + STEP_MATERIAL_GLITCH_BRAKING_OFFSET);
  const direction: f64 = acceleration < 0 ? -1 : 1;
  const sourceSegmentIndex = load<u32>(material + STEP_MATERIAL_SOURCE_SEGMENT_OFFSET);
  const xGate =
    1 +
    evaluateSignRatio(
      x - load<f64>(material + STEP_MATERIAL_GLITCH_START_X_OFFSET),
      sourceSegmentIndex,
      SIGN_ROLE_START_X,
      protectionPointer,
      observedPointer,
    );
  const xLimitGate =
    1 -
    evaluateSignRatio(
      x - load<f64>(material + STEP_MATERIAL_GLITCH_PULSE_END_X_OFFSET),
      sourceSegmentIndex,
      SIGN_ROLE_END_X,
      protectionPointer,
      observedPointer,
    );
  const accelerationCoefficient = acceleration / 8;
  const brakingCoefficient = braking / 8;
  if (accelerationCoefficient == 0) {
    const brakingGate =
      1 +
      evaluateSignRatio(
        direction * (y - load<f64>(material + STEP_MATERIAL_GLITCH_BRAKING_GATE_Y_OFFSET)),
        sourceSegmentIndex,
        SIGN_ROLE_BRAKING_GATE_Y,
        protectionPointer,
        observedPointer,
      );
    const contribution = brakingCoefficient * (xGate * (xLimitGate * brakingGate));
    return hasTail ? contribution + tail : contribution;
  }

  const accelerationGate =
    1 +
    evaluateSignRatio(
      direction * (load<f64>(material + STEP_MATERIAL_GLITCH_GATE_Y_OFFSET) - y),
      sourceSegmentIndex,
      SIGN_ROLE_GATE_Y,
      protectionPointer,
      observedPointer,
    );
  const accelerationContribution = accelerationCoefficient * (xGate * (xLimitGate * accelerationGate));
  if (brakingCoefficient == 0) {
    return hasTail ? accelerationContribution + tail : accelerationContribution;
  }

  const brakingGate =
    1 +
    evaluateSignRatio(
      direction * (y - load<f64>(material + STEP_MATERIAL_GLITCH_BRAKING_GATE_Y_OFFSET)),
      sourceSegmentIndex,
      SIGN_ROLE_BRAKING_GATE_Y,
      protectionPointer,
      observedPointer,
    );
  const brakingContribution = brakingCoefficient * (xGate * (xLimitGate * brakingGate));
  const foldedTail = hasTail ? brakingContribution + tail : brakingContribution;
  return accelerationContribution + foldedTail;
}

export function evaluateStepMaterialValue(
  equation: i32,
  x: f64,
  y: f64,
  materialPointer: u32,
  materialCount: u32,
  steepness: f64,
  baseY: f64,
  protectionPointer: u32,
  observedPointer: u32,
  shouldNormalizeSecondDerivativeZero: bool,
): f64 {
  if (equation == FORMULA_EQUATION_Y) {
    let result = 0.0;
    let index = materialCount;
    while (index > 0) {
      index -= 1;
      const material = getMaterialPointer(materialPointer, index);
      if (load<i32>(material + STEP_MATERIAL_GLITCH_EQUATION_OFFSET) != 0) {
        continue;
      }
      const coefficient = load<f64>(material + STEP_MATERIAL_Y_COEFFICIENT_OFFSET);
      if (coefficient == 0) {
        continue;
      }
      const centerX = load<f64>(material + STEP_MATERIAL_CENTER_X_OFFSET);
      const t = steepness * (x - centerX);
      result = coefficient / (1 + evaluateStepExp(-t)) + result;
    }
    return baseY + result;
  }

  if (equation == FORMULA_EQUATION_DY) {
    let result = 0.0;
    let index = materialCount;
    while (index > 0) {
      index -= 1;
      const material = getMaterialPointer(materialPointer, index);
      const glitchEquation = load<i32>(material + STEP_MATERIAL_GLITCH_EQUATION_OFFSET);
      if (glitchEquation != 0) {
        if (glitchEquation == FORMULA_EQUATION_DY) {
          const derivative = load<f64>(material + STEP_MATERIAL_GLITCH_PRIMARY_OFFSET);
          if (derivative != 0) {
            result = evaluateGlitchFirstDerivative(x, y, material, protectionPointer, observedPointer) + result;
          }
        }
        continue;
      }
      const coefficient = load<f64>(material + STEP_MATERIAL_FIRST_COEFFICIENT_OFFSET);
      if (coefficient == 0) {
        continue;
      }
      const centerX = load<f64>(material + STEP_MATERIAL_CENTER_X_OFFSET);
      const t = steepness * (x - centerX);
      result =
        coefficient *
          ((load<u32>(material + STEP_MATERIAL_FLAGS_OFFSET) & STEP_MATERIAL_FLAG_OVERFLOW_PROTECTED) != 0
            ? evaluateStableFirstDerivativeBody(t)
            : evaluateDirectFirstDerivativeBody(t)) +
        result;
    }
    return result;
  }

  let hasResult = false;
  let result = 0.0;
  let index = materialCount;
  while (index > 0) {
    index -= 1;
    const material = getMaterialPointer(materialPointer, index);
    const glitchEquation = load<i32>(material + STEP_MATERIAL_GLITCH_EQUATION_OFFSET);
    if (glitchEquation != 0) {
      if (glitchEquation == FORMULA_EQUATION_DDY) {
        const acceleration = load<f64>(material + STEP_MATERIAL_GLITCH_PRIMARY_OFFSET);
        const braking = load<f64>(material + STEP_MATERIAL_GLITCH_BRAKING_OFFSET);
        if (acceleration != 0 || braking != 0) {
          result = foldGlitchSecondDerivative(
            x,
            y,
            material,
            protectionPointer,
            observedPointer,
            hasResult,
            result,
          );
          hasResult = true;
        }
      }
      continue;
    }
    const coefficient = load<f64>(material + STEP_MATERIAL_SECOND_COEFFICIENT_OFFSET);
    if (coefficient == 0) {
      continue;
    }
    const centerX = load<f64>(material + STEP_MATERIAL_CENTER_X_OFFSET);
    const t = steepness * (x - centerX);
    let contribution: f64;
    if ((load<u32>(material + STEP_MATERIAL_FLAGS_OFFSET) & STEP_MATERIAL_FLAG_OVERFLOW_PROTECTED) != 0) {
      const sourceSegmentIndex = load<u32>(material + STEP_MATERIAL_SOURCE_SEGMENT_OFFSET);
      const sign = evaluateSignRatio(
        t,
        sourceSegmentIndex,
        SIGN_ROLE_CENTER_X,
        protectionPointer,
        observedPointer,
      );
      contribution = -coefficient * (sign * evaluateStableSecondDerivativeBody(t));
    } else {
      contribution = coefficient * evaluateDirectSecondDerivativeBody(t);
    }
    result = hasResult ? contribution + result : contribution;
    hasResult = true;
  }
  if (!hasResult) {
    return 0;
  }
  return shouldNormalizeSecondDerivativeZero && result == 0 ? 0 : result;
}

/** Launch refinement replaces its point array, so its canonical range must follow the current first formula point. */
export function runStepLaunchBatch(inputPointer: u32): u32 {
  const overflowRangePointer = load<u32>(inputPointer + FORMULA_INPUT_STEP_OVERFLOW_RANGE_POINTER_OFFSET);
  const overflowRangeCount = load<u32>(inputPointer + FORMULA_INPUT_STEP_OVERFLOW_RANGE_COUNT_OFFSET);
  if (overflowRangePointer == 0 || overflowRangeCount != 2) {
    trap();
  }
  requireArenaRange(overflowRangePointer, 2 * sizeof<f64>(), sizeof<f64>());
  const pointXPointer = load<u32>(inputPointer + FORMULA_INPUT_POINT_X_POINTER_OFFSET);
  requireArenaRange(pointXPointer, sizeof<f64>(), sizeof<f64>());
  store<f64>(overflowRangePointer, load<f64>(pointXPointer));
  return runStepBatch(inputPointer);
}

/** Builds canonical Step materials and evaluates a whole SoA batch without returning mutable views. */
export function runStepBatch(inputPointer: u32): u32 {
  requireArenaRange(inputPointer, FORMULA_INPUT_BYTE_LENGTH, sizeof<u64>());
  if (load<i32>(inputPointer + FORMULA_INPUT_ALGORITHM_OFFSET) != FORMULA_ALGORITHM_STEP) {
    trap();
  }
  const equation = load<i32>(inputPointer + FORMULA_INPUT_EQUATION_OFFSET);
  const decimalPlaces = load<i32>(inputPointer + FORMULA_INPUT_DECIMAL_PLACES_OFFSET);
  const flags = load<u32>(inputPointer + FORMULA_INPUT_FLAGS_OFFSET);
  const pointCount = load<u32>(inputPointer + FORMULA_INPUT_POINT_COUNT_OFFSET);
  const pointXPointer = load<u32>(inputPointer + FORMULA_INPUT_POINT_X_POINTER_OFFSET);
  const pointYPointer = load<u32>(inputPointer + FORMULA_INPUT_POINT_Y_POINTER_OFFSET);
  const protectionPointer = load<u32>(inputPointer + FORMULA_INPUT_SIGN_PROTECTION_POINTER_OFFSET);
  const protectionCount = load<u32>(inputPointer + FORMULA_INPUT_SIGN_PROTECTION_COUNT_OFFSET);
  const valueCount = load<u32>(inputPointer + FORMULA_INPUT_VALUE_COUNT_OFFSET);
  const valueXPointer = load<u32>(inputPointer + FORMULA_INPUT_VALUE_X_POINTER_OFFSET);
  const valueYPointer = load<u32>(inputPointer + FORMULA_INPUT_VALUE_Y_POINTER_OFFSET);
  const valueDyPointer = load<u32>(inputPointer + FORMULA_INPUT_VALUE_DY_POINTER_OFFSET);
  const disabledPointer = load<u32>(inputPointer + FORMULA_INPUT_DISABLED_SEGMENT_POINTER_OFFSET);
  const deltaYPointer = load<u32>(inputPointer + FORMULA_INPUT_STEP_DELTA_Y_POINTER_OFFSET);
  const glitchPointer = load<u32>(inputPointer + FORMULA_INPUT_GLITCH_SEGMENT_POINTER_OFFSET);
  const overflowRangePointer = load<u32>(inputPointer + FORMULA_INPUT_STEP_OVERFLOW_RANGE_POINTER_OFFSET);
  const overflowRangeCount = load<u32>(inputPointer + FORMULA_INPUT_STEP_OVERFLOW_RANGE_COUNT_OFFSET);
  const rawSteepness = load<f64>(inputPointer + FORMULA_INPUT_STEEPNESS_OFFSET);
  if (
    (equation != FORMULA_EQUATION_Y && equation != FORMULA_EQUATION_DY && equation != FORMULA_EQUATION_DDY) ||
    decimalPlaces < 0 ||
    decimalPlaces > 15 ||
    pointCount < 2 ||
    !isFiniteValue(rawSteepness) ||
    (flags & ~FORMULA_FLAG_STEP_OVERFLOW_PROTECTION) != 0
  ) {
    trap();
  }

  const segmentCount = pointCount - 1;
  if (overflowRangePointer == 0 ? overflowRangeCount != 0 : overflowRangeCount != 2) {
    trap();
  }
  if (protectionPointer == 0 ? protectionCount != 0 : protectionCount != segmentCount) {
    trap();
  }
  const pointByteLength = checkedByteLength(pointCount, sizeof<f64>());
  const segmentF64ByteLength = checkedByteLength(segmentCount, sizeof<f64>());
  const valueByteLength = checkedByteLength(valueCount, sizeof<f64>());
  requireArenaRange(pointXPointer, pointByteLength, sizeof<f64>());
  requireArenaRange(pointYPointer, pointByteLength, sizeof<f64>());
  requireOptionalRange(protectionPointer, checkedByteLength(protectionCount, sizeof<u32>()), sizeof<u32>());
  requireOptionalRange(disabledPointer, segmentCount, 1);
  requireOptionalRange(deltaYPointer, segmentF64ByteLength, sizeof<f64>());
  requireOptionalRange(glitchPointer, checkedByteLength(segmentCount, STEP_GLITCH_RECORD_BYTE_LENGTH), sizeof<f64>());
  requireOptionalRange(overflowRangePointer, checkedByteLength(overflowRangeCount, sizeof<f64>()), sizeof<f64>());
  requireArenaRange(valueXPointer, valueByteLength, sizeof<f64>());
  requireArenaRange(valueYPointer, valueByteLength, sizeof<f64>());
  requireArenaRange(valueDyPointer, valueByteLength, sizeof<f64>());

  let pointIndex: u32 = 0;
  while (pointIndex < pointCount) {
    if (
      !isFiniteValue(load<f64>(pointXPointer + pointIndex * sizeof<f64>())) ||
      !isFiniteValue(load<f64>(pointYPointer + pointIndex * sizeof<f64>()))
    ) {
      trap();
    }
    pointIndex += 1;
  }
  let overflowRangeMinX = 0.0;
  let overflowRangeMaxX = 0.0;
  if (overflowRangePointer != 0) {
    overflowRangeMinX = load<f64>(overflowRangePointer);
    overflowRangeMaxX = load<f64>(overflowRangePointer + sizeof<f64>());
    if (!isFiniteValue(overflowRangeMinX) || !isFiniteValue(overflowRangeMaxX)) {
      trap();
    }
  }

  const resultPointer = reserveArena(FORMULA_RESULT_BYTE_LENGTH, sizeof<f64>());
  const materialPointer = reserveArena(checkedByteLength(segmentCount, STEP_MATERIAL_BYTE_LENGTH), sizeof<f64>());
  const valuePointer = valueCount == 0 ? 0 : reserveArena(valueByteLength, sizeof<f64>());
  const observedPointer = reserveArena(checkedByteLength(segmentCount, sizeof<u32>()), sizeof<u32>());
  memory.fill(observedPointer, 0, checkedByteLength(segmentCount, sizeof<u32>()));

  const baseY = load<f64>(pointYPointer);
  const resolutionPointer = createStepFormulaResolution(rawSteepness, decimalPlaces, equation, baseY, segmentCount);
  const formulaSteepness = getStepFormulaResolutionSteepness(resolutionPointer);
  const transitionPointer = reserveArena(STEP_TRANSITION_BYTE_LENGTH, sizeof<f64>());
  let materialCount = 0;
  let shouldNormalizeSecondDerivativeZero = false;
  let hasSecondDerivativeLeadingTerm = false;
  let segmentIndex: u32 = 0;
  while (segmentIndex < segmentCount) {
    const targetY = load<f64>(pointYPointer + (segmentIndex + 1) * sizeof<f64>());
    let deltaYOverride = 0.0;
    let hasDeltaYOverride = false;
    if (deltaYPointer != 0) {
      const deltaY = load<f64>(deltaYPointer + segmentIndex * sizeof<f64>());
      if (deltaY == deltaY) {
        if (!isFiniteValue(deltaY)) {
          trap();
        }
        deltaYOverride = deltaY;
        hasDeltaYOverride = true;
      }
    }
    resolveStepFormulaTransition(
      resolutionPointer,
      targetY,
      deltaYOverride,
      hasDeltaYOverride,
      decimalPlaces,
      equation,
      transitionPointer,
    );
    const activeCoefficient = load<f64>(transitionPointer + STEP_TRANSITION_ACTIVE_COEFFICIENT_OFFSET);
    const isValid = load<u32>(transitionPointer + STEP_TRANSITION_IS_VALID_OFFSET) != 0;
    const yCoefficient = load<f64>(transitionPointer + STEP_TRANSITION_Y_COEFFICIENT_OFFSET);
    const firstCoefficient = load<f64>(transitionPointer + STEP_TRANSITION_FIRST_COEFFICIENT_OFFSET);
    const secondCoefficient = load<f64>(transitionPointer + STEP_TRANSITION_SECOND_COEFFICIENT_OFFSET);

    let glitchEquation = 0;
    let glitchDecimalPlaces = decimalPlaces;
    let glitchStartX = 0.0;
    let glitchEndX = 0.0;
    let glitchTargetY = 0.0;
    let glitchPrimary = 0.0;
    let glitchGateY = 0.0;
    let glitchBraking = 0.0;
    let glitchBrakingGateY = 0.0;
    let glitchPulseEndX = 0.0;
    if (glitchPointer != 0) {
      const glitch = glitchPointer + segmentIndex * STEP_GLITCH_RECORD_BYTE_LENGTH;
      glitchEquation = load<i32>(glitch + STEP_GLITCH_RECORD_EQUATION_OFFSET);
      if (glitchEquation != 0) {
        if (glitchEquation != FORMULA_EQUATION_DY && glitchEquation != FORMULA_EQUATION_DDY) {
          trap();
        }
        const requestedDecimalPlaces = load<i32>(glitch + STEP_GLITCH_RECORD_DECIMAL_PLACES_OFFSET);
        glitchDecimalPlaces = requestedDecimalPlaces < 0 ? (decimalPlaces < 1 ? 1 : decimalPlaces) : requestedDecimalPlaces;
        if (glitchDecimalPlaces < 0 || glitchDecimalPlaces > 15) {
          trap();
        }
        glitchStartX = load<f64>(glitch + STEP_GLITCH_RECORD_START_X_OFFSET);
        glitchEndX = load<f64>(glitch + STEP_GLITCH_RECORD_END_X_OFFSET);
        glitchTargetY = quantizeFormulaOffsetCenter(
          load<f64>(glitch + STEP_GLITCH_RECORD_TARGET_Y_OFFSET),
          glitchDecimalPlaces,
        );
        glitchPrimary =
          8 *
          quantizeFormulaCoefficient(
            load<f64>(glitch + STEP_GLITCH_RECORD_PRIMARY_OFFSET) / 8,
            glitchDecimalPlaces,
          );
        glitchGateY = quantizeFormulaOffsetCenter(
          load<f64>(glitch + STEP_GLITCH_RECORD_GATE_Y_OFFSET),
          glitchDecimalPlaces,
        );
        if (glitchEquation == FORMULA_EQUATION_DDY) {
          glitchBraking =
            8 *
            quantizeFormulaCoefficient(
              load<f64>(glitch + STEP_GLITCH_RECORD_BRAKING_OFFSET) / 8,
              glitchDecimalPlaces,
            );
          glitchBrakingGateY = quantizeFormulaOffsetCenter(
            load<f64>(glitch + STEP_GLITCH_RECORD_BRAKING_GATE_Y_OFFSET),
            glitchDecimalPlaces,
          );
          glitchPulseEndX = load<f64>(glitch + STEP_GLITCH_RECORD_PULSE_END_X_OFFSET);
        }
      }
    }

    const isSegmentEnabled = disabledPointer == 0 || load<u8>(disabledPointer + segmentIndex) == 0;
    if (isSegmentEnabled && (glitchEquation != 0 || yCoefficient != 0 || firstCoefficient != 0 || secondCoefficient != 0)) {
      const material = getMaterialPointer(materialPointer, materialCount);
      const centerX = floorFormulaDecimal(load<f64>(pointXPointer + (segmentIndex + 1) * sizeof<f64>()), decimalPlaces);
      const isOverflowProtected =
        (flags & FORMULA_FLAG_STEP_OVERFLOW_PROTECTION) != 0 &&
        (overflowRangePointer == 0 ||
          -formulaSteepness * (NativeMath.min(overflowRangeMinX, overflowRangeMaxX) - centerX) >
            NativeMath.log(f64.MAX_VALUE));
      store<f64>(material + STEP_MATERIAL_CENTER_X_OFFSET, centerX);
      store<f64>(material + STEP_MATERIAL_FIRST_COEFFICIENT_OFFSET, firstCoefficient);
      store<f64>(material + STEP_MATERIAL_SECOND_COEFFICIENT_OFFSET, secondCoefficient);
      store<f64>(material + STEP_MATERIAL_Y_COEFFICIENT_OFFSET, yCoefficient);
      store<u32>(material + STEP_MATERIAL_SOURCE_SEGMENT_OFFSET, segmentIndex);
      store<u32>(
        material + STEP_MATERIAL_FLAGS_OFFSET,
        isOverflowProtected ? STEP_MATERIAL_FLAG_OVERFLOW_PROTECTED : 0,
      );
      store<i32>(material + STEP_MATERIAL_GLITCH_EQUATION_OFFSET, glitchEquation);
      store<i32>(material + STEP_MATERIAL_GLITCH_DECIMAL_PLACES_OFFSET, glitchDecimalPlaces);
      store<f64>(material + STEP_MATERIAL_GLITCH_START_X_OFFSET, glitchStartX);
      store<f64>(material + STEP_MATERIAL_GLITCH_END_X_OFFSET, glitchEndX);
      store<f64>(material + STEP_MATERIAL_GLITCH_TARGET_Y_OFFSET, glitchTargetY);
      store<f64>(material + STEP_MATERIAL_GLITCH_PRIMARY_OFFSET, glitchPrimary);
      store<f64>(material + STEP_MATERIAL_GLITCH_GATE_Y_OFFSET, glitchGateY);
      store<f64>(material + STEP_MATERIAL_GLITCH_BRAKING_OFFSET, glitchBraking);
      store<f64>(material + STEP_MATERIAL_GLITCH_BRAKING_GATE_Y_OFFSET, glitchBrakingGateY);
      store<f64>(material + STEP_MATERIAL_GLITCH_PULSE_END_X_OFFSET, glitchPulseEndX);
      if (!hasSecondDerivativeLeadingTerm) {
        if (glitchEquation == FORMULA_EQUATION_DDY) {
          if (glitchPrimary != 0) {
            shouldNormalizeSecondDerivativeZero = glitchPrimary < 0;
            hasSecondDerivativeLeadingTerm = true;
          } else if (glitchBraking != 0) {
            shouldNormalizeSecondDerivativeZero = glitchBraking < 0;
            hasSecondDerivativeLeadingTerm = true;
          }
        } else if (glitchEquation == 0 && secondCoefficient != 0) {
          shouldNormalizeSecondDerivativeZero = isOverflowProtected ? -secondCoefficient < 0 : secondCoefficient < 0;
          hasSecondDerivativeLeadingTerm = true;
        }
      }
      materialCount += 1;
    }
    segmentIndex += 1;
  }

  let valueIndex: u32 = 0;
  while (valueIndex < valueCount) {
    const value = evaluateStepMaterialValue(
      equation,
      load<f64>(valueXPointer + valueIndex * sizeof<f64>()),
      load<f64>(valueYPointer + valueIndex * sizeof<f64>()),
      materialPointer,
      materialCount,
      formulaSteepness,
      baseY,
      protectionPointer,
      observedPointer,
      shouldNormalizeSecondDerivativeZero,
    );
    store<f64>(valuePointer + valueIndex * sizeof<f64>(), value);
    valueIndex += 1;
  }

  store<i32>(resultPointer + FORMULA_RESULT_MATERIAL_TYPE_OFFSET, FORMULA_MATERIAL_STEP);
  store<u32>(resultPointer + FORMULA_RESULT_MATERIAL_POINTER_OFFSET, materialCount == 0 ? 0 : materialPointer);
  store<u32>(resultPointer + FORMULA_RESULT_MATERIAL_COUNT_OFFSET, materialCount);
  store<u32>(resultPointer + FORMULA_RESULT_MATERIAL_STRIDE_OFFSET, STEP_MATERIAL_BYTE_LENGTH);
  store<u32>(resultPointer + FORMULA_RESULT_VALUE_POINTER_OFFSET, valuePointer);
  store<u32>(resultPointer + FORMULA_RESULT_VALUE_COUNT_OFFSET, valueCount);
  store<f64>(resultPointer + FORMULA_RESULT_AUXILIARY_VALUE_OFFSET, formulaSteepness);
  store<u32>(resultPointer + FORMULA_RESULT_PROTECTION_POINTER_OFFSET, observedPointer);
  store<u32>(resultPointer + FORMULA_RESULT_PROTECTION_COUNT_OFFSET, segmentCount);
  store<u32>(resultPointer + FORMULA_RESULT_FLAGS_OFFSET, shouldNormalizeSecondDerivativeZero ? 1 : 0);
  return resultPointer;
}
