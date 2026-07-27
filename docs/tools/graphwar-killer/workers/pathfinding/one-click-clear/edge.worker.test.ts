import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { GraphwarBackendAttemptIdentity } from "../../../core/algorithm-backend";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../../core/game/constants";
import { createPixelPoint } from "../../../core/types";
import type {
  GraphwarOneClickClearEdgeWorkerInit,
  GraphwarOneClickClearEdgeWorkerRequest,
  GraphwarOneClickClearEdgeWorkerResponse,
} from "../../../pathfinding/runtime/protocol";

const originalSelfDescriptor = Object.getOwnPropertyDescriptor(globalThis, "self");
const attempt = {
  attemptId: 1,
  backendGeneration: 0,
  outerTaskId: 1,
} satisfies GraphwarBackendAttemptIdentity;
const postMessage = vi.fn<(message: GraphwarOneClickClearEdgeWorkerResponse) => void>();
let handleMessage: ((event: MessageEvent<unknown>) => void) | undefined;

beforeAll(async () => {
  Object.defineProperty(globalThis, "self", {
    configurable: true,
    value: {
      addEventListener(type: string, listener: EventListener) {
        if (type === "message") {
          handleMessage = listener as (event: MessageEvent<unknown>) => void;
        }
      },
      postMessage,
    },
  });
  await import("./edge.worker");
});

afterAll(() => {
  if (originalSelfDescriptor) {
    Object.defineProperty(globalThis, "self", originalSelfDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "self");
  }
});

describe("One-Click Clear edge Worker initialization", () => {
  it("rejects a second init instead of rebinding the attempt context", async () => {
    const context = createContext();

    dispatch({ attempt, context, type: "init" });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
    expect(postMessage.mock.calls[0]?.[0]).toEqual({ attempt, type: "ready", workerIndex: 1 });

    dispatch({ attempt, context: { ...context, boundaryExpansion: 1 }, type: "init" });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));
    expect(postMessage.mock.calls[1]?.[0]).toEqual({
      attempt,
      message: "Edge worker was already initialized",
      type: "error",
      workerIndex: 1,
    });
  });
});

function dispatch(request: GraphwarOneClickClearEdgeWorkerRequest) {
  if (!handleMessage) {
    throw new Error("Edge worker message handler was not registered");
  }
  handleMessage({ data: request } as MessageEvent<unknown>);
}

function createContext() {
  return {
    bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
    boundsRect: { height: 450, width: 770, x: 0, y: 0 },
    boundaryExpansion: 0,
    routeMask: new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT),
    routeMode: "visibility-graph",
    routeOriginPoint: createPixelPoint(100, 225),
    routeTolerancePlanePixels: 2,
    settings: {
      algorithm: "abs",
      decimalPlaces: 4,
      equation: "y",
      steepness: 67,
    },
    workerIndex: 1,
  } satisfies GraphwarOneClickClearEdgeWorkerInit;
}
