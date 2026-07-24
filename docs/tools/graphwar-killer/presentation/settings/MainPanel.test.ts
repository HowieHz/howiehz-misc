// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import { graphwarKillerLocale } from "../../locale";
import MainPanel from "./MainPanel.vue";

describe("Settings MainPanel", () => {
  it("places the advanced-settings switch after the formula switches", async () => {
    const wrapper = mount(MainPanel, {
      props: {
        locale: graphwarKillerLocale,
        panel: createPanel(),
      },
    });
    const switches = wrapper.findAll('.graphwar-killer__formula-options [role="switch"]');
    const panels = wrapper.findAll(".graphwar-killer__settings-stack > .graphwar-killer__panel");

    expect(panels).toHaveLength(3);
    expect(panels.every((panel) => panel.classes().includes("graphwar-killer-control-surface"))).toBe(true);
    expect(panels.map((panel) => panel.find("h2").text())).toEqual([
      graphwarKillerLocale.ui.settings.mode,
      graphwarKillerLocale.ui.settings.gameMode,
      graphwarKillerLocale.ui.settings.title,
    ]);
    expect(panels[0].findAll(".graphwar-killer__mode-toggle")).toHaveLength(1);
    expect(panels[0].find(".graphwar-killer__label-row > span").text()).toBe("Solver");
    expect(panels[0].find(".graphwar-killer__equation-toggle, .graphwar-killer__algorithm-toggle").exists()).toBe(
      false,
    );
    expect(panels[0].find(".graphwar-killer__setting-label").exists()).toBe(false);
    expect(panels[1].findAll(".graphwar-killer__equation-toggle")).toHaveLength(1);
    expect(panels[1].find(".graphwar-killer__label-row > span").text()).toBe(
      graphwarKillerLocale.ui.settings.gameModeSettingsHint,
    );
    expect(panels[1].find(".graphwar-killer__mode-toggle, .graphwar-killer__algorithm-toggle").exists()).toBe(false);
    expect(panels[1].find(".graphwar-killer__setting-label").exists()).toBe(false);
    expect(panels[2].findAll(".graphwar-killer__algorithm-toggle")).toHaveLength(1);
    expect(panels[2].find(".graphwar-killer__mode-toggle, .graphwar-killer__equation-toggle").exists()).toBe(false);
    expect(
      wrapper
        .findAll(".graphwar-killer__tool-toggle button, .graphwar-killer__equation-toggle button")
        .every((button) => button.classes().includes("graphwar-killer-segmented-button")),
    ).toBe(true);
    expect(
      wrapper
        .findAll('[aria-pressed="true"]')
        .every((button) => button.classes().includes("graphwar-killer-segmented-button--active")),
    ).toBe(true);
    expect(switches.map((control) => control.attributes("id"))).toEqual([
      "graphwar-killer-overflow-protection",
      "graphwar-killer-step-glitch-mode",
      "graphwar-killer-advanced-settings",
    ]);
    expect(switches[2].attributes("aria-checked")).toBe("false");
    expect(
      wrapper.find(`[aria-label="${graphwarKillerLocale.ui.settings.decimalPlacesAriaLabel}"]`).attributes("title"),
    ).toBe(graphwarKillerLocale.ui.settings.decimalPlacesTitle);

    await switches[2].trigger("click");
    expect(wrapper.emitted("toggleAdvancedSettings")).toHaveLength(1);

    await switches[2].trigger("pointerdown", { button: 0 });
    await switches[2].trigger("pointerup", { button: 0 });
    expect(wrapper.emitted("startDebugActivationHold")).toHaveLength(1);
    expect(wrapper.emitted("finishDebugActivationHold")).toHaveLength(1);
  });

  it("hides the Step glitch switch for y mode", () => {
    const wrapper = mount(MainPanel, {
      props: {
        locale: graphwarKillerLocale,
        panel: {
          ...createPanel(),
          equationMode: "y",
          equationModes: [{ isEnabled: true, label: "y", title: "y", value: "y" }],
        },
      },
    });

    expect(wrapper.find("#graphwar-killer-step-glitch-mode").exists()).toBe(false);
  });

  it("shows steepness but not the Step overflow switch for ABS y''", () => {
    const wrapper = mount(MainPanel, {
      props: {
        locale: graphwarKillerLocale,
        panel: {
          ...createPanel(),
          algorithmMode: "abs",
          algorithmModes: [{ isEnabled: true, label: "ABS", title: "ABS", value: "abs" }],
          equationMode: "ddy",
          equationModes: [{ isEnabled: true, label: "y''", title: "y''", value: "ddy" }],
          isSteepnessVisible: true,
        },
      },
    });

    expect(wrapper.find(`[aria-label="${graphwarKillerLocale.ui.settings.steepnessAriaLabel}"]`).exists()).toBe(true);
    expect(wrapper.find("#graphwar-killer-overflow-protection").exists()).toBe(false);
    expect(wrapper.find("#graphwar-killer-step-glitch-mode").attributes("aria-checked")).toBe("false");
  });

  it("keeps only the advanced-settings switch in Simulator settings", async () => {
    const panel = {
      ...createPanel(),
      headerStatus: { kind: "info" as const, message: "simulator description" },
      toolWorkflowMode: "simulator" as const,
    };
    const wrapper = mount(MainPanel, {
      props: {
        locale: graphwarKillerLocale,
        panel,
      },
    });
    const panels = wrapper.findAll(".graphwar-killer__settings-stack > .graphwar-killer__panel");

    expect(panels).toHaveLength(3);
    expect(panels.map((panel) => panel.find("h2").text())).toEqual([
      graphwarKillerLocale.ui.settings.mode,
      graphwarKillerLocale.ui.settings.gameMode,
      graphwarKillerLocale.ui.settings.title,
    ]);
    expect(panels[0].findAll(".graphwar-killer__mode-toggle")).toHaveLength(1);
    expect(panels[0].find(".graphwar-killer__label-row > span").text()).toBe("Simulator");
    expect(panels[0].find(".graphwar-killer__equation-toggle").exists()).toBe(false);
    expect(panels[1].findAll(".graphwar-killer__equation-toggle")).toHaveLength(1);
    expect(panels[1].find(".graphwar-killer__mode-toggle").exists()).toBe(false);
    expect(panels[2].find(".graphwar-killer__algorithm-toggle, input").exists()).toBe(false);
    expect(panels[2].find(".graphwar-killer__label-row > span").exists()).toBe(false);
    expect(panels[2].findAll('[role="switch"]').map((control) => control.attributes("id"))).toEqual([
      "graphwar-killer-advanced-settings",
    ]);

    await wrapper.setProps({ panel: { ...panel, headerStatus: { kind: "warning", message: "warning" } } });
    expect(panels[2].find(".graphwar-killer__label-row > span").text()).toBe("warning");
  });

  it("keeps advanced settings available while managed mode locks formula controls", async () => {
    const reason = graphwarKillerLocale.ui.pathfinding.capabilityReasons["managed-lock"];
    const wrapper = mount(MainPanel, {
      props: {
        locale: graphwarKillerLocale,
        panel: {
          ...createPanel(),
          canInteract: false,
          stepGlitchModeReason: reason,
          stepGlitchModeState: "busy" as const,
          temporaryDisabledReason: reason,
        },
      },
    });

    for (const button of wrapper.findAll<HTMLButtonElement>(".graphwar-killer-segmented-button")) {
      expect(button.element.disabled).toBe(true);
      expect(button.attributes("title")?.startsWith(`${reason}\n`)).toBe(true);
    }

    const switchTitles = new Map([
      ["graphwar-killer-overflow-protection", graphwarKillerLocale.ui.settings.overflowProtectionTitle],
      ["graphwar-killer-step-glitch-mode", graphwarKillerLocale.ui.settings.stepGlitchModeTitle],
    ]);
    for (const [id, title] of switchTitles) {
      const control = wrapper.get(`#${id}`);
      expect(control.attributes("disabled")).toBeDefined();
      expect(control.attributes("title")).toBe(title ? `${reason}\n${title}` : reason);
      expect(wrapper.find(`#${id}-reason`).exists()).toBe(false);
    }
    for (const input of wrapper.findAll<HTMLInputElement>("input")) {
      expect(input.element.disabled).toBe(true);
      expect(input.attributes("title")?.startsWith(`${reason}\n`)).toBe(true);
    }
    const advancedSettings = wrapper.get("#graphwar-killer-advanced-settings");
    expect(advancedSettings.attributes("disabled")).toBeUndefined();
    expect(advancedSettings.attributes("title")).toBeUndefined();
    await advancedSettings.trigger("click");
    expect(wrapper.emitted("toggleAdvancedSettings")).toHaveLength(1);
    expect(wrapper.text()).not.toContain(reason);
  });
});

/** 创建覆盖公式开关排列所需的最小完整设置模型。 */
function createPanel() {
  return {
    isAdvancedSettingsVisible: false,
    algorithmMode: "step",
    algorithmModes: [{ isEnabled: true, label: "Step", title: "Step", value: "step" }],
    equationMode: "dy",
    equationModes: [{ isEnabled: true, label: "y'", title: "y'", value: "dy" }],
    headerStatus: { kind: "info", message: "" },
    canInteract: true,
    precision: { maximum: 12, text: "4" },
    steepnessText: "67",
    isSteepnessVisible: true,
    isStepGlitchModeEnabled: false,
    stepGlitchModeState: "normal",
    isStepOverflowProtectionEnabled: true,
    toolWorkflowMode: "solver",
    toolWorkflowModes: [
      { label: "Solver", title: "Solver", value: "solver" },
      { label: "Simulator", title: "Simulator", value: "simulator" },
    ],
  } as const;
}
