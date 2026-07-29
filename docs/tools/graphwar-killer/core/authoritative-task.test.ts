import { describe, expect, it, vi } from "vitest";

import { createGraphwarTypescriptWorkerBackendConfiguration } from "./algorithm-backend";
import type { GraphwarAuthoritativeAttemptContext } from "./authoritative-task";
import { createGraphwarAuthoritativeTaskCoordinator } from "./authoritative-task";
import { createGraphwarWasmRuntimeController } from "./wasm/runtime-controller";

interface Input {
  bytes: Uint8Array;
  settings: { scale: number };
}

interface Snapshot {
  bytes: Uint8Array;
  settings: { scale: number };
}

interface AttemptRecord {
  cancel: ReturnType<typeof vi.fn>;
  context: GraphwarAuthoritativeAttemptContext<Snapshot, string>;
  reject: (reason?: unknown) => void;
  resolve: (result: string) => void;
}

function createHarness() {
  const attempts: AttemptRecord[] = [];
  const coordinator = createGraphwarAuthoritativeTaskCoordinator<Input, Snapshot, string, string>({
    cloneInput: (input) => ({ bytes: input.bytes.slice(), settings: { scale: input.settings.scale } }),
    cloneSnapshotForAttempt: (snapshot) => ({
      bytes: snapshot.bytes.slice(),
      settings: { scale: snapshot.settings.scale },
    }),
    executeAttempt: (context) => {
      let reject: (reason?: unknown) => void = () => undefined;
      let resolve: (result: string) => void = () => undefined;
      const result = new Promise<string>((resolvePromise, rejectPromise) => {
        reject = rejectPromise;
        resolve = resolvePromise;
      });
      const record = { cancel: vi.fn(), context, reject, resolve };
      attempts.push(record);
      return { cancel: record.cancel, result };
    },
  });
  return { attempts, coordinator };
}

describe("Graphwar authoritative task coordinator", () => {
  it("owns an immutable snapshot before waiting for backend selection", async () => {
    const harness = createHarness();
    let resolveSelection:
      | ((configuration: ReturnType<typeof createGraphwarTypescriptWorkerBackendConfiguration>) => void)
      | undefined;
    const selectionPromise = new Promise<ReturnType<typeof createGraphwarTypescriptWorkerBackendConfiguration>>(
      (resolve) => {
        resolveSelection = resolve;
      },
    );
    const input = { bytes: new Uint8Array([1, 2]), settings: { scale: 3 } };
    const task = harness.coordinator.beginTask(input, { generation: 1, promise: selectionPromise });

    input.bytes[0] = 9;
    input.settings.scale = 8;
    resolveSelection?.(createGraphwarTypescriptWorkerBackendConfiguration(1));
    await Promise.resolve();

    expect(harness.attempts[0]?.context.snapshot).toEqual({
      bytes: new Uint8Array([1, 2]),
      settings: { scale: 3 },
    });
    harness.attempts[0]?.resolve("complete");
    await expect(task.promise).resolves.toBe("complete");
  });

  it("revokes all old events before one CAS installs TS replacements", async () => {
    const harness = createHarness();
    const events: string[] = [];
    const selection = {
      generation: 4,
      promise: Promise.resolve(createGraphwarTypescriptWorkerBackendConfiguration(4)),
    };
    const first = harness.coordinator.beginTask({ bytes: new Uint8Array([1]), settings: { scale: 1 } }, selection, {
      onEvent: (event) => events.push(`first:${event}`),
    });
    const second = harness.coordinator.beginTask({ bytes: new Uint8Array([2]), settings: { scale: 2 } }, selection, {
      onEvent: (event) => events.push(`second:${event}`),
    });
    await Promise.resolve();
    const oldAttempts = [...harness.attempts];

    expect(harness.coordinator.replayGenerationAsTypescript(4, 5)).toBe(true);
    expect(harness.coordinator.replayGenerationAsTypescript(4, 6)).toBe(false);
    expect(oldAttempts.every((attempt) => attempt.cancel.mock.calls.length === 1)).toBe(true);
    expect(oldAttempts.every((attempt) => attempt.context.publish("late") === false)).toBe(true);
    expect(harness.attempts).toHaveLength(4);
    expect(harness.attempts.slice(2).map((attempt) => attempt.context.attempt.backendGeneration)).toEqual([5, 5]);
    expect(events).toEqual([]);

    harness.attempts[2]?.resolve("first replay");
    harness.attempts[3]?.resolve("second replay");
    await expect(first.promise).resolves.toBe("first replay");
    await expect(second.promise).resolves.toBe("second replay");
  });

  it("gives every replacement an independent copy of the private master snapshot", async () => {
    const harness = createHarness();
    const task = harness.coordinator.beginTask(
      { bytes: new Uint8Array([1, 2]), settings: { scale: 3 } },
      { generation: 1, promise: Promise.resolve(createGraphwarTypescriptWorkerBackendConfiguration(1)) },
    );
    await Promise.resolve();
    const firstSnapshot = harness.attempts[0]?.context.snapshot;
    if (!firstSnapshot) {
      throw new Error("Expected the first attempt snapshot");
    }
    structuredClone(firstSnapshot.bytes, { transfer: [firstSnapshot.bytes.buffer] });
    firstSnapshot.settings.scale = 9;

    expect(harness.coordinator.replayGenerationAsTypescript(1, 2)).toBe(true);
    expect(harness.attempts[1]?.context.snapshot).toEqual({
      bytes: new Uint8Array([1, 2]),
      settings: { scale: 3 },
    });
    harness.attempts[1]?.resolve("replayed");
    await expect(task.promise).resolves.toBe("replayed");
  });

  it("does not expose the gate-owned attempt identity", async () => {
    const harness = createHarness();
    const task = harness.coordinator.beginTask(
      { bytes: new Uint8Array([1]), settings: { scale: 1 } },
      { generation: 1, promise: Promise.resolve(createGraphwarTypescriptWorkerBackendConfiguration(1)) },
    );
    const publicAttempt = task.getAttempt();
    if (!publicAttempt) {
      throw new Error("Expected a public attempt snapshot");
    }
    expect(Object.isFrozen(publicAttempt)).toBe(true);
    expect(Reflect.set(publicAttempt, "backendGeneration", 2)).toBe(false);
    await Promise.resolve();
    expect(Object.isFrozen(harness.attempts[0]?.context.attempt)).toBe(true);

    expect(harness.coordinator.replayGenerationAsTypescript(1, 2)).toBe(true);
    harness.attempts[1]?.resolve("replayed");
    await expect(task.promise).resolves.toBe("replayed");
  });

  it("keeps one outer Promise and rejects late completion from a replaced attempt", async () => {
    const harness = createHarness();
    const task = harness.coordinator.beginTask(
      { bytes: new Uint8Array([1]), settings: { scale: 1 } },
      { generation: 2, promise: Promise.resolve(createGraphwarTypescriptWorkerBackendConfiguration(2)) },
    );
    await Promise.resolve();
    const oldAttempt = harness.attempts[0];

    harness.coordinator.replayGenerationAsTypescript(2, 3);
    oldAttempt?.resolve("late old result");
    await Promise.resolve();
    harness.attempts[1]?.resolve("replacement result");

    await expect(task.promise).resolves.toBe("replacement result");
    expect(task.getAttempt()).toBeUndefined();
    expect(task.cancel()).toBe(false);
  });

  it("keeps a Worker result provisional until the asynchronous workflow commit", async () => {
    const harness = createHarness();
    let releaseCommit: (() => void) | undefined;
    const committed: string[] = [];
    const task = harness.coordinator.beginTask(
      { bytes: new Uint8Array([1]), settings: { scale: 1 } },
      { generation: 2, promise: Promise.resolve(createGraphwarTypescriptWorkerBackendConfiguration(2)) },
      {
        commitResult: async (result, context) => {
          await new Promise<void>((resolve) => {
            releaseCommit = resolve;
          });
          context.commit(() => committed.push(result));
        },
      },
    );
    await Promise.resolve();
    harness.attempts[0]?.resolve("provisional");
    await Promise.resolve();
    let isSettled = false;
    void task.promise.finally(() => {
      isSettled = true;
    });

    expect(isSettled).toBe(false);
    expect(committed).toEqual([]);
    releaseCommit?.();
    await expect(task.promise).resolves.toBe("provisional");
    expect(committed).toEqual(["provisional"]);
  });

  it("revokes a pending workflow commit and publishes only the TS replay", async () => {
    const harness = createHarness();
    const pendingCommits: (() => void)[] = [];
    const committed: string[] = [];
    const task = harness.coordinator.beginTask(
      { bytes: new Uint8Array([1]), settings: { scale: 1 } },
      { generation: 3, promise: Promise.resolve(createGraphwarTypescriptWorkerBackendConfiguration(3)) },
      {
        commitResult: async (result, context) => {
          await new Promise<void>((resolve) => pendingCommits.push(resolve));
          context.commit(() => committed.push(result));
        },
      },
    );
    await Promise.resolve();
    harness.attempts[0]?.resolve("old WASM");
    await Promise.resolve();

    expect(harness.coordinator.replayGenerationAsTypescript(3, 4)).toBe(true);
    harness.attempts[1]?.resolve("TS replay");
    await Promise.resolve();
    pendingCommits[0]?.();
    pendingCommits[1]?.();

    await expect(task.promise).resolves.toBe("TS replay");
    expect(committed).toEqual(["TS replay"]);
  });

  it("makes workflow commit single-use before a later fault can replay it", async () => {
    const harness = createHarness();
    const published = vi.fn();
    const secondCommit = vi.fn();
    const task = harness.coordinator.beginTask(
      { bytes: new Uint8Array([1]), settings: { scale: 1 } },
      { generation: 5, promise: Promise.resolve(createGraphwarTypescriptWorkerBackendConfiguration(5)) },
      {
        commitResult: (result, context) => {
          expect(context.commit(() => published(result))).toBe(true);
          expect(context.commit(secondCommit)).toBe(false);
          expect(harness.coordinator.replayGenerationAsTypescript(5, 6)).toBe(true);
        },
      },
    );
    await Promise.resolve();
    harness.attempts[0]?.resolve("committed");

    await expect(task.promise).resolves.toBe("committed");
    expect(published).toHaveBeenCalledExactlyOnceWith("committed");
    expect(secondCommit).not.toHaveBeenCalled();
    expect(harness.attempts).toHaveLength(1);
  });

  it("lets explicit cancellation win while backend selection is still pending", async () => {
    const harness = createHarness();
    let resolveSelection:
      | ((configuration: ReturnType<typeof createGraphwarTypescriptWorkerBackendConfiguration>) => void)
      | undefined;
    const task = harness.coordinator.beginTask(
      { bytes: new Uint8Array([1]), settings: { scale: 1 } },
      {
        generation: 7,
        promise: new Promise((resolve) => {
          resolveSelection = resolve;
        }),
      },
    );
    const cancellation = new Error("user cancelled");

    expect(task.cancel(cancellation)).toBe(true);
    resolveSelection?.(createGraphwarTypescriptWorkerBackendConfiguration(7));
    await expect(task.promise).rejects.toBe(cancellation);
    await Promise.resolve();
    expect(harness.attempts).toHaveLength(0);
  });

  it("settles cancellation and installs replay even when attempt cleanup throws", async () => {
    const harness = createHarness();
    const first = harness.coordinator.beginTask(
      { bytes: new Uint8Array([1]), settings: { scale: 1 } },
      { generation: 3, promise: Promise.resolve(createGraphwarTypescriptWorkerBackendConfiguration(3)) },
    );
    const second = harness.coordinator.beginTask(
      { bytes: new Uint8Array([2]), settings: { scale: 2 } },
      { generation: 3, promise: Promise.resolve(createGraphwarTypescriptWorkerBackendConfiguration(3)) },
    );
    await Promise.resolve();
    harness.attempts[0]?.cancel.mockImplementation(() => {
      throw new Error("termination failed");
    });
    harness.attempts[1]?.cancel.mockImplementation(() => {
      throw new Error("termination failed");
    });

    const cancellation = new Error("cancelled");
    expect(first.cancel(cancellation)).toBe(true);
    await expect(first.promise).rejects.toBe(cancellation);
    expect(harness.coordinator.replayGenerationAsTypescript(3, 4)).toBe(true);
    expect(harness.attempts).toHaveLength(3);
    harness.attempts[2]?.resolve("replayed");
    await expect(second.promise).resolves.toBe("replayed");
  });

  it("rejects invalid selection generations and validates replay before revoking", async () => {
    const harness = createHarness();
    const invalidSelectionTask = harness.coordinator.beginTask(
      { bytes: new Uint8Array([1]), settings: { scale: 1 } },
      { generation: 5, promise: Promise.resolve(createGraphwarTypescriptWorkerBackendConfiguration(4)) },
    );
    await expect(invalidSelectionTask.promise).rejects.toThrow("invalid replacement generation");

    const replayableTask = harness.coordinator.beginTask(
      { bytes: new Uint8Array([2]), settings: { scale: 2 } },
      { generation: 6, promise: Promise.resolve(createGraphwarTypescriptWorkerBackendConfiguration(6)) },
    );
    await Promise.resolve();
    expect(() => harness.coordinator.replayGenerationAsTypescript(6, 6)).toThrow("must be newer");
    harness.attempts.at(-1)?.resolve("still authoritative");
    await expect(replayableTask.promise).resolves.toBe("still authoritative");
  });

  it("rejects the outer task when attempt startup throws synchronously", async () => {
    const coordinator = createGraphwarAuthoritativeTaskCoordinator<Input, Snapshot, string, string>({
      cloneInput: (input) => ({ bytes: input.bytes.slice(), settings: { ...input.settings } }),
      cloneSnapshotForAttempt: (snapshot) => ({ bytes: snapshot.bytes.slice(), settings: { ...snapshot.settings } }),
      executeAttempt: () => {
        throw new Error("startup failed");
      },
    });
    const task = coordinator.beginTask(
      { bytes: new Uint8Array([1]), settings: { scale: 1 } },
      { generation: 1, promise: Promise.resolve(createGraphwarTypescriptWorkerBackendConfiguration(1)) },
    );

    await expect(task.promise).rejects.toThrow("startup failed");
  });

  it("fixes a loading task to TS after disable even if a new generation becomes ready", async () => {
    const emptyModule = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
    let rejectFirstLoad: ((reason?: unknown) => void) | undefined;
    const runtimeController = createGraphwarWasmRuntimeController({
      compileModule: vi
        .fn<(url: string, signal: AbortSignal) => Promise<WebAssembly.Module>>()
        .mockImplementationOnce(
          (_url, signal) =>
            new Promise((_resolve, reject) => {
              rejectFirstLoad = reject;
              signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
            }),
        )
        .mockResolvedValueOnce(emptyModule),
    });
    void runtimeController.enable().catch(() => undefined);
    const harness = createHarness();
    const task = harness.coordinator.beginTask(
      { bytes: new Uint8Array([1]), settings: { scale: 1 } },
      runtimeController.createWorkerBackendSelection(),
    );

    runtimeController.disable();
    await runtimeController.enable();
    rejectFirstLoad?.(new DOMException("Aborted", "AbortError"));
    await Promise.resolve();

    expect(harness.attempts).toHaveLength(1);
    expect(harness.attempts[0]?.context.backendConfiguration).toEqual({
      backend: { type: "typescript" },
      generation: 2,
    });
    harness.attempts[0]?.resolve("typescript");
    await expect(task.promise).resolves.toBe("typescript");
    expect(runtimeController.getState()).toEqual({ generation: 3, module: emptyModule, type: "ready" });
  });
});
