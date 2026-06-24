---
aside: false
publish: false
published: 2026-06-23T12:00:00+08:00
---

# Graphwar 杀手

<!-- autocorrect-disable -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { GRAPHWAR_TOOL_SIGN_EPSILON, buildFormula } from "./formula";
import {
  clampPixelPointToCanvas,
  graphToImagePoint,
  imageToGraphPoint,
  isVerticalGraphDelta,
  normalizeBoundsRect,
  normalizePathPoint,
  xPlusGoesRight,
} from "./geometry";
import {
  GRAPHWAR_DEFAULT_X_LIMIT,
  GRAPHWAR_GAME_SOLDIER_RADIUS,
  GRAPHWAR_PLANE_HEIGHT,
  GRAPHWAR_PLANE_LENGTH,
  GRAPHWAR_SOLDIER_RADIUS,
  GRAPHWAR_VISIBLE_Y_LIMIT,
} from "./graphwar";
import {
  DEFAULT_FORMULA_DECIMAL_PLACES,
  MAX_FORMULA_DECIMAL_PLACES,
  clampNumber,
  formatAngleDegree,
  formatDecimal,
  formatSvgNumber,
  nearlyEqual,
  parseFiniteNumber,
  roundToDecimalPlaces,
} from "./numbers";
import { createGraphwarFormulaPathPoints, getGraphwarLaunchAngle, sampleGraphwarTrajectory } from "./simulator";
import { graphwarToolDefaults } from "./tool-defaults";
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
  TransferStatus,
} from "./types";

type ParsedBounds = { ok: true; bounds: GraphBounds } | { ok: false; message: string };
type ParsedSteepness = { ok: true; steepness: number } | { ok: false; message: string };
type ParsedPrecision = { ok: true; decimalPlaces: number } | { ok: false; message: string };
type ParsedObstacleThresholds = { ok: true; minArea: number } | { ok: false; message: string };
interface PathLineSegment {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}
type DetectionKind = "soldier";
interface DetectionBox extends BoundsRect {
  id: string;
  kind: DetectionKind;
}
interface ComponentBox extends BoundsRect {
  area: number;
  yellowArea: number;
  centerX: number;
  centerY: number;
  outerCircleRadius: number;
}
interface AxisGroup {
  start: number;
  end: number;
  coordinate: number;
  score: number;
}
interface AxisTriplet {
  first: AxisGroup;
  middle: AxisGroup;
  last: AxisGroup;
  score: number;
}
interface DetectedObstacleMap {
  mask: Uint8Array;
  count: number;
}
interface PlaneGridPoint {
  x: number;
  y: number;
}

const graphwarDefaultXLimitText = formatDecimal(GRAPHWAR_DEFAULT_X_LIMIT);
const graphwarVisibleYLimitText = formatDecimal(GRAPHWAR_VISIBLE_Y_LIMIT);

const imageUrl = ref("");
const imageName = ref("");
const imageStatus = ref("");
const imageWidth = ref(graphwarToolDefaults.canvasWidth);
const imageHeight = ref(graphwarToolDefaults.canvasHeight);
const imageRef = ref<HTMLImageElement>();
const stageRef = ref<HTMLElement>();
const stageDisplayWidth = ref(graphwarToolDefaults.canvasWidth);
const stageDisplayHeight = ref(graphwarToolDefaults.canvasHeight);
const boundsRect = ref<BoundsRect>({ ...graphwarToolDefaults.boundsRect });
const boundsFirstPoint = ref<PixelPoint>();
const pointerPreviewPoint = ref<PixelPoint>();
const magnifierEnabled = ref(true);
const magnifierPoint = ref<PixelPoint>();
const toolMode = ref<ToolMode>("bounds");
const equationMode = ref<EquationMode>("y");
const algorithmMode = ref<AlgorithmMode>("abs");
const minXText = ref(`-${graphwarDefaultXLimitText}`);
const maxXText = ref(graphwarDefaultXLimitText);
const minYText = ref(`-${graphwarVisibleYLimitText}`);
const maxYText = ref(graphwarVisibleYLimitText);
const steepnessText = ref(String(graphwarToolDefaults.steepness));
const precisionText = ref(String(DEFAULT_FORMULA_DECIMAL_PLACES));
const obstacleMinAreaText = ref(String(graphwarToolDefaults.obstacleMinArea));
const pathPixels = ref<PixelPoint[]>([]);
const pathStatus = ref("");
const draggingPathPointIndex = ref<number>();
const detectionStatus = ref("");
const detectionStatusIsError = ref(false);
const detectedSoldiers = ref<DetectionBox[]>([]);
const detectedObstacles = ref<DetectedObstacleMap>();
const smartCursorEnabled = ref(false);
const hoveredDetectedSoldierId = ref<string>();
const trajectoryStrokeColor = ref("#ec4899");
const copyStatus = ref<TransferStatus>("idle");
let copyStatusTimer: ReturnType<typeof setTimeout> | undefined;
let detectionRefreshTimer: ReturnType<typeof setTimeout> | undefined;

const equationModes = [
  { value: "y", label: "y=", description: "输出阶梯函数" },
  { value: "dy", label: "y'=", description: "输出阶梯函数的一阶导数" },
  { value: "ddy", label: "y''=", description: "输出阶梯函数的二阶导数" },
] as const satisfies readonly { value: EquationMode; label: string; description: string }[];
const algorithmModes = [
  { value: "abs", label: "双绝对值函数" },
  { value: "step", label: "阶梯函数" },
] as const satisfies readonly { value: AlgorithmMode; label: string }[];

const parsedBounds = computed<ParsedBounds>(() => {
  const minX = parseFiniteNumber(minXText.value);
  const maxX = parseFiniteNumber(maxXText.value);
  const minY = parseFiniteNumber(minYText.value);
  const maxY = parseFiniteNumber(maxYText.value);

  if (minX === undefined || maxX === undefined || minY === undefined || maxY === undefined) {
    return { ok: false as const, message: "边界坐标需要填写合法数字" };
  }

  const bounds: GraphBounds = { minX, maxX, minY, maxY };
  if (nearlyEqual(bounds.minX, bounds.maxX) || nearlyEqual(bounds.minY, bounds.maxY)) {
    return { ok: false as const, message: "边界的 x 或 y 范围不能为 0" };
  }

  return { ok: true as const, bounds };
});

const parsedSteepness = computed<ParsedSteepness>(() => {
  const steepness = parseFiniteNumber(steepnessText.value);
  if (steepness === undefined || steepness <= 0) {
    return { ok: false as const, message: "阶梯陡峭度需要是大于 0 的数字" };
  }
  return { ok: true as const, steepness };
});

const parsedPrecision = computed<ParsedPrecision>(() => {
  const decimalPlaces = parseFiniteNumber(precisionText.value);
  if (decimalPlaces === undefined || !Number.isInteger(decimalPlaces)) {
    return { ok: false as const, message: "保留小数位需要填写整数" };
  }
  if (decimalPlaces < 0 || decimalPlaces > MAX_FORMULA_DECIMAL_PLACES) {
    return { ok: false as const, message: `保留小数位需要在 0 到 ${MAX_FORMULA_DECIMAL_PLACES} 之间` };
  }
  return { ok: true as const, decimalPlaces };
});

const parsedObstacleThresholds = computed<ParsedObstacleThresholds>(() => {
  const minArea = parseFiniteNumber(obstacleMinAreaText.value);
  if (minArea === undefined || !Number.isInteger(minArea)) {
    return { ok: false as const, message: "障碍最小面积需要填写整数" };
  }
  if (minArea < 1 || minArea > 50000) {
    return { ok: false as const, message: "障碍最小面积需要在 1 到 50000 之间" };
  }
  return { ok: true as const, minArea };
});

const mappedPathPoints = computed<GraphPoint[]>(() => {
  const boundsResult = parsedBounds.value;
  if (!boundsResult.ok) {
    return [];
  }
  return pathPixels.value.map((point) => imageToGraphPoint(point, boundsResult.bounds, boundsRect.value));
});

const graphwarFormulaPathPoints = computed<GraphPoint[]>(() => {
  if (mappedPathPoints.value.length < 2) {
    return mappedPathPoints.value;
  }

  const steepness = parsedSteepness.value.ok ? parsedSteepness.value.steepness : 1;
  const coefficientDecimalPlaces = parsedPrecision.value.ok
    ? parsedPrecision.value.decimalPlaces
    : DEFAULT_FORMULA_DECIMAL_PLACES;
  return createGraphwarFormulaPathPoints({
    algorithm: algorithmMode.value,
    equation: equationMode.value,
    formulaEvaluation: {
      coefficientDecimalPlaces,
    },
    points: mappedPathPoints.value,
    steepness,
  });
});

const formulaOutputDecimalPlaces = computed(() => (
  parsedPrecision.value.ok ? parsedPrecision.value.decimalPlaces : DEFAULT_FORMULA_DECIMAL_PLACES
));
const formulaOutputSteepness = computed(() => {
  const steepness = parsedSteepness.value.ok ? parsedSteepness.value.steepness : 1;
  return roundToDecimalPlaces(steepness, formulaOutputDecimalPlaces.value);
});
const formulaOutputPathPoints = computed<GraphPoint[]>(() =>
  graphwarFormulaPathPoints.value.map((point) =>
    createGraphPoint(
      roundToDecimalPlaces(point.x, formulaOutputDecimalPlaces.value),
      roundToDecimalPlaces(point.y, formulaOutputDecimalPlaces.value),
    ),
  ),
);

const formulaNeedsSignEpsilon = computed(() => {
  if (
    !parsedBounds.value.ok ||
    (algorithmMode.value === "step" && !parsedSteepness.value.ok) ||
    formulaOutputPathPoints.value.length < 2
  ) {
    return false;
  }

  let hasZeroSignArgument = false;
  sampleGraphwarTrajectory({
    algorithm: algorithmMode.value,
    bounds: parsedBounds.value.bounds,
    equation: equationMode.value,
    formulaEvaluation: {
      coefficientDecimalPlaces: formulaOutputDecimalPlaces.value,
      onSignArgument(value) {
        if (value === 0) {
          hasZeroSignArgument = true;
        }
      },
      signEpsilon: 0,
    },
    points: formulaOutputPathPoints.value,
    soldierCenter: mappedPathPoints.value[0],
    steepness: formulaOutputSteepness.value,
  });
  return hasZeroSignArgument;
});
const formulaSignEpsilon = computed(() => (
  formulaNeedsSignEpsilon.value ? GRAPHWAR_TOOL_SIGN_EPSILON : 0
));

const activeEquationDescription = computed(() => (
  algorithmMode.value === "abs"
    ? equationMode.value === "y"
      ? "输出双绝对值连接函数"
      : equationMode.value === "dy"
        ? "输出双绝对值连接函数的一阶导数"
        : "双绝对值函数不输出 y''"
    : equationModes.find((mode) => mode.value === equationMode.value)?.description ?? ""
));
const activeToolHint = computed(() => (
  toolMode.value === "bounds"
    ? "左键点两角落定边界；右键取消已选点。"
    : "左键先点自己士兵中心；再点路径点中心；左键拖动路径点微调，右键点路径点删除，右键空白处撤回最近一个"
));
const boundsPreviewRect = computed(() => (
  boundsFirstPoint.value && pointerPreviewPoint.value
    ? normalizeBoundsRect(boundsFirstPoint.value, pointerPreviewPoint.value)
    : undefined
));
const visibleBoundsRect = computed(() => boundsPreviewRect.value ?? boundsRect.value);
const visibleObstacleEdgePath = computed(() => {
  const obstacleMap = detectedObstacles.value;
  if (!obstacleMap) {
    return "";
  }

  return buildObstacleEdgePath(obstacleMap.mask, boundsRect.value);
});
const allowedTargetRect = computed<BoundsRect | undefined>(() => {
  if (toolMode.value !== "path" || !imageUrl.value || !parsedBounds.value.ok) {
    return undefined;
  }

  const rect = boundsRect.value;
  const lastPoint = pathPixels.value.at(-1);
  if (!lastPoint) {
    return rect;
  }

  if (xPlusGoesRight(parsedBounds.value.bounds)) {
    const left = clampNumber(
      lastPoint.x - graphwarToolDefaults.pathVerticalPixelTolerance,
      rect.x,
      rect.x + rect.width,
    );
    return {
      x: left,
      y: rect.y,
      width: rect.x + rect.width - left,
      height: rect.height,
    };
  }

  const right = clampNumber(
    lastPoint.x + graphwarToolDefaults.pathVerticalPixelTolerance,
    rect.x,
    rect.x + rect.width,
  );
  return {
    x: rect.x,
    y: rect.y,
    width: right - rect.x,
    height: rect.height,
  };
});
const detectionBoxes = computed<DetectionBox[]>(() => {
  const targetRect = allowedTargetRect.value;
  if (!targetRect || pathPixels.value.length === 0) {
    return detectedSoldiers.value;
  }

  return detectedSoldiers.value.filter((box) => detectionBoxOverlapsHorizontalRange(box, targetRect));
});

const calculationMessage = computed(() => {
  if (!parsedBounds.value.ok) {
    return parsedBounds.value.message;
  }
  if (algorithmMode.value === "step" && !parsedSteepness.value.ok) {
    return parsedSteepness.value.message;
  }
  if (algorithmMode.value === "abs" && equationMode.value === "ddy") {
    return "双绝对值函数不输出 y''；请选择 y= 或 y'=。";
  }
  if (pathPixels.value.length < 2) {
    return "先点出自己的位置，再选择至少一个路径点";
  }
  return "";
});

const settingsMessage = computed(() => {
  if (!parsedPrecision.value.ok) {
    return parsedPrecision.value.message;
  }
  return "";
});

const detectionSettingsMessage = computed(() => {
  if (!smartCursorEnabled.value) {
    return "";
  }
  if (!parsedObstacleThresholds.value.ok) {
    return parsedObstacleThresholds.value.message;
  }
  return "";
});

const formulaResult = computed<FormulaResult | undefined>(() => {
  if (!parsedBounds.value.ok || formulaOutputPathPoints.value.length < 2) {
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

  return buildFormula(
    formulaOutputPathPoints.value,
    formulaOutputSteepness.value,
    equationMode.value,
    algorithmMode.value,
    parsedPrecision.value.decimalPlaces,
    formulaSignEpsilon.value,
  );
});

const visibleDecimalPlaces = computed(() => (
  parsedPrecision.value.ok ? parsedPrecision.value.decimalPlaces : DEFAULT_FORMULA_DECIMAL_PLACES
));

const secondOrderAngleHint = computed(() => {
  if (
    algorithmMode.value !== "step" ||
    equationMode.value !== "ddy" ||
    !parsedSteepness.value.ok ||
    formulaOutputPathPoints.value.length < 2
  ) {
    return "";
  }

  const angle = getGraphwarLaunchAngle(
    {
      algorithm: algorithmMode.value,
      equation: equationMode.value,
      formulaEvaluation: {
        coefficientDecimalPlaces: formulaOutputDecimalPlaces.value,
      },
      points: formulaOutputPathPoints.value,
      steepness: formulaOutputSteepness.value,
    },
    mappedPathPoints.value[0],
  ) * 180 / Math.PI;
  if (!Number.isFinite(angle)) {
    return "";
  }
  return `需要用键盘上下键把发射角调到约 ${formatAngleDegree(angle)}°。`;
});

const trajectorySample = computed(() => {
  if (
    !formulaResult.value ||
    !parsedBounds.value.ok ||
    (algorithmMode.value === "step" && !parsedSteepness.value.ok) ||
    formulaOutputPathPoints.value.length < 2
  ) {
    return undefined;
  }

  return sampleGraphwarTrajectory({
    algorithm: algorithmMode.value,
    bounds: parsedBounds.value.bounds,
    equation: equationMode.value,
    formulaEvaluation: {
      coefficientDecimalPlaces: formulaOutputDecimalPlaces.value,
      signEpsilon: formulaSignEpsilon.value,
    },
    points: formulaOutputPathPoints.value,
    soldierCenter: mappedPathPoints.value[0],
    steepness: formulaOutputSteepness.value,
  });
});

const trajectoryWarning = computed(() => {
  if (trajectoryObstacleHitIndex.value >= 0) {
    return "当前公式轨迹会撞到障碍物";
  }

  const stopReason = trajectorySample.value?.stopReason;
  if (!stopReason || stopReason === "completed" || stopReason === "unsupported") {
    return "";
  }
  if (stopReason === "too-steep") {
    return "预览已中止：局部太陡，Graphwar 步长缩到最小仍无法继续，实战中会在这里爆炸。";
  }
  if (stopReason === "max-steps") {
    return "预览已中止：达到 Graphwar 最大采样步数，函数过长，实战中会在末端爆炸。";
  }
  if (stopReason === "out-of-bounds") {
    return "预览已中止：轨迹越出 Graphwar 平面，实战中会在边界处提前爆炸。";
  }
  return "预览已中止：公式出现 NaN 或无穷值，实战中会提前爆炸。";
});

const trajectoryObstacleHitIndex = computed(() => {
  const boundsResult = parsedBounds.value;
  const sample = trajectorySample.value;
  if (!smartCursorEnabled.value || !sample || !boundsResult.ok) {
    return -1;
  }

  const obstacleMap = detectedObstacles.value;
  if (!obstacleMap || obstacleMap.count === 0) {
    return -1;
  }

  return sample.points.findIndex((point) =>
    trajectoryPointHitsMask(point, boundsResult.bounds, obstacleMap.mask)
  );
});

const plottedCurvePoints = computed(() => {
  if (!trajectorySample.value || !parsedBounds.value.ok) {
    return "";
  }

  const { bounds } = parsedBounds.value;
  const hitIndex = trajectoryObstacleHitIndex.value;
  const points = hitIndex >= 0
    ? trajectorySample.value.points.slice(0, hitIndex + 1)
    : trajectorySample.value.points;
  return points.map((point) => {
    const pixel = graphToImagePoint(point, bounds, boundsRect.value);
    return `${formatSvgNumber(pixel.x)},${formatSvgNumber(pixel.y)}`;
  }).join(" ");
});

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

  return clampNumber(GRAPHWAR_GAME_SOLDIER_RADIUS / graphWidth * boundsRect.value.width, 3, 32);
});
const pathLineSegments = computed<PathLineSegment[]>(() => {
  const radius = soldierMarkerRadius.value;
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

    const offsetX = deltaX / distance * radius;
    const offsetY = deltaY / distance * radius;
    segments.push({
      x1: start.x + offsetX,
      y1: start.y + offsetY,
      x2: end.x - offsetX,
      y2: end.y - offsetY,
    });
  }
  return segments;
});
const magnifierStyle = computed(() => {
  const point = magnifierPoint.value;
  if (!magnifierEnabled.value || !imageUrl.value || !point) {
    return {};
  }

  const displayX = point.x / imageWidth.value * stageDisplayWidth.value;
  const displayY = point.y / imageHeight.value * stageDisplayHeight.value;
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

  const displayX = point.x / imageWidth.value * stageDisplayWidth.value;
  const displayY = point.y / imageHeight.value * stageDisplayHeight.value;
  const size = graphwarToolDefaults.magnifierSize;
  const zoom = graphwarToolDefaults.magnifierZoom;

  return {
    width: `${stageDisplayWidth.value}px`,
    height: `${stageDisplayHeight.value}px`,
    transform: `translate(${size / 2 - displayX * zoom}px, ${size / 2 - displayY * zoom}px) scale(${zoom})`,
  };
});
const copyButtonText = computed(() => {
  if (copyStatus.value === "success") {
    return "已复制";
  }
  if (copyStatus.value === "error") {
    return "复制失败";
  }
  return "复制函数";
});
const statusAnnouncement = computed(() => {
  if (copyStatus.value === "success") {
    return "函数已复制到剪贴板。";
  }
  if (copyStatus.value === "error") {
    return "复制失败，请手动复制。";
  }
  return "";
});

onMounted(() => {
  window.addEventListener("paste", handlePaste);
});

onBeforeUnmount(() => {
  window.removeEventListener("paste", handlePaste);
  if (copyStatusTimer) {
    clearTimeout(copyStatusTimer);
  }
  if (detectionRefreshTimer) {
    clearTimeout(detectionRefreshTimer);
  }
});

watch([obstacleMinAreaText], () => {
  scheduleGraphwarObjectDetection();
});

/** 从隐藏文件输入框加载用户上传的截图。 */
function handleImageUpload(event: Event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement) || !input.files?.[0]) {
    return;
  }

  loadImageFile(input.files[0]);
  input.value = "";
}

/** 处理页面上的 Ctrl / Cmd + V 直接粘贴图片。 */
function handlePaste(event: ClipboardEvent) {
  const items = Array.from(event.clipboardData?.items ?? []);
  const imageItem = items.find((item) => item.type.startsWith("image/"));
  const file = imageItem?.getAsFile();
  if (!file) {
    return;
  }

  event.preventDefault();
  loadImageFile(file);
}

/** 处理拖拽截图到舞台区域的加载逻辑。 */
function handleDrop(event: DragEvent) {
  const file = Array.from(event.dataTransfer?.files ?? []).find((item) => item.type.startsWith("image/"));
  if (file) {
    loadImageFile(file);
  }
}

/** 将图片文件读取为 data URL，并设置为当前截图。 */
function loadImageFile(file: File) {
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    if (typeof reader.result !== "string") {
      return;
    }

    applyLoadedImage(reader.result, file.name || "粘贴的截图");
  });
  reader.readAsDataURL(file);
}

/** 通过浏览器 Screen Capture API 截取屏幕图片。 */
async function captureScreenImage() {
  if (typeof navigator === "undefined" || typeof document === "undefined") {
    imageStatus.value = "当前环境不支持截屏。";
    return;
  }

  const mediaDevices = navigator.mediaDevices as MediaDevices & {
    getDisplayMedia?: (constraints?: DisplayMediaStreamOptions) => Promise<MediaStream>;
  };
  if (!mediaDevices?.getDisplayMedia) {
    imageStatus.value = "当前浏览器不支持 Screen Capture API。";
    return;
  }

  let stream: MediaStream | undefined;
  try {
    stream = await mediaDevices.getDisplayMedia({ video: true, audio: false });
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await waitForVideoMetadata(video);
    await video.play();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || graphwarToolDefaults.canvasWidth;
    canvas.height = video.videoHeight || graphwarToolDefaults.canvasHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas unavailable");
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    applyLoadedImage(canvas.toDataURL("image/png"), "屏幕截图");
  } catch {
    imageStatus.value = "未完成截屏";
  } finally {
    for (const track of stream?.getTracks() ?? []) {
      track.stop();
    }
  }
}

/** 等待截屏视频流拿到尺寸，以便绘制到 canvas。 */
function waitForVideoMetadata(video: HTMLVideoElement) {
  return new Promise<void>((resolve, reject) => {
    video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    video.addEventListener("error", () => reject(new Error("Video metadata unavailable")), { once: true });
  });
}

/** 应用已加载截图，并清空当前路径点；框选边界坐标保持不变。 */
function applyLoadedImage(url: string, name: string) {
  imageUrl.value = url;
  imageName.value = name;
  imageStatus.value = "";
  pathPixels.value = [];
  trajectoryStrokeColor.value = "#ec4899";
  clearDetections();
  boundsFirstPoint.value = undefined;
  pointerPreviewPoint.value = undefined;
  magnifierPoint.value = undefined;
}

/** 截图元素加载后更新图片尺寸；框选边界保留当前坐标值。 */
function handleImageLoad() {
  const image = imageRef.value;
  if (!image) {
    return;
  }

  imageWidth.value = image.naturalWidth || graphwarToolDefaults.canvasWidth;
  imageHeight.value = image.naturalHeight || graphwarToolDefaults.canvasHeight;
  boundsFirstPoint.value = undefined;
  pointerPreviewPoint.value = undefined;
  detectGraphwarObjects();
}

/** 清除自动识别的士兵标记。 */
function clearDetections() {
  detectionStatus.value = "";
  detectionStatusIsError.value = false;
  detectedSoldiers.value = [];
  detectedObstacles.value = undefined;
  smartCursorEnabled.value = false;
  hoveredDetectedSoldierId.value = undefined;
}

function scheduleGraphwarObjectDetection() {
  if (!imageUrl.value) {
    return;
  }
  if (detectionRefreshTimer) {
    clearTimeout(detectionRefreshTimer);
  }
  detectionRefreshTimer = setTimeout(() => {
    detectionRefreshTimer = undefined;
    detectGraphwarObjects();
  }, 180);
}

/** 使用 Canvas 像素检测 Graphwar 棋盘边界和黄色士兵。 */
function detectGraphwarObjects() {
  const image = imageRef.value;
  if (!image || !imageUrl.value) {
    detectionStatus.value = "先上传或粘贴截图";
    detectionStatusIsError.value = true;
    return;
  }

  const imageData = getImageDataFromElement(image);
  if (!imageData) {
    detectionStatus.value = "无法读取截图像素";
    detectionStatusIsError.value = true;
    return;
  }
  const obstacleThresholds = parsedObstacleThresholds.value;
  if (!obstacleThresholds.ok) {
    detectionStatus.value = obstacleThresholds.message;
    detectionStatusIsError.value = true;
    return;
  }

  const edgeRect = detectGraphwarPlayArea(imageData);
  if (!edgeRect) {
    clearDetections();
    detectionStatus.value = "没有识别到 Graphwar 棋盘边界";
    detectionStatusIsError.value = true;
    return;
  }

  boundsRect.value = edgeRect;
  toolMode.value = "path";
  boundsFirstPoint.value = undefined;
  pointerPreviewPoint.value = undefined;
  const soldiers = detectSoldiers(imageData, edgeRect);
  detectedSoldiers.value = soldiers;
  detectedObstacles.value = detectObstacles(imageData, edgeRect, obstacleThresholds, soldiers);
  detectionStatus.value =
    `已自动标记边界，识别到 ${detectedSoldiers.value.length} 个士兵、${detectedObstacles.value.count} 个障碍`;
  detectionStatusIsError.value = false;
}

function getImageDataFromElement(image: HTMLImageElement) {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width <= 0 || height <= 0) {
    return undefined;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return undefined;
  }

  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

function detectGraphwarPlayArea(imageData: ImageData): BoundsRect | undefined {
  const targetAspectRatio = 770 / 450;
  const verticalTriplets = buildAxisTriplets(detectAxisGroups(imageData, "vertical"));
  const horizontalTriplets = buildAxisTriplets(detectAxisGroups(imageData, "horizontal"));
  let bestRect: BoundsRect | undefined;
  let bestScore = 0;

  for (const vertical of verticalTriplets) {
    for (const horizontal of horizontalTriplets) {
      const rect: BoundsRect = {
        x: vertical.first.start,
        y: horizontal.first.start,
        width: vertical.last.end - vertical.first.start + 1,
        height: horizontal.last.end - horizontal.first.start + 1,
      };
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }

      const aspectRatio = rect.width / rect.height;
      if (aspectRatio < targetAspectRatio * 0.7 || aspectRatio > targetAspectRatio * 1.28) {
        continue;
      }

      const expectedAxisX = rect.x + rect.width / 2;
      const expectedAxisY = rect.y + rect.height / 2;
      const axisOffset =
        Math.abs(vertical.middle.coordinate - expectedAxisX) / rect.width +
        Math.abs(horizontal.middle.coordinate - expectedAxisY) / rect.height;
      if (axisOffset > 0.16) {
        continue;
      }

      const aspectPenalty = Math.min(Math.abs(aspectRatio - targetAspectRatio) / targetAspectRatio, 0.5);
      const score = rect.width * rect.height * vertical.score * horizontal.score * (1 - aspectPenalty) * (1 - axisOffset);
      if (score > bestScore) {
        bestScore = score;
        bestRect = rect;
      }
    }
  }

  if (!bestRect) {
    return undefined;
  }

  return bestRect;
}

function detectAxisGroups(imageData: ImageData, direction: "horizontal" | "vertical") {
  const { width, height } = imageData;
  const axisLength = direction === "vertical" ? height : width;
  const scanLength = direction === "vertical" ? width : height;
  const counts: number[] = [];

  for (let coordinate = 0; coordinate < scanLength; coordinate += 1) {
    let count = 0;
    for (let position = 0; position < axisLength; position += 1) {
      if (hasBlackPixelInAxisBand(imageData, direction, coordinate, position)) {
        count += 1;
      }
    }
    counts.push(count);
  }

  const minScore = axisLength * 0.25;
  const ranked = counts
    .map((score, coordinate) => ({ coordinate, score }))
    .filter((item) => item.score >= minScore)
    .sort((left, right) => right.score - left.score);
  const groups: AxisGroup[] = [];

  for (const item of ranked) {
    if (groups.some((group) => item.coordinate >= group.start - 4 && item.coordinate <= group.end + 4)) {
      continue;
    }

    const groupThreshold = item.score * 0.82;
    let start = item.coordinate;
    let end = item.coordinate;
    while (start > 0 && counts[start - 1] >= groupThreshold) {
      start -= 1;
    }
    while (end < scanLength - 1 && counts[end + 1] >= groupThreshold) {
      end += 1;
    }
    groups.push({
      start,
      end,
      coordinate: (start + end) / 2,
      score: item.score,
    });
    if (groups.length >= 12) {
      break;
    }
  }
  return groups.sort((left, right) => left.coordinate - right.coordinate);
}

function hasBlackPixelInAxisBand(
  imageData: ImageData,
  direction: "horizontal" | "vertical",
  coordinate: number,
  position: number,
) {
  const { width, height, data } = imageData;
  for (let offset = -1; offset <= 1; offset += 1) {
    const x = direction === "vertical" ? coordinate + offset : position;
    const y = direction === "vertical" ? position : coordinate + offset;
    if (x < 0 || x >= width || y < 0 || y >= height) {
      continue;
    }

    const index = (y * width + x) * 4;
    if (isAxisBlackPixel(data[index], data[index + 1], data[index + 2])) {
      return true;
    }
  }
  return false;
}

function buildAxisTriplets(groups: AxisGroup[]) {
  const triplets: AxisTriplet[] = [];
  for (let firstIndex = 0; firstIndex < groups.length; firstIndex += 1) {
    for (let middleIndex = firstIndex + 1; middleIndex < groups.length; middleIndex += 1) {
      for (let lastIndex = middleIndex + 1; lastIndex < groups.length; lastIndex += 1) {
        const first = groups[firstIndex];
        const middle = groups[middleIndex];
        const last = groups[lastIndex];
        const span = last.coordinate - first.coordinate;
        if (span <= 0) {
          continue;
        }

        const middleOffset = Math.abs(middle.coordinate - (first.coordinate + last.coordinate) / 2) / span;
        if (middleOffset > 0.18) {
          continue;
        }

        triplets.push({
          first,
          middle,
          last,
          score: (first.score + middle.score + last.score) * (1 - middleOffset),
        });
      }
    }
  }
  return triplets.sort((left, right) => right.score - left.score).slice(0, 16);
}

function detectSoldiers(imageData: ImageData, edgeRect: BoundsRect): DetectionBox[] {
  const rect = insetRect(edgeRect, Math.max(4, Math.round(edgeRect.width / 260)));
  const mask = buildYellowMask(imageData, rect);
  const scale = rect.width / GRAPHWAR_PLANE_LENGTH;
  const minArea = Math.max(6, Math.floor(9 * scale * scale));
  const maxSize = Math.max(18, 34 * scale);
  const minSize = Math.max(5, 4 * scale);
  const yAxisX = edgeRect.x + edgeRect.width / 2;
  const soldierBoxes = collectComponents(mask, rect.width)
    .filter((component) =>
      component.yellowArea >= minArea &&
      component.width >= minSize &&
      component.height >= minSize
    )
    .map((component) => expandSoldierComponent(imageData, rect, component, scale, yAxisX))
    .filter((component) => component.width <= maxSize && component.height <= maxSize)
    .map((component, index) => {
      const radius = Math.min(component.outerCircleRadius, 10 * scale);
      const centerX = component.centerX + rect.x;
      const centerY = component.centerY + rect.y;
      return {
        id: `soldier-${index}-${component.x}-${component.y}`,
        kind: "soldier" as const,
        // Start from the yellow body and add only local helmet-color pixels, avoiding
        // global color components that can connect to axes or the border. The sprite is
        // 20x20 in Graphwar, so cap the visual circle at half of that size.
        x: centerX - radius,
        y: centerY - radius,
        width: radius * 2,
        height: radius * 2,
      };
    });

  return suppressOverlappingBoxes(soldierBoxes, 0.28);
}

function detectObstacles(
  imageData: ImageData,
  edgeRect: BoundsRect,
  thresholds: Extract<ParsedObstacleThresholds, { ok: true }>,
  soldiers: DetectionBox[],
): DetectedObstacleMap {
  const mask = buildObstacleMask(imageData, edgeRect);
  removeGraphwarGuideLines(mask);
  bridgeObstacleGapsAcrossGuideLines(mask);
  removeSoldierAreasFromObstacleMask(mask, edgeRect, soldiers);
  const componentMask = openObstacleMask(mask);

  const filteredMask = new Uint8Array(mask.length);
  let count = 0;
  for (const component of collectComponents(componentMask, GRAPHWAR_PLANE_LENGTH)) {
    if (component.area < thresholds.minArea) {
      continue;
    }

    count += 1;
    for (let y = component.y; y < component.y + component.height; y += 1) {
      for (let x = component.x; x < component.x + component.width; x += 1) {
        const index = y * GRAPHWAR_PLANE_LENGTH + x;
        if (componentMask[index]) {
          filteredMask[index] = 1;
        }
      }
    }
  }

  return {
    count,
    mask: filteredMask,
  };
}

function openObstacleMask(mask: Uint8Array) {
  return dilateObstacleMask(erodeObstacleMask(mask));
}

function erodeObstacleMask(mask: Uint8Array) {
  const eroded = new Uint8Array(mask.length);
  for (let y = 1; y < GRAPHWAR_PLANE_HEIGHT - 1; y += 1) {
    for (let x = 1; x < GRAPHWAR_PLANE_LENGTH - 1; x += 1) {
      let isSolid = true;
      for (let offsetY = -1; offsetY <= 1 && isSolid; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (!mask[(y + offsetY) * GRAPHWAR_PLANE_LENGTH + x + offsetX]) {
            isSolid = false;
            break;
          }
        }
      }
      if (isSolid) {
        eroded[y * GRAPHWAR_PLANE_LENGTH + x] = 1;
      }
    }
  }
  return eroded;
}

function dilateObstacleMask(mask: Uint8Array) {
  const dilated = new Uint8Array(mask.length);
  for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
    for (let x = 0; x < GRAPHWAR_PLANE_LENGTH; x += 1) {
      if (!mask[y * GRAPHWAR_PLANE_LENGTH + x]) {
        continue;
      }
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (isInsidePlane(nextX, nextY)) {
            dilated[nextY * GRAPHWAR_PLANE_LENGTH + nextX] = 1;
          }
        }
      }
    }
  }
  return dilated;
}

function removeSoldierAreasFromObstacleMask(mask: Uint8Array, edgeRect: BoundsRect, soldiers: DetectionBox[]) {
  for (const soldier of soldiers) {
    const center = imagePointToPlaneGridPoint(getDetectionBoxCenter(soldier), edgeRect);
    const radiusX = (soldier.width / 2 / edgeRect.width) * GRAPHWAR_PLANE_LENGTH;
    const radiusY = (soldier.height / 2 / edgeRect.height) * GRAPHWAR_PLANE_HEIGHT;
    clearMaskDisk(mask, center, Math.ceil(Math.max(radiusX, radiusY)) + 2);
  }
}

function buildObstacleMask(imageData: ImageData, edgeRect: BoundsRect) {
  const mask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
  for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
    for (let x = 0; x < GRAPHWAR_PLANE_LENGTH; x += 1) {
      const source = samplePlaneImagePixel(imageData, edgeRect, x, y);
      if (isObstacleDarkPixel(source.red, source.green, source.blue)) {
        mask[y * GRAPHWAR_PLANE_LENGTH + x] = 1;
      }
    }
  }
  return mask;
}

function removeGraphwarGuideLines(mask: Uint8Array) {
  const centerX = Math.floor(GRAPHWAR_PLANE_LENGTH / 2);
  const centerY = Math.floor(GRAPHWAR_PLANE_HEIGHT / 2);
  for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
    for (let x = 0; x < GRAPHWAR_PLANE_LENGTH; x += 1) {
      if (
        x <= 1 ||
        x >= GRAPHWAR_PLANE_LENGTH - 2 ||
        y <= 1 ||
        y >= GRAPHWAR_PLANE_HEIGHT - 2 ||
        Math.abs(x - centerX) <= 1 ||
        Math.abs(y - centerY) <= 1
      ) {
        mask[y * GRAPHWAR_PLANE_LENGTH + x] = 0;
      }
    }
  }
}

function bridgeObstacleGapsAcrossGuideLines(mask: Uint8Array) {
  const centerX = Math.floor(GRAPHWAR_PLANE_LENGTH / 2);
  const centerY = Math.floor(GRAPHWAR_PLANE_HEIGHT / 2);
  const bridged = new Uint8Array(mask);

  for (let y = 2; y < GRAPHWAR_PLANE_HEIGHT - 2; y += 1) {
    const hasLeftObstacle =
      mask[y * GRAPHWAR_PLANE_LENGTH + centerX - 2] ||
      mask[y * GRAPHWAR_PLANE_LENGTH + centerX - 3];
    const hasRightObstacle =
      mask[y * GRAPHWAR_PLANE_LENGTH + centerX + 2] ||
      mask[y * GRAPHWAR_PLANE_LENGTH + centerX + 3];
    if (!hasLeftObstacle || !hasRightObstacle) {
      continue;
    }

    for (let x = centerX - 1; x <= centerX + 1; x += 1) {
      bridged[y * GRAPHWAR_PLANE_LENGTH + x] = 1;
    }
  }

  for (let x = 2; x < GRAPHWAR_PLANE_LENGTH - 2; x += 1) {
    const hasTopObstacle =
      mask[(centerY - 2) * GRAPHWAR_PLANE_LENGTH + x] ||
      mask[(centerY - 3) * GRAPHWAR_PLANE_LENGTH + x];
    const hasBottomObstacle =
      mask[(centerY + 2) * GRAPHWAR_PLANE_LENGTH + x] ||
      mask[(centerY + 3) * GRAPHWAR_PLANE_LENGTH + x];
    if (!hasTopObstacle || !hasBottomObstacle) {
      continue;
    }

    for (let y = centerY - 1; y <= centerY + 1; y += 1) {
      bridged[y * GRAPHWAR_PLANE_LENGTH + x] = 1;
    }
  }

  mask.set(bridged);
}

function samplePlaneImagePixel(imageData: ImageData, edgeRect: BoundsRect, planeX: number, planeY: number) {
  const x = Math.round(edgeRect.x + ((planeX + 0.5) / GRAPHWAR_PLANE_LENGTH) * edgeRect.width);
  const y = Math.round(edgeRect.y + ((planeY + 0.5) / GRAPHWAR_PLANE_HEIGHT) * edgeRect.height);
  const clampedX = clampNumber(x, 0, imageData.width - 1);
  const clampedY = clampNumber(y, 0, imageData.height - 1);
  const index = (clampedY * imageData.width + clampedX) * 4;
  return {
    red: imageData.data[index],
    green: imageData.data[index + 1],
    blue: imageData.data[index + 2],
  };
}

function buildObstacleEdgePath(mask: Uint8Array, edgeRect: BoundsRect) {
  const commands: string[] = [];
  const appendEdge = (x1: number, y1: number, x2: number, y2: number) => {
    const start = planeToImagePoint({ x: x1, y: y1 }, edgeRect);
    const end = planeToImagePoint({ x: x2, y: y2 }, edgeRect);
    commands.push(`M${formatSvgNumber(start.x)} ${formatSvgNumber(start.y)}L${formatSvgNumber(end.x)} ${formatSvgNumber(end.y)}`);
  };

  for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
    for (let x = 0; x < GRAPHWAR_PLANE_LENGTH; x += 1) {
      if (!mask[y * GRAPHWAR_PLANE_LENGTH + x]) {
        continue;
      }

      if (y === 0 || !mask[(y - 1) * GRAPHWAR_PLANE_LENGTH + x]) {
        appendEdge(x, y, x + 1, y);
      }
      if (x === GRAPHWAR_PLANE_LENGTH - 1 || !mask[y * GRAPHWAR_PLANE_LENGTH + x + 1]) {
        appendEdge(x + 1, y, x + 1, y + 1);
      }
      if (y === GRAPHWAR_PLANE_HEIGHT - 1 || !mask[(y + 1) * GRAPHWAR_PLANE_LENGTH + x]) {
        appendEdge(x + 1, y + 1, x, y + 1);
      }
      if (x === 0 || !mask[y * GRAPHWAR_PLANE_LENGTH + x - 1]) {
        appendEdge(x, y + 1, x, y);
      }
    }
  }

  return commands.join("");
}

function planeToImagePoint(point: PlaneGridPoint, edgeRect: BoundsRect) {
  return createPixelPoint(
    edgeRect.x + (point.x / GRAPHWAR_PLANE_LENGTH) * edgeRect.width,
    edgeRect.y + (point.y / GRAPHWAR_PLANE_HEIGHT) * edgeRect.height,
  );
}

function imagePointToPlaneGridPoint(point: PixelPoint, edgeRect: BoundsRect): PlaneGridPoint {
  return {
    x: clampNumber(
      Math.floor(((point.x - edgeRect.x) / edgeRect.width) * GRAPHWAR_PLANE_LENGTH),
      0,
      GRAPHWAR_PLANE_LENGTH - 1,
    ),
    y: clampNumber(
      Math.floor(((point.y - edgeRect.y) / edgeRect.height) * GRAPHWAR_PLANE_HEIGHT),
      0,
      GRAPHWAR_PLANE_HEIGHT - 1,
    ),
  };
}

function clearMaskDisk(mask: Uint8Array, center: PlaneGridPoint, radius: number) {
  const radiusSquared = radius * radius;
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      if (offsetX * offsetX + offsetY * offsetY > radiusSquared) {
        continue;
      }

      const x = center.x + offsetX;
      const y = center.y + offsetY;
      if (isInsidePlane(x, y)) {
        mask[y * GRAPHWAR_PLANE_LENGTH + x] = 0;
      }
    }
  }
}

function trajectoryPointHitsMask(point: GraphPoint, bounds: GraphBounds, mask: Uint8Array) {
  const pixel = graphToImagePoint(point, bounds, boundsRect.value);
  const plane = imagePointToPlaneGridPoint(pixel, boundsRect.value);
  if (!isInsidePlane(plane.x, plane.y)) {
    return true;
  }
  return Boolean(mask[plane.y * GRAPHWAR_PLANE_LENGTH + plane.x]);
}

function isInsidePlane(x: number, y: number) {
  return x >= 0 && x < GRAPHWAR_PLANE_LENGTH && y >= 0 && y < GRAPHWAR_PLANE_HEIGHT;
}

function buildYellowMask(imageData: ImageData, rect: BoundsRect) {
  const mask = new Uint8Array(rect.width * rect.height);
  const { data, width } = imageData;
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const sourceIndex = ((rect.y + y) * width + rect.x + x) * 4;
      if (isSoldierYellowPixel(data[sourceIndex], data[sourceIndex + 1], data[sourceIndex + 2])) {
        mask[y * rect.width + x] = 1;
      }
    }
  }
  return mask;
}

function collectComponents(mask: Uint8Array, width: number): ComponentBox[] {
  const visited = new Uint8Array(mask.length);
  const components: ComponentBox[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) {
      continue;
    }

    const stack = [start];
    visited[start] = 1;
    let yellowArea = 0;
    const pixels: number[] = [];

    while (stack.length) {
      const current = stack.pop() ?? 0;
      const x = current % width;
      if (mask[current] === 1) {
        yellowArea += 1;
      }
      pixels.push(current);

      const neighbors = [current - 1, current + 1, current - width, current + width];
      for (const next of neighbors) {
        if (
          next < 0 ||
          next >= mask.length ||
          visited[next] ||
          !mask[next] ||
          (next === current - 1 && x === 0) ||
          (next === current + 1 && x === width - 1)
        ) {
          continue;
        }
        visited[next] = 1;
        stack.push(next);
      }
    }

    components.push(createComponentBox(pixels, width, yellowArea));
  }
  return components;
}

function expandSoldierComponent(
  imageData: ImageData,
  rect: BoundsRect,
  seed: ComponentBox,
  scale: number,
  yAxisX: number,
) {
  const { data, width } = imageData;
  const helmetPadX = Math.max(1, Math.round(2.25 * scale));
  const oppositePadX = Math.max(1, Math.round(0.75 * scale));
  const padTop = Math.max(2, Math.round(3.5 * scale));
  const padBottom = Math.max(1, Math.round(0.75 * scale));
  const helmetBottom = seed.y + Math.round(seed.height * 0.62);
  const seedEndX = seed.x + seed.width - 1;
  const seedEndY = seed.y + seed.height - 1;
  const helmetGoesLeft = rect.x + seed.centerX < yAxisX;
  const startX = Math.max(0, seed.x - (helmetGoesLeft ? helmetPadX : oppositePadX));
  const endX = Math.min(rect.width - 1, seedEndX + (helmetGoesLeft ? oppositePadX : helmetPadX));
  const startY = Math.max(0, seed.y - padTop);
  const endY = Math.min(rect.height - 1, seed.y + seed.height - 1 + padBottom);
  const pixels: number[] = [];
  let yellowArea = 0;

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      const sourceIndex = ((rect.y + y) * width + rect.x + x) * 4;
      const red = data[sourceIndex];
      const green = data[sourceIndex + 1];
      const blue = data[sourceIndex + 2];
      const isSeedYellow =
        x >= seed.x &&
        x <= seedEndX &&
        y >= seed.y &&
        y <= seedEndY &&
        isSoldierYellowPixel(red, green, blue);
      if (!isSeedYellow && (y > helmetBottom || !isSoldierHelmetPixel(red, green, blue))) {
        continue;
      }

      if (isSeedYellow) {
        yellowArea += 1;
      }
      pixels.push(y * rect.width + x);
    }
  }

  return pixels.length ? createComponentBox(pixels, rect.width, yellowArea) : seed;
}

function createComponentBox(pixels: number[], width: number, yellowArea: number): ComponentBox {
  let minX = width;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = 0;
  let maxY = 0;
  for (const pixel of pixels) {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const componentWidth = maxX - minX + 1;
  const componentHeight = maxY - minY + 1;
  const centerX = minX + componentWidth / 2;
  const centerY = minY + componentHeight / 2;
  let outerCircleRadius = 0;
  for (const pixel of pixels) {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    outerCircleRadius = Math.max(
      outerCircleRadius,
      Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY) + Math.SQRT1_2,
    );
  }

  return {
    x: minX,
    y: minY,
    width: componentWidth,
    height: componentHeight,
    area: pixels.length,
    yellowArea,
    centerX,
    centerY,
    outerCircleRadius,
  };
}

function suppressOverlappingBoxes(boxes: DetectionBox[], threshold: number) {
  const sorted = [...boxes].sort((left, right) => right.width * right.height - left.width * left.height);
  const kept: DetectionBox[] = [];
  for (const box of sorted) {
    if (kept.every((candidate) => calculateBoxIou(box, candidate) < threshold)) {
      kept.push(box);
    }
  }
  return kept;
}

function calculateBoxIou(left: BoundsRect, right: BoundsRect) {
  const leftX2 = left.x + left.width;
  const leftY2 = left.y + left.height;
  const rightX2 = right.x + right.width;
  const rightY2 = right.y + right.height;
  const interWidth = Math.max(0, Math.min(leftX2, rightX2) - Math.max(left.x, right.x));
  const interHeight = Math.max(0, Math.min(leftY2, rightY2) - Math.max(left.y, right.y));
  const interArea = interWidth * interHeight;
  const unionArea = left.width * left.height + right.width * right.height - interArea;
  return unionArea > 0 ? interArea / unionArea : 0;
}

function insetRect(rect: BoundsRect, inset: number): BoundsRect {
  return {
    x: Math.round(rect.x + inset),
    y: Math.round(rect.y + inset),
    width: Math.max(1, Math.round(rect.width - inset * 2)),
    height: Math.max(1, Math.round(rect.height - inset * 2)),
  };
}

function isAxisBlackPixel(red: number, green: number, blue: number) {
  return red <= 42 && green <= 42 && blue <= 42;
}

function isObstacleDarkPixel(red: number, green: number, blue: number) {
  return red <= 104 && green <= 104 && blue <= 104 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 36;
}

function isPlayerColorPixel(red: number, green: number, blue: number) {
  if (
    isAxisBlackPixel(red, green, blue) ||
    isSoldierYellowPixel(red, green, blue) ||
    isPlaneWhitePixel(red, green, blue) ||
    isPlaneGreenPixel(red, green, blue)
  ) {
    return false;
  }

  const maxChannel = Math.max(red, green, blue);
  const minChannel = Math.min(red, green, blue);
  return maxChannel - minChannel >= 34 && red + green + blue >= 72 && red + green + blue <= 700;
}

function isSoldierYellowPixel(red: number, green: number, blue: number) {
  return red >= 170 && green >= 160 && blue <= 130 && red + green - blue >= 260;
}

function isSoldierHelmetPixel(red: number, green: number, blue: number) {
  if (isAxisBlackPixel(red, green, blue) || isPlaneWhitePixel(red, green, blue) || isPlaneGreenPixel(red, green, blue)) {
    return false;
  }

  const maxChannel = Math.max(red, green, blue);
  const minChannel = Math.min(red, green, blue);
  const chroma = maxChannel - minChannel;
  const brightness = red + green + blue;
  return chroma >= 22 && brightness >= 55 && brightness <= 690;
}

function isPlaneWhitePixel(red: number, green: number, blue: number) {
  return red >= 225 && green >= 225 && blue >= 210 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 35;
}

function isPlaneGreenPixel(red: number, green: number, blue: number) {
  return green >= 155 && red >= 115 && red <= 195 && blue >= 110 && blue <= 195 && green - red >= 20 && green - blue >= 20;
}

function toggleSmartCursor() {
  smartCursorEnabled.value = !smartCursorEnabled.value;
  if (!smartCursorEnabled.value) {
    hoveredDetectedSoldierId.value = undefined;
  }
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

    const nextPoint = clampPixelPointToCanvas(point, imageWidth.value, imageHeight.value);
    if (!boundsFirstPoint.value) {
      boundsFirstPoint.value = nextPoint;
      pointerPreviewPoint.value = nextPoint;
      return;
    }

    const nextRect = normalizeBoundsRect(boundsFirstPoint.value, nextPoint);
    if (nextRect.width >= 4 && nextRect.height >= 4) {
      boundsRect.value = nextRect;
      toolMode.value = "path";
    }
    boundsFirstPoint.value = undefined;
    pointerPreviewPoint.value = undefined;
    return;
  }

  if (event.button !== 0 || !parsedBounds.value.ok) {
    return;
  }

  const pathPointIndex = getPathPointIndexAtPoint(point);
  if (pathPointIndex !== undefined) {
    draggingPathPointIndex.value = pathPointIndex;
    stageRef.value?.setPointerCapture(event.pointerId);
    return;
  }

  if (smartCursorEnabled.value) {
    const selectedSoldier = getDetectedSoldierAtPoint(point);
    if (selectedSoldier) {
      appendDetectedSoldierPathPoint(selectedSoldier);
      return;
    }
  }

  appendPathPoint(point);
}

function appendPathPoint(point: PixelPoint) {
  if (!parsedBounds.value.ok) {
    return false;
  }

  const nextPoint = normalizePathPoint(point, boundsRect.value, parsedBounds.value.bounds, pathPixels.value.at(-1));
  if (!nextPoint) {
    return false;
  }

  if (!canAppendPathPoint(nextPoint)) {
    return false;
  }

  pathPixels.value = [...pathPixels.value, nextPoint];
  pathStatus.value = "";
  return true;
}

function appendDetectedSoldierPathPoint(soldier: DetectionBox) {
  if (pathPixels.value.length === 0) {
    trajectoryStrokeColor.value = getDetectedSoldierColor(soldier) ?? "#ec4899";
  }
  return appendPathPoint(getDetectionBoxCenter(soldier));
}

function detectionBoxOverlapsHorizontalRange(box: BoundsRect, rect: BoundsRect) {
  return box.x + box.width >= rect.x && box.x <= rect.x + rect.width;
}

function getPathPointIndexAtPoint(point: PixelPoint) {
  const radius = Math.max(10, soldierMarkerRadius.value + 6);
  for (let index = pathPixels.value.length - 1; index >= 0; index -= 1) {
    const pathPoint = pathPixels.value[index];
    if (Math.hypot(point.x - pathPoint.x, point.y - pathPoint.y) <= radius) {
      return index;
    }
  }
  return undefined;
}

function setPathPoint(index: number, point: PixelPoint) {
  if (!parsedBounds.value.ok || index < 0 || index >= pathPixels.value.length) {
    return false;
  }

  const previousPoint = index > 0 ? pathPixels.value[index - 1] : undefined;
  const nextPoint = normalizePathPoint(point, boundsRect.value, parsedBounds.value.bounds, previousPoint);
  if (!nextPoint) {
    return false;
  }

  const nextPath = [...pathPixels.value];
  nextPath[index] = nextPoint;
  if (!pathFollowsGraphRule(nextPath)) {
    pathStatus.value = "只能走 x+；x- 会自动变垂直";
    return false;
  }

  pathPixels.value = nextPath;
  pathStatus.value = "";
  return true;
}

function removePathPoint(index: number) {
  if (index < 0 || index >= pathPixels.value.length) {
    return false;
  }
  pathPixels.value = pathPixels.value.filter((_, pointIndex) => pointIndex !== index);
  if (pathPixels.value.length === 0) {
    trajectoryStrokeColor.value = "#ec4899";
  }
  pathStatus.value = "";
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
  if (draggingPathPointIndex.value !== undefined) {
    setPathPoint(draggingPathPointIndex.value, point);
    return;
  }
  const hoveredSoldier = smartCursorEnabled.value
    ? getDetectedSoldierAtPoint(point)?.id
    : undefined;
  hoveredDetectedSoldierId.value = hoveredSoldier;
  if (toolMode.value !== "bounds") {
    return;
  }

  pointerPreviewPoint.value = clampPixelPointToCanvas(point, imageWidth.value, imageHeight.value);
}

/** 指针离开截图舞台时清理仅悬停期间存在的预览状态。 */
function handleStagePointerLeave() {
  pointerPreviewPoint.value = undefined;
  magnifierPoint.value = undefined;
  hoveredDetectedSoldierId.value = undefined;
  draggingPathPointIndex.value = undefined;
}

function getDetectedSoldierAtPoint(point: PixelPoint) {
  for (let index = detectionBoxes.value.length - 1; index >= 0; index -= 1) {
    const box = detectionBoxes.value[index];
    const center = getDetectionBoxCenter(box);
    const radius = box.width / 2;
    if (Math.hypot(point.x - center.x, point.y - center.y) <= radius) {
      return box;
    }
  }
  return undefined;
}

function getDetectionBoxCenter(box: DetectionBox) {
  return createPixelPoint(box.x + box.width / 2, box.y + box.height / 2);
}

function getDetectedSoldierColor(box: DetectionBox) {
  const image = imageRef.value;
  if (!image) {
    return undefined;
  }

  const imageData = getImageDataFromElement(image);
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
  if (toolMode.value === "bounds") {
    boundsFirstPoint.value = undefined;
    pointerPreviewPoint.value = undefined;
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

function handleStagePointerUp(event: PointerEvent) {
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
  toolMode.value = mode;
  pointerPreviewPoint.value = undefined;
  if (mode === "path") {
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
  if (isVerticalPathDelta(deltaX)) {
    return true;
  }

  if (deltaX > 0) {
    return true;
  }

  pathStatus.value = "只能走 x+；x- 会自动变垂直";
  return false;
}

function pathFollowsGraphRule(points: PixelPoint[]) {
  if (!parsedBounds.value.ok || points.length < 2) {
    return true;
  }

  for (let index = 1; index < points.length; index += 1) {
    const previousPoint = imageToGraphPoint(points[index - 1], parsedBounds.value.bounds, boundsRect.value);
    const nextPoint = imageToGraphPoint(points[index], parsedBounds.value.bounds, boundsRect.value);
    const deltaX = nextPoint.x - previousPoint.x;
    if (!isVerticalPathDelta(deltaX) && deltaX <= 0) {
      return false;
    }
  }
  return true;
}

/** 清除全部已选路径点，但不改变图片边界和设定。 */
function clearPath() {
  pathPixels.value = [];
  pathStatus.value = "";
  trajectoryStrokeColor.value = "#ec4899";
}

/** 删除最新选择的路径点。 */
function undoLastPoint() {
  if (pathPixels.value.length === 0) {
    return;
  }

  pathPixels.value = pathPixels.value.slice(0, -1);
  if (pathPixels.value.length === 0) {
    trajectoryStrokeColor.value = "#ec4899";
  }
  pathStatus.value = "";
}

/** 复制当前生成的 Graphwar 表达式。 */
async function copyFormula() {
  if (!formulaResult.value) {
    return;
  }

  try {
    await copyText(formulaResult.value.expression);
    setCopyStatus("success");
  } catch {
    setCopyStatus("error");
  }
}

/** 用当前页面状态包装图形坐标中的垂直容差判断。 */
function isVerticalPathDelta(deltaX: number) {
  if (!parsedBounds.value.ok) {
    return nearlyEqual(deltaX, 0);
  }

  return isVerticalGraphDelta(
    deltaX,
    parsedBounds.value.bounds,
    boundsRect.value,
    graphwarToolDefaults.pathVerticalPixelTolerance,
  );
}

/** 将浏览器指针事件转换为截图像素坐标。 */
function getImagePointFromEvent(event: MouseEvent): PixelPoint | undefined {
  const stage = stageRef.value;
  if (!stage) {
    return undefined;
  }

  const rect = stage.getBoundingClientRect();
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (width <= 0 || height <= 0) {
    return undefined;
  }

  stageDisplayWidth.value = width;
  stageDisplayHeight.value = height;

  return clampPixelPointToCanvas(
    createPixelPoint(
      ((event.clientX - rect.left - stage.clientLeft) / width) * imageWidth.value,
      ((event.clientY - rect.top - stage.clientTop) / height) * imageHeight.value,
    ),
    imageWidth.value,
    imageHeight.value,
  );
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

上传或粘贴 [Graphwar](https://graphwar.com/graphwar_1/index.html) 截图，标定坐标边界后点出自己的位置和目标路径点，生成函数表达式。所有计算均在本地完成。

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
      <h2 id="graphwar-killer-settings-title">设定</h2>
      <span>{{ activeEquationDescription }}</span>
    </div>
    <div class="graphwar-killer__setting-row">
      <span class="graphwar-killer__setting-label">算法</span>
      <div
        class="graphwar-killer__tool-toggle graphwar-killer__algorithm-toggle"
        :class="{ 'graphwar-killer__tool-toggle--path': algorithmMode === 'step' }"
        role="group"
        aria-label="算法"
      >
        <button
          v-for="mode in algorithmModes"
          :key="mode.value"
          type="button"
          :aria-pressed="algorithmMode === mode.value"
          :class="{ 'graphwar-killer__tool-toggle-button--active': algorithmMode === mode.value }"
          @click="algorithmMode = mode.value"
        >
          {{ mode.label }}
        </button>
      </div>
    </div>
    <label
      v-if="algorithmMode === 'step'"
      class="graphwar-killer__steepness-label"
    >
      阶梯陡峭度 a
      <input
        v-model="steepnessText"
        inputmode="decimal"
        autocomplete="off"
      >
    </label>
    <div class="graphwar-killer__coordinate-grid">
      <label>
        -x
        <input
          v-model="minXText"
          inputmode="decimal"
          autocomplete="off"
        >
      </label>
      <label>
        +x
        <input
          v-model="maxXText"
          inputmode="decimal"
          autocomplete="off"
        >
      </label>
      <label>
        -y
        <input
          v-model="minYText"
          inputmode="decimal"
          autocomplete="off"
        >
      </label>
      <label>
        +y
        <input
          v-model="maxYText"
          inputmode="decimal"
          autocomplete="off"
        >
      </label>
    </div>
    <div class="graphwar-killer__setting-row graphwar-killer__game-mode-row">
      <span class="graphwar-killer__setting-label">游戏模式</span>
      <div class="graphwar-killer__game-mode-controls">
        <div
          class="graphwar-killer__equation-toggle"
          :class="{
            'graphwar-killer__equation-toggle--dy': equationMode === 'dy',
            'graphwar-killer__equation-toggle--ddy': equationMode === 'ddy',
          }"
          role="group"
          aria-label="Graphwar 游戏模式"
        >
          <button
            v-for="mode in equationModes"
            :key="mode.value"
            type="button"
            :aria-pressed="equationMode === mode.value"
            :class="{ 'graphwar-killer__equation-toggle-button--active': equationMode === mode.value }"
            @click="equationMode = mode.value"
          >
            {{ mode.label }}
          </button>
        </div>
        <label class="graphwar-killer__precision-label">
          保留小数位
          <input
            v-model="precisionText"
            inputmode="numeric"
            autocomplete="off"
            min="0"
            :max="MAX_FORMULA_DECIMAL_PLACES"
          >
        </label>
      </div>
    </div>
    <p
      v-if="settingsMessage"
      class="graphwar-killer__error graphwar-killer__settings-error"
    >
      {{ settingsMessage }}
    </p>
  </section>
  <section
    class="graphwar-killer__panel"
    aria-labelledby="graphwar-killer-actions-title"
  >
    <div class="graphwar-killer__label-row">
      <h2 id="graphwar-killer-actions-title">操作栏</h2>
      <span>{{ activeToolHint }}</span>
    </div>
    <div class="graphwar-killer__image-actions">
      <button
        type="button"
        @click="captureScreenImage"
      >
        截取图片
      </button>
      <label class="graphwar-killer__upload">
        <input
          type="file"
          accept="image/*"
          @change="handleImageUpload"
        >
        <span>上传图片</span>
      </label>
      <button
        type="button"
        :aria-pressed="magnifierEnabled"
        :class="{ 'graphwar-killer__toggle-button--active': magnifierEnabled }"
        @click="magnifierEnabled = !magnifierEnabled"
      >
        放大镜
      </button>
      <div
        class="graphwar-killer__tool-toggle"
        :class="{ 'graphwar-killer__tool-toggle--path': toolMode === 'path' }"
        role="group"
        aria-label="操作模式"
      >
        <button
          type="button"
          :aria-pressed="toolMode === 'bounds'"
          :class="{ 'graphwar-killer__tool-toggle-button--active': toolMode === 'bounds' }"
          @click="setToolMode('bounds')"
        >
          点选边界
        </button>
        <button
          type="button"
          :aria-pressed="toolMode === 'path'"
          :class="{ 'graphwar-killer__tool-toggle-button--active': toolMode === 'path' }"
          @click="setToolMode('path')"
        >
          点选路径
        </button>
      </div>
      <button
        type="button"
        @click="clearPath"
      >
        清除路径点
      </button>
      <button
        type="button"
        @click="undoLastPoint"
      >
        撤回路径点
      </button>
    </div>
  </section>
  <section
    class="graphwar-killer__panel"
    aria-labelledby="graphwar-killer-detection-title"
  >
    <div class="graphwar-killer__label-row">
      <h2 id="graphwar-killer-detection-title">识别</h2>
      <span
        v-if="detectionStatus"
        :class="{ 'graphwar-killer__label-status--error': detectionStatusIsError }"
      >
        {{ detectionStatus }}
      </span>
    </div>
    <div class="graphwar-killer__image-actions">
      <button
        type="button"
        :disabled="!imageUrl"
        @click="detectGraphwarObjects"
      >
        自动标记边界
      </button>
      <button
        type="button"
        :aria-pressed="smartCursorEnabled"
        :class="{ 'graphwar-killer__toggle-button--active': smartCursorEnabled }"
        @click="toggleSmartCursor"
      >
        智能光标
      </button>
      <label
        v-if="smartCursorEnabled"
        class="graphwar-killer__detection-setting-label"
      >
        障碍最小面积
        <input
          v-model="obstacleMinAreaText"
          inputmode="numeric"
          aria-label="障碍最小面积，单位为 Graphwar 原始平面像素"
        >
        <span>px²</span>
      </label>
    </div>
    <p
      v-if="detectionSettingsMessage"
      class="graphwar-killer__error graphwar-killer__settings-error"
    >
      {{ detectionSettingsMessage }}
    </p>
  </section>
  <section
    class="graphwar-killer__panel"
    aria-labelledby="graphwar-killer-screenshot-title"
  >
    <div class="graphwar-killer__label-row graphwar-killer__label-row--image-status">
      <h2 id="graphwar-killer-screenshot-title">截图</h2>
      <span>{{ imageStatus || imageName || "可以截屏、上传、拖入或直接 Ctrl / Cmd + V 粘贴截图" }}</span>
    </div>
    <p
      v-if="pathStatus"
      class="graphwar-killer__hint graphwar-killer__hint--warning"
    >
      {{ pathStatus }}
    </p>
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
        上传、拖入或粘贴截图后开始标定
      </div>
      <svg
        class="graphwar-killer__overlay"
        :viewBox="`0 0 ${imageWidth} ${imageHeight}`"
        aria-hidden="true"
      >
        <rect
          class="graphwar-killer__bounds"
          :class="{ 'graphwar-killer__bounds--preview': boundsPreviewRect }"
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
          v-if="smartCursorEnabled && visibleObstacleEdgePath"
          class="graphwar-killer__obstacle-edge"
          :d="visibleObstacleEdgePath"
        />
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
                { 'graphwar-killer__detection--hovered': box.id === hoveredDetectedSoldierId },
              ]"
              :cx="box.x + box.width / 2"
              :cy="box.y + box.height / 2"
              :r="box.width / 2"
            />
          </g>
        </template>
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
        <polyline
          v-if="plottedCurvePoints"
          class="graphwar-killer__curve-line"
          :points="plottedCurvePoints"
          :style="{ stroke: trajectoryStrokeColor }"
        />
        <g
          v-for="(point, index) in pathPixels"
          :key="`${index}-${point.x}-${point.y}`"
        >
          <circle
            class="graphwar-killer__point"
            :class="{ 'graphwar-killer__point--start': index === 0 }"
            :cx="point.x"
            :cy="point.y"
            :r="soldierMarkerRadius"
          />
          <text
            class="graphwar-killer__point-label"
            :x="point.x + soldierMarkerRadius + 4"
            :y="point.y - soldierMarkerRadius - 4"
          >
            {{ index === 0 ? "己" : index }}
          </text>
        </g>
      </svg>
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
            <rect
              class="graphwar-killer__bounds"
              :class="{ 'graphwar-killer__bounds--preview': boundsPreviewRect }"
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
              v-if="smartCursorEnabled && visibleObstacleEdgePath"
              class="graphwar-killer__obstacle-edge"
              :d="visibleObstacleEdgePath"
            />
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
                    { 'graphwar-killer__detection--hovered': box.id === hoveredDetectedSoldierId },
                  ]"
                  :cx="box.x + box.width / 2"
                  :cy="box.y + box.height / 2"
                  :r="box.width / 2"
                />
              </g>
            </template>
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
            <polyline
              v-if="plottedCurvePoints"
              class="graphwar-killer__curve-line"
              :points="plottedCurvePoints"
              :style="{ stroke: trajectoryStrokeColor }"
            />
            <g
              v-for="(point, index) in pathPixels"
              :key="`magnifier-${index}-${point.x}-${point.y}`"
            >
              <circle
                class="graphwar-killer__point"
                :class="{ 'graphwar-killer__point--start': index === 0 }"
                :cx="point.x"
                :cy="point.y"
                :r="soldierMarkerRadius"
              />
              <text
                class="graphwar-killer__point-label"
                :x="point.x + soldierMarkerRadius + 4"
                :y="point.y - soldierMarkerRadius - 4"
              >
                {{ index === 0 ? "己" : index }}
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
      <h2 id="graphwar-killer-result-title">函数</h2>
      <button
        type="button"
        class="graphwar-killer__primary-button"
        :disabled="!formulaResult"
        @click="copyFormula"
      >
        {{ copyButtonText }}
      </button>
    </div>
    <div
      v-if="formulaResult"
      class="graphwar-killer__formula-row"
    >
      <span class="graphwar-killer__formula-prefix">
        {{ equationModes.find((mode) => mode.value === equationMode)?.label }}
      </span>
      <p class="graphwar-killer__formula">
        {{ formulaResult.expression }}
      </p>
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
      v-if="!formulaResult"
      class="graphwar-killer__error"
    >
      {{ calculationMessage }}
    </p>
    <div
      v-if="mappedPathPoints.length"
      class="graphwar-killer__point-table"
    >
      <div>
        <span>点</span>
        <span>x</span>
        <span>y</span>
      </div>
      <div
        v-for="(point, index) in mappedPathPoints"
        :key="`row-${index}-${point.x}-${point.y}`"
      >
        <span>{{ index === 0 ? "己方" : `路径 ${index}` }}</span>
        <span>{{ formatDecimal(point.x, visibleDecimalPlaces) }}</span>
        <span>{{ formatDecimal(point.y, visibleDecimalPlaces) }}</span>
      </div>
    </div>
  </section>
</div>

## 使用说明

- 上传图片、拖入图片，或在页面打开时直接粘贴截图。
- 在“设定”里填坐标范围，选择算法、游戏模式。
- 用“点选边界”左键点边界的两个角；右键取消当前点。
- 切到“点选路径”，左键先点自己士兵中心；再点路径点中心，右键空白处撤回最近一个路径点。
- 可使用左键拖动路径点微调，右键点路径点删除。
- 点到 `-x` 一侧时，会自动变成垂直点。
- 复制生成的函数到 Graphwar。

<style scoped>
.graphwar-killer {
  display: grid;
  width: 100%;
  max-width: 100%;
  gap: 14px;
  margin: 16px 0 24px;
  padding: 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}

.graphwar-killer h2 {
  margin: 0;
  padding: 0;
  border: 0;
  font-size: 1rem;
}

.graphwar-killer label {
  display: grid;
  gap: 4px;
  min-width: 0;
  font-weight: 600;
}

.graphwar-killer input:not([type="file"]) {
  box-sizing: border-box;
  width: 100%;
  min-height: 40px;
  padding: 9px 11px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg);
  font-variant-numeric: tabular-nums;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
}

.graphwar-killer button,
.graphwar-killer__upload span {
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-family: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  line-height: 1.2;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, color 0.2s ease, background-color 0.2s ease;
}

.graphwar-killer button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.graphwar-killer__panel {
  display: grid;
  align-content: start;
  gap: 12px;
  min-width: 0;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 88%, transparent);
  border-radius: 12px;
  background: var(--vp-c-bg);
}

.graphwar-killer__label-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
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

.graphwar-killer__label-row--image-status {
  justify-content: flex-start;
}

.graphwar-killer__label-row--image-status > span {
  text-align: left;
}

.graphwar-killer__label-row--result {
  align-items: center;
}

.graphwar-killer__upload {
  width: fit-content;
}

.graphwar-killer__upload input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.graphwar-killer__upload span {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 7px 12px;
}

.graphwar-killer__stage {
  position: relative;
  overflow: hidden;
  width: 100%;
  border: 1px solid var(--vp-c-divider);
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--vp-c-divider) 42%, transparent) 1px, transparent 1px),
    linear-gradient(color-mix(in srgb, var(--vp-c-divider) 42%, transparent) 1px, transparent 1px),
    var(--vp-c-bg-soft);
  background-size: 40px 40px;
  touch-action: none;
  user-select: none;
}

.graphwar-killer__stage img {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  max-width: none;
  margin: 0;
  border-radius: 0;
  object-fit: fill;
  object-position: 0 0;
  pointer-events: none;
  vertical-align: top;
}

.graphwar-killer__stage--empty {
  min-height: 280px;
}

.graphwar-killer__magnifier {
  position: absolute;
  z-index: 3;
  overflow: hidden;
  border: 2px solid var(--vp-c-brand-1);
  border-radius: 999px;
  background: var(--vp-c-bg);
  box-shadow: 0 12px 32px rgb(15 23 42 / 0.2);
  pointer-events: none;
}

.graphwar-killer__magnifier-content {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
}

.graphwar-killer__magnifier-image {
  z-index: 0;
}

.graphwar-killer__magnifier::before,
.graphwar-killer__magnifier::after {
  content: "";
  position: absolute;
  z-index: 2;
  background: #f97316;
  opacity: 0.86;
}

.graphwar-killer__magnifier::before {
  top: 50%;
  left: 38%;
  width: 24%;
  height: 1px;
}

.graphwar-killer__magnifier::after {
  top: 38%;
  left: 50%;
  width: 1px;
  height: 24%;
}

.graphwar-killer__placeholder {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: color-mix(in srgb, var(--vp-c-text-1) 62%, var(--vp-c-text-2) 38%);
  font-weight: 700;
  text-align: center;
}

.graphwar-killer__overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.graphwar-killer__bounds {
  fill: color-mix(in srgb, var(--vp-c-brand-soft) 18%, transparent);
  stroke: var(--vp-c-brand-1);
  stroke-dasharray: 12 8;
  stroke-width: 3;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__bounds--preview {
  fill: color-mix(in srgb, #f97316 14%, transparent);
  stroke: #f97316;
}

.graphwar-killer__bounds-point {
  fill: #f97316;
  stroke: var(--vp-c-bg);
  stroke-width: 3;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__axis {
  stroke: color-mix(in srgb, var(--vp-c-brand-1) 64%, transparent);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__detection-group {
  pointer-events: none;
}

.graphwar-killer__detection {
  fill: none;
  stroke-width: 2.5;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__detection--soldier {
  stroke: #16a34a;
}

.graphwar-killer__detection--hovered {
  stroke: #dc2626;
}

.graphwar-killer__obstacle-edge {
  fill: none;
  stroke: #dc2626;
  stroke-linecap: square;
  stroke-linejoin: miter;
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__target-range {
  fill: color-mix(in srgb, #86efac 30%, transparent);
  pointer-events: none;
}

.graphwar-killer__path-line {
  stroke: #38bdf8;
  stroke-dasharray: 7 6;
  stroke-linecap: round;
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__curve-line {
  fill: none;
  stroke: #ec4899;
  stroke-linecap: round;
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
  animation: graphwar-killer-curve-blink 900ms ease-in-out infinite;
}

@keyframes graphwar-killer-curve-blink {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.34;
  }
}

.graphwar-killer__point {
  fill: color-mix(in srgb, #f97316 10%, transparent);
  stroke: #f97316;
  stroke-dasharray: 5 4;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__point--start {
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
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.graphwar-killer__image-actions button {
  min-height: 36px;
  padding: 7px 12px;
}

.graphwar-killer__coordinate-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
}

.graphwar-killer__coordinate-grid label {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}

.graphwar-killer__steepness-label {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}

.graphwar-killer__setting-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}

.graphwar-killer__setting-label {
  font-weight: 600;
}

.graphwar-killer__game-mode-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.graphwar-killer__precision-label {
  grid-template-columns: auto minmax(74px, 92px);
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.graphwar-killer__detection-setting-label {
  grid-template-columns: auto minmax(74px, 92px) auto;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.graphwar-killer__detection-setting-label span {
  color: color-mix(in srgb, var(--vp-c-text-1) 68%, var(--vp-c-text-2) 32%);
  font-size: 0.88rem;
  font-weight: 500;
}

.graphwar-killer__tool-toggle {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(92px, 1fr));
  gap: 0;
  min-height: 38px;
  padding: 3px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: color-mix(in srgb, var(--vp-c-bg-soft) 68%, var(--vp-c-bg));
}

.graphwar-killer__tool-toggle::before {
  content: "";
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 3px;
  width: calc(50% - 3px);
  border-radius: 999px;
  background: var(--vp-c-brand-1);
  box-shadow: 0 6px 14px rgb(15 23 42 / 0.12);
  transition: transform 0.2s ease;
}

.graphwar-killer__tool-toggle--path::before {
  transform: translateX(100%);
}

.graphwar-killer__tool-toggle button {
  position: relative;
  z-index: 1;
  min-height: 30px;
  padding: 5px 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  box-shadow: none;
  color: color-mix(in srgb, var(--vp-c-text-1) 64%, var(--vp-c-text-2) 36%);
  font-size: 0.9rem;
  white-space: nowrap;
  transform: none;
}

.graphwar-killer__tool-toggle button:hover {
  box-shadow: none;
  transform: none;
}

.graphwar-killer__tool-toggle-button--active {
  color: var(--vp-c-white) !important;
}

.graphwar-killer__equation-toggle {
  position: relative;
  display: grid;
  flex: 0 1 230px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  width: min(100%, 230px);
  min-height: 38px;
  padding: 3px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: color-mix(in srgb, var(--vp-c-bg-soft) 68%, var(--vp-c-bg));
}

.graphwar-killer__equation-toggle::before {
  content: "";
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 3px;
  width: calc((100% - 6px) / 3);
  border-radius: 999px;
  background: var(--vp-c-brand-1);
  box-shadow: 0 6px 14px rgb(15 23 42 / 0.12);
  transition: transform 0.2s ease;
}

.graphwar-killer__equation-toggle--dy::before {
  transform: translateX(100%);
}

.graphwar-killer__equation-toggle--ddy::before {
  transform: translateX(200%);
}

.graphwar-killer__equation-toggle button {
  position: relative;
  z-index: 1;
  min-width: 0;
  min-height: 30px;
  padding: 5px 8px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  box-shadow: none;
  color: color-mix(in srgb, var(--vp-c-text-1) 64%, var(--vp-c-text-2) 36%);
  font-family: inherit;
  font-size: 0.9rem;
  line-height: 1.2;
  white-space: nowrap;
  transform: none;
}

.graphwar-killer__equation-toggle button:hover {
  box-shadow: none;
  transform: none;
}

.graphwar-killer__equation-toggle-button--active {
  color: var(--vp-c-white) !important;
}

.graphwar-killer__primary-button {
  min-height: 38px;
  padding: 8px 14px;
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-1);
  color: var(--vp-c-white);
  white-space: nowrap;
}

.graphwar-killer__toggle-button--active {
  border-color: var(--vp-c-brand-1) !important;
  background: var(--vp-c-brand-soft) !important;
  color: var(--vp-c-brand-1) !important;
}

.graphwar-killer__formula-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}

.graphwar-killer__formula-prefix {
  min-height: 52px;
  padding: 14px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
  font-family: var(--vp-font-family-mono);
  font-weight: 800;
  white-space: nowrap;
  user-select: none;
}

.graphwar-killer__formula {
  margin: 0;
  padding: 14px;
  overflow-x: auto;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 28%, var(--vp-c-divider));
  border-radius: 10px;
  background: color-mix(in srgb, var(--vp-c-brand-soft) 54%, var(--vp-c-bg));
  font-family: var(--vp-font-family-mono);
  font-size: 1rem;
  line-height: 1.6;
  white-space: nowrap;
}

.graphwar-killer__error {
  margin: 0;
  color: var(--vp-c-danger-1);
}

.graphwar-killer__settings-error {
  padding-top: 10px;
  border-top: 1px solid color-mix(in srgb, var(--vp-c-danger-1) 24%, transparent);
  font-size: 0.9rem;
}

.graphwar-killer__hint {
  margin: 0;
  color: color-mix(in srgb, var(--vp-c-text-1) 68%, var(--vp-c-text-2) 32%);
  font-size: 0.9rem;
  line-height: 1.5;
}

.graphwar-killer__hint--warning {
  color: #b45309;
  font-weight: 700;
}

.graphwar-killer__point-table {
  display: grid;
  overflow-x: auto;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
}

.graphwar-killer__point-table > div {
  display: grid;
  grid-template-columns: minmax(90px, 1fr) minmax(130px, max-content) minmax(130px, max-content);
  gap: 8px;
  min-width: 100%;
  padding: 8px 10px;
  border-top: 1px solid var(--vp-c-divider);
  font-variant-numeric: tabular-nums;
  width: max-content;
}

.graphwar-killer__point-table > div:first-child {
  border-top: 0;
  background: var(--vp-c-bg-soft);
  font-weight: 700;
}

.graphwar-killer__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.graphwar-killer button:hover:not(:disabled),
.graphwar-killer__upload:hover span {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 8px 20px rgb(15 23 42 / 0.06);
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
  outline: none;
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 52%, var(--vp-c-divider));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--vp-c-brand-1) 16%, transparent);
}

@media (max-width: 760px) {
  .graphwar-killer__label-row {
    display: grid;
    gap: 4px;
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

@media (max-width: 520px) {
  .graphwar-killer__setting-row {
    grid-template-columns: 1fr;
  }
}
</style>
