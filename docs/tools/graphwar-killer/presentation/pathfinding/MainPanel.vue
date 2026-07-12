<script setup lang="ts">
import type { GraphwarControlCapability } from "../../controllers/page/capabilities";
import type { GraphwarKillerLocale } from "../../locale-types";
import type { GraphwarPathfindingRouteMode } from "../../pathfinding/routing/mode";
import ToggleField from "../controls/ToggleField.vue";

type GraphwarPathfindingPanelStatusKind = "info" | "success" | "warning" | "error";

interface GraphwarPathfindingPanelHeaderStatus {
  /** Full task status shown beside the panel heading. */
  message: string;
  /** Visual status semantics retained from the existing workflow. */
  kind: GraphwarPathfindingPanelStatusKind;
  /** Supplementary hover text for truncated desktop layouts. */
  title: string;
}

interface GraphwarPathfindingPanelDebugRow {
  /** Stable row key derived from the original stage and index. */
  key: string;
  /** Fully formatted timing text. */
  text: string;
  /** Visual nesting level used by worker sub-stages. */
  indentLevel: number;
  /** Optional full stage explanation. */
  title?: string;
}

interface GraphwarPathfindingToggle {
  /** Persisted preference value. */
  enabled: boolean;
  /** Shared capability state used by presentation and command guards. */
  state: GraphwarControlCapability["state"];
  /** Localised explanation for a non-normal state. */
  reason?: string;
}

interface GraphwarPathfindingTask {
  /** Shared capability state used by presentation and command guards. */
  state: GraphwarControlCapability["state"];
  /** Localised explanation for a non-normal state. */
  reason?: string;
  /** Supplementary command description. */
  title: string;
}

export interface GraphwarSmartPathfindingPanelModel {
  /** Whether current formula semantics use the fixed Step y' glitch scanner. */
  usesStepGlitchRouting: boolean;
  /** Ordinary geometry router; ignored while the fixed glitch scanner is active. */
  routeMode: GraphwarPathfindingRouteMode;
  /** Global point-deletion preference. */
  deleteOptimization: GraphwarPathfindingToggle;
  /** Whether pathfinding may cross friendly soldiers. */
  friendlyFire: GraphwarPathfindingToggle;
  /** Presentation-only search preview preference. */
  searchAnimation: GraphwarPathfindingToggle;
  /** One-click clear command state. */
  oneClickClear: GraphwarPathfindingTask;
  /** Managed mode switch state. */
  managedMode: GraphwarPathfindingToggle & { title: string };
  /** Compact summaries of the three independently retained formula profiles. */
  managedProfiles: readonly { equation: string; formula: string }[];
  /** Persistent warning while managed mode may target friendly soldiers. */
  managedFriendlyFireWarning: string;
  /** Current task status shown in the panel heading. */
  headerStatus: GraphwarPathfindingPanelHeaderStatus;
  /** Whether debug timing details should be rendered. */
  debugTimingVisible: boolean;
  /** Preformatted debug timing rows. */
  debugTimingRows: readonly GraphwarPathfindingPanelDebugRow[];
}

defineProps<{
  /** Page localisation. */
  locale: GraphwarKillerLocale;
  /** Pathfinding task and option presentation model. */
  panel: GraphwarSmartPathfindingPanelModel;
}>();

const emit = defineEmits<{
  runOneClickClear: [];
  setRouteMode: [mode: GraphwarPathfindingRouteMode];
  toggleDeleteOptimization: [];
  toggleFriendlyFire: [];
  toggleManagedMode: [];
  toggleSearchAnimation: [];
}>();
</script>

<template>
  <section
    class="graphwar-killer__panel graphwar-killer__pathfinding-panel"
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

    <section
      class="graphwar-killer__pathfinding-section"
      aria-labelledby="graphwar-killer-pathfinding-tasks-title"
    >
      <h3 id="graphwar-killer-pathfinding-tasks-title">
        {{ locale.ui.pathfinding.tasksTitle }}
      </h3>
      <div class="graphwar-killer__task-controls">
        <div class="graphwar-killer__command-field">
          <button
            type="button"
            :aria-describedby="panel.oneClickClear.reason ? 'graphwar-killer-one-click-clear-reason' : undefined"
            :disabled="panel.oneClickClear.state === 'blocked' || panel.oneClickClear.state === 'busy'"
            :title="panel.oneClickClear.title"
            @click="emit('runOneClickClear')"
          >
            {{ locale.ui.pathfinding.autoGraph }}
          </button>
          <p
            v-if="panel.oneClickClear.reason"
            id="graphwar-killer-one-click-clear-reason"
            class="graphwar-killer__control-reason"
          >
            <span aria-hidden="true">!</span>
            {{ panel.oneClickClear.reason }}
          </p>
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
      <div class="graphwar-killer__managed-profiles">
        <span>{{ locale.ui.pathfinding.managedProfilesTitle }}</span>
        <span
          v-for="profile in panel.managedProfiles"
          :key="profile.equation"
        >
          {{ profile.equation }}: {{ profile.formula }}
        </span>
      </div>
      <p
        v-if="panel.managedFriendlyFireWarning"
        class="graphwar-killer__managed-warning"
      >
        {{ panel.managedFriendlyFireWarning }}
      </p>
    </section>

    <section
      class="graphwar-killer__pathfinding-section"
      aria-labelledby="graphwar-killer-pathfinding-options-title"
    >
      <h3 id="graphwar-killer-pathfinding-options-title">
        {{ locale.ui.pathfinding.optionsTitle }}
      </h3>
      <div class="graphwar-killer__route-row">
        <span>{{ locale.ui.pathfinding.routeAlgorithm }}</span>
        <strong v-if="panel.usesStepGlitchRouting">{{ locale.ui.pathfinding.routeXPlusScan }}</strong>
        <div
          v-else
          class="graphwar-killer__route-toggle"
          role="group"
          :aria-label="locale.ui.pathfinding.routeAlgorithm"
          :title="locale.ui.pathfinding.routeAlgorithmTitle"
        >
          <button
            type="button"
            :aria-pressed="panel.routeMode === 'visibility-graph'"
            :class="{ 'graphwar-killer__route-toggle-button--active': panel.routeMode === 'visibility-graph' }"
            :disabled="panel.deleteOptimization.state === 'busy'"
            @click="emit('setRouteMode', 'visibility-graph')"
          >
            {{ locale.ui.pathfinding.routeLazyVisibilityGraph }}
          </button>
          <button
            type="button"
            :aria-pressed="panel.routeMode === 'theta-star'"
            :class="{ 'graphwar-killer__route-toggle-button--active': panel.routeMode === 'theta-star' }"
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
    </section>

    <details
      v-if="panel.debugTimingVisible"
      class="graphwar-killer__details"
    >
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

.graphwar-killer__pathfinding-panel h2,
.graphwar-killer__pathfinding-panel h3 {
  border: 0;
  margin: 0;
  padding: 0;
}

.graphwar-killer__pathfinding-panel h2 {
  font-size: 1rem;
}

.graphwar-killer__pathfinding-panel h3 {
  font-size: 0.9rem;
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
.graphwar-killer__managed-warning,
.graphwar-killer__control-reason {
  color: #b45309;
  font-weight: 700;
}

.graphwar-killer__label-row > .graphwar-killer__label-status--success {
  color: #15803d;
  font-weight: 700;
}

.graphwar-killer__pathfinding-section {
  border-top: 1px solid var(--vp-c-divider);
  display: grid;
  gap: 8px;
  min-width: 0;
  padding-top: 8px;
}

.graphwar-killer__task-controls,
.graphwar-killer__option-grid {
  display: grid;
  gap: 6px;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
}

.graphwar-killer__command-field {
  display: grid;
  gap: 4px;
  padding: 7px 8px;
}

.graphwar-killer__pathfinding-panel button {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  color: var(--vp-c-text-1);
  cursor: pointer;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  min-height: 34px;
  padding: 6px 10px;
}

.graphwar-killer__pathfinding-panel button:disabled {
  cursor: not-allowed;
  opacity: 58%;
}

.graphwar-killer__control-reason,
.graphwar-killer__managed-warning {
  font-size: 0.82rem;
  line-height: 1.4;
  margin: 0;
}

.graphwar-killer__control-reason {
  display: flex;
  gap: 5px;
}

.graphwar-killer__managed-profiles {
  align-items: center;
  color: var(--vp-c-text-2);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.82rem;
  gap: 4px 10px;
}

.graphwar-killer__managed-profiles > :first-child {
  color: var(--vp-c-text-1);
  font-weight: 700;
}

.graphwar-killer__route-row {
  align-items: center;
  display: grid;
  gap: 8px;
  grid-template-columns: max-content minmax(0, 1fr);
}

.graphwar-killer__route-row > span,
.graphwar-killer__route-row > strong {
  font-size: 0.86rem;
}

.graphwar-killer__route-toggle {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  max-width: 360px;
  padding: 2px;
}

.graphwar-killer__route-toggle button {
  background: transparent;
  border: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.graphwar-killer__route-toggle-button--active {
  background: var(--vp-c-brand-1) !important;
  color: var(--vp-c-white) !important;
}

.graphwar-killer__details > summary {
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 700;
}

.graphwar-killer__debug-timing {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  display: grid;
  font-size: 0.86rem;
  line-height: 1.6;
  margin-top: 8px;
  overflow-x: auto;
  padding: 8px;
  white-space: nowrap;
}

.graphwar-killer__debug-timing-row {
  padding-inline-start: calc(var(--graphwar-killer-debug-indent-level, 0) * 1rem);
}

.graphwar-killer__pathfinding-panel button:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.graphwar-killer__pathfinding-panel button:focus-visible {
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--vp-c-brand-1) 16%, transparent);
  outline: none;
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
