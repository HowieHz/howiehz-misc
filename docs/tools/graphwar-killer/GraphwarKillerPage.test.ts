// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";

import GraphwarKillerPage from "./GraphwarKillerPage.vue";
import { graphwarKillerLocale } from "./locale";

describe("Graphwar Killer page settings", () => {
  it("keeps the glitch preference independent while leaving it inactive for ABS ODE modes", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const yMode = wrapper.findAll(".graphwar-killer__equation-toggle button")[0];
    const absAlgorithm = wrapper.findAll(".graphwar-killer__algorithm-toggle button")[0];
    const glitchMode = wrapper.find("#graphwar-killer-step-glitch-mode");

    expect(yMode.attributes("aria-pressed")).toBe("true");
    expect(absAlgorithm.attributes("aria-pressed")).toBe("true");
    expect(glitchMode.attributes("aria-checked")).toBe("true");
    expect(wrapper.find("#graphwar-killer-step-glitch-mode-reason").text()).toContain(
      graphwarKillerLocale.ui.settings.stepGlitchModeGameModeInactiveReason,
    );

    await glitchMode.trigger("click");
    expect(glitchMode.attributes("aria-checked")).toBe("false");
    await glitchMode.trigger("click");

    expect(yMode.attributes("aria-pressed")).toBe("true");
    expect(absAlgorithm.attributes("aria-pressed")).toBe("true");
    expect(glitchMode.attributes("aria-checked")).toBe("true");

    await wrapper.findAll(".graphwar-killer__equation-toggle button")[1].trigger("click");
    await absAlgorithm.trigger("click");

    expect(wrapper.find("#graphwar-killer-step-glitch-mode-reason").text()).toContain(
      graphwarKillerLocale.ui.settings.stepGlitchModeAlgorithmInactiveReason,
    );

    await wrapper.findAll(".graphwar-killer__equation-toggle button")[2].trigger("click");
    await absAlgorithm.trigger("click");
    expect(wrapper.find("#graphwar-killer-step-glitch-mode-reason").text()).toContain(
      graphwarKillerLocale.ui.settings.stepGlitchModeAlgorithmInactiveReason,
    );
    wrapper.unmount();
  });

  it("leaves path planning under user control while glitch routing is effective", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const pathPlanning = wrapper.get("#graphwar-killer-path-planning");

    await wrapper.findAll(".graphwar-killer__equation-toggle button")[1].trigger("click");

    expect(pathPlanning.attributes("aria-checked")).toBe("false");
    expect(pathPlanning.attributes("disabled")).toBeUndefined();
    await pathPlanning.trigger("click");
    expect(pathPlanning.attributes("aria-checked")).toBe("true");
    wrapper.unmount();
  });

  it("retains formula controls per game mode while sharing the advanced-settings expansion", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });

    await wrapper.findAll(".graphwar-killer__algorithm-toggle button")[1].trigger("click");
    await wrapper.find(`[aria-label="${graphwarKillerLocale.ui.settings.decimalPlacesAriaLabel}"]`).setValue("1");
    await wrapper.find(`[aria-label="${graphwarKillerLocale.ui.settings.steepnessAriaLabel}"]`).setValue("67");
    await wrapper.find("#graphwar-killer-step-glitch-mode").trigger("click");
    await wrapper.find("#graphwar-killer-overflow-protection").trigger("click");
    await wrapper.find("#graphwar-killer-advanced-settings").trigger("click");

    await wrapper.findAll(".graphwar-killer__equation-toggle button")[1].trigger("click");

    expect(
      wrapper.find<HTMLInputElement>(`[aria-label="${graphwarKillerLocale.ui.settings.decimalPlacesAriaLabel}"]`)
        .element.value,
    ).toBe("4");
    expect(
      wrapper.find<HTMLInputElement>(`[aria-label="${graphwarKillerLocale.ui.settings.steepnessAriaLabel}"]`).element
        .value,
    ).toBe("210");
    expect(wrapper.find("#graphwar-killer-step-glitch-mode").attributes("aria-checked")).toBe("true");
    expect(wrapper.find("#graphwar-killer-overflow-protection").attributes("aria-checked")).toBe("true");
    expect(wrapper.find("#graphwar-killer-advanced-settings").attributes("aria-checked")).toBe("true");

    await wrapper.findAll(".graphwar-killer__equation-toggle button")[0].trigger("click");

    expect(
      wrapper.find<HTMLInputElement>(`[aria-label="${graphwarKillerLocale.ui.settings.decimalPlacesAriaLabel}"]`)
        .element.value,
    ).toBe("1");
    expect(
      wrapper.find<HTMLInputElement>(`[aria-label="${graphwarKillerLocale.ui.settings.steepnessAriaLabel}"]`).element
        .value,
    ).toBe("67");
    expect(wrapper.find("#graphwar-killer-step-glitch-mode").attributes("aria-checked")).toBe("false");
    expect(wrapper.find("#graphwar-killer-overflow-protection").attributes("aria-checked")).toBe("false");
    expect(wrapper.find("#graphwar-killer-advanced-settings").attributes("aria-checked")).toBe("true");
    wrapper.unmount();
  });

  it("keeps shared advanced settings available in the simulator workflow", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });

    await wrapper.findAll(".graphwar-killer__mode-toggle button")[1].trigger("click");

    const settingsPanel = wrapper.get(".graphwar-killer__settings-panel");
    expect(settingsPanel.find("#graphwar-killer-advanced-settings").exists()).toBe(true);
    expect(settingsPanel.find(".graphwar-killer__algorithm-toggle, input").exists()).toBe(false);

    await settingsPanel.get("#graphwar-killer-advanced-settings").trigger("click");

    expect(
      wrapper
        .get(".graphwar-killer__advanced-settings-panel")
        .findAll("h3")
        .map((heading) => heading.text()),
    ).toEqual([graphwarKillerLocale.ui.settings.bounds.heading, graphwarKillerLocale.ui.settings.simulator]);
    wrapper.unmount();
  });

  it("cancels a running search when ABS y'' steepness changes", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    await wrapper.findAll(".graphwar-killer__equation-toggle button")[2].trigger("click");
    await wrapper.findAll(".graphwar-killer__algorithm-toggle button")[0].trigger("click");
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          smartPathfindingInProgress: boolean;
          startSmartPathfinding: () => number;
        };
      }
    ).setupState;

    page.startSmartPathfinding();
    expect(page.smartPathfindingInProgress).toBe(true);
    await wrapper.find(`[aria-label="${graphwarKillerLocale.ui.settings.steepnessAriaLabel}"]`).setValue("211");
    await nextTick();

    expect(page.smartPathfindingInProgress).toBe(false);
    wrapper.unmount();
  });

  it("does not cancel a managed search after loading another formula profile", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    await wrapper.findAll(".graphwar-killer__algorithm-toggle button")[1].trigger("click");
    await wrapper.find("#graphwar-killer-overflow-protection").trigger("click");
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          activeObstacleSimulationToleranceText: string;
          collisionCheckEnabled: boolean;
          collisionCheckPreference: boolean | undefined;
          effectiveStepGlitchModeEnabled: boolean;
          graphwarAgentEnabled: boolean;
          graphwarAgentObstacleSimulationToleranceText: string;
          graphwarManagedModeEnabled: boolean;
          smartPathfindingInProgress: boolean;
          solverEquationMode: "ddy" | "dy" | "y";
          startSmartPathfinding: () => number;
          stepGlitchObstacleSimulationToleranceText: string;
        };
      }
    ).setupState;

    page.collisionCheckPreference = true;
    page.graphwarAgentEnabled = true;
    page.graphwarAgentObstacleSimulationToleranceText = "0";
    page.graphwarManagedModeEnabled = true;
    page.stepGlitchObstacleSimulationToleranceText = "1";
    await nextTick();
    expect(page.activeObstacleSimulationToleranceText).toBe("0");
    page.solverEquationMode = "dy";
    expect(page.effectiveStepGlitchModeEnabled).toBe(true);
    expect(page.activeObstacleSimulationToleranceText).toBe("1");
    expect(page.collisionCheckEnabled).toBe(true);
    page.startSmartPathfinding();
    expect(page.smartPathfindingInProgress).toBe(true);

    await nextTick();

    expect(page.smartPathfindingInProgress).toBe(true);
    wrapper.unmount();
  });
});
