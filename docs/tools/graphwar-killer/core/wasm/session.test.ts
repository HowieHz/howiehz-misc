import { describe, expect, it } from "vitest";

import { GraphwarWasmAdapterError, type GraphwarWasmAdapterErrorCode } from "./abi";
import { createGraphwarWasmSessionController, type GraphwarWasmSessionHandle } from "./session";

describe("Graphwar WASM detection sessions", () => {
  it("binds opaque identity, pauses atomically, and consumes shard results in stable id order", () => {
    const controller = createTestSessionController();
    const running = controller.beginSession({
      backendGeneration: 7,
      pointer: 128,
      requestId: 11,
      taskType: "detection",
    });

    expect(running).toEqual({ handle: running.handle, type: "running" });
    expect(running.handle).toMatchObject({ backendGeneration: 7, nonce: 1, requestId: 11, taskType: "detection" });
    expect(running.handle).not.toHaveProperty("pointer");
    expect(Object.isFrozen(running.handle)).toBe(true);
    expect(controller.getSessionPointer(running.handle)).toBe(128);
    const identity = controller.getSessionIdentity(running.handle);
    expect(identity).toEqual({ backendGeneration: 7, nonce: 1, requestId: 11, taskType: "detection" });
    expect(Object.getOwnPropertySymbols(identity)).toHaveLength(0);

    const waiting = controller.waitForTemplateShards(running.handle, [9, 3, 6]);
    expect(waiting).toEqual({
      handle: running.handle,
      type: "waiting-template-shards",
      work: { shardIds: [3, 6, 9] },
    });
    expectAdapterError(() => controller.completeSession(running.handle, "early"), "invalid-session-state");

    const resumed = controller.resumeTemplateShards(running.handle, [
      { payload: "nine", shardId: 9 },
      { payload: "three", shardId: 3 },
      { payload: "six", shardId: 6 },
    ]);
    expect(resumed.state).toEqual({ handle: running.handle, type: "running" });
    expect(resumed.results.map((result) => result.payload)).toEqual(["three", "six", "nine"]);

    expect(controller.completeSession(running.handle, { soldierCount: 2 })).toEqual({
      result: { soldierCount: 2 },
      type: "complete",
    });
    expectAdapterError(
      () => controller.resumeTemplateShards(running.handle, [{ shardId: 3 }, { shardId: 6 }, { shardId: 9 }]),
      "invalid-session-handle",
    );
  });

  it("rejects duplicate, missing, and unexpected shard ids without changing the waiting state", () => {
    const controller = createTestSessionController();
    const handle = controller.beginSession({
      backendGeneration: 1,
      pointer: 128,
      requestId: 1,
      taskType: "detection",
    }).handle;

    expectAdapterError(() => controller.waitForTemplateShards(handle, [1, 1]), "duplicate-work-id");
    controller.waitForTemplateShards(handle, [1, 2]);
    expectAdapterError(
      () => controller.resumeTemplateShards(handle, [{ shardId: 1 }, { shardId: 1 }]),
      "duplicate-work-id",
    );
    expectAdapterError(() => controller.resumeTemplateShards(handle, [{ shardId: 1 }]), "missing-work-id");
    expectAdapterError(
      () => controller.resumeTemplateShards(handle, [{ shardId: 1 }, { shardId: 3 }]),
      "unexpected-work-id",
    );
    expect(controller.resumeTemplateShards(handle, [{ shardId: 2 }, { shardId: 1 }]).results).toEqual([
      { shardId: 1 },
      { shardId: 2 },
    ]);
  });
});

describe("Graphwar WASM one-click-clear sessions", () => {
  it("accepts an exact edge batch and invalidates the handle on cancellation", () => {
    const controller = createTestSessionController();
    const handle = controller.beginSession({
      backendGeneration: 4,
      pointer: 256,
      requestId: 8,
      taskType: "one-click-clear",
    }).handle;

    expect(controller.waitForEdgeBatch(handle, [12, 4])).toEqual({
      handle,
      type: "waiting-edge-batch",
      work: { jobIds: [4, 12] },
    });
    const resumed = controller.resumeEdgeBatch(handle, [
      { jobId: 12, route: "second" },
      { jobId: 4, route: "first" },
    ]);
    expect(resumed.results.map((result) => result.route)).toEqual(["first", "second"]);

    controller.cancelSession(handle);
    expectAdapterError(() => controller.getSessionPointer(handle), "invalid-session-handle");
    expectAdapterError(() => controller.resumeEdgeBatch(handle, []), "invalid-session-handle");
  });

  it("allows pointer reuse only after revocation and gives the replacement a new nonce", () => {
    const controller = createTestSessionController();
    const first = controller.beginSession({
      backendGeneration: 2,
      pointer: 512,
      requestId: 1,
      taskType: "one-click-clear",
    }).handle;
    expectAdapterError(
      () =>
        controller.beginSession({
          backendGeneration: 2,
          pointer: 512,
          requestId: 2,
          taskType: "one-click-clear",
        }),
      "session-pointer-in-use",
    );

    controller.completeSession(first, "done");
    const replacement = controller.beginSession({
      backendGeneration: 2,
      pointer: 512,
      requestId: 2,
      taskType: "one-click-clear",
    }).handle;
    expect(replacement.nonce).toBeGreaterThan(first.nonce);
    expectAdapterError(() => controller.getSessionPointer(first), "invalid-session-handle");
    expect(controller.getSessionPointer(replacement)).toBe(512);
  });
});

describe("Graphwar WASM session identity and transitions", () => {
  it("rejects task/state mismatches and empty work batches", () => {
    const controller = createTestSessionController();
    const detection = controller.beginSession({
      backendGeneration: 1,
      pointer: 64,
      requestId: 1,
      taskType: "detection",
    }).handle;
    const oneClickClear = controller.beginSession({
      backendGeneration: 1,
      pointer: 128,
      requestId: 2,
      taskType: "one-click-clear",
    }).handle;

    expectAdapterError(() => controller.waitForEdgeBatch(detection, [1]), "invalid-session-state");
    expectAdapterError(() => controller.waitForTemplateShards(oneClickClear, [1]), "invalid-session-state");
    expectAdapterError(() => controller.waitForTemplateShards(detection, []), "invalid-work-batch");
    controller.waitForTemplateShards(detection, [1]);
    expectAdapterError(() => controller.waitForTemplateShards(detection, [2]), "invalid-session-state");
  });

  it("rejects invalid begin identities and structurally forged handles", () => {
    const controller = createTestSessionController();
    for (const start of [
      { backendGeneration: -1, pointer: 64, requestId: 1, taskType: "detection" },
      { backendGeneration: 1, pointer: 0, requestId: 1, taskType: "detection" },
      { backendGeneration: 1, pointer: 16, requestId: 1, taskType: "detection" },
      { backendGeneration: 1, pointer: 1024, requestId: 1, taskType: "detection" },
      { backendGeneration: 1, pointer: 64, requestId: 1.5, taskType: "detection" },
      { backendGeneration: 1, pointer: 64, requestId: 1, taskType: "unknown" },
    ]) {
      expect(() => controller.beginSession(start as Parameters<typeof controller.beginSession>[0])).toThrowError(
        GraphwarWasmAdapterError,
      );
    }

    const real = controller.beginSession({
      backendGeneration: 1,
      pointer: 64,
      requestId: 1,
      taskType: "detection",
    }).handle;
    const forged = {
      backendGeneration: real.backendGeneration,
      nonce: real.nonce,
      requestId: real.requestId,
      taskType: real.taskType,
    } as GraphwarWasmSessionHandle;
    expectAdapterError(() => controller.getSessionPointer(forged), "invalid-session-handle");
  });

  it("matches every cloneable generation/request/task/nonce field before nested work resumes", () => {
    const controller = createTestSessionController();
    const handle = controller.beginSession({
      backendGeneration: 3,
      pointer: 64,
      requestId: 9,
      taskType: "detection",
    }).handle;
    const identity = controller.getSessionIdentity(handle);
    expect(() => controller.validateSessionIdentity(handle, identity)).not.toThrow();

    for (const mismatch of [
      { ...identity, backendGeneration: 4 },
      { ...identity, nonce: 2 },
      { ...identity, requestId: 10 },
      { ...identity, taskType: "one-click-clear" },
    ]) {
      expectAdapterError(() => controller.validateSessionIdentity(handle, mismatch), "invalid-session-identity");
    }
  });
});

/** 断言本地 Adapter 分类，不让测试耦合人类可读文案。 */
function expectAdapterError(task: () => unknown, code: GraphwarWasmAdapterErrorCode) {
  let error: unknown;
  try {
    task();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(GraphwarWasmAdapterError);
  expect(error).toMatchObject({ code });
}

/** 为 session 测试提供 module globals 与未分配尾部都不可见的 raw arena。 */
function createTestSessionController() {
  return createGraphwarWasmSessionController({
    arenaBase: 32,
    arenaCursor: 1024,
    buffer: new ArrayBuffer(2048),
  });
}
