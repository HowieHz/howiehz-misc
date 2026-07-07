import type { BoundsRect, GraphBounds, PixelPoint } from "../../../core/types";
import type { GraphwarTrajectoryFormulaSettings } from "../../../formula/trajectory-sampling";
import type { GraphwarPathfindingPreview } from "../../../pathfinding/routing/visibility-graph";
import type { GraphwarPathfindingResultCacheTimingEntry } from "../../../pathfinding/runtime/cache";
import {
  isGraphwarPathfindingCancelledError,
  type GraphwarPathfindingRunOptions,
} from "../../../pathfinding/runtime/runner";
import type {
  GraphwarSmartPathfindingPathInput,
  GraphwarSmartPathfindingPathResult,
  GraphwarSmartPathfindingWorkerTiming,
} from "../../../pathfinding/runtime/worker-types";
import {
  createGraphwarPathfindingPreviewSnapshot,
  type GraphwarPathfindingPreviewSnapshot,
} from "../../../pathfinding/smart/preview";
import {
  createGraphwarSmartPathfindingSearchInput,
  type GraphwarSmartPathfindingSearchTolerances,
} from "../../../pathfinding/smart/search-input";
import {
  createGraphwarSmartPathfindingHitTarget,
  getGraphwarSmartPathfindingAppendedSegment,
} from "../../../pathfinding/smart/trajectory";
import type { GraphwarSmartPathfindingSoldierTarget } from "../../../pathfinding/targeting";
import type { SmartPathfindingDebugTimingEntry } from "../../debug/use-graphwar-debug-timings";
import type { GraphwarSmartPathfindingRunBuildResult } from "./run-workflow";

type GraphwarSmartPathfindingBuildTarget = PixelPoint | GraphwarSmartPathfindingSoldierTarget;

interface GraphwarSmartPathfindingBuilderCache {
  cacheSmartPathfindingResult: (cacheKey: string, result: GraphwarSmartPathfindingPathResult) => void;
  createSmartPathfindingResultCacheKey: (input: GraphwarSmartPathfindingPathInput) => string;
  getCachedSmartPathfindingResult: (
    cacheKey: string,
    onTiming?: (timing: GraphwarPathfindingResultCacheTimingEntry) => void,
  ) => GraphwarSmartPathfindingPathResult | undefined;
  getRouteObstacleMaskCacheId: (mask: Uint8Array) => number;
}

interface GraphwarSmartPathfindingBuilderRunner {
  findSmartPath: (
    input: GraphwarSmartPathfindingPathInput,
    options?: GraphwarPathfindingRunOptions,
  ) => Promise<GraphwarSmartPathfindingPathResult>;
}

interface GraphwarSmartPathfindingBuilderOptions {
  /** 调试耗时应继续并入页面同一份调试列表。 */
  debug: {
    addWorkerTimings: (
      timings: SmartPathfindingDebugTimingEntry[] | undefined,
      workerTimings: readonly GraphwarSmartPathfindingWorkerTiming[],
    ) => void;
  };
  /** 页面副作用应保留在页面侧，builder 只在对应结果出现时触发。 */
  effects: {
    /** 短暂标记真实弹道被阻挡的位置。 */
    flashBlockedPoint: (point: PixelPoint | undefined) => void;
    /** 当前路径违反 x+ 规则时由页面写入本地化状态。 */
    setGraphRuleFailureStatus: () => void;
  };
  /** 构造 worker 输入时应读取调用时的最新页面状态。 */
  input: {
    /** 当前截图棋盘矩形；worker 输入和搜索预览都应使用调用时的最新值。 */
    boundsRect: { readonly value: BoundsRect };
    /** 当前 Graphwar 坐标范围；无效时保持原来的早退语义。 */
    getBounds: () => GraphBounds | undefined;
    /** 当前公式采样设置。 */
    getFormulaSettings: () => GraphwarTrajectoryFormulaSettings;
    /** 当前基础障碍 mask；不存在时不能启动几何寻路。 */
    getObstacleMask: () => Uint8Array | undefined;
    /** 当前工作流路径；builder 会在构造输入前复制快照。 */
    getPathPixels: () => readonly PixelPoint[];
    /** 函数模拟用障碍 mask。 */
    getSimulationMask: () => Uint8Array | undefined;
    /** 普通点击目标点使用的默认命中半径。 */
    getTargetPointRadius: () => number;
    /** 当前寻路容差；无效时保持原来的早退语义。 */
    getTolerances: () => GraphwarSmartPathfindingSearchTolerances | undefined;
    /** 寻路并行数无效时应沿用页面原来的早退语义。 */
    isPathfindingWorkerCountValid: () => boolean;
  };
  /** 单目标寻路的 worker 与页面侧完整结果缓存。 */
  pathfinding: {
    /** 页面侧寻路结果缓存；builder 只消费智能寻路相关入口。 */
    cache: GraphwarSmartPathfindingBuilderCache;
    /** Master worker runner。 */
    runner: GraphwarSmartPathfindingBuilderRunner;
  };
  /** 搜索动画应集中在预览适配层，避免 worker 结果格式泄露回页面。 */
  preview: {
    /** 搜索动画开关应按每个阶段读取当前值。 */
    isSearchAnimationEnabled: () => boolean;
    /** 搜索开始前展示从起点到目标的连接线。 */
    setConnection: (startPoint: PixelPoint, targetPoint: PixelPoint) => void;
    /** 搜索成功后展示追加路径段。 */
    setPath: (points: readonly PixelPoint[]) => void;
    /** 写入已投影到截图坐标的搜索动画快照。 */
    setSearch: (snapshot: GraphwarPathfindingPreviewSnapshot) => void;
  };
  /** 运行 token 和阶段文案仍由 session 管理。 */
  run: {
    /** 标记进入搜索阶段并刷新进行中文案。 */
    enterSearchPhase: () => void;
    /** 判断异步结果是否仍属于当前寻路运行。 */
    isCurrent: (token: number) => boolean;
  };
}

export interface GraphwarSmartPathfindingBuilderController {
  /** 构造并执行一次单目标智能寻路，返回可直接落地的路径。 */
  buildPath: (
    target: GraphwarSmartPathfindingBuildTarget,
    cancelToken: number,
    timings?: SmartPathfindingDebugTimingEntry[],
  ) => Promise<GraphwarSmartPathfindingRunBuildResult | undefined>;
}

/** 管理单目标智能寻路的 worker 输入、结果缓存、搜索预览和结果解释。 */
export function useGraphwarSmartPathfindingBuilder(
  options: GraphwarSmartPathfindingBuilderOptions,
): GraphwarSmartPathfindingBuilderController {
  /** 在当前障碍 mask 上为目标构造几何路径，并用真实弹道验证后返回可用路径。 */
  async function buildPath(
    target: GraphwarSmartPathfindingBuildTarget,
    cancelToken: number,
    timings?: SmartPathfindingDebugTimingEntry[],
  ) {
    const bounds = options.input.getBounds();
    if (!bounds) {
      return undefined;
    }
    if (!options.input.isPathfindingWorkerCountValid()) {
      return undefined;
    }

    const targetPoint = "targetPoint" in target ? target.targetPoint : target;
    const hitTarget = "targetPoint" in target ? target.hitCircle : target;
    const obstacleMask = options.input.getObstacleMask();
    const tolerances = options.input.getTolerances();
    const sourcePath = [...options.input.getPathPixels()];
    const startPoint = sourcePath.at(-1);
    if (!obstacleMask || !tolerances || !startPoint) {
      return undefined;
    }

    if (options.preview.isSearchAnimationEnabled()) {
      options.preview.setConnection(startPoint, targetPoint);
    }

    options.run.enterSearchPhase();
    await waitForNextPathfindingSlice();
    if (!options.run.isCurrent(cancelToken)) {
      return undefined;
    }

    const input = createGraphwarSmartPathfindingSearchInput({
      bounds,
      boundsRect: options.input.boundsRect.value,
      hitTarget: createGraphwarSmartPathfindingHitTarget(hitTarget, options.input.getTargetPointRadius()),
      previewEnabled: options.preview.isSearchAnimationEnabled(),
      routeMaskCacheId: options.pathfinding.cache.getRouteObstacleMaskCacheId(obstacleMask),
      routeObstacleMask: obstacleMask,
      settings: options.input.getFormulaSettings(),
      simulationMask: options.input.getSimulationMask(),
      sourcePath,
      targetPoint,
      tolerances,
    });
    const resultCacheKey = options.pathfinding.cache.createSmartPathfindingResultCacheKey(input);
    let result = options.pathfinding.cache.getCachedSmartPathfindingResult(resultCacheKey, (timing) =>
      timings?.push(timing),
    );
    const resultCacheHit = result !== undefined;
    try {
      if (!result) {
        result = await options.pathfinding.runner.findSmartPath(input, {
          onPreview: options.preview.isSearchAnimationEnabled() ? setSearchPreview : undefined,
        });
        options.pathfinding.cache.cacheSmartPathfindingResult(resultCacheKey, result);
      }
    } catch (error) {
      if (!options.run.isCurrent(cancelToken) || isGraphwarPathfindingCancelledError(error)) {
        return undefined;
      }
      return undefined;
    }

    options.debug.addWorkerTimings(timings, result.timings);
    if (result.failureReason === "graph-rule") {
      options.effects.setGraphRuleFailureStatus();
      return undefined;
    }
    if (result.blockedPoint) {
      options.effects.flashBlockedPoint(result.blockedPoint);
    }
    if (result.path && options.preview.isSearchAnimationEnabled()) {
      options.preview.setPath(getGraphwarSmartPathfindingAppendedSegment(result.path, sourcePath.length));
    }
    return result.path ? { cacheHit: resultCacheHit, path: result.path } : undefined;
  }

  function setSearchPreview(preview: GraphwarPathfindingPreview) {
    options.preview.setSearch(createGraphwarPathfindingPreviewSnapshot(preview, options.input.boundsRect.value));
  }

  return {
    buildPath,
  };
}

/** 让长循环让出事件循环，保证搜索动画和取消操作能及时响应。 */
function waitForNextPathfindingSlice() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
