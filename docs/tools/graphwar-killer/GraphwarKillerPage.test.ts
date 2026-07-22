// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

import {
  createGraphwarAgentClient,
  type GraphwarAgentAvailableState,
  type GraphwarAgentShotPlan,
} from "./controllers/agent/client";
import { createGraphwarManagedController, type GraphwarManagedController } from "./controllers/managed/controller";
import { createPixelPoint } from "./core/types";
import GraphwarKillerPage from "./GraphwarKillerPage.vue";
import { graphwarKillerLocale } from "./locale";

describe("Graphwar Killer page settings", () => {
  it("uses compact double text for tiny angle hints and keeps the expanded title", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const angleDegrees = 1.0976980032456007e-101;
    const expandedAngleText =
      "0.000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010976980032456007";
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: { commitIncumbentResult: (expression: string, launchAngleRadians: number) => void };
      }
    ).setupState;

    await wrapper.findAll(".graphwar-killer__equation-toggle button")[2].trigger("click");
    page.commitIncumbentResult("x", (angleDegrees * Math.PI) / 180);
    await nextTick();

    const hint = wrapper.get(".graphwar-killer__second-order-angle-hint");
    expect(hint.text()).toContain("1.0976980032456007e-101°");
    expect(hint.attributes("title")).toBe(graphwarKillerLocale.status.secondOrderAngleHint(expandedAngleText));
    wrapper.unmount();
  });

  it("shares the fraction-output preference across solver modes and hides it in Simulator", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: { commitIncumbentResult: (expression: string) => void };
      }
    ).setupState;
    const toggle = wrapper.get("#graphwar-killer-fraction-output");

    page.commitIncumbentResult("0.5*x");
    await nextTick();
    expect(wrapper.get(".graphwar-killer__formula").text()).toBe("0.5*x");
    expect(toggle.attributes("aria-checked")).toBe("false");
    await toggle.trigger("click");
    expect(toggle.attributes("aria-checked")).toBe("true");
    expect(wrapper.get(".graphwar-killer__formula").text()).toBe("1/2*x");

    await wrapper.findAll(".graphwar-killer__equation-toggle button")[1].trigger("click");
    expect(wrapper.get("#graphwar-killer-fraction-output").attributes("aria-checked")).toBe("true");

    await wrapper.findAll(".graphwar-killer__mode-toggle button")[1].trigger("click");
    expect(wrapper.find("#graphwar-killer-fraction-output").exists()).toBe(false);
    expect(wrapper.get<HTMLInputElement>(".graphwar-killer__formula-input").element.value).toBe("1/2*x");

    await wrapper.findAll(".graphwar-killer__mode-toggle button")[0].trigger("click");
    expect(wrapper.get("#graphwar-killer-fraction-output").attributes("aria-checked")).toBe("true");
    wrapper.unmount();
  });

  it("shows a partial-conversion warning only while the current fraction output needs it", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          commitIncumbentResult: (expression: string) => void;
        };
      }
    ).setupState;
    const smallestSubnormal = `0.${"0".repeat(323)}49406564584124654`;
    const toggle = wrapper.get("#graphwar-killer-fraction-output");

    page.commitIncumbentResult(`0.5+${smallestSubnormal}`);
    await nextTick();
    expect(wrapper.find("#graphwar-killer-fraction-output-reason").exists()).toBe(false);

    await toggle.trigger("click");
    expect(wrapper.get("#graphwar-killer-fraction-output-reason").text()).toBe(
      `! ${graphwarKillerLocale.ui.result.fractionConversionIncomplete}`,
    );
    expect(toggle.attributes("aria-describedby")).toBe("graphwar-killer-fraction-output-reason");

    page.commitIncumbentResult("0.5*x");
    await nextTick();
    expect(wrapper.find("#graphwar-killer-fraction-output-reason").exists()).toBe(false);

    page.commitIncumbentResult(smallestSubnormal);
    await nextTick();
    expect(wrapper.find("#graphwar-killer-fraction-output-reason").exists()).toBe(true);
    page.commitIncumbentResult("");
    await nextTick();
    expect(wrapper.find("#graphwar-killer-fraction-output-reason").exists()).toBe(false);

    wrapper.unmount();
  });

  it("copies and fires the click-time external formula despite a delayed Agent state read", async () => {
    let resolveStateResponse!: (response: Response) => void;
    const stateResponse = new Promise<Response>((resolve) => {
      resolveStateResponse = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      if (String(input).endsWith("/state")) {
        return stateResponse;
      }
      if (String(input).endsWith("/shots")) {
        return Promise.resolve(jsonResponse(createSubmittedCommand(init)));
      }
      return Promise.reject(new Error(`Unexpected Agent request: ${String(input)} ${String(init?.method)}`));
    });
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          commitIncumbentResult: (expression: string, launchAngleRadians?: number) => void;
          fractionOutputEnabled: boolean;
          graphwarAgentEnabled: boolean;
          graphwarAgentTokenText: string;
          solverEquationMode: "ddy" | "dy" | "y";
        };
      }
    ).setupState;

    page.graphwarAgentEnabled = true;
    page.graphwarAgentTokenText = "session-token";
    page.solverEquationMode = "ddy";
    page.commitIncumbentResult("88.008750871454684", 0.25);
    page.fractionOutputEnabled = true;
    await nextTick();
    const displayedFormula = wrapper.get(".graphwar-killer__formula").text();
    expect(displayedFormula).toBe("3096532637734579/35184372088832");

    await wrapper.get(".graphwar-killer__result-panel .graphwar-killer__primary-button").trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(displayedFormula);

    await wrapper.get(".graphwar-killer__agent-fire-button").trigger("click");
    page.commitIncumbentResult("0.25*x", 0.5);
    page.fractionOutputEnabled = false;
    page.solverEquationMode = "y";
    await nextTick();
    resolveStateResponse(jsonResponse(createAgentState("ddy")));
    await flushPromises();

    const shotCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/shots"));
    expect(shotCall).toBeDefined();
    expect(JSON.parse(String(shotCall?.[1]?.body))).toMatchObject({
      angleRadians: 0.25,
      function: displayedFormula,
    });
    expect(new Headers(shotCall?.[1]?.headers).get("Authorization")).toBe("Bearer session-token");

    wrapper.unmount();
    vi.unstubAllGlobals();
    if (clipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    } else {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it("submits normal and deadline managed shots from the incumbent instead of the displayed result", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          commitIncumbentResult: (expression: string) => void;
          createGraphwarManagedSceneKey: (
            state: GraphwarAgentAvailableState,
            shooter: {
              player: GraphwarAgentAvailableState["players"][number];
              soldier: GraphwarAgentAvailableState["players"][number]["soldiers"][number];
            },
          ) => string;
          createGraphwarManagedShotPlan: (state: GraphwarAgentAvailableState) => GraphwarAgentShotPlan | undefined;
          fractionOutputEnabled: boolean;
          graphwarManagedController: GraphwarManagedController | undefined;
          graphwarManagedIncumbent: { expression: string; launchAngleRadians?: number } | undefined;
          graphwarManagedSceneKey: string;
          submitGraphwarManagedShot: (state: GraphwarAgentAvailableState) => boolean;
        };
      }
    ).setupState;
    const normalState = createAgentState("y");
    const normalFetch = createManagedAgentFetch(normalState);
    const normalController = createGraphwarManagedController({
      client: createGraphwarAgentClient("http://127.0.0.1:17900", { fetch: normalFetch }),
    });

    page.commitIncumbentResult("0.5*x");
    page.fractionOutputEnabled = true;
    page.graphwarManagedIncumbent = { expression: "88.008750871454684" };
    page.graphwarManagedSceneKey = page.createGraphwarManagedSceneKey(normalState, {
      player: normalState.players[0],
      soldier: normalState.players[0].soldiers[0],
    });
    page.graphwarManagedController = normalController;
    normalController.start();
    await flushPromises();
    await nextTick();

    expect(wrapper.get(".graphwar-killer__formula").text()).toBe("1/2*x");
    const latestNormalState = normalController.getLatestState();
    if (!latestNormalState) {
      throw new Error("Expected the managed controller to retain its polled state");
    }
    expect(page.submitGraphwarManagedShot(latestNormalState)).toBe(true);
    await flushPromises();
    expect(
      JSON.parse(String(normalFetch.mock.calls.find(([input]) => String(input).endsWith("/shots"))?.[1]?.body)),
    ).toMatchObject({ function: "3096532637734579/35184372088832" });
    normalController.stop();

    const deadlineState = {
      ...createAgentState("y"),
      remainingTurnMs: 3000,
      turnToken: "00000000-0000-4000-8000-000000000012",
    };
    const deadlineFetch = createManagedAgentFetch(deadlineState);
    const deadlineController = createGraphwarManagedController({
      client: createGraphwarAgentClient("http://127.0.0.1:17900", { fetch: deadlineFetch }),
      hooks: { decideDeadlineShot: (state) => page.createGraphwarManagedShotPlan(state) },
    });
    page.graphwarManagedSceneKey = page.createGraphwarManagedSceneKey(deadlineState, {
      player: deadlineState.players[0],
      soldier: deadlineState.players[0].soldiers[0],
    });
    deadlineController.start();
    await flushPromises();
    expect(
      JSON.parse(String(deadlineFetch.mock.calls.find(([input]) => String(input).endsWith("/shots"))?.[1]?.body)),
    ).toMatchObject({ function: "3096532637734579/35184372088832" });
    deadlineController.stop();

    page.fractionOutputEnabled = false;
    expect(page.createGraphwarManagedShotPlan(deadlineState)?.function).toBe("88.008750871454684");

    wrapper.unmount();
  });

  it("uses full-precision launch-angle guidance without Agent or managed mode", () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: { secondOrderLaunchAngleMode: "display-rounded" | "full-precision" };
      }
    ).setupState;

    expect(page.secondOrderLaunchAngleMode).toBe("full-precision");
    wrapper.unmount();
  });

  it("keeps clear-failure auto-export off by default and available during managed mode", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          debugInfoEnabled: boolean;
          graphwarAgentAutoExportOnClearFailureEnabled: boolean;
          graphwarAgentEnabled: boolean;
          graphwarManagedModeEnabled: boolean;
        };
      }
    ).setupState;

    expect(page.graphwarAgentAutoExportOnClearFailureEnabled).toBe(false);
    expect(wrapper.find("#graphwar-killer-export-on-clear-failure").exists()).toBe(false);

    page.debugInfoEnabled = true;
    page.graphwarAgentEnabled = true;
    await nextTick();
    const autoExportSwitch = wrapper.get<HTMLButtonElement>("#graphwar-killer-export-on-clear-failure");
    expect(autoExportSwitch.attributes("aria-checked")).toBe("false");
    expect(autoExportSwitch.attributes("title")).toBe(
      graphwarKillerLocale.ui.detection.agent.exportOnClearFailureTitle,
    );

    await autoExportSwitch.trigger("click");
    expect(page.graphwarAgentAutoExportOnClearFailureEnabled).toBe(true);
    expect(autoExportSwitch.attributes("aria-checked")).toBe("true");

    page.graphwarManagedModeEnabled = true;
    await nextTick();
    expect(autoExportSwitch.attributes("disabled")).toBeUndefined();
    await autoExportSwitch.trigger("click");
    expect(page.graphwarAgentAutoExportOnClearFailureEnabled).toBe(false);
    wrapper.unmount();
  });

  it("exports the Agent snapshot captured before a clear-failure result without rereading", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const downloadedFiles: string[] = [];
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadedFiles.push(this.download);
      });
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          debugInfoEnabled: boolean;
          graphwarAgentAutoExportOnClearFailureEnabled: boolean;
          graphwarAgentAppliedSnapshot: unknown;
          graphwarAgentEnabled: boolean;
          oneClickClearRunWorkflow: {
            run: (options?: { onOutcome?: (outcome: { kind: "incomplete" }) => void }) => Promise<boolean>;
          };
          runOneClickClearWorkflow: () => Promise<boolean>;
        };
      }
    ).setupState;

    page.debugInfoEnabled = true;
    page.graphwarAgentAutoExportOnClearFailureEnabled = true;
    page.graphwarAgentAppliedSnapshot = {
      state: { battleRevision: "before-shot", gameInstanceId: "game", turnToken: "turn" },
      worldObstacleMask: new Uint8Array([0, 1]),
    };
    page.graphwarAgentEnabled = true;
    page.oneClickClearRunWorkflow.run = async (options) => {
      options?.onOutcome?.({ kind: "incomplete" });
      return true;
    };
    await nextTick();

    await expect(page.runOneClickClearWorkflow()).resolves.toBe(true);
    await flushPromises();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(anchorClick).toHaveBeenCalledTimes(2);
    expect(downloadedFiles).toHaveLength(2);
    expect(downloadedFiles[0]).toMatch(/^clear-failure-incomplete-state-/);
    expect(downloadedFiles[1]).toMatch(/^clear-failure-incomplete-obstacle-mask-/);

    wrapper.unmount();
    anchorClick.mockRestore();
    vi.unstubAllGlobals();
  });

  it("keeps the glitch preference independent while leaving it inactive for ABS ODE modes", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const yMode = wrapper.findAll(".graphwar-killer__equation-toggle button")[0];
    const absAlgorithm = wrapper.findAll(".graphwar-killer__algorithm-toggle button")[0];
    const glitchMode = wrapper.find("#graphwar-killer-step-glitch-mode");

    expect(yMode.attributes("aria-pressed")).toBe("true");
    expect(absAlgorithm.attributes("aria-pressed")).toBe("true");
    expect(glitchMode.attributes("aria-checked")).toBe("true");
    expect(wrapper.find("#graphwar-killer-step-glitch-mode-reason").text()).toContain(
      graphwarKillerLocale.ui.settings.stepGlitchModeGameModeInactiveReason,
    );

    await glitchMode.trigger("click");
    expect(glitchMode.attributes("aria-checked")).toBe("false");
    await glitchMode.trigger("click");

    expect(yMode.attributes("aria-pressed")).toBe("true");
    expect(absAlgorithm.attributes("aria-pressed")).toBe("true");
    expect(glitchMode.attributes("aria-checked")).toBe("true");

    await wrapper.findAll(".graphwar-killer__equation-toggle button")[1].trigger("click");
    await absAlgorithm.trigger("click");

    expect(wrapper.find("#graphwar-killer-step-glitch-mode-reason").text()).toContain(
      graphwarKillerLocale.ui.settings.stepGlitchModeAlgorithmInactiveReason,
    );

    await wrapper.findAll(".graphwar-killer__equation-toggle button")[2].trigger("click");
    await absAlgorithm.trigger("click");
    expect(wrapper.find("#graphwar-killer-step-glitch-mode-reason").text()).toContain(
      graphwarKillerLocale.ui.settings.stepGlitchModeAlgorithmInactiveReason,
    );
    wrapper.unmount();
  });

  it("leaves path planning under user control while glitch routing is effective", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const pathPlanning = wrapper.get("#graphwar-killer-path-planning");

    await wrapper.findAll(".graphwar-killer__equation-toggle button")[1].trigger("click");

    expect(pathPlanning.attributes("aria-checked")).toBe("false");
    expect(pathPlanning.attributes("disabled")).toBeUndefined();
    expect(wrapper.find("#graphwar-killer-step-glitch-mode-reason").exists()).toBe(false);
    await pathPlanning.trigger("click");
    expect(pathPlanning.attributes("aria-checked")).toBe("true");
    wrapper.unmount();
  });

  it("retains formula controls per game mode while sharing the advanced-settings expansion", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });

    await wrapper.findAll(".graphwar-killer__algorithm-toggle button")[1].trigger("click");
    await wrapper.find(`[aria-label="${graphwarKillerLocale.ui.settings.decimalPlacesAriaLabel}"]`).setValue("1");
    await wrapper.find(`[aria-label="${graphwarKillerLocale.ui.settings.steepnessAriaLabel}"]`).setValue("67");
    await wrapper.find("#graphwar-killer-step-glitch-mode").trigger("click");
    await wrapper.find("#graphwar-killer-overflow-protection").trigger("click");
    await wrapper.find("#graphwar-killer-advanced-settings").trigger("click");

    await wrapper.findAll(".graphwar-killer__equation-toggle button")[1].trigger("click");

    expect(
      wrapper.find<HTMLInputElement>(`[aria-label="${graphwarKillerLocale.ui.settings.decimalPlacesAriaLabel}"]`)
        .element.value,
    ).toBe("4");
    expect(
      wrapper.find<HTMLInputElement>(`[aria-label="${graphwarKillerLocale.ui.settings.steepnessAriaLabel}"]`).element
        .value,
    ).toBe("210");
    expect(wrapper.find("#graphwar-killer-step-glitch-mode").attributes("aria-checked")).toBe("true");
    expect(wrapper.find("#graphwar-killer-overflow-protection").attributes("aria-checked")).toBe("true");
    expect(wrapper.find("#graphwar-killer-advanced-settings").attributes("aria-checked")).toBe("true");

    await wrapper.findAll(".graphwar-killer__equation-toggle button")[0].trigger("click");

    expect(
      wrapper.find<HTMLInputElement>(`[aria-label="${graphwarKillerLocale.ui.settings.decimalPlacesAriaLabel}"]`)
        .element.value,
    ).toBe("1");
    expect(
      wrapper.find<HTMLInputElement>(`[aria-label="${graphwarKillerLocale.ui.settings.steepnessAriaLabel}"]`).element
        .value,
    ).toBe("67");
    expect(wrapper.find("#graphwar-killer-step-glitch-mode").attributes("aria-checked")).toBe("false");
    expect(wrapper.find("#graphwar-killer-overflow-protection").attributes("aria-checked")).toBe("false");
    expect(wrapper.find("#graphwar-killer-advanced-settings").attributes("aria-checked")).toBe("true");
    wrapper.unmount();
  });

  it("keeps shared advanced settings available in the simulator workflow", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });

    await wrapper.findAll(".graphwar-killer__mode-toggle button")[1].trigger("click");

    const settingsPanel = wrapper.get(".graphwar-killer__settings-panel");
    expect(settingsPanel.find("#graphwar-killer-advanced-settings").exists()).toBe(true);
    expect(settingsPanel.find(".graphwar-killer__algorithm-toggle, input").exists()).toBe(false);

    await settingsPanel.get("#graphwar-killer-advanced-settings").trigger("click");

    expect(
      wrapper
        .get(".graphwar-killer__advanced-settings-panel")
        .findAll("h3")
        .map((heading) => heading.text()),
    ).toEqual([graphwarKillerLocale.ui.settings.bounds.heading, graphwarKillerLocale.ui.settings.simulator]);
    wrapper.unmount();
  });

  it("cancels a running search when ABS y'' steepness changes", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    await wrapper.findAll(".graphwar-killer__equation-toggle button")[2].trigger("click");
    await wrapper.findAll(".graphwar-killer__algorithm-toggle button")[0].trigger("click");
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          smartPathfindingInProgress: boolean;
          startSmartPathfinding: () => number;
        };
      }
    ).setupState;

    page.startSmartPathfinding();
    expect(page.smartPathfindingInProgress).toBe(true);
    await wrapper.find(`[aria-label="${graphwarKillerLocale.ui.settings.steepnessAriaLabel}"]`).setValue("211");
    await nextTick();

    expect(page.smartPathfindingInProgress).toBe(false);
    wrapper.unmount();
  });

  it("does not cancel a managed search after loading another formula profile", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    await wrapper.findAll(".graphwar-killer__algorithm-toggle button")[1].trigger("click");
    await wrapper.find("#graphwar-killer-overflow-protection").trigger("click");
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          activeObstacleSimulationToleranceText: string;
          collisionCheckEnabled: boolean;
          collisionCheckPreference: boolean | undefined;
          effectiveStepGlitchModeEnabled: boolean;
          graphwarAgentEnabled: boolean;
          graphwarAgentObstacleSimulationToleranceText: string;
          graphwarManagedModeEnabled: boolean;
          smartPathfindingInProgress: boolean;
          solverEquationMode: "ddy" | "dy" | "y";
          startSmartPathfinding: () => number;
          stepGlitchObstacleSimulationToleranceText: string;
        };
      }
    ).setupState;

    page.collisionCheckPreference = true;
    page.graphwarAgentEnabled = true;
    page.graphwarAgentObstacleSimulationToleranceText = "0";
    page.graphwarManagedModeEnabled = true;
    page.stepGlitchObstacleSimulationToleranceText = "1";
    await nextTick();
    expect(page.activeObstacleSimulationToleranceText).toBe("0");
    page.solverEquationMode = "dy";
    expect(page.effectiveStepGlitchModeEnabled).toBe(true);
    expect(page.activeObstacleSimulationToleranceText).toBe("1");
    expect(page.collisionCheckEnabled).toBe(true);
    page.startSmartPathfinding();
    expect(page.smartPathfindingInProgress).toBe(true);

    await nextTick();

    expect(page.smartPathfindingInProgress).toBe(true);
    wrapper.unmount();
  });
});

/** Creates one active Agent state for page-level manual and managed shot tests. */
function createAgentState(equationMode: "ddy" | "dy" | "y"): GraphwarAgentAvailableState {
  const battleRevision = `sha256:${"b".repeat(64)}`;
  return {
    apiVersion: 3,
    battleRevision,
    canAcceptShotCommands: true,
    capabilities: {
      canReadRoom: true,
      canReadWorldObstacleMask: true,
      canSetReady: true,
      canSubmitShots: true,
    },
    currentPlayerId: 7,
    currentPlayerIndex: 0,
    equationMode,
    gameInstanceId: "00000000-0000-4000-8000-000000000010",
    isAvailable: true,
    isTerrainReversed: false,
    obstacleMask: {
      blockedValue: 1,
      emptyValue: 0,
      height: 450,
      isViewMirrored: false,
      revision: battleRevision,
      viewUrl: "/obstacle-masks/view.bin",
      width: 770,
      worldUrl: "/obstacle-masks/world.bin",
    },
    phase: "aiming",
    plane: { gameLength: 50, height: 450, width: 770 },
    players: [
      {
        currentSoldierIndex: 0,
        isComputerControlled: false,
        isConnected: true,
        isLocal: true,
        isReady: true,
        name: "Local",
        playerId: 7,
        playerIndex: 0,
        soldiers: [
          {
            angleRadians: 0,
            isAlive: true,
            isRendered: true,
            soldierIndex: 0,
            world: { pixel: createPixelPoint(100, 200) },
          },
        ],
        team: 1,
      },
    ],
    remainingTurnMs: 42_000,
    shotCommand: null,
    turnToken: "00000000-0000-4000-8000-000000000011",
  };
}

/** Creates a JSON response with the same media type as Graphwar Agent. */
function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
}

/** Creates a real Agent transport mock for managed state, mask, and shot requests. */
function createManagedAgentFetch(state: GraphwarAgentAvailableState) {
  return vi.fn<typeof fetch>((input, init) => {
    const url = String(input);
    if (url.endsWith("/state")) {
      return Promise.resolve(jsonResponse(state));
    }
    if (url.includes("/obstacle-masks/world.bin")) {
      return Promise.resolve(
        new Response(new Uint8Array(state.obstacleMask.width * state.obstacleMask.height), {
          headers: { ETag: `"${state.obstacleMask.revision}"` },
        }),
      );
    }
    if (url.endsWith("/shots")) {
      return Promise.resolve(jsonResponse(createSubmittedCommand(init)));
    }
    return Promise.reject(new Error(`Unexpected managed Agent request: ${url}`));
  });
}

/** Builds the terminal v3 resource matching one mocked POST body. */
function createSubmittedCommand(init: RequestInit | undefined) {
  const request = JSON.parse(String(init?.body)) as {
    battleRevision: string;
    gameInstanceId: string;
    requestId: string;
    turnToken: string;
  };
  return {
    battleRevision: request.battleRevision,
    createdAtEpochMs: 1,
    gameInstanceId: request.gameInstanceId,
    requestId: request.requestId,
    status: "submitted",
    turnToken: request.turnToken,
    updatedAtEpochMs: 2,
  };
}
