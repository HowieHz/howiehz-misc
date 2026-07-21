// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import { graphwarKillerLocale } from "../../locale";
import type { GraphwarAdvancedSettingsPanelModel } from "./advanced-panel-model";
import AdvancedPanel from "./AdvancedPanel.vue";

describe("AdvancedPanel", () => {
  it("keeps worker count visible while deletion radius follows the deletion preference", async () => {
    const panel: GraphwarAdvancedSettingsPanelModel = {
      actionBar: {
        liveClickPreviewWorkerCountMaximum: 8,
        liveClickPreviewWorkerCountText: "2",
      },
      bounds: { maxXText: "25", maxYText: "15", minXText: "-25", minYText: "-15" },
      interactionDisabled: false,
      pathfinding: {
        agentObstacleSimulationToleranceText: "0",
        agentRoutePlanningToleranceText: "2",
        detectionObstacleSimulationToleranceText: "1",
        detectionRoutePlanningToleranceText: "1",
        managedPollIntervalText: "1",
        managedShotReserveText: "3",
        stepGlitchObstacleSimulationToleranceText: "0",
        stepGlitchRoutePlanningToleranceText: "0",
        oneClickClearDeleteCheckRadiusMinimumPlanePixels: 0,
        oneClickClearDeleteCheckRadiusText: "3.5",
        oneClickClearDeleteCheckRadiusVisible: false,
        workerCountText: "4",
      },
      recognition: {
        candidateTopRatioText: "0.2",
        maximumSoldierCountText: "32",
        obstacleMaximumArea: 346_500,
        obstacleMinAreaText: "8",
        templateMatchingWorkerCountText: "2",
      },
      simulator: { parseDerivativeAsY: true, skipUnknownCharacters: true },
      solverSettingsVisible: true,
    };
    const wrapper = mount(AdvancedPanel, { props: { locale: graphwarKillerLocale, panel } });
    expect(wrapper.classes()).toContain("graphwar-killer-control-surface");
    const routeToleranceInputs = wrapper
      .findAll("input")
      .filter((input) =>
        input.attributes("aria-label")?.endsWith(graphwarKillerLocale.ui.pathfinding.routePlanningToleranceAriaLabel),
      );
    const simulationToleranceInputs = wrapper
      .findAll("input")
      .filter((input) =>
        input.attributes("aria-label")?.endsWith(graphwarKillerLocale.ui.pathfinding.simulationToleranceAriaLabel),
      );

    expect(wrapper.text()).toContain(graphwarKillerLocale.ui.pathfinding.obstacleExpansionDetectionMode);
    expect(wrapper.text()).toContain(graphwarKillerLocale.ui.pathfinding.obstacleExpansionAgentMode);
    expect(wrapper.text()).toContain(graphwarKillerLocale.ui.settings.stepGlitchMode);
    expect(routeToleranceInputs.map((input) => input.element.value)).toEqual(["1", "2", "0"]);
    expect(simulationToleranceInputs.map((input) => input.element.value)).toEqual(["1", "0", "0"]);
    await routeToleranceInputs[2].setValue("3");
    expect(wrapper.emitted("updateStepGlitchRoutePlanningToleranceText")).toEqual([["3"]]);

    const managedSettings = wrapper.find("#graphwar-killer-managed-settings-title").element.closest("details");
    expect(managedSettings?.hasAttribute("open")).toBe(false);
    expect(managedSettings?.textContent).toContain(graphwarKillerLocale.ui.settings.pathfinding.managedModeSettings);
    const shotReserveInput = wrapper.find(
      `[aria-label="${graphwarKillerLocale.ui.settings.pathfinding.managedShotReserveAriaLabel}"]`,
    );
    const pollIntervalInput = wrapper.find(
      `[aria-label="${graphwarKillerLocale.ui.settings.pathfinding.managedPollIntervalAriaLabel}"]`,
    );
    expect(shotReserveInput.attributes()).toMatchObject({ max: "60", min: "0.001", step: "0.001" });
    expect(pollIntervalInput.attributes()).toMatchObject({ max: "60", min: "0.001", step: "0.001" });
    await shotReserveInput.setValue("2.5");
    await pollIntervalInput.setValue("0.5");
    expect(wrapper.emitted("updateManagedShotReserveText")).toEqual([["2.5"]]);
    expect(wrapper.emitted("updateManagedPollIntervalText")).toEqual([["0.5"]]);

    expect(
      wrapper
        .findAll("input")
        .some(
          (input) =>
            input.attributes("aria-label") === graphwarKillerLocale.ui.settings.pathfinding.workerCountAriaLabel,
        ),
    ).toBe(true);
    expect(
      wrapper
        .findAll("input")
        .some(
          (input) =>
            input.attributes("aria-label") ===
            graphwarKillerLocale.ui.pathfinding.oneClickClearDeleteCheckRadiusAriaLabel,
        ),
    ).toBe(false);

    await wrapper.setProps({
      panel: {
        ...panel,
        pathfinding: { ...panel.pathfinding, oneClickClearDeleteCheckRadiusVisible: true },
      },
    });

    expect(
      wrapper
        .findAll("input")
        .some(
          (input) =>
            input.attributes("aria-label") ===
            graphwarKillerLocale.ui.pathfinding.oneClickClearDeleteCheckRadiusAriaLabel,
        ),
    ).toBe(true);

    await wrapper.setProps({ panel: { ...panel, solverSettingsVisible: false } });
    expect(wrapper.findAll("h3").map((heading) => heading.text())).toEqual([
      graphwarKillerLocale.ui.settings.bounds.heading,
      graphwarKillerLocale.ui.settings.simulator,
    ]);
    expect(
      [
        graphwarKillerLocale.ui.settings.recognition.maximumSoldierCountAriaLabel,
        graphwarKillerLocale.ui.settings.pathfinding.workerCountAriaLabel,
        graphwarKillerLocale.ui.settings.actionBar.liveClickPreviewWorkerCountAriaLabel,
      ].some((ariaLabel) => wrapper.find(`[aria-label="${ariaLabel}"]`).exists()),
    ).toBe(false);
  });
});
