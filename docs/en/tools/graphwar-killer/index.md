---
aside: false
publish: false
published: 2026-06-23T12:00:00+08:00
---

# Graphwar Killer

<!-- autocorrect-disable -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { GRAPHWAR_TOOL_SIGN_EPSILON, buildFormula } from "../../../tools/graphwar-killer/formula";
import {
  clampPixelPointToCanvas,
  graphToImagePoint,
  imageToGraphPoint,
  isVerticalGraphDelta,
  normalizeBoundsRect,
  normalizePathPoint,
  xPlusGoesRight,
} from "../../../tools/graphwar-killer/geometry";
import {
  GRAPHWAR_DEFAULT_X_LIMIT,
  GRAPHWAR_GAME_SOLDIER_RADIUS,
  GRAPHWAR_SOLDIER_RADIUS,
  GRAPHWAR_VISIBLE_Y_LIMIT,
} from "../../../tools/graphwar-killer/graphwar";
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
} from "../../../tools/graphwar-killer/numbers";
import { createGraphwarFormulaPathPoints, getGraphwarLaunchAngle, sampleGraphwarTrajectory } from "../../../tools/graphwar-killer/simulator";
import { graphwarToolDefaults } from "../../../tools/graphwar-killer/tool-defaults";
import { createGraphPoint, createPixelPoint } from "../../../tools/graphwar-killer/types";
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
} from "../../../tools/graphwar-killer/types";

type ParsedBounds = { ok: true; bounds: GraphBounds } | { ok: false; message: string };
type ParsedSteepness = { ok: true; steepness: number } | { ok: false; message: string };
type ParsedPrecision = { ok: true; decimalPlaces: number } | { ok: false; message: string };
interface PathLineSegment {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
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
const pathPixels = ref<PixelPoint[]>([]);
const pathStatus = ref("");
const copyStatus = ref<TransferStatus>("idle");
let copyStatusTimer: ReturnType<typeof setTimeout> | undefined;

const equationModes = [
  { value: "y", label: "y=", description: "Output a step function" },
  { value: "dy", label: "y'=", description: "Output the first derivative of a step function" },
  { value: "ddy", label: "y''=", description: "Output the second derivative of a step function" },
] as const satisfies readonly { value: EquationMode; label: string; description: string }[];
const algorithmModes = [
  { value: "abs", label: "Double absolute value" },
  { value: "step", label: "Step function" },
] as const satisfies readonly { value: AlgorithmMode; label: string }[];

const parsedBounds = computed<ParsedBounds>(() => {
  const minX = parseFiniteNumber(minXText.value);
  const maxX = parseFiniteNumber(maxXText.value);
  const minY = parseFiniteNumber(minYText.value);
  const maxY = parseFiniteNumber(maxYText.value);

  if (minX === undefined || maxX === undefined || minY === undefined || maxY === undefined) {
    return { ok: false as const, message: "Bounds coordinates must be valid numbers." };
  }

  const bounds: GraphBounds = { minX, maxX, minY, maxY };
  if (nearlyEqual(bounds.minX, bounds.maxX) || nearlyEqual(bounds.minY, bounds.maxY)) {
    return { ok: false as const, message: "The x or y bounds range cannot be 0." };
  }

  return { ok: true as const, bounds };
});

const parsedSteepness = computed<ParsedSteepness>(() => {
  const steepness = parseFiniteNumber(steepnessText.value);
  if (steepness === undefined || steepness <= 0) {
    return { ok: false as const, message: "Step steepness must be a number greater than 0." };
  }
  return { ok: true as const, steepness };
});

const parsedPrecision = computed<ParsedPrecision>(() => {
  const decimalPlaces = parseFiniteNumber(precisionText.value);
  if (decimalPlaces === undefined || !Number.isInteger(decimalPlaces)) {
    return { ok: false as const, message: "Decimal places must be an integer." };
  }
  if (decimalPlaces < 0 || decimalPlaces > MAX_FORMULA_DECIMAL_PLACES) {
    return { ok: false as const, message: `Decimal places must be between 0 and ${MAX_FORMULA_DECIMAL_PLACES}.` };
  }
  return { ok: true as const, decimalPlaces };
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
      ? "Output a double-absolute-value connector"
      : equationMode.value === "dy"
        ? "Output the first derivative of the double-absolute-value connector"
        : "Double-absolute-value mode does not output y''"
    : equationModes.find((mode) => mode.value === equationMode.value)?.description ?? ""
));
const activeToolHint = computed(() => (
  toolMode.value === "bounds"
    ? "Left-click two corners to set bounds; right-click to cancel the selected point."
    : pathPixels.value.length === 0
      ? "Left-click your soldier center first; the tool converts it to the launch edge. Right-click to undo."
      : "Keep clicking target or path centers; points toward x- become vertical. Right-click to undo."
));
const boundsPreviewRect = computed(() => (
  boundsFirstPoint.value && pointerPreviewPoint.value
    ? normalizeBoundsRect(boundsFirstPoint.value, pointerPreviewPoint.value)
    : undefined
));
const visibleBoundsRect = computed(() => boundsPreviewRect.value ?? boundsRect.value);
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

const calculationMessage = computed(() => {
  if (!parsedBounds.value.ok) {
    return parsedBounds.value.message;
  }
  if (algorithmMode.value === "step" && !parsedSteepness.value.ok) {
    return parsedSteepness.value.message;
  }
  if (algorithmMode.value === "abs" && equationMode.value === "ddy") {
    return "Double-absolute-value mode does not output y''; choose y= or y'=.";
  }
  if (pathPixels.value.length < 2) {
    return "Click your own position first, then choose at least one path point";
  }
  return "";
});

const settingsMessage = computed(() => (!parsedPrecision.value.ok ? parsedPrecision.value.message : ""));

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
  return `Use the keyboard up/down keys to set the launch angle to about ${formatAngleDegree(angle)}°.`;
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
  const stopReason = trajectorySample.value?.stopReason;
  if (!stopReason || stopReason === "completed" || stopReason === "unsupported") {
    return "";
  }
  if (stopReason === "too-steep") {
    return "Preview stopped: the local slope is too steep. Graphwar reaches its minimum step size and still cannot continue, so it will explode here in-game.";
  }
  if (stopReason === "max-steps") {
    return "Preview stopped: Graphwar's maximum sample count was reached. The function is too long and will explode near the end in-game.";
  }
  if (stopReason === "out-of-bounds") {
    return "Preview stopped: the trajectory leaves the Graphwar plane and will explode early at the boundary in-game.";
  }
  return "Preview stopped: the formula produced NaN or infinity and will explode early in-game.";
});

const plottedCurvePoints = computed(() => {
  if (!trajectorySample.value || !parsedBounds.value.ok) {
    return "";
  }

  const { bounds } = parsedBounds.value;
  return trajectorySample.value.points.map((point) => {
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
  const moveLeft = displayX > stageDisplayWidth.value * 0.64;
  const moveUp = displayY > stageDisplayHeight.value * 0.68;
  const moveDown = displayY < stageDisplayHeight.value * 0.28;
  const translateX = moveLeft ? `calc(-100% - 18px)` : "18px";
  const translateY = moveUp ? "calc(-100% + 12px)" : moveDown ? "-12px" : "-50%";

  return {
    width: `${graphwarToolDefaults.magnifierSize}px`,
    height: `${graphwarToolDefaults.magnifierSize}px`,
    left: `${displayX}px`,
    top: `${displayY}px`,
    transform: `translate(${translateX}, ${translateY})`,
    backgroundImage: `url("${imageUrl.value}")`,
    backgroundSize: `${stageDisplayWidth.value * graphwarToolDefaults.magnifierZoom}px ${stageDisplayHeight.value * graphwarToolDefaults.magnifierZoom}px`,
    backgroundPosition: `${graphwarToolDefaults.magnifierSize / 2 - displayX * graphwarToolDefaults.magnifierZoom}px ${graphwarToolDefaults.magnifierSize / 2 - displayY * graphwarToolDefaults.magnifierZoom}px`,
  };
});
const copyButtonText = computed(() => {
  if (copyStatus.value === "success") {
    return "Copied";
  }
  if (copyStatus.value === "error") {
    return "Copy failed";
  }
  return "Copy formula";
});
const statusAnnouncement = computed(() => {
  if (copyStatus.value === "success") {
    return "Formula copied to the clipboard.";
  }
  if (copyStatus.value === "error") {
    return "Copy failed. Copy the formula manually.";
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
});

/** Load a user-uploaded screenshot from the hidden file input. */
function handleImageUpload(event: Event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement) || !input.files?.[0]) {
    return;
  }

  loadImageFile(input.files[0]);
  input.value = "";
}

/** Handle direct Ctrl / Cmd + V image paste on the page. */
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

/** Handle screenshots dragged onto the stage area. */
function handleDrop(event: DragEvent) {
  const file = Array.from(event.dataTransfer?.files ?? []).find((item) => item.type.startsWith("image/"));
  if (file) {
    loadImageFile(file);
  }
}

/** Read the image file as a data URL and set it as the current screenshot. */
function loadImageFile(file: File) {
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    if (typeof reader.result !== "string") {
      return;
    }

    applyLoadedImage(reader.result, file.name || "Pasted screenshot");
  });
  reader.readAsDataURL(file);
}

/** Capture a screen image through the browser Screen Capture API. */
async function captureScreenImage() {
  if (typeof navigator === "undefined" || typeof document === "undefined") {
    imageStatus.value = "Screen capture is not supported in this environment.";
    return;
  }

  const mediaDevices = navigator.mediaDevices as MediaDevices & {
    getDisplayMedia?: (constraints?: DisplayMediaStreamOptions) => Promise<MediaStream>;
  };
  if (!mediaDevices?.getDisplayMedia) {
    imageStatus.value = "This browser does not support the Screen Capture API.";
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
    applyLoadedImage(canvas.toDataURL("image/png"), "Screen capture");
  } catch {
    imageStatus.value = "Screen capture was not completed";
  } finally {
    for (const track of stream?.getTracks() ?? []) {
      track.stop();
    }
  }
}

/** Wait for the captured video stream dimensions before drawing to canvas. */
function waitForVideoMetadata(video: HTMLVideoElement) {
  return new Promise<void>((resolve, reject) => {
    video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    video.addEventListener("error", () => reject(new Error("Video metadata unavailable")), { once: true });
  });
}

/** Apply a loaded screenshot and clear path points; keep the selected bounds. */
function applyLoadedImage(url: string, name: string) {
  imageUrl.value = url;
  imageName.value = name;
  imageStatus.value = "";
  pathPixels.value = [];
  boundsFirstPoint.value = undefined;
  pointerPreviewPoint.value = undefined;
  magnifierPoint.value = undefined;
}

/** Update image dimensions after the screenshot element loads; keep the current bounds. */
function handleImageLoad() {
  const image = imageRef.value;
  if (!image) {
    return;
  }

  imageWidth.value = image.naturalWidth || graphwarToolDefaults.canvasWidth;
  imageHeight.value = image.naturalHeight || graphwarToolDefaults.canvasHeight;
  boundsFirstPoint.value = undefined;
  pointerPreviewPoint.value = undefined;
}

/** Dispatch pointer clicks to bounds or path picking based on the current mode. */
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

  const nextPoint = normalizePathPoint(point, boundsRect.value, parsedBounds.value.bounds, pathPixels.value.at(-1));
  if (!nextPoint) {
    return;
  }

  if (!canAppendPathPoint(nextPoint)) {
    return;
  }

  pathPixels.value = [...pathPixels.value, nextPoint];
  pathStatus.value = "";
}

/** Track the pointer position for bounds preview and the magnifier. */
function handleStagePointerMove(event: PointerEvent) {
  const point = getImagePointFromEvent(event);
  if (!point) {
    return;
  }

  if (magnifierEnabled.value) {
    magnifierPoint.value = point;
  }
  if (toolMode.value !== "bounds") {
    return;
  }

  pointerPreviewPoint.value = clampPixelPointToCanvas(point, imageWidth.value, imageHeight.value);
}

/** Clear hover-only preview state when the pointer leaves the screenshot stage. */
function handleStagePointerLeave() {
  pointerPreviewPoint.value = undefined;
  magnifierPoint.value = undefined;
}

/** Use right-click to cancel a bounds point or undo the latest path point. */
function handleStageContextMenu() {
  if (toolMode.value === "bounds") {
    boundsFirstPoint.value = undefined;
    pointerPreviewPoint.value = undefined;
    return;
  }

  if (toolMode.value !== "path") {
    return;
  }

  undoLastPoint();
}

/** Switch between bounds and path modes, clearing temporary state for the current mode. */
function setToolMode(mode: ToolMode) {
  toolMode.value = mode;
  pointerPreviewPoint.value = undefined;
  if (mode === "path") {
    boundsFirstPoint.value = undefined;
  }
}

/** Apply Graphwar's x+ path rule after normalizing the candidate point. */
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

  pathStatus.value = "Only x+ movement is allowed; x- becomes vertical automatically.";
  return false;
}

/** Clear all selected path points without changing the image bounds or settings. */
function clearPath() {
  pathPixels.value = [];
  pathStatus.value = "";
}

/** Remove the most recently selected path point. */
function undoLastPoint() {
  if (pathPixels.value.length === 0) {
    return;
  }

  pathPixels.value = pathPixels.value.slice(0, -1);
  pathStatus.value = "";
}

/** Copy the currently generated Graphwar expression. */
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

/** Wrap vertical tolerance checks in graph coordinates with the current page state. */
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

/** Convert a browser pointer event into screenshot pixel coordinates. */
function getImagePointFromEvent(event: PointerEvent): PixelPoint | undefined {
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

/** Set temporary copy feedback and clear it shortly after. */
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

/** Copy text with the Clipboard API, falling back to a hidden textarea command. */
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

Upload or paste a [Graphwar](https://graphwar.com/graphwar_1/index.html) screenshot, calibrate the coordinate bounds, then click your own position and target path points to generate a formula expression. All calculations run locally.

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
    aria-label="Screenshot"
  >
    <div class="graphwar-killer__label-row graphwar-killer__label-row--image-status">
      <span>{{ imageStatus || imageName || "Capture, upload, drag in, or directly Ctrl / Cmd + V paste a screenshot" }}</span>
    </div>
    <div class="graphwar-killer__image-actions">
      <button
        type="button"
        @click="captureScreenImage"
      >
        Capture screen
      </button>
      <label class="graphwar-killer__upload">
        <input
          type="file"
          accept="image/*"
          @change="handleImageUpload"
        >
        <span>Upload image</span>
      </label>
      <button
        type="button"
        :aria-pressed="magnifierEnabled"
        :class="{ 'graphwar-killer__toggle-button--active': magnifierEnabled }"
        @click="magnifierEnabled = !magnifierEnabled"
      >
        Magnifier
      </button>
      <div
        class="graphwar-killer__tool-toggle"
        :class="{ 'graphwar-killer__tool-toggle--path': toolMode === 'path' }"
        role="group"
        aria-label="Operation mode"
      >
        <button
          type="button"
          :aria-pressed="toolMode === 'bounds'"
          :class="{ 'graphwar-killer__tool-toggle-button--active': toolMode === 'bounds' }"
          @click="setToolMode('bounds')"
        >
          Pick bounds
        </button>
        <button
          type="button"
          :aria-pressed="toolMode === 'path'"
          :class="{ 'graphwar-killer__tool-toggle-button--active': toolMode === 'path' }"
          @click="setToolMode('path')"
        >
          Pick path
        </button>
      </div>
      <button
        type="button"
        @click="clearPath"
      >
        Clear path points
      </button>
      <button
        type="button"
        @click="undoLastPoint"
      >
        Undo path point
      </button>
    </div>
    <p class="graphwar-killer__hint">
      {{ activeToolHint }}
    </p>
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
        Upload, drag in, or paste a screenshot to start calibration
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
            {{ index === 0 ? "Me" : index }}
          </text>
        </g>
      </svg>
      <div
        v-if="magnifierEnabled && imageUrl && magnifierPoint"
        class="graphwar-killer__magnifier"
        :style="magnifierStyle"
        aria-hidden="true"
      />
    </div>
  </section>
  <div class="graphwar-killer__layout">
    <section
      class="graphwar-killer__panel"
      aria-labelledby="graphwar-killer-settings-title"
    >
      <div class="graphwar-killer__label-row">
        <h2 id="graphwar-killer-settings-title">Settings</h2>
        <span>{{ activeEquationDescription }}</span>
      </div>
      <div class="graphwar-killer__setting-row">
        <span class="graphwar-killer__setting-label">Algorithm</span>
        <div
          class="graphwar-killer__tool-toggle graphwar-killer__algorithm-toggle"
          :class="{ 'graphwar-killer__tool-toggle--path': algorithmMode === 'step' }"
          role="group"
          aria-label="Algorithm"
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
        Step steepness a
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
        <span class="graphwar-killer__setting-label">Game mode</span>
        <div class="graphwar-killer__game-mode-controls">
          <div
            class="graphwar-killer__equation-toggle"
            :class="{
              'graphwar-killer__equation-toggle--dy': equationMode === 'dy',
              'graphwar-killer__equation-toggle--ddy': equationMode === 'ddy',
            }"
            role="group"
            aria-label="Graphwar game mode"
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
            Decimal places
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
  </div>
  <section
    class="graphwar-killer__panel"
    aria-labelledby="graphwar-killer-result-title"
  >
    <div class="graphwar-killer__label-row graphwar-killer__label-row--result">
      <h2 id="graphwar-killer-result-title">Formula</h2>
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
        <span>Point</span>
        <span>x</span>
        <span>y</span>
      </div>
      <div
        v-for="(point, index) in mappedPathPoints"
        :key="`row-${index}-${point.x}-${point.y}`"
      >
        <span>{{ index === 0 ? "Self" : `Path ${index}` }}</span>
        <span>{{ formatDecimal(point.x, visibleDecimalPlaces) }}</span>
        <span>{{ formatDecimal(point.y, visibleDecimalPlaces) }}</span>
      </div>
    </div>
  </section>
</div>

## How to use

- Upload an image, drag one in, or paste a screenshot directly while the page is open.
- In Settings, enter the coordinate range, then choose the algorithm and game mode.
- Use Pick bounds to left-click two boundary corners; right-click to cancel the current point.
- Switch to Pick path, click your own soldier center first, then click target or path centers; right-click to undo.
- When a point goes toward `-x`, it becomes a vertical point automatically.
- Copy the generated formula into Graphwar.

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
  background-repeat: no-repeat;
  box-shadow: 0 12px 32px rgb(15 23 42 / 0.2);
  pointer-events: none;
}

.graphwar-killer__magnifier::before,
.graphwar-killer__magnifier::after {
  content: "";
  position: absolute;
  z-index: 1;
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

.graphwar-killer__target-range {
  fill: color-mix(in srgb, #86efac 30%, transparent);
  pointer-events: none;
}

.graphwar-killer__path-line {
  stroke: #f97316;
  stroke-linecap: round;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__curve-line {
  fill: none;
  stroke: #06b6d4;
  stroke-linecap: round;
  stroke-width: 3;
  vector-effect: non-scaling-stroke;
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

.graphwar-killer__layout {
  display: grid;
  order: -1;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
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
  .graphwar-killer__layout {
    grid-template-columns: 1fr;
  }

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
