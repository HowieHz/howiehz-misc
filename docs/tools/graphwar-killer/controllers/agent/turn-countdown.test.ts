import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GraphwarAgentAvailableState } from "./client";
import { formatGraphwarAgentTurnCountdown, useGraphwarAgentTurnCountdown } from "./turn-countdown";

describe("Graphwar Agent turn countdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("subtracts response age and counts down from a monotonic deadline", () => {
    const countdown = useGraphwarAgentTurnCountdown();
    countdown.update(createAvailableState({ observedAtEpochMs: Date.now() - 1500, remainingTurnMs: 5000 }));

    expect(countdown.remainingMilliseconds.value).toBe(3500);
    vi.advanceTimersByTime(501);
    expect(countdown.remainingMilliseconds.value).toBe(3000);
    vi.advanceTimersByTime(3000);
    expect(countdown.remainingMilliseconds.value).toBe(0);
  });

  it("shows zero for at most two seconds and then disappears", () => {
    const countdown = useGraphwarAgentTurnCountdown();
    countdown.update(createAvailableState({ observedAtEpochMs: Date.now(), remainingTurnMs: 100 }));

    vi.advanceTimersByTime(100);
    expect(countdown.isZeroVisible.value).toBe(true);
    vi.advanceTimersByTime(1999);
    expect(countdown.remainingMilliseconds.value).toBe(0);
    vi.advanceTimersByTime(1);
    expect(countdown.remainingMilliseconds.value).toBeUndefined();
  });

  it("increases display precision below one tenth of a second", () => {
    const countdown = useGraphwarAgentTurnCountdown();
    countdown.update(createAvailableState({ remainingTurnMs: 100 }));

    expect(formatGraphwarAgentTurnCountdown(countdown.remainingMilliseconds.value ?? -1)).toBe("0.1");
    vi.advanceTimersByTime(10);
    expect(formatGraphwarAgentTurnCountdown(countdown.remainingMilliseconds.value ?? -1)).toBe("0.09");
    vi.advanceTimersByTime(81);
    expect(formatGraphwarAgentTurnCountdown(countdown.remainingMilliseconds.value ?? -1)).toBe("0.009");
    vi.advanceTimersByTime(8);
    expect(formatGraphwarAgentTurnCountdown(countdown.remainingMilliseconds.value ?? -1)).toBe("0.001");
    vi.advanceTimersByTime(1);
    expect(formatGraphwarAgentTurnCountdown(countdown.remainingMilliseconds.value ?? -1)).toBe("0.000");
  });

  it("uses millisecond refreshes only at the final display precision", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const countdown = useGraphwarAgentTurnCountdown();

    countdown.update(createAvailableState({ remainingTurnMs: 58_000 }));
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 100);

    countdown.clear();
    countdown.update(createAvailableState({ remainingTurnMs: 90 }));
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 10);

    countdown.clear();
    countdown.update(createAvailableState({ remainingTurnMs: 9 }));
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 1);
  });

  it("does not extend or restart zero visibility for repeated calibration of the same turn", () => {
    const countdown = useGraphwarAgentTurnCountdown();
    const turnToken = "00000000-0000-4000-8000-000000000011";
    countdown.update(createAvailableState({ remainingTurnMs: 0, turnToken }));

    expect(countdown.remainingMilliseconds.value).toBe(0);
    vi.advanceTimersByTime(1000);
    countdown.update(createAvailableState({ remainingTurnMs: 0, turnToken }));
    vi.advanceTimersByTime(1000);
    expect(countdown.remainingMilliseconds.value).toBeUndefined();

    countdown.update(createAvailableState({ remainingTurnMs: 0, turnToken }));
    expect(countdown.remainingMilliseconds.value).toBeUndefined();

    countdown.update(
      createAvailableState({
        remainingTurnMs: 0,
        turnToken: "00000000-0000-4000-8000-000000000012",
      }),
    );
    expect(countdown.remainingMilliseconds.value).toBe(0);
  });

  it("clears on unavailable or non-aiming state", () => {
    const countdown = useGraphwarAgentTurnCountdown();
    countdown.update(createAvailableState());
    countdown.update({
      apiVersion: 3,
      capabilities: createAvailableState().capabilities,
      isAvailable: false,
      observedAtEpochMs: Date.now(),
      plane: createAvailableState().plane,
      reason: "game-not-started",
    });
    expect(countdown.remainingMilliseconds.value).toBeUndefined();

    countdown.update(createAvailableState());
    countdown.update(createAvailableState({ phase: "drawing" }));
    expect(countdown.remainingMilliseconds.value).toBeUndefined();
  });

  it("formats seconds with adaptive precision down to Agent milliseconds", () => {
    expect(formatGraphwarAgentTurnCountdown(0)).toBe("0.000");
    expect(formatGraphwarAgentTurnCountdown(1)).toBe("0.001");
    expect(formatGraphwarAgentTurnCountdown(9)).toBe("0.009");
    expect(formatGraphwarAgentTurnCountdown(10)).toBe("0.01");
    expect(formatGraphwarAgentTurnCountdown(90)).toBe("0.09");
    expect(formatGraphwarAgentTurnCountdown(100)).toBe("0.1");
    expect(formatGraphwarAgentTurnCountdown(58_000)).toBe("58.0");
    expect(formatGraphwarAgentTurnCountdown(125_000)).toBe("125.0");
  });
});

/** Creates the minimal typed state needed by the countdown controller. */
function createAvailableState(overrides: Partial<GraphwarAgentAvailableState> = {}): GraphwarAgentAvailableState {
  return {
    apiVersion: 3,
    battleRevision: `sha256:${"a".repeat(64)}`,
    canAcceptShotCommands: true,
    capabilities: {
      canReadRoom: true,
      canReadWorldObstacleMask: true,
      canSetReady: true,
      canSubmitShots: true,
    },
    currentPlayerId: 1,
    currentPlayerIndex: 0,
    equationMode: "y",
    gameInstanceId: "00000000-0000-4000-8000-000000000001",
    isAvailable: true,
    isTerrainReversed: false,
    obstacleMask: {
      blockedValue: 1,
      emptyValue: 0,
      height: 450,
      isViewMirrored: false,
      revision: `sha256:${"a".repeat(64)}`,
      viewUrl: "/obstacle-masks/view.bin",
      width: 770,
      worldUrl: "/obstacle-masks/world.bin",
    },
    phase: "aiming",
    plane: { gameLength: 50, height: 450, width: 770 },
    players: [],
    remainingTurnMs: 5000,
    shotCommand: null,
    turnToken: null,
    ...overrides,
    observedAtEpochMs: overrides.observedAtEpochMs ?? Date.now(),
  };
}
