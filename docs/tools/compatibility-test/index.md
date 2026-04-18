---
publish: false
published: 2026-04-18T15:30:00+08:00
---

# 在线兼容性测试器

<!-- autocorrect-disable -->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

import {
  applyCompatibilityTestAnswer,
  createCompatibilityTestState,
  getCurrentCompatibilityTestStep,
  skipCachedCompatibilityTestSteps,
  type CompatibilityTestState,
  type CompatibilityTestStep,
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
  targets: number[];
}

const TARGET_PREVIEW_COUNT = 5;
const TARGET_PREVIEW_LIMIT = 8;

const targetCountText = ref("5");
const targetNames = ref<string[]>([]);
const bulkImportText = ref("");
const inputMode = ref<InputMode>("list");
const status = ref<TestStatus>("idle");
const currentRoundCount = ref(0);
const incompatibleTargets = ref<number[]>([]);
const testHistory = ref<TestRecord[]>([]);
const announcement = ref("");
const nextRecordId = ref(1);
const testingPromptRef = ref<HTMLElement>();
const restartButtonRef = ref<HTMLButtonElement>();
const targetListExpanded = ref(false);
const engineState = ref<CompatibilityTestState>();
const currentStep = ref<CompatibilityTestStep>();

const parsedTargetCount = computed(() => parseTargetCount(targetCountText.value));
const targetCount = computed(() => parsedTargetCount.value);
const targetCountError = computed(() => {
  const normalizedValue = targetCountText.value.trim();
  if (normalizedValue === "") {
    return undefined;
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
    ? `每行一个名称，将按顺序应用到前 ${count} 个目标；超出的行会自动忽略。`
    : "每行一个名称，超出的行会自动忽略。";
});
const isRoundActive = computed(() => status.value === "testing");
const currentInstruction = computed(() => {
  if (status.value !== "testing" || !currentStep.value) {
    return "填写目标后开始测试。";
  }

  return `将下列目标一起测试：${formatTargetNames(currentStep.value.promptTargets)}。`;
});
const currentGroupSummary = computed(() => {
  const count = currentStep.value?.promptTargets.length ?? 0;
  if (count === 0) {
    return "";
  }

  return `本次包含 ${count} 个测试目标`;
});
const foundTargetsText = computed(() => (
  incompatibleTargets.value.length > 0
    ? formatTargetNames(incompatibleTargets.value, Number.POSITIVE_INFINITY)
    : "暂无"
));
const latestHistory = computed(() => testHistory.value.slice(-6).reverse());
const canUndoLastTest = computed(() => testHistory.value.length > 0 && currentRoundCount.value > 0);
const progressText = computed(() => {
  if (status.value === "idle") {
    return "尚未开始";
  }

  return `已完成 ${testHistory.value.length} 次测试`;
});
const resultTitle = computed(() => {
  if (incompatibleTargets.value.length === 0) {
    return "未发现兼容性问题";
  }

  return "测试完成";
});
const resultSummary = computed(() => {
  if (incompatibleTargets.value.length === 0) {
    return "已完成兼容性测试，未发现兼容性问题。";
  }

  return `已完成兼容性测试，发现 ${incompatibleTargets.value.length} 个目标有兼容性问题。`;
});

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
    restartButtonRef.value?.focus();
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

  if (inputMode.value === "bulk" && bulkImportText.value.trim() !== "") {
    syncBulkImportToTargetNames();
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

function createTargetRange(count: number) {
  return Array.from({ length: count }, (_, index) => index + 1);
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

  bulkImportText.value = input.value;
  if (inputMode.value === "bulk") {
    syncBulkImportToTargetNames();
  }
}

function syncBulkImportToTargetNames() {
  const count = targetCount.value;
  if (!count) {
    return false;
  }

  const lines = bulkImportText.value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim());
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  if (lines.length === 0) {
    return true;
  }

  const importCount = Math.min(lines.length, count);
  const nextNames = targetNames.value.slice();
  while (nextNames.length < count) {
    nextNames.push("");
  }

  for (let index = 0; index < count; index += 1) {
    nextNames[index] = index < importCount ? (lines[index] ?? "") : "";
  }

  targetNames.value = nextNames;
  return true;
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
  if (inputMode.value === "bulk" && !syncBulkImportToTargetNames()) {
    announcement.value = "请先填写有效的测试目标总数。";
    return;
  }

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

  const group = currentStep.value.promptTargets.slice();
  recordTestResult(group, hasIssue);
  applyCompatibilityTestAnswer(engineState.value, hasIssue);
  syncFromEngineState();
}

function recordTestResult(group: number[], hasIssue: boolean) {
  testHistory.value.push({
    id: nextRecordId.value,
    result: hasIssue ? "issue" : "pass",
    targets: group,
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
  announcement.value = currentInstruction.value;
}

function completeRound() {
  status.value = "complete";
  currentStep.value = undefined;
  announcement.value = resultSummary.value;
}
</script>
<!-- autocorrect-enable -->

填写测试目标总数和名称后，按页面提示组合测试并反馈结果。

<div class="compat-test-tool">
  <p
    class="compat-test-tool__sr-only"
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
          inputmode="numeric"
          autocomplete="off"
          :aria-invalid="Boolean(targetCountError)"
          :aria-describedby="targetCountError ? 'compat-test-count-error' : undefined"
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
      <div class="compat-test-tool__toolbar-actions">
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
        :value="bulkImportText"
        rows="4"
        placeholder="每行一个名称"
        aria-label="批量输入目标名称"
        aria-describedby="compat-test-bulk-import-description"
        @input="handleBulkImportInput"
      />
      <div class="compat-test-tool__bulk-import-actions">
        <span id="compat-test-bulk-import-description">{{ bulkImportDescription }}</span>
      </div>
    </div>
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
          @input="handleTargetNameInput($event, target.index)"
        >
      </li>
    </ol>
  </div>
  <div class="compat-test-tool__test-panel">
    <div class="compat-test-tool__label-row">
      <h2 id="compat-test-current">当前测试</h2>
      <span>{{ progressText }}</span>
    </div>
    <template v-if="status === 'testing'">
      <div
        ref="testingPromptRef"
        class="compat-test-tool__prompt"
        tabindex="-1"
      >
        <p class="compat-test-tool__prompt-kicker">{{ currentGroupSummary }}</p>
        <p class="compat-test-tool__prompt-text">{{ currentInstruction }}</p>
      </div>
      <div
        class="compat-test-tool__chip-list"
        aria-label="本次测试目标"
      >
        <span
          v-for="target in currentStep?.promptTargets ?? []"
          :key="target"
          class="compat-test-tool__chip"
        >
          {{ getTargetLabel(target) }}
        </span>
      </div>
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
      <div class="compat-test-tool__result-card">
        <p class="compat-test-tool__prompt-kicker">{{ resultTitle }}</p>
        <p class="compat-test-tool__prompt-text">{{ resultSummary }}</p>
      </div>
      <div class="compat-test-tool__summary-grid">
        <div>
          <span>有兼容性问题的目标</span>
          <strong>{{ foundTargetsText }}</strong>
        </div>
      </div>
      <div class="compat-test-tool__actions">
        <button
          ref="restartButtonRef"
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
        <span>{{ formatTargetNames(record.targets) }}</span>
      </li>
    </ol>
  </div>
</div>

## 说明

- 本工具基于二分法和分治思想，用分组测试逐步缩小范围，适合快速排查多个待测目标之间的兼容性问题。
- 每次按页面提示组合测试后，选择“有兼容性问题”或“没有兼容性问题”即可进入下一步。
- 本页由 [HowieHz/plugin-compatibility-checking-tool](https://github.com/HowieHz/plugin-compatibility-checking-tool) 重构而来。

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

.compat-test-tool__hint,
.compat-test-tool__round-note,
.compat-test-tool__empty,
.compat-test-tool__error {
  margin: 6px 0 0;
  font-size: 0.92rem;
}

.compat-test-tool__hint,
.compat-test-tool__round-note,
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

.compat-test-tool__label-row span {
  font-size: 0.88rem;
  color: color-mix(in srgb, var(--vp-c-text-1) 70%, var(--vp-c-text-2) 30%);
  white-space: nowrap;
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

.compat-test-tool__result-card--issue {
  border-color: color-mix(in srgb, var(--vp-c-danger-1) 30%, var(--vp-c-divider));
  background: color-mix(in srgb, var(--vp-c-danger-soft) 45%, var(--vp-c-bg));
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

.compat-test-tool__summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.compat-test-tool__summary-grid div {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
}

.compat-test-tool__summary-grid span {
  color: color-mix(in srgb, var(--vp-c-text-1) 72%, var(--vp-c-text-2) 28%);
  font-size: 0.86rem;
}

.compat-test-tool__summary-grid strong {
  line-height: 1.45;
  word-break: break-word;
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
  .compat-test-tool__setup,
  .compat-test-tool__summary-grid {
    grid-template-columns: 1fr;
  }

  .compat-test-tool__field-head,
  .compat-test-tool__label-row {
    display: grid;
    justify-content: stretch;
    gap: 4px;
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
