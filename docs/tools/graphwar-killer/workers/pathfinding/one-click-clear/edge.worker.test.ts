import { afterAll, beforeAll, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { GraphwarBackendAttemptIdentity } from "../../../core/algorithm-backend";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../../core/game/constants";
import {
  createGraphwarStepRouteModel,
  createGraphwarStepRouteSummedArea,
} from "../../../pathfinding/routing/step-route";
import type { GraphwarStepRouteRuntime } from "../../../pathfinding/routing/step-route";
import { createGraphwarVisibilityGraphObstacleData } from "../../../pathfinding/routing/visibility-graph";
import type { GraphwarVisibilityGraphObstacleData } from "../../../pathfinding/routing/visibility-graph";
import type {
  GraphwarOneClickClearEdgeWorkerInit,
  GraphwarOneClickClearEdgeWorkerRequest,
  GraphwarOneClickClearEdgeWorkerResponse,
  GraphwarOneClickClearEdgeWorkerSharedInit,
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
  it("keeps route preprocessing and Step runtime atomic in the protocol", () => {
    type StatefulInit = Extract<GraphwarOneClickClearEdgeWorkerSharedInit, { type: "step-stateful" }>;
    type StatelessInit = Extract<GraphwarOneClickClearEdgeWorkerSharedInit, { type: "stateless" }>;
    type ThetaStarInit = Extract<GraphwarOneClickClearEdgeWorkerSharedInit, { routeMode: "theta-star" }>;
    type VisibilityGraphInit = Extract<GraphwarOneClickClearEdgeWorkerSharedInit, { routeMode: "visibility-graph" }>;

    expectTypeOf<StatefulInit["stepRouteRuntime"]>().toEqualTypeOf<GraphwarStepRouteRuntime>();
    expectTypeOf<StatelessInit["stepRouteRuntime"]>().toEqualTypeOf<undefined>();
    expectTypeOf<
      VisibilityGraphInit["visibilityGraphObstacleData"]
    >().toEqualTypeOf<GraphwarVisibilityGraphObstacleData>();
    expectTypeOf<ThetaStarInit["visibilityGraphObstacleData"]>().toEqualTypeOf<undefined>();
  });

  it("rejects a mismatched Step runtime and a second init", async () => {
    const context = createContext();

    dispatch({
      attempt,
      context: {
        ...context,
        stepRouteRuntime: { ...context.stepRouteRuntime, routeMask: context.routeMask.slice() },
      },
      type: "init",
    });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
    expect(postMessage.mock.calls[0]?.[0]).toEqual({
      attempt,
      message: "Step-stateful runtime does not match its route mask",
      type: "error",
      workerIndex: 1,
    });

    dispatch({ attempt, context, type: "init" });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));
    expect(postMessage.mock.calls[1]?.[0]).toEqual({ attempt, type: "ready", workerIndex: 1 });

    dispatch({ attempt, context: { ...context, boundaryExpansion: 1 }, type: "init" });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(3));
    expect(postMessage.mock.calls[2]?.[0]).toEqual({
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
  const bounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
  const routeMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
  const model = createGraphwarStepRouteModel(0, {
    decimalPlaces: 4,
    equation: "y",
    steepness: 67,
  });
  if (!model) {
    throw new Error("Expected valid Step route model");
  }
  return {
    bounds,
    boundsRect: { height: 450, width: 770, x: 0, y: 0 },
    boundaryExpansion: 0,
    routeMask,
    routeMode: "visibility-graph",
    routeTolerancePlanePixels: 2,
    stepRouteRuntime: {
      model,
      routeMask,
      summedArea: createGraphwarStepRouteSummedArea(routeMask),
    },
    type: "step-stateful",
    visibilityGraphObstacleData: createGraphwarVisibilityGraphObstacleData({
      bounds,
      routeMask,
      routeTolerancePlanePixels: 2,
    }),
    workerIndex: 1,
  } satisfies GraphwarOneClickClearEdgeWorkerInit;
}
