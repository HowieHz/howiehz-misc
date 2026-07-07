import type { GraphwarKillerLocale } from "../../locale-types";
import type { GraphwarOneClickClearSearchPreflightFailureReason } from "../../pathfinding/one-click-clear/input";
import type { GraphwarOneClickClearFailureReason } from "../../pathfinding/one-click-clear/search";
import { formatElapsedDuration } from "./duration";

export type GraphwarPathfindingPhase = "optimize" | "search" | "trajectory";

export interface GraphwarPathfindingStatusMessage {
  /** 状态等级；一键清图预检只需要阻塞错误和可恢复警告。 */
  kind: "error" | "warning";
  /** 已本地化的状态文案。 */
  message: string;
}

interface GraphwarOneClickClearPreflightFailureStatusInput {
  /** 智能寻路不可用时的兜底文案，应只在 invalid-settings 需要时求值。 */
  getDisabledMessage: () => string;
  /** 页面当前本地化文案。 */
  locale: GraphwarKillerLocale;
  /** 一键清图预检失败原因。 */
  reason: GraphwarOneClickClearSearchPreflightFailureReason;
  /** 当前参数校验文案；存在时应优先展示。 */
  settingsMessage: string;
}

interface GraphwarOneClickClearFailureMessageInput {
  /** 本次运行耗时，单位毫秒。 */
  elapsedMs: number;
  /** 页面当前本地化文案。 */
  locale: GraphwarKillerLocale;
  /** 一键清图失败原因。 */
  reason: GraphwarOneClickClearFailureReason;
}

interface GraphwarOneClickClearSuccessMessageInput {
  /** 本次运行耗时，单位毫秒。 */
  elapsedMs: number;
  /** 页面当前本地化文案。 */
  locale: GraphwarKillerLocale;
  /** 结果是否来自页面侧完整结果缓存。 */
  resultCacheHit: boolean;
  /** 本次一键清图命中的目标数量。 */
  targetCount: number;
}

/** 一键清图预检 reason 应在 presentation 层映射成用户状态，避免 pathfinding Module 依赖 locale。 */
export function createOneClickClearPreflightFailureStatus(
  input: GraphwarOneClickClearPreflightFailureStatusInput,
): GraphwarPathfindingStatusMessage {
  if (input.reason === "invalid-settings") {
    return {
      kind: "error",
      message: input.settingsMessage || input.getDisabledMessage(),
    };
  }
  if (input.reason === "unsupported-mode") {
    return {
      kind: "warning",
      message: input.locale.smartPathfinding.oneClickClear.unsupported,
    };
  }
  if (input.reason === "missing-current-path") {
    return {
      kind: "warning",
      message: input.locale.smartPathfinding.oneClickClear.needCurrentPath,
    };
  }
  return {
    kind: "error",
    message: createSmartPathfindingFailureMessage(input.locale),
  };
}

/** 一键清图失败原因应使用独立文案，避免和单目标智能寻路失败混在一起。 */
export function createOneClickClearFailureMessage(input: GraphwarOneClickClearFailureMessageInput) {
  const elapsed = formatElapsedDuration(input.elapsedMs);
  if (input.reason === "no-candidate") {
    return input.locale.smartPathfinding.oneClickClear.noCandidate;
  }
  if (input.reason === "preflight-blocked") {
    return createSmartPathfindingCurrentPathBlockedMessage(input.locale);
  }
  if (input.reason === "unsupported") {
    return input.locale.smartPathfinding.oneClickClear.unsupported;
  }
  if (input.reason === "pathfinding-worker-failed") {
    return input.locale.smartPathfinding.oneClickClear.pathfindingWorkerFailed(elapsed);
  }
  return input.locale.smartPathfinding.oneClickClear.noUsableTarget(elapsed);
}

/** 一键清图成功文案应统一复用状态栏耗时格式。 */
export function createOneClickClearSuccessMessage(input: GraphwarOneClickClearSuccessMessageInput) {
  return input.locale.smartPathfinding.oneClickClear.success(
    input.targetCount,
    formatElapsedDuration(input.elapsedMs),
    input.resultCacheHit,
  );
}

/** 返回智能寻路失败文案，可附带耗时。 */
export function createSmartPathfindingFailureMessage(locale: GraphwarKillerLocale, elapsedMs?: number) {
  return locale.smartPathfinding.failure(elapsedMs === undefined ? undefined : formatElapsedDuration(elapsedMs));
}

/** 返回当前路径尚未到达最后路径点时的寻路拦截文案。 */
export function createSmartPathfindingCurrentPathBlockedMessage(locale: GraphwarKillerLocale) {
  return locale.smartPathfinding.currentPathBlocked;
}

/** 返回智能寻路成功文案，可附带耗时。 */
export function createSmartPathfindingSuccessMessage(
  locale: GraphwarKillerLocale,
  elapsedMs?: number,
  resultCacheHit = false,
) {
  return locale.smartPathfinding.success(
    elapsedMs === undefined ? undefined : formatElapsedDuration(elapsedMs),
    resultCacheHit,
  );
}

/** 根据当前阶段生成智能寻路进行中文案。 */
export function createSmartPathfindingInProgressMessage(locale: GraphwarKillerLocale, phase: GraphwarPathfindingPhase) {
  const phaseText =
    phase === "search"
      ? locale.smartPathfinding.inProgress.search
      : phase === "trajectory"
        ? locale.smartPathfinding.inProgress.trajectory
        : locale.smartPathfinding.inProgress.optimize;
  return `${phaseText}${locale.smartPathfinding.inProgress.stopSuffix}`;
}

/** 返回智能寻路取消文案。 */
export function createSmartPathfindingCancelledMessage(locale: GraphwarKillerLocale) {
  return locale.smartPathfinding.cancelled;
}
