// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import { graphwarKillerLocale } from "../../locale";
import MainPanel from "./MainPanel.vue";

describe("Detection MainPanel", () => {
  it("keeps the source switch in the heading and groups screenshot actions into two rows", async () => {
    const managedReason = graphwarKillerLocale.ui.pathfinding.capabilityReasons["managed-lock"];
    const agentBusyReason = graphwarKillerLocale.ui.pathfinding.capabilityReasons["agent-read-busy"];
    const panel = {
      canInteract: true,
      agent: {
        isAutoExportOnClearFailureEnabled: false,
        baseUrlText: "http://127.0.0.1:17900",
        isDebugFileActionsVisible: false,
        isEnabled: false,
        isExportInProgress: false,
        exportState: "normal" as const,
        isInProgress: false,
        readState: "normal" as const,
        tokenText: "",
      },
      isAutoDetectionEnabled: true,
      canDetectBounds: true,
      canDetectObjects: true,
      debugTimingRows: [],
      isDebugTimingVisible: false,
      detectObjectsTitle: graphwarKillerLocale.ui.detection.detectObjectsTitle,
      headerStatus: { kind: "error" as const, message: "读取状态失败：游戏尚未开始" },
      isScreenshotActionsVisible: true,
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

    await wrapper.setProps({ panel: { ...panel, canInteract: false, temporaryDisabledReason: managedReason } });
    const lockedScreenshotRows = wrapper.findAll(".graphwar-killer__source-action-row");
    const captureButton = lockedScreenshotRows[0].get<HTMLButtonElement>("button");
    expect(captureButton.attributes("disabled")).toBeDefined();
    expect(captureButton.attributes("title")).toBe(
      `${managedReason}\n${graphwarKillerLocale.ui.screenshot.captureTitle}`,
    );
    expect(lockedScreenshotRows[0].get<HTMLInputElement>('input[type="file"]').attributes("disabled")).toBeDefined();
    expect(lockedScreenshotRows[0].get(".graphwar-killer__upload").attributes("title")).toBe(
      `${managedReason}\n${graphwarKillerLocale.ui.screenshot.uploadTitle}`,
    );
    for (const button of lockedScreenshotRows[1].findAll<HTMLButtonElement>("button")) {
      expect(button.attributes("disabled")).toBeDefined();
      expect(button.attributes("title")?.startsWith(`${managedReason}\n`)).toBe(true);
    }
    const sourceToggle = wrapper.get("#graphwar-killer-agent-usage");
    const autoDetectionToggle = wrapper.get("#graphwar-killer-auto-detection");
    expect(sourceToggle.attributes("title")).toBe(
      `${managedReason}\n${graphwarKillerLocale.ui.detection.agent.toggleTitle}`,
    );
    expect(autoDetectionToggle.attributes("title")).toBe(
      `${managedReason}\n${graphwarKillerLocale.ui.detection.autoDetectionTitle}`,
    );
    expect(wrapper.text()).not.toContain(managedReason);

    await wrapper.setProps({
      panel: {
        ...panel,
        agent: {
          ...panel.agent,
          isDebugFileActionsVisible: true,
          isEnabled: true,
          exportState: "busy" as const,
          exportReason: agentBusyReason,
          readReason: agentBusyReason,
          readState: "busy" as const,
        },
        isScreenshotActionsVisible: false,
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
    const blockedExportButton = agentRows[0].get<HTMLButtonElement>(".graphwar-killer__agent-export-button");
    expect(blockedExportButton.attributes("disabled")).toBeDefined();
    expect(blockedExportButton.attributes("title")).toBe(
      `${agentBusyReason}\n${graphwarKillerLocale.ui.detection.agent.exportSceneTitle}`,
    );
    await blockedExportButton.trigger("click");
    expect(wrapper.emitted("exportAgentScene")).toBeUndefined();
    const blockedAutoExportSwitch = wrapper.get<HTMLButtonElement>("#graphwar-killer-export-on-clear-failure");
    expect(blockedAutoExportSwitch.attributes("aria-checked")).toBe("false");
    expect(blockedAutoExportSwitch.attributes("disabled")).toBeDefined();
    expect(blockedAutoExportSwitch.attributes("title")).toBe(
      `${agentBusyReason}\n${graphwarKillerLocale.ui.detection.agent.exportOnClearFailureTitle}`,
    );
    expect(wrapper.find("#graphwar-killer-export-on-clear-failure-reason").exists()).toBe(false);
    const blockedReadButton = wrapper.get<HTMLButtonElement>(".graphwar-killer__agent-read-button");
    expect(blockedReadButton.attributes("aria-describedby")).toBeUndefined();
    expect(blockedReadButton.attributes("title")).toBe(
      `${agentBusyReason}\n${graphwarKillerLocale.ui.detection.agent.readTitle}`,
    );
    expect(wrapper.find("#graphwar-killer-agent-read-reason").exists()).toBe(false);
    for (const fileButton of agentRows[0].findAll(".graphwar-killer__file-button")) {
      expect(fileButton.attributes("title")?.startsWith(`${agentBusyReason}\n`)).toBe(true);
    }
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
        agent: { ...panel.agent, isDebugFileActionsVisible: true, isEnabled: true, readState: "normal" as const },
        isScreenshotActionsVisible: false,
      },
    });
    const readyExportButton = wrapper.get<HTMLButtonElement>(".graphwar-killer__agent-export-button");
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
          isDebugFileActionsVisible: true,
          isEnabled: true,
          isExportInProgress: true,
          exportState: "busy" as const,
          exportReason: agentBusyReason,
          readReason: agentBusyReason,
          readState: "busy" as const,
        },
      },
    });
    const exportingRow = wrapper.get(".graphwar-killer__agent-read-field");
    const exportingButton = exportingRow.get<HTMLButtonElement>(".graphwar-killer__agent-export-button");
    expect(exportingButton.text()).toBe(graphwarKillerLocale.ui.detection.agent.exportingScene);
    expect(exportingButton.attributes("disabled")).toBeDefined();
    expect(
      exportingRow.get<HTMLButtonElement>("#graphwar-killer-export-on-clear-failure").attributes("disabled"),
    ).toBeDefined();
    for (const input of exportingRow.findAll<HTMLInputElement>('input[type="file"]')) {
      expect(input.attributes("disabled")).toBeDefined();
    }
    expect(wrapper.find(".graphwar-killer-control-reason__icon").exists()).toBe(false);
    const readAgentButton = wrapper.get<HTMLButtonElement>(".graphwar-killer__agent-read-button");
    expect(readAgentButton.attributes("disabled")).toBeDefined();
    expect(readAgentButton.attributes("aria-describedby")).toBeUndefined();
    const agentSettings = wrapper.get(".graphwar-killer__agent-usage");
    expect(agentSettings.find("a").exists()).toBe(false);
    expect(agentSettings.element.nextElementSibling).toBe(wrapper.get(".graphwar-killer__agent-usage-hint").element);

    await wrapper.setProps({
      panel: {
        ...panel,
        agent: {
          ...panel.agent,
          isDebugFileActionsVisible: true,
          isEnabled: true,
          exportState: "normal" as const,
          readReason: managedReason,
          readState: "busy" as const,
        },
        canInteract: false,
        isScreenshotActionsVisible: false,
        temporaryDisabledReason: managedReason,
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
    expect(agentToggle.attributes("title")).toBe(
      `${managedReason}\n${graphwarKillerLocale.ui.detection.agent.toggleTitle}`,
    );
    expect(managedAgentRow.get(".graphwar-killer__agent-read-button").attributes("title")).toBe(
      `${managedReason}\n${graphwarKillerLocale.ui.detection.agent.readTitle}`,
    );
    for (const fileButton of managedAgentRow.findAll(".graphwar-killer__file-button")) {
      expect(fileButton.attributes("title")?.startsWith(`${managedReason}\n`)).toBe(true);
    }
    const managedExportButton = managedAgentRow.get<HTMLButtonElement>(".graphwar-killer__agent-export-button");
    expect(managedExportButton.attributes("disabled")).toBeUndefined();
    await managedExportButton.trigger("click");
    expect(wrapper.emitted("exportAgentScene")).toHaveLength(2);
    const managedAutoExportSwitch = managedAgentRow.get<HTMLButtonElement>("#graphwar-killer-export-on-clear-failure");
    expect(managedAutoExportSwitch.attributes("disabled")).toBeUndefined();
    await managedAutoExportSwitch.trigger("click");
    expect(wrapper.emitted("toggleExportOnClearFailure")).toHaveLength(2);
  });
});
