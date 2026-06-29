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
  detectGraphwarObjectsInBounds as detectGraphwarObjectsFromImage,
  detectGraphwarPlayArea,
  dilateObstacleMask,
  imagePointToPlaneGridPoint,
  isPlayerColorPixel,
  paintObstacleMaskDisk,
  paintObstacleMaskStroke,
} from "./graphwar-detection";
import type { DetectedObstacleMap, GraphwarDetectionBox } from "./graphwar-detection";
import {
  buildSmartPathfindingPathForMask,
  collectSmartPathfindingRouteTolerances,
  createRouteMaskCacheKey,
  mirrorPlaneGridPoint,
  planeGridCellCenterToImagePoint,
} from "./graphwar-pathfinding";
import type { GraphwarPathfindingPreview, PlaneGridPoint } from "./graphwar-pathfinding";
import { createHeaderStatus, getFirstHeaderStatus, getSmartPathfindingHeaderStatus } from "./header-status";
import type { GraphwarKillerLocale } from "./locale-types";
import {
  DEFAULT_FORMULA_DECIMAL_PLACES,
  MAX_FORMULA_DECIMAL_PLACES,
  clampNumber,
  doublePrecisionTolerance,
  formatAngleDegree,
  formatDecimal,
  formatDoublePrecisionDecimal,
  formatSvgNumber,
  graphXAdvancesEnough,
  nearlyEqual,
  parseFiniteNumber,
  roundToDecimalPlaces,
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
import type { GraphwarTrajectoryFormulaSettings } from "./trajectory-sampling";
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
/** 公式输出小数位解析结果，控制公式文本和内部归一化精度。 */
type ParsedPrecision = { ok: true; decimalPlaces: number } | { ok: false; message: string };
/** 障碍识别阈值解析结果，失败时阻止重新识别。 */
type ParsedObstacleThresholds = { ok: true; minArea: number } | { ok: false; message: string };
/** 放大镜倍率解析结果；允许输入框超过滑条快速范围。 */
type ParsedMagnifierZoom = { ok: true; zoom: number } | { ok: false; message: string };
/** 障碍笔刷直径解析结果，单位为 Graphwar 原始 770x450 平面像素。 */
type ParsedObstacleBrushDiameter = { ok: true; diameter: number } | { ok: false; message: string };
/** 寻路容差解析结果；所有距离都使用 Graphwar 原始 770x450 平面像素。 */
type ParsedObstacleTolerances =
  | {
      ok: true;
      boundaryExpansionPlanePixels: number;
      routeMaxTolerancePlanePixels: number;
      routeMinTolerancePlanePixels: number;
      routeStepPlanePixels: number;
      simulationTolerancePlanePixels: number;
    }
  | { ok: false; message: string };
/** 寻路模式；auto-graph 保留为待重写的禁用入口。 */
type PathfindingMode = "off" | "smart" | "auto-graph";
/** 识别状态等级，与面板标题和智能寻路状态样式对齐。 */
type DetectionStatusKind = "info" | "success" | "warning" | "error";
/** 智能寻路状态等级，与面板标题和状态条样式对齐。 */
type SmartPathfindingStatusKind = "info" | "success" | "warning" | "error";
/** 智能寻路内部阶段，用于状态文案和搜索动画。 */
type SmartPathfindingPhase = "optimize" | "search" | "trajectory";
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
  /** 膨胀或腐蚀后的 mask。 */
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
const obstacleBrushMinimumDiameter = 1;
const obstacleBrushSliderMaximumDiameter = 200;
const obstacleBrushInputMaximumDiameter = 1000;
const obstacleBrushEditRefreshDelayMs = 250;
const detectionFlashAnimationMs = 1600;
const smartPathfindingBlockedPointFlashMs = 1800;
const mainObstacleBrushClipPathId = "graphwar-killer-obstacle-brush-clip";
const magnifierObstacleBrushClipPathId = "graphwar-killer-magnifier-obstacle-brush-clip";

const boundsRect = ref<BoundsRect>({ ...graphwarToolDefaults.boundsRect });
const boundsFirstPoint = ref<PixelPoint>();
const pointerPreviewPoint = ref<PixelPoint>();
const magnifierEnabled = ref(true);
const magnifierZoomText = ref(String(graphwarToolDefaults.magnifierZoom));
const magnifierPoint = ref<PixelPoint>();
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
const simulatorSkipUnknownCharacters = ref(true);
const simulatorParseDerivativeAsY = ref(true);
const obstacleMinAreaText = ref(String(graphwarToolDefaults.obstacleMinArea));
const obstacleRouteMinToleranceText = ref("1");
const obstacleRouteMaxToleranceText = ref("3");
const obstacleRouteStepToleranceText = ref("1");
const obstacleSimulationToleranceText = ref("1");
const pathfindingBoundaryExpansionText = ref("1");
const simulatorFormulaText = ref("");
const simulatorLaunchAngleText = ref("");
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
const detectionStatus = ref("");
const detectionStatusKind = ref<DetectionStatusKind>("info");
const detectionInProgress = ref(false);
const detectedSoldiers = ref<DetectionBox[]>([]);
const detectedObstacles = ref<DetectedObstacleMap>();
const baselineDetectedObstacles = ref<DetectedObstacleMap>();
const autoDetectionEnabled = ref(true);
const detectionSoldierFlashActive = ref(false);
const smartCursorEnabled = ref(true);
const smartPathfindingEnabled = ref(false);
const friendlyFireEnabled = ref(false);
const obstacleBrushDiameterText = ref("30");
const obstacleBrushEraseEnabled = ref(false);
const obstacleBrushPointerPoint = ref<PixelPoint>();
const obstacleBrushDragging = ref(false);
const obstacleBrushLastPlanePoint = ref<PlaneGridPoint>();
const obstacleEditsDirty = ref(false);
const searchAnimationEnabled = ref(true);
const smartPathfindingInProgress = ref(false);
const activeSmartPathfindingPhase = ref<SmartPathfindingPhase>("search");
const smartPathfindingStatus = ref("");
const smartPathfindingStatusKind = ref<SmartPathfindingStatusKind>("info");
const smartPathfindingActiveRouteTolerance = ref<number>();
const smartPathfindingPreviewConnection = ref<PathLineSegment>();
const smartPathfindingPreviewAcceptedEdges = ref<PathLineSegment[]>([]);
const smartPathfindingPreviewCurrentPoint = ref<PixelPoint>();
const smartPathfindingPreviewPoints = ref<PixelPoint[]>([]);
const smartPathfindingPreviewPath = ref<PixelPoint[]>([]);
const pathfindingOptimizationPreviewPoint = ref<PixelPoint>();
const smartPathfindingBlockedPoint = ref<PixelPoint>();
const routeMaskCache = new WeakMap<Uint8Array, Map<string, RouteMaskCacheEntry>>();
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
let obstacleEditRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let smartPathfindingBlockedPointTimer: ReturnType<typeof setTimeout> | undefined;
let detectionRunId = 0;
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

const parsedObstacleThresholds = computed<ParsedObstacleThresholds>(() => {
  const minArea = parseFiniteNumber(obstacleMinAreaText.value);
  if (minArea === undefined || !Number.isInteger(minArea)) {
    return { ok: false as const, message: locale.validation.obstacleMinAreaInteger };
  }
  if (minArea < 0 || minArea > graphwarObstacleMaxArea) {
    return { ok: false as const, message: locale.validation.obstacleMinAreaRange(graphwarObstacleMaxArea) };
  }
  return { ok: true as const, minArea };
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

const parsedObstacleTolerances = computed<ParsedObstacleTolerances>(() => {
  if (!parsedBounds.value.ok) {
    return { ok: false as const, message: parsedBounds.value.message };
  }

  const routeMinTolerancePlanePixels = parseFiniteNumber(obstacleRouteMinToleranceText.value);
  if (routeMinTolerancePlanePixels === undefined) {
    return { ok: false as const, message: locale.validation.pathfindingMinimumNumber };
  }

  const routeMaxTolerancePlanePixels = parseFiniteNumber(obstacleRouteMaxToleranceText.value);
  if (routeMaxTolerancePlanePixels === undefined) {
    return { ok: false as const, message: locale.validation.pathfindingMaximumNumber };
  }
  if (routeMinTolerancePlanePixels > routeMaxTolerancePlanePixels) {
    return { ok: false as const, message: locale.validation.pathfindingMinimumGreaterThanMaximum };
  }

  const routeStepPlanePixels = parseFiniteNumber(obstacleRouteStepToleranceText.value);
  if (routeStepPlanePixels === undefined || routeStepPlanePixels <= 0) {
    return { ok: false as const, message: locale.validation.routeStepNumber };
  }

  const simulationTolerancePlanePixels = parseFiniteNumber(obstacleSimulationToleranceText.value);
  if (simulationTolerancePlanePixels === undefined) {
    return { ok: false as const, message: locale.validation.simulationExpansionNumber };
  }

  const boundaryExpansionPlanePixels = parseFiniteNumber(pathfindingBoundaryExpansionText.value);
  if (boundaryExpansionPlanePixels === undefined) {
    return { ok: false as const, message: locale.validation.boundaryExpansionNumber };
  }
  if (boundaryExpansionPlanePixels < 0) {
    return { ok: false as const, message: locale.validation.boundaryExpansionNegative };
  }

  if (Math.abs(routeMinTolerancePlanePixels) > graphwarObstacleToleranceLimit) {
    return {
      ok: false as const,
      message: locale.validation.pathfindingMinimumPixelRange(graphwarObstacleToleranceLimit),
    };
  }

  if (Math.abs(routeMaxTolerancePlanePixels) > graphwarObstacleToleranceLimit) {
    return {
      ok: false as const,
      message: locale.validation.pathfindingMaximumPixelRange(graphwarObstacleToleranceLimit),
    };
  }

  if (Math.abs(simulationTolerancePlanePixels) > graphwarObstacleToleranceLimit) {
    return {
      ok: false as const,
      message: locale.validation.simulationExpansionPixelRange(graphwarObstacleToleranceLimit),
    };
  }

  if (boundaryExpansionPlanePixels > graphwarBoundaryExpansionLimit) {
    return {
      ok: false as const,
      message: locale.validation.boundaryExpansionPixelRange(graphwarBoundaryExpansionLimit),
    };
  }

  return {
    ok: true as const,
    boundaryExpansionPlanePixels,
    routeMaxTolerancePlanePixels,
    routeMinTolerancePlanePixels,
    routeStepPlanePixels: Math.max(Number.EPSILON, Math.abs(routeStepPlanePixels)),
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
const minimumPathGraphXStep = computed(() => 10 ** -formulaOutputDecimalPlaces.value);
const formulaOutputSteepness = computed(() => {
  const steepness = parsedSteepness.value.ok ? parsedSteepness.value.steepness : 1;
  return roundToDecimalPlaces(steepness, formulaOutputDecimalPlaces.value);
});
const graphwarTrajectoryFormulaSettings = computed<GraphwarTrajectoryFormulaSettings>(() => ({
  algorithm: algorithmMode.value,
  decimalPlaces: formulaOutputDecimalPlaces.value,
  equation: equationMode.value,
  formulaPathSteepness: parsedSteepness.value.ok ? parsedSteepness.value.steepness : 1,
  steepness: formulaOutputSteepness.value,
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
const settingsHeaderStatusResult = computed(() =>
  getFirstHeaderStatus(
    createHeaderStatus(settingsMessage.value, "error"),
    createHeaderStatus(activeEquationDescription.value),
  ),
);
const settingsHeaderStatus = computed(() => settingsHeaderStatusResult.value.message);
const settingsHeaderStatusIsError = computed(() => settingsHeaderStatusResult.value.kind === "error");
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

  const mask = new Uint8Array(obstacleMap.mask);
  addSoldierAreasToObstacleMask(mask, boundsRect.value, friendlySoldiers, soldierMarkerRadius.value);
  return mask;
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
  return smartPathfindingInProgress.value
    ? (smartPathfindingActiveRouteTolerance.value ?? tolerances.routeMinTolerancePlanePixels)
    : tolerances.routeMinTolerancePlanePixels;
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
const pathfindingMode = computed<PathfindingMode>(() => (smartPathfindingEnabled.value ? "smart" : "off"));
const autoGraphPathfindingDisabledMessage = computed(() => locale.status.autoGraphPathfindingDisabled);
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
  if (!parsedObstacleThresholds.value.ok) {
    return parsedObstacleThresholds.value.message;
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

  return buildFormula(
    context.formulaPoints,
    formulaOutputSteepness.value,
    equationMode.value,
    algorithmMode.value,
    parsedPrecision.value.decimalPlaces,
    context.formulaEvaluation,
  );
});

const visibleDecimalPlaces = computed(() =>
  parsedPrecision.value.ok ? parsedPrecision.value.decimalPlaces : DEFAULT_FORMULA_DECIMAL_PLACES,
);

watch(
  [mappedPathPoints, visibleDecimalPlaces],
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
    trajectoryWarningMessage: trajectoryWarning.value,
    trajectoryWarningKind: "warning",
    smartPathfindingStatusMessage: smartPathfindingStatus.value,
    smartPathfindingStatusKind: smartPathfindingStatusKind.value,
    enableHintMessage: "",
    hintMessage: "",
  }),
);
const pathfindingHeaderStatusResult = computed(() =>
  getFirstHeaderStatus(
    createHeaderStatus(smartPathfindingSettingsMessage.value, "error"),
    smartPathfindingHeaderStatusResult.value,
  ),
);
const pathfindingHeaderStatus = computed(() => pathfindingHeaderStatusResult.value.message);
const pathfindingHeaderStatusTitle = computed(() => undefined);
const pathfindingHeaderStatusIsError = computed(() => pathfindingHeaderStatusResult.value.kind === "error");
const pathfindingHeaderStatusIsWarning = computed(() => pathfindingHeaderStatusResult.value.kind === "warning");
const pathfindingHeaderStatusIsSuccess = computed(() => pathfindingHeaderStatusResult.value.kind === "success");

const trajectoryObstacleHitIndex = computed(() => {
  const obstacleHitIndex = trajectorySampleResult.value?.obstacleHitIndex ?? -1;
  const targetHitIndex = trajectoryTargetHitIndex.value;
  // 目标之后才撞障碍不影响“当前路径命中目标”的提示，保持旧预览语义。
  return targetHitIndex >= 0 && obstacleHitIndex >= targetHitIndex ? -1 : obstacleHitIndex;
});

const plottedCurvePoints = computed(() => {
  if (!trajectorySample.value || !parsedBounds.value.ok) {
    return "";
  }

  const { bounds } = parsedBounds.value;
  const hitIndex = trajectoryObstacleHitIndex.value;
  const points = hitIndex >= 0 ? trajectorySample.value.points.slice(0, hitIndex + 1) : trajectorySample.value.points;
  return points
    .map((point) => {
      const pixel = graphToImagePoint(point, bounds, boundsRect.value);
      return `${formatSvgNumber(pixel.x)},${formatSvgNumber(pixel.y)}`;
    })
    .join(" ");
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
const pathLineSegments = computed<PathLineSegment[]>(() => {
  const radius = soldierSelectionRadius.value;
  const segments: PathLineSegment[] = [];
  for (let index = 1; index < pathPixels.value.length; index += 1) {
    const start = pathPixels.value[index - 1];
    const end = pathPixels.value[index];
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
});
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

function nowMs() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

onMounted(() => {
  window.addEventListener("paste", handlePaste);
});

onBeforeUnmount(() => {
  window.removeEventListener("paste", handlePaste);
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
  clearDetectionSoldierFlash();
  if (obstacleEditRefreshTimer) {
    clearTimeout(obstacleEditRefreshTimer);
  }
  clearSmartPathfindingBlockedPoint();
});

watch([obstacleMinAreaText], () => {
  clearSmartPathfindingStatus();
  scheduleGraphwarObjectDetection();
});

watch([formulaOutputDecimalPlaces], () => {
  clearSmartPathfindingStatus();
  if (!parsedPrecision.value.ok) {
    return;
  }
  if (pathPixels.value.length >= 2) {
    const normalizedPath = normalizePathForMinimumXStep(pathPixels.value);
    pathPixels.value = normalizedPath;
    pathStatus.value = pathFollowsGraphRule(normalizedPath) ? "" : getForwardPathMessage();
  }
});

watch([algorithmMode, solverEquationMode], () => {
  clearSmartPathfindingStatus();
  if (algorithmMode.value === "step" && pathfindingMode.value !== "off") {
    cancelSmartPathfinding(false);
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
    obstacleRouteMinToleranceText,
    obstacleRouteMaxToleranceText,
    obstacleRouteStepToleranceText,
    pathfindingBoundaryExpansionText,
    minXText,
    maxXText,
    minYText,
    maxYText,
  ],
  () => {
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

/** 清除识别对象和依赖缓存；不改变检测状态文字。 */
function clearDetectedGraphwarObjects() {
  detectedSoldiers.value = [];
  detectedObstacles.value = undefined;
  baselineDetectedObstacles.value = undefined;
  clearDetectionSoldierFlash();
  obstacleEditsDirty.value = false;
  obstacleBrushPointerPoint.value = undefined;
  obstacleBrushDragging.value = false;
  obstacleBrushLastPlanePoint.value = undefined;
  hoveredDetectedSoldierId.value = undefined;
  clearSmartPathfindingStatus();
  clearObstacleEditRefreshTimer();
}

function beginDetectionRun() {
  detectionRunId += 1;
  detectionInProgress.value = true;
  return detectionRunId;
}

function isActiveDetectionRun(runId: number) {
  return runId === detectionRunId;
}

function finishDetectionRun(runId: number) {
  if (isActiveDetectionRun(runId)) {
    detectionInProgress.value = false;
  }
}

function cancelDetection(showStatus: boolean) {
  if (!detectionInProgress.value) {
    return false;
  }

  detectionRunId += 1;
  detectionInProgress.value = false;
  if (showStatus) {
    setDetectionStatus(locale.status.detection.cancelled, "warning");
  }
  return true;
}

function setDetectionStatus(message: string, kind: DetectionStatusKind) {
  detectionStatus.value = message;
  detectionStatusKind.value = kind;
}

function waitForDetectionStatusPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

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
function getGraphwarDetectionInput() {
  if (!imageRef.value || !imageUrl.value) {
    setDetectionStatus(locale.status.detection.uploadFirst, "error");
    return undefined;
  }

  const imageData = getImageDataFromCurrentImage();
  if (!imageData) {
    setDetectionStatus(locale.status.detection.noPixels, "error");
    return undefined;
  }
  const obstacleThresholds = parsedObstacleThresholds.value;
  if (!obstacleThresholds.ok) {
    setDetectionStatus(obstacleThresholds.message, "error");
    return undefined;
  }
  return { imageData, obstacleThresholds };
}

/** 使用 Canvas 像素自动检测 Graphwar 棋盘边界，再按该边界识别士兵和障碍。 */
async function detectGraphwarObjects() {
  const runId = beginDetectionRun();
  const startedAt = nowMs();
  try {
    if (!(await showDetectionStage(runId, locale.status.detection.preparingPixels))) {
      return;
    }
    const detectionInput = getGraphwarDetectionInput();
    if (!detectionInput || !isActiveDetectionRun(runId)) {
      return;
    }

    if (!(await showDetectionStage(runId, locale.status.detection.detectingBounds))) {
      return;
    }
    const edgeRect = detectGraphwarPlayArea(detectionInput.imageData);
    if (!isActiveDetectionRun(runId)) {
      return;
    }
    if (!edgeRect) {
      clearDetectedGraphwarObjects();
      setDetectionStatus(locale.status.detection.noBounds, "error");
      return;
    }

    boundsRect.value = edgeRect;
    boundsFirstPoint.value = undefined;
    pointerPreviewPoint.value = undefined;
    await detectGraphwarObjectsInBounds(
      detectionInput.imageData,
      edgeRect,
      detectionInput.obstacleThresholds,
      "auto",
      runId,
      true,
      startedAt,
    );
    if (!isActiveDetectionRun(runId)) {
      return;
    }
    toolMode.value = "path";
  } finally {
    finishDetectionRun(runId);
  }
}

/** 在当前手动/自动边界内重新识别对象，不重新推断棋盘区域。 */
async function detectGraphwarObjectsInCurrentBounds() {
  const runId = beginDetectionRun();
  const startedAt = nowMs();
  try {
    if (!(await showDetectionStage(runId, locale.status.detection.preparingPixels))) {
      return;
    }
    const detectionInput = getGraphwarDetectionInput();
    if (!detectionInput || !isActiveDetectionRun(runId)) {
      return;
    }

    await detectGraphwarObjectsInBounds(
      detectionInput.imageData,
      boundsRect.value,
      detectionInput.obstacleThresholds,
      "current",
      runId,
      false,
      startedAt,
    );
  } finally {
    finishDetectionRun(runId);
  }
}

/** 在指定棋盘矩形内更新士兵/障碍状态。 */
async function detectGraphwarObjectsInBounds(
  imageData: ImageData,
  edgeRect: BoundsRect,
  obstacleThresholds: Extract<ParsedObstacleThresholds, { ok: true }>,
  source: "auto" | "current",
  runId: number,
  flashBounds = false,
  startedAt = nowMs(),
) {
  clearSmartPathfindingStatus();
  if (!(await showDetectionStage(runId, locale.status.detection.detectingObjects))) {
    return;
  }
  const result = detectGraphwarObjectsFromImage(imageData, edgeRect, obstacleThresholds);
  if (!isActiveDetectionRun(runId)) {
    return;
  }
  if (!(await showDetectionStage(runId, locale.status.detection.updatingResults))) {
    return;
  }
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
  const elapsed = formatElapsedDuration(nowMs() - startedAt);
  setDetectionStatus(
    source === "auto"
      ? locale.status.detection.detectedWithAutoBounds(detectedSoldiers.value.length, result.obstacles.count, elapsed)
      : locale.status.detection.detectedCurrentBounds(detectedSoldiers.value.length, result.obstacles.count, elapsed),
    "success",
  );
}

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

function cloneDetectedObstacleMap(obstacles: DetectedObstacleMap): DetectedObstacleMap {
  return {
    count: obstacles.count,
    mask: new Uint8Array(obstacles.mask),
  };
}

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

function setObstacleBrushDiameterText(value: string) {
  obstacleBrushDiameterText.value = value;
}

function handleObstacleBrushDiameterInput(event: Event) {
  const input = event.target;
  if (input instanceof HTMLInputElement) {
    setObstacleBrushDiameterText(input.value);
  }
}

function setMagnifierZoomText(value: string) {
  magnifierZoomText.value = value;
}

function handleMagnifierZoomInput(event: Event) {
  const input = event.target;
  if (input instanceof HTMLInputElement) {
    setMagnifierZoomText(input.value);
  }
}

function toggleObstacleBrushErase() {
  obstacleBrushEraseEnabled.value = !obstacleBrushEraseEnabled.value;
}

function resetObstacleEdits() {
  const baseline = baselineDetectedObstacles.value;
  if (!baseline) {
    return;
  }

  cancelSmartPathfinding(false);
  clearSmartPathfindingStatus();
  clearObstacleEditRefreshTimer();
  detectedObstacles.value = cloneDetectedObstacleMap(baseline);
  obstacleEditsDirty.value = false;
  setDetectionStatus(locale.status.detection.obstacleEditsCleared(baseline.count), "success");
}

function updateObstacleBrushPreview(point: PixelPoint) {
  obstacleBrushPointerPoint.value = pointIsInsideBoundsRect(point, boundsRect.value)
    ? planeGridCellCenterToImagePoint(imagePointToPlaneGridPoint(point, boundsRect.value), boundsRect.value)
    : undefined;
}

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

  detectedObstacles.value = {
    count: obstacleMap.count,
    mask: nextMask,
  };
  obstacleEditsDirty.value = true;
  scheduleObstacleEditRefresh();
  return true;
}

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
    : (locale.pathfindingModes.find((entry) => entry.value === "smart")?.title ?? "");
}

/** 切换友伤设置；该设置会改变士兵是否写入障碍 mask，因此需要重建路线。 */
function toggleFriendlyFire() {
  if (smartPathfindingInProgress.value) {
    cancelSmartPathfinding(false);
  }
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
    clearSmartPathfindingBlockedPoint();
    pathPixels.value = [normalizePathPoint(point, boundsRect.value, parsedBounds.value.bounds, undefined, 0)];
    pathStatus.value = "";
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
    clearSmartPathfindingBlockedPoint();
    pathPixels.value = [nextPoint];
    pathStatus.value = "";
    clearSmartPathfindingStatus();
    return true;
  }

  if (effectiveSmartPathfindingEnabled.value) {
    if (!ensureCurrentPathReachesLastPointBeforeSmartPathfinding()) {
      return false;
    }

    const pathfindingToken = startSmartPathfinding();
    const startedAt = performance.now();
    let normalizedPath: PixelPoint[] | undefined;
    try {
      normalizedPath = await buildSmartPathfindingPath(nextPoint, pathfindingToken);
      if (pathfindingToken !== smartPathfindingCancelToken) {
        return false;
      }
    } finally {
      if (pathfindingToken === smartPathfindingCancelToken) {
        smartPathfindingInProgress.value = false;
        clearSmartPathfindingPreview();
      }
    }

    if (!normalizedPath) {
      setSmartPathfindingStatus(getSmartPathfindingFailureMessage(performance.now() - startedAt), "error");
      return false;
    }

    setPathPixels(normalizedPath);
    setSmartPathfindingStatus(getSmartPathfindingSuccessMessage(performance.now() - startedAt), "success");
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

/** 针对士兵目标尝试多个可命中点，避免只瞄中心时被障碍或最小 x 步长卡住。 */
async function appendDetectedSoldierSmartPathfindingPoint(soldier: DetectionBox) {
  if (!parsedBounds.value.ok) {
    return false;
  }

  const sourcePath = [...pathPixels.value];
  const startPoint = sourcePath.at(-1);
  if (!startPoint) {
    return false;
  }

  if (!ensureCurrentPathReachesLastPointBeforeSmartPathfinding()) {
    return false;
  }

  const targets = createSmartPathfindingSoldierTargets(startPoint, soldier);
  if (targets.length === 0) {
    setSmartPathfindingStatus(getSmartPathfindingFailureMessage(), "error");
    return false;
  }

  const pathfindingToken = startSmartPathfinding();
  const startedAt = performance.now();
  let normalizedPath: PixelPoint[] | undefined;
  try {
    for (const target of targets) {
      normalizedPath = await buildSmartPathfindingPath(target, pathfindingToken);
      if (pathfindingToken !== smartPathfindingCancelToken) {
        return false;
      }
      if (normalizedPath) {
        break;
      }
    }
  } finally {
    if (pathfindingToken === smartPathfindingCancelToken) {
      smartPathfindingInProgress.value = false;
      clearSmartPathfindingPreview();
    }
  }

  if (!normalizedPath) {
    setSmartPathfindingStatus(getSmartPathfindingFailureMessage(performance.now() - startedAt), "error");
    return false;
  }

  setPathPixels(normalizedPath);
  setSmartPathfindingStatus(getSmartPathfindingSuccessMessage(performance.now() - startedAt), "success");
  return true;
}

/** 路径变更后同步落地并清空旧状态。 */
function setPathPixels(points: PixelPoint[]) {
  clearSmartPathfindingBlockedPoint();
  pathPixels.value = points;
  pathStatus.value = "";
}

/** 在当前障碍 mask 上为目标构造几何路径，并用真实弹道验证后返回可用路径。 */
async function buildSmartPathfindingPath(target: PixelPoint | SmartPathfindingTarget, cancelToken: number) {
  const boundsResult = parsedBounds.value;
  if (!boundsResult.ok) {
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

  // 从最小外扩到最大外扩逐级尝试：优先保守贴近目标，失败再给障碍更多安全距离。
  for (const routeTolerance of collectSmartPathfindingRouteTolerances(tolerances)) {
    setSmartPathfindingPhase("search");
    smartPathfindingActiveRouteTolerance.value = routeTolerance;
    await waitForNextPathfindingSlice();
    if (cancelToken !== smartPathfindingCancelToken) {
      return undefined;
    }

    const routeMaskEntry = getCachedRouteMask(obstacleMask, routeTolerance);
    const routeMask = routeMaskEntry.mask;
    const pathfindingPath = await buildSmartPathfindingPathForMask({
      bounds: boundsResult.bounds,
      boundsRect: boundsRect.value,
      boundaryExpansion: tolerances.boundaryExpansionPlanePixels,
      canAdvance: pathfindingPlaneSegmentAdvancesEnough,
      isCancelled: () => cancelToken !== smartPathfindingCancelToken,
      onPreview: searchAnimationEnabled.value ? setSmartPathfindingPreview : undefined,
      routeMask,
      routeTolerancePlanePixels: routeTolerance,
      startPoint,
      targetPoint,
      yieldControl: waitForNextPathfindingSlice,
    });
    if (!pathfindingPath || pathfindingPath.length < 2) {
      continue;
    }

    const normalizedPath = createNormalizedPathFromPlanePath(pathfindingPath, targetPoint, sourcePath);
    if (!pathFollowsGraphRule(normalizedPath)) {
      setSmartPathfindingStatus(getForwardPathMessage(), "error");
      return undefined;
    }

    if (searchAnimationEnabled.value) {
      setSmartPathfindingPreviewPath(getSmartPathfindingAppendedSegment(normalizedPath, sourcePath.length));
    }
    setSmartPathfindingPhase("trajectory");
    if (pathTrajectoryReachesTargetBeforeSimulationObstacle(normalizedPath, hitTarget)) {
      return normalizedPath.length > 3
        ? optimizeSmartPathfindingPath(normalizedPath, sourcePath.length, cancelToken, hitTarget)
        : normalizedPath;
    }
  }
  return undefined;
}

/** 判断平面候选线段是否满足当前 Graphwar 输出精度下的 x+ 最小步长。 */
function pathfindingPlaneSegmentAdvancesEnough(previous: PlaneGridPoint, next: PlaneGridPoint) {
  if (!parsedBounds.value.ok) {
    return false;
  }

  const previousGraphX = planeGridPointToGraphX(previous);
  const nextGraphX = planeGridPointToGraphX(next);
  return pathAdvancesEnough(nextGraphX - previousGraphX, previousGraphX, nextGraphX);
}

/** 将固定 770x450 平面 x 转换为当前 Graphwar 游戏 x。 */
function planeGridPointToGraphX(point: PlaneGridPoint) {
  const bounds = parsedBounds.value.ok ? parsedBounds.value.bounds : undefined;
  if (!bounds) {
    return Number.NaN;
  }

  return bounds.minX + ((point.x + 0.5) / GRAPHWAR_PLANE_LENGTH) * (bounds.maxX - bounds.minX);
}

/** 提取新增路径段并保留连接点，供搜索动画绘制。 */
function getSmartPathfindingAppendedSegment(points: readonly PixelPoint[], sourcePathLength: number) {
  return points.slice(Math.max(0, sourcePathLength - 1));
}

/** 将平面 DP 结果转回截图路径，并按最小 x 步长规范化。 */
function createNormalizedPathFromPlanePath(
  pathfindingPath: PlaneGridPoint[],
  targetPoint: PixelPoint,
  sourcePath: readonly PixelPoint[],
) {
  const appendPoints = pathfindingPath
    .slice(1)
    .map((pathPoint, index, points) =>
      index === points.length - 1 ? targetPoint : planeGridCellCenterToImagePoint(pathPoint, boundsRect.value),
    );
  return normalizePathForMinimumXStep([...sourcePath, ...appendPoints]);
}

/** 判断路径生成的 Graphwar 轨迹是否在撞模拟障碍前命中目标。 */
function pathTrajectoryReachesTargetBeforeSimulationObstacle(
  points: PixelPoint[],
  hitTarget: PixelPoint | HitCircle | undefined = points.at(-1),
) {
  return createPathTrajectoryResult(points, hitTarget).reachesTargetBeforeObstacle;
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

/** 几何路径通常点数偏多，逐点尝试删除并用真实轨迹验证，缩短最终公式。 */
async function optimizeSmartPathfindingPath(
  points: PixelPoint[],
  sourcePathLength: number,
  cancelToken: number,
  hitTarget: PixelPoint | HitCircle | undefined = points.at(-1),
) {
  let optimized = [...points];
  let changed = true;
  const firstOptimizableIndex = Math.max(1, sourcePathLength);
  clearSmartPathfindingSearchPreview();
  setSmartPathfindingPhase("optimize");
  while (changed) {
    changed = false;
    for (let index = firstOptimizableIndex; index < optimized.length - 1 && optimized.length > 2; index += 1) {
      if (cancelToken !== smartPathfindingCancelToken) {
        return undefined;
      }

      if (searchAnimationEnabled.value) {
        setPathfindingOptimizationPreviewPoint(optimized[index]);
      }
      await waitForNextPathfindingSlice();
      if (cancelToken !== smartPathfindingCancelToken) {
        return undefined;
      }

      const candidatePath = [...optimized.slice(0, index), ...optimized.slice(index + 1)];
      if (searchAnimationEnabled.value) {
        setSmartPathfindingPreviewPath(getSmartPathfindingAppendedSegment(candidatePath, sourcePathLength));
      }
      if (
        pathFollowsGraphRule(candidatePath) &&
        pathTrajectoryReachesTargetBeforeSimulationObstacle(candidatePath, hitTarget)
      ) {
        optimized = candidatePath;
        if (searchAnimationEnabled.value) {
          setSmartPathfindingPreviewPath(getSmartPathfindingAppendedSegment(optimized, sourcePathLength));
        }
        changed = true;
        break;
      }
    }
  }
  setPathfindingOptimizationPreviewPoint(undefined);
  return optimized;
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

  // 第二检查只把命中圈 x+ 边缘当作“是否可选中”的资格线；
  // 真正落点固定为 lastX + 最小精度，y 保持命中圈中心，避免点击偏移改变目标。
  if (!soldierAimXReachesMinimumForward(createSoldierHitCircleXPlusEdgePoint(box), startPoint)) {
    return undefined;
  }

  const minimumForwardPoint = createMinimumForwardSoldierTargetPoint(startPoint, box);
  return minimumForwardPoint ? { kind: "edge", point: minimumForwardPoint } : undefined;
}

/** 判断一个士兵候选点是否至少达到 lastX + 最小精度，并且没有越出收缩边界。 */
function soldierAimPointPassesMinimumForwardCheck(point: PixelPoint, startPoint: PixelPoint) {
  return pointIsInsideTargetBounds(point) && soldierAimXReachesMinimumForward(point, startPoint);
}

/** 判断一个士兵候选点的 x 是否至少达到 lastX + 最小精度。 */
function soldierAimXReachesMinimumForward(point: PixelPoint, startPoint: PixelPoint) {
  if (!parsedBounds.value.ok) {
    return false;
  }

  const pointGraph = imageToGraphPoint(point, parsedBounds.value.bounds, boundsRect.value);
  return graphXReachesMinimumForward(pointGraph.x, startPoint);
}

/** 返回士兵命中圈在 x+ 方向上的边缘点，y 固定为命中圈中心。 */
function createSoldierHitCircleXPlusEdgePoint(box: DetectionBox) {
  const center = getDetectionBoxCenter(box);
  const xPlusIsRight = parsedBounds.value.ok ? xPlusGoesRight(parsedBounds.value.bounds) : true;
  return createPixelPoint(center.x + (xPlusIsRight ? box.hitRadius : -box.hitRadius), center.y);
}

/** 构造可击中士兵的候选目标点：按通过的检查结果从起始 x 扫到命中圈 x+ 右端。 */
function createSmartPathfindingSoldierTargets(startPoint: PixelPoint, box: DetectionBox) {
  const firstCheck = createSoldierAimCheckResult(startPoint, box);
  if (!firstCheck) {
    return [];
  }

  const hitCircle = createSoldierHitCircle(box);
  return collectSmartPathfindingSoldierXTargets(firstCheck.point, box, hitCircle);
}

/** 从首个可瞄点沿 x+ 方向搜索到命中圈右端，给智能寻路逐点尝试。 */
function collectSmartPathfindingSoldierXTargets(startPoint: PixelPoint, box: DetectionBox, hitCircle: HitCircle) {
  const boundsResult = parsedBounds.value;
  const tolerances = parsedObstacleTolerances.value;
  if (!boundsResult.ok || !tolerances.ok) {
    return [];
  }

  const pixelStep = getSmartPathfindingTargetImageXStep();
  if (pixelStep <= 0) {
    return [];
  }

  const targets: SmartPathfindingTarget[] = [];
  const center = getDetectionBoxCenter(box);
  const xPlusIsRight = xPlusGoesRight(boundsResult.bounds);
  const direction = xPlusIsRight ? 1 : -1;
  const edgeX = center.x + direction * box.hitRadius;
  // 士兵目标只在命中圈中心水平线上搜索：先试规则选出的起点，
  // 再按当前输出精度允许的最小 x 步长推向 x+ 边缘，
  // 让寻路失败时换目标但不改变 y。
  const maxSteps = Math.ceil(Math.abs(edgeX - startPoint.x) / pixelStep) + 1;
  for (let step = 0; step <= maxSteps; step += 1) {
    const rawX = startPoint.x + direction * pixelStep * step;
    const targetX = xPlusIsRight ? Math.min(rawX, edgeX) : Math.max(rawX, edgeX);
    const targetPoint = createPixelPoint(targetX, center.y);
    if (!pointIsInsideTargetBounds(targetPoint) || !detectionBoxContainsHitCircle(box, targetPoint)) {
      break;
    }

    targets.push({ hitCircle, targetPoint });

    if (targetX === edgeX) {
      break;
    }
  }
  return targets;
}

/** 将当前 Graphwar 最小 x 精度换算为士兵命中圈目标枚举的截图像素步长。 */
function getSmartPathfindingTargetImageXStep() {
  if (!parsedBounds.value.ok) {
    return 0;
  }

  return Math.max(
    1,
    Math.abs(minimumPathGraphXStep.value / (parsedBounds.value.bounds.maxX - parsedBounds.value.bounds.minX)) *
      boundsRect.value.width,
  );
}

function createSoldierHitCircle(box: DetectionBox): HitCircle {
  return {
    center: getDetectionBoxCenter(box),
    radius: box.hitRadius,
  };
}

/** 获取指定 route tolerance 的寻路 mask。 */
function getCachedRouteMask(mask: Uint8Array, routeTolerance: number): RouteMaskCacheEntry {
  const key = createRouteMaskCacheKey(routeTolerance);
  let entries = routeMaskCache.get(mask);
  if (!entries) {
    entries = new Map<string, RouteMaskCacheEntry>();
    routeMaskCache.set(mask, entries);
  }

  const cached = entries.get(key);
  if (cached) {
    return cached;
  }

  const entry = {
    mask: dilateObstacleMask(mask, routeTolerance),
  };
  entries.set(key, entry);
  return entry;
}

/** 开始一次异步寻路/清图任务并返回取消 token。 */
function startSmartPathfinding(message?: string) {
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

/** 设置当前正在尝试删除的路径点预览。 */
function setPathfindingOptimizationPreviewPoint(point: PixelPoint | undefined) {
  pathfindingOptimizationPreviewPoint.value = point;
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
  smartPathfindingActiveRouteTolerance.value = parsedObstacleTolerances.value.ok
    ? parsedObstacleTolerances.value.routeMinTolerancePlanePixels
    : undefined;
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
  smartPathfindingActiveRouteTolerance.value = undefined;
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
  const horizontalInset = (Math.max(0, boundaryExpansion) / GRAPHWAR_PLANE_LENGTH) * rect.width;
  const verticalInset = (Math.max(0, boundaryExpansion) / GRAPHWAR_PLANE_HEIGHT) * rect.height;
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

/** 返回当前起点向 x+ 前进最小步长后的 Graphwar x，最小步长严格由当前输出小数位决定。 */
function getMinimumForwardGraphX(startPoint: PixelPoint) {
  if (!parsedBounds.value.ok) {
    return undefined;
  }

  const startGraph = imageToGraphPoint(startPoint, parsedBounds.value.bounds, boundsRect.value);
  const roundedStartX = roundToDecimalPlaces(startGraph.x, formulaOutputDecimalPlaces.value);
  return roundToDecimalPlaces(roundedStartX + minimumPathGraphXStep.value, formulaOutputDecimalPlaces.value);
}

/** 判断 Graphwar x 是否已经到达“最后一个输出 x + 当前小数位最小精度”这条线。 */
function graphXReachesMinimumForward(graphX: number, startPoint: PixelPoint) {
  const minimumGraphX = getMinimumForwardGraphX(startPoint);
  if (minimumGraphX === undefined) {
    return false;
  }

  return graphX + doublePrecisionTolerance(graphX, minimumGraphX) >= minimumGraphX;
}

/** 返回当前起点向 x+ 前进最小步长后的截图 x；超出边界时仍返回理论 x，调用方负责边界判断。 */
function getMinimumForwardPixelX(startPoint: PixelPoint) {
  if (!parsedBounds.value.ok) {
    return undefined;
  }

  const minimumGraphX = getMinimumForwardGraphX(startPoint);
  if (minimumGraphX === undefined) {
    return undefined;
  }
  return graphToImagePoint(createGraphPoint(minimumGraphX, 0), parsedBounds.value.bounds, boundsRect.value).x;
}

/** 按指定起点把 x 不够的目标改为同 y 的最小 x+ 步长点；无剩余空间时返回 undefined。 */
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
  const minForwardPixelX = getMinimumForwardPixelX(startPoint);
  if (minForwardPixelX === undefined) {
    return undefined;
  }

  // 设计意图：非士兵点击如果落在 x+ 打击范围左侧，只把目标移到
  // “最后一个路径点的输出 x + 当前小数位最小精度”，y 保持点击值；
  // 这里不做障碍、寻路或额外命中判断，只检查最终 xy 是否仍在可用边界内。
  const pixelX = graphXReachesMinimumForward(targetGraph.x, startPoint) ? point.x : minForwardPixelX;
  const targetPoint = createPixelPoint(pixelX, point.y);
  return pointIsInsideTargetBounds(targetPoint) ? targetPoint : undefined;
}

/** 生成 x+ 最小步长处、且 y 保持士兵命中圈中心的目标点。 */
function createMinimumForwardSoldierTargetPoint(startPoint: PixelPoint, box: DetectionBox) {
  const minForwardPixelX = getMinimumForwardPixelX(startPoint);
  if (minForwardPixelX === undefined) {
    return undefined;
  }

  const center = getDetectionBoxCenter(box);
  const targetPoint = createPixelPoint(minForwardPixelX, center.y);
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

/** 判断检测框是否包含任一路径点。 */
function detectionBoxMatchesAnySelectedPathPoint(box: DetectionBox) {
  if (pathPixels.value.length === 0) {
    return false;
  }

  return pathPixels.value.some((point) => detectionBoxContainsPathPoint(box, point));
}

/** 当前规则下 x<0 的未选士兵视为友方障碍。 */
function isDetectedFriendlySoldierObstacle(box: DetectionBox) {
  if (!parsedBounds.value.ok || detectionBoxMatchesAnySelectedPathPoint(box)) {
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
  const nextPoint = normalizePathPoint(
    point,
    boundsRect.value,
    parsedBounds.value.bounds,
    previousPoint,
    minimumPathGraphXStep.value,
  );
  if (!nextPoint) {
    return false;
  }

  const nextPath = [...pathPixels.value];
  nextPath[index] = nextPoint;
  const normalizedPath = normalizePathForMinimumXStep(nextPath);
  if (!pathFollowsGraphRule(normalizedPath)) {
    pathStatus.value = getForwardPathMessage();
    return false;
  }

  pathPixels.value = normalizedPath;
  pathStatus.value = "";
  return true;
}

/** 读取路径点坐标输入框文本。 */
function getPathPointCoordinateText(index: number, axis: PathPointCoordinateAxis) {
  return getPathPointCoordinateTextState(index, axis);
}

/** 同步坐标输入框文本；正在编辑的单元格保留原输入。 */
function syncPathPointCoordinateTexts() {
  syncPathPointCoordinateTextState({
    decimalPlaces: visibleDecimalPlaces.value,
    formatCoordinate: formatDecimal,
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
    decimalPlaces: visibleDecimalPlaces.value,
    formatCoordinate: formatDecimal,
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

/** 按当前输出精度把整条路径推进到 Graphwar 可采样的最小 x 步长。 */
function normalizePathForMinimumXStep(points: readonly PixelPoint[]) {
  if (!parsedBounds.value.ok || points.length < 2) {
    return [...points];
  }

  // 按路径序号从低到高推进，保证每个后续点至少比前一点前进一个输出精度步长。
  const normalizedPoints = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const previousPoint = normalizedPoints.at(-1);
    normalizedPoints.push(
      normalizePathPoint(
        points[index],
        boundsRect.value,
        parsedBounds.value.bounds,
        previousPoint,
        minimumPathGraphXStep.value,
      ),
    );
  }
  return normalizedPoints;
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
  return true;
}

/** 跟踪指针位置，用于边界预览和放大镜。 */
function handleStagePointerMove(event: PointerEvent) {
  const point = getImagePointFromEvent(event);
  if (!point) {
    return;
  }

  if (magnifierEnabled.value) {
    magnifierPoint.value = point;
  }
  if (toolMode.value === "obstacle") {
    updateObstacleBrushPreview(point);
    if (obstacleBrushDragging.value) {
      paintObstacleBrushAtPoint(point, true);
    }
    hoveredPathPointIndex.value = undefined;
    hoveredDetectedSoldierId.value = undefined;
    return;
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

  const deltaX = nextPoint.x - previousPoint.x;
  if (pathAdvancesEnough(deltaX, previousPoint.x, nextPoint.x)) {
    return true;
  }

  pathStatus.value = getForwardPathMessage();
  return false;
}

/** 验证整条路径是否始终满足 Graphwar 最小 x+ 步长。 */
function pathFollowsGraphRule(points: PixelPoint[]) {
  if (!parsedBounds.value.ok || points.length < 2) {
    return true;
  }

  for (let index = 1; index < points.length; index += 1) {
    const previousPoint = imageToGraphPoint(points[index - 1], parsedBounds.value.bounds, boundsRect.value);
    const nextPoint = imageToGraphPoint(points[index], parsedBounds.value.bounds, boundsRect.value);
    const deltaX = nextPoint.x - previousPoint.x;
    if (!pathAdvancesEnough(deltaX, previousPoint.x, nextPoint.x)) {
      return false;
    }
  }
  return true;
}

/** 判断相邻两个 Graphwar x 差是否达到当前输出精度的最小步长。 */
function pathAdvancesEnough(deltaX: number, previousX?: number, nextX?: number) {
  if (previousX !== undefined && nextX !== undefined) {
    const roundedPreviousX = roundToDecimalPlaces(previousX, formulaOutputDecimalPlaces.value);
    const roundedNextX = roundToDecimalPlaces(nextX, formulaOutputDecimalPlaces.value);
    // 设计意图：Graphwar 最终只看到按“保留小数位”输出的路径点；
    // 因此最小精度比较也必须基于这些输出坐标，而不是截图换算出的原始 double。
    return graphXAdvancesEnough(
      roundedNextX - roundedPreviousX,
      minimumPathGraphXStep.value,
      roundedPreviousX,
      roundedNextX,
    );
  }

  return graphXAdvancesEnough(deltaX, minimumPathGraphXStep.value, deltaX);
}

/** 返回路径必须向 x+ 前进的本地化提示。 */
function getForwardPathMessage() {
  return locale.smartPathfinding.forwardPath(
    formatDecimal(minimumPathGraphXStep.value, formulaOutputDecimalPlaces.value),
  );
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
function getSmartPathfindingSuccessMessage(elapsedMs?: number) {
  return locale.smartPathfinding.success(elapsedMs === undefined ? undefined : formatElapsedDuration(elapsedMs));
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

/** 清除全部已选路径点，但不改变图片边界和设定。 */
function clearPath() {
  cancelSmartPathfinding(false);
  clearSmartPathfindingStatus();
  clearSmartPathfindingBlockedPoint();
  clearActivePathState();
}

/** 清除公式生成和模拟器两种模式的路径状态。 */
function clearAllModePaths() {
  cancelSmartPathfinding(false);
  clearSmartPathfindingStatus();
  clearSmartPathfindingBlockedPoint();
  clearAllPathState();
}

/** 删除最新选择的路径点。 */
function undoLastPoint() {
  if (pathPixels.value.length === 0) {
    return;
  }

  cancelSmartPathfinding(false);
  clearSmartPathfindingStatus();
  clearSmartPathfindingBlockedPoint();
  undoActivePathPoint();
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
        <span :class="{ 'graphwar-killer__label-status--error': settingsHeaderStatusIsError }">
          {{ settingsHeaderStatus }}
        </span>
      </div>
      <div class="graphwar-killer__setting-row">
        <span class="graphwar-killer__setting-label">{{ locale.ui.settings.mode }}</span>
        <div
          class="graphwar-killer__tool-toggle graphwar-killer__mode-toggle"
          :class="{ 'graphwar-killer__tool-toggle--path': toolWorkflowMode === 'simulator' }"
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
            @click="advancedSettingsVisible = !advancedSettingsVisible"
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
            :class="{
              'graphwar-killer__label-status--error': detectionHeaderStatusIsError,
              'graphwar-killer__label-status--warning': detectionHeaderStatusIsWarning,
              'graphwar-killer__label-status--success': detectionHeaderStatusIsSuccess,
            }"
          >
            {{ detectionHeaderStatus }}
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
        <div class="graphwar-killer__image-actions">
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
            disabled
            aria-pressed="false"
            :title="autoGraphPathfindingDisabledMessage"
          >
            {{ locale.ui.pathfinding.autoGraph }}
          </button>
        </div>
        <div
          v-if="smartPathfindingEnabled"
          class="graphwar-killer__pathfinding-settings"
        >
          <details class="graphwar-killer__subpanel graphwar-killer__details">
            <summary
              id="graphwar-killer-obstacle-expansion-title"
              :title="locale.ui.pathfinding.obstacleExpansionTitle"
            >
              {{ locale.ui.pathfinding.obstacleExpansion }}
            </summary>
            <div class="graphwar-killer__pathfinding-setting-grid">
              <div class="graphwar-killer__pathfinding-range-row">
                <label
                  class="graphwar-killer__detection-setting-label"
                  :title="locale.ui.pathfinding.pathMinimumTitle"
                >
                  {{ locale.ui.pathfinding.pathMinimum }}
                  <input
                    v-model="obstacleRouteMinToleranceText"
                    inputmode="decimal"
                    :aria-label="locale.ui.pathfinding.pathMinimumAriaLabel"
                    :title="locale.ui.pathfinding.pathMinimumTitle"
                  >
                  <span>{{ locale.ui.pathfinding.unit }}</span>
                </label>
                <label
                  class="graphwar-killer__detection-setting-label"
                  :title="locale.ui.pathfinding.pathMaximumTitle"
                >
                  {{ locale.ui.pathfinding.pathMaximum }}
                  <input
                    v-model="obstacleRouteMaxToleranceText"
                    inputmode="decimal"
                    :aria-label="locale.ui.pathfinding.pathMaximumAriaLabel"
                    :title="locale.ui.pathfinding.pathMaximumTitle"
                  >
                  <span>{{ locale.ui.pathfinding.unit }}</span>
                </label>
              </div>
              <label
                class="graphwar-killer__detection-setting-label"
                :title="locale.ui.pathfinding.expansionStepTitle"
              >
                {{ locale.ui.pathfinding.expansionStep }}
                <input
                  v-model="obstacleRouteStepToleranceText"
                  inputmode="decimal"
                  :aria-label="locale.ui.pathfinding.expansionStepAriaLabel"
                  :title="locale.ui.pathfinding.expansionStepTitle"
                >
                <span>{{ locale.ui.pathfinding.unit }}</span>
              </label>
              <label
                class="graphwar-killer__detection-setting-label"
                :title="locale.ui.pathfinding.simulationExpansionTitle"
              >
                {{ locale.ui.pathfinding.simulationExpansion }}
                <input
                  v-model="obstacleSimulationToleranceText"
                  inputmode="decimal"
                  :aria-label="locale.ui.pathfinding.simulationExpansionAriaLabel"
                  :title="locale.ui.pathfinding.simulationExpansionTitle"
                >
                <span>{{ locale.ui.pathfinding.unit }}</span>
              </label>
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
        <span>{{ activeToolHint }}</span>
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
        <span class="graphwar-killer__image-status-text">
          {{ screenshotImageStatusText }}
        </span>
        <span
          v-if="pathStatus"
          class="graphwar-killer__path-status-text graphwar-killer__label-status--warning"
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
  text-align: right;
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

.graphwar-killer__label-row--image-status {
  align-items: baseline;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr);
}

.graphwar-killer__label-row--image-status > span {
  min-width: 0;
}

.graphwar-killer__image-status-text {
  text-align: left !important;
}

.graphwar-killer__path-status-text {
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

.graphwar-killer__point-label {
  fill: var(--vp-c-text-1);
  font-size: 16px;
  font-weight: 800;
  paint-order: stroke;
  stroke: var(--vp-c-bg);
  stroke-width: 4;
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

.graphwar-killer__magnifier-zoom-label {
  align-items: center;
  flex: 1 1 280px;
  font-weight: 600;
  gap: 6px;
  grid-template-columns: auto minmax(96px, 1fr) minmax(54px, 72px) auto;
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

.graphwar-killer__pathfinding-setting-grid {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.graphwar-killer__pathfinding-range-row {
  display: grid;
  gap: 6px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
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
  grid-template-columns: repeat(3, minmax(92px, 1fr));
  min-height: 34px;
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

.graphwar-killer__algorithm-toggle button {
  font-size: 0.82rem;
  line-height: 1.15;
  min-height: 32px;
  overflow-wrap: anywhere;
  padding: 4px 7px;
  white-space: normal;
}

.graphwar-killer__tool-toggle button {
  background: transparent;
  border: 0;
  border-radius: 999px;
  box-shadow: none;
  color: color-mix(in srgb, var(--vp-c-text-1) 64%, var(--vp-c-text-2) 36%);
  font-size: 0.9rem;
  min-height: 28px;
  padding: 4px 10px;
  position: relative;
  transform: none;
  white-space: nowrap;
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
}
</style>
