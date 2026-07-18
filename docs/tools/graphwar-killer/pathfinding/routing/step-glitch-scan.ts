/** Step ODE 邪道模式的从左到右扫描器；几何层只选门和落点，最终量化公式模拟决定是否可达。 */
import {
  GRAPHWAR_FUNC_LAST_BISECTED_X_STEP_DISTANCE,
  GRAPHWAR_PLANE_HEIGHT,
  GRAPHWAR_PLANE_LENGTH,
  GRAPHWAR_STEP_SIZE,
} from "../../core/game/constants";
import { graphToImagePoint, imageToGraphPoint, pixelCirclesEqual, xPlusGoesRight } from "../../core/geometry";
import {
  MAX_FORMULA_DECIMAL_PLACES,
  clampDecimalPlaces,
  floorToDecimalPlaces,
  graphXAdvancesStrictly,
  roundToDecimalPlaces,
} from "../../core/numbers";
import {
  forwardColumnToPlaneColumn,
  imagePointToPlaneGridPoint,
  planeColumnToForwardColumn,
  planeGridCellCenterToImagePoint,
} from "../../core/plane-grid";
import { measureSyncStage, nowMs } from "../../core/time";
import { createGraphPoint, createPixelPoint } from "../../core/types";
import type { BoundsRect, GraphBounds, GraphPoint, PixelPoint } from "../../core/types";
import { formulaModeUsesStepGlitch } from "../../formula/generation/capabilities";
import { tryResolveGraphwarTrajectoryCandidate } from "../../formula/trajectory/sampling";
import type {
  GraphwarStepGlitchFormulaPrefix,
  GraphwarStepGlitchXWindow,
  GraphwarTrajectoryFormulaContext,
  GraphwarTrajectoryFormulaSettings,
  GraphwarTrajectoryTargetCircle,
} from "../../formula/trajectory/sampling";

const glitchWindows = createGlitchWindows();
/** 统一搜索网格中固定的近到远回退距离。 */
const GATE_BACKOFF_COLUMNS = [1, 2] as const;

/** 固定 simulation mask 的 x+ 水平可达索引，可在单目标和一键清图的多次扫描间复用。 */
export interface GraphwarStepGlitchScanMaskIndex {
  readonly boundaryExpansion: number;
  /** 每格沿 x+ 保持同一 y 时能到达的最远搜索列；-1 表示当前格不可用。 */
  readonly farthestFreeX: Int16Array;
  readonly mirrored: boolean;
  readonly simulationMask: Uint8Array;
}

/** 单个扫描器评估一个或多个目标时保持不变的输入。 */
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

/** 已准备好的扫描器用于评估单个目标的控制点和实际命中圈。 */
export interface GraphwarStepGlitchTargetOptions {
  /** 当前目标的实际命中圈。 */
  hitTarget: GraphwarTrajectoryTargetCircle;
  /** 当前目标使用的控制点；可与命中圈中心不同。 */
  targetPoint: PixelPoint;
}

/** 不需要复用扫描器时使用的完整单次扫描输入。 */
export type GraphwarStepGlitchScanOptions = GraphwarStepGlitchPrefixOptions & GraphwarStepGlitchTargetOptions;

/** 命中结果和失败结果共用的工作统计与耗时字段。 */
interface GraphwarStepGlitchScanResultBase {
  /** 实际执行过最终量化公式模拟的候选路径数。 */
  expandedStates: number;
  /** 本条完整公式命中的无序必达目标加当前有序目标数量。 */
  reachedTargetCount: number;
  /** 本次扫描内部阶段耗时；调用方负责映射到页面调试面板。 */
  timings: GraphwarStepGlitchScanTiming[];
}

/** 单个目标扫描的量化回放结果。 */
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

/** 复用一份已准备好的 prefix 结果；调用方也可以提供兼容且可复用的 mask 索引。 */
export interface GraphwarStepGlitchPrefixScanner {
  scan: (target: GraphwarStepGlitchTargetOptions) => GraphwarStepGlitchScanResult;
}

/** 完全相同旧整式的验证证据；新增后缀仍必须从发射点完整回放。 */
export interface GraphwarStepGlitchPrefixEvidence {
  acceptedPoint: GraphPoint;
  /** Master 精确 key 命中时可一并复用的公式求解前缀。 */
  stepGlitchFormulaPrefix?: GraphwarStepGlitchFormulaPrefix;
}

/** Worker 和页面耗时汇总使用的稳定扫描阶段。 */
export type GraphwarStepGlitchScanTimingStage =
  | "prefix-evidence-hit"
  | "prefix-evidence-miss"
  | "prepare-prefix"
  | "scan-candidates"
  | "validate-direct";

/** 单个稳定扫描阶段的耗时。 */
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

/** 在展开目标或 gate 候选前的一个可达扫描前沿。 */
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

/** 等待最终量化公式回放的候选路径。 */
interface ScanCandidate {
  controlX: number;
  kind: "gate" | "target";
  path: PixelPoint[];
  stepGlitchXWindows: readonly (GraphwarStepGlitchXWindow | undefined)[];
}

/** 可达的落点行及其与目标行、起始行的接近程度排序信息。 */
interface ScanLandingRow {
  /** 从原碰撞列开始沿 x+ 连续可达的最远列。 */
  farthestX: number;
  row: number;
  /** 当前轨迹恢复行到候选行的垂直像素距离。 */
  startDeltaY: number;
  /** 目标命中圈中心行到候选行的垂直像素距离。 */
  targetDeltaY: number;
  /** 按回退顺序记录的两位可用性掩码：第 0 位表示 B-1，第 1 位表示 B-2。 */
  usableWindowBatchMask: number;
}

/** 根据碰撞前沿生成的一个量化 gate 窗口。 */
interface ScanGateWindow {
  controlX: number;
  decimalPlaces: number;
  /** 仅供非标准缩放下右门跨列时复用落点行的原碰撞列查询结果。 */
  searchX: number;
  startX: number;
}

/** 按一个回退距离分组的 11 档 gate 宽度；标准 bounds 下整组可以共享一次可达性查询。 */
interface ScanGateWindowBatch {
  /** 共享的右门列；为 undefined 时，非标准 bounds 使用旧的逐窗口 fallback。 */
  sharedWindowSearchX: number | undefined;
  /** 只有标准回退列才能使用“跳过下一批”的单调性规则。 */
  usesMonotonicBackoffPruning: boolean;
  /** 所有宽度共享右门列时实际查询的原生列；否则仅作为 fallback 提示。 */
  searchX: number;
  windows: ScanGateWindow[];
}

/** 延迟展开已排序落点行和 gate 窗口批次所需的数据。 */
interface ScanGateRows {
  firstBlockedSearchX: number;
  rows: ScanLandingRow[];
  state: ScanState;
  windowBatches: ScanGateWindowBatch[];
}

/** 迭代 DFS 工作项；扫描器不会通过候选状态递归调用自身。 */
type ScanWorkItem =
  | { candidate: ScanCandidate; type: "candidate" }
  | {
      rowIndex: number;
      scan: ScanGateRows;
      type: "gate-rows";
      windowBatchIndex: number;
      windowIndex: number;
    }
  | { state: ScanState; type: "state" };

/** 一条完整 Step 路径的实际回放证据。 */
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

/** 生成任何 gate 候选前先执行的目标直连回放。 */
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
      const planeX = forwardColumnToPlaneColumn(searchX, mirrored);
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
  if (
    !formulaModeUsesStepGlitch(options.settings.algorithm, options.settings.equation, options.settings.stepGlitchMode)
  ) {
    return createFailedResult("unsupported", 0, 0, undefined, timings);
  }
  if (
    options.sourcePath.length === 0 ||
    options.simulationMask.length !== GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT
  ) {
    return createFailedResult("invalid-input", 0, 0, undefined, timings);
  }

  return {
    formulaSettings:
      options.settings.stepGlitchObstacleMask === options.simulationMask
        ? options.settings
        : { ...options.settings, stepGlitchObstacleMask: options.simulationMask },
    graphPoints: options.sourcePath.map((point) => imageToGraphPoint(point, options.bounds, options.boundsRect)),
    simulationBoundaryExpansion: Math.max(0, Math.floor(options.simulationBoundaryExpansion ?? 0)),
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

  const replay = measureSyncStage(timings, "prepare-prefix", () =>
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
      const directReplay = measureSyncStage(timings, "validate-direct", () =>
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
      return measureSyncStage(timings, "scan-candidates", () =>
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

/** 扫描已准备的前缀状态，按稳定顺序验证候选门和落点。 */
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
          work.push({ rowIndex: 0, scan, type: "gate-rows", windowBatchIndex: 0, windowIndex: 0 });
        }
      }
      continue;
    }

    if (item.type === "gate-rows") {
      let { rowIndex, windowBatchIndex, windowIndex } = item;
      let candidate: ScanCandidate | undefined;
      while (rowIndex < item.scan.rows.length) {
        const row = item.scan.rows[rowIndex];
        if (!row) {
          break;
        }
        const windowBatch = item.scan.windowBatches[windowBatchIndex];
        if (!windowBatch || windowBatchIndex >= item.scan.windowBatches.length) {
          rowIndex += 1;
          windowBatchIndex = 0;
          windowIndex = 0;
          continue;
        }
        if ((row.usableWindowBatchMask & (1 << windowBatchIndex)) === 0) {
          windowBatchIndex += 1;
          windowIndex = 0;
          continue;
        }
        const window = windowBatch.windows[windowIndex];
        windowIndex += 1;
        if (windowIndex >= windowBatch.windows.length) {
          windowBatchIndex += 1;
          windowIndex = 0;
        }
        if (windowBatchIndex >= item.scan.windowBatches.length) {
          rowIndex += 1;
          windowBatchIndex = 0;
        }
        if (!window) {
          continue;
        }
        if (windowBatch.sharedWindowSearchX === undefined) {
          // 非标准 bounds 可能让不同宽度落在不同列；这里保留旧的精确检查，不能把一列的结果当成另一列的缓存。
          // 标准 Graphwar bounds 不会进入这个分支。
          const farthestX = getFarthestFreeX(
            maskIndex,
            Math.min(window.searchX, item.scan.firstBlockedSearchX),
            row.row,
          );
          if (farthestX < Math.max(window.searchX, item.scan.firstBlockedSearchX)) {
            continue;
          }
        } else if (row.farthestX < window.searchX) {
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
        work.push({ rowIndex, scan: item.scan, type: "gate-rows", windowBatchIndex, windowIndex });
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
  const resolved = tryResolveGraphwarTrajectoryCandidate({
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
  if (!resolved) {
    return { reachedTargetCount: 0, targetsHit: false };
  }
  const { context: formulaContext, result } = resolved;
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
  return requiredTargets.some((required) => pixelCirclesEqual(required, target)) ? [] : [target];
}

/** 判断两条像素路径是否逐点完全一致。 */
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

/** 复用输入一致的扫描索引，否则按本次边界设置重建。 */
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

/** 从首次阻挡像素沿 x- 回退一列和两列放置左门，并准备稳定排序的落点行。 */
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

  const obstacleLeftX = searchBoundaryToGraphX(firstBlockedSearchX, options, maskIndex.mirrored);
  const windowBatches: ScanGateWindowBatch[] = [];
  for (const backoffColumns of GATE_BACKOFF_COLUMNS) {
    const searchX = firstBlockedSearchX - backoffColumns;
    if (searchX < 0) {
      continue;
    }

    const rawLeftGateX = searchBoundaryToGraphX(searchX, options, maskIndex.mirrored);
    let leftGateX: number | undefined;
    let leftGateDecimalPlaces: number | undefined;
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
    // raw double 不是可提交的公式门；15 位仍无法留在障碍格外时只淘汰当前回退距离。
    if (leftGateX === undefined || leftGateDecimalPlaces === undefined) {
      continue;
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
    if (windows.length > 0) {
      const firstWindow = windows[0];
      const sharedWindowSearchX =
        firstWindow && windows.every((window) => window.searchX === firstWindow.searchX)
          ? firstWindow.searchX
          : undefined;
      windowBatches.push({
        searchX: sharedWindowSearchX === undefined ? searchX : Math.min(sharedWindowSearchX, firstBlockedSearchX),
        sharedWindowSearchX,
        usesMonotonicBackoffPruning: sharedWindowSearchX === searchX,
        windows,
      });
    }
  }
  if (windowBatches.length === 0) {
    return undefined;
  }

  const rows: ScanLandingRow[] = [];
  // 原碰撞列只查询一次用于评分；每个回退批次再查询一次，供其中全部门宽复用。
  for (let row = 0; row < GRAPHWAR_PLANE_HEIGHT; row += 1) {
    const farthestX = getFarthestFreeX(maskIndex, firstBlockedSearchX, row);
    if (farthestX < firstBlockedSearchX) {
      continue;
    }
    let usableWindowBatchMask = 0;
    for (let windowBatchIndex = 0; windowBatchIndex < windowBatches.length; windowBatchIndex += 1) {
      const windowBatch = windowBatches[windowBatchIndex];
      if (!windowBatch) {
        break;
      }
      if (windowBatch.sharedWindowSearchX === undefined) {
        // fallback 会在下面逐档检查宽度，因此不能使用标准的行级单调性剪枝。
        usableWindowBatchMask |= 1 << windowBatchIndex;
        continue;
      }
      if (getFarthestFreeX(maskIndex, windowBatch.searchX, row) < firstBlockedSearchX) {
        // 更早的回退列也必须穿过当前列；当前批次失败后无需继续查询。
        const nextWindowBatch = windowBatches[windowBatchIndex + 1];
        if (!nextWindowBatch || nextWindowBatch.usesMonotonicBackoffPruning) {
          break;
        }
        continue;
      }
      usableWindowBatchMask |= 1 << windowBatchIndex;
    }
    if (usableWindowBatchMask !== 0) {
      rows.push({
        farthestX,
        row,
        startDeltaY: Math.abs(row - state.row),
        targetDeltaY: Math.abs(row - targetRow),
        usableWindowBatchMask,
      });
    }
  }
  // 先争取最大横向收益，再贴近目标和当前行；两种 ODE 共用位置目标，不按残余斜率改变候选顺序。
  rows.sort(
    (left, right) =>
      right.farthestX - left.farthestX ||
      left.targetDeltaY - right.targetDeltaY ||
      left.startDeltaY - right.startDeltaY ||
      left.row - right.row,
  );
  return rows.length > 0 ? { firstBlockedSearchX, rows, state, windowBatches } : undefined;
}

/** 查询指定行从 searchX 开始连续可通行区的最右列。 */
function getFarthestFreeX(index: GraphwarStepGlitchScanMaskIndex, searchX: number, row: number) {
  if (searchX < 0 || searchX >= GRAPHWAR_PLANE_LENGTH || row < 0 || row >= GRAPHWAR_PLANE_HEIGHT) {
    return -1;
  }
  return index.farthestFreeX[row * GRAPHWAR_PLANE_LENGTH + searchX];
}

/** 把截图像素点映射到统一向右推进的搜索网格。 */
function pixelPointToSearchGrid(point: PixelPoint, boundsRect: BoundsRect, mirrored: boolean) {
  const plane = imagePointToPlaneGridPoint(point, boundsRect);
  return { x: planeColumnToForwardColumn(plane.x, mirrored), y: plane.y };
}

/** 把 Graphwar 坐标点映射到统一向右推进的搜索网格。 */
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

/** 把 Graphwar x 映射到搜索网格列。 */
function graphXToSearchColumn(
  graphX: number,
  graphY: number,
  options: Pick<GraphwarStepGlitchPrefixOptions, "bounds" | "boundsRect">,
  mirrored: boolean,
) {
  return graphPointToSearchGrid(createGraphPoint(graphX, graphY), options, mirrored).x;
}

/** 把搜索网格边界还原成 Graphwar x。 */
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

/** 枚举从 0.01 逐档缩半的窗口，并携带能无损表示每档宽度的小数位。 */
function createGlitchWindows() {
  const windows: { decimalPlaces: number; width: number }[] = [];
  let decimalPlaces = Math.max(0, Math.ceil(-Math.log10(GRAPHWAR_STEP_SIZE)));
  let width = GRAPHWAR_STEP_SIZE;
  while (width >= GRAPHWAR_FUNC_LAST_BISECTED_X_STEP_DISTANCE) {
    windows.push({ decimalPlaces, width });
    width /= 2;
    decimalPlaces += 1;
  }
  return windows;
}

/** 返回碰撞前第一个不小于指定控制 x 的采样点。 */
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

/** 统一构造带扫描统计的失败结果。 */
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
