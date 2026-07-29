import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createGraphwarTypescriptWorkerBackendConfiguration,
  createGraphwarWasmWorkerBackendConfiguration,
  isGraphwarBackendControlMessage,
  type GraphwarBackendControlMessage,
} from "../../core/algorithm-backend";
import type {
  GraphwarDetectionWorkerRequest,
  GraphwarDetectionWorkerResponse,
  GraphwarDetectionWorkerTimingEntry,
} from "./protocol";
import { createGraphwarDetectionRunner, isGraphwarDetectionCancelledError } from "./runner";

describe("Graphwar detection runner backend attempts", () => {
  beforeEach(() => {
    FakeWorker.instances.length = 0;
    FakeWorker.backendInitializationError = undefined;
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("publishes stage, timings and result only for the current request attempt", async () => {
    const stages: string[] = [];
    const receivedTimings: (readonly GraphwarDetectionWorkerTimingEntry[])[] = [];
    const runner = createGraphwarDetectionRunner();
    const result = runner.detectBounds(createInput(), {
      onStage: (stage) => stages.push(stage),
      onTimings: (timings) => receivedTimings.push(timings),
    });
    await Promise.resolve();
    const worker = FakeWorker.instances[0];
    const request = worker.requests[0];

    expect(worker.controlMessages).toEqual([
      { backend: { type: "typescript" }, generation: 0, role: "detection-main", type: "backend-init" },
    ]);
    expect(request.attempt).toEqual({ attemptId: 1, backendGeneration: 0, outerTaskId: 1 });
    worker.emit({ ...request, stage: "detecting-bounds", type: "stage" });
    worker.emit(createSuccessResponse(request));

    await expect(result).resolves.toEqual({ edgeRect: undefined });
    expect(stages).toEqual(["detecting-bounds"]);
    expect(receivedTimings).toEqual([[{ elapsedMs: 1, stage: "detecting-bounds" }]]);
    runner.close();
  });

  it("drops stage and result messages from another attempt even when request id matches", async () => {
    const stages: string[] = [];
    const timings = vi.fn();
    const runner = createGraphwarDetectionRunner();
    const result = runner.detectBounds(createInput(), { onStage: (stage) => stages.push(stage), onTimings: timings });
    await Promise.resolve();
    const worker = FakeWorker.instances[0];
    const request = worker.requests[0];
    const staleAttempt = { ...request.attempt, attemptId: request.attempt.attemptId + 1 };
    let isSettled = false;
    void result.finally(() => {
      isSettled = true;
    });

    worker.emit({ attempt: staleAttempt, id: request.id, stage: "detecting-bounds", type: "stage" });
    worker.emit(createSuccessResponse(request, staleAttempt));
    worker.emit({ attempt: staleAttempt, id: request.id, message: "stale failure", type: "error" });
    await Promise.resolve();

    expect(stages).toEqual([]);
    expect(timings).not.toHaveBeenCalled();
    expect(isSettled).toBe(false);
    worker.emit(createSuccessResponse(request));
    await expect(result).resolves.toEqual({ edgeRect: undefined });
    runner.close();
  });

  it("revokes a cancelled task before ignoring its late stage and result", async () => {
    const onStage = vi.fn();
    const onTimings = vi.fn();
    const runner = createGraphwarDetectionRunner();
    const result = runner.detectBounds(createInput(), { onStage, onTimings });
    const cancelled = result.catch((error: unknown) => error);
    await Promise.resolve();
    const worker = FakeWorker.instances[0];
    const request = worker.requests[0];

    runner.cancel();
    worker.emit({ ...request, stage: "detecting-bounds", type: "stage" });
    worker.emit(createSuccessResponse(request));

    expect(isGraphwarDetectionCancelledError(await cancelled)).toBe(true);
    expect(worker.isTerminated).toBe(true);
    expect(onStage).not.toHaveBeenCalled();
    expect(onTimings).not.toHaveBeenCalled();
    runner.close();
  });

  it("replaces an outer task and prevents the old Worker from committing into the new one", async () => {
    const firstStage = vi.fn();
    const secondStage = vi.fn();
    const runner = createGraphwarDetectionRunner();
    const first = runner.detectBounds(createInput(), { onStage: firstStage });
    const firstCancelled = first.catch((error: unknown) => error);
    await Promise.resolve();
    const firstWorker = FakeWorker.instances[0];
    const firstRequest = firstWorker.requests[0];

    const second = runner.detectBounds(createInput(), { onStage: secondStage });
    await Promise.resolve();
    const secondWorker = FakeWorker.instances[1];
    const secondRequest = secondWorker.requests[0];
    firstWorker.emit({ ...firstRequest, stage: "detecting-bounds", type: "stage" });
    firstWorker.emit(createSuccessResponse(firstRequest));
    firstWorker.fail("late old Worker failure");
    firstWorker.failMessage();
    secondWorker.emit({ ...secondRequest, stage: "detecting-bounds", type: "stage" });
    secondWorker.emit(createSuccessResponse(secondRequest));

    expect(isGraphwarDetectionCancelledError(await firstCancelled)).toBe(true);
    await expect(second).resolves.toEqual({ edgeRect: undefined });
    expect(firstStage).not.toHaveBeenCalled();
    expect(secondStage).toHaveBeenCalledOnce();
    expect(secondRequest.attempt).toEqual({ attemptId: 2, backendGeneration: 0, outerTaskId: 2 });
    runner.close();
  });

  it("completes the gate before duplicate success responses can settle again", async () => {
    const onTimings = vi.fn();
    const runner = createGraphwarDetectionRunner();
    const result = runner.detectBounds(createInput(), { onTimings });
    await Promise.resolve();
    const worker = FakeWorker.instances[0];
    const response = createSuccessResponse(worker.requests[0]);

    worker.emit(response);
    worker.emit(response);

    await expect(result).resolves.toEqual({ edgeRect: undefined });
    expect(onTimings).toHaveBeenCalledOnce();
    runner.close();
  });

  it("rejects the public Promise if the terminal timing callback throws", async () => {
    const runner = createGraphwarDetectionRunner();
    const result = runner.detectBounds(createInput(), {
      onTimings: () => {
        throw new Error("timing callback failed");
      },
    });
    await Promise.resolve();
    const worker = FakeWorker.instances[0];

    worker.emit(createSuccessResponse(worker.requests[0]));

    await expect(result).rejects.toThrow("timing callback failed");
    runner.close();
  });

  it("preserves Worker error and messageerror task failure/reset behavior", async () => {
    const onWasmFault = vi.fn();
    const runner = createGraphwarDetectionRunner({ onWasmFault });
    const failedByError = runner.detectBounds(createInput());
    await Promise.resolve();
    FakeWorker.instances[0].fail("worker failed");

    await expect(failedByError).rejects.toThrow("worker failed");
    expect(FakeWorker.instances[0].isTerminated).toBe(true);

    const failedByMessage = runner.detectBounds(createInput());
    await Promise.resolve();
    FakeWorker.instances[1].failMessage();

    await expect(failedByMessage).rejects.toThrow("could not be deserialized");
    expect(FakeWorker.instances[1].isTerminated).toBe(true);
    expect(onWasmFault).not.toHaveBeenCalled();
    runner.close();
  });

  it("owns caller RGBA before awaiting backend selection", async () => {
    let resolveSelection:
      | ((configuration: ReturnType<typeof createGraphwarTypescriptWorkerBackendConfiguration>) => void)
      | undefined;
    const input = createInput(new Uint8ClampedArray([1, 2, 3, 4]));
    const runner = createGraphwarDetectionRunner({
      createBackendSelection: () => ({
        generation: 3,
        promise: new Promise((resolve) => {
          resolveSelection = resolve;
        }),
      }),
    });
    const result = runner.detectBounds(input);

    input.imageData.data[0] = 9;
    resolveSelection?.(createGraphwarTypescriptWorkerBackendConfiguration(3));
    await Promise.resolve();
    const worker = FakeWorker.instances[0];
    expect(worker.requests[0]?.task.imageData.data).toEqual(new Uint8ClampedArray([1, 2, 3, 4]));
    worker.emit(createSuccessResponse(worker.requests[0]));

    await expect(result).resolves.toEqual({ edgeRect: undefined });
    runner.close();
  });

  it("cold-replays a typed fault from master RGBA after the WASM request was transferred", async () => {
    const module = createEmptyWasmModule();
    const onWasmFault = vi.fn(() => 8);
    const input = createInput(new Uint8ClampedArray([1, 2, 3, 4]));
    const runner = createGraphwarDetectionRunner({
      backendConfiguration: createGraphwarWasmWorkerBackendConfiguration(7, module),
      onWasmFault,
    });
    const result = runner.detectBounds(input);
    await Promise.resolve();
    const wasmWorker = FakeWorker.instances[0];
    const wasmRequest = wasmWorker.requests[0];

    input.imageData.data[0] = 9;
    wasmWorker.emitRaw(createTaskFault(wasmRequest, "faulted after transfer"));
    const typescriptWorker = FakeWorker.instances[1];
    const replayRequest = typescriptWorker.requests[0];

    expect(wasmWorker.isTerminated).toBe(true);
    expect(onWasmFault).toHaveBeenCalledOnce();
    expect(typescriptWorker.controlMessages).toEqual([
      { backend: { type: "typescript" }, generation: 8, role: "detection-main", type: "backend-init" },
    ]);
    expect(replayRequest.attempt).toEqual({ attemptId: 2, backendGeneration: 8, outerTaskId: 1 });
    expect(replayRequest.task.imageData.data).toEqual(new Uint8ClampedArray([1, 2, 3, 4]));
    typescriptWorker.emit(createSuccessResponse(replayRequest));

    await expect(result).resolves.toEqual({ edgeRect: undefined });
    runner.close();
  });

  it("cold-replays a root WASM Module clone fault without settling the outer task", async () => {
    FakeWorker.backendInitializationError = new DOMException("module clone failed", "DataCloneError");
    const onWasmFault = vi.fn(() => 10);
    const runner = createGraphwarDetectionRunner({
      backendConfiguration: createGraphwarWasmWorkerBackendConfiguration(9, createEmptyWasmModule()),
      onWasmFault,
    });
    const result = runner.detectBounds(createInput(new Uint8ClampedArray([1, 2, 3, 4])));
    await Promise.resolve();
    const replacementWorker = FakeWorker.instances[1];

    expect(FakeWorker.instances[0].isTerminated).toBe(true);
    expect(replacementWorker.controlMessages).toEqual([
      { backend: { type: "typescript" }, generation: 10, role: "detection-main", type: "backend-init" },
    ]);
    replacementWorker.emit(createSuccessResponse(replacementWorker.requests[0]));

    await expect(result).resolves.toEqual({ edgeRect: undefined });
    expect(onWasmFault).toHaveBeenCalledOnce();
    runner.close();
  });

  it("revokes a provisional Worker success when a typed fault arrives before workflow commit", async () => {
    const module = createEmptyWasmModule();
    const committed: string[] = [];
    const releaseCommits: (() => void)[] = [];
    const runner = createGraphwarDetectionRunner({
      backendConfiguration: createGraphwarWasmWorkerBackendConfiguration(4, module),
      onWasmFault: () => 5,
    });
    const result = runner.detectBounds(createInput(), {
      commitResult: async (completed, _timings, context) => {
        await new Promise<void>((resolve) => releaseCommits.push(resolve));
        context.commit(() => committed.push(completed.edgeRect ? "bounds" : "empty"));
      },
    });
    await Promise.resolve();
    const wasmWorker = FakeWorker.instances[0];
    const wasmRequest = wasmWorker.requests[0];
    wasmWorker.emit(createSuccessResponse(wasmRequest));
    await Promise.resolve();

    wasmWorker.emitRaw(createTaskFault(wasmRequest, "faulted before paint"));
    const typescriptWorker = FakeWorker.instances[1];
    const replayRequest = typescriptWorker.requests[0];
    typescriptWorker.emit(createSuccessResponse(replayRequest));
    await Promise.resolve();
    releaseCommits[0]?.();
    releaseCommits[1]?.();

    await expect(result).resolves.toEqual({ edgeRect: undefined });
    expect(committed).toEqual(["empty"]);
    runner.close();
  });

  it.each(["error", "messageerror"] as const)(
    "rejects a provisional success when the Worker later emits %s without fusing",
    async (failureType) => {
      let releaseCommit: (() => void) | undefined;
      const committed = vi.fn();
      const onWasmFault = vi.fn();
      const runner = createGraphwarDetectionRunner({ onWasmFault });
      const result = runner.detectBounds(createInput(), {
        commitResult: async (_completed, _timings, context) => {
          await new Promise<void>((resolve) => {
            releaseCommit = resolve;
          });
          context.commit(committed);
        },
      });
      await Promise.resolve();
      const worker = FakeWorker.instances[0];
      worker.emit(createSuccessResponse(worker.requests[0]));
      await Promise.resolve();

      if (failureType === "error") {
        worker.fail("late worker failure");
      } else {
        worker.failMessage();
      }
      releaseCommit?.();

      await expect(result).rejects.toThrow(
        failureType === "error" ? "late worker failure" : "could not be deserialized",
      );
      expect(worker.isTerminated).toBe(true);
      expect(committed).not.toHaveBeenCalled();
      expect(onWasmFault).not.toHaveBeenCalled();
      runner.close();
    },
  );

  it("keeps the no-Worker synchronous fallback and commits its timings once", async () => {
    vi.stubGlobal("Worker", undefined);
    const stages: string[] = [];
    const onTimings = vi.fn();
    const runner = createGraphwarDetectionRunner();

    const result = runner.detectBounds(createInput(), {
      onStage: (stage) => {
        stages.push(stage);
        runner.cancel();
      },
      onTimings,
    });

    await expect(result).rejects.toSatisfy(isGraphwarDetectionCancelledError);
    expect(stages).toEqual(["detecting-bounds"]);
    expect(onTimings).not.toHaveBeenCalled();
    expect(FakeWorker.instances).toHaveLength(0);
    runner.close();
  });

  it("rejects synchronous fallback timing callback errors through the public Promise", async () => {
    vi.stubGlobal("Worker", undefined);
    const runner = createGraphwarDetectionRunner();

    await expect(
      runner.detectBounds(createInput(), {
        onTimings: () => {
          throw new Error("synchronous timing callback failed");
        },
      }),
    ).rejects.toThrow("synchronous timing callback failed");
    runner.close();
  });
});

class FakeWorker {
  static readonly instances: FakeWorker[] = [];
  static backendInitializationError: Error | undefined;

  readonly controlMessages: GraphwarBackendControlMessage[] = [];
  readonly requests: GraphwarDetectionWorkerRequest[] = [];
  isTerminated = false;
  private readonly listeners = {
    error: [] as ((event: ErrorEvent) => void)[],
    message: [] as ((event: MessageEvent<GraphwarDetectionWorkerResponse>) => void)[],
    messageerror: [] as ((event: MessageEvent) => void)[],
  };

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: "error" | "message" | "messageerror", listener: EventListener) {
    this.listeners[type].push(listener as never);
  }

  postMessage(message: GraphwarBackendControlMessage | GraphwarDetectionWorkerRequest, transfer: Transferable[] = []) {
    if (isGraphwarBackendControlMessage(message)) {
      if (message.type === "backend-init" && message.backend.type === "wasm" && FakeWorker.backendInitializationError) {
        throw FakeWorker.backendInitializationError;
      }
      this.controlMessages.push(message);
      return;
    }
    this.requests.push(structuredClone(message, { transfer }));
  }

  terminate() {
    this.isTerminated = true;
  }

  emit(response: GraphwarDetectionWorkerResponse) {
    this.emitRaw(response);
  }

  emitRaw(response: unknown) {
    const event = { data: response } as MessageEvent<GraphwarDetectionWorkerResponse>;
    for (const listener of this.listeners.message) {
      listener(event);
    }
  }

  fail(message: string) {
    const event = { error: new Error(message), message } as ErrorEvent;
    for (const listener of this.listeners.error) {
      listener(event);
    }
  }

  failMessage() {
    const event = {} as MessageEvent;
    for (const listener of this.listeners.messageerror) {
      listener(event);
    }
  }
}

function createInput(data = new Uint8ClampedArray(4)) {
  return {
    imageData: {
      data,
      height: 1,
      width: 1,
    } as ImageData,
  };
}

function createEmptyWasmModule() {
  return new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
}

function createTaskFault(
  request: GraphwarDetectionWorkerRequest,
  message: string,
): Extract<GraphwarBackendControlMessage, { type: "wasm-fault" }> {
  return {
    context: { attempt: request.attempt, type: "task" },
    fault: { code: "trap", message },
    generation: request.attempt.backendGeneration,
    role: "detection-main",
    type: "wasm-fault",
  };
}

function createSuccessResponse(
  request: GraphwarDetectionWorkerRequest,
  attempt = request.attempt,
): GraphwarDetectionWorkerResponse {
  return {
    attempt,
    id: request.id,
    result: { edgeRect: undefined },
    taskType: "detect-bounds-only",
    timings: [{ elapsedMs: 1, stage: "detecting-bounds" }],
    type: "success",
  };
}
