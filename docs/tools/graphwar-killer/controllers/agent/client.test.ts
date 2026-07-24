import { describe, expect, it, vi } from "vitest";

import { createPixelPoint } from "../../core/types";
import {
  createGraphwarAgentClient,
  createGraphwarAgentShotCommandError,
  createGraphwarAgentSnapshot,
  createGraphwarAgentShotRequest,
  GraphwarAgentClientError,
  parseGraphwarAgentShotCommand,
  parseGraphwarAgentState,
  parseGraphwarAgentWorldObstacleMask,
  readGraphwarAgentSnapshot,
  selectGraphwarAgentCurrentShooter,
  selectGraphwarAgentShooter,
  type GraphwarAgentAvailableState,
} from "./client";

const requestId = "00000000-0000-4000-8000-000000000001";

describe("Graphwar Agent API v3 client", () => {
  it("rejects non-HTTP Agent URLs before polling", () => {
    expect(() => createGraphwarAgentClient("ftp://127.0.0.1:17900")).toThrow("must use HTTP or HTTPS");
  });

  it.each(["token with space", "token,with-comma", "令牌", "\u007f"])(
    "rejects an Agent token outside the server's startup grammar: %j",
    (token) => {
      expect(() => createGraphwarAgentClient("http://127.0.0.1:17900", { token })).toThrow(GraphwarAgentClientError);
      try {
        createGraphwarAgentClient("http://127.0.0.1:17900", { token });
      } catch (error) {
        expect(error).toMatchObject({ kind: "invalid-request" });
      }
    },
  );

  it("rejects an Agent token longer than the bounded request-header contract", () => {
    expect(() => createGraphwarAgentClient("http://127.0.0.1:17900", { token: "x".repeat(4097) })).toThrow(
      "at most 4096",
    );
  });

  it("strictly parses v3 state, capabilities, booleans, and nullable identities", () => {
    const state = parseGraphwarAgentState(createStateResponse());

    expect(state).toMatchObject({
      apiVersion: 3,
      agentInstanceId: "00000000-0000-4000-8000-000000000001",
      battleRevision: revision,
      canAcceptShotCommands: true,
      capabilities: {
        canReadRoom: true,
        canReadWorldObstacleMask: true,
        canSetReady: true,
        canSubmitShots: true,
      },
      currentPlayerId: 7,
      currentPlayerIndex: 0,
      functionDraw: null,
      isAvailable: true,
      isTerrainReversed: true,
      observationSequence: 17,
      observedAtEpochMs: 1_735_689_600_000,
      shotCommand: null,
    });
    if (!state.isAvailable) {
      throw new Error("Expected an available state");
    }
    expect(state.players[0]).toMatchObject({ isConnected: true, isLocal: true, playerId: 7 });
    expect(state.players[0].soldiers[0]).toMatchObject({ isAlive: true, isRendered: true, soldierIndex: 0 });
    expect(
      parseGraphwarAgentState({
        ...createStateResponse(),
        currentPlayerId: null,
        currentPlayerIndex: null,
        turnToken: null,
      }),
    ).toMatchObject({ currentPlayerId: null, currentPlayerIndex: null, isAvailable: true, turnToken: null });
    expect(() =>
      parseGraphwarAgentState({
        ...createStateResponse(),
        shotCommand: { requestId, status: "claimed" },
        turnToken: null,
      }),
    ).toThrow("shotCommand/turnToken");
    expect(
      parseGraphwarAgentState({
        ...createStateResponse(),
        functionDraw: { currentStep: 1842, stepsPerSecond: 1500 },
        phase: "drawing",
      }),
    ).toMatchObject({ functionDraw: { currentStep: 1842, stepsPerSecond: 1500 }, phase: "drawing" });
    expect(() =>
      parseGraphwarAgentState({
        ...createStateResponse(),
        functionDraw: { currentStep: 1842, stepsPerSecond: 1500 },
      }),
    ).toThrow("phase/functionDraw");
  });

  it("rejects v2 aliases instead of silently adapting them", () => {
    expect(() => parseGraphwarAgentState({ ...createStateResponse(), apiVersion: 2 })).toThrow(
      "Unsupported Graphwar Agent API version",
    );
    expect(() =>
      parseGraphwarAgentState({ ...createStateResponse(), isAvailable: undefined, available: true }),
    ).toThrow("isAvailable");
    expect(() => parseGraphwarAgentState({ ...createStateResponse(), observedAtEpochMs: undefined })).toThrow(
      "observedAtEpochMs",
    );
    expect(() => parseGraphwarAgentState({ ...createStateResponse(), observedAtEpochMs: -1 })).toThrow(
      "observedAtEpochMs",
    );
    expect(() => parseGraphwarAgentState({ ...createStateResponse(), observedAtEpochMs: 1.5 })).toThrow(
      "observedAtEpochMs",
    );
    expect(() => parseGraphwarAgentState({ ...createStateResponse(), observationSequence: undefined })).toThrow(
      "observationSequence",
    );
    expect(() => parseGraphwarAgentState({ ...createStateResponse(), agentInstanceId: undefined })).toThrow(
      "agentInstanceId",
    );
    expect(() => parseGraphwarAgentState({ ...createStateResponse(), functionDraw: undefined })).toThrow(
      "functionDraw",
    );
    expect(() =>
      parseGraphwarAgentState({
        ...createStateResponse(),
        functionDraw: { currentStep: 1, stepsPerSecond: 0 },
        phase: "drawing",
      }),
    ).toThrow("functionDraw.stepsPerSecond");
  });

  it("rejects non-canonical v3 identities and battle revisions", () => {
    expect(() =>
      parseGraphwarAgentState({
        ...createStateResponse(),
        agentInstanceId: "00000000-0000-4000-8000-00000000000A",
      }),
    ).toThrow("agentInstanceId");
    expect(() =>
      parseGraphwarAgentState({ ...createStateResponse(), gameInstanceId: "00000000-0000-4000-8000-00000000000A" }),
    ).toThrow("gameInstanceId");
    expect(() => parseGraphwarAgentState({ ...createStateResponse(), turnToken: "turn" })).toThrow("turnToken");
    expect(() =>
      parseGraphwarAgentState({ ...createStateResponse(), battleRevision: `sha256:${"A".repeat(64)}` }),
    ).toThrow("battleRevision");
    expect(() => parseGraphwarAgentShotCommand({ ...createCommand("submitted"), requestId: "request" })).toThrow(
      "requestId",
    );
    expect(() =>
      parseGraphwarAgentState({
        ...createStateResponse(),
        obstacleMask: { ...createStateResponse().obstacleMask, worldUrl: "https://example.com/mask.bin" },
      }),
    ).toThrow("obstacleMask.worldUrl");
  });

  it("downloads the explicit world mask with If-Match and verifies ETag", async () => {
    const mask = new Uint8Array(770 * 450);
    mask[10] = 3;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(createStateResponse()))
      .mockResolvedValueOnce(new Response(mask, { headers: { ETag: `"${revision}"` } }));
    const client = createGraphwarAgentClient("http://127.0.0.1:17900", { fetch: fetchMock });
    const state = await client.readState();
    if (!state.isAvailable) {
      throw new Error("Expected an available state");
    }

    const normalized = await client.readWorldObstacleMask(state);

    expect(normalized[10]).toBe(1);
    expect(String(fetchMock.mock.calls[1][0])).toBe("http://127.0.0.1:17900/obstacle-masks/world.bin");
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("If-Match")).toBe(`"${revision}"`);
  });

  it("adapts TEAM2 points and mask cells while retaining ownership metadata", async () => {
    const mask = new Uint8Array(770 * 450);
    mask[0] = 1;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(createStateResponse()))
      .mockResolvedValueOnce(new Response(mask, { headers: { ETag: `"${revision}"` } }));

    const snapshot = await readGraphwarAgentSnapshot("http://127.0.0.1:17900", { fetch: fetchMock });
    if (!snapshot) {
      throw new Error("Expected a snapshot when no freshness hook rejects the state");
    }

    expect(snapshot.localCurrentTurnSoldierPoint).toEqual({ x: 70, y: 210 });
    expect(snapshot.detectionResult.soldiers[0]).toMatchObject({
      isComputerControlled: false,
      isFriendly: true,
      isLocal: true,
      playerId: 7,
      soldierIndex: 0,
      sourceCenterX: 70,
      team: 2,
    });
    expect(snapshot.detectionResult.obstacles.mask[769]).toBe(1);
  });

  it("reports parsed live state before waiting for the obstacle mask", async () => {
    let resolveMask!: (response: Response) => void;
    const maskResponse = new Promise<Response>((resolve) => {
      resolveMask = resolve;
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(createStateResponse()))
      .mockReturnValueOnce(maskResponse);
    const onStateRead = vi.fn();
    const snapshotPromise = readGraphwarAgentSnapshot("http://127.0.0.1:17900", { fetch: fetchMock, onStateRead });

    await vi.waitFor(() => expect(onStateRead).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolveMask(new Response(new Uint8Array(770 * 450), { headers: { ETag: `"${revision}"` } }));
    await snapshotPromise;
  });

  it("skips the obstacle mask when the live state is rejected as stale", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(createStateResponse()));

    await expect(
      readGraphwarAgentSnapshot("http://127.0.0.1:17900", { fetch: fetchMock, onStateRead: () => false }),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps current-only selection empty while manual reads predict the next local human", () => {
    const state = createParsedState("y");
    const local = state.players[0];
    const firstSoldier = local.soldiers[0];
    state.currentPlayerId = 6;
    state.currentPlayerIndex = 0;
    state.players = [
      { ...local, isLocal: false, name: "Remote", playerId: 6, playerIndex: 0 },
      {
        ...local,
        currentSoldierIndex: 0,
        playerId: 7,
        playerIndex: 1,
        soldiers: [firstSoldier, { ...firstSoldier, soldierIndex: 1 }],
      },
      { ...local, playerId: 8, playerIndex: 2 },
    ];

    expect(selectGraphwarAgentCurrentShooter(state)).toBeUndefined();
    expect(selectGraphwarAgentShooter(state)).toMatchObject({
      player: { playerId: 7 },
      soldier: { soldierIndex: 1 },
      isSpeculative: true,
    });
  });

  it("creates stable-ID shot payloads and applies optional bearer auth", async () => {
    const state = createParsedState("ddy");
    const request = createGraphwarAgentShotRequest(
      state,
      { angleRadians: 0.25, equationMode: "ddy", function: "1" },
      requestId,
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(createCommand("submitted")));
    const client = createGraphwarAgentClient("http://127.0.0.1:17900", { fetch: fetchMock, token: "secret" });

    await expect(client.submitShot(request)).resolves.toMatchObject({ requestId, status: "submitted" });

    expect(await requestJson(fetchMock.mock.calls[0][1])).toEqual({
      angleRadians: 0.25,
      battleRevision: revision,
      function: "1",
      gameInstanceId: gameInstanceId,
      requestId,
      turnToken,
    });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer secret");
  });

  it("rejects a shot response that belongs to another command identity", async () => {
    const state = createParsedState("y");
    const request = createGraphwarAgentShotRequest(state, { equationMode: "y", function: "1" }, requestId);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ ...createCommand("submitted"), turnToken: gameInstanceId }));

    await expect(
      createGraphwarAgentClient("http://127.0.0.1:17900", { fetch: fetchMock }).submitShot(request),
    ).rejects.toMatchObject({ kind: "incompatible" });
  });

  it("reads retained commands and enforces status-specific error fields", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(createCommand("unknown")));
    const command = await createGraphwarAgentClient("http://127.0.0.1:17900", { fetch: fetchMock }).readShotCommand(
      requestId,
    );

    expect(command).toMatchObject({ error: { code: "original-client-result-unknown" }, status: "unknown" });
    expect(String(fetchMock.mock.calls[0][0])).toBe(`http://127.0.0.1:17900/shots/${requestId}`);
    expect(() => parseGraphwarAgentShotCommand({ ...createCommand("failed"), error: undefined })).toThrow(
      "shot command.error",
    );
    expect(() =>
      parseGraphwarAgentShotCommand({
        ...createCommand("unknown"),
        error: { canRetryWithNewRequestId: false, code: "x", message: "x" },
      }),
    ).toThrow("canRetryWithNewRequestId");
    expect(createGraphwarAgentShotCommandError(createCommand("failed"))).toMatchObject({
      code: "shot-rejected",
      kind: "command",
    });
  });

  it("uses PUT JSON for idempotent ready state", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ equationMode: "y", isAvailable: true, isLeader: false, players: [createRoomPlayer()] }),
      )
      .mockResolvedValueOnce(jsonResponse({ isReady: true }));
    const client = createGraphwarAgentClient("http://127.0.0.1:17900", { fetch: fetchMock });

    await expect(client.readRoom()).resolves.toMatchObject({ isAvailable: true });
    await expect(client.submitReady(true)).resolves.toEqual({ isReady: true });
    expect(fetchMock.mock.calls[1][1]?.method).toBe("PUT");
    expect(await requestJson(fetchMock.mock.calls[1][1])).toEqual({ isReady: true });
  });

  it("retains stable structured error codes for recovery and presentation", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ error: { code: "shot-command-not-found", message: "human detail" } }, { status: 404 }),
      );

    await expect(
      createGraphwarAgentClient("http://127.0.0.1:17900", { fetch: fetchMock }).readShotCommand(requestId),
    ).rejects.toMatchObject({ code: "shot-command-not-found", kind: "conflict", status: 404 });
  });

  it.each([411, 431])("classifies HTTP %i as a deterministic invalid request", async (status) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: status === 411 ? "content-length-required" : "request-headers-too-large", message: "bad" } },
          { status },
        ),
      );

    await expect(
      createGraphwarAgentClient("http://127.0.0.1:17900", { fetch: fetchMock }).readState(),
    ).rejects.toMatchObject({ kind: "invalid-request", status });
  });

  it("preserves the authentication error code for an invalid Agent token", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "authentication-required", message: "A valid bearer token is required" } },
          { status: 401 },
        ),
      );

    await expect(
      createGraphwarAgentClient("http://127.0.0.1:17900", { fetch: fetchMock, token: "wrong" }).readState(),
    ).rejects.toMatchObject({ code: "authentication-required", kind: "invalid-request", status: 401 });
  });

  it.each([
    [400, "bad-request", "invalid-request"],
    [400, "invalid-ready-request", "invalid-request"],
    [400, "invalid-shot-request", "invalid-request"],
    [400, "invalid-request-id", "invalid-request"],
    [401, "authentication-required", "invalid-request"],
    [404, "route-not-found", "incompatible"],
    [404, "shot-command-not-found", "conflict"],
    [405, "method-not-allowed", "incompatible"],
    [409, "request-id-conflict", "conflict"],
    [409, "room-unavailable", "conflict"],
    [409, "obstacle-mask-unavailable", "conflict"],
    [411, "content-length-required", "invalid-request"],
    [412, "battle-revision-changed", "conflict"],
    [413, "request-body-too-large", "invalid-request"],
    [415, "unsupported-media-type", "invalid-request"],
    [428, "if-match-required", "conflict"],
    [431, "request-headers-too-large", "invalid-request"],
    [500, "internal-error", "transient"],
    [503, "server-busy", "transient"],
  ] as const)("classifies HTTP %i %s as %s", async (status, code, kind) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: { code, message: "raw detail" } }, { status }));

    await expect(
      createGraphwarAgentClient("http://127.0.0.1:17900", { fetch: fetchMock }).readState(),
    ).rejects.toMatchObject({ code, kind, status });
  });

  it("parses saved state and rejects mismatched obstacle sizes", () => {
    const state = createParsedState("y");
    const source = new Uint8Array(770 * 450);
    source[10] = 3;

    expect(createGraphwarAgentSnapshot("http://127.0.0.1:17900", state, source).state).toBe(state);
    expect(parseGraphwarAgentWorldObstacleMask(source.buffer, state)[10]).toBe(1);
    expect(() => parseGraphwarAgentWorldObstacleMask(new ArrayBuffer(1), state)).toThrow(
      "Unexpected obstacle data size",
    );
  });

  it("keeps malformed successful JSON classified as incompatible", async () => {
    await expect(
      createGraphwarAgentClient("http://127.0.0.1:17900", {
        fetch: vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response("{", { headers: { "Content-Type": "application/json" } })),
      }).readState(),
    ).rejects.toSatisfy((error: unknown) => error instanceof GraphwarAgentClientError && error.kind === "incompatible");
  });
});

const revision = `sha256:${"a".repeat(64)}`;
const gameInstanceId = "00000000-0000-4000-8000-000000000010";
const turnToken = "00000000-0000-4000-8000-000000000011";

/** Creates one complete v3 wire-state fixture with authoritative world ownership. */
function createStateResponse() {
  return {
    agentInstanceId: "00000000-0000-4000-8000-000000000001",
    apiVersion: 3 as const,
    battleRevision: revision,
    canAcceptShotCommands: true,
    capabilities: {
      canReadRoom: true,
      canReadWorldObstacleMask: true,
      canSetReady: true,
      canSubmitShots: true,
    },
    currentPlayerId: 7,
    currentPlayerIndex: 0,
    equationMode: "y" as const,
    functionDraw: null,
    gameInstanceId,
    isAvailable: true as const,
    isTerrainReversed: true,
    observationSequence: 17,
    observedAtEpochMs: 1_735_689_600_000,
    obstacleMask: {
      blockedValue: 1,
      emptyValue: 0,
      height: 450,
      isViewMirrored: true,
      revision,
      viewUrl: "/obstacle-masks/view.bin",
      width: 770,
      worldUrl: "/obstacle-masks/world.bin",
    },
    phase: "aiming" as const,
    plane: { gameLength: 50, height: 450, width: 770 },
    players: [createPlayer(7, 0, true, 2, 700), createPlayer(8, 1, false, 1, 100)],
    remainingTurnMs: 42_000,
    shotCommand: null,
    turnToken,
  };
}

/** Creates one player with one rendered live soldier. */
function createPlayer(playerId: number, playerIndex: number, isLocal: boolean, team: number, x: number) {
  return {
    currentSoldierIndex: 0,
    isComputerControlled: false,
    isConnected: true,
    isLocal,
    isReady: true,
    name: isLocal ? "Local" : "Remote",
    playerId,
    playerIndex,
    soldiers: [
      {
        angleRadians: 0,
        isAlive: true,
        isRendered: true,
        soldierIndex: 0,
        world: { pixel: createPixelPoint(x, 210) },
      },
    ],
    team,
  };
}

/** Creates a parsed state without routing the payload through a mock client. */
function createParsedState(equationMode: "y" | "dy" | "ddy"): GraphwarAgentAvailableState {
  return {
    ...parseGraphwarAgentState({ ...createStateResponse(), equationMode }),
    equationMode,
  } as GraphwarAgentAvailableState;
}

/** Creates one command resource in the requested public state. */
function createCommand(status: "validating" | "claimed" | "submitted" | "failed" | "unknown") {
  const error =
    status === "failed"
      ? { canRetryWithNewRequestId: false, code: "shot-rejected", message: "rejected" }
      : status === "unknown"
        ? { code: "original-client-result-unknown", message: "unknown" }
        : undefined;
  return {
    battleRevision: revision,
    createdAtEpochMs: 1,
    ...(error ? { error } : {}),
    gameInstanceId,
    requestId,
    status,
    turnToken,
    updatedAtEpochMs: 2,
  };
}

/** Creates one local-human room player fixture. */
function createRoomPlayer() {
  return {
    isComputerControlled: false,
    isConnected: true,
    isLocal: true,
    isReady: false,
    name: "Local",
    numSoldiers: 2,
    playerId: 7,
    playerIndex: 0,
    team: 1,
  };
}

/** Creates a JSON response with the same content type as the Agent. */
function jsonResponse(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

/** Reads a mocked request body as JSON. */
async function requestJson(init: RequestInit | undefined) {
  return JSON.parse(String(init?.body)) as unknown;
}
