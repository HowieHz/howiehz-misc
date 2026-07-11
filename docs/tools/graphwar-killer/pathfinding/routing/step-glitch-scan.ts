/** Step y'= 邪道模式的从左到右扫描器；几何层只选门和落点，最终文本回放决定是否可达。 */
import {
  GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE,
  GRAPHWAR_PLANE_HEIGHT,
  GRAPHWAR_PLANE_LENGTH,
  GRAPHWAR_STEP_SIZE,
} from "../../core/game/constants";
import { graphToImagePoint, imageToGraphPoint, xPlusGoesRight } from "../../core/geometry";
import { floorToDecimalPlaces, graphXAdvancesStrictly, nextUpDouble } from "../../core/numbers";
import { imagePointToPlaneGridPoint, planeGridCellCenterToImagePoint } from "../../core/plane-grid";
import { createGraphPoint, createPixelPoint } from "../../core/types";
import type { BoundsRect, GraphBounds, GraphPoint, PixelPoint } from "../../core/types";
import {
  createGraphwarTrajectoryFormulaContext,
  sampleGraphwarFormulaTrajectory,
} from "../../formula/trajectory/sampling";
import type {
  GraphwarTrajectoryFormulaSettings,
  GraphwarTrajectoryTargetCircle,
} from "../../formula/trajectory/sampling";

const DEFAULT_MAX_EXPANDED_STATES = 512;
const MAX_CONTROL_POINT_ROUND_TRIP_NUDGES = 32;
const glitchWindowWidths = createGlitchWindowWidths();

/** 固定 simulation mask 的 x+ 水平可达索引，可在单目标和一键清图的多次扫描间复用。 */
export interface GraphwarStepGlitchScanMaskIndex {
  readonly boundaryExpansion: number;
  /** 每格沿 x+ 保持同一 y 时能到达的最远搜索列；-1 表示当前格不可用。 */
  readonly farthestFreeX: Int16Array;
  readonly mirrored: boolean;
  readonly simulationMask: Uint8Array;
}

export interface GraphwarStepGlitchScanOptions {
  bounds: GraphBounds;
  boundsRect: BoundsRect;
  /** 当前目标的实际命中圈。 */
  hitTarget: GraphwarTrajectoryTargetCircle;
  /** 已有路径必须继续按顺序命中的目标；当前 hitTarget 会追加在其后。 */
  requiredTargetSequence?: readonly GraphwarTrajectoryTargetCircle[];
  /** 函数采样边界内收值，单位为 Graphwar 原始平面像素。 */
  simulationBoundaryExpansion?: number;
  /** 邪道选择和最终接受点碰撞都使用这一份 mask。 */
  simulationMask: Uint8Array;
  /** 可复用的同 mask 索引；不匹配时扫描器会自行重建。 */
  maskIndex?: GraphwarStepGlitchScanMaskIndex;
  /** 最多执行多少次完整候选公式回放；默认 512，耗尽时返回 reason=limit，不代表前沿已经搜索完。 */
  maxExpandedStates?: number;
  settings: GraphwarTrajectoryFormulaSettings;
  /** 已有完整路径；最后一点是本次扫描起点。 */
  sourcePath: readonly PixelPoint[];
  /** 当前目标使用的控制点；可与命中圈中心不同。 */
  targetPoint: PixelPoint;
}

interface GraphwarStepGlitchScanResultBase {
  /** 实际执行过最终文本回放的候选路径数。 */
  expandedStates: number;
  /** True 表示达到回放预算后提前返回，不能解释为搜索前沿已经穷尽。 */
  limitReached: boolean;
  /** 本条完整公式按顺序命中的 required targets 加当前目标数量。 */
  reachedTargetCount: number;
}

export type GraphwarStepGlitchScanResult =
  | (GraphwarStepGlitchScanResultBase & {
      acceptedPoint: GraphPoint;
      path: PixelPoint[];
      status: "hit";
    })
  | (GraphwarStepGlitchScanResultBase & {
      acceptedPoint: GraphPoint;
      path: PixelPoint[];
      status: "passable";
    })
  | (GraphwarStepGlitchScanResultBase & {
      blockedPoint?: GraphPoint;
      reason: "invalid-input" | "limit" | "no-path" | "unsupported";
      status: "blocked";
    });

interface ScanState {
  acceptedPoint: GraphPoint;
  path: PixelPoint[];
  reachedTargetCount: number;
  row: number;
  searchX: number;
}

interface ScanCandidate {
  controlX: number;
  farthestX: number;
  path: PixelPoint[];
  row: number;
  targetDistance: number;
  verticalDistance: number;
  windowWidth: number;
}

type ScanWorkItem = { candidate: ScanCandidate; type: "candidate" } | { state: ScanState; type: "state" };

interface ReplayResult {
  acceptedPoint?: GraphPoint;
  blockedPoint?: GraphPoint;
  reachedTargetCount: number;
  sequenceHit: boolean;
}

/** 为固定 simulation mask 预计算每格沿 x+ 保持同一 y 时的最远自由列。 */
export function createGraphwarStepGlitchScanMaskIndex(options: {
  bounds: GraphBounds;
  boundaryExpansion?: number;
  simulationMask: Uint8Array;
}): GraphwarStepGlitchScanMaskIndex {
  const expectedLength = GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT;
  if (options.simulationMask.length !== expectedLength) {
    throw new RangeError(
      `Expected a ${expectedLength}-cell Graphwar plane mask, received ${options.simulationMask.length}.`,
    );
  }

  const boundaryExpansion = Math.max(0, Math.floor(options.boundaryExpansion ?? 0));
  const mirrored = !xPlusGoesRight(options.bounds);
  const farthestFreeX = new Int16Array(expectedLength);
  farthestFreeX.fill(-1);

  for (let row = 0; row < GRAPHWAR_PLANE_HEIGHT; row += 1) {
    let farthest = -1;
    for (let searchX = GRAPHWAR_PLANE_LENGTH - 1; searchX >= 0; searchX -= 1) {
      const planeX = mirrorPlaneX(searchX, mirrored);
      const blocked =
        planeX < boundaryExpansion ||
        planeX >= GRAPHWAR_PLANE_LENGTH - boundaryExpansion ||
        row < boundaryExpansion ||
        row >= GRAPHWAR_PLANE_HEIGHT - boundaryExpansion ||
        Boolean(options.simulationMask[row * GRAPHWAR_PLANE_LENGTH + planeX]);
      if (blocked) {
        farthest = -1;
        continue;
      }

      farthest = farthest < 0 ? searchX : farthest;
      farthestFreeX[row * GRAPHWAR_PLANE_LENGTH + searchX] = farthest;
    }
  }

  return {
    boundaryExpansion,
    farthestFreeX,
    mirrored,
    simulationMask: options.simulationMask,
  };
}

/** 扫描 Step y'= 邪道控制点；每个候选都按最终表达式文本从发射点完整回放。 */
export function scanGraphwarStepGlitchPath(options: GraphwarStepGlitchScanOptions): GraphwarStepGlitchScanResult {
  if (!stepGlitchScanIsSupported(options.settings)) {
    return createBlockedResult("unsupported", 0, 0);
  }
  const requestedMaxExpandedStates = options.maxExpandedStates ?? DEFAULT_MAX_EXPANDED_STATES;
  if (
    options.sourcePath.length === 0 ||
    options.simulationMask.length !== GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT ||
    !Number.isFinite(requestedMaxExpandedStates) ||
    requestedMaxExpandedStates <= 0
  ) {
    return createBlockedResult("invalid-input", 0, 0);
  }

  const boundaryExpansion = Math.max(0, Math.floor(options.simulationBoundaryExpansion ?? 0));
  const maskIndex = getCompatibleMaskIndex(options, boundaryExpansion);
  const settings: GraphwarTrajectoryFormulaSettings = {
    ...options.settings,
    stepGlitchObstacleMask: options.simulationMask,
  };
  const requiredTargets = options.requiredTargetSequence ?? [];
  const targetSequence = [...requiredTargets, options.hitTarget];
  const targetGraphPoint = imageToGraphPoint(options.targetPoint, options.bounds, options.boundsRect);
  const lastSourcePoint = options.sourcePath.at(-1);
  if (!lastSourcePoint) {
    return createBlockedResult("invalid-input", 0, 0);
  }
  const lastSourceGraphPoint = imageToGraphPoint(lastSourcePoint, options.bounds, options.boundsRect);
  if (!graphXAdvancesStrictly(lastSourceGraphPoint.x, targetGraphPoint.x)) {
    return createBlockedResult("invalid-input", 0, 0);
  }

  const initialReplay = replayPathToControlX(
    options,
    settings,
    options.sourcePath,
    targetSequence,
    lastSourceGraphPoint.x,
    false,
  );
  if (initialReplay.sequenceHit) {
    return {
      acceptedPoint: initialReplay.acceptedPoint ?? lastSourceGraphPoint,
      expandedStates: 0,
      limitReached: false,
      path: [...options.sourcePath],
      reachedTargetCount: initialReplay.reachedTargetCount,
      status: "hit",
    };
  }
  const initialAcceptedPoint = options.sourcePath.length === 1 ? lastSourceGraphPoint : initialReplay.acceptedPoint;
  if (!initialAcceptedPoint) {
    return createBlockedResult("no-path", 0, initialReplay.reachedTargetCount, initialReplay.blockedPoint);
  }
  const initialGridPoint = graphPointToSearchGrid(initialAcceptedPoint, options, maskIndex.mirrored);
  const targetGridPoint = pixelPointToSearchGrid(options.targetPoint, options.boundsRect, maskIndex.mirrored);
  const hitTargetGridPoint = pixelPointToSearchGrid(options.hitTarget.center, options.boundsRect, maskIndex.mirrored);
  const work: ScanWorkItem[] = [
    {
      state: {
        acceptedPoint: initialAcceptedPoint,
        path: [...options.sourcePath],
        reachedTargetCount: initialReplay.reachedTargetCount,
        row: initialGridPoint.y,
        searchX: initialGridPoint.x,
      },
      type: "state",
    },
  ];
  const maxExpandedStates = Math.floor(requestedMaxExpandedStates);
  let expandedStates = 0;
  let bestReachedTargetCount = initialReplay.reachedTargetCount;
  let bestPassable: Extract<GraphwarStepGlitchScanResult, { status: "passable" }> | undefined;
  let blockedPoint = initialReplay.blockedPoint;

  while (work.length > 0) {
    const item = work.pop();
    if (!item) {
      break;
    }

    if (item.type === "state") {
      if (item.state.acceptedPoint.x >= targetGraphPoint.x) {
        bestPassable = selectBetterPassable(
          bestPassable,
          createPassableResult(item.state, expandedStates),
          targetGraphPoint,
        );
        continue;
      }

      const farthestX = getFarthestFreeX(maskIndex, item.state.searchX, item.state.row);
      if (farthestX < item.state.searchX) {
        continue;
      }
      const candidates =
        farthestX >= targetGridPoint.x
          ? [createDirectTargetCandidate(item.state, options.targetPoint, targetGraphPoint, targetGridPoint.x)]
          : createGateCandidates(item.state, farthestX + 1, targetGraphPoint, hitTargetGridPoint.y, options, maskIndex);
      candidates.sort(compareScanCandidates);
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        work.push({ candidate: candidates[index], type: "candidate" });
      }
      continue;
    }

    if (expandedStates >= maxExpandedStates) {
      return bestPassable
        ? { ...bestPassable, expandedStates, limitReached: true }
        : createBlockedResult("limit", expandedStates, bestReachedTargetCount, blockedPoint);
    }
    expandedStates += 1;
    const replay = replayPathToControlX(
      options,
      settings,
      item.candidate.path,
      targetSequence,
      item.candidate.controlX,
      true,
    );
    bestReachedTargetCount = Math.max(bestReachedTargetCount, replay.reachedTargetCount);
    blockedPoint ??= replay.blockedPoint;
    if (replay.sequenceHit) {
      const lastCandidatePoint = item.candidate.path.at(-1);
      const acceptedPoint =
        replay.acceptedPoint ??
        (lastCandidatePoint ? imageToGraphPoint(lastCandidatePoint, options.bounds, options.boundsRect) : undefined);
      if (!acceptedPoint) {
        continue;
      }
      return {
        acceptedPoint,
        expandedStates,
        limitReached: false,
        path: item.candidate.path,
        reachedTargetCount: replay.reachedTargetCount,
        status: "hit",
      };
    }
    if (replay.reachedTargetCount < requiredTargets.length || !replay.acceptedPoint) {
      continue;
    }

    const nextGridPoint = graphPointToSearchGrid(replay.acceptedPoint, options, maskIndex.mirrored);
    const nextState: ScanState = {
      acceptedPoint: replay.acceptedPoint,
      path: item.candidate.path,
      reachedTargetCount: replay.reachedTargetCount,
      row: nextGridPoint.y,
      searchX: nextGridPoint.x,
    };
    if (replay.acceptedPoint.x >= targetGraphPoint.x) {
      const passable = createPassableResult(nextState, expandedStates);
      bestPassable = selectBetterPassable(bestPassable, passable, targetGraphPoint);
    } else {
      work.push({ state: nextState, type: "state" });
    }
  }

  return bestPassable
    ? { ...bestPassable, expandedStates, limitReached: false }
    : createBlockedResult("no-path", expandedStates, bestReachedTargetCount, blockedPoint);
}

function stepGlitchScanIsSupported(settings: GraphwarTrajectoryFormulaSettings) {
  return settings.algorithm === "step" && settings.equation === "dy" && settings.stepGlitchMode;
}

function getCompatibleMaskIndex(options: GraphwarStepGlitchScanOptions, boundaryExpansion: number) {
  const index = options.maskIndex;
  const mirrored = !xPlusGoesRight(options.bounds);
  return index &&
    index.simulationMask === options.simulationMask &&
    index.boundaryExpansion === boundaryExpansion &&
    index.mirrored === mirrored
    ? index
    : createGraphwarStepGlitchScanMaskIndex({
        boundaryExpansion,
        bounds: options.bounds,
        simulationMask: options.simulationMask,
      });
}

function createGateCandidates(
  state: ScanState,
  firstBlockedSearchX: number,
  target: GraphPoint,
  targetRow: number,
  options: GraphwarStepGlitchScanOptions,
  maskIndex: GraphwarStepGlitchScanMaskIndex,
) {
  const boundaryGraphX = searchBoundaryToGraphX(firstBlockedSearchX, options, maskIndex.mirrored);
  const candidates: ScanCandidate[] = [];
  const seen = new Set<string>();

  for (const windowWidth of glitchWindowWidths) {
    const controlX = floorToDecimalPlaces(boundaryGraphX + windowWidth, options.settings.decimalPlaces);
    const startX = controlX - windowWidth;
    if (
      !graphXAdvancesStrictly(state.acceptedPoint.x, startX) ||
      !graphXAdvancesStrictly(startX, controlX) ||
      controlX > target.x
    ) {
      continue;
    }

    const controlSearchX = graphXToSearchColumn(controlX, state.acceptedPoint.y, options, maskIndex.mirrored);
    const spans = collectFreeRowSpans(maskIndex, controlSearchX);
    for (const span of spans) {
      for (let row = span.minY; row <= span.maxY; row += 1) {
        const key = `${controlX.toPrecision(17)}:${row}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        const farthestX = getFarthestFreeX(maskIndex, controlSearchX, row);
        if (farthestX < controlSearchX) {
          continue;
        }
        const controlPoint = createControlPointForFormulaEndX(controlX, row, options, options.settings.decimalPlaces);
        if (!controlPoint) {
          continue;
        }

        candidates.push({
          controlX,
          farthestX,
          path: [...state.path, controlPoint],
          row,
          targetDistance: Math.abs(row - targetRow),
          verticalDistance: Math.abs(row - state.row),
          windowWidth,
        });
      }
    }
  }
  return candidates;
}

function createDirectTargetCandidate(state: ScanState, targetPoint: PixelPoint, target: GraphPoint, farthestX: number) {
  return {
    controlX: target.x,
    farthestX,
    path: [...state.path, targetPoint],
    row: state.row,
    targetDistance: 0,
    verticalDistance: 0,
    windowWidth: Number.POSITIVE_INFINITY,
  };
}

function compareScanCandidates(left: ScanCandidate, right: ScanCandidate) {
  return (
    right.farthestX - left.farthestX ||
    left.targetDistance - right.targetDistance ||
    left.verticalDistance - right.verticalDistance ||
    right.windowWidth - left.windowWidth ||
    left.row - right.row
  );
}

function collectFreeRowSpans(index: GraphwarStepGlitchScanMaskIndex, searchX: number) {
  const spans: { maxY: number; minY: number }[] = [];
  let start = -1;
  for (let row = 0; row <= GRAPHWAR_PLANE_HEIGHT; row += 1) {
    const free = row < GRAPHWAR_PLANE_HEIGHT && getFarthestFreeX(index, searchX, row) >= searchX;
    if (free && start < 0) {
      start = row;
    } else if (!free && start >= 0) {
      spans.push({ maxY: row - 1, minY: start });
      start = -1;
    }
  }
  return spans;
}

function replayPathToControlX(
  options: GraphwarStepGlitchScanOptions,
  settings: GraphwarTrajectoryFormulaSettings,
  path: readonly PixelPoint[],
  targetSequence: readonly GraphwarTrajectoryTargetCircle[],
  controlX: number,
  stopOnSequenceComplete: boolean,
): ReplayResult {
  if (path.length < 2) {
    return { reachedTargetCount: 0, sequenceHit: false };
  }
  const graphPoints = path.map((point) => imageToGraphPoint(point, options.bounds, options.boundsRect));
  const context = createGraphwarTrajectoryFormulaContext({
    bounds: options.bounds,
    points: graphPoints,
    settings,
    soldierCenter: graphPoints[0],
  });
  if (context.formulaPoints.length < 2) {
    return { reachedTargetCount: 0, sequenceHit: false };
  }

  const result = sampleGraphwarFormulaTrajectory({
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    collision: {
      boundaryExpansion: options.simulationBoundaryExpansion,
      mask: options.simulationMask,
    },
    context,
    stopOnTargetSequenceComplete: stopOnSequenceComplete,
    targetSequence,
  });
  const sequenceHit = targetSequence.length > 0 && result.reachedTargetCount >= targetSequence.length;
  if (sequenceHit) {
    return {
      acceptedPoint: result.sample.points.at(-1),
      reachedTargetCount: result.reachedTargetCount,
      sequenceHit: true,
    };
  }

  let acceptedPoint: GraphPoint | undefined;
  for (let index = 0; index < result.sample.points.length; index += 1) {
    const point = result.sample.points[index];
    if (point.x < controlX) {
      continue;
    }
    if (result.obstacleHitIndex >= 0 && index >= result.obstacleHitIndex) {
      break;
    }
    acceptedPoint = point;
    break;
  }
  return {
    acceptedPoint,
    blockedPoint: result.obstacleHitIndex >= 0 ? result.sample.points[result.obstacleHitIndex] : undefined,
    reachedTargetCount: result.reachedTargetCount,
    sequenceHit: false,
  };
}

function getFarthestFreeX(index: GraphwarStepGlitchScanMaskIndex, searchX: number, row: number) {
  if (searchX < 0 || searchX >= GRAPHWAR_PLANE_LENGTH || row < 0 || row >= GRAPHWAR_PLANE_HEIGHT) {
    return -1;
  }
  return index.farthestFreeX[row * GRAPHWAR_PLANE_LENGTH + searchX];
}

function pixelPointToSearchGrid(point: PixelPoint, boundsRect: BoundsRect, mirrored: boolean) {
  const plane = imagePointToPlaneGridPoint(point, boundsRect);
  return { x: mirrorPlaneX(plane.x, mirrored), y: plane.y };
}

function graphPointToSearchGrid(
  point: GraphPoint,
  options: Pick<GraphwarStepGlitchScanOptions, "bounds" | "boundsRect">,
  mirrored: boolean,
) {
  return pixelPointToSearchGrid(
    graphToImagePoint(point, options.bounds, options.boundsRect),
    options.boundsRect,
    mirrored,
  );
}

function graphXToSearchColumn(
  graphX: number,
  graphY: number,
  options: Pick<GraphwarStepGlitchScanOptions, "bounds" | "boundsRect">,
  mirrored: boolean,
) {
  return graphPointToSearchGrid(createGraphPoint(graphX, graphY), options, mirrored).x;
}

function searchBoundaryToGraphX(
  searchBoundaryX: number,
  options: Pick<GraphwarStepGlitchScanOptions, "bounds" | "boundsRect">,
  mirrored: boolean,
) {
  const planeBoundaryX = mirrored ? GRAPHWAR_PLANE_LENGTH - searchBoundaryX : searchBoundaryX;
  const pixel = createPixelPoint(
    options.boundsRect.x + (planeBoundaryX / GRAPHWAR_PLANE_LENGTH) * options.boundsRect.width,
    options.boundsRect.y,
  );
  return imageToGraphPoint(pixel, options.bounds, options.boundsRect).x;
}

function createControlPointForFormulaEndX(
  formulaEndX: number,
  row: number,
  options: Pick<GraphwarStepGlitchScanOptions, "bounds" | "boundsRect">,
  decimalPlaces: number,
) {
  const rowCenter = planeGridCellCenterToImagePoint({ x: 0, y: row }, options.boundsRect);
  const graphY = imageToGraphPoint(rowCenter, options.bounds, options.boundsRect).y;
  let controlPointX = formulaEndX;

  // Graph→像素→Graph 可能向左偏数个 ULP；向 x+ 微调，直到最终 floor 后的右门仍是期望值。
  for (let attempt = 0; attempt < MAX_CONTROL_POINT_ROUND_TRIP_NUDGES; attempt += 1) {
    const point = graphToImagePoint(createGraphPoint(controlPointX, graphY), options.bounds, options.boundsRect);
    const roundTripX = imageToGraphPoint(point, options.bounds, options.boundsRect).x;
    const actualFormulaEndX = floorToDecimalPlaces(roundTripX, decimalPlaces);
    if (actualFormulaEndX === formulaEndX) {
      return point;
    }
    if (actualFormulaEndX > formulaEndX) {
      return undefined;
    }
    controlPointX = nextUpDouble(controlPointX);
  }
  return undefined;
}

function mirrorPlaneX(x: number, mirrored: boolean) {
  return mirrored ? GRAPHWAR_PLANE_LENGTH - 1 - x : x;
}

function createGlitchWindowWidths() {
  const widths: number[] = [];
  let minimumWidth = GRAPHWAR_STEP_SIZE;
  while (minimumWidth > GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE) {
    minimumWidth /= 2;
  }
  let width = GRAPHWAR_STEP_SIZE;
  while (width >= minimumWidth) {
    widths.push(width);
    width /= 2;
  }
  return widths;
}

function createPassableResult(
  state: ScanState,
  expandedStates: number,
): Extract<GraphwarStepGlitchScanResult, { status: "passable" }> {
  return {
    acceptedPoint: state.acceptedPoint,
    expandedStates,
    limitReached: false,
    path: state.path,
    reachedTargetCount: state.reachedTargetCount,
    status: "passable",
  };
}

function selectBetterPassable(
  current: Extract<GraphwarStepGlitchScanResult, { status: "passable" }> | undefined,
  candidate: Extract<GraphwarStepGlitchScanResult, { status: "passable" }>,
  target: GraphPoint,
) {
  if (!current) {
    return candidate;
  }
  const currentDistance = Math.abs(target.x - current.acceptedPoint.x);
  const candidateDistance = Math.abs(target.x - candidate.acceptedPoint.x);
  return candidateDistance < currentDistance ||
    (candidateDistance === currentDistance && candidate.path.length < current.path.length)
    ? candidate
    : current;
}

function createBlockedResult(
  reason: Extract<GraphwarStepGlitchScanResult, { status: "blocked" }>["reason"],
  expandedStates: number,
  reachedTargetCount: number,
  blockedPoint?: GraphPoint,
): Extract<GraphwarStepGlitchScanResult, { status: "blocked" }> {
  return {
    ...(blockedPoint ? { blockedPoint } : {}),
    expandedStates,
    limitReached: reason === "limit",
    reachedTargetCount,
    reason,
    status: "blocked",
  };
}
