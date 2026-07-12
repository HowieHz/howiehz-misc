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
        obstacleExpansionMode: "detection",
        obstacleSimulationToleranceText: "1",
        oneClickClearDeleteCheckRadiusMinimumPlanePixels: 0,
        oneClickClearDeleteCheckRadiusText: "3.5",
        oneClickClearDeleteCheckRadiusVisible: false,
        routePlanningToleranceText: "1",
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
    };
    const wrapper = mount(AdvancedPanel, { props: { locale: graphwarKillerLocale, panel } });

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
  });
});
