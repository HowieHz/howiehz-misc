<script setup lang="ts">
import { computed } from "vue";

import type { GraphwarControlCapability } from "../../controllers/page/capabilities";
import type { AlgorithmMode, EquationMode, ToolWorkflowMode } from "../../core/types";
import type { GraphwarKillerLocale } from "../../locale-types";
import ToggleField from "../controls/ToggleField.vue";

type GraphwarSettingsPanelStatusKind = "info" | "success" | "warning" | "error";

interface GraphwarSettingsPanelHeaderStatus {
  /** 标题右侧状态文案；空字符串表示不显示。 */
  message: string;
  /** 状态样式语义，应与父页面设置状态优先级保持一致。 */
  kind: GraphwarSettingsPanelStatusKind;
}

interface GraphwarSettingsPanelOption<T extends string> {
  /** 模式值；父页面应继续持有切换后的业务语义。 */
  value: T;
  /** 按钮展示文案。 */
  label: string;
  /** 按钮 hover 说明。 */
  title: string;
}

interface GraphwarSettingsPanelAlgorithmOption extends GraphwarSettingsPanelOption<AlgorithmMode> {
  /** Unsupported combinations remain visible and explainable. */
  disabled: boolean;
}

interface GraphwarSettingsPanelEquationOption extends GraphwarSettingsPanelOption<EquationMode> {
  /** 当前模式是否被父页面判定为不可选。 */
  disabled: boolean;
}

interface GraphwarSettingsPanelPrecision {
  /** 公式小数位输入框当前文本；非法输入应原样保留给父页面校验。 */
  text: string;
  /** 公式小数位最大值。 */
  maximum: number;
}

export interface GraphwarSettingsPanelModel {
  /** 托管期间锁定所有会改变公式或寻路输入的基础设置。 */
  interactionDisabled: boolean;
  /** 高级设置区是否展开。 */
  advancedSettingsVisible: boolean;
  /** 当前公式生成算法。 */
  algorithmMode: AlgorithmMode;
  /** 公式生成算法选项。 */
  algorithmModes: readonly GraphwarSettingsPanelAlgorithmOption[];
  /** 当前 Graphwar 方程解释模式。 */
  equationMode: EquationMode;
  /** Graphwar 方程解释模式选项。 */
  equationModes: readonly GraphwarSettingsPanelEquationOption[];
  /** 标题右侧状态展示模型。 */
  headerStatus: GraphwarSettingsPanelHeaderStatus;
  /** 公式小数位输入展示模型。 */
  precision: GraphwarSettingsPanelPrecision;
  /** 当前游戏模式是否启用 Step 溢出保护。 */
  stepOverflowProtectionEnabled: boolean;
  /** 当前游戏模式的邪道偏好；不兼容组合仍保留该值。 */
  stepGlitchModeEnabled: boolean;
  /** 邪道偏好在不兼容组合或缺少障碍时保持可编辑的休眠状态。 */
  stepGlitchModeState: GraphwarControlCapability["state"];
  /** 邪道偏好当前没有效果时的可见说明。 */
  stepGlitchModeReason?: string;
  /** 公式陡峭度输入框当前文本；非法输入应原样保留给父页面校验。 */
  steepnessText: string;
  /** 当前公式组合是否消费陡峭度。 */
  steepnessVisible: boolean;
  /** 当前页面主工作流。 */
  toolWorkflowMode: ToolWorkflowMode;
  /** 页面主工作流选项。 */
  toolWorkflowModes: readonly GraphwarSettingsPanelOption<ToolWorkflowMode>[];
}

const props = defineProps<{
  /** 页面本地化文案。 */
  locale: GraphwarKillerLocale;
  /** 基础设置面板展示模型。 */
  panel: GraphwarSettingsPanelModel;
}>();

const emit = defineEmits<{
  cancelDebugActivationHold: [];
  finishDebugActivationHold: [];
  setAlgorithmMode: [mode: AlgorithmMode];
  setEquationMode: [mode: EquationMode];
  setToolWorkflowMode: [mode: ToolWorkflowMode];
  startDebugActivationHold: [event: PointerEvent];
  toggleAdvancedSettings: [];
  toggleStepGlitchMode: [];
  toggleStepOverflowProtection: [];
  updatePrecisionText: [value: string];
  updateSteepnessText: [value: string];
}>();

const precisionText = computed({
  get: () => props.panel.precision.text,
  set: (value) => emit("updatePrecisionText", value),
});

const steepnessText = computed({
  get: () => props.panel.steepnessText,
  set: (value) => emit("updateSteepnessText", value),
});

const activeToolWorkflowHint = computed(
  () => props.panel.toolWorkflowModes.find((mode) => mode.value === props.panel.toolWorkflowMode)?.title ?? "",
);
</script>

<template>
  <div class="graphwar-killer__settings-stack">
    <section
      class="graphwar-killer__panel graphwar-killer__workflow-panel graphwar-killer-control-surface"
      aria-labelledby="graphwar-killer-workflow-title"
      :aria-disabled="panel.interactionDisabled"
    >
      <div class="graphwar-killer__label-row">
        <h2 id="graphwar-killer-workflow-title">
          {{ locale.ui.settings.mode }}
        </h2>
        <span :title="activeToolWorkflowHint">{{ activeToolWorkflowHint }}</span>
      </div>
      <fieldset
        class="graphwar-killer__settings-fields"
        :disabled="panel.interactionDisabled"
      >
        <div
          class="graphwar-killer__tool-toggle graphwar-killer__mode-toggle graphwar-killer-segmented-control"
          :class="{ 'graphwar-killer__mode-toggle--simulator': panel.toolWorkflowMode === 'simulator' }"
          role="group"
          :aria-label="locale.ui.settings.modeAriaLabel"
          :title="locale.ui.settings.modeTitle"
        >
          <button
            v-for="mode in panel.toolWorkflowModes"
            :key="mode.value"
            type="button"
            class="graphwar-killer-segmented-button"
            :aria-pressed="panel.toolWorkflowMode === mode.value"
            :class="{ 'graphwar-killer-segmented-button--active': panel.toolWorkflowMode === mode.value }"
            :title="mode.title"
            @click="emit('setToolWorkflowMode', mode.value)"
          >
            {{ mode.label }}
          </button>
        </div>
      </fieldset>
    </section>

    <section
      class="graphwar-killer__panel graphwar-killer__game-mode-panel graphwar-killer-control-surface"
      aria-labelledby="graphwar-killer-game-mode-title"
      :aria-disabled="panel.interactionDisabled"
    >
      <div class="graphwar-killer__label-row">
        <h2 id="graphwar-killer-game-mode-title">
          {{ locale.ui.settings.gameMode }}
        </h2>
        <span :title="locale.ui.settings.gameModeSettingsHint">
          {{ locale.ui.settings.gameModeSettingsHint }}
        </span>
      </div>
      <fieldset
        class="graphwar-killer__settings-fields"
        :disabled="panel.interactionDisabled"
      >
        <div
          class="graphwar-killer__equation-toggle graphwar-killer-segmented-control"
          :class="{
            'graphwar-killer__equation-toggle--dy': panel.equationMode === 'dy',
            'graphwar-killer__equation-toggle--ddy': panel.equationMode === 'ddy',
          }"
          role="group"
          :aria-label="locale.ui.settings.gameModeAriaLabel"
          :title="locale.ui.settings.gameModeTitle"
        >
          <button
            v-for="mode in panel.equationModes"
            :key="mode.value"
            type="button"
            class="graphwar-killer-segmented-button"
            :aria-pressed="panel.equationMode === mode.value"
            :class="{ 'graphwar-killer-segmented-button--active': panel.equationMode === mode.value }"
            :disabled="mode.disabled"
            :title="mode.title"
            @click="emit('setEquationMode', mode.value)"
          >
            {{ mode.label }}
          </button>
        </div>
      </fieldset>
    </section>

    <section
      class="graphwar-killer__panel graphwar-killer__settings-panel graphwar-killer-control-surface"
      aria-labelledby="graphwar-killer-settings-title"
      :aria-disabled="panel.interactionDisabled"
    >
      <div class="graphwar-killer__label-row">
        <h2 id="graphwar-killer-settings-title">
          {{ locale.ui.settings.title }}
        </h2>
        <span
          v-if="panel.toolWorkflowMode !== 'simulator' || panel.headerStatus.kind !== 'info'"
          :title="panel.headerStatus.message"
          :class="{
            'graphwar-killer__label-status--error': panel.headerStatus.kind === 'error',
            'graphwar-killer__label-status--warning': panel.headerStatus.kind === 'warning',
            'graphwar-killer__label-status--success': panel.headerStatus.kind === 'success',
          }"
        >
          {{ panel.headerStatus.message }}
        </span>
      </div>
      <fieldset
        class="graphwar-killer__settings-fields"
        :disabled="panel.interactionDisabled"
      >
        <div
          v-if="panel.toolWorkflowMode !== 'simulator'"
          class="graphwar-killer__setting-row"
        >
          <span class="graphwar-killer__setting-label">{{ locale.ui.settings.algorithm }}</span>
          <div
            class="graphwar-killer__tool-toggle graphwar-killer__algorithm-toggle graphwar-killer-segmented-control"
            :class="`graphwar-killer__algorithm-toggle--${panel.algorithmMode}`"
            role="group"
            :aria-label="locale.ui.settings.algorithmAriaLabel"
            :title="locale.ui.settings.algorithmTitle"
          >
            <button
              v-for="mode in panel.algorithmModes"
              :key="mode.value"
              type="button"
              class="graphwar-killer-segmented-button"
              :aria-pressed="panel.algorithmMode === mode.value"
              :class="{ 'graphwar-killer-segmented-button--active': panel.algorithmMode === mode.value }"
              :disabled="mode.disabled"
              :title="mode.title"
              @click="emit('setAlgorithmMode', mode.value)"
            >
              {{ mode.label }}
            </button>
          </div>
        </div>
        <div class="graphwar-killer__formula-options">
          <template v-if="panel.toolWorkflowMode !== 'simulator'">
            <label
              class="graphwar-killer__precision-label"
              :title="locale.ui.settings.decimalPlacesTitle"
            >
              {{ locale.ui.settings.decimalPlaces }}
              <input
                v-model="precisionText"
                inputmode="numeric"
                autocomplete="off"
                min="0"
                :max="panel.precision.maximum"
                :aria-label="locale.ui.settings.decimalPlacesAriaLabel"
                :title="locale.ui.settings.decimalPlacesTitle"
              >
            </label>
            <label
              v-if="panel.steepnessVisible"
              class="graphwar-killer__steepness-label"
              :title="locale.ui.settings.steepnessTitle"
            >
              {{ locale.ui.settings.steepness }}
              <input
                v-model="steepnessText"
                inputmode="decimal"
                autocomplete="off"
                :aria-label="locale.ui.settings.steepnessAriaLabel"
                :title="locale.ui.settings.steepnessTitle"
              >
            </label>
            <ToggleField
              v-if="panel.algorithmMode === 'step'"
              id="graphwar-killer-overflow-protection"
              class="graphwar-killer__formula-toggle"
              :checked="panel.stepOverflowProtectionEnabled"
              :label="locale.ui.settings.overflowProtection"
              state="normal"
              :title="locale.ui.settings.overflowProtectionTitle"
              @toggle="emit('toggleStepOverflowProtection')"
            />
            <ToggleField
              id="graphwar-killer-step-glitch-mode"
              class="graphwar-killer__formula-toggle"
              :checked="panel.stepGlitchModeEnabled"
              :label="locale.ui.settings.stepGlitchMode"
              :reason="panel.stepGlitchModeReason"
              :state="panel.stepGlitchModeState"
              :title="locale.ui.settings.stepGlitchModeTitle"
              @toggle="emit('toggleStepGlitchMode')"
            />
          </template>
          <ToggleField
            id="graphwar-killer-advanced-settings"
            class="graphwar-killer__formula-toggle"
            :checked="panel.advancedSettingsVisible"
            :label="locale.ui.settings.advancedSettings"
            :state="panel.interactionDisabled ? 'busy' : 'normal'"
            @pointercancel="emit('cancelDebugActivationHold')"
            @pointerdown="emit('startDebugActivationHold', $event)"
            @pointerleave="emit('cancelDebugActivationHold')"
            @pointerup="emit('finishDebugActivationHold')"
            @toggle="emit('toggleAdvancedSettings')"
          />
        </div>
      </fieldset>
    </section>
  </div>
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

.graphwar-killer__settings-stack {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.graphwar-killer__settings-stack h2 {
  border: 0;
  font-size: 1rem;
  margin: 0;
  padding: 0;
}

.graphwar-killer__settings-panel label {
  display: grid;
  font-weight: 600;
  gap: 3px;
  min-width: 0;
}

.graphwar-killer__settings-fields {
  border: 0;
  display: grid;
  gap: 8px;
  margin: 0;
  min-inline-size: 0;
  padding: 0;
}

.graphwar-killer__label-row {
  align-items: baseline;
  display: flex;
  gap: 8px;
  justify-content: space-between;
  min-width: 0;
}

.graphwar-killer__label-row > span {
  color: color-mix(in srgb, var(--vp-c-text-1) 68%, var(--vp-c-text-2) 32%);
  display: block;
  flex: 1 1 0;
  font-size: 0.88rem;
  line-height: 1.4;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.graphwar-killer__label-row > .graphwar-killer__label-status--error {
  color: #dc2626;
}

.graphwar-killer__label-row > .graphwar-killer__label-status--warning {
  color: #b45309;
  font-weight: 700;
}

.graphwar-killer__label-row > .graphwar-killer__label-status--success {
  color: #15803d;
  font-weight: 700;
}

.graphwar-killer__formula-options {
  align-items: flex-start;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  min-width: 0;
}

.graphwar-killer__formula-options > * {
  flex: 0 1 auto;
  max-width: 100%;
}

.graphwar-killer__formula-options > label,
.graphwar-killer__formula-options :deep(.graphwar-killer-toggle-field__text) {
  font-size: 0.9rem;
  font-weight: 700;
  line-height: 1.3;
}

.graphwar-killer__formula-toggle {
  padding: 4px 6px;
}

.graphwar-killer__steepness-label {
  align-items: center;
  gap: 6px;
  grid-template-columns: auto minmax(54px, 70px);
  justify-content: start;
}

.graphwar-killer__setting-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.graphwar-killer__setting-label {
  flex: 0 0 auto;
  font-weight: 600;
}

.graphwar-killer__setting-row > :not(.graphwar-killer__setting-label) {
  flex: 1 1 320px;
  min-width: 0;
}

.graphwar-killer__precision-label {
  align-items: center;
  gap: 6px;
  grid-template-columns: auto minmax(48px, 60px);
  justify-content: start;
}

.graphwar-killer__tool-toggle {
  --graphwar-killer-segment-count: 3;
}

.graphwar-killer__mode-toggle {
  --graphwar-killer-segment-count: 2;
}

.graphwar-killer__workflow-panel .graphwar-killer__mode-toggle,
.graphwar-killer__game-mode-panel .graphwar-killer__equation-toggle {
  width: 100%;
}

.graphwar-killer__mode-toggle--simulator::before {
  transform: translateX(100%);
}

.graphwar-killer__algorithm-toggle {
  --graphwar-killer-segment-count: 4;
  min-height: 38px;
}

.graphwar-killer__algorithm-toggle--step::before {
  transform: translateX(100%);
}

.graphwar-killer__algorithm-toggle--pchip::before {
  transform: translateX(200%);
}

.graphwar-killer__algorithm-toggle--akima::before {
  transform: translateX(300%);
}

.graphwar-killer__tool-toggle.graphwar-killer__algorithm-toggle button {
  font-size: 0.82rem;
  line-height: 1.15;
  min-height: 32px;
  padding: 4px 7px;
}

.graphwar-killer__equation-toggle {
  --graphwar-killer-segment-count: 3;
  flex: 0 1 230px;
  width: min(100%, 230px);
}

.graphwar-killer__equation-toggle--dy::before {
  transform: translateX(100%);
}

.graphwar-killer__equation-toggle--ddy::before {
  transform: translateX(200%);
}

.graphwar-killer__equation-toggle .graphwar-killer-segmented-button {
  line-height: 1.2;
  padding: 4px 7px;
  white-space: nowrap;
}

@media (width <= 760px) {
  .graphwar-killer__label-row {
    display: grid;
    gap: 4px;
  }

  .graphwar-killer__label-row > span {
    text-align: left;
  }
}

@media (width <= 520px) {
  .graphwar-killer__setting-row {
    display: grid;
    grid-template-columns: 1fr;
  }
}
</style>
