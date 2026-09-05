<script setup lang="ts">
import type { ComponentPublicInstance, CSSProperties } from "vue";

import type { GraphwarKillerLocale } from "../../locale-types";
import GraphwarStageOverlay, { type GraphwarStageOverlayModel } from "../stage/MainOverlay.vue";
import type { GraphwarScreenshotHeaderStatus } from "../status/screenshot";

/** 主截图舞台及其覆盖层和裁剪资源。 */
interface GraphwarScreenshotPanelStageModel {
  /** 舞台是否没有截图；父页面应沿用原 imageUrl 判定。 */
  empty: boolean;
  /** 无截图时的舞台占位文案。 */
  emptyPlaceholder: string;
  /** 主舞台障碍笔刷裁剪 id。 */
  mainClipPathId: string;
  /** 放大镜舞台障碍笔刷裁剪 id。 */
  magnifierClipPathId: string;
  /** 舞台 overlay 展示模型；业务投影仍应由父页面生成。 */
  overlay: GraphwarStageOverlayModel;
  /** 舞台尺寸样式。 */
  style: CSSProperties;
}

/** 放大镜的可见性与定位样式。 */
interface GraphwarScreenshotPanelMagnifierModel {
  /** 放大镜内容定位样式。 */
  contentStyle: CSSProperties;
  /** 放大镜外框定位样式。 */
  style: CSSProperties;
  /** 是否展示放大镜。 */
  visible: boolean;
}

/** 截图主状态之外的非致命警告。 */
interface GraphwarScreenshotPanelStatusWarning {
  /** 与主状态同时展示的短警告；空字符串表示不显示。 */
  message: string;
  /** 降级等非致命异常的完整 hover 说明。 */
  title: string;
}

/** 截图舞台、放大镜和聚合状态的展示模型。 */
export interface GraphwarScreenshotPanelModel {
  /** 识别忙碌遮罩是否展示。 */
  busyOverlayVisible: boolean;
  /** 当前截图状态文案。 */
  imageStatusText: string;
  /** 当前截图 data URL。 */
  imageUrl: string;
  /** 标题右侧主状态；父页面应已按路径错误、计算状态、模式建议的顺序选择。 */
  headerStatus: GraphwarScreenshotHeaderStatus;
  /** 与主状态并列的非致命降级警告。 */
  statusWarning: GraphwarScreenshotPanelStatusWarning;
  /** 舞台展示模型。 */
  stage: GraphwarScreenshotPanelStageModel;
  /** 放大镜展示模型。 */
  magnifier: GraphwarScreenshotPanelMagnifierModel;
}

defineProps<{
  /** 页面本地化文案。 */
  locale: GraphwarKillerLocale;
  /** 截图面板展示模型。 */
  panel: GraphwarScreenshotPanelModel;
}>();

const emit = defineEmits<{
  cancelDetection: [];
  dropImage: [event: DragEvent];
  imageLoad: [];
  setImageElement: [element: HTMLImageElement | undefined];
  setStageElement: [element: HTMLElement | undefined];
  stageContextMenu: [event: MouseEvent];
  stagePointerDown: [event: PointerEvent];
  stagePointerLeave: [event: PointerEvent];
  stagePointerMove: [event: PointerEvent];
  stagePointerUp: [event: PointerEvent];
}>();

/** Narrows Vue's template ref union before exposing the stage to pointer workflows. */
function setStageElement(element: Element | ComponentPublicInstance | null) {
  emit("setStageElement", element instanceof HTMLElement ? element : undefined);
}

/** Narrows Vue's template ref union before exposing the loaded image to pixel readers. */
function setImageElement(element: Element | ComponentPublicInstance | null) {
  emit("setImageElement", element instanceof HTMLImageElement ? element : undefined);
}
</script>

<template>
  <section
    class="graphwar-killer__panel graphwar-killer__screenshot-panel"
    aria-labelledby="graphwar-killer-screenshot-title"
  >
    <div class="graphwar-killer__label-row graphwar-killer__label-row--image-status">
      <h2 id="graphwar-killer-screenshot-title">
        {{ locale.ui.screenshot.title }}
      </h2>
      <span
        class="graphwar-killer__image-status-text"
        :title="panel.imageStatusText"
      >
        {{ panel.imageStatusText }}
      </span>
      <span
        v-if="panel.headerStatus.message"
        class="graphwar-killer__header-status-text"
        role="status"
        aria-live="polite"
        :class="{
          'graphwar-killer__label-status--error': panel.headerStatus.kind === 'error',
          'graphwar-killer__label-status--success': panel.headerStatus.kind === 'success',
          'graphwar-killer__label-status--warning': panel.headerStatus.kind === 'warning',
        }"
        :title="panel.headerStatus.title"
      >
        {{ panel.headerStatus.message }}
      </span>
      <span
        v-if="panel.statusWarning.message"
        class="graphwar-killer__status-warning-text graphwar-killer__label-status--warning"
        :title="panel.statusWarning.title"
      >
        {{ panel.statusWarning.message }}
      </span>
    </div>
    <div
      :ref="setStageElement"
      class="graphwar-killer__stage"
      :class="{ 'graphwar-killer__stage--empty': panel.stage.empty }"
      :style="panel.stage.style"
      tabindex="0"
      @drop.prevent="emit('dropImage', $event)"
      @dragover.prevent
      @pointerdown="emit('stagePointerDown', $event)"
      @pointermove="emit('stagePointerMove', $event)"
      @pointerup="emit('stagePointerUp', $event)"
      @pointercancel="emit('stagePointerUp', $event)"
      @pointerleave="emit('stagePointerLeave', $event)"
      @contextmenu.prevent="emit('stageContextMenu', $event)"
    >
      <img
        v-if="panel.imageUrl"
        :ref="setImageElement"
        :src="panel.imageUrl"
        alt=""
        draggable="false"
        @load="emit('imageLoad')"
      >
      <div
        v-else
        class="graphwar-killer__placeholder"
      >
        {{ panel.stage.emptyPlaceholder }}
      </div>
      <GraphwarStageOverlay
        :clip-path-id="panel.stage.mainClipPathId"
        :overlay="panel.stage.overlay"
      />
      <div
        v-if="panel.busyOverlayVisible"
        class="graphwar-killer__detection-busy-overlay"
        :aria-label="locale.ui.detection.busyOverlay"
        @pointerdown.stop.prevent
        @pointermove.stop.prevent
        @pointerup.stop.prevent
        @pointercancel.stop.prevent
        @dragover.stop.prevent
        @drop.stop.prevent
        @contextmenu.stop.prevent="emit('cancelDetection')"
      >
        <span>{{ locale.ui.detection.busyOverlay }}</span>
      </div>
      <div
        v-if="panel.magnifier.visible"
        class="graphwar-killer__magnifier"
        :style="panel.magnifier.style"
        aria-hidden="true"
      >
        <div
          class="graphwar-killer__magnifier-content"
          :style="panel.magnifier.contentStyle"
        >
          <img
            class="graphwar-killer__magnifier-image"
            :src="panel.imageUrl"
            alt=""
            draggable="false"
          >
          <GraphwarStageOverlay
            key-prefix="magnifier-"
            :clip-path-id="panel.stage.magnifierClipPathId"
            :overlay="panel.stage.overlay"
          />
        </div>
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

.graphwar-killer__screenshot-panel h2 {
  border: 0;
  font-size: 1rem;
  margin: 0;
  padding: 0;
}

.graphwar-killer__screenshot-panel label {
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
  font-size: 0.88rem;
  line-height: 1.4;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.graphwar-killer__label-row > .graphwar-killer__label-status--warning {
  color: #b45309;
  font-weight: 700;
}

.graphwar-killer__label-row > .graphwar-killer__label-status--error {
  color: #dc2626;
}

.graphwar-killer__label-row > .graphwar-killer__label-status--success {
  color: #15803d;
  font-weight: 700;
}

.graphwar-killer__label-row--image-status {
  align-items: baseline;
  display: flex;
}

.graphwar-killer__label-row--image-status > span {
  min-width: 0;
}

.graphwar-killer__image-status-text {
  flex: 1 1 auto;
  text-align: left !important;
}

.graphwar-killer__header-status-text,
.graphwar-killer__status-warning-text {
  flex: 0 1 auto;
  max-width: min(100%, 44rem);
  text-align: right;
}

.graphwar-killer__stage {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  overflow: hidden;
  position: relative;
  touch-action: none;
  user-select: none;
  width: 100%;
}

.graphwar-killer__stage img {
  border-radius: 0;
  display: block;
  height: 100%;
  inset: 0;
  margin: 0;
  max-width: none;
  object-fit: fill;
  object-position: 0 0;
  pointer-events: none;
  position: absolute;
  vertical-align: top;
  width: 100%;
}

.graphwar-killer__stage--empty {
  min-height: 280px;
}

.graphwar-killer__magnifier {
  background: var(--vp-c-bg);
  border: 2px solid var(--vp-c-brand-1);
  border-radius: 999px;
  box-shadow: 0 12px 32px rgb(15 23 42 / 20%);
  overflow: hidden;
  pointer-events: none;
  position: absolute;
  z-index: 3;
}

.graphwar-killer__magnifier-content {
  left: 0;
  position: absolute;
  top: 0;
  transform-origin: 0 0;
}

.graphwar-killer__magnifier-image {
  z-index: 0;
}

.graphwar-killer__magnifier::before,
.graphwar-killer__magnifier::after {
  background: #f97316;
  content: "";
  opacity: 86%;
  position: absolute;
  z-index: 2;
}

.graphwar-killer__magnifier::before {
  height: 1px;
  left: 38%;
  top: 50%;
  width: 24%;
}

.graphwar-killer__magnifier::after {
  height: 24%;
  left: 50%;
  top: 38%;
  width: 1px;
}

.graphwar-killer__placeholder {
  color: color-mix(in srgb, var(--vp-c-text-1) 62%, var(--vp-c-text-2) 38%);
  display: grid;
  font-weight: 700;
  inset: 0;
  place-items: center;
  position: absolute;
  text-align: center;
}

.graphwar-killer__detection-busy-overlay {
  align-items: center;
  background: rgb(15 23 42 / 34%);
  color: var(--vp-c-white);
  cursor: progress;
  display: flex;
  font-size: 0.95rem;
  font-weight: 700;
  inset: 0;
  justify-content: center;
  position: absolute;
  text-shadow: 0 1px 2px rgb(0 0 0 / 30%);
  touch-action: none;
  z-index: 5;
}

.graphwar-killer__detection-busy-overlay span {
  background: rgb(15 23 42 / 54%);
  border: 1px solid rgb(255 255 255 / 32%);
  border-radius: 8px;
  padding: 6px 10px;
}

.graphwar-killer__stage:focus-visible {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 52%, var(--vp-c-divider));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--vp-c-brand-1) 16%, transparent);
  outline: none;
}

@media (width <= 760px) {
  .graphwar-killer__label-row {
    display: grid;
    gap: 4px;
  }

  .graphwar-killer__label-row--image-status {
    grid-template-columns: 1fr;
  }

  .graphwar-killer__label-row > span {
    text-align: left;
  }

  .graphwar-killer__header-status-text,
  .graphwar-killer__status-warning-text {
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
  }
}
</style>
