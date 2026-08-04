import { quantizeFormulaOffsetCenter } from "./decimal";
import {
  FORMULA_EQUATION_DDY,
  FORMULA_EQUATION_DY,
  FORMULA_FLAG_STEP_GLITCH_FIXED_WINDOWS,
  FORMULA_FLAG_STEP_GLITCH_MODE,
  FORMULA_INPUT_BOUNDS_MAX_X_OFFSET,
  FORMULA_INPUT_BOUNDS_MAX_Y_OFFSET,
  FORMULA_INPUT_BOUNDS_MIN_X_OFFSET,
  FORMULA_INPUT_BOUNDS_MIN_Y_OFFSET,
  FORMULA_INPUT_DECIMAL_PLACES_OFFSET,
  FORMULA_INPUT_DISABLED_SEGMENT_POINTER_OFFSET,
  FORMULA_INPUT_EQUATION_OFFSET,
  FORMULA_INPUT_FLAGS_OFFSET,
  FORMULA_INPUT_GLITCH_SEGMENT_POINTER_OFFSET,
  FORMULA_INPUT_MASK_POINTER_OFFSET,
  FORMULA_INPUT_PATH_STEEPNESS_OFFSET,
  FORMULA_INPUT_POINT_COUNT_OFFSET,
  FORMULA_INPUT_POINT_X_POINTER_OFFSET,
  FORMULA_INPUT_POINT_Y_POINTER_OFFSET,
  FORMULA_INPUT_QUALITY_TARGET_PLANE_PIXELS_OFFSET,
  FORMULA_INPUT_SEGMENT_START_X_POINTER_OFFSET,
  FORMULA_INPUT_SEGMENT_START_Y_POINTER_OFFSET,
  FORMULA_INPUT_SIGN_PROTECTION_POINTER_OFFSET,
  FORMULA_INPUT_SOLDIER_X_OFFSET,
  FORMULA_INPUT_SOLDIER_Y_OFFSET,
  FORMULA_INPUT_STEP_DELTA_Y_POINTER_OFFSET,
  FORMULA_RESULT_AUXILIARY_VALUE_OFFSET,
  FORMULA_RESULT_FLAGS_OFFSET,
  FORMULA_RESULT_MATERIAL_COUNT_OFFSET,
  FORMULA_RESULT_MATERIAL_POINTER_OFFSET,
  FORMULA_RESULT_MATERIAL_STRIDE_OFFSET,
  FORMULA_RESULT_MATERIAL_TYPE_OFFSET,
  FORMULA_RESULT_PROTECTION_COUNT_OFFSET,
  FORMULA_RESULT_PROTECTION_POINTER_OFFSET,
  STEP_GLITCH_RECORD_END_X_OFFSET,
  STEP_GLITCH_RECORD_EQUATION_OFFSET,
  STEP_GLITCH_RECORD_BYTE_LENGTH,
  STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH,
  STEP_GLITCH_FIXED_WINDOW_END_X_OFFSET,
  STEP_GLITCH_FIXED_WINDOW_PRESENCE_OFFSET,
  STEP_GLITCH_FIXED_WINDOW_START_X_OFFSET,
  STEP_MATERIAL_BYTE_LENGTH,
} from "./formula-layout";
import {
  calculateStepRefinedFormulaCenterX,
  createStepFirstOrderGlitchSegment,
  createStepGlitchFormulaGateY,
  createStepGlitchJump,
  createStepSecondOrderGlitchSegmentCandidate,
  getGraphwarLastBisectedXStepDistance,
  getStepGlitchInitialWindowDecimalPlaces,
  getStepGlitchRk4ContributionFactor,
  isStepSecondOrderLandingQualityBetter,
  STEP_GLITCH_JUMP_BYTE_LENGTH,
  STEP_GLITCH_JUMP_END_X_OFFSET,
  STEP_GLITCH_JUMP_START_X_OFFSET,
  STEP_GLITCH_JUMP_STEP_OFFSET,
  STEP_GLITCH_RK4_CONTRIBUTION_FACTOR_COUNT,
  STEP_GLITCH_SECOND_ORDER_PROFILE_COUNT,
  stepGlitchObstacleEnvelopeHitsObstacle,
} from "./formula-refinement-step";
import { runStepLaunchBatch } from "./formula-step";
import {
  createStepFormulaResolution,
  getStepFormulaResolutionSteepness,
  resolveStepFormulaTransition,
  STEP_TRANSITION_BYTE_LENGTH,
  STEP_TRANSITION_EFFECTIVE_DELTA_Y_OFFSET,
} from "./formula-step-resolution";
import { getGraphwarGameSoldierRadius, getGraphwarPlaneHeight, getGraphwarStepSize } from "./game-constants";
import { markArena, reserveArena, resetArena } from "./memory";
import {
  initializeTrajectoryScalarState,
  recordTrajectoryDebugReplayStart,
  recordTrajectoryDebugScalarReplay,
  recordTrajectoryDebugScalarResult,
  replayFormulaTrajectoryScalarToStopX,
  replayFormulaTrajectoryScalarToStopXWithMask,
  replayFormulaTrajectoryScalarToStopXWithMaskAndJumpWindow,
  TRAJECTORY_SCALAR_RESULT_BYTE_LENGTH,
  TRAJECTORY_SCALAR_RESULT_DY_OFFSET,
  TRAJECTORY_SCALAR_RESULT_FLAGS_OFFSET,
  TRAJECTORY_SCALAR_RESULT_FLAG_OBSTACLE_HIT,
  TRAJECTORY_SCALAR_RESULT_JUMP_WINDOW_COUNT_SHIFT,
  TRAJECTORY_SCALAR_RESULT_STOP_REASON_OFFSET,
  TRAJECTORY_SCALAR_STATE_BYTE_LENGTH,
  TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET,
  TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET,
  TRAJECTORY_SCALAR_STATE_DY_OFFSET,
  TRAJECTORY_SCALAR_STATE_FLAGS_OFFSET,
  TRAJECTORY_SCALAR_STATE_FLAG_HAS_PREVIOUS_DY,
  TRAJECTORY_SCALAR_STATE_FLAG_HAS_PREVIOUS_POINT,
  TRAJECTORY_SCALAR_STATE_MIN_STEP_JUMP_COUNT_OFFSET,
  TRAJECTORY_SCALAR_STATE_PREVIOUS_DY_OFFSET,
  TRAJECTORY_SCALAR_STATE_PREVIOUS_X_OFFSET,
  TRAJECTORY_SCALAR_STATE_PREVIOUS_Y_OFFSET,
  TRAJECTORY_SCALAR_STATE_SAMPLE_INDEX_OFFSET,
  TRAJECTORY_SCALAR_STOP_REASON_STOP_X,
} from "./trajectory-scalar";

export const STEP_COLD_REFINEMENT_INVALID: i32 = 0;
export const STEP_COLD_REFINEMENT_SUCCESS: i32 = 1;
export const STEP_COLD_REFINEMENT_PROTECTION_CHANGED: i32 = 2;

const CANDIDATE_REPLAY_INVALID: i32 = 0;
const CANDIDATE_REPLAY_SUCCESS: i32 = 1;
const STEP_BOUNDARY_MATERIAL_IDENTITY_HEADER_BYTE_LENGTH: u32 = 24;

/** Formula-launch supplies the equation-specific solver; a finite forced angle is part of the candidate identity. */
export type StepColdLaunchStateInitializer = (
  materialResultPointer: u32,
  equation: i32,
  baseY: f64,
  protectionPointer: u32,
  statePointer: u32,
  anglePointer: u32,
  forcedLaunchAngle: f64,
  contextPointer: u32,
) => bool;

/** Formula-launch owns the launch-point fixed-point loop needed by cold first-segment candidates. */
export type StepColdFormulaPointResolver = (
  buildInputPointer: u32,
  targetXPointer: u32,
  targetYPointer: u32,
  sourceXPointer: u32,
  sourceYPointer: u32,
  outputXPointer: u32,
  outputYPointer: u32,
  pathSteepness: f64,
  protectionPointer: u32,
  observedProtectionPointer: u32,
  contextPointer: u32,
) => bool;

@inline
function isFiniteValue(value: f64): bool {
  return value == value && value != f64.POSITIVE_INFINITY && value != f64.NEGATIVE_INFINITY;
}

/**
 * Refines Step segments from left to right using only raw formula input, scalar trajectory replay, and caller launch
 * state initialization. The function mutates `formulaPointXPointer` and installs its owned override arrays into
 * `buildInputPointer`; the final material build must consume that same input record.
 */
export function refineStepFormulaCold(
  inputPointer: u32,
  buildInputPointer: u32,
  formulaPointXPointer: u32,
  formulaPointYPointer: u32,
  initialFormulaPointXPointer: u32,
  combinedProtectionPointer: u32,
  acceptedHardLaunchAnglePointer: u32,
  launchContextPointer: u32,
  initializeLaunchState: StepColdLaunchStateInitializer,
  resolveCandidateFormulaPoints: StepColdFormulaPointResolver,
): i32 {
  const equation = load<i32>(inputPointer + FORMULA_INPUT_EQUATION_OFFSET);
  if (equation != FORMULA_EQUATION_DY && equation != FORMULA_EQUATION_DDY) {
    return STEP_COLD_REFINEMENT_SUCCESS;
  }
  if (acceptedHardLaunchAnglePointer != 0) {
    store<f64>(acceptedHardLaunchAnglePointer, f64.NaN);
  }

  const pointCount = load<u32>(inputPointer + FORMULA_INPUT_POINT_COUNT_OFFSET);
  const segmentCount = pointCount - 1;
  const pointXPointer = load<u32>(inputPointer + FORMULA_INPUT_POINT_X_POINTER_OFFSET);
  const pointYPointer = load<u32>(inputPointer + FORMULA_INPUT_POINT_Y_POINTER_OFFSET);
  const protectionPointer = load<u32>(buildInputPointer + FORMULA_INPUT_SIGN_PROTECTION_POINTER_OFFSET);
  const maskPointer = load<u32>(inputPointer + FORMULA_INPUT_MASK_POINTER_OFFSET);
  const decimalPlaces = load<i32>(inputPointer + FORMULA_INPUT_DECIMAL_PLACES_OFFSET);
  const boundsMinX = load<f64>(inputPointer + FORMULA_INPUT_BOUNDS_MIN_X_OFFSET);
  const boundsMaxX = load<f64>(inputPointer + FORMULA_INPUT_BOUNDS_MAX_X_OFFSET);
  const boundsMinY = load<f64>(inputPointer + FORMULA_INPUT_BOUNDS_MIN_Y_OFFSET);
  const boundsMaxY = load<f64>(inputPointer + FORMULA_INPUT_BOUNDS_MAX_Y_OFFSET);
  const positionTargetPlanePixels = load<f64>(inputPointer + FORMULA_INPUT_QUALITY_TARGET_PLANE_PIXELS_OFFSET);
  const pathSteepness = load<f64>(inputPointer + FORMULA_INPUT_PATH_STEEPNESS_OFFSET);
  const soldierX = load<f64>(inputPointer + FORMULA_INPUT_SOLDIER_X_OFFSET);
  const soldierY = load<f64>(inputPointer + FORMULA_INPUT_SOLDIER_Y_OFFSET);
  const flags = load<u32>(inputPointer + FORMULA_INPUT_FLAGS_OFFSET);
  const isStepGlitchModeEnabled = (flags & FORMULA_FLAG_STEP_GLITCH_MODE) != 0;
  const hasFixedWindows = (flags & FORMULA_FLAG_STEP_GLITCH_FIXED_WINDOWS) != 0;
  const fixedWindowPointer =
    hasFixedWindows ? load<u32>(inputPointer + FORMULA_INPUT_GLITCH_SEGMENT_POINTER_OFFSET) : 0;
  const segmentF64ByteLength = checkedByteLength(segmentCount, sizeof<f64>());
  const glitchByteLength = checkedByteLength(segmentCount, STEP_GLITCH_RECORD_BYTE_LENGTH);
  const deltaYPointer = reserveArena(segmentF64ByteLength, sizeof<f64>());
  const segmentStartXPointer = reserveArena(segmentF64ByteLength, sizeof<f64>());
  const segmentStartYPointer = reserveArena(segmentF64ByteLength, sizeof<f64>());
  const glitchPointer = reserveArena(glitchByteLength, sizeof<f64>());
  const disabledPointer = reserveArena(segmentCount, 1);
  fillFloat64NaN(deltaYPointer, segmentCount);
  fillFloat64NaN(segmentStartXPointer, segmentCount);
  fillFloat64NaN(segmentStartYPointer, segmentCount);
  memory.fill(glitchPointer, 0, glitchByteLength);
  memory.fill(disabledPointer, 1, segmentCount);
  store<u32>(buildInputPointer + FORMULA_INPUT_DISABLED_SEGMENT_POINTER_OFFSET, disabledPointer);
  store<u32>(buildInputPointer + FORMULA_INPUT_SEGMENT_START_X_POINTER_OFFSET, segmentStartXPointer);
  store<u32>(buildInputPointer + FORMULA_INPUT_SEGMENT_START_Y_POINTER_OFFSET, segmentStartYPointer);
  store<u32>(buildInputPointer + FORMULA_INPUT_STEP_DELTA_Y_POINTER_OFFSET, deltaYPointer);
  store<u32>(buildInputPointer + FORMULA_INPUT_GLITCH_SEGMENT_POINTER_OFFSET, glitchPointer);

  const baseY = load<f64>(formulaPointYPointer);
  const resolutionPointer = createStepFormulaResolution(
    load<f64>(buildInputPointer + 56),
    decimalPlaces,
    equation,
    baseY,
    segmentCount,
  );
  const formulaSteepness = getStepFormulaResolutionSteepness(resolutionPointer);
  const transitionPointer = reserveArena(STEP_TRANSITION_BYTE_LENGTH, sizeof<f64>());
  const startStatePointer = reserveArena(TRAJECTORY_SCALAR_STATE_BYTE_LENGTH, sizeof<f64>());
  const prefixTargetStatePointer = reserveArena(TRAJECTORY_SCALAR_STATE_BYTE_LENGTH, sizeof<f64>());
  const candidateStatePointer = reserveArena(TRAJECTORY_SCALAR_STATE_BYTE_LENGTH, sizeof<f64>());
  const softStatePointer = reserveArena(TRAJECTORY_SCALAR_STATE_BYTE_LENGTH, sizeof<f64>());
  const hardStatePointer = reserveArena(TRAJECTORY_SCALAR_STATE_BYTE_LENGTH, sizeof<f64>());
  const acceptedBoundaryStatePointer = reserveArena(TRAJECTORY_SCALAR_STATE_BYTE_LENGTH, sizeof<f64>());
  const preJumpStatePointer = reserveArena(TRAJECTORY_SCALAR_STATE_BYTE_LENGTH, sizeof<f64>());
  const prefixLaunchAnglePointer = reserveArena(sizeof<f64>(), sizeof<f64>());
  const candidateLaunchAnglePointer = reserveArena(sizeof<f64>(), sizeof<f64>());
  const resultPointer = reserveArena(TRAJECTORY_SCALAR_RESULT_BYTE_LENGTH, sizeof<f64>());
  const jumpPointer = reserveArena(STEP_GLITCH_JUMP_BYTE_LENGTH, sizeof<f64>());
  const candidateSegmentPointer = reserveArena(STEP_GLITCH_RECORD_BYTE_LENGTH, sizeof<f64>());
  const hardSegmentPointer = reserveArena(STEP_GLITCH_RECORD_BYTE_LENGTH, sizeof<f64>());
  const candidateProtectionPointer = reserveArena(checkedByteLength(segmentCount, sizeof<u32>()), sizeof<u32>());
  const softProtectionPointer = reserveArena(checkedByteLength(segmentCount, sizeof<u32>()), sizeof<u32>());
  const hardProtectionPointer = reserveArena(checkedByteLength(segmentCount, sizeof<u32>()), sizeof<u32>());
  const acceptedBoundaryProtectionPointer = reserveArena(
    checkedByteLength(segmentCount, sizeof<u32>()),
    sizeof<u32>(),
  );
  const boundaryMaterialIdentityByteLength = checkedAddByteLength(
    STEP_BOUNDARY_MATERIAL_IDENTITY_HEADER_BYTE_LENGTH,
    checkedByteLength(segmentCount, STEP_MATERIAL_BYTE_LENGTH),
  );
  const candidateBoundaryMaterialIdentityPointer = reserveArena(boundaryMaterialIdentityByteLength, sizeof<u64>());
  const softBoundaryMaterialIdentityPointer = reserveArena(boundaryMaterialIdentityByteLength, sizeof<u64>());
  const hardBoundaryMaterialIdentityPointer = reserveArena(boundaryMaterialIdentityByteLength, sizeof<u64>());
  const acceptedBoundaryMaterialIdentityPointer = reserveArena(boundaryMaterialIdentityByteLength, sizeof<u64>());
  let hasProtectionChanged = false;
  let hasAcceptedBoundaryState = false;
  let acceptedHardLaunchAngle = f64.NaN;
  let acceptedBoundaryLaunchAngle = f64.NaN;
  let acceptedBoundaryStopX = f64.NaN;
  let segmentIndex: u32 = 0;
  while (segmentIndex < segmentCount) {
    const segmentMark = markArena();
    store<u32>(buildInputPointer + FORMULA_INPUT_POINT_X_POINTER_OFFSET, formulaPointXPointer);
    store<u32>(buildInputPointer + FORMULA_INPUT_POINT_Y_POINTER_OFFSET, formulaPointYPointer);
    const prefixMaterialPointer = runStepLaunchBatch(buildInputPointer);
    const isPrefixLaunchValid = initializeLaunchState(
      prefixMaterialPointer,
      equation,
      baseY,
      protectionPointer,
      startStatePointer,
      prefixLaunchAnglePointer,
      acceptedHardLaunchAngle,
      launchContextPointer,
    );
    mergeObservedProtection(prefixMaterialPointer, combinedProtectionPointer, segmentCount);
    if (hasNewProtection(combinedProtectionPointer, protectionPointer, segmentCount)) {
      hasProtectionChanged = true;
    }
    if (!isPrefixLaunchValid) {
      resetArena(segmentMark);
      if (isStepGlitchModeEnabled) {
        return hasProtectionChanged ? STEP_COLD_REFINEMENT_PROTECTION_CHANGED : STEP_COLD_REFINEMENT_INVALID;
      }
      break;
    }
    let boundaryStopX = f64.NaN;
    if (segmentIndex > 0) {
      const previousGlitchPointer = glitchPointer + (segmentIndex - 1) * STEP_GLITCH_RECORD_BYTE_LENGTH;
      boundaryStopX =
        load<i32>(previousGlitchPointer + STEP_GLITCH_RECORD_EQUATION_OFFSET) == 0
          ? load<f64>(pointXPointer + segmentIndex * sizeof<f64>())
          : load<f64>(previousGlitchPointer + STEP_GLITCH_RECORD_END_X_OFFSET);
    }
    const canReuseAcceptedBoundary =
      segmentIndex > 0 &&
      hasAcceptedBoundaryState &&
      stepBoundaryMaterialIdentityMatches(prefixMaterialPointer, acceptedBoundaryMaterialIdentityPointer) &&
      reinterpret<u64>(load<f64>(prefixLaunchAnglePointer)) == reinterpret<u64>(acceptedBoundaryLaunchAngle) &&
      protectionValuesEqual(acceptedBoundaryProtectionPointer, protectionPointer, segmentCount) &&
      reinterpret<u64>(boundaryStopX) == reinterpret<u64>(acceptedBoundaryStopX);
    hasAcceptedBoundaryState = false;
    if (canReuseAcceptedBoundary) {
      memory.copy(startStatePointer, acceptedBoundaryStatePointer, TRAJECTORY_SCALAR_STATE_BYTE_LENGTH);
    } else if (segmentIndex > 0) {
      replayFormulaTrajectoryScalarToStopX(
        prefixMaterialPointer,
        equation,
        baseY,
        0,
        boundsMinX,
        boundsMaxX,
        boundsMinY,
        boundsMaxY,
        boundaryStopX,
        protectionPointer,
        startStatePointer,
        resultPointer,
        false,
      );
      recordTrajectoryDebugScalarReplay(resultPointer);
      if (load<i32>(resultPointer + TRAJECTORY_SCALAR_RESULT_STOP_REASON_OFFSET) != TRAJECTORY_SCALAR_STOP_REASON_STOP_X) {
        resetArena(segmentMark);
        if (isStepGlitchModeEnabled) {
          return hasProtectionChanged ? STEP_COLD_REFINEMENT_PROTECTION_CHANGED : STEP_COLD_REFINEMENT_INVALID;
        }
        break;
      }
    }

    const actualStartX =
      segmentIndex == 0
        ? load<f64>(formulaPointXPointer)
        : load<f64>(startStatePointer + TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET);
    const actualStartY =
      segmentIndex == 0
        ? load<f64>(formulaPointYPointer)
        : load<f64>(startStatePointer + TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET);
    if (!isFiniteValue(actualStartX) || !isFiniteValue(actualStartY)) {
      resetArena(segmentMark);
      if (isStepGlitchModeEnabled) {
        return hasProtectionChanged ? STEP_COLD_REFINEMENT_PROTECTION_CHANGED : STEP_COLD_REFINEMENT_INVALID;
      }
      break;
    }
    if (segmentIndex > 0) {
      store<f64>(segmentStartXPointer + segmentIndex * sizeof<f64>(), actualStartX);
      store<f64>(segmentStartYPointer + segmentIndex * sizeof<f64>(), actualStartY);
    }

    // The first launch preparation belongs to the reused target replay, or to the cold boundary replay otherwise.
    // Only the cold boundary path therefore needs a second preparation for its target replay.
    if (segmentIndex > 0 && !canReuseAcceptedBoundary) {
      const isPrefixTargetLaunchValid = initializeLaunchState(
        prefixMaterialPointer,
        equation,
        baseY,
        protectionPointer,
        prefixTargetStatePointer,
        prefixLaunchAnglePointer,
        acceptedHardLaunchAngle,
        launchContextPointer,
      );
      mergeObservedProtection(prefixMaterialPointer, combinedProtectionPointer, segmentCount);
      if (hasNewProtection(combinedProtectionPointer, protectionPointer, segmentCount)) {
        hasProtectionChanged = true;
      }
      if (!isPrefixTargetLaunchValid) {
        resetArena(segmentMark);
        if (isStepGlitchModeEnabled) {
          return hasProtectionChanged ? STEP_COLD_REFINEMENT_PROTECTION_CHANGED : STEP_COLD_REFINEMENT_INVALID;
        }
        break;
      }
    }
    memory.copy(prefixTargetStatePointer, startStatePointer, TRAJECTORY_SCALAR_STATE_BYTE_LENGTH);
    const targetX = load<f64>(pointXPointer + (segmentIndex + 1) * sizeof<f64>());
    replayFormulaTrajectoryScalarToStopX(
      prefixMaterialPointer,
      equation,
      baseY,
      0,
      boundsMinX,
      boundsMaxX,
      boundsMinY,
      boundsMaxY,
      targetX,
      protectionPointer,
      prefixTargetStatePointer,
      resultPointer,
      false,
    );
    recordTrajectoryDebugScalarReplay(resultPointer);
    mergeObservedProtection(prefixMaterialPointer, combinedProtectionPointer, segmentCount);
    if (hasNewProtection(combinedProtectionPointer, protectionPointer, segmentCount)) {
      hasProtectionChanged = true;
    }
    if (load<i32>(resultPointer + TRAJECTORY_SCALAR_RESULT_STOP_REASON_OFFSET) != TRAJECTORY_SCALAR_STOP_REASON_STOP_X) {
      resetArena(segmentMark);
      break;
    }

    const formulaTargetY = load<f64>(formulaPointYPointer + (segmentIndex + 1) * sizeof<f64>());
    const nextDeltaY = formulaTargetY - load<f64>(prefixTargetStatePointer + TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET);
    const nextFormulaX = resolveRefinedFormulaX(
      resolutionPointer,
      transitionPointer,
      formulaTargetY,
      nextDeltaY,
      decimalPlaces,
      equation,
      formulaSteepness,
      actualStartX,
      targetX,
      boundsMinX,
      boundsMaxX,
      boundsMinY,
      boundsMaxY,
      positionTargetPlanePixels,
    );
    if (!isFiniteValue(nextDeltaY) || !isFiniteValue(nextFormulaX)) {
      resetArena(segmentMark);
      if (isStepGlitchModeEnabled) {
        return hasProtectionChanged ? STEP_COLD_REFINEMENT_PROTECTION_CHANGED : STEP_COLD_REFINEMENT_INVALID;
      }
      break;
    }

    const segmentFixedWindowPointer =
      hasFixedWindows ? fixedWindowPointer + segmentIndex * STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH : 0;
    const isFixedWindowPresent =
      hasFixedWindows && load<u32>(segmentFixedWindowPointer + STEP_GLITCH_FIXED_WINDOW_PRESENCE_OFFSET) != 0;
    let softDeltaY = nextDeltaY;
    let softFormulaX = nextFormulaX;
    let softPositionError = f64.POSITIVE_INFINITY;
    let softDerivativeError = f64.POSITIVE_INFINITY;
    let isSoftReplayValid = false;
    let hasSoftObstacleHit = false;
    let softLaunchAngle = f64.NaN;
    const shouldReplaySoft = !isFixedWindowPresent && (isStepGlitchModeEnabled || equation == FORMULA_EQUATION_DDY);
    if (shouldReplaySoft) {
      store<f64>(deltaYPointer + segmentIndex * sizeof<f64>(), nextDeltaY);
      store<f64>(formulaPointXPointer + (segmentIndex + 1) * sizeof<f64>(), nextFormulaX);
      store<u8>(disabledPointer + segmentIndex, 0);
      const softReplayStatus = replayCurrentCandidate(
        buildInputPointer,
        formulaPointXPointer,
        formulaPointYPointer,
        equation,
        baseY,
        boundsMinX,
        boundsMaxX,
        boundsMinY,
        boundsMaxY,
        targetX,
        protectionPointer,
        segmentCount,
        startStatePointer,
        segmentIndex > 0,
        candidateStatePointer,
        resultPointer,
        maskPointer,
        false,
        0,
        0,
        candidateProtectionPointer,
        candidateLaunchAnglePointer,
        acceptedHardLaunchAngle,
        launchContextPointer,
        initializeLaunchState,
        pointXPointer,
        pointYPointer,
        pointCount,
        pathSteepness,
        candidateBoundaryMaterialIdentityPointer,
        resolveCandidateFormulaPoints,
      );
      if (softReplayStatus == CANDIDATE_REPLAY_SUCCESS) {
        softLaunchAngle = load<f64>(candidateLaunchAnglePointer);
        softPositionError = calculatePositionErrorPlanePixels(
          candidateStatePointer,
          load<f64>(pointYPointer + (segmentIndex + 1) * sizeof<f64>()),
          boundsMinY,
          boundsMaxY,
        );
        softDerivativeError =
          equation == FORMULA_EQUATION_DDY
            ? NativeMath.abs(load<f64>(candidateStatePointer + TRAJECTORY_SCALAR_STATE_DY_OFFSET))
            : 0;
        isSoftReplayValid = isFiniteValue(softPositionError) && isFiniteValue(softDerivativeError);
        hasSoftObstacleHit =
          (load<u32>(resultPointer + TRAJECTORY_SCALAR_RESULT_FLAGS_OFFSET) &
            TRAJECTORY_SCALAR_RESULT_FLAG_OBSTACLE_HIT) !=
          0;
        if (isSoftReplayValid) {
          memory.copy(softStatePointer, candidateStatePointer, TRAJECTORY_SCALAR_STATE_BYTE_LENGTH);
          memory.copy(
            softProtectionPointer,
            candidateProtectionPointer,
            checkedByteLength(segmentCount, sizeof<u32>()),
          );
          memory.copy(
            softBoundaryMaterialIdentityPointer,
            candidateBoundaryMaterialIdentityPointer,
            boundaryMaterialIdentityByteLength,
          );
        }
      }

      if (
        equation == FORMULA_EQUATION_DDY &&
        isSoftReplayValid &&
        softPositionError <= positionTargetPlanePixels &&
        nextDeltaY != 0
      ) {
        const prefixDerivative = load<f64>(prefixTargetStatePointer + TRAJECTORY_SCALAR_STATE_DY_OFFSET);
        const positionDerivative = load<f64>(softStatePointer + TRAJECTORY_SCALAR_STATE_DY_OFFSET);
        if (
          isFiniteValue(prefixDerivative) &&
          isFiniteValue(positionDerivative) &&
          positionDerivative != prefixDerivative
        ) {
          const derivativeDeltaY =
            nextDeltaY - (positionDerivative * nextDeltaY) / (positionDerivative - prefixDerivative);
          if (isFiniteValue(derivativeDeltaY) && reinterpret<u64>(derivativeDeltaY) != reinterpret<u64>(nextDeltaY)) {
            const derivativeFormulaX = resolveRefinedFormulaX(
              resolutionPointer,
              transitionPointer,
              formulaTargetY,
              derivativeDeltaY,
              decimalPlaces,
              equation,
              formulaSteepness,
              actualStartX,
              targetX,
              boundsMinX,
              boundsMaxX,
              boundsMinY,
              boundsMaxY,
              positionTargetPlanePixels,
            );
            store<f64>(deltaYPointer + segmentIndex * sizeof<f64>(), derivativeDeltaY);
            store<f64>(formulaPointXPointer + (segmentIndex + 1) * sizeof<f64>(), derivativeFormulaX);
            const derivativeReplayStatus = replayCurrentCandidate(
              buildInputPointer,
              formulaPointXPointer,
              formulaPointYPointer,
              equation,
              baseY,
              boundsMinX,
              boundsMaxX,
              boundsMinY,
              boundsMaxY,
              targetX,
              protectionPointer,
              segmentCount,
              startStatePointer,
              segmentIndex > 0,
              candidateStatePointer,
              resultPointer,
              maskPointer,
              false,
              0,
              0,
              candidateProtectionPointer,
              candidateLaunchAnglePointer,
              acceptedHardLaunchAngle,
              launchContextPointer,
              initializeLaunchState,
              pointXPointer,
              pointYPointer,
              pointCount,
              pathSteepness,
              candidateBoundaryMaterialIdentityPointer,
              resolveCandidateFormulaPoints,
            );
            if (derivativeReplayStatus == CANDIDATE_REPLAY_SUCCESS) {
              const derivativePositionError = calculatePositionErrorPlanePixels(
                candidateStatePointer,
                load<f64>(pointYPointer + (segmentIndex + 1) * sizeof<f64>()),
                boundsMinY,
                boundsMaxY,
              );
              const derivativeError = NativeMath.abs(
                load<f64>(candidateStatePointer + TRAJECTORY_SCALAR_STATE_DY_OFFSET),
              );
              const hasDerivativeObstacleHit =
                (load<u32>(resultPointer + TRAJECTORY_SCALAR_RESULT_FLAGS_OFFSET) &
                  TRAJECTORY_SCALAR_RESULT_FLAG_OBSTACLE_HIT) !=
                0;
              if (
                isFiniteValue(derivativePositionError) &&
                isFiniteValue(derivativeError) &&
                (!hasDerivativeObstacleHit || hasSoftObstacleHit) &&
                isStepSecondOrderLandingQualityBetter(
                  derivativeError,
                  derivativePositionError,
                  softDerivativeError,
                  softPositionError,
                  0,
                  0,
                  positionTargetPlanePixels,
                  true,
                  false,
                )
              ) {
                softDeltaY = derivativeDeltaY;
                softFormulaX = derivativeFormulaX;
                softPositionError = derivativePositionError;
                softDerivativeError = derivativeError;
                hasSoftObstacleHit = hasDerivativeObstacleHit;
                softLaunchAngle = load<f64>(candidateLaunchAnglePointer);
                memory.copy(softStatePointer, candidateStatePointer, TRAJECTORY_SCALAR_STATE_BYTE_LENGTH);
                memory.copy(
                  softProtectionPointer,
                  candidateProtectionPointer,
                  checkedByteLength(segmentCount, sizeof<u32>()),
                );
                memory.copy(
                  softBoundaryMaterialIdentityPointer,
                  candidateBoundaryMaterialIdentityPointer,
                  boundaryMaterialIdentityByteLength,
                );
              }
            }
          }
        }
      }
    }

    const hasMaskRequirement = hasFixedWindows
      ? isFixedWindowPresent
      : isStepGlitchModeEnabled &&
        maskPointer != 0 &&
        stepGlitchObstacleEnvelopeHitsObstacle(
          load<f64>(pointXPointer + segmentIndex * sizeof<f64>()),
          load<f64>(pointYPointer + segmentIndex * sizeof<f64>()),
          targetX,
          load<f64>(pointYPointer + (segmentIndex + 1) * sizeof<f64>()),
          load<f64>(initialFormulaPointXPointer + (segmentIndex + 1) * sizeof<f64>()),
          boundsMinX,
          boundsMaxX,
          boundsMinY,
          boundsMaxY,
          maskPointer,
        );
    const isHardRequired =
      isStepGlitchModeEnabled &&
      (hasMaskRequirement || !isSoftReplayValid || hasSoftObstacleHit || softPositionError > positionTargetPlanePixels);
    let hasHardWinner = false;
    let hardLaunchAngle = f64.NaN;
    if (isHardRequired) {
      store<f64>(deltaYPointer + segmentIndex * sizeof<f64>(), nextDeltaY);
      store<f64>(formulaPointXPointer + (segmentIndex + 1) * sizeof<f64>(), nextFormulaX);
      store<u8>(disabledPointer + segmentIndex, 0);
      const initialWindowDecimalPlaces = getStepGlitchInitialWindowDecimalPlaces();
      const isLaunchWindowRequired =
        !isFixedWindowPresent && segmentIndex == 0 && targetX <= soldierX + getGraphwarGameSoldierRadius();
      let glitchDecimalPlaces = decimalPlaces > 1 ? decimalPlaces : 1;
      while (glitchDecimalPlaces <= 15 && !hasHardWinner) {
        const targetY = quantizeFormulaOffsetCenter(formulaTargetY, glitchDecimalPlaces);
        let windowWidth = getGraphwarStepSize();
        let windowDecimalPlaces = initialWindowDecimalPlaces;
        while (windowWidth >= getGraphwarLastBisectedXStepDistance() && !hasHardWinner) {
          let hasJump = false;
          let launchWindowAngle = f64.NaN;
          if (isFixedWindowPresent) {
            store<f64>(
              jumpPointer + STEP_GLITCH_JUMP_START_X_OFFSET,
              load<f64>(segmentFixedWindowPointer + STEP_GLITCH_FIXED_WINDOW_START_X_OFFSET),
            );
            store<f64>(
              jumpPointer + STEP_GLITCH_JUMP_END_X_OFFSET,
              load<f64>(segmentFixedWindowPointer + STEP_GLITCH_FIXED_WINDOW_END_X_OFFSET),
            );
            store<f64>(jumpPointer + STEP_GLITCH_JUMP_STEP_OFFSET, getGraphwarLastBisectedXStepDistance());
            hasJump =
              load<f64>(jumpPointer + STEP_GLITCH_JUMP_START_X_OFFSET) >
                load<f64>(pointXPointer + segmentIndex * sizeof<f64>()) &&
              load<f64>(jumpPointer + STEP_GLITCH_JUMP_END_X_OFFSET) >
                load<f64>(jumpPointer + STEP_GLITCH_JUMP_START_X_OFFSET) &&
              targetX >= load<f64>(jumpPointer + STEP_GLITCH_JUMP_END_X_OFFSET);
          } else if (isLaunchWindowRequired && windowWidth == getGraphwarStepSize()) {
            if (equation == FORMULA_EQUATION_DY) {
              store<f64>(
                jumpPointer + STEP_GLITCH_JUMP_START_X_OFFSET,
                quantizeFormulaOffsetCenter(soldierX, glitchDecimalPlaces),
              );
              store<f64>(
                jumpPointer + STEP_GLITCH_JUMP_END_X_OFFSET,
                quantizeFormulaOffsetCenter(
                  soldierX + getGraphwarGameSoldierRadius() + getGraphwarStepSize(),
                  glitchDecimalPlaces,
                ),
              );
            } else {
              const targetDirection = targetY < soldierY ? -1.0 : 1.0;
              const launchCosine = NativeMath.min(
                1,
                NativeMath.max(
                  0,
                  (targetX - soldierX) / (2 * getGraphwarGameSoldierRadius()),
                ),
              );
              launchWindowAngle = targetDirection * NativeMath.acos(launchCosine);
              const launchX = soldierX + getGraphwarGameSoldierRadius() * NativeMath.cos(launchWindowAngle);
              store<f64>(
                jumpPointer + STEP_GLITCH_JUMP_START_X_OFFSET,
                quantizeFormulaOffsetCenter(launchX + getGraphwarStepSize(), glitchDecimalPlaces),
              );
              store<f64>(
                jumpPointer + STEP_GLITCH_JUMP_END_X_OFFSET,
                quantizeFormulaOffsetCenter(launchX + 2 * getGraphwarStepSize(), glitchDecimalPlaces),
              );
            }
            store<f64>(
              jumpPointer + STEP_GLITCH_JUMP_STEP_OFFSET,
              getGraphwarLastBisectedXStepDistance(),
            );
            hasJump =
              load<f64>(jumpPointer + STEP_GLITCH_JUMP_END_X_OFFSET) >
              load<f64>(jumpPointer + STEP_GLITCH_JUMP_START_X_OFFSET);
          } else if (!isLaunchWindowRequired) {
            hasJump = createStepGlitchJump(
              load<f64>(pointXPointer + segmentIndex * sizeof<f64>()),
              targetX,
              windowWidth,
              glitchDecimalPlaces,
              windowDecimalPlaces,
              jumpPointer,
            );
          }
          if (hasJump) {
            let hasPreJumpState = false;
            let preJumpY = 0.0;
            if (isLaunchWindowRequired && equation == FORMULA_EQUATION_DY) {
              preJumpY =
                soldierY +
                (targetY < soldierY ? -getGraphwarGameSoldierRadius() : getGraphwarGameSoldierRadius());
              initializeTrajectoryScalarState(
                preJumpStatePointer,
                equation,
                soldierX,
                soldierY,
                0,
                0,
                0,
                0,
                0,
                false,
              );
              hasPreJumpState = true;
            } else {
              if (isLaunchWindowRequired) {
                initializeTrajectoryScalarState(
                  candidateStatePointer,
                  equation,
                  soldierX + getGraphwarGameSoldierRadius() * NativeMath.cos(launchWindowAngle),
                  soldierY + getGraphwarGameSoldierRadius() * NativeMath.sin(launchWindowAngle),
                  NativeMath.tan(launchWindowAngle),
                  0,
                  0,
                  0,
                  0,
                  false,
                );
              } else {
                memory.copy(candidateStatePointer, startStatePointer, TRAJECTORY_SCALAR_STATE_BYTE_LENGTH);
              }
              replayFormulaTrajectoryScalarToStopX(
                prefixMaterialPointer,
                equation,
                baseY,
                0,
                boundsMinX,
                boundsMaxX,
                boundsMinY,
                boundsMaxY,
                load<f64>(jumpPointer + STEP_GLITCH_JUMP_START_X_OFFSET),
                protectionPointer,
                candidateStatePointer,
                resultPointer,
                false,
              );
              recordTrajectoryDebugScalarReplay(resultPointer);
              mergeObservedProtection(prefixMaterialPointer, combinedProtectionPointer, segmentCount);
              if (hasNewProtection(combinedProtectionPointer, protectionPointer, segmentCount)) {
                hasProtectionChanged = true;
              }
              if (
                load<i32>(resultPointer + TRAJECTORY_SCALAR_RESULT_STOP_REASON_OFFSET) ==
                  TRAJECTORY_SCALAR_STOP_REASON_STOP_X &&
                preparePreJumpState(
                  candidateStatePointer,
                  load<f64>(jumpPointer + STEP_GLITCH_JUMP_START_X_OFFSET),
                  equation,
                  preJumpStatePointer,
                )
              ) {
                const crossingX = load<f64>(candidateStatePointer + TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET);
                const crossingY = load<f64>(candidateStatePointer + TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET);
                const previousX = load<f64>(candidateStatePointer + TRAJECTORY_SCALAR_STATE_PREVIOUS_X_OFFSET);
                const previousY = load<f64>(candidateStatePointer + TRAJECTORY_SCALAR_STATE_PREVIOUS_Y_OFFSET);
                const startX = load<f64>(jumpPointer + STEP_GLITCH_JUMP_START_X_OFFSET);
                const ratio = (startX - previousX) / (crossingX - previousX);
                preJumpY = previousY + ratio * (crossingY - previousY);
                hasPreJumpState = true;
              }
            }
            if (hasPreJumpState) {
              const replacementDeltaY = targetY - preJumpY;
              let hasWindowWinner = false;
              let bestPositionError = f64.POSITIVE_INFINITY;
              let bestDerivativeError = f64.POSITIVE_INFINITY;
              const candidateCount =
                equation == FORMULA_EQUATION_DY
                  ? STEP_GLITCH_RK4_CONTRIBUTION_FACTOR_COUNT
                  : STEP_GLITCH_SECOND_ORDER_PROFILE_COUNT;
              let candidateIndex: u32 = 0;
              while (candidateIndex < candidateCount) {
                let isCandidateAvailable: bool;
                if (equation == FORMULA_EQUATION_DY) {
                  createStepFirstOrderGlitchSegment(
                    jumpPointer,
                    targetY,
                    createStepGlitchFormulaGateY(targetY, replacementDeltaY, glitchDecimalPlaces),
                    replacementDeltaY,
                    getStepGlitchRk4ContributionFactor(candidateIndex),
                    glitchDecimalPlaces,
                    candidateSegmentPointer,
                  );
                  isCandidateAvailable = true;
                } else {
                  isCandidateAvailable = createStepSecondOrderGlitchSegmentCandidate(
                    jumpPointer,
                    targetY,
                    load<f64>(preJumpStatePointer + TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET),
                    load<f64>(preJumpStatePointer + TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET),
                    load<f64>(preJumpStatePointer + TRAJECTORY_SCALAR_STATE_DY_OFFSET),
                    glitchDecimalPlaces,
                    candidateIndex,
                    candidateSegmentPointer,
                  );
                }
                if (isCandidateAvailable) {
                  memory.copy(
                    glitchPointer + segmentIndex * STEP_GLITCH_RECORD_BYTE_LENGTH,
                    candidateSegmentPointer,
                    STEP_GLITCH_RECORD_BYTE_LENGTH,
                  );
                  const candidateReplayStatus = replayCurrentCandidate(
                    buildInputPointer,
                    formulaPointXPointer,
                    formulaPointYPointer,
                    equation,
                    baseY,
                    boundsMinX,
                    boundsMaxX,
                    boundsMinY,
                    boundsMaxY,
                    load<f64>(jumpPointer + STEP_GLITCH_JUMP_END_X_OFFSET),
                    protectionPointer,
                    segmentCount,
                    preJumpStatePointer,
                    load<u32>(protectionPointer + segmentIndex * sizeof<u32>()) == 0 &&
                      (!isLaunchWindowRequired || equation == FORMULA_EQUATION_DDY),
                    candidateStatePointer,
                    resultPointer,
                    maskPointer,
                    true,
                    load<f64>(jumpPointer + STEP_GLITCH_JUMP_START_X_OFFSET),
                    load<f64>(jumpPointer + STEP_GLITCH_JUMP_END_X_OFFSET),
                    candidateProtectionPointer,
                    candidateLaunchAnglePointer,
                    isLaunchWindowRequired && equation == FORMULA_EQUATION_DDY
                      ? launchWindowAngle
                      : acceptedHardLaunchAngle,
                    launchContextPointer,
                    initializeLaunchState,
                    pointXPointer,
                    pointYPointer,
                    pointCount,
                    pathSteepness,
                    candidateBoundaryMaterialIdentityPointer,
                    resolveCandidateFormulaPoints,
                  );
                  if (
                    candidateReplayStatus == CANDIDATE_REPLAY_SUCCESS &&
                    (load<u32>(resultPointer + TRAJECTORY_SCALAR_RESULT_FLAGS_OFFSET) >>
                      TRAJECTORY_SCALAR_RESULT_JUMP_WINDOW_COUNT_SHIFT) ==
                      1
                  ) {
                    const candidatePositionError = calculatePositionErrorPlanePixels(
                      candidateStatePointer,
                      targetY,
                      boundsMinY,
                      boundsMaxY,
                    );
                    const candidateDerivativeError =
                      equation == FORMULA_EQUATION_DDY
                        ? NativeMath.abs(load<f64>(candidateStatePointer + TRAJECTORY_SCALAR_STATE_DY_OFFSET))
                        : 0;
                    if (
                      isFiniteValue(candidatePositionError) &&
                      isFiniteValue(candidateDerivativeError) &&
                      (load<u32>(resultPointer + TRAJECTORY_SCALAR_RESULT_FLAGS_OFFSET) &
                        TRAJECTORY_SCALAR_RESULT_FLAG_OBSTACLE_HIT) ==
                        0 &&
                      (!isSoftReplayValid || candidatePositionError < softPositionError) &&
                      (equation == FORMULA_EQUATION_DDY
                        ? isStepSecondOrderLandingQualityBetter(
                            candidateDerivativeError,
                            candidatePositionError,
                            bestDerivativeError,
                            bestPositionError,
                            0,
                            0,
                            positionTargetPlanePixels,
                            hasWindowWinner,
                            false,
                          )
                        : candidatePositionError < bestPositionError)
                    ) {
                      hasWindowWinner = true;
                      bestPositionError = candidatePositionError;
                      bestDerivativeError = candidateDerivativeError;
                      hardLaunchAngle = load<f64>(candidateLaunchAnglePointer);
                      memory.copy(hardSegmentPointer, candidateSegmentPointer, STEP_GLITCH_RECORD_BYTE_LENGTH);
                      memory.copy(hardStatePointer, candidateStatePointer, TRAJECTORY_SCALAR_STATE_BYTE_LENGTH);
                      memory.copy(
                        hardProtectionPointer,
                        candidateProtectionPointer,
                        checkedByteLength(segmentCount, sizeof<u32>()),
                      );
                      memory.copy(
                        hardBoundaryMaterialIdentityPointer,
                        candidateBoundaryMaterialIdentityPointer,
                        boundaryMaterialIdentityByteLength,
                      );
                    }
                  }
                }
                candidateIndex += 1;
              }
              if (hasWindowWinner) {
                memory.copy(
                  glitchPointer + segmentIndex * STEP_GLITCH_RECORD_BYTE_LENGTH,
                  hardSegmentPointer,
                  STEP_GLITCH_RECORD_BYTE_LENGTH,
                );
                hasHardWinner = true;
              } else {
                memory.fill(
                  glitchPointer + segmentIndex * STEP_GLITCH_RECORD_BYTE_LENGTH,
                  0,
                  STEP_GLITCH_RECORD_BYTE_LENGTH,
                );
              }
            }
          }
          if (isFixedWindowPresent) {
            windowWidth = 0;
          } else {
            windowWidth /= 2;
            windowDecimalPlaces += 1;
          }
        }
        glitchDecimalPlaces += 1;
      }
    }

    if (hasHardWinner) {
      mergeProtectionValues(hardProtectionPointer, combinedProtectionPointer, segmentCount);
      if (hasNewProtection(combinedProtectionPointer, protectionPointer, segmentCount)) {
        hasProtectionChanged = true;
      }
      store<f64>(deltaYPointer + segmentIndex * sizeof<f64>(), nextDeltaY);
      store<f64>(formulaPointXPointer + (segmentIndex + 1) * sizeof<f64>(), nextFormulaX);
      memory.copy(
        acceptedBoundaryStatePointer,
        hardStatePointer,
        TRAJECTORY_SCALAR_STATE_BYTE_LENGTH,
      );
      memory.copy(
        acceptedBoundaryProtectionPointer,
        hardProtectionPointer,
        checkedByteLength(segmentCount, sizeof<u32>()),
      );
      acceptedBoundaryLaunchAngle = hardLaunchAngle;
      acceptedHardLaunchAngle = hardLaunchAngle;
      acceptedBoundaryStopX = load<f64>(hardSegmentPointer + STEP_GLITCH_RECORD_END_X_OFFSET);
      memory.copy(
        acceptedBoundaryMaterialIdentityPointer,
        hardBoundaryMaterialIdentityPointer,
        boundaryMaterialIdentityByteLength,
      );
      hasAcceptedBoundaryState = true;
      if (acceptedHardLaunchAnglePointer != 0) {
        store<f64>(acceptedHardLaunchAnglePointer, hardLaunchAngle);
      }
    } else if (isSoftReplayValid && !hasSoftObstacleHit) {
      mergeProtectionValues(softProtectionPointer, combinedProtectionPointer, segmentCount);
      if (hasNewProtection(combinedProtectionPointer, protectionPointer, segmentCount)) {
        hasProtectionChanged = true;
      }
      memory.fill(
        glitchPointer + segmentIndex * STEP_GLITCH_RECORD_BYTE_LENGTH,
        0,
        STEP_GLITCH_RECORD_BYTE_LENGTH,
      );
      store<f64>(deltaYPointer + segmentIndex * sizeof<f64>(), softDeltaY);
      store<f64>(formulaPointXPointer + (segmentIndex + 1) * sizeof<f64>(), softFormulaX);
      memory.copy(
        acceptedBoundaryStatePointer,
        softStatePointer,
        TRAJECTORY_SCALAR_STATE_BYTE_LENGTH,
      );
      memory.copy(
        acceptedBoundaryProtectionPointer,
        softProtectionPointer,
        checkedByteLength(segmentCount, sizeof<u32>()),
      );
      acceptedBoundaryLaunchAngle = softLaunchAngle;
      acceptedBoundaryStopX = targetX;
      memory.copy(
        acceptedBoundaryMaterialIdentityPointer,
        softBoundaryMaterialIdentityPointer,
        boundaryMaterialIdentityByteLength,
      );
      hasAcceptedBoundaryState = true;
    } else if (isFixedWindowPresent) {
      resetArena(segmentMark);
      return hasProtectionChanged ? STEP_COLD_REFINEMENT_PROTECTION_CHANGED : STEP_COLD_REFINEMENT_INVALID;
    } else if (shouldReplaySoft) {
      if (isStepGlitchModeEnabled) {
        resetArena(segmentMark);
        return hasProtectionChanged ? STEP_COLD_REFINEMENT_PROTECTION_CHANGED : STEP_COLD_REFINEMENT_INVALID;
      }
      store<f64>(deltaYPointer + segmentIndex * sizeof<f64>(), nextDeltaY);
      store<f64>(formulaPointXPointer + (segmentIndex + 1) * sizeof<f64>(), nextFormulaX);
    } else {
      store<f64>(deltaYPointer + segmentIndex * sizeof<f64>(), nextDeltaY);
      store<f64>(formulaPointXPointer + (segmentIndex + 1) * sizeof<f64>(), nextFormulaX);
    }
    store<u8>(disabledPointer + segmentIndex, 0);
    resetArena(segmentMark);
    segmentIndex += 1;
  }
  memory.fill(disabledPointer, 0, segmentCount);
  return hasProtectionChanged ? STEP_COLD_REFINEMENT_PROTECTION_CHANGED : STEP_COLD_REFINEMENT_SUCCESS;
}

function replayCurrentCandidate(
  buildInputPointer: u32,
  formulaPointXPointer: u32,
  formulaPointYPointer: u32,
  equation: i32,
  baseY: f64,
  boundsMinX: f64,
  boundsMaxX: f64,
  boundsMinY: f64,
  boundsMaxY: f64,
  stopX: f64,
  protectionPointer: u32,
  segmentCount: u32,
  initialStatePointer: u32,
  hasInitialState: bool,
  outputStatePointer: u32,
  resultPointer: u32,
  maskPointer: u32,
  hasJumpWindow: bool,
  jumpWindowStartX: f64,
  jumpWindowEndX: f64,
  candidateProtectionPointer: u32,
  candidateLaunchAnglePointer: u32,
  forcedLaunchAngle: f64,
  launchContextPointer: u32,
  initializeLaunchState: StepColdLaunchStateInitializer,
  targetXPointer: u32,
  targetYPointer: u32,
  pointCount: u32,
  pathSteepness: f64,
  candidateMaterialIdentityPointer: u32,
  resolveCandidateFormulaPoints: StepColdFormulaPointResolver,
): i32 {
  const candidateMark = markArena();
  const protectionByteLength = checkedByteLength(segmentCount, sizeof<u32>());
  const localProtectionPointer = reserveArena(protectionByteLength, sizeof<u32>());
  memory.copy(localProtectionPointer, protectionPointer, protectionByteLength);
  let canReuseInitialState = hasInitialState;
  let replayStatus = CANDIDATE_REPLAY_INVALID;
  while (true) {
    const replayMark = markArena();
    let candidateFormulaPointXPointer = formulaPointXPointer;
    let candidateFormulaPointYPointer = formulaPointYPointer;
    if (!hasInitialState) {
      const pointByteLength = checkedByteLength(pointCount, sizeof<f64>());
      candidateFormulaPointXPointer = reserveArena(pointByteLength, sizeof<f64>());
      candidateFormulaPointYPointer = reserveArena(pointByteLength, sizeof<f64>());
      const candidateObservedProtectionPointer = reserveArena(protectionByteLength, sizeof<u32>());
      memory.copy(candidateObservedProtectionPointer, localProtectionPointer, protectionByteLength);
      const isCandidateFormulaValid = resolveCandidateFormulaPoints(
        buildInputPointer,
        targetXPointer,
        targetYPointer,
        formulaPointXPointer,
        formulaPointYPointer,
        candidateFormulaPointXPointer,
        candidateFormulaPointYPointer,
        pathSteepness,
        localProtectionPointer,
        candidateObservedProtectionPointer,
        launchContextPointer,
      );
      const hasFormulaProtectionChange = hasNewProtection(
        candidateObservedProtectionPointer,
        localProtectionPointer,
        segmentCount,
      );
      mergeProtectionValues(candidateObservedProtectionPointer, localProtectionPointer, segmentCount);
      if (hasFormulaProtectionChange) {
        canReuseInitialState = false;
        resetArena(replayMark);
        continue;
      }
      if (!isCandidateFormulaValid) {
        replayStatus = CANDIDATE_REPLAY_INVALID;
        resetArena(replayMark);
        break;
      }
    }
    store<u32>(buildInputPointer + FORMULA_INPUT_POINT_X_POINTER_OFFSET, candidateFormulaPointXPointer);
    store<u32>(buildInputPointer + FORMULA_INPUT_POINT_Y_POINTER_OFFSET, candidateFormulaPointYPointer);
    store<u32>(buildInputPointer + FORMULA_INPUT_SIGN_PROTECTION_POINTER_OFFSET, localProtectionPointer);
    const materialResultPointer = runStepLaunchBatch(buildInputPointer);
    const candidateBaseY = load<f64>(candidateFormulaPointYPointer);
    const isLaunchValid = initializeLaunchState(
      materialResultPointer,
      equation,
      candidateBaseY,
      localProtectionPointer,
      outputStatePointer,
      candidateLaunchAnglePointer,
      forcedLaunchAngle,
      launchContextPointer,
    );
    recordTrajectoryDebugReplayStart();
    if (isLaunchValid && canReuseInitialState) {
      memory.copy(outputStatePointer, initialStatePointer, TRAJECTORY_SCALAR_STATE_BYTE_LENGTH);
    }
    if (isLaunchValid) {
      if (hasJumpWindow) {
        replayFormulaTrajectoryScalarToStopXWithMaskAndJumpWindow(
          materialResultPointer,
          equation,
          candidateBaseY,
          0,
          boundsMinX,
          boundsMaxX,
          boundsMinY,
          boundsMaxY,
          stopX,
          localProtectionPointer,
          outputStatePointer,
          resultPointer,
          false,
          maskPointer,
          jumpWindowStartX,
          jumpWindowEndX,
        );
      } else if (maskPointer == 0) {
        replayFormulaTrajectoryScalarToStopX(
          materialResultPointer,
          equation,
          candidateBaseY,
          0,
          boundsMinX,
          boundsMaxX,
          boundsMinY,
          boundsMaxY,
          stopX,
          localProtectionPointer,
          outputStatePointer,
          resultPointer,
          false,
        );
      } else {
        replayFormulaTrajectoryScalarToStopXWithMask(
          materialResultPointer,
          equation,
          candidateBaseY,
          0,
          boundsMinX,
          boundsMaxX,
          boundsMinY,
          boundsMaxY,
          stopX,
          localProtectionPointer,
          outputStatePointer,
          resultPointer,
          false,
          maskPointer,
        );
      }
      recordTrajectoryDebugScalarResult(resultPointer);
      replayStatus =
        load<i32>(resultPointer + TRAJECTORY_SCALAR_RESULT_STOP_REASON_OFFSET) == TRAJECTORY_SCALAR_STOP_REASON_STOP_X
          ? CANDIDATE_REPLAY_SUCCESS
          : CANDIDATE_REPLAY_INVALID;
    } else {
      replayStatus = CANDIDATE_REPLAY_INVALID;
    }
    const observedPointer = load<u32>(materialResultPointer + FORMULA_RESULT_PROTECTION_POINTER_OFFSET);
    const hasRoundProtectionChange = hasNewProtection(observedPointer, localProtectionPointer, segmentCount);
    mergeObservedProtection(materialResultPointer, localProtectionPointer, segmentCount);
    if (!hasRoundProtectionChange && replayStatus == CANDIDATE_REPLAY_SUCCESS) {
      captureStepBoundaryMaterialIdentity(materialResultPointer, candidateMaterialIdentityPointer);
    }
    resetArena(replayMark);
    if (!hasRoundProtectionChange) {
      break;
    }
    canReuseInitialState = false;
  }
  memory.copy(candidateProtectionPointer, localProtectionPointer, protectionByteLength);
  store<u32>(buildInputPointer + FORMULA_INPUT_POINT_X_POINTER_OFFSET, formulaPointXPointer);
  store<u32>(buildInputPointer + FORMULA_INPUT_POINT_Y_POINTER_OFFSET, formulaPointYPointer);
  store<u32>(buildInputPointer + FORMULA_INPUT_SIGN_PROTECTION_POINTER_OFFSET, protectionPointer);
  resetArena(candidateMark);
  return replayStatus;
}

function preparePreJumpState(
  crossingStatePointer: u32,
  jumpStartX: f64,
  equation: i32,
  outputStatePointer: u32,
): bool {
  const flags = load<u32>(crossingStatePointer + TRAJECTORY_SCALAR_STATE_FLAGS_OFFSET);
  if ((flags & TRAJECTORY_SCALAR_STATE_FLAG_HAS_PREVIOUS_POINT) == 0) {
    return false;
  }
  const crossingX = load<f64>(crossingStatePointer + TRAJECTORY_SCALAR_STATE_CURRENT_X_OFFSET);
  const previousX = load<f64>(crossingStatePointer + TRAJECTORY_SCALAR_STATE_PREVIOUS_X_OFFSET);
  if (!(previousX < jumpStartX) || !(crossingX >= jumpStartX) || !(crossingX > previousX)) {
    return false;
  }
  const sampleIndex = load<u32>(crossingStatePointer + TRAJECTORY_SCALAR_STATE_SAMPLE_INDEX_OFFSET) - 1;
  const previousY = load<f64>(crossingStatePointer + TRAJECTORY_SCALAR_STATE_PREVIOUS_Y_OFFSET);
  const previousDy =
    equation == FORMULA_EQUATION_DDY && (flags & TRAJECTORY_SCALAR_STATE_FLAG_HAS_PREVIOUS_DY) != 0
      ? load<f64>(crossingStatePointer + TRAJECTORY_SCALAR_STATE_PREVIOUS_DY_OFFSET)
      : 0;
  initializeTrajectoryScalarState(
    outputStatePointer,
    equation,
    previousX,
    previousY,
    previousDy,
    previousX,
    previousY,
    previousDy,
    sampleIndex,
    sampleIndex > 0,
  );
  store<u32>(outputStatePointer + TRAJECTORY_SCALAR_STATE_MIN_STEP_JUMP_COUNT_OFFSET, 0);
  return true;
}

function resolveRefinedFormulaX(
  resolutionPointer: u32,
  transitionPointer: u32,
  targetY: f64,
  deltaY: f64,
  decimalPlaces: i32,
  equation: i32,
  formulaSteepness: f64,
  startX: f64,
  targetX: f64,
  boundsMinX: f64,
  boundsMaxX: f64,
  boundsMinY: f64,
  boundsMaxY: f64,
  positionTargetPlanePixels: f64,
): f64 {
  resolveStepFormulaTransition(
    resolutionPointer,
    targetY,
    deltaY,
    true,
    decimalPlaces,
    equation,
    transitionPointer,
  );
  return calculateStepRefinedFormulaCenterX(
    startX,
    targetX,
    load<f64>(transitionPointer + STEP_TRANSITION_EFFECTIVE_DELTA_Y_OFFSET),
    formulaSteepness,
    boundsMinX,
    boundsMaxX,
    boundsMinY,
    boundsMaxY,
    positionTargetPlanePixels,
  );
}

function calculatePositionErrorPlanePixels(
  statePointer: u32,
  targetY: f64,
  boundsMinY: f64,
  boundsMaxY: f64,
): f64 {
  const verticalSpan = NativeMath.abs(boundsMaxY - boundsMinY);
  return verticalSpan > 0
    ? (NativeMath.abs(load<f64>(statePointer + TRAJECTORY_SCALAR_STATE_CURRENT_Y_OFFSET) - targetY) *
        getGraphwarPlaneHeight()) /
        verticalSpan
    : f64.POSITIVE_INFINITY;
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

function mergeProtectionValues(sourcePointer: u32, combinedPointer: u32, segmentCount: u32): void {
  let index: u32 = 0;
  while (index < segmentCount) {
    const pointer = combinedPointer + index * sizeof<u32>();
    store<u32>(pointer, load<u32>(pointer) | load<u32>(sourcePointer + index * sizeof<u32>()));
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

@inline
function checkedAddByteLength(left: u32, right: u32): u32 {
  const byteLength = <u64>left + right;
  if (byteLength > 0xffff_ffff) {
    unreachable();
  }
  return <u32>byteLength;
}

function captureStepBoundaryMaterialIdentity(materialResultPointer: u32, identityPointer: u32): void {
  const materialCount = load<u32>(materialResultPointer + FORMULA_RESULT_MATERIAL_COUNT_OFFSET);
  const materialStride = load<u32>(materialResultPointer + FORMULA_RESULT_MATERIAL_STRIDE_OFFSET);
  store<u32>(identityPointer, materialCount);
  store<i32>(identityPointer + 4, load<i32>(materialResultPointer + FORMULA_RESULT_MATERIAL_TYPE_OFFSET));
  store<u32>(identityPointer + 8, materialStride);
  store<u32>(identityPointer + 12, load<u32>(materialResultPointer + FORMULA_RESULT_FLAGS_OFFSET));
  store<u64>(
    identityPointer + 16,
    load<u64>(materialResultPointer + FORMULA_RESULT_AUXILIARY_VALUE_OFFSET),
  );
  memory.copy(
    identityPointer + STEP_BOUNDARY_MATERIAL_IDENTITY_HEADER_BYTE_LENGTH,
    load<u32>(materialResultPointer + FORMULA_RESULT_MATERIAL_POINTER_OFFSET),
    checkedByteLength(materialCount, materialStride),
  );
}

function stepBoundaryMaterialIdentityMatches(materialResultPointer: u32, identityPointer: u32): bool {
  const materialCount = load<u32>(materialResultPointer + FORMULA_RESULT_MATERIAL_COUNT_OFFSET);
  const materialStride = load<u32>(materialResultPointer + FORMULA_RESULT_MATERIAL_STRIDE_OFFSET);
  if (
    materialStride != STEP_MATERIAL_BYTE_LENGTH ||
    load<u32>(identityPointer) != materialCount ||
    load<i32>(identityPointer + 4) != load<i32>(materialResultPointer + FORMULA_RESULT_MATERIAL_TYPE_OFFSET) ||
    load<u32>(identityPointer + 8) != materialStride ||
    load<u32>(identityPointer + 12) != load<u32>(materialResultPointer + FORMULA_RESULT_FLAGS_OFFSET) ||
    load<u64>(identityPointer + 16) != load<u64>(materialResultPointer + FORMULA_RESULT_AUXILIARY_VALUE_OFFSET)
  ) {
    return false;
  }
  const materialPointer = load<u32>(materialResultPointer + FORMULA_RESULT_MATERIAL_POINTER_OFFSET);
  const byteLength = checkedByteLength(materialCount, materialStride);
  let byteIndex: u32 = 0;
  while (byteIndex < byteLength) {
    if (
      load<u8>(identityPointer + STEP_BOUNDARY_MATERIAL_IDENTITY_HEADER_BYTE_LENGTH + byteIndex) !=
      load<u8>(materialPointer + byteIndex)
    ) {
      return false;
    }
    byteIndex += 1;
  }
  return true;
}

function protectionValuesEqual(leftPointer: u32, rightPointer: u32, count: u32): bool {
  let index: u32 = 0;
  while (index < count) {
    if (load<u32>(leftPointer + index * sizeof<u32>()) != load<u32>(rightPointer + index * sizeof<u32>())) {
      return false;
    }
    index += 1;
  }
  return true;
}
