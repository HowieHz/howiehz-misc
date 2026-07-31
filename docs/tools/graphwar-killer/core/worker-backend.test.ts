import { describe, expect, it, vi } from "vitest";

import {
  createGraphwarWasmWorkerBackendConfiguration,
  createGraphwarTypescriptWorkerBackendConfiguration,
  GraphwarValidatedWasmRuntime,
  GraphwarWasmFault,
  type GraphwarBackendAttemptIdentity,
  type GraphwarBackendControlMessage,
} from "./algorithm-backend";
import { GraphwarWasmAdapterError } from "./wasm/abi";
import {
  createGraphwarWorkerBackendRuntime,
  createGraphwarWorkerBackendSlot,
  executeGraphwarWorkerTask,
} from "./worker-backend";

const attempt = {
  attemptId: 2,
  backendGeneration: 4,
  outerTaskId: 1,
} satisfies GraphwarBackendAttemptIdentity;
const typescriptBackendExecution = { effective: "typescript", requested: "typescript" } as const;
const wasmBackendExecution = { effective: "wasm", requested: "wasm" } as const;

class TestValidatedRuntime extends GraphwarValidatedWasmRuntime {
  readonly testId: string;

  constructor(testId: string) {
    super();
    this.testId = testId;
  }
}

describe("Graphwar Worker backend control", () => {
  it("initializes a TypeScript Worker and consumes ready separately from task messages", async () => {
    const outbound: GraphwarBackendControlMessage[] = [];
    const runtime = createGraphwarWorkerBackendRuntime({
      postControlMessage: (message) => outbound.push(message),
      role: "trajectory",
    });
    const initialization = {
      backend: { type: "typescript" as const },
      backendExecution: typescriptBackendExecution,
      generation: 4,
      role: "trajectory" as const,
      type: "backend-init" as const,
    };

    expect(runtime.handleMessage(initialization)).toBe(true);
    await expect(runtime.waitForBackend(attempt)).resolves.toMatchObject({ generation: 4, type: "typescript" });
    expect(outbound).toEqual([{ backend: "typescript", generation: 4, role: "trajectory", type: "backend-ready" }]);
    expect(runtime.handleMessage({ attempt, id: 3 })).toBe(false);
  });

  it("waits for one WASM instantiation and exposes the same module to nested workers", async () => {
    let finishInstantiation: ((runtime: TestValidatedRuntime) => void) | undefined;
    const instantiateRuntime = vi.fn(
      () =>
        new Promise<TestValidatedRuntime>((resolve) => {
          finishInstantiation = resolve;
        }),
    );
    const outbound: GraphwarBackendControlMessage[] = [];
    const module = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
    const runtime = createGraphwarWorkerBackendRuntime({
      instantiateRuntime,
      postControlMessage: (message) => outbound.push(message),
      role: "detection-main",
    });
    runtime.handleMessage({
      backend: { module, type: "wasm" },
      backendExecution: wasmBackendExecution,
      generation: 4,
      role: "detection-main",
      type: "backend-init",
    });

    const ready = runtime.waitForBackend(attempt);
    expect(instantiateRuntime).toHaveBeenCalledOnce();
    finishInstantiation?.(new TestValidatedRuntime("detection-main"));
    await expect(ready).resolves.toMatchObject({ generation: 4, type: "wasm" });
    expect(runtime.getNestedConfiguration(attempt)).toEqual({
      backend: { module, type: "wasm" },
      backendExecution: wasmBackendExecution,
      generation: 4,
    });
    expect(outbound.at(-1)).toEqual({
      backend: "wasm",
      generation: 4,
      role: "detection-main",
      type: "backend-ready",
    });
  });

  it("reports instantiate failure as a typed initialization fault", async () => {
    const outbound: GraphwarBackendControlMessage[] = [];
    const module = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
    const runtime = createGraphwarWorkerBackendRuntime({
      instantiateRuntime: async () => {
        throw new Error("instantiate rejected");
      },
      postControlMessage: (message) => outbound.push(message),
      role: "pathfinding-master",
    });
    runtime.handleMessage({
      backend: { module, type: "wasm" },
      backendExecution: wasmBackendExecution,
      generation: 4,
      role: "pathfinding-master",
      type: "backend-init",
    });

    await expect(runtime.waitForBackend(attempt)).rejects.toThrow("instantiate rejected");
    expect(outbound).toEqual([
      {
        context: { type: "initialization" },
        fault: { code: "instantiate", message: "instantiate rejected" },
        generation: 4,
        role: "pathfinding-master",
        type: "wasm-fault",
      },
    ]);
  });

  it("tracks root slot ready separately from task messages", () => {
    const messages: unknown[] = [];
    const wasmFaults: Extract<GraphwarBackendControlMessage, { type: "wasm-fault" }>[] = [];
    const infrastructureFailures: Error[] = [];
    const slot = createGraphwarWorkerBackendSlot({
      configuration: createGraphwarTypescriptWorkerBackendConfiguration(4),
      onInfrastructureFailure: (error) => infrastructureFailures.push(error),
      onWasmFault: (message) => wasmFaults.push(message),
      role: "live-click-preview",
      worker: { postMessage: (message) => messages.push(message) },
    });

    expect(messages).toEqual([
      {
        backend: { type: "typescript" },
        backendExecution: typescriptBackendExecution,
        generation: 4,
        role: "live-click-preview",
        type: "backend-init",
      },
    ]);
    expect(
      slot.handleMessage({
        backend: "typescript",
        generation: 4,
        role: "live-click-preview",
        type: "backend-ready",
      }),
    ).toBe(true);
    expect(slot.getState()).toEqual({ backend: "typescript", generation: 4, type: "ready" });
    expect(slot.handleMessage({ attempt, id: 1 })).toBe(false);
    expect(wasmFaults).toEqual([]);
    expect(infrastructureFailures).toEqual([]);
  });

  it("classifies a root WASM Module clone failure as a typed page fault", () => {
    const module = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
    const onInfrastructureFailure = vi.fn();
    const onWasmFault = vi.fn();
    const slot = createGraphwarWorkerBackendSlot({
      configuration: createGraphwarWasmWorkerBackendConfiguration(4, module),
      onInfrastructureFailure,
      onWasmFault,
      role: "pathfinding-master",
      worker: {
        postMessage: () => {
          throw new DOMException("Module could not be cloned", "DataCloneError");
        },
      },
    });

    expect(slot.getState()).toMatchObject({ generation: 4, type: "failed" });
    expect(onWasmFault).toHaveBeenCalledWith({
      context: { type: "initialization" },
      fault: { code: "module-clone", message: "Module could not be cloned" },
      generation: 4,
      role: "pathfinding-master",
      type: "wasm-fault",
    });
    expect(onInfrastructureFailure).not.toHaveBeenCalled();
  });

  it.each([new DOMException("Worker was terminated", "InvalidStateError"), new Error("Worker transport failed")])(
    "keeps non-clone initialization errors as infrastructure failures",
    (postError) => {
      const module = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
      const onInfrastructureFailure = vi.fn();
      const onWasmFault = vi.fn();
      createGraphwarWorkerBackendSlot({
        configuration: createGraphwarWasmWorkerBackendConfiguration(4, module),
        onInfrastructureFailure,
        onWasmFault,
        role: "trajectory",
        worker: {
          postMessage: () => {
            throw postError;
          },
        },
      });

      expect(onInfrastructureFailure).toHaveBeenCalledWith(postError);
      expect(onWasmFault).not.toHaveBeenCalled();
    },
  );

  it("drops a stale child fault before it can fail the slot", () => {
    const module = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
    const onWasmFault = vi.fn();
    const slot = createGraphwarWorkerBackendSlot({
      configuration: createGraphwarWasmWorkerBackendConfiguration(4, module),
      onInfrastructureFailure: vi.fn(),
      onWasmFault,
      role: "detection-template",
      shouldAcceptWasmFault: () => false,
      worker: { postMessage: vi.fn() },
    });

    expect(
      slot.handleMessage({
        context: {
          attempt,
          session: { backendGeneration: 4, nonce: 1, requestId: 7, taskType: "detection" },
          shardId: 1,
          type: "template-shard",
        },
        fault: { code: "trap", message: "late shard" },
        generation: 4,
        role: "detection-template",
        type: "wasm-fault",
      }),
    ).toBe(true);
    expect(slot.getState()).toEqual({ backend: "wasm", generation: 4, type: "initializing" });
    expect(onWasmFault).not.toHaveBeenCalled();
  });

  it("reports a ready Worker task fault once with its task provenance", async () => {
    const outbound: GraphwarBackendControlMessage[] = [];
    const module = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
    const runtime = createGraphwarWorkerBackendRuntime({
      instantiateRuntime: async () => new TestValidatedRuntime("trajectory"),
      postControlMessage: (message) => outbound.push(message),
      role: "trajectory",
    });
    runtime.handleMessage({
      backend: { module, type: "wasm" },
      backendExecution: wasmBackendExecution,
      generation: 4,
      role: "trajectory",
      type: "backend-init",
    });

    await expect(
      executeGraphwarWorkerTask(runtime, attempt, { attempt, type: "task" }, () => {
        throw new GraphwarWasmFault("trap", "trajectory trapped");
      }),
    ).resolves.toEqual({ type: "wasm-fault" });
    expect(outbound).toEqual([
      { backend: "wasm", generation: 4, role: "trajectory", type: "backend-ready" },
      {
        context: { attempt, type: "task" },
        fault: { code: "trap", message: "trajectory trapped" },
        generation: 4,
        role: "trajectory",
        type: "wasm-fault",
      },
    ]);
  });

  it.each([
    ["invalid-point-data", "input"],
    ["invalid-point-data", "output"],
    ["invalid-session-state", "abi"],
  ] as const)("preserves the %s WASM Adapter failure's %s fault domain", async (adapterCode, faultCode) => {
    const outbound: GraphwarBackendControlMessage[] = [];
    const module = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
    const runtime = createGraphwarWorkerBackendRuntime({
      instantiateRuntime: async () => new TestValidatedRuntime("detection"),
      postControlMessage: (message) => outbound.push(message),
      role: "detection-main",
    });
    runtime.handleMessage({
      backend: { module, type: "wasm" },
      backendExecution: wasmBackendExecution,
      generation: 4,
      role: "detection-main",
      type: "backend-init",
    });

    await expect(
      executeGraphwarWorkerTask(runtime, attempt, { attempt, type: "task" }, () => {
        throw new GraphwarWasmAdapterError(adapterCode, "WASM Adapter task failed", faultCode);
      }),
    ).resolves.toEqual({ type: "wasm-fault" });
    expect(outbound).toEqual([
      { backend: "wasm", generation: 4, role: "detection-main", type: "backend-ready" },
      {
        context: { attempt, type: "task" },
        fault: { code: faultCode, message: "WASM Adapter task failed" },
        generation: 4,
        role: "detection-main",
        type: "wasm-fault",
      },
    ]);
  });

  it("does not classify an Adapter-shaped TypeScript task failure as a WASM fault", async () => {
    const outbound: GraphwarBackendControlMessage[] = [];
    const runtime = createGraphwarWorkerBackendRuntime({
      postControlMessage: (message) => outbound.push(message),
      role: "detection-main",
    });
    runtime.handleMessage({
      backend: { type: "typescript" },
      backendExecution: typescriptBackendExecution,
      generation: 4,
      role: "detection-main",
      type: "backend-init",
    });
    const error = new GraphwarWasmAdapterError("invalid-detection-result", "ordinary TypeScript failure", "output");

    await expect(
      executeGraphwarWorkerTask(runtime, attempt, { attempt, type: "task" }, () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(outbound).toEqual([{ backend: "typescript", generation: 4, role: "detection-main", type: "backend-ready" }]);
  });

  it("drops stale generation control messages without failing the current slot", () => {
    const onInfrastructureFailure = vi.fn();
    const onWasmFault = vi.fn();
    const slot = createGraphwarWorkerBackendSlot({
      configuration: createGraphwarTypescriptWorkerBackendConfiguration(4),
      onInfrastructureFailure,
      onWasmFault,
      role: "trajectory",
      worker: { postMessage: vi.fn() },
    });

    expect(
      slot.handleMessage({ backend: "typescript", generation: 3, role: "trajectory", type: "backend-ready" }),
    ).toBe(true);
    expect(
      slot.handleMessage({
        context: { type: "initialization" },
        fault: { code: "instantiate", message: "late fault" },
        generation: 3,
        role: "trajectory",
        type: "wasm-fault",
      }),
    ).toBe(true);
    expect(slot.getState()).toEqual({ backend: "typescript", generation: 4, type: "initializing" });
    expect(onInfrastructureFailure).not.toHaveBeenCalled();
    expect(onWasmFault).not.toHaveBeenCalled();
  });

  it("does not classify invalid TypeScript initialization as a WASM fault", async () => {
    const outbound: GraphwarBackendControlMessage[] = [];
    const runtime = createGraphwarWorkerBackendRuntime({
      postControlMessage: (message) => outbound.push(message),
      role: "trajectory",
    });
    runtime.handleMessage({
      backend: { type: "typescript" },
      backendExecution: typescriptBackendExecution,
      generation: 4,
      role: "trajectory",
      type: "backend-init",
    });
    await runtime.waitForBackend(attempt);

    expect(() =>
      runtime.handleMessage({
        backend: { type: "typescript" },
        backendExecution: typescriptBackendExecution,
        generation: 4,
        role: "trajectory",
        type: "backend-init",
      }),
    ).toThrow("invalid backend initialization");
    expect(() => runtime.reportWasmFault({ attempt, type: "task" }, new Error("not WASM"))).toThrow(
      "without an active WASM backend",
    );
    expect(outbound).toEqual([{ backend: "typescript", generation: 4, role: "trajectory", type: "backend-ready" }]);
  });
});
