import { afterAll, beforeAll, describe, expect, it, type MockInstance, vi } from "vitest";

import type { GraphwarBackendAttemptIdentity, GraphwarBackendControlMessage } from "../../core/algorithm-backend";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { createPixelPoint } from "../../core/types";
import { readGraphwarKernelBytes } from "../../core/wasm/kernel-test-fixture";
import { GraphwarWasmKernelRuntime } from "../../core/wasm/runtime";
import type {
  GraphwarPathfindingWorkerRequest,
  GraphwarPathfindingWorkerResponse,
  GraphwarSmartPathfindingPathInput,
} from "../../pathfinding/runtime/protocol";

const mocks = vi.hoisted(() => ({
  buildThetaRoute: vi.fn(() => {
    throw new Error("TypeScript Theta* must not run for a WASM smart route");
  }),
  buildVisibilityRoute: vi.fn(() => {
    throw new Error("TypeScript visibility routing must not run for a WASM smart route");
  }),
}));

vi.mock("../../pathfinding/routing/theta-star", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../pathfinding/routing/theta-star")>()),
  buildGraphwarThetaStarPathForMask: mocks.buildThetaRoute,
}));

vi.mock("../../pathfinding/routing/visibility-graph", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../pathfinding/routing/visibility-graph")>()),
  buildGraphwarVisibilityGraphPathForMask: mocks.buildVisibilityRoute,
}));

const originalSelfDescriptor = Object.getOwnPropertyDescriptor(globalThis, "self");
const attempt = {
  attemptId: 1,
  backendGeneration: 9,
  outerTaskId: 1,
} satisfies GraphwarBackendAttemptIdentity;
const postMessage = vi.fn<(message: GraphwarBackendControlMessage | GraphwarPathfindingWorkerResponse) => void>();
let handleMessage: ((event: MessageEvent<unknown>) => void) | undefined;
let runRouteTask: MockInstance<GraphwarWasmKernelRuntime["runRouteTask"]>;

beforeAll(async () => {
  runRouteTask = vi.spyOn(GraphwarWasmKernelRuntime.prototype, "runRouteTask");
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
  await import("./main.worker");
  dispatch({
    backend: { module: await WebAssembly.compile(await readGraphwarKernelBytes()), type: "wasm" },
    backendExecution: { effective: "wasm", requested: "wasm" },
    generation: attempt.backendGeneration,
    role: "pathfinding-master",
    type: "backend-init",
  });
  await vi.waitFor(() =>
    expect(postMessage).toHaveBeenCalledWith({
      backend: "wasm",
      generation: attempt.backendGeneration,
      role: "pathfinding-master",
      type: "backend-ready",
    }),
  );
  postMessage.mockClear();
});

afterAll(() => {
  runRouteTask.mockRestore();
  if (originalSelfDescriptor) {
    Object.defineProperty(globalThis, "self", originalSelfDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "self");
  }
});

describe("Pathfinding master Worker WASM Step routing", () => {
  it("runs real command 9 and keeps mirrored preview coordinates in forward-grid form", async () => {
    const input = createMirroredStepInput();
    dispatch({ attempt, id: 31, task: { input, type: "find-smart-path" } });
    await vi.waitFor(() =>
      expect(
        postMessage.mock.calls.some(
          ([message]) => message.type === "success" && message.taskType === "find-smart-path",
        ),
      ).toBe(true),
    );

    const messages = postMessage.mock.calls.map(([message]) => message);
    const previews = messages.filter(
      (message): message is Extract<GraphwarPathfindingWorkerResponse, { type: "preview" }> =>
        message.type === "preview",
    );
    const result = messages.find(
      (
        message,
      ): message is Extract<GraphwarPathfindingWorkerResponse, { taskType: "find-smart-path"; type: "success" }> =>
        message.type === "success" && message.taskType === "find-smart-path",
    );
    expect(result).toBeDefined();
    expect(runRouteTask.mock.calls.filter(([command]) => command === 9)).toHaveLength(1);
    expect(previews.length).toBeGreaterThan(0);
    for (const { preview } of previews) {
      expect(preview.isMirrored).toBe(true);
      for (const [from, to] of preview.acceptedEdges) {
        expect(to.x).toBeGreaterThanOrEqual(from.x);
      }
    }
    expect(mocks.buildThetaRoute).not.toHaveBeenCalled();
    expect(mocks.buildVisibilityRoute).not.toHaveBeenCalled();
  });
});

function createMirroredStepInput(): GraphwarSmartPathfindingPathInput {
  const routeObstacleMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
  const sourcePoint = createPixelPoint(668.75, 225.25);
  const targetPoint = createPixelPoint(665.25, 225.75);
  return {
    boundaryExpansion: 0,
    bounds: { maxX: -25, maxY: 15, minX: 25, minY: -15 },
    boundsRect: { height: 450, width: 770, x: 0, y: 0 },
    hitTarget: { center: targetPoint, radius: 10 },
    isDeleteOptimizationEnabled: false,
    isPreviewEnabled: true,
    routeMaskCacheId: 1,
    routeMode: "theta-star",
    routeObstacleMask,
    routeTolerancePlanePixels: 0,
    settings: {
      algorithm: "step",
      decimalPlaces: 4,
      equation: "y",
      isStepGlitchModeEnabled: false,
      isStepOverflowProtectionEnabled: true,
      steepness: 2,
    },
    simulationBoundaryExpansion: 0,
    simulationMask: routeObstacleMask,
    simulationMaskCacheId: 1,
    sourcePath: [sourcePoint],
    targetPoint,
  };
}

function dispatch(request: GraphwarBackendControlMessage | GraphwarPathfindingWorkerRequest) {
  if (!handleMessage) {
    throw new Error("Pathfinding worker message handler was not registered");
  }
  handleMessage({ data: request } as MessageEvent<unknown>);
}
