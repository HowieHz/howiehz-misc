import { FORMULA_ALGORITHM_STEP, FORMULA_EQUATION_DDY, FORMULA_EQUATION_DY } from "./formula-layout";
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
