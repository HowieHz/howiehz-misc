import { getGraphwarPlaneHeight, getGraphwarPlaneLength, requireGraphwarGameConstantsInitialized } from "./game-constants";
import { markArena, requireArenaInitialized, requireArenaRange, reserveArena, resetArena } from "./memory";
import * as Layout from "./pathfinding-layout";

const ROUTE_POLICY_VALUE_COUNT: u32 = 12;
const THETA_STAR_LOOKAHEAD_OFFSET_COUNT: u32 = 8;

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
function getPlaneWidth(): u32 {
  return <u32>getGraphwarPlaneLength();
}

@inline
function getPlaneHeight(): u32 {
  return <u32>getGraphwarPlaneHeight();
}

@inline
function getPlaneCellCount(): u32 {
  return getPlaneWidth() * getPlaneHeight();
}

@inline
function loadContextValue(pointer: u32, index: u32): f64 {
  return load<f64>(pointer + index * sizeof<f64>());
}

@inline
function loadPositivePolicyInteger(pointer: u32, index: u32, maximum: u32): u32 {
  const value = loadContextValue(pointer, index);
  if (!isIntegerValue(value) || value <= 0 || value > <f64>maximum) trap();
  return <u32>value;
}

@inline
function clampValue(value: f64, minimum: f64, maximum: f64): f64 {
  return NativeMath.max(minimum, NativeMath.min(maximum, value));
}

@inline
function offsetIsInsideRadius(offsetX: i32, offsetY: i32, radiusSquared: f64): bool {
  const x = <f64>offsetX;
  const y = <f64>offsetY;
  return x * x + y * y <= radiusSquared;
}

@inline
function planePointIsInsideBounds(x: i32, y: i32): bool {
  return x >= 0 && y >= 0 && x < <i32>getPlaneWidth() && y < <i32>getPlaneHeight();
}

function fillFriendlySoldierAreas(
  maskPointer: u32,
  centerXPointer: u32,
  centerYPointer: u32,
  centerCount: u32,
  rectX: f64,
  rectY: f64,
  rectWidth: f64,
  rectHeight: f64,
  soldierHitRadiusPixels: f64,
): void {
  const width = getPlaneWidth();
  const height = getPlaneHeight();
  const radius = NativeMath.ceil((soldierHitRadiusPixels / rectWidth) * <f64>width);
  const radiusSquared = radius * radius;
  let centerIndex: u32 = 0;
  while (centerIndex < centerCount) {
    const imageX = load<f64>(centerXPointer + centerIndex * sizeof<f64>());
    const imageY = load<f64>(centerYPointer + centerIndex * sizeof<f64>());
    let centerX = <i32>NativeMath.floor(((imageX - rectX) / rectWidth) * <f64>width);
    let centerY = <i32>NativeMath.floor(((imageY - rectY) / rectHeight) * <f64>height);
    centerX = <i32>NativeMath.max(0, NativeMath.min(<f64>(width - 1), <f64>centerX));
    centerY = <i32>NativeMath.max(0, NativeMath.min(<f64>(height - 1), <f64>centerY));

    const minX = <i32>NativeMath.max(0, NativeMath.floor(<f64>centerX - radius) - 1);
    const maxX = <i32>NativeMath.min(<f64>(width - 1), NativeMath.ceil(<f64>centerX + radius));
    const minY = <i32>NativeMath.max(0, NativeMath.floor(<f64>centerY - radius) - 1);
    const maxY = <i32>NativeMath.min(<f64>(height - 1), NativeMath.ceil(<f64>centerY + radius));
    let y = minY;
    while (y <= maxY) {
      const nearestY = clampValue(<f64>centerY, <f64>y, <f64>(y + 1));
      let x = minX;
      while (x <= maxX) {
        const nearestX = clampValue(<f64>centerX, <f64>x, <f64>(x + 1));
        const deltaX = nearestX - <f64>centerX;
        const deltaY = nearestY - <f64>centerY;
        if (deltaX * deltaX + deltaY * deltaY <= radiusSquared) {
          store<u8>(maskPointer + <u32>y * width + <u32>x, 1);
        }
        x += 1;
      }
      y += 1;
    }
    centerIndex += 1;
  }
}

function createDilatedMask(sourcePointer: u32, radius: f64): u32 {
  const width = getPlaneWidth();
  const height = getPlaneHeight();
  const cellCount = width * height;
  const outputPointer = reserveArena(cellCount, 1);
  memory.fill(outputPointer, 0, cellCount);
  const radiusSquared = radius * radius;
  const maximumDeltaX = <f64>(width - 1);
  const maximumDeltaY = <f64>(height - 1);
  if (radiusSquared >= maximumDeltaX * maximumDeltaX + maximumDeltaY * maximumDeltaY) {
    if (countMaskObstacles(sourcePointer) > 0) memory.fill(outputPointer, 1, cellCount);
    return outputPointer;
  }
  const offsetLimit = <i32>NativeMath.min(
    NativeMath.ceil(radius),
    <f64>NativeMath.max(<f64>(width - 1), <f64>(height - 1)),
  );
  let y: i32 = 0;
  while (y < <i32>height) {
    let x: i32 = 0;
    while (x < <i32>width) {
      if (load<u8>(sourcePointer + <u32>y * width + <u32>x) != 0) {
        let offsetY = -offsetLimit;
        while (offsetY <= offsetLimit) {
          let offsetX = -offsetLimit;
          while (offsetX <= offsetLimit) {
            if (offsetIsInsideRadius(offsetX, offsetY, radiusSquared)) {
              const nextX = x + offsetX;
              const nextY = y + offsetY;
              if (planePointIsInsideBounds(nextX, nextY)) {
                store<u8>(outputPointer + <u32>nextY * width + <u32>nextX, 1);
              }
            }
            offsetX += 1;
          }
          offsetY += 1;
        }
      }
      x += 1;
    }
    y += 1;
  }
  return outputPointer;
}

function createErodedMask(sourcePointer: u32, radius: f64): u32 {
  const width = getPlaneWidth();
  const height = getPlaneHeight();
  const cellCount = width * height;
  const outputPointer = reserveArena(cellCount, 1);
  memory.fill(outputPointer, 0, cellCount);
  const radiusSquared = radius * radius;
  // Every plane cell is within this distance of an out-of-bounds cell, so larger disks cannot retain an obstacle.
  if (radius >= NativeMath.ceil(<f64>NativeMath.min(<f64>width, <f64>height) / 2)) return outputPointer;
  const offsetLimit = <i32>NativeMath.min(
    NativeMath.ceil(radius),
    <f64>NativeMath.max(<f64>(width - 1), <f64>(height - 1)),
  );
  let y: i32 = 0;
  while (y < <i32>height) {
    let x: i32 = 0;
    while (x < <i32>width) {
      if (load<u8>(sourcePointer + <u32>y * width + <u32>x) != 0) {
        let isSolid = true;
        let offsetY = -offsetLimit;
        while (offsetY <= offsetLimit && isSolid) {
          let offsetX = -offsetLimit;
          while (offsetX <= offsetLimit) {
            if (offsetIsInsideRadius(offsetX, offsetY, radiusSquared)) {
              const nextX = x + offsetX;
              const nextY = y + offsetY;
              if (
                !planePointIsInsideBounds(nextX, nextY) ||
                load<u8>(sourcePointer + <u32>nextY * width + <u32>nextX) == 0
              ) {
                isSolid = false;
                break;
              }
            }
            offsetX += 1;
          }
          offsetY += 1;
        }
        if (isSolid) {
          store<u8>(outputPointer + <u32>y * width + <u32>x, 1);
        }
      }
      x += 1;
    }
    y += 1;
  }
  return outputPointer;
}

@inline
function createToleranceMask(sourcePointer: u32, tolerance: f64): u32 {
  return tolerance < 0 ? createErodedMask(sourcePointer, -tolerance) : createDilatedMask(sourcePointer, tolerance);
}

function countMaskObstacles(maskPointer: u32): u32 {
  const cellCount = getPlaneCellCount();
  let count: u32 = 0;
  let index: u32 = 0;
  while (index < cellCount) {
    if (load<u8>(maskPointer + index) != 0) count += 1;
    index += 1;
  }
  return count;
}

function createSummedArea(maskPointer: u32): u32 {
  const width = getPlaneWidth();
  const height = getPlaneHeight();
  const stride = width + 1;
  const valueCount = stride * (height + 1);
  const pointer = reserveArena(valueCount * sizeof<u32>(), sizeof<u32>());
  memory.fill(pointer, 0, valueCount * sizeof<u32>());
  let y: u32 = 0;
  while (y < height) {
    const maskRowOffset = y * width;
    const previousRowOffset = y * stride;
    const rowOffset = (y + 1) * stride;
    let rowCount: u32 = 0;
    let x: u32 = 0;
    while (x < width) {
      if (load<u8>(maskPointer + maskRowOffset + x) != 0) rowCount += 1;
      store<u32>(pointer + (rowOffset + x + 1) * sizeof<u32>(), load<u32>(pointer + (previousRowOffset + x + 1) * sizeof<u32>()) + rowCount);
      x += 1;
    }
    y += 1;
  }
  return pointer;
}

function labelRouteComponents(
  maskPointer: u32,
  componentIdsPointer: u32,
  queuePointer: u32,
  isMirrored: bool,
): u32 {
  const width = getPlaneWidth();
  const height = getPlaneHeight();
  let componentCount: u32 = 0;
  let y: u32 = 0;
  while (y < height) {
    let x: u32 = 0;
    while (x < width) {
      const startIndex = y * width + x;
      if (
        !routeCellIsBlocked(maskPointer, <i32>x, <i32>y, isMirrored) ||
        load<u32>(componentIdsPointer + startIndex * sizeof<u32>()) != 0
      ) {
        x += 1;
        continue;
      }
      componentCount += 1;
      let queueStart: u32 = 0;
      let queueEnd: u32 = 1;
      store<u32>(queuePointer, startIndex);
      store<u32>(componentIdsPointer + startIndex * sizeof<u32>(), componentCount);
      while (queueStart < queueEnd) {
        const currentIndex = load<u32>(queuePointer + queueStart * sizeof<u32>());
        queueStart += 1;
        const currentX = <i32>(currentIndex % width);
        const currentY = <i32>(currentIndex / width);
        let offsetY: i32 = -1;
        while (offsetY <= 1) {
          let offsetX: i32 = -1;
          while (offsetX <= 1) {
            if (offsetX != 0 || offsetY != 0) {
              const nextX = currentX + offsetX;
              const nextY = currentY + offsetY;
              if (planePointIsInsideBounds(nextX, nextY)) {
                const nextIndex = <u32>nextY * width + <u32>nextX;
                if (
                  routeCellIsBlocked(maskPointer, nextX, nextY, isMirrored) &&
                  load<u32>(componentIdsPointer + nextIndex * sizeof<u32>()) == 0
                ) {
                  store<u32>(componentIdsPointer + nextIndex * sizeof<u32>(), componentCount);
                  store<u32>(queuePointer + queueEnd * sizeof<u32>(), nextIndex);
                  queueEnd += 1;
                }
              }
            }
            offsetX += 1;
          }
          offsetY += 1;
        }
      }
      x += 1;
    }
    y += 1;
  }
  return componentCount;
}

@inline
function routeCellIsBlocked(maskPointer: u32, forwardX: i32, y: i32, isMirrored: bool): bool {
  if (!planePointIsInsideBounds(forwardX, y)) return false;
  const width = <i32>getPlaneWidth();
  const x = isMirrored ? width - 1 - forwardX : forwardX;
  return load<u8>(maskPointer + <u32>y * <u32>width + <u32>x) != 0;
}

@inline
function normalizeBoundaryInset(value: f64): i32 {
  return <i32>NativeMath.min(NativeMath.floor(value), <f64>NativeMath.max(getPlaneWidth(), getPlaneHeight()));
}

@inline
function routePointHitsMask(
  maskPointer: u32,
  forwardX: i32,
  y: i32,
  isMirrored: bool,
  boundaryInset: i32,
): bool {
  const width = <i32>getPlaneWidth();
  const height = <i32>getPlaneHeight();
  return (
    forwardX < boundaryInset ||
    forwardX >= width - boundaryInset ||
    y < boundaryInset ||
    y >= height - boundaryInset ||
    routeCellIsBlocked(maskPointer, forwardX, y, isMirrored)
  );
}

function countFreeColumnSpans(maskPointer: u32, isMirrored: bool, boundaryInset: i32): u32 {
  const width = <i32>getPlaneWidth();
  const height = <i32>getPlaneHeight();
  let count: u32 = 0;
  let x: i32 = 0;
  while (x < width) {
    let isInsideSpan = false;
    let y: i32 = 0;
    while (y < height) {
      const isFree = !routePointHitsMask(maskPointer, x, y, isMirrored, boundaryInset);
      if (isFree && !isInsideSpan) {
        count += 1;
        isInsideSpan = true;
      } else if (!isFree) {
        isInsideSpan = false;
      }
      y += 1;
    }
    x += 1;
  }
  return count;
}

function fillFreeColumnSpans(
  maskPointer: u32,
  isMirrored: bool,
  boundaryInset: i32,
  offsetsPointer: u32,
  valuesPointer: u32,
): void {
  const width = <i32>getPlaneWidth();
  const height = <i32>getPlaneHeight();
  let spanIndex: u32 = 0;
  let x: i32 = 0;
  while (x < width) {
    store<u32>(offsetsPointer + <u32>x * sizeof<u32>(), spanIndex);
    let spanStartY: i32 = -1;
    let y: i32 = 0;
    while (y < height) {
      const isFree = !routePointHitsMask(maskPointer, x, y, isMirrored, boundaryInset);
      if (isFree && spanStartY < 0) {
        spanStartY = y;
      } else if (!isFree && spanStartY >= 0) {
        store<u32>(valuesPointer + spanIndex * 2 * sizeof<u32>(), <u32>spanStartY);
        store<u32>(valuesPointer + (spanIndex * 2 + 1) * sizeof<u32>(), <u32>(y - 1));
        spanIndex += 1;
        spanStartY = -1;
      }
      y += 1;
    }
    if (spanStartY >= 0) {
      store<u32>(valuesPointer + spanIndex * 2 * sizeof<u32>(), <u32>spanStartY);
      store<u32>(valuesPointer + (spanIndex * 2 + 1) * sizeof<u32>(), <u32>(height - 1));
      spanIndex += 1;
    }
    x += 1;
  }
  store<u32>(offsetsPointer + <u32>width * sizeof<u32>(), spanIndex);
}

function countBoundaryEdges(maskPointer: u32, isMirrored: bool): u32 {
  const width = getPlaneWidth();
  const height = getPlaneHeight();
  let count: u32 = 0;
  let y: i32 = 0;
  while (y < <i32>height) {
    let x: i32 = 0;
    while (x < <i32>width) {
      if (routeCellIsBlocked(maskPointer, x, y, isMirrored)) {
        if (!routeCellIsBlocked(maskPointer, x, y - 1, isMirrored)) count += 1;
        if (!routeCellIsBlocked(maskPointer, x + 1, y, isMirrored)) count += 1;
        if (!routeCellIsBlocked(maskPointer, x, y + 1, isMirrored)) count += 1;
        if (!routeCellIsBlocked(maskPointer, x - 1, y, isMirrored)) count += 1;
      }
      x += 1;
    }
    y += 1;
  }
  return count;
}

function storeBoundaryEdge(
  pointer: u32,
  edgeIndex: u32,
  componentId: u32,
  startX: i32,
  startY: i32,
  endX: i32,
  endY: i32,
): void {
  const recordPointer = pointer + edgeIndex * Layout.ROUTE_BOUNDARY_EDGE_RECORD_U32_LENGTH * sizeof<u32>();
  store<u32>(recordPointer, componentId);
  store<i32>(recordPointer + sizeof<u32>(), startX);
  store<i32>(recordPointer + 2 * sizeof<u32>(), startY);
  store<i32>(recordPointer + 3 * sizeof<u32>(), endX);
  store<i32>(recordPointer + 4 * sizeof<u32>(), endY);
}

function createBoundaryEdges(maskPointer: u32, componentIdsPointer: u32, edgeCount: u32, isMirrored: bool): u32 {
  if (edgeCount == 0) return 0;
  const pointer = reserveArena(edgeCount * Layout.ROUTE_BOUNDARY_EDGE_RECORD_U32_LENGTH * sizeof<u32>(), sizeof<u32>());
  const width = getPlaneWidth();
  const height = getPlaneHeight();
  let edgeIndex: u32 = 0;
  let y: i32 = 0;
  while (y < <i32>height) {
    let x: i32 = 0;
    while (x < <i32>width) {
      if (routeCellIsBlocked(maskPointer, x, y, isMirrored)) {
        const componentId = load<u32>(componentIdsPointer + (<u32>y * width + <u32>x) * sizeof<u32>());
        if (!routeCellIsBlocked(maskPointer, x, y - 1, isMirrored)) {
          storeBoundaryEdge(pointer, edgeIndex, componentId, x, y, x + 1, y);
          edgeIndex += 1;
        }
        if (!routeCellIsBlocked(maskPointer, x + 1, y, isMirrored)) {
          storeBoundaryEdge(pointer, edgeIndex, componentId, x + 1, y, x + 1, y + 1);
          edgeIndex += 1;
        }
        if (!routeCellIsBlocked(maskPointer, x, y + 1, isMirrored)) {
          storeBoundaryEdge(pointer, edgeIndex, componentId, x + 1, y + 1, x, y + 1);
          edgeIndex += 1;
        }
        if (!routeCellIsBlocked(maskPointer, x - 1, y, isMirrored)) {
          storeBoundaryEdge(pointer, edgeIndex, componentId, x, y + 1, x, y);
          edgeIndex += 1;
        }
      }
      x += 1;
    }
    y += 1;
  }
  if (edgeIndex != edgeCount) trap();
  return pointer;
}

function createRouteContext(inputPointer: u32, inputByteLength: u32): u32 {
  if (inputByteLength != Layout.ROUTE_CREATE_INPUT_BYTE_LENGTH) trap();
  requireArenaRange(inputPointer, inputByteLength, sizeof<u64>());
  const sourceMaskPointer = load<u32>(inputPointer + Layout.ROUTE_CREATE_SOURCE_MASK_POINTER_OFFSET);
  const sourceMaskLength = load<u32>(inputPointer + Layout.ROUTE_CREATE_SOURCE_MASK_LENGTH_OFFSET);
  const contextValuesPointer = load<u32>(inputPointer + Layout.ROUTE_CREATE_CONTEXT_VALUES_POINTER_OFFSET);
  const contextValuesLength = load<u32>(inputPointer + Layout.ROUTE_CREATE_CONTEXT_VALUES_LENGTH_OFFSET);
  const friendlyXPointer = load<u32>(inputPointer + Layout.ROUTE_CREATE_FRIENDLY_X_POINTER_OFFSET);
  const friendlyYPointer = load<u32>(inputPointer + Layout.ROUTE_CREATE_FRIENDLY_Y_POINTER_OFFSET);
  const friendlyCount = load<u32>(inputPointer + Layout.ROUTE_CREATE_FRIENDLY_COUNT_OFFSET);
  const policyPointer = load<u32>(inputPointer + Layout.ROUTE_CREATE_POLICY_POINTER_OFFSET);
  const policyLength = load<u32>(inputPointer + Layout.ROUTE_CREATE_POLICY_LENGTH_OFFSET);
  const lookaheadPointer = load<u32>(inputPointer + Layout.ROUTE_CREATE_LOOKAHEAD_POINTER_OFFSET);
  const lookaheadLength = load<u32>(inputPointer + Layout.ROUTE_CREATE_LOOKAHEAD_LENGTH_OFFSET);
  const cellCount = getPlaneCellCount();
  if (
    sourceMaskLength != cellCount ||
    contextValuesLength != Layout.ROUTE_CONTEXT_VALUE_COUNT ||
    policyLength != ROUTE_POLICY_VALUE_COUNT ||
    lookaheadLength != THETA_STAR_LOOKAHEAD_OFFSET_COUNT
  ) trap();
  requireArenaRange(sourceMaskPointer, sourceMaskLength, 1);
  requireArenaRange(contextValuesPointer, contextValuesLength * sizeof<f64>(), sizeof<f64>());
  requireArenaRange(friendlyXPointer, friendlyCount * sizeof<f64>(), sizeof<f64>());
  requireArenaRange(friendlyYPointer, friendlyCount * sizeof<f64>(), sizeof<f64>());
  requireArenaRange(policyPointer, policyLength * sizeof<f64>(), sizeof<f64>());
  requireArenaRange(lookaheadPointer, lookaheadLength, 1);
  const thetaPreviewCandidateLimit = loadPositivePolicyInteger(
    policyPointer,
    Layout.ROUTE_POLICY_THETA_PREVIEW_CANDIDATE_LIMIT_INDEX,
    cellCount,
  );
  const thetaPreviewEdgeLimit = loadPositivePolicyInteger(
    policyPointer,
    Layout.ROUTE_POLICY_THETA_PREVIEW_EDGE_LIMIT_INDEX,
    cellCount,
  );
  const thetaPreviewExpansionInterval = loadPositivePolicyInteger(
    policyPointer,
    Layout.ROUTE_POLICY_THETA_PREVIEW_EXPANSION_INTERVAL_INDEX,
    u32.MAX_VALUE,
  );

  let valueIndex: u32 = 0;
  while (valueIndex < contextValuesLength) {
    if (!isFiniteValue(loadContextValue(contextValuesPointer, valueIndex))) trap();
    valueIndex += 1;
  }
  const minX = loadContextValue(contextValuesPointer, Layout.ROUTE_CONTEXT_VALUE_MIN_X_INDEX);
  const maxX = loadContextValue(contextValuesPointer, Layout.ROUTE_CONTEXT_VALUE_MAX_X_INDEX);
  const minY = loadContextValue(contextValuesPointer, Layout.ROUTE_CONTEXT_VALUE_MIN_Y_INDEX);
  const maxY = loadContextValue(contextValuesPointer, Layout.ROUTE_CONTEXT_VALUE_MAX_Y_INDEX);
  const rectX = loadContextValue(contextValuesPointer, Layout.ROUTE_CONTEXT_VALUE_RECT_X_INDEX);
  const rectY = loadContextValue(contextValuesPointer, Layout.ROUTE_CONTEXT_VALUE_RECT_Y_INDEX);
  const rectWidth = loadContextValue(contextValuesPointer, Layout.ROUTE_CONTEXT_VALUE_RECT_WIDTH_INDEX);
  const rectHeight = loadContextValue(contextValuesPointer, Layout.ROUTE_CONTEXT_VALUE_RECT_HEIGHT_INDEX);
  const boundaryExpansion = loadContextValue(contextValuesPointer, Layout.ROUTE_CONTEXT_VALUE_BOUNDARY_EXPANSION_INDEX);
  const routeTolerance = loadContextValue(contextValuesPointer, Layout.ROUTE_CONTEXT_VALUE_ROUTE_TOLERANCE_INDEX);
  const simulationTolerance = loadContextValue(contextValuesPointer, Layout.ROUTE_CONTEXT_VALUE_SIMULATION_TOLERANCE_INDEX);
  const originX = loadContextValue(contextValuesPointer, Layout.ROUTE_CONTEXT_VALUE_ORIGIN_X_INDEX);
  const originY = loadContextValue(contextValuesPointer, Layout.ROUTE_CONTEXT_VALUE_ORIGIN_Y_INDEX);
  const soldierHitRadius = loadContextValue(contextValuesPointer, Layout.ROUTE_CONTEXT_VALUE_SOLDIER_HIT_RADIUS_INDEX);
  if (minX == maxX || minY == maxY || rectWidth <= 0 || rectHeight <= 0 || boundaryExpansion < 0 || soldierHitRadius < 0) {
    trap();
  }
  let friendlyIndex: u32 = 0;
  while (friendlyIndex < friendlyCount) {
    if (
      !isFiniteValue(load<f64>(friendlyXPointer + friendlyIndex * sizeof<f64>())) ||
      !isFiniteValue(load<f64>(friendlyYPointer + friendlyIndex * sizeof<f64>()))
    ) trap();
    friendlyIndex += 1;
  }

  fillFriendlySoldierAreas(
    sourceMaskPointer,
    friendlyXPointer,
    friendlyYPointer,
    friendlyCount,
    rectX,
    rectY,
    rectWidth,
    rectHeight,
    soldierHitRadius,
  );
  const routeMaskPointer = createToleranceMask(sourceMaskPointer, routeTolerance);
  const simulationMaskPointer = createToleranceMask(sourceMaskPointer, simulationTolerance);
  const isMirrored = minX > maxX;
  const boundaryInset = normalizeBoundaryInset(boundaryExpansion);
  const summedAreaPointer = createSummedArea(routeMaskPointer);
  const componentIdsPointer = reserveArena(cellCount * sizeof<u32>(), sizeof<u32>());
  memory.fill(componentIdsPointer, 0, cellCount * sizeof<u32>());
  const componentScratchMark = markArena();
  const queuePointer = reserveArena(cellCount * sizeof<u32>(), sizeof<u32>());
  const componentCount = labelRouteComponents(routeMaskPointer, componentIdsPointer, queuePointer, isMirrored);
  resetArena(componentScratchMark);
  const boundaryEdgeCount = countBoundaryEdges(routeMaskPointer, isMirrored);
  const boundaryEdgesPointer = createBoundaryEdges(
    routeMaskPointer,
    componentIdsPointer,
    boundaryEdgeCount,
    isMirrored,
  );
  const freeSpanCount = countFreeColumnSpans(routeMaskPointer, isMirrored, boundaryInset);
  const freeSpanOffsetsLength = getPlaneWidth() + 1;
  const freeSpanOffsetsPointer = reserveArena(freeSpanOffsetsLength * sizeof<u32>(), sizeof<u32>());
  const freeSpanValuesLength = freeSpanCount * 2;
  const freeSpanValuesPointer =
    freeSpanValuesLength == 0 ? 0 : reserveArena(freeSpanValuesLength * sizeof<u32>(), sizeof<u32>());
  fillFreeColumnSpans(
    routeMaskPointer,
    isMirrored,
    boundaryInset,
    freeSpanOffsetsPointer,
    freeSpanValuesPointer,
  );
  const thetaClosedPointer = reserveArena(cellCount, 1);
  memory.fill(thetaClosedPointer, 0, cellCount);
  const thetaGScorePointer = reserveArena(cellCount * sizeof<f64>(), sizeof<f64>());
  const thetaParentPointer = reserveArena(cellCount * sizeof<i32>(), sizeof<i32>());
  memory.fill(thetaParentPointer, 0xff, cellCount * sizeof<i32>());
  let thetaCellIndex: u32 = 0;
  while (thetaCellIndex < cellCount) {
    store<f64>(thetaGScorePointer + thetaCellIndex * sizeof<f64>(), f64.POSITIVE_INFINITY);
    thetaCellIndex += 1;
  }
  const thetaTouchedPointer = reserveArena(cellCount * sizeof<u32>(), sizeof<u32>());
  const thetaCandidatesPointer = reserveArena(getPlaneHeight() * sizeof<u32>(), sizeof<u32>());
  const thetaSeenPointer = reserveArena(getPlaneHeight(), 1);
  memory.fill(thetaSeenPointer, 0, getPlaneHeight());
  const routeObstacleCount = countMaskObstacles(routeMaskPointer);
  const simulationObstacleCount = countMaskObstacles(simulationMaskPointer);
  const summedAreaLength = (getPlaneWidth() + 1) * (getPlaneHeight() + 1);
  const boundaryEdgesLength = boundaryEdgeCount * Layout.ROUTE_BOUNDARY_EDGE_RECORD_U32_LENGTH;

  const contextPointer = reserveArena(Layout.ROUTE_CONTEXT_BYTE_LENGTH, sizeof<u64>());
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_MAGIC_OFFSET, Layout.ROUTE_CONTEXT_MAGIC);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_FLAGS_OFFSET, isMirrored ? Layout.ROUTE_CONTEXT_FLAG_MIRRORED : 0);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_ROUTE_MASK_POINTER_OFFSET, routeMaskPointer);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_ROUTE_MASK_LENGTH_OFFSET, cellCount);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_SIMULATION_MASK_POINTER_OFFSET, simulationMaskPointer);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_SIMULATION_MASK_LENGTH_OFFSET, cellCount);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_SUMMED_AREA_POINTER_OFFSET, summedAreaPointer);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_SUMMED_AREA_LENGTH_OFFSET, summedAreaLength);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_ROUTE_OBSTACLE_COUNT_OFFSET, routeObstacleCount);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_SIMULATION_OBSTACLE_COUNT_OFFSET, simulationObstacleCount);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_COMPONENT_COUNT_OFFSET, componentCount);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_BOUNDARY_EDGE_COUNT_OFFSET, boundaryEdgeCount);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_COMPONENT_IDS_POINTER_OFFSET, componentIdsPointer);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_COMPONENT_IDS_LENGTH_OFFSET, cellCount);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_BOUNDARY_EDGES_POINTER_OFFSET, boundaryEdgesPointer);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_BOUNDARY_EDGES_LENGTH_OFFSET, boundaryEdgesLength);
  store<f64>(contextPointer + Layout.ROUTE_CONTEXT_MIN_X_OFFSET, minX);
  store<f64>(contextPointer + Layout.ROUTE_CONTEXT_MAX_X_OFFSET, maxX);
  store<f64>(contextPointer + Layout.ROUTE_CONTEXT_MIN_Y_OFFSET, minY);
  store<f64>(contextPointer + Layout.ROUTE_CONTEXT_MAX_Y_OFFSET, maxY);
  store<f64>(contextPointer + Layout.ROUTE_CONTEXT_BOUNDARY_EXPANSION_OFFSET, boundaryExpansion);
  store<f64>(contextPointer + Layout.ROUTE_CONTEXT_ORIGIN_X_OFFSET, originX);
  store<f64>(contextPointer + Layout.ROUTE_CONTEXT_ORIGIN_Y_OFFSET, originY);
  store<f64>(contextPointer + Layout.ROUTE_CONTEXT_ROUTE_TOLERANCE_OFFSET, routeTolerance);
  store<f64>(contextPointer + Layout.ROUTE_CONTEXT_SIMULATION_TOLERANCE_OFFSET, simulationTolerance);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_POLICY_POINTER_OFFSET, policyPointer);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_POLICY_LENGTH_OFFSET, policyLength);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_LOOKAHEAD_POINTER_OFFSET, lookaheadPointer);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_LOOKAHEAD_LENGTH_OFFSET, lookaheadLength);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_FREE_SPAN_OFFSETS_POINTER_OFFSET, freeSpanOffsetsPointer);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_FREE_SPAN_OFFSETS_LENGTH_OFFSET, freeSpanOffsetsLength);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_FREE_SPAN_VALUES_POINTER_OFFSET, freeSpanValuesPointer);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_FREE_SPAN_VALUES_LENGTH_OFFSET, freeSpanValuesLength);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_CLOSED_POINTER_OFFSET, thetaClosedPointer);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_G_SCORE_POINTER_OFFSET, thetaGScorePointer);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_PARENT_POINTER_OFFSET, thetaParentPointer);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_TOUCHED_POINTER_OFFSET, thetaTouchedPointer);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_TOUCHED_COUNT_OFFSET, 0);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_CANDIDATES_POINTER_OFFSET, thetaCandidatesPointer);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_SEEN_POINTER_OFFSET, thetaSeenPointer);
  store<u32>(
    contextPointer + Layout.ROUTE_CONTEXT_THETA_PREVIEW_CANDIDATE_LIMIT_OFFSET,
    thetaPreviewCandidateLimit,
  );
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_PREVIEW_EDGE_LIMIT_OFFSET, thetaPreviewEdgeLimit);
  store<u32>(
    contextPointer + Layout.ROUTE_CONTEXT_THETA_PREVIEW_EXPANSION_INTERVAL_OFFSET,
    thetaPreviewExpansionInterval,
  );
  return contextPointer;
}

@inline
function requireRouteContext(pointer: u32): void {
  requireArenaRange(pointer, Layout.ROUTE_CONTEXT_BYTE_LENGTH, sizeof<u64>());
  if (
    load<u32>(pointer + Layout.ROUTE_CONTEXT_MAGIC_OFFSET) != Layout.ROUTE_CONTEXT_MAGIC ||
    load<u32>(pointer + Layout.ROUTE_CONTEXT_ROUTE_MASK_LENGTH_OFFSET) != getPlaneCellCount() ||
    load<u32>(pointer + Layout.ROUTE_CONTEXT_SUMMED_AREA_LENGTH_OFFSET) !=
      (getPlaneWidth() + 1) * (getPlaneHeight() + 1)
  ) trap();
}

@inline
function pointHitsRouteContext(contextPointer: u32, forwardX: i32, y: i32): bool {
  const boundaryInset = normalizeBoundaryInset(
    load<f64>(contextPointer + Layout.ROUTE_CONTEXT_BOUNDARY_EXPANSION_OFFSET),
  );
  const flags = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_FLAGS_OFFSET);
  const maskPointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_ROUTE_MASK_POINTER_OFFSET);
  return routePointHitsMask(
    maskPointer,
    forwardX,
    y,
    (flags & Layout.ROUTE_CONTEXT_FLAG_MIRRORED) != 0,
    boundaryInset,
  );
}

function createQueryResult(value: u32): u32 {
  const pointer = reserveArena(Layout.ROUTE_QUERY_RESULT_BYTE_LENGTH, sizeof<u32>());
  store<u32>(pointer + Layout.ROUTE_QUERY_RESULT_MAGIC_OFFSET, Layout.ROUTE_QUERY_RESULT_MAGIC);
  store<u32>(pointer + Layout.ROUTE_QUERY_RESULT_VALUE_OFFSET, value);
  return pointer;
}

function readPlaneCoordinate(inputPointer: u32, offset: u32, maximumExclusive: u32): i32 {
  const value = load<f64>(inputPointer + offset);
  if (!isIntegerValue(value) || value < 0 || value >= <f64>maximumExclusive) trap();
  return <i32>value;
}

function runPointQuery(inputPointer: u32, inputByteLength: u32): u32 {
  if (inputByteLength != Layout.ROUTE_POINT_INPUT_BYTE_LENGTH) trap();
  requireArenaRange(inputPointer, inputByteLength, sizeof<u64>());
  const contextPointer = load<u32>(inputPointer + Layout.ROUTE_POINT_INPUT_CONTEXT_POINTER_OFFSET);
  requireRouteContext(contextPointer);
  const x = readPlaneCoordinate(inputPointer, Layout.ROUTE_POINT_INPUT_X_OFFSET, getPlaneWidth());
  const y = readPlaneCoordinate(inputPointer, Layout.ROUTE_POINT_INPUT_Y_OFFSET, getPlaneHeight());
  return createQueryResult(pointHitsRouteContext(contextPointer, x, y) ? 1 : 0);
}

function runLineQuery(inputPointer: u32, inputByteLength: u32): u32 {
  if (inputByteLength != Layout.ROUTE_LINE_INPUT_BYTE_LENGTH) trap();
  requireArenaRange(inputPointer, inputByteLength, sizeof<u64>());
  const contextPointer = load<u32>(inputPointer + Layout.ROUTE_LINE_INPUT_CONTEXT_POINTER_OFFSET);
  requireRouteContext(contextPointer);
  const startX = readPlaneCoordinate(inputPointer, Layout.ROUTE_LINE_INPUT_START_X_OFFSET, getPlaneWidth());
  const startY = readPlaneCoordinate(inputPointer, Layout.ROUTE_LINE_INPUT_START_Y_OFFSET, getPlaneHeight());
  const endX = readPlaneCoordinate(inputPointer, Layout.ROUTE_LINE_INPUT_END_X_OFFSET, getPlaneWidth());
  const endY = readPlaneCoordinate(inputPointer, Layout.ROUTE_LINE_INPUT_END_Y_OFFSET, getPlaneHeight());
  return createQueryResult(lineHitsRouteContext(contextPointer, startX, startY, endX, endY) ? 1 : 0);
}

function lineHitsRouteContext(contextPointer: u32, startX: i32, startY: i32, endX: i32, endY: i32): bool {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const absoluteDeltaX = deltaX < 0 ? -deltaX : deltaX;
  const absoluteDeltaY = deltaY < 0 ? -deltaY : deltaY;
  const steps = absoluteDeltaX > absoluteDeltaY ? absoluteDeltaX : absoluteDeltaY;
  if (steps == 0) return pointHitsRouteContext(contextPointer, startX, startY);
  let step: i32 = 0;
  while (step <= steps) {
    const ratio = <f64>step / <f64>steps;
    const x = <i32>NativeMath.floor(<f64>startX + <f64>deltaX * ratio + 0.5);
    const y = <i32>NativeMath.floor(<f64>startY + <f64>deltaY * ratio + 0.5);
    if (pointHitsRouteContext(contextPointer, x, y)) return true;
    step += 1;
  }
  return false;
}

function countPlaneRegion(contextPointer: u32, minX: u32, maxX: u32, minY: u32, maxY: u32): u32 {
  const stride = getPlaneWidth() + 1;
  const summedAreaPointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_SUMMED_AREA_POINTER_OFFSET);
  const beforeMinRow = minY * stride;
  const afterMaxRow = (maxY + 1) * stride;
  const afterMaxX = maxX + 1;
  return (
    load<u32>(summedAreaPointer + (afterMaxRow + afterMaxX) * sizeof<u32>()) -
    load<u32>(summedAreaPointer + (beforeMinRow + afterMaxX) * sizeof<u32>()) -
    load<u32>(summedAreaPointer + (afterMaxRow + minX) * sizeof<u32>()) +
    load<u32>(summedAreaPointer + (beforeMinRow + minX) * sizeof<u32>())
  );
}

function runPlaneRegionCountQuery(inputPointer: u32, inputByteLength: u32): u32 {
  if (inputByteLength != Layout.ROUTE_REGION_INPUT_BYTE_LENGTH) trap();
  requireArenaRange(inputPointer, inputByteLength, sizeof<u64>());
  const contextPointer = load<u32>(inputPointer + Layout.ROUTE_REGION_INPUT_CONTEXT_POINTER_OFFSET);
  requireRouteContext(contextPointer);
  const minX = readPlaneCoordinate(inputPointer, Layout.ROUTE_REGION_INPUT_MIN_X_OFFSET, getPlaneWidth());
  const maxX = readPlaneCoordinate(inputPointer, Layout.ROUTE_REGION_INPUT_MAX_X_OFFSET, getPlaneWidth());
  const minY = readPlaneCoordinate(inputPointer, Layout.ROUTE_REGION_INPUT_MIN_Y_OFFSET, getPlaneHeight());
  const maxY = readPlaneCoordinate(inputPointer, Layout.ROUTE_REGION_INPUT_MAX_Y_OFFSET, getPlaneHeight());
  if (minX > maxX || minY > maxY) trap();
  return createQueryResult(countPlaneRegion(contextPointer, <u32>minX, <u32>maxX, <u32>minY, <u32>maxY));
}

@inline
function snapToPlaneGridLine(value: f64): f64 {
  const nearestInteger = NativeMath.round(value);
  const tolerance = f64.EPSILON * NativeMath.max(getGraphwarPlaneLength(), getGraphwarPlaneHeight()) * 4;
  return NativeMath.abs(value - nearestInteger) <= tolerance ? nearestInteger : value;
}

function runGraphRegionHitQuery(inputPointer: u32, inputByteLength: u32): u32 {
  if (inputByteLength != Layout.ROUTE_REGION_INPUT_BYTE_LENGTH) trap();
  requireArenaRange(inputPointer, inputByteLength, sizeof<u64>());
  const contextPointer = load<u32>(inputPointer + Layout.ROUTE_REGION_INPUT_CONTEXT_POINTER_OFFSET);
  requireRouteContext(contextPointer);
  const regionMinX = load<f64>(inputPointer + Layout.ROUTE_REGION_INPUT_MIN_X_OFFSET);
  const regionMaxX = load<f64>(inputPointer + Layout.ROUTE_REGION_INPUT_MAX_X_OFFSET);
  const regionMinY = load<f64>(inputPointer + Layout.ROUTE_REGION_INPUT_MIN_Y_OFFSET);
  const regionMaxY = load<f64>(inputPointer + Layout.ROUTE_REGION_INPUT_MAX_Y_OFFSET);
  if (
    !isFiniteValue(regionMinX) ||
    !isFiniteValue(regionMaxX) ||
    !isFiniteValue(regionMinY) ||
    !isFiniteValue(regionMaxY) ||
    regionMinX > regionMaxX ||
    regionMinY > regionMaxY
  ) trap();
  const boundsMinX = load<f64>(contextPointer + Layout.ROUTE_CONTEXT_MIN_X_OFFSET);
  const boundsMaxX = load<f64>(contextPointer + Layout.ROUTE_CONTEXT_MAX_X_OFFSET);
  const boundsMinY = load<f64>(contextPointer + Layout.ROUTE_CONTEXT_MIN_Y_OFFSET);
  const boundsMaxY = load<f64>(contextPointer + Layout.ROUTE_CONTEXT_MAX_Y_OFFSET);
  const graphMinX = NativeMath.min(boundsMinX, boundsMaxX);
  const graphMaxX = NativeMath.max(boundsMinX, boundsMaxX);
  const graphMinY = NativeMath.min(boundsMinY, boundsMaxY);
  const graphMaxY = NativeMath.max(boundsMinY, boundsMaxY);
  if (regionMinX < graphMinX || regionMaxX > graphMaxX || regionMinY < graphMinY || regionMaxY > graphMaxY) {
    return createQueryResult(1);
  }

  const width = getGraphwarPlaneLength();
  const height = getGraphwarPlaneHeight();
  const startPlaneX = ((regionMinX - boundsMinX) / (boundsMaxX - boundsMinX)) * width;
  const endPlaneX = ((regionMaxX - boundsMinX) / (boundsMaxX - boundsMinX)) * width;
  const startPlaneY = ((boundsMaxY - regionMinY) / (boundsMaxY - boundsMinY)) * height;
  const endPlaneY = ((boundsMaxY - regionMaxY) / (boundsMaxY - boundsMinY)) * height;
  const minPlaneX = snapToPlaneGridLine(NativeMath.min(startPlaneX, endPlaneX));
  const maxPlaneX = snapToPlaneGridLine(NativeMath.max(startPlaneX, endPlaneX));
  const minPlaneY = snapToPlaneGridLine(NativeMath.min(startPlaneY, endPlaneY));
  const maxPlaneY = snapToPlaneGridLine(NativeMath.max(startPlaneY, endPlaneY));
  const minX = <i32>NativeMath.max(0, NativeMath.ceil(minPlaneX) - 1);
  const maxX = <i32>NativeMath.min(width - 1, NativeMath.floor(maxPlaneX));
  const minY = <i32>NativeMath.max(0, NativeMath.ceil(minPlaneY) - 1);
  const maxY = <i32>NativeMath.min(height - 1, NativeMath.floor(maxPlaneY));
  if (!planePointIsInsideBounds(minX, minY) || !planePointIsInsideBounds(maxX, maxY) || minX > maxX || minY > maxY) {
    return createQueryResult(1);
  }
  const boundaryInset = normalizeBoundaryInset(
    load<f64>(contextPointer + Layout.ROUTE_CONTEXT_BOUNDARY_EXPANSION_OFFSET),
  );
  if (
    minX < boundaryInset ||
    maxX >= <i32>getPlaneWidth() - boundaryInset ||
    minY < boundaryInset ||
    maxY >= <i32>getPlaneHeight() - boundaryInset
  ) return createQueryResult(1);
  return createQueryResult(countPlaneRegion(contextPointer, <u32>minX, <u32>maxX, <u32>minY, <u32>maxY) > 0 ? 1 : 0);
}

const THETA_HEAP_NODE_INDEX_OFFSET: u32 = 0;
const THETA_HEAP_NODE_PRIORITY_OFFSET: u32 = 8;
const THETA_HEAP_NODE_ROUTE_COST_OFFSET: u32 = 16;
const THETA_HEAP_NODE_BYTE_LENGTH: u32 = 24;
const THETA_HEAP_NODES_POINTER_OFFSET: u32 = 0;
const THETA_HEAP_LENGTH_OFFSET: u32 = 4;
const THETA_HEAP_CAPACITY_OFFSET: u32 = 8;
const THETA_HEAP_BYTE_LENGTH: u32 = 16;

@inline
function planePointDistance(startX: i32, startY: i32, endX: i32, endY: i32): f64 {
  const deltaX = endX >= startX ? <f64>(endX - startX) : <f64>(startX - endX);
  const deltaY = endY >= startY ? <f64>(endY - startY) : <f64>(startY - endY);
  const maximum = NativeMath.max(deltaX, deltaY);
  if (maximum == 0) return 0;
  // AssemblyScript's musl hypot rounds some grid distances differently from JS Math.hypot and changes heap order.
  const ratio = NativeMath.min(deltaX, deltaY) / maximum;
  return NativeMath.sqrt(1 + ratio * ratio) * maximum;
}

@inline
function thetaHeapNodePointer(heapPointer: u32, index: u32): u32 {
  return load<u32>(heapPointer + THETA_HEAP_NODES_POINTER_OFFSET) + index * THETA_HEAP_NODE_BYTE_LENGTH;
}

@inline
function compareThetaHeapNodes(leftPointer: u32, rightPointer: u32): i32 {
  const leftPriority = load<f64>(leftPointer + THETA_HEAP_NODE_PRIORITY_OFFSET);
  const rightPriority = load<f64>(rightPointer + THETA_HEAP_NODE_PRIORITY_OFFSET);
  if (leftPriority < rightPriority) return -1;
  if (leftPriority > rightPriority) return 1;
  const leftRouteCost = load<f64>(leftPointer + THETA_HEAP_NODE_ROUTE_COST_OFFSET);
  const rightRouteCost = load<f64>(rightPointer + THETA_HEAP_NODE_ROUTE_COST_OFFSET);
  if (leftRouteCost < rightRouteCost) return -1;
  if (leftRouteCost > rightRouteCost) return 1;
  const leftIndex = load<u32>(leftPointer + THETA_HEAP_NODE_INDEX_OFFSET);
  const rightIndex = load<u32>(rightPointer + THETA_HEAP_NODE_INDEX_OFFSET);
  return leftIndex < rightIndex ? -1 : leftIndex > rightIndex ? 1 : 0;
}

function swapThetaHeapNodes(leftPointer: u32, rightPointer: u32): void {
  const leftIndex = load<u32>(leftPointer + THETA_HEAP_NODE_INDEX_OFFSET);
  const leftPriority = load<f64>(leftPointer + THETA_HEAP_NODE_PRIORITY_OFFSET);
  const leftRouteCost = load<f64>(leftPointer + THETA_HEAP_NODE_ROUTE_COST_OFFSET);
  store<u32>(leftPointer + THETA_HEAP_NODE_INDEX_OFFSET, load<u32>(rightPointer + THETA_HEAP_NODE_INDEX_OFFSET));
  store<f64>(leftPointer + THETA_HEAP_NODE_PRIORITY_OFFSET, load<f64>(rightPointer + THETA_HEAP_NODE_PRIORITY_OFFSET));
  store<f64>(
    leftPointer + THETA_HEAP_NODE_ROUTE_COST_OFFSET,
    load<f64>(rightPointer + THETA_HEAP_NODE_ROUTE_COST_OFFSET),
  );
  store<u32>(rightPointer + THETA_HEAP_NODE_INDEX_OFFSET, leftIndex);
  store<f64>(rightPointer + THETA_HEAP_NODE_PRIORITY_OFFSET, leftPriority);
  store<f64>(rightPointer + THETA_HEAP_NODE_ROUTE_COST_OFFSET, leftRouteCost);
}

function growThetaHeap(heapPointer: u32): void {
  const capacity = load<u32>(heapPointer + THETA_HEAP_CAPACITY_OFFSET);
  const nextCapacity: u32 = capacity == 0 ? 64 : capacity * 2;
  if (nextCapacity <= capacity || nextCapacity > u32.MAX_VALUE / THETA_HEAP_NODE_BYTE_LENGTH) trap();
  const nextPointer = reserveArena(nextCapacity * THETA_HEAP_NODE_BYTE_LENGTH, sizeof<u64>());
  const length = load<u32>(heapPointer + THETA_HEAP_LENGTH_OFFSET);
  const previousPointer = load<u32>(heapPointer + THETA_HEAP_NODES_POINTER_OFFSET);
  if (length > 0) memory.copy(nextPointer, previousPointer, length * THETA_HEAP_NODE_BYTE_LENGTH);
  store<u32>(heapPointer + THETA_HEAP_NODES_POINTER_OFFSET, nextPointer);
  store<u32>(heapPointer + THETA_HEAP_CAPACITY_OFFSET, nextCapacity);
}

function pushThetaHeap(heapPointer: u32, index: u32, priority: f64, routeCost: f64): void {
  let length = load<u32>(heapPointer + THETA_HEAP_LENGTH_OFFSET);
  if (length == load<u32>(heapPointer + THETA_HEAP_CAPACITY_OFFSET)) growThetaHeap(heapPointer);
  let nodePointer = thetaHeapNodePointer(heapPointer, length);
  store<u32>(nodePointer + THETA_HEAP_NODE_INDEX_OFFSET, index);
  store<f64>(nodePointer + THETA_HEAP_NODE_PRIORITY_OFFSET, priority);
  store<f64>(nodePointer + THETA_HEAP_NODE_ROUTE_COST_OFFSET, routeCost);
  length += 1;
  store<u32>(heapPointer + THETA_HEAP_LENGTH_OFFSET, length);
  let nodeIndex = length - 1;
  while (nodeIndex > 0) {
    const parentIndex = (nodeIndex - 1) / 2;
    nodePointer = thetaHeapNodePointer(heapPointer, nodeIndex);
    const parentPointer = thetaHeapNodePointer(heapPointer, parentIndex);
    if (compareThetaHeapNodes(nodePointer, parentPointer) >= 0) break;
    swapThetaHeapNodes(nodePointer, parentPointer);
    nodeIndex = parentIndex;
  }
}

function popThetaHeap(heapPointer: u32, outputPointer: u32): bool {
  let length = load<u32>(heapPointer + THETA_HEAP_LENGTH_OFFSET);
  if (length == 0) return false;
  const rootPointer = thetaHeapNodePointer(heapPointer, 0);
  memory.copy(outputPointer, rootPointer, THETA_HEAP_NODE_BYTE_LENGTH);
  length -= 1;
  store<u32>(heapPointer + THETA_HEAP_LENGTH_OFFSET, length);
  if (length == 0) return true;
  memory.copy(rootPointer, thetaHeapNodePointer(heapPointer, length), THETA_HEAP_NODE_BYTE_LENGTH);
  let nodeIndex: u32 = 0;
  while (true) {
    const leftIndex = nodeIndex * 2 + 1;
    if (leftIndex >= length) break;
    const rightIndex = leftIndex + 1;
    let bestIndex = leftIndex;
    if (
      rightIndex < length &&
      compareThetaHeapNodes(thetaHeapNodePointer(heapPointer, rightIndex), thetaHeapNodePointer(heapPointer, leftIndex)) <
        0
    ) bestIndex = rightIndex;
    const nodePointer = thetaHeapNodePointer(heapPointer, nodeIndex);
    const bestPointer = thetaHeapNodePointer(heapPointer, bestIndex);
    if (compareThetaHeapNodes(bestPointer, nodePointer) >= 0) break;
    swapThetaHeapNodes(nodePointer, bestPointer);
    nodeIndex = bestIndex;
  }
  return true;
}

function spanColumnIncludesY(contextPointer: u32, x: i32, y: i32): bool {
  if (!planePointIsInsideBounds(x, y)) return false;
  const offsetsPointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_FREE_SPAN_OFFSETS_POINTER_OFFSET);
  const valuesPointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_FREE_SPAN_VALUES_POINTER_OFFSET);
  const start = load<u32>(offsetsPointer + <u32>x * sizeof<u32>());
  const end = load<u32>(offsetsPointer + (<u32>x + 1) * sizeof<u32>());
  let index = start;
  while (index < end) {
    const minimum = load<u32>(valuesPointer + index * 2 * sizeof<u32>());
    const maximum = load<u32>(valuesPointer + (index * 2 + 1) * sizeof<u32>());
    if (<u32>y >= minimum && <u32>y <= maximum) return true;
    index += 1;
  }
  return false;
}

function addThetaCandidate(
  contextPointer: u32,
  nextX: i32,
  candidateY: i32,
  candidatesPointer: u32,
  seenPointer: u32,
  count: u32,
): u32 {
  if (!spanColumnIncludesY(contextPointer, nextX, candidateY) || load<u8>(seenPointer + <u32>candidateY) != 0) {
    return count;
  }
  store<u8>(seenPointer + <u32>candidateY, 1);
  store<u32>(candidatesPointer + count * sizeof<u32>(), <u32>candidateY);
  return count + 1;
}

@inline
function thetaCandidateComesFirst(left: i32, right: i32, currentY: i32, targetY: i32): bool {
  const leftCurrent = left >= currentY ? left - currentY : currentY - left;
  const rightCurrent = right >= currentY ? right - currentY : currentY - right;
  if (leftCurrent != rightCurrent) return leftCurrent < rightCurrent;
  const leftTarget = left >= targetY ? left - targetY : targetY - left;
  const rightTarget = right >= targetY ? right - targetY : targetY - right;
  return leftTarget != rightTarget ? leftTarget < rightTarget : left < right;
}

function collectThetaCandidates(
  contextPointer: u32,
  currentX: i32,
  currentY: i32,
  targetX: i32,
  targetY: i32,
  nextX: i32,
  candidatesPointer: u32,
  seenPointer: u32,
): u32 {
  memory.fill(seenPointer, 0, getPlaneHeight());
  let count = addThetaCandidate(contextPointer, nextX, currentY, candidatesPointer, seenPointer, 0);
  count = addThetaCandidate(contextPointer, nextX, targetY, candidatesPointer, seenPointer, count);
  const lookaheadPointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_LOOKAHEAD_POINTER_OFFSET);
  const lookaheadLength = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_LOOKAHEAD_LENGTH_OFFSET);
  const offsetsPointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_FREE_SPAN_OFFSETS_POINTER_OFFSET);
  const valuesPointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_FREE_SPAN_VALUES_POINTER_OFFSET);
  let offsetIndex: u32 = 0;
  while (offsetIndex < lookaheadLength) {
    const offset = <i32>load<u8>(lookaheadPointer + offsetIndex);
    const lookaheadX = currentX + offset < targetX ? currentX + offset : targetX;
    const spanStart = load<u32>(offsetsPointer + <u32>lookaheadX * sizeof<u32>());
    const spanEnd = load<u32>(offsetsPointer + (<u32>lookaheadX + 1) * sizeof<u32>());
    let spanIndex = spanStart;
    while (spanIndex < spanEnd) {
      count = addThetaCandidate(
        contextPointer,
        nextX,
        <i32>load<u32>(valuesPointer + spanIndex * 2 * sizeof<u32>()),
        candidatesPointer,
        seenPointer,
        count,
      );
      count = addThetaCandidate(
        contextPointer,
        nextX,
        <i32>load<u32>(valuesPointer + (spanIndex * 2 + 1) * sizeof<u32>()),
        candidatesPointer,
        seenPointer,
        count,
      );
      spanIndex += 1;
    }
    offsetIndex += 1;
  }
  let index: u32 = 1;
  while (index < count) {
    const value = <i32>load<u32>(candidatesPointer + index * sizeof<u32>());
    let insertionIndex = index;
    while (insertionIndex > 0) {
      const previous = <i32>load<u32>(candidatesPointer + (insertionIndex - 1) * sizeof<u32>());
      if (!thetaCandidateComesFirst(value, previous, currentY, targetY)) break;
      store<u32>(candidatesPointer + insertionIndex * sizeof<u32>(), <u32>previous);
      insertionIndex -= 1;
    }
    store<u32>(candidatesPointer + insertionIndex * sizeof<u32>(), <u32>value);
    index += 1;
  }
  return count;
}

const ROUTE_PREVIEW_ACCEPTED_POINTER_OFFSET: u32 = 0;
const ROUTE_PREVIEW_ACCEPTED_COUNT_OFFSET: u32 = 4;
const ROUTE_PREVIEW_EVENTS_POINTER_OFFSET: u32 = 8;
const ROUTE_PREVIEW_EVENT_COUNT_OFFSET: u32 = 12;
const ROUTE_PREVIEW_EVENT_CAPACITY_OFFSET: u32 = 16;
const ROUTE_PREVIEW_EDGE_LIMIT_OFFSET: u32 = 20;
const ROUTE_PREVIEW_CANDIDATE_LIMIT_OFFSET: u32 = 24;
const ROUTE_PREVIEW_STATE_BYTE_LENGTH: u32 = 32;
const ROUTE_PREVIEW_ACCEPTED_EDGE_BYTE_LENGTH: u32 = 16;

function createRoutePreviewState(contextPointer: u32): u32 {
  const statePointer = reserveArena(ROUTE_PREVIEW_STATE_BYTE_LENGTH, sizeof<u32>());
  memory.fill(statePointer, 0, ROUTE_PREVIEW_STATE_BYTE_LENGTH);
  const edgeLimit = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_PREVIEW_EDGE_LIMIT_OFFSET);
  const acceptedPointer = reserveArena(
    edgeLimit * ROUTE_PREVIEW_ACCEPTED_EDGE_BYTE_LENGTH,
    sizeof<u32>(),
  );
  store<u32>(statePointer + ROUTE_PREVIEW_ACCEPTED_POINTER_OFFSET, acceptedPointer);
  store<u32>(statePointer + ROUTE_PREVIEW_EDGE_LIMIT_OFFSET, edgeLimit);
  store<u32>(
    statePointer + ROUTE_PREVIEW_CANDIDATE_LIMIT_OFFSET,
    load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_PREVIEW_CANDIDATE_LIMIT_OFFSET),
  );
  return statePointer;
}

function appendRoutePreviewAcceptedEdge(
  statePointer: u32,
  startX: i32,
  startY: i32,
  endX: i32,
  endY: i32,
): void {
  const pointer = load<u32>(statePointer + ROUTE_PREVIEW_ACCEPTED_POINTER_OFFSET);
  let count = load<u32>(statePointer + ROUTE_PREVIEW_ACCEPTED_COUNT_OFFSET);
  const edgeLimit = load<u32>(statePointer + ROUTE_PREVIEW_EDGE_LIMIT_OFFSET);
  if (count == edgeLimit) {
    memory.copy(
      pointer,
      pointer + ROUTE_PREVIEW_ACCEPTED_EDGE_BYTE_LENGTH,
      (edgeLimit - 1) * ROUTE_PREVIEW_ACCEPTED_EDGE_BYTE_LENGTH,
    );
    count -= 1;
  }
  const recordPointer = pointer + count * ROUTE_PREVIEW_ACCEPTED_EDGE_BYTE_LENGTH;
  store<u32>(recordPointer, <u32>startX);
  store<u32>(recordPointer + 4, <u32>startY);
  store<u32>(recordPointer + 8, <u32>endX);
  store<u32>(recordPointer + 12, <u32>endY);
  store<u32>(statePointer + ROUTE_PREVIEW_ACCEPTED_COUNT_OFFSET, count + 1);
}

function appendRoutePreviewEventRecord(statePointer: u32): u32 {
  let count = load<u32>(statePointer + ROUTE_PREVIEW_EVENT_COUNT_OFFSET);
  let capacity = load<u32>(statePointer + ROUTE_PREVIEW_EVENT_CAPACITY_OFFSET);
  if (count == capacity) {
    const nextCapacity: u32 = capacity == 0 ? 8 : capacity * 2;
    if (nextCapacity <= capacity || nextCapacity > u32.MAX_VALUE / Layout.ROUTE_PREVIEW_BYTE_LENGTH) trap();
    const nextPointer = reserveArena(nextCapacity * Layout.ROUTE_PREVIEW_BYTE_LENGTH, sizeof<u32>());
    const previousPointer = load<u32>(statePointer + ROUTE_PREVIEW_EVENTS_POINTER_OFFSET);
    if (count > 0) memory.copy(nextPointer, previousPointer, count * Layout.ROUTE_PREVIEW_BYTE_LENGTH);
    store<u32>(statePointer + ROUTE_PREVIEW_EVENTS_POINTER_OFFSET, nextPointer);
    store<u32>(statePointer + ROUTE_PREVIEW_EVENT_CAPACITY_OFFSET, nextCapacity);
    capacity = nextCapacity;
  }
  const recordPointer =
    load<u32>(statePointer + ROUTE_PREVIEW_EVENTS_POINTER_OFFSET) + count * Layout.ROUTE_PREVIEW_BYTE_LENGTH;
  memory.fill(recordPointer, 0, Layout.ROUTE_PREVIEW_BYTE_LENGTH);
  store<u32>(statePointer + ROUTE_PREVIEW_EVENT_COUNT_OFFSET, count + 1);
  return recordPointer;
}

function addUniquePreviewCandidate(pointer: u32, count: u32, candidateIndex: u32, candidateLimit: u32): u32 {
  let index: u32 = 0;
  while (index < count) {
    if (load<u32>(pointer + index * sizeof<u32>()) == candidateIndex) return count;
    index += 1;
  }
  if (count >= candidateLimit) return count;
  store<u32>(pointer + count * sizeof<u32>(), candidateIndex);
  return count + 1;
}

function collectRoutePreviewCandidateIndexes(
  heapPointer: u32,
  currentIndex: u32,
  startIndex: u32,
  targetIndex: u32,
  outputPointer: u32,
  candidateLimit: u32,
): u32 {
  let count = addUniquePreviewCandidate(outputPointer, 0, startIndex, candidateLimit);
  count = addUniquePreviewCandidate(outputPointer, count, targetIndex, candidateLimit);
  count = addUniquePreviewCandidate(outputPointer, count, currentIndex, candidateLimit);
  const heapLength = load<u32>(heapPointer + THETA_HEAP_LENGTH_OFFSET);
  const snapshotLength = <u32>NativeMath.min(<f64>heapLength, <f64>candidateLimit);
  const heapPositionsPointer = reserveArena(snapshotLength * sizeof<u32>(), sizeof<u32>());
  let position: u32 = 0;
  while (position < snapshotLength) {
    store<u32>(heapPositionsPointer + position * sizeof<u32>(), position);
    position += 1;
  }
  position = 1;
  while (position < snapshotLength) {
    const value = load<u32>(heapPositionsPointer + position * sizeof<u32>());
    let insertionIndex = position;
    while (insertionIndex > 0) {
      const previous = load<u32>(heapPositionsPointer + (insertionIndex - 1) * sizeof<u32>());
      if (compareThetaHeapNodes(thetaHeapNodePointer(heapPointer, value), thetaHeapNodePointer(heapPointer, previous)) >= 0) {
        break;
      }
      store<u32>(heapPositionsPointer + insertionIndex * sizeof<u32>(), previous);
      insertionIndex -= 1;
    }
    store<u32>(heapPositionsPointer + insertionIndex * sizeof<u32>(), value);
    position += 1;
  }
  position = 0;
  while (position < snapshotLength && count < candidateLimit) {
    const heapPosition = load<u32>(heapPositionsPointer + position * sizeof<u32>());
    count = addUniquePreviewCandidate(
      outputPointer,
      count,
      load<u32>(thetaHeapNodePointer(heapPointer, heapPosition) + THETA_HEAP_NODE_INDEX_OFFSET),
      candidateLimit,
    );
    position += 1;
  }
  return count;
}

function countParentPath(targetIndex: u32, parentIndexesPointer: u32): u32 {
  const cellCount = getPlaneCellCount();
  let count: u32 = 0;
  let index = targetIndex;
  while (count <= cellCount) {
    count += 1;
    const parentIndex = <u32>load<i32>(parentIndexesPointer + index * sizeof<i32>());
    if (parentIndex == index) return count;
    index = parentIndex;
  }
  trap();
  return 0;
}

function publishThetaPreview(
  contextPointer: u32,
  statePointer: u32,
  heapPointer: u32,
  parentIndexesPointer: u32,
  currentIndex: u32,
  bestPathTargetIndex: u32,
  simplifiedPathPointer: u32,
  startIndex: u32,
  targetIndex: u32,
): void {
  const width = getPlaneWidth();
  const acceptedPointer = load<u32>(statePointer + ROUTE_PREVIEW_ACCEPTED_POINTER_OFFSET);
  const acceptedCount = load<u32>(statePointer + ROUTE_PREVIEW_ACCEPTED_COUNT_OFFSET);
  const bestPathLength =
    simplifiedPathPointer == 0
      ? countParentPath(bestPathTargetIndex, parentIndexesPointer)
      : load<u32>(simplifiedPathPointer + 8);
  const candidateLimit = load<u32>(statePointer + ROUTE_PREVIEW_CANDIDATE_LIMIT_OFFSET);
  const candidateIndexesPointer = reserveArena(candidateLimit * sizeof<u32>(), sizeof<u32>());
  const candidateCount = collectRoutePreviewCandidateIndexes(
    heapPointer,
    currentIndex,
    startIndex,
    targetIndex,
    candidateIndexesPointer,
    candidateLimit,
  );
  const pointCount = acceptedCount * 2 + bestPathLength + candidateCount + 1;
  const pointsXPointer = reserveArena(pointCount * sizeof<f64>(), sizeof<f64>());
  const pointsYPointer = reserveArena(pointCount * sizeof<f64>(), sizeof<f64>());
  const acceptedIndexesPointer =
    acceptedCount == 0 ? 0 : reserveArena(acceptedCount * 2 * sizeof<u32>(), sizeof<u32>());
  const bestPathIndexesPointer = reserveArena(bestPathLength * sizeof<u32>(), sizeof<u32>());
  const candidateOutputIndexesPointer = reserveArena(candidateCount * sizeof<u32>(), sizeof<u32>());
  let pointIndex: u32 = 0;
  let acceptedIndex: u32 = 0;
  while (acceptedIndex < acceptedCount) {
    const edgePointer = acceptedPointer + acceptedIndex * ROUTE_PREVIEW_ACCEPTED_EDGE_BYTE_LENGTH;
    let endpoint: u32 = 0;
    while (endpoint < 2) {
      const coordinateOffset = endpoint * 8;
      store<f64>(pointsXPointer + pointIndex * sizeof<f64>(), <f64>load<u32>(edgePointer + coordinateOffset));
      store<f64>(pointsYPointer + pointIndex * sizeof<f64>(), <f64>load<u32>(edgePointer + coordinateOffset + 4));
      store<u32>(acceptedIndexesPointer + pointIndex * sizeof<u32>(), pointIndex);
      pointIndex += 1;
      endpoint += 1;
    }
    acceptedIndex += 1;
  }
  if (simplifiedPathPointer == 0) {
    let pathIndex = bestPathLength;
    let parentIndex = bestPathTargetIndex;
    while (pathIndex > 0) {
      pathIndex -= 1;
      store<f64>(pointsXPointer + (pointIndex + pathIndex) * sizeof<f64>(), <f64>(parentIndex % width));
      store<f64>(pointsYPointer + (pointIndex + pathIndex) * sizeof<f64>(), <f64>(parentIndex / width));
      store<u32>(bestPathIndexesPointer + pathIndex * sizeof<u32>(), pointIndex + pathIndex);
      parentIndex = <u32>load<i32>(parentIndexesPointer + parentIndex * sizeof<i32>());
    }
  } else {
    const simplifiedXPointer = load<u32>(simplifiedPathPointer);
    const simplifiedYPointer = load<u32>(simplifiedPathPointer + 4);
    let pathIndex: u32 = 0;
    while (pathIndex < bestPathLength) {
      store<f64>(
        pointsXPointer + (pointIndex + pathIndex) * sizeof<f64>(),
        load<f64>(simplifiedXPointer + pathIndex * sizeof<f64>()),
      );
      store<f64>(
        pointsYPointer + (pointIndex + pathIndex) * sizeof<f64>(),
        load<f64>(simplifiedYPointer + pathIndex * sizeof<f64>()),
      );
      store<u32>(bestPathIndexesPointer + pathIndex * sizeof<u32>(), pointIndex + pathIndex);
      pathIndex += 1;
    }
  }
  pointIndex += bestPathLength;
  let candidateIndex: u32 = 0;
  while (candidateIndex < candidateCount) {
    const index = load<u32>(candidateIndexesPointer + candidateIndex * sizeof<u32>());
    store<f64>(pointsXPointer + pointIndex * sizeof<f64>(), <f64>(index % width));
    store<f64>(pointsYPointer + pointIndex * sizeof<f64>(), <f64>(index / width));
    store<u32>(candidateOutputIndexesPointer + candidateIndex * sizeof<u32>(), pointIndex);
    pointIndex += 1;
    candidateIndex += 1;
  }
  const currentPointIndex = pointIndex;
  store<f64>(pointsXPointer + pointIndex * sizeof<f64>(), <f64>(currentIndex % width));
  store<f64>(pointsYPointer + pointIndex * sizeof<f64>(), <f64>(currentIndex / width));

  const eventPointer = appendRoutePreviewEventRecord(statePointer);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_POINTS_X_POINTER_OFFSET, pointsXPointer);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_POINTS_Y_POINTER_OFFSET, pointsYPointer);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_POINT_COUNT_OFFSET, pointCount);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_ACCEPTED_INDEXES_POINTER_OFFSET, acceptedIndexesPointer);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_ACCEPTED_INDEXES_LENGTH_OFFSET, acceptedCount * 2);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_BEST_PATH_INDEXES_POINTER_OFFSET, bestPathIndexesPointer);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_BEST_PATH_INDEXES_LENGTH_OFFSET, bestPathLength);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_CANDIDATE_INDEXES_POINTER_OFFSET, candidateOutputIndexesPointer);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_CANDIDATE_INDEXES_LENGTH_OFFSET, candidateCount);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_CURRENT_INDEX_OFFSET, currentPointIndex);
  store<u32>(
    eventPointer + Layout.ROUTE_PREVIEW_FLAGS_OFFSET,
    (load<u32>(contextPointer + Layout.ROUTE_CONTEXT_FLAGS_OFFSET) & Layout.ROUTE_CONTEXT_FLAG_MIRRORED) != 0
      ? Layout.ROUTE_PREVIEW_FLAG_MIRRORED
      : 0,
  );
}

function publishDirectThetaPreview(
  contextPointer: u32,
  statePointer: u32,
  startX: i32,
  startY: i32,
  targetX: i32,
  targetY: i32,
): void {
  appendRoutePreviewAcceptedEdge(statePointer, startX, startY, targetX, targetY);
  const pointsXPointer = reserveArena(7 * sizeof<f64>(), sizeof<f64>());
  const pointsYPointer = reserveArena(7 * sizeof<f64>(), sizeof<f64>());
  const coordinates = reserveArena(4 * sizeof<u32>(), sizeof<u32>());
  store<u32>(coordinates, <u32>startX);
  store<u32>(coordinates + 4, <u32>startY);
  store<u32>(coordinates + 8, <u32>targetX);
  store<u32>(coordinates + 12, <u32>targetY);
  let pointIndex: u32 = 0;
  while (pointIndex < 7) {
    const isTarget = pointIndex == 1 || pointIndex == 3 || pointIndex == 5;
    const sourceOffset: u32 = isTarget ? 8 : 0;
    store<f64>(pointsXPointer + pointIndex * sizeof<f64>(), <f64>load<u32>(coordinates + sourceOffset));
    store<f64>(pointsYPointer + pointIndex * sizeof<f64>(), <f64>load<u32>(coordinates + sourceOffset + 4));
    pointIndex += 1;
  }
  const acceptedIndexesPointer = reserveArena(2 * sizeof<u32>(), sizeof<u32>());
  const bestPathIndexesPointer = reserveArena(2 * sizeof<u32>(), sizeof<u32>());
  const candidateIndexesPointer = reserveArena(2 * sizeof<u32>(), sizeof<u32>());
  store<u32>(acceptedIndexesPointer, 0);
  store<u32>(acceptedIndexesPointer + 4, 1);
  store<u32>(bestPathIndexesPointer, 2);
  store<u32>(bestPathIndexesPointer + 4, 3);
  store<u32>(candidateIndexesPointer, 4);
  store<u32>(candidateIndexesPointer + 4, 5);
  const eventPointer = appendRoutePreviewEventRecord(statePointer);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_POINTS_X_POINTER_OFFSET, pointsXPointer);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_POINTS_Y_POINTER_OFFSET, pointsYPointer);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_POINT_COUNT_OFFSET, 7);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_ACCEPTED_INDEXES_POINTER_OFFSET, acceptedIndexesPointer);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_ACCEPTED_INDEXES_LENGTH_OFFSET, 2);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_BEST_PATH_INDEXES_POINTER_OFFSET, bestPathIndexesPointer);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_BEST_PATH_INDEXES_LENGTH_OFFSET, 2);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_CANDIDATE_INDEXES_POINTER_OFFSET, candidateIndexesPointer);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_CANDIDATE_INDEXES_LENGTH_OFFSET, 2);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_CURRENT_INDEX_OFFSET, 6);
  store<u32>(
    eventPointer + Layout.ROUTE_PREVIEW_FLAGS_OFFSET,
    (load<u32>(contextPointer + Layout.ROUTE_CONTEXT_FLAGS_OFFSET) & Layout.ROUTE_CONTEXT_FLAG_MIRRORED) != 0
      ? Layout.ROUTE_PREVIEW_FLAG_MIRRORED
      : 0,
  );
}

function createRouteSearchResult(
  status: u32,
  pathXPointer: u32,
  pathYPointer: u32,
  pathLength: u32,
  expansions: u32,
  previewStatePointer: u32,
): u32 {
  const resultPointer = reserveArena(Layout.ROUTE_SEARCH_RESULT_BYTE_LENGTH, sizeof<u32>());
  store<u32>(resultPointer + Layout.ROUTE_SEARCH_RESULT_MAGIC_OFFSET, Layout.ROUTE_SEARCH_RESULT_MAGIC);
  store<u32>(resultPointer + Layout.ROUTE_SEARCH_RESULT_STATUS_OFFSET, status);
  store<u32>(resultPointer + Layout.ROUTE_SEARCH_RESULT_PATH_X_POINTER_OFFSET, pathXPointer);
  store<u32>(resultPointer + Layout.ROUTE_SEARCH_RESULT_PATH_Y_POINTER_OFFSET, pathYPointer);
  store<u32>(resultPointer + Layout.ROUTE_SEARCH_RESULT_PATH_LENGTH_OFFSET, pathLength);
  store<u32>(
    resultPointer + Layout.ROUTE_SEARCH_RESULT_PREVIEW_POINTER_OFFSET,
    previewStatePointer == 0 ? 0 : load<u32>(previewStatePointer + ROUTE_PREVIEW_EVENTS_POINTER_OFFSET),
  );
  store<u32>(
    resultPointer + Layout.ROUTE_SEARCH_RESULT_PREVIEW_COUNT_OFFSET,
    previewStatePointer == 0 ? 0 : load<u32>(previewStatePointer + ROUTE_PREVIEW_EVENT_COUNT_OFFSET),
  );
  store<u32>(resultPointer + Layout.ROUTE_SEARCH_RESULT_EXPANSION_COUNT_OFFSET, expansions);
  return resultPointer;
}

function createNoRouteSearchResult(expansions: u32, previewStatePointer: u32): u32 {
  return createRouteSearchResult(Layout.ROUTE_SEARCH_RESULT_STATUS_NO_ROUTE, 0, 0, 0, expansions, previewStatePointer);
}

function createSimplifiedThetaPath(
  contextPointer: u32,
  targetIndex: u32,
  parentIndexesPointer: u32,
): u32 {
  const width = getPlaneWidth();
  const cellCount = getPlaneCellCount();
  let pathLength: u32 = 0;
  let index = targetIndex;
  while (pathLength <= cellCount) {
    pathLength += 1;
    const parentIndex = <u32>load<i32>(parentIndexesPointer + index * sizeof<i32>());
    if (parentIndex == index) break;
    index = parentIndex;
  }
  if (pathLength > cellCount) trap();
  const rawXPointer = reserveArena(pathLength * sizeof<u32>(), sizeof<u32>());
  const rawYPointer = reserveArena(pathLength * sizeof<u32>(), sizeof<u32>());
  index = targetIndex;
  let outputIndex = pathLength;
  while (outputIndex > 0) {
    outputIndex -= 1;
    store<u32>(rawXPointer + outputIndex * sizeof<u32>(), index % width);
    store<u32>(rawYPointer + outputIndex * sizeof<u32>(), index / width);
    const parentIndex = <u32>load<i32>(parentIndexesPointer + index * sizeof<i32>());
    if (parentIndex == index) break;
    index = parentIndex;
  }

  const simplifiedXPointer = reserveArena(pathLength * sizeof<u32>(), sizeof<u32>());
  const simplifiedYPointer = reserveArena(pathLength * sizeof<u32>(), sizeof<u32>());
  let simplifiedLength: u32 = 0;
  let anchorIndex: u32 = 0;
  while (anchorIndex < pathLength) {
    const anchorX = <i32>load<u32>(rawXPointer + anchorIndex * sizeof<u32>());
    const anchorY = <i32>load<u32>(rawYPointer + anchorIndex * sizeof<u32>());
    store<u32>(simplifiedXPointer + simplifiedLength * sizeof<u32>(), <u32>anchorX);
    store<u32>(simplifiedYPointer + simplifiedLength * sizeof<u32>(), <u32>anchorY);
    simplifiedLength += 1;
    if (anchorIndex + 1 >= pathLength) break;
    let nextIndex = anchorIndex + 1;
    let candidateIndex = pathLength;
    while (candidateIndex > anchorIndex + 2) {
      candidateIndex -= 1;
      const candidateX = <i32>load<u32>(rawXPointer + candidateIndex * sizeof<u32>());
      const candidateY = <i32>load<u32>(rawYPointer + candidateIndex * sizeof<u32>());
      if (
        candidateX > anchorX &&
        !lineHitsRouteContext(contextPointer, anchorX, anchorY, candidateX, candidateY)
      ) {
        nextIndex = candidateIndex;
        break;
      }
    }
    anchorIndex = nextIndex;
  }

  const pathXPointer = reserveArena(simplifiedLength * sizeof<f64>(), sizeof<f64>());
  const pathYPointer = reserveArena(simplifiedLength * sizeof<f64>(), sizeof<f64>());
  let pointIndex: u32 = 0;
  while (pointIndex < simplifiedLength) {
    store<f64>(
      pathXPointer + pointIndex * sizeof<f64>(),
      <f64>load<u32>(simplifiedXPointer + pointIndex * sizeof<u32>()),
    );
    store<f64>(
      pathYPointer + pointIndex * sizeof<f64>(),
      <f64>load<u32>(simplifiedYPointer + pointIndex * sizeof<u32>()),
    );
    pointIndex += 1;
  }
  const pathPointer = reserveArena(12, sizeof<u32>());
  store<u32>(pathPointer, pathXPointer);
  store<u32>(pathPointer + 4, pathYPointer);
  store<u32>(pathPointer + 8, simplifiedLength);
  return pathPointer;
}

function createSuccessfulThetaResult(pathPointer: u32, expansions: u32, previewStatePointer: u32): u32 {
  return createRouteSearchResult(
    Layout.ROUTE_SEARCH_RESULT_STATUS_SUCCESS,
    load<u32>(pathPointer),
    load<u32>(pathPointer + 4),
    load<u32>(pathPointer + 8),
    expansions,
    previewStatePointer,
  );
}

function resetThetaSearchScratch(contextPointer: u32): void {
  const closedPointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_CLOSED_POINTER_OFFSET);
  const gScorePointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_G_SCORE_POINTER_OFFSET);
  const parentIndexesPointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_PARENT_POINTER_OFFSET);
  const touchedIndexesPointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_TOUCHED_POINTER_OFFSET);
  const touchedCount = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_TOUCHED_COUNT_OFFSET);
  let touchedIndex: u32 = 0;
  while (touchedIndex < touchedCount) {
    const index = load<u32>(touchedIndexesPointer + touchedIndex * sizeof<u32>());
    store<u8>(closedPointer + index, 0);
    store<f64>(gScorePointer + index * sizeof<f64>(), f64.POSITIVE_INFINITY);
    store<i32>(parentIndexesPointer + index * sizeof<i32>(), -1);
    touchedIndex += 1;
  }
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_TOUCHED_COUNT_OFFSET, 0);
}

function setThetaNodeState(
  contextPointer: u32,
  index: u32,
  routeCost: f64,
  parentIndex: u32,
): void {
  const parentIndexesPointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_PARENT_POINTER_OFFSET);
  if (load<i32>(parentIndexesPointer + index * sizeof<i32>()) == -1) {
    const touchedCount = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_TOUCHED_COUNT_OFFSET);
    if (touchedCount >= getPlaneCellCount()) trap();
    const touchedIndexesPointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_TOUCHED_POINTER_OFFSET);
    store<u32>(touchedIndexesPointer + touchedCount * sizeof<u32>(), index);
    store<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_TOUCHED_COUNT_OFFSET, touchedCount + 1);
  }
  const closedPointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_CLOSED_POINTER_OFFSET);
  const gScorePointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_G_SCORE_POINTER_OFFSET);
  store<u8>(closedPointer + index, 0);
  store<f64>(gScorePointer + index * sizeof<f64>(), routeCost);
  store<i32>(parentIndexesPointer + index * sizeof<i32>(), <i32>parentIndex);
}

function runThetaStarSearch(inputPointer: u32, inputByteLength: u32): u32 {
  if (inputByteLength != Layout.ROUTE_SEARCH_INPUT_BYTE_LENGTH) trap();
  requireArenaRange(inputPointer, inputByteLength, sizeof<u64>());
  const contextPointer = load<u32>(inputPointer + Layout.ROUTE_SEARCH_INPUT_CONTEXT_POINTER_OFFSET);
  requireRouteContext(contextPointer);
  const startX = readPlaneCoordinate(inputPointer, Layout.ROUTE_SEARCH_INPUT_START_X_OFFSET, getPlaneWidth());
  const startY = readPlaneCoordinate(inputPointer, Layout.ROUTE_SEARCH_INPUT_START_Y_OFFSET, getPlaneHeight());
  const targetX = readPlaneCoordinate(inputPointer, Layout.ROUTE_SEARCH_INPUT_TARGET_X_OFFSET, getPlaneWidth());
  const targetY = readPlaneCoordinate(inputPointer, Layout.ROUTE_SEARCH_INPUT_TARGET_Y_OFFSET, getPlaneHeight());
  const shouldCollectPreviews = load<u32>(inputPointer + Layout.ROUTE_SEARCH_INPUT_COLLECT_PREVIEWS_OFFSET);
  if (shouldCollectPreviews > 1) trap();
  const previewStatePointer = shouldCollectPreviews == 0 ? 0 : createRoutePreviewState(contextPointer);
  resetThetaSearchScratch(contextPointer);
  if (
    pointHitsRouteContext(contextPointer, startX, startY) ||
    pointHitsRouteContext(contextPointer, targetX, targetY) ||
    targetX < startX
  ) return createNoRouteSearchResult(0, previewStatePointer);
  if (
    targetX > startX &&
    !lineHitsRouteContext(contextPointer, startX, startY, targetX, targetY)
  ) {
    const directXPointer = reserveArena(2 * sizeof<f64>(), sizeof<f64>());
    const directYPointer = reserveArena(2 * sizeof<f64>(), sizeof<f64>());
    store<f64>(directXPointer, <f64>startX);
    store<f64>(directXPointer + sizeof<f64>(), <f64>targetX);
    store<f64>(directYPointer, <f64>startY);
    store<f64>(directYPointer + sizeof<f64>(), <f64>targetY);
    if (previewStatePointer != 0) {
      publishDirectThetaPreview(contextPointer, previewStatePointer, startX, startY, targetX, targetY);
    }
    return createRouteSearchResult(
      Layout.ROUTE_SEARCH_RESULT_STATUS_SUCCESS,
      directXPointer,
      directYPointer,
      2,
      0,
      previewStatePointer,
    );
  }

  const width = getPlaneWidth();
  const startIndex = <u32>startY * width + <u32>startX;
  const targetIndex = <u32>targetY * width + <u32>targetX;
  const closedPointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_CLOSED_POINTER_OFFSET);
  const gScorePointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_G_SCORE_POINTER_OFFSET);
  const parentIndexesPointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_PARENT_POINTER_OFFSET);
  setThetaNodeState(contextPointer, startIndex, 0, startIndex);
  const heapPointer = reserveArena(THETA_HEAP_BYTE_LENGTH, sizeof<u32>());
  memory.fill(heapPointer, 0, THETA_HEAP_BYTE_LENGTH);
  pushThetaHeap(heapPointer, startIndex, planePointDistance(startX, startY, targetX, targetY), 0);
  const poppedNodePointer = reserveArena(THETA_HEAP_NODE_BYTE_LENGTH, sizeof<u64>());
  const candidatesPointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_CANDIDATES_POINTER_OFFSET);
  const seenCandidatesPointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_SEEN_POINTER_OFFSET);
  let expansions: u32 = 0;

  while (popThetaHeap(heapPointer, poppedNodePointer)) {
    const currentIndex = load<u32>(poppedNodePointer + THETA_HEAP_NODE_INDEX_OFFSET);
    const currentRouteCost = load<f64>(poppedNodePointer + THETA_HEAP_NODE_ROUTE_COST_OFFSET);
    if (
      load<u8>(closedPointer + currentIndex) != 0 ||
      currentRouteCost != load<f64>(gScorePointer + currentIndex * sizeof<f64>())
    ) continue;
    if (currentIndex == targetIndex) {
      const simplifiedPathPointer = createSimplifiedThetaPath(contextPointer, targetIndex, parentIndexesPointer);
      if (previewStatePointer != 0) {
        publishThetaPreview(
          contextPointer,
          previewStatePointer,
          heapPointer,
          parentIndexesPointer,
          currentIndex,
          currentIndex,
          simplifiedPathPointer,
          startIndex,
          targetIndex,
        );
      }
      return createSuccessfulThetaResult(simplifiedPathPointer, expansions, previewStatePointer);
    }
    const currentX = <i32>(currentIndex % width);
    const currentY = <i32>(currentIndex / width);
    if (
      targetX > currentX &&
      !lineHitsRouteContext(contextPointer, currentX, currentY, targetX, targetY)
    ) {
      if (previewStatePointer != 0) {
        appendRoutePreviewAcceptedEdge(previewStatePointer, currentX, currentY, targetX, targetY);
      }
      setThetaNodeState(
        contextPointer,
        targetIndex,
        currentRouteCost + planePointDistance(currentX, currentY, targetX, targetY),
        currentIndex,
      );
      const simplifiedPathPointer = createSimplifiedThetaPath(contextPointer, targetIndex, parentIndexesPointer);
      if (previewStatePointer != 0) {
        publishThetaPreview(
          contextPointer,
          previewStatePointer,
          heapPointer,
          parentIndexesPointer,
          currentIndex,
          targetIndex,
          simplifiedPathPointer,
          startIndex,
          targetIndex,
        );
      }
      return createSuccessfulThetaResult(simplifiedPathPointer, expansions, previewStatePointer);
    }
    store<u8>(closedPointer + currentIndex, 1);
    const nextX = currentX + 1;
    if (nextX > targetX) continue;
    const candidateCount = collectThetaCandidates(
      contextPointer,
      currentX,
      currentY,
      targetX,
      targetY,
      nextX,
      candidatesPointer,
      seenCandidatesPointer,
    );
    let candidateIndex: u32 = 0;
    while (candidateIndex < candidateCount) {
      const nextY = <i32>load<u32>(candidatesPointer + candidateIndex * sizeof<u32>());
      const nextIndex = <u32>nextY * width + <u32>nextX;
      const parentIndex = load<i32>(parentIndexesPointer + currentIndex * sizeof<i32>());
      let routeFromIndex = currentIndex;
      let routeFromX = currentX;
      let routeFromY = currentY;
      if (parentIndex >= 0 && <u32>parentIndex != currentIndex) {
        const parentX = parentIndex % <i32>width;
        const parentY = parentIndex / <i32>width;
        if (nextX > parentX && !lineHitsRouteContext(contextPointer, parentX, parentY, nextX, nextY)) {
          routeFromIndex = <u32>parentIndex;
          routeFromX = parentX;
          routeFromY = parentY;
        } else if (lineHitsRouteContext(contextPointer, currentX, currentY, nextX, nextY)) {
          candidateIndex += 1;
          continue;
        }
      } else if (lineHitsRouteContext(contextPointer, currentX, currentY, nextX, nextY)) {
        candidateIndex += 1;
        continue;
      }
      const routeCost =
        load<f64>(gScorePointer + routeFromIndex * sizeof<f64>()) +
        planePointDistance(routeFromX, routeFromY, nextX, nextY);
      if (routeCost < load<f64>(gScorePointer + nextIndex * sizeof<f64>())) {
        setThetaNodeState(contextPointer, nextIndex, routeCost, routeFromIndex);
        pushThetaHeap(
          heapPointer,
          nextIndex,
          routeCost + planePointDistance(nextX, nextY, targetX, targetY),
          routeCost,
        );
        if (previewStatePointer != 0) {
          appendRoutePreviewAcceptedEdge(previewStatePointer, routeFromX, routeFromY, nextX, nextY);
        }
      }
      candidateIndex += 1;
    }
    expansions += 1;
    if (
      previewStatePointer != 0 &&
      expansions % load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_PREVIEW_EXPANSION_INTERVAL_OFFSET) == 0
    ) {
      publishThetaPreview(
        contextPointer,
        previewStatePointer,
        heapPointer,
        parentIndexesPointer,
        currentIndex,
        currentIndex,
        0,
        startIndex,
        targetIndex,
      );
    }
  }
  return createNoRouteSearchResult(expansions, previewStatePointer);
}

/** Executes one coarse route-context or collision command without crossing the JS boundary inside a loop. */
export function runRouteTask(command: u32, inputPointer: u32, inputByteLength: u32): u32 {
  requireArenaInitialized();
  requireGraphwarGameConstantsInitialized();
  if (command == Layout.ROUTE_COMMAND_CREATE_CONTEXT) return createRouteContext(inputPointer, inputByteLength);
  if (command == Layout.ROUTE_COMMAND_POINT_HIT) return runPointQuery(inputPointer, inputByteLength);
  if (command == Layout.ROUTE_COMMAND_LINE_HIT) return runLineQuery(inputPointer, inputByteLength);
  if (command == Layout.ROUTE_COMMAND_GRAPH_REGION_HIT) return runGraphRegionHitQuery(inputPointer, inputByteLength);
  if (command == Layout.ROUTE_COMMAND_PLANE_REGION_COUNT) return runPlaneRegionCountQuery(inputPointer, inputByteLength);
  if (command == Layout.ROUTE_COMMAND_THETA_STAR) return runThetaStarSearch(inputPointer, inputByteLength);
  trap();
  return 0;
}

/** Placeholder for smart pathfinding composition above route jobs. */
export function runSmartPathfinding(): i32 {
  requireArenaInitialized();
  return 0;
}

/** Placeholder for starting one-click-clear state retained below its session mark. */
export function beginOneClickClear(): i32 {
  requireArenaInitialized();
  return 0;
}

/** Placeholder for resuming one-click-clear after an external edge batch. */
export function resumeOneClickClear(): i32 {
  requireArenaInitialized();
  return 0;
}
