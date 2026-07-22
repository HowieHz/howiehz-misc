import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GraphwarAgentAvailableState } from "./client";
import { formatGraphwarAgentTurnCountdown, useGraphwarAgentTurnCountdown } from "./turn-countdown";

describe("Graphwar Agent turn countdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("subtracts response age and counts down from a monotonic deadline", () => {
    const countdown = useGraphwarAgentTurnCountdown();
    countdown.update(createAvailableState({ observedAtEpochMs: Date.now() - 1500, remainingTurnMs: 5000 }));

    expect(countdown.remainingSeconds.value).toBe(4);
    vi.advanceTimersByTime(501);
    expect(countdown.remainingSeconds.value).toBe(3);
    vi.advanceTimersByTime(3000);
    expect(countdown.remainingSeconds.value).toBe(0);
  });

  it("shows zero for at most two seconds and then disappears", () => {
    const countdown = useGraphwarAgentTurnCountdown();
    countdown.update(createAvailableState({ observedAtEpochMs: Date.now(), remainingTurnMs: 100 }));

    vi.advanceTimersByTime(100);
    expect(countdown.isZeroVisible.value).toBe(true);
    vi.advanceTimersByTime(1999);
    expect(countdown.remainingSeconds.value).toBe(0);
    vi.advanceTimersByTime(1);
    expect(countdown.remainingSeconds.value).toBeUndefined();
  });

  it("does not extend or restart zero visibility for repeated calibration of the same turn", () => {
    const countdown = useGraphwarAgentTurnCountdown();
    const turnToken = "00000000-0000-4000-8000-000000000011";
    countdown.update(createAvailableState({ remainingTurnMs: 0, turnToken }));

    expect(countdown.remainingSeconds.value).toBe(0);
    vi.advanceTimersByTime(1000);
    countdown.update(createAvailableState({ remainingTurnMs: 0, turnToken }));
    vi.advanceTimersByTime(1000);
    expect(countdown.remainingSeconds.value).toBeUndefined();

    countdown.update(createAvailableState({ remainingTurnMs: 0, turnToken }));
    expect(countdown.remainingSeconds.value).toBeUndefined();

    countdown.update(
      createAvailableState({
        remainingTurnMs: 0,
        turnToken: "00000000-0000-4000-8000-000000000012",
      }),
    );
    expect(countdown.remainingSeconds.value).toBe(0);
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
    expect(countdown.remainingSeconds.value).toBeUndefined();

    countdown.update(createAvailableState());
    countdown.update(createAvailableState({ phase: "drawing" }));
    expect(countdown.remainingSeconds.value).toBeUndefined();
  });

  it("formats fixed minute and second fields", () => {
    expect(formatGraphwarAgentTurnCountdown(0)).toBe("0:00");
    expect(formatGraphwarAgentTurnCountdown(42)).toBe("0:42");
    expect(formatGraphwarAgentTurnCountdown(125)).toBe("2:05");
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
