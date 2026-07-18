import { afterEach, describe, expect, it, vi } from "vitest";

import { createPixelPoint } from "../../core/types";
import {
  GraphwarAgentClientError,
  type GraphwarAgentAvailableRoom,
  type GraphwarAgentAvailableState,
  type GraphwarAgentClient,
  type GraphwarAgentRoom,
  type GraphwarAgentState,
} from "../agent/client";
import {
  createGraphwarManagedController,
  createGraphwarManagedSkipTurnPlan,
  GRAPHWAR_MANAGED_SKIP_TURN_FUNCTION,
} from "./controller";

afterEach(() => {
  vi.useRealTimers();
});

describe("Graphwar managed-mode controller", () => {
  it.each([
    ["y", undefined],
    ["dy", undefined],
    ["ddy", 0],
  ] as const)("builds a valid %s skip-turn plan", (equationMode, angleRadians) => {
    const state = createAvailableState({ equationMode });

    expect(createGraphwarManagedSkipTurnPlan(state)).toEqual({
      ...(angleRadians === undefined ? {} : { angleRadians }),
      equationMode,
      function: GRAPHWAR_MANAGED_SKIP_TURN_FUNCTION,
    });
  });

  it("keeps polling single-flight and waits one interval after settlement", async () => {
    vi.useFakeTimers();
    const pending = createDeferred<GraphwarAgentState>();
    const state = createAvailableState({ remainingTurnMs: 40_000 });
    const client = createFakeClient();
    client.readState.mockImplementationOnce(() => pending.promise).mockResolvedValue(state);
    const controller = createGraphwarManagedController({ client });

    controller.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.readState).toHaveBeenCalledTimes(1);

    pending.resolve(state);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(999);
    expect(client.readState).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(client.readState).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it("aborts a hung poll and retries after the normal interval", async () => {
    vi.useFakeTimers();
    const client = createFakeClient();
    client.readState.mockImplementation(
      (signal) =>
        new Promise((_, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("timed out", "AbortError")), {
            once: true,
          });
        }),
    );
    const onTransientError = vi.fn();
    const controller = createGraphwarManagedController({
      client,
      hooks: { onTransientError },
      requestTimeoutMs: 50,
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(onTransientError).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(999);
    expect(client.readState).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(client.readState).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it("reuses the world mask until the battle revision changes", async () => {
    vi.useFakeTimers();
    const client = createFakeClient();
    client.readState
      .mockResolvedValueOnce(createAvailableState({ remainingTurnMs: 40_000 }))
      .mockResolvedValueOnce(createAvailableState({ remainingTurnMs: 39_000 }))
      .mockResolvedValue(createAvailableState({ battleRevision: "sha256:battle-2", remainingTurnMs: 38_000 }));
    const controller = createGraphwarManagedController({ client });

    controller.start();
    await flushPromises();
    expect(client.readWorldObstacleMask).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.readWorldObstacleMask).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.readWorldObstacleMask).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it("waits through remote, drawing, and exploding states for the current local-human turn", async () => {
    vi.useFakeTimers();
    const localPlayer = createAvailableState().players[0];
    if (!localPlayer) {
      throw new Error("Expected a local player fixture");
    }
    const players = [
      { ...localPlayer, id: 6, local: false, name: "Remote", team: 1 },
      { ...localPlayer, id: 7, index: 1, name: "Local", team: 2 },
    ];
    const client = createFakeClient();
    client.readState
      .mockResolvedValueOnce(createAvailableState({ currentTurn: 0, players, turnToken: "turn-remote" }))
      .mockResolvedValueOnce(
        createAvailableState({
          currentTurn: 1,
          drawingFunction: true,
          phase: "drawing",
          players,
          turnToken: "turn-local",
        }),
      )
      .mockResolvedValueOnce(
        createAvailableState({
          currentTurn: 1,
          exploding: true,
          phase: "exploding",
          players,
          turnToken: "turn-local",
        }),
      )
      .mockResolvedValue(createAvailableState({ currentTurn: 1, players, turnToken: "turn-local" }));
    const onState = vi.fn();
    const controller = createGraphwarManagedController({ client, hooks: { onState } });

    controller.start();
    await flushPromises();
    expect(onState).toHaveBeenCalledOnce();
    expect(onState.mock.calls[0]?.[1]).toBeUndefined();
    expect(client.readWorldObstacleMask).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(onState).toHaveBeenCalledTimes(2);
    expect(onState.mock.calls[1]?.[1]).toBeUndefined();
    expect(client.readWorldObstacleMask).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(onState).toHaveBeenCalledTimes(3);
    expect(onState.mock.calls[2]?.[1]).toBeUndefined();
    expect(client.readWorldObstacleMask).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(onState).toHaveBeenCalledTimes(4);
    expect(onState.mock.calls[3]?.[1]).toMatchObject({
      player: { id: 7, team: 2 },
      soldier: { index: 0 },
    });
    expect(client.readWorldObstacleMask).toHaveBeenCalledOnce();
    controller.stop();
  });

  it("invalidates a state response that arrives after lifecycle stop", async () => {
    const pending = createDeferred<GraphwarAgentState>();
    const client = createFakeClient();
    client.readState.mockReturnValue(pending.promise);
    const onState = vi.fn();
    const controller = createGraphwarManagedController({ client, hooks: { onState } });

    controller.start();
    controller.stop();
    pending.resolve(createAvailableState());
    await flushPromises();

    expect(onState).not.toHaveBeenCalled();
    expect(controller.isRunning()).toBe(false);
  });

  it("does not cache a world mask response that arrives after lifecycle stop", async () => {
    const pendingMask = createDeferred<Uint8Array>();
    const client = createFakeClient();
    client.readState.mockResolvedValue(createAvailableState({ remainingTurnMs: 40_000 }));
    client.readWorldObstacleMask
      .mockImplementationOnce(() => pendingMask.promise)
      .mockResolvedValue(new Uint8Array([0]));
    const controller = createGraphwarManagedController({ client });

    controller.start();
    await flushPromises();
    controller.stop();
    pendingMask.resolve(new Uint8Array([1]));
    await flushPromises();
    controller.start();
    await flushPromises();

    expect(client.readWorldObstacleMask).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it("rejects a pre-stop task after restart even when the game fingerprint is unchanged", async () => {
    const oldState = createAvailableState();
    const newState = createAvailableState();
    const client = createFakeClient();
    client.readState.mockResolvedValueOnce(oldState).mockResolvedValue(newState);
    const controller = createGraphwarManagedController({ client });

    controller.start();
    await flushPromises();
    controller.stop();
    controller.start();
    await flushPromises();

    expect(controller.submitShot(oldState, { equationMode: "y", function: "x" })).toBe(false);
    expect(client.submitShot).not.toHaveBeenCalled();
    controller.stop();
  });

  it("auto-readies when any connected local room player is unready", async () => {
    vi.useFakeTimers();
    const client = createFakeClient();
    client.readState.mockResolvedValue(createUnavailableState());
    client.readRoom
      .mockResolvedValueOnce(
        createAvailableRoom([
          createRoomPlayer({ computer: true, ready: true }),
          createRoomPlayer({ id: 8, index: 1, ready: true }),
        ]),
      )
      .mockResolvedValueOnce(
        createAvailableRoom([
          createRoomPlayer({ computer: true, ready: false }),
          createRoomPlayer({ id: 8, index: 1, ready: true }),
        ]),
      );
    const controller = createGraphwarManagedController({ client });

    controller.start();
    await flushPromises();
    expect(client.submitReady).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.submitReady).toHaveBeenCalledOnce();
    expect(client.submitReady).toHaveBeenCalledWith(true, expect.any(AbortSignal));
    controller.stop();
  });

  it("routes an inactive stale battlefield through room auto-ready", async () => {
    const client = createFakeClient();
    client.readState.mockResolvedValue(createAvailableState({ phase: "inactive", turnToken: undefined }));
    client.readRoom.mockResolvedValue(createAvailableRoom([createRoomPlayer({ ready: false })]));
    const controller = createGraphwarManagedController({ client });

    controller.start();
    await flushPromises();

    expect(client.readWorldObstacleMask).not.toHaveBeenCalled();
    expect(client.readRoom).toHaveBeenCalledOnce();
    expect(client.submitReady).toHaveBeenCalledOnce();
    controller.stop();
  });

  it("claims a deadline shot before awaiting and never retries an unknown result", async () => {
    vi.useFakeTimers();
    const state = createAvailableState({ remainingTurnMs: 3000 });
    const shot = createDeferred<{ ok: true }>();
    const submissionOrder: string[] = [];
    const client = createFakeClient();
    client.readState.mockResolvedValue(state);
    client.submitShot.mockImplementation(() => {
      submissionOrder.push("request");
      return shot.promise;
    });
    const plan = { equationMode: "y", function: "x" } as const;
    const onDeadline = vi.fn();
    const onShotFailed = vi.fn();
    const onShotSubmitted = vi.fn(() => submissionOrder.push("submitted"));
    const onShotSucceeded = vi.fn();
    const controller = createGraphwarManagedController({
      client,
      hooks: {
        decideDeadlineShot: () => plan,
        onDeadline,
        onShotFailed,
        onShotSubmitted,
        onShotSucceeded,
      },
    });

    controller.start();
    await flushPromises();
    expect(client.submitShot).toHaveBeenCalledOnce();
    expect(onDeadline).toHaveBeenCalledOnce();
    expect(onShotSubmitted).toHaveBeenCalledOnce();
    expect(onShotSucceeded).not.toHaveBeenCalled();
    expect(submissionOrder).toEqual(["submitted", "request"]);
    expect(controller.submitShot(state, plan)).toBe(false);

    shot.reject(new GraphwarAgentClientError("transient", "result unknown"));
    await flushPromises();
    expect(onShotFailed).toHaveBeenCalledOnce();
    expect(onShotSucceeded).not.toHaveBeenCalled();
    expect(controller.isRunning()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.submitShot).toHaveBeenCalledOnce();
    controller.stop();
  });

  it("abandons an invalid local plan without retrying it at the deadline", async () => {
    vi.useFakeTimers();
    const state = createAvailableState({ remainingTurnMs: 4000 });
    const client = createFakeClient();
    client.readState.mockResolvedValue(state);
    const onDeadlineWithoutShot = vi.fn();
    const onShotFailed = vi.fn();
    const controller = createGraphwarManagedController({
      client,
      hooks: { onDeadlineWithoutShot, onShotFailed },
    });

    controller.start();
    await flushPromises();
    const invalidPlan = { equationMode: "dy", function: "x" } as const;
    expect(controller.submitShot(state, invalidPlan)).toBe(false);
    expect(controller.submitShot(state, invalidPlan)).toBe(false);
    expect(onShotFailed).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1000);
    expect(onDeadlineWithoutShot).not.toHaveBeenCalled();
    expect(client.submitShot).not.toHaveBeenCalled();
    controller.stop();
  });

  it("fires the retained deadline plan even when the next poll hangs", async () => {
    vi.useFakeTimers();
    const client = createFakeClient();
    client.readState
      .mockResolvedValueOnce(createAvailableState({ remainingTurnMs: 4000 }))
      .mockImplementation(() => new Promise(() => void 0));
    const controller = createGraphwarManagedController({
      client,
      hooks: { decideDeadlineShot: () => ({ equationMode: "y", function: "x" }) },
    });

    controller.start();
    await flushPromises();
    expect(client.submitShot).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);

    expect(client.readState).toHaveBeenCalledTimes(2);
    expect(client.submitShot).toHaveBeenCalledOnce();
    controller.stop();
  });

  it("skips a deadline with no validated plan exactly once", async () => {
    vi.useFakeTimers();
    const state = createAvailableState({ remainingTurnMs: 2500 });
    const client = createFakeClient();
    client.readState.mockResolvedValue(state);
    const onDeadline = vi.fn();
    const onDeadlineWithoutShot = vi.fn();
    const controller = createGraphwarManagedController({
      client,
      hooks: { decideDeadlineShot: () => undefined, onDeadline, onDeadlineWithoutShot },
    });

    controller.start();
    await flushPromises();
    expect(client.submitShot).toHaveBeenCalledOnce();
    expect(client.submitShot).toHaveBeenCalledWith({
      battleRevision: state.battleRevision,
      function: GRAPHWAR_MANAGED_SKIP_TURN_FUNCTION,
      turnToken: state.turnToken,
    });
    expect(onDeadlineWithoutShot).not.toHaveBeenCalled();
    expect(onDeadline).toHaveBeenCalledOnce();
    expect(controller.submitShot(state, { equationMode: "y", function: "x" })).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onDeadlineWithoutShot).not.toHaveBeenCalled();
    expect(client.submitShot).toHaveBeenCalledOnce();
    controller.stop();
  });

  it("includes the required launch angle when skipping a y'' deadline", async () => {
    const state = createAvailableState({ equationMode: "ddy", remainingTurnMs: 2500 });
    const client = createFakeClient();
    client.readState.mockResolvedValue(state);
    const controller = createGraphwarManagedController({ client });

    controller.start();
    await flushPromises();

    expect(client.submitShot).toHaveBeenCalledWith({
      angleRadians: 0,
      battleRevision: state.battleRevision,
      function: GRAPHWAR_MANAGED_SKIP_TURN_FUNCTION,
      turnToken: state.turnToken,
    });
    controller.stop();
  });

  it.each([
    [3001, 0],
    [3000, 1],
    [1, 1],
    [0, 1],
  ])("applies the 3000ms deadline boundary at %ims", async (remainingTurnMs, expectedCalls) => {
    const client = createFakeClient();
    client.readState.mockResolvedValue(createAvailableState({ remainingTurnMs }));
    const onDeadlineWithoutShot = vi.fn();
    const controller = createGraphwarManagedController({
      client,
      hooks: { decideDeadlineShot: () => undefined, onDeadlineWithoutShot },
    });

    controller.start();
    await flushPromises();
    expect(client.submitShot).toHaveBeenCalledTimes(expectedCalls);
    expect(onDeadlineWithoutShot).not.toHaveBeenCalled();
    controller.stop();
  });

  it("stops on incompatibility but retries a transient poll on the next interval", async () => {
    vi.useFakeTimers();
    const incompatibleClient = createFakeClient();
    incompatibleClient.readState.mockRejectedValue(new GraphwarAgentClientError("incompatible", "upgrade"));
    const onIncompatibleError = vi.fn();
    const incompatibleController = createGraphwarManagedController({
      client: incompatibleClient,
      hooks: { onIncompatibleError },
    });

    incompatibleController.start();
    await flushPromises();
    expect(incompatibleController.isRunning()).toBe(false);
    expect(onIncompatibleError).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5000);
    expect(incompatibleClient.readState).toHaveBeenCalledOnce();

    const transientClient = createFakeClient();
    transientClient.readState
      .mockRejectedValueOnce(new GraphwarAgentClientError("transient", "offline"))
      .mockResolvedValue(createAvailableState({ remainingTurnMs: 40_000 }));
    const onTransientError = vi.fn();
    const transientController = createGraphwarManagedController({
      client: transientClient,
      hooks: { onTransientError },
    });
    transientController.start();
    await flushPromises();
    expect(onTransientError).toHaveBeenCalledOnce();
    expect(transientController.isRunning()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(transientClient.readState).toHaveBeenCalledTimes(2);
    transientController.stop();
  });

  it("rejects a completed plan after a newer battle revision is observed", async () => {
    vi.useFakeTimers();
    const oldState = createAvailableState({ battleRevision: "sha256:old", remainingTurnMs: 40_000 });
    const newState = createAvailableState({ battleRevision: "sha256:new", remainingTurnMs: 39_000 });
    const client = createFakeClient();
    client.readState.mockResolvedValueOnce(oldState).mockResolvedValue(newState);
    const controller = createGraphwarManagedController({ client });

    controller.start();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1000);

    expect(controller.submitShot(oldState, { equationMode: "y", function: "x" })).toBe(false);
    expect(client.submitShot).not.toHaveBeenCalled();
    controller.stop();
  });
});

type FakeGraphwarAgentClient = GraphwarAgentClient & {
  readRoom: ReturnType<typeof vi.fn<GraphwarAgentClient["readRoom"]>>;
  readState: ReturnType<typeof vi.fn<GraphwarAgentClient["readState"]>>;
  readWorldObstacleMask: ReturnType<typeof vi.fn<GraphwarAgentClient["readWorldObstacleMask"]>>;
  submitReady: ReturnType<typeof vi.fn<GraphwarAgentClient["submitReady"]>>;
  submitShot: ReturnType<typeof vi.fn<GraphwarAgentClient["submitShot"]>>;
};

/** Creates a fully mocked client with harmless polling defaults. */
function createFakeClient(): FakeGraphwarAgentClient {
  return {
    baseUrl: "http://127.0.0.1:17900",
    readRoom: vi.fn<GraphwarAgentClient["readRoom"]>().mockResolvedValue({ available: false, reason: "lobby" }),
    readState: vi.fn<GraphwarAgentClient["readState"]>().mockResolvedValue(createUnavailableState()),
    readWorldObstacleMask: vi.fn<GraphwarAgentClient["readWorldObstacleMask"]>().mockResolvedValue(new Uint8Array([0])),
    submitReady: vi.fn<GraphwarAgentClient["submitReady"]>().mockResolvedValue({ ok: true, requestedReady: true }),
    submitShot: vi.fn<GraphwarAgentClient["submitShot"]>().mockResolvedValue({ ok: true }),
  };
}

/** Creates one active local-human turn fixture. */
function createAvailableState(overrides: Partial<GraphwarAgentAvailableState> = {}): GraphwarAgentAvailableState {
  return {
    apiVersion: 2,
    available: true,
    battleRevision: "sha256:battle-1",
    capabilities: { ready: true, room: true, shot: true, worldObstacleMask: true },
    currentTurn: 0,
    drawingFunction: false,
    equationMode: "y",
    exploding: false,
    gameInstanceId: "game-1",
    gameMode: 0,
    gameState: 2,
    obstacleMask: {
      height: 450,
      revision: overrides.battleRevision ?? "sha256:battle-1",
      revisionHeader: "X-Graphwar-Battle-Revision",
      width: 770,
      worldUrl: "/obstacle-mask.bin?space=world",
    },
    phase: "aiming",
    plane: { gameLength: 50, height: 450, width: 770 },
    players: [
      {
        computer: false,
        currentTurnSoldier: 0,
        disconnected: false,
        id: 7,
        index: 0,
        local: true,
        name: "Local",
        ready: true,
        soldiers: [
          {
            alive: true,
            angle: 0,
            exploding: false,
            index: 0,
            world: { pixel: createPixelPoint(100, 200) },
          },
        ],
        team: 1,
      },
    ],
    remainingTurnMs: 40_000,
    turnToken: "turn-1",
    ...overrides,
  };
}

/** Creates a versioned state response for a lobby or pre-game room. */
function createUnavailableState(): GraphwarAgentState {
  return {
    apiVersion: 2,
    available: false,
    capabilities: { ready: true, room: true, shot: true, worldObstacleMask: true },
    plane: { gameLength: 50, height: 450, width: 770 },
    reason: "game-not-started",
  };
}

/** Creates one available room with caller-selected player states. */
function createAvailableRoom(players: GraphwarAgentAvailableRoom["players"]): GraphwarAgentRoom {
  return { available: true, gameMode: 0, gameState: 1, leader: false, players };
}

/** Creates one local room player fixture. */
function createRoomPlayer(overrides: Partial<GraphwarAgentAvailableRoom["players"][number]> = {}) {
  return {
    computer: false,
    disconnected: false,
    id: 7,
    index: 0,
    local: true,
    name: "Local",
    numSoldiers: 2,
    ready: false,
    team: 1,
    ...overrides,
  };
}

/** Creates a manually settled Promise for overlap and stale-response tests. */
function createDeferred<TValue>() {
  let resolve!: (value: TValue) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<TValue>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

/** Flushes the short Promise chains used by controller callbacks. */
async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
