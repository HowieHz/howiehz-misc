<script setup lang="ts">
import { computed } from "vue";

import type { AlgorithmMode, EquationMode, ToolWorkflowMode } from "../../core/types";
import type { GraphwarKillerLocale } from "../../locale-types";

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
  /** 高级设置区是否展开。 */
  advancedSettingsVisible: boolean;
  /** 当前公式生成算法。 */
  algorithmMode: AlgorithmMode;
  /** 公式生成算法选项。 */
  algorithmModes: readonly GraphwarSettingsPanelOption<AlgorithmMode>[];
  /** 当前 Graphwar 方程解释模式。 */
  equationMode: EquationMode;
  /** Graphwar 方程解释模式选项。 */
  equationModes: readonly GraphwarSettingsPanelEquationOption[];
  /** 标题右侧状态展示模型。 */
  headerStatus: GraphwarSettingsPanelHeaderStatus;
  /** 公式小数位输入展示模型。 */
  precision: GraphwarSettingsPanelPrecision;
  /** Step 算法是否启用溢出保护。 */
  stepOverflowProtectionEnabled: boolean;
  /** Step 邪道模式按钮是否禁用。 */
  stepGlitchModeDisabled: boolean;
  /** Step 邪道模式是否启用；只有 y'= 模式会消费。 */
  stepGlitchModeEnabled: boolean;
  /** Step 陡峭度输入框当前文本；非法输入应原样保留给父页面校验。 */
  steepnessText: string;
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
</script>

<template>
  <section
    class="graphwar-killer__panel graphwar-killer__settings-panel"
    aria-labelledby="graphwar-killer-settings-title"
  >
    <div class="graphwar-killer__label-row">
      <h2 id="graphwar-killer-settings-title">
        {{ locale.ui.settings.title }}
      </h2>
      <span
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
    <div class="graphwar-killer__setting-row">
      <span class="graphwar-killer__setting-label">{{ locale.ui.settings.mode }}</span>
      <div
        class="graphwar-killer__tool-toggle graphwar-killer__mode-toggle"
        :class="{ 'graphwar-killer__mode-toggle--simulator': panel.toolWorkflowMode === 'simulator' }"
        role="group"
        :aria-label="locale.ui.settings.modeAriaLabel"
        :title="locale.ui.settings.modeTitle"
      >
        <button
          v-for="mode in panel.toolWorkflowModes"
          :key="mode.value"
          type="button"
          :aria-pressed="panel.toolWorkflowMode === mode.value"
          :class="{ 'graphwar-killer__tool-toggle-button--active': panel.toolWorkflowMode === mode.value }"
          :title="mode.title"
          @click="emit('setToolWorkflowMode', mode.value)"
        >
          {{ mode.label }}
        </button>
      </div>
    </div>
    <div
      v-if="panel.toolWorkflowMode !== 'simulator'"
      class="graphwar-killer__setting-row"
    >
      <span class="graphwar-killer__setting-label">{{ locale.ui.settings.algorithm }}</span>
      <div
        class="graphwar-killer__tool-toggle graphwar-killer__algorithm-toggle"
        :class="`graphwar-killer__algorithm-toggle--${panel.algorithmMode}`"
        role="group"
        :aria-label="locale.ui.settings.algorithmAriaLabel"
        :title="locale.ui.settings.algorithmTitle"
      >
        <button
          v-for="mode in panel.algorithmModes"
          :key="mode.value"
          type="button"
          :aria-pressed="panel.algorithmMode === mode.value"
          :class="{ 'graphwar-killer__tool-toggle-button--active': panel.algorithmMode === mode.value }"
          :title="mode.title"
          @click="emit('setAlgorithmMode', mode.value)"
        >
          {{ mode.label }}
        </button>
      </div>
    </div>
    <div
      v-if="panel.toolWorkflowMode !== 'simulator' && panel.algorithmMode === 'step'"
      class="graphwar-killer__step-settings"
    >
      <label
        class="graphwar-killer__steepness-label"
        :title="locale.ui.settings.stepSteepnessTitle"
      >
        {{ locale.ui.settings.stepSteepness }}
        <input
          v-model="steepnessText"
          inputmode="decimal"
          autocomplete="off"
          :aria-label="locale.ui.settings.stepSteepnessAriaLabel"
          :title="locale.ui.settings.stepSteepnessTitle"
        >
      </label>
      <button
        type="button"
        :aria-pressed="panel.stepOverflowProtectionEnabled"
        :class="{ 'graphwar-killer__toggle-button--active': panel.stepOverflowProtectionEnabled }"
        :title="locale.ui.settings.overflowProtectionTitle"
        @click="emit('toggleStepOverflowProtection')"
      >
        {{ locale.ui.settings.overflowProtection }}
      </button>
      <button
        type="button"
        :aria-pressed="panel.stepGlitchModeEnabled"
        :class="{ 'graphwar-killer__toggle-button--active': panel.stepGlitchModeEnabled }"
        :disabled="panel.stepGlitchModeDisabled"
        :title="locale.ui.settings.stepGlitchModeTitle"
        @click="emit('toggleStepGlitchMode')"
      >
        {{ locale.ui.settings.stepGlitchMode }}
      </button>
    </div>
    <div class="graphwar-killer__setting-row graphwar-killer__game-mode-row">
      <span class="graphwar-killer__setting-label">{{ locale.ui.settings.gameMode }}</span>
      <div class="graphwar-killer__game-mode-controls">
        <div
          class="graphwar-killer__equation-toggle"
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
            :aria-pressed="panel.equationMode === mode.value"
            :class="{ 'graphwar-killer__equation-toggle-button--active': panel.equationMode === mode.value }"
            :disabled="mode.disabled"
            :title="mode.title"
            @click="emit('setEquationMode', mode.value)"
          >
            {{ mode.label }}
          </button>
        </div>
        <label
          v-if="panel.toolWorkflowMode !== 'simulator'"
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
        <button
          type="button"
          class="graphwar-killer__secondary-button"
          :aria-expanded="panel.advancedSettingsVisible"
          :aria-pressed="panel.advancedSettingsVisible"
          :class="{ 'graphwar-killer__toggle-button--active': panel.advancedSettingsVisible }"
          @keydown.enter.prevent="emit('toggleAdvancedSettings')"
          @keydown.space.prevent="emit('toggleAdvancedSettings')"
          @pointercancel="emit('cancelDebugActivationHold')"
          @pointerdown.prevent="emit('startDebugActivationHold', $event)"
          @pointerleave="emit('cancelDebugActivationHold')"
          @pointerup.prevent="emit('finishDebugActivationHold')"
        >
          {{ locale.ui.settings.advancedSettings }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.graphwar-killer__panel {
  align-content: start;
  background: var(--vp-c-bg);
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 88%, transparent);
  border-radius: 12px;
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 10px;
}

.graphwar-killer__settings-panel h2 {
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

.graphwar-killer__settings-panel input:not([type="file"]) {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  box-sizing: border-box;
  font-variant-numeric: tabular-nums;
  height: 30px;
  line-height: 1.15;
  min-height: 0;
  min-width: 0;
  padding: 4px 8px;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background-color 0.2s ease;
  width: 100%;
}

.graphwar-killer__settings-panel button {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-family: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  line-height: 1.2;
  transition:
    transform 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    color 0.2s ease,
    background-color 0.2s ease;
}

.graphwar-killer__settings-panel button:disabled {
  cursor: not-allowed;
  opacity: 58%;
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

.graphwar-killer__step-settings {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.graphwar-killer__step-settings button {
  min-height: 34px;
  padding: 6px 10px;
}

.graphwar-killer__steepness-label {
  align-items: center;
  flex: 1 1 220px;
  gap: 6px;
  grid-template-columns: auto minmax(0, 1fr);
  min-width: min(100%, 220px);
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

.graphwar-killer__game-mode-controls {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.graphwar-killer__precision-label {
  align-items: center;
  font-weight: 600;
  gap: 6px;
  grid-template-columns: auto minmax(74px, 92px);
}

.graphwar-killer__tool-toggle {
  background: color-mix(in srgb, var(--vp-c-bg-soft) 68%, var(--vp-c-bg));
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  display: grid;
  gap: 0;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  min-height: 34px;
  min-width: 0;
  overflow: hidden;
  padding: 2px;
  position: relative;
}

.graphwar-killer__tool-toggle::before {
  background: var(--vp-c-brand-1);
  border-radius: 999px;
  bottom: 2px;
  box-shadow: 0 6px 14px rgb(15 23 42 / 12%);
  content: "";
  left: 2px;
  position: absolute;
  top: 2px;
  transition: transform 0.2s ease;
  width: calc((100% - 4px) / 3);
}

.graphwar-killer__mode-toggle {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.graphwar-killer__mode-toggle::before {
  width: calc((100% - 4px) / 2);
}

.graphwar-killer__mode-toggle--simulator::before {
  transform: translateX(100%);
}

.graphwar-killer__algorithm-toggle {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  min-height: 38px;
}

.graphwar-killer__algorithm-toggle::before {
  width: calc((100% - 4px) / 4);
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

.graphwar-killer__tool-toggle button {
  background: transparent;
  border: 0;
  border-radius: 999px;
  box-shadow: none;
  color: color-mix(in srgb, var(--vp-c-text-1) 64%, var(--vp-c-text-2) 36%);
  font-size: 0.9rem;
  line-height: 1.15;
  min-height: 28px;
  min-width: 0;
  overflow-wrap: anywhere;
  padding: 4px 10px;
  position: relative;
  text-align: center;
  transform: none;
  white-space: normal;
  z-index: 1;
}

.graphwar-killer__tool-toggle button:hover {
  box-shadow: none;
  transform: none;
}

.graphwar-killer__tool-toggle-button--active {
  color: var(--vp-c-white) !important;
}

.graphwar-killer__equation-toggle {
  background: color-mix(in srgb, var(--vp-c-bg-soft) 68%, var(--vp-c-bg));
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  display: grid;
  flex: 0 1 230px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  min-height: 34px;
  overflow: hidden;
  padding: 2px;
  position: relative;
  width: min(100%, 230px);
}

.graphwar-killer__equation-toggle::before {
  background: var(--vp-c-brand-1);
  border-radius: 999px;
  bottom: 2px;
  box-shadow: 0 6px 14px rgb(15 23 42 / 12%);
  content: "";
  left: 2px;
  position: absolute;
  top: 2px;
  transition: transform 0.2s ease;
  width: calc((100% - 4px) / 3);
}

.graphwar-killer__equation-toggle--dy::before {
  transform: translateX(100%);
}

.graphwar-killer__equation-toggle--ddy::before {
  transform: translateX(200%);
}

.graphwar-killer__equation-toggle button {
  background: transparent;
  border: 0;
  border-radius: 999px;
  box-shadow: none;
  color: color-mix(in srgb, var(--vp-c-text-1) 64%, var(--vp-c-text-2) 36%);
  font-family: inherit;
  font-size: 0.9rem;
  line-height: 1.2;
  min-height: 28px;
  min-width: 0;
  padding: 4px 7px;
  position: relative;
  transform: none;
  white-space: nowrap;
  z-index: 1;
}

.graphwar-killer__equation-toggle button:hover {
  box-shadow: none;
  transform: none;
}

.graphwar-killer__equation-toggle-button--active {
  color: var(--vp-c-white) !important;
}

.graphwar-killer__secondary-button {
  min-height: 34px;
  min-width: 72px;
  padding: 6px 10px;
  white-space: nowrap;
}

.graphwar-killer__toggle-button--active {
  background: var(--vp-c-brand-soft) !important;
  border-color: var(--vp-c-brand-1) !important;
  color: var(--vp-c-brand-1) !important;
}

.graphwar-killer__settings-panel button:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 8px 20px rgb(15 23 42 / 6%);
  color: var(--vp-c-brand-1);
  transform: translateY(-1px);
}

.graphwar-killer__settings-panel .graphwar-killer__tool-toggle button:hover:not(:disabled) {
  box-shadow: none;
  color: color-mix(in srgb, var(--vp-c-text-1) 64%, var(--vp-c-text-2) 36%);
  transform: none;
}

.graphwar-killer__settings-panel .graphwar-killer__tool-toggle-button--active:hover:not(:disabled) {
  color: var(--vp-c-white);
}

.graphwar-killer__settings-panel .graphwar-killer__equation-toggle button:hover:not(:disabled) {
  box-shadow: none;
  color: color-mix(in srgb, var(--vp-c-text-1) 64%, var(--vp-c-text-2) 36%);
  transform: none;
}

.graphwar-killer__settings-panel .graphwar-killer__equation-toggle-button--active:hover:not(:disabled) {
  color: var(--vp-c-white);
}

.graphwar-killer__settings-panel input:focus-visible,
.graphwar-killer__settings-panel button:focus-visible {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 52%, var(--vp-c-divider));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--vp-c-brand-1) 16%, transparent);
  outline: none;
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
