// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import { graphwarKillerLocale } from "../../locale";
import MainPanel from "./MainPanel.vue";

const panel = {
  activeToolHint: { kind: "info" as const, message: "" },
  collisionCheck: { enabled: false, state: "normal" as const },
  interactionDisabled: false,
  liveClickPreviewEnabled: false,
  magnifierEnabled: false,
  magnifierZoom: {
    inputMaximum: 100,
    minimum: 1,
    rangeStyle: {},
    sliderMaximum: 5,
    sliderValue: 2,
    text: "2",
  },
  obstacleBrushAvailable: true,
  obstacleBrushControlsVisible: false,
  obstacleBrushDiameter: {
    inputMaximum: 1000,
    minimum: 1,
    rangeStyle: {},
    sliderMaximum: 200,
    sliderValue: 20,
    text: "20",
  },
  obstacleBrushEraseEnabled: false,
  obstacleEditsDirty: false,
  snapSoldiers: { enabled: false, state: "normal" as const },
  toolMode: "path" as const,
};

describe("Action MainPanel", () => {
  it("groups path-only switches after edit commands and hides them with path actions", async () => {
    const wrapper = mount(MainPanel, { props: { locale: graphwarKillerLocale, panel } });
    const pathActions = wrapper.get(".graphwar-killer__path-actions");

    expect(pathActions.findAll("button").map((button) => button.attributes("aria-label") ?? button.text())).toEqual([
      graphwarKillerLocale.ui.actions.clearPath,
      graphwarKillerLocale.ui.actions.undoPoint,
      graphwarKillerLocale.ui.actions.snapSoldiers,
      graphwarKillerLocale.ui.actions.collisionCheck,
      graphwarKillerLocale.ui.actions.liveClickPreview,
    ]);
    expect(wrapper.find("#graphwar-killer-path-planning").exists()).toBe(false);

    await wrapper.setProps({ panel: { ...panel, toolMode: "bounds" } });

    expect(wrapper.find(".graphwar-killer__path-actions").exists()).toBe(false);
    expect(wrapper.find("#graphwar-killer-snap-soldiers").exists()).toBe(false);
    expect(wrapper.find("#graphwar-killer-collision-check").exists()).toBe(false);
    expect(wrapper.find("#graphwar-killer-live-click-preview").exists()).toBe(false);
  });
});
