---
publish: false
published: 2026-05-14T10:30:00+08:00
---

# 相对评分器 v1

<!-- autocorrect-disable -->
<!-- markdownlint-disable MD011 -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter, type Router } from "vitepress";
import {
  buildGraphEdges,
  buildGraphItems,
  clampNumber,
  createRelationPairKey,
  formatOffset,
  getGraphViewportHeight,
  mapScores,
  mappedScore,
  normalizeName,
  roundOffsetForDisplay,
  type CompareItem,
  type GraphEdge,
  type RelationLevel,
  type RelationRecord,
} from "../../.vitepress/theme/compare-rater/core";
import {
  aspectOptionsByWorkType,
  fieldOptions,
  workTypeOptions,
  type WorkType,
} from "../../.vitepress/theme/compare-rater/presets";
import { compareRaterTestData } from "../../.vitepress/theme/compare-rater/test-data";

type AnchorRole = "best" | "worst";
type TransferStatus = "idle" | "success" | "error";

interface RelationWeights {
  same: number;
  better: number;
  quiteBetter: number;
  muchBetter: number;
}

interface AnimatedCompareItem extends CompareItem {
  targetX: number;
  targetY: number;
  velocityX: number;
  velocityY: number;
}

interface ScoredCompareItem extends CompareItem {
  score: number;
}

interface BangumiSubject {
  id: number;
  name: string;
  name_cn: string;
  nsfw?: boolean;
  image?: string;
  tags: string[];
  date?: string;
  platform?: string;
  rating?: {
    score?: number;
    rank?: number;
    total?: number;
  };
}

const relationLevels = [
  { value: "much-better", label: "好很多", symbol: ">>>", delta: 2 },
  { value: "quite-better", label: "好不少", symbol: ">>", delta: 1 },
  { value: "better", label: "好一点", symbol: ">", delta: 0.5 },
  { value: "same", label: "差不多", symbol: "≈", delta: 0 },
  { value: "worse", label: "差一点", symbol: "<", delta: -0.5 },
  { value: "quite-worse", label: "差不少", symbol: "<<", delta: -1 },
  { value: "much-worse", label: "差很多", symbol: "<<<", delta: -2 },
] as const satisfies readonly { value: RelationLevel; label: string; symbol: string; delta: number }[];

const COMPARE_RATER_SCHEMA = "compare-rater-form";
const COMPARE_RATER_SCHEMA_VERSION = 1;
const defaultRelationWeights = {
  same: 1,
  better: 0.5,
  quiteBetter: 1,
  muchBetter: 2,
} as const satisfies RelationWeights;
const relationLevelMeta = new Map(relationLevels.map((level) => [level.value, level]));

// 节点动画弹簧强度；0.13 让移动有弹性但不明显过冲。
const GRAPH_SPRING_STIFFNESS = 0.13;
// 阻尼低于 1 保留一点弹簧感，高于 0.7 可避免长时间震荡。
const GRAPH_SPRING_DAMPING = 0.74;
// 动画距离小于 0.025% 视为稳定，避免尾部微抖。
const GRAPH_SETTLE_EPSILON = 0.025;
// 最小缩放保留整体概览，同时不让文字小到不可辨认。
const GRAPH_MIN_ZOOM = 0.65;
// 最大缩放足够检查局部连线，继续放大只会增加拖拽成本。
const GRAPH_MAX_ZOOM = 2.8;
// 绝对评分扩展输出的滑条范围；最低保留 1，最高放宽到 10。
const SCORE_MIN = 1;
const SCORE_MAX = 10;
// 0.05 允许细调锚点，但最终表格仍保留两位小数。
const SCORE_STEP = 0.05;
// 高级权重滑条范围；0 表示禁用该关系力，10 是当前允许的最高强度。
const WEIGHT_MIN = 0;
const WEIGHT_MAX = 10;
const BANGUMI_API_BASE = "https://api.bgm.tv";
const BANGUMI_SEARCH_DEBOUNCE_MS = 1000;
const BANGUMI_RESULTS_PER_PAGE = 5;
const RELATIONS_PER_PAGE = 5;

const workType = ref<WorkType>("动画");
const fieldText = ref<(typeof fieldOptions)[number]>("无细分");
const aspectText = ref("综合");
const baseName = ref("");
const compareName = ref("");
const selectedLevel = ref<RelationLevel>("same");
const sameWeight = ref(String(defaultRelationWeights.same));
const betterWeight = ref(String(defaultRelationWeights.better));
const quiteBetterWeight = ref(String(defaultRelationWeights.quiteBetter));
const muchBetterWeight = ref(String(defaultRelationWeights.muchBetter));
const relationRecords = ref<RelationRecord[]>([]);
const relationPage = ref(1);
const relationPageInput = ref("1");
const nextRelationId = ref(1);
const bestAnchorName = ref("");
const bestAnchorScore = ref("10");
const worstAnchorName = ref("");
const worstAnchorScore = ref("1");
const announcement = ref("");
const bangumiAccessToken = ref("");
const bangumiKeyword = ref("");
const bangumiAllowNsfw = ref(false);
const bangumiSearchResults = ref<BangumiSubject[]>([]);
const bangumiSearchTotal = ref(0);
const bangumiPage = ref(1);
const bangumiPageInput = ref("1");
const bangumiSearchStatus = ref<"idle" | "loading" | "success" | "error">("idle");
const bangumiSearchMessage = ref("");
const exportStatus = ref<TransferStatus>("idle");
const importStatus = ref<TransferStatus>("idle");
const animatedGraphItems = ref<AnimatedCompareItem[]>([]);
const graphZoom = ref(1);
const graphPanX = ref(0);
const graphPanY = ref(0);
const graphViewportRef = ref<HTMLElement>();
const graphDragState = ref<{
  pointerId: number;
  startX: number;
  startY: number;
  startPanX: number;
  startPanY: number;
}>();
let exportStatusTimer: ReturnType<typeof setTimeout> | undefined;
let importStatusTimer: ReturnType<typeof setTimeout> | undefined;
let bangumiSearchTimer: ReturnType<typeof setTimeout> | undefined;
let graphAnimationFrame: number | undefined;
let restoreBeforeRouteChange: Router["onBeforeRouteChange"] | undefined;

const router = useRouter();

const selectedWorkTypeOption = computed(() => workTypeOptions.find((option) => option.label === workType.value) ?? workTypeOptions[0]);
const selectedAspectOptions = computed(() => aspectOptionsByWorkType[workType.value]);
const normalizedField = computed(() => normalizeName(fieldText.value) || "未命名领域");
const normalizedAspect = computed(() => normalizeName(aspectText.value) || "未命名角度");
const selectedAspectOption = computed(() => selectedAspectOptions.value.find((option) => option.label === aspectText.value) ?? selectedAspectOptions.value[0]);
const selectedLevelMeta = computed(() => getRelationLevelMeta(selectedLevel.value));
const hasRelations = computed(() => relationRecords.value.length > 0);
const relationWeights = computed<RelationWeights>(() => ({
  same: readWeightText(sameWeight.value, defaultRelationWeights.same),
  better: readWeightText(betterWeight.value, defaultRelationWeights.better),
  quiteBetter: readWeightText(quiteBetterWeight.value, defaultRelationWeights.quiteBetter),
  muchBetter: readWeightText(muchBetterWeight.value, defaultRelationWeights.muchBetter),
}));

const weightedRelationRecords = computed(() => relationRecords.value.map((record) => ({
  ...record,
  delta: getRelationDelta(record.level),
  weight: getRelationWeight(record.level),
})));

const graphItems = computed<CompareItem[]>(() => buildGraphItems(weightedRelationRecords.value));

const scoreAnchors = computed(() => ({
  best: bestAnchorName.value ? { name: bestAnchorName.value, score: Number(bestAnchorScore.value) } : undefined,
  worst: worstAnchorName.value ? { name: worstAnchorName.value, score: Number(worstAnchorScore.value) } : undefined,
}));
const scoreByName = computed(() => mapScores(graphItems.value, scoreAnchors.value));
const itemNameOptions = computed(() => graphItems.value.map((item) => item.name).toSorted((left, right) => left.localeCompare(right, "zh-Hans-CN")));

const scoredItems = computed<ScoredCompareItem[]>(() => {
  const items = graphItems.value;
  if (!items.length) {
    return [];
  }

  const mapped = scoreByName.value;
  return items
    .map((item) => ({
      ...item,
      score: mappedScore(item.name, mapped),
    }))
    .filter((item): item is ScoredCompareItem => item.score !== undefined)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return right.offset - left.offset;
    });
});

const graphEdges = computed<GraphEdge[]>(() => buildGraphEdges(weightedRelationRecords.value, animatedGraphItems.value, scoreByName.value));

const bestCandidate = computed(() => findRelativeCandidate("best"));
const worstCandidate = computed(() => findRelativeCandidate("worst"));
const relationSummary = computed(() => `${relationRecords.value.length} 条关系，${graphItems.value.length} 个作品`);
const relationPageCount = computed(() => Math.max(1, Math.ceil(relationRecords.value.length / RELATIONS_PER_PAGE)));
const pagedRelationRecords = computed(() => {
  const start = (relationPage.value - 1) * RELATIONS_PER_PAGE;
  return relationRecords.value.slice(start, start + RELATIONS_PER_PAGE);
});
const relationPageText = computed(() => `第 ${relationPage.value} / ${relationPageCount.value} 页`);
const canJumpRelationPage = computed(() => {
  const page = Number.parseInt(relationPageInput.value, 10);
  return Number.isFinite(page) && page >= 1 && page <= relationPageCount.value && page !== relationPage.value;
});
const graphSceneStyle = computed(() => ({
  transform: `translate(${graphPanX.value}px, ${graphPanY.value}px) scale(${graphZoom.value})`,
}));
const graphViewportStyle = computed(() => ({
  minHeight: `${getGraphViewportHeight(graphItems.value)}px`,
}));
const graphZoomText = computed(() => `${Math.round(graphZoom.value * 100)}%`);
const anchorScoreRangeStyle = computed(() => {
  const worstScore = Number(worstAnchorScore.value);
  const bestScore = Number(bestAnchorScore.value);
  const scoreSpan = SCORE_MAX - SCORE_MIN;
  return {
    "--score-range-start": `${((worstScore - SCORE_MIN) / scoreSpan) * 100}%`,
    "--score-range-end": `${((bestScore - SCORE_MIN) / scoreSpan) * 100}%`,
  } as Record<string, string>;
});
const exportButtonText = computed(() => {
  if (exportStatus.value === "success") {
    return "已导出";
  }
  if (exportStatus.value === "error") {
    return "导出失败";
  }
  return "导出到剪贴板";
});
const importButtonText = computed(() => {
  if (importStatus.value === "success") {
    return "已导入";
  }
  if (importStatus.value === "error") {
    return "导入失败";
  }
  return "从剪贴板导入";
});
const hasUnsavedInput = computed(() =>
  relationRecords.value.length > 0 ||
  normalizeName(baseName.value) !== "" ||
  normalizeName(compareName.value) !== "" ||
  workType.value !== "动画" ||
  fieldText.value !== "无细分" ||
  aspectText.value !== "综合" ||
  sameWeight.value !== String(defaultRelationWeights.same) ||
  betterWeight.value !== String(defaultRelationWeights.better) ||
  quiteBetterWeight.value !== String(defaultRelationWeights.quiteBetter) ||
  muchBetterWeight.value !== String(defaultRelationWeights.muchBetter) ||
  bestAnchorScore.value !== "10" ||
  worstAnchorScore.value !== "1",
);
const bangumiPageCount = computed(() => Math.max(1, Math.ceil(bangumiSearchTotal.value / BANGUMI_RESULTS_PER_PAGE)));
const bangumiPageText = computed(() => `第 ${bangumiPage.value} / ${bangumiPageCount.value} 页`);
const canJumpBangumiPage = computed(() => {
  const page = Number.parseInt(bangumiPageInput.value, 10);
  return Number.isFinite(page) && page >= 1 && page <= bangumiPageCount.value && page !== bangumiPage.value;
});
const currentRelationPairKey = computed(() => createRelationPairKey(baseName.value, compareName.value));
const duplicatedRelation = computed(() => {
  const pairKey = currentRelationPairKey.value;
  if (!pairKey) {
    return undefined;
  }
  return relationRecords.value.find((record) => createRelationPairKey(record.baseName, record.targetName) === pairKey);
});
const submitRelationButtonText = computed(() => (duplicatedRelation.value ? "修改关系" : "加入关系"));
const relationInputError = computed(() => {
  const normalizedBase = normalizeName(baseName.value);
  const normalizedTarget = normalizeName(compareName.value);
  if (!normalizedBase || !normalizedTarget) {
    return undefined;
  }
  if (normalizedBase === normalizedTarget) {
    return "基准作品和比较作品不能相同。";
  }
  return undefined;
});
const canAddRelation = computed(() => normalizeName(baseName.value) !== "" && normalizeName(compareName.value) !== "" && !relationInputError.value);

watch([baseName, compareName, duplicatedRelation], ([base, target, record]) => {
  if (!record) {
    return;
  }
  selectedLevel.value = getRelationLevelInCurrentOrder(record, base, target);
});

watch(workType, () => {
  if (!selectedAspectOptions.value.some((option) => option.label === aspectText.value)) {
    aspectText.value = "综合";
  }
  bangumiPage.value = 1;
  bangumiPageInput.value = "1";
  scheduleBangumiSearch();
});

watch(graphItems, (items) => {
  syncAnimatedGraphItems(items);
  syncAnchors();
}, { immediate: true });

watch(relationPageCount, (pageCount) => {
  if (relationPage.value > pageCount) {
    relationPage.value = pageCount;
  }
});

watch(relationPage, (page) => {
  relationPageInput.value = String(page);
});

watch([bangumiKeyword, fieldText, bangumiAllowNsfw], () => {
  bangumiPage.value = 1;
  bangumiPageInput.value = "1";
  scheduleBangumiSearch();
});

watch(bangumiPage, (page) => {
  bangumiPageInput.value = String(page);
});

onMounted(() => {
  window.addEventListener("beforeunload", handleBeforeUnload);
  restoreBeforeRouteChange = router.onBeforeRouteChange;
  router.onBeforeRouteChange = (to) => {
    if (hasUnsavedInput.value && !window.confirm("当前输入数据可能会丢失，确定要离开吗？")) {
      return false;
    }
    return restoreBeforeRouteChange?.(to);
  };
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", handleBeforeUnload);
  router.onBeforeRouteChange = restoreBeforeRouteChange;
  if (exportStatusTimer) {
    clearTimeout(exportStatusTimer);
  }
  if (importStatusTimer) {
    clearTimeout(importStatusTimer);
  }
  if (bangumiSearchTimer) {
    clearTimeout(bangumiSearchTimer);
  }
  if (graphAnimationFrame !== undefined && typeof window !== "undefined") {
    window.cancelAnimationFrame(graphAnimationFrame);
  }
});

function relationLabel(level: RelationLevel) {
  return getRelationLevelMeta(level).label;
}

function relationSymbol(level: RelationLevel) {
  return getRelationLevelMeta(level).symbol;
}

function getRelationLevelMeta(level: RelationLevel) {
  return relationLevelMeta.get(level) ?? relationLevels[3];
}

function getRelationDelta(level: RelationLevel) {
  if (level === "much-better") {
    return relationWeights.value.muchBetter;
  }
  if (level === "quite-better") {
    return relationWeights.value.quiteBetter;
  }
  if (level === "better") {
    return relationWeights.value.better;
  }
  if (level === "worse") {
    return -relationWeights.value.better;
  }
  if (level === "quite-worse") {
    return -relationWeights.value.quiteBetter;
  }
  if (level === "much-worse") {
    return -relationWeights.value.muchBetter;
  }
  return 0;
}

function getRelationWeight(level: RelationLevel) {
  return level === "same" ? relationWeights.value.same : 1;
}

function invertRelationLevel(level: RelationLevel): RelationLevel {
  if (level === "much-better") {
    return "much-worse";
  }
  if (level === "quite-better") {
    return "quite-worse";
  }
  if (level === "better") {
    return "worse";
  }
  if (level === "worse") {
    return "better";
  }
  if (level === "quite-worse") {
    return "quite-better";
  }
  if (level === "much-worse") {
    return "much-better";
  }
  return "same";
}

function getRelationLevelInCurrentOrder(record: RelationRecord, base: string, target: string) {
  const normalizedBase = normalizeName(base);
  const normalizedTarget = normalizeName(target);
  return record.baseName === normalizedBase && record.targetName === normalizedTarget
    ? record.level
    : invertRelationLevel(record.level);
}

function relationSymbolClass(level: RelationLevel) {
  return {
    "compare-rater__relation-symbol--same": level === "same",
    "compare-rater__relation-symbol--better": level === "better" || level === "worse",
    "compare-rater__relation-symbol--quite": level === "quite-better" || level === "quite-worse",
    "compare-rater__relation-symbol--much": level === "much-better" || level === "much-worse",
  };
}

function formatRelationText(record: Pick<RelationRecord, "baseName" | "targetName" | "level">) {
  const expression = `（${record.baseName} ${relationSymbol(record.level)} ${record.targetName}）`;
  if (record.level === "same") {
    return `${record.baseName} 与 ${record.targetName} 差不多${expression}`;
  }
  return `${record.baseName} 比 ${record.targetName} ${relationLabel(record.level)}${expression}`;
}

function handleGraphWheel(event: WheelEvent) {
  if (!graphViewportRef.value || event.deltaY === 0) {
    return;
  }

  const rect = graphViewportRef.value.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;
  const previousZoom = graphZoom.value;
  const nextZoom = clampNumber(previousZoom * Math.exp(-event.deltaY * 0.0012), GRAPH_MIN_ZOOM, GRAPH_MAX_ZOOM);
  if (nextZoom === previousZoom) {
    return;
  }

  const sceneX = (pointerX - graphPanX.value) / previousZoom;
  const sceneY = (pointerY - graphPanY.value) / previousZoom;
  graphZoom.value = nextZoom;
  graphPanX.value = pointerX - sceneX * nextZoom;
  graphPanY.value = pointerY - sceneY * nextZoom;
}

function startGraphDrag(event: PointerEvent) {
  if (event.button !== 0 || !graphViewportRef.value) {
    return;
  }

  graphDragState.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startPanX: graphPanX.value,
    startPanY: graphPanY.value,
  };
  graphViewportRef.value.setPointerCapture(event.pointerId);
}

function moveGraphDrag(event: PointerEvent) {
  const dragState = graphDragState.value;
  if (!dragState || dragState.pointerId !== event.pointerId) {
    return;
  }

  graphPanX.value = dragState.startPanX + event.clientX - dragState.startX;
  graphPanY.value = dragState.startPanY + event.clientY - dragState.startY;
}

function endGraphDrag(event: PointerEvent) {
  const dragState = graphDragState.value;
  if (!dragState || dragState.pointerId !== event.pointerId) {
    return;
  }

  graphDragState.value = undefined;
  if (graphViewportRef.value?.hasPointerCapture(event.pointerId)) {
    graphViewportRef.value.releasePointerCapture(event.pointerId);
  }
}

function resetGraphView() {
  const viewport = graphViewportRef.value;
  const items = animatedGraphItems.value;
  graphZoom.value = 1;
  if (!viewport || items.length === 0) {
    graphPanX.value = 0;
    graphPanY.value = 0;
    return;
  }

  const rect = viewport.getBoundingClientRect();
  const itemXs = items.map((item) => item.targetX);
  const itemYs = items.map((item) => item.targetY);
  const minX = Math.min(...itemXs);
  const maxX = Math.max(...itemXs);
  const minY = Math.min(...itemYs);
  const maxY = Math.max(...itemYs);
  const centerX = ((minX + maxX) / 2 / 100) * rect.width;
  const centerY = ((minY + maxY) / 2 / 100) * rect.height;
  graphPanX.value = rect.width / 2 - centerX;
  graphPanY.value = rect.height / 2 - centerY;
}

function resetGraphViewAfterRelationChange() {
  void nextTick(() => {
    resetGraphView();
  });
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!hasUnsavedInput.value) {
    return;
  }

  event.preventDefault();
  event.returnValue = "";
}

function addRelation() {
  const normalizedBase = normalizeName(baseName.value);
  const normalizedTarget = normalizeName(compareName.value);
  if (!normalizedBase || !normalizedTarget) {
    announcement.value = "请先填写基准作品和比较作品。";
    return;
  }

  if (normalizedBase === normalizedTarget) {
    announcement.value = "基准作品和比较作品不能相同。";
    return;
  }

  const level = selectedLevelMeta.value;
  const duplicatedRecord = duplicatedRelation.value;
  if (duplicatedRecord) {
    const updatedRecord = {
      ...duplicatedRecord,
      baseName: normalizedBase,
      targetName: normalizedTarget,
      level: level.value,
      delta: level.delta,
    } satisfies RelationRecord;
    relationRecords.value = relationRecords.value.map((record) =>
      record.id === duplicatedRecord.id ? updatedRecord : record,
    );
    syncAnchors();
    resetGraphViewAfterRelationChange();
    announcement.value = `已修改关系：${formatRelationText(updatedRecord)}。`;
    return;
  }

  const record = {
    id: nextRelationId.value,
    baseName: normalizedBase,
    targetName: normalizedTarget,
    level: level.value,
    delta: level.delta,
  } satisfies RelationRecord;
  relationRecords.value.push(record);
  nextRelationId.value += 1;
  relationPage.value = relationPageCount.value;
  compareName.value = "";
  syncAnchors();
  resetGraphViewAfterRelationChange();
  announcement.value = `已加入关系：${formatRelationText(record)}。`;
}

function removeRelation(id: number) {
  relationRecords.value = relationRecords.value.filter((record) => record.id !== id);
  syncAnchors();
  resetGraphViewAfterRelationChange();
  announcement.value = "已删除一条关系。";
}

function clearRelations() {
  if (!window.confirm("确定要清空已输入的所有关系吗？")) {
    return;
  }

  relationRecords.value = [];
  nextRelationId.value = 1;
  relationPage.value = 1;
  resetGraphViewAfterRelationChange();
  announcement.value = "已清空关系。";
}

function goRelationPage(direction: -1 | 1) {
  relationPage.value = clampNumber(relationPage.value + direction, 1, relationPageCount.value);
}

function goBangumiPage(direction: -1 | 1) {
  bangumiPage.value = clampNumber(bangumiPage.value + direction, 1, bangumiPageCount.value);
  void searchBangumiSubjects();
}

function jumpRelationPage() {
  const page = Number.parseInt(relationPageInput.value, 10);
  if (!Number.isFinite(page)) {
    relationPageInput.value = String(relationPage.value);
    return;
  }

  relationPage.value = clampNumber(page, 1, relationPageCount.value);
  relationPageInput.value = String(relationPage.value);
}

function jumpBangumiPage() {
  const page = Number.parseInt(bangumiPageInput.value, 10);
  if (!Number.isFinite(page)) {
    bangumiPageInput.value = String(bangumiPage.value);
    return;
  }

  const nextPage = clampNumber(page, 1, bangumiPageCount.value);
  bangumiPage.value = nextPage;
  bangumiPageInput.value = String(nextPage);
  void searchBangumiSubjects();
}

function scheduleBangumiSearch() {
  if (bangumiSearchTimer) {
    clearTimeout(bangumiSearchTimer);
  }

  if (!normalizeName(bangumiKeyword.value)) {
    bangumiSearchStatus.value = "idle";
    bangumiSearchMessage.value = "";
    bangumiSearchResults.value = [];
    bangumiSearchTotal.value = 0;
    return;
  }

  bangumiSearchTimer = setTimeout(() => {
    bangumiSearchTimer = undefined;
    void searchBangumiSubjects();
  }, BANGUMI_SEARCH_DEBOUNCE_MS);
}

async function searchBangumiSubjects() {
  if (bangumiSearchTimer) {
    clearTimeout(bangumiSearchTimer);
    bangumiSearchTimer = undefined;
  }

  const keyword = normalizeName(bangumiKeyword.value);
  if (!keyword) {
    bangumiSearchMessage.value = "请先输入搜索关键词。";
    return;
  }

  bangumiSearchStatus.value = "loading";
  bangumiSearchMessage.value = "";
  try {
    const response = await fetch(`${BANGUMI_API_BASE}/v0/search/subjects?limit=${BANGUMI_RESULTS_PER_PAGE}&offset=${(bangumiPage.value - 1) * BANGUMI_RESULTS_PER_PAGE}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(normalizeName(bangumiAccessToken.value) ? { Authorization: `Bearer ${normalizeName(bangumiAccessToken.value)}` } : {}),
      },
      body: JSON.stringify({
        keyword,
        sort: "match",
        filter: {
          type: [selectedWorkTypeOption.value.bangumiSubjectType],
          ...(fieldText.value === "无细分" ? {} : { tag: [fieldText.value] }),
          ...(bangumiAllowNsfw.value ? {} : { nsfw: false }),
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Bangumi search failed: ${response.status}`);
    }

    const payload = await response.json() as unknown;
    const results = readBangumiSubjects(payload);
    bangumiSearchResults.value = results;
    bangumiSearchTotal.value = readBangumiTotal(payload);
    if (bangumiPage.value > bangumiPageCount.value) {
      bangumiPage.value = bangumiPageCount.value;
    }
    bangumiSearchStatus.value = "success";
    bangumiSearchMessage.value = bangumiSearchTotal.value ? `找到 ${bangumiSearchTotal.value} 个结果。` : "没有找到匹配的作品。";
  } catch {
    bangumiSearchResults.value = [];
    bangumiSearchTotal.value = 0;
    bangumiSearchStatus.value = "error";
    bangumiSearchMessage.value = "Bangumi 搜索失败，请检查 access-token 或稍后再试。";
  }
}

function setBangumiSubjectName(role: "base" | "compare", subject: BangumiSubject) {
  const name = formatBangumiSubjectName(subject);
  if (role === "base") {
    baseName.value = name;
  } else {
    compareName.value = name;
  }
  announcement.value = `已填入作品：${name}。`;
}

function updateSameWeight(event: Event) {
  sameWeight.value = normalizeWeightText((event.target as HTMLInputElement).value, defaultRelationWeights.same);
  resetGraphViewAfterRelationChange();
}

function updateBetterWeight(event: Event) {
  const value = normalizeWeightText((event.target as HTMLInputElement).value, defaultRelationWeights.better);
  betterWeight.value = value;
  if (Number(value) > Number(quiteBetterWeight.value)) {
    quiteBetterWeight.value = value;
  }
  if (Number(value) > Number(muchBetterWeight.value)) {
    muchBetterWeight.value = value;
  }
  resetGraphViewAfterRelationChange();
}

function updateQuiteBetterWeight(event: Event) {
  const value = normalizeWeightText((event.target as HTMLInputElement).value, defaultRelationWeights.quiteBetter);
  quiteBetterWeight.value = value;
  if (Number(value) < Number(betterWeight.value)) {
    betterWeight.value = value;
  }
  if (Number(value) > Number(muchBetterWeight.value)) {
    muchBetterWeight.value = value;
  }
  resetGraphViewAfterRelationChange();
}

function updateMuchBetterWeight(event: Event) {
  const value = normalizeWeightText((event.target as HTMLInputElement).value, defaultRelationWeights.muchBetter);
  muchBetterWeight.value = value;
  if (Number(value) < Number(quiteBetterWeight.value)) {
    quiteBetterWeight.value = value;
  }
  if (Number(value) < Number(betterWeight.value)) {
    betterWeight.value = value;
  }
  resetGraphViewAfterRelationChange();
}

function syncAnchors() {
  bestAnchorName.value = bestCandidate.value?.name ?? "";
  worstAnchorName.value = worstCandidate.value?.name ?? "";
}

function findRelativeCandidate(role: AnchorRole) {
  const sortedItems = graphItems.value.toSorted((left, right) => {
    const leftOffset = roundOffsetForDisplay(left.offset);
    const rightOffset = roundOffsetForDisplay(right.offset);
    if (rightOffset !== leftOffset) {
      return rightOffset - leftOffset;
    }
    return left.name.localeCompare(right.name, "zh-Hans-CN");
  });
  return role === "best" ? sortedItems.at(0) : sortedItems.at(-1);
}

function syncAnimatedGraphItems(items: readonly CompareItem[]) {
  const existingItems = new Map(animatedGraphItems.value.map((item) => [item.name, item]));
  animatedGraphItems.value = items.map((item) => {
    const existingItem = existingItems.get(item.name);
    return {
      ...item,
      x: existingItem?.x ?? item.x,
      y: existingItem?.y ?? item.y,
      targetX: item.x,
      targetY: item.y,
      velocityX: existingItem?.velocityX ?? 0,
      velocityY: existingItem?.velocityY ?? 0,
    };
  });

  if (typeof window === "undefined") {
    animatedGraphItems.value = animatedGraphItems.value.map((item) => ({
      ...item,
      x: item.targetX,
      y: item.targetY,
      velocityX: 0,
      velocityY: 0,
    }));
    return;
  }

  startGraphSpringAnimation();
}

function startGraphSpringAnimation() {
  if (graphAnimationFrame !== undefined || typeof window === "undefined") {
    return;
  }

  const step = () => {
    let hasMovingNode = false;
    animatedGraphItems.value = animatedGraphItems.value.map((item) => {
      const nextVelocityX = (item.velocityX + (item.targetX - item.x) * GRAPH_SPRING_STIFFNESS) * GRAPH_SPRING_DAMPING;
      const nextVelocityY = (item.velocityY + (item.targetY - item.y) * GRAPH_SPRING_STIFFNESS) * GRAPH_SPRING_DAMPING;
      let nextX = item.x + nextVelocityX;
      let nextY = item.y + nextVelocityY;
      let velocityX = nextVelocityX;
      let velocityY = nextVelocityY;

      if (
        Math.abs(item.targetX - nextX) < GRAPH_SETTLE_EPSILON
        && Math.abs(item.targetY - nextY) < GRAPH_SETTLE_EPSILON
        && Math.abs(nextVelocityX) < GRAPH_SETTLE_EPSILON
        && Math.abs(nextVelocityY) < GRAPH_SETTLE_EPSILON
      ) {
        nextX = item.targetX;
        nextY = item.targetY;
        velocityX = 0;
        velocityY = 0;
      } else {
        hasMovingNode = true;
      }

      return {
        ...item,
        x: nextX,
        y: nextY,
        velocityX,
        velocityY,
      };
    });

    if (hasMovingNode) {
      graphAnimationFrame = window.requestAnimationFrame(step);
      return;
    }

    graphAnimationFrame = undefined;
  };

  graphAnimationFrame = window.requestAnimationFrame(step);
}

function formatScore(value: number | undefined) {
  return value === undefined ? "-" : value.toFixed(2);
}

function formatScoreOption(value: string) {
  const normalizedScore = normalizeScoreText(value);
  return normalizedScore ?? value;
}

function weightSliderStyle(value: string) {
  const weight = readWeightText(value, 0);
  return {
    "--weight-value-pos": `${((weight - WEIGHT_MIN) / (WEIGHT_MAX - WEIGHT_MIN)) * 100}%`,
  } as Record<string, string>;
}

function updateBestAnchorScore(event: Event) {
  const score = normalizeScoreText((event.target as HTMLInputElement).value);
  if (!score) {
    return;
  }

  bestAnchorScore.value = score;
  if (Number(score) < Number(worstAnchorScore.value)) {
    worstAnchorScore.value = score;
  }
}

function updateWorstAnchorScore(event: Event) {
  const score = normalizeScoreText((event.target as HTMLInputElement).value);
  if (!score) {
    return;
  }

  worstAnchorScore.value = score;
  if (Number(score) > Number(bestAnchorScore.value)) {
    bestAnchorScore.value = score;
  }
}

function buildExportPayload() {
  return {
    schema: COMPARE_RATER_SCHEMA,
    schemaVersion: COMPARE_RATER_SCHEMA_VERSION,
    workType: workType.value,
    field: normalizedField.value,
    aspect: normalizedAspect.value,
    relations: relationRecords.value.map((record) => ({
      base: record.baseName,
      target: record.targetName,
      relation: record.level,
      delta: getRelationDelta(record.level),
    })),
    weights: relationWeights.value,
    anchors: {
      best: bestAnchorName.value ? { name: bestAnchorName.value, score: Number(bestAnchorScore.value) } : undefined,
      worst: worstAnchorName.value ? { name: worstAnchorName.value, score: Number(worstAnchorScore.value) } : undefined,
    },
  };
}

async function copyExportJson() {
  try {
    await copyText(JSON.stringify(buildExportPayload(), null, 2));
    setExportStatus("success");
    setImportStatus("idle");
    announcement.value = "已导出当前关系图表单到剪贴板。";
  } catch {
    setExportStatus("error");
    setImportStatus("idle");
    announcement.value = "导出失败，请确认浏览器允许写入剪贴板。";
  }
}

async function importFromClipboard() {
  if (hasRelations.value && !window.confirm("当前已有数据，从剪贴板导入会覆盖已有内容。是否继续？")) {
    return;
  }

  try {
    const text = await readClipboardText();
    const importedCount = importPayload(JSON.parse(text));
    setExportStatus("idle");
    setImportStatus("success");
    announcement.value = `已从剪贴板导入 ${importedCount} 条关系。`;
    resetGraphViewAfterRelationChange();
  } catch {
    setExportStatus("idle");
    setImportStatus("error");
    announcement.value = "导入失败，请确认剪贴板里是本工具导出的 JSON。";
  }
}

function useTestData() {
  if (hasRelations.value && !window.confirm("当前已有数据，使用测试数据会覆盖已有内容。是否继续？")) {
    return;
  }

  const importedCount = importPayload(compareRaterTestData);
  setExportStatus("idle");
  setImportStatus("idle");
  announcement.value = `已载入测试数据，共 ${importedCount} 条关系。`;
  resetGraphViewAfterRelationChange();
}

function setExportStatus(status: TransferStatus) {
  exportStatus.value = status;
  if (exportStatusTimer) {
    clearTimeout(exportStatusTimer);
  }
  if (status !== "idle") {
    exportStatusTimer = setTimeout(() => {
      exportStatus.value = "idle";
      exportStatusTimer = undefined;
    }, 1800);
  }
}

function setImportStatus(status: TransferStatus) {
  importStatus.value = status;
  if (importStatusTimer) {
    clearTimeout(importStatusTimer);
  }
  if (status !== "idle") {
    importStatusTimer = setTimeout(() => {
      importStatus.value = "idle";
      importStatusTimer = undefined;
    }, 1800);
  }
}

function importPayload(payload: unknown) {
  if (
    !isRecord(payload)
    || payload.schema !== COMPARE_RATER_SCHEMA
    || payload.schemaVersion !== COMPARE_RATER_SCHEMA_VERSION
    || !isWorkType(payload.workType)
    || typeof payload.field !== "string"
    || typeof payload.aspect !== "string"
    || !Array.isArray(payload.relations)
    || !isRecord(payload.anchors)
  ) {
    throw new Error("Unsupported payload");
  }

  if (!fieldOptions.includes(payload.field as (typeof fieldOptions)[number])) {
    throw new Error("Invalid field");
  }
  workType.value = payload.workType;
  fieldText.value = payload.field as (typeof fieldOptions)[number];

  const importedAspect = aspectOptionsByWorkType[payload.workType].find((option) => option.label === payload.aspect);
  if (!importedAspect) {
    throw new Error("Invalid aspect");
  }
  aspectText.value = importedAspect.label;
  importRelationWeights(payload.weights);

  const pairKeys = new Set<string>();
  const importedRelations: RelationRecord[] = [];
  for (const relation of payload.relations) {
    if (!isRecord(relation) || typeof relation.base !== "string" || typeof relation.target !== "string" || !isRelationLevel(relation.relation)) {
      throw new Error("Invalid relation");
    }

    const normalizedBase = normalizeName(relation.base);
    const normalizedTarget = normalizeName(relation.target);
    const pairKey = createRelationPairKey(normalizedBase, normalizedTarget);
    if (!normalizedBase || !normalizedTarget || normalizedBase === normalizedTarget || !pairKey || pairKeys.has(pairKey)) {
      throw new Error("Invalid relation pair");
    }

    const level = getRelationLevelMeta(relation.relation);
    if (relation.delta !== getDeltaForWeights(level.value, relationWeights.value)) {
      throw new Error("Invalid relation delta");
    }
    pairKeys.add(pairKey);
    importedRelations.push({
      id: importedRelations.length + 1,
      baseName: normalizedBase,
      targetName: normalizedTarget,
      level: level.value,
      delta: getDeltaForWeights(level.value, relationWeights.value),
    });
  }

  relationRecords.value = importedRelations;
  nextRelationId.value = importedRelations.length + 1;
  relationPage.value = 1;
  importAnchors(payload.anchors, new Set(importedRelations.flatMap((relation) => [relation.baseName, relation.targetName])));
  syncAnchors();
  return importedRelations.length;
}

function importRelationWeights(weights: unknown) {
  if (!isRecord(weights)) {
    throw new Error("Invalid weights");
  }
  sameWeight.value = normalizeWeightText(weights.same, defaultRelationWeights.same);
  betterWeight.value = normalizeWeightText(weights.better, defaultRelationWeights.better);
  quiteBetterWeight.value = normalizeWeightText(weights.quiteBetter, defaultRelationWeights.quiteBetter);
  muchBetterWeight.value = normalizeWeightText(weights.muchBetter, defaultRelationWeights.muchBetter);
  if (
    Number(betterWeight.value) > Number(quiteBetterWeight.value) ||
    Number(quiteBetterWeight.value) > Number(muchBetterWeight.value)
  ) {
    throw new Error("Invalid weights");
  }
}

function importAnchors(anchors: unknown, names: ReadonlySet<string>) {
  bestAnchorName.value = "";
  worstAnchorName.value = "";
  if (!isRecord(anchors)) {
    throw new Error("Invalid anchors");
  }

  const best = readImportAnchor(anchors.best, names);
  if (best) {
    bestAnchorName.value = best.name;
    bestAnchorScore.value = best.score;
  }

  const worst = readImportAnchor(anchors.worst, names);
  if (worst) {
    worstAnchorName.value = worst.name;
    worstAnchorScore.value = worst.score;
  }
  syncAnchorScoreOrder();
}

function readImportAnchor(anchor: unknown, names: ReadonlySet<string>) {
  if (anchor === undefined) {
    return undefined;
  }
  if (!isRecord(anchor) || typeof anchor.name !== "string") {
    throw new Error("Invalid anchor");
  }

  const name = normalizeName(anchor.name);
  const score = normalizeScoreText(anchor.score);
  if (!names.has(name) || !score) {
    throw new Error("Invalid anchor");
  }
  return { name, score };
}

function normalizeScoreText(value: unknown) {
  const score = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (
    !Number.isFinite(score) ||
    score < SCORE_MIN ||
    score > SCORE_MAX ||
    Math.abs(score / SCORE_STEP - Math.round(score / SCORE_STEP)) > 0.001
  ) {
    return undefined;
  }
  if (Number.isInteger(score)) {
    return String(score);
  }
  if (Math.abs(score * 10 - Math.round(score * 10)) < 0.001) {
    return score.toFixed(1);
  }
  return score.toFixed(2);
}

function normalizeWeightText(value: unknown, fallback: number) {
  const weight = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(weight) || weight < 0 || weight > 10 || Math.abs(weight * 10 - Math.round(weight * 10)) > 0.001) {
    return String(fallback);
  }
  return Number.isInteger(weight) ? String(weight) : weight.toFixed(1);
}

function readWeightText(value: string, fallback: number) {
  return Number(normalizeWeightText(value, fallback));
}

function getDeltaForWeights(level: RelationLevel, weights: RelationWeights) {
  if (level === "much-better") {
    return weights.muchBetter;
  }
  if (level === "quite-better") {
    return weights.quiteBetter;
  }
  if (level === "better") {
    return weights.better;
  }
  if (level === "worse") {
    return -weights.better;
  }
  if (level === "quite-worse") {
    return -weights.quiteBetter;
  }
  if (level === "much-worse") {
    return -weights.muchBetter;
  }
  return 0;
}

function syncAnchorScoreOrder() {
  if (Number(bestAnchorScore.value) < Number(worstAnchorScore.value)) {
    bestAnchorScore.value = worstAnchorScore.value;
  }
}

function isWorkType(value: unknown): value is WorkType {
  return typeof value === "string" && workTypeOptions.some((item) => item.label === value);
}

function isRelationLevel(value: unknown): value is RelationLevel {
  return typeof value === "string" && relationLevels.some((item) => item.value === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readBangumiSubjects(payload: unknown) {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    return [];
  }

  return payload.data.flatMap((item): BangumiSubject[] => {
    if (!isRecord(item) || typeof item.id !== "number" || typeof item.name !== "string" || typeof item.name_cn !== "string") {
      return [];
    }

    const rating = isRecord(item.rating)
      ? {
        score: typeof item.rating.score === "number" ? item.rating.score : undefined,
        rank: typeof item.rating.rank === "number" ? item.rating.rank : undefined,
        total: typeof item.rating.total === "number" ? item.rating.total : undefined,
      }
      : undefined;
    return [{
      id: item.id,
      name: item.name,
      name_cn: item.name_cn,
      nsfw: typeof item.nsfw === "boolean" ? item.nsfw : undefined,
      image: readBangumiSubjectImage(item.images),
      tags: readBangumiSubjectTags(item.tags),
      date: typeof item.date === "string" ? item.date : undefined,
      platform: typeof item.platform === "string" ? item.platform : undefined,
      rating,
    }];
  });
}

function readBangumiSubjectImage(images: unknown) {
  if (!isRecord(images)) {
    return undefined;
  }

  const image = images.common ?? images.medium ?? images.small ?? images.grid;
  return typeof image === "string" && image ? image : undefined;
}

function readBangumiSubjectTags(tags: unknown) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return Array.from(new Set(tags.flatMap((tag): string[] => {
    if (!isRecord(tag) || typeof tag.name !== "string") {
      return [];
    }
    const name = normalizeName(tag.name);
    return name ? [name] : [];
  }))).slice(0, 4);
}

function readBangumiTotal(payload: unknown) {
  if (!isRecord(payload) || typeof payload.total !== "number") {
    return 0;
  }
  return payload.total;
}

function formatBangumiSubjectName(subject: BangumiSubject) {
  return normalizeName(subject.name_cn) || normalizeName(subject.name) || `Bangumi#${subject.id}`;
}

function getBangumiSubjectUrl(subject: BangumiSubject) {
  return `https://bgm.tv/subject/${subject.id}`;
}

function formatBangumiSubjectMeta(subject: BangumiSubject) {
  return [
    subject.date,
    subject.platform,
    subject.rating?.score ? `评分 ${subject.rating.score.toFixed(1)}` : undefined,
    subject.rating?.rank ? `排名 #${subject.rating.rank}` : undefined,
  ].filter(Boolean).join(" / ");
}

async function readClipboardText() {
  if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
    throw new Error("Clipboard API unavailable");
  }
  return navigator.clipboard.readText();
}

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
<!-- markdownlint-enable MD011 -->
<!-- autocorrect-enable -->

通过相对比较，工具会按模型建立关系图，最后可以通过基准分将相对分值映射成绝对分值。

<div class="compare-rater">
  <p
    class="compare-rater__sr-only"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    {{ announcement }}
  </p>
  <section
    class="compare-rater__panel"
    aria-labelledby="compare-rater-scope-title"
  >
    <div class="compare-rater__label-row">
      <h2 id="compare-rater-scope-title">评分范围</h2>
      <span>{{ workType }} / {{ normalizedField }} / {{ normalizedAspect }}</span>
    </div>
    <div class="compare-rater__scope-grid">
      <label>
        <span>作品类型</span>
        <select v-model="workType">
          <option
            v-for="option in workTypeOptions"
            :key="option.label"
            :value="option.label"
          >
            {{ option.label }}
          </option>
        </select>
      </label>
      <label>
        <span>细分领域</span>
        <select v-model="fieldText">
          <option
            v-for="option in fieldOptions"
            :key="option"
            :value="option"
          >
            {{ option }}
          </option>
        </select>
      </label>
      <label>
        <span>评价角度</span>
        <select v-model="aspectText">
          <option
            v-for="option in selectedAspectOptions"
            :key="option.label"
            :value="option.label"
          >
            {{ option.label }}
          </option>
        </select>
      </label>
    </div>
    <p class="compare-rater__aspect-description">
      {{ selectedAspectOption.description }}
    </p>
  </section>

  <section
    class="compare-rater__panel compare-rater__relation-panel"
    aria-labelledby="compare-rater-relation-title"
  >
    <div class="compare-rater__label-row">
      <h2 id="compare-rater-relation-title">录入关系</h2>
      <span>{{ relationSummary }}</span>
    </div>
    <form
      class="compare-rater__relation-form"
      @submit.prevent="addRelation"
    >
      <label>
        <span>基准作品</span>
        <input
          v-model="baseName"
          required
          autocomplete="off"
          list="compare-name-options"
          placeholder="选择或输入基准作品"
        >
      </label>
      <label>
        <span>关系</span>
        <select v-model="selectedLevel">
          <option
            v-for="level in relationLevels"
            :key="level.value"
            :value="level.value"
          >
            {{ level.label }} ({{ level.symbol }})
          </option>
        </select>
      </label>
      <label>
        <span>比较作品</span>
        <input
          v-model="compareName"
          required
          autocomplete="off"
          list="compare-name-options"
          placeholder="选择或输入比较作品"
        >
      </label>
      <button
        type="submit"
        class="compare-rater__primary-button"
        :disabled="!canAddRelation"
      >
        {{ submitRelationButtonText }}
      </button>
    </form>
    <datalist id="compare-name-options">
      <option
        v-for="name in itemNameOptions"
        :key="name"
        :value="name"
      />
    </datalist>
    <p
      v-if="relationInputError"
      class="compare-rater__error"
    >
      {{ relationInputError }}
    </p>
    <ol
      v-if="hasRelations"
      class="compare-rater__relation-list"
    >
      <li
        v-for="record in pagedRelationRecords"
        :key="record.id"
      >
        <span>
          <template v-if="record.level === 'same'">
            {{ record.baseName }} 与 {{ record.targetName }} 差不多
          </template>
          <template v-else>
            {{ record.baseName }} 比 {{ record.targetName }} {{ relationLabel(record.level) }}
          </template>
          <span class="compare-rater__relation-expression">
            （{{ record.baseName }}
            <strong
              class="compare-rater__relation-symbol"
              :class="relationSymbolClass(record.level)"
            >
              {{ relationSymbol(record.level) }}
            </strong>
            {{ record.targetName }}）
          </span>
        </span>
        <button
          type="button"
          aria-label="删除这条关系"
          @click="removeRelation(record.id)"
        >
          删除
        </button>
      </li>
    </ol>
    <div
      v-if="relationPageCount > 1"
      class="compare-rater__relation-pager"
    >
      <form
        class="compare-rater__relation-jump"
        @submit.prevent="jumpRelationPage"
      >
        <span>跳转到</span>
        <input
          v-model="relationPageInput"
          type="number"
          min="1"
          :max="relationPageCount"
          step="1"
          aria-label="跳转页码"
          @blur="jumpRelationPage"
        >
        <span>页</span>
        <button
          type="submit"
          class="compare-rater__secondary-button"
          :disabled="!canJumpRelationPage"
        >
          跳转
        </button>
      </form>
      <button
        type="button"
        class="compare-rater__secondary-button"
        :disabled="relationPage <= 1"
        @click="goRelationPage(-1)"
      >
        上一页
      </button>
      <span>{{ relationPageText }}</span>
      <button
        type="button"
        class="compare-rater__secondary-button"
        :disabled="relationPage >= relationPageCount"
        @click="goRelationPage(1)"
      >
        下一页
      </button>
    </div>
    <p
      v-else
      class="compare-rater__empty"
    >
      请先录入至少一条关系。
    </p>
    <div class="compare-rater__transfer-actions">
      <button
        type="button"
        class="compare-rater__secondary-button"
        @click="importFromClipboard"
      >
        {{ importButtonText }}
      </button>
      <button
        type="button"
        class="compare-rater__secondary-button"
        :disabled="!scoredItems.length"
        @click="copyExportJson"
      >
        {{ exportButtonText }}
      </button>
      <button
        type="button"
        class="compare-rater__secondary-button"
        @click="useTestData"
      >
        使用测试数据
      </button>
      <button
        v-if="hasRelations"
        type="button"
        class="compare-rater__secondary-button"
        @click="clearRelations"
      >
        清空已输入的关系
      </button>
    </div>
    <details class="compare-rater__advanced">
      <summary>高级选项</summary>
      <div class="compare-rater__weight-grid">
        <label class="compare-rater__score-slider">
          <span>
            <strong class="compare-rater__relation-symbol compare-rater__relation-symbol--same">≈</strong>
            吸引强度
          </span>
          <div
            class="compare-rater__weight-slider-control"
            :style="weightSliderStyle(sameWeight)"
          >
            <div class="compare-rater__weight-slider-labels">
              <strong>{{ sameWeight }}</strong>
            </div>
            <input
              v-model="sameWeight"
              type="range"
              :min="WEIGHT_MIN"
              :max="WEIGHT_MAX"
              step="0.1"
              aria-label="差不多吸引强度"
              @input="updateSameWeight"
            >
          </div>
        </label>
        <label class="compare-rater__score-slider">
          <span>
            <strong class="compare-rater__relation-symbol compare-rater__relation-symbol--better">&gt;</strong>
            排斥强度
          </span>
          <div
            class="compare-rater__weight-slider-control"
            :style="weightSliderStyle(betterWeight)"
          >
            <div class="compare-rater__weight-slider-labels">
              <strong>{{ betterWeight }}</strong>
            </div>
            <input
              v-model="betterWeight"
              type="range"
              :min="WEIGHT_MIN"
              :max="WEIGHT_MAX"
              step="0.1"
              aria-label="好一点排斥强度"
              @input="updateBetterWeight"
            >
          </div>
        </label>
        <label class="compare-rater__score-slider">
          <span>
            <strong class="compare-rater__relation-symbol compare-rater__relation-symbol--quite">&gt;&gt;</strong>
            排斥强度
          </span>
          <div
            class="compare-rater__weight-slider-control"
            :style="weightSliderStyle(quiteBetterWeight)"
          >
            <div class="compare-rater__weight-slider-labels">
              <strong>{{ quiteBetterWeight }}</strong>
            </div>
            <input
              v-model="quiteBetterWeight"
              type="range"
              :min="WEIGHT_MIN"
              :max="WEIGHT_MAX"
              step="0.1"
              aria-label="好不少排斥强度"
              @input="updateQuiteBetterWeight"
            >
          </div>
        </label>
        <label class="compare-rater__score-slider">
          <span>
            <strong class="compare-rater__relation-symbol compare-rater__relation-symbol--much">&gt;&gt;&gt;</strong>
            排斥强度
          </span>
          <div
            class="compare-rater__weight-slider-control"
            :style="weightSliderStyle(muchBetterWeight)"
          >
            <div class="compare-rater__weight-slider-labels">
              <strong>{{ muchBetterWeight }}</strong>
            </div>
            <input
              v-model="muchBetterWeight"
              type="range"
              :min="WEIGHT_MIN"
              :max="WEIGHT_MAX"
              step="0.1"
              aria-label="好很多排斥强度"
              @input="updateMuchBetterWeight"
            >
          </div>
        </label>
      </div>
    </details>
    <details class="compare-rater__advanced">
      <summary>使用 Bangumi 搜索</summary>
      <form
        class="compare-rater__bangumi-search"
        @submit.prevent
      >
        <label>
          <span class="compare-rater__label-with-link">
            Bangumi access-token
            <a
              href="https://next.bgm.tv/demo/access-token"
              target="_blank"
              rel="noopener noreferrer"
            >
              创建一个 token
            </a>
          </span>
          <input
            v-model="bangumiAccessToken"
            autocomplete="off"
            type="password"
            placeholder="仅在浏览器本地使用"
          >
        </label>
        <label class="compare-rater__checkbox-label">
          <input
            v-model="bangumiAllowNsfw"
            type="checkbox"
          >
          <span>包含 NSFW</span>
        </label>
        <label>
          <span>快速搜索</span>
          <input
            v-model="bangumiKeyword"
            autocomplete="off"
            placeholder="输入作品名自动搜索"
          >
        </label>
      </form>
      <p
        v-if="bangumiSearchStatus === 'loading' || bangumiSearchMessage"
        class="compare-rater__hint"
      >
        {{ bangumiSearchStatus === "loading" ? "搜索中……" : bangumiSearchMessage }}
      </p>
      <ol
        v-if="bangumiSearchResults.length"
        class="compare-rater__bangumi-results"
      >
        <li
          v-for="subject in bangumiSearchResults"
          :key="subject.id"
        >
          <img
            v-if="subject.image"
            class="compare-rater__bangumi-cover"
            :src="subject.image"
            :alt="`${formatBangumiSubjectName(subject)} 封面`"
            loading="lazy"
          >
          <div class="compare-rater__bangumi-info">
            <a
              class="compare-rater__bangumi-title"
              :href="getBangumiSubjectUrl(subject)"
              target="_blank"
              rel="noopener noreferrer"
            >
              <strong>{{ formatBangumiSubjectName(subject) }}</strong>
            </a>
            <span
              v-if="subject.nsfw"
              class="compare-rater__bangumi-badge"
            >
              NSFW
            </span>
            <span>{{ subject.name }}</span>
            <small>{{ formatBangumiSubjectMeta(subject) }}</small>
            <span
              v-if="subject.tags.length"
              class="compare-rater__bangumi-tags"
            >
              <span
                v-for="tag in subject.tags"
                :key="`${subject.id}-${tag}`"
                :title="tag"
              >
                {{ tag }}
              </span>
            </span>
          </div>
          <button
            type="button"
            class="compare-rater__secondary-button"
            @click="setBangumiSubjectName('base', subject)"
          >
            设为基准
          </button>
          <button
            type="button"
            class="compare-rater__secondary-button"
            @click="setBangumiSubjectName('compare', subject)"
          >
            设为比较
          </button>
        </li>
      </ol>
      <div
        v-if="bangumiPageCount > 1"
        class="compare-rater__relation-pager"
      >
        <form
          class="compare-rater__relation-jump"
          @submit.prevent="jumpBangumiPage"
        >
          <span>跳转到</span>
          <input
            v-model="bangumiPageInput"
            type="number"
            min="1"
            :max="bangumiPageCount"
            step="1"
            aria-label="跳转 Bangumi 搜索页码"
            @blur="jumpBangumiPage"
          >
          <span>页</span>
          <button
            type="submit"
            class="compare-rater__secondary-button"
            :disabled="!canJumpBangumiPage || bangumiSearchStatus === 'loading'"
          >
            跳转
          </button>
        </form>
        <button
          type="button"
          class="compare-rater__secondary-button"
          :disabled="bangumiPage <= 1 || bangumiSearchStatus === 'loading'"
          @click="goBangumiPage(-1)"
        >
          上一页
        </button>
        <span>{{ bangumiPageText }}</span>
        <button
          type="button"
          class="compare-rater__secondary-button"
          :disabled="bangumiPage >= bangumiPageCount || bangumiSearchStatus === 'loading'"
          @click="goBangumiPage(1)"
        >
          下一页
        </button>
      </div>
    </details>
  </section>

  <section
    class="compare-rater__panel"
    aria-labelledby="compare-rater-graph-title"
  >
    <div class="compare-rater__label-row">
      <h2 id="compare-rater-graph-title">关系图</h2>
      <div
        v-if="animatedGraphItems.length"
        class="compare-rater__graph-actions"
      >
        <span>{{ graphZoomText }}</span>
        <button
          type="button"
          class="compare-rater__secondary-button"
          @click="resetGraphView"
        >
          重置视图
        </button>
      </div>
    </div>
    <div
      v-if="animatedGraphItems.length"
      ref="graphViewportRef"
      class="compare-rater__graph"
      :style="graphViewportStyle"
      role="img"
      :aria-label="`${workType} ${normalizedField}中${normalizedAspect}角度的作品关系图`"
      @wheel.prevent="handleGraphWheel"
      @pointerdown="startGraphDrag"
      @pointermove="moveGraphDrag"
      @pointerup="endGraphDrag"
      @pointercancel="endGraphDrag"
    >
      <div
        class="compare-rater__graph-scene"
        :style="graphSceneStyle"
        aria-hidden="true"
      >
        <svg
          class="compare-rater__edges"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="compare-rater-arrowhead"
              markerWidth="6"
              markerHeight="6"
              refX="5.2"
              refY="3"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path
                d="M0,0 L6,3 L0,6 Z"
                class="compare-rater__arrowhead"
              />
            </marker>
            <marker
              id="compare-rater-endpoint"
              markerWidth="5"
              markerHeight="5"
              refX="2.5"
              refY="2.5"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <circle
                cx="2.5"
                cy="2.5"
                r="2"
                class="compare-rater__endpoint"
              />
            </marker>
          </defs>
          <path
            v-for="edge in graphEdges"
            :key="`edge-${edge.id}`"
            class="compare-rater__edge"
            :class="{
              'compare-rater__edge--same': edge.relationLevel === 'same',
              'compare-rater__edge--better': edge.relationLevel === 'better' || edge.relationLevel === 'worse',
              'compare-rater__edge--quite': edge.relationLevel === 'quite-better' || edge.relationLevel === 'quite-worse',
              'compare-rater__edge--much': edge.relationLevel === 'much-better' || edge.relationLevel === 'much-worse',
            }"
            :d="edge.path"
            marker-start="url(#compare-rater-endpoint)"
            :marker-end="edge.hasArrow ? 'url(#compare-rater-arrowhead)' : 'url(#compare-rater-endpoint)'"
          />
        </svg>
        <div
          v-for="item in animatedGraphItems"
          :key="item.name"
          class="compare-rater__node"
          :style="{ left: `${item.x}%`, top: `${item.y}%` }"
          :title="`${item.name} / 相对 ${formatOffset(item.offset)}`"
        >
          <strong>{{ item.name }}</strong>
          <span>相对 {{ formatOffset(item.offset) }}</span>
        </div>
      </div>
    </div>
    <p
      v-else
      class="compare-rater__empty"
    >
      关系图会在录入关系后生成。
    </p>
  </section>

  <section
    class="compare-rater__panel"
    aria-labelledby="compare-rater-score-title"
  >
    <div class="compare-rater__label-row">
      <h2 id="compare-rater-score-title">分值映射</h2>
    </div>
    <h3 class="compare-rater__subheading">基准分值设定</h3>
    <div class="compare-rater__anchor-card compare-rater__anchor-card--range">
      <div class="compare-rater__anchor-summary">
        <div>
          <h3>相对最差</h3>
          <p
            class="compare-rater__anchor-name"
            :class="{ 'compare-rater__anchor-name--empty': !worstAnchorName }"
          >
            {{ worstAnchorName || "录入关系后自动选择" }}
          </p>
        </div>
        <div>
          <h3>相对最佳</h3>
          <p
            class="compare-rater__anchor-name"
            :class="{ 'compare-rater__anchor-name--empty': !bestAnchorName }"
          >
            {{ bestAnchorName || "录入关系后自动选择" }}
          </p>
        </div>
      </div>
      <div
        class="compare-rater__score-range"
        :style="anchorScoreRangeStyle"
      >
        <div class="compare-rater__score-range-labels">
          <span
            class="compare-rater__score-range-value compare-rater__score-range-value--worst"
            aria-hidden="true"
          >
            {{ formatScoreOption(worstAnchorScore) }}
          </span>
          <span
            class="compare-rater__score-range-value compare-rater__score-range-value--best"
            aria-hidden="true"
          >
            {{ formatScoreOption(bestAnchorScore) }}
          </span>
        </div>
        <input
          v-model="worstAnchorScore"
          type="range"
          :min="SCORE_MIN"
          :max="SCORE_MAX"
          :step="SCORE_STEP"
          aria-label="相对最差评分"
          @input="updateWorstAnchorScore"
        >
        <input
          v-model="bestAnchorScore"
          type="range"
          :min="SCORE_MIN"
          :max="SCORE_MAX"
          :step="SCORE_STEP"
          aria-label="相对最佳评分"
          @input="updateBestAnchorScore"
        >
      </div>
    </div>
    <div
      v-if="scoredItems.length"
      class="compare-rater__label-row compare-rater__score-heading"
    >
      <h3>最终得分</h3>
      <span>由关系图和绝对分值映射得到</span>
    </div>
    <div
      v-if="scoredItems.length"
      class="compare-rater__score-table"
    >
      <div class="compare-rater__score-head">
        <span>作品</span>
        <span>相对位置</span>
        <span>得分</span>
      </div>
      <div
        v-for="item in scoredItems"
        :key="`score-${item.name}`"
        class="compare-rater__score-row"
      >
        <span>{{ item.name }}</span>
        <span>{{ formatOffset(item.offset) }}</span>
        <strong>{{ formatScore(item.score) }}</strong>
      </div>
    </div>
  </section>
</div>

## 说明

### v1 算法

#### 相对位置求解

工具先把第 $i$ 个作品映射成一个一维相对位置 $x_i$，数值越大表示相对越好。

- $A \approx B$ 是等式吸引，目标是 $x_A - x_B = 0$。
- $A > B$、$A >> B$、$A >>> B$ 是方向约束，默认下限分别是 $0.5$、$1$、$2$：

$$
x_A - x_B \ge d
$$

- 如果差距不足，算法用较强的力把两点推开；如果差距已经满足，只用很弱的力把多余空隙拉回标称差距 $d$。这样“至少好很多”不会反向压缩已经被其它链条推出的更大差距。
- 同一个节点下同档关系会轻微对齐。例如 $A > B$ 和 $A > C$ 会尽量让 $B$、$C$ 接近同一高度，但仍保留其它关系造成的必要差异。
- 互相没有关系连接的节点组会分别求解；组与组之间没有可比较的相对高低，图上的横向摆放只用于展示。

关系图只用于展示：纵向来自相对位置，越上方越高；横向用于减少重叠和交叉。箭头从高分指向低分，`≈` 使用无箭头的吸引线。

#### 绝对评分映射

相对位置是核心结果。绝对评分映射只是一个扩展输出，用来把相对结果放进用户设定的评分区间，方便阅读和提交。

工具用“相对最佳”和“相对最差”的评分做线性映射。最终评分记为 $s_i$；其中 $x_{best}, s_{best}$ 表示相对最佳节点的相对位置和评分，$x_{worst}, s_{worst}$ 表示相对最差节点的相对位置和评分：

$$
s_i = s_{worst} + \frac{x_i - x_{worst}}{x_{best} - x_{worst}}(s_{best} - s_{worst})
$$

### 导出功能

“导出到剪贴板”保存的是用户输入表单，不保存当前算法算出的相对位置和分数。后续即使调整算法，也可以用同一份表单重新计算。

### 数据来源

快速搜索功能使用 [Bangumi](https://bgm.tv/) 提供的 API，在此表示感谢。

<style scoped>
.compare-rater {
  display: grid;
  gap: 14px;
  max-width: 860px;
  margin: 16px 0 24px;
}

.compare-rater__panel {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}

.compare-rater__relation-panel {
  gap: 8px;
}

.compare-rater h2,
.compare-rater h3 {
  margin: 0;
  border: 0;
  padding: 0;
}

.compare-rater h2 {
  font-size: 1rem;
}

.compare-rater h3 {
  font-size: 0.96rem;
}

.compare-rater__subheading {
  color: color-mix(in srgb, var(--vp-c-text-1) 82%, var(--vp-c-text-2) 18%);
}

.compare-rater__score-heading {
  margin-top: 4px;
}

.compare-rater label {
  display: grid;
  gap: 5px;
  min-width: 0;
  font-weight: 600;
}

.compare-rater__label-with-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.compare-rater__label-with-link a {
  font-size: 0.86rem;
  font-weight: 700;
}

.compare-rater input,
.compare-rater select {
  width: 100%;
  min-width: 0;
  min-height: 40px;
  padding: 9px 11px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg);
}

.compare-rater select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M2.5 4.5L6 8L9.5 4.5' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-position: right 0.8rem center;
  background-repeat: no-repeat;
  background-size: 0.75rem;
  cursor: pointer;
  padding-right: 2.5rem;
}

.compare-rater button {
  min-height: 38px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-weight: 600;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, color 0.2s ease, transform 0.2s ease, background-color 0.2s ease;
}

.compare-rater button:disabled {
  cursor: not-allowed;
  opacity: 0.56;
}

.compare-rater__label-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.compare-rater__label-row > span {
  color: color-mix(in srgb, var(--vp-c-text-1) 68%, var(--vp-c-text-2) 32%);
  font-size: 0.88rem;
  text-align: right;
}

.compare-rater__graph-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.compare-rater__graph-actions > span {
  color: color-mix(in srgb, var(--vp-c-text-1) 68%, var(--vp-c-text-2) 32%);
  font-size: 0.88rem;
  font-variant-numeric: tabular-nums;
}

.compare-rater__transfer-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.compare-rater__bangumi-search {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  align-items: end;
}

.compare-rater__bangumi-search label:last-child {
  grid-column: 1 / -1;
}

.compare-rater__bangumi-search label {
  gap: 3px;
  font-size: 0.9rem;
}

.compare-rater__bangumi-search input:not([type="checkbox"]) {
  min-height: 34px;
  padding-top: 6px;
  padding-bottom: 6px;
  border-radius: 8px;
}

.compare-rater label.compare-rater__checkbox-label {
  display: inline-flex;
  align-items: center;
  align-self: end;
  min-height: 34px;
  gap: 6px;
  padding: 6px 0;
  white-space: nowrap;
}

.compare-rater label.compare-rater__checkbox-label input {
  width: 16px;
  min-width: 16px;
  min-height: 16px;
  margin: 0;
}

.compare-rater__bangumi-results {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.compare-rater__bangumi-results li {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
  padding: 7px 8px;
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 90%, transparent);
  border-radius: 8px;
  background: var(--vp-c-bg);
}

.compare-rater__bangumi-cover {
  width: 72px;
  align-self: stretch;
  height: auto;
  min-height: 96px;
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  object-fit: cover;
}

.compare-rater__bangumi-info {
  display: grid;
  gap: 1px;
  align-content: center;
  align-self: stretch;
  min-width: 0;
}

.compare-rater__bangumi-title {
  display: block;
  min-width: 0;
  color: var(--vp-c-text-1);
  font-weight: 700;
}

.compare-rater__bangumi-results strong,
.compare-rater__bangumi-results span,
.compare-rater__bangumi-results small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compare-rater__bangumi-title strong {
  min-width: 0;
}

.compare-rater__bangumi-badge {
  width: fit-content;
  border: 1px solid color-mix(in srgb, #dc2626 45%, var(--vp-c-divider));
  border-radius: 999px;
  padding: 1px 6px;
  color: #dc2626;
  font-size: 0.72rem;
  font-weight: 700;
}

.compare-rater__bangumi-tags {
  display: flex;
  min-width: 0;
  gap: 4px;
}

.compare-rater__bangumi-tags > span {
  flex: none;
  max-width: 72px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 24%, var(--vp-c-divider));
  border-radius: 999px;
  padding: 1px 6px;
  background: color-mix(in srgb, var(--vp-c-brand-soft) 35%, var(--vp-c-bg));
  color: color-mix(in srgb, var(--vp-c-text-1) 72%, var(--vp-c-text-2) 28%);
}

.compare-rater__bangumi-results span,
.compare-rater__bangumi-results small,
.compare-rater__hint {
  color: color-mix(in srgb, var(--vp-c-text-1) 66%, var(--vp-c-text-2) 34%);
  font-size: 0.84rem;
}

.compare-rater__hint {
  margin: 0;
}

.compare-rater__scope-grid {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
}

.compare-rater__relation-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 170px minmax(0, 1fr) auto;
  gap: 6px;
  align-items: end;
}

.compare-rater__relation-form label {
  gap: 3px;
  font-size: 0.9rem;
}

.compare-rater__relation-form input,
.compare-rater__relation-form select {
  min-height: 34px;
  padding-top: 6px;
  padding-bottom: 6px;
  border-radius: 8px;
}

.compare-rater__relation-form button {
  min-height: 34px;
}

.compare-rater__aspect-description {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 28%, var(--vp-c-divider));
  border-radius: 10px;
  background: color-mix(in srgb, var(--vp-c-brand-soft) 58%, var(--vp-c-bg));
  color: color-mix(in srgb, var(--vp-c-text-1) 78%, var(--vp-c-text-2) 22%);
  font-size: 0.92rem;
  line-height: 1.65;
}

.compare-rater__primary-button,
.compare-rater__secondary-button {
  padding: 7px 12px;
}

.compare-rater__primary-button {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-1);
  color: var(--vp-c-white);
}

.compare-rater__relation-list {
  display: grid;
  gap: 0px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.compare-rater__relation-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
  padding: 5px 8px;
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 90%, transparent);
  border-radius: 6px;
  background: var(--vp-c-bg);
  font-size: 0.92rem;
  line-height: 1.35;
}

.compare-rater__relation-expression {
  color: color-mix(in srgb, var(--vp-c-text-1) 70%, var(--vp-c-text-2) 30%);
  font-size: 0.92rem;
}

.compare-rater__relation-symbol {
  font-weight: 800;
}

.compare-rater__relation-symbol--same {
  color: #16a34a;
}

.compare-rater__relation-symbol--better {
  color: #ca8a04;
}

.compare-rater__relation-symbol--quite {
  color: #ea580c;
}

.compare-rater__relation-symbol--much {
  color: #991b1b;
}

.compare-rater__relation-list button {
  min-height: 24px;
  padding: 2px 7px;
  color: var(--vp-c-danger-1);
  font-size: 0.84rem;
}

.compare-rater__relation-pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.compare-rater__relation-pager > span {
  color: color-mix(in srgb, var(--vp-c-text-1) 66%, var(--vp-c-text-2) 34%);
  font-size: 0.86rem;
  font-variant-numeric: tabular-nums;
}

.compare-rater__relation-pager button {
  min-height: 30px;
  padding: 4px 10px;
}

.compare-rater__relation-jump {
  display: grid;
  grid-template-columns: auto 64px auto auto;
  align-items: center;
  gap: 6px;
}

.compare-rater__relation-jump > span {
  color: color-mix(in srgb, var(--vp-c-text-1) 66%, var(--vp-c-text-2) 34%);
  font-size: 0.86rem;
}

.compare-rater__relation-jump input {
  min-height: 30px;
  padding: 4px 8px;
  border-radius: 8px;
  font-variant-numeric: tabular-nums;
}

.compare-rater__advanced {
  border-top: 1px solid var(--vp-c-divider);
  padding-top: 6px;
}

.compare-rater__advanced summary {
  width: fit-content;
  cursor: pointer;
  color: color-mix(in srgb, var(--vp-c-text-1) 72%, var(--vp-c-text-2) 28%);
  font-size: 0.9rem;
  font-weight: 700;
}

.compare-rater__weight-grid {
  display: grid;
  gap: 8px;
  margin-top: 8px;
}

.compare-rater__score-slider {
  grid-template-columns: 96px minmax(0, 1fr);
  align-items: end;
  gap: 8px;
}

.compare-rater__score-slider > span {
  padding-bottom: 7px;
  color: color-mix(in srgb, var(--vp-c-text-1) 72%, var(--vp-c-text-2) 28%);
  font-size: 0.9rem;
}

.compare-rater__weight-slider-control {
  --weight-value-pos: 0%;
  --weight-thumb-size: 16px;
  --weight-track-inset: calc(var(--weight-thumb-size) / 2);
  position: relative;
  height: 38px;
}

.compare-rater__weight-slider-labels {
  position: absolute;
  top: 0;
  right: var(--weight-track-inset);
  left: var(--weight-track-inset);
  height: 18px;
  pointer-events: none;
}

.compare-rater__weight-slider-labels > strong {
  position: absolute;
  top: 0;
  left: var(--weight-value-pos);
  min-width: 28px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-size: 0.76rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.35;
  text-align: center;
  transform: translateX(-50%);
}

.compare-rater__weight-slider-control > input {
  appearance: none;
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  width: 100%;
  min-height: 24px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  accent-color: var(--vp-c-brand-1);
  cursor: pointer;
}

.compare-rater__weight-slider-control > input:focus-visible {
  border: 0;
  box-shadow: none;
}

.compare-rater__weight-slider-control > input::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 999px;
  background: var(--vp-c-divider);
}

.compare-rater__weight-slider-control > input::-webkit-slider-thumb {
  appearance: none;
  width: var(--weight-thumb-size);
  height: var(--weight-thumb-size);
  margin-top: -5px;
  border: 0;
  border-radius: 999px;
  background: var(--vp-c-brand-1);
  box-shadow: 0 2px 8px rgb(15 23 42 / 0.18);
}

.compare-rater__weight-slider-control > input:focus-visible::-webkit-slider-thumb {
  box-shadow:
    0 0 0 4px color-mix(in srgb, var(--vp-c-brand-1) 18%, transparent),
    0 2px 8px rgb(15 23 42 / 0.18);
}

.compare-rater__weight-slider-control > input::-moz-range-track {
  height: 6px;
  border: 0;
  border-radius: 999px;
  background: var(--vp-c-divider);
}

.compare-rater__weight-slider-control > input::-moz-range-thumb {
  width: var(--weight-thumb-size);
  height: var(--weight-thumb-size);
  border: 0;
  border-radius: 999px;
  background: var(--vp-c-brand-1);
  box-shadow: 0 2px 8px rgb(15 23 42 / 0.18);
}

.compare-rater__weight-slider-control > input:focus-visible::-moz-range-thumb {
  box-shadow:
    0 0 0 4px color-mix(in srgb, var(--vp-c-brand-1) 18%, transparent),
    0 2px 8px rgb(15 23 42 / 0.18);
}

.compare-rater__empty {
  margin: 0;
  color: color-mix(in srgb, var(--vp-c-text-1) 70%, var(--vp-c-text-2) 30%);
  font-size: 0.92rem;
}

.compare-rater__error {
  margin: 0 0 4px;
  color: var(--vp-c-danger-1);
  font-size: 0.9rem;
}

.compare-rater__anchor-card {
  display: grid;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg);
}

.compare-rater__anchor-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.compare-rater__anchor-summary > div {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.compare-rater__anchor-name {
  margin: 0;
  min-height: 34px;
  padding: 8px 10px;
  overflow-wrap: anywhere;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-weight: 700;
  line-height: 1.45;
}

.compare-rater__anchor-name--empty {
  color: color-mix(in srgb, var(--vp-c-text-1) 54%, var(--vp-c-text-2) 46%);
  font-weight: 600;
}

.compare-rater__score-range {
  --score-range-start: 0%;
  --score-range-end: 100%;
  --score-thumb-size: 18px;
  --score-track-inset: calc(var(--score-thumb-size) / 2);
  --score-track-y: 27px;
  position: relative;
  height: 42px;
  border-radius: 999px;
  background:
    linear-gradient(
      90deg,
      transparent 0,
      transparent var(--score-range-start),
      color-mix(in srgb, var(--vp-c-brand-1) 72%, var(--vp-c-brand-soft)) var(--score-range-start),
      color-mix(in srgb, var(--vp-c-brand-1) 72%, var(--vp-c-brand-soft)) var(--score-range-end),
      transparent var(--score-range-end),
      transparent 100%
    ),
    linear-gradient(90deg, var(--vp-c-divider), var(--vp-c-divider));
  /* 下方 30px 是实际滑条区域，底条中心与原生手柄中心对齐。 */
  background-position: center var(--score-track-y);
  background-repeat: no-repeat;
  background-size: calc(100% - var(--score-thumb-size)) 8px;
}

.compare-rater__score-range-labels {
  position: absolute;
  z-index: 1;
  top: 0;
  right: var(--score-track-inset);
  left: var(--score-track-inset);
  height: 20px;
  pointer-events: none;
}

.compare-rater__score-range-value {
  position: absolute;
  top: 0;
  min-width: 32px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 1.35;
  text-align: center;
  transform: translateX(-50%);
}

.compare-rater__score-range-value--worst {
  left: var(--score-range-start);
}

.compare-rater__score-range-value--best {
  left: var(--score-range-end);
}

.compare-rater__score-range > input {
  appearance: none;
  position: absolute;
  top: 12px;
  right: 0;
  left: 0;
  width: 100%;
  height: 30px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  pointer-events: none;
}

.compare-rater__score-range > input:focus-visible {
  border: 0;
  box-shadow: none;
}

.compare-rater__score-range > input::-webkit-slider-runnable-track {
  height: 8px;
  background: transparent;
}

.compare-rater__score-range > input::-webkit-slider-thumb {
  appearance: none;
  width: var(--score-thumb-size);
  height: var(--score-thumb-size);
  margin-top: -5px;
  border: 0;
  border-radius: 999px;
  background: var(--vp-c-brand-1);
  box-shadow: 0 2px 8px rgb(15 23 42 / 0.2);
  cursor: pointer;
  pointer-events: auto;
}

.compare-rater__score-range > input:focus-visible::-webkit-slider-thumb {
  box-shadow:
    0 0 0 4px color-mix(in srgb, var(--vp-c-brand-1) 18%, transparent),
    0 2px 8px rgb(15 23 42 / 0.2);
}

.compare-rater__score-range > input::-moz-range-track {
  height: 8px;
  border: 0;
  background: transparent;
}

.compare-rater__score-range > input::-moz-range-thumb {
  width: var(--score-thumb-size);
  height: var(--score-thumb-size);
  border: 0;
  border-radius: 999px;
  background: var(--vp-c-brand-1);
  box-shadow: 0 2px 8px rgb(15 23 42 / 0.2);
  cursor: pointer;
  pointer-events: auto;
}

.compare-rater__score-range > input:focus-visible::-moz-range-thumb {
  box-shadow:
    0 0 0 4px color-mix(in srgb, var(--vp-c-brand-1) 18%, transparent),
    0 2px 8px rgb(15 23 42 / 0.2);
}

.compare-rater__graph {
  position: relative;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  user-select: none;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--vp-c-green-soft) 46%, transparent), transparent 42%, transparent 58%, color-mix(in srgb, var(--vp-c-danger-soft) 46%, transparent)),
    repeating-linear-gradient(180deg, transparent 0, transparent calc(20% - 1px), color-mix(in srgb, var(--vp-c-divider) 58%, transparent) calc(20% - 1px), color-mix(in srgb, var(--vp-c-divider) 58%, transparent) 20%);
}

.compare-rater__graph:active {
  cursor: grabbing;
}

.compare-rater__graph::before,
.compare-rater__graph::after {
  position: absolute;
  z-index: 4;
  top: 10px;
  color: color-mix(in srgb, var(--vp-c-text-1) 62%, var(--vp-c-text-2) 38%);
  font-size: 0.82rem;
  font-weight: 700;
}

.compare-rater__graph::before {
  left: 12px;
  content: "高";
}

.compare-rater__graph::after {
  right: 12px;
  bottom: 10px;
  top: auto;
  content: "低";
}

.compare-rater__graph-scene {
  position: absolute;
  inset: 0;
  transform-origin: 0 0;
  will-change: transform;
}

.compare-rater__edges {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

.compare-rater__edge {
  fill: none;
  stroke: #ca8a04;
  stroke-linecap: round;
  stroke-width: 0.8;
  vector-effect: non-scaling-stroke;
}

.compare-rater__edge--same {
  stroke: #16a34a;
}

.compare-rater__edge--better {
  stroke: #ca8a04;
}

.compare-rater__edge--quite {
  stroke: #ea580c;
  stroke-width: 1.1;
}

.compare-rater__edge--much {
  stroke: #991b1b;
  stroke-width: 1.45;
}

.compare-rater__arrowhead {
  fill: context-stroke;
}

.compare-rater__endpoint {
  fill: context-stroke;
}

.compare-rater__node {
  position: absolute;
  z-index: 5;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  align-items: center;
  gap: 1px;
  box-sizing: border-box;
  width: 13%;
  height: 7%;
  min-width: 78px;
  min-height: 34px;
  padding: 2px 4px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 42%, var(--vp-c-divider));
  border-radius: 8px;
  background: color-mix(in srgb, var(--vp-c-bg) 92%, var(--vp-c-brand-soft));
  box-shadow: 0 8px 18px rgb(15 23 42 / 0.07);
  text-align: center;
  transform: translate(-50%, -50%);
}

.compare-rater__node strong {
  font-size: 0.78rem;
  line-height: 1;
}

.compare-rater__node strong,
.compare-rater__node span {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compare-rater__node span {
  color: color-mix(in srgb, var(--vp-c-text-1) 66%, var(--vp-c-text-2) 34%);
  font-size: 0.66rem;
  line-height: 1;
}

.compare-rater__score-table {
  display: grid;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
}

.compare-rater__score-head,
.compare-rater__score-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 110px 80px;
  gap: 10px;
  align-items: center;
  padding: 9px 12px;
}

.compare-rater__score-head {
  background: var(--vp-c-bg);
  color: color-mix(in srgb, var(--vp-c-text-1) 70%, var(--vp-c-text-2) 30%);
  font-size: 0.88rem;
  font-weight: 700;
}

.compare-rater__score-row {
  border-top: 1px solid var(--vp-c-divider);
  background: color-mix(in srgb, var(--vp-c-bg) 72%, var(--vp-c-bg-soft));
}

.compare-rater__score-row > span:first-child {
  min-width: 0;
  overflow-wrap: anywhere;
}

.compare-rater__sr-only {
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

.compare-rater button:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 8px 20px rgb(15 23 42 / 0.06);
  color: var(--vp-c-brand-1);
  transform: translateY(-1px);
}

.compare-rater__primary-button:hover:not(:disabled) {
  color: var(--vp-c-white);
}

.compare-rater input:not([type="range"]):focus-visible,
.compare-rater select:focus-visible,
.compare-rater button:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 52%, var(--vp-c-divider));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--vp-c-brand-1) 16%, transparent);
}

@media (max-width: 760px) {
  .compare-rater__label-row,
  .compare-rater__scope-grid,
  .compare-rater__bangumi-search,
  .compare-rater__relation-form {
    grid-template-columns: 1fr;
  }

  .compare-rater__label-row {
    display: grid;
    gap: 4px;
  }

  .compare-rater__label-row > span {
    text-align: left;
  }

  .compare-rater__graph-actions {
    justify-content: stretch;
  }

  .compare-rater__bangumi-results li {
    grid-template-columns: 58px minmax(0, 1fr);
  }

  .compare-rater__bangumi-cover {
    width: 58px;
    min-height: 82px;
  }

  .compare-rater__relation-pager {
    display: grid;
    grid-template-columns: 1fr;
  }

  .compare-rater__relation-jump {
    grid-template-columns: auto minmax(0, 1fr) auto auto;
  }

  .compare-rater__transfer-actions {
    display: grid;
    grid-template-columns: 1fr;
  }

  .compare-rater__graph-actions > span {
    text-align: left;
  }

  .compare-rater__primary-button,
  .compare-rater__secondary-button {
    width: 100%;
  }

  .compare-rater__score-head,
  .compare-rater__score-row {
    grid-template-columns: minmax(0, 1fr) 88px 64px;
    gap: 8px;
    padding: 8px 10px;
  }
}
</style>
