---
publish: false
published: 2026-05-13T18:30:00+08:00
---

# 番剧关系评分图

<!-- autocorrect-disable -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
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
  type AnimeItem,
  type GraphEdge,
  type RelationLevel,
  type RelationRecord,
} from "./core";

type AnchorRole = "best" | "worst";
type TransferStatus = "idle" | "success" | "error";

interface AnimatedAnimeItem extends AnimeItem {
  targetX: number;
  targetY: number;
  velocityX: number;
  velocityY: number;
}

interface AspectOption {
  label: string;
  description: string;
}

interface ScoredAnime extends AnimeItem {
  score: number;
}

const relationLevels = [
  { value: "much-better", label: "好很多", symbol: ">>", delta: 2 },
  { value: "better", label: "好一点", symbol: ">", delta: 1 },
  { value: "same", label: "差不多", symbol: "≈", delta: 0 },
  { value: "worse", label: "差一点", symbol: "<", delta: -1 },
  { value: "much-worse", label: "差很多", symbol: "<<", delta: -2 },
] as const satisfies readonly { value: RelationLevel; label: string; symbol: string; delta: number }[];

const scoreLabels = new Map([
  ["1", "1 极差"],
  ["2", "2 差"],
  ["3", "3 合格"],
  ["4", "4 推荐"],
  ["5", "5 神作"],
]);

const animeTypeOptions = [
  "无细分",
  "科幻",
  "喜剧",
  "同人",
  "百合",
  "校园",
  "惊悚",
  "后宫",
  "机战",
  "悬疑",
  "恋爱",
  "奇幻",
  "推理",
  "运动",
  "耽美",
  "音乐",
  "战斗",
  "冒险",
  "萌系",
  "穿越",
  "玄幻",
  "乙女",
  "恐怖",
  "历史",
  "日常",
  "剧情",
  "武侠",
  "美食",
  "职场",
] as const;

const aspectOptions = [
  {
    label: "剧情&叙事",
    description: "作品的故事骨架。涵盖逻辑自洽、节奏把控、结构完整度、伏笔回收与信息密度。这是“讲什么”和“怎么讲”的核心。",
  },
  {
    label: "角色&演绎",
    description: "人物的灵魂与声音。涵盖角色塑造的立体度、成长弧光、行为合理性，以及声优的演技贴合度与情感爆发力。声优在此维度内，因为声音是让角色活起来的最后一环。",
  },
  {
    label: "画面&美术",
    description: "视觉的第一冲击力。涵盖作画稳定与流畅度、美术风格与光影氛围、角色道具设计感、摄影及特效与 CGI 的融合水准。",
  },
  {
    label: "音乐&音效",
    description: "听觉的沉浸网。涵盖背景音乐的情绪烘托、旋律记忆点、环境音效的真实感与爽感、主题曲与作品的契合度。",
  },
  {
    label: "演出&导演",
    description: "将剧本转化为影像的魔法。涵盖分镜构图的叙事效率、剪辑转场的节奏、氛围情绪的视觉营造、名场面的镜头冲击力。这是区别于漫画的动画独有维度。",
  },
  {
    label: "思想&设定",
    description: "作品的长尾余韵。涵盖世界观的独创性与自洽性、核心主题的探讨深度、人文关怀与现实映射，以及对观众留下的思考后劲。",
  },
] as const satisfies readonly AspectOption[];

const GRAPH_SPRING_STIFFNESS = 0.13;
const GRAPH_SPRING_DAMPING = 0.74;
const GRAPH_SETTLE_EPSILON = 0.025;
const GRAPH_MIN_ZOOM = 0.65;
const GRAPH_MAX_ZOOM = 2.8;

const fieldText = ref<(typeof animeTypeOptions)[number]>("萌系");
const aspectText = ref<(typeof aspectOptions)[number]["label"]>("剧情&叙事");
const baseName = ref("");
const compareName = ref("");
const selectedLevel = ref<RelationLevel>("same");
const relationRecords = ref<RelationRecord[]>([]);
const nextRelationId = ref(1);
const bestAnchorName = ref("");
const bestAnchorScore = ref("5");
const worstAnchorName = ref("");
const worstAnchorScore = ref("1");
const announcement = ref("");
const exportStatus = ref<TransferStatus>("idle");
const importStatus = ref<TransferStatus>("idle");
const animatedGraphItems = ref<AnimatedAnimeItem[]>([]);
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
let graphAnimationFrame: number | undefined;

const normalizedField = computed(() => normalizeName(fieldText.value) || "未命名领域");
const normalizedAspect = computed(() => normalizeName(aspectText.value) || "未命名角度");
const selectedAspectOption = computed(() => aspectOptions.find((option) => option.label === aspectText.value) ?? aspectOptions[0]);
const selectedLevelMeta = computed(() => relationLevels.find((level) => level.value === selectedLevel.value) ?? relationLevels[2]);
const hasRelations = computed(() => relationRecords.value.length > 0);

const graphItems = computed<AnimeItem[]>(() => buildGraphItems(relationRecords.value));

const scoreAnchors = computed(() => ({
  best: bestAnchorName.value ? { name: bestAnchorName.value, score: Number(bestAnchorScore.value) } : undefined,
  worst: worstAnchorName.value ? { name: worstAnchorName.value, score: Number(worstAnchorScore.value) } : undefined,
}));
const scoreByName = computed(() => mapScores(graphItems.value, scoreAnchors.value));

const scoredItems = computed<ScoredAnime[]>(() => {
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
    .filter((item): item is ScoredAnime => item.score !== undefined)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return right.offset - left.offset;
    });
});

const graphEdges = computed<GraphEdge[]>(() => buildGraphEdges(relationRecords.value, animatedGraphItems.value, scoreByName.value));

const bestCandidate = computed(() => findRelativeCandidate("best"));
const worstCandidate = computed(() => findRelativeCandidate("worst"));
const relationSummary = computed(() => `${relationRecords.value.length} 条关系，${graphItems.value.length} 部番剧`);
const graphSceneStyle = computed(() => ({
  transform: `translate(${graphPanX.value}px, ${graphPanY.value}px) scale(${graphZoom.value})`,
}));
const graphViewportStyle = computed(() => ({
  minHeight: `${getGraphViewportHeight(graphItems.value)}px`,
}));
const graphZoomText = computed(() => `${Math.round(graphZoom.value * 100)}%`);
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
const currentRelationPairKey = computed(() => createRelationPairKey(baseName.value, compareName.value));
const duplicatedRelation = computed(() => {
  const pairKey = currentRelationPairKey.value;
  if (!pairKey) {
    return undefined;
  }
  return relationRecords.value.find((record) => createRelationPairKey(record.baseName, record.targetName) === pairKey);
});
const relationInputError = computed(() => {
  const normalizedBase = normalizeName(baseName.value);
  const normalizedTarget = normalizeName(compareName.value);
  if (!normalizedBase || !normalizedTarget) {
    return undefined;
  }
  if (normalizedBase === normalizedTarget) {
    return "基准番和比较番不能相同。";
  }
  if (duplicatedRelation.value) {
    return `这两部番已经有关系：${formatRelationText(duplicatedRelation.value)}。`;
  }
  return undefined;
});
const canAddRelation = computed(() => normalizeName(baseName.value) !== "" && normalizeName(compareName.value) !== "" && !relationInputError.value);

watch(graphItems, (items) => {
  syncAnimatedGraphItems(items);
  syncAnchors();
}, { immediate: true });

onBeforeUnmount(() => {
  if (exportStatusTimer) {
    clearTimeout(exportStatusTimer);
  }
  if (importStatusTimer) {
    clearTimeout(importStatusTimer);
  }
  if (graphAnimationFrame !== undefined && typeof window !== "undefined") {
    window.cancelAnimationFrame(graphAnimationFrame);
  }
});

function relationLabel(level: RelationLevel) {
  return relationLevels.find((item) => item.value === level)?.label ?? "差不多";
}

function relationSymbol(level: RelationLevel) {
  return relationLevels.find((item) => item.value === level)?.symbol ?? "≈";
}

function relationSymbolClass(level: RelationLevel) {
  return {
    "anime-score-tool__relation-symbol--same": level === "same",
    "anime-score-tool__relation-symbol--strong": level === "much-better" || level === "much-worse",
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

function addRelation() {
  const normalizedBase = normalizeName(baseName.value);
  const normalizedTarget = normalizeName(compareName.value);
  if (!normalizedBase || !normalizedTarget) {
    announcement.value = "请先填写基准番和比较番。";
    return;
  }

  if (normalizedBase === normalizedTarget) {
    announcement.value = "基准番和比较番不能相同。";
    return;
  }

  if (duplicatedRelation.value) {
    announcement.value = `不能重复添加同一对番剧的关系：${formatRelationText(duplicatedRelation.value)}。`;
    return;
  }

  const level = selectedLevelMeta.value;
  const record = {
    id: nextRelationId.value,
    baseName: normalizedBase,
    targetName: normalizedTarget,
    level: level.value,
    delta: level.delta,
  } satisfies RelationRecord;
  relationRecords.value.push(record);
  nextRelationId.value += 1;
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
  relationRecords.value = [];
  nextRelationId.value = 1;
  resetGraphViewAfterRelationChange();
  announcement.value = "已清空关系。";
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

function syncAnimatedGraphItems(items: readonly AnimeItem[]) {
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
  return normalizedScore ? (scoreLabels.get(normalizedScore) ?? normalizedScore) : value;
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
    schema: "anime-score-graph-form",
    schemaVersion: 1,
    field: normalizedField.value,
    aspect: normalizedAspect.value,
    relations: relationRecords.value.map((record) => ({
      base: record.baseName,
      target: record.targetName,
      relation: record.level,
      delta: record.delta,
    })),
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
    || payload.schema !== "anime-score-graph-form"
    || payload.schemaVersion !== 1
    || typeof payload.field !== "string"
    || typeof payload.aspect !== "string"
    || !Array.isArray(payload.relations)
    || !isRecord(payload.anchors)
  ) {
    throw new Error("Unsupported payload");
  }

  if (!animeTypeOptions.includes(payload.field as (typeof animeTypeOptions)[number])) {
    throw new Error("Invalid field");
  }
  fieldText.value = payload.field as (typeof animeTypeOptions)[number];

  const importedAspect = aspectOptions.find((option) => option.label === payload.aspect);
  if (!importedAspect) {
    throw new Error("Invalid aspect");
  }
  aspectText.value = importedAspect.label;

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

    const level = relationLevels.find((item) => item.value === relation.relation) ?? relationLevels[2];
    if (relation.delta !== level.delta) {
      throw new Error("Invalid relation delta");
    }
    pairKeys.add(pairKey);
    importedRelations.push({
      id: importedRelations.length + 1,
      baseName: normalizedBase,
      targetName: normalizedTarget,
      level: level.value,
      delta: level.delta,
    });
  }

  relationRecords.value = importedRelations;
  nextRelationId.value = importedRelations.length + 1;
  importAnchors(payload.anchors, new Set(importedRelations.flatMap((relation) => [relation.baseName, relation.targetName])));
  syncAnchors();
  return importedRelations.length;
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
  if (!Number.isFinite(score) || score < 1 || score > 5 || Math.abs(score * 10 - Math.round(score * 10)) > 0.001) {
    return undefined;
  }
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

function syncAnchorScoreOrder() {
  if (Number(bestAnchorScore.value) < Number(worstAnchorScore.value)) {
    bestAnchorScore.value = worstAnchorScore.value;
  }
}

function isRelationLevel(value: unknown): value is RelationLevel {
  return typeof value === "string" && relationLevels.some((item) => item.value === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
<!-- autocorrect-enable -->

在同一细分领域、同一评价角度下录入相对比较，工具会按弹簧模型建立关系图，并把少量基准分映射成 1-5 分。

<div class="anime-score-tool">
  <p
    class="anime-score-tool__sr-only"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    {{ announcement }}
  </p>
  <section
    class="anime-score-tool__panel"
    aria-labelledby="anime-score-scope-title"
  >
    <div class="anime-score-tool__label-row">
      <h2 id="anime-score-scope-title">评分范围</h2>
      <span>{{ normalizedField }} / {{ normalizedAspect }}</span>
    </div>
    <div class="anime-score-tool__scope-grid">
      <label>
        <span>细分领域</span>
        <select v-model="fieldText">
          <option
            v-for="option in animeTypeOptions"
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
            v-for="option in aspectOptions"
            :key="option.label"
            :value="option.label"
          >
            {{ option.label }}
          </option>
        </select>
      </label>
    </div>
    <p class="anime-score-tool__aspect-description">
      {{ selectedAspectOption.description }}
    </p>
  </section>

  <section
    class="anime-score-tool__panel"
    aria-labelledby="anime-score-relation-title"
  >
    <div class="anime-score-tool__label-row">
      <h2 id="anime-score-relation-title">录入关系</h2>
      <span>{{ relationSummary }}</span>
    </div>
    <form
      class="anime-score-tool__relation-form"
      @submit.prevent="addRelation"
    >
      <label>
        <span>基准番</span>
        <input
          v-model="baseName"
          required
          autocomplete="off"
          placeholder="选择或输入基准番"
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
        <span>比较番</span>
        <input
          v-model="compareName"
          required
          autocomplete="off"
          placeholder="选择或输入比较番"
        >
      </label>
      <button
        type="submit"
        class="anime-score-tool__primary-button"
        :disabled="!canAddRelation"
      >
        加入关系
      </button>
    </form>
    <p
      v-if="relationInputError"
      class="anime-score-tool__error"
    >
      {{ relationInputError }}
    </p>
    <ol
      v-if="hasRelations"
      class="anime-score-tool__relation-list"
    >
      <li
        v-for="record in relationRecords"
        :key="record.id"
      >
        <span>
          <template v-if="record.level === 'same'">
            {{ record.baseName }} 与 {{ record.targetName }} 差不多
          </template>
          <template v-else>
            {{ record.baseName }} 比 {{ record.targetName }} {{ relationLabel(record.level) }}
          </template>
          <span class="anime-score-tool__relation-expression">
            （{{ record.baseName }}
            <strong
              class="anime-score-tool__relation-symbol"
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
    <p
      v-else
      class="anime-score-tool__empty"
    >
      先录入至少一条关系。
    </p>
    <button
      v-if="hasRelations"
      type="button"
      class="anime-score-tool__secondary-button"
      @click="clearRelations"
    >
      清空关系
    </button>
  </section>

  <section
    class="anime-score-tool__panel"
    aria-labelledby="anime-score-graph-title"
  >
    <div class="anime-score-tool__label-row">
      <h2 id="anime-score-graph-title">关系图</h2>
      <div class="anime-score-tool__graph-actions">
        <span v-if="animatedGraphItems.length">{{ graphZoomText }}</span>
        <button
          v-if="animatedGraphItems.length"
          type="button"
          class="anime-score-tool__secondary-button"
          @click="resetGraphView"
        >
          重置视图
        </button>
        <button
          type="button"
          class="anime-score-tool__secondary-button"
          @click="importFromClipboard"
        >
          {{ importButtonText }}
        </button>
        <button
          type="button"
          class="anime-score-tool__secondary-button"
          :disabled="!scoredItems.length"
          @click="copyExportJson"
        >
          {{ exportButtonText }}
        </button>
      </div>
    </div>
    <div
      v-if="animatedGraphItems.length"
      ref="graphViewportRef"
      class="anime-score-tool__graph"
      :style="graphViewportStyle"
      role="img"
      :aria-label="`${normalizedField}中${normalizedAspect}角度的番剧关系图`"
      @wheel.prevent="handleGraphWheel"
      @pointerdown="startGraphDrag"
      @pointermove="moveGraphDrag"
      @pointerup="endGraphDrag"
      @pointercancel="endGraphDrag"
    >
      <div
        class="anime-score-tool__graph-scene"
        :style="graphSceneStyle"
      >
        <svg
          class="anime-score-tool__edges"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="anime-score-arrowhead"
              markerWidth="6"
              markerHeight="6"
              refX="5.2"
              refY="3"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path
                d="M0,0 L6,3 L0,6 Z"
                class="anime-score-tool__arrowhead"
              />
            </marker>
          </defs>
          <path
            v-for="edge in graphEdges"
            :key="`edge-${edge.id}`"
            class="anime-score-tool__edge"
            :class="{
              'anime-score-tool__edge--same': edge.relationLevel === 'same',
              'anime-score-tool__edge--strong': edge.relationLevel === 'much-better' || edge.relationLevel === 'much-worse',
            }"
            :d="edge.path"
            :marker-end="edge.hasArrow ? 'url(#anime-score-arrowhead)' : undefined"
          />
        </svg>
        <div
          v-for="item in animatedGraphItems"
          :key="item.name"
          class="anime-score-tool__node"
          :style="{ left: `${item.x}%`, top: `${item.y}%` }"
        >
          <strong>{{ item.name }}</strong>
          <span>相对 {{ formatOffset(item.offset) }}</span>
        </div>
      </div>
    </div>
    <p
      v-else
      class="anime-score-tool__empty"
    >
      关系图会在录入关系后生成。
    </p>
    <div class="anime-score-tool__label-row">
      <h3>绝对分值</h3>
      <span>自动选择当前相对最高和最低</span>
    </div>
    <div class="anime-score-tool__anchor-grid">
      <div class="anime-score-tool__anchor-card">
        <div class="anime-score-tool__anchor-head">
          <h3>最好番</h3>
        </div>
        <p class="anime-score-tool__anchor-name">
          {{ bestAnchorName || "录入关系后自动选择" }}
        </p>
        <label class="anime-score-tool__score-slider">
          <span>评分</span>
          <input
            v-model="bestAnchorScore"
            type="range"
            min="1"
            max="5"
            step="0.1"
            aria-label="最好番评分"
            @input="updateBestAnchorScore"
          >
          <strong>{{ formatScoreOption(bestAnchorScore) }}</strong>
        </label>
      </div>
      <div class="anime-score-tool__anchor-card">
        <div class="anime-score-tool__anchor-head">
          <h3>最差番</h3>
        </div>
        <p class="anime-score-tool__anchor-name">
          {{ worstAnchorName || "录入关系后自动选择" }}
        </p>
        <label class="anime-score-tool__score-slider">
          <span>评分</span>
          <input
            v-model="worstAnchorScore"
            type="range"
            min="1"
            max="5"
            step="0.1"
            aria-label="最差番评分"
            @input="updateWorstAnchorScore"
          >
          <strong>{{ formatScoreOption(worstAnchorScore) }}</strong>
        </label>
      </div>
    </div>
    <div
      v-if="scoredItems.length"
      class="anime-score-tool__label-row"
    >
      <h3>最终得分</h3>
      <span>由关系图和绝对分值映射得到</span>
    </div>
    <div
      v-if="scoredItems.length"
      class="anime-score-tool__score-table"
    >
      <div class="anime-score-tool__score-head">
        <span>番剧</span>
        <span>相对位置</span>
        <span>得分</span>
      </div>
      <div
        v-for="item in scoredItems"
        :key="`score-${item.name}`"
        class="anime-score-tool__score-row"
      >
        <span>{{ item.name }}</span>
        <span>{{ formatOffset(item.offset) }}</span>
        <strong>{{ formatScore(item.score) }}</strong>
      </div>
    </div>
  </section>
</div>

## 说明

- “导出到剪贴板”保存的是用户输入表单，不保存当前算法算出的相对位置和分数。后续接入服务器后，可以用新版算法重新计算并聚合结果。

<style scoped>
.anime-score-tool {
  display: grid;
  gap: 14px;
  max-width: 860px;
  margin: 16px 0 24px;
}

.anime-score-tool__panel {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}

.anime-score-tool h2,
.anime-score-tool h3 {
  margin: 0;
  border: 0;
  padding: 0;
}

.anime-score-tool h2 {
  font-size: 1rem;
}

.anime-score-tool h3 {
  font-size: 0.96rem;
}

.anime-score-tool label {
  display: grid;
  gap: 5px;
  min-width: 0;
  font-weight: 600;
}

.anime-score-tool input,
.anime-score-tool select {
  width: 100%;
  min-width: 0;
  min-height: 40px;
  padding: 9px 11px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg);
}

.anime-score-tool select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M2.5 4.5L6 8L9.5 4.5' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-position: right 0.8rem center;
  background-repeat: no-repeat;
  background-size: 0.75rem;
  cursor: pointer;
  padding-right: 2.5rem;
}

.anime-score-tool button {
  min-height: 38px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-weight: 600;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, color 0.2s ease, transform 0.2s ease, background-color 0.2s ease;
}

.anime-score-tool button:disabled {
  cursor: not-allowed;
  opacity: 0.56;
}

.anime-score-tool__label-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.anime-score-tool__label-row > span {
  color: color-mix(in srgb, var(--vp-c-text-1) 68%, var(--vp-c-text-2) 32%);
  font-size: 0.88rem;
  text-align: right;
}

.anime-score-tool__graph-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.anime-score-tool__graph-actions > span {
  color: color-mix(in srgb, var(--vp-c-text-1) 68%, var(--vp-c-text-2) 32%);
  font-size: 0.88rem;
  font-variant-numeric: tabular-nums;
}

.anime-score-tool__scope-grid,
.anime-score-tool__anchor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.anime-score-tool__relation-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 170px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: end;
}

.anime-score-tool__aspect-description {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 28%, var(--vp-c-divider));
  border-radius: 10px;
  background: color-mix(in srgb, var(--vp-c-brand-soft) 58%, var(--vp-c-bg));
  color: color-mix(in srgb, var(--vp-c-text-1) 78%, var(--vp-c-text-2) 22%);
  font-size: 0.92rem;
  line-height: 1.65;
}

.anime-score-tool__primary-button,
.anime-score-tool__secondary-button {
  padding: 8px 14px;
}

.anime-score-tool__primary-button {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-1);
  color: var(--vp-c-white);
}

.anime-score-tool__relation-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.anime-score-tool__relation-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 90%, transparent);
  border-radius: 10px;
  background: var(--vp-c-bg);
}

.anime-score-tool__relation-expression {
  color: color-mix(in srgb, var(--vp-c-text-1) 70%, var(--vp-c-text-2) 30%);
}

.anime-score-tool__relation-symbol {
  color: #ea580c;
  font-weight: 800;
}

.anime-score-tool__relation-symbol--same {
  color: #16a34a;
}

.anime-score-tool__relation-symbol--strong {
  color: #991b1b;
}

.anime-score-tool__relation-list button {
  min-height: 32px;
  padding: 5px 10px;
  color: var(--vp-c-danger-1);
}

.anime-score-tool__empty {
  margin: 0;
  color: color-mix(in srgb, var(--vp-c-text-1) 70%, var(--vp-c-text-2) 30%);
}

.anime-score-tool__error {
  margin: 0;
  color: var(--vp-c-danger-1);
  font-size: 0.92rem;
}

.anime-score-tool__anchor-card {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg);
}

.anime-score-tool__anchor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.anime-score-tool__anchor-head button {
  min-height: 32px;
  padding: 5px 10px;
  font-size: 0.86rem;
}

.anime-score-tool__anchor-name {
  margin: 0;
  min-height: 38px;
  padding: 8px 10px;
  overflow-wrap: anywhere;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-weight: 700;
  line-height: 1.45;
}

.anime-score-tool__score-slider {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.anime-score-tool__score-slider > span {
  color: color-mix(in srgb, var(--vp-c-text-1) 72%, var(--vp-c-text-2) 28%);
  font-size: 0.9rem;
}

.anime-score-tool__score-slider > input {
  width: 100%;
  min-height: 28px;
  padding: 0;
  accent-color: var(--vp-c-brand-1);
  cursor: pointer;
}

.anime-score-tool__score-slider > strong {
  min-width: 58px;
  color: var(--vp-c-text-1);
  font-size: 0.92rem;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.anime-score-tool__graph {
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

.anime-score-tool__graph:active {
  cursor: grabbing;
}

.anime-score-tool__graph::before,
.anime-score-tool__graph::after {
  position: absolute;
  z-index: 4;
  top: 10px;
  color: color-mix(in srgb, var(--vp-c-text-1) 62%, var(--vp-c-text-2) 38%);
  font-size: 0.82rem;
  font-weight: 700;
}

.anime-score-tool__graph::before {
  left: 12px;
  content: "高";
}

.anime-score-tool__graph::after {
  right: 12px;
  bottom: 10px;
  top: auto;
  content: "低";
}

.anime-score-tool__graph-scene {
  position: absolute;
  inset: 0;
  transform-origin: 0 0;
  will-change: transform;
}

.anime-score-tool__edges {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

.anime-score-tool__edge {
  fill: none;
  stroke: #ea580c;
  stroke-linecap: round;
  stroke-width: 0.8;
  vector-effect: non-scaling-stroke;
}

.anime-score-tool__edge--same {
  stroke: #16a34a;
}

.anime-score-tool__edge--strong {
  stroke: #991b1b;
  stroke-width: 1.45;
}

.anime-score-tool__arrowhead {
  fill: context-stroke;
}

.anime-score-tool__node {
  position: absolute;
  z-index: 5;
  display: grid;
  gap: 2px;
  max-width: 132px;
  min-width: 88px;
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 42%, var(--vp-c-divider));
  border-radius: 8px;
  background: color-mix(in srgb, var(--vp-c-bg) 92%, var(--vp-c-brand-soft));
  box-shadow: 0 8px 18px rgb(15 23 42 / 0.07);
  text-align: center;
  transform: translate(-50%, -50%);
}

.anime-score-tool__node strong {
  font-size: 0.9rem;
  line-height: 1.35;
}

.anime-score-tool__node strong,
.anime-score-tool__node span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.anime-score-tool__node span {
  color: color-mix(in srgb, var(--vp-c-text-1) 66%, var(--vp-c-text-2) 34%);
  font-size: 0.76rem;
}

.anime-score-tool__score-table {
  display: grid;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
}

.anime-score-tool__score-head,
.anime-score-tool__score-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 110px 80px;
  gap: 10px;
  align-items: center;
  padding: 9px 12px;
}

.anime-score-tool__score-head {
  background: var(--vp-c-bg);
  color: color-mix(in srgb, var(--vp-c-text-1) 70%, var(--vp-c-text-2) 30%);
  font-size: 0.88rem;
  font-weight: 700;
}

.anime-score-tool__score-row {
  border-top: 1px solid var(--vp-c-divider);
  background: color-mix(in srgb, var(--vp-c-bg) 72%, var(--vp-c-bg-soft));
}

.anime-score-tool__score-row > span:first-child {
  min-width: 0;
  overflow-wrap: anywhere;
}

.anime-score-tool__sr-only {
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

.anime-score-tool button:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 8px 20px rgb(15 23 42 / 0.06);
  color: var(--vp-c-brand-1);
  transform: translateY(-1px);
}

.anime-score-tool__primary-button:hover:not(:disabled) {
  color: var(--vp-c-white);
}

.anime-score-tool input:focus-visible,
.anime-score-tool select:focus-visible,
.anime-score-tool button:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 52%, var(--vp-c-divider));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--vp-c-brand-1) 16%, transparent);
}

@media (max-width: 760px) {
  .anime-score-tool__label-row,
  .anime-score-tool__scope-grid,
  .anime-score-tool__anchor-grid,
  .anime-score-tool__relation-form {
    grid-template-columns: 1fr;
  }

  .anime-score-tool__label-row {
    display: grid;
    gap: 4px;
  }

  .anime-score-tool__label-row > span {
    text-align: left;
  }

  .anime-score-tool__graph-actions {
    justify-content: stretch;
  }

  .anime-score-tool__graph-actions > span {
    text-align: left;
  }

  .anime-score-tool__primary-button,
  .anime-score-tool__secondary-button {
    width: 100%;
  }

  .anime-score-tool__node {
    max-width: 130px;
    min-width: 96px;
  }

  .anime-score-tool__score-head,
  .anime-score-tool__score-row {
    grid-template-columns: minmax(0, 1fr) 88px 64px;
    gap: 8px;
    padding: 8px 10px;
  }
}
</style>
