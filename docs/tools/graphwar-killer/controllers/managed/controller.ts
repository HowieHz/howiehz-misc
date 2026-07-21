import {
  createGraphwarAgentShotRequest,
  GraphwarAgentClientError,
  isGraphwarAgentLocalHuman,
  isGraphwarAgentIncompatibleError,
  selectGraphwarAgentCurrentShooter,
  supportsGraphwarManagedMode,
  type GraphwarAgentAvailableRoom,
  type GraphwarAgentAvailableState,
  type GraphwarAgentClient,
  type GraphwarAgentCurrentShooter,
  type GraphwarAgentRoom,
  type GraphwarAgentShotPlan,
  type GraphwarAgentState,
} from "../agent/client";

export const GRAPHWAR_MANAGED_POLL_INTERVAL_MS = 1000;
export const GRAPHWAR_MANAGED_REQUEST_TIMEOUT_MS = 5000;
export const GRAPHWAR_MANAGED_SHOT_DEADLINE_MS = 3000;
export const GRAPHWAR_MANAGED_SKIP_TURN_FUNCTION = "999999999999999x";

export type GraphwarManagedShooter = GraphwarAgentCurrentShooter;

/** 托管轮询在状态、截止时间和提交结果上的可选回调。 */
export interface GraphwarManagedControllerHooks {
  /** Chooses the last fully validated plan when the authoritative deadline is reached. */
  decideDeadlineShot?: (state: GraphwarAgentAvailableState) => GraphwarAgentShotPlan | undefined;
  /** Reports the authoritative deadline before choosing an incumbent or skip-turn plan. */
  onDeadline?: (state: GraphwarAgentAvailableState) => void;
  /** Reports a protocol version or response shape that requires an Agent upgrade. */
  onIncompatibleError?: (error: GraphwarAgentClientError) => void;
  /** Reports an active-game state and its current local-human shooter, if any. */
  onState?: (
    state: GraphwarAgentAvailableState,
    shooter: GraphwarManagedShooter | undefined,
    worldObstacleMask: Uint8Array | undefined,
  ) => void;
  /** Reports a polling-friendly pre-game room state. */
  onRoom?: (room: GraphwarAgentRoom) => void;
  /** Reports that neither the retained plan nor the skip-turn fallback could be submitted. */
  onDeadlineWithoutShot?: (state: GraphwarAgentAvailableState) => void;
  /** Reports that one ready=true request is about to be sent. */
  onReadyRequested?: (room: GraphwarAgentAvailableRoom) => void;
  /** Reports a submitted shot before its HTTP result is known. */
  onShotSubmitted?: (state: GraphwarAgentAvailableState, plan: GraphwarAgentShotPlan) => void;
  /** Reports the acknowledgement for a once-only shot. */
  onShotSucceeded?: (state: GraphwarAgentAvailableState, plan: GraphwarAgentShotPlan) => void;
  /** Reports a shot failure without retrying it. */
  onShotFailed?: (
    state: GraphwarAgentAvailableState,
    plan: GraphwarAgentShotPlan,
    error: GraphwarAgentClientError,
  ) => void;
  /** Reports a retryable polling failure while managed mode remains enabled. */
  onTransientError?: (error: GraphwarAgentClientError) => void;
  /** Reports an unavailable match and room while waiting in the lobby. */
  onWaiting?: (state: GraphwarAgentState, room: GraphwarAgentRoom) => void;
}

/** 托管控制器的 Agent、时限和回调依赖。 */
export interface GraphwarManagedControllerOptions {
  client: GraphwarAgentClient;
  deadlineMs?: number;
  hooks?: GraphwarManagedControllerHooks;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
}

/** 管理单飞轮询、回合认领和一次性发射的托管控制器。 */
export interface GraphwarManagedController {
  /** Returns the latest active-game state accepted by the current generation. */
  getLatestState: () => GraphwarAgentAvailableState | undefined;
  /** Reports whether polling is currently enabled. */
  isRunning: () => boolean;
  /** Starts one immediate poll and then one single-flight poll per interval. */
  start: () => void;
  /** Stops polling and invalidates every pending state, room, and ready response. */
  stop: () => void;
  /** Claims and submits one exact snapshot plan; false means it was stale or already handled. */
  submitShot: (state: GraphwarAgentAvailableState, plan: GraphwarAgentShotPlan) => boolean;
}

/** Builds the mode-specific shot that exits the battlefield when no usable route exists. */
export function createGraphwarManagedSkipTurnPlan(state: GraphwarAgentAvailableState): GraphwarAgentShotPlan {
  // Do not hit an obstacle as a fallback: its explosion could open a route that lets an opponent attack us.
  return state.equationMode === "ddy"
    ? { angleRadians: 0, equationMode: "ddy", function: GRAPHWAR_MANAGED_SKIP_TURN_FUNCTION }
    : { equationMode: state.equationMode, function: GRAPHWAR_MANAGED_SKIP_TURN_FUNCTION };
}

/** Creates the browser-side managed-mode polling and once-only shot arbiter. */
export function createGraphwarManagedController(options: GraphwarManagedControllerOptions): GraphwarManagedController {
  const hooks = options.hooks ?? {};
  const deadlineMs = options.deadlineMs ?? GRAPHWAR_MANAGED_SHOT_DEADLINE_MS;
  const pollIntervalMs = options.pollIntervalMs ?? GRAPHWAR_MANAGED_POLL_INTERVAL_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? GRAPHWAR_MANAGED_REQUEST_TIMEOUT_MS;
  const abandonedTurns = new Set<string>();
  const claimedTurns = new Set<string>();
  const deadlineHandledTurns = new Set<string>();
  const stateGenerations = new WeakMap<GraphwarAgentAvailableState, number>();
  let activePoll: AbortController | undefined;
  let activePollTimeout: ReturnType<typeof setTimeout> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let latestState: GraphwarAgentAvailableState | undefined;
  let latestWorldObstacleMask: Uint8Array | undefined;
  let latestWorldObstacleMaskRevision: string | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let trackedGameInstanceId: string | undefined;

  /** Starts a fresh polling generation without overlapping an existing one. */
  function start() {
    if (running) {
      return;
    }
    running = true;
    generation += 1;
    void poll(generation);
  }

  /** Invalidates pending work before aborting its transport and timer. */
  function stop() {
    if (!running && !activePoll && !activePollTimeout && !pollTimer) {
      return;
    }
    running = false;
    generation += 1;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = undefined;
    }
    activePoll?.abort();
    activePoll = undefined;
    if (activePollTimeout) {
      clearTimeout(activePollTimeout);
      activePollTimeout = undefined;
    }
    clearDeadlineTimer();
    latestState = undefined;
    latestWorldObstacleMask = undefined;
    latestWorldObstacleMaskRevision = undefined;
  }

  /** Reads state, optionally reads a room, and schedules only after the current poll settles. */
  async function poll(pollGeneration: number) {
    if (!isCurrentGeneration(pollGeneration)) {
      return;
    }
    const abortController = new AbortController();
    activePoll = abortController;
    const pollTimeout = setTimeout(() => {
      if (activePollTimeout === pollTimeout) {
        activePollTimeout = undefined;
      }
      abortController.abort();
    }, requestTimeoutMs);
    activePollTimeout = pollTimeout;
    try {
      const state = await options.client.readState(abortController.signal);
      // Mask download time must count against the authoritative turn budget.
      const stateObservedAt = Date.now();
      if (!isCurrentGeneration(pollGeneration)) {
        return;
      }
      if (!supportsGraphwarManagedMode(state.capabilities)) {
        stopForIncompatible(
          new GraphwarAgentClientError("incompatible", "Graphwar Agent does not support managed mode"),
          pollGeneration,
        );
        return;
      }
      if (state.available && state.phase !== "inactive") {
        const shooter = state.turnToken ? selectGraphwarAgentCurrentShooter(state) : undefined;
        // Remote and resolving turns only need state; defer the large mask until a local shot can be searched.
        if (!shooter) {
          handleAvailableState(state, undefined, undefined, pollGeneration, stateObservedAt);
          return;
        }
        let worldObstacleMask = latestWorldObstacleMask;
        if (latestWorldObstacleMaskRevision !== state.battleRevision || !worldObstacleMask) {
          worldObstacleMask = await options.client.readWorldObstacleMask(state, abortController.signal);
        }
        if (!isCurrentGeneration(pollGeneration)) {
          return;
        }
        latestWorldObstacleMask = worldObstacleMask;
        latestWorldObstacleMaskRevision = state.battleRevision;
        handleAvailableState(state, shooter, worldObstacleMask, pollGeneration, stateObservedAt);
        return;
      }

      clearDeadlineTimer();
      latestState = undefined;
      latestWorldObstacleMask = undefined;
      latestWorldObstacleMaskRevision = undefined;
      const room = await options.client.readRoom(abortController.signal);
      if (!isCurrentGeneration(pollGeneration)) {
        return;
      }
      hooks.onRoom?.(room);
      if (!isCurrentGeneration(pollGeneration)) {
        return;
      }
      if (!room.available) {
        hooks.onWaiting?.(state, room);
        return;
      }
      if (room.players.some((player) => player.local && !player.disconnected && !player.ready)) {
        hooks.onReadyRequested?.(room);
        if (!isCurrentGeneration(pollGeneration)) {
          return;
        }
        await options.client.submitReady(true, abortController.signal);
      }
    } catch (error) {
      if (!isCurrentGeneration(pollGeneration)) {
        return;
      }
      const clientError = normalizeGraphwarManagedError(error);
      if (isGraphwarAgentIncompatibleError(clientError) || clientError.kind === "invalid-request") {
        stopForIncompatible(
          isGraphwarAgentIncompatibleError(clientError)
            ? clientError
            : new GraphwarAgentClientError("incompatible", clientError.message, clientError.status, clientError),
          pollGeneration,
        );
      } else {
        hooks.onTransientError?.(clientError);
      }
    } finally {
      if (activePoll === abortController) {
        activePoll = undefined;
      }
      if (activePollTimeout === pollTimeout) {
        clearTimeout(pollTimeout);
        activePollTimeout = undefined;
      }
      if (isCurrentGeneration(pollGeneration)) {
        // 计时器把下一轮排入新任务；当前 poll 已经结算，不会累积递归调用栈。
        pollTimer = setTimeout(() => {
          pollTimer = undefined;
          void poll(pollGeneration);
        }, pollIntervalMs);
      }
    }
  }

  /** Publishes one active state, rotates bounded turn bookkeeping, and handles its deadline once. */
  function handleAvailableState(
    state: GraphwarAgentAvailableState,
    shooter: GraphwarManagedShooter | undefined,
    worldObstacleMask: Uint8Array | undefined,
    pollGeneration: number,
    stateObservedAt: number,
  ) {
    if (trackedGameInstanceId !== state.gameInstanceId) {
      abandonedTurns.clear();
      claimedTurns.clear();
      deadlineHandledTurns.clear();
      trackedGameInstanceId = state.gameInstanceId;
    }
    latestState = state;
    stateGenerations.set(state, pollGeneration);
    hooks.onState?.(state, shooter, worldObstacleMask);
    if (!isCurrentGeneration(pollGeneration)) {
      return;
    }

    if (
      state.phase !== "aiming" ||
      state.drawingFunction ||
      state.exploding ||
      !state.turnToken ||
      !isGraphwarAgentLocalHuman(state.players[state.currentTurn])
    ) {
      clearDeadlineTimer();
      return;
    }

    const turnKey = createTurnKey(state);
    if (abandonedTurns.has(turnKey) || deadlineHandledTurns.has(turnKey) || claimedTurns.has(turnKey)) {
      clearDeadlineTimer();
      return;
    }

    clearDeadlineTimer();
    if (state.remainingTurnMs > deadlineMs) {
      deadlineTimer = setTimeout(
        () => {
          deadlineTimer = undefined;
          handleDeadline(state, pollGeneration);
        },
        Math.max(0, state.remainingTurnMs - deadlineMs - Math.max(0, Date.now() - stateObservedAt)),
      );
      return;
    }
    handleDeadline(state, pollGeneration);
  }

  /** Uses the latest compatible snapshot to stop optimization even if the next poll hangs. */
  function handleDeadline(state: GraphwarAgentAvailableState, pollGeneration: number) {
    if (!isCurrentGeneration(pollGeneration) || !isCurrentSnapshot(state)) {
      return;
    }
    if (
      state.phase !== "aiming" ||
      state.drawingFunction ||
      state.exploding ||
      !state.turnToken ||
      !isGraphwarAgentLocalHuman(state.players[state.currentTurn])
    ) {
      return;
    }

    const turnKey = createTurnKey(state);
    if (abandonedTurns.has(turnKey) || deadlineHandledTurns.has(turnKey) || claimedTurns.has(turnKey)) {
      return;
    }
    deadlineHandledTurns.add(turnKey);
    hooks.onDeadline?.(state);
    if (!isCurrentGeneration(pollGeneration)) {
      return;
    }
    const plan = hooks.decideDeadlineShot?.(state) ?? createGraphwarManagedSkipTurnPlan(state);
    if (!isCurrentGeneration(pollGeneration)) {
      return;
    }
    if (!submitShot(state, plan)) {
      abandonedTurns.add(turnKey);
      hooks.onDeadlineWithoutShot?.(state);
    }
  }

  /** Claims before awaiting HTTP so completion and deadline callbacks cannot both fire. */
  function submitShot(state: GraphwarAgentAvailableState, plan: GraphwarAgentShotPlan) {
    if (!running || !isCurrentSnapshot(state)) {
      return false;
    }
    if (!isGraphwarAgentLocalHuman(state.players[state.currentTurn])) {
      return false;
    }

    const turnKey = createTurnKey(state);
    if (abandonedTurns.has(turnKey) || claimedTurns.has(turnKey)) {
      return false;
    }

    let request;
    try {
      request = createGraphwarAgentShotRequest(state, plan);
    } catch (error) {
      // A deterministic local validation failure cannot improve on the next poll of the same turn.
      abandonedTurns.add(turnKey);
      clearDeadlineTimer();
      hooks.onShotFailed?.(state, plan, normalizeGraphwarManagedError(error));
      return false;
    }

    claimedTurns.add(turnKey);
    clearDeadlineTimer();
    const shotGeneration = generation;
    hooks.onShotSubmitted?.(state, plan);
    let resultHandled = false;
    /** Accepts only the first acknowledgement, failure, or watchdog result for this once-only shot. */
    const handleResult = (callback: () => void) => {
      if (resultHandled) {
        return;
      }
      resultHandled = true;
      clearTimeout(resultTimeout);
      if (isCurrentGeneration(shotGeneration)) {
        callback();
      }
    };
    const resultTimeout = setTimeout(
      () =>
        handleResult(() =>
          hooks.onShotFailed?.(
            state,
            plan,
            new GraphwarAgentClientError("transient", "Graphwar Agent shot result timed out"),
          ),
        ),
      requestTimeoutMs,
    );
    void options.client.submitShot(request).then(
      () => handleResult(() => hooks.onShotSucceeded?.(state, plan)),
      (error: unknown) => {
        handleResult(() => {
          const clientError = normalizeGraphwarManagedError(error);
          hooks.onShotFailed?.(state, plan, clientError);
          if (isGraphwarAgentIncompatibleError(clientError)) {
            stopForIncompatible(clientError, shotGeneration);
          }
        });
      },
    );
    return true;
  }

  /** Stops only the generation that observed an incompatible contract. */
  function stopForIncompatible(error: GraphwarAgentClientError, errorGeneration: number) {
    if (!isCurrentGeneration(errorGeneration)) {
      return;
    }
    hooks.onIncompatibleError?.(error);
    stop();
  }

  /** Guards every async continuation against stop/restart and incompatible shutdown. */
  function isCurrentGeneration(candidate: number) {
    return running && candidate === generation;
  }

  /** Requires identity, turn, and battle revision equality before a plan can be fired. */
  function isCurrentSnapshot(state: GraphwarAgentAvailableState) {
    return (
      stateGenerations.get(state) === generation &&
      latestState?.gameInstanceId === state.gameInstanceId &&
      latestState.turnToken === state.turnToken &&
      latestState.battleRevision === state.battleRevision
    );
  }

  /** Clears the single authoritative deadline timer without affecting polling. */
  function clearDeadlineTimer() {
    if (deadlineTimer) {
      clearTimeout(deadlineTimer);
      deadlineTimer = undefined;
    }
  }

  return {
    getLatestState: () => latestState,
    isRunning: () => running,
    start,
    stop,
    submitShot,
  };
}

/** Keeps opaque identifiers separate without interpreting their contents. */
function createTurnKey(state: GraphwarAgentAvailableState) {
  return `${state.gameInstanceId}\u0000${state.turnToken ?? ""}`;
}

/** Treats unknown integration and transport failures as retryable by default. */
function normalizeGraphwarManagedError(error: unknown) {
  return error instanceof GraphwarAgentClientError
    ? error
    : new GraphwarAgentClientError(
        "transient",
        error instanceof Error ? error.message : String(error),
        undefined,
        error,
      );
}
