import { computed, ref, type ComputedRef, type Ref } from "vue";

import { nowMs } from "../../core/time";
import type { GraphwarAgentAvailableState, GraphwarAgentState } from "./client";

const zeroDisplayDurationMs = 2000;

/** Current Agent turn countdown projected for the result panel. */
export interface GraphwarAgentTurnCountdown {
  /** Clears stale state when the active Agent connection identity changes. */
  clear: () => void;
  /** Stops the scheduled display update when the page is disposed. */
  dispose: () => void;
  /** Reports whether the visible zero is inside its short grace period. */
  isZeroVisible: ComputedRef<boolean>;
  /** Whole seconds rounded up while positive, then zero during the grace period. */
  remainingSeconds: Readonly<Ref<number | undefined>>;
  /** Calibrates from one accepted live `/state` response. */
  update: (state: GraphwarAgentState) => void;
}

/** Maintains one response-age-corrected countdown on a monotonic local deadline. */
export function useGraphwarAgentTurnCountdown(): GraphwarAgentTurnCountdown {
  const remainingSeconds = ref<number>();
  const isZeroVisible = computed(() => remainingSeconds.value === 0);
  let activeTurnKey: string | undefined;
  let deadlineMs: number | undefined;
  let hideAtMs: number | undefined;
  let updateTimer: ReturnType<typeof setTimeout> | undefined;
  let zeroGraceTurnKey: string | undefined;

  /** Accepts only live aiming state; all other successful states explicitly clear the timer. */
  function update(state: GraphwarAgentState) {
    if (!state.isAvailable || state.phase !== "aiming") {
      clear();
      return;
    }
    const nextTurnKey = `${state.gameInstanceId}\u0000${state.turnToken ?? ""}`;
    if (nextTurnKey !== activeTurnKey) {
      activeTurnKey = nextTurnKey;
      zeroGraceTurnKey = undefined;
    }
    const adjustedRemainingMs = getAdjustedGraphwarAgentRemainingTurnMs(state);
    // Repeated zero snapshots from one turn must not extend or restart its already-consumed grace period.
    if (adjustedRemainingMs === 0 && zeroGraceTurnKey === nextTurnKey) {
      refresh();
      return;
    }
    deadlineMs = nowMs() + adjustedRemainingMs;
    hideAtMs = deadlineMs + zeroDisplayDurationMs;
    zeroGraceTurnKey = adjustedRemainingMs === 0 ? nextTurnKey : undefined;
    refresh();
  }

  /** Recomputes from the deadline so delayed browser timers never accumulate drift. */
  function refresh() {
    clearUpdateTimer();
    if (deadlineMs === undefined || hideAtMs === undefined) {
      remainingSeconds.value = undefined;
      return;
    }
    const currentTimeMs = nowMs();
    const remainingMs = deadlineMs - currentTimeMs;
    if (remainingMs > 0) {
      const seconds = Math.ceil(remainingMs / 1000);
      remainingSeconds.value = seconds;
      updateTimer = setTimeout(refresh, Math.max(1, Math.ceil(remainingMs - (seconds - 1) * 1000)));
      return;
    }
    if (currentTimeMs < hideAtMs) {
      zeroGraceTurnKey = activeTurnKey;
      remainingSeconds.value = 0;
      updateTimer = setTimeout(refresh, Math.max(1, Math.ceil(hideAtMs - currentTimeMs)));
      return;
    }
    // Keep the consumed turn identity after natural expiry so another identical zero snapshot stays hidden.
    deadlineMs = undefined;
    hideAtMs = undefined;
    remainingSeconds.value = undefined;
  }

  /** Clears both the deadline and any pending display transition. */
  function clear() {
    clearUpdateTimer();
    activeTurnKey = undefined;
    deadlineMs = undefined;
    hideAtMs = undefined;
    remainingSeconds.value = undefined;
    zeroGraceTurnKey = undefined;
  }

  /** Cancels one scheduled refresh without changing the authoritative deadline. */
  function clearUpdateTimer() {
    if (updateTimer === undefined) {
      return;
    }
    clearTimeout(updateTimer);
    updateTimer = undefined;
  }

  return {
    clear,
    dispose: clear,
    isZeroVisible,
    remainingSeconds,
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

/** Formats a non-negative whole-second countdown without variable-width hour state. */
export function formatGraphwarAgentTurnCountdown(remainingSeconds: number) {
  const minutes = Math.floor(remainingSeconds / 60);
  return `${minutes}:${String(remainingSeconds % 60).padStart(2, "0")}`;
}
