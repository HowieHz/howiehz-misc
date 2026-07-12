<script setup lang="ts">
import { Eraser, Trash2, Undo2 } from "@lucide/vue";
import type { CSSProperties } from "vue";

import type { GraphwarControlCapability } from "../../controllers/page/capabilities";
import type { ToolMode } from "../../core/types";
import type { GraphwarKillerLocale } from "../../locale-types";
import ToggleField from "../controls/ToggleField.vue";
import { getInputValue } from "../dom/input";

interface GraphwarActionPanelStatus {
  /** 状态样式；实时预览计算用 warning，完成用 success，普通工具提示用 info。 */
  kind: "info" | "success" | "warning";
  /** 展示在操作栏标题右侧的状态文本。 */
  message: string;
}

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

interface GraphwarActionPanelToggle {
  /** Persisted preference value. */
  enabled: boolean;
  /** Visible state derived by the shared capability model. */
  state: GraphwarControlCapability["state"];
  /** Localised reason for a non-normal state. */
  reason?: string;
}

export interface GraphwarActionPanelModel {
  /** 托管期间锁定路径和障碍编辑，保留放大镜等纯展示控制。 */
  interactionDisabled: boolean;
  /** 标题行右侧的当前工具提示。 */
  activeToolHint: GraphwarActionPanelStatus;
  /** 手工轨迹碰撞检查。 */
  collisionCheck: GraphwarActionPanelToggle;
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
  /** 士兵吸附偏好。 */
  snapSoldiers: GraphwarActionPanelToggle;
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
  toggleCollisionCheck: [];
  toggleObstacleBrushErase: [];
  toggleSnapSoldiers: [];
  undoPoint: [];
  updateMagnifierZoom: [value: string];
  updateObstacleBrushDiameter: [value: string];
}>();

/** Forwards both range and numeric zoom inputs through one guarded DOM adapter. */
function handleMagnifierZoomInput(event: Event) {
  const value = getInputValue(event);
  if (value === undefined) {
    return;
  }
  emit("updateMagnifierZoom", value);
}

/** Preserves invalid brush text for parent-side validation instead of coercing it in the panel. */
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
    class="graphwar-killer__panel graphwar-killer__action-panel graphwar-killer-control-surface"
    aria-labelledby="graphwar-killer-actions-title"
  >
    <div class="graphwar-killer__label-row">
      <h2 id="graphwar-killer-actions-title">
        {{ locale.ui.actions.title }}
      </h2>
      <span
        v-if="panel.activeToolHint.message"
        role="status"
        aria-live="polite"
        :title="panel.activeToolHint.message"
        :class="{
          'graphwar-killer__label-status--success': panel.activeToolHint.kind === 'success',
          'graphwar-killer__label-status--warning': panel.activeToolHint.kind === 'warning',
        }"
      >
        {{ panel.activeToolHint.message }}
      </span>
    </div>
    <div class="graphwar-killer__image-actions">
      <div
        class="graphwar-killer__tool-toggle graphwar-killer-segmented-control"
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
          class="graphwar-killer-segmented-button"
          :aria-pressed="panel.toolMode === 'bounds'"
          :class="{ 'graphwar-killer-segmented-button--active': panel.toolMode === 'bounds' }"
          :disabled="panel.interactionDisabled"
          :title="locale.ui.actions.pickBoundsTitle"
          @click="emit('setToolMode', 'bounds')"
        >
          {{ locale.ui.actions.pickBounds }}
        </button>
        <button
          type="button"
          class="graphwar-killer-segmented-button"
          :aria-pressed="panel.toolMode === 'path'"
          :class="{ 'graphwar-killer-segmented-button--active': panel.toolMode === 'path' }"
          :disabled="panel.interactionDisabled"
          :title="locale.ui.actions.pickPathTitle"
          @click="emit('setToolMode', 'path')"
        >
          {{ locale.ui.actions.pickPath }}
        </button>
        <button
          type="button"
          class="graphwar-killer-segmented-button"
          :aria-pressed="panel.toolMode === 'obstacle'"
          :class="{ 'graphwar-killer-segmented-button--active': panel.toolMode === 'obstacle' }"
          :disabled="panel.interactionDisabled || !panel.obstacleBrushAvailable"
          :title="locale.ui.actions.drawObstacleTitle"
          @click="emit('setToolMode', 'obstacle')"
        >
          {{ locale.ui.actions.drawObstacle }}
        </button>
      </div>
      <ToggleField
        id="graphwar-killer-magnifier"
        :checked="panel.magnifierEnabled"
        :label="locale.ui.actions.magnifier"
        state="normal"
        :title="locale.ui.actions.magnifierTitle"
        @toggle="emit('toggleMagnifier')"
      />
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
        class="graphwar-killer__icon-button"
        :aria-label="locale.ui.actions.clearPath"
        :disabled="panel.interactionDisabled"
        :title="locale.ui.actions.clearPathTitle"
        @click="emit('clearPath')"
      >
        <Trash2
          :size="17"
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        class="graphwar-killer__icon-button"
        :aria-label="locale.ui.actions.undoPoint"
        :disabled="panel.interactionDisabled"
        :title="locale.ui.actions.undoPointTitle"
        @click="emit('undoPoint')"
      >
        <Undo2
          :size="17"
          aria-hidden="true"
        />
      </button>
      <ToggleField
        id="graphwar-killer-snap-soldiers"
        :checked="panel.snapSoldiers.enabled"
        :label="locale.ui.actions.snapSoldiers"
        :reason="panel.snapSoldiers.reason"
        :state="panel.snapSoldiers.state"
        :title="locale.ui.actions.snapSoldiersTitle"
        @toggle="emit('toggleSnapSoldiers')"
      />
      <ToggleField
        id="graphwar-killer-collision-check"
        :checked="panel.collisionCheck.enabled"
        :label="locale.ui.actions.collisionCheck"
        :reason="panel.collisionCheck.reason"
        :state="panel.collisionCheck.state"
        :title="locale.ui.actions.collisionCheckTitle"
        @toggle="emit('toggleCollisionCheck')"
      />
      <ToggleField
        id="graphwar-killer-live-click-preview"
        :checked="panel.liveClickPreviewEnabled"
        :label="locale.ui.actions.liveClickPreview"
        state="normal"
        :title="locale.ui.actions.liveClickPreviewTitle"
        @toggle="emit('toggleLiveClickPreview')"
      />
    </div>
    <div
      v-if="panel.obstacleBrushControlsVisible"
      class="graphwar-killer__obstacle-brush-actions"
    >
      <div class="graphwar-killer__obstacle-brush-size">
        <button
          type="button"
          class="graphwar-killer__icon-button"
          :aria-label="locale.ui.actions.clearObstacleEdits"
          :disabled="panel.interactionDisabled || !panel.obstacleEditsDirty"
          :title="locale.ui.actions.clearObstacleEditsTitle"
          @click="emit('clearObstacleEdits')"
        >
          <Trash2
            :size="17"
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          class="graphwar-killer__icon-button"
          :class="{ 'graphwar-killer__icon-button--active': panel.obstacleBrushEraseEnabled }"
          :aria-label="locale.ui.actions.eraseObstacle"
          :aria-pressed="panel.obstacleBrushEraseEnabled"
          :disabled="panel.interactionDisabled"
          :title="locale.ui.actions.eraseObstacleTitle"
          @click="emit('toggleObstacleBrushErase')"
        >
          <Eraser
            :size="17"
            aria-hidden="true"
          />
        </button>
        <label
          class="graphwar-killer__obstacle-brush-label"
          :title="locale.ui.actions.obstacleBrushDiameterTitle"
        >
          <span class="graphwar-killer__obstacle-brush-name">
            {{ locale.ui.actions.obstacleBrushDiameter }}
          </span>
          <input
            type="range"
            :value="panel.obstacleBrushDiameter.sliderValue"
            class="graphwar-killer__obstacle-brush-range"
            :style="panel.obstacleBrushDiameter.rangeStyle"
            :min="panel.obstacleBrushDiameter.minimum"
            :max="panel.obstacleBrushDiameter.sliderMaximum"
            :disabled="panel.interactionDisabled"
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
            :disabled="panel.interactionDisabled"
            step="1"
            :aria-label="locale.ui.actions.obstacleBrushDiameterAriaLabel"
            :title="locale.ui.actions.obstacleBrushDiameterTitle"
            @input="handleObstacleBrushDiameterInput"
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
  border-radius: 8px;
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

.graphwar-killer__label-row > .graphwar-killer__label-status--success {
  color: #15803d;
  font-weight: 700;
}

.graphwar-killer__label-row > .graphwar-killer__label-status--warning {
  color: #b45309;
  font-weight: 700;
}

.graphwar-killer__image-actions,
.graphwar-killer__path-actions,
.graphwar-killer__obstacle-brush-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.graphwar-killer__path-actions {
  /* Capability reasons may add a second line; keep neighboring controls anchored to the row top. */
  align-items: flex-start;
}

button.graphwar-killer__icon-button--active {
  background: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-white);
}

.graphwar-killer__obstacle-brush-actions {
  min-width: 0;
}

.graphwar-killer__obstacle-brush-size {
  align-items: center;
  display: flex;
  flex: 1 1 380px;
  gap: 6px;
  max-width: min(100%, 600px);
  min-width: min(100%, 280px);
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

.graphwar-killer__obstacle-brush-label .graphwar-killer__obstacle-brush-name {
  font-weight: 600;
}

.graphwar-killer__obstacle-brush-label {
  align-items: center;
  flex: 1 1 auto;
  font-weight: 600;
  gap: 6px;
  grid-template-columns: auto minmax(120px, 1fr) minmax(58px, 74px) auto;
}

.graphwar-killer__tool-toggle {
  --graphwar-killer-segment-count: 3;
}

.graphwar-killer__tool-toggle--path::before {
  transform: translateX(100%);
}

.graphwar-killer__tool-toggle--obstacle::before {
  transform: translateX(200%);
}

.graphwar-killer__action-panel button.graphwar-killer__icon-button--active:hover:not(:disabled) {
  color: var(--vp-c-white);
}

@media (width <= 760px) {
  .graphwar-killer__label-row {
    display: grid;
    gap: 4px;
  }

  .graphwar-killer__label-row > span {
    text-align: left;
  }

  .graphwar-killer__obstacle-brush-label {
    grid-template-columns: minmax(40px, 1fr) minmax(48px, 64px) auto;
  }

  .graphwar-killer__obstacle-brush-name {
    grid-column: 1 / -1;
  }
}
</style>
