<script setup lang="ts">
import { computed } from "vue";

import type { GraphwarKillerLocale } from "../../locale-types";

interface GraphwarAdvancedSettingsBounds {
  /** X 轴最小值输入框文本；非法输入应原样交回父页面校验。 */
  minXText: string;
  /** X 轴最大值输入框文本；非法输入应原样交回父页面校验。 */
  maxXText: string;
  /** Y 轴最小值输入框文本；非法输入应原样交回父页面校验。 */
  minYText: string;
  /** Y 轴最大值输入框文本；非法输入应原样交回父页面校验。 */
  maxYText: string;
}

interface GraphwarAdvancedSettingsSimulator {
  /** 模拟器解析时是否忽略未知字符。 */
  skipUnknownCharacters: boolean;
  /** 模拟器解析时是否把导数表达式当作 y 处理。 */
  parseDerivativeAsY: boolean;
}

interface GraphwarAdvancedSettingsRecognition {
  /** 最大士兵数量输入框文本。 */
  maximumSoldierCountText: string;
  /** 士兵模板候选顶部比例输入框文本。 */
  candidateTopRatioText: string;
  /** 模板匹配 worker 数输入框文本。 */
  templateMatchingWorkerCountText: string;
  /** 障碍最小面积输入框文本。 */
  obstacleMinAreaText: string;
  /** 障碍最大面积；父页面应按当前 Graphwar 平面尺寸传入。 */
  obstacleMaximumArea: number;
  /** 自动识别边界外扩输入框文本。 */
  pathfindingBoundaryExpansionText: string;
}

interface GraphwarAdvancedSettingsPathfinding {
  /** 当前障碍外扩配置所属来源；两套输入互不覆盖。 */
  obstacleExpansionMode: "agent" | "detection";
  /** 路径规划障碍外扩输入框文本。 */
  routePlanningToleranceText: string;
  /** 轨迹模拟障碍外扩输入框文本。 */
  obstacleSimulationToleranceText: string;
  /** 寻路 worker 数输入框文本。 */
  workerCountText: string;
  /** 一键清图删除检测半径输入框文本。 */
  oneClickClearDeleteCheckRadiusText: string;
  /** 一键清图删除检测半径最小值，单位为 Graphwar 原始平面像素。 */
  oneClickClearDeleteCheckRadiusMinimumPlanePixels: number;
}

export interface GraphwarAdvancedSettingsPanelModel {
  /** 坐标边界设置展示模型。 */
  bounds: GraphwarAdvancedSettingsBounds;
  /** 模拟器设置展示模型。 */
  simulator: GraphwarAdvancedSettingsSimulator;
  /** 识别设置展示模型。 */
  recognition: GraphwarAdvancedSettingsRecognition;
  /** 寻路设置展示模型。 */
  pathfinding: GraphwarAdvancedSettingsPathfinding;
}

const props = defineProps<{
  /** 页面本地化文案。 */
  locale: GraphwarKillerLocale;
  /** 高级设置面板展示模型。 */
  panel: GraphwarAdvancedSettingsPanelModel;
}>();

const emit = defineEmits<{
  toggleSimulatorParseDerivativeAsY: [];
  toggleSimulatorSkipUnknownCharacters: [];
  updateCandidateTopRatioText: [value: string];
  updateMaxXText: [value: string];
  updateMaxYText: [value: string];
  updateMaximumSoldierCountText: [value: string];
  updateMinXText: [value: string];
  updateMinYText: [value: string];
  updateObstacleMinAreaText: [value: string];
  updateObstacleSimulationToleranceText: [value: string];
  updateOneClickClearDeleteCheckRadiusText: [value: string];
  updatePathfindingBoundaryExpansionText: [value: string];
  updatePathfindingWorkerCountText: [value: string];
  updateRoutePlanningToleranceText: [value: string];
  updateTemplateMatchingWorkerCountText: [value: string];
}>();

const minXText = computed({
  get: () => props.panel.bounds.minXText,
  set: (value) => emit("updateMinXText", value),
});

const maxXText = computed({
  get: () => props.panel.bounds.maxXText,
  set: (value) => emit("updateMaxXText", value),
});

const minYText = computed({
  get: () => props.panel.bounds.minYText,
  set: (value) => emit("updateMinYText", value),
});

const maxYText = computed({
  get: () => props.panel.bounds.maxYText,
  set: (value) => emit("updateMaxYText", value),
});

const maximumSoldierCountText = computed({
  get: () => props.panel.recognition.maximumSoldierCountText,
  set: (value) => emit("updateMaximumSoldierCountText", value),
});

const candidateTopRatioText = computed({
  get: () => props.panel.recognition.candidateTopRatioText,
  set: (value) => emit("updateCandidateTopRatioText", value),
});

const templateMatchingWorkerCountText = computed({
  get: () => props.panel.recognition.templateMatchingWorkerCountText,
  set: (value) => emit("updateTemplateMatchingWorkerCountText", value),
});

const obstacleMinAreaText = computed({
  get: () => props.panel.recognition.obstacleMinAreaText,
  set: (value) => emit("updateObstacleMinAreaText", value),
});

const pathfindingBoundaryExpansionText = computed({
  get: () => props.panel.recognition.pathfindingBoundaryExpansionText,
  set: (value) => emit("updatePathfindingBoundaryExpansionText", value),
});

const routePlanningToleranceText = computed({
  get: () => props.panel.pathfinding.routePlanningToleranceText,
  set: (value) => emit("updateRoutePlanningToleranceText", value),
});

const obstacleSimulationToleranceText = computed({
  get: () => props.panel.pathfinding.obstacleSimulationToleranceText,
  set: (value) => emit("updateObstacleSimulationToleranceText", value),
});

const pathfindingWorkerCountText = computed({
  get: () => props.panel.pathfinding.workerCountText,
  set: (value) => emit("updatePathfindingWorkerCountText", value),
});

const oneClickClearDeleteCheckRadiusText = computed({
  get: () => props.panel.pathfinding.oneClickClearDeleteCheckRadiusText,
  set: (value) => emit("updateOneClickClearDeleteCheckRadiusText", value),
});
</script>

<template>
  <section
    class="graphwar-killer__panel graphwar-killer__advanced-settings-panel"
    aria-labelledby="graphwar-killer-advanced-settings-title"
  >
    <div class="graphwar-killer__label-row">
      <h2 id="graphwar-killer-advanced-settings-title">
        {{ locale.ui.settings.advancedSettings }}
      </h2>
    </div>
    <div class="graphwar-killer__advanced-settings-grid">
      <div class="graphwar-killer__subpanel graphwar-killer__advanced-settings-group">
        <h3>
          {{ locale.ui.settings.bounds.heading }}
        </h3>
        <div class="graphwar-killer__coordinate-grid">
          <label :title="locale.ui.settings.bounds.minXTitle">
            -x
            <input
              v-model="minXText"
              inputmode="decimal"
              autocomplete="off"
              :aria-label="locale.ui.settings.bounds.minXAriaLabel"
              :title="locale.ui.settings.bounds.minXTitle"
            >
          </label>
          <label :title="locale.ui.settings.bounds.maxXTitle">
            +x
            <input
              v-model="maxXText"
              inputmode="decimal"
              autocomplete="off"
              :aria-label="locale.ui.settings.bounds.maxXAriaLabel"
              :title="locale.ui.settings.bounds.maxXTitle"
            >
          </label>
          <label :title="locale.ui.settings.bounds.minYTitle">
            -y
            <input
              v-model="minYText"
              inputmode="decimal"
              autocomplete="off"
              :aria-label="locale.ui.settings.bounds.minYAriaLabel"
              :title="locale.ui.settings.bounds.minYTitle"
            >
          </label>
          <label :title="locale.ui.settings.bounds.maxYTitle">
            +y
            <input
              v-model="maxYText"
              inputmode="decimal"
              autocomplete="off"
              :aria-label="locale.ui.settings.bounds.maxYAriaLabel"
              :title="locale.ui.settings.bounds.maxYTitle"
            >
          </label>
        </div>
      </div>
      <div class="graphwar-killer__subpanel graphwar-killer__advanced-settings-group">
        <h3>
          {{ locale.ui.settings.simulator }}
        </h3>
        <div class="graphwar-killer__image-actions">
          <button
            type="button"
            :aria-pressed="panel.simulator.skipUnknownCharacters"
            :class="{ 'graphwar-killer__toggle-button--active': panel.simulator.skipUnknownCharacters }"
            :title="locale.ui.settings.skipUnknownCharactersTitle"
            @click="emit('toggleSimulatorSkipUnknownCharacters')"
          >
            {{ locale.ui.settings.skipUnknownCharacters }}
          </button>
          <button
            type="button"
            :aria-pressed="panel.simulator.parseDerivativeAsY"
            :class="{ 'graphwar-killer__toggle-button--active': panel.simulator.parseDerivativeAsY }"
            :title="locale.ui.settings.parseDerivativeAsYTitle"
            @click="emit('toggleSimulatorParseDerivativeAsY')"
          >
            {{ locale.ui.settings.parseDerivativeAsY }}
          </button>
        </div>
      </div>
      <div class="graphwar-killer__subpanel graphwar-killer__advanced-settings-group">
        <h3>
          {{ locale.ui.settings.recognition.heading }}
        </h3>
        <div class="graphwar-killer__recognition-setting-row">
          <label
            class="graphwar-killer__detection-setting-label"
            :title="locale.ui.settings.recognition.maximumSoldierCountTitle"
          >
            {{ locale.ui.settings.recognition.maximumSoldierCount }}
            <input
              v-model="maximumSoldierCountText"
              inputmode="numeric"
              min="1"
              autocomplete="off"
              :aria-label="locale.ui.settings.recognition.maximumSoldierCountAriaLabel"
              :title="locale.ui.settings.recognition.maximumSoldierCountTitle"
            >
          </label>
          <label
            class="graphwar-killer__detection-setting-label"
            :title="locale.ui.settings.recognition.candidateTopRatioTitle"
          >
            {{ locale.ui.settings.recognition.candidateTopRatio }}
            <input
              v-model="candidateTopRatioText"
              inputmode="decimal"
              min="0.000001"
              max="1"
              step="0.01"
              autocomplete="off"
              :aria-label="locale.ui.settings.recognition.candidateTopRatioAriaLabel"
              :title="locale.ui.settings.recognition.candidateTopRatioTitle"
            >
          </label>
          <label
            class="graphwar-killer__detection-setting-label"
            :title="locale.ui.settings.recognition.templateMatchingWorkerCountTitle"
          >
            {{ locale.ui.settings.recognition.templateMatchingWorkerCount }}
            <input
              v-model="templateMatchingWorkerCountText"
              inputmode="numeric"
              min="1"
              max="128"
              autocomplete="off"
              :aria-label="locale.ui.settings.recognition.templateMatchingWorkerCountAriaLabel"
              :title="locale.ui.settings.recognition.templateMatchingWorkerCountTitle"
            >
          </label>
          <label
            class="graphwar-killer__detection-setting-label"
            :title="locale.ui.detection.minObstacleAreaTitle"
          >
            {{ locale.ui.detection.minObstacleArea }}
            <input
              v-model="obstacleMinAreaText"
              inputmode="numeric"
              min="0"
              :max="panel.recognition.obstacleMaximumArea"
              :aria-label="locale.ui.detection.minObstacleAreaAriaLabel"
              :title="locale.ui.detection.minObstacleAreaTitle"
            >
            <span>px²</span>
          </label>
          <label
            class="graphwar-killer__detection-setting-label"
            :title="locale.ui.pathfinding.boundaryExpansionTitle"
          >
            {{ locale.ui.pathfinding.boundaryExpansion }}
            <input
              v-model="pathfindingBoundaryExpansionText"
              inputmode="decimal"
              min="0"
              :aria-label="locale.ui.pathfinding.boundaryExpansionAriaLabel"
              :title="locale.ui.pathfinding.boundaryExpansionTitle"
            >
            <span>{{ locale.ui.pathfinding.unit }}</span>
          </label>
        </div>
      </div>
      <div class="graphwar-killer__subpanel graphwar-killer__advanced-settings-group">
        <h3>
          {{ locale.ui.settings.pathfinding.heading }}
        </h3>
        <details class="graphwar-killer__details">
          <summary
            id="graphwar-killer-obstacle-expansion-title"
            :title="locale.ui.pathfinding.obstacleExpansionTitle"
          >
            {{ locale.ui.pathfinding.obstacleExpansion }}
            <span class="graphwar-killer__details-summary-note">
              {{
                panel.pathfinding.obstacleExpansionMode === "agent"
                  ? locale.ui.pathfinding.obstacleExpansionAgentMode
                  : locale.ui.pathfinding.obstacleExpansionDetectionMode
              }}
            </span>
          </summary>
          <div class="graphwar-killer__pathfinding-setting-grid">
            <label
              class="graphwar-killer__detection-setting-label graphwar-killer__pathfinding-setting-label"
              :title="locale.ui.pathfinding.routePlanningToleranceTitle"
            >
              {{ locale.ui.pathfinding.routePlanningTolerance }}
              <input
                v-model="routePlanningToleranceText"
                inputmode="decimal"
                :aria-label="locale.ui.pathfinding.routePlanningToleranceAriaLabel"
                :title="locale.ui.pathfinding.routePlanningToleranceTitle"
              >
              <span>{{ locale.ui.pathfinding.unit }}</span>
            </label>
            <label
              class="graphwar-killer__detection-setting-label graphwar-killer__pathfinding-setting-label"
              :title="locale.ui.pathfinding.simulationToleranceTitle"
            >
              {{ locale.ui.pathfinding.simulationTolerance }}
              <input
                v-model="obstacleSimulationToleranceText"
                inputmode="decimal"
                :aria-label="locale.ui.pathfinding.simulationToleranceAriaLabel"
                :title="locale.ui.pathfinding.simulationToleranceTitle"
              >
              <span>{{ locale.ui.pathfinding.unit }}</span>
            </label>
          </div>
        </details>
        <label
          class="graphwar-killer__detection-setting-label graphwar-killer__pathfinding-setting-label"
          :title="locale.ui.settings.pathfinding.workerCountTitle"
        >
          {{ locale.ui.settings.pathfinding.workerCount }}
          <input
            v-model="pathfindingWorkerCountText"
            inputmode="numeric"
            min="1"
            max="128"
            autocomplete="off"
            :aria-label="locale.ui.settings.pathfinding.workerCountAriaLabel"
            :title="locale.ui.settings.pathfinding.workerCountTitle"
          >
        </label>
        <label
          class="graphwar-killer__detection-setting-label graphwar-killer__pathfinding-setting-label"
          :title="locale.ui.pathfinding.oneClickClearDeleteCheckRadiusTitle"
        >
          {{ locale.ui.pathfinding.oneClickClearDeleteCheckRadius }}
          <input
            v-model="oneClickClearDeleteCheckRadiusText"
            inputmode="decimal"
            :min="panel.pathfinding.oneClickClearDeleteCheckRadiusMinimumPlanePixels"
            step="0.1"
            :aria-label="locale.ui.pathfinding.oneClickClearDeleteCheckRadiusAriaLabel"
            :title="locale.ui.pathfinding.oneClickClearDeleteCheckRadiusTitle"
          >
          <span>{{ locale.ui.pathfinding.unit }}</span>
        </label>
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

.graphwar-killer__advanced-settings-panel h2 {
  border: 0;
  font-size: 1rem;
  margin: 0;
  padding: 0;
}

.graphwar-killer__advanced-settings-panel label {
  display: grid;
  font-weight: 600;
  gap: 3px;
  min-width: 0;
}

.graphwar-killer__advanced-settings-panel input:not([type="file"]) {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  box-sizing: border-box;
  font-variant-numeric: tabular-nums;
  height: 30px;
  line-height: 1.15;
  min-height: 0;
  padding: 4px 8px;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background-color 0.2s ease;
  width: 100%;
}

.graphwar-killer__advanced-settings-panel button {
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

.graphwar-killer__advanced-settings-panel button:disabled {
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

.graphwar-killer__image-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.graphwar-killer__image-actions button {
  min-height: 34px;
  padding: 6px 10px;
}

.graphwar-killer__subpanel {
  background: var(--vp-c-bg-soft);
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 82%, transparent);
  border-radius: 8px;
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 8px;
}

.graphwar-killer__subpanel h3 {
  font-size: 0.92rem;
  line-height: 1.4;
  margin: 0;
}

.graphwar-killer__advanced-settings-grid {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.graphwar-killer__advanced-settings-group {
  align-content: start;
}

.graphwar-killer__details {
  gap: 0;
}

.graphwar-killer__details[open] {
  gap: 8px;
}

.graphwar-killer__details > summary {
  cursor: pointer;
  font-size: 0.92rem;
  font-weight: 700;
  line-height: 1.4;
  margin: -2px 0;
}

.graphwar-killer__details-summary-note {
  color: color-mix(in srgb, var(--vp-c-text-1) 62%, var(--vp-c-text-2) 38%);
  font-size: 0.84rem;
  font-weight: 600;
  margin-left: 6px;
}

.graphwar-killer__details > summary:focus-visible {
  border-radius: 4px;
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.graphwar-killer__details[open] > summary {
  margin-bottom: 6px;
}

.graphwar-killer__pathfinding-setting-grid {
  display: grid;
  gap: 6px;
  min-width: 0;
}

/* 寻路数值项有的在 details 内、有的直接在分组内；统一收紧宽度，避免父 grid 拉伸后把输入框推右。 */
.graphwar-killer__pathfinding-setting-label {
  grid-template-columns: max-content minmax(74px, 92px) auto;
  justify-self: start;
}

.graphwar-killer__recognition-setting-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.graphwar-killer__recognition-setting-row .graphwar-killer__detection-setting-label {
  grid-template-columns: max-content minmax(74px, 92px) auto;
  min-width: 0;
}

.graphwar-killer__coordinate-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
}

.graphwar-killer__coordinate-grid label {
  align-items: center;
  gap: 6px;
  grid-template-columns: auto minmax(0, 1fr);
}

.graphwar-killer__detection-setting-label {
  align-items: center;
  font-weight: 600;
  gap: 6px;
  grid-template-columns: auto minmax(74px, 92px) auto;
}

.graphwar-killer__detection-setting-label span {
  color: color-mix(in srgb, var(--vp-c-text-1) 68%, var(--vp-c-text-2) 32%);
  font-size: 0.88rem;
  font-weight: 500;
}

.graphwar-killer__toggle-button--active {
  background: var(--vp-c-brand-soft) !important;
  border-color: var(--vp-c-brand-1) !important;
  color: var(--vp-c-brand-1) !important;
}

.graphwar-killer__advanced-settings-panel button:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 8px 20px rgb(15 23 42 / 6%);
  color: var(--vp-c-brand-1);
  transform: translateY(-1px);
}

.graphwar-killer__advanced-settings-panel input:focus-visible,
.graphwar-killer__advanced-settings-panel button:focus-visible {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 52%, var(--vp-c-divider));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--vp-c-brand-1) 16%, transparent);
  outline: none;
}

@media (width <= 760px) {
  .graphwar-killer__label-row {
    display: grid;
    gap: 4px;
  }
}

@media (width <= 520px) {
  .graphwar-killer__recognition-setting-row {
    display: grid;
    grid-template-columns: 1fr;
  }
}
</style>
