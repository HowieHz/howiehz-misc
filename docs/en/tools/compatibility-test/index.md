---
publish: false
published: 2026-04-18T15:30:00+08:00
---

# Compatibility Finder

<!-- autocorrect-disable -->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

import {
  applyCompatibilityTestAnswer,
  createCompatibilityTestState,
  getNextAnswerableCompatibilityTestStep,
  intersectTargetRanges,
  subtractTargetRanges,
  takeTargetsFromRanges,
  type CompatibilityTestState,
  type CompatibilityTestStep,
  type TargetRange,
} from "compat-finder";

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
// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; state is used by the Markdown template below.
const inputMode = ref<InputMode>("list");
const status = ref<TestStatus>("idle");
const currentRoundCount = ref(0);
const incompatibleTargets = ref<number[]>([]);
const testHistory = ref<TestRecord[]>([]);
const announcement = ref("");
const diffModeEnabled = ref(false);
const nextRecordId = ref(1);
const testingPromptRef = ref<HTMLElement>();
const completeResultRef = ref<HTMLElement>();
const targetListPageInputRef = ref<HTMLInputElement>();
const targetListPage = ref(1);
const targetListPageText = ref("1");
const isEditingTargetListPage = ref(false);
const engineState = ref<CompatibilityTestState>();
const currentStep = ref<CompatibilityTestStep>();

const parsedTargetCount = computed(() => parseTargetCount(targetCountText.value));
const targetCount = computed(() => parsedTargetCount.value);
const targetCountError = computed(() => {
  const normalizedValue = targetCountText.value.trim();
  if (normalizedValue === "") {
    return "Enter an integer greater than 0";
  }

  if (parsedTargetCount.value === undefined) {
    return "Enter an integer greater than 0";
  }

  return undefined;
});
const targetListPageCount = computed(() => Math.max(Math.ceil((targetCount.value ?? 0) / TARGET_PREVIEW_COUNT), 1));
const visibleTargetRange = computed(() => {
  const count = targetCount.value ?? 0;
  if (count === 0) {
    return { start: 0, end: 0 };
  }

  const start = (targetListPage.value - 1) * TARGET_PREVIEW_COUNT + 1;
  return {
    start,
    end: Math.min(start + TARGET_PREVIEW_COUNT - 1, count),
  };
});
// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; computed value is used by the Markdown template below.
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
// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; computed value is used by the Markdown template below.
const bulkImportDescription = computed(() => {
  const count = targetCount.value ?? 0;
  return count > 0
    ? `Each line maps to one target, in order, across all ${count} targets.`
    : "Each line maps to one target.";
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
// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; computed value is used by the Markdown template below.
const isRoundActive = computed(() => status.value === "testing");
// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; computed value is used by the Markdown template below.
const currentGroupSummary = computed(() => {
  const count = currentStep.value?.promptTargetCount ?? 0;
  if (count === 0) {
    return "";
  }

  return `This step includes ${count} targets`;
});
const currentAnnouncement = computed(() => {
  if (status.value !== "testing" || !currentStep.value) {
    return "Enter the target count and names, then start the test.";
  }

  return `Test the following targets: ${formatTargetNames(
    getAllTargetsFromRanges(currentStep.value.promptTargetRanges),
    Number.MAX_SAFE_INTEGER,
  )}.`;
});
// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; computed value is used by the Markdown template below.
const latestHistory = computed(() => testHistory.value.toReversed());
const canUndoLastTest = computed(() => testHistory.value.length > 0 && currentRoundCount.value > 0);
const previousPromptRanges = computed(() => testHistory.value.at(-1)?.targetRanges ?? []);
// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; computed value is used by the Markdown template below.
const targetsUnchanged = computed(() => {
  if (!diffModeEnabled.value || !currentStep.value) {
    return [];
  }

  return intersectTargetRanges(currentStep.value.promptTargetRanges, previousPromptRanges.value);
});
// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; computed value is used by the Markdown template below.
const targetsToAdd = computed(() => {
  if (!diffModeEnabled.value || !currentStep.value) {
    return [];
  }

  return subtractTargetRanges(currentStep.value.promptTargetRanges, previousPromptRanges.value);
});
// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; computed value is used by the Markdown template below.
const targetsToRemove = computed(() => {
  if (!diffModeEnabled.value || !currentStep.value) {
    return [];
  }

  return subtractTargetRanges(previousPromptRanges.value, currentStep.value.promptTargetRanges);
});
// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; computed value is used by the Markdown template below.
const confirmedTargetSet = computed(() => (
  new Set(
    currentStep.value ? getAllTargetsFromRanges(currentStep.value.debug.confirmedTargetRanges) : [],
  )
));
// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; computed value is used by the Markdown template below.
const progressText = computed(() => {
  if (status.value === "idle") {
    return "Not started";
  }

  return `${testHistory.value.length} test runs completed`;
});
// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; computed value is used by the Markdown template below.
const resultLabel = computed(() => (
  incompatibleTargets.value.length > 0
    ? `The following ${incompatibleTargets.value.length} targets have compatibility issues`
    : "No compatibility issues found"
));

watch(status, async (value, previousValue) => {
  if (value === previousValue) {
    return;
  }

  await nextTick();

  if (value === "complete") {
    completeResultRef.value?.focus();
  }
});

watch(targetCount, (value) => {
  if (!value) {
    targetListPage.value = 1;
    targetListPageText.value = "1";
    return;
  }

  targetListPage.value = Math.min(targetListPage.value, targetListPageCount.value);
  targetListPageText.value = String(targetListPage.value);
});

watch(targetListPage, (value) => {
  targetListPageText.value = String(value);
});

function parseTargetCount(value: string) {
  const normalizedValue = value.trim();
  if (!/^\d+$/.test(normalizedValue)) {
    return undefined;
  }

  const count = Number.parseInt(normalizedValue, 10);
  return count >= 1 ? count : undefined;
}

// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; handler is used by the Markdown template below.
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

// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; handler is used by the Markdown template below.
function stepTargetListPage(delta: number) {
  const nextPage = targetListPage.value + delta;
  targetListPage.value = Math.min(Math.max(nextPage, 1), targetListPageCount.value);
}

// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; handler is used by the Markdown template below.
async function startEditingTargetListPage() {
  isEditingTargetListPage.value = true;
  targetListPageText.value = String(targetListPage.value);
  await nextTick();
  targetListPageInputRef.value?.focus();
  targetListPageInputRef.value?.select();
}

// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; handler is used by the Markdown template below.
function handleTargetListPageInput(event: Event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  const normalizedValue = input.value.replace(/\D+/g, "");
  input.value = normalizedValue;
  targetListPageText.value = normalizedValue;
}

// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; handler is used by the Markdown template below.
function finishEditingTargetListPage() {
  const parsedPage = Number.parseInt(targetListPageText.value, 10);
  if (Number.isNaN(parsedPage)) {
    targetListPageText.value = String(targetListPage.value);
    isEditingTargetListPage.value = false;
    return;
  }

  targetListPage.value = Math.min(Math.max(parsedPage, 1), targetListPageCount.value);
  targetListPageText.value = String(targetListPage.value);
  isEditingTargetListPage.value = false;
}

// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; handler is used by the Markdown template below.
function cancelEditingTargetListPage() {
  targetListPageText.value = String(targetListPage.value);
  isEditingTargetListPage.value = false;
}

// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; handler is used by the Markdown template below.
function handleBulkImportInput(event: Event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLTextAreaElement)) {
    return;
  }

  bulkInputValue.value = input.value;
}

// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; handler is used by the Markdown template below.
function handleTargetNameInput(event: Event, index: number) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  const nextNames = targetNames.value.slice();
  nextNames[index - 1] = input.value;
  targetNames.value = nextNames;
}

function getTargetName(index: number) {
  return targetNames.value[index - 1] ?? "";
}

function getTargetLabel(index: number) {
  const name = getTargetName(index).trim();
  return name.length > 0 ? name : `Target ${index}`;
}

// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; parameter is used inside template string.
function getConfirmedTargetA11yLabel(index: number) {
  return `${getTargetLabel(index)} (confirmed)`;
}

function formatTargetNames(indices: readonly number[], limit = TARGET_PREVIEW_LIMIT) {
  const labels = indices.map((index) => getTargetLabel(index));
  if (labels.length <= limit) {
    return joinTargetLabels(labels);
  }

  return `${joinTargetLabels(labels.slice(0, limit))}, plus ${labels.length - limit} more`;
}

function getAllTargetsFromRanges(ranges: readonly TargetRange[]) {
  return takeTargetsFromRanges(ranges, getTargetRangeCount(ranges));
}

function getTargetRangeCount(ranges: readonly TargetRange[]) {
  return ranges.reduce((total, range) => total + Math.max(range.end - range.start + 1, 0), 0);
}

// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; helper is used by the Markdown template below.
function formatTargetRanges(ranges: readonly TargetRange[], limit = TARGET_PREVIEW_LIMIT) {
  const count = getTargetRangeCount(ranges);
  const previewTargets = takeTargetsFromRanges(ranges, limit);
  if (count <= limit) {
    return formatTargetNames(previewTargets, limit);
  }

  return `${formatTargetNames(previewTargets, limit)}, plus ${count - limit} more`;
}

function joinTargetLabels(labels: readonly string[]) {
  if (labels.length === 0) {
    return "No targets";
  }

  return labels.join(", ");
}

async function startTest() {
  const parsedCount = parsedTargetCount.value;
  if (parsedCount === undefined) {
    announcement.value = `Unable to start: ${targetCountError.value}`;
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
    currentStep.value = getNextAnswerableCompatibilityTestStep(engineState.value);
    announcement.value = `Started a new test with ${count} targets.`;
    await nextTick();
    testingPromptRef.value?.focus();
  } catch (error) {
    status.value = "idle";
    engineState.value = undefined;
    currentStep.value = undefined;
    const message = error instanceof Error ? error.message : "The target count is too large for this page to initialize.";
    announcement.value = `Unable to start: ${message}`;
  }
}

// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; handler is used by the Markdown template below.
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
    getNextAnswerableCompatibilityTestStep(nextState);
  }

  return nextState;
}

// @ts-expect-error TS6133: vue-tsc false positive in VitePress Markdown; handler is used by the Markdown template below.
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
  announcement.value = "Returned to the previous step.";
  await nextTick();
  testingPromptRef.value?.focus();
}

function syncFromEngineState() {
  if (!engineState.value) {
    return;
  }

  currentStep.value = getNextAnswerableCompatibilityTestStep(engineState.value);

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
    ? `Test complete. Found ${incompatibleTargets.value.length} targets with compatibility issues: ${formatTargetNames(incompatibleTargets.value)}.`
    : "Test complete. No compatibility issues found.";
}
</script>
<!-- autocorrect-enable -->

Enter the target count and names, then follow the prompts to test each suggested group and report whether the issue occurs.

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
        <label for="compat-test-count">Target count</label>
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
          aria-label="Decrease target count by one"
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
          :aria-describedby="targetCountError ? 'compat-test-count-error' : undefined"
          :aria-errormessage="targetCountError ? 'compat-test-count-error' : undefined"
          @input="handleTargetCountInput"
        >
        <button
          type="button"
          aria-label="Increase target count by one"
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
      {{ isRoundActive ? "Restart test" : "Start test" }}
    </button>
  </form>
  <div
    v-if="visibleTargetRows.length > 0"
    class="compat-test-tool__target-panel"
  >
    <div class="compat-test-tool__label-row">
      <h2 id="compat-test-targets">Test targets</h2>
      <div class="compat-test-tool__input-mode">
        <span
          class="compat-test-tool__input-mode-label"
          :class="{ 'compat-test-tool__input-mode-label--active': inputMode === 'bulk' }"
        >
          Bulk entry
        </span>
        <label class="compat-test-tool__mode-switch">
          <input
            :checked="inputMode === 'list'"
            type="checkbox"
            role="switch"
            :aria-checked="inputMode === 'list'"
            :aria-label="inputMode === 'list'
              ? 'Currently using individual entry. Switch to bulk entry.'
              : 'Currently using bulk entry. Switch to individual entry.'"
            @change="inputMode = inputMode === 'list' ? 'bulk' : 'list'"
          >
        </label>
        <span
          class="compat-test-tool__input-mode-label"
          :class="{ 'compat-test-tool__input-mode-label--active': inputMode === 'list' }"
        >
          Individual entry
        </span>
      </div>
    </div>
    <div
      v-if="inputMode === 'bulk'"
      class="compat-test-tool__bulk-import"
    >
      <label
        for="compat-test-bulk-import"
        class="compat-test-tool__sr-only"
      >
        Enter target names in bulk
      </label>
      <textarea
        id="compat-test-bulk-import"
        :value="bulkInputValue"
        rows="4"
        placeholder="Enter target names here. Empty lines use default names."
        aria-describedby="compat-test-bulk-import-description compat-test-bulk-import-note"
        @input="handleBulkImportInput"
      />
      <div class="compat-test-tool__bulk-import-actions">
        <span id="compat-test-bulk-import-description">{{ bulkImportDescription }}</span>
        <span
          id="compat-test-bulk-import-note"
          class="compat-test-tool__sr-only"
        >
          Targets left empty use default names.
        </span>
      </div>
    </div>
    <p
      v-if="inputMode === 'list'"
      id="compat-test-target-name-note"
      class="compat-test-tool__sr-only"
    >
      Target names can be empty. Empty names use default labels.
    </p>
    <template v-if="inputMode === 'list'">
      <ol
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
            Name for test target {{ target.index }}
          </label>
          <input
            :id="target.id"
            :value="getTargetName(target.index)"
            autocomplete="off"
            :placeholder="`Target ${target.index}`"
            aria-describedby="compat-test-target-name-note"
            @input="handleTargetNameInput($event, target.index)"
          >
        </li>
      </ol>
      <div
        v-if="(targetCount ?? 0) > TARGET_PREVIEW_COUNT"
        class="compat-test-tool__pagination"
        role="group"
        aria-label="Target list pagination"
      >
        <button
          type="button"
          class="compat-test-tool__secondary-button"
          :disabled="targetListPage <= 1"
          aria-controls="compat-test-target-list"
          @click="stepTargetListPage(-1)"
        >
          Previous
        </button>
        <div class="compat-test-tool__page-status-slot">
          <button
            v-if="!isEditingTargetListPage"
            type="button"
            class="compat-test-tool__page-status compat-test-tool__page-status-button"
            :aria-label="`Current page ${targetListPage} of ${targetListPageCount}. Click to jump to a page.`"
            @click="startEditingTargetListPage"
          >
            {{ targetListPage }} / {{ targetListPageCount }}
          </button>
          <input
            v-else
            ref="targetListPageInputRef"
            :value="targetListPageText"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            class="compat-test-tool__page-status-input"
            :aria-label="`Enter the page number to jump to. There are ${targetListPageCount} pages.`"
            @input="handleTargetListPageInput"
            @blur="finishEditingTargetListPage"
            @keydown.enter.prevent="finishEditingTargetListPage"
            @keydown.esc.prevent="cancelEditingTargetListPage"
          >
        </div>
        <button
          type="button"
          class="compat-test-tool__secondary-button"
          :disabled="targetListPage >= targetListPageCount"
          aria-controls="compat-test-target-list"
          @click="stepTargetListPage(1)"
        >
          Next
        </button>
      </div>
    </template>
  </div>
  <div class="compat-test-tool__test-panel">
    <div class="compat-test-tool__label-row">
      <h2 id="compat-test-current">Current step</h2>
      <div
        class="compat-test-tool__label-row-actions"
        role="group"
        aria-label="Current step options"
      >
        <label class="compat-test-tool__switch">
          <input
            v-model="diffModeEnabled"
            type="checkbox"
            role="switch"
            :aria-checked="diffModeEnabled"
            aria-describedby="compat-test-diff-mode-note"
          >
          <span
            class="compat-test-tool__input-mode-label"
            :class="{ 'compat-test-tool__input-mode-label--active': diffModeEnabled }"
          >
            Diff mode
          </span>
        </label>
        <span
          id="compat-test-diff-mode-note"
          class="compat-test-tool__sr-only"
        >
          When enabled, targets are grouped by unchanged, added, and removed targets compared with the previous step.
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
          Test the following targets
        </p>
        <div
          class="compat-test-tool__chip-list"
          role="list"
          aria-labelledby="compat-test-current-targets-label"
        >
          <span
            v-for="target in currentStep ? getAllTargetsFromRanges(currentStep.promptTargetRanges) : []"
            :key="target"
            class="compat-test-tool__chip"
            :class="{ 'compat-test-tool__chip--confirmed': confirmedTargetSet.has(target) }"
            :aria-label="confirmedTargetSet.has(target) ? getConfirmedTargetA11yLabel(target) : undefined"
            role="listitem"
          >
            {{ getTargetLabel(target) }}
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
            Unchanged from previous step
          </p>
          <div
            class="compat-test-tool__chip-list"
            :role="getTargetRangeCount(targetsUnchanged) > 0 ? 'list' : undefined"
            :aria-labelledby="getTargetRangeCount(targetsUnchanged) > 0 ? 'compat-test-diff-same-label' : undefined"
          >
            <span
              v-for="target in getAllTargetsFromRanges(targetsUnchanged)"
              :key="`unchanged-${target}`"
              class="compat-test-tool__chip"
              :class="{ 'compat-test-tool__chip--confirmed': confirmedTargetSet.has(target) }"
              :aria-label="confirmedTargetSet.has(target) ? getConfirmedTargetA11yLabel(target) : undefined"
              role="listitem"
            >
              {{ getTargetLabel(target) }}
            </span>
          </div>
          <p
            v-if="getTargetRangeCount(targetsUnchanged) === 0"
            class="compat-test-tool__diff-empty"
          >
            None
          </p>
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
            Added this step
          </p>
          <div
            class="compat-test-tool__chip-list"
            :role="getTargetRangeCount(targetsToAdd) > 0 ? 'list' : undefined"
            :aria-labelledby="getTargetRangeCount(targetsToAdd) > 0 ? 'compat-test-diff-add-label' : undefined"
          >
            <span
              v-for="target in getAllTargetsFromRanges(targetsToAdd)"
              :key="`add-${target}`"
              class="compat-test-tool__chip compat-test-tool__chip--add"
              role="listitem"
            >
              {{ getTargetLabel(target) }}
            </span>
          </div>
          <p
            v-if="getTargetRangeCount(targetsToAdd) === 0"
            class="compat-test-tool__diff-empty"
          >
            None
          </p>
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
            Removed this step
          </p>
          <div
            class="compat-test-tool__chip-list"
            :role="getTargetRangeCount(targetsToRemove) > 0 ? 'list' : undefined"
            :aria-labelledby="getTargetRangeCount(targetsToRemove) > 0 ? 'compat-test-diff-remove-label' : undefined"
          >
            <span
              v-for="target in getAllTargetsFromRanges(targetsToRemove)"
              :key="`remove-${target}`"
              class="compat-test-tool__chip compat-test-tool__chip--remove"
              role="listitem"
            >
              {{ getTargetLabel(target) }}
            </span>
          </div>
          <p
            v-if="getTargetRangeCount(targetsToRemove) === 0"
            class="compat-test-tool__diff-empty"
          >
            None
          </p>
        </div>
      </template>
      <div class="compat-test-tool__actions">
        <button
          type="button"
          class="compat-test-tool__danger-button"
          @click="answerCurrentTest(true)"
        >
          Issue present
        </button>
        <button
          type="button"
          class="compat-test-tool__success-button"
          @click="answerCurrentTest(false)"
        >
          No issue found
        </button>
        <button
          type="button"
          class="compat-test-tool__secondary-button"
          :disabled="!canUndoLastTest"
          @click="undoLastTest"
        >
          Undo last step
        </button>
      </div>
    </template>
    <template v-else-if="status === 'complete'">
      <div
        ref="completeResultRef"
        class="compat-test-tool__complete-result"
        role="group"
        aria-labelledby="compat-test-result-title compat-test-result-targets-label"
        tabindex="-1"
      >
        <div
          class="compat-test-tool__result-card"
        >
          <p
            id="compat-test-result-title"
            class="compat-test-tool__prompt-kicker"
          >
            Test complete
          </p>
        </div>
        <div
          class="compat-test-tool__result-targets"
          role="group"
          aria-labelledby="compat-test-result-targets-label"
        >
          <p
            id="compat-test-result-targets-label"
            class="compat-test-tool__diff-label"
          >
            {{ resultLabel }}
          </p>
          <div
            v-if="incompatibleTargets.length > 0"
            class="compat-test-tool__chip-list"
            role="list"
            aria-labelledby="compat-test-result-targets-label"
          >
            <span
              v-for="target in incompatibleTargets"
              :key="`result-${target}`"
              class="compat-test-tool__chip compat-test-tool__chip--confirmed"
              role="listitem"
            >
              {{ getTargetLabel(target) }}
            </span>
          </div>
        </div>
      </div>
      <div class="compat-test-tool__actions">
        <button
          type="button"
          class="compat-test-tool__primary-button"
          @click="startTest"
        >
          Restart test
        </button>
        <button
          v-if="canUndoLastTest"
          type="button"
          class="compat-test-tool__secondary-button"
          @click="undoLastTest"
        >
          Undo last step
        </button>
      </div>
    </template>
    <p
      v-else
      class="compat-test-tool__empty"
    >
      Enter the target count and names, then click "Start test".
    </p>
  </div>
  <div
    v-if="latestHistory.length > 0"
    class="compat-test-tool__history"
  >
    <div class="compat-test-tool__label-row">
      <h2 id="compat-test-history">Test history</h2>
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
          {{ record.result === "issue" ? "Issue present" : "No issue found" }}
        </span>
        <span>{{ formatTargetRanges(record.targetRanges) }}</span>
      </li>
    </ol>
  </div>
</div>

## Overview

- This tool helps isolate compatibility issues across multiple targets by narrowing the range step by step with a divide-and-conquer process similar to binary search.
- Each step gives you the next group of targets to test. Run that group as prompted, then choose "Issue present" or "No issue found" based on the actual result.
- This page is powered by the core library from [`compat-finder`](https://www.npmjs.com/package/compat-finder), which also provides a CLI and Agent Skill.
- If this tool helps you, consider starring [HowieHz/howiehz-misc](https://github.com/HowieHz/howiehz-misc).

## Use cases

### Troubleshooting conflicts within a modpack or plugin set

For example, suppose you have a pack with 20 mods or plugins. It fails to start, but you do not yet know which ones conflict with each other. Set the target count to 20, then enable or disable the items in each group suggested by the page and report whether the issue occurs.

After a few rounds, the range narrows to the specific targets involved. That lets you avoid testing every item one by one from the start or relying entirely on guesswork.

This works well for troubleshooting mods in games such as Minecraft, The Elder Scrolls, The Sims, RimWorld, Stardew Valley, Terraria, Mount & Blade, Garry's Mod, and Left 4 Dead. It can also help with userscripts, browser extensions, Rainmeter skins, and other cases where compatibility conflicts need to be isolated.

### Finding conflicts with your own plugin

If you wrote a plugin and want to find which of 10 other plugins conflict with it, keep your own plugin enabled at all times and use only the other 10 plugins as test targets.

When the page tells you which targets to test, run them alongside your own plugin. The final result is the set of targets that conflict with it.

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

.compat-test-tool__label-row > span {
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

.compat-test-tool__switch input,
.compat-test-tool__mode-switch input {
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

.compat-test-tool__switch .compat-test-tool__input-mode-label {
  font-weight: 400;
}

.compat-test-tool__switch input::after,
.compat-test-tool__mode-switch input::after {
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

.compat-test-tool__switch input:checked,
.compat-test-tool__mode-switch input:checked {
  border-color: var(--vp-c-brand-1);
  background: color-mix(in srgb, var(--vp-c-brand-1) 78%, white);
}

.compat-test-tool__switch input:checked::after,
.compat-test-tool__mode-switch input:checked::after {
  transform: translateX(16px);
}

.compat-test-tool__input-mode {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.compat-test-tool__input-mode-label {
  font-size: 0.88rem;
  color: color-mix(in srgb, var(--vp-c-text-1) 62%, var(--vp-c-text-2) 38%);
  white-space: nowrap;
}

.compat-test-tool__input-mode-label--active {
  color: var(--vp-c-brand-1);
  font-weight: 700;
}

.compat-test-tool label.compat-test-tool__mode-switch {
  display: inline-flex;
  margin: 0;
  cursor: pointer;
}

.compat-test-tool__bulk-import-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.compat-test-tool__pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.compat-test-tool__bulk-import-actions span,
.compat-test-tool__page-status {
  font-size: 0.88rem;
  color: color-mix(in srgb, var(--vp-c-text-1) 70%, var(--vp-c-text-2) 30%);
}

.compat-test-tool__page-status {
  white-space: nowrap;
}

.compat-test-tool__page-status-slot {
  display: flex;
  justify-content: center;
}

.compat-test-tool__page-status-button {
  min-height: 38px;
  padding: 8px 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: color-mix(in srgb, var(--vp-c-text-1) 70%, var(--vp-c-text-2) 30%);
  font-size: 0.88rem;
  font-weight: 500;
  cursor: pointer;
  transform: none;
  box-shadow: none;
}

.compat-test-tool__page-status-button:hover:not(:disabled) {
  transform: none;
  box-shadow: none;
  color: var(--vp-c-brand-1);
}

.compat-test-tool__page-status-input {
  width: 100%;
  min-width: 0;
  min-height: 38px;
  padding: 8px 12px;
  text-align: center;
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

.compat-test-tool__chip--confirmed {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 48%, var(--vp-c-divider));
  background: color-mix(in srgb, var(--vp-c-brand-soft) 72%, var(--vp-c-bg));
  color: color-mix(in srgb, var(--vp-c-brand-1) 82%, var(--vp-c-text-1));
  font-weight: 700;
}

.compat-test-tool__result-targets {
  display: grid;
  gap: 8px;
}

.compat-test-tool__complete-result {
  display: grid;
  gap: 12px;
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
.compat-test-tool__success-button,
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

.compat-test-tool__success-button {
  border-color: color-mix(in srgb, var(--vp-c-green-1) 45%, var(--vp-c-divider));
  background: color-mix(in srgb, var(--vp-c-green-soft) 56%, var(--vp-c-bg));
  color: color-mix(in srgb, var(--vp-c-green-1) 82%, var(--vp-c-text-1));
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
  background: color-mix(in srgb, var(--vp-c-green-soft) 64%, var(--vp-c-bg));
  color: color-mix(in srgb, var(--vp-c-green-1) 82%, var(--vp-c-text-1));
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

.compat-test-tool__secondary-button:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
}

.compat-test-tool__success-button:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--vp-c-green-1) 60%, var(--vp-c-divider));
  background: color-mix(in srgb, var(--vp-c-green-soft) 68%, var(--vp-c-bg));
}

.compat-test-tool__danger-button:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--vp-c-danger-1) 60%, var(--vp-c-divider));
  background: color-mix(in srgb, var(--vp-c-danger-soft) 62%, var(--vp-c-bg));
}

.compat-test-tool button:focus-visible,
.compat-test-tool input:focus-visible,
.compat-test-tool textarea:focus-visible,
.compat-test-tool__prompt:focus-visible,
.compat-test-tool__result-card:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 52%, var(--vp-c-divider));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--vp-c-brand-1) 16%, transparent);
}

.compat-test-tool__complete-result:focus-visible {
  outline: none;
}

.compat-test-tool__complete-result:focus-visible .compat-test-tool__result-card {
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

  .compat-test-tool__test-panel .compat-test-tool__label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .compat-test-tool__test-panel .compat-test-tool__label-row-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-width: 0;
    flex-shrink: 0;
  }

  .compat-test-tool__target-panel .compat-test-tool__label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .compat-test-tool__target-panel .compat-test-tool__input-mode {
    justify-content: flex-end;
    gap: 6px;
    min-width: 0;
    flex-shrink: 0;
  }

  .compat-test-tool__bulk-import-actions {
    display: grid;
    justify-content: stretch;
  }

  .compat-test-tool__input-mode {
    justify-content: space-between;
  }

  .compat-test-tool__pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: nowrap;
    width: 100%;
  }

  .compat-test-tool__label-row > span {
    white-space: normal;
  }

  .compat-test-tool__primary-button,
  .compat-test-tool__secondary-button,
  .compat-test-tool__success-button,
  .compat-test-tool__danger-button {
    width: 100%;
  }

  .compat-test-tool__pagination .compat-test-tool__secondary-button {
    width: auto;
    flex: 1 1 0;
  }

  .compat-test-tool__pagination .compat-test-tool__page-status {
    text-align: center;
  }

  .compat-test-tool__actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .compat-test-tool__actions > :nth-child(3) {
    grid-column: 1 / -1;
  }
}
</style>
