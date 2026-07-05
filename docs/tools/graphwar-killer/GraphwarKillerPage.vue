<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { useGraphwarPathState, type PathPointCoordinateAxis } from "./composables/use-graphwar-path-state";
import { useGraphwarScreenshotWorkflow } from "./composables/use-graphwar-screenshot";
import { buildFormula } from "./formula";
import {
  graphToImagePoint,
  imageToGraphPoint,
  normalizeBoundsRect,
  normalizePathPoint,
  xPlusGoesRight,
} from "./geometry";
import {
  GRAPHWAR_DEFAULT_X_LIMIT,
  GRAPHWAR_GAME_SOLDIER_RADIUS,
  GRAPHWAR_PLANE_GAME_LENGTH,
  GRAPHWAR_PLANE_HEIGHT,
  GRAPHWAR_PLANE_LENGTH,
  GRAPHWAR_SOLDIER_RADIUS,
  GRAPHWAR_SOLDIER_VISIBLE_SIZE,
  GRAPHWAR_VISIBLE_Y_LIMIT,
} from "./graphwar";
import {
  addSoldierAreasToObstacleMask,
  buildObstacleEdgePath,
  buildObstacleFillPath,
  countObstacleMaskComponents,
  dilateObstacleMask,
  imagePointToPlaneGridPoint,
  isPlayerColorPixel,
  paintObstacleMaskDisk,
  paintObstacleMaskStroke,
} from "./graphwar-detection";
import type { DetectedObstacleMap, GraphwarDetectionBox, GraphwarObjectsDetectionResult } from "./graphwar-detection";
import { createGraphwarDetectionRunner, isGraphwarDetectionCancelledError } from "./graphwar-detection-runner";
import type {
  GraphwarDetectionWorkerStage,
  GraphwarDetectionWorkerTimingDetail,
  GraphwarDetectionWorkerTimingEntry,
} from "./graphwar-detection-runner";
import {
  createMinimumForwardPointAtGraphY,
  graphXAdvancesFromPoint,
  normalizePathForMinimumForwardStep,
  normalizePathPointForStrictForward,
  pathFollowsGraphRule,
} from "./graphwar-forward-rule";
import {
  GRAPHWAR_DEFAULT_ROUTE_PLANNING_TOLERANCE_PLANE_PIXELS,
  type GraphwarOneClickClearCandidate,
  type GraphwarOneClickClearDebugDetail,
  type GraphwarOneClickClearDebugStage,
  type GraphwarOneClickClearDebugTiming,
  type GraphwarOneClickClearFailureReason,
} from "./graphwar-one-click-clear";
import { createRouteMaskCacheKey, mirrorPlaneGridPoint, planeGridCellCenterToImagePoint } from "./graphwar-pathfinding";
import type { GraphwarPathfindingPreview, PlaneGridPoint } from "./graphwar-pathfinding";
import { createGraphwarPathfindingRunner, isGraphwarPathfindingCancelledError } from "./graphwar-pathfinding-runner";
import type {
  GraphwarOneClickClearPathWorkerInput,
  GraphwarOneClickClearPathWorkerResult,
  GraphwarSmartPathfindingPathInput,
  GraphwarSmartPathfindingPathResult,
} from "./graphwar-pathfinding-worker-types";
import { createHeaderStatus, getFirstHeaderStatus, getSmartPathfindingHeaderStatus } from "./header-status";
import type { GraphwarKillerLocale } from "./locale-types";
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
} from "./numbers";
import { graphwarToolDefaults } from "./tool-defaults";
import {
  createGraphwarTrajectoryFormulaContext,
  findGraphwarTrajectoryTargetHitIndex,
  getGraphwarTrajectoryLaunchAngle,
  sampleGraphwarExpressionTrajectoryWithStops,
  sampleGraphwarFormulaTrajectory,
  sampleGraphwarPathTrajectory,
} from "./trajectory-sampling";
import type { GraphwarTrajectoryFormulaSettings, GraphwarTrajectorySampleResult } from "./trajectory-sampling";
import { createGraphPoint, createPixelPoint } from "./types";
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
} from "./types";

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
/** 识别调试耗时阶段。 */
type DetectionDebugStage =
  | "building-obstacle-mask"
  | "collecting-soldier-candidates"
  | "preparing-pixels"
  | "detecting-bounds"
  | "detecting-objects"
  | "filtering-obstacle-components"
  | "matching-soldier-templates"
  | "updating-results"
  | "setting-status"
  | "outside-stages"
  | "total";
/** 智能寻路状态等级，与面板标题和状态条样式对齐。 */
type SmartPathfindingStatusKind = "info" | "success" | "warning" | "error";
/** 智能寻路内部阶段，用于状态文案和搜索动画。 */
type SmartPathfindingPhase = "optimize" | "search" | "trajectory";
/** 智能寻路调试耗时阶段。 */
type SmartPathfindingDebugStage =
  | "preflight"
  | "collect-targets"
  | "result-cache-hit"
  | "result-cache-miss"
  | "route-mask-cache-hit"
  | "route-mask-cache-miss"
  | "search-route"
  | "visibility-cache-hit"
  | "visibility-cache-miss"
  | "visibility-cache-skipped"
  | "validate-trajectory"
  | "optimize-path"
  | "apply-result"
  | "one-click-clear-preflight"
  | "one-click-clear-collect-targets"
  | "one-click-clear-result-cache-hit"
  | "one-click-clear-result-cache-miss"
  | "one-click-clear-route-mask-cache-hit"
  | "one-click-clear-route-mask-cache-miss"
  | "one-click-clear-search"
  | "one-click-clear-apply-result"
  | "one-click-clear-setting-status"
  | "setting-status"
  | "outside-stages"
  | "total";
/** SVG 线段 DTO，避免模板里重复计算 x1/y1/x2/y2。 */
interface PathLineSegment {
  /** 起点 x。 */
  x1: number;
  /** 终点 x。 */
  x2: number;
  /** 起点 y。 */
  y1: number;
  /** 终点 y。 */
  y2: number;
}
/** 单次识别调试耗时记录。 */
interface DetectionDebugTimingEntry {
  /** 被测量的识别阶段。 */
  stage: DetectionDebugStage;
  /** 阶段耗时，单位毫秒。 */
  elapsedMs: number;
  /** Worker 返回的阶段细分信息；存在时按子项展示。 */
  detail?: GraphwarDetectionWorkerTimingDetail;
}
/** 识别调试耗时展示行。 */
interface DetectionDebugTimingRow extends DetectionDebugTimingEntry {
  /** 鼠标悬停说明；用于解释不直接对应某个函数块的阶段。 */
  title?: string;
  /** 展示标签，子项会以 "- " 开头。 */
  label: string;
  /** 是否展示耗时；有些子项只记录调度元信息。 */
  elapsedVisible: boolean;
}
/** 单次智能寻路调试耗时记录。 */
interface SmartPathfindingDebugTimingEntry {
  /** 被测量的智能寻路阶段。 */
  stage: SmartPathfindingDebugStage;
  /** 阶段耗时，单位毫秒。 */
  elapsedMs: number;
  /** 阶段内细分耗时；存在时展示为父阶段下的子项。 */
  detail?: GraphwarOneClickClearDebugStage | GraphwarOneClickClearDebugDetail;
}
/** 智能寻路调试耗时展示行。 */
interface SmartPathfindingDebugTimingRow extends SmartPathfindingDebugTimingEntry {
  /** 是否展示耗时；调度模式项只解释模式，不展示 0ms。 */
  elapsedVisible: boolean;
  /** 鼠标悬停说明；用于解释不直接对应某个函数块的阶段。 */
  title?: string;
  /** 展示缩进层级；一键清图内部阶段有父子 inclusive 耗时，缩进避免误读为同级相加。 */
  indentLevel: number;
  /** 展示标签，子项会以 "- " 开头。 */
  label: string;
}
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
/** 页面侧 route tolerance mask 缓存。 */
interface RouteMaskCacheEntry {
  /** 页面内基础障碍 mask 稳定 id；Worker 用它识别同一个 base mask。 */
  id: number;
  /** 膨胀或腐蚀后的 mask。 */
  mask: Uint8Array;
}
/** 关闭友伤时，把友方士兵写入原始障碍 mask 后得到的派生 mask。 */
interface FriendlyObstacleMaskCacheEntry {
  /** 派生 mask 输入摘要；同一个原始 mask 在不同士兵/边界设置下不能混用。 */
  key: string;
  /** 已写入友方士兵区域的障碍 mask。 */
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
const detectionFlashAnimationMs = 1600;
const debugActivationHoldMs = 3000;
const debugActivationCountdownStepMs = 100;
const debugActivationCountdownVisibleAfterMs = 1000;
const debugActivationSuccessFlashMs = 2000;
const smartPathfindingBlockedPointFlashMs = 1800;
const smartPathfindingResultCacheLimit = 64;
const oneClickClearResultCacheLimit = 16;
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
const boundsFlashActive = ref(false);
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
const debugInfoEnabled = ref(false);
const debugActivationRemainingMs = ref<number>();
const debugActivationSuccessVisible = ref(false);
const detectionDebugTimingEntries = ref<DetectionDebugTimingEntry[]>([]);
const detectionStatusWarning = ref("");
const detectionStatusWarningTitle = ref("");
const smartPathfindingDebugTimingEntries = ref<SmartPathfindingDebugTimingEntry[]>([]);
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
const detectedObstacles = ref<DetectedObstacleMap>();
const baselineDetectedObstacles = ref<DetectedObstacleMap>();
const autoDetectionEnabled = ref(true);
const detectionSoldierFlashActive = ref(false);
const oneClickClearHitFlashSoldiers = ref<DetectionBox[]>([]);
const oneClickClearHitFlashActive = ref(false);
const smartCursorEnabled = ref(true);
const smartPathfindingEnabled = ref(false);
const friendlyFireEnabled = ref(false);
// 障碍笔刷状态只描述页面编辑手势；真正参与寻路的是编辑落地后的 detectedObstacles.mask。
const obstacleBrushDiameterText = ref("30");
const obstacleBrushEraseEnabled = ref(false);
const obstacleBrushPointerPoint = ref<PixelPoint>();
const obstacleBrushDragging = ref(false);
const obstacleBrushLastPlanePoint = ref<PlaneGridPoint>();
const obstacleEditsDirty = ref(false);
const searchAnimationEnabled = ref(true);
// 智能寻路和一键清图共用同一组运行状态、预览层和取消 token，避免两个异步任务同时回写页面。
const smartPathfindingInProgress = ref(false);
const activeSmartPathfindingPhase = ref<SmartPathfindingPhase>("search");
const smartPathfindingStatus = ref("");
const smartPathfindingStatusKind = ref<SmartPathfindingStatusKind>("info");
const smartPathfindingPreviewConnection = ref<PathLineSegment>();
const smartPathfindingPreviewAcceptedEdges = ref<PathLineSegment[]>([]);
const smartPathfindingPreviewCurrentPoint = ref<PixelPoint>();
const smartPathfindingPreviewPoints = ref<PixelPoint[]>([]);
const smartPathfindingPreviewPath = ref<PixelPoint[]>([]);
const pathfindingOptimizationPreviewPoint = ref<PixelPoint>();
const smartPathfindingBlockedPoint = ref<PixelPoint>();
// route mask cache 绑定原始 mask 对象；完整结果 cache 额外绑定路径、目标和公式设置。
const routeObstacleMaskIds = new WeakMap<Uint8Array, number>();
const routeMaskCache = new WeakMap<Uint8Array, Map<string, RouteMaskCacheEntry>>();
const friendlyObstacleMaskCache = new WeakMap<Uint8Array, FriendlyObstacleMaskCacheEntry>();
const smartPathfindingResultCache = new Map<string, GraphwarSmartPathfindingPathResult>();
const oneClickClearResultCache = new Map<string, GraphwarOneClickClearPathWorkerResult>();
const effectiveSmartPathfindingEnabled = computed(
  () => toolWorkflowMode.value !== "simulator" && algorithmMode.value !== "step" && smartPathfindingEnabled.value,
);
const pathfindingObstacleEdgesActive = computed(() => effectiveSmartPathfindingEnabled.value);
const blocksFriendlyFireTargets = computed(
  () => pathfindingObstacleEdgesActive.value && !friendlyFireEnabled.value && pathPixels.value.length > 0,
);
const hoveredDetectedSoldierId = ref<string>();
const copyStatus = ref<TransferStatus>("idle");
let boundsFlashFrame: number | undefined;
let boundsFlashTimer: ReturnType<typeof setTimeout> | undefined;
let copyStatusTimer: ReturnType<typeof setTimeout> | undefined;
let detectionRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let detectionSoldierFlashFrame: number | undefined;
let detectionSoldierFlashTimer: ReturnType<typeof setTimeout> | undefined;
let liveClickPreviewPointerFrame: number | undefined;
let liveClickPreviewPendingPointerPoint: PixelPoint | undefined;
let oneClickClearHitFlashFrame: number | undefined;
let oneClickClearHitFlashTimer: ReturnType<typeof setTimeout> | undefined;
let debugActivationCountdownTimer: ReturnType<typeof setInterval> | undefined;
let debugActivationStartedAt: number | undefined;
let debugActivationSuccessTimer: ReturnType<typeof setTimeout> | undefined;
let debugActivationTimer: ReturnType<typeof setTimeout> | undefined;
let debugActivationTriggered = false;
let obstacleEditRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let smartPathfindingBlockedPointTimer: ReturnType<typeof setTimeout> | undefined;
let detectionRunId = 0;
let nextRouteMaskCacheId = 1;
let smartPathfindingCancelToken = 0;

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
const settingsHeaderStatus = computed(() => settingsHeaderStatusResult.value.message);
const settingsHeaderStatusIsError = computed(() => settingsHeaderStatusResult.value.kind === "error");
const settingsHeaderStatusIsWarning = computed(() => settingsHeaderStatusResult.value.kind === "warning");
const settingsHeaderStatusIsSuccess = computed(() => settingsHeaderStatusResult.value.kind === "success");
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

  return getCachedFriendlyObstacleMask(obstacleMap.mask, boundsRect.value, friendlySoldiers, soldierMarkerRadius.value);
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
    getCachedRouteMask(obstacleMask, smartPathfindingVisibleRouteTolerance.value).mask,
    boundsRect.value,
  );
});
const smartPathfindingObstacleRouteFillPath = computed(() => {
  const obstacleMask = pathfindingObstacleEdgesActive.value ? activePathfindingBaseObstacleMask.value : undefined;
  if (!obstacleMask || !parsedObstacleTolerances.value.ok) {
    return "";
  }

  return buildObstacleFillPath(
    getCachedRouteMask(obstacleMask, smartPathfindingVisibleRouteTolerance.value).mask,
    boundsRect.value,
  );
});
const smartPathfindingObstacleSimulationEdgePath = computed(() => {
  const obstacleMask = pathfindingObstacleEdgesActive.value ? activePathfindingBaseObstacleMask.value : undefined;
  if (!obstacleMask || !parsedObstacleTolerances.value.ok) {
    return "";
  }

  return buildObstacleEdgePath(
    getCachedRouteMask(obstacleMask, parsedObstacleTolerances.value.simulationTolerancePlanePixels).mask,
    boundsRect.value,
  );
});
const smartPathfindingObstacleSimulationFillPath = computed(() => {
  const obstacleMask = pathfindingObstacleEdgesActive.value ? activePathfindingBaseObstacleMask.value : undefined;
  if (!obstacleMask || !parsedObstacleTolerances.value.ok) {
    return "";
  }

  return buildObstacleFillPath(
    getCachedRouteMask(obstacleMask, parsedObstacleTolerances.value.simulationTolerancePlanePixels).mask,
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
    ? getCachedRouteMask(obstacleMask, parsedObstacleTolerances.value.simulationTolerancePlanePixels).mask
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
const detectionHeaderStatusIsError = computed(() => detectionHeaderStatusKind.value === "error");
const detectionHeaderStatusIsWarning = computed(() => detectionHeaderStatusKind.value === "warning");
const detectionHeaderStatusIsSuccess = computed(() => detectionHeaderStatusKind.value === "success");
const detectionDebugTimingRows = computed<DetectionDebugTimingRow[]>(() =>
  detectionDebugTimingEntries.value.map((entry) => ({
    ...entry,
    elapsedVisible: shouldShowDetectionDebugElapsed(entry),
    label: getDetectionDebugTimingLabel(entry),
    title: getDetectionDebugTimingTitle(entry),
  })),
);
const smartPathfindingDebugTimingRows = computed<SmartPathfindingDebugTimingRow[]>(() =>
  createSmartPathfindingDebugTimingRows(smartPathfindingDebugTimingEntries.value),
);
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
const pathfindingHeaderStatus = computed(() => pathfindingHeaderStatusResult.value.message);
const pathfindingHeaderStatusTitle = computed(() => pathfindingHeaderStatus.value);
const pathfindingHeaderStatusIsError = computed(() => pathfindingHeaderStatusResult.value.kind === "error");
const pathfindingHeaderStatusIsWarning = computed(() => pathfindingHeaderStatusResult.value.kind === "warning");
const pathfindingHeaderStatusIsSuccess = computed(() => pathfindingHeaderStatusResult.value.kind === "success");

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
const pathLineSegments = computed<PathLineSegment[]>(() => createPathLineSegments(pathPixels.value));
const liveClickPreviewPoint = computed(() => {
  const point = liveClickPreviewPointerPoint.value;
  if (!liveClickPreviewEnabled.value || toolMode.value !== "path" || smartPathfindingInProgress.value || !point) {
    return undefined;
  }
  if (draggingPathPointIndex.value !== undefined || getPathPointIndexAtPoint(point) !== undefined) {
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

  const previewPathPoints = [...pathPixels.value, previewPoint].map((point) =>
    imageToGraphPoint(point, boundsResult.bounds, boundsRect.value),
  );
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
  const segments: PathLineSegment[] = [];
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

/** 获取高精度时间戳，用于前端阶段计时和长按判定。 */
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
  if (boundsFlashFrame !== undefined) {
    cancelAnimationFrame(boundsFlashFrame);
  }
  if (boundsFlashTimer) {
    clearTimeout(boundsFlashTimer);
  }
  if (copyStatusTimer) {
    clearTimeout(copyStatusTimer);
  }
  if (detectionRefreshTimer) {
    clearTimeout(detectionRefreshTimer);
  }
  clearLiveClickPreviewPointerPoint();
  clearDebugActivationHold();
  clearDebugActivationSuccessFlash();
  clearDetectionSoldierFlash();
  if (obstacleEditRefreshTimer) {
    clearTimeout(obstacleEditRefreshTimer);
  }
  clearSmartPathfindingBlockedPoint();
});

/** 高频 pointermove 只保留最新落点，每个浏览器绘制帧最多触发一次轨迹预览重算。 */
function scheduleLiveClickPreviewPointerPoint(point: PixelPoint | undefined) {
  liveClickPreviewPendingPointerPoint = point;
  if (liveClickPreviewPointerFrame !== undefined) {
    return;
  }

  liveClickPreviewPointerFrame = requestAnimationFrame(() => {
    const point = liveClickPreviewPendingPointerPoint;
    liveClickPreviewPointerFrame = undefined;
    liveClickPreviewPendingPointerPoint = undefined;
    liveClickPreviewPointerPoint.value = point;
  });
}

/** 清理悬停预览时取消待执行帧，避免离开舞台或切模式后旧落点回写。 */
function clearLiveClickPreviewPointerPoint() {
  liveClickPreviewPendingPointerPoint = undefined;
  liveClickPreviewPointerPoint.value = undefined;
  if (liveClickPreviewPointerFrame !== undefined) {
    cancelAnimationFrame(liveClickPreviewPointerFrame);
    liveClickPreviewPointerFrame = undefined;
  }
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
  detectedObstacles.value = undefined;
  baselineDetectedObstacles.value = undefined;
  clearDetectionSoldierFlash();
  clearOneClickClearHitFlash();
  obstacleEditsDirty.value = false;
  obstacleBrushPointerPoint.value = undefined;
  obstacleBrushDragging.value = false;
  obstacleBrushLastPlanePoint.value = undefined;
  hoveredDetectedSoldierId.value = undefined;
  clearSmartPathfindingStatus();
  clearObstacleEditRefreshTimer();
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

/** 通过长按高级设置入口启用调试信息，避免普通用户误触。 */
function startDebugActivationHold(event: PointerEvent) {
  if (event.button !== 0) {
    return;
  }
  if (debugInfoEnabled.value) {
    toggleAdvancedSettings();
    return;
  }

  clearDebugActivationHold();
  clearDebugActivationSuccessFlash();
  debugActivationTriggered = false;
  debugActivationStartedAt = nowMs();
  updateDebugActivationCountdown();
  debugActivationCountdownTimer = setInterval(updateDebugActivationCountdown, debugActivationCountdownStepMs);
  debugActivationTimer = setTimeout(() => {
    debugActivationTriggered = true;
    debugInfoEnabled.value = true;
    clearDebugActivationHold();
    flashDebugActivationSuccess();
  }, debugActivationHoldMs);
}

/** 结束调试入口长按；未触发调试时保留普通点击展开设置。 */
function finishDebugActivationHold() {
  const shouldToggleAdvancedSettings =
    !debugInfoEnabled.value && !debugActivationTriggered && debugActivationStartedAt !== undefined;
  clearDebugActivationHold();
  if (shouldToggleAdvancedSettings) {
    toggleAdvancedSettings();
  }
  debugActivationTriggered = false;
}

/** 鼠标移出或取消时终止调试长按流程。 */
function cancelDebugActivationHold() {
  clearDebugActivationHold();
  debugActivationTriggered = false;
}

/** 清理调试长按的定时器和倒计时状态。 */
function clearDebugActivationHold() {
  if (debugActivationTimer) {
    clearTimeout(debugActivationTimer);
    debugActivationTimer = undefined;
  }
  if (debugActivationCountdownTimer) {
    clearInterval(debugActivationCountdownTimer);
    debugActivationCountdownTimer = undefined;
  }
  debugActivationStartedAt = undefined;
  debugActivationRemainingMs.value = undefined;
}

/** 更新调试长按倒计时，只在长按超过提示阈值后显示。 */
function updateDebugActivationCountdown() {
  if (debugActivationStartedAt === undefined) {
    return;
  }

  const elapsedMs = nowMs() - debugActivationStartedAt;
  debugActivationRemainingMs.value =
    elapsedMs < debugActivationCountdownVisibleAfterMs ? undefined : Math.max(0, debugActivationHoldMs - elapsedMs);
}

/** 短暂显示调试模式已启用的成功反馈。 */
function flashDebugActivationSuccess() {
  debugActivationSuccessVisible.value = true;
  if (debugActivationSuccessTimer) {
    clearTimeout(debugActivationSuccessTimer);
  }
  debugActivationSuccessTimer = setTimeout(() => {
    debugActivationSuccessVisible.value = false;
    debugActivationSuccessTimer = undefined;
  }, debugActivationSuccessFlashMs);
}

/** 清理调试启用成功闪烁，防止卸载或重新长按后残留。 */
function clearDebugActivationSuccessFlash() {
  debugActivationSuccessVisible.value = false;
  if (!debugActivationSuccessTimer) {
    return;
  }

  clearTimeout(debugActivationSuccessTimer);
  debugActivationSuccessTimer = undefined;
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
    detectedObstacles.value = result.obstacles;
    baselineDetectedObstacles.value = cloneDetectedObstacleMap(result.obstacles);
    obstacleEditsDirty.value = false;
    obstacleBrushPointerPoint.value = undefined;
    obstacleBrushDragging.value = false;
    obstacleBrushLastPlanePoint.value = undefined;
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

/** 汇总检测调试 timing，并补齐阶段外耗时和总耗时。 */
function finishDetectionDebugTimings(
  runId: number,
  startedAt: number,
  timings: readonly DetectionDebugTimingEntry[],
  completedAt = nowMs(),
) {
  if (!isActiveDetectionRun(runId) || timings.length === 0) {
    return;
  }

  const totalElapsedMs = completedAt - startedAt;
  const measuredStageElapsedMs = timings.reduce((total, timing) => total + (timing.detail ? 0 : timing.elapsedMs), 0);
  detectionDebugTimingEntries.value = [
    ...timings,
    {
      elapsedMs: Math.max(0, totalElapsedMs - measuredStageElapsedMs),
      stage: "outside-stages",
    },
    {
      elapsedMs: totalElapsedMs,
      stage: "total",
    },
  ];
}

/** 将 Worker 返回的 timing 格式转换成页面统一调试条目。 */
function createDetectionDebugTimingEntriesFromWorker(
  timings: readonly GraphwarDetectionWorkerTimingEntry[],
): DetectionDebugTimingEntry[] {
  return timings.map((timing) => ({
    detail: timing.detail,
    elapsedMs: timing.elapsedMs,
    stage: timing.stage,
  }));
}

/** 包装页面侧检测阶段计时，用于调试面板拆分耗时。 */
function measureDetectionDebugStage<TResult>(
  timings: DetectionDebugTimingEntry[],
  stage: DetectionDebugStage,
  task: () => TResult,
) {
  const startedAt = nowMs();
  try {
    return task();
  } finally {
    timings.push({
      elapsedMs: nowMs() - startedAt,
      stage,
    });
  }
}

/** 获取检测调试阶段的短标签。 */
function getDetectionDebugStageLabel(stage: DetectionDebugStage) {
  return locale.ui.detection.debugStages[stage].label;
}

/** 获取检测调试条目的展示标签，细分条目优先使用 detail 标签。 */
function getDetectionDebugTimingLabel(entry: DetectionDebugTimingEntry) {
  return entry.detail ? getDetectionDebugTimingDetailLabel(entry.detail) : getDetectionDebugStageLabel(entry.stage);
}

/** 获取检测调试条目的 title，说明该阶段意图。 */
function getDetectionDebugTimingTitle(entry: DetectionDebugTimingEntry) {
  return entry.detail
    ? locale.ui.detection.debugDetails[entry.detail.type].title
    : locale.ui.detection.debugStages[entry.stage].title;
}

/** 模板匹配模式条目只解释模式，不展示 0ms 耗时。 */
function shouldShowDetectionDebugElapsed(entry: DetectionDebugTimingEntry) {
  return entry.detail?.type !== "template-matching-mode";
}

/** 为不同模板匹配 detail 拼出带 worker 编号或模式的标签。 */
function getDetectionDebugTimingDetailLabel(detail: GraphwarDetectionWorkerTimingDetail) {
  switch (detail.type) {
    case "template-matching-mode":
      return locale.ui.detection.debugDetails[detail.type].label(detail.mode, detail.workerCount);
    case "template-matching-worker":
      return locale.ui.detection.debugDetails[detail.type].label(detail.workerIndex);
    default:
      return locale.ui.detection.debugDetails[detail.type].label;
  }
}

/** 汇总智能寻路 timing，并补齐阶段外耗时和总耗时。 */
function finishSmartPathfindingDebugTimings(
  startedAt: number,
  timings: readonly SmartPathfindingDebugTimingEntry[],
  completedAt = nowMs(),
) {
  if (timings.length === 0) {
    return;
  }

  const totalElapsedMs = completedAt - startedAt;
  const measuredStageElapsedMs = timings.reduce((total, timing) => total + (timing.detail ? 0 : timing.elapsedMs), 0);
  smartPathfindingDebugTimingEntries.value = [
    ...timings,
    {
      elapsedMs: Math.max(0, totalElapsedMs - measuredStageElapsedMs),
      stage: "outside-stages",
    },
    {
      elapsedMs: totalElapsedMs,
      stage: "total",
    },
  ];
}

/** 寻路/清图启动时先清旧日志；预检阶段取消时也不会展示上一轮结果。 */
function clearSmartPathfindingDebugTimings() {
  smartPathfindingDebugTimingEntries.value = [];
}

/** 包装同步智能寻路阶段计时；未启用调试时不产生额外开销。 */
function measureSmartPathfindingDebugStage<TResult>(
  timings: SmartPathfindingDebugTimingEntry[] | undefined,
  stage: SmartPathfindingDebugStage,
  task: () => TResult,
) {
  if (!timings) {
    return task();
  }

  const startedAt = nowMs();
  try {
    return task();
  } finally {
    timings.push({
      elapsedMs: nowMs() - startedAt,
      stage,
    });
  }
}

/** 一键清图内部阶段会在搜索循环里重复发生；调试面板只展示聚合后的耗时。 */
function addOneClickClearSearchDebugTiming(
  timings: SmartPathfindingDebugTimingEntry[],
  timing: GraphwarOneClickClearDebugTiming,
) {
  const detail = timing.detail ?? timing.stage;
  const detailKey = createOneClickClearDebugDetailKey(detail);
  const existing = timings.find(
    (entry) =>
      entry.stage === "one-click-clear-search" &&
      entry.detail !== undefined &&
      createOneClickClearDebugDetailKey(entry.detail) === detailKey,
  );
  if (existing) {
    existing.elapsedMs += timing.elapsedMs;
    return;
  }

  timings.push({
    detail,
    elapsedMs: timing.elapsedMs,
    stage: "one-click-clear-search",
  });
}

function addOneClickClearRouteMaskDebugTiming(
  timings: SmartPathfindingDebugTimingEntry[],
  timing: GraphwarOneClickClearDebugTiming,
) {
  if (timing.stage !== "route-mask-cache-hit" && timing.stage !== "route-mask-cache-miss") {
    return false;
  }

  timings.push({
    elapsedMs: timing.elapsedMs,
    stage:
      timing.stage === "route-mask-cache-hit"
        ? "one-click-clear-route-mask-cache-hit"
        : "one-click-clear-route-mask-cache-miss",
  });
  return true;
}

function addSmartPathfindingWorkerTimings(
  timings: SmartPathfindingDebugTimingEntry[] | undefined,
  workerTimings: GraphwarSmartPathfindingPathResult["timings"],
) {
  if (!timings) {
    return;
  }

  for (const timing of workerTimings) {
    timings.push({
      elapsedMs: timing.elapsedMs,
      stage: timing.stage,
    });
  }
}

function insertDebugTimingsBeforeLastStage(
  timings: SmartPathfindingDebugTimingEntry[],
  stage: SmartPathfindingDebugStage,
  insertedTimings: readonly SmartPathfindingDebugTimingEntry[],
) {
  if (insertedTimings.length === 0) {
    return;
  }

  for (let index = timings.length - 1; index >= 0; index -= 1) {
    if (timings[index]?.stage === stage) {
      timings.splice(index, 0, ...insertedTimings);
      return;
    }
  }
  timings.push(...insertedTimings);
}

function subtractLastDebugStageElapsed(
  timings: SmartPathfindingDebugTimingEntry[],
  stage: SmartPathfindingDebugStage,
  elapsedMs: number,
) {
  if (elapsedMs <= 0) {
    return;
  }

  for (let index = timings.length - 1; index >= 0; index -= 1) {
    const timing = timings[index];
    if (timing?.stage === stage) {
      timing.elapsedMs = Math.max(0, timing.elapsedMs - elapsedMs);
      return;
    }
  }
}

function sumDebugTimingElapsed(timings: readonly SmartPathfindingDebugTimingEntry[]) {
  return timings.reduce((total, timing) => total + timing.elapsedMs, 0);
}

function createOneClickClearDebugDetailKey(detail: GraphwarOneClickClearDebugStage | GraphwarOneClickClearDebugDetail) {
  return typeof detail === "string"
    ? detail
    : `${detail.type}:${detail.type === "dag-edge-worker" ? detail.workerIndex : ""}`;
}

function getOneClickClearDebugDetailOrderKey(
  detail: GraphwarOneClickClearDebugStage | GraphwarOneClickClearDebugDetail,
) {
  return typeof detail === "string" ? detail : detail.type;
}

const ONE_CLICK_CLEAR_SEARCH_DEBUG_DETAIL_ORDER: readonly (
  | GraphwarOneClickClearDebugStage
  | GraphwarOneClickClearDebugDetail["type"]
)[] = [
  "validate-prefix",
  "route-mask-cache-hit",
  "route-mask-cache-miss",
  "build-dag-targets",
  "visibility-cache-hit",
  "visibility-cache-miss",
  "visibility-cache-skipped",
  "build-dag-edges",
  "dag-edge-mode",
  "dag-edge-worker",
  "route-pathfinding",
  "route-map-pixels",
  "dag-longest-path",
  "validate-route",
  "segment-graph-rule",
  "segment-build-formula",
  "segment-sample-trajectory",
  "remove-failed-edge",
  "optimize-path",
  "validate-final",
];

const ONE_CLICK_CLEAR_NESTED_DEBUG_DETAILS = new Set<GraphwarOneClickClearDebugStage>([
  "route-pathfinding",
  "route-map-pixels",
  "segment-graph-rule",
  "segment-build-formula",
  "segment-sample-trajectory",
]);

function createSmartPathfindingDebugTimingRows(
  entries: readonly SmartPathfindingDebugTimingEntry[],
): SmartPathfindingDebugTimingRow[] {
  const rows: SmartPathfindingDebugTimingRow[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) {
      continue;
    }
    if (entry.stage !== "one-click-clear-search" || entry.detail) {
      rows.push(createSmartPathfindingDebugTimingRow(entry));
      continue;
    }

    rows.push(createSmartPathfindingDebugTimingRow(entry));
    const detailEntries: SmartPathfindingDebugTimingEntry[] = [];
    for (index += 1; index < entries.length; index += 1) {
      const detailEntry = entries[index];
      if (detailEntry?.stage !== "one-click-clear-search" || !detailEntry.detail) {
        index -= 1;
        break;
      }
      detailEntries.push(detailEntry);
    }
    rows.push(...sortOneClickClearSearchDebugDetails(detailEntries).map(createSmartPathfindingDebugTimingRow));
  }
  return rows;
}

function createSmartPathfindingDebugTimingRow(entry: SmartPathfindingDebugTimingEntry): SmartPathfindingDebugTimingRow {
  return {
    ...entry,
    elapsedVisible: shouldShowSmartPathfindingDebugElapsed(entry),
    indentLevel: getSmartPathfindingDebugTimingIndentLevel(entry),
    label: getSmartPathfindingDebugTimingLabel(entry),
    title: getSmartPathfindingDebugTimingTitle(entry),
  };
}

function sortOneClickClearSearchDebugDetails(
  entries: readonly SmartPathfindingDebugTimingEntry[],
): SmartPathfindingDebugTimingEntry[] {
  const remaining = [...entries];
  const sorted: SmartPathfindingDebugTimingEntry[] = [];
  for (const detail of ONE_CLICK_CLEAR_SEARCH_DEBUG_DETAIL_ORDER) {
    for (let index = 0; index < remaining.length; ) {
      const entry = remaining[index];
      if (entry?.detail && getOneClickClearDebugDetailOrderKey(entry.detail) === detail) {
        const [matched] = remaining.splice(index, 1);
        if (matched) {
          sorted.push(matched);
        }
        continue;
      }
      index += 1;
    }
  }
  return [...sorted, ...remaining];
}

function getSmartPathfindingDebugTimingIndentLevel(entry: SmartPathfindingDebugTimingEntry) {
  if (!entry.detail) {
    return 0;
  }
  if (typeof entry.detail !== "string") {
    return 2;
  }
  return ONE_CLICK_CLEAR_NESTED_DEBUG_DETAILS.has(entry.detail) ? 2 : 1;
}

function getSmartPathfindingDebugTimingLabel(entry: SmartPathfindingDebugTimingEntry) {
  if (!entry.detail) {
    return getSmartPathfindingDebugStageLabel(entry.stage);
  }
  if (typeof entry.detail === "string") {
    return locale.ui.pathfinding.debugDetails[entry.detail].label;
  }
  if (entry.detail.type === "dag-edge-mode") {
    return locale.ui.pathfinding.debugDetails[entry.detail.type].label(entry.detail.mode, entry.detail.workerCount);
  }
  return locale.ui.pathfinding.debugDetails[entry.detail.type].label(entry.detail.workerIndex);
}

function getSmartPathfindingDebugTimingTitle(entry: SmartPathfindingDebugTimingEntry) {
  if (!entry.detail) {
    return locale.ui.pathfinding.debugStages[entry.stage].title;
  }
  return typeof entry.detail === "string"
    ? locale.ui.pathfinding.debugDetails[entry.detail].title
    : locale.ui.pathfinding.debugDetails[entry.detail.type].title;
}

/** DAG 建边模式条目只解释调度模式，不展示 0ms 耗时。 */
function shouldShowSmartPathfindingDebugElapsed(entry: SmartPathfindingDebugTimingEntry) {
  return !(entry.detail && typeof entry.detail !== "string" && entry.detail.type === "dag-edge-mode");
}

/** 包装异步智能寻路阶段计时，覆盖 worker 和动画让出控制权场景。 */
async function measureSmartPathfindingDebugStageAsync<TResult>(
  timings: SmartPathfindingDebugTimingEntry[] | undefined,
  stage: SmartPathfindingDebugStage,
  task: () => Promise<TResult>,
) {
  if (!timings) {
    return task();
  }

  const startedAt = nowMs();
  try {
    return await task();
  } finally {
    timings.push({
      elapsedMs: nowMs() - startedAt,
      stage,
    });
  }
}

/** 获取智能寻路调试阶段的短标签。 */
function getSmartPathfindingDebugStageLabel(stage: SmartPathfindingDebugStage) {
  return locale.ui.pathfinding.debugStages[stage].label;
}

/** 只展示当前检测运行的真实错误，忽略取消造成的预期异常。 */
function handleGraphwarDetectionError(error: unknown, runId: number) {
  if (!isActiveDetectionRun(runId) || isGraphwarDetectionCancelledError(error)) {
    return;
  }

  setDetectionStatus(locale.status.detection.failed(error instanceof Error ? error.message : String(error)), "error");
}

/** 清理士兵识别闪烁动画，避免下一次检测继承旧动画状态。 */
function clearDetectionSoldierFlash() {
  detectionSoldierFlashActive.value = false;
  if (detectionSoldierFlashFrame !== undefined) {
    cancelAnimationFrame(detectionSoldierFlashFrame);
    detectionSoldierFlashFrame = undefined;
  }
  if (detectionSoldierFlashTimer) {
    clearTimeout(detectionSoldierFlashTimer);
    detectionSoldierFlashTimer = undefined;
  }
}

/** 在检测完成后触发一次士兵标记闪烁，帮助用户定位识别结果。 */
function flashDetectedSoldiers() {
  clearDetectionSoldierFlash();
  if (detectedSoldiers.value.length === 0) {
    return;
  }

  detectionSoldierFlashFrame = requestAnimationFrame(() => {
    detectionSoldierFlashFrame = undefined;
    detectionSoldierFlashActive.value = true;
    detectionSoldierFlashTimer = setTimeout(() => {
      detectionSoldierFlashActive.value = false;
      detectionSoldierFlashTimer = undefined;
    }, detectionFlashAnimationMs);
  });
}

/** 清理一键清图命中闪烁，避免旧结果在下一次操作后继续提示。 */
function clearOneClickClearHitFlash() {
  oneClickClearHitFlashActive.value = false;
  oneClickClearHitFlashSoldiers.value = [];
  if (oneClickClearHitFlashFrame !== undefined) {
    cancelAnimationFrame(oneClickClearHitFlashFrame);
    oneClickClearHitFlashFrame = undefined;
  }
  if (oneClickClearHitFlashTimer) {
    clearTimeout(oneClickClearHitFlashTimer);
    oneClickClearHitFlashTimer = undefined;
  }
}

/** 一键清图完成后只高亮结果里的命中士兵，和全量识别闪烁区分开。 */
function flashOneClickClearHitSoldiers(targetIds: readonly string[]) {
  clearOneClickClearHitFlash();
  const targetIdSet = new Set(targetIds);
  oneClickClearHitFlashSoldiers.value = detectedSoldiers.value.filter((soldier) => targetIdSet.has(soldier.id));
  if (oneClickClearHitFlashSoldiers.value.length === 0) {
    return;
  }

  oneClickClearHitFlashFrame = requestAnimationFrame(() => {
    oneClickClearHitFlashFrame = undefined;
    oneClickClearHitFlashActive.value = true;
    oneClickClearHitFlashTimer = setTimeout(() => {
      oneClickClearHitFlashActive.value = false;
      oneClickClearHitFlashTimer = undefined;
    }, detectionFlashAnimationMs);
  });
}

/** 深拷贝障碍 mask，作为用户编辑前的恢复基线。 */
function cloneDetectedObstacleMap(obstacles: DetectedObstacleMap): DetectedObstacleMap {
  return {
    count: obstacles.count,
    mask: new Uint8Array(obstacles.mask),
  };
}

/** 清理障碍编辑后的延迟统计刷新。 */
function clearObstacleEditRefreshTimer() {
  if (!obstacleEditRefreshTimer) {
    return;
  }

  clearTimeout(obstacleEditRefreshTimer);
  obstacleEditRefreshTimer = undefined;
}

/** 触发一次短暂边界高亮，帮助用户确认自动识别或手动框选结果。 */
function flashBoundsRect() {
  boundsFlashActive.value = false;
  if (boundsFlashFrame !== undefined) {
    cancelAnimationFrame(boundsFlashFrame);
  }
  if (boundsFlashTimer) {
    clearTimeout(boundsFlashTimer);
  }

  boundsFlashFrame = requestAnimationFrame(() => {
    boundsFlashFrame = undefined;
    boundsFlashActive.value = true;
    boundsFlashTimer = setTimeout(() => {
      boundsFlashActive.value = false;
      boundsFlashTimer = undefined;
    }, detectionFlashAnimationMs);
  });
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

/** 从输入框事件提取障碍笔刷直径文本。 */
function handleObstacleBrushDiameterInput(event: Event) {
  const input = event.target;
  if (input instanceof HTMLInputElement) {
    setObstacleBrushDiameterText(input.value);
  }
}

/** 同步放大镜缩放文本，保留非法输入供校验提示展示。 */
function setMagnifierZoomText(value: string) {
  magnifierZoomText.value = value;
}

/** 从输入框事件提取放大镜缩放文本。 */
function handleMagnifierZoomInput(event: Event) {
  const input = event.target;
  if (input instanceof HTMLInputElement) {
    setMagnifierZoomText(input.value);
  }
}

/** 切换障碍笔刷添加/擦除模式。 */
function toggleObstacleBrushErase() {
  obstacleBrushEraseEnabled.value = !obstacleBrushEraseEnabled.value;
}

/** 将障碍 mask 恢复到自动识别后的基线状态。 */
function resetObstacleEdits() {
  const baseline = baselineDetectedObstacles.value;
  if (!baseline) {
    return;
  }

  cancelSmartPathfinding(false);
  clearSmartPathfindingStatus();
  clearObstacleEditRefreshTimer();
  invalidatePathfindingCaches();
  detectedObstacles.value = cloneDetectedObstacleMap(baseline);
  obstacleEditsDirty.value = false;
  setDetectionStatus(locale.status.detection.obstacleEditsCleared(baseline.count), "success");
}

/** 将鼠标位置吸附到 Graphwar 平面 cell 中心，作为笔刷预览点。 */
function updateObstacleBrushPreview(point: PixelPoint) {
  obstacleBrushPointerPoint.value = pointIsInsideBoundsRect(point, boundsRect.value)
    ? planeGridCellCenterToImagePoint(imagePointToPlaneGridPoint(point, boundsRect.value), boundsRect.value)
    : undefined;
}

/** 在障碍 mask 上绘制或擦除笔刷，并可连接上一点形成连续笔画。 */
function paintObstacleBrushAtPoint(point: PixelPoint, connectFromLastPoint = false) {
  const obstacleMap = detectedObstacles.value;
  const brushDiameter = parsedObstacleBrushDiameter.value;
  if (!obstacleMap || !brushDiameter.ok || !pointIsInsideBoundsRect(point, boundsRect.value)) {
    obstacleBrushLastPlanePoint.value = undefined;
    return false;
  }

  cancelSmartPathfinding(false);
  clearSmartPathfindingStatus();
  const center = imagePointToPlaneGridPoint(point, boundsRect.value);
  obstacleBrushPointerPoint.value = planeGridCellCenterToImagePoint(center, boundsRect.value);
  const brushValue = obstacleBrushEraseEnabled.value ? 0 : 1;
  const previousCenter = connectFromLastPoint ? obstacleBrushLastPlanePoint.value : undefined;
  const nextMask = previousCenter
    ? paintObstacleMaskStroke(obstacleMap.mask, previousCenter, center, brushDiameter.diameter, brushValue)
    : paintObstacleMaskDisk(obstacleMap.mask, center, brushDiameter.diameter, brushValue);
  obstacleBrushLastPlanePoint.value = center;
  if (nextMask === obstacleMap.mask) {
    return false;
  }

  invalidatePathfindingCaches();
  detectedObstacles.value = {
    count: obstacleMap.count,
    mask: nextMask,
  };
  obstacleEditsDirty.value = true;
  scheduleObstacleEditRefresh();
  return true;
}

/** 延迟刷新障碍连通域数量，合并连续笔刷操作。 */
function scheduleObstacleEditRefresh() {
  clearObstacleEditRefreshTimer();
  setDetectionStatus(locale.status.detection.updatingObstacleEdits, "warning");
  obstacleEditRefreshTimer = setTimeout(() => {
    obstacleEditRefreshTimer = undefined;
    const obstacles = detectedObstacles.value;
    if (!obstacles) {
      return;
    }
    const count = countObstacleMaskComponents(obstacles.mask);
    detectedObstacles.value = {
      count,
      mask: obstacles.mask,
    };
    setDetectionStatus(locale.status.detection.obstacleEditsApplied(count), "success");
  }, obstacleBrushEditRefreshDelayMs);
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

    obstacleBrushDragging.value = true;
    obstacleBrushLastPlanePoint.value = undefined;
    stageRef.value?.setPointerCapture(event.pointerId);
    paintObstacleBrushAtPoint(point);
    return;
  }

  if (event.button !== 0 || !parsedBounds.value.ok) {
    return;
  }

  clearLiveClickPreviewPointerPoint();
  liveClickPreviewPointerPoint.value = point;
  if (smartPathfindingInProgress.value) {
    updateSmartPathfindingInProgressStatus();
    return;
  }

  const pathPointIndex = getPathPointIndexAtPoint(point);
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
      if (pathfindingToken !== smartPathfindingCancelToken) {
        return false;
      }
    } finally {
      if (pathfindingToken === smartPathfindingCancelToken) {
        smartPathfindingInProgress.value = false;
        clearSmartPathfindingPreview();
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
    if (pathfindingToken !== smartPathfindingCancelToken) {
      return false;
    }
  } finally {
    if (pathfindingToken === smartPathfindingCancelToken) {
      smartPathfindingInProgress.value = false;
      clearSmartPathfindingPreview();
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
    if (pathfindingToken !== smartPathfindingCancelToken) {
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
      routeMaskCacheId: getRouteObstacleMaskCacheId(preflightResult.obstacleMask),
      routeObstacleMask: preflightResult.obstacleMask,
      routeTolerancePlanePixels: routeTolerance,
      settings: createPathTrajectoryFormulaSettings(),
      simulationBoundaryExpansion: preflightResult.tolerances.boundaryExpansionPlanePixels,
      simulationMask: simulationObstacleMask.value,
    };
    const searchCacheKey = createOneClickClearResultCacheKey(searchInput);
    let search = getCachedOneClickClearResult(searchCacheKey, timings);
    const searchCacheHit = search !== undefined;
    if (!search) {
      search = await measureSmartPathfindingDebugStageAsync(timings, "one-click-clear-search", () =>
        graphwarPathfindingRunner.buildOneClickClearPath(searchInput),
      );
      cacheOneClickClearResult(searchCacheKey, search);
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
    if (pathfindingToken !== smartPathfindingCancelToken) {
      return false;
    }

    const result = search.result;
    smartPathfindingInProgress.value = false;
    clearSmartPathfindingPreview();
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
    if (pathfindingToken !== smartPathfindingCancelToken || isGraphwarPathfindingCancelledError(error)) {
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
    if (pathfindingToken === smartPathfindingCancelToken) {
      smartPathfindingInProgress.value = false;
      clearSmartPathfindingPreview();
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
  if (cancelToken !== smartPathfindingCancelToken) {
    return undefined;
  }

  const routeTolerance = tolerances.routePlanningTolerancePlanePixels;
  const input: GraphwarSmartPathfindingPathInput = {
    boundaryExpansion: tolerances.boundaryExpansionPlanePixels,
    bounds: boundsResult.bounds,
    boundsRect: boundsRect.value,
    hitTarget: createSmartPathfindingHitTarget(hitTarget),
    previewEnabled: searchAnimationEnabled.value,
    routeMaskCacheId: getRouteObstacleMaskCacheId(obstacleMask),
    routeObstacleMask: obstacleMask,
    routeTolerancePlanePixels: routeTolerance,
    settings: createPathTrajectoryFormulaSettings(),
    simulationBoundaryExpansion: tolerances.boundaryExpansionPlanePixels,
    simulationMask: simulationObstacleMask.value,
    sourcePath,
    targetPoint,
  };
  const resultCacheKey = createSmartPathfindingResultCacheKey(input);
  let result = getCachedSmartPathfindingResult(resultCacheKey, timings);
  const resultCacheHit = result !== undefined;
  try {
    if (!result) {
      result = await graphwarPathfindingRunner.findSmartPath(input, {
        onPreview: searchAnimationEnabled.value ? setSmartPathfindingPreview : undefined,
      });
      cacheSmartPathfindingResult(resultCacheKey, result);
    }
  } catch (error) {
    if (cancelToken !== smartPathfindingCancelToken || isGraphwarPathfindingCancelledError(error)) {
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

/** 查询普通寻路完整结果缓存；命中时不再向 worker 发送任务。 */
function getCachedSmartPathfindingResult(cacheKey: string, timings: SmartPathfindingDebugTimingEntry[] | undefined) {
  const startedAt = nowMs();
  const cached = smartPathfindingResultCache.get(cacheKey);
  timings?.push({
    elapsedMs: nowMs() - startedAt,
    stage: cached ? "result-cache-hit" : "result-cache-miss",
  });
  return cached ? cloneSmartPathfindingPathResult(cached) : undefined;
}

/** 保存普通寻路完整结果；worker 内部细分 timing 不进入结果缓存，避免命中时展示旧耗时。 */
function cacheSmartPathfindingResult(cacheKey: string, result: GraphwarSmartPathfindingPathResult) {
  setBoundedResultCacheEntry(
    smartPathfindingResultCache,
    cacheKey,
    cloneSmartPathfindingPathResultWithoutTimings(result),
    smartPathfindingResultCacheLimit,
  );
}

/** 查询一键清图完整结果缓存；命中时跳过 master worker 和 DAG 子 worker。 */
function getCachedOneClickClearResult(cacheKey: string, timings: SmartPathfindingDebugTimingEntry[] | undefined) {
  const startedAt = nowMs();
  const cached = oneClickClearResultCache.get(cacheKey);
  timings?.push({
    elapsedMs: nowMs() - startedAt,
    stage: cached ? "one-click-clear-result-cache-hit" : "one-click-clear-result-cache-miss",
  });
  return cached ? cloneOneClickClearPathWorkerResult(cached) : undefined;
}

/** 保存一键清图完整结果；只缓存业务结果，debug timing 由缓存命中阶段重新记录。 */
function cacheOneClickClearResult(cacheKey: string, result: GraphwarOneClickClearPathWorkerResult) {
  setBoundedResultCacheEntry(
    oneClickClearResultCache,
    cacheKey,
    cloneOneClickClearPathWorkerResultWithoutTimings(result),
    oneClickClearResultCacheLimit,
  );
}

/** 结果缓存按 FIFO 做小容量上限，避免连续尝试大量目标时长期持有大路径数组。 */
function setBoundedResultCacheEntry<TResult>(
  cache: Map<string, TResult>,
  cacheKey: string,
  result: TResult,
  limit: number,
) {
  if (cache.has(cacheKey)) {
    cache.delete(cacheKey);
  }
  cache.set(cacheKey, result);
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") {
      return;
    }
    cache.delete(oldestKey);
  }
}

function createSmartPathfindingResultCacheKey(input: GraphwarSmartPathfindingPathInput) {
  return JSON.stringify([
    "smart-path-result-v1",
    createGraphBoundsCacheKey(input.bounds),
    createBoundsRectCacheKey(input.boundsRect),
    input.boundaryExpansion,
    input.routeMaskCacheId,
    input.routeTolerancePlanePixels,
    input.simulationBoundaryExpansion,
    getOptionalMaskCacheId(input.simulationMask),
    createTrajectorySettingsCacheKey(input.settings),
    createPointArrayCacheKey(input.sourcePath),
    createPointCacheKey(input.targetPoint),
    createTargetCircleCacheKey(input.hitTarget),
  ]);
}

function createOneClickClearResultCacheKey(input: GraphwarOneClickClearPathWorkerInput) {
  return JSON.stringify([
    "one-click-clear-result-v1",
    createGraphBoundsCacheKey(input.bounds),
    createBoundsRectCacheKey(input.boundsRect),
    input.boundaryExpansion,
    input.deleteCheckRadiusPixels,
    input.routeMaskCacheId,
    input.routeTolerancePlanePixels,
    input.simulationBoundaryExpansion,
    getOptionalMaskCacheId(input.simulationMask),
    createTrajectorySettingsCacheKey(input.settings),
    createPointArrayCacheKey(input.pathPoints),
    input.prefixTarget ? createTargetCircleCacheKey(input.prefixTarget) : undefined,
    input.candidates.map(createOneClickClearCandidateCacheKey),
    input.hitCandidates.map(createOneClickClearCandidateCacheKey),
  ]);
}

function createGraphBoundsCacheKey(bounds: GraphBounds) {
  return [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY];
}

function createBoundsRectCacheKey(rect: BoundsRect) {
  return [rect.x, rect.y, rect.width, rect.height];
}

function createPointCacheKey(point: PixelPoint) {
  return [point.x, point.y];
}

function createPointArrayCacheKey(points: readonly PixelPoint[]) {
  return points.map(createPointCacheKey);
}

function createTargetCircleCacheKey(target: { center: PixelPoint; radius: number }) {
  return [createPointCacheKey(target.center), target.radius];
}

function createTrajectorySettingsCacheKey(settings: GraphwarTrajectoryFormulaSettings) {
  return [
    settings.algorithm,
    settings.decimalPlaces,
    settings.equation,
    settings.formulaPathSteepness,
    settings.steepness,
    settings.stepOverflowProtection,
  ];
}

function createOneClickClearCandidateCacheKey(candidate: GraphwarOneClickClearCandidate) {
  return [candidate.id, candidate.enemy, createPointCacheKey(candidate.hitCenter), candidate.hitRadius];
}

function getOptionalMaskCacheId(mask: Uint8Array | undefined) {
  return mask ? getRouteObstacleMaskCacheId(mask) : 0;
}

function cloneSmartPathfindingPathResultWithoutTimings(result: GraphwarSmartPathfindingPathResult) {
  return {
    ...cloneSmartPathfindingPathResult(result),
    timings: [],
  };
}

function cloneSmartPathfindingPathResult(
  result: GraphwarSmartPathfindingPathResult,
): GraphwarSmartPathfindingPathResult {
  return {
    ...(result.blockedPoint ? { blockedPoint: clonePixelPoint(result.blockedPoint) } : {}),
    ...(result.failureReason ? { failureReason: result.failureReason } : {}),
    ...(result.path ? { path: result.path.map(clonePixelPoint) } : {}),
    timings: result.timings.map((timing) => ({
      elapsedMs: timing.elapsedMs,
      stage: timing.stage,
    })),
  };
}

function cloneOneClickClearPathWorkerResultWithoutTimings(result: GraphwarOneClickClearPathWorkerResult) {
  return {
    result: cloneOneClickClearResult(result.result),
    timings: [],
  };
}

function cloneOneClickClearPathWorkerResult(
  result: GraphwarOneClickClearPathWorkerResult,
): GraphwarOneClickClearPathWorkerResult {
  return {
    result: cloneOneClickClearResult(result.result),
    timings: result.timings.map((timing) => ({
      detail: timing.detail,
      elapsedMs: timing.elapsedMs,
      stage: timing.stage,
    })),
  };
}

function cloneOneClickClearResult(result: GraphwarOneClickClearPathWorkerResult["result"]) {
  if (result.type === "success") {
    return {
      elapsedMs: result.elapsedMs,
      expandedStates: result.expandedStates,
      pathPoints: result.pathPoints.map(clonePixelPoint),
      targetIds: [...result.targetIds],
      targetSequence: result.targetSequence.map(cloneTargetCircle),
      type: result.type,
    };
  }

  return {
    elapsedMs: result.elapsedMs,
    expandedStates: result.expandedStates,
    reason: result.reason,
    type: result.type,
  };
}

function cloneTargetCircle(target: { center: PixelPoint; radius: number }) {
  return {
    center: clonePixelPoint(target.center),
    radius: target.radius,
  };
}

function clonePixelPoint(point: PixelPoint) {
  return createPixelPoint(point.x, point.y);
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

/** 复用友方士兵写入后的 base mask，避免路径写回后仅因 computed 重跑而丢失可视图缓存。 */
function getCachedFriendlyObstacleMask(
  sourceMask: Uint8Array,
  edgeRect: BoundsRect,
  friendlySoldiers: readonly DetectionBox[],
  markerRadius: number,
) {
  const key = createFriendlyObstacleMaskCacheKey(edgeRect, friendlySoldiers, markerRadius);
  const cached = friendlyObstacleMaskCache.get(sourceMask);
  if (cached?.key === key) {
    return cached.mask;
  }

  const mask = new Uint8Array(sourceMask);
  addSoldierAreasToObstacleMask(mask, edgeRect, friendlySoldiers, markerRadius);
  friendlyObstacleMaskCache.set(sourceMask, {
    key,
    mask,
  });
  return mask;
}

/** 输入相同才复用派生 mask；士兵写入顺序不影响结果，因此按稳定 key 排序。 */
function createFriendlyObstacleMaskCacheKey(
  edgeRect: BoundsRect,
  friendlySoldiers: readonly DetectionBox[],
  markerRadius: number,
) {
  const soldierKeys = friendlySoldiers.map(createFriendlySoldierObstacleMaskCacheKey).sort();
  return [edgeRect.x, edgeRect.y, edgeRect.width, edgeRect.height, markerRadius, ...soldierKeys].join("|");
}

function createFriendlySoldierObstacleMaskCacheKey(soldier: DetectionBox) {
  return [soldier.id, soldier.sourceCenterX, soldier.sourceCenterY, soldier.hitRadius].join(":");
}

/** 获取指定 route tolerance 的寻路 mask。 */
function getCachedRouteMask(mask: Uint8Array, routeTolerance: number): RouteMaskCacheEntry {
  return getCachedRouteMaskWithStatus(mask, routeTolerance).entry;
}

function getRouteObstacleMaskCacheId(mask: Uint8Array) {
  const cached = routeObstacleMaskIds.get(mask);
  if (cached !== undefined) {
    return cached;
  }

  const id = nextRouteMaskCacheId;
  nextRouteMaskCacheId += 1;
  routeObstacleMaskIds.set(mask, id);
  return id;
}

function getCachedRouteMaskWithStatus(mask: Uint8Array, routeTolerance: number) {
  const key = createRouteMaskCacheKey(routeTolerance);
  let entries = routeMaskCache.get(mask);
  if (!entries) {
    entries = new Map<string, RouteMaskCacheEntry>();
    routeMaskCache.set(mask, entries);
  }

  const cached = entries.get(key);
  if (cached) {
    return {
      cacheHit: true,
      entry: cached,
    };
  }

  const entry: RouteMaskCacheEntry = {
    id: getRouteObstacleMaskCacheId(mask),
    mask: dilateObstacleMask(mask, routeTolerance),
  };
  entries.set(key, entry);
  return {
    cacheHit: false,
    entry,
  };
}

/** 开始一次异步寻路/清图任务并返回取消 token。 */
function startSmartPathfinding(message?: string) {
  graphwarPathfindingRunner.cancel();
  smartPathfindingCancelToken += 1;
  smartPathfindingInProgress.value = true;
  activeSmartPathfindingPhase.value = "search";
  clearSmartPathfindingPreview();
  pathStatus.value = "";
  setSmartPathfindingStatus(message ?? getSmartPathfindingInProgressMessage(), "warning");
  return smartPathfindingCancelToken;
}

/** 取消 token 同时覆盖智能寻路和一键清图，避免旧 async 结果回写当前页面状态。 */
function cancelSmartPathfinding(showStatus: boolean) {
  if (!smartPathfindingInProgress.value) {
    return false;
  }

  smartPathfindingCancelToken += 1;
  graphwarPathfindingRunner.cancel();
  smartPathfindingInProgress.value = false;
  clearSmartPathfindingPreview();
  if (showStatus) {
    setSmartPathfindingStatus(getSmartPathfindingCancelledMessage(), "warning");
  }
  return true;
}

/** 更新智能寻路状态文案和等级。 */
function setSmartPathfindingStatus(message: string, kind: SmartPathfindingStatusKind) {
  smartPathfindingStatus.value = message;
  smartPathfindingStatusKind.value = kind;
}

/** 更新智能寻路阶段，并同步刷新进行中文案。 */
function setSmartPathfindingPhase(phase: SmartPathfindingPhase) {
  activeSmartPathfindingPhase.value = phase;
  updateSmartPathfindingInProgressStatus();
}

/** 在智能寻路进行中刷新阶段文案。 */
function updateSmartPathfindingInProgressStatus() {
  if (smartPathfindingInProgress.value && pathfindingMode.value === "smart") {
    setSmartPathfindingStatus(getSmartPathfindingInProgressMessage(), "warning");
  }
}

/** 清空智能寻路状态文案。 */
function clearSmartPathfindingStatus() {
  setSmartPathfindingStatus("", "info");
}

/** 清空页面侧完整结果缓存；用于输入语义换代，不用于普通路径清空。 */
function invalidatePathfindingResultCache() {
  smartPathfindingResultCache.clear();
  oneClickClearResultCache.clear();
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
  smartPathfindingPreviewPath.value = [...points];
}

/** 清理图搜索过程中的候选点、当前点和可见边预览。 */
function clearSmartPathfindingSearchPreview() {
  smartPathfindingPreviewAcceptedEdges.value = [];
  smartPathfindingPreviewCurrentPoint.value = undefined;
  smartPathfindingPreviewPoints.value = [];
}

/** 短暂标记阻止启动智能寻路的当前轨迹撞击位置。 */
function flashSmartPathfindingBlockedPoint(point: PixelPoint | undefined) {
  clearSmartPathfindingBlockedPoint();
  if (!point) {
    return;
  }

  smartPathfindingBlockedPoint.value = point;
  smartPathfindingBlockedPointTimer = setTimeout(() => {
    smartPathfindingBlockedPoint.value = undefined;
    smartPathfindingBlockedPointTimer = undefined;
  }, smartPathfindingBlockedPointFlashMs);
}

/** 清理当前路径预检的撞击点标记。 */
function clearSmartPathfindingBlockedPoint() {
  if (smartPathfindingBlockedPointTimer) {
    clearTimeout(smartPathfindingBlockedPointTimer);
    smartPathfindingBlockedPointTimer = undefined;
  }
  smartPathfindingBlockedPoint.value = undefined;
}

/** 设置寻路起点到目标的直线连接预览。 */
function setSmartPathfindingPreviewConnection(startPoint: PixelPoint, targetPoint: PixelPoint) {
  smartPathfindingPreviewConnection.value = createPathLineSegment(startPoint, targetPoint);
}

/** 创建 SVG 线段 DTO。 */
function createPathLineSegment(startPoint: PixelPoint, targetPoint: PixelPoint): PathLineSegment {
  return {
    x1: startPoint.x,
    y1: startPoint.y,
    x2: targetPoint.x,
    y2: targetPoint.y,
  };
}

/** 把共享寻路模块的图搜索快照投影回截图，用于搜索动画。 */
function setSmartPathfindingPreview({
  acceptedEdges,
  bestPath,
  candidates,
  current,
  mirrored,
}: GraphwarPathfindingPreview) {
  smartPathfindingPreviewAcceptedEdges.value = acceptedEdges.map(([start, end]) =>
    createPathLineSegment(previewPlanePointToImagePoint(start, mirrored), previewPlanePointToImagePoint(end, mirrored)),
  );
  smartPathfindingPreviewCurrentPoint.value = current ? previewPlanePointToImagePoint(current, mirrored) : undefined;
  smartPathfindingPreviewPoints.value = candidates.map((point) => previewPlanePointToImagePoint(point, mirrored));
  smartPathfindingPreviewPath.value = bestPath.map((point) => previewPlanePointToImagePoint(point, mirrored));
}

/** 将搜索坐标系里的平面点投影成截图像素点。 */
function previewPlanePointToImagePoint(point: PlaneGridPoint, mirrored: boolean) {
  return planeGridCellCenterToImagePoint(mirrorPlaneGridPoint(point, mirrored), boundsRect.value);
}

/** 清理智能寻路相关视觉状态。 */
function clearSmartPathfindingPreview() {
  smartPathfindingPreviewConnection.value = undefined;
  clearSmartPathfindingSearchPreview();
  smartPathfindingPreviewPath.value = [];
  pathfindingOptimizationPreviewPoint.value = undefined;
  clearSmartPathfindingBlockedPoint();
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

/** 处理坐标输入框变更，合法数字会立即映射回截图像素更新路径。 */
function handlePathPointCoordinateInput(index: number, axis: PathPointCoordinateAxis, event: Event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  setPathPointCoordinateText(index, axis, input.value);
  const coordinate = parseFiniteNumber(input.value);
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
  if (toolMode.value === "path") {
    scheduleLiveClickPreviewPointerPoint(point);
  } else {
    clearLiveClickPreviewPointerPoint();
  }
  if (draggingPathPointIndex.value !== undefined) {
    hoveredPathPointIndex.value = draggingPathPointIndex.value;
    setPathPoint(draggingPathPointIndex.value, point);
    return;
  }
  hoveredPathPointIndex.value = getPathPointIndexAtPoint(point);
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
  obstacleBrushPointerPoint.value = undefined;
  obstacleBrushDragging.value = false;
  obstacleBrushLastPlanePoint.value = undefined;
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
  if (obstacleBrushDragging.value) {
    obstacleBrushDragging.value = false;
    obstacleBrushLastPlanePoint.value = undefined;
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
  obstacleBrushPointerPoint.value = undefined;
  obstacleBrushDragging.value = false;
  obstacleBrushLastPlanePoint.value = undefined;
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
    <section
      class="graphwar-killer__panel"
      aria-labelledby="graphwar-killer-settings-title"
    >
      <div class="graphwar-killer__label-row">
        <h2 id="graphwar-killer-settings-title">
          {{ locale.ui.settings.title }}
        </h2>
        <span
          :title="settingsHeaderStatus"
          :class="{
            'graphwar-killer__label-status--error': settingsHeaderStatusIsError,
            'graphwar-killer__label-status--warning': settingsHeaderStatusIsWarning,
            'graphwar-killer__label-status--success': settingsHeaderStatusIsSuccess,
          }"
        >
          {{ settingsHeaderStatus }}
        </span>
      </div>
      <div class="graphwar-killer__setting-row">
        <span class="graphwar-killer__setting-label">{{ locale.ui.settings.mode }}</span>
        <div
          class="graphwar-killer__tool-toggle graphwar-killer__mode-toggle"
          :class="{ 'graphwar-killer__mode-toggle--simulator': toolWorkflowMode === 'simulator' }"
          role="group"
          :aria-label="locale.ui.settings.modeAriaLabel"
          :title="locale.ui.settings.modeTitle"
        >
          <button
            v-for="mode in toolWorkflowModes"
            :key="mode.value"
            type="button"
            :aria-pressed="toolWorkflowMode === mode.value"
            :class="{ 'graphwar-killer__tool-toggle-button--active': toolWorkflowMode === mode.value }"
            :title="mode.title"
            @click="setToolWorkflowMode(mode.value)"
          >
            {{ mode.label }}
          </button>
        </div>
      </div>
      <div
        v-if="toolWorkflowMode !== 'simulator'"
        class="graphwar-killer__setting-row"
      >
        <span class="graphwar-killer__setting-label">{{ locale.ui.settings.algorithm }}</span>
        <div
          class="graphwar-killer__tool-toggle graphwar-killer__algorithm-toggle"
          :class="`graphwar-killer__algorithm-toggle--${algorithmMode}`"
          role="group"
          :aria-label="locale.ui.settings.algorithmAriaLabel"
          :title="locale.ui.settings.algorithmTitle"
        >
          <button
            v-for="mode in algorithmModes"
            :key="mode.value"
            type="button"
            :aria-pressed="algorithmMode === mode.value"
            :class="{ 'graphwar-killer__tool-toggle-button--active': algorithmMode === mode.value }"
            :title="mode.title"
            @click="algorithmMode = mode.value"
          >
            {{ mode.label }}
          </button>
        </div>
      </div>
      <div
        v-if="toolWorkflowMode !== 'simulator' && algorithmMode === 'step'"
        class="graphwar-killer__step-settings"
      >
        <label
          class="graphwar-killer__steepness-label"
          :title="locale.ui.settings.stepSteepnessTitle"
        >
          {{ locale.ui.settings.stepSteepness }}
          <input
            v-model="steepnessText"
            inputmode="decimal"
            autocomplete="off"
            :aria-label="locale.ui.settings.stepSteepnessAriaLabel"
            :title="locale.ui.settings.stepSteepnessTitle"
          >
        </label>
        <button
          type="button"
          :aria-pressed="stepOverflowProtectionEnabled"
          :class="{ 'graphwar-killer__toggle-button--active': stepOverflowProtectionEnabled }"
          :title="locale.ui.settings.overflowProtectionTitle"
          @click="stepOverflowProtectionEnabled = !stepOverflowProtectionEnabled"
        >
          {{ locale.ui.settings.overflowProtection }}
        </button>
      </div>
      <div class="graphwar-killer__setting-row graphwar-killer__game-mode-row">
        <span class="graphwar-killer__setting-label">{{ locale.ui.settings.gameMode }}</span>
        <div class="graphwar-killer__game-mode-controls">
          <div
            class="graphwar-killer__equation-toggle"
            :class="{
              'graphwar-killer__equation-toggle--dy': equationMode === 'dy',
              'graphwar-killer__equation-toggle--ddy': equationMode === 'ddy',
            }"
            role="group"
            :aria-label="locale.ui.settings.gameModeAriaLabel"
            :title="locale.ui.settings.gameModeTitle"
          >
            <button
              v-for="mode in equationModes"
              :key="mode.value"
              type="button"
              :aria-pressed="equationMode === mode.value"
              :class="{ 'graphwar-killer__equation-toggle-button--active': equationMode === mode.value }"
              :disabled="isEquationModeDisabled(mode.value)"
              :title="mode.title"
              @click="setEquationMode(mode.value)"
            >
              {{ mode.label }}
            </button>
          </div>
          <label
            v-if="toolWorkflowMode !== 'simulator'"
            class="graphwar-killer__precision-label"
            :title="locale.ui.settings.decimalPlacesTitle"
          >
            {{ locale.ui.settings.decimalPlaces }}
            <input
              v-model="precisionText"
              inputmode="numeric"
              autocomplete="off"
              min="0"
              :max="MAX_FORMULA_DECIMAL_PLACES"
              :aria-label="locale.ui.settings.decimalPlacesAriaLabel"
              :title="locale.ui.settings.decimalPlacesTitle"
            >
          </label>
          <button
            type="button"
            class="graphwar-killer__secondary-button"
            :aria-expanded="advancedSettingsVisible"
            :aria-pressed="advancedSettingsVisible"
            :class="{ 'graphwar-killer__toggle-button--active': advancedSettingsVisible }"
            @keydown.enter.prevent="toggleAdvancedSettings"
            @keydown.space.prevent="toggleAdvancedSettings"
            @pointercancel="cancelDebugActivationHold"
            @pointerdown.prevent="startDebugActivationHold"
            @pointerleave="cancelDebugActivationHold"
            @pointerup.prevent="finishDebugActivationHold"
          >
            {{ locale.ui.settings.advancedSettings }}
          </button>
        </div>
      </div>
    </section>
    <section
      v-if="advancedSettingsVisible"
      class="graphwar-killer__panel"
      aria-labelledby="graphwar-killer-advanced-settings-title"
    >
      <div class="graphwar-killer__label-row">
        <h2 id="graphwar-killer-advanced-settings-title">
          {{ locale.ui.settings.advancedSettings }}
        </h2>
      </div>
      <div class="graphwar-killer__advanced-settings-grid">
        <div class="graphwar-killer__subpanel graphwar-killer__advanced-settings-group">
          <h3>
            {{ locale.ui.settings.bounds.heading }}
          </h3>
          <div class="graphwar-killer__coordinate-grid">
            <label :title="locale.ui.settings.bounds.minXTitle">
              -x
              <input
                v-model="minXText"
                inputmode="decimal"
                autocomplete="off"
                :aria-label="locale.ui.settings.bounds.minXAriaLabel"
                :title="locale.ui.settings.bounds.minXTitle"
              >
            </label>
            <label :title="locale.ui.settings.bounds.maxXTitle">
              +x
              <input
                v-model="maxXText"
                inputmode="decimal"
                autocomplete="off"
                :aria-label="locale.ui.settings.bounds.maxXAriaLabel"
                :title="locale.ui.settings.bounds.maxXTitle"
              >
            </label>
            <label :title="locale.ui.settings.bounds.minYTitle">
              -y
              <input
                v-model="minYText"
                inputmode="decimal"
                autocomplete="off"
                :aria-label="locale.ui.settings.bounds.minYAriaLabel"
                :title="locale.ui.settings.bounds.minYTitle"
              >
            </label>
            <label :title="locale.ui.settings.bounds.maxYTitle">
              +y
              <input
                v-model="maxYText"
                inputmode="decimal"
                autocomplete="off"
                :aria-label="locale.ui.settings.bounds.maxYAriaLabel"
                :title="locale.ui.settings.bounds.maxYTitle"
              >
            </label>
          </div>
        </div>
        <div class="graphwar-killer__subpanel graphwar-killer__advanced-settings-group">
          <h3>
            {{ locale.ui.settings.simulator }}
          </h3>
          <div class="graphwar-killer__image-actions">
            <button
              type="button"
              :aria-pressed="simulatorSkipUnknownCharacters"
              :class="{ 'graphwar-killer__toggle-button--active': simulatorSkipUnknownCharacters }"
              :title="locale.ui.settings.skipUnknownCharactersTitle"
              @click="simulatorSkipUnknownCharacters = !simulatorSkipUnknownCharacters"
            >
              {{ locale.ui.settings.skipUnknownCharacters }}
            </button>
            <button
              type="button"
              :aria-pressed="simulatorParseDerivativeAsY"
              :class="{ 'graphwar-killer__toggle-button--active': simulatorParseDerivativeAsY }"
              :title="locale.ui.settings.parseDerivativeAsYTitle"
              @click="simulatorParseDerivativeAsY = !simulatorParseDerivativeAsY"
            >
              {{ locale.ui.settings.parseDerivativeAsY }}
            </button>
          </div>
        </div>
        <div class="graphwar-killer__subpanel graphwar-killer__advanced-settings-group">
          <h3>
            {{ locale.ui.settings.recognition.heading }}
          </h3>
          <div class="graphwar-killer__recognition-setting-row">
            <label
              class="graphwar-killer__detection-setting-label"
              :title="locale.ui.settings.recognition.maximumSoldierCountTitle"
            >
              {{ locale.ui.settings.recognition.maximumSoldierCount }}
              <input
                v-model="maximumSoldierCountText"
                inputmode="numeric"
                min="1"
                autocomplete="off"
                :aria-label="locale.ui.settings.recognition.maximumSoldierCountAriaLabel"
                :title="locale.ui.settings.recognition.maximumSoldierCountTitle"
              >
            </label>
            <label
              class="graphwar-killer__detection-setting-label"
              :title="locale.ui.settings.recognition.candidateTopRatioTitle"
            >
              {{ locale.ui.settings.recognition.candidateTopRatio }}
              <input
                v-model="soldierTemplateCandidateTopRatioText"
                inputmode="decimal"
                min="0.000001"
                max="1"
                step="0.01"
                autocomplete="off"
                :aria-label="locale.ui.settings.recognition.candidateTopRatioAriaLabel"
                :title="locale.ui.settings.recognition.candidateTopRatioTitle"
              >
            </label>
            <label
              class="graphwar-killer__detection-setting-label"
              :title="locale.ui.settings.recognition.templateMatchingWorkerCountTitle"
            >
              {{ locale.ui.settings.recognition.templateMatchingWorkerCount }}
              <input
                v-model="templateMatchingWorkerCountText"
                inputmode="numeric"
                min="1"
                max="128"
                autocomplete="off"
                :aria-label="locale.ui.settings.recognition.templateMatchingWorkerCountAriaLabel"
                :title="locale.ui.settings.recognition.templateMatchingWorkerCountTitle"
              >
            </label>
            <label
              class="graphwar-killer__detection-setting-label"
              :title="locale.ui.detection.minObstacleAreaTitle"
            >
              {{ locale.ui.detection.minObstacleArea }}
              <input
                v-model="obstacleMinAreaText"
                inputmode="numeric"
                min="0"
                :max="graphwarObstacleMaxArea"
                :aria-label="locale.ui.detection.minObstacleAreaAriaLabel"
                :title="locale.ui.detection.minObstacleAreaTitle"
              >
              <span>px²</span>
            </label>
            <label
              class="graphwar-killer__detection-setting-label"
              :title="locale.ui.pathfinding.boundaryExpansionTitle"
            >
              {{ locale.ui.pathfinding.boundaryExpansion }}
              <input
                v-model="pathfindingBoundaryExpansionText"
                inputmode="decimal"
                min="0"
                :aria-label="locale.ui.pathfinding.boundaryExpansionAriaLabel"
                :title="locale.ui.pathfinding.boundaryExpansionTitle"
              >
              <span>{{ locale.ui.pathfinding.unit }}</span>
            </label>
          </div>
        </div>
        <div class="graphwar-killer__subpanel graphwar-killer__advanced-settings-group">
          <h3>
            {{ locale.ui.settings.pathfinding.heading }}
          </h3>
          <details class="graphwar-killer__details">
            <summary
              id="graphwar-killer-obstacle-expansion-title"
              :title="locale.ui.pathfinding.obstacleExpansionTitle"
            >
              {{ locale.ui.pathfinding.obstacleExpansion }}
            </summary>
            <div class="graphwar-killer__pathfinding-setting-grid">
              <label
                class="graphwar-killer__detection-setting-label graphwar-killer__pathfinding-setting-label"
                :title="locale.ui.pathfinding.routePlanningToleranceTitle"
              >
                {{ locale.ui.pathfinding.routePlanningTolerance }}
                <input
                  v-model="routePlanningToleranceText"
                  inputmode="decimal"
                  :aria-label="locale.ui.pathfinding.routePlanningToleranceAriaLabel"
                  :title="locale.ui.pathfinding.routePlanningToleranceTitle"
                >
                <span>{{ locale.ui.pathfinding.unit }}</span>
              </label>
              <label
                class="graphwar-killer__detection-setting-label graphwar-killer__pathfinding-setting-label"
                :title="locale.ui.pathfinding.simulationToleranceTitle"
              >
                {{ locale.ui.pathfinding.simulationTolerance }}
                <input
                  v-model="obstacleSimulationToleranceText"
                  inputmode="decimal"
                  :aria-label="locale.ui.pathfinding.simulationToleranceAriaLabel"
                  :title="locale.ui.pathfinding.simulationToleranceTitle"
                >
                <span>{{ locale.ui.pathfinding.unit }}</span>
              </label>
            </div>
          </details>
          <label
            class="graphwar-killer__detection-setting-label graphwar-killer__pathfinding-setting-label"
            :title="locale.ui.settings.pathfinding.workerCountTitle"
          >
            {{ locale.ui.settings.pathfinding.workerCount }}
            <input
              v-model="pathfindingWorkerCountText"
              inputmode="numeric"
              min="1"
              max="128"
              autocomplete="off"
              :aria-label="locale.ui.settings.pathfinding.workerCountAriaLabel"
              :title="locale.ui.settings.pathfinding.workerCountTitle"
            >
          </label>
          <label
            class="graphwar-killer__detection-setting-label graphwar-killer__pathfinding-setting-label"
            :title="locale.ui.pathfinding.oneClickClearDeleteCheckRadiusTitle"
          >
            {{ locale.ui.pathfinding.oneClickClearDeleteCheckRadius }}
            <input
              v-model="oneClickClearDeleteCheckRadiusText"
              inputmode="decimal"
              :min="oneClickClearDeleteCheckRadiusMinimumPixels"
              :max="soldierMarkerRadius"
              step="0.1"
              :aria-label="locale.ui.pathfinding.oneClickClearDeleteCheckRadiusAriaLabel"
              :title="locale.ui.pathfinding.oneClickClearDeleteCheckRadiusTitle"
            >
            <span>{{ locale.ui.pathfinding.unit }}</span>
          </label>
        </div>
      </div>
    </section>
    <div class="graphwar-killer__detection-pathfinding-row">
      <section
        class="graphwar-killer__panel"
        aria-labelledby="graphwar-killer-detection-title"
      >
        <div class="graphwar-killer__label-row">
          <h2 id="graphwar-killer-detection-title">
            {{ locale.ui.detection.title }}
          </h2>
          <span
            v-if="detectionHeaderStatus"
            role="status"
            aria-live="polite"
            :title="detectionHeaderStatus"
            :class="{
              'graphwar-killer__label-status--error': detectionHeaderStatusIsError,
              'graphwar-killer__label-status--warning': detectionHeaderStatusIsWarning,
              'graphwar-killer__label-status--success': detectionHeaderStatusIsSuccess,
            }"
          >
            {{ detectionHeaderStatus }}
          </span>
          <span
            v-if="detectionStatusWarning"
            class="graphwar-killer__label-status graphwar-killer__label-status--warning"
            :title="detectionStatusWarningTitle"
          >
            {{ detectionStatusWarning }}
          </span>
        </div>
        <div class="graphwar-killer__image-actions">
          <button
            type="button"
            :disabled="!imageUrl"
            :title="locale.ui.detection.startDetectionTitle"
            @click="void detectGraphwarObjects()"
          >
            {{ locale.ui.detection.startDetection }}
          </button>
          <button
            type="button"
            :aria-pressed="autoDetectionEnabled"
            :class="{ 'graphwar-killer__toggle-button--active': autoDetectionEnabled }"
            :title="locale.ui.detection.autoDetectionTitle"
            @click="toggleAutoDetection"
          >
            {{ locale.ui.detection.autoDetection }}
          </button>
          <button
            type="button"
            :aria-pressed="smartCursorEnabled"
            :class="{ 'graphwar-killer__toggle-button--active': smartCursorEnabled }"
            :title="locale.ui.detection.smartCursorTitle"
            @click="toggleSmartCursor"
          >
            {{ locale.ui.detection.smartCursor }}
          </button>
        </div>
        <details
          v-if="debugInfoEnabled"
          class="graphwar-killer__subpanel graphwar-killer__details"
        >
          <summary>{{ locale.ui.detection.debugSummary }}</summary>
          <div class="graphwar-killer__debug-timing">
            <span v-if="!detectionDebugTimingRows.length">{{ locale.ui.detection.debugNoTiming }}</span>
            <template v-else>
              <span
                v-for="(entry, index) in detectionDebugTimingRows"
                :key="`${entry.stage}-${index}`"
                :title="entry.title"
              >
                <template v-if="entry.elapsedVisible">
                  {{ entry.label }}: {{ formatDebugElapsedDuration(entry.elapsedMs) }}
                </template>
                <template v-else>{{ entry.label }}</template>
              </span>
            </template>
          </div>
        </details>
      </section>
      <section
        v-if="toolWorkflowMode !== 'simulator'"
        class="graphwar-killer__panel"
        aria-labelledby="graphwar-killer-smart-pathfinding-title"
      >
        <div class="graphwar-killer__label-row">
          <h2 id="graphwar-killer-smart-pathfinding-title">
            {{ locale.ui.pathfinding.title }}
          </h2>
          <span
            v-if="pathfindingHeaderStatus"
            class="graphwar-killer__pathfinding-header-status"
            :title="pathfindingHeaderStatusTitle"
            :class="{
              'graphwar-killer__label-status--error': pathfindingHeaderStatusIsError,
              'graphwar-killer__label-status--warning': pathfindingHeaderStatusIsWarning,
              'graphwar-killer__label-status--success': pathfindingHeaderStatusIsSuccess,
            }"
          >
            {{ pathfindingHeaderStatus }}
          </span>
        </div>
        <div class="graphwar-killer__image-actions">
          <button
            type="button"
            :aria-pressed="smartPathfindingEnabled"
            :class="{ 'graphwar-killer__toggle-button--active': smartPathfindingEnabled }"
            :disabled="isSmartPathfindingDisabled()"
            :title="getSmartPathfindingToggleTitle()"
            @click="toggleSmartPathfinding"
          >
            {{ locale.ui.pathfinding.smartPathfinding }}
          </button>
          <button
            v-if="smartPathfindingEnabled"
            type="button"
            :aria-pressed="friendlyFireEnabled"
            :class="{ 'graphwar-killer__toggle-button--active': friendlyFireEnabled }"
            :title="locale.ui.pathfinding.allowFriendlyFireTitle"
            @click="toggleFriendlyFire"
          >
            {{ locale.ui.pathfinding.allowFriendlyFire }}
          </button>
          <button
            v-if="smartPathfindingEnabled"
            type="button"
            :aria-pressed="searchAnimationEnabled"
            :class="{ 'graphwar-killer__toggle-button--active': searchAnimationEnabled }"
            :title="locale.ui.pathfinding.searchAnimationTitle"
            @click="toggleSearchAnimation"
          >
            {{ locale.ui.pathfinding.searchAnimation }}
          </button>
          <button
            v-if="smartPathfindingEnabled"
            type="button"
            aria-pressed="false"
            :disabled="smartPathfindingInProgress || isOneClickClearModeUnsupported()"
            :title="getOneClickClearButtonTitle()"
            @click="void runOneClickClear()"
          >
            {{ locale.ui.pathfinding.autoGraph }}
          </button>
        </div>
        <div
          v-if="smartPathfindingEnabled && debugInfoEnabled"
          class="graphwar-killer__pathfinding-settings"
        >
          <details class="graphwar-killer__subpanel graphwar-killer__details">
            <summary>{{ locale.ui.pathfinding.debugSummary }}</summary>
            <div class="graphwar-killer__debug-timing">
              <span v-if="!smartPathfindingDebugTimingRows.length">{{ locale.ui.pathfinding.debugNoTiming }}</span>
              <template v-else>
                <span
                  v-for="(entry, index) in smartPathfindingDebugTimingRows"
                  :key="`${entry.stage}-${index}`"
                  class="graphwar-killer__debug-timing-row"
                  :style="{ '--graphwar-killer-debug-indent-level': entry.indentLevel }"
                  :title="entry.title"
                >
                  <template v-if="entry.elapsedVisible">
                    {{ entry.label }}: {{ formatDebugElapsedDuration(entry.elapsedMs) }}
                  </template>
                  <template v-else>{{ entry.label }}</template>
                </span>
              </template>
            </div>
          </details>
        </div>
      </section>
    </div>
    <section
      class="graphwar-killer__panel"
      aria-labelledby="graphwar-killer-actions-title"
    >
      <div class="graphwar-killer__label-row">
        <h2 id="graphwar-killer-actions-title">
          {{ locale.ui.actions.title }}
        </h2>
        <span :title="activeToolHint">{{ activeToolHint }}</span>
      </div>
      <div class="graphwar-killer__image-actions">
        <div
          class="graphwar-killer__tool-toggle"
          :class="{
            'graphwar-killer__tool-toggle--path': toolMode === 'path',
            'graphwar-killer__tool-toggle--obstacle': toolMode === 'obstacle',
          }"
          role="group"
          :aria-label="locale.ui.actions.toolModeAriaLabel"
          :title="locale.ui.actions.toolModeTitle"
        >
          <button
            type="button"
            :aria-pressed="toolMode === 'bounds'"
            :class="{ 'graphwar-killer__tool-toggle-button--active': toolMode === 'bounds' }"
            :title="locale.ui.actions.pickBoundsTitle"
            @click="setToolMode('bounds')"
          >
            {{ locale.ui.actions.pickBounds }}
          </button>
          <button
            type="button"
            :aria-pressed="toolMode === 'path'"
            :class="{ 'graphwar-killer__tool-toggle-button--active': toolMode === 'path' }"
            :title="locale.ui.actions.pickPathTitle"
            @click="setToolMode('path')"
          >
            {{ locale.ui.actions.pickPath }}
          </button>
          <button
            type="button"
            :aria-pressed="toolMode === 'obstacle'"
            :class="{ 'graphwar-killer__tool-toggle-button--active': toolMode === 'obstacle' }"
            :disabled="!obstacleBrushAvailable"
            :title="locale.ui.actions.drawObstacleTitle"
            @click="setToolMode('obstacle')"
          >
            {{ locale.ui.actions.drawObstacle }}
          </button>
        </div>
        <button
          type="button"
          :aria-pressed="magnifierEnabled"
          :class="{ 'graphwar-killer__toggle-button--active': magnifierEnabled }"
          :title="locale.ui.actions.magnifierTitle"
          @click="magnifierEnabled = !magnifierEnabled"
        >
          {{ locale.ui.actions.magnifier }}
        </button>
        <label
          v-if="magnifierEnabled"
          class="graphwar-killer__magnifier-zoom-label"
          :title="locale.ui.actions.magnifierZoomTitle"
        >
          {{ locale.ui.actions.magnifierZoom }}
          <input
            type="range"
            :value="magnifierSliderZoom"
            :style="magnifierZoomRangeStyle"
            :min="magnifierMinimumZoom"
            :max="magnifierSliderMaximumZoom"
            step="0.1"
            :aria-label="locale.ui.actions.magnifierZoomAriaLabel"
            :title="locale.ui.actions.magnifierZoomTitle"
            @input="handleMagnifierZoomInput"
          >
          <input
            type="number"
            :value="magnifierZoomText"
            inputmode="decimal"
            :min="magnifierMinimumZoom"
            :max="magnifierInputMaximumZoom"
            step="0.1"
            :aria-label="locale.ui.actions.magnifierZoomAriaLabel"
            :title="locale.ui.actions.magnifierZoomTitle"
            @input="handleMagnifierZoomInput"
          >
          <span>x</span>
        </label>
      </div>
      <div
        v-if="toolMode === 'path'"
        class="graphwar-killer__path-actions"
      >
        <button
          type="button"
          :title="locale.ui.actions.clearPathTitle"
          @click="clearPath"
        >
          {{ locale.ui.actions.clearPath }}
        </button>
        <button
          type="button"
          :title="locale.ui.actions.undoPointTitle"
          @click="undoLastPoint"
        >
          {{ locale.ui.actions.undoPoint }}
        </button>
        <button
          type="button"
          :aria-pressed="liveClickPreviewEnabled"
          :class="{ 'graphwar-killer__toggle-button--active': liveClickPreviewEnabled }"
          :title="locale.ui.actions.liveClickPreviewTitle"
          @click="liveClickPreviewEnabled = !liveClickPreviewEnabled"
        >
          {{ locale.ui.actions.liveClickPreview }}
        </button>
      </div>
      <div
        v-if="obstacleBrushControlsVisible"
        class="graphwar-killer__obstacle-brush-actions"
      >
        <label
          class="graphwar-killer__obstacle-brush-label"
          :title="locale.ui.actions.obstacleBrushDiameterTitle"
        >
          {{ locale.ui.actions.obstacleBrushDiameter }}
          <input
            type="range"
            :value="obstacleBrushSliderDiameter"
            class="graphwar-killer__obstacle-brush-range"
            :style="obstacleBrushRangeStyle"
            :min="obstacleBrushMinimumDiameter"
            :max="obstacleBrushSliderMaximumDiameter"
            step="1"
            :aria-label="locale.ui.actions.obstacleBrushDiameterAriaLabel"
            :title="locale.ui.actions.obstacleBrushDiameterTitle"
            @input="handleObstacleBrushDiameterInput"
          >
          <input
            type="number"
            :value="obstacleBrushDiameterText"
            inputmode="numeric"
            :min="obstacleBrushMinimumDiameter"
            :max="obstacleBrushInputMaximumDiameter"
            step="1"
            :aria-label="locale.ui.actions.obstacleBrushDiameterAriaLabel"
            :title="locale.ui.actions.obstacleBrushDiameterTitle"
            @input="handleObstacleBrushDiameterInput"
          >
          <span>{{ locale.ui.pathfinding.unit }}</span>
        </label>
        <button
          type="button"
          :aria-pressed="obstacleBrushEraseEnabled"
          :class="{ 'graphwar-killer__toggle-button--active': obstacleBrushEraseEnabled }"
          :title="locale.ui.actions.eraseObstacleTitle"
          @click="toggleObstacleBrushErase"
        >
          {{ locale.ui.actions.eraseObstacle }}
        </button>
        <button
          type="button"
          :disabled="!obstacleEditsDirty"
          :title="locale.ui.actions.clearObstacleEditsTitle"
          @click="resetObstacleEdits"
        >
          {{ locale.ui.actions.clearObstacleEdits }}
        </button>
      </div>
    </section>
    <section
      class="graphwar-killer__panel"
      aria-labelledby="graphwar-killer-screenshot-title"
    >
      <div class="graphwar-killer__label-row graphwar-killer__label-row--image-status">
        <h2 id="graphwar-killer-screenshot-title">
          {{ locale.ui.screenshot.title }}
        </h2>
        <span
          class="graphwar-killer__image-status-text"
          :title="screenshotImageStatusText"
        >
          {{ screenshotImageStatusText }}
        </span>
        <span
          v-if="pathStatus"
          class="graphwar-killer__path-status-text graphwar-killer__label-status--warning"
          :title="pathStatus"
        >
          {{ pathStatus }}
        </span>
      </div>
      <div class="graphwar-killer__image-actions">
        <button
          type="button"
          :title="locale.ui.screenshot.captureTitle"
          @click="captureScreenImage"
        >
          {{ locale.ui.screenshot.capture }}
        </button>
        <label
          class="graphwar-killer__upload"
          :title="locale.ui.screenshot.uploadTitle"
        >
          <input
            type="file"
            accept="image/*"
            :title="locale.ui.screenshot.uploadInputTitle"
            @change="handleImageUpload"
          >
          <span>{{ locale.ui.screenshot.upload }}</span>
        </label>
      </div>
      <div
        ref="stageRef"
        class="graphwar-killer__stage"
        :class="{ 'graphwar-killer__stage--empty': !imageUrl }"
        :style="stageStyle"
        tabindex="0"
        @drop.prevent="handleDrop"
        @dragover.prevent
        @pointerdown="handleStagePointerDown"
        @pointermove="handleStagePointerMove"
        @pointerup="handleStagePointerUp"
        @pointercancel="handleStagePointerUp"
        @pointerleave="handleStagePointerLeave"
        @contextmenu.prevent="handleStageContextMenu"
      >
        <img
          v-if="imageUrl"
          ref="imageRef"
          :src="imageUrl"
          alt=""
          draggable="false"
          @load="handleImageLoad"
        >
        <div
          v-else
          class="graphwar-killer__placeholder"
        >
          {{ locale.ui.screenshot.placeholder }}
        </div>
        <svg
          class="graphwar-killer__overlay"
          :viewBox="`0 0 ${imageWidth} ${imageHeight}`"
          aria-hidden="true"
        >
          <defs>
            <clipPath :id="mainObstacleBrushClipPathId">
              <rect
                :x="boundsRect.x"
                :y="boundsRect.y"
                :width="boundsRect.width"
                :height="boundsRect.height"
              />
            </clipPath>
          </defs>
          <rect
            class="graphwar-killer__bounds"
            :class="{
              'graphwar-killer__bounds--preview': boundsPreviewRect,
              'graphwar-killer__bounds--flash': boundsFlashActive && !boundsPreviewRect,
            }"
            :x="visibleBoundsRect.x"
            :y="visibleBoundsRect.y"
            :width="visibleBoundsRect.width"
            :height="visibleBoundsRect.height"
          />
          <rect
            v-if="allowedTargetRect"
            class="graphwar-killer__target-range"
            :x="allowedTargetRect.x"
            :y="allowedTargetRect.y"
            :width="allowedTargetRect.width"
            :height="allowedTargetRect.height"
          />
          <rect
            v-if="visibleBoundaryExpansionRect"
            class="graphwar-killer__boundary-expansion"
            :x="visibleBoundaryExpansionRect.x"
            :y="visibleBoundaryExpansionRect.y"
            :width="visibleBoundaryExpansionRect.width"
            :height="visibleBoundaryExpansionRect.height"
          />
          <line
            class="graphwar-killer__axis"
            :x1="visibleBoundsRect.x"
            :x2="visibleBoundsRect.x + visibleBoundsRect.width"
            :y1="visibleBoundsRect.y + visibleBoundsRect.height / 2"
            :y2="visibleBoundsRect.y + visibleBoundsRect.height / 2"
          />
          <line
            class="graphwar-killer__axis"
            :x1="visibleBoundsRect.x + visibleBoundsRect.width / 2"
            :x2="visibleBoundsRect.x + visibleBoundsRect.width / 2"
            :y1="visibleBoundsRect.y"
            :y2="visibleBoundsRect.y + visibleBoundsRect.height"
          />
          <path
            v-if="smartCursorEnabled && !pathfindingObstacleEdgesActive && visibleObstacleFillPath"
            class="graphwar-killer__obstacle-fill"
            :d="visibleObstacleFillPath"
          />
          <path
            v-if="smartCursorEnabled && !pathfindingObstacleEdgesActive && visibleObstacleEdgePath"
            class="graphwar-killer__obstacle-edge"
            :d="visibleObstacleEdgePath"
          />
          <template v-if="pathfindingObstacleEdgesActive">
            <path
              v-if="smartPathfindingObstacleRouteFillPath"
              class="graphwar-killer__obstacle-fill graphwar-killer__obstacle-fill--route"
              :d="smartPathfindingObstacleRouteFillPath"
            />
            <path
              v-if="smartPathfindingObstacleSimulationFillPath"
              class="graphwar-killer__obstacle-fill graphwar-killer__obstacle-fill--simulation"
              :d="smartPathfindingObstacleSimulationFillPath"
            />
            <path
              v-if="smartPathfindingObstacleRouteEdgePath"
              class="graphwar-killer__obstacle-edge graphwar-killer__obstacle-edge--route"
              :d="smartPathfindingObstacleRouteEdgePath"
            />
            <path
              v-if="smartPathfindingObstacleSimulationEdgePath"
              class="graphwar-killer__obstacle-edge graphwar-killer__obstacle-edge--simulation"
              :d="smartPathfindingObstacleSimulationEdgePath"
            />
          </template>
          <template v-if="smartCursorEnabled">
            <g
              v-for="box in detectionBoxes"
              :key="box.id"
              class="graphwar-killer__detection-group"
            >
              <circle
                class="graphwar-killer__detection"
                :class="[
                  `graphwar-killer__detection--${box.kind}`,
                  {
                    'graphwar-killer__detection--hovered': box.id === hoveredDetectedSoldierId,
                  },
                ]"
                :cx="box.visualCenterX"
                :cy="box.visualCenterY"
                :r="box.visualRadius"
              />
            </g>
          </template>
          <g
            v-if="detectionSoldierFlashActive"
            class="graphwar-killer__detection-flash-group"
          >
            <circle
              v-for="box in detectedSoldiers"
              :key="`detection-flash-${box.id}`"
              class="graphwar-killer__detection-flash-circle"
              :cx="box.visualCenterX"
              :cy="box.visualCenterY"
              :r="box.visualRadius"
            />
          </g>
          <g
            v-if="oneClickClearHitFlashActive"
            class="graphwar-killer__detection-flash-group"
          >
            <circle
              v-for="box in oneClickClearHitFlashSoldiers"
              :key="`one-click-clear-hit-flash-${box.id}`"
              class="graphwar-killer__detection-flash-circle graphwar-killer__detection-flash-circle--hit"
              :cx="box.visualCenterX"
              :cy="box.visualCenterY"
              :r="box.visualRadius"
            />
          </g>
          <ellipse
            v-if="obstacleBrushPreview"
            class="graphwar-killer__obstacle-brush-preview"
            :class="{ 'graphwar-killer__obstacle-brush-preview--erase': obstacleBrushEraseEnabled }"
            :clip-path="`url(#${mainObstacleBrushClipPathId})`"
            :cx="obstacleBrushPreview.center.x"
            :cy="obstacleBrushPreview.center.y"
            :rx="obstacleBrushPreview.radiusX"
            :ry="obstacleBrushPreview.radiusY"
          />
          <circle
            v-if="boundsFirstPoint"
            class="graphwar-killer__bounds-point"
            :cx="boundsFirstPoint.x"
            :cy="boundsFirstPoint.y"
            r="7"
          />
          <line
            v-for="(segment, index) in pathLineSegments"
            :key="`path-line-${index}`"
            class="graphwar-killer__path-line"
            :x1="segment.x1"
            :y1="segment.y1"
            :x2="segment.x2"
            :y2="segment.y2"
          />
          <line
            v-for="(segment, index) in liveClickPreviewLineSegments"
            :key="`live-click-preview-line-${index}`"
            class="graphwar-killer__path-line graphwar-killer__path-line--live-click-preview"
            :x1="segment.x1"
            :y1="segment.y1"
            :x2="segment.x2"
            :y2="segment.y2"
          />
          <line
            v-if="smartPathfindingInProgress && smartPathfindingPreviewConnection"
            class="graphwar-killer__pathfinding-connection"
            :x1="smartPathfindingPreviewConnection.x1"
            :y1="smartPathfindingPreviewConnection.y1"
            :x2="smartPathfindingPreviewConnection.x2"
            :y2="smartPathfindingPreviewConnection.y2"
          />
          <polyline
            v-if="smartPathfindingInProgress && smartPathfindingPreviewPathPoints"
            class="graphwar-killer__pathfinding-try-path"
            :points="smartPathfindingPreviewPathPoints"
          />
          <circle
            v-if="smartPathfindingInProgress && pathfindingOptimizationPreviewPoint"
            class="graphwar-killer__pathfinding-optimization-point"
            :cx="pathfindingOptimizationPreviewPoint.x"
            :cy="pathfindingOptimizationPreviewPoint.y"
            :r="soldierMarkerRadius + 4"
          />
          <g
            v-if="smartPathfindingInProgress"
            class="graphwar-killer__pathfinding-preview"
          >
            <line
              v-for="(segment, index) in smartPathfindingPreviewAcceptedEdges"
              :key="`pathfinding-preview-edge-${index}`"
              class="graphwar-killer__pathfinding-accepted-edge"
              :x1="segment.x1"
              :y1="segment.y1"
              :x2="segment.x2"
              :y2="segment.y2"
            />
            <circle
              v-if="smartPathfindingPreviewCurrentPoint"
              class="graphwar-killer__pathfinding-current"
              :cx="smartPathfindingPreviewCurrentPoint.x"
              :cy="smartPathfindingPreviewCurrentPoint.y"
              r="4.2"
            />
            <circle
              v-for="(point, index) in smartPathfindingPreviewPoints"
              :key="`pathfinding-preview-${index}`"
              class="graphwar-killer__pathfinding-candidate"
              :cx="point.x"
              :cy="point.y"
              r="2.8"
            />
          </g>
          <polyline
            v-if="plottedCurvePoints"
            class="graphwar-killer__curve-line"
            :points="plottedCurvePoints"
            :style="{ stroke: trajectoryStrokeColor }"
          />
          <polyline
            v-if="liveClickPreviewCurvePoints"
            class="graphwar-killer__curve-line graphwar-killer__curve-line--live-click-preview"
            :points="liveClickPreviewCurvePoints"
          />
          <circle
            v-if="smartPathfindingBlockedPoint"
            class="graphwar-killer__pathfinding-blocked-point"
            :cx="smartPathfindingBlockedPoint.x"
            :cy="smartPathfindingBlockedPoint.y"
            :r="soldierSelectionRadius"
          />
          <g
            v-for="(point, index) in pathPixels"
            :key="`point-${index}`"
          >
            <circle
              class="graphwar-killer__point"
              :class="{
                'graphwar-killer__point--start': index === 0,
                'graphwar-killer__point--hovered': index === hoveredPathPointIndex,
              }"
              :cx="point.x"
              :cy="point.y"
              :r="soldierSelectionRadius"
            />
            <text
              class="graphwar-killer__point-label"
              :x="point.x + soldierSelectionRadius + 4"
              :y="point.y - soldierSelectionRadius - 4"
            >
              {{ index === 0 ? locale.ui.point.svgSelfLabel : index }}
            </text>
          </g>
          <g v-if="liveClickPreviewPoint">
            <circle
              class="graphwar-killer__point graphwar-killer__point--live-click-preview"
              :cx="liveClickPreviewPoint.x"
              :cy="liveClickPreviewPoint.y"
              :r="soldierSelectionRadius"
            />
            <text
              class="graphwar-killer__point-label graphwar-killer__point-label--live-click-preview"
              :x="liveClickPreviewPoint.x + soldierSelectionRadius + 4"
              :y="liveClickPreviewPoint.y - soldierSelectionRadius - 4"
            >
              {{ liveClickPreviewLabel }}
            </text>
          </g>
        </svg>
        <div
          v-if="detectionInProgress"
          class="graphwar-killer__detection-busy-overlay"
          :aria-label="locale.ui.detection.busyOverlay"
          @pointerdown.stop.prevent
          @pointermove.stop.prevent
          @pointerup.stop.prevent
          @pointercancel.stop.prevent
          @dragover.stop.prevent
          @drop.stop.prevent
          @contextmenu.stop.prevent="cancelDetection(true)"
        >
          <span>{{ locale.ui.detection.busyOverlay }}</span>
        </div>
        <div
          v-if="magnifierEnabled && imageUrl && magnifierPoint"
          class="graphwar-killer__magnifier"
          :style="magnifierStyle"
          aria-hidden="true"
        >
          <div
            class="graphwar-killer__magnifier-content"
            :style="magnifierContentStyle"
          >
            <img
              class="graphwar-killer__magnifier-image"
              :src="imageUrl"
              alt=""
              draggable="false"
            >
            <svg
              class="graphwar-killer__overlay"
              :viewBox="`0 0 ${imageWidth} ${imageHeight}`"
              aria-hidden="true"
            >
              <defs>
                <clipPath :id="magnifierObstacleBrushClipPathId">
                  <rect
                    :x="boundsRect.x"
                    :y="boundsRect.y"
                    :width="boundsRect.width"
                    :height="boundsRect.height"
                  />
                </clipPath>
              </defs>
              <rect
                class="graphwar-killer__bounds"
                :class="{
                  'graphwar-killer__bounds--preview': boundsPreviewRect,
                  'graphwar-killer__bounds--flash': boundsFlashActive && !boundsPreviewRect,
                }"
                :x="visibleBoundsRect.x"
                :y="visibleBoundsRect.y"
                :width="visibleBoundsRect.width"
                :height="visibleBoundsRect.height"
              />
              <rect
                v-if="allowedTargetRect"
                class="graphwar-killer__target-range"
                :x="allowedTargetRect.x"
                :y="allowedTargetRect.y"
                :width="allowedTargetRect.width"
                :height="allowedTargetRect.height"
              />
              <rect
                v-if="visibleBoundaryExpansionRect"
                class="graphwar-killer__boundary-expansion"
                :x="visibleBoundaryExpansionRect.x"
                :y="visibleBoundaryExpansionRect.y"
                :width="visibleBoundaryExpansionRect.width"
                :height="visibleBoundaryExpansionRect.height"
              />
              <line
                class="graphwar-killer__axis"
                :x1="visibleBoundsRect.x"
                :x2="visibleBoundsRect.x + visibleBoundsRect.width"
                :y1="visibleBoundsRect.y + visibleBoundsRect.height / 2"
                :y2="visibleBoundsRect.y + visibleBoundsRect.height / 2"
              />
              <line
                class="graphwar-killer__axis"
                :x1="visibleBoundsRect.x + visibleBoundsRect.width / 2"
                :x2="visibleBoundsRect.x + visibleBoundsRect.width / 2"
                :y1="visibleBoundsRect.y"
                :y2="visibleBoundsRect.y + visibleBoundsRect.height"
              />
              <path
                v-if="smartCursorEnabled && !pathfindingObstacleEdgesActive && visibleObstacleFillPath"
                class="graphwar-killer__obstacle-fill"
                :d="visibleObstacleFillPath"
              />
              <path
                v-if="smartCursorEnabled && !pathfindingObstacleEdgesActive && visibleObstacleEdgePath"
                class="graphwar-killer__obstacle-edge"
                :d="visibleObstacleEdgePath"
              />
              <template v-if="pathfindingObstacleEdgesActive">
                <path
                  v-if="smartPathfindingObstacleRouteFillPath"
                  class="graphwar-killer__obstacle-fill graphwar-killer__obstacle-fill--route"
                  :d="smartPathfindingObstacleRouteFillPath"
                />
                <path
                  v-if="smartPathfindingObstacleSimulationFillPath"
                  class="graphwar-killer__obstacle-fill graphwar-killer__obstacle-fill--simulation"
                  :d="smartPathfindingObstacleSimulationFillPath"
                />
                <path
                  v-if="smartPathfindingObstacleRouteEdgePath"
                  class="graphwar-killer__obstacle-edge graphwar-killer__obstacle-edge--route"
                  :d="smartPathfindingObstacleRouteEdgePath"
                />
                <path
                  v-if="smartPathfindingObstacleSimulationEdgePath"
                  class="graphwar-killer__obstacle-edge graphwar-killer__obstacle-edge--simulation"
                  :d="smartPathfindingObstacleSimulationEdgePath"
                />
              </template>
              <template v-if="smartCursorEnabled">
                <g
                  v-for="box in detectionBoxes"
                  :key="`magnifier-${box.id}`"
                  class="graphwar-killer__detection-group"
                >
                  <circle
                    class="graphwar-killer__detection"
                    :class="[
                      `graphwar-killer__detection--${box.kind}`,
                      {
                        'graphwar-killer__detection--hovered': box.id === hoveredDetectedSoldierId,
                      },
                    ]"
                    :cx="box.visualCenterX"
                    :cy="box.visualCenterY"
                    :r="box.visualRadius"
                  />
                </g>
              </template>
              <g
                v-if="detectionSoldierFlashActive"
                class="graphwar-killer__detection-flash-group"
              >
                <circle
                  v-for="box in detectedSoldiers"
                  :key="`magnifier-detection-flash-${box.id}`"
                  class="graphwar-killer__detection-flash-circle"
                  :cx="box.visualCenterX"
                  :cy="box.visualCenterY"
                  :r="box.visualRadius"
                />
              </g>
              <g
                v-if="oneClickClearHitFlashActive"
                class="graphwar-killer__detection-flash-group"
              >
                <circle
                  v-for="box in oneClickClearHitFlashSoldiers"
                  :key="`magnifier-one-click-clear-hit-flash-${box.id}`"
                  class="graphwar-killer__detection-flash-circle graphwar-killer__detection-flash-circle--hit"
                  :cx="box.visualCenterX"
                  :cy="box.visualCenterY"
                  :r="box.visualRadius"
                />
              </g>
              <ellipse
                v-if="obstacleBrushPreview"
                class="graphwar-killer__obstacle-brush-preview"
                :class="{ 'graphwar-killer__obstacle-brush-preview--erase': obstacleBrushEraseEnabled }"
                :clip-path="`url(#${magnifierObstacleBrushClipPathId})`"
                :cx="obstacleBrushPreview.center.x"
                :cy="obstacleBrushPreview.center.y"
                :rx="obstacleBrushPreview.radiusX"
                :ry="obstacleBrushPreview.radiusY"
              />
              <circle
                v-if="boundsFirstPoint"
                class="graphwar-killer__bounds-point"
                :cx="boundsFirstPoint.x"
                :cy="boundsFirstPoint.y"
                r="7"
              />
              <line
                v-for="(segment, index) in pathLineSegments"
                :key="`magnifier-path-line-${index}`"
                class="graphwar-killer__path-line"
                :x1="segment.x1"
                :y1="segment.y1"
                :x2="segment.x2"
                :y2="segment.y2"
              />
              <line
                v-for="(segment, index) in liveClickPreviewLineSegments"
                :key="`magnifier-live-click-preview-line-${index}`"
                class="graphwar-killer__path-line graphwar-killer__path-line--live-click-preview"
                :x1="segment.x1"
                :y1="segment.y1"
                :x2="segment.x2"
                :y2="segment.y2"
              />
              <line
                v-if="smartPathfindingInProgress && smartPathfindingPreviewConnection"
                class="graphwar-killer__pathfinding-connection"
                :x1="smartPathfindingPreviewConnection.x1"
                :y1="smartPathfindingPreviewConnection.y1"
                :x2="smartPathfindingPreviewConnection.x2"
                :y2="smartPathfindingPreviewConnection.y2"
              />
              <polyline
                v-if="smartPathfindingInProgress && smartPathfindingPreviewPathPoints"
                class="graphwar-killer__pathfinding-try-path"
                :points="smartPathfindingPreviewPathPoints"
              />
              <circle
                v-if="smartPathfindingInProgress && pathfindingOptimizationPreviewPoint"
                class="graphwar-killer__pathfinding-optimization-point"
                :cx="pathfindingOptimizationPreviewPoint.x"
                :cy="pathfindingOptimizationPreviewPoint.y"
                :r="soldierMarkerRadius + 4"
              />
              <g
                v-if="smartPathfindingInProgress"
                class="graphwar-killer__pathfinding-preview"
              >
                <line
                  v-for="(segment, index) in smartPathfindingPreviewAcceptedEdges"
                  :key="`magnifier-pathfinding-preview-edge-${index}`"
                  class="graphwar-killer__pathfinding-accepted-edge"
                  :x1="segment.x1"
                  :y1="segment.y1"
                  :x2="segment.x2"
                  :y2="segment.y2"
                />
                <circle
                  v-if="smartPathfindingPreviewCurrentPoint"
                  class="graphwar-killer__pathfinding-current"
                  :cx="smartPathfindingPreviewCurrentPoint.x"
                  :cy="smartPathfindingPreviewCurrentPoint.y"
                  r="4.2"
                />
                <circle
                  v-for="(point, index) in smartPathfindingPreviewPoints"
                  :key="`magnifier-pathfinding-preview-${index}`"
                  class="graphwar-killer__pathfinding-candidate"
                  :cx="point.x"
                  :cy="point.y"
                  r="2.8"
                />
              </g>
              <polyline
                v-if="plottedCurvePoints"
                class="graphwar-killer__curve-line"
                :points="plottedCurvePoints"
                :style="{ stroke: trajectoryStrokeColor }"
              />
              <polyline
                v-if="liveClickPreviewCurvePoints"
                class="graphwar-killer__curve-line graphwar-killer__curve-line--live-click-preview"
                :points="liveClickPreviewCurvePoints"
              />
              <circle
                v-if="smartPathfindingBlockedPoint"
                class="graphwar-killer__pathfinding-blocked-point"
                :cx="smartPathfindingBlockedPoint.x"
                :cy="smartPathfindingBlockedPoint.y"
                :r="soldierSelectionRadius"
              />
              <g
                v-for="(point, index) in pathPixels"
                :key="`magnifier-point-${index}`"
              >
                <circle
                  class="graphwar-killer__point"
                  :class="{
                    'graphwar-killer__point--start': index === 0,
                    'graphwar-killer__point--hovered': index === hoveredPathPointIndex,
                  }"
                  :cx="point.x"
                  :cy="point.y"
                  :r="soldierSelectionRadius"
                />
                <text
                  class="graphwar-killer__point-label"
                  :x="point.x + soldierSelectionRadius + 4"
                  :y="point.y - soldierSelectionRadius - 4"
                >
                  {{ index === 0 ? locale.ui.point.svgSelfLabel : index }}
                </text>
              </g>
              <g v-if="liveClickPreviewPoint">
                <circle
                  class="graphwar-killer__point graphwar-killer__point--live-click-preview"
                  :cx="liveClickPreviewPoint.x"
                  :cy="liveClickPreviewPoint.y"
                  :r="soldierSelectionRadius"
                />
                <text
                  class="graphwar-killer__point-label graphwar-killer__point-label--live-click-preview"
                  :x="liveClickPreviewPoint.x + soldierSelectionRadius + 4"
                  :y="liveClickPreviewPoint.y - soldierSelectionRadius - 4"
                >
                  {{ liveClickPreviewLabel }}
                </text>
              </g>
            </svg>
          </div>
        </div>
      </div>
    </section>
    <section
      class="graphwar-killer__panel"
      aria-labelledby="graphwar-killer-result-title"
    >
      <div class="graphwar-killer__label-row graphwar-killer__label-row--result">
        <h2 id="graphwar-killer-result-title">
          {{ locale.ui.result.title }}
        </h2>
        <div class="graphwar-killer__result-actions">
          <button
            type="button"
            class="graphwar-killer__primary-button"
            :disabled="!canCopyFormula"
            :title="locale.ui.result.copyTitle"
            @click="copyFormula"
          >
            {{ copyButtonText }}
          </button>
          <button
            v-if="toolWorkflowMode === 'simulator'"
            type="button"
            class="graphwar-killer__secondary-button"
            :disabled="!canClearSimulatorInputs"
            :title="locale.ui.result.clearSimulatorTitle"
            @click="clearSimulatorInputs"
          >
            {{ locale.ui.result.clearSimulator }}
          </button>
        </div>
      </div>
      <div
        v-if="toolWorkflowMode === 'solver' && formulaResult"
        class="graphwar-killer__formula-row"
      >
        <span class="graphwar-killer__formula-prefix">
          {{ equationModes.find((mode) => mode.value === equationMode)?.label }}
        </span>
        <p class="graphwar-killer__formula">
          {{ formulaResult.expression }}
        </p>
      </div>
      <div
        v-else-if="toolWorkflowMode === 'simulator'"
        class="graphwar-killer__formula-row"
      >
        <span class="graphwar-killer__formula-prefix">
          {{ equationModes.find((mode) => mode.value === equationMode)?.label }}
        </span>
        <input
          v-model="simulatorFormulaText"
          class="graphwar-killer__formula-input"
          inputmode="text"
          autocomplete="off"
          :aria-label="locale.ui.result.formulaInputAriaLabel"
          :title="locale.ui.result.formulaInputTitle"
        >
      </div>
      <div
        v-if="toolWorkflowMode === 'simulator' && equationMode === 'ddy'"
        class="graphwar-killer__formula-row"
      >
        <span class="graphwar-killer__formula-prefix">
          {{ locale.ui.result.launchAngle }}
        </span>
        <input
          v-model="simulatorLaunchAngleText"
          class="graphwar-killer__formula-input graphwar-killer__formula-input--angle"
          inputmode="decimal"
          autocomplete="off"
          :aria-label="locale.ui.result.launchAngleAriaLabel"
          :title="locale.ui.result.launchAngleTitle"
        >
      </div>
      <p
        v-if="secondOrderAngleHint"
        class="graphwar-killer__hint graphwar-killer__hint--warning"
      >
        {{ secondOrderAngleHint }}
      </p>
      <p
        v-if="trajectoryWarning"
        class="graphwar-killer__hint graphwar-killer__hint--warning"
      >
        {{ trajectoryWarning }}
      </p>
      <p
        v-if="calculationMessage && (toolWorkflowMode === 'simulator' || !formulaResult)"
        class="graphwar-killer__error"
      >
        {{ calculationMessage }}
      </p>
      <div
        v-if="mappedPathPoints.length"
        class="graphwar-killer__point-table"
      >
        <div>
          <span>{{ locale.ui.point.header }}</span>
          <span>x</span>
          <span>y</span>
        </div>
        <div
          v-for="pointNumber in mappedPathPoints.length"
          :key="`row-${pointNumber - 1}`"
        >
          <span>{{ pointNumber === 1 ? locale.ui.point.selfLabel : locale.ui.point.pathLabel(pointNumber - 1) }}</span>
          <input
            class="graphwar-killer__point-coordinate-input"
            :value="getPathPointCoordinateText(pointNumber - 1, 'x')"
            :aria-label="
              locale.ui.point.coordinateAriaLabel(
                pointNumber === 1 ? locale.ui.point.selfLabel : locale.ui.point.pathLabel(pointNumber - 1),
                'x',
              )
            "
            :title="
              locale.ui.point.coordinateTitle(
                pointNumber === 1 ? locale.ui.point.selfLabel : locale.ui.point.pathLabel(pointNumber - 1),
                'x',
              )
            "
            inputmode="decimal"
            autocomplete="off"
            @focus="startPathPointCoordinateEdit(pointNumber - 1, 'x')"
            @blur="finishPathPointCoordinateEdit"
            @input="handlePathPointCoordinateInput(pointNumber - 1, 'x', $event)"
          >
          <input
            class="graphwar-killer__point-coordinate-input"
            :value="getPathPointCoordinateText(pointNumber - 1, 'y')"
            :aria-label="
              locale.ui.point.coordinateAriaLabel(
                pointNumber === 1 ? locale.ui.point.selfLabel : locale.ui.point.pathLabel(pointNumber - 1),
                'y',
              )
            "
            :title="
              locale.ui.point.coordinateTitle(
                pointNumber === 1 ? locale.ui.point.selfLabel : locale.ui.point.pathLabel(pointNumber - 1),
                'y',
              )
            "
            inputmode="decimal"
            autocomplete="off"
            @focus="startPathPointCoordinateEdit(pointNumber - 1, 'y')"
            @blur="finishPathPointCoordinateEdit"
            @input="handlePathPointCoordinateInput(pointNumber - 1, 'y', $event)"
          >
        </div>
      </div>
    </section>
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

.graphwar-killer h2 {
  border: 0;
  font-size: 1rem;
  margin: 0;
  padding: 0;
}

.graphwar-killer label {
  display: grid;
  font-weight: 600;
  gap: 3px;
  min-width: 0;
}

.graphwar-killer input:not([type="file"]) {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  box-sizing: border-box;
  font-variant-numeric: tabular-nums;
  height: 30px;
  line-height: 1.15;
  min-height: 0;
  padding: 4px 8px;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background-color 0.2s ease;
  width: 100%;
}

.graphwar-killer input[type="range"] {
  appearance: none;
  background: linear-gradient(
    to right,
    var(--vp-c-brand-1) 0 var(--graphwar-killer-range-progress, 0%),
    var(--vp-c-divider) var(--graphwar-killer-range-progress, 0%) 100%
  );
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  height: 8px;
  padding: 0;
  width: 100%;
}

.graphwar-killer input[type="range"]::-webkit-slider-runnable-track {
  background: transparent;
  border: 0;
  height: 8px;
}

.graphwar-killer input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  background: var(--vp-c-brand-1);
  border: 2px solid var(--vp-c-bg);
  border-radius: 50%;
  box-shadow: 0 1px 4px rgb(15 23 42 / 20%);
  height: 18px;
  margin-top: -5px;
  width: 18px;
}

.graphwar-killer input[type="range"]::-moz-range-track {
  background: transparent;
  border: 0;
  height: 8px;
}

.graphwar-killer input[type="range"]::-moz-range-progress {
  background: transparent;
}

.graphwar-killer input[type="range"]::-moz-range-thumb {
  background: var(--vp-c-brand-1);
  border: 2px solid var(--vp-c-bg);
  border-radius: 50%;
  box-shadow: 0 1px 4px rgb(15 23 42 / 20%);
  height: 18px;
  width: 18px;
}

.graphwar-killer button,
.graphwar-killer__upload span {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-family: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  line-height: 1.2;
  transition:
    transform 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    color 0.2s ease,
    background-color 0.2s ease;
}

.graphwar-killer button:disabled {
  cursor: not-allowed;
  opacity: 58%;
}

.graphwar-killer__panel {
  align-content: start;
  background: var(--vp-c-bg);
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 88%, transparent);
  border-radius: 12px;
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 10px;
}

.graphwar-killer__detection-pathfinding-row {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));
  min-width: 0;
}

.graphwar-killer__label-row {
  align-items: baseline;
  display: flex;
  gap: 8px;
  justify-content: space-between;
}

.graphwar-killer__label-row > span {
  color: color-mix(in srgb, var(--vp-c-text-1) 68%, var(--vp-c-text-2) 32%);
  font-size: 0.88rem;
  line-height: 1.4;
  min-width: 0;
  overflow: hidden;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.graphwar-killer__label-row > .graphwar-killer__label-status--error {
  color: #dc2626;
}

.graphwar-killer__label-row > .graphwar-killer__label-status--warning {
  color: #b45309;
  font-weight: 700;
}

.graphwar-killer__label-row > .graphwar-killer__label-status--success {
  color: #15803d;
  font-weight: 700;
}

.graphwar-killer__pathfinding-header-status {
  max-width: min(100%, 24rem);
}

.graphwar-killer__label-row--image-status {
  align-items: baseline;
  display: flex;
}

.graphwar-killer__label-row--image-status > span {
  min-width: 0;
}

.graphwar-killer__image-status-text {
  flex: 1 1 auto;
  text-align: left !important;
}

.graphwar-killer__path-status-text {
  flex: 0 1 auto;
  max-width: min(100%, 44rem);
  text-align: right;
}

.graphwar-killer__label-row--result {
  align-items: center;
}

.graphwar-killer__result-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.graphwar-killer__upload {
  width: fit-content;
}

.graphwar-killer__upload input {
  height: 1px;
  opacity: 0%;
  pointer-events: none;
  position: absolute;
  width: 1px;
}

.graphwar-killer__upload span {
  align-items: center;
  display: inline-flex;
  min-height: 34px;
  padding: 6px 10px;
}

.graphwar-killer__stage {
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--vp-c-divider) 42%, transparent) 1px, transparent 1px),
    linear-gradient(color-mix(in srgb, var(--vp-c-divider) 42%, transparent) 1px, transparent 1px), var(--vp-c-bg-soft);
  background-size: 40px 40px;
  border: 1px solid var(--vp-c-divider);
  overflow: hidden;
  position: relative;
  touch-action: none;
  user-select: none;
  width: 100%;
}

.graphwar-killer__stage img {
  border-radius: 0;
  display: block;
  height: 100%;
  inset: 0;
  margin: 0;
  max-width: none;
  object-fit: fill;
  object-position: 0 0;
  pointer-events: none;
  position: absolute;
  vertical-align: top;
  width: 100%;
}

.graphwar-killer__stage--empty {
  min-height: 280px;
}

.graphwar-killer__magnifier {
  background: var(--vp-c-bg);
  border: 2px solid var(--vp-c-brand-1);
  border-radius: 999px;
  box-shadow: 0 12px 32px rgb(15 23 42 / 20%);
  overflow: hidden;
  pointer-events: none;
  position: absolute;
  z-index: 3;
}

.graphwar-killer__magnifier-content {
  left: 0;
  position: absolute;
  top: 0;
  transform-origin: 0 0;
}

.graphwar-killer__magnifier-image {
  z-index: 0;
}

.graphwar-killer__magnifier::before,
.graphwar-killer__magnifier::after {
  background: #f97316;
  content: "";
  opacity: 86%;
  position: absolute;
  z-index: 2;
}

.graphwar-killer__magnifier::before {
  height: 1px;
  left: 38%;
  top: 50%;
  width: 24%;
}

.graphwar-killer__magnifier::after {
  height: 24%;
  left: 50%;
  top: 38%;
  width: 1px;
}

.graphwar-killer__placeholder {
  color: color-mix(in srgb, var(--vp-c-text-1) 62%, var(--vp-c-text-2) 38%);
  display: grid;
  font-weight: 700;
  inset: 0;
  place-items: center;
  position: absolute;
  text-align: center;
}

.graphwar-killer__overlay {
  height: 100%;
  inset: 0;
  position: absolute;
  width: 100%;
}

.graphwar-killer__detection-busy-overlay {
  align-items: center;
  background: rgb(15 23 42 / 34%);
  color: var(--vp-c-white);
  cursor: progress;
  display: flex;
  font-size: 0.95rem;
  font-weight: 700;
  inset: 0;
  justify-content: center;
  position: absolute;
  text-shadow: 0 1px 2px rgb(0 0 0 / 30%);
  touch-action: none;
  z-index: 5;
}

.graphwar-killer__detection-busy-overlay span {
  background: rgb(15 23 42 / 54%);
  border: 1px solid rgb(255 255 255 / 32%);
  border-radius: 8px;
  padding: 6px 10px;
}

.graphwar-killer__bounds {
  fill: color-mix(in srgb, var(--vp-c-brand-soft) 18%, transparent);
  stroke: var(--vp-c-brand-1);
  stroke-width: 1;
}

.graphwar-killer__bounds--preview {
  fill: color-mix(in srgb, #f97316 14%, transparent);
  stroke: #f97316;
}

.graphwar-killer__bounds--flash {
  animation: graphwar-killer-bounds-flash 1600ms ease-out;
}

.graphwar-killer__boundary-expansion {
  fill: none;
  pointer-events: none;
  stroke: #92400e;
  stroke-linecap: square;
  stroke-linejoin: miter;
  stroke-width: 1;
}

.graphwar-killer__bounds-point {
  fill: #f97316;
  stroke: var(--vp-c-bg);
  stroke-width: 3;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__axis {
  stroke: color-mix(in srgb, var(--vp-c-brand-1) 64%, transparent);
  stroke-width: 1;
}

.graphwar-killer__detection-group {
  pointer-events: none;
}

.graphwar-killer__detection {
  fill: none;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__detection--soldier {
  stroke: #2563eb;
}

.graphwar-killer__detection-flash-group {
  pointer-events: none;
}

.graphwar-killer__detection-flash-circle {
  animation: graphwar-killer-detection-soldier-flash 1600ms ease-out forwards;
  fill: none;
  stroke: #2563eb;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__detection-flash-circle--hit {
  stroke: #16a34a;
}

.graphwar-killer__detection--hovered {
  animation: graphwar-killer-curve-blink 900ms ease-in-out infinite;
  stroke: #16a34a;
}

.graphwar-killer__obstacle-edge {
  fill: none;
  stroke: #dc2626;
  stroke-linecap: square;
  stroke-linejoin: miter;
  stroke-width: 1;
}

.graphwar-killer__obstacle-fill {
  fill: rgb(220 38 38 / 10%);
  pointer-events: none;
}

.graphwar-killer__obstacle-fill--route {
  fill: rgb(244 114 182 / 7%);
}

.graphwar-killer__obstacle-fill--simulation {
  fill: rgb(220 38 38 / 7%);
}

.graphwar-killer__obstacle-edge--route {
  stroke: #f472b6;
}

.graphwar-killer__obstacle-edge--simulation {
  stroke: #dc2626;
}

.graphwar-killer__obstacle-brush-preview {
  animation: graphwar-killer-obstacle-brush-blink 1200ms ease-in-out infinite;
  fill: rgb(220 38 38 / 34%);
  pointer-events: none;
}

.graphwar-killer__obstacle-brush-preview--erase {
  fill: rgb(34 197 94 / 34%);
}

.graphwar-killer__target-range {
  fill: color-mix(in srgb, #86efac 14%, transparent);
  pointer-events: none;
}

.graphwar-killer__path-line {
  opacity: 42%;
  stroke: #38bdf8;
  stroke-dasharray: 7 6;
  stroke-linecap: round;
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__path-line--live-click-preview {
  opacity: 78%;
  stroke: #f59e0b;
  stroke-dasharray: 3 5;
  stroke-width: 1.5;
}

.graphwar-killer__pathfinding-preview {
  pointer-events: none;
}

.graphwar-killer__pathfinding-connection {
  animation: graphwar-killer-curve-blink 700ms ease-in-out infinite;
  pointer-events: none;
  stroke: #2563eb;
  stroke-dasharray: 8 6;
  stroke-linecap: round;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__pathfinding-try-path {
  animation: graphwar-killer-curve-blink 700ms ease-in-out infinite;
  fill: none;
  pointer-events: none;
  stroke: #0ea5e9;
  stroke-dasharray: 10 6;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__pathfinding-optimization-point {
  animation: graphwar-killer-curve-blink 450ms ease-in-out infinite;
  fill: color-mix(in srgb, #facc15 18%, transparent);
  pointer-events: none;
  stroke: #facc15;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__pathfinding-accepted-edge {
  stroke: #22c55e;
  stroke-dasharray: 5 5;
  stroke-linecap: round;
  stroke-width: 1.4;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__pathfinding-candidate {
  fill: #22c55e;
  stroke: var(--vp-c-bg);
  stroke-width: 1.4;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__pathfinding-current {
  animation: graphwar-killer-curve-blink 450ms ease-in-out infinite;
  fill: color-mix(in srgb, #facc15 22%, transparent);
  stroke: #facc15;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__pathfinding-blocked-point {
  animation: graphwar-killer-curve-blink 450ms ease-in-out infinite;
  fill: color-mix(in srgb, #dc2626 18%, transparent);
  pointer-events: none;
  stroke: #dc2626;
  stroke-dasharray: 5 4;
  stroke-width: 3;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__curve-line {
  animation: graphwar-killer-trajectory-blink 900ms ease-in-out infinite;
  fill: none;
  stroke: #ec4899;
  stroke-linecap: round;
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__curve-line--live-click-preview {
  stroke: #f59e0b;
  stroke-dasharray: 9 5;
  stroke-width: 1.5;
}

@keyframes graphwar-killer-trajectory-blink {
  0%,
  100% {
    opacity: 100%;
  }

  50% {
    opacity: 72%;
  }
}

@keyframes graphwar-killer-bounds-flash {
  0%,
  100% {
    opacity: 100%;
    stroke-width: 1;
  }

  16%,
  62% {
    opacity: 100%;
    stroke: #f97316;
    stroke-width: 5;
  }

  38% {
    opacity: 52%;
    stroke: #f97316;
    stroke-width: 5;
  }
}

@keyframes graphwar-killer-detection-soldier-flash {
  0% {
    opacity: 0%;
    stroke-width: 1.5;
  }

  16%,
  62% {
    opacity: 100%;
    stroke-width: 4;
  }

  38% {
    opacity: 52%;
    stroke-width: 4;
  }

  100% {
    opacity: 0%;
    stroke-width: 2;
  }
}

@keyframes graphwar-killer-curve-blink {
  0%,
  100% {
    opacity: 100%;
  }

  50% {
    opacity: 34%;
  }
}

@keyframes graphwar-killer-obstacle-brush-blink {
  0%,
  100% {
    opacity: 86%;
  }

  50% {
    opacity: 32%;
  }
}

.graphwar-killer__point {
  fill: color-mix(in srgb, #f97316 10%, transparent);
  stroke: #f97316;
  stroke-dasharray: 5 4;
  stroke-width: 1;
}

.graphwar-killer__point--start {
  fill: color-mix(in srgb, #16a34a 12%, transparent);
  stroke: #16a34a;
}

.graphwar-killer__point--hovered {
  animation: graphwar-killer-curve-blink 900ms ease-in-out infinite;
  fill: color-mix(in srgb, #16a34a 12%, transparent);
  stroke: #16a34a;
}

.graphwar-killer__point--live-click-preview {
  fill: color-mix(in srgb, #f59e0b 20%, transparent);
  pointer-events: none;
  stroke: #f59e0b;
  stroke-dasharray: 3 3;
  stroke-width: 2;
}

.graphwar-killer__point-label {
  fill: var(--vp-c-text-1);
  font-size: 16px;
  font-weight: 800;
  paint-order: stroke;
  stroke: var(--vp-c-bg);
  stroke-width: 4;
}

.graphwar-killer__point-label--live-click-preview {
  fill: #b45309;
}

.graphwar-killer__image-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.graphwar-killer__image-actions button {
  min-height: 34px;
  padding: 6px 10px;
}

.graphwar-killer__path-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.graphwar-killer__path-actions button {
  min-height: 34px;
  padding: 6px 10px;
}

.graphwar-killer__magnifier-zoom-label {
  align-items: center;
  flex: 1 1 280px;
  font-weight: 600;
  gap: 6px;
  grid-template-columns: auto minmax(96px, 1fr) minmax(54px, 72px) auto;
  max-width: min(100%, 460px);
  min-width: min(100%, 260px);
}

.graphwar-killer__magnifier-zoom-label span {
  color: color-mix(in srgb, var(--vp-c-text-1) 68%, var(--vp-c-text-2) 32%);
  font-size: 0.88rem;
  font-weight: 500;
}

.graphwar-killer__obstacle-brush-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.graphwar-killer__obstacle-brush-actions button {
  min-height: 34px;
  padding: 6px 10px;
}

.graphwar-killer__obstacle-brush-label {
  align-items: center;
  flex: 1 1 340px;
  font-weight: 600;
  gap: 6px;
  grid-template-columns: auto minmax(120px, 1fr) minmax(58px, 74px) auto;
  max-width: min(100%, 520px);
  min-width: min(100%, 320px);
}

.graphwar-killer__obstacle-brush-label span {
  color: color-mix(in srgb, var(--vp-c-text-1) 68%, var(--vp-c-text-2) 32%);
  font-size: 0.88rem;
  font-weight: 500;
}

.graphwar-killer__pathfinding-settings {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.graphwar-killer__subpanel {
  background: var(--vp-c-bg-soft);
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 82%, transparent);
  border-radius: 8px;
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 8px;
}

.graphwar-killer__subpanel h3 {
  font-size: 0.92rem;
  line-height: 1.4;
  margin: 0;
}

.graphwar-killer__advanced-settings-grid {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.graphwar-killer__advanced-settings-group {
  align-content: start;
}

.graphwar-killer__details {
  gap: 0;
}

.graphwar-killer__details[open] {
  gap: 8px;
}

.graphwar-killer__details > summary {
  cursor: pointer;
  font-size: 0.92rem;
  font-weight: 700;
  line-height: 1.4;
  margin: -2px 0;
}

.graphwar-killer__details > summary:focus-visible {
  border-radius: 4px;
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.graphwar-killer__details[open] > summary {
  margin-bottom: 6px;
}

.graphwar-killer__debug-timing {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  color: var(--vp-c-text-1);
  display: grid;
  font-size: 0.86rem;
  line-height: 1.6;
  margin: 0;
  overflow-x: auto;
  padding: 8px;
  white-space: nowrap;
}

.graphwar-killer__debug-timing > span {
  min-width: max-content;
}

.graphwar-killer__debug-timing-row {
  padding-inline-start: calc(var(--graphwar-killer-debug-indent-level, 0) * 1rem);
}

.graphwar-killer__pathfinding-setting-grid {
  display: grid;
  gap: 6px;
  min-width: 0;
}

/* 寻路数值项有的在 details 内、有的直接在分组内；统一收紧宽度，避免父 grid 拉伸后把输入框推右。 */
.graphwar-killer__pathfinding-setting-label {
  grid-template-columns: max-content minmax(74px, 92px) auto;
  justify-self: start;
}

.graphwar-killer__recognition-setting-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.graphwar-killer__recognition-setting-row .graphwar-killer__detection-setting-label {
  grid-template-columns: max-content minmax(74px, 92px) auto;
  min-width: 0;
}

.graphwar-killer__coordinate-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
}

.graphwar-killer__coordinate-grid label {
  align-items: center;
  gap: 6px;
  grid-template-columns: auto minmax(0, 1fr);
}

.graphwar-killer__step-settings {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.graphwar-killer__step-settings button {
  min-height: 34px;
  padding: 6px 10px;
}

.graphwar-killer__steepness-label {
  align-items: center;
  flex: 1 1 220px;
  gap: 6px;
  grid-template-columns: auto minmax(0, 1fr);
  min-width: min(100%, 220px);
}

.graphwar-killer__setting-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.graphwar-killer__setting-label {
  flex: 0 0 auto;
  font-weight: 600;
}

.graphwar-killer__settings-subheading {
  color: color-mix(in srgb, var(--vp-c-text-1) 70%, var(--vp-c-text-2) 30%);
  font-size: 0.9rem;
  font-weight: 700;
  margin: 2px 0 0;
}

.graphwar-killer__setting-row > :not(.graphwar-killer__setting-label) {
  flex: 1 1 320px;
  min-width: 0;
}

.graphwar-killer__game-mode-controls {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.graphwar-killer__precision-label {
  align-items: center;
  font-weight: 600;
  gap: 6px;
  grid-template-columns: auto minmax(74px, 92px);
}

.graphwar-killer__detection-setting-label {
  align-items: center;
  font-weight: 600;
  gap: 6px;
  grid-template-columns: auto minmax(74px, 92px) auto;
}

.graphwar-killer__detection-setting-label span {
  color: color-mix(in srgb, var(--vp-c-text-1) 68%, var(--vp-c-text-2) 32%);
  font-size: 0.88rem;
  font-weight: 500;
}

.graphwar-killer__tool-toggle {
  background: color-mix(in srgb, var(--vp-c-bg-soft) 68%, var(--vp-c-bg));
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  display: grid;
  gap: 0;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  min-height: 34px;
  min-width: 0;
  overflow: hidden;
  padding: 2px;
  position: relative;
}

.graphwar-killer__tool-toggle::before {
  background: var(--vp-c-brand-1);
  border-radius: 999px;
  bottom: 2px;
  box-shadow: 0 6px 14px rgb(15 23 42 / 12%);
  content: "";
  left: 2px;
  position: absolute;
  top: 2px;
  transition: transform 0.2s ease;
  width: calc((100% - 4px) / 3);
}

.graphwar-killer__tool-toggle--path::before {
  transform: translateX(100%);
}

.graphwar-killer__tool-toggle--obstacle::before {
  transform: translateX(200%);
}

.graphwar-killer__mode-toggle {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.graphwar-killer__mode-toggle::before {
  width: calc((100% - 4px) / 2);
}

.graphwar-killer__mode-toggle--simulator::before {
  transform: translateX(100%);
}

.graphwar-killer__algorithm-toggle {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  min-height: 38px;
}

.graphwar-killer__algorithm-toggle::before {
  width: calc((100% - 4px) / 4);
}

.graphwar-killer__algorithm-toggle--step::before {
  transform: translateX(100%);
}

.graphwar-killer__algorithm-toggle--pchip::before {
  transform: translateX(200%);
}

.graphwar-killer__algorithm-toggle--akima::before {
  transform: translateX(300%);
}

.graphwar-killer__tool-toggle.graphwar-killer__algorithm-toggle button {
  font-size: 0.82rem;
  line-height: 1.15;
  min-height: 32px;
  padding: 4px 7px;
}

.graphwar-killer__tool-toggle button {
  background: transparent;
  border: 0;
  border-radius: 999px;
  box-shadow: none;
  color: color-mix(in srgb, var(--vp-c-text-1) 64%, var(--vp-c-text-2) 36%);
  font-size: 0.9rem;
  line-height: 1.15;
  min-height: 28px;
  min-width: 0;
  overflow-wrap: anywhere;
  padding: 4px 10px;
  position: relative;
  text-align: center;
  transform: none;
  white-space: normal;
  z-index: 1;
}

.graphwar-killer__tool-toggle button:hover {
  box-shadow: none;
  transform: none;
}

.graphwar-killer__tool-toggle-button--active {
  color: var(--vp-c-white) !important;
}

.graphwar-killer__equation-toggle {
  background: color-mix(in srgb, var(--vp-c-bg-soft) 68%, var(--vp-c-bg));
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  display: grid;
  flex: 0 1 230px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  min-height: 34px;
  overflow: hidden;
  padding: 2px;
  position: relative;
  width: min(100%, 230px);
}

.graphwar-killer__equation-toggle::before {
  background: var(--vp-c-brand-1);
  border-radius: 999px;
  bottom: 2px;
  box-shadow: 0 6px 14px rgb(15 23 42 / 12%);
  content: "";
  left: 2px;
  position: absolute;
  top: 2px;
  transition: transform 0.2s ease;
  width: calc((100% - 4px) / 3);
}

.graphwar-killer__equation-toggle--dy::before {
  transform: translateX(100%);
}

.graphwar-killer__equation-toggle--ddy::before {
  transform: translateX(200%);
}

.graphwar-killer__equation-toggle button {
  background: transparent;
  border: 0;
  border-radius: 999px;
  box-shadow: none;
  color: color-mix(in srgb, var(--vp-c-text-1) 64%, var(--vp-c-text-2) 36%);
  font-family: inherit;
  font-size: 0.9rem;
  line-height: 1.2;
  min-height: 28px;
  min-width: 0;
  padding: 4px 7px;
  position: relative;
  transform: none;
  white-space: nowrap;
  z-index: 1;
}

.graphwar-killer__equation-toggle button:hover {
  box-shadow: none;
  transform: none;
}

.graphwar-killer__equation-toggle-button--active {
  color: var(--vp-c-white) !important;
}

.graphwar-killer__primary-button {
  background: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-white);
  min-height: 34px;
  padding: 6px 12px;
  white-space: nowrap;
}

.graphwar-killer__secondary-button {
  min-height: 34px;
  min-width: 72px;
  padding: 6px 10px;
  white-space: nowrap;
}

.graphwar-killer__toggle-button--active {
  background: var(--vp-c-brand-soft) !important;
  border-color: var(--vp-c-brand-1) !important;
  color: var(--vp-c-brand-1) !important;
}

.graphwar-killer__formula-row {
  align-items: start;
  display: grid;
  gap: 8px;
  grid-template-columns: auto minmax(0, 1fr);
}

.graphwar-killer__formula-prefix {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  font-family: var(--vp-font-family-mono);
  font-weight: 800;
  min-height: 44px;
  padding: 10px;
  user-select: none;
  white-space: nowrap;
}

.graphwar-killer__formula {
  background: color-mix(in srgb, var(--vp-c-brand-soft) 54%, var(--vp-c-bg));
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 28%, var(--vp-c-divider));
  border-radius: 10px;
  font-family: var(--vp-font-family-mono);
  font-size: 1rem;
  line-height: 1.6;
  margin: 0;
  overflow-x: auto;
  padding: 10px;
  white-space: nowrap;
}

.graphwar-killer__formula-input {
  font-family: var(--vp-font-family-mono);
  min-width: 0;
}

.graphwar-killer__formula-input--angle {
  max-width: 160px;
}

.graphwar-killer__error {
  color: var(--vp-c-danger-1);
  margin: 0;
}

.graphwar-killer__hint {
  color: color-mix(in srgb, var(--vp-c-text-1) 68%, var(--vp-c-text-2) 32%);
  font-size: 0.9rem;
  line-height: 1.5;
  margin: 0;
}

.graphwar-killer__hint--warning {
  color: #b45309;
  font-weight: 700;
}

.graphwar-killer__point-table {
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  display: grid;
  overflow-x: auto;
}

.graphwar-killer__point-table > div {
  border-top: 1px solid var(--vp-c-divider);
  display: grid;
  font-variant-numeric: tabular-nums;
  gap: 6px;
  grid-template-columns: minmax(90px, 1fr) minmax(130px, max-content) minmax(130px, max-content);
  min-width: 100%;
  padding: 6px 8px;
  width: max-content;
}

.graphwar-killer__point-table > div:first-child {
  background: var(--vp-c-bg-soft);
  border-top: 0;
  font-weight: 700;
}

.graphwar-killer__point-table--compact > div {
  font-size: 0.88rem;
  grid-template-columns: minmax(110px, 1fr) minmax(110px, max-content) minmax(74px, max-content);
}

.graphwar-killer__point-coordinate-input {
  height: 28px !important;
  line-height: 1.1 !important;
  min-height: 0 !important;
  padding: 3px 7px !important;
  width: 130px;
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

.graphwar-killer button:hover:not(:disabled),
.graphwar-killer__upload:hover span {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 8px 20px rgb(15 23 42 / 6%);
  color: var(--vp-c-brand-1);
  transform: translateY(-1px);
}

.graphwar-killer .graphwar-killer__tool-toggle button:hover:not(:disabled) {
  box-shadow: none;
  color: color-mix(in srgb, var(--vp-c-text-1) 64%, var(--vp-c-text-2) 36%);
  transform: none;
}

.graphwar-killer .graphwar-killer__tool-toggle-button--active:hover:not(:disabled) {
  color: var(--vp-c-white);
}

.graphwar-killer .graphwar-killer__equation-toggle button:hover:not(:disabled) {
  box-shadow: none;
  color: color-mix(in srgb, var(--vp-c-text-1) 64%, var(--vp-c-text-2) 36%);
  transform: none;
}

.graphwar-killer .graphwar-killer__equation-toggle-button--active:hover:not(:disabled) {
  color: var(--vp-c-white);
}

.graphwar-killer__primary-button:hover:not(:disabled) {
  color: var(--vp-c-white);
}

.graphwar-killer input:focus-visible,
.graphwar-killer button:focus-visible,
.graphwar-killer__stage:focus-visible {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 52%, var(--vp-c-divider));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--vp-c-brand-1) 16%, transparent);
  outline: none;
}

@media (width <= 760px) {
  .graphwar-killer__label-row {
    display: grid;
    gap: 4px;
  }

  .graphwar-killer__label-row--image-status {
    grid-template-columns: 1fr;
  }

  .graphwar-killer__label-row > span {
    text-align: left;
  }

  .graphwar-killer__primary-button {
    width: 100%;
  }

  .graphwar-killer__point-table > div {
    grid-template-columns: minmax(90px, 1fr) minmax(130px, max-content) minmax(130px, max-content);
  }
}

@media (width <= 520px) {
  .graphwar-killer__setting-row {
    display: grid;
    grid-template-columns: 1fr;
  }

  .graphwar-killer__recognition-setting-row {
    display: grid;
    grid-template-columns: 1fr;
  }
}
</style>
