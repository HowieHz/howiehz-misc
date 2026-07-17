import { ref, type Ref } from "vue";

import type { PixelPoint } from "../../../core/types";
import {
  createGraphwarPathfindingLineSegment,
  type GraphwarPathfindingLineSegment,
  type GraphwarPathfindingPreviewSnapshot,
} from "../../../pathfinding/smart/preview";

export type SmartPathfindingStatusKind = "info" | "success" | "warning" | "error";
export type SmartPathfindingPhase = "optimize" | "search" | "trajectory";

/** 寻路会话取消底层 runner 所需的最小接口。 */
interface GraphwarPathfindingRunnerCancellationAdapter {
  cancel(): void;
}

/** 智能寻路会话所需的 runner、状态文案与预览依赖。 */
export interface GraphwarSmartPathfindingSessionOptions {
  /** 撞击点闪烁持续时间。 */
  blockedPointFlashMs: number;
  /** 当前是否仍在智能寻路模式；用于进行中文案刷新。 */
  isPathfindingModeActive: () => boolean;
  /** 当前路径状态，启动寻路时会按原页面语义清空。 */
  pathStatus: Ref<string>;
  /** Pathfinding worker runner；session 只负责取消，不负责业务请求。 */
  pathfindingRunner: GraphwarPathfindingRunnerCancellationAdapter;
  /** 取消文案。 */
  getCancelledMessage: () => string;
  /** 进行中文案。 */
  getInProgressMessage: () => string;
}

/** 隔离寻路换代、取消、状态与预览生命周期的控制器。 */
export interface GraphwarSmartPathfindingSessionController {
  activePhase: Ref<SmartPathfindingPhase>;
  blockedPoint: Ref<PixelPoint | undefined>;
  blockedSegment: Ref<GraphwarPathfindingLineSegment | undefined>;
  cancel: (showStatus: boolean) => boolean;
  clearBlockedPoint: () => void;
  clearPreview: () => void;
  clearSearchPreview: () => void;
  clearStatus: () => void;
  dispose: () => void;
  finishRun: (token: number) => boolean;
  flashBlockedPoint: (point: PixelPoint | undefined) => void;
  flashBlockedSegment: (start: PixelPoint | undefined, end: PixelPoint | undefined) => void;
  inProgress: Ref<boolean>;
  isCurrentRun: (token: number) => boolean;
  optimizationPreviewPoint: Ref<PixelPoint | undefined>;
  previewAcceptedEdges: Ref<GraphwarPathfindingLineSegment[]>;
  previewConnection: Ref<GraphwarPathfindingLineSegment | undefined>;
  previewCurrentPoint: Ref<PixelPoint | undefined>;
  previewPath: Ref<PixelPoint[]>;
  previewPoints: Ref<PixelPoint[]>;
  setPhase: (phase: SmartPathfindingPhase) => void;
  setPreviewConnection: (startPoint: PixelPoint, targetPoint: PixelPoint) => void;
  setPreviewPath: (points: readonly PixelPoint[]) => void;
  setSearchPreview: (snapshot: GraphwarPathfindingPreviewSnapshot) => void;
  setStatus: (message: string, kind: SmartPathfindingStatusKind) => void;
  start: (message?: string) => number;
  status: Ref<string>;
  statusKind: Ref<SmartPathfindingStatusKind>;
  updateInProgressStatus: () => void;
}

/** 管理智能寻路和一键清图共享的运行状态、取消 token 与预览层。 */
export function useGraphwarSmartPathfindingSession(
  options: GraphwarSmartPathfindingSessionOptions,
): GraphwarSmartPathfindingSessionController {
  const inProgress = ref(false);
  const activePhase = ref<SmartPathfindingPhase>("search");
  const status = ref("");
  const statusKind = ref<SmartPathfindingStatusKind>("info");
  const previewConnection = ref<GraphwarPathfindingLineSegment>();
  const previewAcceptedEdges = ref<GraphwarPathfindingLineSegment[]>([]);
  const previewCurrentPoint = ref<PixelPoint>();
  const previewPoints = ref<PixelPoint[]>([]);
  const previewPath = ref<PixelPoint[]>([]);
  const optimizationPreviewPoint = ref<PixelPoint>();
  const blockedPoint = ref<PixelPoint>();
  const blockedSegment = ref<GraphwarPathfindingLineSegment>();
  let blockedPointTimer: ReturnType<typeof setTimeout> | undefined;
  let cancelToken = 0;

  /** 取消旧 runner，换代 token，并启动新的权威寻路会话。 */
  function start(message?: string) {
    options.pathfindingRunner.cancel();
    cancelToken += 1;
    inProgress.value = true;
    activePhase.value = "search";
    clearPreview();
    options.pathStatus.value = "";
    setStatus(message ?? options.getInProgressMessage(), "warning");
    return cancelToken;
  }

  /** 取消活动会话并按需展示用户可见状态。 */
  function cancel(showStatus: boolean) {
    if (!inProgress.value) {
      return false;
    }

    cancelToken += 1;
    options.pathfindingRunner.cancel();
    inProgress.value = false;
    clearPreview();
    if (showStatus) {
      setStatus(options.getCancelledMessage(), "warning");
    }
    return true;
  }

  /** 只允许当前 token 结束会话，过期结果直接丢弃。 */
  function finishRun(token: number) {
    if (token !== cancelToken) {
      return false;
    }

    inProgress.value = false;
    clearActivePreview();
    return true;
  }

  /** 原子更新寻路状态正文和类型。 */
  function setStatus(message: string, kind: SmartPathfindingStatusKind) {
    status.value = message;
    statusKind.value = kind;
  }

  /** 切换活动阶段并刷新进行中文案。 */
  function setPhase(phase: SmartPathfindingPhase) {
    activePhase.value = phase;
    updateInProgressStatus();
  }

  /** 在会话仍活动且页面模式匹配时刷新进行中文案。 */
  function updateInProgressStatus() {
    if (inProgress.value && options.isPathfindingModeActive()) {
      setStatus(options.getInProgressMessage(), "warning");
    }
  }

  /** 清空寻路状态正文并恢复普通类型。 */
  function clearStatus() {
    setStatus("", "info");
  }

  /** 发布当前预览路径的独立副本。 */
  function setPreviewPath(points: readonly PixelPoint[]) {
    previewPath.value = [...points];
  }

  /** 清空搜索候选、当前位置和已接受边。 */
  function clearSearchPreview() {
    previewAcceptedEdges.value = [];
    previewCurrentPoint.value = undefined;
    previewPoints.value = [];
  }

  /** 短暂突出单个阻挡点，并覆盖旧计时器。 */
  function flashBlockedPoint(point: PixelPoint | undefined) {
    clearBlockedPoint();
    if (!point) {
      return;
    }

    blockedPoint.value = point;
    blockedPointTimer = setTimeout(() => {
      blockedPoint.value = undefined;
      blockedPointTimer = undefined;
    }, options.blockedPointFlashMs);
  }

  /** 短暂突出阻挡线段，并覆盖旧计时器。 */
  function flashBlockedSegment(start: PixelPoint | undefined, end: PixelPoint | undefined) {
    clearBlockedPoint();
    if (!start || !end) {
      return;
    }

    blockedSegment.value = createGraphwarPathfindingLineSegment(start, end);
    blockedPointTimer = setTimeout(() => {
      blockedSegment.value = undefined;
      blockedPointTimer = undefined;
    }, options.blockedPointFlashMs);
  }

  /** 清空阻挡点和线段反馈。 */
  function clearBlockedPoint() {
    if (blockedPointTimer) {
      clearTimeout(blockedPointTimer);
      blockedPointTimer = undefined;
    }
    blockedPoint.value = undefined;
    blockedSegment.value = undefined;
  }

  /** 发布当前候选起终点连线。 */
  function setPreviewConnection(startPoint: PixelPoint, targetPoint: PixelPoint) {
    previewConnection.value = createGraphwarPathfindingLineSegment(startPoint, targetPoint);
  }

  /** 用不可变快照替换当前搜索预览。 */
  function setSearchPreview(snapshot: GraphwarPathfindingPreviewSnapshot) {
    previewAcceptedEdges.value = [...snapshot.acceptedEdges];
    previewCurrentPoint.value = snapshot.current;
    previewPoints.value = [...snapshot.points];
    previewPath.value = [...snapshot.path];
  }

  /** 清空活动结果和搜索过程的全部预览。 */
  function clearPreview() {
    clearActivePreview();
    clearBlockedPoint();
  }

  /** 结束一次运行只清搜索动画；阻塞反馈由自己的短时定时器收尾。 */
  function clearActivePreview() {
    previewConnection.value = undefined;
    clearSearchPreview();
    previewPath.value = [];
    optimizationPreviewPoint.value = undefined;
  }

  /** 释放 runner、计时器和预览状态。 */
  function dispose() {
    clearBlockedPoint();
  }

  return {
    activePhase,
    blockedPoint,
    blockedSegment,
    cancel,
    clearBlockedPoint,
    clearPreview,
    clearSearchPreview,
    clearStatus,
    dispose,
    finishRun,
    flashBlockedPoint,
    flashBlockedSegment,
    inProgress,
    isCurrentRun: (token: number) => token === cancelToken,
    optimizationPreviewPoint,
    previewAcceptedEdges,
    previewConnection,
    previewCurrentPoint,
    previewPath,
    previewPoints,
    setPhase,
    setPreviewConnection,
    setPreviewPath,
    setSearchPreview,
    setStatus,
    start,
    status,
    statusKind,
    updateInProgressStatus,
  };
}
