import {
  FORMULA_EQUATION_DDY,
  FORMULA_LAUNCH_RESULT_ANGLE_OFFSET,
  FORMULA_LAUNCH_RESULT_INITIAL_DY_OFFSET,
  FORMULA_LAUNCH_RESULT_MATERIAL_RESULT_POINTER_OFFSET,
  FORMULA_LAUNCH_RESULT_FORMULA_POINT_Y_POINTER_OFFSET,
  FORMULA_LAUNCH_RESULT_PROTECTION_POINTER_OFFSET,
  FORMULA_LAUNCH_RESULT_PROTECTION_COUNT_OFFSET,
  FORMULA_LAUNCH_RESULT_STATUS_OFFSET,
  FORMULA_LAUNCH_RESULT_X_OFFSET,
  FORMULA_LAUNCH_RESULT_Y_OFFSET,
  FORMULA_LAUNCH_RESULT_Y_OFFSET_VALUE_OFFSET,
  FORMULA_LAUNCH_STATUS_SUCCESS,
  FORMULA_INPUT_POINT_COUNT_OFFSET,
  FORMULA_INPUT_POINT_X_POINTER_OFFSET,
  FORMULA_INPUT_POINT_Y_POINTER_OFFSET,
  FORMULA_INPUT_MASK_BYTE_LENGTH_OFFSET,
  FORMULA_INPUT_MASK_POINTER_OFFSET,
  FORMULA_INPUT_SIGN_PROTECTION_COUNT_OFFSET,
  FORMULA_INPUT_SIGN_PROTECTION_POINTER_OFFSET,
  FORMULA_INPUT_STEP_OVERFLOW_RANGE_COUNT_OFFSET,
  FORMULA_INPUT_STEP_OVERFLOW_RANGE_POINTER_OFFSET,
  FORMULA_RESULT_PROTECTION_COUNT_OFFSET,
  FORMULA_RESULT_PROTECTION_POINTER_OFFSET,
} from "./formula-layout";
import { mergeProtectionBits, runPrepareLaunch } from "./formula-launch";
import {
  getGraphwarFuncMaxSteps,
  getGraphwarPlaneHeight,
  getGraphwarPlaneLength,
  requireGraphwarGameConstantsInitialized,
} from "./game-constants";
import {
  commitArena,
  markArena,
  requireArenaInitialized,
  requireArenaRange,
  reserveArena,
  resetArena,
} from "./memory";
import {
  beginTrajectoryDebugCounters,
  endTrajectoryDebugCounters,
  getTrajectoryDebugCounter,
  initializeTrajectoryScalarState,
  recordTrajectoryDebugScalarReplay,
  replayFormulaTrajectoryScalarToStopXWithPoints,
  replayFormulaTrajectoryScalarWithTargetsAndPoints,
  TRAJECTORY_SCALAR_RESULT_DY_OFFSET,
  TRAJECTORY_SCALAR_RESULT_CURRENT_X_OFFSET,
  TRAJECTORY_SCALAR_RESULT_CURRENT_Y_OFFSET,
  TRAJECTORY_SCALAR_RESULT_FLAGS_OFFSET,
  TRAJECTORY_SCALAR_RESULT_STOP_REASON_OFFSET,
  TRAJECTORY_SCALAR_STOP_REASON_STOP_X,
  TRAJECTORY_SCALAR_STOP_REASON_TARGET,
  TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET,
  TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET,
  TRAJECTORY_SCALAR_STATE_DY_OFFSET,
  TRAJECTORY_SCALAR_STATE_FLAGS_OFFSET,
  TRAJECTORY_SCALAR_STATE_FLAG_HAS_DY,
  TRAJECTORY_SCALAR_STATE_FLAG_HAS_PREVIOUS_DY,
  TRAJECTORY_SCALAR_STATE_FLAG_HAS_PREVIOUS_POINT,
  TRAJECTORY_SCALAR_STATE_PREVIOUS_DY_OFFSET,
  TRAJECTORY_SCALAR_STATE_PREVIOUS_X_OFFSET,
  TRAJECTORY_SCALAR_STATE_PREVIOUS_Y_OFFSET,
  TRAJECTORY_SCALAR_STATE_SAMPLE_INDEX_OFFSET,
  TRAJECTORY_SCALAR_STATE_BYTE_LENGTH,
  TRAJECTORY_SCALAR_RESULT_BYTE_LENGTH,
  TRAJECTORY_DEBUG_ACCEPTED_SAMPLE_POINT_COUNT_FIELD_OFFSET,
  TRAJECTORY_DEBUG_BISECTION_COUNT_FIELD_OFFSET,
  TRAJECTORY_DEBUG_COUNTER_BYTE_LENGTH,
  TRAJECTORY_DEBUG_MIN_STEP_JUMP_COUNT_FIELD_OFFSET,
  TRAJECTORY_DEBUG_REPLAY_COUNT_FIELD_OFFSET,
  TRAJECTORY_DEBUG_RK4_STEP_COUNT_FIELD_OFFSET,
  TRAJECTORY_TARGET_STATE_BYTE_LENGTH,
  TRAJECTORY_TARGET_STATE_OBSTACLE_HIT_INDEX_OFFSET,
  TRAJECTORY_TARGET_STATE_REACHED_ORDERED_COUNT_OFFSET,
  TRAJECTORY_TARGET_STATE_REACHED_REQUIRED_COUNT_OFFSET,
  TRAJECTORY_TARGET_STATE_REQUIRED_HIT_INDEX_OFFSET,
  TRAJECTORY_TARGET_STATE_REQUIRED_HITS_POINTER_OFFSET,
  TRAJECTORY_TARGET_STATE_TARGET_HIT_INDEX_OFFSET,
  TRAJECTORY_TARGET_STATE_TRACKED_HIT_INDEXES_POINTER_OFFSET,
} from "./trajectory-scalar";
import {
  TRAJECTORY_INPUT_BYTE_LENGTH,
  TRAJECTORY_INPUT_BOUNDARY_EXPANSION_OFFSET,
  TRAJECTORY_INPUT_BOUNDS_RECT_HEIGHT_OFFSET,
  TRAJECTORY_INPUT_BOUNDS_RECT_WIDTH_OFFSET,
  TRAJECTORY_INPUT_BOUNDS_RECT_X_OFFSET,
  TRAJECTORY_INPUT_BOUNDS_RECT_Y_OFFSET,
  TRAJECTORY_INPUT_FLAG_COLLECT_VISIBLE_PIXELS,
  TRAJECTORY_INPUT_FLAG_HAS_CONTINUATION_EVIDENCE,
  TRAJECTORY_INPUT_FLAG_HAS_CONTINUE_GRAPH_X,
  TRAJECTORY_INPUT_FLAG_STOP_ON_TARGETS_COMPLETE,
  TRAJECTORY_INPUT_FLAGS_OFFSET,
  TRAJECTORY_INPUT_EVIDENCE_BYTE_LENGTH_OFFSET,
  TRAJECTORY_INPUT_EVIDENCE_POINTER_OFFSET,
  TRAJECTORY_INPUT_FORMULA_BYTE_LENGTH,
  TRAJECTORY_INPUT_MASK_BYTE_LENGTH_OFFSET,
  TRAJECTORY_INPUT_MASK_POINTER_OFFSET,
  TRAJECTORY_INPUT_MAX_OUTPUT_POINTS_OFFSET,
  TRAJECTORY_INPUT_ORDERED_TARGET_COUNT_OFFSET,
  TRAJECTORY_INPUT_OBSERVATION_X_COUNT_OFFSET,
  TRAJECTORY_INPUT_OBSERVATION_X_POINTER_OFFSET,
  TRAJECTORY_INPUT_QUALITY_POINT_COUNT_OFFSET,
  TRAJECTORY_INPUT_QUALITY_X_POINTER_OFFSET,
  TRAJECTORY_INPUT_QUALITY_Y_POINTER_OFFSET,
  TRAJECTORY_INPUT_REQUIRED_TARGET_COUNT_OFFSET,
  TRAJECTORY_INPUT_STOP_TYPE_NATURAL,
  TRAJECTORY_INPUT_STOP_TYPE_OFFSET,
  TRAJECTORY_INPUT_STOP_TYPE_STOP_X,
  TRAJECTORY_INPUT_STOP_TYPE_TARGETS,
  TRAJECTORY_INPUT_STOP_X_OFFSET,
  TRAJECTORY_INPUT_TARGET_RECORD_POINTER_OFFSET,
  TRAJECTORY_INPUT_TRACKED_TARGET_COUNT_OFFSET,
  TRAJECTORY_RESULT_BYTE_LENGTH,
  TRAJECTORY_RESULT_ACCEPTED_SAMPLE_POINT_COUNT_OFFSET,
  TRAJECTORY_RESULT_BISECTION_COUNT_OFFSET,
  TRAJECTORY_RESULT_CURRENT_DY_OFFSET,
  TRAJECTORY_RESULT_CURRENT_X_OFFSET,
  TRAJECTORY_RESULT_CURRENT_Y_OFFSET,
  TRAJECTORY_RESULT_EVIDENCE_BYTE_LENGTH_OFFSET,
  TRAJECTORY_RESULT_EVIDENCE_POINTER_OFFSET,
  TRAJECTORY_RESULT_FLAG_USED_CONTINUATION,
  TRAJECTORY_RESULT_FLAGS_OFFSET,
  TRAJECTORY_RESULT_INITIAL_DY_OFFSET,
  TRAJECTORY_RESULT_LAUNCH_ANGLE_OFFSET,
  TRAJECTORY_RESULT_LAUNCH_STATUS_OFFSET,
  TRAJECTORY_RESULT_LAUNCH_X_OFFSET,
  TRAJECTORY_RESULT_LAUNCH_Y_OFFSET,
  TRAJECTORY_RESULT_MIN_STEP_JUMP_COUNT_OFFSET,
  TRAJECTORY_RESULT_OBSTACLE_HIT_INDEX_OFFSET,
  TRAJECTORY_RESULT_OBSERVATION_COUNT_OFFSET,
  TRAJECTORY_RESULT_OBSERVATION_POINTER_OFFSET,
  TRAJECTORY_RESULT_POINT_COUNT_OFFSET,
  TRAJECTORY_RESULT_POINT_DY_POINTER_OFFSET,
  TRAJECTORY_RESULT_POINT_X_POINTER_OFFSET,
  TRAJECTORY_RESULT_POINT_Y_POINTER_OFFSET,
  TRAJECTORY_RESULT_FLAG_HAS_PATH_ERROR,
  TRAJECTORY_RESULT_PATH_ERROR_OFFSET,
  TRAJECTORY_RESULT_PREVIOUS_DY_OFFSET,
  TRAJECTORY_RESULT_PREVIOUS_X_OFFSET,
  TRAJECTORY_RESULT_PREVIOUS_Y_OFFSET,
  TRAJECTORY_RESULT_PROTECTION_COUNT_OFFSET,
  TRAJECTORY_RESULT_PROTECTION_POINTER_OFFSET,
  TRAJECTORY_RESULT_RK4_STEP_COUNT_OFFSET,
  TRAJECTORY_RESULT_SAMPLE_INDEX_OFFSET,
  TRAJECTORY_RESULT_STATE_FLAGS_OFFSET,
  TRAJECTORY_RESULT_STATE_FLAG_HAS_DY,
  TRAJECTORY_RESULT_STATE_FLAG_HAS_PREVIOUS_DY,
  TRAJECTORY_RESULT_STATE_FLAG_HAS_PREVIOUS_POINT,
  TRAJECTORY_RESULT_REACHED_ORDERED_TARGET_COUNT_OFFSET,
  TRAJECTORY_RESULT_REACHED_REQUIRED_TARGET_COUNT_OFFSET,
  TRAJECTORY_RESULT_REPLAY_COUNT_OFFSET,
  TRAJECTORY_RESULT_REQUIRED_TARGETS_HIT_INDEX_OFFSET,
  TRAJECTORY_RESULT_STOP_REASON_OFFSET,
  TRAJECTORY_RESULT_TARGET_HIT_INDEX_OFFSET,
  TRAJECTORY_RESULT_TRACKED_TARGET_COUNT_OFFSET,
  TRAJECTORY_RESULT_TRACKED_TARGET_HIT_INDEX_POINTER_OFFSET,
  TRAJECTORY_RESULT_VISIBLE_POINT_COUNT_OFFSET,
  TRAJECTORY_RESULT_VISIBLE_X_POINTER_OFFSET,
  TRAJECTORY_RESULT_VISIBLE_Y_POINTER_OFFSET,
  TRAJECTORY_RESULT_Y_OFFSET_VALUE_OFFSET,
  TRAJECTORY_OBSERVATION_BYTE_LENGTH,
  TRAJECTORY_OBSERVATION_DY_OFFSET,
  TRAJECTORY_OBSERVATION_SAMPLE_INDEX_OFFSET,
  TRAJECTORY_OBSERVATION_X_OFFSET,
  TRAJECTORY_OBSERVATION_Y_OFFSET,
  TRAJECTORY_EVIDENCE_BYTE_LENGTH,
  TRAJECTORY_EVIDENCE_CURRENT_DY_OFFSET,
  TRAJECTORY_EVIDENCE_CURRENT_X_OFFSET,
  TRAJECTORY_EVIDENCE_CURRENT_Y_OFFSET,
  TRAJECTORY_EVIDENCE_DEPENDENCY_HASH_A_OFFSET,
  TRAJECTORY_EVIDENCE_DEPENDENCY_HASH_B_OFFSET,
  TRAJECTORY_EVIDENCE_FLAG_CAN_CONTINUE_TO_LATER_FRONTIER,
  TRAJECTORY_EVIDENCE_FLAG_HAS_DY,
  TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_DY,
  TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_POINT,
  TRAJECTORY_EVIDENCE_FLAG_SKIP_INITIAL_STOP,
  TRAJECTORY_EVIDENCE_FLAGS_OFFSET,
  TRAJECTORY_EVIDENCE_PREVIOUS_DY_OFFSET,
  TRAJECTORY_EVIDENCE_PREVIOUS_X_OFFSET,
  TRAJECTORY_EVIDENCE_PREVIOUS_Y_OFFSET,
  TRAJECTORY_EVIDENCE_PROOF_HASH_A_OFFSET,
  TRAJECTORY_EVIDENCE_PROOF_HASH_B_OFFSET,
  TRAJECTORY_EVIDENCE_PROTECTION_COUNT_OFFSET,
  TRAJECTORY_EVIDENCE_PROTECTION_POINTER_OFFSET,
  TRAJECTORY_EVIDENCE_REACHED_ORDERED_COUNT_OFFSET,
  TRAJECTORY_EVIDENCE_REACHED_REQUIRED_COUNT_OFFSET,
  TRAJECTORY_EVIDENCE_SAMPLE_INDEX_OFFSET,
} from "./trajectory-layout";

function trap(): void {
  unreachable();
}

/** Runs launch preparation and the complete scalar trajectory in one raw command. */
export function runTrajectory(inputPointer: u32, inputByteLength: u32): u32 {
  requireArenaInitialized();
  return runTrajectoryRequest(inputPointer, inputByteLength);
}

/** Executes one complete raw request after the owning command has established arena preconditions. */
export function runTrajectoryRequest(inputPointer: u32, inputByteLength: u32): u32 {
  if (inputPointer == 0 && inputByteLength == 0) {
    return 0;
  }
  requireGraphwarGameConstantsInitialized();
  if (inputByteLength != TRAJECTORY_INPUT_BYTE_LENGTH) {
    trap();
  }
  requireArenaRange(inputPointer, TRAJECTORY_INPUT_BYTE_LENGTH, sizeof<u64>());
  if (TRAJECTORY_INPUT_FORMULA_BYTE_LENGTH != 176) {
    trap();
  }

  const stopType = load<u32>(inputPointer + TRAJECTORY_INPUT_STOP_TYPE_OFFSET);
  if (
    stopType != TRAJECTORY_INPUT_STOP_TYPE_NATURAL &&
    stopType != TRAJECTORY_INPUT_STOP_TYPE_STOP_X &&
    stopType != TRAJECTORY_INPUT_STOP_TYPE_TARGETS
  ) {
    trap();
  }
  const flags = load<u32>(inputPointer + TRAJECTORY_INPUT_FLAGS_OFFSET);
  if (
    (flags &
      ~(
        TRAJECTORY_INPUT_FLAG_HAS_CONTINUE_GRAPH_X |
        TRAJECTORY_INPUT_FLAG_COLLECT_VISIBLE_PIXELS |
        TRAJECTORY_INPUT_FLAG_HAS_CONTINUATION_EVIDENCE |
        TRAJECTORY_INPUT_FLAG_STOP_ON_TARGETS_COMPLETE
      )) !=
    0
  ) {
    trap();
  }
  const evidenceInputPointer = load<u32>(inputPointer + TRAJECTORY_INPUT_EVIDENCE_POINTER_OFFSET);
  const evidenceInputByteLength = load<u32>(inputPointer + TRAJECTORY_INPUT_EVIDENCE_BYTE_LENGTH_OFFSET);
  const hasContinuationEvidence = (flags & TRAJECTORY_INPUT_FLAG_HAS_CONTINUATION_EVIDENCE) != 0;
  if (hasContinuationEvidence) {
    if (evidenceInputByteLength != TRAJECTORY_EVIDENCE_BYTE_LENGTH) {
      trap();
    }
    requireArenaRange(evidenceInputPointer, TRAJECTORY_EVIDENCE_BYTE_LENGTH, sizeof<u64>());
  } else if (evidenceInputPointer != 0 || evidenceInputByteLength != 0) {
    trap();
  }
  if (
    stopType != TRAJECTORY_INPUT_STOP_TYPE_TARGETS &&
    (flags &
      (TRAJECTORY_INPUT_FLAG_HAS_CONTINUE_GRAPH_X |
        TRAJECTORY_INPUT_FLAG_COLLECT_VISIBLE_PIXELS |
        TRAJECTORY_INPUT_FLAG_STOP_ON_TARGETS_COMPLETE)) !=
      0
  ) {
    trap();
  }
  const observationXPointer = load<u32>(inputPointer + TRAJECTORY_INPUT_OBSERVATION_X_POINTER_OFFSET);
  const observationXCount = load<u32>(inputPointer + TRAJECTORY_INPUT_OBSERVATION_X_COUNT_OFFSET);
  const observationXByteLength64 = <u64>observationXCount * sizeof<f64>();
  const observationResultByteLength64 = <u64>observationXCount * TRAJECTORY_OBSERVATION_BYTE_LENGTH;
  if (observationXByteLength64 > 0xffff_ffff || observationResultByteLength64 > 0xffff_ffff) {
    trap();
  }
  const observationXByteLength = <u32>observationXByteLength64;
  const observationResultByteLength = <u32>observationResultByteLength64;
  if (observationXCount == 0) {
    if (observationXPointer != 0) {
      trap();
    }
  } else {
    if (stopType != TRAJECTORY_INPUT_STOP_TYPE_STOP_X) {
      trap();
    }
    requireArenaRange(observationXPointer, observationXByteLength, sizeof<f64>());
    let observationIndex: u32 = 0;
    let previousObservationX = f64.NEGATIVE_INFINITY;
    while (observationIndex < observationXCount) {
      const observationX = load<f64>(observationXPointer + observationIndex * sizeof<f64>());
      if (
        observationX != observationX ||
        observationX == f64.POSITIVE_INFINITY ||
        observationX == f64.NEGATIVE_INFINITY ||
        observationX < previousObservationX
      ) {
        trap();
      }
      previousObservationX = observationX;
      observationIndex += 1;
    }
  }
  const maskPointer = load<u32>(inputPointer + TRAJECTORY_INPUT_MASK_POINTER_OFFSET);
  const maskByteLength = load<u32>(inputPointer + TRAJECTORY_INPUT_MASK_BYTE_LENGTH_OFFSET);
  const boundaryExpansion = load<u32>(inputPointer + TRAJECTORY_INPUT_BOUNDARY_EXPANSION_OFFSET);
  const expectedMaskByteLength = <u32>(getGraphwarPlaneLength() * getGraphwarPlaneHeight());
  if (maskPointer == 0) {
    if (maskByteLength != 0 || boundaryExpansion != 0) {
      trap();
    }
  } else {
    if (stopType != TRAJECTORY_INPUT_STOP_TYPE_TARGETS || maskByteLength != expectedMaskByteLength) {
      trap();
    }
    requireArenaRange(maskPointer, maskByteLength, 1);
  }
  const qualityPointCount = load<u32>(inputPointer + TRAJECTORY_INPUT_QUALITY_POINT_COUNT_OFFSET);
  const qualityXPointer = load<u32>(inputPointer + TRAJECTORY_INPUT_QUALITY_X_POINTER_OFFSET);
  const qualityYPointer = load<u32>(inputPointer + TRAJECTORY_INPUT_QUALITY_Y_POINTER_OFFSET);
  if (qualityPointCount == 0) {
    if (qualityXPointer != 0 || qualityYPointer != 0) {
      trap();
    }
  } else {
    const qualityByteLength64 = <u64>qualityPointCount * sizeof<f64>();
    if (
      stopType != TRAJECTORY_INPUT_STOP_TYPE_TARGETS ||
      qualityByteLength64 > 0xffff_ffff ||
      qualityXPointer == 0 ||
      qualityYPointer == 0
    ) {
      trap();
    }
    const qualityByteLength = <u32>qualityByteLength64;
    requireArenaRange(qualityXPointer, qualityByteLength, sizeof<f64>());
    requireArenaRange(qualityYPointer, qualityByteLength, sizeof<f64>());
    let qualityIndex: u32 = 0;
    while (qualityIndex < qualityPointCount) {
      const qualityX = load<f64>(qualityXPointer + qualityIndex * sizeof<f64>());
      const qualityY = load<f64>(qualityYPointer + qualityIndex * sizeof<f64>());
      if (
        qualityX != qualityX ||
        qualityX == f64.POSITIVE_INFINITY ||
        qualityX == f64.NEGATIVE_INFINITY ||
        qualityY != qualityY ||
        qualityY == f64.POSITIVE_INFINITY ||
        qualityY == f64.NEGATIVE_INFINITY
      ) {
        trap();
      }
      qualityIndex += 1;
    }
  }

  const orderedTargetCount = load<u32>(inputPointer + TRAJECTORY_INPUT_ORDERED_TARGET_COUNT_OFFSET);
  const requiredTargetCount = load<u32>(inputPointer + TRAJECTORY_INPUT_REQUIRED_TARGET_COUNT_OFFSET);
  const trackedTargetCount = load<u32>(inputPointer + TRAJECTORY_INPUT_TRACKED_TARGET_COUNT_OFFSET);
  const targetRecordPointer = load<u32>(inputPointer + TRAJECTORY_INPUT_TARGET_RECORD_POINTER_OFFSET);
  const targetCount64 = <u64>orderedTargetCount + requiredTargetCount + trackedTargetCount;
  const targetByteLength64 = targetCount64 * 3 * sizeof<f64>();
  if (targetCount64 > 0xffff_ffff || targetByteLength64 > 0xffff_ffff) {
    trap();
  }
  if (stopType == TRAJECTORY_INPUT_STOP_TYPE_TARGETS) {
    if (targetCount64 == 0) {
      if (targetRecordPointer != 0) {
        trap();
      }
    } else {
      requireArenaRange(targetRecordPointer, <u32>targetByteLength64, sizeof<f64>());
    }
    const boundsRectWidth = load<f64>(inputPointer + TRAJECTORY_INPUT_BOUNDS_RECT_WIDTH_OFFSET);
    const boundsRectHeight = load<f64>(inputPointer + TRAJECTORY_INPUT_BOUNDS_RECT_HEIGHT_OFFSET);
    if (
      !isFiniteTrajectoryValue(load<f64>(inputPointer + TRAJECTORY_INPUT_BOUNDS_RECT_X_OFFSET)) ||
      !isFiniteTrajectoryValue(load<f64>(inputPointer + TRAJECTORY_INPUT_BOUNDS_RECT_Y_OFFSET)) ||
      !isFiniteTrajectoryValue(boundsRectWidth) ||
      !isFiniteTrajectoryValue(boundsRectHeight) ||
      !(boundsRectWidth > 0) ||
      !(boundsRectHeight > 0) ||
      (((flags & TRAJECTORY_INPUT_FLAG_HAS_CONTINUE_GRAPH_X) != 0)
        ? !isFiniteTrajectoryValue(load<f64>(inputPointer + TRAJECTORY_INPUT_STOP_X_OFFSET))
        : !isCanonicalTrajectoryZero(load<f64>(inputPointer + TRAJECTORY_INPUT_STOP_X_OFFSET)))
    ) {
      trap();
    }
  } else if (
    targetCount64 != 0 ||
    targetRecordPointer != 0 ||
    boundaryExpansion != 0 ||
    !isCanonicalTrajectoryZero(load<f64>(inputPointer + TRAJECTORY_INPUT_BOUNDS_RECT_X_OFFSET)) ||
    !isCanonicalTrajectoryZero(load<f64>(inputPointer + TRAJECTORY_INPUT_BOUNDS_RECT_Y_OFFSET)) ||
    !isCanonicalTrajectoryZero(load<f64>(inputPointer + TRAJECTORY_INPUT_BOUNDS_RECT_WIDTH_OFFSET)) ||
    !isCanonicalTrajectoryZero(load<f64>(inputPointer + TRAJECTORY_INPUT_BOUNDS_RECT_HEIGHT_OFFSET)) ||
    qualityPointCount != 0 ||
    (stopType == TRAJECTORY_INPUT_STOP_TYPE_NATURAL
      ? !isCanonicalTrajectoryZero(load<f64>(inputPointer + TRAJECTORY_INPUT_STOP_X_OFFSET))
      : !isFiniteTrajectoryValue(load<f64>(inputPointer + TRAJECTORY_INPUT_STOP_X_OFFSET)))
  ) {
    trap();
  }

  const pointCount = load<u32>(inputPointer + FORMULA_INPUT_POINT_COUNT_OFFSET);
  if (pointCount < 2) {
    trap();
  }
  const segmentCount = pointCount - 1;
  const protectionByteLength64 = <u64>segmentCount * sizeof<u32>();
  if (protectionByteLength64 > 0xffff_ffff) {
    trap();
  }
  const protectionByteLength = <u32>protectionByteLength64;
  const stableProtectionPointer = reserveArena(protectionByteLength, sizeof<u32>());
  memory.fill(stableProtectionPointer, 0, protectionByteLength);
  const dependencyHashPointer = reserveArena(2 * sizeof<u64>(), sizeof<u64>());
  writeTrajectoryDependencyHash(inputPointer, dependencyHashPointer);
  let canUseContinuation = false;
  if (hasContinuationEvidence) {
    canUseContinuation = trajectoryEvidenceMatchesRequest(
      evidenceInputPointer,
      dependencyHashPointer,
      stableProtectionPointer,
      segmentCount,
      load<i32>(inputPointer + 4),
      stopType,
      flags,
      load<f64>(inputPointer + TRAJECTORY_INPUT_STOP_X_OFFSET),
      stopType == TRAJECTORY_INPUT_STOP_TYPE_TARGETS
        ? load<u32>(inputPointer + TRAJECTORY_INPUT_ORDERED_TARGET_COUNT_OFFSET)
        : 0,
      stopType == TRAJECTORY_INPUT_STOP_TYPE_TARGETS
        ? load<u32>(inputPointer + TRAJECTORY_INPUT_REQUIRED_TARGET_COUNT_OFFSET)
        : 0,
    );
  }
  const debugCounterPointer = reserveArena(TRAJECTORY_DEBUG_COUNTER_BYTE_LENGTH, sizeof<u64>());
  beginTrajectoryDebugCounters(debugCounterPointer);
  while (true) {
  const attemptMark = markArena();
  const launchInputPointer = reserveArena(TRAJECTORY_INPUT_FORMULA_BYTE_LENGTH, sizeof<u64>());
  memory.copy(launchInputPointer, inputPointer, TRAJECTORY_INPUT_FORMULA_BYTE_LENGTH);
  store<u32>(launchInputPointer + FORMULA_INPUT_SIGN_PROTECTION_POINTER_OFFSET, stableProtectionPointer);
  store<u32>(launchInputPointer + FORMULA_INPUT_SIGN_PROTECTION_COUNT_OFFSET, segmentCount);
  const launchResultPointer = runPrepareLaunch(launchInputPointer);
  const launchStatus = load<i32>(launchResultPointer + FORMULA_LAUNCH_RESULT_STATUS_OFFSET);
  const launchProtectionPointer = load<u32>(launchResultPointer + FORMULA_LAUNCH_RESULT_PROTECTION_POINTER_OFFSET);
  if (load<u32>(launchResultPointer + FORMULA_LAUNCH_RESULT_PROTECTION_COUNT_OFFSET) != segmentCount) {
    trap();
  }
  if (
    canUseContinuation &&
    !protectionBitsEqual(
      load<u32>(evidenceInputPointer + TRAJECTORY_EVIDENCE_PROTECTION_POINTER_OFFSET),
      launchProtectionPointer,
      segmentCount,
    )
  ) {
    canUseContinuation = false;
  }
  memory.copy(stableProtectionPointer, launchProtectionPointer, protectionByteLength);
  const resultPointer = reserveArena(TRAJECTORY_RESULT_BYTE_LENGTH, sizeof<u64>());
  memory.fill(resultPointer, 0, TRAJECTORY_RESULT_BYTE_LENGTH);
  store<i32>(resultPointer + TRAJECTORY_RESULT_LAUNCH_STATUS_OFFSET, launchStatus);
  store<i32>(resultPointer + TRAJECTORY_RESULT_TARGET_HIT_INDEX_OFFSET, -1);
  store<i32>(resultPointer + TRAJECTORY_RESULT_REQUIRED_TARGETS_HIT_INDEX_OFFSET, -1);
  store<i32>(resultPointer + TRAJECTORY_RESULT_OBSTACLE_HIT_INDEX_OFFSET, -1);
  store<u32>(resultPointer + TRAJECTORY_RESULT_PROTECTION_POINTER_OFFSET, stableProtectionPointer);
  store<u32>(resultPointer + TRAJECTORY_RESULT_PROTECTION_COUNT_OFFSET, segmentCount);
  if (launchStatus != FORMULA_LAUNCH_STATUS_SUCCESS) {
    store<i32>(resultPointer + TRAJECTORY_RESULT_STOP_REASON_OFFSET, 2);
    writeTrajectoryDebugCounters(resultPointer, debugCounterPointer);
    endTrajectoryDebugCounters(debugCounterPointer);
    commitArena(attemptMark);
    return resultPointer;
  }

  const maximumSampleCount = getGraphwarFuncMaxSteps();
  const requestedPointCapacity = load<u32>(inputPointer + TRAJECTORY_INPUT_MAX_OUTPUT_POINTS_OFFSET);
  const pointCapacity = requestedPointCapacity == 0 ? maximumSampleCount : requestedPointCapacity;
  if (pointCapacity == 0 || pointCapacity > maximumSampleCount) {
    trap();
  }
  const pointXPointer = reserveArena(pointCapacity * sizeof<f64>(), sizeof<f64>());
  const pointYPointer = reserveArena(pointCapacity * sizeof<f64>(), sizeof<f64>());
  const pointDyPointer = reserveArena(pointCapacity * sizeof<f64>(), sizeof<f64>());
  const pointCountPointer = reserveArena(sizeof<u32>(), sizeof<u32>());
  const statePointer = reserveArena(TRAJECTORY_SCALAR_STATE_BYTE_LENGTH, sizeof<u64>());
  const scalarResultPointer = reserveArena(TRAJECTORY_SCALAR_RESULT_BYTE_LENGTH, sizeof<u64>());
  const observedProtectionPointer = reserveArena(protectionByteLength, sizeof<u32>());
  memory.fill(observedProtectionPointer, 0, protectionByteLength);
  const materialResultPointer = load<u32>(
    launchResultPointer + FORMULA_LAUNCH_RESULT_MATERIAL_RESULT_POINTER_OFFSET,
  );
  store<u32>(materialResultPointer + FORMULA_RESULT_PROTECTION_POINTER_OFFSET, observedProtectionPointer);
  store<u32>(materialResultPointer + FORMULA_RESULT_PROTECTION_COUNT_OFFSET, segmentCount);
  const equation = load<i32>(inputPointer + 4);
  const launchX = load<f64>(launchResultPointer + FORMULA_LAUNCH_RESULT_X_OFFSET);
  const launchY = load<f64>(launchResultPointer + FORMULA_LAUNCH_RESULT_Y_OFFSET);
  const initialDy = load<f64>(launchResultPointer + FORMULA_LAUNCH_RESULT_INITIAL_DY_OFFSET);
  const yOffset = load<f64>(launchResultPointer + FORMULA_LAUNCH_RESULT_Y_OFFSET_VALUE_OFFSET);
  const boundsMinX = load<f64>(inputPointer + 64);
  const boundsMaxX = load<f64>(inputPointer + 72);
  const boundsMinY = load<f64>(inputPointer + 80);
  const boundsMaxY = load<f64>(inputPointer + 88);
  const stopX = stopType == TRAJECTORY_INPUT_STOP_TYPE_NATURAL
    ? NativeMath.max(boundsMinX, boundsMaxX)
    : load<f64>(inputPointer + TRAJECTORY_INPUT_STOP_X_OFFSET);
  if (stopX != stopX || stopX == f64.POSITIVE_INFINITY || stopX == f64.NEGATIVE_INFINITY) {
    trap();
  }
  const isContinuationAttempt = canUseContinuation;
  if (isContinuationAttempt) {
    initializeTrajectoryScalarState(
      statePointer,
      equation,
      load<f64>(evidenceInputPointer + TRAJECTORY_EVIDENCE_CURRENT_X_OFFSET),
      load<f64>(evidenceInputPointer + TRAJECTORY_EVIDENCE_CURRENT_Y_OFFSET),
      load<f64>(evidenceInputPointer + TRAJECTORY_EVIDENCE_CURRENT_DY_OFFSET),
      load<f64>(evidenceInputPointer + TRAJECTORY_EVIDENCE_PREVIOUS_X_OFFSET),
      load<f64>(evidenceInputPointer + TRAJECTORY_EVIDENCE_PREVIOUS_Y_OFFSET),
      load<f64>(evidenceInputPointer + TRAJECTORY_EVIDENCE_PREVIOUS_DY_OFFSET),
      load<u32>(evidenceInputPointer + TRAJECTORY_EVIDENCE_SAMPLE_INDEX_OFFSET),
      (load<u32>(evidenceInputPointer + TRAJECTORY_EVIDENCE_FLAGS_OFFSET) &
        TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_POINT) !=
        0,
    );
  } else {
    initializeTrajectoryScalarState(statePointer, equation, launchX, launchY, initialDy, 0, 0, 0, 0, false);
  }
  const shouldSkipInitialStop =
    isContinuationAttempt &&
    (load<u32>(evidenceInputPointer + TRAJECTORY_EVIDENCE_FLAGS_OFFSET) &
      TRAJECTORY_EVIDENCE_FLAG_SKIP_INITIAL_STOP) !=
      0;
  let targetStatePointer: u32 = 0;
  let trackedTargetHitIndexesPointer: u32 = 0;
  let trackedTargetCount: u32 = 0;
  if (stopType == TRAJECTORY_INPUT_STOP_TYPE_TARGETS) {
    const orderedTargetCount = load<u32>(inputPointer + TRAJECTORY_INPUT_ORDERED_TARGET_COUNT_OFFSET);
    const requiredTargetCount = load<u32>(inputPointer + TRAJECTORY_INPUT_REQUIRED_TARGET_COUNT_OFFSET);
    trackedTargetCount = load<u32>(inputPointer + TRAJECTORY_INPUT_TRACKED_TARGET_COUNT_OFFSET);
    const targetRecordPointer = load<u32>(inputPointer + TRAJECTORY_INPUT_TARGET_RECORD_POINTER_OFFSET);
    targetStatePointer = reserveArena(TRAJECTORY_TARGET_STATE_BYTE_LENGTH, sizeof<u32>());
    memory.fill(targetStatePointer, 0, TRAJECTORY_TARGET_STATE_BYTE_LENGTH);
    const initialReachedOrderedTargetCount = isContinuationAttempt
      ? load<u32>(evidenceInputPointer + TRAJECTORY_EVIDENCE_REACHED_ORDERED_COUNT_OFFSET)
      : 0;
    const initialReachedRequiredTargetCount = isContinuationAttempt
      ? load<u32>(evidenceInputPointer + TRAJECTORY_EVIDENCE_REACHED_REQUIRED_COUNT_OFFSET)
      : 0;
    store<u32>(
      targetStatePointer + TRAJECTORY_TARGET_STATE_REACHED_ORDERED_COUNT_OFFSET,
      initialReachedOrderedTargetCount,
    );
    store<u32>(
      targetStatePointer + TRAJECTORY_TARGET_STATE_REACHED_REQUIRED_COUNT_OFFSET,
      initialReachedRequiredTargetCount,
    );
    store<i32>(targetStatePointer + TRAJECTORY_TARGET_STATE_TARGET_HIT_INDEX_OFFSET, -1);
    store<i32>(targetStatePointer + TRAJECTORY_TARGET_STATE_REQUIRED_HIT_INDEX_OFFSET, -1);
    store<i32>(targetStatePointer + TRAJECTORY_TARGET_STATE_OBSTACLE_HIT_INDEX_OFFSET, -1);
    const requiredTargetHitsPointer = requiredTargetCount == 0 ? 0 : reserveArena(requiredTargetCount, 1);
    if (requiredTargetHitsPointer != 0) {
      memory.fill(requiredTargetHitsPointer, 0, requiredTargetCount);
      memory.fill(requiredTargetHitsPointer, 1, initialReachedRequiredTargetCount);
    }
    if (trackedTargetCount != 0) {
      trackedTargetHitIndexesPointer = reserveArena(trackedTargetCount * sizeof<i32>(), sizeof<i32>());
      memory.fill(trackedTargetHitIndexesPointer, 0xff, trackedTargetCount * sizeof<i32>());
    }
    store<u32>(targetStatePointer + TRAJECTORY_TARGET_STATE_REQUIRED_HITS_POINTER_OFFSET, requiredTargetHitsPointer);
    store<u32>(
      targetStatePointer + TRAJECTORY_TARGET_STATE_TRACKED_HIT_INDEXES_POINTER_OFFSET,
      trackedTargetHitIndexesPointer,
    );
    replayFormulaTrajectoryScalarWithTargetsAndPoints(
      materialResultPointer,
      equation,
      load<f64>(load<u32>(launchResultPointer + FORMULA_LAUNCH_RESULT_FORMULA_POINT_Y_POINTER_OFFSET)),
      yOffset,
      boundsMinX,
      boundsMaxX,
      boundsMinY,
      boundsMaxY,
      launchProtectionPointer,
      statePointer,
      scalarResultPointer,
      shouldSkipInitialStop,
      pointXPointer,
      pointYPointer,
      pointDyPointer,
      pointCapacity,
      pointCountPointer,
      maskPointer,
      targetRecordPointer,
      orderedTargetCount,
      requiredTargetCount,
      trackedTargetCount,
      targetStatePointer,
      load<f64>(inputPointer + TRAJECTORY_INPUT_BOUNDS_RECT_X_OFFSET),
      load<f64>(inputPointer + TRAJECTORY_INPUT_BOUNDS_RECT_Y_OFFSET),
      load<f64>(inputPointer + TRAJECTORY_INPUT_BOUNDS_RECT_WIDTH_OFFSET),
      load<f64>(inputPointer + TRAJECTORY_INPUT_BOUNDS_RECT_HEIGHT_OFFSET),
      boundaryExpansion,
      (flags & TRAJECTORY_INPUT_FLAG_HAS_CONTINUE_GRAPH_X) != 0,
      load<f64>(inputPointer + TRAJECTORY_INPUT_STOP_X_OFFSET),
      (flags & TRAJECTORY_INPUT_FLAG_STOP_ON_TARGETS_COMPLETE) != 0,
    );
    recordTrajectoryDebugScalarReplay(scalarResultPointer);
  } else {
    replayFormulaTrajectoryScalarToStopXWithPoints(
      materialResultPointer,
      equation,
      load<f64>(load<u32>(launchResultPointer + FORMULA_LAUNCH_RESULT_FORMULA_POINT_Y_POINTER_OFFSET)),
      yOffset,
      boundsMinX,
      boundsMaxX,
      boundsMinY,
      boundsMaxY,
      stopType == TRAJECTORY_INPUT_STOP_TYPE_STOP_X,
      stopX,
      launchProtectionPointer,
      statePointer,
      scalarResultPointer,
      shouldSkipInitialStop,
      pointXPointer,
      pointYPointer,
      pointDyPointer,
      pointCapacity,
      pointCountPointer,
      maskPointer,
      false,
    );
    recordTrajectoryDebugScalarReplay(scalarResultPointer);
  }

  if (mergeProtectionBits(observedProtectionPointer, stableProtectionPointer, segmentCount)) {
    canUseContinuation = false;
    resetArena(attemptMark);
    continue;
  }

  const stablePointCount = load<u32>(pointCountPointer);
  const initialSampleIndex = isContinuationAttempt
    ? load<u32>(evidenceInputPointer + TRAJECTORY_EVIDENCE_SAMPLE_INDEX_OFFSET)
    : 0;
  const publishedPointOffset: u32 = shouldSkipInitialStop ? 1 : 0;
  const publishedPointCount = stablePointCount - publishedPointOffset;
  let visibleXPointer: u32 = 0;
  let visibleYPointer: u32 = 0;
  if ((flags & TRAJECTORY_INPUT_FLAG_COLLECT_VISIBLE_PIXELS) != 0 && publishedPointCount != 0) {
    visibleXPointer = reserveArena(publishedPointCount * sizeof<f64>(), sizeof<f64>());
    visibleYPointer = reserveArena(publishedPointCount * sizeof<f64>(), sizeof<f64>());
    let visibleIndex: u32 = 0;
    while (visibleIndex < publishedPointCount) {
      const sourcePointIndex = visibleIndex + publishedPointOffset;
      const graphX = load<f64>(pointXPointer + sourcePointIndex * sizeof<f64>());
      const graphY = load<f64>(pointYPointer + sourcePointIndex * sizeof<f64>());
      store<f64>(
        visibleXPointer + visibleIndex * sizeof<f64>(),
        load<f64>(inputPointer + TRAJECTORY_INPUT_BOUNDS_RECT_X_OFFSET) +
          ((graphX - boundsMinX) / (boundsMaxX - boundsMinX)) *
            load<f64>(inputPointer + TRAJECTORY_INPUT_BOUNDS_RECT_WIDTH_OFFSET),
      );
      store<f64>(
        visibleYPointer + visibleIndex * sizeof<f64>(),
        load<f64>(inputPointer + TRAJECTORY_INPUT_BOUNDS_RECT_Y_OFFSET) +
          ((boundsMaxY - graphY) / (boundsMaxY - boundsMinY)) *
            load<f64>(inputPointer + TRAJECTORY_INPUT_BOUNDS_RECT_HEIGHT_OFFSET),
      );
      visibleIndex += 1;
    }
  }

  let resultFlags = load<u32>(scalarResultPointer + TRAJECTORY_SCALAR_RESULT_FLAGS_OFFSET);
  if (isContinuationAttempt) {
    resultFlags |= TRAJECTORY_RESULT_FLAG_USED_CONTINUATION;
  }
  let pathError = 0.0;
  if (qualityPointCount != 0) {
    resultFlags |= TRAJECTORY_RESULT_FLAG_HAS_PATH_ERROR;
    pathError = measureTrajectoryPathError(
      pointXPointer,
      pointYPointer,
      stablePointCount,
      qualityXPointer,
      qualityYPointer,
      qualityPointCount,
      boundsMinY,
      boundsMaxY,
    );
  }

  let observationResultPointer: u32 = 0;
  let observationResultCount: u32 = 0;
  if (observationXCount != 0) {
    observationResultPointer = reserveArena(observationResultByteLength, sizeof<f64>());
    let pointIndex: u32 = publishedPointOffset;
    while (pointIndex < stablePointCount && observationResultCount < observationXCount) {
      const pointX = load<f64>(pointXPointer + pointIndex * sizeof<f64>());
      while (
        observationResultCount < observationXCount &&
        pointX >= load<f64>(observationXPointer + observationResultCount * sizeof<f64>())
      ) {
        const observationPointer =
          observationResultPointer + observationResultCount * TRAJECTORY_OBSERVATION_BYTE_LENGTH;
        store<f64>(observationPointer + TRAJECTORY_OBSERVATION_X_OFFSET, pointX);
        store<f64>(
          observationPointer + TRAJECTORY_OBSERVATION_Y_OFFSET,
          load<f64>(pointYPointer + pointIndex * sizeof<f64>()),
        );
        store<f64>(
          observationPointer + TRAJECTORY_OBSERVATION_DY_OFFSET,
          load<f64>(pointDyPointer + pointIndex * sizeof<f64>()),
        );
        store<u32>(
          observationPointer + TRAJECTORY_OBSERVATION_SAMPLE_INDEX_OFFSET,
          initialSampleIndex + pointIndex,
        );
        observationResultCount += 1;
      }
      pointIndex += 1;
    }
  }

  const stopReason = load<i32>(scalarResultPointer + TRAJECTORY_SCALAR_RESULT_STOP_REASON_OFFSET);
  const reachedOrderedTargetCount = targetStatePointer == 0
    ? 0
    : load<u32>(targetStatePointer + TRAJECTORY_TARGET_STATE_REACHED_ORDERED_COUNT_OFFSET);
  const reachedRequiredTargetCount = targetStatePointer == 0
    ? 0
    : load<u32>(targetStatePointer + TRAJECTORY_TARGET_STATE_REACHED_REQUIRED_COUNT_OFFSET);
  const evidenceResultPointer = writeTrajectoryContinuationEvidence(
    dependencyHashPointer,
    stableProtectionPointer,
    segmentCount,
    statePointer,
    equation,
    reachedOrderedTargetCount,
    reachedRequiredTargetCount,
    stopReason != TRAJECTORY_SCALAR_STOP_REASON_TARGET,
    stopReason == TRAJECTORY_SCALAR_STOP_REASON_STOP_X,
  );
  store<i32>(resultPointer + TRAJECTORY_RESULT_STOP_REASON_OFFSET, stopReason);
  store<u32>(resultPointer + TRAJECTORY_RESULT_POINT_COUNT_OFFSET, load<u32>(pointCountPointer));
  writeTrajectoryDebugCounters(resultPointer, debugCounterPointer);
  store<u32>(resultPointer + TRAJECTORY_RESULT_POINT_X_POINTER_OFFSET, pointXPointer);
  store<u32>(resultPointer + TRAJECTORY_RESULT_POINT_Y_POINTER_OFFSET, pointYPointer);
  store<u32>(resultPointer + TRAJECTORY_RESULT_POINT_DY_POINTER_OFFSET, pointDyPointer);
  store<f64>(resultPointer + TRAJECTORY_RESULT_CURRENT_X_OFFSET, load<f64>(scalarResultPointer + TRAJECTORY_SCALAR_RESULT_CURRENT_X_OFFSET));
  store<f64>(resultPointer + TRAJECTORY_RESULT_CURRENT_Y_OFFSET, load<f64>(scalarResultPointer + TRAJECTORY_SCALAR_RESULT_CURRENT_Y_OFFSET));
    store<f64>(resultPointer + TRAJECTORY_RESULT_CURRENT_DY_OFFSET, load<f64>(scalarResultPointer + TRAJECTORY_SCALAR_RESULT_DY_OFFSET));
  store<f64>(resultPointer + TRAJECTORY_RESULT_LAUNCH_ANGLE_OFFSET, load<f64>(launchResultPointer + FORMULA_LAUNCH_RESULT_ANGLE_OFFSET));
  store<f64>(resultPointer + TRAJECTORY_RESULT_LAUNCH_X_OFFSET, launchX);
  store<f64>(resultPointer + TRAJECTORY_RESULT_LAUNCH_Y_OFFSET, launchY);
  store<f64>(resultPointer + TRAJECTORY_RESULT_INITIAL_DY_OFFSET, initialDy);
  store<f64>(resultPointer + TRAJECTORY_RESULT_Y_OFFSET_VALUE_OFFSET, yOffset);
  store<u32>(resultPointer + TRAJECTORY_RESULT_FLAGS_OFFSET, resultFlags);
  store<u32>(
    resultPointer + TRAJECTORY_RESULT_OBSERVATION_POINTER_OFFSET,
    observationResultCount == 0 ? 0 : observationResultPointer,
  );
  store<u32>(resultPointer + TRAJECTORY_RESULT_OBSERVATION_COUNT_OFFSET, observationResultCount);
  store<u32>(resultPointer + TRAJECTORY_RESULT_VISIBLE_X_POINTER_OFFSET, visibleXPointer);
  store<u32>(resultPointer + TRAJECTORY_RESULT_VISIBLE_Y_POINTER_OFFSET, visibleYPointer);
  store<u32>(
    resultPointer + TRAJECTORY_RESULT_VISIBLE_POINT_COUNT_OFFSET,
    visibleXPointer == 0 ? 0 : publishedPointCount,
  );
  store<f64>(resultPointer + TRAJECTORY_RESULT_PATH_ERROR_OFFSET, pathError);
  store<f64>(
    resultPointer + TRAJECTORY_RESULT_PREVIOUS_X_OFFSET,
    load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_PREVIOUS_X_OFFSET),
  );
  store<f64>(
    resultPointer + TRAJECTORY_RESULT_PREVIOUS_Y_OFFSET,
    load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_PREVIOUS_Y_OFFSET),
  );
  store<f64>(
    resultPointer + TRAJECTORY_RESULT_PREVIOUS_DY_OFFSET,
    load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_PREVIOUS_DY_OFFSET),
  );
  store<u32>(
    resultPointer + TRAJECTORY_RESULT_SAMPLE_INDEX_OFFSET,
    load<u32>(statePointer + TRAJECTORY_SCALAR_STATE_SAMPLE_INDEX_OFFSET),
  );
  const scalarStateFlags = load<u32>(statePointer + TRAJECTORY_SCALAR_STATE_FLAGS_OFFSET);
  store<u32>(
    resultPointer + TRAJECTORY_RESULT_STATE_FLAGS_OFFSET,
    ((scalarStateFlags & TRAJECTORY_SCALAR_STATE_FLAG_HAS_PREVIOUS_POINT) != 0
      ? TRAJECTORY_RESULT_STATE_FLAG_HAS_PREVIOUS_POINT
      : 0) |
      ((scalarStateFlags & TRAJECTORY_SCALAR_STATE_FLAG_HAS_DY) != 0 ? TRAJECTORY_RESULT_STATE_FLAG_HAS_DY : 0) |
      ((scalarStateFlags & TRAJECTORY_SCALAR_STATE_FLAG_HAS_PREVIOUS_DY) != 0
        ? TRAJECTORY_RESULT_STATE_FLAG_HAS_PREVIOUS_DY
        : 0),
  );
  store<u32>(resultPointer + TRAJECTORY_RESULT_EVIDENCE_POINTER_OFFSET, evidenceResultPointer);
  store<u32>(
    resultPointer + TRAJECTORY_RESULT_EVIDENCE_BYTE_LENGTH_OFFSET,
    TRAJECTORY_EVIDENCE_BYTE_LENGTH,
  );
  if (targetStatePointer != 0) {
    store<u32>(
      resultPointer + TRAJECTORY_RESULT_REACHED_ORDERED_TARGET_COUNT_OFFSET,
      reachedOrderedTargetCount,
    );
    store<u32>(
      resultPointer + TRAJECTORY_RESULT_REACHED_REQUIRED_TARGET_COUNT_OFFSET,
      reachedRequiredTargetCount,
    );
    store<i32>(
      resultPointer + TRAJECTORY_RESULT_TARGET_HIT_INDEX_OFFSET,
      load<i32>(targetStatePointer + TRAJECTORY_TARGET_STATE_TARGET_HIT_INDEX_OFFSET),
    );
    store<i32>(
      resultPointer + TRAJECTORY_RESULT_REQUIRED_TARGETS_HIT_INDEX_OFFSET,
      load<i32>(targetStatePointer + TRAJECTORY_TARGET_STATE_REQUIRED_HIT_INDEX_OFFSET),
    );
    store<i32>(
      resultPointer + TRAJECTORY_RESULT_OBSTACLE_HIT_INDEX_OFFSET,
      load<i32>(targetStatePointer + TRAJECTORY_TARGET_STATE_OBSTACLE_HIT_INDEX_OFFSET),
    );
    store<u32>(
      resultPointer + TRAJECTORY_RESULT_TRACKED_TARGET_HIT_INDEX_POINTER_OFFSET,
      trackedTargetHitIndexesPointer,
    );
    store<u32>(resultPointer + TRAJECTORY_RESULT_TRACKED_TARGET_COUNT_OFFSET, trackedTargetCount);
  }
  endTrajectoryDebugCounters(debugCounterPointer);
  commitArena(attemptMark);
  return resultPointer;
  }
  trap();
  return 0;
}

function writeTrajectoryDebugCounters(resultPointer: u32, debugCounterPointer: u32): void {
  const rk4StepCount = getTrajectoryDebugCounter(
    debugCounterPointer,
    TRAJECTORY_DEBUG_RK4_STEP_COUNT_FIELD_OFFSET,
  );
  const bisectionCount = getTrajectoryDebugCounter(
    debugCounterPointer,
    TRAJECTORY_DEBUG_BISECTION_COUNT_FIELD_OFFSET,
  );
  const minStepJumpCount = getTrajectoryDebugCounter(
    debugCounterPointer,
    TRAJECTORY_DEBUG_MIN_STEP_JUMP_COUNT_FIELD_OFFSET,
  );
  const acceptedSamplePointCount = getTrajectoryDebugCounter(
    debugCounterPointer,
    TRAJECTORY_DEBUG_ACCEPTED_SAMPLE_POINT_COUNT_FIELD_OFFSET,
  );
  const replayCount = getTrajectoryDebugCounter(
    debugCounterPointer,
    TRAJECTORY_DEBUG_REPLAY_COUNT_FIELD_OFFSET,
  );
  if (
    rk4StepCount > 0xffff_ffff ||
    bisectionCount > 0xffff_ffff ||
    minStepJumpCount > 0xffff_ffff ||
    acceptedSamplePointCount > 0xffff_ffff ||
    replayCount > 0xffff_ffff
  ) {
    trap();
  }
  store<u32>(resultPointer + TRAJECTORY_RESULT_RK4_STEP_COUNT_OFFSET, <u32>rk4StepCount);
  store<u32>(resultPointer + TRAJECTORY_RESULT_BISECTION_COUNT_OFFSET, <u32>bisectionCount);
  store<u32>(resultPointer + TRAJECTORY_RESULT_MIN_STEP_JUMP_COUNT_OFFSET, <u32>minStepJumpCount);
  store<u32>(
    resultPointer + TRAJECTORY_RESULT_ACCEPTED_SAMPLE_POINT_COUNT_OFFSET,
    <u32>acceptedSamplePointCount,
  );
  store<u32>(resultPointer + TRAJECTORY_RESULT_REPLAY_COUNT_OFFSET, <u32>replayCount);
}

/** Mirrors the TS quality metric without interpolating between accepted trajectory states. */
function measureTrajectoryPathError(
  pointXPointer: u32,
  pointYPointer: u32,
  pointCount: u32,
  qualityXPointer: u32,
  qualityYPointer: u32,
  qualityPointCount: u32,
  boundsMinY: f64,
  boundsMaxY: f64,
): f64 {
  const ySpan = NativeMath.abs(boundsMaxY - boundsMinY);
  if (!(ySpan > 0) || ySpan == f64.POSITIVE_INFINITY) {
    return f64.POSITIVE_INFINITY;
  }
  let pathError = 0.0;
  let sampleIndex: u32 = 0;
  let qualityIndex: u32 = 0;
  while (qualityIndex < qualityPointCount) {
    const targetX = load<f64>(qualityXPointer + qualityIndex * sizeof<f64>());
    while (sampleIndex < pointCount && load<f64>(pointXPointer + sampleIndex * sizeof<f64>()) < targetX) {
      sampleIndex += 1;
    }
    if (sampleIndex >= pointCount) {
      return f64.POSITIVE_INFINITY;
    }
    const pointError =
      (NativeMath.abs(
        load<f64>(pointYPointer + sampleIndex * sizeof<f64>()) -
          load<f64>(qualityYPointer + qualityIndex * sizeof<f64>()),
      ) *
        getGraphwarPlaneHeight()) /
      ySpan;
    if (pointError != pointError || pointError == f64.POSITIVE_INFINITY) {
      return f64.POSITIVE_INFINITY;
    }
    pathError = NativeMath.max(pathError, pointError);
    qualityIndex += 1;
  }
  return pathError;
}

const TRAJECTORY_HASH_A_SEED: u64 = 14695981039346656037;
const TRAJECTORY_HASH_B_SEED: u64 = 7809847782465536322;
const TRAJECTORY_HASH_PRIME: u64 = 1099511628211;
const TRAJECTORY_ALLOWED_PROTECTION_BITS: u32 = 31;

function writeTrajectoryDependencyHash(inputPointer: u32, hashPointer: u32): void {
  store<u64>(hashPointer, TRAJECTORY_HASH_A_SEED);
  store<u64>(hashPointer + sizeof<u64>(), TRAJECTORY_HASH_B_SEED);
  hashTrajectoryRange(hashPointer, inputPointer, 20);

  const pointCount = load<u32>(inputPointer + FORMULA_INPUT_POINT_COUNT_OFFSET);
  const pointByteLength64 = <u64>pointCount * sizeof<f64>();
  if (pointByteLength64 > 0xffff_ffff) {
    trap();
  }
  const pointByteLength = <u32>pointByteLength64;
  hashTrajectoryRange(
    hashPointer,
    load<u32>(inputPointer + FORMULA_INPUT_POINT_X_POINTER_OFFSET),
    pointByteLength,
  );
  hashTrajectoryRange(
    hashPointer,
    load<u32>(inputPointer + FORMULA_INPUT_POINT_Y_POINTER_OFFSET),
    pointByteLength,
  );
  hashTrajectoryRange(hashPointer, inputPointer + 56, 64);
  hashTrajectoryRange(hashPointer, inputPointer + 148, 12);
  hashTrajectoryRange(hashPointer, inputPointer + 164, 12);

  const overflowRangeCount = load<u32>(inputPointer + FORMULA_INPUT_STEP_OVERFLOW_RANGE_COUNT_OFFSET);
  hashTrajectoryF64Values(
    hashPointer,
    load<u32>(inputPointer + FORMULA_INPUT_STEP_OVERFLOW_RANGE_POINTER_OFFSET),
    overflowRangeCount,
  );
  hashTrajectoryRange(
    hashPointer,
    load<u32>(inputPointer + FORMULA_INPUT_MASK_POINTER_OFFSET),
    load<u32>(inputPointer + FORMULA_INPUT_MASK_BYTE_LENGTH_OFFSET),
  );

  hashTrajectoryRange(hashPointer, inputPointer + TRAJECTORY_INPUT_STOP_TYPE_OFFSET, sizeof<u32>());
  hashTrajectoryU32Value(
    hashPointer,
    load<u32>(inputPointer + TRAJECTORY_INPUT_FLAGS_OFFSET) & ~TRAJECTORY_INPUT_FLAG_HAS_CONTINUATION_EVIDENCE,
  );
  // The frontier may move right while every other stop-policy dependency remains identical.
  hashTrajectoryRange(hashPointer, inputPointer + TRAJECTORY_INPUT_MASK_BYTE_LENGTH_OFFSET, 20);
  hashTrajectoryRange(hashPointer, inputPointer + TRAJECTORY_INPUT_BOUNDARY_EXPANSION_OFFSET, 36);
  hashTrajectoryRange(hashPointer, inputPointer + TRAJECTORY_INPUT_OBSERVATION_X_COUNT_OFFSET, sizeof<u32>());
  hashTrajectoryRange(hashPointer, inputPointer + TRAJECTORY_INPUT_QUALITY_POINT_COUNT_OFFSET, sizeof<u32>());

  const maskByteLength = load<u32>(inputPointer + TRAJECTORY_INPUT_MASK_BYTE_LENGTH_OFFSET);
  hashTrajectoryRange(hashPointer, load<u32>(inputPointer + TRAJECTORY_INPUT_MASK_POINTER_OFFSET), maskByteLength);
  const orderedTargetCount = load<u32>(inputPointer + TRAJECTORY_INPUT_ORDERED_TARGET_COUNT_OFFSET);
  const requiredTargetCount = load<u32>(inputPointer + TRAJECTORY_INPUT_REQUIRED_TARGET_COUNT_OFFSET);
  const trackedTargetCount = load<u32>(inputPointer + TRAJECTORY_INPUT_TRACKED_TARGET_COUNT_OFFSET);
  const targetCount64 = <u64>orderedTargetCount + requiredTargetCount + trackedTargetCount;
  const targetByteLength64 = targetCount64 * 3 * sizeof<f64>();
  if (targetCount64 > 0xffff_ffff || targetByteLength64 > 0xffff_ffff) {
    trap();
  }
  hashTrajectoryRange(
    hashPointer,
    load<u32>(inputPointer + TRAJECTORY_INPUT_TARGET_RECORD_POINTER_OFFSET),
    <u32>targetByteLength64,
  );
  hashTrajectoryF64Values(
    hashPointer,
    load<u32>(inputPointer + TRAJECTORY_INPUT_OBSERVATION_X_POINTER_OFFSET),
    load<u32>(inputPointer + TRAJECTORY_INPUT_OBSERVATION_X_COUNT_OFFSET),
  );
  const qualityPointCount = load<u32>(inputPointer + TRAJECTORY_INPUT_QUALITY_POINT_COUNT_OFFSET);
  hashTrajectoryF64Values(
    hashPointer,
    load<u32>(inputPointer + TRAJECTORY_INPUT_QUALITY_X_POINTER_OFFSET),
    qualityPointCount,
  );
  hashTrajectoryF64Values(
    hashPointer,
    load<u32>(inputPointer + TRAJECTORY_INPUT_QUALITY_Y_POINTER_OFFSET),
    qualityPointCount,
  );
}

function hashTrajectoryF64Values(hashPointer: u32, pointer: u32, count: u32): void {
  const byteLength64 = <u64>count * sizeof<f64>();
  if (byteLength64 > 0xffff_ffff) {
    trap();
  }
  hashTrajectoryRange(hashPointer, pointer, <u32>byteLength64);
}

function hashTrajectoryRange(hashPointer: u32, pointer: u32, byteLength: u32): void {
  if (byteLength == 0) {
    if (pointer != 0) {
      trap();
    }
    return;
  }
  requireArenaRange(pointer, byteLength, 1);
  let hashA = load<u64>(hashPointer);
  let hashB = load<u64>(hashPointer + sizeof<u64>());
  let offset: u32 = 0;
  while (offset < byteLength) {
    const value = load<u8>(pointer + offset);
    hashA = (hashA ^ value) * TRAJECTORY_HASH_PRIME;
    hashB = (hashB ^ value) * TRAJECTORY_HASH_PRIME;
    hashB ^= hashB >> 32;
    offset += 1;
  }
  store<u64>(hashPointer, hashA);
  store<u64>(hashPointer + sizeof<u64>(), hashB);
}

function hashTrajectoryU32Value(hashPointer: u32, value: u32): void {
  let hashA = load<u64>(hashPointer);
  let hashB = load<u64>(hashPointer + sizeof<u64>());
  let shift: u32 = 0;
  while (shift < 32) {
    const byte = <u8>(value >> shift);
    hashA = (hashA ^ byte) * TRAJECTORY_HASH_PRIME;
    hashB = (hashB ^ byte) * TRAJECTORY_HASH_PRIME;
    hashB ^= hashB >> 32;
    shift += 8;
  }
  store<u64>(hashPointer, hashA);
  store<u64>(hashPointer + sizeof<u64>(), hashB);
}

function trajectoryEvidenceMatchesRequest(
  evidencePointer: u32,
  dependencyHashPointer: u32,
  stableProtectionPointer: u32,
  segmentCount: u32,
  equation: i32,
  stopType: u32,
  flags: u32,
  stopX: f64,
  orderedTargetCount: u32,
  requiredTargetCount: u32,
): bool {
  const protectionPointer = load<u32>(evidencePointer + TRAJECTORY_EVIDENCE_PROTECTION_POINTER_OFFSET);
  const protectionCount = load<u32>(evidencePointer + TRAJECTORY_EVIDENCE_PROTECTION_COUNT_OFFSET);
  if (protectionCount != segmentCount) {
    trap();
  }
  requireArenaRange(protectionPointer, protectionCount * sizeof<u32>(), sizeof<u32>());
  let protectionIndex: u32 = 0;
  while (protectionIndex < protectionCount) {
    if ((load<u32>(protectionPointer + protectionIndex * sizeof<u32>()) & ~TRAJECTORY_ALLOWED_PROTECTION_BITS) != 0) {
      trap();
    }
    protectionIndex += 1;
  }
  const evidenceFlags = load<u32>(evidencePointer + TRAJECTORY_EVIDENCE_FLAGS_OFFSET);
  const allowedEvidenceFlags =
    TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_POINT |
    TRAJECTORY_EVIDENCE_FLAG_HAS_DY |
    TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_DY |
    TRAJECTORY_EVIDENCE_FLAG_SKIP_INITIAL_STOP |
    TRAJECTORY_EVIDENCE_FLAG_CAN_CONTINUE_TO_LATER_FRONTIER;
  if ((evidenceFlags & ~allowedEvidenceFlags) != 0) {
    trap();
  }
  const hasPreviousPoint = (evidenceFlags & TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_POINT) != 0;
  const hasDy = (evidenceFlags & TRAJECTORY_EVIDENCE_FLAG_HAS_DY) != 0;
  const hasPreviousDy = (evidenceFlags & TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_DY) != 0;
  const sampleIndex = load<u32>(evidencePointer + TRAJECTORY_EVIDENCE_SAMPLE_INDEX_OFFSET);
  if (
    hasPreviousPoint == (sampleIndex == 0) ||
    hasDy != (equation == FORMULA_EQUATION_DDY) ||
    hasPreviousDy != (hasPreviousPoint && equation == FORMULA_EQUATION_DDY) ||
    !isFiniteTrajectoryValue(load<f64>(evidencePointer + TRAJECTORY_EVIDENCE_CURRENT_X_OFFSET)) ||
    !isFiniteTrajectoryValue(load<f64>(evidencePointer + TRAJECTORY_EVIDENCE_CURRENT_Y_OFFSET)) ||
    (hasDy
      ? !isFiniteTrajectoryValue(load<f64>(evidencePointer + TRAJECTORY_EVIDENCE_CURRENT_DY_OFFSET))
      : !isCanonicalTrajectoryZero(load<f64>(evidencePointer + TRAJECTORY_EVIDENCE_CURRENT_DY_OFFSET))) ||
    (hasPreviousPoint &&
      (!isFiniteTrajectoryValue(load<f64>(evidencePointer + TRAJECTORY_EVIDENCE_PREVIOUS_X_OFFSET)) ||
        !isFiniteTrajectoryValue(load<f64>(evidencePointer + TRAJECTORY_EVIDENCE_PREVIOUS_Y_OFFSET)))) ||
    (!hasPreviousPoint &&
      (!isCanonicalTrajectoryZero(load<f64>(evidencePointer + TRAJECTORY_EVIDENCE_PREVIOUS_X_OFFSET)) ||
        !isCanonicalTrajectoryZero(load<f64>(evidencePointer + TRAJECTORY_EVIDENCE_PREVIOUS_Y_OFFSET)))) ||
    (hasPreviousDy
      ? !isFiniteTrajectoryValue(load<f64>(evidencePointer + TRAJECTORY_EVIDENCE_PREVIOUS_DY_OFFSET))
      : !isCanonicalTrajectoryZero(load<f64>(evidencePointer + TRAJECTORY_EVIDENCE_PREVIOUS_DY_OFFSET)))
  ) {
    trap();
  }
  if (
    load<u32>(evidencePointer + TRAJECTORY_EVIDENCE_REACHED_ORDERED_COUNT_OFFSET) > orderedTargetCount ||
    load<u32>(evidencePointer + TRAJECTORY_EVIDENCE_REACHED_REQUIRED_COUNT_OFFSET) > requiredTargetCount
  ) {
    return false;
  }
  const currentX = load<f64>(evidencePointer + TRAJECTORY_EVIDENCE_CURRENT_X_OFFSET);
  const hasFutureFrontier =
    (evidenceFlags & TRAJECTORY_EVIDENCE_FLAG_CAN_CONTINUE_TO_LATER_FRONTIER) != 0 &&
    (stopType == TRAJECTORY_INPUT_STOP_TYPE_STOP_X ||
      (stopType == TRAJECTORY_INPUT_STOP_TYPE_TARGETS &&
        (flags & TRAJECTORY_INPUT_FLAG_HAS_CONTINUE_GRAPH_X) != 0)) &&
    stopX > currentX;
  if (!hasFutureFrontier) {
    return false;
  }
  const dependencyMatches =
    load<u64>(evidencePointer + TRAJECTORY_EVIDENCE_DEPENDENCY_HASH_A_OFFSET) == load<u64>(dependencyHashPointer) &&
    load<u64>(evidencePointer + TRAJECTORY_EVIDENCE_DEPENDENCY_HASH_B_OFFSET) ==
      load<u64>(dependencyHashPointer + sizeof<u64>());
  const proofMatches =
    load<u64>(evidencePointer + TRAJECTORY_EVIDENCE_PROOF_HASH_A_OFFSET) ==
      calculateTrajectoryEvidenceProof(evidencePointer, protectionPointer, protectionCount, TRAJECTORY_HASH_A_SEED) &&
    load<u64>(evidencePointer + TRAJECTORY_EVIDENCE_PROOF_HASH_B_OFFSET) ==
      calculateTrajectoryEvidenceProof(evidencePointer, protectionPointer, protectionCount, TRAJECTORY_HASH_B_SEED);
  if (!dependencyMatches || !proofMatches) {
    return false;
  }
  memory.copy(stableProtectionPointer, protectionPointer, protectionCount * sizeof<u32>());
  return true;
}

function writeTrajectoryContinuationEvidence(
  dependencyHashPointer: u32,
  protectionPointer: u32,
  protectionCount: u32,
  statePointer: u32,
  equation: i32,
  reachedOrderedTargetCount: u32,
  reachedRequiredTargetCount: u32,
  shouldSkipInitialStop: bool,
  canContinueToLaterFrontier: bool,
): u32 {
  const evidencePointer = reserveArena(TRAJECTORY_EVIDENCE_BYTE_LENGTH, sizeof<u64>());
  memory.fill(evidencePointer, 0, TRAJECTORY_EVIDENCE_BYTE_LENGTH);
  store<u64>(
    evidencePointer + TRAJECTORY_EVIDENCE_DEPENDENCY_HASH_A_OFFSET,
    load<u64>(dependencyHashPointer),
  );
  store<u64>(
    evidencePointer + TRAJECTORY_EVIDENCE_DEPENDENCY_HASH_B_OFFSET,
    load<u64>(dependencyHashPointer + sizeof<u64>()),
  );
  store<u32>(evidencePointer + TRAJECTORY_EVIDENCE_PROTECTION_POINTER_OFFSET, protectionPointer);
  store<u32>(evidencePointer + TRAJECTORY_EVIDENCE_PROTECTION_COUNT_OFFSET, protectionCount);
  store<f64>(
    evidencePointer + TRAJECTORY_EVIDENCE_CURRENT_X_OFFSET,
    load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET),
  );
  store<f64>(
    evidencePointer + TRAJECTORY_EVIDENCE_CURRENT_Y_OFFSET,
    load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET),
  );
  store<f64>(
    evidencePointer + TRAJECTORY_EVIDENCE_CURRENT_DY_OFFSET,
    equation == FORMULA_EQUATION_DDY ? load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_DY_OFFSET) : 0,
  );
  const stateFlags = load<u32>(statePointer + TRAJECTORY_SCALAR_STATE_FLAGS_OFFSET);
  const hasPreviousPoint = (stateFlags & TRAJECTORY_SCALAR_STATE_FLAG_HAS_PREVIOUS_POINT) != 0;
  store<f64>(
    evidencePointer + TRAJECTORY_EVIDENCE_PREVIOUS_X_OFFSET,
    hasPreviousPoint ? load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_PREVIOUS_X_OFFSET) : 0,
  );
  store<f64>(
    evidencePointer + TRAJECTORY_EVIDENCE_PREVIOUS_Y_OFFSET,
    hasPreviousPoint ? load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_PREVIOUS_Y_OFFSET) : 0,
  );
  store<f64>(
    evidencePointer + TRAJECTORY_EVIDENCE_PREVIOUS_DY_OFFSET,
    equation == FORMULA_EQUATION_DDY && hasPreviousPoint
      ? load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_PREVIOUS_DY_OFFSET)
      : 0,
  );
  store<u32>(
    evidencePointer + TRAJECTORY_EVIDENCE_SAMPLE_INDEX_OFFSET,
    load<u32>(statePointer + TRAJECTORY_SCALAR_STATE_SAMPLE_INDEX_OFFSET),
  );
  store<u32>(
    evidencePointer + TRAJECTORY_EVIDENCE_REACHED_ORDERED_COUNT_OFFSET,
    reachedOrderedTargetCount,
  );
  store<u32>(
    evidencePointer + TRAJECTORY_EVIDENCE_REACHED_REQUIRED_COUNT_OFFSET,
    reachedRequiredTargetCount,
  );
  store<u32>(
    evidencePointer + TRAJECTORY_EVIDENCE_FLAGS_OFFSET,
    (hasPreviousPoint ? TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_POINT : 0) |
      (equation == FORMULA_EQUATION_DDY ? TRAJECTORY_EVIDENCE_FLAG_HAS_DY : 0) |
      (equation == FORMULA_EQUATION_DDY && hasPreviousPoint ? TRAJECTORY_EVIDENCE_FLAG_HAS_PREVIOUS_DY : 0) |
      (shouldSkipInitialStop ? TRAJECTORY_EVIDENCE_FLAG_SKIP_INITIAL_STOP : 0) |
      (canContinueToLaterFrontier ? TRAJECTORY_EVIDENCE_FLAG_CAN_CONTINUE_TO_LATER_FRONTIER : 0),
  );
  store<u64>(
    evidencePointer + TRAJECTORY_EVIDENCE_PROOF_HASH_A_OFFSET,
    calculateTrajectoryEvidenceProof(evidencePointer, protectionPointer, protectionCount, TRAJECTORY_HASH_A_SEED),
  );
  store<u64>(
    evidencePointer + TRAJECTORY_EVIDENCE_PROOF_HASH_B_OFFSET,
    calculateTrajectoryEvidenceProof(evidencePointer, protectionPointer, protectionCount, TRAJECTORY_HASH_B_SEED),
  );
  return evidencePointer;
}

function calculateTrajectoryEvidenceProof(
  evidencePointer: u32,
  protectionPointer: u32,
  protectionCount: u32,
  seed: u64,
): u64 {
  let hash = hashTrajectoryBytes(seed, evidencePointer + TRAJECTORY_EVIDENCE_DEPENDENCY_HASH_A_OFFSET, 16);
  hash = hashTrajectoryBytes(hash, evidencePointer + TRAJECTORY_EVIDENCE_PROTECTION_COUNT_OFFSET, sizeof<u32>());
  hash = hashTrajectoryBytes(hash, evidencePointer + TRAJECTORY_EVIDENCE_CURRENT_X_OFFSET, 64);
  return hashTrajectoryBytes(hash, protectionPointer, protectionCount * sizeof<u32>());
}

function hashTrajectoryBytes(seed: u64, pointer: u32, byteLength: u32): u64 {
  let hash = seed;
  let offset: u32 = 0;
  while (offset < byteLength) {
    hash = (hash ^ load<u8>(pointer + offset)) * TRAJECTORY_HASH_PRIME;
    offset += 1;
  }
  return hash;
}

function protectionBitsEqual(leftPointer: u32, rightPointer: u32, count: u32): bool {
  let index: u32 = 0;
  while (index < count) {
    if (load<u32>(leftPointer + index * sizeof<u32>()) != load<u32>(rightPointer + index * sizeof<u32>())) {
      return false;
    }
    index += 1;
  }
  return true;
}

@inline
function isFiniteTrajectoryValue(value: f64): bool {
  return value == value && value != f64.POSITIVE_INFINITY && value != f64.NEGATIVE_INFINITY;
}

@inline
function isCanonicalTrajectoryZero(value: f64): bool {
  return reinterpret<u64>(value) == 0;
}
