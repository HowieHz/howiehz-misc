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
import { nowMs } from "../../core/time";
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
  /** 完全相同旧整式已经回放成功时，可直接复用其真实恢复点。 */
  prefixEvidence?: GraphwarStepGlitchPrefixEvidence;
  /** 旧公式必须命中的当前尾点；只用于 evidence/prefix 准备，不约束新最终直连公式。 */
  prefixTarget?: GraphwarTrajectoryTargetCircle;
  /** 固定前缀必须继续命中的士兵；后续控制点允许改变它们的实际命中顺序。 */
  requiredTargets?: readonly GraphwarTrajectoryTargetCircle[];
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
  /** 本条完整公式命中的无序必达目标加当前有序目标数量。 */
  reachedTargetCount: number;
  /** 本次扫描内部阶段耗时；调用方负责映射到页面调试面板。 */
  timings: GraphwarStepGlitchScanTiming[];
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

/** 完全相同旧整式的验证证据；新增后缀仍必须从发射点完整回放。 */
export interface GraphwarStepGlitchPrefixEvidence {
  acceptedPoint: GraphPoint;
}

export type GraphwarStepGlitchScanTimingStage =
  | "prefix-evidence-hit"
  | "prefix-evidence-miss"
  | "prepare-prefix"
  | "scan-candidates"
  | "validate-direct";

export interface GraphwarStepGlitchScanTiming {
  elapsedMs: number;
  stage: GraphwarStepGlitchScanTimingStage;
}

/** 固定前缀的坐标和公式设置；候选回放复用映射结果，但不复用物理状态。 */
interface GraphwarStepGlitchReplayContext {
  formulaSettings: GraphwarTrajectoryFormulaSettings;
  graphPoints: readonly GraphPoint[];
  simulationBoundaryExpansion: number;
}

/** 固定前缀的真实恢复点；只在当前 scanner 闭包中保留一份。 */
interface PreparedGraphwarStepGlitchPrefix extends GraphwarStepGlitchReplayContext {
  acceptedPoint: GraphPoint;
  blockedPoint?: GraphPoint;
  reachedTargetCount: number;
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

export interface GraphwarStepGlitchReplayResult {
  acceptedPoint?: GraphPoint;
  blockedPoint?: GraphPoint;
  reachedTargetCount: number;
  /** 当前有序目标和全部无序必达目标是否都已命中。 */
  targetsHit: boolean;
}

interface InitialDirectReplay {
  path: PixelPoint[];
  replay: GraphwarStepGlitchReplayResult;
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

/** 构造候选回放共用的坐标和公式设置，不在这里采样旧 prefix。 */
function createGraphwarStepGlitchReplayContext(
  options: GraphwarStepGlitchPrefixOptions,
  timings: GraphwarStepGlitchScanTiming[],
): GraphwarStepGlitchReplayContext | Exclude<GraphwarStepGlitchScanResult, { status: "hit" }> {
  if (!stepGlitchScanIsSupported(options.settings)) {
    return createFailedResult("unsupported", 0, 0, undefined, timings);
  }
  if (
    options.sourcePath.length === 0 ||
    options.simulationMask.length !== GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT
  ) {
    return createFailedResult("invalid-input", 0, 0, undefined, timings);
  }

  const simulationBoundaryExpansion = Math.max(0, Math.floor(options.simulationBoundaryExpansion ?? 0));
  const settings: GraphwarTrajectoryFormulaSettings = {
    ...options.settings,
    stepGlitchObstacleMask: options.simulationMask,
  };
  const graphPoints = options.sourcePath.map((point) => imageToGraphPoint(point, options.bounds, options.boundsRect));
  return {
    formulaSettings: settings,
    graphPoints,
    simulationBoundaryExpansion,
  };
}

/** 准备固定前缀；证据未命中时才完整回放旧整式取得真实恢复点。 */
function prepareGraphwarStepGlitchPrefix(
  options: GraphwarStepGlitchPrefixOptions,
  context: GraphwarStepGlitchReplayContext,
  timings: GraphwarStepGlitchScanTiming[],
): PreparedGraphwarStepGlitchPrefixResult {
  const requiredTargets = options.requiredTargets ?? [];
  const prefixTarget = options.prefixTarget;
  // 即使尾点也属于 required，仍单独跟踪它；恢复扫描应停在尾控制点，不能等更右的历史命中。
  const prefixTargetSequence = prefixTarget ? [prefixTarget] : [];
  const expectedTargetCount = requiredTargets.length + prefixTargetSequence.length;
  const lastGraphPoint = context.graphPoints.at(-1);
  if (!lastGraphPoint) {
    return createFailedResult("invalid-input", 0, 0, undefined, timings);
  }

  if (context.graphPoints.length === 1) {
    return expectedTargetCount === 0
      ? {
          acceptedPoint: lastGraphPoint,
          ...context,
          reachedTargetCount: 0,
          status: "ready",
        }
      : createFailedResult("no-path", 0, 0, undefined, timings);
  }

  const evidenceStartedAt = nowMs();
  const evidence = options.prefixEvidence;
  const evidenceMatchesControlX = Boolean(evidence && evidence.acceptedPoint.x >= lastGraphPoint.x);
  timings.push({
    elapsedMs: nowMs() - evidenceStartedAt,
    stage: evidenceMatchesControlX ? "prefix-evidence-hit" : "prefix-evidence-miss",
  });
  if (evidence && evidenceMatchesControlX) {
    return {
      acceptedPoint: evidence.acceptedPoint,
      ...context,
      reachedTargetCount: expectedTargetCount,
      status: "ready",
    };
  }

  const replay = measureGraphwarStepGlitchScanTiming(timings, "prepare-prefix", () =>
    replayPathToControlX(options, context, options.sourcePath, prefixTargetSequence, requiredTargets, lastGraphPoint.x),
  );
  if (!replay.targetsHit || !replay.acceptedPoint) {
    return createFailedResult("no-path", 0, replay.reachedTargetCount, replay.blockedPoint, timings);
  }

  return {
    acceptedPoint: replay.acceptedPoint,
    ...context,
    ...(replay.blockedPoint ? { blockedPoint: replay.blockedPoint } : {}),
    reachedTargetCount: replay.reachedTargetCount,
    status: "ready",
  };
}

/** 创建绑定单个固定前缀的扫描器；先试最终直连，失败后才懒准备旧 prefix。 */
export function createGraphwarStepGlitchPrefixScanner(
  options: GraphwarStepGlitchPrefixOptions,
): GraphwarStepGlitchPrefixScanner {
  let preparedPrefix: PreparedGraphwarStepGlitchPrefixResult | undefined;
  return {
    scan: (target) => {
      const timings: GraphwarStepGlitchScanTiming[] = [];
      const context = createGraphwarStepGlitchReplayContext(options, timings);
      if ("status" in context) {
        return context;
      }

      const requiredTargets = options.requiredTargets ?? [];
      const targetSequence = createOrderedTargetSequence(requiredTargets, target.hitTarget);
      const targetGraphPoint = imageToGraphPoint(target.targetPoint, options.bounds, options.boundsRect);
      const lastSourceGraphPoint = context.graphPoints.at(-1);
      if (!lastSourceGraphPoint || !graphXAdvancesStrictly(lastSourceGraphPoint.x, targetGraphPoint.x)) {
        return createFailedResult("invalid-input", 0, requiredTargets.length, undefined, timings);
      }

      const directPath = [...options.sourcePath, target.targetPoint];
      const directReplay = measureGraphwarStepGlitchScanTiming(timings, "validate-direct", () =>
        replayPathToControlX(options, context, directPath, targetSequence, requiredTargets, targetGraphPoint.x),
      );
      if (directReplay.targetsHit && directReplay.acceptedPoint) {
        return {
          acceptedPoint: directReplay.acceptedPoint,
          expandedStates: 1,
          path: directPath,
          reachedTargetCount: directReplay.reachedTargetCount,
          status: "hit",
          timings,
        };
      }

      preparedPrefix ??= prepareGraphwarStepGlitchPrefix(options, context, timings);
      if (preparedPrefix.status !== "ready") {
        return createFailedResult(
          preparedPrefix.status,
          1,
          Math.max(preparedPrefix.reachedTargetCount, directReplay.reachedTargetCount),
          directReplay.blockedPoint ?? preparedPrefix.blockedPoint,
          timings,
        );
      }
      return measureGraphwarStepGlitchScanTiming(timings, "scan-candidates", () =>
        scanPreparedGraphwarStepGlitchPath(
          options,
          preparedPrefix as PreparedGraphwarStepGlitchPrefix,
          target,
          {
            path: directPath,
            replay: directReplay,
          },
          timings,
        ),
      );
    },
  };
}

/** 单目标便捷入口；每个追加候选仍按最终表达式文本从发射点完整回放。 */
export function scanGraphwarStepGlitchPath(options: GraphwarStepGlitchScanOptions): GraphwarStepGlitchScanResult {
  return createGraphwarStepGlitchPrefixScanner(options).scan(options);
}

/** 精确回放指定最终路径；删点优化用它保存与实际返回路径一致的 evidence。 */
export function replayGraphwarStepGlitchPathToControlX(
  options: GraphwarStepGlitchPrefixOptions & {
    controlX: number;
    path: readonly PixelPoint[];
    targetSequence: readonly GraphwarTrajectoryTargetCircle[];
  },
): GraphwarStepGlitchReplayResult {
  const context = createGraphwarStepGlitchReplayContext(options, []);
  return "status" in context
    ? { reachedTargetCount: 0, targetsHit: false }
    : replayPathToControlX(
        options,
        context,
        options.path,
        options.targetSequence,
        options.requiredTargets ?? [],
        options.controlX,
      );
}

function scanPreparedGraphwarStepGlitchPath(
  options: GraphwarStepGlitchPrefixOptions,
  prefix: PreparedGraphwarStepGlitchPrefix,
  target: GraphwarStepGlitchTargetOptions,
  initialDirect: InitialDirectReplay,
  timings: GraphwarStepGlitchScanTiming[],
): GraphwarStepGlitchScanResult {
  const boundaryExpansion = Math.max(0, Math.floor(options.simulationBoundaryExpansion ?? 0));
  const maskIndex = getCompatibleMaskIndex(options, boundaryExpansion);
  const requiredTargets = options.requiredTargets ?? [];
  const targetSequence = createOrderedTargetSequence(requiredTargets, target.hitTarget);
  const targetGraphPoint = imageToGraphPoint(target.targetPoint, options.bounds, options.boundsRect);
  const lastSourceGraphPoint = prefix.graphPoints.at(-1);
  const prefixReachedTargetCount = prefix.reachedTargetCount;
  if (!lastSourceGraphPoint || !graphXAdvancesStrictly(lastSourceGraphPoint.x, targetGraphPoint.x)) {
    return createFailedResult("invalid-input", 0, prefixReachedTargetCount, undefined, timings);
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
  let expandedStates = 1;
  let bestReachedTargetCount = Math.max(prefixReachedTargetCount, initialDirect.replay.reachedTargetCount);
  let blockedPoint = initialDirect.replay.blockedPoint ?? prefix.blockedPoint;

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

    if (samePixelPath(item.candidate.path, initialDirect.path)) {
      continue;
    }
    expandedStates += 1;
    const finalTargetCandidate = item.candidate.kind === "target";
    const replay = replayPathToControlX(
      options,
      prefix,
      item.candidate.path,
      finalTargetCandidate ? targetSequence : [],
      requiredTargets,
      item.candidate.controlX,
    );
    bestReachedTargetCount = Math.max(bestReachedTargetCount, replay.reachedTargetCount);
    blockedPoint ??= replay.blockedPoint;
    if (finalTargetCandidate) {
      if (!replay.targetsHit || !replay.acceptedPoint) {
        continue;
      }
      return {
        acceptedPoint: replay.acceptedPoint,
        expandedStates,
        path: item.candidate.path,
        reachedTargetCount: replay.reachedTargetCount,
        status: "hit",
        timings,
      };
    }
    if (!replay.targetsHit || !replay.acceptedPoint) {
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

  return createFailedResult("no-path", expandedStates, bestReachedTargetCount, blockedPoint, timings);
}

function stepGlitchScanIsSupported(settings: GraphwarTrajectoryFormulaSettings) {
  return settings.algorithm === "step" && settings.equation === "dy" && settings.stepGlitchMode;
}

/** 后缀会反向改变 Step 发射点和旧轨迹；只复用坐标映射，候选仍从发射点回放整式。 */
function replayPathToControlX(
  options: GraphwarStepGlitchPrefixOptions,
  context: GraphwarStepGlitchReplayContext,
  path: readonly PixelPoint[],
  targetSequence: readonly GraphwarTrajectoryTargetCircle[],
  requiredTargets: readonly GraphwarTrajectoryTargetCircle[],
  controlX: number,
): GraphwarStepGlitchReplayResult {
  if (path.length < 2 || path.length < options.sourcePath.length) {
    return { reachedTargetCount: 0, targetsHit: false };
  }
  const graphPoints = [
    ...context.graphPoints,
    ...path
      .slice(options.sourcePath.length)
      .map((point) => imageToGraphPoint(point, options.bounds, options.boundsRect)),
  ];
  const formulaContext = createGraphwarTrajectoryFormulaContext({
    bounds: options.bounds,
    points: graphPoints,
    settings: context.formulaSettings,
    soldierCenter: graphPoints[0],
  });
  if (formulaContext.formulaPoints.length < 2) {
    return { reachedTargetCount: 0, targetsHit: false };
  }

  const result = sampleGraphwarFormulaTrajectory({
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    collision: {
      boundaryExpansion: context.simulationBoundaryExpansion,
      mask: options.simulationMask,
    },
    continueAfterTargetsUntilGraphX: controlX,
    context: formulaContext,
    requiredTargets,
    stopOnTargetsComplete: false,
    targetSequence,
  });
  const targetsHit =
    result.reachedTargetCount >= targetSequence.length && result.reachedRequiredTargetCount >= requiredTargets.length;
  const lastSafeIndex = result.obstacleHitIndex >= 0 ? result.obstacleHitIndex - 1 : result.sample.points.length - 1;
  const validationTargetHitIndex = Math.max(result.targetHitIndex, result.requiredTargetsHitIndex);
  const validationTargetsFinishSafely =
    targetSequence.length === 0 && requiredTargets.length === 0
      ? true
      : validationTargetHitIndex >= 0 && validationTargetHitIndex <= lastSafeIndex;
  return {
    // Required 只证明整式最终命中，可能位于下个控制点右侧；扫描恢复点只等待当前有序目标。
    acceptedPoint:
      targetsHit && validationTargetsFinishSafely
        ? findGraphwarStepGlitchAcceptedPointAtOrAfterControlX(
            result.sample.points,
            result.obstacleHitIndex,
            controlX,
            Math.max(result.targetHitIndex, 0),
          )
        : undefined,
    blockedPoint: result.obstacleHitIndex >= 0 ? result.sample.points[result.obstacleHitIndex] : undefined,
    reachedTargetCount: result.reachedTargetCount + result.reachedRequiredTargetCount,
    targetsHit,
  };
}

/** 当前目标若已属于历史必达集合，就不再制造第二份有序命中要求。 */
function createOrderedTargetSequence(
  requiredTargets: readonly GraphwarTrajectoryTargetCircle[],
  target: GraphwarTrajectoryTargetCircle,
) {
  return requiredTargets.some((required) => sameTargetCircle(required, target)) ? [] : [target];
}

function sameTargetCircle(left: GraphwarTrajectoryTargetCircle, right: GraphwarTrajectoryTargetCircle) {
  return left.center.x === right.center.x && left.center.y === right.center.y && left.radius === right.radius;
}

function samePixelPath(left: readonly PixelPoint[], right: readonly PixelPoint[]) {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftPoint = left[index];
    const rightPoint = right[index];
    if (!leftPoint || !rightPoint || leftPoint.x !== rightPoint.x || leftPoint.y !== rightPoint.y) {
      return false;
    }
  }
  return true;
}

function measureGraphwarStepGlitchScanTiming<TResult>(
  timings: GraphwarStepGlitchScanTiming[],
  stage: GraphwarStepGlitchScanTimingStage,
  task: () => TResult,
) {
  const startedAt = nowMs();
  try {
    return task();
  } finally {
    timings.push({ elapsedMs: nowMs() - startedAt, stage });
  }
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

export function findGraphwarStepGlitchAcceptedPointAtOrAfterControlX(
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
  timings: GraphwarStepGlitchScanTiming[] = [],
): Exclude<GraphwarStepGlitchScanResult, { status: "hit" }> {
  return {
    ...(blockedPoint ? { blockedPoint } : {}),
    expandedStates,
    reachedTargetCount,
    status,
    timings,
  };
}
