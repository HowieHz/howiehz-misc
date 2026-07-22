import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPixelPoint } from "../../core/types";
import {
  GraphwarAgentClientError,
  type GraphwarAgentAvailableState,
  type GraphwarAgentClient,
  type GraphwarAgentRoom,
  type GraphwarAgentShotCommand,
  type GraphwarAgentShotRequest,
  type GraphwarAgentState,
} from "../agent/client";
import { createGraphwarManagedController } from "./controller";

describe("Graphwar managed controller v3", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("submits one stable command and reports submitted exactly once", async () => {
    const state = createAvailableState();
    const client = createClient(state);
    client.submitShot.mockImplementation(async (request) => createCommand(request, "submitted"));
    const onShotRequestStarted = vi.fn();
    const onShotSubmitted = vi.fn();
    const controller = createGraphwarManagedController({
      client,
      hooks: { onShotRequestStarted, onShotSubmitted },
      pollIntervalMs: 10,
    });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.submitShot(state, { equationMode: "y", function: "x" })).toBe(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(client.submitShot).toHaveBeenCalledOnce();
    expect(onShotRequestStarted).toHaveBeenCalledOnce();
    expect(onShotSubmitted).toHaveBeenCalledOnce();
    expect(controller.submitShot(state, { equationMode: "y", function: "x+1" })).toBe(false);
    controller.stop();
  });

  it.each(["failed", "unknown"] as const)("keeps %s distinct and never creates a new request ID", async (status) => {
    const state = createAvailableState();
    const client = createClient(state);
    client.submitShot.mockImplementation(async (request) => createCommand(request, status));
    const onShotFailed = vi.fn();
    const onShotUnknown = vi.fn();
    const controller = createGraphwarManagedController({
      client,
      hooks: { onShotFailed, onShotUnknown },
    });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);

    controller.submitShot(state, { equationMode: "y", function: "x" });
    await vi.advanceTimersByTimeAsync(0);

    expect(status === "failed" ? onShotFailed : onShotUnknown).toHaveBeenCalledOnce();
    expect(status === "failed" ? onShotUnknown : onShotFailed).not.toHaveBeenCalled();
    expect(client.submitShot).toHaveBeenCalledOnce();
    controller.stop();
  });

  it("recovers a lost POST response by querying the same request ID", async () => {
    const state = createAvailableState();
    const client = createClient(state);
    client.submitShot.mockRejectedValue(new GraphwarAgentClientError("transient", "connection reset"));
    client.readShotCommand.mockImplementation(async (requestId) =>
      createCommand({ ...createRequest(), requestId }, "submitted"),
    );
    const onShotSubmitted = vi.fn();
    const controller = createGraphwarManagedController({ client, hooks: { onShotSubmitted }, pollIntervalMs: 10 });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    controller.submitShot(state, { equationMode: "y", function: "x" });

    await vi.advanceTimersByTimeAsync(0);

    const submittedRequest = client.submitShot.mock.calls[0][0];
    expect(client.readShotCommand).toHaveBeenCalledWith(submittedRequest.requestId, expect.any(AbortSignal));
    expect(onShotSubmitted).toHaveBeenCalledOnce();
    controller.stop();
  });

  it("does not treat a deterministic HTTP POST failure as a lost response", async () => {
    const state = createAvailableState();
    const client = createClient(state);
    client.submitShot.mockRejectedValue(
      new GraphwarAgentClientError("transient", "capacity exhausted", 503, undefined, "command-capacity-exhausted"),
    );
    const onShotFailed = vi.fn();
    const controller = createGraphwarManagedController({ client, hooks: { onShotFailed } });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    controller.submitShot(state, { equationMode: "y", function: "x" });

    await vi.advanceTimersByTimeAsync(0);

    expect(onShotFailed).toHaveBeenCalledOnce();
    expect(client.readShotCommand).not.toHaveBeenCalled();
    controller.stop();
  });

  it("aborts the POST transport when recovery switches to command queries", async () => {
    const state = createAvailableState();
    const client = createClient(state);
    let submissionSignal: AbortSignal | undefined;
    client.submitShot.mockImplementation(
      (_request, signal) =>
        new Promise((_resolve, reject) => {
          submissionSignal = signal;
          signal?.addEventListener(
            "abort",
            () => reject(new GraphwarAgentClientError("transient", "submission aborted", undefined, signal.reason)),
            { once: true },
          );
        }),
    );
    const controller = createGraphwarManagedController({ client, pollIntervalMs: 10, shotResultTimeoutMs: 10 });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    controller.submitShot(state, { equationMode: "y", function: "x" });

    await vi.advanceTimersByTimeAsync(10);

    expect(submissionSignal?.aborted).toBe(true);
    expect(client.readShotCommand).toHaveBeenCalled();
    controller.stop();
  });

  it("replays exactly once after a 404 and preserves the entire payload", async () => {
    const state = createAvailableState();
    const client = createClient(state);
    client.submitShot
      .mockRejectedValueOnce(new GraphwarAgentClientError("transient", "connection reset"))
      .mockRejectedValueOnce(new GraphwarAgentClientError("transient", "connection reset again"));
    client.readShotCommand
      .mockRejectedValueOnce(
        new GraphwarAgentClientError("conflict", "missing", 404, undefined, "shot-command-not-found"),
      )
      .mockRejectedValueOnce(
        new GraphwarAgentClientError("conflict", "still missing", 404, undefined, "shot-command-not-found"),
      )
      .mockImplementationOnce(async (requestId) => createCommand({ ...createRequest(), requestId }, "submitted"));
    const controller = createGraphwarManagedController({ client, pollIntervalMs: 10 });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    controller.submitShot(state, { equationMode: "y", function: "x" });

    await vi.advanceTimersByTimeAsync(20);

    expect(client.submitShot).toHaveBeenCalledTimes(2);
    expect(client.submitShot.mock.calls[1][0]).toEqual(client.submitShot.mock.calls[0][0]);
    controller.stop();
  });

  it("keeps claimed commands pending instead of reporting failure", async () => {
    const state = createAvailableState();
    const client = createClient(state);
    client.submitShot.mockImplementation(async (request) => createCommand(request, "claimed"));
    client.readShotCommand.mockImplementation(async (requestId) =>
      createCommand({ ...createRequest(), requestId }, "claimed"),
    );
    const onShotFailed = vi.fn();
    const onShotSubmitted = vi.fn();
    const onShotUnknown = vi.fn();
    const controller = createGraphwarManagedController({
      client,
      hooks: { onShotFailed, onShotSubmitted, onShotUnknown },
      pollIntervalMs: 10,
      shotResultTimeoutMs: 10,
    });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    controller.submitShot(state, { equationMode: "y", function: "x" });

    await vi.advanceTimersByTimeAsync(100);

    expect(client.readShotCommand).toHaveBeenCalled();
    expect(client.readState).toHaveBeenCalledOnce();
    expect(onShotFailed).not.toHaveBeenCalled();
    expect(onShotSubmitted).not.toHaveBeenCalled();
    expect(onShotUnknown).not.toHaveBeenCalled();
    controller.stop();
  });

  it("adopts a claimed command from state and pauses state polling until it finishes", async () => {
    const request = createRequest();
    let commandStatus: GraphwarAgentShotCommand["status"] = "claimed";
    let state = createAvailableState({ shotCommand: { requestId: request.requestId, status: "claimed" } });
    const recoveryState = state;
    const client = createClient(state);
    client.readState.mockImplementation(async () => state);
    client.readShotCommand.mockImplementation(async () => createCommand(request, commandStatus));
    const onRecoveredShotCommand = vi.fn();
    const onShotRecoveryStarted = vi.fn();
    const onState = vi.fn();
    const controller = createGraphwarManagedController({
      client,
      hooks: { onRecoveredShotCommand, onShotRecoveryStarted, onState },
      pollIntervalMs: 10,
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(50);

    expect(client.readState).toHaveBeenCalledOnce();
    expect(client.readShotCommand).toHaveBeenCalled();
    expect(client.readWorldObstacleMask).not.toHaveBeenCalled();
    expect(client.submitShot).not.toHaveBeenCalled();
    expect(onShotRecoveryStarted).toHaveBeenCalledOnce();
    expect(onState).not.toHaveBeenCalled();
    expect(onRecoveredShotCommand).not.toHaveBeenCalled();
    const pendingReadCount = client.readShotCommand.mock.calls.length;

    commandStatus = "submitted";
    state = createAvailableState({ shotCommand: { requestId: request.requestId, status: "submitted" } });
    await vi.advanceTimersByTimeAsync(20);

    expect(client.readState.mock.calls.length).toBeGreaterThan(1);
    expect(client.readShotCommand).toHaveBeenCalledTimes(pendingReadCount + 1);
    expect(client.submitShot).not.toHaveBeenCalled();
    expect(onRecoveredShotCommand).toHaveBeenCalledOnce();
    expect(onRecoveredShotCommand).toHaveBeenCalledWith(recoveryState, createCommand(request, "submitted"));
    await vi.advanceTimersByTimeAsync(30);
    expect(client.readShotCommand).toHaveBeenCalledTimes(pendingReadCount + 1);
    expect(onRecoveredShotCommand).toHaveBeenCalledOnce();
    controller.stop();
  });

  it.each(["submitted", "failed", "unknown"] as const)(
    "reports a recovered %s command once without restarting search",
    async (status) => {
      const request = createRequest();
      const state = createAvailableState({ shotCommand: { requestId: request.requestId, status: "validating" } });
      const client = createClient(state);
      const command = createCommand(request, status);
      client.readShotCommand.mockResolvedValue(command);
      const onRecoveredShotCommand = vi.fn();
      const onState = vi.fn();
      const controller = createGraphwarManagedController({
        client,
        hooks: { onRecoveredShotCommand, onState },
        pollIntervalMs: 10,
      });

      controller.start();
      await vi.advanceTimersByTimeAsync(50);

      expect(client.readShotCommand).toHaveBeenCalledOnce();
      expect(client.readWorldObstacleMask).not.toHaveBeenCalled();
      expect(client.submitShot).not.toHaveBeenCalled();
      expect(onState).not.toHaveBeenCalled();
      expect(onRecoveredShotCommand).toHaveBeenCalledOnce();
      expect(onRecoveredShotCommand).toHaveBeenCalledWith(state, command);
      controller.stop();
    },
  );

  it("preserves a recovered failure after its summary disappears and resumes on the next turn", async () => {
    const request = createRequest();
    let state = createAvailableState({ shotCommand: { requestId: request.requestId, status: "validating" } });
    const client = createClient(state);
    client.readState.mockImplementation(async () => state);
    client.readShotCommand.mockResolvedValue(createCommand(request, "failed"));
    const onRecoveredShotCommand = vi.fn();
    const onState = vi.fn();
    const controller = createGraphwarManagedController({
      client,
      hooks: { onRecoveredShotCommand, onState },
      pollIntervalMs: 10,
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    state = createAvailableState({ shotCommand: null });
    await vi.advanceTimersByTimeAsync(30);

    expect(onRecoveredShotCommand).toHaveBeenCalledOnce();
    expect(onState).not.toHaveBeenCalled();
    expect(client.readWorldObstacleMask).not.toHaveBeenCalled();

    state = createAvailableState({
      shotCommand: null,
      turnToken: "00000000-0000-4000-8000-000000000012",
    });
    await vi.advanceTimersByTimeAsync(20);

    expect(onState).toHaveBeenCalled();
    expect(client.readWorldObstacleMask).toHaveBeenCalled();
    controller.stop();
  });

  it("re-observes a retained command when the same controller is stopped and restarted", async () => {
    const request = createRequest();
    const state = createAvailableState({ shotCommand: { requestId: request.requestId, status: "submitted" } });
    const client = createClient(state);
    client.readShotCommand.mockResolvedValue(createCommand(request, "submitted"));
    const onRecoveredShotCommand = vi.fn();
    const controller = createGraphwarManagedController({ client, hooks: { onRecoveredShotCommand } });

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    controller.stop();
    controller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(client.readShotCommand).toHaveBeenCalledTimes(2);
    expect(onRecoveredShotCommand).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it("does not retry a retained command query rejected with HTTP 431", async () => {
    const request = createRequest();
    const state = createAvailableState({ shotCommand: { requestId: request.requestId, status: "claimed" } });
    const client = createClient(state);
    client.readShotCommand.mockRejectedValue(
      new GraphwarAgentClientError("invalid-request", "headers too large", 431, undefined, "request-headers-too-large"),
    );
    const onIncompatibleError = vi.fn();
    const controller = createGraphwarManagedController({ client, hooks: { onIncompatibleError }, pollIntervalMs: 10 });

    controller.start();
    await vi.advanceTimersByTimeAsync(50);

    expect(client.readShotCommand).toHaveBeenCalledOnce();
    expect(onIncompatibleError).toHaveBeenCalledOnce();
    expect(controller.isRunning()).toBe(false);
  });

  it("waits while the dynamic execution slot is busy without disabling managed mode", async () => {
    const state = createAvailableState({ canAcceptShotCommands: false });
    const client = createClient(state);
    const onIncompatibleError = vi.fn();
    const controller = createGraphwarManagedController({ client, hooks: { onIncompatibleError } });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.submitShot(state, { equationMode: "y", function: "x" })).toBe(false);
    expect(controller.isRunning()).toBe(true);
    expect(client.submitShot).not.toHaveBeenCalled();
    expect(onIncompatibleError).not.toHaveBeenCalled();
    controller.stop();
  });

  it("uses v3 room fields and PUT-ready client semantics", async () => {
    const client = createClient(createUnavailableState());
    client.readRoom.mockResolvedValue(createAvailableRoom());
    const onReadyRequested = vi.fn();
    const controller = createGraphwarManagedController({ client, hooks: { onReadyRequested } });

    controller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(onReadyRequested).toHaveBeenCalledOnce();
    expect(client.submitReady).toHaveBeenCalledWith(true, expect.any(AbortSignal));
    controller.stop();
  });

  it("stops for a missing static capability but not for a dynamic busy state", async () => {
    const state = createAvailableState({
      capabilities: { ...createCapabilities(), canSubmitShots: false },
    });
    const client = createClient(state);
    const onIncompatibleError = vi.fn();
    const controller = createGraphwarManagedController({ client, hooks: { onIncompatibleError } });

    controller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.isRunning()).toBe(false);
    expect(onIncompatibleError).toHaveBeenCalledOnce();
  });

  it("ignores a late terminal result after stop", async () => {
    const state = createAvailableState();
    const client = createClient(state);
    let resolveSubmission: ((command: GraphwarAgentShotCommand) => void) | undefined;
    client.submitShot.mockImplementation(
      (request) =>
        new Promise((resolve) => {
          resolveSubmission = (command) => resolve(command);
          expect(commandRequestId(commandPlaceholder(request))).toBe(request.requestId);
        }),
    );
    const onShotSubmitted = vi.fn();
    const controller = createGraphwarManagedController({
      client,
      hooks: { onShotSubmitted },
      shotResultTimeoutMs: 100,
    });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    controller.submitShot(state, { equationMode: "y", function: "x" });
    const request = client.submitShot.mock.calls[0][0];
    controller.stop();

    resolveSubmission?.(createCommand(request, "submitted"));
    await vi.advanceTimersByTimeAsync(0);

    expect(onShotSubmitted).not.toHaveBeenCalled();
  });

  it("rotates bounded turn flags across many turns", async () => {
    let state = createAvailableState();
    const client = createClient(state);
    client.readState.mockImplementation(async () => state);
    client.submitShot.mockImplementation(async (request) => createCommand(request, "submitted"));
    const controller = createGraphwarManagedController({ client, pollIntervalMs: 1 });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);

    for (let index = 0; index < 60; index += 1) {
      expect(controller.submitShot(state, { equationMode: "y", function: "x" })).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      state = createAvailableState({
        battleRevision: `sha256:${index.toString(16).padStart(64, "0")}`,
        turnToken: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
      });
      await vi.advanceTimersByTimeAsync(1);
    }

    expect(client.submitShot).toHaveBeenCalledTimes(60);
    controller.stop();
  });
});

type FakeClient = {
  [Key in keyof GraphwarAgentClient]: GraphwarAgentClient[Key] extends (...args: infer Args) => infer Result
    ? ReturnType<typeof vi.fn<(...args: Args) => Result>>
    : GraphwarAgentClient[Key];
};

/** Creates a complete mock client whose individual endpoints can be overridden per test. */
function createClient(state: GraphwarAgentState): FakeClient {
  return {
    baseUrl: "http://127.0.0.1:17900",
    readRoom: vi.fn(async () => ({ isAvailable: false, reason: "not-in-pre-game-room" })),
    readShotCommand: vi.fn(async (requestId) => createCommand({ ...createRequest(), requestId }, "claimed")),
    readState: vi.fn(async () => state),
    readWorldObstacleMask: vi.fn(async () => new Uint8Array(770 * 450)),
    submitReady: vi.fn(async (isReady) => ({ isReady })),
    submitShot: vi.fn(async (request) => createCommand(request, "submitted")),
  };
}

const gameInstanceId = "00000000-0000-4000-8000-000000000010";
const turnToken = "00000000-0000-4000-8000-000000000011";
const revision = `sha256:${"a".repeat(64)}`;

/** Creates an active local-human turn with v3 static and dynamic capabilities. */
function createAvailableState(overrides: Partial<GraphwarAgentAvailableState> = {}): GraphwarAgentAvailableState {
  return {
    apiVersion: 3,
    battleRevision: revision,
    canAcceptShotCommands: true,
    capabilities: createCapabilities(),
    currentPlayerId: 7,
    currentPlayerIndex: 0,
    equationMode: "y",
    gameInstanceId,
    isAvailable: true,
    isTerrainReversed: false,
    obstacleMask: {
      blockedValue: 1,
      emptyValue: 0,
      height: 450,
      isViewMirrored: false,
      revision,
      viewUrl: "/obstacle-masks/view.bin",
      width: 770,
      worldUrl: "/obstacle-masks/world.bin",
    },
    phase: "aiming",
    plane: { gameLength: 50, height: 450, width: 770 },
    players: [
      {
        currentSoldierIndex: 0,
        isComputerControlled: false,
        isConnected: true,
        isLocal: true,
        isReady: true,
        name: "Local",
        playerId: 7,
        playerIndex: 0,
        soldiers: [
          {
            angleRadians: 0,
            isAlive: true,
            isRendered: true,
            soldierIndex: 0,
            world: { pixel: createPixelPoint(100, 200) },
          },
        ],
        team: 1,
      },
    ],
    remainingTurnMs: 30_000,
    shotCommand: null,
    turnToken,
    ...overrides,
  };
}

/** Creates the unavailable branch while retaining static capabilities and plane metadata. */
function createUnavailableState(): GraphwarAgentState {
  return {
    apiVersion: 3,
    capabilities: createCapabilities(),
    isAvailable: false,
    plane: { gameLength: 50, height: 450, width: 770 },
    reason: "game-not-active",
  };
}

/** Creates all static managed-mode capabilities. */
function createCapabilities() {
  return {
    canReadRoom: true,
    canReadWorldObstacleMask: true,
    canSetReady: true,
    canSubmitShots: true,
  };
}

/** Creates an available room with one local player needing ready=true. */
function createAvailableRoom(): GraphwarAgentRoom {
  return {
    equationMode: "y",
    isAvailable: true,
    isLeader: false,
    players: [
      {
        isComputerControlled: false,
        isConnected: true,
        isLocal: true,
        isReady: false,
        name: "Local",
        numSoldiers: 2,
        playerId: 7,
        playerIndex: 0,
        team: 1,
      },
    ],
  };
}

/** Creates one stable request fixture used by command reads. */
function createRequest(): GraphwarAgentShotRequest {
  return {
    battleRevision: revision,
    function: "x",
    gameInstanceId,
    requestId: "00000000-0000-4000-8000-000000000001",
    turnToken,
  };
}

/** Creates a complete command resource for one request and public status. */
function createCommand(
  request: GraphwarAgentShotRequest,
  status: GraphwarAgentShotCommand["status"],
): GraphwarAgentShotCommand {
  const error =
    status === "failed"
      ? { canRetryWithNewRequestId: false, code: "shot-rejected", message: "rejected" }
      : status === "unknown"
        ? { code: "original-client-result-unknown", message: "unknown" }
        : undefined;
  return {
    battleRevision: request.battleRevision,
    createdAtEpochMs: 1,
    ...(error ? { error } : {}),
    gameInstanceId: request.gameInstanceId,
    requestId: request.requestId,
    status,
    turnToken: request.turnToken,
    updatedAtEpochMs: 2,
  };
}

/** Provides a command-shaped assertion value without retaining extra test state. */
function commandPlaceholder(request: GraphwarAgentShotRequest) {
  return createCommand(request, "claimed");
}

/** Keeps the late-result test's request-ID assertion readable. */
function commandRequestId(command: GraphwarAgentShotCommand) {
  return command.requestId;
}
