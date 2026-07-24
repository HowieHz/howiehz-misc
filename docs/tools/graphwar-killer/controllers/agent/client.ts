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

export const GRAPHWAR_AGENT_API_VERSION = 3;
export const GRAPHWAR_AGENT_DEFAULT_BASE_URL = "http://127.0.0.1:17900";

/** Agent feature flags checked before the page enables dependent workflows. */
export interface GraphwarAgentCapabilities {
  canReadRoom: boolean;
  canReadWorldObstacleMask: boolean;
  canSetReady: boolean;
  canSubmitShots: boolean;
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
  angleRadians: number;
  isAlive: boolean;
  isRendered: boolean;
  soldierIndex: number;
  world: GraphwarAgentWorldPoint;
}

/** One player and its soldiers in an Agent polling response. */
export interface GraphwarAgentPlayer {
  currentSoldierIndex: number | null;
  isComputerControlled: boolean;
  isConnected: boolean;
  isLocal: boolean;
  isReady: boolean;
  name: string;
  playerId: number;
  playerIndex: number;
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
  isSpeculative: boolean;
}

/** Agent soldier adapted to the detection-box interface used by page workflows. */
export interface GraphwarAgentDetectionBox extends GraphwarDetectionBox {
  /** Authoritative local-computer ownership, independent of screen position. */
  isComputerControlled: boolean;
  /** Authoritative relation to the selected shooter's team, independent of screen position. */
  isFriendly: boolean;
  /** Authoritative local-client ownership, independent of screen position. */
  isLocal: boolean;
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
  blockedValue: 1;
  emptyValue: 0;
  height: number;
  isViewMirrored: boolean;
  revision: string;
  viewUrl: "/obstacle-masks/view.bin";
  width: number;
  worldUrl: "/obstacle-masks/world.bin";
}

export type GraphwarAgentPhase = "aiming" | "drawing" | "exploding";

/** Authoritative Graphwar function cursor at the surrounding state observation time. */
export interface GraphwarAgentFunctionDraw {
  currentStep: number;
  stepsPerSecond: number;
}

/** Fields shared by available and unavailable Agent polling responses. */
interface GraphwarAgentStateBase {
  agentInstanceId: string;
  apiVersion: typeof GRAPHWAR_AGENT_API_VERSION;
  capabilities: GraphwarAgentCapabilities;
  isAvailable: boolean;
  observationSequence: number;
  observedAtEpochMs: number;
  plane: GraphwarAgentPlane;
}

/** Stable unavailable response returned outside an active match. */
export interface GraphwarAgentUnavailableState extends GraphwarAgentStateBase {
  isAvailable: false;
  reason: string;
}

/** Authoritative active-match snapshot with a battle revision and optional firing token. */
export interface GraphwarAgentAvailableState extends GraphwarAgentStateBase {
  isAvailable: true;
  battleRevision: string;
  canAcceptShotCommands: boolean;
  currentPlayerId: number | null;
  currentPlayerIndex: number | null;
  equationMode: EquationMode;
  functionDraw: GraphwarAgentFunctionDraw | null;
  gameInstanceId: string;
  isTerrainReversed: boolean;
  obstacleMask: GraphwarAgentObstacleMaskMetadata;
  phase: GraphwarAgentPhase;
  players: GraphwarAgentPlayer[];
  remainingTurnMs: number;
  shotCommand: GraphwarAgentShotCommandSummary | null;
  turnToken: string | null;
}

export type GraphwarAgentState = GraphwarAgentAvailableState | GraphwarAgentUnavailableState;

/** One pre-game room participant; remote computer ownership may be unknown. */
export interface GraphwarAgentRoomPlayer {
  isComputerControlled: boolean | null;
  isConnected: boolean;
  isLocal: boolean;
  isReady: boolean;
  name: string;
  numSoldiers: number;
  playerId: number;
  playerIndex: number;
  team: number;
}

/** Available pre-game room snapshot. */
export interface GraphwarAgentAvailableRoom {
  equationMode: EquationMode;
  isAvailable: true;
  isLeader: boolean;
  players: GraphwarAgentRoomPlayer[];
}

/** Stable response used when the client is not in a pre-game room. */
export interface GraphwarAgentUnavailableRoom {
  isAvailable: false;
  reason: string;
}

export type GraphwarAgentRoom = GraphwarAgentAvailableRoom | GraphwarAgentUnavailableRoom;

/** Acknowledgement that the requested ready command was submitted. */
export interface GraphwarAgentReadyResult {
  isReady: boolean;
}

/** Shot command guarded by the state snapshot's token and revision. */
export interface GraphwarAgentShotRequest {
  angleRadians?: number;
  battleRevision: string;
  function: string;
  gameInstanceId: string;
  requestId: string;
  turnToken: string;
}

/** Guard fields shared by a shot request and every command representation. */
export type GraphwarAgentShotCommandIdentity = Pick<
  GraphwarAgentShotRequest,
  "battleRevision" | "gameInstanceId" | "requestId" | "turnToken"
>;

export type GraphwarAgentShotCommandStatus = "validating" | "claimed" | "submitted" | "failed" | "unknown";

/** Status-specific diagnostic returned by a failed or unknown command resource. */
export interface GraphwarAgentShotCommandError {
  canRetryWithNewRequestId?: boolean;
  code: string;
  message: string;
}

/** Bounded command identity embedded in the current state snapshot. */
export interface GraphwarAgentShotCommandSummary {
  requestId: string;
  status: Exclude<GraphwarAgentShotCommandStatus, "failed">;
}

/** Retained idempotent result of one guarded shot command. */
export interface GraphwarAgentShotCommand {
  battleRevision: string;
  createdAtEpochMs: number;
  error?: GraphwarAgentShotCommandError;
  gameInstanceId: string;
  requestId: string;
  status: GraphwarAgentShotCommandStatus;
  turnToken: string;
  updatedAtEpochMs: number;
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
  | "command"
  | "conflict"
  | "incompatible"
  | "invalid-request"
  | "transient"
  | "unavailable";

/** Typed failure used to separate retryable transport failures from protocol incompatibility. */
export class GraphwarAgentClientError extends Error {
  readonly code?: string;
  readonly kind: GraphwarAgentClientErrorKind;
  readonly status?: number;

  /** Captures one normalized Agent failure without losing its original cause. */
  constructor(kind: GraphwarAgentClientErrorKind, message: string, status?: number, cause?: unknown, code?: string) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GraphwarAgentClientError";
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

/** Browser interface to one normalized localhost Agent endpoint. */
export interface GraphwarAgentClient {
  readonly baseUrl: string;
  readRoom: (signal?: AbortSignal) => Promise<GraphwarAgentRoom>;
  readShotCommand: (requestId: string, signal?: AbortSignal) => Promise<GraphwarAgentShotCommand>;
  readState: (signal?: AbortSignal) => Promise<GraphwarAgentState>;
  readWorldObstacleMask: (state: GraphwarAgentAvailableState, signal?: AbortSignal) => Promise<Uint8Array>;
  submitReady: (isReady: boolean, signal?: AbortSignal) => Promise<GraphwarAgentReadyResult>;
  submitShot: (request: GraphwarAgentShotRequest, signal?: AbortSignal) => Promise<GraphwarAgentShotCommand>;
}

/** Injectable transport used by tests and browsers without global fetch. */
export interface GraphwarAgentClientOptions {
  fetch?: typeof globalThis.fetch;
  token?: string;
}

/** Snapshot-only hooks that keep live state observation separate from offline snapshot adaptation. */
export interface GraphwarAgentSnapshotReadOptions extends GraphwarAgentClientOptions {
  /** Applies freshness-sensitive state before the mask request; false rejects the snapshot. */
  onStateRead?: (state: GraphwarAgentState) => boolean | undefined;
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
  const token = options.token ?? "";
  if (token.length > 4096) {
    throw new GraphwarAgentClientError(
      "invalid-request",
      "Graphwar Agent token must contain at most 4096 visible ASCII characters excluding comma",
    );
  }
  for (let index = 0; index < token.length; index += 1) {
    const character = token.charCodeAt(index);
    if (character < 0x21 || character > 0x7e || character === 0x2c) {
      throw new GraphwarAgentClientError(
        "invalid-request",
        "Graphwar Agent token must contain visible ASCII characters excluding comma",
      );
    }
  }
  const transport: typeof globalThis.fetch = (input, init = {}) => {
    if (!token) {
      return fetchImplementation(input, init);
    }
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetchImplementation(input, { ...init, headers });
  };

  return {
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    readRoom: (signal) => readGraphwarAgentRoomResponse(transport, baseUrl, signal),
    readShotCommand: (requestId, signal) => readGraphwarAgentShotCommandResponse(transport, baseUrl, requestId, signal),
    readState: (signal) => readGraphwarAgentStateResponse(transport, baseUrl, signal),
    readWorldObstacleMask: (state, signal) =>
      readGraphwarAgentWorldObstacleMaskResponse(transport, baseUrl, state, signal),
    submitReady: (isReady, signal) => submitGraphwarAgentReadyResponse(transport, baseUrl, isReady, signal),
    submitShot: (request, signal) => submitGraphwarAgentShotResponse(transport, baseUrl, request, signal),
  };
}

/** Reads and adapts one complete authoritative Agent snapshot for the existing page workflow. */
export async function readGraphwarAgentSnapshot(
  baseUrlText: string,
  options: GraphwarAgentSnapshotReadOptions = {},
): Promise<GraphwarAgentSnapshot | undefined> {
  const client = createGraphwarAgentClient(baseUrlText, options);
  const state = await client.readState();
  if (options.onStateRead?.(state) === false) {
    return undefined;
  }
  if (!state.isAvailable) {
    throw new GraphwarAgentClientError("unavailable", state.reason);
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
    return createGraphwarAgentShooterViewSnapshot(worldSnapshot, shooter.player.playerId, shooter.soldier.soldierIndex);
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
  const player = snapshot.state.players.find((candidate) => candidate.playerId === playerId);
  const soldier = player?.soldiers.find((candidate) => candidate.soldierIndex === soldierIndex);
  if (!player || !soldier?.isAlive) {
    throw new GraphwarAgentClientError("conflict", "The selected Graphwar shooter is unavailable");
  }

  const selected = selectGraphwarAgentShooter(snapshot.state);
  const shooter = {
    player,
    soldier,
    isSpeculative:
      selected?.player.playerId !== playerId ||
      selected.soldier.soldierIndex !== soldierIndex ||
      selected.isSpeculative,
  };
  return {
    ...snapshot,
    detectionResult: createGraphwarAgentDetectionResult(snapshot.state, snapshot.worldObstacleMask, player.team),
    localCurrentTurnSoldierPoint: shooter.isSpeculative
      ? undefined
      : worldPointToShooterView(soldier.world.pixel, player.team),
    shooter,
  };
}

/** Chooses the active local-human shooter without predicting a future turn. */
export function selectGraphwarAgentCurrentShooter(
  state: GraphwarAgentAvailableState,
): GraphwarAgentCurrentShooter | undefined {
  const currentPlayer = state.currentPlayerIndex === null ? undefined : state.players[state.currentPlayerIndex];
  if (state.phase !== "aiming" || !isGraphwarAgentLocalHuman(currentPlayer)) {
    return undefined;
  }
  const soldier =
    currentPlayer.currentSoldierIndex === null ? undefined : currentPlayer.soldiers[currentPlayer.currentSoldierIndex];
  return soldier?.isAlive ? { player: currentPlayer, soldier } : undefined;
}

/** Chooses the active local human or predicts the next one for a manual state read. */
export function selectGraphwarAgentShooter(state: GraphwarAgentAvailableState): GraphwarAgentShooter | undefined {
  const currentShooter = selectGraphwarAgentCurrentShooter(state);
  if (currentShooter) {
    return { ...currentShooter, isSpeculative: false };
  }

  const currentPlayerIndex = state.currentPlayerIndex ?? -1;
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const player = state.players[(currentPlayerIndex + offset + state.players.length) % state.players.length];
    if (!isGraphwarAgentLocalHuman(player)) {
      continue;
    }
    for (let soldierOffset = 1; soldierOffset <= player.soldiers.length; soldierOffset += 1) {
      const currentSoldierIndex = player.currentSoldierIndex ?? -1;
      const index = (currentSoldierIndex + soldierOffset + player.soldiers.length) % player.soldiers.length;
      const soldier = player.soldiers[index];
      if (soldier?.isAlive) {
        return { isSpeculative: true, player, soldier };
      }
    }
  }
  return undefined;
}

/** Builds the exact mode-specific payload accepted by Agent API v3. */
export function createGraphwarAgentShotRequest(
  state: GraphwarAgentAvailableState,
  plan: GraphwarAgentShotPlan,
  requestId = crypto.randomUUID(),
): GraphwarAgentShotRequest {
  if (state.phase !== "aiming" || !state.turnToken || !state.canAcceptShotCommands) {
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
      gameInstanceId: state.gameInstanceId,
      requestId,
      turnToken: state.turnToken,
    };
  }
  return {
    battleRevision: state.battleRevision,
    function: plan.function,
    gameInstanceId: state.gameInstanceId,
    requestId,
    turnToken: state.turnToken,
  };
}

/** Reports whether the Agent advertises every capability required by managed mode. */
export function supportsGraphwarManagedMode(capabilities: GraphwarAgentCapabilities) {
  return (
    capabilities.canReadRoom &&
    capabilities.canReadWorldObstacleMask &&
    capabilities.canSetReady &&
    capabilities.canSubmitShots
  );
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
    headers: { "If-Match": `"${state.obstacleMask.revision}"` },
    signal,
  });
  const revision = response.headers.get("ETag");
  if (revision !== `"${state.obstacleMask.revision}"`) {
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
  isReady: boolean,
  signal?: AbortSignal,
) {
  const response = await requestGraphwarAgent(fetchImplementation, new URL("room/ready", baseUrl), {
    body: JSON.stringify({ isReady }),
    headers: { "Content-Type": "application/json; charset=utf-8" },
    method: "PUT",
    signal,
  });
  const result = requireRecord(await readGraphwarAgentJson(response, "/room/ready"), "/room/ready response");
  if (result.isReady !== isReady) {
    throw incompatibleSchema("/room/ready response");
  }
  return { isReady };
}

/** Creates or safely replays one idempotent shot command. */
async function submitGraphwarAgentShotResponse(
  fetchImplementation: typeof globalThis.fetch,
  baseUrl: URL,
  request: GraphwarAgentShotRequest,
  signal?: AbortSignal,
) {
  const response = await requestGraphwarAgent(fetchImplementation, new URL("shots", baseUrl), {
    body: JSON.stringify(request),
    headers: { "Content-Type": "application/json; charset=utf-8" },
    method: "POST",
    signal,
  });
  return requireMatchingGraphwarAgentShotCommand(
    parseGraphwarAgentShotCommand(await readGraphwarAgentJson(response, "/shots")),
    request,
  );
}

/** Reads one retained shot command without changing its execution state. */
async function readGraphwarAgentShotCommandResponse(
  fetchImplementation: typeof globalThis.fetch,
  baseUrl: URL,
  requestId: string,
  signal?: AbortSignal,
) {
  const response = await requestGraphwarAgent(
    fetchImplementation,
    new URL(`shots/${encodeURIComponent(requestId)}`, baseUrl),
    { signal },
  );
  const command = parseGraphwarAgentShotCommand(await readGraphwarAgentJson(response, "/shots/{requestId}"));
  if (command.requestId !== requestId) {
    throw incompatibleSchema("shot command.requestId");
  }
  return command;
}

/** Converts transport and HTTP failures into stable controller-facing categories. */
async function requestGraphwarAgent(fetchImplementation: typeof globalThis.fetch, input: URL, init: RequestInit) {
  let response: Response;
  try {
    response = await fetchImplementation(input, { cache: "no-store", ...init });
  } catch (error) {
    throw createGraphwarAgentTransientError(error);
  }
  if (response.ok) {
    return response;
  }

  const errorBody = await readGraphwarAgentError(response);
  if ((response.status === 404 && errorBody.code === "route-not-found") || response.status === 405) {
    throw new GraphwarAgentClientError("incompatible", errorBody.message, response.status, undefined, errorBody.code);
  }
  if (
    response.status === 400 ||
    response.status === 401 ||
    response.status === 411 ||
    response.status === 413 ||
    response.status === 415 ||
    response.status === 431
  ) {
    throw new GraphwarAgentClientError(
      "invalid-request",
      errorBody.message,
      response.status,
      undefined,
      errorBody.code,
    );
  }
  if (response.status === 404 || response.status === 409 || response.status === 412 || response.status === 428) {
    throw new GraphwarAgentClientError("conflict", errorBody.message, response.status, undefined, errorBody.code);
  }
  throw new GraphwarAgentClientError("transient", errorBody.message, response.status, undefined, errorBody.code);
}

/** Parses the stable v3 error envelope without trusting its human message for control flow. */
async function readGraphwarAgentError(response: Response) {
  try {
    const body = requireRecord(await response.json(), "error response");
    const error = requireRecord(body.error, "error response.error");
    return {
      code: requireString(error.code, "error.code"),
      message: requireString(error.message, "error.message"),
    };
  } catch (error) {
    if (error instanceof GraphwarAgentClientError) {
      throw error;
    }
    throw new GraphwarAgentClientError(
      "incompatible",
      "Graphwar Agent returned an invalid error response",
      response.status,
    );
  }
}

/** Separates retryable body-stream failures from malformed successful JSON. */
async function readGraphwarAgentJson(response: Response, endpoint: string) {
  try {
    return await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw createGraphwarAgentTransientError(error, `${endpoint} response body could not be read: `);
    }
    throw new GraphwarAgentClientError("incompatible", `${endpoint} returned invalid JSON`, response.status, error);
  }
}

/** Normalizes fetch and JSON-body transport failures as retryable. */
function createGraphwarAgentTransientError(error: unknown, messagePrefix = "") {
  return new GraphwarAgentClientError(
    "transient",
    `${messagePrefix}${error instanceof Error ? error.message : String(error)}`,
    undefined,
    error,
  );
}

/** Parses the API-v3 state union and validates all authoritative match fields. */
export function parseGraphwarAgentState(value: unknown): GraphwarAgentState {
  const state = requireRecord(value, "/state response");
  const apiVersion = requireInteger(state.apiVersion, "apiVersion");
  if (apiVersion !== GRAPHWAR_AGENT_API_VERSION) {
    throw new GraphwarAgentClientError("incompatible", `Unsupported Graphwar Agent API version: ${apiVersion}`);
  }
  const agentInstanceId = requireCanonicalUuid(state.agentInstanceId, "agentInstanceId");
  const capabilities = parseGraphwarAgentCapabilities(state.capabilities);
  const observationSequence = requireNonNegativeInteger(state.observationSequence, "observationSequence");
  const observedAtEpochMs = requireNonNegativeInteger(state.observedAtEpochMs, "observedAtEpochMs");
  const plane = parseGraphwarAgentPlane(state.plane);
  if (state.isAvailable === false) {
    return {
      agentInstanceId,
      apiVersion: GRAPHWAR_AGENT_API_VERSION,
      capabilities,
      isAvailable: false,
      observationSequence,
      observedAtEpochMs,
      plane,
      reason: requireString(state.reason, "reason"),
    };
  }
  if (state.isAvailable !== true) {
    throw incompatibleSchema("isAvailable");
  }

  const phase = requireString(state.phase, "phase");
  if (phase !== "aiming" && phase !== "drawing" && phase !== "exploding") {
    throw incompatibleSchema("phase");
  }
  let functionDraw: GraphwarAgentFunctionDraw | null = null;
  if (state.functionDraw !== null) {
    const value = requireRecord(state.functionDraw, "functionDraw");
    const stepsPerSecond = requireInteger(value.stepsPerSecond, "functionDraw.stepsPerSecond");
    if (stepsPerSecond <= 0) {
      throw incompatibleSchema("functionDraw.stepsPerSecond");
    }
    functionDraw = {
      currentStep: requireNonNegativeInteger(value.currentStep, "functionDraw.currentStep"),
      stepsPerSecond,
    };
  }
  if ((phase === "drawing") !== (functionDraw !== null)) {
    throw incompatibleSchema("phase/functionDraw");
  }
  const battleRevision = requireBattleRevision(state.battleRevision, "battleRevision");
  const obstacleMask = parseGraphwarAgentObstacleMask(state.obstacleMask);
  if (obstacleMask.revision !== battleRevision) {
    throw incompatibleSchema("obstacleMask.revision");
  }
  if (obstacleMask.width !== plane.width || obstacleMask.height !== plane.height) {
    throw incompatibleSchema("obstacleMask dimensions");
  }

  const players = requireArray(state.players, "players").map(parseGraphwarAgentPlayer);
  const currentPlayerIndex = requireNullableInteger(state.currentPlayerIndex, "currentPlayerIndex");
  const currentPlayerId = requireNullableInteger(state.currentPlayerId, "currentPlayerId");
  if ((currentPlayerIndex === null) !== (currentPlayerId === null)) {
    throw incompatibleSchema("currentPlayerIndex/currentPlayerId");
  }
  if (
    currentPlayerIndex !== null &&
    (players[currentPlayerIndex]?.playerIndex !== currentPlayerIndex ||
      players[currentPlayerIndex]?.playerId !== currentPlayerId)
  ) {
    throw incompatibleSchema("currentPlayerIndex/currentPlayerId");
  }

  const turnToken = state.turnToken === null ? null : requireCanonicalUuid(state.turnToken, "turnToken");
  const isTerrainReversed = requireBoolean(state.isTerrainReversed, "isTerrainReversed");
  if (obstacleMask.isViewMirrored !== isTerrainReversed) {
    throw incompatibleSchema("obstacleMask.isViewMirrored");
  }
  const shotCommand = state.shotCommand === null ? null : parseGraphwarAgentShotCommandSummary(state.shotCommand);
  if (shotCommand && !turnToken) {
    throw incompatibleSchema("shotCommand/turnToken");
  }
  return {
    agentInstanceId,
    apiVersion: GRAPHWAR_AGENT_API_VERSION,
    battleRevision,
    canAcceptShotCommands: requireBoolean(state.canAcceptShotCommands, "canAcceptShotCommands"),
    capabilities,
    currentPlayerId,
    currentPlayerIndex,
    equationMode: parseGraphwarAgentEquationMode(state.equationMode, "equationMode"),
    functionDraw,
    gameInstanceId: requireCanonicalUuid(state.gameInstanceId, "gameInstanceId"),
    isAvailable: true,
    isTerrainReversed,
    obstacleMask,
    observationSequence,
    observedAtEpochMs,
    phase,
    plane,
    players,
    remainingTurnMs: requireNonNegativeInteger(state.remainingTurnMs, "remainingTurnMs"),
    shotCommand,
    turnToken,
  };
}

/** Parses the four independently advertised managed-mode capabilities. */
function parseGraphwarAgentCapabilities(value: unknown): GraphwarAgentCapabilities {
  const capabilities = requireRecord(value, "capabilities");
  return {
    canReadRoom: requireBoolean(capabilities.canReadRoom, "capabilities.canReadRoom"),
    canReadWorldObstacleMask: requireBoolean(
      capabilities.canReadWorldObstacleMask,
      "capabilities.canReadWorldObstacleMask",
    ),
    canSetReady: requireBoolean(capabilities.canSetReady, "capabilities.canSetReady"),
    canSubmitShots: requireBoolean(capabilities.canSubmitShots, "capabilities.canSubmitShots"),
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
  const playerIndex = requireInteger(player.playerIndex, `players[${fallbackIndex}].playerIndex`);
  if (playerIndex !== fallbackIndex) {
    throw incompatibleSchema(`players[${fallbackIndex}].playerIndex`);
  }
  return {
    currentSoldierIndex: requireNullableInteger(
      player.currentSoldierIndex,
      `players[${fallbackIndex}].currentSoldierIndex`,
    ),
    isComputerControlled: requireBoolean(player.isComputerControlled, `players[${fallbackIndex}].isComputerControlled`),
    isConnected: requireBoolean(player.isConnected, `players[${fallbackIndex}].isConnected`),
    isLocal: requireBoolean(player.isLocal, `players[${fallbackIndex}].isLocal`),
    isReady: requireBoolean(player.isReady, `players[${fallbackIndex}].isReady`),
    name: requireString(player.name, `players[${fallbackIndex}].name`),
    playerId: requireInteger(player.playerId, `players[${fallbackIndex}].playerId`),
    playerIndex,
    soldiers: requireArray(player.soldiers, `players[${fallbackIndex}].soldiers`).map(parseGraphwarAgentSoldier),
    team: requireInteger(player.team, `players[${fallbackIndex}].team`),
  };
}

/** Parses one soldier in world coordinates; view coordinates are intentionally ignored. */
function parseGraphwarAgentSoldier(value: unknown, fallbackIndex: number): GraphwarAgentSoldier {
  const soldier = requireRecord(value, `soldiers[${fallbackIndex}]`);
  const world = requireRecord(soldier.world, `soldiers[${fallbackIndex}].world`);
  const pixel = requireRecord(world.pixel, `soldiers[${fallbackIndex}].world.pixel`);
  const soldierIndex = requireInteger(soldier.soldierIndex, `soldiers[${fallbackIndex}].soldierIndex`);
  if (soldierIndex !== fallbackIndex) {
    throw incompatibleSchema(`soldiers[${fallbackIndex}].soldierIndex`);
  }
  return {
    angleRadians: requireFiniteNumber(soldier.angleRadians, `soldiers[${fallbackIndex}].angleRadians`),
    isAlive: requireBoolean(soldier.isAlive, `soldiers[${fallbackIndex}].isAlive`),
    isRendered: requireBoolean(soldier.isRendered, `soldiers[${fallbackIndex}].isRendered`),
    soldierIndex,
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
  if (mask.blockedValue !== 1) {
    throw incompatibleSchema("obstacleMask.blockedValue");
  }
  if (mask.emptyValue !== 0) {
    throw incompatibleSchema("obstacleMask.emptyValue");
  }
  const viewUrl = requireString(mask.viewUrl, "obstacleMask.viewUrl");
  if (viewUrl !== "/obstacle-masks/view.bin") {
    throw incompatibleSchema("obstacleMask.viewUrl");
  }
  const worldUrl = requireString(mask.worldUrl, "obstacleMask.worldUrl");
  if (worldUrl !== "/obstacle-masks/world.bin") {
    throw incompatibleSchema("obstacleMask.worldUrl");
  }
  return {
    blockedValue: 1,
    emptyValue: 0,
    height: requireInteger(mask.height, "obstacleMask.height"),
    isViewMirrored: requireBoolean(mask.isViewMirrored, "obstacleMask.isViewMirrored"),
    revision: requireBattleRevision(mask.revision, "obstacleMask.revision"),
    viewUrl,
    width: requireInteger(mask.width, "obstacleMask.width"),
    worldUrl,
  };
}

/** Parses the room availability union used by the managed-mode polling loop. */
function parseGraphwarAgentRoom(value: unknown): GraphwarAgentRoom {
  const room = requireRecord(value, "/room response");
  if (room.isAvailable === false) {
    return { isAvailable: false, reason: requireString(room.reason, "reason") };
  }
  if (room.isAvailable !== true) {
    throw incompatibleSchema("room.isAvailable");
  }
  return {
    equationMode: parseGraphwarAgentEquationMode(room.equationMode, "room.equationMode"),
    isAvailable: true,
    isLeader: requireBoolean(room.isLeader, "room.isLeader"),
    players: requireArray(room.players, "room.players").map(parseGraphwarAgentRoomPlayer),
  };
}

/** Parses one room player, preserving the remote computer-player unknown state. */
function parseGraphwarAgentRoomPlayer(value: unknown, fallbackIndex: number): GraphwarAgentRoomPlayer {
  const player = requireRecord(value, `room.players[${fallbackIndex}]`);
  const playerIndex = requireInteger(player.playerIndex, `room.players[${fallbackIndex}].playerIndex`);
  if (playerIndex !== fallbackIndex) {
    throw incompatibleSchema(`room.players[${fallbackIndex}].playerIndex`);
  }
  return {
    isComputerControlled:
      player.isComputerControlled === null
        ? null
        : requireBoolean(player.isComputerControlled, `room.players[${fallbackIndex}].isComputerControlled`),
    isConnected: requireBoolean(player.isConnected, `room.players[${fallbackIndex}].isConnected`),
    isLocal: requireBoolean(player.isLocal, `room.players[${fallbackIndex}].isLocal`),
    isReady: requireBoolean(player.isReady, `room.players[${fallbackIndex}].isReady`),
    name: requireString(player.name, `room.players[${fallbackIndex}].name`),
    numSoldiers: requireNonNegativeInteger(player.numSoldiers, `room.players[${fallbackIndex}].numSoldiers`),
    playerId: requireInteger(player.playerId, `room.players[${fallbackIndex}].playerId`),
    playerIndex,
    team: requireInteger(player.team, `room.players[${fallbackIndex}].team`),
  };
}

/** Parses one retained command and enforces status-specific error fields. */
export function parseGraphwarAgentShotCommand(value: unknown): GraphwarAgentShotCommand {
  const command = requireRecord(value, "shot command");
  const status = parseGraphwarAgentShotCommandStatus(command.status, "shot command.status");
  const error = command.error === undefined ? undefined : parseGraphwarAgentShotCommandError(command.error, status);
  if ((status === "failed" || status === "unknown") !== (error !== undefined)) {
    throw incompatibleSchema("shot command.error");
  }
  return {
    battleRevision: requireBattleRevision(command.battleRevision, "shot command.battleRevision"),
    createdAtEpochMs: requireNonNegativeInteger(command.createdAtEpochMs, "shot command.createdAtEpochMs"),
    ...(error ? { error } : {}),
    gameInstanceId: requireCanonicalUuid(command.gameInstanceId, "shot command.gameInstanceId"),
    requestId: requireCanonicalUuid(command.requestId, "shot command.requestId"),
    status,
    turnToken: requireCanonicalUuid(command.turnToken, "shot command.turnToken"),
    updatedAtEpochMs: requireNonNegativeInteger(command.updatedAtEpochMs, "shot command.updatedAtEpochMs"),
  };
}

/** Rejects a valid command resource that belongs to a different guarded submission. */
export function requireMatchingGraphwarAgentShotCommand(
  command: GraphwarAgentShotCommand,
  identity: GraphwarAgentShotCommandIdentity,
) {
  if (
    command.requestId !== identity.requestId ||
    command.gameInstanceId !== identity.gameInstanceId ||
    command.turnToken !== identity.turnToken ||
    command.battleRevision !== identity.battleRevision
  ) {
    throw incompatibleSchema("shot command identity");
  }
  return command;
}

/** Converts a terminal command diagnostic to the page's structured error type. */
export function createGraphwarAgentShotCommandError(command: GraphwarAgentShotCommand) {
  return new GraphwarAgentClientError(
    "command",
    command.error?.message ?? `Graphwar Agent returned ${command.status} without command error details`,
    undefined,
    undefined,
    command.error?.code,
  );
}

/** Parses the current-turn command summary embedded in `/state`. */
function parseGraphwarAgentShotCommandSummary(value: unknown): GraphwarAgentShotCommandSummary {
  const summary = requireRecord(value, "shotCommand");
  const status = parseGraphwarAgentShotCommandStatus(summary.status, "shotCommand.status");
  if (status === "failed") {
    throw incompatibleSchema("shotCommand.status");
  }
  return {
    requestId: requireCanonicalUuid(summary.requestId, "shotCommand.requestId"),
    status,
  };
}

/** Parses one status-specific public command error. */
function parseGraphwarAgentShotCommandError(
  value: unknown,
  status: GraphwarAgentShotCommandStatus,
): GraphwarAgentShotCommandError {
  const error = requireRecord(value, "shot command.error");
  const canRetryWithNewRequestId =
    error.canRetryWithNewRequestId === undefined
      ? undefined
      : requireBoolean(error.canRetryWithNewRequestId, "shot command.error.canRetryWithNewRequestId");
  if ((status === "failed") !== (canRetryWithNewRequestId !== undefined)) {
    throw incompatibleSchema("shot command.error.canRetryWithNewRequestId");
  }
  return {
    ...(canRetryWithNewRequestId === undefined ? {} : { canRetryWithNewRequestId }),
    code: requireString(error.code, "shot command.error.code"),
    message: requireString(error.message, "shot command.error.message"),
  };
}

/** Parses one command state without accepting future or misspelled values. */
function parseGraphwarAgentShotCommandStatus(value: unknown, field: string): GraphwarAgentShotCommandStatus {
  const status = requireString(value, field);
  if (
    status !== "validating" &&
    status !== "claimed" &&
    status !== "submitted" &&
    status !== "failed" &&
    status !== "unknown"
  ) {
    throw incompatibleSchema(field);
  }
  return status;
}

/** Parses the public equation-mode enum shared by state and room responses. */
function parseGraphwarAgentEquationMode(value: unknown, field: string): EquationMode {
  const equationMode = requireString(value, field);
  if (equationMode !== "y" && equationMode !== "dy" && equationMode !== "ddy") {
    throw incompatibleSchema(field);
  }
  return equationMode;
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
      if (!soldier.isAlive) {
        continue;
      }
      const center = worldPointToShooterView(soldier.world.pixel, shooterTeam);
      soldiers.push({
        confidence: 1,
        isComputerControlled: player.isComputerControlled,
        isFriendly: player.team === shooterTeam,
        height: visualRadius * 2,
        hitRadius: GRAPHWAR_SOLDIER_RADIUS,
        id: `agent-player-${player.playerId}-soldier-${soldier.soldierIndex}`,
        kind: "soldier",
        isLocal: player.isLocal,
        mirrored: false,
        playerId: player.playerId,
        playerIndex: player.playerIndex,
        selectionRadius: visualRadius,
        sourceCenterX: center.x,
        sourceCenterY: center.y,
        soldierIndex: soldier.soldierIndex,
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
  return Boolean(player?.isLocal && !player.isComputerControlled && player.isConnected);
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

/** Requires an integer or the explicit null used for unavailable fixed-shape fields. */
function requireNullableInteger(value: unknown, field: string) {
  return value === null ? null : requireInteger(value, field);
}

/** Requires a string field. */
function requireString(value: unknown, field: string) {
  if (typeof value !== "string") {
    throw incompatibleSchema(field);
  }
  return value;
}

/** Requires the canonical lowercase UUID shape emitted by the v3 identity contract. */
function requireCanonicalUuid(value: unknown, field: string) {
  const identifier = requireString(value, field);
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(identifier)) {
    throw incompatibleSchema(field);
  }
  return identifier;
}

/** Requires the fixed lowercase SHA-256 revision shape used by state guards and ETags. */
function requireBattleRevision(value: unknown, field: string) {
  const revision = requireString(value, field);
  if (!/^sha256:[0-9a-f]{64}$/.test(revision)) {
    throw incompatibleSchema(field);
  }
  return revision;
}

/** Creates a consistent malformed-contract error. */
function incompatibleSchema(field: string) {
  return new GraphwarAgentClientError("incompatible", `Invalid Graphwar Agent field: ${field}`);
}
