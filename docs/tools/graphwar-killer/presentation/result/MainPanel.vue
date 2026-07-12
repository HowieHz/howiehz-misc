<script setup lang="ts">
import { Trash2 } from "@lucide/vue";
import { computed } from "vue";

import type { GraphwarControlCapability } from "../../controllers/page/capabilities";
import type { ToolWorkflowMode } from "../../core/types";
import type { GraphwarKillerLocale } from "../../locale-types";
import ControlReason from "../controls/ControlReason.vue";
import { getInputValue } from "../dom/input";

type GraphwarResultPanelCoordinateAxis = "x" | "y";

interface GraphwarResultPanelCoordinateControl {
  /** 输入框可访问性标签，父页面按当前路径点标签提前生成。 */
  ariaLabel: string;
  /** 当前坐标输入框文本；正在编辑时保留用户原输入。 */
  text: string;
  /** 输入框 hover 说明。 */
  title: string;
}

interface GraphwarResultPanelPointRow {
  /** 路径点索引；同时用于事件回传和稳定 key。 */
  index: number;
  /** 点位展示标签，如 self 或路径点序号。 */
  label: string;
  /** X 坐标输入展示模型。 */
  x: GraphwarResultPanelCoordinateControl;
  /** Y 坐标输入展示模型。 */
  y: GraphwarResultPanelCoordinateControl;
}

export interface GraphwarResultPanelModel {
  /** 托管期间锁定公式输入、路径坐标和手动发射，保留复制。 */
  interactionDisabled: boolean;
  /** Agent 开火按钮当前文案。 */
  agentFireButtonText: string;
  /** Agent 开火命令与页面 guard 共享的能力状态。 */
  agentFireState: GraphwarControlCapability["state"];
  /** Agent 开火不可用时的可见原因。 */
  agentFireReason?: string;
  /** 是否允许清空模拟器输入。 */
  canClearSimulatorInputs: boolean;
  /** 是否允许复制当前结果。 */
  canCopyFormula: boolean;
  /** 当前计算错误文案。 */
  calculationMessage: string;
  /** 是否展示计算错误；父页面应保留原来的 workflow/formulaResult 判定。 */
  calculationMessageVisible: boolean;
  /** 复制按钮当前文案。 */
  copyButtonText: string;
  /** 仅显示在函数输入/输出框左侧的方程前缀。 */
  equationPrefix: string;
  /** 路径点坐标表行。 */
  pointRows: readonly GraphwarResultPanelPointRow[];
  /** 二阶发射角提示。 */
  secondOrderAngleHint: string;
  /** 是否展示模拟器发射角输入。 */
  showSimulatorLaunchAngleInput: boolean;
  /** 模拟器表达式输入框文本。 */
  simulatorFormulaText: string;
  /** 模拟器发射角输入框文本。 */
  simulatorLaunchAngleText: string;
  /** 公式生成结果文本。 */
  solverExpression: string;
  /** 是否展示公式生成结果；父页面应使用原 `formulaResult` truthiness 投影。 */
  solverResultVisible: boolean;
  /** 当前轨迹警告文案。 */
  trajectoryWarning: string;
  /** 当前主工作流。 */
  workflowMode: ToolWorkflowMode;
  /** 是否展示 Agent 开火按钮。 */
  agentFireVisible: boolean;
}

const props = defineProps<{
  /** 页面本地化文案。 */
  locale: GraphwarKillerLocale;
  /** 结果面板展示模型。 */
  result: GraphwarResultPanelModel;
}>();

const emit = defineEmits<{
  clearSimulator: [];
  copyFormula: [];
  finishPointCoordinateEdit: [];
  fireAgentFunction: [];
  startPointCoordinateEdit: [index: number, axis: GraphwarResultPanelCoordinateAxis];
  updatePointCoordinate: [index: number, axis: GraphwarResultPanelCoordinateAxis, value: string];
  updateSimulatorFormulaText: [value: string];
  updateSimulatorLaunchAngleText: [value: string];
}>();

const simulatorFormulaText = computed({
  get: () => props.result.simulatorFormulaText,
  set: (value) => emit("updateSimulatorFormulaText", value),
});
const simulatorLaunchAngleText = computed({
  get: () => props.result.simulatorLaunchAngleText,
  set: (value) => emit("updateSimulatorLaunchAngleText", value),
});

/** Keeps coordinate parsing in the page while safely adapting the native input event. */
function handlePointCoordinateInput(index: number, axis: GraphwarResultPanelCoordinateAxis, event: Event) {
  const value = getInputValue(event);
  if (value === undefined) {
    return;
  }
  emit("updatePointCoordinate", index, axis, value);
}
</script>

<template>
  <section
    class="graphwar-killer__panel graphwar-killer__result-panel graphwar-killer-control-surface"
    aria-labelledby="graphwar-killer-result-title"
  >
    <div class="graphwar-killer__label-row graphwar-killer__label-row--result">
      <h2 id="graphwar-killer-result-title">
        {{ locale.ui.result.title }}
      </h2>
      <div class="graphwar-killer__result-actions">
        <button
          v-if="result.agentFireVisible"
          type="button"
          class="graphwar-killer__agent-fire-button"
          :aria-describedby="result.agentFireReason ? 'graphwar-killer-agent-fire-reason' : undefined"
          :disabled="result.agentFireState === 'blocked' || result.agentFireState === 'busy'"
          :title="locale.ui.result.fireTitle"
          @click="emit('fireAgentFunction')"
        >
          {{ result.agentFireButtonText }}
        </button>
        <ControlReason
          v-if="result.agentFireVisible && result.agentFireReason"
          id="graphwar-killer-agent-fire-reason"
          :message="result.agentFireReason"
        />
        <button
          type="button"
          class="graphwar-killer__primary-button"
          :disabled="!result.canCopyFormula"
          :title="locale.ui.result.copyTitle"
          @click="emit('copyFormula')"
        >
          {{ result.copyButtonText }}
        </button>
        <button
          v-if="result.workflowMode === 'simulator'"
          type="button"
          class="graphwar-killer__icon-button"
          :aria-label="locale.ui.result.clearSimulator"
          :disabled="result.interactionDisabled || !result.canClearSimulatorInputs"
          :title="locale.ui.result.clearSimulatorTitle"
          @click="emit('clearSimulator')"
        >
          <Trash2
            :size="17"
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
    <div
      v-if="result.solverResultVisible"
      class="graphwar-killer__formula-row"
    >
      <span class="graphwar-killer__formula-prefix">
        {{ result.equationPrefix }}
      </span>
      <p class="graphwar-killer__formula">
        {{ result.solverExpression }}
      </p>
    </div>
    <div
      v-else-if="result.workflowMode === 'simulator'"
      class="graphwar-killer__formula-row"
    >
      <span class="graphwar-killer__formula-prefix">
        {{ result.equationPrefix }}
      </span>
      <input
        v-model="simulatorFormulaText"
        class="graphwar-killer__formula-input"
        inputmode="text"
        autocomplete="off"
        :aria-label="locale.ui.result.formulaInputAriaLabel"
        :title="locale.ui.result.formulaInputTitle"
        :disabled="result.interactionDisabled"
      >
    </div>
    <div
      v-if="result.showSimulatorLaunchAngleInput"
      class="graphwar-killer__formula-row"
    >
      <span class="graphwar-killer__formula-prefix">
        {{ locale.ui.result.launchAngle }}
      </span>
      <input
        v-model="simulatorLaunchAngleText"
        class="graphwar-killer__formula-input graphwar-killer__formula-input--angle"
        inputmode="decimal"
        autocomplete="off"
        :aria-label="locale.ui.result.launchAngleAriaLabel"
        :title="locale.ui.result.launchAngleTitle"
        :disabled="result.interactionDisabled"
      >
    </div>
    <p
      v-if="result.secondOrderAngleHint"
      class="graphwar-killer__hint graphwar-killer__hint--warning"
    >
      {{ result.secondOrderAngleHint }}
    </p>
    <p
      v-if="result.trajectoryWarning"
      class="graphwar-killer__hint graphwar-killer__hint--warning"
    >
      {{ result.trajectoryWarning }}
    </p>
    <p
      v-if="result.calculationMessageVisible"
      class="graphwar-killer__error"
    >
      {{ result.calculationMessage }}
    </p>
    <div
      v-if="result.pointRows.length"
      class="graphwar-killer__point-table"
    >
      <div>
        <span>{{ locale.ui.point.header }}</span>
        <span>x</span>
        <span>y</span>
      </div>
      <div
        v-for="row in result.pointRows"
        :key="`row-${row.index}`"
      >
        <span>{{ row.label }}</span>
        <input
          class="graphwar-killer__point-coordinate-input"
          :value="row.x.text"
          :aria-label="row.x.ariaLabel"
          :title="row.x.title"
          inputmode="decimal"
          autocomplete="off"
          :disabled="result.interactionDisabled"
          @focus="emit('startPointCoordinateEdit', row.index, 'x')"
          @blur="emit('finishPointCoordinateEdit')"
          @input="handlePointCoordinateInput(row.index, 'x', $event)"
        >
        <input
          class="graphwar-killer__point-coordinate-input"
          :value="row.y.text"
          :aria-label="row.y.ariaLabel"
          :title="row.y.title"
          inputmode="decimal"
          autocomplete="off"
          :disabled="result.interactionDisabled"
          @focus="emit('startPointCoordinateEdit', row.index, 'y')"
          @blur="emit('finishPointCoordinateEdit')"
          @input="handlePointCoordinateInput(row.index, 'y', $event)"
        >
      </div>
    </div>
  </section>
</template>

<style scoped>
.graphwar-killer__panel {
  align-content: start;
  background: var(--vp-c-bg);
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 88%, transparent);
  border-radius: 8px;
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 10px;
}

.graphwar-killer__result-panel h2 {
  border: 0;
  font-size: 1rem;
  margin: 0;
  padding: 0;
}

.graphwar-killer__label-row {
  align-items: baseline;
  display: flex;
  gap: 8px;
  justify-content: space-between;
  min-width: 0;
}

.graphwar-killer__label-row--result {
  align-items: center;
}

.graphwar-killer__result-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.graphwar-killer__primary-button {
  background: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-white);
  min-height: 34px;
  padding: 6px 12px;
  white-space: nowrap;
}

.graphwar-killer__agent-fire-button {
  background: color-mix(in srgb, var(--vp-c-danger-1) 10%, var(--vp-c-bg));
  border-color: color-mix(in srgb, var(--vp-c-danger-1) 42%, var(--vp-c-divider));
  color: var(--vp-c-danger-1);
  min-height: 34px;
  min-width: 72px;
  padding: 6px 12px;
  white-space: nowrap;
}

.graphwar-killer__formula-row {
  align-items: start;
  display: grid;
  gap: 8px;
  grid-template-columns: auto minmax(0, 1fr);
}

.graphwar-killer__formula-prefix {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  font-family: var(--vp-font-family-mono);
  font-weight: 800;
  min-height: 44px;
  padding: 10px;
  user-select: none;
  white-space: nowrap;
}

.graphwar-killer__formula {
  background: color-mix(in srgb, var(--vp-c-brand-soft) 54%, var(--vp-c-bg));
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 28%, var(--vp-c-divider));
  border-radius: 10px;
  font-family: var(--vp-font-family-mono);
  font-size: 1rem;
  line-height: 1.6;
  margin: 0;
  overflow-x: auto;
  padding: 10px;
  white-space: nowrap;
}

.graphwar-killer__formula-input {
  /* Formula text is the only intentional typography override for input values. */
  font-family: var(--vp-font-family-mono);
  min-width: 0;
}

.graphwar-killer__formula-input--angle {
  max-width: 160px;
}

.graphwar-killer__error {
  color: var(--vp-c-danger-1);
  margin: 0;
}

.graphwar-killer__hint {
  color: color-mix(in srgb, var(--vp-c-text-1) 68%, var(--vp-c-text-2) 32%);
  font-size: 0.9rem;
  line-height: 1.5;
  margin: 0;
}

.graphwar-killer__hint--warning {
  color: #b45309;
  font-weight: 700;
}

.graphwar-killer__point-table {
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  display: grid;
  overflow-x: auto;
}

.graphwar-killer__point-table > div {
  border-top: 1px solid var(--vp-c-divider);
  display: grid;
  font-variant-numeric: tabular-nums;
  gap: 6px;
  grid-template-columns: minmax(90px, 1fr) minmax(130px, max-content) minmax(130px, max-content);
  min-width: 100%;
  padding: 6px 8px;
  width: max-content;
}

.graphwar-killer__point-table > div:first-child {
  background: var(--vp-c-bg-soft);
  border-top: 0;
  font-weight: 700;
}

.graphwar-killer__point-coordinate-input {
  height: 28px !important;
  line-height: 1.1 !important;
  min-height: 0 !important;
  padding: 3px 7px !important;
  width: 130px;
}

.graphwar-killer__primary-button:hover:not(:disabled) {
  color: var(--vp-c-white);
}

.graphwar-killer__agent-fire-button:hover:not(:disabled) {
  border-color: var(--vp-c-danger-1);
  color: var(--vp-c-danger-1);
}

@media (width <= 760px) {
  .graphwar-killer__label-row {
    display: grid;
    gap: 4px;
  }

  .graphwar-killer__primary-button {
    width: 100%;
  }

  .graphwar-killer__agent-fire-button {
    width: 100%;
  }

  .graphwar-killer__point-table > div {
    grid-template-columns: minmax(90px, 1fr) minmax(130px, max-content) minmax(130px, max-content);
  }
}
</style>
