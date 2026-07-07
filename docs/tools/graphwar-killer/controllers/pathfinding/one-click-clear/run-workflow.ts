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
} from "../../../pathfinding/one-click-clear/search";
import {
  createGraphwarOneClickClearCandidates,
  createGraphwarOneClickClearHitCandidates,
  type GraphwarOneClickClearTargetSoldier,
} from "../../../pathfinding/one-click-clear/targets";
import type { GraphwarPathfindingResultCacheTimingEntry } from "../../../pathfinding/runtime/cache";
import { isGraphwarPathfindingCancelledError } from "../../../pathfinding/runtime/runner";
import type {
  GraphwarOneClickClearPathWorkerInput,
  GraphwarOneClickClearPathWorkerResult,
} from "../../../pathfinding/runtime/worker-types";
import type { GraphwarTargetingGeometry } from "../../../pathfinding/targeting";
import type { SmartPathfindingDebugStage, SmartPathfindingDebugTimingEntry } from "../../debug/timings";

type GraphwarOneClickClearStatusKind = "error" | "success" | "warning";
type GraphwarOneClickClearPrefixTarget = PixelPoint | GraphwarTrajectoryTargetCircle;

interface GraphwarOneClickClearRunCache {
  cacheOneClickClearResult: (cacheKey: string, result: GraphwarOneClickClearPathWorkerResult) => void;
  createOneClickClearResultCacheKey: (input: GraphwarOneClickClearPathWorkerInput) => string;
  getCachedOneClickClearResult: (
    cacheKey: string,
    onTiming?: (timing: GraphwarPathfindingResultCacheTimingEntry) => void,
  ) => GraphwarOneClickClearPathWorkerResult | undefined;
  getRouteObstacleMaskCacheId: (mask: Uint8Array) => number;
}

interface GraphwarOneClickClearRunRunner {
  buildOneClickClearPath: (
    input: GraphwarOneClickClearPathWorkerInput,
  ) => Promise<GraphwarOneClickClearPathWorkerResult>;
}

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
    applyPath: (points: PixelPoint[]) => void;
    flashHitSoldiers: (targetIds: readonly string[]) => void;
    setStatus: (message: string, kind: GraphwarOneClickClearStatusKind) => void;
  };
  /** 构造一键清图 worker 输入时应读取调用时的最新页面状态。 */
  input: {
    boundsRect: { readonly value: BoundsRect };
    getBounds: () => GraphBounds | undefined;
    getFormulaSettings: () => GraphwarTrajectoryFormulaSettings;
    getObstacleMask: () => Uint8Array | undefined;
    getPathfindingWorkerCount: () => number | undefined;
    getPathPoints: () => readonly PixelPoint[];
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
  };
  /** 时间来源应复用页面规则，保证调试耗时和状态耗时一致。 */
  time: {
    now: () => number;
  };
}

export interface GraphwarOneClickClearRunWorkflowController {
  /** 运行一次一键清图，并负责 token、调试耗时、状态和结果落地。 */
  run: () => Promise<boolean>;
}

/** 管理一键清图运行流程，集中预检、目标收集、worker 输入、cache 和结果落地。 */
export function useGraphwarOneClickClearRunWorkflow<TSoldier extends GraphwarOneClickClearTargetSoldier>(
  options: GraphwarOneClickClearRunWorkflowOptions<TSoldier>,
): GraphwarOneClickClearRunWorkflowController {
  /** 从当前路径尾部出发，追加当前模型下击杀最多的路径。 */
  async function run() {
    options.debug.clearTimings();
    const startedAt = options.time.now();
    const timings: SmartPathfindingDebugTimingEntry[] = [];
    const preflightResult = createMeasuredPreflight(timings);
    if (!preflightResult.ok) {
      finishPreflightFailure(startedAt, timings, preflightResult.message, preflightResult.kind);
      return false;
    }

    const pathfindingToken = options.run.start(options.messages.getInProgressMessage());
    let debugTimingsFinished = false;
    const finishOneClickClearDebugTimings = (completedAt = options.time.now()) => {
      debugTimingsFinished = true;
      if (!options.run.isCurrent(pathfindingToken)) {
        return;
      }
      options.debug.finishTimings(startedAt, timings, completedAt);
    };

    try {
      const searchResult = await buildSearchResult(preflightResult, timings);
      options.debug.appendSearchWorkerTimings(timings, searchResult.search.timings);
      if (!options.run.isCurrent(pathfindingToken)) {
        return false;
      }

      const result = searchResult.search.result;
      options.run.finish(pathfindingToken);
      if (result.type === "success") {
        applySuccessResult(startedAt, timings, result, searchResult.cacheHit, finishOneClickClearDebugTimings);
        return true;
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
      finishFailureResult(
        timings,
        "pathfinding-worker-failed",
        (completedAt) => completedAt - startedAt,
        finishOneClickClearDebugTimings,
      );
      return false;
    } finally {
      if (options.run.isCurrent(pathfindingToken)) {
        options.run.finish(pathfindingToken);
        if (!debugTimingsFinished) {
          finishOneClickClearDebugTimings();
        }
      }
    }
  }

  function createMeasuredPreflight(timings: SmartPathfindingDebugTimingEntry[]) {
    return options.debug.measureStage(timings, "one-click-clear-preflight", () => {
      const bounds = options.input.getBounds();
      const workerCount = options.input.getPathfindingWorkerCount();
      const tolerances = options.input.getTolerances();
      const result = createGraphwarOneClickClearSearchPreflight({
        bounds,
        createPrefixTarget,
        getObstacleMask: options.input.getObstacleMask,
        pathfindingWorkerCount: workerCount,
        pathPointCount: options.input.getPathPoints().length,
        tolerances,
        unsupportedMode: options.input.isUnsupportedMode,
      });
      return result.ok ? result : { ...result, ...options.messages.getPreflightFailureStatus(result.reason) };
    });
  }

  function createPrefixTarget() {
    const target = options.targets.getPrefixTarget();
    if (!target) {
      return undefined;
    }
    return "center" in target ? { center: target.center, radius: target.radius } : { center: target, radius: 1 };
  }

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

  async function buildSearchResult(
    preflightResult: Extract<ReturnType<typeof createGraphwarOneClickClearSearchPreflight>, { ok: true }>,
    timings: SmartPathfindingDebugTimingEntry[],
  ) {
    const candidates = options.debug.measureStage(timings, "one-click-clear-collect-targets", () =>
      createGraphwarOneClickClearCandidates(createTargetCollectionOptions()),
    );
    const hitCandidates = createGraphwarOneClickClearHitCandidates(createTargetCollectionOptions());
    const searchInput = createGraphwarOneClickClearSearchInput({
      bounds: preflightResult.bounds,
      boundsRect: options.input.boundsRect.value,
      candidates,
      dagEdgeWorkerCount: preflightResult.dagEdgeWorkerCount,
      hitCandidates,
      pathPoints: options.input.getPathPoints(),
      prefixTarget: preflightResult.prefixTarget,
      routeMaskCacheId: options.pathfinding.cache.getRouteObstacleMaskCacheId(preflightResult.obstacleMask),
      routeObstacleMask: preflightResult.obstacleMask,
      settings: options.input.getFormulaSettings(),
      simulationMask: options.input.getSimulationMask(),
      tolerances: preflightResult.tolerances,
    });
    const searchCacheKey = options.pathfinding.cache.createOneClickClearResultCacheKey(searchInput);
    let search = options.pathfinding.cache.getCachedOneClickClearResult(searchCacheKey, (timing) =>
      timings.push(timing),
    );
    const cacheHit = search !== undefined;
    if (!search) {
      search = await options.debug.measureStageAsync(timings, "one-click-clear-search", () =>
        options.pathfinding.runner.buildOneClickClearPath(searchInput),
      );
      options.pathfinding.cache.cacheOneClickClearResult(searchCacheKey, search);
    }
    return {
      cacheHit,
      search,
    };
  }

  function createTargetCollectionOptions() {
    return {
      friendlyFireEnabled: options.targets.getFriendlyFireEnabled(),
      geometry: options.targets.createGeometry(),
      pathPoints: options.input.getPathPoints(),
      soldiers: options.targets.getSoldiers(),
    };
  }

  function applySuccessResult(
    startedAt: number,
    timings: SmartPathfindingDebugTimingEntry[],
    result: Extract<GraphwarOneClickClearPathWorkerResult["result"], { type: "success" }>,
    resultCacheHit: boolean,
    finishDebugTimings: (completedAt?: number) => void,
  ) {
    options.debug.measureStage(timings, "one-click-clear-apply-result", () =>
      options.effects.applyPath(result.pathPoints),
    );
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

  return {
    run,
  };
}
