import { FORMULA_ALGORITHM_STEP, FORMULA_EQUATION_DDY, FORMULA_EQUATION_DY } from "./formula-layout";
import { floorFormulaDecimal, roundFormulaDecimal } from "./decimal";
import { getGraphwarPlaneHeight, getGraphwarPlaneLength } from "./game-constants";
import { requireArenaRange, reserveArena } from "./memory";
import * as Layout from "./step-glitch-layout";

@inline
function trap(): void {
  unreachable();
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
    (hasPrefixTarget == 0 && (prefixTargetX != 0 || prefixTargetY != 0 || prefixTargetRadius != 0))
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
    algorithm != <f64>FORMULA_ALGORITHM_STEP ||
    (equation != <f64>FORMULA_EQUATION_DY && equation != <f64>FORMULA_EQUATION_DDY) ||
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
  if (evidenceValueCount != 6) trap();
  requireElementRange(
    load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_EVIDENCE_VALUES_POINTER_OFFSET),
    evidenceValueCount,
    sizeof<f64>(),
    sizeof<f64>(),
  );

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
    if (boundaryType != 1 || boundaryStateLength != 11) trap();
    requireElementRange(boundaryIdentityPointer, boundaryIdentityLength, sizeof<u8>(), sizeof<u8>());
    requireElementRange(boundaryStatePointer, boundaryStateLength, sizeof<f64>(), sizeof<f64>());
  }

  const pointCount = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_POINTS_COUNT_OFFSET);
  const initialCount = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_INITIAL_COUNT_OFFSET);
  const refinedCount = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_REFINED_COUNT_OFFSET);
  if (pointCount == 0 || initialCount != pointCount || refinedCount != pointCount) trap();
  requireElementRange(load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_INITIAL_X_POINTER_OFFSET), pointCount, sizeof<f64>(), sizeof<f64>());
  requireElementRange(load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_INITIAL_Y_POINTER_OFFSET), pointCount, sizeof<f64>(), sizeof<f64>());
  requireElementRange(load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_POINTS_X_POINTER_OFFSET), pointCount, sizeof<f64>(), sizeof<f64>());
  requireElementRange(load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_POINTS_Y_POINTER_OFFSET), pointCount, sizeof<f64>(), sizeof<f64>());
  requireElementRange(load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_REFINED_X_POINTER_OFFSET), pointCount, sizeof<f64>(), sizeof<f64>());
  requireElementRange(load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_REFINED_Y_POINTER_OFFSET), pointCount, sizeof<f64>(), sizeof<f64>());

  const metadataLength = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_METADATA_LENGTH_OFFSET);
  if (metadataLength != 9) trap();
  requireElementRange(load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_METADATA_POINTER_OFFSET), metadataLength, sizeof<f64>(), sizeof<f64>());
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
  requireElementRange(load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_SEGMENT_START_X_POINTER_OFFSET), segmentCount, sizeof<f64>(), sizeof<f64>());
  requireElementRange(load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_SEGMENT_START_Y_POINTER_OFFSET), segmentCount, sizeof<f64>(), sizeof<f64>());
  requireElementRange(load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_SEGMENT_START_PRESENCE_POINTER_OFFSET), segmentCount, sizeof<u8>(), sizeof<u8>());
  const settingsLength = load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_SETTINGS_LENGTH_OFFSET);
  if (settingsLength != Layout.STEP_GLITCH_SETTINGS_VALUE_COUNT || load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_SETTINGS_MASK_TAG_OFFSET) > 3) trap();
  requireElementRange(load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_SETTINGS_POINTER_OFFSET), settingsLength, sizeof<f64>(), sizeof<f64>());
  requireElementRange(load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_SIGN_PROTECTION_POINTER_OFFSET), segmentCount, sizeof<u32>(), sizeof<u32>());
  requireElementRange(load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_REQUIREMENTS_POINTER_OFFSET), segmentCount, sizeof<u8>(), sizeof<u8>());
  requireElementRange(load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_SEGMENTS_POINTER_OFFSET), segmentCount * 10, sizeof<f64>(), sizeof<f64>());
  requireElementRange(load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_DELTA_VALUES_POINTER_OFFSET), segmentCount, sizeof<f64>(), sizeof<f64>());
  requireElementRange(load<u32>(pointer + Layout.STEP_GLITCH_PREFIX_DELTA_PRESENCE_POINTER_OFFSET), segmentCount, sizeof<u8>(), sizeof<u8>());
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
  if (inputByteLength != Layout.STEP_GLITCH_CREATE_INPUT_BYTE_LENGTH) trap();
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

@inline
function getFarthestFreeX(contextPointer: u32, searchX: i32, row: i32): i32 {
  const width = <i32>getGraphwarPlaneLength();
  const height = <i32>getGraphwarPlaneHeight();
  if (searchX < 0 || searchX >= width || row < 0 || row >= height) return -1;
  const indexPointer = load<u32>(contextPointer + Layout.STEP_GLITCH_CONTEXT_FARTHEST_FREE_X_POINTER_OFFSET);
  return <i32>load<i16>(indexPointer + <u32>(row * width + searchX) * sizeof<i16>());
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
