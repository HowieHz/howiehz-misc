// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import { graphwarKillerLocale } from "../../locale";
import MainPanel from "./MainPanel.vue";

describe("Settings MainPanel", () => {
  it("places the advanced-settings switch after the Step switches", async () => {
    const wrapper = mount(MainPanel, {
      props: {
        locale: graphwarKillerLocale,
        panel: createPanel(),
      },
    });
    const switches = wrapper.findAll('.graphwar-killer__formula-options [role="switch"]');

    expect(wrapper.classes()).toContain("graphwar-killer-control-surface");
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

    await switches[2].trigger("click");
    expect(wrapper.emitted("toggleAdvancedSettings")).toHaveLength(1);

    await switches[2].trigger("pointerdown", { button: 0 });
    await switches[2].trigger("pointerup", { button: 0 });
    expect(wrapper.emitted("startDebugActivationHold")).toHaveLength(1);
    expect(wrapper.emitted("finishDebugActivationHold")).toHaveLength(1);
  });
});

/** Creates the smallest complete settings model needed to exercise the Step option row. */
function createPanel() {
  return {
    advancedSettingsVisible: false,
    algorithmMode: "step",
    algorithmModes: [{ disabled: false, label: "Step", title: "Step", value: "step" }],
    equationMode: "dy",
    equationModes: [{ disabled: false, label: "y'", title: "y'", value: "dy" }],
    headerStatus: { kind: "info", message: "" },
    interactionDisabled: false,
    precision: { maximum: 12, text: "4" },
    steepnessText: "67",
    stepGlitchModeEnabled: false,
    stepGlitchModeState: "normal",
    stepOverflowProtectionEnabled: true,
    toolWorkflowMode: "solver",
    toolWorkflowModes: [{ label: "Solver", title: "Solver", value: "solver" }],
  } as const;
}
