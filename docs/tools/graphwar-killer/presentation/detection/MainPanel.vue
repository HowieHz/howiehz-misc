<script setup lang="ts">
import type { GraphwarControlCapability } from "../../controllers/page/capabilities";
import type { GraphwarKillerLocale } from "../../locale-types";
import ControlReason from "../controls/ControlReason.vue";
import ToggleField from "../controls/ToggleField.vue";
import { getInputValue } from "../dom/input";

type GraphwarDetectionPanelStatusKind = "info" | "success" | "warning" | "error";

interface GraphwarDetectionPanelHeaderStatus {
  /** 标题右侧状态文案；空字符串表示不显示。 */
  message: string;
  /** 状态样式语义，应与父页面检测状态优先级保持一致。 */
  kind: GraphwarDetectionPanelStatusKind;
}

interface GraphwarDetectionPanelStatusWarning {
  /** 识别结果警告文案；空字符串表示不显示。 */
  message: string;
  /** 警告 hover 说明。 */
  title: string;
}

interface GraphwarDetectionPanelDebugRow {
  /** 稳定 key；父页面应按原 stage-index 规则生成。 */
  key: string;
  /** 调试阶段 hover 说明。 */
  title?: string;
  /** 调试阶段完整展示文案；父页面应按原耗时格式化规则生成。 */
  text: string;
}

interface GraphwarDetectionPanelAgentModel {
  /** Agent 地址输入框文本。 */
  baseUrlText: string;
  /** 当前是否正在读取 Agent。 */
  inProgress: boolean;
  /** 是否使用 Agent 作为识别来源。 */
  enabled: boolean;
  /** 读取命令与页面 guard 共享的能力状态。 */
  readState: GraphwarControlCapability["state"];
  /** Agent 未就绪或忙碌时的可见说明。 */
  readReason?: string;
}

export interface GraphwarDetectionPanelModel {
  /** 托管期间锁定识别来源、Agent 配置和手动读取入口。 */
  interactionDisabled: boolean;
  /** 使用 Graphwar Agent 的展示模型。 */
  agent: GraphwarDetectionPanelAgentModel;
  /** 是否允许从截图中识别边界。 */
  canDetectBounds: boolean;
  /** 是否允许在当前已确认边界内识别士兵和障碍。 */
  canDetectObjects: boolean;
  /** 自动识别是否开启。 */
  autoDetectionEnabled: boolean;
  /** 截图来源启用时展示上传和截屏命令。 */
  screenshotActionsVisible: boolean;
  /** 识别士兵/障碍按钮 hover 说明；禁用时应说明缺少的前置边界。 */
  detectObjectsTitle: string;
  /** 标题右侧状态展示模型。 */
  headerStatus: GraphwarDetectionPanelHeaderStatus;
  /** 识别警告展示模型。 */
  statusWarning: GraphwarDetectionPanelStatusWarning;
  /** 是否展示调试耗时面板。 */
  debugTimingVisible: boolean;
  /** 调试耗时展示行；耗时格式化应由父页面维持原规则。 */
  debugTimingRows: readonly GraphwarDetectionPanelDebugRow[];
}

defineProps<{
  /** 页面本地化文案。 */
  locale: GraphwarKillerLocale;
  /** 识别面板展示模型。 */
  panel: GraphwarDetectionPanelModel;
}>();

const emit = defineEmits<{
  captureImage: [];
  detectBounds: [];
  detectObjects: [];
  readAgent: [];
  toggleAutoDetection: [];
  toggleAgentUsage: [];
  uploadImage: [event: Event];
  updateAgentBaseUrl: [value: string];
}>();

/** Preserves the raw Agent URL text so the page can own normalisation and validation. */
function handleAgentBaseUrlInput(event: Event) {
  const value = getInputValue(event);
  if (value === undefined) {
    return;
  }
  emit("updateAgentBaseUrl", value);
}
</script>

<template>
  <section
    class="graphwar-killer__panel graphwar-killer__detection-panel graphwar-killer-control-surface"
    aria-labelledby="graphwar-killer-detection-title"
    :aria-disabled="panel.interactionDisabled"
  >
    <div class="graphwar-killer__label-row">
      <div class="graphwar-killer__label-leading">
        <h2 id="graphwar-killer-detection-title">
          {{ locale.ui.detection.title }}
        </h2>
        <ToggleField
          id="graphwar-killer-agent-usage"
          class="graphwar-killer__source-toggle"
          :checked="panel.agent.enabled"
          :label="locale.ui.detection.agent.toggle"
          :state="panel.interactionDisabled ? 'blocked' : 'normal'"
          :title="locale.ui.detection.agent.toggleTitle"
          @toggle="emit('toggleAgentUsage')"
        />
      </div>
      <div
        v-if="panel.headerStatus.message || panel.statusWarning.message"
        class="graphwar-killer__label-feedback"
      >
        <span
          v-if="panel.headerStatus.message"
          role="status"
          aria-live="polite"
          :title="panel.headerStatus.message"
          :class="{
            'graphwar-killer__label-status--error': panel.headerStatus.kind === 'error',
            'graphwar-killer__label-status--warning': panel.headerStatus.kind === 'warning',
            'graphwar-killer__label-status--success': panel.headerStatus.kind === 'success',
          }"
        >
          {{ panel.headerStatus.message }}
        </span>
        <span
          v-if="panel.statusWarning.message"
          class="graphwar-killer__label-status graphwar-killer__label-status--warning"
          :title="panel.statusWarning.title"
        >
          {{ panel.statusWarning.message }}
        </span>
      </div>
    </div>
    <fieldset
      class="graphwar-killer__detection-fields"
      :disabled="panel.interactionDisabled"
    >
      <div class="graphwar-killer__image-actions">
        <div
          v-if="panel.screenshotActionsVisible"
          class="graphwar-killer__source-action-row"
        >
          <button
            type="button"
            :title="locale.ui.screenshot.captureTitle"
            @click="emit('captureImage')"
          >
            {{ locale.ui.screenshot.capture }}
          </button>
          <label
            class="graphwar-killer__upload"
            :title="locale.ui.screenshot.uploadTitle"
          >
            <input
              type="file"
              accept="image/*"
              :title="locale.ui.screenshot.uploadInputTitle"
              @change="emit('uploadImage', $event)"
            >
            <span class="graphwar-killer-control-button">{{ locale.ui.screenshot.upload }}</span>
          </label>
        </div>
        <div
          v-if="!panel.agent.enabled"
          class="graphwar-killer__source-action-row"
        >
          <button
            type="button"
            :disabled="!panel.canDetectBounds"
            :title="locale.ui.detection.detectBoundsTitle"
            @click="emit('detectBounds')"
          >
            {{ locale.ui.detection.detectBounds }}
          </button>
          <button
            type="button"
            :disabled="!panel.canDetectObjects"
            :title="panel.detectObjectsTitle"
            @click="emit('detectObjects')"
          >
            {{ locale.ui.detection.detectObjects }}
          </button>
          <ToggleField
            id="graphwar-killer-auto-detection"
            :checked="panel.autoDetectionEnabled"
            :label="locale.ui.detection.autoDetection"
            state="normal"
            :title="locale.ui.detection.autoDetectionTitle"
            @toggle="emit('toggleAutoDetection')"
          />
        </div>
        <div
          v-if="panel.agent.enabled"
          class="graphwar-killer__source-action-row"
        >
          <div class="graphwar-killer__agent-read-field">
            <button
              type="button"
              :aria-describedby="panel.agent.readReason ? 'graphwar-killer-agent-read-reason' : undefined"
              :disabled="panel.agent.readState === 'blocked' || panel.agent.readState === 'busy'"
              :title="locale.ui.detection.agent.readTitle"
              @click="emit('readAgent')"
            >
              {{ panel.agent.inProgress ? locale.ui.detection.agent.reading : locale.ui.detection.agent.read }}
            </button>
            <ControlReason
              v-if="panel.agent.readReason"
              id="graphwar-killer-agent-read-reason"
              :message="panel.agent.readReason"
            />
          </div>
        </div>
      </div>
      <template v-if="panel.agent.enabled">
        <details class="graphwar-killer__details graphwar-killer__agent-usage">
          <summary>{{ locale.ui.detection.agent.settingsSummary }}</summary>
          <label
            class="graphwar-killer__agent-url"
            :title="locale.ui.detection.agent.addressTitle"
          >
            {{ locale.ui.detection.agent.address }}
            <input
              type="url"
              :aria-label="locale.ui.detection.agent.addressAriaLabel"
              :title="locale.ui.detection.agent.addressTitle"
              :value="panel.agent.baseUrlText"
              @input="handleAgentBaseUrlInput"
            >
          </label>
        </details>
        <p class="graphwar-killer__agent-usage-hint">
          <a href="#graphwar-killer-agent-help">{{ locale.ui.detection.agent.helpLink }}</a>
        </p>
      </template>
      <details
        v-if="panel.debugTimingVisible"
        class="graphwar-killer__details"
      >
        <summary>{{ locale.ui.detection.debugSummary }}</summary>
        <div class="graphwar-killer__debug-timing">
          <span v-if="!panel.debugTimingRows.length">{{ locale.ui.detection.debugNoTiming }}</span>
          <template v-else>
            <span
              v-for="entry in panel.debugTimingRows"
              :key="entry.key"
              :title="entry.title"
            >
              {{ entry.text }}
            </span>
          </template>
        </div>
      </details>
    </fieldset>
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

.graphwar-killer__detection-panel h2 {
  border: 0;
  font-size: 1rem;
  margin: 0;
  padding: 0;
}

.graphwar-killer__detection-panel label {
  display: grid;
  font-weight: 600;
  gap: 3px;
  min-width: 0;
}

.graphwar-killer__detection-fields {
  border: 0;
  display: grid;
  gap: 8px;
  margin: 0;
  min-inline-size: 0;
  padding: 0;
}

.graphwar-killer__label-row {
  align-items: center;
  display: grid;
  gap: 8px;
  grid-template-columns: max-content minmax(0, 1fr);
  min-width: 0;
}

.graphwar-killer__label-leading {
  align-items: center;
  display: flex;
  gap: 8px;
  min-width: 0;
}

.graphwar-killer__label-feedback {
  align-items: baseline;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  min-width: 0;
}

.graphwar-killer__label-feedback > span {
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

.graphwar-killer__label-feedback > .graphwar-killer__label-status--error {
  color: #dc2626;
}

.graphwar-killer__label-feedback > .graphwar-killer__label-status--warning {
  color: #b45309;
  font-weight: 700;
}

.graphwar-killer__label-feedback > .graphwar-killer__label-status--success {
  color: #15803d;
  font-weight: 700;
}

.graphwar-killer__image-actions {
  display: grid;
  gap: 6px;
}

.graphwar-killer__source-action-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.graphwar-killer__upload {
  width: fit-content;
}

.graphwar-killer__upload input {
  height: 1px;
  opacity: 0%;
  pointer-events: none;
  position: absolute;
  width: 1px;
}

.graphwar-killer__agent-read-field {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.graphwar-killer__details {
  background: var(--vp-c-bg-soft);
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 82%, transparent);
  border-radius: 8px;
  display: grid;
  gap: 0;
  min-width: 0;
  padding: 8px;
}

.graphwar-killer__agent-usage {
  align-content: start;
}

.graphwar-killer__agent-url {
  align-items: center;
  grid-template-columns: max-content minmax(220px, 420px);
  justify-content: start;
}

.graphwar-killer__agent-usage-hint {
  color: color-mix(in srgb, var(--vp-c-text-1) 66%, var(--vp-c-text-2) 34%);
  font-size: 0.86rem;
  line-height: 1.5;
  margin: 0;
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

.graphwar-killer__details > summary:focus-visible {
  border-radius: 4px;
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.graphwar-killer__debug-timing {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  color: var(--vp-c-text-1);
  display: grid;
  font-size: 0.86rem;
  line-height: 1.6;
  margin: 0;
  overflow-x: auto;
  padding: 8px;
  white-space: nowrap;
}

.graphwar-killer__debug-timing > span {
  min-width: max-content;
}

.graphwar-killer__source-toggle :deep(.graphwar-killer-toggle-field__control:hover:not(:disabled)),
.graphwar-killer__source-toggle :deep(.graphwar-killer-toggle-field__control:focus-visible) {
  border-color: transparent;
  box-shadow: none;
  color: inherit;
  transform: none;
}

@media (width <= 760px) {
  .graphwar-killer__label-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .graphwar-killer__label-feedback {
    align-items: start;
    display: grid;
    grid-column: 1 / -1;
    grid-row: 2;
    justify-content: flex-start;
  }

  .graphwar-killer__label-feedback > span {
    overflow: visible;
    text-align: start;
    text-overflow: clip;
    white-space: normal;
  }

  .graphwar-killer__agent-url {
    grid-template-columns: 1fr;
  }
}
</style>
