// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import { graphwarKillerLocale } from "../../locale";
import MainPanel from "./MainPanel.vue";

describe("Result MainPanel", () => {
  it("keeps the Agent fire reason directly below its button", () => {
    const result = {
      agentFireButtonText: graphwarKillerLocale.ui.result.fire,
      agentFireReason: graphwarKillerLocale.ui.pathfinding.capabilityReasons["managed-lock"],
      agentFireState: "busy" as const,
      agentFireVisible: true,
      calculationMessage: "",
      calculationMessageVisible: false,
      canClearSimulatorInputs: true,
      canCopyFormula: true,
      copyButtonText: "复制函数",
      equationPrefix: "y=",
      interactionDisabled: false,
      pointRows: [],
      secondOrderAngleHint: "",
      showSimulatorLaunchAngleInput: false,
      simulatorFormulaText: "",
      simulatorLaunchAngleText: "",
      solverExpression: "x",
      solverResultVisible: true,
      trajectoryWarning: "",
      workflowMode: "simulator" as const,
    };
    const wrapper = mount(MainPanel, { props: { locale: graphwarKillerLocale, result } });
    const actions = wrapper.get(".graphwar-killer__result-actions");
    const fireField = actions.get(".graphwar-killer-command-field");

    expect(fireField.element.children[0]).toBe(fireField.get(".graphwar-killer__agent-fire-button").element);
    expect(fireField.element.children[1]).toBe(fireField.get(".graphwar-killer-control-reason").element);
    expect(fireField.element.nextElementSibling).toBe(actions.get(".graphwar-killer__primary-button").element);
    expect(actions.get(".graphwar-killer__primary-button").element.parentElement).toBe(actions.element);
    expect(actions.get(".graphwar-killer__icon-button").element.parentElement).toBe(actions.element);
  });
});
