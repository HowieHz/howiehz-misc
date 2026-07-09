import {
  GRAPHWAR_PLANE_HEIGHT,
  GRAPHWAR_PLANE_LENGTH,
  GRAPHWAR_SOLDIER_RADIUS,
  GRAPHWAR_SOLDIER_VISIBLE_SIZE,
} from "../../core/game/constants";
import { createPixelPoint, type BoundsRect, type EquationMode } from "../../core/types";
import {
  countObstacleMaskComponents,
  type GraphwarDetectionBox,
  type GraphwarObjectsDetectionResult,
} from "../../detection/objects";

export const GRAPHWAR_AGENT_DEFAULT_BASE_URL = "http://127.0.0.1:17900";

interface GraphwarAgentPoint {
  pixel?: {
    x?: unknown;
    y?: unknown;
  };
}

interface GraphwarAgentSoldier {
  alive?: unknown;
  index?: unknown;
  view?: GraphwarAgentPoint;
}

interface GraphwarAgentPlayer {
  index?: unknown;
  soldiers?: unknown;
}

interface GraphwarAgentState {
  available?: unknown;
  gameMode?: unknown;
  obstacleMask?: {
    viewUrl?: unknown;
  };
  plane?: {
    width?: unknown;
    height?: unknown;
  };
  players?: unknown;
  reason?: unknown;
}

export interface GraphwarAgentSnapshot {
  /** Normalized base URL used for subsequent reads. */
  baseUrl: string;
  /** Detection result adapted to Graphwar Killer's existing state model. */
  detectionResult: GraphwarObjectsDetectionResult;
  /** Current game mode mapped from Graphwar constants when available. */
  equationMode?: EquationMode;
  /** Fixed 770x450 canvas bounds used for direct Agent state. */
  boundsRect: BoundsRect;
  /** Synthetic image name shown in the screenshot panel. */
  imageName: string;
  /** White 770x450 canvas; all real data is rendered through overlays. */
  imageUrl: string;
}

export async function readGraphwarAgentSnapshot(baseUrlText: string): Promise<GraphwarAgentSnapshot> {
  const baseUrl = normalizeGraphwarAgentBaseUrl(baseUrlText);
  const state = await fetchGraphwarAgentState(baseUrl);
  assertSupportedState(state);

  if (state.available !== true) {
    throw new Error(typeof state.reason === "string" ? state.reason : "Graphwar state is unavailable");
  }

  const mask = await fetchGraphwarAgentObstacleMask(baseUrl, state);
  const boundsRect = createGraphwarAgentBoundsRect();
  return {
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    boundsRect,
    detectionResult: {
      obstacles: {
        count: countObstacleMaskComponents(mask),
        mask,
      },
      soldiers: createGraphwarAgentSoldierBoxes(state),
    },
    equationMode: getGraphwarAgentEquationMode(state.gameMode),
    imageName: "Graphwar Agent",
    imageUrl: createGraphwarAgentCanvasDataUrl(),
  };
}

export async function submitGraphwarAgentFunction(baseUrlText: string, functionText: string) {
  const baseUrl = normalizeGraphwarAgentBaseUrl(baseUrlText);
  const response = await fetch(new URL("function", baseUrl), {
    body: functionText,
    cache: "no-store",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await createResponseErrorMessage(response));
  }

  return baseUrl.toString().replace(/\/$/, "");
}

function normalizeGraphwarAgentBaseUrl(baseUrlText: string) {
  const trimmed = baseUrlText.trim() || GRAPHWAR_AGENT_DEFAULT_BASE_URL;
  const withProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withProtocol);
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }
  return url;
}

async function fetchGraphwarAgentState(baseUrl: URL): Promise<GraphwarAgentState> {
  const response = await fetch(new URL("state", baseUrl), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await createResponseErrorMessage(response));
  }
  return (await response.json()) as GraphwarAgentState;
}

async function fetchGraphwarAgentObstacleMask(baseUrl: URL, state: GraphwarAgentState) {
  const expectedLength = GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT;
  const path =
    typeof state.obstacleMask?.viewUrl === "string" ? state.obstacleMask.viewUrl : "obstacle-mask.bin?space=view";
  const response = await fetch(new URL(path, baseUrl), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await createResponseErrorMessage(response));
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== expectedLength) {
    throw new Error(`Unexpected obstacle data size: ${buffer.byteLength}, expected ${expectedLength}`);
  }

  const source = new Uint8Array(buffer);
  const mask = new Uint8Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    mask[index] = source[index] === 0 ? 0 : 1;
  }
  return mask;
}

async function createResponseErrorMessage(response: Response) {
  const text = (await response.text()).trim();
  return text || `HTTP ${response.status}`;
}

function assertSupportedState(state: GraphwarAgentState) {
  const width = Number(state.plane?.width);
  const height = Number(state.plane?.height);
  if (width !== GRAPHWAR_PLANE_LENGTH || height !== GRAPHWAR_PLANE_HEIGHT) {
    throw new Error(`Unsupported Graphwar plane: ${width}x${height}`);
  }
}

function createGraphwarAgentSoldierBoxes(state: GraphwarAgentState): GraphwarDetectionBox[] {
  const players = Array.isArray(state.players) ? (state.players as GraphwarAgentPlayer[]) : [];
  const soldiers: GraphwarDetectionBox[] = [];
  const visualRadius = GRAPHWAR_SOLDIER_VISIBLE_SIZE / 2;

  for (let playerIndex = 0; playerIndex < players.length; playerIndex += 1) {
    const player = players[playerIndex];
    const playerSoldiers = Array.isArray(player.soldiers) ? (player.soldiers as GraphwarAgentSoldier[]) : [];
    for (let soldierIndex = 0; soldierIndex < playerSoldiers.length; soldierIndex += 1) {
      const soldier = playerSoldiers[soldierIndex];
      // Agent targets should be killable soldiers. Graphwar may still render
      // exploding dead soldiers for a short death animation.
      if (soldier.alive !== true) {
        continue;
      }

      const center = readAgentSoldierViewPoint(soldier);
      if (!center) {
        continue;
      }

      soldiers.push({
        confidence: 1,
        height: visualRadius * 2,
        hitRadius: GRAPHWAR_SOLDIER_RADIUS,
        id: `agent-player-${readStableIndex(player.index, playerIndex)}-soldier-${readStableIndex(soldier.index, soldierIndex)}`,
        kind: "soldier",
        mirrored: false,
        selectionRadius: visualRadius,
        sourceCenterX: center.x,
        sourceCenterY: center.y,
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

function readAgentSoldierViewPoint(soldier: GraphwarAgentSoldier) {
  const x = Number(soldier.view?.pixel?.x);
  const y = Number(soldier.view?.pixel?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined;
  }
  return createPixelPoint(x, y);
}

function readStableIndex(value: unknown, fallback: number) {
  return Number.isInteger(value) ? Number(value) : fallback;
}

function getGraphwarAgentEquationMode(gameMode: unknown): EquationMode | undefined {
  if (gameMode === 0) {
    return "y";
  }
  if (gameMode === 1) {
    return "dy";
  }
  if (gameMode === 2) {
    return "ddy";
  }
  return undefined;
}

function createGraphwarAgentBoundsRect(): BoundsRect {
  return {
    height: GRAPHWAR_PLANE_HEIGHT,
    width: GRAPHWAR_PLANE_LENGTH,
    x: 0,
    y: 0,
  };
}

function createGraphwarAgentCanvasDataUrl() {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${GRAPHWAR_PLANE_LENGTH}" height="${GRAPHWAR_PLANE_HEIGHT}" viewBox="0 0 ${GRAPHWAR_PLANE_LENGTH} ${GRAPHWAR_PLANE_HEIGHT}">`,
    '<rect width="100%" height="100%" fill="#ffffff"/>',
    "</svg>",
  ].join("");
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
