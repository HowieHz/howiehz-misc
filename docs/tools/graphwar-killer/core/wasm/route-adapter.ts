import {
  graphwarThetaStarHeuristics,
  graphwarVisibilityGraphHeuristics,
} from "../../pathfinding/routing/canonical-data";
import type { GraphClosedRegion, PlaneMaskClosedRegion } from "../../pathfinding/routing/step-envelope";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../game/constants";
import type { PlaneGridPoint } from "../plane-grid";
import {
  GraphwarWasmAdapterError,
  copyGraphwarWasmBytes,
  copyGraphwarWasmFloat64Values,
  copyGraphwarWasmUint32Values,
  validateGraphwarWasmEnumValue,
  validateGraphwarWasmMemoryRange,
  validateGraphwarWasmU32,
} from "./abi";
import type { GraphwarWasmKernelRuntime } from "./runtime";
import {
  copyGraphwarWasmPathfindingPreviewEvent,
  packGraphwarWasmRouteContextInput,
  type GraphwarWasmPathfindingPreviewEvent,
  type GraphwarWasmRouteContextInput,
  type GraphwarWasmPoint,
} from "./task-adapter";

const routeCommand = {
  createContext: 1,
  graphRegionHit: 4,
  lineHit: 3,
  planeRegionCount: 5,
  pointHit: 2,
  thetaStar: 6,
  visibilityGraph: 7,
} as const;
const routeCreateInputByteLength = 48;
const routeContextByteLength = 264;
const routeContextMagic = 0x524f_5554;
const routeContextMirroredFlag = 1;
const routeQueryResultByteLength = 8;
const routeQueryResultMagic = 0x5152_4f55;
const routePointInputByteLength = 24;
const routeLineInputByteLength = 40;
const routeRegionInputByteLength = 40;
const routeSearchInputByteLength = 48;
const routePreviewByteLength = 48;
const routeSearchResultByteLength = 32;
const routeSearchResultMagic = 0x5253_4c54;
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
  findThetaStarPath: (
    start: PlaneGridPoint,
    target: PlaneGridPoint,
    shouldCollectPreviews?: boolean,
  ) => GraphwarWasmRouteSearchResult;
  findVisibilityGraphPath: (
    start: PlaneGridPoint,
    target: PlaneGridPoint,
    shouldCollectPreviews?: boolean,
  ) => GraphwarWasmRouteSearchResult;
  graphRegionHitsObstacle: (region: GraphClosedRegion) => boolean;
  lineHitsObstacle: (start: PlaneGridPoint, end: PlaneGridPoint) => boolean;
  pointHitsObstacle: (point: PlaneGridPoint) => boolean;
}

/** Stateless route search returns one complete path or an explicit normal no-route result. */
export type GraphwarWasmRouteSearchResult =
  | {
      readonly expansionCount: number;
      readonly previews: readonly GraphwarWasmPathfindingPreviewEvent[];
      readonly type: "no-route";
    }
  | {
      readonly expansionCount: number;
      readonly path: readonly PlaneGridPoint[];
      readonly previews: readonly GraphwarWasmPathfindingPreviewEvent[];
      readonly type: "success";
    };

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
    if (contextView.getUint32(156, true) !== GRAPHWAR_PLANE_LENGTH + 1) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM route free-span offset length is invalid",
        "output",
      );
    }
    const freeSpanOffsets = copyGraphwarWasmUint32Values(
      runtime,
      { length: contextView.getUint32(156, true), pointer: contextView.getUint32(152, true) },
      runtime.arenaBase,
    );
    const freeSpanValueCount = contextView.getUint32(164, true);
    if (freeSpanValueCount % 2 !== 0 || freeSpanValueCount > planeCellCount * 2) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM route free-span value length is invalid",
        "output",
      );
    }
    const freeSpanValues = copyGraphwarWasmUint32Values(
      runtime,
      { length: freeSpanValueCount, pointer: contextView.getUint32(160, true) },
      runtime.arenaBase,
    );
    const thetaClosedRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: planeCellCount, pointer: contextView.getUint32(168, true) },
      { alignment: 1, elementByteLength: 1, minimumPointer: runtime.arenaBase },
    );
    const thetaGScoreRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: planeCellCount, pointer: contextView.getUint32(172, true) },
      { alignment: 8, elementByteLength: 8, minimumPointer: runtime.arenaBase },
    );
    const thetaParentRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: planeCellCount, pointer: contextView.getUint32(176, true) },
      { alignment: 4, elementByteLength: 4, minimumPointer: runtime.arenaBase },
    );
    const thetaTouchedRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: planeCellCount, pointer: contextView.getUint32(180, true) },
      { alignment: 4, elementByteLength: 4, minimumPointer: runtime.arenaBase },
    );
    if (contextView.getUint32(184, true) !== 0) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM route Theta scratch is not initially empty",
        "output",
      );
    }
    const thetaCandidateRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: GRAPHWAR_PLANE_HEIGHT, pointer: contextView.getUint32(188, true) },
      { alignment: 4, elementByteLength: 4, minimumPointer: runtime.arenaBase },
    );
    const thetaSeenRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: GRAPHWAR_PLANE_HEIGHT, pointer: contextView.getUint32(192, true) },
      { alignment: 1, elementByteLength: 1, minimumPointer: runtime.arenaBase },
    );
    if (
      contextView.getUint32(196, true) !== graphwarThetaStarHeuristics.previewCandidateLimit ||
      contextView.getUint32(200, true) !== graphwarThetaStarHeuristics.previewEdgeLimit ||
      contextView.getUint32(204, true) !== graphwarThetaStarHeuristics.previewExpansionInterval
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        "Graphwar WASM route context does not preserve its Theta preview policy",
        "output",
      );
    }
    const visibilityComponentStatsLength = contextView.getUint32(212, true);
    if (visibilityComponentStatsLength !== routeComponentCount * 7) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM visibility component-stat length is invalid",
        "output",
      );
    }
    const visibilityComponentStats = copyGraphwarWasmUint32Values(
      runtime,
      { length: visibilityComponentStatsLength, pointer: contextView.getUint32(208, true) },
      runtime.arenaBase,
    );
    const visibilityContourCount = contextView.getUint32(240, true);
    const visibilityContourPointCount = contextView.getUint32(244, true);
    if (contextView.getUint32(220, true) !== visibilityContourCount + 1) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM visibility contour-offset length is invalid",
        "output",
      );
    }
    const visibilityContourOffsets = copyGraphwarWasmUint32Values(
      runtime,
      { length: visibilityContourCount + 1, pointer: contextView.getUint32(216, true) },
      runtime.arenaBase,
    );
    const visibilityContourComponents = copyGraphwarWasmUint32Values(
      runtime,
      { length: visibilityContourCount, pointer: contextView.getUint32(224, true) },
      runtime.arenaBase,
    );
    const visibilityContourX = copyGraphwarWasmUint32Values(
      runtime,
      { length: visibilityContourPointCount, pointer: contextView.getUint32(228, true) },
      runtime.arenaBase,
    );
    const visibilityContourY = copyGraphwarWasmUint32Values(
      runtime,
      { length: visibilityContourPointCount, pointer: contextView.getUint32(232, true) },
      runtime.arenaBase,
    );
    const visibilityContourSignedAreas = copyGraphwarWasmFloat64Values(
      runtime,
      { length: visibilityContourCount, pointer: contextView.getUint32(236, true) },
      runtime.arenaBase,
    );
    if (
      contextView.getUint32(248, true) !== graphwarVisibilityGraphHeuristics.previewCandidateLimit ||
      contextView.getUint32(252, true) !== graphwarVisibilityGraphHeuristics.previewEdgeLimit ||
      contextView.getUint32(256, true) !== graphwarVisibilityGraphHeuristics.previewExpansionInterval
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        "Graphwar WASM route context does not preserve its visibility preview policy",
        "output",
      );
    }
    validateDisjointRouteContextRanges([
      { byteLength: packed.sourceMask.length, label: "source mask input", pointer: packed.sourceMask.pointer },
      {
        byteLength: packed.context.length * Float64Array.BYTES_PER_ELEMENT,
        label: "context input",
        pointer: packed.context.pointer,
      },
      {
        byteLength: packed.friendlySoldierCenters.length * Float64Array.BYTES_PER_ELEMENT,
        label: "friendly x input",
        pointer: packed.friendlySoldierCenters.x.pointer,
      },
      {
        byteLength: packed.friendlySoldierCenters.length * Float64Array.BYTES_PER_ELEMENT,
        label: "friendly y input",
        pointer: packed.friendlySoldierCenters.y.pointer,
      },
      {
        byteLength: packed.routePolicy.length * Float64Array.BYTES_PER_ELEMENT,
        label: "route policy input",
        pointer: packed.routePolicy.pointer,
      },
      {
        byteLength: packed.thetaStarLookaheadColumnOffsets.length,
        label: "Theta lookahead input",
        pointer: packed.thetaStarLookaheadColumnOffsets.pointer,
      },
      { byteLength: routeContextByteLength, label: "context record", pointer: contextPointer },
      { byteLength: routeMask.length, label: "route mask", pointer: contextView.getUint32(8, true) },
      { byteLength: simulationMask.length, label: "simulation mask", pointer: contextView.getUint32(16, true) },
      {
        byteLength: summedAreaValueCount * Uint32Array.BYTES_PER_ELEMENT,
        label: "summed area",
        pointer: contextView.getUint32(24, true),
      },
      {
        byteLength: planeCellCount * Uint32Array.BYTES_PER_ELEMENT,
        label: "component labels",
        pointer: contextView.getUint32(48, true),
      },
      {
        byteLength: boundaryEdgeValueCount * Uint32Array.BYTES_PER_ELEMENT,
        label: "boundary edges",
        pointer: contextView.getUint32(56, true),
      },
      {
        byteLength: freeSpanOffsets.length * Uint32Array.BYTES_PER_ELEMENT,
        label: "free-span offsets",
        pointer: contextView.getUint32(152, true),
      },
      {
        byteLength: freeSpanValues.length * Uint32Array.BYTES_PER_ELEMENT,
        label: "free-span values",
        pointer: contextView.getUint32(160, true),
      },
      { byteLength: thetaClosedRange.byteLength, label: "Theta closed", pointer: thetaClosedRange.byteOffset },
      { byteLength: thetaGScoreRange.byteLength, label: "Theta gScore", pointer: thetaGScoreRange.byteOffset },
      { byteLength: thetaParentRange.byteLength, label: "Theta parent", pointer: thetaParentRange.byteOffset },
      { byteLength: thetaTouchedRange.byteLength, label: "Theta touched", pointer: thetaTouchedRange.byteOffset },
      {
        byteLength: thetaCandidateRange.byteLength,
        label: "Theta candidates",
        pointer: thetaCandidateRange.byteOffset,
      },
      { byteLength: thetaSeenRange.byteLength, label: "Theta seen", pointer: thetaSeenRange.byteOffset },
      {
        byteLength: visibilityComponentStats.byteLength,
        label: "visibility component stats",
        pointer: contextView.getUint32(208, true),
      },
      {
        byteLength: visibilityContourOffsets.byteLength,
        label: "visibility contour offsets",
        pointer: contextView.getUint32(216, true),
      },
      {
        byteLength: visibilityContourComponents.byteLength,
        label: "visibility contour components",
        pointer: contextView.getUint32(224, true),
      },
      {
        byteLength: visibilityContourX.byteLength,
        label: "visibility contour x",
        pointer: contextView.getUint32(228, true),
      },
      {
        byteLength: visibilityContourY.byteLength,
        label: "visibility contour y",
        pointer: contextView.getUint32(232, true),
      },
      {
        byteLength: visibilityContourSignedAreas.byteLength,
        label: "visibility contour areas",
        pointer: contextView.getUint32(236, true),
      },
    ]);
    if (
      new Uint8Array(thetaClosedRange.buffer, thetaClosedRange.byteOffset, thetaClosedRange.elementLength).some(
        (value) => value !== 0,
      ) ||
      new Float64Array(thetaGScoreRange.buffer, thetaGScoreRange.byteOffset, thetaGScoreRange.elementLength).some(
        (value) => value !== Number.POSITIVE_INFINITY,
      ) ||
      new Int32Array(thetaParentRange.buffer, thetaParentRange.byteOffset, thetaParentRange.elementLength).some(
        (value) => value !== -1,
      ) ||
      new Uint8Array(thetaSeenRange.buffer, thetaSeenRange.byteOffset, thetaSeenRange.elementLength).some(
        (value) => value !== 0,
      )
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM route Theta scratch has an invalid initial state",
        "output",
      );
    }

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
    validateRouteFreeSpanCache(routeMask, isMirrored, input.boundaryExpansion, freeSpanOffsets, freeSpanValues);
    validateVisibilityContourCache(
      componentLabels,
      routeComponentCount,
      visibilityComponentStats,
      visibilityContourOffsets,
      visibilityContourComponents,
      visibilityContourX,
      visibilityContourY,
      visibilityContourSignedAreas,
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
      findThetaStarPath(start, target, shouldCollectPreviews = false) {
        assertActive();
        validatePlanePoint(start, "start");
        validatePlanePoint(target, "target");
        return runRouteSearch(
          runtime,
          routeCommand.thetaStar,
          contextPointer,
          start,
          target,
          shouldCollectPreviews,
          isMirrored,
          graphwarThetaStarHeuristics.previewExpansionInterval,
        );
      },
      findVisibilityGraphPath(start, target, shouldCollectPreviews = false) {
        assertActive();
        validatePlanePoint(start, "start");
        validatePlanePoint(target, "target");
        return runRouteSearch(
          runtime,
          routeCommand.visibilityGraph,
          contextPointer,
          start,
          target,
          shouldCollectPreviews,
          isMirrored,
          graphwarVisibilityGraphHeuristics.previewExpansionInterval,
        );
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

/** Runs one complete stateless search and copies its stable path before releasing command scratch. */
function runRouteSearch(
  runtime: GraphwarWasmKernelRuntime,
  command: number,
  contextPointer: number,
  start: PlaneGridPoint,
  target: PlaneGridPoint,
  shouldCollectPreviews: boolean,
  isMirrored: boolean,
  previewExpansionInterval: number,
): GraphwarWasmRouteSearchResult {
  const commandMinimumPointer = runtime.arenaCursor;
  const mark = runtime.markArena();
  try {
    const inputPointer = runtime.reserveArena(routeSearchInputByteLength, 8);
    const inputView = new DataView(runtime.buffer, inputPointer, routeSearchInputByteLength);
    inputView.setUint32(0, contextPointer, true);
    inputView.setFloat64(8, start.x, true);
    inputView.setFloat64(16, start.y, true);
    inputView.setFloat64(24, target.x, true);
    inputView.setFloat64(32, target.y, true);
    inputView.setUint32(40, shouldCollectPreviews ? 1 : 0, true);
    const resultPointer = runtime.runRouteTask(command, inputPointer, routeSearchInputByteLength);
    const resultRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: routeSearchResultByteLength, pointer: resultPointer },
      { alignment: 4, elementByteLength: 1, minimumPointer: commandMinimumPointer },
    );
    const resultView = new DataView(resultRange.buffer, resultRange.byteOffset, resultRange.byteLength);
    if (resultView.getUint32(0, true) !== routeSearchResultMagic) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM route search magic is invalid",
        "output",
      );
    }
    const status = validateGraphwarWasmEnumValue(resultView.getUint32(4, true), [0, 1] as const, "route status");
    const pathLength = resultView.getUint32(16, true);
    const previewPointer = resultView.getUint32(20, true);
    const previewCount = resultView.getUint32(24, true);
    const expansionCount = validateGraphwarWasmU32(resultView.getUint32(28, true), "route expansion count", "output");
    const expectedPreviewCount = shouldCollectPreviews
      ? Math.floor(expansionCount / previewExpansionInterval) + status
      : 0;
    if ((previewCount === 0) !== (previewPointer === 0) || previewCount !== expectedPreviewCount) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM route search returned an invalid preview range",
        "output",
      );
    }
    const previewRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: previewCount, pointer: previewPointer },
      { alignment: 4, elementByteLength: routePreviewByteLength, minimumPointer: commandMinimumPointer },
    );
    const previews = Array.from({ length: previewCount }, (_, index) => {
      const view = new DataView(
        previewRange.buffer,
        previewRange.byteOffset + index * routePreviewByteLength,
        routePreviewByteLength,
      );
      const preview = copyGraphwarWasmPathfindingPreviewEvent(
        runtime,
        {
          acceptedEdgePointIndexes: { length: view.getUint32(16, true), pointer: view.getUint32(12, true) },
          bestPathPointIndexes: { length: view.getUint32(24, true), pointer: view.getUint32(20, true) },
          candidatePointIndexes: { length: view.getUint32(32, true), pointer: view.getUint32(28, true) },
          currentPointIndex: view.getUint32(36, true),
          isMirrored: view.getUint32(40, true),
          points: {
            length: view.getUint32(8, true),
            x: { length: view.getUint32(8, true), pointer: view.getUint32(0, true) },
            y: { length: view.getUint32(8, true), pointer: view.getUint32(4, true) },
          },
        },
        commandMinimumPointer,
      );
      if (preview.isMirrored !== isMirrored) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-identity",
          "Graphwar WASM route preview mirror identity is invalid",
          "output",
        );
      }
      validateRoutePreview(preview, start, target, index, command === routeCommand.thetaStar);
      return preview;
    });
    if (status === 0) {
      if (resultView.getUint32(8, true) !== 0 || resultView.getUint32(12, true) !== 0 || pathLength !== 0) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Graphwar WASM no-route result contains a path",
          "output",
        );
      }
      if (previews.some((preview) => pointsEqual(preview.bestPath.at(-1), target))) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Graphwar WASM no-route preview reaches its target",
          "output",
        );
      }
      return { expansionCount, previews, type: "no-route" };
    }
    if (command === routeCommand.visibilityGraph && target.x <= start.x) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM visibility path success requires forward progress",
        "output",
      );
    }
    if (pathLength === 0 || pathLength > GRAPHWAR_PLANE_LENGTH) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM route path length is invalid",
        "output",
      );
    }
    const xValues = copyGraphwarWasmFloat64Values(
      runtime,
      { length: pathLength, pointer: resultView.getUint32(8, true) },
      commandMinimumPointer,
    );
    const yValues = copyGraphwarWasmFloat64Values(
      runtime,
      { length: pathLength, pointer: resultView.getUint32(12, true) },
      commandMinimumPointer,
    );
    const path = Array.from(xValues, (x, index) => ({ x, y: yValues[index] ?? Number.NaN }));
    for (let index = 0; index < path.length; index += 1) {
      validatePlanePoint(path[index] ?? { x: Number.NaN, y: Number.NaN }, `path[${index}]`, "output");
      if (index > 0 && (path[index]?.x ?? -1) <= (path[index - 1]?.x ?? GRAPHWAR_PLANE_LENGTH)) {
        throw new GraphwarWasmAdapterError(
          "invalid-point-data",
          "Graphwar WASM route path does not advance in x+ order",
          "output",
        );
      }
    }
    if (
      path[0]?.x !== start.x ||
      path[0]?.y !== start.y ||
      path.at(-1)?.x !== target.x ||
      path.at(-1)?.y !== target.y
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        "Graphwar WASM route path endpoints do not match its request",
        "output",
      );
    }
    const terminalPreview = previews.at(-1);
    if (shouldCollectPreviews && !pathsEqual(terminalPreview?.bestPath, path)) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM terminal preview does not match its result path",
        "output",
      );
    }
    return { expansionCount, path, previews, type: "success" };
  } finally {
    runtime.resetArena(mark);
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
  const commandMinimumPointer = runtime.arenaCursor;
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
      { alignment: 4, elementByteLength: 1, minimumPointer: commandMinimumPointer },
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

function validatePlanePoint(point: GraphwarWasmPoint, fieldName: string, faultDomain: "input" | "output" = "input") {
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
      faultDomain,
    );
  }
}

/** Route previews are untrusted WASM output and must preserve the x+ search identity. */
function validateRoutePreview(
  preview: GraphwarWasmPathfindingPreviewEvent,
  start: PlaneGridPoint,
  target: PlaneGridPoint,
  previewIndex: number,
  shouldBestPathEndAtCurrentOrTarget: boolean,
) {
  const fieldPrefix = `previews[${previewIndex}]`;
  for (let edgeIndex = 0; edgeIndex < preview.acceptedEdges.length; edgeIndex += 1) {
    const edge = preview.acceptedEdges[edgeIndex];
    const edgeStart = edge?.[0] ?? { x: Number.NaN, y: Number.NaN };
    const edgeTarget = edge?.[1] ?? { x: Number.NaN, y: Number.NaN };
    validatePlanePoint(edgeStart, `${fieldPrefix}.acceptedEdges[${edgeIndex}][0]`, "output");
    validatePlanePoint(edgeTarget, `${fieldPrefix}.acceptedEdges[${edgeIndex}][1]`, "output");
    if (edgeTarget.x <= edgeStart.x) {
      throw new GraphwarWasmAdapterError(
        "invalid-point-data",
        `${fieldPrefix}.acceptedEdges[${edgeIndex}] does not advance in x+ order`,
        "output",
      );
    }
  }
  for (let pointIndex = 0; pointIndex < preview.bestPath.length; pointIndex += 1) {
    const point = preview.bestPath[pointIndex] ?? { x: Number.NaN, y: Number.NaN };
    validatePlanePoint(point, `${fieldPrefix}.bestPath[${pointIndex}]`, "output");
    if (pointIndex > 0 && point.x <= (preview.bestPath[pointIndex - 1]?.x ?? GRAPHWAR_PLANE_LENGTH)) {
      throw new GraphwarWasmAdapterError(
        "invalid-point-data",
        `${fieldPrefix}.bestPath does not advance in x+ order`,
        "output",
      );
    }
  }
  for (let pointIndex = 0; pointIndex < preview.candidates.length; pointIndex += 1) {
    validatePlanePoint(
      preview.candidates[pointIndex] ?? { x: Number.NaN, y: Number.NaN },
      `${fieldPrefix}.candidates[${pointIndex}]`,
      "output",
    );
  }
  if (!preview.current) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      `${fieldPrefix} does not identify its current point`,
      "output",
    );
  }
  validatePlanePoint(preview.current, `${fieldPrefix}.current`, "output");
  if (
    !pointsEqual(preview.bestPath[0], start) ||
    (shouldBestPathEndAtCurrentOrTarget
      ? !pointsEqual(preview.bestPath.at(-1), preview.current) && !pointsEqual(preview.bestPath.at(-1), target)
      : false) ||
    !pointsEqual(preview.candidates[0], start) ||
    !preview.candidates.some((point) => pointsEqual(point, target)) ||
    !preview.candidates.some((point) => pointsEqual(point, preview.current))
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      `${fieldPrefix} does not match its route request`,
      "output",
    );
  }
}

function pointsEqual(left: GraphwarWasmPoint | undefined, right: GraphwarWasmPoint | undefined) {
  return left?.x === right?.x && left?.y === right?.y;
}

function pathsEqual(left: readonly GraphwarWasmPoint[] | undefined, right: readonly GraphwarWasmPoint[]) {
  return left?.length === right.length && left.every((point, index) => pointsEqual(point, right[index]));
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

/** Validates the retained Theta* column spans in x+ coordinates, including stable per-column ordering. */
function validateRouteFreeSpanCache(
  routeMask: Uint8Array,
  isMirrored: boolean,
  boundaryExpansion: number,
  offsets: Uint32Array,
  values: Uint32Array,
) {
  const boundaryInset = Math.min(Math.floor(boundaryExpansion), Math.max(GRAPHWAR_PLANE_LENGTH, GRAPHWAR_PLANE_HEIGHT));
  let spanIndex = 0;
  for (let x = 0; x < GRAPHWAR_PLANE_LENGTH; x += 1) {
    if (offsets[x] !== spanIndex) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM route free-span offsets are inconsistent",
        "output",
      );
    }
    const maskX = isMirrored ? GRAPHWAR_PLANE_LENGTH - 1 - x : x;
    let spanStart = -1;
    for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
      const isFree =
        x >= boundaryInset &&
        x < GRAPHWAR_PLANE_LENGTH - boundaryInset &&
        y >= boundaryInset &&
        y < GRAPHWAR_PLANE_HEIGHT - boundaryInset &&
        routeMask[y * GRAPHWAR_PLANE_LENGTH + maskX] === 0;
      if (isFree && spanStart < 0) {
        spanStart = y;
      } else if (!isFree && spanStart >= 0) {
        if (values[spanIndex * 2] !== spanStart || values[spanIndex * 2 + 1] !== y - 1) {
          throw new GraphwarWasmAdapterError(
            "invalid-session-state",
            "Graphwar WASM route free-span values are inconsistent",
            "output",
          );
        }
        spanIndex += 1;
        spanStart = -1;
      }
    }
    if (spanStart >= 0) {
      if (values[spanIndex * 2] !== spanStart || values[spanIndex * 2 + 1] !== GRAPHWAR_PLANE_HEIGHT - 1) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Graphwar WASM route free-span values are inconsistent",
          "output",
        );
      }
      spanIndex += 1;
    }
  }
  if (offsets[GRAPHWAR_PLANE_LENGTH] !== spanIndex || values.length !== spanIndex * 2) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "Graphwar WASM route free-span cache is incomplete",
      "output",
    );
  }
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

/** A retained context owns all of these buffers together; aliasing any pair can silently corrupt later searches. */
function validateDisjointRouteContextRanges(
  ranges: readonly { readonly byteLength: number; readonly label: string; readonly pointer: number }[],
) {
  for (let leftIndex = 0; leftIndex < ranges.length; leftIndex += 1) {
    const left = ranges[leftIndex];
    if (!left || left.byteLength === 0) continue;
    const leftEnd = left.pointer + left.byteLength;
    for (let rightIndex = leftIndex + 1; rightIndex < ranges.length; rightIndex += 1) {
      const right = ranges[rightIndex];
      if (!right || right.byteLength === 0) continue;
      if (left.pointer < right.pointer + right.byteLength && right.pointer < leftEnd) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          `Graphwar WASM route ${left.label} and ${right.label} ranges overlap`,
          "output",
        );
      }
    }
  }
}

function validateVisibilityContourCache(
  componentLabels: Uint32Array,
  componentCount: number,
  componentStats: Uint32Array,
  contourOffsets: Uint32Array,
  contourComponents: Uint32Array,
  contourX: Uint32Array,
  contourY: Uint32Array,
  contourSignedAreas: Float64Array,
) {
  const expectedStats = new Uint32Array(componentCount * 7);
  for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
    expectedStats[componentIndex * 7] = GRAPHWAR_PLANE_LENGTH;
    expectedStats[componentIndex * 7 + 2] = GRAPHWAR_PLANE_HEIGHT;
  }
  for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
    for (let x = 0; x < GRAPHWAR_PLANE_LENGTH; x += 1) {
      const componentId = componentLabels[y * GRAPHWAR_PLANE_LENGTH + x] ?? 0;
      if (componentId === 0) continue;
      const offset = (componentId - 1) * 7;
      expectedStats[offset] = Math.min(expectedStats[offset] ?? GRAPHWAR_PLANE_LENGTH, x);
      expectedStats[offset + 1] = Math.max(expectedStats[offset + 1] ?? 0, x);
      expectedStats[offset + 2] = Math.min(expectedStats[offset + 2] ?? GRAPHWAR_PLANE_HEIGHT, y);
      expectedStats[offset + 3] = Math.max(expectedStats[offset + 3] ?? 0, y);
      expectedStats[offset + 4] = (expectedStats[offset + 4] ?? 0) + x;
      expectedStats[offset + 5] = (expectedStats[offset + 5] ?? 0) + y;
      expectedStats[offset + 6] = (expectedStats[offset + 6] ?? 0) + 1;
    }
  }
  if (!componentStats.every((value, index) => value === expectedStats[index])) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "Graphwar WASM visibility component stats are inconsistent",
      "output",
    );
  }
  if (
    contourOffsets[0] !== 0 ||
    contourOffsets.at(-1) !== contourX.length ||
    contourX.length !== contourY.length ||
    contourComponents.length !== contourSignedAreas.length
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "Graphwar WASM visibility contour ranges are inconsistent",
      "output",
    );
  }
  const hasComponentContour = new Uint8Array(componentCount);
  for (let contourIndex = 0; contourIndex < contourComponents.length; contourIndex += 1) {
    const start = contourOffsets[contourIndex] ?? Number.NaN;
    const end = contourOffsets[contourIndex + 1] ?? Number.NaN;
    const componentId = contourComponents[contourIndex] ?? 0;
    if (end - start < 2 || componentId < 1 || componentId > componentCount) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM visibility contour record is invalid",
        "output",
      );
    }
    hasComponentContour[componentId - 1] = 1;
    let doubledArea = 0;
    for (let pointIndex = start; pointIndex < end; pointIndex += 1) {
      const nextIndex = pointIndex + 1 === end ? start : pointIndex + 1;
      const x = contourX[pointIndex] ?? Number.NaN;
      const y = contourY[pointIndex] ?? Number.NaN;
      const nextX = contourX[nextIndex] ?? Number.NaN;
      const nextY = contourY[nextIndex] ?? Number.NaN;
      if (x > GRAPHWAR_PLANE_LENGTH || y > GRAPHWAR_PLANE_HEIGHT) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Graphwar WASM visibility contour point is invalid",
          "output",
        );
      }
      let hasComponentCell = false;
      let hasExteriorCell = false;
      for (let cellY = y - 1; cellY <= y; cellY += 1) {
        for (let cellX = x - 1; cellX <= x; cellX += 1) {
          if (cellX < 0 || cellX >= GRAPHWAR_PLANE_LENGTH || cellY < 0 || cellY >= GRAPHWAR_PLANE_HEIGHT) {
            hasExteriorCell = true;
          } else if (componentLabels[cellY * GRAPHWAR_PLANE_LENGTH + cellX] === componentId) {
            hasComponentCell = true;
          } else {
            hasExteriorCell = true;
          }
        }
      }
      if (!hasComponentCell || !hasExteriorCell) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Graphwar WASM visibility contour point is not on its component boundary",
          "output",
        );
      }
      doubledArea += x * nextY - nextX * y;
    }
    if (!Object.is(contourSignedAreas[contourIndex], doubledArea / 2)) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Graphwar WASM visibility contour area is inconsistent",
        "output",
      );
    }
  }
  if (hasComponentContour.some((value) => value === 0)) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "Graphwar WASM visibility contour components are incomplete",
      "output",
    );
  }
}
