import { roundFormulaDecimal } from "../core/decimal";
import { runCurveBatch } from "./curves";
import { evaluateFormulaMaterialValue } from "./evaluator";
import { refineAbsSecondDerivativeLaunch } from "./refinement/abs";
import {
  ABS_FIRST_ORDER_COLD_REFINEMENT_INVALID,
  ABS_FIRST_ORDER_COLD_REFINEMENT_PROTECTION_CHANGED,
  collectAbsFirstOrderSegmentStartsCold,
} from "./refinement/abs-first-order-cold";
import {
  refineStepFormulaCold,
  STEP_COLD_REFINEMENT_INVALID,
  STEP_COLD_REFINEMENT_PROTECTION_CHANGED,
} from "./refinement/step-cold";
import {
  getGraphwarAngleError,
  getGraphwarGameSoldierRadius,
  getGraphwarMaxAngleLoops,
  getGraphwarPlaneHeight,
  getGraphwarPlaneLength,
  getGraphwarStepSize,
  requireGraphwarGameConstantsInitialized,
} from "../core/game-constants";
import {
  FORMULA_ALGORITHM_ABS,
  FORMULA_ALGORITHM_AKIMA,
  FORMULA_ALGORITHM_PCHIP,
  FORMULA_ALGORITHM_STEP,
  FORMULA_EQUATION_DDY,
  FORMULA_EQUATION_DY,
  FORMULA_EQUATION_Y,
  FORMULA_FLAG_DISPLAY_ROUNDED_ANGLE,
  FORMULA_FLAG_HAS_USER_LAUNCH_ANGLE,
  FORMULA_FLAG_STEP_OVERFLOW_PROTECTION,
  FORMULA_FLAG_STEP_GLITCH_FIXED_WINDOWS,
  FORMULA_FLAG_STEP_GLITCH_MODE,
  FORMULA_INPUT_ALGORITHM_OFFSET,
  FORMULA_INPUT_ABS_PULSE_CENTER_X_POINTER_OFFSET,
  FORMULA_INPUT_ABS_PULSE_DELTA_SLOPE_POINTER_OFFSET,
  FORMULA_INPUT_BOUNDS_MAX_X_OFFSET,
  FORMULA_INPUT_BOUNDS_MAX_Y_OFFSET,
  FORMULA_INPUT_BOUNDS_MIN_X_OFFSET,
  FORMULA_INPUT_BOUNDS_MIN_Y_OFFSET,
  FORMULA_INPUT_BYTE_LENGTH,
  FORMULA_INPUT_DECIMAL_PLACES_OFFSET,
  FORMULA_INPUT_DISABLED_SEGMENT_POINTER_OFFSET,
  FORMULA_INPUT_EQUATION_OFFSET,
  FORMULA_INPUT_FLAGS_OFFSET,
  FORMULA_INPUT_GLITCH_SEGMENT_POINTER_OFFSET,
  FORMULA_INPUT_LAUNCH_ANGLE_OFFSET,
  FORMULA_INPUT_MASK_BYTE_LENGTH_OFFSET,
  FORMULA_INPUT_MASK_POINTER_OFFSET,
  FORMULA_INPUT_PATH_STEEPNESS_OFFSET,
  FORMULA_INPUT_POINT_COUNT_OFFSET,
  FORMULA_INPUT_POINT_X_POINTER_OFFSET,
  FORMULA_INPUT_POINT_Y_POINTER_OFFSET,
  FORMULA_INPUT_QUALITY_TARGET_PLANE_PIXELS_OFFSET,
  FORMULA_INPUT_SIGN_PROTECTION_COUNT_OFFSET,
  FORMULA_INPUT_SIGN_PROTECTION_POINTER_OFFSET,
  FORMULA_INPUT_SEGMENT_START_X_POINTER_OFFSET,
  FORMULA_INPUT_SEGMENT_START_Y_POINTER_OFFSET,
  FORMULA_INPUT_SOLDIER_X_OFFSET,
  FORMULA_INPUT_SOLDIER_Y_OFFSET,
  FORMULA_INPUT_STEEPNESS_OFFSET,
  FORMULA_INPUT_STEP_OVERFLOW_RANGE_COUNT_OFFSET,
  FORMULA_INPUT_STEP_OVERFLOW_RANGE_POINTER_OFFSET,
  FORMULA_INPUT_STEP_DELTA_Y_POINTER_OFFSET,
  FORMULA_INPUT_VALUE_COUNT_OFFSET,
  FORMULA_INPUT_VALUE_DY_POINTER_OFFSET,
  FORMULA_INPUT_VALUE_X_POINTER_OFFSET,
  FORMULA_INPUT_VALUE_Y_POINTER_OFFSET,
  FORMULA_LAUNCH_FLAG_HAS_INITIAL_DY,
  FORMULA_LAUNCH_FLAG_HAS_Y_OFFSET,
  FORMULA_LAUNCH_FLAG_USED_USER_ANGLE,
  FORMULA_LAUNCH_INVALID_REASON_ABS_SECOND_ORDER_TARGET_NOT_CONVERGED,
  FORMULA_LAUNCH_INVALID_REASON_FORMULA_LAUNCH_POINT_NOT_FINITE,
  FORMULA_LAUNCH_INVALID_REASON_NONE,
  FORMULA_LAUNCH_INVALID_REASON_SECOND_ORDER_ANGLE_NOT_FINITE,
  FORMULA_LAUNCH_RESULT_ANGLE_OFFSET,
  FORMULA_LAUNCH_RESULT_BYTE_LENGTH,
  FORMULA_LAUNCH_RESULT_FLAGS_OFFSET,
  FORMULA_LAUNCH_RESULT_FORMULA_POINT_ITERATION_COUNT_OFFSET,
  FORMULA_LAUNCH_RESULT_FORMULA_POINT_COUNT_OFFSET,
  FORMULA_LAUNCH_RESULT_FORMULA_POINT_X_POINTER_OFFSET,
  FORMULA_LAUNCH_RESULT_FORMULA_POINT_Y_POINTER_OFFSET,
  FORMULA_LAUNCH_RESULT_INITIAL_DY_OFFSET,
  FORMULA_LAUNCH_RESULT_ITERATION_COUNT_OFFSET,
  FORMULA_LAUNCH_RESULT_MATERIAL_RESULT_POINTER_OFFSET,
  FORMULA_LAUNCH_RESULT_PROTECTION_COUNT_OFFSET,
  FORMULA_LAUNCH_RESULT_PROTECTION_POINTER_OFFSET,
  FORMULA_LAUNCH_RESULT_STATUS_OFFSET,
  FORMULA_LAUNCH_RESULT_X_OFFSET,
  FORMULA_LAUNCH_RESULT_Y_OFFSET,
  FORMULA_LAUNCH_RESULT_Y_OFFSET_VALUE_OFFSET,
  FORMULA_LAUNCH_STATUS_INVALID,
  FORMULA_LAUNCH_STATUS_SUCCESS,
  ABS_CONNECTOR_BYTE_LENGTH,
  ABS_PULSE_BYTE_LENGTH,
  FORMULA_MATERIAL_ABS_CONNECTOR,
  FORMULA_MATERIAL_ABS_SECOND_DERIVATIVE,
  FORMULA_MATERIAL_SOFT_CUBIC,
  FORMULA_MATERIAL_STEP,
  FORMULA_RESULT_AUXILIARY_VALUE_OFFSET,
  FORMULA_RESULT_FLAGS_OFFSET,
  FORMULA_RESULT_MATERIAL_COUNT_OFFSET,
  FORMULA_RESULT_MATERIAL_POINTER_OFFSET,
  FORMULA_RESULT_MATERIAL_STRIDE_OFFSET,
  FORMULA_RESULT_MATERIAL_TYPE_OFFSET,
  FORMULA_RESULT_PROTECTION_COUNT_OFFSET,
  FORMULA_RESULT_PROTECTION_POINTER_OFFSET,
  SOFT_CUBIC_BYTE_LENGTH,
  STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH,
  STEP_GLITCH_FIXED_WINDOW_END_X_OFFSET,
  STEP_GLITCH_FIXED_WINDOW_PRESENCE_OFFSET,
  STEP_GLITCH_FIXED_WINDOW_RESERVED_OFFSET,
  STEP_GLITCH_FIXED_WINDOW_START_X_OFFSET,
  STEP_MATERIAL_BYTE_LENGTH,
} from "./layout";
import { runStepLaunchBatch } from "./step";
import {
  createStepFormulaResolution,
  getStepFormulaResolutionSteepness,
  resolveStepFormulaTransition,
  STEP_TRANSITION_BYTE_LENGTH,
  STEP_TRANSITION_EFFECTIVE_DELTA_Y_OFFSET,
} from "./step-resolution";
import { commitArena, markArena, requireArenaRange, reserveArena, resetArena } from "../core/memory";
import {
  evaluateFirstOrderFormulaRk4Y,
  initializeTrajectoryScalarState,
  recordTrajectoryDebugLaunchRk4Step,
} from "../trajectory/scalar";

const FORMULA_STATE_HEADER_BYTE_LENGTH: u32 = 24;

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
function checkedAddByteLength(left: u32, right: u32): u32 {
  const result = <u64>left + right;
  if (result > 0xffff_ffff) {
    trap();
  }
  return <u32>result;
}

@inline
function requireOptionalRange(pointer: u32, byteLength: u32, alignment: u32): void {
  if (pointer != 0) {
    requireArenaRange(pointer, byteLength, alignment);
  }
}

@inline
function getMaterialStride(algorithm: i32, equation: i32): u32 {
  return algorithm == FORMULA_ALGORITHM_STEP
    ? STEP_MATERIAL_BYTE_LENGTH
    : algorithm == FORMULA_ALGORITHM_ABS
      ? equation == FORMULA_EQUATION_DDY
        ? ABS_PULSE_BYTE_LENGTH
        : ABS_CONNECTOR_BYTE_LENGTH
      : SOFT_CUBIC_BYTE_LENGTH;
}

@inline
function getExpectedMaterialType(algorithm: i32, equation: i32): i32 {
  return algorithm == FORMULA_ALGORITHM_STEP
    ? FORMULA_MATERIAL_STEP
    : algorithm == FORMULA_ALGORITHM_ABS
      ? equation == FORMULA_EQUATION_DDY
        ? FORMULA_MATERIAL_ABS_SECOND_DERIVATIVE
        : FORMULA_MATERIAL_ABS_CONNECTOR
      : FORMULA_MATERIAL_SOFT_CUBIC;
}

@inline
function loadTargetX(pointer: u32, index: u32, firstX: f64, hasFirstPoint: bool): f64 {
  return hasFirstPoint && index == 0 ? firstX : load<f64>(pointer + index * sizeof<f64>());
}

@inline
function loadTargetY(pointer: u32, index: u32, firstY: f64, hasFirstPoint: bool): f64 {
  return hasFirstPoint && index == 0 ? firstY : load<f64>(pointer + index * sizeof<f64>());
}

function calculateStepCenterX(
  startX: f64,
  targetX: f64,
  effectiveDeltaY: f64,
  formulaSteepness: f64,
  boundsMinX: f64,
  boundsMaxX: f64,
  boundsMinY: f64,
  boundsMaxY: f64,
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
    1 - NativeMath.abs(boundsMaxY - boundsMinY) / getGraphwarPlaneHeight() / NativeMath.abs(effectiveDeltaY);
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

/** Recreates the raw path points consumed by the material identity loop from one target launch point. */
function writeFormulaPathPoints(
  inputPointer: u32,
  targetXPointer: u32,
  targetYPointer: u32,
  outputXPointer: u32,
  outputYPointer: u32,
  firstX: f64,
  firstY: f64,
  hasFirstPoint: bool,
  pathSteepness: f64,
): void {
  const algorithm = load<i32>(inputPointer + FORMULA_INPUT_ALGORITHM_OFFSET);
  const equation = load<i32>(inputPointer + FORMULA_INPUT_EQUATION_OFFSET);
  const decimalPlaces = load<i32>(inputPointer + FORMULA_INPUT_DECIMAL_PLACES_OFFSET);
  const pointCount = load<u32>(inputPointer + FORMULA_INPUT_POINT_COUNT_OFFSET);
  let pointIndex: u32 = 0;
  while (pointIndex < pointCount) {
    store<f64>(
      outputYPointer + pointIndex * sizeof<f64>(),
      loadTargetY(targetYPointer, pointIndex, firstY, hasFirstPoint),
    );
    pointIndex += 1;
  }
  if (algorithm != FORMULA_ALGORITHM_STEP) {
    pointIndex = 0;
    while (pointIndex < pointCount) {
      store<f64>(
        outputXPointer + pointIndex * sizeof<f64>(),
        loadTargetX(targetXPointer, pointIndex, firstX, hasFirstPoint),
      );
      pointIndex += 1;
    }
    return;
  }

  const segmentCount = pointCount - 1;
  const deltaYPointer = load<u32>(inputPointer + FORMULA_INPUT_STEP_DELTA_Y_POINTER_OFFSET);
  const segmentStartXPointer = load<u32>(inputPointer + FORMULA_INPUT_SEGMENT_START_X_POINTER_OFFSET);
  const segmentStartYPointer = load<u32>(inputPointer + FORMULA_INPUT_SEGMENT_START_Y_POINTER_OFFSET);
  const firstTargetX = loadTargetX(targetXPointer, 0, firstX, hasFirstPoint);
  const firstTargetY = loadTargetY(targetYPointer, 0, firstY, hasFirstPoint);
  store<f64>(outputXPointer, firstTargetX);
  const resolutionPointer = createStepFormulaResolution(
    pathSteepness,
    decimalPlaces,
    equation,
    firstTargetY,
    segmentCount,
  );
  const formulaSteepness = getStepFormulaResolutionSteepness(resolutionPointer);
  const transitionPointer = reserveArena(STEP_TRANSITION_BYTE_LENGTH, sizeof<f64>());
  const boundsMinX = load<f64>(inputPointer + FORMULA_INPUT_BOUNDS_MIN_X_OFFSET);
  const boundsMaxX = load<f64>(inputPointer + FORMULA_INPUT_BOUNDS_MAX_X_OFFSET);
  const boundsMinY = load<f64>(inputPointer + FORMULA_INPUT_BOUNDS_MIN_Y_OFFSET);
  const boundsMaxY = load<f64>(inputPointer + FORMULA_INPUT_BOUNDS_MAX_Y_OFFSET);
  let segmentIndex: u32 = 0;
  while (segmentIndex < segmentCount) {
    const targetX = loadTargetX(targetXPointer, segmentIndex + 1, firstX, hasFirstPoint);
    const targetY = loadTargetY(targetYPointer, segmentIndex + 1, firstY, hasFirstPoint);
    let deltaYOverride = 0.0;
    let hasDeltaYOverride = false;
    if (deltaYPointer != 0) {
      const candidate = load<f64>(deltaYPointer + segmentIndex * sizeof<f64>());
      if (candidate == candidate) {
        if (!isFiniteValue(candidate)) {
          trap();
        }
        deltaYOverride = candidate;
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
    let startX = loadTargetX(targetXPointer, segmentIndex, firstX, hasFirstPoint);
    if (segmentIndex > 0 && segmentStartXPointer != 0) {
      const candidateX = load<f64>(segmentStartXPointer + segmentIndex * sizeof<f64>());
      const candidateY = load<f64>(segmentStartYPointer + segmentIndex * sizeof<f64>());
      if (candidateX == candidateX || candidateY == candidateY) {
        if (!isFiniteValue(candidateX) || !isFiniteValue(candidateY)) {
          trap();
        }
        startX = candidateX;
      }
    }
    store<f64>(
      outputXPointer + (segmentIndex + 1) * sizeof<f64>(),
      calculateStepCenterX(
        startX,
        targetX,
        load<f64>(transitionPointer + STEP_TRANSITION_EFFECTIVE_DELTA_Y_OFFSET),
        formulaSteepness,
        boundsMinX,
        boundsMaxX,
        boundsMinY,
        boundsMaxY,
      ),
    );
    segmentIndex += 1;
  }
}

@inline
function normalizeStoredZero(pointer: u32): bool {
  const value = load<f64>(pointer);
  if (!isFiniteValue(value)) {
    return false;
  }
  if (value == 0) {
    store<f64>(pointer, 0);
  }
  return true;
}

function normalizeSnapshotMaterials(pointer: u32, materialType: i32, materialCount: u32, materialStride: u32): bool {
  let materialIndex: u32 = 0;
  while (materialIndex < materialCount) {
    const material = pointer + materialIndex * materialStride;
    let fieldIndex: u32 = 0;
    const fieldCount: u32 =
      materialType == FORMULA_MATERIAL_ABS_CONNECTOR
        ? 4
        : materialType == FORMULA_MATERIAL_ABS_SECOND_DERIVATIVE
          ? 2
          : materialType == FORMULA_MATERIAL_SOFT_CUBIC
            ? 18
            : 12;
    while (fieldIndex < fieldCount) {
      let fieldOffset: u32;
      if (materialType == FORMULA_MATERIAL_STEP && fieldIndex >= 4) {
        fieldOffset = 48 + (fieldIndex - 4) * sizeof<f64>();
      } else {
        fieldOffset = fieldIndex * sizeof<f64>();
      }
      if (!normalizeStoredZero(material + fieldOffset)) {
        return false;
      }
      fieldIndex += 1;
    }
    materialIndex += 1;
  }
  return true;
}

/** Stores one collision-free, -0-normalized material identity in a fixed-width visited slot. */
function writeMaterialSnapshot(
  resultPointer: u32,
  snapshotPointer: u32,
  snapshotByteLength: u32,
  expectedMaterialType: i32,
  expectedMaterialStride: u32,
  segmentCount: u32,
): bool {
  const materialType = load<i32>(resultPointer + FORMULA_RESULT_MATERIAL_TYPE_OFFSET);
  const materialPointer = load<u32>(resultPointer + FORMULA_RESULT_MATERIAL_POINTER_OFFSET);
  const materialCount = load<u32>(resultPointer + FORMULA_RESULT_MATERIAL_COUNT_OFFSET);
  const materialStride = load<u32>(resultPointer + FORMULA_RESULT_MATERIAL_STRIDE_OFFSET);
  if (
    materialType != expectedMaterialType ||
    materialStride != expectedMaterialStride ||
    materialCount > segmentCount
  ) {
    trap();
  }
  memory.fill(snapshotPointer, 0, snapshotByteLength);
  store<i32>(snapshotPointer, materialType);
  store<u32>(snapshotPointer + 4, materialCount);
  store<u32>(snapshotPointer + 8, materialStride);
  store<u32>(snapshotPointer + 12, load<u32>(resultPointer + FORMULA_RESULT_FLAGS_OFFSET));
  store<f64>(snapshotPointer + 16, load<f64>(resultPointer + FORMULA_RESULT_AUXILIARY_VALUE_OFFSET));
  if (!normalizeStoredZero(snapshotPointer + 16)) {
    return false;
  }
  const materialByteLength = checkedByteLength(materialCount, materialStride);
  memory.copy(snapshotPointer + FORMULA_STATE_HEADER_BYTE_LENGTH, materialPointer, materialByteLength);
  return normalizeSnapshotMaterials(
    snapshotPointer + FORMULA_STATE_HEADER_BYTE_LENGTH,
    materialType,
    materialCount,
    materialStride,
  );
}

function memoryEquals(leftPointer: u32, rightPointer: u32, byteLength: u32): bool {
  let offset: u32 = 0;
  while (offset < byteLength) {
    if (load<u64>(leftPointer + offset) != load<u64>(rightPointer + offset)) {
      return false;
    }
    offset += sizeof<u64>();
  }
  return true;
}

/** Merges one fixed-width protection bitset and reports whether the destination identity expanded. */
export function mergeProtectionBits(sourcePointer: u32, destinationPointer: u32, segmentCount: u32): bool {
  let hasProtectionChanged = false;
  let index: u32 = 0;
  while (index < segmentCount) {
    const destinationRolePointer = destinationPointer + index * sizeof<u32>();
    const previousRoles = load<u32>(destinationRolePointer);
    const nextRoles = previousRoles | load<u32>(sourcePointer + index * sizeof<u32>());
    store<u32>(destinationRolePointer, nextRoles);
    hasProtectionChanged = nextRoles != previousRoles || hasProtectionChanged;
    index += 1;
  }
  return hasProtectionChanged;
}

/** Redirects one material snapshot so every later evaluator call contributes to the complete attempt evidence. */
function shareObservedProtection(resultPointer: u32, combinedPointer: u32, segmentCount: u32): void {
  const observedPointer = load<u32>(resultPointer + FORMULA_RESULT_PROTECTION_POINTER_OFFSET);
  if (load<u32>(resultPointer + FORMULA_RESULT_PROTECTION_COUNT_OFFSET) != segmentCount) {
    trap();
  }
  mergeProtectionBits(observedPointer, combinedPointer, segmentCount);
  store<u32>(resultPointer + FORMULA_RESULT_PROTECTION_POINTER_OFFSET, combinedPointer);
}

@inline
function moveX(centerX: f64, angle: f64): f64 {
  return centerX + getGraphwarGameSoldierRadius() * NativeMath.cos(angle);
}

@inline
function moveY(centerY: f64, angle: f64): f64 {
  return centerY + getGraphwarGameSoldierRadius() * NativeMath.sin(angle);
}

@inline
function resolveSecondOrderAngle(angle: f64, isDisplayRounded: bool): f64 {
  const executionAngle = isDisplayRounded
    ? (roundFormulaDecimal((angle * 180) / NativeMath.PI, 2) * NativeMath.PI) / 180
    : angle;
  return executionAngle >= -NativeMath.PI / 2 && executionAngle <= NativeMath.PI / 2 ? executionAngle : f64.NaN;
}

function getNormalAngle(
  materialResultPointer: u32,
  centerX: f64,
  baseY: f64,
  protectionPointer: u32,
  iterationPointer: u32,
): f64 {
  const startTangent =
    (evaluateFormulaMaterialValue(
      materialResultPointer,
      FORMULA_EQUATION_Y,
      centerX + getGraphwarStepSize(),
      0,
      0,
      baseY,
      protectionPointer,
    ) -
      evaluateFormulaMaterialValue(
        materialResultPointer,
        FORMULA_EQUATION_Y,
        centerX,
        0,
        0,
        baseY,
        protectionPointer,
      )) /
    getGraphwarStepSize();
  let angle = NativeMath.atan(startTangent);
  let error = f64.POSITIVE_INFINITY;
  let index: u32 = 0;
  while (error > getGraphwarAngleError() && index < getGraphwarMaxAngleLoops()) {
    const finalX = moveX(centerX, angle);
    const tangent =
      (evaluateFormulaMaterialValue(
        materialResultPointer,
        FORMULA_EQUATION_Y,
        finalX + getGraphwarStepSize(),
        0,
        0,
        baseY,
        protectionPointer,
      ) -
        evaluateFormulaMaterialValue(
          materialResultPointer,
          FORMULA_EQUATION_Y,
          finalX,
          0,
          0,
          baseY,
          protectionPointer,
        )) /
      getGraphwarStepSize();
    const nextAngle = NativeMath.atan(tangent);
    error = NativeMath.abs(nextAngle - angle);
    angle = nextAngle;
    index += 1;
  }
  store<u32>(iterationPointer, load<u32>(iterationPointer) + index);
  return angle;
}

function getFirstOrderAngle(
  materialResultPointer: u32,
  centerX: f64,
  centerY: f64,
  baseY: f64,
  protectionPointer: u32,
  iterationPointer: u32,
): f64 {
  let angle = 0.0;
  let error = f64.POSITIVE_INFINITY;
  let index: u32 = 0;
  while (error > getGraphwarAngleError() && index < getGraphwarMaxAngleLoops()) {
    const finalX = moveX(centerX, angle);
    const finalY = moveY(centerY, angle);
    const nextY = evaluateFirstOrderFormulaRk4Y(
      materialResultPointer,
      finalX,
      finalY,
      getGraphwarStepSize(),
      baseY,
      protectionPointer,
    );
    recordTrajectoryDebugLaunchRk4Step();
    const tangent = (nextY - finalY) / (finalX + getGraphwarStepSize() - finalX);
    const nextAngle = NativeMath.atan(tangent);
    error = NativeMath.abs(nextAngle - angle);
    angle = nextAngle;
    index += 1;
  }
  store<u32>(iterationPointer, load<u32>(iterationPointer) + index);
  return angle;
}

function getSecondOrderAngle(
  materialResultPointer: u32,
  centerX: f64,
  centerY: f64,
  baseY: f64,
  protectionPointer: u32,
  isDisplayRounded: bool,
  iterationPointer: u32,
): f64 {
  let angle = resolveSecondOrderAngle(
    NativeMath.atan(
      evaluateFormulaMaterialValue(
        materialResultPointer,
        FORMULA_EQUATION_DY,
        centerX,
        centerY,
        0,
        baseY,
        protectionPointer,
      ),
    ),
    isDisplayRounded,
  );
  let hasBestAngle = false;
  let bestAngle = 0.0;
  let bestResidual = f64.POSITIVE_INFINITY;
  const visitedPointer = reserveArena(getGraphwarMaxAngleLoops() * sizeof<u64>(), sizeof<u64>());
  let visitedCount: u32 = 0;
  let index: u32 = 0;
  while (index < getGraphwarMaxAngleLoops()) {
    if (!isFiniteValue(angle)) {
      break;
    }
    const normalizedAngle = angle == 0 ? 0 : angle;
    const angleBits = reinterpret<u64>(normalizedAngle);
    let hasVisited = false;
    let visitedIndex: u32 = 0;
    while (visitedIndex < visitedCount) {
      if (load<u64>(visitedPointer + visitedIndex * sizeof<u64>()) == angleBits) {
        hasVisited = true;
        break;
      }
      visitedIndex += 1;
    }
    if (hasVisited) {
      break;
    }
    store<u64>(visitedPointer + visitedCount * sizeof<u64>(), angleBits);
    visitedCount += 1;
    const launchX = moveX(centerX, angle);
    const launchY = moveY(centerY, angle);
    const nextAngle = resolveSecondOrderAngle(
      NativeMath.atan(
        evaluateFormulaMaterialValue(
          materialResultPointer,
          FORMULA_EQUATION_DY,
          launchX,
          launchY,
          0,
          baseY,
          protectionPointer,
        ),
      ),
      isDisplayRounded,
    );
    const residual = NativeMath.abs(nextAngle - angle);
    if (!isFiniteValue(residual) || !(residual < bestResidual)) {
      break;
    }
    bestResidual = residual;
    bestAngle = angle;
    hasBestAngle = true;
    angle = nextAngle;
    index += 1;
  }
  store<u32>(iterationPointer, load<u32>(iterationPointer) + index);
  return hasBestAngle ? bestAngle : f64.NaN;
}

const COLD_LAUNCH_CONTEXT_CENTER_X_OFFSET: u32 = 0;
const COLD_LAUNCH_CONTEXT_CENTER_Y_OFFSET: u32 = 8;
const COLD_LAUNCH_CONTEXT_USER_ANGLE_OFFSET: u32 = 16;
const COLD_LAUNCH_CONTEXT_ITERATION_POINTER_OFFSET: u32 = 24;
const COLD_LAUNCH_CONTEXT_FLAGS_OFFSET: u32 = 28;
const COLD_LAUNCH_CONTEXT_BYTE_LENGTH: u32 = 32;
const COLD_LAUNCH_CONTEXT_FLAG_HAS_USER_ANGLE: u32 = 1;
const COLD_LAUNCH_CONTEXT_FLAG_DISPLAY_ROUNDED: u32 = 2;

/** Rebuilds the physical launch state for one cold-refinement candidate from its exact materials and protection. */
function initializeColdRefinementLaunchStateWithAngle(
  materialResultPointer: u32,
  equation: i32,
  baseY: f64,
  protectionPointer: u32,
  statePointer: u32,
  anglePointer: u32,
  forcedLaunchAngle: f64,
  contextPointer: u32,
): bool {
  const centerX = load<f64>(contextPointer + COLD_LAUNCH_CONTEXT_CENTER_X_OFFSET);
  const centerY = load<f64>(contextPointer + COLD_LAUNCH_CONTEXT_CENTER_Y_OFFSET);
  const contextFlags = load<u32>(contextPointer + COLD_LAUNCH_CONTEXT_FLAGS_OFFSET);
  const iterationPointer = load<u32>(contextPointer + COLD_LAUNCH_CONTEXT_ITERATION_POINTER_OFFSET);
  const angle = isFiniteValue(forcedLaunchAngle)
    ? forcedLaunchAngle
    : equation == FORMULA_EQUATION_DY
      ? getFirstOrderAngle(materialResultPointer, centerX, centerY, baseY, protectionPointer, iterationPointer)
      : (contextFlags & COLD_LAUNCH_CONTEXT_FLAG_HAS_USER_ANGLE) != 0
        ? load<f64>(contextPointer + COLD_LAUNCH_CONTEXT_USER_ANGLE_OFFSET)
        : getSecondOrderAngle(
            materialResultPointer,
            centerX,
            centerY,
            baseY,
            protectionPointer,
            (contextFlags & COLD_LAUNCH_CONTEXT_FLAG_DISPLAY_ROUNDED) != 0,
            iterationPointer,
          );
  if (anglePointer != 0) {
    store<f64>(anglePointer, angle);
  }
  const launchX = moveX(centerX, angle);
  const launchY = moveY(centerY, angle);
  const initialDy = equation == FORMULA_EQUATION_DDY ? NativeMath.tan(angle) : 0;
  if (
    !isFiniteValue(angle) ||
    !isFiniteValue(launchX) ||
    !isFiniteValue(launchY) ||
    (equation == FORMULA_EQUATION_DDY && !isFiniteValue(initialDy))
  ) {
    return false;
  }
  initializeTrajectoryScalarState(statePointer, equation, launchX, launchY, initialDy, 0, 0, 0, 0, false);
  return true;
}

function initializeColdRefinementLaunchState(
  materialResultPointer: u32,
  equation: i32,
  baseY: f64,
  protectionPointer: u32,
  statePointer: u32,
  contextPointer: u32,
): bool {
  return initializeColdRefinementLaunchStateWithAngle(
    materialResultPointer,
    equation,
    baseY,
    protectionPointer,
    statePointer,
    0,
    f64.NaN,
    contextPointer,
  );
}

function initializeStepColdRefinementLaunchState(
  materialResultPointer: u32,
  equation: i32,
  baseY: f64,
  protectionPointer: u32,
  statePointer: u32,
  anglePointer: u32,
  forcedLaunchAngle: f64,
  contextPointer: u32,
): bool {
  return initializeColdRefinementLaunchStateWithAngle(
    materialResultPointer,
    equation,
    baseY,
    protectionPointer,
    statePointer,
    anglePointer,
    forcedLaunchAngle,
    contextPointer,
  );
}

/**
 * Resolves the launch-point/material fixed point for the overrides already installed in `buildInputPointer`.
 * Cold refinement can change the formula identity, so production must run this same loop once before and once
 * after refinement instead of publishing stale pre-refinement formula points.
 */
function resolveFormulaPathPointIdentity(
  buildInputPointer: u32,
  targetXPointer: u32,
  targetYPointer: u32,
  currentXPointer: u32,
  currentYPointer: u32,
  bestXPointer: u32,
  bestYPointer: u32,
  centerX: f64,
  centerY: f64,
  pathSteepness: f64,
  protectionPointer: u32,
  observedProtectionPointer: u32,
  isDisplayRounded: bool,
): u32 {
  const algorithm = load<i32>(buildInputPointer + FORMULA_INPUT_ALGORITHM_OFFSET);
  const equation = load<i32>(buildInputPointer + FORMULA_INPUT_EQUATION_OFFSET);
  const pointCount = load<u32>(buildInputPointer + FORMULA_INPUT_POINT_COUNT_OFFSET);
  const segmentCount = pointCount - 1;
  const materialStride = getMaterialStride(algorithm, equation);
  const snapshotByteLength = checkedAddByteLength(
    FORMULA_STATE_HEADER_BYTE_LENGTH,
    checkedByteLength(segmentCount, materialStride),
  );
  const visitedPointer = reserveArena(
    checkedByteLength(getGraphwarMaxAngleLoops(), snapshotByteLength),
    sizeof<u64>(),
  );
  let visitedCount: u32 = 0;
  let bestResidualSquared = f64.POSITIVE_INFINITY;
  let formulaPointIterationCount: u32 = 0;
  writeFormulaPathPoints(
    buildInputPointer,
    targetXPointer,
    targetYPointer,
    currentXPointer,
    currentYPointer,
    0,
    0,
    false,
    pathSteepness,
  );
  let stateIndex: u32 = 0;
  while (stateIndex < getGraphwarMaxAngleLoops()) {
    const candidateMark = markArena();
    store<u32>(buildInputPointer + FORMULA_INPUT_POINT_X_POINTER_OFFSET, currentXPointer);
    store<u32>(buildInputPointer + FORMULA_INPUT_POINT_Y_POINTER_OFFSET, currentYPointer);
    store<f64>(buildInputPointer + FORMULA_INPUT_STEEPNESS_OFFSET, pathSteepness);
    const candidateResultPointer =
      algorithm == FORMULA_ALGORITHM_STEP ? runStepLaunchBatch(buildInputPointer) : runCurveBatch(buildInputPointer);
    shareObservedProtection(candidateResultPointer, observedProtectionPointer, segmentCount);
    const candidateSnapshotPointer = visitedPointer + visitedCount * snapshotByteLength;
    const isFiniteSnapshot = writeMaterialSnapshot(
      candidateResultPointer,
      candidateSnapshotPointer,
      snapshotByteLength,
      getExpectedMaterialType(algorithm, equation),
      materialStride,
      segmentCount,
    );
    let hasVisited = false;
    let visitedIndex: u32 = 0;
    while (isFiniteSnapshot && visitedIndex < visitedCount) {
      if (memoryEquals(candidateSnapshotPointer, visitedPointer + visitedIndex * snapshotByteLength, snapshotByteLength)) {
        hasVisited = true;
        break;
      }
      visitedIndex += 1;
    }
    if (!isFiniteSnapshot || hasVisited) {
      resetArena(candidateMark);
      break;
    }
    visitedCount += 1;

    const iterationPointer = reserveArena(sizeof<u32>(), sizeof<u32>());
    store<u32>(iterationPointer, 0);
    const baseY = load<f64>(currentYPointer);
    const candidateAngle =
      equation == FORMULA_EQUATION_Y
        ? getNormalAngle(candidateResultPointer, centerX, baseY, protectionPointer, iterationPointer)
        : equation == FORMULA_EQUATION_DY
          ? getFirstOrderAngle(
              candidateResultPointer,
              centerX,
              centerY,
              baseY,
              protectionPointer,
              iterationPointer,
            )
          : getSecondOrderAngle(
              candidateResultPointer,
              centerX,
              centerY,
              baseY,
              protectionPointer,
              isDisplayRounded,
              iterationPointer,
            );
    const candidateLaunchX = moveX(centerX, candidateAngle);
    const candidateLaunchY = moveY(centerY, candidateAngle);
    const deltaX = load<f64>(currentXPointer) - candidateLaunchX;
    const deltaY = load<f64>(currentYPointer) - candidateLaunchY;
    const residualSquared = deltaX * deltaX + deltaY * deltaY;
    if (
      !isFiniteValue(candidateLaunchX) ||
      !isFiniteValue(candidateLaunchY) ||
      !isFiniteValue(residualSquared) ||
      !(residualSquared < bestResidualSquared)
    ) {
      resetArena(candidateMark);
      break;
    }
    bestResidualSquared = residualSquared;
    memory.copy(bestXPointer, currentXPointer, checkedByteLength(pointCount, sizeof<f64>()));
    memory.copy(bestYPointer, currentYPointer, checkedByteLength(pointCount, sizeof<f64>()));
    formulaPointIterationCount += 1;
    writeFormulaPathPoints(
      buildInputPointer,
      targetXPointer,
      targetYPointer,
      currentXPointer,
      currentYPointer,
      candidateLaunchX,
      candidateLaunchY,
      true,
      pathSteepness,
    );
    resetArena(candidateMark);
    stateIndex += 1;
  }
  return formulaPointIterationCount;
}

/** Resolves the exact formula points used by a first-segment Step cold-refinement candidate. */
function resolveStepColdCandidateFormulaPoints(
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
): bool {
  const pointCount = load<u32>(buildInputPointer + FORMULA_INPUT_POINT_COUNT_OFFSET);
  const pointByteLength = checkedByteLength(pointCount, sizeof<f64>());
  const currentXPointer = reserveArena(pointByteLength, sizeof<f64>());
  const currentYPointer = reserveArena(pointByteLength, sizeof<f64>());
  const materialSteepness = load<f64>(buildInputPointer + FORMULA_INPUT_STEEPNESS_OFFSET);
  const disabledSegmentPointer = load<u32>(buildInputPointer + FORMULA_INPUT_DISABLED_SEGMENT_POINTER_OFFSET);
  store<u32>(buildInputPointer + FORMULA_INPUT_POINT_X_POINTER_OFFSET, sourceXPointer);
  store<u32>(buildInputPointer + FORMULA_INPUT_POINT_Y_POINTER_OFFSET, sourceYPointer);
  store<u32>(buildInputPointer + FORMULA_INPUT_DISABLED_SEGMENT_POINTER_OFFSET, 0);
  const contextFlags = load<u32>(contextPointer + COLD_LAUNCH_CONTEXT_FLAGS_OFFSET);
  const iterationCount = resolveFormulaPathPointIdentity(
    buildInputPointer,
    targetXPointer,
    targetYPointer,
    currentXPointer,
    currentYPointer,
    outputXPointer,
    outputYPointer,
    load<f64>(contextPointer + COLD_LAUNCH_CONTEXT_CENTER_X_OFFSET),
    load<f64>(contextPointer + COLD_LAUNCH_CONTEXT_CENTER_Y_OFFSET),
    pathSteepness,
    protectionPointer,
    observedProtectionPointer,
    (contextFlags & COLD_LAUNCH_CONTEXT_FLAG_DISPLAY_ROUNDED) != 0,
  );
  store<f64>(buildInputPointer + FORMULA_INPUT_STEEPNESS_OFFSET, materialSteepness);
  store<u32>(buildInputPointer + FORMULA_INPUT_DISABLED_SEGMENT_POINTER_OFFSET, disabledSegmentPointer);
  return iterationCount != 0;
}

function writeLaunchResult(
  status: i32,
  iterationCount: u32,
  formulaPointIterationCount: u32,
  angle: f64,
  launchX: f64,
  launchY: f64,
  initialDy: f64,
  yOffset: f64,
  materialResultPointer: u32,
  flags: u32,
  protectionPointer: u32,
  protectionCount: u32,
  formulaPointXPointer: u32,
  formulaPointYPointer: u32,
  formulaPointCount: u32,
): u32 {
  const resultPointer = reserveArena(FORMULA_LAUNCH_RESULT_BYTE_LENGTH, sizeof<u64>());
  store<i32>(resultPointer + FORMULA_LAUNCH_RESULT_STATUS_OFFSET, status);
  store<u32>(resultPointer + FORMULA_LAUNCH_RESULT_ITERATION_COUNT_OFFSET, iterationCount);
  store<f64>(resultPointer + FORMULA_LAUNCH_RESULT_ANGLE_OFFSET, angle);
  store<f64>(resultPointer + FORMULA_LAUNCH_RESULT_X_OFFSET, launchX);
  store<f64>(resultPointer + FORMULA_LAUNCH_RESULT_Y_OFFSET, launchY);
  store<f64>(resultPointer + FORMULA_LAUNCH_RESULT_INITIAL_DY_OFFSET, initialDy);
  store<f64>(resultPointer + FORMULA_LAUNCH_RESULT_Y_OFFSET_VALUE_OFFSET, yOffset);
  store<u32>(resultPointer + FORMULA_LAUNCH_RESULT_MATERIAL_RESULT_POINTER_OFFSET, materialResultPointer);
  store<u32>(resultPointer + FORMULA_LAUNCH_RESULT_FLAGS_OFFSET, flags);
  store<u32>(
    resultPointer + FORMULA_LAUNCH_RESULT_FORMULA_POINT_ITERATION_COUNT_OFFSET,
    formulaPointIterationCount,
  );
  store<u32>(resultPointer + FORMULA_LAUNCH_RESULT_PROTECTION_POINTER_OFFSET, protectionPointer);
  store<u32>(resultPointer + FORMULA_LAUNCH_RESULT_PROTECTION_COUNT_OFFSET, protectionCount);
  store<u32>(resultPointer + FORMULA_LAUNCH_RESULT_FORMULA_POINT_COUNT_OFFSET, formulaPointCount);
  store<u32>(resultPointer + FORMULA_LAUNCH_RESULT_FORMULA_POINT_X_POINTER_OFFSET, formulaPointXPointer);
  store<u32>(resultPointer + FORMULA_LAUNCH_RESULT_FORMULA_POINT_Y_POINTER_OFFSET, formulaPointYPointer);
  return resultPointer;
}

/** Builds production formula points/materials, then prepares the physical launch state from the winning snapshot. */
export function runPrepareLaunch(inputPointer: u32): u32 {
  requireGraphwarGameConstantsInitialized();
  requireArenaRange(inputPointer, FORMULA_INPUT_BYTE_LENGTH, sizeof<u64>());
  const algorithm = load<i32>(inputPointer + FORMULA_INPUT_ALGORITHM_OFFSET);
  const equation = load<i32>(inputPointer + FORMULA_INPUT_EQUATION_OFFSET);
  const decimalPlaces = load<i32>(inputPointer + FORMULA_INPUT_DECIMAL_PLACES_OFFSET);
  const flags = load<u32>(inputPointer + FORMULA_INPUT_FLAGS_OFFSET);
  const pointCount = load<u32>(inputPointer + FORMULA_INPUT_POINT_COUNT_OFFSET);
  const pointXPointer = load<u32>(inputPointer + FORMULA_INPUT_POINT_X_POINTER_OFFSET);
  const pointYPointer = load<u32>(inputPointer + FORMULA_INPUT_POINT_Y_POINTER_OFFSET);
  const centerX = load<f64>(inputPointer + FORMULA_INPUT_SOLDIER_X_OFFSET);
  const centerY = load<f64>(inputPointer + FORMULA_INPUT_SOLDIER_Y_OFFSET);
  const finalSteepness = load<f64>(inputPointer + FORMULA_INPUT_STEEPNESS_OFFSET);
  const pathSteepness = load<f64>(inputPointer + FORMULA_INPUT_PATH_STEEPNESS_OFFSET);
  const boundsMinX = load<f64>(inputPointer + FORMULA_INPUT_BOUNDS_MIN_X_OFFSET);
  const boundsMaxX = load<f64>(inputPointer + FORMULA_INPUT_BOUNDS_MAX_X_OFFSET);
  const boundsMinY = load<f64>(inputPointer + FORMULA_INPUT_BOUNDS_MIN_Y_OFFSET);
  const boundsMaxY = load<f64>(inputPointer + FORMULA_INPUT_BOUNDS_MAX_Y_OFFSET);
  const protectionPointer = load<u32>(inputPointer + FORMULA_INPUT_SIGN_PROTECTION_POINTER_OFFSET);
  const protectionCount = load<u32>(inputPointer + FORMULA_INPUT_SIGN_PROTECTION_COUNT_OFFSET);
  const disabledSegmentPointer = load<u32>(inputPointer + FORMULA_INPUT_DISABLED_SEGMENT_POINTER_OFFSET);
  const glitchSegmentPointer = load<u32>(inputPointer + FORMULA_INPUT_GLITCH_SEGMENT_POINTER_OFFSET);
  const absPulseDeltaSlopePointer = load<u32>(
    inputPointer + FORMULA_INPUT_ABS_PULSE_DELTA_SLOPE_POINTER_OFFSET,
  );
  const absPulseCenterXPointer = load<u32>(inputPointer + FORMULA_INPUT_ABS_PULSE_CENTER_X_POINTER_OFFSET);
  const segmentStartXPointer = load<u32>(inputPointer + FORMULA_INPUT_SEGMENT_START_X_POINTER_OFFSET);
  const segmentStartYPointer = load<u32>(inputPointer + FORMULA_INPUT_SEGMENT_START_Y_POINTER_OFFSET);
  const deltaYPointer = load<u32>(inputPointer + FORMULA_INPUT_STEP_DELTA_Y_POINTER_OFFSET);
  const maskPointer = load<u32>(inputPointer + FORMULA_INPUT_MASK_POINTER_OFFSET);
  const maskByteLength = load<u32>(inputPointer + FORMULA_INPUT_MASK_BYTE_LENGTH_OFFSET);
  const valueCount = load<u32>(inputPointer + FORMULA_INPUT_VALUE_COUNT_OFFSET);
  const valueXPointer = load<u32>(inputPointer + FORMULA_INPUT_VALUE_X_POINTER_OFFSET);
  const valueYPointer = load<u32>(inputPointer + FORMULA_INPUT_VALUE_Y_POINTER_OFFSET);
  const valueDyPointer = load<u32>(inputPointer + FORMULA_INPUT_VALUE_DY_POINTER_OFFSET);
  const overflowRangePointer = load<u32>(inputPointer + FORMULA_INPUT_STEP_OVERFLOW_RANGE_POINTER_OFFSET);
  const overflowRangeCount = load<u32>(inputPointer + FORMULA_INPUT_STEP_OVERFLOW_RANGE_COUNT_OFFSET);
  const qualityTargetPlanePixels = load<f64>(
    inputPointer + FORMULA_INPUT_QUALITY_TARGET_PLANE_PIXELS_OFFSET,
  );
  const allowedFlags =
    FORMULA_FLAG_STEP_OVERFLOW_PROTECTION |
    FORMULA_FLAG_DISPLAY_ROUNDED_ANGLE |
    FORMULA_FLAG_HAS_USER_LAUNCH_ANGLE |
    FORMULA_FLAG_STEP_GLITCH_MODE |
    FORMULA_FLAG_STEP_GLITCH_FIXED_WINDOWS;
  const isStepGlitchModeEnabled = (flags & FORMULA_FLAG_STEP_GLITCH_MODE) != 0;
  const hasStepGlitchFixedWindows = (flags & FORMULA_FLAG_STEP_GLITCH_FIXED_WINDOWS) != 0;
  if (
    (algorithm != FORMULA_ALGORITHM_ABS &&
      algorithm != FORMULA_ALGORITHM_STEP &&
      algorithm != FORMULA_ALGORITHM_PCHIP &&
      algorithm != FORMULA_ALGORITHM_AKIMA) ||
    (equation != FORMULA_EQUATION_Y && equation != FORMULA_EQUATION_DY && equation != FORMULA_EQUATION_DDY) ||
    decimalPlaces < 0 ||
    decimalPlaces > 15 ||
    pointCount < 2 ||
    !isFiniteValue(centerX) ||
    !isFiniteValue(centerY) ||
    !isFiniteValue(finalSteepness) ||
    finalSteepness <= 0 ||
    !isFiniteValue(pathSteepness) ||
    pathSteepness <= 0 ||
    !isFiniteValue(boundsMinX) ||
    !isFiniteValue(boundsMaxX) ||
    !isFiniteValue(boundsMinY) ||
    !isFiniteValue(boundsMaxY) ||
    boundsMaxX == boundsMinX ||
    boundsMaxY == boundsMinY ||
    !isFiniteValue(qualityTargetPlanePixels) ||
    qualityTargetPlanePixels <= 0 ||
    (flags & ~allowedFlags) != 0 ||
    ((flags & FORMULA_FLAG_STEP_OVERFLOW_PROTECTION) != 0 && algorithm != FORMULA_ALGORITHM_STEP) ||
    (isStepGlitchModeEnabled &&
      (algorithm != FORMULA_ALGORITHM_STEP ||
        (equation != FORMULA_EQUATION_DY && equation != FORMULA_EQUATION_DDY))) ||
    (hasStepGlitchFixedWindows && !isStepGlitchModeEnabled) ||
    (maskPointer != 0 && !isStepGlitchModeEnabled) ||
    (maskPointer == 0 ? maskByteLength != 0 : maskByteLength == 0) ||
    ((flags & (FORMULA_FLAG_DISPLAY_ROUNDED_ANGLE | FORMULA_FLAG_HAS_USER_LAUNCH_ANGLE)) != 0 &&
      equation != FORMULA_EQUATION_DDY) ||
    valueCount != 0 ||
    valueXPointer != 0 ||
    valueYPointer != 0 ||
    valueDyPointer != 0 ||
    disabledSegmentPointer != 0 ||
    segmentStartXPointer != 0 ||
    segmentStartYPointer != 0 ||
    deltaYPointer != 0 ||
    (hasStepGlitchFixedWindows ? glitchSegmentPointer == 0 : glitchSegmentPointer != 0) ||
    absPulseDeltaSlopePointer != 0 ||
    absPulseCenterXPointer != 0 ||
    (overflowRangePointer == 0 ? overflowRangeCount != 0 : overflowRangeCount != 2) ||
    (algorithm == FORMULA_ALGORITHM_STEP ? overflowRangePointer == 0 : overflowRangePointer != 0)
  ) {
    trap();
  }

  const pointByteLength = checkedByteLength(pointCount, sizeof<f64>());
  const segmentCount = pointCount - 1;
  const segmentF64ByteLength = checkedByteLength(segmentCount, sizeof<f64>());
  const protectionByteLength = checkedByteLength(segmentCount, sizeof<u32>());
  if (hasStepGlitchFixedWindows) {
    requireArenaRange(
      glitchSegmentPointer,
      checkedByteLength(segmentCount, STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH),
      sizeof<f64>(),
    );
    let fixedWindowIndex: u32 = 0;
    while (fixedWindowIndex < segmentCount) {
      const fixedWindowPointer =
        glitchSegmentPointer + fixedWindowIndex * STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH;
      const presence = load<u32>(fixedWindowPointer + STEP_GLITCH_FIXED_WINDOW_PRESENCE_OFFSET);
      const startX = load<f64>(fixedWindowPointer + STEP_GLITCH_FIXED_WINDOW_START_X_OFFSET);
      const endX = load<f64>(fixedWindowPointer + STEP_GLITCH_FIXED_WINDOW_END_X_OFFSET);
      if (
        presence > 1 ||
        load<u32>(fixedWindowPointer + STEP_GLITCH_FIXED_WINDOW_RESERVED_OFFSET) != 0 ||
        (presence == 0
          ? startX != 0 || endX != 0
          : !isFiniteValue(startX) || !isFiniteValue(endX) || !(endX > startX))
      ) {
        trap();
      }
      fixedWindowIndex += 1;
    }
  }
  if (
    (protectionPointer == 0 ? protectionCount != 0 : protectionCount != segmentCount)
  ) {
    trap();
  }
  const planeLength = getGraphwarPlaneLength();
  const planeHeight = getGraphwarPlaneHeight();
  if (
    !(planeLength > 0) ||
    !(planeHeight > 0) ||
    planeLength != NativeMath.floor(planeLength) ||
    planeHeight != NativeMath.floor(planeHeight) ||
    planeLength > 0xffff_ffff ||
    planeHeight > 0xffff_ffff
  ) {
    trap();
  }
  const expectedMaskByteLength64 = <u64><u32>planeLength * <u32>planeHeight;
  if (expectedMaskByteLength64 > 0xffff_ffff || (maskPointer != 0 && maskByteLength != <u32>expectedMaskByteLength64)) {
    trap();
  }
  requireArenaRange(pointXPointer, pointByteLength, sizeof<f64>());
  requireArenaRange(pointYPointer, pointByteLength, sizeof<f64>());
  requireOptionalRange(protectionPointer, checkedByteLength(protectionCount, sizeof<u32>()), sizeof<u32>());
  requireOptionalRange(segmentStartXPointer, pointByteLength, sizeof<f64>());
  requireOptionalRange(segmentStartYPointer, pointByteLength, sizeof<f64>());
  requireOptionalRange(deltaYPointer, segmentF64ByteLength, sizeof<f64>());
  requireOptionalRange(maskPointer, maskByteLength, 1);
  requireOptionalRange(
    overflowRangePointer,
    checkedByteLength(overflowRangeCount, sizeof<f64>()),
    sizeof<f64>(),
  );
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
  if (overflowRangePointer != 0) {
    const rangeMinX = load<f64>(overflowRangePointer);
    const rangeMaxX = load<f64>(overflowRangePointer + sizeof<f64>());
    if (
      !isFiniteValue(rangeMinX) ||
      !isFiniteValue(rangeMaxX) ||
      rangeMinX != load<f64>(pointXPointer) ||
      rangeMaxX != NativeMath.max(boundsMinX, boundsMaxX)
    ) {
      trap();
    }
  }
  let userAngle = f64.NaN;
  const hasUserAngle = (flags & FORMULA_FLAG_HAS_USER_LAUNCH_ANGLE) != 0;
  if (hasUserAngle) {
    userAngle = load<f64>(inputPointer + FORMULA_INPUT_LAUNCH_ANGLE_OFFSET);
    if (!isFiniteValue(userAngle) || userAngle < -NativeMath.PI / 2 || userAngle > NativeMath.PI / 2) {
      trap();
    }
  }
  const isDisplayRounded = (flags & FORMULA_FLAG_DISPLAY_ROUNDED_ANGLE) != 0;
  const workingProtectionPointer = reserveArena(protectionByteLength, sizeof<u32>());
  if (protectionPointer == 0) {
    memory.fill(workingProtectionPointer, 0, protectionByteLength);
  } else {
    memory.copy(workingProtectionPointer, protectionPointer, protectionByteLength);
  }
  let totalIterationCount: u32 = 0;
  let totalFormulaPointIterationCount: u32 = 0;
  while (true) {
    const attemptMark = markArena();
    const attemptObservedProtectionPointer = reserveArena(protectionByteLength, sizeof<u32>());
    memory.fill(attemptObservedProtectionPointer, 0, protectionByteLength);
    const currentXPointer = reserveArena(pointByteLength, sizeof<f64>());
    const currentYPointer = reserveArena(pointByteLength, sizeof<f64>());
    const bestXPointer = reserveArena(pointByteLength, sizeof<f64>());
    const bestYPointer = reserveArena(pointByteLength, sizeof<f64>());
    const initialFormulaPointXPointer = reserveArena(pointByteLength, sizeof<f64>());
    const buildInputPointer = reserveArena(FORMULA_INPUT_BYTE_LENGTH, sizeof<u64>());
    memory.copy(buildInputPointer, inputPointer, FORMULA_INPUT_BYTE_LENGTH);
    if (algorithm == FORMULA_ALGORITHM_STEP) {
      const attemptOverflowRangePointer = reserveArena(2 * sizeof<f64>(), sizeof<f64>());
      memory.copy(attemptOverflowRangePointer, overflowRangePointer, 2 * sizeof<f64>());
      store<u32>(
        buildInputPointer + FORMULA_INPUT_STEP_OVERFLOW_RANGE_POINTER_OFFSET,
        attemptOverflowRangePointer,
      );
    }
    store<u32>(buildInputPointer + FORMULA_INPUT_VALUE_COUNT_OFFSET, 0);
    store<u32>(buildInputPointer + FORMULA_INPUT_VALUE_X_POINTER_OFFSET, 0);
    store<u32>(buildInputPointer + FORMULA_INPUT_VALUE_Y_POINTER_OFFSET, 0);
    store<u32>(buildInputPointer + FORMULA_INPUT_VALUE_DY_POINTER_OFFSET, 0);
    store<u32>(buildInputPointer + FORMULA_INPUT_ABS_PULSE_DELTA_SLOPE_POINTER_OFFSET, 0);
    store<u32>(buildInputPointer + FORMULA_INPUT_ABS_PULSE_CENTER_X_POINTER_OFFSET, 0);
    store<u32>(buildInputPointer + FORMULA_INPUT_GLITCH_SEGMENT_POINTER_OFFSET, 0);
    store<u32>(buildInputPointer + FORMULA_INPUT_SIGN_PROTECTION_POINTER_OFFSET, workingProtectionPointer);
    store<u32>(buildInputPointer + FORMULA_INPUT_SIGN_PROTECTION_COUNT_OFFSET, segmentCount);
    store<u32>(
      buildInputPointer + FORMULA_INPUT_FLAGS_OFFSET,
      algorithm == FORMULA_ALGORITHM_STEP && (flags & FORMULA_FLAG_STEP_OVERFLOW_PROTECTION) != 0
        ? FORMULA_FLAG_STEP_OVERFLOW_PROTECTION
        : 0,
    );

    let formulaPointIterationCount: u32 = 0;
    let hasBestFormulaPoints = false;
    let invalidLaunchReason = FORMULA_LAUNCH_INVALID_REASON_NONE;
    let formulaConstructionAngle = f64.NaN;
    if (algorithm == FORMULA_ALGORITHM_ABS && equation == FORMULA_EQUATION_DDY) {
      formulaConstructionAngle = resolveSecondOrderAngle(
        NativeMath.atan2(
          load<f64>(pointYPointer + sizeof<f64>()) - centerY,
          load<f64>(pointXPointer + sizeof<f64>()) - centerX,
        ),
        isDisplayRounded,
      );
      if (isFiniteValue(formulaConstructionAngle)) {
        writeFormulaPathPoints(
          inputPointer,
          pointXPointer,
          pointYPointer,
          bestXPointer,
          bestYPointer,
          moveX(centerX, formulaConstructionAngle),
          moveY(centerY, formulaConstructionAngle),
          true,
          pathSteepness,
        );
        const pulseDeltaSlopePointer = reserveArena(segmentF64ByteLength, sizeof<f64>());
        const pulseCenterXPointer = reserveArena(segmentF64ByteLength, sizeof<f64>());
        const refinedSegmentStartXPointer = reserveArena(pointByteLength, sizeof<f64>());
        const refinedSegmentStartYPointer = reserveArena(pointByteLength, sizeof<f64>());
        const invalidReasonPointer = reserveArena(sizeof<u32>(), sizeof<u32>());
        hasBestFormulaPoints = refineAbsSecondDerivativeLaunch(
          inputPointer,
          buildInputPointer,
          bestXPointer,
          bestYPointer,
          formulaConstructionAngle,
          workingProtectionPointer,
          attemptObservedProtectionPointer,
          pulseDeltaSlopePointer,
          pulseCenterXPointer,
          refinedSegmentStartXPointer,
          refinedSegmentStartYPointer,
          invalidReasonPointer,
        );
        invalidLaunchReason = load<u32>(invalidReasonPointer);
        if (!hasBestFormulaPoints && invalidLaunchReason == FORMULA_LAUNCH_INVALID_REASON_NONE) {
          invalidLaunchReason = FORMULA_LAUNCH_INVALID_REASON_ABS_SECOND_ORDER_TARGET_NOT_CONVERGED;
        }
      } else {
        invalidLaunchReason = FORMULA_LAUNCH_INVALID_REASON_SECOND_ORDER_ANGLE_NOT_FINITE;
      }
    } else {
      formulaPointIterationCount = resolveFormulaPathPointIdentity(
        buildInputPointer,
        pointXPointer,
        pointYPointer,
        currentXPointer,
        currentYPointer,
        bestXPointer,
        bestYPointer,
        centerX,
        centerY,
        pathSteepness,
        workingProtectionPointer,
        attemptObservedProtectionPointer,
        isDisplayRounded,
      );
      hasBestFormulaPoints = formulaPointIterationCount != 0;
      if (hasBestFormulaPoints) {
        memory.copy(initialFormulaPointXPointer, bestXPointer, pointByteLength);
      }
    }

    if (!hasBestFormulaPoints) {
      if (
        invalidLaunchReason == FORMULA_LAUNCH_INVALID_REASON_NONE &&
        (algorithm == FORMULA_ALGORITHM_PCHIP || algorithm == FORMULA_ALGORITHM_AKIMA)
      ) {
        invalidLaunchReason =
          equation == FORMULA_EQUATION_DDY
            ? FORMULA_LAUNCH_INVALID_REASON_SECOND_ORDER_ANGLE_NOT_FINITE
            : FORMULA_LAUNCH_INVALID_REASON_FORMULA_LAUNCH_POINT_NOT_FINITE;
      }
      totalFormulaPointIterationCount += formulaPointIterationCount;
      const hasProtectionChanged = mergeProtectionBits(
        attemptObservedProtectionPointer,
        workingProtectionPointer,
        segmentCount,
      );
      resetArena(attemptMark);
      if (hasProtectionChanged) {
        continue;
      }
      return writeLaunchResult(
        FORMULA_LAUNCH_STATUS_INVALID,
        0,
        totalFormulaPointIterationCount,
        f64.NaN,
        f64.NaN,
        f64.NaN,
        f64.NaN,
        f64.NaN,
        0,
        invalidLaunchReason,
        workingProtectionPointer,
        segmentCount,
        0,
        0,
        0,
      );
    }

    store<u32>(buildInputPointer + FORMULA_INPUT_POINT_X_POINTER_OFFSET, bestXPointer);
    store<u32>(buildInputPointer + FORMULA_INPUT_POINT_Y_POINTER_OFFSET, bestYPointer);
    store<f64>(buildInputPointer + FORMULA_INPUT_STEEPNESS_OFFSET, finalSteepness);
    const coldIterationPointer = reserveArena(sizeof<u32>(), sizeof<u32>());
    store<u32>(coldIterationPointer, 0);
    const acceptedHardLaunchAnglePointer = reserveArena(sizeof<f64>(), sizeof<f64>());
    store<f64>(acceptedHardLaunchAnglePointer, f64.NaN);
    const coldLaunchContextPointer = reserveArena(COLD_LAUNCH_CONTEXT_BYTE_LENGTH, sizeof<f64>());
    store<f64>(coldLaunchContextPointer + COLD_LAUNCH_CONTEXT_CENTER_X_OFFSET, centerX);
    store<f64>(coldLaunchContextPointer + COLD_LAUNCH_CONTEXT_CENTER_Y_OFFSET, centerY);
    store<f64>(coldLaunchContextPointer + COLD_LAUNCH_CONTEXT_USER_ANGLE_OFFSET, userAngle);
    store<u32>(coldLaunchContextPointer + COLD_LAUNCH_CONTEXT_ITERATION_POINTER_OFFSET, coldIterationPointer);
    store<u32>(
      coldLaunchContextPointer + COLD_LAUNCH_CONTEXT_FLAGS_OFFSET,
      (hasUserAngle ? COLD_LAUNCH_CONTEXT_FLAG_HAS_USER_ANGLE : 0) |
        (isDisplayRounded ? COLD_LAUNCH_CONTEXT_FLAG_DISPLAY_ROUNDED : 0),
    );
    let coldRefinementStatus = 1;
    if (algorithm == FORMULA_ALGORITHM_STEP && equation != FORMULA_EQUATION_Y) {
      coldRefinementStatus = refineStepFormulaCold(
        inputPointer,
        buildInputPointer,
        bestXPointer,
        bestYPointer,
        initialFormulaPointXPointer,
        attemptObservedProtectionPointer,
        acceptedHardLaunchAnglePointer,
        coldLaunchContextPointer,
        initializeStepColdRefinementLaunchState,
        resolveStepColdCandidateFormulaPoints,
      );
    } else if (algorithm == FORMULA_ALGORITHM_ABS && equation == FORMULA_EQUATION_DY) {
      coldRefinementStatus = collectAbsFirstOrderSegmentStartsCold(
        inputPointer,
        buildInputPointer,
        bestXPointer,
        bestYPointer,
        attemptObservedProtectionPointer,
        coldLaunchContextPointer,
        initializeColdRefinementLaunchState,
      );
    }
    const coldIterationCount = load<u32>(coldIterationPointer);
    if (
      coldRefinementStatus == STEP_COLD_REFINEMENT_PROTECTION_CHANGED ||
      coldRefinementStatus == ABS_FIRST_ORDER_COLD_REFINEMENT_PROTECTION_CHANGED
    ) {
      totalIterationCount += coldIterationCount;
      totalFormulaPointIterationCount += formulaPointIterationCount;
      if (!mergeProtectionBits(attemptObservedProtectionPointer, workingProtectionPointer, segmentCount)) {
        trap();
      }
      resetArena(attemptMark);
      continue;
    }
    if (
      coldRefinementStatus == STEP_COLD_REFINEMENT_INVALID ||
      coldRefinementStatus == ABS_FIRST_ORDER_COLD_REFINEMENT_INVALID
    ) {
      totalIterationCount += coldIterationCount;
      totalFormulaPointIterationCount += formulaPointIterationCount;
      const hasProtectionChanged = mergeProtectionBits(
        attemptObservedProtectionPointer,
        workingProtectionPointer,
        segmentCount,
      );
      resetArena(attemptMark);
      if (hasProtectionChanged) {
        continue;
      }
      return writeLaunchResult(
        FORMULA_LAUNCH_STATUS_INVALID,
        totalIterationCount,
        totalFormulaPointIterationCount,
        f64.NaN,
        f64.NaN,
        f64.NaN,
        f64.NaN,
        f64.NaN,
        0,
        0,
        workingProtectionPointer,
        segmentCount,
        0,
        0,
        0,
      );
    }
    if (
      (algorithm == FORMULA_ALGORITHM_STEP && equation != FORMULA_EQUATION_Y) ||
      (algorithm == FORMULA_ALGORITHM_ABS && equation == FORMULA_EQUATION_DY)
    ) {
      const refinedFormulaPointIterationCount = resolveFormulaPathPointIdentity(
        buildInputPointer,
        pointXPointer,
        pointYPointer,
        currentXPointer,
        currentYPointer,
        bestXPointer,
        bestYPointer,
        centerX,
        centerY,
        pathSteepness,
        workingProtectionPointer,
        attemptObservedProtectionPointer,
        isDisplayRounded,
      );
      formulaPointIterationCount += refinedFormulaPointIterationCount;
      if (refinedFormulaPointIterationCount == 0) {
        totalIterationCount += coldIterationCount;
        totalFormulaPointIterationCount += formulaPointIterationCount;
        const hasProtectionChanged = mergeProtectionBits(
          attemptObservedProtectionPointer,
          workingProtectionPointer,
          segmentCount,
        );
        resetArena(attemptMark);
        if (hasProtectionChanged) {
          continue;
        }
        return writeLaunchResult(
          FORMULA_LAUNCH_STATUS_INVALID,
          totalIterationCount,
          totalFormulaPointIterationCount,
          f64.NaN,
          f64.NaN,
          f64.NaN,
          f64.NaN,
          f64.NaN,
          0,
          0,
          workingProtectionPointer,
          segmentCount,
          0,
          0,
          0,
        );
      }
    }
    store<u32>(buildInputPointer + FORMULA_INPUT_POINT_X_POINTER_OFFSET, bestXPointer);
    store<u32>(buildInputPointer + FORMULA_INPUT_POINT_Y_POINTER_OFFSET, bestYPointer);
    store<f64>(buildInputPointer + FORMULA_INPUT_STEEPNESS_OFFSET, finalSteepness);
    const materialResultPointer =
      algorithm == FORMULA_ALGORITHM_STEP ? runStepLaunchBatch(buildInputPointer) : runCurveBatch(buildInputPointer);
    shareObservedProtection(materialResultPointer, attemptObservedProtectionPointer, segmentCount);
    const baseY = load<f64>(bestYPointer);
    const launchScratchMark = markArena();
    const iterationPointer = reserveArena(sizeof<u32>(), sizeof<u32>());
    store<u32>(iterationPointer, 0);
    let angle: f64;
    let resultFlags: u32 = 0;
    const acceptedHardLaunchAngle = load<f64>(acceptedHardLaunchAnglePointer);
    if (equation == FORMULA_EQUATION_Y) {
      angle = getNormalAngle(materialResultPointer, centerX, baseY, workingProtectionPointer, iterationPointer);
    } else if (equation == FORMULA_EQUATION_DY) {
      angle =
        algorithm == FORMULA_ALGORITHM_STEP && isFiniteValue(acceptedHardLaunchAngle)
          ? acceptedHardLaunchAngle
          : getFirstOrderAngle(
              materialResultPointer,
              centerX,
              centerY,
              baseY,
              workingProtectionPointer,
              iterationPointer,
            );
    } else if (hasUserAngle) {
      angle = userAngle;
      resultFlags |= FORMULA_LAUNCH_FLAG_USED_USER_ANGLE;
    } else if (algorithm == FORMULA_ALGORITHM_ABS) {
      angle = formulaConstructionAngle;
    } else if (isFiniteValue(acceptedHardLaunchAngle)) {
      angle = acceptedHardLaunchAngle;
    } else {
      angle = getSecondOrderAngle(
        materialResultPointer,
        centerX,
        centerY,
        baseY,
        workingProtectionPointer,
        isDisplayRounded,
        iterationPointer,
      );
    }
    const iterationCount = load<u32>(iterationPointer);
    const shouldUseCenter = equation == FORMULA_EQUATION_Y && !isFiniteValue(angle);
    const launchX = shouldUseCenter ? centerX : moveX(centerX, angle);
    const launchY = shouldUseCenter ? centerY : moveY(centerY, angle);
    let initialDy = 0.0;
    let yOffset = 0.0;
    if (equation == FORMULA_EQUATION_DDY) {
      initialDy = NativeMath.tan(angle);
    } else if (equation == FORMULA_EQUATION_Y) {
      yOffset =
        launchY -
        evaluateFormulaMaterialValue(
          materialResultPointer,
          FORMULA_EQUATION_Y,
          launchX,
          0,
          0,
          baseY,
          workingProtectionPointer,
        );
    }
    resetArena(launchScratchMark);
    const isValid =
      isFiniteValue(launchX) &&
      isFiniteValue(launchY) &&
      (equation != FORMULA_EQUATION_DY || isFiniteValue(angle)) &&
      (equation != FORMULA_EQUATION_DDY || (isFiniteValue(angle) && isFiniteValue(initialDy))) &&
      (equation != FORMULA_EQUATION_Y || isFiniteValue(yOffset));
    if (isValid) {
      if (equation == FORMULA_EQUATION_DDY) {
        resultFlags |= FORMULA_LAUNCH_FLAG_HAS_INITIAL_DY;
      } else if (equation == FORMULA_EQUATION_Y) {
        resultFlags |= FORMULA_LAUNCH_FLAG_HAS_Y_OFFSET;
      }
    } else {
      resultFlags = 0;
    }
    totalIterationCount += coldIterationCount + iterationCount;
    totalFormulaPointIterationCount += formulaPointIterationCount;
    const hasProtectionChanged = mergeProtectionBits(
      attemptObservedProtectionPointer,
      workingProtectionPointer,
      segmentCount,
    );
    if (hasProtectionChanged) {
      resetArena(attemptMark);
      continue;
    }
    if (!isValid) {
      if (algorithm == FORMULA_ALGORITHM_PCHIP || algorithm == FORMULA_ALGORITHM_AKIMA) {
        invalidLaunchReason =
          equation == FORMULA_EQUATION_DDY
            ? FORMULA_LAUNCH_INVALID_REASON_SECOND_ORDER_ANGLE_NOT_FINITE
            : FORMULA_LAUNCH_INVALID_REASON_FORMULA_LAUNCH_POINT_NOT_FINITE;
      }
      resetArena(attemptMark);
      return writeLaunchResult(
        FORMULA_LAUNCH_STATUS_INVALID,
        totalIterationCount,
        totalFormulaPointIterationCount,
        angle,
        launchX,
        launchY,
        initialDy,
        yOffset,
        0,
        0,
        workingProtectionPointer,
        segmentCount,
        0,
        0,
        0,
      );
    }
    store<u32>(materialResultPointer + FORMULA_RESULT_PROTECTION_POINTER_OFFSET, workingProtectionPointer);
    store<u32>(materialResultPointer + FORMULA_RESULT_PROTECTION_COUNT_OFFSET, segmentCount);
    // Keep the exact refinement arrays attached to the retained launch input. Production Step-glitch
    // evidence copies these pointers before the nested replay arena is reset.
    store<u32>(
      inputPointer + FORMULA_INPUT_SEGMENT_START_X_POINTER_OFFSET,
      load<u32>(buildInputPointer + FORMULA_INPUT_SEGMENT_START_X_POINTER_OFFSET),
    );
    store<u32>(
      inputPointer + FORMULA_INPUT_SEGMENT_START_Y_POINTER_OFFSET,
      load<u32>(buildInputPointer + FORMULA_INPUT_SEGMENT_START_Y_POINTER_OFFSET),
    );
    store<u32>(
      inputPointer + FORMULA_INPUT_STEP_DELTA_Y_POINTER_OFFSET,
      load<u32>(buildInputPointer + FORMULA_INPUT_STEP_DELTA_Y_POINTER_OFFSET),
    );
    commitArena(attemptMark);
    return writeLaunchResult(
      FORMULA_LAUNCH_STATUS_SUCCESS,
      totalIterationCount,
      totalFormulaPointIterationCount,
      angle,
      launchX,
      launchY,
      initialDy,
      yOffset,
      materialResultPointer,
      resultFlags,
      workingProtectionPointer,
      segmentCount,
      bestXPointer,
      bestYPointer,
      pointCount,
    );
  }
  trap();
  return 0;
}
