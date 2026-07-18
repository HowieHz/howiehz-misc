// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import { graphwarKillerLocale } from "../../locale";
import MainPanel from "./MainPanel.vue";

describe("Result MainPanel", () => {
  it("places the fraction-output switch beside the solver title and locks it with managed interactions", async () => {
    const result = { ...createResultModel(), workflowMode: "solver" as const };
    const wrapper = mount(MainPanel, { props: { locale: graphwarKillerLocale, result } });
    const leading = wrapper.get(".graphwar-killer__result-leading");
    const toggle = leading.get("#graphwar-killer-fraction-output");

    expect(leading.element.children[0]).toBe(leading.get("h2").element);
    expect(leading.element.children[1]).toBe(toggle.element.parentElement);
    expect(toggle.attributes("aria-checked")).toBe("false");
    expect(toggle.attributes("title")).toBe(graphwarKillerLocale.ui.result.fractionOutputTitle);

    await toggle.trigger("click");
    expect(wrapper.emitted("toggleFractionOutput")).toHaveLength(1);

    await wrapper.setProps({ result: { ...result, fractionOutputEnabled: true, interactionDisabled: true } });
    expect(toggle.attributes("aria-checked")).toBe("true");
    expect(toggle.attributes()).toHaveProperty("disabled");
  });

  it("hides the fraction-output switch for simulator input", () => {
    const wrapper = mount(MainPanel, {
      props: { locale: graphwarKillerLocale, result: createResultModel() },
    });

    expect(wrapper.find("#graphwar-killer-fraction-output").exists()).toBe(false);
  });

  it("associates a partial fraction-conversion warning with the switch", () => {
    const result = {
      ...createResultModel(),
      fractionConversionWarning: graphwarKillerLocale.ui.result.fractionConversionIncomplete,
      workflowMode: "solver" as const,
    };
    const wrapper = mount(MainPanel, { props: { locale: graphwarKillerLocale, result } });
    const toggle = wrapper.get("#graphwar-killer-fraction-output");
    const reason = wrapper.get("#graphwar-killer-fraction-output-reason");

    expect(toggle.attributes("aria-describedby")).toBe("graphwar-killer-fraction-output-reason");
    expect(reason.text()).toBe(`! ${graphwarKillerLocale.ui.result.fractionConversionIncomplete}`);
    expect(reason.element.parentElement).toBe(toggle.element.parentElement);
  });

  it("keeps the full angle in the title while rendering compact hint text", () => {
    const wrapper = mount(MainPanel, {
      props: {
        locale: graphwarKillerLocale,
        result: { ...createResultModel(), secondOrderAngleHint: { text: "1e-101°", title: "0.000...010976°" } },
      },
    });
    const hint = wrapper.get(".graphwar-killer__second-order-angle-hint");

    expect(hint.text()).toBe("1e-101°");
    expect(hint.attributes("title")).toBe("0.000...010976°");
  });

  it("keeps the Agent fire reason directly below its button", () => {
    const result = createResultModel();
    const wrapper = mount(MainPanel, { props: { locale: graphwarKillerLocale, result } });
    const actions = wrapper.get(".graphwar-killer__result-actions");
    const fireField = actions.get(".graphwar-killer-command-field");

    expect(fireField.element.children[0]).toBe(fireField.get(".graphwar-killer__agent-fire-button").element);
    expect(fireField.element.children[1]).toBe(fireField.get(".graphwar-killer-control-reason").element);
    expect(fireField.element.nextElementSibling).toBe(actions.get(".graphwar-killer__primary-button").element);
    expect(actions.get(".graphwar-killer__primary-button").element.parentElement).toBe(actions.element);
    expect(actions.get(".graphwar-killer__icon-button").element.parentElement).toBe(actions.element);
  });

  it("shows the path point list in a collapsed shared details panel", () => {
    const result = {
      ...createResultModel(),
      pointRows: [
        {
          index: 0,
          label: graphwarKillerLocale.ui.point.selfLabel,
          x: { ariaLabel: "己方 x 坐标", text: "-10", title: "编辑 x" },
          y: { ariaLabel: "己方 y 坐标", text: "5", title: "编辑 y" },
        },
      ],
    };
    const wrapper = mount(MainPanel, { props: { locale: graphwarKillerLocale, result } });
    const details = wrapper.get("details.graphwar-killer-panel-details");

    expect(details.attributes("open")).toBeUndefined();
    expect(details.get("summary").text()).toBe(graphwarKillerLocale.ui.point.listSummary);
    expect(details.get(".graphwar-killer__point-table").text()).toContain(graphwarKillerLocale.ui.point.selfLabel);
  });
});

/** 创建结果面板测试共享的完整最小模型。 */
function createResultModel() {
  return {
    agentFireButtonText: graphwarKillerLocale.ui.result.fire,
    agentFireReason: graphwarKillerLocale.ui.pathfinding.capabilityReasons["managed-lock"],
    agentFireState: "busy",
    agentFireVisible: true,
    calculationMessage: "",
    calculationMessageVisible: false,
    canClearSimulatorInputs: true,
    canCopyFormula: true,
    copyButtonText: "复制函数",
    equationPrefix: "y=",
    fractionOutputEnabled: false,
    interactionDisabled: false,
    pointRows: [],
    secondOrderAngleHint: undefined,
    showSimulatorLaunchAngleInput: false,
    simulatorFormulaText: "",
    simulatorLaunchAngleText: "",
    solverExpression: "x",
    solverResultVisible: true,
    trajectoryWarning: "",
    workflowMode: "simulator",
  } as const;
}
