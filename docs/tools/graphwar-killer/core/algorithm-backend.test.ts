import { describe, expect, it } from "vitest";

import {
  createGraphwarTypescriptBackendContext,
  createGraphwarWasmBackendContext,
  GraphwarValidatedWasmRuntime,
  GraphwarWasmFault,
  graphwarBackendAttemptIdentitiesAreEqual,
  isGraphwarAlgorithmBackendContext,
  isGraphwarBackendAttemptEnvelope,
  isGraphwarBackendAttemptIdentity,
  isGraphwarBackendControlMessage,
  isGraphwarBackendExecution,
  isGraphwarWasmFault,
  isGraphwarWasmFaultContext,
  isGraphwarWasmFaultDescriptor,
  isGraphwarWorkerRole,
  type GraphwarBackendControlMessage,
  type GraphwarWorkerRole,
} from "./algorithm-backend";

/** 测试 runtime 只能通过继承 Adapter 所有的名义基类构造。 */
class TestGraphwarWasmRuntime extends GraphwarValidatedWasmRuntime {
  readonly isTestRuntime: true;

  constructor() {
    super();
    this.isTestRuntime = true;
  }
}

const wasmRuntime = new TestGraphwarWasmRuntime();
const emptyWasmModule = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

describe("Graphwar algorithm backend contracts", () => {
  it("constructs only complete TypeScript and WASM contexts", () => {
    const typescript = createGraphwarTypescriptBackendContext(0);
    const wasm = createGraphwarWasmBackendContext(1, wasmRuntime);

    expect(typescript).toEqual({ generation: 0, type: "typescript" });
    expect(wasm).toEqual({ generation: 1, runtime: wasmRuntime, type: "wasm" });
    expect(isGraphwarAlgorithmBackendContext(typescript)).toBe(true);
    expect(isGraphwarAlgorithmBackendContext(wasm)).toBe(true);
    expect(() => createGraphwarWasmBackendContext(1, undefined as unknown as GraphwarValidatedWasmRuntime)).toThrow(
      TypeError,
    );
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid backend generation %s during internal construction",
    (generation) => {
      expect(() => createGraphwarTypescriptBackendContext(generation)).toThrow(RangeError);
      expect(() => createGraphwarWasmBackendContext(generation, wasmRuntime)).toThrow(RangeError);
    },
  );

  it.each([
    { generation: 1, type: "wasm" },
    { generation: 1, runtime: {}, type: "wasm" },
    { generation: 1, runtime: wasmRuntime, type: "typescript" },
    { generation: -1, type: "typescript" },
    { generation: 1.5, type: "typescript" },
    { generation: 1, type: "unknown" },
  ])("rejects backend half-state %#", (value) => {
    expect(isGraphwarAlgorithmBackendContext(value)).toBe(false);
  });

  it.each([
    { effective: "typescript", requested: "typescript" },
    { effective: "wasm", requested: "wasm" },
    { effective: "typescript", fallbackReason: "Worker unavailable", requested: "wasm" },
  ])("accepts backend execution diagnostic %#", (value) => {
    expect(isGraphwarBackendExecution(value)).toBe(true);
  });

  it.each([
    { effective: "wasm", requested: "typescript" },
    { effective: "typescript", requested: "wasm" },
    { effective: "typescript", fallbackReason: "", requested: "wasm" },
    { effective: "wasm", fallbackReason: "unexpected", requested: "wasm" },
    { effective: "typescript", fallbackReason: "unexpected", requested: "typescript" },
  ])("rejects backend execution half-state %#", (value) => {
    expect(isGraphwarBackendExecution(value)).toBe(false);
  });

  it("validates the complete replaceable-attempt identity", () => {
    expect(
      isGraphwarBackendAttemptIdentity({
        attemptId: 2,
        backendGeneration: 3,
        outerTaskId: 1,
      }),
    ).toBe(true);
    expect(isGraphwarBackendAttemptIdentity({ attemptId: -1, backendGeneration: 3, outerTaskId: 1 })).toBe(false);
    expect(isGraphwarBackendAttemptIdentity({ attemptId: 2, backendGeneration: 0.5, outerTaskId: 1 })).toBe(false);
    expect(isGraphwarBackendAttemptIdentity({ attemptId: 2, backendGeneration: 3 })).toBe(false);
    expect(
      graphwarBackendAttemptIdentitiesAreEqual(
        { attemptId: 2, backendGeneration: 3, outerTaskId: 1 },
        { attemptId: 2, backendGeneration: 3, outerTaskId: 1 },
      ),
    ).toBe(true);
    expect(
      graphwarBackendAttemptIdentitiesAreEqual(
        { attemptId: 2, backendGeneration: 3, outerTaskId: 1 },
        { attemptId: 2, backendGeneration: 4, outerTaskId: 1 },
      ),
    ).toBe(false);
  });

  it("validates attempt-bearing business envelopes without weakening their payload boundary", () => {
    const value = {
      attempt: { attemptId: 2, backendGeneration: 3, outerTaskId: 1 },
      payload: { type: "preview" },
    };
    expect(
      isGraphwarBackendAttemptEnvelope(value, (payload): payload is { type: "preview" } => {
        return typeof payload === "object" && payload !== null && "type" in payload && payload.type === "preview";
      }),
    ).toBe(true);
    expect(isGraphwarBackendAttemptEnvelope({ payload: value.payload }, (_payload): _payload is unknown => true)).toBe(
      false,
    );
  });

  it("accepts only production Worker roles", () => {
    const roles = [
      "trajectory",
      "live-click-preview",
      "detection-main",
      "detection-template",
      "pathfinding-master",
      "one-click-clear-edge",
    ] satisfies GraphwarWorkerRole[];

    expect(roles.every(isGraphwarWorkerRole)).toBe(true);
    expect(isGraphwarWorkerRole("detection")).toBe(false);
    expect(isGraphwarWorkerRole(undefined)).toBe(false);
  });

  it("keeps typed WASM faults separate and cloneable", () => {
    const fault = new GraphwarWasmFault("trap", "trajectory export trapped");

    expect(fault).toMatchObject({
      code: "trap",
      message: "trajectory export trapped",
      name: "GraphwarWasmFault",
    });
    expect(isGraphwarWasmFault(fault)).toBe(true);
    expect(isGraphwarWasmFault(new Error(fault.message))).toBe(false);
    expect(isGraphwarWasmFaultDescriptor(fault.toDescriptor())).toBe(true);
    expect(isGraphwarWasmFaultDescriptor({ code: "convergence", message: fault.message })).toBe(false);
    expect(isGraphwarWasmFaultDescriptor({ code: "trap", message: " " })).toBe(false);
    expect(() => new GraphwarWasmFault("trap", " ")).toThrow(TypeError);
  });

  it("validates initialization, task, template shard, edge session, and edge job fault contexts", () => {
    const attempt = { attemptId: 2, backendGeneration: 3, outerTaskId: 1 };
    const contexts = [
      { type: "initialization" },
      { attempt, type: "task" },
      {
        attempt,
        session: { backendGeneration: 3, nonce: 1, requestId: 7, taskType: "detection" },
        shardId: 4,
        type: "template-shard",
      },
      {
        attempt,
        session: { backendGeneration: 3, nonce: 2, requestId: 8, taskType: "one-click-clear" },
        type: "edge-session",
      },
      {
        attempt,
        jobId: 5,
        session: { backendGeneration: 3, nonce: 2, requestId: 8, taskType: "one-click-clear" },
        type: "edge-job",
      },
    ];
    expect(contexts.every(isGraphwarWasmFaultContext)).toBe(true);
    expect(
      isGraphwarWasmFaultContext({
        attempt,
        session: { backendGeneration: 3, nonce: 1, requestId: 7, taskType: "one-click-clear" },
        shardId: 4,
        type: "template-shard",
      }),
    ).toBe(false);
    expect(isGraphwarWasmFaultContext({ attempt, type: "initialization" })).toBe(false);
    expect(
      isGraphwarWasmFaultContext({
        attempt,
        session: { backendGeneration: 4, nonce: 1, requestId: 7, taskType: "detection" },
        shardId: 4,
        type: "template-shard",
      }),
    ).toBe(false);
  });

  it("validates all three independent backend control envelopes", () => {
    const messages = [
      {
        backend: { type: "typescript" },
        generation: 0,
        role: "trajectory",
        type: "backend-init",
      },
      {
        backend: { module: emptyWasmModule, type: "wasm" },
        generation: 1,
        role: "detection-main",
        type: "backend-init",
      },
      {
        backend: "wasm",
        generation: 1,
        role: "detection-template",
        type: "backend-ready",
      },
      {
        context: { type: "initialization" },
        fault: { code: "abi", message: "missing memory export" },
        generation: 1,
        role: "pathfinding-master",
        type: "wasm-fault",
      },
    ] satisfies GraphwarBackendControlMessage[];

    expect(messages.every(isGraphwarBackendControlMessage)).toBe(true);
  });

  it.each([
    {
      backend: { module: emptyWasmModule, type: "typescript" },
      generation: 1,
      role: "trajectory",
      type: "backend-init",
    },
    {
      backend: { type: "wasm" },
      generation: 1,
      role: "trajectory",
      type: "backend-init",
    },
    {
      backend: { module: {}, type: "wasm" },
      generation: 1,
      role: "trajectory",
      type: "backend-init",
    },
    {
      backend: "wasm",
      fault: { code: "trap", message: "unexpected" },
      generation: 1,
      role: "trajectory",
      type: "backend-ready",
    },
    {
      context: { type: "initialization" },
      fault: { code: "trap", message: "unexpected" },
      generation: -1,
      role: "trajectory",
      type: "wasm-fault",
    },
    {
      context: { type: "initialization" },
      fault: { code: "trap", message: "unexpected" },
      generation: 1,
      role: "unknown",
      type: "wasm-fault",
    },
    {
      backend: "wasm",
      context: { type: "initialization" },
      fault: { code: "trap", message: "unexpected" },
      generation: 1,
      role: "trajectory",
      type: "wasm-fault",
    },
    {
      fault: { code: "trap", message: "unexpected" },
      generation: 1,
      role: "trajectory",
      type: "wasm-fault",
    },
    {
      context: {
        attempt: { attemptId: 2, backendGeneration: 2, outerTaskId: 1 },
        type: "task",
      },
      fault: { code: "trap", message: "unexpected" },
      generation: 1,
      role: "trajectory",
      type: "wasm-fault",
    },
    {
      context: {
        attempt: { attemptId: 2, backendGeneration: 1, outerTaskId: 1 },
        session: { backendGeneration: 1, nonce: 1, requestId: 7, taskType: "detection" },
        shardId: 4,
        type: "template-shard",
      },
      fault: { code: "trap", message: "unexpected" },
      generation: 1,
      role: "detection-main",
      type: "wasm-fault",
    },
    {
      context: {
        attempt: { attemptId: 2, backendGeneration: 1, outerTaskId: 1 },
        type: "task",
      },
      fault: { code: "trap", message: "missing child provenance" },
      generation: 1,
      role: "detection-template",
      type: "wasm-fault",
    },
    {
      context: {
        attempt: { attemptId: 2, backendGeneration: 1, outerTaskId: 1 },
        jobId: 4,
        session: { backendGeneration: 1, nonce: 1, requestId: 7, taskType: "one-click-clear" },
        type: "edge-job",
      },
      fault: { code: "trap", message: "child context on root role" },
      generation: 1,
      role: "pathfinding-master",
      type: "wasm-fault",
    },
  ])("rejects backend control half-state %#", (value) => {
    expect(isGraphwarBackendControlMessage(value)).toBe(false);
  });
});
