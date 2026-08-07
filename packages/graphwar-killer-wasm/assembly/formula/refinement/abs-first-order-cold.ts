import { runCurveBatch } from "../curves";
import {
  FORMULA_EQUATION_DY,
  FORMULA_INPUT_BOUNDS_MAX_X_OFFSET,
  FORMULA_INPUT_BOUNDS_MAX_Y_OFFSET,
  FORMULA_INPUT_BOUNDS_MIN_X_OFFSET,
  FORMULA_INPUT_BOUNDS_MIN_Y_OFFSET,
  FORMULA_INPUT_DISABLED_SEGMENT_POINTER_OFFSET,
  FORMULA_INPUT_POINT_COUNT_OFFSET,
  FORMULA_INPUT_POINT_X_POINTER_OFFSET,
  FORMULA_INPUT_POINT_Y_POINTER_OFFSET,
  FORMULA_INPUT_SEGMENT_START_X_POINTER_OFFSET,
  FORMULA_INPUT_SEGMENT_START_Y_POINTER_OFFSET,
  FORMULA_INPUT_SIGN_PROTECTION_POINTER_OFFSET,
  FORMULA_RESULT_PROTECTION_COUNT_OFFSET,
  FORMULA_RESULT_PROTECTION_POINTER_OFFSET,
} from "../layout";
import { markArena, reserveArena, resetArena } from "../../core/memory";
import {
  recordTrajectoryDebugScalarReplay,
  replayFormulaTrajectoryScalarToStopX,
  TRAJECTORY_SCALAR_RESULT_BYTE_LENGTH,
  TRAJECTORY_SCALAR_RESULT_STOP_REASON_OFFSET,
  TRAJECTORY_SCALAR_STATE_BYTE_LENGTH,
  TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET,
  TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET,
  TRAJECTORY_SCALAR_STOP_REASON_STOP_X,
} from "../../trajectory/scalar";

export const ABS_FIRST_ORDER_COLD_REFINEMENT_INVALID: i32 = 0;
export const ABS_FIRST_ORDER_COLD_REFINEMENT_SUCCESS: i32 = 1;
export const ABS_FIRST_ORDER_COLD_REFINEMENT_PROTECTION_CHANGED: i32 = 2;

/** Formula-launch owns the angle iteration and writes the corresponding fresh scalar launch state. */
export type AbsFirstOrderColdLaunchStateInitializer = (
  materialResultPointer: u32,
  equation: i32,
  baseY: f64,
  protectionPointer: u32,
  statePointer: u32,
  contextPointer: u32,
) => bool;

@inline
function isFiniteValue(value: f64): bool {
  return value == value && value != f64.POSITIVE_INFINITY && value != f64.NEGATIVE_INFINITY;
}

/**
 * Collects the first real accepted overshoot at every ABS y' connector boundary.
 *
 * Current and future connectors stay disabled while the boundary is resolved, so the accepted state is evidence
 * produced only by the frozen prefix. The installed start-point arrays are then consumed atomically by the final
 * connector build; no Step delta override is involved in ABS materials.
 */
export function collectAbsFirstOrderSegmentStartsCold(
  inputPointer: u32,
  buildInputPointer: u32,
  formulaPointXPointer: u32,
  formulaPointYPointer: u32,
  combinedProtectionPointer: u32,
  launchContextPointer: u32,
  initializeLaunchState: AbsFirstOrderColdLaunchStateInitializer,
): i32 {
  const pointCount = load<u32>(inputPointer + FORMULA_INPUT_POINT_COUNT_OFFSET);
  const segmentCount = pointCount - 1;
  const pointByteLength = checkedByteLength(pointCount, sizeof<f64>());
  const rawPointXPointer = load<u32>(inputPointer + FORMULA_INPUT_POINT_X_POINTER_OFFSET);
  const protectionPointer = load<u32>(buildInputPointer + FORMULA_INPUT_SIGN_PROTECTION_POINTER_OFFSET);
  const boundsMinX = load<f64>(inputPointer + FORMULA_INPUT_BOUNDS_MIN_X_OFFSET);
  const boundsMaxX = load<f64>(inputPointer + FORMULA_INPUT_BOUNDS_MAX_X_OFFSET);
  const boundsMinY = load<f64>(inputPointer + FORMULA_INPUT_BOUNDS_MIN_Y_OFFSET);
  const boundsMaxY = load<f64>(inputPointer + FORMULA_INPUT_BOUNDS_MAX_Y_OFFSET);
  const disabledPointer = reserveArena(segmentCount, 1);
  const segmentStartXPointer = reserveArena(pointByteLength, sizeof<f64>());
  const segmentStartYPointer = reserveArena(pointByteLength, sizeof<f64>());
  memory.fill(disabledPointer, 1, segmentCount);
  fillFloat64NaN(segmentStartXPointer, pointCount);
  fillFloat64NaN(segmentStartYPointer, pointCount);
  store<u32>(buildInputPointer + FORMULA_INPUT_DISABLED_SEGMENT_POINTER_OFFSET, disabledPointer);
  store<u32>(buildInputPointer + FORMULA_INPUT_SEGMENT_START_X_POINTER_OFFSET, segmentStartXPointer);
  store<u32>(buildInputPointer + FORMULA_INPUT_SEGMENT_START_Y_POINTER_OFFSET, segmentStartYPointer);
  store<u32>(buildInputPointer + FORMULA_INPUT_POINT_X_POINTER_OFFSET, formulaPointXPointer);
  store<u32>(buildInputPointer + FORMULA_INPUT_POINT_Y_POINTER_OFFSET, formulaPointYPointer);

  const baseY = load<f64>(formulaPointYPointer);
  const boundaryStatePointer = reserveArena(TRAJECTORY_SCALAR_STATE_BYTE_LENGTH, sizeof<f64>());
  const resultPointer = reserveArena(TRAJECTORY_SCALAR_RESULT_BYTE_LENGTH, sizeof<f64>());
  let hasBoundaryState = false;
  let hasProtectionChanged = false;
  let segmentIndex: u32 = 0;
  while (segmentIndex < segmentCount) {
    const segmentMark = markArena();
    if (segmentIndex > 0) {
      if (!hasBoundaryState) {
        resetArena(segmentMark);
        return hasProtectionChanged
          ? ABS_FIRST_ORDER_COLD_REFINEMENT_PROTECTION_CHANGED
          : ABS_FIRST_ORDER_COLD_REFINEMENT_INVALID;
      }
      const startX = load<f64>(boundaryStatePointer + TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET);
      const startY = load<f64>(boundaryStatePointer + TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET);
      if (!isFiniteValue(startX) || !isFiniteValue(startY)) {
        resetArena(segmentMark);
        return hasProtectionChanged
          ? ABS_FIRST_ORDER_COLD_REFINEMENT_PROTECTION_CHANGED
          : ABS_FIRST_ORDER_COLD_REFINEMENT_INVALID;
      }
      store<f64>(segmentStartXPointer + segmentIndex * sizeof<f64>(), startX);
      store<f64>(segmentStartYPointer + segmentIndex * sizeof<f64>(), startY);
    }

    store<u8>(disabledPointer + segmentIndex, 0);
    if (segmentIndex + 1 == segmentCount) {
      // TS only samples connector boundaries needed by a following segment. The final segment is enabled here and
      // is evaluated by the post-refinement identity solve and final trajectory instead of an extra prefix replay.
      resetArena(segmentMark);
      segmentIndex += 1;
      continue;
    }
    const candidateMaterialPointer = runCurveBatch(buildInputPointer);
    const isCandidateLaunchValid = initializeLaunchState(
      candidateMaterialPointer,
      FORMULA_EQUATION_DY,
      baseY,
      protectionPointer,
      boundaryStatePointer,
      launchContextPointer,
    );
    mergeObservedProtection(candidateMaterialPointer, combinedProtectionPointer, segmentCount);
    if (hasNewProtection(combinedProtectionPointer, protectionPointer, segmentCount)) {
      hasProtectionChanged = true;
    }
    if (!isCandidateLaunchValid) {
      resetArena(segmentMark);
      return hasProtectionChanged
        ? ABS_FIRST_ORDER_COLD_REFINEMENT_PROTECTION_CHANGED
        : ABS_FIRST_ORDER_COLD_REFINEMENT_INVALID;
    }
    replayFormulaTrajectoryScalarToStopX(
      candidateMaterialPointer,
      FORMULA_EQUATION_DY,
      baseY,
      0,
      boundsMinX,
      boundsMaxX,
      boundsMinY,
      boundsMaxY,
      load<f64>(rawPointXPointer + (segmentIndex + 1) * sizeof<f64>()),
      protectionPointer,
      boundaryStatePointer,
      resultPointer,
      false,
    );
    recordTrajectoryDebugScalarReplay(resultPointer);
    mergeObservedProtection(candidateMaterialPointer, combinedProtectionPointer, segmentCount);
    if (hasNewProtection(combinedProtectionPointer, protectionPointer, segmentCount)) {
      hasProtectionChanged = true;
    }
    if (load<i32>(resultPointer + TRAJECTORY_SCALAR_RESULT_STOP_REASON_OFFSET) != TRAJECTORY_SCALAR_STOP_REASON_STOP_X) {
      resetArena(segmentMark);
      return hasProtectionChanged
        ? ABS_FIRST_ORDER_COLD_REFINEMENT_PROTECTION_CHANGED
        : ABS_FIRST_ORDER_COLD_REFINEMENT_INVALID;
    }
    hasBoundaryState = true;
    resetArena(segmentMark);
    segmentIndex += 1;
  }
  return hasProtectionChanged
    ? ABS_FIRST_ORDER_COLD_REFINEMENT_PROTECTION_CHANGED
    : ABS_FIRST_ORDER_COLD_REFINEMENT_SUCCESS;
}

function mergeObservedProtection(resultPointer: u32, combinedPointer: u32, segmentCount: u32): void {
  const observedPointer = load<u32>(resultPointer + FORMULA_RESULT_PROTECTION_POINTER_OFFSET);
  if (load<u32>(resultPointer + FORMULA_RESULT_PROTECTION_COUNT_OFFSET) != segmentCount) {
    unreachable();
  }
  let index: u32 = 0;
  while (index < segmentCount) {
    const pointer = combinedPointer + index * sizeof<u32>();
    store<u32>(pointer, load<u32>(pointer) | load<u32>(observedPointer + index * sizeof<u32>()));
    index += 1;
  }
}

function hasNewProtection(combinedPointer: u32, inputPointer: u32, segmentCount: u32): bool {
  let index: u32 = 0;
  while (index < segmentCount) {
    if ((load<u32>(combinedPointer + index * sizeof<u32>()) & ~load<u32>(inputPointer + index * sizeof<u32>())) != 0) {
      return true;
    }
    index += 1;
  }
  return false;
}

function fillFloat64NaN(pointer: u32, count: u32): void {
  let index: u32 = 0;
  while (index < count) {
    store<f64>(pointer + index * sizeof<f64>(), f64.NaN);
    index += 1;
  }
}

@inline
function checkedByteLength(count: u32, stride: u32): u32 {
  const byteLength = <u64>count * stride;
  if (byteLength > 0xffff_ffff) {
    unreachable();
  }
  return <u32>byteLength;
}
