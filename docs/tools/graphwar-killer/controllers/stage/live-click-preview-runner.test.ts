import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import {
  createGraphwarTypescriptWorkerBackendConfiguration,
  createGraphwarWasmWorkerBackendConfiguration,
  isGraphwarBackendControlMessage,
  type GraphwarBackendControlMessage,
  type GraphwarWorkerBackendConfiguration,
  type GraphwarWorkerBackendSelection,
} from "../../core/algorithm-backend";
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
    FakeWorker.wasmBackendInitializationFailures = 0;
  });

  it("terminates active workers on cancellation so a new session starts immediately", async () => {
    installFakeWorker();
    const runner = createGraphwarLiveClickPreviewRunner({ workerCount: ref(2) });
    const first = runner.render(createRenderInput(1));
    const second = runner.render(createRenderInput(2));
    const firstCancelled = expect(first).rejects.toThrow("cancelled");
    const secondCancelled = expect(second).rejects.toThrow("cancelled");
    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances.every((worker) => worker.controlMessages.length === 1)).toBe(true);
    expect(FakeWorker.instances[0].requests[0].attempt).toEqual({
      attemptId: 1,
      backendGeneration: 0,
      outerTaskId: 1,
    });

    runner.cancel();

    await Promise.all([firstCancelled, secondCancelled]);
    expect(FakeWorker.instances.every((worker) => worker.terminated)).toBe(true);

    const latest = runner.render(createRenderInput(3));
    expect(FakeWorker.instances).toHaveLength(3);
    FakeWorker.instances[2].respond({ curvePoints: "latest curve", elapsedMs: 30 });
    await expect(latest).resolves.toEqual({ curvePoints: "latest curve", elapsedMs: 30 });
    runner.close();
  });

  it.each(["cancel", "close"] as const)(
    "%s immediately settles a preview waiting for backend selection",
    async (action) => {
      installFakeWorker();
      const deferred = createDeferredBackendSelection(4);
      const runner = createGraphwarLiveClickPreviewRunner({
        createBackendSelection: () => deferred.selection,
        workerCount: ref(1),
      });
      const result = runner.render(createRenderInput(1));

      runner[action]();

      await expect(result).rejects.toSatisfy((error: unknown) => error instanceof Error);
      deferred.resolve(createGraphwarTypescriptWorkerBackendConfiguration(4));
      await Promise.resolve();
      expect(FakeWorker.instances).toHaveLength(0);
      runner.close();
    },
  );

  it("rejects backend selection failure without creating a Worker", async () => {
    installFakeWorker();
    const deferred = createDeferredBackendSelection(4);
    const runner = createGraphwarLiveClickPreviewRunner({
      createBackendSelection: () => deferred.selection,
      workerCount: ref(1),
    });
    const result = runner.render(createRenderInput(1));

    deferred.reject(new Error("selection failed"));

    await expect(result).rejects.toThrow("selection failed");
    expect(FakeWorker.instances).toHaveLength(0);
    runner.close();
  });

  it("keeps only the latest preview admission while backend selection is loading", async () => {
    installFakeWorker();
    const selections = [createDeferredBackendSelection(4), createDeferredBackendSelection(4)];
    let selectionIndex = 0;
    const runner = createGraphwarLiveClickPreviewRunner({
      createBackendSelection: () => selections[selectionIndex++].selection,
      workerCount: ref(1),
    });
    const first = runner.render(createRenderInput(1));
    const firstCancelled = first.catch((error: unknown) => error);
    const latest = runner.render(createRenderInput(2));

    selections[0].resolve(createGraphwarTypescriptWorkerBackendConfiguration(4));
    await Promise.resolve();
    expect(FakeWorker.instances).toHaveLength(0);
    await expect(firstCancelled).resolves.toSatisfy((error: unknown) => error instanceof Error);

    selections[1].resolve(createGraphwarTypescriptWorkerBackendConfiguration(4));
    await Promise.resolve();
    expect(FakeWorker.instances).toHaveLength(1);
    const request = FakeWorker.instances[0].requests[0];
    expect(request.input.type === "formula" && request.input.points.at(-1)?.y).toBe(2);
    FakeWorker.instances[0].respond({ curvePoints: "latest curve", elapsedMs: 20 });
    await expect(latest).resolves.toEqual({ curvePoints: "latest curve", elapsedMs: 20 });
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

  it.each<{
    createResponse: (request: GraphwarLiveClickPreviewWorkerRequest) => unknown;
    label: string;
  }>([
    {
      createResponse: (request) => ({
        attempt: request.attempt,
        id: 999,
        result: { curvePoints: "wrong curve", elapsedMs: 10 },
        type: "success",
      }),
      label: "wrong request id",
    },
    {
      createResponse: (request) => ({
        attempt: { ...request.attempt, outerTaskId: request.attempt.outerTaskId + 1 },
        id: request.id,
        result: { curvePoints: "wrong curve", elapsedMs: 10 },
        type: "success",
      }),
      label: "wrong backend attempt",
    },
  ])("falls back without hanging on $label", async ({ createResponse }) => {
    installFakeWorker();
    const runner = createGraphwarLiveClickPreviewRunner({ workerCount: ref(1) });
    const result = runner.render(createRenderInput(1));
    const worker = FakeWorker.instances[0];

    worker.emitMessage(createResponse(worker.requests[0]));

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

  it("preserves the manual Y'' display-angle mode in the Worker snapshot", async () => {
    installFakeWorker();
    const runner = createGraphwarLiveClickPreviewRunner({ workerCount: ref(1) });
    const input = createRenderInput(1);
    if (input.type !== "formula") {
      throw new Error("Expected formula render input");
    }
    input.settings = {
      ...input.settings,
      equation: "ddy",
      secondOrderLaunchAngleMode: "display-rounded",
    };

    const result = runner.render(input);
    const worker = FakeWorker.instances[0];
    if (!worker) {
      throw new Error("Expected live preview Worker");
    }
    const request = worker.requests[0];
    expect(request?.input.type === "formula" && request.input.settings.secondOrderLaunchAngleMode).toBe(
      "display-rounded",
    );
    worker.respond({ curvePoints: "rounded curve", elapsedMs: 10 });
    await expect(result).resolves.toEqual({ curvePoints: "rounded curve", elapsedMs: 10 });
    runner.close();
  });

  it("replays the latest preview on TypeScript after a synchronous WASM initialization fault", async () => {
    installFakeWorker();
    FakeWorker.wasmBackendInitializationFailures = 1;
    const onWasmFault = vi.fn(() => 9);
    const runner = createGraphwarLiveClickPreviewRunner({
      backendConfiguration: createGraphwarWasmWorkerBackendConfiguration(4, emptyWasmModule),
      onWasmFault,
      workerCount: ref(1),
    });

    const result = runner.render(createRenderInput(1));

    expect(onWasmFault).toHaveBeenCalledOnce();
    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[0].terminated).toBe(true);
    expect(FakeWorker.instances[1].controlMessages[0]).toMatchObject({
      backend: { type: "typescript" },
      backendExecution: {
        effective: "typescript",
        fallbackReason: "module-clone: Module could not be cloned",
        requested: "wasm",
      },
      generation: 9,
    });
    expect(FakeWorker.instances[1].requests[0].attempt.backendGeneration).toBe(9);
    FakeWorker.instances[1].respond({ curvePoints: "typescript replay", elapsedMs: 12 });
    await expect(result).resolves.toEqual({ curvePoints: "typescript replay", elapsedMs: 12 });
    runner.close();
  });

  it("replays a typed fault from an owned shared-mask snapshot", async () => {
    installFakeWorker();
    const mask = new Uint8Array([1, 2, 3]);
    const input = createRenderInput(1);
    input.collision = { mask };
    if (input.type !== "formula") {
      throw new Error("Expected formula preview input");
    }
    input.settings = {
      ...input.settings,
      isStepGlitchModeEnabled: true,
      stepGlitchObstacleMask: mask,
    };
    const runner = createGraphwarLiveClickPreviewRunner({
      backendConfiguration: createGraphwarWasmWorkerBackendConfiguration(4, emptyWasmModule),
      onWasmFault: vi.fn(() => 9),
      workerCount: ref(1),
    });
    const result = runner.render(input);
    const wasmWorker = FakeWorker.instances[0];
    const wasmRequest = wasmWorker.requests[0];
    const wasmInput = wasmRequest.input;
    if (wasmInput.type !== "formula") {
      throw new Error("Expected formula Worker request");
    }
    expect(wasmInput.collision?.mask).not.toBe(mask);
    expect(wasmInput.settings.stepGlitchObstacleMask).toBe(wasmInput.collision?.mask);

    mask[0] = 9;
    wasmWorker.emitMessage({
      context: { attempt: wasmRequest.attempt, type: "task" },
      fault: { code: "trap", message: "preview trapped" },
      generation: 4,
      role: "live-click-preview",
      type: "wasm-fault",
    });

    const replayWorker = FakeWorker.instances[1];
    const replayInput = replayWorker.requests[0].input;
    if (replayInput.type !== "formula") {
      throw new Error("Expected formula replay request");
    }
    expect([...(replayInput.collision?.mask ?? [])]).toEqual([1, 2, 3]);
    expect(replayInput.settings.stepGlitchObstacleMask).toBe(replayInput.collision?.mask);
    replayWorker.respond({ curvePoints: "typescript replay", elapsedMs: 12 });
    await expect(result).resolves.toEqual({ curvePoints: "typescript replay", elapsedMs: 12 });
    runner.close();
  });

  it("ignores a typed fault from a cancelled preview task", async () => {
    installFakeWorker();
    const onWasmFault = vi.fn(() => 9);
    const runner = createGraphwarLiveClickPreviewRunner({
      backendConfiguration: createGraphwarWasmWorkerBackendConfiguration(4, emptyWasmModule),
      onWasmFault,
      workerCount: ref(1),
    });
    const first = runner.render(createRenderInput(1));
    const firstCancelled = first.catch((error: unknown) => error);
    const firstWorker = FakeWorker.instances[0];
    const firstRequest = firstWorker.requests[0];
    runner.cancel();
    const second = runner.render(createRenderInput(2));

    firstWorker.emitMessage({
      context: { attempt: firstRequest.attempt, type: "task" },
      fault: { code: "trap", message: "late preview fault" },
      generation: 4,
      role: "live-click-preview",
      type: "wasm-fault",
    });

    await expect(firstCancelled).resolves.toSatisfy((error: unknown) => error instanceof Error);
    expect(onWasmFault).not.toHaveBeenCalled();
    FakeWorker.instances[1].respond({ curvePoints: "current preview", elapsedMs: 10 });
    await expect(second).resolves.toEqual({ curvePoints: "current preview", elapsedMs: 10 });
    runner.close();
  });
});

const emptyWasmModule = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

function installFakeWorker() {
  vi.stubGlobal("Worker", FakeWorker);
}

function createDeferredBackendSelection(generation: number) {
  let resolve!: (configuration: GraphwarWorkerBackendConfiguration) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<GraphwarWorkerBackendConfiguration>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return {
    reject,
    resolve,
    selection: { generation, promise } satisfies GraphwarWorkerBackendSelection,
  };
}

class FakeWorker {
  static readonly instances: FakeWorker[] = [];
  static failPostMessage = false;
  static wasmBackendInitializationFailures = 0;

  readonly controlMessages: GraphwarBackendControlMessage[] = [];
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

  postMessage(message: GraphwarBackendControlMessage | GraphwarLiveClickPreviewWorkerRequest) {
    if (FakeWorker.failPostMessage) {
      throw new Error("postMessage failed");
    }
    if (isGraphwarBackendControlMessage(message)) {
      if (
        message.type === "backend-init" &&
        message.backend.type === "wasm" &&
        FakeWorker.wasmBackendInitializationFailures > 0
      ) {
        FakeWorker.wasmBackendInitializationFailures -= 1;
        throw new DOMException("Module could not be cloned", "DataCloneError");
      }
      this.controlMessages.push(message);
      return;
    }
    this.requests.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  respond(result: GraphwarLiveClickPreviewRenderResult) {
    const request = this.requests.at(-1);
    if (!request) {
      throw new Error("Worker has no pending request");
    }
    this.emitMessage({ attempt: request.attempt, id: request.id, result, type: "success" });
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
      isStepGlitchModeEnabled: false,
      isStepOverflowProtectionEnabled: true,
    },
    type: "formula",
  };
}
