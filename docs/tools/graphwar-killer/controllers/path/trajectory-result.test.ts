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
        trajectoryPoints: [createPixelPoint(1, 2), createPixelPoint(3, 4)],
        formulaResult: { expression: "first formula", terms: [] },
        pathError: Number.POSITIVE_INFINITY,
        secondOrderLaunchAngleDegrees: 12,
        hasTargetMissWarning: true,
        warningReason: "obstacle",
      },
    });
    await nextTick();

    expect(controller.formulaResult.value?.expression).toBe("first formula");
    expect(controller.plottedCurvePoints.value).toBe("first curve");
    expect(controller.plottedTrajectory.value).toEqual({
      equationMode: "dy",
      expression: "first formula",
      points: [createPixelPoint(1, 2), createPixelPoint(3, 4)],
      sourceIdentity: "agent-scene-1",
    });
    expect(controller.secondOrderLaunchAngleDegrees.value).toBe(12);
    expect(controller.pathError.value).toBe(Number.POSITIVE_INFINITY);
    expect(controller.hasTargetMissWarning.value).toBe(true);
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
    expect(controller.secondOrderLaunchAngleRadians.value).toBeUndefined();
    expect(controller.pathError.value).toBeUndefined();
    expect(controller.hasTargetMissWarning.value).toBe(false);
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
        trajectoryPoints: [],
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

  it("recalculates an unchanged formula input when its authoritative scene identity changes", async () => {
    const frames = installFakeBrowserRuntime();
    const state = createControllerState();
    const controller = useGraphwarTrajectoryResult(state.options);

    setSolverPath(state, -10, 0);
    await nextTick();
    frames.flush();
    respondToActiveWorker({
      ok: true,
      result: {
        curvePoints: "first scene curve",
        formulaResult: { expression: "same formula", terms: [] },
        trajectoryPoints: [createPixelPoint(1, 2), createPixelPoint(3, 4)],
      },
    });
    await nextTick();
    expect(controller.plottedTrajectory.value?.sourceIdentity).toBe("agent-scene-1");

    state.sourceIdentity.value = "agent-scene-2";
    await nextTick();
    expect(controller.calculationStatus.value.type).toBe("in-progress");
    expect(controller.plottedTrajectory.value?.sourceIdentity).toBe("agent-scene-1");
    frames.flush();
    respondToActiveWorker({
      ok: true,
      result: {
        curvePoints: "second scene curve",
        formulaResult: { expression: "same formula", terms: [] },
        trajectoryPoints: [createPixelPoint(5, 6), createPixelPoint(7, 8)],
      },
    });
    await nextTick();
    expect(controller.plottedTrajectory.value).toMatchObject({
      points: [createPixelPoint(5, 6), createPixelPoint(7, 8)],
      sourceIdentity: "agent-scene-2",
    });
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
        trajectoryPoints: [],
        formulaResult: { expression: "latest formula", terms: [] },
      },
    });
    await nextTick();
    controller.dispose();
  });

  it("invalidates a y'' result when the effective launch-angle execution mode changes", async () => {
    const frames = installFakeBrowserRuntime();
    const state = createControllerState();
    state.options.settings.equationMode.value = "ddy";
    const controller = useGraphwarTrajectoryResult(state.options);

    setSolverPath(state, -10, 1);
    await nextTick();
    frames.flush();
    let request = FakeWorker.instances.findLast((worker) => worker.requests.length > 0)?.requests.at(-1);
    expect(request?.input.type === "solver" && request.input.settings.secondOrderLaunchAngleMode).toBe(
      "full-precision",
    );
    respondToActiveWorker({
      ok: true,
      result: {
        curvePoints: "full curve",
        trajectoryPoints: [],
        formulaResult: { expression: "full formula", terms: [] },
        secondOrderLaunchAngleDegrees: 7.073552961289569,
        secondOrderLaunchAngleRadians: 0.12345678901234568,
      },
    });
    await nextTick();
    expect(controller.secondOrderLaunchAngleRadians.value).toBe(0.12345678901234568);
    expect(controller.plottedTrajectory.value?.launchAngleRadians).toBe(0.12345678901234568);

    state.secondOrderLaunchAngleMode.value = "display-rounded";
    await nextTick();
    expect(controller.formulaResult.value?.expression).toBe("full formula");
    expect(controller.secondOrderLaunchAngleRadians.value).toBeUndefined();
    frames.flush();
    request = FakeWorker.instances.findLast((worker) => worker.requests.length > 0)?.requests.at(-1);
    expect(request?.input.type === "solver" && request.input.settings.secondOrderLaunchAngleMode).toBe(
      "display-rounded",
    );
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
        trajectoryPoints: [],
        formulaResult: { expression: "solver formula", terms: [] },
        secondOrderLaunchAngleDegrees: 12,
      },
    });
    await nextTick();

    state.options.simulator.formulaText.value = "solver formula";
    state.options.settings.equationMode.value = "ddy";
    state.options.settings.toolWorkflowMode.value = "simulator";
    await nextTick();
    frames.flush();
    respondToActiveWorker({
      ok: true,
      result: { curvePoints: "simulator curve", trajectoryPoints: [] },
    });
    await nextTick();

    expect(controller.formulaResult.value?.expression).toBe("solver formula");
    expect(controller.formulaResultEquationMode.value).toBe("dy");
    expect(controller.secondOrderLaunchAngleDegrees.value).toBe(12);
    expect(controller.plottedCurvePoints.value).toBe("simulator curve");
    expect(controller.plottedTrajectory.value?.equationMode).toBe("ddy");
    expect(controller.plottedTrajectory.value?.expression).toBe("solver formula");

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
        trajectoryPoints: [],
        formulaResult: { expression: "formula", terms: [] },
      },
    });
    await nextTick();

    state.isCollisionSettingsValid.value = false;
    await nextTick();

    expect(controller.calculationStatus.value.type).toBe("idle");
    expect(controller.formulaResult.value).toBeUndefined();
    expect(controller.plottedCurvePoints.value).toBe("");
    controller.dispose();
  });

  it("keeps the formal calculation running underneath a validated incumbent preview", async () => {
    const frames = installFakeBrowserRuntime();
    const state = createControllerState();
    const controller = useGraphwarTrajectoryResult(state.options);

    setSolverPath(state, -10, 1);
    await nextTick();
    frames.flush();
    const requestCount = countWorkerRequests();
    controller.publishIncumbentPreview({
      equationMode: "dy",
      expression: "incumbent",
      sourceIdentity: "agent-scene-1",
      trajectoryPoints: [createPixelPoint(1, 2), createPixelPoint(3, 4)],
    });

    expect(countWorkerRequests()).toBe(requestCount);
    respondToActiveWorker({
      ok: true,
      result: {
        curvePoints: "formal curve",
        formulaResult: { expression: "formal formula", terms: [] },
        trajectoryPoints: [createPixelPoint(5, 6), createPixelPoint(7, 8)],
      },
    });
    await nextTick();
    expect(controller.formulaResult.value?.expression).toBe("incumbent");
    expect(controller.plottedCurvePoints.value).toBe("1.00,2.00 3.00,4.00");

    controller.clearIncumbentPreview();
    expect(controller.formulaResult.value?.expression).toBe("formal formula");
    expect(controller.plottedCurvePoints.value).toBe("formal curve");
    controller.dispose();
  });

  it("publishes and commits validated incumbent snapshots without Worker requests", async () => {
    const frames = installFakeBrowserRuntime();
    const state = createControllerState();
    state.options.settings.equationMode.value = "ddy";
    const controller = useGraphwarTrajectoryResult(state.options);

    setSolverPath(state, -10, 1);
    await nextTick();
    frames.flush();
    respondToActiveWorker({
      ok: true,
      result: {
        curvePoints: "formal curve",
        trajectoryPoints: [],
        formulaResult: { expression: "formal formula", terms: [] },
        pathError: Number.POSITIVE_INFINITY,
        hasTargetMissWarning: true,
        warningReason: "obstacle",
      },
    });
    await nextTick();

    const requestCount = countWorkerRequests();
    controller.publishIncumbentPreview({
      equationMode: "ddy",
      expression: "first incumbent",
      sourceIdentity: "agent-scene-1",
      trajectoryPoints: [createPixelPoint(1, 2), createPixelPoint(3, 4)],
    });
    controller.publishIncumbentPreview({
      equationMode: "ddy",
      expression: "latest incumbent",
      launchAngleRadians: Math.PI / 4,
      sourceIdentity: "agent-scene-1",
      trajectoryPoints: [createPixelPoint(5, 6), createPixelPoint(7, 8)],
    });

    expect(controller.isIncumbentPreviewActive.value).toBe(true);
    expect(controller.formulaResult.value?.expression).toBe("latest incumbent");
    expect(controller.plottedCurvePoints.value).toBe("5.00,6.00 7.00,8.00");
    expect(controller.plottedTrajectory.value?.points).toEqual([createPixelPoint(5, 6), createPixelPoint(7, 8)]);
    expect(controller.secondOrderLaunchAngleDegrees.value).toBe(45);
    expect(controller.secondOrderLaunchAngleRadians.value).toBe(Math.PI / 4);
    expect(controller.pathError.value).toBeUndefined();
    expect(controller.hasTargetMissWarning.value).toBe(false);
    expect(controller.trajectoryWarningReason.value).toBeUndefined();
    expect(countWorkerRequests()).toBe(requestCount);

    controller.clearIncumbentPreview();
    expect(controller.isIncumbentPreviewActive.value).toBe(false);
    expect(controller.formulaResult.value?.expression).toBe("formal formula");
    expect(controller.plottedCurvePoints.value).toBe("formal curve");
    expect(controller.pathError.value).toBe(Number.POSITIVE_INFINITY);
    expect(controller.hasTargetMissWarning.value).toBe(true);
    expect(controller.trajectoryWarningReason.value).toBe("obstacle");

    const committedTrajectory = [createPixelPoint(9, 10), createPixelPoint(11, 12)];
    controller.publishIncumbentPreview({
      equationMode: "ddy",
      expression: "committed incumbent",
      sourceIdentity: "agent-scene-1",
      trajectoryPoints: committedTrajectory,
    });
    expect(
      controller.commitIncumbentPreview({
        equationMode: "ddy",
        expression: "stale incumbent",
        sourceIdentity: "agent-scene-1",
        trajectoryPoints: [],
      }),
    ).toBe(false);
    expect(
      controller.commitIncumbentPreview({
        equationMode: "ddy",
        expression: "committed incumbent",
        sourceIdentity: "agent-scene-2",
        trajectoryPoints: committedTrajectory,
      }),
    ).toBe(false);
    expect(
      controller.commitIncumbentPreview({
        equationMode: "ddy",
        expression: "committed incumbent",
        sourceIdentity: "agent-scene-1",
        trajectoryPoints: [...committedTrajectory],
      }),
    ).toBe(false);
    expect(
      controller.commitIncumbentPreview({
        equationMode: "ddy",
        expression: "committed incumbent",
        sourceIdentity: "agent-scene-1",
        trajectoryPoints: committedTrajectory,
      }),
    ).toBe(true);

    expect(controller.isIncumbentPreviewActive.value).toBe(false);
    expect(controller.formulaResult.value?.expression).toBe("committed incumbent");
    expect(controller.plottedCurvePoints.value).toBe("9.00,10.00 11.00,12.00");

    controller.commitIncumbentResult({
      equationMode: "ddy",
      expression: "direct incumbent",
      launchAngleRadians: Math.PI / 2,
      sourceIdentity: "agent-scene-1",
      trajectoryPoints: [createPixelPoint(13, 14), createPixelPoint(15, 16)],
    });
    const committedRequestCount = countWorkerRequests();
    setSolverPath(state, -5, 2);
    await nextTick();
    frames.flush();
    expect(controller.calculationStatus.value.type).toBe("idle");
    expect(countWorkerRequests()).toBe(committedRequestCount);
    expect(controller.formulaResult.value?.expression).toBe("direct incumbent");
    expect(controller.plottedCurvePoints.value).toBe("13.00,14.00 15.00,16.00");
    expect(controller.secondOrderLaunchAngleDegrees.value).toBe(90);
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
  const isCollisionSettingsValid = ref(true);
  const mappedPathPoints = ref([createGraphPoint(-20, 0)]);
  const pathPixels = ref([createPixelPoint(77, 225)]);
  const equationMode = ref<"ddy" | "dy">("dy");
  const secondOrderLaunchAngleMode = ref<"display-rounded" | "full-precision">("full-precision");
  const sourceIdentity = ref<string | undefined>("agent-scene-1");
  const options = {
    isCollisionSettingsValid,
    geometry: {
      boundsRect,
      getBounds: () => ({ maxX: 25, maxY: 15, minX: -25, minY: -15 }),
    },
    getCollisionSettings: () => undefined,
    getTargetHitRadiusPixels: () => 7,
    sourceIdentity,
    path: { mappedPathPoints, pathPixels },
    settings: {
      algorithmMode,
      equationMode,
      secondOrderLaunchAngleMode,
      getStepGlitchObstacleMask: () => undefined,
      isEquationModeEnabled: () => true,
      precisionDecimalPlaces: ref(4),
      isPrecisionValid: ref(true),
      steepness: ref(67),
      isSteepnessValid: ref(true),
      isStepGlitchModeEnabled: ref(false),
      isStepOverflowProtectionEnabled: ref(true),
      toolWorkflowMode: ref<"simulator" | "solver">("solver"),
    },
    simulator: {
      formulaText: ref(""),
      launchAngleText: ref(""),
      shouldParseDerivativeAsY: ref(true),
      parseNumber: Number,
      shouldSkipUnknownCharacters: ref(true),
    },
  };
  return {
    isCollisionSettingsValid,
    mappedPathPoints,
    options,
    pathPixels,
    secondOrderLaunchAngleMode,
    sourceIdentity,
  };
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
