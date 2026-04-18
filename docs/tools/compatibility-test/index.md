---
publish: false
published: 2026-04-18T15:30:00+08:00
---

# 兼容性问题排查器

<!-- autocorrect-disable -->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

import {
  applyCompatibilityTestAnswer,
  createCompatibilityTestState,
  getCurrentCompatibilityTestStep,
  intersectTargetRanges,
  skipCachedCompatibilityTestSteps,
  subtractTargetRanges,
  takeTargetsFromRanges,
  type CompatibilityTestState,
  type CompatibilityTestStep,
  type TargetRange,
} from "./compatibility-test";

type TestStatus = "idle" | "testing" | "complete";
type TestResult = "issue" | "pass";
type InputMode = "bulk" | "list";

interface TargetRow {
  id: string;
  index: number;
}

interface TestRecord {
  id: number;
  result: TestResult;
  targetRanges: TargetRange[];
}

const TARGET_PREVIEW_COUNT = 5;
const TARGET_PREVIEW_LIMIT = 8;

const targetCountText = ref("5");
const targetNames = ref<string[]>([]);
const inputMode = ref<InputMode>("list");
const status = ref<TestStatus>("idle");
const currentRoundCount = ref(0);
const incompatibleTargets = ref<number[]>([]);
const testHistory = ref<TestRecord[]>([]);
const announcement = ref("");
const diffModeEnabled = ref(false);
const nextRecordId = ref(1);
const testingPromptRef = ref<HTMLElement>();
const resultCardRef = ref<HTMLElement>();
const targetListExpanded = ref(false);
const engineState = ref<CompatibilityTestState>();
const currentStep = ref<CompatibilityTestStep>();

const parsedTargetCount = computed(() => parseTargetCount(targetCountText.value));
const targetCount = computed(() => parsedTargetCount.value);
const targetCountError = computed(() => {
  const normalizedValue = targetCountText.value.trim();
  if (normalizedValue === "") {
    return "请输入大于 0 的整数";
  }

  if (parsedTargetCount.value === undefined) {
    return "请输入大于 0 的整数";
  }

  return undefined;
});
const isTargetListCollapsed = computed(() => (
  inputMode.value === "list" && (targetCount.value ?? 0) > TARGET_PREVIEW_COUNT && !targetListExpanded.value
));
const hiddenTargetCount = computed(() => {
  const count = targetCount.value ?? 0;
  return isTargetListCollapsed.value ? Math.max(count - TARGET_PREVIEW_COUNT, 0) : 0;
});
const visibleTargetRange = computed(() => {
  const count = targetCount.value ?? 0;
  if (count === 0) {
    return { start: 0, end: 0 };
  }

  if (isTargetListCollapsed.value) {
    return {
      start: 1,
      end: Math.min(TARGET_PREVIEW_COUNT, count),
    };
  }

  return {
    start: 1,
    end: count,
  };
});
const visibleTargetRows = computed<TargetRow[]>(() => {
  const { start, end } = visibleTargetRange.value;
  return Array.from({ length: Math.max(end - start + 1, 0) }, (_, index) => {
    const targetIndex = start + index;
    return {
      id: `compat-test-target-${targetIndex}`,
      index: targetIndex,
    };
  });
});
const targetListStatusText = computed(() => {
  if (isTargetListCollapsed.value) {
    return `已折叠 ${hiddenTargetCount.value} 个`;
  }

  return "";
});
const bulkImportDescription = computed(() => {
  const count = targetCount.value ?? 0;
  return count > 0
    ? `每行对应一个目标，将按顺序映射到前 ${count} 个目标。`
    : "每行对应一个目标。";
});
const bulkInputValue = computed({
  get() {
    return targetNames.value.join("\n");
  },
  set(value: string) {
    const lines = value.replace(/\r/g, "").split("\n");
    const nextNames = targetNames.value.slice();

    for (let index = 0; index < lines.length; index += 1) {
      nextNames[index] = lines[index] ?? "";
    }

    targetNames.value = nextNames;
    if (lines.length > (targetCount.value ?? 0)) {
      targetCountText.value = String(lines.length);
    }
  },
});
const isRoundActive = computed(() => status.value === "testing");
const currentGroupSummary = computed(() => {
  const count = currentStep.value?.promptTargets.length ?? 0;
  if (count === 0) {
    return "";
  }

  return `本次包含 ${count} 个测试目标`;
});
const currentAnnouncement = computed(() => {
  if (status.value !== "testing" || !currentStep.value) {
    return "填写目标后开始测试。";
  }

  return `请测试下列目标：${formatTargetNames(currentStep.value.promptTargets)}。`;
});
const latestHistory = computed(() => testHistory.value.toReversed());
const canUndoLastTest = computed(() => testHistory.value.length > 0 && currentRoundCount.value > 0);
const previousPromptRanges = computed(() => testHistory.value.at(-1)?.targetRanges ?? []);
const targetsUnchanged = computed(() => {
  if (!diffModeEnabled.value || !currentStep.value) {
    return [];
  }

  return intersectTargetRanges(currentStep.value.promptTargetRanges, previousPromptRanges.value);
});
const targetsToAdd = computed(() => {
  if (!diffModeEnabled.value || !currentStep.value) {
    return [];
  }

  return subtractTargetRanges(currentStep.value.promptTargetRanges, previousPromptRanges.value);
});
const targetsToRemove = computed(() => {
  if (!diffModeEnabled.value || !currentStep.value) {
    return [];
  }

  return subtractTargetRanges(previousPromptRanges.value, currentStep.value.promptTargetRanges);
});
const progressText = computed(() => {
  if (status.value === "idle") {
    return "尚未开始";
  }

  return `已完成 ${testHistory.value.length} 次测试`;
});
const resultSummary = computed(() => (
  incompatibleTargets.value.length === 0
    ? "未发现兼容性问题"
    : `下列 ${incompatibleTargets.value.length} 个目标有兼容性问题`
));

watch(status, async (value, previousValue) => {
  if (value === previousValue) {
    return;
  }

  await nextTick();

  if (value === "testing" && previousValue !== "testing") {
    testingPromptRef.value?.focus();
    return;
  }

  if (value === "complete") {
    resultCardRef.value?.focus();
  }
});

watch(targetCount, (value) => {
  if (!value) {
    setTargetListExpanded(false);
    return;
  }

  if (value <= TARGET_PREVIEW_COUNT) {
    setTargetListExpanded(false);
  }
});

function parseTargetCount(value: string) {
  const normalizedValue = value.trim();
  if (!/^\d+$/.test(normalizedValue)) {
    return undefined;
  }

  const count = Number.parseInt(normalizedValue, 10);
  return count >= 1 ? count : undefined;
}

function handleTargetCountInput(event: Event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  const normalizedValue = input.value.replace(/\D+/g, "");
  input.value = normalizedValue;
  targetCountText.value = normalizedValue;
}

function stepTargetCount(delta: number) {
  const currentCount = parsedTargetCount.value;
  const baseCount = currentCount ?? 1;
  const nextCount = Math.max(baseCount + delta, 1);
  targetCountText.value = String(nextCount);
}

function setTargetListExpanded(nextValue: boolean) {
  targetListExpanded.value = nextValue;
}

function handleBulkImportInput(event: Event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLTextAreaElement)) {
    return;
  }

  bulkInputValue.value = input.value;
}

function handleTargetNameInput(event: Event, index: number) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  const nextNames = targetNames.value.slice();
  while (nextNames.length < index) {
    nextNames.push("");
  }

  nextNames[index - 1] = input.value;
  targetNames.value = nextNames;
}

function getTargetName(index: number) {
  return targetNames.value[index - 1] ?? "";
}

function getTargetLabel(index: number) {
  const name = getTargetName(index).trim();
  return name.length > 0 ? name : `目标 ${index}`;
}

function formatTargetNames(indices: readonly number[], limit = TARGET_PREVIEW_LIMIT) {
  const labels = indices.map((index) => getTargetLabel(index));
  if (labels.length <= limit) {
    return joinTargetLabels(labels);
  }

  return `${joinTargetLabels(labels.slice(0, limit))} 等 ${labels.length} 个目标`;
}

function getTargetRangePreview(ranges: readonly TargetRange[], limit = TARGET_PREVIEW_LIMIT) {
  return takeTargetsFromRanges(ranges, limit);
}

function getTargetRangeCount(ranges: readonly TargetRange[]) {
  return ranges.reduce((total, range) => total + Math.max(range.end - range.start + 1, 0), 0);
}

function formatTargetRanges(ranges: readonly TargetRange[], limit = TARGET_PREVIEW_LIMIT) {
  const count = getTargetRangeCount(ranges);
  const previewTargets = getTargetRangePreview(ranges, limit);
  if (count <= limit) {
    return formatTargetNames(previewTargets, limit);
  }

  return `${formatTargetNames(previewTargets, limit)} 等 ${count} 个目标`;
}

function joinTargetLabels(labels: readonly string[]) {
  if (labels.length === 0) {
    return "暂无目标";
  }

  return labels.join("、");
}

function startTest() {
  const parsedCount = parsedTargetCount.value;
  if (parsedCount === undefined) {
    announcement.value = `无法开始测试：${targetCountError.value}`;
    return;
  }

  const count = parsedCount;
  currentRoundCount.value = count;
  incompatibleTargets.value = [];
  testHistory.value = [];
  status.value = "testing";
  nextRecordId.value = 1;
  try {
    engineState.value = createCompatibilityTestState(count);
    currentStep.value = getCurrentCompatibilityTestStep(engineState.value);
    announcement.value = `已开始新一轮测试，共 ${count} 个目标。`;
  } catch (error) {
    status.value = "idle";
    engineState.value = undefined;
    currentStep.value = undefined;
    const message = error instanceof Error ? error.message : "当前数量过大，页面暂时无法完成初始化。";
    announcement.value = `无法开始测试：${message}`;
  }
}

function answerCurrentTest(hasIssue: boolean) {
  if (status.value !== "testing" || !engineState.value || !currentStep.value) {
    return;
  }

  const group = currentStep.value.promptTargetRanges.map((range) => ({ ...range }));
  recordTestResult(group, hasIssue);
  applyCompatibilityTestAnswer(engineState.value, hasIssue);
  syncFromEngineState();
}

function recordTestResult(group: TargetRange[], hasIssue: boolean) {
  testHistory.value.push({
    id: nextRecordId.value,
    result: hasIssue ? "issue" : "pass",
    targetRanges: group,
  });
  nextRecordId.value += 1;
}

function rebuildEngineStateFromHistory() {
  const nextState = createCompatibilityTestState(currentRoundCount.value);
  for (const record of testHistory.value) {
    applyCompatibilityTestAnswer(nextState, record.result === "issue");
    if (nextState.stopped) {
      break;
    }

    skipCachedCompatibilityTestSteps(nextState);
  }

  return nextState;
}

async function undoLastTest() {
  if (!canUndoLastTest.value) {
    return;
  }

  testHistory.value = testHistory.value.slice(0, -1);
  nextRecordId.value = Math.max(testHistory.value.length + 1, 1);
  incompatibleTargets.value = [];
  engineState.value = rebuildEngineStateFromHistory();
  status.value = "testing";
  syncFromEngineState();
  announcement.value = "已撤回到上一步。";
  await nextTick();
  testingPromptRef.value?.focus();
}

function syncFromEngineState() {
  if (!engineState.value) {
    return;
  }

  currentStep.value = skipCachedCompatibilityTestSteps(engineState.value);

  if (engineState.value.stopped) {
    incompatibleTargets.value = engineState.value.resultTargets.slice();
    completeRound();
    return;
  }

  status.value = "testing";
  announcement.value = currentAnnouncement.value;
}

function completeRound() {
  status.value = "complete";
  currentStep.value = undefined;
  announcement.value = incompatibleTargets.value.length > 0
    ? `测试完成，发现 ${incompatibleTargets.value.length} 个目标有兼容性问题：${formatTargetNames(incompatibleTargets.value)}。`
    : "测试完成，未发现兼容性问题。";
}
</script>
<!-- autocorrect-enable -->

填写测试目标总数和名称后，按页面提示组合测试并反馈结果。

<div class="compat-test-tool">
  <p
    class="compat-test-tool__sr-only"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    {{ announcement }}
  </p>
  <form
    class="compat-test-tool__setup"
    @submit.prevent="startTest"
  >
    <div class="compat-test-tool__field">
      <div class="compat-test-tool__field-head">
        <label for="compat-test-count">测试目标总数</label>
        <p
          v-if="targetCountError"
          id="compat-test-count-error"
          class="compat-test-tool__error compat-test-tool__error--inline"
        >
          {{ targetCountError }}
        </p>
      </div>
      <div class="compat-test-tool__count-stepper">
        <button
          type="button"
          aria-label="测试目标总数减一"
          @click="stepTargetCount(-1)"
        >
          -
        </button>
        <input
          id="compat-test-count"
          :value="targetCountText"
          required
          pattern="[0-9]*"
          inputmode="numeric"
          autocomplete="off"
          :aria-invalid="Boolean(targetCountError)"
          :aria-errormessage="targetCountError ? 'compat-test-count-error' : undefined"
          @input="handleTargetCountInput"
        >
        <button
          type="button"
          aria-label="测试目标总数加一"
          @click="stepTargetCount(1)"
        >
          +
        </button>
      </div>
    </div>
    <button
      type="submit"
      class="compat-test-tool__primary-button"
      :disabled="Boolean(targetCountError)"
    >
      {{ isRoundActive ? "重新开始测试" : "开始测试" }}
    </button>
  </form>
  <div
    v-if="visibleTargetRows.length > 0"
    class="compat-test-tool__target-panel"
  >
    <div class="compat-test-tool__label-row">
      <h2 id="compat-test-targets">测试目标</h2>
      <div
        class="compat-test-tool__toolbar-actions"
        role="group"
        aria-label="测试目标输入方式"
      >
        <button
          type="button"
          class="compat-test-tool__secondary-button"
          :class="{ 'compat-test-tool__mode-button--active': inputMode === 'bulk' }"
          :aria-pressed="inputMode === 'bulk'"
          @click="inputMode = 'bulk'"
        >
          批量输入
        </button>
        <button
          type="button"
          class="compat-test-tool__secondary-button"
          :class="{ 'compat-test-tool__mode-button--active': inputMode === 'list' }"
          :aria-pressed="inputMode === 'list'"
          @click="inputMode = 'list'"
        >
          逐项填写
        </button>
      </div>
    </div>
    <div class="compat-test-tool__target-toolbar">
      <span
        v-if="targetListStatusText"
        class="compat-test-tool__target-meta"
      >
        {{ targetListStatusText }}
      </span>
      <div class="compat-test-tool__toolbar-actions">
        <button
          v-if="inputMode === 'list' && hiddenTargetCount > 0"
          type="button"
          class="compat-test-tool__secondary-button"
          :aria-expanded="targetListExpanded"
          aria-controls="compat-test-target-list"
          @click="setTargetListExpanded(true)"
        >
          展开其余 {{ hiddenTargetCount }} 个
        </button>
        <button
          v-else-if="inputMode === 'list' && targetListExpanded && (targetCount ?? 0) > TARGET_PREVIEW_COUNT"
          type="button"
          class="compat-test-tool__secondary-button"
          :aria-expanded="targetListExpanded"
          aria-controls="compat-test-target-list"
          @click="setTargetListExpanded(false)"
        >
          收起到前 {{ TARGET_PREVIEW_COUNT }} 个
        </button>
      </div>
    </div>
    <div
      v-if="inputMode === 'bulk'"
      class="compat-test-tool__bulk-import"
    >
      <textarea
        id="compat-test-bulk-import"
        :value="bulkInputValue"
        rows="4"
        placeholder="请在此处输入目标名称；不填写则采用默认名称。"
        aria-label="批量输入目标名称"
        aria-describedby="compat-test-bulk-import-description compat-test-bulk-import-note"
        @input="handleBulkImportInput"
      />
      <div class="compat-test-tool__bulk-import-actions">
        <span id="compat-test-bulk-import-description">{{ bulkImportDescription }}</span>
        <span
          id="compat-test-bulk-import-note"
          class="compat-test-tool__sr-only"
        >
          不填写的目标会使用默认名称。
        </span>
      </div>
    </div>
    <p
      v-if="inputMode === 'list'"
      id="compat-test-target-name-note"
      class="compat-test-tool__sr-only"
    >
      目标名称可以留空；留空时会使用默认名称。
    </p>
    <ol
      v-if="inputMode === 'list'"
      id="compat-test-target-list"
      class="compat-test-tool__target-list"
      aria-labelledby="compat-test-targets"
    >
      <li
        v-for="target in visibleTargetRows"
        :key="target.index"
        class="compat-test-tool__target-item"
      >
        <span
          class="compat-test-tool__target-index"
          aria-hidden="true"
        >
          {{ target.index }}
        </span>
        <label
          class="compat-test-tool__sr-only"
          :for="target.id"
        >
          第 {{ target.index }} 个测试目标名称
        </label>
        <input
          :id="target.id"
          :value="getTargetName(target.index)"
          autocomplete="off"
          :placeholder="`目标 ${target.index}`"
          aria-describedby="compat-test-target-name-note"
          @input="handleTargetNameInput($event, target.index)"
        >
      </li>
    </ol>
  </div>
  <div class="compat-test-tool__test-panel">
    <div class="compat-test-tool__label-row">
      <h2 id="compat-test-current">当前测试</h2>
      <div
        class="compat-test-tool__label-row-actions"
        role="group"
        aria-label="当前测试选项"
      >
        <label class="compat-test-tool__switch">
          <input
            v-model="diffModeEnabled"
            type="checkbox"
            role="switch"
            :aria-checked="diffModeEnabled"
            aria-describedby="compat-test-diff-mode-note"
          >
          <span>差异模式</span>
        </label>
        <span
          id="compat-test-diff-mode-note"
          class="compat-test-tool__sr-only"
        >
          开启后会按与上一步相同、本次新增和本次移除三组显示目标变化。
        </span>
      </div>
    </div>
    <template v-if="status === 'testing'">
      <div
        ref="testingPromptRef"
        class="compat-test-tool__prompt"
        role="group"
        aria-labelledby="compat-test-current compat-test-current-summary"
        tabindex="-1"
      >
        <p
          id="compat-test-current-summary"
          class="compat-test-tool__prompt-kicker"
        >
          {{ currentGroupSummary }}
        </p>
      </div>
      <div
        v-if="!diffModeEnabled"
        class="compat-test-tool__diff-group"
        role="group"
        aria-labelledby="compat-test-current-targets-label"
      >
        <p
          id="compat-test-current-targets-label"
          class="compat-test-tool__diff-label"
        >
          请测试下列目标
        </p>
        <div
          class="compat-test-tool__chip-list"
          role="list"
          aria-labelledby="compat-test-current-targets-label"
        >
          <span
            v-for="target in currentStep ? getTargetRangePreview(currentStep.promptTargetRanges) : []"
            :key="target"
            class="compat-test-tool__chip"
            role="listitem"
          >
            {{ getTargetLabel(target) }}
          </span>
          <span
            v-if="currentStep && currentStep.promptTargetCount > TARGET_PREVIEW_LIMIT"
            class="compat-test-tool__diff-empty"
          >
            等 {{ currentStep.promptTargetCount }} 个目标
          </span>
        </div>
      </div>
      <template v-if="diffModeEnabled">
        <div
          class="compat-test-tool__diff-group"
          role="group"
          aria-labelledby="compat-test-diff-same-label"
        >
          <p
            id="compat-test-diff-same-label"
            class="compat-test-tool__diff-label"
          >
            与上一步相同
          </p>
          <div
            class="compat-test-tool__chip-list"
            :role="getTargetRangeCount(targetsUnchanged) > 0 ? 'list' : undefined"
            :aria-labelledby="getTargetRangeCount(targetsUnchanged) > 0 ? 'compat-test-diff-same-label' : undefined"
          >
            <span
              v-for="target in getTargetRangePreview(targetsUnchanged)"
              :key="`unchanged-${target}`"
              class="compat-test-tool__chip"
              role="listitem"
            >
              {{ getTargetLabel(target) }}
            </span>
            <span
              v-if="getTargetRangeCount(targetsUnchanged) > TARGET_PREVIEW_LIMIT"
              class="compat-test-tool__diff-empty"
            >
              等 {{ getTargetRangeCount(targetsUnchanged) }} 个目标
            </span>
            <span
              v-if="getTargetRangeCount(targetsUnchanged) === 0"
              class="compat-test-tool__diff-empty"
              role="status"
            >
              无
            </span>
          </div>
        </div>
        <div
          class="compat-test-tool__diff-group"
          role="group"
          aria-labelledby="compat-test-diff-add-label"
        >
          <p
            id="compat-test-diff-add-label"
            class="compat-test-tool__diff-label"
          >
            本次新增
          </p>
          <div
            class="compat-test-tool__chip-list"
            :role="getTargetRangeCount(targetsToAdd) > 0 ? 'list' : undefined"
            :aria-labelledby="getTargetRangeCount(targetsToAdd) > 0 ? 'compat-test-diff-add-label' : undefined"
          >
            <span
              v-for="target in getTargetRangePreview(targetsToAdd)"
              :key="`add-${target}`"
              class="compat-test-tool__chip compat-test-tool__chip--add"
              role="listitem"
            >
              {{ getTargetLabel(target) }}
            </span>
            <span
              v-if="getTargetRangeCount(targetsToAdd) > TARGET_PREVIEW_LIMIT"
              class="compat-test-tool__diff-empty"
            >
              等 {{ getTargetRangeCount(targetsToAdd) }} 个目标
            </span>
            <span
              v-if="getTargetRangeCount(targetsToAdd) === 0"
              class="compat-test-tool__diff-empty"
              role="status"
            >
              无
            </span>
          </div>
        </div>
        <div
          class="compat-test-tool__diff-group"
          role="group"
          aria-labelledby="compat-test-diff-remove-label"
        >
          <p
            id="compat-test-diff-remove-label"
            class="compat-test-tool__diff-label"
          >
            本次移除
          </p>
          <div
            class="compat-test-tool__chip-list"
            :role="getTargetRangeCount(targetsToRemove) > 0 ? 'list' : undefined"
            :aria-labelledby="getTargetRangeCount(targetsToRemove) > 0 ? 'compat-test-diff-remove-label' : undefined"
          >
            <span
              v-for="target in getTargetRangePreview(targetsToRemove)"
              :key="`remove-${target}`"
              class="compat-test-tool__chip compat-test-tool__chip--remove"
              role="listitem"
            >
              {{ getTargetLabel(target) }}
            </span>
            <span
              v-if="getTargetRangeCount(targetsToRemove) > TARGET_PREVIEW_LIMIT"
              class="compat-test-tool__diff-empty"
            >
              等 {{ getTargetRangeCount(targetsToRemove) }} 个目标
            </span>
            <span
              v-if="getTargetRangeCount(targetsToRemove) === 0"
              class="compat-test-tool__diff-empty"
              role="status"
            >
              无
            </span>
          </div>
        </div>
      </template>
      <div class="compat-test-tool__actions">
        <button
          type="button"
          class="compat-test-tool__danger-button"
          @click="answerCurrentTest(true)"
        >
          有兼容性问题
        </button>
        <button
          type="button"
          class="compat-test-tool__secondary-button"
          @click="answerCurrentTest(false)"
        >
          没有兼容性问题
        </button>
        <button
          type="button"
          class="compat-test-tool__secondary-button"
          :disabled="!canUndoLastTest"
          @click="undoLastTest"
        >
          撤回上一步
        </button>
      </div>
    </template>
    <template v-else-if="status === 'complete'">
      <div
        ref="resultCardRef"
        class="compat-test-tool__result-card"
        role="group"
        aria-labelledby="compat-test-result-title compat-test-result-summary"
        tabindex="-1"
      >
        <p
          id="compat-test-result-title"
          class="compat-test-tool__prompt-kicker"
        >
          测试完成
        </p>
        <p
          id="compat-test-result-summary"
          class="compat-test-tool__prompt-text"
        >
          {{ resultSummary }}
        </p>
        <div
          v-if="incompatibleTargets.length > 0"
          class="compat-test-tool__chip-list"
          role="list"
          aria-label="有兼容性问题的目标"
        >
          <span
            v-for="target in incompatibleTargets"
            :key="`result-${target}`"
            class="compat-test-tool__chip compat-test-tool__chip--remove"
            role="listitem"
          >
            {{ getTargetLabel(target) }}
          </span>
        </div>
      </div>
      <div class="compat-test-tool__actions">
        <button
          type="button"
          class="compat-test-tool__primary-button"
          @click="startTest"
        >
          重新开始测试
        </button>
        <button
          v-if="canUndoLastTest"
          type="button"
          class="compat-test-tool__secondary-button"
          @click="undoLastTest"
        >
          撤回上一步
        </button>
      </div>
    </template>
    <p
      v-else
      class="compat-test-tool__empty"
    >
      填写目标总数和名称后，点击“开始测试”。
    </p>
  </div>
  <div
    v-if="latestHistory.length > 0"
    class="compat-test-tool__history"
  >
    <div class="compat-test-tool__label-row">
      <h2 id="compat-test-history">测试记录</h2>
      <span>{{ progressText }}</span>
    </div>
    <ol
      class="compat-test-tool__history-list"
      aria-labelledby="compat-test-history"
    >
      <li
        v-for="record in latestHistory"
        :key="record.id"
      >
        <span
          class="compat-test-tool__history-badge"
          :class="{
            'compat-test-tool__history-badge--issue': record.result === 'issue',
            'compat-test-tool__history-badge--pass': record.result === 'pass',
          }"
        >
          {{ record.result === "issue" ? "有问题" : "无问题" }}
        </span>
        <span>{{ formatTargetRanges(record.targetRanges) }}</span>
      </li>
    </ol>
  </div>
</div>

## 说明

- 本工具用于排查多个目标之间的兼容性问题，基于二分法和分治思想逐步缩小范围。
- 页面每次都会给出下一轮需要测试的目标。你只需要按提示完成测试，再根据实际结果选择“有兼容性问题”或“没有兼容性问题”。
- 由 [HowieHz/plugin-compatibility-checking-tool](https://github.com/HowieHz/plugin-compatibility-checking-tool) 重构而来。
- 如果这个工具对你有帮助，欢迎前往 [HowieHz/howiehz-misc](https://github.com/HowieHz/howiehz-misc) 点个 ⭐ 支持一下。

## 使用场景

### 排查一组插件内部的问题

比如手上有一个包含 20 个插件的整合包，启动时会出问题，但还不确定是哪几个插件互相冲突。可以把测试目标总数设为 20，按页面给出的分组去启用或禁用插件，再根据实际结果回答“有”或“没有”兼容性问题。

几轮之后，排查器会把范围缩小到具体目标。这样不用从第一个插件开始逐个试，也不用完全靠猜。

### 排查自己的插件和谁冲突

如果自己写了一个插件，想确认它和另外 10 个插件里哪些存在冲突，可以把自己的插件固定保留，只把另外 10 个插件作为测试目标。

页面提示要测试哪些目标，就把这些目标和自己的插件一起放进环境里测试。最后得到的结果，就是和自己的插件存在兼容性问题的目标。

<style scoped>
.compat-test-tool {
  display: grid;
  gap: 14px;
  max-width: 760px;
  margin: 16px 0 24px;
  padding: 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}

.compat-test-tool h2 {
  margin: 0;
  border: 0;
  padding: 0;
  font-size: 1rem;
}

.compat-test-tool label {
  display: block;
  margin-bottom: 4px;
  font-weight: 600;
}

.compat-test-tool input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
}

.compat-test-tool textarea {
  width: 100%;
  min-height: 96px;
  padding: 10px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg);
  resize: vertical;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
}

.compat-test-tool input[aria-invalid="true"] {
  border-color: var(--vp-c-danger-1);
}

.compat-test-tool button {
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  cursor: pointer;
  font-weight: 600;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, color 0.2s ease, background-color 0.2s ease;
}

.compat-test-tool button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.compat-test-tool__setup {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: end;
}

.compat-test-tool__field {
  min-width: 0;
}

.compat-test-tool__field-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}

.compat-test-tool__count-stepper {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 40px;
  gap: 6px;
}

.compat-test-tool__count-stepper button {
  background: var(--vp-c-bg);
}

.compat-test-tool__empty,
.compat-test-tool__error {
  margin: 6px 0 0;
  font-size: 0.92rem;
}

.compat-test-tool__empty {
  color: color-mix(in srgb, var(--vp-c-text-1) 72%, var(--vp-c-text-2) 28%);
}

.compat-test-tool__error {
  color: var(--vp-c-danger-1);
}

.compat-test-tool__error--inline {
  margin: 0;
  text-align: right;
}

.compat-test-tool__target-panel,
.compat-test-tool__test-panel,
.compat-test-tool__history {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 88%, transparent);
  border-radius: 12px;
  background: var(--vp-c-bg);
}

.compat-test-tool__label-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.compat-test-tool__test-panel .compat-test-tool__label-row {
  align-items: center;
}

.compat-test-tool__label-row-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.compat-test-tool__label-row span {
  font-size: 0.88rem;
  color: color-mix(in srgb, var(--vp-c-text-1) 70%, var(--vp-c-text-2) 30%);
  white-space: nowrap;
}

.compat-test-tool label.compat-test-tool__switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  margin-bottom: 0;
  line-height: 1;
  font-weight: 500;
  cursor: pointer;
}

.compat-test-tool__switch input {
  display: block;
  flex: none;
  box-sizing: border-box;
  width: 38px;
  height: 22px;
  margin: 0;
  padding: 0;
  appearance: none;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: color-mix(in srgb, var(--vp-c-bg-soft) 80%, var(--vp-c-bg));
  position: relative;
  transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.compat-test-tool__switch span {
  display: inline-flex;
  align-items: center;
  line-height: 1.2;
}

.compat-test-tool__switch input::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--vp-c-bg);
  box-shadow: 0 1px 3px rgb(15 23 42 / 0.18);
  transition: transform 0.2s ease;
}

.compat-test-tool__switch input:checked {
  border-color: var(--vp-c-brand-1);
  background: color-mix(in srgb, var(--vp-c-brand-1) 78%, white);
}

.compat-test-tool__switch input:checked::after {
  transform: translateX(16px);
}

.compat-test-tool__target-toolbar,
.compat-test-tool__bulk-import-actions,
.compat-test-tool__toolbar-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.compat-test-tool__target-toolbar .compat-test-tool__toolbar-actions {
  margin-left: auto;
}

.compat-test-tool__target-meta,
.compat-test-tool__bulk-import-actions span {
  font-size: 0.88rem;
  color: color-mix(in srgb, var(--vp-c-text-1) 70%, var(--vp-c-text-2) 30%);
}

.compat-test-tool__bulk-import {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
}

.compat-test-tool__target-list {
  display: grid;
  gap: 8px;
  max-height: 300px;
  margin: 0;
  padding: 0 12px 0 0;
  overflow: auto;
  scrollbar-gutter: stable;
  list-style: none;
}

.compat-test-tool__target-item {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}

.compat-test-tool__target-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
  color: color-mix(in srgb, var(--vp-c-text-1) 76%, var(--vp-c-text-2) 24%);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.compat-test-tool__prompt,
.compat-test-tool__result-card {
  display: grid;
  gap: 6px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 28%, var(--vp-c-divider));
  border-radius: 12px;
  background: color-mix(in srgb, var(--vp-c-brand-soft) 64%, var(--vp-c-bg));
}

.compat-test-tool__prompt-kicker {
  margin: 0;
  color: color-mix(in srgb, var(--vp-c-text-1) 72%, var(--vp-c-text-2) 28%);
  font-size: 0.9rem;
}

.compat-test-tool__prompt-text {
  margin: 0;
  font-size: 1.08rem;
  font-weight: 700;
  line-height: 1.55;
}

.compat-test-tool__chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.compat-test-tool__diff-group {
  display: grid;
  gap: 6px;
}

.compat-test-tool__diff-label {
  margin: 0;
  font-size: 0.88rem;
  color: color-mix(in srgb, var(--vp-c-text-1) 72%, var(--vp-c-text-2) 28%);
}

.compat-test-tool__chip {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 4px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg-soft);
  font-size: 0.9rem;
}

.compat-test-tool__chip--add {
  border-color: color-mix(in srgb, var(--vp-c-green-1) 42%, var(--vp-c-divider));
  background: color-mix(in srgb, var(--vp-c-green-soft) 64%, var(--vp-c-bg));
  color: color-mix(in srgb, var(--vp-c-green-1) 78%, var(--vp-c-text-1));
}

.compat-test-tool__chip--remove {
  border-color: color-mix(in srgb, var(--vp-c-danger-1) 42%, var(--vp-c-divider));
  background: color-mix(in srgb, var(--vp-c-danger-soft) 58%, var(--vp-c-bg));
  color: var(--vp-c-danger-1);
}

.compat-test-tool__diff-empty {
  font-size: 0.9rem;
  color: color-mix(in srgb, var(--vp-c-text-1) 68%, var(--vp-c-text-2) 32%);
}

.compat-test-tool__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.compat-test-tool__primary-button,
.compat-test-tool__secondary-button,
.compat-test-tool__danger-button {
  padding: 9px 14px;
}

.compat-test-tool__primary-button {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-1);
  color: var(--vp-c-white);
}

.compat-test-tool__secondary-button {
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
}

.compat-test-tool__mode-button--active {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.compat-test-tool__danger-button {
  border-color: color-mix(in srgb, var(--vp-c-danger-1) 45%, var(--vp-c-divider));
  background: color-mix(in srgb, var(--vp-c-danger-soft) 50%, var(--vp-c-bg));
  color: var(--vp-c-danger-1);
}

.compat-test-tool__history-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.compat-test-tool__history-list li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  min-width: 0;
}

.compat-test-tool__history-badge {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 700;
  white-space: nowrap;
}

.compat-test-tool__history-badge--issue {
  background: color-mix(in srgb, var(--vp-c-danger-soft) 64%, var(--vp-c-bg));
  color: var(--vp-c-danger-1);
}

.compat-test-tool__history-badge--pass {
  background: color-mix(in srgb, var(--vp-c-brand-soft) 70%, var(--vp-c-bg));
  color: var(--vp-c-brand-1);
}

.compat-test-tool__sr-only {
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

.compat-test-tool button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 20px rgb(15 23 42 / 0.06);
}

.compat-test-tool__secondary-button:hover:not(:disabled),
.compat-test-tool__target-index:hover {
  border-color: var(--vp-c-brand-1);
}

.compat-test-tool button:focus-visible,
.compat-test-tool input:focus-visible,
.compat-test-tool textarea:focus-visible,
.compat-test-tool__prompt:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 52%, var(--vp-c-divider));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--vp-c-brand-1) 16%, transparent);
}

@media (max-width: 640px) {
  .compat-test-tool__setup {
    grid-template-columns: 1fr;
  }

  .compat-test-tool__field-head,
  .compat-test-tool__label-row {
    display: grid;
    justify-content: stretch;
    gap: 4px;
  }

  .compat-test-tool__label-row-actions {
    display: grid;
    gap: 8px;
  }

  .compat-test-tool__target-toolbar,
  .compat-test-tool__bulk-import-actions,
  .compat-test-tool__toolbar-actions {
    display: grid;
    justify-content: stretch;
  }

  .compat-test-tool__label-row span {
    white-space: normal;
  }

  .compat-test-tool__primary-button,
  .compat-test-tool__secondary-button,
  .compat-test-tool__danger-button {
    width: 100%;
  }
}
</style>
