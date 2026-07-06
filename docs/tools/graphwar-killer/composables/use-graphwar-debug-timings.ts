import { computed, ref, type ComputedRef } from "vue";

import type {
  GraphwarDetectionWorkerTimingDetail,
  GraphwarDetectionWorkerTimingEntry,
} from "../detection/graphwar-detection-runner";
import type { GraphwarKillerLocale } from "../locale-types";
import type {
  GraphwarOneClickClearDebugDetail,
  GraphwarOneClickClearDebugStage,
  GraphwarOneClickClearDebugTiming,
} from "../pathfinding/graphwar-one-click-clear";
import type { GraphwarSmartPathfindingWorkerTiming } from "../pathfinding/graphwar-pathfinding-worker-types";

/** 识别调试耗时阶段。 */
export type DetectionDebugStage =
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

/** 智能寻路调试耗时阶段。 */
export type SmartPathfindingDebugStage =
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

/** 单次识别调试耗时记录。 */
export interface DetectionDebugTimingEntry {
  /** 被测量的识别阶段。 */
  stage: DetectionDebugStage;
  /** 阶段耗时，单位毫秒。 */
  elapsedMs: number;
  /** Worker 返回的阶段细分信息；存在时按子项展示。 */
  detail?: GraphwarDetectionWorkerTimingDetail;
}

/** 识别调试耗时展示行。 */
export interface DetectionDebugTimingRow extends DetectionDebugTimingEntry {
  /** 鼠标悬停说明；用于解释不直接对应某个函数块的阶段。 */
  title?: string;
  /** 展示标签，子项会以 "- " 开头。 */
  label: string;
  /** 是否展示耗时；有些子项只记录调度元信息。 */
  elapsedVisible: boolean;
}

/** 单次智能寻路调试耗时记录。 */
export interface SmartPathfindingDebugTimingEntry {
  /** 被测量的智能寻路阶段。 */
  stage: SmartPathfindingDebugStage;
  /** 阶段耗时，单位毫秒。 */
  elapsedMs: number;
  /** 阶段内细分耗时；存在时展示为父阶段下的子项。 */
  detail?: GraphwarOneClickClearDebugStage | GraphwarOneClickClearDebugDetail;
}

/** 智能寻路调试耗时展示行。 */
export interface SmartPathfindingDebugTimingRow extends SmartPathfindingDebugTimingEntry {
  /** 是否展示耗时；调度模式项只解释模式，不展示 0ms。 */
  elapsedVisible: boolean;
  /** 鼠标悬停说明；用于解释不直接对应某个函数块的阶段。 */
  title?: string;
  /** 展示缩进层级；一键清图内部阶段有父子 inclusive 耗时，缩进避免误读为同级相加。 */
  indentLevel: number;
  /** 展示标签，子项会以 "- " 开头。 */
  label: string;
}

interface GraphwarDebugTimingsOptions {
  /** 检测耗时落地前应确认异步检测 run 属于当前任务。 */
  isDetectionRunActive: (runId: number) => boolean;
  /** 调试阶段和 detail 文案应由页面注入的 locale 决定。 */
  getLocale: () => GraphwarKillerLocale;
}

export interface GraphwarDebugTimingsController {
  /** 聚合一键清图搜索内部重复阶段耗时。 */
  addOneClickClearSearchDebugTiming: (
    timings: SmartPathfindingDebugTimingEntry[],
    timing: GraphwarOneClickClearDebugTiming,
  ) => void;
  /** 将一键清图 route mask cache 耗时映射到页面阶段。 */
  addOneClickClearRouteMaskDebugTiming: (
    timings: SmartPathfindingDebugTimingEntry[],
    timing: GraphwarOneClickClearDebugTiming,
  ) => boolean;
  /** 追加智能寻路 worker 返回的阶段耗时。 */
  addSmartPathfindingWorkerTimings: (
    timings: SmartPathfindingDebugTimingEntry[] | undefined,
    workerTimings: readonly GraphwarSmartPathfindingWorkerTiming[],
  ) => void;
  /** 清理智能寻路调试耗时展示。 */
  clearSmartPathfindingDebugTimings: () => void;
  /** 转换检测 Worker 返回的 timing 格式。 */
  createDetectionDebugTimingEntriesFromWorker: (
    timings: readonly GraphwarDetectionWorkerTimingEntry[],
  ) => DetectionDebugTimingEntry[];
  /** 识别调试耗时展示行。 */
  detectionDebugTimingRows: ComputedRef<DetectionDebugTimingRow[]>;
  /** 汇总检测调试 timing。 */
  finishDetectionDebugTimings: (
    runId: number,
    startedAt: number,
    timings: readonly DetectionDebugTimingEntry[],
    completedAt?: number,
  ) => void;
  /** 汇总智能寻路调试 timing。 */
  finishSmartPathfindingDebugTimings: (
    startedAt: number,
    timings: readonly SmartPathfindingDebugTimingEntry[],
    completedAt?: number,
  ) => void;
  /** 在指定阶段前插入调试耗时。 */
  insertDebugTimingsBeforeLastStage: (
    timings: SmartPathfindingDebugTimingEntry[],
    stage: SmartPathfindingDebugStage,
    insertedTimings: readonly SmartPathfindingDebugTimingEntry[],
  ) => void;
  /** 包装页面侧检测阶段计时。 */
  measureDetectionDebugStage: <TResult>(
    timings: DetectionDebugTimingEntry[],
    stage: DetectionDebugStage,
    task: () => TResult,
  ) => TResult;
  /** 包装同步智能寻路阶段计时。 */
  measureSmartPathfindingDebugStage: <TResult>(
    timings: SmartPathfindingDebugTimingEntry[] | undefined,
    stage: SmartPathfindingDebugStage,
    task: () => TResult,
  ) => TResult;
  /** 包装异步智能寻路阶段计时。 */
  measureSmartPathfindingDebugStageAsync: <TResult>(
    timings: SmartPathfindingDebugTimingEntry[] | undefined,
    stage: SmartPathfindingDebugStage,
    task: () => Promise<TResult>,
  ) => Promise<TResult>;
  /** 智能寻路调试耗时展示行。 */
  smartPathfindingDebugTimingRows: ComputedRef<SmartPathfindingDebugTimingRow[]>;
  /** 从最近指定阶段扣除耗时。 */
  subtractLastDebugStageElapsed: (
    timings: SmartPathfindingDebugTimingEntry[],
    stage: SmartPathfindingDebugStage,
    elapsedMs: number,
  ) => void;
  /** 统计调试耗时总和。 */
  sumDebugTimingElapsed: (timings: readonly SmartPathfindingDebugTimingEntry[]) => number;
}

/** 管理 Graphwar Killer 调试耗时的计时、聚合和展示行规则。 */
export function useGraphwarDebugTimings(options: GraphwarDebugTimingsOptions): GraphwarDebugTimingsController {
  const detectionDebugTimingEntries = ref<DetectionDebugTimingEntry[]>([]);
  const smartPathfindingDebugTimingEntries = ref<SmartPathfindingDebugTimingEntry[]>([]);
  const detectionDebugTimingRows = computed<DetectionDebugTimingRow[]>(() =>
    detectionDebugTimingEntries.value.map((entry) => createDetectionDebugTimingRow(entry, options.getLocale())),
  );
  const smartPathfindingDebugTimingRows = computed<SmartPathfindingDebugTimingRow[]>(() =>
    createSmartPathfindingDebugTimingRows(smartPathfindingDebugTimingEntries.value, options.getLocale()),
  );

  /** 汇总检测调试 timing，并补齐阶段外耗时和总耗时。 */
  function finishDetectionDebugTimings(
    runId: number,
    startedAt: number,
    timings: readonly DetectionDebugTimingEntry[],
    completedAt = nowMs(),
  ) {
    if (!options.isDetectionRunActive(runId) || timings.length === 0) {
      return;
    }

    detectionDebugTimingEntries.value = createFinalDebugTimingEntries(timings, completedAt - startedAt);
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

    smartPathfindingDebugTimingEntries.value = createFinalDebugTimingEntries(timings, completedAt - startedAt);
  }

  /** 寻路/清图启动时先清旧日志；预检阶段取消时也不会展示上一轮结果。 */
  function clearSmartPathfindingDebugTimings() {
    smartPathfindingDebugTimingEntries.value = [];
  }

  return {
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
  };
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
  workerTimings: readonly GraphwarSmartPathfindingWorkerTiming[],
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

function createSmartPathfindingDebugTimingRows(
  entries: readonly SmartPathfindingDebugTimingEntry[],
  locale: GraphwarKillerLocale,
): SmartPathfindingDebugTimingRow[] {
  const rows: SmartPathfindingDebugTimingRow[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) {
      continue;
    }
    if (entry.stage !== "one-click-clear-search" || entry.detail) {
      rows.push(createSmartPathfindingDebugTimingRow(entry, locale));
      continue;
    }

    rows.push(createSmartPathfindingDebugTimingRow(entry, locale));
    const detailEntries: SmartPathfindingDebugTimingEntry[] = [];
    for (index += 1; index < entries.length; index += 1) {
      const detailEntry = entries[index];
      if (detailEntry?.stage !== "one-click-clear-search" || !detailEntry.detail) {
        index -= 1;
        break;
      }
      detailEntries.push(detailEntry);
    }
    rows.push(
      ...sortOneClickClearSearchDebugDetails(detailEntries).map((entry) =>
        createSmartPathfindingDebugTimingRow(entry, locale),
      ),
    );
  }
  return rows;
}

function createSmartPathfindingDebugTimingRow(
  entry: SmartPathfindingDebugTimingEntry,
  locale: GraphwarKillerLocale,
): SmartPathfindingDebugTimingRow {
  return {
    ...entry,
    elapsedVisible: shouldShowSmartPathfindingDebugElapsed(entry),
    indentLevel: getSmartPathfindingDebugTimingIndentLevel(entry),
    label: getSmartPathfindingDebugTimingLabel(entry, locale),
    title: getSmartPathfindingDebugTimingTitle(entry, locale),
  };
}

function sortOneClickClearSearchDebugDetails(
  entries: readonly SmartPathfindingDebugTimingEntry[],
): SmartPathfindingDebugTimingEntry[] {
  const remaining = [...entries];
  const sorted: SmartPathfindingDebugTimingEntry[] = [];
  for (const detail of oneClickClearSearchDebugDetailOrder) {
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

const oneClickClearSearchDebugDetailOrder: readonly (
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

const oneClickClearNestedDebugDetails = new Set<GraphwarOneClickClearDebugStage>([
  "route-pathfinding",
  "route-map-pixels",
  "segment-graph-rule",
  "segment-build-formula",
  "segment-sample-trajectory",
]);

function getSmartPathfindingDebugTimingIndentLevel(entry: SmartPathfindingDebugTimingEntry) {
  if (!entry.detail) {
    return 0;
  }
  if (typeof entry.detail !== "string") {
    return 2;
  }
  return oneClickClearNestedDebugDetails.has(entry.detail) ? 2 : 1;
}

function getSmartPathfindingDebugTimingLabel(entry: SmartPathfindingDebugTimingEntry, locale: GraphwarKillerLocale) {
  if (!entry.detail) {
    return getSmartPathfindingDebugStageLabel(entry.stage, locale);
  }
  if (typeof entry.detail === "string") {
    return locale.ui.pathfinding.debugDetails[entry.detail].label;
  }
  if (entry.detail.type === "dag-edge-mode") {
    return locale.ui.pathfinding.debugDetails[entry.detail.type].label(entry.detail.mode, entry.detail.workerCount);
  }
  return locale.ui.pathfinding.debugDetails[entry.detail.type].label(entry.detail.workerIndex);
}

function getSmartPathfindingDebugTimingTitle(entry: SmartPathfindingDebugTimingEntry, locale: GraphwarKillerLocale) {
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

/** 获取智能寻路调试阶段的短标签。 */
function getSmartPathfindingDebugStageLabel(stage: SmartPathfindingDebugStage, locale: GraphwarKillerLocale) {
  return locale.ui.pathfinding.debugStages[stage].label;
}

function createDetectionDebugTimingRow(
  entry: DetectionDebugTimingEntry,
  locale: GraphwarKillerLocale,
): DetectionDebugTimingRow {
  return {
    ...entry,
    elapsedVisible: shouldShowDetectionDebugElapsed(entry),
    label: getDetectionDebugTimingLabel(entry, locale),
    title: getDetectionDebugTimingTitle(entry, locale),
  };
}

/** 获取检测调试条目的展示标签，细分条目优先使用 detail 标签。 */
function getDetectionDebugTimingLabel(entry: DetectionDebugTimingEntry, locale: GraphwarKillerLocale) {
  return entry.detail
    ? getDetectionDebugTimingDetailLabel(entry.detail, locale)
    : getDetectionDebugStageLabel(entry.stage, locale);
}

/** 获取检测调试条目的 title，说明该阶段意图。 */
function getDetectionDebugTimingTitle(entry: DetectionDebugTimingEntry, locale: GraphwarKillerLocale) {
  return entry.detail
    ? locale.ui.detection.debugDetails[entry.detail.type].title
    : locale.ui.detection.debugStages[entry.stage].title;
}

/** 模板匹配模式条目只解释模式，不展示 0ms 耗时。 */
function shouldShowDetectionDebugElapsed(entry: DetectionDebugTimingEntry) {
  return entry.detail?.type !== "template-matching-mode";
}

/** 为不同模板匹配 detail 拼出带 worker 编号或模式的标签。 */
function getDetectionDebugTimingDetailLabel(detail: GraphwarDetectionWorkerTimingDetail, locale: GraphwarKillerLocale) {
  switch (detail.type) {
    case "template-matching-mode":
      return locale.ui.detection.debugDetails[detail.type].label(detail.mode, detail.workerCount);
    case "template-matching-worker":
      return locale.ui.detection.debugDetails[detail.type].label(detail.workerIndex);
    default:
      return locale.ui.detection.debugDetails[detail.type].label;
  }
}

/** 获取检测调试阶段的短标签。 */
function getDetectionDebugStageLabel(stage: DetectionDebugStage, locale: GraphwarKillerLocale) {
  return locale.ui.detection.debugStages[stage].label;
}

type AnyDebugTimingEntry = DetectionDebugTimingEntry | SmartPathfindingDebugTimingEntry;

function createFinalDebugTimingEntries(
  timings: readonly DetectionDebugTimingEntry[],
  totalElapsedMs: number,
): DetectionDebugTimingEntry[];
function createFinalDebugTimingEntries(
  timings: readonly SmartPathfindingDebugTimingEntry[],
  totalElapsedMs: number,
): SmartPathfindingDebugTimingEntry[];
function createFinalDebugTimingEntries(timings: readonly AnyDebugTimingEntry[], totalElapsedMs: number) {
  const measuredStageElapsedMs = timings.reduce((total, timing) => total + (timing.detail ? 0 : timing.elapsedMs), 0);
  const outsideStagesTiming: AnyDebugTimingEntry = {
    elapsedMs: Math.max(0, totalElapsedMs - measuredStageElapsedMs),
    stage: "outside-stages",
  };
  const totalTiming: AnyDebugTimingEntry = {
    elapsedMs: totalElapsedMs,
    stage: "total",
  };

  return [...timings, outsideStagesTiming, totalTiming];
}

/** 获取高精度时间戳，用于前端阶段计时。 */
function nowMs() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
