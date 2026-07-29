import type { GraphClosedRegion, PlaneMaskClosedRegion } from "../../pathfinding/routing/step-envelope";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../game/constants";
import type { PlaneGridPoint } from "../plane-grid";
import {
  GraphwarWasmAdapterError,
  copyGraphwarWasmBytes,
  copyGraphwarWasmUint32Values,
  validateGraphwarWasmMemoryRange,
  validateGraphwarWasmU32,
} from "./abi";
import type { GraphwarWasmKernelRuntime } from "./runtime";
import {
  packGraphwarWasmRouteContextInput,
  type GraphwarWasmRouteContextInput,
  type GraphwarWasmPoint,
} from "./task-adapter";

const routeCommand = {
  createContext: 1,
  graphRegionHit: 4,
  lineHit: 3,
  planeRegionCount: 5,
  pointHit: 2,
} as const;
const routeCreateInputByteLength = 48;
const routeContextByteLength = 152;
const routeContextMagic = 0x524f_5554;
const routeContextMirroredFlag = 1;
const routeQueryResultByteLength = 8;
const routeQueryResultMagic = 0x5152_4f55;
const routePointInputByteLength = 24;
const routeLineInputByteLength = 40;
const routeRegionInputByteLength = 40;
const routeBoundaryEdgeRecordU32Length = 5;
const planeCellCount = 770 * 450;
const summedAreaValueCount = 771 * 451;

/** Owned route-context result and collision surface; no WASM memory view escapes this object. */
export interface GraphwarWasmRouteContext {
  readonly isMirrored: boolean;
  readonly routeBoundaryEdgeCount: number;
  readonly routeComponentCount: number;
  readonly routeMask: Uint8Array;
  readonly routeObstacleCount: number;
  readonly simulationMask: Uint8Array;
  readonly simulationObstacleCount: number;
  countPlaneRegionObstacles: (region: PlaneMaskClosedRegion) => number;
  dispose: () => void;
  graphRegionHitsObstacle: (region: GraphClosedRegion) => boolean;
  lineHitsObstacle: (start: PlaneGridPoint, end: PlaneGridPoint) => boolean;
  pointHitsObstacle: (point: PlaneGridPoint) => boolean;
}

/**
 * Creates one long-lived route context below an arena mark.
 *
 * The base mask, friendly circles, canonical route policy, derived masks, summed area, component labels, and boundary
 * edges remain atomically owned until `dispose()` restores the exact mark.
 */
export function createGraphwarWasmRouteContext(
  runtime: GraphwarWasmKernelRuntime,
  input: GraphwarWasmRouteContextInput,
): GraphwarWasmRouteContext {
  const contextMark = runtime.markArena();
  let isDisposed = false;
  try {
    const packed = packGraphwarWasmRouteContextInput(runtime, input, runtime.arenaBase);
    const inputPointer = runtime.reserveArena(routeCreateInputByteLength, 8);
    const inputView = new DataView(runtime.buffer, inputPointer, routeCreateInputByteLength);
    inputView.setUint32(0, packed.sourceMask.pointer, true);
    inputView.setUint32(4, packed.sourceMask.length, true);
    inputView.setUint32(8, packed.context.pointer, true);
    inputView.setUint32(12, packed.context.length, true);
    inputView.setUint32(16, packed.friendlySoldierCenters.x.pointer, true);
    inputView.setUint32(20, packed.friendlySoldierCenters.y.pointer, true);
    inputView.setUint32(24, packed.friendlySoldierCenters.length, true);
    inputView.setUint32(28, packed.routePolicy.pointer, true);
    inputView.setUint32(32, packed.routePolicy.length, true);
    inputView.setUint32(36, packed.thetaStarLookaheadColumnOffsets.pointer, true);
    inputView.setUint32(40, packed.thetaStarLookaheadColumnOffsets.length, true);

    const contextPointer = runtime.runRouteTask(routeCommand.createContext, inputPointer, routeCreateInputByteLength);
    const contextRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: routeContextByteLength, pointer: contextPointer },
      { alignment: 8, elementByteLength: 1, minimumPointer: runtime.arenaBase },
    );
    const contextView = new DataView(contextRange.buffer, contextRange.byteOffset, contextRange.byteLength);
    if (contextView.getUint32(0, true) !== routeContextMagic) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-pointer",
        "Graphwar WASM route context magic is invalid",
        "output",
      );
    }
    const flags = contextView.getUint32(4, true);
    if ((flags & ~routeContextMirroredFlag) !== 0) {
      throw new GraphwarWasmAdapterError("invalid-enum", "Graphwar WASM route context flags are invalid", "output");
    }
    const isMirrored = (flags & routeContextMirroredFlag) !== 0;
    if (isMirrored !== input.bounds.minX > input.bounds.maxX) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        "Graphwar WASM route context mirror identity does not match its bounds",
        "output",
      );
    }
    validateRouteContextIdentity(contextView, input, packed.routePolicy, packed.thetaStarLookaheadColumnOffsets);

    const routeMask = copyGraphwarWasmBytes(
      runtime,
      { length: contextView.getUint32(12, true), pointer: contextView.getUint32(8, true) },
      runtime.arenaBase,
    );
    const simulationMask = copyGraphwarWasmBytes(
      runtime,
      { length: contextView.getUint32(20, true), pointer: contextView.getUint32(16, true) },
      runtime.arenaBase,
    );
    if (routeMask.length !== planeCellCount || simulationMask.length !== planeCellCount) {
      throw new GraphwarWasmAdapterError(
        "invalid-image-data",
        "Graphwar WASM route masks have invalid lengths",
        "output",
      );
    }
    validateGraphwarWasmMemoryRange(
      runtime,
      { length: contextView.getUint32(28, true), pointer: contextView.getUint32(24, true) },
      { alignment: 4, elementByteLength: 4, minimumPointer: runtime.arenaBase },
    );
    if (contextView.getUint32(28, true) !== summedAreaValueCount) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM route summed-area length is invalid",
        "output",
      );
    }
    if (contextView.getUint32(52, true) !== planeCellCount) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM route component-label length is invalid",
        "output",
      );
    }
    const routeObstacleCount = validateObstacleCount(contextView.getUint32(32, true), "routeObstacleCount");
    const simulationObstacleCount = validateObstacleCount(contextView.getUint32(36, true), "simulationObstacleCount");
    const routeComponentCount = validateGraphwarWasmU32(
      contextView.getUint32(40, true),
      "routeComponentCount",
      "output",
    );
    const routeBoundaryEdgeCount = contextView.getUint32(44, true);
    if (routeComponentCount > routeObstacleCount || routeBoundaryEdgeCount > routeObstacleCount * 4) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM route context counts are inconsistent",
        "output",
      );
    }
    const boundaryEdgeValueCount = contextView.getUint32(60, true);
    if (boundaryEdgeValueCount !== routeBoundaryEdgeCount * routeBoundaryEdgeRecordU32Length) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM route boundary-edge length is invalid",
        "output",
      );
    }
    const componentLabels = copyGraphwarWasmUint32Values(
      runtime,
      { length: planeCellCount, pointer: contextView.getUint32(48, true) },
      runtime.arenaBase,
    );
    const boundaryEdges = copyGraphwarWasmUint32Values(
      runtime,
      { length: boundaryEdgeValueCount, pointer: contextView.getUint32(56, true) },
      runtime.arenaBase,
    );

    if (
      routeObstacleCount !== validateAndCountMaskObstacles(routeMask, "routeMask") ||
      simulationObstacleCount !== validateAndCountMaskObstacles(simulationMask, "simulationMask")
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM route context counts are inconsistent",
        "output",
      );
    }
    validateRouteTopologyCache(
      routeMask,
      isMirrored,
      componentLabels,
      routeComponentCount,
      boundaryEdges,
      routeBoundaryEdgeCount,
    );

    function assertActive() {
      if (isDisposed) {
        throw new GraphwarWasmAdapterError("invalid-session-state", "Graphwar WASM route context is disposed", "input");
      }
    }

    function runPointQuery(command: number, point: GraphwarWasmPoint) {
      assertActive();
      validatePlanePoint(point, "point");
      return runRouteQuery(runtime, command, contextPointer, routePointInputByteLength, [point.x, point.y]);
    }

    function runRegionQuery(command: number, region: GraphClosedRegion | PlaneMaskClosedRegion) {
      assertActive();
      validateRegion(region, command === routeCommand.planeRegionCount);
      return runRouteQuery(runtime, command, contextPointer, routeRegionInputByteLength, [
        region.minX,
        region.maxX,
        region.minY,
        region.maxY,
      ]);
    }

    return {
      countPlaneRegionObstacles(region) {
        return runRegionQuery(routeCommand.planeRegionCount, region);
      },
      dispose() {
        assertActive();
        runtime.resetArena(contextMark);
        isDisposed = true;
      },
      graphRegionHitsObstacle(region) {
        return runRegionQuery(routeCommand.graphRegionHit, region) === 1;
      },
      isMirrored,
      lineHitsObstacle(start, end) {
        assertActive();
        validatePlanePoint(start, "start");
        validatePlanePoint(end, "end");
        return (
          runRouteQuery(runtime, routeCommand.lineHit, contextPointer, routeLineInputByteLength, [
            start.x,
            start.y,
            end.x,
            end.y,
          ]) === 1
        );
      },
      pointHitsObstacle(point) {
        return runPointQuery(routeCommand.pointHit, point) === 1;
      },
      routeBoundaryEdgeCount,
      routeComponentCount,
      routeMask,
      routeObstacleCount,
      simulationMask,
      simulationObstacleCount,
    };
  } catch (error) {
    runtime.resetArenaAfterFault(contextMark);
    throw error;
  }
}

/** Runs one small query below the retained context and always restores its scratch mark. */
function runRouteQuery(
  runtime: GraphwarWasmKernelRuntime,
  command: number,
  contextPointer: number,
  inputByteLength: number,
  values: readonly number[],
) {
  const mark = runtime.markArena();
  try {
    const inputPointer = runtime.reserveArena(inputByteLength, 8);
    const inputView = new DataView(runtime.buffer, inputPointer, inputByteLength);
    inputView.setUint32(0, contextPointer, true);
    for (let index = 0; index < values.length; index += 1) {
      inputView.setFloat64(8 + index * Float64Array.BYTES_PER_ELEMENT, values[index] ?? Number.NaN, true);
    }
    const resultPointer = runtime.runRouteTask(command, inputPointer, inputByteLength);
    const resultRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: routeQueryResultByteLength, pointer: resultPointer },
      { alignment: 4, elementByteLength: 1, minimumPointer: runtime.arenaBase },
    );
    const resultView = new DataView(resultRange.buffer, resultRange.byteOffset, resultRange.byteLength);
    if (resultView.getUint32(0, true) !== routeQueryResultMagic) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM route query magic is invalid",
        "output",
      );
    }
    const value = validateGraphwarWasmU32(resultView.getUint32(4, true), "routeQuery.value", "output");
    if (command !== routeCommand.planeRegionCount && value > 1) {
      throw new GraphwarWasmAdapterError("invalid-enum", "Graphwar WASM collision result is invalid", "output");
    }
    if (command === routeCommand.planeRegionCount && value > planeCellCount) {
      throw new GraphwarWasmAdapterError("invalid-u32", "Graphwar WASM region count is invalid", "output");
    }
    return value;
  } finally {
    runtime.resetArena(mark);
  }
}

function validatePlanePoint(point: GraphwarWasmPoint, fieldName: string) {
  if (
    !Number.isInteger(point.x) ||
    !Number.isInteger(point.y) ||
    point.x < 0 ||
    point.x >= GRAPHWAR_PLANE_LENGTH ||
    point.y < 0 ||
    point.y >= GRAPHWAR_PLANE_HEIGHT
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-point-data",
      `${fieldName} must identify one Graphwar plane cell`,
      "input",
    );
  }
}

function validateRegion(region: GraphClosedRegion | PlaneMaskClosedRegion, shouldRequirePlaneCells: boolean) {
  const values = [region.minX, region.maxX, region.minY, region.maxY];
  if (!values.every(Number.isFinite) || region.minX > region.maxX || region.minY > region.maxY) {
    throw new GraphwarWasmAdapterError("invalid-point-data", "Graphwar route region is invalid", "input");
  }
  if (shouldRequirePlaneCells) {
    validatePlanePoint({ x: region.minX, y: region.minY }, "region minimum");
    validatePlanePoint({ x: region.maxX, y: region.maxY }, "region maximum");
  }
}

function validateObstacleCount(value: unknown, fieldName: string) {
  const count = validateGraphwarWasmU32(value, fieldName, "output");
  if (count > planeCellCount) {
    throw new GraphwarWasmAdapterError("invalid-u32", `${fieldName} exceeds the Graphwar plane`, "output");
  }
  return count;
}

function validateAndCountMaskObstacles(mask: Uint8Array, fieldName: string) {
  let count = 0;
  for (const value of mask) {
    if (value > 1) {
      throw new GraphwarWasmAdapterError("invalid-image-data", `${fieldName} must be binary`, "output");
    }
    count += value ? 1 : 0;
  }
  return count;
}

/** Validates the retained topology cache against the owned route mask in the same stable x+ scan order. */
function validateRouteTopologyCache(
  routeMask: Uint8Array,
  isMirrored: boolean,
  componentLabels: Uint32Array,
  componentCount: number,
  boundaryEdges: Uint32Array,
  boundaryEdgeCount: number,
) {
  const isBlocked = (x: number, y: number) => {
    if (x < 0 || x >= GRAPHWAR_PLANE_LENGTH || y < 0 || y >= GRAPHWAR_PLANE_HEIGHT) {
      return false;
    }
    const maskX = isMirrored ? GRAPHWAR_PLANE_LENGTH - 1 - x : x;
    return routeMask[y * GRAPHWAR_PLANE_LENGTH + maskX] === 1;
  };
  const visited = new Uint8Array(planeCellCount);
  const queue = new Uint32Array(planeCellCount);
  let expectedComponentCount = 0;
  for (let startIndex = 0; startIndex < planeCellCount; startIndex += 1) {
    const startX = startIndex % GRAPHWAR_PLANE_LENGTH;
    const startY = Math.floor(startIndex / GRAPHWAR_PLANE_LENGTH);
    if (visited[startIndex] || !isBlocked(startX, startY)) {
      continue;
    }
    expectedComponentCount += 1;
    let queueStart = 0;
    let queueEnd = 1;
    queue[0] = startIndex;
    visited[startIndex] = 1;
    while (queueStart < queueEnd) {
      const index = queue[queueStart] ?? planeCellCount;
      queueStart += 1;
      if (componentLabels[index] !== expectedComponentCount) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Graphwar WASM route component cache has an invalid stable label",
          "output",
        );
      }
      const x = index % GRAPHWAR_PLANE_LENGTH;
      const y = Math.floor(index / GRAPHWAR_PLANE_LENGTH);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          const nextIndex = nextY * GRAPHWAR_PLANE_LENGTH + nextX;
          if (
            (offsetX !== 0 || offsetY !== 0) &&
            nextX >= 0 &&
            nextX < GRAPHWAR_PLANE_LENGTH &&
            nextY >= 0 &&
            nextY < GRAPHWAR_PLANE_HEIGHT &&
            !visited[nextIndex] &&
            isBlocked(nextX, nextY)
          ) {
            visited[nextIndex] = 1;
            queue[queueEnd] = nextIndex;
            queueEnd += 1;
          }
        }
      }
    }
  }
  if (expectedComponentCount !== componentCount) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "Graphwar WASM route component cache count is inconsistent",
      "output",
    );
  }

  let edgeIndex = 0;
  const validateEdge = (componentId: number, startX: number, startY: number, endX: number, endY: number) => {
    const offset = edgeIndex * routeBoundaryEdgeRecordU32Length;
    if (
      boundaryEdges[offset] !== componentId ||
      boundaryEdges[offset + 1] !== startX ||
      boundaryEdges[offset + 2] !== startY ||
      boundaryEdges[offset + 3] !== endX ||
      boundaryEdges[offset + 4] !== endY
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM route boundary-edge cache is inconsistent",
        "output",
      );
    }
    edgeIndex += 1;
  };

  for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
    for (let x = 0; x < GRAPHWAR_PLANE_LENGTH; x += 1) {
      const label = componentLabels[y * GRAPHWAR_PLANE_LENGTH + x] ?? 0;
      if (!isBlocked(x, y)) {
        if (label !== 0) {
          throw new GraphwarWasmAdapterError(
            "invalid-session-state",
            "Graphwar WASM route component cache labels a free cell",
            "output",
          );
        }
        continue;
      }
      if (label === 0 || label > componentCount) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Graphwar WASM route component cache has an invalid obstacle label",
          "output",
        );
      }
      if (!isBlocked(x, y - 1)) validateEdge(label, x, y, x + 1, y);
      if (!isBlocked(x + 1, y)) validateEdge(label, x + 1, y, x + 1, y + 1);
      if (!isBlocked(x, y + 1)) validateEdge(label, x + 1, y + 1, x, y + 1);
      if (!isBlocked(x - 1, y)) validateEdge(label, x, y + 1, x, y);
    }
  }
  if (edgeIndex !== boundaryEdgeCount) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "Graphwar WASM route topology cache is incomplete",
      "output",
    );
  }
}

function validateRouteContextIdentity(
  contextView: DataView,
  input: GraphwarWasmRouteContextInput,
  routePolicy: { length: number; pointer: number },
  lookaheadOffsets: { length: number; pointer: number },
) {
  const expectedValues: readonly [number, number][] = [
    [64, input.bounds.minX],
    [72, input.bounds.maxX],
    [80, input.bounds.minY],
    [88, input.bounds.maxY],
    [96, input.boundaryExpansion],
    [104, input.routeOriginPoint.x],
    [112, input.routeOriginPoint.y],
    [120, input.routeTolerancePlanePixels],
    [128, input.simulationTolerancePlanePixels],
  ];
  if (
    expectedValues.some(([offset, expected]) => !Object.is(contextView.getFloat64(offset, true), expected)) ||
    contextView.getUint32(136, true) !== routePolicy.pointer ||
    contextView.getUint32(140, true) !== routePolicy.length ||
    contextView.getUint32(144, true) !== lookaheadOffsets.pointer ||
    contextView.getUint32(148, true) !== lookaheadOffsets.length
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "Graphwar WASM route context does not preserve its input identity",
      "output",
    );
  }
}
