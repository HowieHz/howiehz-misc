import { describe, expect, it, vi } from "vitest";

import {
  createGraphwarWasmWorkerBackendConfiguration,
  isGraphwarBackendControlMessage,
  type GraphwarBackendControlMessage,
} from "../../core/algorithm-backend";
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
  stage: "trajectory",
};

describe("Graphwar main trajectory runner", () => {
  it("lazily creates one active Worker and one hot spare", async () => {
    const workers: FakeWorker[] = [];
    const runner = createGraphwarTrajectoryRunner({ createWorker: createFakeWorkerFactory(workers) });

    expect(workers).toHaveLength(0);
    const resultPromise = runner.run(createSimulatorInput());

    expect(workers).toHaveLength(2);
    expect(workers.map((worker) => worker.controlMessages)).toEqual([
      [{ backend: { type: "typescript" }, generation: 0, role: "trajectory", type: "backend-init" }],
      [{ backend: { type: "typescript" }, generation: 0, role: "trajectory", type: "backend-init" }],
    ]);
    expect(workers[0].requests).toHaveLength(1);
    expect(workers[1].requests).toHaveLength(0);
    expect(workers[0].requests[0].attempt).toEqual({ attemptId: 1, backendGeneration: 0, outerTaskId: 1 });
    workers[0].respond(workerOutcome);
    await expect(resultPromise).resolves.toMatchObject({ outcome: workerOutcome });
    runner.close();
  });

  it("replays the active task after an idle standby WASM fault", async () => {
    const workers: FakeWorker[] = [];
    const onWasmFault = vi.fn();
    const module = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
    const runner = createGraphwarTrajectoryRunner({
      backendConfiguration: createGraphwarWasmWorkerBackendConfiguration(4, module),
      createWorker: createFakeWorkerFactory(workers),
      onWasmFault,
    });
    const result = runner.run(createSimulatorInput());

    workers[1].emitRawResponse({
      context: { type: "initialization" },
      fault: { code: "instantiate", message: "standby instantiate failed" },
      generation: 4,
      role: "trajectory",
      type: "wasm-fault",
    });

    expect(onWasmFault).toHaveBeenCalledOnce();
    expect(workers[1].terminated).toBe(true);
    expect(workers[0].terminated).toBe(true);
    const replayWorker = workers.find((worker) => worker.requests[0]?.attempt.backendGeneration === 5);
    expect(replayWorker?.requests[0]?.attempt.backendGeneration).toBe(5);
    replayWorker?.respond(workerOutcome);
    await expect(result).resolves.toMatchObject({ outcome: workerOutcome });
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
    const firstRequest = workers[0].requests[0];
    const second = runner.run(createSimulatorInput("2"));
    let isSecondSettled = false;
    void second.finally(() => {
      isSecondSettled = true;
    });

    workers[0].emitResponse({ attempt: firstRequest.attempt, id: firstRequest.id, outcome: workerOutcome });
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

  it("retries a current response with the wrong request id instead of leaving the task pending", async () => {
    const workers: FakeWorker[] = [];
    const runner = createGraphwarTrajectoryRunner({ createWorker: createFakeWorkerFactory(workers) });
    const result = runner.run(createSimulatorInput());
    const request = workers[0].requests[0];

    workers[0].emitResponse({ attempt: request.attempt, id: request.id + 1, outcome: workerOutcome });

    expect(workers[0].terminated).toBe(true);
    expect(workers[1].requests).toHaveLength(1);
    workers[1].respond(workerOutcome);
    await expect(result).resolves.toMatchObject({ outcome: workerOutcome });
    runner.close();
  });

  it("retries a response whose backend attempt does not match the active task", async () => {
    const workers: FakeWorker[] = [];
    const runner = createGraphwarTrajectoryRunner({ createWorker: createFakeWorkerFactory(workers) });
    const result = runner.run(createSimulatorInput());
    const request = workers[0].requests[0];

    workers[0].emitResponse({
      attempt: { ...request.attempt, attemptId: request.attempt.attemptId + 1 },
      id: request.id,
      outcome: workerOutcome,
    });

    expect(workers[0].terminated).toBe(true);
    expect(workers[1].requests).toHaveLength(1);
    expect(workers[1].requests[0].attempt).toEqual(request.attempt);
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
  readonly controlMessages: GraphwarBackendControlMessage[] = [];
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

  postMessage(message: GraphwarBackendControlMessage | GraphwarTrajectoryCalculationWorkerRequest) {
    if (isGraphwarBackendControlMessage(message)) {
      this.controlMessages.push(message);
      return;
    }
    this.requests.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  respond(outcome: GraphwarTrajectoryCalculationOutcome) {
    const request = this.requests.at(-1);
    if (!request) {
      throw new Error("Worker has no pending request");
    }
    this.emitResponse({ attempt: request.attempt, id: request.id, outcome });
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
      isStepGlitchModeEnabled: true,
      stepGlitchObstacleMask: mask,
      isStepOverflowProtectionEnabled: true,
    },
    type: "solver",
  };
}
