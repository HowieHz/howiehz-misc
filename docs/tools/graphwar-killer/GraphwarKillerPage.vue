<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import GraphwarActionPanel from "./components/GraphwarActionPanel.vue";
import GraphwarAdvancedSettingsPanel, {
  type GraphwarAdvancedSettingsPanelModel,
} from "./components/GraphwarAdvancedSettingsPanel.vue";
import GraphwarDetectionPanel, { type GraphwarDetectionPanelModel } from "./components/GraphwarDetectionPanel.vue";
import GraphwarResultPanel from "./components/GraphwarResultPanel.vue";
import GraphwarScreenshotPanel, { type GraphwarScreenshotPanelModel } from "./components/GraphwarScreenshotPanel.vue";
import GraphwarSettingsPanel, { type GraphwarSettingsPanelModel } from "./components/GraphwarSettingsPanel.vue";
import GraphwarSmartPathfindingPanel, {
  type GraphwarSmartPathfindingPanelModel,
} from "./components/GraphwarSmartPathfindingPanel.vue";
import { useGraphwarDebugActivation } from "./composables/use-graphwar-debug-activation";
import {
  useGraphwarDebugTimings,
  type DetectionDebugTimingEntry,
  type SmartPathfindingDebugTimingEntry,
} from "./composables/use-graphwar-debug-timings";
import { useGraphwarObstacleEditor } from "./composables/use-graphwar-obstacle-editor";
import { useGraphwarPathState, type PathPointCoordinateAxis } from "./composables/use-graphwar-path-state";
import { useGraphwarScreenshotWorkflow } from "./composables/use-graphwar-screenshot";
import {
  useGraphwarSmartPathfindingSession,
  type GraphwarPathfindingLineSegment,
  type SmartPathfindingPhase,
  type SmartPathfindingStatusKind,
} from "./composables/use-graphwar-smart-pathfinding-session";
import { useGraphwarStageFeedback } from "./composables/use-graphwar-stage-feedback";
import {
  graphToImagePoint,
  imageToGraphPoint,
  normalizeBoundsRect,
  normalizePathPoint,
  xPlusGoesRight,
} from "./core/geometry";
import {
  GRAPHWAR_DEFAULT_X_LIMIT,
  GRAPHWAR_GAME_SOLDIER_RADIUS,
  GRAPHWAR_PLANE_GAME_LENGTH,
  GRAPHWAR_PLANE_HEIGHT,
  GRAPHWAR_PLANE_LENGTH,
  GRAPHWAR_SOLDIER_RADIUS,
  GRAPHWAR_SOLDIER_VISIBLE_SIZE,
  GRAPHWAR_VISIBLE_Y_LIMIT,
} from "./core/graphwar";
import {
  createMinimumForwardPointAtGraphY,
  graphXAdvancesFromPoint,
  normalizePathForMinimumForwardStep,
  normalizePathPointForStrictForward,
  pathFollowsGraphRule,
} from "./core/graphwar-forward-rule";
import {
  DEFAULT_FORMULA_DECIMAL_PLACES,
  MAX_FORMULA_DECIMAL_PLACES,
  clampNumber,
  formatAngleDegree,
  formatDecimal,
  formatDoublePrecisionDecimal,
  formatSvgNumber,
  graphXAdvancesStrictly,
  nearlyEqual,
  parseFiniteNumber,
} from "./core/numbers";
import { graphwarToolDefaults } from "./core/tool-defaults";
import { createGraphPoint, createPixelPoint } from "./core/types";
import type {
  AlgorithmMode,
  BoundsRect,
  EquationMode,
  FormulaResult,
  GraphBounds,
  GraphPoint,
  PixelPoint,
  ToolMode,
  ToolWorkflowMode,
  TransferStatus,
} from "./core/types";
import { buildObstacleEdgePath, buildObstacleFillPath, isPlayerColorPixel } from "./detection/graphwar-detection";
import type { GraphwarDetectionBox, GraphwarObjectsDetectionResult } from "./detection/graphwar-detection";
import {
  createGraphwarDetectionRunner,
  isGraphwarDetectionCancelledError,
} from "./detection/graphwar-detection-runner";
import type { GraphwarDetectionWorkerStage } from "./detection/graphwar-detection-runner";
import { buildFormula } from "./formula/formula";
import {
  createGraphwarTrajectoryFormulaContext,
  findGraphwarTrajectoryTargetHitIndex,
  getGraphwarTrajectoryLaunchAngle,
  sampleGraphwarExpressionTrajectoryWithStops,
  sampleGraphwarFormulaTrajectory,
  sampleGraphwarPathTrajectory,
} from "./formula/trajectory-sampling";
import type { GraphwarTrajectoryFormulaSettings, GraphwarTrajectorySampleResult } from "./formula/trajectory-sampling";
import type { GraphwarKillerLocale } from "./locale-types";
import {
  GRAPHWAR_DEFAULT_ROUTE_PLANNING_TOLERANCE_PLANE_PIXELS,
  type GraphwarOneClickClearCandidate,
  type GraphwarOneClickClearFailureReason,
} from "./pathfinding/graphwar-one-click-clear";
import { mirrorPlaneGridPoint, planeGridCellCenterToImagePoint } from "./pathfinding/graphwar-pathfinding";
import type { GraphwarPathfindingPreview, PlaneGridPoint } from "./pathfinding/graphwar-pathfinding";
import { createGraphwarPathfindingCacheController } from "./pathfinding/graphwar-pathfinding-cache";
import {
  createGraphwarPathfindingRunner,
  isGraphwarPathfindingCancelledError,
} from "./pathfinding/graphwar-pathfinding-runner";
import type {
  GraphwarOneClickClearPathWorkerInput,
  GraphwarSmartPathfindingPathInput,
} from "./pathfinding/graphwar-pathfinding-worker-types";
import {
  createHeaderStatus,
  getFirstHeaderStatus,
  getSmartPathfindingHeaderStatus,
} from "./presentation/header-status";

/** 坐标边界解析结果；失败分支直接携带本地化校验文案。 */
type ParsedBounds = { ok: true; bounds: GraphBounds } | { ok: false; message: string };
/** Step 陡峭度解析结果；只有 step 算法会消费成功值。 */
type ParsedSteepness = { ok: true; steepness: number } | { ok: false; message: string };
/** 公式输出小数位解析结果；只控制生成公式文本，不约分内部路径点或发射点。 */
type ParsedPrecision = { ok: true; decimalPlaces: number } | { ok: false; message: string };
/** 识别设定解析结果，失败时阻止重新识别。 */
type ParsedDetectionSettings =
  | {
      ok: true;
      candidateTopRatio: number;
      maximumSoldierCount: number;
      minArea: number;
      templateMatchingWorkerCount: number;
    }
  | { ok: false; message: string };
/** 放大镜倍率解析结果；允许输入框超过滑条快速范围。 */
type ParsedMagnifierZoom = { ok: true; zoom: number } | { ok: false; message: string };
/** 障碍笔刷直径解析结果，单位为 Graphwar 原始 770x450 平面像素。 */
type ParsedObstacleBrushDiameter = { ok: true; diameter: number } | { ok: false; message: string };
/** 寻路并行数解析结果；1 表示一键清图 DAG 建边在 master worker 内串行执行。 */
type ParsedPathfindingWorkerCount = { ok: true; workerCount: number } | { ok: false; message: string };
/** 寻路容差解析结果；所有距离都使用 Graphwar 原始 770x450 平面像素。 */
type ParsedObstacleTolerances =
  | {
      ok: true;
      boundaryExpansionPlanePixels: number;
      oneClickClearDeleteCheckRadiusPixels: number;
      routePlanningTolerancePlanePixels: number;
      simulationTolerancePlanePixels: number;
    }
  | { ok: false; message: string };
/** 寻路模式；auto-graph 保留为待重写的禁用入口。 */
type PathfindingMode = "off" | "smart" | "auto-graph";
/** 识别状态等级，与面板标题和智能寻路状态样式对齐。 */
type DetectionStatusKind = "info" | "success" | "warning" | "error";
/** 截图上的检测框，坐标均为图片像素。 */
type DetectionBox = GraphwarDetectionBox;
/** 命中圈判定：中心是 Graphwar 士兵源码中心，半径是源码 hitRadius。 */
interface HitCircle {
  /** 命中圈中心。 */
  center: PixelPoint;
  /** 命中圈半径。 */
  radius: number;
}
/** 智能寻路目标；targetPoint 用于几何绕障，hitCircle 用于弹道验证。 */
interface SmartPathfindingTarget {
  /** 弹道必须命中的目标圈。 */
  hitCircle: HitCircle;
  /** 几何路径要连接到的点。 */
  targetPoint: PixelPoint;
}
/** 智能寻路构建结果；cacheHit 只表示完整结果缓存，不混淆 route mask/可视图 cache。 */
interface SmartPathfindingPathBuildResult {
  /** 完整路径结果是否来自页面侧结果缓存。 */
  cacheHit: boolean;
  /** 可直接写回页面的完整像素路径。 */
  path: PixelPoint[];
}
/** 士兵命中圈的 x+ 检查结果：center 优先，edge 表示只能瞄准最小前进线。 */
interface SoldierAimCheckResult {
  /** 通过哪一级检查。 */
  kind: "center" | "edge";
  /** 点击该士兵时首选追加或寻路的点。 */
  point: PixelPoint;
}
/** 单目标弹道验证结果。 */
interface PathTrajectoryResult {
  /** 未命中目标前碰到障碍或边界的位置。 */
  blockedPoint?: PixelPoint;
  /** 是否先命中目标再碰障碍。 */
  reachesTargetBeforeObstacle: boolean;
  /** 可绘制轨迹。 */
  visiblePixels: PixelPoint[];
}
/** 页面轨迹碰撞设置，模拟器和公式预览共享。 */
interface TrajectoryCollisionSettings {
  /** 边界收缩像素。 */
  boundaryExpansion: number;
  /** 模拟障碍 mask。 */
  mask: Uint8Array;
}
const { locale } = defineProps<{
  locale: GraphwarKillerLocale;
}>();

const graphwarDefaultXLimitText = formatDoublePrecisionDecimal(GRAPHWAR_DEFAULT_X_LIMIT);
const graphwarVisibleYLimitText = formatDoublePrecisionDecimal(GRAPHWAR_VISIBLE_Y_LIMIT);
const graphwarObstacleToleranceLimit = Math.floor(GRAPHWAR_PLANE_LENGTH / 2);
const graphwarBoundaryExpansionLimit = Math.floor((Math.min(GRAPHWAR_PLANE_LENGTH, GRAPHWAR_PLANE_HEIGHT) - 1) / 2);
const graphwarObstacleMaxArea = GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT;
const magnifierMinimumZoom = 1;
const magnifierSliderMaximumZoom = 5;
const magnifierInputMaximumZoom = 100;
const oneClickClearDeleteCheckRadiusMinimumPixels = 1;
const oneClickClearDeleteCheckRadiusDefaultPixels = 3.5;
const obstacleBrushMinimumDiameter = 1;
const obstacleBrushSliderMaximumDiameter = 200;
const obstacleBrushInputMaximumDiameter = 1000;
const obstacleBrushEditRefreshDelayMs = 250;
const smartPathfindingBlockedPointFlashMs = 1800;
const mainObstacleBrushClipPathId = "graphwar-killer-obstacle-brush-clip";
const magnifierObstacleBrushClipPathId = "graphwar-killer-magnifier-obstacle-brush-clip";

// 页面状态按未来可抽工作流分区维护：基础舞台、公式设置、截图、识别、障碍编辑、寻路。
const boundsRect = ref<BoundsRect>({ ...graphwarToolDefaults.boundsRect });
const boundsFirstPoint = ref<PixelPoint>();
const pointerPreviewPoint = ref<PixelPoint>();
const magnifierEnabled = ref(false);
const magnifierZoomText = ref(String(graphwarToolDefaults.magnifierZoom));
const magnifierPoint = ref<PixelPoint>();
const liveClickPreviewEnabled = ref(false);
const liveClickPreviewPointerPoint = ref<PixelPoint>();
const liveClickPreviewPointerPathPointIndex = ref<number>();
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
const detectionStatusWarning = ref("");
const detectionStatusWarningTitle = ref("");
const simulatorSkipUnknownCharacters = ref(true);
const simulatorParseDerivativeAsY = ref(true);
const obstacleMinAreaText = ref(String(graphwarToolDefaults.obstacleMinArea));
const maximumSoldierCountText = ref(String(graphwarToolDefaults.maximumSoldierCount));
const soldierTemplateCandidateTopRatioText = ref(String(graphwarToolDefaults.soldierTemplateCandidateTopRatio));
const templateMatchingWorkerCountText = ref(String(graphwarToolDefaults.templateMatchingWorkerCount));
const pathfindingWorkerCountText = ref(String(graphwarToolDefaults.pathfindingWorkerCount));
const routePlanningToleranceText = ref(String(GRAPHWAR_DEFAULT_ROUTE_PLANNING_TOLERANCE_PLANE_PIXELS));
const obstacleSimulationToleranceText = ref("1");
const pathfindingBoundaryExpansionText = ref("1");
const oneClickClearDeleteCheckRadiusText = ref(String(oneClickClearDeleteCheckRadiusDefaultPixels));
const simulatorFormulaText = ref("");
const simulatorLaunchAngleText = ref("");
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
const graphwarDetectionRunner = createGraphwarDetectionRunner();
const graphwarPathfindingRunner = createGraphwarPathfindingRunner();
// 识别状态保留 baseline，用于障碍编辑后仍能恢复自动识别出的原始 mask。
const detectionStatus = ref("");
const detectionStatusKind = ref<DetectionStatusKind>("info");
const detectionInProgress = ref(false);
const detectedSoldiers = ref<DetectionBox[]>([]);
const autoDetectionEnabled = ref(true);
const smartCursorEnabled = ref(true);
const smartPathfindingEnabled = ref(false);
const friendlyFireEnabled = ref(false);
const obstacleBrushDiameterText = ref("30");
const searchAnimationEnabled = ref(true);
// 智能寻路和一键清图共用同一组运行状态、预览层和取消 token，避免两个异步任务同时回写页面。
const smartPathfindingSession = useGraphwarSmartPathfindingSession({
  blockedPointFlashMs: smartPathfindingBlockedPointFlashMs,
  getCancelledMessage: () => getSmartPathfindingCancelledMessage(),
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
  addOneClickClearRouteMaskDebugTiming,
  addOneClickClearSearchDebugTiming,
  addSmartPathfindingWorkerTimings,
  clearSmartPathfindingDebugTimings,
  createDetectionDebugTimingEntriesFromWorker,
  detectionDebugTimingRows,
  finishDetectionDebugTimings,
  finishSmartPathfindingDebugTimings,
  insertDebugTimingsBeforeLastStage,
  measureDetectionDebugStage,
  measureSmartPathfindingDebugStage,
  measureSmartPathfindingDebugStageAsync,
  smartPathfindingDebugTimingRows,
  subtractLastDebugStageElapsed,
  sumDebugTimingElapsed,
} = useGraphwarDebugTimings({
  getLocale: () => locale,
  isDetectionRunActive: isActiveDetectionRun,
});
// 舞台反馈只应持有短暂高亮状态和清理逻辑；页面继续决定触发时机。
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
// 障碍编辑只应管理 mask、baseline、笔刷手势和延迟统计；页面继续负责模式分派和寻路语义。
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
const pathfindingCache = createGraphwarPathfindingCacheController();
const effectiveSmartPathfindingEnabled = computed(
  () => toolWorkflowMode.value !== "simulator" && algorithmMode.value !== "step" && smartPathfindingEnabled.value,
);
const pathfindingObstacleEdgesActive = computed(() => effectiveSmartPathfindingEnabled.value);
const blocksFriendlyFireTargets = computed(
  () => pathfindingObstacleEdgesActive.value && !friendlyFireEnabled.value && pathPixels.value.length > 0,
);
const hoveredDetectedSoldierId = ref<string>();
const copyStatus = ref<TransferStatus>("idle");
let copyStatusTimer: ReturnType<typeof setTimeout> | undefined;
let detectionRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let liveClickPreviewPointerFrame: number | undefined;
let liveClickPreviewPendingPathPointIndex: number | undefined;
let liveClickPreviewPendingPointerPoint: PixelPoint | undefined;
let detectionRunId = 0;

const equationModes = computed(() => locale.equationModes);
const toolWorkflowModes = computed(() => locale.toolWorkflowModes);
const algorithmModes = computed(() => locale.algorithmModes);

const parsedBounds = computed<ParsedBounds>(() => {
  const minX = parseFiniteNumber(minXText.value);
  const maxX = parseFiniteNumber(maxXText.value);
  const minY = parseFiniteNumber(minYText.value);
  const maxY = parseFiniteNumber(maxYText.value);

  if (minX === undefined || maxX === undefined || minY === undefined || maxY === undefined) {
    return { ok: false as const, message: locale.validation.boundsInvalidNumber };
  }

  if (minX >= maxX || nearlyEqual(minX, maxX)) {
    return { ok: false as const, message: locale.validation.maxXGreaterThanMinX };
  }
  if (minY >= maxY || nearlyEqual(minY, maxY)) {
    return { ok: false as const, message: locale.validation.maxYGreaterThanMinY };
  }

  return { ok: true as const, bounds: { minX, maxX, minY, maxY } };
});

const parsedSteepness = computed<ParsedSteepness>(() => {
  const steepness = parseFiniteNumber(steepnessText.value);
  if (steepness === undefined || steepness <= 0) {
    return { ok: false as const, message: locale.validation.stepSteepnessNumber };
  }
  return { ok: true as const, steepness };
});

const parsedPrecision = computed<ParsedPrecision>(() => {
  const decimalPlaces = parseFiniteNumber(precisionText.value);
  if (decimalPlaces === undefined || !Number.isInteger(decimalPlaces)) {
    return { ok: false as const, message: locale.validation.decimalPlacesInteger };
  }
  if (decimalPlaces < 0 || decimalPlaces > MAX_FORMULA_DECIMAL_PLACES) {
    return { ok: false as const, message: locale.validation.decimalPlacesRange(MAX_FORMULA_DECIMAL_PLACES) };
  }
  return { ok: true as const, decimalPlaces };
});

const parsedDetectionSettings = computed<ParsedDetectionSettings>(() => {
  const maximumSoldierCount = parseFiniteNumber(maximumSoldierCountText.value);
  if (maximumSoldierCount === undefined || !Number.isInteger(maximumSoldierCount)) {
    return { ok: false as const, message: locale.validation.maximumSoldierCountInteger };
  }
  if (maximumSoldierCount < 1) {
    return { ok: false as const, message: locale.validation.maximumSoldierCountPositive };
  }

  const candidateTopRatio = parseFiniteNumber(soldierTemplateCandidateTopRatioText.value);
  if (candidateTopRatio === undefined) {
    return { ok: false as const, message: locale.validation.soldierTemplateCandidateTopRatioNumber };
  }
  if (candidateTopRatio <= 0 || candidateTopRatio > 1) {
    return { ok: false as const, message: locale.validation.soldierTemplateCandidateTopRatioRange };
  }

  const templateMatchingWorkerCount = parseFiniteNumber(templateMatchingWorkerCountText.value);
  if (templateMatchingWorkerCount === undefined || !Number.isInteger(templateMatchingWorkerCount)) {
    return { ok: false as const, message: locale.validation.templateMatchingWorkerCountInteger };
  }
  if (templateMatchingWorkerCount < 1 || templateMatchingWorkerCount > 128) {
    return { ok: false as const, message: locale.validation.templateMatchingWorkerCountRange };
  }

  const minArea = parseFiniteNumber(obstacleMinAreaText.value);
  if (minArea === undefined || !Number.isInteger(minArea)) {
    return { ok: false as const, message: locale.validation.obstacleMinAreaInteger };
  }
  if (minArea < 0 || minArea > graphwarObstacleMaxArea) {
    return { ok: false as const, message: locale.validation.obstacleMinAreaRange(graphwarObstacleMaxArea) };
  }

  return { ok: true as const, candidateTopRatio, maximumSoldierCount, minArea, templateMatchingWorkerCount };
});

const parsedMagnifierZoom = computed<ParsedMagnifierZoom>(() => {
  const zoom = parseFiniteNumber(magnifierZoomText.value);
  if (zoom === undefined) {
    return { ok: false as const, message: locale.validation.magnifierZoomNumber };
  }
  if (zoom < magnifierMinimumZoom || zoom > magnifierInputMaximumZoom) {
    return {
      ok: false as const,
      message: locale.validation.magnifierZoomRange(magnifierMinimumZoom, magnifierInputMaximumZoom),
    };
  }
  return { ok: true as const, zoom };
});

const parsedObstacleBrushDiameter = computed<ParsedObstacleBrushDiameter>(() => {
  const diameter = parseFiniteNumber(obstacleBrushDiameterText.value);
  if (diameter === undefined || !Number.isInteger(diameter)) {
    return { ok: false as const, message: locale.validation.obstacleBrushDiameterInteger };
  }
  if (diameter < obstacleBrushMinimumDiameter || diameter > obstacleBrushInputMaximumDiameter) {
    return {
      ok: false as const,
      message: locale.validation.obstacleBrushDiameterRange(
        obstacleBrushMinimumDiameter,
        obstacleBrushInputMaximumDiameter,
      ),
    };
  }
  return { ok: true as const, diameter };
});

const parsedPathfindingWorkerCount = computed<ParsedPathfindingWorkerCount>(() => {
  const workerCount = parseFiniteNumber(pathfindingWorkerCountText.value);
  if (workerCount === undefined || !Number.isInteger(workerCount)) {
    return { ok: false as const, message: locale.validation.pathfindingWorkerCountInteger };
  }
  if (workerCount < 1 || workerCount > 128) {
    return { ok: false as const, message: locale.validation.pathfindingWorkerCountRange };
  }
  return { ok: true as const, workerCount };
});

const parsedObstacleTolerances = computed<ParsedObstacleTolerances>(() => {
  if (!parsedBounds.value.ok) {
    return { ok: false as const, message: parsedBounds.value.message };
  }

  const routePlanningTolerancePlanePixels = parseFiniteNumber(routePlanningToleranceText.value);
  if (routePlanningTolerancePlanePixels === undefined) {
    return { ok: false as const, message: locale.validation.routePlanningToleranceNumber };
  }

  const simulationTolerancePlanePixels = parseFiniteNumber(obstacleSimulationToleranceText.value);
  if (simulationTolerancePlanePixels === undefined) {
    return { ok: false as const, message: locale.validation.simulationToleranceNumber };
  }

  const boundaryExpansionPlanePixels = parseFiniteNumber(pathfindingBoundaryExpansionText.value);
  if (boundaryExpansionPlanePixels === undefined) {
    return { ok: false as const, message: locale.validation.boundaryExpansionNumber };
  }
  if (boundaryExpansionPlanePixels < 0) {
    return { ok: false as const, message: locale.validation.boundaryExpansionNegative };
  }

  const oneClickClearDeleteCheckRadiusPixels = parseFiniteNumber(oneClickClearDeleteCheckRadiusText.value);
  if (oneClickClearDeleteCheckRadiusPixels === undefined) {
    return { ok: false as const, message: locale.validation.oneClickClearDeleteCheckRadiusNumber };
  }

  if (Math.abs(routePlanningTolerancePlanePixels) > graphwarObstacleToleranceLimit) {
    return {
      ok: false as const,
      message: locale.validation.routePlanningTolerancePixelRange(graphwarObstacleToleranceLimit),
    };
  }

  if (Math.abs(simulationTolerancePlanePixels) > graphwarObstacleToleranceLimit) {
    return {
      ok: false as const,
      message: locale.validation.simulationTolerancePixelRange(graphwarObstacleToleranceLimit),
    };
  }

  if (boundaryExpansionPlanePixels > graphwarBoundaryExpansionLimit) {
    return {
      ok: false as const,
      message: locale.validation.boundaryExpansionPixelRange(graphwarBoundaryExpansionLimit),
    };
  }

  if (
    oneClickClearDeleteCheckRadiusPixels < oneClickClearDeleteCheckRadiusMinimumPixels ||
    oneClickClearDeleteCheckRadiusPixels > soldierMarkerRadius.value
  ) {
    return {
      ok: false as const,
      message: locale.validation.oneClickClearDeleteCheckRadiusRange(
        oneClickClearDeleteCheckRadiusMinimumPixels,
        soldierMarkerRadius.value,
      ),
    };
  }

  return {
    ok: true as const,
    boundaryExpansionPlanePixels,
    oneClickClearDeleteCheckRadiusPixels,
    routePlanningTolerancePlanePixels,
    simulationTolerancePlanePixels,
  };
});

const mappedPathPoints = computed<GraphPoint[]>(() => {
  const boundsResult = parsedBounds.value;
  if (!boundsResult.ok) {
    return [];
  }
  return pathPixels.value.map((point) => imageToGraphPoint(point, boundsResult.bounds, boundsRect.value));
});

const formulaOutputDecimalPlaces = computed(() =>
  parsedPrecision.value.ok ? parsedPrecision.value.decimalPlaces : DEFAULT_FORMULA_DECIMAL_PLACES,
);
const formulaSteepness = computed(() => (parsedSteepness.value.ok ? parsedSteepness.value.steepness : 1));
const graphwarTrajectoryFormulaSettings = computed<GraphwarTrajectoryFormulaSettings>(() => ({
  algorithm: algorithmMode.value,
  decimalPlaces: formulaOutputDecimalPlaces.value,
  equation: equationMode.value,
  formulaPathSteepness: formulaSteepness.value,
  steepness: formulaSteepness.value,
  stepOverflowProtection: stepOverflowProtectionEnabled.value,
}));

/** 统一公式点、采样 evaluator 和数值保护设置，页面后续只消费这个轨迹采样上下文。 */
const graphwarTrajectoryFormulaContext = computed(() => {
  const boundsResult = parsedBounds.value;
  if (!boundsResult.ok) {
    return undefined;
  }
  return createGraphwarTrajectoryFormulaContext({
    bounds: boundsResult.bounds,
    points: mappedPathPoints.value,
    settings: graphwarTrajectoryFormulaSettings.value,
    soldierCenter: mappedPathPoints.value[0],
  });
});

/** 给像素路径验证入口提供当前公式配置，避免智能寻路和一键清图各自重建采样规则。 */
function createPathTrajectoryFormulaSettings(): GraphwarTrajectoryFormulaSettings {
  return graphwarTrajectoryFormulaSettings.value;
}

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
const visibleObstacleEdgePath = computed(() => {
  const obstacleMap = detectedObstacles.value;
  if (!obstacleMap || pathfindingObstacleEdgesActive.value) {
    return "";
  }

  return buildObstacleEdgePath(obstacleMap.mask, boundsRect.value);
});
const visibleObstacleFillPath = computed(() => {
  const obstacleMap = detectedObstacles.value;
  if (!obstacleMap || pathfindingObstacleEdgesActive.value) {
    return "";
  }

  return buildObstacleFillPath(obstacleMap.mask, boundsRect.value);
});
const smartPathfindingBaseObstacleMask = computed(() => {
  const obstacleMap = detectedObstacles.value;
  if (!obstacleMap || !blocksFriendlyFireTargets.value || !parsedBounds.value.ok) {
    return obstacleMap?.mask;
  }

  const friendlySoldiers = detectedSoldiers.value.filter((soldier) => isDetectedFriendlySoldierObstacle(soldier));
  if (friendlySoldiers.length === 0) {
    return obstacleMap.mask;
  }

  return pathfindingCache.getCachedFriendlyObstacleMask(
    obstacleMap.mask,
    boundsRect.value,
    friendlySoldiers,
    soldierMarkerRadius.value,
  );
});
const activePathfindingBaseObstacleMask = computed(() => {
  if (pathfindingObstacleEdgesActive.value) {
    return smartPathfindingBaseObstacleMask.value;
  }
  return detectedObstacles.value?.mask;
});
const smartPathfindingVisibleRouteTolerance = computed(() => {
  const tolerances = parsedObstacleTolerances.value;
  if (!tolerances.ok) {
    return 0;
  }
  return tolerances.routePlanningTolerancePlanePixels;
});
const smartPathfindingObstacleRouteEdgePath = computed(() => {
  const obstacleMask = pathfindingObstacleEdgesActive.value ? activePathfindingBaseObstacleMask.value : undefined;
  if (!obstacleMask || !parsedObstacleTolerances.value.ok) {
    return "";
  }

  return buildObstacleEdgePath(
    pathfindingCache.getCachedRouteMask(obstacleMask, smartPathfindingVisibleRouteTolerance.value).mask,
    boundsRect.value,
  );
});
const smartPathfindingObstacleRouteFillPath = computed(() => {
  const obstacleMask = pathfindingObstacleEdgesActive.value ? activePathfindingBaseObstacleMask.value : undefined;
  if (!obstacleMask || !parsedObstacleTolerances.value.ok) {
    return "";
  }

  return buildObstacleFillPath(
    pathfindingCache.getCachedRouteMask(obstacleMask, smartPathfindingVisibleRouteTolerance.value).mask,
    boundsRect.value,
  );
});
const smartPathfindingObstacleSimulationEdgePath = computed(() => {
  const obstacleMask = pathfindingObstacleEdgesActive.value ? activePathfindingBaseObstacleMask.value : undefined;
  if (!obstacleMask || !parsedObstacleTolerances.value.ok) {
    return "";
  }

  return buildObstacleEdgePath(
    pathfindingCache.getCachedRouteMask(obstacleMask, parsedObstacleTolerances.value.simulationTolerancePlanePixels)
      .mask,
    boundsRect.value,
  );
});
const smartPathfindingObstacleSimulationFillPath = computed(() => {
  const obstacleMask = pathfindingObstacleEdgesActive.value ? activePathfindingBaseObstacleMask.value : undefined;
  if (!obstacleMask || !parsedObstacleTolerances.value.ok) {
    return "";
  }

  return buildObstacleFillPath(
    pathfindingCache.getCachedRouteMask(obstacleMask, parsedObstacleTolerances.value.simulationTolerancePlanePixels)
      .mask,
    boundsRect.value,
  );
});
const simulationObstacleMask = computed(() => {
  const obstacleMap = detectedObstacles.value;
  if (!obstacleMap) {
    return undefined;
  }
  if (!effectiveSmartPathfindingEnabled.value) {
    return obstacleMap.mask;
  }
  if (!parsedObstacleTolerances.value.ok) {
    return undefined;
  }

  const obstacleMask = smartPathfindingBaseObstacleMask.value;
  return obstacleMask
    ? pathfindingCache.getCachedRouteMask(obstacleMask, parsedObstacleTolerances.value.simulationTolerancePlanePixels)
        .mask
    : undefined;
});
const activeBoundaryExpansion = computed(() =>
  (smartCursorEnabled.value || pathfindingObstacleEdgesActive.value) && parsedObstacleTolerances.value.ok
    ? parsedObstacleTolerances.value.boundaryExpansionPlanePixels
    : 0,
);
const targetBoundsRect = computed(() =>
  createBoundsRectWithBoundaryExpansion(boundsRect.value, activeBoundaryExpansion.value),
);
const trajectoryCollisionSettings = computed<TrajectoryCollisionSettings | undefined>(() => {
  if (!smartCursorEnabled.value && !pathfindingObstacleEdgesActive.value && toolWorkflowMode.value !== "simulator") {
    return undefined;
  }

  const obstacleMask = simulationObstacleMask.value;
  if (!obstacleMask) {
    return undefined;
  }

  return {
    boundaryExpansion: activeBoundaryExpansion.value,
    mask: obstacleMask,
  };
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

  const rect = targetBoundsRect.value;
  if (!rect) {
    return undefined;
  }

  const lastPoint = pathPixels.value.at(-1);
  if (!lastPoint) {
    return rect;
  }

  const minForwardPixelX = getMinimumForwardPixelX(lastPoint);
  if (minForwardPixelX === undefined || minForwardPixelX < rect.x || minForwardPixelX > rect.x + rect.width) {
    return undefined;
  }

  if (xPlusGoesRight(parsedBounds.value.bounds)) {
    return {
      x: minForwardPixelX,
      y: rect.y,
      width: rect.x + rect.width - minForwardPixelX,
      height: rect.height,
    };
  }

  return {
    x: rect.x,
    y: rect.y,
    width: minForwardPixelX - rect.x,
    height: rect.height,
  };
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
const detectionHeaderStatus = computed(() => detectionSettingsMessage.value || detectionStatus.value);
const detectionHeaderStatusKind = computed<DetectionStatusKind>(() =>
  detectionSettingsMessage.value ? "error" : detectionStatusKind.value,
);
// 识别面板只应消费展示 DTO；识别运行、状态优先级和耗时格式化仍由页面侧保持原语义。
const detectionPanel = computed<GraphwarDetectionPanelModel>(() => ({
  autoDetectionEnabled: autoDetectionEnabled.value,
  canStartDetection: Boolean(imageUrl.value),
  debugTimingRows: detectionDebugTimingRows.value.map((entry, index) => ({
    key: `${entry.stage}-${index}`,
    text: entry.elapsedVisible ? `${entry.label}: ${formatDebugElapsedDuration(entry.elapsedMs)}` : entry.label,
    title: entry.title,
  })),
  debugTimingVisible: debugInfoEnabled.value,
  headerStatus: {
    kind: detectionHeaderStatusKind.value,
    message: detectionHeaderStatus.value,
  },
  smartCursorEnabled: smartCursorEnabled.value,
  statusWarning: {
    message: detectionStatusWarning.value,
    title: detectionStatusWarningTitle.value,
  },
}));
const pathfindingWorkerCount = computed(() =>
  parsedPathfindingWorkerCount.value.ok
    ? parsedPathfindingWorkerCount.value.workerCount
    : graphwarToolDefaults.pathfindingWorkerCount,
);

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
const formulaResult = computed<FormulaResult | undefined>(() => {
  if (toolWorkflowMode.value !== "solver") {
    return undefined;
  }
  const context = graphwarTrajectoryFormulaContext.value;
  if (!parsedBounds.value.ok || !context || context.formulaPoints.length < 2) {
    return undefined;
  }
  if (algorithmMode.value === "step" && !parsedSteepness.value.ok) {
    return undefined;
  }
  if (!parsedPrecision.value.ok) {
    return undefined;
  }
  if (algorithmMode.value === "abs" && equationMode.value === "ddy") {
    return undefined;
  }
  if (isEquationModeDisabled(equationMode.value)) {
    return undefined;
  }

  const result = buildFormula(
    context.formulaPoints,
    formulaSteepness.value,
    equationMode.value,
    algorithmMode.value,
    parsedPrecision.value.decimalPlaces,
    context.formulaEvaluation,
  );
  // 页面展示和复制的公式文本必须与采样验证回放的文本一致。
  return { ...result, expression: context.playbackExpression };
});

watch(
  [mappedPathPoints],
  () => {
    syncPathPointCoordinateTexts();
  },
  { immediate: true },
);

const secondOrderLaunchAngleDegrees = computed(() => {
  const context = graphwarTrajectoryFormulaContext.value;
  if (
    equationMode.value !== "ddy" ||
    toolWorkflowMode.value !== "solver" ||
    isEquationModeDisabled(equationMode.value) ||
    (algorithmMode.value === "step" && !parsedSteepness.value.ok) ||
    !context ||
    context.formulaPoints.length < 2
  ) {
    return undefined;
  }

  const angle = (getGraphwarTrajectoryLaunchAngle(context, mappedPathPoints.value[0]) * 180) / Math.PI;
  return Number.isFinite(angle) ? angle : undefined;
});
const secondOrderLaunchAngleText = computed(() =>
  secondOrderLaunchAngleDegrees.value === undefined ? "" : formatAngleDegree(secondOrderLaunchAngleDegrees.value),
);
const secondOrderAngleHint = computed(() =>
  secondOrderLaunchAngleText.value ? locale.status.secondOrderAngleHint(secondOrderLaunchAngleText.value) : "",
);
const simulatorLaunchAngleRadians = computed(() => {
  if (equationMode.value !== "ddy") {
    return undefined;
  }
  const angle = parseFiniteNumber(simulatorLaunchAngleText.value);
  return angle === undefined ? undefined : (angle * Math.PI) / 180;
});

/** 公式生成模式下用最后一个路径点作为目标验证点，模拟器模式不强制目标。 */
function getTrajectoryValidationTargetPoint() {
  return toolWorkflowMode.value === "solver" && pathPixels.value.length >= 2 ? pathPixels.value.at(-1) : undefined;
}

/** 页面预览统一走共享采样 Module；这里仅决定当前工作流要采样公式还是用户输入表达式。 */
const trajectorySampleResult = computed(() => {
  if (toolWorkflowMode.value === "simulator") {
    if (!parsedBounds.value.ok || mappedPathPoints.value.length < 1 || !simulatorFormulaText.value.trim()) {
      return undefined;
    }

    return sampleGraphwarExpressionTrajectoryWithStops({
      bounds: parsedBounds.value.bounds,
      boundsRect: boundsRect.value,
      collision: trajectoryCollisionSettings.value,
      collectVisiblePixels: true,
      equation: equationMode.value,
      expression: simulatorFormulaText.value,
      launchAngleRadians: simulatorLaunchAngleRadians.value,
      parser: {
        parseDerivativeAsY: simulatorParseDerivativeAsY.value,
        skipUnknownCharacters: simulatorSkipUnknownCharacters.value,
      },
      soldierCenter: mappedPathPoints.value[0],
    });
  }

  const context = graphwarTrajectoryFormulaContext.value;
  if (
    !formulaResult.value ||
    !parsedBounds.value.ok ||
    (algorithmMode.value === "step" && !parsedSteepness.value.ok) ||
    !context ||
    context.formulaPoints.length < 2
  ) {
    return undefined;
  }

  return sampleGraphwarFormulaTrajectory({
    bounds: parsedBounds.value.bounds,
    boundsRect: boundsRect.value,
    collision: trajectoryCollisionSettings.value,
    collectVisiblePixels: true,
    context,
  });
});
const trajectorySample = computed(() => trajectorySampleResult.value?.sample);

const trajectoryValidationTargetPoint = computed(() => getTrajectoryValidationTargetPoint());
const trajectoryTargetHitIndex = computed(() => {
  const boundsResult = parsedBounds.value;
  const sample = trajectorySample.value;
  const targetPoint = trajectoryValidationTargetPoint.value;
  if (!sample || !boundsResult.ok || !targetPoint) {
    return -1;
  }

  return findGraphwarTrajectoryTargetHitIndex({
    bounds: boundsResult.bounds,
    boundsRect: boundsRect.value,
    points: sample.points,
    soldierMarkerRadius: soldierMarkerRadius.value,
    targetPoint,
  });
});
const trajectoryWarning = computed(() => {
  if (trajectoryObstacleHitIndex.value >= 0) {
    return locale.status.trajectoryWarning.obstacle;
  }
  if (trajectoryTargetHitIndex.value >= 0) {
    return "";
  }

  const stopReason = trajectorySample.value?.stopReason;
  if (!stopReason || stopReason === "completed" || stopReason === "unsupported") {
    return "";
  }
  if (stopReason === "too-steep") {
    return locale.status.trajectoryWarning.stopped["too-steep"];
  }
  if (stopReason === "max-steps") {
    return locale.status.trajectoryWarning.stopped["max-steps"];
  }
  if (stopReason === "out-of-bounds") {
    return locale.status.trajectoryWarning.stopped["out-of-bounds"];
  }
  if (stopReason === "stopped") {
    return "";
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
    createHeaderStatus(smartPathfindingSettingsMessage.value, "error"),
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
    friendlyFireEnabled: friendlyFireEnabled.value,
    headerStatus: {
      kind: headerStatus.kind,
      message: headerStatus.message,
      title: headerStatus.message,
    },
    oneClickClearDisabled: smartPathfindingInProgress.value || isOneClickClearModeUnsupported(),
    oneClickClearTitle: getOneClickClearButtonTitle(),
    searchAnimationEnabled: searchAnimationEnabled.value,
    smartPathfindingEnabled: smartPathfindingEnabled.value,
    smartPathfindingToggleDisabled: isSmartPathfindingDisabled(),
    smartPathfindingToggleTitle: getSmartPathfindingToggleTitle(),
  };
});

const trajectoryObstacleHitIndex = computed(() => {
  const obstacleHitIndex = trajectorySampleResult.value?.obstacleHitIndex ?? -1;
  const targetHitIndex = trajectoryTargetHitIndex.value;
  // 目标之后才撞障碍不影响“当前路径命中目标”的提示。
  return targetHitIndex >= 0 && obstacleHitIndex >= targetHitIndex ? -1 : obstacleHitIndex;
});

const plottedCurvePoints = computed(() => {
  const result = trajectorySampleResult.value;
  return result ? formatVisibleTrajectoryPoints(result.visiblePixels, trajectoryObstacleHitIndex.value) : "";
});

/** 将已映射到截图坐标的轨迹点格式化为 SVG polyline；hitIndex 指定目标或障碍截断位置。 */
function formatVisibleTrajectoryPoints(points: readonly PixelPoint[], hitIndex: number) {
  const sampledPoints = hitIndex >= 0 ? points.slice(0, hitIndex + 1) : points;
  return sampledPoints.map((point) => `${formatSvgNumber(point.x)},${formatSvgNumber(point.y)}`).join(" ");
}

/** 将像素点数组格式化为 SVG polyline points 字符串。 */
function formatSvgPathPoints(points: readonly PixelPoint[]) {
  return points.length >= 2
    ? points.map((point) => `${formatSvgNumber(point.x)},${formatSvgNumber(point.y)}`).join(" ")
    : "";
}

const stageStyle = computed(() => ({
  aspectRatio: `${imageWidth.value} / ${imageHeight.value}`,
}));
const soldierMarkerRadius = computed(() => {
  if (!parsedBounds.value.ok) {
    return GRAPHWAR_SOLDIER_RADIUS;
  }

  const graphWidth = Math.abs(parsedBounds.value.bounds.maxX - parsedBounds.value.bounds.minX);
  if (graphWidth <= 0) {
    return GRAPHWAR_SOLDIER_RADIUS;
  }

  return clampNumber((GRAPHWAR_GAME_SOLDIER_RADIUS / graphWidth) * boundsRect.value.width, 3, 32);
});
// 高级设置面板只应消费展示 DTO；输入校验、缓存失效和检测/寻路副作用仍由页面侧维护。
const advancedSettingsPanel = computed<GraphwarAdvancedSettingsPanelModel>(() => ({
  bounds: {
    maxXText: maxXText.value,
    maxYText: maxYText.value,
    minXText: minXText.value,
    minYText: minYText.value,
  },
  pathfinding: {
    obstacleSimulationToleranceText: obstacleSimulationToleranceText.value,
    oneClickClearDeleteCheckRadiusMinimumPixels,
    oneClickClearDeleteCheckRadiusText: oneClickClearDeleteCheckRadiusText.value,
    routePlanningToleranceText: routePlanningToleranceText.value,
    soldierMarkerRadius: soldierMarkerRadius.value,
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
const soldierSelectionRadius = computed(() => {
  const sourceRadius = GRAPHWAR_SOLDIER_VISIBLE_SIZE / 2;
  if (!parsedBounds.value.ok) {
    return sourceRadius;
  }

  const graphWidth = Math.abs(parsedBounds.value.bounds.maxX - parsedBounds.value.bounds.minX);
  if (graphWidth <= 0) {
    return sourceRadius;
  }

  return clampNumber(
    ((sourceRadius * GRAPHWAR_PLANE_GAME_LENGTH) / GRAPHWAR_PLANE_LENGTH / graphWidth) * boundsRect.value.width,
    3,
    48,
  );
});
const pathLineSegments = computed<GraphwarPathfindingLineSegment[]>(() => createPathLineSegments(pathPixels.value));
const liveClickPreviewPoint = computed(() => {
  const point = liveClickPreviewPointerPoint.value;
  if (!liveClickPreviewEnabled.value || toolMode.value !== "path" || smartPathfindingInProgress.value || !point) {
    return undefined;
  }
  if (draggingPathPointIndex.value !== undefined || liveClickPreviewPointerPathPointIndex.value !== undefined) {
    return undefined;
  }
  return createLiveClickPreviewPoint(point);
});
const liveClickPreviewLineSegments = computed(() => {
  const point = liveClickPreviewPoint.value;
  const start = toolWorkflowMode.value === "simulator" ? undefined : pathPixels.value.at(-1);
  if (!effectiveSmartPathfindingEnabled.value || !point || !start) {
    return [];
  }
  return createPathLineSegments([start, point]);
});
const liveClickPreviewTrajectorySampleResult = computed<GraphwarTrajectorySampleResult | undefined>(() => {
  const previewPoint = liveClickPreviewPoint.value;
  const boundsResult = parsedBounds.value;
  if (!previewPoint || !boundsResult.ok || effectiveSmartPathfindingEnabled.value) {
    return undefined;
  }

  if (toolWorkflowMode.value === "simulator") {
    if (!simulatorFormulaText.value.trim()) {
      return undefined;
    }

    return sampleGraphwarExpressionTrajectoryWithStops({
      bounds: boundsResult.bounds,
      boundsRect: boundsRect.value,
      collision: trajectoryCollisionSettings.value,
      collectVisiblePixels: true,
      equation: equationMode.value,
      expression: simulatorFormulaText.value,
      launchAngleRadians: simulatorLaunchAngleRadians.value,
      parser: {
        parseDerivativeAsY: simulatorParseDerivativeAsY.value,
        skipUnknownCharacters: simulatorSkipUnknownCharacters.value,
      },
      soldierCenter: imageToGraphPoint(previewPoint, boundsResult.bounds, boundsRect.value),
    });
  }

  if (
    pathPixels.value.length === 0 ||
    !parsedPrecision.value.ok ||
    (algorithmMode.value === "step" && !parsedSteepness.value.ok) ||
    (algorithmMode.value === "abs" && equationMode.value === "ddy") ||
    isEquationModeDisabled(equationMode.value)
  ) {
    return undefined;
  }

  const previewPathPoints = [
    ...mappedPathPoints.value,
    imageToGraphPoint(previewPoint, boundsResult.bounds, boundsRect.value),
  ];
  const context = createGraphwarTrajectoryFormulaContext({
    bounds: boundsResult.bounds,
    points: previewPathPoints,
    settings: graphwarTrajectoryFormulaSettings.value,
    soldierCenter: previewPathPoints[0],
  });
  if (context.formulaPoints.length < 2) {
    return undefined;
  }

  return sampleGraphwarFormulaTrajectory({
    bounds: boundsResult.bounds,
    boundsRect: boundsRect.value,
    collision: trajectoryCollisionSettings.value,
    collectVisiblePixels: true,
    context,
  });
});
const liveClickPreviewCurvePoints = computed(() => {
  const result = liveClickPreviewTrajectorySampleResult.value;
  return result ? formatVisibleTrajectoryPoints(result.visiblePixels, result.obstacleHitIndex) : "";
});
const liveClickPreviewLabel = computed(() => {
  if (toolWorkflowMode.value === "simulator" || pathPixels.value.length === 0) {
    return locale.ui.point.svgSelfLabel;
  }
  return String(pathPixels.value.length);
});

/** 按路径点圆半径截短线段，避免线条穿过点心。 */
function createPathLineSegments(points: readonly PixelPoint[]) {
  const radius = soldierSelectionRadius.value;
  const segments: GraphwarPathfindingLineSegment[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= radius * 2) {
      continue;
    }

    const offsetX = (deltaX / distance) * radius;
    const offsetY = (deltaY / distance) * radius;
    segments.push({
      x1: start.x + offsetX,
      y1: start.y + offsetY,
      x2: end.x - offsetX,
      y2: end.y - offsetY,
    });
  }
  return segments;
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
    oneClickClearHitFlashActive: oneClickClearHitFlashActive.value,
    oneClickClearHitFlashBoxes: oneClickClearHitFlashSoldiers.value,
    soldierFlashActive: detectionSoldierFlashActive.value,
    soldierFlashBoxes: detectedSoldiers.value,
  },
  liveClickPreview: {
    curvePoints: liveClickPreviewCurvePoints.value,
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
    selectionRadius: soldierSelectionRadius.value,
  },
  pathfinding: {
    blockedPoint: smartPathfindingBlockedPoint.value,
    inProgress: smartPathfindingInProgress.value,
    optimizationPreviewPoint: pathfindingOptimizationPreviewPoint.value,
    // 旧实现使用 soldierMarkerRadius + 4；这里显式保留，避免和 selectionRadius 混淆。
    optimizationPreviewRadius: soldierMarkerRadius.value + 4,
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
const copyButtonText = computed(() => {
  if (copyStatus.value === "success") {
    return locale.status.copy.buttonSuccess;
  }
  if (copyStatus.value === "error") {
    return locale.status.copy.buttonError;
  }
  return locale.status.copy.buttonDefault;
});
const canCopyFormula = computed(() =>
  toolWorkflowMode.value === "solver" ? !!formulaResult.value : !!simulatorFormulaText.value.trim(),
);
const canClearSimulatorInputs = computed(() => !!simulatorFormulaText.value || !!simulatorLaunchAngleText.value);
// 结果面板只应消费展示 DTO；公式生成、复制和坐标写回应由页面侧保持原工作流语义。
const resultPanel = computed(() => {
  const solverResult = formulaResult.value;
  return {
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
const statusAnnouncement = computed(() => {
  if (copyStatus.value === "success") {
    return locale.status.copy.success;
  }
  if (copyStatus.value === "error") {
    return locale.status.copy.error;
  }
  return "";
});
const screenshotImageStatusText = computed(
  () => imageStatus.value || imageName.value || locale.status.image.defaultStatus,
);
// 截图面板只应消费展示 DTO；DOM refs 和舞台交互语义仍由页面侧工作流持有。
const screenshotPanel = computed<GraphwarScreenshotPanelModel>(() => ({
  busyOverlayVisible: detectionInProgress.value,
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
  graphwarDetectionRunner.close();
  graphwarPathfindingRunner.close();
  cancelSmartPathfinding(false);
  if (copyStatusTimer) {
    clearTimeout(copyStatusTimer);
  }
  if (detectionRefreshTimer) {
    clearTimeout(detectionRefreshTimer);
  }
  clearLiveClickPreviewPointerPoint();
  disposeDebugActivation();
  disposeStageFeedback();
  disposeObstacleEditor();
  clearSmartPathfindingBlockedPoint();
});

/** 高频 pointermove 只保留最新落点，每个浏览器绘制帧最多触发一次轨迹预览重算。 */
function scheduleLiveClickPreviewPointerPoint(point: PixelPoint, pathPointIndex: number | undefined) {
  liveClickPreviewPendingPointerPoint = point;
  liveClickPreviewPendingPathPointIndex = pathPointIndex;
  if (liveClickPreviewPointerFrame !== undefined) {
    return;
  }

  liveClickPreviewPointerFrame = requestAnimationFrame(() => {
    const point = liveClickPreviewPendingPointerPoint;
    const pathPointIndex = liveClickPreviewPendingPathPointIndex;
    liveClickPreviewPointerFrame = undefined;
    liveClickPreviewPendingPointerPoint = undefined;
    liveClickPreviewPendingPathPointIndex = undefined;
    liveClickPreviewPointerPoint.value = point;
    liveClickPreviewPointerPathPointIndex.value = pathPointIndex;
  });
}

/** 清理悬停预览时取消待执行帧，避免离开舞台或切模式后旧落点回写。 */
function clearLiveClickPreviewPointerPoint() {
  liveClickPreviewPendingPointerPoint = undefined;
  liveClickPreviewPendingPathPointIndex = undefined;
  liveClickPreviewPointerPoint.value = undefined;
  liveClickPreviewPointerPathPointIndex.value = undefined;
  if (liveClickPreviewPointerFrame !== undefined) {
    cancelAnimationFrame(liveClickPreviewPointerFrame);
    liveClickPreviewPointerFrame = undefined;
  }
}

/** 路径点或点半径变化时刷新命中缓存，保持悬停预览和当前路径状态一致。 */
function refreshLiveClickPreviewPointerPathPointIndex() {
  liveClickPreviewPendingPathPointIndex =
    liveClickPreviewPendingPointerPoint === undefined
      ? undefined
      : getPathPointIndexAtPoint(liveClickPreviewPendingPointerPoint);
  liveClickPreviewPointerPathPointIndex.value =
    liveClickPreviewPointerPoint.value === undefined
      ? undefined
      : getPathPointIndexAtPoint(liveClickPreviewPointerPoint.value);
}

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

watch([obstacleSimulationToleranceText, steepnessText], () => {
  clearSmartPathfindingStatus();
});

watch([smartCursorEnabled, smartPathfindingEnabled, detectedObstacles], () => {
  if (toolMode.value === "obstacle" && !obstacleBrushAvailable.value) {
    setToolMode("path");
  }
});

watch(
  [
    pathfindingWorkerCountText,
    routePlanningToleranceText,
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

/** 新截图应用后清理依赖旧图片的业务状态；边界坐标保持不变。 */
function handleAppliedScreenshot() {
  clearAllModePaths();
  clearDetections();
  boundsFirstPoint.value = undefined;
  pointerPreviewPoint.value = undefined;
  magnifierPoint.value = undefined;
}

/** 截图尺寸落地后重置临时框选点，并按新像素重新识别棋盘对象。 */
function handleLoadedScreenshot() {
  boundsFirstPoint.value = undefined;
  pointerPreviewPoint.value = undefined;
  if (autoDetectionEnabled.value) {
    void detectGraphwarObjects();
  }
}

/** 清除自动识别的士兵标记。 */
function clearDetections() {
  detectionRunId += 1;
  detectionInProgress.value = false;
  setDetectionStatus("", "info");
  clearDetectedGraphwarObjects();
}

/** 清除识别对象和依赖缓存，并保留检测状态文字。 */
function clearDetectedGraphwarObjects() {
  invalidatePathfindingCaches();
  detectedSoldiers.value = [];
  clearDetectionSoldierFlash();
  clearOneClickClearHitFlash();
  clearObstacleEditor();
  hoveredDetectedSoldierId.value = undefined;
  clearSmartPathfindingStatus();
}

/** 开始一次新的检测运行，并让旧异步响应自动失效。 */
function beginDetectionRun() {
  detectionRunId += 1;
  detectionInProgress.value = true;
  return detectionRunId;
}

/** 判断异步检测回调是否仍属于当前运行。 */
function isActiveDetectionRun(runId: number) {
  return runId === detectionRunId;
}

/** 只结束当前检测运行，避免旧任务覆盖新任务状态。 */
function finishDetectionRun(runId: number) {
  if (isActiveDetectionRun(runId)) {
    detectionInProgress.value = false;
  }
}

/** 取消当前检测任务，并按调用场景决定是否显示取消提示。 */
function cancelDetection(showStatus: boolean) {
  if (!detectionInProgress.value) {
    return false;
  }

  detectionRunId += 1;
  graphwarDetectionRunner.cancel();
  detectionInProgress.value = false;
  if (showStatus) {
    setDetectionStatus(locale.status.detection.cancelled, "warning");
  }
  return true;
}

/** 展开或折叠高级设置面板。 */
function toggleAdvancedSettings() {
  advancedSettingsVisible.value = !advancedSettingsVisible.value;
}

/** 设置检测状态主文案，并清掉上一轮警告详情。 */
function setDetectionStatus(message: string, kind: DetectionStatusKind) {
  detectionStatus.value = message;
  detectionStatusKind.value = kind;
  detectionStatusWarning.value = "";
  detectionStatusWarningTitle.value = "";
}

/** 将 Worker fallback 等非致命警告附加到检测状态上。 */
function setDetectionStatusWarnings(warnings: NonNullable<GraphwarObjectsDetectionResult["warnings"]> | undefined) {
  if (!warnings?.length) {
    return;
  }

  detectionStatusWarning.value = locale.status.detection.partialWarning;
  detectionStatusWarningTitle.value = warnings
    .map((warning) => locale.status.detection.warningTitle(warning))
    .join("\n");
}

/** 等待检测状态渲染到页面，让长耗时阶段前用户能看到进度。 */
function waitForDetectionStatusPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/** 展示检测阶段状态，并在绘制后确认任务仍然有效。 */
async function showDetectionStage(runId: number, message: string) {
  if (!isActiveDetectionRun(runId)) {
    return false;
  }
  setDetectionStatus(`${message}${locale.status.detection.stopSuffix}`, "warning");
  await nextTick();
  await waitForDetectionStatusPaint();
  return isActiveDetectionRun(runId);
}

/** 延迟重新识别，合并连续设置变化，避免每次输入都立即读像素。 */
function scheduleGraphwarObjectDetection() {
  if (!imageUrl.value || !autoDetectionEnabled.value) {
    return;
  }
  if (detectionRefreshTimer) {
    clearTimeout(detectionRefreshTimer);
  }
  detectionRefreshTimer = setTimeout(() => {
    detectionRefreshTimer = undefined;
    void detectGraphwarObjectsInCurrentBounds();
  }, 180);
}

/** 收敛截图读取、像素读取和阈值校验；后续检测入口只处理识别策略。 */
function getGraphwarDetectionInput(timings: DetectionDebugTimingEntry[]) {
  if (!imageRef.value || !imageUrl.value) {
    setDetectionStatus(locale.status.detection.uploadFirst, "error");
    return undefined;
  }

  const imageData = measureDetectionDebugStage(timings, "preparing-pixels", () => getImageDataFromCurrentImage());
  if (!imageData) {
    setDetectionStatus(locale.status.detection.noPixels, "error");
    return undefined;
  }
  const detectionSettings = parsedDetectionSettings.value;
  if (!detectionSettings.ok) {
    setDetectionStatus(detectionSettings.message, "error");
    return undefined;
  }
  return {
    imageData,
    soldierSettings: {
      candidateTopRatio: detectionSettings.candidateTopRatio,
      maximumSoldierCount: detectionSettings.maximumSoldierCount,
      templateMatchingWorkerCount: detectionSettings.templateMatchingWorkerCount,
    },
    thresholds: {
      minArea: detectionSettings.minArea,
    },
  };
}

/** 使用 Canvas 像素自动检测 Graphwar 棋盘边界，再按该边界识别士兵和障碍。 */
async function detectGraphwarObjects() {
  const runId = beginDetectionRun();
  const startedAt = nowMs();
  const timings: DetectionDebugTimingEntry[] = [];
  let debugTimingsFinalized = false;
  try {
    if (!(await showDetectionStage(runId, locale.status.detection.preparingPixels))) {
      return;
    }
    const detectionInput = getGraphwarDetectionInput(timings);
    if (!detectionInput || !isActiveDetectionRun(runId)) {
      return;
    }

    const result = await graphwarDetectionRunner.detectAuto(
      {
        imageData: detectionInput.imageData,
        soldierSettings: detectionInput.soldierSettings,
        thresholds: detectionInput.thresholds,
      },
      {
        onStage: (stage) => {
          void showDetectionWorkerStage(runId, stage);
        },
        onTimings: (workerTimings) => {
          timings.push(...createDetectionDebugTimingEntriesFromWorker(workerTimings));
        },
      },
    );
    if (!isActiveDetectionRun(runId)) {
      return;
    }
    if (!result.edgeRect || !result.objects) {
      clearDetectedGraphwarObjects();
      setDetectionStatus(locale.status.detection.noBounds, "error");
      return;
    }

    boundsRect.value = result.edgeRect;
    invalidatePathfindingCaches();
    boundsFirstPoint.value = undefined;
    pointerPreviewPoint.value = undefined;
    await applyGraphwarObjectDetectionResult(result.objects, "auto", runId, true, startedAt, timings);
    debugTimingsFinalized = true;
    if (!isActiveDetectionRun(runId)) {
      return;
    }
    toolMode.value = "path";
  } catch (error) {
    handleGraphwarDetectionError(error, runId);
  } finally {
    if (!debugTimingsFinalized) {
      finishDetectionDebugTimings(runId, startedAt, timings);
    }
    finishDetectionRun(runId);
  }
}

/** 在当前手动/自动边界内重新识别对象，不重新推断棋盘区域。 */
async function detectGraphwarObjectsInCurrentBounds() {
  const runId = beginDetectionRun();
  const startedAt = nowMs();
  const timings: DetectionDebugTimingEntry[] = [];
  let debugTimingsFinalized = false;
  try {
    if (!(await showDetectionStage(runId, locale.status.detection.preparingPixels))) {
      return;
    }
    const detectionInput = getGraphwarDetectionInput(timings);
    if (!detectionInput || !isActiveDetectionRun(runId)) {
      return;
    }

    const result = await graphwarDetectionRunner.detectObjectsInBounds(
      {
        edgeRect: boundsRect.value,
        imageData: detectionInput.imageData,
        soldierSettings: detectionInput.soldierSettings,
        thresholds: detectionInput.thresholds,
      },
      {
        onStage: (stage) => {
          void showDetectionWorkerStage(runId, stage);
        },
        onTimings: (workerTimings) => {
          timings.push(...createDetectionDebugTimingEntriesFromWorker(workerTimings));
        },
      },
    );
    await applyGraphwarObjectDetectionResult(result, "current", runId, false, startedAt, timings);
    debugTimingsFinalized = true;
  } catch (error) {
    handleGraphwarDetectionError(error, runId);
  } finally {
    if (!debugTimingsFinalized) {
      finishDetectionDebugTimings(runId, startedAt, timings);
    }
    finishDetectionRun(runId);
  }
}

/** 将 Worker 返回的士兵/障碍识别结果写回页面状态。 */
async function applyGraphwarObjectDetectionResult(
  result: GraphwarObjectsDetectionResult,
  source: "auto" | "current",
  runId: number,
  flashBounds = false,
  startedAt = nowMs(),
  timings: DetectionDebugTimingEntry[] = [],
) {
  clearSmartPathfindingStatus();
  if (!isActiveDetectionRun(runId)) {
    return;
  }
  if (!(await showDetectionStage(runId, locale.status.detection.updatingResults))) {
    return;
  }
  measureDetectionDebugStage(timings, "updating-results", () => {
    invalidatePathfindingCaches();
    detectedSoldiers.value = result.soldiers;
    flashDetectedSoldiers();
    if (flashBounds) {
      flashBoundsRect();
    }
    applyDetectedObstacles(result.obstacles);
  });
  let completedAt = nowMs();
  const elapsed = () => formatElapsedDuration(completedAt - startedAt);
  measureDetectionDebugStage(timings, "setting-status", () => {
    completedAt = nowMs();
    setDetectionStatus(
      source === "auto"
        ? locale.status.detection.detectedWithAutoBounds(detectedSoldiers.value.length, elapsed())
        : locale.status.detection.detectedCurrentBounds(detectedSoldiers.value.length, elapsed()),
      "success",
    );
    setDetectionStatusWarnings(result.warnings);
    completedAt = nowMs();
  });
  finishDetectionDebugTimings(runId, startedAt, timings, completedAt);
}

/** 将 Worker 阶段枚举映射成用户可读的检测进度。 */
async function showDetectionWorkerStage(runId: number, stage: GraphwarDetectionWorkerStage) {
  const message =
    stage === "detecting-bounds" ? locale.status.detection.detectingBounds : locale.status.detection.detectingObjects;
  await showDetectionStage(runId, message);
}

/** 只展示当前检测运行的真实错误，忽略取消造成的预期异常。 */
function handleGraphwarDetectionError(error: unknown, runId: number) {
  if (!isActiveDetectionRun(runId) || isGraphwarDetectionCancelledError(error)) {
    return;
  }

  setDetectionStatus(locale.status.detection.failed(error instanceof Error ? error.message : String(error)), "error");
}

/** 切换自动识别；关闭后保留当前识别结果供用户继续编辑。 */
function toggleAutoDetection() {
  autoDetectionEnabled.value = !autoDetectionEnabled.value;
}

/** 切换智能光标；关闭时清掉士兵悬停，避免残留高亮。 */
function toggleSmartCursor() {
  smartCursorEnabled.value = !smartCursorEnabled.value;
  if (!smartCursorEnabled.value) {
    hoveredDetectedSoldierId.value = undefined;
  }
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
  return algorithmMode.value === "step";
}

/** 返回智能寻路被禁用的具体原因。 */
function getSmartPathfindingDisabledMessage() {
  return stepPathfindingDisabledMessage.value;
}

/** 返回智能寻路按钮 title，禁用时优先解释原因。 */
function getSmartPathfindingToggleTitle() {
  return isSmartPathfindingDisabled()
    ? getSmartPathfindingDisabledMessage()
    : locale.ui.pathfinding.smartPathfindingTitle;
}

/** 一键清图目前只支持双绝对值 y/y'，按钮状态和运行前校验共用同一条件。 */
function isOneClickClearModeUnsupported() {
  return isSmartPathfindingDisabled() || algorithmMode.value !== "abs" || equationMode.value === "ddy";
}

/** 返回一键清图按钮 title，不支持当前模式时直接解释禁用原因。 */
function getOneClickClearButtonTitle() {
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
      boundsFirstPoint.value = nextPoint;
      pointerPreviewPoint.value = nextPoint;
      return;
    }

    const nextRect = normalizeBoundsRect(boundsFirstPoint.value, nextPoint);
    if (nextRect.width >= 4 && nextRect.height >= 4) {
      boundsRect.value = nextRect;
      invalidatePathfindingCaches();
      toolMode.value = "path";
      void detectGraphwarObjectsInCurrentBounds();
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
    liveClickPreviewPointerPoint.value = point;
    liveClickPreviewPointerPathPointIndex.value = getPathPointIndexAtPoint(point);
    updateSmartPathfindingInProgressStatus();
    return;
  }

  const pathPointIndex = getPathPointIndexAtPoint(point);
  liveClickPreviewPointerPoint.value = point;
  liveClickPreviewPointerPathPointIndex.value = pathPointIndex;
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

/** 统一处理手动点、智能寻路点和一键清图重建，保证路径状态只有这一处落地。 */
async function appendPathPoint(point: PixelPoint) {
  if (!parsedBounds.value.ok) {
    return false;
  }

  if (toolWorkflowMode.value === "simulator") {
    setPathPixels([normalizePathPoint(point, boundsRect.value, parsedBounds.value.bounds, undefined, 0)]);
    return true;
  }

  const targetPoint = pathPixels.value.length > 0 ? createMinimumForwardTargetPoint(point) : point;
  if (!targetPoint) {
    pathStatus.value = getForwardPathMessage();
    return false;
  }

  const nextPoint =
    pathPixels.value.length > 0
      ? targetPoint
      : normalizePathPoint(targetPoint, boundsRect.value, parsedBounds.value.bounds, undefined, 0);
  if (!nextPoint) {
    return false;
  }

  if (pathPixels.value.length === 0) {
    setPathPixels([nextPoint]);
    clearSmartPathfindingStatus();
    return true;
  }

  if (effectiveSmartPathfindingEnabled.value) {
    clearSmartPathfindingDebugTimings();
    const startedAt = nowMs();
    const timings: SmartPathfindingDebugTimingEntry[] = [];
    const preflightPassed = measureSmartPathfindingDebugStage(timings, "preflight", () =>
      ensureCurrentPathReachesLastPointBeforeSmartPathfinding(),
    );
    if (!preflightPassed) {
      finishSmartPathfindingDebugTimings(startedAt, timings);
      return false;
    }

    const pathfindingToken = startSmartPathfinding();
    let pathfindingResult: SmartPathfindingPathBuildResult | undefined;
    try {
      pathfindingResult = await buildSmartPathfindingPath(nextPoint, pathfindingToken, timings);
      if (!isSmartPathfindingRunCurrent(pathfindingToken)) {
        return false;
      }
    } finally {
      if (isSmartPathfindingRunCurrent(pathfindingToken)) {
        finishSmartPathfindingRun(pathfindingToken);
      }
    }

    if (!pathfindingResult) {
      let completedAt = nowMs();
      measureSmartPathfindingDebugStage(timings, "setting-status", () => {
        completedAt = nowMs();
        setSmartPathfindingStatus(getSmartPathfindingFailureMessage(completedAt - startedAt), "error");
        completedAt = nowMs();
      });
      finishSmartPathfindingDebugTimings(startedAt, timings, completedAt);
      return false;
    }

    const finalPath = pathfindingResult.path;
    measureSmartPathfindingDebugStage(timings, "apply-result", () => setPathPixels(finalPath));
    let completedAt = nowMs();
    measureSmartPathfindingDebugStage(timings, "setting-status", () => {
      completedAt = nowMs();
      setSmartPathfindingStatus(
        getSmartPathfindingSuccessMessage(completedAt - startedAt, pathfindingResult.cacheHit),
        "success",
      );
      completedAt = nowMs();
    });
    finishSmartPathfindingDebugTimings(startedAt, timings, completedAt);
    return true;
  }

  if (!canAppendPathPoint(nextPoint)) {
    return false;
  }

  setPathPixels([...pathPixels.value, nextPoint]);
  return true;
}

/** 点士兵时优先命中士兵中心；已有路径时根据当前模式决定直连或绕障。 */
async function appendDetectedSoldierPathPoint(soldier: DetectionBox) {
  if (toolWorkflowMode.value === "simulator" || pathPixels.value.length === 0) {
    trajectoryStrokeColor.value = getDetectedSoldierColor(soldier) ?? "#ec4899";
    return appendPathPoint(getDetectionBoxCenter(soldier));
  }

  if (effectiveSmartPathfindingEnabled.value) {
    return appendDetectedSoldierSmartPathfindingPoint(soldier);
  }

  const targetPoint = createSearchStartSoldierAimPoint(pathPixels.value.at(-1), soldier);
  return targetPoint ? appendPathPoint(targetPoint) : false;
}

/** 针对士兵目标绕障；几何目标可被 x+ 推进，弹道仍校验士兵原命中圈。 */
async function appendDetectedSoldierSmartPathfindingPoint(soldier: DetectionBox) {
  if (!parsedBounds.value.ok) {
    return false;
  }

  clearSmartPathfindingDebugTimings();
  const startedAt = nowMs();
  const timings: SmartPathfindingDebugTimingEntry[] = [];
  const sourcePath = [...pathPixels.value];
  const startPoint = sourcePath.at(-1);
  if (!startPoint) {
    return false;
  }

  const preflightPassed = measureSmartPathfindingDebugStage(timings, "preflight", () =>
    ensureCurrentPathReachesLastPointBeforeSmartPathfinding(),
  );
  if (!preflightPassed) {
    finishSmartPathfindingDebugTimings(startedAt, timings);
    return false;
  }

  const target = measureSmartPathfindingDebugStage(timings, "collect-targets", () =>
    createSmartPathfindingSoldierTarget(startPoint, soldier),
  );
  if (!target) {
    let completedAt = nowMs();
    measureSmartPathfindingDebugStage(timings, "setting-status", () => {
      completedAt = nowMs();
      setSmartPathfindingStatus(getSmartPathfindingFailureMessage(completedAt - startedAt), "error");
      completedAt = nowMs();
    });
    finishSmartPathfindingDebugTimings(startedAt, timings, completedAt);
    return false;
  }

  const pathfindingToken = startSmartPathfinding();
  let pathfindingResult: SmartPathfindingPathBuildResult | undefined;
  try {
    pathfindingResult = await buildSmartPathfindingPath(target, pathfindingToken, timings);
    if (!isSmartPathfindingRunCurrent(pathfindingToken)) {
      return false;
    }
  } finally {
    if (isSmartPathfindingRunCurrent(pathfindingToken)) {
      finishSmartPathfindingRun(pathfindingToken);
    }
  }

  if (!pathfindingResult) {
    let completedAt = nowMs();
    measureSmartPathfindingDebugStage(timings, "setting-status", () => {
      completedAt = nowMs();
      setSmartPathfindingStatus(getSmartPathfindingFailureMessage(completedAt - startedAt), "error");
      completedAt = nowMs();
    });
    finishSmartPathfindingDebugTimings(startedAt, timings, completedAt);
    return false;
  }

  const finalPath = pathfindingResult.path;
  measureSmartPathfindingDebugStage(timings, "apply-result", () => setPathPixels(finalPath));
  let completedAt = nowMs();
  measureSmartPathfindingDebugStage(timings, "setting-status", () => {
    completedAt = nowMs();
    setSmartPathfindingStatus(
      getSmartPathfindingSuccessMessage(completedAt - startedAt, pathfindingResult.cacheHit),
      "success",
    );
    completedAt = nowMs();
  });
  finishSmartPathfindingDebugTimings(startedAt, timings, completedAt);
  return true;
}

/** 计算实时点击预览的落位点；只模拟左键点击会选择的目标，不触发寻路或状态写入。 */
function createLiveClickPreviewPoint(point: PixelPoint) {
  if (!parsedBounds.value.ok) {
    return undefined;
  }

  const selectedSoldier = smartCursorEnabled.value ? getDetectedSoldierAtPoint(point) : undefined;
  if (!selectedSoldier) {
    return createLiveManualClickPreviewPoint(point);
  }
  if (toolWorkflowMode.value === "simulator" || pathPixels.value.length === 0) {
    return createLiveManualClickPreviewPoint(getDetectionBoxCenter(selectedSoldier));
  }

  const startPoint = pathPixels.value.at(-1);
  if (!startPoint) {
    return undefined;
  }
  const targetPoint = effectiveSmartPathfindingEnabled.value
    ? createSmartPathfindingSoldierTarget(startPoint, selectedSoldier)?.targetPoint
    : createSearchStartSoldierAimPoint(startPoint, selectedSoldier);
  return targetPoint ? createLiveManualClickPreviewPoint(targetPoint) : undefined;
}

/** 复刻 appendPathPoint 的同步落位规则，避免实时预览改动真实路径和提示状态。 */
function createLiveManualClickPreviewPoint(point: PixelPoint) {
  if (!parsedBounds.value.ok) {
    return undefined;
  }
  if (toolWorkflowMode.value === "simulator") {
    return normalizePathPoint(point, boundsRect.value, parsedBounds.value.bounds, undefined, 0);
  }

  const targetPoint = pathPixels.value.length > 0 ? createMinimumForwardTargetPoint(point) : point;
  if (!targetPoint) {
    return undefined;
  }
  return pathPixels.value.length > 0
    ? targetPoint
    : normalizePathPoint(targetPoint, boundsRect.value, parsedBounds.value.bounds, undefined, 0);
}

/** 一键清图：从当前路径尾部出发，完整遍历 x 单调可达状态并追加当前模型下击杀最多的路径。 */
async function runOneClickClear() {
  clearSmartPathfindingDebugTimings();
  const startedAt = nowMs();
  const timings: SmartPathfindingDebugTimingEntry[] = [];
  const preflightResult = measureSmartPathfindingDebugStage(timings, "one-click-clear-preflight", () => {
    const boundsResult = parsedBounds.value;
    const tolerances = parsedObstacleTolerances.value;
    if (!boundsResult.ok || !tolerances.ok || !parsedPathfindingWorkerCount.value.ok) {
      return {
        kind: "error" as const,
        message: smartPathfindingSettingsMessage.value || getSmartPathfindingDisabledMessage(),
        ok: false as const,
      };
    }
    if (isOneClickClearModeUnsupported()) {
      return {
        kind: "warning" as const,
        message: locale.smartPathfinding.oneClickClear.unsupported,
        ok: false as const,
      };
    }
    if (pathPixels.value.length === 0) {
      return {
        kind: "warning" as const,
        message: locale.smartPathfinding.oneClickClear.needCurrentPath,
        ok: false as const,
      };
    }

    const obstacleMask = smartPathfindingBaseObstacleMask.value;
    if (!obstacleMask) {
      return {
        kind: "error" as const,
        message: getSmartPathfindingFailureMessage(),
        ok: false as const,
      };
    }

    return {
      bounds: boundsResult.bounds,
      obstacleMask,
      ok: true as const,
      prefixTarget: createOneClickClearPrefixTarget(),
      tolerances,
    };
  });
  if (!preflightResult.ok) {
    let completedAt = nowMs();
    measureSmartPathfindingDebugStage(timings, "one-click-clear-setting-status", () => {
      completedAt = nowMs();
      setSmartPathfindingStatus(preflightResult.message, preflightResult.kind);
      completedAt = nowMs();
    });
    finishSmartPathfindingDebugTimings(startedAt, timings, completedAt);
    return false;
  }

  const pathfindingToken = startSmartPathfinding(locale.smartPathfinding.oneClickClear.inProgress);
  let debugTimingsFinished = false;
  const finishOneClickClearDebugTimings = (completedAt = nowMs()) => {
    debugTimingsFinished = true;
    if (!isSmartPathfindingRunCurrent(pathfindingToken)) {
      return;
    }
    finishSmartPathfindingDebugTimings(startedAt, timings, completedAt);
  };

  try {
    const candidates = measureSmartPathfindingDebugStage(timings, "one-click-clear-collect-targets", () =>
      createOneClickClearCandidates(),
    );
    const hitCandidates = createOneClickClearHitCandidates();
    const oneClickClearRouteMaskTimings: SmartPathfindingDebugTimingEntry[] = [];
    const oneClickClearSearchDetailTimings: SmartPathfindingDebugTimingEntry[] = [];
    const routeTolerance = preflightResult.tolerances.routePlanningTolerancePlanePixels;
    const searchInput: GraphwarOneClickClearPathWorkerInput = {
      boundaryExpansion: preflightResult.tolerances.boundaryExpansionPlanePixels,
      bounds: preflightResult.bounds,
      boundsRect: boundsRect.value,
      candidates,
      dagEdgeWorkerCount: pathfindingWorkerCount.value,
      deleteCheckRadiusPixels: preflightResult.tolerances.oneClickClearDeleteCheckRadiusPixels,
      hitCandidates,
      pathPoints: [...pathPixels.value],
      prefixTarget: preflightResult.prefixTarget,
      routeMaskCacheId: pathfindingCache.getRouteObstacleMaskCacheId(preflightResult.obstacleMask),
      routeObstacleMask: preflightResult.obstacleMask,
      routeTolerancePlanePixels: routeTolerance,
      settings: createPathTrajectoryFormulaSettings(),
      simulationBoundaryExpansion: preflightResult.tolerances.boundaryExpansionPlanePixels,
      simulationMask: simulationObstacleMask.value,
    };
    const searchCacheKey = pathfindingCache.createOneClickClearResultCacheKey(searchInput);
    let search = pathfindingCache.getCachedOneClickClearResult(searchCacheKey, (timing) => timings.push(timing));
    const searchCacheHit = search !== undefined;
    if (!search) {
      search = await measureSmartPathfindingDebugStageAsync(timings, "one-click-clear-search", () =>
        graphwarPathfindingRunner.buildOneClickClearPath(searchInput),
      );
      pathfindingCache.cacheOneClickClearResult(searchCacheKey, search);
    }
    for (const timing of search.timings) {
      if (addOneClickClearRouteMaskDebugTiming(oneClickClearRouteMaskTimings, timing)) {
        continue;
      }
      addOneClickClearSearchDebugTiming(oneClickClearSearchDetailTimings, timing);
    }
    subtractLastDebugStageElapsed(
      timings,
      "one-click-clear-search",
      sumDebugTimingElapsed(oneClickClearRouteMaskTimings),
    );
    insertDebugTimingsBeforeLastStage(timings, "one-click-clear-search", oneClickClearRouteMaskTimings);
    timings.push(...oneClickClearSearchDetailTimings);
    if (!isSmartPathfindingRunCurrent(pathfindingToken)) {
      return false;
    }

    const result = search.result;
    finishSmartPathfindingRun(pathfindingToken);
    if (result.type === "success") {
      measureSmartPathfindingDebugStage(timings, "one-click-clear-apply-result", () =>
        setPathPixels(result.pathPoints),
      );
      flashOneClickClearHitSoldiers(result.targetIds);
      let completedAt = nowMs();
      measureSmartPathfindingDebugStage(timings, "one-click-clear-setting-status", () => {
        completedAt = nowMs();
        setSmartPathfindingStatus(
          locale.smartPathfinding.oneClickClear.success(
            result.targetIds.length,
            formatElapsedDuration(searchCacheHit ? completedAt - startedAt : result.elapsedMs),
            searchCacheHit,
          ),
          "success",
        );
        completedAt = nowMs();
      });
      finishOneClickClearDebugTimings(completedAt);
      return true;
    }

    let completedAt = nowMs();
    measureSmartPathfindingDebugStage(timings, "one-click-clear-setting-status", () => {
      completedAt = nowMs();
      setSmartPathfindingStatus(
        getOneClickClearFailureMessage(result.reason, searchCacheHit ? completedAt - startedAt : result.elapsedMs),
        "error",
      );
      completedAt = nowMs();
    });
    finishOneClickClearDebugTimings(completedAt);
    return false;
  } catch (error) {
    if (!isSmartPathfindingRunCurrent(pathfindingToken) || isGraphwarPathfindingCancelledError(error)) {
      return false;
    }
    let completedAt = nowMs();
    measureSmartPathfindingDebugStage(timings, "one-click-clear-setting-status", () => {
      completedAt = nowMs();
      setSmartPathfindingStatus(
        getOneClickClearFailureMessage("pathfinding-worker-failed", completedAt - startedAt),
        "error",
      );
      completedAt = nowMs();
    });
    finishOneClickClearDebugTimings(completedAt);
    return false;
  } finally {
    if (isSmartPathfindingRunCurrent(pathfindingToken)) {
      finishSmartPathfindingRun(pathfindingToken);
      if (!debugTimingsFinished) {
        finishOneClickClearDebugTimings();
      }
    }
  }
}

/** 一键清图前缀预检复用当前路径最后点；若最后点在士兵命中圈内则使用真实命中半径。 */
function createOneClickClearPrefixTarget() {
  const target = createCurrentLastPathHitTarget();
  if (!target) {
    return undefined;
  }
  return "center" in target ? { center: target.center, radius: target.radius } : { center: target, radius: 1 };
}

/**
 * 把当前识别士兵折叠成清图搜索候选；友伤关闭时友方不作为候选。
 *
 * 候选入口按命中圆中心做 x+ 过滤；建路目标点和弹道命中圆在一键清图内部保持独立语义。
 */
function createOneClickClearCandidates(): GraphwarOneClickClearCandidate[] {
  const startPoint = pathPixels.value.at(-1);
  if (!startPoint) {
    return [];
  }

  return detectedSoldiers.value.flatMap((soldier) => {
    if (detectionBoxMatchesFirstPathPoint(soldier)) {
      return [];
    }
    const friendly = isDetectedFriendlySoldierObstacle(soldier);
    if (friendly && !friendlyFireEnabled.value) {
      return [];
    }

    const center = getDetectionBoxCenter(soldier);
    if (!oneClickClearSoldierReachesForward(soldier, startPoint)) {
      return [];
    }

    return [
      {
        enemy: !friendly,
        hitCenter: center,
        hitRadius: soldier.hitRadius,
        id: soldier.id,
      },
    ];
  });
}

/** 统计整条弹道命中数：只排除发射士兵，不能按当前路径尾点右侧过滤。 */
function createOneClickClearHitCandidates(): GraphwarOneClickClearCandidate[] {
  return detectedSoldiers.value.flatMap((soldier) => {
    if (detectionBoxMatchesFirstPathPoint(soldier)) {
      return [];
    }
    const friendly = isDetectedFriendlySoldierObstacle(soldier);
    if (friendly && !friendlyFireEnabled.value) {
      return [];
    }

    return [
      {
        enemy: !friendly,
        hitCenter: getDetectionBoxCenter(soldier),
        hitRadius: soldier.hitRadius,
        id: soldier.id,
      },
    ];
  });
}

/** 检查士兵中心是否位于起点 x+ 侧；命中圆边缘不参与候选过滤。 */
function oneClickClearSoldierReachesForward(soldier: DetectionBox, startPoint: PixelPoint) {
  return pointGraphXAdvances(startPoint, getDetectionBoxCenter(soldier));
}

/** 一键清图失败原因用独立文案，避免和单目标智能寻路失败混在一起。 */
function getOneClickClearFailureMessage(reason: GraphwarOneClickClearFailureReason, elapsedMs: number) {
  const elapsed = formatElapsedDuration(elapsedMs);
  if (reason === "no-candidate") {
    return locale.smartPathfinding.oneClickClear.noCandidate;
  }
  if (reason === "preflight-blocked") {
    return getSmartPathfindingCurrentPathBlockedMessage();
  }
  if (reason === "unsupported") {
    return locale.smartPathfinding.oneClickClear.unsupported;
  }
  if (reason === "pathfinding-worker-failed") {
    return locale.smartPathfinding.oneClickClear.pathfindingWorkerFailed(elapsed);
  }
  return locale.smartPathfinding.oneClickClear.noUsableTarget(elapsed);
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

/** 在当前障碍 mask 上为目标构造几何路径，并用真实弹道验证后返回可用路径。 */
async function buildSmartPathfindingPath(
  target: PixelPoint | SmartPathfindingTarget,
  cancelToken: number,
  timings?: SmartPathfindingDebugTimingEntry[],
) {
  const boundsResult = parsedBounds.value;
  if (!boundsResult.ok) {
    return undefined;
  }
  if (!parsedPathfindingWorkerCount.value.ok) {
    return undefined;
  }

  const targetPoint = "targetPoint" in target ? target.targetPoint : target;
  const hitTarget = "targetPoint" in target ? target.hitCircle : target;
  const obstacleMask = smartPathfindingBaseObstacleMask.value;
  const tolerances = parsedObstacleTolerances.value;
  const sourcePath = [...pathPixels.value];
  const startPoint = sourcePath.at(-1);
  if (!obstacleMask || !tolerances.ok || !startPoint) {
    return undefined;
  }

  if (searchAnimationEnabled.value) {
    setSmartPathfindingPreviewConnection(startPoint, targetPoint);
  }

  setSmartPathfindingPhase("search");
  await waitForNextPathfindingSlice();
  if (!isSmartPathfindingRunCurrent(cancelToken)) {
    return undefined;
  }

  const routeTolerance = tolerances.routePlanningTolerancePlanePixels;
  const input: GraphwarSmartPathfindingPathInput = {
    boundaryExpansion: tolerances.boundaryExpansionPlanePixels,
    bounds: boundsResult.bounds,
    boundsRect: boundsRect.value,
    hitTarget: createSmartPathfindingHitTarget(hitTarget),
    previewEnabled: searchAnimationEnabled.value,
    routeMaskCacheId: pathfindingCache.getRouteObstacleMaskCacheId(obstacleMask),
    routeObstacleMask: obstacleMask,
    routeTolerancePlanePixels: routeTolerance,
    settings: createPathTrajectoryFormulaSettings(),
    simulationBoundaryExpansion: tolerances.boundaryExpansionPlanePixels,
    simulationMask: simulationObstacleMask.value,
    sourcePath,
    targetPoint,
  };
  const resultCacheKey = pathfindingCache.createSmartPathfindingResultCacheKey(input);
  let result = pathfindingCache.getCachedSmartPathfindingResult(resultCacheKey, (timing) => timings?.push(timing));
  const resultCacheHit = result !== undefined;
  try {
    if (!result) {
      result = await graphwarPathfindingRunner.findSmartPath(input, {
        onPreview: searchAnimationEnabled.value ? setSmartPathfindingPreview : undefined,
      });
      pathfindingCache.cacheSmartPathfindingResult(resultCacheKey, result);
    }
  } catch (error) {
    if (!isSmartPathfindingRunCurrent(cancelToken) || isGraphwarPathfindingCancelledError(error)) {
      return undefined;
    }
    return undefined;
  }

  addSmartPathfindingWorkerTimings(timings, result.timings);
  if (result.failureReason === "graph-rule") {
    setSmartPathfindingStatus(getForwardPathMessage(), "error");
    return undefined;
  }
  if (result.blockedPoint) {
    flashSmartPathfindingBlockedPoint(result.blockedPoint);
  }
  if (result.path && searchAnimationEnabled.value) {
    setSmartPathfindingPreviewPath(getSmartPathfindingAppendedSegment(result.path, sourcePath.length));
  }
  return result.path ? { cacheHit: resultCacheHit, path: result.path } : undefined;
}

/** 提取新增路径段并保留连接点，供搜索动画绘制。 */
function getSmartPathfindingAppendedSegment(points: readonly PixelPoint[], sourcePathLength: number) {
  return points.slice(Math.max(0, sourcePathLength - 1));
}

function createSmartPathfindingHitTarget(hitTarget: PixelPoint | HitCircle): HitCircle {
  return "center" in hitTarget
    ? { center: hitTarget.center, radius: hitTarget.radius }
    : { center: hitTarget, radius: soldierMarkerRadius.value };
}

/** 启动新寻路前先确认当前公式轨迹已经能到达当前最后路径点。 */
function ensureCurrentPathReachesLastPointBeforeSmartPathfinding() {
  if (pathPixels.value.length < 2) {
    return true;
  }

  const currentTarget = createCurrentLastPathHitTarget();
  if (!currentTarget) {
    return true;
  }

  const result = createPathTrajectoryResult([...pathPixels.value], currentTarget);
  if (result.reachesTargetBeforeObstacle) {
    return true;
  }

  setSmartPathfindingStatus(getSmartPathfindingCurrentPathBlockedMessage(), "error");
  flashSmartPathfindingBlockedPoint(result.blockedPoint ?? pathPixels.value.at(-1));
  return false;
}

/** 当前最后路径点若对应识别士兵，则用真实士兵命中圈作为预检查目标。 */
function createCurrentLastPathHitTarget() {
  const lastPoint = pathPixels.value.at(-1);
  if (!lastPoint) {
    return undefined;
  }

  const soldier = detectedSoldiers.value.find((box) => detectionBoxContainsHitCircle(box, lastPoint));
  return soldier ? createSoldierHitCircle(soldier) : lastPoint;
}

/** 使用共享采样模块验证像素路径的弹道命中结果。 */
function createPathTrajectoryResult(points: PixelPoint[], hitTarget?: PixelPoint | HitCircle): PathTrajectoryResult {
  const boundsResult = parsedBounds.value;
  if (!boundsResult.ok) {
    return { reachesTargetBeforeObstacle: false, visiblePixels: [] };
  }

  const hitTargetPoint = hitTarget && "center" in hitTarget ? hitTarget.center : hitTarget;
  const hitTargetRadius = hitTarget && "center" in hitTarget ? hitTarget.radius : soldierMarkerRadius.value;

  // 智能寻路候选路径在这里统一转换为“目标前无障碍”的轨迹判定和可视化像素点。
  const result = sampleGraphwarPathTrajectory({
    boundaryExpansion: parsedObstacleTolerances.value.ok
      ? parsedObstacleTolerances.value.boundaryExpansionPlanePixels
      : 0,
    bounds: boundsResult.bounds,
    boundsRect: boundsRect.value,
    hitTargetPoint,
    obstacleMask: simulationObstacleMask.value,
    points,
    settings: createPathTrajectoryFormulaSettings(),
    soldierMarkerRadius: hitTargetRadius,
  });
  return {
    blockedPoint: result.earlyStopReason === "obstacle" ? result.visiblePixels.at(-1) : undefined,
    reachesTargetBeforeObstacle: result.reachesTargetBeforeObstacle,
    visiblePixels: result.visiblePixels,
  };
}

/** 为士兵生成第一瞄点：中心可达用中心，否则用最小 x 步长推进到圆内。 */
function createSearchStartSoldierAimPoint(startPoint: PixelPoint | undefined, box: DetectionBox) {
  return createSoldierAimCheckResult(startPoint, box)?.point;
}

/** 检查士兵中心点和 x+ 边缘点是否满足最小前进规则，保留首个可用结果。 */
function createSoldierAimCheckResult(
  startPoint: PixelPoint | undefined,
  box: DetectionBox,
): SoldierAimCheckResult | undefined {
  const center = getDetectionBoxCenter(box);
  if (!startPoint) {
    return pointIsInsideTargetBounds(center) ? { kind: "center", point: center } : undefined;
  }

  if (soldierAimPointPassesMinimumForwardCheck(center, startPoint)) {
    return { kind: "center", point: center };
  }

  // 第二检查仅把命中圈 x+ 边缘作为“是否可选中”的资格线；
  // 真正落点固定为 lastX 的下一个可表示 double，y 保持命中圈中心，避免点击偏移改变目标。
  if (!soldierAimXReachesMinimumForward(createSoldierHitCircleXPlusEdgePoint(box), startPoint)) {
    return undefined;
  }

  const minimumForwardPoint = createMinimumForwardSoldierTargetPoint(startPoint, box);
  return minimumForwardPoint ? { kind: "edge", point: minimumForwardPoint } : undefined;
}

/** 判断一个士兵候选点是否严格沿 Graphwar x+ 前进，并且没有越出收缩边界。 */
function soldierAimPointPassesMinimumForwardCheck(point: PixelPoint, startPoint: PixelPoint) {
  return pointIsInsideTargetBounds(point) && soldierAimXReachesMinimumForward(point, startPoint);
}

/** 判断一个士兵候选点的 Graphwar x 是否严格大于起点 x。 */
function soldierAimXReachesMinimumForward(point: PixelPoint, startPoint: PixelPoint) {
  return pointGraphXAdvances(startPoint, point);
}

/** 返回士兵命中圈在 x+ 方向上的边缘点，y 固定为命中圈中心。 */
function createSoldierHitCircleXPlusEdgePoint(box: DetectionBox) {
  const center = getDetectionBoxCenter(box);
  const xPlusIsRight = parsedBounds.value.ok ? xPlusGoesRight(parsedBounds.value.bounds) : true;
  return createPixelPoint(center.x + (xPlusIsRight ? box.hitRadius : -box.hitRadius), center.y);
}

/** 构造普通智能寻路的士兵目标：路径连到可用瞄点，弹道仍必须打中原命中圈。 */
function createSmartPathfindingSoldierTarget(
  startPoint: PixelPoint,
  box: DetectionBox,
): SmartPathfindingTarget | undefined {
  const targetPoint = createSearchStartSoldierAimPoint(startPoint, box);
  if (!targetPoint) {
    return undefined;
  }

  return {
    hitCircle: createSoldierHitCircle(box),
    targetPoint,
  };
}

/** 从检测框创建命中圆，统一士兵目标和弹道命中判定。 */
function createSoldierHitCircle(box: DetectionBox): HitCircle {
  return {
    center: getDetectionBoxCenter(box),
    radius: box.hitRadius,
  };
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

/** 更新智能寻路阶段，并同步刷新进行中文案。 */
function setSmartPathfindingPhase(phase: SmartPathfindingPhase) {
  smartPathfindingSession.setPhase(phase);
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

/** 设置智能寻路路径预览点。 */
function setSmartPathfindingPreviewPath(points: readonly PixelPoint[]) {
  smartPathfindingSession.setPreviewPath(points);
}

/** 短暂标记阻止启动智能寻路的当前轨迹撞击位置。 */
function flashSmartPathfindingBlockedPoint(point: PixelPoint | undefined) {
  smartPathfindingSession.flashBlockedPoint(point);
}

/** 清理当前路径预检的撞击点标记。 */
function clearSmartPathfindingBlockedPoint() {
  smartPathfindingSession.clearBlockedPoint();
}

/** 设置寻路起点到目标的直线连接预览。 */
function setSmartPathfindingPreviewConnection(startPoint: PixelPoint, targetPoint: PixelPoint) {
  smartPathfindingSession.setPreviewConnection(startPoint, targetPoint);
}

/** 把共享寻路模块的图搜索快照投影回截图，用于搜索动画。 */
function setSmartPathfindingPreview({
  acceptedEdges,
  bestPath,
  candidates,
  current,
  mirrored,
}: GraphwarPathfindingPreview) {
  smartPathfindingSession.setSearchPreview({
    acceptedEdges: acceptedEdges.map(([start, end]) =>
      createPathLineSegment(
        previewPlanePointToImagePoint(start, mirrored),
        previewPlanePointToImagePoint(end, mirrored),
      ),
    ),
    current: current ? previewPlanePointToImagePoint(current, mirrored) : undefined,
    path: bestPath.map((point) => previewPlanePointToImagePoint(point, mirrored)),
    points: candidates.map((point) => previewPlanePointToImagePoint(point, mirrored)),
  });
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

/** 将搜索坐标系里的平面点投影成截图像素点。 */
function previewPlanePointToImagePoint(point: PlaneGridPoint, mirrored: boolean) {
  return planeGridCellCenterToImagePoint(mirrorPlaneGridPoint(point, mirrored), boundsRect.value);
}

/** 清理智能寻路相关视觉状态。 */
function clearSmartPathfindingPreview() {
  smartPathfindingSession.clearPreview();
}

/** 让长循环让出事件循环，保证搜索动画和取消操作能及时响应。 */
function waitForNextPathfindingSlice() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** 按当前边界外扩把棋盘内部收缩成可选目标区域。 */
function createBoundsRectWithBoundaryExpansion(rect: BoundsRect, boundaryExpansion: number) {
  const horizontalInset = (boundaryExpansion / GRAPHWAR_PLANE_LENGTH) * rect.width;
  const verticalInset = (boundaryExpansion / GRAPHWAR_PLANE_HEIGHT) * rect.height;
  if (horizontalInset * 2 >= rect.width || verticalInset * 2 >= rect.height) {
    return undefined;
  }

  return {
    x: rect.x + horizontalInset,
    y: rect.y + verticalInset,
    width: rect.width - horizontalInset * 2,
    height: rect.height - verticalInset * 2,
  };
}

/** 判断点是否在考虑边界外扩后的可用目标区域内。 */
function pointIsInsideTargetBounds(point: PixelPoint) {
  const rect = targetBoundsRect.value;
  return Boolean(rect && pointIsInsideBoundsRect(point, rect));
}

/** 判断点是否在指定截图矩形内，边界视为有效。 */
function pointIsInsideBoundsRect(point: PixelPoint, rect: BoundsRect) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

/** 判断 Graphwar x 是否严格大于起点 x；同一个 double x 不允许。 */
function graphXReachesMinimumForward(graphX: number, startPoint: PixelPoint) {
  if (!parsedBounds.value.ok) {
    return false;
  }

  return graphXAdvancesFromPoint(startPoint, graphX, parsedBounds.value.bounds, boundsRect.value);
}

/** 判断两个截图点映射到 Graphwar 后是否严格 x+。 */
function pointGraphXAdvances(startPoint: PixelPoint, point: PixelPoint) {
  if (!parsedBounds.value.ok) {
    return false;
  }

  return pathFollowsGraphRule([startPoint, point], parsedBounds.value.bounds, boundsRect.value);
}

/** 返回当前起点之后最小 double x+ 对应的截图 x，用于绘制可点区域预览。 */
function getMinimumForwardPixelX(startPoint: PixelPoint) {
  if (!parsedBounds.value.ok) {
    return undefined;
  }

  const startGraph = imageToGraphPoint(startPoint, parsedBounds.value.bounds, boundsRect.value);
  return createMinimumForwardPointAtGraphYForCurrentBounds(startPoint, startGraph.y)?.x;
}

/** 在指定 Graphwar y 上创建 startX 之后的最小可表示 x+ 点。 */
function createMinimumForwardPointAtGraphYForCurrentBounds(startPoint: PixelPoint, graphY: number) {
  if (!parsedBounds.value.ok) {
    return undefined;
  }

  return createMinimumForwardPointAtGraphY(startPoint, graphY, parsedBounds.value.bounds, boundsRect.value);
}

/** 按指定起点把 x 不够的目标改为同 y 的最小 double x+ 点；无剩余空间时返回 undefined。 */
function createMinimumForwardTargetPoint(point: PixelPoint, startPoint = pathPixels.value.at(-1)) {
  if (!parsedBounds.value.ok) {
    return undefined;
  }

  if (!startPoint) {
    return pointIsInsideTargetBounds(point) ? point : undefined;
  }

  const targetRect = targetBoundsRect.value;
  if (!targetRect || point.y < targetRect.y || point.y > targetRect.y + targetRect.height) {
    return undefined;
  }

  const bounds = parsedBounds.value.bounds;
  const targetGraph = imageToGraphPoint(point, bounds, boundsRect.value);

  // 设计意图：非士兵点击如果落在 x+ 打击范围左侧，目标会移到
  // “最后一个路径点之后的下一个可表示 double x”，y 保持点击值；这里不做
  // 障碍、寻路或额外命中判断，只检查最终 xy 是否仍在可用边界内。
  const targetPoint = graphXReachesMinimumForward(targetGraph.x, startPoint)
    ? point
    : createMinimumForwardPointAtGraphYForCurrentBounds(startPoint, targetGraph.y);
  if (!targetPoint) {
    return undefined;
  }
  return pointIsInsideTargetBounds(targetPoint) ? targetPoint : undefined;
}

/** 生成最小 double x+ 处、且 y 保持士兵命中圈中心的目标点。 */
function createMinimumForwardSoldierTargetPoint(startPoint: PixelPoint, box: DetectionBox) {
  if (!parsedBounds.value.ok) {
    return undefined;
  }

  const center = getDetectionBoxCenter(box);
  const centerGraph = imageToGraphPoint(center, parsedBounds.value.bounds, boundsRect.value);
  const targetPoint = createMinimumForwardPointAtGraphYForCurrentBounds(startPoint, centerGraph.y);
  if (!targetPoint) {
    return undefined;
  }
  return pointIsInsideTargetBounds(targetPoint) && detectionBoxContainsHitCircle(box, targetPoint)
    ? targetPoint
    : undefined;
}

/** 判断检测框是否包含当前最右侧路径点，避免把已选士兵再次作为目标。 */
function detectionBoxMatchesSelectedPathPoint(box: DetectionBox) {
  if (pathPixels.value.length === 0) {
    return false;
  }

  const selectedPoint = getRightmostPathPoint();
  if (!selectedPoint) {
    return false;
  }

  return detectionBoxContainsPathPoint(box, selectedPoint);
}

/** 一键清图以第一个路径点作为发射士兵，后续路径点都是普通控制点。 */
function detectionBoxMatchesFirstPathPoint(box: DetectionBox) {
  const firstPoint = pathPixels.value[0];
  return Boolean(firstPoint && detectionBoxContainsPathPoint(box, firstPoint));
}

/** 当前规则下 x<0 的未选士兵视为友方障碍。 */
function isDetectedFriendlySoldierObstacle(box: DetectionBox) {
  if (!parsedBounds.value.ok || detectionBoxMatchesFirstPathPoint(box)) {
    return false;
  }

  return isDetectionBoxOnNegativeGraphX(box);
}

/** 智能光标初始选点只标记 x- 士兵，避免还没选起点时提示敌方目标。 */
function isDetectionBoxOnNegativeGraphX(box: DetectionBox) {
  if (!parsedBounds.value.ok) {
    return false;
  }

  const center = imageToGraphPoint(getDetectionBoxCenter(box), parsedBounds.value.bounds, boundsRect.value);
  return center.x < 0;
}

/** 获取 Graphwar x 最大的已选路径点，用于过滤当前目标。 */
function getRightmostPathPoint() {
  const boundsResult = parsedBounds.value;
  if (!boundsResult.ok || pathPixels.value.length === 0) {
    return undefined;
  }

  return pathPixels.value.reduce<PixelPoint | undefined>((rightmostPoint, point) => {
    if (!rightmostPoint) {
      return point;
    }

    const graphPoint = imageToGraphPoint(point, boundsResult.bounds, boundsRect.value);
    const rightmostGraphPoint = imageToGraphPoint(rightmostPoint, boundsResult.bounds, boundsRect.value);
    return graphPoint.x > rightmostGraphPoint.x ? point : rightmostPoint;
  }, undefined);
}

/** 用士兵圆形范围判断检测框是否包含路径点。 */
function detectionBoxContainsPathPoint(box: DetectionBox, point: PixelPoint) {
  return detectionBoxContainsHitCircle(box, point);
}

/** 命中最近的路径点索引，逆序让后绘制的点优先。 */
function getPathPointIndexAtPoint(point: PixelPoint) {
  const radius = Math.max(10, soldierSelectionRadius.value);
  for (let index = pathPixels.value.length - 1; index >= 0; index -= 1) {
    const pathPoint = pathPixels.value[index];
    if (Math.hypot(point.x - pathPoint.x, point.y - pathPoint.y) <= radius) {
      return index;
    }
  }
  return undefined;
}

watch([pathPixels, soldierSelectionRadius], () => {
  refreshLiveClickPreviewPointerPathPointIndex();
});

/** 更新路径点并重新规范化后续路径。 */
function setPathPoint(index: number, point: PixelPoint) {
  if (!parsedBounds.value.ok || index < 0 || index >= pathPixels.value.length) {
    return false;
  }

  const previousPoint = index > 0 ? pathPixels.value[index - 1] : undefined;
  const nextPoint = normalizePathPointForStrictForwardForCurrentBounds(point, previousPoint);
  if (!nextPoint) {
    return false;
  }

  const nextPath = [...pathPixels.value];
  nextPath[index] = nextPoint;
  const normalizedPath = normalizePathForMinimumForwardStepForCurrentBounds(nextPath);
  if (!pathFollowsGraphRuleForCurrentBounds(normalizedPath)) {
    pathStatus.value = getForwardPathMessage();
    return false;
  }

  setPathPixels(normalizedPath);
  return true;
}

/** 读取路径点坐标输入框文本。 */
function getPathPointCoordinateText(index: number, axis: PathPointCoordinateAxis) {
  return getPathPointCoordinateTextState(index, axis);
}

/** 同步坐标输入框文本；正在编辑的单元格保留原输入。 */
function syncPathPointCoordinateTexts() {
  syncPathPointCoordinateTextState({
    formatCoordinate: formatDoublePrecisionDecimal,
    points: mappedPathPoints.value,
  });
}

/** 记录当前编辑的路径点坐标单元格。 */
function startPathPointCoordinateEdit(index: number, axis: PathPointCoordinateAxis) {
  startPathPointCoordinateEditState(index, axis);
}

/** 结束路径点坐标编辑并恢复格式化文本。 */
function finishPathPointCoordinateEdit() {
  finishPathPointCoordinateEditState({
    formatCoordinate: formatDoublePrecisionDecimal,
    points: mappedPathPoints.value,
  });
  if (pathStatus.value === getPathPointCoordinateMessage()) {
    pathStatus.value = "";
  }
}

/** 处理坐标输入框文本变更，合法数字会立即映射回截图像素更新路径。 */
function handlePathPointCoordinateInput(index: number, axis: PathPointCoordinateAxis, value: string) {
  setPathPointCoordinateText(index, axis, value);
  const coordinate = parseFiniteNumber(value);
  if (coordinate === undefined) {
    pathStatus.value = getPathPointCoordinateMessage();
    return;
  }

  setPathPointFromGraphCoordinate(index, axis, coordinate);
}

/** 用 Graphwar 坐标更新单个路径点，其他轴保持原值。 */
function setPathPointFromGraphCoordinate(index: number, axis: PathPointCoordinateAxis, coordinate: number) {
  if (!parsedBounds.value.ok) {
    return false;
  }

  const currentPoint = mappedPathPoints.value[index];
  if (!currentPoint) {
    return false;
  }

  const nextGraphPoint = createGraphPoint(
    axis === "x" ? coordinate : currentPoint.x,
    axis === "y" ? coordinate : currentPoint.y,
  );
  return setPathPoint(index, graphToImagePoint(nextGraphPoint, parsedBounds.value.bounds, boundsRect.value));
}

/** 返回坐标输入错误文案。 */
function getPathPointCoordinateMessage() {
  return locale.status.pathPointCoordinateNumber;
}

/** 按严格 x+ 规则把整条路径推进到下一个可表示 double。 */
function normalizePathForMinimumForwardStepForCurrentBounds(points: readonly PixelPoint[]) {
  if (!parsedBounds.value.ok || points.length < 2) {
    return [...points];
  }

  return normalizePathForMinimumForwardStep(points, parsedBounds.value.bounds, boundsRect.value);
}

/** 先按边界收缩点，再只在必要时把 Graphwar x 推到上一个点后的下一个 double。 */
function normalizePathPointForStrictForwardForCurrentBounds(point: PixelPoint, previousPoint?: PixelPoint) {
  if (!parsedBounds.value.ok) {
    return point;
  }

  return normalizePathPointForStrictForward(point, previousPoint, parsedBounds.value.bounds, boundsRect.value);
}

/** 删除路径点。 */
function removePathPoint(index: number) {
  if (index < 0 || index >= pathPixels.value.length) {
    return false;
  }
  cancelSmartPathfinding(false);
  clearSmartPathfindingStatus();
  if (!removeActivePathPoint(index)) {
    return false;
  }
  if (index === 0) {
    invalidatePathfindingWorkerCache();
  }
  return true;
}

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

/** 返回当前可见目标中被指针命中的士兵。 */
function getDetectedSoldierAtPoint(point: PixelPoint) {
  const boxes = detectionBoxes.value;
  for (let index = boxes.length - 1; index >= 0; index -= 1) {
    const box = boxes[index];
    if (detectionBoxContainsSelectionCircle(box, point)) {
      return box;
    }
  }
  return undefined;
}

/** 返回 Graphwar 士兵源码中心；命中、发射和路径点都使用这个点。 */
function getDetectionBoxCenter(box: DetectionBox) {
  return createPixelPoint(box.sourceCenterX, box.sourceCenterY);
}

/** 判断指针是否落在 Graphwar 士兵可视选择圈内。 */
function detectionBoxContainsSelectionCircle(box: DetectionBox, point: PixelPoint) {
  return Math.hypot(point.x - box.visualCenterX, point.y - box.visualCenterY) <= box.visualRadius;
}

/** 判断指针或路径点是否落在 Graphwar 士兵实际命中圈内。 */
function detectionBoxContainsHitCircle(box: DetectionBox, point: PixelPoint) {
  const center = getDetectionBoxCenter(box);
  return Math.hypot(point.x - center.x, point.y - center.y) <= box.hitRadius;
}

/** 从士兵检测框内采样玩家颜色，供模拟器轨迹线匹配当前士兵。 */
function getDetectedSoldierColor(box: DetectionBox) {
  const imageData = getImageDataFromCurrentImage();
  if (!imageData) {
    return undefined;
  }

  let redSum = 0;
  let greenSum = 0;
  let blueSum = 0;
  let count = 0;
  const startX = clampNumber(Math.floor(box.x), 0, imageData.width - 1);
  const endX = clampNumber(Math.ceil(box.x + box.width), 0, imageData.width - 1);
  const startY = clampNumber(Math.floor(box.y), 0, imageData.height - 1);
  const endY = clampNumber(Math.ceil(box.y + box.height), 0, imageData.height - 1);

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      const index = (y * imageData.width + x) * 4;
      const red = imageData.data[index];
      const green = imageData.data[index + 1];
      const blue = imageData.data[index + 2];
      if (!isPlayerColorPixel(red, green, blue)) {
        continue;
      }

      redSum += red;
      greenSum += green;
      blueSum += blue;
      count += 1;
    }
  }

  if (count === 0) {
    return undefined;
  }

  return `rgb(${Math.round(redSum / count)} ${Math.round(greenSum / count)} ${Math.round(blueSum / count)})`;
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

/** 在候选点标准化后执行 Graphwar 的 x+ 路径规则。 */
function canAppendPathPoint(point: PixelPoint) {
  if (!parsedBounds.value.ok || pathPixels.value.length < 1) {
    return true;
  }

  const nextPoint = imageToGraphPoint(point, parsedBounds.value.bounds, boundsRect.value);
  const previousPoint = mappedPathPoints.value.at(-1);
  if (!previousPoint) {
    return true;
  }

  if (pathAdvancesEnough(previousPoint.x, nextPoint.x)) {
    return true;
  }

  pathStatus.value = getForwardPathMessage();
  return false;
}

/** 验证整条路径是否始终满足 Graphwar 最小 x+ 步长。 */
function pathFollowsGraphRuleForCurrentBounds(points: PixelPoint[]) {
  if (!parsedBounds.value.ok || points.length < 2) {
    return true;
  }

  return pathFollowsGraphRule(points, parsedBounds.value.bounds, boundsRect.value);
}

/** 判断相邻两个 Graphwar x 是否严格 x+；同一个 double x 不允许。 */
function pathAdvancesEnough(previousX: number, nextX: number) {
  return graphXAdvancesStrictly(previousX, nextX);
}

/** 返回路径必须向 x+ 前进的本地化提示。 */
function getForwardPathMessage() {
  return locale.smartPathfinding.forwardPath(locale.smartPathfinding.forwardMinimumDouble);
}

/** 返回智能寻路失败文案，可附带耗时。 */
function getSmartPathfindingFailureMessage(elapsedMs?: number) {
  return locale.smartPathfinding.failure(elapsedMs === undefined ? undefined : formatElapsedDuration(elapsedMs));
}

/** 返回当前路径尚未到达最后路径点时的寻路拦截文案。 */
function getSmartPathfindingCurrentPathBlockedMessage() {
  return locale.smartPathfinding.currentPathBlocked;
}

/** 返回智能寻路成功文案，可附带耗时。 */
function getSmartPathfindingSuccessMessage(elapsedMs?: number, resultCacheHit = false) {
  return locale.smartPathfinding.success(
    elapsedMs === undefined ? undefined : formatElapsedDuration(elapsedMs),
    resultCacheHit,
  );
}

/** 根据当前阶段生成智能寻路进行中文案。 */
function getSmartPathfindingInProgressMessage() {
  const phaseText =
    activeSmartPathfindingPhase.value === "search"
      ? locale.smartPathfinding.inProgress.search
      : activeSmartPathfindingPhase.value === "trajectory"
        ? locale.smartPathfinding.inProgress.trajectory
        : locale.smartPathfinding.inProgress.optimize;
  return `${phaseText}${locale.smartPathfinding.inProgress.stopSuffix}`;
}

/** 返回智能寻路取消文案。 */
function getSmartPathfindingCancelledMessage() {
  return locale.smartPathfinding.cancelled;
}

/** 将毫秒耗时格式化成调试和状态栏使用的短文本。 */
function formatElapsedDuration(elapsedMs: number) {
  if (elapsedMs <= 0) {
    return "0 ms";
  }
  if (elapsedMs < 1000) {
    return `${Math.max(1, Math.round(elapsedMs))} ms`;
  }
  return `${formatDecimal(elapsedMs / 1000, elapsedMs < 10000 ? 2 : 1)} s`;
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

/** 复制当前生成的 Graphwar 表达式。 */
async function copyFormula() {
  const text = toolWorkflowMode.value === "solver" ? formulaResult.value?.expression : simulatorFormulaText.value;
  if (!canCopyFormula.value || !text) {
    return;
  }

  try {
    await copyText(text);
    setCopyStatus("success");
  } catch {
    setCopyStatus("error");
  }
}

/** 清除模拟器表达式和发射角输入。 */
function clearSimulatorInputs() {
  simulatorFormulaText.value = "";
  simulatorLaunchAngleText.value = "";
  setCopyStatus("idle");
}

/** 设置临时复制反馈文本，并在短时间后自动清除。 */
function setCopyStatus(status: TransferStatus) {
  copyStatus.value = status;
  if (copyStatusTimer) {
    clearTimeout(copyStatusTimer);
  }

  if (status !== "idle") {
    copyStatusTimer = setTimeout(() => {
      copyStatus.value = "idle";
      copyStatusTimer = undefined;
    }, 2000);
  }
}

/** 使用 Clipboard API 复制文本，失败时回退到隐藏 textarea 命令。 */
async function copyText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard API unavailable");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Copy failed");
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
      @update-obstacle-simulation-tolerance-text="obstacleSimulationToleranceText = $event"
      @update-one-click-clear-delete-check-radius-text="oneClickClearDeleteCheckRadiusText = $event"
      @update-pathfinding-boundary-expansion-text="pathfindingBoundaryExpansionText = $event"
      @update-pathfinding-worker-count-text="pathfindingWorkerCountText = $event"
      @update-route-planning-tolerance-text="routePlanningToleranceText = $event"
      @update-template-matching-worker-count-text="templateMatchingWorkerCountText = $event"
    />
    <div class="graphwar-killer__detection-pathfinding-row">
      <GraphwarDetectionPanel
        :locale="locale"
        :panel="detectionPanel"
        @start-detection="void detectGraphwarObjects()"
        @toggle-auto-detection="toggleAutoDetection"
        @toggle-smart-cursor="toggleSmartCursor"
      />
      <GraphwarSmartPathfindingPanel
        v-if="toolWorkflowMode !== 'simulator'"
        :locale="locale"
        :panel="smartPathfindingPanel"
        @run-one-click-clear="void runOneClickClear()"
        @toggle-friendly-fire="toggleFriendlyFire"
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
