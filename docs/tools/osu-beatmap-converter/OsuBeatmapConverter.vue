<script setup lang="ts">
import { Download, Play, Plus, Upload, X } from "@lucide/vue";
import {
  convertOsuBeatmapDetailed,
  type ConversionOptions,
  type ConversionResult,
  type Mania2kOptions,
  type RemoveSvMode,
} from "osu-beatmap-converter";
import { computed, ref, watch, type CSSProperties } from "vue";

import ToggleField from "../graphwar-killer/presentation/controls/ToggleField.vue";

type ConverterLanguage = "en" | "zh-Hans";

/** Localized UI strings kept beside the shared browser-only tool. */
interface ConverterLabels {
  addFiles: string;
  addMoreFiles: string;
  bpm: string;
  conversionSettings: string;
  converted: string;
  download: string;
  downloadAll: string;
  dropFiles: string;
  failed: string;
  fileQueue: string;
  filesQueued: string;
  holds: string;
  invalidFile: string;
  laneOne: string;
  laneTwo: string;
  mainKey: string;
  maximumJackNotes: string;
  measureStart: string;
  minimumJackInterval: string;
  noPreview: string;
  objectCount: string;
  preview: string;
  previewNotes: string;
  preset: string;
  presetCustom: string;
  presetForcedTrill: string;
  presetSingleLane: string;
  presetDefault: string;
  removeFile: string;
  removeSv: string;
  startConversion: string;
  svRemoveAll: string;
  svRemoveInherited: string;
  svKeepAll: string;
  targetKeys: string;
  taps: string;
  trillStartKey: string;
  verticallyFlipPlayfield: string;
  viewFile: string;
  viewRange: string;
}

const labels = {
  en: {
    addFiles: "Choose .osu files",
    addMoreFiles: "Add files",
    bpm: "BPM",
    conversionSettings: "Conversion settings",
    converted: "Converted",
    download: "Download",
    downloadAll: "Download all",
    dropFiles: "Drop one or more .osu files here",
    failed: "Failed",
    fileQueue: "File queue",
    filesQueued: "files queued",
    holds: "Holds",
    invalidFile: "Only .osu files can be added.",
    laneOne: "Lane 1",
    laneTwo: "Lane 2",
    mainKey: "Ordinary note lane number",
    maximumJackNotes: "Maximum jack notes",
    measureStart: "Current measure start",
    minimumJackInterval: "Minimum jack interval (ms)",
    noPreview: "Choose a .osu file to inspect its notes and timing.",
    objectCount: "Objects",
    preview: "Preview",
    previewNotes: "Preview notes",
    preset: "Jack split strategy",
    presetCustom: "Custom",
    presetForcedTrill: "Forced trill practice",
    presetSingleLane: "Single-lane practice",
    presetDefault: "Default preset",
    removeFile: "Remove file",
    removeSv: "SV handling",
    startConversion: "Start conversion",
    svRemoveAll: "Remove all SV (keep the first TimingPoints row)",
    svRemoveInherited: "Remove green lines only",
    svKeepAll: "Keep all SV",
    targetKeys: "Target keys",
    taps: "Taps",
    trillStartKey: "Trill segment first-note lane number",
    verticallyFlipPlayfield: "Vertically flip playfield",
    viewFile: "Preview file",
    viewRange: "Beatmap viewport navigator",
  },
  "zh-Hans": {
    addFiles: "选择 .osu 文件",
    addMoreFiles: "继续添加",
    bpm: "BPM",
    conversionSettings: "转换设置",
    converted: "已转换",
    download: "下载",
    downloadAll: "全部下载",
    dropFiles: "拖放一个或多个 .osu 文件到这里",
    failed: "失败",
    fileQueue: "文件队列",
    filesQueued: "个文件待转换",
    holds: "长音符",
    invalidFile: "只能添加 .osu 文件。",
    laneOne: "轨道 1",
    laneTwo: "轨道 2",
    mainKey: "普通音符轨道编号",
    maximumJackNotes: "最大纵连音符数",
    measureStart: "当前小节开始时间",
    minimumJackInterval: "最小纵连间隔（毫秒）",
    noPreview: "选择 .osu 文件后可查看音符和节拍预览。",
    objectCount: "物件",
    preview: "预览",
    previewNotes: "预览音符",
    preset: "纵连拆分策略",
    presetCustom: "自定义",
    presetForcedTrill: "强制交互练习",
    presetSingleLane: "单轨单点练习",
    presetDefault: "默认预设",
    removeFile: "移除文件",
    removeSv: "变速处理",
    startConversion: "开始转换",
    svRemoveAll: "移除全部变速（仅保留 TimingPoints 段首行）",
    svRemoveInherited: "仅移除绿线",
    svKeepAll: "保留全部变速",
    targetKeys: "目标键数",
    taps: "单点",
    trillStartKey: "交互段首音符轨道编号",
    verticallyFlipPlayfield: "上下颠倒（DDR 风格）",
    viewFile: "预览文件",
    viewRange: "谱面视窗导航条",
  },
} satisfies Record<ConverterLanguage, ConverterLabels>;

const props = defineProps<{
  /** Controls the page language while keeping conversion behavior and UI state shared. */
  language: ConverterLanguage;
}>();

interface PreviewNote {
  /** One-based mania lane reconstructed from the generated x coordinate. */
  lane: number;
  /** Inclusive note start in milliseconds. */
  startTime: number;
  /** Hold end or note start in milliseconds. */
  endTime: number;
  /** Distinguishes visible hold bars from tap markers. */
  isHold: boolean;
}

interface PreviewTimingPoint {
  /** Timestamp where this timing point takes effect. */
  offset: number;
  /** Duration of one beat after a red line; green lines retain their SV value. */
  beatLength: number;
  /** Number of beats that make one measure after a red line. */
  beatsPerMeasure: number;
  /** Distinguishes red BPM changes from green SV changes. */
  isRedLine: boolean;
}

interface PreviewBeatLine {
  /** Timestamp of one beat line in the visible preview window. */
  time: number;
  /** Highlights the first beat of a measure. */
  isMeasure: boolean;
}

interface BeatmapPreview {
  /** Requested output lane count used to reconstruct the preview lanes. */
  outputKeys: ConversionResult["outputKeys"];
  /** Number of objects in the generated preview output. */
  objectCount: ConversionResult["objectCount"];
  /** All generated objects, sorted for reporting and preview clipping. */
  notes: readonly PreviewNote[];
  /** Red and green timing points preserved in the generated output. */
  timingPoints: readonly PreviewTimingPoint[];
  /** Red timing points used for beat-grid calculation; a local 120 BPM fallback never becomes a visible marker. */
  gridTimingPoints: readonly PreviewTimingPoint[];
  /** Earliest timestamp represented by the overview bar. */
  rangeStart: number;
  /** Latest timestamp represented by the overview bar. */
  rangeEnd: number;
  /** Four-measure viewport start time used when the file first opens. */
  windowStart: number;
  /** Fixed duration of the movable preview viewport. */
  windowDuration: number;
}

interface PreviewNavigatorWindowStyle extends CSSProperties {
  /** Unclamped viewport start expressed against the complete beatmap range. */
  "--mania-converter-navigator-window-left": string;
  /** Actual viewport width expressed against the complete beatmap range. */
  "--mania-converter-navigator-window-width": string;
}

interface QueuedBeatmapBase {
  /** Stable local identity avoids filename collisions in a batch. */
  id: number;
  /** Browser-owned file; its bytes stay local until conversion starts. */
  file: File;
}

interface ReadyBeatmap extends QueuedBeatmapBase {
  /** A newly queued item has neither output nor a conversion error. */
  status: "ready";
  /** Latest local preview; absent only while its file is being read or is invalid. */
  preview?: BeatmapPreview;
}

interface CompletedBeatmap extends QueuedBeatmapBase {
  /** A successful item always carries its matching result and preview together. */
  result: ConversionResult;
  preview: BeatmapPreview;
  status: "completed";
}

interface FailedBeatmap extends QueuedBeatmapBase {
  /** A failed item has user-facing context and never exposes a partial download. */
  errorMessage: string;
  status: "failed";
}

/** The discriminated queue prevents download and error states from being mixed. */
type QueuedBeatmap = ReadyBeatmap | CompletedBeatmap | FailedBeatmap;

type Mania2kPresetId = "default" | "single_lane" | "forced_trill" | "custom";

interface Mania2kPreset {
  /** Stable select value; `custom` is derived instead of being a preset row. */
  id: Exclude<Mania2kPresetId, "custom">;
  /** Maximum interval that still groups consecutive notes as a jack. */
  minimumJackTimeInterval: number;
  /** Number of grouped notes allowed before they alternate lanes. */
  maximumNumberOfJackNotes: number;
}

const PREVIEW_MEASURE_COUNT = 4;
const PREVIEW_NOTE_LIMIT = 600;
/** Match the navigator window's inner height so narrow ranges stay circular instead of becoming ellipses. */
const PREVIEW_NAVIGATOR_MIN_WINDOW_WIDTH = 28;
const MANIA_2K_PRESETS = [
  { id: "default", minimumJackTimeInterval: 200, maximumNumberOfJackNotes: 1 },
  { id: "single_lane", minimumJackTimeInterval: 0, maximumNumberOfJackNotes: 1_000_000 },
  { id: "forced_trill", minimumJackTimeInterval: 1_000_000, maximumNumberOfJackNotes: 1 },
] satisfies readonly Mania2kPreset[];
const MANIA_2K_PRESET_IDS = ["default", "single_lane", "forced_trill", "custom"] satisfies readonly Mania2kPresetId[];

const fileInput = ref<HTMLInputElement>();
const queue = ref<QueuedBeatmap[]>([]);
const selectedPreviewId = ref<number>();
const isConverting = ref(false);
const isDropTarget = ref(false);
const errorMessage = ref("");
let nextQueueId = 0;

const keys = ref<ConversionOptions["keys"]>(2);
const removeSv = ref<RemoveSvMode>("all");
const mainKey = ref<Mania2kOptions["mainKey"]>(1);
const trillStartKey = ref<Mania2kOptions["trillStartKey"]>(1);
const minimumJackTimeInterval = ref(200);
const maximumNumberOfJackNotes = ref(1);
const selectedPreset = ref<Mania2kPresetId>("default");
const isPreviewVerticallyFlipped = ref(false);
const previewWindowStart = ref(0);
let previewGeneration = 0;
let activePreviewNavigatorPointerId: number | undefined;
let previewNavigatorPointerStart = 0;
let previewNavigatorWindowLeft = 0;

const text = computed(() => labels[props.language]);
const canConvert = computed(() => queue.value.length > 0 && !isConverting.value);
const completedBeatmaps = computed(() =>
  queue.value.filter((beatmap): beatmap is CompletedBeatmap => beatmap.status === "completed"),
);
const hasCompletedBeatmaps = computed(() => completedBeatmaps.value.length > 0);
const previewBeatmaps = computed(() =>
  queue.value.filter(
    (beatmap): beatmap is ReadyBeatmap | CompletedBeatmap =>
      beatmap.status !== "failed" && beatmap.preview !== undefined,
  ),
);
const selectedPreview = computed(() => {
  const previewId = selectedPreviewId.value;
  return previewBeatmaps.value.find((beatmap) => beatmap.id === previewId) ?? previewBeatmaps.value[0];
});
const currentPreview = computed(() => selectedPreview.value?.preview);
const currentPreviewWindowStart = computed(() => {
  const preview = currentPreview.value;
  if (!preview) {
    return 0;
  }
  return Math.min(Math.max(previewWindowStart.value, preview.rangeStart), preview.rangeEnd - preview.windowDuration);
});
const currentPreviewWindowEnd = computed(() => {
  const preview = currentPreview.value;
  return preview ? currentPreviewWindowStart.value + preview.windowDuration : 0;
});
const visiblePreviewNotes = computed(() => {
  const preview = currentPreview.value;
  if (!preview) {
    return [];
  }
  return preview.notes
    .filter(
      (note) => note.endTime >= currentPreviewWindowStart.value && note.startTime <= currentPreviewWindowEnd.value,
    )
    .slice(0, PREVIEW_NOTE_LIMIT);
});
const visiblePreviewTimingPoints = computed(() => {
  const preview = currentPreview.value;
  if (!preview) {
    return [];
  }
  return preview.timingPoints.filter(
    (timingPoint) =>
      timingPoint.offset >= currentPreviewWindowStart.value && timingPoint.offset <= currentPreviewWindowEnd.value,
  );
});
const visiblePreviewBeatLines = computed(() => {
  const preview = currentPreview.value;
  if (!preview) {
    return [];
  }
  return createPreviewBeatLines(
    preview.gridTimingPoints,
    currentPreviewWindowStart.value,
    currentPreviewWindowEnd.value,
  );
});
const previewBpm = computed(() => {
  const preview = currentPreview.value;
  if (!preview) {
    return 0;
  }
  const timingPoint =
    preview.gridTimingPoints.findLast((item) => item.offset <= currentPreviewWindowStart.value) ??
    preview.gridTimingPoints[0];
  return Number((60_000 / timingPoint.beatLength).toFixed(2));
});
const previewMeasureStart = computed(() => {
  const preview = currentPreview.value;
  if (!preview) {
    return 0;
  }
  return getPreviewMeasureStart(preview.gridTimingPoints, currentPreviewWindowStart.value);
});
const previewMeasureStartLabel = computed(() => formatPreviewTimestamp(previewMeasureStart.value));
const previewObjectCount = computed(() => currentPreview.value?.objectCount ?? 0);
const previewHoldCount = computed(() => currentPreview.value?.notes.filter((note) => note.isHold).length ?? 0);
const previewTapCount = computed(() => previewObjectCount.value - previewHoldCount.value);

// Opening another output starts at its first measure; replacing the same output keeps the user's viewport.
let lastPreviewSelectionId: number | undefined;
watch(
  [selectedPreviewId, currentPreview],
  ([selectedId, preview]) => {
    if (selectedId !== lastPreviewSelectionId) {
      previewWindowStart.value = preview?.windowStart ?? 0;
    }
    lastPreviewSelectionId = selectedId;
  },
  { immediate: true },
);

// Any change to conversion inputs invalidates generated text and its exact visual preview.
watch([keys, removeSv, mainKey, trillStartKey, minimumJackTimeInterval, maximumNumberOfJackNotes], () => {
  selectedPreset.value = getMatchingPreset();
  clearConversionResults(true);
  void refreshPreviews();
});

/** Identify whether the editable jack settings still exactly match one of the documented strategies. */
function getMatchingPreset(): Mania2kPresetId {
  for (const preset of MANIA_2K_PRESETS) {
    if (
      preset.minimumJackTimeInterval === minimumJackTimeInterval.value &&
      preset.maximumNumberOfJackNotes === maximumNumberOfJackNotes.value
    ) {
      return preset.id;
    }
  }
  return "custom";
}

/** Resolve the localized label for each capsule while keeping preset values language-independent. */
function getPresetLabel(id: Mania2kPresetId): string {
  if (id === "default") {
    return text.value.presetDefault;
  }
  if (id === "single_lane") {
    return text.value.presetSingleLane;
  }
  if (id === "forced_trill") {
    return text.value.presetForcedTrill;
  }
  return text.value.presetCustom;
}

/** Apply only the selected strategy thresholds; custom keeps the current editable values. */
function applyPreset(id: Mania2kPresetId) {
  if (id === "custom") {
    selectedPreset.value = id;
    return;
  }
  const preset = MANIA_2K_PRESETS.find((item) => item.id === id);
  if (!preset) {
    return;
  }
  selectedPreset.value = id;
  minimumJackTimeInterval.value = preset.minimumJackTimeInterval;
  maximumNumberOfJackNotes.value = preset.maximumNumberOfJackNotes;
}

/** Open the native multi-file picker from the compact queue action. */
function openFilePicker() {
  const input = fileInput.value;
  if (!input) {
    return;
  }
  input.click();
}

/** Add selected files and reset only stale conversion state, not the existing queue order. */
function addSelectedFiles(event: Event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }
  addFiles(input.files ?? []);
  // Resetting allows users to add the same local file again after removing it.
  input.value = "";
}

/** Accept a native file drop while keeping drag feedback inside the actual drop zone. */
function addDroppedFiles(event: DragEvent) {
  isDropTarget.value = false;
  addFiles(event.dataTransfer?.files ?? []);
}

/** Avoid clearing the active drop style while the pointer only moves between child elements. */
function leaveDropZone(event: DragEvent) {
  const dropZone = event.currentTarget;
  if (!(dropZone instanceof HTMLElement) || dropZone.contains(event.relatedTarget as Node | null)) {
    return;
  }
  isDropTarget.value = false;
}

/** Add only `.osu` inputs, preserving each selection as an independent queue row. */
function addFiles(files: Iterable<File>) {
  if (isConverting.value) {
    return;
  }
  const validFiles: File[] = [];
  let hasInvalidFile = false;
  for (const file of files) {
    if (file.name.toLowerCase().endsWith(".osu")) {
      validFiles.push(file);
    } else {
      hasInvalidFile = true;
    }
  }
  if (validFiles.length === 0) {
    if (hasInvalidFile) {
      errorMessage.value = text.value.invalidFile;
    }
    return;
  }
  errorMessage.value = hasInvalidFile ? text.value.invalidFile : "";
  clearConversionResults(false, false);
  queue.value = [
    ...queue.value,
    ...validFiles.map(
      (file) =>
        ({
          id: nextQueueId++,
          file,
          status: "ready",
        }) satisfies ReadyBeatmap,
    ),
  ];
  void refreshPreviews();
}

/** Remove a row without changing the identity or order of its remaining siblings. */
function removeBeatmap(id: number) {
  if (isConverting.value) {
    return;
  }
  queue.value = queue.value.filter((beatmap) => beatmap.id !== id);
  if (selectedPreviewId.value === id) {
    selectedPreviewId.value = undefined;
  }
  clearConversionResults();
  void refreshPreviews();
}

/** Discard completed output, and discard ready previews too when their conversion options changed. */
function clearConversionResults(shouldClearPreviews = false, shouldResetSelection = true) {
  if (isConverting.value || (!shouldClearPreviews && queue.value.every((beatmap) => beatmap.status === "ready"))) {
    return;
  }
  queue.value = queue.value.map((beatmap) => {
    const preview = shouldClearPreviews || beatmap.status === "failed" ? undefined : beatmap.preview;
    return {
      id: beatmap.id,
      file: beatmap.file,
      status: "ready",
      ...(preview === undefined ? {} : { preview }),
    } satisfies ReadyBeatmap;
  });
  if (shouldResetSelection) {
    selectedPreviewId.value = undefined;
  }
}

/** Convert queued files only far enough to render a live preview; no downloadable result is committed. */
async function refreshPreviews() {
  if (isConverting.value) {
    return;
  }
  const generation = ++previewGeneration;
  const readyBeatmaps = queue.value.filter((beatmap): beatmap is ReadyBeatmap => beatmap.status === "ready");
  const options = createConversionOptions();
  const previews = await Promise.all(
    readyBeatmaps.map(async (beatmap) => {
      try {
        const result = convertOsuBeatmapDetailed(await beatmap.file.text(), options);
        return [beatmap.id, createPreview(result)] as const;
      } catch {
        return [beatmap.id, undefined] as const;
      }
    }),
  );
  if (generation !== previewGeneration || isConverting.value) {
    return;
  }
  const previewById = new Map(previews);
  queue.value = queue.value.map((beatmap) =>
    beatmap.status === "ready" ? { ...beatmap, preview: previewById.get(beatmap.id) } : beatmap,
  );
  // Keep the user's active file when its refreshed preview is still valid; otherwise use the first valid item.
  const currentSelectedId = selectedPreviewId.value;
  selectedPreviewId.value =
    currentSelectedId !== undefined && previewById.get(currentSelectedId) !== undefined
      ? currentSelectedId
      : previews.find(([, preview]) => preview !== undefined)?.[0];
}

/** Keep explicit conversion and live preview on the same options snapshot. */
function createConversionOptions(): ConversionOptions {
  return {
    keys: keys.value,
    removeSv: removeSv.value,
    mania2k: {
      mainKey: mainKey.value,
      trillStartKey: trillStartKey.value,
      minimumJackTimeInterval: minimumJackTimeInterval.value,
      maximumNumberOfJackNotes: maximumNumberOfJackNotes.value,
    },
  };
}

/** Convert every queued file locally, keeping per-file failures visible instead of aborting the batch. */
async function convertBeatmaps() {
  if (!canConvert.value) {
    return;
  }
  previewGeneration += 1;
  const selectedId = selectedPreviewId.value;
  clearConversionResults(false, false);
  isConverting.value = true;
  errorMessage.value = "";
  const options = createConversionOptions();
  const converted = await Promise.all(queue.value.map((beatmap) => convertBeatmap(beatmap, options)));
  queue.value = converted;
  selectedPreviewId.value =
    converted.find((beatmap) => beatmap.id === selectedId && beatmap.status === "completed")?.id ??
    converted.find((beatmap) => beatmap.status === "completed")?.id;
  isConverting.value = false;
}

/** Read and convert one local file, returning a complete success or failure state for its row. */
async function convertBeatmap(beatmap: QueuedBeatmap, options: ConversionOptions): Promise<QueuedBeatmap> {
  try {
    const result = convertOsuBeatmapDetailed(await beatmap.file.text(), options);
    return {
      id: beatmap.id,
      file: beatmap.file,
      result,
      preview: createPreview(result),
      status: "completed",
    } satisfies CompletedBeatmap;
  } catch (error) {
    return {
      id: beatmap.id,
      file: beatmap.file,
      errorMessage: error instanceof Error ? error.message : String(error),
      status: "failed",
    } satisfies FailedBeatmap;
  }
}

/** Parse generated timing and hit-object rows into the data shared by the local viewport and full-map navigator. */
function createPreview(result: ConversionResult): BeatmapPreview {
  const lines = result.content.replace(/\r\n?/g, "\n").split("\n");
  const timingPoints = readPreviewTimingPoints(lines);
  const notes = readPreviewNotes(lines, result.outputKeys);
  const redTimingPoints = timingPoints.filter((timingPoint) => timingPoint.isRedLine);
  let rangeStart = notes[0]?.startTime ?? timingPoints[0]?.offset ?? 0;
  let rangeEnd = rangeStart;
  for (const timingPoint of timingPoints) {
    rangeStart = Math.min(rangeStart, timingPoint.offset);
    rangeEnd = Math.max(rangeEnd, timingPoint.offset);
  }
  for (const note of notes) {
    rangeStart = Math.min(rangeStart, note.startTime);
    rangeEnd = Math.max(rangeEnd, note.endTime);
  }
  // A grid needs a red-line origin, but output timing markers must remain a literal view of the generated file.
  const gridTimingPoints =
    redTimingPoints.length === 0 || redTimingPoints[0].offset > rangeStart
      ? [{ offset: rangeStart, beatLength: 500, beatsPerMeasure: 4, isRedLine: true }, ...redTimingPoints]
      : redTimingPoints;
  const activeTimingPoint =
    gridTimingPoints.findLast((timingPoint) => timingPoint.offset <= rangeStart) ?? gridTimingPoints[0];
  const measureLength = activeTimingPoint.beatLength * activeTimingPoint.beatsPerMeasure;
  const windowStart =
    activeTimingPoint.offset + Math.floor((rangeStart - activeTimingPoint.offset) / measureLength) * measureLength;
  const windowDuration = getPreviewWindowEnd(gridTimingPoints, windowStart) - windowStart;
  rangeStart = Math.min(rangeStart, windowStart);
  rangeEnd = Math.max(rangeEnd, windowStart + windowDuration);
  return {
    outputKeys: result.outputKeys,
    objectCount: result.objectCount,
    notes,
    timingPoints,
    gridTimingPoints,
    rangeStart,
    rangeEnd,
    windowStart,
    windowDuration,
  };
}

/** Count four complete measures, restarting the current measure whenever a red line resets the grid. */
function getPreviewWindowEnd(timingPoints: readonly PreviewTimingPoint[], windowStart: number): number {
  let isMeasureComplete = false;
  let measuresRemaining = PREVIEW_MEASURE_COUNT;
  let currentTime = windowStart;
  let timingPointIndex = timingPoints.findLastIndex((timingPoint) => timingPoint.offset <= windowStart);
  if (timingPointIndex < 0) {
    timingPointIndex = 0;
  }
  while (!isMeasureComplete) {
    const timingPoint = timingPoints[timingPointIndex];
    const measureEnd = currentTime + timingPoint.beatLength * timingPoint.beatsPerMeasure;
    const nextTimingPoint = timingPoints[timingPointIndex + 1];
    if (nextTimingPoint && nextTimingPoint.offset < measureEnd) {
      currentTime = nextTimingPoint.offset;
      timingPointIndex += 1;
      continue;
    }
    currentTime = measureEnd;
    measuresRemaining -= 1;
    isMeasureComplete = measuresRemaining === 0;
  }
  return currentTime;
}

/** Read only valid red BPM lines and green SV lines that actually exist in the generated output. */
function readPreviewTimingPoints(lines: readonly string[]): PreviewTimingPoint[] {
  const start = lines.findIndex((line) => line.trim() === "[TimingPoints]");
  if (start < 0) {
    return [];
  }
  const timingPoints: PreviewTimingPoint[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("[")) {
      break;
    }
    const fields = line.split(",");
    const timingOffset = Number(fields[0]);
    const beatLength = Number(fields[1]);
    const beatsPerMeasure = Math.trunc(Number(fields[2]));
    const isRedLine = fields.at(-2) === "1";
    if (!Number.isFinite(timingOffset) || !Number.isFinite(beatLength)) {
      continue;
    }
    if (isRedLine && (!Number.isFinite(beatsPerMeasure) || beatsPerMeasure <= 0 || beatLength <= 0)) {
      continue;
    }
    timingPoints.push({
      offset: timingOffset,
      beatLength,
      beatsPerMeasure: isRedLine ? beatsPerMeasure : 0,
      isRedLine,
    });
  }
  return timingPoints.sort((left, right) => left.offset - right.offset);
}

/** Draw beat lines segment-by-segment so BPM and meter changes stay accurate in the visible window. */
function createPreviewBeatLines(
  timingPoints: readonly PreviewTimingPoint[],
  windowStart: number,
  windowEnd: number,
): PreviewBeatLine[] {
  const beatLines: PreviewBeatLine[] = [];
  for (let index = 0; index < timingPoints.length; index += 1) {
    const timingPoint = timingPoints[index];
    const nextTimingPoint = timingPoints[index + 1];
    const segmentEnd = Math.min(nextTimingPoint?.offset ?? windowEnd, windowEnd);
    const isFinalSegment = nextTimingPoint === undefined || nextTimingPoint.offset > windowEnd;
    if (segmentEnd < windowStart || timingPoint.offset > windowEnd) {
      continue;
    }
    const firstBeat = Math.max(0, Math.ceil((windowStart - timingPoint.offset) / timingPoint.beatLength));
    for (let beat = firstBeat; ; beat += 1) {
      const time = timingPoint.offset + beat * timingPoint.beatLength;
      if (time > segmentEnd || (!isFinalSegment && time === segmentEnd)) {
        break;
      }
      beatLines.push({ time, isMeasure: beat % timingPoint.beatsPerMeasure === 0 });
    }
  }
  return beatLines;
}

/** Find the start of the current measure using the red timing point that owns the visible window. */
function getPreviewMeasureStart(timingPoints: readonly PreviewTimingPoint[], time: number): number {
  const timingPoint = timingPoints.findLast((item) => item.offset <= time) ?? timingPoints[0];
  const measureLength = timingPoint.beatLength * timingPoint.beatsPerMeasure;
  return timingPoint.offset + Math.floor((time - timingPoint.offset) / measureLength) * measureLength;
}

/** Reconstruct lane, timing, and hold length from serializer-owned Mania hit-object rows. */
function readPreviewNotes(lines: readonly string[], outputKeys: number): PreviewNote[] {
  const start = lines.findIndex((line) => line.trim() === "[HitObjects]");
  if (start < 0) {
    return [];
  }
  const notes: PreviewNote[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line) {
      continue;
    }
    const fields = line.split(",");
    const x = Number(fields[0]);
    const startTime = Number(fields[2]);
    const type = Number(fields[3]);
    const isHold = Boolean(type & 128);
    const endTime = isHold ? Number(fields[5]?.split(":", 1)[0]) : startTime;
    if (!Number.isFinite(x) || !Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      continue;
    }
    notes.push({
      lane: Math.floor((x * outputKeys) / 512) + 1,
      startTime,
      endTime: Math.max(startTime, endTime),
      isHold,
    });
  }
  return notes.sort((left, right) => left.startTime - right.startTime || left.lane - right.lane);
}

/** Position a note inside the movable time viewport while clipping holds to its visible range. */
function getPreviewNoteStyle(note: PreviewNote): CSSProperties {
  const preview = currentPreview.value;
  if (!preview) {
    return {};
  }
  const windowLength = currentPreviewWindowEnd.value - currentPreviewWindowStart.value;
  const laneWidth = 100 / preview.outputKeys;
  const visibleStart = Math.max(note.startTime, currentPreviewWindowStart.value);
  const visibleEnd = Math.min(note.endTime, currentPreviewWindowEnd.value);
  const verticalPercent = ((visibleStart - currentPreviewWindowStart.value) / windowLength) * 100;
  const duration = note.isHold ? Math.max(visibleEnd - visibleStart, 0) : 0;
  const height = note.isHold ? Math.max((duration / windowLength) * 100, 1.2) : 1.5;
  return {
    height: `${height}%`,
    left: `calc(${(note.lane - 1) * laneWidth}% + 2px)`,
    ...getPreviewVerticalPositionStyle(verticalPercent),
    width: `calc(${laneWidth}% - 4px)`,
  };
}

/** Position preview elements from the start edge so holds always extend toward later timestamps. */
function getPreviewVerticalPositionStyle(percent: number): Pick<CSSProperties, "bottom" | "top"> {
  if (isPreviewVerticallyFlipped.value) {
    return { top: `${percent}%` };
  }
  return { bottom: `${percent}%` };
}

/** Position a beat or timing line in the movable time viewport. */
function getPreviewLineStyle(time: number): CSSProperties {
  const preview = currentPreview.value;
  if (!preview) {
    return {};
  }
  return getPreviewVerticalPositionStyle(
    ((time - currentPreviewWindowStart.value) / (currentPreviewWindowEnd.value - currentPreviewWindowStart.value)) *
      100,
  );
}

/** Position timing markers and pass the movable viewport's full-range proportions to CSS. */
function getPreviewNavigatorStyle(time: number, duration = 0): CSSProperties | PreviewNavigatorWindowStyle {
  const preview = currentPreview.value;
  if (!preview) {
    return {};
  }
  const rangeDuration = preview.rangeEnd - preview.rangeStart;
  const leftPercent = ((time - preview.rangeStart) / rangeDuration) * 100;
  if (duration === 0) {
    return { left: `${leftPercent}%` };
  }
  const widthPercent = (duration / rangeDuration) * 100;
  return {
    "--mania-converter-navigator-window-left": `${leftPercent}%`,
    "--mania-converter-navigator-window-width": `${widthPercent}%`,
  };
}

/** Keep a requested navigator offset inside the part of the full range that can contain the viewport. */
function setPreviewWindowStart(time: number) {
  const preview = currentPreview.value;
  if (!preview) {
    return;
  }
  previewWindowStart.value = Math.min(Math.max(time, preview.rangeStart), preview.rangeEnd - preview.windowDuration);
}

/** Read a clamped pointer position in navigator pixels for the press and subsequent drag events. */
function getPreviewNavigatorPointerPosition(event: PointerEvent): { x: number; width: number } | undefined {
  const navigator = event.currentTarget;
  if (!(navigator instanceof HTMLElement)) {
    return undefined;
  }
  const bounds = navigator.getBoundingClientRect();
  if (bounds.width <= 0) {
    return undefined;
  }
  return { x: Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width), width: bounds.width };
}

/** Match the navigator thumb's CSS minimum width and clamped edge position in pointer pixels. */
function getPreviewNavigatorWindowMetrics(preview: BeatmapPreview, width: number) {
  const rangeDuration = preview.rangeEnd - preview.rangeStart;
  const actualWidth = (preview.windowDuration / rangeDuration) * width;
  const windowWidth = Math.min(Math.max(actualWidth, PREVIEW_NAVIGATOR_MIN_WINDOW_WIDTH), width);
  const actualLeft = ((currentPreviewWindowStart.value - preview.rangeStart) / rangeDuration) * width;
  const windowLeft = Math.min(Math.max(actualLeft, 0), width - windowWidth);
  return { windowLeft, windowWidth };
}

/** Convert the visible thumb position using the same raw full-range proportion as the CSS left edge. */
function getPreviewNavigatorTimeFromLeft(preview: BeatmapPreview, left: number, width: number, windowWidth: number) {
  const maxWindowLeft = Math.max(width - windowWidth, 0);
  if (maxWindowLeft === 0) {
    // A thumb that fills the track has no visual travel, so pointer movement cannot change its time.
    return currentPreviewWindowStart.value;
  }
  if (left >= maxWindowLeft) {
    return preview.rangeEnd - preview.windowDuration;
  }
  return preview.rangeStart + (left / width) * (preview.rangeEnd - preview.rangeStart);
}

/** Start a viewport drag, or center the viewport when the user clicks an uncovered navigator region. */
function startPreviewNavigatorDrag(event: PointerEvent) {
  if (isConverting.value) {
    return;
  }
  const position = getPreviewNavigatorPointerPosition(event);
  const preview = currentPreview.value;
  const navigator = event.currentTarget;
  if (
    activePreviewNavigatorPointerId !== undefined ||
    position === undefined ||
    !preview ||
    !(navigator instanceof HTMLElement)
  ) {
    return;
  }
  let { windowLeft, windowWidth } = getPreviewNavigatorWindowMetrics(preview, position.width);
  const isViewportHit = position.x >= windowLeft && position.x <= windowLeft + windowWidth;
  if (!isViewportHit) {
    const targetLeft = Math.min(Math.max(position.x - windowWidth / 2, 0), position.width - windowWidth);
    setPreviewWindowStart(getPreviewNavigatorTimeFromLeft(preview, targetLeft, position.width, windowWidth));
    windowLeft = getPreviewNavigatorWindowMetrics(preview, position.width).windowLeft;
  }
  previewNavigatorPointerStart = position.x;
  previewNavigatorWindowLeft = windowLeft;
  activePreviewNavigatorPointerId = event.pointerId;
  if (navigator.setPointerCapture) {
    navigator.setPointerCapture(event.pointerId);
  }
}

/** Move the viewport while its navigator bar owns the active pointer. */
function movePreviewNavigatorDrag(event: PointerEvent) {
  if (isConverting.value || event.pointerId !== activePreviewNavigatorPointerId) {
    return;
  }
  const position = getPreviewNavigatorPointerPosition(event);
  const preview = currentPreview.value;
  if (position !== undefined && preview) {
    const { windowWidth } = getPreviewNavigatorWindowMetrics(preview, position.width);
    const maxWindowLeft = Math.max(position.width - windowWidth, 0);
    const visibleLeft = Math.min(
      Math.max(previewNavigatorWindowLeft + position.x - previewNavigatorPointerStart, 0),
      maxWindowLeft,
    );
    setPreviewWindowStart(getPreviewNavigatorTimeFromLeft(preview, visibleLeft, position.width, windowWidth));
  }
}

/** Release pointer ownership after a completed or cancelled navigator drag. */
function stopPreviewNavigatorDrag(event: PointerEvent) {
  if (event.pointerId !== activePreviewNavigatorPointerId) {
    return;
  }
  activePreviewNavigatorPointerId = undefined;
  previewNavigatorPointerStart = 0;
  previewNavigatorWindowLeft = 0;
  const navigator = event.currentTarget;
  if (navigator instanceof HTMLElement && navigator.hasPointerCapture(event.pointerId)) {
    navigator.releasePointerCapture(event.pointerId);
  }
}

/** Support the native slider keys without exposing timestamps as visible preview metadata. */
function movePreviewWindowWithKeyboard(event: KeyboardEvent) {
  const preview = currentPreview.value;
  if (isConverting.value || !preview) {
    return;
  }
  if (event.key === "Home") {
    event.preventDefault();
    setPreviewWindowStart(preview.rangeStart);
    return;
  }
  if (event.key === "End") {
    event.preventDefault();
    setPreviewWindowStart(preview.rangeEnd - preview.windowDuration);
    return;
  }
  const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
  if (direction === 0) {
    return;
  }
  event.preventDefault();
  setPreviewWindowStart(currentPreviewWindowStart.value + direction * Math.max(100, preview.windowDuration / 8));
}

/** Convert the selected batch result to a local Blob download and release the URL after browser use. */
function downloadBeatmap(beatmap: CompletedBeatmap) {
  const name = beatmap.file.name.replace(/\.osu$/iu, "") || "beatmap";
  const file = new Blob([beatmap.result.content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}(${beatmap.result.outputKeys}k_remove_sv_${removeSv.value}).osu`;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Firefox and Safari can begin consuming the Blob URL after click returns.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Trigger one browser download per completed row; no archive dependency is needed for local output. */
function downloadAllBeatmaps() {
  for (const beatmap of completedBeatmaps.value) {
    downloadBeatmap(beatmap);
  }
}

/** Download the currently inspected result only after explicit conversion has completed. */
function downloadSelectedPreview() {
  const beatmap = selectedPreview.value;
  if (!isConverting.value && beatmap?.status === "completed") {
    downloadBeatmap(beatmap);
  }
}

/** Format a beatmap timestamp precisely enough to match the underlying millisecond timing grid. */
function formatPreviewTimestamp(milliseconds: number): string {
  const isBeforeZero = milliseconds < 0;
  const absoluteMilliseconds = Math.round(Math.abs(milliseconds));
  const minutes = Math.floor(absoluteMilliseconds / 60_000);
  const seconds = Math.floor((absoluteMilliseconds % 60_000) / 1000);
  const remainder = absoluteMilliseconds % 1000;
  return `${isBeforeZero ? "-" : ""}${minutes}:${String(seconds).padStart(2, "0")}.${String(remainder).padStart(3, "0")}`;
}

/** Format file sizes without relying on a locale-specific browser API. */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(bytes < 1024 * 1024 ? 0 : 1)} ${bytes < 1024 * 1024 ? "KB" : "MB"}`;
}
</script>

<template>
  <div
    class="mania-converter"
    :aria-busy="isConverting"
  >
    <section
      class="mania-converter__panel mania-converter__source-panel"
      aria-labelledby="mania-converter-files-title"
    >
      <div class="mania-converter__panel-heading">
        <h2 id="mania-converter-files-title">
          {{ text.fileQueue }}
        </h2>
        <span role="status">{{ queue.length }} {{ text.filesQueued }}</span>
      </div>
      <input
        id="mania-converter-file-input"
        ref="fileInput"
        accept=".osu"
        class="mania-converter__file-input"
        multiple
        type="file"
        :disabled="isConverting"
        @change="addSelectedFiles"
      >
      <label
        class="mania-converter__drop-zone"
        :class="{ 'mania-converter__drop-zone--active': isDropTarget }"
        :aria-disabled="isConverting"
        for="mania-converter-file-input"
        @dragenter.prevent="isDropTarget = true"
        @dragleave="leaveDropZone"
        @dragover.prevent="isDropTarget = true"
        @drop.prevent="addDroppedFiles"
      >
        <Upload
          :size="24"
          aria-hidden="true"
        />
        <span>{{ text.dropFiles }}</span>
        <span class="mania-converter__drop-zone-action">{{ text.addFiles }}</span>
      </label>
      <ol
        v-if="queue.length > 0"
        class="mania-converter__queue"
      >
        <li
          v-for="beatmap in queue"
          :key="beatmap.id"
          class="mania-converter__queue-row"
        >
          <div class="mania-converter__queue-file">
            <strong :title="beatmap.file.name">{{ beatmap.file.name }}</strong>
            <span>{{ formatFileSize(beatmap.file.size) }}</span>
          </div>
          <span
            v-if="beatmap.status === 'completed'"
            class="mania-converter__queue-status mania-converter__queue-status--success"
          >
            {{ text.converted }} · {{ beatmap.result.objectCount }}
          </span>
          <span
            v-else-if="beatmap.status === 'failed'"
            class="mania-converter__queue-status mania-converter__queue-status--error"
            :title="beatmap.errorMessage"
          >
            {{ text.failed }} · {{ beatmap.errorMessage }}
          </span>
          <button
            type="button"
            class="mania-converter__icon-button"
            :aria-label="text.removeFile"
            :disabled="isConverting"
            :title="text.removeFile"
            @click="removeBeatmap(beatmap.id)"
          >
            <X
              :size="17"
              aria-hidden="true"
            />
          </button>
        </li>
      </ol>
      <button
        v-if="queue.length > 0"
        type="button"
        class="mania-converter__add-button"
        :disabled="isConverting"
        :title="text.addMoreFiles"
        @click="openFilePicker"
      >
        <Plus
          :size="17"
          aria-hidden="true"
        />
        <span>{{ text.addMoreFiles }}</span>
      </button>
    </section>

    <section
      class="mania-converter__panel mania-converter__settings-panel"
      aria-labelledby="mania-converter-settings-title"
    >
      <div class="mania-converter__panel-heading">
        <h2 id="mania-converter-settings-title">
          {{ text.conversionSettings }}
        </h2>
      </div>
      <fieldset :disabled="isConverting">
        <div class="mania-converter__settings-row mania-converter__settings-row--two-columns">
          <label class="mania-converter__setting">
            <span>{{ text.targetKeys }}</span>
            <select v-model.number="keys">
              <option :value="1">1K</option>
              <option :value="2">2K</option>
              <option :value="4">4K</option>
            </select>
          </label>
          <label class="mania-converter__setting">
            <span>{{ text.removeSv }}</span>
            <select v-model="removeSv">
              <option value="none">{{ text.svKeepAll }}</option>
              <option value="all">{{ text.svRemoveAll }}</option>
              <option value="inherited_timing_points">{{ text.svRemoveInherited }}</option>
            </select>
          </label>
        </div>

        <div class="mania-converter__settings-row mania-converter__settings-row--two-columns">
          <label class="mania-converter__setting">
            <span>{{ text.mainKey }}</span>
            <select
              v-model.number="mainKey"
              :disabled="keys === 1"
            >
              <option :value="1">{{ text.laneOne }}</option>
              <option :value="2">{{ text.laneTwo }}</option>
            </select>
          </label>
          <label class="mania-converter__setting">
            <span>{{ text.trillStartKey }}</span>
            <select
              v-model.number="trillStartKey"
              :disabled="keys === 1"
            >
              <option :value="1">{{ text.laneOne }}</option>
              <option :value="2">{{ text.laneTwo }}</option>
            </select>
          </label>
        </div>

        <div class="mania-converter__strategy-row">
          <div class="mania-converter__setting-label">
            <span>{{ text.preset }}</span>
          </div>
          <div
            id="mania-converter-preset"
            class="mania-converter__segmented-control"
            :class="`mania-converter__segmented-control--${selectedPreset}`"
            role="group"
            :aria-label="text.preset"
          >
            <button
              v-for="presetId in MANIA_2K_PRESET_IDS"
              :key="presetId"
              type="button"
              class="mania-converter__segmented-button"
              :aria-pressed="selectedPreset === presetId"
              :class="{ 'mania-converter__segmented-button--active': selectedPreset === presetId }"
              :disabled="keys === 1"
              @click="applyPreset(presetId)"
            >
              {{ getPresetLabel(presetId) }}
            </button>
          </div>
        </div>

        <div class="mania-converter__settings-row mania-converter__settings-row--two-columns">
          <label class="mania-converter__setting">
            <span>{{ text.minimumJackInterval }}</span>
            <input
              v-model.number="minimumJackTimeInterval"
              min="0"
              step="1"
              type="number"
              :disabled="keys === 1"
            >
          </label>
          <label class="mania-converter__setting">
            <span>{{ text.maximumJackNotes }}</span>
            <input
              v-model.number="maximumNumberOfJackNotes"
              min="0"
              step="1"
              type="number"
              :disabled="keys === 1"
            >
          </label>
        </div>
      </fieldset>
    </section>

    <section class="mania-converter__actions">
      <button
        type="button"
        class="mania-converter__primary-button"
        :disabled="!canConvert"
        @click="convertBeatmaps"
      >
        <Play
          :size="17"
          aria-hidden="true"
        />
        <span>{{ text.startConversion }}</span>
      </button>
      <button
        class="mania-converter__download-all-button"
        type="button"
        :disabled="!hasCompletedBeatmaps || isConverting"
        :title="text.downloadAll"
        @click="downloadAllBeatmaps"
      >
        <Download
          :size="17"
          aria-hidden="true"
        />
        <span>{{ text.downloadAll }}</span>
      </button>
    </section>
    <p
      v-if="errorMessage"
      class="mania-converter__error"
      role="alert"
    >
      {{ errorMessage }}
    </p>

    <section
      class="mania-converter__panel mania-converter__preview-panel"
      aria-labelledby="mania-converter-preview-title"
    >
      <div class="mania-converter__panel-heading graphwar-killer__label-row">
        <div class="graphwar-killer__label-leading">
          <h2 id="mania-converter-preview-title">
            {{ text.preview }}
          </h2>
          <ToggleField
            id="mania-converter-vertical-flip"
            class="graphwar-killer__source-toggle"
            :checked="isPreviewVerticallyFlipped"
            :label="text.verticallyFlipPlayfield"
            :state="isConverting ? 'busy' : 'normal'"
            :title="text.verticallyFlipPlayfield"
            @toggle="isPreviewVerticallyFlipped = !isPreviewVerticallyFlipped"
          />
        </div>
        <select
          v-if="previewBeatmaps.length > 1"
          v-model="selectedPreviewId"
          :aria-label="text.viewFile"
          :disabled="isConverting"
        >
          <option
            v-for="beatmap in previewBeatmaps"
            :key="beatmap.id"
            :value="beatmap.id"
          >
            {{ beatmap.file.name }}
          </option>
        </select>
      </div>
      <template v-if="selectedPreview && currentPreview">
        <dl class="mania-converter__stats">
          <div>
            <dt>{{ text.bpm }}</dt>
            <dd>{{ previewBpm }}</dd>
          </div>
          <div>
            <dt>{{ text.objectCount }}</dt>
            <dd>{{ previewObjectCount }}</dd>
          </div>
          <div>
            <dt>{{ text.taps }} / {{ text.holds }}</dt>
            <dd>{{ previewTapCount }} / {{ previewHoldCount }}</dd>
          </div>
        </dl>
        <div
          class="mania-converter__preview-content"
          :class="{ 'mania-converter__preview-content--flipped': isPreviewVerticallyFlipped }"
        >
          <div class="mania-converter__preview-navigation">
            <output
              class="mania-converter__preview-navigation-time"
              :aria-label="text.measureStart"
            >
              {{ previewMeasureStartLabel }}
            </output>
            <div
              class="mania-converter__preview-navigator"
              role="slider"
              :aria-disabled="isConverting"
              :aria-label="text.viewRange"
              :aria-valuemin="currentPreview.rangeStart"
              :aria-valuemax="currentPreview.rangeEnd - currentPreview.windowDuration"
              :aria-valuenow="currentPreviewWindowStart"
              :class="{ 'mania-converter__preview-navigator--disabled': isConverting }"
              :tabindex="isConverting ? -1 : 0"
              @keydown="movePreviewWindowWithKeyboard"
              @pointercancel="stopPreviewNavigatorDrag"
              @pointerdown="startPreviewNavigatorDrag"
              @pointermove="movePreviewNavigatorDrag"
              @pointerup="stopPreviewNavigatorDrag"
            >
              <span
                v-for="(timingPoint, index) in currentPreview.timingPoints"
                :key="`navigator-timing-${timingPoint.offset}-${index}`"
                class="mania-converter__navigator-timing-line"
                :class="{
                  'mania-converter__navigator-timing-line--red': timingPoint.isRedLine,
                  'mania-converter__navigator-timing-line--green': !timingPoint.isRedLine,
                }"
                :style="getPreviewNavigatorStyle(timingPoint.offset)"
              />
              <span
                class="mania-converter__navigator-window"
                :style="getPreviewNavigatorStyle(currentPreviewWindowStart, currentPreview.windowDuration)"
              />
            </div>
            <button
              class="mania-converter__preview-navigation-download"
              type="button"
              :disabled="selectedPreview.status !== 'completed' || isConverting"
              :title="text.download"
              @click="downloadSelectedPreview"
            >
              <Download
                :size="17"
                aria-hidden="true"
              />
              <span>{{ text.download }}</span>
            </button>
          </div>
          <div
            class="mania-converter__preview"
            :class="{ 'mania-converter__preview--vertically-flipped': isPreviewVerticallyFlipped }"
            :aria-label="text.previewNotes"
            role="img"
          >
            <span
              v-for="lane in currentPreview.outputKeys"
              :key="`lane-${lane}`"
              class="mania-converter__lane"
              :style="{
                left: `${((lane - 1) / currentPreview.outputKeys) * 100}%`,
                width: `${100 / currentPreview.outputKeys}%`,
              }"
            >
              <span>{{ lane }}</span>
            </span>
            <span
              v-for="beatLine in visiblePreviewBeatLines"
              :key="`beat-${beatLine.time}`"
              class="mania-converter__beat-line"
              :class="{ 'mania-converter__beat-line--measure': beatLine.isMeasure }"
              :style="getPreviewLineStyle(beatLine.time)"
            />
            <span
              v-for="(timingPoint, index) in visiblePreviewTimingPoints"
              :key="`timing-${timingPoint.offset}-${index}`"
              class="mania-converter__timing-line"
              :class="{
                'mania-converter__timing-line--red': timingPoint.isRedLine,
                'mania-converter__timing-line--green': !timingPoint.isRedLine,
              }"
              :style="getPreviewLineStyle(timingPoint.offset)"
            />
            <span
              v-for="(note, index) in visiblePreviewNotes"
              :key="`${note.lane}-${note.startTime}-${index}`"
              class="mania-converter__note"
              :class="{
                'mania-converter__note--hold': note.isHold,
              }"
              :style="getPreviewNoteStyle(note)"
            />
          </div>
        </div>
      </template>
      <p
        v-else
        class="mania-converter__empty-preview"
      >
        {{ text.noPreview }}
      </p>
    </section>
  </div>
</template>

<style scoped>
.mania-converter {
  display: grid;
  gap: 12px;
  margin: 20px 0;
  min-width: 0;
}

.mania-converter__panel {
  align-content: start;
  background: var(--vp-c-bg);
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 88%, transparent);
  border-radius: 8px;
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 12px;
}

.mania-converter__panel-heading,
.mania-converter__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: space-between;
  min-width: 0;
}

.mania-converter__panel-heading h2 {
  border: 0;
  font-size: 1rem;
  margin: 0;
  padding: 0;
}

.mania-converter__panel-heading > span {
  color: color-mix(in srgb, var(--vp-c-text-1) 68%, var(--vp-c-text-2) 32%);
  font-size: 0.88rem;
  line-height: 1.4;
}

.mania-converter__preview-panel .graphwar-killer__label-row {
  align-items: center;
  display: grid;
  gap: 8px;
  grid-template-columns: max-content minmax(0, 1fr);
  min-width: 0;
}

.mania-converter__preview-panel .graphwar-killer__label-leading {
  align-items: center;
  display: flex;
  gap: 8px;
  min-width: 0;
}

.mania-converter__file-input {
  clip-path: inset(50%);
  height: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}

.mania-converter__drop-zone {
  background: color-mix(in srgb, var(--vp-c-bg-soft) 70%, var(--vp-c-bg));
  border: 1px dashed color-mix(in srgb, var(--vp-c-divider) 72%, var(--vp-c-text-2));
  border-radius: 8px;
  color: var(--vp-c-text-1);
  cursor: pointer;
  display: grid;
  gap: 6px;
  min-height: 154px;
  padding: 18px;
  place-items: center center;
  text-align: center;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.mania-converter__drop-zone:hover,
.mania-converter__drop-zone--active {
  background: color-mix(in srgb, var(--vp-c-brand-soft) 54%, var(--vp-c-bg));
  border-color: var(--vp-c-brand-1);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--vp-c-brand-1) 30%, transparent);
}

.mania-converter__drop-zone[aria-disabled="true"] {
  cursor: not-allowed;
  opacity: 58%;
}

.mania-converter__drop-zone-action {
  color: var(--vp-c-brand-1);
  font-size: 0.9rem;
  font-weight: 700;
}

.mania-converter__queue {
  display: grid;
  gap: 6px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.mania-converter__queue-row {
  align-items: center;
  background: color-mix(in srgb, var(--vp-c-bg-soft) 48%, var(--vp-c-bg));
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 76%, transparent);
  border-radius: 8px;
  display: grid;
  gap: 8px;
  grid-template-columns: minmax(0, 1fr) minmax(90px, auto) 34px;
  min-width: 0;
  padding: 7px 8px;
}

.mania-converter__queue-file {
  display: grid;
  min-width: 0;
}

.mania-converter__queue-file strong,
.mania-converter__queue-status {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mania-converter__queue-file strong {
  font-size: 0.9rem;
}

.mania-converter__queue-file span,
.mania-converter__queue-status {
  color: var(--vp-c-text-2);
  font-size: 0.82rem;
}

.mania-converter__queue-status--success {
  color: #15803d;
  font-weight: 700;
}

.mania-converter__queue-status--error {
  color: var(--vp-c-danger-1);
  font-weight: 700;
}

.mania-converter__settings-panel fieldset {
  border: 0;
  display: grid;
  gap: 8px;
  margin: 0;
  min-inline-size: 0;
  padding: 0;
}

.mania-converter__settings-row {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.mania-converter__settings-row--two-columns {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.mania-converter__setting {
  display: grid;
  font-size: 0.9rem;
  font-weight: 600;
  gap: 4px;
  min-width: 0;
}

.mania-converter__strategy-row {
  align-items: center;
  display: grid;
  gap: 8px;
  grid-template-columns: minmax(120px, 1fr) minmax(0, 2fr);
  min-width: 0;
}

.mania-converter__setting-label {
  align-items: baseline;
  display: flex;
  font-size: 0.9rem;
  font-weight: 600;
  gap: 6px;
  min-width: 0;
}

.mania-converter__segmented-control {
  --mania-converter-segment-count: 4;
  background: color-mix(in srgb, var(--vp-c-bg-soft) 68%, var(--vp-c-bg));
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  display: grid;
  gap: 0;
  grid-template-columns: repeat(var(--mania-converter-segment-count), minmax(0, 1fr));
  min-height: 34px;
  min-width: 0;
  overflow: hidden;
  padding: 2px;
  position: relative;
}

.mania-converter__segmented-control::before {
  background: var(--vp-c-brand-1);
  border-radius: 999px;
  bottom: 2px;
  box-shadow: 0 6px 14px rgb(15 23 42 / 12%);
  content: "";
  left: 2px;
  position: absolute;
  top: 2px;
  transition: transform 0.2s ease;
  width: calc((100% - 4px) / var(--mania-converter-segment-count));
}

.mania-converter__segmented-control--single_lane::before {
  transform: translateX(100%);
}

.mania-converter__segmented-control--forced_trill::before {
  transform: translateX(200%);
}

.mania-converter__segmented-control--custom::before {
  transform: translateX(300%);
}

.mania-converter__segmented-button {
  background: transparent;
  border: 0;
  border-radius: 999px;
  box-shadow: none;
  color: color-mix(in srgb, var(--vp-c-text-1) 64%, var(--vp-c-text-2) 36%);
  cursor: pointer;
  font-family: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  line-height: 1.15;
  min-height: 28px;
  min-width: 0;
  overflow-wrap: anywhere;
  padding: 4px 10px;
  position: relative;
  text-align: center;
  transform: none;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
  white-space: normal;
  z-index: 1;
}

.mania-converter__segmented-button:disabled {
  cursor: not-allowed;
  opacity: 58%;
}

.mania-converter__segmented-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--vp-c-brand-1) 8%, transparent);
  box-shadow: none;
  color: var(--vp-c-text-1);
  transform: none;
}

.mania-converter__segmented-control .mania-converter__segmented-button--active {
  color: var(--vp-c-white);
}

.mania-converter__segmented-control .mania-converter__segmented-button--active:hover:not(:disabled) {
  background: rgb(255 255 255 / 12%);
  color: var(--vp-c-white);
}

.mania-converter__segmented-button:focus-visible {
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--vp-c-brand-1) 56%, var(--vp-c-bg));
  outline: none;
}

.mania-converter select,
.mania-converter input:where([type="number"]) {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  box-sizing: border-box;
  color: var(--vp-c-text-1);
  font: inherit;
  font-variant-numeric: tabular-nums;
  height: 32px;
  min-width: 0;
  padding: 4px 8px;
  width: 100%;
}

/* The shared ToggleField owns its switch geometry and interaction states. */
.mania-converter button:where(:not(.mania-converter__segmented-button, .graphwar-killer-toggle-field__control)) {
  align-items: center;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  box-sizing: border-box;
  color: var(--vp-c-text-1);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  gap: 6px;
  justify-content: center;
  line-height: 1.2;
  min-height: 34px;
  padding: 6px 10px;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    color 0.2s ease,
    transform 0.2s ease;
}

.mania-converter
  button:where(:hover:not(:disabled, .mania-converter__segmented-button, .graphwar-killer-toggle-field__control)) {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 8px 20px rgb(15 23 42 / 6%);
  color: var(--vp-c-brand-1);
  transform: translateY(-1px);
}

.mania-converter
  button:where(:disabled:not(.mania-converter__segmented-button, .graphwar-killer-toggle-field__control)),
.mania-converter select:disabled,
.mania-converter input:disabled {
  cursor: not-allowed;
  opacity: 58%;
}

.mania-converter
  button:where(:focus-visible:not(.mania-converter__segmented-button, .graphwar-killer-toggle-field__control)),
.mania-converter select:focus-visible,
.mania-converter input:focus-visible,
.mania-converter__drop-zone:focus-within {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 52%, var(--vp-c-divider));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--vp-c-brand-1) 16%, transparent);
  outline: none;
}

.mania-converter__icon-button {
  flex: 0 0 34px;
  padding: 0;
  width: 34px;
}

.mania-converter__add-button {
  justify-self: start;
}

.mania-converter__actions {
  justify-content: flex-start;
}

.mania-converter__primary-button {
  background: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-white);
}

.mania-converter__primary-button:hover:not(:disabled) {
  background: var(--vp-c-brand-2);
  border-color: var(--vp-c-brand-2);
  color: var(--vp-c-white);
}

.mania-converter__error,
.mania-converter__empty-preview {
  margin: 0;
  overflow-wrap: anywhere;
}

.mania-converter__error {
  color: var(--vp-c-danger-1);
  font-weight: 700;
}

.mania-converter__stats {
  display: grid;
  gap: 6px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
}

.mania-converter__stats > div {
  background: color-mix(in srgb, var(--vp-c-bg-soft) 56%, var(--vp-c-bg));
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 76%, transparent);
  border-radius: 8px;
  min-width: 0;
  padding: 7px 8px;
}

.mania-converter__stats dt {
  color: var(--vp-c-text-2);
  font-size: 0.78rem;
  font-weight: 600;
}

.mania-converter__stats dd {
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  margin: 2px 0 0;
  overflow-wrap: anywhere;
}

.mania-converter__preview {
  background: color-mix(in srgb, var(--vp-c-bg-soft) 62%, var(--vp-c-bg));
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  height: 460px;
  min-width: 0;
  overflow: hidden;
  position: relative;
}

.mania-converter__lane {
  border-right: 1px solid color-mix(in srgb, var(--vp-c-divider) 88%, transparent);
  bottom: 0;
  position: absolute;
  top: 0;
}

.mania-converter__lane > span {
  color: var(--vp-c-text-2);
  font-size: 0.75rem;
  left: 50%;
  position: absolute;
  top: 6px;
  transform: translateX(-50%);
}

.mania-converter__beat-line {
  border-top: 1px solid color-mix(in srgb, var(--vp-c-divider) 70%, transparent);
  left: 0;
  position: absolute;
  right: 0;
  z-index: 1;
}

.mania-converter__beat-line--measure {
  border-top-color: color-mix(in srgb, var(--vp-c-text-2) 58%, var(--vp-c-divider));
}

.mania-converter__timing-line {
  border-top: 2px solid;
  left: 0;
  pointer-events: none;
  position: absolute;
  right: 0;
  z-index: 3;
}

.mania-converter__timing-line--red {
  border-top-color: #ef4444;
}

.mania-converter__timing-line--green {
  border-top-color: #16a34a;
  border-top-style: dashed;
}

.mania-converter__note {
  background: #15803d;
  border: 1px solid rgb(255 255 255 / 62%);
  border-radius: 3px;
  box-sizing: border-box;
  min-height: 5px;
  position: absolute;
  z-index: 4;
}

.mania-converter__note--hold {
  background: #2563eb;
}

.mania-converter__preview-navigation {
  align-items: center;
  display: grid;
  gap: 8px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  min-width: 0;
}

.mania-converter__preview-content {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.mania-converter__preview-content .mania-converter__preview-navigation {
  order: 2;
}

.mania-converter__preview-content--flipped .mania-converter__preview-navigation {
  order: 1;
}

.mania-converter__preview-content--flipped .mania-converter__preview {
  order: 2;
}

.mania-converter__preview-navigation-time {
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  min-width: 5.75rem;
}

.mania-converter__preview-navigator {
  background: linear-gradient(
    to right,
    color-mix(in srgb, var(--vp-c-brand-1) 12%, var(--vp-c-bg-soft)) 0%,
    var(--vp-c-bg-soft) 100%
  );
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  cursor: ew-resize;
  height: 34px;
  min-width: 0;
  overflow: hidden;
  position: relative;
  touch-action: none;
  user-select: none;
}

.mania-converter__preview-navigator--disabled {
  cursor: not-allowed;
  opacity: 58%;
  pointer-events: none;
}

.mania-converter__preview-navigator--disabled .mania-converter__navigator-window {
  cursor: not-allowed;
  pointer-events: none;
}

.mania-converter__preview-navigator:focus-visible {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 52%, var(--vp-c-divider));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--vp-c-brand-1) 16%, transparent);
  outline: none;
}

.mania-converter__navigator-timing-line {
  bottom: 0;
  pointer-events: none;
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  width: 2px;
  z-index: 1;
}

.mania-converter__navigator-timing-line--red {
  background: #ef4444;
}

.mania-converter__navigator-timing-line--green {
  background: repeating-linear-gradient(to bottom, #16a34a 0 5px, transparent 5px 8px);
}

.mania-converter__navigator-window {
  /* Keep the visible minimum width inside both navigator edges. */
  background: color-mix(in srgb, var(--vp-c-brand-1) 24%, var(--vp-c-bg));
  border: 2px solid var(--vp-c-brand-1);
  border-radius: 999px;
  bottom: 3px;
  box-shadow: 0 2px 8px rgb(15 23 42 / 18%);
  box-sizing: border-box;
  cursor: grab;
  left: min(
    var(--mania-converter-navigator-window-left),
    max(0px, calc(100% - max(var(--mania-converter-navigator-window-width), 28px)))
  );
  pointer-events: auto;
  position: absolute;
  top: 3px;
  width: min(max(var(--mania-converter-navigator-window-width), 28px), 100%);
  z-index: 2;
}

.mania-converter__navigator-window:hover {
  background: color-mix(in srgb, var(--vp-c-brand-1) 38%, var(--vp-c-bg));
  box-shadow: 0 3px 10px rgb(15 23 42 / 24%);
}

.mania-converter__navigator-window:active {
  cursor: grabbing;
}

.mania-converter__preview-navigation-download {
  white-space: nowrap;
}

@media (width <= 760px) {
  .mania-converter__preview-panel .graphwar-killer__label-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .mania-converter__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .mania-converter__preview {
    height: 360px;
  }

  .mania-converter__preview-navigation-time {
    min-width: 5.25rem;
  }
}

@media (width <= 520px) {
  .mania-converter__panel-heading {
    align-items: flex-start;
    display: grid;
  }

  .mania-converter__panel-heading select {
    width: 100%;
  }

  .mania-converter__queue-row {
    grid-template-columns: minmax(0, 1fr) 34px;
  }

  .mania-converter__queue-status {
    grid-column: 1;
  }

  .mania-converter__queue-row > .mania-converter__icon-button {
    grid-column: 2;
    grid-row: 1 / span 2;
  }

  .mania-converter__settings-row--two-columns,
  .mania-converter__strategy-row {
    grid-template-columns: 1fr;
  }

  .mania-converter__preview-navigation {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .mania-converter__preview-navigation-time {
    grid-column: 1 / -1;
  }
}
</style>
