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
  GraphwarTrajectoryFormulaContext,
  GraphwarTrajectoryFormulaSettings,
  GraphwarTrajectorySampleResult,
  GraphwarTrajectoryTargetCircle,
} from "../../formula/trajectory/sampling";

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

export interface GraphwarStepGlitchPrefixOptions {
  bounds: GraphBounds;
  boundsRect: BoundsRect;
  /** 可复用的同 mask 索引；不匹配时扫描器会自行重建。 */
  maskIndex?: GraphwarStepGlitchScanMaskIndex;
  /** 固定前缀必须继续按顺序命中的目标。 */
  requiredTargetSequence?: readonly GraphwarTrajectoryTargetCircle[];
  /** 函数采样边界内收值，单位为 Graphwar 原始平面像素。 */
  simulationBoundaryExpansion?: number;
  /** 前缀回放和后续候选都使用这一份 mask。 */
  simulationMask: Uint8Array;
  settings: GraphwarTrajectoryFormulaSettings;
  /** 已提交的完整固定前缀；最后一点是后续边的起点。 */
  sourcePath: readonly PixelPoint[];
}

export interface GraphwarStepGlitchTargetOptions {
  /** 当前目标的实际命中圈。 */
  hitTarget: GraphwarTrajectoryTargetCircle;
  /** 当前目标使用的控制点；可与命中圈中心不同。 */
  targetPoint: PixelPoint;
}

export type GraphwarStepGlitchScanOptions = GraphwarStepGlitchPrefixOptions & GraphwarStepGlitchTargetOptions;

interface GraphwarStepGlitchScanResultBase {
  /** 实际执行过最终文本回放的候选路径数。 */
  expandedStates: number;
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
      blockedPoint?: GraphPoint;
      status: "invalid-input" | "no-path" | "unsupported";
    });

export interface GraphwarStepGlitchPrefixScanner {
  scan: (target: GraphwarStepGlitchTargetOptions) => GraphwarStepGlitchScanResult;
}

/** 固定前缀的公式、完整回放和真实恢复点；只在当前 scanner 闭包中保留一份。 */
interface PreparedGraphwarStepGlitchPrefix {
  acceptedPoint: GraphPoint;
  formulaContext?: GraphwarTrajectoryFormulaContext;
  formulaSettings: GraphwarTrajectoryFormulaSettings;
  graphPoints: readonly GraphPoint[];
  replay?: GraphwarTrajectorySampleResult;
  simulationBoundaryExpansion: number;
  status: "ready";
}

type PreparedGraphwarStepGlitchPrefixResult =
  | PreparedGraphwarStepGlitchPrefix
  | Exclude<GraphwarStepGlitchScanResult, { status: "hit" }>;

interface ScanState {
  acceptedPoint: GraphPoint;
  path: PixelPoint[];
  row: number;
  searchX: number;
}

interface ScanCandidate {
  controlX: number;
  farthestX: number;
  kind: "gate" | "target";
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

/** 准备固定前缀；同一 scanner 尝试多个更右目标时只做一次公式生成和完整回放。 */
function prepareGraphwarStepGlitchPrefix(
  options: GraphwarStepGlitchPrefixOptions,
): PreparedGraphwarStepGlitchPrefixResult {
  if (!stepGlitchScanIsSupported(options.settings)) {
    return createFailedResult("unsupported", 0, 0);
  }
  if (
    options.sourcePath.length === 0 ||
    options.simulationMask.length !== GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT
  ) {
    return createFailedResult("invalid-input", 0, 0);
  }

  const simulationBoundaryExpansion = Math.max(0, Math.floor(options.simulationBoundaryExpansion ?? 0));
  const requiredTargetSequence = options.requiredTargetSequence ?? [];
  const settings: GraphwarTrajectoryFormulaSettings = {
    ...options.settings,
    stepGlitchObstacleMask: options.simulationMask,
  };
  const graphPoints = options.sourcePath.map((point) => imageToGraphPoint(point, options.bounds, options.boundsRect));
  const lastGraphPoint = graphPoints.at(-1);
  if (!lastGraphPoint) {
    return createFailedResult("invalid-input", 0, 0);
  }

  if (graphPoints.length === 1) {
    return requiredTargetSequence.length === 0
      ? {
          acceptedPoint: lastGraphPoint,
          formulaSettings: settings,
          graphPoints,
          simulationBoundaryExpansion,
          status: "ready",
        }
      : createFailedResult("no-path", 0, 0);
  }

  const formulaContext = createGraphwarTrajectoryFormulaContext({
    bounds: options.bounds,
    points: graphPoints,
    settings,
    soldierCenter: graphPoints[0],
  });
  if (formulaContext.formulaPoints.length < 2) {
    return createFailedResult("no-path", 0, 0);
  }
  const replay = sampleGraphwarFormulaTrajectory({
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    collision: {
      boundaryExpansion: simulationBoundaryExpansion,
      mask: options.simulationMask,
    },
    context: formulaContext,
    stopOnTargetSequenceComplete: false,
    targetSequence: requiredTargetSequence,
  });
  const acceptedPoint = findAcceptedPointAtOrAfterControlX(
    replay.sample.points,
    replay.obstacleHitIndex,
    lastGraphPoint.x,
    requiredTargetSequence.length > 0 ? replay.targetHitIndex : 0,
  );
  const blockedPoint = replay.obstacleHitIndex >= 0 ? replay.sample.points[replay.obstacleHitIndex] : undefined;
  if (replay.reachedTargetCount < requiredTargetSequence.length || !acceptedPoint) {
    return createFailedResult("no-path", 0, replay.reachedTargetCount, blockedPoint);
  }

  return {
    acceptedPoint,
    formulaContext,
    formulaSettings: settings,
    graphPoints,
    replay,
    simulationBoundaryExpansion,
    status: "ready",
  };
}

/** 创建绑定单个固定前缀的扫描器；失败目标共享缓存，成功提交后由调用方丢弃。 */
export function createGraphwarStepGlitchPrefixScanner(
  options: GraphwarStepGlitchPrefixOptions,
): GraphwarStepGlitchPrefixScanner {
  const prefix = prepareGraphwarStepGlitchPrefix(options);
  return {
    scan: (target) =>
      prefix.status === "ready" ? scanPreparedGraphwarStepGlitchPath(options, prefix, target) : prefix,
  };
}

/** 单目标便捷入口；每个追加候选仍按最终表达式文本从发射点完整回放。 */
export function scanGraphwarStepGlitchPath(options: GraphwarStepGlitchScanOptions): GraphwarStepGlitchScanResult {
  return createGraphwarStepGlitchPrefixScanner(options).scan(options);
}

function scanPreparedGraphwarStepGlitchPath(
  options: GraphwarStepGlitchPrefixOptions,
  prefix: PreparedGraphwarStepGlitchPrefix,
  target: GraphwarStepGlitchTargetOptions,
): GraphwarStepGlitchScanResult {
  const boundaryExpansion = Math.max(0, Math.floor(options.simulationBoundaryExpansion ?? 0));
  const maskIndex = getCompatibleMaskIndex(options, boundaryExpansion);
  const requiredTargets = options.requiredTargetSequence ?? [];
  const targetSequence = [...requiredTargets, target.hitTarget];
  const targetGraphPoint = imageToGraphPoint(target.targetPoint, options.bounds, options.boundsRect);
  const lastSourceGraphPoint = prefix.graphPoints.at(-1);
  const prefixReachedTargetCount = prefix.replay?.reachedTargetCount ?? 0;
  if (!lastSourceGraphPoint || !graphXAdvancesStrictly(lastSourceGraphPoint.x, targetGraphPoint.x)) {
    return createFailedResult("invalid-input", 0, prefixReachedTargetCount);
  }

  const initialAcceptedPoint = prefix.acceptedPoint;
  const initialGridPoint = graphPointToSearchGrid(initialAcceptedPoint, options, maskIndex.mirrored);
  const targetGridPoint = pixelPointToSearchGrid(target.targetPoint, options.boundsRect, maskIndex.mirrored);
  const hitTargetGridPoint = pixelPointToSearchGrid(target.hitTarget.center, options.boundsRect, maskIndex.mirrored);
  const work: ScanWorkItem[] = [
    {
      state: {
        acceptedPoint: initialAcceptedPoint,
        path: [...options.sourcePath],
        row: initialGridPoint.y,
        searchX: initialGridPoint.x,
      },
      type: "state",
    },
  ];
  let expandedStates = 0;
  let bestReachedTargetCount = prefixReachedTargetCount;
  let blockedPoint =
    prefix.replay && prefix.replay.obstacleHitIndex >= 0
      ? prefix.replay.sample.points[prefix.replay.obstacleHitIndex]
      : undefined;

  while (work.length > 0) {
    const item = work.pop();
    if (!item) {
      break;
    }

    if (item.type === "state") {
      if (item.state.acceptedPoint.x >= targetGraphPoint.x) {
        continue;
      }

      const farthestX = getFarthestFreeX(maskIndex, item.state.searchX, item.state.row);
      if (farthestX < item.state.searchX) {
        continue;
      }
      const candidates =
        farthestX >= targetGridPoint.x
          ? [createDirectTargetCandidate(item.state, target.targetPoint, targetGraphPoint, targetGridPoint.x)]
          : createGateCandidates(item.state, farthestX + 1, targetGraphPoint, hitTargetGridPoint.y, options, maskIndex);
      candidates.sort(compareScanCandidates);
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        work.push({ candidate: candidates[index], type: "candidate" });
      }
      continue;
    }

    expandedStates += 1;
    const finalTargetCandidate = item.candidate.kind === "target";
    const replay = replayPathToControlX(
      options,
      prefix,
      item.candidate.path,
      finalTargetCandidate ? targetSequence : requiredTargets,
      item.candidate.controlX,
    );
    bestReachedTargetCount = Math.max(bestReachedTargetCount, replay.reachedTargetCount);
    blockedPoint ??= replay.blockedPoint;
    if (finalTargetCandidate) {
      if (!replay.sequenceHit || !replay.acceptedPoint) {
        continue;
      }
      return {
        acceptedPoint: replay.acceptedPoint,
        expandedStates,
        path: item.candidate.path,
        reachedTargetCount: replay.reachedTargetCount,
        status: "hit",
      };
    }
    if (replay.reachedTargetCount < requiredTargets.length || !replay.acceptedPoint) {
      continue;
    }

    const nextGridPoint = graphPointToSearchGrid(replay.acceptedPoint, options, maskIndex.mirrored);
    if (replay.acceptedPoint.x >= targetGraphPoint.x) {
      continue;
    }
    work.push({
      state: {
        acceptedPoint: replay.acceptedPoint,
        path: item.candidate.path,
        row: nextGridPoint.y,
        searchX: nextGridPoint.x,
      },
      type: "state",
    });
  }

  return createFailedResult("no-path", expandedStates, bestReachedTargetCount, blockedPoint);
}

function stepGlitchScanIsSupported(settings: GraphwarTrajectoryFormulaSettings) {
  return settings.algorithm === "step" && settings.equation === "dy" && settings.stepGlitchMode;
}

/** 后缀会反向改变 Step 发射点和旧轨迹；只复用坐标映射，候选仍从发射点回放整式。 */
function replayPathToControlX(
  options: GraphwarStepGlitchPrefixOptions,
  prefix: PreparedGraphwarStepGlitchPrefix,
  path: readonly PixelPoint[],
  targetSequence: readonly GraphwarTrajectoryTargetCircle[],
  controlX: number,
): ReplayResult {
  if (path.length < 2 || path.length < options.sourcePath.length) {
    return { reachedTargetCount: 0, sequenceHit: false };
  }
  const graphPoints = [
    ...prefix.graphPoints,
    ...path
      .slice(options.sourcePath.length)
      .map((point) => imageToGraphPoint(point, options.bounds, options.boundsRect)),
  ];
  const context = createGraphwarTrajectoryFormulaContext({
    bounds: options.bounds,
    points: graphPoints,
    settings: prefix.formulaSettings,
    soldierCenter: graphPoints[0],
  });
  if (context.formulaPoints.length < 2) {
    return { reachedTargetCount: 0, sequenceHit: false };
  }

  const result = sampleGraphwarFormulaTrajectory({
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    collision: {
      boundaryExpansion: prefix.simulationBoundaryExpansion,
      mask: options.simulationMask,
    },
    ...(targetSequence.length > 0 ? { continueAfterTargetSequenceUntilGraphX: controlX } : {}),
    context,
    stopOnTargetSequenceComplete: false,
    targetSequence,
  });
  const sequenceHit = targetSequence.length > 0 && result.reachedTargetCount >= targetSequence.length;
  return {
    acceptedPoint: findAcceptedPointAtOrAfterControlX(
      result.sample.points,
      result.obstacleHitIndex,
      controlX,
      targetSequence.length > 0 ? result.targetHitIndex : 0,
    ),
    blockedPoint: result.obstacleHitIndex >= 0 ? result.sample.points[result.obstacleHitIndex] : undefined,
    reachedTargetCount: result.reachedTargetCount,
    sequenceHit,
  };
}

function getCompatibleMaskIndex(options: GraphwarStepGlitchPrefixOptions, boundaryExpansion: number) {
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
  options: GraphwarStepGlitchPrefixOptions,
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
      !graphXAdvancesStrictly(controlX, target.x)
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
          kind: "gate",
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
    kind: "target" as const,
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
  options: Pick<GraphwarStepGlitchPrefixOptions, "bounds" | "boundsRect">,
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
  options: Pick<GraphwarStepGlitchPrefixOptions, "bounds" | "boundsRect">,
  mirrored: boolean,
) {
  return graphPointToSearchGrid(createGraphPoint(graphX, graphY), options, mirrored).x;
}

function searchBoundaryToGraphX(
  searchBoundaryX: number,
  options: Pick<GraphwarStepGlitchPrefixOptions, "bounds" | "boundsRect">,
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
  options: Pick<GraphwarStepGlitchPrefixOptions, "bounds" | "boundsRect">,
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

function findAcceptedPointAtOrAfterControlX(
  points: readonly GraphPoint[],
  obstacleHitIndex: number,
  controlX: number,
  minimumIndex = 0,
) {
  for (let index = Math.max(0, minimumIndex); index < points.length; index += 1) {
    if (obstacleHitIndex >= 0 && index >= obstacleHitIndex) {
      break;
    }
    const point = points[index];
    if (point && point.x >= controlX) {
      return point;
    }
  }
  return undefined;
}

function createFailedResult(
  status: Exclude<GraphwarStepGlitchScanResult["status"], "hit">,
  expandedStates: number,
  reachedTargetCount: number,
  blockedPoint?: GraphPoint,
): Exclude<GraphwarStepGlitchScanResult, { status: "hit" }> {
  return {
    ...(blockedPoint ? { blockedPoint } : {}),
    expandedStates,
    reachedTargetCount,
    status,
  };
}
