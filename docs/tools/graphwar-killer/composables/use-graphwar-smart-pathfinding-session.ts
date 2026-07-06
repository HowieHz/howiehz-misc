import { ref, type Ref } from "vue";

import type { PixelPoint } from "../types";

export type SmartPathfindingStatusKind = "info" | "success" | "warning" | "error";
export type SmartPathfindingPhase = "optimize" | "search" | "trajectory";

/** SVG 线段 DTO，避免模板里重复计算 x1/y1/x2/y2。 */
export interface GraphwarPathfindingLineSegment {
  /** 起点 x。 */
  x1: number;
  /** 终点 x。 */
  x2: number;
  /** 起点 y。 */
  y1: number;
  /** 终点 y。 */
  y2: number;
}

interface GraphwarPathfindingRunnerCancellationAdapter {
  cancel(): void;
}

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

export interface GraphwarSmartPathfindingPreviewSnapshot {
  acceptedEdges: readonly GraphwarPathfindingLineSegment[];
  current?: PixelPoint;
  path: readonly PixelPoint[];
  points: readonly PixelPoint[];
}

export interface GraphwarSmartPathfindingSessionController {
  activePhase: Ref<SmartPathfindingPhase>;
  blockedPoint: Ref<PixelPoint | undefined>;
  cancel: (showStatus: boolean) => boolean;
  clearBlockedPoint: () => void;
  clearPreview: () => void;
  clearSearchPreview: () => void;
  clearStatus: () => void;
  dispose: () => void;
  finishRun: (token: number) => boolean;
  flashBlockedPoint: (point: PixelPoint | undefined) => void;
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
  setSearchPreview: (snapshot: GraphwarSmartPathfindingPreviewSnapshot) => void;
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
  let blockedPointTimer: ReturnType<typeof setTimeout> | undefined;
  let cancelToken = 0;

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

  function isCurrentRun(token: number) {
    return token === cancelToken;
  }

  function finishRun(token: number) {
    if (!isCurrentRun(token)) {
      return false;
    }

    inProgress.value = false;
    clearPreview();
    return true;
  }

  function setStatus(message: string, kind: SmartPathfindingStatusKind) {
    status.value = message;
    statusKind.value = kind;
  }

  function setPhase(phase: SmartPathfindingPhase) {
    activePhase.value = phase;
    updateInProgressStatus();
  }

  function updateInProgressStatus() {
    if (inProgress.value && options.isPathfindingModeActive()) {
      setStatus(options.getInProgressMessage(), "warning");
    }
  }

  function clearStatus() {
    setStatus("", "info");
  }

  function setPreviewPath(points: readonly PixelPoint[]) {
    previewPath.value = [...points];
  }

  function clearSearchPreview() {
    previewAcceptedEdges.value = [];
    previewCurrentPoint.value = undefined;
    previewPoints.value = [];
  }

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

  function clearBlockedPoint() {
    if (blockedPointTimer) {
      clearTimeout(blockedPointTimer);
      blockedPointTimer = undefined;
    }
    blockedPoint.value = undefined;
  }

  function setPreviewConnection(startPoint: PixelPoint, targetPoint: PixelPoint) {
    previewConnection.value = createPathLineSegment(startPoint, targetPoint);
  }

  function setSearchPreview(snapshot: GraphwarSmartPathfindingPreviewSnapshot) {
    previewAcceptedEdges.value = [...snapshot.acceptedEdges];
    previewCurrentPoint.value = snapshot.current;
    previewPoints.value = [...snapshot.points];
    previewPath.value = [...snapshot.path];
  }

  function clearPreview() {
    previewConnection.value = undefined;
    clearSearchPreview();
    previewPath.value = [];
    optimizationPreviewPoint.value = undefined;
    clearBlockedPoint();
  }

  function dispose() {
    clearBlockedPoint();
  }

  return {
    activePhase,
    blockedPoint,
    cancel,
    clearBlockedPoint,
    clearPreview,
    clearSearchPreview,
    clearStatus,
    dispose,
    finishRun,
    flashBlockedPoint,
    inProgress,
    isCurrentRun,
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

/** 创建 SVG 线段 DTO。 */
function createPathLineSegment(startPoint: PixelPoint, targetPoint: PixelPoint): GraphwarPathfindingLineSegment {
  return {
    x1: startPoint.x,
    y1: startPoint.y,
    x2: targetPoint.x,
    y2: targetPoint.y,
  };
}
