import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

import { createGraphPoint, createPixelPoint } from "../../core/types";
import { useGraphwarLiveClickPreview } from "./live-click-preview";
import type {
  GraphwarLiveClickPreviewRenderResult,
  GraphwarLiveClickPreviewWorkerRequest,
  GraphwarLiveClickPreviewWorkerResponse,
} from "./live-click-preview-render";

describe("live click preview status", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeWorker.instances.length = 0;
  });

  it("publishes a stale curve with its point while the latest render stays in progress", async () => {
    installFakeBrowserRuntime();
    const controller = useGraphwarLiveClickPreview(createOptions());
    controller.enabled.value = true;
    const olderPoint = createPixelPoint(200, 180);
    const latestPoint = createPixelPoint(220, 160);

    controller.setPointerPoint(olderPoint, undefined);
    await nextTick();

    expect(controller.inProgress.value).toBe(true);
    expect(controller.curvePoints.value).toBe("");
    expect(controller.renderedElapsedMs.value).toBeUndefined();
    expect(FakeWorker.instances).toHaveLength(1);

    controller.setPointerPoint(latestPoint, undefined);
    await nextTick();

    expect(FakeWorker.instances).toHaveLength(2);
    FakeWorker.instances[0].respond({ curvePoints: "older curve", elapsedMs: 10 });
    await nextTick();

    expect(controller.inProgress.value).toBe(true);
    expect(controller.curvePoints.value).toBe("older curve");
    expect(controller.points.value).toEqual([olderPoint, latestPoint]);
    expect(controller.renderedElapsedMs.value).toBeUndefined();

    FakeWorker.instances[1].respond({ curvePoints: "latest curve", elapsedMs: 20 });
    await nextTick();

    expect(controller.inProgress.value).toBe(false);
    expect(controller.curvePoints.value).toBe("latest curve");
    expect(controller.points.value).toEqual([latestPoint]);
    expect(controller.renderedElapsedMs.value).toBe(20);
    controller.dispose();
  });

  it("shows the completed curve point immediately after the mouse moves", async () => {
    installFakeBrowserRuntime();
    const controller = useGraphwarLiveClickPreview(createOptions());
    controller.enabled.value = true;
    const renderedPoint = createPixelPoint(200, 180);
    const currentPoint = createPixelPoint(220, 160);
    controller.setPointerPoint(renderedPoint, undefined);
    await nextTick();
    FakeWorker.instances[0].respond({ curvePoints: "rendered curve", elapsedMs: 10 });
    await nextTick();

    controller.setPointerPoint(currentPoint, undefined);
    await nextTick();

    expect(controller.inProgress.value).toBe(true);
    expect(controller.curvePoints.value).toBe("rendered curve");
    expect(controller.points.value).toEqual([renderedPoint, currentPoint]);
    controller.dispose();
  });

  it("keeps the warning when pointer intent is newer than the point committed by the next frame", async () => {
    const frames = installFakeBrowserRuntime();
    const controller = useGraphwarLiveClickPreview(createOptions());
    controller.enabled.value = true;
    const renderedPoint = createPixelPoint(200, 180);
    const pendingPoint = createPixelPoint(220, 160);
    controller.setPointerPoint(renderedPoint, undefined);
    await nextTick();

    controller.schedulePointerPoint(pendingPoint, undefined);
    FakeWorker.instances[0].respond({ curvePoints: "stale curve", elapsedMs: 10 });
    await nextTick();

    expect(controller.inProgress.value).toBe(true);
    expect(controller.curvePoints.value).toBe("stale curve");
    expect(controller.points.value).toEqual([renderedPoint]);
    expect(controller.renderedElapsedMs.value).toBeUndefined();

    frames.flush();
    await nextTick();
    expect(controller.inProgress.value).toBe(true);
    expect(controller.points.value).toEqual([renderedPoint, pendingPoint]);

    FakeWorker.instances[0].respond({ curvePoints: "latest curve", elapsedMs: 20 });
    await nextTick();
    expect(controller.inProgress.value).toBe(false);
    expect(controller.points.value).toEqual([pendingPoint]);
    expect(controller.renderedElapsedMs.value).toBe(20);
    controller.dispose();
  });

  it("ignores an error for the committed point while a newer pointer frame is pending", async () => {
    const frames = installFakeBrowserRuntime();
    const controller = useGraphwarLiveClickPreview(createOptions());
    controller.enabled.value = true;
    const committedPoint = createPixelPoint(200, 180);
    const pendingPoint = createPixelPoint(220, 160);
    controller.setPointerPoint(committedPoint, undefined);
    await nextTick();

    controller.schedulePointerPoint(pendingPoint, undefined);
    FakeWorker.instances[0].fail("stale render failed");
    await nextTick();

    expect(controller.inProgress.value).toBe(true);
    expect(controller.curvePoints.value).toBe("");
    expect(controller.points.value).toEqual([committedPoint]);
    expect(controller.renderedElapsedMs.value).toBeUndefined();

    frames.flush();
    await nextTick();
    FakeWorker.instances[0].respond({ curvePoints: "latest curve", elapsedMs: 20 });
    await nextTick();
    expect(controller.inProgress.value).toBe(false);
    expect(controller.points.value).toEqual([pendingPoint]);
    controller.dispose();
  });

  it("does not bind a pending pointer intent to a new-context request for the committed point", async () => {
    const frames = installFakeBrowserRuntime();
    const options = createOptions();
    const controller = useGraphwarLiveClickPreview(options);
    controller.enabled.value = true;
    const committedPoint = createPixelPoint(200, 180);
    const pendingPoint = createPixelPoint(220, 160);
    controller.setPointerPoint(committedPoint, undefined);
    await nextTick();

    controller.schedulePointerPoint(pendingPoint, undefined);
    options.trajectory.formulaSettings.value = {
      ...options.trajectory.formulaSettings.value,
      decimalPlaces: 5,
    };
    await nextTick();
    const committedPointWorker = FakeWorker.instances[FakeWorker.instances.length - 1];

    frames.flush();
    await nextTick();
    committedPointWorker.respond({ curvePoints: "committed curve", elapsedMs: 10 });
    await nextTick();

    expect(controller.inProgress.value).toBe(true);
    expect(controller.curvePoints.value).toBe("committed curve");
    expect(controller.points.value).toEqual([committedPoint, pendingPoint]);
    expect(controller.renderedElapsedMs.value).toBeUndefined();

    FakeWorker.instances[FakeWorker.instances.length - 1].respond({
      curvePoints: "latest curve",
      elapsedMs: 20,
    });
    await nextTick();
    expect(controller.inProgress.value).toBe(false);
    expect(controller.points.value).toEqual([pendingPoint]);
    expect(controller.renderedElapsedMs.value).toBe(20);
    controller.dispose();
  });

  it("does not duplicate the rendered point when the current control point has the same coordinates", async () => {
    installFakeBrowserRuntime();
    const controller = useGraphwarLiveClickPreview(createOptions());
    controller.enabled.value = true;
    const point = createPixelPoint(200, 180);
    controller.setPointerPoint(point, undefined);
    await nextTick();
    FakeWorker.instances[0].respond({ curvePoints: "rendered curve", elapsedMs: 10 });
    await nextTick();

    const equivalentPoint = createPixelPoint(point.x, point.y);
    controller.setPointerPoint(equivalentPoint, undefined);
    await nextTick();

    expect(controller.inProgress.value).toBe(true);
    expect(controller.curvePoints.value).toBe("rendered curve");
    expect(controller.points.value).toEqual([equivalentPoint]);
    controller.dispose();
  });

  it("never rolls back from a newer stale result to an older result", async () => {
    installFakeBrowserRuntime();
    const controller = useGraphwarLiveClickPreview(createOptions());
    controller.enabled.value = true;
    const firstPoint = createPixelPoint(180, 200);
    const secondPoint = createPixelPoint(200, 180);
    const latestPoint = createPixelPoint(220, 160);

    controller.setPointerPoint(firstPoint, undefined);
    await nextTick();
    controller.setPointerPoint(secondPoint, undefined);
    await nextTick();
    controller.setPointerPoint(latestPoint, undefined);
    await nextTick();

    FakeWorker.instances[1].respond({ curvePoints: "second curve", elapsedMs: 20 });
    await nextTick();
    expect(controller.curvePoints.value).toBe("second curve");
    expect(controller.points.value).toEqual([secondPoint, latestPoint]);
    expect(controller.inProgress.value).toBe(true);

    FakeWorker.instances[0].respond({ curvePoints: "first curve", elapsedMs: 10 });
    await nextTick();
    expect(controller.curvePoints.value).toBe("second curve");
    expect(controller.points.value).toEqual([secondPoint, latestPoint]);

    FakeWorker.instances[1].respond({ curvePoints: "latest curve", elapsedMs: 30 });
    await nextTick();
    expect(controller.curvePoints.value).toBe("latest curve");
    expect(controller.points.value).toEqual([latestPoint]);
    expect(controller.inProgress.value).toBe(false);
    controller.dispose();
  });

  it("clears the displayed snapshot and rejects old results when the calculation context changes", async () => {
    installFakeBrowserRuntime();
    const options = createOptions();
    const controller = useGraphwarLiveClickPreview(options);
    controller.enabled.value = true;
    const firstPoint = createPixelPoint(200, 180);
    const currentPoint = createPixelPoint(220, 160);
    controller.setPointerPoint(firstPoint, undefined);
    await nextTick();
    FakeWorker.instances[0].respond({ curvePoints: "first curve", elapsedMs: 10 });
    await nextTick();

    controller.setPointerPoint(currentPoint, undefined);
    await nextTick();
    options.trajectory.formulaSettings.value = {
      ...options.trajectory.formulaSettings.value,
      decimalPlaces: 5,
    };
    await nextTick();

    expect(controller.curvePoints.value).toBe("");
    expect(controller.points.value).toEqual([currentPoint]);
    expect(controller.renderedElapsedMs.value).toBeUndefined();
    expect(controller.inProgress.value).toBe(true);

    FakeWorker.instances[0].respond({ curvePoints: "old context curve", elapsedMs: 20 });
    await nextTick();
    expect(controller.curvePoints.value).toBe("");
    expect(controller.points.value).toEqual([currentPoint]);

    FakeWorker.instances[1].respond({ curvePoints: "new context curve", elapsedMs: 30 });
    await nextTick();
    expect(controller.curvePoints.value).toBe("new context curve");
    expect(controller.points.value).toEqual([currentPoint]);
    expect(controller.inProgress.value).toBe(false);
    controller.dispose();
  });

  it("clears a stale curve and point when the latest render fails", async () => {
    installFakeBrowserRuntime();
    const controller = useGraphwarLiveClickPreview(createOptions());
    controller.enabled.value = true;
    const renderedPoint = createPixelPoint(200, 180);
    const currentPoint = createPixelPoint(220, 160);
    controller.setPointerPoint(renderedPoint, undefined);
    await nextTick();
    FakeWorker.instances[0].respond({ curvePoints: "rendered curve", elapsedMs: 10 });
    await nextTick();

    controller.setPointerPoint(currentPoint, undefined);
    await nextTick();
    FakeWorker.instances[0].fail("render failed");
    await Promise.resolve();
    await nextTick();

    expect(controller.inProgress.value).toBe(false);
    expect(controller.curvePoints.value).toBe("");
    expect(controller.points.value).toEqual([currentPoint]);
    expect(controller.renderedElapsedMs.value).toBeUndefined();
    controller.dispose();
  });

  it("clears a stale curve and elapsed status when the latest render is empty", async () => {
    installFakeBrowserRuntime();
    const controller = useGraphwarLiveClickPreview(createOptions());
    controller.enabled.value = true;
    const renderedPoint = createPixelPoint(200, 180);
    const currentPoint = createPixelPoint(220, 160);
    controller.setPointerPoint(renderedPoint, undefined);
    await nextTick();
    FakeWorker.instances[0].respond({ curvePoints: "rendered curve", elapsedMs: 10 });
    await nextTick();

    controller.setPointerPoint(currentPoint, undefined);
    await nextTick();
    FakeWorker.instances[0].respond({ curvePoints: "", elapsedMs: 20 });
    await nextTick();

    expect(controller.inProgress.value).toBe(false);
    expect(controller.curvePoints.value).toBe("");
    expect(controller.points.value).toEqual([currentPoint]);
    expect(controller.renderedElapsedMs.value).toBeUndefined();
    controller.dispose();
  });

  it("does not build the render context without an active preview point", async () => {
    installFakeBrowserRuntime();
    const options = createOptions();
    const getCollisionSettings = vi.fn(() => undefined);
    options.trajectory.getCollisionSettings = getCollisionSettings;
    const controller = useGraphwarLiveClickPreview(options);
    await nextTick();

    options.trajectory.formulaSettings.value = {
      ...options.trajectory.formulaSettings.value,
      decimalPlaces: 5,
    };
    await nextTick();

    expect(getCollisionSettings).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("does not publish a resolved render after the pointer preview is cleared", async () => {
    installFakeBrowserRuntime();
    const controller = useGraphwarLiveClickPreview(createOptions());
    controller.enabled.value = true;
    controller.setPointerPoint(createPixelPoint(200, 180), undefined);
    await nextTick();

    FakeWorker.instances[0].respond({ curvePoints: "stale curve", elapsedMs: 10 });
    controller.clearPointerPoint();
    await nextTick();

    expect(controller.inProgress.value).toBe(false);
    expect(controller.curvePoints.value).toBe("");
    expect(controller.points.value).toEqual([]);
    expect(controller.renderedElapsedMs.value).toBeUndefined();
    controller.dispose();
  });

  it("does not publish a resolved render after disposal", async () => {
    installFakeBrowserRuntime();
    const controller = useGraphwarLiveClickPreview(createOptions());
    controller.enabled.value = true;
    controller.setPointerPoint(createPixelPoint(200, 180), undefined);
    await nextTick();

    const worker = FakeWorker.instances[0];
    worker.respond({ curvePoints: "stale curve", elapsedMs: 10 });
    controller.dispose();
    await nextTick();

    expect(controller.inProgress.value).toBe(false);
    expect(controller.curvePoints.value).toBe("");
    expect(controller.points.value).toEqual([]);
    expect(controller.renderedElapsedMs.value).toBeUndefined();
    expect(worker.terminated).toBe(true);
  });
});

function installFakeBrowserRuntime() {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("window", globalThis);
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextFrameId = 1;
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

class FakeWorker {
  static readonly instances: FakeWorker[] = [];

  readonly requests: GraphwarLiveClickPreviewWorkerRequest[] = [];
  terminated = false;
  private readonly messageListeners: ((event: MessageEvent<GraphwarLiveClickPreviewWorkerResponse>) => void)[] = [];

  constructor(_url: URL, _options: WorkerOptions) {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    if (type === "message") {
      this.messageListeners.push(listener as (event: MessageEvent<GraphwarLiveClickPreviewWorkerResponse>) => void);
    }
  }

  postMessage(request: GraphwarLiveClickPreviewWorkerRequest) {
    this.requests.push(request);
  }

  terminate() {
    this.terminated = true;
  }

  respond(result: GraphwarLiveClickPreviewRenderResult) {
    const request = this.requests.at(-1);
    if (!request) {
      throw new Error("Worker has no pending request");
    }
    const event = {
      data: { id: request.id, result, type: "success" },
    } as MessageEvent<GraphwarLiveClickPreviewWorkerResponse>;
    for (const listener of this.messageListeners) {
      listener(event);
    }
  }

  fail(message: string) {
    const request = this.requests.at(-1);
    if (!request) {
      throw new Error("Worker has no pending request");
    }
    const event = {
      data: { id: request.id, message, type: "error" },
    } as MessageEvent<GraphwarLiveClickPreviewWorkerResponse>;
    for (const listener of this.messageListeners) {
      listener(event);
    }
  }
}

function createOptions() {
  const boundsRect = ref({ height: 450, width: 770, x: 0, y: 0 });
  return {
    geometry: {
      boundsRect,
      getBounds: () => ({ maxX: 25, maxY: 15, minX: -25, minY: -15 }),
    },
    getSelfLabel: () => "self",
    interaction: {
      draggingPathPointIndex: ref<number>(),
      getPathPointIndexAtPoint: () => undefined,
      smartPathfindingInProgress: ref(false),
      toolMode: ref<"path">("path"),
    },
    path: {
      createLineSegments: () => [],
      mappedPathPoints: ref([createGraphPoint(-20, 0)]),
      pathPixels: ref([createPixelPoint(77, 225)]),
    },
    runtime: {
      workerCount: ref(2),
    },
    settings: {
      algorithmMode: ref<"step">("step"),
      effectiveSmartPathfindingEnabled: ref(false),
      equationMode: ref<"y">("y"),
      isEquationModeDisabled: () => false,
      precisionValid: ref(true),
      steepnessValid: ref(true),
      toolWorkflowMode: ref<"solver">("solver"),
    },
    simulator: {
      formulaText: ref(""),
      launchAngleRadians: ref<number>(),
      parseDerivativeAsY: ref(true),
      skipUnknownCharacters: ref(true),
    },
    target: {
      createMinimumForwardTargetPoint: (point: ReturnType<typeof createPixelPoint>) => point,
      createSearchStartSoldierAimPoint: () => undefined,
      createSmartPathfindingSoldierTarget: () => undefined,
      getDetectedSoldierAtPoint: () => undefined,
      getDetectionBoxCenter: () => createPixelPoint(0, 0),
      smartCursorEnabled: ref(false),
    },
    trajectory: {
      formulaSettings: ref({
        algorithm: "step" as const,
        decimalPlaces: 4,
        equation: "y" as const,
        steepness: 67,
        stepGlitchMode: false,
        stepOverflowProtection: true,
      }),
      getCollisionSettings: () => undefined,
    },
  };
}
