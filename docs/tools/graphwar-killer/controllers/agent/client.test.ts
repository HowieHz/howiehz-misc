import { describe, expect, it, vi } from "vitest";

import { createPixelPoint } from "../../core/types";
import {
  createGraphwarAgentClient,
  createGraphwarAgentShotRequest,
  GraphwarAgentClientError,
  readGraphwarAgentSnapshot,
  selectGraphwarAgentCurrentShooter,
  selectGraphwarAgentShooter,
  type GraphwarAgentAvailableState,
} from "./client";

describe("Graphwar Agent API v2 client", () => {
  it("rejects non-HTTP Agent URLs before polling", () => {
    expect(() => createGraphwarAgentClient("ftp://127.0.0.1:17900")).toThrow("must use HTTP or HTTPS");
  });

  it("parses capabilities, opaque revisions, ownership, and world coordinates", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(createStateResponse()));
    const state = await createGraphwarAgentClient("127.0.0.1:17900", { fetch: fetchMock }).readState();

    expect(state).toMatchObject({
      apiVersion: 2,
      available: true,
      battleRevision: "sha256:battle-1",
      capabilities: { ready: true, room: true, shot: true, worldObstacleMask: true },
      gameInstanceId: "game-1",
      remainingTurnMs: 42_000,
      turnToken: "turn-1",
    });
    if (!state.available) {
      throw new Error("Expected an available state");
    }
    expect(state.players[0]).toMatchObject({ id: 7, local: true, team: 2 });
    expect(state.players[0].soldiers[0].world.pixel).toEqual({ x: 700, y: 210 });
  });

  it("accepts only a world mask carrying the snapshot revision", async () => {
    const stateResponse = createStateResponse();
    const mask = new Uint8Array(770 * 450);
    mask[10] = 3;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(stateResponse))
      .mockResolvedValueOnce(new Response(mask, { headers: { "X-Graphwar-Battle-Revision": "sha256:battle-1" } }));
    const client = createGraphwarAgentClient("http://127.0.0.1:17900", { fetch: fetchMock });
    const state = await client.readState();
    if (!state.available) {
      throw new Error("Expected an available state");
    }

    const normalized = await client.readWorldObstacleMask(state);

    expect(normalized[10]).toBe(1);
    expect(String(fetchMock.mock.calls[1][0])).toBe("http://127.0.0.1:17900/obstacle-mask.bin?space=world");
  });

  it("adapts TEAM2 points and mask cells while retaining ownership metadata", async () => {
    const mask = new Uint8Array(770 * 450);
    mask[0] = 1;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(createStateResponse()))
      .mockResolvedValueOnce(new Response(mask, { headers: { "X-Graphwar-Battle-Revision": "sha256:battle-1" } }));

    const snapshot = await readGraphwarAgentSnapshot("http://127.0.0.1:17900", { fetch: fetchMock });

    expect(snapshot.localCurrentTurnSoldierPoint).toEqual({ x: 70, y: 210 });
    expect(snapshot.detectionResult.soldiers[0]).toMatchObject({
      computer: false,
      friendly: true,
      local: true,
      playerId: 7,
      playerIndex: 0,
      soldierIndex: 0,
      sourceCenterX: 70,
      team: 2,
    });
    expect(snapshot.detectionResult.soldiers[1]).toMatchObject({ friendly: false, team: 1 });
    expect(snapshot.detectionResult.obstacles.mask[769]).toBe(1);
    expect(snapshot.worldObstacleMask[0]).toBe(1);
  });

  it("keeps current-only selection empty while manual reads predict the next local human", () => {
    const state = createParsedState("y");
    const local = state.players[0];
    const firstSoldier = local.soldiers[0];
    state.currentTurn = 0;
    state.players = [
      { ...local, id: 6, index: 0, local: false, name: "Remote" },
      {
        ...local,
        currentTurnSoldier: 0,
        id: 7,
        index: 1,
        soldiers: [firstSoldier, { ...firstSoldier, index: 1 }],
      },
      { ...local, id: 8, index: 2 },
    ];

    expect(selectGraphwarAgentCurrentShooter(state)).toBeUndefined();
    expect(selectGraphwarAgentShooter(state)).toMatchObject({
      player: { id: 7 },
      soldier: { index: 1 },
      speculative: true,
    });
  });

  it("rejects a stale inactive battlefield before downloading its mask", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        ...createStateResponse(),
        gameState: 1,
        phase: "inactive",
        remainingTurnMs: 0,
        turnToken: null,
      }),
    );

    await expect(readGraphwarAgentSnapshot("http://127.0.0.1:17900", { fetch: fetchMock })).rejects.toMatchObject({
      kind: "unavailable",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects a state/mask race without retrying the download", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(createStateResponse()))
      .mockResolvedValueOnce(
        new Response(new Uint8Array(770 * 450), {
          headers: { "X-Graphwar-Battle-Revision": "sha256:battle-2" },
        }),
      );
    const client = createGraphwarAgentClient("http://127.0.0.1:17900", { fetch: fetchMock });
    const state = await client.readState();
    if (!state.available) {
      throw new Error("Expected an available state");
    }

    await expect(client.readWorldObstacleMask(state)).rejects.toMatchObject({ kind: "conflict" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("builds mode-specific shot payloads and sends one JSON request", async () => {
    const yState = createParsedState("y");
    expect(createGraphwarAgentShotRequest(yState, { equationMode: "y", function: "x" })).toEqual({
      battleRevision: "sha256:battle-1",
      function: "x",
      turnToken: "turn-1",
    });
    expect(
      createGraphwarAgentShotRequest(createParsedState("ddy"), {
        angleRadians: 0.25,
        equationMode: "ddy",
        function: "1",
      }),
    ).toEqual({
      angleRadians: 0.25,
      battleRevision: "sha256:battle-1",
      function: "1",
      turnToken: "turn-1",
    });

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }));
    const client = createGraphwarAgentClient("http://127.0.0.1:17900", { fetch: fetchMock });
    await client.submitShot(createGraphwarAgentShotRequest(yState, { equationMode: "y", function: "x" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await requestJson(fetchMock.mock.calls[0][1])).toEqual({
      battleRevision: "sha256:battle-1",
      function: "x",
      turnToken: "turn-1",
    });
  });

  it("does not retry a failed shot", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("failed", { status: 500 }));
    const client = createGraphwarAgentClient("http://127.0.0.1:17900", { fetch: fetchMock });

    await expect(
      client.submitShot(createGraphwarAgentShotRequest(createParsedState("y"), { equationMode: "y", function: "x" })),
    ).rejects.toMatchObject({ kind: "transient" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads rooms and sends strict ready text", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          available: true,
          gameMode: 0,
          gameState: 1,
          leader: false,
          players: [createRoomPlayer()],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, requestedReady: true }));
    const client = createGraphwarAgentClient("http://127.0.0.1:17900", { fetch: fetchMock });

    await expect(client.readRoom()).resolves.toMatchObject({ available: true });
    await expect(client.submitReady(true)).resolves.toEqual({ ok: true, requestedReady: true });
    expect(fetchMock.mock.calls[1][1]?.body).toBe("true");
  });

  it("classifies an old or malformed contract as incompatible", async () => {
    const response = { ...createStateResponse(), apiVersion: 1 };
    const client = createGraphwarAgentClient("http://127.0.0.1:17900", {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(response)),
    });

    await expect(client.readState()).rejects.toSatisfy(
      (error: unknown) => error instanceof GraphwarAgentClientError && error.kind === "incompatible",
    );
  });
});

/** Creates one complete wire-state fixture with authoritative world ownership. */
function createStateResponse() {
  return {
    apiVersion: 2 as const,
    available: true as const,
    battleRevision: "sha256:battle-1",
    capabilities: { ready: true, room: true, shot: true, worldObstacleMask: true },
    currentTurn: 0,
    drawingFunction: false,
    exploding: false,
    gameInstanceId: "game-1",
    gameMode: 0 as const,
    gameState: 2,
    obstacleMask: {
      height: 450,
      revision: "sha256:battle-1",
      revisionHeader: "X-Graphwar-Battle-Revision",
      width: 770,
      worldUrl: "/obstacle-mask.bin?space=world",
    },
    phase: "aiming" as const,
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
            world: { pixel: createPixelPoint(700, 210) },
          },
        ],
        team: 2,
      },
      {
        computer: false,
        currentTurnSoldier: 0,
        disconnected: false,
        id: 8,
        index: 1,
        local: false,
        name: "Remote",
        ready: true,
        soldiers: [
          {
            alive: true,
            angle: 0,
            exploding: false,
            index: 0,
            world: { pixel: createPixelPoint(100, 210) },
          },
        ],
        team: 1,
      },
    ],
    remainingTurnMs: 42_000,
    turnToken: "turn-1",
  };
}

/** Creates a parsed state without routing the payload through a second mock client. */
function createParsedState(equationMode: "y" | "dy" | "ddy"): GraphwarAgentAvailableState {
  const gameMode = equationMode === "y" ? 0 : equationMode === "dy" ? 1 : 2;
  return {
    ...createStateResponse(),
    equationMode,
    gameMode,
  };
}

/** Creates one local-human room player fixture. */
function createRoomPlayer() {
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
  };
}

/** Creates a JSON response with the same content type as the Agent. */
function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
}

/** Reads a mocked request body as JSON. */
async function requestJson(init: RequestInit | undefined) {
  return JSON.parse(String(init?.body)) as unknown;
}
