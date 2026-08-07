import {
  DETECTION_INPUT_HEIGHT_OFFSET,
  DETECTION_INPUT_MATCH_COUNT_OFFSET,
  DETECTION_INPUT_MATCH_POINTER_OFFSET,
  DETECTION_INPUT_RGBA_POINTER_OFFSET,
  DETECTION_INPUT_SESSION_EDGE_HEIGHT_OFFSET,
  DETECTION_INPUT_SESSION_EDGE_WIDTH_OFFSET,
  DETECTION_INPUT_SESSION_EDGE_X_OFFSET,
  DETECTION_INPUT_SESSION_EDGE_Y_OFFSET,
  DETECTION_INPUT_SETTINGS_POINTER_OFFSET,
  DETECTION_INPUT_WIDTH_OFFSET,
  DETECTION_MATCH_BYTE_LENGTH,
} from "./layout";
import {
  detectionMatchMirroredOffset,
  detectionMatchXOffset,
  detectionMatchYOffset,
  getDetectionSoldierCanvasCenter,
  getDetectionSoldierVisibleCenterX,
  getDetectionSoldierVisibleCenterY,
  getDetectionSoldierVisibleRadius,
} from "./template";
import { getGraphwarPlaneHeight, getGraphwarPlaneLength } from "../core/game-constants";
import { reserveArena } from "../core/memory";

@inline
function planeWidth(): u32 {
  return <u32>getGraphwarPlaneLength();
}

@inline
function planeHeight(): u32 {
  return <u32>getGraphwarPlaneHeight();
}

@inline
function maskLength(): u32 {
  return planeWidth() * planeHeight();
}

@inline
function isInsidePlane(x: i32, y: i32): bool {
  return x >= 0 && y >= 0 && x < <i32>planeWidth() && y < <i32>planeHeight();
}

@inline
function colorChroma(red: u32, green: u32, blue: u32): u32 {
  return max<u32>(red, max<u32>(green, blue)) - min<u32>(red, min<u32>(green, blue));
}

@inline
function samplePlaneColor(commandPointer: u32, x: u32, y: u32): u32 {
  const imageWidth = load<u32>(commandPointer + DETECTION_INPUT_WIDTH_OFFSET);
  const imageHeight = load<u32>(commandPointer + DETECTION_INPUT_HEIGHT_OFFSET);
  const edgeX = load<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_X_OFFSET);
  const edgeY = load<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_Y_OFFSET);
  const edgeWidth = load<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_WIDTH_OFFSET);
  const edgeHeight = load<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_HEIGHT_OFFSET);
  let sourceX = <i32>NativeMath.floor(edgeX + ((<f64>x + 0.5) / <f64>planeWidth()) * edgeWidth);
  let sourceY = <i32>NativeMath.floor(edgeY + ((<f64>y + 0.5) / <f64>planeHeight()) * edgeHeight);
  sourceX = max<i32>(0, min<i32>(sourceX, <i32>imageWidth - 1));
  sourceY = max<i32>(0, min<i32>(sourceY, <i32>imageHeight - 1));
  const pixelPointer =
    load<u32>(commandPointer + DETECTION_INPUT_RGBA_POINTER_OFFSET) +
    (<u32>sourceY * imageWidth + <u32>sourceX) * 4;
  return <u32>load<u8>(pixelPointer) | (<u32>load<u8>(pixelPointer + 1) << 8) | (<u32>load<u8>(pixelPointer + 2) << 16);
}

@inline
function isPlaneWhite(red: u32, green: u32, blue: u32): bool {
  return red >= 225 && green >= 225 && blue >= 210 && colorChroma(red, green, blue) <= 35;
}

@inline
function isPlaneGreen(red: u32, green: u32, blue: u32): bool {
  return green >= 155 && red >= 115 && red <= 195 && blue >= 110 && blue <= 195 && green >= red + 20 && green >= blue + 20;
}

@inline
function hasNeighbor(maskPointer: u32, x: u32, y: u32): bool {
  const width = planeWidth();
  for (let offsetY: i32 = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX: i32 = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX == 0 && offsetY == 0) continue;
      const nextX = <i32>x + offsetX;
      const nextY = <i32>y + offsetY;
      if (isInsidePlane(nextX, nextY) && load<u8>(maskPointer + <u32>nextY * width + <u32>nextX) != 0) {
        return true;
      }
    }
  }
  return false;
}

function erode3x3(inputPointer: u32, outputPointer: u32): void {
  const width = planeWidth();
  const height = planeHeight();
  memory.fill(outputPointer, 0, maskLength());
  for (let y: u32 = 1; y + 1 < height; y += 1) {
    for (let x: u32 = 1; x + 1 < width; x += 1) {
      let isSolid = true;
      for (let offsetY: i32 = -1; offsetY <= 1 && isSolid; offsetY += 1) {
        for (let offsetX: i32 = -1; offsetX <= 1; offsetX += 1) {
          if (load<u8>(inputPointer + <u32>(<i32>y + offsetY) * width + <u32>(<i32>x + offsetX)) == 0) {
            isSolid = false;
            break;
          }
        }
      }
      if (isSolid) store<u8>(outputPointer + y * width + x, 1);
    }
  }
}

/** `sqrt(2)` dilation includes exactly the 3x3 neighborhood used by the TypeScript opening. */
function dilateOpenedMask(inputPointer: u32, outputPointer: u32): void {
  const width = planeWidth();
  const height = planeHeight();
  memory.fill(outputPointer, 0, maskLength());
  for (let y: u32 = 0; y < height; y += 1) {
    for (let x: u32 = 0; x < width; x += 1) {
      if (load<u8>(inputPointer + y * width + x) == 0) continue;
      for (let offsetY: i32 = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX: i32 = -1; offsetX <= 1; offsetX += 1) {
          const nextX = <i32>x + offsetX;
          const nextY = <i32>y + offsetY;
          if (isInsidePlane(nextX, nextY)) {
            store<u8>(outputPointer + <u32>nextY * width + <u32>nextX, 1);
          }
        }
      }
    }
  }
}

function openMask(inputPointer: u32, outputPointer: u32, erosionPointer: u32): void {
  erode3x3(inputPointer, erosionPointer);
  dilateOpenedMask(erosionPointer, outputPointer);
}

@inline
function enqueueNeighbor(
  maskPointer: u32,
  visitedPointer: u32,
  queuePointer: u32,
  queueLength: u32,
  current: u32,
  next: i32,
): u32 {
  const width = planeWidth();
  if (
    next < 0 ||
    next >= <i32>maskLength() ||
    load<u8>(visitedPointer + <u32>next) != 0 ||
    load<u8>(maskPointer + <u32>next) == 0 ||
    (next == <i32>current - 1 && current % width == 0) ||
    (next == <i32>current + 1 && current % width == width - 1)
  ) {
    return queueLength;
  }
  store<u8>(visitedPointer + <u32>next, 1);
  store<u32>(queuePointer + queueLength * sizeof<u32>(), <u32>next);
  return queueLength + 1;
}

function collectComponent(
  maskPointer: u32,
  visitedPointer: u32,
  queuePointer: u32,
  start: u32,
): u32 {
  const width = planeWidth();
  store<u8>(visitedPointer + start, 1);
  store<u32>(queuePointer, start);
  let queueLength: u32 = 1;
  let readIndex: u32 = 0;
  while (readIndex < queueLength) {
    const current = load<u32>(queuePointer + readIndex * sizeof<u32>());
    readIndex += 1;
    queueLength = enqueueNeighbor(maskPointer, visitedPointer, queuePointer, queueLength, current, <i32>current - 1);
    queueLength = enqueueNeighbor(maskPointer, visitedPointer, queuePointer, queueLength, current, <i32>current + 1);
    queueLength = enqueueNeighbor(maskPointer, visitedPointer, queuePointer, queueLength, current, <i32>current - <i32>width);
    queueLength = enqueueNeighbor(maskPointer, visitedPointer, queuePointer, queueLength, current, <i32>current + <i32>width);
  }
  return queueLength;
}

function retainLargeSeedComponents(seedPointer: u32, corePointer: u32, minimumArea: f64): void {
  const length = maskLength();
  const visitedPointer = reserveArena(length, 1);
  const queuePointer = reserveArena(length * sizeof<u32>(), sizeof<u32>());
  memory.fill(visitedPointer, 0, length);
  memory.fill(corePointer, 0, length);
  for (let start: u32 = 0; start < length; start += 1) {
    if (load<u8>(seedPointer + start) == 0 || load<u8>(visitedPointer + start) != 0) continue;
    const area = collectComponent(seedPointer, visitedPointer, queuePointer, start);
    if (<f64>area < minimumArea) continue;
    for (let index: u32 = 0; index < area; index += 1) {
      store<u8>(corePointer + load<u32>(queuePointer + index * sizeof<u32>()), 1);
    }
  }
}

/** Builds the long-lived obstacle source mask while all intermediate arrays remain scratch-owned. */
export function buildDetectionObstacleSourceMask(commandPointer: u32, outputPointer: u32): void {
  const length = maskLength();
  const width = planeWidth();
  const height = planeHeight();
  const rawPointer = reserveArena(length, 1);
  const erodedPointer = reserveArena(length, 1);
  const seedPointer = reserveArena(length, 1);
  const corePointer = reserveArena(length, 1);
  const solidPointer = reserveArena(length, 1);
  memory.fill(rawPointer, 0, length);
  for (let y: u32 = 0; y < height; y += 1) {
    for (let x: u32 = 0; x < width; x += 1) {
      const color = samplePlaneColor(commandPointer, x, y);
      const red = color & 0xff;
      const green = (color >> 8) & 0xff;
      const blue = (color >> 16) & 0xff;
      if (red <= 104 && green <= 104 && blue <= 104 && colorChroma(red, green, blue) <= 36) {
        store<u8>(rawPointer + y * width + x, 1);
      }
    }
  }
  openMask(rawPointer, seedPointer, erodedPointer);
  retainLargeSeedComponents(
    seedPointer,
    corePointer,
    load<f64>(load<u32>(commandPointer + DETECTION_INPUT_SETTINGS_POINTER_OFFSET)),
  );
  memory.copy(solidPointer, corePointer, length);
  for (let y: u32 = 0; y < height; y += 1) {
    for (let x: u32 = 0; x < width; x += 1) {
      const index = y * width + x;
      if (load<u8>(solidPointer + index) == 0 && load<u8>(rawPointer + index) != 0 && hasNeighbor(corePointer, x, y)) {
        store<u8>(solidPointer + index, 1);
      }
    }
  }
  memory.copy(outputPointer, solidPointer, length);
  for (let y: u32 = 0; y < height; y += 1) {
    for (let x: u32 = 0; x < width; x += 1) {
      const index = y * width + x;
      if (load<u8>(outputPointer + index) != 0 || !hasNeighbor(solidPointer, x, y)) continue;
      const color = samplePlaneColor(commandPointer, x, y);
      const red = color & 0xff;
      const green = (color >> 8) & 0xff;
      const blue = (color >> 16) & 0xff;
      const maximum = max<u32>(red, max<u32>(green, blue));
      if (
        !isPlaneWhite(red, green, blue) &&
        !isPlaneGreen(red, green, blue) &&
        maximum > 104 &&
        red <= 224 &&
        green <= 224 &&
        blue <= 224 &&
        colorChroma(red, green, blue) <= 42
      ) {
        store<u8>(outputPointer + index, 1);
      }
    }
  }
}

function removeCenterGuideLines(maskPointer: u32): void {
  const width = planeWidth();
  const height = planeHeight();
  const centerX = width / 2;
  const centerY = height / 2;
  for (let y: u32 = 0; y < height; y += 1) {
    for (let x: u32 = 0; x < width; x += 1) {
      if (abs(<i32>x - <i32>centerX) <= 1 || abs(<i32>y - <i32>centerY) <= 1) {
        store<u8>(maskPointer + y * width + x, 0);
      }
    }
  }
}

function removeBoundaryGuideLines(maskPointer: u32): void {
  const width = planeWidth();
  const height = planeHeight();
  for (let y: u32 = 0; y < height; y += 1) {
    for (let x: u32 = 0; x < width; x += 1) {
      if (x <= 1 || x >= width - 2 || y <= 1 || y >= height - 2) store<u8>(maskPointer + y * width + x, 0);
    }
  }
}

function bridgeGuideLineGaps(maskPointer: u32, scratchPointer: u32): void {
  const width = planeWidth();
  const height = planeHeight();
  const centerX = width / 2;
  const centerY = height / 2;
  memory.copy(scratchPointer, maskPointer, maskLength());
  for (let y: u32 = 2; y < height - 2; y += 1) {
    const hasLeft = load<u8>(maskPointer + y * width + centerX - 2) != 0 || load<u8>(maskPointer + y * width + centerX - 3) != 0;
    const hasRight = load<u8>(maskPointer + y * width + centerX + 2) != 0 || load<u8>(maskPointer + y * width + centerX + 3) != 0;
    if (hasLeft && hasRight) {
      for (let x = centerX - 1; x <= centerX + 1; x += 1) store<u8>(scratchPointer + y * width + x, 1);
    }
  }
  for (let x: u32 = 2; x < width - 2; x += 1) {
    const hasTop = load<u8>(maskPointer + (centerY - 2) * width + x) != 0 || load<u8>(maskPointer + (centerY - 3) * width + x) != 0;
    const hasBottom = load<u8>(maskPointer + (centerY + 2) * width + x) != 0 || load<u8>(maskPointer + (centerY + 3) * width + x) != 0;
    if (hasTop && hasBottom) {
      for (let y = centerY - 1; y <= centerY + 1; y += 1) store<u8>(scratchPointer + y * width + x, 1);
    }
  }
  memory.copy(maskPointer, scratchPointer, maskLength());
}

function removeSoldierAreas(commandPointer: u32, maskPointer: u32): void {
  const edgeX = load<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_X_OFFSET);
  const edgeY = load<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_Y_OFFSET);
  const edgeWidth = load<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_WIDTH_OFFSET);
  const edgeHeight = load<f64>(commandPointer + DETECTION_INPUT_SESSION_EDGE_HEIGHT_OFFSET);
  const scale = edgeWidth / <f64>planeWidth();
  const canvasCenter = getDetectionSoldierCanvasCenter(commandPointer);
  const visualCenterY = getDetectionSoldierVisibleCenterY(commandPointer);
  const visualRadius = getDetectionSoldierVisibleRadius(commandPointer) * scale;
  const radiusX = (visualRadius / edgeWidth) * <f64>planeWidth();
  const radiusY = (visualRadius / edgeHeight) * <f64>planeHeight();
  const radius = <i32>NativeMath.ceil(NativeMath.max(radiusX, radiusY));
  const radiusSquared = radius * radius;
  const matchesPointer = load<u32>(commandPointer + DETECTION_INPUT_MATCH_POINTER_OFFSET);
  const matchCount = load<u32>(commandPointer + DETECTION_INPUT_MATCH_COUNT_OFFSET);
  const width = planeWidth();
  for (let matchIndex: u32 = 0; matchIndex < matchCount; matchIndex += 1) {
    const matchPointer = matchesPointer + matchIndex * DETECTION_MATCH_BYTE_LENGTH;
    const isMirrored = load<u32>(matchPointer + detectionMatchMirroredOffset) != 0;
    const visualX =
      load<f64>(matchPointer + detectionMatchXOffset) +
      (getDetectionSoldierVisibleCenterX(commandPointer, isMirrored) - canvasCenter) * scale;
    const visualY = load<f64>(matchPointer + detectionMatchYOffset) + (visualCenterY - canvasCenter) * scale;
    const centerX = max<i32>(
      0,
      min<i32>(<i32>NativeMath.floor(((visualX - edgeX) / edgeWidth) * <f64>width), <i32>width - 1),
    );
    const centerY = max<i32>(
      0,
      min<i32>(<i32>NativeMath.floor(((visualY - edgeY) / edgeHeight) * <f64>planeHeight()), <i32>planeHeight() - 1),
    );
    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        if (offsetX * offsetX + offsetY * offsetY > radiusSquared) continue;
        const x = centerX + offsetX;
        const y = centerY + offsetY;
        if (isInsidePlane(x, y)) store<u8>(maskPointer + <u32>y * width + <u32>x, 0);
      }
    }
  }
}

function floodRestoreComponent(targetPointer: u32, sourcePointer: u32, queuePointer: u32, start: u32): bool {
  if (load<u8>(sourcePointer + start) == 0 || load<u8>(targetPointer + start) != 0) return false;
  const width = planeWidth();
  store<u8>(targetPointer + start, 1);
  store<u32>(queuePointer, start);
  let queueLength: u32 = 1;
  let readIndex: u32 = 0;
  while (readIndex < queueLength) {
    const current = load<u32>(queuePointer + readIndex * sizeof<u32>());
    readIndex += 1;
    const x = current % width;
    const left = <i32>current - 1;
    const right = <i32>current + 1;
    const top = <i32>current - <i32>width;
    const bottom = <i32>current + <i32>width;
    for (let direction: u32 = 0; direction < 4; direction += 1) {
      const next = direction == 0 ? left : direction == 1 ? right : direction == 2 ? top : bottom;
      if (
        next < 0 ||
        next >= <i32>maskLength() ||
        load<u8>(sourcePointer + <u32>next) == 0 ||
        load<u8>(targetPointer + <u32>next) != 0 ||
        (direction == 0 && x == 0) ||
        (direction == 1 && x == width - 1)
      ) {
        continue;
      }
      store<u8>(targetPointer + <u32>next, 1);
      store<u32>(queuePointer + queueLength * sizeof<u32>(), <u32>next);
      queueLength += 1;
    }
  }
  return true;
}

/** Filters the retained source mask and writes the exact final mask into caller-owned long-lived storage. */
export function filterDetectionObstacleComponents(commandPointer: u32, sourcePointer: u32, outputPointer: u32): u32 {
  const length = maskLength();
  const width = planeWidth();
  const detectionPointer = reserveArena(length, 1);
  const restorePointer = reserveArena(length, 1);
  const bridgePointer = reserveArena(length, 1);
  const erodedPointer = reserveArena(length, 1);
  const componentPointer = reserveArena(length, 1);
  const visitedPointer = reserveArena(length, 1);
  const componentQueuePointer = reserveArena(length * sizeof<u32>(), sizeof<u32>());
  const floodQueuePointer = reserveArena(length * sizeof<u32>(), sizeof<u32>());
  memory.copy(detectionPointer, sourcePointer, length);
  removeCenterGuideLines(detectionPointer);
  removeBoundaryGuideLines(detectionPointer);
  bridgeGuideLineGaps(detectionPointer, bridgePointer);
  removeSoldierAreas(commandPointer, detectionPointer);
  memory.copy(restorePointer, sourcePointer, length);
  removeCenterGuideLines(restorePointer);
  bridgeGuideLineGaps(restorePointer, bridgePointer);
  removeSoldierAreas(commandPointer, restorePointer);
  openMask(detectionPointer, componentPointer, erodedPointer);
  memory.fill(outputPointer, 0, length);
  memory.fill(visitedPointer, 0, length);
  const minimumArea = load<f64>(load<u32>(commandPointer + DETECTION_INPUT_SETTINGS_POINTER_OFFSET));
  let count: u32 = 0;
  for (let start: u32 = 0; start < length; start += 1) {
    if (load<u8>(componentPointer + start) == 0 || load<u8>(visitedPointer + start) != 0) continue;
    const area = collectComponent(componentPointer, visitedPointer, componentQueuePointer, start);
    if (<f64>area < minimumArea) continue;
    let minX = width;
    let minY = planeHeight();
    let maxX: u32 = 0;
    let maxY: u32 = 0;
    for (let index: u32 = 0; index < area; index += 1) {
      const pixel = load<u32>(componentQueuePointer + index * sizeof<u32>());
      const x = pixel % width;
      const y = pixel / width;
      minX = min(minX, x);
      minY = min(minY, y);
      maxX = max(maxX, x);
      maxY = max(maxY, y);
    }
    let hasAddedPixels = false;
    // TypeScript intentionally scans the component box, so enclosed seed components share this count bucket.
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const seed = y * width + x;
        if (
          load<u8>(componentPointer + seed) != 0 &&
          load<u8>(restorePointer + seed) != 0 &&
          load<u8>(outputPointer + seed) == 0
        ) {
          hasAddedPixels = floodRestoreComponent(outputPointer, restorePointer, floodQueuePointer, seed) || hasAddedPixels;
        }
      }
    }
    if (hasAddedPixels) count += 1;
  }
  return count;
}

export function getDetectionObstacleMaskLength(): u32 {
  return maskLength();
}
