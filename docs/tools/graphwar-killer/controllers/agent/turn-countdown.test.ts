import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watch } from "vue";

import type { GraphwarAgentAvailableState } from "./client";
import {
  formatGraphwarAgentTurnCountdown,
  getAdjustedGraphwarAgentRemainingTurnMs,
  useGraphwarAgentTurnCountdown,
} from "./turn-countdown";

describe("Graphwar Agent turn countdown", () => {
  let animationFrames: FakeAnimationFrames;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
    animationFrames = installFakeAnimationFrames();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("subtracts response age and recomputes from a monotonic deadline", () => {
    const countdown = useGraphwarAgentTurnCountdown();
    countdown.update(createAvailableState({ observedAtEpochMs: Date.now() - 1500, remainingTurnMs: 5000 }));

    expect(countdown.remainingMilliseconds.value).toBe(3500);
    expect(animationFrames.pendingCount).toBe(1);
    vi.advanceTimersByTime(501);
    animationFrames.runNext();
    expect(countdown.remainingMilliseconds.value).toBe(3000);
    expect(animationFrames.pendingCount).toBe(1);
  });

  it("does not let response clock skew add time and clamps expired responses to zero", () => {
    expect(
      getAdjustedGraphwarAgentRemainingTurnMs(
        createAvailableState({ observedAtEpochMs: Date.now() + 1000, remainingTurnMs: 5000 }),
      ),
    ).toBe(5000);
    expect(
      getAdjustedGraphwarAgentRemainingTurnMs(
        createAvailableState({ observedAtEpochMs: Date.now() - 5001, remainingTurnMs: 5000 }),
      ),
    ).toBe(0);
  });

  it("publishes synchronously, keeps one request, and continues across frames", () => {
    const countdown = useGraphwarAgentTurnCountdown();
    countdown.update(createAvailableState({ remainingTurnMs: 5000 }));

    expect(countdown.remainingMilliseconds.value).toBe(5000);
    expect(animationFrames.pendingCount).toBe(1);
    countdown.update(createAvailableState({ remainingTurnMs: 4900, observationSequence: 2 }));
    expect(countdown.remainingMilliseconds.value).toBe(4900);
    expect(animationFrames.pendingCount).toBe(1);

    animationFrames.runNext();
    expect(animationFrames.pendingCount).toBe(1);
    animationFrames.runNext();
    expect(animationFrames.pendingCount).toBe(1);
  });

  it("only publishes when a frame crosses a displayed tenth", () => {
    const countdown = useGraphwarAgentTurnCountdown();
    let publishedCount = 0;
    watch(countdown.remainingMilliseconds, () => (publishedCount += 1), { flush: "sync" });
    countdown.update(createAvailableState({ remainingTurnMs: 1000 }));

    expect(publishedCount).toBe(1);
    vi.advanceTimersByTime(1);
    animationFrames.runNext();
    expect(countdown.remainingMilliseconds.value).toBe(1000);
    expect(publishedCount).toBe(1);

    vi.advanceTimersByTime(99);
    animationFrames.runNext();
    expect(countdown.remainingMilliseconds.value).toBe(900);
    expect(publishedCount).toBe(2);
  });

  it("jumps to the absolute deadline after a delayed frame without cumulative drift", () => {
    const countdown = useGraphwarAgentTurnCountdown();
    countdown.update(createAvailableState({ remainingTurnMs: 5000 }));

    vi.advanceTimersByTime(3451);
    animationFrames.runNext();
    expect(countdown.remainingMilliseconds.value).toBe(1600);
    expect(animationFrames.pendingCount).toBe(1);
  });

  it("uses the absolute two-second zero window on delayed frames", () => {
    const countdown = useGraphwarAgentTurnCountdown();
    countdown.update(createAvailableState({ remainingTurnMs: 100 }));

    vi.advanceTimersByTime(1500);
    animationFrames.runNext();
    expect(countdown.remainingMilliseconds.value).toBe(0);
    expect(animationFrames.pendingCount).toBe(1);

    vi.advanceTimersByTime(600);
    animationFrames.runNext();
    expect(countdown.remainingMilliseconds.value).toBeUndefined();
    expect(animationFrames.pendingCount).toBe(0);
  });

  it("does not replay the zero window when the first resumed frame crosses its end", () => {
    const countdown = useGraphwarAgentTurnCountdown();
    countdown.update(createAvailableState({ remainingTurnMs: 100 }));

    vi.advanceTimersByTime(2100);
    animationFrames.runNext();
    expect(countdown.remainingMilliseconds.value).toBeUndefined();
    expect(animationFrames.pendingCount).toBe(0);
  });

  it("does not extend an existing turn window when a delayed zero snapshot arrives", () => {
    const countdown = useGraphwarAgentTurnCountdown();
    const turnToken = "00000000-0000-4000-8000-000000000011";
    countdown.update(createAvailableState({ remainingTurnMs: 100, turnToken }));

    vi.advanceTimersByTime(1500);
    countdown.update(createAvailableState({ remainingTurnMs: 0, turnToken, observationSequence: 2 }));
    expect(countdown.remainingMilliseconds.value).toBe(0);
    expect(animationFrames.pendingCount).toBe(1);

    vi.advanceTimersByTime(600);
    animationFrames.runNext();
    expect(countdown.remainingMilliseconds.value).toBeUndefined();
    expect(animationFrames.pendingCount).toBe(0);
  });

  it("does not replay an expired turn window when a delayed zero snapshot arrives", () => {
    const countdown = useGraphwarAgentTurnCountdown();
    const turnToken = "00000000-0000-4000-8000-000000000011";
    countdown.update(createAvailableState({ remainingTurnMs: 100, turnToken }));

    vi.advanceTimersByTime(2100);
    countdown.update(createAvailableState({ remainingTurnMs: 0, turnToken, observationSequence: 2 }));
    expect(countdown.remainingMilliseconds.value).toBeUndefined();
    expect(animationFrames.pendingCount).toBe(0);
  });

  it("does not extend or restart zero visibility for repeated calibration of the same turn", () => {
    const countdown = useGraphwarAgentTurnCountdown();
    const turnToken = "00000000-0000-4000-8000-000000000011";
    countdown.update(createAvailableState({ remainingTurnMs: 0, turnToken }));

    expect(countdown.remainingMilliseconds.value).toBe(0);
    vi.advanceTimersByTime(1000);
    countdown.update(createAvailableState({ remainingTurnMs: 0, turnToken, observationSequence: 2 }));
    vi.advanceTimersByTime(1000);
    animationFrames.runNext();
    expect(countdown.remainingMilliseconds.value).toBeUndefined();

    countdown.update(createAvailableState({ remainingTurnMs: 0, turnToken, observationSequence: 3 }));
    expect(countdown.remainingMilliseconds.value).toBeUndefined();
    expect(animationFrames.pendingCount).toBe(0);

    countdown.update(
      createAvailableState({
        remainingTurnMs: 0,
        turnToken: "00000000-0000-4000-8000-000000000012",
      }),
    );
    expect(countdown.remainingMilliseconds.value).toBe(0);
    expect(animationFrames.pendingCount).toBe(1);
  });

  it("cancels clear and dispose frames and retained callbacks cannot revive the loop", () => {
    const countdown = useGraphwarAgentTurnCountdown();
    countdown.update(createAvailableState());
    const retainedClearCallback = animationFrames.peekNext();
    countdown.clear();

    expect(countdown.remainingMilliseconds.value).toBeUndefined();
    expect(animationFrames.pendingCount).toBe(0);
    retainedClearCallback(performance.now());
    expect(animationFrames.pendingCount).toBe(0);

    countdown.update(createAvailableState());
    const retainedDisposeCallback = animationFrames.peekNext();
    countdown.dispose();
    retainedDisposeCallback(performance.now());
    expect(animationFrames.pendingCount).toBe(0);
  });

  it("clears on unavailable state", () => {
    const countdown = useGraphwarAgentTurnCountdown();
    countdown.update(createAvailableState());
    countdown.update({
      agentInstanceId: "00000000-0000-4000-8000-000000000001",
      apiVersion: 3,
      capabilities: createAvailableState().capabilities,
      isAvailable: false,
      observationSequence: 2,
      observedAtEpochMs: Date.now(),
      plane: createAvailableState().plane,
      reason: "game-not-started",
    });
    expect(countdown.remainingMilliseconds.value).toBeUndefined();
    expect(animationFrames.pendingCount).toBe(0);
  });

  it("keeps the existing animation loop alive during non-aiming phases", () => {
    const countdown = useGraphwarAgentTurnCountdown();
    countdown.update(createAvailableState({ remainingTurnMs: 3000 }));
    expect(countdown.remainingMilliseconds.value).toBe(3000);
    expect(animationFrames.pendingCount).toBe(1);

    // After firing, the phase changes but the countdown should continue.
    countdown.update(createAvailableState({ phase: "drawing", observationSequence: 2 }));
    expect(countdown.remainingMilliseconds.value).toBe(3000);
    expect(animationFrames.pendingCount).toBe(1);

    // The loop should still advance toward the absolute deadline.
    vi.advanceTimersByTime(3000);
    animationFrames.runNext();
    expect(countdown.remainingMilliseconds.value).toBe(0);
    expect(animationFrames.pendingCount).toBe(1);

    // After the two-second zero window, the placeholder takes over.
    vi.advanceTimersByTime(2000);
    animationFrames.runNext();
    expect(countdown.remainingMilliseconds.value).toBeUndefined();
    expect(animationFrames.pendingCount).toBe(0);
  });

  it("formats seconds with fixed tenths precision", () => {
    expect(formatGraphwarAgentTurnCountdown(0)).toBe("0.0");
    expect(formatGraphwarAgentTurnCountdown(90)).toBe("0.1");
    expect(formatGraphwarAgentTurnCountdown(100)).toBe("0.1");
    expect(formatGraphwarAgentTurnCountdown(58_000)).toBe("58.0");
    expect(formatGraphwarAgentTurnCountdown(125_000)).toBe("125.0");
  });
});

interface FakeAnimationFrames {
  readonly pendingCount: number;
  peekNext: () => FrameRequestCallback;
  runNext: () => void;
}

/** Installs a deterministic single-threaded animation-frame queue for controller tests. */
function installFakeAnimationFrames(): FakeAnimationFrames {
  let nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const handle = nextHandle;
    nextHandle += 1;
    callbacks.set(handle, callback);
    return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => callbacks.delete(handle));

  return {
    get pendingCount() {
      return callbacks.size;
    },
    peekNext() {
      const callback = callbacks.values().next().value;
      if (callback === undefined) {
        throw new Error("Expected a pending animation frame");
      }
      return callback;
    },
    runNext() {
      const entry = callbacks.entries().next().value;
      if (entry === undefined) {
        throw new Error("Expected a pending animation frame");
      }
      const [handle, callback] = entry;
      callbacks.delete(handle);
      callback(performance.now());
    },
  };
}

/** Creates the minimal typed state needed by the countdown controller. */
function createAvailableState(overrides: Partial<GraphwarAgentAvailableState> = {}): GraphwarAgentAvailableState {
  return {
    agentInstanceId: "00000000-0000-4000-8000-000000000001",
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
    functionDraw: overrides.functionDraw ?? null,
    observationSequence: overrides.observationSequence ?? 1,
    observedAtEpochMs: overrides.observedAtEpochMs ?? Date.now(),
  };
}
