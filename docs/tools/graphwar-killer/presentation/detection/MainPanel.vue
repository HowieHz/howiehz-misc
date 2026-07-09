<script setup lang="ts">
import type { GraphwarKillerLocale } from "../../locale-types";

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
  /** 地址已配置好时，面板操作区展示读取按钮。 */
  configured: boolean;
  /** 文档站 public 目录中的 Agent jar 下载地址。 */
  downloadHref: string;
  /** 当前是否正在读取 Agent。 */
  inProgress: boolean;
  /** 是否使用 Agent 作为识别来源。 */
  enabled: boolean;
}

export interface GraphwarDetectionPanelModel {
  /** 使用 Graphwar Agent 的展示模型。 */
  agent: GraphwarDetectionPanelAgentModel;
  /** 是否允许从截图中识别边界。 */
  canDetectBounds: boolean;
  /** 是否允许在当前已确认边界内识别士兵和障碍。 */
  canDetectObjects: boolean;
  /** 自动识别是否开启。 */
  autoDetectionEnabled: boolean;
  /** 智能光标是否开启。 */
  smartCursorEnabled: boolean;
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
  detectBounds: [];
  detectObjects: [];
  readAgent: [];
  toggleAutoDetection: [];
  toggleAgentUsage: [];
  toggleSmartCursor: [];
  updateAgentBaseUrl: [value: string];
}>();

function handleAgentBaseUrlInput(event: Event) {
  const input = event.currentTarget;
  if (input instanceof HTMLInputElement) {
    emit("updateAgentBaseUrl", input.value);
  }
}
</script>

<template>
  <section
    class="graphwar-killer__panel graphwar-killer__detection-panel"
    aria-labelledby="graphwar-killer-detection-title"
  >
    <div class="graphwar-killer__label-row">
      <h2 id="graphwar-killer-detection-title">
        {{ locale.ui.detection.title }}
      </h2>
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
    <div class="graphwar-killer__image-actions">
      <button
        v-if="!panel.agent.enabled"
        type="button"
        :disabled="!panel.canDetectBounds"
        :title="locale.ui.detection.detectBoundsTitle"
        @click="emit('detectBounds')"
      >
        {{ locale.ui.detection.detectBounds }}
      </button>
      <button
        v-if="!panel.agent.enabled"
        type="button"
        :disabled="!panel.canDetectObjects"
        :title="panel.detectObjectsTitle"
        @click="emit('detectObjects')"
      >
        {{ locale.ui.detection.detectObjects }}
      </button>
      <button
        v-if="panel.agent.configured"
        type="button"
        :disabled="panel.agent.inProgress"
        :title="locale.ui.detection.agent.readTitle"
        @click="emit('readAgent')"
      >
        {{ panel.agent.inProgress ? locale.ui.detection.agent.reading : locale.ui.detection.agent.read }}
      </button>
      <button
        v-if="!panel.agent.enabled"
        type="button"
        :aria-pressed="panel.autoDetectionEnabled"
        :class="{ 'graphwar-killer__toggle-button--active': panel.autoDetectionEnabled }"
        :title="locale.ui.detection.autoDetectionTitle"
        @click="emit('toggleAutoDetection')"
      >
        {{ locale.ui.detection.autoDetection }}
      </button>
      <button
        type="button"
        :aria-pressed="panel.smartCursorEnabled"
        :class="{ 'graphwar-killer__toggle-button--active': panel.smartCursorEnabled }"
        :title="locale.ui.detection.smartCursorTitle"
        @click="emit('toggleSmartCursor')"
      >
        {{ locale.ui.detection.smartCursor }}
      </button>
      <button
        type="button"
        :aria-expanded="panel.agent.enabled"
        :aria-pressed="panel.agent.enabled"
        :class="{ 'graphwar-killer__toggle-button--active': panel.agent.enabled }"
        :title="locale.ui.detection.agent.toggleTitle"
        @click="emit('toggleAgentUsage')"
      >
        {{ locale.ui.detection.agent.toggle }}
      </button>
    </div>
    <details
      v-if="panel.agent.enabled"
      class="graphwar-killer__subpanel graphwar-killer__details graphwar-killer__agent-usage"
    >
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
      <p class="graphwar-killer__agent-usage-hint">
        {{ locale.ui.detection.agent.helpPrefix }}
        <a :href="panel.agent.downloadHref">{{ locale.ui.detection.agent.download }}</a>
        {{ locale.ui.detection.agent.helpMiddle }}
        <code>java -javaagent:graphwar-agent.jar -jar graphwar.jar</code>
        {{ locale.ui.detection.agent.helpSuffix }}
      </p>
    </details>
    <details
      v-if="panel.debugTimingVisible"
      class="graphwar-killer__subpanel graphwar-killer__details"
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

.graphwar-killer__detection-panel input:not([type="file"]) {
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

.graphwar-killer__detection-panel button {
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

.graphwar-killer__detection-panel button:disabled {
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

.graphwar-killer__agent-usage-hint code {
  overflow-wrap: anywhere;
  white-space: normal;
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

.graphwar-killer__details > summary:focus-visible {
  border-radius: 4px;
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.graphwar-killer__details[open] > summary {
  margin-bottom: 6px;
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

.graphwar-killer__toggle-button--active {
  background: var(--vp-c-brand-soft) !important;
  border-color: var(--vp-c-brand-1) !important;
  color: var(--vp-c-brand-1) !important;
}

.graphwar-killer__detection-panel button:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 8px 20px rgb(15 23 42 / 6%);
  color: var(--vp-c-brand-1);
  transform: translateY(-1px);
}

.graphwar-killer__detection-panel input:focus-visible,
.graphwar-killer__detection-panel button:focus-visible {
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

  .graphwar-killer__agent-url {
    grid-template-columns: 1fr;
  }
}
</style>
