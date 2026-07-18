<script setup lang="ts">
import type { GraphwarControlCapability } from "../../controllers/page/capabilities";
import type { GraphwarKillerLocale } from "../../locale-types";
import type { GraphwarPathfindingRouteMode } from "../../pathfinding/routing/mode";
import ControlReason from "../controls/ControlReason.vue";
import PanelDetails from "../controls/PanelDetails.vue";
import ToggleField from "../controls/ToggleField.vue";

type GraphwarPathfindingPanelStatusKind = "info" | "success" | "warning" | "error";

/** 寻路面板标题旁的当前任务状态。 */
interface GraphwarPathfindingPanelHeaderStatus {
  /** 面板标题旁显示的完整任务状态。 */
  message: string;
  /** 从现有工作流保留的视觉状态语义。 */
  kind: GraphwarPathfindingPanelStatusKind;
  /** 桌面布局截断时使用的补充悬浮文本。 */
  title: string;
}

/** 单条预先格式化并带缩进的寻路调试耗时。 */
interface GraphwarPathfindingPanelDebugRow {
  /** 由原始阶段和索引生成的稳定行键。 */
  key: string;
  /** 已完整格式化的耗时文本。 */
  text: string;
  /** Worker 子阶段使用的视觉嵌套层级。 */
  indentLevel: number;
  /** 可选的完整阶段说明。 */
  title?: string;
}

/** 由偏好值和能力状态共同驱动的寻路开关。 */
interface GraphwarPathfindingToggle {
  /** 持久化的偏好值。 */
  enabled: boolean;
  /** 展示层和命令守卫共用的能力状态。 */
  state: GraphwarControlCapability["state"];
  /** 非 normal 状态的本地化说明。 */
  reason?: string;
}

/** 可直接触发的寻路任务及其能力说明。 */
interface GraphwarPathfindingTask {
  /** 展示层和命令守卫共用的能力状态。 */
  state: GraphwarControlCapability["state"];
  /** 非 normal 状态的本地化说明。 */
  reason?: string;
  /** 补充命令说明。 */
  title: string;
}

/** 智能寻路、一键清图和托管控制的展示模型。 */
export interface GraphwarSmartPathfindingPanelModel {
  /** 当前 Step ODE 是否实际使用固定邪道扫描器。 */
  usesStepGlitchRouting: boolean;
  /** 普通几何路由器；固定邪道扫描器启用时忽略。 */
  routeMode: GraphwarPathfindingRouteMode;
  /** 全局删点偏好。 */
  deleteOptimization: GraphwarPathfindingToggle;
  /** 是否允许寻路穿过友军士兵。 */
  friendlyFire: GraphwarPathfindingToggle;
  /** 仅影响展示的搜索预览偏好。 */
  searchAnimation: GraphwarPathfindingToggle;
  /** 单目标寻路偏好。 */
  pathPlanning: GraphwarPathfindingToggle;
  /** 一键清图命令状态。 */
  oneClickClear: GraphwarPathfindingTask;
  /** 托管模式开关状态。 */
  managedMode: GraphwarPathfindingToggle & { title: string };
  /** 托管模式可能瞄准友军时持续显示的警告。 */
  managedFriendlyFireWarning: string;
  /** 面板标题中显示的当前任务状态。 */
  headerStatus: GraphwarPathfindingPanelHeaderStatus;
  /** 是否显示调试耗时详情。 */
  debugTimingVisible: boolean;
  /** 预先格式化的调试耗时行。 */
  debugTimingRows: readonly GraphwarPathfindingPanelDebugRow[];
}

defineProps<{
  /** 页面本地化文案。 */
  locale: GraphwarKillerLocale;
  /** 寻路任务和选项的展示模型。 */
  panel: GraphwarSmartPathfindingPanelModel;
}>();

const emit = defineEmits<{
  runOneClickClear: [];
  setRouteMode: [mode: GraphwarPathfindingRouteMode];
  toggleDeleteOptimization: [];
  toggleFriendlyFire: [];
  toggleManagedMode: [];
  togglePathPlanning: [];
  toggleSearchAnimation: [];
}>();
</script>

<template>
  <section
    class="graphwar-killer__panel graphwar-killer__pathfinding-panel graphwar-killer-control-surface"
    aria-labelledby="graphwar-killer-pathfinding-title"
  >
    <div class="graphwar-killer__label-row">
      <h2 id="graphwar-killer-pathfinding-title">
        {{ locale.ui.pathfinding.title }}
      </h2>
      <span
        v-if="panel.headerStatus.message"
        class="graphwar-killer__pathfinding-header-status"
        aria-atomic="true"
        aria-live="polite"
        role="status"
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

    <div class="graphwar-killer__pathfinding-section">
      <div class="graphwar-killer__task-controls graphwar-killer-command-row">
        <ToggleField
          id="graphwar-killer-path-planning"
          :checked="panel.pathPlanning.enabled"
          :label="locale.ui.actions.pathPlanning"
          :reason="panel.pathPlanning.reason"
          :state="panel.pathPlanning.state"
          :title="locale.ui.actions.pathPlanningTitle"
          @toggle="emit('togglePathPlanning')"
        />
        <div class="graphwar-killer-command-field">
          <button
            type="button"
            :aria-describedby="panel.oneClickClear.reason ? 'graphwar-killer-one-click-clear-reason' : undefined"
            :disabled="panel.oneClickClear.state === 'blocked' || panel.oneClickClear.state === 'busy'"
            :title="panel.oneClickClear.title"
            @click="emit('runOneClickClear')"
          >
            {{ locale.ui.pathfinding.autoGraph }}
          </button>
          <ControlReason
            v-if="panel.oneClickClear.reason"
            id="graphwar-killer-one-click-clear-reason"
            :message="panel.oneClickClear.reason"
          />
        </div>
        <ToggleField
          id="graphwar-killer-managed-mode"
          :checked="panel.managedMode.enabled"
          :label="locale.ui.pathfinding.managedMode"
          :reason="panel.managedMode.reason"
          :state="panel.managedMode.state"
          :title="panel.managedMode.title"
          @toggle="emit('toggleManagedMode')"
        />
      </div>
      <p
        v-if="panel.managedFriendlyFireWarning"
        class="graphwar-killer__managed-warning"
      >
        {{ panel.managedFriendlyFireWarning }}
      </p>
    </div>

    <PanelDetails :summary="locale.ui.pathfinding.settingsSummary">
      <div class="graphwar-killer__pathfinding-settings-content">
        <div class="graphwar-killer__route-row">
          <span>{{ locale.ui.pathfinding.routeAlgorithm }}</span>
          <div
            v-if="panel.usesStepGlitchRouting"
            class="graphwar-killer__route-toggle graphwar-killer__route-toggle--single graphwar-killer-segmented-control"
          >
            <strong class="graphwar-killer__route-toggle-static">
              {{ locale.ui.pathfinding.routeXPlusScan }}
            </strong>
          </div>
          <div
            v-else
            class="graphwar-killer__route-toggle graphwar-killer-segmented-control"
            :class="{ 'graphwar-killer__route-toggle--theta-star': panel.routeMode === 'theta-star' }"
            role="group"
            :aria-label="locale.ui.pathfinding.routeAlgorithm"
            :title="locale.ui.pathfinding.routeAlgorithmTitle"
          >
            <button
              type="button"
              class="graphwar-killer-segmented-button"
              :aria-pressed="panel.routeMode === 'visibility-graph'"
              :class="{ 'graphwar-killer-segmented-button--active': panel.routeMode === 'visibility-graph' }"
              :disabled="panel.deleteOptimization.state === 'busy'"
              @click="emit('setRouteMode', 'visibility-graph')"
            >
              {{ locale.ui.pathfinding.routeLazyVisibilityGraph }}
            </button>
            <button
              type="button"
              class="graphwar-killer-segmented-button"
              :aria-pressed="panel.routeMode === 'theta-star'"
              :class="{ 'graphwar-killer-segmented-button--active': panel.routeMode === 'theta-star' }"
              :disabled="panel.deleteOptimization.state === 'busy'"
              @click="emit('setRouteMode', 'theta-star')"
            >
              {{ locale.ui.pathfinding.routeThetaStar }}
            </button>
          </div>
        </div>
        <div class="graphwar-killer__option-grid">
          <ToggleField
            id="graphwar-killer-delete-optimization"
            :checked="panel.deleteOptimization.enabled"
            :label="locale.ui.pathfinding.deleteOptimization"
            :reason="panel.deleteOptimization.reason"
            :state="panel.deleteOptimization.state"
            :title="locale.ui.pathfinding.deleteOptimizationTitle"
            @toggle="emit('toggleDeleteOptimization')"
          />
          <ToggleField
            id="graphwar-killer-friendly-fire"
            :checked="panel.friendlyFire.enabled"
            :label="locale.ui.pathfinding.allowFriendlyFire"
            :reason="panel.friendlyFire.reason"
            :state="panel.friendlyFire.state"
            :title="locale.ui.pathfinding.allowFriendlyFireTitle"
            @toggle="emit('toggleFriendlyFire')"
          />
          <ToggleField
            id="graphwar-killer-search-animation"
            :checked="panel.searchAnimation.enabled"
            :label="locale.ui.pathfinding.searchAnimation"
            :reason="panel.searchAnimation.reason"
            :state="panel.searchAnimation.state"
            :title="locale.ui.pathfinding.searchAnimationTitle"
            @toggle="emit('toggleSearchAnimation')"
          />
        </div>
      </div>
    </PanelDetails>

    <PanelDetails
      v-if="panel.debugTimingVisible"
      :summary="locale.ui.pathfinding.debugSummary"
    >
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
    </PanelDetails>
  </section>
</template>

<style scoped>
.graphwar-killer__panel {
  align-content: start;
  background: var(--vp-c-bg);
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 88%, transparent);
  border-radius: 8px;
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 10px;
}

.graphwar-killer__pathfinding-panel h2 {
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

.graphwar-killer__label-row > span {
  color: color-mix(in srgb, var(--vp-c-text-1) 68%, var(--vp-c-text-2) 32%);
  flex: 1 1 0;
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

.graphwar-killer__label-row > .graphwar-killer__label-status--warning,
.graphwar-killer__managed-warning {
  color: #b45309;
  font-weight: 700;
}

.graphwar-killer__label-row > .graphwar-killer__label-status--success {
  color: #15803d;
  font-weight: 700;
}

.graphwar-killer__pathfinding-section {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.graphwar-killer__task-controls,
.graphwar-killer__option-grid {
  display: flex;
  flex-wrap: wrap;
}

.graphwar-killer__task-controls {
  gap: 6px;
}

.graphwar-killer__option-grid {
  align-items: flex-start;
  gap: 8px;
}

.graphwar-killer__task-controls > *,
.graphwar-killer__option-grid > * {
  flex: 0 1 auto;
  max-width: 100%;
}

.graphwar-killer__managed-warning {
  font-size: 0.82rem;
  line-height: 1.4;
  margin: 0;
}

.graphwar-killer__pathfinding-settings-content {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.graphwar-killer__route-row {
  align-items: center;
  display: grid;
  gap: 8px;
  grid-template-columns: max-content minmax(0, 1fr);
}

.graphwar-killer__route-row > span {
  font-size: 0.9rem;
  font-weight: 700;
  line-height: 1.3;
}

.graphwar-killer__route-toggle {
  --graphwar-killer-segment-count: 2;
  max-width: 360px;
}

.graphwar-killer__route-toggle--theta-star::before {
  transform: translateX(100%);
}

.graphwar-killer__route-toggle--single {
  --graphwar-killer-segment-count: 1;
  max-width: 180px;
}

.graphwar-killer__route-toggle-static {
  align-items: center;
  color: var(--vp-c-white);
  display: flex;
  font-size: 0.9rem;
  justify-content: center;
  line-height: 1.15;
  min-height: 28px;
  min-width: 0;
  padding: 4px 10px;
  position: relative;
  text-align: center;
  z-index: 1;
}

.graphwar-killer__debug-timing {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  display: grid;
  font-size: 0.86rem;
  line-height: 1.6;
  margin: 0;
  overflow-x: auto;
  padding: 8px;
  white-space: nowrap;
}

.graphwar-killer__debug-timing-row {
  padding-inline-start: calc(var(--graphwar-killer-debug-indent-level, 0) * 1rem);
}

@media (width <= 760px) {
  .graphwar-killer__label-row,
  .graphwar-killer__route-row {
    grid-template-columns: 1fr;
  }

  .graphwar-killer__label-row {
    display: grid;
  }

  .graphwar-killer__label-row > span {
    overflow: visible;
    text-align: left;
    text-overflow: clip;
    white-space: normal;
  }
}
</style>
