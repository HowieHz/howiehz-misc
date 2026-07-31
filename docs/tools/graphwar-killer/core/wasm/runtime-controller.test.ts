import { describe, expect, it, vi } from "vitest";

import { GraphwarWasmFault } from "../algorithm-backend";
import { createGraphwarWasmRuntimeController } from "./runtime-controller";

const emptyModule = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

describe("Graphwar WASM runtime controller", () => {
  it("loads once and resolves waiting tasks to the ready module", async () => {
    const compileModule = vi.fn(async () => emptyModule);
    const controller = createGraphwarWasmRuntimeController({ compileModule, url: "/kernel.wasm" });

    const firstLoad = controller.enable();
    const secondLoad = controller.enable();
    const backendPromise = controller.resolveWorkerBackend();

    expect(firstLoad).toBe(secondLoad);
    await expect(firstLoad).resolves.toBe(emptyModule);
    await expect(backendPromise).resolves.toEqual({
      backend: { module: emptyModule, type: "wasm" },
      backendExecution: { effective: "wasm", requested: "wasm" },
      generation: 1,
    });
    expect(controller.getState()).toEqual({ generation: 1, module: emptyModule, type: "ready" });
    expect(compileModule).toHaveBeenCalledOnce();
  });

  it("publishes frozen state snapshots without exposing controller guards", async () => {
    let finishCompile: ((module: WebAssembly.Module) => void) | undefined;
    const controller = createGraphwarWasmRuntimeController({
      compileModule: () =>
        new Promise((resolve) => {
          finishCompile = resolve;
        }),
    });
    const observedStates: ReturnType<typeof controller.getState>[] = [];
    controller.subscribe((state) => observedStates.push(state));

    void controller.enable();
    const loadingState = controller.getState();
    expect(Object.isFrozen(loadingState)).toBe(true);
    expect(Reflect.set(loadingState, "generation", 99)).toBe(false);
    expect(observedStates[0]).not.toBe(loadingState);
    finishCompile?.(emptyModule);

    await expect(controller.resolveWorkerBackend()).resolves.toEqual({
      backend: { module: emptyModule, type: "wasm" },
      backendExecution: { effective: "wasm", requested: "wasm" },
      generation: 1,
    });
    expect(controller.getState()).toEqual({ generation: 1, module: emptyModule, type: "ready" });
  });

  it("aborts loading and permanently fixes existing waiters to TypeScript", async () => {
    const compileModule = vi
      .fn<(url: string, signal: AbortSignal) => Promise<WebAssembly.Module>>()
      .mockImplementationOnce(
        (_url, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          }),
      )
      .mockResolvedValueOnce(emptyModule);
    const controller = createGraphwarWasmRuntimeController({ compileModule });

    const firstLoad = controller.enable();
    const oldSelection = controller.resolveWorkerBackend();
    controller.disable();
    const secondLoad = controller.enable();

    await expect(firstLoad).rejects.toThrow("Aborted");
    await expect(oldSelection).resolves.toEqual({
      backend: { type: "typescript" },
      backendExecution: { effective: "typescript", requested: "typescript" },
      generation: 2,
    });
    await expect(secondLoad).resolves.toBe(emptyModule);
    await expect(controller.resolveWorkerBackend()).resolves.toEqual({
      backend: { module: emptyModule, type: "wasm" },
      backendExecution: { effective: "wasm", requested: "wasm" },
      generation: 3,
    });
  });

  it("isolates throwing listeners so disable still aborts and settles waiters", async () => {
    const controller = createGraphwarWasmRuntimeController({
      compileModule: (_url, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    });
    controller.subscribe(() => {
      throw new Error("listener failed");
    });

    const load = controller.enable();
    const selection = controller.resolveWorkerBackend();
    controller.disable();

    await expect(load).rejects.toThrow("Aborted");
    await expect(selection).resolves.toEqual({
      backend: { type: "typescript" },
      backendExecution: { effective: "typescript", requested: "typescript" },
      generation: 2,
    });
    expect(controller.getState()).toEqual({ generation: 2, type: "off" });
  });

  it("fixes a loading selection to TS when a ready listener disables reentrantly", async () => {
    const controller = createGraphwarWasmRuntimeController({ compileModule: async () => emptyModule });
    controller.subscribe((state) => {
      if (state.type === "ready") {
        controller.disable();
      }
    });

    const load = controller.enable();
    const selection = controller.resolveWorkerBackend();

    await expect(load).resolves.toBe(emptyModule);
    await expect(selection).resolves.toEqual({
      backend: { type: "typescript" },
      backendExecution: { effective: "typescript", requested: "typescript" },
      generation: 2,
    });
    expect(controller.getState()).toEqual({ generation: 2, type: "off" });
  });

  it("degrades one generation exactly once and supports an explicit retry", async () => {
    const controller = createGraphwarWasmRuntimeController({ compileModule: async () => emptyModule });
    await controller.enable();

    expect(controller.degrade(1, new GraphwarWasmFault("trap", "trajectory trapped"))).toBe(true);
    expect(controller.degrade(1, new GraphwarWasmFault("trap", "late fault"))).toBe(false);
    expect(controller.getState()).toEqual({ generation: 2, reason: "trap: trajectory trapped", type: "degraded" });
    await expect(controller.resolveWorkerBackend()).resolves.toEqual({
      backend: { type: "typescript" },
      backendExecution: {
        effective: "typescript",
        fallbackReason: "trap: trajectory trapped",
        requested: "wasm",
      },
      generation: 2,
    });

    await controller.enable();
    expect(controller.getState()).toEqual({ generation: 3, module: emptyModule, type: "ready" });
  });

  it("turns a loader failure into degraded state and a TS selection", async () => {
    const controller = createGraphwarWasmRuntimeController({
      compileModule: async () => {
        throw new GraphwarWasmFault("compile", "invalid bytes");
      },
    });

    const load = controller.enable();
    const selection = controller.resolveWorkerBackend();
    await expect(load).rejects.toThrow("invalid bytes");
    await expect(selection).resolves.toEqual({
      backend: { type: "typescript" },
      backendExecution: { effective: "typescript", fallbackReason: "compile: invalid bytes", requested: "wasm" },
      generation: 2,
    });
    expect(controller.getState()).toEqual({ generation: 2, reason: "compile: invalid bytes", type: "degraded" });
  });

  it("normalizes a synchronous loader throw without escaping enable", async () => {
    const controller = createGraphwarWasmRuntimeController({
      compileModule: () => {
        throw new Error("WebAssembly is unavailable");
      },
    });

    const load = controller.enable();
    const selection = controller.resolveWorkerBackend();

    await expect(load).rejects.toThrow("WebAssembly is unavailable");
    await expect(selection).resolves.toEqual({
      backend: { type: "typescript" },
      backendExecution: {
        effective: "typescript",
        fallbackReason: "WebAssembly is unavailable",
        requested: "wasm",
      },
      generation: 2,
    });
    expect(controller.getState()).toEqual({
      generation: 2,
      reason: "WebAssembly is unavailable",
      type: "degraded",
    });
  });

  it("discards an unabortable compile result after disable and retry", async () => {
    let finishFirstCompile: ((module: WebAssembly.Module) => void) | undefined;
    const compileModule = vi
      .fn<() => Promise<WebAssembly.Module>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirstCompile = resolve;
          }),
      )
      .mockResolvedValueOnce(emptyModule);
    const controller = createGraphwarWasmRuntimeController({ compileModule });

    void controller.enable();
    const oldSelection = controller.resolveWorkerBackend();
    controller.disable();
    await controller.enable();
    finishFirstCompile?.(emptyModule);
    await Promise.resolve();

    await expect(oldSelection).resolves.toEqual({
      backend: { type: "typescript" },
      backendExecution: { effective: "typescript", requested: "typescript" },
      generation: 2,
    });
    expect(controller.getState()).toEqual({ generation: 3, module: emptyModule, type: "ready" });
    expect(compileModule).toHaveBeenCalledTimes(2);
  });

  it("treats an unexpected authoritative abort as a loader fault", async () => {
    const abortController = new AbortController();
    abortController.abort();
    const controller = createGraphwarWasmRuntimeController({
      compileModule: async (_url, signal) => {
        expect(signal.aborted).toBe(true);
        throw new DOMException("Unexpected abort", "AbortError");
      },
      createAbortController: () => abortController,
    });

    const load = controller.enable();
    const selection = controller.resolveWorkerBackend();

    await expect(load).rejects.toThrow("Unexpected abort");
    await expect(selection).resolves.toEqual({
      backend: { type: "typescript" },
      backendExecution: { effective: "typescript", fallbackReason: "Unexpected abort", requested: "wasm" },
      generation: 2,
    });
    expect(controller.getState()).toEqual({ generation: 2, reason: "Unexpected abort", type: "degraded" });
  });
});
