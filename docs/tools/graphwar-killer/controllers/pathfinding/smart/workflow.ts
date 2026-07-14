import type { PixelPoint } from "../../../core/types";
import type { SmartPathfindingDebugStage, SmartPathfindingDebugTimingEntry } from "../../debug/timings";

export type GraphwarSmartPathfindingRunBuildFailureReason = "graph-rule" | "missing-obstacle-mask";

/** 单目标智能寻路返回值；cacheHit 只表示完整结果缓存命中。 */
export type GraphwarSmartPathfindingRunBuildResult =
  | {
      /** 寻路是否命中页面侧完整结果缓存。 */
      cacheHit: boolean;
      /** 已通过弹道验证、可直接写回页面的完整路径。 */
      path: PixelPoint[];
      type: "success";
    }
  | {
      /** 失败原因只覆盖可明确解释的前置状态；其他失败继续走通用无路径文案。 */
      reason: GraphwarSmartPathfindingRunBuildFailureReason;
      type: "failure";
    };

/** 单目标寻路运行编排依赖；业务计算与页面副作用均由调用方注入。 */
interface GraphwarSmartPathfindingRunWorkflowOptions<TTarget> {
  /** 路径落地应走页面统一入口，以保留缓存失效、状态清理和坐标同步语义。 */
  applyPath: (path: PixelPoint[]) => void;
  /** 页面负责构造 worker 输入和真实寻路；workflow 只管理运行生命周期。 */
  buildPath: (
    target: TTarget,
    cancelToken: number,
    timings: SmartPathfindingDebugTimingEntry[],
  ) => Promise<GraphwarSmartPathfindingRunBuildResult | undefined>;
  /** 新运行开始前应清掉上一轮寻路调试结果。 */
  clearDebugTimings: () => void;
  /** 汇总本次运行调试耗时。 */
  finishDebugTimings: (
    startedAt: number,
    timings: readonly SmartPathfindingDebugTimingEntry[],
    completedAt?: number,
  ) => void;
  /** 结束当前 token 对应的运行态。 */
  finishRun: (token: number) => boolean;
  /** 失败文案应由页面按当前 locale、耗时和可解释原因生成。 */
  getFailureMessage: (elapsedMs?: number, reason?: GraphwarSmartPathfindingRunBuildFailureReason) => string;
  /** 成功文案应由页面按当前 locale、耗时和缓存状态生成。 */
  getSuccessMessage: (elapsedMs?: number, resultCacheHit?: boolean) => string;
  /** 判断异步结果是否仍属于当前寻路运行。 */
  isRunCurrent: (token: number) => boolean;
  /** 同步阶段计时应复用页面调试聚合规则。 */
  measureStage: <TResult>(
    timings: SmartPathfindingDebugTimingEntry[],
    stage: SmartPathfindingDebugStage,
    task: () => TResult,
  ) => TResult;
  /** 时间来源由页面注入，保证和现有调试耗时语义一致。 */
  now: () => number;
  /** 更新智能寻路状态文案和等级。 */
  setStatus: (message: string, kind: "error" | "success") => void;
  /** 开始一次新的寻路运行并返回取消 token。 */
  startRun: () => number;
}

/** 一次寻路请求的同步准备、预检和目标收集步骤。 */
interface GraphwarSmartPathfindingRunRequest<TTarget> {
  /** 收集本次寻路目标；返回 undefined 时按原失败状态处理。 */
  collectTarget: () => TTarget | undefined;
  /** 目标收集存在真实工作量时应记录对应阶段。 */
  collectTargetStage?: SmartPathfindingDebugStage;
  /** 计时开始后、预检前的同步准备；返回 false 时保持原早退语义，不补调试汇总。 */
  prepare?: () => boolean;
  /** 启动寻路前应先确认当前路径仍能命中尾点。 */
  preflight: () => boolean;
}

export interface GraphwarSmartPathfindingRunWorkflowController<TTarget> {
  /** 运行一次单目标智能寻路，并负责 token、调试耗时、状态和结果落地。 */
  run: (request: GraphwarSmartPathfindingRunRequest<TTarget>) => Promise<boolean>;
}

/** 管理单目标智能寻路的运行编排，避免页面重复维护 token、状态和调试耗时顺序。 */
export function useGraphwarSmartPathfindingRunWorkflow<TTarget>(
  options: GraphwarSmartPathfindingRunWorkflowOptions<TTarget>,
): GraphwarSmartPathfindingRunWorkflowController<TTarget> {
  /** 运行一次单目标智能寻路。 */
  async function run(request: GraphwarSmartPathfindingRunRequest<TTarget>) {
    options.clearDebugTimings();
    const startedAt = options.now();
    const timings: SmartPathfindingDebugTimingEntry[] = [];
    if (request.prepare && !request.prepare()) {
      return false;
    }

    if (!options.measureStage(timings, "preflight", request.preflight)) {
      options.finishDebugTimings(startedAt, timings);
      return false;
    }

    const target = request.collectTargetStage
      ? options.measureStage(timings, request.collectTargetStage, request.collectTarget)
      : request.collectTarget();
    if (!target) {
      finishWithFailure(startedAt, timings);
      return false;
    }

    const pathfindingToken = options.startRun();
    let pathfindingResult: GraphwarSmartPathfindingRunBuildResult | undefined;
    try {
      pathfindingResult = await options.buildPath(target, pathfindingToken, timings);
      if (!options.isRunCurrent(pathfindingToken)) {
        return false;
      }
    } finally {
      if (options.isRunCurrent(pathfindingToken)) {
        options.finishRun(pathfindingToken);
      }
    }

    if (!pathfindingResult) {
      finishWithFailure(startedAt, timings);
      return false;
    }
    if (pathfindingResult.type === "failure") {
      finishWithFailure(startedAt, timings, pathfindingResult.reason);
      return false;
    }

    options.measureStage(timings, "apply-result", () => options.applyPath(pathfindingResult.path));
    // Capture the time around status rendering so debug totals preserve the page's original ordering.
    let completedAt = options.now();
    options.measureStage(timings, "setting-status", () => {
      completedAt = options.now();
      options.setStatus(options.getSuccessMessage(completedAt - startedAt, pathfindingResult.cacheHit), "success");
      completedAt = options.now();
    });
    options.finishDebugTimings(startedAt, timings, completedAt);
    return true;
  }

  function finishWithFailure(
    startedAt: number,
    timings: SmartPathfindingDebugTimingEntry[],
    reason?: GraphwarSmartPathfindingRunBuildFailureReason,
  ) {
    let completedAt = options.now();
    options.measureStage(timings, "setting-status", () => {
      completedAt = options.now();
      options.setStatus(options.getFailureMessage(completedAt - startedAt, reason), "error");
      completedAt = options.now();
    });
    options.finishDebugTimings(startedAt, timings, completedAt);
  }

  return {
    run,
  };
}
