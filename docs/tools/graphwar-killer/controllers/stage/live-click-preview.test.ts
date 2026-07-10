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

  it("stays in progress until the latest concurrent render completes", async () => {
    installFakeBrowserRuntime();
    const controller = useGraphwarLiveClickPreview(createOptions());
    controller.enabled.value = true;

    controller.setPointerPoint(createPixelPoint(200, 180), undefined);
    await nextTick();

    expect(controller.inProgress.value).toBe(true);
    expect(controller.curvePoints.value).toBe("");
    expect(controller.renderedElapsedMs.value).toBeUndefined();
    expect(FakeWorker.instances).toHaveLength(1);

    controller.setPointerPoint(createPixelPoint(220, 160), undefined);
    await nextTick();

    expect(FakeWorker.instances).toHaveLength(2);
    FakeWorker.instances[0].respond({ curvePoints: "older curve", elapsedMs: 10 });
    await nextTick();

    expect(controller.inProgress.value).toBe(true);
    expect(controller.curvePoints.value).toBe("");
    expect(controller.renderedElapsedMs.value).toBeUndefined();

    FakeWorker.instances[1].respond({ curvePoints: "latest curve", elapsedMs: 20 });
    await nextTick();

    expect(controller.inProgress.value).toBe(false);
    expect(controller.curvePoints.value).toBe("latest curve");
    expect(controller.renderedElapsedMs.value).toBe(20);
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
    expect(controller.renderedElapsedMs.value).toBeUndefined();
    expect(worker.terminated).toBe(true);
  });
});

function installFakeBrowserRuntime() {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("window", globalThis);
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
