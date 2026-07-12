import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

import { createGraphPoint, createPixelPoint } from "../../core/types";
import type {
  GraphwarTrajectoryCalculationOutcome,
  GraphwarTrajectoryCalculationWorkerRequest,
  GraphwarTrajectoryCalculationWorkerResponse,
} from "./trajectory-calculation";
import { useGraphwarTrajectoryResult } from "./trajectory-result";

describe("main trajectory result lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeWorker.instances.length = 0;
  });

  it("keeps the last result while running, replaces it atomically, and clears it on failure", async () => {
    vi.useFakeTimers();
    const frames = installFakeBrowserRuntime();
    const state = createControllerState();
    const controller = useGraphwarTrajectoryResult(state.options);

    setSolverPath(state, -10, 0);
    await nextTick();
    expect(controller.calculationStatus.value.type).toBe("in-progress");
    frames.flush();
    respondToActiveWorker({
      ok: true,
      result: {
        curvePoints: "first curve",
        formulaResult: { expression: "first formula", terms: [] },
        secondOrderLaunchAngleDegrees: 12,
        warningReason: "obstacle",
      },
    });
    await nextTick();

    expect(controller.formulaResult.value?.expression).toBe("first formula");
    expect(controller.plottedCurvePoints.value).toBe("first curve");
    expect(controller.secondOrderLaunchAngleDegrees.value).toBe(12);
    expect(controller.trajectoryWarningReason.value).toBe("obstacle");
    expect(controller.calculationStatus.value.type).toBe("success");

    setSolverPath(state, 0, 5);
    await nextTick();
    expect(controller.calculationStatus.value.type).toBe("in-progress");
    expect(controller.formulaResult.value?.expression).toBe("first formula");
    expect(controller.plottedCurvePoints.value).toBe("first curve");

    frames.flush();
    respondToActiveWorker({ message: "simulation failed", ok: false, stage: "trajectory" });
    await nextTick();
    expect(controller.calculationStatus.value).toEqual({
      message: "simulation failed",
      stage: "trajectory",
      type: "failure",
    });
    expect(controller.formulaResult.value).toBeUndefined();
    expect(controller.plottedCurvePoints.value).toBe("");
    expect(controller.secondOrderLaunchAngleDegrees.value).toBeUndefined();
    expect(controller.trajectoryWarningReason.value).toBeUndefined();

    controller.dispose();
  });

  it("clears an invalid input and hides a successful status after two seconds", async () => {
    vi.useFakeTimers();
    const frames = installFakeBrowserRuntime();
    const state = createControllerState();
    const controller = useGraphwarTrajectoryResult(state.options);

    setSolverPath(state, -10, 0);
    await nextTick();
    frames.flush();
    respondToActiveWorker({
      ok: true,
      result: {
        curvePoints: "curve",
        formulaResult: { expression: "formula", terms: [] },
      },
    });
    await nextTick();
    expect(controller.calculationStatus.value.type).toBe("success");

    vi.advanceTimersByTime(2000);
    expect(controller.calculationStatus.value.type).toBe("idle");

    state.pathPixels.value = [];
    state.mappedPathPoints.value = [];
    await nextTick();
    expect(controller.formulaResult.value).toBeUndefined();
    expect(controller.plottedCurvePoints.value).toBe("");
    expect(controller.calculationStatus.value.type).toBe("idle");

    controller.dispose();
  });

  it("submits only the latest valid input changed within one animation frame", async () => {
    const frames = installFakeBrowserRuntime();
    const state = createControllerState();
    const controller = useGraphwarTrajectoryResult(state.options);

    setSolverPath(state, -10, 1);
    await nextTick();
    setSolverPath(state, -5, 2);
    await nextTick();

    expect(FakeWorker.instances).toHaveLength(0);
    frames.flush();
    expect(FakeWorker.instances).toHaveLength(2);
    const request = FakeWorker.instances[0].requests[0];
    if (request.input.type !== "solver") {
      throw new Error("Expected solver request");
    }
    expect(request.input.points.at(-1)).toEqual(createGraphPoint(-5, 2));

    respondToActiveWorker({
      ok: true,
      result: {
        curvePoints: "latest curve",
        formulaResult: { expression: "latest formula", terms: [] },
      },
    });
    await nextTick();
    controller.dispose();
  });

  it("keeps the last solver formula while visiting the simulator and recalculating after return", async () => {
    const frames = installFakeBrowserRuntime();
    const state = createControllerState();
    const controller = useGraphwarTrajectoryResult(state.options);

    setSolverPath(state, -10, 1);
    await nextTick();
    frames.flush();
    respondToActiveWorker({
      ok: true,
      result: {
        curvePoints: "solver curve",
        formulaResult: { expression: "solver formula", terms: [] },
        secondOrderLaunchAngleDegrees: 12,
      },
    });
    await nextTick();

    state.options.simulator.formulaText.value = "x";
    state.options.settings.toolWorkflowMode.value = "simulator";
    await nextTick();
    frames.flush();
    respondToActiveWorker({
      ok: true,
      result: { curvePoints: "simulator curve" },
    });
    await nextTick();

    expect(controller.formulaResult.value?.expression).toBe("solver formula");
    expect(controller.secondOrderLaunchAngleDegrees.value).toBe(12);
    expect(controller.plottedCurvePoints.value).toBe("simulator curve");

    state.options.settings.toolWorkflowMode.value = "solver";
    await nextTick();

    expect(controller.calculationStatus.value.type).toBe("in-progress");
    expect(controller.formulaResult.value?.expression).toBe("solver formula");
    expect(controller.secondOrderLaunchAngleDegrees.value).toBe(12);
    expect(controller.plottedCurvePoints.value).toBe("solver curve");
    controller.dispose();
  });

  it("cancels and clears the current solver result when collision settings become invalid", async () => {
    const frames = installFakeBrowserRuntime();
    const state = createControllerState();
    const controller = useGraphwarTrajectoryResult(state.options);

    setSolverPath(state, -10, 1);
    await nextTick();
    frames.flush();
    respondToActiveWorker({
      ok: true,
      result: {
        curvePoints: "curve",
        formulaResult: { expression: "formula", terms: [] },
      },
    });
    await nextTick();

    state.collisionSettingsValid.value = false;
    await nextTick();

    expect(controller.calculationStatus.value.type).toBe("idle");
    expect(controller.formulaResult.value).toBeUndefined();
    expect(controller.plottedCurvePoints.value).toBe("");
    controller.dispose();
  });

  it("atomically publishes only completed incumbent previews and restores or commits them without recalculating", async () => {
    const frames = installFakeBrowserRuntime();
    const state = createControllerState();
    const controller = useGraphwarTrajectoryResult(state.options);

    setSolverPath(state, -10, 1);
    await nextTick();
    frames.flush();
    respondToActiveWorker({
      ok: true,
      result: { curvePoints: "formal curve", formulaResult: { expression: "formal formula", terms: [] } },
    });
    await nextTick();

    controller.publishIncumbentPreview("first incumbent");
    controller.publishIncumbentPreview("latest incumbent", Math.PI / 4);
    expect(FakeWorker.instances.find((worker) => worker.terminated && worker.requests.length > 0)).toBeDefined();
    expect(controller.incumbentPreviewActive.value).toBe(false);
    expect(controller.formulaResult.value?.expression).toBe("formal formula");
    expect(controller.plottedCurvePoints.value).toBe("formal curve");
    respondToActiveWorker({ ok: true, result: { curvePoints: "preview curve" } });
    await nextTick();

    expect(controller.incumbentPreviewActive.value).toBe(true);
    expect(controller.formulaResult.value?.expression).toBe("latest incumbent");
    expect(controller.plottedCurvePoints.value).toBe("preview curve");
    expect(controller.secondOrderLaunchAngleDegrees.value).toBe(45);

    controller.publishIncumbentPreview("pending incumbent");
    expect(controller.formulaResult.value?.expression).toBe("latest incumbent");
    expect(controller.plottedCurvePoints.value).toBe("preview curve");
    respondToActiveWorker({ message: "preview failed", ok: false, stage: "trajectory" });
    await nextTick();
    expect(controller.formulaResult.value?.expression).toBe("latest incumbent");
    expect(controller.plottedCurvePoints.value).toBe("preview curve");

    controller.clearIncumbentPreview();
    expect(controller.incumbentPreviewActive.value).toBe(false);
    expect(controller.formulaResult.value?.expression).toBe("formal formula");
    expect(controller.plottedCurvePoints.value).toBe("formal curve");

    controller.publishIncumbentPreview("cancelled incumbent");
    controller.clearIncumbentPreview();
    respondToActiveWorker({ ok: true, result: { curvePoints: "stale curve" } });
    await nextTick();
    expect(controller.formulaResult.value?.expression).toBe("formal formula");
    expect(controller.plottedCurvePoints.value).toBe("formal curve");

    controller.publishIncumbentPreview("committed incumbent");
    respondToActiveWorker({ ok: true, result: { curvePoints: "committed curve" } });
    await nextTick();
    expect(controller.commitIncumbentPreview("stale incumbent")).toBe(false);
    expect(controller.commitIncumbentPreview("committed incumbent")).toBe(true);

    expect(controller.incumbentPreviewActive.value).toBe(false);
    expect(controller.formulaResult.value?.expression).toBe("committed incumbent");
    expect(controller.plottedCurvePoints.value).toBe("committed curve");

    controller.commitIncumbentResult("headless incumbent", Math.PI / 2);
    setSolverPath(state, -5, 2);
    await nextTick();
    expect(controller.calculationStatus.value.type).toBe("idle");
    expect(controller.formulaResult.value?.expression).toBe("headless incumbent");
    expect(controller.plottedCurvePoints.value).toBe("");
    expect(controller.secondOrderLaunchAngleDegrees.value).toBe(90);
    controller.dispose();
  });

  it("commits a pending incumbent after its existing preview task finishes", async () => {
    const frames = installFakeBrowserRuntime();
    const state = createControllerState();
    const controller = useGraphwarTrajectoryResult(state.options);

    setSolverPath(state, -10, 1);
    await nextTick();
    frames.flush();
    respondToActiveWorker({
      ok: true,
      result: { curvePoints: "formal curve", formulaResult: { expression: "formal formula", terms: [] } },
    });
    await nextTick();

    controller.publishIncumbentPreview("old incumbent");
    respondToActiveWorker({ ok: true, result: { curvePoints: "old curve" } });
    await nextTick();
    controller.publishIncumbentPreview("pending incumbent", Math.PI / 4);
    const requestCount = countWorkerRequests();

    controller.commitIncumbentResult("pending incumbent", Math.PI / 4);
    setSolverPath(state, -5, 2);
    await nextTick();
    frames.flush();

    expect(countWorkerRequests()).toBe(requestCount);
    expect(controller.formulaResult.value?.expression).toBe("old incumbent");
    expect(controller.plottedCurvePoints.value).toBe("old curve");

    respondToActiveWorker({ ok: true, result: { curvePoints: "pending curve" } });
    await nextTick();
    expect(controller.incumbentPreviewActive.value).toBe(false);
    expect(controller.formulaResult.value?.expression).toBe("pending incumbent");
    expect(controller.plottedCurvePoints.value).toBe("pending curve");
    expect(controller.secondOrderLaunchAngleDegrees.value).toBe(45);
    controller.dispose();
  });

  it("keeps the completed incumbent until the final solver result replaces it", async () => {
    const frames = installFakeBrowserRuntime();
    const state = createControllerState();
    const controller = useGraphwarTrajectoryResult(state.options);

    setSolverPath(state, -10, 1);
    await nextTick();
    frames.flush();
    respondToActiveWorker({
      ok: true,
      result: { curvePoints: "formal curve", formulaResult: { expression: "formal formula", terms: [] } },
    });
    await nextTick();
    controller.publishIncumbentPreview("completed incumbent");
    respondToActiveWorker({ ok: true, result: { curvePoints: "incumbent curve" } });
    await nextTick();

    controller.handoffIncumbentPreviewToNextSolverResult();
    setSolverPath(state, -5, 2);
    await nextTick();
    frames.flush();
    expect(controller.formulaResult.value?.expression).toBe("completed incumbent");
    expect(controller.plottedCurvePoints.value).toBe("incumbent curve");

    respondToActiveWorker({
      ok: true,
      result: { curvePoints: "final curve", formulaResult: { expression: "final formula", terms: [] } },
    });
    await nextTick();
    expect(controller.incumbentPreviewActive.value).toBe(false);
    expect(controller.formulaResult.value?.expression).toBe("final formula");
    expect(controller.plottedCurvePoints.value).toBe("final curve");
    controller.dispose();
  });

  it("keeps the completed incumbent when the final solver result fails", async () => {
    const frames = installFakeBrowserRuntime();
    const state = createControllerState();
    const controller = useGraphwarTrajectoryResult(state.options);

    setSolverPath(state, -10, 1);
    await nextTick();
    frames.flush();
    respondToActiveWorker({
      ok: true,
      result: { curvePoints: "formal curve", formulaResult: { expression: "formal formula", terms: [] } },
    });
    await nextTick();
    controller.publishIncumbentPreview("completed incumbent");
    respondToActiveWorker({ ok: true, result: { curvePoints: "incumbent curve" } });
    await nextTick();

    controller.handoffIncumbentPreviewToNextSolverResult();
    setSolverPath(state, -5, 2);
    await nextTick();
    frames.flush();
    respondToActiveWorker({ message: "final simulation failed", ok: false, stage: "trajectory" });
    await nextTick();

    expect(controller.formulaResult.value?.expression).toBe("completed incumbent");
    expect(controller.plottedCurvePoints.value).toBe("incumbent curve");
    expect(controller.calculationStatus.value).toEqual({
      message: "final simulation failed",
      stage: "trajectory",
      type: "failure",
    });
    controller.dispose();
  });
});

class FakeWorker {
  static readonly instances: FakeWorker[] = [];

  readonly requests: GraphwarTrajectoryCalculationWorkerRequest[] = [];
  terminated = false;
  private readonly messageListeners: ((event: MessageEvent<GraphwarTrajectoryCalculationWorkerResponse>) => void)[] =
    [];

  constructor(_url: URL, _options: WorkerOptions) {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    if (type === "message") {
      this.messageListeners.push(
        listener as (event: MessageEvent<GraphwarTrajectoryCalculationWorkerResponse>) => void,
      );
    }
  }

  postMessage(request: GraphwarTrajectoryCalculationWorkerRequest) {
    this.requests.push(request);
  }

  terminate() {
    this.terminated = true;
  }

  respond(outcome: GraphwarTrajectoryCalculationOutcome) {
    const request = this.requests.at(-1);
    if (!request) {
      throw new Error("Worker has no pending request");
    }
    const event = { data: { id: request.id, outcome } } as MessageEvent<GraphwarTrajectoryCalculationWorkerResponse>;
    for (const listener of this.messageListeners) {
      listener(event);
    }
  }
}

function installFakeBrowserRuntime() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextFrameId = 1;
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextFrameId;
    nextFrameId += 1;
    callbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  return {
    flush() {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      for (const [id, callback] of pending) {
        callback(id);
      }
    },
  };
}

function createControllerState() {
  const algorithmMode = ref<"step">("step");
  const boundsRect = ref({ height: 450, width: 770, x: 0, y: 0 });
  const collisionSettingsValid = ref(true);
  const mappedPathPoints = ref([createGraphPoint(-20, 0)]);
  const pathPixels = ref([createPixelPoint(77, 225)]);
  const equationMode = ref<"dy">("dy");
  const options = {
    collisionSettingsValid,
    geometry: {
      boundsRect,
      getBounds: () => ({ maxX: 25, maxY: 15, minX: -25, minY: -15 }),
    },
    getCollisionSettings: () => undefined,
    getTargetHitRadiusPixels: () => 7,
    path: { mappedPathPoints, pathPixels },
    settings: {
      algorithmMode,
      equationMode,
      getStepGlitchObstacleMask: () => undefined,
      isEquationModeDisabled: () => false,
      precisionDecimalPlaces: ref(4),
      precisionValid: ref(true),
      steepness: ref(67),
      steepnessValid: ref(true),
      stepGlitchModeEnabled: ref(false),
      stepOverflowProtectionEnabled: ref(true),
      toolWorkflowMode: ref<"simulator" | "solver">("solver"),
    },
    simulator: {
      formulaText: ref(""),
      launchAngleText: ref(""),
      parseDerivativeAsY: ref(true),
      parseNumber: Number,
      skipUnknownCharacters: ref(true),
    },
  };
  return { collisionSettingsValid, mappedPathPoints, options, pathPixels };
}

function setSolverPath(state: ReturnType<typeof createControllerState>, targetX: number, targetY: number) {
  state.mappedPathPoints.value = [createGraphPoint(-20, 0), createGraphPoint(targetX, targetY)];
  state.pathPixels.value = [createPixelPoint(77, 225), createPixelPoint((targetX + 25) * 15.4, (15 - targetY) * 15)];
}

function respondToActiveWorker(outcome: GraphwarTrajectoryCalculationOutcome) {
  const worker = FakeWorker.instances.findLast((candidate) => candidate.requests.length > 0);
  if (!worker) {
    throw new Error("No active Worker");
  }
  worker.respond(outcome);
}

function countWorkerRequests() {
  return FakeWorker.instances.reduce((total, worker) => total + worker.requests.length, 0);
}
