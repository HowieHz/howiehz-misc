import {
  DETECTION_CANDIDATE_BYTE_LENGTH,
  DETECTION_INPUT_BYTE_LENGTH,
  DETECTION_INPUT_CANDIDATE_COUNT_OFFSET,
  DETECTION_INPUT_CANDIDATE_POINTER_OFFSET,
  DETECTION_INPUT_EDGE_LENGTH_OFFSET,
  DETECTION_INPUT_EDGE_POINTER_OFFSET,
  DETECTION_INPUT_HEIGHT_OFFSET,
  DETECTION_INPUT_MATCH_COUNT_OFFSET,
  DETECTION_INPUT_MATCH_POINTER_OFFSET,
  DETECTION_INPUT_PHASE_OFFSET,
  DETECTION_INPUT_RESERVED_OFFSET,
  DETECTION_INPUT_RGBA_BYTE_LENGTH_OFFSET,
  DETECTION_INPUT_RGBA_POINTER_OFFSET,
  DETECTION_INPUT_SETTINGS_LENGTH_OFFSET,
  DETECTION_INPUT_SETTINGS_POINTER_OFFSET,
  DETECTION_INPUT_SESSION_EDGE_HEIGHT_OFFSET,
  DETECTION_INPUT_SESSION_EDGE_WIDTH_OFFSET,
  DETECTION_INPUT_SESSION_EDGE_X_OFFSET,
  DETECTION_INPUT_SESSION_EDGE_Y_OFFSET,
  DETECTION_INPUT_SOURCE_MASK_POINTER_OFFSET,
  DETECTION_INPUT_TASK_OFFSET,
  DETECTION_INPUT_WIDTH_OFFSET,
  DETECTION_RESULT_BYTE_LENGTH,
  DETECTION_RESULT_CANDIDATE_COUNT_OFFSET,
  DETECTION_RESULT_CANDIDATE_POINTER_OFFSET,
  DETECTION_RESULT_COMPLETE,
  DETECTION_RESULT_RUNNING,
  DETECTION_RESULT_EDGE_HEIGHT_OFFSET,
  DETECTION_RESULT_EDGE_WIDTH_OFFSET,
  DETECTION_RESULT_EDGE_X_OFFSET,
  DETECTION_RESULT_EDGE_Y_OFFSET,
  DETECTION_RESULT_FLAGS_OFFSET,
  DETECTION_RESULT_FLAG_HAS_EDGE_RECT,
  DETECTION_RESULT_MATCH_COUNT_OFFSET,
  DETECTION_RESULT_MATCH_POINTER_OFFSET,
  DETECTION_RESULT_MASK_LENGTH_OFFSET,
  DETECTION_RESULT_MASK_POINTER_OFFSET,
  DETECTION_RESULT_OBSTACLE_COUNT_OFFSET,
  DETECTION_RESULT_SESSION_POINTER_OFFSET,
  DETECTION_RESULT_STAGE_COUNT_OFFSET,
  DETECTION_RESULT_STAGE_POINTER_OFFSET,
  DETECTION_RESULT_STATE_OFFSET,
  DETECTION_RESULT_TASK_OFFSET,
  DETECTION_RESULT_WORK_COUNT_OFFSET,
  DETECTION_RESULT_WORK_POINTER_OFFSET,
  DETECTION_SHARD_BYTE_LENGTH,
  DETECTION_STAGE_BOUNDS_END,
  DETECTION_STAGE_BOUNDS_START,
  DETECTION_STAGE_CANDIDATES_END,
  DETECTION_STAGE_CANDIDATES_START,
  DETECTION_STAGE_COMPONENTS_END,
  DETECTION_STAGE_COMPONENTS_START,
  DETECTION_STAGE_OBSTACLE_MASK_END,
  DETECTION_STAGE_OBSTACLE_MASK_START,
  DETECTION_STAGE_TEMPLATES_END,
  DETECTION_STAGE_TEMPLATES_START,
  DETECTION_TASK_AUTO,
  DETECTION_TASK_BOUNDS_ONLY,
  DETECTION_TASK_KNOWN_BOUNDS,
  DETECTION_TEMPLATE_SHARD_RESULT_BYTE_LENGTH,
  DETECTION_MATCH_BYTE_LENGTH,
} from "./detection-layout";
import {
  buildDetectionObstacleSourceMask,
  filterDetectionObstacleComponents,
  getDetectionObstacleMaskLength,
} from "./detection-obstacle";
import {
  collectDetectionCandidates,
  detectionMatchCandidateIndexOffset,
  finalizeDetectionTemplateMatches,
  scoreDetectionTemplateCandidates,
  validateDetectionTemplateTables,
} from "./detection-template";
import { markArena, requireArenaInitialized, requireArenaRange, reserveArena, resetArena } from "./memory";

const SETTINGS_LENGTH: u32 = 4;
const EDGE_LENGTH: u32 = 4;
const AXIS_GROUP_BYTE_LENGTH: u32 = 24;
const AXIS_GROUP_START_OFFSET: u32 = 0;
const AXIS_GROUP_END_OFFSET: u32 = 4;
const AXIS_GROUP_COORDINATE_OFFSET: u32 = 8;
const AXIS_GROUP_SCORE_OFFSET: u32 = 16;
const AXIS_GROUP_LIMIT: u32 = 12;
const AXIS_TRIPLET_BYTE_LENGTH: u32 = 24;
const AXIS_TRIPLET_FIRST_OFFSET: u32 = 0;
const AXIS_TRIPLET_MIDDLE_OFFSET: u32 = 4;
const AXIS_TRIPLET_LAST_OFFSET: u32 = 8;
const AXIS_TRIPLET_SCORE_OFFSET: u32 = 16;
const AXIS_TRIPLET_LIMIT: u32 = 16;
const DETECTION_SESSION_PHASE_BOUNDS_PENDING: u32 = 1;
const DETECTION_SESSION_PHASE_CANDIDATES_PENDING: u32 = 2;
const DETECTION_SESSION_PHASE_TEMPLATES_PENDING: u32 = 3;
const DETECTION_SESSION_PHASE_OBSTACLE_MASK_PENDING: u32 = 4;
const DETECTION_SESSION_PHASE_COMPONENTS_PENDING: u32 = 5;
const DETECTION_SESSION_PHASE_COMPLETE: u32 = 6;

@inline
function trap(): void {
  unreachable();
}

@inline
function isFinitePositiveValue(value: f64): bool {
  return isFinite(value) && value > 0;
}

@inline
function isAxisBlackPixel(rgbaPointer: u32, pixelIndex: u32): bool {
  const pixelPointer = rgbaPointer + pixelIndex * 4;
  return load<u8>(pixelPointer) <= 42 && load<u8>(pixelPointer + 1) <= 42 && load<u8>(pixelPointer + 2) <= 42;
}

/** Validates and retains a detection command before any externally observable algorithm stage begins. */
export function beginDetectionTask(inputPointer: u32, inputByteLength: u32): u32 {
  requireArenaInitialized();
  if (inputByteLength != DETECTION_INPUT_BYTE_LENGTH) {
    trap();
  }
  requireArenaRange(inputPointer, inputByteLength, sizeof<u64>());

  const task = load<u32>(inputPointer + DETECTION_INPUT_TASK_OFFSET);
  if (task < DETECTION_TASK_BOUNDS_ONLY || task > DETECTION_TASK_KNOWN_BOUNDS) {
    trap();
  }
  const width = load<u32>(inputPointer + DETECTION_INPUT_WIDTH_OFFSET);
  const height = load<u32>(inputPointer + DETECTION_INPUT_HEIGHT_OFFSET);
  const rgbaPointer = load<u32>(inputPointer + DETECTION_INPUT_RGBA_POINTER_OFFSET);
  const rgbaByteLength = load<u32>(inputPointer + DETECTION_INPUT_RGBA_BYTE_LENGTH_OFFSET);
  if (width == 0 || height == 0 || <u64>width * height * 4 != rgbaByteLength) {
    trap();
  }
  requireArenaRange(rgbaPointer, rgbaByteLength, 1);
  if (load<u32>(inputPointer + DETECTION_INPUT_RESERVED_OFFSET) != 0) {
    trap();
  }

  const settingsPointer = load<u32>(inputPointer + DETECTION_INPUT_SETTINGS_POINTER_OFFSET);
  const settingsLength = load<u32>(inputPointer + DETECTION_INPUT_SETTINGS_LENGTH_OFFSET);
  const edgePointer = load<u32>(inputPointer + DETECTION_INPUT_EDGE_POINTER_OFFSET);
  const edgeLength = load<u32>(inputPointer + DETECTION_INPUT_EDGE_LENGTH_OFFSET);
  if (task == DETECTION_TASK_BOUNDS_ONLY) {
    if (settingsPointer != 0 || settingsLength != 0 || edgePointer != 0 || edgeLength != 0) {
      trap();
    }
  } else {
    validateSettings(settingsPointer, settingsLength);
    validateDetectionTemplateTables(inputPointer);
    if (task == DETECTION_TASK_AUTO) {
      if (edgePointer != 0 || edgeLength != 0) {
        trap();
      }
    } else {
      validateEdgeRect(edgePointer, edgeLength);
    }
  }

  if (task == DETECTION_TASK_KNOWN_BOUNDS) {
    const edgeX = load<f64>(edgePointer);
    const edgeY = load<f64>(edgePointer + sizeof<f64>());
    const edgeWidth = load<f64>(edgePointer + 2 * sizeof<f64>());
    const edgeHeight = load<f64>(edgePointer + 3 * sizeof<f64>());
    storeSessionEdge(inputPointer, edgeX, edgeY, edgeWidth, edgeHeight);
    store<u32>(inputPointer + DETECTION_INPUT_PHASE_OFFSET, DETECTION_SESSION_PHASE_CANDIDATES_PENDING);
    return writeDetectionResult(
      task,
      DETECTION_RESULT_RUNNING,
      inputPointer,
      DETECTION_STAGE_CANDIDATES_START,
      0,
      0,
      0,
      0,
      0,
      edgeX,
      edgeY,
      edgeWidth,
      edgeHeight,
    );
  }
  store<u32>(inputPointer + DETECTION_INPUT_PHASE_OFFSET, DETECTION_SESSION_PHASE_BOUNDS_PENDING);
  return writeDetectionResult(task, DETECTION_RESULT_RUNNING, inputPointer, DETECTION_STAGE_BOUNDS_START, 0, 0, 0, 0, 0, 0, 0, 0, 0);
}

/** Executes one exact retained phase after the Adapter has observed the preceding stage marker. */
export function resumeDetectionTask(sessionPointer: u32, workPointer: u32, workCount: u32): u32 {
  requireArenaInitialized();
  requireArenaRange(sessionPointer, DETECTION_INPUT_BYTE_LENGTH, sizeof<u64>());
  const task = load<u32>(sessionPointer + DETECTION_INPUT_TASK_OFFSET);
  const phase = load<u32>(sessionPointer + DETECTION_INPUT_PHASE_OFFSET);
  if (phase == DETECTION_SESSION_PHASE_BOUNDS_PENDING) {
    if ((task != DETECTION_TASK_BOUNDS_ONLY && task != DETECTION_TASK_AUTO) || workPointer != 0 || workCount != 0) {
      trap();
    }
    return resumeBounds(sessionPointer, task);
  }
  if (phase == DETECTION_SESSION_PHASE_CANDIDATES_PENDING) {
    if (task == DETECTION_TASK_BOUNDS_ONLY || workPointer != 0 || workCount != 0) {
      trap();
    }
    return resumeCandidates(sessionPointer, task);
  }
  if (phase == DETECTION_SESSION_PHASE_TEMPLATES_PENDING) {
    if (task == DETECTION_TASK_BOUNDS_ONLY) {
      trap();
    }
    return resumeTemplates(sessionPointer, task, workPointer, workCount);
  }
  if (phase == DETECTION_SESSION_PHASE_OBSTACLE_MASK_PENDING) {
    if (task == DETECTION_TASK_BOUNDS_ONLY || workPointer != 0 || workCount != 0) trap();
    return resumeObstacleMask(sessionPointer, task);
  }
  if (phase == DETECTION_SESSION_PHASE_COMPONENTS_PENDING) {
    if (task == DETECTION_TASK_BOUNDS_ONLY || workPointer != 0 || workCount != 0) trap();
    return resumeObstacleComponents(sessionPointer, task);
  }
  trap();
  return 0;
}

function resumeBounds(sessionPointer: u32, task: u32): u32 {
  const width = load<u32>(sessionPointer + DETECTION_INPUT_WIDTH_OFFSET);
  const height = load<u32>(sessionPointer + DETECTION_INPUT_HEIGHT_OFFSET);
  const rgbaPointer = load<u32>(sessionPointer + DETECTION_INPUT_RGBA_POINTER_OFFSET);
  const rgbaByteLength = load<u32>(sessionPointer + DETECTION_INPUT_RGBA_BYTE_LENGTH_OFFSET);
  if (width == 0 || height == 0 || <u64>width * height * 4 != rgbaByteLength) {
    trap();
  }
  requireArenaRange(rgbaPointer, rgbaByteLength, 1);
  const scratchMark = markArena();
  const edgeOutputPointer = reserveArena(EDGE_LENGTH * sizeof<f64>(), sizeof<f64>());
  const hasEdgeRect = detectPlayArea(rgbaPointer, width, height, edgeOutputPointer);
  const edgeX = hasEdgeRect ? load<f64>(edgeOutputPointer) : 0;
  const edgeY = hasEdgeRect ? load<f64>(edgeOutputPointer + sizeof<f64>()) : 0;
  const edgeWidth = hasEdgeRect ? load<f64>(edgeOutputPointer + 2 * sizeof<f64>()) : 0;
  const edgeHeight = hasEdgeRect ? load<f64>(edgeOutputPointer + 3 * sizeof<f64>()) : 0;
  resetArena(scratchMark);
  const state =
    task == DETECTION_TASK_BOUNDS_ONLY || (task == DETECTION_TASK_AUTO && !hasEdgeRect)
      ? DETECTION_RESULT_COMPLETE
      : DETECTION_RESULT_RUNNING;
  if (state == DETECTION_RESULT_RUNNING) {
    storeSessionEdge(sessionPointer, edgeX, edgeY, edgeWidth, edgeHeight);
  }
  store<u32>(sessionPointer + DETECTION_INPUT_PHASE_OFFSET, state == DETECTION_RESULT_RUNNING ? DETECTION_SESSION_PHASE_CANDIDATES_PENDING : DETECTION_SESSION_PHASE_COMPLETE);
  return writeDetectionResult(
    task,
    state,
    state == DETECTION_RESULT_RUNNING ? sessionPointer : 0,
    DETECTION_STAGE_BOUNDS_END,
    state == DETECTION_RESULT_RUNNING ? DETECTION_STAGE_CANDIDATES_START : 0,
    0,
    0,
    0,
    0,
    edgeX,
    edgeY,
    edgeWidth,
    edgeHeight,
  );
}

function resumeCandidates(sessionPointer: u32, task: u32): u32 {
  collectDetectionCandidates(sessionPointer);
  const candidatePointer = load<u32>(sessionPointer + DETECTION_INPUT_CANDIDATE_POINTER_OFFSET);
  const candidateCount = load<u32>(sessionPointer + DETECTION_INPUT_CANDIDATE_COUNT_OFFSET);
  const settingsPointer = load<u32>(sessionPointer + DETECTION_INPUT_SETTINGS_POINTER_OFFSET);
  const requestedWorkerCount = <u32>load<f64>(settingsPointer + 3 * sizeof<f64>());
  const shardCount =
    requestedWorkerCount > 1 && candidateCount > 1
      ? requestedWorkerCount < candidateCount
        ? requestedWorkerCount
        : candidateCount
      : 0;
  const shardsPointer = shardCount == 0 ? 0 : reserveArena(shardCount * DETECTION_SHARD_BYTE_LENGTH, sizeof<u32>());
  for (let shardIndex: u32 = 0; shardIndex < shardCount; shardIndex += 1) {
    const shard = shardsPointer + shardIndex * DETECTION_SHARD_BYTE_LENGTH;
    const start = <u32>((<u64>shardIndex * candidateCount) / shardCount);
    const end = <u32>((<u64>(shardIndex + 1) * candidateCount) / shardCount);
    store<u32>(shard, shardIndex + 1);
    store<u32>(shard + 4, start);
    store<u32>(shard + 8, end - start);
    store<u32>(shard + 12, 0);
  }
  store<u32>(sessionPointer + DETECTION_INPUT_PHASE_OFFSET, DETECTION_SESSION_PHASE_TEMPLATES_PENDING);
  return writeDetectionResult(
    task,
    DETECTION_RESULT_RUNNING,
    sessionPointer,
    DETECTION_STAGE_CANDIDATES_END,
    DETECTION_STAGE_TEMPLATES_START,
    shardsPointer,
    shardCount,
    candidatePointer,
    candidateCount,
    load<f64>(sessionPointer + DETECTION_INPUT_SESSION_EDGE_X_OFFSET),
    load<f64>(sessionPointer + DETECTION_INPUT_SESSION_EDGE_Y_OFFSET),
    load<f64>(sessionPointer + DETECTION_INPUT_SESSION_EDGE_WIDTH_OFFSET),
    load<f64>(sessionPointer + DETECTION_INPUT_SESSION_EDGE_HEIGHT_OFFSET),
  );
}

function resumeTemplates(sessionPointer: u32, task: u32, workPointer: u32, workCount: u32): u32 {
  const candidatePointer = load<u32>(sessionPointer + DETECTION_INPUT_CANDIDATE_POINTER_OFFSET);
  const candidateCount = load<u32>(sessionPointer + DETECTION_INPUT_CANDIDATE_COUNT_OFFSET);
  let rawMatchesPointer = workPointer;
  if (workPointer == 0 && workCount == 0) {
    rawMatchesPointer = scoreDetectionTemplateCandidates(sessionPointer, candidatePointer, candidateCount);
    workCount = candidateCount;
  } else {
    if (workCount != candidateCount) {
      trap();
    }
    requireArenaRange(workPointer, workCount * DETECTION_MATCH_BYTE_LENGTH, sizeof<f64>());
    for (let index: u32 = 0; index < workCount; index += 1) {
      if (load<u32>(workPointer + index * DETECTION_MATCH_BYTE_LENGTH + detectionMatchCandidateIndexOffset) != index) {
        trap();
      }
    }
  }
  finalizeDetectionTemplateMatches(sessionPointer, rawMatchesPointer, workCount);
  store<u32>(sessionPointer + DETECTION_INPUT_PHASE_OFFSET, DETECTION_SESSION_PHASE_OBSTACLE_MASK_PENDING);
  return writeDetectionResult(
    task,
    DETECTION_RESULT_RUNNING,
    sessionPointer,
    DETECTION_STAGE_TEMPLATES_END,
    DETECTION_STAGE_OBSTACLE_MASK_START,
    0,
    0,
    candidatePointer,
    candidateCount,
    load<f64>(sessionPointer + DETECTION_INPUT_SESSION_EDGE_X_OFFSET),
    load<f64>(sessionPointer + DETECTION_INPUT_SESSION_EDGE_Y_OFFSET),
    load<f64>(sessionPointer + DETECTION_INPUT_SESSION_EDGE_WIDTH_OFFSET),
    load<f64>(sessionPointer + DETECTION_INPUT_SESSION_EDGE_HEIGHT_OFFSET),
  );
}

function resumeObstacleMask(sessionPointer: u32, task: u32): u32 {
  const maskLength = getDetectionObstacleMaskLength();
  const sourceMaskPointer = reserveArena(maskLength, 1);
  const scratchMark = markArena();
  buildDetectionObstacleSourceMask(sessionPointer, sourceMaskPointer);
  resetArena(scratchMark);
  store<u32>(sessionPointer + DETECTION_INPUT_SOURCE_MASK_POINTER_OFFSET, sourceMaskPointer);
  store<u32>(sessionPointer + DETECTION_INPUT_PHASE_OFFSET, DETECTION_SESSION_PHASE_COMPONENTS_PENDING);
  return writeDetectionResult(
    task,
    DETECTION_RESULT_RUNNING,
    sessionPointer,
    DETECTION_STAGE_OBSTACLE_MASK_END,
    DETECTION_STAGE_COMPONENTS_START,
    0,
    0,
    load<u32>(sessionPointer + DETECTION_INPUT_CANDIDATE_POINTER_OFFSET),
    load<u32>(sessionPointer + DETECTION_INPUT_CANDIDATE_COUNT_OFFSET),
    load<f64>(sessionPointer + DETECTION_INPUT_SESSION_EDGE_X_OFFSET),
    load<f64>(sessionPointer + DETECTION_INPUT_SESSION_EDGE_Y_OFFSET),
    load<f64>(sessionPointer + DETECTION_INPUT_SESSION_EDGE_WIDTH_OFFSET),
    load<f64>(sessionPointer + DETECTION_INPUT_SESSION_EDGE_HEIGHT_OFFSET),
  );
}

function resumeObstacleComponents(sessionPointer: u32, task: u32): u32 {
  const maskLength = getDetectionObstacleMaskLength();
  const finalMaskPointer = reserveArena(maskLength, 1);
  const scratchMark = markArena();
  const obstacleCount = filterDetectionObstacleComponents(
    sessionPointer,
    load<u32>(sessionPointer + DETECTION_INPUT_SOURCE_MASK_POINTER_OFFSET),
    finalMaskPointer,
  );
  resetArena(scratchMark);
  store<u32>(sessionPointer + DETECTION_INPUT_PHASE_OFFSET, DETECTION_SESSION_PHASE_COMPLETE);
  const resultPointer = writeDetectionResult(
    task,
    DETECTION_RESULT_COMPLETE,
    0,
    DETECTION_STAGE_COMPONENTS_END,
    0,
    0,
    0,
    0,
    0,
    load<f64>(sessionPointer + DETECTION_INPUT_SESSION_EDGE_X_OFFSET),
    load<f64>(sessionPointer + DETECTION_INPUT_SESSION_EDGE_Y_OFFSET),
    load<f64>(sessionPointer + DETECTION_INPUT_SESSION_EDGE_WIDTH_OFFSET),
    load<f64>(sessionPointer + DETECTION_INPUT_SESSION_EDGE_HEIGHT_OFFSET),
  );
  store<u32>(resultPointer + DETECTION_RESULT_MATCH_POINTER_OFFSET, load<u32>(sessionPointer + DETECTION_INPUT_MATCH_POINTER_OFFSET));
  store<u32>(resultPointer + DETECTION_RESULT_MATCH_COUNT_OFFSET, load<u32>(sessionPointer + DETECTION_INPUT_MATCH_COUNT_OFFSET));
  store<u32>(resultPointer + DETECTION_RESULT_MASK_POINTER_OFFSET, finalMaskPointer);
  store<u32>(resultPointer + DETECTION_RESULT_MASK_LENGTH_OFFSET, maskLength);
  store<u32>(resultPointer + DETECTION_RESULT_OBSTACLE_COUNT_OFFSET, obstacleCount);
  return resultPointer;
}

/** Scores one child Worker shard through the same canonical template implementation as the main instance. */
export function runDetectionTemplateShard(inputPointer: u32, inputByteLength: u32): u32 {
  requireArenaInitialized();
  if (inputByteLength != DETECTION_INPUT_BYTE_LENGTH) trap();
  requireArenaRange(inputPointer, inputByteLength, sizeof<u64>());
  validateDetectionCommand(inputPointer, true);
  const candidatePointer = load<u32>(inputPointer + DETECTION_INPUT_CANDIDATE_POINTER_OFFSET);
  const candidateCount = load<u32>(inputPointer + DETECTION_INPUT_CANDIDATE_COUNT_OFFSET);
  const matchesPointer = scoreDetectionTemplateCandidates(inputPointer, candidatePointer, candidateCount);
  const resultPointer = reserveArena(DETECTION_TEMPLATE_SHARD_RESULT_BYTE_LENGTH, sizeof<u64>());
  memory.fill(resultPointer, 0, DETECTION_TEMPLATE_SHARD_RESULT_BYTE_LENGTH);
  store<u32>(resultPointer, matchesPointer);
  store<u32>(resultPointer + 4, candidateCount);
  return resultPointer;
}

function writeDetectionResult(
  task: u32,
  state: u32,
  sessionPointer: u32,
  stage: u32,
  secondStage: u32,
  workPointer: u32,
  workCount: u32,
  candidatePointer: u32,
  candidateCount: u32,
  edgeX: f64,
  edgeY: f64,
  edgeWidth: f64,
  edgeHeight: f64,
): u32 {
  const stageCount: u32 = stage == 0 ? 0 : secondStage == 0 ? 1 : 2;
  const stagePointer = stageCount == 0 ? 0 : reserveArena(stageCount * sizeof<u32>(), sizeof<u32>());
  if (stage != 0) {
    store<u32>(stagePointer, stage);
    if (secondStage != 0) store<u32>(stagePointer + sizeof<u32>(), secondStage);
  }
  const resultPointer = reserveArena(DETECTION_RESULT_BYTE_LENGTH, sizeof<u64>());
  memory.fill(resultPointer, 0, DETECTION_RESULT_BYTE_LENGTH);
  store<u32>(resultPointer + DETECTION_RESULT_STATE_OFFSET, state);
  store<u32>(resultPointer + DETECTION_RESULT_TASK_OFFSET, task);
  store<u32>(
    resultPointer + DETECTION_RESULT_FLAGS_OFFSET,
    edgeWidth > 0 && edgeHeight > 0 ? DETECTION_RESULT_FLAG_HAS_EDGE_RECT : 0,
  );
  store<u32>(resultPointer + DETECTION_RESULT_STAGE_POINTER_OFFSET, stagePointer);
  store<u32>(resultPointer + DETECTION_RESULT_STAGE_COUNT_OFFSET, stageCount);
  store<u32>(resultPointer + DETECTION_RESULT_SESSION_POINTER_OFFSET, sessionPointer);
  store<u32>(resultPointer + DETECTION_RESULT_WORK_POINTER_OFFSET, workPointer);
  store<u32>(resultPointer + DETECTION_RESULT_WORK_COUNT_OFFSET, workCount);
  store<f64>(resultPointer + DETECTION_RESULT_EDGE_X_OFFSET, edgeX);
  store<f64>(resultPointer + DETECTION_RESULT_EDGE_Y_OFFSET, edgeY);
  store<f64>(resultPointer + DETECTION_RESULT_EDGE_WIDTH_OFFSET, edgeWidth);
  store<f64>(resultPointer + DETECTION_RESULT_EDGE_HEIGHT_OFFSET, edgeHeight);
  store<u32>(resultPointer + DETECTION_RESULT_CANDIDATE_POINTER_OFFSET, candidatePointer);
  store<u32>(resultPointer + DETECTION_RESULT_CANDIDATE_COUNT_OFFSET, candidateCount);
  store<u32>(resultPointer + DETECTION_RESULT_MATCH_POINTER_OFFSET, sessionPointer == 0 ? 0 : load<u32>(sessionPointer + DETECTION_INPUT_MATCH_POINTER_OFFSET));
  store<u32>(resultPointer + DETECTION_RESULT_MATCH_COUNT_OFFSET, sessionPointer == 0 ? 0 : load<u32>(sessionPointer + DETECTION_INPUT_MATCH_COUNT_OFFSET));
  return resultPointer;
}

function storeSessionEdge(commandPointer: u32, x: f64, y: f64, width: f64, height: f64): void {
  store<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_X_OFFSET, x);
  store<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_Y_OFFSET, y);
  store<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_WIDTH_OFFSET, width);
  store<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_HEIGHT_OFFSET, height);
}

function validateDetectionCommand(commandPointer: u32, isShard: bool): void {
  const task = load<u32>(commandPointer + DETECTION_INPUT_TASK_OFFSET);
  if (task != DETECTION_TASK_AUTO && task != DETECTION_TASK_KNOWN_BOUNDS) trap();
  const width = load<u32>(commandPointer + DETECTION_INPUT_WIDTH_OFFSET);
  const height = load<u32>(commandPointer + DETECTION_INPUT_HEIGHT_OFFSET);
  const rgbaLength = load<u32>(commandPointer + DETECTION_INPUT_RGBA_BYTE_LENGTH_OFFSET);
  if (width == 0 || height == 0 || <u64>width * height * 4 != rgbaLength) trap();
  requireArenaRange(load<u32>(commandPointer + DETECTION_INPUT_RGBA_POINTER_OFFSET), rgbaLength, 1);
  validateSettings(load<u32>(commandPointer + DETECTION_INPUT_SETTINGS_POINTER_OFFSET), load<u32>(commandPointer + DETECTION_INPUT_SETTINGS_LENGTH_OFFSET));
  validateDetectionTemplateTables(commandPointer);
  const edgeWidth = load<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_WIDTH_OFFSET);
  const edgeHeight = load<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_HEIGHT_OFFSET);
  if (!isFinitePositiveValue(edgeWidth) || !isFinitePositiveValue(edgeHeight)) trap();
  if (isShard) {
    const count = load<u32>(commandPointer + DETECTION_INPUT_CANDIDATE_COUNT_OFFSET);
    if (count == 0) trap();
    requireArenaRange(load<u32>(commandPointer + DETECTION_INPUT_CANDIDATE_POINTER_OFFSET), count * DETECTION_CANDIDATE_BYTE_LENGTH, sizeof<f64>());
  }
}

function validateSettings(pointer: u32, length: u32): void {
  if (length != SETTINGS_LENGTH) {
    trap();
  }
  requireArenaRange(pointer, length * sizeof<f64>(), sizeof<f64>());
  const minArea = load<f64>(pointer);
  const candidateTopRatio = load<f64>(pointer + sizeof<f64>());
  const maximumSoldierCount = load<f64>(pointer + 2 * sizeof<f64>());
  const templateWorkerCount = load<f64>(pointer + 3 * sizeof<f64>());
  if (
    !isFinite(minArea) ||
    minArea < 0 ||
    !isFinite(candidateTopRatio) ||
    candidateTopRatio <= 0 ||
    candidateTopRatio > 1 ||
    !isFinitePositiveValue(maximumSoldierCount) ||
    maximumSoldierCount != <f64><u32>maximumSoldierCount ||
    !isFinitePositiveValue(templateWorkerCount) ||
    templateWorkerCount != <f64><u32>templateWorkerCount
  ) {
    trap();
  }
}

function validateEdgeRect(pointer: u32, length: u32): void {
  if (length != EDGE_LENGTH) {
    trap();
  }
  requireArenaRange(pointer, length * sizeof<f64>(), sizeof<f64>());
  if (
    !isFinite(load<f64>(pointer)) ||
    !isFinite(load<f64>(pointer + sizeof<f64>())) ||
    !isFinitePositiveValue(load<f64>(pointer + 2 * sizeof<f64>())) ||
    !isFinitePositiveValue(load<f64>(pointer + 3 * sizeof<f64>()))
  ) {
    trap();
  }
}

function detectPlayArea(rgbaPointer: u32, width: u32, height: u32, edgeOutputPointer: u32): bool {
  const verticalGroupsPointer = reserveArena(AXIS_GROUP_LIMIT * AXIS_GROUP_BYTE_LENGTH, sizeof<f64>());
  const verticalGroupCount = detectAxisGroups(rgbaPointer, width, height, true, verticalGroupsPointer);
  const verticalTripletsPointer = reserveArena(AXIS_TRIPLET_LIMIT * AXIS_TRIPLET_BYTE_LENGTH, sizeof<f64>());
  const verticalTripletCount = buildAxisTriplets(
    verticalGroupsPointer,
    verticalGroupCount,
    verticalTripletsPointer,
  );
  const horizontalGroupsPointer = reserveArena(AXIS_GROUP_LIMIT * AXIS_GROUP_BYTE_LENGTH, sizeof<f64>());
  const horizontalGroupCount = detectAxisGroups(rgbaPointer, width, height, false, horizontalGroupsPointer);
  const horizontalTripletsPointer = reserveArena(AXIS_TRIPLET_LIMIT * AXIS_TRIPLET_BYTE_LENGTH, sizeof<f64>());
  const horizontalTripletCount = buildAxisTriplets(
    horizontalGroupsPointer,
    horizontalGroupCount,
    horizontalTripletsPointer,
  );

  const targetAspectRatio = 770.0 / 450.0;
  let hasBestRect = false;
  let bestScore = 0.0;
  for (let verticalIndex: u32 = 0; verticalIndex < verticalTripletCount; verticalIndex += 1) {
    const verticalTriplet = verticalTripletsPointer + verticalIndex * AXIS_TRIPLET_BYTE_LENGTH;
    const verticalFirst =
      verticalGroupsPointer + load<u32>(verticalTriplet + AXIS_TRIPLET_FIRST_OFFSET) * AXIS_GROUP_BYTE_LENGTH;
    const verticalMiddle =
      verticalGroupsPointer + load<u32>(verticalTriplet + AXIS_TRIPLET_MIDDLE_OFFSET) * AXIS_GROUP_BYTE_LENGTH;
    const verticalLast =
      verticalGroupsPointer + load<u32>(verticalTriplet + AXIS_TRIPLET_LAST_OFFSET) * AXIS_GROUP_BYTE_LENGTH;
    for (let horizontalIndex: u32 = 0; horizontalIndex < horizontalTripletCount; horizontalIndex += 1) {
      const horizontalTriplet = horizontalTripletsPointer + horizontalIndex * AXIS_TRIPLET_BYTE_LENGTH;
      const horizontalFirst =
        horizontalGroupsPointer + load<u32>(horizontalTriplet + AXIS_TRIPLET_FIRST_OFFSET) * AXIS_GROUP_BYTE_LENGTH;
      const horizontalMiddle =
        horizontalGroupsPointer + load<u32>(horizontalTriplet + AXIS_TRIPLET_MIDDLE_OFFSET) * AXIS_GROUP_BYTE_LENGTH;
      const horizontalLast =
        horizontalGroupsPointer + load<u32>(horizontalTriplet + AXIS_TRIPLET_LAST_OFFSET) * AXIS_GROUP_BYTE_LENGTH;
      const rectWidth =
        load<u32>(verticalLast + AXIS_GROUP_START_OFFSET) + 1 - load<u32>(verticalFirst + AXIS_GROUP_END_OFFSET);
      const rectHeight =
        load<u32>(horizontalLast + AXIS_GROUP_START_OFFSET) +
        1 -
        load<u32>(horizontalFirst + AXIS_GROUP_END_OFFSET);
      if (<i32>rectWidth <= 0 || <i32>rectHeight <= 0) {
        continue;
      }
      const rectX = load<u32>(verticalFirst + AXIS_GROUP_END_OFFSET);
      const rectY = load<u32>(horizontalFirst + AXIS_GROUP_END_OFFSET);
      const aspectRatio = <f64>rectWidth / rectHeight;
      if (aspectRatio < targetAspectRatio * 0.7 || aspectRatio > targetAspectRatio * 1.28) {
        continue;
      }
      const expectedAxisX = <f64>rectX + <f64>rectWidth / 2;
      const expectedAxisY = <f64>rectY + <f64>rectHeight / 2;
      const axisOffset =
        NativeMath.abs(load<f64>(verticalMiddle + AXIS_GROUP_COORDINATE_OFFSET) - expectedAxisX) / rectWidth +
        NativeMath.abs(load<f64>(horizontalMiddle + AXIS_GROUP_COORDINATE_OFFSET) - expectedAxisY) / rectHeight;
      if (axisOffset > 0.16) {
        continue;
      }
      const aspectPenalty = NativeMath.min(
        NativeMath.abs(aspectRatio - targetAspectRatio) / targetAspectRatio,
        0.5,
      );
      const score =
        <f64>rectWidth *
        rectHeight *
        load<f64>(verticalTriplet + AXIS_TRIPLET_SCORE_OFFSET) *
        load<f64>(horizontalTriplet + AXIS_TRIPLET_SCORE_OFFSET) *
        (1 - aspectPenalty) *
        (1 - axisOffset);
      if (score > bestScore) {
        bestScore = score;
        hasBestRect = true;
        store<f64>(edgeOutputPointer, rectX);
        store<f64>(edgeOutputPointer + sizeof<f64>(), rectY);
        store<f64>(edgeOutputPointer + 2 * sizeof<f64>(), rectWidth);
        store<f64>(edgeOutputPointer + 3 * sizeof<f64>(), rectHeight);
      }
    }
  }
  return hasBestRect;
}

function detectAxisGroups(
  rgbaPointer: u32,
  width: u32,
  height: u32,
  isVertical: bool,
  groupsPointer: u32,
): u32 {
  const axisLength = isVertical ? height : width;
  const scanLength = isVertical ? width : height;
  const countsPointer = reserveArena(scanLength * sizeof<u32>(), sizeof<u32>());
  const rankedCoordinatesPointer = reserveArena(scanLength * sizeof<u32>(), sizeof<u32>());
  const minimumScore = <f64>axisLength * 0.25;
  let rankedCount: u32 = 0;
  for (let coordinate: u32 = 0; coordinate < scanLength; coordinate += 1) {
    let count: u32 = 0;
    for (let position: u32 = 0; position < axisLength; position += 1) {
      if (hasBlackPixelInAxisBand(rgbaPointer, width, height, isVertical, coordinate, position)) {
        count += 1;
      }
    }
    store<u32>(countsPointer + coordinate * sizeof<u32>(), count);
    if (<f64>count >= minimumScore) {
      store<u32>(rankedCoordinatesPointer + rankedCount * sizeof<u32>(), coordinate);
      rankedCount += 1;
    }
  }
  stableSortCoordinatesByScore(rankedCoordinatesPointer, rankedCount, countsPointer);

  let groupCount: u32 = 0;
  for (let rankedIndex: u32 = 0; rankedIndex < rankedCount; rankedIndex += 1) {
    const coordinate = load<u32>(rankedCoordinatesPointer + rankedIndex * sizeof<u32>());
    let isGrouped = false;
    for (let groupIndex: u32 = 0; groupIndex < groupCount; groupIndex += 1) {
      const groupPointer = groupsPointer + groupIndex * AXIS_GROUP_BYTE_LENGTH;
      const start = load<u32>(groupPointer + AXIS_GROUP_START_OFFSET);
      const end = load<u32>(groupPointer + AXIS_GROUP_END_OFFSET);
      if (coordinate + 4 >= start && coordinate <= end + 4) {
        isGrouped = true;
        break;
      }
    }
    if (isGrouped) {
      continue;
    }

    const score = load<u32>(countsPointer + coordinate * sizeof<u32>());
    const groupThreshold = <f64>score * 0.82;
    let start = coordinate;
    let end = coordinate;
    while (start > 0 && <f64>load<u32>(countsPointer + (start - 1) * sizeof<u32>()) >= groupThreshold) {
      start -= 1;
    }
    while (
      end < scanLength - 1 &&
      <f64>load<u32>(countsPointer + (end + 1) * sizeof<u32>()) >= groupThreshold
    ) {
      end += 1;
    }
    const groupPointer = groupsPointer + groupCount * AXIS_GROUP_BYTE_LENGTH;
    store<u32>(groupPointer + AXIS_GROUP_START_OFFSET, start);
    store<u32>(groupPointer + AXIS_GROUP_END_OFFSET, end);
    store<f64>(groupPointer + AXIS_GROUP_COORDINATE_OFFSET, <f64>(start + end) / 2);
    store<f64>(groupPointer + AXIS_GROUP_SCORE_OFFSET, score);
    groupCount += 1;
    if (groupCount == AXIS_GROUP_LIMIT) {
      break;
    }
  }
  stableSortGroupsByCoordinate(groupsPointer, groupCount);
  return groupCount;
}

function hasBlackPixelInAxisBand(
  rgbaPointer: u32,
  width: u32,
  height: u32,
  isVertical: bool,
  coordinate: u32,
  position: u32,
): bool {
  for (let offset: i32 = -1; offset <= 1; offset += 1) {
    const x = isVertical ? <i32>coordinate + offset : <i32>position;
    const y = isVertical ? <i32>position : <i32>coordinate + offset;
    if (x >= 0 && <u32>x < width && y >= 0 && <u32>y < height) {
      if (isAxisBlackPixel(rgbaPointer, <u32>y * width + <u32>x)) {
        return true;
      }
    }
  }
  return false;
}

function stableSortCoordinatesByScore(pointer: u32, length: u32, countsPointer: u32): void {
  for (let index: u32 = 1; index < length; index += 1) {
    const coordinate = load<u32>(pointer + index * sizeof<u32>());
    const score = load<u32>(countsPointer + coordinate * sizeof<u32>());
    let insertionIndex = index;
    while (insertionIndex > 0) {
      const previousCoordinate = load<u32>(pointer + (insertionIndex - 1) * sizeof<u32>());
      const previousScore = load<u32>(countsPointer + previousCoordinate * sizeof<u32>());
      if (score <= previousScore) {
        break;
      }
      store<u32>(pointer + insertionIndex * sizeof<u32>(), previousCoordinate);
      insertionIndex -= 1;
    }
    store<u32>(pointer + insertionIndex * sizeof<u32>(), coordinate);
  }
}

function stableSortGroupsByCoordinate(pointer: u32, length: u32): void {
  for (let index: u32 = 1; index < length; index += 1) {
    const sourcePointer = pointer + index * AXIS_GROUP_BYTE_LENGTH;
    const start = load<u32>(sourcePointer + AXIS_GROUP_START_OFFSET);
    const end = load<u32>(sourcePointer + AXIS_GROUP_END_OFFSET);
    const coordinate = load<f64>(sourcePointer + AXIS_GROUP_COORDINATE_OFFSET);
    const score = load<f64>(sourcePointer + AXIS_GROUP_SCORE_OFFSET);
    let insertionIndex = index;
    while (insertionIndex > 0) {
      const previousPointer = pointer + (insertionIndex - 1) * AXIS_GROUP_BYTE_LENGTH;
      if (coordinate >= load<f64>(previousPointer + AXIS_GROUP_COORDINATE_OFFSET)) {
        break;
      }
      copyAxisGroup(previousPointer, pointer + insertionIndex * AXIS_GROUP_BYTE_LENGTH);
      insertionIndex -= 1;
    }
    const destinationPointer = pointer + insertionIndex * AXIS_GROUP_BYTE_LENGTH;
    store<u32>(destinationPointer + AXIS_GROUP_START_OFFSET, start);
    store<u32>(destinationPointer + AXIS_GROUP_END_OFFSET, end);
    store<f64>(destinationPointer + AXIS_GROUP_COORDINATE_OFFSET, coordinate);
    store<f64>(destinationPointer + AXIS_GROUP_SCORE_OFFSET, score);
  }
}

@inline
function copyAxisGroup(sourcePointer: u32, destinationPointer: u32): void {
  store<u64>(destinationPointer, load<u64>(sourcePointer));
  store<u64>(destinationPointer + sizeof<u64>(), load<u64>(sourcePointer + sizeof<u64>()));
  store<u64>(destinationPointer + 2 * sizeof<u64>(), load<u64>(sourcePointer + 2 * sizeof<u64>()));
}

function buildAxisTriplets(groupsPointer: u32, groupCount: u32, tripletsPointer: u32): u32 {
  let tripletCount: u32 = 0;
  for (let firstIndex: u32 = 0; firstIndex < groupCount; firstIndex += 1) {
    const firstPointer = groupsPointer + firstIndex * AXIS_GROUP_BYTE_LENGTH;
    for (let middleIndex = firstIndex + 1; middleIndex < groupCount; middleIndex += 1) {
      const middlePointer = groupsPointer + middleIndex * AXIS_GROUP_BYTE_LENGTH;
      for (let lastIndex = middleIndex + 1; lastIndex < groupCount; lastIndex += 1) {
        const lastPointer = groupsPointer + lastIndex * AXIS_GROUP_BYTE_LENGTH;
        const firstCoordinate = load<f64>(firstPointer + AXIS_GROUP_COORDINATE_OFFSET);
        const lastCoordinate = load<f64>(lastPointer + AXIS_GROUP_COORDINATE_OFFSET);
        const span = lastCoordinate - firstCoordinate;
        if (span <= 0) {
          continue;
        }
        const middleOffset =
          NativeMath.abs(
            load<f64>(middlePointer + AXIS_GROUP_COORDINATE_OFFSET) - (firstCoordinate + lastCoordinate) / 2,
          ) / span;
        if (middleOffset > 0.18) {
          continue;
        }
        const score =
          (load<f64>(firstPointer + AXIS_GROUP_SCORE_OFFSET) +
            load<f64>(middlePointer + AXIS_GROUP_SCORE_OFFSET) +
            load<f64>(lastPointer + AXIS_GROUP_SCORE_OFFSET)) *
          (1 - middleOffset);
        tripletCount = insertStableTriplet(
          tripletsPointer,
          tripletCount,
          firstIndex,
          middleIndex,
          lastIndex,
          score,
        );
      }
    }
  }
  return tripletCount;
}

function insertStableTriplet(
  pointer: u32,
  length: u32,
  firstIndex: u32,
  middleIndex: u32,
  lastIndex: u32,
  score: f64,
): u32 {
  let insertionIndex = length;
  for (let index: u32 = 0; index < length; index += 1) {
    if (score > load<f64>(pointer + index * AXIS_TRIPLET_BYTE_LENGTH + AXIS_TRIPLET_SCORE_OFFSET)) {
      insertionIndex = index;
      break;
    }
  }
  if (insertionIndex >= AXIS_TRIPLET_LIMIT) {
    return length;
  }
  const nextLength = length < AXIS_TRIPLET_LIMIT ? length + 1 : length;
  let shiftIndex = nextLength;
  while (shiftIndex > insertionIndex + 1) {
    const sourcePointer = pointer + (shiftIndex - 2) * AXIS_TRIPLET_BYTE_LENGTH;
    const destinationPointer = pointer + (shiftIndex - 1) * AXIS_TRIPLET_BYTE_LENGTH;
    copyAxisTriplet(sourcePointer, destinationPointer);
    shiftIndex -= 1;
  }
  const destinationPointer = pointer + insertionIndex * AXIS_TRIPLET_BYTE_LENGTH;
  store<u32>(destinationPointer + AXIS_TRIPLET_FIRST_OFFSET, firstIndex);
  store<u32>(destinationPointer + AXIS_TRIPLET_MIDDLE_OFFSET, middleIndex);
  store<u32>(destinationPointer + AXIS_TRIPLET_LAST_OFFSET, lastIndex);
  store<u32>(destinationPointer + 12, 0);
  store<f64>(destinationPointer + AXIS_TRIPLET_SCORE_OFFSET, score);
  return nextLength;
}

@inline
function copyAxisTriplet(sourcePointer: u32, destinationPointer: u32): void {
  store<u64>(destinationPointer, load<u64>(sourcePointer));
  store<u64>(destinationPointer + sizeof<u64>(), load<u64>(sourcePointer + sizeof<u64>()));
  store<u64>(destinationPointer + 2 * sizeof<u64>(), load<u64>(sourcePointer + 2 * sizeof<u64>()));
}
