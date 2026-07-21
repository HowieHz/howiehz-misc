import { computed, ref, type ComputedRef } from "vue";

import { measureSyncStage, nowMs } from "../../core/time";
import type {
  GraphwarDetectionWorkerTimingDetail,
  GraphwarDetectionWorkerTimingEntry,
} from "../../detection/runtime/runner";
import type { GraphwarKillerLocale } from "../../locale-types";
import type {
  GraphwarOneClickClearDebugDetail,
  GraphwarOneClickClearDebugStage,
  GraphwarOneClickClearDebugTiming,
} from "../../pathfinding/one-click-clear/search";
import type { GraphwarSmartPathfindingWorkerTiming } from "../../pathfinding/runtime/protocol";

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
  | "prefix-evidence-hit"
  | "prefix-evidence-miss"
  | "prepare-pathfinding-prefix"
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
  | "validate-direct-trajectory"
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

/** 调试耗时控制器读取本地化文案的依赖。 */
interface GraphwarDebugTimingsOptions {
  /** 检测耗时落地前应确认异步检测 run 属于当前任务。 */
  isDetectionRunActive: (runId: number) => boolean;
  /** 调试阶段和 detail 文案应由页面注入的 locale 决定。 */
  getLocale: () => GraphwarKillerLocale;
}

/** 汇总检测与寻路耗时并生成展示行的调试控制器。 */
export interface GraphwarDebugTimingsController {
  /** 追加并整理一键清图 Worker 返回的搜索内部耗时。 */
  appendOneClickClearSearchWorkerTimings: (
    timings: SmartPathfindingDebugTimingEntry[],
    workerTimings: readonly GraphwarOneClickClearDebugTiming[],
  ) => void;
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

  /** 清理智能寻路旧日志；连续托管搜索会跳过调用，等新记录结算后再替换。 */
  function clearSmartPathfindingDebugTimings() {
    smartPathfindingDebugTimingEntries.value = [];
  }

  return {
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
  return measureSyncStage(timings, stage, task);
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
function appendOneClickClearSearchWorkerTimings(
  timings: SmartPathfindingDebugTimingEntry[],
  workerTimings: readonly GraphwarOneClickClearDebugTiming[],
) {
  const routeMaskTimings: SmartPathfindingDebugTimingEntry[] = [];
  const searchDetailTimings: SmartPathfindingDebugTimingEntry[] = [];
  for (const timing of workerTimings) {
    if (addOneClickClearRouteMaskDebugTiming(routeMaskTimings, timing)) {
      continue;
    }
    addOneClickClearSearchDebugTiming(searchDetailTimings, timing);
  }

  // Worker 的 search 阶段是 inclusive 耗时；route mask cache 作为页面同级阶段展示时应从 search 中扣出。
  subtractLastDebugStageElapsed(
    timings,
    "one-click-clear-search",
    routeMaskTimings.reduce((total, timing) => total + timing.elapsedMs, 0),
  );
  insertDebugTimingsBeforeLastStage(timings, "one-click-clear-search", routeMaskTimings);
  timings.push(...searchDetailTimings);
}

/** 合并同类一键清图搜索明细，避免并行边产生重复展示行。 */
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

/** 把 route mask 缓存阶段转换成页面侧一键清图阶段。 */
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

/** 将 Worker 耗时追加到当前智能寻路调试记录。 */
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

/** 把细分耗时插入最后一个指定父阶段之前。 */
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

/** 从最后一个父阶段扣除单独展示的子阶段耗时。 */
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

/** 将平铺耗时展开成带缩进的一键清图展示行。 */
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

/** 为单条智能寻路耗时补齐本地化标签和展示元数据。 */
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

/** 按工作流阶段顺序稳定排列一键清图搜索明细。 */
function sortOneClickClearSearchDebugDetails(
  entries: readonly SmartPathfindingDebugTimingEntry[],
): SmartPathfindingDebugTimingEntry[] {
  const remaining = [...entries];
  const sorted: SmartPathfindingDebugTimingEntry[] = [];
  for (const detail of oneClickClearSearchDebugDetailOrder) {
    for (let index = 0; index < remaining.length;) {
      const entry = remaining[index];
      if (entry?.detail && (typeof entry.detail === "string" ? entry.detail : entry.detail.type) === detail) {
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

/** 为可重复的边 Worker 明细生成可聚合 key。 */
function createOneClickClearDebugDetailKey(detail: GraphwarOneClickClearDebugStage | GraphwarOneClickClearDebugDetail) {
  return typeof detail === "string"
    ? detail
    : `${detail.type}:${detail.type === "dag-edge-worker" ? detail.workerIndex : ""}`;
}

const oneClickClearSearchDebugDetailOrder: readonly (
  | GraphwarOneClickClearDebugStage
  | GraphwarOneClickClearDebugDetail["type"]
)[] = [
  "validate-prefix",
  "validate-direct-trajectory",
  "prefix-evidence-hit",
  "prefix-evidence-miss",
  "prepare-pathfinding-prefix",
  "route-mask-cache-hit",
  "route-mask-cache-miss",
  "assign-clear-targets",
  "visibility-cache-hit",
  "visibility-cache-miss",
  "visibility-cache-skipped",
  "build-dag-edges",
  "dag-edge-mode",
  "dag-edge-worker",
  "route-pathfinding",
  "route-map-pixels",
  "scan-step-glitch",
  "dag-longest-path",
  "validate-route",
  "segment-graph-rule",
  "segment-sample-trajectory",
  "remove-failed-edge",
  "optimize-path",
  "validate-final",
];

const oneClickClearNestedDebugDetails = new Set<GraphwarOneClickClearDebugStage>([
  "route-pathfinding",
  "route-map-pixels",
  "segment-graph-rule",
  "segment-sample-trajectory",
]);

/** 根据父阶段和嵌套明细确定展示缩进。 */
function getSmartPathfindingDebugTimingIndentLevel(entry: SmartPathfindingDebugTimingEntry) {
  if (!entry.detail) {
    return 0;
  }
  if (typeof entry.detail !== "string") {
    return 2;
  }
  return oneClickClearNestedDebugDetails.has(entry.detail) ? 2 : 1;
}

/** 获取智能寻路阶段或明细的本地化短标签。 */
function getSmartPathfindingDebugTimingLabel(entry: SmartPathfindingDebugTimingEntry, locale: GraphwarKillerLocale) {
  if (!entry.detail) {
    return locale.ui.pathfinding.debugStages[entry.stage].label;
  }
  if (typeof entry.detail === "string") {
    return locale.ui.pathfinding.debugDetails[entry.detail].label;
  }
  if (entry.detail.type === "dag-edge-mode") {
    return locale.ui.pathfinding.debugDetails[entry.detail.type].label(entry.detail.mode, entry.detail.workerCount);
  }
  return locale.ui.pathfinding.debugDetails[entry.detail.type].label(entry.detail.workerIndex);
}

/** 获取智能寻路阶段或明细的本地化说明。 */
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

/** 为单条检测耗时补齐本地化标签和展示元数据。 */
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
    : locale.ui.detection.debugStages[entry.stage].label;
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

type AnyDebugTimingEntry = DetectionDebugTimingEntry | SmartPathfindingDebugTimingEntry;

/** 在阶段明细后补齐未归类耗时和总耗时。 */
function createFinalDebugTimingEntries(
  timings: readonly DetectionDebugTimingEntry[],
  totalElapsedMs: number,
): DetectionDebugTimingEntry[];
function createFinalDebugTimingEntries(
  timings: readonly SmartPathfindingDebugTimingEntry[],
  totalElapsedMs: number,
): SmartPathfindingDebugTimingEntry[];
function createFinalDebugTimingEntries(timings: readonly AnyDebugTimingEntry[], totalElapsedMs: number) {
  return [
    ...timings,
    {
      elapsedMs: Math.max(
        0,
        totalElapsedMs - timings.reduce((total, timing) => total + (timing.detail ? 0 : timing.elapsedMs), 0),
      ),
      stage: "outside-stages",
    },
    { elapsedMs: totalElapsedMs, stage: "total" },
  ];
}
