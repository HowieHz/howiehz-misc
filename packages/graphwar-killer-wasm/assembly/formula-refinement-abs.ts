import { floorFormulaDecimal, quantizeFormulaCoefficient, roundFormulaDecimal } from "./decimal";
import { runCurveBatch } from "./formula-curves";
import {
  FORMULA_EQUATION_DDY,
  FORMULA_INPUT_ABS_PULSE_CENTER_X_POINTER_OFFSET,
  FORMULA_INPUT_ABS_PULSE_DELTA_SLOPE_POINTER_OFFSET,
  FORMULA_INPUT_BOUNDS_MAX_X_OFFSET,
  FORMULA_INPUT_BOUNDS_MAX_Y_OFFSET,
  FORMULA_INPUT_BOUNDS_MIN_X_OFFSET,
  FORMULA_INPUT_BOUNDS_MIN_Y_OFFSET,
  FORMULA_INPUT_DECIMAL_PLACES_OFFSET,
  FORMULA_INPUT_POINT_COUNT_OFFSET,
  FORMULA_INPUT_POINT_X_POINTER_OFFSET,
  FORMULA_INPUT_POINT_Y_POINTER_OFFSET,
  FORMULA_INPUT_QUALITY_TARGET_PLANE_PIXELS_OFFSET,
  FORMULA_INPUT_SEGMENT_START_X_POINTER_OFFSET,
  FORMULA_INPUT_SEGMENT_START_Y_POINTER_OFFSET,
  FORMULA_INPUT_SOLDIER_X_OFFSET,
  FORMULA_INPUT_STEEPNESS_OFFSET,
  FORMULA_LAUNCH_INVALID_REASON_ABS_SECOND_ORDER_PULSE_STEEPNESS_NON_POSITIVE,
  FORMULA_LAUNCH_INVALID_REASON_NONE,
  FORMULA_RESULT_PROTECTION_COUNT_OFFSET,
  FORMULA_RESULT_PROTECTION_POINTER_OFFSET,
} from "./formula-layout";
import {
  getGraphwarFuncMinXStepDistance,
  getGraphwarGameSoldierRadius,
  getGraphwarPlaneHeight,
  getGraphwarPlaneLength,
} from "./game-constants";
import { markArena, reserveArena, resetArena } from "./memory";
import {
  initializeTrajectoryScalarState,
  recordTrajectoryDebugScalarReplay,
  recordTrajectoryDebugScalarReplayPart,
  replayFormulaTrajectoryScalarToStopX,
  TRAJECTORY_SCALAR_RESULT_BYTE_LENGTH,
  TRAJECTORY_SCALAR_RESULT_STOP_REASON_OFFSET,
  TRAJECTORY_SCALAR_STATE_BYTE_LENGTH,
  TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET,
  TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET,
  TRAJECTORY_SCALAR_STATE_DY_OFFSET,
  TRAJECTORY_SCALAR_STOP_REASON_STOP_X,
} from "./trajectory-scalar";

/** Raw target-state record used by ABS second-derivative refinement. */
export const ABS_SECOND_DERIVATIVE_TARGET_STATE_X_OFFSET: u32 = 0;
export const ABS_SECOND_DERIVATIVE_TARGET_STATE_Y_OFFSET: u32 = 8;
export const ABS_SECOND_DERIVATIVE_TARGET_STATE_DY_OFFSET: u32 = 16;
export const ABS_SECOND_DERIVATIVE_TARGET_STATE_BYTE_LENGTH: u32 = 24;

/** Raw target-point record paired with one accepted target state. */
export const ABS_SECOND_DERIVATIVE_TARGET_X_OFFSET: u32 = 0;
export const ABS_SECOND_DERIVATIVE_TARGET_Y_OFFSET: u32 = 8;
export const ABS_SECOND_DERIVATIVE_TARGET_BYTE_LENGTH: u32 = 16;

/** Maximum derivative and position residuals for one complete candidate replay. */
export const ABS_SECOND_DERIVATIVE_QUALITY_DERIVATIVE_ERROR_OFFSET: u32 = 0;
export const ABS_SECOND_DERIVATIVE_QUALITY_POSITION_ERROR_OFFSET: u32 = 8;
export const ABS_SECOND_DERIVATIVE_QUALITY_BYTE_LENGTH: u32 = 16;

/** Bounds layout shared by the refinement sampler and terminal probe helper. */
export const ABS_SECOND_DERIVATIVE_BOUNDS_MIN_X_OFFSET: u32 = 0;
export const ABS_SECOND_DERIVATIVE_BOUNDS_MAX_X_OFFSET: u32 = 8;
export const ABS_SECOND_DERIVATIVE_BOUNDS_MIN_Y_OFFSET: u32 = 16;
export const ABS_SECOND_DERIVATIVE_BOUNDS_MAX_Y_OFFSET: u32 = 24;
export const ABS_SECOND_DERIVATIVE_BOUNDS_BYTE_LENGTH: u32 = 32;

/**
 * Atomic input for resolving one pulse.
 *
 * Horizontal and vertical budgets are already converted to graph units by the caller, so this pure closure does
 * not duplicate the configurable one-pixel quality target or plane geometry constants.
 */
export const ABS_SECOND_DERIVATIVE_PULSE_INPUT_WANTED_DELTA_SLOPE_OFFSET: u32 = 0;
export const ABS_SECOND_DERIVATIVE_PULSE_INPUT_ACCEPTED_X_OFFSET: u32 = 8;
export const ABS_SECOND_DERIVATIVE_PULSE_INPUT_CENTER_X_OFFSET: u32 = 16;
export const ABS_SECOND_DERIVATIVE_PULSE_INPUT_FORMULA_STEEPNESS_OFFSET: u32 = 24;
export const ABS_SECOND_DERIVATIVE_PULSE_INPUT_LAUNCH_X_OFFSET: u32 = 32;
export const ABS_SECOND_DERIVATIVE_PULSE_INPUT_START_X_OFFSET: u32 = 40;
export const ABS_SECOND_DERIVATIVE_PULSE_INPUT_TARGET_X_OFFSET: u32 = 48;
export const ABS_SECOND_DERIVATIVE_PULSE_INPUT_MINIMUM_HORIZONTAL_GRAPH_UNITS_OFFSET: u32 = 56;
export const ABS_SECOND_DERIVATIVE_PULSE_INPUT_POSITION_TARGET_GRAPH_UNITS_OFFSET: u32 = 64;
export const ABS_SECOND_DERIVATIVE_PULSE_INPUT_DECIMAL_PLACES_OFFSET: u32 = 72;
export const ABS_SECOND_DERIVATIVE_PULSE_INPUT_FLAGS_OFFSET: u32 = 76;
export const ABS_SECOND_DERIVATIVE_PULSE_INPUT_BYTE_LENGTH: u32 = 80;
export const ABS_SECOND_DERIVATIVE_PULSE_INPUT_FLAG_HAS_CENTER_X: u32 = 1;

/** Resolved pulse center and slope change must always be consumed as one state. */
export const ABS_SECOND_DERIVATIVE_PULSE_RESULT_CENTER_X_OFFSET: u32 = 0;
export const ABS_SECOND_DERIVATIVE_PULSE_RESULT_DELTA_SLOPE_OFFSET: u32 = 8;
export const ABS_SECOND_DERIVATIVE_PULSE_RESULT_BYTE_LENGTH: u32 = 16;

@inline
function trap(): void {
  unreachable();
}

@inline
function isFiniteValue(value: f64): bool {
  return value == value && value != f64.POSITIVE_INFINITY && value != f64.NEGATIVE_INFINITY;
}

/** Uses the next original target to define the polyline right derivative; the terminal target remains horizontal. */
export function calculateAbsSecondDerivativeTargetDy(
  stateX: f64,
  stateY: f64,
  hasNextTarget: bool,
  nextTargetX: f64,
  nextTargetY: f64,
  minimumXStep: f64,
): f64 {
  return hasNextTarget
    ? (nextTargetY - stateY) / NativeMath.max(nextTargetX - stateX, minimumXStep)
    : 0;
}

/** Writes the maximum right-derivative and vertical plane-pixel errors from one complete accepted-state sweep. */
export function writeAbsSecondDerivativeLandingQuality(
  targetStatePointer: u32,
  targetPointer: u32,
  targetCount: u32,
  minimumXStep: f64,
  planeHeight: f64,
  boundsMinY: f64,
  boundsMaxY: f64,
  resultPointer: u32,
): void {
  let derivativeError = 0.0;
  let positionErrorPlanePixels = 0.0;
  let targetIndex: u32 = 0;
  while (targetIndex < targetCount) {
    const statePointer = targetStatePointer + targetIndex * ABS_SECOND_DERIVATIVE_TARGET_STATE_BYTE_LENGTH;
    const pointPointer = targetPointer + targetIndex * ABS_SECOND_DERIVATIVE_TARGET_BYTE_LENGTH;
    const stateX = load<f64>(statePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_X_OFFSET);
    const stateY = load<f64>(statePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_Y_OFFSET);
    const stateDy = load<f64>(statePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_DY_OFFSET);
    const hasNextTarget = targetIndex + 1 < targetCount;
    let nextTargetX = 0.0;
    let nextTargetY = 0.0;
    if (hasNextTarget) {
      const nextPointer = pointPointer + ABS_SECOND_DERIVATIVE_TARGET_BYTE_LENGTH;
      nextTargetX = load<f64>(nextPointer + ABS_SECOND_DERIVATIVE_TARGET_X_OFFSET);
      nextTargetY = load<f64>(nextPointer + ABS_SECOND_DERIVATIVE_TARGET_Y_OFFSET);
    }
    derivativeError = NativeMath.max(
      derivativeError,
      NativeMath.abs(
        stateDy -
          calculateAbsSecondDerivativeTargetDy(
            stateX,
            stateY,
            hasNextTarget,
            nextTargetX,
            nextTargetY,
            minimumXStep,
          ),
      ),
    );
    positionErrorPlanePixels = NativeMath.max(
      positionErrorPlanePixels,
      (NativeMath.abs(stateY - load<f64>(pointPointer + ABS_SECOND_DERIVATIVE_TARGET_Y_OFFSET)) * planeHeight) /
        NativeMath.abs(boundsMaxY - boundsMinY),
    );
    targetIndex += 1;
  }
  store<f64>(resultPointer + ABS_SECOND_DERIVATIVE_QUALITY_DERIVATIVE_ERROR_OFFSET, derivativeError);
  store<f64>(resultPointer + ABS_SECOND_DERIVATIVE_QUALITY_POSITION_ERROR_OFFSET, positionErrorPlanePixels);
}

/** Preserves the existing one-pixel quality layering and optional terminal-derivative tie-break. */
export function isSecondOrderLandingQualityBetter(
  candidatePointer: u32,
  bestPointer: u32,
  hasBest: bool,
  positionTargetPlanePixels: f64,
  candidateDerivativeTieBreaker: f64,
  bestDerivativeTieBreaker: f64,
  hasDerivativeTieBreakers: bool,
): bool {
  if (!hasBest) {
    return true;
  }
  const candidatePositionError = load<f64>(
    candidatePointer + ABS_SECOND_DERIVATIVE_QUALITY_POSITION_ERROR_OFFSET,
  );
  const bestPositionError = load<f64>(bestPointer + ABS_SECOND_DERIVATIVE_QUALITY_POSITION_ERROR_OFFSET);
  const candidateWithinTarget = candidatePositionError <= positionTargetPlanePixels;
  const bestWithinTarget = bestPositionError <= positionTargetPlanePixels;
  if (candidateWithinTarget != bestWithinTarget) {
    return candidateWithinTarget;
  }
  if (!candidateWithinTarget && candidatePositionError != bestPositionError) {
    return candidatePositionError < bestPositionError;
  }
  const candidateDerivativeError = load<f64>(
    candidatePointer + ABS_SECOND_DERIVATIVE_QUALITY_DERIVATIVE_ERROR_OFFSET,
  );
  const bestDerivativeError = load<f64>(bestPointer + ABS_SECOND_DERIVATIVE_QUALITY_DERIVATIVE_ERROR_OFFSET);
  if (candidateDerivativeError != bestDerivativeError) {
    return candidateDerivativeError < bestDerivativeError;
  }
  if (hasDerivativeTieBreakers && candidateDerivativeTieBreaker != bestDerivativeTieBreaker) {
    return candidateDerivativeTieBreaker < bestDerivativeTieBreaker;
  }
  return candidatePositionError < bestPositionError;
}

/** Uses two real replay states to estimate the parameter whose sampled residual is zero. */
export function calculateSecantZero(x: f64, y: f64, otherX: f64, otherY: f64): f64 {
  return x - (y * (x - otherX)) / (y - otherY);
}

/** Stable sigmoid progress obtained after integrating one ABS second-derivative pulse. */
export function evaluateAbsSecondDerivativePulseProgress(x: f64, centerX: f64, formulaSteepness: f64): f64 {
  const argument = formulaSteepness * (x - centerX);
  if (argument >= 0) {
    return 1 / (1 + NativeMath.exp(-argument));
  }
  const exponential = NativeMath.exp(argument);
  return exponential / (1 + exponential);
}

/** Returns the finite positive share of a fixed-center pulse delivered between launch and an accepted state. */
export function calculateAbsSecondDerivativePulseResponse(
  launchX: f64,
  targetX: f64,
  centerX: f64,
  formulaSteepness: f64,
): f64 {
  const response =
    evaluateAbsSecondDerivativePulseProgress(targetX, centerX, formulaSteepness) -
    evaluateAbsSecondDerivativePulseProgress(launchX, centerX, formulaSteepness);
  return response > 0 && isFiniteValue(response) ? response : f64.NaN;
}

@inline
function evaluateAbsSecondDerivativeSoftplus(value: f64): f64 {
  return value >= 0
    ? value + NativeMath.log1p(NativeMath.exp(-value))
    : NativeMath.log1p(NativeMath.exp(value));
}

/** Returns the vertical displacement delivered by one unit slope pulse from launch to an accepted state. */
export function calculateAbsSecondDerivativePulseDisplacementResponse(
  launchX: f64,
  targetX: f64,
  centerX: f64,
  formulaSteepness: f64,
): f64 {
  const launchArgument = formulaSteepness * (launchX - centerX);
  const targetArgument = formulaSteepness * (targetX - centerX);
  return (
    (evaluateAbsSecondDerivativeSoftplus(targetArgument) -
      evaluateAbsSecondDerivativeSoftplus(launchArgument)) /
      formulaSteepness -
    evaluateAbsSecondDerivativePulseProgress(launchX, centerX, formulaSteepness) * (targetX - launchX)
  );
}

/** Keeps the real x bounds while allowing a terminal braking probe to recover from any temporary y excursion. */
export function writeAbsSecondDerivativeTerminalProbeBounds(boundsPointer: u32, resultPointer: u32): void {
  store<f64>(
    resultPointer + ABS_SECOND_DERIVATIVE_BOUNDS_MIN_X_OFFSET,
    load<f64>(boundsPointer + ABS_SECOND_DERIVATIVE_BOUNDS_MIN_X_OFFSET),
  );
  store<f64>(
    resultPointer + ABS_SECOND_DERIVATIVE_BOUNDS_MAX_X_OFFSET,
    load<f64>(boundsPointer + ABS_SECOND_DERIVATIVE_BOUNDS_MAX_X_OFFSET),
  );
  store<f64>(resultPointer + ABS_SECOND_DERIVATIVE_BOUNDS_MIN_Y_OFFSET, f64.NEGATIVE_INFINITY);
  store<f64>(resultPointer + ABS_SECOND_DERIVATIVE_BOUNDS_MAX_Y_OFFSET, f64.POSITIVE_INFINITY);
}

/** Resolves one pulse center/amplitude pair without separating the evidence that makes either field usable. */
export function resolveAbsSecondDerivativePulse(inputPointer: u32, resultPointer: u32): void {
  const flags = load<u32>(inputPointer + ABS_SECOND_DERIVATIVE_PULSE_INPUT_FLAGS_OFFSET);
  if ((flags & ~ABS_SECOND_DERIVATIVE_PULSE_INPUT_FLAG_HAS_CENTER_X) != 0) {
    trap();
  }
  const wantedDeltaSlope = load<f64>(
    inputPointer + ABS_SECOND_DERIVATIVE_PULSE_INPUT_WANTED_DELTA_SLOPE_OFFSET,
  );
  const acceptedX = load<f64>(inputPointer + ABS_SECOND_DERIVATIVE_PULSE_INPUT_ACCEPTED_X_OFFSET);
  const formulaSteepness = load<f64>(
    inputPointer + ABS_SECOND_DERIVATIVE_PULSE_INPUT_FORMULA_STEEPNESS_OFFSET,
  );
  const launchX = load<f64>(inputPointer + ABS_SECOND_DERIVATIVE_PULSE_INPUT_LAUNCH_X_OFFSET);
  if ((flags & ABS_SECOND_DERIVATIVE_PULSE_INPUT_FLAG_HAS_CENTER_X) != 0) {
    const centerX = load<f64>(inputPointer + ABS_SECOND_DERIVATIVE_PULSE_INPUT_CENTER_X_OFFSET);
    store<f64>(resultPointer + ABS_SECOND_DERIVATIVE_PULSE_RESULT_CENTER_X_OFFSET, centerX);
    store<f64>(
      resultPointer + ABS_SECOND_DERIVATIVE_PULSE_RESULT_DELTA_SLOPE_OFFSET,
      wantedDeltaSlope /
        calculateAbsSecondDerivativePulseResponse(launchX, acceptedX, centerX, formulaSteepness),
    );
    return;
  }

  const decimalPlaces = load<i32>(inputPointer + ABS_SECOND_DERIVATIVE_PULSE_INPUT_DECIMAL_PLACES_OFFSET);
  const targetX = load<f64>(inputPointer + ABS_SECOND_DERIVATIVE_PULSE_INPUT_TARGET_X_OFFSET);
  let centerX = floorFormulaDecimal(targetX, decimalPlaces);
  let deltaSlope = wantedDeltaSlope;
  const maximumCenterOffset = NativeMath.max(
    0,
    targetX -
      load<f64>(inputPointer + ABS_SECOND_DERIVATIVE_PULSE_INPUT_START_X_OFFSET) -
      load<f64>(inputPointer + ABS_SECOND_DERIVATIVE_PULSE_INPUT_MINIMUM_HORIZONTAL_GRAPH_UNITS_OFFSET),
  );
  const scaledPositionBudget =
    formulaSteepness *
    load<f64>(inputPointer + ABS_SECOND_DERIVATIVE_PULSE_INPUT_POSITION_TARGET_GRAPH_UNITS_OFFSET);
  let transition = 0;
  while (transition < 2) {
    const absoluteDeltaSlope = NativeMath.abs(deltaSlope);
    centerX = floorFormulaDecimal(
      targetX -
        (absoluteDeltaSlope > 0 && isFiniteValue(absoluteDeltaSlope)
          ? NativeMath.min(
              maximumCenterOffset,
              NativeMath.max(
                0,
                NativeMath.log(NativeMath.expm1(scaledPositionBudget / absoluteDeltaSlope)) / formulaSteepness,
              ),
            )
          : 0),
      decimalPlaces,
    );
    if (!(centerX < targetX)) {
      store<f64>(resultPointer + ABS_SECOND_DERIVATIVE_PULSE_RESULT_CENTER_X_OFFSET, centerX);
      store<f64>(
        resultPointer + ABS_SECOND_DERIVATIVE_PULSE_RESULT_DELTA_SLOPE_OFFSET,
        wantedDeltaSlope,
      );
      return;
    }
    deltaSlope =
      wantedDeltaSlope /
      calculateAbsSecondDerivativePulseResponse(launchX, acceptedX, centerX, formulaSteepness);
    transition += 1;
  }
  store<f64>(resultPointer + ABS_SECOND_DERIVATIVE_PULSE_RESULT_CENTER_X_OFFSET, centerX);
  store<f64>(resultPointer + ABS_SECOND_DERIVATIVE_PULSE_RESULT_DELTA_SLOPE_OFFSET, deltaSlope);
}

const ABS_SECOND_DERIVATIVE_MAX_REFINEMENT_ITERATIONS: u32 = 100;
const SECOND_ORDER_POSITION_CORRECTION_TARGET_FACTOR: f64 = 0.9;

@inline
function checkedByteLength(count: u32, stride: u32): u32 {
  const byteLength = <u64>count * stride;
  if (byteLength > 0xffff_ffff) {
    trap();
  }
  return <u32>byteLength;
}

@inline
function checkedAddByteLength(left: u32, right: u32): u32 {
  const byteLength = <u64>left + right;
  if (byteLength > 0xffff_ffff) {
    trap();
  }
  return <u32>byteLength;
}

@inline
function normalizeZero(value: f64): f64 {
  return value == 0 ? 0 : value;
}

@inline
function signValue(value: f64): f64 {
  return value < 0 ? -1 : value > 0 ? 1 : value;
}

function fillF64(pointer: u32, count: u32, value: f64): void {
  let index: u32 = 0;
  while (index < count) {
    store<f64>(pointer + index * sizeof<f64>(), value);
    index += 1;
  }
}

@inline
function copyF64Values(targetPointer: u32, sourcePointer: u32, count: u32): void {
  memory.copy(targetPointer, sourcePointer, checkedByteLength(count, sizeof<f64>()));
}

@inline
function copyTargetStates(targetPointer: u32, sourcePointer: u32, count: u32): void {
  memory.copy(
    targetPointer,
    sourcePointer,
    checkedByteLength(count, ABS_SECOND_DERIVATIVE_TARGET_STATE_BYTE_LENGTH),
  );
}

@inline
function copyQuality(targetPointer: u32, sourcePointer: u32): void {
  memory.copy(targetPointer, sourcePointer, ABS_SECOND_DERIVATIVE_QUALITY_BYTE_LENGTH);
}

@inline
function isQualityFinite(pointer: u32): bool {
  return (
    isFiniteValue(load<f64>(pointer + ABS_SECOND_DERIVATIVE_QUALITY_DERIVATIVE_ERROR_OFFSET)) &&
    isFiniteValue(load<f64>(pointer + ABS_SECOND_DERIVATIVE_QUALITY_POSITION_ERROR_OFFSET))
  );
}

/** Installs the current raw pulse state into the internal material-build descriptor. */
function setAbsSecondDerivativePulseState(
  buildInputPointer: u32,
  pulseDeltaSlopePointer: u32,
  pulseCenterXPointer: u32,
): void {
  store<u32>(
    buildInputPointer + FORMULA_INPUT_ABS_PULSE_DELTA_SLOPE_POINTER_OFFSET,
    pulseDeltaSlopePointer,
  );
  store<u32>(
    buildInputPointer + FORMULA_INPUT_ABS_PULSE_CENTER_X_POINTER_OFFSET,
    pulseCenterXPointer,
  );
}

/** Redirects nested material snapshots into the caller-owned complete-attempt protection evidence. */
function shareObservedProtection(resultPointer: u32, observedProtectionPointer: u32, segmentCount: u32): void {
  const sourcePointer = load<u32>(resultPointer + FORMULA_RESULT_PROTECTION_POINTER_OFFSET);
  if (load<u32>(resultPointer + FORMULA_RESULT_PROTECTION_COUNT_OFFSET) != segmentCount) {
    trap();
  }
  let segmentIndex: u32 = 0;
  while (segmentIndex < segmentCount) {
    const destinationPointer = observedProtectionPointer + segmentIndex * sizeof<u32>();
    store<u32>(
      destinationPointer,
      load<u32>(destinationPointer) | load<u32>(sourcePointer + segmentIndex * sizeof<u32>()),
    );
    segmentIndex += 1;
  }
  store<u32>(resultPointer + FORMULA_RESULT_PROTECTION_POINTER_OFFSET, observedProtectionPointer);
}

/** Replays one complete pulse state to a single stop x and writes the accepted x/y/y' state. */
function writeAbsSecondDerivativePrefixState(
  buildInputPointer: u32,
  pulseDeltaSlopePointer: u32,
  pulseCenterXPointer: u32,
  launchX: f64,
  launchY: f64,
  launchDy: f64,
  baseY: f64,
  boundsMinX: f64,
  boundsMaxX: f64,
  boundsMinY: f64,
  boundsMaxY: f64,
  stopX: f64,
  protectionPointer: u32,
  observedProtectionPointer: u32,
  outputStatePointer: u32,
): bool {
  const replayMark = markArena();
  setAbsSecondDerivativePulseState(buildInputPointer, pulseDeltaSlopePointer, pulseCenterXPointer);
  const materialResultPointer = runCurveBatch(buildInputPointer);
  shareObservedProtection(
    materialResultPointer,
    observedProtectionPointer,
    load<u32>(buildInputPointer + FORMULA_INPUT_POINT_COUNT_OFFSET) - 1,
  );
  const statePointer = reserveArena(TRAJECTORY_SCALAR_STATE_BYTE_LENGTH, sizeof<f64>());
  const resultPointer = reserveArena(TRAJECTORY_SCALAR_RESULT_BYTE_LENGTH, sizeof<f64>());
  initializeTrajectoryScalarState(
    statePointer,
    FORMULA_EQUATION_DDY,
    launchX,
    launchY,
    launchDy,
    0,
    0,
    0,
    0,
    false,
  );
  replayFormulaTrajectoryScalarToStopX(
    materialResultPointer,
    FORMULA_EQUATION_DDY,
    baseY,
    0,
    boundsMinX,
    boundsMaxX,
    boundsMinY,
    boundsMaxY,
    stopX,
    protectionPointer,
    statePointer,
    resultPointer,
    false,
  );
  recordTrajectoryDebugScalarReplay(resultPointer);
  const isStopped =
    load<i32>(resultPointer + TRAJECTORY_SCALAR_RESULT_STOP_REASON_OFFSET) ==
    TRAJECTORY_SCALAR_STOP_REASON_STOP_X;
  if (isStopped) {
    store<f64>(
      outputStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_X_OFFSET,
      load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET),
    );
    store<f64>(
      outputStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_Y_OFFSET,
      load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET),
    );
    store<f64>(
      outputStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_DY_OFFSET,
      load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_DY_OFFSET),
    );
  }
  resetArena(replayMark);
  return isStopped;
}

/** Replays once and records the first accepted state at or beyond every ordered target x. */
function writeAbsSecondDerivativeTargetStates(
  buildInputPointer: u32,
  pulseDeltaSlopePointer: u32,
  pulseCenterXPointer: u32,
  targetPointPointer: u32,
  targetCount: u32,
  launchX: f64,
  launchY: f64,
  launchDy: f64,
  baseY: f64,
  boundsMinX: f64,
  boundsMaxX: f64,
  boundsMinY: f64,
  boundsMaxY: f64,
  protectionPointer: u32,
  observedProtectionPointer: u32,
  outputStatePointer: u32,
): bool {
  const replayMark = markArena();
  setAbsSecondDerivativePulseState(buildInputPointer, pulseDeltaSlopePointer, pulseCenterXPointer);
  const materialResultPointer = runCurveBatch(buildInputPointer);
  shareObservedProtection(materialResultPointer, observedProtectionPointer, targetCount);
  const statePointer = reserveArena(TRAJECTORY_SCALAR_STATE_BYTE_LENGTH, sizeof<f64>());
  const resultPointer = reserveArena(TRAJECTORY_SCALAR_RESULT_BYTE_LENGTH, sizeof<f64>());
  initializeTrajectoryScalarState(
    statePointer,
    FORMULA_EQUATION_DDY,
    launchX,
    launchY,
    launchDy,
    0,
    0,
    0,
    0,
    false,
  );

  let targetIndex: u32 = 0;
  while (targetIndex < targetCount) {
    replayFormulaTrajectoryScalarToStopX(
      materialResultPointer,
      FORMULA_EQUATION_DDY,
      baseY,
      0,
      boundsMinX,
      boundsMaxX,
      boundsMinY,
      boundsMaxY,
      load<f64>(
        targetPointPointer +
          targetIndex * ABS_SECOND_DERIVATIVE_TARGET_BYTE_LENGTH +
          ABS_SECOND_DERIVATIVE_TARGET_X_OFFSET,
      ),
      protectionPointer,
      statePointer,
      resultPointer,
      false,
    );
    recordTrajectoryDebugScalarReplayPart(resultPointer, targetIndex == 0);
    if (
      load<i32>(resultPointer + TRAJECTORY_SCALAR_RESULT_STOP_REASON_OFFSET) !=
      TRAJECTORY_SCALAR_STOP_REASON_STOP_X
    ) {
      resetArena(replayMark);
      return false;
    }
    const targetStatePointer =
      outputStatePointer + targetIndex * ABS_SECOND_DERIVATIVE_TARGET_STATE_BYTE_LENGTH;
    const stateX = load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET);
    const stateY = load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET);
    const stateDy = load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_DY_OFFSET);
    if (!isFiniteValue(stateX) || !isFiniteValue(stateY) || !isFiniteValue(stateDy)) {
      resetArena(replayMark);
      return false;
    }
    store<f64>(targetStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_X_OFFSET, stateX);
    store<f64>(targetStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_Y_OFFSET, stateY);
    store<f64>(targetStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_DY_OFFSET, stateDy);
    targetIndex += 1;
  }
  resetArena(replayMark);
  return true;
}

/** Resolves one optional-center pulse into caller-owned scalar slots. */
function writeResolvedPulse(
  pulseInputPointer: u32,
  pulseResultPointer: u32,
  wantedDeltaSlope: f64,
  acceptedX: f64,
  centerX: f64,
  hasCenterX: bool,
  formulaSteepness: f64,
  launchX: f64,
  startX: f64,
  targetX: f64,
  minimumHorizontalGraphUnits: f64,
  positionTargetGraphUnits: f64,
  decimalPlaces: i32,
  outputCenterPointer: u32,
  outputDeltaSlopePointer: u32,
): bool {
  store<f64>(
    pulseInputPointer + ABS_SECOND_DERIVATIVE_PULSE_INPUT_WANTED_DELTA_SLOPE_OFFSET,
    wantedDeltaSlope,
  );
  store<f64>(pulseInputPointer + ABS_SECOND_DERIVATIVE_PULSE_INPUT_ACCEPTED_X_OFFSET, acceptedX);
  store<f64>(pulseInputPointer + ABS_SECOND_DERIVATIVE_PULSE_INPUT_CENTER_X_OFFSET, centerX);
  store<f64>(
    pulseInputPointer + ABS_SECOND_DERIVATIVE_PULSE_INPUT_FORMULA_STEEPNESS_OFFSET,
    formulaSteepness,
  );
  store<f64>(pulseInputPointer + ABS_SECOND_DERIVATIVE_PULSE_INPUT_LAUNCH_X_OFFSET, launchX);
  store<f64>(pulseInputPointer + ABS_SECOND_DERIVATIVE_PULSE_INPUT_START_X_OFFSET, startX);
  store<f64>(pulseInputPointer + ABS_SECOND_DERIVATIVE_PULSE_INPUT_TARGET_X_OFFSET, targetX);
  store<f64>(
    pulseInputPointer + ABS_SECOND_DERIVATIVE_PULSE_INPUT_MINIMUM_HORIZONTAL_GRAPH_UNITS_OFFSET,
    minimumHorizontalGraphUnits,
  );
  store<f64>(
    pulseInputPointer + ABS_SECOND_DERIVATIVE_PULSE_INPUT_POSITION_TARGET_GRAPH_UNITS_OFFSET,
    positionTargetGraphUnits,
  );
  store<i32>(pulseInputPointer + ABS_SECOND_DERIVATIVE_PULSE_INPUT_DECIMAL_PLACES_OFFSET, decimalPlaces);
  store<u32>(
    pulseInputPointer + ABS_SECOND_DERIVATIVE_PULSE_INPUT_FLAGS_OFFSET,
    hasCenterX ? ABS_SECOND_DERIVATIVE_PULSE_INPUT_FLAG_HAS_CENTER_X : 0,
  );
  resolveAbsSecondDerivativePulse(pulseInputPointer, pulseResultPointer);
  const resolvedCenterX = load<f64>(
    pulseResultPointer + ABS_SECOND_DERIVATIVE_PULSE_RESULT_CENTER_X_OFFSET,
  );
  const resolvedDeltaSlope = load<f64>(
    pulseResultPointer + ABS_SECOND_DERIVATIVE_PULSE_RESULT_DELTA_SLOPE_OFFSET,
  );
  if (!isFiniteValue(resolvedCenterX) || !isFiniteValue(resolvedDeltaSlope)) {
    return false;
  }
  store<f64>(outputCenterPointer, resolvedCenterX);
  store<f64>(outputDeltaSlopePointer, resolvedDeltaSlope);
  return true;
}

/** Removes the terminal pulse, replays the true incoming state, then atomically restores one resolved pulse. */
function resolveTerminalPulse(
  buildInputPointer: u32,
  pulseDeltaSlopePointer: u32,
  pulseCenterXPointer: u32,
  segmentCount: u32,
  formulaPointXPointer: u32,
  originalPointXPointer: u32,
  launchX: f64,
  launchY: f64,
  launchDy: f64,
  baseY: f64,
  boundsMinX: f64,
  boundsMaxX: f64,
  formulaSteepness: f64,
  minimumHorizontalGraphUnits: f64,
  positionTargetGraphUnits: f64,
  decimalPlaces: i32,
  protectionPointer: u32,
  observedProtectionPointer: u32,
  pulseInputPointer: u32,
  pulseResultPointer: u32,
  scratchStatePointer: u32,
): bool {
  const terminalPulseIndex = segmentCount - 1;
  const terminalSlopePointer = pulseDeltaSlopePointer + terminalPulseIndex * sizeof<f64>();
  const terminalCenterPointer = pulseCenterXPointer + terminalPulseIndex * sizeof<f64>();
  store<f64>(terminalSlopePointer, f64.NaN);
  const finalX = load<f64>(formulaPointXPointer + segmentCount * sizeof<f64>());
  if (
    !writeAbsSecondDerivativePrefixState(
      buildInputPointer,
      pulseDeltaSlopePointer,
      pulseCenterXPointer,
      launchX,
      launchY,
      launchDy,
      baseY,
      boundsMinX,
      boundsMaxX,
      f64.NEGATIVE_INFINITY,
      f64.POSITIVE_INFINITY,
      finalX,
      protectionPointer,
      observedProtectionPointer,
      scratchStatePointer,
    )
  ) {
    return false;
  }
  const centerX = load<f64>(terminalCenterPointer);
  return writeResolvedPulse(
    pulseInputPointer,
    pulseResultPointer,
    -load<f64>(scratchStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_DY_OFFSET),
    load<f64>(scratchStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_X_OFFSET),
    centerX,
    centerX == centerX,
    formulaSteepness,
    launchX,
    load<f64>(originalPointXPointer + terminalPulseIndex * sizeof<f64>()),
    finalX,
    minimumHorizontalGraphUnits,
    positionTargetGraphUnits,
    decimalPlaces,
    terminalCenterPointer,
    terminalSlopePointer,
  );
}

/** Uses normalized raw f64 identities to match the TypeScript Set<string> execution-state cycle break. */
function hasVisitedPulseState(
  visitedPointer: u32,
  visitedCount: u32,
  snapshotStride: u32,
  coefficientPointer: u32,
  centerPointer: u32,
  segmentCount: u32,
  launchAngle: f64,
): bool {
  let visitedIndex: u32 = 0;
  while (visitedIndex < visitedCount) {
    const candidatePointer = visitedPointer + visitedIndex * snapshotStride;
    let stateIndex: u32 = 0;
    let isEqual = true;
    while (stateIndex < segmentCount) {
      if (
        load<u64>(candidatePointer + stateIndex * sizeof<u64>()) !=
        reinterpret<u64>(normalizeZero(load<f64>(coefficientPointer + stateIndex * sizeof<f64>())))
      ) {
        isEqual = false;
        break;
      }
      stateIndex += 1;
    }
    stateIndex = 0;
    while (isEqual && stateIndex < segmentCount) {
      if (
        load<u64>(candidatePointer + (segmentCount + stateIndex) * sizeof<u64>()) !=
        reinterpret<u64>(normalizeZero(load<f64>(centerPointer + stateIndex * sizeof<f64>())))
      ) {
        isEqual = false;
        break;
      }
      stateIndex += 1;
    }
    if (
      isEqual &&
      load<u64>(candidatePointer + 2 * segmentCount * sizeof<u64>()) ==
        reinterpret<u64>(normalizeZero(launchAngle))
    ) {
      return true;
    }
    visitedIndex += 1;
  }
  return false;
}

function writeVisitedPulseState(
  pointer: u32,
  coefficientPointer: u32,
  centerPointer: u32,
  segmentCount: u32,
  launchAngle: f64,
): void {
  let index: u32 = 0;
  while (index < segmentCount) {
    store<u64>(
      pointer + index * sizeof<u64>(),
      reinterpret<u64>(normalizeZero(load<f64>(coefficientPointer + index * sizeof<f64>()))),
    );
    store<u64>(
      pointer + (segmentCount + index) * sizeof<u64>(),
      reinterpret<u64>(normalizeZero(load<f64>(centerPointer + index * sizeof<f64>()))),
    );
    index += 1;
  }
  store<u64>(pointer + 2 * segmentCount * sizeof<u64>(), reinterpret<u64>(normalizeZero(launchAngle)));
}

function hasVisitedCoefficient(pointer: u32, count: u32, coefficient: f64): bool {
  const coefficientBits = reinterpret<u64>(normalizeZero(coefficient));
  let index: u32 = 0;
  while (index < count) {
    if (load<u64>(pointer + index * sizeof<u64>()) == coefficientBits) {
      return true;
    }
    index += 1;
  }
  return false;
}

/**
 * Runs the production ABS y'' cold refinement from the canonical raw path descriptor.
 *
 * The caller owns all output arrays. NaN represents an internal missing pulse/segment slot only while the state is
 * incomplete; success guarantees every pulse center/slope is finite and the final segment starts come from one
 * complete replay. Candidate materials and trajectories remain under nested arena marks and never escape.
 */
export function refineAbsSecondDerivativeLaunch(
  inputPointer: u32,
  buildInputPointer: u32,
  formulaPointXPointer: u32,
  formulaPointYPointer: u32,
  launchAngle: f64,
  protectionPointer: u32,
  observedProtectionPointer: u32,
  pulseDeltaSlopePointer: u32,
  pulseCenterXPointer: u32,
  segmentStartXPointer: u32,
  segmentStartYPointer: u32,
  invalidReasonPointer: u32,
): bool {
  store<u32>(invalidReasonPointer, FORMULA_LAUNCH_INVALID_REASON_NONE);
  const pointCount = load<u32>(inputPointer + FORMULA_INPUT_POINT_COUNT_OFFSET);
  const segmentCount = pointCount - 1;
  const decimalPlaces = load<i32>(inputPointer + FORMULA_INPUT_DECIMAL_PLACES_OFFSET);
  const originalPointXPointer = load<u32>(inputPointer + FORMULA_INPUT_POINT_X_POINTER_OFFSET);
  const originalPointYPointer = load<u32>(inputPointer + FORMULA_INPUT_POINT_Y_POINTER_OFFSET);
  const formulaSteepness = roundFormulaDecimal(
    load<f64>(inputPointer + FORMULA_INPUT_STEEPNESS_OFFSET),
    decimalPlaces,
  );
  if (!(formulaSteepness > 0) || !isFiniteValue(launchAngle)) {
    if (!(formulaSteepness > 0)) {
      store<u32>(
        invalidReasonPointer,
        FORMULA_LAUNCH_INVALID_REASON_ABS_SECOND_ORDER_PULSE_STEEPNESS_NON_POSITIVE,
      );
    }
    return false;
  }
  const boundsMinX = load<f64>(inputPointer + FORMULA_INPUT_BOUNDS_MIN_X_OFFSET);
  const boundsMaxX = load<f64>(inputPointer + FORMULA_INPUT_BOUNDS_MAX_X_OFFSET);
  const boundsMinY = load<f64>(inputPointer + FORMULA_INPUT_BOUNDS_MIN_Y_OFFSET);
  const boundsMaxY = load<f64>(inputPointer + FORMULA_INPUT_BOUNDS_MAX_Y_OFFSET);
  const qualityTargetPlanePixels = load<f64>(
    inputPointer + FORMULA_INPUT_QUALITY_TARGET_PLANE_PIXELS_OFFSET,
  );
  const minimumHorizontalGraphUnits =
    NativeMath.abs(boundsMaxX - boundsMinX) / getGraphwarPlaneLength();
  const positionTargetGraphUnits =
    (qualityTargetPlanePixels * NativeMath.abs(boundsMaxY - boundsMinY)) / getGraphwarPlaneHeight();
  const launchX = load<f64>(formulaPointXPointer);
  const launchY = load<f64>(formulaPointYPointer);
  const launchDy = NativeMath.tan(launchAngle);
  const baseY = launchY;
  const pulseByteLength = checkedByteLength(segmentCount, sizeof<f64>());
  const targetStateByteLength = checkedByteLength(
    segmentCount,
    ABS_SECOND_DERIVATIVE_TARGET_STATE_BYTE_LENGTH,
  );
  const targetPointByteLength = checkedByteLength(
    segmentCount,
    ABS_SECOND_DERIVATIVE_TARGET_BYTE_LENGTH,
  );
  fillF64(pulseDeltaSlopePointer, segmentCount, f64.NaN);
  fillF64(pulseCenterXPointer, segmentCount, f64.NaN);
  fillF64(segmentStartXPointer, pointCount, f64.NaN);
  fillF64(segmentStartYPointer, pointCount, f64.NaN);

  const targetPointPointer = reserveArena(targetPointByteLength, sizeof<f64>());
  let targetIndex: u32 = 0;
  while (targetIndex < segmentCount) {
    store<f64>(
      targetPointPointer +
        targetIndex * ABS_SECOND_DERIVATIVE_TARGET_BYTE_LENGTH +
        ABS_SECOND_DERIVATIVE_TARGET_X_OFFSET,
      load<f64>(originalPointXPointer + (targetIndex + 1) * sizeof<f64>()),
    );
    store<f64>(
      targetPointPointer +
        targetIndex * ABS_SECOND_DERIVATIVE_TARGET_BYTE_LENGTH +
        ABS_SECOND_DERIVATIVE_TARGET_Y_OFFSET,
      load<f64>(originalPointYPointer + (targetIndex + 1) * sizeof<f64>()),
    );
    targetIndex += 1;
  }

  const shiftedDeltaSlopePointer = reserveArena(pulseByteLength, sizeof<f64>());
  const shiftedCenterXPointer = reserveArena(pulseByteLength, sizeof<f64>());
  fillF64(shiftedDeltaSlopePointer, segmentCount, f64.NaN);
  fillF64(shiftedCenterXPointer, segmentCount, f64.NaN);
  const currentTargetStatePointer = reserveArena(targetStateByteLength, sizeof<f64>());
  const bestTargetStatePointer = reserveArena(targetStateByteLength, sizeof<f64>());
  const fallbackTargetStatePointer = reserveArena(targetStateByteLength, sizeof<f64>());
  const unbrakedTargetStatePointer = reserveArena(targetStateByteLength, sizeof<f64>());
  const currentQualityPointer = reserveArena(ABS_SECOND_DERIVATIVE_QUALITY_BYTE_LENGTH, sizeof<f64>());
  const bestQualityPointer = reserveArena(ABS_SECOND_DERIVATIVE_QUALITY_BYTE_LENGTH, sizeof<f64>());
  const fallbackQualityPointer = reserveArena(ABS_SECOND_DERIVATIVE_QUALITY_BYTE_LENGTH, sizeof<f64>());
  const unbrakedQualityPointer = reserveArena(ABS_SECOND_DERIVATIVE_QUALITY_BYTE_LENGTH, sizeof<f64>());
  const bestDeltaSlopePointer = reserveArena(pulseByteLength, sizeof<f64>());
  const bestCenterXPointer = reserveArena(pulseByteLength, sizeof<f64>());
  const fallbackDeltaSlopePointer = reserveArena(pulseByteLength, sizeof<f64>());
  const fallbackCenterXPointer = reserveArena(pulseByteLength, sizeof<f64>());
  const unbrakedDeltaSlopePointer = reserveArena(pulseByteLength, sizeof<f64>());
  const unbrakedCenterXPointer = reserveArena(pulseByteLength, sizeof<f64>());
  const quantizedCoefficientPointer = reserveArena(pulseByteLength, sizeof<f64>());
  const scratchStatePointer = reserveArena(
    ABS_SECOND_DERIVATIVE_TARGET_STATE_BYTE_LENGTH,
    sizeof<f64>(),
  );
  const pulseInputPointer = reserveArena(ABS_SECOND_DERIVATIVE_PULSE_INPUT_BYTE_LENGTH, sizeof<f64>());
  const pulseResultPointer = reserveArena(ABS_SECOND_DERIVATIVE_PULSE_RESULT_BYTE_LENGTH, sizeof<f64>());
  const appliedCorrectionCenterPointer = reserveArena(pulseByteLength, sizeof<f64>());
  const appliedCorrectionDeltaPointer = reserveArena(pulseByteLength, sizeof<f64>());
  const positionErrorPointer = reserveArena(pulseByteLength, sizeof<f64>());
  const positionResponsePointer = reserveArena(pulseByteLength, sizeof<f64>());
  const visitedSnapshotStride = checkedAddByteLength(
    checkedByteLength(2 * segmentCount, sizeof<u64>()),
    sizeof<u64>(),
  );
  const visitedPointer = reserveArena(
    checkedByteLength(ABS_SECOND_DERIVATIVE_MAX_REFINEMENT_ITERATIONS, visitedSnapshotStride),
    sizeof<u64>(),
  );
  const visitedTerminalPointer = reserveArena(
    checkedByteLength(ABS_SECOND_DERIVATIVE_MAX_REFINEMENT_ITERATIONS + 1, sizeof<u64>()),
    sizeof<u64>(),
  );

  // Legacy centers provide the mandatory finite baseline before the optional shifted initialization competes.
  let pulseIndex: u32 = 0;
  while (pulseIndex + 1 < segmentCount) {
    if (
      !writeAbsSecondDerivativePrefixState(
        buildInputPointer,
        pulseDeltaSlopePointer,
        pulseCenterXPointer,
        launchX,
        launchY,
        launchDy,
        baseY,
        boundsMinX,
        boundsMaxX,
        boundsMinY,
        boundsMaxY,
        load<f64>(formulaPointXPointer + (pulseIndex + 1) * sizeof<f64>()),
        protectionPointer,
        observedProtectionPointer,
        scratchStatePointer,
      )
    ) {
      return false;
    }
    const startX = load<f64>(scratchStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_X_OFFSET);
    const startY = load<f64>(scratchStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_Y_OFFSET);
    const startDy = load<f64>(scratchStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_DY_OFFSET);
    if (!isFiniteValue(startY) || !isFiniteValue(startDy)) {
      return false;
    }
    if (pulseIndex > 0) {
      store<f64>(segmentStartXPointer + pulseIndex * sizeof<f64>(), startX);
      store<f64>(segmentStartYPointer + pulseIndex * sizeof<f64>(), startY);
    }
    const nextTargetX = load<f64>(originalPointXPointer + (pulseIndex + 2) * sizeof<f64>());
    const nextTargetY = load<f64>(originalPointYPointer + (pulseIndex + 2) * sizeof<f64>());
    store<f64>(
      pulseCenterXPointer + pulseIndex * sizeof<f64>(),
      floorFormulaDecimal(
        load<f64>(formulaPointXPointer + (pulseIndex + 1) * sizeof<f64>()),
        decimalPlaces,
      ),
    );
    store<f64>(
      pulseDeltaSlopePointer + pulseIndex * sizeof<f64>(),
      calculateAbsSecondDerivativeTargetDy(
        startX,
        startY,
        true,
        nextTargetX,
        nextTargetY,
        getGraphwarFuncMinXStepDistance(),
      ) - startDy,
    );
    pulseIndex += 1;
  }

  let isShiftedInitializationFinite = true;
  pulseIndex = 0;
  while (pulseIndex + 1 < segmentCount) {
    if (
      !writeAbsSecondDerivativePrefixState(
        buildInputPointer,
        shiftedDeltaSlopePointer,
        shiftedCenterXPointer,
        launchX,
        launchY,
        launchDy,
        baseY,
        boundsMinX,
        boundsMaxX,
        boundsMinY,
        boundsMaxY,
        load<f64>(formulaPointXPointer + (pulseIndex + 1) * sizeof<f64>()),
        protectionPointer,
        observedProtectionPointer,
        scratchStatePointer,
      )
    ) {
      isShiftedInitializationFinite = false;
      break;
    }
    const startX = load<f64>(scratchStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_X_OFFSET);
    const startY = load<f64>(scratchStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_Y_OFFSET);
    const startDy = load<f64>(scratchStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_DY_OFFSET);
    if (!isFiniteValue(startY) || !isFiniteValue(startDy)) {
      isShiftedInitializationFinite = false;
      break;
    }
    const nextTargetX = load<f64>(originalPointXPointer + (pulseIndex + 2) * sizeof<f64>());
    const nextTargetY = load<f64>(originalPointYPointer + (pulseIndex + 2) * sizeof<f64>());
    if (
      !writeResolvedPulse(
        pulseInputPointer,
        pulseResultPointer,
        calculateAbsSecondDerivativeTargetDy(
          startX,
          startY,
          true,
          nextTargetX,
          nextTargetY,
          getGraphwarFuncMinXStepDistance(),
        ) - startDy,
        startX,
        0,
        false,
        formulaSteepness,
        launchX,
        pulseIndex == 0
          ? launchX
          : load<f64>(originalPointXPointer + pulseIndex * sizeof<f64>()),
        load<f64>(formulaPointXPointer + (pulseIndex + 1) * sizeof<f64>()),
        minimumHorizontalGraphUnits,
        positionTargetGraphUnits,
        decimalPlaces,
        shiftedCenterXPointer + pulseIndex * sizeof<f64>(),
        shiftedDeltaSlopePointer + pulseIndex * sizeof<f64>(),
      )
    ) {
      isShiftedInitializationFinite = false;
      break;
    }
    pulseIndex += 1;
  }

  const terminalPulseIndex = segmentCount - 1;
  const finalX = load<f64>(formulaPointXPointer + segmentCount * sizeof<f64>());
  if (
    !writeAbsSecondDerivativePrefixState(
      buildInputPointer,
      pulseDeltaSlopePointer,
      pulseCenterXPointer,
      launchX,
      launchY,
      launchDy,
      baseY,
      boundsMinX,
      boundsMaxX,
      f64.NEGATIVE_INFINITY,
      f64.POSITIVE_INFINITY,
      finalX,
      protectionPointer,
      observedProtectionPointer,
      scratchStatePointer,
    )
  ) {
    return false;
  }
  const baselineTerminalDy = load<f64>(
    scratchStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_DY_OFFSET,
  );
  if (!isFiniteValue(baselineTerminalDy)) {
    return false;
  }
  store<f64>(
    pulseCenterXPointer + terminalPulseIndex * sizeof<f64>(),
    floorFormulaDecimal(finalX, decimalPlaces),
  );
  store<f64>(pulseDeltaSlopePointer + terminalPulseIndex * sizeof<f64>(), 0);

  let hasUnbrakedInitialization = false;
  if (
    writeAbsSecondDerivativeTargetStates(
      buildInputPointer,
      pulseDeltaSlopePointer,
      pulseCenterXPointer,
      targetPointPointer,
      segmentCount,
      launchX,
      launchY,
      launchDy,
      baseY,
      boundsMinX,
      boundsMaxX,
      boundsMinY,
      boundsMaxY,
      protectionPointer,
      observedProtectionPointer,
      currentTargetStatePointer,
    )
  ) {
    writeAbsSecondDerivativeLandingQuality(
      currentTargetStatePointer,
      targetPointPointer,
      segmentCount,
      getGraphwarFuncMinXStepDistance(),
      getGraphwarPlaneHeight(),
      boundsMinY,
      boundsMaxY,
      currentQualityPointer,
    );
    if (isQualityFinite(currentQualityPointer)) {
      copyF64Values(unbrakedCenterXPointer, pulseCenterXPointer, segmentCount);
      copyF64Values(unbrakedDeltaSlopePointer, pulseDeltaSlopePointer, segmentCount);
      copyTargetStates(unbrakedTargetStatePointer, currentTargetStatePointer, segmentCount);
      copyQuality(unbrakedQualityPointer, currentQualityPointer);
      hasUnbrakedInitialization = true;
    }
  }
  store<f64>(
    pulseDeltaSlopePointer + terminalPulseIndex * sizeof<f64>(),
    -baselineTerminalDy,
  );

  let hasBest = false;
  let hasFallback = false;
  let terminalPulseIsResolved = true;
  let shiftedInitializationPending = isShiftedInitializationFinite;
  let visitedCount: u32 = 0;
  let refinementIteration: u32 = 0;
  while (refinementIteration < ABS_SECOND_DERIVATIVE_MAX_REFINEMENT_ITERATIONS) {
    if (terminalPulseIsResolved) {
      terminalPulseIsResolved = false;
    } else if (
      !resolveTerminalPulse(
        buildInputPointer,
        pulseDeltaSlopePointer,
        pulseCenterXPointer,
        segmentCount,
        formulaPointXPointer,
        originalPointXPointer,
        launchX,
        launchY,
        launchDy,
        baseY,
        boundsMinX,
        boundsMaxX,
        formulaSteepness,
        minimumHorizontalGraphUnits,
        positionTargetGraphUnits,
        decimalPlaces,
        protectionPointer,
        observedProtectionPointer,
        pulseInputPointer,
        pulseResultPointer,
        scratchStatePointer,
      )
    ) {
      if (hasBest) {
        break;
      }
      return false;
    }

    let isExecutionStateFinite = true;
    pulseIndex = 0;
    while (pulseIndex < segmentCount) {
      const deltaSlope = load<f64>(pulseDeltaSlopePointer + pulseIndex * sizeof<f64>());
      const coefficient = quantizeFormulaCoefficient(formulaSteepness * deltaSlope, decimalPlaces);
      const quantizedDeltaSlope = coefficient / formulaSteepness;
      store<f64>(quantizedCoefficientPointer + pulseIndex * sizeof<f64>(), coefficient);
      store<f64>(pulseDeltaSlopePointer + pulseIndex * sizeof<f64>(), quantizedDeltaSlope);
      if (!isFiniteValue(coefficient) || !isFiniteValue(quantizedDeltaSlope)) {
        isExecutionStateFinite = false;
        break;
      }
      pulseIndex += 1;
    }
    pulseIndex = 0;
    while (isExecutionStateFinite && pulseIndex < segmentCount) {
      if (!isFiniteValue(load<f64>(pulseCenterXPointer + pulseIndex * sizeof<f64>()))) {
        isExecutionStateFinite = false;
      }
      pulseIndex += 1;
    }
    if (!isExecutionStateFinite) {
      if (hasBest) {
        break;
      }
      return false;
    }
    if (
      hasVisitedPulseState(
        visitedPointer,
        visitedCount,
        visitedSnapshotStride,
        quantizedCoefficientPointer,
        pulseCenterXPointer,
        segmentCount,
        launchAngle,
      )
    ) {
      break;
    }
    writeVisitedPulseState(
      visitedPointer + visitedCount * visitedSnapshotStride,
      quantizedCoefficientPointer,
      pulseCenterXPointer,
      segmentCount,
      launchAngle,
    );
    visitedCount += 1;

    let hasTargetStates = writeAbsSecondDerivativeTargetStates(
      buildInputPointer,
      pulseDeltaSlopePointer,
      pulseCenterXPointer,
      targetPointPointer,
      segmentCount,
      launchX,
      launchY,
      launchDy,
      baseY,
      boundsMinX,
      boundsMaxX,
      boundsMinY,
      boundsMaxY,
      protectionPointer,
      observedProtectionPointer,
      currentTargetStatePointer,
    );
    if (!hasTargetStates && !hasBest && hasFallback) {
      copyF64Values(pulseCenterXPointer, fallbackCenterXPointer, segmentCount);
      copyF64Values(pulseDeltaSlopePointer, fallbackDeltaSlopePointer, segmentCount);
      copyTargetStates(currentTargetStatePointer, fallbackTargetStatePointer, segmentCount);
      hasFallback = false;
      hasTargetStates = true;
    }
    if (!hasTargetStates) {
      if (hasBest) {
        break;
      }
      return false;
    }
    writeAbsSecondDerivativeLandingQuality(
      currentTargetStatePointer,
      targetPointPointer,
      segmentCount,
      getGraphwarFuncMinXStepDistance(),
      getGraphwarPlaneHeight(),
      boundsMinY,
      boundsMaxY,
      currentQualityPointer,
    );
    if (!isQualityFinite(currentQualityPointer)) {
      if (hasBest) {
        break;
      }
      return false;
    }
    if (
      !isSecondOrderLandingQualityBetter(
        currentQualityPointer,
        bestQualityPointer,
        hasBest,
        qualityTargetPlanePixels,
        0,
        0,
        false,
      )
    ) {
      break;
    }
    copyQuality(bestQualityPointer, currentQualityPointer);
    copyF64Values(bestCenterXPointer, pulseCenterXPointer, segmentCount);
    copyF64Values(bestDeltaSlopePointer, pulseDeltaSlopePointer, segmentCount);
    copyTargetStates(bestTargetStatePointer, currentTargetStatePointer, segmentCount);
    hasBest = true;

    if (shiftedInitializationPending) {
      shiftedInitializationPending = false;
      if (
        resolveTerminalPulse(
          buildInputPointer,
          shiftedDeltaSlopePointer,
          shiftedCenterXPointer,
          segmentCount,
          formulaPointXPointer,
          originalPointXPointer,
          launchX,
          launchY,
          launchDy,
          baseY,
          boundsMinX,
          boundsMaxX,
          formulaSteepness,
          minimumHorizontalGraphUnits,
          positionTargetGraphUnits,
          decimalPlaces,
          protectionPointer,
          observedProtectionPointer,
          pulseInputPointer,
          pulseResultPointer,
          scratchStatePointer,
        )
      ) {
        let changesExecutionState = false;
        pulseIndex = 0;
        while (pulseIndex < segmentCount) {
          const shiftedDeltaSlope = load<f64>(
            shiftedDeltaSlopePointer + pulseIndex * sizeof<f64>(),
          );
          if (
            !isFiniteValue(shiftedDeltaSlope) ||
            load<f64>(shiftedCenterXPointer + pulseIndex * sizeof<f64>()) !=
              load<f64>(pulseCenterXPointer + pulseIndex * sizeof<f64>()) ||
            quantizeFormulaCoefficient(formulaSteepness * shiftedDeltaSlope, decimalPlaces) !=
              load<f64>(quantizedCoefficientPointer + pulseIndex * sizeof<f64>())
          ) {
            changesExecutionState = true;
            break;
          }
          pulseIndex += 1;
        }
        if (changesExecutionState) {
          copyF64Values(fallbackCenterXPointer, bestCenterXPointer, segmentCount);
          copyF64Values(fallbackDeltaSlopePointer, bestDeltaSlopePointer, segmentCount);
          copyTargetStates(fallbackTargetStatePointer, bestTargetStatePointer, segmentCount);
          copyQuality(fallbackQualityPointer, bestQualityPointer);
          hasFallback = true;
          hasBest = false;
          copyF64Values(pulseCenterXPointer, shiftedCenterXPointer, segmentCount);
          copyF64Values(pulseDeltaSlopePointer, shiftedDeltaSlopePointer, segmentCount);
          terminalPulseIsResolved = true;
          refinementIteration += 1;
          continue;
        }
      }
    }

    const positionErrorPlanePixels = load<f64>(
      currentQualityPointer + ABS_SECOND_DERIVATIVE_QUALITY_POSITION_ERROR_OFFSET,
    );
    if (positionErrorPlanePixels <= qualityTargetPlanePixels) {
      let hasWorstPulse = false;
      let worstPulseIndex: u32 = 0;
      let worstDerivativeError = 0.0;
      pulseIndex = 0;
      while (pulseIndex + 1 < segmentCount) {
        const targetStatePointer =
          currentTargetStatePointer + pulseIndex * ABS_SECOND_DERIVATIVE_TARGET_STATE_BYTE_LENGTH;
        const nextTargetPointer =
          targetPointPointer + (pulseIndex + 1) * ABS_SECOND_DERIVATIVE_TARGET_BYTE_LENGTH;
        const derivativeError =
          calculateAbsSecondDerivativeTargetDy(
            load<f64>(targetStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_X_OFFSET),
            load<f64>(targetStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_Y_OFFSET),
            true,
            load<f64>(nextTargetPointer + ABS_SECOND_DERIVATIVE_TARGET_X_OFFSET),
            load<f64>(nextTargetPointer + ABS_SECOND_DERIVATIVE_TARGET_Y_OFFSET),
            getGraphwarFuncMinXStepDistance(),
          ) - load<f64>(targetStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_DY_OFFSET);
        if (NativeMath.abs(derivativeError) > NativeMath.abs(worstDerivativeError)) {
          hasWorstPulse = true;
          worstPulseIndex = pulseIndex;
          worstDerivativeError = derivativeError;
        }
        pulseIndex += 1;
      }
      if (hasWorstPulse) {
        const worstStatePointer =
          currentTargetStatePointer + worstPulseIndex * ABS_SECOND_DERIVATIVE_TARGET_STATE_BYTE_LENGTH;
        const worstCenterX = load<f64>(pulseCenterXPointer + worstPulseIndex * sizeof<f64>());
        store<f64>(
          pulseDeltaSlopePointer + worstPulseIndex * sizeof<f64>(),
          load<f64>(pulseDeltaSlopePointer + worstPulseIndex * sizeof<f64>()) +
            worstDerivativeError /
              (2 *
                calculateAbsSecondDerivativePulseResponse(
                  launchX,
                  load<f64>(worstStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_X_OFFSET),
                  worstCenterX,
                  formulaSteepness,
                )),
        );
      }
    } else {
      if (segmentCount == 2) {
        const firstCenterX = load<f64>(pulseCenterXPointer);
        const secondCenterX = load<f64>(pulseCenterXPointer + sizeof<f64>());
        const firstDeltaSlope = load<f64>(pulseDeltaSlopePointer);
        const secondDeltaSlope = load<f64>(pulseDeltaSlopePointer + sizeof<f64>());
        const firstTargetStatePointer = currentTargetStatePointer;
        const secondTargetStatePointer =
          currentTargetStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_BYTE_LENGTH;
        const firstPulseAtFirstTarget = calculateAbsSecondDerivativePulseDisplacementResponse(
          launchX,
          load<f64>(firstTargetStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_X_OFFSET),
          firstCenterX,
          formulaSteepness,
        );
        const secondPulseAtFirstTarget = calculateAbsSecondDerivativePulseDisplacementResponse(
          launchX,
          load<f64>(firstTargetStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_X_OFFSET),
          secondCenterX,
          formulaSteepness,
        );
        const firstPulseAtSecondTarget = calculateAbsSecondDerivativePulseDisplacementResponse(
          launchX,
          load<f64>(secondTargetStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_X_OFFSET),
          firstCenterX,
          formulaSteepness,
        );
        const secondPulseAtSecondTarget = calculateAbsSecondDerivativePulseDisplacementResponse(
          launchX,
          load<f64>(secondTargetStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_X_OFFSET),
          secondCenterX,
          formulaSteepness,
        );
        const determinant =
          firstPulseAtFirstTarget * secondPulseAtSecondTarget -
          secondPulseAtFirstTarget * firstPulseAtSecondTarget;
        const firstPositionError =
          load<f64>(targetPointPointer + ABS_SECOND_DERIVATIVE_TARGET_Y_OFFSET) -
          load<f64>(firstTargetStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_Y_OFFSET);
        const secondPositionError =
          load<f64>(
            targetPointPointer +
              ABS_SECOND_DERIVATIVE_TARGET_BYTE_LENGTH +
              ABS_SECOND_DERIVATIVE_TARGET_Y_OFFSET,
          ) - load<f64>(secondTargetStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_Y_OFFSET);
        if (determinant != 0 && isFiniteValue(determinant)) {
          const firstCorrection =
            (firstPositionError * secondPulseAtSecondTarget -
              secondPulseAtFirstTarget * secondPositionError) /
            determinant;
          const secondCorrection =
            (firstPulseAtFirstTarget * secondPositionError -
              firstPositionError * firstPulseAtSecondTarget) /
            determinant;
          if (isFiniteValue(firstCorrection) && isFiniteValue(secondCorrection)) {
            store<f64>(pulseDeltaSlopePointer, firstDeltaSlope + firstCorrection);
            store<f64>(pulseDeltaSlopePointer + sizeof<f64>(), secondDeltaSlope + secondCorrection);
            terminalPulseIsResolved = true;
            refinementIteration += 1;
            continue;
          }
        }
      }

      const firstDeltaSlope = load<f64>(pulseDeltaSlopePointer);
      const firstCenterX = load<f64>(pulseCenterXPointer);
      const positionCorrectionTargetGraphUnits =
        positionTargetGraphUnits * SECOND_ORDER_POSITION_CORRECTION_TARGET_FACTOR;
      const firstPositionError =
        load<f64>(targetPointPointer + ABS_SECOND_DERIVATIVE_TARGET_Y_OFFSET) -
        load<f64>(currentTargetStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_Y_OFFSET);
      if (
        firstDeltaSlope != 0 &&
        NativeMath.abs(firstPositionError) > positionTargetGraphUnits
      ) {
        const wantedCenterX =
          firstCenterX -
          (firstPositionError - signValue(firstPositionError) * positionCorrectionTargetGraphUnits) /
            firstDeltaSlope;
        let correctedCenterX = floorFormulaDecimal(wantedCenterX, decimalPlaces);
        if (correctedCenterX == firstCenterX && wantedCenterX > firstCenterX) {
          correctedCenterX = floorFormulaDecimal(
            firstCenterX + NativeMath.pow(10, -<f64>decimalPlaces),
            decimalPlaces,
          );
        }
        if (isFiniteValue(correctedCenterX)) {
          store<f64>(pulseCenterXPointer, correctedCenterX);
          if (terminalPulseIndex == 0 && correctedCenterX != firstCenterX) {
            terminalPulseIsResolved = true;
          }
        }
      }

      const correctedFirstCenterX = load<f64>(pulseCenterXPointer);
      let appliedCorrectionCount: u32 = 0;
      pulseIndex = 0;
      while (pulseIndex + 1 < segmentCount) {
        const targetStatePointer =
          currentTargetStatePointer + (pulseIndex + 1) * ABS_SECOND_DERIVATIVE_TARGET_STATE_BYTE_LENGTH;
        const targetPointer =
          targetPointPointer + (pulseIndex + 1) * ABS_SECOND_DERIVATIVE_TARGET_BYTE_LENGTH;
        const deltaSlope = load<f64>(pulseDeltaSlopePointer + pulseIndex * sizeof<f64>());
        const pulseCenterX = load<f64>(pulseCenterXPointer + pulseIndex * sizeof<f64>());
        let correctedTargetY = load<f64>(
          targetStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_Y_OFFSET,
        );
        if (correctedFirstCenterX != firstCenterX) {
          correctedTargetY +=
            firstDeltaSlope *
            (calculateAbsSecondDerivativePulseDisplacementResponse(
              launchX,
              load<f64>(targetStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_X_OFFSET),
              correctedFirstCenterX,
              formulaSteepness,
            ) -
              calculateAbsSecondDerivativePulseDisplacementResponse(
                launchX,
                load<f64>(targetStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_X_OFFSET),
                firstCenterX,
                formulaSteepness,
              ));
        }
        let correctionIndex: u32 = 0;
        while (correctionIndex < appliedCorrectionCount) {
          correctedTargetY +=
            load<f64>(appliedCorrectionDeltaPointer + correctionIndex * sizeof<f64>()) *
            calculateAbsSecondDerivativePulseDisplacementResponse(
              launchX,
              load<f64>(targetStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_X_OFFSET),
              load<f64>(appliedCorrectionCenterPointer + correctionIndex * sizeof<f64>()),
              formulaSteepness,
            );
          correctionIndex += 1;
        }
        const positionError =
          load<f64>(targetPointer + ABS_SECOND_DERIVATIVE_TARGET_Y_OFFSET) - correctedTargetY;
        if (NativeMath.abs(positionError) > positionTargetGraphUnits) {
          const positionResponse = calculateAbsSecondDerivativePulseDisplacementResponse(
            launchX,
            load<f64>(targetStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_X_OFFSET),
            pulseCenterX,
            formulaSteepness,
          );
          if (positionResponse > 0 && isFiniteValue(positionResponse)) {
            const correction =
              (positionError - signValue(positionError) * positionCorrectionTargetGraphUnits) /
              positionResponse;
            const currentCoefficient = load<f64>(
              quantizedCoefficientPointer + pulseIndex * sizeof<f64>(),
            );
            let correctedCoefficient = quantizeFormulaCoefficient(
              formulaSteepness * (deltaSlope + correction),
              decimalPlaces,
            );
            if (correctedCoefficient == currentCoefficient) {
              correctedCoefficient = quantizeFormulaCoefficient(
                currentCoefficient + signValue(correction) * NativeMath.pow(10, -<f64>decimalPlaces),
                decimalPlaces,
              );
            }
            const correctedDeltaSlope = correctedCoefficient / formulaSteepness;
            store<f64>(pulseDeltaSlopePointer + pulseIndex * sizeof<f64>(), correctedDeltaSlope);
            const appliedCorrection = correctedDeltaSlope - deltaSlope;
            if (appliedCorrection != 0) {
              store<f64>(
                appliedCorrectionCenterPointer + appliedCorrectionCount * sizeof<f64>(),
                pulseCenterX,
              );
              store<f64>(
                appliedCorrectionDeltaPointer + appliedCorrectionCount * sizeof<f64>(),
                appliedCorrection,
              );
              appliedCorrectionCount += 1;
            }
          }
        }
        pulseIndex += 1;
      }
    }
    refinementIteration += 1;
  }

  if (
    hasUnbrakedInitialization &&
    isSecondOrderLandingQualityBetter(
      unbrakedQualityPointer,
      bestQualityPointer,
      hasBest,
      qualityTargetPlanePixels,
      0,
      0,
      false,
    )
  ) {
    copyQuality(bestQualityPointer, unbrakedQualityPointer);
    copyF64Values(bestCenterXPointer, unbrakedCenterXPointer, segmentCount);
    copyF64Values(bestDeltaSlopePointer, unbrakedDeltaSlopePointer, segmentCount);
    copyTargetStates(bestTargetStatePointer, unbrakedTargetStatePointer, segmentCount);
    hasBest = true;
  }
  if (
    hasFallback &&
    isSecondOrderLandingQualityBetter(
      fallbackQualityPointer,
      bestQualityPointer,
      hasBest,
      qualityTargetPlanePixels,
      0,
      0,
      false,
    )
  ) {
    copyQuality(bestQualityPointer, fallbackQualityPointer);
    copyF64Values(bestCenterXPointer, fallbackCenterXPointer, segmentCount);
    copyF64Values(bestDeltaSlopePointer, fallbackDeltaSlopePointer, segmentCount);
    copyTargetStates(bestTargetStatePointer, fallbackTargetStatePointer, segmentCount);
    hasBest = true;
  }
  if (!hasBest) {
    return false;
  }
  copyF64Values(pulseCenterXPointer, bestCenterXPointer, segmentCount);
  copyF64Values(pulseDeltaSlopePointer, bestDeltaSlopePointer, segmentCount);

  const terminalCenterX = load<f64>(pulseCenterXPointer + terminalPulseIndex * sizeof<f64>());
  let bestTerminalDeltaSlope = load<f64>(
    pulseDeltaSlopePointer + terminalPulseIndex * sizeof<f64>(),
  );
  let bestTerminalDy = load<f64>(
    bestTargetStatePointer +
      terminalPulseIndex * ABS_SECOND_DERIVATIVE_TARGET_STATE_BYTE_LENGTH +
      ABS_SECOND_DERIVATIVE_TARGET_STATE_DY_OFFSET,
  );
  let bestTerminalPointX = load<f64>(
    bestTargetStatePointer +
      terminalPulseIndex * ABS_SECOND_DERIVATIVE_TARGET_STATE_BYTE_LENGTH +
      ABS_SECOND_DERIVATIVE_TARGET_STATE_X_OFFSET,
  );
  copyQuality(currentQualityPointer, bestQualityPointer);
  if (quantizeFormulaCoefficient(formulaSteepness * bestTerminalDeltaSlope, decimalPlaces) != 0) {
    store<f64>(pulseDeltaSlopePointer + terminalPulseIndex * sizeof<f64>(), 0);
    if (
      writeAbsSecondDerivativeTargetStates(
        buildInputPointer,
        pulseDeltaSlopePointer,
        pulseCenterXPointer,
        targetPointPointer,
        segmentCount,
        launchX,
        launchY,
        launchDy,
        baseY,
        boundsMinX,
        boundsMaxX,
        boundsMinY,
        boundsMaxY,
        protectionPointer,
        observedProtectionPointer,
        currentTargetStatePointer,
      )
    ) {
      writeAbsSecondDerivativeLandingQuality(
        currentTargetStatePointer,
        targetPointPointer,
        segmentCount,
        getGraphwarFuncMinXStepDistance(),
        getGraphwarPlaneHeight(),
        boundsMinY,
        boundsMaxY,
        currentQualityPointer,
      );
      const zeroTerminalDy = load<f64>(
        currentTargetStatePointer +
          terminalPulseIndex * ABS_SECOND_DERIVATIVE_TARGET_STATE_BYTE_LENGTH +
          ABS_SECOND_DERIVATIVE_TARGET_STATE_DY_OFFSET,
      );
      if (
        isSecondOrderLandingQualityBetter(
          currentQualityPointer,
          bestQualityPointer,
          true,
          qualityTargetPlanePixels,
          NativeMath.abs(zeroTerminalDy),
          NativeMath.abs(bestTerminalDy),
          true,
        )
      ) {
        bestTerminalDeltaSlope = 0;
        bestTerminalDy = zeroTerminalDy;
        bestTerminalPointX = load<f64>(
          currentTargetStatePointer +
            terminalPulseIndex * ABS_SECOND_DERIVATIVE_TARGET_STATE_BYTE_LENGTH +
            ABS_SECOND_DERIVATIVE_TARGET_STATE_X_OFFSET,
        );
        copyQuality(bestQualityPointer, currentQualityPointer);
        copyTargetStates(bestTargetStatePointer, currentTargetStatePointer, segmentCount);
      }
    }
  }

  let visitedTerminalCount: u32 = 1;
  store<u64>(
    visitedTerminalPointer,
    reinterpret<u64>(
      normalizeZero(quantizeFormulaCoefficient(formulaSteepness * bestTerminalDeltaSlope, decimalPlaces)),
    ),
  );
  let hasOppositeTerminal = false;
  let oppositeTerminalDeltaSlope = 0.0;
  let oppositeTerminalDy = 0.0;
  let hasRejectedTerminal = false;
  let rejectedTerminalDeltaSlope = 0.0;
  let hasNextTerminalDeltaSlope = false;
  let nextTerminalDeltaSlope = 0.0;
  if (
    load<f64>(bestQualityPointer + ABS_SECOND_DERIVATIVE_QUALITY_POSITION_ERROR_OFFSET) >
    qualityTargetPlanePixels
  ) {
    let positionStateCount: u32 = 0;
    let worstTargetIndex: u32 = 0;
    targetIndex = 0;
    while (targetIndex < segmentCount) {
      const statePointer =
        bestTargetStatePointer + targetIndex * ABS_SECOND_DERIVATIVE_TARGET_STATE_BYTE_LENGTH;
      const pointPointer =
        targetPointPointer + targetIndex * ABS_SECOND_DERIVATIVE_TARGET_BYTE_LENGTH;
      const positionError =
        load<f64>(pointPointer + ABS_SECOND_DERIVATIVE_TARGET_Y_OFFSET) -
        load<f64>(statePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_Y_OFFSET);
      const positionResponse = calculateAbsSecondDerivativePulseDisplacementResponse(
        launchX,
        load<f64>(statePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_X_OFFSET),
        terminalCenterX,
        formulaSteepness,
      );
      if (!isFiniteValue(positionError) || !(positionResponse > 0) || !isFiniteValue(positionResponse)) {
        positionStateCount = 0;
        break;
      }
      store<f64>(positionErrorPointer + targetIndex * sizeof<f64>(), positionError);
      store<f64>(positionResponsePointer + targetIndex * sizeof<f64>(), positionResponse);
      positionStateCount += 1;
      if (
        NativeMath.abs(positionError) >
        NativeMath.abs(load<f64>(positionErrorPointer + worstTargetIndex * sizeof<f64>()))
      ) {
        worstTargetIndex = targetIndex;
      }
      targetIndex += 1;
    }
    if (positionStateCount != 0) {
      const worstError = load<f64>(positionErrorPointer + worstTargetIndex * sizeof<f64>());
      const worstResponse = load<f64>(positionResponsePointer + worstTargetIndex * sizeof<f64>());
      let bestCorrection = 0.0;
      let bestPredictedError = NativeMath.abs(worstError);
      targetIndex = 0;
      while (targetIndex < positionStateCount) {
        const correction =
          (worstError + load<f64>(positionErrorPointer + targetIndex * sizeof<f64>())) /
          (worstResponse + load<f64>(positionResponsePointer + targetIndex * sizeof<f64>()));
        if (isFiniteValue(correction) && correction * worstError > 0) {
          let predictedError = 0.0;
          let predictedIndex: u32 = 0;
          while (predictedIndex < positionStateCount) {
            predictedError = NativeMath.max(
              predictedError,
              NativeMath.abs(
                load<f64>(positionErrorPointer + predictedIndex * sizeof<f64>()) -
                  correction * load<f64>(positionResponsePointer + predictedIndex * sizeof<f64>()),
              ),
            );
            predictedIndex += 1;
          }
          if (predictedError < bestPredictedError) {
            bestCorrection = correction;
            bestPredictedError = predictedError;
          }
        }
        targetIndex += 1;
      }
      if (bestCorrection != 0) {
        nextTerminalDeltaSlope = bestTerminalDeltaSlope + bestCorrection;
        hasNextTerminalDeltaSlope = true;
      }
    }
  }
  let terminalProposalTargetsPosition = hasNextTerminalDeltaSlope;
  store<f64>(
    pulseDeltaSlopePointer + terminalPulseIndex * sizeof<f64>(),
    hasNextTerminalDeltaSlope
      ? nextTerminalDeltaSlope
      : bestTerminalDeltaSlope -
          bestTerminalDy /
            calculateAbsSecondDerivativePulseResponse(
              launchX,
              bestTerminalPointX,
              terminalCenterX,
              formulaSteepness,
            ),
  );

  refinementIteration = 0;
  while (refinementIteration < ABS_SECOND_DERIVATIVE_MAX_REFINEMENT_ITERATIONS) {
    const pendingTerminalDeltaSlope = load<f64>(
      pulseDeltaSlopePointer + terminalPulseIndex * sizeof<f64>(),
    );
    const terminalCoefficient = quantizeFormulaCoefficient(
      formulaSteepness * pendingTerminalDeltaSlope,
      decimalPlaces,
    );
    const terminalDeltaSlope = terminalCoefficient / formulaSteepness;
    store<f64>(pulseDeltaSlopePointer + terminalPulseIndex * sizeof<f64>(), terminalDeltaSlope);
    if (
      !isFiniteValue(terminalCoefficient) ||
      !isFiniteValue(terminalDeltaSlope) ||
      hasVisitedCoefficient(visitedTerminalPointer, visitedTerminalCount, terminalCoefficient)
    ) {
      break;
    }
    store<u64>(
      visitedTerminalPointer + visitedTerminalCount * sizeof<u64>(),
      reinterpret<u64>(normalizeZero(terminalCoefficient)),
    );
    visitedTerminalCount += 1;
    if (
      !writeAbsSecondDerivativeTargetStates(
        buildInputPointer,
        pulseDeltaSlopePointer,
        pulseCenterXPointer,
        targetPointPointer,
        segmentCount,
        launchX,
        launchY,
        launchDy,
        baseY,
        boundsMinX,
        boundsMaxX,
        boundsMinY,
        boundsMaxY,
        protectionPointer,
        observedProtectionPointer,
        currentTargetStatePointer,
      )
    ) {
      break;
    }
    const terminalStatePointer =
      currentTargetStatePointer +
      terminalPulseIndex * ABS_SECOND_DERIVATIVE_TARGET_STATE_BYTE_LENGTH;
    const terminalDy = load<f64>(terminalStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_DY_OFFSET);
    writeAbsSecondDerivativeLandingQuality(
      currentTargetStatePointer,
      targetPointPointer,
      segmentCount,
      getGraphwarFuncMinXStepDistance(),
      getGraphwarPlaneHeight(),
      boundsMinY,
      boundsMaxY,
      currentQualityPointer,
    );
    if (
      !isSecondOrderLandingQualityBetter(
        currentQualityPointer,
        bestQualityPointer,
        true,
        qualityTargetPlanePixels,
        NativeMath.abs(terminalDy),
        NativeMath.abs(bestTerminalDy),
        true,
      )
    ) {
      if (terminalProposalTargetsPosition) {
        break;
      }
      if (terminalDy * bestTerminalDy < 0) {
        hasOppositeTerminal = true;
        oppositeTerminalDeltaSlope = terminalDeltaSlope;
        oppositeTerminalDy = terminalDy;
        store<f64>(
          pulseDeltaSlopePointer + terminalPulseIndex * sizeof<f64>(),
          calculateSecantZero(
            bestTerminalDeltaSlope,
            bestTerminalDy,
            terminalDeltaSlope,
            terminalDy,
          ),
        );
        refinementIteration += 1;
        continue;
      }
      if (NativeMath.abs(terminalDy) < NativeMath.abs(bestTerminalDy)) {
        hasRejectedTerminal = true;
        rejectedTerminalDeltaSlope = terminalDeltaSlope;
        store<f64>(
          pulseDeltaSlopePointer + terminalPulseIndex * sizeof<f64>(),
          (bestTerminalDeltaSlope + terminalDeltaSlope) / 2,
        );
        refinementIteration += 1;
        continue;
      }
      break;
    }
    const previousTerminalDeltaSlope = bestTerminalDeltaSlope;
    const previousTerminalDy = bestTerminalDy;
    copyQuality(bestQualityPointer, currentQualityPointer);
    bestTerminalDeltaSlope = terminalDeltaSlope;
    bestTerminalDy = terminalDy;
    terminalProposalTargetsPosition = false;
    if (bestTerminalDy * previousTerminalDy < 0) {
      hasOppositeTerminal = true;
      oppositeTerminalDeltaSlope = previousTerminalDeltaSlope;
      oppositeTerminalDy = previousTerminalDy;
    }
    if (hasOppositeTerminal && bestTerminalDy * oppositeTerminalDy < 0) {
      store<f64>(
        pulseDeltaSlopePointer + terminalPulseIndex * sizeof<f64>(),
        calculateSecantZero(
          bestTerminalDeltaSlope,
          bestTerminalDy,
          oppositeTerminalDeltaSlope,
          oppositeTerminalDy,
        ),
      );
    } else if (hasRejectedTerminal) {
      store<f64>(
        pulseDeltaSlopePointer + terminalPulseIndex * sizeof<f64>(),
        (bestTerminalDeltaSlope + rejectedTerminalDeltaSlope) / 2,
      );
    } else if (terminalDy != previousTerminalDy) {
      store<f64>(
        pulseDeltaSlopePointer + terminalPulseIndex * sizeof<f64>(),
        calculateSecantZero(
          bestTerminalDeltaSlope,
          terminalDy,
          previousTerminalDeltaSlope,
          previousTerminalDy,
        ),
      );
    } else {
      store<f64>(
        pulseDeltaSlopePointer + terminalPulseIndex * sizeof<f64>(),
        bestTerminalDeltaSlope -
          terminalDy /
            calculateAbsSecondDerivativePulseResponse(
              launchX,
              load<f64>(terminalStatePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_X_OFFSET),
              terminalCenterX,
              formulaSteepness,
            ),
      );
    }
    refinementIteration += 1;
  }
  store<f64>(
    pulseDeltaSlopePointer + terminalPulseIndex * sizeof<f64>(),
    bestTerminalDeltaSlope,
  );

  if (
    !writeAbsSecondDerivativeTargetStates(
      buildInputPointer,
      pulseDeltaSlopePointer,
      pulseCenterXPointer,
      targetPointPointer,
      segmentCount,
      launchX,
      launchY,
      launchDy,
      baseY,
      boundsMinX,
      boundsMaxX,
      boundsMinY,
      boundsMaxY,
      protectionPointer,
      observedProtectionPointer,
      currentTargetStatePointer,
    )
  ) {
    return false;
  }
  targetIndex = 0;
  while (targetIndex < segmentCount) {
    if (targetIndex + 1 < segmentCount) {
      const statePointer =
        currentTargetStatePointer + targetIndex * ABS_SECOND_DERIVATIVE_TARGET_STATE_BYTE_LENGTH;
      store<f64>(
        segmentStartXPointer + (targetIndex + 1) * sizeof<f64>(),
        load<f64>(statePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_X_OFFSET),
      );
      store<f64>(
        segmentStartYPointer + (targetIndex + 1) * sizeof<f64>(),
        load<f64>(statePointer + ABS_SECOND_DERIVATIVE_TARGET_STATE_Y_OFFSET),
      );
    }
    targetIndex += 1;
  }
  store<u32>(
    buildInputPointer + FORMULA_INPUT_SEGMENT_START_X_POINTER_OFFSET,
    segmentStartXPointer,
  );
  store<u32>(
    buildInputPointer + FORMULA_INPUT_SEGMENT_START_Y_POINTER_OFFSET,
    segmentStartYPointer,
  );
  setAbsSecondDerivativePulseState(buildInputPointer, pulseDeltaSlopePointer, pulseCenterXPointer);
  return true;
}
