import { describe, expect, it, vi } from "vitest";

import { createGraphPoint } from "../../core/types";
import type {
  GraphwarTrajectoryCalculationInput,
  GraphwarTrajectoryCalculationOutcome,
  GraphwarTrajectoryCalculationWorkerRequest,
  GraphwarTrajectoryCalculationWorkerResponse,
} from "./trajectory-calculation";
import { createGraphwarTrajectoryRunner, isGraphwarTrajectoryCancelledError } from "./trajectory-runner";

const workerOutcome: GraphwarTrajectoryCalculationOutcome = {
  message: "test outcome",
  ok: false,
  stage: "formula",
};

describe("Graphwar main trajectory runner", () => {
  it("lazily creates one active Worker and one hot spare", async () => {
    const workers: FakeWorker[] = [];
    const runner = createGraphwarTrajectoryRunner({ createWorker: createFakeWorkerFactory(workers) });

    expect(workers).toHaveLength(0);
    const resultPromise = runner.run(createSimulatorInput());

    expect(workers).toHaveLength(2);
    expect(workers[0].requests).toHaveLength(1);
    expect(workers[1].requests).toHaveLength(0);
    workers[0].respond(workerOutcome);
    await expect(resultPromise).resolves.toMatchObject({ outcome: workerOutcome });
    runner.close();
  });

  it("hard-cancels the active Worker and immediately hot-swaps to the spare", async () => {
    const workers: FakeWorker[] = [];
    const runner = createGraphwarTrajectoryRunner({ createWorker: createFakeWorkerFactory(workers) });
    const first = runner.run(createSimulatorInput("1"));
    const firstCancelled = first.catch((error: unknown) => error);

    const second = runner.run(createSimulatorInput("2"));

    expect(isGraphwarTrajectoryCancelledError(await firstCancelled)).toBe(true);
    expect(workers[0].terminated).toBe(true);
    expect(workers[1].requests[0]?.input).toMatchObject({ expression: "2" });
    expect(workers).toHaveLength(3);
    workers[1].respond(workerOutcome);
    await expect(second).resolves.toMatchObject({ outcome: workerOutcome });
    runner.close();
  });

  it("ignores a superseded Worker response that arrives late", async () => {
    const workers: FakeWorker[] = [];
    const runner = createGraphwarTrajectoryRunner({ createWorker: createFakeWorkerFactory(workers) });
    const first = runner.run(createSimulatorInput("1"));
    const firstCancelled = first.catch((error: unknown) => error);
    const firstRequestId = workers[0].requests[0].id;
    const second = runner.run(createSimulatorInput("2"));
    let isSecondSettled = false;
    void second.finally(() => {
      isSecondSettled = true;
    });

    workers[0].emitResponse({ id: firstRequestId, outcome: workerOutcome });
    await Promise.resolve();

    expect(isGraphwarTrajectoryCancelledError(await firstCancelled)).toBe(true);
    expect(isSecondSettled).toBe(false);
    workers[1].respond(workerOutcome);
    await second;
    runner.close();
  });

  it("keeps an idle spare on cancel and releases every Worker on close", async () => {
    const workers: FakeWorker[] = [];
    const runner = createGraphwarTrajectoryRunner({ createWorker: createFakeWorkerFactory(workers) });
    const first = runner.run(createSimulatorInput());
    const firstCancelled = first.catch((error: unknown) => error);

    runner.cancel();

    expect(isGraphwarTrajectoryCancelledError(await firstCancelled)).toBe(true);
    expect(workers[0].terminated).toBe(true);
    expect(workers[1].terminated).toBe(false);

    const second = runner.run(createSimulatorInput("2"));
    const secondCancelled = second.catch((error: unknown) => error);
    runner.close();

    expect(isGraphwarTrajectoryCancelledError(await secondCancelled)).toBe(true);
    expect(workers.every((worker) => worker.terminated)).toBe(true);
    await expect(runner.run(createSimulatorInput("3"))).rejects.toSatisfy(isGraphwarTrajectoryCancelledError);
  });

  it("retries one infrastructure failure on the spare, then paints before every fallback task", async () => {
    const workers: FakeWorker[] = [];
    const events: string[] = [];
    const pendingPaints: (() => void)[] = [];
    const runner = createGraphwarTrajectoryRunner({
      createWorker: createFakeWorkerFactory(workers),
      onFallback: (reason) => events.push(`fallback:${reason}`),
      waitForFallbackPaint: () =>
        new Promise<void>((resolve) => {
          events.push("paint");
          pendingPaints.push(resolve);
        }),
    });
    const result = runner.run(createSimulatorInput("0"));
    let isSettled = false;
    void result.finally(() => {
      isSettled = true;
    });

    workers[0].fail("first failure");
    expect(workers[1].requests).toHaveLength(1);
    workers[1].fail("second failure");
    await Promise.resolve();

    expect(events).toEqual(["fallback:second failure", "paint"]);
    expect(isSettled).toBe(false);
    pendingPaints.shift()?.();
    await expect(result).resolves.toMatchObject({ outcome: { ok: true } });

    const workerCount = workers.length;
    const fallbackResult = runner.run(createSimulatorInput("1"));
    let isFallbackSettled = false;
    void fallbackResult.finally(() => {
      isFallbackSettled = true;
    });
    await Promise.resolve();

    expect(events).toEqual(["fallback:second failure", "paint", "paint"]);
    expect(isFallbackSettled).toBe(false);
    pendingPaints.shift()?.();
    await expect(fallbackResult).resolves.toMatchObject({ outcome: { ok: true } });
    expect(workers).toHaveLength(workerCount);
    runner.close();
  });

  it("includes Worker messaging in the end-to-end elapsed time", async () => {
    const workers: FakeWorker[] = [];
    const times = [100, 137];
    const runner = createGraphwarTrajectoryRunner({
      createWorker: createFakeWorkerFactory(workers),
      now: () => times.shift() ?? 137,
    });
    const result = runner.run(createSimulatorInput());

    workers[0].respond(workerOutcome);

    await expect(result).resolves.toEqual({ elapsedMs: 37, outcome: workerOutcome });
    runner.close();
  });

  it("returns a rejected Promise when the input snapshot cannot be cloned", async () => {
    const workers: FakeWorker[] = [];
    const input = createSimulatorInput();
    Object.defineProperty(input.bounds, "maxX", {
      get() {
        throw new Error("snapshot failed");
      },
    });
    const runner = createGraphwarTrajectoryRunner({ createWorker: createFakeWorkerFactory(workers) });
    let result: Promise<unknown> | undefined;

    expect(() => {
      result = runner.run(input);
    }).not.toThrow();
    await expect(result).rejects.toThrow("snapshot failed");
    expect(workers).toHaveLength(0);
    runner.close();
  });

  it("retries a malformed current response instead of leaving the task pending", async () => {
    const workers: FakeWorker[] = [];
    const runner = createGraphwarTrajectoryRunner({ createWorker: createFakeWorkerFactory(workers) });
    const result = runner.run(createSimulatorInput());

    workers[0].emitRawResponse({ id: workers[0].requests[0].id });

    expect(workers[0].terminated).toBe(true);
    expect(workers[1].requests).toHaveLength(1);
    workers[1].respond(workerOutcome);
    await expect(result).resolves.toMatchObject({ outcome: workerOutcome });
    runner.close();
  });

  it("retries a structurally incomplete success response", async () => {
    const workers: FakeWorker[] = [];
    const runner = createGraphwarTrajectoryRunner({ createWorker: createFakeWorkerFactory(workers) });
    const result = runner.run(createSimulatorInput());

    workers[0].emitRawResponse({
      id: workers[0].requests[0].id,
      outcome: { ok: true, result: {} },
    });

    expect(workers[0].terminated).toBe(true);
    expect(workers[1].requests).toHaveLength(1);
    workers[1].respond(workerOutcome);
    await expect(result).resolves.toMatchObject({ outcome: workerOutcome });
    runner.close();
  });

  it("retries a current response with the wrong request id instead of leaving the task pending", async () => {
    const workers: FakeWorker[] = [];
    const runner = createGraphwarTrajectoryRunner({ createWorker: createFakeWorkerFactory(workers) });
    const result = runner.run(createSimulatorInput());
    const requestId = workers[0].requests[0].id;

    workers[0].emitResponse({ id: requestId + 1, outcome: workerOutcome });

    expect(workers[0].terminated).toBe(true);
    expect(workers[1].requests).toHaveLength(1);
    workers[1].respond(workerOutcome);
    await expect(result).resolves.toMatchObject({ outcome: workerOutcome });
    runner.close();
  });

  it("clones reactive-facing input while preserving a shared mask inside the request", async () => {
    const workers: FakeWorker[] = [];
    const mask = new Uint8Array([1, 2, 3]);
    const input = createSolverInput(mask);
    const runner = createGraphwarTrajectoryRunner({ createWorker: createFakeWorkerFactory(workers) });
    const result = runner.run(input);
    const requestInput = workers[0].requests[0].input;
    if (requestInput.type !== "solver") {
      throw new Error("Expected solver request");
    }

    expect(requestInput).not.toBe(input);
    expect(requestInput.points).not.toBe(input.points);
    expect(requestInput.collision?.mask).not.toBe(mask);
    expect(requestInput.settings.stepGlitchObstacleMask).toBe(requestInput.collision?.mask);
    const clonedGlitchMask = requestInput.settings.stepGlitchObstacleMask;
    if (!clonedGlitchMask) {
      throw new Error("Expected cloned glitch mask");
    }
    expect([...clonedGlitchMask]).toEqual([1, 2, 3]);
    workers[0].respond(workerOutcome);
    await result;
    runner.close();
  });
});

class FakeWorker {
  readonly requests: GraphwarTrajectoryCalculationWorkerRequest[] = [];
  terminated = false;
  private readonly listeners = {
    error: [] as ((event: ErrorEvent) => void)[],
    message: [] as ((event: MessageEvent<GraphwarTrajectoryCalculationWorkerResponse>) => void)[],
    messageerror: [] as ((event: MessageEvent) => void)[],
  };

  addEventListener(type: "error" | "message" | "messageerror", listener: EventListener) {
    this.listeners[type].push(listener as never);
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
    this.emitResponse({ id: request.id, outcome });
  }

  emitResponse(response: GraphwarTrajectoryCalculationWorkerResponse) {
    this.emitRawResponse(response);
  }

  emitRawResponse(response: unknown) {
    const event = { data: response } as MessageEvent<GraphwarTrajectoryCalculationWorkerResponse>;
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
}

function createFakeWorkerFactory(workers: FakeWorker[]) {
  return vi.fn(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
}

function createSimulatorInput(expression = "0"): GraphwarTrajectoryCalculationInput {
  return {
    bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
    boundsRect: { height: 450, width: 770, x: 0, y: 0 },
    equation: "y",
    expression,
    soldierCenter: createGraphPoint(-20, 0),
    type: "simulator",
  };
}

function createSolverInput(mask: Uint8Array): Extract<GraphwarTrajectoryCalculationInput, { type: "solver" }> {
  return {
    bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
    boundsRect: { height: 450, width: 770, x: 0, y: 0 },
    collision: { mask },
    points: [createGraphPoint(-20, 0), createGraphPoint(-10, 5)],
    settings: {
      algorithm: "step",
      decimalPlaces: 4,
      equation: "dy",
      steepness: 67,
      stepGlitchMode: true,
      stepGlitchObstacleMask: mask,
      stepOverflowProtection: true,
    },
    type: "solver",
  };
}
