import { computed, ref, type ComputedRef, type Ref } from "vue";

import { nowMs } from "../../core/time";
import type { GraphwarAgentAvailableState, GraphwarAgentState } from "./client";

const zeroDisplayDurationMs = 2000;

/** Stable reactive state consumed by the isolated countdown display. */
export interface GraphwarAgentTurnCountdownDisplayState {
  /** Reports whether the visible zero is inside its short grace period. */
  isZeroVisible: ComputedRef<boolean>;
  /** Display-quantized milliseconds, then zero during the grace period. */
  remainingMilliseconds: Readonly<Ref<number | undefined>>;
}

/** Current Agent turn countdown projected for the result panel. */
export interface GraphwarAgentTurnCountdown extends GraphwarAgentTurnCountdownDisplayState {
  /** Clears stale state when the active Agent connection identity changes. */
  clear: () => void;
  /** Stops the scheduled display update when the page is disposed. */
  dispose: () => void;
  /** Calibrates from one accepted live `/state` response. */
  update: (state: GraphwarAgentState) => void;
}

/** Maintains one response-age-corrected countdown on a monotonic local deadline. */
export function useGraphwarAgentTurnCountdown(): GraphwarAgentTurnCountdown {
  const remainingMilliseconds = ref<number>();
  const isZeroVisible = computed(() => remainingMilliseconds.value === 0);
  let activeTurnKey: string | undefined;
  let animationFrameHandle: number | undefined;
  let deadlineMs: number | undefined;
  let hideAtMs: number | undefined;
  let loopGeneration = 0;
  let zeroGraceTurnKey: string | undefined;

  /** Calibrates while aiming; later phases may only continue the same game and turn deadline. */
  function update(state: GraphwarAgentState) {
    if (!state.isAvailable) {
      clear();
      return;
    }
    const nextTurnKey = `${state.gameInstanceId}\u0000${state.turnToken ?? ""}`;
    // Non-aiming phases after a shot still represent the same turn — let the existing
    // animation loop continue only while its game and turn identity remain authoritative.
    if (state.phase !== "aiming") {
      if (nextTurnKey !== activeTurnKey) {
        clear();
        return;
      }
      refreshAndSchedule();
      return;
    }
    const isSameTurn = nextTurnKey === activeTurnKey;
    if (!isSameTurn) {
      activeTurnKey = nextTurnKey;
      zeroGraceTurnKey = undefined;
    }
    const adjustedRemainingMs = getAdjustedGraphwarAgentRemainingTurnMs(state);
    // A zero snapshot for the current turn must preserve its original absolute display window.
    if (
      adjustedRemainingMs === 0 &&
      (zeroGraceTurnKey === nextTurnKey || (isSameTurn && deadlineMs !== undefined && hideAtMs !== undefined))
    ) {
      zeroGraceTurnKey = nextTurnKey;
      refreshAndSchedule();
      return;
    }
    deadlineMs = nowMs() + adjustedRemainingMs;
    hideAtMs = deadlineMs + zeroDisplayDurationMs;
    zeroGraceTurnKey = adjustedRemainingMs === 0 ? nextTurnKey : undefined;
    refreshAndSchedule();
  }

  /** Publishes from the absolute deadline and keeps at most one animation frame pending. */
  function refreshAndSchedule() {
    refresh();
    scheduleAnimationFrame();
  }

  /** Recomputes from the deadline so delayed browser frames never accumulate drift. */
  function refresh() {
    if (deadlineMs === undefined || hideAtMs === undefined) {
      publishRemainingMilliseconds(undefined);
      return;
    }
    const currentTimeMs = nowMs();
    const remainingMs = deadlineMs - currentTimeMs;
    if (remainingMs > 0) {
      // Never expose precision the browser cannot reliably paint before the deadline.
      const resolutionMs = 100;
      const displayRemainingMs = Math.ceil(remainingMs / resolutionMs) * resolutionMs;
      publishRemainingMilliseconds(displayRemainingMs);
      return;
    }
    if (currentTimeMs < hideAtMs) {
      zeroGraceTurnKey = activeTurnKey;
      publishRemainingMilliseconds(0);
      return;
    }
    // Keep the consumed turn identity after natural expiry so another identical zero snapshot stays hidden.
    deadlineMs = undefined;
    hideAtMs = undefined;
    cancelAnimationFrameLoop();
    publishRemainingMilliseconds(undefined);
  }

  /** Requests the next paint only while an authoritative display window remains active. */
  function scheduleAnimationFrame() {
    if (animationFrameHandle !== undefined || deadlineMs === undefined || hideAtMs === undefined) {
      return;
    }
    const scheduledGeneration = loopGeneration;
    animationFrameHandle = requestAnimationFrame(() => {
      // A cancelled callback retained by a test or race must not disturb a newer loop generation.
      if (scheduledGeneration !== loopGeneration) {
        return;
      }
      animationFrameHandle = undefined;
      refreshAndSchedule();
    });
  }

  /** Avoids reactive invalidations on frames within the same displayed tenth. */
  function publishRemainingMilliseconds(nextRemainingMilliseconds: number | undefined) {
    if (remainingMilliseconds.value !== nextRemainingMilliseconds) {
      remainingMilliseconds.value = nextRemainingMilliseconds;
    }
  }

  /** Clears both the deadline and any pending display transition. */
  function clear() {
    cancelAnimationFrameLoop();
    activeTurnKey = undefined;
    deadlineMs = undefined;
    hideAtMs = undefined;
    publishRemainingMilliseconds(undefined);
    zeroGraceTurnKey = undefined;
  }

  /** Invalidates retained callbacks and cancels the sole pending animation frame. */
  function cancelAnimationFrameLoop() {
    loopGeneration += 1;
    if (animationFrameHandle !== undefined) {
      cancelAnimationFrame(animationFrameHandle);
      animationFrameHandle = undefined;
    }
  }

  return {
    clear,
    dispose: clear,
    isZeroVisible,
    remainingMilliseconds,
    update,
  };
}

/** Removes one live state's response age without allowing clock skew to add or negate time. */
export function getAdjustedGraphwarAgentRemainingTurnMs(
  state: Pick<GraphwarAgentAvailableState, "observedAtEpochMs" | "remainingTurnMs">,
  currentEpochMs = Date.now(),
) {
  return Math.max(0, state.remainingTurnMs - Math.max(0, currentEpochMs - state.observedAtEpochMs));
}

/** Formats the display-quantized duration with the game's fixed tenths precision. */
export function formatGraphwarAgentTurnCountdown(remainingMilliseconds: number) {
  return (remainingMilliseconds / 1000).toFixed(1);
}
