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
  const boundaryExpansion = <i32>NativeMath.floor(load<f64>(contextPointer + Layout.ROUTE_CONTEXT_BOUNDARY_EXPANSION_OFFSET));
  const width = <i32>getPlaneWidth();
  const height = <i32>getPlaneHeight();
  const flags = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_FLAGS_OFFSET);
  const x = (flags & Layout.ROUTE_CONTEXT_FLAG_MIRRORED) != 0 ? width - 1 - forwardX : forwardX;
  if (
    x < boundaryExpansion ||
    x >= width - boundaryExpansion ||
    y < boundaryExpansion ||
    y >= height - boundaryExpansion
  ) return true;
  const maskPointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_ROUTE_MASK_POINTER_OFFSET);
  return load<u8>(maskPointer + <u32>y * <u32>width + <u32>x) != 0;
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
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const absoluteDeltaX = deltaX < 0 ? -deltaX : deltaX;
  const absoluteDeltaY = deltaY < 0 ? -deltaY : deltaY;
  const steps = absoluteDeltaX > absoluteDeltaY ? absoluteDeltaX : absoluteDeltaY;
  if (steps == 0) return createQueryResult(pointHitsRouteContext(contextPointer, startX, startY) ? 1 : 0);
  let step: i32 = 0;
  while (step <= steps) {
    const ratio = <f64>step / <f64>steps;
    const x = <i32>NativeMath.floor(<f64>startX + <f64>deltaX * ratio + 0.5);
    const y = <i32>NativeMath.floor(<f64>startY + <f64>deltaY * ratio + 0.5);
    if (pointHitsRouteContext(contextPointer, x, y)) return createQueryResult(1);
    step += 1;
  }
  return createQueryResult(0);
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
  const boundaryInset = <i32>NativeMath.floor(load<f64>(contextPointer + Layout.ROUTE_CONTEXT_BOUNDARY_EXPANSION_OFFSET));
  if (
    minX < boundaryInset ||
    maxX >= <i32>getPlaneWidth() - boundaryInset ||
    minY < boundaryInset ||
    maxY >= <i32>getPlaneHeight() - boundaryInset
  ) return createQueryResult(1);
  return createQueryResult(countPlaneRegion(contextPointer, <u32>minX, <u32>maxX, <u32>minY, <u32>maxY) > 0 ? 1 : 0);
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
