// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import { graphwarKillerLocale } from "../../locale";
import MainPanel from "./MainPanel.vue";

describe("Detection MainPanel", () => {
  it("keeps the source switch in the heading and groups screenshot actions into two rows", async () => {
    const panel = {
      interactionDisabled: false,
      agent: {
        baseUrlText: "http://127.0.0.1:17900",
        enabled: false,
        inProgress: false,
        readState: "normal" as const,
      },
      autoDetectionEnabled: true,
      canDetectBounds: true,
      canDetectObjects: true,
      debugTimingRows: [],
      debugTimingVisible: false,
      detectObjectsTitle: graphwarKillerLocale.ui.detection.detectObjectsTitle,
      headerStatus: { kind: "info" as const, message: "" },
      screenshotActionsVisible: true,
      statusWarning: { message: "", title: "" },
    };
    const wrapper = mount(MainPanel, { props: { locale: graphwarKillerLocale, panel } });

    expect(wrapper.find(".graphwar-killer__label-row #graphwar-killer-agent-usage").exists()).toBe(true);
    const screenshotRows = wrapper.findAll(".graphwar-killer__source-action-row");
    expect(screenshotRows).toHaveLength(2);
    expect(screenshotRows[0].text()).toContain(graphwarKillerLocale.ui.screenshot.capture);
    expect(screenshotRows[0].text()).toContain(graphwarKillerLocale.ui.screenshot.upload);
    expect(screenshotRows[0].text()).not.toContain(graphwarKillerLocale.ui.detection.detectBounds);
    expect(screenshotRows[1].text()).toContain(graphwarKillerLocale.ui.detection.detectBounds);
    expect(screenshotRows[1].text()).toContain(graphwarKillerLocale.ui.detection.detectObjects);
    expect(screenshotRows[1].text()).toContain(graphwarKillerLocale.ui.detection.autoDetection);

    await wrapper.setProps({
      panel: {
        ...panel,
        agent: { ...panel.agent, enabled: true },
        screenshotActionsVisible: false,
      },
    });

    const agentRows = wrapper.findAll(".graphwar-killer__source-action-row");
    expect(agentRows).toHaveLength(1);
    expect(agentRows[0].text()).toContain(graphwarKillerLocale.ui.detection.agent.read);

    await wrapper.setProps({
      panel: {
        ...panel,
        agent: { ...panel.agent, enabled: true },
        interactionDisabled: true,
        screenshotActionsVisible: false,
      },
    });
    const agentToggle = wrapper.get<HTMLInputElement>("#graphwar-killer-agent-usage");
    expect(agentToggle.attributes("disabled")).toBeDefined();
    await agentToggle.trigger("click");
    expect(wrapper.emitted("toggleAgentUsage")).toBeUndefined();
  });
});
