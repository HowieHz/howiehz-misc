import { floorFormulaDecimal, roundFormulaDecimal } from "./decimal";
import * as FormulaLayout from "./formula-layout";
import { runPrepareLaunch } from "./formula-launch";
import { getGraphwarPlaneHeight, getGraphwarPlaneLength } from "./game-constants";
import { commitArena, markArena, requireArenaRange, reserveArena, resetArena } from "./memory";
import * as Layout from "./step-glitch-layout";
import { runTrajectoryRequest, runTrajectoryRequestWithMetadata } from "./trajectory";
import * as TrajectoryLayout from "./trajectory-layout";

@inline
function trap(): void {
  unreachable();
}

/** Test-only seam proving scanner-owned commands execute the shared trajectory implementation. */
export function replayStepGlitchTrajectoryForTest(inputPointer: u32, inputByteLength: u32): u32 {
  return runTrajectoryRequest(inputPointer, inputByteLength, 0);
}

/** Builds one scanner candidate's structured Step request in WASM, then reuses the shared launch/material core. */
export function prepareStepGlitchCandidateFormulaForTest(inputPointer: u32, inputByteLength: u32): u32 {
  if (inputByteLength != Layout.STEP_GLITCH_FORMULA_INPUT_BYTE_LENGTH) trap();
  requireArenaRange(inputPointer, inputByteLength, sizeof<u32>());
  if (load<u32>(inputPointer + Layout.STEP_GLITCH_FORMULA_INPUT_RESERVED_OFFSET) != 0) trap();
  return runPrepareLaunch(
    buildStepGlitchCandidateFormulaInput(
      load<u32>(inputPointer + Layout.STEP_GLITCH_FORMULA_INPUT_CONTEXT_POINTER_OFFSET),
      load<u32>(inputPointer + Layout.STEP_GLITCH_FORMULA_INPUT_PATH_X_POINTER_OFFSET),
      load<u32>(inputPointer + Layout.STEP_GLITCH_FORMULA_INPUT_PATH_Y_POINTER_OFFSET),
      load<u32>(inputPointer + Layout.STEP_GLITCH_FORMULA_INPUT_PATH_COUNT_OFFSET),
      load<u32>(inputPointer + Layout.STEP_GLITCH_FORMULA_INPUT_WINDOW_POINTER_OFFSET),
      load<u32>(inputPointer + Layout.STEP_GLITCH_FORMULA_INPUT_WINDOW_COUNT_OFFSET),
      load<u32>(inputPointer + Layout.STEP_GLITCH_FORMULA_INPUT_WINDOW_MODE_OFFSET),
    ),
  );
}

/** Constructs the one canonical formula request shared by launch-only and real scanner replay commands. */
function buildStepGlitchCandidateFormulaInput(
  contextPointer: u32,
  pathXPointer: u32,
  pathYPointer: u32,
  pointCount: u32,
  windowPointer: u32,
  windowCount: u32,
  windowMode: u32,
): u32 {
  requireStepGlitchContext(contextPointer);
  const sourceCount = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_COUNT_OFFSET);
  if (pointCount < 2 || pointCount < sourceCount) trap();
  requireElementRange(pathXPointer, pointCount, sizeof<f64>(), sizeof<f64>());
  requireElementRange(pathYPointer, pointCount, sizeof<f64>(), sizeof<f64>());
  const sourceXPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_X_POINTER_OFFSET);
  const sourceYPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_Y_POINTER_OFFSET);
  let pointIndex: u32 = 0;
  while (pointIndex < pointCount) {
    const pixelX = load<f64>(pathXPointer + pointIndex * sizeof<f64>());
    const pixelY = load<f64>(pathYPointer + pointIndex * sizeof<f64>());
    if (!isFiniteValue(pixelX) || !isFiniteValue(pixelY)) trap();
    if (
      pointIndex < sourceCount &&
      (pixelX != load<f64>(sourceXPointer + pointIndex * sizeof<f64>()) ||
        pixelY != load<f64>(sourceYPointer + pointIndex * sizeof<f64>()))
    ) trap();
    pointIndex += 1;
  }

  const segmentCount = pointCount - 1;
  if (windowMode == Layout.STEP_GLITCH_FORMULA_WINDOW_MODE_AUTOMATIC) {
    if (windowPointer != 0 || windowCount != 0) trap();
  } else if (windowMode == Layout.STEP_GLITCH_FORMULA_WINDOW_MODE_EXPLICIT) {
    if (windowCount != segmentCount) trap();
    requireElementRange(
      windowPointer,
      windowCount,
      FormulaLayout.STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH,
      sizeof<f64>(),
    );
  } else {
    trap();
  }

  const valuesPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_VALUES_POINTER_OFFSET);
  const settingsPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SETTINGS_POINTER_OFFSET);
  const graphXPointer = reserveArena(pointCount * sizeof<f64>(), sizeof<f64>());
  const graphYPointer = reserveArena(pointCount * sizeof<f64>(), sizeof<f64>());
  const minX = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MIN_X_INDEX);
  const maxX = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MAX_X_INDEX);
  const minY = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MIN_Y_INDEX);
  const maxY = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MAX_Y_INDEX);
  const rectX = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_X_INDEX);
  const rectY = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_Y_INDEX);
  const rectWidth = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_WIDTH_INDEX);
  const rectHeight = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_HEIGHT_INDEX);
  pointIndex = 0;
  while (pointIndex < pointCount) {
    const pixelX = load<f64>(pathXPointer + pointIndex * sizeof<f64>());
    const pixelY = load<f64>(pathYPointer + pointIndex * sizeof<f64>());
    store<f64>(graphXPointer + pointIndex * sizeof<f64>(), minX + ((pixelX - rectX) / rectWidth) * (maxX - minX));
    store<f64>(graphYPointer + pointIndex * sizeof<f64>(), maxY - ((pixelY - rectY) / rectHeight) * (maxY - minY));
    pointIndex += 1;
  }

  const protectionPointer = reserveArena(segmentCount * sizeof<u32>(), sizeof<u32>());
  memory.fill(protectionPointer, 0, segmentCount * sizeof<u32>());
  const overflowRangePointer = reserveArena(2 * sizeof<f64>(), sizeof<f64>());
  store<f64>(overflowRangePointer, load<f64>(graphXPointer));
  store<f64>(overflowRangePointer + sizeof<f64>(), NativeMath.max(minX, maxX));
  const formulaInputPointer = reserveArena(FormulaLayout.FORMULA_INPUT_BYTE_LENGTH, sizeof<f64>());
  memory.fill(formulaInputPointer, 0, FormulaLayout.FORMULA_INPUT_BYTE_LENGTH);
  const equation = <i32>loadValue(settingsPointer, Layout.STEP_GLITCH_SETTING_EQUATION_INDEX);
  const settingsFlags = <u32>loadValue(settingsPointer, Layout.STEP_GLITCH_SETTING_FLAGS_INDEX);
  let formulaFlags = FormulaLayout.FORMULA_FLAG_STEP_GLITCH_MODE;
  if ((settingsFlags & Layout.STEP_GLITCH_SETTING_FLAG_OVERFLOW_PROTECTION) != 0) {
    formulaFlags |= FormulaLayout.FORMULA_FLAG_STEP_OVERFLOW_PROTECTION;
  }
  if (equation == FormulaLayout.FORMULA_EQUATION_DDY && loadValue(settingsPointer, Layout.STEP_GLITCH_SETTING_SECOND_ORDER_ANGLE_MODE_INDEX) == 2) {
    formulaFlags |= FormulaLayout.FORMULA_FLAG_DISPLAY_ROUNDED_ANGLE;
  }
  if (windowMode == Layout.STEP_GLITCH_FORMULA_WINDOW_MODE_EXPLICIT) {
    formulaFlags |= FormulaLayout.FORMULA_FLAG_STEP_GLITCH_FIXED_WINDOWS;
  }
  const steepness = loadValue(settingsPointer, Layout.STEP_GLITCH_SETTING_STEEPNESS_INDEX);
  const formulaPathSteepness =
    (settingsFlags & Layout.STEP_GLITCH_SETTING_FLAG_HAS_FORMULA_PATH_STEEPNESS) == 0
      ? steepness
      : loadValue(settingsPointer, Layout.STEP_GLITCH_SETTING_FORMULA_PATH_STEEPNESS_INDEX);
  store<i32>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_ALGORITHM_OFFSET, FormulaLayout.FORMULA_ALGORITHM_STEP);
  store<i32>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_EQUATION_OFFSET, equation);
  store<i32>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_DECIMAL_PLACES_OFFSET, <i32>loadValue(settingsPointer, Layout.STEP_GLITCH_SETTING_DECIMAL_PLACES_INDEX));
  store<u32>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_FLAGS_OFFSET, formulaFlags);
  store<u32>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_POINT_COUNT_OFFSET, pointCount);
  store<u32>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_POINT_X_POINTER_OFFSET, graphXPointer);
  store<u32>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_POINT_Y_POINTER_OFFSET, graphYPointer);
  store<u32>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_SIGN_PROTECTION_POINTER_OFFSET, protectionPointer);
  store<u32>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_SIGN_PROTECTION_COUNT_OFFSET, segmentCount);
  store<u32>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_STEP_OVERFLOW_RANGE_POINTER_OFFSET, overflowRangePointer);
  store<f64>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_STEEPNESS_OFFSET, steepness);
  store<f64>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_BOUNDS_MIN_X_OFFSET, minX);
  store<f64>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_BOUNDS_MAX_X_OFFSET, maxX);
  store<f64>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_BOUNDS_MIN_Y_OFFSET, minY);
  store<f64>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_BOUNDS_MAX_Y_OFFSET, maxY);
  store<f64>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_SOLDIER_X_OFFSET, load<f64>(graphXPointer));
  store<f64>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_SOLDIER_Y_OFFSET, load<f64>(graphYPointer));
  store<u32>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_GLITCH_SEGMENT_POINTER_OFFSET, windowPointer);
  store<u32>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_STEP_OVERFLOW_RANGE_COUNT_OFFSET, 2);
  store<f64>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_PATH_STEEPNESS_OFFSET, formulaPathSteepness);
  store<u32>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_MASK_POINTER_OFFSET, load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_MASK_POINTER_OFFSET));
  store<u32>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_MASK_BYTE_LENGTH_OFFSET, load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_MASK_LENGTH_OFFSET));
  store<f64>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_QUALITY_TARGET_PLANE_PIXELS_OFFSET, loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_QUALITY_TARGET_PLANE_PIXELS_INDEX));
  return formulaInputPointer;
}

function validateStepGlitchTargetRecords(pointer: u32, targetCount: u32): void {
  if (targetCount > u32.MAX_VALUE / 3) trap();
  const valueCount = targetCount * 3;
  requireElementRange(pointer, valueCount, sizeof<f64>(), sizeof<f64>());
  let targetIndex: u32 = 0;
  while (targetIndex < targetCount) {
    const recordPointer = pointer + targetIndex * 3 * sizeof<f64>();
    if (
      !isFiniteValue(load<f64>(recordPointer)) ||
      !isFiniteValue(load<f64>(recordPointer + sizeof<f64>())) ||
      !isFiniteValue(load<f64>(recordPointer + 2 * sizeof<f64>())) ||
      load<f64>(recordPointer + 2 * sizeof<f64>()) < 0
    ) trap();
    targetIndex += 1;
  }
}

/** Replays one cold scanner candidate through the shared trajectory core and applies scanner hit semantics. */
export function replayStepGlitchCandidateForTest(inputPointer: u32, inputByteLength: u32): u32 {
  if (inputByteLength != Layout.STEP_GLITCH_REPLAY_INPUT_BYTE_LENGTH) trap();
  requireArenaRange(inputPointer, inputByteLength, sizeof<f64>());
  const contextPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_REPLAY_CONTEXT_POINTER_OFFSET);
  requireStepGlitchContext(contextPointer);
  const targetRecordPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_REPLAY_TARGET_POINTER_OFFSET);
  const orderedTargetCount = load<u32>(inputPointer + Layout.STEP_GLITCH_REPLAY_TARGET_COUNT_OFFSET);
  const controlX = load<f64>(inputPointer + Layout.STEP_GLITCH_REPLAY_CONTROL_X_OFFSET);
  if (!isFiniteValue(controlX) || load<u32>(inputPointer + Layout.STEP_GLITCH_REPLAY_RESERVED_OFFSET) != 0) trap();
  validateStepGlitchTargetRecords(targetRecordPointer, orderedTargetCount);

  return replayStepGlitchCandidate(
    contextPointer,
    load<u32>(inputPointer + Layout.STEP_GLITCH_REPLAY_PATH_X_POINTER_OFFSET),
    load<u32>(inputPointer + Layout.STEP_GLITCH_REPLAY_PATH_Y_POINTER_OFFSET),
    load<u32>(inputPointer + Layout.STEP_GLITCH_REPLAY_PATH_COUNT_OFFSET),
    load<u32>(inputPointer + Layout.STEP_GLITCH_REPLAY_WINDOW_POINTER_OFFSET),
    load<u32>(inputPointer + Layout.STEP_GLITCH_REPLAY_WINDOW_COUNT_OFFSET),
    load<u32>(inputPointer + Layout.STEP_GLITCH_REPLAY_WINDOW_MODE_OFFSET),
    targetRecordPointer,
    orderedTargetCount,
    controlX,
  );
}

function replayStepGlitchCandidate(
  contextPointer: u32,
  pathXPointer: u32,
  pathYPointer: u32,
  pathCount: u32,
  windowPointer: u32,
  windowCount: u32,
  windowMode: u32,
  targetRecordPointer: u32,
  orderedTargetCount: u32,
  controlX: f64,
): u32 {
  return replayStepGlitchCandidateWithMetadata(
    contextPointer,
    pathXPointer,
    pathYPointer,
    pathCount,
    windowPointer,
    windowCount,
    windowMode,
    targetRecordPointer,
    orderedTargetCount,
    controlX,
    0,
    0,
  );
}

function replayStepGlitchCandidateWithMetadata(
  contextPointer: u32,
  pathXPointer: u32,
  pathYPointer: u32,
  pathCount: u32,
  windowPointer: u32,
  windowCount: u32,
  windowMode: u32,
  targetRecordPointer: u32,
  orderedTargetCount: u32,
  controlX: f64,
  metadataPointer: u32,
  finalValidationPointer: u32,
): u32 {
  const requiredTargetValueCount = load<u32>(
    contextPointer + Layout.STEP_GLITCH_CONTEXT_REQUIRED_TARGET_LENGTH_OFFSET,
  );
  if (requiredTargetValueCount % 3 != 0) trap();
  const requiredTargetCount = requiredTargetValueCount / 3;
  const trackedTargetCount = finalValidationPointer == 0
    ? 0
    : load<u32>(finalValidationPointer + Layout.STEP_GLITCH_FINAL_VALIDATION_TRACKED_TARGET_COUNT_OFFSET);
  if (
    orderedTargetCount > u32.MAX_VALUE - requiredTargetCount ||
    orderedTargetCount + requiredTargetCount > u32.MAX_VALUE - trackedTargetCount
  ) trap();
  const combinedTargetCount = orderedTargetCount + requiredTargetCount + trackedTargetCount;
  const combinedTargetPointer = combinedTargetCount == 0
    ? 0
    : reserveArena(combinedTargetCount * 3 * sizeof<f64>(), sizeof<f64>());
  if (orderedTargetCount != 0) {
    memory.copy(combinedTargetPointer, targetRecordPointer, orderedTargetCount * 3 * sizeof<f64>());
  }
  if (requiredTargetCount != 0) {
    memory.copy(
      combinedTargetPointer + orderedTargetCount * 3 * sizeof<f64>(),
      load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_REQUIRED_TARGET_POINTER_OFFSET),
      requiredTargetValueCount * sizeof<f64>(),
    );
  }
  if (trackedTargetCount != 0) {
    memory.copy(
      combinedTargetPointer + (orderedTargetCount + requiredTargetCount) * 3 * sizeof<f64>(),
      load<u32>(finalValidationPointer + Layout.STEP_GLITCH_FINAL_VALIDATION_TRACKED_TARGET_POINTER_OFFSET),
      trackedTargetCount * 3 * sizeof<f64>(),
    );
  }

  const trajectoryInputPointer = reserveArena(TrajectoryLayout.TRAJECTORY_INPUT_BYTE_LENGTH, sizeof<f64>());
  memory.fill(trajectoryInputPointer, 0, TrajectoryLayout.TRAJECTORY_INPUT_BYTE_LENGTH);
  const formulaInputPointer = buildStepGlitchCandidateFormulaInput(
    contextPointer,
    pathXPointer,
    pathYPointer,
    pathCount,
    windowPointer,
    windowCount,
    windowMode,
  );
  memory.copy(
    trajectoryInputPointer,
    formulaInputPointer,
    TrajectoryLayout.TRAJECTORY_INPUT_FORMULA_BYTE_LENGTH,
  );
  const valuesPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_VALUES_POINTER_OFFSET);
  store<u32>(
    trajectoryInputPointer + TrajectoryLayout.TRAJECTORY_INPUT_STOP_TYPE_OFFSET,
    TrajectoryLayout.TRAJECTORY_INPUT_STOP_TYPE_TARGETS,
  );
  store<u32>(
    trajectoryInputPointer + TrajectoryLayout.TRAJECTORY_INPUT_FLAGS_OFFSET,
    (finalValidationPointer == 0 ? TrajectoryLayout.TRAJECTORY_INPUT_FLAG_HAS_CONTINUE_GRAPH_X : 0) |
      TrajectoryLayout.TRAJECTORY_INPUT_FLAG_COLLECT_VISIBLE_PIXELS,
  );
  store<f64>(
    trajectoryInputPointer + TrajectoryLayout.TRAJECTORY_INPUT_STOP_X_OFFSET,
    finalValidationPointer == 0 ? controlX : 0,
  );
  store<u32>(
    trajectoryInputPointer + TrajectoryLayout.TRAJECTORY_INPUT_MASK_POINTER_OFFSET,
    load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_MASK_POINTER_OFFSET),
  );
  store<u32>(
    trajectoryInputPointer + TrajectoryLayout.TRAJECTORY_INPUT_MASK_BYTE_LENGTH_OFFSET,
    load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_MASK_LENGTH_OFFSET),
  );
  store<u32>(
    trajectoryInputPointer + TrajectoryLayout.TRAJECTORY_INPUT_ORDERED_TARGET_COUNT_OFFSET,
    orderedTargetCount,
  );
  store<u32>(
    trajectoryInputPointer + TrajectoryLayout.TRAJECTORY_INPUT_REQUIRED_TARGET_COUNT_OFFSET,
    requiredTargetCount,
  );
  store<u32>(
    trajectoryInputPointer + TrajectoryLayout.TRAJECTORY_INPUT_TRACKED_TARGET_COUNT_OFFSET,
    trackedTargetCount,
  );
  store<u32>(
    trajectoryInputPointer + TrajectoryLayout.TRAJECTORY_INPUT_TARGET_RECORD_POINTER_OFFSET,
    combinedTargetPointer,
  );
  store<u32>(
    trajectoryInputPointer + TrajectoryLayout.TRAJECTORY_INPUT_BOUNDARY_EXPANSION_OFFSET,
    <u32>loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_BOUNDARY_EXPANSION_INDEX),
  );
  if (finalValidationPointer != 0) {
    const targetControlXPointer = load<u32>(
      finalValidationPointer + Layout.STEP_GLITCH_FINAL_VALIDATION_TARGET_CONTROL_X_POINTER_OFFSET,
    );
    const targetControlYPointer = load<u32>(
      finalValidationPointer + Layout.STEP_GLITCH_FINAL_VALIDATION_TARGET_CONTROL_Y_POINTER_OFFSET,
    );
    const targetControlCount = load<u32>(
      finalValidationPointer + Layout.STEP_GLITCH_FINAL_VALIDATION_TARGET_CONTROL_COUNT_OFFSET,
    );
    const maximumQualityBytes = <u64>(pathCount - 1) * sizeof<f64>();
    if (maximumQualityBytes > 0xffff_ffff) trap();
    const qualityXPointer = reserveArena(<u32>maximumQualityBytes, sizeof<f64>());
    const qualityYPointer = reserveArena(<u32>maximumQualityBytes, sizeof<f64>());
    const minX = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MIN_X_INDEX);
    const maxX = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MAX_X_INDEX);
    const minY = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MIN_Y_INDEX);
    const maxY = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MAX_Y_INDEX);
    const rectX = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_X_INDEX);
    const rectY = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_Y_INDEX);
    const rectWidth = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_WIDTH_INDEX);
    const rectHeight = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_HEIGHT_INDEX);
    let qualityCount: u32 = 0;
    let qualityPathIndex: u32 = 1;
    while (qualityPathIndex < pathCount) {
      const pixelX = load<f64>(pathXPointer + qualityPathIndex * sizeof<f64>());
      const pixelY = load<f64>(pathYPointer + qualityPathIndex * sizeof<f64>());
      let isTargetControl = false;
      let targetControlIndex: u32 = 0;
      while (targetControlIndex < targetControlCount) {
        if (
          pixelX == load<f64>(targetControlXPointer + targetControlIndex * sizeof<f64>()) &&
          pixelY == load<f64>(targetControlYPointer + targetControlIndex * sizeof<f64>())
        ) {
          isTargetControl = true;
          break;
        }
        targetControlIndex += 1;
      }
      if (!isTargetControl) {
        store<f64>(
          qualityXPointer + qualityCount * sizeof<f64>(),
          minX + ((pixelX - rectX) / rectWidth) * (maxX - minX),
        );
        store<f64>(
          qualityYPointer + qualityCount * sizeof<f64>(),
          maxY - ((pixelY - rectY) / rectHeight) * (maxY - minY),
        );
        qualityCount += 1;
      }
      qualityPathIndex += 1;
    }
    store<u32>(
      trajectoryInputPointer + TrajectoryLayout.TRAJECTORY_INPUT_QUALITY_X_POINTER_OFFSET,
      qualityCount == 0 ? 0 : qualityXPointer,
    );
    store<u32>(
      trajectoryInputPointer + TrajectoryLayout.TRAJECTORY_INPUT_QUALITY_Y_POINTER_OFFSET,
      qualityCount == 0 ? 0 : qualityYPointer,
    );
    store<u32>(
      trajectoryInputPointer + TrajectoryLayout.TRAJECTORY_INPUT_QUALITY_POINT_COUNT_OFFSET,
      qualityCount,
    );
  }
  store<f64>(
    trajectoryInputPointer + TrajectoryLayout.TRAJECTORY_INPUT_BOUNDS_RECT_X_OFFSET,
    loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_X_INDEX),
  );
  store<f64>(
    trajectoryInputPointer + TrajectoryLayout.TRAJECTORY_INPUT_BOUNDS_RECT_Y_OFFSET,
    loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_Y_INDEX),
  );
  store<f64>(
    trajectoryInputPointer + TrajectoryLayout.TRAJECTORY_INPUT_BOUNDS_RECT_WIDTH_OFFSET,
    loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_WIDTH_INDEX),
  );
  store<f64>(
    trajectoryInputPointer + TrajectoryLayout.TRAJECTORY_INPUT_BOUNDS_RECT_HEIGHT_OFFSET,
    loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_HEIGHT_INDEX),
  );

  const finalCounterPointer = reserveArena(TrajectoryLayout.TRAJECTORY_FINAL_COUNTER_BYTE_LENGTH, sizeof<u32>());
  const trajectoryResultPointer = metadataPointer == 0
    ? runTrajectoryRequest(
        trajectoryInputPointer,
        TrajectoryLayout.TRAJECTORY_INPUT_BYTE_LENGTH,
        finalCounterPointer,
      )
    : runTrajectoryRequestWithMetadata(
        trajectoryInputPointer,
        TrajectoryLayout.TRAJECTORY_INPUT_BYTE_LENGTH,
        finalCounterPointer,
        metadataPointer,
      );
  const launchStatus = load<i32>(
    trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_LAUNCH_STATUS_OFFSET,
  );
  const pointCount = load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_POINT_COUNT_OFFSET);
  const targetHitIndex = load<i32>(
    trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_TARGET_HIT_INDEX_OFFSET,
  );
  const requiredHitIndex = load<i32>(
    trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_REQUIRED_TARGETS_HIT_INDEX_OFFSET,
  );
  const obstacleHitIndex = load<i32>(
    trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_OBSTACLE_HIT_INDEX_OFFSET,
  );
  const reachedOrderedTargetCount = load<u32>(
    trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_REACHED_ORDERED_TARGET_COUNT_OFFSET,
  );
  const reachedRequiredTargetCount = load<u32>(
    trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_REACHED_REQUIRED_TARGET_COUNT_OFFSET,
  );
  let acceptedPointIndex: i32 = -1;
  if (launchStatus == TrajectoryLayout.TRAJECTORY_RESULT_LAUNCH_STATUS_SUCCESS) {
    const lastSafeIndex = obstacleHitIndex >= 0 ? obstacleHitIndex - 1 : <i32>pointCount - 1;
    const completionIndex = NativeMath.max(<f64>targetHitIndex, <f64>requiredHitIndex);
    const hasHitTargets =
      reachedOrderedTargetCount >= orderedTargetCount && reachedRequiredTargetCount >= requiredTargetCount;
    const isTargetCompletionSafe =
      combinedTargetCount == 0 || (completionIndex >= 0 && completionIndex <= <f64>lastSafeIndex);
    if (hasHitTargets && isTargetCompletionSafe) {
      const pointXPointer = load<u32>(
        trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_POINT_X_POINTER_OFFSET,
      );
      let pointIndex = targetHitIndex > 0 ? targetHitIndex : 0;
      while (pointIndex < <i32>pointCount && (obstacleHitIndex < 0 || pointIndex < obstacleHitIndex)) {
        if (load<f64>(pointXPointer + <u32>pointIndex * sizeof<f64>()) >= controlX) {
          acceptedPointIndex = pointIndex;
          break;
        }
        pointIndex += 1;
      }
    }
  }

  const replayResultPointer = reserveArena(Layout.STEP_GLITCH_REPLAY_RESULT_BYTE_LENGTH, sizeof<f64>());
  memory.fill(replayResultPointer, 0, Layout.STEP_GLITCH_REPLAY_RESULT_BYTE_LENGTH);
  store<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_MAGIC_OFFSET, Layout.STEP_GLITCH_REPLAY_RESULT_MAGIC);
  store<u32>(
    replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_STATUS_OFFSET,
    acceptedPointIndex >= 0
      ? Layout.STEP_GLITCH_REPLAY_RESULT_STATUS_HIT
      : Layout.STEP_GLITCH_REPLAY_RESULT_STATUS_MISS,
  );
  store<u32>(
    replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_TRAJECTORY_POINTER_OFFSET,
    trajectoryResultPointer,
  );
  store<i32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_LAUNCH_STATUS_OFFSET, launchStatus);
  store<u32>(
    replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REACHED_ORDERED_COUNT_OFFSET,
    reachedOrderedTargetCount,
  );
  store<u32>(
    replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REACHED_REQUIRED_COUNT_OFFSET,
    reachedRequiredTargetCount,
  );
  store<i32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_STOP_REASON_OFFSET, load<i32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_STOP_REASON_OFFSET));
  store<i32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_TARGET_HIT_INDEX_OFFSET, targetHitIndex);
  store<i32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REQUIRED_HIT_INDEX_OFFSET, requiredHitIndex);
  store<i32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_OBSTACLE_HIT_INDEX_OFFSET, obstacleHitIndex);
  store<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_POINT_COUNT_OFFSET, pointCount);
  store<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_RK4_COUNT_OFFSET, load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_RK4_STEP_COUNT_OFFSET));
  store<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BISECTION_COUNT_OFFSET, load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_BISECTION_COUNT_OFFSET));
  store<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_MIN_STEP_JUMP_COUNT_OFFSET, load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_MIN_STEP_JUMP_COUNT_OFFSET));
  store<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_SAMPLE_COUNT_OFFSET, load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_ACCEPTED_SAMPLE_POINT_COUNT_OFFSET));
  store<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REPLAY_COUNT_OFFSET, load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_REPLAY_COUNT_OFFSET));
  store<u32>(
    replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_FINAL_RK4_COUNT_OFFSET,
    load<u32>(finalCounterPointer + TrajectoryLayout.TRAJECTORY_FINAL_COUNTER_RK4_STEP_COUNT_OFFSET),
  );
  store<u32>(
    replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_FINAL_BISECTION_COUNT_OFFSET,
    load<u32>(finalCounterPointer + TrajectoryLayout.TRAJECTORY_FINAL_COUNTER_BISECTION_COUNT_OFFSET),
  );
  store<u32>(
    replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_FINAL_ACCEPTED_SAMPLE_COUNT_OFFSET,
    load<u32>(finalCounterPointer + TrajectoryLayout.TRAJECTORY_FINAL_COUNTER_ACCEPTED_SAMPLE_COUNT_OFFSET),
  );
  store<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_PROTECTION_POINTER_OFFSET, load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_PROTECTION_POINTER_OFFSET));
  store<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_PROTECTION_COUNT_OFFSET, load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_PROTECTION_COUNT_OFFSET));

  if (launchStatus == TrajectoryLayout.TRAJECTORY_RESULT_LAUNCH_STATUS_SUCCESS) {
    const pointXPointer = load<u32>(
      trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_POINT_X_POINTER_OFFSET,
    );
    const pointYPointer = load<u32>(
      trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_POINT_Y_POINTER_OFFSET,
    );
    if (acceptedPointIndex >= 0) {
      store<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_FLAG_OFFSET, 1);
      store<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_X_OFFSET, load<f64>(pointXPointer + <u32>acceptedPointIndex * sizeof<f64>()));
      store<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_Y_OFFSET, load<f64>(pointYPointer + <u32>acceptedPointIndex * sizeof<f64>()));
    }
    if (obstacleHitIndex >= 0) {
      store<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_FLAG_OFFSET, 1);
      store<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_X_OFFSET, load<f64>(pointXPointer + <u32>obstacleHitIndex * sizeof<f64>()));
      store<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_Y_OFFSET, load<f64>(pointYPointer + <u32>obstacleHitIndex * sizeof<f64>()));
    }
    store<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_CURRENT_X_OFFSET, load<f64>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_CURRENT_X_OFFSET));
    store<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_CURRENT_Y_OFFSET, load<f64>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_CURRENT_Y_OFFSET));
    store<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_CURRENT_DY_OFFSET, load<f64>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_CURRENT_DY_OFFSET));
    store<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_PREVIOUS_X_OFFSET, load<f64>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_PREVIOUS_X_OFFSET));
    store<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_PREVIOUS_Y_OFFSET, load<f64>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_PREVIOUS_Y_OFFSET));
    store<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_PREVIOUS_DY_OFFSET, load<f64>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_PREVIOUS_DY_OFFSET));
    store<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_SAMPLE_INDEX_OFFSET, load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_SAMPLE_INDEX_OFFSET));
    store<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_STATE_FLAGS_OFFSET, load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_STATE_FLAGS_OFFSET));
  }
  if (metadataPointer != 0) {
    store<u32>(
      metadataPointer + TrajectoryLayout.TRAJECTORY_REPLAY_METADATA_TRAJECTORY_RESULT_POINTER_OFFSET,
      trajectoryResultPointer,
    );
  }
  return replayResultPointer;
}

@inline
function checkedProductionEvidenceBytes(count: u32, stride: u32): u32 {
  const byteLength = <u64>count * stride;
  if (byteLength > 0xffff_ffff) trap();
  return <u32>byteLength;
}

@inline
function alignProductionEvidenceOffset(offset: u32, alignment: u32): u32 {
  const aligned = (<u64>offset + alignment - 1) & ~(<u64>alignment - 1);
  if (aligned > 0xffff_ffff) trap();
  return <u32>aligned;
}

@inline
function advanceProductionEvidenceOffset(offset: u32, byteLength: u32, alignment: u32): u32 {
  if (byteLength == 0) return offset;
  const aligned = alignProductionEvidenceOffset(offset, alignment);
  const end = <u64>aligned + byteLength;
  if (end > 0xffff_ffff) trap();
  return <u32>end;
}

function copyProductionEvidenceRange(
  evidencePointer: u32,
  finalSize: u32,
  cursorPointer: u32,
  sourcePointer: u32,
  byteLength: u32,
  alignment: u32,
): u32 {
  if (byteLength == 0) return 0;
  requireArenaRange(sourcePointer, byteLength, alignment);
  let cursor = alignProductionEvidenceOffset(load<u32>(cursorPointer), alignment);
  const pointer = evidencePointer + cursor;
  if (<u64>pointer + byteLength > <u64>evidencePointer + finalSize) trap();
  memory.copy(pointer, sourcePointer, byteLength);
  cursor += byteLength;
  store<u32>(cursorPointer, cursor);
  return pointer;
}

function reserveProductionEvidenceRange(
  evidencePointer: u32,
  finalSize: u32,
  cursorPointer: u32,
  byteLength: u32,
  alignment: u32,
): u32 {
  if (byteLength == 0) return 0;
  const cursor = alignProductionEvidenceOffset(load<u32>(cursorPointer), alignment);
  const pointer = evidencePointer + cursor;
  if (<u64>pointer + byteLength > <u64>evidencePointer + finalSize) trap();
  store<u32>(cursorPointer, cursor + byteLength);
  return pointer;
}

/** Converts refinement NaN placeholders into explicit finite values plus presence bytes. */
function copyProductionOptionalFloat64Range(
  sourcePointer: u32,
  count: u32,
  valuesPointer: u32,
  presencePointer: u32,
): void {
  memory.copy(valuesPointer, sourcePointer, checkedProductionEvidenceBytes(count, sizeof<f64>()));
  let index: u32 = 0;
  while (index < count) {
    const valuePointer = valuesPointer + index * sizeof<f64>();
    const value = load<f64>(valuePointer);
    if (value != value) {
      store<f64>(valuePointer, 0);
      store<u8>(presencePointer + index, 0);
    } else {
      if (!isFiniteValue(value)) trap();
      store<u8>(presencePointer + index, 1);
    }
    index += 1;
  }
}

/** Copies optional point coordinates atomically; X and Y must share one presence state. */
function copyProductionOptionalPointRange(
  sourceXPointer: u32,
  sourceYPointer: u32,
  count: u32,
  valuesXPointer: u32,
  valuesYPointer: u32,
  presencePointer: u32,
): void {
  let index: u32 = 0;
  while (index < count) {
    const sourceX = load<f64>(sourceXPointer + index * sizeof<f64>());
    const sourceY = load<f64>(sourceYPointer + index * sizeof<f64>());
    const isXAbsent = sourceX != sourceX;
    const isYAbsent = sourceY != sourceY;
    if (isXAbsent != isYAbsent) trap();
    if (isXAbsent) {
      store<f64>(valuesXPointer + index * sizeof<f64>(), 0);
      store<f64>(valuesYPointer + index * sizeof<f64>(), 0);
      store<u8>(presencePointer + index, 0);
    } else {
      if (!isFiniteValue(sourceX) || !isFiniteValue(sourceY)) trap();
      store<f64>(valuesXPointer + index * sizeof<f64>(), sourceX);
      store<f64>(valuesYPointer + index * sizeof<f64>(), sourceY);
      store<u8>(presencePointer + index, 1);
    }
    index += 1;
  }
}

/** Independent two-lane byte identity for the selected raw material record. */
function storeSelectedMaterialFingerprint(materialPointer: u32, byteLength: u32, outputPointer: u32): void {
  let first: u32 = 0x811c9dc5;
  let second: u32 = 0x9e3779b9;
  let offset: u32 = 0;
  while (offset < byteLength) {
    const value = <u32>load<u8>(materialPointer + offset);
    first = (first ^ value) * <u32>0x01000193;
    second = (second ^ value) * <u32>0x85ebca6b;
    offset += 1;
  }
  store<u32>(outputPointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_SELECTED_MATERIAL_FINGERPRINT_A_OFFSET, first);
  store<u32>(outputPointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_SELECTED_MATERIAL_FINGERPRINT_B_OFFSET, second);
}

/** Binds all selected continuation value bytes and presence bytes as one evidence atom. */
function storeStepContinuationFingerprint(
  segmentCount: u32,
  segmentStartXPointer: u32,
  segmentStartYPointer: u32,
  segmentStartPresencePointer: u32,
  deltaYPointer: u32,
  deltaYPresencePointer: u32,
  evidencePointer: u32,
  hasContextIdentity: bool,
): void {
  if (!hasContextIdentity) {
    store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_CONTINUATION_FINGERPRINT_OFFSET, 0);
    return;
  }
  let second: u32 = 0x9e3779b9;
  const continuationBytes = checkedProductionEvidenceBytes(segmentCount, sizeof<f64>());
  const presenceBytes = checkedProductionEvidenceBytes(segmentCount, sizeof<u8>());
  let pointer = segmentStartXPointer;
  let byteLength = continuationBytes;
  let range = 0;
  while (range < 5) {
    let offset: u32 = 0;
    while (offset < byteLength) {
      const value = <u32>load<u8>(pointer + offset);
      second = (second ^ value) * <u32>0x85ebca6b;
      offset += 1;
    }
    range += 1;
    if (range == 1) pointer = segmentStartYPointer;
    else if (range == 2) {
      pointer = segmentStartPresencePointer;
      byteLength = presenceBytes;
    } else if (range == 3) {
      pointer = deltaYPointer;
      byteLength = continuationBytes;
    } else if (range == 4) {
      pointer = deltaYPresencePointer;
      byteLength = presenceBytes;
    }
  }
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_CONTINUATION_FINGERPRINT_OFFSET, second);
}

/** Copies one successful replay into a single arena-owned range and rewrites all nested pointers into that range. */
function copyProductionReplayEvidence(
  contextPointer: u32,
  metadataPointer: u32,
  replayResultPointer: u32,
  pathXPointer: u32,
  pathYPointer: u32,
  pathCount: u32,
  finalValidationPointer: u32,
  selectedSourceIndex: u32,
  targetAnchorX: f64,
  targetAnchorY: f64,
): u32 {
  const formulaInputPointer = load<u32>(
    metadataPointer + TrajectoryLayout.TRAJECTORY_REPLAY_METADATA_FORMULA_INPUT_POINTER_OFFSET,
  );
  const launchResultPointer = load<u32>(
    metadataPointer + TrajectoryLayout.TRAJECTORY_REPLAY_METADATA_LAUNCH_RESULT_POINTER_OFFSET,
  );
  const materialResultPointer = load<u32>(
    metadataPointer + TrajectoryLayout.TRAJECTORY_REPLAY_METADATA_MATERIAL_RESULT_POINTER_OFFSET,
  );
  const trajectoryResultPointer = load<u32>(
    metadataPointer + TrajectoryLayout.TRAJECTORY_REPLAY_METADATA_TRAJECTORY_RESULT_POINTER_OFFSET,
  );
  if (formulaInputPointer == 0 || launchResultPointer == 0 || materialResultPointer == 0 || trajectoryResultPointer == 0) {
    trap();
  }
  requireArenaRange(formulaInputPointer, FormulaLayout.FORMULA_INPUT_BYTE_LENGTH, sizeof<u64>());
  requireArenaRange(launchResultPointer, FormulaLayout.FORMULA_LAUNCH_RESULT_BYTE_LENGTH, sizeof<u64>());
  requireArenaRange(materialResultPointer, FormulaLayout.FORMULA_RESULT_BYTE_LENGTH, sizeof<u64>());
  requireArenaRange(trajectoryResultPointer, TrajectoryLayout.TRAJECTORY_RESULT_BYTE_LENGTH, sizeof<u64>());
  requireArenaRange(pathXPointer, checkedProductionEvidenceBytes(pathCount, sizeof<f64>()), sizeof<f64>());
  requireArenaRange(pathYPointer, checkedProductionEvidenceBytes(pathCount, sizeof<f64>()), sizeof<f64>());
  const graphPathXPointer = load<u32>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_POINT_X_POINTER_OFFSET);
  const graphPathYPointer = load<u32>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_POINT_Y_POINTER_OFFSET);
  requireArenaRange(graphPathXPointer, checkedProductionEvidenceBytes(pathCount, sizeof<f64>()), sizeof<f64>());
  requireArenaRange(graphPathYPointer, checkedProductionEvidenceBytes(pathCount, sizeof<f64>()), sizeof<f64>());
  const segmentStartXPointer = load<u32>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_SEGMENT_START_X_POINTER_OFFSET);
  const segmentStartYPointer = load<u32>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_SEGMENT_START_Y_POINTER_OFFSET);
  const deltaYPointer = load<u32>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_STEP_DELTA_Y_POINTER_OFFSET);

  const pointCount = load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_POINT_COUNT_OFFSET);
  const pointXPointer = load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_POINT_X_POINTER_OFFSET);
  const pointYPointer = load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_POINT_Y_POINTER_OFFSET);
  const pointDyPointer = load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_POINT_DY_POINTER_OFFSET);
  const visibleCount = load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_VISIBLE_POINT_COUNT_OFFSET);
  const visibleXPointer = load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_VISIBLE_X_POINTER_OFFSET);
  const visibleYPointer = load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_VISIBLE_Y_POINTER_OFFSET);
  const protectionPointer = load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_PROTECTION_POINTER_OFFSET);
  const protectionCount = load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_PROTECTION_COUNT_OFFSET);
  const formulaPointCount = load<u32>(launchResultPointer + FormulaLayout.FORMULA_LAUNCH_RESULT_FORMULA_POINT_COUNT_OFFSET);
  const formulaPointXPointer = load<u32>(launchResultPointer + FormulaLayout.FORMULA_LAUNCH_RESULT_FORMULA_POINT_X_POINTER_OFFSET);
  const formulaPointYPointer = load<u32>(launchResultPointer + FormulaLayout.FORMULA_LAUNCH_RESULT_FORMULA_POINT_Y_POINTER_OFFSET);
  const materialPointer = load<u32>(materialResultPointer + FormulaLayout.FORMULA_RESULT_MATERIAL_POINTER_OFFSET);
  const materialCount = load<u32>(materialResultPointer + FormulaLayout.FORMULA_RESULT_MATERIAL_COUNT_OFFSET);
  const materialStride = load<u32>(materialResultPointer + FormulaLayout.FORMULA_RESULT_MATERIAL_STRIDE_OFFSET);
  if (materialStride != FormulaLayout.STEP_MATERIAL_BYTE_LENGTH) trap();
  const glitchPointer = load<u32>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_GLITCH_SEGMENT_POINTER_OFFSET);
  let selectedSegmentIndex: u32 = 0;
  let selectedMaterialIndex: u32 = 0;
  let hasSelectedSegment = false;
  // Automatic replay has no fixed-window pointer; retain its source segment identity.
  let materialIndex: u32 = 0;
  while (materialIndex < materialCount) {
    const materialRecord = materialPointer + materialIndex * materialStride;
    if (
      glitchPointer == 0 &&
      load<i32>(materialRecord + FormulaLayout.STEP_MATERIAL_GLITCH_EQUATION_OFFSET) != 0
    ) {
      if (!hasSelectedSegment) {
        selectedSegmentIndex = load<u32>(materialRecord + FormulaLayout.STEP_MATERIAL_SOURCE_SEGMENT_OFFSET);
        selectedMaterialIndex = materialIndex;
        hasSelectedSegment = true;
      }
    }
    materialIndex += 1;
  }
  const maskPointer = load<u32>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_MASK_POINTER_OFFSET);
  const maskByteLength = load<u32>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_MASK_BYTE_LENGTH_OFFSET);
  const overflowPointer = load<u32>(formulaInputPointer + FormulaLayout.FORMULA_INPUT_STEP_OVERFLOW_RANGE_POINTER_OFFSET);
  const segmentCount = pathCount - 1;
  requireArenaRange(segmentStartXPointer, checkedProductionEvidenceBytes(segmentCount, sizeof<f64>()), sizeof<f64>());
  requireArenaRange(segmentStartYPointer, checkedProductionEvidenceBytes(segmentCount, sizeof<f64>()), sizeof<f64>());
  requireArenaRange(deltaYPointer, checkedProductionEvidenceBytes(segmentCount, sizeof<f64>()), sizeof<f64>());
  const continuationPointer = load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_EVIDENCE_POINTER_OFFSET);
  const continuationLength = load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_EVIDENCE_BYTE_LENGTH_OFFSET);
  const trackedHitPointer = load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_TRACKED_TARGET_HIT_INDEX_POINTER_OFFSET);
  const trackedHitCount = load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_TRACKED_TARGET_COUNT_OFFSET);
  if ((continuationPointer == 0) != (continuationLength == 0)) trap();
  if (continuationPointer != 0 && continuationLength != TrajectoryLayout.TRAJECTORY_EVIDENCE_BYTE_LENGTH) trap();
  if ((trackedHitPointer == 0) != (trackedHitCount == 0)) trap();
  requireElementRange(trackedHitPointer, trackedHitCount, sizeof<i32>(), sizeof<i32>());
  const finalValidationLength = finalValidationPointer == 0 ? 0 : Layout.STEP_GLITCH_FINAL_VALIDATION_BYTE_LENGTH;
  let finalValidationTargetCount: u32 = 0;
  let finalValidationTrackedCount: u32 = 0;
  if (finalValidationPointer != 0) {
    requireArenaRange(finalValidationPointer, Layout.STEP_GLITCH_FINAL_VALIDATION_BYTE_LENGTH, sizeof<u32>());
    finalValidationTargetCount = load<u32>(finalValidationPointer + Layout.STEP_GLITCH_FINAL_VALIDATION_TARGET_CONTROL_COUNT_OFFSET);
    finalValidationTrackedCount = load<u32>(finalValidationPointer + Layout.STEP_GLITCH_FINAL_VALIDATION_TRACKED_TARGET_COUNT_OFFSET);
  }
  const formulaInputPathBytes = checkedProductionEvidenceBytes(pathCount, sizeof<f64>());
  const formulaPointBytes = checkedProductionEvidenceBytes(formulaPointCount, sizeof<f64>());
  const trajectoryPointBytes = checkedProductionEvidenceBytes(pointCount, sizeof<f64>());
  const visibleBytes = checkedProductionEvidenceBytes(visibleCount, sizeof<f64>());
  const materialBytes = checkedProductionEvidenceBytes(materialCount, materialStride);
  const protectionBytes = checkedProductionEvidenceBytes(protectionCount, sizeof<u32>());
  const segmentContinuationBytes = checkedProductionEvidenceBytes(segmentCount, sizeof<f64>());
  const segmentPresenceBytes = checkedProductionEvidenceBytes(segmentCount, sizeof<u8>());
  const finalTargetBytes = checkedProductionEvidenceBytes(finalValidationTargetCount, sizeof<f64>());
  const finalTrackedBytes = checkedProductionEvidenceBytes(finalValidationTrackedCount, 3 * sizeof<f64>());
  let finalSize = Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_HEADER_BYTE_LENGTH;
  finalSize = advanceProductionEvidenceOffset(finalSize, formulaInputPathBytes, sizeof<f64>());
  finalSize = advanceProductionEvidenceOffset(finalSize, formulaInputPathBytes, sizeof<f64>());
  finalSize = advanceProductionEvidenceOffset(finalSize, formulaInputPathBytes, sizeof<f64>());
  finalSize = advanceProductionEvidenceOffset(finalSize, formulaInputPathBytes, sizeof<f64>());
  finalSize = advanceProductionEvidenceOffset(finalSize, formulaPointBytes, sizeof<f64>());
  finalSize = advanceProductionEvidenceOffset(finalSize, formulaPointBytes, sizeof<f64>());
  finalSize = advanceProductionEvidenceOffset(finalSize, trajectoryPointBytes, sizeof<f64>());
  finalSize = advanceProductionEvidenceOffset(finalSize, trajectoryPointBytes, sizeof<f64>());
  finalSize = advanceProductionEvidenceOffset(finalSize, trajectoryPointBytes, sizeof<f64>());
  finalSize = advanceProductionEvidenceOffset(finalSize, visibleBytes, sizeof<f64>());
  finalSize = advanceProductionEvidenceOffset(finalSize, visibleBytes, sizeof<f64>());
  finalSize = advanceProductionEvidenceOffset(finalSize, protectionBytes, sizeof<u32>());
  finalSize = advanceProductionEvidenceOffset(finalSize, maskByteLength, 1);
  finalSize = advanceProductionEvidenceOffset(
    finalSize,
    glitchPointer == 0 ? 0 : checkedProductionEvidenceBytes(segmentCount, FormulaLayout.STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH),
    sizeof<f64>(),
  );
  finalSize = advanceProductionEvidenceOffset(
    finalSize,
    overflowPointer == 0 ? 0 : checkedProductionEvidenceBytes(2, sizeof<f64>()),
    sizeof<f64>(),
  );
  finalSize = advanceProductionEvidenceOffset(finalSize, materialBytes, sizeof<u64>());
  finalSize = advanceProductionEvidenceOffset(finalSize, continuationLength, sizeof<u64>());
  const trackedHitBytes = checkedProductionEvidenceBytes(trackedHitCount, sizeof<i32>());
  finalSize = advanceProductionEvidenceOffset(finalSize, trackedHitBytes, sizeof<i32>());
  finalSize = advanceProductionEvidenceOffset(finalSize, finalTargetBytes, sizeof<f64>());
  finalSize = advanceProductionEvidenceOffset(finalSize, finalTargetBytes, sizeof<f64>());
  finalSize = advanceProductionEvidenceOffset(finalSize, finalTrackedBytes, sizeof<f64>());
  finalSize = advanceProductionEvidenceOffset(finalSize, finalValidationLength, sizeof<u32>());
  finalSize = advanceProductionEvidenceOffset(finalSize, FormulaLayout.FORMULA_INPUT_BYTE_LENGTH, sizeof<u64>());
  finalSize = advanceProductionEvidenceOffset(finalSize, FormulaLayout.FORMULA_RESULT_BYTE_LENGTH, sizeof<u64>());
  finalSize = advanceProductionEvidenceOffset(finalSize, FormulaLayout.FORMULA_LAUNCH_RESULT_BYTE_LENGTH, sizeof<u64>());
  finalSize = advanceProductionEvidenceOffset(finalSize, segmentContinuationBytes, sizeof<f64>());
  finalSize = advanceProductionEvidenceOffset(finalSize, segmentContinuationBytes, sizeof<f64>());
  finalSize = advanceProductionEvidenceOffset(finalSize, segmentPresenceBytes, sizeof<u8>());
  finalSize = advanceProductionEvidenceOffset(finalSize, segmentContinuationBytes, sizeof<f64>());
  finalSize = advanceProductionEvidenceOffset(finalSize, segmentPresenceBytes, sizeof<u8>());
  const cursorPointer = reserveArena(sizeof<u32>(), sizeof<u32>());
  const evidencePointer = reserveArena(finalSize, sizeof<u64>());
  memory.fill(evidencePointer, 0, finalSize);
  store<u32>(cursorPointer, Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_HEADER_BYTE_LENGTH);
  const copiedPathXPointer = copyProductionEvidenceRange(evidencePointer, finalSize, cursorPointer, pathXPointer, formulaInputPathBytes, sizeof<f64>());
  const copiedPathYPointer = copyProductionEvidenceRange(evidencePointer, finalSize, cursorPointer, pathYPointer, formulaInputPathBytes, sizeof<f64>());
  const copiedGraphPathXPointer = copyProductionEvidenceRange(evidencePointer, finalSize, cursorPointer, graphPathXPointer, formulaInputPathBytes, sizeof<f64>());
  const copiedGraphPathYPointer = copyProductionEvidenceRange(evidencePointer, finalSize, cursorPointer, graphPathYPointer, formulaInputPathBytes, sizeof<f64>());
  const copiedFormulaPointXPointer = copyProductionEvidenceRange(evidencePointer, finalSize, cursorPointer, formulaPointXPointer, formulaPointBytes, sizeof<f64>());
  const copiedFormulaPointYPointer = copyProductionEvidenceRange(evidencePointer, finalSize, cursorPointer, formulaPointYPointer, formulaPointBytes, sizeof<f64>());
  const copiedPointXPointer = copyProductionEvidenceRange(evidencePointer, finalSize, cursorPointer, pointXPointer, trajectoryPointBytes, sizeof<f64>());
  const copiedPointYPointer = copyProductionEvidenceRange(evidencePointer, finalSize, cursorPointer, pointYPointer, trajectoryPointBytes, sizeof<f64>());
  const copiedPointDyPointer = copyProductionEvidenceRange(evidencePointer, finalSize, cursorPointer, pointDyPointer, trajectoryPointBytes, sizeof<f64>());
  const copiedVisibleXPointer = copyProductionEvidenceRange(evidencePointer, finalSize, cursorPointer, visibleXPointer, visibleBytes, sizeof<f64>());
  const copiedVisibleYPointer = copyProductionEvidenceRange(evidencePointer, finalSize, cursorPointer, visibleYPointer, visibleBytes, sizeof<f64>());
  const copiedProtectionPointer = copyProductionEvidenceRange(evidencePointer, finalSize, cursorPointer, protectionPointer, protectionBytes, sizeof<u32>());
  const copiedMaskPointer = copyProductionEvidenceRange(evidencePointer, finalSize, cursorPointer, maskPointer, maskByteLength, 1);
  const copiedGlitchPointer = glitchPointer == 0
    ? 0
    : copyProductionEvidenceRange(
        evidencePointer,
        finalSize,
        cursorPointer,
        glitchPointer,
        checkedProductionEvidenceBytes(segmentCount, FormulaLayout.STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH),
        sizeof<f64>(),
      );
  const copiedOverflowPointer = overflowPointer == 0
    ? 0
    : copyProductionEvidenceRange(evidencePointer, finalSize, cursorPointer, overflowPointer, checkedProductionEvidenceBytes(2, sizeof<f64>()), sizeof<f64>());
  const copiedMaterialPointer = copyProductionEvidenceRange(evidencePointer, finalSize, cursorPointer, materialPointer, materialBytes, sizeof<u64>());
  if (hasSelectedSegment && hasStepGlitchContextIdentity(contextPointer)) {
    storeSelectedMaterialFingerprint(
      materialPointer + selectedMaterialIndex * materialStride,
      materialStride,
      evidencePointer,
    );
  }
  const copiedContinuationPointer = copyProductionEvidenceRange(evidencePointer, finalSize, cursorPointer, continuationPointer, continuationLength, sizeof<u64>());
  if (copiedContinuationPointer != 0) {
    store<u32>(
      copiedContinuationPointer + TrajectoryLayout.TRAJECTORY_EVIDENCE_PROTECTION_POINTER_OFFSET,
      copiedProtectionPointer,
    );
  }
  const copiedTrackedHitPointer = copyProductionEvidenceRange(
    evidencePointer,
    finalSize,
    cursorPointer,
    trackedHitPointer,
    trackedHitBytes,
    sizeof<i32>(),
  );
  const copiedFinalTargetXPointer = finalValidationPointer == 0
    ? 0
    : copyProductionEvidenceRange(evidencePointer, finalSize, cursorPointer, load<u32>(finalValidationPointer + Layout.STEP_GLITCH_FINAL_VALIDATION_TARGET_CONTROL_X_POINTER_OFFSET), finalTargetBytes, sizeof<f64>());
  const copiedFinalTargetYPointer = finalValidationPointer == 0
    ? 0
    : copyProductionEvidenceRange(evidencePointer, finalSize, cursorPointer, load<u32>(finalValidationPointer + Layout.STEP_GLITCH_FINAL_VALIDATION_TARGET_CONTROL_Y_POINTER_OFFSET), finalTargetBytes, sizeof<f64>());
  const copiedFinalTrackedPointer = finalValidationPointer == 0
    ? 0
    : copyProductionEvidenceRange(evidencePointer, finalSize, cursorPointer, load<u32>(finalValidationPointer + Layout.STEP_GLITCH_FINAL_VALIDATION_TRACKED_TARGET_POINTER_OFFSET), finalTrackedBytes, sizeof<f64>());
  const copiedFinalValidationPointer = finalValidationPointer == 0
    ? 0
    : copyProductionEvidenceRange(evidencePointer, finalSize, cursorPointer, finalValidationPointer, finalValidationLength, sizeof<u32>());
  if (copiedFinalValidationPointer != 0) {
    store<u32>(copiedFinalValidationPointer + Layout.STEP_GLITCH_FINAL_VALIDATION_TARGET_CONTROL_X_POINTER_OFFSET, copiedFinalTargetXPointer);
    store<u32>(copiedFinalValidationPointer + Layout.STEP_GLITCH_FINAL_VALIDATION_TARGET_CONTROL_Y_POINTER_OFFSET, copiedFinalTargetYPointer);
    store<u32>(copiedFinalValidationPointer + Layout.STEP_GLITCH_FINAL_VALIDATION_TRACKED_TARGET_POINTER_OFFSET, copiedFinalTrackedPointer);
  }
  const copiedFormulaInputPointer = copyProductionEvidenceRange(evidencePointer, finalSize, cursorPointer, formulaInputPointer, FormulaLayout.FORMULA_INPUT_BYTE_LENGTH, sizeof<u64>());
  store<u32>(copiedFormulaInputPointer + FormulaLayout.FORMULA_INPUT_POINT_X_POINTER_OFFSET, copiedGraphPathXPointer);
  store<u32>(copiedFormulaInputPointer + FormulaLayout.FORMULA_INPUT_POINT_Y_POINTER_OFFSET, copiedGraphPathYPointer);
  store<u32>(copiedFormulaInputPointer + FormulaLayout.FORMULA_INPUT_SIGN_PROTECTION_POINTER_OFFSET, copiedProtectionPointer);
  store<u32>(copiedFormulaInputPointer + FormulaLayout.FORMULA_INPUT_MASK_POINTER_OFFSET, copiedMaskPointer);
  store<u32>(copiedFormulaInputPointer + FormulaLayout.FORMULA_INPUT_GLITCH_SEGMENT_POINTER_OFFSET, copiedGlitchPointer);
  store<u32>(copiedFormulaInputPointer + FormulaLayout.FORMULA_INPUT_STEP_OVERFLOW_RANGE_POINTER_OFFSET, copiedOverflowPointer);
  const copiedMaterialResultPointer = copyProductionEvidenceRange(evidencePointer, finalSize, cursorPointer, materialResultPointer, FormulaLayout.FORMULA_RESULT_BYTE_LENGTH, sizeof<u64>());
  store<u32>(copiedMaterialResultPointer + FormulaLayout.FORMULA_RESULT_MATERIAL_POINTER_OFFSET, copiedMaterialPointer);
  store<u32>(copiedMaterialResultPointer + FormulaLayout.FORMULA_RESULT_PROTECTION_POINTER_OFFSET, copiedProtectionPointer);
  const copiedLaunchResultPointer = copyProductionEvidenceRange(evidencePointer, finalSize, cursorPointer, launchResultPointer, FormulaLayout.FORMULA_LAUNCH_RESULT_BYTE_LENGTH, sizeof<u64>());
  store<u32>(copiedLaunchResultPointer + FormulaLayout.FORMULA_LAUNCH_RESULT_MATERIAL_RESULT_POINTER_OFFSET, copiedMaterialResultPointer);
  store<u32>(copiedLaunchResultPointer + FormulaLayout.FORMULA_LAUNCH_RESULT_PROTECTION_POINTER_OFFSET, copiedProtectionPointer);
  store<u32>(copiedLaunchResultPointer + FormulaLayout.FORMULA_LAUNCH_RESULT_FORMULA_POINT_X_POINTER_OFFSET, copiedFormulaPointXPointer);
  store<u32>(copiedLaunchResultPointer + FormulaLayout.FORMULA_LAUNCH_RESULT_FORMULA_POINT_Y_POINTER_OFFSET, copiedFormulaPointYPointer);
  const copiedSegmentStartXPointer = reserveProductionEvidenceRange(
    evidencePointer,
    finalSize,
    cursorPointer,
    segmentContinuationBytes,
    sizeof<f64>(),
  );
  const copiedSegmentStartYPointer = reserveProductionEvidenceRange(
    evidencePointer,
    finalSize,
    cursorPointer,
    segmentContinuationBytes,
    sizeof<f64>(),
  );
  const copiedSegmentStartPresencePointer = reserveProductionEvidenceRange(
    evidencePointer,
    finalSize,
    cursorPointer,
    segmentPresenceBytes,
    sizeof<u8>(),
  );
  const copiedDeltaYPointer = reserveProductionEvidenceRange(
    evidencePointer,
    finalSize,
    cursorPointer,
    segmentContinuationBytes,
    sizeof<f64>(),
  );
  const copiedDeltaYPresencePointer = reserveProductionEvidenceRange(
    evidencePointer,
    finalSize,
    cursorPointer,
    segmentPresenceBytes,
    sizeof<u8>(),
  );
  copyProductionOptionalPointRange(
    segmentStartXPointer,
    segmentStartYPointer,
    segmentCount,
    copiedSegmentStartXPointer,
    copiedSegmentStartYPointer,
    copiedSegmentStartPresencePointer,
  );
  copyProductionOptionalFloat64Range(
    deltaYPointer,
    segmentCount,
    copiedDeltaYPointer,
    copiedDeltaYPresencePointer,
  );
  const hasContextIdentity = hasStepGlitchContextIdentity(contextPointer);
  storeStepContinuationFingerprint(
    segmentCount,
    copiedSegmentStartXPointer,
    copiedSegmentStartYPointer,
    copiedSegmentStartPresencePointer,
    copiedDeltaYPointer,
    copiedDeltaYPresencePointer,
    evidencePointer,
    hasSelectedSegment && hasContextIdentity,
  );
  store<u32>(copiedFormulaInputPointer + FormulaLayout.FORMULA_INPUT_SEGMENT_START_X_POINTER_OFFSET, copiedSegmentStartXPointer);
  store<u32>(copiedFormulaInputPointer + FormulaLayout.FORMULA_INPUT_SEGMENT_START_Y_POINTER_OFFSET, copiedSegmentStartYPointer);
  store<u32>(copiedFormulaInputPointer + FormulaLayout.FORMULA_INPUT_STEP_DELTA_Y_POINTER_OFFSET, copiedDeltaYPointer);
  const flags =
    (finalValidationPointer == 0 ? 0 : Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_FLAG_FINAL_VALIDATION) |
    (hasSelectedSegment ? Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_FLAG_SELECTED_SEGMENT : 0) |
    (hasSelectedSegment && hasContextIdentity
      ? Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_FLAG_SELECTED_CONTINUATION
      : 0);
  if (hasSelectedSegment && hasContextIdentity) {
    if (selectedSourceIndex == u32.MAX_VALUE || !isFiniteValue(targetAnchorX) || !isFiniteValue(targetAnchorY)) trap();
  }
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_MAGIC_OFFSET, Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_MAGIC);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_VERSION_OFFSET, Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_VERSION);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_FLAGS_OFFSET, flags);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_PATH_X_POINTER_OFFSET, copiedPathXPointer);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_PATH_Y_POINTER_OFFSET, copiedPathYPointer);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_PATH_COUNT_OFFSET, pathCount);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_POINT_X_POINTER_OFFSET, copiedPointXPointer);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_POINT_Y_POINTER_OFFSET, copiedPointYPointer);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_POINT_DY_POINTER_OFFSET, copiedPointDyPointer);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_POINT_COUNT_OFFSET, pointCount);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_VISIBLE_X_POINTER_OFFSET, copiedVisibleXPointer);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_VISIBLE_Y_POINTER_OFFSET, copiedVisibleYPointer);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_VISIBLE_COUNT_OFFSET, visibleCount);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_PROTECTION_POINTER_OFFSET, copiedProtectionPointer);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_PROTECTION_COUNT_OFFSET, protectionCount);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_FORMULA_INPUT_POINTER_OFFSET, copiedFormulaInputPointer);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_FORMULA_INPUT_BYTE_LENGTH_OFFSET, FormulaLayout.FORMULA_INPUT_BYTE_LENGTH);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_LAUNCH_RESULT_POINTER_OFFSET, copiedLaunchResultPointer);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_LAUNCH_RESULT_BYTE_LENGTH_OFFSET, FormulaLayout.FORMULA_LAUNCH_RESULT_BYTE_LENGTH);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_MATERIAL_RESULT_POINTER_OFFSET, copiedMaterialResultPointer);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_MATERIAL_RESULT_BYTE_LENGTH_OFFSET, FormulaLayout.FORMULA_RESULT_BYTE_LENGTH);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_MATERIAL_POINTER_OFFSET, copiedMaterialPointer);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_MATERIAL_COUNT_OFFSET, materialCount);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_MATERIAL_STRIDE_OFFSET, materialStride);
  memory.copy(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_ACCEPTED_X_OFFSET,
    replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_X_OFFSET,
    32,
  );
  memory.copy(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_STOP_REASON_OFFSET,
    replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_STOP_REASON_OFFSET,
    4 * sizeof<i32>(),
  );
  memory.copy(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_REACHED_ORDERED_COUNT_OFFSET,
    replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REACHED_ORDERED_COUNT_OFFSET,
    2 * sizeof<u32>(),
  );
  memory.copy(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_RK4_COUNT_OFFSET,
    replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_RK4_COUNT_OFFSET,
    5 * sizeof<u32>(),
  );
  memory.copy(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_FINAL_RK4_COUNT_OFFSET,
    replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_FINAL_RK4_COUNT_OFFSET,
    3 * sizeof<u32>(),
  );
  memory.copy(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_CURRENT_X_OFFSET,
    replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_CURRENT_X_OFFSET,
    6 * sizeof<f64>(),
  );
  memory.copy(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_SAMPLE_INDEX_OFFSET,
    replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_SAMPLE_INDEX_OFFSET,
    2 * sizeof<u32>(),
  );
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_FINAL_VALIDATION_POINTER_OFFSET, copiedFinalValidationPointer);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_FINAL_VALIDATION_BYTE_LENGTH_OFFSET, finalValidationLength);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_FORMULA_POINT_X_POINTER_OFFSET, copiedFormulaPointXPointer);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_FORMULA_POINT_Y_POINTER_OFFSET, copiedFormulaPointYPointer);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_FORMULA_POINT_COUNT_OFFSET, formulaPointCount);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_TRAJECTORY_CONTINUATION_POINTER_OFFSET, copiedContinuationPointer);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_TRAJECTORY_CONTINUATION_BYTE_LENGTH_OFFSET, continuationLength);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_TRACKED_HIT_POINTER_OFFSET, copiedTrackedHitPointer);
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_TRACKED_HIT_COUNT_OFFSET, trackedHitCount);
  store<u32>(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_TRAJECTORY_RESULT_FLAGS_OFFSET,
    load<u32>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_FLAGS_OFFSET),
  );
  store<f64>(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_PATH_ERROR_OFFSET,
    load<f64>(trajectoryResultPointer + TrajectoryLayout.TRAJECTORY_RESULT_PATH_ERROR_OFFSET),
  );
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_BYTE_LENGTH_OFFSET, load<u32>(cursorPointer));
  store<u32>(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_SELECTED_SEGMENT_INDEX_OFFSET,
    selectedSegmentIndex,
  );
  store<u32>(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_SEGMENT_START_X_POINTER_OFFSET,
    copiedSegmentStartXPointer,
  );
  store<u32>(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_SEGMENT_START_Y_POINTER_OFFSET,
    copiedSegmentStartYPointer,
  );
  store<u32>(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_SEGMENT_START_PRESENCE_POINTER_OFFSET,
    copiedSegmentStartPresencePointer,
  );
  store<u32>(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_DELTA_Y_POINTER_OFFSET,
    copiedDeltaYPointer,
  );
  store<u32>(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_DELTA_Y_PRESENCE_POINTER_OFFSET,
    copiedDeltaYPresencePointer,
  );
  store<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_SEGMENT_COUNT_OFFSET, segmentCount);
  store<u32>(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_SELECTED_SOURCE_INDEX_OFFSET,
    hasSelectedSegment && hasContextIdentity ? selectedSourceIndex : 0,
  );
  store<u32>(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_SELECTED_MATERIAL_INDEX_OFFSET,
    hasSelectedSegment && hasContextIdentity ? selectedMaterialIndex : 0,
  );
  store<u32>(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_SELECTED_MATERIAL_POINTER_OFFSET,
    hasSelectedSegment && hasContextIdentity
      ? copiedMaterialPointer + selectedMaterialIndex * materialStride
      : 0,
  );
  store<u32>(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_SELECTED_MATERIAL_BYTE_LENGTH_OFFSET,
    hasSelectedSegment && hasContextIdentity ? materialStride : 0,
  );
  store<f64>(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_TARGET_ANCHOR_X_OFFSET,
    hasSelectedSegment && hasContextIdentity ? targetAnchorX : 0,
  );
  store<f64>(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_TARGET_ANCHOR_Y_OFFSET,
    hasSelectedSegment && hasContextIdentity ? targetAnchorY : 0,
  );
  store<u32>(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_OUTER_TASK_ID_OFFSET,
    hasSelectedSegment && hasContextIdentity
      ? load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_OUTER_TASK_ID_OFFSET)
      : 0,
  );
  store<u32>(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_REQUEST_ID_OFFSET,
    hasSelectedSegment && hasContextIdentity
      ? load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_REQUEST_ID_OFFSET)
      : 0,
  );
  store<u32>(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_ATTEMPT_ID_OFFSET,
    hasSelectedSegment && hasContextIdentity
      ? load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_ATTEMPT_ID_OFFSET)
      : 0,
  );
  store<u32>(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_BACKEND_GENERATION_OFFSET,
    hasSelectedSegment && hasContextIdentity
      ? load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_BACKEND_GENERATION_OFFSET)
      : 0,
  );
  store<u32>(
    evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_SESSION_NONCE_OFFSET,
    hasSelectedSegment && hasContextIdentity
      ? load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SESSION_NONCE_OFFSET)
      : 0,
  );
  return evidencePointer;
}

function validateProductionFinalValidation(pointer: u32, byteLength: u32): u32 {
  if (pointer == 0 || byteLength == 0) {
    if (pointer != 0 || byteLength != 0) trap();
    return 0;
  }
  if (byteLength != Layout.STEP_GLITCH_FINAL_VALIDATION_BYTE_LENGTH) trap();
  requireArenaRange(pointer, byteLength, sizeof<u32>());
  const flags = load<u32>(pointer + Layout.STEP_GLITCH_FINAL_VALIDATION_FLAGS_OFFSET);
  if (
    flags != Layout.STEP_GLITCH_FINAL_VALIDATION_FLAG_PRESENT ||
    load<u32>(pointer + Layout.STEP_GLITCH_FINAL_VALIDATION_RESERVED_OFFSET) != 0
  ) trap();
  const targetCount = load<u32>(pointer + Layout.STEP_GLITCH_FINAL_VALIDATION_TARGET_CONTROL_COUNT_OFFSET);
  const trackedCount = load<u32>(pointer + Layout.STEP_GLITCH_FINAL_VALIDATION_TRACKED_TARGET_COUNT_OFFSET);
  requireElementRange(
    load<u32>(pointer + Layout.STEP_GLITCH_FINAL_VALIDATION_TARGET_CONTROL_X_POINTER_OFFSET),
    targetCount,
    sizeof<f64>(),
    sizeof<f64>(),
  );
  requireElementRange(
    load<u32>(pointer + Layout.STEP_GLITCH_FINAL_VALIDATION_TARGET_CONTROL_Y_POINTER_OFFSET),
    targetCount,
    sizeof<f64>(),
    sizeof<f64>(),
  );
  validateStepGlitchTargetRecords(
    load<u32>(pointer + Layout.STEP_GLITCH_FINAL_VALIDATION_TRACKED_TARGET_POINTER_OFFSET),
    trackedCount,
  );
  return pointer;
}

function createProductionResult(
  status: u32,
  evidencePointer: u32,
  evidenceByteLength: u32,
  expandedStates: u32,
  reachedTargetCount: u32,
  hasAcceptedPoint: u32,
  acceptedX: f64,
  acceptedY: f64,
  hasBlockedPoint: u32,
  blockedX: f64,
  blockedY: f64,
): u32 {
  const resultPointer = reserveArena(Layout.STEP_GLITCH_PRODUCTION_RESULT_BYTE_LENGTH, sizeof<u64>());
  memory.fill(resultPointer, 0, Layout.STEP_GLITCH_PRODUCTION_RESULT_BYTE_LENGTH);
  store<u32>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_MAGIC_OFFSET, Layout.STEP_GLITCH_PRODUCTION_RESULT_MAGIC);
  store<u32>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_STATUS_OFFSET, status);
  store<u32>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_EVIDENCE_POINTER_OFFSET, evidencePointer);
  store<u32>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_EVIDENCE_BYTE_LENGTH_OFFSET, evidenceByteLength);
  store<u32>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_EXPANDED_STATES_OFFSET, expandedStates);
  store<u32>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_REACHED_TARGET_COUNT_OFFSET, reachedTargetCount);
  store<u32>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_ACCEPTED_FLAG_OFFSET, hasAcceptedPoint);
  store<u32>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_BLOCKED_FLAG_OFFSET, hasBlockedPoint);
  store<f64>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_ACCEPTED_X_OFFSET, hasAcceptedPoint == 0 ? 0 : acceptedX);
  store<f64>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_ACCEPTED_Y_OFFSET, hasAcceptedPoint == 0 ? 0 : acceptedY);
  store<f64>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_BLOCKED_X_OFFSET, hasBlockedPoint == 0 ? 0 : blockedX);
  store<f64>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_BLOCKED_Y_OFFSET, hasBlockedPoint == 0 ? 0 : blockedY);
  return resultPointer;
}

/** Session result extends the common production header with accepted target provenance. */
function createOneClickSessionResult(
  status: u32,
  evidencePointer: u32,
  evidenceByteLength: u32,
  expandedStates: u32,
  reachedTargetCount: u32,
  hasAcceptedPoint: u32,
  acceptedX: f64,
  acceptedY: f64,
  hasBlockedPoint: u32,
  blockedX: f64,
  blockedY: f64,
  acceptedIndexPointer: u32,
  acceptedIndexCount: u32,
  finalTargetIndex: u32,
  finalSourceCount: u32,
): u32 {
  const resultPointer = reserveArena(Layout.STEP_GLITCH_SESSION_RESULT_BYTE_LENGTH, sizeof<u64>());
  memory.fill(resultPointer, 0, Layout.STEP_GLITCH_SESSION_RESULT_BYTE_LENGTH);
  store<u32>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_MAGIC_OFFSET, Layout.STEP_GLITCH_PRODUCTION_RESULT_MAGIC);
  store<u32>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_STATUS_OFFSET, status);
  store<u32>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_EVIDENCE_POINTER_OFFSET, evidencePointer);
  store<u32>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_EVIDENCE_BYTE_LENGTH_OFFSET, evidenceByteLength);
  store<u32>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_EXPANDED_STATES_OFFSET, expandedStates);
  store<u32>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_REACHED_TARGET_COUNT_OFFSET, reachedTargetCount);
  store<u32>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_ACCEPTED_FLAG_OFFSET, hasAcceptedPoint);
  store<u32>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_BLOCKED_FLAG_OFFSET, hasBlockedPoint);
  store<f64>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_ACCEPTED_X_OFFSET, hasAcceptedPoint == 0 ? 0 : acceptedX);
  store<f64>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_ACCEPTED_Y_OFFSET, hasAcceptedPoint == 0 ? 0 : acceptedY);
  store<f64>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_BLOCKED_X_OFFSET, hasBlockedPoint == 0 ? 0 : blockedX);
  store<f64>(resultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_BLOCKED_Y_OFFSET, hasBlockedPoint == 0 ? 0 : blockedY);
  store<u32>(
    resultPointer + Layout.STEP_GLITCH_SESSION_RESULT_ACCEPTED_INDEX_POINTER_OFFSET,
    acceptedIndexCount == 0 ? 0 : acceptedIndexPointer,
  );
  store<u32>(resultPointer + Layout.STEP_GLITCH_SESSION_RESULT_ACCEPTED_INDEX_COUNT_OFFSET, acceptedIndexCount);
  store<u32>(resultPointer + Layout.STEP_GLITCH_SESSION_RESULT_FINAL_TARGET_INDEX_OFFSET, finalTargetIndex);
  store<u32>(resultPointer + Layout.STEP_GLITCH_SESSION_RESULT_FINAL_SOURCE_COUNT_OFFSET, finalSourceCount);
  return resultPointer;
}

function isProductionTargetRequired(contextPointer: u32, targetValuesPointer: u32): bool {
  const requiredPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_REQUIRED_TARGET_POINTER_OFFSET);
  const requiredValueCount = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_REQUIRED_TARGET_LENGTH_OFFSET);
  let targetIndex: u32 = 0;
  while (targetIndex < requiredValueCount / 3) {
    const requiredRecord = requiredPointer + targetIndex * 3 * sizeof<f64>();
    if (
      load<f64>(requiredRecord) == load<f64>(targetValuesPointer) &&
      load<f64>(requiredRecord + sizeof<f64>()) == load<f64>(targetValuesPointer + sizeof<f64>()) &&
      load<f64>(requiredRecord + 2 * sizeof<f64>()) == load<f64>(targetValuesPointer + 2 * sizeof<f64>())
    ) return true;
    targetIndex += 1;
  }
  return false;
}

/** Production scan keeps DFS, candidate ordering and numerical replay in the same WASM call. */
export function scanStepGlitch(inputPointer: u32, inputByteLength: u32): u32 {
  if (
    inputByteLength != Layout.STEP_GLITCH_SCAN_INPUT_BYTE_LENGTH &&
    inputByteLength != Layout.STEP_GLITCH_SCAN_INPUT_LEGACY_BYTE_LENGTH
  ) trap();
  requireArenaRange(inputPointer, inputByteLength, sizeof<u32>());
  const contextPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_SCAN_INPUT_CONTEXT_POINTER_OFFSET);
  requireStepGlitchContext(contextPointer);
  if (load<u32>(inputPointer + Layout.STEP_GLITCH_SCAN_INPUT_RESERVED_OFFSET) != 0) trap();
  const targetValuesPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_SCAN_INPUT_TARGET_VALUES_POINTER_OFFSET);
  const targetValuesLength = load<u32>(inputPointer + Layout.STEP_GLITCH_SCAN_INPUT_TARGET_VALUES_LENGTH_OFFSET);
  const sourceIndex = inputByteLength == Layout.STEP_GLITCH_SCAN_INPUT_BYTE_LENGTH
    ? load<u32>(inputPointer + Layout.STEP_GLITCH_SCAN_INPUT_SOURCE_INDEX_OFFSET)
    : u32.MAX_VALUE;
  if (targetValuesLength != Layout.STEP_GLITCH_REAL_DFS_INPUT_TARGET_VALUE_COUNT) trap();
  requireElementRange(targetValuesPointer, targetValuesLength, sizeof<f64>(), sizeof<f64>());
  let targetValueIndex: u32 = 0;
  while (targetValueIndex < targetValuesLength) {
    if (!isFiniteValue(load<f64>(targetValuesPointer + targetValueIndex * sizeof<f64>()))) trap();
    targetValueIndex += 1;
  }
  if (load<f64>(targetValuesPointer + 2 * sizeof<f64>()) < 0) {
    return createProductionResult(Layout.STEP_GLITCH_PRODUCTION_STATUS_INVALID_INPUT, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
  const finalValidationPointer = validateProductionFinalValidation(
    load<u32>(inputPointer + Layout.STEP_GLITCH_SCAN_INPUT_FINAL_VALIDATION_POINTER_OFFSET),
    load<u32>(inputPointer + Layout.STEP_GLITCH_SCAN_INPUT_FINAL_VALIDATION_BYTE_LENGTH_OFFSET),
  );
  const dfsInputPointer = reserveArena(Layout.STEP_GLITCH_REAL_DFS_INPUT_BYTE_LENGTH, sizeof<f64>());
  memory.fill(dfsInputPointer, 0, Layout.STEP_GLITCH_REAL_DFS_INPUT_BYTE_LENGTH);
  store<u32>(dfsInputPointer + Layout.STEP_GLITCH_REAL_DFS_INPUT_CONTEXT_POINTER_OFFSET, contextPointer);
  store<u32>(dfsInputPointer + Layout.STEP_GLITCH_REAL_DFS_INPUT_TARGET_VALUES_POINTER_OFFSET, targetValuesPointer);
  store<u32>(dfsInputPointer + Layout.STEP_GLITCH_REAL_DFS_INPUT_TARGET_VALUES_LENGTH_OFFSET, targetValuesLength);
  const traceResultPointer = traceStepGlitchRealDfsForTest(
    dfsInputPointer,
    Layout.STEP_GLITCH_REAL_DFS_INPUT_BYTE_LENGTH,
  );
  const traceStatus = load<u32>(traceResultPointer + Layout.STEP_GLITCH_REAL_DFS_RESULT_STATUS_OFFSET);
  const expandedStates = load<u32>(traceResultPointer + Layout.STEP_GLITCH_REAL_DFS_RESULT_EXPANDED_STATES_OFFSET);
  const bestReachedCount = load<u32>(traceResultPointer + Layout.STEP_GLITCH_REAL_DFS_RESULT_BEST_REACHED_COUNT_OFFSET);
  const traceCount = load<u32>(traceResultPointer + Layout.STEP_GLITCH_REAL_DFS_RESULT_TRACE_COUNT_OFFSET);
  const tracePointer = load<u32>(traceResultPointer + Layout.STEP_GLITCH_REAL_DFS_RESULT_TRACE_POINTER_OFFSET);
  if (traceStatus != Layout.STEP_GLITCH_REAL_DFS_RESULT_HIT || traceCount == 0) {
    return createProductionResult(Layout.STEP_GLITCH_PRODUCTION_STATUS_MISS, 0, 0, expandedStates, bestReachedCount, 0, 0, 0, 0, 0, 0);
  }
  let winnerPointer: u32 = 0;
  let traceIndex: u32 = 0;
  while (traceIndex < traceCount) {
    const candidatePointer = tracePointer + traceIndex * Layout.STEP_GLITCH_REAL_DFS_TRACE_BYTE_LENGTH;
    if (
      load<u32>(candidatePointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_STATUS_OFFSET) == Layout.STEP_GLITCH_REPLAY_RESULT_STATUS_HIT &&
      load<u32>(candidatePointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_ACCEPTED_FLAG_OFFSET) != 0
    ) winnerPointer = candidatePointer;
    traceIndex += 1;
  }
  if (winnerPointer == 0) {
    return createProductionResult(Layout.STEP_GLITCH_PRODUCTION_STATUS_MISS, 0, 0, expandedStates, bestReachedCount, 0, 0, 0, 0, 0, 0);
  }
  const metadataPointer = reserveArena(TrajectoryLayout.TRAJECTORY_REPLAY_METADATA_BYTE_LENGTH, sizeof<u32>());
  const pathXPointer = load<u32>(winnerPointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_PATH_X_POINTER_OFFSET);
  const pathYPointer = load<u32>(winnerPointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_PATH_Y_POINTER_OFFSET);
  const pathCount = load<u32>(winnerPointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_PATH_COUNT_OFFSET);
  const windowPointer = load<u32>(winnerPointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_WINDOW_POINTER_OFFSET);
  const windowCount = load<u32>(winnerPointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_WINDOW_COUNT_OFFSET);
  const windowMode = load<u32>(winnerPointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_WINDOW_MODE_OFFSET);
  const targetRecordPointer = isProductionTargetRequired(contextPointer, targetValuesPointer) ? 0 : targetValuesPointer;
  const orderedTargetCount = targetRecordPointer == 0 ? 0 : 1;
  const replayResultPointer = replayStepGlitchCandidateWithMetadata(
    contextPointer,
    pathXPointer,
    pathYPointer,
    pathCount,
    windowPointer,
    windowCount,
    windowMode,
    targetRecordPointer,
    orderedTargetCount,
    load<f64>(winnerPointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_CONTROL_X_OFFSET),
    metadataPointer,
    finalValidationPointer,
  );
  if (
    load<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_STATUS_OFFSET) !=
    Layout.STEP_GLITCH_REPLAY_RESULT_STATUS_HIT
  ) {
    return createProductionResult(
      Layout.STEP_GLITCH_PRODUCTION_STATUS_MISS,
      0,
      0,
      expandedStates,
      load<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REACHED_ORDERED_COUNT_OFFSET) +
        load<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REACHED_REQUIRED_COUNT_OFFSET),
      load<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_FLAG_OFFSET),
      load<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_X_OFFSET),
      load<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_Y_OFFSET),
      load<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_FLAG_OFFSET),
      load<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_X_OFFSET),
      load<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_Y_OFFSET),
    );
  }
  const evidencePointer = copyProductionReplayEvidence(
    contextPointer,
    metadataPointer,
    replayResultPointer,
    pathXPointer,
    pathYPointer,
    pathCount,
    finalValidationPointer,
    sourceIndex,
    load<f64>(targetValuesPointer + 3 * sizeof<f64>()),
    load<f64>(targetValuesPointer + 4 * sizeof<f64>()),
  );
  return createProductionResult(
    Layout.STEP_GLITCH_PRODUCTION_STATUS_HIT,
    evidencePointer,
    load<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_BYTE_LENGTH_OFFSET),
    expandedStates,
    load<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REACHED_ORDERED_COUNT_OFFSET) +
      load<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REACHED_REQUIRED_COUNT_OFFSET),
    load<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_FLAG_OFFSET),
    load<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_X_OFFSET),
    load<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_Y_OFFSET),
    load<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_FLAG_OFFSET),
    load<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_X_OFFSET),
    load<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_Y_OFFSET),
  );
}

/**
 * Owns one-click Step-glitch target traversal. Each layer reuses command 18's
 * DFS/replay path through a short-lived context record; no JS callback or
 * second numerical implementation crosses this boundary.
 */
export function composeStepGlitchOneClickSession(inputPointer: u32, inputByteLength: u32): u32 {
  if (inputByteLength != Layout.STEP_GLITCH_SESSION_INPUT_BYTE_LENGTH) trap();
  requireArenaRange(inputPointer, inputByteLength, sizeof<u32>());
  const baseContextPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_SESSION_CONTEXT_POINTER_OFFSET);
  requireStepGlitchContext(baseContextPointer);
  if (load<u32>(inputPointer + Layout.STEP_GLITCH_SESSION_RESERVED_OFFSET) != 0) trap();

  const targetRecordPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_SESSION_TARGET_RECORD_POINTER_OFFSET);
  const targetPointXPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_SESSION_TARGET_POINT_X_POINTER_OFFSET);
  const targetPointYPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_SESSION_TARGET_POINT_Y_POINTER_OFFSET);
  const targetGraphXPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_SESSION_TARGET_GRAPH_X_POINTER_OFFSET);
  const targetSourceIndexPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_SESSION_TARGET_SOURCE_INDEX_POINTER_OFFSET);
  const targetCount = load<u32>(inputPointer + Layout.STEP_GLITCH_SESSION_TARGET_COUNT_OFFSET);
  if (targetCount == 0 || targetCount > u32.MAX_VALUE / sizeof<u32>()) trap();
  validateStepGlitchTargetRecords(targetRecordPointer, targetCount);
  requireElementRange(targetPointXPointer, targetCount, sizeof<f64>(), sizeof<f64>());
  requireElementRange(targetPointYPointer, targetCount, sizeof<f64>(), sizeof<f64>());
  requireElementRange(targetGraphXPointer, targetCount, sizeof<f64>(), sizeof<f64>());
  requireElementRange(targetSourceIndexPointer, targetCount, sizeof<u32>(), sizeof<u32>());
  const finalValidationPointer = validateProductionFinalValidation(
    load<u32>(inputPointer + Layout.STEP_GLITCH_SESSION_FINAL_VALIDATION_POINTER_OFFSET),
    load<u32>(inputPointer + Layout.STEP_GLITCH_SESSION_FINAL_VALIDATION_BYTE_LENGTH_OFFSET),
  );

  const baseValuesPointer = load<u32>(baseContextPointer + Layout.STEP_GLITCH_CONTEXT_VALUES_POINTER_OFFSET);
  const baseRequiredPointer = load<u32>(baseContextPointer + Layout.STEP_GLITCH_CONTEXT_REQUIRED_TARGET_POINTER_OFFSET);
  const baseRequiredValueCount = load<u32>(baseContextPointer + Layout.STEP_GLITCH_CONTEXT_REQUIRED_TARGET_LENGTH_OFFSET);
  const basePrefixEvidencePointer = load<u32>(baseContextPointer + Layout.STEP_GLITCH_CONTEXT_PREFIX_EVIDENCE_POINTER_OFFSET);
  const basePrefixEvidenceByteLength = load<u32>(baseContextPointer + Layout.STEP_GLITCH_CONTEXT_PREFIX_EVIDENCE_BYTE_LENGTH_OFFSET);
  if (baseRequiredValueCount % 3 != 0) trap();
  validateStepGlitchTargetRecords(baseRequiredPointer, baseRequiredValueCount / 3);

  // Values hold prefix target identity. Clone once so a session never mutates
  // the Adapter-owned context record while advancing accepted layers.
  const valuesPointer = reserveArena(Layout.STEP_GLITCH_CONTEXT_VALUE_COUNT * sizeof<f64>(), sizeof<f64>());
  memory.copy(valuesPointer, baseValuesPointer, Layout.STEP_GLITCH_CONTEXT_VALUE_COUNT * sizeof<f64>());
  const acceptedIndexPointer = reserveArena(targetCount * sizeof<u32>(), sizeof<u32>());
  let acceptedIndexCount: u32 = 0;
  let expandedStates: u32 = 0;
  let currentSourceXPointer = load<u32>(baseContextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_X_POINTER_OFFSET);
  let currentSourceYPointer = load<u32>(baseContextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_Y_POINTER_OFFSET);
  let currentSourceCount = load<u32>(baseContextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_COUNT_OFFSET);
  let currentRequiredPointer = baseRequiredPointer;
  let currentRequiredValueCount = baseRequiredValueCount;
  let hasAcceptedLayer = false;
  let previousGraphX = 0.0;
  let finalTargetIndex = u32.MAX_VALUE;
  let finalSourceCount = currentSourceCount;
  let finalEvidencePointer: u32 = 0;
  let finalEvidenceByteLength: u32 = 0;
  let finalReachedTargetCount: u32 = baseRequiredValueCount / 3;
  let finalAcceptedX = 0.0;
  let finalAcceptedY = 0.0;
  let finalBlockedFlag: u32 = 0;
  let finalBlockedX = 0.0;
  let finalBlockedY = 0.0;
  const isMirrored =
    (load<u32>(baseContextPointer + Layout.STEP_GLITCH_CONTEXT_FLAGS_OFFSET) & Layout.STEP_GLITCH_CONTEXT_FLAG_MIRRORED) != 0;

  let targetIndex: u32 = 0;
  let acceptedGraphX = 0.0;
  while (targetIndex < targetCount) {
    const recordPointer = targetRecordPointer + targetIndex * 3 * sizeof<f64>();
    const graphX = load<f64>(targetGraphXPointer + targetIndex * sizeof<f64>());
    const pointX = load<f64>(targetPointXPointer + targetIndex * sizeof<f64>());
    const pointY = load<f64>(targetPointYPointer + targetIndex * sizeof<f64>());
    const sourceIndex = load<u32>(targetSourceIndexPointer + targetIndex * sizeof<u32>());
    if (!isFiniteValue(graphX) || !isFiniteValue(pointX) || !isFiniteValue(pointY)) trap();
    // Source indexes identify the original assignment. Keep uniqueness in the
    // WASM boundary even when a caller bypasses the TypeScript packer.
    let priorIndex: u32 = 0;
    while (priorIndex < targetIndex) {
      if (load<u32>(targetSourceIndexPointer + priorIndex * sizeof<u32>()) == sourceIndex) trap();
      priorIndex += 1;
    }
    const hasEqualAcceptedGraphX = hasAcceptedLayer && graphX == acceptedGraphX;
    if (targetIndex > 0) {
      if ((!isMirrored && graphX < previousGraphX) || (isMirrored && graphX > previousGraphX)) trap();
    }

    // Graphwar x+ cannot advance between equal-x layers after an accepted
    // target. Keep duplicate candidates in the stable input sequence but do
    // not fabricate a second route node.
    if (hasEqualAcceptedGraphX) {
      targetIndex += 1;
      continue;
    }
    previousGraphX = graphX;

    const layerContextPointer = reserveArena(Layout.STEP_GLITCH_CONTEXT_BYTE_LENGTH, sizeof<f64>());
    memory.copy(layerContextPointer, baseContextPointer, Layout.STEP_GLITCH_CONTEXT_BYTE_LENGTH);
    store<u32>(layerContextPointer + Layout.STEP_GLITCH_CONTEXT_VALUES_POINTER_OFFSET, valuesPointer);
    store<u32>(layerContextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_X_POINTER_OFFSET, currentSourceXPointer);
    store<u32>(layerContextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_Y_POINTER_OFFSET, currentSourceYPointer);
    store<u32>(layerContextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_COUNT_OFFSET, currentSourceCount);
    store<u32>(layerContextPointer + Layout.STEP_GLITCH_CONTEXT_REQUIRED_TARGET_POINTER_OFFSET, currentRequiredPointer);
    store<u32>(layerContextPointer + Layout.STEP_GLITCH_CONTEXT_REQUIRED_TARGET_LENGTH_OFFSET, currentRequiredValueCount);
    const prefixEvidencePointer = acceptedIndexCount == 0 ? basePrefixEvidencePointer : 0;
    const prefixEvidenceByteLength = acceptedIndexCount == 0 ? basePrefixEvidenceByteLength : 0;
    store<u32>(layerContextPointer + Layout.STEP_GLITCH_CONTEXT_PREFIX_EVIDENCE_POINTER_OFFSET, prefixEvidencePointer);
    store<u32>(layerContextPointer + Layout.STEP_GLITCH_CONTEXT_PREFIX_EVIDENCE_BYTE_LENGTH_OFFSET, prefixEvidenceByteLength);

    const targetValuesPointer = reserveArena(Layout.STEP_GLITCH_REAL_DFS_INPUT_TARGET_VALUE_COUNT * sizeof<f64>(), sizeof<f64>());
    store<f64>(targetValuesPointer, load<f64>(recordPointer));
    store<f64>(targetValuesPointer + sizeof<f64>(), load<f64>(recordPointer + sizeof<f64>()));
    store<f64>(targetValuesPointer + 2 * sizeof<f64>(), load<f64>(recordPointer + 2 * sizeof<f64>()));
    store<f64>(targetValuesPointer + 3 * sizeof<f64>(), pointX);
    store<f64>(targetValuesPointer + 4 * sizeof<f64>(), pointY);
    const scanInputPointer = reserveArena(Layout.STEP_GLITCH_SCAN_INPUT_BYTE_LENGTH, sizeof<u32>());
    memory.fill(scanInputPointer, 0, Layout.STEP_GLITCH_SCAN_INPUT_BYTE_LENGTH);
    store<u32>(scanInputPointer + Layout.STEP_GLITCH_SCAN_INPUT_CONTEXT_POINTER_OFFSET, layerContextPointer);
    store<u32>(scanInputPointer + Layout.STEP_GLITCH_SCAN_INPUT_TARGET_VALUES_POINTER_OFFSET, targetValuesPointer);
    store<u32>(scanInputPointer + Layout.STEP_GLITCH_SCAN_INPUT_TARGET_VALUES_LENGTH_OFFSET, Layout.STEP_GLITCH_REAL_DFS_INPUT_TARGET_VALUE_COUNT);
    store<u32>(scanInputPointer + Layout.STEP_GLITCH_SCAN_INPUT_SOURCE_INDEX_OFFSET, sourceIndex);
    // Final validation belongs to final input target. A same-x duplicate that
    // is skipped keeps the explicit command-19 final replay in the Adapter.
    if (targetIndex + 1 == targetCount) {
      store<u32>(scanInputPointer + Layout.STEP_GLITCH_SCAN_INPUT_FINAL_VALIDATION_POINTER_OFFSET, finalValidationPointer);
      store<u32>(scanInputPointer + Layout.STEP_GLITCH_SCAN_INPUT_FINAL_VALIDATION_BYTE_LENGTH_OFFSET, finalValidationPointer == 0 ? 0 : Layout.STEP_GLITCH_FINAL_VALIDATION_BYTE_LENGTH);
    }
    const scanResultPointer = scanStepGlitch(scanInputPointer, Layout.STEP_GLITCH_SCAN_INPUT_BYTE_LENGTH);
    const status = load<u32>(scanResultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_STATUS_OFFSET);
    const scanExpanded = load<u32>(scanResultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_EXPANDED_STATES_OFFSET);
    if (expandedStates > u32.MAX_VALUE - scanExpanded) trap();
    expandedStates += scanExpanded;
    if (status == Layout.STEP_GLITCH_PRODUCTION_STATUS_INVALID_INPUT || status == Layout.STEP_GLITCH_PRODUCTION_STATUS_UNSUPPORTED) {
      // A typed command failure cannot carry a partially accepted route. The
      // caller must restart from its cold path instead of splicing prefixes.
      return createOneClickSessionResult(
        status,
        0,
        0,
        expandedStates,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        u32.MAX_VALUE,
        0,
      );
    }
    if (status == Layout.STEP_GLITCH_PRODUCTION_STATUS_HIT) {
      const evidencePointer = load<u32>(scanResultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_EVIDENCE_POINTER_OFFSET);
      const evidenceByteLength = load<u32>(scanResultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_EVIDENCE_BYTE_LENGTH_OFFSET);
      if (evidencePointer == 0 || evidenceByteLength == 0) trap();
      const pathCount = load<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_PATH_COUNT_OFFSET);
      const pathXPointer = load<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_PATH_X_POINTER_OFFSET);
      const pathYPointer = load<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_PATH_Y_POINTER_OFFSET);
      if (pathCount < 2 || pathCount < currentSourceCount) trap();
      requireElementRange(pathXPointer, pathCount, sizeof<f64>(), sizeof<f64>());
      requireElementRange(pathYPointer, pathCount, sizeof<f64>(), sizeof<f64>());
      const nextSourceXPointer = reserveArena(pathCount * sizeof<f64>(), sizeof<f64>());
      const nextSourceYPointer = reserveArena(pathCount * sizeof<f64>(), sizeof<f64>());
      memory.copy(nextSourceXPointer, pathXPointer, pathCount * sizeof<f64>());
      memory.copy(nextSourceYPointer, pathYPointer, pathCount * sizeof<f64>());
      const previousRequiredCount = currentRequiredValueCount / 3;
      const nextRequiredCount = previousRequiredCount + 1;
      const nextRequiredPointer = reserveArena(nextRequiredCount * 3 * sizeof<f64>(), sizeof<f64>());
      if (previousRequiredCount != 0) memory.copy(nextRequiredPointer, currentRequiredPointer, currentRequiredValueCount * sizeof<f64>());
      memory.copy(nextRequiredPointer + currentRequiredValueCount * sizeof<f64>(), recordPointer, 3 * sizeof<f64>());
      currentSourceXPointer = nextSourceXPointer;
      currentSourceYPointer = nextSourceYPointer;
      currentSourceCount = pathCount;
      currentRequiredPointer = nextRequiredPointer;
      currentRequiredValueCount = nextRequiredCount * 3;
      store<u32>(acceptedIndexPointer + acceptedIndexCount * sizeof<u32>(), targetIndex);
      acceptedIndexCount += 1;
      hasAcceptedLayer = true;
      finalTargetIndex = targetIndex;
      finalSourceCount = pathCount;
      acceptedGraphX = graphX;
      finalEvidencePointer = evidencePointer;
      finalEvidenceByteLength = evidenceByteLength;
      finalReachedTargetCount = load<u32>(scanResultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_REACHED_TARGET_COUNT_OFFSET);
      finalAcceptedX = load<f64>(scanResultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_ACCEPTED_X_OFFSET);
      finalAcceptedY = load<f64>(scanResultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_ACCEPTED_Y_OFFSET);
      finalBlockedFlag = load<u32>(scanResultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_BLOCKED_FLAG_OFFSET);
      finalBlockedX = load<f64>(scanResultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_BLOCKED_X_OFFSET);
      finalBlockedY = load<f64>(scanResultPointer + Layout.STEP_GLITCH_PRODUCTION_RESULT_BLOCKED_Y_OFFSET);
      store<f64>(valuesPointer + Layout.STEP_GLITCH_VALUE_PREFIX_TARGET_X_INDEX * sizeof<f64>(), load<f64>(recordPointer));
      store<f64>(valuesPointer + Layout.STEP_GLITCH_VALUE_PREFIX_TARGET_Y_INDEX * sizeof<f64>(), load<f64>(recordPointer + sizeof<f64>()));
      store<f64>(valuesPointer + Layout.STEP_GLITCH_VALUE_PREFIX_TARGET_RADIUS_INDEX * sizeof<f64>(), load<f64>(recordPointer + 2 * sizeof<f64>()));
      store<f64>(valuesPointer + Layout.STEP_GLITCH_VALUE_HAS_PREFIX_TARGET_INDEX * sizeof<f64>(), 1);
    } else if (status != Layout.STEP_GLITCH_PRODUCTION_STATUS_MISS) {
      trap();
    }
    targetIndex += 1;
  }

  if (finalEvidencePointer == 0) {
    return createOneClickSessionResult(
      Layout.STEP_GLITCH_PRODUCTION_STATUS_MISS,
      0,
      0,
      expandedStates,
      finalReachedTargetCount,
      0,
      0,
      0,
      finalBlockedFlag,
      finalBlockedX,
      finalBlockedY,
      // A normal miss is a terminal business result, not reusable partial
      // evidence. Keep failure payload atomic so the adapter cannot combine
      // accepted prefixes with a missing final target.
      0,
      0,
      u32.MAX_VALUE,
      0,
    );
  }
  return createOneClickSessionResult(
    Layout.STEP_GLITCH_PRODUCTION_STATUS_HIT,
    finalEvidencePointer,
    finalEvidenceByteLength,
    expandedStates,
    finalReachedTargetCount,
    1,
    finalAcceptedX,
    finalAcceptedY,
    finalBlockedFlag,
    finalBlockedX,
    finalBlockedY,
    acceptedIndexPointer,
    acceptedIndexCount,
    finalTargetIndex,
    finalSourceCount,
  );
}

/** Production deletion replay shares the exact candidate replay and evidence producer. */
export function replayStepGlitch(inputPointer: u32, inputByteLength: u32): u32 {
  if (inputByteLength != Layout.STEP_GLITCH_PRODUCTION_REPLAY_INPUT_BYTE_LENGTH) trap();
  requireArenaRange(inputPointer, inputByteLength, sizeof<u32>());
  const contextPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_REPLAY_CONTEXT_POINTER_OFFSET);
  requireStepGlitchContext(contextPointer);
  if (
    load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_REPLAY_RESERVED_OFFSET) != 0 ||
    load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_REPLAY_RESERVED_TAIL_OFFSET) != 0
  ) trap();
  const pathXPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_REPLAY_PATH_X_POINTER_OFFSET);
  const pathYPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_REPLAY_PATH_Y_POINTER_OFFSET);
  const pathCount = load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_REPLAY_PATH_COUNT_OFFSET);
  const sourceCount = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_COUNT_OFFSET);
  if (pathCount < 2 || pathCount < sourceCount) return createProductionResult(Layout.STEP_GLITCH_PRODUCTION_STATUS_INVALID_INPUT, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  requireElementRange(pathXPointer, pathCount, sizeof<f64>(), sizeof<f64>());
  requireElementRange(pathYPointer, pathCount, sizeof<f64>(), sizeof<f64>());
  const sourceXPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_X_POINTER_OFFSET);
  const sourceYPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_Y_POINTER_OFFSET);
  let pathIndex: u32 = 0;
  while (pathIndex < pathCount) {
    const pathX = load<f64>(pathXPointer + pathIndex * sizeof<f64>());
    const pathY = load<f64>(pathYPointer + pathIndex * sizeof<f64>());
    if (!isFiniteValue(pathX) || !isFiniteValue(pathY)) trap();
    if (pathIndex < sourceCount && (pathX != load<f64>(sourceXPointer + pathIndex * sizeof<f64>()) || pathY != load<f64>(sourceYPointer + pathIndex * sizeof<f64>()))) return createProductionResult(Layout.STEP_GLITCH_PRODUCTION_STATUS_INVALID_INPUT, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    pathIndex += 1;
  }
  const targetPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_REPLAY_TARGET_POINTER_OFFSET);
  const targetCount = load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_REPLAY_TARGET_COUNT_OFFSET);
  validateStepGlitchTargetRecords(targetPointer, targetCount);
  const windowPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_REPLAY_WINDOW_POINTER_OFFSET);
  const windowCount = load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_REPLAY_WINDOW_COUNT_OFFSET);
  const windowMode = load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_REPLAY_WINDOW_MODE_OFFSET);
  if (windowMode == Layout.STEP_GLITCH_FORMULA_WINDOW_MODE_AUTOMATIC) {
    if (windowPointer != 0 || windowCount != 0) trap();
  } else if (windowMode == Layout.STEP_GLITCH_FORMULA_WINDOW_MODE_EXPLICIT) {
    if (windowCount != pathCount - 1) trap();
    requireElementRange(windowPointer, windowCount, FormulaLayout.STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH, sizeof<f64>());
  } else trap();
  const controlX = load<f64>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_REPLAY_CONTROL_X_OFFSET);
  if (!isFiniteValue(controlX)) trap();
  const finalValidationPointer = validateProductionFinalValidation(
    load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_REPLAY_FINAL_VALIDATION_POINTER_OFFSET),
    load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_REPLAY_FINAL_VALIDATION_BYTE_LENGTH_OFFSET),
  );
  const metadataPointer = reserveArena(TrajectoryLayout.TRAJECTORY_REPLAY_METADATA_BYTE_LENGTH, sizeof<u32>());
  const replayResultPointer = replayStepGlitchCandidateWithMetadata(
    contextPointer,
    pathXPointer,
    pathYPointer,
    pathCount,
    windowPointer,
    windowCount,
    windowMode,
    targetPointer,
    targetCount,
    controlX,
    metadataPointer,
    finalValidationPointer,
  );
  const reachedTargetCount = load<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REACHED_ORDERED_COUNT_OFFSET) +
    load<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REACHED_REQUIRED_COUNT_OFFSET);
  const hasAcceptedPoint = load<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_FLAG_OFFSET);
  const hasBlockedPoint = load<u32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_FLAG_OFFSET);
  if (load<i32>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_LAUNCH_STATUS_OFFSET) == TrajectoryLayout.TRAJECTORY_RESULT_LAUNCH_STATUS_INVALID) {
    return createProductionResult(Layout.STEP_GLITCH_PRODUCTION_STATUS_MISS, 0, 0, 0, reachedTargetCount, 0, 0, 0, hasBlockedPoint, load<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_X_OFFSET), load<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_Y_OFFSET));
  }
  if (hasAcceptedPoint == 0) {
    return createProductionResult(Layout.STEP_GLITCH_PRODUCTION_STATUS_MISS, 0, 0, 0, reachedTargetCount, 0, 0, 0, hasBlockedPoint, load<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_X_OFFSET), load<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_Y_OFFSET));
  }
  const evidencePointer = copyProductionReplayEvidence(
    contextPointer,
    metadataPointer,
    replayResultPointer,
    pathXPointer,
    pathYPointer,
    pathCount,
    finalValidationPointer,
    u32.MAX_VALUE,
    0,
    0,
  );
  return createProductionResult(Layout.STEP_GLITCH_PRODUCTION_STATUS_HIT, evidencePointer, load<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_BYTE_LENGTH_OFFSET), 0, reachedTargetCount, hasAcceptedPoint, load<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_X_OFFSET), load<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_Y_OFFSET), hasBlockedPoint, load<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_X_OFFSET), load<f64>(replayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_Y_OFFSET));
}

/** Production smart composition owns candidate deletion and numerical replay in one WASM command. */
export function composeStepGlitchSmartPath(inputPointer: u32, inputByteLength: u32): u32 {
  if (inputByteLength != Layout.STEP_GLITCH_PRODUCTION_COMPOSITION_INPUT_BYTE_LENGTH) trap();
  requireArenaRange(inputPointer, inputByteLength, sizeof<u32>());
  const contextPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_COMPOSITION_CONTEXT_POINTER_OFFSET);
  requireStepGlitchContext(contextPointer);
  const flags = load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_COMPOSITION_FLAGS_OFFSET);
  if (
    (flags & ~Layout.STEP_GLITCH_PRODUCTION_COMPOSITION_FLAG_DELETE_OPTIMIZATION) != 0 ||
    load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_COMPOSITION_RESERVED_TAIL_OFFSET) != 0
  ) trap();

  const pathXPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_COMPOSITION_PATH_X_POINTER_OFFSET);
  const pathYPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_COMPOSITION_PATH_Y_POINTER_OFFSET);
  const pathCount = load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_COMPOSITION_PATH_COUNT_OFFSET);
  const sourceCount = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_COUNT_OFFSET);
  if (
    pathCount < 2 ||
    pathCount < sourceCount ||
    load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_COMPOSITION_SOURCE_COUNT_OFFSET) != sourceCount
  ) {
    return createProductionResult(Layout.STEP_GLITCH_PRODUCTION_STATUS_INVALID_INPUT, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
  requireElementRange(pathXPointer, pathCount, sizeof<f64>(), sizeof<f64>());
  requireElementRange(pathYPointer, pathCount, sizeof<f64>(), sizeof<f64>());
  const sourceXPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_X_POINTER_OFFSET);
  const sourceYPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_Y_POINTER_OFFSET);
  let pathIndex: u32 = 0;
  while (pathIndex < pathCount) {
    const pathX = load<f64>(pathXPointer + pathIndex * sizeof<f64>());
    const pathY = load<f64>(pathYPointer + pathIndex * sizeof<f64>());
    if (!isFiniteValue(pathX) || !isFiniteValue(pathY)) trap();
    if (
      pathIndex < sourceCount &&
      (pathX != load<f64>(sourceXPointer + pathIndex * sizeof<f64>()) ||
        pathY != load<f64>(sourceYPointer + pathIndex * sizeof<f64>()))
    ) {
      return createProductionResult(Layout.STEP_GLITCH_PRODUCTION_STATUS_INVALID_INPUT, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }
    pathIndex += 1;
  }
  if (!stepGlitchPathFollowsGraphRule(contextPointer, pathXPointer, pathCount)) {
    return createProductionResult(Layout.STEP_GLITCH_PRODUCTION_STATUS_INVALID_INPUT, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }

  const targetPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_COMPOSITION_TARGET_POINTER_OFFSET);
  const targetCount = load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_COMPOSITION_TARGET_COUNT_OFFSET);
  validateStepGlitchTargetRecords(targetPointer, targetCount);
  const controlX = load<f64>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_COMPOSITION_CONTROL_X_OFFSET);
  if (!isFiniteValue(controlX)) trap();
  const finalValidationPointer = validateProductionFinalValidation(
    load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_COMPOSITION_FINAL_VALIDATION_POINTER_OFFSET),
    load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_COMPOSITION_FINAL_VALIDATION_BYTE_LENGTH_OFFSET),
  );
  let currentWindowPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_COMPOSITION_WINDOW_POINTER_OFFSET);
  let currentWindowCount = load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_COMPOSITION_WINDOW_COUNT_OFFSET);
  let currentWindowMode = load<u32>(inputPointer + Layout.STEP_GLITCH_PRODUCTION_COMPOSITION_WINDOW_MODE_OFFSET);
  if (currentWindowMode == Layout.STEP_GLITCH_FORMULA_WINDOW_MODE_AUTOMATIC) {
    if (currentWindowPointer != 0 || currentWindowCount != 0) trap();
  } else if (currentWindowMode == Layout.STEP_GLITCH_FORMULA_WINDOW_MODE_EXPLICIT) {
    if (currentWindowCount != pathCount - 1) trap();
    requireElementRange(
      currentWindowPointer,
      currentWindowCount,
      FormulaLayout.STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH,
      sizeof<f64>(),
    );
  } else trap();

  const pathByteLength = checkedProductionEvidenceBytes(pathCount, sizeof<f64>());
  const currentXPointer = reserveArena(pathByteLength, sizeof<f64>());
  const currentYPointer = reserveArena(pathByteLength, sizeof<f64>());
  const candidateXPointer = reserveArena(pathByteLength, sizeof<f64>());
  const candidateYPointer = reserveArena(pathByteLength, sizeof<f64>());
  memory.copy(currentXPointer, pathXPointer, pathByteLength);
  memory.copy(currentYPointer, pathYPointer, pathByteLength);

  let currentCount = pathCount;
  let replayCount: u32 = 0;
  let acceptedX: f64 = 0;
  let acceptedY: f64 = 0;

  // Candidate replay allocates formula and trajectory state. Discard each
  // transaction after copying only the accepted path so long routes do not
  // retain one full replay allocation set per deletion attempt.
  const initialMark = markArena();
  const initialMetadataPointer = reserveArena(TrajectoryLayout.TRAJECTORY_REPLAY_METADATA_BYTE_LENGTH, sizeof<u32>());
  const initialReplayResultPointer = replayStepGlitchCandidateWithMetadata(
    contextPointer,
    currentXPointer,
    currentYPointer,
    currentCount,
    currentWindowPointer,
    currentWindowCount,
    currentWindowMode,
    targetPointer,
    targetCount,
    controlX,
    initialMetadataPointer,
    finalValidationPointer,
  );
  replayCount += 1;
  const initialLaunchStatus = load<i32>(
    initialReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_LAUNCH_STATUS_OFFSET,
  );
  const initialAcceptedFlag = load<u32>(
    initialReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_FLAG_OFFSET,
  );
  const initialReachedTargetCount =
    load<u32>(initialReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REACHED_ORDERED_COUNT_OFFSET) +
    load<u32>(initialReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REACHED_REQUIRED_COUNT_OFFSET);
  const initialBlockedFlag = load<u32>(initialReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_FLAG_OFFSET);
  const initialBlockedX = load<f64>(initialReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_X_OFFSET);
  const initialBlockedY = load<f64>(initialReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_Y_OFFSET);
  const initialAcceptedX = load<f64>(initialReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_X_OFFSET);
  const initialAcceptedY = load<f64>(initialReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_Y_OFFSET);
  resetArena(initialMark);
  if (
    initialLaunchStatus == TrajectoryLayout.TRAJECTORY_RESULT_LAUNCH_STATUS_INVALID ||
    initialAcceptedFlag == 0
  ) {
    return createProductionResult(
      Layout.STEP_GLITCH_PRODUCTION_STATUS_MISS,
      0,
      0,
      replayCount,
      initialReachedTargetCount,
      0,
      0,
      0,
      initialBlockedFlag,
      initialBlockedX,
      initialBlockedY,
    );
  }
  acceptedX = initialAcceptedX;
  acceptedY = initialAcceptedY;

  // Scan-selected fixed windows are part of the successful gate proof. Replaying
  // deletion candidates with automatic windows can lose that bounded search
  // frontier, so retain the proven path when the initial candidate is explicit.
  if (
    (flags & Layout.STEP_GLITCH_PRODUCTION_COMPOSITION_FLAG_DELETE_OPTIMIZATION) != 0 &&
    currentWindowMode == Layout.STEP_GLITCH_FORMULA_WINDOW_MODE_AUTOMATIC
  ) {
    let index: u32 = sourceCount < 1 ? 1 : sourceCount;
    while (index < currentCount - 1 && currentCount > 2) {
      if (
        isStepGlitchTargetControlPoint(
          finalValidationPointer,
          load<f64>(currentXPointer + index * sizeof<f64>()),
          load<f64>(currentYPointer + index * sizeof<f64>()),
        )
      ) {
        index += 1;
        continue;
      }
      const candidateCount = currentCount - 1;
      let readIndex: u32 = 0;
      let writeIndex: u32 = 0;
      while (readIndex < currentCount) {
        if (readIndex != index) {
          store<f64>(
            candidateXPointer + writeIndex * sizeof<f64>(),
            load<f64>(currentXPointer + readIndex * sizeof<f64>()),
          );
          store<f64>(
            candidateYPointer + writeIndex * sizeof<f64>(),
            load<f64>(currentYPointer + readIndex * sizeof<f64>()),
          );
          writeIndex += 1;
        }
        readIndex += 1;
      }
      if (!stepGlitchPathFollowsGraphRule(contextPointer, candidateXPointer, candidateCount)) {
        index += 1;
        continue;
      }

      const candidateMark = markArena();
      const candidateMetadataPointer = reserveArena(
        TrajectoryLayout.TRAJECTORY_REPLAY_METADATA_BYTE_LENGTH,
        sizeof<u32>(),
      );
      const candidateReplayResultPointer = replayStepGlitchCandidateWithMetadata(
        contextPointer,
        candidateXPointer,
        candidateYPointer,
        candidateCount,
        0,
        0,
        Layout.STEP_GLITCH_FORMULA_WINDOW_MODE_AUTOMATIC,
        targetPointer,
        targetCount,
        controlX,
        candidateMetadataPointer,
        finalValidationPointer,
      );
      replayCount += 1;
      const candidateLaunchStatus = load<i32>(
        candidateReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_LAUNCH_STATUS_OFFSET,
      );
      const candidateAcceptedFlag = load<u32>(
        candidateReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_FLAG_OFFSET,
      );
      if (
        candidateLaunchStatus != TrajectoryLayout.TRAJECTORY_RESULT_LAUNCH_STATUS_INVALID &&
        candidateAcceptedFlag != 0
      ) {
        memory.copy(currentXPointer, candidateXPointer, checkedProductionEvidenceBytes(candidateCount, sizeof<f64>()));
        memory.copy(currentYPointer, candidateYPointer, checkedProductionEvidenceBytes(candidateCount, sizeof<f64>()));
        currentCount = candidateCount;
        currentWindowPointer = 0;
        currentWindowCount = 0;
        currentWindowMode = Layout.STEP_GLITCH_FORMULA_WINDOW_MODE_AUTOMATIC;
        acceptedX = load<f64>(candidateReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_X_OFFSET);
        acceptedY = load<f64>(candidateReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_Y_OFFSET);
      }
      resetArena(candidateMark);
    }
  }

  const finalMark = markArena();
  const finalMetadataPointer = reserveArena(TrajectoryLayout.TRAJECTORY_REPLAY_METADATA_BYTE_LENGTH, sizeof<u32>());
  const finalReplayResultPointer = replayStepGlitchCandidateWithMetadata(
    contextPointer,
    currentXPointer,
    currentYPointer,
    currentCount,
    currentWindowPointer,
    currentWindowCount,
    currentWindowMode,
    targetPointer,
    targetCount,
    controlX,
    finalMetadataPointer,
    finalValidationPointer,
  );
  replayCount += 1;
  if (
    load<i32>(finalReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_LAUNCH_STATUS_OFFSET) ==
      TrajectoryLayout.TRAJECTORY_RESULT_LAUNCH_STATUS_INVALID ||
    load<u32>(finalReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_FLAG_OFFSET) == 0
  ) {
    const finalReachedTargetCount =
      load<u32>(finalReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REACHED_ORDERED_COUNT_OFFSET) +
      load<u32>(finalReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REACHED_REQUIRED_COUNT_OFFSET);
    const finalBlockedFlag = load<u32>(finalReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_FLAG_OFFSET);
    const finalBlockedX = load<f64>(finalReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_X_OFFSET);
    const finalBlockedY = load<f64>(finalReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_Y_OFFSET);
    resetArena(finalMark);
    return createProductionResult(
      Layout.STEP_GLITCH_PRODUCTION_STATUS_MISS,
      0,
      0,
      replayCount,
      finalReachedTargetCount,
      0,
      0,
      0,
      finalBlockedFlag,
      finalBlockedX,
      finalBlockedY,
    );
  }
  const evidencePointer = copyProductionReplayEvidence(
    contextPointer,
    finalMetadataPointer,
    finalReplayResultPointer,
    currentXPointer,
    currentYPointer,
    currentCount,
    finalValidationPointer,
    u32.MAX_VALUE,
    0,
    0,
  );
  const finalReachedTargetCount =
    load<u32>(finalReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REACHED_ORDERED_COUNT_OFFSET) +
    load<u32>(finalReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REACHED_REQUIRED_COUNT_OFFSET);
  acceptedX = load<f64>(finalReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_X_OFFSET);
  acceptedY = load<f64>(finalReplayResultPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_Y_OFFSET);
  commitArena(finalMark);

  return createProductionResult(
    Layout.STEP_GLITCH_PRODUCTION_STATUS_HIT,
    evidencePointer,
    load<u32>(evidencePointer + Layout.STEP_GLITCH_PRODUCTION_EVIDENCE_BYTE_LENGTH_OFFSET),
    replayCount,
    finalReachedTargetCount,
    1,
    acceptedX,
    acceptedY,
    0,
    0,
    0,
  );
}

/** Route target anchors are protected independently of hit-circle centers. */
function isStepGlitchTargetControlPoint(finalValidationPointer: u32, pointX: f64, pointY: f64): bool {
  if (finalValidationPointer == 0) return false;
  const targetCount = load<u32>(finalValidationPointer + Layout.STEP_GLITCH_FINAL_VALIDATION_TARGET_CONTROL_COUNT_OFFSET);
  const targetXPointer = load<u32>(
    finalValidationPointer + Layout.STEP_GLITCH_FINAL_VALIDATION_TARGET_CONTROL_X_POINTER_OFFSET,
  );
  const targetYPointer = load<u32>(
    finalValidationPointer + Layout.STEP_GLITCH_FINAL_VALIDATION_TARGET_CONTROL_Y_POINTER_OFFSET,
  );
  let index: u32 = 0;
  while (index < targetCount) {
    if (
      pointX == load<f64>(targetXPointer + index * sizeof<f64>()) &&
      pointY == load<f64>(targetYPointer + index * sizeof<f64>())
    ) {
      return true;
    }
    index += 1;
  }
  return false;
}

/** Candidate deletion must preserve the same strict image-space x+ rule as the Worker path validator. */
function stepGlitchPathFollowsGraphRule(contextPointer: u32, pathXPointer: u32, pathCount: u32): bool {
  const isMirrored = (load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_FLAGS_OFFSET) & Layout.STEP_GLITCH_CONTEXT_FLAG_MIRRORED) != 0;
  let index: u32 = 1;
  while (index < pathCount) {
    const previousX = load<f64>(pathXPointer + (index - 1) * sizeof<f64>());
    const nextX = load<f64>(pathXPointer + index * sizeof<f64>());
    if ((!isMirrored && !(nextX > previousX)) || (isMirrored && !(nextX < previousX))) return false;
    index += 1;
  }
  return true;
}

@inline
function isFiniteValue(value: f64): bool {
  return value == value && value != f64.POSITIVE_INFINITY && value != f64.NEGATIVE_INFINITY;
}

@inline
function isIntegerValue(value: f64): bool {
  return isFiniteValue(value) && NativeMath.floor(value) == value;
}

@inline
function loadValue(pointer: u32, index: u32): f64 {
  return load<f64>(pointer + index * sizeof<f64>());
}

function validateContextValues(pointer: u32): u32 {
  const minX = loadValue(pointer, Layout.STEP_GLITCH_VALUE_MIN_X_INDEX);
  const maxX = loadValue(pointer, Layout.STEP_GLITCH_VALUE_MAX_X_INDEX);
  const minY = loadValue(pointer, Layout.STEP_GLITCH_VALUE_MIN_Y_INDEX);
  const maxY = loadValue(pointer, Layout.STEP_GLITCH_VALUE_MAX_Y_INDEX);
  const rectX = loadValue(pointer, Layout.STEP_GLITCH_VALUE_RECT_X_INDEX);
  const rectY = loadValue(pointer, Layout.STEP_GLITCH_VALUE_RECT_Y_INDEX);
  const rectWidth = loadValue(pointer, Layout.STEP_GLITCH_VALUE_RECT_WIDTH_INDEX);
  const rectHeight = loadValue(pointer, Layout.STEP_GLITCH_VALUE_RECT_HEIGHT_INDEX);
  const boundaryExpansion = loadValue(pointer, Layout.STEP_GLITCH_VALUE_BOUNDARY_EXPANSION_INDEX);
  const prefixTargetX = loadValue(pointer, Layout.STEP_GLITCH_VALUE_PREFIX_TARGET_X_INDEX);
  const prefixTargetY = loadValue(pointer, Layout.STEP_GLITCH_VALUE_PREFIX_TARGET_Y_INDEX);
  const prefixTargetRadius = loadValue(pointer, Layout.STEP_GLITCH_VALUE_PREFIX_TARGET_RADIUS_INDEX);
  const hasPrefixTarget = loadValue(pointer, Layout.STEP_GLITCH_VALUE_HAS_PREFIX_TARGET_INDEX);
  const qualityTargetPlanePixels = loadValue(pointer, Layout.STEP_GLITCH_VALUE_QUALITY_TARGET_PLANE_PIXELS_INDEX);
  if (
    !isFiniteValue(minX) ||
    !isFiniteValue(maxX) ||
    !isFiniteValue(minY) ||
    !isFiniteValue(maxY) ||
    minX == maxX ||
    minY == maxY ||
    !isFiniteValue(rectX) ||
    !isFiniteValue(rectY) ||
    !isFiniteValue(rectWidth) ||
    rectWidth <= 0 ||
    !isFiniteValue(rectHeight) ||
    rectHeight <= 0 ||
    !isIntegerValue(boundaryExpansion) ||
    boundaryExpansion < 0 ||
    boundaryExpansion > <f64>u32.MAX_VALUE ||
    !isIntegerValue(hasPrefixTarget) ||
    (hasPrefixTarget != 0 && hasPrefixTarget != 1) ||
    !isFiniteValue(prefixTargetX) ||
    !isFiniteValue(prefixTargetY) ||
    !isFiniteValue(prefixTargetRadius) ||
    prefixTargetRadius < 0 ||
    (hasPrefixTarget == 0 &&
      (reinterpret<u64>(prefixTargetX) != 0 ||
        reinterpret<u64>(prefixTargetY) != 0 ||
        reinterpret<u64>(prefixTargetRadius) != 0)) ||
    !isFiniteValue(qualityTargetPlanePixels) ||
    qualityTargetPlanePixels <= 0
  ) trap();
  return <u32>boundaryExpansion;
}

function validateFormulaSettings(pointer: u32): void {
  const algorithm = loadValue(pointer, Layout.STEP_GLITCH_SETTING_ALGORITHM_INDEX);
  const equation = loadValue(pointer, Layout.STEP_GLITCH_SETTING_EQUATION_INDEX);
  const decimalPlaces = loadValue(pointer, Layout.STEP_GLITCH_SETTING_DECIMAL_PLACES_INDEX);
  const steepness = loadValue(pointer, Layout.STEP_GLITCH_SETTING_STEEPNESS_INDEX);
  const formulaPathSteepness = loadValue(pointer, Layout.STEP_GLITCH_SETTING_FORMULA_PATH_STEEPNESS_INDEX);
  const angleMode = loadValue(pointer, Layout.STEP_GLITCH_SETTING_SECOND_ORDER_ANGLE_MODE_INDEX);
  const flags = loadValue(pointer, Layout.STEP_GLITCH_SETTING_FLAGS_INDEX);
  const allowedFlags =
    Layout.STEP_GLITCH_SETTING_FLAG_MODE_ENABLED |
    Layout.STEP_GLITCH_SETTING_FLAG_OVERFLOW_PROTECTION |
    Layout.STEP_GLITCH_SETTING_FLAG_HAS_FORMULA_PATH_STEEPNESS;
  if (
    algorithm != <f64>FormulaLayout.FORMULA_ALGORITHM_STEP ||
    (equation != <f64>FormulaLayout.FORMULA_EQUATION_DY && equation != <f64>FormulaLayout.FORMULA_EQUATION_DDY) ||
    !isIntegerValue(decimalPlaces) ||
    decimalPlaces < 0 ||
    decimalPlaces > 15 ||
    !isFiniteValue(steepness) ||
    steepness <= 0 ||
    !isFiniteValue(formulaPathSteepness) ||
    !isIntegerValue(angleMode) ||
    angleMode < 0 ||
    angleMode > 2 ||
    !isIntegerValue(flags) ||
    flags < 0 ||
    flags > <f64>u32.MAX_VALUE ||
    (<u32>flags & ~allowedFlags) != 0 ||
    (<u32>flags & Layout.STEP_GLITCH_SETTING_FLAG_MODE_ENABLED) == 0 ||
    (((<u32>flags & Layout.STEP_GLITCH_SETTING_FLAG_HAS_FORMULA_PATH_STEEPNESS) != 0)
      ? formulaPathSteepness <= 0
      : formulaPathSteepness != 0)
  ) trap();
}

@inline
function requireElementRange(pointer: u32, length: u32, elementByteLength: u32, alignment: u32): void {
  if (length > u32.MAX_VALUE / elementByteLength) trap();
  requireArenaRange(pointer, length * elementByteLength, alignment);
}

function validatePrefixEvidenceDescriptor(pointer: u32, byteLength: u32): void {
  if (byteLength != Layout.STEP_GLITCH_PREFIX_EVIDENCE_BYTE_LENGTH) trap();
  requireArenaRange(pointer, byteLength, sizeof<u32>());
  const type = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_EVIDENCE_TYPE_OFFSET);
  if (type == 0) {
    let offset: u32 = sizeof<u32>();
    while (offset < byteLength) {
      if (load<u32>(pointer + offset) != 0) trap();
      offset += sizeof<u32>();
    }
    return;
  }
  if (type != 1) trap();

  const cellCount = <u32>getGraphwarPlaneLength() * <u32>getGraphwarPlaneHeight();
  const identityMaskLength = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_EVIDENCE_IDENTITY_MASK_LENGTH_OFFSET);
  if (identityMaskLength != cellCount) trap();
  requireElementRange(
    load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_EVIDENCE_IDENTITY_MASK_POINTER_OFFSET),
    identityMaskLength,
    sizeof<u8>(),
    sizeof<u8>(),
  );
  const evidenceValueCount = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_EVIDENCE_VALUES_LENGTH_OFFSET);
  if (evidenceValueCount != 7) trap();
  const evidenceValuesPointer = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_EVIDENCE_VALUES_POINTER_OFFSET);
  requireElementRange(
    evidenceValuesPointer,
    evidenceValueCount,
    sizeof<f64>(),
    sizeof<f64>(),
  );
  let evidenceValueIndex: u32 = 0;
  while (evidenceValueIndex < evidenceValueCount) {
    if (!isFiniteValue(load<f64>(evidenceValuesPointer + evidenceValueIndex * sizeof<f64>()))) trap();
    evidenceValueIndex += 1;
  }
  if (
    !isIntegerValue(load<f64>(evidenceValuesPointer + 2 * sizeof<f64>())) ||
    load<f64>(evidenceValuesPointer + 2 * sizeof<f64>()) < 0 ||
    load<f64>(evidenceValuesPointer + 5 * sizeof<f64>()) < 0 ||
    !isIntegerValue(load<f64>(evidenceValuesPointer + 6 * sizeof<f64>())) ||
    reinterpret<i64>(load<f64>(evidenceValuesPointer + 6 * sizeof<f64>())) < 0 ||
    (load<f64>(evidenceValuesPointer + 6 * sizeof<f64>()) != 0 &&
      load<f64>(evidenceValuesPointer + 6 * sizeof<f64>()) != 1)
  ) trap();

  const boundaryType = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_EVIDENCE_BOUNDARY_TYPE_OFFSET);
  const boundaryIdentityPointer = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_EVIDENCE_BOUNDARY_IDENTITY_POINTER_OFFSET);
  const boundaryIdentityLength = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_EVIDENCE_BOUNDARY_IDENTITY_LENGTH_OFFSET);
  const boundaryStatePointer = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_EVIDENCE_BOUNDARY_STATE_POINTER_OFFSET);
  const boundaryStateLength = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_EVIDENCE_BOUNDARY_STATE_LENGTH_OFFSET);
  if (boundaryType == 0) {
    if (boundaryIdentityPointer != 0 || boundaryIdentityLength != 0 || boundaryStatePointer != 0 || boundaryStateLength != 0) {
      trap();
    }
  } else {
    if (boundaryType != 1 || boundaryIdentityLength == 0 || boundaryStateLength != 11) trap();
    requireElementRange(boundaryIdentityPointer, boundaryIdentityLength, sizeof<u8>(), sizeof<u8>());
    requireElementRange(boundaryStatePointer, boundaryStateLength, sizeof<f64>(), sizeof<f64>());
    let boundaryStateIndex: u32 = 0;
    while (boundaryStateIndex < boundaryStateLength) {
      if (!isFiniteValue(load<f64>(boundaryStatePointer + boundaryStateIndex * sizeof<f64>()))) trap();
      boundaryStateIndex += 1;
    }
  }

  const pointCount = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_POINTS_COUNT_OFFSET);
  const initialCount = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_INITIAL_COUNT_OFFSET);
  const refinedCount = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_REFINED_COUNT_OFFSET);
  if (pointCount == 0 || initialCount != pointCount || refinedCount != pointCount) trap();
  const initialXPointer = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_INITIAL_X_POINTER_OFFSET);
  const initialYPointer = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_INITIAL_Y_POINTER_OFFSET);
  const pointsXPointer = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_POINTS_X_POINTER_OFFSET);
  const pointsYPointer = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_POINTS_Y_POINTER_OFFSET);
  const refinedXPointer = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_REFINED_X_POINTER_OFFSET);
  const refinedYPointer = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_REFINED_Y_POINTER_OFFSET);
  requireElementRange(initialXPointer, pointCount, sizeof<f64>(), sizeof<f64>());
  requireElementRange(initialYPointer, pointCount, sizeof<f64>(), sizeof<f64>());
  requireElementRange(pointsXPointer, pointCount, sizeof<f64>(), sizeof<f64>());
  requireElementRange(pointsYPointer, pointCount, sizeof<f64>(), sizeof<f64>());
  requireElementRange(refinedXPointer, pointCount, sizeof<f64>(), sizeof<f64>());
  requireElementRange(refinedYPointer, pointCount, sizeof<f64>(), sizeof<f64>());
  let pointIndex: u32 = 0;
  while (pointIndex < pointCount) {
    if (
      !isFiniteValue(load<f64>(initialXPointer + pointIndex * sizeof<f64>())) ||
      !isFiniteValue(load<f64>(initialYPointer + pointIndex * sizeof<f64>())) ||
      !isFiniteValue(load<f64>(pointsXPointer + pointIndex * sizeof<f64>())) ||
      !isFiniteValue(load<f64>(pointsYPointer + pointIndex * sizeof<f64>())) ||
      !isFiniteValue(load<f64>(refinedXPointer + pointIndex * sizeof<f64>())) ||
      !isFiniteValue(load<f64>(refinedYPointer + pointIndex * sizeof<f64>()))
    ) trap();
    pointIndex += 1;
  }

  const metadataLength = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_METADATA_LENGTH_OFFSET);
  if (metadataLength != 9) trap();
  const metadataPointer = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_METADATA_POINTER_OFFSET);
  requireElementRange(metadataPointer, metadataLength, sizeof<f64>(), sizeof<f64>());
  let metadataIndex: u32 = 0;
  while (metadataIndex < metadataLength) {
    if (!isFiniteValue(load<f64>(metadataPointer + metadataIndex * sizeof<f64>()))) trap();
    metadataIndex += 1;
  }
  const metadataFlags = load<f64>(metadataPointer + 7 * sizeof<f64>());
  if (
    !isIntegerValue(metadataFlags) ||
    metadataFlags < 0 ||
    metadataFlags > 3 ||
    ((<u32>metadataFlags & 1) == 0 && reinterpret<u64>(load<f64>(metadataPointer + 4 * sizeof<f64>())) != 0) ||
    ((<u32>metadataFlags & 2) == 0 &&
      (reinterpret<u64>(load<f64>(metadataPointer + 5 * sizeof<f64>())) != 0 ||
        reinterpret<u64>(load<f64>(metadataPointer + 6 * sizeof<f64>())) != 0)) ||
    load<f64>(metadataPointer + 8 * sizeof<f64>()) != <f64>(pointCount - 1)
  ) trap();
  const segmentCount = pointCount - 1;
  if (
    load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_SEGMENT_START_COUNT_OFFSET) != segmentCount ||
    load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_SEGMENT_START_PRESENCE_LENGTH_OFFSET) != segmentCount ||
    load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_SIGN_PROTECTION_LENGTH_OFFSET) != segmentCount ||
    load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_REQUIREMENTS_LENGTH_OFFSET) != segmentCount ||
    load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_SEGMENTS_LENGTH_OFFSET) != segmentCount * 10 ||
    load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_DELTA_VALUES_LENGTH_OFFSET) != segmentCount ||
    load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_DELTA_PRESENCE_LENGTH_OFFSET) != segmentCount
  ) trap();
  const segmentStartXPointer = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_SEGMENT_START_X_POINTER_OFFSET);
  const segmentStartYPointer = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_SEGMENT_START_Y_POINTER_OFFSET);
  const segmentStartPresencePointer = load<u32>(
    pointer + Layout.STEP_GLITCH_PREFIX_SEGMENT_START_PRESENCE_POINTER_OFFSET,
  );
  requireElementRange(segmentStartXPointer, segmentCount, sizeof<f64>(), sizeof<f64>());
  requireElementRange(segmentStartYPointer, segmentCount, sizeof<f64>(), sizeof<f64>());
  requireElementRange(segmentStartPresencePointer, segmentCount, sizeof<u8>(), sizeof<u8>());
  const settingsLength = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_SETTINGS_LENGTH_OFFSET);
  if (settingsLength != Layout.STEP_GLITCH_SETTINGS_VALUE_COUNT || load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_SETTINGS_MASK_TAG_OFFSET) > 3) trap();
  const evidenceSettingsPointer = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_SETTINGS_POINTER_OFFSET);
  requireElementRange(evidenceSettingsPointer, settingsLength, sizeof<f64>(), sizeof<f64>());
  validateFormulaSettings(evidenceSettingsPointer);
  const evidenceEquation = <i32>load<f64>(
    evidenceSettingsPointer + Layout.STEP_GLITCH_SETTING_EQUATION_INDEX * sizeof<f64>(),
  );
  const expectedSegmentType = evidenceEquation == FormulaLayout.FORMULA_EQUATION_DY ? 1.0 : 2.0;
  if (boundaryType == 1) {
    const boundarySegmentCount = load<f64>(boundaryStatePointer + sizeof<f64>());
    const boundaryFlags = load<f64>(boundaryStatePointer + 10 * sizeof<f64>());
    const sampleIndex = load<f64>(boundaryStatePointer + 9 * sizeof<f64>());
    if (
      !isIntegerValue(boundarySegmentCount) ||
      boundarySegmentCount != <f64>segmentCount ||
      !isIntegerValue(sampleIndex) ||
      sampleIndex < 0 ||
      sampleIndex > <f64>u32.MAX_VALUE ||
      !isIntegerValue(boundaryFlags) ||
      boundaryFlags < 0 ||
      boundaryFlags > 15
    ) trap();
    const flags = <u32>boundaryFlags;
    const hasLaunchAngle = (flags & 1) != 0;
    const isSecondOrder = (flags & 2) != 0;
    const hasPreviousPoint = (flags & 4) != 0;
    const hasPreviousDy = (flags & 8) != 0;
    if (
      isSecondOrder != (evidenceEquation == FormulaLayout.FORMULA_EQUATION_DDY) ||
      hasPreviousPoint != (sampleIndex > 0) ||
      (isSecondOrder ? hasPreviousDy != hasPreviousPoint : hasPreviousDy) ||
      (!hasLaunchAngle && reinterpret<u64>(load<f64>(boundaryStatePointer + 2 * sizeof<f64>())) != 0) ||
      (!isSecondOrder && reinterpret<u64>(load<f64>(boundaryStatePointer + 5 * sizeof<f64>())) != 0) ||
      (!hasPreviousPoint &&
        (reinterpret<u64>(load<f64>(boundaryStatePointer + 6 * sizeof<f64>())) != 0 ||
          reinterpret<u64>(load<f64>(boundaryStatePointer + 7 * sizeof<f64>())) != 0)) ||
      (!hasPreviousDy && reinterpret<u64>(load<f64>(boundaryStatePointer + 8 * sizeof<f64>())) != 0)
    ) trap();
  }
  const signProtectionPointer = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_SIGN_PROTECTION_POINTER_OFFSET);
  const requirementsPointer = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_REQUIREMENTS_POINTER_OFFSET);
  const segmentsPointer = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_SEGMENTS_POINTER_OFFSET);
  const deltaValuesPointer = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_DELTA_VALUES_POINTER_OFFSET);
  const deltaPresencePointer = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_DELTA_PRESENCE_POINTER_OFFSET);
  requireElementRange(signProtectionPointer, segmentCount, sizeof<u32>(), sizeof<u32>());
  requireElementRange(requirementsPointer, segmentCount, sizeof<u8>(), sizeof<u8>());
  requireElementRange(segmentsPointer, segmentCount * 10, sizeof<f64>(), sizeof<f64>());
  requireElementRange(deltaValuesPointer, segmentCount, sizeof<f64>(), sizeof<f64>());
  requireElementRange(deltaPresencePointer, segmentCount, sizeof<u8>(), sizeof<u8>());
  let segmentIndex: u32 = 0;
  while (segmentIndex < segmentCount) {
    const segmentStartPresence = load<u8>(segmentStartPresencePointer + segmentIndex);
    const segmentStartX = load<f64>(segmentStartXPointer + segmentIndex * sizeof<f64>());
    const segmentStartY = load<f64>(segmentStartYPointer + segmentIndex * sizeof<f64>());
    const requirement = load<u8>(requirementsPointer + segmentIndex);
    const deltaPresence = load<u8>(deltaPresencePointer + segmentIndex);
    const deltaValue = load<f64>(deltaValuesPointer + segmentIndex * sizeof<f64>());
    const segmentPointer = segmentsPointer + segmentIndex * 10 * sizeof<f64>();
    const segmentType = load<f64>(segmentPointer);
    if (
      segmentStartPresence > 1 ||
      !isFiniteValue(segmentStartX) ||
      !isFiniteValue(segmentStartY) ||
      (segmentStartPresence == 0 &&
        (reinterpret<u64>(segmentStartX) != 0 || reinterpret<u64>(segmentStartY) != 0)) ||
      requirement > 1 ||
      deltaPresence > 1 ||
      (load<u32>(signProtectionPointer + segmentIndex * sizeof<u32>()) & ~31) != 0 ||
      !isFiniteValue(deltaValue) ||
      (deltaPresence == 0 && reinterpret<u64>(deltaValue) != 0) ||
      (segmentType != 0 && segmentType != 1 && segmentType != 2) ||
      (segmentType != 0 && segmentType != expectedSegmentType) ||
      (requirement != 0 && segmentType == 0)
    ) trap();
    let segmentValueIndex: u32 = 1;
    while (segmentValueIndex < 10) {
      if (!isFiniteValue(load<f64>(segmentPointer + segmentValueIndex * sizeof<f64>()))) trap();
      segmentValueIndex += 1;
    }
    if (segmentType == 0) {
      segmentValueIndex = 1;
      while (segmentValueIndex < 10) {
        if (reinterpret<u64>(load<f64>(segmentPointer + segmentValueIndex * sizeof<f64>())) != 0) trap();
        segmentValueIndex += 1;
      }
    } else {
      const startX = load<f64>(segmentPointer + sizeof<f64>());
      const endX = load<f64>(segmentPointer + 2 * sizeof<f64>());
      const decimalPlaces = load<f64>(segmentPointer + 4 * sizeof<f64>());
      if (
        !(endX > startX) ||
        !isIntegerValue(decimalPlaces) ||
        decimalPlaces < -1 ||
        decimalPlaces > 15 ||
        (segmentType == 2 &&
          !(startX < load<f64>(segmentPointer + 9 * sizeof<f64>()) &&
            load<f64>(segmentPointer + 9 * sizeof<f64>()) < endX)) ||
        (segmentType == 1 &&
          (reinterpret<u64>(load<f64>(segmentPointer + 7 * sizeof<f64>())) != 0 ||
            reinterpret<u64>(load<f64>(segmentPointer + 8 * sizeof<f64>())) != 0 ||
            reinterpret<u64>(load<f64>(segmentPointer + 9 * sizeof<f64>())) != 0))
      ) trap();
    }
    segmentIndex += 1;
  }
  const evidenceRequiredTargetLength = load<u32>(
    pointer + Layout.STEP_GLITCH_PREFIX_REQUIRED_TARGET_LENGTH_OFFSET,
  );
  if (evidenceRequiredTargetLength % 3 != 0) trap();
  const evidenceRequiredTargetPointer = load<u32>(
    pointer + Layout.STEP_GLITCH_PREFIX_REQUIRED_TARGET_POINTER_OFFSET,
  );
  requireElementRange(evidenceRequiredTargetPointer, evidenceRequiredTargetLength, sizeof<f64>(), sizeof<f64>());
  validateStepGlitchTargetRecords(evidenceRequiredTargetPointer, evidenceRequiredTargetLength / 3);
}

function buildFarthestFreeX(maskPointer: u32, boundaryExpansion: u32, isMirrored: bool): u32 {
  const width = <u32>getGraphwarPlaneLength();
  const height = <u32>getGraphwarPlaneHeight();
  const cellCount = width * height;
  const outputPointer = reserveArena(cellCount * sizeof<i16>(), sizeof<i16>());
  memory.fill(outputPointer, 0xff, cellCount * sizeof<i16>());
  if (boundaryExpansion >= width || boundaryExpansion >= height) return outputPointer;

  let row: u32 = 0;
  while (row < height) {
    let farthest: i32 = -1;
    let searchX = <i32>width - 1;
    while (searchX >= 0) {
      const forwardX = <u32>searchX;
      const planeX = isMirrored ? width - 1 - forwardX : forwardX;
      const isBlocked =
        planeX < boundaryExpansion ||
        planeX >= width - boundaryExpansion ||
        row < boundaryExpansion ||
        row >= height - boundaryExpansion ||
        load<u8>(maskPointer + row * width + planeX) != 0;
      if (isBlocked) {
        farthest = -1;
      } else {
        if (farthest < 0) farthest = searchX;
        store<i16>(outputPointer + (row * width + forwardX) * sizeof<i16>(), <i16>farthest);
      }
      searchX -= 1;
    }
    row += 1;
  }
  return outputPointer;
}

/** Creates one retained geometry context; the Adapter owns the surrounding arena mark. */
export function createStepGlitchGeometryContext(inputPointer: u32, inputByteLength: u32): u32 {
  if (
    inputByteLength != Layout.STEP_GLITCH_CREATE_INPUT_BYTE_LENGTH &&
    inputByteLength != Layout.STEP_GLITCH_CREATE_LEGACY_INPUT_BYTE_LENGTH
  ) trap();
  requireArenaRange(inputPointer, inputByteLength, sizeof<u32>());
  const valuesPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_CREATE_VALUES_POINTER_OFFSET);
  const valuesLength = load<u32>(inputPointer + Layout.STEP_GLITCH_CREATE_VALUES_LENGTH_OFFSET);
  const settingsPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_CREATE_SETTINGS_POINTER_OFFSET);
  const settingsLength = load<u32>(inputPointer + Layout.STEP_GLITCH_CREATE_SETTINGS_LENGTH_OFFSET);
  const maskPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_CREATE_MASK_POINTER_OFFSET);
  const maskLength = load<u32>(inputPointer + Layout.STEP_GLITCH_CREATE_MASK_LENGTH_OFFSET);
  const sourceXPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_CREATE_SOURCE_X_POINTER_OFFSET);
  const sourceYPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_CREATE_SOURCE_Y_POINTER_OFFSET);
  const sourceCount = load<u32>(inputPointer + Layout.STEP_GLITCH_CREATE_SOURCE_COUNT_OFFSET);
  const requiredTargetPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_CREATE_REQUIRED_TARGET_POINTER_OFFSET);
  const requiredTargetLength = load<u32>(inputPointer + Layout.STEP_GLITCH_CREATE_REQUIRED_TARGET_LENGTH_OFFSET);
  const prefixEvidencePointer = load<u32>(inputPointer + Layout.STEP_GLITCH_CREATE_PREFIX_EVIDENCE_POINTER_OFFSET);
  const prefixEvidenceByteLength = load<u32>(inputPointer + Layout.STEP_GLITCH_CREATE_PREFIX_EVIDENCE_BYTE_LENGTH_OFFSET);
  const outerTaskId = inputByteLength == Layout.STEP_GLITCH_CREATE_INPUT_BYTE_LENGTH
    ? load<u32>(inputPointer + Layout.STEP_GLITCH_CREATE_OUTER_TASK_ID_OFFSET)
    : 0;
  const requestId = inputByteLength == Layout.STEP_GLITCH_CREATE_INPUT_BYTE_LENGTH
    ? load<u32>(inputPointer + Layout.STEP_GLITCH_CREATE_REQUEST_ID_OFFSET)
    : 0;
  const attemptId = inputByteLength == Layout.STEP_GLITCH_CREATE_INPUT_BYTE_LENGTH
    ? load<u32>(inputPointer + Layout.STEP_GLITCH_CREATE_ATTEMPT_ID_OFFSET)
    : 0;
  const backendGeneration = inputByteLength == Layout.STEP_GLITCH_CREATE_INPUT_BYTE_LENGTH
    ? load<u32>(inputPointer + Layout.STEP_GLITCH_CREATE_BACKEND_GENERATION_OFFSET)
    : 0;
  const sessionNonce = inputByteLength == Layout.STEP_GLITCH_CREATE_INPUT_BYTE_LENGTH
    ? load<u32>(inputPointer + Layout.STEP_GLITCH_CREATE_SESSION_NONCE_OFFSET)
    : 0;
  if (
    inputByteLength == Layout.STEP_GLITCH_CREATE_INPUT_BYTE_LENGTH &&
    load<u32>(inputPointer + Layout.STEP_GLITCH_CREATE_IDENTITY_RESERVED_OFFSET) != 0
  ) trap();
  const hasIdentity = outerTaskId != 0 || requestId != 0 || attemptId != 0 || backendGeneration != 0 || sessionNonce != 0;
  if (hasIdentity && sessionNonce == 0) trap();
  const cellCount = <u32>getGraphwarPlaneLength() * <u32>getGraphwarPlaneHeight();
  if (
    valuesLength != Layout.STEP_GLITCH_CONTEXT_VALUE_COUNT ||
    settingsLength != Layout.STEP_GLITCH_SETTINGS_VALUE_COUNT ||
    maskLength != cellCount ||
    sourceCount == 0 ||
    sourceCount > u32.MAX_VALUE / sizeof<f64>()
  ) trap();
  requireArenaRange(valuesPointer, valuesLength * sizeof<f64>(), sizeof<f64>());
  requireArenaRange(settingsPointer, settingsLength * sizeof<f64>(), sizeof<f64>());
  requireArenaRange(maskPointer, maskLength, 1);
  requireArenaRange(sourceXPointer, sourceCount * sizeof<f64>(), sizeof<f64>());
  requireArenaRange(sourceYPointer, sourceCount * sizeof<f64>(), sizeof<f64>());
  if (requiredTargetLength % 3 != 0) trap();
  requireElementRange(requiredTargetPointer, requiredTargetLength, sizeof<f64>(), sizeof<f64>());
  validateStepGlitchTargetRecords(requiredTargetPointer, requiredTargetLength / 3);
  validatePrefixEvidenceDescriptor(prefixEvidencePointer, prefixEvidenceByteLength);
  const boundaryExpansion = validateContextValues(valuesPointer);
  validateFormulaSettings(settingsPointer);
  let index: u32 = 0;
  while (index < sourceCount) {
    if (
      !isFiniteValue(load<f64>(sourceXPointer + index * sizeof<f64>())) ||
      !isFiniteValue(load<f64>(sourceYPointer + index * sizeof<f64>()))
    ) trap();
    index += 1;
  }

  const isMirrored =
    loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MIN_X_INDEX) >
    loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MAX_X_INDEX);
  const farthestFreeXPointer = buildFarthestFreeX(maskPointer, boundaryExpansion, isMirrored);
  const contextPointer = reserveArena(Layout.STEP_GLITCH_CONTEXT_BYTE_LENGTH, sizeof<f64>());
  memory.fill(contextPointer, 0, Layout.STEP_GLITCH_CONTEXT_BYTE_LENGTH);
  store<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_MAGIC_OFFSET, Layout.STEP_GLITCH_CONTEXT_MAGIC);
  store<u32>(
    contextPointer + Layout.STEP_GLITCH_CONTEXT_FLAGS_OFFSET,
    isMirrored ? Layout.STEP_GLITCH_CONTEXT_FLAG_MIRRORED : 0,
  );
  store<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_VALUES_POINTER_OFFSET, valuesPointer);
  store<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_VALUES_LENGTH_OFFSET, valuesLength);
  store<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SETTINGS_POINTER_OFFSET, settingsPointer);
  store<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SETTINGS_LENGTH_OFFSET, settingsLength);
  store<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_MASK_POINTER_OFFSET, maskPointer);
  store<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_MASK_LENGTH_OFFSET, maskLength);
  store<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_X_POINTER_OFFSET, sourceXPointer);
  store<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_Y_POINTER_OFFSET, sourceYPointer);
  store<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_COUNT_OFFSET, sourceCount);
  store<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_REQUIRED_TARGET_POINTER_OFFSET, requiredTargetPointer);
  store<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_REQUIRED_TARGET_LENGTH_OFFSET, requiredTargetLength);
  store<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_PREFIX_EVIDENCE_POINTER_OFFSET, prefixEvidencePointer);
  store<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_PREFIX_EVIDENCE_BYTE_LENGTH_OFFSET, prefixEvidenceByteLength);
  store<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_FARTHEST_FREE_X_POINTER_OFFSET, farthestFreeXPointer);
  store<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_FARTHEST_FREE_X_LENGTH_OFFSET, cellCount);
  store<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_OUTER_TASK_ID_OFFSET, outerTaskId);
  store<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_REQUEST_ID_OFFSET, requestId);
  store<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_ATTEMPT_ID_OFFSET, attemptId);
  store<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_BACKEND_GENERATION_OFFSET, backendGeneration);
  store<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SESSION_NONCE_OFFSET, sessionNonce);
  return contextPointer;
}

@inline
function searchBoundaryToGraphX(contextPointer: u32, searchBoundaryX: i32): f64 {
  const valuesPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_VALUES_POINTER_OFFSET);
  const isMirrored =
    (load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_FLAGS_OFFSET) & Layout.STEP_GLITCH_CONTEXT_FLAG_MIRRORED) !=
    0;
  const planeBoundaryX = isMirrored ? <i32>getGraphwarPlaneLength() - searchBoundaryX : searchBoundaryX;
  const minX = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MIN_X_INDEX);
  const maxX = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MAX_X_INDEX);
  const rectX = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_X_INDEX);
  const rectWidth = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_WIDTH_INDEX);
  const pixelX = rectX + (<f64>planeBoundaryX / getGraphwarPlaneLength()) * rectWidth;
  return minX + ((pixelX - rectX) / rectWidth) * (maxX - minX);
}

@inline
function graphXToSearchColumn(contextPointer: u32, graphX: f64): i32 {
  const valuesPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_VALUES_POINTER_OFFSET);
  const minX = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MIN_X_INDEX);
  const maxX = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MAX_X_INDEX);
  const rectX = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_X_INDEX);
  const rectWidth = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_WIDTH_INDEX);
  const width = <i32>getGraphwarPlaneLength();
  const pixelX = rectX + ((graphX - minX) / (maxX - minX)) * rectWidth;
  let planeX = <i32>NativeMath.floor(((pixelX - rectX) / rectWidth) * <f64>width);
  if (planeX < 0) planeX = 0;
  if (planeX >= width) planeX = width - 1;
  return (load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_FLAGS_OFFSET) &
    Layout.STEP_GLITCH_CONTEXT_FLAG_MIRRORED) == 0
    ? planeX
    : width - 1 - planeX;
}

/** Matches the scanner's direct pixel-grid projection without a graph-coordinate round trip. */
@inline
function imageXToSearchColumn(contextPointer: u32, pixelX: f64): i32 {
  const valuesPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_VALUES_POINTER_OFFSET);
  const rectX = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_X_INDEX);
  const rectWidth = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_WIDTH_INDEX);
  const width = <i32>getGraphwarPlaneLength();
  let planeX = <i32>NativeMath.floor(((pixelX - rectX) / rectWidth) * <f64>width);
  if (planeX < 0) planeX = 0;
  if (planeX >= width) planeX = width - 1;
  return (load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_FLAGS_OFFSET) &
    Layout.STEP_GLITCH_CONTEXT_FLAG_MIRRORED) == 0
    ? planeX
    : width - 1 - planeX;
}

@inline
function getFarthestFreeX(contextPointer: u32, searchX: i32, row: i32): i32 {
  const width = <i32>getGraphwarPlaneLength();
  const height = <i32>getGraphwarPlaneHeight();
  if (searchX < 0 || searchX >= width || row < 0 || row >= height) return -1;
  const indexPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_FARTHEST_FREE_X_POINTER_OFFSET);
  return <i32>load<i16>(indexPointer + <u32>(row * width + searchX) * sizeof<i16>());
}

/** Identity is optional for legacy cold scans; once present, the nonce makes the state unambiguous. */
function hasStepGlitchContextIdentity(contextPointer: u32): bool {
  const outerTaskId = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_OUTER_TASK_ID_OFFSET);
  const requestId = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_REQUEST_ID_OFFSET);
  const attemptId = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_ATTEMPT_ID_OFFSET);
  const backendGeneration = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_BACKEND_GENERATION_OFFSET);
  const sessionNonce = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SESSION_NONCE_OFFSET);
  if (load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_IDENTITY_RESERVED_OFFSET) != 0) trap();
  const hasIdentity = outerTaskId != 0 || requestId != 0 || attemptId != 0 || backendGeneration != 0 || sessionNonce != 0;
  if (hasIdentity && sessionNonce == 0) trap();
  return hasIdentity;
}

function requireStepGlitchContext(contextPointer: u32): void {
  requireArenaRange(contextPointer, Layout.STEP_GLITCH_CONTEXT_BYTE_LENGTH, sizeof<f64>());
  if (
    load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_MAGIC_OFFSET) != Layout.STEP_GLITCH_CONTEXT_MAGIC ||
    (load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_FLAGS_OFFSET) &
      ~Layout.STEP_GLITCH_CONTEXT_FLAG_MIRRORED) !=
      0 ||
    load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_FARTHEST_FREE_X_LENGTH_OFFSET) !=
      <u32>getGraphwarPlaneLength() * <u32>getGraphwarPlaneHeight()
  ) trap();
  hasStepGlitchContextIdentity(contextPointer);
  requireElementRange(
    load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_FARTHEST_FREE_X_POINTER_OFFSET),
    load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_FARTHEST_FREE_X_LENGTH_OFFSET),
    sizeof<i16>(),
    sizeof<i16>(),
  );
}

@inline
function traceRowPrecedes(leftPointer: u32, rightPointer: u32): bool {
  const leftFarthest = load<i32>(leftPointer + Layout.STEP_GLITCH_TRACE_ROW_FARTHEST_X_OFFSET);
  const rightFarthest = load<i32>(rightPointer + Layout.STEP_GLITCH_TRACE_ROW_FARTHEST_X_OFFSET);
  if (leftFarthest != rightFarthest) return leftFarthest > rightFarthest;
  const leftTargetDelta = load<i32>(leftPointer + Layout.STEP_GLITCH_TRACE_ROW_TARGET_DELTA_OFFSET);
  const rightTargetDelta = load<i32>(rightPointer + Layout.STEP_GLITCH_TRACE_ROW_TARGET_DELTA_OFFSET);
  if (leftTargetDelta != rightTargetDelta) return leftTargetDelta < rightTargetDelta;
  const leftStartDelta = load<i32>(leftPointer + Layout.STEP_GLITCH_TRACE_ROW_START_DELTA_OFFSET);
  const rightStartDelta = load<i32>(rightPointer + Layout.STEP_GLITCH_TRACE_ROW_START_DELTA_OFFSET);
  if (leftStartDelta != rightStartDelta) return leftStartDelta < rightStartDelta;
  return load<i32>(leftPointer + Layout.STEP_GLITCH_TRACE_ROW_INDEX_OFFSET) <
    load<i32>(rightPointer + Layout.STEP_GLITCH_TRACE_ROW_INDEX_OFFSET);
}

function sortTraceRows(rowPointer: u32, rowCount: u32): void {
  const temporaryPointer = reserveArena(Layout.STEP_GLITCH_TRACE_ROW_BYTE_LENGTH, sizeof<u32>());
  let index: u32 = 1;
  while (index < rowCount) {
    const source = rowPointer + index * Layout.STEP_GLITCH_TRACE_ROW_BYTE_LENGTH;
    memory.copy(temporaryPointer, source, Layout.STEP_GLITCH_TRACE_ROW_BYTE_LENGTH);
    let insertionIndex = index;
    while (insertionIndex > 0) {
      const previous = rowPointer + (insertionIndex - 1) * Layout.STEP_GLITCH_TRACE_ROW_BYTE_LENGTH;
      if (!traceRowPrecedes(temporaryPointer, previous)) break;
      memory.copy(previous + Layout.STEP_GLITCH_TRACE_ROW_BYTE_LENGTH, previous, Layout.STEP_GLITCH_TRACE_ROW_BYTE_LENGTH);
      insertionIndex -= 1;
    }
    memory.copy(
      rowPointer + insertionIndex * Layout.STEP_GLITCH_TRACE_ROW_BYTE_LENGTH,
      temporaryPointer,
      Layout.STEP_GLITCH_TRACE_ROW_BYTE_LENGTH,
    );
    index += 1;
  }
}

function writeTraceControlPoint(
  contextPointer: u32,
  formulaEndX: f64,
  nextControlX: f64,
  row: i32,
  decimalPlaces: i32,
  candidatePointer: u32,
): bool {
  const valuesPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_VALUES_POINTER_OFFSET);
  const minX = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MIN_X_INDEX);
  const maxX = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MAX_X_INDEX);
  const minY = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MIN_Y_INDEX);
  const maxY = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MAX_Y_INDEX);
  const rectX = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_X_INDEX);
  const rectY = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_Y_INDEX);
  const rectWidth = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_WIDTH_INDEX);
  const rectHeight = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_HEIGHT_INDEX);
  const rowCenterY = rectY + ((<f64>row + 0.5) / getGraphwarPlaneHeight()) * rectHeight;
  const graphY = maxY - ((rowCenterY - rectY) / rectHeight) * (maxY - minY);
  const decimalBucketMidpoint = formulaEndX + 0.5 * NativeMath.pow(10, -<f64>decimalPlaces);
  const strictIntervalMidpoint = formulaEndX + (nextControlX - formulaEndX) / 2;
  const controlPointX = decimalBucketMidpoint < strictIntervalMidpoint
    ? decimalBucketMidpoint
    : strictIntervalMidpoint;
  const pixelX = rectX + ((controlPointX - minX) / (maxX - minX)) * rectWidth;
  const pixelY = rectY + ((maxY - graphY) / (maxY - minY)) * rectHeight;
  const roundTripX = minX + ((pixelX - rectX) / rectWidth) * (maxX - minX);
  if (floorFormulaDecimal(roundTripX, decimalPlaces) != formulaEndX || roundTripX >= nextControlX) return false;
  store<f64>(candidatePointer + Layout.STEP_GLITCH_TRACE_CANDIDATE_POINT_X_OFFSET, pixelX);
  store<f64>(candidatePointer + Layout.STEP_GLITCH_TRACE_CANDIDATE_POINT_Y_OFFSET, pixelY);
  return true;
}

/** Emits one deterministic gate frontier below the Adapter-owned nested command mark. */
export function traceStepGlitchGeometryFrontier(inputPointer: u32, inputByteLength: u32): u32 {
  if (inputByteLength != Layout.STEP_GLITCH_TRACE_INPUT_BYTE_LENGTH) trap();
  requireArenaRange(inputPointer, inputByteLength, sizeof<f64>());
  const contextPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_TRACE_CONTEXT_POINTER_OFFSET);
  requireStepGlitchContext(contextPointer);
  const firstBlockedSearchX = load<i32>(inputPointer + Layout.STEP_GLITCH_TRACE_FIRST_BLOCKED_SEARCH_X_OFFSET);
  const targetRow = load<i32>(inputPointer + Layout.STEP_GLITCH_TRACE_TARGET_ROW_OFFSET);
  const stateRow = load<i32>(inputPointer + Layout.STEP_GLITCH_TRACE_STATE_ROW_OFFSET);
  const acceptedX = load<f64>(inputPointer + Layout.STEP_GLITCH_TRACE_ACCEPTED_X_OFFSET);
  const acceptedY = load<f64>(inputPointer + Layout.STEP_GLITCH_TRACE_ACCEPTED_Y_OFFSET);
  const targetX = load<f64>(inputPointer + Layout.STEP_GLITCH_TRACE_TARGET_X_OFFSET);
  const targetY = load<f64>(inputPointer + Layout.STEP_GLITCH_TRACE_TARGET_Y_OFFSET);
  const width = <i32>getGraphwarPlaneLength();
  const height = <i32>getGraphwarPlaneHeight();
  if (
    !isFiniteValue(acceptedX) ||
    !isFiniteValue(acceptedY) ||
    !isFiniteValue(targetX) ||
    !isFiniteValue(targetY) ||
    targetRow < 0 ||
    targetRow >= height ||
    stateRow < 0 ||
    stateRow >= height
  ) trap();

  const batchPointer = reserveArena(3 * Layout.STEP_GLITCH_TRACE_BATCH_BYTE_LENGTH, sizeof<u32>());
  const windowPointer = reserveArena(33 * Layout.STEP_GLITCH_TRACE_WINDOW_BYTE_LENGTH, sizeof<f64>());
  const rowPointer = reserveArena(<u32>height * Layout.STEP_GLITCH_TRACE_ROW_BYTE_LENGTH, sizeof<u32>());
  let batchCount: u32 = 0;
  let windowCount: u32 = 0;
  if (firstBlockedSearchX > 0 && firstBlockedSearchX < width) {
    const obstacleLeftX = searchBoundaryToGraphX(contextPointer, firstBlockedSearchX);
    const settingsPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SETTINGS_POINTER_OFFSET);
    const baseDecimalPlaces = <i32>loadValue(settingsPointer, Layout.STEP_GLITCH_SETTING_DECIMAL_PLACES_INDEX);
    let backoffColumns: i32 = 1;
    while (backoffColumns <= 3) {
      const searchX = firstBlockedSearchX - backoffColumns;
      if (searchX >= 0) {
        const rawLeftGateX = searchBoundaryToGraphX(contextPointer, searchX);
        let leftGateX = 0.0;
        let leftGateDecimalPlaces = -1;
        let decimalPlaces = baseDecimalPlaces;
        while (decimalPlaces <= 15) {
          const quantizedLeftGateX = -floorFormulaDecimal(-rawLeftGateX, decimalPlaces);
          if (quantizedLeftGateX < obstacleLeftX) {
            leftGateX = quantizedLeftGateX;
            leftGateDecimalPlaces = decimalPlaces;
            break;
          }
          decimalPlaces += 1;
        }
        if (leftGateDecimalPlaces >= 0) {
          const firstWindowIndex = windowCount;
          let firstWindowSearchX = -1;
          let hasSharedWindowSearchX = true;
          let previousControlX = 0.0;
          let hasPreviousControlX = false;
          let windowOrdinal: i32 = 0;
          let windowWidth = 0.01;
          while (windowOrdinal <= 10) {
            const gateDecimalPlaces = leftGateDecimalPlaces > 2 + windowOrdinal
              ? leftGateDecimalPlaces
              : 2 + windowOrdinal;
            const controlX = roundFormulaDecimal(leftGateX + windowWidth, gateDecimalPlaces);
            if (
              acceptedX < leftGateX &&
              leftGateX < controlX &&
              controlX < targetX &&
              (!hasPreviousControlX || previousControlX != controlX)
            ) {
              const window = windowPointer + windowCount * Layout.STEP_GLITCH_TRACE_WINDOW_BYTE_LENGTH;
              const windowSearchX = graphXToSearchColumn(contextPointer, controlX);
              store<f64>(window + Layout.STEP_GLITCH_TRACE_WINDOW_START_X_OFFSET, leftGateX);
              store<f64>(window + Layout.STEP_GLITCH_TRACE_WINDOW_CONTROL_X_OFFSET, controlX);
              store<i32>(window + Layout.STEP_GLITCH_TRACE_WINDOW_SEARCH_X_OFFSET, windowSearchX);
              store<i32>(window + Layout.STEP_GLITCH_TRACE_WINDOW_DECIMAL_PLACES_OFFSET, gateDecimalPlaces);
              store<i32>(window + Layout.STEP_GLITCH_TRACE_WINDOW_ORDINAL_OFFSET, windowOrdinal);
              if (firstWindowSearchX < 0) firstWindowSearchX = windowSearchX;
              if (windowSearchX != firstWindowSearchX) hasSharedWindowSearchX = false;
              previousControlX = controlX;
              hasPreviousControlX = true;
              windowCount += 1;
            }
            windowWidth /= 2;
            windowOrdinal += 1;
          }
          const currentWindowCount = windowCount - firstWindowIndex;
          if (currentWindowCount > 0) {
            const sharedWindowSearchX = hasSharedWindowSearchX ? firstWindowSearchX : -1;
            const batch = batchPointer + batchCount * Layout.STEP_GLITCH_TRACE_BATCH_BYTE_LENGTH;
            store<i32>(batch + Layout.STEP_GLITCH_TRACE_BATCH_BACKOFF_OFFSET, backoffColumns);
            store<i32>(
              batch + Layout.STEP_GLITCH_TRACE_BATCH_SEARCH_X_OFFSET,
              sharedWindowSearchX < 0
                ? searchX
                : sharedWindowSearchX < firstBlockedSearchX
                  ? sharedWindowSearchX
                  : firstBlockedSearchX,
            );
            store<i32>(batch + Layout.STEP_GLITCH_TRACE_BATCH_SHARED_SEARCH_X_OFFSET, sharedWindowSearchX);
            store<i32>(
              batch + Layout.STEP_GLITCH_TRACE_BATCH_CAN_PRUNE_OFFSET,
              sharedWindowSearchX == searchX ? 1 : 0,
            );
            store<u32>(batch + Layout.STEP_GLITCH_TRACE_BATCH_WINDOW_START_OFFSET, firstWindowIndex);
            store<u32>(batch + Layout.STEP_GLITCH_TRACE_BATCH_WINDOW_COUNT_OFFSET, currentWindowCount);
            batchCount += 1;
          }
        }
      }
      backoffColumns += 1;
    }
  }

  let rowCount: u32 = 0;
  if (batchCount > 0) {
    let row: i32 = 0;
    while (row < height) {
      const farthestX = getFarthestFreeX(contextPointer, firstBlockedSearchX, row);
      if (farthestX >= firstBlockedSearchX) {
        let usableWindowBatchMask = 0;
        const firstBatch = batchPointer;
        if (load<i32>(firstBatch + Layout.STEP_GLITCH_TRACE_BATCH_BACKOFF_OFFSET) == 1) {
          const sharedWindowSearchX = load<i32>(firstBatch + Layout.STEP_GLITCH_TRACE_BATCH_SHARED_SEARCH_X_OFFSET);
          const canUseMonotonicBackoffPruning =
            load<i32>(firstBatch + Layout.STEP_GLITCH_TRACE_BATCH_CAN_PRUNE_OFFSET) != 0;
          const batchSearchX = load<i32>(firstBatch + Layout.STEP_GLITCH_TRACE_BATCH_SEARCH_X_OFFSET);
          if (
            sharedWindowSearchX < 0 ||
            !canUseMonotonicBackoffPruning ||
            getFarthestFreeX(contextPointer, batchSearchX, row) >= firstBlockedSearchX
          ) {
            usableWindowBatchMask = 1;
          } else {
            row += 1;
            continue;
          }
        }
        const rowRecord = rowPointer + rowCount * Layout.STEP_GLITCH_TRACE_ROW_BYTE_LENGTH;
        store<i32>(rowRecord + Layout.STEP_GLITCH_TRACE_ROW_FARTHEST_X_OFFSET, farthestX);
        store<i32>(rowRecord + Layout.STEP_GLITCH_TRACE_ROW_INDEX_OFFSET, row);
        store<i32>(
          rowRecord + Layout.STEP_GLITCH_TRACE_ROW_TARGET_DELTA_OFFSET,
          row >= targetRow ? row - targetRow : targetRow - row,
        );
        store<i32>(
          rowRecord + Layout.STEP_GLITCH_TRACE_ROW_START_DELTA_OFFSET,
          row >= stateRow ? row - stateRow : stateRow - row,
        );
        store<i32>(rowRecord + Layout.STEP_GLITCH_TRACE_ROW_USABLE_BATCH_MASK_OFFSET, usableWindowBatchMask);
        rowCount += 1;
      }
      row += 1;
    }
    sortTraceRows(rowPointer, rowCount);
  }

  let candidatePointer: u32 = 0;
  let candidateCount: u32 = 0;
  let candidateCapacity: u32 = 0;
  let rowIndex: u32 = 0;
  while (rowIndex < rowCount) {
    const rowRecord = rowPointer + rowIndex * Layout.STEP_GLITCH_TRACE_ROW_BYTE_LENGTH;
    const row = load<i32>(rowRecord + Layout.STEP_GLITCH_TRACE_ROW_INDEX_OFFSET);
    let shouldSkipRow = false;
    let batchIndex: u32 = 0;
    while (batchIndex < batchCount && !shouldSkipRow) {
      const batch = batchPointer + batchIndex * Layout.STEP_GLITCH_TRACE_BATCH_BYTE_LENGTH;
      const backoffColumns = load<i32>(batch + Layout.STEP_GLITCH_TRACE_BATCH_BACKOFF_OFFSET);
      const batchBit = 1 << (backoffColumns - 1);
      let usableWindowBatchMask = load<i32>(rowRecord + Layout.STEP_GLITCH_TRACE_ROW_USABLE_BATCH_MASK_OFFSET);
      if ((usableWindowBatchMask & batchBit) == 0) {
        if (backoffColumns <= 1) {
          batchIndex += 1;
          continue;
        }
        const sharedWindowSearchX = load<i32>(batch + Layout.STEP_GLITCH_TRACE_BATCH_SHARED_SEARCH_X_OFFSET);
        const canUseMonotonicBackoffPruning =
          load<i32>(batch + Layout.STEP_GLITCH_TRACE_BATCH_CAN_PRUNE_OFFSET) != 0;
        if (
          sharedWindowSearchX >= 0 &&
          canUseMonotonicBackoffPruning &&
          getFarthestFreeX(
            contextPointer,
            load<i32>(batch + Layout.STEP_GLITCH_TRACE_BATCH_SEARCH_X_OFFSET),
            row,
          ) < firstBlockedSearchX
        ) {
          shouldSkipRow = true;
          break;
        }
        usableWindowBatchMask |= batchBit;
        store<i32>(
          rowRecord + Layout.STEP_GLITCH_TRACE_ROW_USABLE_BATCH_MASK_OFFSET,
          usableWindowBatchMask,
        );
      }

      const windowStart = load<u32>(batch + Layout.STEP_GLITCH_TRACE_BATCH_WINDOW_START_OFFSET);
      const batchWindowCount = load<u32>(batch + Layout.STEP_GLITCH_TRACE_BATCH_WINDOW_COUNT_OFFSET);
      let localWindowIndex: u32 = 0;
      while (localWindowIndex < batchWindowCount) {
        const window = windowPointer + (windowStart + localWindowIndex) * Layout.STEP_GLITCH_TRACE_WINDOW_BYTE_LENGTH;
        const windowSearchX = load<i32>(window + Layout.STEP_GLITCH_TRACE_WINDOW_SEARCH_X_OFFSET);
        const sharedWindowSearchX = load<i32>(batch + Layout.STEP_GLITCH_TRACE_BATCH_SHARED_SEARCH_X_OFFSET);
        let canReachWindow = true;
        if (sharedWindowSearchX < 0) {
          const querySearchX = windowSearchX < firstBlockedSearchX ? windowSearchX : firstBlockedSearchX;
          const requiredSearchX = windowSearchX > firstBlockedSearchX ? windowSearchX : firstBlockedSearchX;
          canReachWindow = getFarthestFreeX(contextPointer, querySearchX, row) >= requiredSearchX;
        } else {
          canReachWindow =
            load<i32>(rowRecord + Layout.STEP_GLITCH_TRACE_ROW_FARTHEST_X_OFFSET) >= windowSearchX;
        }
        if (canReachWindow) {
          if (candidateCount == candidateCapacity) {
            const nextCapacity: u32 = candidateCapacity == 0 ? 64 : candidateCapacity * 2;
            if (nextCapacity <= candidateCapacity || nextCapacity > u32.MAX_VALUE / Layout.STEP_GLITCH_TRACE_CANDIDATE_BYTE_LENGTH) {
              trap();
            }
            const nextPointer = reserveArena(
              nextCapacity * Layout.STEP_GLITCH_TRACE_CANDIDATE_BYTE_LENGTH,
              sizeof<f64>(),
            );
            if (candidateCount > 0) {
              memory.copy(
                nextPointer,
                candidatePointer,
                candidateCount * Layout.STEP_GLITCH_TRACE_CANDIDATE_BYTE_LENGTH,
              );
            }
            candidatePointer = nextPointer;
            candidateCapacity = nextCapacity;
          }
          const candidate = candidatePointer + candidateCount * Layout.STEP_GLITCH_TRACE_CANDIDATE_BYTE_LENGTH;
          memory.fill(candidate, 0, Layout.STEP_GLITCH_TRACE_CANDIDATE_BYTE_LENGTH);
          const controlX = load<f64>(window + Layout.STEP_GLITCH_TRACE_WINDOW_CONTROL_X_OFFSET);
          const decimalPlaces = load<i32>(window + Layout.STEP_GLITCH_TRACE_WINDOW_DECIMAL_PLACES_OFFSET);
          if (writeTraceControlPoint(contextPointer, controlX, targetX, row, decimalPlaces, candidate)) {
            store<i32>(candidate + Layout.STEP_GLITCH_TRACE_CANDIDATE_ROW_OFFSET, row);
            store<i32>(candidate + Layout.STEP_GLITCH_TRACE_CANDIDATE_BACKOFF_OFFSET, backoffColumns);
            store<i32>(
              candidate + Layout.STEP_GLITCH_TRACE_CANDIDATE_WINDOW_ORDINAL_OFFSET,
              load<i32>(window + Layout.STEP_GLITCH_TRACE_WINDOW_ORDINAL_OFFSET),
            );
            store<i32>(candidate + Layout.STEP_GLITCH_TRACE_CANDIDATE_DECIMAL_PLACES_OFFSET, decimalPlaces);
            store<f64>(
              candidate + Layout.STEP_GLITCH_TRACE_CANDIDATE_START_X_OFFSET,
              load<f64>(window + Layout.STEP_GLITCH_TRACE_WINDOW_START_X_OFFSET),
            );
            store<f64>(candidate + Layout.STEP_GLITCH_TRACE_CANDIDATE_CONTROL_X_OFFSET, controlX);
            store<u32>(
              candidate + Layout.STEP_GLITCH_TRACE_CANDIDATE_EXPANSION_ORDINAL_OFFSET,
              candidateCount,
            );
            candidateCount += 1;
          }
        }
        localWindowIndex += 1;
      }
      batchIndex += 1;
    }
    rowIndex += 1;
  }

  const resultPointer = reserveArena(Layout.STEP_GLITCH_TRACE_RESULT_BYTE_LENGTH, sizeof<f64>());
  memory.fill(resultPointer, 0, Layout.STEP_GLITCH_TRACE_RESULT_BYTE_LENGTH);
  store<u32>(resultPointer + Layout.STEP_GLITCH_TRACE_MAGIC_OFFSET, Layout.STEP_GLITCH_TRACE_MAGIC);
  store<u32>(resultPointer + Layout.STEP_GLITCH_TRACE_BATCH_POINTER_OFFSET, batchCount == 0 ? 0 : batchPointer);
  store<u32>(resultPointer + Layout.STEP_GLITCH_TRACE_BATCH_COUNT_OFFSET, batchCount);
  store<u32>(resultPointer + Layout.STEP_GLITCH_TRACE_WINDOW_POINTER_OFFSET, windowCount == 0 ? 0 : windowPointer);
  store<u32>(resultPointer + Layout.STEP_GLITCH_TRACE_WINDOW_COUNT_OFFSET, windowCount);
  store<u32>(resultPointer + Layout.STEP_GLITCH_TRACE_ROW_POINTER_OFFSET, rowCount == 0 ? 0 : rowPointer);
  store<u32>(resultPointer + Layout.STEP_GLITCH_TRACE_ROW_COUNT_OFFSET, rowCount);
  store<i32>(resultPointer + Layout.STEP_GLITCH_TRACE_FIRST_BLOCKED_OFFSET, firstBlockedSearchX);
  store<u32>(
    resultPointer + Layout.STEP_GLITCH_TRACE_CANDIDATE_POINTER_OFFSET,
    candidateCount == 0 ? 0 : candidatePointer,
  );
  store<u32>(resultPointer + Layout.STEP_GLITCH_TRACE_CANDIDATE_COUNT_OFFSET, candidateCount);
  return resultPointer;
}

const DFS_VECTOR_POINTER_OFFSET: u32 = 0;
const DFS_VECTOR_COUNT_OFFSET: u32 = 4;
const DFS_VECTOR_CAPACITY_OFFSET: u32 = 8;
const DFS_VECTOR_BYTE_LENGTH: u32 = 12;

const DFS_WORK_STATE: u32 = 0;
const DFS_WORK_FRONTIER: u32 = 1;
const DFS_WORK_CANDIDATE: u32 = 2;
const DFS_WORK_TYPE_OFFSET: u32 = 0;
const DFS_WORK_VALUE_A_OFFSET: u32 = 4;
const DFS_WORK_VALUE_B_OFFSET: u32 = 8;
const DFS_WORK_VALUE_C_OFFSET: u32 = 12;
const DFS_WORK_VALUE_D_OFFSET: u32 = 16;
const DFS_WORK_WINDOW_POINTER_OFFSET: u32 = 20;
const DFS_WORK_WINDOW_COUNT_OFFSET: u32 = 24;
const DFS_WORK_CONTROL_X_OFFSET: u32 = 32;
const DFS_WORK_BYTE_LENGTH: u32 = 40;

const DFS_STATE_ACCEPTED_X_OFFSET: u32 = 0;
const DFS_STATE_ACCEPTED_Y_OFFSET: u32 = 8;
const DFS_STATE_BLOCKED_FLAG_OFFSET: u32 = 16;
const DFS_STATE_ROW_OFFSET: u32 = 20;
const DFS_STATE_SEARCH_X_OFFSET: u32 = 24;
const DFS_STATE_PATH_X_POINTER_OFFSET: u32 = 28;
const DFS_STATE_PATH_Y_POINTER_OFFSET: u32 = 32;
const DFS_STATE_PATH_COUNT_OFFSET: u32 = 36;
const DFS_STATE_BLOCKED_X_OFFSET: u32 = 40;
const DFS_STATE_WINDOW_POINTER_OFFSET: u32 = 48;
const DFS_STATE_WINDOW_COUNT_OFFSET: u32 = 52;
const DFS_STATE_BYTE_LENGTH: u32 = 56;

function createDfsVector(): u32 {
  const pointer = reserveArena(DFS_VECTOR_BYTE_LENGTH, sizeof<u32>());
  memory.fill(pointer, 0, DFS_VECTOR_BYTE_LENGTH);
  return pointer;
}

function appendDfsRecord(vectorPointer: u32, recordByteLength: u32): u32 {
  const count = load<u32>(vectorPointer + DFS_VECTOR_COUNT_OFFSET);
  let capacity = load<u32>(vectorPointer + DFS_VECTOR_CAPACITY_OFFSET);
  let recordsPointer = load<u32>(vectorPointer + DFS_VECTOR_POINTER_OFFSET);
  if (count == capacity) {
    const nextCapacity: u32 = capacity == 0 ? 16 : capacity * 2;
    if (nextCapacity <= capacity || nextCapacity > u32.MAX_VALUE / recordByteLength) trap();
    const nextPointer = reserveArena(nextCapacity * recordByteLength, sizeof<f64>());
    if (count > 0) memory.copy(nextPointer, recordsPointer, count * recordByteLength);
    recordsPointer = nextPointer;
    capacity = nextCapacity;
    store<u32>(vectorPointer + DFS_VECTOR_POINTER_OFFSET, recordsPointer);
    store<u32>(vectorPointer + DFS_VECTOR_CAPACITY_OFFSET, capacity);
  }
  const recordPointer = recordsPointer + count * recordByteLength;
  memory.fill(recordPointer, 0, recordByteLength);
  store<u32>(vectorPointer + DFS_VECTOR_COUNT_OFFSET, count + 1);
  return recordPointer;
}

function pushDfsState(workPointer: u32, statePointer: u32): void {
  const itemPointer = appendDfsRecord(workPointer, DFS_WORK_BYTE_LENGTH);
  store<u32>(itemPointer + DFS_WORK_TYPE_OFFSET, DFS_WORK_STATE);
  store<u32>(itemPointer + DFS_WORK_VALUE_A_OFFSET, statePointer);
}

function pushDfsFrontier(workPointer: u32, statePointer: u32, frontierPointer: u32, candidateIndex: u32): void {
  const itemPointer = appendDfsRecord(workPointer, DFS_WORK_BYTE_LENGTH);
  store<u32>(itemPointer + DFS_WORK_TYPE_OFFSET, DFS_WORK_FRONTIER);
  store<u32>(itemPointer + DFS_WORK_VALUE_A_OFFSET, statePointer);
  store<u32>(itemPointer + DFS_WORK_VALUE_B_OFFSET, frontierPointer);
  store<u32>(itemPointer + DFS_WORK_VALUE_C_OFFSET, candidateIndex);
}

function pushDfsCandidate(
  workPointer: u32,
  kind: u32,
  pathXPointer: u32,
  pathYPointer: u32,
  pathCount: u32,
  windowPointer: u32,
  windowCount: u32,
  controlX: f64,
): void {
  const itemPointer = appendDfsRecord(workPointer, DFS_WORK_BYTE_LENGTH);
  store<u32>(itemPointer + DFS_WORK_TYPE_OFFSET, DFS_WORK_CANDIDATE);
  store<u32>(itemPointer + DFS_WORK_VALUE_A_OFFSET, kind);
  store<u32>(itemPointer + DFS_WORK_VALUE_B_OFFSET, pathXPointer);
  store<u32>(itemPointer + DFS_WORK_VALUE_C_OFFSET, pathYPointer);
  store<u32>(itemPointer + DFS_WORK_VALUE_D_OFFSET, pathCount);
  store<u32>(itemPointer + DFS_WORK_WINDOW_POINTER_OFFSET, windowPointer);
  store<u32>(itemPointer + DFS_WORK_WINDOW_COUNT_OFFSET, windowCount);
  store<f64>(itemPointer + DFS_WORK_CONTROL_X_OFFSET, controlX);
}

function appendDfsPathPoint(
  pathXPointer: u32,
  pathYPointer: u32,
  pathCount: u32,
  pointX: f64,
  pointY: f64,
): u32 {
  if (pathCount == u32.MAX_VALUE || pathCount + 1 > u32.MAX_VALUE / sizeof<f64>()) trap();
  const nextCount = pathCount + 1;
  const nextXPointer = reserveArena(nextCount * sizeof<f64>(), sizeof<f64>());
  const nextYPointer = reserveArena(nextCount * sizeof<f64>(), sizeof<f64>());
  if (pathCount > 0) {
    memory.copy(nextXPointer, pathXPointer, pathCount * sizeof<f64>());
    memory.copy(nextYPointer, pathYPointer, pathCount * sizeof<f64>());
  }
  store<f64>(nextXPointer + pathCount * sizeof<f64>(), pointX);
  store<f64>(nextYPointer + pathCount * sizeof<f64>(), pointY);
  const descriptorPointer = reserveArena(3 * sizeof<u32>(), sizeof<u32>());
  store<u32>(descriptorPointer, nextXPointer);
  store<u32>(descriptorPointer + sizeof<u32>(), nextYPointer);
  store<u32>(descriptorPointer + 2 * sizeof<u32>(), nextCount);
  return descriptorPointer;
}

function appendDfsWindow(
  windowPointer: u32,
  windowCount: u32,
  hasWindow: bool,
  startX: f64,
  endX: f64,
): u32 {
  if (windowCount == u32.MAX_VALUE || windowCount + 1 > u32.MAX_VALUE / FormulaLayout.STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH) trap();
  const nextCount = windowCount + 1;
  const nextPointer = reserveArena(
    nextCount * FormulaLayout.STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH,
    sizeof<f64>(),
  );
  if (windowCount > 0) {
    memory.copy(
      nextPointer,
      windowPointer,
      windowCount * FormulaLayout.STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH,
    );
  }
  const recordPointer = nextPointer + windowCount * FormulaLayout.STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH;
  memory.fill(recordPointer, 0, FormulaLayout.STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH);
  if (hasWindow) {
    store<u32>(recordPointer + FormulaLayout.STEP_GLITCH_FIXED_WINDOW_PRESENCE_OFFSET, 1);
    store<f64>(recordPointer + FormulaLayout.STEP_GLITCH_FIXED_WINDOW_START_X_OFFSET, startX);
    store<f64>(recordPointer + FormulaLayout.STEP_GLITCH_FIXED_WINDOW_END_X_OFFSET, endX);
  }
  const descriptorPointer = reserveArena(2 * sizeof<u32>(), sizeof<u32>());
  store<u32>(descriptorPointer, nextPointer);
  store<u32>(descriptorPointer + sizeof<u32>(), nextCount);
  return descriptorPointer;
}

function dfsPathsEqual(
  leftXPointer: u32,
  leftYPointer: u32,
  leftCount: u32,
  rightXPointer: u32,
  rightYPointer: u32,
  rightCount: u32,
): bool {
  if (leftCount != rightCount) return false;
  let index: u32 = 0;
  while (index < leftCount) {
    if (
      load<f64>(leftXPointer + index * sizeof<f64>()) != load<f64>(rightXPointer + index * sizeof<f64>()) ||
      load<f64>(leftYPointer + index * sizeof<f64>()) != load<f64>(rightYPointer + index * sizeof<f64>())
    ) return false;
    index += 1;
  }
  return true;
}

@inline
function graphYToSearchRow(contextPointer: u32, graphY: f64): i32 {
  const valuesPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_VALUES_POINTER_OFFSET);
  const minY = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MIN_Y_INDEX);
  const maxY = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MAX_Y_INDEX);
  const rectY = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_Y_INDEX);
  const rectHeight = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_HEIGHT_INDEX);
  const height = <i32>getGraphwarPlaneHeight();
  const pixelY = rectY + ((maxY - graphY) / (maxY - minY)) * rectHeight;
  let row = <i32>NativeMath.floor(((pixelY - rectY) / rectHeight) * <f64>height);
  if (row < 0) row = 0;
  if (row >= height) row = height - 1;
  return row;
}

/** Matches the scanner's direct pixel-grid projection without a graph-coordinate round trip. */
@inline
function imageYToSearchRow(contextPointer: u32, pixelY: f64): i32 {
  const valuesPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_VALUES_POINTER_OFFSET);
  const rectY = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_Y_INDEX);
  const rectHeight = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_HEIGHT_INDEX);
  const height = <i32>getGraphwarPlaneHeight();
  let row = <i32>NativeMath.floor(((pixelY - rectY) / rectHeight) * <f64>height);
  if (row < 0) row = 0;
  if (row >= height) row = height - 1;
  return row;
}

function createDfsState(
  contextPointer: u32,
  acceptedX: f64,
  acceptedY: f64,
  hasBlockedX: u32,
  blockedX: f64,
  pathXPointer: u32,
  pathYPointer: u32,
  pathCount: u32,
  windowPointer: u32,
  windowCount: u32,
): u32 {
  const statePointer = reserveArena(DFS_STATE_BYTE_LENGTH, sizeof<f64>());
  memory.fill(statePointer, 0, DFS_STATE_BYTE_LENGTH);
  store<f64>(statePointer + DFS_STATE_ACCEPTED_X_OFFSET, acceptedX);
  store<f64>(statePointer + DFS_STATE_ACCEPTED_Y_OFFSET, acceptedY);
  store<u32>(statePointer + DFS_STATE_BLOCKED_FLAG_OFFSET, hasBlockedX);
  store<i32>(statePointer + DFS_STATE_ROW_OFFSET, graphYToSearchRow(contextPointer, acceptedY));
  store<i32>(statePointer + DFS_STATE_SEARCH_X_OFFSET, graphXToSearchColumn(contextPointer, acceptedX));
  store<u32>(statePointer + DFS_STATE_PATH_X_POINTER_OFFSET, pathXPointer);
  store<u32>(statePointer + DFS_STATE_PATH_Y_POINTER_OFFSET, pathYPointer);
  store<u32>(statePointer + DFS_STATE_PATH_COUNT_OFFSET, pathCount);
  store<f64>(statePointer + DFS_STATE_BLOCKED_X_OFFSET, blockedX);
  store<u32>(statePointer + DFS_STATE_WINDOW_POINTER_OFFSET, windowPointer);
  store<u32>(statePointer + DFS_STATE_WINDOW_COUNT_OFFSET, windowCount);
  return statePointer;
}

function appendDfsTrace(
  traceVectorPointer: u32,
  kind: u32,
  replayStatus: u32,
  pathXPointer: u32,
  pathYPointer: u32,
  pathCount: u32,
  reachedTargetCount: u32,
  hasBlockedX: u32,
  acceptedX: f64,
  acceptedY: f64,
  blockedX: f64,
): void {
  const expansionOrdinal = load<u32>(traceVectorPointer + DFS_VECTOR_COUNT_OFFSET);
  const tracePointer = appendDfsRecord(traceVectorPointer, Layout.STEP_GLITCH_DFS_TRACE_BYTE_LENGTH);
  store<u32>(tracePointer + Layout.STEP_GLITCH_DFS_TRACE_KIND_OFFSET, kind);
  store<u32>(tracePointer + Layout.STEP_GLITCH_DFS_TRACE_STATUS_OFFSET, replayStatus);
  store<u32>(tracePointer + Layout.STEP_GLITCH_DFS_TRACE_PATH_X_POINTER_OFFSET, pathXPointer);
  store<u32>(tracePointer + Layout.STEP_GLITCH_DFS_TRACE_PATH_Y_POINTER_OFFSET, pathYPointer);
  store<u32>(tracePointer + Layout.STEP_GLITCH_DFS_TRACE_PATH_COUNT_OFFSET, pathCount);
  store<u32>(tracePointer + Layout.STEP_GLITCH_DFS_TRACE_REACHED_COUNT_OFFSET, reachedTargetCount);
  store<u32>(tracePointer + Layout.STEP_GLITCH_DFS_TRACE_BLOCKED_FLAG_OFFSET, hasBlockedX);
  store<u32>(tracePointer + Layout.STEP_GLITCH_DFS_TRACE_EXPANSION_ORDINAL_OFFSET, expansionOrdinal);
  store<f64>(tracePointer + Layout.STEP_GLITCH_DFS_TRACE_ACCEPTED_X_OFFSET, acceptedX);
  store<f64>(tracePointer + Layout.STEP_GLITCH_DFS_TRACE_ACCEPTED_Y_OFFSET, acceptedY);
  store<f64>(tracePointer + Layout.STEP_GLITCH_DFS_TRACE_BLOCKED_X_OFFSET, blockedX);
}

function beginRealDfsTrace(
  traceVectorPointer: u32,
  kind: u32,
  pathXPointer: u32,
  pathYPointer: u32,
  pathCount: u32,
  windowPointer: u32,
  windowCount: u32,
  windowMode: u32,
  controlX: f64,
): u32 {
  const tracePointer = appendDfsRecord(traceVectorPointer, Layout.STEP_GLITCH_REAL_DFS_TRACE_BYTE_LENGTH);
  store<u32>(tracePointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_KIND_OFFSET, kind);
  store<u32>(tracePointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_PATH_X_POINTER_OFFSET, pathXPointer);
  store<u32>(tracePointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_PATH_Y_POINTER_OFFSET, pathYPointer);
  store<u32>(tracePointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_PATH_COUNT_OFFSET, pathCount);
  store<u32>(tracePointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_WINDOW_POINTER_OFFSET, windowPointer);
  store<u32>(tracePointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_WINDOW_COUNT_OFFSET, windowCount);
  store<u32>(tracePointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_WINDOW_MODE_OFFSET, windowMode);
  store<u32>(
    tracePointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_EXPANSION_ORDINAL_OFFSET,
    load<u32>(traceVectorPointer + DFS_VECTOR_COUNT_OFFSET) - 1,
  );
  store<f64>(tracePointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_CONTROL_X_OFFSET, controlX);
  return tracePointer;
}

function finishRealDfsTrace(tracePointer: u32, replayPointer: u32): void {
  store<u32>(
    tracePointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_STATUS_OFFSET,
    load<u32>(replayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_STATUS_OFFSET),
  );
  store<i32>(
    tracePointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_LAUNCH_STATUS_OFFSET,
    load<i32>(replayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_LAUNCH_STATUS_OFFSET),
  );
  store<u32>(
    tracePointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_REACHED_ORDERED_COUNT_OFFSET,
    load<u32>(replayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REACHED_ORDERED_COUNT_OFFSET),
  );
  store<u32>(
    tracePointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_REACHED_REQUIRED_COUNT_OFFSET,
    load<u32>(replayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REACHED_REQUIRED_COUNT_OFFSET),
  );
  store<u32>(
    tracePointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_ACCEPTED_FLAG_OFFSET,
    load<u32>(replayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_FLAG_OFFSET),
  );
  store<u32>(
    tracePointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_BLOCKED_FLAG_OFFSET,
    load<u32>(replayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_FLAG_OFFSET),
  );
  memory.copy(
    tracePointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_ACCEPTED_X_OFFSET,
    replayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_X_OFFSET,
    4 * sizeof<f64>(),
  );
  memory.copy(
    tracePointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_STOP_REASON_OFFSET,
    replayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_STOP_REASON_OFFSET,
    4 * sizeof<u32>(),
  );
  memory.copy(
    tracePointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_POINT_COUNT_OFFSET,
    replayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_POINT_COUNT_OFFSET,
    6 * sizeof<u32>(),
  );
  memory.copy(
    tracePointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_CURRENT_X_OFFSET,
    replayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_CURRENT_X_OFFSET,
    6 * sizeof<f64>(),
  );
  memory.copy(
    tracePointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_SAMPLE_INDEX_OFFSET,
    replayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_SAMPLE_INDEX_OFFSET,
    2 * sizeof<u32>(),
  );
  memory.copy(
    tracePointer + Layout.STEP_GLITCH_REAL_DFS_TRACE_FINAL_RK4_COUNT_OFFSET,
    replayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_FINAL_RK4_COUNT_OFFSET,
    3 * sizeof<u32>(),
  );
}

@inline
function stepGlitchEvidenceValueMatches(left: f64, right: f64): bool {
  return reinterpret<u64>(left) == reinterpret<u64>(right);
}

/** Exact formula-prefix identity check; this never accepts trajectory state as continuation evidence. */
function tryReuseStepGlitchPrefixEvidence(
  contextPointer: u32,
  sourceWindowPointer: u32,
  sourceWindowCount: u32,
): bool {
  const evidencePointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_PREFIX_EVIDENCE_POINTER_OFFSET);
  if (load<u32>(evidencePointer + Layout.STEP_GLITCH_PREFIX_EVIDENCE_TYPE_OFFSET) != 1) return false;
  const evidenceMaskPointer = load<u32>(
    evidencePointer + Layout.STEP_GLITCH_PREFIX_EVIDENCE_IDENTITY_MASK_POINTER_OFFSET,
  );
  const evidenceMaskLength = load<u32>(
    evidencePointer + Layout.STEP_GLITCH_PREFIX_EVIDENCE_IDENTITY_MASK_LENGTH_OFFSET,
  );
  const contextMaskPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_MASK_POINTER_OFFSET);
  const contextMaskLength = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_MASK_LENGTH_OFFSET);
  if (evidenceMaskLength != contextMaskLength) return false;
  let maskIndex: u32 = 0;
  while (maskIndex < contextMaskLength) {
    if (load<u8>(evidenceMaskPointer + maskIndex) != load<u8>(contextMaskPointer + maskIndex)) return false;
    maskIndex += 1;
  }
  const valuesPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_VALUES_POINTER_OFFSET);
  const evidenceValuesPointer = load<u32>(evidencePointer + Layout.STEP_GLITCH_PREFIX_EVIDENCE_VALUES_POINTER_OFFSET);
  if (load<u32>(evidencePointer + Layout.STEP_GLITCH_PREFIX_EVIDENCE_VALUES_LENGTH_OFFSET) != 7) return false;
  if (load<f64>(evidenceValuesPointer + 6 * sizeof<f64>()) != 1) return false;
  const hasPrefixTarget = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_HAS_PREFIX_TARGET_INDEX) == 1;
  if (
    !stepGlitchEvidenceValueMatches(load<f64>(evidenceValuesPointer + 16), loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_BOUNDARY_EXPANSION_INDEX)) ||
    (hasPrefixTarget &&
      (!stepGlitchEvidenceValueMatches(load<f64>(evidenceValuesPointer + 24), loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_PREFIX_TARGET_X_INDEX)) ||
        !stepGlitchEvidenceValueMatches(load<f64>(evidenceValuesPointer + 32), loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_PREFIX_TARGET_Y_INDEX)) ||
        !stepGlitchEvidenceValueMatches(load<f64>(evidenceValuesPointer + 40), loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_PREFIX_TARGET_RADIUS_INDEX))))
  ) return false;
  const evidenceRequiredTargetPointer = load<u32>(
    evidencePointer + Layout.STEP_GLITCH_PREFIX_REQUIRED_TARGET_POINTER_OFFSET,
  );
  const evidenceRequiredTargetLength = load<u32>(
    evidencePointer + Layout.STEP_GLITCH_PREFIX_REQUIRED_TARGET_LENGTH_OFFSET,
  );
  const contextRequiredTargetPointer = load<u32>(
    contextPointer + Layout.STEP_GLITCH_CONTEXT_REQUIRED_TARGET_POINTER_OFFSET,
  );
  const contextRequiredTargetLength = load<u32>(
    contextPointer + Layout.STEP_GLITCH_CONTEXT_REQUIRED_TARGET_LENGTH_OFFSET,
  );
  if (
    hasPrefixTarget
      ? evidenceRequiredTargetLength != contextRequiredTargetLength
      : contextRequiredTargetLength != evidenceRequiredTargetLength + 3
  ) return false;
  let requiredTargetValueIndex: u32 = 0;
  while (requiredTargetValueIndex < evidenceRequiredTargetLength) {
    if (
      !stepGlitchEvidenceValueMatches(
        load<f64>(evidenceRequiredTargetPointer + requiredTargetValueIndex * sizeof<f64>()),
        load<f64>(contextRequiredTargetPointer + requiredTargetValueIndex * sizeof<f64>()),
      )
    ) return false;
    requiredTargetValueIndex += 1;
  }
  if (!hasPrefixTarget) {
    const transferredPrefixTargetPointer =
      contextRequiredTargetPointer + evidenceRequiredTargetLength * sizeof<f64>();
    if (
      !stepGlitchEvidenceValueMatches(load<f64>(evidenceValuesPointer + 24), load<f64>(transferredPrefixTargetPointer)) ||
      !stepGlitchEvidenceValueMatches(load<f64>(evidenceValuesPointer + 32), load<f64>(transferredPrefixTargetPointer + sizeof<f64>())) ||
      !stepGlitchEvidenceValueMatches(load<f64>(evidenceValuesPointer + 40), load<f64>(transferredPrefixTargetPointer + 2 * sizeof<f64>()))
    ) return false;
  }
  const prefixPointer = evidencePointer;
  if (load<u32>(prefixPointer + Layout.STEP_GLITCH_PREFIX_SETTINGS_MASK_TAG_OFFSET) != 2) return false;
  const pointCount = load<u32>(prefixPointer + Layout.STEP_GLITCH_PREFIX_POINTS_COUNT_OFFSET);
  const sourceCount = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_COUNT_OFFSET);
  if (pointCount != sourceCount || pointCount < 2) return false;
  const pointsXPointer = load<u32>(prefixPointer + Layout.STEP_GLITCH_PREFIX_POINTS_X_POINTER_OFFSET);
  const pointsYPointer = load<u32>(prefixPointer + Layout.STEP_GLITCH_PREFIX_POINTS_Y_POINTER_OFFSET);
  const sourceXPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_X_POINTER_OFFSET);
  const sourceYPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_Y_POINTER_OFFSET);
  const minX = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MIN_X_INDEX);
  const maxX = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MAX_X_INDEX);
  const minY = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MIN_Y_INDEX);
  const maxY = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MAX_Y_INDEX);
  const rectX = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_X_INDEX);
  const rectY = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_Y_INDEX);
  const rectWidth = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_WIDTH_INDEX);
  const rectHeight = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_HEIGHT_INDEX);
  const metadataPointer = load<u32>(prefixPointer + Layout.STEP_GLITCH_PREFIX_METADATA_POINTER_OFFSET);
  if (
    !stepGlitchEvidenceValueMatches(load<f64>(metadataPointer), minX) ||
    !stepGlitchEvidenceValueMatches(load<f64>(metadataPointer + sizeof<f64>()), maxX) ||
    !stepGlitchEvidenceValueMatches(load<f64>(metadataPointer + 2 * sizeof<f64>()), minY) ||
    !stepGlitchEvidenceValueMatches(load<f64>(metadataPointer + 3 * sizeof<f64>()), maxY) ||
    !stepGlitchEvidenceValueMatches(
      load<f64>(metadataPointer + 8 * sizeof<f64>()),
      <f64>sourceWindowCount,
    )
  ) return false;
  let pointIndex: u32 = 0;
  while (pointIndex < pointCount) {
    const graphX = minX + ((load<f64>(sourceXPointer + pointIndex * sizeof<f64>()) - rectX) / rectWidth) * (maxX - minX);
    const graphY = maxY - ((load<f64>(sourceYPointer + pointIndex * sizeof<f64>()) - rectY) / rectHeight) * (maxY - minY);
    if (
      !stepGlitchEvidenceValueMatches(load<f64>(pointsXPointer + pointIndex * sizeof<f64>()), graphX) ||
      !stepGlitchEvidenceValueMatches(load<f64>(pointsYPointer + pointIndex * sizeof<f64>()), graphY)
    ) return false;
    pointIndex += 1;
  }
  const metadataFlags = <u32>load<f64>(metadataPointer + 7 * sizeof<f64>());
  if (
    (metadataFlags & 2) == 0 ||
    !stepGlitchEvidenceValueMatches(load<f64>(metadataPointer + 5 * sizeof<f64>()), load<f64>(pointsXPointer)) ||
    !stepGlitchEvidenceValueMatches(load<f64>(metadataPointer + 6 * sizeof<f64>()), load<f64>(pointsYPointer))
  ) return false;
  if (load<f64>(evidenceValuesPointer) < load<f64>(pointsXPointer + (pointCount - 1) * sizeof<f64>())) {
    return false;
  }
  const settingsPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SETTINGS_POINTER_OFFSET);
  const evidenceSettingsPointer = load<u32>(prefixPointer + Layout.STEP_GLITCH_PREFIX_SETTINGS_POINTER_OFFSET);
  let settingIndex: u32 = 0;
  while (settingIndex < Layout.STEP_GLITCH_SETTINGS_VALUE_COUNT) {
    if (!stepGlitchEvidenceValueMatches(load<f64>(evidenceSettingsPointer + settingIndex * sizeof<f64>()), load<f64>(settingsPointer + settingIndex * sizeof<f64>()))) return false;
    settingIndex += 1;
  }
  if (load<u32>(prefixPointer + Layout.STEP_GLITCH_PREFIX_SEGMENTS_LENGTH_OFFSET) != sourceWindowCount * 10) return false;
  if (load<u32>(prefixPointer + Layout.STEP_GLITCH_PREFIX_REQUIREMENTS_LENGTH_OFFSET) != sourceWindowCount) return false;
  const requirementsPointer = load<u32>(prefixPointer + Layout.STEP_GLITCH_PREFIX_REQUIREMENTS_POINTER_OFFSET);
  const segmentsPointer = load<u32>(prefixPointer + Layout.STEP_GLITCH_PREFIX_SEGMENTS_POINTER_OFFSET);
  let segmentIndex: u32 = 0;
  while (segmentIndex < sourceWindowCount) {
    const recordPointer = segmentsPointer + segmentIndex * 10 * sizeof<f64>();
    const isRequired = load<u8>(requirementsPointer + segmentIndex) != 0;
    const recordType = load<f64>(recordPointer);
    if (isRequired && recordType == 0) return false;
    if (recordType != 0) {
      const startX = load<f64>(recordPointer + sizeof<f64>());
      const endX = load<f64>(recordPointer + 2 * sizeof<f64>());
      if (!(endX > startX)) return false;
    }
    segmentIndex += 1;
  }
  segmentIndex = 0;
  while (segmentIndex < sourceWindowCount) {
    const recordPointer = segmentsPointer + segmentIndex * 10 * sizeof<f64>();
    if (load<f64>(recordPointer) != 0) {
      const windowPointer = sourceWindowPointer + segmentIndex * FormulaLayout.STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH;
      store<u32>(windowPointer + FormulaLayout.STEP_GLITCH_FIXED_WINDOW_PRESENCE_OFFSET, 1);
      store<f64>(
        windowPointer + FormulaLayout.STEP_GLITCH_FIXED_WINDOW_START_X_OFFSET,
        load<f64>(recordPointer + sizeof<f64>()),
      );
      store<f64>(
        windowPointer + FormulaLayout.STEP_GLITCH_FIXED_WINDOW_END_X_OFFSET,
        load<f64>(recordPointer + 2 * sizeof<f64>()),
      );
    }
    segmentIndex += 1;
  }
  return true;
}

function createRealDfsResult(
  status: u32,
  expandedStates: u32,
  bestReachedTargetCount: u32,
  hasBlockedX: u32,
  blockedX: f64,
  prefixPreparationSource: u32,
  traceVectorPointer: u32,
): u32 {
  const resultPointer = reserveArena(Layout.STEP_GLITCH_REAL_DFS_RESULT_BYTE_LENGTH, sizeof<f64>());
  memory.fill(resultPointer, 0, Layout.STEP_GLITCH_REAL_DFS_RESULT_BYTE_LENGTH);
  store<u32>(resultPointer + Layout.STEP_GLITCH_REAL_DFS_RESULT_MAGIC_OFFSET, Layout.STEP_GLITCH_REAL_DFS_RESULT_MAGIC);
  store<u32>(resultPointer + Layout.STEP_GLITCH_REAL_DFS_RESULT_STATUS_OFFSET, status);
  store<u32>(resultPointer + Layout.STEP_GLITCH_REAL_DFS_RESULT_EXPANDED_STATES_OFFSET, expandedStates);
  store<u32>(resultPointer + Layout.STEP_GLITCH_REAL_DFS_RESULT_BEST_REACHED_COUNT_OFFSET, bestReachedTargetCount);
  store<u32>(resultPointer + Layout.STEP_GLITCH_REAL_DFS_RESULT_BLOCKED_FLAG_OFFSET, hasBlockedX);
  store<u32>(resultPointer + Layout.STEP_GLITCH_REAL_DFS_RESULT_RESERVED_OFFSET, prefixPreparationSource);
  store<u32>(resultPointer + Layout.STEP_GLITCH_REAL_DFS_RESULT_TRACE_POINTER_OFFSET, load<u32>(traceVectorPointer));
  store<u32>(
    resultPointer + Layout.STEP_GLITCH_REAL_DFS_RESULT_TRACE_COUNT_OFFSET,
    load<u32>(traceVectorPointer + DFS_VECTOR_COUNT_OFFSET),
  );
  store<f64>(resultPointer + Layout.STEP_GLITCH_REAL_DFS_RESULT_BLOCKED_X_OFFSET, blockedX);
  return resultPointer;
}

function createDfsResult(
  status: u32,
  expandedStates: u32,
  bestReachedTargetCount: u32,
  hasBlockedX: u32,
  blockedX: f64,
  scriptConsumed: u32,
  traceVectorPointer: u32,
): u32 {
  const resultPointer = reserveArena(Layout.STEP_GLITCH_DFS_RESULT_BYTE_LENGTH, sizeof<f64>());
  memory.fill(resultPointer, 0, Layout.STEP_GLITCH_DFS_RESULT_BYTE_LENGTH);
  store<u32>(resultPointer + Layout.STEP_GLITCH_DFS_RESULT_MAGIC_OFFSET, Layout.STEP_GLITCH_DFS_RESULT_MAGIC);
  store<u32>(resultPointer + Layout.STEP_GLITCH_DFS_RESULT_STATUS_OFFSET, status);
  store<u32>(resultPointer + Layout.STEP_GLITCH_DFS_RESULT_EXPANDED_STATES_OFFSET, expandedStates);
  store<u32>(resultPointer + Layout.STEP_GLITCH_DFS_RESULT_BEST_REACHED_COUNT_OFFSET, bestReachedTargetCount);
  store<u32>(resultPointer + Layout.STEP_GLITCH_DFS_RESULT_BLOCKED_FLAG_OFFSET, hasBlockedX);
  store<u32>(resultPointer + Layout.STEP_GLITCH_DFS_RESULT_SCRIPT_CONSUMED_OFFSET, scriptConsumed);
  store<u32>(resultPointer + Layout.STEP_GLITCH_DFS_RESULT_TRACE_POINTER_OFFSET, load<u32>(traceVectorPointer));
  store<u32>(
    resultPointer + Layout.STEP_GLITCH_DFS_RESULT_TRACE_COUNT_OFFSET,
    load<u32>(traceVectorPointer + DFS_VECTOR_COUNT_OFFSET),
  );
  store<f64>(resultPointer + Layout.STEP_GLITCH_DFS_RESULT_BLOCKED_X_OFFSET, blockedX);
  return resultPointer;
}

/** Replays the scanner's exact iterative DFS against one atomic test script. */
export function traceStepGlitchGeometryDfs(inputPointer: u32, inputByteLength: u32): u32 {
  return runStepGlitchGeometryDfs(inputPointer, inputByteLength);
}

/** Builds the internal DFS descriptor for one real target scan. */
export function traceStepGlitchRealDfsForTest(inputPointer: u32, inputByteLength: u32): u32 {
  if (inputByteLength != Layout.STEP_GLITCH_REAL_DFS_INPUT_BYTE_LENGTH) trap();
  requireArenaRange(inputPointer, inputByteLength, sizeof<u32>());
  const contextPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_REAL_DFS_INPUT_CONTEXT_POINTER_OFFSET);
  requireStepGlitchContext(contextPointer);
  const targetValuesPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_REAL_DFS_INPUT_TARGET_VALUES_POINTER_OFFSET);
  const targetValuesLength = load<u32>(inputPointer + Layout.STEP_GLITCH_REAL_DFS_INPUT_TARGET_VALUES_LENGTH_OFFSET);
  if (
    targetValuesLength != Layout.STEP_GLITCH_REAL_DFS_INPUT_TARGET_VALUE_COUNT ||
    load<u32>(inputPointer + Layout.STEP_GLITCH_REAL_DFS_INPUT_RESERVED_OFFSET) != 0
  ) trap();
  requireElementRange(targetValuesPointer, targetValuesLength, sizeof<f64>(), sizeof<f64>());
  let valueIndex: u32 = 0;
  while (valueIndex < targetValuesLength) {
    if (!isFiniteValue(load<f64>(targetValuesPointer + valueIndex * sizeof<f64>()))) trap();
    valueIndex += 1;
  }
  const valuesPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_VALUES_POINTER_OFFSET);
  const targetPointX = load<f64>(targetValuesPointer + 3 * sizeof<f64>());
  const targetPointY = load<f64>(targetValuesPointer + 4 * sizeof<f64>());
  const minX = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MIN_X_INDEX);
  const maxX = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MAX_X_INDEX);
  const minY = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MIN_Y_INDEX);
  const maxY = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MAX_Y_INDEX);
  const rectX = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_X_INDEX);
  const rectY = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_Y_INDEX);
  const rectWidth = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_WIDTH_INDEX);
  const rectHeight = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_HEIGHT_INDEX);
  const targetGraphX = minX + ((targetPointX - rectX) / rectWidth) * (maxX - minX);
  const targetGraphY = maxY - ((targetPointY - rectY) / rectHeight) * (maxY - minY);
  const hitTargetRow = imageYToSearchRow(contextPointer, load<f64>(targetValuesPointer + sizeof<f64>()));
  const targetSearchX = imageXToSearchColumn(contextPointer, targetPointX);
  const descriptorPointer = reserveArena(Layout.STEP_GLITCH_DFS_INPUT_BYTE_LENGTH, sizeof<f64>());
  memory.fill(descriptorPointer, 0, Layout.STEP_GLITCH_DFS_INPUT_BYTE_LENGTH);
  store<u32>(descriptorPointer + Layout.STEP_GLITCH_DFS_INPUT_CONTEXT_POINTER_OFFSET, contextPointer);
  store<u32>(descriptorPointer + Layout.STEP_GLITCH_DFS_INPUT_MODE_OFFSET, Layout.STEP_GLITCH_DFS_MODE_REAL);
  store<u32>(descriptorPointer + Layout.STEP_GLITCH_DFS_INPUT_SCRIPT_POINTER_OFFSET, targetValuesPointer);
  store<u32>(descriptorPointer + Layout.STEP_GLITCH_DFS_INPUT_SCRIPT_COUNT_OFFSET, targetValuesLength);
  store<f64>(descriptorPointer + Layout.STEP_GLITCH_DFS_INPUT_TARGET_X_OFFSET, targetGraphX);
  store<f64>(descriptorPointer + Layout.STEP_GLITCH_DFS_INPUT_TARGET_Y_OFFSET, targetGraphY);
  store<f64>(descriptorPointer + Layout.STEP_GLITCH_DFS_INPUT_TARGET_POINT_X_OFFSET, targetPointX);
  store<f64>(descriptorPointer + Layout.STEP_GLITCH_DFS_INPUT_TARGET_POINT_Y_OFFSET, targetPointY);
  store<i32>(descriptorPointer + Layout.STEP_GLITCH_DFS_INPUT_HIT_TARGET_ROW_OFFSET, hitTargetRow);
  store<i32>(descriptorPointer + Layout.STEP_GLITCH_DFS_INPUT_TARGET_SEARCH_X_OFFSET, targetSearchX);
  return runStepGlitchGeometryDfs(descriptorPointer, Layout.STEP_GLITCH_DFS_INPUT_BYTE_LENGTH);
}

function runStepGlitchGeometryDfs(inputPointer: u32, inputByteLength: u32): u32 {
  if (inputByteLength != Layout.STEP_GLITCH_DFS_INPUT_BYTE_LENGTH) trap();
  requireArenaRange(inputPointer, inputByteLength, sizeof<f64>());
  const contextPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_DFS_INPUT_CONTEXT_POINTER_OFFSET);
  requireStepGlitchContext(contextPointer);
  const mode = load<u32>(inputPointer + Layout.STEP_GLITCH_DFS_INPUT_MODE_OFFSET);
  const scriptPointer = load<u32>(inputPointer + Layout.STEP_GLITCH_DFS_INPUT_SCRIPT_POINTER_OFFSET);
  const scriptCount = load<u32>(inputPointer + Layout.STEP_GLITCH_DFS_INPUT_SCRIPT_COUNT_OFFSET);
  let prefixAcceptedX = load<f64>(inputPointer + Layout.STEP_GLITCH_DFS_INPUT_PREFIX_ACCEPTED_X_OFFSET);
  let prefixAcceptedY = load<f64>(inputPointer + Layout.STEP_GLITCH_DFS_INPUT_PREFIX_ACCEPTED_Y_OFFSET);
  const targetX = load<f64>(inputPointer + Layout.STEP_GLITCH_DFS_INPUT_TARGET_X_OFFSET);
  const targetY = load<f64>(inputPointer + Layout.STEP_GLITCH_DFS_INPUT_TARGET_Y_OFFSET);
  const targetPointX = load<f64>(inputPointer + Layout.STEP_GLITCH_DFS_INPUT_TARGET_POINT_X_OFFSET);
  const targetPointY = load<f64>(inputPointer + Layout.STEP_GLITCH_DFS_INPUT_TARGET_POINT_Y_OFFSET);
  const hitTargetRow = load<i32>(inputPointer + Layout.STEP_GLITCH_DFS_INPUT_HIT_TARGET_ROW_OFFSET);
  const targetSearchX = load<i32>(inputPointer + Layout.STEP_GLITCH_DFS_INPUT_TARGET_SEARCH_X_OFFSET);
  let prefixReachedTargetCount = load<u32>(
    inputPointer + Layout.STEP_GLITCH_DFS_INPUT_PREFIX_REACHED_COUNT_OFFSET,
  );
  const hasPrefixBlockedX = load<u32>(inputPointer + Layout.STEP_GLITCH_DFS_INPUT_PREFIX_BLOCKED_FLAG_OFFSET);
  const prefixBlockedX = load<f64>(inputPointer + Layout.STEP_GLITCH_DFS_INPUT_PREFIX_BLOCKED_X_OFFSET);
  const width = <i32>getGraphwarPlaneLength();
  const height = <i32>getGraphwarPlaneHeight();
  if (
    (mode != Layout.STEP_GLITCH_DFS_MODE_ALL_MISS &&
      mode != Layout.STEP_GLITCH_DFS_MODE_SCRIPTED &&
      mode != Layout.STEP_GLITCH_DFS_MODE_REAL) ||
    (mode == Layout.STEP_GLITCH_DFS_MODE_ALL_MISS && (scriptPointer != 0 || scriptCount != 0)) ||
    (mode == Layout.STEP_GLITCH_DFS_MODE_SCRIPTED && scriptCount == 0) ||
    (mode == Layout.STEP_GLITCH_DFS_MODE_REAL &&
      (scriptCount != Layout.STEP_GLITCH_REAL_DFS_INPUT_TARGET_VALUE_COUNT ||
        prefixAcceptedX != 0 ||
        prefixAcceptedY != 0 ||
        prefixReachedTargetCount != 0 ||
        hasPrefixBlockedX != 0 ||
        prefixBlockedX != 0)) ||
    (mode != Layout.STEP_GLITCH_DFS_MODE_REAL &&
      (!isFiniteValue(prefixAcceptedX) || !isFiniteValue(prefixAcceptedY))) ||
    !isFiniteValue(targetX) ||
    !isFiniteValue(targetY) ||
    !isFiniteValue(targetPointX) ||
    !isFiniteValue(targetPointY) ||
    hitTargetRow < 0 ||
    hitTargetRow >= height ||
    targetSearchX < 0 ||
    targetSearchX >= width ||
    hasPrefixBlockedX > 1 ||
    (hasPrefixBlockedX == 0 ? prefixBlockedX != 0 : !isFiniteValue(prefixBlockedX))
  ) trap();
  if (mode == Layout.STEP_GLITCH_DFS_MODE_SCRIPTED) {
    requireElementRange(
      scriptPointer,
      scriptCount,
      Layout.STEP_GLITCH_DFS_SCRIPT_BYTE_LENGTH,
      sizeof<f64>(),
    );
    let scriptIndex: u32 = 0;
    while (scriptIndex < scriptCount) {
      const outcomePointer = scriptPointer + scriptIndex * Layout.STEP_GLITCH_DFS_SCRIPT_BYTE_LENGTH;
      const replayStatus = load<u32>(outcomePointer + Layout.STEP_GLITCH_DFS_SCRIPT_STATUS_OFFSET);
      const hasBlockedX = load<u32>(outcomePointer + Layout.STEP_GLITCH_DFS_SCRIPT_BLOCKED_FLAG_OFFSET);
      const acceptedX = load<f64>(outcomePointer + Layout.STEP_GLITCH_DFS_SCRIPT_ACCEPTED_X_OFFSET);
      const acceptedY = load<f64>(outcomePointer + Layout.STEP_GLITCH_DFS_SCRIPT_ACCEPTED_Y_OFFSET);
      const blockedX = load<f64>(outcomePointer + Layout.STEP_GLITCH_DFS_SCRIPT_BLOCKED_X_OFFSET);
      if (
        replayStatus > Layout.STEP_GLITCH_DFS_REPLAY_HIT ||
        hasBlockedX > 1 ||
        load<u32>(outcomePointer + Layout.STEP_GLITCH_DFS_SCRIPT_RESERVED_OFFSET) != 0 ||
        (replayStatus == Layout.STEP_GLITCH_DFS_REPLAY_HIT
          ? !isFiniteValue(acceptedX) || !isFiniteValue(acceptedY)
          : acceptedX != 0 || acceptedY != 0) ||
        (hasBlockedX == 0 ? blockedX != 0 : !isFiniteValue(blockedX))
      ) trap();
      scriptIndex += 1;
    }
  } else if (mode == Layout.STEP_GLITCH_DFS_MODE_REAL) {
    requireElementRange(scriptPointer, scriptCount, sizeof<f64>(), sizeof<f64>());
    let targetValueIndex: u32 = 0;
    while (targetValueIndex < scriptCount) {
      if (!isFiniteValue(load<f64>(scriptPointer + targetValueIndex * sizeof<f64>()))) trap();
      targetValueIndex += 1;
    }
    if (load<f64>(scriptPointer + 2 * sizeof<f64>()) < 0) trap();
  }

  const sourceXPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_X_POINTER_OFFSET);
  const sourceYPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_Y_POINTER_OFFSET);
  const sourceCount = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_SOURCE_COUNT_OFFSET);
  const sourceWindowCount = sourceCount - 1;
  const sourceWindowPointer = sourceWindowCount == 0
    ? 0
    : reserveArena(
        sourceWindowCount * FormulaLayout.STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH,
        sizeof<f64>(),
      );
  if (sourceWindowCount > 0) {
    memory.fill(
      sourceWindowPointer,
      0,
      sourceWindowCount * FormulaLayout.STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH,
    );
  }
  let prefixPreparationSource = Layout.STEP_GLITCH_REAL_DFS_PREFIX_PREPARATION_NONE;
  let targetRecordPointer: u32 = 0;
  let orderedTargetCount: u32 = 0;
  if (mode == Layout.STEP_GLITCH_DFS_MODE_REAL) {
    targetRecordPointer = scriptPointer;
    const requiredTargetPointer = load<u32>(
      contextPointer + Layout.STEP_GLITCH_CONTEXT_REQUIRED_TARGET_POINTER_OFFSET,
    );
    const requiredTargetValueCount = load<u32>(
      contextPointer + Layout.STEP_GLITCH_CONTEXT_REQUIRED_TARGET_LENGTH_OFFSET,
    );
    let isRequiredTarget = false;
    let requiredTargetIndex: u32 = 0;
    while (requiredTargetIndex < requiredTargetValueCount / 3) {
      const recordPointer = requiredTargetPointer + requiredTargetIndex * 3 * sizeof<f64>();
      if (
        load<f64>(recordPointer) == load<f64>(targetRecordPointer) &&
        load<f64>(recordPointer + sizeof<f64>()) == load<f64>(targetRecordPointer + sizeof<f64>()) &&
        load<f64>(recordPointer + 2 * sizeof<f64>()) == load<f64>(targetRecordPointer + 2 * sizeof<f64>())
      ) {
        isRequiredTarget = true;
        break;
      }
      requiredTargetIndex += 1;
    }
    orderedTargetCount = isRequiredTarget ? 0 : 1;
  }
  const directPathDescriptor = appendDfsPathPoint(
    sourceXPointer,
    sourceYPointer,
    sourceCount,
    targetPointX,
    targetPointY,
  );
  const directPathXPointer = load<u32>(directPathDescriptor);
  const directPathYPointer = load<u32>(directPathDescriptor + sizeof<u32>());
  const directPathCount = load<u32>(directPathDescriptor + 2 * sizeof<u32>());
  const traceVectorPointer = createDfsVector();
  const realTraceVectorPointer = mode == Layout.STEP_GLITCH_DFS_MODE_REAL ? createDfsVector() : 0;
  let scriptConsumed: u32 = 0;
  let directStatus = Layout.STEP_GLITCH_DFS_REPLAY_MISS;
  let directReachedTargetCount: u32 = 0;
  let hasDirectBlockedX: u32 = 0;
  let directAcceptedX = 0.0;
  let directAcceptedY = 0.0;
  let directBlockedX = 0.0;
  let directReplayPointer: u32 = 0;
  if (mode == Layout.STEP_GLITCH_DFS_MODE_SCRIPTED) {
    const directOutcomePointer = scriptPointer;
    directStatus = load<u32>(directOutcomePointer + Layout.STEP_GLITCH_DFS_SCRIPT_STATUS_OFFSET);
    directReachedTargetCount = load<u32>(
      directOutcomePointer + Layout.STEP_GLITCH_DFS_SCRIPT_REACHED_COUNT_OFFSET,
    );
    hasDirectBlockedX = load<u32>(directOutcomePointer + Layout.STEP_GLITCH_DFS_SCRIPT_BLOCKED_FLAG_OFFSET);
    directAcceptedX = load<f64>(directOutcomePointer + Layout.STEP_GLITCH_DFS_SCRIPT_ACCEPTED_X_OFFSET);
    directAcceptedY = load<f64>(directOutcomePointer + Layout.STEP_GLITCH_DFS_SCRIPT_ACCEPTED_Y_OFFSET);
    directBlockedX = load<f64>(directOutcomePointer + Layout.STEP_GLITCH_DFS_SCRIPT_BLOCKED_X_OFFSET);
    scriptConsumed = 1;
  } else if (mode == Layout.STEP_GLITCH_DFS_MODE_REAL) {
    const directTracePointer = beginRealDfsTrace(
      realTraceVectorPointer,
      Layout.STEP_GLITCH_REAL_DFS_CANDIDATE_DIRECT,
      directPathXPointer,
      directPathYPointer,
      directPathCount,
      0,
      0,
      Layout.STEP_GLITCH_FORMULA_WINDOW_MODE_AUTOMATIC,
      targetX,
    );
    const replayMark = markArena();
    directReplayPointer = replayStepGlitchCandidate(
      contextPointer,
      directPathXPointer,
      directPathYPointer,
      directPathCount,
      0,
      0,
      Layout.STEP_GLITCH_FORMULA_WINDOW_MODE_AUTOMATIC,
      targetRecordPointer,
      orderedTargetCount,
      targetX,
    );
    directStatus = load<u32>(directReplayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_STATUS_OFFSET);
    directReachedTargetCount =
      load<u32>(directReplayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REACHED_ORDERED_COUNT_OFFSET) +
      load<u32>(directReplayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REACHED_REQUIRED_COUNT_OFFSET);
    hasDirectBlockedX = load<u32>(directReplayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_FLAG_OFFSET);
    directAcceptedX = load<f64>(directReplayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_X_OFFSET);
    directAcceptedY = load<f64>(directReplayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_Y_OFFSET);
    directBlockedX = load<f64>(directReplayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_X_OFFSET);
    finishRealDfsTrace(directTracePointer, directReplayPointer);
    resetArena(replayMark);
  }
  if (mode != Layout.STEP_GLITCH_DFS_MODE_REAL) {
    appendDfsTrace(
      traceVectorPointer,
      Layout.STEP_GLITCH_DFS_CANDIDATE_DIRECT,
      directStatus,
      directPathXPointer,
      directPathYPointer,
      directPathCount,
      directReachedTargetCount,
      hasDirectBlockedX,
      directAcceptedX,
      directAcceptedY,
      directBlockedX,
    );
  }
  let expandedStates: u32 = 1;
  let bestReachedTargetCount = prefixReachedTargetCount > directReachedTargetCount
    ? prefixReachedTargetCount
    : directReachedTargetCount;
  let hasBlockedX = hasDirectBlockedX != 0 ? hasDirectBlockedX : hasPrefixBlockedX;
  let blockedX = hasDirectBlockedX != 0 ? directBlockedX : prefixBlockedX;
  if (directStatus == Layout.STEP_GLITCH_DFS_REPLAY_HIT) {
    if (mode == Layout.STEP_GLITCH_DFS_MODE_REAL) {
      return createRealDfsResult(
        Layout.STEP_GLITCH_REAL_DFS_RESULT_HIT,
        expandedStates,
        bestReachedTargetCount,
        hasBlockedX,
        blockedX,
        prefixPreparationSource,
        realTraceVectorPointer,
      );
    }
    if (mode == Layout.STEP_GLITCH_DFS_MODE_SCRIPTED && scriptConsumed != scriptCount) trap();
    return createDfsResult(
      Layout.STEP_GLITCH_DFS_RESULT_HIT,
      expandedStates,
      bestReachedTargetCount,
      hasBlockedX,
      blockedX,
      scriptConsumed,
      traceVectorPointer,
    );
  }

  if (mode == Layout.STEP_GLITCH_DFS_MODE_REAL) {
    const valuesPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_VALUES_POINTER_OFFSET);
    const hasPrefixTarget = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_HAS_PREFIX_TARGET_INDEX) != 0;
    const prefixTargetPointer = hasPrefixTarget ? reserveArena(3 * sizeof<f64>(), sizeof<f64>()) : 0;
    if (hasPrefixTarget) {
      store<f64>(prefixTargetPointer, loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_PREFIX_TARGET_X_INDEX));
      store<f64>(prefixTargetPointer + sizeof<f64>(), loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_PREFIX_TARGET_Y_INDEX));
      store<f64>(prefixTargetPointer + 2 * sizeof<f64>(), loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_PREFIX_TARGET_RADIUS_INDEX));
    }
    const prefixTargetCount: u32 = hasPrefixTarget ? 1 : 0;
    const lastSourceIndex = sourceCount - 1;
    const lastSourcePixelX = load<f64>(sourceXPointer + lastSourceIndex * sizeof<f64>());
    const lastSourcePixelY = load<f64>(sourceYPointer + lastSourceIndex * sizeof<f64>());
    const prefixControlX = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MIN_X_INDEX) +
      ((lastSourcePixelX - loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_X_INDEX)) /
        loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_WIDTH_INDEX)) *
        (loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MAX_X_INDEX) -
          loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MIN_X_INDEX));
    const shouldReplayPrefix = sourceCount > 1 || prefixTargetCount != 0 ||
      load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_REQUIRED_TARGET_LENGTH_OFFSET) != 0;
    if (shouldReplayPrefix) {
      if (sourceCount == 1) {
        return createRealDfsResult(
          Layout.STEP_GLITCH_REAL_DFS_RESULT_NO_PATH,
          expandedStates,
          bestReachedTargetCount,
          hasBlockedX,
          blockedX,
          prefixPreparationSource,
          realTraceVectorPointer,
        );
      }
      const hasReusablePrefixEvidence = tryReuseStepGlitchPrefixEvidence(
        contextPointer,
        sourceWindowPointer,
        sourceWindowCount,
      );
      if (hasReusablePrefixEvidence) {
        const evidencePointer = load<u32>(
          contextPointer + Layout.STEP_GLITCH_CONTEXT_PREFIX_EVIDENCE_POINTER_OFFSET,
        );
        const evidenceValuesPointer = load<u32>(
          evidencePointer + Layout.STEP_GLITCH_PREFIX_EVIDENCE_VALUES_POINTER_OFFSET,
        );
        prefixAcceptedX = load<f64>(evidenceValuesPointer);
        prefixAcceptedY = load<f64>(evidenceValuesPointer + sizeof<f64>());
        prefixReachedTargetCount = prefixTargetCount +
          load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_REQUIRED_TARGET_LENGTH_OFFSET) / 3;
        if (prefixReachedTargetCount > bestReachedTargetCount) {
          bestReachedTargetCount = prefixReachedTargetCount;
        }
        prefixPreparationSource = Layout.STEP_GLITCH_REAL_DFS_PREFIX_PREPARATION_EVIDENCE;
      } else {
        prefixPreparationSource = Layout.STEP_GLITCH_REAL_DFS_PREFIX_PREPARATION_COLD;
        const prefixTracePointer = beginRealDfsTrace(
        realTraceVectorPointer,
        Layout.STEP_GLITCH_REAL_DFS_CANDIDATE_PREFIX,
        sourceXPointer,
        sourceYPointer,
        sourceCount,
        0,
        0,
        Layout.STEP_GLITCH_FORMULA_WINDOW_MODE_AUTOMATIC,
        prefixControlX,
      );
        const replayMark = markArena();
        const prefixReplayPointer = replayStepGlitchCandidate(
        contextPointer,
        sourceXPointer,
        sourceYPointer,
        sourceCount,
        0,
        0,
        Layout.STEP_GLITCH_FORMULA_WINDOW_MODE_AUTOMATIC,
        prefixTargetPointer,
        prefixTargetCount,
        prefixControlX,
      );
        const prefixStatus = load<u32>(prefixReplayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_STATUS_OFFSET);
        const prefixReached =
        load<u32>(prefixReplayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REACHED_ORDERED_COUNT_OFFSET) +
        load<u32>(prefixReplayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REACHED_REQUIRED_COUNT_OFFSET);
        if (prefixReached > bestReachedTargetCount) bestReachedTargetCount = prefixReached;
        if (hasBlockedX == 0 && load<u32>(prefixReplayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_FLAG_OFFSET) != 0) {
          hasBlockedX = 1;
          blockedX = load<f64>(prefixReplayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_X_OFFSET);
        }
        const prefixAcceptedReplayX = load<f64>(
        prefixReplayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_X_OFFSET,
      );
        const prefixAcceptedReplayY = load<f64>(
        prefixReplayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_Y_OFFSET,
      );
        finishRealDfsTrace(prefixTracePointer, prefixReplayPointer);
        resetArena(replayMark);
        if (prefixStatus != Layout.STEP_GLITCH_REPLAY_RESULT_STATUS_HIT) {
          return createRealDfsResult(
          Layout.STEP_GLITCH_REAL_DFS_RESULT_NO_PATH,
          expandedStates,
          bestReachedTargetCount,
          hasBlockedX,
          blockedX,
          prefixPreparationSource,
          realTraceVectorPointer,
        );
        }
        prefixAcceptedX = prefixAcceptedReplayX;
        prefixAcceptedY = prefixAcceptedReplayY;
        prefixReachedTargetCount = prefixReached;
      }
    } else {
      prefixAcceptedX = prefixControlX;
      prefixAcceptedY = loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MAX_Y_INDEX) -
        ((lastSourcePixelY - loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_Y_INDEX)) /
          loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_RECT_HEIGHT_INDEX)) *
          (loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MAX_Y_INDEX) -
            loadValue(valuesPointer, Layout.STEP_GLITCH_VALUE_MIN_Y_INDEX));
      prefixReachedTargetCount = 0;
    }
  }

  const workPointer = createDfsVector();
  pushDfsState(
    workPointer,
    createDfsState(
      contextPointer,
      prefixAcceptedX,
      prefixAcceptedY,
      hasDirectBlockedX,
      directBlockedX,
      sourceXPointer,
      sourceYPointer,
      sourceCount,
      sourceWindowPointer,
      sourceWindowCount,
    ),
  );
  while (load<u32>(workPointer + DFS_VECTOR_COUNT_OFFSET) > 0) {
    const workCount = load<u32>(workPointer + DFS_VECTOR_COUNT_OFFSET) - 1;
    const workRecordsPointer = load<u32>(workPointer + DFS_VECTOR_POINTER_OFFSET);
    const itemPointer = workRecordsPointer + workCount * DFS_WORK_BYTE_LENGTH;
    store<u32>(workPointer + DFS_VECTOR_COUNT_OFFSET, workCount);
    const itemType = load<u32>(itemPointer + DFS_WORK_TYPE_OFFSET);
    if (itemType == DFS_WORK_STATE) {
      const statePointer = load<u32>(itemPointer + DFS_WORK_VALUE_A_OFFSET);
      const acceptedX = load<f64>(statePointer + DFS_STATE_ACCEPTED_X_OFFSET);
      if (acceptedX >= targetX) continue;
      const stateSearchX = load<i32>(statePointer + DFS_STATE_SEARCH_X_OFFSET);
      const stateRow = load<i32>(statePointer + DFS_STATE_ROW_OFFSET);
      const farthestX = getFarthestFreeX(contextPointer, stateSearchX, stateRow);
      if (farthestX < stateSearchX) continue;
      const hasStateBlockedX = load<u32>(statePointer + DFS_STATE_BLOCKED_FLAG_OFFSET);
      const statePathXPointer = load<u32>(statePointer + DFS_STATE_PATH_X_POINTER_OFFSET);
      const statePathYPointer = load<u32>(statePointer + DFS_STATE_PATH_Y_POINTER_OFFSET);
      const statePathCount = load<u32>(statePointer + DFS_STATE_PATH_COUNT_OFFSET);
      if (hasStateBlockedX == 0 && farthestX >= targetSearchX) {
        const pathDescriptor = appendDfsPathPoint(
          statePathXPointer,
          statePathYPointer,
          statePathCount,
          targetPointX,
          targetPointY,
        );
        const windowDescriptor = appendDfsWindow(
          load<u32>(statePointer + DFS_STATE_WINDOW_POINTER_OFFSET),
          load<u32>(statePointer + DFS_STATE_WINDOW_COUNT_OFFSET),
          false,
          0,
          0,
        );
        pushDfsCandidate(
          workPointer,
          Layout.STEP_GLITCH_DFS_CANDIDATE_TARGET,
          load<u32>(pathDescriptor),
          load<u32>(pathDescriptor + sizeof<u32>()),
          load<u32>(pathDescriptor + 2 * sizeof<u32>()),
          load<u32>(windowDescriptor),
          load<u32>(windowDescriptor + sizeof<u32>()),
          targetX,
        );
      } else {
        const firstBlockedSearchX = hasStateBlockedX == 0
          ? farthestX + 1
          : graphXToSearchColumn(contextPointer, load<f64>(statePointer + DFS_STATE_BLOCKED_X_OFFSET));
        const frontierInputPointer = reserveArena(Layout.STEP_GLITCH_TRACE_INPUT_BYTE_LENGTH, sizeof<f64>());
        store<u32>(frontierInputPointer + Layout.STEP_GLITCH_TRACE_CONTEXT_POINTER_OFFSET, contextPointer);
        store<i32>(
          frontierInputPointer + Layout.STEP_GLITCH_TRACE_FIRST_BLOCKED_SEARCH_X_OFFSET,
          firstBlockedSearchX,
        );
        store<i32>(frontierInputPointer + Layout.STEP_GLITCH_TRACE_TARGET_ROW_OFFSET, hitTargetRow);
        store<i32>(frontierInputPointer + Layout.STEP_GLITCH_TRACE_STATE_ROW_OFFSET, stateRow);
        store<f64>(frontierInputPointer + Layout.STEP_GLITCH_TRACE_ACCEPTED_X_OFFSET, acceptedX);
        store<f64>(
          frontierInputPointer + Layout.STEP_GLITCH_TRACE_ACCEPTED_Y_OFFSET,
          load<f64>(statePointer + DFS_STATE_ACCEPTED_Y_OFFSET),
        );
        store<f64>(frontierInputPointer + Layout.STEP_GLITCH_TRACE_TARGET_X_OFFSET, targetX);
        store<f64>(frontierInputPointer + Layout.STEP_GLITCH_TRACE_TARGET_Y_OFFSET, targetY);
        const frontierPointer = traceStepGlitchGeometryFrontier(
          frontierInputPointer,
          Layout.STEP_GLITCH_TRACE_INPUT_BYTE_LENGTH,
        );
        if (load<u32>(frontierPointer + Layout.STEP_GLITCH_TRACE_CANDIDATE_COUNT_OFFSET) > 0) {
          pushDfsFrontier(workPointer, statePointer, frontierPointer, 0);
        }
      }
      continue;
    }
    if (itemType == DFS_WORK_FRONTIER) {
      const statePointer = load<u32>(itemPointer + DFS_WORK_VALUE_A_OFFSET);
      const frontierPointer = load<u32>(itemPointer + DFS_WORK_VALUE_B_OFFSET);
      const candidateIndex = load<u32>(itemPointer + DFS_WORK_VALUE_C_OFFSET);
      const frontierCandidateCount = load<u32>(frontierPointer + Layout.STEP_GLITCH_TRACE_CANDIDATE_COUNT_OFFSET);
      if (candidateIndex >= frontierCandidateCount) continue;
      if (candidateIndex + 1 < frontierCandidateCount) {
        pushDfsFrontier(workPointer, statePointer, frontierPointer, candidateIndex + 1);
      }
      const frontierCandidatesPointer = load<u32>(
        frontierPointer + Layout.STEP_GLITCH_TRACE_CANDIDATE_POINTER_OFFSET,
      );
      const frontierCandidatePointer =
        frontierCandidatesPointer + candidateIndex * Layout.STEP_GLITCH_TRACE_CANDIDATE_BYTE_LENGTH;
      const pathDescriptor = appendDfsPathPoint(
        load<u32>(statePointer + DFS_STATE_PATH_X_POINTER_OFFSET),
        load<u32>(statePointer + DFS_STATE_PATH_Y_POINTER_OFFSET),
        load<u32>(statePointer + DFS_STATE_PATH_COUNT_OFFSET),
        load<f64>(frontierCandidatePointer + Layout.STEP_GLITCH_TRACE_CANDIDATE_POINT_X_OFFSET),
        load<f64>(frontierCandidatePointer + Layout.STEP_GLITCH_TRACE_CANDIDATE_POINT_Y_OFFSET),
      );
      const windowDescriptor = appendDfsWindow(
        load<u32>(statePointer + DFS_STATE_WINDOW_POINTER_OFFSET),
        load<u32>(statePointer + DFS_STATE_WINDOW_COUNT_OFFSET),
        true,
        load<f64>(frontierCandidatePointer + Layout.STEP_GLITCH_TRACE_CANDIDATE_START_X_OFFSET),
        load<f64>(frontierCandidatePointer + Layout.STEP_GLITCH_TRACE_CANDIDATE_CONTROL_X_OFFSET),
      );
      pushDfsCandidate(
        workPointer,
        Layout.STEP_GLITCH_DFS_CANDIDATE_GATE,
        load<u32>(pathDescriptor),
        load<u32>(pathDescriptor + sizeof<u32>()),
        load<u32>(pathDescriptor + 2 * sizeof<u32>()),
        load<u32>(windowDescriptor),
        load<u32>(windowDescriptor + sizeof<u32>()),
        load<f64>(frontierCandidatePointer + Layout.STEP_GLITCH_TRACE_CANDIDATE_CONTROL_X_OFFSET),
      );
      continue;
    }
    if (itemType != DFS_WORK_CANDIDATE) trap();
    const kind = load<u32>(itemPointer + DFS_WORK_VALUE_A_OFFSET);
    const pathXPointer = load<u32>(itemPointer + DFS_WORK_VALUE_B_OFFSET);
    const pathYPointer = load<u32>(itemPointer + DFS_WORK_VALUE_C_OFFSET);
    const pathCount = load<u32>(itemPointer + DFS_WORK_VALUE_D_OFFSET);
    const windowPointer = load<u32>(itemPointer + DFS_WORK_WINDOW_POINTER_OFFSET);
    const windowCount = load<u32>(itemPointer + DFS_WORK_WINDOW_COUNT_OFFSET);
    const controlX = load<f64>(itemPointer + DFS_WORK_CONTROL_X_OFFSET);
    if (
      dfsPathsEqual(
        pathXPointer,
        pathYPointer,
        pathCount,
        directPathXPointer,
        directPathYPointer,
        directPathCount,
      )
    ) continue;
    if (expandedStates == u32.MAX_VALUE) trap();
    expandedStates += 1;
    let replayStatus = Layout.STEP_GLITCH_DFS_REPLAY_MISS;
    let reachedTargetCount: u32 = 0;
    let hasCandidateBlockedX: u32 = 0;
    let acceptedX = 0.0;
    let acceptedY = 0.0;
    let candidateBlockedX = 0.0;
    let candidateReplayPointer: u32 = 0;
    if (mode == Layout.STEP_GLITCH_DFS_MODE_SCRIPTED) {
      if (scriptConsumed >= scriptCount) trap();
      const outcomePointer = scriptPointer + scriptConsumed * Layout.STEP_GLITCH_DFS_SCRIPT_BYTE_LENGTH;
      replayStatus = load<u32>(outcomePointer + Layout.STEP_GLITCH_DFS_SCRIPT_STATUS_OFFSET);
      reachedTargetCount = load<u32>(outcomePointer + Layout.STEP_GLITCH_DFS_SCRIPT_REACHED_COUNT_OFFSET);
      hasCandidateBlockedX = load<u32>(outcomePointer + Layout.STEP_GLITCH_DFS_SCRIPT_BLOCKED_FLAG_OFFSET);
      acceptedX = load<f64>(outcomePointer + Layout.STEP_GLITCH_DFS_SCRIPT_ACCEPTED_X_OFFSET);
      acceptedY = load<f64>(outcomePointer + Layout.STEP_GLITCH_DFS_SCRIPT_ACCEPTED_Y_OFFSET);
      candidateBlockedX = load<f64>(outcomePointer + Layout.STEP_GLITCH_DFS_SCRIPT_BLOCKED_X_OFFSET);
      scriptConsumed += 1;
    } else if (mode == Layout.STEP_GLITCH_DFS_MODE_REAL) {
      const isTargetCandidate = kind == Layout.STEP_GLITCH_DFS_CANDIDATE_TARGET;
      const candidateTracePointer = beginRealDfsTrace(
        realTraceVectorPointer,
        isTargetCandidate
          ? Layout.STEP_GLITCH_REAL_DFS_CANDIDATE_TARGET
          : Layout.STEP_GLITCH_REAL_DFS_CANDIDATE_GATE,
        pathXPointer,
        pathYPointer,
        pathCount,
        windowPointer,
        windowCount,
        Layout.STEP_GLITCH_FORMULA_WINDOW_MODE_EXPLICIT,
        controlX,
      );
      const replayMark = markArena();
      candidateReplayPointer = replayStepGlitchCandidate(
        contextPointer,
        pathXPointer,
        pathYPointer,
        pathCount,
        windowPointer,
        windowCount,
        Layout.STEP_GLITCH_FORMULA_WINDOW_MODE_EXPLICIT,
        isTargetCandidate ? targetRecordPointer : 0,
        isTargetCandidate ? orderedTargetCount : 0,
        controlX,
      );
      replayStatus = load<u32>(candidateReplayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_STATUS_OFFSET);
      reachedTargetCount =
        load<u32>(candidateReplayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REACHED_ORDERED_COUNT_OFFSET) +
        load<u32>(candidateReplayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_REACHED_REQUIRED_COUNT_OFFSET);
      hasCandidateBlockedX = load<u32>(candidateReplayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_FLAG_OFFSET);
      acceptedX = load<f64>(candidateReplayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_X_OFFSET);
      acceptedY = load<f64>(candidateReplayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_ACCEPTED_Y_OFFSET);
      candidateBlockedX = load<f64>(candidateReplayPointer + Layout.STEP_GLITCH_REPLAY_RESULT_BLOCKED_X_OFFSET);
      finishRealDfsTrace(candidateTracePointer, candidateReplayPointer);
      resetArena(replayMark);
    }
    if (mode != Layout.STEP_GLITCH_DFS_MODE_REAL) {
      appendDfsTrace(
        traceVectorPointer,
        kind,
        replayStatus,
        pathXPointer,
        pathYPointer,
        pathCount,
        reachedTargetCount,
        hasCandidateBlockedX,
        acceptedX,
        acceptedY,
        candidateBlockedX,
      );
    }
    if (reachedTargetCount > bestReachedTargetCount) bestReachedTargetCount = reachedTargetCount;
    if (hasBlockedX == 0 && hasCandidateBlockedX != 0) {
      hasBlockedX = 1;
      blockedX = candidateBlockedX;
    }
    if (kind == Layout.STEP_GLITCH_DFS_CANDIDATE_TARGET) {
      if (replayStatus == Layout.STEP_GLITCH_DFS_REPLAY_HIT) {
        if (mode == Layout.STEP_GLITCH_DFS_MODE_REAL) {
          return createRealDfsResult(
            Layout.STEP_GLITCH_REAL_DFS_RESULT_HIT,
            expandedStates,
            bestReachedTargetCount,
            hasBlockedX,
            blockedX,
            prefixPreparationSource,
            realTraceVectorPointer,
          );
        }
        if (mode == Layout.STEP_GLITCH_DFS_MODE_SCRIPTED && scriptConsumed != scriptCount) trap();
        return createDfsResult(
          Layout.STEP_GLITCH_DFS_RESULT_HIT,
          expandedStates,
          bestReachedTargetCount,
          hasBlockedX,
          blockedX,
          scriptConsumed,
          traceVectorPointer,
        );
      }
      continue;
    }
    if (replayStatus == Layout.STEP_GLITCH_DFS_REPLAY_MISS || acceptedX >= targetX) continue;
    pushDfsState(
      workPointer,
      createDfsState(
        contextPointer,
        acceptedX,
        acceptedY,
        hasCandidateBlockedX,
        candidateBlockedX,
        pathXPointer,
        pathYPointer,
        pathCount,
        windowPointer,
        windowCount,
      ),
    );
  }
  if (mode == Layout.STEP_GLITCH_DFS_MODE_REAL) {
    return createRealDfsResult(
      Layout.STEP_GLITCH_REAL_DFS_RESULT_NO_PATH,
      expandedStates,
      bestReachedTargetCount,
      hasBlockedX,
      blockedX,
      prefixPreparationSource,
      realTraceVectorPointer,
    );
  }
  if (mode == Layout.STEP_GLITCH_DFS_MODE_SCRIPTED && scriptConsumed != scriptCount) trap();
  return createDfsResult(
    Layout.STEP_GLITCH_DFS_RESULT_NO_PATH,
    expandedStates,
    bestReachedTargetCount,
    hasBlockedX,
    blockedX,
    scriptConsumed,
    traceVectorPointer,
  );
}
