<script setup lang="ts">
import type { CSSProperties } from "vue";

import type { ToolMode } from "../../core/types";
import type { GraphwarKillerLocale } from "../../locale-types";

interface GraphwarActionPanelSlider {
  /** 输入框允许的最大值。 */
  inputMaximum: number;
  /** 控件允许的最小值。 */
  minimum: number;
  /** Range 控件当前值。 */
  sliderValue: number;
  /** Range 控件允许的最大值。 */
  sliderMaximum: number;
  /** Range 进度条样式。 */
  rangeStyle: CSSProperties;
  /** 文本输入框当前值；非法输入应原样保留给父页面校验。 */
  text: string;
}

export interface GraphwarActionPanelModel {
  /** 标题行右侧的当前工具提示。 */
  activeToolHint: string;
  /** 放大镜是否开启。 */
  magnifierEnabled: boolean;
  /** 放大镜缩放输入展示模型。 */
  magnifierZoom: GraphwarActionPanelSlider;
  /** 障碍笔刷是否可用。 */
  obstacleBrushAvailable: boolean;
  /** 障碍笔刷直径输入展示模型。 */
  obstacleBrushDiameter: GraphwarActionPanelSlider;
  /** 障碍笔刷是否处于擦除模式。 */
  obstacleBrushEraseEnabled: boolean;
  /** 是否展示障碍笔刷控件。 */
  obstacleBrushControlsVisible: boolean;
  /** 当前是否有未清除的障碍编辑。 */
  obstacleEditsDirty: boolean;
  /** 实时点击预览是否开启。 */
  liveClickPreviewEnabled: boolean;
  /** 当前工具模式。 */
  toolMode: ToolMode;
}

defineProps<{
  /** 页面本地化文案。 */
  locale: GraphwarKillerLocale;
  /** 操作面板展示模型。 */
  panel: GraphwarActionPanelModel;
}>();

const emit = defineEmits<{
  clearObstacleEdits: [];
  clearPath: [];
  setToolMode: [mode: ToolMode];
  toggleLiveClickPreview: [];
  toggleMagnifier: [];
  toggleObstacleBrushErase: [];
  undoPoint: [];
  updateMagnifierZoom: [value: string];
  updateObstacleBrushDiameter: [value: string];
}>();

function getInputValue(event: Event) {
  const input = event.target;
  return input instanceof HTMLInputElement ? input.value : undefined;
}

function handleMagnifierZoomInput(event: Event) {
  const value = getInputValue(event);
  if (value === undefined) {
    return;
  }
  emit("updateMagnifierZoom", value);
}

function handleObstacleBrushDiameterInput(event: Event) {
  const value = getInputValue(event);
  if (value === undefined) {
    return;
  }
  emit("updateObstacleBrushDiameter", value);
}
</script>

<template>
  <section
    class="graphwar-killer__panel graphwar-killer__action-panel"
    aria-labelledby="graphwar-killer-actions-title"
  >
    <div class="graphwar-killer__label-row">
      <h2 id="graphwar-killer-actions-title">
        {{ locale.ui.actions.title }}
      </h2>
      <span :title="panel.activeToolHint">{{ panel.activeToolHint }}</span>
    </div>
    <div class="graphwar-killer__image-actions">
      <div
        class="graphwar-killer__tool-toggle"
        :class="{
          'graphwar-killer__tool-toggle--path': panel.toolMode === 'path',
          'graphwar-killer__tool-toggle--obstacle': panel.toolMode === 'obstacle',
        }"
        role="group"
        :aria-label="locale.ui.actions.toolModeAriaLabel"
        :title="locale.ui.actions.toolModeTitle"
      >
        <button
          type="button"
          :aria-pressed="panel.toolMode === 'bounds'"
          :class="{ 'graphwar-killer__tool-toggle-button--active': panel.toolMode === 'bounds' }"
          :title="locale.ui.actions.pickBoundsTitle"
          @click="emit('setToolMode', 'bounds')"
        >
          {{ locale.ui.actions.pickBounds }}
        </button>
        <button
          type="button"
          :aria-pressed="panel.toolMode === 'path'"
          :class="{ 'graphwar-killer__tool-toggle-button--active': panel.toolMode === 'path' }"
          :title="locale.ui.actions.pickPathTitle"
          @click="emit('setToolMode', 'path')"
        >
          {{ locale.ui.actions.pickPath }}
        </button>
        <button
          type="button"
          :aria-pressed="panel.toolMode === 'obstacle'"
          :class="{ 'graphwar-killer__tool-toggle-button--active': panel.toolMode === 'obstacle' }"
          :disabled="!panel.obstacleBrushAvailable"
          :title="locale.ui.actions.drawObstacleTitle"
          @click="emit('setToolMode', 'obstacle')"
        >
          {{ locale.ui.actions.drawObstacle }}
        </button>
      </div>
      <button
        type="button"
        :aria-pressed="panel.magnifierEnabled"
        :class="{ 'graphwar-killer__toggle-button--active': panel.magnifierEnabled }"
        :title="locale.ui.actions.magnifierTitle"
        @click="emit('toggleMagnifier')"
      >
        {{ locale.ui.actions.magnifier }}
      </button>
      <label
        v-if="panel.magnifierEnabled"
        class="graphwar-killer__magnifier-zoom-label"
        :title="locale.ui.actions.magnifierZoomTitle"
      >
        {{ locale.ui.actions.magnifierZoom }}
        <input
          type="range"
          :value="panel.magnifierZoom.sliderValue"
          :style="panel.magnifierZoom.rangeStyle"
          :min="panel.magnifierZoom.minimum"
          :max="panel.magnifierZoom.sliderMaximum"
          step="0.1"
          :aria-label="locale.ui.actions.magnifierZoomAriaLabel"
          :title="locale.ui.actions.magnifierZoomTitle"
          @input="handleMagnifierZoomInput"
        >
        <input
          type="number"
          :value="panel.magnifierZoom.text"
          inputmode="decimal"
          :min="panel.magnifierZoom.minimum"
          :max="panel.magnifierZoom.inputMaximum"
          step="0.1"
          :aria-label="locale.ui.actions.magnifierZoomAriaLabel"
          :title="locale.ui.actions.magnifierZoomTitle"
          @input="handleMagnifierZoomInput"
        >
        <span>x</span>
      </label>
    </div>
    <div
      v-if="panel.toolMode === 'path'"
      class="graphwar-killer__path-actions"
    >
      <button
        type="button"
        :title="locale.ui.actions.clearPathTitle"
        @click="emit('clearPath')"
      >
        {{ locale.ui.actions.clearPath }}
      </button>
      <button
        type="button"
        :title="locale.ui.actions.undoPointTitle"
        @click="emit('undoPoint')"
      >
        {{ locale.ui.actions.undoPoint }}
      </button>
      <button
        type="button"
        :aria-pressed="panel.liveClickPreviewEnabled"
        :class="{ 'graphwar-killer__toggle-button--active': panel.liveClickPreviewEnabled }"
        :title="locale.ui.actions.liveClickPreviewTitle"
        @click="emit('toggleLiveClickPreview')"
      >
        {{ locale.ui.actions.liveClickPreview }}
      </button>
    </div>
    <div
      v-if="panel.obstacleBrushControlsVisible"
      class="graphwar-killer__obstacle-brush-actions"
    >
      <label
        class="graphwar-killer__obstacle-brush-label"
        :title="locale.ui.actions.obstacleBrushDiameterTitle"
      >
        {{ locale.ui.actions.obstacleBrushDiameter }}
        <input
          type="range"
          :value="panel.obstacleBrushDiameter.sliderValue"
          class="graphwar-killer__obstacle-brush-range"
          :style="panel.obstacleBrushDiameter.rangeStyle"
          :min="panel.obstacleBrushDiameter.minimum"
          :max="panel.obstacleBrushDiameter.sliderMaximum"
          step="1"
          :aria-label="locale.ui.actions.obstacleBrushDiameterAriaLabel"
          :title="locale.ui.actions.obstacleBrushDiameterTitle"
          @input="handleObstacleBrushDiameterInput"
        >
        <input
          type="number"
          :value="panel.obstacleBrushDiameter.text"
          inputmode="numeric"
          :min="panel.obstacleBrushDiameter.minimum"
          :max="panel.obstacleBrushDiameter.inputMaximum"
          step="1"
          :aria-label="locale.ui.actions.obstacleBrushDiameterAriaLabel"
          :title="locale.ui.actions.obstacleBrushDiameterTitle"
          @input="handleObstacleBrushDiameterInput"
        >
        <span>{{ locale.ui.pathfinding.unit }}</span>
      </label>
      <button
        type="button"
        :aria-pressed="panel.obstacleBrushEraseEnabled"
        :class="{ 'graphwar-killer__toggle-button--active': panel.obstacleBrushEraseEnabled }"
        :title="locale.ui.actions.eraseObstacleTitle"
        @click="emit('toggleObstacleBrushErase')"
      >
        {{ locale.ui.actions.eraseObstacle }}
      </button>
      <button
        type="button"
        :disabled="!panel.obstacleEditsDirty"
        :title="locale.ui.actions.clearObstacleEditsTitle"
        @click="emit('clearObstacleEdits')"
      >
        {{ locale.ui.actions.clearObstacleEdits }}
      </button>
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

.graphwar-killer__action-panel h2 {
  border: 0;
  font-size: 1rem;
  margin: 0;
  padding: 0;
}

.graphwar-killer__action-panel label {
  display: grid;
  font-weight: 600;
  gap: 3px;
  min-width: 0;
}

.graphwar-killer__action-panel input:not([type="file"]) {
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

.graphwar-killer__action-panel input[type="range"] {
  appearance: none;
  background: linear-gradient(
    to right,
    var(--vp-c-brand-1) 0 var(--graphwar-killer-range-progress, 0%),
    var(--vp-c-divider) var(--graphwar-killer-range-progress, 0%) 100%
  );
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  height: 8px;
  padding: 0;
  width: 100%;
}

.graphwar-killer__action-panel input[type="range"]::-webkit-slider-runnable-track {
  background: transparent;
  border: 0;
  height: 8px;
}

.graphwar-killer__action-panel input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  background: var(--vp-c-brand-1);
  border: 2px solid var(--vp-c-bg);
  border-radius: 50%;
  box-shadow: 0 1px 4px rgb(15 23 42 / 20%);
  height: 18px;
  margin-top: -5px;
  width: 18px;
}

.graphwar-killer__action-panel input[type="range"]::-moz-range-track {
  background: transparent;
  border: 0;
  height: 8px;
}

.graphwar-killer__action-panel input[type="range"]::-moz-range-progress {
  background: transparent;
}

.graphwar-killer__action-panel input[type="range"]::-moz-range-thumb {
  background: var(--vp-c-brand-1);
  border: 2px solid var(--vp-c-bg);
  border-radius: 50%;
  box-shadow: 0 1px 4px rgb(15 23 42 / 20%);
  height: 18px;
  width: 18px;
}

.graphwar-killer__action-panel button {
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

.graphwar-killer__action-panel button:disabled {
  cursor: not-allowed;
  opacity: 58%;
}

.graphwar-killer__label-row {
  align-items: baseline;
  display: flex;
  gap: 8px;
  justify-content: space-between;
}

.graphwar-killer__label-row > span {
  color: color-mix(in srgb, var(--vp-c-text-1) 68%, var(--vp-c-text-2) 32%);
  flex: 1 1 14rem;
  font-size: 0.88rem;
  line-height: 1.4;
  min-width: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  text-align: right;
  text-overflow: ellipsis;
  white-space: normal;
}

.graphwar-killer__image-actions,
.graphwar-killer__path-actions,
.graphwar-killer__obstacle-brush-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.graphwar-killer__image-actions button,
.graphwar-killer__path-actions button,
.graphwar-killer__obstacle-brush-actions button {
  min-height: 34px;
  padding: 6px 10px;
}

.graphwar-killer__obstacle-brush-actions {
  min-width: 0;
}

.graphwar-killer__magnifier-zoom-label {
  align-items: center;
  flex: 1 1 280px;
  font-weight: 600;
  gap: 6px;
  grid-template-columns: auto minmax(96px, 1fr) minmax(54px, 72px) auto;
  max-width: min(100%, 460px);
  min-width: min(100%, 260px);
}

.graphwar-killer__magnifier-zoom-label span,
.graphwar-killer__obstacle-brush-label span {
  color: color-mix(in srgb, var(--vp-c-text-1) 68%, var(--vp-c-text-2) 32%);
  font-size: 0.88rem;
  font-weight: 500;
}

.graphwar-killer__obstacle-brush-label {
  align-items: center;
  flex: 1 1 340px;
  font-weight: 600;
  gap: 6px;
  grid-template-columns: auto minmax(120px, 1fr) minmax(58px, 74px) auto;
  max-width: min(100%, 520px);
  min-width: min(100%, 320px);
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

.graphwar-killer__tool-toggle--path::before {
  transform: translateX(100%);
}

.graphwar-killer__tool-toggle--obstacle::before {
  transform: translateX(200%);
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

.graphwar-killer__toggle-button--active {
  background: var(--vp-c-brand-soft) !important;
  border-color: var(--vp-c-brand-1) !important;
  color: var(--vp-c-brand-1) !important;
}

.graphwar-killer__action-panel button:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 8px 20px rgb(15 23 42 / 6%);
  color: var(--vp-c-brand-1);
  transform: translateY(-1px);
}

.graphwar-killer__action-panel .graphwar-killer__tool-toggle button:hover:not(:disabled) {
  box-shadow: none;
  color: color-mix(in srgb, var(--vp-c-text-1) 64%, var(--vp-c-text-2) 36%);
  transform: none;
}

.graphwar-killer__action-panel .graphwar-killer__tool-toggle-button--active:hover:not(:disabled) {
  color: var(--vp-c-white);
}

.graphwar-killer__action-panel input:focus-visible,
.graphwar-killer__action-panel button:focus-visible {
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
</style>
