/** Step y'= 邪道模式的从左到右扫描器；几何层只选门和落点，最终量化公式模拟决定是否可达。 */
import {
  GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE,
  GRAPHWAR_PLANE_HEIGHT,
  GRAPHWAR_PLANE_LENGTH,
  GRAPHWAR_STEP_SIZE,
} from "../../core/game/constants";
import { graphToImagePoint, imageToGraphPoint, xPlusGoesRight } from "../../core/geometry";
import {
  MAX_FORMULA_DECIMAL_PLACES,
  clampDecimalPlaces,
  floorToDecimalPlaces,
  graphXAdvancesStrictly,
  roundToDecimalPlaces,
} from "../../core/numbers";
import { imagePointToPlaneGridPoint, planeGridCellCenterToImagePoint } from "../../core/plane-grid";
import { nowMs } from "../../core/time";
import { createGraphPoint, createPixelPoint } from "../../core/types";
import type { BoundsRect, GraphBounds, GraphPoint, PixelPoint } from "../../core/types";
import { resolveGraphwarTrajectory } from "../../formula/trajectory/sampling";
import type {
  GraphwarStepGlitchFormulaPrefix,
  GraphwarStepGlitchXWindow,
  GraphwarTrajectoryFormulaContext,
  GraphwarTrajectoryFormulaSettings,
  GraphwarTrajectoryTargetCircle,
} from "../../formula/trajectory/sampling";

const glitchWindows = createGlitchWindows();

/** 固定 simulation mask 的 x+ 水平可达索引，可在单目标和一键清图的多次扫描间复用。 */
export interface GraphwarStepGlitchScanMaskIndex {
  readonly boundaryExpansion: number;
  /** 每格沿 x+ 保持同一 y 时能到达的最远搜索列；-1 表示当前格不可用。 */
  readonly farthestFreeX: Int16Array;
  readonly mirrored: boolean;
  readonly simulationMask: Uint8Array;
}

/** Inputs that remain fixed while one scanner evaluates one or more targets. */
export interface GraphwarStepGlitchPrefixOptions {
  bounds: GraphBounds;
  boundsRect: BoundsRect;
  /** 可复用的同 mask 索引；不匹配时扫描器会自行重建。 */
  maskIndex?: GraphwarStepGlitchScanMaskIndex;
  /** 完全相同旧整式已经回放成功时，可直接复用其真实恢复点。 */
  prefixEvidence?: GraphwarStepGlitchPrefixEvidence;
  /** 已成功 sourcePath 的邪道求解结果；公式 Module 核对精确前缀后才会复用。 */
  stepGlitchFormulaPrefix?: GraphwarStepGlitchFormulaPrefix;
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

/** Per-target control point and physical hit circle evaluated by a prepared scanner. */
export interface GraphwarStepGlitchTargetOptions {
  /** 当前目标的实际命中圈。 */
  hitTarget: GraphwarTrajectoryTargetCircle;
  /** 当前目标使用的控制点；可与命中圈中心不同。 */
  targetPoint: PixelPoint;
}

/** Complete one-shot scan input when a reusable scanner is not needed. */
export type GraphwarStepGlitchScanOptions = GraphwarStepGlitchPrefixOptions & GraphwarStepGlitchTargetOptions;

/** Work and timing fields shared by hit and failure results. */
interface GraphwarStepGlitchScanResultBase {
  /** 实际执行过最终量化公式模拟的候选路径数。 */
  expandedStates: number;
  /** 本条完整公式命中的无序必达目标加当前有序目标数量。 */
  reachedTargetCount: number;
  /** 本次扫描内部阶段耗时；调用方负责映射到页面调试面板。 */
  timings: GraphwarStepGlitchScanTiming[];
}

/** Quantized replay result for one target scan. */
export type GraphwarStepGlitchScanResult =
  | (GraphwarStepGlitchScanResultBase & {
      acceptedPoint: GraphPoint;
      /** 本次命中回放已经使用的精确公式上下文；调用方可直接生成 incumbent。 */
      formulaContext?: GraphwarTrajectoryFormulaContext;
      stepGlitchFormulaPrefix?: GraphwarStepGlitchFormulaPrefix;
      path: PixelPoint[];
      status: "hit";
    })
  | (GraphwarStepGlitchScanResultBase & {
      blockedPoint?: GraphPoint;
      status: "invalid-input" | "no-path" | "unsupported";
    });

/** Reuses one prepared prefix result; callers may also provide a reusable compatible mask index. */
export interface GraphwarStepGlitchPrefixScanner {
  scan: (target: GraphwarStepGlitchTargetOptions) => GraphwarStepGlitchScanResult;
}

/** 完全相同旧整式的验证证据；新增后缀仍必须从发射点完整回放。 */
export interface GraphwarStepGlitchPrefixEvidence {
  acceptedPoint: GraphPoint;
  /** Master 精确 key 命中时可一并复用的公式求解前缀。 */
  stepGlitchFormulaPrefix?: GraphwarStepGlitchFormulaPrefix;
}

/** Stable scan stages consumed by worker and page timing aggregation. */
export type GraphwarStepGlitchScanTimingStage =
  | "prefix-evidence-hit"
  | "prefix-evidence-miss"
  | "prepare-prefix"
  | "scan-candidates"
  | "validate-direct";

/** Elapsed time for one stable scan stage. */
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

/** One reachable scan frontier before target/gate candidates are expanded. */
interface ScanState {
  acceptedPoint: GraphPoint;
  /** 直连整式的真实碰撞 x；存在时门位置不得再由前缀所在像素行推算。 */
  blockedX?: number;
  path: PixelPoint[];
  row: number;
  searchX: number;
  /** 与 path 段对齐的固定邪道窗口；原 sourcePath 段继续复用既有公式求解语义。 */
  stepGlitchXWindows: readonly (GraphwarStepGlitchXWindow | undefined)[];
}

/** One candidate path awaiting final quantized formula replay. */
interface ScanCandidate {
  controlX: number;
  kind: "gate" | "target";
  path: PixelPoint[];
  stepGlitchXWindows: readonly (GraphwarStepGlitchXWindow | undefined)[];
}

/** Reachable landing row and its target/start proximity ranking. */
interface ScanLandingRow {
  /** 从原碰撞列开始沿 x+ 连续可达的最远列。 */
  farthestX: number;
  row: number;
  /** 当前轨迹恢复行到候选行的垂直像素距离。 */
  startDeltaY: number;
  /** 目标命中圈中心行到候选行的垂直像素距离。 */
  targetDeltaY: number;
}

/** One quantized gate window derived from a collision frontier. */
interface ScanGateWindow {
  controlX: number;
  decimalPlaces: number;
  searchX: number;
  startX: number;
}

/** Deferred row expansion for one gate window batch. */
interface ScanGateRows {
  firstBlockedSearchX: number;
  rows: ScanLandingRow[];
  state: ScanState;
  windows: ScanGateWindow[];
}

/** Iterative DFS work item; the scanner never recurses through candidate states. */
type ScanWorkItem =
  | { candidate: ScanCandidate; type: "candidate" }
  | { rowIndex: number; scan: ScanGateRows; type: "gate-rows"; windowIndex: number }
  | { state: ScanState; type: "state" };

/** Physical replay evidence for one complete Step path. */
export interface GraphwarStepGlitchReplayResult {
  acceptedPoint?: GraphPoint;
  blockedPoint?: GraphPoint;
  reachedTargetCount: number;
  /** 本次回放已经构造的公式上下文；命中候选发布时应直接复用。 */
  formulaContext?: GraphwarTrajectoryFormulaContext;
  /** 本条精确路径的求解结果；只有路径验证成功后才能提升为下一条 sourcePath 前缀。 */
  stepGlitchFormulaPrefix?: GraphwarStepGlitchFormulaPrefix;
  /** 当前有序目标和全部无序必达目标是否都已命中。 */
  targetsHit: boolean;
}

/** Direct target replay performed before any gate candidates are generated. */
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
  const settings: GraphwarTrajectoryFormulaSettings =
    options.settings.stepGlitchObstacleMask === options.simulationMask
      ? options.settings
      : { ...options.settings, stepGlitchObstacleMask: options.simulationMask };
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
          ...(directReplay.formulaContext ? { formulaContext: directReplay.formulaContext } : {}),
          path: directPath,
          reachedTargetCount: directReplay.reachedTargetCount,
          ...(directReplay.stepGlitchFormulaPrefix
            ? { stepGlitchFormulaPrefix: directReplay.stepGlitchFormulaPrefix }
            : {}),
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
        ...(initialDirect.replay.blockedPoint ? { blockedX: initialDirect.replay.blockedPoint.x } : {}),
        path: [...options.sourcePath],
        row: initialGridPoint.y,
        searchX: initialGridPoint.x,
        stepGlitchXWindows: Array.from({ length: Math.max(0, options.sourcePath.length - 1) }, (_, index) => {
          const segment = options.stepGlitchFormulaPrefix?.stepGlitchSegments[index];
          return segment ? { endX: segment.endX, startX: segment.startX } : undefined;
        }),
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
      if (item.state.blockedX === undefined && farthestX >= targetGridPoint.x) {
        work.push({
          candidate: {
            controlX: targetGraphPoint.x,
            kind: "target",
            path: [...item.state.path, target.targetPoint],
            stepGlitchXWindows: [...item.state.stepGlitchXWindows, undefined],
          },
          type: "candidate",
        });
      } else {
        const scan = createGateRowScan(
          item.state,
          // 轨迹可能漂到相邻像素行；真实碰撞定位的像素列优先，mask 行边界只作兜底。
          item.state.blockedX === undefined
            ? farthestX + 1
            : graphXToSearchColumn(item.state.blockedX, item.state.acceptedPoint.y, options, maskIndex.mirrored),
          targetGraphPoint,
          hitTargetGridPoint.y,
          options,
          maskIndex,
        );
        if (scan) {
          work.push({ rowIndex: 0, scan, type: "gate-rows", windowIndex: 0 });
        }
      }
      continue;
    }

    if (item.type === "gate-rows") {
      let { rowIndex, windowIndex } = item;
      let candidate: ScanCandidate | undefined;
      while (rowIndex < item.scan.rows.length) {
        const row = item.scan.rows[rowIndex];
        const window = item.scan.windows[windowIndex];
        windowIndex += 1;
        if (windowIndex >= item.scan.windows.length) {
          rowIndex += 1;
          windowIndex = 0;
        }
        if (!row || !window) {
          continue;
        }

        // 行评分固定在原碰撞列；每档门仍用 O(1) 查表排除落在前一格障碍里的情况。
        const farthestX = getFarthestFreeX(maskIndex, Math.min(window.searchX, item.scan.firstBlockedSearchX), row.row);
        if (farthestX < Math.max(window.searchX, item.scan.firstBlockedSearchX)) {
          continue;
        }
        const controlPoint = createControlPointForFormulaEndX(
          window.controlX,
          targetGraphPoint.x,
          row.row,
          options,
          window.decimalPlaces,
        );
        if (!controlPoint) {
          continue;
        }

        candidate = {
          controlX: window.controlX,
          kind: "gate",
          path: [...item.scan.state.path, controlPoint],
          stepGlitchXWindows: [...item.scan.state.stepGlitchXWindows, { endX: window.controlX, startX: window.startX }],
        };
        break;
      }
      // 先压入续扫位置，再验证当前候选；成功分支会位于栈顶，失败后则从下一档窗口继续。
      if (rowIndex < item.scan.rows.length) {
        work.push({ rowIndex, scan: item.scan, type: "gate-rows", windowIndex });
      }
      if (candidate) {
        work.push({ candidate, type: "candidate" });
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
      item.candidate.stepGlitchXWindows,
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
        ...(replay.formulaContext ? { formulaContext: replay.formulaContext } : {}),
        path: item.candidate.path,
        reachedTargetCount: replay.reachedTargetCount,
        ...(replay.stepGlitchFormulaPrefix ? { stepGlitchFormulaPrefix: replay.stepGlitchFormulaPrefix } : {}),
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
        ...(replay.blockedPoint ? { blockedX: replay.blockedPoint.x } : {}),
        path: item.candidate.path,
        row: nextGridPoint.y,
        searchX: nextGridPoint.x,
        stepGlitchXWindows: item.candidate.stepGlitchXWindows,
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
  stepGlitchXWindows?: readonly (GraphwarStepGlitchXWindow | undefined)[],
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
  const { context: formulaContext, result } = resolveGraphwarTrajectory({
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    collision: {
      boundaryExpansion: context.simulationBoundaryExpansion,
      mask: options.simulationMask,
    },
    continueAfterTargetsUntilGraphX: controlX,
    points: graphPoints,
    requiredTargets,
    settings: context.formulaSettings,
    soldierCenter: graphPoints[0],
    ...(options.stepGlitchFormulaPrefix ? { stepGlitchFormulaPrefix: options.stepGlitchFormulaPrefix } : {}),
    ...(stepGlitchXWindows ? { stepGlitchXWindows } : {}),
    stopOnTargetsComplete: false,
    targetSequence,
  });
  if (formulaContext.formulaPoints.length < 2) {
    return { reachedTargetCount: 0, targetsHit: false };
  }

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
    formulaContext,
    reachedTargetCount: result.reachedTargetCount + result.reachedRequiredTargetCount,
    stepGlitchFormulaPrefix: formulaContext.stepGlitchFormulaPrefix,
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

/** 从首次阻挡像素的前一格放置左门，并准备最多 450 个稳定排序的落点行。 */
function createGateRowScan(
  state: ScanState,
  firstBlockedSearchX: number,
  target: GraphPoint,
  targetRow: number,
  options: GraphwarStepGlitchPrefixOptions,
  maskIndex: GraphwarStepGlitchScanMaskIndex,
) {
  if (firstBlockedSearchX <= 0 || firstBlockedSearchX >= GRAPHWAR_PLANE_LENGTH) {
    return undefined;
  }

  const rawLeftGateX = searchBoundaryToGraphX(firstBlockedSearchX - 1, options, maskIndex.mirrored);
  const obstacleLeftX = searchBoundaryToGraphX(firstBlockedSearchX, options, maskIndex.mirrored);
  let leftGateX = rawLeftGateX;
  let leftGateDecimalPlaces = MAX_FORMULA_DECIMAL_PLACES;
  // 从用户精度开始直接验证门是否仍在障碍格左侧。不用 log10 估算：double 减法可能把
  // 0.01 变成 0.009999...，在十进制幂边界多估一位；这个有界循环通常首轮即通过。
  for (
    let decimalPlaces = clampDecimalPlaces(options.settings.decimalPlaces);
    decimalPlaces <= MAX_FORMULA_DECIMAL_PLACES;
    decimalPlaces += 1
  ) {
    const quantizedLeftGateX = -floorToDecimalPlaces(-rawLeftGateX, decimalPlaces);
    if (quantizedLeftGateX < obstacleLeftX) {
      leftGateX = quantizedLeftGateX;
      leftGateDecimalPlaces = decimalPlaces;
      break;
    }
  }

  const windows: ScanGateWindow[] = [];
  for (const window of glitchWindows) {
    const gateDecimalPlaces = Math.max(leftGateDecimalPlaces, window.decimalPlaces);
    // L 与 width 已按 gateDecimalPlaces 表示；就近量化只清理 binary 加法残差，不移动窗口方向。
    const controlX = roundToDecimalPlaces(leftGateX + window.width, gateDecimalPlaces);
    if (
      !graphXAdvancesStrictly(state.acceptedPoint.x, leftGateX) ||
      !graphXAdvancesStrictly(leftGateX, controlX) ||
      !graphXAdvancesStrictly(controlX, target.x)
    ) {
      continue;
    }
    // 十进制量化可能让相邻窄窗落到同一个右门；只保留先出现的较宽档。
    if (windows.at(-1)?.controlX === controlX) {
      continue;
    }
    windows.push({
      controlX,
      decimalPlaces: gateDecimalPlaces,
      searchX: graphXToSearchColumn(controlX, state.acceptedPoint.y, options, maskIndex.mirrored),
      startX: leftGateX,
    });
  }
  if (windows.length === 0) {
    return undefined;
  }

  const rows: ScanLandingRow[] = [];
  // 使用固定碰撞列让每个 y 只有一个评分；具体窗口能否落稳由懒生成时的查表和最终回放决定。
  for (let row = 0; row < GRAPHWAR_PLANE_HEIGHT; row += 1) {
    const farthestX = getFarthestFreeX(maskIndex, firstBlockedSearchX, row);
    if (farthestX >= firstBlockedSearchX) {
      rows.push({
        farthestX,
        row,
        startDeltaY: Math.abs(row - state.row),
        targetDeltaY: Math.abs(row - targetRow),
      });
    }
  }
  // 先争取最大横向收益；收益相同时减少到目标、再到当前轨迹的垂直偏移，行号仅保证结果稳定。
  rows.sort(
    (left, right) =>
      right.farthestX - left.farthestX ||
      left.targetDeltaY - right.targetDeltaY ||
      left.startDeltaY - right.startDeltaY ||
      left.row - right.row,
  );
  return rows.length > 0 ? { firstBlockedSearchX, rows, state, windows } : undefined;
}

/** 查询指定行从 searchX 开始连续可通行区的最右列。 */
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

/** 选择右门十进制桶内部的像素控制点，并验证一次坐标往返。 */
function createControlPointForFormulaEndX(
  formulaEndX: number,
  nextControlX: number,
  row: number,
  options: Pick<GraphwarStepGlitchPrefixOptions, "bounds" | "boundsRect">,
  decimalPlaces: number,
) {
  const rowCenter = planeGridCellCenterToImagePoint({ x: 0, y: row }, options.boundsRect);
  const graphY = imageToGraphPoint(rowCenter, options.bounds, options.boundsRect).y;
  // 取十进制桶中点，避免边界往返误差；下一控制点贴得更近时仍保留一半严格 x+ 间距。
  const controlPointX = Math.min(
    formulaEndX + 0.5 * 10 ** -clampDecimalPlaces(decimalPlaces),
    formulaEndX + (nextControlX - formulaEndX) / 2,
  );
  const point = graphToImagePoint(createGraphPoint(controlPointX, graphY), options.bounds, options.boundsRect);
  const roundTripX = imageToGraphPoint(point, options.bounds, options.boundsRect).x;
  return floorToDecimalPlaces(roundTripX, decimalPlaces) === formulaEndX && roundTripX < nextControlX
    ? point
    : undefined;
}

function mirrorPlaneX(x: number, mirrored: boolean) {
  return mirrored ? GRAPHWAR_PLANE_LENGTH - 1 - x : x;
}

/** 枚举从 0.01 逐档缩半的窗口，并携带能无损表示每档宽度的小数位。 */
function createGlitchWindows() {
  const windows: { decimalPlaces: number; width: number }[] = [];
  let minimumWidth = GRAPHWAR_STEP_SIZE;
  while (minimumWidth > GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE) {
    minimumWidth /= 2;
  }
  let decimalPlaces = Math.max(0, Math.ceil(-Math.log10(GRAPHWAR_STEP_SIZE)));
  let width = GRAPHWAR_STEP_SIZE;
  while (width >= minimumWidth) {
    windows.push({ decimalPlaces, width });
    width /= 2;
    decimalPlaces += 1;
  }
  return windows;
}

/** Returns the first pre-collision sample at or beyond the requested control x. */
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
