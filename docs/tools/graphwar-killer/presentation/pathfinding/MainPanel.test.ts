// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import { graphwarKillerLocale } from "../../locale";
import MainPanel from "./MainPanel.vue";

describe("Pathfinding MainPanel", () => {
  it("places Path Planning before One-Click Clear and preserves its toggle event", async () => {
    const panel = {
      canExportDebugReport: false,
      debugDiagnosticRows: [],
      debugTimingRows: [],
      hasResultCacheOnlyReport: false,
      isDebugTimingVisible: false,
      deleteOptimization: { isEnabled: false, state: "normal" as const },
      friendlyFire: { isEnabled: false, state: "normal" as const },
      headerStatus: { kind: "info" as const, message: "", title: "" },
      managedFriendlyFireWarning: "",
      managedMode: {
        isEnabled: false,
        state: "normal" as const,
        title: graphwarKillerLocale.ui.pathfinding.managedModeTitle,
      },
      oneClickClear: {
        reason: graphwarKillerLocale.ui.pathfinding.capabilityReasons["path-start-required"],
        state: "blocked" as const,
        title: graphwarKillerLocale.ui.pathfinding.oneClickClearTitle,
      },
      pathPlanning: { isEnabled: false, state: "normal" as const },
      routeMode: "visibility-graph" as const,
      resultCache: { isEnabled: true, state: "normal" as const },
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

    const reason = graphwarKillerLocale.ui.pathfinding.capabilityReasons["pathfinding-busy"];
    await wrapper.setProps({
      panel: {
        ...panel,
        managedMode: { ...panel.managedMode, reason, state: "busy" as const },
        oneClickClear: { ...panel.oneClickClear, reason, state: "busy" as const },
        pathPlanning: { isEnabled: false, reason, state: "busy" as const },
      },
    });

    const pathPlanning = wrapper.get("#graphwar-killer-path-planning");
    expect(pathPlanning.attributes("disabled")).toBeDefined();
    expect(pathPlanning.attributes("aria-describedby")).toBeUndefined();
    expect(pathPlanning.attributes("title")).toBe(`${reason}\n${graphwarKillerLocale.ui.actions.pathPlanningTitle}`);
    expect(wrapper.find("#graphwar-killer-path-planning-reason").exists()).toBe(false);

    const oneClickClear = wrapper.get<HTMLButtonElement>(".graphwar-killer-command-field > button");
    expect(oneClickClear.attributes("aria-describedby")).toBeUndefined();
    expect(oneClickClear.attributes("title")).toBe(
      `${reason}\n${graphwarKillerLocale.ui.pathfinding.oneClickClearTitle}`,
    );
    expect(wrapper.find("#graphwar-killer-one-click-clear-reason").exists()).toBe(false);

    const managedMode = wrapper.get("#graphwar-killer-managed-mode");
    expect(managedMode.attributes("aria-describedby")).toBeUndefined();
    expect(managedMode.attributes("title")).toBe(`${reason}\n${panel.managedMode.title}`);

    await wrapper.setProps({
      panel: { ...panel, canExportDebugReport: true, isDebugTimingVisible: true },
    });
    const exportButton = wrapper
      .findAll("button")
      .find((button) => button.text() === graphwarKillerLocale.ui.pathfinding.exportDebugReport);
    expect(exportButton?.attributes("disabled")).toBeUndefined();
    await exportButton?.trigger("click");
    expect(wrapper.emitted("exportDebugReport")).toHaveLength(1);
    const optionControls = wrapper.findAll(".graphwar-killer__option-grid > *");
    expect(optionControls.at(-2)?.find("#graphwar-killer-search-animation").exists()).toBe(true);
    expect(optionControls.at(-1)?.find("#graphwar-killer-result-cache").exists()).toBe(true);
    await wrapper.get("#graphwar-killer-result-cache").trigger("click");
    expect(wrapper.emitted("toggleResultCache")).toHaveLength(1);
  });

  it("adds the managed lock to every temporarily disabled route setting", () => {
    const reason = graphwarKillerLocale.ui.pathfinding.capabilityReasons["managed-lock"];
    const panel = {
      canExportDebugReport: false,
      debugDiagnosticRows: [],
      debugTimingRows: [],
      hasResultCacheOnlyReport: false,
      isDebugTimingVisible: false,
      deleteOptimization: { isEnabled: false, reason, state: "busy" as const },
      friendlyFire: { isEnabled: false, reason, state: "busy" as const },
      headerStatus: { kind: "info" as const, message: "", title: "" },
      managedFriendlyFireWarning: "",
      managedMode: { isEnabled: true, state: "normal" as const, title: "Disable managed mode" },
      oneClickClear: { reason, state: "busy" as const, title: "One-Click Clear" },
      pathPlanning: { isEnabled: false, reason, state: "busy" as const },
      routeMode: "visibility-graph" as const,
      resultCache: { isEnabled: true, state: "normal" as const },
      searchAnimation: { isEnabled: false, state: "normal" as const },
      isUsingStepGlitchRouting: false,
    };
    const wrapper = mount(MainPanel, { props: { locale: graphwarKillerLocale, panel } });

    for (const routeButton of wrapper.findAll<HTMLButtonElement>(".graphwar-killer__route-toggle button")) {
      expect(routeButton.attributes("disabled")).toBeDefined();
      expect(routeButton.attributes("title")).toBe(
        `${reason}\n${graphwarKillerLocale.ui.pathfinding.routeAlgorithmTitle}`,
      );
    }
    for (const id of ["graphwar-killer-delete-optimization", "graphwar-killer-friendly-fire"]) {
      const control = wrapper.get(`#${id}`);
      expect(control.attributes("title")?.startsWith(`${reason}\n`)).toBe(true);
      expect(wrapper.find(`#${id}-reason`).exists()).toBe(false);
    }
  });
});
