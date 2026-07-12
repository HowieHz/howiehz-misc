// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import { graphwarKillerLocale } from "../../locale";
import MainPanel from "./MainPanel.vue";

describe("Pathfinding MainPanel", () => {
  it("top-aligns managed mode when One-Click Clear shows a reason", () => {
    const panel = {
      debugTimingRows: [],
      debugTimingVisible: false,
      deleteOptimization: { enabled: false, state: "normal" as const },
      friendlyFire: { enabled: false, state: "normal" as const },
      headerStatus: { kind: "info" as const, message: "", title: "" },
      managedFriendlyFireWarning: "",
      managedMode: { enabled: false, state: "normal" as const, title: "" },
      oneClickClear: {
        reason: graphwarKillerLocale.ui.pathfinding.capabilityReasons["path-start-required"],
        state: "blocked" as const,
        title: graphwarKillerLocale.ui.pathfinding.oneClickClearTitle,
      },
      routeMode: "visibility-graph" as const,
      searchAnimation: { enabled: false, state: "normal" as const },
      usesStepGlitchRouting: false,
    };
    const wrapper = mount(MainPanel, { props: { locale: graphwarKillerLocale, panel } });
    const taskControls = wrapper.get(".graphwar-killer__task-controls");

    expect(taskControls.classes()).toContain("graphwar-killer-command-row");
    expect(taskControls.element.children[0]).toBe(taskControls.get(".graphwar-killer-command-field").element);
    expect(taskControls.element.children[1]).toBe(taskControls.get(".graphwar-killer-toggle-field").element);
  });
});
