import { describe, expect, it } from "vitest";

import { createGraphwarBackendAttemptGate } from "./backend-attempt";

describe("Graphwar backend attempt commit gate", () => {
  it("keeps one outer task while replacing only its backend attempt", () => {
    const gate = createGraphwarBackendAttemptGate();
    const wasmAttempt = gate.beginOuterTask(3);
    const typescriptAttempt = gate.replaceAttempt(wasmAttempt, 4);

    expect(typescriptAttempt.outerTaskId).toBe(wasmAttempt.outerTaskId);
    expect(typescriptAttempt.attemptId).not.toBe(wasmAttempt.attemptId);
    expect(gate.canCommit(wasmAttempt)).toBe(false);
    expect(gate.canCommit(typescriptAttempt)).toBe(true);
    expect(() => gate.completeOuterTask(wasmAttempt)).toThrow("no longer authoritative");
    gate.completeOuterTask(typescriptAttempt);
    expect(gate.canCommit(typescriptAttempt)).toBe(false);
  });

  it("uses generation compare-and-set and blocks revoked commits before replay", () => {
    const gate = createGraphwarBackendAttemptGate();
    const attempt = gate.beginOuterTask(8);

    expect(gate.revokeGeneration(8)).toBe(true);
    expect(gate.revokeGeneration(8)).toBe(false);
    expect(gate.canCommit(attempt)).toBe(false);
    expect(() => gate.completeOuterTask(attempt)).toThrow("cannot complete");
    const replay = gate.replaceAttempt(attempt, 9);
    expect(gate.canCommit(replay)).toBe(true);
  });

  it("lets user cancellation win without creating a replacement attempt", () => {
    const gate = createGraphwarBackendAttemptGate();
    const attempt = gate.beginOuterTask(1);
    gate.cancelOuterTask(attempt);

    expect(gate.canCommit(attempt)).toBe(false);
    expect(() => gate.replaceAttempt(attempt, 2)).toThrow("no longer authoritative");
    expect(() => gate.cancelOuterTask(attempt)).toThrow("no longer authoritative");
  });

  it("tracks independent outer tasks and rejects revoked generations for new work", () => {
    const gate = createGraphwarBackendAttemptGate();
    const first = gate.beginOuterTask(2);
    const second = gate.beginOuterTask(2);
    expect(first.outerTaskId).not.toBe(second.outerTaskId);
    expect(gate.canCommit(first)).toBe(true);
    expect(gate.canCommit(second)).toBe(true);

    gate.revokeGeneration(2);
    expect(() => gate.beginOuterTask(2)).toThrow("has been revoked");
    expect(() => gate.beginOuterTask(-1)).toThrow(RangeError);
    expect(gate.beginOuterTask(3).backendGeneration).toBe(3);
  });
});
