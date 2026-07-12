<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import {
  createGraphwarAgentClient,
  createGraphwarAgentShooterViewSnapshot,
  createGraphwarAgentShotRequest,
  createGraphwarAgentWorldSnapshot,
  GRAPHWAR_AGENT_DEFAULT_BASE_URL,
  normalizeGraphwarAgentBaseUrl,
  readGraphwarAgentSnapshot,
  type GraphwarAgentAvailableState,
  type GraphwarAgentClient,
  type GraphwarAgentDetectionBox,
  type GraphwarAgentSnapshot,
  type GraphwarAgentShotPlan,
} from "./controllers/agent/client";
import { useGraphwarDebugActivation } from "./controllers/debug/activation";
import { useGraphwarDebugTimings } from "./controllers/debug/timings";
import {
  useGraphwarDetectionWorkflow,
  type DetectionStatusKind,
  type GraphwarDetectionRunTrigger,
} from "./controllers/detection/workflow";
import {
  createGraphwarManagedController,
  GRAPHWAR_MANAGED_SHOT_DEADLINE_MS,
  type GraphwarManagedController,
  type GraphwarManagedShooter,
} from "./controllers/managed/controller";
import { deriveGraphwarCapabilities, type GraphwarCapabilityReason } from "./controllers/page/capabilities";
import { useGraphwarPathAppendWorkflow } from "./controllers/path/append-workflow";
import { useGraphwarPathPointEditing } from "./controllers/path/point-editing";
import { useGraphwarPathState } from "./controllers/path/state";
import { useGraphwarTrajectoryResult } from "./controllers/path/trajectory-result";
import {
  useGraphwarPathfindingRouteBoundaryInset,
  useGraphwarPathfindingObstacleProjection,
} from "./controllers/pathfinding/obstacles";
import { useGraphwarOneClickClearRunWorkflow } from "./controllers/pathfinding/one-click-clear/workflow";
import { useGraphwarSmartPathfindingBuilder } from "./controllers/pathfinding/smart/builder";
import {
  useGraphwarSmartPathfindingSession,
  type SmartPathfindingStatusKind,
} from "./controllers/pathfinding/smart/session";
import { useGraphwarSmartPathfindingRunWorkflow } from "./controllers/pathfinding/smart/workflow";
import { useGraphwarTargetingContext } from "./controllers/pathfinding/targeting/context";
import { useGraphwarResultActions } from "./controllers/result/actions";
import { useGraphwarScreenshotWorkflow } from "./controllers/screenshot/workflow";
import {
  applyGraphwarManagedFormulaProfileRepairPlan,
  createDefaultGraphwarFormulaProfiles,
  createGraphwarManagedFormulaProfileRepairPlan,
  updateGraphwarFormulaProfile,
} from "./controllers/settings/formula-profiles";
import { useGraphwarSettingsValidation } from "./controllers/settings/validation";
import { useGraphwarStageFeedback } from "./controllers/stage/feedback";
import { useGraphwarStageHitTesting, type GraphwarStageHitTestingController } from "./controllers/stage/hit-testing";
import {
  GRAPHWAR_LIVE_CLICK_PREVIEW_WORKER_COUNT_MAXIMUM,
  useGraphwarLiveClickPreview,
} from "./controllers/stage/live-click-preview";
import { useGraphwarObstacleEditor } from "./controllers/stage/obstacle-editor";
import {
  GRAPHWAR_DEFAULT_X_LIMIT,
  GRAPHWAR_PLANE_GAME_LENGTH,
  GRAPHWAR_PLANE_HEIGHT,
  GRAPHWAR_PLANE_LENGTH,
  GRAPHWAR_SOLDIER_RADIUS,
  GRAPHWAR_SOLDIER_VISIBLE_SIZE,
  GRAPHWAR_VISIBLE_Y_LIMIT,
} from "./core/game/constants";
import { graphToImagePoint, imageToGraphPoint, normalizeBoundsRect } from "./core/geometry";
import {
  DEFAULT_FORMULA_DECIMAL_PLACES,
  MAX_FORMULA_DECIMAL_PLACES,
  clampNumber,
  formatAngleDegree,
  formatDecimal,
  formatDoublePrecisionDecimal,
  parseFiniteNumber,
} from "./core/numbers";
import { nowMs } from "./core/time";
import { graphwarToolDefaults } from "./core/tool/defaults";
import {
  createGraphPoint,
  createPixelPoint,
  type AlgorithmMode,
  type BoundsRect,
  type EquationMode,
  type GraphBounds,
  type GraphPoint,
  type PixelPoint,
  type ToolMode,
  type ToolWorkflowMode,
  type TransferStatus,
} from "./core/types";
import type { GraphwarDetectionBox } from "./detection/objects";
import type { GraphwarKillerLocale } from "./locale-types";
import { GRAPHWAR_DEFAULT_ROUTE_PLANNING_TOLERANCE_PLANE_PIXELS } from "./pathfinding/one-click-clear/search";
import type { GraphwarOneClickClearIncumbent } from "./pathfinding/one-click-clear/search";
import { supportsOneClickClear } from "./pathfinding/one-click-clear/support";
import type { GraphwarPathfindingRouteMode } from "./pathfinding/routing/mode";
import { createGraphwarPathfindingCacheController } from "./pathfinding/runtime/cache";
import { createGraphwarPathfindingRunner } from "./pathfinding/runtime/runner";
import { createGraphwarPathLineSegments, type GraphwarPathfindingLineSegment } from "./pathfinding/smart/preview";
import {
  createBoundsRectWithBoundaryExpansion,
  type GraphwarSmartPathfindingSoldierTarget as SmartPathfindingTarget,
} from "./pathfinding/targeting";
import GraphwarActionPanel, { type GraphwarActionPanelModel } from "./presentation/action/MainPanel.vue";
import GraphwarDetectionPanel, { type GraphwarDetectionPanelModel } from "./presentation/detection/MainPanel.vue";
import GraphwarSmartPathfindingPanel, {
  type GraphwarSmartPathfindingPanelModel,
} from "./presentation/pathfinding/MainPanel.vue";
import GraphwarResultPanel from "./presentation/result/MainPanel.vue";
import GraphwarScreenshotPanel, { type GraphwarScreenshotPanelModel } from "./presentation/screenshot/MainPanel.vue";
import type { GraphwarAdvancedSettingsPanelModel } from "./presentation/settings/advanced-panel-model";
import GraphwarAdvancedSettingsPanel from "./presentation/settings/AdvancedPanel.vue";
import GraphwarSettingsPanel, { type GraphwarSettingsPanelModel } from "./presentation/settings/MainPanel.vue";
import { formatSvgPolylinePoints } from "./presentation/stage/svg-polyline";
import { formatElapsedDuration } from "./presentation/status/duration";
import {
  createHeaderStatus,
  getFirstHeaderStatus,
  getSmartPathfindingHeaderStatus,
} from "./presentation/status/header";
import {
  createOneClickClearFailureMessage,
  createOneClickClearPreflightFailureStatus,
  createOneClickClearSuccessMessage,
  createSmartPathfindingCancelledMessage,
  createSmartPathfindingCurrentPathBlockedMessage,
  createSmartPathfindingFailureMessage,
  createSmartPathfindingInProgressMessage,
  createSmartPathfindingSuccessMessage,
} from "./presentation/status/pathfinding";
import {
  emptyGraphwarScreenshotHeaderStatus,
  getGraphwarScreenshotHeaderStatus,
} from "./presentation/status/screenshot";

/** 截图上的检测框，坐标均为图片像素。 */
type DetectionBox = GraphwarDetectionBox;
/** 舞台背景里的 Graphwar 坐标参考线，坐标均已投影为截图像素。 */
interface StageCoordinateLines {
  /** Graphwar 坐标轴线段。 */
  axisLines: GraphwarPathfindingLineSegment[];
  /** Graphwar 坐标网格线段。 */
  gridLines: GraphwarPathfindingLineSegment[];
}
/** Identifies which input produced the currently displayed recognition data. */
type GraphwarDetectionProvenance =
  | { source: "screenshot" }
  | {
      battleRevision: string;
      gameInstanceId: string;
      normalizedAgentUrl: string;
      source: "agent";
    };
/** Minimal Wake Lock surface used without requiring optional browser typings. */
interface GraphwarWakeLockSentinel {
  release: () => Promise<void>;
}
/** Identifies an asynchronous Wake Lock request across managed-mode lifecycles. */
interface GraphwarWakeLockRequest {
  generation: number;
  promise: Promise<GraphwarWakeLockSentinel>;
}
const { locale } = defineProps<{
  locale: GraphwarKillerLocale;
}>();

const graphwarDefaultXLimitText = formatDoublePrecisionDecimal(GRAPHWAR_DEFAULT_X_LIMIT);
const graphwarVisibleYLimitText = formatDoublePrecisionDecimal(GRAPHWAR_VISIBLE_Y_LIMIT);
const graphwarObstacleToleranceLimit = Math.floor(GRAPHWAR_PLANE_LENGTH / 2);
const graphwarObstacleMaxArea = GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT;
const graphwarBoundsMinimumSizePixels = 4;
const graphwarStageGridAxisEpsilon = 1e-9;
const graphwarStageGridTargetLineCount = 64;
const graphwarStageGridStepMultipliers = [1, 2, 5, 10] as const;
const magnifierMinimumZoom = 1;
const magnifierSliderMaximumZoom = 5;
const magnifierInputMaximumZoom = 100;
const oneClickClearDeleteCheckRadiusMinimumPlanePixels = 0;
// 默认值应对应 Graphwar 原版士兵命中半径 7px 的一半；搜索前再按截图横向比例换算。
const oneClickClearDeleteCheckRadiusDefaultPlanePixels = GRAPHWAR_SOLDIER_RADIUS / 2;
const obstacleBrushMinimumDiameter = 1;
const obstacleBrushSliderMaximumDiameter = 200;
const obstacleBrushInputMaximumDiameter = 1000;
const obstacleBrushEditRefreshDelayMs = 250;
const smartPathfindingBlockedPointFlashMs = 1800;
const graphwarAgentStatusFlashMs = 2000;
const mainObstacleBrushClipPathId = "graphwar-killer-obstacle-brush-clip";
const magnifierObstacleBrushClipPathId = "graphwar-killer-magnifier-obstacle-brush-clip";
// 页面状态按未来可抽工作流分区维护：基础舞台、公式设置、截图、识别、障碍编辑、寻路。
const boundsRect = ref<BoundsRect>({ ...graphwarToolDefaults.boundsRect });
// boundsRect 会保留上一次矩形数值；boundsReady 表示该矩形已在当前截图上被用户或识别流程确认。
const boundsReady = ref(false);
const activeBoundsReady = computed(() => boundsReady.value && isUsableBoundsRect(boundsRect.value));
const boundsFirstPoint = ref<PixelPoint>();
const pointerPreviewPoint = ref<PixelPoint>();
const magnifierEnabled = ref(false);
const magnifierZoomText = ref(String(graphwarToolDefaults.magnifierZoom));
const magnifierPoint = ref<PixelPoint>();
const toolMode = ref<ToolMode>("bounds");
const toolWorkflowMode = ref<ToolWorkflowMode>("solver");
const solverEquationMode = ref<EquationMode>("y");
const simulatorEquationMode = ref<EquationMode>("y");
const equationMode = computed<EquationMode>({
  get: () => (toolWorkflowMode.value === "simulator" ? simulatorEquationMode.value : solverEquationMode.value),
  set: (mode) => {
    if (toolWorkflowMode.value === "simulator") {
      simulatorEquationMode.value = mode;
    } else {
      solverEquationMode.value = mode;
    }
  },
});
const solverFormulaProfiles = ref(createDefaultGraphwarFormulaProfiles());
const algorithmMode = computed<AlgorithmMode>({
  get: () => solverFormulaProfiles.value[solverEquationMode.value].algorithm,
  set: (algorithm) => {
    solverFormulaProfiles.value = updateGraphwarFormulaProfile(solverFormulaProfiles.value, solverEquationMode.value, {
      algorithm,
    });
  },
});
const minXText = ref(`-${graphwarDefaultXLimitText}`);
const maxXText = ref(graphwarDefaultXLimitText);
const minYText = ref(`-${graphwarVisibleYLimitText}`);
const maxYText = ref(graphwarVisibleYLimitText);
const steepnessText = ref(String(graphwarToolDefaults.steepness));
const stepOverflowProtectionEnabled = ref(true);
const stepGlitchModeEnabled = computed({
  get: () => solverFormulaProfiles.value.dy.stepGlitchModeEnabled,
  set: (enabled: boolean) => {
    solverFormulaProfiles.value = updateGraphwarFormulaProfile(solverFormulaProfiles.value, "dy", {
      stepGlitchModeEnabled: enabled,
    });
  },
});
// 邪道偏好独立保存在 y' profile；只有当前 Step y' 才改变求解与寻路语义。
const effectiveStepGlitchModeEnabled = computed(
  () => algorithmMode.value === "step" && solverEquationMode.value === "dy" && stepGlitchModeEnabled.value,
);
const precisionText = ref(String(DEFAULT_FORMULA_DECIMAL_PLACES));
const advancedSettingsVisible = ref(false);
const simulatorSkipUnknownCharacters = ref(true);
const simulatorParseDerivativeAsY = ref(true);
const obstacleMinAreaText = ref(String(graphwarToolDefaults.obstacleMinArea));
const maximumSoldierCountText = ref(String(graphwarToolDefaults.maximumSoldierCount));
const soldierTemplateCandidateTopRatioText = ref(String(graphwarToolDefaults.soldierTemplateCandidateTopRatio));
const templateMatchingWorkerCountText = ref(String(graphwarToolDefaults.templateMatchingWorkerCount));
const pathfindingWorkerCountText = ref(String(graphwarToolDefaults.pathfindingWorkerCount));
const liveClickPreviewWorkerCountText = ref(String(graphwarToolDefaults.liveClickPreviewWorkerCount));
// 截图识别需要默认安全距离吸收像素误差；Agent 返回精确障碍，默认不额外外扩。
const detectionRoutePlanningToleranceText = ref(String(GRAPHWAR_DEFAULT_ROUTE_PLANNING_TOLERANCE_PLANE_PIXELS));
const detectionObstacleSimulationToleranceText = ref("1");
const graphwarAgentRoutePlanningToleranceText = ref("1");
const graphwarAgentObstacleSimulationToleranceText = ref("0");
const oneClickClearDeleteCheckRadiusText = ref(String(oneClickClearDeleteCheckRadiusDefaultPlanePixels));
const simulatorFormulaText = ref("");
const simulatorLaunchAngleText = ref("");
const graphwarAgentEnabled = ref(false);
const graphwarAgentBaseUrlText = ref(GRAPHWAR_AGENT_DEFAULT_BASE_URL);
const graphwarAgentReadInProgress = ref(false);
let graphwarAgentReadGeneration = 0;
const graphwarAgentFireInProgress = ref(false);
const graphwarAgentFireStatus = ref<TransferStatus>("idle");
const graphwarAgentFireFailureMessage = ref("");
const graphwarManagedModeEnabled = ref(false);
let graphwarManagedModeConfirmed = false;
let graphwarAgentFireStatusTimer: ReturnType<typeof setTimeout> | undefined;
let graphwarManagedCalculationStatus:
  | { expiresAt: number; kind: SmartPathfindingStatusKind; message: string }
  | undefined;
let graphwarManagedCalculationStatusTimer: ReturnType<typeof setTimeout> | undefined;
let graphwarManagedClient: GraphwarAgentClient | undefined;
let graphwarManagedController: GraphwarManagedController | undefined;
let graphwarManagedDeadlineTurnToken: string | undefined;
let graphwarManagedIncumbent: GraphwarOneClickClearIncumbent | undefined;
let graphwarManagedLastSubmittedTurnToken: string | undefined;
let graphwarManagedSceneKey = "";
let graphwarManagedSearchGeneration = 0;
let graphwarManagedSearchStartedAt: number | undefined;
let graphwarManagedSearchState: "idle" | "running" | "success" | "failure" = "idle";
let graphwarManagedStatusKind: SmartPathfindingStatusKind = "warning";
let graphwarManagedStatusMessage = "";
let graphwarManagedWakeLock: GraphwarWakeLockSentinel | undefined;
let graphwarManagedWakeLockGeneration = 0;
let graphwarManagedWakeLockRequest: GraphwarWakeLockRequest | undefined;
const normalizedGraphwarAgentBaseUrl = computed(() => {
  if (!graphwarAgentEnabled.value || !graphwarAgentBaseUrlText.value.trim()) {
    return undefined;
  }
  try {
    return normalizeGraphwarAgentBaseUrl(graphwarAgentBaseUrlText.value).toString();
  } catch {
    return undefined;
  }
});
const activeRoutePlanningToleranceText = computed({
  get: () =>
    graphwarAgentEnabled.value
      ? graphwarAgentRoutePlanningToleranceText.value
      : detectionRoutePlanningToleranceText.value,
  set: (value) => {
    if (graphwarAgentEnabled.value) {
      graphwarAgentRoutePlanningToleranceText.value = value;
    } else {
      detectionRoutePlanningToleranceText.value = value;
    }
  },
});
const activeObstacleSimulationToleranceText = computed({
  get: () =>
    graphwarAgentEnabled.value
      ? graphwarAgentObstacleSimulationToleranceText.value
      : detectionObstacleSimulationToleranceText.value,
  set: (value) => {
    if (graphwarAgentEnabled.value) {
      graphwarAgentObstacleSimulationToleranceText.value = value;
    } else {
      detectionObstacleSimulationToleranceText.value = value;
    }
  },
});
let graphwarAgentImageLoadBypassUrl = "";
// 路径状态已独立在 composable 中；页面只负责把当前工作流模式和交互事件接进去。
const {
  applyValidatedPath: applyValidatedPathState,
  clearActivePath: clearActivePathState,
  clearAllModePaths: clearAllPathState,
  clearPathInteractionState,
  commitTarget,
  committedTargets,
  draggingPathPointIndex,
  finishPathPointCoordinateEdit: finishPathPointCoordinateEditState,
  getPathPointCoordinateText: getPathPointCoordinateTextState,
  hoveredPathPointIndex,
  pathPixels,
  pathStatus,
  removeActivePathPoint,
  setPathPointCoordinateText,
  simulatorPathPixels,
  simulatorTrajectoryStrokeColor,
  solverPathPixels,
  solverTrajectoryStrokeColor,
  startPathPointCoordinateEdit: startPathPointCoordinateEditState,
  syncPathPointCoordinateTexts: syncPathPointCoordinateTextState,
  trajectoryStrokeColor,
  undoActivePathPoint,
} = useGraphwarPathState(toolWorkflowMode);
// 截图工作流拥有文件输入、粘贴、截屏和舞台坐标换算；识别流程只消费落地后的 ImageData。
const {
  applyGeneratedImage,
  captureScreenImage,
  getImageDataFromCurrentImage,
  getImagePointFromEvent,
  handleDrop,
  handleImageLoad,
  handleImageUpload,
  handlePaste,
  imageHeight,
  imageName,
  imageRef,
  imageStatus,
  imageUrl,
  imageWidth,
  invalidatePendingUserImageRequests,
  normalizeBoundsPickerPoint,
  stageDisplayHeight,
  stageDisplayWidth,
  stageRef,
} = useGraphwarScreenshotWorkflow({
  imageText: locale.status.image,
  onImageApplied: handleAppliedScreenshot,
  onImageLoaded: handleLoadedScreenshot,
});
const graphwarPathfindingRunner = createGraphwarPathfindingRunner();
const pathfindingCache = createGraphwarPathfindingCacheController();
// 识别结果应由页面持有，供舞台投影、目标过滤、友方障碍和一键清图共享。
const detectedSoldiers = ref<DetectionBox[]>([]);
const detectionProvenance = ref<GraphwarDetectionProvenance>();
const hoveredDetectedSoldierId = ref<string>();
const pathPlanningEnabled = ref(false);
// undefined 表示用户尚未选择；首次得到对应数据时才应用一次默认开启。
const snapSoldiersPreference = ref<boolean>();
const collisionCheckPreference = ref<boolean>();
const snapSoldiersEnabled = computed(() => snapSoldiersPreference.value ?? false);
const collisionCheckEnabled = computed(() => collisionCheckPreference.value ?? false);
const friendlyFireEnabled = ref(false);
const obstacleBrushDiameterText = ref("30");
const searchAnimationEnabled = ref(true);
const pathfindingRouteMode = ref<GraphwarPathfindingRouteMode>("visibility-graph");
const deleteOptimizationEnabled = ref(false);
let activePathfindingTask:
  | { readonly kind: "single" }
  | { readonly kind: "one-click"; readonly usesDagWorker: boolean }
  | undefined;
// 智能寻路和一键清图共用同一组运行状态、预览层和取消 token，避免两个异步任务同时回写页面。
const smartPathfindingSession = useGraphwarSmartPathfindingSession({
  blockedPointFlashMs: smartPathfindingBlockedPointFlashMs,
  getCancelledMessage: () => createSmartPathfindingCancelledMessage(locale),
  getInProgressMessage: () => getSmartPathfindingInProgressMessage(),
  isPathfindingModeActive: () => effectiveSmartPathfindingEnabled.value,
  pathStatus,
  pathfindingRunner: graphwarPathfindingRunner,
});
const {
  activePhase: activeSmartPathfindingPhase,
  blockedPoint: smartPathfindingBlockedPoint,
  blockedSegment: smartPathfindingBlockedSegment,
  inProgress: smartPathfindingInProgress,
  optimizationPreviewPoint: pathfindingOptimizationPreviewPoint,
  previewAcceptedEdges: smartPathfindingPreviewAcceptedEdges,
  previewConnection: smartPathfindingPreviewConnection,
  previewCurrentPoint: smartPathfindingPreviewCurrentPoint,
  previewPath: smartPathfindingPreviewPath,
  previewPoints: smartPathfindingPreviewPoints,
  status: smartPathfindingStatus,
  statusKind: smartPathfindingStatusKind,
} = smartPathfindingSession;
// 调试耗时应只管理阶段计时、聚合和展示行规则；业务流程计时点应由页面决定。
const {
  addSmartPathfindingWorkerTimings,
  appendOneClickClearSearchWorkerTimings,
  clearSmartPathfindingDebugTimings,
  createDetectionDebugTimingEntriesFromWorker,
  detectionDebugTimingRows,
  finishDetectionDebugTimings,
  finishSmartPathfindingDebugTimings,
  measureDetectionDebugStage,
  measureSmartPathfindingDebugStage,
  measureSmartPathfindingDebugStageAsync,
  smartPathfindingDebugTimingRows,
} = useGraphwarDebugTimings({
  getLocale: () => locale,
  isDetectionRunActive: isActiveDetectionRun,
});
// 单目标寻路 builder 应集中 worker 输入、cache 和预览映射；页面只按职责注入当前状态入口。
const smartPathfindingBuilder = useGraphwarSmartPathfindingBuilder({
  debug: {
    addWorkerTimings: addSmartPathfindingWorkerTimings,
  },
  effects: {
    flashBlockedPoint: smartPathfindingSession.flashBlockedPoint,
    flashBlockedSegment: smartPathfindingSession.flashBlockedSegment,
  },
  input: {
    boundsRect,
    getBounds: () => (parsedBounds.value.ok ? parsedBounds.value.bounds : undefined),
    getCommittedTargets: () => committedTargets.value,
    getDeleteOptimizationEnabled: () => deleteOptimizationEnabled.value,
    getFormulaSettings: () => createPathTrajectoryFormulaSettings(),
    getObstacleMask: () => smartPathfindingBaseObstacleMask.value,
    getPathPixels: () => pathPixels.value,
    getPrefixTarget: createCurrentPrefixTargetCircle,
    getRouteMode: getPathfindingRouteMode,
    getSimulationMask: () => simulationObstacleMask.value,
    getTargetHitRadiusPixels: () => soldierHitRadiusPixels.value,
    getTolerances: () => (parsedObstacleTolerances.value.ok ? parsedObstacleTolerances.value : undefined),
  },
  pathfinding: {
    cache: pathfindingCache,
    runner: graphwarPathfindingRunner,
  },
  preview: {
    isSearchAnimationEnabled: () => searchAnimationEnabled.value,
    setConnection: smartPathfindingSession.setPreviewConnection,
    setPath: smartPathfindingSession.setPreviewPath,
    setSearch: smartPathfindingSession.setSearchPreview,
  },
  run: {
    enterSearchPhase: () => smartPathfindingSession.setPhase("search"),
    isCurrent: isSmartPathfindingRunCurrent,
  },
});
// 单目标寻路 workflow 应集中维护 token、状态和调试耗时顺序；worker 细节由 builder 持有。
const smartPathfindingRunWorkflow = useGraphwarSmartPathfindingRunWorkflow<PixelPoint | SmartPathfindingTarget>({
  applyPath: setPathPixels,
  buildPath: smartPathfindingBuilder.buildPath,
  clearDebugTimings: clearSmartPathfindingDebugTimings,
  finishDebugTimings: finishSmartPathfindingDebugTimings,
  finishRun: finishSmartPathfindingRun,
  getFailureMessage: (elapsedMs, reason) => createSmartPathfindingFailureMessage(locale, elapsedMs, reason),
  getSuccessMessage: (elapsedMs, resultCacheHit) =>
    createSmartPathfindingSuccessMessage(locale, elapsedMs, resultCacheHit),
  isRunCurrent: isSmartPathfindingRunCurrent,
  measureStage: measureSmartPathfindingDebugStage,
  now: nowMs,
  setStatus: setSmartPathfindingStatus,
  startRun: startSmartPathfinding,
});
// 舞台反馈只应持有短暂高亮状态和清理逻辑；页面应决定触发时机。
const {
  boundsFlashActive,
  clearDetectionSoldierFlash,
  clearOneClickClearHitFlash,
  detectionSoldierFlashActive,
  dispose: disposeStageFeedback,
  flashBoundsRect,
  flashDetectedSoldiers,
  flashOneClickClearHitSoldiers,
  oneClickClearHitFlashActive,
  oneClickClearHitFlashSoldiers,
} = useGraphwarStageFeedback(detectedSoldiers);
// 障碍编辑只应管理 mask、baseline、笔刷手势和延迟统计；页面应维护模式分派和寻路语义。
const {
  applyDetectedObstacles,
  brushDragging: obstacleBrushDragging,
  brushEraseEnabled: obstacleBrushEraseEnabled,
  brushPointerPoint: obstacleBrushPointerPoint,
  clear: clearObstacleEditor,
  clearInteractionState: clearObstacleBrushInteractionState,
  dispose: disposeObstacleEditor,
  editsDirty: obstacleEditsDirty,
  finishBrushDrag: finishObstacleBrushDrag,
  obstacles: detectedObstacles,
  paintBrushAtPoint: paintObstacleBrushAtPoint,
  resetEdits: resetObstacleEdits,
  startBrushDrag: startObstacleBrushDrag,
  toggleBrushErase: toggleObstacleBrushErase,
  updateBrushPreview: updateObstacleBrushPreview,
} = useGraphwarObstacleEditor({
  boundsRect,
  editRefreshDelayMs: obstacleBrushEditRefreshDelayMs,
  getBrushDiameter: () =>
    parsedObstacleBrushDiameter.value.ok ? parsedObstacleBrushDiameter.value.diameter : undefined,
  getEditsAppliedMessage: (count) => locale.status.detection.obstacleEditsApplied(count),
  getEditsClearedMessage: (count) => locale.status.detection.obstacleEditsCleared(count),
  getUpdatingEditsMessage: () => locale.status.detection.updatingObstacleEdits,
  invalidateObstacleCaches: invalidatePathfindingCaches,
  prepareObstacleEdit: () => {
    cancelSmartPathfinding(false);
    clearSmartPathfindingStatus();
  },
  setStatus: setDetectionStatus,
});
const objectDetectionReady = computed(() => activeBoundsReady.value && Boolean(detectedObstacles.value));
const activeObjectDetectionReady = computed(() => {
  if (!objectDetectionReady.value) {
    return false;
  }
  if (!graphwarAgentEnabled.value) {
    return detectionProvenance.value?.source === "screenshot";
  }
  const provenance = detectionProvenance.value;
  if (provenance?.source !== "agent") {
    return false;
  }
  try {
    return provenance.normalizedAgentUrl === normalizeGraphwarAgentBaseUrl(graphwarAgentBaseUrlText.value).toString();
  } catch {
    return false;
  }
});
// 检测 workflow 应持有异步运行、状态绘制、debounce 和 worker 生命周期；跨 workflow 副作用由页面注入。
const detectionWorkflow = useGraphwarDetectionWorkflow({
  boundsRect,
  debug: {
    createTimingEntriesFromWorker: createDetectionDebugTimingEntriesFromWorker,
    finishTimings: finishDetectionDebugTimings,
    measureStage: measureDetectionDebugStage,
  },
  detectedSoldiers,
  effects: {
    applyDetectedObstacles,
    clearDetectedObjectSideEffects: () => {
      clearDetectionSoldierFlash();
      clearOneClickClearHitFlash();
      clearObstacleEditor();
      detectionProvenance.value = undefined;
      hoveredDetectedSoldierId.value = undefined;
    },
    clearSmartPathfindingStatus,
    flashBoundsRect,
    flashDetectedSoldiers,
    invalidatePathfindingCaches,
    applyDetectedBounds,
    markScreenshotResult: () => {
      detectionProvenance.value = { source: "screenshot" };
    },
    setToolModeToPath: () => {
      toolMode.value = "path";
    },
  },
  formatElapsedDuration,
  getLocale: () => locale,
  getSettings: () => parsedDetectionSettings.value,
  hasActiveBounds: () => activeBoundsReady.value,
  image: {
    canSchedule: () => Boolean(imageUrl.value),
    getImageData: getImageDataFromCurrentImage,
    isReady: () => Boolean(imageRef.value && imageUrl.value),
  },
});
const {
  autoDetectionEnabled,
  inProgress: detectionInProgress,
  status: detectionStatus,
  statusKind: detectionStatusKind,
  statusWarning: detectionStatusWarning,
  statusWarningTitle: detectionStatusWarningTitle,
} = detectionWorkflow;
// 调试启用流程只应管理长按状态和定时器；高级设置展开状态仍由页面持有。
const {
  cancelHold: cancelDebugActivationHold,
  debugInfoEnabled,
  dispose: disposeDebugActivation,
  finishHold: finishDebugActivationHold,
  remainingMs: debugActivationRemainingMs,
  startHold: startDebugActivationHold,
  successVisible: debugActivationSuccessVisible,
} = useGraphwarDebugActivation({
  toggleAdvancedSettings,
});
const effectiveSmartPathfindingEnabled = computed(
  () =>
    toolWorkflowMode.value !== "simulator" &&
    pathPlanningEnabled.value &&
    activeObjectDetectionReady.value &&
    !settingsMessage.value &&
    parsedObstacleTolerances.value.ok,
);
const pathfindingObstacleEdgesActive = computed(() => effectiveSmartPathfindingEnabled.value);
const includesFriendlySoldierObstacles = computed(() => !friendlyFireEnabled.value && pathPixels.value.length > 0);
const blocksFriendlyFireTargets = computed(
  () => pathfindingObstacleEdgesActive.value && includesFriendlySoldierObstacles.value,
);

const equationModes = computed(() => locale.equationModes);
const toolWorkflowModes = computed(() => locale.toolWorkflowModes);
const algorithmModes = computed(() => locale.algorithmModes);

// 设置校验应集中维护输入解析、错误优先级和上限约束；页面应只消费解析结果。
const {
  parsedBounds,
  parsedDetectionSettings,
  parsedMagnifierZoom,
  parsedObstacleBrushDiameter,
  parsedOneClickClearTolerances,
  parsedObstacleTolerances,
  parsedPathfindingWorkerCount,
  parsedPrecision,
  parsedSteepness,
} = useGraphwarSettingsValidation({
  getLocale: () => locale,
  inputs: {
    bounds: {
      maxXText,
      maxYText,
      minXText,
      minYText,
    },
    detection: {
      maximumSoldierCountText,
      obstacleMinAreaText,
      soldierTemplateCandidateTopRatioText,
      templateMatchingWorkerCountText,
    },
    formula: {
      precisionText,
      steepnessText,
    },
    magnifier: {
      zoomText: magnifierZoomText,
    },
    obstacleBrush: {
      diameterText: obstacleBrushDiameterText,
    },
    pathfinding: {
      oneClickClearDeleteCheckRadiusText,
      routePlanningToleranceText: activeRoutePlanningToleranceText,
      simulationToleranceText: activeObstacleSimulationToleranceText,
      workerCountText: pathfindingWorkerCountText,
    },
  },
  limits: {
    detection: {
      obstacleMaximumArea: graphwarObstacleMaxArea,
    },
    magnifier: {
      inputMaximumZoom: magnifierInputMaximumZoom,
      minimumZoom: magnifierMinimumZoom,
    },
    obstacleBrush: {
      inputMaximumDiameter: obstacleBrushInputMaximumDiameter,
      minimumDiameter: obstacleBrushMinimumDiameter,
    },
    pathfinding: {
      deleteCheckRadiusMinimumPlanePixels: oneClickClearDeleteCheckRadiusMinimumPlanePixels,
      obstacleToleranceLimit: graphwarObstacleToleranceLimit,
    },
  },
});
const effectiveOneClickClearTolerances = computed(() => {
  if (deleteOptimizationEnabled.value) {
    return parsedOneClickClearTolerances.value.ok ? parsedOneClickClearTolerances.value : undefined;
  }
  const tolerances = parsedObstacleTolerances.value;
  return tolerances.ok ? { ...tolerances, oneClickClearDeleteCheckRadiusPlanePixels: 0 } : undefined;
});

function getGraphwarPlaneRadiusPixels(sourceRadius: number) {
  if (!parsedBounds.value.ok) {
    return undefined;
  }

  const graphWidth = Math.abs(parsedBounds.value.bounds.maxX - parsedBounds.value.bounds.minX);
  if (graphWidth <= 0) {
    return undefined;
  }

  return ((sourceRadius * GRAPHWAR_PLANE_GAME_LENGTH) / GRAPHWAR_PLANE_LENGTH / graphWidth) * boundsRect.value.width;
}

/** Agent 士兵按权威队伍动态判断敌我；截图识别返回 undefined 继续使用 x 范围规则。 */
function getGraphwarAgentFriendlyState(soldier: DetectionBox) {
  return soldier.templateName === "agent" ? (soldier as GraphwarAgentDetectionBox).friendly : undefined;
}

const mappedPathPoints = computed<GraphPoint[]>(() => {
  const boundsResult = parsedBounds.value;
  if (!boundsResult.ok) {
    return [];
  }
  return pathPixels.value.map((point) => imageToGraphPoint(point, boundsResult.bounds, boundsRect.value));
});
// 路径点编辑应集中坐标输入、拖拽落点和删除规则；页面应提供全局副作用入口。
const {
  finishPathPointCoordinateEdit,
  getPathPointCoordinateText,
  handlePathPointCoordinateInput,
  removePathPoint,
  setPathPoint,
  startPathPointCoordinateEdit,
  syncPathPointCoordinateTexts,
} = useGraphwarPathPointEditing({
  boundsRect,
  coordinateState: {
    finishPathPointCoordinateEdit: finishPathPointCoordinateEditState,
    getPathPointCoordinateText: getPathPointCoordinateTextState,
    removeActivePathPoint,
    setPathPointCoordinateText,
    startPathPointCoordinateEdit: startPathPointCoordinateEditState,
    syncPathPointCoordinateTexts: syncPathPointCoordinateTextState,
  },
  formatCoordinate: formatDoublePrecisionDecimal,
  getBounds: () => (parsedBounds.value.ok ? parsedBounds.value.bounds : undefined),
  getCoordinateErrorMessage: () => locale.status.pathPointCoordinateNumber,
  getForwardPathMessage,
  getMappedPathPoints: () => mappedPathPoints.value,
  invalidatePathStartCaches: invalidatePathfindingWorkerCache,
  parseCoordinate: parseFiniteNumber,
  pathPixels,
  pathStatus,
  preparePathPointRemoval: () => {
    cancelSmartPathfinding(false);
    clearSmartPathfindingStatus();
  },
  setPathPixels,
});

const formulaInputDecimalPlaces = computed(() =>
  parsedPrecision.value.ok ? parsedPrecision.value.decimalPlaces : DEFAULT_FORMULA_DECIMAL_PLACES,
);
const formulaInputSteepness = computed(() => (parsedSteepness.value.ok ? parsedSteepness.value.steepness : 1));
const formulaInputPrecisionValid = computed(() => parsedPrecision.value.ok);
const formulaInputSteepnessValid = computed(() => parsedSteepness.value.ok);
const liveClickPreviewWorkerCount = computed(() =>
  normalizeLiveClickPreviewWorkerCount(liveClickPreviewWorkerCountText.value),
);
const activeEquationDescription = computed(() => {
  if (toolWorkflowMode.value === "simulator") {
    return locale.status.activeEquation.simulator;
  }
  if (algorithmMode.value === "abs") {
    return equationMode.value === "dy" ? locale.status.activeEquation.absDerivative : locale.status.activeEquation.abs;
  }
  if (algorithmMode.value === "pchip") {
    return equationMode.value === "y"
      ? locale.status.activeEquation.pchip
      : equationMode.value === "dy"
        ? locale.status.activeEquation.pchipFirstDerivative
        : locale.status.activeEquation.pchipSecondDerivative;
  }
  if (algorithmMode.value === "akima") {
    return equationMode.value === "y"
      ? locale.status.activeEquation.akima
      : equationMode.value === "dy"
        ? locale.status.activeEquation.akimaFirstDerivative
        : locale.status.activeEquation.akimaSecondDerivative;
  }
  return equationModes.value.find((mode) => mode.value === equationMode.value)?.description ?? "";
});
const settingsMessage = computed(() => {
  if (!parsedBounds.value.ok) {
    return parsedBounds.value.message;
  }
  if (toolWorkflowMode.value !== "simulator" && !parsedPrecision.value.ok) {
    return parsedPrecision.value.message;
  }
  if (toolWorkflowMode.value !== "simulator" && algorithmMode.value === "step" && !parsedSteepness.value.ok) {
    return parsedSteepness.value.message;
  }
  return "";
});
const debugActivationCountdownMessage = computed(() => {
  const remainingMs = debugActivationRemainingMs.value;
  return remainingMs === undefined
    ? ""
    : locale.ui.settings.debugActivationCountdown(formatDebugActivationRemainingSeconds(remainingMs));
});
// 基础设置面板只应消费展示 DTO；模式切换、校验和调试长按流程仍由页面侧保持原语义。
const settingsPanel = computed<GraphwarSettingsPanelModel>(() => {
  const headerStatus = getFirstHeaderStatus(
    createHeaderStatus(settingsMessage.value, "error"),
    createHeaderStatus(debugActivationCountdownMessage.value, "warning"),
    createHeaderStatus(debugActivationSuccessVisible.value ? locale.ui.settings.debugInfoEnabled : "", "success"),
    createHeaderStatus(activeEquationDescription.value),
  );
  return {
    advancedSettingsVisible: advancedSettingsVisible.value,
    algorithmMode: algorithmMode.value,
    algorithmModes: algorithmModes.value.map((mode) => ({
      ...mode,
      disabled: equationMode.value === "ddy" && mode.value === "abs",
    })),
    equationMode: equationMode.value,
    equationModes: equationModes.value.map((mode) => ({
      ...mode,
      disabled: false,
    })),
    headerStatus: {
      kind: headerStatus.kind,
      message: headerStatus.message,
    },
    interactionDisabled: graphwarManagedModeEnabled.value,
    precision: {
      maximum: MAX_FORMULA_DECIMAL_PLACES,
      text: precisionText.value,
    },
    stepGlitchModeEnabled: stepGlitchModeEnabled.value,
    stepGlitchModeReason: graphwarManagedModeEnabled.value
      ? getCapabilityReason("managed-lock")
      : toolWorkflowMode.value !== "solver" || solverEquationMode.value !== "dy" || algorithmMode.value !== "step"
        ? locale.ui.settings.stepGlitchModeInactiveReason
        : stepGlitchModeEnabled.value && !detectedObstacles.value
          ? locale.ui.settings.stepGlitchModeWaitingReason
          : undefined,
    stepGlitchModeState: graphwarManagedModeEnabled.value
      ? "busy"
      : toolWorkflowMode.value !== "solver" || solverEquationMode.value !== "dy" || algorithmMode.value !== "step"
        ? "dormant"
        : stepGlitchModeEnabled.value && !detectedObstacles.value
          ? "dormant"
          : "normal",
    stepOverflowProtectionEnabled: stepOverflowProtectionEnabled.value,
    steepnessText: steepnessText.value,
    toolWorkflowMode: toolWorkflowMode.value,
    toolWorkflowModes: toolWorkflowModes.value,
  };
});
const activeToolBaseHint = computed(() =>
  toolMode.value === "bounds"
    ? locale.status.activeToolHint.bounds
    : toolMode.value === "obstacle"
      ? locale.status.activeToolHint.obstacle
      : toolWorkflowMode.value === "simulator"
        ? locale.status.activeToolHint.simulatorPath
        : locale.status.activeToolHint.solverPath,
);
const boundsPreviewRect = computed(() =>
  boundsFirstPoint.value && pointerPreviewPoint.value
    ? normalizeBoundsRect(boundsFirstPoint.value, pointerPreviewPoint.value)
    : undefined,
);
const visibleBoundsRect = computed(() => boundsPreviewRect.value ?? boundsRect.value);
const recognizedObjectOverlayVisible = computed(
  () => detectedSoldiers.value.length > 0 || Boolean(detectedObstacles.value),
);
const stageCoordinateLines = computed<StageCoordinateLines>(() => {
  const boundsResult = parsedBounds.value;
  if (!graphwarAgentEnabled.value || !boundsResult.ok) {
    return { axisLines: [], gridLines: [] };
  }

  return createStageCoordinateLines(boundsResult.bounds, visibleBoundsRect.value);
});
const activeRouteBoundaryInset = useGraphwarPathfindingRouteBoundaryInset({
  modes: {
    collisionCheckEnabled,
    pathfindingObstacleEdgesActive,
  },
  settings: {
    parsedObstacleTolerances,
  },
});
const activeSimulationBoundaryInset = computed(() =>
  parsedObstacleTolerances.value.ok ? parsedObstacleTolerances.value.simulationBoundaryInsetPlanePixels : 0,
);
const targetBoundsRect = computed(() =>
  createBoundsRectWithBoundaryExpansion(boundsRect.value, activeRouteBoundaryInset.value),
);
// 目标选择上下文应集中 bounds/path 到 Graphwar 目标规则的适配，避免页面散落坐标组合逻辑。
const {
  createAllowedTargetRect,
  createGeometry: createTargetingGeometry,
  createMinimumForwardTargetPoint,
  createSearchStartSoldierAimPoint,
  createSmartPathfindingSoldierTarget,
  createSoldierHitCircle,
  getRightmostPathPoint,
  isFriendlyObstacleSoldier: isDetectedFriendlySoldierObstacle,
  isSoldierOnLaunchSide: isDetectionBoxOnLaunchSide,
} = useGraphwarTargetingContext<DetectionBox>({
  boundsRect,
  getBounds: () => (parsedBounds.value.ok ? parsedBounds.value.bounds : undefined),
  getTargetBoundsRect: () => targetBoundsRect.value,
  isFriendlySoldier: getGraphwarAgentFriendlyState,
  pathPixels,
  requireExactSoldierCenter: () => algorithmMode.value === "step",
});
// 障碍投影应集中 friendly mask、route/simulation mask、SVG path 和轨迹碰撞设置，页面只保留状态来源。
const {
  simulationObstacleMask,
  smartPathfindingBaseObstacleMask,
  smartPathfindingObstacleRouteEdgePath,
  smartPathfindingObstacleRouteFillPath,
  smartPathfindingObstacleSimulationEdgePath,
  smartPathfindingObstacleSimulationFillPath,
  smartPathfindingSimulationObstacleMask,
  trajectoryCollisionSettings,
  visibleObstacleEdgePath,
  visibleObstacleFillPath,
} = useGraphwarPathfindingObstacleProjection({
  boundsRect,
  cache: pathfindingCache,
  detection: {
    isFriendlyObstacleSoldier: isDetectedFriendlySoldierObstacle,
    obstacles: detectedObstacles,
    soldiers: detectedSoldiers,
  },
  modes: {
    collisionCheckEnabled,
    effectiveSmartPathfindingEnabled,
    includesFriendlySoldierObstacles,
    pathfindingObstacleEdgesActive,
  },
  settings: {
    activeSimulationBoundaryInset,
    getSoldierHitRadiusPixels: () => soldierHitRadiusPixels.value,
    parsedBounds,
    parsedObstacleTolerances,
  },
});
const trajectoryCollisionSettingsValid = computed(
  () => !collisionCheckEnabled.value || parsedObstacleTolerances.value.ok,
);
// 主轨迹 Module 在依赖准备完成后统一异步解算函数、模拟轨迹并原子发布结果。
const {
  calculationFallbackReason: trajectoryCalculationFallbackReason,
  calculationStatus: trajectoryCalculationStatus,
  createPathTrajectoryFormulaSettings,
  dispose: disposeTrajectoryResult,
  formulaOutputDecimalPlaces,
  formulaResult,
  graphwarTrajectoryFormulaSettings,
  plottedCurvePoints,
  secondOrderLaunchAngleDegrees,
  simulatorLaunchAngleRadians,
  trajectoryWarningReason,
} = useGraphwarTrajectoryResult({
  collisionSettingsValid: trajectoryCollisionSettingsValid,
  geometry: {
    boundsRect,
    getBounds: () => (parsedBounds.value.ok ? parsedBounds.value.bounds : undefined),
  },
  getCollisionSettings: () => trajectoryCollisionSettings.value,
  getTargetHitRadiusPixels: () => soldierHitRadiusPixels.value,
  path: {
    mappedPathPoints,
    pathPixels,
  },
  settings: {
    algorithmMode,
    equationMode,
    isEquationModeDisabled,
    precisionDecimalPlaces: formulaInputDecimalPlaces,
    precisionValid: formulaInputPrecisionValid,
    steepness: formulaInputSteepness,
    steepnessValid: formulaInputSteepnessValid,
    getStepGlitchObstacleMask: () => simulationObstacleMask.value,
    stepGlitchModeEnabled,
    stepOverflowProtectionEnabled,
    toolWorkflowMode,
  },
  simulator: {
    formulaText: simulatorFormulaText,
    launchAngleText: simulatorLaunchAngleText,
    parseDerivativeAsY: simulatorParseDerivativeAsY,
    parseNumber: parseFiniteNumber,
    skipUnknownCharacters: simulatorSkipUnknownCharacters,
  },
});
// 结果操作 Module 应集中复制反馈、clipboard fallback 和模拟器清空；页面只提供当前结果来源。
const {
  canClearSimulatorInputs,
  canCopyFormula,
  clearSimulatorInputs,
  copyButtonText,
  copyFormula,
  dispose: disposeResultActions,
  statusAnnouncement: copyStatusAnnouncement,
} = useGraphwarResultActions({
  formulaResult,
  getCopyMessages: () => locale.status.copy,
  simulatorFormulaText,
  simulatorLaunchAngleText,
  toolWorkflowMode,
});

const graphwarAgentFireButtonText = computed(() => {
  if (graphwarAgentFireInProgress.value) {
    return locale.ui.result.firing;
  }
  if (graphwarAgentFireStatus.value === "success") {
    return locale.ui.result.fireSuccess;
  }
  if (graphwarAgentFireStatus.value === "error") {
    return locale.ui.result.fireError;
  }
  return locale.ui.result.fire;
});
/** Localises the stable reason shared by capability presentation and guarded commands. */
function getCapabilityReason(reason: GraphwarCapabilityReason | undefined) {
  return reason ? locale.ui.pathfinding.capabilityReasons[reason] : undefined;
}

// One derivation owns visible state and command guards; async workflows still repeat authoritative preflight checks.
const graphwarCapabilities = computed(() =>
  deriveGraphwarCapabilities(
    {
      activeSource: graphwarAgentEnabled.value ? "agent" : "screenshot",
      agent: {
        enabled: graphwarAgentEnabled.value,
        normalizedBaseUrl: normalizedGraphwarAgentBaseUrl.value,
      },
      busy: {
        agentFire: graphwarAgentFireInProgress.value,
        agentRead: graphwarAgentReadInProgress.value,
        managedMode: graphwarManagedModeEnabled.value,
        pathfinding: smartPathfindingInProgress.value,
      },
      formula: {
        managedSettingsValid: parsedBounds.value.ok && parsedPrecision.value.ok && parsedSteepness.value.ok,
        oneClickClearSupported: supportsOneClickClear(algorithmMode.value, equationMode.value),
        settingsValid: !settingsMessage.value,
        usesStepGlitchRouting: effectiveStepGlitchModeEnabled.value,
      },
      pathfinding: {
        deleteCheckRadiusValid: parsedOneClickClearTolerances.value.ok,
        obstacleTolerancesValid: parsedObstacleTolerances.value.ok,
        pathStartAvailable: mappedPathPoints.value.length > 0,
        workerCountValid: parsedPathfindingWorkerCount.value.ok,
      },
      resultAvailable: canCopyFormula.value,
      scene: {
        boundsAvailable: activeBoundsReady.value,
        imageAvailable: Boolean(imageUrl.value),
        obstaclesAvailable: Boolean(detectedObstacles.value),
        provenance:
          detectionProvenance.value?.source === "agent"
            ? {
                battleRevision: detectionProvenance.value.battleRevision,
                gameInstanceId: detectionProvenance.value.gameInstanceId,
                normalizedAgentBaseUrl: detectionProvenance.value.normalizedAgentUrl,
                source: "agent",
              }
            : detectionProvenance.value,
        soldiersAvailable: detectedSoldiers.value.length > 0,
      },
      workflowMode: toolWorkflowMode.value,
    },
    {
      collisionCheckEnabled: collisionCheckEnabled.value,
      deleteOptimizationEnabled: deleteOptimizationEnabled.value,
      pathPlanningEnabled: pathPlanningEnabled.value,
      snapSoldiersEnabled: snapSoldiersEnabled.value,
    },
  ),
);
const statusAnnouncement = computed(() => {
  if (graphwarAgentFireInProgress.value) {
    return locale.ui.result.firing;
  }
  if (graphwarAgentFireStatus.value === "success") {
    return locale.status.agent.fired;
  }
  if (graphwarAgentFireStatus.value === "error") {
    return locale.status.agent.fireFailed(graphwarAgentFireFailureMessage.value);
  }
  return copyStatusAnnouncement.value;
});
// 舞台命中测试应集中路径点选择圈、士兵可视选择圈和真实命中圈，避免交互层混用半径语义。
const stageHitTesting: GraphwarStageHitTestingController<DetectionBox> = useGraphwarStageHitTesting<DetectionBox>({
  getDetectionBoxes: (): readonly DetectionBox[] => detectionBoxes.value,
  getImageData: getImageDataFromCurrentImage,
  getPathPixels: (): readonly PixelPoint[] => pathPixels.value,
  getPathPointSelectionRadius: (): number => displayedSoldierVisibleRadiusPixels.value,
});
const {
  detectionBoxContainsHitCircle,
  detectionBoxContainsPathPoint,
  getDetectedSoldierAtPoint,
  getDetectionBoxCenter,
  getDetectedSoldierColor,
  getPathPointIndexAtPoint,
} = stageHitTesting;
// 路径追加 workflow 应集中普通点、士兵目标和智能寻路前预检；页面只负责 pointer 分发。
const { appendDetectedSoldierPathPoint, appendPathPoint, createCurrentLastPathHitTarget } =
  useGraphwarPathAppendWorkflow<DetectionBox, SmartPathfindingTarget>({
    geometry: {
      boundsRect,
      getMappedPathPoints: () => mappedPathPoints.value,
      parsedBounds,
    },
    messages: {
      getForwardPathMessage,
      getSmartPathfindingCurrentPathBlockedMessage: () => createSmartPathfindingCurrentPathBlockedMessage(locale),
    },
    modes: {
      isSmartPathfindingEnabled: () => effectiveSmartPathfindingEnabled.value,
      toolWorkflowMode,
    },
    path: {
      commitTarget,
      pathPixels,
      pathStatus,
      setPathPixels,
      trajectoryStrokeColor,
    },
    smartPathfinding: {
      clearStatus: clearSmartPathfindingStatus,
      flashBlockedPoint: flashSmartPathfindingBlockedPoint,
      runWorkflow: {
        run: async (request) => {
          const task = { kind: "single" } as const;
          activePathfindingTask = task;
          try {
            return await smartPathfindingRunWorkflow.run(request);
          } finally {
            if (activePathfindingTask === task) {
              activePathfindingTask = undefined;
            }
          }
        },
      },
      setStatus: setSmartPathfindingStatus,
    },
    targets: {
      createMinimumForwardTargetPoint,
      createSearchStartSoldierAimPoint,
      createSmartPathfindingSoldierTarget,
      createSoldierHitCircle,
      getDetectedSoldierColor,
      getDetectionBoxCenter,
      getCommittedTargets: () => committedTargets.value,
      getSoldiers: () => detectedSoldiers.value,
      soldierContainsHitCircle: detectionBoxContainsHitCircle,
    },
    trajectory: {
      getFormulaSettings: createPathTrajectoryFormulaSettings,
      getSimulationObstacleMask: () => simulationObstacleMask.value,
      getTargetHitRadiusPixels: () => soldierHitRadiusPixels.value,
      parsedObstacleTolerances,
    },
  });

/** 优先使用路径保存的不可变命中圈；普通尾点才退回当前默认命中半径。 */
function createCurrentPrefixTargetCircle() {
  if (pathPixels.value.length < 2) {
    return undefined;
  }
  const lastPoint = pathPixels.value.at(-1);
  if (!lastPoint) {
    return undefined;
  }
  const committed = committedTargets.value.find(
    (target) => target.anchor?.x === lastPoint.x && target.anchor.y === lastPoint.y,
  );
  if (committed) {
    return committed.hitCircle;
  }

  const target = createCurrentLastPathHitTarget();
  if (!target) {
    return undefined;
  }
  if ("center" in target) {
    return target;
  }
  const radius = soldierHitRadiusPixels.value;
  return radius === undefined ? undefined : { center: target, radius };
}

// 一键清图 workflow 应集中预检、候选收集、worker 输入、cache 和结果落地；页面只保留当前状态入口。
/** 托管需要预检三套配置；普通阶跃一键清图才由当前公式分支决定是否使用 DAG Worker。 */
function requiresOneClickClearDagWorker() {
  return graphwarManagedModeEnabled.value || !effectiveStepGlitchModeEnabled.value;
}

const oneClickClearRunWorkflow = useGraphwarOneClickClearRunWorkflow<DetectionBox>({
  debug: {
    appendSearchWorkerTimings: appendOneClickClearSearchWorkerTimings,
    clearTimings: clearSmartPathfindingDebugTimings,
    finishTimings: finishSmartPathfindingDebugTimings,
    measureStage: measureSmartPathfindingDebugStage,
    measureStageAsync: measureSmartPathfindingDebugStageAsync,
  },
  effects: {
    applyValidatedPath,
    flashBlockedSegment: smartPathfindingSession.flashBlockedSegment,
    flashHitSoldiers: flashOneClickClearHitSoldiers,
    setStatus: (message, kind) => {
      if (graphwarManagedModeEnabled.value) {
        if (kind === "success") {
          showGraphwarManagedCalculationStatus(message, kind);
          return;
        }
        setGraphwarManagedStatus(message, kind);
        return;
      }
      setSmartPathfindingStatus(message, kind);
    },
  },
  input: {
    boundsRect,
    getBounds: () => (parsedBounds.value.ok ? parsedBounds.value.bounds : undefined),
    getCommittedTargets: () => committedTargets.value,
    getDeleteOptimizationEnabled: () => deleteOptimizationEnabled.value,
    getFormulaSettings: () => createPathTrajectoryFormulaSettings(),
    getObstacleMask: () => smartPathfindingBaseObstacleMask.value,
    getPathfindingWorkerCount: () =>
      parsedPathfindingWorkerCount.value.ok ? parsedPathfindingWorkerCount.value.workerCount : undefined,
    getPathPoints: () => pathPixels.value,
    getRouteMode: getPathfindingRouteMode,
    requiresDagWorker: requiresOneClickClearDagWorker,
    getSimulationMask: () => smartPathfindingSimulationObstacleMask.value,
    getTolerances: () => effectiveOneClickClearTolerances.value,
    isUnsupportedMode: isOneClickClearModeUnsupported,
  },
  messages: {
    getFailureMessage: (reason, elapsedMs) => createOneClickClearFailureMessage({ elapsedMs, locale, reason }),
    getInProgressMessage: () => locale.smartPathfinding.oneClickClear.inProgress,
    getPreflightFailureStatus: (reason) =>
      createOneClickClearPreflightFailureStatus({
        getDisabledMessage: getSmartPathfindingDisabledMessage,
        locale,
        reason,
        settingsMessage: oneClickClearSettingsMessage.value,
      }),
    getSuccessMessage: (targetCount, elapsedMs, resultCacheHit) =>
      graphwarManagedModeEnabled.value
        ? locale.smartPathfinding.managed.calculationComplete(targetCount, formatElapsedDuration(elapsedMs))
        : createOneClickClearSuccessMessage({ elapsedMs, locale, resultCacheHit, targetCount }),
  },
  pathfinding: {
    cache: pathfindingCache,
    runner: graphwarPathfindingRunner,
  },
  run: {
    finish: finishSmartPathfindingRun,
    isCurrent: isSmartPathfindingRunCurrent,
    start: startSmartPathfinding,
  },
  targets: {
    createGeometry: createTargetingGeometry,
    getFriendlyFireEnabled: () => friendlyFireEnabled.value,
    getPrefixTarget: createCurrentPrefixTargetCircle,
    getSoldiers: () => detectedSoldiers.value,
    isFriendlySoldier: getGraphwarAgentFriendlyState,
  },
  time: {
    now: nowMs,
  },
});
// 实时点击预览应集中悬停帧、点击落位模拟和临时轨迹采样；页面只提供当前规则入口。
const {
  clearPointerPoint: clearLiveClickPreviewPointerPoint,
  curvePoints: liveClickPreviewCurvePoints,
  dispose: disposeLiveClickPreview,
  enabled: liveClickPreviewEnabled,
  inProgress: liveClickPreviewInProgress,
  label: liveClickPreviewLabel,
  lineSegments: liveClickPreviewLineSegments,
  points: liveClickPreviewPoints,
  renderedElapsedMs: liveClickPreviewRenderedElapsedMs,
  refreshPointerPathPointIndex: refreshLiveClickPreviewPointerPathPointIndex,
  schedulePointerPoint: scheduleLiveClickPreviewPointerPoint,
  setPointerPoint: setLiveClickPreviewPointerPoint,
} = useGraphwarLiveClickPreview({
  geometry: {
    boundsRect,
    getBounds: () => (parsedBounds.value.ok ? parsedBounds.value.bounds : undefined),
  },
  getSelfLabel: () => locale.ui.point.svgSelfLabel,
  interaction: {
    draggingPathPointIndex,
    getPathPointIndexAtPoint,
    smartPathfindingInProgress,
    toolMode,
  },
  path: {
    createLineSegments: createPathLineSegments,
    mappedPathPoints,
    pathPixels,
  },
  runtime: {
    workerCount: liveClickPreviewWorkerCount,
  },
  settings: {
    algorithmMode,
    effectiveSmartPathfindingEnabled,
    equationMode,
    isEquationModeDisabled,
    precisionValid: formulaInputPrecisionValid,
    steepnessValid: formulaInputSteepnessValid,
    toolWorkflowMode,
  },
  simulator: {
    formulaText: simulatorFormulaText,
    launchAngleRadians: simulatorLaunchAngleRadians,
    parseDerivativeAsY: simulatorParseDerivativeAsY,
    skipUnknownCharacters: simulatorSkipUnknownCharacters,
  },
  target: {
    createMinimumForwardTargetPoint,
    createSearchStartSoldierAimPoint,
    createSmartPathfindingSoldierTarget,
    getDetectedSoldierAtPoint,
    getDetectionBoxCenter,
    snapSoldiersEnabled,
  },
  trajectory: {
    formulaSettings: graphwarTrajectoryFormulaSettings,
    getCollisionSettings: () => trajectoryCollisionSettings.value,
  },
});
const liveClickPreviewRenderedStatus = computed(() =>
  liveClickPreviewRenderedElapsedMs.value === undefined
    ? ""
    : locale.status.liveClickPreview.rendered(formatElapsedDuration(liveClickPreviewRenderedElapsedMs.value)),
);
const activeToolHint = computed(() => {
  if (liveClickPreviewInProgress.value) {
    return {
      kind: "warning" as const,
      message: locale.status.liveClickPreview.inProgress,
    };
  }
  if (liveClickPreviewRenderedStatus.value) {
    return {
      kind: "success" as const,
      message: liveClickPreviewRenderedStatus.value,
    };
  }
  return {
    kind: "info" as const,
    message: activeToolBaseHint.value,
  };
});
const visibleBoundaryExpansionRect = computed<BoundsRect | undefined>(() => {
  const simulationBoundaryInset = activeSimulationBoundaryInset.value;
  if ((!collisionCheckEnabled.value && !pathfindingObstacleEdgesActive.value) || simulationBoundaryInset <= 0) {
    return undefined;
  }

  return createBoundsRectWithBoundaryExpansion(visibleBoundsRect.value, simulationBoundaryInset);
});
const allowedTargetRect = computed<BoundsRect | undefined>(() => {
  if (toolMode.value !== "path" || !imageUrl.value || !parsedBounds.value.ok) {
    return undefined;
  }

  return createAllowedTargetRect();
});
const detectionBoxes = computed<DetectionBox[]>(() => {
  let visibleSoldiers = detectedSoldiers.value.filter((box) => !detectionBoxMatchesSelectedPathPoint(box));
  if (toolWorkflowMode.value === "simulator") {
    return visibleSoldiers;
  }
  if (blocksFriendlyFireTargets.value) {
    visibleSoldiers = visibleSoldiers.filter((box) => !isDetectedFriendlySoldierObstacle(box));
  }
  if (recognizedObjectOverlayVisible.value && pathPixels.value.length === 0) {
    visibleSoldiers = visibleSoldiers.filter((box) => isDetectionBoxOnLaunchSide(box));
  }
  const lastPoint = pathPixels.value.at(-1);
  if (!lastPoint) {
    return visibleSoldiers;
  }
  if (!allowedTargetRect.value) {
    return [];
  }

  // 单点智能寻路还可尝试 Step 命中圈 x+ 边缘；普通追加路径仍沿用各算法自己的首选瞄点。
  return visibleSoldiers.filter((box) =>
    effectiveSmartPathfindingEnabled.value
      ? Boolean(createSmartPathfindingSoldierTarget(lastPoint, box))
      : Boolean(createSearchStartSoldierAimPoint(lastPoint, box)),
  );
});
const inactiveDetectionBoxes = computed<DetectionBox[]>(() => {
  if (!recognizedObjectOverlayVisible.value || toolWorkflowMode.value === "simulator") {
    return [];
  }

  const activeBoxIds = new Set(detectionBoxes.value.map((box) => box.id));
  // 已选中的目标仍应保留浅蓝识别圈；排除它只用于防止重复作为下一目标。
  return detectedSoldiers.value.filter((box) => !activeBoxIds.has(box.id));
});
const calculationMessage = computed(() => {
  if (toolWorkflowMode.value === "simulator") {
    if (pathPixels.value.length < 1) {
      return locale.status.calculation.selectInitialSoldier;
    }
    if (!simulatorFormulaText.value.trim()) {
      return locale.status.calculation.enterFunction;
    }
    if (equationMode.value === "ddy" && simulatorLaunchAngleRadians.value === undefined) {
      return locale.status.calculation.enterLaunchAngle;
    }
    return "";
  }
  if (algorithmMode.value === "step" && !parsedSteepness.value.ok) {
    return "";
  }
  if (pathPixels.value.length < 2) {
    return locale.status.calculation.selectPath;
  }
  return "";
});

const detectionSettingsMessage = computed(() => {
  if (!parsedDetectionSettings.value.ok) {
    return parsedDetectionSettings.value.message;
  }
  return "";
});
// 当前输入错误应优先于上一轮识别状态，避免旧成功文案盖住即时校验失败。
const detectionHeaderStatus = computed(() => detectionSettingsMessage.value || detectionStatus.value);
const detectionHeaderStatusKind = computed<DetectionStatusKind>(() =>
  detectionSettingsMessage.value ? "error" : detectionStatusKind.value,
);
// 识别面板只应消费展示 DTO；识别运行、状态优先级和耗时格式化仍由页面侧保持原语义。
const detectionPanel = computed<GraphwarDetectionPanelModel>(() => ({
  agent: {
    baseUrlText: graphwarAgentBaseUrlText.value,
    enabled: graphwarAgentEnabled.value,
    inProgress: graphwarAgentReadInProgress.value,
    readReason: getCapabilityReason(graphwarCapabilities.value.agentRead.reason),
    readState: graphwarCapabilities.value.agentRead.state,
  },
  autoDetectionEnabled: autoDetectionEnabled.value,
  canDetectBounds: Boolean(imageUrl.value) && !detectionInProgress.value && !graphwarAgentReadInProgress.value,
  canDetectObjects:
    Boolean(imageUrl.value) &&
    activeBoundsReady.value &&
    !detectionInProgress.value &&
    !graphwarAgentReadInProgress.value,
  debugTimingRows: detectionDebugTimingRows.value.map((entry, index) => ({
    key: `${entry.stage}-${index}`,
    text: entry.elapsedVisible ? `${entry.label}: ${formatDebugElapsedDuration(entry.elapsedMs)}` : entry.label,
    title: entry.title,
  })),
  debugTimingVisible: debugInfoEnabled.value,
  detectObjectsTitle: getDetectObjectsTitle(),
  headerStatus: {
    kind: detectionHeaderStatusKind.value,
    message: detectionHeaderStatus.value,
  },
  interactionDisabled: graphwarManagedModeEnabled.value,
  screenshotActionsVisible: !graphwarAgentEnabled.value,
  // 当前设置错误展示时，旧识别警告也应隐藏，避免混入上一轮结果元数据。
  statusWarning: {
    message: detectionSettingsMessage.value ? "" : detectionStatusWarning.value,
    title: detectionSettingsMessage.value ? "" : detectionStatusWarningTitle.value,
  },
}));
const magnifierZoom = computed(() =>
  parsedMagnifierZoom.value.ok ? parsedMagnifierZoom.value.zoom : graphwarToolDefaults.magnifierZoom,
);
const magnifierSliderZoom = computed(() =>
  clampNumber(magnifierZoom.value, magnifierMinimumZoom, magnifierSliderMaximumZoom),
);
const magnifierZoomRangeStyle = computed(() => {
  const range = magnifierSliderMaximumZoom - magnifierMinimumZoom;
  const progress = range > 0 ? ((magnifierSliderZoom.value - magnifierMinimumZoom) / range) * 100 : 0;
  return {
    "--graphwar-killer-range-progress": `${formatDecimal(progress, 4)}%`,
  };
});
const obstacleBrushAvailable = computed(() => Boolean(detectedObstacles.value));
const obstacleBrushControlsVisible = computed(() => toolMode.value === "obstacle");
const obstacleBrushSliderDiameter = computed(() => {
  const diameter = parseFiniteNumber(obstacleBrushDiameterText.value);
  return clampNumber(
    diameter ?? obstacleBrushMinimumDiameter,
    obstacleBrushMinimumDiameter,
    obstacleBrushSliderMaximumDiameter,
  );
});
const obstacleBrushRangeStyle = computed(() => {
  const range = obstacleBrushSliderMaximumDiameter - obstacleBrushMinimumDiameter;
  const progress = range > 0 ? ((obstacleBrushSliderDiameter.value - obstacleBrushMinimumDiameter) / range) * 100 : 0;
  return {
    "--graphwar-killer-range-progress": `${formatDecimal(progress, 4)}%`,
  };
});
// 操作面板只应消费展示 DTO；工具切换和输入校验仍由页面侧维持原交互语义。
const actionPanel = computed<GraphwarActionPanelModel>(() => ({
  activeToolHint: activeToolHint.value,
  collisionCheck: {
    enabled: collisionCheckEnabled.value,
    reason: getCapabilityReason(graphwarCapabilities.value.collisionCheck.reason),
    state: graphwarCapabilities.value.collisionCheck.state,
  },
  interactionDisabled: graphwarManagedModeEnabled.value,
  liveClickPreviewEnabled: liveClickPreviewEnabled.value,
  magnifierEnabled: magnifierEnabled.value,
  magnifierZoom: {
    inputMaximum: magnifierInputMaximumZoom,
    minimum: magnifierMinimumZoom,
    rangeStyle: magnifierZoomRangeStyle.value,
    sliderMaximum: magnifierSliderMaximumZoom,
    sliderValue: magnifierSliderZoom.value,
    text: magnifierZoomText.value,
  },
  obstacleBrushAvailable: obstacleBrushAvailable.value,
  obstacleBrushControlsVisible: obstacleBrushControlsVisible.value,
  obstacleBrushDiameter: {
    inputMaximum: obstacleBrushInputMaximumDiameter,
    minimum: obstacleBrushMinimumDiameter,
    rangeStyle: obstacleBrushRangeStyle.value,
    sliderMaximum: obstacleBrushSliderMaximumDiameter,
    sliderValue: obstacleBrushSliderDiameter.value,
    text: obstacleBrushDiameterText.value,
  },
  obstacleBrushEraseEnabled: obstacleBrushEraseEnabled.value,
  obstacleEditsDirty: obstacleEditsDirty.value,
  pathPlanning: {
    enabled: pathPlanningEnabled.value,
    reason: getCapabilityReason(graphwarCapabilities.value.pathPlanning.reason),
    state: graphwarCapabilities.value.pathPlanning.state,
  },
  snapSoldiers: {
    enabled: snapSoldiersEnabled.value,
    reason: getCapabilityReason(graphwarCapabilities.value.snapSoldiers.reason),
    state: graphwarCapabilities.value.snapSoldiers.state,
  },
  toolMode: toolMode.value,
}));
const obstacleBrushPreview = computed(() => {
  const point = obstacleBrushPointerPoint.value;
  if (toolMode.value !== "obstacle" || !point || !parsedObstacleBrushDiameter.value.ok) {
    return undefined;
  }

  const diameter = parsedObstacleBrushDiameter.value.diameter;
  const width = (diameter / GRAPHWAR_PLANE_LENGTH) * boundsRect.value.width;
  const height = (diameter / GRAPHWAR_PLANE_HEIGHT) * boundsRect.value.height;
  return {
    center: point,
    radiusX: width / 2,
    radiusY: height / 2,
  };
});

// 一键清图应保留原预检顺序，并在普通寻路容差上追加自身专属的删点半径校验。
const oneClickClearSettingsMessage = computed(() => {
  if (toolWorkflowMode.value === "simulator") {
    return "";
  }
  if (!effectiveStepGlitchModeEnabled.value && !parsedPathfindingWorkerCount.value.ok) {
    return parsedPathfindingWorkerCount.value.message;
  }
  if (!effectiveOneClickClearTolerances.value) {
    return deleteOptimizationEnabled.value && !parsedOneClickClearTolerances.value.ok
      ? parsedOneClickClearTolerances.value.message
      : parsedObstacleTolerances.value.ok
        ? ""
        : parsedObstacleTolerances.value.message;
  }
  return "";
});
const smartPathfindingPrerequisiteMessage = computed(() => {
  if (activeObjectDetectionReady.value) {
    return "";
  }
  if (graphwarAgentEnabled.value) {
    return locale.smartPathfinding.needDetection;
  }
  if (!imageUrl.value) {
    return getMissingStateImageMessage();
  }
  if (!activeBoundsReady.value) {
    return locale.smartPathfinding.needBounds;
  }
  return locale.smartPathfinding.needDetection;
});

watch(
  [mappedPathPoints],
  () => {
    syncPathPointCoordinateTexts();
  },
  { immediate: true },
);

const secondOrderLaunchAngleText = computed(() =>
  secondOrderLaunchAngleDegrees.value === undefined ? "" : formatAngleDegree(secondOrderLaunchAngleDegrees.value),
);
const secondOrderAngleHint = computed(() =>
  toolWorkflowMode.value === "solver" && secondOrderLaunchAngleText.value
    ? locale.status.secondOrderAngleHint(secondOrderLaunchAngleText.value)
    : "",
);

const trajectoryWarning = computed(() => {
  const reason = trajectoryWarningReason.value;
  if (!reason) {
    return "";
  }
  if (reason === "obstacle") {
    return locale.status.trajectoryWarning.obstacle;
  }
  if (reason === "too-steep") {
    return locale.status.trajectoryWarning.stopped["too-steep"];
  }
  if (reason === "max-steps") {
    return locale.status.trajectoryWarning.stopped["max-steps"];
  }
  if (reason === "out-of-bounds") {
    return locale.status.trajectoryWarning.stopped["out-of-bounds"];
  }
  return locale.status.trajectoryWarning.stopped.invalid;
});
// 智能寻路面板只应消费展示 DTO；按钮 guard、运行状态和调试耗时仍由页面侧保持原语义。
const smartPathfindingPanel = computed<GraphwarSmartPathfindingPanelModel>(() => {
  const headerStatus = getSmartPathfindingHeaderStatus({
    smartPathfindingEnabled: effectiveSmartPathfindingEnabled.value,
    smartPathfindingSettingsMessage:
      toolWorkflowMode.value === "simulator" || parsedObstacleTolerances.value.ok
        ? ""
        : parsedObstacleTolerances.value.message,
    smartPathfindingStatusMessage: smartPathfindingStatus.value,
    smartPathfindingStatusKind: smartPathfindingStatusKind.value,
    enableHintMessage: "",
    hintMessage: locale.ui.actions.pathPlanningTitle,
  });
  const semanticCapability = graphwarCapabilities.value.semanticControls;
  const oneClickClearCapability = graphwarCapabilities.value.oneClickClear;
  const managedModeCapability = graphwarCapabilities.value.managedMode;
  return {
    debugTimingRows: smartPathfindingDebugTimingRows.value.map((entry, index) => ({
      indentLevel: entry.indentLevel,
      key: `${entry.stage}-${index}`,
      text: entry.elapsedVisible ? `${entry.label}: ${formatDebugElapsedDuration(entry.elapsedMs)}` : entry.label,
      title: entry.title,
    })),
    debugTimingVisible: debugInfoEnabled.value,
    deleteOptimization: {
      enabled: deleteOptimizationEnabled.value,
      reason: getCapabilityReason(semanticCapability.reason),
      state: semanticCapability.state,
    },
    friendlyFire: {
      enabled: friendlyFireEnabled.value,
      reason: getCapabilityReason(semanticCapability.reason),
      state: semanticCapability.state,
    },
    headerStatus: {
      kind: headerStatus.kind,
      message: headerStatus.message,
      title: headerStatus.message,
    },
    managedFriendlyFireWarning:
      graphwarManagedModeEnabled.value && friendlyFireEnabled.value
        ? locale.ui.pathfinding.managedFriendlyFireWarning
        : "",
    managedMode: {
      enabled: graphwarManagedModeEnabled.value,
      reason: getCapabilityReason(managedModeCapability.reason),
      state: managedModeCapability.state,
      title: graphwarManagedModeEnabled.value
        ? locale.ui.pathfinding.managedModeDisableTitle
        : locale.ui.pathfinding.managedModeTitle,
    },
    managedProfiles: locale.equationModes.map((equation) => {
      const profile = solverFormulaProfiles.value[equation.value];
      return {
        equation: equation.label,
        formula: `${locale.algorithmModes.find((algorithm) => algorithm.value === profile.algorithm)?.label ?? profile.algorithm}${
          equation.value === "dy" && profile.algorithm === "step" && profile.stepGlitchModeEnabled
            ? ` + ${locale.ui.settings.stepGlitchMode}`
            : ""
        }`,
      };
    }),
    oneClickClear: {
      reason: getCapabilityReason(oneClickClearCapability.reason),
      state: oneClickClearCapability.state,
      title: locale.ui.pathfinding.oneClickClearTitle,
    },
    routeMode: pathfindingRouteMode.value,
    searchAnimation: {
      enabled: searchAnimationEnabled.value,
      state: "normal",
    },
    usesStepGlitchRouting: effectiveStepGlitchModeEnabled.value,
  };
});

const stageStyle = computed(() => ({
  aspectRatio: `${imageWidth.value} / ${imageHeight.value}`,
}));
// 截图/SVG 坐标像素：由 Graphwar 原始平面半径按当前 bounds 横向比例换算。
const soldierHitRadiusPixels = computed(() => getGraphwarPlaneRadiusPixels(GRAPHWAR_SOLDIER_RADIUS));
// 高级设置面板只应消费展示 DTO；输入校验、缓存失效和检测/寻路副作用仍由页面侧维护。
const advancedSettingsPanel = computed<GraphwarAdvancedSettingsPanelModel>(() => ({
  actionBar: {
    liveClickPreviewWorkerCountMaximum: GRAPHWAR_LIVE_CLICK_PREVIEW_WORKER_COUNT_MAXIMUM,
    liveClickPreviewWorkerCountText: liveClickPreviewWorkerCountText.value,
  },
  bounds: {
    maxXText: maxXText.value,
    maxYText: maxYText.value,
    minXText: minXText.value,
    minYText: minYText.value,
  },
  interactionDisabled: graphwarManagedModeEnabled.value,
  pathfinding: {
    obstacleExpansionMode: graphwarAgentEnabled.value ? "agent" : "detection",
    obstacleSimulationToleranceText: activeObstacleSimulationToleranceText.value,
    oneClickClearDeleteCheckRadiusMinimumPlanePixels,
    oneClickClearDeleteCheckRadiusText: oneClickClearDeleteCheckRadiusText.value,
    oneClickClearDeleteCheckRadiusVisible: deleteOptimizationEnabled.value,
    routePlanningToleranceText: activeRoutePlanningToleranceText.value,
    workerCountText: pathfindingWorkerCountText.value,
  },
  recognition: {
    candidateTopRatioText: soldierTemplateCandidateTopRatioText.value,
    maximumSoldierCountText: maximumSoldierCountText.value,
    obstacleMaximumArea: graphwarObstacleMaxArea,
    obstacleMinAreaText: obstacleMinAreaText.value,
    templateMatchingWorkerCountText: templateMatchingWorkerCountText.value,
  },
  simulator: {
    parseDerivativeAsY: simulatorParseDerivativeAsY.value,
    skipUnknownCharacters: simulatorSkipUnknownCharacters.value,
  },
}));
// 截图/SVG 坐标像素：只描述 Graphwar 源码可视圈，不参与真实命中。
const soldierVisibleRadiusPixels = computed(() => getGraphwarPlaneRadiusPixels(GRAPHWAR_SOLDIER_VISIBLE_SIZE / 2));
// bounds 无效时没有真实换算比例；舞台仍用源码可视半径作为仅用于绘制的占位值。
const displayedSoldierVisibleRadiusPixels = computed(
  () => soldierVisibleRadiusPixels.value ?? GRAPHWAR_SOLDIER_VISIBLE_SIZE / 2,
);
const pathLineSegments = computed<GraphwarPathfindingLineSegment[]>(() => createPathLineSegments(pathPixels.value));

/** 按路径点圆半径截短线段，避免线条穿过点心。 */
function createPathLineSegments(points: readonly PixelPoint[]) {
  return createGraphwarPathLineSegments(points, displayedSoldierVisibleRadiusPixels.value);
}

/** 生成舞台参考线时使用 Graphwar 坐标再投影到截图，避免 CSS 像素网格和实际坐标错位。 */
function createStageCoordinateLines(bounds: GraphBounds, rect: BoundsRect): StageCoordinateLines {
  if (rect.width <= 0 || rect.height <= 0) {
    return { axisLines: [], gridLines: [] };
  }

  return {
    axisLines: createStageAxisLines(bounds, rect),
    gridLines: createStageGridLines(bounds, rect),
  };
}

function createStageAxisLines(bounds: GraphBounds, rect: BoundsRect): GraphwarPathfindingLineSegment[] {
  const lines: GraphwarPathfindingLineSegment[] = [];
  if (isStageCoordinateWithinBounds(0, bounds.minX, bounds.maxX)) {
    lines.push(createStageVerticalLine(0, bounds, rect));
  }
  if (isStageCoordinateWithinBounds(0, bounds.minY, bounds.maxY)) {
    lines.push(createStageHorizontalLine(0, bounds, rect));
  }
  return lines;
}

function createStageGridLines(bounds: GraphBounds, rect: BoundsRect): GraphwarPathfindingLineSegment[] {
  const lines: GraphwarPathfindingLineSegment[] = [];
  appendStageVerticalGridLines(lines, bounds, rect, selectStageGridStep(bounds.maxX - bounds.minX));
  appendStageHorizontalGridLines(lines, bounds, rect, selectStageGridStep(bounds.maxY - bounds.minY));
  return lines;
}

function appendStageVerticalGridLines(
  lines: GraphwarPathfindingLineSegment[],
  bounds: GraphBounds,
  rect: BoundsRect,
  step: number,
) {
  for (
    let x = getFirstStageGridCoordinate(bounds.minX, step);
    x <= bounds.maxX + graphwarStageGridAxisEpsilon;
    x += step
  ) {
    const coordinate = normalizeStageGridCoordinate(x);
    if (isStageAxisCoordinate(coordinate)) {
      continue;
    }
    lines.push(createStageVerticalLine(coordinate, bounds, rect));
  }
}

function appendStageHorizontalGridLines(
  lines: GraphwarPathfindingLineSegment[],
  bounds: GraphBounds,
  rect: BoundsRect,
  step: number,
) {
  for (
    let y = getFirstStageGridCoordinate(bounds.minY, step);
    y <= bounds.maxY + graphwarStageGridAxisEpsilon;
    y += step
  ) {
    const coordinate = normalizeStageGridCoordinate(y);
    if (isStageAxisCoordinate(coordinate)) {
      continue;
    }
    lines.push(createStageHorizontalLine(coordinate, bounds, rect));
  }
}

function createStageVerticalLine(x: number, bounds: GraphBounds, rect: BoundsRect): GraphwarPathfindingLineSegment {
  const start = graphToImagePoint(createGraphPoint(x, bounds.minY), bounds, rect);
  const end = graphToImagePoint(createGraphPoint(x, bounds.maxY), bounds, rect);
  return {
    x1: start.x,
    x2: end.x,
    y1: start.y,
    y2: end.y,
  };
}

function createStageHorizontalLine(y: number, bounds: GraphBounds, rect: BoundsRect): GraphwarPathfindingLineSegment {
  const start = graphToImagePoint(createGraphPoint(bounds.minX, y), bounds, rect);
  const end = graphToImagePoint(createGraphPoint(bounds.maxX, y), bounds, rect);
  return {
    x1: start.x,
    x2: end.x,
    y1: start.y,
    y2: end.y,
  };
}

function selectStageGridStep(range: number) {
  const rawStep = Math.max(1, Math.abs(range) / graphwarStageGridTargetLineCount);
  const scale = 10 ** Math.floor(Math.log10(rawStep));
  for (const multiplier of graphwarStageGridStepMultipliers) {
    const step = multiplier * scale;
    if (rawStep <= step) {
      return step;
    }
  }
  return 10 * scale;
}

function getFirstStageGridCoordinate(minimum: number, step: number) {
  return Math.ceil((minimum - graphwarStageGridAxisEpsilon) / step) * step;
}

function normalizeStageGridCoordinate(coordinate: number) {
  return isStageAxisCoordinate(coordinate) ? 0 : coordinate;
}

function isStageAxisCoordinate(coordinate: number) {
  return Math.abs(coordinate) <= graphwarStageGridAxisEpsilon;
}

function isStageCoordinateWithinBounds(coordinate: number, minimum: number, maximum: number) {
  return coordinate >= minimum - graphwarStageGridAxisEpsilon && coordinate <= maximum + graphwarStageGridAxisEpsilon;
}
const smartPathfindingPreviewPathPoints = computed(() => formatSvgPolylinePoints(smartPathfindingPreviewPath.value));
// 舞台 overlay 只应消费展示 DTO；业务规则和半径公式应由页面侧投影，避免子 Module 反向理解工作流。
const stageOverlay = computed(() => ({
  bounds: {
    allowedTargetRect: allowedTargetRect.value,
    axisLines: stageCoordinateLines.value.axisLines,
    clipBoundsRect: boundsRect.value,
    flashActive: boundsFlashActive.value,
    firstPoint: boundsFirstPoint.value,
    gridLines: stageCoordinateLines.value.gridLines,
    previewRect: boundsPreviewRect.value,
    visibleBoundaryExpansionRect: visibleBoundaryExpansionRect.value,
    visibleRect: visibleBoundsRect.value,
  },
  detection: {
    boxes: detectionBoxes.value,
    hoveredSoldierId: hoveredDetectedSoldierId.value,
    inactiveBoxes: inactiveDetectionBoxes.value,
    oneClickClearHitFlashActive: oneClickClearHitFlashActive.value,
    oneClickClearHitFlashBoxes: oneClickClearHitFlashSoldiers.value,
    soldierFlashActive: detectionSoldierFlashActive.value,
    soldierFlashBoxes: detectedSoldiers.value,
    visible: recognizedObjectOverlayVisible.value,
  },
  liveClickPreview: {
    curvePoints: liveClickPreviewCurvePoints.value,
    curveStrokeColor: trajectoryStrokeColor.value,
    label: liveClickPreviewLabel.value,
    lineSegments: liveClickPreviewLineSegments.value,
    points: liveClickPreviewPoints.value,
  },
  obstacles: {
    brushEraseEnabled: obstacleBrushEraseEnabled.value,
    brushPreview: obstacleBrushPreview.value,
    pathfindingEdgesActive: pathfindingObstacleEdgesActive.value,
    routeEdgePath: smartPathfindingObstacleRouteEdgePath.value,
    routeFillPath: smartPathfindingObstacleRouteFillPath.value,
    simulationEdgePath: smartPathfindingObstacleSimulationEdgePath.value,
    simulationFillPath: smartPathfindingObstacleSimulationFillPath.value,
    visible: recognizedObjectOverlayVisible.value,
    visibleEdgePath: visibleObstacleEdgePath.value,
    visibleFillPath: visibleObstacleFillPath.value,
  },
  path: {
    hoveredPointIndex: hoveredPathPointIndex.value,
    lineSegments: pathLineSegments.value,
    points: pathPixels.value,
    selfLabel: locale.ui.point.svgSelfLabel,
    selectionRadius: displayedSoldierVisibleRadiusPixels.value,
  },
  pathfinding: {
    blockedPoint: smartPathfindingBlockedPoint.value,
    blockedSegment: smartPathfindingBlockedSegment.value,
    inProgress: smartPathfindingInProgress.value,
    optimizationPreviewPoint: pathfindingOptimizationPreviewPoint.value,
    // 搜索动画只应表达“正在优化这个点”，沿用路径点可视圈，不引入单独预览半径。
    optimizationPreviewRadius: displayedSoldierVisibleRadiusPixels.value,
    previewAcceptedEdges: smartPathfindingPreviewAcceptedEdges.value,
    previewConnection: smartPathfindingPreviewConnection.value,
    previewCurrentPoint: smartPathfindingPreviewCurrentPoint.value,
    previewPathPoints: smartPathfindingPreviewPathPoints.value,
    previewPoints: smartPathfindingPreviewPoints.value,
  },
  trajectory: {
    curvePoints: plottedCurvePoints.value,
    strokeColor: trajectoryStrokeColor.value,
  },
  viewport: {
    imageHeight: imageHeight.value,
    imageWidth: imageWidth.value,
  },
}));
const magnifierStyle = computed(() => {
  const point = magnifierPoint.value;
  if (!magnifierEnabled.value || !imageUrl.value || !point) {
    return {};
  }

  const displayX = (point.x / imageWidth.value) * stageDisplayWidth.value;
  const displayY = (point.y / imageHeight.value) * stageDisplayHeight.value;
  const moveRight = displayX < stageDisplayWidth.value * 0.36;
  const moveUp = displayY > stageDisplayHeight.value * 0.68;
  const translateX = moveRight ? "18px" : `calc(-100% - 18px)`;
  const translateY = moveUp ? "calc(-100% - 18px)" : "18px";

  return {
    width: `${graphwarToolDefaults.magnifierSize}px`,
    height: `${graphwarToolDefaults.magnifierSize}px`,
    left: `${displayX}px`,
    top: `${displayY}px`,
    transform: `translate(${translateX}, ${translateY})`,
  };
});
const magnifierContentStyle = computed(() => {
  const point = magnifierPoint.value;
  if (!magnifierEnabled.value || !imageUrl.value || !point) {
    return {};
  }

  const displayX = (point.x / imageWidth.value) * stageDisplayWidth.value;
  const displayY = (point.y / imageHeight.value) * stageDisplayHeight.value;
  const size = graphwarToolDefaults.magnifierSize;
  const zoom = magnifierZoom.value;

  return {
    width: `${stageDisplayWidth.value}px`,
    height: `${stageDisplayHeight.value}px`,
    transform: `translate(${size / 2 - displayX * zoom}px, ${size / 2 - displayY * zoom}px) scale(${zoom})`,
  };
});
// 结果面板只应消费展示 DTO；公式生成、复制和坐标写回应由页面侧保持原工作流语义。
const resultPanel = computed(() => {
  const solverResult = formulaResult.value;
  return {
    agentFireButtonText: graphwarAgentFireButtonText.value,
    agentFireReason: getCapabilityReason(graphwarCapabilities.value.agentFire.reason),
    agentFireState: graphwarCapabilities.value.agentFire.state,
    agentFireVisible: graphwarAgentEnabled.value,
    canClearSimulatorInputs: canClearSimulatorInputs.value,
    canCopyFormula: canCopyFormula.value,
    calculationMessage: calculationMessage.value,
    calculationMessageVisible:
      Boolean(calculationMessage.value) && (toolWorkflowMode.value === "simulator" || !solverResult),
    copyButtonText: copyButtonText.value,
    equationLabel: equationModes.value.find((mode) => mode.value === equationMode.value)?.label ?? "",
    interactionDisabled: graphwarManagedModeEnabled.value,
    pointRows: createResultPanelPointRows(),
    secondOrderAngleHint: secondOrderAngleHint.value,
    showSimulatorLaunchAngleInput: toolWorkflowMode.value === "simulator" && equationMode.value === "ddy",
    simulatorFormulaText: simulatorFormulaText.value,
    simulatorLaunchAngleText: simulatorLaunchAngleText.value,
    solverExpression: solverResult?.expression ?? "",
    solverResultVisible: toolWorkflowMode.value === "solver" && !!solverResult,
    trajectoryWarning: trajectoryWarning.value,
    workflowMode: toolWorkflowMode.value,
  };
});
const screenshotImageStatusText = computed(
  () =>
    imageStatus.value ||
    imageName.value ||
    (graphwarAgentEnabled.value ? locale.status.agent.defaultStatus : locale.status.image.defaultStatus),
);
const stepGlitchAgentRecommendation = computed(() =>
  toolWorkflowMode.value === "solver" && effectiveStepGlitchModeEnabled.value && !graphwarAgentEnabled.value
    ? locale.ui.screenshot.stepGlitchAgentRecommendation(locale.ui.detection.agent.toggle)
    : "",
);
const trajectoryCalculationHeaderStatus = computed(() => {
  const status = trajectoryCalculationStatus.value;
  if (status.type === "in-progress") {
    return {
      kind: "warning" as const,
      message: locale.status.calculation.inProgress,
      title: locale.status.calculation.inProgress,
    };
  }
  if (status.type === "success") {
    const message = locale.status.calculation.success(formatElapsedDuration(status.elapsedMs));
    return {
      kind: "success" as const,
      message,
      title: message,
    };
  }
  if (status.type === "failure") {
    const message =
      status.stage === "formula" ? locale.status.calculation.solveFailed : locale.status.calculation.simulateFailed;
    return {
      kind: "error" as const,
      message,
      title: `${message}: ${status.message}`,
    };
  }
  return {
    ...emptyGraphwarScreenshotHeaderStatus,
  };
});
// 当前路径错误直接影响操作；计算状态覆盖长期 Agent 建议，成功超时后再恢复建议。
const screenshotHeaderStatus = computed(() =>
  getGraphwarScreenshotHeaderStatus({
    agentRecommendation: stepGlitchAgentRecommendation.value,
    calculationStatus: trajectoryCalculationHeaderStatus.value,
    pathError: pathStatus.value,
  }),
);
const screenshotStatusWarning = computed(() => {
  const reason = trajectoryCalculationFallbackReason.value;
  return {
    message: reason ? locale.status.calculation.fallbackWarning : "",
    title: reason ? locale.status.calculation.fallbackWarningTitle(reason) : "",
  };
});
// 截图面板只应消费展示 DTO；DOM refs 和舞台交互语义仍由页面侧工作流持有。
const screenshotPanel = computed<GraphwarScreenshotPanelModel>(() => ({
  busyOverlayVisible: detectionInProgress.value,
  headerStatus: screenshotHeaderStatus.value,
  imageStatusText: screenshotImageStatusText.value,
  imageUrl: imageUrl.value,
  magnifier: {
    contentStyle: magnifierContentStyle.value,
    style: magnifierStyle.value,
    visible: magnifierEnabled.value && Boolean(imageUrl.value) && Boolean(magnifierPoint.value),
  },
  stage: {
    empty: !imageUrl.value,
    emptyPlaceholder: graphwarAgentEnabled.value
      ? locale.ui.screenshot.agentPlaceholder
      : locale.ui.screenshot.placeholder,
    magnifierClipPathId: magnifierObstacleBrushClipPathId,
    mainClipPathId: mainObstacleBrushClipPathId,
    overlay: stageOverlay.value,
    style: stageStyle.value,
  },
  statusWarning: screenshotStatusWarning.value,
}));

function setScreenshotStageElement(element: HTMLElement | undefined) {
  stageRef.value = element;
}

function setScreenshotImageElement(element: HTMLImageElement | undefined) {
  imageRef.value = element;
}

function createResultPanelPointRows() {
  return mappedPathPoints.value.map((_, index) => {
    const pointNumber = index + 1;
    const label = pointNumber === 1 ? locale.ui.point.selfLabel : locale.ui.point.pathLabel(index);
    return {
      index,
      label,
      x: {
        ariaLabel: locale.ui.point.coordinateAriaLabel(label, "x"),
        text: getPathPointCoordinateText(index, "x"),
        title: locale.ui.point.coordinateTitle(label, "x"),
      },
      y: {
        ariaLabel: locale.ui.point.coordinateAriaLabel(label, "y"),
        text: getPathPointCoordinateText(index, "y"),
        title: locale.ui.point.coordinateTitle(label, "y"),
      },
    };
  });
}

function normalizeLiveClickPreviewWorkerCount(text: string) {
  const workerCount = parseFiniteNumber(text);
  return workerCount === undefined ||
    !Number.isInteger(workerCount) ||
    workerCount < 1 ||
    workerCount > GRAPHWAR_LIVE_CLICK_PREVIEW_WORKER_COUNT_MAXIMUM
    ? graphwarToolDefaults.liveClickPreviewWorkerCount
    : workerCount;
}

/** 托管锁定截图来源时忽略全局粘贴，避免绕过已禁用的上传入口。 */
function handleWindowPaste(event: ClipboardEvent) {
  if (!graphwarManagedModeEnabled.value) {
    handlePaste(event);
  }
}

onMounted(() => {
  window.addEventListener("paste", handleWindowPaste);
  document.addEventListener("visibilitychange", handleGraphwarManagedVisibilityChange);
});

onBeforeUnmount(() => {
  window.removeEventListener("paste", handleWindowPaste);
  document.removeEventListener("visibilitychange", handleGraphwarManagedVisibilityChange);
  stopGraphwarManagedMode(false);
  detectionWorkflow.dispose();
  graphwarPathfindingRunner.close();
  cancelSmartPathfinding(false);
  disposeTrajectoryResult();
  disposeResultActions();
  // 页面销毁后不再允许开火反馈定时器回写响应式状态。
  if (graphwarAgentFireStatusTimer) {
    clearTimeout(graphwarAgentFireStatusTimer);
    graphwarAgentFireStatusTimer = undefined;
  }
  disposeLiveClickPreview();
  disposeDebugActivation();
  disposeStageFeedback();
  disposeObstacleEditor();
  clearSmartPathfindingBlockedPoint();
});

watch([maximumSoldierCountText, obstacleMinAreaText, soldierTemplateCandidateTopRatioText], () => {
  clearSmartPathfindingStatus();
  scheduleGraphwarObjectDetection();
});

watch(
  detectedSoldiers,
  (soldiers) => {
    if (snapSoldiersPreference.value === undefined && soldiers.length > 0) {
      snapSoldiersPreference.value = true;
    }
  },
  { deep: false },
);

watch(detectedObstacles, (obstacles) => {
  if (collisionCheckPreference.value === undefined && obstacles) {
    collisionCheckPreference.value = true;
  }
});

watch([formulaOutputDecimalPlaces], () => {
  if (toolWorkflowMode.value !== "solver") {
    return;
  }
  cancelSmartPathfinding(false);
  clearSmartPathfindingStatus();
});

watch([algorithmMode, solverEquationMode], () => {
  if (graphwarManagedModeEnabled.value) {
    // 托管已在启动新 scene 前同步作废旧搜索，不能让 Vue 的延迟 watcher 再取消刚启动的任务。
    return;
  }
  clearSmartPathfindingStatus();
  cancelSmartPathfinding(false);
});

watch([stepOverflowProtectionEnabled], () => {
  if (toolWorkflowMode.value !== "solver" || algorithmMode.value !== "step") {
    return;
  }
  cancelSmartPathfinding(false);
  clearSmartPathfindingStatus();
});

watch([activeObstacleSimulationToleranceText], () => {
  if (collisionCheckEnabled.value || activePathfindingTask) {
    cancelSmartPathfinding(false);
    clearSmartPathfindingStatus();
  }
});

watch(steepnessText, () => {
  if (toolWorkflowMode.value !== "solver" || algorithmMode.value !== "step") {
    return;
  }
  cancelSmartPathfinding(false);
  clearSmartPathfindingStatus();
});

watch(effectiveStepGlitchModeEnabled, () => {
  if (graphwarManagedModeEnabled.value) {
    return;
  }
  cancelSmartPathfinding(false);
  clearSmartPathfindingStatus();
});

watch(detectedObstacles, () => {
  if (toolMode.value === "obstacle" && !obstacleBrushAvailable.value) {
    setToolMode("path");
  }
});

watch([activeRoutePlanningToleranceText, minXText, maxXText, minYText, maxYText], () => {
  if (graphwarManagedModeEnabled.value) {
    return;
  }
  // 这些输入会改变几何搜索、worker 并行或公式边界语义，页面 cache 和 worker cache 必须一起失效。
  cancelSmartPathfinding(false);
  invalidatePathfindingCaches();
  clearSmartPathfindingStatus();
});

watch(pathfindingWorkerCountText, () => {
  if (
    graphwarManagedModeEnabled.value ||
    activePathfindingTask?.kind !== "one-click" ||
    !activePathfindingTask.usesDagWorker
  ) {
    return;
  }
  cancelSmartPathfinding(false);
  clearSmartPathfindingStatus();
});

watch(oneClickClearDeleteCheckRadiusText, () => {
  if (!deleteOptimizationEnabled.value) {
    return;
  }
  if (activePathfindingTask?.kind === "one-click") {
    cancelSmartPathfinding(false);
  }
  invalidatePathfindingResultCache();
  clearSmartPathfindingStatus();
});

/** 三种游戏模式始终可进入；不兼容算法由对应 profile 的算法选择器禁用。 */
function isEquationModeDisabled() {
  return false;
}

/** 切换公式生成/模拟器工作流，并清理只属于旧工作流的临时状态。 */
function setToolWorkflowMode(mode: ToolWorkflowMode) {
  if (graphwarManagedModeEnabled.value || toolWorkflowMode.value === mode) {
    return;
  }

  cancelSmartPathfinding(false);
  clearSmartPathfindingStatus();
  if (mode === "simulator") {
    const solverResult = formulaResult.value;
    if (!simulatorFormulaText.value.trim() && solverResult) {
      simulatorEquationMode.value = solverEquationMode.value;
      simulatorFormulaText.value = solverResult.expression;
      simulatorLaunchAngleText.value = secondOrderLaunchAngleText.value;
    }
    if (simulatorPathPixels.value.length === 0 && solverPathPixels.value.length > 0) {
      simulatorPathPixels.value = [solverPathPixels.value[0]];
      simulatorTrajectoryStrokeColor.value = solverTrajectoryStrokeColor.value;
    }
  }
  toolWorkflowMode.value = mode;
  clearPathInteractionState();
  hoveredDetectedSoldierId.value = undefined;
}

/** 切换公式解释模式；若算法不支持则忽略，避免 UI 进入无效组合。 */
function setEquationMode(mode: EquationMode) {
  if (graphwarManagedModeEnabled.value || equationMode.value === mode) {
    return;
  }
  clearSmartPathfindingStatus();
  equationMode.value = mode;
}

/** 更新当前游戏模式的公式算法；y'' 不接受双绝对值，但不会影响其他 profile。 */
function setAlgorithmMode(mode: AlgorithmMode) {
  if (graphwarManagedModeEnabled.value || (solverEquationMode.value === "ddy" && mode === "abs")) {
    return;
  }
  algorithmMode.value = mode;
}

/** 开启邪道时原子进入其唯一有效组合；关闭时只保留当前公式模式。 */
function toggleStepGlitchMode() {
  if (graphwarManagedModeEnabled.value) {
    return;
  }
  if (stepGlitchModeEnabled.value) {
    stepGlitchModeEnabled.value = false;
    return;
  }
  setToolWorkflowMode("solver");
  solverEquationMode.value = "dy";
  algorithmMode.value = "step";
  stepGlitchModeEnabled.value = true;
}

/** 新截图应用后清理依赖旧图片的业务状态；旧边界矩形只保留为参考，需要重新确认后才可用于识别。 */
function handleAppliedScreenshot() {
  clearAllModePaths();
  clearDetections();
  clearActiveBounds();
  boundsFirstPoint.value = undefined;
  pointerPreviewPoint.value = undefined;
  magnifierPoint.value = undefined;
}

/** 截图尺寸落地后重置临时框选点，并按新像素重新识别对象。 */
function handleLoadedScreenshot() {
  boundsFirstPoint.value = undefined;
  pointerPreviewPoint.value = undefined;
  if (graphwarAgentImageLoadBypassUrl && imageUrl.value === graphwarAgentImageLoadBypassUrl) {
    graphwarAgentImageLoadBypassUrl = "";
    return;
  }
  if (autoDetectionEnabled.value) {
    void runAutomaticGraphwarDetection();
  }
}

/** 清除自动识别的士兵标记。 */
function clearDetections() {
  detectionWorkflow.clear();
}

/** 清除当前截图的有效边界标记；boundsRect 数值保留给舞台显示和用户参考。 */
function clearActiveBounds() {
  boundsReady.value = false;
}

/** 判断异步检测回调是否仍属于当前运行。 */
function isActiveDetectionRun(runId: number) {
  return detectionWorkflow.isActiveRun(runId);
}

/** 取消当前检测任务，并按调用场景决定是否显示取消提示。 */
function cancelDetection(showStatus: boolean) {
  return detectionWorkflow.cancel(showStatus);
}

/** 展开或折叠高级设置面板。 */
function toggleAdvancedSettings() {
  if (graphwarManagedModeEnabled.value) {
    return;
  }
  advancedSettingsVisible.value = !advancedSettingsVisible.value;
}

/** 设置检测状态主文案，并清掉上一轮警告详情。 */
function setDetectionStatus(message: string, kind: DetectionStatusKind) {
  detectionWorkflow.setStatus(message, kind);
}

/** 写入已确认的截图边界；边界变化会让所有基于旧矩形的寻路缓存失效。 */
function applyDetectedBounds(edgeRect: BoundsRect) {
  boundsRect.value = edgeRect;
  boundsReady.value = true;
  invalidatePathfindingCaches();
  boundsFirstPoint.value = undefined;
  pointerPreviewPoint.value = undefined;
}

/** 返回“识别士兵/障碍”按钮说明；禁用时说明缺少的前置边界。 */
function getDetectObjectsTitle() {
  if (!imageUrl.value) {
    return getMissingStateImageMessage();
  }
  return activeBoundsReady.value
    ? locale.ui.detection.detectObjectsTitle
    : locale.ui.detection.detectObjectsNeedBoundsTitle;
}

function getMissingStateImageMessage() {
  return graphwarAgentEnabled.value ? locale.status.agent.readFirst : locale.status.detection.uploadFirst;
}

/** 有效截图边界至少需要能形成可见区域，和手动画框提交阈值保持一致。 */
function isUsableBoundsRect(rect: BoundsRect) {
  return rect.width >= graphwarBoundsMinimumSizePixels && rect.height >= graphwarBoundsMinimumSizePixels;
}

/** 延迟重新识别，合并连续设置变化，避免每次输入都立即读像素。 */
function scheduleGraphwarObjectDetection() {
  if (graphwarAgentEnabled.value) {
    return;
  }
  detectionWorkflow.schedule();
}

/** 完整自动识别入口：只处理截图像素；Agent 读取保持手动触发。 */
async function runAutomaticGraphwarDetection() {
  if (graphwarAgentEnabled.value) {
    return;
  }

  await detectGraphwarObjects("auto");
}

/** 当前边界内的自动刷新入口；Agent 读取保持手动触发。 */
async function runAutomaticGraphwarObjectsInCurrentBounds() {
  if (graphwarAgentEnabled.value) {
    return;
  }

  await detectGraphwarObjectsInCurrentBounds("auto");
}

/** 使用 Canvas 像素自动检测 Graphwar 坐标系边界，再按该边界识别士兵和障碍。 */
async function detectGraphwarObjects(trigger: GraphwarDetectionRunTrigger = "manual") {
  if (graphwarManagedModeEnabled.value) {
    return;
  }
  await detectionWorkflow.detect(trigger);
}

/** 只识别 Graphwar 坐标系边界，并清除旧边界下的士兵和障碍结果。 */
async function detectGraphwarBounds(trigger: GraphwarDetectionRunTrigger = "manual") {
  if (graphwarManagedModeEnabled.value) {
    return;
  }
  await detectionWorkflow.detectBounds(trigger);
}

/** 在当前手动/自动边界内重新识别对象，不重新推断坐标系区域。 */
async function detectGraphwarObjectsInCurrentBounds(trigger: GraphwarDetectionRunTrigger = "manual") {
  if (graphwarManagedModeEnabled.value) {
    return;
  }
  await detectionWorkflow.detectInCurrentBounds(trigger);
}

/** 从本机 Graphwar Agent 读取当前渲染状态，直接落地为精确士兵和障碍数据。 */
async function readGraphwarAgent(trigger: GraphwarDetectionRunTrigger = "manual") {
  if (trigger === "auto") {
    return;
  }
  const capability = graphwarCapabilities.value.agentRead;
  if (capability.state !== "normal") {
    setDetectionStatus(getCapabilityReason(capability.reason) ?? "", "warning");
    return;
  }

  const requestBaseUrl = normalizedGraphwarAgentBaseUrl.value;
  if (!requestBaseUrl) {
    return;
  }
  const requestGeneration = ++graphwarAgentReadGeneration;
  // 同一代次、来源和规范化 URL 必须全部匹配，响应才仍属于当前页面场景。
  const requestIsCurrent = () =>
    requestGeneration === graphwarAgentReadGeneration &&
    !graphwarManagedModeEnabled.value &&
    graphwarAgentEnabled.value &&
    normalizedGraphwarAgentBaseUrl.value === requestBaseUrl;
  graphwarAgentReadInProgress.value = true;
  cancelDetection(false);
  imageStatus.value = locale.status.agent.reading;
  setDetectionStatus(locale.status.agent.reading, "warning");
  try {
    const snapshot = await readGraphwarAgentSnapshot(requestBaseUrl);
    // Agent 响应只属于发起时的来源和规范化地址；迟到响应不能覆盖用户刚切换的新场景。
    if (!requestIsCurrent()) {
      return;
    }
    applyGraphwarAgentSnapshot(snapshot, snapshot.localCurrentTurnSoldierPoint);
  } catch (error) {
    if (!requestIsCurrent()) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const failedMessage = locale.status.agent.failed(message);
    imageStatus.value = failedMessage;
    setDetectionStatus(failedMessage, "error");
  } finally {
    if (requestGeneration === graphwarAgentReadGeneration) {
      graphwarAgentReadInProgress.value = false;
    }
  }
}

/** 把同一 revision 的 Agent 视角原子写入页面，并按调用方决定是否替换发射点。 */
function applyGraphwarAgentSnapshot(snapshot: GraphwarAgentSnapshot, pathStart: PixelPoint | undefined) {
  graphwarAgentBaseUrlText.value = snapshot.baseUrl;
  if (imageUrl.value !== snapshot.imageUrl) {
    graphwarAgentImageLoadBypassUrl = snapshot.imageUrl;
    applyGeneratedImage(snapshot.imageUrl, snapshot.imageName, GRAPHWAR_PLANE_LENGTH, GRAPHWAR_PLANE_HEIGHT);
  }
  resetGraphwarDefaultBoundsTexts();
  applyGraphwarAgentEquationMode(snapshot.equationMode);
  detectionWorkflow.applyExternalResult(
    snapshot.boundsRect,
    snapshot.detectionResult,
    locale.status.agent.loaded(snapshot.detectionResult.soldiers.length),
  );
  detectionProvenance.value = {
    battleRevision: snapshot.state.battleRevision,
    gameInstanceId: snapshot.state.gameInstanceId,
    normalizedAgentUrl: normalizeGraphwarAgentBaseUrl(snapshot.baseUrl).toString(),
    source: "agent",
  };
  // Agent 当前回合是权威状态；只替换发射点，保留用户已经选好的后续目标。
  if (pathStart) {
    setPathPixels(pathPixels.value.length > 0 ? [pathStart, ...pathPixels.value.slice(1)] : [pathStart]);
  }
  toolMode.value = "path";
  imageStatus.value = "";
}

/** 通过 Agent 调用 Graphwar 原版开火路径，提交当前结果面板里的函数文本。 */
async function fireGraphwarAgentFunction() {
  const capability = graphwarCapabilities.value.agentFire;
  if (capability.state !== "normal") {
    graphwarAgentFireFailureMessage.value = getCapabilityReason(capability.reason) ?? "";
    setGraphwarAgentFireStatus("error");
    return;
  }

  graphwarAgentFireInProgress.value = true;
  setGraphwarAgentFireStatus("idle");
  try {
    const client = createGraphwarAgentClient(graphwarAgentBaseUrlText.value);
    const state = await client.readState();
    if (!state.available || state.phase !== "aiming") {
      throw new Error(state.available ? "Graphwar is not accepting a shot" : state.reason);
    }
    const functionText =
      toolWorkflowMode.value === "solver" ? formulaResult.value?.expression : simulatorFormulaText.value;
    if (!functionText?.trim() || equationMode.value !== state.equationMode) {
      throw new Error("The current result does not match the active Graphwar mode");
    }
    graphwarAgentBaseUrlText.value = client.baseUrl;
    if (state.equationMode === "ddy") {
      const launchAngleRadians =
        toolWorkflowMode.value === "solver"
          ? secondOrderLaunchAngleDegrees.value === undefined
            ? undefined
            : (secondOrderLaunchAngleDegrees.value * Math.PI) / 180
          : simulatorLaunchAngleRadians.value;
      if (launchAngleRadians === undefined) {
        throw new Error("The current result does not match the active Graphwar mode");
      }
      await client.submitShot(
        createGraphwarAgentShotRequest(state, {
          angleRadians: launchAngleRadians,
          equationMode: "ddy",
          function: functionText,
        }),
      );
    } else {
      await client.submitShot(
        createGraphwarAgentShotRequest(state, { equationMode: state.equationMode, function: functionText }),
      );
    }
    setGraphwarAgentFireStatus("success");
  } catch (error) {
    graphwarAgentFireFailureMessage.value = error instanceof Error ? error.message : String(error);
    setGraphwarAgentFireStatus("error");
  } finally {
    graphwarAgentFireInProgress.value = false;
  }
}

/** 设置开火按钮短反馈；和复制按钮一样，非 idle 状态会自动复位。 */
function setGraphwarAgentFireStatus(status: TransferStatus) {
  graphwarAgentFireStatus.value = status;
  if (status !== "error") {
    graphwarAgentFireFailureMessage.value = "";
  }
  if (graphwarAgentFireStatusTimer) {
    clearTimeout(graphwarAgentFireStatusTimer);
    graphwarAgentFireStatusTimer = undefined;
  }

  if (status !== "idle") {
    graphwarAgentFireStatusTimer = setTimeout(() => {
      graphwarAgentFireStatus.value = "idle";
      graphwarAgentFireFailureMessage.value = "";
      graphwarAgentFireStatusTimer = undefined;
    }, graphwarAgentStatusFlashMs);
  }
}

/** Agent 状态固定使用 Graphwar 官方平面范围，避免沿用上一张截图的手动标定。 */
function resetGraphwarDefaultBoundsTexts() {
  minXText.value = `-${graphwarDefaultXLimitText}`;
  maxXText.value = graphwarDefaultXLimitText;
  minYText.value = `-${graphwarVisibleYLimitText}`;
  maxYText.value = graphwarVisibleYLimitText;
}

/** 如果当前算法允许，就同步 Graphwar 房间的游戏模式。 */
function applyGraphwarAgentEquationMode(mode: EquationMode | undefined) {
  if (!mode) {
    return;
  }
  if (toolWorkflowMode.value === "simulator") {
    simulatorEquationMode.value = mode;
  } else {
    solverEquationMode.value = mode;
  }
}

/** 切换托管模式；开启前重新执行完整资格检查，关闭始终可用。 */
function toggleGraphwarManagedMode() {
  if (graphwarManagedModeEnabled.value) {
    stopGraphwarManagedMode(true);
    return;
  }
  const capability = graphwarCapabilities.value.managedMode;
  if (capability.state !== "normal") {
    setSmartPathfindingStatus(
      getCapabilityReason(capability.reason) ?? locale.ui.pathfinding.managedModeTitle,
      "warning",
    );
    return;
  }

  const repairPlan = createGraphwarManagedFormulaProfileRepairPlan(solverFormulaProfiles.value);
  if (!graphwarManagedModeConfirmed) {
    const repairedModes = locale.equationModes
      .filter((mode) => repairPlan[mode.value] !== undefined)
      .map((mode) => mode.label)
      .join(", ");
    if (!window.confirm(locale.ui.pathfinding.managedModeConfirmation(repairedModes, friendlyFireEnabled.value))) {
      return;
    }
    graphwarManagedModeConfirmed = true;
  }
  solverFormulaProfiles.value = applyGraphwarManagedFormulaProfileRepairPlan(solverFormulaProfiles.value, repairPlan);

  let client: GraphwarAgentClient;
  try {
    client = createGraphwarAgentClient(graphwarAgentBaseUrlText.value);
  } catch (error) {
    setSmartPathfindingStatus(error instanceof Error ? error.message : String(error), "error");
    return;
  }

  cancelSmartPathfinding(false);
  clearSmartPathfindingStatus();
  clearSmartPathfindingBlockedPoint();
  clearActivePathState();
  clearPathInteractionState();
  clearObstacleBrushInteractionState();
  setGraphwarAgentFireStatus("idle");
  invalidatePendingUserImageRequests();
  graphwarManagedClient = client;
  graphwarAgentBaseUrlText.value = client.baseUrl;
  graphwarManagedModeEnabled.value = true;
  graphwarManagedSceneKey = "";
  graphwarManagedIncumbent = undefined;
  graphwarManagedSearchStartedAt = undefined;
  graphwarManagedSearchState = "idle";
  graphwarManagedLastSubmittedTurnToken = undefined;
  graphwarManagedDeadlineTurnToken = undefined;
  graphwarManagedWakeLockGeneration += 1;
  toolMode.value = "path";
  setGraphwarManagedStatus(locale.smartPathfinding.managed.enabled, "warning");

  graphwarManagedController = createGraphwarManagedController({
    client,
    hooks: {
      decideDeadlineShot: (state) => {
        const searchStartedAt = graphwarManagedSearchStartedAt;
        cancelGraphwarManagedSearch();
        const plan = createGraphwarManagedShotPlan(state);
        const incumbent = graphwarManagedIncumbent;
        if (!plan || !incumbent) {
          return undefined;
        }
        if (searchStartedAt !== undefined) {
          showGraphwarManagedCalculationStatus(
            locale.smartPathfinding.managed.deadlinePlan(
              incumbent.targetCount,
              formatElapsedDuration(nowMs() - searchStartedAt),
            ),
            "warning",
          );
        }
        // 截止时把主线程保存的完整验证方案一次性发布到路径、公式和命中展示。
        applyValidatedPath(incumbent.pathPoints, incumbent.targetSequence);
        flashOneClickClearHitSoldiers(incumbent.targetIds);
        graphwarManagedDeadlineTurnToken = state.turnToken;
        return plan;
      },
      onDeadlineWithoutShot: () => {
        cancelGraphwarManagedSearch();
        setGraphwarManagedStatus(locale.smartPathfinding.managed.deadlineNoPlan, "error");
      },
      onIncompatibleError: () => {
        stopGraphwarManagedMode(false);
        setSmartPathfindingStatus(locale.smartPathfinding.managed.incompatible, "error");
      },
      onReadyRequested: () => {
        setGraphwarManagedStatus(locale.smartPathfinding.managed.readying, "warning");
      },
      onRoom: () => {
        resetGraphwarManagedSearch();
        setGraphwarManagedStatus(locale.smartPathfinding.managed.waitingForGame, "warning");
      },
      onShotFailed: (state, _plan, error) => {
        if (graphwarManagedController?.getLatestState()?.turnToken !== state.turnToken) {
          return;
        }
        if (graphwarManagedLastSubmittedTurnToken === state.turnToken) {
          setGraphwarManagedStatus(locale.smartPathfinding.managed.shotUnknown(error.message), "error");
          return;
        }
        graphwarManagedSearchState = "failure";
        setGraphwarManagedStatus(locale.smartPathfinding.managed.searchFailed, "error");
      },
      onShotSubmitted: (state) => {
        graphwarManagedLastSubmittedTurnToken = state.turnToken;
        setGraphwarManagedStatus(locale.ui.result.firing, "warning");
      },
      onShotSucceeded: (state) => {
        if (graphwarManagedLastSubmittedTurnToken !== state.turnToken) {
          return;
        }
        setGraphwarManagedStatus(
          graphwarManagedDeadlineTurnToken === state.turnToken
            ? locale.smartPathfinding.managed.deadlineFired
            : locale.smartPathfinding.managed.successFired,
          graphwarManagedDeadlineTurnToken === state.turnToken ? "warning" : "success",
        );
      },
      onState: handleGraphwarManagedState,
      onTransientError: (error) => {
        setGraphwarManagedStatus(locale.smartPathfinding.managed.connectionFailed(error.message), "error");
      },
      onWaiting: () => {
        resetGraphwarManagedSearch();
        setGraphwarManagedStatus(locale.smartPathfinding.managed.waitingForGame, "warning");
      },
    },
  });
  graphwarManagedController.start();
  void requestGraphwarManagedWakeLock();
}

/** 停止轮询和搜索并解锁输入；已发布的最后路径和公式保持不变。 */
function stopGraphwarManagedMode(showStatus: boolean) {
  graphwarManagedModeEnabled.value = false;
  clearGraphwarManagedCalculationStatus();
  graphwarManagedWakeLockGeneration += 1;
  graphwarManagedController?.stop();
  graphwarManagedController = undefined;
  graphwarManagedClient = undefined;
  resetGraphwarManagedSearch();
  graphwarManagedDeadlineTurnToken = undefined;
  graphwarManagedLastSubmittedTurnToken = undefined;
  void releaseGraphwarManagedWakeLock();
  if (showStatus) {
    setSmartPathfindingStatus(locale.smartPathfinding.managed.stopped, "warning");
  }
}

/** 仅在当前本地真人回合中按权威 world 快照启动一次搜索。 */
function handleGraphwarManagedState(
  state: GraphwarAgentAvailableState,
  shooter: GraphwarManagedShooter | undefined,
  worldObstacleMask: Uint8Array | undefined,
) {
  if (!graphwarManagedModeEnabled.value || !graphwarManagedClient) {
    return;
  }
  if (!shooter || !state.turnToken || !worldObstacleMask) {
    resetGraphwarManagedSearch();
    setGraphwarManagedStatus(locale.smartPathfinding.managed.waitingForTurn, "warning");
    return;
  }

  applyGraphwarAgentEquationMode(state.equationMode);
  resetGraphwarDefaultBoundsTexts();
  const sceneKey = createGraphwarManagedSceneKey(state, shooter);
  if (!sceneKey) {
    stopGraphwarManagedMode(false);
    setSmartPathfindingStatus(locale.smartPathfinding.managed.incompatible, "error");
    return;
  }
  if (sceneKey === graphwarManagedSceneKey) {
    if (
      graphwarManagedSearchState === "success" &&
      state.remainingTurnMs > GRAPHWAR_MANAGED_SHOT_DEADLINE_MS &&
      isGraphwarManagedCurrentLocalTurn(state)
    ) {
      submitGraphwarManagedShot(state);
    } else if (graphwarManagedSearchState === "success" && graphwarManagedLastSubmittedTurnToken !== state.turnToken) {
      setGraphwarManagedStatus(locale.smartPathfinding.managed.completedWaiting, "success");
    } else if (graphwarManagedSearchState === "running") {
      setGraphwarManagedStatus(
        locale.smartPathfinding.managed.calculating(graphwarManagedIncumbent?.targetCount),
        "warning",
      );
    }
    return;
  }

  cancelGraphwarManagedSearch();
  clearGraphwarManagedCalculationStatus();
  graphwarManagedSceneKey = sceneKey;
  graphwarManagedIncumbent = undefined;
  graphwarManagedSearchStartedAt = undefined;
  graphwarManagedSearchState = "idle";
  graphwarManagedDeadlineTurnToken = undefined;
  graphwarManagedLastSubmittedTurnToken = undefined;
  const snapshot = createGraphwarAgentShooterViewSnapshot(
    createGraphwarAgentWorldSnapshot(graphwarManagedClient.baseUrl, state, worldObstacleMask),
    shooter.player.id,
    shooter.soldier.index,
  );
  const shooterBox = snapshot.detectionResult.soldiers.find(
    (soldier) => soldier.playerId === shooter.player.id && soldier.soldierIndex === shooter.soldier.index,
  );
  if (!shooterBox) {
    stopGraphwarManagedMode(false);
    setSmartPathfindingStatus(locale.smartPathfinding.managed.incompatible, "error");
    return;
  }
  applyGraphwarAgentSnapshot(snapshot, undefined);
  setPathPixels([createPixelPoint(shooterBox.sourceCenterX, shooterBox.sourceCenterY)]);
  void runGraphwarManagedSearch(sceneKey);
}

/** 绑定当前权威回合和所有搜索语义，确保结果不会跨回合复用。 */
function createGraphwarManagedSceneKey(state: GraphwarAgentAvailableState, shooter: GraphwarManagedShooter) {
  const tolerances = effectiveOneClickClearTolerances.value;
  if (!parsedBounds.value.ok || !parsedPathfindingWorkerCount.value.ok || !tolerances) {
    return "";
  }
  const settings = createPathTrajectoryFormulaSettings();
  return JSON.stringify({
    algorithm: settings.algorithm,
    battleRevision: state.battleRevision,
    bounds: parsedBounds.value.bounds,
    decimalPlaces: settings.decimalPlaces,
    deleteOptimizationEnabled: deleteOptimizationEnabled.value,
    equation: state.equationMode,
    formulaPathSteepness: settings.formulaPathSteepness,
    friendlyFire: friendlyFireEnabled.value,
    gameInstanceId: state.gameInstanceId,
    pathfindingWorkerCount: parsedPathfindingWorkerCount.value.workerCount,
    routeMode: settings.stepGlitchMode ? "visibility-graph" : getPathfindingRouteMode(),
    shooterPlayerId: shooter.player.id,
    shooterSoldierIndex: shooter.soldier.index,
    shooterTeam: shooter.player.team,
    steepness: settings.steepness,
    stepGlitchMode: settings.stepGlitchMode,
    stepOverflowProtection: settings.stepOverflowProtection,
    tolerances,
    turnToken: state.turnToken,
  });
}

/** 运行一次无跨回合结果缓存的 anytime 搜索，并只接收当前 scene generation 的结果。 */
async function runGraphwarManagedSearch(sceneKey: string) {
  const searchGeneration = ++graphwarManagedSearchGeneration;
  graphwarManagedSearchStartedAt = nowMs();
  graphwarManagedSearchState = "running";
  setGraphwarManagedStatus(locale.smartPathfinding.managed.calculating(), "warning");
  const succeeded = await runOneClickClearWorkflow({
    onIncumbent: (incumbent) => {
      if (
        !graphwarManagedModeEnabled.value ||
        searchGeneration !== graphwarManagedSearchGeneration ||
        sceneKey !== graphwarManagedSceneKey
      ) {
        return;
      }
      graphwarManagedIncumbent = incumbent;
      setGraphwarManagedStatus(locale.smartPathfinding.managed.calculating(incumbent.targetCount), "warning");
    },
    onSuccessBeforeEffects: () => {
      if (
        !graphwarManagedModeEnabled.value ||
        searchGeneration !== graphwarManagedSearchGeneration ||
        sceneKey !== graphwarManagedSceneKey ||
        !graphwarManagedIncumbent
      ) {
        return;
      }
      graphwarManagedSearchState = "success";
      const state = graphwarManagedController?.getLatestState();
      if (
        state &&
        state.remainingTurnMs > GRAPHWAR_MANAGED_SHOT_DEADLINE_MS &&
        isGraphwarManagedCurrentLocalTurn(state)
      ) {
        // 方案已经完整验证；必须在 workflow 写回最终路径或完成状态前提交，不把页面刷新放进关键路径。
        if (submitGraphwarManagedShot(state)) {
          return;
        }
      }
      setGraphwarManagedStatus(locale.smartPathfinding.managed.completedWaiting, "success");
    },
    useResultCache: false,
  });
  if (
    !graphwarManagedModeEnabled.value ||
    searchGeneration !== graphwarManagedSearchGeneration ||
    sceneKey !== graphwarManagedSceneKey
  ) {
    return;
  }
  if (!succeeded || !graphwarManagedIncumbent) {
    graphwarManagedSearchState = "failure";
    graphwarManagedSearchStartedAt = undefined;
    setGraphwarManagedStatus(locale.smartPathfinding.managed.searchFailed, "error");
  }
}

/** 取消当前 Worker 并递增 generation，使迟到的 incumbent 和完成结果都无法回写。 */
function cancelGraphwarManagedSearch() {
  graphwarManagedSearchGeneration += 1;
  if (smartPathfindingInProgress.value) {
    cancelSmartPathfinding(false);
  }
  if (graphwarManagedSearchState === "running") {
    graphwarManagedSearchState = "idle";
  }
}

/** 离开活动局面时丢弃未发布方案，但保留页面上最后一次已发布结果。 */
function resetGraphwarManagedSearch() {
  cancelGraphwarManagedSearch();
  graphwarManagedSceneKey = "";
  graphwarManagedIncumbent = undefined;
  graphwarManagedSearchStartedAt = undefined;
  graphwarManagedSearchState = "idle";
}

/** 仅将当前完整指纹下的验证结果转换为 Agent 的模式化发射参数。 */
function createGraphwarManagedShotPlan(state: GraphwarAgentAvailableState): GraphwarAgentShotPlan | undefined {
  const incumbent = graphwarManagedIncumbent;
  const player = state.players[state.currentTurn];
  const soldier = player?.soldiers[player.currentTurnSoldier];
  if (
    !incumbent ||
    !player ||
    !soldier?.alive ||
    !player.local ||
    player.computer ||
    player.disconnected ||
    !incumbent.expression.trim() ||
    createGraphwarManagedSceneKey(state, { player, soldier }) !== graphwarManagedSceneKey
  ) {
    return undefined;
  }
  if (state.equationMode !== "ddy") {
    return { equationMode: state.equationMode, function: incumbent.expression };
  }
  return incumbent.launchAngleRadians === undefined
    ? undefined
    : { angleRadians: incumbent.launchAngleRadians, equationMode: "ddy", function: incumbent.expression };
}

/** 正常完成只提交 controller 当前快照，并返回本回合是否已在 await 前完成 once-only claim。 */
function submitGraphwarManagedShot(state: GraphwarAgentAvailableState) {
  const plan = createGraphwarManagedShotPlan(state);
  return plan ? (graphwarManagedController?.submitShot(state, plan) ?? false) : false;
}

/** 检查最新权威回合是否属于当前本地真人发射者。 */
function isGraphwarManagedCurrentLocalTurn(state: GraphwarAgentAvailableState) {
  const player = state.players[state.currentTurn];
  return Boolean(
    state.phase === "aiming" &&
    player?.local &&
    !player.computer &&
    !player.disconnected &&
    player.soldiers[player.currentTurnSoldier]?.alive,
  );
}

/** 保存托管状态；后台警告临时覆盖展示，回到前台后恢复真实状态。 */
function setGraphwarManagedStatus(message: string, kind: SmartPathfindingStatusKind) {
  graphwarManagedStatusMessage = message;
  graphwarManagedStatusKind = kind;
  // 错误必须立即可见；普通轮询和成功回调则等耗时状态展示完再替换。
  if (kind === "error") {
    clearGraphwarManagedCalculationStatus();
  } else if (graphwarManagedCalculationStatus) {
    if (nowMs() < graphwarManagedCalculationStatus.expiresAt) {
      return;
    }
    clearGraphwarManagedCalculationStatus();
  }
  setSmartPathfindingStatus(
    typeof document !== "undefined" && document.visibilityState === "hidden"
      ? locale.smartPathfinding.managed.backgroundWarning
      : message,
    typeof document !== "undefined" && document.visibilityState === "hidden" ? "warning" : kind,
  );
}

/** 展示已验证方案的计算耗时，同时让发射和轮询状态在后台继续更新。 */
function showGraphwarManagedCalculationStatus(message: string, kind: SmartPathfindingStatusKind) {
  clearGraphwarManagedCalculationStatus();
  const status = {
    expiresAt: nowMs() + graphwarAgentStatusFlashMs,
    kind,
    message,
  };
  graphwarManagedCalculationStatus = status;
  setSmartPathfindingStatus(
    typeof document !== "undefined" && document.visibilityState === "hidden"
      ? locale.smartPathfinding.managed.backgroundWarning
      : message,
    typeof document !== "undefined" && document.visibilityState === "hidden" ? "warning" : kind,
  );
  graphwarManagedCalculationStatusTimer = setTimeout(() => {
    if (graphwarManagedCalculationStatus !== status) {
      return;
    }
    graphwarManagedCalculationStatus = undefined;
    graphwarManagedCalculationStatusTimer = undefined;
    setGraphwarManagedStatus(graphwarManagedStatusMessage, graphwarManagedStatusKind);
  }, graphwarAgentStatusFlashMs);
}

/** 取消托管计算耗时的展示期，避免关闭托管或切换局面后由旧定时器回写状态。 */
function clearGraphwarManagedCalculationStatus() {
  if (graphwarManagedCalculationStatusTimer) {
    clearTimeout(graphwarManagedCalculationStatusTimer);
    graphwarManagedCalculationStatusTimer = undefined;
  }
  graphwarManagedCalculationStatus = undefined;
}

/** 尽力申请屏幕常亮；浏览器拒绝时继续托管但不承诺后台准时。 */
async function requestGraphwarManagedWakeLock() {
  if (
    !graphwarManagedModeEnabled.value ||
    typeof document === "undefined" ||
    document.visibilityState !== "visible" ||
    typeof navigator === "undefined"
  ) {
    return;
  }
  const wakeLock = (
    navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<GraphwarWakeLockSentinel> };
    }
  ).wakeLock;
  const requestGeneration = graphwarManagedWakeLockGeneration;
  if (!wakeLock || graphwarManagedWakeLock || graphwarManagedWakeLockRequest?.generation === requestGeneration) {
    return;
  }
  let request: GraphwarWakeLockRequest | undefined;
  try {
    request = { generation: requestGeneration, promise: wakeLock.request("screen") };
    graphwarManagedWakeLockRequest = request;
    const acquiredWakeLock = await request.promise;
    if (graphwarManagedWakeLockRequest === request) {
      graphwarManagedWakeLockRequest = undefined;
    }
    if (
      requestGeneration !== graphwarManagedWakeLockGeneration ||
      !graphwarManagedModeEnabled.value ||
      document.visibilityState !== "visible" ||
      graphwarManagedWakeLock
    ) {
      try {
        await acquiredWakeLock.release();
      } catch {
        // A stale request may already have been released by the browser.
      }
      return;
    }
    graphwarManagedWakeLock = acquiredWakeLock;
  } catch {
    if (request && graphwarManagedWakeLockRequest === request) {
      graphwarManagedWakeLockRequest = undefined;
    }
    // Wake Lock is best-effort; visibility status already states the timing limitation.
  }
}

/** 释放当前 Wake Lock，并先清引用避免并发可见性事件重复释放。 */
async function releaseGraphwarManagedWakeLock() {
  const wakeLock = graphwarManagedWakeLock;
  graphwarManagedWakeLock = undefined;
  try {
    await wakeLock?.release();
  } catch {
    // The browser may have released it automatically while the page was hidden.
  }
}

/** 后台时覆盖警告；恢复可见后重申请 Wake Lock 并还原最后托管状态。 */
function handleGraphwarManagedVisibilityChange() {
  if (!graphwarManagedModeEnabled.value || typeof document === "undefined") {
    return;
  }
  if (document.visibilityState === "hidden") {
    graphwarManagedWakeLockGeneration += 1;
    setSmartPathfindingStatus(locale.smartPathfinding.managed.backgroundWarning, "warning");
    void releaseGraphwarManagedWakeLock();
    return;
  }
  if (graphwarManagedCalculationStatus && nowMs() < graphwarManagedCalculationStatus.expiresAt) {
    setSmartPathfindingStatus(graphwarManagedCalculationStatus.message, graphwarManagedCalculationStatus.kind);
  } else {
    clearGraphwarManagedCalculationStatus();
    setSmartPathfindingStatus(graphwarManagedStatusMessage, graphwarManagedStatusKind);
  }
  void requestGraphwarManagedWakeLock();
}

/** 切换自动识别；关闭后保留当前识别结果供用户继续编辑。 */
function toggleAutoDetection() {
  if (graphwarManagedModeEnabled.value) {
    return;
  }
  detectionWorkflow.toggleAutoDetection();
}

/** 作废旧 Agent 场景的异步读取、寻路和派生缓存，保留当前画布供新来源继续使用。 */
function invalidateGraphwarAgentSceneWork() {
  const agentReadWasInProgress = graphwarAgentReadInProgress.value;
  graphwarAgentReadGeneration += 1;
  graphwarAgentReadInProgress.value = false;
  // 只收尾本次 Agent reading 文案；并行产生的其他检测状态必须保留。
  if (agentReadWasInProgress && imageStatus.value === locale.status.agent.reading) {
    imageStatus.value = "";
  }
  if (agentReadWasInProgress && detectionStatus.value === locale.status.agent.reading) {
    setDetectionStatus("", "info");
  }
  invalidatePathfindingCaches();
  clearSmartPathfindingStatus();
}

/** 切换是否使用 Agent；保留当前画布，但立即阻止旧来源的异步结果回写。 */
function toggleGraphwarAgentUsage() {
  if (graphwarManagedModeEnabled.value) {
    return;
  }
  invalidateGraphwarAgentSceneWork();
  graphwarAgentEnabled.value = !graphwarAgentEnabled.value;
  if (graphwarAgentEnabled.value) {
    detectionWorkflow.cancel(false);
  } else {
    setGraphwarAgentFireStatus("idle");
  }
}

/** 同步 Agent 地址输入；地址为空时不展示手动读取按钮。 */
function setGraphwarAgentBaseUrlText(value: string) {
  if (graphwarManagedModeEnabled.value) {
    return;
  }
  const previousBaseUrl = normalizedGraphwarAgentBaseUrl.value;
  graphwarAgentBaseUrlText.value = value;
  // 尾斜杠等价写法仍指向同一场景，不应打断正在运行的任务。
  if (graphwarAgentEnabled.value && previousBaseUrl !== normalizedGraphwarAgentBaseUrl.value) {
    invalidateGraphwarAgentSceneWork();
  }
  setGraphwarAgentFireStatus("idle");
}

/** 切换士兵吸附；关闭时清掉悬停，避免视觉状态暗示仍会吸附。 */
function toggleSnapSoldiers() {
  if (graphwarManagedModeEnabled.value) {
    return;
  }
  snapSoldiersPreference.value = !snapSoldiersEnabled.value;
  if (!snapSoldiersEnabled.value) {
    hoveredDetectedSoldierId.value = undefined;
  }
}

/** 切换手工碰撞检查；寻路任务仍使用自己的强制碰撞输入。 */
function toggleCollisionCheck() {
  if (graphwarManagedModeEnabled.value) {
    return;
  }
  collisionCheckPreference.value = !collisionCheckEnabled.value;
}

/** 切换单目标路径规划；休眠状态仍允许用户预先保存偏好。 */
function togglePathPlanning() {
  const capability = graphwarCapabilities.value.pathPlanning;
  if (capability.state === "blocked" || capability.state === "busy") {
    if (capability.reason !== "managed-lock") {
      setSmartPathfindingStatus(getCapabilityReason(capability.reason) ?? "", "warning");
    }
    return;
  }

  cancelSmartPathfinding(false);
  clearSmartPathfindingStatus();
  pathPlanningEnabled.value = !pathPlanningEnabled.value;
}

/** 同步障碍笔刷直径文本，保留非法输入供校验提示展示。 */
function setObstacleBrushDiameterText(value: string) {
  if (graphwarManagedModeEnabled.value) {
    return;
  }
  obstacleBrushDiameterText.value = value;
}

/** 同步放大镜缩放文本，保留非法输入供校验提示展示。 */
function setMagnifierZoomText(value: string) {
  magnifierZoomText.value = value;
}

/** 返回智能寻路被禁用的具体原因。 */
function getSmartPathfindingDisabledMessage() {
  return smartPathfindingPrerequisiteMessage.value;
}

/** 复用单一能力表判断当前组合，避免托管和手动入口各自硬编码算法。 */
function isOneClickClearModeUnsupported() {
  return !supportsOneClickClear(algorithmMode.value, equationMode.value);
}

/** 切换友伤设置；该设置会改变士兵是否写入障碍 mask，因此需要重建路线。 */
function toggleFriendlyFire() {
  if (graphwarManagedModeEnabled.value) {
    return;
  }
  if (smartPathfindingInProgress.value) {
    cancelSmartPathfinding(false);
  }
  invalidatePathfindingCaches();
  clearSmartPathfindingStatus();
  friendlyFireEnabled.value = !friendlyFireEnabled.value;
}

/** 切换搜索动画，并清理当前动画层避免新设置下显示旧帧。 */
function toggleSearchAnimation() {
  searchAnimationEnabled.value = !searchAnimationEnabled.value;
  clearSmartPathfindingPreview();
}

/** 更新普通几何路线算法；邪道扫描不消费该设置，也不应因此被取消。 */
function setPathfindingRouteMode(mode: GraphwarPathfindingRouteMode) {
  if (graphwarManagedModeEnabled.value || pathfindingRouteMode.value === mode) {
    return;
  }
  if (!effectiveStepGlitchModeEnabled.value && smartPathfindingInProgress.value) {
    cancelSmartPathfinding(false);
  }
  pathfindingRouteMode.value = mode;
  if (!effectiveStepGlitchModeEnabled.value) {
    invalidatePathfindingCaches();
    clearSmartPathfindingStatus();
    clearSmartPathfindingPreview();
  }
}

/** 切换删点优化；只丢弃最终结果缓存，保留与路线几何相同的 Worker 准备数据。 */
function toggleDeleteOptimization() {
  if (graphwarManagedModeEnabled.value) {
    return;
  }
  if (smartPathfindingInProgress.value) {
    cancelSmartPathfinding(false);
  }
  deleteOptimizationEnabled.value = !deleteOptimizationEnabled.value;
  invalidatePathfindingResultCache();
  clearSmartPathfindingStatus();
  clearSmartPathfindingPreview();
}

/** 邪道固定使用 X+ 扫描；普通模式才消费用户选择的几何路线算法。 */
function getPathfindingRouteMode(): GraphwarPathfindingRouteMode {
  return effectiveStepGlitchModeEnabled.value ? "visibility-graph" : pathfindingRouteMode.value;
}

/** 根据当前模式将指针点击分发给边界点选或路径点选。 */
function handleStagePointerDown(event: PointerEvent) {
  if (graphwarManagedModeEnabled.value) {
    return;
  }
  const point = getImagePointFromEvent(event);
  if (!point) {
    return;
  }

  if (toolMode.value === "bounds") {
    if (event.button !== 0) {
      return;
    }

    const nextPoint = normalizeBoundsPickerPoint(point);
    if (!boundsFirstPoint.value) {
      clearDetections();
      clearActiveBounds();
      boundsFirstPoint.value = nextPoint;
      pointerPreviewPoint.value = nextPoint;
      return;
    }

    const nextRect = normalizeBoundsRect(boundsFirstPoint.value, nextPoint);
    if (isUsableBoundsRect(nextRect)) {
      applyDetectedBounds(nextRect);
      toolMode.value = "path";
      if (autoDetectionEnabled.value) {
        // 手动框选只负责更新边界；对象识别仍应遵守自动识别开关。
        void runAutomaticGraphwarObjectsInCurrentBounds();
      }
    }
    boundsFirstPoint.value = undefined;
    pointerPreviewPoint.value = undefined;
    return;
  }

  if (toolMode.value === "obstacle") {
    if (event.button !== 0) {
      return;
    }

    if (!obstacleBrushAvailable.value || !parsedObstacleBrushDiameter.value.ok) {
      return;
    }

    startObstacleBrushDrag();
    stageRef.value?.setPointerCapture(event.pointerId);
    paintObstacleBrushAtPoint(point);
    return;
  }

  if (event.button !== 0 || !parsedBounds.value.ok) {
    return;
  }

  clearLiveClickPreviewPointerPoint();
  if (smartPathfindingInProgress.value) {
    setLiveClickPreviewPointerPoint(point, getPathPointIndexAtPoint(point));
    updateSmartPathfindingInProgressStatus();
    return;
  }

  const pathPointIndex = getPathPointIndexAtPoint(point);
  setLiveClickPreviewPointerPoint(point, pathPointIndex);
  if (pathPointIndex !== undefined) {
    draggingPathPointIndex.value = pathPointIndex;
    hoveredPathPointIndex.value = pathPointIndex;
    stageRef.value?.setPointerCapture(event.pointerId);
    return;
  }

  const selectedSoldier = getDetectedSoldierAtPoint(point);
  if (snapSoldiersEnabled.value && selectedSoldier) {
    void appendDetectedSoldierPathPoint(selectedSoldier);
    return;
  }

  void appendPathPoint(point);
}

/** 一键清图：从当前路径尾部出发，完整遍历 x 单调可达状态并追加当前模型下击杀最多的路径。 */
async function runOneClickClear() {
  const capability = graphwarCapabilities.value.oneClickClear;
  if (capability.state !== "normal") {
    setSmartPathfindingStatus(getCapabilityReason(capability.reason) ?? "", "warning");
    return false;
  }
  return runOneClickClearWorkflow();
}

/** 标记一键清图任务，让只属于该任务的设置变化不会取消普通单目标寻路。 */
async function runOneClickClearWorkflow(...args: Parameters<typeof oneClickClearRunWorkflow.run>) {
  // 冻结启动时实际采用的分支，避免运行期间的响应式配置让休眠参数误取消任务。
  const task = { kind: "one-click", usesDagWorker: requiresOneClickClearDagWorker() } as const;
  activePathfindingTask = task;
  try {
    return await oneClickClearRunWorkflow.run(...args);
  } finally {
    if (activePathfindingTask === task) {
      activePathfindingTask = undefined;
    }
  }
}

/** 路径变更后同步落地并清空旧状态。 */
function setPathPixels(points: PixelPoint[]) {
  // 坐标输入等同步编辑必须先作废旧 token，避免迟到的 Worker 结果覆盖用户刚写入的路径。
  if (cancelSmartPathfinding(false)) {
    clearSmartPathfindingStatus();
  }
  if (pathStartChanges(points)) {
    invalidatePathfindingWorkerCache();
  }
  clearSmartPathfindingBlockedPoint();
  pathPixels.value = points;
  pathStatus.value = "";
}

/** 一次性发布同一整式验证过的路径和目标序列，并保留页面统一的路径副作用。 */
function applyValidatedPath(points: PixelPoint[], targets: Parameters<typeof applyValidatedPathState>[1]) {
  if (pathStartChanges(points)) {
    invalidatePathfindingWorkerCache();
  }
  clearSmartPathfindingBlockedPoint();
  applyValidatedPathState(points, targets);
  pathStatus.value = "";
}

/** 发射点改变会影响友方士兵是否写入寻路障碍 mask。 */
function pathStartChanges(nextPath: readonly PixelPoint[]) {
  const previousStart = pathPixels.value[0];
  const nextStart = nextPath[0];
  if (!previousStart || !nextStart) {
    return previousStart !== nextStart;
  }
  return previousStart.x !== nextStart.x || previousStart.y !== nextStart.y;
}

/** 开始一次异步寻路/清图任务并返回取消 token。 */
function startSmartPathfinding(message?: string) {
  return smartPathfindingSession.start(message);
}

/** 取消 token 同时覆盖智能寻路和一键清图，避免旧 async 结果回写当前页面状态。 */
function cancelSmartPathfinding(showStatus: boolean) {
  return smartPathfindingSession.cancel(showStatus);
}

/** 判断异步寻路/清图任务是否仍属于当前 token。 */
function isSmartPathfindingRunCurrent(token: number) {
  return smartPathfindingSession.isCurrentRun(token);
}

/** 仅当前 token 可完成运行态，避免旧 async 任务清掉新任务预览。 */
function finishSmartPathfindingRun(token: number) {
  return smartPathfindingSession.finishRun(token);
}

/** 更新智能寻路状态文案和等级。 */
function setSmartPathfindingStatus(message: string, kind: SmartPathfindingStatusKind) {
  smartPathfindingSession.setStatus(message, kind);
}

/** 在智能寻路进行中刷新阶段文案。 */
function updateSmartPathfindingInProgressStatus() {
  smartPathfindingSession.updateInProgressStatus();
}

/** 清空智能寻路状态文案。 */
function clearSmartPathfindingStatus() {
  smartPathfindingSession.clearStatus();
}

/** 清空页面侧完整结果缓存；用于输入语义换代，不用于普通路径清空。 */
function invalidatePathfindingResultCache() {
  pathfindingCache.invalidateResultCache();
}

/** 让 master Worker 丢弃绑定旧截图、障碍 mask 或寻路配置的可视图 cache。 */
function invalidatePathfindingWorkerCache() {
  graphwarPathfindingRunner.clearCache();
}

/** 同时清理 worker 内部派生 cache 和页面侧完整结果 cache。 */
function invalidatePathfindingCaches() {
  // 输入语义换代必须先使页面 token 和旧 Worker 请求同时失效，避免迟到结果写回新场景。
  cancelSmartPathfinding(false);
  invalidatePathfindingResultCache();
  invalidatePathfindingWorkerCache();
}

/** 短暂标记阻止启动智能寻路的当前轨迹撞击位置。 */
function flashSmartPathfindingBlockedPoint(point: PixelPoint | undefined) {
  smartPathfindingSession.flashBlockedPoint(point);
}

/** 清理当前路径预检的撞击点标记。 */
function clearSmartPathfindingBlockedPoint() {
  smartPathfindingSession.clearBlockedPoint();
}

/** 清理智能寻路相关视觉状态。 */
function clearSmartPathfindingPreview() {
  smartPathfindingSession.clearPreview();
}

/** 判断检测框是否包含当前最右侧路径点，避免把已选士兵再次作为目标。 */
function detectionBoxMatchesSelectedPathPoint(box: DetectionBox): boolean {
  if (pathPixels.value.length === 0) {
    return false;
  }

  const selectedPoint = getRightmostPathPoint();
  if (!selectedPoint) {
    return false;
  }

  return detectionBoxContainsPathPoint(box, selectedPoint);
}

watch([pathPixels, displayedSoldierVisibleRadiusPixels], () => {
  refreshLiveClickPreviewPointerPathPointIndex();
});

/** 跟踪指针位置；高频路径预览在这里合并到浏览器绘制帧。 */
function handleStagePointerMove(event: PointerEvent) {
  const point = getImagePointFromEvent(event);
  if (!point) {
    return;
  }

  if (magnifierEnabled.value) {
    magnifierPoint.value = point;
  }
  if (graphwarManagedModeEnabled.value) {
    return;
  }
  if (toolMode.value === "obstacle") {
    clearLiveClickPreviewPointerPoint();
    updateObstacleBrushPreview(point);
    if (obstacleBrushDragging.value) {
      paintObstacleBrushAtPoint(point, true);
    }
    hoveredPathPointIndex.value = undefined;
    hoveredDetectedSoldierId.value = undefined;
    return;
  }
  if (draggingPathPointIndex.value !== undefined) {
    clearLiveClickPreviewPointerPoint();
    hoveredPathPointIndex.value = draggingPathPointIndex.value;
    setPathPoint(draggingPathPointIndex.value, point);
    return;
  }

  const pathPointIndex = getPathPointIndexAtPoint(point);
  if (toolMode.value === "path") {
    scheduleLiveClickPreviewPointerPoint(point, pathPointIndex);
  } else {
    clearLiveClickPreviewPointerPoint();
  }
  hoveredPathPointIndex.value = pathPointIndex;
  const hoveredSoldier = snapSoldiersEnabled.value ? getDetectedSoldierAtPoint(point)?.id : undefined;
  hoveredDetectedSoldierId.value = hoveredSoldier;
  if (toolMode.value !== "bounds") {
    return;
  }

  pointerPreviewPoint.value = normalizeBoundsPickerPoint(point);
}

/** 指针离开截图舞台时清理仅悬停期间存在的预览状态。 */
function handleStagePointerLeave() {
  pointerPreviewPoint.value = undefined;
  magnifierPoint.value = undefined;
  clearLiveClickPreviewPointerPoint();
  hoveredDetectedSoldierId.value = undefined;
  hoveredPathPointIndex.value = undefined;
  draggingPathPointIndex.value = undefined;
  clearObstacleBrushInteractionState();
}

/** 使用右键取消边界点或撤回最新路径点。 */
function handleStageContextMenu(event: MouseEvent) {
  if (graphwarManagedModeEnabled.value) {
    return;
  }
  if (cancelDetection(true)) {
    return;
  }

  if (cancelSmartPathfinding(true)) {
    return;
  }

  if (toolMode.value === "bounds") {
    boundsFirstPoint.value = undefined;
    pointerPreviewPoint.value = undefined;
    return;
  }

  if (toolMode.value === "obstacle") {
    return;
  }

  if (toolMode.value !== "path") {
    return;
  }

  const point = getImagePointFromEvent(event);
  const pathPointIndex = point ? getPathPointIndexAtPoint(point) : undefined;
  if (pathPointIndex !== undefined && removePathPoint(pathPointIndex)) {
    return;
  }

  undoLastPoint();
}

/** 结束路径点拖拽，释放 pointer capture。 */
function handleStagePointerUp(event: PointerEvent) {
  if (graphwarManagedModeEnabled.value) {
    return;
  }
  if (finishObstacleBrushDrag()) {
    if (stageRef.value?.hasPointerCapture(event.pointerId)) {
      stageRef.value.releasePointerCapture(event.pointerId);
    }
    return;
  }

  if (draggingPathPointIndex.value === undefined) {
    return;
  }
  draggingPathPointIndex.value = undefined;
  if (stageRef.value?.hasPointerCapture(event.pointerId)) {
    stageRef.value.releasePointerCapture(event.pointerId);
  }
}

/** 切换边界/路径模式，并清理当前模式的临时状态。 */
function setToolMode(mode: ToolMode) {
  if (graphwarManagedModeEnabled.value || (mode === "obstacle" && !obstacleBrushAvailable.value)) {
    return;
  }

  toolMode.value = mode;
  pointerPreviewPoint.value = undefined;
  clearLiveClickPreviewPointerPoint();
  clearObstacleBrushInteractionState();
  hoveredDetectedSoldierId.value = undefined;
  hoveredPathPointIndex.value = undefined;
  if (mode !== "bounds") {
    boundsFirstPoint.value = undefined;
  }
}

/** 返回路径必须向 x+ 前进的本地化提示。 */
function getForwardPathMessage() {
  return locale.smartPathfinding.forwardPath(locale.smartPathfinding.forwardMinimumDouble);
}

/** 根据当前阶段生成智能寻路进行中文案。 */
function getSmartPathfindingInProgressMessage() {
  return createSmartPathfindingInProgressMessage(locale, activeSmartPathfindingPhase.value);
}

/** 将调试耗时格式化为保留小数的毫秒文本，避免短阶段被状态栏格式化规则吞掉精度。 */
function formatDebugElapsedDuration(elapsedMs: number) {
  if (elapsedMs <= 0) {
    return "0 ms";
  }
  if (elapsedMs < 10) {
    return `${formatDecimal(elapsedMs, 2)} ms`;
  }
  if (elapsedMs < 1000) {
    return `${formatDecimal(elapsedMs, 1)} ms`;
  }
  return `${formatDecimal(elapsedMs / 1000, 3)} s`;
}

/** 长按倒计时需要固定 0.1s 精度，不能像公式数字一样裁掉末尾 0。 */
function formatDebugActivationRemainingSeconds(remainingMs: number) {
  return Math.max(0.1, remainingMs / 1000).toFixed(1);
}

/** 清除全部已选路径点，并保留图片边界和设定。 */
function clearPath() {
  if (graphwarManagedModeEnabled.value || toolMode.value !== "path") {
    return;
  }

  cancelSmartPathfinding(false);
  clearSmartPathfindingStatus();
  clearSmartPathfindingBlockedPoint();
  invalidatePathfindingWorkerCache();
  clearActivePathState();
}

/** 清除公式生成和模拟器两种模式的路径状态。 */
function clearAllModePaths() {
  cancelSmartPathfinding(false);
  clearSmartPathfindingStatus();
  clearSmartPathfindingBlockedPoint();
  invalidatePathfindingWorkerCache();
  clearAllPathState();
}

/** 删除最新选择的路径点。 */
function undoLastPoint() {
  if (graphwarManagedModeEnabled.value || toolMode.value !== "path") {
    return;
  }

  if (pathPixels.value.length === 0) {
    return;
  }

  cancelSmartPathfinding(false);
  clearSmartPathfindingStatus();
  clearSmartPathfindingBlockedPoint();
  const removesPathStart = pathPixels.value.length === 1;
  undoActivePathPoint();
  if (removesPathStart) {
    invalidatePathfindingWorkerCache();
  }
}
</script>
<!-- autocorrect-enable -->

<template>
  <div class="graphwar-killer">
    <p
      class="graphwar-killer__sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ statusAnnouncement }}
    </p>
    <GraphwarSettingsPanel
      :locale="locale"
      :panel="settingsPanel"
      @cancel-debug-activation-hold="!graphwarManagedModeEnabled && cancelDebugActivationHold()"
      @finish-debug-activation-hold="!graphwarManagedModeEnabled && finishDebugActivationHold()"
      @set-algorithm-mode="setAlgorithmMode"
      @set-equation-mode="setEquationMode"
      @set-tool-workflow-mode="setToolWorkflowMode"
      @start-debug-activation-hold="!graphwarManagedModeEnabled && startDebugActivationHold($event)"
      @toggle-advanced-settings="toggleAdvancedSettings"
      @toggle-step-glitch-mode="toggleStepGlitchMode"
      @toggle-step-overflow-protection="
        !graphwarManagedModeEnabled && (stepOverflowProtectionEnabled = !stepOverflowProtectionEnabled)
      "
      @update-precision-text="!graphwarManagedModeEnabled && (precisionText = $event)"
      @update-steepness-text="!graphwarManagedModeEnabled && (steepnessText = $event)"
    />
    <GraphwarAdvancedSettingsPanel
      v-if="advancedSettingsVisible"
      :locale="locale"
      :panel="advancedSettingsPanel"
      @toggle-simulator-parse-derivative-as-y="
        !graphwarManagedModeEnabled && (simulatorParseDerivativeAsY = !simulatorParseDerivativeAsY)
      "
      @toggle-simulator-skip-unknown-characters="
        !graphwarManagedModeEnabled && (simulatorSkipUnknownCharacters = !simulatorSkipUnknownCharacters)
      "
      @update-candidate-top-ratio-text="!graphwarManagedModeEnabled && (soldierTemplateCandidateTopRatioText = $event)"
      @update-max-x-text="!graphwarManagedModeEnabled && (maxXText = $event)"
      @update-max-y-text="!graphwarManagedModeEnabled && (maxYText = $event)"
      @update-maximum-soldier-count-text="!graphwarManagedModeEnabled && (maximumSoldierCountText = $event)"
      @update-min-x-text="!graphwarManagedModeEnabled && (minXText = $event)"
      @update-min-y-text="!graphwarManagedModeEnabled && (minYText = $event)"
      @update-live-click-preview-worker-count-text="
        !graphwarManagedModeEnabled && (liveClickPreviewWorkerCountText = $event)
      "
      @update-obstacle-min-area-text="!graphwarManagedModeEnabled && (obstacleMinAreaText = $event)"
      @update-obstacle-simulation-tolerance-text="
        !graphwarManagedModeEnabled && (activeObstacleSimulationToleranceText = $event)
      "
      @update-one-click-clear-delete-check-radius-text="
        !graphwarManagedModeEnabled && (oneClickClearDeleteCheckRadiusText = $event)
      "
      @update-pathfinding-worker-count-text="!graphwarManagedModeEnabled && (pathfindingWorkerCountText = $event)"
      @update-route-planning-tolerance-text="!graphwarManagedModeEnabled && (activeRoutePlanningToleranceText = $event)"
      @update-template-matching-worker-count-text="
        !graphwarManagedModeEnabled && (templateMatchingWorkerCountText = $event)
      "
    />
    <div class="graphwar-killer__detection-pathfinding-row">
      <GraphwarDetectionPanel
        :locale="locale"
        :panel="detectionPanel"
        @capture-image="!graphwarManagedModeEnabled && captureScreenImage()"
        @detect-bounds="void detectGraphwarBounds()"
        @detect-objects="void detectGraphwarObjectsInCurrentBounds()"
        @read-agent="void readGraphwarAgent()"
        @toggle-agent-usage="toggleGraphwarAgentUsage"
        @toggle-auto-detection="toggleAutoDetection"
        @upload-image="!graphwarManagedModeEnabled && handleImageUpload($event)"
        @update-agent-base-url="setGraphwarAgentBaseUrlText"
      />
      <GraphwarSmartPathfindingPanel
        :locale="locale"
        :panel="smartPathfindingPanel"
        @run-one-click-clear="void runOneClickClear()"
        @set-route-mode="setPathfindingRouteMode"
        @toggle-delete-optimization="toggleDeleteOptimization"
        @toggle-friendly-fire="toggleFriendlyFire"
        @toggle-search-animation="toggleSearchAnimation"
        @toggle-managed-mode="toggleGraphwarManagedMode"
      />
    </div>
    <GraphwarActionPanel
      :locale="locale"
      :panel="actionPanel"
      @clear-obstacle-edits="!graphwarManagedModeEnabled && resetObstacleEdits()"
      @clear-path="clearPath"
      @set-tool-mode="setToolMode"
      @toggle-collision-check="toggleCollisionCheck"
      @toggle-live-click-preview="liveClickPreviewEnabled = !liveClickPreviewEnabled"
      @toggle-magnifier="magnifierEnabled = !magnifierEnabled"
      @toggle-obstacle-brush-erase="!graphwarManagedModeEnabled && toggleObstacleBrushErase()"
      @toggle-path-planning="togglePathPlanning"
      @toggle-snap-soldiers="toggleSnapSoldiers"
      @undo-point="undoLastPoint"
      @update-magnifier-zoom="setMagnifierZoomText"
      @update-obstacle-brush-diameter="setObstacleBrushDiameterText"
    />
    <GraphwarScreenshotPanel
      :locale="locale"
      :panel="screenshotPanel"
      @cancel-detection="cancelDetection(true)"
      @drop-image="!graphwarManagedModeEnabled && handleDrop($event)"
      @image-load="handleImageLoad"
      @set-image-element="setScreenshotImageElement"
      @set-stage-element="setScreenshotStageElement"
      @stage-context-menu="handleStageContextMenu"
      @stage-pointer-down="handleStagePointerDown"
      @stage-pointer-leave="handleStagePointerLeave"
      @stage-pointer-move="handleStagePointerMove"
      @stage-pointer-up="handleStagePointerUp"
    />
    <GraphwarResultPanel
      :locale="locale"
      :result="resultPanel"
      @clear-simulator="!graphwarManagedModeEnabled && clearSimulatorInputs()"
      @copy-formula="copyFormula"
      @fire-agent-function="void fireGraphwarAgentFunction()"
      @finish-point-coordinate-edit="!graphwarManagedModeEnabled && finishPathPointCoordinateEdit()"
      @start-point-coordinate-edit="
        (index, axis) => !graphwarManagedModeEnabled && startPathPointCoordinateEdit(index, axis)
      "
      @update-point-coordinate="
        (index, axis, value) => !graphwarManagedModeEnabled && handlePathPointCoordinateInput(index, axis, value)
      "
      @update-simulator-formula-text="!graphwarManagedModeEnabled && (simulatorFormulaText = $event)"
      @update-simulator-launch-angle-text="!graphwarManagedModeEnabled && (simulatorLaunchAngleText = $event)"
    />
  </div>
</template>

<style scoped>
.graphwar-killer {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  display: grid;
  gap: 8px;
  margin: 10px 0 18px;
  max-width: 100%;
  padding: 12px;
  width: 100%;
}

.graphwar-killer__detection-pathfinding-row {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));
  min-width: 0;
}

.graphwar-killer__sr-only {
  border: 0;
  clip-path: inset(50%);
  height: 1px;
  margin: -1px;
  overflow: hidden;
  padding: 0;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}
</style>
