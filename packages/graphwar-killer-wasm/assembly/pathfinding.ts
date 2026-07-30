import { getGraphwarPlaneHeight, getGraphwarPlaneLength, requireGraphwarGameConstantsInitialized } from "./game-constants";
import { floorFormulaDecimal, serializeMagnitudeDecimal } from "./decimal";
import { FORMULA_EQUATION_DDY, FORMULA_EQUATION_DY, FORMULA_EQUATION_Y } from "./formula-layout";
import {
  createStepFormulaResolutionFromPlateauState,
  getStepFormulaResolutionStateCount,
  getStepFormulaResolutionStatePointer,
  getStepFormulaResolutionStateSign,
  resolveStepFormulaTransition,
  STEP_TRANSITION_EFFECTIVE_DELTA_Y_OFFSET,
  STEP_TRANSITION_IS_VALID_OFFSET,
  STEP_TRANSITION_RESOLVED_END_Y_OFFSET,
  STEP_TRANSITION_RESOLVED_START_Y_OFFSET,
} from "./formula-step-resolution";
import { commitArena, markArena, requireArenaInitialized, requireArenaRange, reserveArena, resetArena } from "./memory";
import * as Layout from "./pathfinding-layout";
import { createStepGlitchGeometryContext } from "./step-glitch";

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
function loadNonNegativePolicyValue(pointer: u32, index: u32): f64 {
  const value = loadContextValue(pointer, index);
  if (!isFiniteValue(value) || value < 0) trap();
  return value;
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

const VISIBILITY_COMPONENT_RECORD_LENGTH: u32 = 7;
const VISIBILITY_COMPONENT_MIN_X_INDEX: u32 = 0;
const VISIBILITY_COMPONENT_MAX_X_INDEX: u32 = 1;
const VISIBILITY_COMPONENT_MIN_Y_INDEX: u32 = 2;
const VISIBILITY_COMPONENT_MAX_Y_INDEX: u32 = 3;
const VISIBILITY_COMPONENT_SUM_X_INDEX: u32 = 4;
const VISIBILITY_COMPONENT_SUM_Y_INDEX: u32 = 5;
const VISIBILITY_COMPONENT_CELL_COUNT_INDEX: u32 = 6;

const VISIBILITY_EDGE_COMPONENT_OFFSET: u32 = 0;
const VISIBILITY_EDGE_START_X_OFFSET: u32 = 4;
const VISIBILITY_EDGE_START_Y_OFFSET: u32 = 8;
const VISIBILITY_EDGE_END_X_OFFSET: u32 = 12;
const VISIBILITY_EDGE_END_Y_OFFSET: u32 = 16;
const VISIBILITY_EDGE_BYTE_LENGTH: u32 = 20;

function createVisibilityComponentStats(componentIdsPointer: u32, componentCount: u32): u32 {
  if (componentCount == 0) return 0;
  const pointer = reserveArena(
    componentCount * VISIBILITY_COMPONENT_RECORD_LENGTH * sizeof<u32>(),
    sizeof<u32>(),
  );
  let componentIndex: u32 = 0;
  while (componentIndex < componentCount) {
    const recordPointer = pointer + componentIndex * VISIBILITY_COMPONENT_RECORD_LENGTH * sizeof<u32>();
    store<u32>(recordPointer + VISIBILITY_COMPONENT_MIN_X_INDEX * sizeof<u32>(), getPlaneWidth());
    store<u32>(recordPointer + VISIBILITY_COMPONENT_MIN_Y_INDEX * sizeof<u32>(), getPlaneHeight());
    store<u32>(recordPointer + VISIBILITY_COMPONENT_MAX_X_INDEX * sizeof<u32>(), 0);
    store<u32>(recordPointer + VISIBILITY_COMPONENT_MAX_Y_INDEX * sizeof<u32>(), 0);
    store<u32>(recordPointer + VISIBILITY_COMPONENT_SUM_X_INDEX * sizeof<u32>(), 0);
    store<u32>(recordPointer + VISIBILITY_COMPONENT_SUM_Y_INDEX * sizeof<u32>(), 0);
    store<u32>(recordPointer + VISIBILITY_COMPONENT_CELL_COUNT_INDEX * sizeof<u32>(), 0);
    componentIndex += 1;
  }
  const width = getPlaneWidth();
  const height = getPlaneHeight();
  let y: u32 = 0;
  while (y < height) {
    let x: u32 = 0;
    while (x < width) {
      const componentId = load<u32>(componentIdsPointer + (y * width + x) * sizeof<u32>());
      if (componentId != 0) {
        const recordPointer = pointer + (componentId - 1) * VISIBILITY_COMPONENT_RECORD_LENGTH * sizeof<u32>();
        store<u32>(
          recordPointer + VISIBILITY_COMPONENT_MIN_X_INDEX * sizeof<u32>(),
          min<u32>(load<u32>(recordPointer + VISIBILITY_COMPONENT_MIN_X_INDEX * sizeof<u32>()), x),
        );
        store<u32>(
          recordPointer + VISIBILITY_COMPONENT_MAX_X_INDEX * sizeof<u32>(),
          max<u32>(load<u32>(recordPointer + VISIBILITY_COMPONENT_MAX_X_INDEX * sizeof<u32>()), x),
        );
        store<u32>(
          recordPointer + VISIBILITY_COMPONENT_MIN_Y_INDEX * sizeof<u32>(),
          min<u32>(load<u32>(recordPointer + VISIBILITY_COMPONENT_MIN_Y_INDEX * sizeof<u32>()), y),
        );
        store<u32>(
          recordPointer + VISIBILITY_COMPONENT_MAX_Y_INDEX * sizeof<u32>(),
          max<u32>(load<u32>(recordPointer + VISIBILITY_COMPONENT_MAX_Y_INDEX * sizeof<u32>()), y),
        );
        store<u32>(
          recordPointer + VISIBILITY_COMPONENT_SUM_X_INDEX * sizeof<u32>(),
          load<u32>(recordPointer + VISIBILITY_COMPONENT_SUM_X_INDEX * sizeof<u32>()) + x,
        );
        store<u32>(
          recordPointer + VISIBILITY_COMPONENT_SUM_Y_INDEX * sizeof<u32>(),
          load<u32>(recordPointer + VISIBILITY_COMPONENT_SUM_Y_INDEX * sizeof<u32>()) + y,
        );
        store<u32>(
          recordPointer + VISIBILITY_COMPONENT_CELL_COUNT_INDEX * sizeof<u32>(),
          load<u32>(recordPointer + VISIBILITY_COMPONENT_CELL_COUNT_INDEX * sizeof<u32>()) + 1,
        );
      }
      x += 1;
    }
    y += 1;
  }
  return pointer;
}

@inline
function visibilityEdgePointer(pointer: u32, index: u32): u32 {
  return pointer + index * VISIBILITY_EDGE_BYTE_LENGTH;
}

function storeVisibilityEdge(
  pointer: u32,
  index: u32,
  componentId: u32,
  startX: i32,
  startY: i32,
  endX: i32,
  endY: i32,
): void {
  const recordPointer = visibilityEdgePointer(pointer, index);
  store<u32>(recordPointer + VISIBILITY_EDGE_COMPONENT_OFFSET, componentId);
  store<i32>(recordPointer + VISIBILITY_EDGE_START_X_OFFSET, startX);
  store<i32>(recordPointer + VISIBILITY_EDGE_START_Y_OFFSET, startY);
  store<i32>(recordPointer + VISIBILITY_EDGE_END_X_OFFSET, endX);
  store<i32>(recordPointer + VISIBILITY_EDGE_END_Y_OFFSET, endY);
}

/** Rebuilds the TS component BFS edge order from retained x+ labels before contour tracing. */
function fillVisibilityEdges(
  maskPointer: u32,
  componentIdsPointer: u32,
  edgeCount: u32,
  isMirrored: bool,
  outputPointer: u32,
): void {
  const width = getPlaneWidth();
  const height = getPlaneHeight();
  const cellCount = width * height;
  const visitedPointer = reserveArena(cellCount, 1);
  memory.fill(visitedPointer, 0, cellCount);
  const queuePointer = reserveArena(cellCount * sizeof<u32>(), sizeof<u32>());
  let edgeIndex: u32 = 0;
  let y: u32 = 0;
  while (y < height) {
    let x: u32 = 0;
    while (x < width) {
      const startIndex = y * width + x;
      const componentId = load<u32>(componentIdsPointer + startIndex * sizeof<u32>());
      if (componentId == 0 || load<u8>(visitedPointer + startIndex) != 0) {
        x += 1;
        continue;
      }
      let queueStart: u32 = 0;
      let queueEnd: u32 = 1;
      store<u32>(queuePointer, startIndex);
      store<u8>(visitedPointer + startIndex, 1);
      while (queueStart < queueEnd) {
        const cellIndex = load<u32>(queuePointer + queueStart * sizeof<u32>());
        queueStart += 1;
        const cellX = <i32>(cellIndex % width);
        const cellY = <i32>(cellIndex / width);
        if (!routeCellIsBlocked(maskPointer, cellX, cellY - 1, isMirrored)) {
          storeVisibilityEdge(outputPointer, edgeIndex, componentId, cellX, cellY, cellX + 1, cellY);
          edgeIndex += 1;
        }
        if (!routeCellIsBlocked(maskPointer, cellX + 1, cellY, isMirrored)) {
          storeVisibilityEdge(outputPointer, edgeIndex, componentId, cellX + 1, cellY, cellX + 1, cellY + 1);
          edgeIndex += 1;
        }
        if (!routeCellIsBlocked(maskPointer, cellX, cellY + 1, isMirrored)) {
          storeVisibilityEdge(outputPointer, edgeIndex, componentId, cellX + 1, cellY + 1, cellX, cellY + 1);
          edgeIndex += 1;
        }
        if (!routeCellIsBlocked(maskPointer, cellX - 1, cellY, isMirrored)) {
          storeVisibilityEdge(outputPointer, edgeIndex, componentId, cellX, cellY + 1, cellX, cellY);
          edgeIndex += 1;
        }
        let offsetY: i32 = -1;
        while (offsetY <= 1) {
          let offsetX: i32 = -1;
          while (offsetX <= 1) {
            if (offsetX != 0 || offsetY != 0) {
              const nextX = cellX + offsetX;
              const nextY = cellY + offsetY;
              if (planePointIsInsideBounds(nextX, nextY)) {
                const nextIndex = <u32>nextY * width + <u32>nextX;
                if (
                  load<u8>(visitedPointer + nextIndex) == 0 &&
                  load<u32>(componentIdsPointer + nextIndex * sizeof<u32>()) == componentId
                ) {
                  store<u8>(visitedPointer + nextIndex, 1);
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
  if (edgeIndex != edgeCount) trap();
}

@inline
function visibilityEdgeDirection(pointer: u32): i32 {
  const deltaX = load<i32>(pointer + VISIBILITY_EDGE_END_X_OFFSET) - load<i32>(pointer + VISIBILITY_EDGE_START_X_OFFSET);
  const deltaY = load<i32>(pointer + VISIBILITY_EDGE_END_Y_OFFSET) - load<i32>(pointer + VISIBILITY_EDGE_START_Y_OFFSET);
  return deltaX > 0 ? 0 : deltaY > 0 ? 1 : deltaX < 0 ? 2 : 3;
}

function selectNextVisibilityEdge(
  edgesPointer: u32,
  unusedPointer: u32,
  adjacencyHeadsPointer: u32,
  adjacencyNextPointer: u32,
  previousEdgePointer: u32,
): i32 {
  const endX = load<i32>(previousEdgePointer + VISIBILITY_EDGE_END_X_OFFSET);
  const endY = load<i32>(previousEdgePointer + VISIBILITY_EDGE_END_Y_OFFSET);
  const previousDirection = visibilityEdgeDirection(previousEdgePointer);
  let bestIndex: i32 = -1;
  let bestTurn: i32 = 5;
  const vertexIndex = <u32>endY * (getPlaneWidth() + 1) + <u32>endX;
  let edgeIndex = load<i32>(adjacencyHeadsPointer + vertexIndex * sizeof<i32>());
  while (edgeIndex >= 0) {
    if (load<u8>(unusedPointer + <u32>edgeIndex) != 0) {
      const edgePointer = visibilityEdgePointer(edgesPointer, <u32>edgeIndex);
        const turn = (visibilityEdgeDirection(edgePointer) - previousDirection + 4) % 4;
        if (bestIndex < 0 || turn < bestTurn) {
          bestIndex = edgeIndex;
          bestTurn = turn;
        } else if (turn == bestTurn) {
          const bestPointer = visibilityEdgePointer(edgesPointer, <u32>bestIndex);
          const candidateEndX = load<i32>(edgePointer + VISIBILITY_EDGE_END_X_OFFSET);
          const bestEndX = load<i32>(bestPointer + VISIBILITY_EDGE_END_X_OFFSET);
          const candidateEndY = load<i32>(edgePointer + VISIBILITY_EDGE_END_Y_OFFSET);
          const bestEndY = load<i32>(bestPointer + VISIBILITY_EDGE_END_Y_OFFSET);
          if (candidateEndX < bestEndX || (candidateEndX == bestEndX && candidateEndY < bestEndY)) {
            bestIndex = edgeIndex;
          }
        }
    }
    edgeIndex = load<i32>(adjacencyNextPointer + <u32>edgeIndex * sizeof<i32>());
  }
  return bestIndex;
}

@inline
function contourPointX(pointer: u32, index: u32): i32 {
  return load<i32>(pointer + index * 2 * sizeof<u32>());
}

@inline
function contourPointY(pointer: u32, index: u32): i32 {
  return load<i32>(pointer + (index * 2 + 1) * sizeof<u32>());
}

@inline
function distanceBetweenValues(deltaX: f64, deltaY: f64): f64 {
  const absoluteX = NativeMath.abs(deltaX);
  const absoluteY = NativeMath.abs(deltaY);
  const maximum = NativeMath.max(absoluteX, absoluteY);
  if (maximum == 0) return 0;
  const ratio = NativeMath.min(absoluteX, absoluteY) / maximum;
  return NativeMath.sqrt(1 + ratio * ratio) * maximum;
}

function contourDistanceToLineSegment(
  contourPointer: u32,
  pointIndex: u32,
  startIndex: u32,
  endIndex: u32,
): f64 {
  const pointX = <f64>contourPointX(contourPointer, pointIndex);
  const pointY = <f64>contourPointY(contourPointer, pointIndex);
  const startX = <f64>contourPointX(contourPointer, startIndex);
  const startY = <f64>contourPointY(contourPointer, startIndex);
  const endX = <f64>contourPointX(contourPointer, endIndex);
  const endY = <f64>contourPointY(contourPointer, endIndex);
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared == 0) return distanceBetweenValues(pointX - startX, pointY - startY);
  const ratio = clampValue(((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSquared, 0, 1);
  return distanceBetweenValues(pointX - (startX + deltaX * ratio), pointY - (startY + deltaY * ratio));
}

@inline
function circularContourIndex(startIndex: u32, localIndex: u32, contourLength: u32): u32 {
  return (startIndex + localIndex) % contourLength;
}

function simplifyVisibilityContourChain(
  contourPointer: u32,
  contourLength: u32,
  startIndex: u32,
  endIndex: u32,
  epsilon: f64,
  pendingStartsPointer: u32,
  pendingEndsPointer: u32,
  outputIndexesPointer: u32,
): u32 {
  const chainLength = endIndex >= startIndex ? endIndex - startIndex + 1 : contourLength - startIndex + endIndex + 1;
  if (chainLength <= 2) {
    store<u32>(outputIndexesPointer, startIndex);
    if (chainLength == 2) store<u32>(outputIndexesPointer + sizeof<u32>(), endIndex);
    return chainLength;
  }
  let pendingCount: u32 = 1;
  store<u32>(pendingStartsPointer, 0);
  store<u32>(pendingEndsPointer, chainLength - 1);
  let outputCount: u32 = 0;
  while (pendingCount > 0) {
    pendingCount -= 1;
    const localStart = load<u32>(pendingStartsPointer + pendingCount * sizeof<u32>());
    const localEnd = load<u32>(pendingEndsPointer + pendingCount * sizeof<u32>());
    const globalStart = circularContourIndex(startIndex, localStart, contourLength);
    const globalEnd = circularContourIndex(startIndex, localEnd, contourLength);
    if (localEnd - localStart <= 1) {
      if (outputCount == 0 || load<u32>(outputIndexesPointer + (outputCount - 1) * sizeof<u32>()) != globalStart) {
        store<u32>(outputIndexesPointer + outputCount * sizeof<u32>(), globalStart);
        outputCount += 1;
      }
      if (load<u32>(outputIndexesPointer + (outputCount - 1) * sizeof<u32>()) != globalEnd) {
        store<u32>(outputIndexesPointer + outputCount * sizeof<u32>(), globalEnd);
        outputCount += 1;
      }
      continue;
    }
    let maximumDistance = f64.NEGATIVE_INFINITY;
    let splitLocalIndex = localStart;
    let localIndex = localStart + 1;
    while (localIndex < localEnd) {
      const distance = contourDistanceToLineSegment(
        contourPointer,
        circularContourIndex(startIndex, localIndex, contourLength),
        globalStart,
        globalEnd,
      );
      if (distance > maximumDistance) {
        maximumDistance = distance;
        splitLocalIndex = localIndex;
      }
      localIndex += 1;
    }
    if (maximumDistance <= epsilon) {
      if (outputCount == 0 || load<u32>(outputIndexesPointer + (outputCount - 1) * sizeof<u32>()) != globalStart) {
        store<u32>(outputIndexesPointer + outputCount * sizeof<u32>(), globalStart);
        outputCount += 1;
      }
      if (load<u32>(outputIndexesPointer + (outputCount - 1) * sizeof<u32>()) != globalEnd) {
        store<u32>(outputIndexesPointer + outputCount * sizeof<u32>(), globalEnd);
        outputCount += 1;
      }
      continue;
    }
    store<u32>(pendingStartsPointer + pendingCount * sizeof<u32>(), splitLocalIndex);
    store<u32>(pendingEndsPointer + pendingCount * sizeof<u32>(), localEnd);
    pendingCount += 1;
    store<u32>(pendingStartsPointer + pendingCount * sizeof<u32>(), localStart);
    store<u32>(pendingEndsPointer + pendingCount * sizeof<u32>(), splitLocalIndex);
    pendingCount += 1;
  }
  return outputCount;
}

function appendSimplifiedVisibilityContour(
  contourPointer: u32,
  contourLength: u32,
  epsilon: f64,
  pendingStartsPointer: u32,
  pendingEndsPointer: u32,
  simplifiedIndexesPointer: u32,
  outputXPointer: u32,
  outputYPointer: u32,
  outputOffset: u32,
): u32 {
  if (contourLength <= 3) {
    if (outputXPointer != 0) {
      let index: u32 = 0;
      while (index < contourLength) {
        store<u32>(outputXPointer + (outputOffset + index) * sizeof<u32>(), <u32>contourPointX(contourPointer, index));
        store<u32>(outputYPointer + (outputOffset + index) * sizeof<u32>(), <u32>contourPointY(contourPointer, index));
        index += 1;
      }
    }
    return contourLength;
  }
  let startIndex: u32 = 0;
  let index: u32 = 1;
  while (index < contourLength) {
    const x = contourPointX(contourPointer, index);
    const y = contourPointY(contourPointer, index);
    const bestX = contourPointX(contourPointer, startIndex);
    const bestY = contourPointY(contourPointer, startIndex);
    if (x < bestX || (x == bestX && y < bestY)) startIndex = index;
    index += 1;
  }
  const startX = contourPointX(contourPointer, startIndex);
  const startY = contourPointY(contourPointer, startIndex);
  let endIndex = startIndex;
  let farthestSquared: i64 = -1;
  index = 0;
  while (index < contourLength) {
    const deltaX = <i64>(contourPointX(contourPointer, index) - startX);
    const deltaY = <i64>(contourPointY(contourPointer, index) - startY);
    const distanceSquared = deltaX * deltaX + deltaY * deltaY;
    if (distanceSquared > farthestSquared) {
      farthestSquared = distanceSquared;
      endIndex = index;
    }
    index += 1;
  }
  if (endIndex == startIndex) {
    if (outputXPointer != 0) {
      index = 0;
      while (index < contourLength) {
        store<u32>(outputXPointer + (outputOffset + index) * sizeof<u32>(), <u32>contourPointX(contourPointer, index));
        store<u32>(outputYPointer + (outputOffset + index) * sizeof<u32>(), <u32>contourPointY(contourPointer, index));
        index += 1;
      }
    }
    return contourLength;
  }
  const firstCount = simplifyVisibilityContourChain(
    contourPointer,
    contourLength,
    startIndex,
    endIndex,
    epsilon,
    pendingStartsPointer,
    pendingEndsPointer,
    simplifiedIndexesPointer,
  );
  const secondIndexesPointer = simplifiedIndexesPointer + contourLength * sizeof<u32>();
  const secondCount = simplifyVisibilityContourChain(
    contourPointer,
    contourLength,
    endIndex,
    startIndex,
    epsilon,
    pendingStartsPointer,
    pendingEndsPointer,
    secondIndexesPointer,
  );
  const outputCount = firstCount + secondCount - 2;
  if (outputXPointer != 0) {
    let outputIndex: u32 = 0;
    index = 0;
    while (index + 1 < firstCount) {
      const sourceIndex = load<u32>(simplifiedIndexesPointer + index * sizeof<u32>());
      store<u32>(outputXPointer + (outputOffset + outputIndex) * sizeof<u32>(), <u32>contourPointX(contourPointer, sourceIndex));
      store<u32>(outputYPointer + (outputOffset + outputIndex) * sizeof<u32>(), <u32>contourPointY(contourPointer, sourceIndex));
      outputIndex += 1;
      index += 1;
    }
    index = 0;
    while (index + 1 < secondCount) {
      const sourceIndex = load<u32>(secondIndexesPointer + index * sizeof<u32>());
      store<u32>(outputXPointer + (outputOffset + outputIndex) * sizeof<u32>(), <u32>contourPointX(contourPointer, sourceIndex));
      store<u32>(outputYPointer + (outputOffset + outputIndex) * sizeof<u32>(), <u32>contourPointY(contourPointer, sourceIndex));
      outputIndex += 1;
      index += 1;
    }
    if (outputIndex != outputCount) trap();
  }
  return outputCount;
}

function traceVisibilityContours(
  maskPointer: u32,
  componentIdsPointer: u32,
  edgeCount: u32,
  isMirrored: bool,
  epsilon: f64,
  outputOffsetsPointer: u32,
  outputComponentsPointer: u32,
  outputXPointer: u32,
  outputYPointer: u32,
  outputAreasPointer: u32,
): u64 {
  if (edgeCount == 0) {
    if (outputOffsetsPointer != 0) store<u32>(outputOffsetsPointer, 0);
    return 0;
  }
  const edgesPointer = reserveArena(edgeCount * VISIBILITY_EDGE_BYTE_LENGTH, sizeof<u32>());
  fillVisibilityEdges(maskPointer, componentIdsPointer, edgeCount, isMirrored, edgesPointer);
  const vertexCount = (getPlaneWidth() + 1) * (getPlaneHeight() + 1);
  const adjacencyHeadsPointer = reserveArena(vertexCount * sizeof<i32>(), sizeof<i32>());
  memory.fill(adjacencyHeadsPointer, 0xff, vertexCount * sizeof<i32>());
  const adjacencyNextPointer = reserveArena(edgeCount * sizeof<i32>(), sizeof<i32>());
  let adjacencyEdgeIndex: u32 = 0;
  while (adjacencyEdgeIndex < edgeCount) {
    const edgePointer = visibilityEdgePointer(edgesPointer, adjacencyEdgeIndex);
    const startX = load<u32>(edgePointer + VISIBILITY_EDGE_START_X_OFFSET);
    const startY = load<u32>(edgePointer + VISIBILITY_EDGE_START_Y_OFFSET);
    const vertexIndex = startY * (getPlaneWidth() + 1) + startX;
    store<i32>(
      adjacencyNextPointer + adjacencyEdgeIndex * sizeof<i32>(),
      load<i32>(adjacencyHeadsPointer + vertexIndex * sizeof<i32>()),
    );
    store<i32>(adjacencyHeadsPointer + vertexIndex * sizeof<i32>(), <i32>adjacencyEdgeIndex);
    adjacencyEdgeIndex += 1;
  }
  const unusedPointer = reserveArena(edgeCount, 1);
  memory.fill(unusedPointer, 1, edgeCount);
  const contourPointer = reserveArena(edgeCount * 2 * sizeof<u32>(), sizeof<u32>());
  const pendingStartsPointer = reserveArena(edgeCount * sizeof<u32>(), sizeof<u32>());
  const pendingEndsPointer = reserveArena(edgeCount * sizeof<u32>(), sizeof<u32>());
  const simplifiedIndexesPointer = reserveArena(edgeCount * 2 * sizeof<u32>(), sizeof<u32>());
  let contourCount: u32 = 0;
  let outputPointCount: u32 = 0;
  let firstUnusedIndex: u32 = 0;
  while (firstUnusedIndex < edgeCount) {
    while (firstUnusedIndex < edgeCount && load<u8>(unusedPointer + firstUnusedIndex) == 0) firstUnusedIndex += 1;
    if (firstUnusedIndex == edgeCount) break;
    const firstEdgePointer = visibilityEdgePointer(edgesPointer, firstUnusedIndex);
    const firstStartX = load<i32>(firstEdgePointer + VISIBILITY_EDGE_START_X_OFFSET);
    const firstStartY = load<i32>(firstEdgePointer + VISIBILITY_EDGE_START_Y_OFFSET);
    const componentId = load<u32>(firstEdgePointer + VISIBILITY_EDGE_COMPONENT_OFFSET);
    let edgeIndex = <i32>firstUnusedIndex;
    let contourLength: u32 = 0;
    let isClosed = false;
    while (edgeIndex >= 0 && contourLength <= edgeCount) {
      const edgePointer = visibilityEdgePointer(edgesPointer, <u32>edgeIndex);
      store<u8>(unusedPointer + <u32>edgeIndex, 0);
      store<i32>(contourPointer + contourLength * 2 * sizeof<u32>(), load<i32>(edgePointer + VISIBILITY_EDGE_START_X_OFFSET));
      store<i32>(contourPointer + (contourLength * 2 + 1) * sizeof<u32>(), load<i32>(edgePointer + VISIBILITY_EDGE_START_Y_OFFSET));
      contourLength += 1;
      if (
        load<i32>(edgePointer + VISIBILITY_EDGE_END_X_OFFSET) == firstStartX &&
        load<i32>(edgePointer + VISIBILITY_EDGE_END_Y_OFFSET) == firstStartY
      ) {
        isClosed = true;
        break;
      }
      edgeIndex = selectNextVisibilityEdge(
        edgesPointer,
        unusedPointer,
        adjacencyHeadsPointer,
        adjacencyNextPointer,
        edgePointer,
      );
    }
    if (!isClosed) trap();
    if (contourLength >= 3) {
      if (outputOffsetsPointer != 0) {
        store<u32>(outputOffsetsPointer + contourCount * sizeof<u32>(), outputPointCount);
        store<u32>(outputComponentsPointer + contourCount * sizeof<u32>(), componentId);
      }
      const simplifiedCount = appendSimplifiedVisibilityContour(
        contourPointer,
        contourLength,
        epsilon,
        pendingStartsPointer,
        pendingEndsPointer,
        simplifiedIndexesPointer,
        outputXPointer,
        outputYPointer,
        outputPointCount,
      );
      if (outputAreasPointer != 0) {
        let doubledArea: f64 = 0;
        let pointIndex: u32 = 0;
        while (pointIndex < simplifiedCount) {
          const nextIndex = (pointIndex + 1) % simplifiedCount;
          const currentX = load<u32>(outputXPointer + (outputPointCount + pointIndex) * sizeof<u32>());
          const currentY = load<u32>(outputYPointer + (outputPointCount + pointIndex) * sizeof<u32>());
          const nextX = load<u32>(outputXPointer + (outputPointCount + nextIndex) * sizeof<u32>());
          const nextY = load<u32>(outputYPointer + (outputPointCount + nextIndex) * sizeof<u32>());
          doubledArea += <f64>currentX * <f64>nextY - <f64>nextX * <f64>currentY;
          pointIndex += 1;
        }
        store<f64>(outputAreasPointer + contourCount * sizeof<f64>(), doubledArea / 2);
      }
      outputPointCount += simplifiedCount;
      contourCount += 1;
    }
  }
  if (outputOffsetsPointer != 0) store<u32>(outputOffsetsPointer + contourCount * sizeof<u32>(), outputPointCount);
  return (<u64>contourCount << 32) | <u64>outputPointCount;
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
  const stepModelPointer = load<u32>(inputPointer + Layout.ROUTE_CREATE_STEP_MODEL_POINTER_OFFSET);
  const inputFlags = load<u32>(inputPointer + Layout.ROUTE_CREATE_FLAGS_OFFSET);
  if ((inputFlags & ~Layout.ROUTE_CREATE_FLAG_PREPROCESSED_ROUTE_MASK) != 0) trap();
  const isRouteMaskPreprocessed =
    (inputFlags & Layout.ROUTE_CREATE_FLAG_PREPROCESSED_ROUTE_MASK) != 0;
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
  if (stepModelPointer != 0) {
    requireArenaRange(stepModelPointer, Layout.ROUTE_STEP_MODEL_BYTE_LENGTH, sizeof<f64>());
    const stepOriginY = load<f64>(stepModelPointer + Layout.ROUTE_STEP_MODEL_ORIGIN_Y_OFFSET);
    const formulaSteepness = load<f64>(stepModelPointer + Layout.ROUTE_STEP_MODEL_FORMULA_STEEPNESS_OFFSET);
    const qualityTarget = load<f64>(
      stepModelPointer + Layout.ROUTE_STEP_MODEL_QUALITY_TARGET_PLANE_PIXELS_OFFSET,
    );
    const decimalPlaces = load<f64>(stepModelPointer + Layout.ROUTE_STEP_MODEL_DECIMAL_PLACES_OFFSET);
    const equation = load<f64>(stepModelPointer + Layout.ROUTE_STEP_MODEL_EQUATION_OFFSET);
    if (
      !isFiniteValue(stepOriginY) ||
      !isFiniteValue(formulaSteepness) ||
      formulaSteepness <= 0 ||
      !isFiniteValue(qualityTarget) ||
      qualityTarget < 0 ||
      !isIntegerValue(decimalPlaces) ||
      decimalPlaces < 0 ||
      decimalPlaces > 15 ||
      !isIntegerValue(equation) ||
      (equation != FORMULA_EQUATION_Y && equation != FORMULA_EQUATION_DY && equation != FORMULA_EQUATION_DDY)
    ) trap();
  }
  const visibilityConcaveCrossTolerance = loadNonNegativePolicyValue(
    policyPointer,
    Layout.ROUTE_POLICY_VISIBILITY_CONCAVE_CROSS_TOLERANCE_INDEX,
  );
  const visibilityCollinearDistanceTolerance = loadNonNegativePolicyValue(
    policyPointer,
    Layout.ROUTE_POLICY_VISIBILITY_COLLINEAR_DISTANCE_TOLERANCE_INDEX,
  );
  const visibilityFreeCellSearchRadius = loadPositivePolicyInteger(
    policyPointer,
    Layout.ROUTE_POLICY_VISIBILITY_FREE_CELL_SEARCH_RADIUS_INDEX,
    max<u32>(getPlaneWidth(), getPlaneHeight()),
  );
  const visibilityRdpToleranceRatio = loadNonNegativePolicyValue(
    policyPointer,
    Layout.ROUTE_POLICY_VISIBILITY_RDP_TOLERANCE_RATIO_INDEX,
  );
  const visibilityRdpMaxEpsilon = loadNonNegativePolicyValue(
    policyPointer,
    Layout.ROUTE_POLICY_VISIBILITY_RDP_MAX_EPSILON_INDEX,
  );
  const visibilityRdpMinEpsilon = loadNonNegativePolicyValue(
    policyPointer,
    Layout.ROUTE_POLICY_VISIBILITY_RDP_MIN_EPSILON_INDEX,
  );
  if (visibilityRdpMinEpsilon > visibilityRdpMaxEpsilon) trap();
  const visibilityPreviewCandidateLimit = loadPositivePolicyInteger(
    policyPointer,
    Layout.ROUTE_POLICY_VISIBILITY_PREVIEW_CANDIDATE_LIMIT_INDEX,
    cellCount,
  );
  const visibilityPreviewEdgeLimit = loadPositivePolicyInteger(
    policyPointer,
    Layout.ROUTE_POLICY_VISIBILITY_PREVIEW_EDGE_LIMIT_INDEX,
    cellCount,
  );
  const visibilityPreviewExpansionInterval = loadPositivePolicyInteger(
    policyPointer,
    Layout.ROUTE_POLICY_VISIBILITY_PREVIEW_EXPANSION_INTERVAL_INDEX,
    u32.MAX_VALUE,
  );
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
  if (isRouteMaskPreprocessed && (friendlyCount != 0 || simulationTolerance != 0 || soldierHitRadius != 0)) trap();
  let friendlyIndex: u32 = 0;
  while (friendlyIndex < friendlyCount) {
    if (
      !isFiniteValue(load<f64>(friendlyXPointer + friendlyIndex * sizeof<f64>())) ||
      !isFiniteValue(load<f64>(friendlyYPointer + friendlyIndex * sizeof<f64>()))
    ) trap();
    friendlyIndex += 1;
  }

  if (!isRouteMaskPreprocessed) {
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
  }
  const routeMaskPointer = isRouteMaskPreprocessed
    ? createToleranceMask(sourceMaskPointer, 0)
    : createToleranceMask(sourceMaskPointer, routeTolerance);
  const simulationMaskPointer = isRouteMaskPreprocessed
    ? createToleranceMask(sourceMaskPointer, 0)
    : createToleranceMask(sourceMaskPointer, simulationTolerance);
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
  const visibilityComponentStatsPointer = createVisibilityComponentStats(componentIdsPointer, componentCount);
  const visibilityComponentStatsLength = componentCount * VISIBILITY_COMPONENT_RECORD_LENGTH;
  const visibilityEpsilon = clampValue(
    NativeMath.abs(routeTolerance) * visibilityRdpToleranceRatio,
    visibilityRdpMinEpsilon,
    visibilityRdpMaxEpsilon,
  );
  const visibilityCountMark = markArena();
  const visibilityCounts = traceVisibilityContours(
    routeMaskPointer,
    componentIdsPointer,
    boundaryEdgeCount,
    isMirrored,
    visibilityEpsilon,
    0,
    0,
    0,
    0,
    0,
  );
  const visibilityContourCount = <u32>(visibilityCounts >> 32);
  const visibilityContourPointCount = <u32>visibilityCounts;
  resetArena(visibilityCountMark);
  const visibilityContourOffsetsPointer = reserveArena(
    (visibilityContourCount + 1) * sizeof<u32>(),
    sizeof<u32>(),
  );
  const visibilityContourComponentsPointer =
    visibilityContourCount == 0 ? 0 : reserveArena(visibilityContourCount * sizeof<u32>(), sizeof<u32>());
  const visibilityContourXPointer =
    visibilityContourPointCount == 0 ? 0 : reserveArena(visibilityContourPointCount * sizeof<u32>(), sizeof<u32>());
  const visibilityContourYPointer =
    visibilityContourPointCount == 0 ? 0 : reserveArena(visibilityContourPointCount * sizeof<u32>(), sizeof<u32>());
  const visibilityContourSignedAreasPointer =
    visibilityContourCount == 0 ? 0 : reserveArena(visibilityContourCount * sizeof<f64>(), sizeof<f64>());
  const visibilityFillMark = markArena();
  const filledVisibilityCounts = traceVisibilityContours(
    routeMaskPointer,
    componentIdsPointer,
    boundaryEdgeCount,
    isMirrored,
    visibilityEpsilon,
    visibilityContourOffsetsPointer,
    visibilityContourComponentsPointer,
    visibilityContourXPointer,
    visibilityContourYPointer,
    visibilityContourSignedAreasPointer,
  );
  if (filledVisibilityCounts != visibilityCounts) trap();
  resetArena(visibilityFillMark);
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
  store<u32>(
    contextPointer + Layout.ROUTE_CONTEXT_FLAGS_OFFSET,
    (isMirrored ? Layout.ROUTE_CONTEXT_FLAG_MIRRORED : 0) |
      (stepModelPointer != 0 ? Layout.ROUTE_CONTEXT_FLAG_STEP_MODEL : 0) |
      (isRouteMaskPreprocessed ? Layout.ROUTE_CONTEXT_FLAG_PREPROCESSED_ROUTE_MASK : 0),
  );
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
  store<u32>(
    contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_COMPONENT_STATS_POINTER_OFFSET,
    visibilityComponentStatsPointer,
  );
  store<u32>(
    contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_COMPONENT_STATS_LENGTH_OFFSET,
    visibilityComponentStatsLength,
  );
  store<u32>(
    contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_CONTOUR_OFFSETS_POINTER_OFFSET,
    visibilityContourOffsetsPointer,
  );
  store<u32>(
    contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_CONTOUR_OFFSETS_LENGTH_OFFSET,
    visibilityContourCount + 1,
  );
  store<u32>(
    contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_CONTOUR_COMPONENTS_POINTER_OFFSET,
    visibilityContourComponentsPointer,
  );
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_CONTOUR_X_POINTER_OFFSET, visibilityContourXPointer);
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_CONTOUR_Y_POINTER_OFFSET, visibilityContourYPointer);
  store<u32>(
    contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_CONTOUR_SIGNED_AREAS_POINTER_OFFSET,
    visibilityContourSignedAreasPointer,
  );
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_CONTOUR_COUNT_OFFSET, visibilityContourCount);
  store<u32>(
    contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_CONTOUR_POINT_COUNT_OFFSET,
    visibilityContourPointCount,
  );
  store<u32>(
    contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_PREVIEW_CANDIDATE_LIMIT_OFFSET,
    visibilityPreviewCandidateLimit,
  );
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_PREVIEW_EDGE_LIMIT_OFFSET, visibilityPreviewEdgeLimit);
  store<u32>(
    contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_PREVIEW_EXPANSION_INTERVAL_OFFSET,
    visibilityPreviewExpansionInterval,
  );
  store<u32>(contextPointer + Layout.ROUTE_CONTEXT_STEP_MODEL_POINTER_OFFSET, stepModelPointer);
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
  const flags = load<u32>(pointer + Layout.ROUTE_CONTEXT_FLAGS_OFFSET);
  const stepModelPointer = load<u32>(pointer + Layout.ROUTE_CONTEXT_STEP_MODEL_POINTER_OFFSET);
  if (
    (flags &
      ~(
        Layout.ROUTE_CONTEXT_FLAG_MIRRORED |
        Layout.ROUTE_CONTEXT_FLAG_STEP_MODEL |
        Layout.ROUTE_CONTEXT_FLAG_PREPROCESSED_ROUTE_MASK
      )) !=
      0 ||
    ((flags & Layout.ROUTE_CONTEXT_FLAG_STEP_MODEL) != 0) != (stepModelPointer != 0)
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
  return createQueryResult(
    graphRegionHitsRouteContext(contextPointer, regionMinX, regionMaxX, regionMinY, regionMaxY) ? 1 : 0,
  );
}

/** Conservatively maps one validated Graphwar closed region onto the retained route mask. */
function graphRegionHitsRouteContext(
  contextPointer: u32,
  regionMinX: f64,
  regionMaxX: f64,
  regionMinY: f64,
  regionMaxY: f64,
): bool {
  const boundsMinX = load<f64>(contextPointer + Layout.ROUTE_CONTEXT_MIN_X_OFFSET);
  const boundsMaxX = load<f64>(contextPointer + Layout.ROUTE_CONTEXT_MAX_X_OFFSET);
  const boundsMinY = load<f64>(contextPointer + Layout.ROUTE_CONTEXT_MIN_Y_OFFSET);
  const boundsMaxY = load<f64>(contextPointer + Layout.ROUTE_CONTEXT_MAX_Y_OFFSET);
  const graphMinX = NativeMath.min(boundsMinX, boundsMaxX);
  const graphMaxX = NativeMath.max(boundsMinX, boundsMaxX);
  const graphMinY = NativeMath.min(boundsMinY, boundsMaxY);
  const graphMaxY = NativeMath.max(boundsMinY, boundsMaxY);
  if (regionMinX < graphMinX || regionMaxX > graphMaxX || regionMinY < graphMinY || regionMaxY > graphMaxY) {
    return true;
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
    return true;
  }
  const boundaryInset = normalizeBoundaryInset(
    load<f64>(contextPointer + Layout.ROUTE_CONTEXT_BOUNDARY_EXPANSION_OFFSET),
  );
  if (
    minX < boundaryInset ||
    maxX >= <i32>getPlaneWidth() - boundaryInset ||
    minY < boundaryInset ||
    maxY >= <i32>getPlaneHeight() - boundaryInset
  ) return true;
  return countPlaneRegion(contextPointer, <u32>minX, <u32>maxX, <u32>minY, <u32>maxY) > 0;
}

function createStepTransitionResult(status: u32): u32 {
  const resultPointer = reserveArena(Layout.ROUTE_STEP_TRANSITION_RESULT_BYTE_LENGTH, sizeof<f64>());
  memory.fill(resultPointer, 0, Layout.ROUTE_STEP_TRANSITION_RESULT_BYTE_LENGTH);
  store<u32>(resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_MAGIC_OFFSET, Layout.ROUTE_STEP_TRANSITION_RESULT_MAGIC);
  store<u32>(resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATUS_OFFSET, status);
  return resultPointer;
}

@inline
function storeGraphRegion(
  pointer: u32,
  startX: f64,
  endX: f64,
  startY: f64,
  endY: f64,
): void {
  store<f64>(pointer, NativeMath.min(startX, endX));
  store<f64>(pointer + 8, NativeMath.max(startX, endX));
  store<f64>(pointer + 16, NativeMath.min(startY, endY));
  store<f64>(pointer + 24, NativeMath.max(startY, endY));
}

@inline
function graphRegionRecordHitsRouteContext(contextPointer: u32, pointer: u32): bool {
  return graphRegionHitsRouteContext(
    contextPointer,
    load<f64>(pointer),
    load<f64>(pointer + 8),
    load<f64>(pointer + 16),
    load<f64>(pointer + 24),
  );
}

/** Resolves one canonical Step edge and checks its H/R0/R1 envelope without a JS callback. */
function runStepTransition(inputPointer: u32, inputByteLength: u32): u32 {
  if (inputByteLength != Layout.ROUTE_STEP_TRANSITION_INPUT_BYTE_LENGTH) trap();
  requireArenaRange(inputPointer, inputByteLength, sizeof<f64>());
  const contextPointer = load<u32>(inputPointer + Layout.ROUTE_STEP_TRANSITION_INPUT_CONTEXT_POINTER_OFFSET);
  requireRouteContext(contextPointer);
  const flags = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_FLAGS_OFFSET);
  if ((flags & Layout.ROUTE_CONTEXT_FLAG_STEP_MODEL) == 0) trap();
  const modelPointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_STEP_MODEL_POINTER_OFFSET);
  requireArenaRange(modelPointer, Layout.ROUTE_STEP_MODEL_BYTE_LENGTH, sizeof<f64>());

  const previousX = load<f64>(inputPointer + Layout.ROUTE_STEP_TRANSITION_INPUT_PREVIOUS_X_OFFSET);
  const previousY = load<f64>(inputPointer + Layout.ROUTE_STEP_TRANSITION_INPUT_PREVIOUS_Y_OFFSET);
  const nextX = load<f64>(inputPointer + Layout.ROUTE_STEP_TRANSITION_INPUT_NEXT_X_OFFSET);
  const nextY = load<f64>(inputPointer + Layout.ROUTE_STEP_TRANSITION_INPUT_NEXT_Y_OFFSET);
  const resolvedY = load<f64>(inputPointer + Layout.ROUTE_STEP_TRANSITION_INPUT_RESOLVED_Y_OFFSET);
  const stateSign = load<i32>(inputPointer + Layout.ROUTE_STEP_TRANSITION_INPUT_STATE_SIGN_OFFSET);
  const statePointer = load<u32>(inputPointer + Layout.ROUTE_STEP_TRANSITION_INPUT_STATE_POINTER_OFFSET);
  const stateCount = load<u32>(inputPointer + Layout.ROUTE_STEP_TRANSITION_INPUT_STATE_COUNT_OFFSET);
  if (
    !isFiniteValue(previousX) ||
    !isFiniteValue(previousY) ||
    !isFiniteValue(nextX) ||
    !isFiniteValue(nextY) ||
    !isFiniteValue(resolvedY)
  ) trap();
  if (stateCount > u32.MAX_VALUE / sizeof<u32>()) trap();
  requireArenaRange(stateCount == 0 ? 0 : statePointer, stateCount * sizeof<u32>(), sizeof<u32>());
  if (nextX <= previousX) {
    return createStepTransitionResult(Layout.ROUTE_STEP_TRANSITION_STATUS_NON_FORWARD);
  }

  const formulaSteepness = load<f64>(modelPointer + Layout.ROUTE_STEP_MODEL_FORMULA_STEEPNESS_OFFSET);
  const decimalPlaces = <i32>load<f64>(modelPointer + Layout.ROUTE_STEP_MODEL_DECIMAL_PLACES_OFFSET);
  const equation = <i32>load<f64>(modelPointer + Layout.ROUTE_STEP_MODEL_EQUATION_OFFSET);
  const resolutionPointer = createStepFormulaResolutionFromPlateauState(
    formulaSteepness,
    decimalPlaces,
    equation,
    load<f64>(modelPointer + Layout.ROUTE_STEP_MODEL_ORIGIN_Y_OFFSET),
    resolvedY,
    stateSign,
    statePointer,
    stateCount,
  );
  const transitionPointer = reserveArena(64, sizeof<f64>());
  resolveStepFormulaTransition(resolutionPointer, nextY, 0, false, decimalPlaces, equation, transitionPointer);
  const resolvedStartY = load<f64>(transitionPointer + STEP_TRANSITION_RESOLVED_START_Y_OFFSET);
  const resolvedEndY = load<f64>(transitionPointer + STEP_TRANSITION_RESOLVED_END_Y_OFFSET);
  const effectiveDeltaY = load<f64>(transitionPointer + STEP_TRANSITION_EFFECTIVE_DELTA_Y_OFFSET);
  if (
    load<u32>(transitionPointer + STEP_TRANSITION_IS_VALID_OFFSET) == 0 ||
    !isFiniteValue(resolvedStartY) ||
    !isFiniteValue(resolvedEndY)
  ) return createStepTransitionResult(Layout.ROUTE_STEP_TRANSITION_STATUS_NUMERIC);

  const boundsMinX = load<f64>(contextPointer + Layout.ROUTE_CONTEXT_MIN_X_OFFSET);
  const boundsMaxX = load<f64>(contextPointer + Layout.ROUTE_CONTEXT_MAX_X_OFFSET);
  const boundsMinY = load<f64>(contextPointer + Layout.ROUTE_CONTEXT_MIN_Y_OFFSET);
  const boundsMaxY = load<f64>(contextPointer + Layout.ROUTE_CONTEXT_MAX_Y_OFFSET);
  const availableOffset =
    nextX - previousX - NativeMath.abs(boundsMaxX - boundsMinX) / getGraphwarPlaneLength();
  const requiredProgress =
    1 -
    (NativeMath.abs(boundsMaxY - boundsMinY) *
      load<f64>(modelPointer + Layout.ROUTE_STEP_MODEL_QUALITY_TARGET_PLANE_PIXELS_OFFSET)) /
      getGraphwarPlaneHeight() /
      NativeMath.abs(effectiveDeltaY);
  let centerX = nextX;
  if (
    effectiveDeltaY != 0 &&
    requiredProgress > 0.5 &&
    availableOffset > 0 &&
    isFiniteValue(availableOffset)
  ) {
    const centerOffset = NativeMath.log(requiredProgress / (1 - requiredProgress)) / formulaSteepness;
    centerX = nextX - NativeMath.min(centerOffset, availableOffset);
  }
  centerX = floorFormulaDecimal(centerX, decimalPlaces);
  if (!isFiniteValue(centerX) || centerX > nextX) {
    return createStepTransitionResult(
      isFiniteValue(centerX)
        ? Layout.ROUTE_STEP_TRANSITION_STATUS_CENTER_OUTSIDE_SEGMENT
        : Layout.ROUTE_STEP_TRANSITION_STATUS_NON_FINITE,
    );
  }
  const xs = centerX - (nextX - centerX);
  const ym = resolvedStartY / 2 + resolvedEndY / 2;
  if (!isFiniteValue(xs) || !isFiniteValue(ym)) {
    return createStepTransitionResult(Layout.ROUTE_STEP_TRANSITION_STATUS_NON_FINITE);
  }
  if (xs < previousX) {
    return createStepTransitionResult(Layout.ROUTE_STEP_TRANSITION_STATUS_SYMMETRIC_START_BEFORE_SEGMENT);
  }

  const resultPointer = createStepTransitionResult(Layout.ROUTE_STEP_TRANSITION_STATUS_SUCCESS);
  store<f64>(resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_RESOLVED_START_Y_OFFSET, resolvedStartY);
  store<f64>(resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_RESOLVED_END_Y_OFFSET, resolvedEndY);
  store<f64>(
    resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_SECONDARY_COST_OFFSET,
    NativeMath.abs(nextY - previousY),
  );
  store<f64>(resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_XS_OFFSET, xs);
  store<f64>(resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_YM_OFFSET, ym);
  storeGraphRegion(resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_H_OFFSET, previousX, xs, resolvedStartY, resolvedStartY);
  storeGraphRegion(resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_R0_OFFSET, xs, centerX, resolvedStartY, ym);
  storeGraphRegion(resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_R1_OFFSET, centerX, nextX, ym, resolvedEndY);
  if (
    graphRegionRecordHitsRouteContext(contextPointer, resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_H_OFFSET) ||
    graphRegionRecordHitsRouteContext(contextPointer, resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_R0_OFFSET) ||
    graphRegionRecordHitsRouteContext(contextPointer, resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_R1_OFFSET)
  ) return createStepTransitionResult(Layout.ROUTE_STEP_TRANSITION_STATUS_OBSTACLE);
  store<i32>(
    resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATE_SIGN_OFFSET,
    getStepFormulaResolutionStateSign(resolutionPointer),
  );
  const nextStateCount = getStepFormulaResolutionStateCount(resolutionPointer);
  store<u32>(
    resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATE_POINTER_OFFSET,
    nextStateCount == 0 ? 0 : getStepFormulaResolutionStatePointer(resolutionPointer),
  );
  store<u32>(
    resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATE_COUNT_OFFSET,
    nextStateCount,
  );
  return resultPointer;
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

function createRoutePreviewState(edgeLimit: u32, candidateLimit: u32): u32 {
  const statePointer = reserveArena(ROUTE_PREVIEW_STATE_BYTE_LENGTH, sizeof<u32>());
  memory.fill(statePointer, 0, ROUTE_PREVIEW_STATE_BYTE_LENGTH);
  const acceptedPointer = reserveArena(
    edgeLimit * ROUTE_PREVIEW_ACCEPTED_EDGE_BYTE_LENGTH,
    sizeof<u32>(),
  );
  store<u32>(statePointer + ROUTE_PREVIEW_ACCEPTED_POINTER_OFFSET, acceptedPointer);
  store<u32>(statePointer + ROUTE_PREVIEW_EDGE_LIMIT_OFFSET, edgeLimit);
  store<u32>(statePointer + ROUTE_PREVIEW_CANDIDATE_LIMIT_OFFSET, candidateLimit);
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
  const previewStatePointer =
    shouldCollectPreviews == 0
      ? 0
      : createRoutePreviewState(
          load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_PREVIEW_EDGE_LIMIT_OFFSET),
          load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_PREVIEW_CANDIDATE_LIMIT_OFFSET),
        );
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

const STEP_STATE_CELL_INDEX_OFFSET: u32 = 0;
const STEP_STATE_SIGN_OFFSET: u32 = 4;
const STEP_STATE_LIMB_POINTER_OFFSET: u32 = 8;
const STEP_STATE_LIMB_COUNT_OFFSET: u32 = 12;
const STEP_STATE_DIGIT_POINTER_OFFSET: u32 = 16;
const STEP_STATE_DIGIT_COUNT_OFFSET: u32 = 20;
const STEP_STATE_RESOLVED_Y_OFFSET: u32 = 24;
const STEP_STATE_COST_SEGMENTS_OFFSET: u32 = 32;
const STEP_STATE_IS_CLOSED_OFFSET: u32 = 36;
const STEP_STATE_COST_SECONDARY_OFFSET: u32 = 40;
const STEP_STATE_PARENT_INDEX_OFFSET: u32 = 48;
const STEP_STATE_BYTE_LENGTH: u32 = 56;
const STEP_STATE_TABLE_RECORDS_POINTER_OFFSET: u32 = 0;
const STEP_STATE_TABLE_COUNT_OFFSET: u32 = 4;
const STEP_STATE_TABLE_RECORD_CAPACITY_OFFSET: u32 = 8;
const STEP_STATE_TABLE_BUCKETS_POINTER_OFFSET: u32 = 12;
const STEP_STATE_TABLE_BUCKET_CAPACITY_OFFSET: u32 = 16;
const STEP_STATE_TABLE_BYTE_LENGTH: u32 = 24;
const STEP_STATE_MISSING_INDEX: u32 = u32.MAX_VALUE;

@inline
function stepStateRecordPointer(tablePointer: u32, index: u32): u32 {
  return load<u32>(tablePointer + STEP_STATE_TABLE_RECORDS_POINTER_OFFSET) + index * STEP_STATE_BYTE_LENGTH;
}

@inline
function mixStepStateHash(hash: u32, value: u32): u32 {
  return (hash ^ value) * 0x0100_0193;
}

function hashStepStateKey(cellIndex: u32, sign: i32, limbPointer: u32, limbCount: u32): u32 {
  let hash: u32 = mixStepStateHash(0x811c_9dc5, cellIndex);
  hash = mixStepStateHash(hash, <u32>(sign + 1));
  hash = mixStepStateHash(hash, limbCount);
  let index: u32 = 0;
  while (index < limbCount) {
    hash = mixStepStateHash(hash, load<u32>(limbPointer + index * sizeof<u32>()));
    index += 1;
  }
  return hash;
}

function stepStateKeyEquals(
  recordPointer: u32,
  cellIndex: u32,
  sign: i32,
  limbPointer: u32,
  limbCount: u32,
): bool {
  if (
    load<u32>(recordPointer + STEP_STATE_CELL_INDEX_OFFSET) != cellIndex ||
    load<i32>(recordPointer + STEP_STATE_SIGN_OFFSET) != sign ||
    load<u32>(recordPointer + STEP_STATE_LIMB_COUNT_OFFSET) != limbCount
  ) return false;
  const recordLimbPointer = load<u32>(recordPointer + STEP_STATE_LIMB_POINTER_OFFSET);
  let index: u32 = 0;
  while (index < limbCount) {
    if (
      load<u32>(recordLimbPointer + index * sizeof<u32>()) !=
      load<u32>(limbPointer + index * sizeof<u32>())
    ) return false;
    index += 1;
  }
  return true;
}

function createStepStateTable(): u32 {
  const tablePointer = reserveArena(STEP_STATE_TABLE_BYTE_LENGTH, sizeof<u32>());
  const recordCapacity: u32 = 64;
  const bucketCapacity: u32 = 128;
  const recordsPointer = reserveArena(recordCapacity * STEP_STATE_BYTE_LENGTH, sizeof<f64>());
  const bucketsPointer = reserveArena(bucketCapacity * sizeof<u32>(), sizeof<u32>());
  memory.fill(bucketsPointer, 0, bucketCapacity * sizeof<u32>());
  store<u32>(tablePointer + STEP_STATE_TABLE_RECORDS_POINTER_OFFSET, recordsPointer);
  store<u32>(tablePointer + STEP_STATE_TABLE_COUNT_OFFSET, 0);
  store<u32>(tablePointer + STEP_STATE_TABLE_RECORD_CAPACITY_OFFSET, recordCapacity);
  store<u32>(tablePointer + STEP_STATE_TABLE_BUCKETS_POINTER_OFFSET, bucketsPointer);
  store<u32>(tablePointer + STEP_STATE_TABLE_BUCKET_CAPACITY_OFFSET, bucketCapacity);
  return tablePointer;
}

function growStepStateRecords(tablePointer: u32): void {
  const capacity = load<u32>(tablePointer + STEP_STATE_TABLE_RECORD_CAPACITY_OFFSET);
  const nextCapacity = capacity * 2;
  if (nextCapacity <= capacity || nextCapacity > u32.MAX_VALUE / STEP_STATE_BYTE_LENGTH) trap();
  const nextPointer = reserveArena(nextCapacity * STEP_STATE_BYTE_LENGTH, sizeof<f64>());
  const count = load<u32>(tablePointer + STEP_STATE_TABLE_COUNT_OFFSET);
  memory.copy(
    nextPointer,
    load<u32>(tablePointer + STEP_STATE_TABLE_RECORDS_POINTER_OFFSET),
    count * STEP_STATE_BYTE_LENGTH,
  );
  store<u32>(tablePointer + STEP_STATE_TABLE_RECORDS_POINTER_OFFSET, nextPointer);
  store<u32>(tablePointer + STEP_STATE_TABLE_RECORD_CAPACITY_OFFSET, nextCapacity);
}

function insertStepStateBucket(tablePointer: u32, recordIndex: u32): void {
  const recordPointer = stepStateRecordPointer(tablePointer, recordIndex);
  const capacity = load<u32>(tablePointer + STEP_STATE_TABLE_BUCKET_CAPACITY_OFFSET);
  const bucketsPointer = load<u32>(tablePointer + STEP_STATE_TABLE_BUCKETS_POINTER_OFFSET);
  let bucket = hashStepStateKey(
    load<u32>(recordPointer + STEP_STATE_CELL_INDEX_OFFSET),
    load<i32>(recordPointer + STEP_STATE_SIGN_OFFSET),
    load<u32>(recordPointer + STEP_STATE_LIMB_POINTER_OFFSET),
    load<u32>(recordPointer + STEP_STATE_LIMB_COUNT_OFFSET),
  ) & (capacity - 1);
  while (load<u32>(bucketsPointer + bucket * sizeof<u32>()) != 0) {
    bucket = (bucket + 1) & (capacity - 1);
  }
  store<u32>(bucketsPointer + bucket * sizeof<u32>(), recordIndex + 1);
}

function growStepStateBuckets(tablePointer: u32): void {
  const capacity = load<u32>(tablePointer + STEP_STATE_TABLE_BUCKET_CAPACITY_OFFSET);
  const nextCapacity = capacity * 2;
  if (nextCapacity <= capacity || nextCapacity > u32.MAX_VALUE / sizeof<u32>()) trap();
  const nextPointer = reserveArena(nextCapacity * sizeof<u32>(), sizeof<u32>());
  memory.fill(nextPointer, 0, nextCapacity * sizeof<u32>());
  store<u32>(tablePointer + STEP_STATE_TABLE_BUCKETS_POINTER_OFFSET, nextPointer);
  store<u32>(tablePointer + STEP_STATE_TABLE_BUCKET_CAPACITY_OFFSET, nextCapacity);
  const count = load<u32>(tablePointer + STEP_STATE_TABLE_COUNT_OFFSET);
  let index: u32 = 0;
  while (index < count) {
    insertStepStateBucket(tablePointer, index);
    index += 1;
  }
}

function findStepStateIndex(
  tablePointer: u32,
  cellIndex: u32,
  sign: i32,
  limbPointer: u32,
  limbCount: u32,
): u32 {
  const capacity = load<u32>(tablePointer + STEP_STATE_TABLE_BUCKET_CAPACITY_OFFSET);
  const bucketsPointer = load<u32>(tablePointer + STEP_STATE_TABLE_BUCKETS_POINTER_OFFSET);
  let bucket = hashStepStateKey(cellIndex, sign, limbPointer, limbCount) & (capacity - 1);
  while (true) {
    const encodedIndex = load<u32>(bucketsPointer + bucket * sizeof<u32>());
    if (encodedIndex == 0) return STEP_STATE_MISSING_INDEX;
    const recordIndex = encodedIndex - 1;
    if (stepStateKeyEquals(stepStateRecordPointer(tablePointer, recordIndex), cellIndex, sign, limbPointer, limbCount)) {
      return recordIndex;
    }
    bucket = (bucket + 1) & (capacity - 1);
  }
}

function appendStepState(
  tablePointer: u32,
  cellIndex: u32,
  sign: i32,
  limbPointer: u32,
  limbCount: u32,
  resolvedY: f64,
  costSegments: u32,
  costSecondary: f64,
  parentIndex: u32,
): u32 {
  let count = load<u32>(tablePointer + STEP_STATE_TABLE_COUNT_OFFSET);
  if (count == load<u32>(tablePointer + STEP_STATE_TABLE_RECORD_CAPACITY_OFFSET)) {
    growStepStateRecords(tablePointer);
  }
  if ((<u64>(count + 1) * 4) >= <u64>load<u32>(tablePointer + STEP_STATE_TABLE_BUCKET_CAPACITY_OFFSET) * 3) {
    growStepStateBuckets(tablePointer);
  }
  if (limbCount > (u32.MAX_VALUE - 1) / 10) trap();
  const digitCapacity: u32 = limbCount == 0 ? 1 : limbCount * 10 + 1;
  const digitPointer = reserveArena(digitCapacity, 1);
  const serializationMark = markArena();
  const digitCount = serializeMagnitudeDecimal(limbPointer, limbCount, digitPointer, digitCapacity);
  resetArena(serializationMark);
  const recordPointer = stepStateRecordPointer(tablePointer, count);
  memory.fill(recordPointer, 0, STEP_STATE_BYTE_LENGTH);
  store<u32>(recordPointer + STEP_STATE_CELL_INDEX_OFFSET, cellIndex);
  store<i32>(recordPointer + STEP_STATE_SIGN_OFFSET, sign);
  store<u32>(recordPointer + STEP_STATE_LIMB_POINTER_OFFSET, limbCount == 0 ? 0 : limbPointer);
  store<u32>(recordPointer + STEP_STATE_LIMB_COUNT_OFFSET, limbCount);
  store<u32>(recordPointer + STEP_STATE_DIGIT_POINTER_OFFSET, digitPointer);
  store<u32>(recordPointer + STEP_STATE_DIGIT_COUNT_OFFSET, digitCount);
  store<f64>(recordPointer + STEP_STATE_RESOLVED_Y_OFFSET, resolvedY);
  store<u32>(recordPointer + STEP_STATE_COST_SEGMENTS_OFFSET, costSegments);
  store<f64>(recordPointer + STEP_STATE_COST_SECONDARY_OFFSET, costSecondary);
  store<u32>(recordPointer + STEP_STATE_PARENT_INDEX_OFFSET, parentIndex);
  store<u32>(tablePointer + STEP_STATE_TABLE_COUNT_OFFSET, count + 1);
  insertStepStateBucket(tablePointer, count);
  return count;
}

@inline
function stepSecondaryValuesAreNearlyEqual(left: f64, right: f64): bool {
  return NativeMath.abs(left - right) <= f64.EPSILON * NativeMath.max(1, NativeMath.max(NativeMath.abs(left), NativeMath.abs(right)));
}

@inline
function compareStepCosts(leftSegments: u32, leftSecondary: f64, rightSegments: u32, rightSecondary: f64): i32 {
  if (leftSegments != rightSegments) return leftSegments < rightSegments ? -1 : 1;
  if (stepSecondaryValuesAreNearlyEqual(leftSecondary, rightSecondary)) return 0;
  return leftSecondary < rightSecondary ? -1 : 1;
}

function compareStepRouteKeys(leftRecordPointer: u32, rightRecordPointer: u32): i32 {
  const leftSign = load<i32>(leftRecordPointer + STEP_STATE_SIGN_OFFSET);
  const rightSign = load<i32>(rightRecordPointer + STEP_STATE_SIGN_OFFSET);
  if ((leftSign < 0) != (rightSign < 0)) return leftSign < 0 ? -1 : 1;
  const leftPointer = load<u32>(leftRecordPointer + STEP_STATE_DIGIT_POINTER_OFFSET);
  const rightPointer = load<u32>(rightRecordPointer + STEP_STATE_DIGIT_POINTER_OFFSET);
  const leftCount = load<u32>(leftRecordPointer + STEP_STATE_DIGIT_COUNT_OFFSET);
  const rightCount = load<u32>(rightRecordPointer + STEP_STATE_DIGIT_COUNT_OFFSET);
  const commonCount = leftCount < rightCount ? leftCount : rightCount;
  let index: u32 = 0;
  while (index < commonCount) {
    const left = load<u8>(leftPointer + index);
    const right = load<u8>(rightPointer + index);
    if (left != right) return left < right ? -1 : 1;
    index += 1;
  }
  return leftCount < rightCount ? -1 : leftCount > rightCount ? 1 : 0;
}

@inline
function decimalDivisor(value: u32): u32 {
  let divisor: u32 = 1;
  while (value / divisor >= 10) divisor *= 10;
  return divisor;
}

/** Compares the decimal index prefix with the same prefix-first collation used by String#localeCompare. */
function compareStepParentCellKeys(left: u32, right: u32): i32 {
  let leftDivisor = decimalDivisor(left);
  let rightDivisor = decimalDivisor(right);
  while (true) {
    const leftDigit = left / leftDivisor;
    const rightDigit = right / rightDivisor;
    if (leftDigit != rightDigit) return leftDigit < rightDigit ? -1 : 1;
    left %= leftDivisor;
    right %= rightDivisor;
    if (leftDivisor == 1 || rightDivisor == 1) break;
    leftDivisor /= 10;
    rightDivisor /= 10;
  }
  if (leftDivisor == 1 && rightDivisor != 1) return -1;
  if (leftDivisor != 1 && rightDivisor == 1) return 1;
  return 0;
}

function compareStepParentKeys(tablePointer: u32, leftIndex: u32, rightIndex: u32): i32 {
  const leftPointer = stepStateRecordPointer(tablePointer, leftIndex);
  const rightPointer = stepStateRecordPointer(tablePointer, rightIndex);
  const cellComparison = compareStepParentCellKeys(
    load<u32>(leftPointer + STEP_STATE_CELL_INDEX_OFFSET),
    load<u32>(rightPointer + STEP_STATE_CELL_INDEX_OFFSET),
  );
  return cellComparison != 0 ? cellComparison : compareStepRouteKeys(leftPointer, rightPointer);
}

const STEP_HEAP_STATE_INDEX_OFFSET: u32 = 0;
const STEP_HEAP_PARENT_INDEX_OFFSET: u32 = 4;
const STEP_HEAP_ESTIMATED_SEGMENTS_OFFSET: u32 = 8;
const STEP_HEAP_COST_SEGMENTS_OFFSET: u32 = 12;
const STEP_HEAP_ESTIMATED_SECONDARY_OFFSET: u32 = 16;
const STEP_HEAP_COST_SECONDARY_OFFSET: u32 = 24;
const STEP_HEAP_RESOLVED_Y_OFFSET: u32 = 32;
const STEP_HEAP_NODE_BYTE_LENGTH: u32 = 40;
const STEP_HEAP_NODES_POINTER_OFFSET: u32 = 0;
const STEP_HEAP_LENGTH_OFFSET: u32 = 4;
const STEP_HEAP_CAPACITY_OFFSET: u32 = 8;
const STEP_HEAP_TABLE_POINTER_OFFSET: u32 = 12;
const STEP_HEAP_BYTE_LENGTH: u32 = 16;

@inline
function stepHeapNodePointer(heapPointer: u32, index: u32): u32 {
  return load<u32>(heapPointer + STEP_HEAP_NODES_POINTER_OFFSET) + index * STEP_HEAP_NODE_BYTE_LENGTH;
}

function compareStepHeapNodes(heapPointer: u32, leftPointer: u32, rightPointer: u32): i32 {
  let comparison = compareStepCosts(
    load<u32>(leftPointer + STEP_HEAP_ESTIMATED_SEGMENTS_OFFSET),
    load<f64>(leftPointer + STEP_HEAP_ESTIMATED_SECONDARY_OFFSET),
    load<u32>(rightPointer + STEP_HEAP_ESTIMATED_SEGMENTS_OFFSET),
    load<f64>(rightPointer + STEP_HEAP_ESTIMATED_SECONDARY_OFFSET),
  );
  if (comparison != 0) return comparison;
  comparison = compareStepCosts(
    load<u32>(leftPointer + STEP_HEAP_COST_SEGMENTS_OFFSET),
    load<f64>(leftPointer + STEP_HEAP_COST_SECONDARY_OFFSET),
    load<u32>(rightPointer + STEP_HEAP_COST_SEGMENTS_OFFSET),
    load<f64>(rightPointer + STEP_HEAP_COST_SECONDARY_OFFSET),
  );
  if (comparison != 0) return comparison;
  const tablePointer = load<u32>(heapPointer + STEP_HEAP_TABLE_POINTER_OFFSET);
  const leftStatePointer = stepStateRecordPointer(
    tablePointer,
    load<u32>(leftPointer + STEP_HEAP_STATE_INDEX_OFFSET),
  );
  const rightStatePointer = stepStateRecordPointer(
    tablePointer,
    load<u32>(rightPointer + STEP_HEAP_STATE_INDEX_OFFSET),
  );
  const leftCell = load<u32>(leftStatePointer + STEP_STATE_CELL_INDEX_OFFSET);
  const rightCell = load<u32>(rightStatePointer + STEP_STATE_CELL_INDEX_OFFSET);
  if (leftCell != rightCell) return leftCell < rightCell ? -1 : 1;
  const leftResolvedY = load<f64>(leftPointer + STEP_HEAP_RESOLVED_Y_OFFSET);
  const rightResolvedY = load<f64>(rightPointer + STEP_HEAP_RESOLVED_Y_OFFSET);
  if (leftResolvedY < rightResolvedY) return -1;
  if (leftResolvedY > rightResolvedY) return 1;
  comparison = compareStepRouteKeys(leftStatePointer, rightStatePointer);
  if (comparison != 0) return comparison;
  return compareStepParentKeys(
    tablePointer,
    load<u32>(leftPointer + STEP_HEAP_PARENT_INDEX_OFFSET),
    load<u32>(rightPointer + STEP_HEAP_PARENT_INDEX_OFFSET),
  );
}

function swapStepHeapNodes(leftPointer: u32, rightPointer: u32): void {
  let offset: u32 = 0;
  while (offset < STEP_HEAP_NODE_BYTE_LENGTH) {
    const temporary = load<u64>(leftPointer + offset);
    store<u64>(leftPointer + offset, load<u64>(rightPointer + offset));
    store<u64>(rightPointer + offset, temporary);
    offset += sizeof<u64>();
  }
}

function growStepHeap(heapPointer: u32): void {
  const capacity = load<u32>(heapPointer + STEP_HEAP_CAPACITY_OFFSET);
  const nextCapacity: u32 = capacity == 0 ? 64 : capacity * 2;
  if (nextCapacity <= capacity || nextCapacity > u32.MAX_VALUE / STEP_HEAP_NODE_BYTE_LENGTH) trap();
  const nextPointer = reserveArena(nextCapacity * STEP_HEAP_NODE_BYTE_LENGTH, sizeof<f64>());
  const length = load<u32>(heapPointer + STEP_HEAP_LENGTH_OFFSET);
  if (length > 0) {
    memory.copy(
      nextPointer,
      load<u32>(heapPointer + STEP_HEAP_NODES_POINTER_OFFSET),
      length * STEP_HEAP_NODE_BYTE_LENGTH,
    );
  }
  store<u32>(heapPointer + STEP_HEAP_NODES_POINTER_OFFSET, nextPointer);
  store<u32>(heapPointer + STEP_HEAP_CAPACITY_OFFSET, nextCapacity);
}

function pushStepHeap(
  heapPointer: u32,
  stateIndex: u32,
  parentIndex: u32,
  estimatedSegments: u32,
  estimatedSecondary: f64,
  costSegments: u32,
  costSecondary: f64,
  resolvedY: f64,
): void {
  let length = load<u32>(heapPointer + STEP_HEAP_LENGTH_OFFSET);
  if (length == load<u32>(heapPointer + STEP_HEAP_CAPACITY_OFFSET)) growStepHeap(heapPointer);
  let nodePointer = stepHeapNodePointer(heapPointer, length);
  store<u32>(nodePointer + STEP_HEAP_STATE_INDEX_OFFSET, stateIndex);
  store<u32>(nodePointer + STEP_HEAP_PARENT_INDEX_OFFSET, parentIndex);
  store<u32>(nodePointer + STEP_HEAP_ESTIMATED_SEGMENTS_OFFSET, estimatedSegments);
  store<u32>(nodePointer + STEP_HEAP_COST_SEGMENTS_OFFSET, costSegments);
  store<f64>(nodePointer + STEP_HEAP_ESTIMATED_SECONDARY_OFFSET, estimatedSecondary);
  store<f64>(nodePointer + STEP_HEAP_COST_SECONDARY_OFFSET, costSecondary);
  store<f64>(nodePointer + STEP_HEAP_RESOLVED_Y_OFFSET, resolvedY);
  length += 1;
  store<u32>(heapPointer + STEP_HEAP_LENGTH_OFFSET, length);
  let nodeIndex = length - 1;
  while (nodeIndex > 0) {
    const parentNodeIndex = (nodeIndex - 1) / 2;
    nodePointer = stepHeapNodePointer(heapPointer, nodeIndex);
    const parentPointer = stepHeapNodePointer(heapPointer, parentNodeIndex);
    if (compareStepHeapNodes(heapPointer, nodePointer, parentPointer) >= 0) break;
    swapStepHeapNodes(nodePointer, parentPointer);
    nodeIndex = parentNodeIndex;
  }
}

function popStepHeap(heapPointer: u32, outputPointer: u32): bool {
  let length = load<u32>(heapPointer + STEP_HEAP_LENGTH_OFFSET);
  if (length == 0) return false;
  const rootPointer = stepHeapNodePointer(heapPointer, 0);
  memory.copy(outputPointer, rootPointer, STEP_HEAP_NODE_BYTE_LENGTH);
  length -= 1;
  store<u32>(heapPointer + STEP_HEAP_LENGTH_OFFSET, length);
  if (length == 0) return true;
  memory.copy(rootPointer, stepHeapNodePointer(heapPointer, length), STEP_HEAP_NODE_BYTE_LENGTH);
  let nodeIndex: u32 = 0;
  while (true) {
    const leftIndex = nodeIndex * 2 + 1;
    if (leftIndex >= length) break;
    const rightIndex = leftIndex + 1;
    let bestIndex = nodeIndex;
    if (
      compareStepHeapNodes(
        heapPointer,
        stepHeapNodePointer(heapPointer, leftIndex),
        stepHeapNodePointer(heapPointer, bestIndex),
      ) < 0
    ) bestIndex = leftIndex;
    if (
      rightIndex < length &&
      compareStepHeapNodes(
        heapPointer,
        stepHeapNodePointer(heapPointer, rightIndex),
        stepHeapNodePointer(heapPointer, bestIndex),
      ) < 0
    ) bestIndex = rightIndex;
    if (bestIndex == nodeIndex) break;
    const nodePointer = stepHeapNodePointer(heapPointer, nodeIndex);
    const bestPointer = stepHeapNodePointer(heapPointer, bestIndex);
    swapStepHeapNodes(nodePointer, bestPointer);
    nodeIndex = bestIndex;
  }
  return true;
}

@inline
function stepGraphXForCell(
  contextPointer: u32,
  cellIndex: u32,
  startIndex: u32,
  targetIndex: u32,
  exactStartX: f64,
  exactTargetX: f64,
): f64 {
  if (cellIndex == startIndex) return exactStartX;
  if (cellIndex == targetIndex) return exactTargetX;
  const gridX = cellIndex % getPlaneWidth();
  const physicalX =
    (load<u32>(contextPointer + Layout.ROUTE_CONTEXT_FLAGS_OFFSET) & Layout.ROUTE_CONTEXT_FLAG_MIRRORED) == 0
      ? gridX
      : getPlaneWidth() - 1 - gridX;
  const minimum = load<f64>(contextPointer + Layout.ROUTE_CONTEXT_MIN_X_OFFSET);
  const maximum = load<f64>(contextPointer + Layout.ROUTE_CONTEXT_MAX_X_OFFSET);
  return minimum + ((<f64>physicalX + 0.5) / getGraphwarPlaneLength()) * (maximum - minimum);
}

@inline
function stepGraphYForCell(
  contextPointer: u32,
  cellIndex: u32,
  startIndex: u32,
  targetIndex: u32,
  exactStartY: f64,
  exactTargetY: f64,
): f64 {
  if (cellIndex == startIndex) return exactStartY;
  if (cellIndex == targetIndex) return exactTargetY;
  const maximum = load<f64>(contextPointer + Layout.ROUTE_CONTEXT_MAX_Y_OFFSET);
  const minimum = load<f64>(contextPointer + Layout.ROUTE_CONTEXT_MIN_Y_OFFSET);
  return maximum - ((<f64>(cellIndex / getPlaneWidth()) + 0.5) / getGraphwarPlaneHeight()) * (maximum - minimum);
}

function runStepSearchEdgeTransition(
  contextPointer: u32,
  fromCellIndex: u32,
  nextCellIndex: u32,
  startIndex: u32,
  targetIndex: u32,
  exactStartX: f64,
  exactStartY: f64,
  exactTargetX: f64,
  exactTargetY: f64,
  resolvedY: f64,
  stateSign: i32,
  statePointer: u32,
  stateCount: u32,
): u32 {
  const inputPointer = reserveArena(Layout.ROUTE_STEP_TRANSITION_INPUT_BYTE_LENGTH, sizeof<f64>());
  store<u32>(inputPointer + Layout.ROUTE_STEP_TRANSITION_INPUT_CONTEXT_POINTER_OFFSET, contextPointer);
  store<f64>(
    inputPointer + Layout.ROUTE_STEP_TRANSITION_INPUT_PREVIOUS_X_OFFSET,
    stepGraphXForCell(contextPointer, fromCellIndex, startIndex, targetIndex, exactStartX, exactTargetX),
  );
  store<f64>(
    inputPointer + Layout.ROUTE_STEP_TRANSITION_INPUT_PREVIOUS_Y_OFFSET,
    stepGraphYForCell(contextPointer, fromCellIndex, startIndex, targetIndex, exactStartY, exactTargetY),
  );
  store<f64>(
    inputPointer + Layout.ROUTE_STEP_TRANSITION_INPUT_NEXT_X_OFFSET,
    stepGraphXForCell(contextPointer, nextCellIndex, startIndex, targetIndex, exactStartX, exactTargetX),
  );
  store<f64>(
    inputPointer + Layout.ROUTE_STEP_TRANSITION_INPUT_NEXT_Y_OFFSET,
    stepGraphYForCell(contextPointer, nextCellIndex, startIndex, targetIndex, exactStartY, exactTargetY),
  );
  store<f64>(inputPointer + Layout.ROUTE_STEP_TRANSITION_INPUT_RESOLVED_Y_OFFSET, resolvedY);
  store<i32>(inputPointer + Layout.ROUTE_STEP_TRANSITION_INPUT_STATE_SIGN_OFFSET, stateSign);
  store<u32>(inputPointer + Layout.ROUTE_STEP_TRANSITION_INPUT_STATE_POINTER_OFFSET, statePointer);
  store<u32>(inputPointer + Layout.ROUTE_STEP_TRANSITION_INPUT_STATE_COUNT_OFFSET, stateCount);
  return runStepTransition(inputPointer, Layout.ROUTE_STEP_TRANSITION_INPUT_BYTE_LENGTH);
}

function pushStepState(
  contextPointer: u32,
  tablePointer: u32,
  heapPointer: u32,
  stateIndex: u32,
  targetIndex: u32,
  exactStartY: f64,
  exactTargetY: f64,
  startIndex: u32,
): void {
  const statePointer = stepStateRecordPointer(tablePointer, stateIndex);
  const cellIndex = load<u32>(statePointer + STEP_STATE_CELL_INDEX_OFFSET);
  const costSegments = load<u32>(statePointer + STEP_STATE_COST_SEGMENTS_OFFSET);
  const costSecondary = load<f64>(statePointer + STEP_STATE_COST_SECONDARY_OFFSET);
  const isTarget = cellIndex == targetIndex;
  pushStepHeap(
    heapPointer,
    stateIndex,
    load<u32>(statePointer + STEP_STATE_PARENT_INDEX_OFFSET),
    isTarget ? costSegments : costSegments + 1,
    isTarget
      ? costSecondary
      : costSecondary +
        NativeMath.abs(
          stepGraphYForCell(contextPointer, targetIndex, startIndex, targetIndex, exactStartY, exactTargetY) -
          stepGraphYForCell(contextPointer, cellIndex, startIndex, targetIndex, exactStartY, exactTargetY),
        ),
    costSegments,
    costSecondary,
    load<f64>(statePointer + STEP_STATE_RESOLVED_Y_OFFSET),
  );
}

function relaxStepSearchTransition(
  contextPointer: u32,
  tablePointer: u32,
  heapPointer: u32,
  previewStatePointer: u32,
  fromStateIndex: u32,
  nextCellIndex: u32,
  startIndex: u32,
  targetIndex: u32,
  exactStartX: f64,
  exactStartY: f64,
  exactTargetX: f64,
  exactTargetY: f64,
): void {
  const fromStatePointer = stepStateRecordPointer(tablePointer, fromStateIndex);
  const fromCellIndex = load<u32>(fromStatePointer + STEP_STATE_CELL_INDEX_OFFSET);
  const width = getPlaneWidth();
  if (nextCellIndex % width <= fromCellIndex % width) return;
  const edgeMark = markArena();
  const resultPointer = runStepSearchEdgeTransition(
    contextPointer,
    fromCellIndex,
    nextCellIndex,
    startIndex,
    targetIndex,
    exactStartX,
    exactStartY,
    exactTargetX,
    exactTargetY,
    load<f64>(fromStatePointer + STEP_STATE_RESOLVED_Y_OFFSET),
    load<i32>(fromStatePointer + STEP_STATE_SIGN_OFFSET),
    load<u32>(fromStatePointer + STEP_STATE_LIMB_POINTER_OFFSET),
    load<u32>(fromStatePointer + STEP_STATE_LIMB_COUNT_OFFSET),
  );
  if (load<u32>(resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATUS_OFFSET) != Layout.ROUTE_STEP_TRANSITION_STATUS_SUCCESS) {
    resetArena(edgeMark);
    return;
  }
  const nextSign = load<i32>(resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATE_SIGN_OFFSET);
  const nextStatePointer = load<u32>(resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATE_POINTER_OFFSET);
  const nextStateCount = load<u32>(resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATE_COUNT_OFFSET);
  const nextResolvedY = load<f64>(resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_RESOLVED_END_Y_OFFSET);
  const nextSegments = load<u32>(fromStatePointer + STEP_STATE_COST_SEGMENTS_OFFSET) + 1;
  const nextSecondary =
    load<f64>(fromStatePointer + STEP_STATE_COST_SECONDARY_OFFSET) +
    load<f64>(resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_SECONDARY_COST_OFFSET);
  let nextStateIndex = findStepStateIndex(
    tablePointer,
    nextCellIndex,
    nextSign,
    nextStatePointer,
    nextStateCount,
  );
  if (nextStateIndex != STEP_STATE_MISSING_INDEX) {
    const previousPointer = stepStateRecordPointer(tablePointer, nextStateIndex);
    if (
      compareStepCosts(
        load<u32>(previousPointer + STEP_STATE_COST_SEGMENTS_OFFSET),
        load<f64>(previousPointer + STEP_STATE_COST_SECONDARY_OFFSET),
        nextSegments,
        nextSecondary,
      ) <= 0
    ) {
      resetArena(edgeMark);
      return;
    }
    resetArena(edgeMark);
    const refreshedPointer = stepStateRecordPointer(tablePointer, nextStateIndex);
    store<f64>(refreshedPointer + STEP_STATE_RESOLVED_Y_OFFSET, nextResolvedY);
    store<u32>(refreshedPointer + STEP_STATE_COST_SEGMENTS_OFFSET, nextSegments);
    store<u32>(refreshedPointer + STEP_STATE_IS_CLOSED_OFFSET, 0);
    store<f64>(refreshedPointer + STEP_STATE_COST_SECONDARY_OFFSET, nextSecondary);
    store<u32>(refreshedPointer + STEP_STATE_PARENT_INDEX_OFFSET, fromStateIndex);
  } else {
    nextStateIndex = appendStepState(
      tablePointer,
      nextCellIndex,
      nextSign,
      nextStatePointer,
      nextStateCount,
      nextResolvedY,
      nextSegments,
      nextSecondary,
      fromStateIndex,
    );
    commitArena(edgeMark);
  }
  pushStepState(
    contextPointer,
    tablePointer,
    heapPointer,
    nextStateIndex,
    targetIndex,
    exactStartY,
    exactTargetY,
    startIndex,
  );
  if (previewStatePointer != 0) {
    appendRoutePreviewAcceptedEdge(
      previewStatePointer,
      <i32>(fromCellIndex % width),
      <i32>(fromCellIndex / width),
      <i32>(nextCellIndex % width),
      <i32>(nextCellIndex / width),
    );
  }
}

function relaxStepSearchNeighbor(
  contextPointer: u32,
  tablePointer: u32,
  heapPointer: u32,
  previewStatePointer: u32,
  currentStateIndex: u32,
  nextCellIndex: u32,
  startIndex: u32,
  targetIndex: u32,
  exactStartX: f64,
  exactStartY: f64,
  exactTargetX: f64,
  exactTargetY: f64,
): void {
  const currentPointer = stepStateRecordPointer(tablePointer, currentStateIndex);
  const currentCellIndex = load<u32>(currentPointer + STEP_STATE_CELL_INDEX_OFFSET);
  const parentIndex = load<u32>(currentPointer + STEP_STATE_PARENT_INDEX_OFFSET);
  relaxStepSearchTransition(
    contextPointer,
    tablePointer,
    heapPointer,
    previewStatePointer,
    currentStateIndex,
    nextCellIndex,
    startIndex,
    targetIndex,
    exactStartX,
    exactStartY,
    exactTargetX,
    exactTargetY,
  );
  if (
    load<u32>(stepStateRecordPointer(tablePointer, parentIndex) + STEP_STATE_CELL_INDEX_OFFSET) !=
    currentCellIndex
  ) {
    relaxStepSearchTransition(
      contextPointer,
      tablePointer,
      heapPointer,
      previewStatePointer,
      parentIndex,
      nextCellIndex,
      startIndex,
      targetIndex,
      exactStartX,
      exactStartY,
      exactTargetX,
      exactTargetY,
    );
  }
}

function createStepStatePath(tablePointer: u32, targetStateIndex: u32): u32 {
  const stateCount = load<u32>(tablePointer + STEP_STATE_TABLE_COUNT_OFFSET);
  let pathLength: u32 = 0;
  let stateIndex = targetStateIndex;
  while (pathLength <= stateCount) {
    pathLength += 1;
    const statePointer = stepStateRecordPointer(tablePointer, stateIndex);
    const parentIndex = load<u32>(statePointer + STEP_STATE_PARENT_INDEX_OFFSET);
    if (parentIndex == stateIndex) break;
    stateIndex = parentIndex;
  }
  if (pathLength > stateCount) trap();
  const pathXPointer = reserveArena(pathLength * sizeof<f64>(), sizeof<f64>());
  const pathYPointer = reserveArena(pathLength * sizeof<f64>(), sizeof<f64>());
  stateIndex = targetStateIndex;
  let outputIndex = pathLength;
  const width = getPlaneWidth();
  while (outputIndex > 0) {
    outputIndex -= 1;
    const statePointer = stepStateRecordPointer(tablePointer, stateIndex);
    const cellIndex = load<u32>(statePointer + STEP_STATE_CELL_INDEX_OFFSET);
    store<f64>(pathXPointer + outputIndex * sizeof<f64>(), <f64>(cellIndex % width));
    store<f64>(pathYPointer + outputIndex * sizeof<f64>(), <f64>(cellIndex / width));
    const parentIndex = load<u32>(statePointer + STEP_STATE_PARENT_INDEX_OFFSET);
    if (parentIndex == stateIndex) break;
    stateIndex = parentIndex;
  }
  const pathPointer = reserveArena(12, sizeof<u32>());
  store<u32>(pathPointer, pathXPointer);
  store<u32>(pathPointer + 4, pathYPointer);
  store<u32>(pathPointer + 8, pathLength);
  return pathPointer;
}

const STEP_SIMPLIFIED_PATH_POINTER_OFFSET: u32 = 0;
const STEP_SIMPLIFIED_TERMINAL_RESOLVED_Y_OFFSET: u32 = 16;
const STEP_SIMPLIFIED_TERMINAL_SIGN_OFFSET: u32 = 24;
const STEP_SIMPLIFIED_TERMINAL_LIMB_POINTER_OFFSET: u32 = 28;
const STEP_SIMPLIFIED_TERMINAL_LIMB_COUNT_OFFSET: u32 = 32;
const STEP_SIMPLIFIED_BYTE_LENGTH: u32 = 40;

function createSimplifiedStepPath(
  contextPointer: u32,
  tablePointer: u32,
  rawPathPointer: u32,
  startStateIndex: u32,
  targetStateIndex: u32,
  startIndex: u32,
  targetIndex: u32,
  exactStartX: f64,
  exactStartY: f64,
  exactTargetX: f64,
  exactTargetY: f64,
): u32 {
  const descriptorPointer = reserveArena(STEP_SIMPLIFIED_BYTE_LENGTH, sizeof<f64>());
  memory.fill(descriptorPointer, 0, STEP_SIMPLIFIED_BYTE_LENGTH);
  const rawLength = load<u32>(rawPathPointer + 8);
  const terminalStatePointer = stepStateRecordPointer(tablePointer, targetStateIndex);
  if (rawLength <= 2) {
    store<u32>(descriptorPointer + STEP_SIMPLIFIED_PATH_POINTER_OFFSET, rawPathPointer);
    store<f64>(descriptorPointer + STEP_SIMPLIFIED_TERMINAL_RESOLVED_Y_OFFSET, load<f64>(terminalStatePointer + STEP_STATE_RESOLVED_Y_OFFSET));
    store<i32>(descriptorPointer + STEP_SIMPLIFIED_TERMINAL_SIGN_OFFSET, load<i32>(terminalStatePointer + STEP_STATE_SIGN_OFFSET));
    store<u32>(descriptorPointer + STEP_SIMPLIFIED_TERMINAL_LIMB_POINTER_OFFSET, load<u32>(terminalStatePointer + STEP_STATE_LIMB_POINTER_OFFSET));
    store<u32>(descriptorPointer + STEP_SIMPLIFIED_TERMINAL_LIMB_COUNT_OFFSET, load<u32>(terminalStatePointer + STEP_STATE_LIMB_COUNT_OFFSET));
    return descriptorPointer;
  }
  const rawXPointer = load<u32>(rawPathPointer);
  const rawYPointer = load<u32>(rawPathPointer + 4);
  const simplifiedXPointer = reserveArena(rawLength * sizeof<f64>(), sizeof<f64>());
  const simplifiedYPointer = reserveArena(rawLength * sizeof<f64>(), sizeof<f64>());
  const initialPointer = stepStateRecordPointer(tablePointer, startStateIndex);
  let routeResolvedY = load<f64>(initialPointer + STEP_STATE_RESOLVED_Y_OFFSET);
  let routeSign = load<i32>(initialPointer + STEP_STATE_SIGN_OFFSET);
  let routeLimbPointer = load<u32>(initialPointer + STEP_STATE_LIMB_POINTER_OFFSET);
  let routeLimbCount = load<u32>(initialPointer + STEP_STATE_LIMB_COUNT_OFFSET);
  let simplifiedLength: u32 = 0;
  let anchorIndex: u32 = 0;
  const width = getPlaneWidth();
  while (anchorIndex < rawLength) {
    const anchorX = <u32>load<f64>(rawXPointer + anchorIndex * sizeof<f64>());
    const anchorY = <u32>load<f64>(rawYPointer + anchorIndex * sizeof<f64>());
    store<f64>(simplifiedXPointer + simplifiedLength * sizeof<f64>(), <f64>anchorX);
    store<f64>(simplifiedYPointer + simplifiedLength * sizeof<f64>(), <f64>anchorY);
    simplifiedLength += 1;
    if (anchorIndex + 1 >= rawLength) break;
    let nextIndex = STEP_STATE_MISSING_INDEX;
    let candidateIndex = rawLength;
    while (candidateIndex > anchorIndex + 1) {
      candidateIndex -= 1;
      const candidateX = <u32>load<f64>(rawXPointer + candidateIndex * sizeof<f64>());
      const candidateY = <u32>load<f64>(rawYPointer + candidateIndex * sizeof<f64>());
      if (candidateX <= anchorX) continue;
      const candidateMark = markArena();
      const transitionPointer = runStepSearchEdgeTransition(
        contextPointer,
        anchorY * width + anchorX,
        candidateY * width + candidateX,
        startIndex,
        targetIndex,
        exactStartX,
        exactStartY,
        exactTargetX,
        exactTargetY,
        routeResolvedY,
        routeSign,
        routeLimbPointer,
        routeLimbCount,
      );
      if (
        load<u32>(transitionPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATUS_OFFSET) ==
        Layout.ROUTE_STEP_TRANSITION_STATUS_SUCCESS
      ) {
        nextIndex = candidateIndex;
        routeResolvedY = load<f64>(transitionPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_RESOLVED_END_Y_OFFSET);
        routeSign = load<i32>(transitionPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATE_SIGN_OFFSET);
        routeLimbPointer = load<u32>(transitionPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATE_POINTER_OFFSET);
        routeLimbCount = load<u32>(transitionPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATE_COUNT_OFFSET);
        commitArena(candidateMark);
        break;
      }
      resetArena(candidateMark);
    }
    if (nextIndex == STEP_STATE_MISSING_INDEX) {
      store<u32>(descriptorPointer + STEP_SIMPLIFIED_PATH_POINTER_OFFSET, rawPathPointer);
      store<f64>(descriptorPointer + STEP_SIMPLIFIED_TERMINAL_RESOLVED_Y_OFFSET, load<f64>(terminalStatePointer + STEP_STATE_RESOLVED_Y_OFFSET));
      store<i32>(descriptorPointer + STEP_SIMPLIFIED_TERMINAL_SIGN_OFFSET, load<i32>(terminalStatePointer + STEP_STATE_SIGN_OFFSET));
      store<u32>(descriptorPointer + STEP_SIMPLIFIED_TERMINAL_LIMB_POINTER_OFFSET, load<u32>(terminalStatePointer + STEP_STATE_LIMB_POINTER_OFFSET));
      store<u32>(descriptorPointer + STEP_SIMPLIFIED_TERMINAL_LIMB_COUNT_OFFSET, load<u32>(terminalStatePointer + STEP_STATE_LIMB_COUNT_OFFSET));
      return descriptorPointer;
    }
    anchorIndex = nextIndex;
  }
  const pathPointer = reserveArena(12, sizeof<u32>());
  store<u32>(pathPointer, simplifiedXPointer);
  store<u32>(pathPointer + 4, simplifiedYPointer);
  store<u32>(pathPointer + 8, simplifiedLength);
  store<u32>(descriptorPointer + STEP_SIMPLIFIED_PATH_POINTER_OFFSET, pathPointer);
  store<f64>(descriptorPointer + STEP_SIMPLIFIED_TERMINAL_RESOLVED_Y_OFFSET, routeResolvedY);
  store<i32>(descriptorPointer + STEP_SIMPLIFIED_TERMINAL_SIGN_OFFSET, routeSign);
  store<u32>(descriptorPointer + STEP_SIMPLIFIED_TERMINAL_LIMB_POINTER_OFFSET, routeLimbCount == 0 ? 0 : routeLimbPointer);
  store<u32>(descriptorPointer + STEP_SIMPLIFIED_TERMINAL_LIMB_COUNT_OFFSET, routeLimbCount);
  return descriptorPointer;
}

// The TS preview sorts at most 64 heap nodes with V8's stable PowerSort. Because nearlyEqual makes
// the comparator non-transitive, a different stable algorithm changes candidate order. Keep this
// bounded raw implementation aligned with V8's natural runs, binary insertion, and galloping merge.
// Upstream reference: v8/v8 third_party/v8/builtins/array-sort.tq.
@inline
function compareStepHeapPositions(heapPointer: u32, positionsPointer: u32, leftIndex: u32, rightIndex: u32): i32 {
  return compareStepHeapNodes(
    heapPointer,
    stepHeapNodePointer(heapPointer, load<u32>(positionsPointer + leftIndex * sizeof<u32>())),
    stepHeapNodePointer(heapPointer, load<u32>(positionsPointer + rightIndex * sizeof<u32>())),
  );
}

function countAndMakeStepPreviewRun(
  heapPointer: u32,
  positionsPointer: u32,
  low: u32,
  high: u32,
): u32 {
  if (low + 1 == high) return 1;
  let runLength: u32 = 2;
  const isDescending = compareStepHeapPositions(heapPointer, positionsPointer, low + 1, low) < 0;
  while (low + runLength < high) {
    const comparison = compareStepHeapPositions(
      heapPointer,
      positionsPointer,
      low + runLength,
      low + runLength - 1,
    );
    if (isDescending ? comparison >= 0 : comparison < 0) break;
    runLength += 1;
  }
  if (isDescending) {
    let left = low;
    let right = low + runLength - 1;
    while (left < right) {
      const value = load<u32>(positionsPointer + left * sizeof<u32>());
      store<u32>(positionsPointer + left * sizeof<u32>(), load<u32>(positionsPointer + right * sizeof<u32>()));
      store<u32>(positionsPointer + right * sizeof<u32>(), value);
      left += 1;
      right -= 1;
    }
  }
  return runLength;
}

function binaryInsertionSortStepPreview(
  heapPointer: u32,
  positionsPointer: u32,
  low: u32,
  start: u32,
  high: u32,
): void {
  if (start == low) start += 1;
  while (start < high) {
    const pivot = load<u32>(positionsPointer + start * sizeof<u32>());
    let left = low;
    let right = start;
    while (left < right) {
      const middle = left + ((right - left) >> 1);
      const comparison = compareStepHeapNodes(
        heapPointer,
        stepHeapNodePointer(heapPointer, pivot),
        stepHeapNodePointer(heapPointer, load<u32>(positionsPointer + middle * sizeof<u32>())),
      );
      if (comparison < 0) right = middle;
      else left = middle + 1;
    }
    let position = start;
    while (position > left) {
      store<u32>(
        positionsPointer + position * sizeof<u32>(),
        load<u32>(positionsPointer + (position - 1) * sizeof<u32>()),
      );
      position -= 1;
    }
    store<u32>(positionsPointer + left * sizeof<u32>(), pivot);
    start += 1;
  }
}

function gallopLeftStepPreview(
  heapPointer: u32,
  positionsPointer: u32,
  keyPosition: u32,
  base: u32,
  length: u32,
  hint: u32,
): u32 {
  let lastOffset: i32 = 0;
  let offset: i32 = 1;
  let comparison = compareStepHeapNodes(
    heapPointer,
    stepHeapNodePointer(heapPointer, load<u32>(positionsPointer + (base + hint) * sizeof<u32>())),
    stepHeapNodePointer(heapPointer, keyPosition),
  );
  if (comparison < 0) {
    const maximumOffset = <i32>(length - hint);
    while (offset < maximumOffset) {
      comparison = compareStepHeapNodes(
        heapPointer,
        stepHeapNodePointer(heapPointer, load<u32>(positionsPointer + (base + hint + <u32>offset) * sizeof<u32>())),
        stepHeapNodePointer(heapPointer, keyPosition),
      );
      if (comparison >= 0) break;
      lastOffset = offset;
      offset = (offset << 1) + 1;
    }
    if (offset > maximumOffset) offset = maximumOffset;
    lastOffset += <i32>hint;
    offset += <i32>hint;
  } else {
    const maximumOffset = <i32>hint + 1;
    while (offset < maximumOffset) {
      comparison = compareStepHeapNodes(
        heapPointer,
        stepHeapNodePointer(heapPointer, load<u32>(positionsPointer + (base + hint - <u32>offset) * sizeof<u32>())),
        stepHeapNodePointer(heapPointer, keyPosition),
      );
      if (comparison < 0) break;
      lastOffset = offset;
      offset = (offset << 1) + 1;
    }
    if (offset > maximumOffset) offset = maximumOffset;
    const previousLastOffset = lastOffset;
    lastOffset = <i32>hint - offset;
    offset = <i32>hint - previousLastOffset;
  }
  lastOffset += 1;
  while (lastOffset < offset) {
    const middle = lastOffset + ((offset - lastOffset) >> 1);
    comparison = compareStepHeapNodes(
      heapPointer,
      stepHeapNodePointer(heapPointer, load<u32>(positionsPointer + (base + <u32>middle) * sizeof<u32>())),
      stepHeapNodePointer(heapPointer, keyPosition),
    );
    if (comparison < 0) lastOffset = middle + 1;
    else offset = middle;
  }
  return <u32>offset;
}

function gallopRightStepPreview(
  heapPointer: u32,
  positionsPointer: u32,
  keyPosition: u32,
  base: u32,
  length: u32,
  hint: u32,
): u32 {
  let lastOffset: i32 = 0;
  let offset: i32 = 1;
  let comparison = compareStepHeapNodes(
    heapPointer,
    stepHeapNodePointer(heapPointer, keyPosition),
    stepHeapNodePointer(heapPointer, load<u32>(positionsPointer + (base + hint) * sizeof<u32>())),
  );
  if (comparison < 0) {
    const maximumOffset = <i32>hint + 1;
    while (offset < maximumOffset) {
      comparison = compareStepHeapNodes(
        heapPointer,
        stepHeapNodePointer(heapPointer, keyPosition),
        stepHeapNodePointer(heapPointer, load<u32>(positionsPointer + (base + hint - <u32>offset) * sizeof<u32>())),
      );
      if (comparison >= 0) break;
      lastOffset = offset;
      offset = (offset << 1) + 1;
    }
    if (offset > maximumOffset) offset = maximumOffset;
    const previousLastOffset = lastOffset;
    lastOffset = <i32>hint - offset;
    offset = <i32>hint - previousLastOffset;
  } else {
    const maximumOffset = <i32>(length - hint);
    while (offset < maximumOffset) {
      comparison = compareStepHeapNodes(
        heapPointer,
        stepHeapNodePointer(heapPointer, keyPosition),
        stepHeapNodePointer(heapPointer, load<u32>(positionsPointer + (base + hint + <u32>offset) * sizeof<u32>())),
      );
      if (comparison < 0) break;
      lastOffset = offset;
      offset = (offset << 1) + 1;
    }
    if (offset > maximumOffset) offset = maximumOffset;
    lastOffset += <i32>hint;
    offset += <i32>hint;
  }
  lastOffset += 1;
  while (lastOffset < offset) {
    const middle = lastOffset + ((offset - lastOffset) >> 1);
    comparison = compareStepHeapNodes(
      heapPointer,
      stepHeapNodePointer(heapPointer, keyPosition),
      stepHeapNodePointer(heapPointer, load<u32>(positionsPointer + (base + <u32>middle) * sizeof<u32>())),
    );
    if (comparison < 0) offset = middle;
    else lastOffset = middle + 1;
  }
  return <u32>offset;
}

function mergeLowStepPreview(
  heapPointer: u32,
  positionsPointer: u32,
  scratchPointer: u32,
  leftBase: u32,
  leftLengthArgument: u32,
  rightBase: u32,
  rightLengthArgument: u32,
): void {
  let leftLength = leftLengthArgument;
  let rightLength = rightLengthArgument;
  memory.copy(scratchPointer, positionsPointer + leftBase * sizeof<u32>(), leftLength * sizeof<u32>());
  let outputIndex = leftBase;
  let scratchIndex: u32 = 0;
  let rightIndex = rightBase;
  store<u32>(positionsPointer + outputIndex++ * sizeof<u32>(), load<u32>(positionsPointer + rightIndex++ * sizeof<u32>()));
  rightLength -= 1;
  if (rightLength == 0) {
    memory.copy(positionsPointer + outputIndex * sizeof<u32>(), scratchPointer, leftLength * sizeof<u32>());
    return;
  }
  if (leftLength == 1) {
    memory.copy(
      positionsPointer + outputIndex * sizeof<u32>(),
      positionsPointer + rightIndex * sizeof<u32>(),
      rightLength * sizeof<u32>(),
    );
    store<u32>(positionsPointer + (outputIndex + rightLength) * sizeof<u32>(), load<u32>(scratchPointer));
    return;
  }
  let minimumGallop: u32 = 7;
  while (true) {
    let leftWins: u32 = 0;
    let rightWins: u32 = 0;
    while (true) {
      const comparison = compareStepHeapNodes(
        heapPointer,
        stepHeapNodePointer(heapPointer, load<u32>(positionsPointer + rightIndex * sizeof<u32>())),
        stepHeapNodePointer(heapPointer, load<u32>(scratchPointer + scratchIndex * sizeof<u32>())),
      );
      if (comparison < 0) {
        store<u32>(
          positionsPointer + outputIndex++ * sizeof<u32>(),
          load<u32>(positionsPointer + rightIndex++ * sizeof<u32>()),
        );
        rightWins += 1;
        rightLength -= 1;
        leftWins = 0;
        if (rightLength == 0) {
          memory.copy(
            positionsPointer + outputIndex * sizeof<u32>(),
            scratchPointer + scratchIndex * sizeof<u32>(),
            leftLength * sizeof<u32>(),
          );
          return;
        }
        if (rightWins >= minimumGallop) break;
      } else {
        store<u32>(
          positionsPointer + outputIndex++ * sizeof<u32>(),
          load<u32>(scratchPointer + scratchIndex++ * sizeof<u32>()),
        );
        leftWins += 1;
        leftLength -= 1;
        rightWins = 0;
        if (leftLength == 1) {
          memory.copy(
            positionsPointer + outputIndex * sizeof<u32>(),
            positionsPointer + rightIndex * sizeof<u32>(),
            rightLength * sizeof<u32>(),
          );
          store<u32>(
            positionsPointer + (outputIndex + rightLength) * sizeof<u32>(),
            load<u32>(scratchPointer + scratchIndex * sizeof<u32>()),
          );
          return;
        }
        if (leftWins >= minimumGallop) break;
      }
    }
    minimumGallop += 1;
    let isFirstIteration = true;
    while (leftWins >= 7 || rightWins >= 7 || isFirstIteration) {
      isFirstIteration = false;
      if (minimumGallop > 1) minimumGallop -= 1;
      leftWins = gallopRightStepPreview(
        heapPointer,
        scratchPointer,
        load<u32>(positionsPointer + rightIndex * sizeof<u32>()),
        scratchIndex,
        leftLength,
        0,
      );
      if (leftWins > 0) {
        memory.copy(
          positionsPointer + outputIndex * sizeof<u32>(),
          scratchPointer + scratchIndex * sizeof<u32>(),
          leftWins * sizeof<u32>(),
        );
        outputIndex += leftWins;
        scratchIndex += leftWins;
        leftLength -= leftWins;
        if (leftLength == 0) return;
        if (leftLength == 1) {
          memory.copy(
            positionsPointer + outputIndex * sizeof<u32>(),
            positionsPointer + rightIndex * sizeof<u32>(),
            rightLength * sizeof<u32>(),
          );
          store<u32>(
            positionsPointer + (outputIndex + rightLength) * sizeof<u32>(),
            load<u32>(scratchPointer + scratchIndex * sizeof<u32>()),
          );
          return;
        }
      }
      store<u32>(
        positionsPointer + outputIndex++ * sizeof<u32>(),
        load<u32>(positionsPointer + rightIndex++ * sizeof<u32>()),
      );
      rightLength -= 1;
      if (rightLength == 0) {
        memory.copy(
          positionsPointer + outputIndex * sizeof<u32>(),
          scratchPointer + scratchIndex * sizeof<u32>(),
          leftLength * sizeof<u32>(),
        );
        return;
      }
      rightWins = gallopLeftStepPreview(
        heapPointer,
        positionsPointer,
        load<u32>(scratchPointer + scratchIndex * sizeof<u32>()),
        rightIndex,
        rightLength,
        0,
      );
      if (rightWins > 0) {
        memory.copy(
          positionsPointer + outputIndex * sizeof<u32>(),
          positionsPointer + rightIndex * sizeof<u32>(),
          rightWins * sizeof<u32>(),
        );
        outputIndex += rightWins;
        rightIndex += rightWins;
        rightLength -= rightWins;
        if (rightLength == 0) {
          memory.copy(
            positionsPointer + outputIndex * sizeof<u32>(),
            scratchPointer + scratchIndex * sizeof<u32>(),
            leftLength * sizeof<u32>(),
          );
          return;
        }
      }
      store<u32>(
        positionsPointer + outputIndex++ * sizeof<u32>(),
        load<u32>(scratchPointer + scratchIndex++ * sizeof<u32>()),
      );
      leftLength -= 1;
      if (leftLength == 1) {
        memory.copy(
          positionsPointer + outputIndex * sizeof<u32>(),
          positionsPointer + rightIndex * sizeof<u32>(),
          rightLength * sizeof<u32>(),
        );
        store<u32>(
          positionsPointer + (outputIndex + rightLength) * sizeof<u32>(),
          load<u32>(scratchPointer + scratchIndex * sizeof<u32>()),
        );
        return;
      }
    }
    minimumGallop += 1;
  }
}

function mergeHighStepPreview(
  heapPointer: u32,
  positionsPointer: u32,
  scratchPointer: u32,
  leftBase: u32,
  leftLengthArgument: u32,
  rightBase: u32,
  rightLengthArgument: u32,
): void {
  let leftLength = leftLengthArgument;
  let rightLength = rightLengthArgument;
  memory.copy(scratchPointer, positionsPointer + rightBase * sizeof<u32>(), rightLength * sizeof<u32>());
  let outputIndex = rightBase + rightLength - 1;
  let scratchIndex = rightLength - 1;
  let leftIndex = leftBase + leftLength - 1;
  store<u32>(positionsPointer + outputIndex-- * sizeof<u32>(), load<u32>(positionsPointer + leftIndex-- * sizeof<u32>()));
  leftLength -= 1;
  if (leftLength == 0) {
    memory.copy(
      positionsPointer + (outputIndex - (rightLength - 1)) * sizeof<u32>(),
      scratchPointer,
      rightLength * sizeof<u32>(),
    );
    return;
  }
  if (rightLength == 1) {
    outputIndex -= leftLength;
    leftIndex -= leftLength;
    memory.copy(
      positionsPointer + (outputIndex + 1) * sizeof<u32>(),
      positionsPointer + (leftIndex + 1) * sizeof<u32>(),
      leftLength * sizeof<u32>(),
    );
    store<u32>(positionsPointer + outputIndex * sizeof<u32>(), load<u32>(scratchPointer + scratchIndex * sizeof<u32>()));
    return;
  }
  let minimumGallop: u32 = 7;
  while (true) {
    let leftWins: u32 = 0;
    let rightWins: u32 = 0;
    while (true) {
      const comparison = compareStepHeapNodes(
        heapPointer,
        stepHeapNodePointer(heapPointer, load<u32>(scratchPointer + scratchIndex * sizeof<u32>())),
        stepHeapNodePointer(heapPointer, load<u32>(positionsPointer + leftIndex * sizeof<u32>())),
      );
      if (comparison < 0) {
        store<u32>(
          positionsPointer + outputIndex-- * sizeof<u32>(),
          load<u32>(positionsPointer + leftIndex-- * sizeof<u32>()),
        );
        leftWins += 1;
        leftLength -= 1;
        rightWins = 0;
        if (leftLength == 0) {
          memory.copy(
            positionsPointer + (outputIndex - (rightLength - 1)) * sizeof<u32>(),
            scratchPointer,
            rightLength * sizeof<u32>(),
          );
          return;
        }
        if (leftWins >= minimumGallop) break;
      } else {
        store<u32>(
          positionsPointer + outputIndex-- * sizeof<u32>(),
          load<u32>(scratchPointer + scratchIndex-- * sizeof<u32>()),
        );
        rightWins += 1;
        rightLength -= 1;
        leftWins = 0;
        if (rightLength == 1) {
          outputIndex -= leftLength;
          leftIndex -= leftLength;
          memory.copy(
            positionsPointer + (outputIndex + 1) * sizeof<u32>(),
            positionsPointer + (leftIndex + 1) * sizeof<u32>(),
            leftLength * sizeof<u32>(),
          );
          store<u32>(
            positionsPointer + outputIndex * sizeof<u32>(),
            load<u32>(scratchPointer + scratchIndex * sizeof<u32>()),
          );
          return;
        }
        if (rightWins >= minimumGallop) break;
      }
    }
    minimumGallop += 1;
    let isFirstIteration = true;
    while (leftWins >= 7 || rightWins >= 7 || isFirstIteration) {
      isFirstIteration = false;
      if (minimumGallop > 1) minimumGallop -= 1;
      const leftGallop = gallopRightStepPreview(
        heapPointer,
        positionsPointer,
        load<u32>(scratchPointer + scratchIndex * sizeof<u32>()),
        leftBase,
        leftLength,
        leftLength - 1,
      );
      leftWins = leftLength - leftGallop;
      if (leftWins > 0) {
        outputIndex -= leftWins;
        leftIndex -= leftWins;
        memory.copy(
          positionsPointer + (outputIndex + 1) * sizeof<u32>(),
          positionsPointer + (leftIndex + 1) * sizeof<u32>(),
          leftWins * sizeof<u32>(),
        );
        leftLength -= leftWins;
        if (leftLength == 0) {
          memory.copy(
            positionsPointer + (outputIndex - (rightLength - 1)) * sizeof<u32>(),
            scratchPointer,
            rightLength * sizeof<u32>(),
          );
          return;
        }
      }
      store<u32>(
        positionsPointer + outputIndex-- * sizeof<u32>(),
        load<u32>(scratchPointer + scratchIndex-- * sizeof<u32>()),
      );
      rightLength -= 1;
      if (rightLength == 1) {
        outputIndex -= leftLength;
        leftIndex -= leftLength;
        memory.copy(
          positionsPointer + (outputIndex + 1) * sizeof<u32>(),
          positionsPointer + (leftIndex + 1) * sizeof<u32>(),
          leftLength * sizeof<u32>(),
        );
        store<u32>(
          positionsPointer + outputIndex * sizeof<u32>(),
          load<u32>(scratchPointer + scratchIndex * sizeof<u32>()),
        );
        return;
      }
      const rightGallop = gallopLeftStepPreview(
        heapPointer,
        scratchPointer,
        load<u32>(positionsPointer + leftIndex * sizeof<u32>()),
        0,
        rightLength,
        rightLength - 1,
      );
      rightWins = rightLength - rightGallop;
      if (rightWins > 0) {
        outputIndex -= rightWins;
        scratchIndex -= rightWins;
        memory.copy(
          positionsPointer + (outputIndex + 1) * sizeof<u32>(),
          scratchPointer + (scratchIndex + 1) * sizeof<u32>(),
          rightWins * sizeof<u32>(),
        );
        rightLength -= rightWins;
        if (rightLength == 0) return;
        if (rightLength == 1) {
          outputIndex -= leftLength;
          leftIndex -= leftLength;
          memory.copy(
            positionsPointer + (outputIndex + 1) * sizeof<u32>(),
            positionsPointer + (leftIndex + 1) * sizeof<u32>(),
            leftLength * sizeof<u32>(),
          );
          store<u32>(
            positionsPointer + outputIndex * sizeof<u32>(),
            load<u32>(scratchPointer + scratchIndex * sizeof<u32>()),
          );
          return;
        }
      }
      store<u32>(
        positionsPointer + outputIndex-- * sizeof<u32>(),
        load<u32>(positionsPointer + leftIndex-- * sizeof<u32>()),
      );
      leftLength -= 1;
      if (leftLength == 0) {
        memory.copy(
          positionsPointer + (outputIndex - (rightLength - 1)) * sizeof<u32>(),
          scratchPointer,
          rightLength * sizeof<u32>(),
        );
        return;
      }
    }
    minimumGallop += 1;
  }
}

function mergeStepPreviewRuns(
  heapPointer: u32,
  positionsPointer: u32,
  scratchPointer: u32,
  middle: u32,
  length: u32,
): void {
  let leftBase: u32 = 0;
  let leftLength = middle;
  const rightBase = middle;
  let rightLength = length - middle;
  const leftPrefixLength = gallopRightStepPreview(
    heapPointer,
    positionsPointer,
    load<u32>(positionsPointer + rightBase * sizeof<u32>()),
    leftBase,
    leftLength,
    0,
  );
  leftBase += leftPrefixLength;
  leftLength -= leftPrefixLength;
  if (leftLength == 0) return;
  rightLength = gallopLeftStepPreview(
    heapPointer,
    positionsPointer,
    load<u32>(positionsPointer + (leftBase + leftLength - 1) * sizeof<u32>()),
    rightBase,
    rightLength,
    rightLength - 1,
  );
  if (rightLength == 0) return;
  if (leftLength <= rightLength) {
    mergeLowStepPreview(
      heapPointer,
      positionsPointer,
      scratchPointer,
      leftBase,
      leftLength,
      rightBase,
      rightLength,
    );
  } else {
    mergeHighStepPreview(
      heapPointer,
      positionsPointer,
      scratchPointer,
      leftBase,
      leftLength,
      rightBase,
      rightLength,
    );
  }
}

function sortStepPreviewHeapPositions(
  heapPointer: u32,
  positionsPointer: u32,
  scratchPointer: u32,
  length: u32,
): void {
  if (length < 2) return;
  if (length < 16) {
    binaryInsertionSortStepPreview(heapPointer, positionsPointer, 0, 0, length);
    return;
  }
  const minimumRunLength = length < 64 ? length : 32;
  let firstRunLength = countAndMakeStepPreviewRun(heapPointer, positionsPointer, 0, length);
  if (firstRunLength < minimumRunLength) {
    binaryInsertionSortStepPreview(heapPointer, positionsPointer, 0, firstRunLength, minimumRunLength);
    firstRunLength = minimumRunLength;
  }
  if (firstRunLength == length) return;
  const secondRunLength = countAndMakeStepPreviewRun(heapPointer, positionsPointer, firstRunLength, length);
  if (secondRunLength < length - firstRunLength) {
    binaryInsertionSortStepPreview(
      heapPointer,
      positionsPointer,
      firstRunLength,
      firstRunLength + secondRunLength,
      length,
    );
  }
  mergeStepPreviewRuns(heapPointer, positionsPointer, scratchPointer, firstRunLength, length);
}

function collectStepPreviewCandidateIndexes(
  tablePointer: u32,
  heapPointer: u32,
  currentCellIndex: u32,
  startIndex: u32,
  targetIndex: u32,
  outputPointer: u32,
  candidateLimit: u32,
): u32 {
  let count = addUniquePreviewCandidate(outputPointer, 0, startIndex, candidateLimit);
  count = addUniquePreviewCandidate(outputPointer, count, targetIndex, candidateLimit);
  count = addUniquePreviewCandidate(outputPointer, count, currentCellIndex, candidateLimit);
  const heapLength = load<u32>(heapPointer + STEP_HEAP_LENGTH_OFFSET);
  const snapshotLength = <u32>NativeMath.min(<f64>heapLength, <f64>candidateLimit);
  const heapPositionsPointer = reserveArena(snapshotLength * sizeof<u32>(), sizeof<u32>());
  let position: u32 = 0;
  while (position < snapshotLength) {
    store<u32>(heapPositionsPointer + position * sizeof<u32>(), position);
    position += 1;
  }
  const mergeScratchPointer = reserveArena(snapshotLength * sizeof<u32>(), sizeof<u32>());
  sortStepPreviewHeapPositions(heapPointer, heapPositionsPointer, mergeScratchPointer, snapshotLength);
  position = 0;
  while (position < snapshotLength && count < candidateLimit) {
    const nodePointer = stepHeapNodePointer(
      heapPointer,
      load<u32>(heapPositionsPointer + position * sizeof<u32>()),
    );
    const statePointer = stepStateRecordPointer(
      tablePointer,
      load<u32>(nodePointer + STEP_HEAP_STATE_INDEX_OFFSET),
    );
    count = addUniquePreviewCandidate(
      outputPointer,
      count,
      load<u32>(statePointer + STEP_STATE_CELL_INDEX_OFFSET),
      candidateLimit,
    );
    position += 1;
  }
  return count;
}

function publishStepThetaPreview(
  contextPointer: u32,
  previewStatePointer: u32,
  tablePointer: u32,
  heapPointer: u32,
  currentStateIndex: u32,
  pathPointer: u32,
  startIndex: u32,
  targetIndex: u32,
): void {
  const width = getPlaneWidth();
  const acceptedPointer = load<u32>(previewStatePointer + ROUTE_PREVIEW_ACCEPTED_POINTER_OFFSET);
  const acceptedCount = load<u32>(previewStatePointer + ROUTE_PREVIEW_ACCEPTED_COUNT_OFFSET);
  const pathLength = load<u32>(pathPointer + 8);
  const candidateLimit = load<u32>(previewStatePointer + ROUTE_PREVIEW_CANDIDATE_LIMIT_OFFSET);
  const candidateIndexesPointer = reserveArena(candidateLimit * sizeof<u32>(), sizeof<u32>());
  const currentStatePointer = stepStateRecordPointer(tablePointer, currentStateIndex);
  const currentCellIndex = load<u32>(currentStatePointer + STEP_STATE_CELL_INDEX_OFFSET);
  const candidateCount = collectStepPreviewCandidateIndexes(
    tablePointer,
    heapPointer,
    currentCellIndex,
    startIndex,
    targetIndex,
    candidateIndexesPointer,
    candidateLimit,
  );
  const pointCount = acceptedCount * 2 + pathLength + candidateCount + 1;
  const pointsXPointer = reserveArena(pointCount * sizeof<f64>(), sizeof<f64>());
  const pointsYPointer = reserveArena(pointCount * sizeof<f64>(), sizeof<f64>());
  const acceptedIndexesPointer =
    acceptedCount == 0 ? 0 : reserveArena(acceptedCount * 2 * sizeof<u32>(), sizeof<u32>());
  const pathIndexesPointer = reserveArena(pathLength * sizeof<u32>(), sizeof<u32>());
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
  const pathXPointer = load<u32>(pathPointer);
  const pathYPointer = load<u32>(pathPointer + 4);
  let pathIndex: u32 = 0;
  while (pathIndex < pathLength) {
    store<f64>(pointsXPointer + pointIndex * sizeof<f64>(), load<f64>(pathXPointer + pathIndex * sizeof<f64>()));
    store<f64>(pointsYPointer + pointIndex * sizeof<f64>(), load<f64>(pathYPointer + pathIndex * sizeof<f64>()));
    store<u32>(pathIndexesPointer + pathIndex * sizeof<u32>(), pointIndex);
    pointIndex += 1;
    pathIndex += 1;
  }
  let candidateIndex: u32 = 0;
  while (candidateIndex < candidateCount) {
    const cellIndex = load<u32>(candidateIndexesPointer + candidateIndex * sizeof<u32>());
    store<f64>(pointsXPointer + pointIndex * sizeof<f64>(), <f64>(cellIndex % width));
    store<f64>(pointsYPointer + pointIndex * sizeof<f64>(), <f64>(cellIndex / width));
    store<u32>(candidateOutputIndexesPointer + candidateIndex * sizeof<u32>(), pointIndex);
    pointIndex += 1;
    candidateIndex += 1;
  }
  const currentPointIndex = pointIndex;
  store<f64>(pointsXPointer + pointIndex * sizeof<f64>(), <f64>(currentCellIndex % width));
  store<f64>(pointsYPointer + pointIndex * sizeof<f64>(), <f64>(currentCellIndex / width));
  const eventPointer = appendRoutePreviewEventRecord(previewStatePointer);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_POINTS_X_POINTER_OFFSET, pointsXPointer);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_POINTS_Y_POINTER_OFFSET, pointsYPointer);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_POINT_COUNT_OFFSET, pointCount);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_ACCEPTED_INDEXES_POINTER_OFFSET, acceptedIndexesPointer);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_ACCEPTED_INDEXES_LENGTH_OFFSET, acceptedCount * 2);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_BEST_PATH_INDEXES_POINTER_OFFSET, pathIndexesPointer);
  store<u32>(eventPointer + Layout.ROUTE_PREVIEW_BEST_PATH_INDEXES_LENGTH_OFFSET, pathLength);
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

function createStepSearchResult(
  status: u32,
  pathPointer: u32,
  expansions: u32,
  previewStatePointer: u32,
  resolvedY: f64,
  stateSign: i32,
  statePointer: u32,
  stateCount: u32,
): u32 {
  const resultPointer = reserveArena(Layout.ROUTE_STEP_SEARCH_RESULT_BYTE_LENGTH, sizeof<f64>());
  memory.fill(resultPointer, 0, Layout.ROUTE_STEP_SEARCH_RESULT_BYTE_LENGTH);
  store<u32>(resultPointer + Layout.ROUTE_STEP_SEARCH_RESULT_MAGIC_OFFSET, Layout.ROUTE_STEP_SEARCH_RESULT_MAGIC);
  store<u32>(resultPointer + Layout.ROUTE_STEP_SEARCH_RESULT_STATUS_OFFSET, status);
  if (pathPointer != 0) {
    store<u32>(resultPointer + Layout.ROUTE_STEP_SEARCH_RESULT_PATH_X_POINTER_OFFSET, load<u32>(pathPointer));
    store<u32>(resultPointer + Layout.ROUTE_STEP_SEARCH_RESULT_PATH_Y_POINTER_OFFSET, load<u32>(pathPointer + 4));
    store<u32>(resultPointer + Layout.ROUTE_STEP_SEARCH_RESULT_PATH_LENGTH_OFFSET, load<u32>(pathPointer + 8));
  }
  store<u32>(
    resultPointer + Layout.ROUTE_STEP_SEARCH_RESULT_PREVIEW_POINTER_OFFSET,
    previewStatePointer == 0 ? 0 : load<u32>(previewStatePointer + ROUTE_PREVIEW_EVENTS_POINTER_OFFSET),
  );
  store<u32>(
    resultPointer + Layout.ROUTE_STEP_SEARCH_RESULT_PREVIEW_COUNT_OFFSET,
    previewStatePointer == 0 ? 0 : load<u32>(previewStatePointer + ROUTE_PREVIEW_EVENT_COUNT_OFFSET),
  );
  store<u32>(resultPointer + Layout.ROUTE_STEP_SEARCH_RESULT_EXPANSION_COUNT_OFFSET, expansions);
  if (status == Layout.ROUTE_STEP_SEARCH_RESULT_STATUS_SUCCESS) {
    store<f64>(resultPointer + Layout.ROUTE_STEP_SEARCH_RESULT_RESOLVED_Y_OFFSET, resolvedY);
    store<i32>(resultPointer + Layout.ROUTE_STEP_SEARCH_RESULT_STATE_SIGN_OFFSET, stateSign);
    store<u32>(resultPointer + Layout.ROUTE_STEP_SEARCH_RESULT_STATE_POINTER_OFFSET, stateCount == 0 ? 0 : statePointer);
    store<u32>(resultPointer + Layout.ROUTE_STEP_SEARCH_RESULT_STATE_COUNT_OFFSET, stateCount);
  }
  return resultPointer;
}

function createNoStepSearchResult(expansions: u32, previewStatePointer: u32): u32 {
  return createStepSearchResult(
    Layout.ROUTE_STEP_SEARCH_RESULT_STATUS_NO_ROUTE,
    0,
    expansions,
    previewStatePointer,
    0,
    0,
    0,
    0,
  );
}

function runStepThetaStarSearch(inputPointer: u32, inputByteLength: u32): u32 {
  if (inputByteLength != Layout.ROUTE_STEP_SEARCH_INPUT_BYTE_LENGTH) trap();
  requireArenaRange(inputPointer, inputByteLength, sizeof<f64>());
  const contextPointer = load<u32>(inputPointer + Layout.ROUTE_STEP_SEARCH_INPUT_CONTEXT_POINTER_OFFSET);
  requireRouteContext(contextPointer);
  if ((load<u32>(contextPointer + Layout.ROUTE_CONTEXT_FLAGS_OFFSET) & Layout.ROUTE_CONTEXT_FLAG_STEP_MODEL) == 0) {
    trap();
  }
  const startX = readPlaneCoordinate(inputPointer, Layout.ROUTE_STEP_SEARCH_INPUT_START_X_OFFSET, getPlaneWidth());
  const startY = readPlaneCoordinate(inputPointer, Layout.ROUTE_STEP_SEARCH_INPUT_START_Y_OFFSET, getPlaneHeight());
  const targetX = readPlaneCoordinate(inputPointer, Layout.ROUTE_STEP_SEARCH_INPUT_TARGET_X_OFFSET, getPlaneWidth());
  const targetY = readPlaneCoordinate(inputPointer, Layout.ROUTE_STEP_SEARCH_INPUT_TARGET_Y_OFFSET, getPlaneHeight());
  const shouldCollectPreviews = load<u32>(inputPointer + Layout.ROUTE_STEP_SEARCH_INPUT_COLLECT_PREVIEWS_OFFSET);
  const initialResolvedY = load<f64>(inputPointer + Layout.ROUTE_STEP_SEARCH_INPUT_RESOLVED_Y_OFFSET);
  const initialSign = load<i32>(inputPointer + Layout.ROUTE_STEP_SEARCH_INPUT_STATE_SIGN_OFFSET);
  const initialStatePointer = load<u32>(inputPointer + Layout.ROUTE_STEP_SEARCH_INPUT_STATE_POINTER_OFFSET);
  const initialStateCount = load<u32>(inputPointer + Layout.ROUTE_STEP_SEARCH_INPUT_STATE_COUNT_OFFSET);
  const exactStartX = load<f64>(inputPointer + Layout.ROUTE_STEP_SEARCH_INPUT_EXACT_START_X_OFFSET);
  const exactStartY = load<f64>(inputPointer + Layout.ROUTE_STEP_SEARCH_INPUT_EXACT_START_Y_OFFSET);
  const exactTargetX = load<f64>(inputPointer + Layout.ROUTE_STEP_SEARCH_INPUT_EXACT_TARGET_X_OFFSET);
  const exactTargetY = load<f64>(inputPointer + Layout.ROUTE_STEP_SEARCH_INPUT_EXACT_TARGET_Y_OFFSET);
  if (
    shouldCollectPreviews > 1 ||
    !isFiniteValue(initialResolvedY) ||
    !isFiniteValue(exactStartX) ||
    !isFiniteValue(exactStartY) ||
    !isFiniteValue(exactTargetX) ||
    !isFiniteValue(exactTargetY) ||
    initialStateCount > u32.MAX_VALUE / sizeof<u32>()
  ) trap();
  requireArenaRange(
    initialStateCount == 0 ? 0 : initialStatePointer,
    initialStateCount * sizeof<u32>(),
    sizeof<u32>(),
  );
  if (
    (initialStateCount == 0 && initialSign != 0) ||
    (initialStateCount != 0 && (initialSign != -1 && initialSign != 1)) ||
    (initialStateCount != 0 && load<u32>(initialStatePointer + (initialStateCount - 1) * sizeof<u32>()) == 0)
  ) trap();
  const previewStatePointer =
    shouldCollectPreviews == 0
      ? 0
      : createRoutePreviewState(
          load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_PREVIEW_EDGE_LIMIT_OFFSET),
          load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_PREVIEW_CANDIDATE_LIMIT_OFFSET),
        );
  if (
    pointHitsRouteContext(contextPointer, startX, startY) ||
    pointHitsRouteContext(contextPointer, targetX, targetY) ||
    targetX < startX ||
    (targetX == startX && targetY != startY)
  ) return createNoStepSearchResult(0, previewStatePointer);
  const width = getPlaneWidth();
  const startIndex = <u32>startY * width + <u32>startX;
  const targetIndex = <u32>targetY * width + <u32>targetX;
  if (targetX > startX) {
    const directMark = markArena();
    const transitionPointer = runStepSearchEdgeTransition(
      contextPointer,
      startIndex,
      targetIndex,
      startIndex,
      targetIndex,
      exactStartX,
      exactStartY,
      exactTargetX,
      exactTargetY,
      initialResolvedY,
      initialSign,
      initialStatePointer,
      initialStateCount,
    );
    if (
      load<u32>(transitionPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATUS_OFFSET) ==
      Layout.ROUTE_STEP_TRANSITION_STATUS_SUCCESS
    ) {
      const pathXPointer = reserveArena(2 * sizeof<f64>(), sizeof<f64>());
      const pathYPointer = reserveArena(2 * sizeof<f64>(), sizeof<f64>());
      store<f64>(pathXPointer, <f64>startX);
      store<f64>(pathXPointer + sizeof<f64>(), <f64>targetX);
      store<f64>(pathYPointer, <f64>startY);
      store<f64>(pathYPointer + sizeof<f64>(), <f64>targetY);
      const pathPointer = reserveArena(12, sizeof<u32>());
      store<u32>(pathPointer, pathXPointer);
      store<u32>(pathPointer + 4, pathYPointer);
      store<u32>(pathPointer + 8, 2);
      if (previewStatePointer != 0) {
        publishDirectThetaPreview(contextPointer, previewStatePointer, startX, startY, targetX, targetY);
      }
      commitArena(directMark);
      return createStepSearchResult(
        Layout.ROUTE_STEP_SEARCH_RESULT_STATUS_SUCCESS,
        pathPointer,
        0,
        previewStatePointer,
        load<f64>(transitionPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_RESOLVED_END_Y_OFFSET),
        load<i32>(transitionPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATE_SIGN_OFFSET),
        load<u32>(transitionPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATE_POINTER_OFFSET),
        load<u32>(transitionPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATE_COUNT_OFFSET),
      );
    }
    resetArena(directMark);
  }
  const tablePointer = createStepStateTable();
  const startStateIndex = appendStepState(
    tablePointer,
    startIndex,
    initialSign,
    initialStatePointer,
    initialStateCount,
    initialResolvedY,
    0,
    0,
    0,
  );
  store<u32>(stepStateRecordPointer(tablePointer, startStateIndex) + STEP_STATE_PARENT_INDEX_OFFSET, startStateIndex);
  const heapPointer = reserveArena(STEP_HEAP_BYTE_LENGTH, sizeof<u32>());
  memory.fill(heapPointer, 0, STEP_HEAP_BYTE_LENGTH);
  store<u32>(heapPointer + STEP_HEAP_TABLE_POINTER_OFFSET, tablePointer);
  pushStepState(
    contextPointer,
    tablePointer,
    heapPointer,
    startStateIndex,
    targetIndex,
    exactStartY,
    exactTargetY,
    startIndex,
  );
  const poppedNodePointer = reserveArena(STEP_HEAP_NODE_BYTE_LENGTH, sizeof<f64>());
  const candidatesPointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_CANDIDATES_POINTER_OFFSET);
  const seenCandidatesPointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_SEEN_POINTER_OFFSET);
  let expansions: u32 = 0;
  while (popStepHeap(heapPointer, poppedNodePointer)) {
    const currentStateIndex = load<u32>(poppedNodePointer + STEP_HEAP_STATE_INDEX_OFFSET);
    const currentStatePointer = stepStateRecordPointer(tablePointer, currentStateIndex);
    if (
      load<u32>(currentStatePointer + STEP_STATE_IS_CLOSED_OFFSET) != 0 ||
      compareStepCosts(
        load<u32>(poppedNodePointer + STEP_HEAP_COST_SEGMENTS_OFFSET),
        load<f64>(poppedNodePointer + STEP_HEAP_COST_SECONDARY_OFFSET),
        load<u32>(currentStatePointer + STEP_STATE_COST_SEGMENTS_OFFSET),
        load<f64>(currentStatePointer + STEP_STATE_COST_SECONDARY_OFFSET),
      ) != 0
    ) continue;
    const currentIndex = load<u32>(currentStatePointer + STEP_STATE_CELL_INDEX_OFFSET);
    if (currentIndex == targetIndex) {
      const rawPathPointer = createStepStatePath(tablePointer, currentStateIndex);
      const simplifiedPointer = createSimplifiedStepPath(
        contextPointer,
        tablePointer,
        rawPathPointer,
        startStateIndex,
        currentStateIndex,
        startIndex,
        targetIndex,
        exactStartX,
        exactStartY,
        exactTargetX,
        exactTargetY,
      );
      const pathPointer = load<u32>(simplifiedPointer + STEP_SIMPLIFIED_PATH_POINTER_OFFSET);
      if (previewStatePointer != 0) {
        publishStepThetaPreview(
          contextPointer,
          previewStatePointer,
          tablePointer,
          heapPointer,
          currentStateIndex,
          pathPointer,
          startIndex,
          targetIndex,
        );
      }
      return createStepSearchResult(
        Layout.ROUTE_STEP_SEARCH_RESULT_STATUS_SUCCESS,
        pathPointer,
        expansions,
        previewStatePointer,
        load<f64>(simplifiedPointer + STEP_SIMPLIFIED_TERMINAL_RESOLVED_Y_OFFSET),
        load<i32>(simplifiedPointer + STEP_SIMPLIFIED_TERMINAL_SIGN_OFFSET),
        load<u32>(simplifiedPointer + STEP_SIMPLIFIED_TERMINAL_LIMB_POINTER_OFFSET),
        load<u32>(simplifiedPointer + STEP_SIMPLIFIED_TERMINAL_LIMB_COUNT_OFFSET),
      );
    }
    store<u32>(currentStatePointer + STEP_STATE_IS_CLOSED_OFFSET, 1);
    const currentX = <i32>(currentIndex % width);
    const currentY = <i32>(currentIndex / width);
    if (targetX > currentX) {
      relaxStepSearchNeighbor(
        contextPointer,
        tablePointer,
        heapPointer,
        previewStatePointer,
        currentStateIndex,
        targetIndex,
        startIndex,
        targetIndex,
        exactStartX,
        exactStartY,
        exactTargetX,
        exactTargetY,
      );
    }
    const nextX = currentX + 1;
    if (nextX <= targetX) {
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
        const nextY = load<u32>(candidatesPointer + candidateIndex * sizeof<u32>());
        relaxStepSearchNeighbor(
          contextPointer,
          tablePointer,
          heapPointer,
          previewStatePointer,
          currentStateIndex,
          nextY * width + <u32>nextX,
          startIndex,
          targetIndex,
          exactStartX,
          exactStartY,
          exactTargetX,
          exactTargetY,
        );
        candidateIndex += 1;
      }
    }
    expansions += 1;
    if (
      previewStatePointer != 0 &&
      expansions % load<u32>(contextPointer + Layout.ROUTE_CONTEXT_THETA_PREVIEW_EXPANSION_INTERVAL_OFFSET) == 0
    ) {
      publishStepThetaPreview(
        contextPointer,
        previewStatePointer,
        tablePointer,
        heapPointer,
        currentStateIndex,
        createStepStatePath(tablePointer, currentStateIndex),
        startIndex,
        targetIndex,
      );
    }
  }
  return createNoStepSearchResult(expansions, previewStatePointer);
}

const VISIBILITY_CANDIDATE_X_POINTER_OFFSET: u32 = 0;
const VISIBILITY_CANDIDATE_Y_POINTER_OFFSET: u32 = 4;
const VISIBILITY_CANDIDATE_COUNT_OFFSET: u32 = 8;
const VISIBILITY_CANDIDATE_DESCRIPTOR_BYTE_LENGTH: u32 = 16;

@inline
function visibilityPolicyValue(contextPointer: u32, index: u32): f64 {
  return loadContextValue(load<u32>(contextPointer + Layout.ROUTE_CONTEXT_POLICY_POINTER_OFFSET), index);
}

function visibilityDistanceToLineSegment(
  pointX: i32,
  pointY: i32,
  startX: i32,
  startY: i32,
  endX: i32,
  endY: i32,
): f64 {
  const deltaX = <f64>(endX - startX);
  const deltaY = <f64>(endY - startY);
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared == 0) return planePointDistance(pointX, pointY, startX, startY);
  const ratio = clampValue(
    (<f64>(pointX - startX) * deltaX + <f64>(pointY - startY) * deltaY) / lengthSquared,
    0,
    1,
  );
  return distanceBetweenValues(
    <f64>pointX - (<f64>startX + deltaX * ratio),
    <f64>pointY - (<f64>startY + deltaY * ratio),
  );
}

function selectVisibilityFreeCandidate(
  contextPointer: u32,
  componentId: u32,
  boundaryX: i32,
  boundaryY: i32,
  minimumPathX: i32,
  maximumPathX: i32,
  outputPointer: u32,
): bool {
  const statsPointer =
    load<u32>(contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_COMPONENT_STATS_POINTER_OFFSET) +
    (componentId - 1) * VISIBILITY_COMPONENT_RECORD_LENGTH * sizeof<u32>();
  const cellCount = load<u32>(statsPointer + VISIBILITY_COMPONENT_CELL_COUNT_INDEX * sizeof<u32>());
  const centroidX = <f64>load<u32>(statsPointer + VISIBILITY_COMPONENT_SUM_X_INDEX * sizeof<u32>()) / <f64>cellCount;
  const centroidY = <f64>load<u32>(statsPointer + VISIBILITY_COMPONENT_SUM_Y_INDEX * sizeof<u32>()) / <f64>cellCount;
  const searchRadius = <i32>visibilityPolicyValue(
    contextPointer,
    Layout.ROUTE_POLICY_VISIBILITY_FREE_CELL_SEARCH_RADIUS_INDEX,
  );
  let radius: i32 = 1;
  while (radius <= searchRadius) {
    let hasCandidate = false;
    let bestX: i32 = 0;
    let bestY: i32 = 0;
    let bestBoundaryDistance: i64 = i64.MAX_VALUE;
    let bestCentroidDistance = f64.NEGATIVE_INFINITY;
    let offsetY = -radius;
    while (offsetY <= radius) {
      let offsetX = -radius;
      while (offsetX <= radius) {
        const absoluteX = offsetX < 0 ? -offsetX : offsetX;
        const absoluteY = offsetY < 0 ? -offsetY : offsetY;
        if ((absoluteX > absoluteY ? absoluteX : absoluteY) == radius) {
          const candidateX = boundaryX + offsetX;
          const candidateY = boundaryY + offsetY;
          if (
            candidateX >= minimumPathX &&
            candidateX <= maximumPathX &&
            !pointHitsRouteContext(contextPointer, candidateX, candidateY)
          ) {
            const boundaryDeltaX = <i64>(candidateX - boundaryX);
            const boundaryDeltaY = <i64>(candidateY - boundaryY);
            const boundaryDistance = boundaryDeltaX * boundaryDeltaX + boundaryDeltaY * boundaryDeltaY;
            const centroidDeltaX = <f64>candidateX - centroidX;
            const centroidDeltaY = <f64>candidateY - centroidY;
            const centroidDistance = centroidDeltaX * centroidDeltaX + centroidDeltaY * centroidDeltaY;
            if (
              !hasCandidate ||
              boundaryDistance < bestBoundaryDistance ||
              (boundaryDistance == bestBoundaryDistance && centroidDistance > bestCentroidDistance) ||
              (boundaryDistance == bestBoundaryDistance &&
                centroidDistance == bestCentroidDistance &&
                (candidateX < bestX || (candidateX == bestX && candidateY < bestY)))
            ) {
              hasCandidate = true;
              bestX = candidateX;
              bestY = candidateY;
              bestBoundaryDistance = boundaryDistance;
              bestCentroidDistance = centroidDistance;
            }
          }
        }
        offsetX += 1;
      }
      offsetY += 1;
    }
    if (hasCandidate) {
      store<u32>(outputPointer, <u32>bestX);
      store<u32>(outputPointer + sizeof<u32>(), <u32>bestY);
      return true;
    }
    radius += 1;
  }
  return false;
}

function collectVisibilityCandidates(
  contextPointer: u32,
  startX: i32,
  startY: i32,
  targetX: i32,
  targetY: i32,
): u32 {
  const width = getPlaneWidth();
  const height = getPlaneHeight();
  const seenPointer = reserveArena(width * height, 1);
  memory.fill(seenPointer, 0, width * height);
  const contourCount = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_CONTOUR_COUNT_OFFSET);
  const offsetsPointer =
    load<u32>(contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_CONTOUR_OFFSETS_POINTER_OFFSET);
  const componentsPointer =
    load<u32>(contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_CONTOUR_COMPONENTS_POINTER_OFFSET);
  const xPointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_CONTOUR_X_POINTER_OFFSET);
  const yPointer = load<u32>(contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_CONTOUR_Y_POINTER_OFFSET);
  const areasPointer =
    load<u32>(contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_CONTOUR_SIGNED_AREAS_POINTER_OFFSET);
  const collinearTolerance = visibilityPolicyValue(
    contextPointer,
    Layout.ROUTE_POLICY_VISIBILITY_COLLINEAR_DISTANCE_TOLERANCE_INDEX,
  );
  const concaveTolerance = visibilityPolicyValue(
    contextPointer,
    Layout.ROUTE_POLICY_VISIBILITY_CONCAVE_CROSS_TOLERANCE_INDEX,
  );
  const minimumPathX = startX < targetX ? startX : targetX;
  const maximumPathX = startX > targetX ? startX : targetX;
  const selectedPointPointer = reserveArena(2 * sizeof<u32>(), sizeof<u32>());
  let selectedCount: u32 = 0;
  let contourIndex: u32 = 0;
  while (contourIndex < contourCount) {
    const contourStart = load<u32>(offsetsPointer + contourIndex * sizeof<u32>());
    const contourEnd = load<u32>(offsetsPointer + (contourIndex + 1) * sizeof<u32>());
    const contourLength = contourEnd - contourStart;
    const signedArea = load<f64>(areasPointer + contourIndex * sizeof<f64>());
    let localIndex: u32 = 0;
    while (localIndex < contourLength) {
      const previousIndex = contourStart + (localIndex + contourLength - 1) % contourLength;
      const currentIndex = contourStart + localIndex;
      const nextIndex = contourStart + (localIndex + 1) % contourLength;
      const previousX = <i32>load<u32>(xPointer + previousIndex * sizeof<u32>());
      const previousY = <i32>load<u32>(yPointer + previousIndex * sizeof<u32>());
      const currentX = <i32>load<u32>(xPointer + currentIndex * sizeof<u32>());
      const currentY = <i32>load<u32>(yPointer + currentIndex * sizeof<u32>());
      const nextX = <i32>load<u32>(xPointer + nextIndex * sizeof<u32>());
      const nextY = <i32>load<u32>(yPointer + nextIndex * sizeof<u32>());
      const cross =
        <i64>(currentX - previousX) * <i64>(nextY - currentY) -
        <i64>(currentY - previousY) * <i64>(nextX - currentX);
      if (
        visibilityDistanceToLineSegment(currentX, currentY, previousX, previousY, nextX, nextY) >
          collinearTolerance &&
        (NativeMath.abs(<f64>cross) <= concaveTolerance || signedArea * <f64>cross >= 0) &&
        selectVisibilityFreeCandidate(
          contextPointer,
          load<u32>(componentsPointer + contourIndex * sizeof<u32>()),
          currentX,
          currentY,
          minimumPathX,
          maximumPathX,
          selectedPointPointer,
        )
      ) {
        const candidateX = load<u32>(selectedPointPointer);
        const candidateY = load<u32>(selectedPointPointer + sizeof<u32>());
        if (
          (<i32>candidateX > startX || <i32>candidateX < targetX) &&
          !(candidateX == <u32>startX && candidateY == <u32>startY) &&
          !(candidateX == <u32>targetX && candidateY == <u32>targetY)
        ) {
          const cellIndex = candidateY * width + candidateX;
          if (load<u8>(seenPointer + cellIndex) == 0) {
            store<u8>(seenPointer + cellIndex, 1);
            selectedCount += 1;
          }
        }
      }
      localIndex += 1;
    }
    contourIndex += 1;
  }
  const candidateCount = selectedCount + 2;
  const candidateXPointer = reserveArena(candidateCount * sizeof<u32>(), sizeof<u32>());
  const candidateYPointer = reserveArena(candidateCount * sizeof<u32>(), sizeof<u32>());
  store<u32>(candidateXPointer, <u32>startX);
  store<u32>(candidateYPointer, <u32>startY);
  store<u32>(candidateXPointer + sizeof<u32>(), <u32>targetX);
  store<u32>(candidateYPointer + sizeof<u32>(), <u32>targetY);
  let candidateIndex: u32 = 2;
  let x: u32 = 0;
  while (x < width) {
    let y: u32 = 0;
    while (y < height) {
      if (load<u8>(seenPointer + y * width + x) != 0) {
        store<u32>(candidateXPointer + candidateIndex * sizeof<u32>(), x);
        store<u32>(candidateYPointer + candidateIndex * sizeof<u32>(), y);
        candidateIndex += 1;
      }
      y += 1;
    }
    x += 1;
  }
  if (candidateIndex != candidateCount) trap();
  const descriptorPointer = reserveArena(VISIBILITY_CANDIDATE_DESCRIPTOR_BYTE_LENGTH, sizeof<u32>());
  store<u32>(descriptorPointer + VISIBILITY_CANDIDATE_X_POINTER_OFFSET, candidateXPointer);
  store<u32>(descriptorPointer + VISIBILITY_CANDIDATE_Y_POINTER_OFFSET, candidateYPointer);
  store<u32>(descriptorPointer + VISIBILITY_CANDIDATE_COUNT_OFFSET, candidateCount);
  return descriptorPointer;
}

@inline
function nearlyEqualVisibilityCosts(left: f64, right: f64): bool {
  const scale = NativeMath.max(1, NativeMath.max(NativeMath.abs(left), NativeMath.abs(right)));
  return NativeMath.abs(left - right) <= f64.EPSILON * scale;
}

const VISIBILITY_HEAP_NODE_INDEX_OFFSET: u32 = 0;
const VISIBILITY_HEAP_NODE_SEGMENTS_OFFSET: u32 = 4;
const VISIBILITY_HEAP_NODE_SECONDARY_OFFSET: u32 = 8;
const VISIBILITY_HEAP_NODE_BYTE_LENGTH: u32 = 16;
const VISIBILITY_HEAP_NODES_POINTER_OFFSET: u32 = 0;
const VISIBILITY_HEAP_LENGTH_OFFSET: u32 = 4;
const VISIBILITY_HEAP_CAPACITY_OFFSET: u32 = 8;
const VISIBILITY_HEAP_BYTE_LENGTH: u32 = 16;

function compareVisibilitySearchNodes(
  leftPointer: u32,
  rightPointer: u32,
  candidatesXPointer: u32,
  candidatesYPointer: u32,
  targetIndex: u32,
): i32 {
  const leftSegments = load<u32>(leftPointer + VISIBILITY_HEAP_NODE_SEGMENTS_OFFSET);
  const rightSegments = load<u32>(rightPointer + VISIBILITY_HEAP_NODE_SEGMENTS_OFFSET);
  if (leftSegments != rightSegments) return leftSegments < rightSegments ? -1 : 1;
  const leftIndex = load<u32>(leftPointer + VISIBILITY_HEAP_NODE_INDEX_OFFSET);
  const rightIndex = load<u32>(rightPointer + VISIBILITY_HEAP_NODE_INDEX_OFFSET);
  const targetX = <i32>load<u32>(candidatesXPointer + targetIndex * sizeof<u32>());
  const targetY = <i32>load<u32>(candidatesYPointer + targetIndex * sizeof<u32>());
  const leftX = <i32>load<u32>(candidatesXPointer + leftIndex * sizeof<u32>());
  const leftY = <i32>load<u32>(candidatesYPointer + leftIndex * sizeof<u32>());
  const rightX = <i32>load<u32>(candidatesXPointer + rightIndex * sizeof<u32>());
  const rightY = <i32>load<u32>(candidatesYPointer + rightIndex * sizeof<u32>());
  const leftSecondary = load<f64>(leftPointer + VISIBILITY_HEAP_NODE_SECONDARY_OFFSET);
  const rightSecondary = load<f64>(rightPointer + VISIBILITY_HEAP_NODE_SECONDARY_OFFSET);
  const leftEstimated = leftSecondary + planePointDistance(leftX, leftY, targetX, targetY);
  const rightEstimated = rightSecondary + planePointDistance(rightX, rightY, targetX, targetY);
  if (!nearlyEqualVisibilityCosts(leftEstimated, rightEstimated)) return leftEstimated < rightEstimated ? -1 : 1;
  if (leftSecondary != rightSecondary) return leftSecondary < rightSecondary ? -1 : 1;
  const leftTargetX = targetX >= leftX ? targetX - leftX : leftX - targetX;
  const rightTargetX = targetX >= rightX ? targetX - rightX : rightX - targetX;
  if (leftTargetX != rightTargetX) return leftTargetX < rightTargetX ? -1 : 1;
  const leftTargetY = targetY >= leftY ? targetY - leftY : leftY - targetY;
  const rightTargetY = targetY >= rightY ? targetY - rightY : rightY - targetY;
  if (leftTargetY != rightTargetY) return leftTargetY < rightTargetY ? -1 : 1;
  return leftIndex < rightIndex ? -1 : leftIndex > rightIndex ? 1 : 0;
}

function swapVisibilityHeapNodes(leftPointer: u32, rightPointer: u32): void {
  const leftIndex = load<u32>(leftPointer + VISIBILITY_HEAP_NODE_INDEX_OFFSET);
  const leftSegments = load<u32>(leftPointer + VISIBILITY_HEAP_NODE_SEGMENTS_OFFSET);
  const leftSecondary = load<f64>(leftPointer + VISIBILITY_HEAP_NODE_SECONDARY_OFFSET);
  memory.copy(leftPointer, rightPointer, VISIBILITY_HEAP_NODE_BYTE_LENGTH);
  store<u32>(rightPointer + VISIBILITY_HEAP_NODE_INDEX_OFFSET, leftIndex);
  store<u32>(rightPointer + VISIBILITY_HEAP_NODE_SEGMENTS_OFFSET, leftSegments);
  store<f64>(rightPointer + VISIBILITY_HEAP_NODE_SECONDARY_OFFSET, leftSecondary);
}

@inline
function visibilityHeapNodePointer(heapPointer: u32, index: u32): u32 {
  return load<u32>(heapPointer + VISIBILITY_HEAP_NODES_POINTER_OFFSET) + index * VISIBILITY_HEAP_NODE_BYTE_LENGTH;
}

function pushVisibilityHeap(
  heapPointer: u32,
  candidateIndex: u32,
  segments: u32,
  secondary: f64,
  candidatesXPointer: u32,
  candidatesYPointer: u32,
  targetIndex: u32,
): void {
  let length = load<u32>(heapPointer + VISIBILITY_HEAP_LENGTH_OFFSET);
  let capacity = load<u32>(heapPointer + VISIBILITY_HEAP_CAPACITY_OFFSET);
  if (length == capacity) {
    const nextCapacity: u32 = capacity == 0 ? 64 : capacity * 2;
    if (nextCapacity <= capacity || nextCapacity > u32.MAX_VALUE / VISIBILITY_HEAP_NODE_BYTE_LENGTH) trap();
    const nextPointer = reserveArena(nextCapacity * VISIBILITY_HEAP_NODE_BYTE_LENGTH, sizeof<u64>());
    const previousPointer = load<u32>(heapPointer + VISIBILITY_HEAP_NODES_POINTER_OFFSET);
    if (length > 0) memory.copy(nextPointer, previousPointer, length * VISIBILITY_HEAP_NODE_BYTE_LENGTH);
    store<u32>(heapPointer + VISIBILITY_HEAP_NODES_POINTER_OFFSET, nextPointer);
    store<u32>(heapPointer + VISIBILITY_HEAP_CAPACITY_OFFSET, nextCapacity);
    capacity = nextCapacity;
  }
  let pointer = visibilityHeapNodePointer(heapPointer, length);
  store<u32>(pointer + VISIBILITY_HEAP_NODE_INDEX_OFFSET, candidateIndex);
  store<u32>(pointer + VISIBILITY_HEAP_NODE_SEGMENTS_OFFSET, segments);
  store<f64>(pointer + VISIBILITY_HEAP_NODE_SECONDARY_OFFSET, secondary);
  length += 1;
  store<u32>(heapPointer + VISIBILITY_HEAP_LENGTH_OFFSET, length);
  let nodeIndex = length - 1;
  while (nodeIndex > 0) {
    const parentIndex = (nodeIndex - 1) / 2;
    pointer = visibilityHeapNodePointer(heapPointer, nodeIndex);
    const parentPointer = visibilityHeapNodePointer(heapPointer, parentIndex);
    if (
      compareVisibilitySearchNodes(pointer, parentPointer, candidatesXPointer, candidatesYPointer, targetIndex) >= 0
    ) break;
    swapVisibilityHeapNodes(pointer, parentPointer);
    nodeIndex = parentIndex;
  }
}

function popVisibilityHeap(
  heapPointer: u32,
  outputPointer: u32,
  candidatesXPointer: u32,
  candidatesYPointer: u32,
  targetIndex: u32,
): bool {
  let length = load<u32>(heapPointer + VISIBILITY_HEAP_LENGTH_OFFSET);
  if (length == 0) return false;
  const rootPointer = visibilityHeapNodePointer(heapPointer, 0);
  memory.copy(outputPointer, rootPointer, VISIBILITY_HEAP_NODE_BYTE_LENGTH);
  length -= 1;
  store<u32>(heapPointer + VISIBILITY_HEAP_LENGTH_OFFSET, length);
  if (length == 0) return true;
  memory.copy(rootPointer, visibilityHeapNodePointer(heapPointer, length), VISIBILITY_HEAP_NODE_BYTE_LENGTH);
  let nodeIndex: u32 = 0;
  while (true) {
    const leftIndex = nodeIndex * 2 + 1;
    if (leftIndex >= length) break;
    const rightIndex = leftIndex + 1;
    let bestIndex = leftIndex;
    if (
      rightIndex < length &&
      compareVisibilitySearchNodes(
        visibilityHeapNodePointer(heapPointer, rightIndex),
        visibilityHeapNodePointer(heapPointer, leftIndex),
        candidatesXPointer,
        candidatesYPointer,
        targetIndex,
      ) < 0
    ) bestIndex = rightIndex;
    const pointer = visibilityHeapNodePointer(heapPointer, nodeIndex);
    const bestPointer = visibilityHeapNodePointer(heapPointer, bestIndex);
    if (
      compareVisibilitySearchNodes(bestPointer, pointer, candidatesXPointer, candidatesYPointer, targetIndex) >= 0
    ) break;
    swapVisibilityHeapNodes(pointer, bestPointer);
    nodeIndex = bestIndex;
  }
  return true;
}

function countVisibilityPath(targetIndex: u32, previousPointer: u32, candidateCount: u32): u32 {
  let count: u32 = 0;
  let index = <i32>targetIndex;
  while (index >= 0 && count <= candidateCount) {
    count += 1;
    index = load<i32>(previousPointer + <u32>index * sizeof<i32>());
  }
  if (count > candidateCount) trap();
  return count;
}

function createVisibilityPath(
  candidatesXPointer: u32,
  candidatesYPointer: u32,
  previousPointer: u32,
  targetIndex: u32,
  candidateCount: u32,
): u32 {
  const pathLength = countVisibilityPath(targetIndex, previousPointer, candidateCount);
  const pathXPointer = reserveArena(pathLength * sizeof<f64>(), sizeof<f64>());
  const pathYPointer = reserveArena(pathLength * sizeof<f64>(), sizeof<f64>());
  let pathIndex = pathLength;
  let candidateIndex = <i32>targetIndex;
  while (pathIndex > 0) {
    pathIndex -= 1;
    store<f64>(
      pathXPointer + pathIndex * sizeof<f64>(),
      <f64>load<u32>(candidatesXPointer + <u32>candidateIndex * sizeof<u32>()),
    );
    store<f64>(
      pathYPointer + pathIndex * sizeof<f64>(),
      <f64>load<u32>(candidatesYPointer + <u32>candidateIndex * sizeof<u32>()),
    );
    candidateIndex = load<i32>(previousPointer + <u32>candidateIndex * sizeof<i32>());
  }
  const descriptorPointer = reserveArena(3 * sizeof<u32>(), sizeof<u32>());
  store<u32>(descriptorPointer, pathXPointer);
  store<u32>(descriptorPointer + sizeof<u32>(), pathYPointer);
  store<u32>(descriptorPointer + 2 * sizeof<u32>(), pathLength);
  return descriptorPointer;
}

function selectBestOpenVisibilityIndex(
  openPointer: u32,
  segmentsPointer: u32,
  secondaryPointer: u32,
  candidateCount: u32,
  candidatesXPointer: u32,
  candidatesYPointer: u32,
  targetIndex: u32,
): i32 {
  const nodesPointer = reserveArena(2 * VISIBILITY_HEAP_NODE_BYTE_LENGTH, sizeof<u64>());
  let bestIndex: i32 = -1;
  let index: u32 = 0;
  while (index < candidateCount) {
    if (load<u8>(openPointer + index) != 0) {
      if (bestIndex < 0) {
        bestIndex = <i32>index;
      } else {
        store<u32>(nodesPointer + VISIBILITY_HEAP_NODE_INDEX_OFFSET, index);
        store<u32>(nodesPointer + VISIBILITY_HEAP_NODE_SEGMENTS_OFFSET, load<u32>(segmentsPointer + index * sizeof<u32>()));
        store<f64>(nodesPointer + VISIBILITY_HEAP_NODE_SECONDARY_OFFSET, load<f64>(secondaryPointer + index * sizeof<f64>()));
        store<u32>(nodesPointer + VISIBILITY_HEAP_NODE_BYTE_LENGTH + VISIBILITY_HEAP_NODE_INDEX_OFFSET, <u32>bestIndex);
        store<u32>(
          nodesPointer + VISIBILITY_HEAP_NODE_BYTE_LENGTH + VISIBILITY_HEAP_NODE_SEGMENTS_OFFSET,
          load<u32>(segmentsPointer + <u32>bestIndex * sizeof<u32>()),
        );
        store<f64>(
          nodesPointer + VISIBILITY_HEAP_NODE_BYTE_LENGTH + VISIBILITY_HEAP_NODE_SECONDARY_OFFSET,
          load<f64>(secondaryPointer + <u32>bestIndex * sizeof<f64>()),
        );
        if (
          compareVisibilitySearchNodes(
            nodesPointer,
            nodesPointer + VISIBILITY_HEAP_NODE_BYTE_LENGTH,
            candidatesXPointer,
            candidatesYPointer,
            targetIndex,
          ) < 0
        ) bestIndex = <i32>index;
      }
    }
    index += 1;
  }
  return bestIndex;
}

@inline
function visibilityPreviewCandidateComesFirst(
  leftIndex: u32,
  rightIndex: u32,
  currentX: i32,
  currentY: i32,
  candidatesXPointer: u32,
  candidatesYPointer: u32,
): bool {
  const leftX = <i32>load<u32>(candidatesXPointer + leftIndex * sizeof<u32>());
  const leftY = <i32>load<u32>(candidatesYPointer + leftIndex * sizeof<u32>());
  const rightX = <i32>load<u32>(candidatesXPointer + rightIndex * sizeof<u32>());
  const rightY = <i32>load<u32>(candidatesYPointer + rightIndex * sizeof<u32>());
  const leftDeltaX = <i64>(leftX - currentX);
  const leftDeltaY = <i64>(leftY - currentY);
  const rightDeltaX = <i64>(rightX - currentX);
  const rightDeltaY = <i64>(rightY - currentY);
  const leftDistance = leftDeltaX * leftDeltaX + leftDeltaY * leftDeltaY;
  const rightDistance = rightDeltaX * rightDeltaX + rightDeltaY * rightDeltaY;
  return leftDistance != rightDistance
    ? leftDistance < rightDistance
    : leftX != rightX
      ? leftX < rightX
      : leftY < rightY;
}

function collectVisibilityPreviewCandidates(
  statePointer: u32,
  candidatesXPointer: u32,
  candidatesYPointer: u32,
  candidateCount: u32,
  currentIndex: u32,
  outputPointer: u32,
): u32 {
  const limit = load<u32>(statePointer + ROUTE_PREVIEW_CANDIDATE_LIMIT_OFFSET);
  if (candidateCount <= limit) {
    let index: u32 = 0;
    while (index < candidateCount) {
      store<u32>(outputPointer + index * sizeof<u32>(), index);
      index += 1;
    }
    return candidateCount;
  }
  store<u32>(outputPointer, 0);
  store<u32>(outputPointer + sizeof<u32>(), 1);
  const selectedLimit = limit - 2;
  const currentX = <i32>load<u32>(candidatesXPointer + currentIndex * sizeof<u32>());
  const currentY = <i32>load<u32>(candidatesYPointer + currentIndex * sizeof<u32>());
  let selectedCount: u32 = 0;
  let candidateIndex: u32 = 2;
  while (candidateIndex < candidateCount) {
    let insertionIndex = selectedCount;
    while (
      insertionIndex > 0 &&
      visibilityPreviewCandidateComesFirst(
        candidateIndex,
        load<u32>(outputPointer + (insertionIndex + 1) * sizeof<u32>()),
        currentX,
        currentY,
        candidatesXPointer,
        candidatesYPointer,
      )
    ) {
      if (insertionIndex < selectedLimit) {
        store<u32>(
          outputPointer + (insertionIndex + 2) * sizeof<u32>(),
          load<u32>(outputPointer + (insertionIndex + 1) * sizeof<u32>()),
        );
      }
      insertionIndex -= 1;
    }
    if (insertionIndex < selectedLimit) {
      store<u32>(outputPointer + (insertionIndex + 2) * sizeof<u32>(), candidateIndex);
      if (selectedCount < selectedLimit) selectedCount += 1;
    }
    candidateIndex += 1;
  }
  return selectedCount + 2;
}

function publishVisibilityPreview(
  contextPointer: u32,
  statePointer: u32,
  candidatesXPointer: u32,
  candidatesYPointer: u32,
  candidateCount: u32,
  previousPointer: u32,
  currentIndex: u32,
  bestPathTargetIndex: u32,
): void {
  publishVisibilityPreviewPath(
    contextPointer,
    statePointer,
    candidatesXPointer,
    candidatesYPointer,
    candidateCount,
    currentIndex,
    createVisibilityPath(
      candidatesXPointer,
      candidatesYPointer,
      previousPointer,
      bestPathTargetIndex,
      candidateCount,
    ),
  );
}

/** Serializes a visibility preview from an already reconstructed path, shared by stateless and Step labels. */
function publishVisibilityPreviewPath(
  contextPointer: u32,
  statePointer: u32,
  candidatesXPointer: u32,
  candidatesYPointer: u32,
  candidateCount: u32,
  currentIndex: u32,
  pathPointer: u32,
): void {
  const acceptedPointer = load<u32>(statePointer + ROUTE_PREVIEW_ACCEPTED_POINTER_OFFSET);
  const acceptedCount = load<u32>(statePointer + ROUTE_PREVIEW_ACCEPTED_COUNT_OFFSET);
  const bestPathLength = load<u32>(pathPointer + 2 * sizeof<u32>());
  const candidateLimit = load<u32>(statePointer + ROUTE_PREVIEW_CANDIDATE_LIMIT_OFFSET);
  const candidateIndexesPointer = reserveArena(candidateLimit * sizeof<u32>(), sizeof<u32>());
  const previewCandidateCount = collectVisibilityPreviewCandidates(
    statePointer,
    candidatesXPointer,
    candidatesYPointer,
    candidateCount,
    currentIndex,
    candidateIndexesPointer,
  );
  const pointCount = acceptedCount * 2 + bestPathLength + previewCandidateCount + 1;
  const pointsXPointer = reserveArena(pointCount * sizeof<f64>(), sizeof<f64>());
  const pointsYPointer = reserveArena(pointCount * sizeof<f64>(), sizeof<f64>());
  const acceptedIndexesPointer =
    acceptedCount == 0 ? 0 : reserveArena(acceptedCount * 2 * sizeof<u32>(), sizeof<u32>());
  const bestPathIndexesPointer = reserveArena(bestPathLength * sizeof<u32>(), sizeof<u32>());
  const candidateOutputIndexesPointer = reserveArena(previewCandidateCount * sizeof<u32>(), sizeof<u32>());
  let pointIndex: u32 = 0;
  let edgeIndex: u32 = 0;
  while (edgeIndex < acceptedCount) {
    const edgePointer = acceptedPointer + edgeIndex * ROUTE_PREVIEW_ACCEPTED_EDGE_BYTE_LENGTH;
    let endpoint: u32 = 0;
    while (endpoint < 2) {
      const coordinateOffset = endpoint * 8;
      store<f64>(pointsXPointer + pointIndex * sizeof<f64>(), <f64>load<u32>(edgePointer + coordinateOffset));
      store<f64>(pointsYPointer + pointIndex * sizeof<f64>(), <f64>load<u32>(edgePointer + coordinateOffset + 4));
      store<u32>(acceptedIndexesPointer + pointIndex * sizeof<u32>(), pointIndex);
      pointIndex += 1;
      endpoint += 1;
    }
    edgeIndex += 1;
  }
  const pathXPointer = load<u32>(pathPointer);
  const pathYPointer = load<u32>(pathPointer + sizeof<u32>());
  let pathIndex: u32 = 0;
  while (pathIndex < bestPathLength) {
    store<f64>(pointsXPointer + pointIndex * sizeof<f64>(), load<f64>(pathXPointer + pathIndex * sizeof<f64>()));
    store<f64>(pointsYPointer + pointIndex * sizeof<f64>(), load<f64>(pathYPointer + pathIndex * sizeof<f64>()));
    store<u32>(bestPathIndexesPointer + pathIndex * sizeof<u32>(), pointIndex);
    pointIndex += 1;
    pathIndex += 1;
  }
  let previewCandidateIndex: u32 = 0;
  while (previewCandidateIndex < previewCandidateCount) {
    const sourceIndex = load<u32>(candidateIndexesPointer + previewCandidateIndex * sizeof<u32>());
    store<f64>(pointsXPointer + pointIndex * sizeof<f64>(), <f64>load<u32>(candidatesXPointer + sourceIndex * sizeof<u32>()));
    store<f64>(pointsYPointer + pointIndex * sizeof<f64>(), <f64>load<u32>(candidatesYPointer + sourceIndex * sizeof<u32>()));
    store<u32>(candidateOutputIndexesPointer + previewCandidateIndex * sizeof<u32>(), pointIndex);
    pointIndex += 1;
    previewCandidateIndex += 1;
  }
  const currentPointIndex = pointIndex;
  store<f64>(pointsXPointer + pointIndex * sizeof<f64>(), <f64>load<u32>(candidatesXPointer + currentIndex * sizeof<u32>()));
  store<f64>(pointsYPointer + pointIndex * sizeof<f64>(), <f64>load<u32>(candidatesYPointer + currentIndex * sizeof<u32>()));
  const recordPointer = appendRoutePreviewEventRecord(statePointer);
  store<u32>(recordPointer + Layout.ROUTE_PREVIEW_POINTS_X_POINTER_OFFSET, pointsXPointer);
  store<u32>(recordPointer + Layout.ROUTE_PREVIEW_POINTS_Y_POINTER_OFFSET, pointsYPointer);
  store<u32>(recordPointer + Layout.ROUTE_PREVIEW_POINT_COUNT_OFFSET, pointCount);
  store<u32>(recordPointer + Layout.ROUTE_PREVIEW_ACCEPTED_INDEXES_POINTER_OFFSET, acceptedIndexesPointer);
  store<u32>(recordPointer + Layout.ROUTE_PREVIEW_ACCEPTED_INDEXES_LENGTH_OFFSET, acceptedCount * 2);
  store<u32>(recordPointer + Layout.ROUTE_PREVIEW_BEST_PATH_INDEXES_POINTER_OFFSET, bestPathIndexesPointer);
  store<u32>(recordPointer + Layout.ROUTE_PREVIEW_BEST_PATH_INDEXES_LENGTH_OFFSET, bestPathLength);
  store<u32>(recordPointer + Layout.ROUTE_PREVIEW_CANDIDATE_INDEXES_POINTER_OFFSET, candidateOutputIndexesPointer);
  store<u32>(recordPointer + Layout.ROUTE_PREVIEW_CANDIDATE_INDEXES_LENGTH_OFFSET, previewCandidateCount);
  store<u32>(recordPointer + Layout.ROUTE_PREVIEW_CURRENT_INDEX_OFFSET, currentPointIndex);
  store<u32>(
    recordPointer + Layout.ROUTE_PREVIEW_FLAGS_OFFSET,
    load<u32>(contextPointer + Layout.ROUTE_CONTEXT_FLAGS_OFFSET) & Layout.ROUTE_CONTEXT_FLAG_MIRRORED,
  );
}

function runVisibilityGraphSearch(inputPointer: u32, inputByteLength: u32): u32 {
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
  const previewStatePointer =
    shouldCollectPreviews == 0
      ? 0
      : createRoutePreviewState(
          load<u32>(contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_PREVIEW_EDGE_LIMIT_OFFSET),
          load<u32>(contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_PREVIEW_CANDIDATE_LIMIT_OFFSET),
        );
  if (
    pointHitsRouteContext(contextPointer, startX, startY) ||
    pointHitsRouteContext(contextPointer, targetX, targetY) ||
    targetX < startX
  ) return createNoRouteSearchResult(0, previewStatePointer);
  if (targetX > startX && !lineHitsRouteContext(contextPointer, startX, startY, targetX, targetY)) {
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
  const candidatesPointer = collectVisibilityCandidates(contextPointer, startX, startY, targetX, targetY);
  const candidatesXPointer = load<u32>(candidatesPointer + VISIBILITY_CANDIDATE_X_POINTER_OFFSET);
  const candidatesYPointer = load<u32>(candidatesPointer + VISIBILITY_CANDIDATE_Y_POINTER_OFFSET);
  const candidateCount = load<u32>(candidatesPointer + VISIBILITY_CANDIDATE_COUNT_OFFSET);
  const hasStatePointer = reserveArena(candidateCount, 1);
  const openPointer = reserveArena(candidateCount, 1);
  const closedPointer = reserveArena(candidateCount, 1);
  memory.fill(hasStatePointer, 0, candidateCount);
  memory.fill(openPointer, 0, candidateCount);
  memory.fill(closedPointer, 0, candidateCount);
  const segmentsPointer = reserveArena(candidateCount * sizeof<u32>(), sizeof<u32>());
  const secondaryPointer = reserveArena(candidateCount * sizeof<f64>(), sizeof<f64>());
  const previousPointer = reserveArena(candidateCount * sizeof<i32>(), sizeof<i32>());
  memory.fill(previousPointer, 0xff, candidateCount * sizeof<i32>());
  store<u8>(hasStatePointer, 1);
  store<u8>(openPointer, 1);
  store<u32>(segmentsPointer, 0);
  store<f64>(secondaryPointer, 0);
  const heapPointer = reserveArena(VISIBILITY_HEAP_BYTE_LENGTH, sizeof<u32>());
  memory.fill(heapPointer, 0, VISIBILITY_HEAP_BYTE_LENGTH);
  pushVisibilityHeap(heapPointer, 0, 0, 0, candidatesXPointer, candidatesYPointer, 1);
  const poppedPointer = reserveArena(VISIBILITY_HEAP_NODE_BYTE_LENGTH, sizeof<u64>());
  let expansions: u32 = 0;
  while (popVisibilityHeap(heapPointer, poppedPointer, candidatesXPointer, candidatesYPointer, 1)) {
    const currentIndex = load<u32>(poppedPointer + VISIBILITY_HEAP_NODE_INDEX_OFFSET);
    const currentSegments = load<u32>(poppedPointer + VISIBILITY_HEAP_NODE_SEGMENTS_OFFSET);
    const currentSecondary = load<f64>(poppedPointer + VISIBILITY_HEAP_NODE_SECONDARY_OFFSET);
    if (
      load<u8>(openPointer + currentIndex) == 0 ||
      load<u8>(closedPointer + currentIndex) != 0 ||
      currentSegments != load<u32>(segmentsPointer + currentIndex * sizeof<u32>()) ||
      currentSecondary != load<f64>(secondaryPointer + currentIndex * sizeof<f64>())
    ) continue;
    store<u8>(openPointer + currentIndex, 0);
    if (currentIndex == 1) {
      const pathPointer = createVisibilityPath(
        candidatesXPointer,
        candidatesYPointer,
        previousPointer,
        currentIndex,
        candidateCount,
      );
      if (previewStatePointer != 0) {
        publishVisibilityPreview(
          contextPointer,
          previewStatePointer,
          candidatesXPointer,
          candidatesYPointer,
          candidateCount,
          previousPointer,
          currentIndex,
          currentIndex,
        );
      }
      return createSuccessfulThetaResult(pathPointer, expansions, previewStatePointer);
    }
    store<u8>(closedPointer + currentIndex, 1);
    const currentX = <i32>load<u32>(candidatesXPointer + currentIndex * sizeof<u32>());
    const currentY = <i32>load<u32>(candidatesYPointer + currentIndex * sizeof<u32>());
    let nextIndex: u32 = 0;
    while (nextIndex < candidateCount) {
      if (nextIndex != currentIndex && load<u8>(closedPointer + nextIndex) == 0) {
        const nextX = <i32>load<u32>(candidatesXPointer + nextIndex * sizeof<u32>());
        const nextY = <i32>load<u32>(candidatesYPointer + nextIndex * sizeof<u32>());
        if (nextX > currentX && !lineHitsRouteContext(contextPointer, currentX, currentY, nextX, nextY)) {
          if (previewStatePointer != 0) {
            appendRoutePreviewAcceptedEdge(previewStatePointer, currentX, currentY, nextX, nextY);
          }
          const nextSegments = currentSegments + 1;
          const nextSecondary = currentSecondary + planePointDistance(currentX, currentY, nextX, nextY);
          const hasPrevious = load<u8>(hasStatePointer + nextIndex) != 0;
          const previousSegments = load<u32>(segmentsPointer + nextIndex * sizeof<u32>());
          const previousSecondary = load<f64>(secondaryPointer + nextIndex * sizeof<f64>());
          if (
            !hasPrevious ||
            previousSegments > nextSegments ||
            (previousSegments == nextSegments &&
              !nearlyEqualVisibilityCosts(previousSecondary, nextSecondary) &&
              previousSecondary > nextSecondary)
          ) {
            store<u8>(hasStatePointer + nextIndex, 1);
            store<u8>(openPointer + nextIndex, 1);
            store<u32>(segmentsPointer + nextIndex * sizeof<u32>(), nextSegments);
            store<f64>(secondaryPointer + nextIndex * sizeof<f64>(), nextSecondary);
            store<i32>(previousPointer + nextIndex * sizeof<i32>(), <i32>currentIndex);
            pushVisibilityHeap(
              heapPointer,
              nextIndex,
              nextSegments,
              nextSecondary,
              candidatesXPointer,
              candidatesYPointer,
              1,
            );
          }
        }
      }
      nextIndex += 1;
    }
    expansions += 1;
    if (
      previewStatePointer != 0 &&
      expansions % load<u32>(contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_PREVIEW_EXPANSION_INTERVAL_OFFSET) == 0
    ) {
      const bestOpenIndex = selectBestOpenVisibilityIndex(
        openPointer,
        segmentsPointer,
        secondaryPointer,
        candidateCount,
        candidatesXPointer,
        candidatesYPointer,
        1,
      );
      publishVisibilityPreview(
        contextPointer,
        previewStatePointer,
        candidatesXPointer,
        candidatesYPointer,
        candidateCount,
        previousPointer,
        currentIndex,
        bestOpenIndex < 0 ? currentIndex : <u32>bestOpenIndex,
      );
    }
  }
  return createNoRouteSearchResult(expansions, previewStatePointer);
}

@inline
function visibilityCandidateCellIndex(candidatesXPointer: u32, candidatesYPointer: u32, candidateIndex: u32): u32 {
  return (
    load<u32>(candidatesYPointer + candidateIndex * sizeof<u32>()) * getPlaneWidth() +
    load<u32>(candidatesXPointer + candidateIndex * sizeof<u32>())
  );
}

function createStepVisibilityStatePath(
  tablePointer: u32,
  targetStateIndex: u32,
  candidatesXPointer: u32,
  candidatesYPointer: u32,
): u32 {
  const stateCount = load<u32>(tablePointer + STEP_STATE_TABLE_COUNT_OFFSET);
  let pathLength: u32 = 0;
  let stateIndex = targetStateIndex;
  while (pathLength <= stateCount) {
    pathLength += 1;
    const statePointer = stepStateRecordPointer(tablePointer, stateIndex);
    const parentIndex = load<u32>(statePointer + STEP_STATE_PARENT_INDEX_OFFSET);
    if (parentIndex == stateIndex) break;
    stateIndex = parentIndex;
  }
  if (pathLength > stateCount) trap();
  const pathXPointer = reserveArena(pathLength * sizeof<f64>(), sizeof<f64>());
  const pathYPointer = reserveArena(pathLength * sizeof<f64>(), sizeof<f64>());
  let pathIndex = pathLength;
  stateIndex = targetStateIndex;
  while (pathIndex > 0) {
    pathIndex -= 1;
    const statePointer = stepStateRecordPointer(tablePointer, stateIndex);
    const candidateIndex = load<u32>(statePointer + STEP_STATE_CELL_INDEX_OFFSET);
    store<f64>(
      pathXPointer + pathIndex * sizeof<f64>(),
      <f64>load<u32>(candidatesXPointer + candidateIndex * sizeof<u32>()),
    );
    store<f64>(
      pathYPointer + pathIndex * sizeof<f64>(),
      <f64>load<u32>(candidatesYPointer + candidateIndex * sizeof<u32>()),
    );
    const parentIndex = load<u32>(statePointer + STEP_STATE_PARENT_INDEX_OFFSET);
    if (parentIndex == stateIndex) break;
    stateIndex = parentIndex;
  }
  const pathPointer = reserveArena(3 * sizeof<u32>(), sizeof<u32>());
  store<u32>(pathPointer, pathXPointer);
  store<u32>(pathPointer + sizeof<u32>(), pathYPointer);
  store<u32>(pathPointer + 2 * sizeof<u32>(), pathLength);
  return pathPointer;
}

/** Matches the stateful TS visibility queue: estimated cost, paid cost, geometry, then exact state. */
function compareStepVisibilityStates(
  contextPointer: u32,
  tablePointer: u32,
  leftStateIndex: u32,
  rightStateIndex: u32,
  candidatesXPointer: u32,
  candidatesYPointer: u32,
  startCellIndex: u32,
  targetCellIndex: u32,
  exactStartY: f64,
  exactTargetY: f64,
): i32 {
  const leftPointer = stepStateRecordPointer(tablePointer, leftStateIndex);
  const rightPointer = stepStateRecordPointer(tablePointer, rightStateIndex);
  const leftSegments = load<u32>(leftPointer + STEP_STATE_COST_SEGMENTS_OFFSET);
  const rightSegments = load<u32>(rightPointer + STEP_STATE_COST_SEGMENTS_OFFSET);
  if (leftSegments != rightSegments) return leftSegments < rightSegments ? -1 : 1;
  const leftCandidate = load<u32>(leftPointer + STEP_STATE_CELL_INDEX_OFFSET);
  const rightCandidate = load<u32>(rightPointer + STEP_STATE_CELL_INDEX_OFFSET);
  const leftCell = visibilityCandidateCellIndex(candidatesXPointer, candidatesYPointer, leftCandidate);
  const rightCell = visibilityCandidateCellIndex(candidatesXPointer, candidatesYPointer, rightCandidate);
  const targetGraphY = stepGraphYForCell(
    contextPointer,
    targetCellIndex,
    startCellIndex,
    targetCellIndex,
    exactStartY,
    exactTargetY,
  );
  const leftEstimated =
    load<f64>(leftPointer + STEP_STATE_COST_SECONDARY_OFFSET) +
    NativeMath.abs(
      targetGraphY -
        stepGraphYForCell(
          contextPointer,
          leftCell,
          startCellIndex,
          targetCellIndex,
          exactStartY,
          exactTargetY,
        ),
    );
  const rightEstimated =
    load<f64>(rightPointer + STEP_STATE_COST_SECONDARY_OFFSET) +
    NativeMath.abs(
      targetGraphY -
        stepGraphYForCell(
          contextPointer,
          rightCell,
          startCellIndex,
          targetCellIndex,
          exactStartY,
          exactTargetY,
        ),
    );
  if (!stepSecondaryValuesAreNearlyEqual(leftEstimated, rightEstimated)) {
    return leftEstimated < rightEstimated ? -1 : 1;
  }
  let comparison = compareStepCosts(
    leftSegments,
    load<f64>(leftPointer + STEP_STATE_COST_SECONDARY_OFFSET),
    rightSegments,
    load<f64>(rightPointer + STEP_STATE_COST_SECONDARY_OFFSET),
  );
  if (comparison != 0) return comparison;
  const targetX = <i32>load<u32>(candidatesXPointer + sizeof<u32>());
  const targetY = <i32>load<u32>(candidatesYPointer + sizeof<u32>());
  const leftX = <i32>load<u32>(candidatesXPointer + leftCandidate * sizeof<u32>());
  const leftY = <i32>load<u32>(candidatesYPointer + leftCandidate * sizeof<u32>());
  const rightX = <i32>load<u32>(candidatesXPointer + rightCandidate * sizeof<u32>());
  const rightY = <i32>load<u32>(candidatesYPointer + rightCandidate * sizeof<u32>());
  const leftRemainingX = targetX >= leftX ? targetX - leftX : leftX - targetX;
  const rightRemainingX = targetX >= rightX ? targetX - rightX : rightX - targetX;
  if (leftRemainingX != rightRemainingX) return leftRemainingX < rightRemainingX ? -1 : 1;
  const leftRemainingY = targetY >= leftY ? targetY - leftY : leftY - targetY;
  const rightRemainingY = targetY >= rightY ? targetY - rightY : rightY - targetY;
  if (leftRemainingY != rightRemainingY) return leftRemainingY < rightRemainingY ? -1 : 1;
  if (leftCandidate != rightCandidate) return leftCandidate < rightCandidate ? -1 : 1;
  const leftResolvedY = load<f64>(leftPointer + STEP_STATE_RESOLVED_Y_OFFSET);
  const rightResolvedY = load<f64>(rightPointer + STEP_STATE_RESOLVED_Y_OFFSET);
  if (leftResolvedY != rightResolvedY) return leftResolvedY < rightResolvedY ? -1 : 1;
  return compareStepRouteKeys(leftPointer, rightPointer);
}

function selectBestOpenStepVisibilityState(
  contextPointer: u32,
  tablePointer: u32,
  candidatesXPointer: u32,
  candidatesYPointer: u32,
  startCellIndex: u32,
  targetCellIndex: u32,
  exactStartY: f64,
  exactTargetY: f64,
): u32 {
  const stateCount = load<u32>(tablePointer + STEP_STATE_TABLE_COUNT_OFFSET);
  let bestIndex = STEP_STATE_MISSING_INDEX;
  let stateIndex: u32 = 0;
  while (stateIndex < stateCount) {
    if (
      load<u32>(stepStateRecordPointer(tablePointer, stateIndex) + STEP_STATE_IS_CLOSED_OFFSET) == 0 &&
      (bestIndex == STEP_STATE_MISSING_INDEX ||
        compareStepVisibilityStates(
          contextPointer,
          tablePointer,
          stateIndex,
          bestIndex,
          candidatesXPointer,
          candidatesYPointer,
          startCellIndex,
          targetCellIndex,
          exactStartY,
          exactTargetY,
        ) < 0)
    ) bestIndex = stateIndex;
    stateIndex += 1;
  }
  return bestIndex;
}

function relaxStepVisibilityTransition(
  contextPointer: u32,
  tablePointer: u32,
  previewStatePointer: u32,
  currentStateIndex: u32,
  nextCandidateIndex: u32,
  candidatesXPointer: u32,
  candidatesYPointer: u32,
  startCellIndex: u32,
  targetCellIndex: u32,
  exactStartX: f64,
  exactStartY: f64,
  exactTargetX: f64,
  exactTargetY: f64,
): void {
  const currentPointer = stepStateRecordPointer(tablePointer, currentStateIndex);
  const currentCandidateIndex = load<u32>(currentPointer + STEP_STATE_CELL_INDEX_OFFSET);
  const currentCellIndex = visibilityCandidateCellIndex(
    candidatesXPointer,
    candidatesYPointer,
    currentCandidateIndex,
  );
  const nextCellIndex = visibilityCandidateCellIndex(candidatesXPointer, candidatesYPointer, nextCandidateIndex);
  const edgeMark = markArena();
  const resultPointer = runStepSearchEdgeTransition(
    contextPointer,
    currentCellIndex,
    nextCellIndex,
    startCellIndex,
    targetCellIndex,
    exactStartX,
    exactStartY,
    exactTargetX,
    exactTargetY,
    load<f64>(currentPointer + STEP_STATE_RESOLVED_Y_OFFSET),
    load<i32>(currentPointer + STEP_STATE_SIGN_OFFSET),
    load<u32>(currentPointer + STEP_STATE_LIMB_POINTER_OFFSET),
    load<u32>(currentPointer + STEP_STATE_LIMB_COUNT_OFFSET),
  );
  if (
    load<u32>(resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATUS_OFFSET) !=
    Layout.ROUTE_STEP_TRANSITION_STATUS_SUCCESS
  ) {
    resetArena(edgeMark);
    return;
  }
  const nextSign = load<i32>(resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATE_SIGN_OFFSET);
  const nextStatePointer = load<u32>(resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATE_POINTER_OFFSET);
  const nextStateCount = load<u32>(resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATE_COUNT_OFFSET);
  const nextResolvedY = load<f64>(resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_RESOLVED_END_Y_OFFSET);
  const nextSegments = load<u32>(currentPointer + STEP_STATE_COST_SEGMENTS_OFFSET) + 1;
  const nextSecondary =
    load<f64>(currentPointer + STEP_STATE_COST_SECONDARY_OFFSET) +
    load<f64>(resultPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_SECONDARY_COST_OFFSET);
  let nextStateIndex = findStepStateIndex(
    tablePointer,
    nextCandidateIndex,
    nextSign,
    nextStatePointer,
    nextStateCount,
  );
  if (nextStateIndex != STEP_STATE_MISSING_INDEX) {
    const previousPointer = stepStateRecordPointer(tablePointer, nextStateIndex);
    if (
      compareStepCosts(
        load<u32>(previousPointer + STEP_STATE_COST_SEGMENTS_OFFSET),
        load<f64>(previousPointer + STEP_STATE_COST_SECONDARY_OFFSET),
        nextSegments,
        nextSecondary,
      ) <= 0
    ) {
      resetArena(edgeMark);
    } else {
      resetArena(edgeMark);
      const refreshedPointer = stepStateRecordPointer(tablePointer, nextStateIndex);
      store<f64>(refreshedPointer + STEP_STATE_RESOLVED_Y_OFFSET, nextResolvedY);
      store<u32>(refreshedPointer + STEP_STATE_COST_SEGMENTS_OFFSET, nextSegments);
      store<u32>(refreshedPointer + STEP_STATE_IS_CLOSED_OFFSET, 0);
      store<f64>(refreshedPointer + STEP_STATE_COST_SECONDARY_OFFSET, nextSecondary);
      store<u32>(refreshedPointer + STEP_STATE_PARENT_INDEX_OFFSET, currentStateIndex);
    }
  } else {
    nextStateIndex = appendStepState(
      tablePointer,
      nextCandidateIndex,
      nextSign,
      nextStatePointer,
      nextStateCount,
      nextResolvedY,
      nextSegments,
      nextSecondary,
      currentStateIndex,
    );
    commitArena(edgeMark);
  }
  if (previewStatePointer != 0) {
    appendRoutePreviewAcceptedEdge(
      previewStatePointer,
      <i32>load<u32>(candidatesXPointer + currentCandidateIndex * sizeof<u32>()),
      <i32>load<u32>(candidatesYPointer + currentCandidateIndex * sizeof<u32>()),
      <i32>load<u32>(candidatesXPointer + nextCandidateIndex * sizeof<u32>()),
      <i32>load<u32>(candidatesYPointer + nextCandidateIndex * sizeof<u32>()),
    );
  }
}

function runStepVisibilityGraphSearch(inputPointer: u32, inputByteLength: u32): u32 {
  if (inputByteLength != Layout.ROUTE_STEP_SEARCH_INPUT_BYTE_LENGTH) trap();
  requireArenaRange(inputPointer, inputByteLength, sizeof<f64>());
  const contextPointer = load<u32>(inputPointer + Layout.ROUTE_STEP_SEARCH_INPUT_CONTEXT_POINTER_OFFSET);
  requireRouteContext(contextPointer);
  if ((load<u32>(contextPointer + Layout.ROUTE_CONTEXT_FLAGS_OFFSET) & Layout.ROUTE_CONTEXT_FLAG_STEP_MODEL) == 0) {
    trap();
  }
  const startX = readPlaneCoordinate(inputPointer, Layout.ROUTE_STEP_SEARCH_INPUT_START_X_OFFSET, getPlaneWidth());
  const startY = readPlaneCoordinate(inputPointer, Layout.ROUTE_STEP_SEARCH_INPUT_START_Y_OFFSET, getPlaneHeight());
  const targetX = readPlaneCoordinate(inputPointer, Layout.ROUTE_STEP_SEARCH_INPUT_TARGET_X_OFFSET, getPlaneWidth());
  const targetY = readPlaneCoordinate(inputPointer, Layout.ROUTE_STEP_SEARCH_INPUT_TARGET_Y_OFFSET, getPlaneHeight());
  const shouldCollectPreviews = load<u32>(inputPointer + Layout.ROUTE_STEP_SEARCH_INPUT_COLLECT_PREVIEWS_OFFSET);
  const initialResolvedY = load<f64>(inputPointer + Layout.ROUTE_STEP_SEARCH_INPUT_RESOLVED_Y_OFFSET);
  const initialSign = load<i32>(inputPointer + Layout.ROUTE_STEP_SEARCH_INPUT_STATE_SIGN_OFFSET);
  const initialStatePointer = load<u32>(inputPointer + Layout.ROUTE_STEP_SEARCH_INPUT_STATE_POINTER_OFFSET);
  const initialStateCount = load<u32>(inputPointer + Layout.ROUTE_STEP_SEARCH_INPUT_STATE_COUNT_OFFSET);
  const exactStartX = load<f64>(inputPointer + Layout.ROUTE_STEP_SEARCH_INPUT_EXACT_START_X_OFFSET);
  const exactStartY = load<f64>(inputPointer + Layout.ROUTE_STEP_SEARCH_INPUT_EXACT_START_Y_OFFSET);
  const exactTargetX = load<f64>(inputPointer + Layout.ROUTE_STEP_SEARCH_INPUT_EXACT_TARGET_X_OFFSET);
  const exactTargetY = load<f64>(inputPointer + Layout.ROUTE_STEP_SEARCH_INPUT_EXACT_TARGET_Y_OFFSET);
  if (
    shouldCollectPreviews > 1 ||
    !isFiniteValue(initialResolvedY) ||
    !isFiniteValue(exactStartX) ||
    !isFiniteValue(exactStartY) ||
    !isFiniteValue(exactTargetX) ||
    !isFiniteValue(exactTargetY) ||
    initialStateCount > u32.MAX_VALUE / sizeof<u32>()
  ) trap();
  requireArenaRange(
    initialStateCount == 0 ? 0 : initialStatePointer,
    initialStateCount * sizeof<u32>(),
    sizeof<u32>(),
  );
  if (
    (initialStateCount == 0 && initialSign != 0) ||
    (initialStateCount != 0 && (initialSign != -1 && initialSign != 1)) ||
    (initialStateCount != 0 && load<u32>(initialStatePointer + (initialStateCount - 1) * sizeof<u32>()) == 0)
  ) trap();
  const previewStatePointer =
    shouldCollectPreviews == 0
      ? 0
      : createRoutePreviewState(
          load<u32>(contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_PREVIEW_EDGE_LIMIT_OFFSET),
          load<u32>(contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_PREVIEW_CANDIDATE_LIMIT_OFFSET),
        );
  if (
    pointHitsRouteContext(contextPointer, startX, startY) ||
    pointHitsRouteContext(contextPointer, targetX, targetY) ||
    targetX < startX ||
    (targetX == startX && targetY != startY)
  ) return createNoStepSearchResult(0, previewStatePointer);
  const width = getPlaneWidth();
  const startCellIndex = <u32>startY * width + <u32>startX;
  const targetCellIndex = <u32>targetY * width + <u32>targetX;
  if (targetX > startX) {
    const directMark = markArena();
    const transitionPointer = runStepSearchEdgeTransition(
      contextPointer,
      startCellIndex,
      targetCellIndex,
      startCellIndex,
      targetCellIndex,
      exactStartX,
      exactStartY,
      exactTargetX,
      exactTargetY,
      initialResolvedY,
      initialSign,
      initialStatePointer,
      initialStateCount,
    );
    if (
      load<u32>(transitionPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATUS_OFFSET) ==
      Layout.ROUTE_STEP_TRANSITION_STATUS_SUCCESS
    ) {
      const pathXPointer = reserveArena(2 * sizeof<f64>(), sizeof<f64>());
      const pathYPointer = reserveArena(2 * sizeof<f64>(), sizeof<f64>());
      store<f64>(pathXPointer, <f64>startX);
      store<f64>(pathXPointer + sizeof<f64>(), <f64>targetX);
      store<f64>(pathYPointer, <f64>startY);
      store<f64>(pathYPointer + sizeof<f64>(), <f64>targetY);
      const pathPointer = reserveArena(3 * sizeof<u32>(), sizeof<u32>());
      store<u32>(pathPointer, pathXPointer);
      store<u32>(pathPointer + sizeof<u32>(), pathYPointer);
      store<u32>(pathPointer + 2 * sizeof<u32>(), 2);
      if (previewStatePointer != 0) {
        publishDirectThetaPreview(contextPointer, previewStatePointer, startX, startY, targetX, targetY);
      }
      commitArena(directMark);
      return createStepSearchResult(
        Layout.ROUTE_STEP_SEARCH_RESULT_STATUS_SUCCESS,
        pathPointer,
        0,
        previewStatePointer,
        load<f64>(transitionPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_RESOLVED_END_Y_OFFSET),
        load<i32>(transitionPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATE_SIGN_OFFSET),
        load<u32>(transitionPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATE_POINTER_OFFSET),
        load<u32>(transitionPointer + Layout.ROUTE_STEP_TRANSITION_RESULT_STATE_COUNT_OFFSET),
      );
    }
    resetArena(directMark);
  }
  const candidatesPointer = collectVisibilityCandidates(contextPointer, startX, startY, targetX, targetY);
  const candidatesXPointer = load<u32>(candidatesPointer + VISIBILITY_CANDIDATE_X_POINTER_OFFSET);
  const candidatesYPointer = load<u32>(candidatesPointer + VISIBILITY_CANDIDATE_Y_POINTER_OFFSET);
  const candidateCount = load<u32>(candidatesPointer + VISIBILITY_CANDIDATE_COUNT_OFFSET);
  const tablePointer = createStepStateTable();
  const startStateIndex = appendStepState(
    tablePointer,
    0,
    initialSign,
    initialStatePointer,
    initialStateCount,
    initialResolvedY,
    0,
    0,
    0,
  );
  store<u32>(stepStateRecordPointer(tablePointer, startStateIndex) + STEP_STATE_PARENT_INDEX_OFFSET, startStateIndex);
  let expansions: u32 = 0;
  while (true) {
    const currentStateIndex = selectBestOpenStepVisibilityState(
      contextPointer,
      tablePointer,
      candidatesXPointer,
      candidatesYPointer,
      startCellIndex,
      targetCellIndex,
      exactStartY,
      exactTargetY,
    );
    if (currentStateIndex == STEP_STATE_MISSING_INDEX) break;
    const currentStatePointer = stepStateRecordPointer(tablePointer, currentStateIndex);
    const currentCandidateIndex = load<u32>(currentStatePointer + STEP_STATE_CELL_INDEX_OFFSET);
    if (currentCandidateIndex == 1) {
      const pathPointer = createStepVisibilityStatePath(
        tablePointer,
        currentStateIndex,
        candidatesXPointer,
        candidatesYPointer,
      );
      if (previewStatePointer != 0) {
        publishVisibilityPreviewPath(
          contextPointer,
          previewStatePointer,
          candidatesXPointer,
          candidatesYPointer,
          candidateCount,
          currentCandidateIndex,
          pathPointer,
        );
      }
      return createStepSearchResult(
        Layout.ROUTE_STEP_SEARCH_RESULT_STATUS_SUCCESS,
        pathPointer,
        expansions,
        previewStatePointer,
        load<f64>(currentStatePointer + STEP_STATE_RESOLVED_Y_OFFSET),
        load<i32>(currentStatePointer + STEP_STATE_SIGN_OFFSET),
        load<u32>(currentStatePointer + STEP_STATE_LIMB_POINTER_OFFSET),
        load<u32>(currentStatePointer + STEP_STATE_LIMB_COUNT_OFFSET),
      );
    }
    store<u32>(currentStatePointer + STEP_STATE_IS_CLOSED_OFFSET, 1);
    const currentX = load<u32>(candidatesXPointer + currentCandidateIndex * sizeof<u32>());
    let nextCandidateIndex: u32 = 0;
    while (nextCandidateIndex < candidateCount) {
      if (
        nextCandidateIndex != currentCandidateIndex &&
        load<u32>(candidatesXPointer + nextCandidateIndex * sizeof<u32>()) > currentX
      ) {
        relaxStepVisibilityTransition(
          contextPointer,
          tablePointer,
          previewStatePointer,
          currentStateIndex,
          nextCandidateIndex,
          candidatesXPointer,
          candidatesYPointer,
          startCellIndex,
          targetCellIndex,
          exactStartX,
          exactStartY,
          exactTargetX,
          exactTargetY,
        );
      }
      nextCandidateIndex += 1;
    }
    expansions += 1;
    if (
      previewStatePointer != 0 &&
      expansions % load<u32>(contextPointer + Layout.ROUTE_CONTEXT_VISIBILITY_PREVIEW_EXPANSION_INTERVAL_OFFSET) == 0
    ) {
      const bestOpenStateIndex = selectBestOpenStepVisibilityState(
        contextPointer,
        tablePointer,
        candidatesXPointer,
        candidatesYPointer,
        startCellIndex,
        targetCellIndex,
        exactStartY,
        exactTargetY,
      );
      const bestPathStateIndex =
        bestOpenStateIndex == STEP_STATE_MISSING_INDEX ? currentStateIndex : bestOpenStateIndex;
      publishVisibilityPreviewPath(
        contextPointer,
        previewStatePointer,
        candidatesXPointer,
        candidatesYPointer,
        candidateCount,
        currentCandidateIndex,
        createStepVisibilityStatePath(
          tablePointer,
          bestPathStateIndex,
          candidatesXPointer,
          candidatesYPointer,
        ),
      );
    }
  }
  return createNoStepSearchResult(expansions, previewStatePointer);
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
  if (command == Layout.ROUTE_COMMAND_VISIBILITY_GRAPH) return runVisibilityGraphSearch(inputPointer, inputByteLength);
  if (command == Layout.ROUTE_COMMAND_STEP_TRANSITION) return runStepTransition(inputPointer, inputByteLength);
  if (command == Layout.ROUTE_COMMAND_STEP_THETA_STAR) return runStepThetaStarSearch(inputPointer, inputByteLength);
  if (command == Layout.ROUTE_COMMAND_STEP_VISIBILITY_GRAPH) {
    return runStepVisibilityGraphSearch(inputPointer, inputByteLength);
  }
  if (command == Layout.STEP_GLITCH_COMMAND_CREATE_CONTEXT) {
    return createStepGlitchGeometryContext(inputPointer, inputByteLength);
  }
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
