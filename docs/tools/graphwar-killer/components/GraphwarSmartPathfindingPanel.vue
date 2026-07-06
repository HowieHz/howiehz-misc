<script setup lang="ts">
import type { GraphwarKillerLocale } from "../locale-types";

type GraphwarSmartPathfindingPanelStatusKind = "info" | "success" | "warning" | "error";

interface GraphwarSmartPathfindingPanelHeaderStatus {
  /** 标题右侧状态文案；空字符串表示不显示。 */
  message: string;
  /** 状态样式语义，应与父页面寻路状态优先级保持一致。 */
  kind: GraphwarSmartPathfindingPanelStatusKind;
  /** 状态 hover 说明。 */
  title: string;
}

interface GraphwarSmartPathfindingPanelDebugRow {
  /** 稳定 key；父页面应按原 stage-index 规则生成。 */
  key: string;
  /** 调试阶段完整展示文案；父页面应按原耗时格式化规则生成。 */
  text: string;
  /** 调试阶段缩进层级。 */
  indentLevel: number;
  /** 调试阶段 hover 说明。 */
  title?: string;
}

export interface GraphwarSmartPathfindingPanelModel {
  /** 智能寻路是否开启。 */
  smartPathfindingEnabled: boolean;
  /** 智能寻路按钮是否禁用。 */
  smartPathfindingToggleDisabled: boolean;
  /** 智能寻路按钮 hover 说明。 */
  smartPathfindingToggleTitle: string;
  /** 是否允许命中友军。 */
  friendlyFireEnabled: boolean;
  /** 是否展示搜索动画。 */
  searchAnimationEnabled: boolean;
  /** 一键清图按钮是否禁用。 */
  oneClickClearDisabled: boolean;
  /** 一键清图按钮 hover 说明。 */
  oneClickClearTitle: string;
  /** 标题右侧状态展示模型。 */
  headerStatus: GraphwarSmartPathfindingPanelHeaderStatus;
  /** 是否展示调试耗时面板。 */
  debugTimingVisible: boolean;
  /** 调试耗时展示行；耗时格式化应由父页面维持原规则。 */
  debugTimingRows: readonly GraphwarSmartPathfindingPanelDebugRow[];
}

defineProps<{
  /** 页面本地化文案。 */
  locale: GraphwarKillerLocale;
  /** 智能寻路面板展示模型。 */
  panel: GraphwarSmartPathfindingPanelModel;
}>();

const emit = defineEmits<{
  runOneClickClear: [];
  toggleFriendlyFire: [];
  toggleSearchAnimation: [];
  toggleSmartPathfinding: [];
}>();
</script>

<template>
  <section
    class="graphwar-killer__panel graphwar-killer__smart-pathfinding-panel"
    aria-labelledby="graphwar-killer-smart-pathfinding-title"
  >
    <div class="graphwar-killer__label-row">
      <h2 id="graphwar-killer-smart-pathfinding-title">
        {{ locale.ui.pathfinding.title }}
      </h2>
      <span
        v-if="panel.headerStatus.message"
        class="graphwar-killer__pathfinding-header-status"
        :title="panel.headerStatus.title"
        :class="{
          'graphwar-killer__label-status--error': panel.headerStatus.kind === 'error',
          'graphwar-killer__label-status--warning': panel.headerStatus.kind === 'warning',
          'graphwar-killer__label-status--success': panel.headerStatus.kind === 'success',
        }"
      >
        {{ panel.headerStatus.message }}
      </span>
    </div>
    <div class="graphwar-killer__image-actions">
      <button
        type="button"
        :aria-pressed="panel.smartPathfindingEnabled"
        :class="{ 'graphwar-killer__toggle-button--active': panel.smartPathfindingEnabled }"
        :disabled="panel.smartPathfindingToggleDisabled"
        :title="panel.smartPathfindingToggleTitle"
        @click="emit('toggleSmartPathfinding')"
      >
        {{ locale.ui.pathfinding.smartPathfinding }}
      </button>
      <button
        v-if="panel.smartPathfindingEnabled"
        type="button"
        :aria-pressed="panel.friendlyFireEnabled"
        :class="{ 'graphwar-killer__toggle-button--active': panel.friendlyFireEnabled }"
        :title="locale.ui.pathfinding.allowFriendlyFireTitle"
        @click="emit('toggleFriendlyFire')"
      >
        {{ locale.ui.pathfinding.allowFriendlyFire }}
      </button>
      <button
        v-if="panel.smartPathfindingEnabled"
        type="button"
        :aria-pressed="panel.searchAnimationEnabled"
        :class="{ 'graphwar-killer__toggle-button--active': panel.searchAnimationEnabled }"
        :title="locale.ui.pathfinding.searchAnimationTitle"
        @click="emit('toggleSearchAnimation')"
      >
        {{ locale.ui.pathfinding.searchAnimation }}
      </button>
      <button
        v-if="panel.smartPathfindingEnabled"
        type="button"
        aria-pressed="false"
        :disabled="panel.oneClickClearDisabled"
        :title="panel.oneClickClearTitle"
        @click="emit('runOneClickClear')"
      >
        {{ locale.ui.pathfinding.autoGraph }}
      </button>
    </div>
    <div
      v-if="panel.debugTimingVisible"
      class="graphwar-killer__pathfinding-settings"
    >
      <details class="graphwar-killer__subpanel graphwar-killer__details">
        <summary>{{ locale.ui.pathfinding.debugSummary }}</summary>
        <div class="graphwar-killer__debug-timing">
          <span v-if="!panel.debugTimingRows.length">{{ locale.ui.pathfinding.debugNoTiming }}</span>
          <template v-else>
            <span
              v-for="entry in panel.debugTimingRows"
              :key="entry.key"
              class="graphwar-killer__debug-timing-row"
              :style="{ '--graphwar-killer-debug-indent-level': entry.indentLevel }"
              :title="entry.title"
            >
              {{ entry.text }}
            </span>
          </template>
        </div>
      </details>
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

.graphwar-killer__smart-pathfinding-panel h2 {
  border: 0;
  font-size: 1rem;
  margin: 0;
  padding: 0;
}

.graphwar-killer__smart-pathfinding-panel button {
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

.graphwar-killer__smart-pathfinding-panel button:disabled {
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
  font-size: 0.88rem;
  line-height: 1.4;
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

.graphwar-killer__pathfinding-header-status {
  max-width: min(100%, 24rem);
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

.graphwar-killer__pathfinding-settings {
  display: grid;
  gap: 8px;
  min-width: 0;
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

.graphwar-killer__debug-timing-row {
  padding-inline-start: calc(var(--graphwar-killer-debug-indent-level, 0) * 1rem);
}

.graphwar-killer__toggle-button--active {
  background: var(--vp-c-brand-soft) !important;
  border-color: var(--vp-c-brand-1) !important;
  color: var(--vp-c-brand-1) !important;
}

.graphwar-killer__smart-pathfinding-panel button:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 8px 20px rgb(15 23 42 / 6%);
  color: var(--vp-c-brand-1);
  transform: translateY(-1px);
}

.graphwar-killer__smart-pathfinding-panel button:focus-visible {
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
