import type { BoundsRect, GraphBounds, PixelPoint } from "../../../core/types";
import type {
  GraphwarTrajectoryFormulaSettings,
  GraphwarTrajectoryTargetCircle,
} from "../../../formula/trajectory/sampling";
import {
  createGraphwarOneClickClearSearchInput,
  createGraphwarOneClickClearSearchPreflight,
  type GraphwarOneClickClearSearchPreflightFailureReason,
  type GraphwarOneClickClearSearchTolerances,
} from "../../../pathfinding/one-click-clear/input";
import type {
  GraphwarOneClickClearDebugTiming,
  GraphwarOneClickClearFailureReason,
  GraphwarOneClickClearIncumbent,
} from "../../../pathfinding/one-click-clear/search";
import {
  createGraphwarOneClickClearCandidates,
  createGraphwarOneClickClearHitCandidates,
  type GraphwarOneClickClearTargetSoldier,
} from "../../../pathfinding/one-click-clear/targets";
import type { GraphwarPathfindingRouteMode } from "../../../pathfinding/routing/mode";
import type { GraphwarPathfindingResultCacheTimingEntry } from "../../../pathfinding/runtime/cache";
import type {
  GraphwarOneClickClearPathWorkerInput,
  GraphwarOneClickClearPathWorkerResult,
} from "../../../pathfinding/runtime/protocol";
import { isGraphwarPathfindingCancelledError } from "../../../pathfinding/runtime/runner";
import type { GraphwarTargetingGeometry } from "../../../pathfinding/targeting";
import type { SmartPathfindingDebugStage, SmartPathfindingDebugTimingEntry } from "../../debug/timings";

type GraphwarOneClickClearStatusKind = "error" | "success" | "warning";
type GraphwarOneClickClearPrefixTarget = PixelPoint | GraphwarTrajectoryTargetCircle;

/** Page-side cache operations required by one-click-clear runs. */
interface GraphwarOneClickClearRunCache {
  cacheOneClickClearResult: (cacheKey: string, result: GraphwarOneClickClearPathWorkerResult) => void;
  createOneClickClearResultCacheKey: (input: GraphwarOneClickClearPathWorkerInput) => string;
  getCachedOneClickClearResult: (
    cacheKey: string,
    onTiming?: (timing: GraphwarPathfindingResultCacheTimingEntry) => void,
  ) => GraphwarOneClickClearPathWorkerResult | undefined;
  getMaskCacheId: (mask: Uint8Array) => number;
}

/** Worker runner operation required by one-click-clear runs. */
interface GraphwarOneClickClearRunRunner {
  buildOneClickClearPath: (
    input: GraphwarOneClickClearPathWorkerInput,
    options?: { onIncumbent?: (incumbent: GraphwarOneClickClearIncumbent) => void },
  ) => Promise<GraphwarOneClickClearPathWorkerResult>;
}

/** Per-run behavior used by interactive and managed-play callers. */
export interface GraphwarOneClickClearRunOptions {
  /** 接收主搜索自然产生的已验证方案；只用于展示或托管发射，不触发额外验证。 */
  onIncumbent?: (incumbent: GraphwarOneClickClearIncumbent) => void;
  /** 最终方案未命中全部入口候选时调用；候选和命中均按稳定 id 去重，搜索失败和取消不触发。 */
  onClearFailure?: () => void;
  /** 最终成功后、写回最终路径与完成状态前同步调用；托管用它提交不依赖页面渲染的已验证方案。 */
  onSuccessBeforeEffects?: () => void;
  /** 托管按实时局面搜索时关闭跨运行结果缓存。 */
  useResultCache?: boolean;
}

/** Page state and effects injected into the one-click-clear orchestration module. */
interface GraphwarOneClickClearRunWorkflowOptions<TSoldier extends GraphwarOneClickClearTargetSoldier> {
  /** 调试耗时顺序应和旧页面流程一致，避免面板展示发生语义偏移。 */
  debug: {
    appendSearchWorkerTimings: (
      timings: SmartPathfindingDebugTimingEntry[],
      workerTimings: readonly GraphwarOneClickClearDebugTiming[],
    ) => void;
    clearTimings: () => void;
    finishTimings: (
      startedAt: number,
      timings: readonly SmartPathfindingDebugTimingEntry[],
      completedAt?: number,
    ) => void;
    measureStage: <TResult>(
      timings: SmartPathfindingDebugTimingEntry[],
      stage: SmartPathfindingDebugStage,
      task: () => TResult,
    ) => TResult;
    measureStageAsync: <TResult>(
      timings: SmartPathfindingDebugTimingEntry[],
      stage: SmartPathfindingDebugStage,
      task: () => Promise<TResult>,
    ) => Promise<TResult>;
  };
  /** 页面副作用应集中注入，workflow 只决定触发时机。 */
  effects: {
    applyIncumbent: (incumbent: GraphwarOneClickClearIncumbent) => void;
    flashBlockedSegment: (start: PixelPoint | undefined, end: PixelPoint | undefined) => void;
    flashHitSoldiers: (targetIds: readonly string[]) => void;
    setStatus: (message: string, kind: GraphwarOneClickClearStatusKind) => void;
  };
  /** 构造一键清图 worker 输入时应读取调用时的最新页面状态。 */
  input: {
    boundsRect: { readonly value: BoundsRect };
    getBounds: () => GraphBounds | undefined;
    getDeleteOptimizationEnabled: () => boolean;
    getFormulaSettings: () => GraphwarTrajectoryFormulaSettings;
    getObstacleMask: () => Uint8Array | undefined;
    getPathfindingWorkerCount: () => number | undefined;
    getPathPoints: () => readonly PixelPoint[];
    getRouteMode: () => GraphwarPathfindingRouteMode;
    requiresDagWorker: () => boolean;
    getSimulationMask: () => Uint8Array | undefined;
    getTolerances: () => GraphwarOneClickClearSearchTolerances | undefined;
    isUnsupportedMode: () => boolean;
  };
  /** 本地化和状态文案仍由页面持有。 */
  messages: {
    getFailureMessage: (reason: GraphwarOneClickClearFailureReason, elapsedMs: number) => string;
    getInProgressMessage: () => string;
    getPreflightFailureStatus: (reason: GraphwarOneClickClearSearchPreflightFailureReason) => {
      kind: "error" | "warning";
      message: string;
    };
    getSuccessMessage: (targetCount: number, elapsedMs: number, resultCacheHit: boolean) => string;
    getRetainedMessage: () => string;
  };
  /** 一键清图的 worker 与页面侧完整结果缓存。 */
  pathfinding: {
    cache: GraphwarOneClickClearRunCache;
    runner: GraphwarOneClickClearRunRunner;
  };
  /** 智能寻路 session token 仍统一管理一键清图和单目标寻路。 */
  run: {
    finish: (token: number) => boolean;
    isCurrent: (token: number) => boolean;
    start: (message?: string) => number;
  };
  /** 目标收集应复用 pathfinding 目录的候选规则，页面只提供当前状态。 */
  targets: {
    createGeometry: () => GraphwarTargetingGeometry | undefined;
    getFriendlyFireEnabled: () => boolean;
    getPrefixTarget: () => GraphwarOneClickClearPrefixTarget | undefined;
    getSoldiers: () => readonly TSoldier[];
    isFriendlySoldier: (soldier: TSoldier) => boolean | undefined;
  };
  /** 时间来源应复用页面规则，保证调试耗时和状态耗时一致。 */
  time: {
    now: () => number;
  };
}

/** Lifecycle interface exposed to interactive and managed one-click-clear callers. */
export interface GraphwarOneClickClearRunWorkflowController {
  /** 内部设置或局面失效时丢弃取消检查点，禁止旧结果随后落地。 */
  discardActiveIncumbent: () => void;
  /** 用户主动停止时提交最近的已验证检查点；调用方随后仍须硬取消 Worker。 */
  finalizeActiveIncumbent: () => boolean;
  /** 运行一次一键清图，并负责 token、调试耗时、状态和结果落地。 */
  run: (runOptions?: GraphwarOneClickClearRunOptions) => Promise<boolean>;
}

/** 管理一键清图运行流程，集中预检、目标收集、worker 输入、cache 和结果落地。 */
export function useGraphwarOneClickClearRunWorkflow<TSoldier extends GraphwarOneClickClearTargetSoldier>(
  options: GraphwarOneClickClearRunWorkflowOptions<TSoldier>,
): GraphwarOneClickClearRunWorkflowController {
  let activeRun: { incumbent?: GraphwarOneClickClearIncumbent; token: number } | undefined;

  /** 从当前路径尾部出发，追加当前模型下击杀最多的路径。 */
  async function run(runOptions: GraphwarOneClickClearRunOptions = {}) {
    options.debug.clearTimings();
    const startedAt = options.time.now();
    const timings: SmartPathfindingDebugTimingEntry[] = [];
    const preflightResult = createMeasuredPreflight(timings);
    if (!preflightResult.ok) {
      finishPreflightFailure(startedAt, timings, preflightResult.message, preflightResult.kind);
      return false;
    }

    const pathfindingToken = options.run.start(options.messages.getInProgressMessage());
    activeRun = { token: pathfindingToken };
    let debugTimingsFinished = false;
    const finishOneClickClearDebugTimings = (completedAt = options.time.now()) => {
      debugTimingsFinished = true;
      if (!options.run.isCurrent(pathfindingToken)) {
        return;
      }
      options.debug.finishTimings(startedAt, timings, completedAt);
    };

    try {
      const searchResult = await buildSearchResult(preflightResult, timings, runOptions, pathfindingToken);
      options.debug.appendSearchWorkerTimings(timings, searchResult.search.timings);
      if (!options.run.isCurrent(pathfindingToken)) {
        return false;
      }

      const result = searchResult.search.result;
      if (result.type === "success") {
        // targetIds 还可能包含此前或顺路命中的非入口候选，只比较两个唯一 id 集合的交集。
        if (
          searchResult.candidateIds.size >
          new Set(result.targetIds.filter((targetId) => searchResult.candidateIds.has(targetId))).size
        ) {
          runOptions.onClearFailure?.();
        }
        runOptions.onSuccessBeforeEffects?.();
        options.run.finish(pathfindingToken);
        applySuccessResult(startedAt, timings, result, searchResult.cacheHit, finishOneClickClearDebugTimings);
        return true;
      }

      if (finishWithActiveIncumbent(pathfindingToken, runOptions, timings, finishOneClickClearDebugTimings)) {
        return true;
      }

      options.run.finish(pathfindingToken);
      if (result.invalidSegmentIndex !== undefined) {
        const pathPoints = options.input.getPathPoints();
        options.effects.flashBlockedSegment(
          pathPoints[result.invalidSegmentIndex],
          pathPoints[result.invalidSegmentIndex + 1],
        );
      }
      finishFailureResult(
        timings,
        result.reason,
        (completedAt) => (searchResult.cacheHit ? completedAt - startedAt : result.elapsedMs),
        finishOneClickClearDebugTimings,
      );
      return false;
    } catch (error) {
      if (!options.run.isCurrent(pathfindingToken) || isGraphwarPathfindingCancelledError(error)) {
        return false;
      }
      if (finishWithActiveIncumbent(pathfindingToken, runOptions, timings, finishOneClickClearDebugTimings)) {
        return true;
      }
      finishFailureResult(
        timings,
        "pathfinding-worker-failed",
        (completedAt) => completedAt - startedAt,
        finishOneClickClearDebugTimings,
      );
      return false;
    } finally {
      if (activeRun?.token === pathfindingToken) {
        activeRun = undefined;
      }
      if (options.run.isCurrent(pathfindingToken)) {
        options.run.finish(pathfindingToken);
        if (!debugTimingsFinished) {
          finishOneClickClearDebugTimings();
        }
      }
    }
  }

  /** 执行一键清图预检并记录页面侧耗时。 */
  function createMeasuredPreflight(timings: SmartPathfindingDebugTimingEntry[]) {
    return options.debug.measureStage(timings, "one-click-clear-preflight", () => {
      const bounds = options.input.getBounds();
      const tolerances = options.input.getTolerances();
      const result = createGraphwarOneClickClearSearchPreflight({
        bounds,
        createPrefixTarget,
        getObstacleMask: options.input.getObstacleMask,
        pathfindingWorkerCount: options.input.getPathfindingWorkerCount(),
        pathPointCount: options.input.getPathPoints().length,
        requiresDagWorker: options.input.requiresDagWorker(),
        tolerances,
        unsupportedMode: options.input.isUnsupportedMode,
      });
      return result.ok ? result : { ...result, ...options.messages.getPreflightFailureStatus(result.reason) };
    });
  }

  /** 从当前已命中目标生成必须保留的前缀命中圈。 */
  function createPrefixTarget() {
    const target = options.targets.getPrefixTarget();
    if (!target) {
      return undefined;
    }
    return "center" in target ? { center: target.center, radius: target.radius } : { center: target, radius: 1 };
  }

  /** 写入预检失败状态并结算调试耗时。 */
  function finishPreflightFailure(
    startedAt: number,
    timings: SmartPathfindingDebugTimingEntry[],
    message: string,
    kind: "error" | "warning",
  ) {
    let completedAt = options.time.now();
    options.debug.measureStage(timings, "one-click-clear-setting-status", () => {
      completedAt = options.time.now();
      options.effects.setStatus(message, kind);
      completedAt = options.time.now();
    });
    options.debug.finishTimings(startedAt, timings, completedAt);
  }

  /** 优先读取结果缓存，否则调度 Worker 并缓存稳定结果。 */
  async function buildSearchResult(
    preflightResult: Extract<ReturnType<typeof createGraphwarOneClickClearSearchPreflight>, { ok: true }>,
    timings: SmartPathfindingDebugTimingEntry[],
    runOptions: GraphwarOneClickClearRunOptions,
    pathfindingToken: number,
  ) {
    const candidates = options.debug.measureStage(timings, "one-click-clear-collect-targets", () =>
      createGraphwarOneClickClearCandidates(createTargetCollectionOptions()),
    );
    const simulationMask = options.input.getSimulationMask();
    const searchInput = createGraphwarOneClickClearSearchInput({
      bounds: preflightResult.bounds,
      boundsRect: options.input.boundsRect.value,
      candidates,
      dagEdgeWorkerCount: preflightResult.dagEdgeWorkerCount,
      deleteOptimizationEnabled: options.input.getDeleteOptimizationEnabled(),
      hitCandidates: createGraphwarOneClickClearHitCandidates(createTargetCollectionOptions()),
      pathPoints: options.input.getPathPoints(),
      prefixTarget: preflightResult.prefixTarget,
      routeMaskCacheId: options.pathfinding.cache.getMaskCacheId(preflightResult.obstacleMask),
      routeMode: options.input.getRouteMode(),
      routeObstacleMask: preflightResult.obstacleMask,
      settings: options.input.getFormulaSettings(),
      simulationMask,
      simulationMaskCacheId: simulationMask ? options.pathfinding.cache.getMaskCacheId(simulationMask) : 0,
      tolerances: preflightResult.tolerances,
    });
    const searchCacheKey =
      runOptions.useResultCache === false
        ? ""
        : options.pathfinding.cache.createOneClickClearResultCacheKey(searchInput);
    let search =
      runOptions.useResultCache === false
        ? undefined
        : options.pathfinding.cache.getCachedOneClickClearResult(searchCacheKey, (timing) => timings.push(timing));
    const cacheHit = search !== undefined;
    if (!search) {
      search = await options.debug.measureStageAsync(timings, "one-click-clear-search", () =>
        options.pathfinding.runner.buildOneClickClearPath(searchInput, {
          onIncumbent: (incumbent) => {
            if (activeRun?.token !== pathfindingToken || !options.run.isCurrent(pathfindingToken)) {
              return;
            }
            // 动画关闭时仍保存检查点，用户取消和托管截止才能零额外搜索地使用最新有效方案。
            activeRun = { incumbent, token: pathfindingToken };
            runOptions.onIncumbent?.(incumbent);
          },
        }),
      );
      // 带 incumbent 的 failure 本身不携带检查点；缓存它会让下一次命中时失去可保留结果。
      if (runOptions.useResultCache !== false && (search.result.type === "success" || !activeRun?.incumbent)) {
        options.pathfinding.cache.cacheOneClickClearResult(searchCacheKey, search);
      }
    }
    return {
      cacheHit,
      candidateIds: new Set(candidates.map((candidate) => candidate.id)),
      search,
    };
  }

  /** 组装敌我筛选和目标几何所需的最小选项。 */
  function createTargetCollectionOptions() {
    return {
      friendlyFireEnabled: options.targets.getFriendlyFireEnabled(),
      geometry: options.targets.createGeometry(),
      isFriendlySoldier: options.targets.isFriendlySoldier,
      pathPoints: options.input.getPathPoints(),
      soldiers: options.targets.getSoldiers(),
    };
  }

  /** 将成功路径、公式和命中目标原子写回页面。 */
  function applySuccessResult(
    startedAt: number,
    timings: SmartPathfindingDebugTimingEntry[],
    result: Extract<GraphwarOneClickClearPathWorkerResult["result"], { type: "success" }>,
    resultCacheHit: boolean,
    finishDebugTimings: (completedAt?: number) => void,
  ) {
    options.debug.measureStage(timings, "one-click-clear-apply-result", () => options.effects.applyIncumbent(result));
    options.effects.flashHitSoldiers(result.targetIds);
    let completedAt = options.time.now();
    options.debug.measureStage(timings, "one-click-clear-setting-status", () => {
      completedAt = options.time.now();
      options.effects.setStatus(
        options.messages.getSuccessMessage(
          result.targetIds.length,
          resultCacheHit ? completedAt - startedAt : result.elapsedMs,
          resultCacheHit,
        ),
        "success",
      );
      completedAt = options.time.now();
    });
    finishDebugTimings(completedAt);
  }

  /** 根据失败原因选择保留 incumbent 或显示最终失败。 */
  function finishFailureResult(
    timings: SmartPathfindingDebugTimingEntry[],
    reason: GraphwarOneClickClearFailureReason,
    getElapsedMs: (completedAt: number) => number,
    finishDebugTimings: (completedAt?: number) => void,
  ) {
    let completedAt = options.time.now();
    options.debug.measureStage(timings, "one-click-clear-setting-status", () => {
      completedAt = options.time.now();
      options.effects.setStatus(options.messages.getFailureMessage(reason, getElapsedMs(completedAt)), "error");
      completedAt = options.time.now();
    });
    finishDebugTimings(completedAt);
  }

  /** 把本次主搜索已经验证的检查点当作成功落地，不补跑最终回放或命中统计。 */
  function finishWithActiveIncumbent(
    token: number,
    runOptions: GraphwarOneClickClearRunOptions,
    timings: SmartPathfindingDebugTimingEntry[],
    finishDebugTimings: (completedAt?: number) => void,
  ) {
    const incumbent = activeRun?.token === token ? activeRun.incumbent : undefined;
    if (!incumbent) {
      return false;
    }
    runOptions.onSuccessBeforeEffects?.();
    options.run.finish(token);
    options.debug.measureStage(timings, "one-click-clear-apply-result", () =>
      options.effects.applyIncumbent(incumbent),
    );
    let completedAt = options.time.now();
    options.debug.measureStage(timings, "one-click-clear-setting-status", () => {
      completedAt = options.time.now();
      options.effects.setStatus(options.messages.getRetainedMessage(), "success");
      completedAt = options.time.now();
    });
    finishDebugTimings(completedAt);
    activeRun = undefined;
    return true;
  }

  /** 用户取消先提交检查点，再由 session 终止 Worker；两步分开才能保持硬取消。 */
  function finalizeActiveIncumbent() {
    const incumbent = activeRun?.incumbent;
    if (!incumbent) {
      return false;
    }
    options.effects.applyIncumbent(incumbent);
    options.effects.setStatus(options.messages.getRetainedMessage(), "success");
    activeRun = undefined;
    return true;
  }

  /** 新局面或设置变化只清除请求局部检查点，实际 Worker 仍由共享 session 负责硬取消。 */
  function discardActiveIncumbent() {
    activeRun = undefined;
  }

  return {
    discardActiveIncumbent,
    finalizeActiveIncumbent,
    run,
  };
}
