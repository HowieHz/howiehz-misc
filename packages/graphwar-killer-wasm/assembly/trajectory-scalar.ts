import { evaluateFormulaMaterialValue } from "./formula-evaluator";
import {
  FORMULA_EQUATION_DDY,
  FORMULA_EQUATION_DY,
  FORMULA_EQUATION_Y,
  FORMULA_RESULT_BYTE_LENGTH,
} from "./formula-layout";
import {
  getGraphwarFuncMaxStepDistanceSquared,
  getGraphwarFuncMaxSteps,
  getGraphwarFuncMinXStepDistance,
  getGraphwarPlaneHeight,
  getGraphwarPlaneLength,
  getGraphwarStepSize,
  requireGraphwarGameConstantsInitialized,
} from "./game-constants";
import { requireArenaRange } from "./memory";

/** Caller-owned resumable scalar state. Optional evidence is represented atomically by flags. */
export const TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET: u32 = 0;
export const TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET: u32 = 8;
export const TRAJECTORY_SCALAR_STATE_PREVIOUS_X_OFFSET: u32 = 16;
export const TRAJECTORY_SCALAR_STATE_PREVIOUS_Y_OFFSET: u32 = 24;
export const TRAJECTORY_SCALAR_STATE_DY_OFFSET: u32 = 32;
export const TRAJECTORY_SCALAR_STATE_PREVIOUS_DY_OFFSET: u32 = 40;
export const TRAJECTORY_SCALAR_STATE_SAMPLE_INDEX_OFFSET: u32 = 48;
export const TRAJECTORY_SCALAR_STATE_FLAGS_OFFSET: u32 = 52;
export const TRAJECTORY_SCALAR_STATE_MIN_STEP_JUMP_COUNT_OFFSET: u32 = 56;
export const TRAJECTORY_SCALAR_STATE_BYTE_LENGTH: u32 = 64;

export const TRAJECTORY_SCALAR_STATE_FLAG_HAS_PREVIOUS_POINT: u32 = 1;
export const TRAJECTORY_SCALAR_STATE_FLAG_HAS_DY: u32 = 2;
export const TRAJECTORY_SCALAR_STATE_FLAG_HAS_PREVIOUS_DY: u32 = 4;

/** Caller-owned terminal result. Final current x/y/dy are copied here while the full resumable state stays in-place. */
export const TRAJECTORY_SCALAR_RESULT_STOP_REASON_OFFSET: u32 = 0;
export const TRAJECTORY_SCALAR_RESULT_RK4_STEP_COUNT_OFFSET: u32 = 4;
export const TRAJECTORY_SCALAR_RESULT_BISECTION_COUNT_OFFSET: u32 = 8;
export const TRAJECTORY_SCALAR_RESULT_SAMPLE_INDEX_OFFSET: u32 = 12;
export const TRAJECTORY_SCALAR_RESULT_CURRENT_X_OFFSET: u32 = 16;
export const TRAJECTORY_SCALAR_RESULT_CURRENT_Y_OFFSET: u32 = 24;
export const TRAJECTORY_SCALAR_RESULT_DY_OFFSET: u32 = 32;
export const TRAJECTORY_SCALAR_RESULT_MIN_STEP_JUMP_COUNT_OFFSET: u32 = 40;
export const TRAJECTORY_SCALAR_RESULT_FLAGS_OFFSET: u32 = 44;
export const TRAJECTORY_SCALAR_RESULT_BYTE_LENGTH: u32 = 48;

export const TRAJECTORY_SCALAR_RESULT_FLAG_OBSTACLE_HIT: u32 = 1;
export const TRAJECTORY_SCALAR_RESULT_JUMP_WINDOW_COUNT_SHIFT: u32 = 1;

export const TRAJECTORY_SCALAR_STOP_REASON_NOT_RUN: i32 = 0;
export const TRAJECTORY_SCALAR_STOP_REASON_STOP_X: i32 = 1;
export const TRAJECTORY_SCALAR_STOP_REASON_INVALID: i32 = 2;
export const TRAJECTORY_SCALAR_STOP_REASON_MAX_STEPS: i32 = 3;
export const TRAJECTORY_SCALAR_STOP_REASON_OUT_OF_BOUNDS: i32 = 4;
export const TRAJECTORY_SCALAR_STOP_REASON_TOO_STEEP: i32 = 5;

@inline
function trap(): void {
  unreachable();
}

@inline
function isFiniteValue(value: f64): bool {
  return value == value && value != f64.POSITIVE_INFINITY && value != f64.NEGATIVE_INFINITY;
}

@inline
function isCanonicalZero(value: f64): bool {
  return reinterpret<u64>(value) == 0;
}

@inline
function isSupportedEquation(equation: i32): bool {
  return equation == FORMULA_EQUATION_Y || equation == FORMULA_EQUATION_DY || equation == FORMULA_EQUATION_DDY;
}

@inline
function rangesOverlap(leftPointer: u32, leftByteLength: u32, rightPointer: u32, rightByteLength: u32): bool {
  const leftEnd = <u64>leftPointer + leftByteLength;
  const rightEnd = <u64>rightPointer + rightByteLength;
  return <u64>leftPointer < rightEnd && <u64>rightPointer < leftEnd;
}

/** Writes one legal fresh or resumable scalar state without allocating managed objects. */
export function initializeTrajectoryScalarState(
  statePointer: u32,
  equation: i32,
  currentX: f64,
  currentY: f64,
  currentDy: f64,
  previousX: f64,
  previousY: f64,
  previousDy: f64,
  sampleIndex: u32,
  hasPreviousPoint: bool,
): void {
  requireArenaRange(statePointer, TRAJECTORY_SCALAR_STATE_BYTE_LENGTH, sizeof<f64>());
  if (
    !isSupportedEquation(equation) ||
    !isFiniteValue(currentX) ||
    !isFiniteValue(currentY) ||
    (hasPreviousPoint && (!isFiniteValue(previousX) || !isFiniteValue(previousY))) ||
    (hasPreviousPoint ? sampleIndex == 0 : sampleIndex != 0) ||
    (equation == FORMULA_EQUATION_DDY &&
      (!isFiniteValue(currentDy) || (hasPreviousPoint && !isFiniteValue(previousDy))))
  ) {
    trap();
  }

  store<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET, currentX);
  store<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET, currentY);
  store<f64>(statePointer + TRAJECTORY_SCALAR_STATE_PREVIOUS_X_OFFSET, hasPreviousPoint ? previousX : 0);
  store<f64>(statePointer + TRAJECTORY_SCALAR_STATE_PREVIOUS_Y_OFFSET, hasPreviousPoint ? previousY : 0);
  store<f64>(statePointer + TRAJECTORY_SCALAR_STATE_DY_OFFSET, equation == FORMULA_EQUATION_DDY ? currentDy : 0);
  store<f64>(
    statePointer + TRAJECTORY_SCALAR_STATE_PREVIOUS_DY_OFFSET,
    equation == FORMULA_EQUATION_DDY && hasPreviousPoint ? previousDy : 0,
  );
  store<u32>(statePointer + TRAJECTORY_SCALAR_STATE_SAMPLE_INDEX_OFFSET, sampleIndex);
  store<u32>(statePointer + TRAJECTORY_SCALAR_STATE_MIN_STEP_JUMP_COUNT_OFFSET, 0);
  store<u32>(
    statePointer + TRAJECTORY_SCALAR_STATE_FLAGS_OFFSET,
    (hasPreviousPoint ? TRAJECTORY_SCALAR_STATE_FLAG_HAS_PREVIOUS_POINT : 0) |
      (equation == FORMULA_EQUATION_DDY ? TRAJECTORY_SCALAR_STATE_FLAG_HAS_DY : 0) |
      (equation == FORMULA_EQUATION_DDY && hasPreviousPoint
        ? TRAJECTORY_SCALAR_STATE_FLAG_HAS_PREVIOUS_DY
        : 0),
  );
}

/** First-order RK4 y update shared by launch-angle iteration and scalar trajectory replay. */
export function evaluateFirstOrderFormulaRk4Y(
  materialResultPointer: u32,
  x: f64,
  y: f64,
  step: f64,
  baseY: f64,
  protectionPointer: u32,
): f64 {
  const k1 = evaluateFormulaMaterialValue(
    materialResultPointer,
    FORMULA_EQUATION_DY,
    x,
    y,
    0,
    baseY,
    protectionPointer,
  );
  const k2 = evaluateFormulaMaterialValue(
    materialResultPointer,
    FORMULA_EQUATION_DY,
    x + 0.5 * step,
    y + 0.5 * step * k1,
    0,
    baseY,
    protectionPointer,
  );
  const k3 = evaluateFormulaMaterialValue(
    materialResultPointer,
    FORMULA_EQUATION_DY,
    x + 0.5 * step,
    y + 0.5 * step * k2,
    0,
    baseY,
    protectionPointer,
  );
  const k4 = evaluateFormulaMaterialValue(
    materialResultPointer,
    FORMULA_EQUATION_DY,
    x + step,
    y + step * k3,
    0,
    baseY,
    protectionPointer,
  );
  return y + (step / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
}

/**
 * Replays y/y'/y'' formula physics until the first accepted point with `x >= stopX` or a simulator terminal state.
 *
 * No points array or callback crosses this primitive. The state and result records are allocated by the caller and
 * may be reused by launch/refinement loops without growing memory or creating AssemblyScript managed objects.
 */
export function replayFormulaTrajectoryScalarToStopX(
  materialResultPointer: u32,
  equation: i32,
  baseY: f64,
  yOffset: f64,
  boundsMinX: f64,
  boundsMaxX: f64,
  boundsMinY: f64,
  boundsMaxY: f64,
  stopX: f64,
  protectionPointer: u32,
  statePointer: u32,
  resultPointer: u32,
  shouldSkipInitialStop: bool,
): void {
  replayFormulaTrajectoryScalarToStopXInternal(
    materialResultPointer,
    equation,
    baseY,
    yOffset,
    boundsMinX,
    boundsMaxX,
    boundsMinY,
    boundsMaxY,
    stopX,
    protectionPointer,
    statePointer,
    resultPointer,
    shouldSkipInitialStop,
    0,
    false,
    0,
    0,
  );
}

/** Replays the same scalar trajectory while recording whether any published sample point occupies the raw mask. */
export function replayFormulaTrajectoryScalarToStopXWithMask(
  materialResultPointer: u32,
  equation: i32,
  baseY: f64,
  yOffset: f64,
  boundsMinX: f64,
  boundsMaxX: f64,
  boundsMinY: f64,
  boundsMaxY: f64,
  stopX: f64,
  protectionPointer: u32,
  statePointer: u32,
  resultPointer: u32,
  shouldSkipInitialStop: bool,
  maskPointer: u32,
): void {
  if (maskPointer == 0) {
    trap();
  }
  requireArenaRange(maskPointer, <u32>(getGraphwarPlaneLength() * getGraphwarPlaneHeight()), 1);
  replayFormulaTrajectoryScalarToStopXInternal(
    materialResultPointer,
    equation,
    baseY,
    yOffset,
    boundsMinX,
    boundsMaxX,
    boundsMinY,
    boundsMaxY,
    stopX,
    protectionPointer,
    statePointer,
    resultPointer,
    shouldSkipInitialStop,
    maskPointer,
    false,
    0,
    0,
  );
}

/** Adds an exact accepted min-step jump count restricted to one candidate window without inheriting prefix jumps. */
export function replayFormulaTrajectoryScalarToStopXWithMaskAndJumpWindow(
  materialResultPointer: u32,
  equation: i32,
  baseY: f64,
  yOffset: f64,
  boundsMinX: f64,
  boundsMaxX: f64,
  boundsMinY: f64,
  boundsMaxY: f64,
  stopX: f64,
  protectionPointer: u32,
  statePointer: u32,
  resultPointer: u32,
  shouldSkipInitialStop: bool,
  maskPointer: u32,
  jumpWindowStartX: f64,
  jumpWindowEndX: f64,
): void {
  if (!isFiniteValue(jumpWindowStartX) || !isFiniteValue(jumpWindowEndX) || !(jumpWindowEndX > jumpWindowStartX)) {
    trap();
  }
  if (maskPointer != 0) {
    requireArenaRange(maskPointer, <u32>(getGraphwarPlaneLength() * getGraphwarPlaneHeight()), 1);
  }
  replayFormulaTrajectoryScalarToStopXInternal(
    materialResultPointer,
    equation,
    baseY,
    yOffset,
    boundsMinX,
    boundsMaxX,
    boundsMinY,
    boundsMaxY,
    stopX,
    protectionPointer,
    statePointer,
    resultPointer,
    shouldSkipInitialStop,
    maskPointer,
    true,
    jumpWindowStartX,
    jumpWindowEndX,
  );
}

function replayFormulaTrajectoryScalarToStopXInternal(
  materialResultPointer: u32,
  equation: i32,
  baseY: f64,
  yOffset: f64,
  boundsMinX: f64,
  boundsMaxX: f64,
  boundsMinY: f64,
  boundsMaxY: f64,
  stopX: f64,
  protectionPointer: u32,
  statePointer: u32,
  resultPointer: u32,
  shouldSkipInitialStop: bool,
  maskPointer: u32,
  hasJumpWindow: bool,
  jumpWindowStartX: f64,
  jumpWindowEndX: f64,
): void {
  requireGraphwarGameConstantsInitialized();
  requireArenaRange(materialResultPointer, FORMULA_RESULT_BYTE_LENGTH, sizeof<f64>());
  requireArenaRange(statePointer, TRAJECTORY_SCALAR_STATE_BYTE_LENGTH, sizeof<f64>());
  requireArenaRange(resultPointer, TRAJECTORY_SCALAR_RESULT_BYTE_LENGTH, sizeof<f64>());
  const hasTerminalProbeYBounds =
    boundsMinY == f64.NEGATIVE_INFINITY && boundsMaxY == f64.POSITIVE_INFINITY;
  if (
    rangesOverlap(
      statePointer,
      TRAJECTORY_SCALAR_STATE_BYTE_LENGTH,
      resultPointer,
      TRAJECTORY_SCALAR_RESULT_BYTE_LENGTH,
    ) ||
    !isSupportedEquation(equation) ||
    !isFiniteValue(baseY) ||
    !isFiniteValue(yOffset) ||
    (equation != FORMULA_EQUATION_Y && !isCanonicalZero(yOffset)) ||
    !isFiniteValue(boundsMinX) ||
    !isFiniteValue(boundsMaxX) ||
    ((!isFiniteValue(boundsMinY) || !isFiniteValue(boundsMaxY)) && !hasTerminalProbeYBounds) ||
    !isFiniteValue(stopX)
  ) {
    trap();
  }
  validateTrajectoryScalarState(statePointer, equation);

  memory.fill(resultPointer, 0, TRAJECTORY_SCALAR_RESULT_BYTE_LENGTH);
  store<i32>(resultPointer + TRAJECTORY_SCALAR_RESULT_STOP_REASON_OFFSET, TRAJECTORY_SCALAR_STOP_REASON_NOT_RUN);
  if (
    maskPointer != 0 &&
    trajectoryScalarPointHitsObstacle(
      load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET),
      load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET),
      boundsMinX,
      boundsMaxX,
      boundsMinY,
      boundsMaxY,
      maskPointer,
    )
  ) {
    store<u32>(resultPointer + TRAJECTORY_SCALAR_RESULT_FLAGS_OFFSET, TRAJECTORY_SCALAR_RESULT_FLAG_OBSTACLE_HIT);
  }
  if (
    !shouldSkipInitialStop &&
    load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET) >= stopX
  ) {
    writeTrajectoryScalarResult(resultPointer, statePointer, equation, TRAJECTORY_SCALAR_STOP_REASON_STOP_X);
    return;
  }

  const minX = NativeMath.min(boundsMinX, boundsMaxX);
  const maxX = NativeMath.max(boundsMinX, boundsMaxX);
  const minY = NativeMath.min(boundsMinY, boundsMaxY);
  const maxY = NativeMath.max(boundsMinY, boundsMaxY);
  const maximumSampleIndex = getGraphwarFuncMaxSteps() - 1;
  while (true) {
    if (load<u32>(statePointer + TRAJECTORY_SCALAR_STATE_SAMPLE_INDEX_OFFSET) >= maximumSampleIndex) {
      writeTrajectoryScalarResult(resultPointer, statePointer, equation, TRAJECTORY_SCALAR_STOP_REASON_MAX_STEPS);
      return;
    }

    let step = getGraphwarStepSize();
    calculateNextTrajectoryScalar(
      materialResultPointer,
      equation,
      baseY,
      yOffset,
      protectionPointer,
      statePointer,
      resultPointer,
      step,
    );
    let isCandidateFinite = isTrajectoryScalarCandidateFinite(resultPointer, equation);
    while (isCandidateFinite && isTrajectoryScalarCandidateTooDistant(resultPointer, statePointer)) {
      if (
        load<f64>(resultPointer + TRAJECTORY_SCALAR_RESULT_CURRENT_X_OFFSET) -
          load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET) <=
        getGraphwarFuncMinXStepDistance()
      ) {
        if (equation == FORMULA_EQUATION_Y) {
          writeTrajectoryScalarResult(resultPointer, statePointer, equation, TRAJECTORY_SCALAR_STOP_REASON_TOO_STEEP);
          return;
        }
        break;
      }
      step /= 2;
      store<u32>(
        resultPointer + TRAJECTORY_SCALAR_RESULT_BISECTION_COUNT_OFFSET,
        load<u32>(resultPointer + TRAJECTORY_SCALAR_RESULT_BISECTION_COUNT_OFFSET) + 1,
      );
      calculateNextTrajectoryScalar(
        materialResultPointer,
        equation,
        baseY,
        yOffset,
        protectionPointer,
        statePointer,
        resultPointer,
        step,
      );
      isCandidateFinite = isTrajectoryScalarCandidateFinite(resultPointer, equation);
    }
    if (!isCandidateFinite) {
      writeTrajectoryScalarResult(resultPointer, statePointer, equation, TRAJECTORY_SCALAR_STOP_REASON_INVALID);
      return;
    }

    acceptTrajectoryScalarCandidate(statePointer, resultPointer, equation);
    const currentX = load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET);
    const currentY = load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET);
    if (currentX < minX || currentX > maxX || currentY < minY || currentY > maxY) {
      writeTrajectoryScalarResult(resultPointer, statePointer, equation, TRAJECTORY_SCALAR_STOP_REASON_OUT_OF_BOUNDS);
      return;
    }
    if (hasJumpWindow && acceptedTrajectoryScalarJumpIntersectsWindow(statePointer, jumpWindowStartX, jumpWindowEndX)) {
      store<u32>(
        resultPointer + TRAJECTORY_SCALAR_RESULT_FLAGS_OFFSET,
        load<u32>(resultPointer + TRAJECTORY_SCALAR_RESULT_FLAGS_OFFSET) +
          (1 << TRAJECTORY_SCALAR_RESULT_JUMP_WINDOW_COUNT_SHIFT),
      );
    }
    if (
      maskPointer != 0 &&
      trajectoryScalarPointHitsObstacle(
        currentX,
        currentY,
        boundsMinX,
        boundsMaxX,
        boundsMinY,
        boundsMaxY,
        maskPointer,
      )
    ) {
      store<u32>(resultPointer + TRAJECTORY_SCALAR_RESULT_FLAGS_OFFSET, TRAJECTORY_SCALAR_RESULT_FLAG_OBSTACLE_HIT);
    }
    if (currentX >= stopX) {
      writeTrajectoryScalarResult(resultPointer, statePointer, equation, TRAJECTORY_SCALAR_STOP_REASON_STOP_X);
      return;
    }
  }
}

function acceptedTrajectoryScalarJumpIntersectsWindow(statePointer: u32, startX: f64, endX: f64): bool {
  const previousX = load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_PREVIOUS_X_OFFSET);
  const previousY = load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_PREVIOUS_Y_OFFSET);
  const currentX = load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET);
  const currentY = load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET);
  const dx = currentX - previousX;
  const dy = currentY - previousY;
  return (
    currentX >= startX &&
    previousX <= endX &&
    dx <= getGraphwarFuncMinXStepDistance() &&
    dx * dx + dy * dy > getGraphwarFuncMaxStepDistanceSquared()
  );
}

/** Step-glitch collision semantics inspect published point cells, not the deliberately tunnelling jump segment. */
function trajectoryScalarPointHitsObstacle(
  x: f64,
  y: f64,
  boundsMinX: f64,
  boundsMaxX: f64,
  boundsMinY: f64,
  boundsMaxY: f64,
  maskPointer: u32,
): bool {
  const planeX = NativeMath.floor(((x - boundsMinX) / (boundsMaxX - boundsMinX)) * getGraphwarPlaneLength());
  const planeY = NativeMath.floor(((boundsMaxY - y) / (boundsMaxY - boundsMinY)) * getGraphwarPlaneHeight());
  if (
    !isFiniteValue(planeX) ||
    !isFiniteValue(planeY) ||
    planeX < 0 ||
    planeX >= getGraphwarPlaneLength() ||
    planeY < 0 ||
    planeY >= getGraphwarPlaneHeight()
  ) {
    return true;
  }
  return load<u8>(maskPointer + <u32>planeY * <u32>getGraphwarPlaneLength() + <u32>planeX) != 0;
}

function validateTrajectoryScalarState(statePointer: u32, equation: i32): void {
  const flags = load<u32>(statePointer + TRAJECTORY_SCALAR_STATE_FLAGS_OFFSET);
  const allowedFlags =
    TRAJECTORY_SCALAR_STATE_FLAG_HAS_PREVIOUS_POINT |
    TRAJECTORY_SCALAR_STATE_FLAG_HAS_DY |
    TRAJECTORY_SCALAR_STATE_FLAG_HAS_PREVIOUS_DY;
  const hasPreviousPoint = (flags & TRAJECTORY_SCALAR_STATE_FLAG_HAS_PREVIOUS_POINT) != 0;
  const hasDy = (flags & TRAJECTORY_SCALAR_STATE_FLAG_HAS_DY) != 0;
  const hasPreviousDy = (flags & TRAJECTORY_SCALAR_STATE_FLAG_HAS_PREVIOUS_DY) != 0;
  const sampleIndex = load<u32>(statePointer + TRAJECTORY_SCALAR_STATE_SAMPLE_INDEX_OFFSET);
  const currentX = load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET);
  const currentY = load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET);
  const previousX = load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_PREVIOUS_X_OFFSET);
  const previousY = load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_PREVIOUS_Y_OFFSET);
  const currentDy = load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_DY_OFFSET);
  const previousDy = load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_PREVIOUS_DY_OFFSET);
  if (
    (flags & ~allowedFlags) != 0 ||
    !isFiniteValue(currentX) ||
    !isFiniteValue(currentY) ||
    (hasPreviousPoint ? sampleIndex == 0 : sampleIndex != 0) ||
    (hasPreviousPoint
      ? !isFiniteValue(previousX) || !isFiniteValue(previousY)
      : !isCanonicalZero(previousX) || !isCanonicalZero(previousY))
  ) {
    trap();
  }
  if (equation == FORMULA_EQUATION_DDY) {
    if (
      !hasDy ||
      hasPreviousDy != hasPreviousPoint ||
      !isFiniteValue(currentDy) ||
      (hasPreviousDy ? !isFiniteValue(previousDy) : !isCanonicalZero(previousDy))
    ) {
      trap();
    }
  } else if (hasDy || hasPreviousDy || !isCanonicalZero(currentDy) || !isCanonicalZero(previousDy)) {
    trap();
  }
}

function calculateNextTrajectoryScalar(
  materialResultPointer: u32,
  equation: i32,
  baseY: f64,
  yOffset: f64,
  protectionPointer: u32,
  statePointer: u32,
  resultPointer: u32,
  step: f64,
): void {
  const x = load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET);
  const y = load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET);
  const nextX = x + step;
  store<f64>(resultPointer + TRAJECTORY_SCALAR_RESULT_CURRENT_X_OFFSET, nextX);
  if (equation == FORMULA_EQUATION_Y) {
    store<f64>(
      resultPointer + TRAJECTORY_SCALAR_RESULT_CURRENT_Y_OFFSET,
      evaluateFormulaMaterialValue(materialResultPointer, equation, nextX, 0, 0, baseY, protectionPointer) + yOffset,
    );
    store<f64>(resultPointer + TRAJECTORY_SCALAR_RESULT_DY_OFFSET, 0);
    return;
  }

  store<u32>(
    resultPointer + TRAJECTORY_SCALAR_RESULT_RK4_STEP_COUNT_OFFSET,
    load<u32>(resultPointer + TRAJECTORY_SCALAR_RESULT_RK4_STEP_COUNT_OFFSET) + 1,
  );
  if (equation == FORMULA_EQUATION_DY) {
    store<f64>(
      resultPointer + TRAJECTORY_SCALAR_RESULT_CURRENT_Y_OFFSET,
      evaluateFirstOrderFormulaRk4Y(materialResultPointer, x, y, step, baseY, protectionPointer),
    );
    store<f64>(resultPointer + TRAJECTORY_SCALAR_RESULT_DY_OFFSET, 0);
    return;
  }

  const dy = load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_DY_OFFSET);
  const k11 = dy;
  const k12 = evaluateFormulaMaterialValue(materialResultPointer, equation, x, y, dy, baseY, protectionPointer);
  const k21 = dy + (step / 2) * k12;
  const k22 = evaluateFormulaMaterialValue(
    materialResultPointer,
    equation,
    x + step / 2,
    y + (step / 2) * k11,
    dy + (step / 2) * k12,
    baseY,
    protectionPointer,
  );
  const k31 = dy + (step / 2) * k22;
  const k32 = evaluateFormulaMaterialValue(
    materialResultPointer,
    equation,
    x + step / 2,
    y + (step / 2) * k21,
    dy + (step / 2) * k22,
    baseY,
    protectionPointer,
  );
  const k41 = dy + step * k32;
  const k42 = evaluateFormulaMaterialValue(
    materialResultPointer,
    equation,
    x + step,
    y + step * k31,
    dy + step * k32,
    baseY,
    protectionPointer,
  );
  store<f64>(
    resultPointer + TRAJECTORY_SCALAR_RESULT_CURRENT_Y_OFFSET,
    y + (step / 6) * (k11 + 2 * k21 + 2 * k31 + k41),
  );
  store<f64>(
    resultPointer + TRAJECTORY_SCALAR_RESULT_DY_OFFSET,
    dy + (step / 6) * (k12 + 2 * k22 + 2 * k32 + k42),
  );
}

@inline
function isTrajectoryScalarCandidateFinite(resultPointer: u32, equation: i32): bool {
  return (
    isFiniteValue(load<f64>(resultPointer + TRAJECTORY_SCALAR_RESULT_CURRENT_X_OFFSET)) &&
    isFiniteValue(load<f64>(resultPointer + TRAJECTORY_SCALAR_RESULT_CURRENT_Y_OFFSET)) &&
    (equation != FORMULA_EQUATION_DDY ||
      isFiniteValue(load<f64>(resultPointer + TRAJECTORY_SCALAR_RESULT_DY_OFFSET)))
  );
}

@inline
function isTrajectoryScalarCandidateTooDistant(resultPointer: u32, statePointer: u32): bool {
  const dx =
    load<f64>(resultPointer + TRAJECTORY_SCALAR_RESULT_CURRENT_X_OFFSET) -
    load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET);
  const dy =
    load<f64>(resultPointer + TRAJECTORY_SCALAR_RESULT_CURRENT_Y_OFFSET) -
    load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET);
  return dx * dx + dy * dy > getGraphwarFuncMaxStepDistanceSquared();
}

function acceptTrajectoryScalarCandidate(statePointer: u32, resultPointer: u32, equation: i32): void {
  const currentX = load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET);
  const currentY = load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET);
  const currentDy = load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_DY_OFFSET);
  const nextX = load<f64>(resultPointer + TRAJECTORY_SCALAR_RESULT_CURRENT_X_OFFSET);
  const nextY = load<f64>(resultPointer + TRAJECTORY_SCALAR_RESULT_CURRENT_Y_OFFSET);
  const dx = nextX - currentX;
  const dy = nextY - currentY;
  if (dx <= getGraphwarFuncMinXStepDistance() && dx * dx + dy * dy > getGraphwarFuncMaxStepDistanceSquared()) {
    store<u32>(
      statePointer + TRAJECTORY_SCALAR_STATE_MIN_STEP_JUMP_COUNT_OFFSET,
      load<u32>(statePointer + TRAJECTORY_SCALAR_STATE_MIN_STEP_JUMP_COUNT_OFFSET) + 1,
    );
  }
  store<f64>(statePointer + TRAJECTORY_SCALAR_STATE_PREVIOUS_X_OFFSET, currentX);
  store<f64>(statePointer + TRAJECTORY_SCALAR_STATE_PREVIOUS_Y_OFFSET, currentY);
  store<f64>(
    statePointer + TRAJECTORY_SCALAR_STATE_PREVIOUS_DY_OFFSET,
    equation == FORMULA_EQUATION_DDY ? currentDy : 0,
  );
  store<f64>(
    statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET,
    nextX,
  );
  store<f64>(
    statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET,
    nextY,
  );
  store<f64>(
    statePointer + TRAJECTORY_SCALAR_STATE_DY_OFFSET,
    equation == FORMULA_EQUATION_DDY
      ? load<f64>(resultPointer + TRAJECTORY_SCALAR_RESULT_DY_OFFSET)
      : 0,
  );
  store<u32>(
    statePointer + TRAJECTORY_SCALAR_STATE_SAMPLE_INDEX_OFFSET,
    load<u32>(statePointer + TRAJECTORY_SCALAR_STATE_SAMPLE_INDEX_OFFSET) + 1,
  );
  store<u32>(
    statePointer + TRAJECTORY_SCALAR_STATE_FLAGS_OFFSET,
    TRAJECTORY_SCALAR_STATE_FLAG_HAS_PREVIOUS_POINT |
      (equation == FORMULA_EQUATION_DDY
        ? TRAJECTORY_SCALAR_STATE_FLAG_HAS_DY | TRAJECTORY_SCALAR_STATE_FLAG_HAS_PREVIOUS_DY
        : 0),
  );
}

function writeTrajectoryScalarResult(
  resultPointer: u32,
  statePointer: u32,
  equation: i32,
  stopReason: i32,
): void {
  store<i32>(resultPointer + TRAJECTORY_SCALAR_RESULT_STOP_REASON_OFFSET, stopReason);
  store<u32>(
    resultPointer + TRAJECTORY_SCALAR_RESULT_SAMPLE_INDEX_OFFSET,
    load<u32>(statePointer + TRAJECTORY_SCALAR_STATE_SAMPLE_INDEX_OFFSET),
  );
  store<f64>(
    resultPointer + TRAJECTORY_SCALAR_RESULT_CURRENT_X_OFFSET,
    load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET),
  );
  store<f64>(
    resultPointer + TRAJECTORY_SCALAR_RESULT_CURRENT_Y_OFFSET,
    load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET),
  );
  store<f64>(
    resultPointer + TRAJECTORY_SCALAR_RESULT_DY_OFFSET,
    equation == FORMULA_EQUATION_DDY ? load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_DY_OFFSET) : 0,
  );
  store<u32>(
    resultPointer + TRAJECTORY_SCALAR_RESULT_MIN_STEP_JUMP_COUNT_OFFSET,
    load<u32>(statePointer + TRAJECTORY_SCALAR_STATE_MIN_STEP_JUMP_COUNT_OFFSET),
  );
}
