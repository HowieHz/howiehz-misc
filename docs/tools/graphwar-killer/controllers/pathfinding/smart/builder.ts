import { pixelPointsEqual } from "../../../core/geometry";
import type { BoundsRect, GraphBounds, PixelPoint } from "../../../core/types";
import type {
  GraphwarTrajectoryFormulaSettings,
  GraphwarTrajectoryTargetCircle,
} from "../../../formula/trajectory/sampling";
import type { GraphwarPathfindingRouteMode } from "../../../pathfinding/routing/mode";
import type { GraphwarPathfindingPreview } from "../../../pathfinding/routing/visibility-graph";
import type { GraphwarPathfindingResultCacheTimingEntry } from "../../../pathfinding/runtime/cache";
import type {
  GraphwarSmartPathfindingPathInput,
  GraphwarSmartPathfindingPathResult,
  GraphwarSmartPathfindingWorkerTiming,
} from "../../../pathfinding/runtime/protocol";
import {
  isGraphwarPathfindingCancelledError,
  type GraphwarPathfindingRunOptions,
} from "../../../pathfinding/runtime/runner";
import {
  createGraphwarSmartPathfindingSearchInput,
  type GraphwarSmartPathfindingSearchTolerances,
} from "../../../pathfinding/smart/input";
import {
  createGraphwarPathfindingPreviewSnapshot,
  type GraphwarPathfindingPreviewSnapshot,
} from "../../../pathfinding/smart/preview";
import {
  createGraphwarSmartPathfindingHitTarget,
  getGraphwarSmartPathfindingAppendedSegment,
} from "../../../pathfinding/smart/trajectory";
import type { GraphwarSmartPathfindingSoldierTarget } from "../../../pathfinding/targeting";
import type { SmartPathfindingDebugTimingEntry } from "../../debug/timings";
import { createGraphwarSmartPathfindingDebugAttempt, type GraphwarPathfindingDebugAttempt } from "../debug-report";
import type { GraphwarSmartPathfindingRunBuildResult } from "./workflow";

type GraphwarSmartPathfindingBuildTarget = PixelPoint | GraphwarSmartPathfindingSoldierTarget;

/** Builder 使用的页面侧智能寻路结果缓存接口。 */
interface GraphwarSmartPathfindingBuilderCache {
  cacheSmartPathfindingResult: (cacheKey: string, result: GraphwarSmartPathfindingPathResult) => void;
  createSmartPathfindingResultCacheKey: (input: GraphwarSmartPathfindingPathInput) => string;
  getCachedSmartPathfindingResult: (
    cacheKey: string,
    onTiming?: (timing: GraphwarPathfindingResultCacheTimingEntry) => void,
  ) => GraphwarSmartPathfindingPathResult | undefined;
  getMaskCacheId: (mask: Uint8Array) => number;
}

/** Builder 使用的 Master Worker 寻路接口。 */
interface GraphwarSmartPathfindingBuilderRunner {
  findSmartPath: (
    input: GraphwarSmartPathfindingPathInput,
    options?: GraphwarPathfindingRunOptions,
  ) => Promise<GraphwarSmartPathfindingPathResult>;
}

/** 组合一次智能寻路所需的页面状态、效果、缓存和运行生命周期。 */
interface GraphwarSmartPathfindingBuilderOptions {
  /** 调试耗时应继续并入页面同一份调试列表。 */
  debug: {
    addWorkerTimings: (
      timings: SmartPathfindingDebugTimingEntry[] | undefined,
      workerTimings: readonly GraphwarSmartPathfindingWorkerTiming[],
    ) => void;
    recordAttempt: (
      attempt: GraphwarPathfindingDebugAttempt,
      timings: SmartPathfindingDebugTimingEntry[] | undefined,
    ) => void;
  };
  /** 页面副作用应保留在页面侧，builder 只在对应结果出现时触发。 */
  effects: {
    /** 短暂标记真实弹道被阻挡的位置。 */
    flashBlockedPoint: (point: PixelPoint | undefined) => void;
    /** 短暂标记已有 Step 路径中首个严格域失败的控制段。 */
    flashBlockedSegment: (start: PixelPoint | undefined, end: PixelPoint | undefined) => void;
  };
  /** 构造 worker 输入时应读取调用时的最新页面状态。 */
  input: {
    /** 当前截图坐标系矩形；worker 输入和搜索预览都应使用调用时的最新值。 */
    boundsRect: { readonly value: BoundsRect };
    /** 当前 Graphwar 坐标范围；无效时保持原来的早退语义。 */
    getBounds: () => GraphBounds | undefined;
    /** 当前公式采样设置。 */
    getFormulaSettings: () => GraphwarTrajectoryFormulaSettings;
    /** 是否尝试删除新增控制点。 */
    getDeleteOptimizationEnabled: () => boolean;
    /** 当前基础障碍 mask；不存在时不能启动几何寻路。 */
    getObstacleMask: () => Uint8Array | undefined;
    /** 当前工作流路径；builder 会在构造输入前复制快照。 */
    getPathPixels: () => readonly PixelPoint[];
    /** 旧公式当前尾点的精确预检目标。 */
    getPrefixTarget: () => GraphwarTrajectoryTargetCircle | undefined;
    /** 当前几何路线算法模式。 */
    getRouteMode: () => GraphwarPathfindingRouteMode;
    /** 函数模拟用障碍 mask。 */
    getSimulationMask: () => Uint8Array | undefined;
    /** 普通点击目标点使用的默认真实命中半径，单位为截图像素；无有效 bounds 时不可用。 */
    getTargetHitRadiusPixels: () => number | undefined;
    /** 当前寻路容差；无效时保持原来的早退语义。 */
    getTolerances: () => GraphwarSmartPathfindingSearchTolerances | undefined;
  };
  /** 单目标寻路的 worker 与页面侧完整结果缓存。 */
  pathfinding: {
    /** 页面侧寻路结果缓存；builder 只消费智能寻路相关入口。 */
    cache: GraphwarSmartPathfindingBuilderCache;
    /** 调试开关只控制完整结果缓存，不影响 Worker 内部准备缓存。 */
    isResultCacheEnabled: () => boolean;
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

/** 构造单目标寻路输入并应用 Worker 结果的控制器。 */
export interface GraphwarSmartPathfindingBuilderController {
  /** 构造并执行一次单目标智能寻路，返回可直接落地的路径。 */
  buildPath: (
    target: GraphwarSmartPathfindingBuildTarget,
    cancelToken: number,
    timings?: SmartPathfindingDebugTimingEntry[],
  ) => Promise<GraphwarSmartPathfindingRunBuildResult>;
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
  ): Promise<GraphwarSmartPathfindingRunBuildResult> {
    // Workflow 只会为调试任务传入 timings；在首次 await 前冻结，避免运行中切换改变本任务协议。
    const shouldCollectDiagnostics = timings !== undefined;
    const shouldUseResultCache = options.pathfinding.isResultCacheEnabled();
    const bounds = options.input.getBounds();
    if (!bounds) {
      return { type: "failure" };
    }
    const targetPoint = "targetPoint" in target ? target.targetPoint : target;
    const fallbackTargetPoint = "targetPoint" in target ? target.fallbackTargetPoint : undefined;
    const targetPoints =
      fallbackTargetPoint && !pixelPointsEqual(targetPoint, fallbackTargetPoint)
        ? [targetPoint, fallbackTargetPoint]
        : [targetPoint];
    const hitTarget = "targetPoint" in target ? target.hitCircle : target;
    const tolerances = options.input.getTolerances();
    const sourcePath = [...options.input.getPathPixels()];
    const startPoint = sourcePath.at(-1);
    if (!tolerances || !startPoint) {
      return { type: "failure" };
    }

    const obstacleMask = options.input.getObstacleMask();
    if (!obstacleMask) {
      return { reason: "missing-obstacle-mask", type: "failure" };
    }

    if (options.preview.isSearchAnimationEnabled()) {
      options.preview.setConnection(startPoint, targetPoint);
    }

    options.run.enterSearchPhase();
    // Yield once before starting CPU-heavy work so the connection preview can paint.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    if (!options.run.isCurrent(cancelToken)) {
      return { type: "cancelled" };
    }

    const targetHitCircle = createGraphwarSmartPathfindingHitTarget(
      hitTarget,
      options.input.getTargetHitRadiusPixels(),
    );
    if (!targetHitCircle) {
      return { type: "failure" };
    }
    // Snapshot narrowed inputs for the nested async attempts; TypeScript does not retain
    // outer control-flow narrowing inside a function declaration.
    const searchBounds = bounds;
    const searchObstacleMask = obstacleMask;
    const searchTargetHitCircle = targetHitCircle;
    const searchTolerances = tolerances;
    const simulationMask = options.input.getSimulationMask();
    // Resolve the stable id once; a soldier target may run both center and edge attempts.
    const simulationMaskCacheId = simulationMask ? options.pathfinding.cache.getMaskCacheId(simulationMask) : 0;

    let result: GraphwarSmartPathfindingPathResult | undefined;
    let hasResultCacheHit = false;
    for (let index = 0; index < targetPoints.length; index += 1) {
      const candidateTargetPoint = targetPoints[index];
      if (!candidateTargetPoint || !options.run.isCurrent(cancelToken)) {
        return { type: "cancelled" };
      }
      if (index > 0 && options.preview.isSearchAnimationEnabled()) {
        options.preview.setConnection(startPoint, candidateTargetPoint);
      }

      const attempt = await findPathfindingResult(candidateTargetPoint);
      if (attempt.type !== "result") {
        return attempt;
      }
      result = attempt.result;
      hasResultCacheHit = attempt.hasResultCacheHit;
      options.debug.addWorkerTimings(timings, result.timings);
      // 旧路径严格域失败与目标点无关；其他失败才值得尝试命中圈 x+ 边缘。
      if (result.path || result.invalidSegmentIndex !== undefined) {
        break;
      }
    }
    if (!result) {
      return { type: "failure" };
    }
    if (result.failureReason === "graph-rule") {
      return { reason: "graph-rule", type: "failure" };
    }
    if (result.blockedPoint) {
      options.effects.flashBlockedPoint(result.blockedPoint);
    }
    if (result.invalidSegmentIndex !== undefined) {
      options.effects.flashBlockedSegment(
        sourcePath[result.invalidSegmentIndex],
        sourcePath[result.invalidSegmentIndex + 1],
      );
    }
    if (result.path && options.preview.isSearchAnimationEnabled()) {
      options.preview.setPath(getGraphwarSmartPathfindingAppendedSegment(result.path, sourcePath.length));
    }
    return result.path ? { hasResultCacheHit, path: result.path, type: "success" } : { type: "failure" };

    /** 对一个候选目标点执行缓存查询或 Worker 寻路。 */
    async function findPathfindingResult(candidateTargetPoint: PixelPoint) {
      const input = createGraphwarSmartPathfindingSearchInput({
        bounds: searchBounds,
        boundsRect: options.input.boundsRect.value,
        isDeleteOptimizationEnabled: options.input.getDeleteOptimizationEnabled(),
        hitTarget: searchTargetHitCircle,
        prefixTarget: options.input.getPrefixTarget(),
        isPreviewEnabled: options.preview.isSearchAnimationEnabled(),
        routeMaskCacheId: options.pathfinding.cache.getMaskCacheId(searchObstacleMask),
        routeMode: options.input.getRouteMode(),
        routeObstacleMask: searchObstacleMask,
        settings: options.input.getFormulaSettings(),
        simulationMask,
        simulationMaskCacheId,
        sourcePath,
        targetPoint: candidateTargetPoint,
        tolerances: searchTolerances,
      });
      const resultCacheKey = shouldUseResultCache
        ? options.pathfinding.cache.createSmartPathfindingResultCacheKey(input)
        : "";
      let attemptResult = shouldUseResultCache
        ? options.pathfinding.cache.getCachedSmartPathfindingResult(resultCacheKey, (timing) => timings?.push(timing))
        : undefined;
      const hasResultCacheHit = attemptResult !== undefined;
      try {
        if (!attemptResult) {
          attemptResult = await options.pathfinding.runner.findSmartPath(input, {
            onPreview: options.preview.isSearchAnimationEnabled() ? setSearchPreview : undefined,
            shouldCollectDiagnostics,
          });
          if (shouldUseResultCache) {
            options.pathfinding.cache.cacheSmartPathfindingResult(resultCacheKey, attemptResult);
          }
        }
      } catch (error) {
        if (shouldCollectDiagnostics) {
          options.debug.recordAttempt(
            createGraphwarSmartPathfindingDebugAttempt(input, "worker", undefined, error),
            timings,
          );
        }
        if (!options.run.isCurrent(cancelToken) || isGraphwarPathfindingCancelledError(error)) {
          return { type: "cancelled" as const };
        }
        return { type: "worker-exception" as const };
      }
      if (shouldCollectDiagnostics) {
        options.debug.recordAttempt(
          createGraphwarSmartPathfindingDebugAttempt(
            input,
            hasResultCacheHit ? "result-cache" : "worker",
            attemptResult,
          ),
          timings,
        );
      }
      return { hasResultCacheHit, result: attemptResult, type: "result" as const };
    }
  }

  /** 仅在启用搜索动画时发布 Worker 预览。 */
  function setSearchPreview(preview: GraphwarPathfindingPreview) {
    if (!options.preview.isSearchAnimationEnabled()) {
      return;
    }
    options.preview.setSearch(createGraphwarPathfindingPreviewSnapshot(preview, options.input.boundsRect.value));
  }

  return {
    buildPath,
  };
}
