import { floorFormulaDecimal, quantizeFormulaCoefficient, roundFormulaDecimal } from "./decimal";
import { getGraphwarFuncMinXStepDistance, requireGraphwarGameConstantsInitialized } from "./game-constants";
import {
  ABS_CONNECTOR_BYTE_LENGTH,
  ABS_CONNECTOR_COEFFICIENT_OFFSET,
  ABS_CONNECTOR_END_X_OFFSET,
  ABS_CONNECTOR_SOURCE_SEGMENT_OFFSET,
  ABS_CONNECTOR_START_X_OFFSET,
  ABS_CONNECTOR_WIDTH_OFFSET,
  ABS_PULSE_BYTE_LENGTH,
  ABS_PULSE_CENTER_X_OFFSET,
  ABS_PULSE_COEFFICIENT_OFFSET,
  FORMULA_ALGORITHM_ABS,
  FORMULA_ALGORITHM_AKIMA,
  FORMULA_ALGORITHM_PCHIP,
  FORMULA_EQUATION_DDY,
  FORMULA_EQUATION_DY,
  FORMULA_EQUATION_Y,
  FORMULA_INPUT_ABS_PULSE_CENTER_X_POINTER_OFFSET,
  FORMULA_INPUT_ABS_PULSE_DELTA_SLOPE_POINTER_OFFSET,
  FORMULA_INPUT_ALGORITHM_OFFSET,
  FORMULA_INPUT_BYTE_LENGTH,
  FORMULA_INPUT_DECIMAL_PLACES_OFFSET,
  FORMULA_INPUT_DISABLED_SEGMENT_POINTER_OFFSET,
  FORMULA_INPUT_EQUATION_OFFSET,
  FORMULA_INPUT_FLAGS_OFFSET,
  FORMULA_INPUT_POINT_COUNT_OFFSET,
  FORMULA_INPUT_POINT_X_POINTER_OFFSET,
  FORMULA_INPUT_POINT_Y_POINTER_OFFSET,
  FORMULA_INPUT_SEGMENT_START_X_POINTER_OFFSET,
  FORMULA_INPUT_SEGMENT_START_Y_POINTER_OFFSET,
  FORMULA_INPUT_SIGN_PROTECTION_COUNT_OFFSET,
  FORMULA_INPUT_SIGN_PROTECTION_POINTER_OFFSET,
  FORMULA_INPUT_STEEPNESS_OFFSET,
  FORMULA_INPUT_STEP_OVERFLOW_RANGE_COUNT_OFFSET,
  FORMULA_INPUT_STEP_OVERFLOW_RANGE_POINTER_OFFSET,
  FORMULA_INPUT_VALUE_COUNT_OFFSET,
  FORMULA_INPUT_VALUE_DY_POINTER_OFFSET,
  FORMULA_INPUT_VALUE_X_POINTER_OFFSET,
  FORMULA_INPUT_VALUE_Y_POINTER_OFFSET,
  FORMULA_MATERIAL_ABS_CONNECTOR,
  FORMULA_MATERIAL_ABS_SECOND_DERIVATIVE,
  FORMULA_MATERIAL_SOFT_CUBIC,
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
  SOFT_CENTER_X_OFFSET,
  SOFT_CUBIC_BYTE_LENGTH,
  SOFT_CUBIC_COEFFICIENT_OFFSET,
  SOFT_FIRST_CUBIC_COEFFICIENT_OFFSET,
  SOFT_FIRST_POWER_COEFFICIENT_OFFSET,
  SOFT_HALF_WIDTH_OFFSET,
  SOFT_SECOND_CUBIC_COEFFICIENT_OFFSET,
  SOFT_SECOND_POWER_COEFFICIENT_OFFSET,
  SOFT_START_X_OFFSET,
  SOFT_WIDTH_OFFSET,
} from "./formula-layout";
import { markArena, requireArenaRange, reserveArena, resetArena } from "./memory";

const SOFT_POWER: i32 = 16;
const SIGN_ROLE_START_X: u32 = 1;
const SIGN_ROLE_END_X: u32 = 2;

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
  if (pointer != 0) {
    requireArenaRange(pointer, byteLength, alignment);
  }
}

@inline
function loadPointX(pointer: u32, index: u32): f64 {
  return load<f64>(pointer + index * sizeof<f64>());
}

@inline
function loadPointY(pointer: u32, index: u32): f64 {
  return load<f64>(pointer + index * sizeof<f64>());
}

@inline
function evaluateStepExp(argument: f64): f64 {
  return NativeMath.pow(NativeMath.E, argument);
}

@inline
function evaluateStableFirstDerivativeBody(t: f64): f64 {
  const q = evaluateStepExp(-NativeMath.abs(t));
  const denominator = 1 + q;
  return q / NativeMath.pow(denominator, 2);
}

@inline
function observeSignRole(observedPointer: u32, sourceSegmentIndex: u32, role: u32): void {
  const pointer = observedPointer + sourceSegmentIndex * sizeof<u32>();
  store<u32>(pointer, load<u32>(pointer) | role);
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
function getRecordPointer(pointer: u32, index: u32, stride: u32): u32 {
  return pointer + index * stride;
}

function evaluateAbsConnector(
  equation: i32,
  x: f64,
  materialPointer: u32,
  materialCount: u32,
  protectionPointer: u32,
  observedPointer: u32,
): f64 {
  let result = 0.0;
  let index = materialCount;
  while (index > 0) {
    index -= 1;
    const material = getRecordPointer(materialPointer, index, ABS_CONNECTOR_BYTE_LENGTH);
    const coefficient = load<f64>(material + ABS_CONNECTOR_COEFFICIENT_OFFSET);
    const startX = load<f64>(material + ABS_CONNECTOR_START_X_OFFSET);
    const endX = load<f64>(material + ABS_CONNECTOR_END_X_OFFSET);
    if (equation == FORMULA_EQUATION_Y) {
      const width = load<f64>(material + ABS_CONNECTOR_WIDTH_OFFSET);
      result += coefficient * (NativeMath.abs(x - startX) + (width - NativeMath.abs(x - endX)));
    } else {
      const sourceSegmentIndex = load<u32>(material + ABS_CONNECTOR_SOURCE_SEGMENT_OFFSET);
      const contribution =
        coefficient *
        (evaluateSignRatio(
          x - startX,
          sourceSegmentIndex,
          SIGN_ROLE_START_X,
          protectionPointer,
          observedPointer,
        ) -
          evaluateSignRatio(
            x - endX,
            sourceSegmentIndex,
            SIGN_ROLE_END_X,
            protectionPointer,
            observedPointer,
          ));
      result = contribution + result;
    }
  }
  return result;
}

function evaluateAbsSecondDerivative(x: f64, materialPointer: u32, materialCount: u32, steepness: f64): f64 {
  let result = 0.0;
  let index = materialCount;
  while (index > 0) {
    index -= 1;
    const material = getRecordPointer(materialPointer, index, ABS_PULSE_BYTE_LENGTH);
    const t = steepness * (x - load<f64>(material + ABS_PULSE_CENTER_X_OFFSET));
    result = load<f64>(material + ABS_PULSE_COEFFICIENT_OFFSET) * evaluateStableFirstDerivativeBody(t) + result;
  }
  return result;
}

@inline
function evaluateCubicBody(t: f64, coefficientPointer: u32, derivativeOrder: i32): f64 {
  const t2 = NativeMath.pow(t, 2);
  const t3 = derivativeOrder == 0 ? NativeMath.pow(t, 3) : 0;
  let value = 0.0;
  let index = 4;
  while (index > 0) {
    index -= 1;
    const coefficient = load<f64>(coefficientPointer + index * sizeof<f64>());
    if (coefficient == 0) {
      continue;
    }
    let basis: f64;
    if (derivativeOrder == 0) {
      basis =
        index == 0
          ? 2 * t3 + (-3 * t2 + 1)
          : index == 1
            ? t3 + (-2 * t2 + t)
            : index == 2
              ? -2 * t3 + 3 * t2
              : t3 - t2;
    } else if (derivativeOrder == 1) {
      basis =
        index == 0
          ? 6 * t2 - 6 * t
          : index == 1
            ? 3 * t2 + (-4 * t + 1)
            : index == 2
              ? -6 * t2 + 6 * t
              : 3 * t2 - 2 * t;
    } else {
      basis = index == 0 ? 12 * t - 6 : index == 1 ? 6 * t - 4 : index == 2 ? -12 * t + 6 : 6 * t - 2;
    }
    value = coefficient * basis + value;
  }
  return value;
}

function evaluateSoftCubic(equation: i32, x: f64, materialPointer: u32, materialCount: u32): f64 {
  if (materialCount == 0) {
    return 0;
  }
  let numerator = 0.0;
  let denominator = 0.0;
  let firstNumerator = 0.0;
  let firstDenominator = 0.0;
  let secondNumerator = 0.0;
  let secondDenominator = 0.0;
  let index = materialCount;
  while (index > 0) {
    index -= 1;
    const material = getRecordPointer(materialPointer, index, SOFT_CUBIC_BYTE_LENGTH);
    const normalized =
      (x - load<f64>(material + SOFT_CENTER_X_OFFSET)) / load<f64>(material + SOFT_HALF_WIDTH_OFFSET);
    const base = 1 + NativeMath.pow(normalized, SOFT_POWER);
    const weight = 1 / base;
    const t = (x - load<f64>(material + SOFT_START_X_OFFSET)) / load<f64>(material + SOFT_WIDTH_OFFSET);
    const cubic = evaluateCubicBody(t, material + SOFT_CUBIC_COEFFICIENT_OFFSET, 0);
    numerator = weight * cubic + numerator;
    denominator = weight + denominator;
    if (equation == FORMULA_EQUATION_Y) {
      continue;
    }
    const firstPower =
      load<f64>(material + SOFT_FIRST_POWER_COEFFICIENT_OFFSET) * NativeMath.pow(normalized, SOFT_POWER - 1);
    const baseSquared = NativeMath.pow(base, 2);
    const firstWeight = -firstPower / baseSquared;
    const firstCubic = evaluateCubicBody(t, material + SOFT_FIRST_CUBIC_COEFFICIENT_OFFSET, 1);
    firstNumerator = firstWeight * cubic + (weight * firstCubic + firstNumerator);
    firstDenominator = firstWeight + firstDenominator;
    if (equation == FORMULA_EQUATION_DY) {
      continue;
    }
    const secondPower =
      load<f64>(material + SOFT_SECOND_POWER_COEFFICIENT_OFFSET) * NativeMath.pow(normalized, SOFT_POWER - 2);
    const secondWeight = -secondPower / baseSquared + 2 * (NativeMath.pow(firstPower, 2) / NativeMath.pow(base, 3));
    const secondCubic = evaluateCubicBody(t, material + SOFT_SECOND_CUBIC_COEFFICIENT_OFFSET, 2);
    secondNumerator =
      secondWeight * cubic + (2 * (firstWeight * firstCubic) + (weight * secondCubic + secondNumerator));
    secondDenominator = secondWeight + secondDenominator;
  }
  if (equation == FORMULA_EQUATION_DY) {
    return (firstNumerator * denominator - numerator * firstDenominator) / NativeMath.pow(denominator, 2);
  }
  if (equation == FORMULA_EQUATION_DDY) {
    const firstQuotientNumerator = firstNumerator * denominator - numerator * firstDenominator;
    return (
      ((secondNumerator * denominator - numerator * secondDenominator) * denominator -
        2 * (firstQuotientNumerator * firstDenominator)) /
      NativeMath.pow(denominator, 3)
    );
  }
  return numerator / denominator;
}

/** Evaluates already-built curve materials so launch preparation can reuse one canonical snapshot. */
export function evaluateCurveMaterialValue(
  materialType: i32,
  equation: i32,
  x: f64,
  materialPointer: u32,
  materialCount: u32,
  auxiliaryValue: f64,
  protectionPointer: u32,
  observedPointer: u32,
): f64 {
  return materialType == FORMULA_MATERIAL_ABS_CONNECTOR
    ? evaluateAbsConnector(equation, x, materialPointer, materialCount, protectionPointer, observedPointer)
    : materialType == FORMULA_MATERIAL_ABS_SECOND_DERIVATIVE
      ? evaluateAbsSecondDerivative(x, materialPointer, materialCount, auxiliaryValue)
      : materialType == FORMULA_MATERIAL_SOFT_CUBIC
        ? evaluateSoftCubic(equation, x, materialPointer, materialCount)
        : f64.NaN;
}

function createPchipSlopes(widthPointer: u32, secantPointer: u32, pointCount: u32, slopePointer: u32): void {
  const segmentCount = pointCount - 1;
  if (segmentCount == 1) {
    const slope = load<f64>(secantPointer);
    store<f64>(slopePointer, slope);
    store<f64>(slopePointer + sizeof<f64>(), slope);
    return;
  }
  const firstWidth = load<f64>(widthPointer);
  const nextWidth = load<f64>(widthPointer + sizeof<f64>());
  const firstSlope = load<f64>(secantPointer);
  const nextSlope = load<f64>(secantPointer + sizeof<f64>());
  store<f64>(slopePointer, createPchipEndpointSlope(firstWidth, nextWidth, firstSlope, nextSlope));
  const lastIndex = segmentCount - 1;
  store<f64>(
    slopePointer + segmentCount * sizeof<f64>(),
    createPchipEndpointSlope(
      load<f64>(widthPointer + lastIndex * sizeof<f64>()),
      load<f64>(widthPointer + (lastIndex - 1) * sizeof<f64>()),
      load<f64>(secantPointer + lastIndex * sizeof<f64>()),
      load<f64>(secantPointer + (lastIndex - 1) * sizeof<f64>()),
    ),
  );
  let index: u32 = 1;
  while (index < pointCount - 1) {
    const previousSlope = load<f64>(secantPointer + (index - 1) * sizeof<f64>());
    const followingSlope = load<f64>(secantPointer + index * sizeof<f64>());
    let slope = 0.0;
    if (previousSlope * followingSlope > 0) {
      const previousWidth = load<f64>(widthPointer + (index - 1) * sizeof<f64>());
      const followingWidth = load<f64>(widthPointer + index * sizeof<f64>());
      const leftWeight = 2 * followingWidth + previousWidth;
      const rightWeight = followingWidth + 2 * previousWidth;
      slope = (leftWeight + rightWeight) / (leftWeight / previousSlope + rightWeight / followingSlope);
    }
    store<f64>(slopePointer + index * sizeof<f64>(), slope);
    index += 1;
  }
}

@inline
function createPchipEndpointSlope(width: f64, nextWidth: f64, slope: f64, nextSlope: f64): f64 {
  const result = ((2 * width + nextWidth) * slope - width * nextSlope) / (width + nextWidth);
  if (result * slope <= 0) {
    return 0;
  }
  return slope * nextSlope < 0 && NativeMath.abs(result) > NativeMath.abs(3 * slope) ? 3 * slope : result;
}

function createAkimaSlopes(secantPointer: u32, pointCount: u32, slopePointer: u32): void {
  const segmentCount = pointCount - 1;
  if (segmentCount == 1) {
    const slope = load<f64>(secantPointer);
    store<f64>(slopePointer, slope);
    store<f64>(slopePointer + sizeof<f64>(), slope);
    return;
  }
  const extendedPointer = reserveArena(checkedByteLength(segmentCount + 4, sizeof<f64>()), sizeof<f64>());
  const first = load<f64>(secantPointer);
  const second = load<f64>(secantPointer + sizeof<f64>());
  const last = load<f64>(secantPointer + (segmentCount - 1) * sizeof<f64>());
  const penultimate = load<f64>(secantPointer + (segmentCount - 2) * sizeof<f64>());
  store<f64>(extendedPointer, 3 * first - 2 * second);
  store<f64>(extendedPointer + sizeof<f64>(), 2 * first - second);
  memory.copy(extendedPointer + 2 * sizeof<f64>(), secantPointer, checkedByteLength(segmentCount, sizeof<f64>()));
  store<f64>(extendedPointer + (segmentCount + 2) * sizeof<f64>(), 2 * last - penultimate);
  store<f64>(extendedPointer + (segmentCount + 3) * sizeof<f64>(), 3 * last - 2 * penultimate);
  let index: u32 = 0;
  while (index < pointCount) {
    const leftWeight = NativeMath.abs(
      load<f64>(extendedPointer + (index + 3) * sizeof<f64>()) -
        load<f64>(extendedPointer + (index + 2) * sizeof<f64>()),
    );
    const rightWeight = NativeMath.abs(
      load<f64>(extendedPointer + (index + 1) * sizeof<f64>()) - load<f64>(extendedPointer + index * sizeof<f64>()),
    );
    const leftSlope = load<f64>(extendedPointer + (index + 1) * sizeof<f64>());
    const rightSlope = load<f64>(extendedPointer + (index + 2) * sizeof<f64>());
    const slope =
      leftWeight + rightWeight == 0
        ? (leftSlope + rightSlope) / 2
        : (leftWeight * leftSlope + rightWeight * rightSlope) / (leftWeight + rightWeight);
    store<f64>(slopePointer + index * sizeof<f64>(), slope);
    index += 1;
  }
}

/** Builds ABS/PCHIP/Akima materials from canonical path data and evaluates a complete batch. */
export function runCurveBatch(inputPointer: u32): u32 {
  requireGraphwarGameConstantsInitialized();
  requireArenaRange(inputPointer, FORMULA_INPUT_BYTE_LENGTH, sizeof<u64>());
  const graphwarMinimumXStep = getGraphwarFuncMinXStepDistance();
  const algorithm = load<i32>(inputPointer + FORMULA_INPUT_ALGORITHM_OFFSET);
  const equation = load<i32>(inputPointer + FORMULA_INPUT_EQUATION_OFFSET);
  const decimalPlaces = load<i32>(inputPointer + FORMULA_INPUT_DECIMAL_PLACES_OFFSET);
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
  const segmentStartXPointer = load<u32>(inputPointer + FORMULA_INPUT_SEGMENT_START_X_POINTER_OFFSET);
  const segmentStartYPointer = load<u32>(inputPointer + FORMULA_INPUT_SEGMENT_START_Y_POINTER_OFFSET);
  const pulseDeltaSlopePointer = load<u32>(inputPointer + FORMULA_INPUT_ABS_PULSE_DELTA_SLOPE_POINTER_OFFSET);
  const pulseCenterXPointer = load<u32>(inputPointer + FORMULA_INPUT_ABS_PULSE_CENTER_X_POINTER_OFFSET);
  const rawSteepness = load<f64>(inputPointer + FORMULA_INPUT_STEEPNESS_OFFSET);
  if (
    (algorithm != FORMULA_ALGORITHM_ABS &&
      algorithm != FORMULA_ALGORITHM_PCHIP &&
      algorithm != FORMULA_ALGORITHM_AKIMA) ||
    (equation != FORMULA_EQUATION_Y && equation != FORMULA_EQUATION_DY && equation != FORMULA_EQUATION_DDY) ||
    decimalPlaces < 0 ||
    decimalPlaces > 15 ||
    pointCount < 2 ||
    load<u32>(inputPointer + FORMULA_INPUT_FLAGS_OFFSET) != 0 ||
    !isFiniteValue(rawSteepness) ||
    load<u32>(inputPointer + FORMULA_INPUT_STEP_OVERFLOW_RANGE_POINTER_OFFSET) != 0 ||
    load<u32>(inputPointer + FORMULA_INPUT_STEP_OVERFLOW_RANGE_COUNT_OFFSET) != 0
  ) {
    trap();
  }
  const segmentCount = pointCount - 1;
  if (protectionPointer == 0 ? protectionCount != 0 : protectionCount != segmentCount) {
    trap();
  }
  const pointByteLength = checkedByteLength(pointCount, sizeof<f64>());
  const segmentByteLength = checkedByteLength(segmentCount, sizeof<f64>());
  const valueByteLength = checkedByteLength(valueCount, sizeof<f64>());
  requireArenaRange(pointXPointer, pointByteLength, sizeof<f64>());
  requireArenaRange(pointYPointer, pointByteLength, sizeof<f64>());
  requireOptionalRange(protectionPointer, checkedByteLength(protectionCount, sizeof<u32>()), sizeof<u32>());
  requireOptionalRange(disabledPointer, segmentCount, 1);
  requireOptionalRange(segmentStartXPointer, pointByteLength, sizeof<f64>());
  requireOptionalRange(segmentStartYPointer, pointByteLength, sizeof<f64>());
  if ((segmentStartXPointer == 0) != (segmentStartYPointer == 0)) {
    trap();
  }
  requireOptionalRange(pulseDeltaSlopePointer, segmentByteLength, sizeof<f64>());
  requireOptionalRange(pulseCenterXPointer, segmentByteLength, sizeof<f64>());
  requireArenaRange(valueXPointer, valueByteLength, sizeof<f64>());
  requireArenaRange(valueYPointer, valueByteLength, sizeof<f64>());
  requireArenaRange(valueDyPointer, valueByteLength, sizeof<f64>());
  let pointIndex: u32 = 0;
  while (pointIndex < pointCount) {
    if (!isFiniteValue(loadPointX(pointXPointer, pointIndex)) || !isFiniteValue(loadPointY(pointYPointer, pointIndex))) {
      trap();
    }
    pointIndex += 1;
  }

  let materialType: i32;
  let materialStride: u32;
  if (algorithm == FORMULA_ALGORITHM_ABS) {
    materialType = equation == FORMULA_EQUATION_DDY ? FORMULA_MATERIAL_ABS_SECOND_DERIVATIVE : FORMULA_MATERIAL_ABS_CONNECTOR;
    materialStride = equation == FORMULA_EQUATION_DDY ? ABS_PULSE_BYTE_LENGTH : ABS_CONNECTOR_BYTE_LENGTH;
  } else {
    materialType = FORMULA_MATERIAL_SOFT_CUBIC;
    materialStride = SOFT_CUBIC_BYTE_LENGTH;
  }
  const resultPointer = reserveArena(FORMULA_RESULT_BYTE_LENGTH, sizeof<f64>());
  const materialStorageByteLength = checkedByteLength(segmentCount, materialStride);
  const materialStoragePointer = reserveArena(materialStorageByteLength, sizeof<f64>());
  memory.fill(materialStoragePointer, 0, materialStorageByteLength);
  const valuePointer = valueCount == 0 ? 0 : reserveArena(valueByteLength, sizeof<f64>());
  const observedPointer = reserveArena(checkedByteLength(segmentCount, sizeof<u32>()), sizeof<u32>());
  memory.fill(observedPointer, 0, checkedByteLength(segmentCount, sizeof<u32>()));
  const scratchMark = markArena();
  let materialCount = 0;
  let auxiliaryValue = 0.0;

  if (algorithm == FORMULA_ALGORITHM_ABS && equation != FORMULA_EQUATION_DDY) {
    let index: u32 = 0;
    while (index < segmentCount) {
      if (disabledPointer != 0 && load<u8>(disabledPointer + index) != 0) {
        index += 1;
        continue;
      }
      let startX = loadPointX(pointXPointer, index);
      let startY = loadPointY(pointYPointer, index);
      if (equation == FORMULA_EQUATION_DY && index > 0 && segmentStartXPointer != 0) {
        const candidateX = loadPointX(segmentStartXPointer, index);
        const candidateY = loadPointY(segmentStartYPointer, index);
        if (candidateX == candidateX || candidateY == candidateY) {
          if (!isFiniteValue(candidateX) || !isFiniteValue(candidateY)) {
            trap();
          }
          startX = candidateX;
          startY = candidateY;
        }
      }
      const targetX = loadPointX(pointXPointer, index + 1);
      const targetY = loadPointY(pointYPointer, index + 1);
      const deltaY = targetY - startY;
      const rawWidth = targetX - startX;
      let endX = targetX;
      let width = rawWidth;
      if (!(rawWidth > graphwarMinimumXStep)) {
        const centerX = (startX + targetX) / 2;
        startX = centerX - graphwarMinimumXStep / 2;
        endX = centerX + graphwarMinimumXStep / 2;
        width = graphwarMinimumXStep;
      }
      if (
        roundFormulaDecimal(startX, decimalPlaces) == roundFormulaDecimal(endX, decimalPlaces) &&
        roundFormulaDecimal(width, decimalPlaces) == 0
      ) {
        index += 1;
        continue;
      }
      const coefficient = quantizeFormulaCoefficient(deltaY / (2 * width), decimalPlaces);
      if (coefficient != 0) {
        const material = getRecordPointer(materialStoragePointer, materialCount, materialStride);
        store<f64>(material + ABS_CONNECTOR_COEFFICIENT_OFFSET, coefficient);
        store<f64>(material + ABS_CONNECTOR_START_X_OFFSET, floorFormulaDecimal(startX, decimalPlaces));
        store<f64>(material + ABS_CONNECTOR_END_X_OFFSET, floorFormulaDecimal(endX, decimalPlaces));
        store<f64>(material + ABS_CONNECTOR_WIDTH_OFFSET, roundFormulaDecimal(width, decimalPlaces));
        store<u32>(material + ABS_CONNECTOR_SOURCE_SEGMENT_OFFSET, index);
        materialCount += 1;
      }
      index += 1;
    }
  } else if (algorithm == FORMULA_ALGORITHM_ABS) {
    auxiliaryValue = roundFormulaDecimal(rawSteepness, decimalPlaces);
    const widthPointer = reserveArena(segmentByteLength, sizeof<f64>());
    const secantPointer = reserveArena(segmentByteLength, sizeof<f64>());
    let index: u32 = 0;
    while (index < segmentCount) {
      const width = NativeMath.max(
        loadPointX(pointXPointer, index + 1) - loadPointX(pointXPointer, index),
        graphwarMinimumXStep,
      );
      store<f64>(widthPointer + index * sizeof<f64>(), width);
      store<f64>(
        secantPointer + index * sizeof<f64>(),
        (loadPointY(pointYPointer, index + 1) - loadPointY(pointYPointer, index)) / width,
      );
      index += 1;
    }
    index = 0;
    while (index < segmentCount) {
      let deltaSlope =
        index + 1 < segmentCount
          ? load<f64>(secantPointer + (index + 1) * sizeof<f64>()) - load<f64>(secantPointer + index * sizeof<f64>())
          : -load<f64>(secantPointer + index * sizeof<f64>());
      if (pulseDeltaSlopePointer != 0) {
        const candidate = load<f64>(pulseDeltaSlopePointer + index * sizeof<f64>());
        if (candidate == candidate) {
          if (!isFiniteValue(candidate)) {
            trap();
          }
          deltaSlope = candidate;
        } else {
          index += 1;
          continue;
        }
      }
      const coefficient = quantizeFormulaCoefficient(auxiliaryValue * deltaSlope, decimalPlaces);
      if (coefficient != 0) {
        let centerX = loadPointX(pointXPointer, index + 1);
        if (pulseCenterXPointer != 0) {
          const candidate = load<f64>(pulseCenterXPointer + index * sizeof<f64>());
          if (candidate == candidate) {
            if (!isFiniteValue(candidate)) {
              trap();
            }
            centerX = candidate;
          }
        }
        const material = getRecordPointer(materialStoragePointer, materialCount, materialStride);
        store<f64>(material + ABS_PULSE_COEFFICIENT_OFFSET, coefficient);
        store<f64>(material + ABS_PULSE_CENTER_X_OFFSET, floorFormulaDecimal(centerX, decimalPlaces));
        materialCount += 1;
      }
      index += 1;
    }
  } else {
    const widthPointer = reserveArena(segmentByteLength, sizeof<f64>());
    const secantPointer = reserveArena(segmentByteLength, sizeof<f64>());
    const slopePointer = reserveArena(pointByteLength, sizeof<f64>());
    let index: u32 = 0;
    while (index < segmentCount) {
      const width = NativeMath.max(
        loadPointX(pointXPointer, index + 1) - loadPointX(pointXPointer, index),
        graphwarMinimumXStep,
      );
      store<f64>(widthPointer + index * sizeof<f64>(), width);
      store<f64>(
        secantPointer + index * sizeof<f64>(),
        (loadPointY(pointYPointer, index + 1) - loadPointY(pointYPointer, index)) / width,
      );
      index += 1;
    }
    if (algorithm == FORMULA_ALGORITHM_PCHIP) {
      createPchipSlopes(widthPointer, secantPointer, pointCount, slopePointer);
    } else {
      createAkimaSlopes(secantPointer, pointCount, slopePointer);
    }
    const baseY = loadPointY(pointYPointer, 0);
    index = 0;
    while (index < segmentCount) {
      const material = getRecordPointer(materialStoragePointer, index, materialStride);
      const width = load<f64>(widthPointer + index * sizeof<f64>());
      const halfWidth = width / 2;
      const startY = loadPointY(pointYPointer, index) - baseY;
      const endY = loadPointY(pointYPointer, index + 1) - baseY;
      const startSlope = load<f64>(slopePointer + index * sizeof<f64>());
      const endSlope = load<f64>(slopePointer + (index + 1) * sizeof<f64>());
      store<f64>(material + SOFT_CUBIC_COEFFICIENT_OFFSET, roundFormulaDecimal(startY, decimalPlaces));
      store<f64>(material + SOFT_CUBIC_COEFFICIENT_OFFSET + 8, roundFormulaDecimal(width * startSlope, decimalPlaces));
      store<f64>(material + SOFT_CUBIC_COEFFICIENT_OFFSET + 16, roundFormulaDecimal(endY, decimalPlaces));
      store<f64>(material + SOFT_CUBIC_COEFFICIENT_OFFSET + 24, roundFormulaDecimal(width * endSlope, decimalPlaces));
      store<f64>(material + SOFT_FIRST_CUBIC_COEFFICIENT_OFFSET, roundFormulaDecimal(startY / width, decimalPlaces));
      store<f64>(material + SOFT_FIRST_CUBIC_COEFFICIENT_OFFSET + 8, roundFormulaDecimal(startSlope, decimalPlaces));
      store<f64>(material + SOFT_FIRST_CUBIC_COEFFICIENT_OFFSET + 16, roundFormulaDecimal(endY / width, decimalPlaces));
      store<f64>(material + SOFT_FIRST_CUBIC_COEFFICIENT_OFFSET + 24, roundFormulaDecimal(endSlope, decimalPlaces));
      store<f64>(
        material + SOFT_FIRST_POWER_COEFFICIENT_OFFSET,
        roundFormulaDecimal(SOFT_POWER / halfWidth, decimalPlaces),
      );
      store<f64>(material + SOFT_HALF_WIDTH_OFFSET, roundFormulaDecimal(halfWidth, decimalPlaces));
      store<f64>(
        material + SOFT_SECOND_CUBIC_COEFFICIENT_OFFSET,
        roundFormulaDecimal(startY / NativeMath.pow(width, 2), decimalPlaces),
      );
      store<f64>(
        material + SOFT_SECOND_CUBIC_COEFFICIENT_OFFSET + 8,
        roundFormulaDecimal(startSlope / width, decimalPlaces),
      );
      store<f64>(
        material + SOFT_SECOND_CUBIC_COEFFICIENT_OFFSET + 16,
        roundFormulaDecimal(endY / NativeMath.pow(width, 2), decimalPlaces),
      );
      store<f64>(
        material + SOFT_SECOND_CUBIC_COEFFICIENT_OFFSET + 24,
        roundFormulaDecimal(endSlope / width, decimalPlaces),
      );
      store<f64>(
        material + SOFT_SECOND_POWER_COEFFICIENT_OFFSET,
        roundFormulaDecimal((SOFT_POWER * (SOFT_POWER - 1)) / NativeMath.pow(halfWidth, 2), decimalPlaces),
      );
      store<f64>(
        material + SOFT_CENTER_X_OFFSET,
        roundFormulaDecimal((loadPointX(pointXPointer, index) + loadPointX(pointXPointer, index + 1)) / 2, decimalPlaces),
      );
      store<f64>(material + SOFT_START_X_OFFSET, roundFormulaDecimal(loadPointX(pointXPointer, index), decimalPlaces));
      store<f64>(material + SOFT_WIDTH_OFFSET, roundFormulaDecimal(width, decimalPlaces));
      index += 1;
    }
    materialCount = segmentCount;
  }
  resetArena(scratchMark);

  let valueIndex: u32 = 0;
  while (valueIndex < valueCount) {
    const value = evaluateCurveMaterialValue(
      materialType,
      equation,
      load<f64>(valueXPointer + valueIndex * sizeof<f64>()),
      materialStoragePointer,
      materialCount,
      auxiliaryValue,
      protectionPointer,
      observedPointer,
    );
    store<f64>(valuePointer + valueIndex * sizeof<f64>(), value);
    valueIndex += 1;
  }
  store<i32>(resultPointer + FORMULA_RESULT_MATERIAL_TYPE_OFFSET, materialType);
  store<u32>(
    resultPointer + FORMULA_RESULT_MATERIAL_POINTER_OFFSET,
    materialCount == 0 ? 0 : materialStoragePointer,
  );
  store<u32>(resultPointer + FORMULA_RESULT_MATERIAL_COUNT_OFFSET, materialCount);
  store<u32>(resultPointer + FORMULA_RESULT_MATERIAL_STRIDE_OFFSET, materialStride);
  store<u32>(resultPointer + FORMULA_RESULT_VALUE_POINTER_OFFSET, valuePointer);
  store<u32>(resultPointer + FORMULA_RESULT_VALUE_COUNT_OFFSET, valueCount);
  store<f64>(resultPointer + FORMULA_RESULT_AUXILIARY_VALUE_OFFSET, auxiliaryValue);
  store<u32>(resultPointer + FORMULA_RESULT_PROTECTION_POINTER_OFFSET, observedPointer);
  store<u32>(resultPointer + FORMULA_RESULT_PROTECTION_COUNT_OFFSET, segmentCount);
  store<u32>(resultPointer + FORMULA_RESULT_FLAGS_OFFSET, 0);
  return resultPointer;
}
