<script setup lang="ts">
import { withBase } from "vitepress";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import {
  GRAPHWAR_AGENT_DEFAULT_BASE_URL,
  readGraphwarAgentSnapshot,
  submitGraphwarAgentFunction,
} from "./controllers/agent/client";
import { useGraphwarDebugActivation } from "./controllers/debug/activation";
import { useGraphwarDebugTimings } from "./controllers/debug/timings";
import {
  useGraphwarDetectionWorkflow,
  type DetectionStatusKind,
  type GraphwarDetectionRunTrigger,
} from "./controllers/detection/workflow";
import { useGraphwarPathAppendWorkflow } from "./controllers/path/append-workflow";
import { useGraphwarPathPointEditing } from "./controllers/path/point-editing";
import { useGraphwarPathState } from "./controllers/path/state";
import { useGraphwarTrajectoryResult } from "./controllers/path/trajectory-result";
import {
  useGraphwarPathfindingBoundaryExpansion,
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
import { useGraphwarSettingsValidation } from "./controllers/settings/validation";
import { useGraphwarStageFeedback } from "./controllers/stage/feedback";
import { useGraphwarStageHitTesting, type GraphwarStageHitTestingController } from "./controllers/stage/hit-testing";
import { useGraphwarLiveClickPreview } from "./controllers/stage/live-click-preview";
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
import { imageToGraphPoint, normalizeBoundsRect } from "./core/geometry";
import {
  DEFAULT_FORMULA_DECIMAL_PLACES,
  MAX_FORMULA_DECIMAL_PLACES,
  clampNumber,
  formatAngleDegree,
  formatDecimal,
  formatDoublePrecisionDecimal,
  formatSvgNumber,
  parseFiniteNumber,
} from "./core/numbers";
import { graphwarToolDefaults } from "./core/tool/defaults";
import type {
  AlgorithmMode,
  BoundsRect,
  EquationMode,
  GraphPoint,
  PixelPoint,
  ToolMode,
  ToolWorkflowMode,
  TransferStatus,
} from "./core/types";
import type { GraphwarDetectionBox } from "./detection/objects";
import type { GraphwarKillerLocale } from "./locale-types";
import { GRAPHWAR_DEFAULT_ROUTE_PLANNING_TOLERANCE_PLANE_PIXELS } from "./pathfinding/one-click-clear/search";
import type { GraphwarPathfindingRouteMode } from "./pathfinding/routing/mode";
import { createGraphwarPathfindingCacheController } from "./pathfinding/runtime/cache";
import { createGraphwarPathfindingRunner } from "./pathfinding/runtime/runner";
import { createGraphwarPathLineSegments, type GraphwarPathfindingLineSegment } from "./pathfinding/smart/preview";
import {
  createBoundsRectWithBoundaryExpansion,
  type GraphwarSmartPathfindingSoldierTarget as SmartPathfindingTarget,
} from "./pathfinding/targeting";
import GraphwarActionPanel from "./presentation/action/MainPanel.vue";
import GraphwarDetectionPanel, { type GraphwarDetectionPanelModel } from "./presentation/detection/MainPanel.vue";
import GraphwarSmartPathfindingPanel, {
  type GraphwarSmartPathfindingPanelModel,
} from "./presentation/pathfinding/MainPanel.vue";
import GraphwarResultPanel from "./presentation/result/MainPanel.vue";
import GraphwarScreenshotPanel, { type GraphwarScreenshotPanelModel } from "./presentation/screenshot/MainPanel.vue";
import GraphwarAdvancedSettingsPanel, {
  type GraphwarAdvancedSettingsPanelModel,
} from "./presentation/settings/AdvancedPanel.vue";
import GraphwarSettingsPanel, { type GraphwarSettingsPanelModel } from "./presentation/settings/MainPanel.vue";
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

/** 寻路模式；auto-graph 保留为待重写的禁用入口。 */
type PathfindingMode = "off" | "smart" | "auto-graph";
/** 截图上的检测框，坐标均为图片像素。 */
type DetectionBox = GraphwarDetectionBox;
const { locale } = defineProps<{
  locale: GraphwarKillerLocale;
}>();

const graphwarDefaultXLimitText = formatDoublePrecisionDecimal(GRAPHWAR_DEFAULT_X_LIMIT);
const graphwarVisibleYLimitText = formatDoublePrecisionDecimal(GRAPHWAR_VISIBLE_Y_LIMIT);
const graphwarObstacleToleranceLimit = Math.floor(GRAPHWAR_PLANE_LENGTH / 2);
const graphwarBoundaryExpansionLimit = Math.floor((Math.min(GRAPHWAR_PLANE_LENGTH, GRAPHWAR_PLANE_HEIGHT) - 1) / 2);
const graphwarObstacleMaxArea = GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT;
const graphwarBoundsMinimumSizePixels = 4;
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
const graphwarAgentFireStatusFlashMs = 2000;
const mainObstacleBrushClipPathId = "graphwar-killer-obstacle-brush-clip";
const magnifierObstacleBrushClipPathId = "graphwar-killer-magnifier-obstacle-brush-clip";
const graphwarAgentDownloadHref = withBase("/graphwar-agent.jar");

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
const algorithmMode = ref<AlgorithmMode>("abs");
const minXText = ref(`-${graphwarDefaultXLimitText}`);
const maxXText = ref(graphwarDefaultXLimitText);
const minYText = ref(`-${graphwarVisibleYLimitText}`);
const maxYText = ref(graphwarVisibleYLimitText);
const steepnessText = ref(String(graphwarToolDefaults.steepness));
const stepOverflowProtectionEnabled = ref(true);
const precisionText = ref(String(DEFAULT_FORMULA_DECIMAL_PLACES));
const advancedSettingsVisible = ref(false);
const simulatorSkipUnknownCharacters = ref(true);
const simulatorParseDerivativeAsY = ref(true);
const obstacleMinAreaText = ref(String(graphwarToolDefaults.obstacleMinArea));
const maximumSoldierCountText = ref(String(graphwarToolDefaults.maximumSoldierCount));
const soldierTemplateCandidateTopRatioText = ref(String(graphwarToolDefaults.soldierTemplateCandidateTopRatio));
const templateMatchingWorkerCountText = ref(String(graphwarToolDefaults.templateMatchingWorkerCount));
const pathfindingWorkerCountText = ref(String(graphwarToolDefaults.pathfindingWorkerCount));
// 截图识别需要默认安全距离吸收像素误差；Agent 返回精确障碍，默认不额外外扩。
const detectionRoutePlanningToleranceText = ref(String(GRAPHWAR_DEFAULT_ROUTE_PLANNING_TOLERANCE_PLANE_PIXELS));
const detectionObstacleSimulationToleranceText = ref("1");
const graphwarAgentRoutePlanningToleranceText = ref("1");
const graphwarAgentObstacleSimulationToleranceText = ref("0");
const pathfindingBoundaryExpansionText = ref("1");
const oneClickClearDeleteCheckRadiusText = ref(String(oneClickClearDeleteCheckRadiusDefaultPlanePixels));
const simulatorFormulaText = ref("");
const simulatorLaunchAngleText = ref("");
const graphwarAgentEnabled = ref(false);
const graphwarAgentBaseUrlText = ref(GRAPHWAR_AGENT_DEFAULT_BASE_URL);
const graphwarAgentReadInProgress = ref(false);
const graphwarAgentFireInProgress = ref(false);
const graphwarAgentFireStatus = ref<TransferStatus>("idle");
const graphwarAgentFireFailureMessage = ref("");
let graphwarAgentFireStatusTimer: ReturnType<typeof setTimeout> | undefined;
const graphwarAgentConfigured = computed(
  () => graphwarAgentEnabled.value && graphwarAgentBaseUrlText.value.trim().length > 0,
);
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
  clearActivePath: clearActivePathState,
  clearAllModePaths: clearAllPathState,
  clearPathInteractionState,
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
const hoveredDetectedSoldierId = ref<string>();
const smartPathfindingEnabled = ref(false);
const friendlyFireEnabled = ref(false);
const obstacleBrushDiameterText = ref("30");
const searchAnimationEnabled = ref(true);
const fastPathfindingEnabled = ref(true);
// 智能寻路和一键清图共用同一组运行状态、预览层和取消 token，避免两个异步任务同时回写页面。
const smartPathfindingSession = useGraphwarSmartPathfindingSession({
  blockedPointFlashMs: smartPathfindingBlockedPointFlashMs,
  getCancelledMessage: () => createSmartPathfindingCancelledMessage(locale),
  getInProgressMessage: () => getSmartPathfindingInProgressMessage(),
  isPathfindingModeActive: () => pathfindingMode.value === "smart",
  pathStatus,
  pathfindingRunner: graphwarPathfindingRunner,
});
const {
  activePhase: activeSmartPathfindingPhase,
  blockedPoint: smartPathfindingBlockedPoint,
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
  },
  input: {
    boundsRect,
    getBounds: () => (parsedBounds.value.ok ? parsedBounds.value.bounds : undefined),
    getFormulaSettings: () => createPathTrajectoryFormulaSettings(),
    getObstacleMask: () => smartPathfindingBaseObstacleMask.value,
    getPathPixels: () => pathPixels.value,
    getRouteMode: getPathfindingRouteMode,
    getSimulationMask: () => simulationObstacleMask.value,
    getTargetHitRadiusPixels: () => soldierHitRadiusPixels.value,
    getTolerances: () => (parsedObstacleTolerances.value.ok ? parsedObstacleTolerances.value : undefined),
    isPathfindingWorkerCountValid: () => parsedPathfindingWorkerCount.value.ok,
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
      hoveredDetectedSoldierId.value = undefined;
    },
    clearSmartPathfindingStatus,
    flashBoundsRect,
    flashDetectedSoldiers,
    invalidatePathfindingCaches,
    applyDetectedBounds,
    onSmartCursorDisabled: () => {
      hoveredDetectedSoldierId.value = undefined;
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
  smartCursorEnabled,
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
    algorithmMode.value !== "step" &&
    smartPathfindingEnabled.value &&
    objectDetectionReady.value,
);
const pathfindingObstacleEdgesActive = computed(() => effectiveSmartPathfindingEnabled.value);
const blocksFriendlyFireTargets = computed(
  () => pathfindingObstacleEdgesActive.value && !friendlyFireEnabled.value && pathPixels.value.length > 0,
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
      boundaryExpansionText: pathfindingBoundaryExpansionText,
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
      boundaryExpansionLimit: graphwarBoundaryExpansionLimit,
      deleteCheckRadiusMinimumPlanePixels: oneClickClearDeleteCheckRadiusMinimumPlanePixels,
      obstacleToleranceLimit: graphwarObstacleToleranceLimit,
    },
  },
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
// 轨迹结果 Module 应集中公式上下文、主采样、命中索引和绘制曲线；页面保留输入校验与文案映射。
const {
  createPathTrajectoryFormulaSettings,
  formulaOutputDecimalPlaces,
  formulaResult,
  graphwarTrajectoryFormulaSettings,
  plottedCurvePoints,
  secondOrderLaunchAngleDegrees,
  simulatorLaunchAngleRadians,
  trajectoryWarningReason,
} = useGraphwarTrajectoryResult({
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
const canFireGraphwarAgentFunction = computed(
  () => graphwarAgentConfigured.value && canCopyFormula.value && !graphwarAgentFireInProgress.value,
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
const settingsHeaderStatusResult = computed(() =>
  getFirstHeaderStatus(
    createHeaderStatus(settingsMessage.value, "error"),
    createHeaderStatus(debugActivationCountdownMessage.value, "warning"),
    createHeaderStatus(debugActivationSuccessVisible.value ? locale.ui.settings.debugInfoEnabled : "", "success"),
    createHeaderStatus(activeEquationDescription.value),
  ),
);
// 基础设置面板只应消费展示 DTO；模式切换、校验和调试长按流程仍由页面侧保持原语义。
const settingsPanel = computed<GraphwarSettingsPanelModel>(() => {
  const headerStatus = settingsHeaderStatusResult.value;
  return {
    advancedSettingsVisible: advancedSettingsVisible.value,
    algorithmMode: algorithmMode.value,
    algorithmModes: algorithmModes.value,
    equationMode: equationMode.value,
    equationModes: equationModes.value.map((mode) => ({
      ...mode,
      disabled: isEquationModeDisabled(mode.value),
    })),
    headerStatus: {
      kind: headerStatus.kind,
      message: headerStatus.message,
    },
    precision: {
      maximum: MAX_FORMULA_DECIMAL_PLACES,
      text: precisionText.value,
    },
    stepOverflowProtectionEnabled: stepOverflowProtectionEnabled.value,
    steepnessText: steepnessText.value,
    toolWorkflowMode: toolWorkflowMode.value,
    toolWorkflowModes: toolWorkflowModes.value,
  };
});
const activeToolHint = computed(() =>
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
const activeBoundaryExpansion = useGraphwarPathfindingBoundaryExpansion({
  modes: {
    pathfindingObstacleEdgesActive,
    smartCursorEnabled,
  },
  settings: {
    parsedObstacleTolerances,
  },
});
const targetBoundsRect = computed(() =>
  createBoundsRectWithBoundaryExpansion(boundsRect.value, activeBoundaryExpansion.value),
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
  isSoldierOnNegativeGraphX: isDetectionBoxOnNegativeGraphX,
} = useGraphwarTargetingContext<DetectionBox>({
  boundsRect,
  getBounds: () => (parsedBounds.value.ok ? parsedBounds.value.bounds : undefined),
  getTargetBoundsRect: () => targetBoundsRect.value,
  pathPixels,
});
// 障碍投影应集中 friendly mask、route/simulation mask、SVG path 和轨迹碰撞设置，页面只保留状态来源。
const {
  simulationObstacleMask,
  smartPathfindingBaseObstacleMask,
  smartPathfindingObstacleRouteEdgePath,
  smartPathfindingObstacleRouteFillPath,
  smartPathfindingObstacleSimulationEdgePath,
  smartPathfindingObstacleSimulationFillPath,
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
    blocksFriendlyFireTargets,
    effectiveSmartPathfindingEnabled,
    pathfindingObstacleEdgesActive,
    smartCursorEnabled,
    toolWorkflowMode,
  },
  settings: {
    activeBoundaryExpansion,
    getSoldierHitRadiusPixels: () => soldierHitRadiusPixels.value,
    parsedBounds,
    parsedObstacleTolerances,
  },
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
      pathPixels,
      pathStatus,
      setPathPixels,
      trajectoryStrokeColor,
    },
    smartPathfinding: {
      clearStatus: clearSmartPathfindingStatus,
      flashBlockedPoint: flashSmartPathfindingBlockedPoint,
      runWorkflow: smartPathfindingRunWorkflow,
      setStatus: setSmartPathfindingStatus,
    },
    targets: {
      createMinimumForwardTargetPoint,
      createSearchStartSoldierAimPoint,
      createSmartPathfindingSoldierTarget,
      createSoldierHitCircle,
      getDetectedSoldierColor,
      getDetectionBoxCenter,
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
// 一键清图 workflow 应集中预检、候选收集、worker 输入、cache 和结果落地；页面只保留当前状态入口。
const oneClickClearRunWorkflow = useGraphwarOneClickClearRunWorkflow<DetectionBox>({
  debug: {
    appendSearchWorkerTimings: appendOneClickClearSearchWorkerTimings,
    clearTimings: clearSmartPathfindingDebugTimings,
    finishTimings: finishSmartPathfindingDebugTimings,
    measureStage: measureSmartPathfindingDebugStage,
    measureStageAsync: measureSmartPathfindingDebugStageAsync,
  },
  effects: {
    applyPath: setPathPixels,
    flashHitSoldiers: flashOneClickClearHitSoldiers,
    setStatus: setSmartPathfindingStatus,
  },
  input: {
    boundsRect,
    getBounds: () => (parsedBounds.value.ok ? parsedBounds.value.bounds : undefined),
    getFormulaSettings: () => createPathTrajectoryFormulaSettings(),
    getObstacleMask: () => smartPathfindingBaseObstacleMask.value,
    getPathfindingWorkerCount: () =>
      parsedPathfindingWorkerCount.value.ok ? parsedPathfindingWorkerCount.value.workerCount : undefined,
    getPathPoints: () => pathPixels.value,
    getRouteMode: getPathfindingRouteMode,
    getSimulationMask: () => simulationObstacleMask.value,
    getTolerances: () => (parsedOneClickClearTolerances.value.ok ? parsedOneClickClearTolerances.value : undefined),
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
      createOneClickClearSuccessMessage({ elapsedMs, locale, resultCacheHit, targetCount }),
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
    getPrefixTarget: createCurrentLastPathHitTarget,
    getSoldiers: () => detectedSoldiers.value,
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
  label: liveClickPreviewLabel,
  lineSegments: liveClickPreviewLineSegments,
  point: liveClickPreviewPoint,
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
    smartCursorEnabled,
  },
  trajectory: {
    formulaSettings: graphwarTrajectoryFormulaSettings,
    getCollisionSettings: () => trajectoryCollisionSettings.value,
  },
});
const visibleBoundaryExpansionRect = computed<BoundsRect | undefined>(() => {
  if (
    (!smartCursorEnabled.value && !pathfindingObstacleEdgesActive.value) ||
    !parsedObstacleTolerances.value.ok ||
    parsedObstacleTolerances.value.boundaryExpansionPlanePixels <= 0
  ) {
    return undefined;
  }

  return createBoundsRectWithBoundaryExpansion(
    visibleBoundsRect.value,
    parsedObstacleTolerances.value.boundaryExpansionPlanePixels,
  );
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
  if (smartCursorEnabled.value && pathPixels.value.length === 0) {
    visibleSoldiers = visibleSoldiers.filter((box) => isDetectionBoxOnNegativeGraphX(box));
  }
  const lastPoint = pathPixels.value.at(-1);
  if (!lastPoint) {
    return visibleSoldiers;
  }
  if (!allowedTargetRect.value) {
    return [];
  }

  return visibleSoldiers.filter((box) => Boolean(createSearchStartSoldierAimPoint(lastPoint, box)));
});
const inactiveDetectionBoxes = computed<DetectionBox[]>(() => {
  if (!smartCursorEnabled.value || toolWorkflowMode.value === "simulator") {
    return [];
  }

  const activeBoxIds = new Set(detectionBoxes.value.map((box) => box.id));
  return detectedSoldiers.value.filter(
    (box) => !activeBoxIds.has(box.id) && !detectionBoxMatchesSelectedPathPoint(box),
  );
});
const pathfindingMode = computed<PathfindingMode>(() => (effectiveSmartPathfindingEnabled.value ? "smart" : "off"));
const stepPathfindingDisabledMessage = computed(() => locale.status.stepPathfindingDisabled);

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
    configured: graphwarAgentConfigured.value,
    downloadHref: graphwarAgentDownloadHref,
    enabled: graphwarAgentEnabled.value,
    inProgress: graphwarAgentReadInProgress.value,
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
  smartCursorEnabled: smartCursorEnabled.value,
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
const obstacleBrushAvailable = computed(
  () => Boolean(detectedObstacles.value) && (smartCursorEnabled.value || smartPathfindingEnabled.value),
);
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
const actionPanel = computed(() => ({
  activeToolHint: activeToolHint.value,
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

const smartPathfindingSettingsMessage = computed(() => {
  if (toolWorkflowMode.value === "simulator") {
    return "";
  }
  if (!parsedPathfindingWorkerCount.value.ok) {
    return parsedPathfindingWorkerCount.value.message;
  }
  if (!parsedObstacleTolerances.value.ok) {
    return parsedObstacleTolerances.value.message;
  }
  return "";
});
// 一键清图应保留原预检顺序，并在普通寻路容差上追加自身专属的删点半径校验。
const oneClickClearSettingsMessage = computed(() => {
  if (toolWorkflowMode.value === "simulator") {
    return "";
  }
  if (!parsedPathfindingWorkerCount.value.ok) {
    return parsedPathfindingWorkerCount.value.message;
  }
  if (!parsedOneClickClearTolerances.value.ok) {
    return parsedOneClickClearTolerances.value.message;
  }
  return "";
});
const smartPathfindingPrerequisiteMessage = computed(() => {
  if (!imageUrl.value) {
    return locale.status.detection.uploadFirst;
  }
  if (!activeBoundsReady.value) {
    return locale.smartPathfinding.needBounds;
  }
  if (!detectedObstacles.value) {
    return locale.smartPathfinding.needDetection;
  }
  return "";
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
  secondOrderLaunchAngleText.value ? locale.status.secondOrderAngleHint(secondOrderLaunchAngleText.value) : "",
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
const smartPathfindingHeaderStatusResult = computed(() =>
  getSmartPathfindingHeaderStatus({
    smartPathfindingEnabled: effectiveSmartPathfindingEnabled.value,
    smartPathfindingSettingsMessage: smartPathfindingSettingsMessage.value,
    smartPathfindingStatusMessage: smartPathfindingStatus.value,
    smartPathfindingStatusKind: smartPathfindingStatusKind.value,
    enableHintMessage: "",
    hintMessage: locale.ui.pathfinding.smartPathfindingTitle,
  }),
);
const pathfindingHeaderStatusResult = computed(() =>
  getFirstHeaderStatus(
    // 参数错误只应在智能寻路有效启用时展示；关闭状态会隐藏一键清图入口，不应泄漏其校验错误。
    createHeaderStatus(isSmartPathfindingDisabled() ? getSmartPathfindingDisabledMessage() : "", "warning"),
    smartPathfindingHeaderStatusResult.value,
  ),
);
// 智能寻路面板只应消费展示 DTO；按钮 guard、运行状态和调试耗时仍由页面侧保持原语义。
const smartPathfindingPanel = computed<GraphwarSmartPathfindingPanelModel>(() => {
  const headerStatus = pathfindingHeaderStatusResult.value;
  return {
    debugTimingRows: smartPathfindingDebugTimingRows.value.map((entry, index) => ({
      indentLevel: entry.indentLevel,
      key: `${entry.stage}-${index}`,
      text: entry.elapsedVisible ? `${entry.label}: ${formatDebugElapsedDuration(entry.elapsedMs)}` : entry.label,
      title: entry.title,
    })),
    debugTimingVisible: smartPathfindingEnabled.value && debugInfoEnabled.value,
    fastPathfindingEnabled: fastPathfindingEnabled.value,
    friendlyFireEnabled: friendlyFireEnabled.value,
    headerStatus: {
      kind: headerStatus.kind,
      message: headerStatus.message,
      title: headerStatus.message,
    },
    oneClickClearDisabled:
      smartPathfindingInProgress.value || isOneClickClearModeUnsupported() || !objectDetectionReady.value,
    oneClickClearTitle: getOneClickClearButtonTitle(),
    searchAnimationEnabled: searchAnimationEnabled.value,
    smartPathfindingEnabled: smartPathfindingEnabled.value,
    smartPathfindingToggleDisabled: isSmartPathfindingDisabled(),
    smartPathfindingToggleTitle: getSmartPathfindingToggleTitle(),
  };
});

/** 将像素点数组格式化为 SVG polyline points 字符串。 */
function formatSvgPathPoints(points: readonly PixelPoint[]) {
  return points.length >= 2
    ? points.map((point) => `${formatSvgNumber(point.x)},${formatSvgNumber(point.y)}`).join(" ")
    : "";
}

const stageStyle = computed(() => ({
  aspectRatio: `${imageWidth.value} / ${imageHeight.value}`,
}));
// 截图/SVG 坐标像素：由 Graphwar 原始平面半径按当前 bounds 横向比例换算。
const soldierHitRadiusPixels = computed(() => getGraphwarPlaneRadiusPixels(GRAPHWAR_SOLDIER_RADIUS));
// 高级设置面板只应消费展示 DTO；输入校验、缓存失效和检测/寻路副作用仍由页面侧维护。
const advancedSettingsPanel = computed<GraphwarAdvancedSettingsPanelModel>(() => ({
  bounds: {
    maxXText: maxXText.value,
    maxYText: maxYText.value,
    minXText: minXText.value,
    minYText: minYText.value,
  },
  pathfinding: {
    obstacleExpansionMode: graphwarAgentEnabled.value ? "agent" : "detection",
    obstacleSimulationToleranceText: activeObstacleSimulationToleranceText.value,
    oneClickClearDeleteCheckRadiusMinimumPlanePixels,
    oneClickClearDeleteCheckRadiusText: oneClickClearDeleteCheckRadiusText.value,
    routePlanningToleranceText: activeRoutePlanningToleranceText.value,
    workerCountText: pathfindingWorkerCountText.value,
  },
  recognition: {
    candidateTopRatioText: soldierTemplateCandidateTopRatioText.value,
    maximumSoldierCountText: maximumSoldierCountText.value,
    obstacleMaximumArea: graphwarObstacleMaxArea,
    obstacleMinAreaText: obstacleMinAreaText.value,
    pathfindingBoundaryExpansionText: pathfindingBoundaryExpansionText.value,
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
const smartPathfindingPreviewPathPoints = computed(() => formatSvgPathPoints(smartPathfindingPreviewPath.value));
// 舞台 overlay 只应消费展示 DTO；业务规则和半径公式应由页面侧投影，避免子 Module 反向理解工作流。
const stageOverlay = computed(() => ({
  bounds: {
    allowedTargetRect: allowedTargetRect.value,
    clipBoundsRect: boundsRect.value,
    flashActive: boundsFlashActive.value,
    firstPoint: boundsFirstPoint.value,
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
  },
  liveClickPreview: {
    curvePoints: liveClickPreviewCurvePoints.value,
    curveStrokeColor: trajectoryStrokeColor.value,
    label: liveClickPreviewLabel.value,
    lineSegments: liveClickPreviewLineSegments.value,
    point: liveClickPreviewPoint.value,
  },
  obstacles: {
    brushEraseEnabled: obstacleBrushEraseEnabled.value,
    brushPreview: obstacleBrushPreview.value,
    pathfindingEdgesActive: pathfindingObstacleEdgesActive.value,
    routeEdgePath: smartPathfindingObstacleRouteEdgePath.value,
    routeFillPath: smartPathfindingObstacleRouteFillPath.value,
    simulationEdgePath: smartPathfindingObstacleSimulationEdgePath.value,
    simulationFillPath: smartPathfindingObstacleSimulationFillPath.value,
    smartCursorEnabled: smartCursorEnabled.value,
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
    agentFireVisible: graphwarAgentEnabled.value,
    canFireAgentFunction: canFireGraphwarAgentFunction.value,
    canClearSimulatorInputs: canClearSimulatorInputs.value,
    canCopyFormula: canCopyFormula.value,
    calculationMessage: calculationMessage.value,
    calculationMessageVisible:
      Boolean(calculationMessage.value) && (toolWorkflowMode.value === "simulator" || !solverResult),
    copyButtonText: copyButtonText.value,
    equationLabel: equationModes.value.find((mode) => mode.value === equationMode.value)?.label ?? "",
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
  () => imageStatus.value || imageName.value || locale.status.image.defaultStatus,
);
// 截图面板只应消费展示 DTO；DOM refs 和舞台交互语义仍由页面侧工作流持有。
const screenshotPanel = computed<GraphwarScreenshotPanelModel>(() => ({
  busyOverlayVisible: detectionInProgress.value,
  imageActionsVisible: !graphwarAgentEnabled.value,
  imageStatusText: screenshotImageStatusText.value,
  imageUrl: imageUrl.value,
  magnifier: {
    contentStyle: magnifierContentStyle.value,
    style: magnifierStyle.value,
    visible: magnifierEnabled.value && Boolean(imageUrl.value) && Boolean(magnifierPoint.value),
  },
  pathStatus: pathStatus.value,
  stage: {
    empty: !imageUrl.value,
    magnifierClipPathId: magnifierObstacleBrushClipPathId,
    mainClipPathId: mainObstacleBrushClipPathId,
    overlay: stageOverlay.value,
    style: stageStyle.value,
  },
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

/** 获取高精度时间戳，用于前端阶段计时。 */
function nowMs() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

onMounted(() => {
  window.addEventListener("paste", handlePaste);
});

onBeforeUnmount(() => {
  window.removeEventListener("paste", handlePaste);
  detectionWorkflow.dispose();
  graphwarPathfindingRunner.close();
  cancelSmartPathfinding(false);
  disposeResultActions();
  disposeGraphwarAgentFireStatus();
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

watch([formulaOutputDecimalPlaces], () => {
  clearSmartPathfindingStatus();
});

watch([algorithmMode, solverEquationMode], () => {
  clearSmartPathfindingStatus();
  cancelSmartPathfinding(false);
  if (algorithmMode.value === "step" && smartPathfindingEnabled.value) {
    smartPathfindingEnabled.value = false;
  }
  if (algorithmMode.value === "abs" && solverEquationMode.value === "ddy") {
    solverEquationMode.value = "y";
  }
});

watch([stepOverflowProtectionEnabled], () => {
  clearSmartPathfindingStatus();
});

watch([activeObstacleSimulationToleranceText, steepnessText], () => {
  clearSmartPathfindingStatus();
});

watch([smartCursorEnabled, smartPathfindingEnabled, detectedObstacles], () => {
  if (toolMode.value === "obstacle" && !obstacleBrushAvailable.value) {
    setToolMode("path");
  }
});

watch([objectDetectionReady, smartPathfindingEnabled], () => {
  if (!smartPathfindingEnabled.value || objectDetectionReady.value) {
    return;
  }

  cancelSmartPathfinding(false);
  clearSmartPathfindingStatus();
  smartPathfindingEnabled.value = false;
});

watch(
  [
    pathfindingWorkerCountText,
    activeRoutePlanningToleranceText,
    pathfindingBoundaryExpansionText,
    oneClickClearDeleteCheckRadiusText,
    minXText,
    maxXText,
    minYText,
    maxYText,
  ],
  () => {
    // 这些输入会改变几何搜索、worker 并行或公式边界语义，页面 cache 和 worker cache 必须一起失效。
    invalidatePathfindingCaches();
    clearSmartPathfindingStatus();
  },
);

/** 根据当前算法限制 Graphwar 不支持或工具无法稳定生成的公式模式。 */
function isEquationModeDisabled(mode: EquationMode) {
  if (toolWorkflowMode.value === "simulator") {
    return false;
  }
  return algorithmMode.value === "abs" && mode === "ddy";
}

/** 切换公式生成/模拟器工作流，并清理只属于旧工作流的临时状态。 */
function setToolWorkflowMode(mode: ToolWorkflowMode) {
  if (toolWorkflowMode.value === mode) {
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
  } else if (algorithmMode.value === "abs" && solverEquationMode.value === "ddy") {
    solverEquationMode.value = "y";
  }
  toolWorkflowMode.value = mode;
  clearPathInteractionState();
  hoveredDetectedSoldierId.value = undefined;
}

/** 切换公式解释模式；若算法不支持则忽略，避免 UI 进入无效组合。 */
function setEquationMode(mode: EquationMode) {
  if (isEquationModeDisabled(mode) || equationMode.value === mode) {
    return;
  }
  clearSmartPathfindingStatus();
  equationMode.value = mode;
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
    return locale.status.detection.uploadFirst;
  }
  return activeBoundsReady.value
    ? locale.ui.detection.detectObjectsTitle
    : locale.ui.detection.detectObjectsNeedBoundsTitle;
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
  await detectionWorkflow.detect(trigger);
}

/** 只识别 Graphwar 坐标系边界，并清除旧边界下的士兵和障碍结果。 */
async function detectGraphwarBounds(trigger: GraphwarDetectionRunTrigger = "manual") {
  await detectionWorkflow.detectBounds(trigger);
}

/** 在当前手动/自动边界内重新识别对象，不重新推断坐标系区域。 */
async function detectGraphwarObjectsInCurrentBounds(trigger: GraphwarDetectionRunTrigger = "manual") {
  await detectionWorkflow.detectInCurrentBounds(trigger);
}

/** 从本机 Graphwar Agent 读取当前渲染状态，直接落地为精确士兵和障碍数据。 */
async function readGraphwarAgent(trigger: GraphwarDetectionRunTrigger = "manual") {
  if (trigger === "auto") {
    return;
  }
  if (graphwarAgentReadInProgress.value) {
    return;
  }

  graphwarAgentReadInProgress.value = true;
  cancelDetection(false);
  imageStatus.value = locale.status.agent.reading;
  setDetectionStatus(locale.status.agent.reading, "warning");
  try {
    const snapshot = await readGraphwarAgentSnapshot(graphwarAgentBaseUrlText.value);
    graphwarAgentBaseUrlText.value = snapshot.baseUrl;
    graphwarAgentImageLoadBypassUrl = snapshot.imageUrl;
    applyGeneratedImage(snapshot.imageUrl, snapshot.imageName, GRAPHWAR_PLANE_LENGTH, GRAPHWAR_PLANE_HEIGHT);
    resetGraphwarDefaultBoundsTexts();
    applyGraphwarAgentEquationMode(snapshot.equationMode);
    detectionWorkflow.applyExternalResult(
      snapshot.boundsRect,
      snapshot.detectionResult,
      locale.status.agent.loaded(snapshot.detectionResult.soldiers.length),
    );
    applyGraphwarAgentCurrentTurnSoldier(snapshot.localCurrentTurnSoldierPoint);
    toolMode.value = "path";
    imageStatus.value = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedMessage = locale.status.agent.failed(message);
    imageStatus.value = failedMessage;
    setDetectionStatus(failedMessage, "error");
  } finally {
    graphwarAgentReadInProgress.value = false;
  }
}

/** Agent 当前回合是权威状态；只替换发射点，保留用户已经选好的后续目标。 */
function applyGraphwarAgentCurrentTurnSoldier(point: PixelPoint | undefined) {
  if (!point) {
    return;
  }

  setPathPixels(pathPixels.value.length > 0 ? [point, ...pathPixels.value.slice(1)] : [point]);
}

/** 通过 Agent 调用 Graphwar 原版开火路径，提交当前结果面板里的函数文本。 */
async function fireGraphwarAgentFunction() {
  const functionText = getCurrentGraphwarFunctionText();
  if (!canFireGraphwarAgentFunction.value || !functionText) {
    return;
  }

  graphwarAgentFireInProgress.value = true;
  setGraphwarAgentFireStatus("idle");
  try {
    const baseUrl = await submitGraphwarAgentFunction(graphwarAgentBaseUrlText.value, functionText);
    graphwarAgentBaseUrlText.value = baseUrl;
    setGraphwarAgentFireStatus("success");
  } catch (error) {
    graphwarAgentFireFailureMessage.value = error instanceof Error ? error.message : String(error);
    setGraphwarAgentFireStatus("error");
  } finally {
    graphwarAgentFireInProgress.value = false;
  }
}

/** 保持开火和复制使用同一份函数来源：solver 用生成结果，simulator 用用户输入。 */
function getCurrentGraphwarFunctionText() {
  const text = toolWorkflowMode.value === "solver" ? formulaResult.value?.expression : simulatorFormulaText.value;
  return text && text.trim() ? text : "";
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
    }, graphwarAgentFireStatusFlashMs);
  }
}

function disposeGraphwarAgentFireStatus() {
  if (graphwarAgentFireStatusTimer) {
    clearTimeout(graphwarAgentFireStatusTimer);
    graphwarAgentFireStatusTimer = undefined;
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
  } else if (!isEquationModeDisabled(mode)) {
    solverEquationMode.value = mode;
  }
}

/** 切换自动识别；关闭后保留当前识别结果供用户继续编辑。 */
function toggleAutoDetection() {
  detectionWorkflow.toggleAutoDetection();
}

/** 切换是否使用 Agent；只影响识别来源，不会清掉当前截图或识别结果。 */
function toggleGraphwarAgentUsage() {
  graphwarAgentEnabled.value = !graphwarAgentEnabled.value;
  if (graphwarAgentEnabled.value) {
    detectionWorkflow.cancel(false);
  } else {
    setGraphwarAgentFireStatus("idle");
  }
}

/** 同步 Agent 地址输入；地址为空时不展示手动读取按钮。 */
function setGraphwarAgentBaseUrlText(value: string) {
  graphwarAgentBaseUrlText.value = value;
  setGraphwarAgentFireStatus("idle");
}

/** 切换智能光标；关闭时清掉士兵悬停，避免残留高亮。 */
function toggleSmartCursor() {
  detectionWorkflow.toggleSmartCursor();
}

/** 切换智能寻路，并取消当前异步寻路任务。 */
function toggleSmartPathfinding() {
  if (isSmartPathfindingDisabled()) {
    setSmartPathfindingStatus(getSmartPathfindingDisabledMessage(), "warning");
    return;
  }

  cancelSmartPathfinding(false);
  clearSmartPathfindingStatus();
  smartPathfindingEnabled.value = !smartPathfindingEnabled.value;
}

/** 同步障碍笔刷直径文本，保留非法输入供校验提示展示。 */
function setObstacleBrushDiameterText(value: string) {
  obstacleBrushDiameterText.value = value;
}

/** 同步放大镜缩放文本，保留非法输入供校验提示展示。 */
function setMagnifierZoomText(value: string) {
  magnifierZoomText.value = value;
}

/** Step 公式不支持智能/一键清图，因为弹道和路径点语义不稳定。 */
function isSmartPathfindingDisabled() {
  return algorithmMode.value === "step" || Boolean(smartPathfindingPrerequisiteMessage.value);
}

/** 返回智能寻路被禁用的具体原因。 */
function getSmartPathfindingDisabledMessage() {
  return algorithmMode.value === "step"
    ? stepPathfindingDisabledMessage.value
    : smartPathfindingPrerequisiteMessage.value;
}

/** 返回智能寻路按钮 title，禁用时优先解释原因。 */
function getSmartPathfindingToggleTitle() {
  return isSmartPathfindingDisabled()
    ? getSmartPathfindingDisabledMessage()
    : locale.ui.pathfinding.smartPathfindingTitle;
}

/** 一键清图目前只支持双绝对值 y/y'，按钮状态和运行前校验共用同一条件。 */
function isOneClickClearModeUnsupported() {
  return algorithmMode.value !== "abs" || equationMode.value === "ddy";
}

/** 返回一键清图按钮 title，不支持当前模式时直接解释禁用原因。 */
function getOneClickClearButtonTitle() {
  if (!objectDetectionReady.value) {
    return smartPathfindingPrerequisiteMessage.value;
  }
  return isOneClickClearModeUnsupported()
    ? locale.smartPathfinding.oneClickClear.unsupported
    : locale.ui.pathfinding.oneClickClearTitle;
}

/** 切换友伤设置；该设置会改变士兵是否写入障碍 mask，因此需要重建路线。 */
function toggleFriendlyFire() {
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

/** 切换几何路线算法；算法改变会让旧搜索结果和 worker 私有 cache 都失效。 */
function toggleFastPathfinding() {
  if (smartPathfindingInProgress.value) {
    cancelSmartPathfinding(false);
  }
  fastPathfindingEnabled.value = !fastPathfindingEnabled.value;
  invalidatePathfindingCaches();
  clearSmartPathfindingStatus();
  clearSmartPathfindingPreview();
}

/** 页面开关叫“快速”，worker 协议使用稳定算法名，避免文案影响缓存和消息格式。 */
function getPathfindingRouteMode(): GraphwarPathfindingRouteMode {
  return fastPathfindingEnabled.value ? "visibility-graph" : "theta-star";
}

/** 根据当前模式将指针点击分发给边界点选或路径点选。 */
function handleStagePointerDown(event: PointerEvent) {
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
  if (smartCursorEnabled.value && selectedSoldier) {
    void appendDetectedSoldierPathPoint(selectedSoldier);
    return;
  }

  void appendPathPoint(point);
}

/** 一键清图：从当前路径尾部出发，完整遍历 x 单调可达状态并追加当前模型下击杀最多的路径。 */
async function runOneClickClear() {
  return oneClickClearRunWorkflow.run();
}

/** 路径变更后同步落地并清空旧状态。 */
function setPathPixels(points: PixelPoint[]) {
  if (pathStartChanges(points)) {
    invalidatePathfindingWorkerCache();
  }
  clearSmartPathfindingBlockedPoint();
  pathPixels.value = points;
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
  const hoveredSoldier = smartCursorEnabled.value ? getDetectedSoldierAtPoint(point)?.id : undefined;
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
  if (mode === "obstacle" && !obstacleBrushAvailable.value) {
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
  if (toolMode.value !== "path") {
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
  if (toolMode.value !== "path") {
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
  <p>
    {{ locale.ui.introPrefix }}
    <a href="https://graphwar.com/graphwar_1/index.html">{{ locale.ui.introLinkText }}</a>
    {{ locale.ui.introSuffix }}
  </p>

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
      @cancel-debug-activation-hold="cancelDebugActivationHold"
      @finish-debug-activation-hold="finishDebugActivationHold"
      @set-algorithm-mode="algorithmMode = $event"
      @set-equation-mode="setEquationMode"
      @set-tool-workflow-mode="setToolWorkflowMode"
      @start-debug-activation-hold="startDebugActivationHold"
      @toggle-advanced-settings="toggleAdvancedSettings"
      @toggle-step-overflow-protection="stepOverflowProtectionEnabled = !stepOverflowProtectionEnabled"
      @update-precision-text="precisionText = $event"
      @update-steepness-text="steepnessText = $event"
    />
    <GraphwarAdvancedSettingsPanel
      v-if="advancedSettingsVisible"
      :locale="locale"
      :panel="advancedSettingsPanel"
      @toggle-simulator-parse-derivative-as-y="simulatorParseDerivativeAsY = !simulatorParseDerivativeAsY"
      @toggle-simulator-skip-unknown-characters="simulatorSkipUnknownCharacters = !simulatorSkipUnknownCharacters"
      @update-candidate-top-ratio-text="soldierTemplateCandidateTopRatioText = $event"
      @update-max-x-text="maxXText = $event"
      @update-max-y-text="maxYText = $event"
      @update-maximum-soldier-count-text="maximumSoldierCountText = $event"
      @update-min-x-text="minXText = $event"
      @update-min-y-text="minYText = $event"
      @update-obstacle-min-area-text="obstacleMinAreaText = $event"
      @update-obstacle-simulation-tolerance-text="activeObstacleSimulationToleranceText = $event"
      @update-one-click-clear-delete-check-radius-text="oneClickClearDeleteCheckRadiusText = $event"
      @update-pathfinding-boundary-expansion-text="pathfindingBoundaryExpansionText = $event"
      @update-pathfinding-worker-count-text="pathfindingWorkerCountText = $event"
      @update-route-planning-tolerance-text="activeRoutePlanningToleranceText = $event"
      @update-template-matching-worker-count-text="templateMatchingWorkerCountText = $event"
    />
    <div class="graphwar-killer__detection-pathfinding-row">
      <GraphwarDetectionPanel
        :locale="locale"
        :panel="detectionPanel"
        @detect-bounds="void detectGraphwarBounds()"
        @detect-objects="void detectGraphwarObjectsInCurrentBounds()"
        @read-agent="void readGraphwarAgent()"
        @toggle-agent-usage="toggleGraphwarAgentUsage"
        @toggle-auto-detection="toggleAutoDetection"
        @toggle-smart-cursor="toggleSmartCursor"
        @update-agent-base-url="setGraphwarAgentBaseUrlText"
      />
      <GraphwarSmartPathfindingPanel
        v-if="toolWorkflowMode !== 'simulator'"
        :locale="locale"
        :panel="smartPathfindingPanel"
        @run-one-click-clear="void runOneClickClear()"
        @toggle-friendly-fire="toggleFriendlyFire"
        @toggle-fast-pathfinding="toggleFastPathfinding"
        @toggle-search-animation="toggleSearchAnimation"
        @toggle-smart-pathfinding="toggleSmartPathfinding"
      />
    </div>
    <GraphwarActionPanel
      :locale="locale"
      :panel="actionPanel"
      @clear-obstacle-edits="resetObstacleEdits"
      @clear-path="clearPath"
      @set-tool-mode="setToolMode"
      @toggle-live-click-preview="liveClickPreviewEnabled = !liveClickPreviewEnabled"
      @toggle-magnifier="magnifierEnabled = !magnifierEnabled"
      @toggle-obstacle-brush-erase="toggleObstacleBrushErase"
      @undo-point="undoLastPoint"
      @update-magnifier-zoom="setMagnifierZoomText"
      @update-obstacle-brush-diameter="setObstacleBrushDiameterText"
    />
    <GraphwarScreenshotPanel
      :locale="locale"
      :panel="screenshotPanel"
      @cancel-detection="cancelDetection(true)"
      @capture-image="captureScreenImage"
      @drop-image="handleDrop"
      @image-load="handleImageLoad"
      @set-image-element="setScreenshotImageElement"
      @set-stage-element="setScreenshotStageElement"
      @stage-context-menu="handleStageContextMenu"
      @stage-pointer-down="handleStagePointerDown"
      @stage-pointer-leave="handleStagePointerLeave"
      @stage-pointer-move="handleStagePointerMove"
      @stage-pointer-up="handleStagePointerUp"
      @upload-image="handleImageUpload"
    />
    <GraphwarResultPanel
      :locale="locale"
      :result="resultPanel"
      @clear-simulator="clearSimulatorInputs"
      @copy-formula="copyFormula"
      @fire-agent-function="void fireGraphwarAgentFunction()"
      @finish-point-coordinate-edit="finishPathPointCoordinateEdit"
      @start-point-coordinate-edit="startPathPointCoordinateEdit"
      @update-point-coordinate="handlePathPointCoordinateInput"
      @update-simulator-formula-text="simulatorFormulaText = $event"
      @update-simulator-launch-angle-text="simulatorLaunchAngleText = $event"
    />
  </div>

  <section class="graphwar-killer__instructions">
    <h2>{{ locale.ui.instructions.title }}</h2>
    <ul>
      <li
        v-for="item in locale.ui.instructions.items"
        :key="item"
      >
        {{ item }}
      </li>
    </ul>
  </section>
</template>

<style scoped>
.graphwar-killer {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
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
