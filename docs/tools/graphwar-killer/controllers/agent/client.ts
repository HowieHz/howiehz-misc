import {
  GRAPHWAR_PLANE_HEIGHT,
  GRAPHWAR_PLANE_LENGTH,
  GRAPHWAR_SOLDIER_RADIUS,
  GRAPHWAR_SOLDIER_VISIBLE_SIZE,
} from "../../core/game/constants";
import { createPixelPoint, type BoundsRect, type EquationMode, type PixelPoint } from "../../core/types";
import {
  countObstacleMaskComponents,
  type GraphwarDetectionBox,
  type GraphwarObjectsDetectionResult,
} from "../../detection/objects";

export const GRAPHWAR_AGENT_API_VERSION = 2;
export const GRAPHWAR_AGENT_DEFAULT_BASE_URL = "http://127.0.0.1:17900";
export const GRAPHWAR_AGENT_BATTLE_REVISION_HEADER = "X-Graphwar-Battle-Revision";

/** Agent feature flags checked before the page enables dependent workflows. */
export interface GraphwarAgentCapabilities {
  ready: boolean;
  room: boolean;
  shot: boolean;
  worldObstacleMask: boolean;
}

/** Fixed Graphwar plane dimensions reported by the Agent. */
export interface GraphwarAgentPlane {
  gameLength: number;
  height: number;
  width: number;
}

/** A point in the Agent's authoritative, unmirrored world coordinates. */
export interface GraphwarAgentWorldPoint {
  pixel: PixelPoint;
}

/** Authoritative soldier state before adapting it to the local shooter's view. */
export interface GraphwarAgentSoldier {
  alive: boolean;
  angle: number;
  exploding: boolean;
  index: number;
  world: GraphwarAgentWorldPoint;
}

/** One player and its soldiers in an Agent polling response. */
export interface GraphwarAgentPlayer {
  computer: boolean;
  currentTurnSoldier: number;
  disconnected: boolean;
  id: number;
  index: number;
  local: boolean;
  name: string;
  ready?: boolean;
  soldiers: GraphwarAgentSoldier[];
  team: number;
}

/** Player and soldier selected by the Agent's current-turn indexes. */
export interface GraphwarAgentCurrentShooter {
  player: GraphwarAgentPlayer;
  soldier: GraphwarAgentSoldier;
}

/** Local human shooter selected for managed play and view adaptation. */
export interface GraphwarAgentShooter extends GraphwarAgentCurrentShooter {
  speculative: boolean;
}

/** Agent soldier adapted to the detection-box interface used by page workflows. */
export interface GraphwarAgentDetectionBox extends GraphwarDetectionBox {
  /** Authoritative local-computer ownership, independent of screen position. */
  computer: boolean;
  /** Authoritative relation to the selected shooter's team, independent of screen position. */
  friendly: boolean;
  /** Authoritative local-client ownership, independent of screen position. */
  local: boolean;
  /** Stable Graphwar protocol player id. */
  playerId: number;
  /** Current player-array index in the state snapshot. */
  playerIndex: number;
  /** Stable soldier-array index within its player. */
  soldierIndex: number;
  /** Authoritative Graphwar team id. */
  team: number;
}

/** Detection-compatible scene assembled from authoritative Agent state. */
export interface GraphwarAgentDetectionResult extends Omit<GraphwarObjectsDetectionResult, "soldiers"> {
  soldiers: GraphwarAgentDetectionBox[];
}

/** Metadata required to fetch and verify the matching world obstacle mask. */
export interface GraphwarAgentObstacleMaskMetadata {
  height: number;
  revision: string;
  revisionHeader: string;
  width: number;
  worldUrl: string;
}

export type GraphwarAgentPhase = "aiming" | "drawing" | "exploding" | "inactive";

/** Fields shared by available and unavailable Agent polling responses. */
interface GraphwarAgentStateBase {
  apiVersion: typeof GRAPHWAR_AGENT_API_VERSION;
  available: boolean;
  capabilities: GraphwarAgentCapabilities;
  plane: GraphwarAgentPlane;
}

/** Stable unavailable response returned outside an active match. */
export interface GraphwarAgentUnavailableState extends GraphwarAgentStateBase {
  available: false;
  reason: string;
}

/** Authoritative active-match snapshot with a battle revision and optional firing token. */
export interface GraphwarAgentAvailableState extends GraphwarAgentStateBase {
  available: true;
  battleRevision: string;
  currentTurn: number;
  drawingFunction: boolean;
  equationMode: EquationMode;
  exploding: boolean;
  gameInstanceId: string;
  gameMode: 0 | 1 | 2;
  gameState: number;
  obstacleMask: GraphwarAgentObstacleMaskMetadata;
  phase: GraphwarAgentPhase;
  players: GraphwarAgentPlayer[];
  remainingTurnMs: number;
  turnToken?: string;
}

export type GraphwarAgentState = GraphwarAgentAvailableState | GraphwarAgentUnavailableState;

/** One pre-game room participant; remote computer ownership may be unknown. */
export interface GraphwarAgentRoomPlayer {
  computer: boolean | null;
  disconnected: boolean;
  id: number;
  index: number;
  local: boolean;
  name: string;
  numSoldiers: number;
  ready: boolean;
  team: number;
}

/** Available pre-game room snapshot. */
export interface GraphwarAgentAvailableRoom {
  available: true;
  gameMode: number;
  gameState: number;
  leader: boolean;
  players: GraphwarAgentRoomPlayer[];
}

/** Stable response used when the client is not in a pre-game room. */
export interface GraphwarAgentUnavailableRoom {
  available: false;
  reason: string;
}

export type GraphwarAgentRoom = GraphwarAgentAvailableRoom | GraphwarAgentUnavailableRoom;

/** Acknowledgement that the requested ready command was submitted. */
export interface GraphwarAgentReadyResult {
  ok: true;
  requestedReady: boolean;
}

/** Shot command guarded by the state snapshot's token and revision. */
export interface GraphwarAgentShotRequest {
  angleRadians?: number;
  battleRevision: string;
  function: string;
  turnToken: string;
}

/** Acknowledgement that the guarded shot command was accepted. */
export interface GraphwarAgentShotResult {
  ok: true;
}

export type GraphwarAgentShotPlan =
  | {
      equationMode: "y" | "dy";
      function: string;
    }
  | {
      angleRadians: number;
      equationMode: "ddy";
      function: string;
    };

/** Page-ready scene in a selected local shooter's view, or a deterministic fallback view. */
export interface GraphwarAgentSnapshot {
  /** Normalized base URL used for subsequent reads. */
  baseUrl: string;
  /** Fixed 770x450 canvas bounds used for direct Agent state. */
  boundsRect: BoundsRect;
  /** Compatibility adapter in the same selected or fallback view. */
  detectionResult: GraphwarAgentDetectionResult;
  /** Current game mode mapped from Graphwar constants. */
  equationMode: EquationMode;
  /** Synthetic image name shown in the screenshot panel. */
  imageName: string;
  /** Transparent 770x450 canvas; all real data is rendered through overlays. */
  imageUrl: string;
  /** Current local firing soldier in shooter-view pixels, when it is this client's turn. */
  localCurrentTurnSoldierPoint?: PixelPoint;
  /** Local-human shooter whose team defines the adapted view. */
  shooter?: GraphwarAgentShooter;
  /** Parsed authoritative Agent state. */
  state: GraphwarAgentAvailableState;
  /** Obstacle pixels in Graphwar's authoritative world orientation. */
  worldObstacleMask: Uint8Array;
}

export type GraphwarAgentWorldSnapshot = Omit<
  GraphwarAgentSnapshot,
  "detectionResult" | "localCurrentTurnSoldierPoint" | "shooter"
>;

export type GraphwarAgentClientErrorKind =
  | "conflict"
  | "incompatible"
  | "invalid-request"
  | "transient"
  | "unavailable";

/** Typed failure used to separate retryable transport failures from protocol incompatibility. */
export class GraphwarAgentClientError extends Error {
  readonly kind: GraphwarAgentClientErrorKind;
  readonly status?: number;

  /** Captures one normalized Agent failure without losing its original cause. */
  constructor(kind: GraphwarAgentClientErrorKind, message: string, status?: number, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GraphwarAgentClientError";
    this.kind = kind;
    this.status = status;
  }
}

/** Browser interface to one normalized localhost Agent endpoint. */
export interface GraphwarAgentClient {
  readonly baseUrl: string;
  readRoom: (signal?: AbortSignal) => Promise<GraphwarAgentRoom>;
  readState: (signal?: AbortSignal) => Promise<GraphwarAgentState>;
  readWorldObstacleMask: (state: GraphwarAgentAvailableState, signal?: AbortSignal) => Promise<Uint8Array>;
  submitReady: (ready: boolean, signal?: AbortSignal) => Promise<GraphwarAgentReadyResult>;
  submitShot: (request: GraphwarAgentShotRequest) => Promise<GraphwarAgentShotResult>;
}

/** Injectable transport used by tests and browsers without global fetch. */
export interface GraphwarAgentClientOptions {
  fetch?: typeof globalThis.fetch;
}

/** Creates a client bound to one normalized local Agent address. */
export function createGraphwarAgentClient(
  baseUrlText: string,
  options: GraphwarAgentClientOptions = {},
): GraphwarAgentClient {
  const baseUrl = normalizeGraphwarAgentBaseUrl(baseUrlText);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (!fetchImplementation) {
    throw new GraphwarAgentClientError("transient", "Fetch is unavailable in this browser");
  }

  return {
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    readRoom: (signal) => readGraphwarAgentRoomResponse(fetchImplementation, baseUrl, signal),
    readState: (signal) => readGraphwarAgentStateResponse(fetchImplementation, baseUrl, signal),
    readWorldObstacleMask: (state, signal) =>
      readGraphwarAgentWorldObstacleMaskResponse(fetchImplementation, baseUrl, state, signal),
    submitReady: (ready, signal) => submitGraphwarAgentReadyResponse(fetchImplementation, baseUrl, ready, signal),
    // A shot is deliberately not coupled to a polling AbortSignal: once submitted, its
    // result may be unknown, but it must never be retried by this client.
    submitShot: (request) => submitGraphwarAgentShotResponse(fetchImplementation, baseUrl, request),
  };
}

/** Reads and adapts one complete authoritative Agent snapshot for the existing page workflow. */
export async function readGraphwarAgentSnapshot(
  baseUrlText: string,
  options: GraphwarAgentClientOptions = {},
): Promise<GraphwarAgentSnapshot> {
  const client = createGraphwarAgentClient(baseUrlText, options);
  const state = await client.readState();
  if (!state.available || state.phase === "inactive") {
    throw new GraphwarAgentClientError("unavailable", state.available ? "game-not-active" : state.reason);
  }

  const worldObstacleMask = await client.readWorldObstacleMask(state);
  return createGraphwarAgentSnapshot(client.baseUrl, state, worldObstacleMask);
}

/** Adapts already parsed state and world-mask data through the same path as a live Agent read. */
export function createGraphwarAgentSnapshot(
  baseUrl: string,
  state: GraphwarAgentAvailableState,
  worldObstacleMask: Uint8Array,
): GraphwarAgentSnapshot {
  const worldSnapshot = createGraphwarAgentWorldSnapshot(baseUrl, state, worldObstacleMask);
  const shooter = selectGraphwarAgentShooter(state);
  if (shooter) {
    return createGraphwarAgentShooterViewSnapshot(worldSnapshot, shooter.player.id, shooter.soldier.index);
  }
  return { ...worldSnapshot, detectionResult: createGraphwarAgentDetectionResult(state, worldObstacleMask, 1) };
}

/** Packages one revision-bound world snapshot before selecting a local shooter view. */
export function createGraphwarAgentWorldSnapshot(
  baseUrl: string,
  state: GraphwarAgentAvailableState,
  worldObstacleMask: Uint8Array,
): GraphwarAgentWorldSnapshot {
  return {
    baseUrl,
    // Agent coordinates always cover the complete native 770x450 canvas.
    boundsRect: { height: GRAPHWAR_PLANE_HEIGHT, width: GRAPHWAR_PLANE_LENGTH, x: 0, y: 0 },
    equationMode: state.equationMode,
    imageName: "Graphwar Agent",
    imageUrl: createGraphwarAgentCanvasDataUrl(),
    state,
    worldObstacleMask,
  };
}

/** Builds one complete shooter-oriented view from authoritative world data. */
export function createGraphwarAgentShooterViewSnapshot(
  snapshot: GraphwarAgentWorldSnapshot,
  playerId: number,
  soldierIndex: number,
): GraphwarAgentSnapshot {
  const player = snapshot.state.players.find((candidate) => candidate.id === playerId);
  const soldier = player?.soldiers.find((candidate) => candidate.index === soldierIndex);
  if (!player || !soldier?.alive) {
    throw new GraphwarAgentClientError("conflict", "The selected Graphwar shooter is unavailable");
  }

  const selected = selectGraphwarAgentShooter(snapshot.state);
  const shooter = {
    player,
    soldier,
    speculative: selected?.player.id !== playerId || selected.soldier.index !== soldierIndex || selected.speculative,
  };
  return {
    ...snapshot,
    detectionResult: createGraphwarAgentDetectionResult(snapshot.state, snapshot.worldObstacleMask, player.team),
    localCurrentTurnSoldierPoint: shooter.speculative
      ? undefined
      : worldPointToShooterView(soldier.world.pixel, player.team),
    shooter,
  };
}

/** Chooses the active local-human shooter without predicting a future turn. */
export function selectGraphwarAgentCurrentShooter(
  state: GraphwarAgentAvailableState,
): GraphwarAgentCurrentShooter | undefined {
  const currentPlayer = state.players[state.currentTurn];
  if (state.phase !== "aiming" || !isGraphwarAgentLocalHuman(currentPlayer)) {
    return undefined;
  }
  const soldier = currentPlayer.soldiers[currentPlayer.currentTurnSoldier];
  return soldier?.alive ? { player: currentPlayer, soldier } : undefined;
}

/** Chooses the active local human or predicts the next one for a manual state read. */
export function selectGraphwarAgentShooter(state: GraphwarAgentAvailableState): GraphwarAgentShooter | undefined {
  const currentShooter = selectGraphwarAgentCurrentShooter(state);
  if (currentShooter) {
    return { ...currentShooter, speculative: false };
  }

  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const player = state.players[(state.currentTurn + offset) % state.players.length];
    if (!isGraphwarAgentLocalHuman(player)) {
      continue;
    }
    for (let soldierOffset = 1; soldierOffset <= player.soldiers.length; soldierOffset += 1) {
      const index = (player.currentTurnSoldier + soldierOffset + player.soldiers.length) % player.soldiers.length;
      const soldier = player.soldiers[index];
      if (soldier?.alive) {
        return { player, soldier, speculative: true };
      }
    }
  }
  return undefined;
}

/** Builds the exact mode-specific payload accepted by Agent API v2. */
export function createGraphwarAgentShotRequest(
  state: GraphwarAgentAvailableState,
  plan: GraphwarAgentShotPlan,
): GraphwarAgentShotRequest {
  if (state.phase !== "aiming" || state.drawingFunction || state.exploding || !state.turnToken) {
    throw new GraphwarAgentClientError("conflict", "Graphwar is not accepting a shot for this snapshot");
  }
  if (plan.equationMode !== state.equationMode) {
    throw new GraphwarAgentClientError("conflict", "The shot plan does not match the current game mode");
  }
  if (!plan.function.trim()) {
    throw new GraphwarAgentClientError("invalid-request", "Graphwar function is empty");
  }
  if (plan.equationMode === "ddy") {
    if (!Number.isFinite(plan.angleRadians) || Math.abs(plan.angleRadians) > Math.PI / 2) {
      throw new GraphwarAgentClientError("invalid-request", "Graphwar shot angle is outside the supported range");
    }
    return {
      angleRadians: plan.angleRadians,
      battleRevision: state.battleRevision,
      function: plan.function,
      turnToken: state.turnToken,
    };
  }
  return {
    battleRevision: state.battleRevision,
    function: plan.function,
    turnToken: state.turnToken,
  };
}

/** Reports whether the Agent advertises every capability required by managed mode. */
export function supportsGraphwarManagedMode(capabilities: GraphwarAgentCapabilities) {
  return capabilities.ready && capabilities.room && capabilities.shot && capabilities.worldObstacleMask;
}

/** Identifies a malformed or unsupported Agent contract that should stop managed mode. */
export function isGraphwarAgentIncompatibleError(
  error: unknown,
): error is GraphwarAgentClientError & { readonly kind: "incompatible" } {
  return error instanceof GraphwarAgentClientError && error.kind === "incompatible";
}

/** Normalizes user input once so every endpoint resolves against the same base URL. */
export function normalizeGraphwarAgentBaseUrl(baseUrlText: string) {
  const trimmed = baseUrlText.trim() || GRAPHWAR_AGENT_DEFAULT_BASE_URL;
  const url = new URL(/^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new GraphwarAgentClientError("invalid-request", "Graphwar Agent URL must use HTTP or HTTPS");
  }
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }
  return url;
}

/** Fetches and strictly parses the versioned match-state endpoint. */
async function readGraphwarAgentStateResponse(
  fetchImplementation: typeof globalThis.fetch,
  baseUrl: URL,
  signal?: AbortSignal,
) {
  const response = await requestGraphwarAgent(fetchImplementation, new URL("state", baseUrl), { signal });
  return parseGraphwarAgentState(await readGraphwarAgentJson(response, "/state"));
}

/** Fetches and parses the polling-friendly pre-game room endpoint. */
async function readGraphwarAgentRoomResponse(
  fetchImplementation: typeof globalThis.fetch,
  baseUrl: URL,
  signal?: AbortSignal,
) {
  const response = await requestGraphwarAgent(fetchImplementation, new URL("room", baseUrl), { signal });
  return parseGraphwarAgentRoom(await readGraphwarAgentJson(response, "/room"));
}

/** Downloads a world mask and rejects a state/mask revision race. */
async function readGraphwarAgentWorldObstacleMaskResponse(
  fetchImplementation: typeof globalThis.fetch,
  baseUrl: URL,
  state: GraphwarAgentAvailableState,
  signal?: AbortSignal,
) {
  const response = await requestGraphwarAgent(fetchImplementation, new URL(state.obstacleMask.worldUrl, baseUrl), {
    signal,
  });
  const revision = response.headers.get(state.obstacleMask.revisionHeader);
  if (revision !== state.obstacleMask.revision) {
    throw new GraphwarAgentClientError("conflict", "Graphwar state changed while reading the obstacle mask");
  }

  return parseGraphwarAgentWorldObstacleMask(await response.arrayBuffer(), state);
}

/** Validates and normalizes a saved world-mask response against its parsed state metadata. */
export function parseGraphwarAgentWorldObstacleMask(buffer: ArrayBufferLike, state: GraphwarAgentAvailableState) {
  const expectedLength = state.obstacleMask.width * state.obstacleMask.height;
  if (buffer.byteLength !== expectedLength) {
    throw new GraphwarAgentClientError(
      "incompatible",
      `Unexpected obstacle data size: ${buffer.byteLength}, expected ${expectedLength}`,
    );
  }

  const source = new Uint8Array(buffer);
  const mask = new Uint8Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    mask[index] = source[index] === 0 ? 0 : 1;
  }
  return mask;
}

/** Sends one original-button-equivalent ready request. */
async function submitGraphwarAgentReadyResponse(
  fetchImplementation: typeof globalThis.fetch,
  baseUrl: URL,
  ready: boolean,
  signal?: AbortSignal,
) {
  const response = await requestGraphwarAgent(fetchImplementation, new URL("ready", baseUrl), {
    body: String(ready),
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    method: "POST",
    signal,
  });
  const result = requireRecord(await readGraphwarAgentJson(response, "/ready"), "/ready response");
  if (result.ok !== true || result.requestedReady !== ready) {
    throw incompatibleSchema("/ready response");
  }
  return { ok: true, requestedReady: ready } as const;
}

/** Sends one shot exactly once and validates its acknowledgement. */
async function submitGraphwarAgentShotResponse(
  fetchImplementation: typeof globalThis.fetch,
  baseUrl: URL,
  request: GraphwarAgentShotRequest,
) {
  const response = await requestGraphwarAgent(fetchImplementation, new URL("shot", baseUrl), {
    body: JSON.stringify(request),
    headers: { "Content-Type": "application/json; charset=utf-8" },
    method: "POST",
  });
  const result = requireRecord(await readGraphwarAgentJson(response, "/shot"), "/shot response");
  if (result.ok !== true) {
    throw incompatibleSchema("/shot response");
  }
  return { ok: true } as const;
}

/** Converts transport and HTTP failures into stable controller-facing categories. */
async function requestGraphwarAgent(fetchImplementation: typeof globalThis.fetch, input: URL, init: RequestInit) {
  let response: Response;
  try {
    response = await fetchImplementation(input, { cache: "no-store", ...init });
  } catch (error) {
    throw new GraphwarAgentClientError(
      "transient",
      error instanceof Error ? error.message : String(error),
      undefined,
      error,
    );
  }
  if (response.ok) {
    return response;
  }

  const message = (await response.text()).trim() || `HTTP ${response.status}`;
  if (response.status === 404 || response.status === 405) {
    throw new GraphwarAgentClientError("incompatible", message, response.status);
  }
  if (response.status === 400) {
    throw new GraphwarAgentClientError("invalid-request", message, response.status);
  }
  if (response.status === 409) {
    throw new GraphwarAgentClientError("conflict", message, response.status);
  }
  throw new GraphwarAgentClientError("transient", message, response.status);
}

/** Reads JSON while treating malformed success bodies as protocol incompatibility. */
async function readGraphwarAgentJson(response: Response, endpoint: string) {
  try {
    return await response.json();
  } catch (error) {
    throw new GraphwarAgentClientError("incompatible", `${endpoint} returned invalid JSON`, response.status, error);
  }
}

/** Parses the API-v2 state union and validates all authoritative match fields. */
export function parseGraphwarAgentState(value: unknown): GraphwarAgentState {
  const state = requireRecord(value, "/state response");
  const apiVersion = requireInteger(state.apiVersion, "apiVersion");
  if (apiVersion !== GRAPHWAR_AGENT_API_VERSION) {
    throw new GraphwarAgentClientError("incompatible", `Unsupported Graphwar Agent API version: ${apiVersion}`);
  }
  const capabilities = parseGraphwarAgentCapabilities(state.capabilities);
  const plane = parseGraphwarAgentPlane(state.plane);
  if (state.available === false) {
    return {
      apiVersion: GRAPHWAR_AGENT_API_VERSION,
      available: false,
      capabilities,
      plane,
      reason: requireString(state.reason, "reason"),
    };
  }
  if (state.available !== true) {
    throw incompatibleSchema("available");
  }

  const gameMode = requireInteger(state.gameMode, "gameMode");
  if (gameMode !== 0 && gameMode !== 1 && gameMode !== 2) {
    throw incompatibleSchema("gameMode");
  }
  const phase = requireString(state.phase, "phase");
  if (phase !== "aiming" && phase !== "drawing" && phase !== "exploding" && phase !== "inactive") {
    throw incompatibleSchema("phase");
  }
  const battleRevision = requireOpaqueString(state.battleRevision, "battleRevision");
  const obstacleMask = parseGraphwarAgentObstacleMask(state.obstacleMask);
  if (obstacleMask.revision !== battleRevision) {
    throw incompatibleSchema("obstacleMask.revision");
  }
  if (obstacleMask.width !== plane.width || obstacleMask.height !== plane.height) {
    throw incompatibleSchema("obstacleMask dimensions");
  }

  const parsed: GraphwarAgentAvailableState = {
    apiVersion: GRAPHWAR_AGENT_API_VERSION,
    available: true,
    battleRevision,
    capabilities,
    currentTurn: requireInteger(state.currentTurn, "currentTurn"),
    drawingFunction: requireBoolean(state.drawingFunction, "drawingFunction"),
    equationMode: gameMode === 0 ? "y" : gameMode === 1 ? "dy" : "ddy",
    exploding: requireBoolean(state.exploding, "exploding"),
    gameInstanceId: requireOpaqueString(state.gameInstanceId, "gameInstanceId"),
    gameMode,
    gameState: requireInteger(state.gameState, "gameState"),
    obstacleMask,
    phase,
    plane,
    players: requireArray(state.players, "players").map(parseGraphwarAgentPlayer),
    remainingTurnMs: requireNonNegativeInteger(state.remainingTurnMs, "remainingTurnMs"),
  };
  if (state.turnToken !== undefined && state.turnToken !== null) {
    parsed.turnToken = requireOpaqueString(state.turnToken, "turnToken");
  }
  if (phase === "aiming" && !parsed.turnToken) {
    throw incompatibleSchema("turnToken");
  }
  return parsed;
}

/** Parses the four independently advertised managed-mode capabilities. */
function parseGraphwarAgentCapabilities(value: unknown): GraphwarAgentCapabilities {
  const capabilities = requireRecord(value, "capabilities");
  return {
    ready: requireBoolean(capabilities.ready, "capabilities.ready"),
    room: requireBoolean(capabilities.room, "capabilities.room"),
    shot: requireBoolean(capabilities.shot, "capabilities.shot"),
    worldObstacleMask: requireBoolean(capabilities.worldObstacleMask, "capabilities.worldObstacleMask"),
  };
}

/** Parses fixed Graphwar plane dimensions and rejects unsupported clients. */
function parseGraphwarAgentPlane(value: unknown): GraphwarAgentPlane {
  const plane = requireRecord(value, "plane");
  const parsed = {
    gameLength: requireFiniteNumber(plane.gameLength, "plane.gameLength"),
    height: requireInteger(plane.height, "plane.height"),
    width: requireInteger(plane.width, "plane.width"),
  };
  if (parsed.width !== GRAPHWAR_PLANE_LENGTH || parsed.height !== GRAPHWAR_PLANE_HEIGHT) {
    throw new GraphwarAgentClientError("incompatible", `Unsupported Graphwar plane: ${parsed.width}x${parsed.height}`);
  }
  return parsed;
}

/** Parses one player while retaining authoritative ownership and team data. */
function parseGraphwarAgentPlayer(value: unknown, fallbackIndex: number): GraphwarAgentPlayer {
  const player = requireRecord(value, `players[${fallbackIndex}]`);
  const ready =
    player.ready === undefined ? undefined : requireBoolean(player.ready, `players[${fallbackIndex}].ready`);
  return {
    computer: requireBoolean(player.computer, `players[${fallbackIndex}].computer`),
    currentTurnSoldier: requireInteger(
      player.currentTurnSoldier ?? player.currentTurnSoldierIndex,
      `players[${fallbackIndex}].currentTurnSoldier`,
    ),
    disconnected: requireBoolean(player.disconnected, `players[${fallbackIndex}].disconnected`),
    id: requireInteger(player.id ?? player.playerId, `players[${fallbackIndex}].id`),
    index: requireInteger(player.index, `players[${fallbackIndex}].index`),
    local: requireBoolean(player.local, `players[${fallbackIndex}].local`),
    name: requireString(player.name, `players[${fallbackIndex}].name`),
    ...(ready === undefined ? {} : { ready }),
    soldiers: requireArray(player.soldiers, `players[${fallbackIndex}].soldiers`).map(parseGraphwarAgentSoldier),
    team: requireInteger(player.team, `players[${fallbackIndex}].team`),
  };
}

/** Parses one soldier in world coordinates; view coordinates are intentionally ignored. */
function parseGraphwarAgentSoldier(value: unknown, fallbackIndex: number): GraphwarAgentSoldier {
  const soldier = requireRecord(value, `soldiers[${fallbackIndex}]`);
  const world = requireRecord(soldier.world, `soldiers[${fallbackIndex}].world`);
  const pixel = requireRecord(world.pixel, `soldiers[${fallbackIndex}].world.pixel`);
  return {
    alive: requireBoolean(soldier.alive, `soldiers[${fallbackIndex}].alive`),
    angle: requireFiniteNumber(soldier.angle, `soldiers[${fallbackIndex}].angle`),
    exploding:
      soldier.exploding === undefined
        ? false
        : requireBoolean(soldier.exploding, `soldiers[${fallbackIndex}].exploding`),
    index: requireInteger(soldier.index ?? soldier.soldierIndex, `soldiers[${fallbackIndex}].index`),
    world: {
      pixel: createPixelPoint(
        requireFiniteNumber(pixel.x, `soldiers[${fallbackIndex}].world.pixel.x`),
        requireFiniteNumber(pixel.y, `soldiers[${fallbackIndex}].world.pixel.y`),
      ),
    },
  };
}

/** Parses the revision-bound world obstacle endpoint metadata. */
function parseGraphwarAgentObstacleMask(value: unknown): GraphwarAgentObstacleMaskMetadata {
  const mask = requireRecord(value, "obstacleMask");
  return {
    height: requireInteger(mask.height, "obstacleMask.height"),
    revision: requireOpaqueString(mask.revision, "obstacleMask.revision"),
    revisionHeader:
      mask.revisionHeader === undefined
        ? GRAPHWAR_AGENT_BATTLE_REVISION_HEADER
        : requireString(mask.revisionHeader, "obstacleMask.revisionHeader"),
    width: requireInteger(mask.width, "obstacleMask.width"),
    worldUrl: requireString(mask.worldUrl, "obstacleMask.worldUrl"),
  };
}

/** Parses the room availability union used by the managed-mode polling loop. */
function parseGraphwarAgentRoom(value: unknown): GraphwarAgentRoom {
  const room = requireRecord(value, "/room response");
  if (room.available === false) {
    return { available: false, reason: requireString(room.reason, "reason") };
  }
  if (room.available !== true) {
    throw incompatibleSchema("room.available");
  }
  return {
    available: true,
    gameMode: requireInteger(room.gameMode, "room.gameMode"),
    gameState: requireInteger(room.gameState, "room.gameState"),
    leader: requireBoolean(room.leader, "room.leader"),
    players: requireArray(room.players, "room.players").map(parseGraphwarAgentRoomPlayer),
  };
}

/** Parses one room player, preserving the remote computer-player unknown state. */
function parseGraphwarAgentRoomPlayer(value: unknown, fallbackIndex: number): GraphwarAgentRoomPlayer {
  const player = requireRecord(value, `room.players[${fallbackIndex}]`);
  return {
    computer:
      player.computer === null ? null : requireBoolean(player.computer, `room.players[${fallbackIndex}].computer`),
    disconnected: requireBoolean(player.disconnected, `room.players[${fallbackIndex}].disconnected`),
    id: requireInteger(player.id, `room.players[${fallbackIndex}].id`),
    index: requireInteger(player.index, `room.players[${fallbackIndex}].index`),
    local: requireBoolean(player.local, `room.players[${fallbackIndex}].local`),
    name: requireString(player.name, `room.players[${fallbackIndex}].name`),
    numSoldiers: requireNonNegativeInteger(player.numSoldiers, `room.players[${fallbackIndex}].numSoldiers`),
    ready: requireBoolean(player.ready, `room.players[${fallbackIndex}].ready`),
    team: requireInteger(player.team, `room.players[${fallbackIndex}].team`),
  };
}

/** Adapts live soldiers to the existing detection-box model in the selected shooter's view. */
function createGraphwarAgentSoldierBoxes(
  state: GraphwarAgentAvailableState,
  shooterTeam: number,
): GraphwarAgentDetectionBox[] {
  const soldiers: GraphwarAgentDetectionBox[] = [];
  const visualRadius = GRAPHWAR_SOLDIER_VISIBLE_SIZE / 2;
  for (const player of state.players) {
    for (const soldier of player.soldiers) {
      if (!soldier.alive) {
        continue;
      }
      const center = worldPointToShooterView(soldier.world.pixel, shooterTeam);
      soldiers.push({
        confidence: 1,
        computer: player.computer,
        friendly: player.team === shooterTeam,
        height: visualRadius * 2,
        hitRadius: GRAPHWAR_SOLDIER_RADIUS,
        id: `agent-player-${player.id}-soldier-${soldier.index}`,
        kind: "soldier",
        local: player.local,
        mirrored: false,
        playerId: player.id,
        playerIndex: player.index,
        selectionRadius: visualRadius,
        sourceCenterX: center.x,
        sourceCenterY: center.y,
        soldierIndex: soldier.index,
        team: player.team,
        templateName: "agent",
        visualCenterX: center.x,
        visualCenterY: center.y,
        visualRadius,
        width: visualRadius * 2,
        x: center.x - visualRadius,
        y: center.y - visualRadius,
      });
    }
  }
  return soldiers;
}

/** Adapts a world snapshot to one team's point and mask coordinate rules. */
function createGraphwarAgentDetectionResult(
  state: GraphwarAgentAvailableState,
  worldObstacleMask: Uint8Array,
  shooterTeam: number,
): GraphwarAgentDetectionResult {
  const mask = worldMaskToShooterView(worldObstacleMask, shooterTeam);
  return {
    obstacles: { count: countObstacleMaskComponents(mask), mask },
    soldiers: createGraphwarAgentSoldierBoxes(state, shooterTeam),
  };
}

/** Mirrors soldier centers with GraphPlane's point rule for TEAM2. */
function worldPointToShooterView(point: PixelPoint, shooterTeam: number) {
  return shooterTeam === 2 ? createPixelPoint(GRAPHWAR_PLANE_LENGTH - point.x, point.y) : point;
}

/** Mirrors obstacle cells with the 0-based mask rule for TEAM2. */
function worldMaskToShooterView(worldMask: Uint8Array, shooterTeam: number) {
  if (shooterTeam !== 2) {
    return new Uint8Array(worldMask);
  }
  const mask = new Uint8Array(worldMask.length);
  for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
    const rowOffset = y * GRAPHWAR_PLANE_LENGTH;
    for (let x = 0; x < GRAPHWAR_PLANE_LENGTH; x += 1) {
      mask[rowOffset + x] = worldMask[rowOffset + GRAPHWAR_PLANE_LENGTH - 1 - x];
    }
  }
  return mask;
}

/** 判断玩家是否为可由本地托管模式控制的已连接真人。 */
export function isGraphwarAgentLocalHuman(player: GraphwarAgentPlayer | undefined): player is GraphwarAgentPlayer {
  return Boolean(player?.local && !player.computer && !player.disconnected);
}

/** Creates a transparent canvas without relying on an external image asset. */
function createGraphwarAgentCanvasDataUrl() {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${GRAPHWAR_PLANE_LENGTH}" height="${GRAPHWAR_PLANE_HEIGHT}" viewBox="0 0 ${GRAPHWAR_PLANE_LENGTH} ${GRAPHWAR_PLANE_HEIGHT}"></svg>`,
  )}`;
}

/** Requires a plain JSON object. */
function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw incompatibleSchema(field);
  }
  return value as Record<string, unknown>;
}

/** Requires a JSON array. */
function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw incompatibleSchema(field);
  }
  return value;
}

/** Requires a boolean field. */
function requireBoolean(value: unknown, field: string) {
  if (typeof value !== "boolean") {
    throw incompatibleSchema(field);
  }
  return value;
}

/** Requires a finite numeric field. */
function requireFiniteNumber(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw incompatibleSchema(field);
  }
  return value;
}

/** Requires an integer field. */
function requireInteger(value: unknown, field: string) {
  const number = requireFiniteNumber(value, field);
  if (!Number.isInteger(number)) {
    throw incompatibleSchema(field);
  }
  return number;
}

/** Requires a non-negative integer field. */
function requireNonNegativeInteger(value: unknown, field: string) {
  const number = requireInteger(value, field);
  if (number < 0) {
    throw incompatibleSchema(field);
  }
  return number;
}

/** Requires a string field. */
function requireString(value: unknown, field: string) {
  if (typeof value !== "string") {
    throw incompatibleSchema(field);
  }
  return value;
}

/** Requires a non-empty opaque identifier without interpreting its format. */
function requireOpaqueString(value: unknown, field: string) {
  const string = requireString(value, field);
  if (!string) {
    throw incompatibleSchema(field);
  }
  return string;
}

/** Creates a consistent malformed-contract error. */
function incompatibleSchema(field: string) {
  return new GraphwarAgentClientError("incompatible", `Invalid Graphwar Agent field: ${field}`);
}
