// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { computed, nextTick, ref, type ComponentPublicInstance } from "vue";

import { graphwarKillerLocale } from "../../locale";
import AgentTurnCountdown from "./AgentTurnCountdown.vue";
import MainPanel from "./MainPanel.vue";

describe("Result MainPanel", () => {
  it("places the fraction-output switch beside the solver title and locks it with managed interactions", async () => {
    const reason = graphwarKillerLocale.ui.pathfinding.capabilityReasons["managed-lock"];
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

    await wrapper.setProps({
      result: { ...result, isFractionOutputEnabled: true, canInteract: false, temporaryDisabledReason: reason },
    });
    expect(toggle.attributes("aria-checked")).toBe("true");
    expect(toggle.attributes()).toHaveProperty("disabled");
    expect(toggle.attributes("title")).toBe(`${reason}\n${graphwarKillerLocale.ui.result.fractionOutputTitle}`);
    expect(wrapper.find("#graphwar-killer-fraction-output-reason").exists()).toBe(false);
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

  it("keeps the Agent fire reason inside the button field without occupying the countdown column", () => {
    const result = {
      ...createResultModel(),
      agentFireReason: graphwarKillerLocale.ui.pathfinding.capabilityReasons["agent-url-invalid"],
      agentFireState: "blocked" as const,
    };
    const wrapper = mount(MainPanel, {
      props: { agentTurnCountdown: createTurnCountdown(), locale: graphwarKillerLocale, result },
    });
    const actions = wrapper.get(".graphwar-killer__result-actions");
    const command = actions.get(".graphwar-killer__agent-fire-command");
    const fireField = command.get(".graphwar-killer__agent-fire-field");

    expect(command.element.children[0]).toBe(command.get(".graphwar-killer__agent-turn-countdown").element);
    expect(command.element.children[1]).toBe(fireField.element);
    expect(fireField.element.children[0]).toBe(fireField.get(".graphwar-killer__agent-fire-button").element);
    expect(fireField.element.children[1]).toBe(fireField.get(".graphwar-killer-control-reason").element);
    expect(command.element.nextElementSibling).toBe(actions.get(".graphwar-killer__primary-button").element);
    expect(actions.get(".graphwar-killer__primary-button").element.parentElement).toBe(actions.element);
    expect(actions.get(".graphwar-killer__icon-button").element.parentElement).toBe(actions.element);
  });

  it("moves temporary Agent, pathfinding, and managed locks into the affected control titles", () => {
    const managedReason = graphwarKillerLocale.ui.pathfinding.capabilityReasons["managed-lock"];
    const pathfindingReason = graphwarKillerLocale.ui.pathfinding.capabilityReasons["pathfinding-busy"];
    const wrapper = mount(MainPanel, {
      props: {
        locale: graphwarKillerLocale,
        result: {
          ...createResultModel(),
          copyDisabledReason: pathfindingReason,
          canCopyFormula: false,
          canInteract: false,
          temporaryDisabledReason: managedReason,
        },
      },
    });

    const fireButton = wrapper.get(".graphwar-killer__agent-fire-button");
    expect(fireButton.attributes("aria-describedby")).toBeUndefined();
    expect(fireButton.attributes("title")).toBe(`${managedReason}\n${graphwarKillerLocale.ui.result.fireTitle}`);
    expect(wrapper.find("#graphwar-killer-agent-fire-reason").exists()).toBe(false);

    expect(wrapper.get(".graphwar-killer__primary-button").attributes("title")).toBe(
      `${pathfindingReason}\n${graphwarKillerLocale.ui.result.copyTitle}`,
    );
    expect(wrapper.get(".graphwar-killer__icon-button").attributes("title")).toBe(
      `${managedReason}\n${graphwarKillerLocale.ui.result.clearSimulatorTitle}`,
    );
    expect(wrapper.text()).not.toContain(managedReason);
    expect(wrapper.text()).not.toContain(pathfindingReason);
  });

  it("keeps the isolated turn countdown immediately left of the Agent fire button", async () => {
    const agentTurnCountdown = createTurnCountdown();
    const componentInstances: { countdown?: unknown; mainPanel?: unknown } = {};
    let countdownUpdateCount = 0;
    let mainPanelUpdateCount = 0;
    const wrapper = mount(MainPanel, {
      global: {
        mixins: [
          {
            updated(this: ComponentPublicInstance) {
              if (this.$ === componentInstances.countdown) {
                countdownUpdateCount += 1;
              } else if (this.$ === componentInstances.mainPanel) {
                mainPanelUpdateCount += 1;
              }
            },
          },
        ],
      },
      props: {
        agentTurnCountdown,
        locale: graphwarKillerLocale,
        result: createResultModel(),
      },
    });
    componentInstances.countdown = wrapper.getComponent(AgentTurnCountdown).vm.$;
    componentInstances.mainPanel = wrapper.vm.$;
    await wrapper.setProps({ result: { ...createResultModel(), simulatorFormulaText: "known root update" } });
    expect(mainPanelUpdateCount).toBeGreaterThan(0);
    expect(countdownUpdateCount).toBe(0);
    mainPanelUpdateCount = 0;
    const command = wrapper.get(".graphwar-killer__agent-fire-command");
    const fireField = command.get(".graphwar-killer__agent-fire-field");

    expect(command.element.children[0]).toBe(command.get(".graphwar-killer__agent-turn-countdown").element);
    expect(command.element.children[1]).toBe(fireField.element);
    expect(fireField.element.children[0]).toBe(command.get(".graphwar-killer__agent-fire-button").element);

    agentTurnCountdown.remainingMilliseconds.value = 57_900;
    await nextTick();
    expect(command.get(".graphwar-killer__agent-turn-countdown").text()).toBe("剩余 57.9 秒");
    expect(countdownUpdateCount).toBe(1);
    expect(mainPanelUpdateCount).toBe(0);

    agentTurnCountdown.remainingMilliseconds.value = 0;
    await nextTick();
    const countdown = command.get(".graphwar-killer__agent-turn-countdown");
    expect(countdown.text()).toBe("剩余 0.000 秒");
    expect(countdown.classes()).toContain("graphwar-killer__agent-turn-countdown--expired");
    expect(countdownUpdateCount).toBe(2);
    expect(mainPanelUpdateCount).toBe(0);
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

  it("keeps incumbent preview coordinates readonly without disabling unrelated controls", () => {
    const wrapper = mount(MainPanel, {
      props: {
        locale: graphwarKillerLocale,
        result: {
          ...createResultModel(),
          canEditPointCoordinates: false,
          pointRows: [
            {
              index: 0,
              label: "己方",
              x: { ariaLabel: "己方 x", text: "1", title: "x" },
              y: { ariaLabel: "己方 y", text: "2", title: "y" },
            },
          ],
        },
      },
    });

    expect(wrapper.get(".graphwar-killer__point-coordinate-input").attributes()).toHaveProperty("readonly");
    expect(wrapper.get(".graphwar-killer__primary-button").attributes()).not.toHaveProperty("disabled");
  });
});

/** 创建结果面板测试共享的完整最小模型。 */
function createResultModel() {
  return {
    agentFireButtonText: graphwarKillerLocale.ui.result.fire,
    agentFireReason: graphwarKillerLocale.ui.pathfinding.capabilityReasons["managed-lock"],
    agentFireState: "busy",
    isAgentFireVisible: true,
    calculationMessage: "",
    isCalculationMessageVisible: false,
    canClearSimulatorInputs: true,
    canCopyFormula: true,
    canEditPointCoordinates: true,
    copyButtonText: "复制函数",
    equationPrefix: "y=",
    isFractionOutputEnabled: false,
    canInteract: true,
    pointRows: [],
    secondOrderAngleHint: undefined,
    isSimulatorLaunchAngleInputVisible: false,
    simulatorFormulaText: "",
    simulatorLaunchAngleText: "",
    solverExpression: "x",
    isSolverResultVisible: true,
    trajectoryWarning: "",
    workflowMode: "simulator",
  } as const;
}

/** 创建只供结果面板布局测试读取的稳定倒计时状态。 */
function createTurnCountdown() {
  const remainingMilliseconds = ref<number | undefined>(58_000);
  return {
    isZeroVisible: computed(() => remainingMilliseconds.value === 0),
    remainingMilliseconds,
  };
}
