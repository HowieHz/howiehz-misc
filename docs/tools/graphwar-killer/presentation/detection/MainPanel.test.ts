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
        autoExportOnClearFailureEnabled: false,
        baseUrlText: "http://127.0.0.1:17900",
        debugFileActionsVisible: false,
        enabled: false,
        exportInProgress: false,
        exportState: "normal" as const,
        inProgress: false,
        readState: "normal" as const,
        tokenText: "",
      },
      autoDetectionEnabled: true,
      canDetectBounds: true,
      canDetectObjects: true,
      debugTimingRows: [],
      debugTimingVisible: false,
      detectObjectsTitle: graphwarKillerLocale.ui.detection.detectObjectsTitle,
      headerStatus: { kind: "error" as const, message: "读取状态失败：游戏尚未开始" },
      screenshotActionsVisible: true,
      statusWarning: { message: "", title: "" },
    };
    const wrapper = mount(MainPanel, { props: { locale: graphwarKillerLocale, panel } });

    expect(wrapper.classes()).toContain("graphwar-killer-control-surface");
    const labelRow = wrapper.get(".graphwar-killer__label-row");
    const leading = labelRow.get(".graphwar-killer__label-leading");
    expect(leading.element.children[0].id).toBe("graphwar-killer-detection-title");
    expect(leading.element.children[1].querySelector("#graphwar-killer-agent-usage")?.getAttribute("role")).toBe(
      "switch",
    );
    expect(labelRow.element.children[1]).toBe(wrapper.get(".graphwar-killer__label-feedback").element);
    const screenshotRows = wrapper.findAll(".graphwar-killer__source-action-row");
    expect(screenshotRows).toHaveLength(2);
    expect(screenshotRows[0].text()).toContain(graphwarKillerLocale.ui.screenshot.capture);
    expect(screenshotRows[0].text()).toContain(graphwarKillerLocale.ui.screenshot.upload);
    expect(screenshotRows[0].get(".graphwar-killer__upload span").classes()).toContain(
      "graphwar-killer-control-button",
    );
    expect(screenshotRows[0].text()).not.toContain(graphwarKillerLocale.ui.detection.detectBounds);
    expect(screenshotRows[1].text()).toContain(graphwarKillerLocale.ui.detection.detectBounds);
    expect(screenshotRows[1].text()).toContain(graphwarKillerLocale.ui.detection.detectObjects);
    expect(screenshotRows[1].text()).toContain(graphwarKillerLocale.ui.detection.autoDetection);

    await wrapper.setProps({ panel: { ...panel, interactionDisabled: true } });
    const lockedScreenshotRows = wrapper.findAll(".graphwar-killer__source-action-row");
    expect(lockedScreenshotRows[0].get<HTMLButtonElement>("button").attributes("disabled")).toBeDefined();
    expect(lockedScreenshotRows[0].get<HTMLInputElement>('input[type="file"]').attributes("disabled")).toBeDefined();
    for (const button of lockedScreenshotRows[1].findAll<HTMLButtonElement>("button")) {
      expect(button.attributes("disabled")).toBeDefined();
    }

    await wrapper.setProps({
      panel: {
        ...panel,
        agent: {
          ...panel.agent,
          debugFileActionsVisible: true,
          enabled: true,
          exportState: "busy" as const,
          readReason: graphwarKillerLocale.ui.pathfinding.capabilityReasons["agent-read-busy"],
          readState: "busy" as const,
        },
        screenshotActionsVisible: false,
      },
    });

    const agentRows = wrapper.findAll(".graphwar-killer__source-action-row");
    expect(agentRows).toHaveLength(1);
    expect(agentRows[0].text()).toContain(graphwarKillerLocale.ui.detection.agent.read);
    const agentButtons = agentRows[0].findAll("button, .graphwar-killer-control-button");
    expect(agentButtons.map((button) => button.text())).toEqual([
      graphwarKillerLocale.ui.detection.agent.read,
      graphwarKillerLocale.ui.detection.agent.readStateFile,
      graphwarKillerLocale.ui.detection.agent.readObstacleFile,
      graphwarKillerLocale.ui.detection.agent.exportScene,
      graphwarKillerLocale.ui.detection.agent.exportOnClearFailure,
    ]);
    const debugFileInputs = agentRows[0].findAll<HTMLInputElement>('.graphwar-killer__file-button input[type="file"]');
    expect(debugFileInputs).toHaveLength(2);
    await debugFileInputs[0]?.trigger("change");
    await debugFileInputs[1]?.trigger("change");
    expect(wrapper.emitted("readAgentStateFile")).toHaveLength(1);
    expect(wrapper.emitted("readAgentObstacleFile")).toHaveLength(1);
    const blockedExportButton = agentRows[0].get<HTMLButtonElement>(
      `button[title="${graphwarKillerLocale.ui.detection.agent.exportSceneTitle}"]`,
    );
    expect(blockedExportButton.attributes("disabled")).toBeDefined();
    await blockedExportButton.trigger("click");
    expect(wrapper.emitted("exportAgentScene")).toBeUndefined();
    const blockedAutoExportSwitch = wrapper.get<HTMLButtonElement>("#graphwar-killer-export-on-clear-failure");
    expect(blockedAutoExportSwitch.attributes("aria-checked")).toBe("false");
    expect(blockedAutoExportSwitch.attributes("disabled")).toBeDefined();
    expect(blockedAutoExportSwitch.attributes("title")).toBe(
      graphwarKillerLocale.ui.detection.agent.exportOnClearFailureTitle,
    );
    await blockedAutoExportSwitch.trigger("click");
    expect(wrapper.emitted("toggleExportOnClearFailure")).toBeUndefined();
    const tokenInput = wrapper.get<HTMLInputElement>('input[type="password"]');
    expect(tokenInput.attributes("autocomplete")).toBe("off");
    expect(tokenInput.attributes("maxlength")).toBe("4096");
    await tokenInput.setValue("session-token");
    expect(wrapper.emitted("updateAgentToken")?.at(-1)).toEqual(["session-token"]);

    await wrapper.setProps({
      panel: {
        ...panel,
        agent: { ...panel.agent, debugFileActionsVisible: true, enabled: true, readState: "normal" as const },
        screenshotActionsVisible: false,
      },
    });
    const readyExportButton = wrapper.get<HTMLButtonElement>(
      `button[title="${graphwarKillerLocale.ui.detection.agent.exportSceneTitle}"]`,
    );
    expect(readyExportButton.attributes("disabled")).toBeUndefined();
    await readyExportButton.trigger("click");
    expect(wrapper.emitted("exportAgentScene")).toHaveLength(1);
    const readyAutoExportSwitch = wrapper.get<HTMLButtonElement>("#graphwar-killer-export-on-clear-failure");
    expect(readyAutoExportSwitch.attributes("disabled")).toBeUndefined();
    await readyAutoExportSwitch.trigger("click");
    expect(wrapper.emitted("toggleExportOnClearFailure")).toHaveLength(1);

    await wrapper.setProps({
      panel: {
        ...panel,
        agent: {
          ...panel.agent,
          debugFileActionsVisible: true,
          enabled: true,
          exportInProgress: true,
          exportState: "busy" as const,
          readReason: graphwarKillerLocale.ui.pathfinding.capabilityReasons["agent-read-busy"],
          readState: "busy" as const,
        },
      },
    });
    const exportingRow = wrapper.get(".graphwar-killer__agent-read-field");
    const exportingButton = exportingRow.get<HTMLButtonElement>(
      `button[title="${graphwarKillerLocale.ui.detection.agent.exportSceneTitle}"]`,
    );
    expect(exportingButton.text()).toBe(graphwarKillerLocale.ui.detection.agent.exportingScene);
    expect(exportingButton.attributes("disabled")).toBeDefined();
    expect(
      exportingRow.get<HTMLButtonElement>("#graphwar-killer-export-on-clear-failure").attributes("disabled"),
    ).toBeDefined();
    for (const input of exportingRow.findAll<HTMLInputElement>('input[type="file"]')) {
      expect(input.attributes("disabled")).toBeDefined();
    }
    expect(wrapper.get(".graphwar-killer-control-reason__icon").attributes("aria-hidden")).toBe("true");
    const readAgentButton = wrapper.get<HTMLButtonElement>(".graphwar-killer__agent-read-field button");
    expect(readAgentButton.attributes("disabled")).toBeDefined();
    expect(readAgentButton.attributes("aria-describedby")).toBe("graphwar-killer-agent-read-reason");
    const agentSettings = wrapper.get(".graphwar-killer__agent-usage");
    expect(agentSettings.find("a").exists()).toBe(false);
    expect(agentSettings.element.nextElementSibling).toBe(wrapper.get(".graphwar-killer__agent-usage-hint").element);

    await wrapper.setProps({
      panel: {
        ...panel,
        agent: {
          ...panel.agent,
          debugFileActionsVisible: true,
          enabled: true,
          exportState: "normal" as const,
          readState: "busy" as const,
        },
        interactionDisabled: true,
        screenshotActionsVisible: false,
      },
    });
    const agentToggle = wrapper.get<HTMLButtonElement>("#graphwar-killer-agent-usage");
    expect(agentToggle.attributes("disabled")).toBeDefined();
    expect(wrapper.get<HTMLInputElement>('input[type="password"]').attributes("disabled")).toBeDefined();
    await agentToggle.trigger("click");
    expect(wrapper.emitted("toggleAgentUsage")).toBeUndefined();
    const managedAgentRow = wrapper.get(".graphwar-killer__agent-read-field");
    expect(managedAgentRow.get<HTMLButtonElement>("button:first-of-type").attributes("disabled")).toBeDefined();
    for (const input of managedAgentRow.findAll<HTMLInputElement>('input[type="file"]')) {
      expect(input.attributes("disabled")).toBeDefined();
    }
    const managedExportButton = managedAgentRow.get<HTMLButtonElement>(
      `button[title="${graphwarKillerLocale.ui.detection.agent.exportSceneTitle}"]`,
    );
    expect(managedExportButton.attributes("disabled")).toBeUndefined();
    await managedExportButton.trigger("click");
    expect(wrapper.emitted("exportAgentScene")).toHaveLength(2);
    const managedAutoExportSwitch = managedAgentRow.get<HTMLButtonElement>("#graphwar-killer-export-on-clear-failure");
    expect(managedAutoExportSwitch.attributes("disabled")).toBeUndefined();
    await managedAutoExportSwitch.trigger("click");
    expect(wrapper.emitted("toggleExportOnClearFailure")).toHaveLength(2);
  });
});
