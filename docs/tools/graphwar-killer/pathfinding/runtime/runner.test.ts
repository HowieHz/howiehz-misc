import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createGraphwarTypescriptWorkerBackendConfiguration,
  createGraphwarWasmWorkerBackendConfiguration,
  isGraphwarBackendControlMessage,
  type GraphwarBackendControlMessage,
  type GraphwarWorkerBackendConfiguration,
  type GraphwarWorkerBackendSelection,
} from "../../core/algorithm-backend";
import { createPixelPoint } from "../../core/types";
import type {
  GraphwarOneClickClearDagEdgeBuildRequest,
  GraphwarOneClickClearIncumbent,
} from "../one-click-clear/search";
import { createGraphwarPathfindingDebugMetrics } from "./diagnostics";
import type {
  GraphwarOneClickClearPathWorkerInput,
  GraphwarOneClickClearPathWorkerResult,
  GraphwarPathfindingWorkerRequest,
} from "./protocol";
import { createGraphwarPathfindingRunner, isGraphwarPathfindingCancelledError } from "./runner";

const originalWorkerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
const emptyWasmModule = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

beforeEach(() => {
  FakeWorker.constructorAttempts = 0;
  FakeWorker.constructorFailureAttempts.clear();
  FakeWorker.instances.length = 0;
  FakeWorker.wasmBackendInitializationFailures = 0;
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: FakeWorker,
  });
});

afterEach(() => {
  if (originalWorkerDescriptor) {
    Object.defineProperty(globalThis, "Worker", originalWorkerDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "Worker");
  }
});

describe("Graphwar pathfinding runner incumbents", () => {
  it.each(["cancel", "close"] as const)(
    "%s immediately settles backend admission without creating a Worker after selection resolves",
    async (action) => {
      const deferred = createDeferredBackendSelection(4);
      const runner = createGraphwarPathfindingRunner({ createBackendSelection: () => deferred.selection });
      const result = runner.buildOneClickClearPath(createInput());

      runner[action]();

      await expect(result).rejects.toSatisfy(isGraphwarPathfindingCancelledError);
      deferred.resolve(createGraphwarTypescriptWorkerBackendConfiguration(4));
      await Promise.resolve();
      expect(FakeWorker.instances).toHaveLength(0);
      runner.close();
    },
  );

  it("rejects backend selection failure without creating a Worker", async () => {
    const deferred = createDeferredBackendSelection(4);
    const runner = createGraphwarPathfindingRunner({ createBackendSelection: () => deferred.selection });
    const result = runner.buildOneClickClearPath(createInput());

    deferred.reject(new Error("selection failed"));

    await expect(result).rejects.toThrow("selection failed");
    expect(FakeWorker.instances).toHaveLength(0);
    runner.close();
  });

  it("rejects when a synchronous WASM init fault cannot create its TypeScript fallback Worker", async () => {
    FakeWorker.wasmBackendInitializationFailures = 1;
    FakeWorker.constructorFailureAttempts.add(2);
    const deferred = createDeferredBackendSelection(4);
    const runner = createGraphwarPathfindingRunner({
      createBackendSelection: () => deferred.selection,
      onWasmFault: vi.fn(() => 9),
    });
    const result = runner.buildOneClickClearPath(createInput());

    deferred.resolve(createGraphwarWasmWorkerBackendConfiguration(4, emptyWasmModule));

    await expect(result).rejects.toThrow("constructor failed");
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].terminated).toBe(true);
    runner.close();
  });

  it("supersedes a loading request and starts only the latest owned mask snapshot", async () => {
    const selections = [createDeferredBackendSelection(4), createDeferredBackendSelection(4)];
    let selectionIndex = 0;
    const runner = createGraphwarPathfindingRunner({
      createBackendSelection: () => selections[selectionIndex++].selection,
    });
    const first = runner.buildOneClickClearPath(createInput());
    const firstCancelled = first.catch((error: unknown) => error);
    const latestInput = createInput();
    latestInput.routeObstacleMask[0] = 3;
    const latest = runner.buildOneClickClearPath(latestInput);
    latestInput.routeObstacleMask[0] = 9;

    selections[0].resolve(createGraphwarTypescriptWorkerBackendConfiguration(4));
    await Promise.resolve();
    expect(FakeWorker.instances).toHaveLength(0);
    await expect(firstCancelled).resolves.toSatisfy(isGraphwarPathfindingCancelledError);

    selections[1].resolve(createGraphwarTypescriptWorkerBackendConfiguration(4));
    await Promise.resolve();
    const worker = getWorker(0);
    const request = getOneClickClearRequest(worker, 0);
    expect(request.task.input.routeObstacleMask[0]).toBe(3);
    worker.emit({
      attempt: request.attempt,
      id: request.id,
      result: createResult(),
      taskType: "build-one-click-clear-path",
      type: "success",
    });
    await expect(latest).resolves.toMatchObject({ result: { targetIds: ["target"] } });
    runner.close();
  });

  it("replays a loading admission on TypeScript without waiting for the failed selection", async () => {
    const deferred = createDeferredBackendSelection(4);
    const runner = createGraphwarPathfindingRunner({ createBackendSelection: () => deferred.selection });
    const result = runner.buildOneClickClearPath(createInput());

    expect(runner.replayGenerationAsTypescript(4, 5, "trap: sibling failed")).toBe(true);

    const worker = getWorker(0);
    const request = getOneClickClearRequest(worker, 0);
    expect(request.attempt.backendGeneration).toBe(5);
    expect(worker.controlMessages[0]).toMatchObject({ backend: { type: "typescript" }, generation: 5 });
    deferred.resolve(createGraphwarTypescriptWorkerBackendConfiguration(4));
    await Promise.resolve();
    expect(FakeWorker.instances).toHaveLength(1);
    worker.emit({
      attempt: request.attempt,
      id: request.id,
      result: createResult(),
      taskType: "build-one-click-clear-path",
      type: "success",
    });
    await expect(result).resolves.toMatchObject({ result: { targetIds: ["target"] } });
    runner.close();
  });

  it("preserves the deletion preference in the cloned Worker request", async () => {
    const runner = createGraphwarPathfindingRunner();
    const input = createInput();
    input.isDeleteOptimizationEnabled = true;
    const resultPromise = runner.buildOneClickClearPath(input);
    const worker = getWorker(0);
    const request = getOneClickClearRequest(worker, 0);

    expect(worker.controlMessages).toEqual([
      {
        backend: { type: "typescript" },
        backendExecution: { effective: "typescript", requested: "typescript" },
        generation: 0,
        role: "pathfinding-master",
        type: "backend-init",
      },
    ]);
    expect(request.task.input.isDeleteOptimizationEnabled).toBe(true);
    expect(request.attempt.backendGeneration).toBe(0);
    worker.emit({
      attempt: request.attempt,
      id: request.id,
      result: createResult(),
      taskType: "build-one-click-clear-path",
      type: "success",
    });
    await resultPromise;
    runner.close();
  });

  it("reports a successful requested WASM search as effective WASM", async () => {
    const runner = createGraphwarPathfindingRunner({
      backendConfiguration: createGraphwarWasmWorkerBackendConfiguration(4, emptyWasmModule),
    });
    const resultPromise = runner.buildOneClickClearPath(createInput(), { shouldCollectDiagnostics: true });
    const worker = getWorker(0);
    const request = getOneClickClearRequest(worker, 0);

    worker.emit({
      attempt: request.attempt,
      id: request.id,
      result: createResult(createGraphwarPathfindingDebugMetrics(false)),
      taskType: "build-one-click-clear-path",
      type: "success",
    });

    await expect(resultPromise).resolves.toMatchObject({
      diagnostics: { backendExecution: { effective: "wasm", requested: "wasm" } },
    });
    runner.close();
  });

  it("reports typed WASM fault replay as requested WASM with an effective TS fallback", async () => {
    const onWasmFault = vi.fn();
    const runner = createGraphwarPathfindingRunner({
      backendConfiguration: createGraphwarWasmWorkerBackendConfiguration(4, emptyWasmModule),
      onWasmFault,
    });
    const resultPromise = runner.buildOneClickClearPath(createInput(), { shouldCollectDiagnostics: true });
    const wasmWorker = getWorker(0);
    const wasmRequest = getOneClickClearRequest(wasmWorker, 0);

    wasmWorker.emit({
      context: { attempt: wasmRequest.attempt, type: "task" },
      fault: { code: "trap", message: "search trapped" },
      generation: 4,
      role: "pathfinding-master",
      type: "wasm-fault",
    });

    const typescriptWorker = getWorker(1);
    const replayRequest = getOneClickClearRequest(typescriptWorker, 0);
    expect(replayRequest.task.input.wasmRequestNonce).not.toBe(wasmRequest.task.input.wasmRequestNonce);
    typescriptWorker.emit({
      attempt: replayRequest.attempt,
      id: replayRequest.id,
      result: createResult(createGraphwarPathfindingDebugMetrics(false)),
      taskType: "build-one-click-clear-path",
      type: "success",
    });

    expect(onWasmFault).toHaveBeenCalledOnce();
    await expect(resultPromise).resolves.toMatchObject({
      diagnostics: {
        backendExecution: {
          effective: "typescript",
          fallbackReason: "trap: search trapped",
          requested: "wasm",
        },
      },
    });
    runner.close();
  });

  it("reports synchronous WASM initialization once and uses the replacement generation", async () => {
    FakeWorker.wasmBackendInitializationFailures = 1;
    const onWasmFault = vi.fn(() => 9);
    const runner = createGraphwarPathfindingRunner({
      backendConfiguration: createGraphwarWasmWorkerBackendConfiguration(4, emptyWasmModule),
      onWasmFault,
    });

    const resultPromise = runner.buildOneClickClearPath(createInput(), { shouldCollectDiagnostics: true });
    const wasmWorker = getWorker(0);
    const typescriptWorker = getWorker(1);
    const replayRequest = getOneClickClearRequest(typescriptWorker, 0);

    expect(onWasmFault).toHaveBeenCalledOnce();
    expect(wasmWorker.terminated).toBe(true);
    expect(typescriptWorker.controlMessages[0]).toMatchObject({
      backend: { type: "typescript" },
      backendExecution: {
        effective: "typescript",
        fallbackReason: "module-clone: Module could not be cloned",
        requested: "wasm",
      },
      generation: 9,
    });
    expect(replayRequest.attempt.backendGeneration).toBe(9);
    typescriptWorker.emit({
      attempt: replayRequest.attempt,
      id: replayRequest.id,
      result: createResult(createGraphwarPathfindingDebugMetrics(false)),
      taskType: "build-one-click-clear-path",
      type: "success",
    });
    await expect(resultPromise).resolves.toMatchObject({
      diagnostics: {
        backendExecution: {
          effective: "typescript",
          fallbackReason: "module-clone: Module could not be cloned",
          requested: "wasm",
        },
      },
    });
    runner.close();
  });

  it("ignores a typed fault from a superseded pathfinding task", async () => {
    const onWasmFault = vi.fn(() => 9);
    const runner = createGraphwarPathfindingRunner({
      backendConfiguration: createGraphwarWasmWorkerBackendConfiguration(4, emptyWasmModule),
      onWasmFault,
    });
    const first = runner.buildOneClickClearPath(createInput());
    const firstCancelled = first.catch((error: unknown) => error);
    const firstWorker = getWorker(0);
    const firstRequest = getOneClickClearRequest(firstWorker, 0);
    const second = runner.buildOneClickClearPath(createInput());
    const secondWorker = getWorker(1);
    const secondRequest = getOneClickClearRequest(secondWorker, 0);

    firstWorker.emit({
      context: { attempt: firstRequest.attempt, type: "task" },
      fault: { code: "trap", message: "late pathfinding fault" },
      generation: 4,
      role: "pathfinding-master",
      type: "wasm-fault",
    });

    await expect(firstCancelled).resolves.toSatisfy(isGraphwarPathfindingCancelledError);
    expect(onWasmFault).not.toHaveBeenCalled();
    secondWorker.emit({
      attempt: secondRequest.attempt,
      id: secondRequest.id,
      result: createResult(),
      taskType: "build-one-click-clear-path",
      type: "success",
    });
    await expect(second).resolves.toMatchObject({ result: { targetIds: ["target"] } });
    runner.close();
  });

  it("opts into progress and forwards the current request's incumbent", async () => {
    const onIncumbent = vi.fn();
    const runner = createGraphwarPathfindingRunner();
    const resultPromise = runner.buildOneClickClearPath(createInput(), {
      onIncumbent,
      shouldCollectDiagnostics: true,
    });
    const worker = getWorker(0);
    const request = getOneClickClearRequest(worker, 0);
    const incumbent = createIncumbent("target");
    const diagnostics = createGraphwarPathfindingDebugMetrics(true);

    expect(request.task.shouldReportIncumbents).toBe(true);
    worker.emit({
      attempt: { ...request.attempt, attemptId: request.attempt.attemptId + 100 },
      id: request.id,
      progress: { incumbent: createIncumbent("stale-attempt") },
      type: "one-click-clear-incumbent",
    });
    expect(onIncumbent).not.toHaveBeenCalled();
    worker.emit({
      attempt: request.attempt,
      id: request.id,
      progress: { diagnostics, incumbent, sequence: 1 },
      type: "one-click-clear-incumbent",
    });

    expect(onIncumbent).toHaveBeenCalledWith({ diagnostics, incumbent, sequence: 1 });
    expect(diagnostics.backendExecution).toEqual({ effective: "typescript", requested: "typescript" });
    worker.emit({
      attempt: request.attempt,
      id: request.id,
      progress: { diagnostics, incumbent, sequence: 1 },
      type: "one-click-clear-incumbent",
    });
    expect(onIncumbent).toHaveBeenCalledTimes(1);
    worker.emit({
      attempt: request.attempt,
      id: request.id,
      result: createResult(),
      taskType: "build-one-click-clear-path",
      type: "success",
    });
    await expect(resultPromise).resolves.toEqual(createResult());
    runner.close();
  });

  it("ignores superseded and explicitly cancelled progress", async () => {
    const firstProgress = vi.fn();
    const secondProgress = vi.fn();
    const runner = createGraphwarPathfindingRunner();
    const first = runner.buildOneClickClearPath(createInput(), { onIncumbent: firstProgress });
    const firstError = first.catch((error: unknown) => error);
    const firstWorker = getWorker(0);
    const firstRequest = getOneClickClearRequest(firstWorker, 0);

    const second = runner.buildOneClickClearPath(createInput(), { onIncumbent: secondProgress });
    const secondError = second.catch((error: unknown) => error);
    const secondWorker = getWorker(1);
    const secondRequest = getOneClickClearRequest(secondWorker, 0);
    firstWorker.emit({
      attempt: firstRequest.attempt,
      id: firstRequest.id,
      progress: { incumbent: createIncumbent("stale") },
      type: "one-click-clear-incumbent",
    });

    expect(isGraphwarPathfindingCancelledError(await firstError)).toBe(true);
    expect(firstProgress).not.toHaveBeenCalled();
    expect(secondProgress).not.toHaveBeenCalled();

    runner.cancel();
    secondWorker.emit({
      attempt: secondRequest.attempt,
      id: secondRequest.id,
      progress: { incumbent: createIncumbent("cancelled") },
      type: "one-click-clear-incumbent",
    });

    expect(isGraphwarPathfindingCancelledError(await secondError)).toBe(true);
    expect(secondProgress).not.toHaveBeenCalled();
    expect(firstWorker.terminated).toBe(true);
    expect(secondWorker.terminated).toBe(true);
    runner.close();
  });

  it("ignores malformed messages and errors from a superseded Worker", async () => {
    const runner = createGraphwarPathfindingRunner();
    const firstResult = runner.buildOneClickClearPath(createInput());
    const firstError = firstResult.catch((error: unknown) => error);
    const firstWorker = getWorker(0);

    const secondResult = runner.buildOneClickClearPath(createInput());
    const secondWorker = getWorker(1);
    const secondRequest = getOneClickClearRequest(secondWorker, 0);
    firstWorker.emit(null);
    firstWorker.emitMessageError();
    firstWorker.emitError(new Error("stale Worker failure"));

    expect(isGraphwarPathfindingCancelledError(await firstError)).toBe(true);
    expect(secondWorker.terminated).toBe(false);
    secondWorker.emit({
      attempt: secondRequest.attempt,
      id: secondRequest.id,
      result: createResult(),
      taskType: "build-one-click-clear-path",
      type: "success",
    });
    await expect(secondResult).resolves.toEqual(createResult());
    runner.close();
  });

  it.each([
    { label: "missing", routes: [{ jobId: 1 }] },
    { label: "duplicate", routes: [{ jobId: 1 }, { jobId: 1 }] },
    { label: "unexpected", routes: [{ jobId: 1 }, { jobId: 2 }, { jobId: 3 }] },
    {
      label: "mismatched route policy",
      routes: [
        {
          jobId: 1,
          route: [createPixelPoint(100, 225), createPixelPoint(150, 225)],
          stepRouteEndState: { resolvedStateKey: "0", resolvedY: 0 },
          type: "step-stateful",
        },
        { jobId: 2, type: "unreachable" },
      ],
    },
  ])("rejects a DAG success response with $label job ids", async ({ routes }) => {
    const runner = createGraphwarPathfindingRunner();
    const resultPromise = runner.buildOneClickClearDagEdges(createDagEdgeInput());
    const worker = getWorker(0);
    const request = worker.requests[0];
    if (!request || request.task.type !== "build-one-click-clear-dag-edges") {
      throw new Error("Expected DAG edge Worker request");
    }

    worker.emit({
      attempt: request.attempt,
      id: request.id,
      result: { routes, timings: [] },
      taskType: "build-one-click-clear-dag-edges",
      type: "success",
    });

    await expect(resultPromise).rejects.toThrow("invalid response");
    expect(worker.terminated).toBe(true);
    runner.close();
  });

  it("rejects debug progress without requested diagnostics", async () => {
    const onIncumbent = vi.fn();
    const runner = createGraphwarPathfindingRunner();
    const resultPromise = runner.buildOneClickClearPath(createInput(), {
      onIncumbent,
      shouldCollectDiagnostics: true,
    });
    const worker = getWorker(0);
    const request = getOneClickClearRequest(worker, 0);

    worker.emit({
      attempt: request.attempt,
      id: request.id,
      progress: { incumbent: createIncumbent("missing-diagnostics") },
      type: "one-click-clear-incumbent",
    });

    await expect(resultPromise).rejects.toThrow("invalid response");
    expect(onIncumbent).not.toHaveBeenCalled();
    expect(worker.terminated).toBe(true);
    runner.close();
  });

  it("rejects diagnostics that were not requested", async () => {
    const onIncumbent = vi.fn();
    const runner = createGraphwarPathfindingRunner();
    const resultPromise = runner.buildOneClickClearPath(createInput(), { onIncumbent });
    const worker = getWorker(0);
    const request = getOneClickClearRequest(worker, 0);

    worker.emit({
      attempt: request.attempt,
      id: request.id,
      progress: {
        diagnostics: createGraphwarPathfindingDebugMetrics(true),
        incumbent: createIncumbent("unexpected-diagnostics"),
      },
      type: "one-click-clear-incumbent",
    });

    await expect(resultPromise).rejects.toThrow("invalid response");
    expect(onIncumbent).not.toHaveBeenCalled();
    expect(worker.terminated).toBe(true);
    runner.close();
  });
});

class FakeWorker {
  static constructorAttempts = 0;
  static readonly constructorFailureAttempts = new Set<number>();
  static readonly instances: FakeWorker[] = [];
  static wasmBackendInitializationFailures = 0;
  readonly controlMessages: GraphwarBackendControlMessage[] = [];
  readonly requests: GraphwarPathfindingWorkerRequest[] = [];
  terminated = false;
  private readonly listeners = {
    error: [] as ((event: ErrorEvent) => void)[],
    message: [] as ((event: MessageEvent<unknown>) => void)[],
    messageerror: [] as ((event: MessageEvent) => void)[],
  };

  constructor() {
    FakeWorker.constructorAttempts += 1;
    if (FakeWorker.constructorFailureAttempts.has(FakeWorker.constructorAttempts)) {
      throw new Error("constructor failed");
    }
    FakeWorker.instances.push(this);
  }

  addEventListener(type: "error" | "message" | "messageerror", listener: EventListener) {
    this.listeners[type].push(listener as never);
  }

  removeEventListener(type: "error" | "message" | "messageerror", listener: EventListener) {
    const listeners = this.listeners[type];
    const index = listeners.indexOf(listener as never);
    if (index >= 0) {
      listeners.splice(index, 1);
    }
  }

  postMessage(message: GraphwarBackendControlMessage | GraphwarPathfindingWorkerRequest) {
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

  /** 测试刻意允许已终止 Worker 发出迟到消息，以验证请求身份防护。 */
  emit(response: unknown) {
    const event = { data: response } as MessageEvent<unknown>;
    for (const listener of this.listeners.message) {
      listener(event);
    }
  }

  /** 模拟已终止 Worker 的迟到 messageerror。 */
  emitMessageError() {
    for (const listener of this.listeners.messageerror) {
      listener({} as MessageEvent);
    }
  }

  /** 模拟已终止 Worker 的迟到运行时错误。 */
  emitError(error: Error) {
    for (const listener of this.listeners.error) {
      listener({ error, message: error.message } as ErrorEvent);
    }
  }
}

/** 返回测试创建的指定 Worker，缺失时立即暴露生命周期错误。 */
function getWorker(index: number) {
  const worker = FakeWorker.instances[index];
  if (!worker) {
    throw new Error(`Expected pathfinding Worker ${index}`);
  }
  return worker;
}

/** 读取并收窄一键清图请求。 */
function getOneClickClearRequest(worker: FakeWorker, index: number) {
  const request = worker.requests[index];
  if (!request || request.task.type !== "build-one-click-clear-path") {
    throw new Error("Expected one-click-clear Worker request");
  }
  return { attempt: request.attempt, id: request.id, task: request.task };
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

/** 构造无需执行实际搜索的纯数据输入。 */
function createInput(): GraphwarOneClickClearPathWorkerInput {
  return {
    boundaryExpansion: 0,
    bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
    boundsRect: { height: 450, width: 770, x: 0, y: 0 },
    candidates: [],
    dagEdgeWorkerCount: 1,
    isDeleteOptimizationEnabled: false,
    deleteHitCheckRadiusPixels: 0,
    hitCandidates: [],
    pathPoints: [createPixelPoint(100, 225)],
    routeMaskCacheId: 1,
    routeMode: "visibility-graph",
    routeObstacleMask: new Uint8Array(770 * 450),
    routeTolerancePlanePixels: 2,
    settings: {
      algorithm: "abs",
      decimalPlaces: 4,
      equation: "y",
      steepness: 67,
      isStepGlitchModeEnabled: false,
      isStepOverflowProtectionEnabled: true,
    },
    simulationBoundaryExpansion: 0,
    simulationMaskCacheId: 0,
  };
}

/** 构造两个稳定 job id 的 DAG edge 请求。 */
function createDagEdgeInput(): GraphwarOneClickClearDagEdgeBuildRequest {
  return {
    boundaryExpansion: 0,
    bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
    boundsRect: { height: 450, width: 770, x: 0, y: 0 },
    jobs: [
      {
        from: -1,
        id: 1,
        startPoint: createPixelPoint(100, 225),
        targetPoint: createPixelPoint(150, 225),
        to: 0,
        type: "stateless",
      },
      {
        from: 0,
        id: 2,
        startPoint: createPixelPoint(150, 225),
        targetPoint: createPixelPoint(200, 225),
        to: 1,
        type: "stateless",
      },
    ],
    routeMask: new Uint8Array(770 * 450),
    routeMode: "visibility-graph",
    routeOriginPoint: createPixelPoint(100, 225),
    routeTolerancePlanePixels: 2,
    settings: { algorithm: "abs", decimalPlaces: 4, equation: "y", steepness: 67 },
    workerCount: 1,
  };
}

/** 构造可识别来源的 progress payload。 */
function createIncumbent(id: string): GraphwarOneClickClearIncumbent {
  return {
    expression: id,
    pathPoints: [createPixelPoint(100, 225), createPixelPoint(200, 225)],
    trajectoryPoints: [createPixelPoint(100, 225), createPixelPoint(200, 225)],
  };
}

/** 构造 master Worker 的最终任务结果。 */
function createResult(
  diagnostics?: GraphwarOneClickClearPathWorkerResult["diagnostics"],
): GraphwarOneClickClearPathWorkerResult {
  return {
    ...(diagnostics ? { diagnostics } : {}),
    result: {
      elapsedMs: 1,
      expression: "x",
      expandedStates: 1,
      pathPoints: [createPixelPoint(100, 225), createPixelPoint(200, 225)],
      targetIds: ["target"],
      trajectoryPoints: [createPixelPoint(100, 225), createPixelPoint(200, 225)],
      type: "success",
    },
    timings: [],
  };
}
