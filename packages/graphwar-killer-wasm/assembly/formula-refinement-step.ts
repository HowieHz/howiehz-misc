import { floorFormulaDecimal, quantizeFormulaOffsetCenter } from "./decimal";
import {
  FORMULA_EQUATION_DDY,
  FORMULA_EQUATION_DY,
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
} from "./formula-layout";
import {
  getGraphwarFuncMinXStepDistance,
  getGraphwarGameSoldierRadius,
  getGraphwarPlaneHeight,
  getGraphwarPlaneLength,
  getGraphwarStepSize,
} from "./game-constants";

const MAX_FORMULA_DECIMAL_PLACES: i32 = 15;

// RK4 weights {1, 2, 2, 1}/6 have exactly these six distinct non-zero subset sums.
export const STEP_GLITCH_RK4_CONTRIBUTION_FACTOR_COUNT: u32 = 6;

// Direct must precede armed: this is the stable candidate tie order used by the TypeScript cold path.
export const STEP_GLITCH_SECOND_ORDER_PROFILE_DIRECT: u32 = 0;
export const STEP_GLITCH_SECOND_ORDER_PROFILE_ARMED: u32 = 1;
export const STEP_GLITCH_SECOND_ORDER_PROFILE_COUNT: u32 = 2;

const STEP_GLITCH_SECOND_ORDER_BRAKING_WEIGHT: f64 = 2;
const STEP_GLITCH_SECOND_ORDER_BRAKING_DERIVATIVE_FACTOR: f64 = 3;
const STEP_GLITCH_SECOND_ORDER_DIRECT_ACCELERATION_BRAKING_RATIO: f64 = 2;
const STEP_GLITCH_SECOND_ORDER_ARMED_ACCELERATION_WEIGHT: f64 = 5;
const STEP_GLITCH_SECOND_ORDER_PULSE_END_STEP_FACTOR: f64 = 1.25;

/** Caller-owned jump/window record shared by the pure constructors below. */
export const STEP_GLITCH_JUMP_START_X_OFFSET: u32 = 0;
export const STEP_GLITCH_JUMP_END_X_OFFSET: u32 = 8;
export const STEP_GLITCH_JUMP_STEP_OFFSET: u32 = 16;
export const STEP_GLITCH_JUMP_BYTE_LENGTH: u32 = 24;

@inline
function trap(): void {
  unreachable();
}

@inline
function isFiniteValue(value: f64): bool {
  return value == value && value != f64.POSITIVE_INFINITY && value != f64.NEGATIVE_INFINITY;
}

/** Returns the first-order factor in the exact TypeScript candidate order. */
export function getStepGlitchRk4ContributionFactor(index: u32): f64 {
  if (index == 0) return 1;
  if (index == 1) return 5.0 / 6.0;
  if (index == 2) return 2.0 / 3.0;
  if (index == 3) return 1.0 / 2.0;
  if (index == 4) return 1.0 / 3.0;
  if (index == 5) return 1.0 / 6.0;
  trap();
  return 0;
}

/** Matches `Math.max(0, Math.ceil(-Math.log10(GRAPHWAR_STEP_SIZE)))`. */
export function getStepGlitchInitialWindowDecimalPlaces(): i32 {
  const decimalPlaces = <i32>NativeMath.ceil(-NativeMath.log10(getGraphwarStepSize()));
  return decimalPlaces > 0 ? decimalPlaces : 0;
}

/** Returns the final step reached by Graphwar's repeated bisection loop. */
export function getGraphwarLastBisectedXStepDistance(): f64 {
  let step = getGraphwarStepSize();
  const minimumStep = getGraphwarFuncMinXStepDistance();
  while (step > minimumStep) {
    step /= 2;
  }
  return step;
}

/**
 * Compares two Step y'' landing qualities with the same layered ordering as the TypeScript cold path.
 *
 * `positionTargetPlanePixels` is passed by the caller so the current 1 px policy remains outside this math module.
 */
export function isStepSecondOrderLandingQualityBetter(
  candidateDerivativeError: f64,
  candidatePositionErrorPlanePixels: f64,
  bestDerivativeError: f64,
  bestPositionErrorPlanePixels: f64,
  candidateDerivativeTieBreaker: f64,
  bestDerivativeTieBreaker: f64,
  positionTargetPlanePixels: f64,
  hasBest: bool,
  hasDerivativeTieBreaker: bool,
): bool {
  if (!hasBest) {
    return true;
  }
  const candidateWithinTarget = candidatePositionErrorPlanePixels <= positionTargetPlanePixels;
  const bestWithinTarget = bestPositionErrorPlanePixels <= positionTargetPlanePixels;
  if (candidateWithinTarget != bestWithinTarget) {
    return candidateWithinTarget;
  }
  if (!candidateWithinTarget && candidatePositionErrorPlanePixels != bestPositionErrorPlanePixels) {
    return candidatePositionErrorPlanePixels < bestPositionErrorPlanePixels;
  }
  if (candidateDerivativeError != bestDerivativeError) {
    return candidateDerivativeError < bestDerivativeError;
  }
  if (hasDerivativeTieBreaker && candidateDerivativeTieBreaker != bestDerivativeTieBreaker) {
    return candidateDerivativeTieBreaker < bestDerivativeTieBreaker;
  }
  return candidatePositionErrorPlanePixels < bestPositionErrorPlanePixels;
}

/** Closes the y gate at the near edge of the target hit circle and preserves offset quantization. */
export function createStepGlitchFormulaGateY(targetY: f64, deltaY: f64, decimalPlaces: i32): f64 {
  if (deltaY == 0) {
    return targetY;
  }
  const radius = getGraphwarGameSoldierRadius();
  const gateY = deltaY > 0 ? targetY - radius : targetY + radius;
  return quantizeFormulaOffsetCenter(gateY, decimalPlaces);
}

/** Writes the quantized x gates to a caller-owned jump record without assigning its integration step. */
export function createStepGlitchFormulaXWindow(
  targetX: f64,
  width: f64,
  decimalPlaces: i32,
  windowDecimalPlaces: i32,
  jumpPointer: u32,
): void {
  const formulaEndX = floorFormulaDecimal(targetX, decimalPlaces);
  const requiredStartDecimalPlaces = decimalPlaces > windowDecimalPlaces ? decimalPlaces : windowDecimalPlaces;
  const startDecimalPlaces =
    requiredStartDecimalPlaces < MAX_FORMULA_DECIMAL_PLACES
      ? requiredStartDecimalPlaces
      : MAX_FORMULA_DECIMAL_PLACES;
  store<f64>(jumpPointer + STEP_GLITCH_JUMP_END_X_OFFSET, formulaEndX);
  store<f64>(
    jumpPointer + STEP_GLITCH_JUMP_START_X_OFFSET,
    quantizeFormulaOffsetCenter(formulaEndX - width, startDecimalPlaces),
  );
}

/** Writes one first-order hard-glitch segment using the exact RK4 inverse grouping. */
export function createStepFirstOrderGlitchSegment(
  jumpPointer: u32,
  targetY: f64,
  gateY: f64,
  replacementDeltaY: f64,
  contributionFactor: f64,
  formulaDecimalPlaces: i32,
  segmentPointer: u32,
): void {
  memory.fill(segmentPointer, 0, STEP_GLITCH_RECORD_BYTE_LENGTH);
  writeStepGlitchSegmentBase(jumpPointer, targetY, formulaDecimalPlaces, FORMULA_EQUATION_DY, segmentPointer);
  store<f64>(
    segmentPointer + STEP_GLITCH_RECORD_PRIMARY_OFFSET,
    replacementDeltaY / (contributionFactor * load<f64>(jumpPointer + STEP_GLITCH_JUMP_STEP_OFFSET)),
  );
  store<f64>(segmentPointer + STEP_GLITCH_RECORD_GATE_Y_OFFSET, gateY);
}

/** Builds one non-empty, strictly in-segment x window and assigns the canonical last bisected step. */
export function createStepGlitchJump(
  previousX: f64,
  targetX: f64,
  width: f64,
  decimalPlaces: i32,
  windowDecimalPlaces: i32,
  jumpPointer: u32,
): bool {
  if (!(targetX > previousX)) {
    memory.fill(jumpPointer, 0, STEP_GLITCH_JUMP_BYTE_LENGTH);
    return false;
  }

  createStepGlitchFormulaXWindow(targetX, width, decimalPlaces, windowDecimalPlaces, jumpPointer);
  const endX = load<f64>(jumpPointer + STEP_GLITCH_JUMP_END_X_OFFSET);
  const startX = load<f64>(jumpPointer + STEP_GLITCH_JUMP_START_X_OFFSET);
  if (!(endX > startX) || !(startX > previousX)) {
    memory.fill(jumpPointer, 0, STEP_GLITCH_JUMP_BYTE_LENGTH);
    return false;
  }
  store<f64>(jumpPointer + STEP_GLITCH_JUMP_STEP_OFFSET, getGraphwarLastBisectedXStepDistance());
  return true;
}

/** Selects the previous hard-window end or the ordinary control-point x for the next refinement probe. */
export function createStepSegmentRefinementStopX(
  pointX: f64,
  previousSegmentEndX: f64,
  hasPreviousSegment: bool,
): f64 {
  return hasPreviousSegment ? previousSegmentEndX : pointX;
}

/** Recomputes the canonical Step center after a real prefix landing changes the effective segment height. */
export function calculateStepRefinedFormulaCenterX(
  startX: f64,
  targetX: f64,
  effectiveDeltaY: f64,
  formulaSteepness: f64,
  boundsMinX: f64,
  boundsMaxX: f64,
  boundsMinY: f64,
  boundsMaxY: f64,
  positionTargetPlanePixels: f64,
): f64 {
  if (
    !isFiniteValue(startX) ||
    !isFiniteValue(targetX) ||
    !isFiniteValue(effectiveDeltaY) ||
    !isFiniteValue(formulaSteepness)
  ) {
    return f64.NaN;
  }
  if (formulaSteepness <= 0) {
    return targetX;
  }
  const availableOffset = targetX - startX - NativeMath.abs(boundsMaxX - boundsMinX) / getGraphwarPlaneLength();
  const requiredProgress =
    1 -
    (NativeMath.abs(boundsMaxY - boundsMinY) / getGraphwarPlaneHeight()) *
      positionTargetPlanePixels /
      NativeMath.abs(effectiveDeltaY);
  if (
    effectiveDeltaY == 0 ||
    requiredProgress <= 0.5 ||
    availableOffset <= 0 ||
    !isFiniteValue(availableOffset)
  ) {
    return targetX;
  }
  const centerOffset = NativeMath.log(requiredProgress / (1 - requiredProgress)) / formulaSteepness;
  return targetX - NativeMath.min(centerOffset, availableOffset);
}

/** Applies the TypeScript cold path's three-region Step obstacle envelope to a canonical raw plane mask. */
export function stepGlitchObstacleEnvelopeHitsObstacle(
  previousX: f64,
  previousY: f64,
  targetX: f64,
  targetY: f64,
  formulaCenterX: f64,
  boundsMinX: f64,
  boundsMaxX: f64,
  boundsMinY: f64,
  boundsMaxY: f64,
  maskPointer: u32,
): bool {
  if (
    !isFiniteValue(previousX) ||
    !isFiniteValue(previousY) ||
    !isFiniteValue(targetX) ||
    !isFiniteValue(targetY) ||
    !isFiniteValue(formulaCenterX) ||
    !(targetX > previousX)
  ) {
    return false;
  }

  const centerX = NativeMath.min(targetX, NativeMath.max(previousX, formulaCenterX));
  const symmetricStartX = NativeMath.min(centerX, NativeMath.max(previousX, 2 * centerX - targetX));
  const midpointY = (previousY + targetY) / 2;
  return (
    stepGlitchGraphRegionHitsObstacle(
      previousX,
      symmetricStartX,
      previousY,
      previousY,
      boundsMinX,
      boundsMaxX,
      boundsMinY,
      boundsMaxY,
      maskPointer,
    ) ||
    stepGlitchGraphRegionHitsObstacle(
      symmetricStartX,
      centerX,
      previousY,
      midpointY,
      boundsMinX,
      boundsMaxX,
      boundsMinY,
      boundsMaxY,
      maskPointer,
    ) ||
    stepGlitchGraphRegionHitsObstacle(
      centerX,
      targetX,
      midpointY,
      targetY,
      boundsMinX,
      boundsMaxX,
      boundsMinY,
      boundsMaxY,
      maskPointer,
    )
  );
}

/**
 * Inverts one direct/armed Step y'' profile without replaying trajectory state.
 *
 * Returns false for the same profiles the TypeScript candidate loop skips. On success it writes one existing
 * `STEP_GLITCH_RECORD_BYTE_LENGTH` record, ready for the formula material builder.
 */
export function createStepSecondOrderGlitchSegmentCandidate(
  jumpPointer: u32,
  targetY: f64,
  resumeX: f64,
  resumeY: f64,
  resumeDerivative: f64,
  formulaDecimalPlaces: i32,
  profileIndex: u32,
  segmentPointer: u32,
): bool {
  const h = load<f64>(jumpPointer + STEP_GLITCH_JUMP_STEP_OFFSET);
  const startX = load<f64>(jumpPointer + STEP_GLITCH_JUMP_START_X_OFFSET);
  const endX = load<f64>(jumpPointer + STEP_GLITCH_JUMP_END_X_OFFSET);
  const directDeltaY = targetY - resumeY - h * resumeDerivative;
  const directAcceleration = (3 * directDeltaY) / NativeMath.pow(h, 2);
  let armStep = getGraphwarStepSize();
  while (armStep > h && resumeX + armStep / 2 > startX) {
    armStep /= 2;
  }
  const armedDeltaY = targetY - resumeY - (armStep + h) * resumeDerivative;
  const armedAcceleration = armedDeltaY / ((h * armStep) / 6 + NativeMath.pow(h, 2) / 2);

  let acceleration: f64;
  let braking: f64;
  let deltaY: f64;
  let pulseEndX: f64;
  if (profileIndex == STEP_GLITCH_SECOND_ORDER_PROFILE_DIRECT) {
    acceleration = directAcceleration;
    braking =
      (-STEP_GLITCH_SECOND_ORDER_BRAKING_DERIVATIVE_FACTOR * resumeDerivative) / h -
      STEP_GLITCH_SECOND_ORDER_DIRECT_ACCELERATION_BRAKING_RATIO * directAcceleration;
    deltaY = directDeltaY;
    pulseEndX = resumeX + STEP_GLITCH_SECOND_ORDER_PULSE_END_STEP_FACTOR * h;
  } else if (profileIndex == STEP_GLITCH_SECOND_ORDER_PROFILE_ARMED) {
    acceleration = armedAcceleration;
    braking =
      (-STEP_GLITCH_SECOND_ORDER_BRAKING_DERIVATIVE_FACTOR * resumeDerivative) / h -
      (armedAcceleration * (STEP_GLITCH_SECOND_ORDER_ARMED_ACCELERATION_WEIGHT + armStep / h)) /
        STEP_GLITCH_SECOND_ORDER_BRAKING_WEIGHT;
    deltaY = armedDeltaY;
    pulseEndX = resumeX + armStep + STEP_GLITCH_SECOND_ORDER_PULSE_END_STEP_FACTOR * h;
  } else {
    trap();
    return false;
  }

  if (
    !isFiniteValue(acceleration) ||
    !(pulseEndX > startX) ||
    !(pulseEndX < endX) ||
    NativeMath.abs(deltaY) <= 2 * getGraphwarGameSoldierRadius()
  ) {
    return false;
  }

  const gateY = quantizeFormulaOffsetCenter(
    targetY + (deltaY < 0 ? getGraphwarGameSoldierRadius() : -getGraphwarGameSoldierRadius()),
    formulaDecimalPlaces,
  );
  memory.fill(segmentPointer, 0, STEP_GLITCH_RECORD_BYTE_LENGTH);
  writeStepGlitchSegmentBase(jumpPointer, targetY, formulaDecimalPlaces, FORMULA_EQUATION_DDY, segmentPointer);
  store<f64>(segmentPointer + STEP_GLITCH_RECORD_PRIMARY_OFFSET, acceleration);
  store<f64>(segmentPointer + STEP_GLITCH_RECORD_GATE_Y_OFFSET, gateY);
  store<f64>(segmentPointer + STEP_GLITCH_RECORD_BRAKING_OFFSET, braking);
  store<f64>(segmentPointer + STEP_GLITCH_RECORD_BRAKING_GATE_Y_OFFSET, gateY);
  store<f64>(segmentPointer + STEP_GLITCH_RECORD_PULSE_END_X_OFFSET, pulseEndX);
  return true;
}

function writeStepGlitchSegmentBase(
  jumpPointer: u32,
  targetY: f64,
  formulaDecimalPlaces: i32,
  equation: i32,
  segmentPointer: u32,
): void {
  store<i32>(segmentPointer + STEP_GLITCH_RECORD_EQUATION_OFFSET, equation);
  store<i32>(segmentPointer + STEP_GLITCH_RECORD_DECIMAL_PLACES_OFFSET, formulaDecimalPlaces);
  store<f64>(
    segmentPointer + STEP_GLITCH_RECORD_START_X_OFFSET,
    load<f64>(jumpPointer + STEP_GLITCH_JUMP_START_X_OFFSET),
  );
  store<f64>(
    segmentPointer + STEP_GLITCH_RECORD_END_X_OFFSET,
    load<f64>(jumpPointer + STEP_GLITCH_JUMP_END_X_OFFSET),
  );
  store<f64>(segmentPointer + STEP_GLITCH_RECORD_TARGET_Y_OFFSET, targetY);
}

function stepGlitchGraphRegionHitsObstacle(
  startX: f64,
  endX: f64,
  startY: f64,
  endY: f64,
  rawBoundsMinX: f64,
  rawBoundsMaxX: f64,
  rawBoundsMinY: f64,
  rawBoundsMaxY: f64,
  maskPointer: u32,
): bool {
  const boundsMinX = NativeMath.min(rawBoundsMinX, rawBoundsMaxX);
  const boundsMaxX = NativeMath.max(rawBoundsMinX, rawBoundsMaxX);
  const boundsMinY = NativeMath.min(rawBoundsMinY, rawBoundsMaxY);
  const boundsMaxY = NativeMath.max(rawBoundsMinY, rawBoundsMaxY);
  const regionMinX = NativeMath.min(startX, endX);
  const regionMaxX = NativeMath.max(startX, endX);
  const regionMinY = NativeMath.min(startY, endY);
  const regionMaxY = NativeMath.max(startY, endY);
  if (regionMaxX < boundsMinX || regionMinX > boundsMaxX || regionMaxY < boundsMinY || regionMinY > boundsMaxY) {
    return false;
  }

  const clippedMinX = NativeMath.max(regionMinX, boundsMinX);
  const clippedMaxX = NativeMath.min(regionMaxX, boundsMaxX);
  const clippedMinY = NativeMath.max(regionMinY, boundsMinY);
  const clippedMaxY = NativeMath.min(regionMaxY, boundsMaxY);
  const planeLength = <i32>getGraphwarPlaneLength();
  const planeHeight = <i32>getGraphwarPlaneHeight();
  const startPlaneX = <i32>NativeMath.floor(
    ((clippedMinX - rawBoundsMinX) / (rawBoundsMaxX - rawBoundsMinX)) * <f64>planeLength,
  );
  const endPlaneX = <i32>NativeMath.floor(
    ((clippedMaxX - rawBoundsMinX) / (rawBoundsMaxX - rawBoundsMinX)) * <f64>planeLength,
  );
  const startPlaneY = <i32>NativeMath.floor(
    ((rawBoundsMaxY - clippedMinY) / (rawBoundsMaxY - rawBoundsMinY)) * <f64>planeHeight,
  );
  const endPlaneY = <i32>NativeMath.floor(
    ((rawBoundsMaxY - clippedMaxY) / (rawBoundsMaxY - rawBoundsMinY)) * <f64>planeHeight,
  );
  const minX = clampPlaneIndex(startPlaneX < endPlaneX ? startPlaneX : endPlaneX, planeLength);
  const maxX = clampPlaneIndex(startPlaneX > endPlaneX ? startPlaneX : endPlaneX, planeLength);
  const minY = clampPlaneIndex(startPlaneY < endPlaneY ? startPlaneY : endPlaneY, planeHeight);
  const maxY = clampPlaneIndex(startPlaneY > endPlaneY ? startPlaneY : endPlaneY, planeHeight);
  let planeY = minY;
  while (planeY <= maxY) {
    const rowOffset = <u32>planeY * <u32>planeLength;
    let planeX = minX;
    while (planeX <= maxX) {
      if (load<u8>(maskPointer + rowOffset + <u32>planeX) != 0) {
        return true;
      }
      planeX += 1;
    }
    planeY += 1;
  }
  return false;
}

@inline
function clampPlaneIndex(value: i32, length: i32): i32 {
  return value < 0 ? 0 : value >= length ? length - 1 : value;
}
