import {
  createGraphwarAgentShotCommandError,
  createGraphwarAgentShotRequest,
  GraphwarAgentClientError,
  isGraphwarAgentIncompatibleError,
  selectGraphwarAgentCurrentShooter,
  supportsGraphwarManagedMode,
  type GraphwarAgentAvailableRoom,
  type GraphwarAgentAvailableState,
  type GraphwarAgentClient,
  type GraphwarAgentCurrentShooter,
  type GraphwarAgentRoom,
  type GraphwarAgentShotCommand,
  type GraphwarAgentShotCommandSummary,
  type GraphwarAgentShotPlan,
  type GraphwarAgentState,
} from "../agent/client";
import { resolveExistingGraphwarAgentShotCommand, resolveGraphwarAgentShotCommand } from "../agent/shot-command";
import { getAdjustedGraphwarAgentRemainingTurnMs } from "../agent/turn-countdown";

export const GRAPHWAR_MANAGED_POLL_INTERVAL_MS = 1000;
export const GRAPHWAR_MANAGED_REQUEST_TIMEOUT_MS = 5000;
export const GRAPHWAR_MANAGED_SHOT_DEADLINE_MS = 3000;
export const GRAPHWAR_MANAGED_SKIP_TURN_FUNCTION = "999999999999999x";

export type GraphwarManagedShooter = GraphwarAgentCurrentShooter;

/** 托管轮询在状态、截止时间和发射结果上的可选回调。 */
export interface GraphwarManagedControllerHooks {
  /** Chooses the last fully validated plan when the authoritative deadline is reached. */
  decideDeadlineShot?: (state: GraphwarAgentAvailableState) => GraphwarAgentShotPlan | undefined;
  /** Reports the authoritative deadline before choosing an incumbent or skip-turn plan. */
  onDeadline?: (state: GraphwarAgentAvailableState) => void;
  /** Reports that neither the retained plan nor the skip-turn fallback could be submitted. */
  onDeadlineWithoutShot?: (state: GraphwarAgentAvailableState) => void;
  /** Reports a protocol version or response shape that requires an Agent upgrade. */
  onIncompatibleError?: (error: GraphwarAgentClientError) => void;
  /** Reports a deterministic request or Agent setting error that requires user correction. */
  onInvalidRequestError?: (error: GraphwarAgentClientError) => void;
  /** Reports the terminal result of a command recovered without its original local plan. */
  onRecoveredShotCommand?: (state: GraphwarAgentAvailableState, command: GraphwarAgentShotCommand) => void;
  /** Reports that one ready=true request is about to be sent. */
  onReadyRequested?: (room: GraphwarAgentAvailableRoom) => void;
  /** Reports a polling-friendly pre-game room state. */
  onRoom?: (room: GraphwarAgentRoom) => void;
  /** Reports an active-game state and its current local-human shooter, if any. */
  onState?: (
    state: GraphwarAgentAvailableState,
    shooter: GraphwarManagedShooter | undefined,
    worldObstacleMask: Uint8Array | undefined,
  ) => void;
  /** Reports every accepted live state immediately, before optional room or obstacle requests. */
  onStateRead?: (state: GraphwarAgentState) => void;
  /** Reports a command that reached the Agent's deterministic failed state. */
  onShotFailed?: (
    state: GraphwarAgentAvailableState,
    plan: GraphwarAgentShotPlan,
    error: GraphwarAgentClientError,
  ) => void;
  /** Reports that one stable request ID has entered the recovery workflow. */
  onShotRequestStarted?: (state: GraphwarAgentAvailableState, plan: GraphwarAgentShotPlan) => void;
  /** Reports that a retained non-terminal command is being recovered after local state loss. */
  onShotRecoveryStarted?: (state: GraphwarAgentAvailableState, summary: GraphwarAgentShotCommandSummary) => void;
  /** Reports a command that the original client returned from normally. */
  onShotSubmitted?: (state: GraphwarAgentAvailableState, plan: GraphwarAgentShotPlan) => void;
  /** Reports an irreversible claim whose final original-client result is unknown. */
  onShotUnknown?: (
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
  /** Time before a pending POST switches to GET-based command recovery. */
  shotResultTimeoutMs?: number;
}

/** 管理单飞轮询、O(1) 回合状态和幂等发射恢复的托管控制器。 */
export interface GraphwarManagedController {
  /** Returns the latest active-game state accepted by the current generation. */
  getLatestState: () => GraphwarAgentAvailableState | undefined;
  /** Reports whether polling is currently enabled. */
  isRunning: () => boolean;
  /** Starts one immediate poll and then one single-flight poll per interval. */
  start: () => void;
  /** Stops polling and invalidates every pending state, room, ready, and recovery response. */
  stop: () => void;
  /** Claims and submits one exact snapshot plan; false means it is stale, busy, or already handled. */
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
  const shotResultTimeoutMs = options.shotResultTimeoutMs ?? requestTimeoutMs;
  const stateGenerations = new WeakMap<GraphwarAgentAvailableState, number>();
  let activePoll: AbortController | undefined;
  let activePollTimeout: ReturnType<typeof setTimeout> | undefined;
  let activeShotRecovery: AbortController | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let hasAbandonedCurrentTurn = false;
  let hasHandledCurrentDeadline = false;
  let hasRequestedCurrentTurn = false;
  let handledShotRequestId: string | undefined;
  let latestState: GraphwarAgentAvailableState | undefined;
  let latestWorldObstacleMask: Uint8Array | undefined;
  let latestWorldObstacleMaskRevision: string | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let isRunning = false;
  let trackedGameInstanceId: string | undefined;
  let trackedTurnKey: string | undefined;

  /** Starts a fresh polling generation without overlapping an existing one. */
  function start() {
    if (isRunning) {
      return;
    }
    isRunning = true;
    generation += 1;
    void poll(generation);
  }

  /** Invalidates pending work before aborting its transport and timers. */
  function stop() {
    if (!isRunning && !activePoll && !activePollTimeout && !pollTimer && !activeShotRecovery) {
      return;
    }
    isRunning = false;
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
    activeShotRecovery?.abort();
    activeShotRecovery = undefined;
    clearDeadlineTimer();
    latestState = undefined;
    latestWorldObstacleMask = undefined;
    latestWorldObstacleMaskRevision = undefined;
    trackedGameInstanceId = undefined;
    trackedTurnKey = undefined;
    handledShotRequestId = undefined;
    hasAbandonedCurrentTurn = false;
    hasHandledCurrentDeadline = false;
    hasRequestedCurrentTurn = false;
  }

  /** Reads state, optionally reads a room, and schedules only after the current poll settles. */
  async function poll(pollGeneration: number) {
    if (!isCurrentGeneration(pollGeneration)) {
      return;
    }
    // A claimed original call may hold Graphwar's GameData monitor indefinitely. During
    // command recovery, query only /shots/{id} so timed-out /state requests cannot fill
    // the Agent's bounded HTTP worker pool.
    if (activeShotRecovery) {
      scheduleNextPoll(pollGeneration);
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
      if (!isCurrentGeneration(pollGeneration)) {
        return;
      }
      hooks.onStateRead?.(state);
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
      if (state.isAvailable) {
        rotateTrackedTurn(state);
        // Once this turn owns a command, neither a mask nor another search can improve its outcome.
        if (state.shotCommand || hasRequestedCurrentTurn) {
          handleAvailableState(state, undefined, undefined, pollGeneration);
          return;
        }
        const shooter = state.turnToken ? selectGraphwarAgentCurrentShooter(state) : undefined;
        // Remote and resolving turns only need state; defer the large mask until a local shot can be searched.
        if (!shooter) {
          handleAvailableState(state, undefined, undefined, pollGeneration);
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
        handleAvailableState(state, shooter, worldObstacleMask, pollGeneration);
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
      if (!room.isAvailable) {
        hooks.onWaiting?.(state, room);
        return;
      }
      if (room.players.some((player) => player.isLocal && player.isConnected && !player.isReady)) {
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
        stopForTerminalRequestError(clientError, pollGeneration);
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
        scheduleNextPoll(pollGeneration);
      }
    }
  }

  /** Queues one iterative poll after the current poll or recovery gate has settled. */
  function scheduleNextPoll(pollGeneration: number) {
    // The timer queues a new task, so call stacks never grow with uptime.
    pollTimer = setTimeout(() => {
      pollTimer = undefined;
      void poll(pollGeneration);
    }, pollIntervalMs);
  }

  /** Publishes one active state, rotates O(1) turn bookkeeping, and handles its deadline once. */
  function handleAvailableState(
    state: GraphwarAgentAvailableState,
    shooter: GraphwarManagedShooter | undefined,
    worldObstacleMask: Uint8Array | undefined,
    pollGeneration: number,
  ) {
    latestState = state;
    stateGenerations.set(state, pollGeneration);
    if (state.shotCommand) {
      // The summary survives page/controller state loss. Query its full resource once so
      // submitted, failed, and unknown remain distinguishable without inventing a new ID.
      hasRequestedCurrentTurn = true;
      clearDeadlineTimer();
      if (state.turnToken && handledShotRequestId !== state.shotCommand.requestId && !activeShotRecovery) {
        handledShotRequestId = state.shotCommand.requestId;
        const recovery = new AbortController();
        activeShotRecovery = recovery;
        if (state.shotCommand.status === "validating" || state.shotCommand.status === "claimed") {
          hooks.onShotRecoveryStarted?.(state, state.shotCommand);
        }
        void resolveExistingGraphwarAgentShotCommand(
          options.client,
          {
            battleRevision: state.battleRevision,
            gameInstanceId: state.gameInstanceId,
            requestId: state.shotCommand.requestId,
            turnToken: state.turnToken,
          },
          {
            pollIntervalMs,
            readTimeoutMs: requestTimeoutMs,
            signal: recovery.signal,
          },
        ).then(
          (command) => {
            if (!isCurrentGeneration(pollGeneration) || recovery.signal.aborted || activeShotRecovery !== recovery) {
              return;
            }
            activeShotRecovery = undefined;
            hooks.onRecoveredShotCommand?.(state, command);
          },
          (error: unknown) => {
            if (!isCurrentGeneration(pollGeneration) || recovery.signal.aborted) {
              return;
            }
            activeShotRecovery = undefined;
            const clientError = normalizeGraphwarManagedError(error);
            if (isGraphwarAgentIncompatibleError(clientError) || clientError.kind === "invalid-request") {
              stopForTerminalRequestError(clientError, pollGeneration);
              return;
            }
            // A state/command race may settle on the next state snapshot; allow that snapshot to restart recovery.
            handledShotRequestId = undefined;
            hooks.onTransientError?.(clientError);
          },
        );
      }
      return;
    }
    if (hasRequestedCurrentTurn) {
      clearDeadlineTimer();
      return;
    }
    hooks.onState?.(state, shooter, worldObstacleMask);
    if (!isCurrentGeneration(pollGeneration)) {
      return;
    }

    if (state.phase !== "aiming" || !state.turnToken || !shooter) {
      clearDeadlineTimer();
      return;
    }
    if (hasAbandonedCurrentTurn || hasHandledCurrentDeadline || hasRequestedCurrentTurn) {
      clearDeadlineTimer();
      return;
    }

    clearDeadlineTimer();
    const remainingTurnMs = getAdjustedGraphwarAgentRemainingTurnMs(state);
    if (remainingTurnMs > deadlineMs) {
      deadlineTimer = setTimeout(() => {
        deadlineTimer = undefined;
        handleDeadline(state, pollGeneration);
      }, remainingTurnMs - deadlineMs);
      return;
    }
    handleDeadline(state, pollGeneration);
  }

  /** Uses the latest compatible snapshot to stop optimization even if the next poll hangs. */
  function handleDeadline(state: GraphwarAgentAvailableState, pollGeneration: number) {
    if (!isCurrentGeneration(pollGeneration) || !isCurrentSnapshot(state)) {
      return;
    }
    const shooter = selectGraphwarAgentCurrentShooter(state);
    if (
      state.phase !== "aiming" ||
      !state.turnToken ||
      !shooter ||
      hasAbandonedCurrentTurn ||
      hasHandledCurrentDeadline ||
      hasRequestedCurrentTurn ||
      !state.canAcceptShotCommands
    ) {
      return;
    }

    hasHandledCurrentDeadline = true;
    hooks.onDeadline?.(state);
    if (!isCurrentGeneration(pollGeneration)) {
      return;
    }
    const plan = hooks.decideDeadlineShot?.(state) ?? createGraphwarManagedSkipTurnPlan(state);
    if (!isCurrentGeneration(pollGeneration)) {
      return;
    }
    if (!submitShot(state, plan)) {
      hasAbandonedCurrentTurn = true;
      hooks.onDeadlineWithoutShot?.(state);
    }
  }

  /** Claims the current turn before starting one stable-ID command recovery loop. */
  function submitShot(state: GraphwarAgentAvailableState, plan: GraphwarAgentShotPlan) {
    if (
      !isRunning ||
      !isCurrentSnapshot(state) ||
      !selectGraphwarAgentCurrentShooter(state) ||
      !state.canAcceptShotCommands ||
      hasAbandonedCurrentTurn ||
      hasRequestedCurrentTurn
    ) {
      return false;
    }

    let request;
    try {
      request = createGraphwarAgentShotRequest(state, plan);
    } catch (error) {
      // A deterministic local validation failure cannot improve on the next poll of the same turn.
      hasAbandonedCurrentTurn = true;
      clearDeadlineTimer();
      hooks.onShotFailed?.(state, plan, normalizeGraphwarManagedError(error));
      return false;
    }

    hasRequestedCurrentTurn = true;
    handledShotRequestId = request.requestId;
    clearDeadlineTimer();
    const shotGeneration = generation;
    const recovery = new AbortController();
    activeShotRecovery?.abort();
    activeShotRecovery = recovery;
    hooks.onShotRequestStarted?.(state, plan);
    void resolveGraphwarAgentShotCommand(options.client, request, {
      pollIntervalMs,
      postResultTimeoutMs: shotResultTimeoutMs,
      readTimeoutMs: requestTimeoutMs,
      signal: recovery.signal,
    }).then(
      (command) => {
        if (!isCurrentGeneration(shotGeneration) || recovery.signal.aborted) {
          return;
        }
        activeShotRecovery = undefined;
        if (command.status === "submitted") {
          hooks.onShotSubmitted?.(state, plan);
          return;
        }
        const error = createGraphwarAgentShotCommandError(command);
        if (command.status === "failed") {
          hooks.onShotFailed?.(state, plan, error);
        } else {
          hooks.onShotUnknown?.(state, plan, error);
        }
      },
      (error: unknown) => {
        if (!isCurrentGeneration(shotGeneration) || recovery.signal.aborted) {
          return;
        }
        activeShotRecovery = undefined;
        const clientError = normalizeGraphwarManagedError(error);
        hooks.onShotFailed?.(state, plan, clientError);
        if (isGraphwarAgentIncompatibleError(clientError) || clientError.kind === "invalid-request") {
          stopForTerminalRequestError(clientError, shotGeneration);
        }
      },
    );
    return true;
  }

  /** Keeps only the current concrete turn's three decision flags. */
  function rotateTrackedTurn(state: GraphwarAgentAvailableState) {
    const turnKey = state.turnToken ? createTurnKey(state) : undefined;
    if (trackedGameInstanceId === state.gameInstanceId && (!turnKey || trackedTurnKey === turnKey)) {
      return;
    }
    activeShotRecovery?.abort();
    activeShotRecovery = undefined;
    trackedGameInstanceId = state.gameInstanceId;
    trackedTurnKey = turnKey;
    handledShotRequestId = undefined;
    hasAbandonedCurrentTurn = false;
    hasHandledCurrentDeadline = false;
    hasRequestedCurrentTurn = false;
  }

  /** Stops only the generation that observed an incompatible contract. */
  function stopForIncompatible(error: GraphwarAgentClientError, errorGeneration: number) {
    if (!isCurrentGeneration(errorGeneration)) {
      return;
    }
    hooks.onIncompatibleError?.(error);
    stop();
  }

  /** Preserves correctable request failures instead of presenting them as Agent incompatibility. */
  function stopForTerminalRequestError(error: GraphwarAgentClientError, errorGeneration: number) {
    if (error.kind === "invalid-request") {
      if (!isCurrentGeneration(errorGeneration)) {
        return;
      }
      hooks.onInvalidRequestError?.(error);
      stop();
      return;
    }
    stopForIncompatible(
      isGraphwarAgentIncompatibleError(error)
        ? error
        : new GraphwarAgentClientError("incompatible", error.message, error.status, error, error.code),
      errorGeneration,
    );
  }

  /** Guards every async continuation against stop/restart and incompatible shutdown. */
  function isCurrentGeneration(candidate: number) {
    return isRunning && candidate === generation;
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
    isRunning: () => isRunning,
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
