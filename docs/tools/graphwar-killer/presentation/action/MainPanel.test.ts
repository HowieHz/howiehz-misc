// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import { graphwarKillerLocale } from "../../locale";
import MainPanel from "./MainPanel.vue";

const panel = {
  activeToolHint: { kind: "info" as const, message: "" },
  collisionCheck: { isEnabled: false, state: "normal" as const },
  canInteract: true,
  isLiveClickPreviewEnabled: false,
  isMagnifierEnabled: false,
  magnifierZoom: {
    inputMaximum: 100,
    minimum: 1,
    rangeStyle: {},
    sliderMaximum: 5,
    sliderValue: 2,
    text: "2",
  },
  isObstacleBrushAvailable: true,
  isObstacleBrushControlsVisible: false,
  obstacleBrushDiameter: {
    inputMaximum: 1000,
    minimum: 1,
    rangeStyle: {},
    sliderMaximum: 200,
    sliderValue: 20,
    text: "20",
  },
  isObstacleBrushEraseEnabled: false,
  hasObstacleEdits: false,
  snapSoldiers: { isEnabled: false, state: "normal" as const },
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

  it("adds the managed lock to every temporarily disabled edit button and switch", async () => {
    const reason = graphwarKillerLocale.ui.pathfinding.capabilityReasons["managed-lock"];
    const wrapper = mount(MainPanel, {
      props: {
        locale: graphwarKillerLocale,
        panel: {
          ...panel,
          canInteract: false,
          collisionCheck: { isEnabled: false, reason, state: "busy" as const },
          snapSoldiers: { isEnabled: false, reason, state: "busy" as const },
          temporaryDisabledReason: reason,
        },
      },
    });

    for (const button of wrapper.findAll<HTMLButtonElement>(
      ".graphwar-killer__tool-toggle button, .graphwar-killer__path-actions button:disabled",
    )) {
      expect(button.attributes("title")?.startsWith(`${reason}\n`)).toBe(true);
    }
    for (const id of ["graphwar-killer-snap-soldiers", "graphwar-killer-collision-check"]) {
      const control = wrapper.get(`#${id}`);
      expect(control.attributes("title")?.startsWith(`${reason}\n`)).toBe(true);
      expect(wrapper.find(`#${id}-reason`).exists()).toBe(false);
    }
    expect(wrapper.get("#graphwar-killer-live-click-preview").attributes("disabled")).toBeUndefined();

    await wrapper.setProps({
      panel: {
        ...panel,
        canInteract: false,
        hasObstacleEdits: true,
        isObstacleBrushControlsVisible: true,
        temporaryDisabledReason: reason,
        toolMode: "obstacle" as const,
      },
    });
    for (const button of wrapper.findAll<HTMLButtonElement>(".graphwar-killer__obstacle-brush-actions button")) {
      expect(button.attributes("disabled")).toBeDefined();
      expect(button.attributes("title")?.startsWith(`${reason}\n`)).toBe(true);
    }
  });
});
