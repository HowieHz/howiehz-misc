import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import { createGraphPoint } from "../../core/types";
import type {
  GraphwarLiveClickPreviewRenderInput,
  GraphwarLiveClickPreviewRenderResult,
  GraphwarLiveClickPreviewWorkerRequest,
  GraphwarLiveClickPreviewWorkerResponse,
} from "./live-click-preview-render";
import { createGraphwarLiveClickPreviewRunner } from "./live-click-preview-runner";

describe("live click preview runner", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWorker.instances.length = 0;
    FakeWorker.failPostMessage = false;
  });

  it("terminates active workers on cancellation so a new session starts immediately", async () => {
    installFakeWorker();
    const runner = createGraphwarLiveClickPreviewRunner({ workerCount: ref(2) });
    const first = runner.render(createRenderInput(1));
    const second = runner.render(createRenderInput(2));
    const firstCancelled = expect(first).rejects.toThrow("cancelled");
    const secondCancelled = expect(second).rejects.toThrow("cancelled");
    expect(FakeWorker.instances).toHaveLength(2);

    runner.cancel();

    await Promise.all([firstCancelled, secondCancelled]);
    expect(FakeWorker.instances.every((worker) => worker.terminated)).toBe(true);

    const latest = runner.render(createRenderInput(3));
    expect(FakeWorker.instances).toHaveLength(3);
    FakeWorker.instances[2].respond({ curvePoints: "latest curve", elapsedMs: 30 });
    await expect(latest).resolves.toEqual({ curvePoints: "latest curve", elapsedMs: 30 });
    runner.close();
  });

  it("keeps an idle hot worker across cancellation", async () => {
    installFakeWorker();
    const runner = createGraphwarLiveClickPreviewRunner({ workerCount: ref(1) });
    const first = runner.render(createRenderInput(1));
    const worker = FakeWorker.instances[0];
    worker.respond({ curvePoints: "first curve", elapsedMs: 10 });
    await first;

    runner.cancel();
    const second = runner.render(createRenderInput(2));

    expect(FakeWorker.instances).toHaveLength(1);
    expect(worker.terminated).toBe(false);
    expect(worker.requests).toHaveLength(2);
    worker.respond({ curvePoints: "second curve", elapsedMs: 20 });
    await second;
    runner.close();
  });

  it.each([
    { label: "null envelope", response: null },
    {
      label: "wrong request id",
      response: { id: 999, result: { curvePoints: "wrong curve", elapsedMs: 10 }, type: "success" },
    },
  ])("falls back without hanging on $label", async ({ response }) => {
    installFakeWorker();
    const runner = createGraphwarLiveClickPreviewRunner({ workerCount: ref(1) });
    const result = runner.render(createRenderInput(1));
    const worker = FakeWorker.instances[0];

    worker.emitMessage(response);

    await expect(result).resolves.toEqual({ curvePoints: "", elapsedMs: 0 });
    expect(worker.terminated).toBe(true);
    runner.close();
  });

  it("does not recursively retry a queued task when postMessage throws", async () => {
    installFakeWorker();
    const runner = createGraphwarLiveClickPreviewRunner({ workerCount: ref(1) });
    const first = runner.render(createRenderInput(1));
    const second = runner.render(createRenderInput(2));
    const secondFailed = expect(second).rejects.toThrow("postMessage failed");
    const worker = FakeWorker.instances[0];
    FakeWorker.failPostMessage = true;

    expect(() => worker.respond({ curvePoints: "first curve", elapsedMs: 10 })).not.toThrow();

    await expect(first).resolves.toEqual({ curvePoints: "first curve", elapsedMs: 10 });
    await secondFailed;
    expect(FakeWorker.instances).toHaveLength(1);
    expect(worker.terminated).toBe(true);
    runner.close();
  });
});

function installFakeWorker() {
  vi.stubGlobal("Worker", FakeWorker);
}

class FakeWorker {
  static readonly instances: FakeWorker[] = [];
  static failPostMessage = false;

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
    if (FakeWorker.failPostMessage) {
      throw new Error("postMessage failed");
    }
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
    this.emitMessage({ id: request.id, result, type: "success" });
  }

  emitMessage(response: unknown) {
    const event = { data: response } as MessageEvent<GraphwarLiveClickPreviewWorkerResponse>;
    for (const listener of this.messageListeners) {
      listener(event);
    }
  }
}

function createRenderInput(targetY: number): GraphwarLiveClickPreviewRenderInput {
  return {
    bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
    boundsRect: { height: 450, width: 770, x: 0, y: 0 },
    points: [createGraphPoint(-20, 0), createGraphPoint(-10, targetY)],
    settings: {
      algorithm: "step",
      decimalPlaces: 4,
      equation: "y",
      steepness: 67,
      stepGlitchMode: false,
      stepOverflowProtection: true,
    },
    type: "formula",
  };
}
