// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import { graphwarKillerLocale } from "../../locale";
import MainPanel from "./MainPanel.vue";

describe("Pathfinding MainPanel", () => {
  it("places Path Planning before One-Click Clear and preserves its toggle event", async () => {
    const panel = {
      debugTimingRows: [],
      isDebugTimingVisible: false,
      deleteOptimization: { isEnabled: false, state: "normal" as const },
      friendlyFire: { isEnabled: false, state: "normal" as const },
      headerStatus: { kind: "info" as const, message: "", title: "" },
      managedFriendlyFireWarning: "",
      managedMode: { isEnabled: false, state: "normal" as const, title: "" },
      oneClickClear: {
        reason: graphwarKillerLocale.ui.pathfinding.capabilityReasons["path-start-required"],
        state: "blocked" as const,
        title: graphwarKillerLocale.ui.pathfinding.oneClickClearTitle,
      },
      pathPlanning: { isEnabled: false, state: "normal" as const },
      routeMode: "visibility-graph" as const,
      searchAnimation: { isEnabled: false, state: "normal" as const },
      isUsingStepGlitchRouting: false,
    };
    const wrapper = mount(MainPanel, { props: { locale: graphwarKillerLocale, panel } });
    const taskControls = wrapper.get(".graphwar-killer__task-controls");

    expect(taskControls.classes()).toContain("graphwar-killer-command-row");
    expect(taskControls.element.children[0]?.querySelector("#graphwar-killer-path-planning")).not.toBeNull();
    expect(taskControls.element.children[1]).toBe(taskControls.get(".graphwar-killer-command-field").element);
    expect(taskControls.element.children[2]?.querySelector("#graphwar-killer-managed-mode")).not.toBeNull();

    await taskControls.get("#graphwar-killer-path-planning").trigger("click");

    expect(wrapper.emitted("togglePathPlanning")).toHaveLength(1);

    const reason = graphwarKillerLocale.ui.pathfinding.capabilityReasons["managed-lock"];
    await wrapper.setProps({
      panel: { ...panel, pathPlanning: { isEnabled: false, reason, state: "blocked" as const } },
    });

    const pathPlanning = wrapper.get("#graphwar-killer-path-planning");
    expect(pathPlanning.attributes("disabled")).toBeDefined();
    expect(pathPlanning.attributes("aria-describedby")).toBe("graphwar-killer-path-planning-reason");
    expect(wrapper.get("#graphwar-killer-path-planning-reason").text()).toContain(reason);
  });
});
