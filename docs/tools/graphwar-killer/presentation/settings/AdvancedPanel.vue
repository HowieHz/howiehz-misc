<script setup lang="ts">
import { computed } from "vue";

import type { GraphwarKillerLocale } from "../../locale-types";
import PanelDetails from "../controls/PanelDetails.vue";
import ToggleField from "../controls/ToggleField.vue";
import type { GraphwarAdvancedSettingsPanelModel } from "./advanced-panel-model";

const props = defineProps<{
  /** 页面本地化文案。 */
  locale: GraphwarKillerLocale;
  /** 高级设置面板展示模型。 */
  panel: GraphwarAdvancedSettingsPanelModel;
}>();

const emit = defineEmits<{
  toggleSimulatorParseDerivativeAsY: [];
  toggleSimulatorSkipUnknownCharacters: [];
  updateAgentObstacleSimulationToleranceText: [value: string];
  updateAgentRoutePlanningToleranceText: [value: string];
  updateCandidateTopRatioText: [value: string];
  updateDetectionObstacleSimulationToleranceText: [value: string];
  updateDetectionRoutePlanningToleranceText: [value: string];
  updateStepGlitchObstacleSimulationToleranceText: [value: string];
  updateStepGlitchRoutePlanningToleranceText: [value: string];
  updateMaxXText: [value: string];
  updateMaxYText: [value: string];
  updateMaximumSoldierCountText: [value: string];
  updateMinXText: [value: string];
  updateMinYText: [value: string];
  updateLiveClickPreviewWorkerCountText: [value: string];
  updateManagedPollIntervalText: [value: string];
  updateManagedShotReserveText: [value: string];
  updateObstacleMinAreaText: [value: string];
  updateOneClickClearDeleteCheckRadiusText: [value: string];
  updatePathfindingWorkerCountText: [value: string];
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

const detectionRoutePlanningToleranceText = computed({
  get: () => props.panel.pathfinding.detectionRoutePlanningToleranceText,
  set: (value) => emit("updateDetectionRoutePlanningToleranceText", value),
});

const detectionObstacleSimulationToleranceText = computed({
  get: () => props.panel.pathfinding.detectionObstacleSimulationToleranceText,
  set: (value) => emit("updateDetectionObstacleSimulationToleranceText", value),
});

const agentRoutePlanningToleranceText = computed({
  get: () => props.panel.pathfinding.agentRoutePlanningToleranceText,
  set: (value) => emit("updateAgentRoutePlanningToleranceText", value),
});

const agentObstacleSimulationToleranceText = computed({
  get: () => props.panel.pathfinding.agentObstacleSimulationToleranceText,
  set: (value) => emit("updateAgentObstacleSimulationToleranceText", value),
});

const stepGlitchRoutePlanningToleranceText = computed({
  get: () => props.panel.pathfinding.stepGlitchRoutePlanningToleranceText,
  set: (value) => emit("updateStepGlitchRoutePlanningToleranceText", value),
});

const stepGlitchObstacleSimulationToleranceText = computed({
  get: () => props.panel.pathfinding.stepGlitchObstacleSimulationToleranceText,
  set: (value) => emit("updateStepGlitchObstacleSimulationToleranceText", value),
});

const pathfindingWorkerCountText = computed({
  get: () => props.panel.pathfinding.workerCountText,
  set: (value) => emit("updatePathfindingWorkerCountText", value),
});

const managedShotReserveText = computed({
  get: () => props.panel.pathfinding.managedShotReserveText,
  set: (value) => emit("updateManagedShotReserveText", value),
});

const managedPollIntervalText = computed({
  get: () => props.panel.pathfinding.managedPollIntervalText,
  set: (value) => emit("updateManagedPollIntervalText", value),
});

const oneClickClearDeleteCheckRadiusText = computed({
  get: () => props.panel.pathfinding.oneClickClearDeleteCheckRadiusText,
  set: (value) => emit("updateOneClickClearDeleteCheckRadiusText", value),
});

const liveClickPreviewWorkerCountText = computed({
  get: () => props.panel.actionBar.liveClickPreviewWorkerCountText,
  set: (value) => emit("updateLiveClickPreviewWorkerCountText", value),
});
</script>

<template>
  <section
    class="graphwar-killer__panel graphwar-killer__advanced-settings-panel graphwar-killer-control-surface"
    aria-labelledby="graphwar-killer-advanced-settings-title"
    :aria-disabled="!panel.canInteract"
  >
    <div class="graphwar-killer__label-row">
      <h2 id="graphwar-killer-advanced-settings-title">
        {{ locale.ui.settings.advancedSettings }}
      </h2>
    </div>
    <fieldset
      class="graphwar-killer__advanced-settings-fields"
      :disabled="!panel.canInteract"
    >
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
            <ToggleField
              id="graphwar-killer-skip-unknown-characters"
              :checked="panel.simulator.shouldSkipUnknownCharacters"
              :label="locale.ui.settings.skipUnknownCharacters"
              state="normal"
              :title="locale.ui.settings.skipUnknownCharactersTitle"
              @toggle="emit('toggleSimulatorSkipUnknownCharacters')"
            />
            <ToggleField
              id="graphwar-killer-parse-derivative-as-y"
              :checked="panel.simulator.shouldParseDerivativeAsY"
              :label="locale.ui.settings.parseDerivativeAsY"
              state="normal"
              :title="locale.ui.settings.parseDerivativeAsYTitle"
              @toggle="emit('toggleSimulatorParseDerivativeAsY')"
            />
          </div>
        </div>
        <div
          v-if="panel.isSolverSettingsVisible"
          class="graphwar-killer__subpanel graphwar-killer__advanced-settings-group"
        >
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
          </div>
        </div>
        <div
          v-if="panel.isSolverSettingsVisible"
          class="graphwar-killer__subpanel graphwar-killer__advanced-settings-group"
        >
          <h3>
            {{ locale.ui.settings.pathfinding.heading }}
          </h3>
          <PanelDetails
            summary-id="graphwar-killer-obstacle-expansion-title"
            :summary="locale.ui.pathfinding.obstacleExpansion"
            :summary-title="locale.ui.pathfinding.obstacleExpansionTitle"
          >
            <div class="graphwar-killer__obstacle-expansion-grid">
              <div class="graphwar-killer__obstacle-expansion-source">
                <strong>{{ locale.ui.pathfinding.obstacleExpansionDetectionMode }}</strong>
                <label
                  class="graphwar-killer__detection-setting-label"
                  :title="locale.ui.pathfinding.routePlanningToleranceTitle"
                >
                  {{ locale.ui.pathfinding.routePlanningTolerance }}
                  <input
                    v-model="detectionRoutePlanningToleranceText"
                    inputmode="decimal"
                    :aria-label="`${locale.ui.pathfinding.obstacleExpansionDetectionMode}: ${locale.ui.pathfinding.routePlanningToleranceAriaLabel}`"
                    :title="locale.ui.pathfinding.routePlanningToleranceTitle"
                  >
                  <span>{{ locale.ui.pathfinding.unit }}</span>
                </label>
                <label
                  class="graphwar-killer__detection-setting-label"
                  :title="locale.ui.pathfinding.simulationToleranceTitle"
                >
                  {{ locale.ui.pathfinding.simulationTolerance }}
                  <input
                    v-model="detectionObstacleSimulationToleranceText"
                    inputmode="decimal"
                    :aria-label="`${locale.ui.pathfinding.obstacleExpansionDetectionMode}: ${locale.ui.pathfinding.simulationToleranceAriaLabel}`"
                    :title="locale.ui.pathfinding.simulationToleranceTitle"
                  >
                  <span>{{ locale.ui.pathfinding.unit }}</span>
                </label>
              </div>
              <div class="graphwar-killer__obstacle-expansion-source">
                <strong>{{ locale.ui.pathfinding.obstacleExpansionAgentMode }}</strong>
                <label
                  class="graphwar-killer__detection-setting-label"
                  :title="locale.ui.pathfinding.routePlanningToleranceTitle"
                >
                  {{ locale.ui.pathfinding.routePlanningTolerance }}
                  <input
                    v-model="agentRoutePlanningToleranceText"
                    inputmode="decimal"
                    :aria-label="`${locale.ui.pathfinding.obstacleExpansionAgentMode}: ${locale.ui.pathfinding.routePlanningToleranceAriaLabel}`"
                    :title="locale.ui.pathfinding.routePlanningToleranceTitle"
                  >
                  <span>{{ locale.ui.pathfinding.unit }}</span>
                </label>
                <label
                  class="graphwar-killer__detection-setting-label"
                  :title="locale.ui.pathfinding.simulationToleranceTitle"
                >
                  {{ locale.ui.pathfinding.simulationTolerance }}
                  <input
                    v-model="agentObstacleSimulationToleranceText"
                    inputmode="decimal"
                    :aria-label="`${locale.ui.pathfinding.obstacleExpansionAgentMode}: ${locale.ui.pathfinding.simulationToleranceAriaLabel}`"
                    :title="locale.ui.pathfinding.simulationToleranceTitle"
                  >
                  <span>{{ locale.ui.pathfinding.unit }}</span>
                </label>
              </div>
              <div class="graphwar-killer__obstacle-expansion-source">
                <strong>{{ locale.ui.settings.stepGlitchMode }}</strong>
                <label
                  class="graphwar-killer__detection-setting-label"
                  :title="locale.ui.pathfinding.routePlanningToleranceTitle"
                >
                  {{ locale.ui.pathfinding.routePlanningTolerance }}
                  <input
                    v-model="stepGlitchRoutePlanningToleranceText"
                    inputmode="decimal"
                    :aria-label="`${locale.ui.settings.stepGlitchMode}: ${locale.ui.pathfinding.routePlanningToleranceAriaLabel}`"
                    :title="locale.ui.pathfinding.routePlanningToleranceTitle"
                  >
                  <span>{{ locale.ui.pathfinding.unit }}</span>
                </label>
                <label
                  class="graphwar-killer__detection-setting-label"
                  :title="locale.ui.pathfinding.simulationToleranceTitle"
                >
                  {{ locale.ui.pathfinding.simulationTolerance }}
                  <input
                    v-model="stepGlitchObstacleSimulationToleranceText"
                    inputmode="decimal"
                    :aria-label="`${locale.ui.settings.stepGlitchMode}: ${locale.ui.pathfinding.simulationToleranceAriaLabel}`"
                    :title="locale.ui.pathfinding.simulationToleranceTitle"
                  >
                  <span>{{ locale.ui.pathfinding.unit }}</span>
                </label>
              </div>
            </div>
          </PanelDetails>
          <PanelDetails
            summary-id="graphwar-killer-managed-settings-title"
            :summary="locale.ui.settings.pathfinding.managedModeSettings"
            :summary-title="locale.ui.settings.pathfinding.managedModeSettingsTitle"
          >
            <div class="graphwar-killer__managed-settings-grid">
              <label
                class="graphwar-killer__detection-setting-label"
                :title="locale.ui.settings.pathfinding.managedShotReserveTitle"
              >
                {{ locale.ui.settings.pathfinding.managedShotReserve }}
                <input
                  v-model="managedShotReserveText"
                  inputmode="decimal"
                  min="0.001"
                  max="60"
                  step="0.001"
                  autocomplete="off"
                  :aria-label="locale.ui.settings.pathfinding.managedShotReserveAriaLabel"
                  :title="locale.ui.settings.pathfinding.managedShotReserveTitle"
                >
                <span>s</span>
              </label>
              <label
                class="graphwar-killer__detection-setting-label"
                :title="locale.ui.settings.pathfinding.managedPollIntervalTitle"
              >
                {{ locale.ui.settings.pathfinding.managedPollInterval }}
                <input
                  v-model="managedPollIntervalText"
                  inputmode="decimal"
                  min="0.001"
                  max="60"
                  step="0.001"
                  autocomplete="off"
                  :aria-label="locale.ui.settings.pathfinding.managedPollIntervalAriaLabel"
                  :title="locale.ui.settings.pathfinding.managedPollIntervalTitle"
                >
                <span>s</span>
              </label>
            </div>
          </PanelDetails>
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
            v-if="panel.pathfinding.isOneClickClearDeleteCheckRadiusVisible"
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
        <div
          v-if="panel.isSolverSettingsVisible"
          class="graphwar-killer__subpanel graphwar-killer__advanced-settings-group"
        >
          <h3>
            {{ locale.ui.settings.actionBar.heading }}
          </h3>
          <label
            class="graphwar-killer__detection-setting-label graphwar-killer__pathfinding-setting-label"
            :title="locale.ui.settings.actionBar.liveClickPreviewWorkerCountTitle"
          >
            {{ locale.ui.settings.actionBar.liveClickPreviewWorkerCount }}
            <input
              v-model="liveClickPreviewWorkerCountText"
              inputmode="numeric"
              min="1"
              :max="panel.actionBar.liveClickPreviewWorkerCountMaximum"
              autocomplete="off"
              :aria-label="locale.ui.settings.actionBar.liveClickPreviewWorkerCountAriaLabel"
              :title="locale.ui.settings.actionBar.liveClickPreviewWorkerCountTitle"
            >
          </label>
        </div>
      </div>
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

.graphwar-killer__advanced-settings-panel h2 {
  border: 0;
  font-size: 1rem;
  margin: 0;
  padding: 0;
}

.graphwar-killer__advanced-settings-panel label {
  display: grid;
  font-size: 0.9rem;
  font-weight: 600;
  gap: 3px;
  line-height: 1.3;
  min-width: 0;
}

.graphwar-killer__advanced-settings-panel input:not([type="file"]) {
  width: 92px;
}

.graphwar-killer__advanced-settings-fields {
  border: 0;
  margin: 0;
  min-inline-size: 0;
  padding: 0;
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

.graphwar-killer__managed-settings-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 320px));
  justify-content: start;
}

.graphwar-killer__obstacle-expansion-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 320px));
  justify-content: start;
  min-width: 0;
}

.graphwar-killer__obstacle-expansion-source {
  align-content: start;
  display: grid;
  gap: 6px;
  min-width: 0;
}

.graphwar-killer__obstacle-expansion-source > strong {
  font-size: 0.9rem;
  line-height: 1.3;
}

.graphwar-killer__recognition-setting-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.graphwar-killer__coordinate-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}

.graphwar-killer__coordinate-grid label {
  align-items: center;
  gap: 6px;
  grid-template-columns: max-content 92px;
  justify-content: start;
}

.graphwar-killer__detection-setting-label {
  align-items: center;
  font-weight: 600;
  gap: 6px;
  grid-template-columns: max-content 92px auto;
  justify-content: start;
}

.graphwar-killer__detection-setting-label span {
  color: color-mix(in srgb, var(--vp-c-text-1) 68%, var(--vp-c-text-2) 32%);
  font-size: 0.88rem;
  font-weight: 500;
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
