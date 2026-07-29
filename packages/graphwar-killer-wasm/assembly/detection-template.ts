import {
  DETECTION_CANDIDATE_BYTE_LENGTH,
  DETECTION_INPUT_BASE_FLAGS_LENGTH_OFFSET,
  DETECTION_INPUT_BASE_FLAGS_POINTER_OFFSET,
  DETECTION_INPUT_BASE_GEOMETRY_LENGTH_OFFSET,
  DETECTION_INPUT_BASE_GEOMETRY_POINTER_OFFSET,
  DETECTION_INPUT_BASE_RANGES_LENGTH_OFFSET,
  DETECTION_INPUT_BASE_RANGES_POINTER_OFFSET,
  DETECTION_INPUT_CANDIDATE_COUNT_OFFSET,
  DETECTION_INPUT_CANDIDATE_POINTER_OFFSET,
  DETECTION_INPUT_HEIGHT_OFFSET,
  DETECTION_INPUT_MATCH_COUNT_OFFSET,
  DETECTION_INPUT_MATCH_POINTER_OFFSET,
  DETECTION_INPUT_PIXEL_COORDINATES_LENGTH_OFFSET,
  DETECTION_INPUT_PIXEL_COORDINATES_POINTER_OFFSET,
  DETECTION_INPUT_PROFILE_LENGTH_OFFSET,
  DETECTION_INPUT_PROFILE_POINTER_OFFSET,
  DETECTION_INPUT_RGBA_POINTER_OFFSET,
  DETECTION_INPUT_SESSION_EDGE_HEIGHT_OFFSET,
  DETECTION_INPUT_SESSION_EDGE_WIDTH_OFFSET,
  DETECTION_INPUT_SESSION_EDGE_X_OFFSET,
  DETECTION_INPUT_SESSION_EDGE_Y_OFFSET,
  DETECTION_INPUT_SETTINGS_POINTER_OFFSET,
  DETECTION_INPUT_SIGNATURE_COLORS_LENGTH_OFFSET,
  DETECTION_INPUT_SIGNATURE_COLORS_POINTER_OFFSET,
  DETECTION_INPUT_TEMPLATE_RECORDS_LENGTH_OFFSET,
  DETECTION_INPUT_TEMPLATE_RECORDS_POINTER_OFFSET,
  DETECTION_INPUT_WIDTH_OFFSET,
  DETECTION_MATCH_BYTE_LENGTH,
} from "./detection-layout";
import { getGraphwarPlaneHeight, getGraphwarPlaneLength, requireGraphwarGameConstantsInitialized } from "./game-constants";
import { requireArenaRange, reserveArena } from "./memory";

const PROFILE_LENGTH: u32 = 10;
const BASE_COUNT: u32 = 2;
const BASE_GEOMETRY_LENGTH: u32 = 4;
const BASE_RANGE_LENGTH: u32 = 16;
const BASE_RANGE_STRIDE: u32 = 8;
const TEMPLATE_RECORD_STRIDE: u32 = 5;
const TEMPLATE_NAME_COUNT: u32 = 10;

const PROFILE_CANVAS_CENTER: u32 = 0;
const PROFILE_VISIBLE_CENTER_X: u32 = 1;
const PROFILE_VISIBLE_CENTER_Y: u32 = 2;
const PROFILE_MIRROR_VISIBLE_CENTER_X: u32 = 3;
const PROFILE_MINIMUM_FIXED_SCORE: u32 = 4;
const PROFILE_MINIMUM_FOREGROUND_SCORE: u32 = 5;
const PROFILE_MINIMUM_PLAYER_SCORE: u32 = 6;
const PROFILE_MINIMUM_SIGNATURE_SCORE: u32 = 7;
const PROFILE_MINIMUM_AXIS_GAP: u32 = 8;
const PROFILE_VISIBLE_RADIUS: u32 = 9;

const RANGE_FOREGROUND: u32 = 0;
const RANGE_PLAYER: u32 = 2;
const RANGE_FIXED: u32 = 4;
const RANGE_SEED: u32 = 6;

const CANDIDATE_X: u32 = 0;
const CANDIDATE_Y: u32 = 8;
const CANDIDATE_VOTES: u32 = 16;
const CANDIDATE_MIRRORED: u32 = 20;
const CANDIDATE_INDEX: u32 = 24;

const MATCH_X: u32 = 0;
const MATCH_Y: u32 = 8;
const MATCH_SCORE: u32 = 16;
const MATCH_FIXED_SCORE: u32 = 24;
const MATCH_FOREGROUND_SCORE: u32 = 32;
const MATCH_PLAYER_SCORE: u32 = 40;
const MATCH_SIGNATURE_SCORE: u32 = 48;
const MATCH_VOTES: u32 = 56;
const MATCH_MIRRORED: u32 = 60;
const MATCH_NAME_INDEX: u32 = 64;
const MATCH_CANDIDATE_INDEX: u32 = 68;

@inline
function trap(): void {
  unreachable();
}

@inline
function clamp(value: f64, minimum: f64, maximum: f64): f64 {
  return NativeMath.min(NativeMath.max(value, minimum), maximum);
}

@inline
function profileValue(commandPointer: u32, index: u32): f64 {
  return load<f64>(load<u32>(commandPointer + DETECTION_INPUT_PROFILE_POINTER_OFFSET) + index * sizeof<f64>());
}

@inline
function isFinitePositive(value: f64): bool {
  return isFinite(value) && value > 0;
}

/** Validates the complete canonical table set before candidate state can be retained. */
export function validateDetectionTemplateTables(commandPointer: u32): void {
  requireGraphwarGameConstantsInitialized();
  const profilePointer = load<u32>(commandPointer + DETECTION_INPUT_PROFILE_POINTER_OFFSET);
  const profileLength = load<u32>(commandPointer + DETECTION_INPUT_PROFILE_LENGTH_OFFSET);
  const baseFlagsPointer = load<u32>(commandPointer + DETECTION_INPUT_BASE_FLAGS_POINTER_OFFSET);
  const baseFlagsLength = load<u32>(commandPointer + DETECTION_INPUT_BASE_FLAGS_LENGTH_OFFSET);
  const baseGeometryPointer = load<u32>(commandPointer + DETECTION_INPUT_BASE_GEOMETRY_POINTER_OFFSET);
  const baseGeometryLength = load<u32>(commandPointer + DETECTION_INPUT_BASE_GEOMETRY_LENGTH_OFFSET);
  const rangesPointer = load<u32>(commandPointer + DETECTION_INPUT_BASE_RANGES_POINTER_OFFSET);
  const rangesLength = load<u32>(commandPointer + DETECTION_INPUT_BASE_RANGES_LENGTH_OFFSET);
  const pixelsPointer = load<u32>(commandPointer + DETECTION_INPUT_PIXEL_COORDINATES_POINTER_OFFSET);
  const pixelsLength = load<u32>(commandPointer + DETECTION_INPUT_PIXEL_COORDINATES_LENGTH_OFFSET);
  const recordsPointer = load<u32>(commandPointer + DETECTION_INPUT_TEMPLATE_RECORDS_POINTER_OFFSET);
  const recordsLength = load<u32>(commandPointer + DETECTION_INPUT_TEMPLATE_RECORDS_LENGTH_OFFSET);
  const colorsPointer = load<u32>(commandPointer + DETECTION_INPUT_SIGNATURE_COLORS_POINTER_OFFSET);
  const colorsLength = load<u32>(commandPointer + DETECTION_INPUT_SIGNATURE_COLORS_LENGTH_OFFSET);
  if (
    profileLength != PROFILE_LENGTH ||
    baseFlagsLength != BASE_COUNT ||
    baseGeometryLength != BASE_GEOMETRY_LENGTH ||
    rangesLength != BASE_RANGE_LENGTH ||
    pixelsLength == 0 ||
    (pixelsLength & 1) != 0 ||
    recordsLength == 0 ||
    recordsLength % TEMPLATE_RECORD_STRIDE != 0 ||
    colorsLength == 0
  ) {
    trap();
  }
  requireArenaRange(profilePointer, profileLength * sizeof<f64>(), sizeof<f64>());
  requireArenaRange(baseFlagsPointer, baseFlagsLength, 1);
  requireArenaRange(baseGeometryPointer, baseGeometryLength * sizeof<f64>(), sizeof<f64>());
  requireArenaRange(rangesPointer, rangesLength * sizeof<u32>(), sizeof<u32>());
  requireArenaRange(pixelsPointer, pixelsLength, 1);
  requireArenaRange(recordsPointer, recordsLength * sizeof<u32>(), sizeof<u32>());
  requireArenaRange(colorsPointer, colorsLength * sizeof<u32>(), sizeof<u32>());
  if (load<u8>(baseFlagsPointer) != 0 || load<u8>(baseFlagsPointer + 1) != 1) {
    trap();
  }
  for (let index: u32 = 0; index < PROFILE_LENGTH; index += 1) {
    const value = load<f64>(profilePointer + index * sizeof<f64>());
    if (!isFinitePositive(value) || (index >= PROFILE_MINIMUM_FIXED_SCORE && index <= PROFILE_MINIMUM_SIGNATURE_SCORE && value > 1)) {
      trap();
    }
  }
  for (let index: u32 = 0; index < BASE_GEOMETRY_LENGTH; index += 1) {
    if (!isFinite(load<f64>(baseGeometryPointer + index * sizeof<f64>()))) {
      trap();
    }
  }
  const pixelCount = pixelsLength / 2;
  for (let index: u32 = 0; index < rangesLength; index += 2) {
    const offset = load<u32>(rangesPointer + index * sizeof<u32>());
    const count = load<u32>(rangesPointer + (index + 1) * sizeof<u32>());
    if (<u64>offset + count > pixelCount) {
      trap();
    }
  }
  for (let index: u32 = 0; index < recordsLength; index += TEMPLATE_RECORD_STRIDE) {
    const record = recordsPointer + index * sizeof<u32>();
    const coordinateOffset = load<u32>(record + 2 * sizeof<u32>());
    const colorOffset = load<u32>(record + 3 * sizeof<u32>());
    const count = load<u32>(record + 4 * sizeof<u32>());
    if (
      load<u32>(record) >= BASE_COUNT ||
      load<u32>(record + sizeof<u32>()) >= TEMPLATE_NAME_COUNT ||
      <u64>coordinateOffset + count > pixelCount ||
      <u64>colorOffset + count > colorsLength
    ) {
      trap();
    }
  }
}

/** Scans yellow seeds and writes the stable, vote-ranked candidate prefix retained by this session. */
export function collectDetectionCandidates(commandPointer: u32): void {
  const width = load<u32>(commandPointer + DETECTION_INPUT_WIDTH_OFFSET);
  const height = load<u32>(commandPointer + DETECTION_INPUT_HEIGHT_OFFSET);
  const rgbaPointer = load<u32>(commandPointer + DETECTION_INPUT_RGBA_POINTER_OFFSET);
  const edgeX = load<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_X_OFFSET);
  const edgeY = load<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_Y_OFFSET);
  const edgeWidth = load<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_WIDTH_OFFSET);
  const edgeHeight = load<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_HEIGHT_OFFSET);
  const planeWidth = <u32>getGraphwarPlaneLength();
  const planeHeight = <u32>getGraphwarPlaneHeight();
  const planeCellCount = planeWidth * planeHeight;
  const voteCountsPointer = reserveArena(planeCellCount * sizeof<u32>(), sizeof<u32>());
  memory.fill(voteCountsPointer, 0, planeCellCount * sizeof<u32>());
  const insertionOrderPointer = reserveArena(planeCellCount * sizeof<u32>(), sizeof<u32>());
  let candidateCount: u32 = 0;
  const scale = edgeWidth / getGraphwarPlaneLength();
  const stride = NativeMath.max(1, NativeMath.floor(scale / 2));
  const canvasCenter = profileValue(commandPointer, PROFILE_CANVAS_CENTER);
  const rangesPointer = load<u32>(commandPointer + DETECTION_INPUT_BASE_RANGES_POINTER_OFFSET);
  const pixelsPointer = load<u32>(commandPointer + DETECTION_INPUT_PIXEL_COORDINATES_POINTER_OFFSET);
  const baseFlagsPointer = load<u32>(commandPointer + DETECTION_INPUT_BASE_FLAGS_POINTER_OFFSET);

  for (let localY = 0.0; localY < edgeHeight; localY += stride) {
    for (let localX = 0.0; localX < edgeWidth; localX += stride) {
      const pixelIndex = nearestPixelIndex(edgeX + localX, edgeY + localY, width, height);
      const pixelPointer = rgbaPointer + pixelIndex * 4;
      if (!isSoldierYellow(load<u8>(pixelPointer), load<u8>(pixelPointer + 1), load<u8>(pixelPointer + 2))) {
        continue;
      }
      for (let baseIndex: u32 = 0; baseIndex < BASE_COUNT; baseIndex += 1) {
        const range = rangesPointer + (baseIndex * BASE_RANGE_STRIDE + RANGE_SEED) * sizeof<u32>();
        const seedOffset = load<u32>(range);
        const seedCount = load<u32>(range + sizeof<u32>());
        for (let seedIndex: u32 = 0; seedIndex < seedCount; seedIndex += 1) {
          const pixel = pixelsPointer + (seedOffset + seedIndex) * 2;
          const centerX = edgeX + localX - (load<u8>(pixel) + 0.5 - canvasCenter) * scale;
          const centerY = edgeY + localY - (load<u8>(pixel + 1) + 0.5 - canvasCenter) * scale;
          if (centerX < edgeX || centerX > edgeX + edgeWidth || centerY < edgeY || centerY > edgeY + edgeHeight) {
            continue;
          }
          const planeX = <i32>NativeMath.floor(((centerX - edgeX) / edgeWidth) * planeWidth + 0.5);
          const planeY = <i32>NativeMath.floor(((centerY - edgeY) / edgeHeight) * planeHeight + 0.5);
          if (planeX < 0 || <u32>planeX >= planeWidth || planeY < 0 || <u32>planeY >= planeHeight) {
            continue;
          }
          const isMirrored = <u32>planeX >= planeWidth / 2;
          if ((load<u8>(baseFlagsPointer + baseIndex) != 0) != isMirrored) {
            continue;
          }
          const planeIndex = <u32>planeY * planeWidth + <u32>planeX;
          const countPointer = voteCountsPointer + planeIndex * sizeof<u32>();
          const count = load<u32>(countPointer);
          if (count == 0) {
            store<u32>(insertionOrderPointer + candidateCount * sizeof<u32>(), planeIndex);
            candidateCount += 1;
          }
          if (count == u32.MAX_VALUE) {
            trap();
          }
          store<u32>(countPointer, count + 1);
        }
      }
    }
  }

  stableSortCandidateIndexes(insertionOrderPointer, candidateCount, voteCountsPointer);
  const settingsPointer = load<u32>(commandPointer + DETECTION_INPUT_SETTINGS_POINTER_OFFSET);
  const candidateTopRatio = load<f64>(settingsPointer + sizeof<f64>());
  const retainedCount = <u32>NativeMath.ceil(<f64>candidateCount * candidateTopRatio);
  const candidatesPointer = retainedCount == 0 ? 0 : reserveArena(retainedCount * DETECTION_CANDIDATE_BYTE_LENGTH, sizeof<f64>());
  for (let index: u32 = 0; index < retainedCount; index += 1) {
    const planeIndex = load<u32>(insertionOrderPointer + index * sizeof<u32>());
    const planeX = planeIndex % planeWidth;
    const planeY = planeIndex / planeWidth;
    const candidate = candidatesPointer + index * DETECTION_CANDIDATE_BYTE_LENGTH;
    store<f64>(candidate + CANDIDATE_X, edgeX + (<f64>planeX / planeWidth) * edgeWidth);
    store<f64>(candidate + CANDIDATE_Y, edgeY + (<f64>planeY / planeHeight) * edgeHeight);
    store<u32>(candidate + CANDIDATE_VOTES, load<u32>(voteCountsPointer + planeIndex * sizeof<u32>()));
    store<u32>(candidate + CANDIDATE_MIRRORED, planeX >= planeWidth / 2 ? 1 : 0);
    store<u32>(candidate + CANDIDATE_INDEX, index);
    store<u32>(candidate + CANDIDATE_INDEX + sizeof<u32>(), 0);
  }
  store<u32>(commandPointer + DETECTION_INPUT_CANDIDATE_POINTER_OFFSET, candidatesPointer);
  store<u32>(commandPointer + DETECTION_INPUT_CANDIDATE_COUNT_OFFSET, retainedCount);
}

/** Scores a stable contiguous candidate range and returns one raw best-match record per candidate. */
export function scoreDetectionTemplateCandidates(
  commandPointer: u32,
  candidatesPointer: u32,
  candidateCount: u32,
): u32 {
  if (candidateCount == 0) {
    return 0;
  }
  requireArenaRange(candidatesPointer, candidateCount * DETECTION_CANDIDATE_BYTE_LENGTH, sizeof<f64>());
  const matchesPointer = reserveArena(candidateCount * DETECTION_MATCH_BYTE_LENGTH, sizeof<f64>());
  for (let index: u32 = 0; index < candidateCount; index += 1) {
    scoreCandidate(
      commandPointer,
      candidatesPointer + index * DETECTION_CANDIDATE_BYTE_LENGTH,
      matchesPointer + index * DETECTION_MATCH_BYTE_LENGTH,
    );
  }
  return matchesPointer;
}

/** Filters, stably ranks, and overlap-suppresses raw matches into the exact TS business order. */
export function finalizeDetectionTemplateMatches(commandPointer: u32, matchesPointer: u32, matchCount: u32): void {
  if (matchCount > 0) {
    requireArenaRange(matchesPointer, matchCount * DETECTION_MATCH_BYTE_LENGTH, sizeof<f64>());
  }
  const rankedPointers = matchCount == 0 ? 0 : reserveArena(matchCount * sizeof<u32>(), sizeof<u32>());
  let acceptedCount: u32 = 0;
  for (let index: u32 = 0; index < matchCount; index += 1) {
    const matchPointer = matchesPointer + index * DETECTION_MATCH_BYTE_LENGTH;
    if (isAcceptedMatch(commandPointer, matchPointer)) {
      store<u32>(rankedPointers + acceptedCount * sizeof<u32>(), matchPointer);
      acceptedCount += 1;
    }
  }
  stableSortMatchPointers(rankedPointers, acceptedCount);
  const settingsPointer = load<u32>(commandPointer + DETECTION_INPUT_SETTINGS_POINTER_OFFSET);
  const maximumSoldierCount = <u32>load<f64>(settingsPointer + 2 * sizeof<f64>());
  const keptCapacity = acceptedCount < maximumSoldierCount ? acceptedCount : maximumSoldierCount;
  const keptPointer = acceptedCount == 0 ? 0 : reserveArena(keptCapacity * DETECTION_MATCH_BYTE_LENGTH, sizeof<f64>());
  const scale = load<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_WIDTH_OFFSET) / getGraphwarPlaneLength();
  const minimumGap = profileValue(commandPointer, PROFILE_MINIMUM_AXIS_GAP) * scale;
  let keptCount: u32 = 0;
  for (let index: u32 = 0; index < acceptedCount && keptCount < maximumSoldierCount; index += 1) {
    const matchPointer = load<u32>(rankedPointers + index * sizeof<u32>());
    let canKeep = true;
    for (let keptIndex: u32 = 0; keptIndex < keptCount; keptIndex += 1) {
      const kept = keptPointer + keptIndex * DETECTION_MATCH_BYTE_LENGTH;
      if (
        NativeMath.abs(load<f64>(matchPointer + MATCH_X) - load<f64>(kept + MATCH_X)) < minimumGap &&
        NativeMath.abs(load<f64>(matchPointer + MATCH_Y) - load<f64>(kept + MATCH_Y)) < minimumGap
      ) {
        canKeep = false;
        break;
      }
    }
    if (canKeep) {
      memory.copy(keptPointer + keptCount * DETECTION_MATCH_BYTE_LENGTH, matchPointer, DETECTION_MATCH_BYTE_LENGTH);
      keptCount += 1;
    }
  }
  store<u32>(commandPointer + DETECTION_INPUT_MATCH_POINTER_OFFSET, keptPointer);
  store<u32>(commandPointer + DETECTION_INPUT_MATCH_COUNT_OFFSET, keptCount);
}

function scoreCandidate(commandPointer: u32, candidatePointer: u32, outputPointer: u32): void {
  const isMirrored = load<u32>(candidatePointer + CANDIDATE_MIRRORED) != 0;
  const baseIndex: u32 = isMirrored ? 1 : 0;
  const sourceX = load<f64>(candidatePointer + CANDIDATE_X);
  const sourceY = load<f64>(candidatePointer + CANDIDATE_Y);
  const fixedScore = scorePixelGroup(commandPointer, baseIndex, RANGE_FIXED, sourceX, sourceY, 1, 0, 0, 0);
  const foregroundScore = scorePixelGroup(commandPointer, baseIndex, RANGE_FOREGROUND, sourceX, sourceY, 2, 0, 0, 0);
  const playerRed = estimatePlayerColorChannel(commandPointer, baseIndex, sourceX, sourceY, 0);
  const playerGreen = estimatePlayerColorChannel(commandPointer, baseIndex, sourceX, sourceY, 1);
  const playerBlue = estimatePlayerColorChannel(commandPointer, baseIndex, sourceX, sourceY, 2);
  const playerScore = scorePixelGroup(
    commandPointer,
    baseIndex,
    RANGE_PLAYER,
    sourceX,
    sourceY,
    3,
    playerRed,
    playerGreen,
    playerBlue,
  );
  const backgroundPenalty = scoreBackgroundPenalty(commandPointer, isMirrored, sourceX, sourceY);
  const recordsPointer = load<u32>(commandPointer + DETECTION_INPUT_TEMPLATE_RECORDS_POINTER_OFFSET);
  const recordLength = load<u32>(commandPointer + DETECTION_INPUT_TEMPLATE_RECORDS_LENGTH_OFFSET);
  let hasBest = false;
  let bestScore = 0.0;
  let bestSignatureScore = 0.0;
  let bestNameIndex: u32 = 0;
  for (let index: u32 = 0; index < recordLength; index += TEMPLATE_RECORD_STRIDE) {
    const record = recordsPointer + index * sizeof<u32>();
    if (load<u32>(record) != baseIndex) {
      continue;
    }
    const signatureScore = scoreSignature(commandPointer, record, sourceX, sourceY);
    const score = clamp(
      (normalizeAboveThreshold(fixedScore, profileValue(commandPointer, PROFILE_MINIMUM_FIXED_SCORE)) +
        normalizeAboveThreshold(foregroundScore, profileValue(commandPointer, PROFILE_MINIMUM_FOREGROUND_SCORE)) +
        normalizeAboveThreshold(playerScore, profileValue(commandPointer, PROFILE_MINIMUM_PLAYER_SCORE)) +
        normalizeAboveThreshold(signatureScore, profileValue(commandPointer, PROFILE_MINIMUM_SIGNATURE_SCORE))) /
        4 -
        backgroundPenalty,
      0,
      1,
    );
    if (!hasBest || score > bestScore) {
      hasBest = true;
      bestScore = score;
      bestSignatureScore = signatureScore;
      bestNameIndex = load<u32>(record + sizeof<u32>());
    }
  }
  if (!hasBest) {
    trap();
  }
  store<f64>(outputPointer + MATCH_X, sourceX);
  store<f64>(outputPointer + MATCH_Y, sourceY);
  store<f64>(outputPointer + MATCH_SCORE, bestScore);
  store<f64>(outputPointer + MATCH_FIXED_SCORE, fixedScore);
  store<f64>(outputPointer + MATCH_FOREGROUND_SCORE, foregroundScore);
  store<f64>(outputPointer + MATCH_PLAYER_SCORE, playerScore);
  store<f64>(outputPointer + MATCH_SIGNATURE_SCORE, bestSignatureScore);
  store<u32>(outputPointer + MATCH_VOTES, load<u32>(candidatePointer + CANDIDATE_VOTES));
  store<u32>(outputPointer + MATCH_MIRRORED, isMirrored ? 1 : 0);
  store<u32>(outputPointer + MATCH_NAME_INDEX, bestNameIndex);
  store<u32>(outputPointer + MATCH_CANDIDATE_INDEX, load<u32>(candidatePointer + CANDIDATE_INDEX));
}

function scorePixelGroup(
  commandPointer: u32,
  baseIndex: u32,
  rangeIndex: u32,
  sourceX: f64,
  sourceY: f64,
  scorer: u32,
  playerRed: f64,
  playerGreen: f64,
  playerBlue: f64,
): f64 {
  const rangesPointer = load<u32>(commandPointer + DETECTION_INPUT_BASE_RANGES_POINTER_OFFSET);
  const range = rangesPointer + (baseIndex * BASE_RANGE_STRIDE + rangeIndex) * sizeof<u32>();
  const offset = load<u32>(range);
  const count = load<u32>(range + sizeof<u32>());
  if (count == 0) {
    return 0;
  }
  const pixelsPointer = load<u32>(commandPointer + DETECTION_INPUT_PIXEL_COORDINATES_POINTER_OFFSET);
  let score = 0.0;
  let visibleCount: u32 = 0;
  for (let index: u32 = 0; index < count; index += 1) {
    const pixel = pixelsPointer + (offset + index) * 2;
    const imageX = sourceX + pixelOffset(commandPointer, load<u8>(pixel));
    const imageY = sourceY + pixelOffset(commandPointer, load<u8>(pixel + 1));
    if (!isInsideEdge(commandPointer, imageX, imageY)) {
      continue;
    }
    const red = sampleBilinearChannel(commandPointer, imageX, imageY, 0);
    const green = sampleBilinearChannel(commandPointer, imageX, imageY, 1);
    const blue = sampleBilinearChannel(commandPointer, imageX, imageY, 2);
    visibleCount += 1;
    if (scorer == 1) {
      score += scoreFixed(red, green, blue);
    } else if (scorer == 2) {
      score += scoreForeground(red, green, blue);
    } else {
      score += scorePlayer(red, green, blue, playerRed, playerGreen, playerBlue);
    }
  }
  return visibleCount > 0 ? score / visibleCount : 0;
}

function estimatePlayerColorChannel(
  commandPointer: u32,
  baseIndex: u32,
  sourceX: f64,
  sourceY: f64,
  channel: u32,
): f64 {
  const rangesPointer = load<u32>(commandPointer + DETECTION_INPUT_BASE_RANGES_POINTER_OFFSET);
  const range = rangesPointer + (baseIndex * BASE_RANGE_STRIDE + RANGE_PLAYER) * sizeof<u32>();
  const offset = load<u32>(range);
  const count = load<u32>(range + sizeof<u32>());
  const pixelsPointer = load<u32>(commandPointer + DETECTION_INPUT_PIXEL_COORDINATES_POINTER_OFFSET);
  let value = 0.0;
  let weight = 0.0;
  for (let index: u32 = 0; index < count; index += 1) {
    const pixel = pixelsPointer + (offset + index) * 2;
    const imageX = sourceX + pixelOffset(commandPointer, load<u8>(pixel));
    const imageY = sourceY + pixelOffset(commandPointer, load<u8>(pixel + 1));
    if (!isInsideEdge(commandPointer, imageX, imageY)) {
      continue;
    }
    const red = sampleBilinearChannel(commandPointer, imageX, imageY, 0);
    const green = sampleBilinearChannel(commandPointer, imageX, imageY, 1);
    const blue = sampleBilinearChannel(commandPointer, imageX, imageY, 2);
    const chroma = NativeMath.max(red, NativeMath.max(green, blue)) - NativeMath.min(red, NativeMath.min(green, blue));
    const sampleWeight = 1 + chroma / 255;
    value += (channel == 0 ? red : channel == 1 ? green : blue) * sampleWeight;
    weight += sampleWeight;
  }
  return weight > 0 ? value / weight : 0;
}

function scoreSignature(commandPointer: u32, recordPointer: u32, sourceX: f64, sourceY: f64): f64 {
  const coordinateOffset = load<u32>(recordPointer + 2 * sizeof<u32>());
  const colorOffset = load<u32>(recordPointer + 3 * sizeof<u32>());
  const count = load<u32>(recordPointer + 4 * sizeof<u32>());
  if (count == 0) {
    return 0;
  }
  const pixelsPointer = load<u32>(commandPointer + DETECTION_INPUT_PIXEL_COORDINATES_POINTER_OFFSET);
  const colorsPointer = load<u32>(commandPointer + DETECTION_INPUT_SIGNATURE_COLORS_POINTER_OFFSET);
  let score = 0.0;
  let visibleCount: u32 = 0;
  for (let index: u32 = 0; index < count; index += 1) {
    const pixel = pixelsPointer + (coordinateOffset + index) * 2;
    const imageX = sourceX + pixelOffset(commandPointer, load<u8>(pixel));
    const imageY = sourceY + pixelOffset(commandPointer, load<u8>(pixel + 1));
    if (!isInsideEdge(commandPointer, imageX, imageY)) {
      continue;
    }
    const red = sampleBilinearChannel(commandPointer, imageX, imageY, 0);
    const green = sampleBilinearChannel(commandPointer, imageX, imageY, 1);
    const blue = sampleBilinearChannel(commandPointer, imageX, imageY, 2);
    const color = load<u32>(colorsPointer + (colorOffset + index) * sizeof<u32>());
    const distance = NativeMath.abs(red - (color >> 16)) + NativeMath.abs(green - ((color >> 8) & 0xff)) + NativeMath.abs(blue - (color & 0xff));
    score += clamp(1 - distance / 360, 0, 1);
    visibleCount += 1;
  }
  return visibleCount > 0 ? score / visibleCount : 0;
}

function scoreBackgroundPenalty(commandPointer: u32, isMirrored: bool, sourceX: f64, sourceY: f64): f64 {
  const geometryPointer = load<u32>(commandPointer + DETECTION_INPUT_BASE_GEOMETRY_POINTER_OFFSET);
  const scale = load<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_WIDTH_OFFSET) / getGraphwarPlaneLength();
  const canvasCenter = profileValue(commandPointer, PROFILE_CANVAS_CENTER);
  const visualCenterX = load<f64>(geometryPointer + (isMirrored ? 2 : 0) * sizeof<f64>());
  const visualCenterY = load<f64>(geometryPointer + (isMirrored ? 3 : 1) * sizeof<f64>());
  const centerX = sourceX + (visualCenterX - canvasCenter) * scale;
  const centerY = sourceY + (visualCenterY - canvasCenter) * scale;
  const radius = profileValue(commandPointer, PROFILE_VISIBLE_RADIUS) * scale;
  let suspicious = 0.0;
  for (let index: u32 = 0; index < 8; index += 1) {
    const offsetX = index == 0 || index == 5 ? -1.25 : index == 2 || index == 7 ? 1.25 : index == 3 ? -1.45 : index == 4 ? 1.45 : 0;
    const offsetY = index <= 2 ? (index == 1 ? -1.45 : -1.25) : index >= 5 ? (index == 6 ? 1.45 : 1.25) : 0;
    const x = centerX + offsetX * radius;
    const y = centerY + offsetY * radius;
    if (!isInsideEdge(commandPointer, x, y)) {
      suspicious += 0.5;
      continue;
    }
    const red = sampleBilinearChannel(commandPointer, x, y, 0);
    const green = sampleBilinearChannel(commandPointer, x, y, 1);
    const blue = sampleBilinearChannel(commandPointer, x, y, 2);
    if (isTemplateSeed(red, green, blue) || isPlayerColor(red, green, blue)) {
      suspicious += 1;
    }
  }
  return NativeMath.min(0.06, suspicious * 0.01);
}

function sampleBilinearChannel(commandPointer: u32, x: f64, y: f64, channel: u32): f64 {
  const width = load<u32>(commandPointer + DETECTION_INPUT_WIDTH_OFFSET);
  const height = load<u32>(commandPointer + DETECTION_INPUT_HEIGHT_OFFSET);
  const left = <u32>clamp(NativeMath.floor(x), 0, width - 1);
  const top = <u32>clamp(NativeMath.floor(y), 0, height - 1);
  const right = left + 1 < width ? left + 1 : width - 1;
  const bottom = top + 1 < height ? top + 1 : height - 1;
  const tx = clamp(x - left, 0, 1);
  const ty = clamp(y - top, 0, 1);
  const rgbaPointer = load<u32>(commandPointer + DETECTION_INPUT_RGBA_POINTER_OFFSET);
  return interpolateChannel(rgbaPointer, width, left, top, right, bottom, tx, ty, channel);
}

function interpolateChannel(rgbaPointer: u32, width: u32, left: u32, top: u32, right: u32, bottom: u32, tx: f64, ty: f64, channel: u32): f64 {
  const topLeft = <f64>load<u8>(rgbaPointer + (top * width + left) * 4 + channel);
  const topRight = <f64>load<u8>(rgbaPointer + (top * width + right) * 4 + channel);
  const bottomLeft = <f64>load<u8>(rgbaPointer + (bottom * width + left) * 4 + channel);
  const bottomRight = <f64>load<u8>(rgbaPointer + (bottom * width + right) * 4 + channel);
  const topValue = topLeft + (topRight - topLeft) * tx;
  const bottomValue = bottomLeft + (bottomRight - bottomLeft) * tx;
  return topValue + (bottomValue - topValue) * ty;
}

@inline
function pixelOffset(commandPointer: u32, coordinate: u8): f64 {
  const scale = load<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_WIDTH_OFFSET) / getGraphwarPlaneLength();
  return (<f64>coordinate + 0.5 - profileValue(commandPointer, PROFILE_CANVAS_CENTER)) * scale;
}

@inline
function isInsideEdge(commandPointer: u32, x: f64, y: f64): bool {
  const edgeX = load<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_X_OFFSET);
  const edgeY = load<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_Y_OFFSET);
  return x >= edgeX && x < edgeX + load<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_WIDTH_OFFSET) && y >= edgeY && y < edgeY + load<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_HEIGHT_OFFSET);
}

@inline
function nearestPixelIndex(x: f64, y: f64, width: u32, height: u32): u32 {
  const pixelX = <u32>clamp(NativeMath.floor(x + 0.5), 0, width - 1);
  const pixelY = <u32>clamp(NativeMath.floor(y + 0.5), 0, height - 1);
  return pixelY * width + pixelX;
}

@inline
function isSoldierYellow(red: f64, green: f64, blue: f64): bool {
  return red >= 170 && green >= 160 && blue <= 130 && red + green - blue >= 260;
}

@inline
function isWhiteHighlight(red: f64, green: f64, blue: f64): bool {
  return red >= 235 && green >= 235 && blue >= 220 && NativeMath.max(red, NativeMath.max(green, blue)) - NativeMath.min(red, NativeMath.min(green, blue)) <= 36;
}

@inline
function isTemplateSeed(red: f64, green: f64, blue: f64): bool {
  return isSoldierYellow(red, green, blue) || isWhiteHighlight(red, green, blue);
}

@inline
function isPlaneWhite(red: f64, green: f64, blue: f64): bool {
  return red >= 225 && green >= 225 && blue >= 210 && NativeMath.max(red, NativeMath.max(green, blue)) - NativeMath.min(red, NativeMath.min(green, blue)) <= 35;
}

@inline
function isPlaneGreen(red: f64, green: f64, blue: f64): bool {
  return green >= 155 && red >= 115 && red <= 195 && blue >= 110 && blue <= 195 && green - red >= 20 && green - blue >= 20;
}

@inline
function isAxisBlack(red: f64, green: f64, blue: f64): bool {
  return red <= 42 && green <= 42 && blue <= 42;
}

function isPlayerColor(red: f64, green: f64, blue: f64): bool {
  if (isTemplateSeed(red, green, blue) || isPlaneWhite(red, green, blue) || isPlaneGreen(red, green, blue) || isAxisBlack(red, green, blue)) {
    return false;
  }
  const sum = red + green + blue;
  return NativeMath.max(red, NativeMath.max(green, blue)) - NativeMath.min(red, NativeMath.min(green, blue)) >= 34 && sum >= 72 && sum <= 700;
}

function scoreFixed(red: f64, green: f64, blue: f64): f64 {
  if (isTemplateSeed(red, green, blue)) return 1;
  if (isWhiteHighlight(red, green, blue)) return 0.88;
  if (red <= 145 && green <= 145 && blue <= 145 && NativeMath.max(red, NativeMath.max(green, blue)) - NativeMath.min(red, NativeMath.min(green, blue)) <= 48) return 0.78;
  return scoreForeground(red, green, blue) * 0.48;
}

function scoreForeground(red: f64, green: f64, blue: f64): f64 {
  if (isPlaneWhite(red, green, blue) || isPlaneGreen(red, green, blue)) return 0;
  if (isAxisBlack(red, green, blue)) return 0.2;
  const chroma = NativeMath.max(red, NativeMath.max(green, blue)) - NativeMath.min(red, NativeMath.min(green, blue));
  const brightness = red + green + blue;
  if (brightness < 40 || brightness > 745) return 0.28;
  return clamp(0.5 + chroma / 260, 0, 1);
}

function scorePlayer(red: f64, green: f64, blue: f64, playerRed: f64, playerGreen: f64, playerBlue: f64): f64 {
  if (isPlaneWhite(red, green, blue) || isPlaneGreen(red, green, blue)) return 0;
  const distance = NativeMath.abs(red - playerRed) + NativeMath.abs(green - playerGreen) + NativeMath.abs(blue - playerBlue);
  const chroma = NativeMath.max(red, NativeMath.max(green, blue)) - NativeMath.min(red, NativeMath.min(green, blue));
  return clamp(1 - distance / 420 + chroma / 900, 0, 1);
}

@inline
function normalizeAboveThreshold(score: f64, threshold: f64): f64 {
  return clamp((score - threshold) / (1 - threshold), 0, 1);
}

@inline
function isAcceptedMatch(commandPointer: u32, matchPointer: u32): bool {
  return load<f64>(matchPointer + MATCH_FIXED_SCORE) >= profileValue(commandPointer, PROFILE_MINIMUM_FIXED_SCORE) && load<f64>(matchPointer + MATCH_FOREGROUND_SCORE) >= profileValue(commandPointer, PROFILE_MINIMUM_FOREGROUND_SCORE) && load<f64>(matchPointer + MATCH_PLAYER_SCORE) >= profileValue(commandPointer, PROFILE_MINIMUM_PLAYER_SCORE) && load<f64>(matchPointer + MATCH_SIGNATURE_SCORE) >= profileValue(commandPointer, PROFILE_MINIMUM_SIGNATURE_SCORE);
}

function stableSortCandidateIndexes(pointer: u32, length: u32, countsPointer: u32): void {
  for (let index: u32 = 1; index < length; index += 1) {
    const candidate = load<u32>(pointer + index * sizeof<u32>());
    const score = load<u32>(countsPointer + candidate * sizeof<u32>());
    let insertion = index;
    while (insertion > 0) {
      const previous = load<u32>(pointer + (insertion - 1) * sizeof<u32>());
      if (load<u32>(countsPointer + previous * sizeof<u32>()) >= score) break;
      store<u32>(pointer + insertion * sizeof<u32>(), previous);
      insertion -= 1;
    }
    store<u32>(pointer + insertion * sizeof<u32>(), candidate);
  }
}

function stableSortMatchPointers(pointer: u32, length: u32): void {
  for (let index: u32 = 1; index < length; index += 1) {
    const match = load<u32>(pointer + index * sizeof<u32>());
    const score = load<f64>(match + MATCH_SCORE);
    const votes = load<u32>(match + MATCH_VOTES);
    let insertion = index;
    while (insertion > 0) {
      const previous = load<u32>(pointer + (insertion - 1) * sizeof<u32>());
      const previousScore = load<f64>(previous + MATCH_SCORE);
      const previousVotes = load<u32>(previous + MATCH_VOTES);
      if (previousScore > score || (previousScore == score && previousVotes >= votes)) break;
      store<u32>(pointer + insertion * sizeof<u32>(), previous);
      insertion -= 1;
    }
    store<u32>(pointer + insertion * sizeof<u32>(), match);
  }
}

export const detectionCandidateXOffset = CANDIDATE_X;
export const detectionCandidateYOffset = CANDIDATE_Y;
export const detectionCandidateVotesOffset = CANDIDATE_VOTES;
export const detectionCandidateMirroredOffset = CANDIDATE_MIRRORED;
export const detectionCandidateIndexOffset = CANDIDATE_INDEX;
export const detectionMatchCandidateIndexOffset = MATCH_CANDIDATE_INDEX;
export const detectionMatchXOffset = MATCH_X;
export const detectionMatchYOffset = MATCH_Y;
export const detectionMatchMirroredOffset = MATCH_MIRRORED;

@inline
export function getDetectionSoldierCanvasCenter(commandPointer: u32): f64 {
  return profileValue(commandPointer, PROFILE_CANVAS_CENTER);
}

@inline
export function getDetectionSoldierVisibleCenterX(commandPointer: u32, isMirrored: bool): f64 {
  return profileValue(commandPointer, isMirrored ? PROFILE_MIRROR_VISIBLE_CENTER_X : PROFILE_VISIBLE_CENTER_X);
}

@inline
export function getDetectionSoldierVisibleCenterY(commandPointer: u32): f64 {
  return profileValue(commandPointer, PROFILE_VISIBLE_CENTER_Y);
}

@inline
export function getDetectionSoldierVisibleRadius(commandPointer: u32): f64 {
  return profileValue(commandPointer, PROFILE_VISIBLE_RADIUS);
}
