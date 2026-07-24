// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

import {
  createGraphwarAgentClient,
  createGraphwarAgentSnapshot,
  GraphwarAgentClientError,
  type GraphwarAgentClient,
  type GraphwarAgentAvailableState,
  type GraphwarAgentShotPlan,
} from "./controllers/agent/client";
import {
  createGraphwarManagedController,
  GRAPHWAR_MANAGED_SKIP_TURN_FUNCTION,
  type GraphwarManagedController,
} from "./controllers/managed/controller";
import type { GraphwarTrajectoryCalculationWorkerRequest } from "./controllers/path/trajectory-calculation";
import { createPixelPoint } from "./core/types";
import GraphwarKillerPage from "./GraphwarKillerPage.vue";
import { graphwarKillerLocale } from "./locale";
import GraphwarScreenshotPanel from "./presentation/screenshot/MainPanel.vue";

interface ValidatedTrajectorySnapshot {
  equationMode: "ddy" | "dy" | "y";
  expression: string;
  launchAngleRadians?: number;
  sourceIdentity?: string;
  trajectoryPoints: readonly { x: number; y: number }[];
}

describe("Graphwar Killer page settings", () => {
  it("coalesces incumbent control-point previews per frame and restores the formal path on clear", () => {
    let previewFrame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      previewFrame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          clearIncumbentPreview: () => void;
          displayedPathPixels: readonly { x: number; y: number }[];
          pathPixels: { x: number; y: number }[];
          queueIncumbentPreview: (incumbent: {
            expression: string;
            pathPoints: { x: number; y: number }[];
            trajectoryPoints: { x: number; y: number }[];
          }) => void;
        };
      }
    ).setupState;
    const formalPath = [createPixelPoint(1, 2), createPixelPoint(3, 4)];
    const latestPreview = [createPixelPoint(1, 2), createPixelPoint(7, 8)];
    page.pathPixels = formalPath;

    page.queueIncumbentPreview({
      expression: "first",
      pathPoints: [formalPath[0], createPixelPoint(5, 6)],
      trajectoryPoints: formalPath,
    });
    page.queueIncumbentPreview({ expression: "latest", pathPoints: latestPreview, trajectoryPoints: latestPreview });
    expect(page.displayedPathPixels).toEqual(formalPath);

    previewFrame?.(performance.now());
    expect(page.displayedPathPixels).toEqual(latestPreview);

    page.clearIncumbentPreview();
    expect(page.displayedPathPixels).toEqual(formalPath);
    wrapper.unmount();
    vi.unstubAllGlobals();
  });

  it("publishes the latest validated incumbent trajectory without sampling it again", async () => {
    const frameCallbacks = new Map<number, FrameRequestCallback>();
    const trajectoryWorkers: FakeTrajectoryWorker[] = [];
    let nextFrameId = 1;
    class FakeTrajectoryWorker {
      readonly requests: GraphwarTrajectoryCalculationWorkerRequest[] = [];
      terminated = false;

      constructor(_url: URL, options: WorkerOptions) {
        if (options.name === "graphwar-main-trajectory") {
          trajectoryWorkers.push(this);
        }
      }

      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        void type;
        void listener;
      }

      postMessage(request: GraphwarTrajectoryCalculationWorkerRequest) {
        this.requests.push(request);
      }

      terminate() {
        this.terminated = true;
      }
    }
    vi.stubGlobal("Worker", FakeTrajectoryWorker);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      frameCallbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frameCallbacks.delete(id));
    const flushFrames = () => {
      const callbacks = [...frameCallbacks.entries()];
      frameCallbacks.clear();
      for (const [id, callback] of callbacks) {
        callback(id);
      }
    };
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          displayedPathPixels: readonly { x: number; y: number }[];
          pathPixels: { x: number; y: number }[];
          queueIncumbentPreview: (incumbent: {
            expression: string;
            pathPoints: { x: number; y: number }[];
            trajectoryPoints: { x: number; y: number }[];
          }) => void;
          plottedTrajectory: { equationMode: "ddy" | "dy" | "y" } | undefined;
          solverEquationMode: "ddy" | "dy" | "y";
          stageOverlay: { trajectory: { curvePoints: string } };
        };
      }
    ).setupState;
    const firstPath = [createPixelPoint(100, 225), createPixelPoint(200, 200)];
    const latestPath = [createPixelPoint(100, 225), createPixelPoint(300, 180)];
    const latestTrajectory = [createPixelPoint(100, 225), createPixelPoint(210, 190), createPixelPoint(300, 180)];
    try {
      flushFrames();
      const requestCount = trajectoryWorkers.reduce((count, worker) => count + worker.requests.length, 0);

      page.queueIncumbentPreview({ expression: "x", pathPoints: firstPath, trajectoryPoints: firstPath });
      page.queueIncumbentPreview({ expression: "x+1", pathPoints: latestPath, trajectoryPoints: latestTrajectory });
      page.solverEquationMode = "dy";
      flushFrames();
      expect(page.displayedPathPixels).toEqual(latestPath);
      expect(page.plottedTrajectory?.equationMode).toBe("y");
      expect(page.stageOverlay.trajectory.curvePoints).toBe("100.00,225.00 210.00,190.00 300.00,180.00");
      expect(trajectoryWorkers.reduce((count, worker) => count + worker.requests.length, 0)).toBe(requestCount);
    } finally {
      wrapper.unmount();
      vi.unstubAllGlobals();
    }
  });

  it("marks only rounded two-decimal angle text as approximate and keeps an expanded title", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const angleDegrees = 1.0976980032456007e-101;
    const expandedAngleText =
      "0.000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010976980032456007";
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: { commitIncumbentResult: (snapshot: ValidatedTrajectorySnapshot) => void };
      }
    ).setupState;

    await wrapper.findAll(".graphwar-killer__equation-toggle button")[2].trigger("click");
    page.commitIncumbentResult(createValidatedTrajectorySnapshot("x", Math.PI / 4));
    await nextTick();
    expect(wrapper.get(".graphwar-killer__second-order-angle-hint").text()).toBe("需要用键盘上下键把发射角调到 45.00°");

    page.commitIncumbentResult(createValidatedTrajectorySnapshot("x", 0));
    await nextTick();
    expect(wrapper.get(".graphwar-killer__second-order-angle-hint").text()).toBe("需要用键盘上下键把发射角调到 0.00°");

    page.commitIncumbentResult(createValidatedTrajectorySnapshot("x", (angleDegrees * Math.PI) / 180));
    await nextTick();

    const hint = wrapper.get(".graphwar-killer__second-order-angle-hint");
    expect(hint.text()).toBe("需要用键盘上下键把发射角调到约 0.00°（1.0976980032456007e-101°）");
    expect(hint.attributes("title")).toBe(graphwarKillerLocale.status.secondOrderAngleHintTitle(expandedAngleText));
    wrapper.unmount();
  });

  it("shares the fraction-output preference across solver modes and hides it in Simulator", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: { commitIncumbentResult: (snapshot: ValidatedTrajectorySnapshot) => void };
      }
    ).setupState;
    const toggle = wrapper.get("#graphwar-killer-fraction-output");

    page.commitIncumbentResult(createValidatedTrajectorySnapshot("0.5*x"));
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

  it("transfers a published y'' result's formula, mode, and angle to Simulator together", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          commitIncumbentResult: (snapshot: ValidatedTrajectorySnapshot) => void;
          simulatorEquationMode: "ddy" | "dy" | "y";
          simulatorFormulaText: string;
          simulatorLaunchAngleText: string;
          solverEquationMode: "ddy" | "dy" | "y";
        };
      }
    ).setupState;
    page.commitIncumbentResult(createValidatedTrajectorySnapshot("x^2", 0.25));
    expect(page.solverEquationMode).toBe("y");

    await wrapper.findAll(".graphwar-killer__mode-toggle button")[1].trigger("click");

    expect(page.simulatorFormulaText).toBe("x^2");
    expect(page.simulatorEquationMode).toBe("ddy");
    expect(page.simulatorLaunchAngleText).not.toBe("");
    expect(wrapper.findAll(".graphwar-killer__equation-toggle button")[2].attributes("aria-pressed")).toBe("true");
    wrapper.unmount();
  });

  it("inherits the Agent-selected mode when opening an empty Simulator", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          applyGraphwarAgentEquationMode: (mode: "ddy" | "dy" | "y") => void;
          simulatorEquationMode: "ddy" | "dy" | "y";
          solverEquationMode: "ddy" | "dy" | "y";
        };
      }
    ).setupState;
    page.applyGraphwarAgentEquationMode("ddy");
    expect(page.solverEquationMode).toBe("ddy");

    await wrapper.findAll(".graphwar-killer__mode-toggle button")[1].trigger("click");

    expect(page.simulatorEquationMode).toBe("ddy");
    wrapper.unmount();
  });

  it("preserves a partial y'' Simulator draft when returning from Solver", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          applyGraphwarAgentEquationMode: (mode: "ddy" | "dy" | "y") => void;
          simulatorEquationMode: "ddy" | "dy" | "y";
          simulatorLaunchAngleText: string;
        };
      }
    ).setupState;
    page.simulatorEquationMode = "ddy";
    page.simulatorLaunchAngleText = "45";
    page.applyGraphwarAgentEquationMode("dy");

    await wrapper.findAll(".graphwar-killer__mode-toggle button")[1].trigger("click");

    expect(page.simulatorEquationMode).toBe("ddy");
    expect(page.simulatorLaunchAngleText).toBe("45");
    wrapper.unmount();
  });

  it("shows a guarded Agent fire failure reason in the button", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          fireGraphwarAgentFunction: () => Promise<void>;
          isGraphwarAgentEnabled: boolean;
        };
      }
    ).setupState;
    page.isGraphwarAgentEnabled = true;
    await nextTick();

    await page.fireGraphwarAgentFunction();
    await nextTick();

    expect(wrapper.get(".graphwar-killer__agent-fire-button").text()).toBe("开火失败：请先生成有效函数");
    wrapper.unmount();
  });

  it("asks for a Simulator function before firing", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          fireGraphwarAgentFunction: () => Promise<void>;
          isGraphwarAgentEnabled: boolean;
        };
      }
    ).setupState;
    page.isGraphwarAgentEnabled = true;
    await wrapper.findAll(".graphwar-killer__mode-toggle button")[1].trigger("click");

    await page.fireGraphwarAgentFunction();
    await nextTick();

    expect(wrapper.get(".graphwar-killer__agent-fire-button").text()).toBe("开火失败：请先输入有效函数");
    wrapper.unmount();
  });

  it("shows an asynchronous Agent fire failure reason in the button", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")));
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          commitIncumbentResult: (snapshot: ValidatedTrajectorySnapshot) => void;
          isGraphwarAgentEnabled: boolean;
        };
      }
    ).setupState;
    page.isGraphwarAgentEnabled = true;
    page.commitIncumbentResult(createValidatedTrajectorySnapshot("x"));
    await nextTick();

    await wrapper.get(".graphwar-killer__agent-fire-button").trigger("click");
    await flushPromises();
    await nextTick();

    expect(wrapper.get(".graphwar-killer__agent-fire-button").text()).toBe(
      "开火失败：网络或 Graphwar Agent 暂时不可用",
    );
    wrapper.unmount();
    vi.unstubAllGlobals();
  });

  it("shows a partial-conversion warning only while the current fraction output needs it", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          commitIncumbentResult: (snapshot: ValidatedTrajectorySnapshot) => void;
        };
      }
    ).setupState;
    const smallestSubnormal = `0.${"0".repeat(323)}49406564584124654`;
    const toggle = wrapper.get("#graphwar-killer-fraction-output");

    page.commitIncumbentResult(createValidatedTrajectorySnapshot(`0.5+${smallestSubnormal}`));
    await nextTick();
    expect(wrapper.find("#graphwar-killer-fraction-output-reason").exists()).toBe(false);

    await toggle.trigger("click");
    expect(wrapper.get("#graphwar-killer-fraction-output-reason").text()).toBe(
      `! ${graphwarKillerLocale.ui.result.fractionConversionIncomplete}`,
    );
    expect(toggle.attributes("aria-describedby")).toBe("graphwar-killer-fraction-output-reason");

    page.commitIncumbentResult(createValidatedTrajectorySnapshot("0.5*x"));
    await nextTick();
    expect(wrapper.find("#graphwar-killer-fraction-output-reason").exists()).toBe(false);

    page.commitIncumbentResult(createValidatedTrajectorySnapshot(smallestSubnormal));
    await nextTick();
    expect(wrapper.find("#graphwar-killer-fraction-output-reason").exists()).toBe(true);
    page.commitIncumbentResult(createValidatedTrajectorySnapshot(""));
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
        return Promise.resolve(jsonResponse(createShotCommand(init)));
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
          commitIncumbentResult: (snapshot: ValidatedTrajectorySnapshot) => void;
          isFractionOutputEnabled: boolean;
          isGraphwarAgentEnabled: boolean;
          graphwarAgentTokenText: string;
          solverEquationMode: "ddy" | "dy" | "y";
        };
      }
    ).setupState;

    page.isGraphwarAgentEnabled = true;
    page.graphwarAgentTokenText = "session-token";
    page.solverEquationMode = "ddy";
    page.commitIncumbentResult(createValidatedTrajectorySnapshot("88.008750871454684", 0.25));
    page.isFractionOutputEnabled = true;
    await nextTick();
    const displayedFormula = wrapper.get(".graphwar-killer__formula").text();
    expect(displayedFormula).toBe("3096532637734579/35184372088832");

    await wrapper.get(".graphwar-killer__result-panel .graphwar-killer__primary-button").trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(displayedFormula);

    await wrapper.get(".graphwar-killer__agent-fire-button").trigger("click");
    page.commitIncumbentResult(createValidatedTrajectorySnapshot("0.25*x", 0.5));
    page.isFractionOutputEnabled = false;
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
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/state")).length).toBeGreaterThan(1);

    wrapper.unmount();
    vi.unstubAllGlobals();
    if (clipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    } else {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it("rejects out-of-order live states and resets freshness with the Agent connection", () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          graphwarAgentObservationOrder: {
            isCurrent: (state: GraphwarAgentAvailableState) => boolean;
          };
          handleGraphwarAgentLiveState: (state: GraphwarAgentAvailableState) => boolean;
          invalidateGraphwarAgentSceneWork: () => void;
        };
      }
    ).setupState;

    expect(
      page.handleGraphwarAgentLiveState(createAgentState("y", { observationSequence: 2, observedAtEpochMs: 2000 })),
    ).toBe(true);
    expect(
      page.graphwarAgentObservationOrder.isCurrent(
        createAgentState("y", { observationSequence: 2, observedAtEpochMs: 2000 }),
      ),
    ).toBe(true);
    expect(
      page.handleGraphwarAgentLiveState(createAgentState("y", { observationSequence: 1, observedAtEpochMs: 2000 })),
    ).toBe(false);
    expect(
      page.graphwarAgentObservationOrder.isCurrent(
        createAgentState("y", { observationSequence: 1, observedAtEpochMs: 2000 }),
      ),
    ).toBe(false);
    expect(
      page.handleGraphwarAgentLiveState(createAgentState("y", { observationSequence: 3, observedAtEpochMs: 1000 })),
    ).toBe(true);
    expect(
      page.handleGraphwarAgentLiveState(
        createAgentState("y", {
          agentInstanceId: "00000000-0000-4000-8000-000000000002",
          observationSequence: 1,
        }),
      ),
    ).toBe(true);
    expect(
      page.handleGraphwarAgentLiveState(createAgentState("y", { observationSequence: 4, observedAtEpochMs: 3000 })),
    ).toBe(false);

    page.invalidateGraphwarAgentSceneWork();
    expect(
      page.handleGraphwarAgentLiveState(createAgentState("y", { observationSequence: 1, observedAtEpochMs: 1000 })),
    ).toBe(true);
    wrapper.unmount();
  });

  it("does not apply a snapshot whose obstacle mask finishes after a newer live state", async () => {
    const initialState = createAgentState("y", { observationSequence: 1 });
    let resolveMask!: (response: Response) => void;
    const maskResponse = new Promise<Response>((resolve) => {
      resolveMask = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>((input) => {
      if (String(input).endsWith("/state")) {
        return Promise.resolve(jsonResponse(initialState));
      }
      if (String(input).endsWith("/obstacle-masks/world.bin")) {
        return maskResponse;
      }
      return Promise.reject(new Error(`Unexpected Agent request: ${String(input)}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          graphwarAgentAppliedSnapshot: unknown;
          handleGraphwarAgentLiveState: (state: GraphwarAgentAvailableState) => boolean;
          isGraphwarAgentEnabled: boolean;
          readGraphwarAgent: () => Promise<void>;
        };
      }
    ).setupState;
    page.isGraphwarAgentEnabled = true;
    await nextTick();

    const readPromise = page.readGraphwarAgent();
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/obstacle-masks/world.bin"))).toBe(true),
    );
    expect(page.handleGraphwarAgentLiveState(createAgentState("y", { observationSequence: 2 }))).toBe(true);
    resolveMask(
      new Response(new Uint8Array(initialState.obstacleMask.width * initialState.obstacleMask.height), {
        headers: { ETag: `"${initialState.obstacleMask.revision}"` },
      }),
    );
    await readPromise;

    expect(page.graphwarAgentAppliedSnapshot).toBeUndefined();
    wrapper.unmount();
    vi.unstubAllGlobals();
  });

  it("invalidates submitted-function playback as soon as a manual Agent read starts", async () => {
    let resolveStateResponse!: (response: Response) => void;
    const stateResponse = new Promise<Response>((resolve) => {
      resolveStateResponse = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((input) => {
        if (String(input).endsWith("/state")) {
          return stateResponse;
        }
        return Promise.reject(new Error(`Unexpected Agent request: ${String(input)}`));
      }),
    );
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          graphwarAgentFunctionDrawPlayback: {
            curvePoints: { value: string | undefined };
          };
          graphwarAgentPendingFunctionDraw: unknown;
          handleGraphwarAgentLiveState: (state: GraphwarAgentAvailableState) => boolean;
          isGraphwarAgentEnabled: boolean;
          observeSubmittedGraphwarAgentFunction: (
            client: { readState: (signal?: AbortSignal) => Promise<GraphwarAgentAvailableState> },
            state: GraphwarAgentAvailableState,
            plan: GraphwarAgentShotPlan,
            trajectoryPoints: readonly { x: number; y: number }[],
          ) => void;
          readGraphwarAgent: () => Promise<void>;
        };
      }
    ).setupState;
    const state = createAgentState("y", {
      functionDraw: { currentStep: 2, stepsPerSecond: 1500 },
      observationSequence: 1,
      phase: "drawing",
    });
    let observationSignal: AbortSignal | undefined;
    page.isGraphwarAgentEnabled = true;
    page.observeSubmittedGraphwarAgentFunction(
      {
        readState: (signal) => {
          observationSignal = signal;
          return new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        },
      },
      state,
      { equationMode: "y", function: "x" },
      [createPixelPoint(1, 1), createPixelPoint(2, 2), createPixelPoint(3, 3)],
    );
    page.handleGraphwarAgentLiveState(state);
    expect(page.graphwarAgentFunctionDrawPlayback.curvePoints.value).not.toBeUndefined();
    const readPromise = page.readGraphwarAgent();

    expect(page.graphwarAgentFunctionDrawPlayback.curvePoints.value).toBeUndefined();
    expect(page.graphwarAgentPendingFunctionDraw).toBeUndefined();
    expect(observationSignal?.aborted).toBe(true);

    resolveStateResponse(jsonResponse(state));
    await readPromise;
    wrapper.unmount();
    vi.unstubAllGlobals();
  });

  it("does not let a pending manual shot re-arm playback after a manual Agent read", async () => {
    let resolveShotResponse!: (response: Response) => void;
    const shotResponse = new Promise<Response>((resolve) => {
      resolveShotResponse = resolve;
    });
    let shotInit: RequestInit | undefined;
    let stateReadCount = 0;
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const url = String(input);
      if (url.endsWith("/state")) {
        stateReadCount += 1;
        if (stateReadCount === 1) {
          return Promise.resolve(jsonResponse(createAgentState("y")));
        }
        if (stateReadCount === 2) {
          return Promise.resolve(
            jsonResponse(
              createAgentState("y", {
                functionDraw: { currentStep: 2, stepsPerSecond: 1500 },
                observationSequence: 2,
                phase: "drawing",
              }),
            ),
          );
        }
        return new Promise<Response>(() => undefined);
      }
      if (url.endsWith("/obstacle-masks/world.bin")) {
        const state = createAgentState("y");
        return Promise.resolve(
          new Response(new Uint8Array(state.obstacleMask.width * state.obstacleMask.height), {
            headers: { ETag: `"${state.obstacleMask.revision}"` },
          }),
        );
      }
      if (url.endsWith("/shots")) {
        shotInit = init;
        return shotResponse;
      }
      return Promise.reject(new Error(`Unexpected Agent request: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          commitIncumbentResult: (snapshot: ValidatedTrajectorySnapshot) => void;
          graphwarAgentPendingFunctionDraw: unknown;
          isGraphwarAgentEnabled: boolean;
          readGraphwarAgent: () => Promise<void>;
        };
      }
    ).setupState;

    page.isGraphwarAgentEnabled = true;
    page.commitIncumbentResult(createValidatedTrajectorySnapshot("x"));
    await nextTick();
    await wrapper.get(".graphwar-killer__agent-fire-button").trigger("click");
    await flushPromises();
    expect(stateReadCount).toBe(1);

    await page.readGraphwarAgent();
    resolveShotResponse(jsonResponse(createShotCommand(shotInit)));
    await flushPromises();

    expect(stateReadCount).toBe(2);
    expect(page.graphwarAgentPendingFunctionDraw).toBeUndefined();
    wrapper.unmount();
    vi.unstubAllGlobals();
  });

  it("clears submitted-function playback whenever an Agent snapshot replaces the viewport", () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          applyGraphwarAgentSnapshot: (
            snapshot: ReturnType<typeof createGraphwarAgentSnapshot>,
            pathStart: { x: number; y: number } | undefined,
          ) => void;
          graphwarAgentFunctionDrawPlayback: { curvePoints: { value: string | undefined } };
          graphwarAgentPendingFunctionDraw: unknown;
          handleGraphwarAgentLiveState: (state: GraphwarAgentAvailableState) => boolean;
          isGraphwarAgentEnabled: boolean;
          observeSubmittedGraphwarAgentFunction: (
            client: { readState: (signal?: AbortSignal) => Promise<GraphwarAgentAvailableState> },
            state: GraphwarAgentAvailableState,
            plan: GraphwarAgentShotPlan,
            trajectoryPoints: readonly { x: number; y: number }[],
          ) => void;
        };
      }
    ).setupState;
    const drawingState = createAgentState("y", {
      functionDraw: { currentStep: 2, stepsPerSecond: 1500 },
      observationSequence: 1,
      phase: "drawing",
    });
    let observationSignal: AbortSignal | undefined;
    page.isGraphwarAgentEnabled = true;
    page.observeSubmittedGraphwarAgentFunction(
      {
        readState: (signal) => {
          observationSignal = signal;
          return new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        },
      },
      drawingState,
      { equationMode: "y", function: "x" },
      [createPixelPoint(1, 1), createPixelPoint(2, 2), createPixelPoint(3, 3)],
    );
    page.handleGraphwarAgentLiveState(drawingState);
    expect(page.graphwarAgentFunctionDrawPlayback.curvePoints.value).not.toBeUndefined();

    const snapshotState = createAgentState("y", { observationSequence: 2 });
    page.applyGraphwarAgentSnapshot(
      createGraphwarAgentSnapshot(
        "http://127.0.0.1:17900",
        snapshotState,
        new Uint8Array(snapshotState.obstacleMask.width * snapshotState.obstacleMask.height),
      ),
      undefined,
    );

    expect(page.graphwarAgentFunctionDrawPlayback.curvePoints.value).toBeUndefined();
    expect(page.graphwarAgentPendingFunctionDraw).toBeUndefined();
    expect(observationSignal?.aborted).toBe(true);
    wrapper.unmount();
  });

  it("ignores pasted and dropped screenshots while Agent owns the image source", async () => {
    const readAsDataUrl = vi.fn();
    class FakeFileReader {
      addEventListener() {
        return undefined;
      }

      readAsDataURL = readAsDataUrl;
    }
    vi.stubGlobal("FileReader", FakeFileReader);
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          handleWindowPaste: (event: ClipboardEvent) => void;
          isGraphwarAgentEnabled: boolean;
        };
      }
    ).setupState;
    const imageFile = { name: "foreign.png", type: "image/png" } as File;
    const preventDefault = vi.fn();
    page.isGraphwarAgentEnabled = true;

    page.handleWindowPaste({
      clipboardData: {
        items: [{ getAsFile: () => imageFile, type: "image/png" }],
      },
      preventDefault,
    } as unknown as ClipboardEvent);
    wrapper.findComponent(GraphwarScreenshotPanel).vm.$emit("dropImage", {
      dataTransfer: { files: [imageFile] },
    } as unknown as DragEvent);
    await nextTick();

    expect(preventDefault).not.toHaveBeenCalled();
    expect(readAsDataUrl).not.toHaveBeenCalled();
    wrapper.unmount();
    vi.unstubAllGlobals();
  });

  it.each([
    {
      label: "turn",
      overrides: { observationSequence: 2, turnToken: "00000000-0000-4000-8000-000000000012" },
    },
    {
      label: "game",
      overrides: {
        agentInstanceId: "00000000-0000-4000-8000-000000000002",
        gameInstanceId: "00000000-0000-4000-8000-000000000020",
        observationSequence: 1,
      },
    },
  ])("clears progressive playback immediately when a live $label identity replaces it", ({ overrides }) => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          graphwarAgentFunctionDrawPlayback: {
            arm: (
              identity: { gameInstanceId: string; turnToken: string },
              points: readonly { x: number; y: number }[],
            ) => void;
            curvePoints: { value: string | undefined };
          };
          handleGraphwarAgentLiveState: (state: GraphwarAgentAvailableState) => boolean;
        };
      }
    ).setupState;
    const drawingState = createAgentState("y", {
      functionDraw: { currentStep: 2, stepsPerSecond: 1500 },
      observationSequence: 1,
      phase: "drawing",
    });
    if (!drawingState.turnToken) {
      throw new Error("Expected the fixture to include a turn token");
    }
    page.graphwarAgentFunctionDrawPlayback.arm(
      { gameInstanceId: drawingState.gameInstanceId, turnToken: drawingState.turnToken },
      [createPixelPoint(1, 1), createPixelPoint(2, 2), createPixelPoint(3, 3)],
    );
    page.handleGraphwarAgentLiveState(drawingState);
    expect(page.graphwarAgentFunctionDrawPlayback.curvePoints.value).not.toBeUndefined();

    page.handleGraphwarAgentLiveState(createAgentState("y", overrides));

    expect(page.graphwarAgentFunctionDrawPlayback.curvePoints.value).toBeUndefined();
    wrapper.unmount();
  });

  it("does not re-arm submitted-function polling after the Agent credential changes", async () => {
    let resolveShotResponse!: (response: Response) => void;
    const shotResponse = new Promise<Response>((resolve) => {
      resolveShotResponse = resolve;
    });
    let shotInit: RequestInit | undefined;
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      if (String(input).endsWith("/state")) {
        return Promise.resolve(jsonResponse(createAgentState("y")));
      }
      if (String(input).endsWith("/shots")) {
        shotInit = init;
        return shotResponse;
      }
      return Promise.reject(new Error(`Unexpected Agent request: ${String(input)}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          commitIncumbentResult: (snapshot: ValidatedTrajectorySnapshot) => void;
          isGraphwarAgentEnabled: boolean;
          setGraphwarAgentTokenText: (value: string) => void;
        };
      }
    ).setupState;

    page.isGraphwarAgentEnabled = true;
    page.commitIncumbentResult(createValidatedTrajectorySnapshot("x"));
    await nextTick();
    await wrapper.get(".graphwar-killer__agent-fire-button").trigger("click");
    await flushPromises();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/state"))).toHaveLength(1);

    page.setGraphwarAgentTokenText("replacement-token");
    resolveShotResponse(jsonResponse(createShotCommand(shotInit)));
    await flushPromises();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/state"))).toHaveLength(1);

    wrapper.unmount();
    vi.unstubAllGlobals();
  });

  it("observes a manual shot whose original-client result is unknown", async () => {
    let stateReadCount = 0;
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      if (String(input).endsWith("/state")) {
        stateReadCount += 1;
        return Promise.resolve(
          jsonResponse(
            createAgentState("y", {
              observationSequence: stateReadCount,
              ...(stateReadCount > 1 ? { turnToken: "00000000-0000-4000-8000-000000000012" } : {}),
            }),
          ),
        );
      }
      if (String(input).endsWith("/shots")) {
        return Promise.resolve(jsonResponse(createShotCommand(init, "unknown")));
      }
      return Promise.reject(new Error(`Unexpected Agent request: ${String(input)}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          commitIncumbentResult: (snapshot: ValidatedTrajectorySnapshot) => void;
          isGraphwarAgentEnabled: boolean;
        };
      }
    ).setupState;

    page.isGraphwarAgentEnabled = true;
    page.commitIncumbentResult(createValidatedTrajectorySnapshot("x"));
    await nextTick();
    await wrapper.get(".graphwar-killer__agent-fire-button").trigger("click");
    await flushPromises();

    expect(stateReadCount).toBe(2);
    wrapper.unmount();
    vi.unstubAllGlobals();
  });

  it.each(["submitted-skip", "unknown"] as const)("observes a managed %s shot", async (outcome) => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          graphwarManagedClient: GraphwarAgentClient | undefined;
          graphwarManagedController: GraphwarManagedController | undefined;
          graphwarManagedLastRequestedTurnToken: string | undefined;
          handleGraphwarManagedShotSubmitted: (
            state: GraphwarAgentAvailableState,
            plan: GraphwarAgentShotPlan,
            shotReserveSeconds: string,
          ) => void;
          handleGraphwarManagedShotUnknown: (
            state: GraphwarAgentAvailableState,
            plan: GraphwarAgentShotPlan,
            error: GraphwarAgentClientError,
          ) => void;
          isGraphwarAgentEnabled: boolean;
        };
      }
    ).setupState;
    const state = createAgentState("y");
    const readState = vi.fn().mockResolvedValue(
      createAgentState("y", {
        observationSequence: 2,
        turnToken: "00000000-0000-4000-8000-000000000012",
      }),
    );
    page.isGraphwarAgentEnabled = true;
    page.graphwarManagedClient = { readState } as unknown as GraphwarAgentClient;

    if (outcome === "submitted-skip") {
      page.graphwarManagedLastRequestedTurnToken = state.turnToken ?? undefined;
      page.handleGraphwarManagedShotSubmitted(
        state,
        { equationMode: "y", function: GRAPHWAR_MANAGED_SKIP_TURN_FUNCTION },
        "3",
      );
    } else {
      page.graphwarManagedController = {
        getLatestState: () => state,
        stop: () => undefined,
      } as GraphwarManagedController;
      page.handleGraphwarManagedShotUnknown(
        state,
        { equationMode: "y", function: "x" },
        new GraphwarAgentClientError("transient", "unknown"),
      );
    }
    await flushPromises();

    expect(readState).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it.each(["submitted", "unknown"] as const)(
    "starts managed %s playback from the incumbent trajectory while page sampling is unavailable",
    (outcome) => {
      const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
      const page = (
        wrapper.vm.$ as unknown as {
          setupState: {
            createGraphwarManagedSceneKey: (
              state: GraphwarAgentAvailableState,
              shooter: {
                player: GraphwarAgentAvailableState["players"][number];
                soldier: GraphwarAgentAvailableState["players"][number]["soldiers"][number];
              },
            ) => string;
            createGraphwarManagedShotPlan: (state: GraphwarAgentAvailableState) => GraphwarAgentShotPlan | undefined;
            graphwarAgentFunctionDrawPlayback: { curvePoints: { value: string | undefined } };
            graphwarManagedClient: GraphwarAgentClient | undefined;
            graphwarManagedController: GraphwarManagedController | undefined;
            graphwarManagedIncumbent: unknown;
            graphwarManagedLastRequestedTurnToken: string | undefined;
            graphwarManagedSceneKey: string;
            handleGraphwarAgentLiveState: (state: GraphwarAgentAvailableState) => boolean;
            handleGraphwarManagedShotSubmitted: (
              state: GraphwarAgentAvailableState,
              plan: GraphwarAgentShotPlan,
              shotReserveSeconds: string,
            ) => void;
            handleGraphwarManagedShotUnknown: (
              state: GraphwarAgentAvailableState,
              plan: GraphwarAgentShotPlan,
              error: GraphwarAgentClientError,
            ) => void;
            isGraphwarAgentEnabled: boolean;
          };
        }
      ).setupState;
      const state = createAgentState("y");
      const trajectoryPoints = [createPixelPoint(100, 225), createPixelPoint(110, 220), createPixelPoint(120, 215)];
      page.isGraphwarAgentEnabled = true;
      page.graphwarManagedClient = {
        readState: () => new Promise(() => undefined),
      } as unknown as GraphwarAgentClient;
      page.graphwarManagedSceneKey = page.createGraphwarManagedSceneKey(state, {
        player: state.players[0],
        soldier: state.players[0].soldiers[0],
      });
      page.graphwarManagedIncumbent = {
        expression: "x",
        pathPoints: [trajectoryPoints[0], trajectoryPoints[2]],
        trajectoryPoints,
      };
      const plan = page.createGraphwarManagedShotPlan(state);
      if (!plan) {
        throw new Error("Expected the incumbent to produce a managed shot plan");
      }

      if (outcome === "submitted") {
        page.graphwarManagedLastRequestedTurnToken = state.turnToken ?? undefined;
        page.handleGraphwarManagedShotSubmitted(state, plan, "3");
      } else {
        page.graphwarManagedController = {
          getLatestState: () => state,
          stop: () => undefined,
        } as GraphwarManagedController;
        page.handleGraphwarManagedShotUnknown(state, plan, new GraphwarAgentClientError("transient", "unknown"));
      }
      // Keep this assertion on the authoritative step; wall-clock extrapolation is covered by the playback tests.
      page.handleGraphwarAgentLiveState(
        createAgentState("y", {
          functionDraw: { currentStep: 2, stepsPerSecond: 0 },
          observationSequence: 2,
          phase: "drawing",
        }),
      );

      expect(page.graphwarAgentFunctionDrawPlayback.curvePoints.value).toBe("100.00,225.00 110.00,220.00");
      wrapper.unmount();
    },
  );

  it("does not reuse a managed incumbent trajectory for a mismatched submitted plan", () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          createGraphwarManagedSceneKey: (
            state: GraphwarAgentAvailableState,
            shooter: {
              player: GraphwarAgentAvailableState["players"][number];
              soldier: GraphwarAgentAvailableState["players"][number]["soldiers"][number];
            },
          ) => string;
          createGraphwarManagedShotPlan: (state: GraphwarAgentAvailableState) => GraphwarAgentShotPlan | undefined;
          getGraphwarManagedPreparedShotTrajectoryPoints: (
            state: GraphwarAgentAvailableState,
            plan: GraphwarAgentShotPlan,
          ) => readonly { x: number; y: number }[];
          graphwarManagedIncumbent: unknown;
          graphwarManagedSceneKey: string;
        };
      }
    ).setupState;
    const state = createAgentState("ddy");
    page.graphwarManagedSceneKey = page.createGraphwarManagedSceneKey(state, {
      player: state.players[0],
      soldier: state.players[0].soldiers[0],
    });
    page.graphwarManagedIncumbent = {
      expression: "x",
      launchAngleRadians: 0.25,
      pathPoints: [createPixelPoint(100, 225), createPixelPoint(200, 225)],
      trajectoryPoints: [createPixelPoint(100, 225), createPixelPoint(110, 220)],
    };
    const plan = page.createGraphwarManagedShotPlan(state);
    if (!plan || plan.equationMode !== "ddy") {
      throw new Error("Expected a second-order managed shot plan");
    }

    expect(page.getGraphwarManagedPreparedShotTrajectoryPoints(state, { ...plan, function: "x+1" })).toEqual([]);
    expect(page.getGraphwarManagedPreparedShotTrajectoryPoints(state, { ...plan, angleRadians: 0.5 })).toEqual([]);
    expect(
      page.getGraphwarManagedPreparedShotTrajectoryPoints(
        { ...state, turnToken: "00000000-0000-4000-8000-000000000012" },
        plan,
      ),
    ).toEqual([]);
    expect(
      page.getGraphwarManagedPreparedShotTrajectoryPoints(
        { ...state, gameInstanceId: "00000000-0000-4000-8000-000000000020" },
        plan,
      ),
    ).toEqual([]);
    page.graphwarManagedSceneKey = `${page.graphwarManagedSceneKey}:changed`;
    expect(page.getGraphwarManagedPreparedShotTrajectoryPoints(state, plan)).toEqual([]);
    wrapper.unmount();
  });

  it("continues submitted-function observation through explosion until the turn changes", async () => {
    vi.useFakeTimers();
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          isGraphwarAgentEnabled: boolean;
          observeSubmittedGraphwarAgentFunction: (
            client: { readState: (signal?: AbortSignal) => Promise<GraphwarAgentAvailableState> },
            state: GraphwarAgentAvailableState,
            plan: GraphwarAgentShotPlan,
          ) => void;
        };
      }
    ).setupState;
    const submittedState = createAgentState("y", { observationSequence: 1, observedAtEpochMs: 10_000 });
    const readState = vi
      .fn()
      .mockResolvedValueOnce(
        createAgentState("y", {
          functionDraw: { currentStep: 1, stepsPerSecond: 1500 },
          observationSequence: 2,
          observedAtEpochMs: 10_001,
          phase: "drawing",
        }),
      )
      .mockResolvedValueOnce(
        createAgentState("y", {
          observationSequence: 3,
          observedAtEpochMs: 10_002,
          phase: "exploding",
        }),
      )
      .mockResolvedValueOnce(
        createAgentState("y", {
          observationSequence: 4,
          observedAtEpochMs: 10_003,
          turnToken: "00000000-0000-4000-8000-000000000012",
        }),
      );

    page.isGraphwarAgentEnabled = true;
    page.observeSubmittedGraphwarAgentFunction({ readState }, submittedState, {
      equationMode: "y",
      function: "x",
    });
    await flushPromises();
    expect(readState).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(readState).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(readState).toHaveBeenCalledTimes(3);

    wrapper.unmount();
    vi.useRealTimers();
  });

  it("aborts an in-flight submitted-function observation when the page is unmounted", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          isGraphwarAgentEnabled: boolean;
          observeSubmittedGraphwarAgentFunction: (
            client: { readState: (signal?: AbortSignal) => Promise<GraphwarAgentAvailableState> },
            state: GraphwarAgentAvailableState,
            plan: GraphwarAgentShotPlan,
          ) => void;
        };
      }
    ).setupState;
    let observationSignal: AbortSignal | undefined;
    const readState = vi.fn(
      (signal?: AbortSignal) =>
        new Promise<GraphwarAgentAvailableState>((_resolve, reject) => {
          observationSignal = signal;
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );

    page.isGraphwarAgentEnabled = true;
    page.observeSubmittedGraphwarAgentFunction({ readState }, createAgentState("y"), {
      equationMode: "y",
      function: "x",
    });
    await flushPromises();
    expect(observationSignal?.aborted).toBe(false);

    wrapper.unmount();
    expect(observationSignal?.aborted).toBe(true);
    await flushPromises();
  });

  it("submits normal and deadline managed shots from the incumbent instead of the displayed result", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          commitIncumbentResult: (snapshot: ValidatedTrajectorySnapshot) => void;
          createGraphwarManagedSceneKey: (
            state: GraphwarAgentAvailableState,
            shooter: {
              player: GraphwarAgentAvailableState["players"][number];
              soldier: GraphwarAgentAvailableState["players"][number]["soldiers"][number];
            },
          ) => string;
          createGraphwarManagedShotPlan: (state: GraphwarAgentAvailableState) => GraphwarAgentShotPlan | undefined;
          isFractionOutputEnabled: boolean;
          graphwarManagedController: GraphwarManagedController | undefined;
          graphwarManagedIncumbent:
            | {
                expression: string;
                launchAngleRadians?: number;
                trajectoryPoints: { x: number; y: number }[];
              }
            | undefined;
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

    page.commitIncumbentResult(createValidatedTrajectorySnapshot("0.5*x"));
    page.isFractionOutputEnabled = true;
    page.graphwarManagedIncumbent = {
      expression: "88.008750871454684",
      trajectoryPoints: [createPixelPoint(100, 225), createPixelPoint(200, 225)],
    };
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

    page.isFractionOutputEnabled = false;
    expect(page.createGraphwarManagedShotPlan(deadlineState)?.function).toBe("88.008750871454684");

    wrapper.unmount();
  });

  it("subtracts Agent snapshot age before allowing a managed shot inside the reserve window", () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          hasGraphwarManagedShotTimeRemaining: (state: GraphwarAgentAvailableState) => boolean;
        };
      }
    ).setupState;

    expect(
      page.hasGraphwarManagedShotTimeRemaining(
        createAgentState("y", {
          observedAtEpochMs: Date.now() - 2000,
          remainingTurnMs: 4000,
        }),
      ),
    ).toBe(false);
    expect(
      page.hasGraphwarManagedShotTimeRemaining(
        createAgentState("y", {
          observedAtEpochMs: Date.now(),
          remainingTurnMs: 4000,
        }),
      ),
    ).toBe(true);

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
          isDebugInfoEnabled: boolean;
          isGraphwarAgentAutoExportOnClearFailureEnabled: boolean;
          isGraphwarAgentEnabled: boolean;
          isGraphwarManagedModeEnabled: boolean;
        };
      }
    ).setupState;

    expect(page.isGraphwarAgentAutoExportOnClearFailureEnabled).toBe(false);
    expect(wrapper.find("#graphwar-killer-export-on-clear-failure").exists()).toBe(false);

    page.isDebugInfoEnabled = true;
    page.isGraphwarAgentEnabled = true;
    await nextTick();
    const autoExportSwitch = wrapper.get<HTMLButtonElement>("#graphwar-killer-export-on-clear-failure");
    expect(autoExportSwitch.attributes("aria-checked")).toBe("false");
    expect(autoExportSwitch.attributes("title")).toBe(
      graphwarKillerLocale.ui.detection.agent.exportOnClearFailureTitle,
    );

    await autoExportSwitch.trigger("click");
    expect(page.isGraphwarAgentAutoExportOnClearFailureEnabled).toBe(true);
    expect(autoExportSwitch.attributes("aria-checked")).toBe("true");

    page.isGraphwarManagedModeEnabled = true;
    await nextTick();
    expect(autoExportSwitch.attributes("disabled")).toBeUndefined();
    await autoExportSwitch.trigger("click");
    expect(page.isGraphwarAgentAutoExportOnClearFailureEnabled).toBe(false);
    wrapper.unmount();
  });

  it("keeps the advanced-settings switch available during managed mode", async () => {
    vi.useFakeTimers();
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          debugActivationRemainingMs: number | undefined;
          isAdvancedSettingsVisible: boolean;
          isDebugInfoEnabled: boolean;
          isGraphwarManagedModeEnabled: boolean;
        };
      }
    ).setupState;

    try {
      page.isGraphwarManagedModeEnabled = true;
      await nextTick();
      const advancedSettings = wrapper.get("#graphwar-killer-advanced-settings");
      expect(advancedSettings.attributes("disabled")).toBeUndefined();

      await advancedSettings.trigger("click");
      expect(page.isAdvancedSettingsVisible).toBe(true);
      expect(advancedSettings.attributes("aria-checked")).toBe("true");
      await advancedSettings.trigger("click");
      expect(page.isAdvancedSettingsVisible).toBe(false);

      await advancedSettings.trigger("pointerdown", { button: 0 });
      vi.advanceTimersByTime(1000);
      expect(page.debugActivationRemainingMs).toBe(1000);
      expect(page.isDebugInfoEnabled).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(page.isDebugInfoEnabled).toBe(true);
      await advancedSettings.trigger("pointerup", { button: 0 });
      await advancedSettings.trigger("click");
      expect(page.isAdvancedSettingsVisible).toBe(false);
    } finally {
      wrapper.unmount();
      vi.useRealTimers();
    }
  });

  it("attributes managed friendly targets to the pathfinding setting", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          isFriendlyFireEnabled: boolean;
          isGraphwarManagedModeEnabled: boolean;
        };
      }
    ).setupState;

    page.isGraphwarManagedModeEnabled = true;
    await nextTick();
    expect(wrapper.find(".graphwar-killer__managed-warning").exists()).toBe(false);

    page.isFriendlyFireEnabled = true;
    await nextTick();
    expect(wrapper.get(".graphwar-killer__managed-warning").text()).toBe("寻路设置已允许友伤，友军会作为一键清图候选");

    page.isGraphwarManagedModeEnabled = false;
    await nextTick();
    expect(wrapper.find(".graphwar-killer__managed-warning").exists()).toBe(false);
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
          isDebugInfoEnabled: boolean;
          isGraphwarAgentAutoExportOnClearFailureEnabled: boolean;
          graphwarAgentAppliedSnapshot: unknown;
          isGraphwarAgentEnabled: boolean;
          oneClickClearRunWorkflow: {
            run: (options?: { onOutcome?: (outcome: { kind: "incomplete" }) => void }) => Promise<boolean>;
          };
          runOneClickClearWorkflow: () => Promise<boolean>;
        };
      }
    ).setupState;

    page.isDebugInfoEnabled = true;
    page.isGraphwarAgentAutoExportOnClearFailureEnabled = true;
    page.graphwarAgentAppliedSnapshot = {
      state: { battleRevision: "before-shot", gameInstanceId: "game", turnToken: "turn" },
      worldObstacleMask: new Uint8Array([0, 1]),
    };
    page.isGraphwarAgentEnabled = true;
    page.oneClickClearRunWorkflow.run = async (options) => {
      options?.onOutcome?.({ kind: "incomplete" });
      return true;
    };
    await nextTick();

    await expect(page.runOneClickClearWorkflow()).resolves.toBe(true);
    await flushPromises();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(anchorClick).toHaveBeenCalledTimes(3);
    expect(downloadedFiles).toHaveLength(3);
    expect(downloadedFiles[0]).toMatch(/^clear-failure-incomplete-state-/);
    expect(downloadedFiles[1]).toMatch(/^clear-failure-incomplete-obstacle-mask-/);
    expect(downloadedFiles[2]).toMatch(/^clear-failure-incomplete-pathfinding-debug-/);
    expect(
      new Set([
        downloadedFiles[0]?.replace("clear-failure-incomplete-state-", "").replace(/\.json$/, ""),
        downloadedFiles[1]?.replace("clear-failure-incomplete-obstacle-mask-", "").replace(/\.bin$/, ""),
        downloadedFiles[2]?.replace("clear-failure-incomplete-pathfinding-debug-", "").replace(/\.json$/, ""),
      ]).size,
    ).toBe(1);

    wrapper.unmount();
    anchorClick.mockRestore();
    vi.unstubAllGlobals();
  });

  it("keeps the previous completed pathfinding report until the next task completes and clears it with debug mode", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const page = (
      wrapper.vm.$ as unknown as {
        setupState: {
          isDebugInfoEnabled: boolean;
          latestPathfindingDebugBundle: object | undefined;
          oneClickClearRunWorkflow: {
            run: (options?: { onOutcome?: (outcome: { kind: "complete" }) => void }) => Promise<boolean>;
          };
          runOneClickClearWorkflow: () => Promise<boolean>;
        };
      }
    ).setupState;

    page.isDebugInfoEnabled = true;
    page.oneClickClearRunWorkflow.run = async (options) => {
      options?.onOutcome?.({ kind: "complete" });
      return true;
    };
    await nextTick();
    await expect(page.runOneClickClearWorkflow()).resolves.toBe(true);
    const firstReport = page.latestPathfindingDebugBundle;
    expect(firstReport).toBeDefined();

    let completeSecondTask: (() => void) | undefined;
    page.oneClickClearRunWorkflow.run = (options) => {
      options?.onOutcome?.({ kind: "complete" });
      return new Promise<boolean>((resolve) => {
        completeSecondTask = () => resolve(true);
      });
    };
    const secondTask = page.runOneClickClearWorkflow();
    await Promise.resolve();
    expect(page.latestPathfindingDebugBundle).toBe(firstReport);

    completeSecondTask?.();
    await expect(secondTask).resolves.toBe(true);
    expect(page.latestPathfindingDebugBundle).not.toBe(firstReport);

    page.isDebugInfoEnabled = false;
    await nextTick();
    expect(page.latestPathfindingDebugBundle).toBeUndefined();
    wrapper.unmount();
  });

  it("hides glitch mode for y while preserving its ODE preferences", async () => {
    const wrapper = mount(GraphwarKillerPage, { props: { locale: graphwarKillerLocale } });
    const yMode = wrapper.findAll(".graphwar-killer__equation-toggle button")[0];

    expect(yMode.attributes("aria-pressed")).toBe("true");
    expect(wrapper.find("#graphwar-killer-step-glitch-mode").exists()).toBe(false);

    await wrapper.findAll(".graphwar-killer__equation-toggle button")[1].trigger("click");
    const glitchMode = wrapper.get("#graphwar-killer-step-glitch-mode");
    expect(glitchMode.attributes("aria-checked")).toBe("true");
    await wrapper.findAll(".graphwar-killer__algorithm-toggle button")[0].trigger("click");

    expect(wrapper.find("#graphwar-killer-step-glitch-mode-reason").text()).toContain(
      graphwarKillerLocale.ui.settings.stepGlitchModeAlgorithmInactiveReason,
    );
    await glitchMode.trigger("click");
    expect(wrapper.find("#graphwar-killer-step-glitch-mode-reason").exists()).toBe(false);
    await glitchMode.trigger("click");

    await yMode.trigger("click");
    expect(wrapper.find("#graphwar-killer-step-glitch-mode").exists()).toBe(false);

    await wrapper.findAll(".graphwar-killer__equation-toggle button")[2].trigger("click");
    await wrapper.findAll(".graphwar-killer__algorithm-toggle button")[0].trigger("click");
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
    expect(wrapper.find("#graphwar-killer-step-glitch-mode").exists()).toBe(false);
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
          isSmartPathfindingInProgress: boolean;
          startSmartPathfinding: () => number;
        };
      }
    ).setupState;

    page.startSmartPathfinding();
    expect(page.isSmartPathfindingInProgress).toBe(true);
    await wrapper.find(`[aria-label="${graphwarKillerLocale.ui.settings.steepnessAriaLabel}"]`).setValue("211");
    await nextTick();

    expect(page.isSmartPathfindingInProgress).toBe(false);
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
          isCollisionCheckEnabled: boolean;
          shouldCheckCollisions: boolean | undefined;
          isEffectiveStepGlitchModeEnabled: boolean;
          isGraphwarAgentEnabled: boolean;
          graphwarAgentObstacleSimulationToleranceText: string;
          isGraphwarManagedModeEnabled: boolean;
          isSmartPathfindingInProgress: boolean;
          solverEquationMode: "ddy" | "dy" | "y";
          startSmartPathfinding: () => number;
          stepGlitchObstacleSimulationToleranceText: string;
        };
      }
    ).setupState;

    page.shouldCheckCollisions = true;
    page.isGraphwarAgentEnabled = true;
    page.graphwarAgentObstacleSimulationToleranceText = "0";
    page.isGraphwarManagedModeEnabled = true;
    page.stepGlitchObstacleSimulationToleranceText = "1";
    await nextTick();
    expect(page.activeObstacleSimulationToleranceText).toBe("0");
    page.solverEquationMode = "dy";
    expect(page.isEffectiveStepGlitchModeEnabled).toBe(true);
    expect(page.activeObstacleSimulationToleranceText).toBe("1");
    expect(page.isCollisionCheckEnabled).toBe(true);
    page.startSmartPathfinding();
    expect(page.isSmartPathfindingInProgress).toBe(true);

    await nextTick();

    expect(page.isSmartPathfindingInProgress).toBe(true);
    wrapper.unmount();
  });
});

/** Creates a validated result snapshot for page tests that only need formula state. */
function createValidatedTrajectorySnapshot(
  expression: string,
  launchAngleRadians?: number,
): ValidatedTrajectorySnapshot {
  return {
    equationMode: launchAngleRadians === undefined ? "y" : "ddy",
    expression,
    ...(launchAngleRadians === undefined ? {} : { launchAngleRadians }),
    trajectoryPoints: [],
  };
}

/** Creates one active Agent state for page-level manual and managed shot tests. */
function createAgentState(
  equationMode: "ddy" | "dy" | "y",
  overrides: Partial<GraphwarAgentAvailableState> = {},
): GraphwarAgentAvailableState {
  const battleRevision = `sha256:${"b".repeat(64)}`;
  return {
    agentInstanceId: "00000000-0000-4000-8000-000000000001",
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
    observationSequence: overrides.observationSequence ?? 1,
    observedAtEpochMs: Date.now(),
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
    ...overrides,
    functionDraw: overrides.functionDraw ?? null,
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
      return Promise.resolve(jsonResponse(createShotCommand(init)));
    }
    return Promise.reject(new Error(`Unexpected managed Agent request: ${url}`));
  });
}

/** Builds a terminal v3 command resource matching one mocked POST body. */
function createShotCommand(init: RequestInit | undefined, status: "submitted" | "unknown" = "submitted") {
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
    ...(status === "unknown" ? { error: { code: "original-client-result-unknown", message: "unknown" } } : {}),
    status,
    turnToken: request.turnToken,
    updatedAtEpochMs: 2,
  };
}
