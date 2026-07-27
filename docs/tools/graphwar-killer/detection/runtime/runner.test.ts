import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  GraphwarDetectionWorkerRequest,
  GraphwarDetectionWorkerResponse,
  GraphwarDetectionWorkerTimingEntry,
} from "./protocol";
import { createGraphwarDetectionRunner, isGraphwarDetectionCancelledError } from "./runner";

describe("Graphwar detection runner backend attempts", () => {
  beforeEach(() => {
    FakeWorker.instances.length = 0;
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
    const worker = FakeWorker.instances[0];
    const request = worker.requests[0];

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
    const firstWorker = FakeWorker.instances[0];
    const firstRequest = firstWorker.requests[0];

    const second = runner.detectBounds(createInput(), { onStage: secondStage });
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
    const worker = FakeWorker.instances[0];
    const response = createSuccessResponse(worker.requests[0]);

    worker.emit(response);
    worker.emit(response);

    await expect(result).resolves.toEqual({ edgeRect: undefined });
    expect(onTimings).toHaveBeenCalledOnce();
    runner.close();
  });

  it("rejects malformed attempt envelopes and resets the failed Worker", async () => {
    const runner = createGraphwarDetectionRunner();
    const result = runner.detectBounds(createInput());
    const worker = FakeWorker.instances[0];
    const request = worker.requests[0];

    worker.emitRaw({ id: request.id, stage: "detecting-bounds", type: "stage" });

    await expect(result).rejects.toThrow("invalid response");
    expect(worker.isTerminated).toBe(true);
    runner.close();
  });

  it("rejects a task-specific success half-state instead of leaving the Promise pending", async () => {
    const runner = createGraphwarDetectionRunner();
    const result = runner.detectAuto({ ...createInput(), thresholds: { minArea: 1 } });
    const worker = FakeWorker.instances[0];
    const request = worker.requests[0];

    worker.emitRaw({
      attempt: request.attempt,
      id: request.id,
      result: null,
      taskType: "detect-auto",
      timings: [],
      type: "success",
    });

    await expect(result).rejects.toThrow("invalid response");
    expect(worker.isTerminated).toBe(true);
    runner.close();
  });

  it("rejects the public Promise if the terminal timing callback throws", async () => {
    const runner = createGraphwarDetectionRunner();
    const result = runner.detectBounds(createInput(), {
      onTimings: () => {
        throw new Error("timing callback failed");
      },
    });
    const worker = FakeWorker.instances[0];

    worker.emit(createSuccessResponse(worker.requests[0]));

    await expect(result).rejects.toThrow("timing callback failed");
    runner.close();
  });

  it("preserves Worker error and messageerror task failure/reset behavior", async () => {
    const runner = createGraphwarDetectionRunner();
    const failedByError = runner.detectBounds(createInput());
    FakeWorker.instances[0].fail("worker failed");

    await expect(failedByError).rejects.toThrow("worker failed");
    expect(FakeWorker.instances[0].isTerminated).toBe(true);

    const failedByMessage = runner.detectBounds(createInput());
    FakeWorker.instances[1].failMessage();

    await expect(failedByMessage).rejects.toThrow("could not be deserialized");
    expect(FakeWorker.instances[1].isTerminated).toBe(true);
    runner.close();
  });

  it("keeps the no-Worker synchronous fallback and commits its timings once", async () => {
    vi.stubGlobal("Worker", undefined);
    const stages: string[] = [];
    const onTimings = vi.fn();
    const runner = createGraphwarDetectionRunner();

    await expect(
      runner.detectBounds(createInput(), {
        onStage: (stage) => {
          stages.push(stage);
          runner.cancel();
        },
        onTimings,
      }),
    ).resolves.toEqual({ edgeRect: undefined });
    expect(stages).toEqual(["detecting-bounds"]);
    expect(onTimings).toHaveBeenCalledOnce();
    expect(FakeWorker.instances).toHaveLength(0);
    runner.close();
  });

  it("preserves synchronous timing callback errors as direct call failures", () => {
    vi.stubGlobal("Worker", undefined);
    const runner = createGraphwarDetectionRunner();

    expect(() =>
      runner.detectBounds(createInput(), {
        onTimings: () => {
          throw new Error("synchronous timing callback failed");
        },
      }),
    ).toThrow("synchronous timing callback failed");
    runner.close();
  });
});

class FakeWorker {
  static readonly instances: FakeWorker[] = [];

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

  postMessage(request: GraphwarDetectionWorkerRequest) {
    this.requests.push(request);
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

function createInput() {
  return {
    imageData: {
      data: new Uint8ClampedArray(4),
      height: 1,
      width: 1,
    } as ImageData,
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
