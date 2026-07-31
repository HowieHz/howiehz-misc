import { afterAll, beforeAll, describe, expect, it, type MockInstance, vi } from "vitest";

import type { GraphwarBackendAttemptIdentity, GraphwarBackendControlMessage } from "../../../core/algorithm-backend";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../../core/game/constants";
import { createPixelPoint } from "../../../core/types";
import { readGraphwarKernelBytes } from "../../../core/wasm/kernel-test-fixture";
import { GraphwarWasmKernelRuntime } from "../../../core/wasm/runtime";
import {
  createGraphwarStepRouteModel,
  createGraphwarStepRouteSummedArea,
} from "../../../pathfinding/routing/step-route";
import { createGraphwarVisibilityGraphObstacleData } from "../../../pathfinding/routing/visibility-graph";
import type {
  GraphwarOneClickClearEdgeWorkerRequest,
  GraphwarOneClickClearEdgeWorkerResponse,
} from "../../../pathfinding/runtime/protocol";

const mocks = vi.hoisted(() => ({
  buildThetaRoute: vi.fn(() => {
    throw new Error("TypeScript Theta* must not run for a WASM edge job");
  }),
  buildVisibilityRoute: vi.fn(() => {
    throw new Error("TypeScript visibility routing must not run for a WASM edge job");
  }),
}));

vi.mock("../../../pathfinding/routing/theta-star", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../pathfinding/routing/theta-star")>()),
  buildGraphwarThetaStarPathForMask: mocks.buildThetaRoute,
}));

vi.mock("../../../pathfinding/routing/visibility-graph", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../pathfinding/routing/visibility-graph")>()),
  buildGraphwarVisibilityGraphPathForMask: mocks.buildVisibilityRoute,
}));

const originalSelfDescriptor = Object.getOwnPropertyDescriptor(globalThis, "self");
const attempt = {
  attemptId: 1,
  backendGeneration: 7,
  outerTaskId: 1,
} satisfies GraphwarBackendAttemptIdentity;
const session = { backendGeneration: 7, nonce: 1, requestId: 1, taskType: "one-click-clear" as const };
const postMessage = vi.fn<(message: GraphwarBackendControlMessage | GraphwarOneClickClearEdgeWorkerResponse) => void>();
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
  await import("./edge.worker");
  dispatch({
    backend: { module: await WebAssembly.compile(await readGraphwarKernelBytes()), type: "wasm" },
    backendExecution: { effective: "wasm", requested: "wasm" },
    generation: attempt.backendGeneration,
    role: "one-click-clear-edge",
    type: "backend-init",
  });
  await vi.waitFor(() =>
    expect(postMessage).toHaveBeenCalledWith({
      backend: "wasm",
      generation: attempt.backendGeneration,
      role: "one-click-clear-edge",
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

describe("One-Click Clear edge Worker WASM routing", () => {
  it("retains one Step context and runs real command 10 for repeated exact-state jobs", async () => {
    const routeState = 0x1_0000_0000_0000_0001n;
    const routeStateKey = routeState.toString();
    const bounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
    const boundsRect = { height: 450, width: 770, x: 0, y: 0 };
    const routeMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    const model = createGraphwarStepRouteModel(-Number(routeState) / 10 ** 4, {
      decimalPlaces: 4,
      equation: "y",
      formulaPathSteepness: 2,
      steepness: 2,
    });
    if (!model) {
      throw new Error("Expected valid Step route model");
    }
    const context = {
      bounds,
      boundsRect,
      boundaryExpansion: 0,
      routeOriginPoint: createPixelPoint(100.25, 225.25),
      routeMask,
      routeMode: "visibility-graph" as const,
      routeTolerancePlanePixels: 4,
      stepRouteRuntime: {
        model,
        routeMask,
        summedArea: createGraphwarStepRouteSummedArea(routeMask),
      },
      type: "step-stateful" as const,
      routePreprocessing: { type: "wasm" as const },
      workerIndex: 2,
    };
    const faultMessage = "Edge worker visibility preprocessing does not match its algorithm backend";
    dispatch({
      attempt,
      context: {
        ...context,
        routePreprocessing: {
          type: "typescript",
          visibilityGraphObstacleData: createGraphwarVisibilityGraphObstacleData({
            bounds,
            routeMask,
            routeTolerancePlanePixels: context.routeTolerancePlanePixels,
          }),
        },
      },
      session,
      type: "init",
    });
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith({
        context: { attempt, session, type: "edge-session" },
        fault: { code: "abi", message: faultMessage },
        generation: attempt.backendGeneration,
        role: "one-click-clear-edge",
        type: "wasm-fault",
      }),
    );
    postMessage.mockClear();

    const routeMaskFaultMessage = "Step-stateful runtime does not match its route mask";
    dispatch({
      attempt,
      context: {
        ...context,
        stepRouteRuntime: { ...context.stepRouteRuntime, routeMask: routeMask.slice() },
      },
      session,
      type: "init",
    });
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith({
        context: { attempt, session, type: "edge-session" },
        fault: { code: "abi", message: routeMaskFaultMessage },
        generation: attempt.backendGeneration,
        role: "one-click-clear-edge",
        type: "wasm-fault",
      }),
    );
    postMessage.mockClear();

    dispatch({ attempt, context, session, type: "init" });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ attempt, type: "ready", workerIndex: 2 }));

    const job = {
      from: -1,
      id: 5,
      startPoint: context.routeOriginPoint,
      stepRouteStartState: { resolvedStateKey: routeStateKey, resolvedY: 0 },
      targetPoint: createPixelPoint(103.75, 225.75),
      to: 0,
      type: "step-stateful" as const,
    };

    dispatch({
      attempt,
      job: {
        from: job.from,
        id: 3,
        startPoint: job.startPoint,
        targetPoint: job.targetPoint,
        to: job.to,
        type: "stateless",
      },
      requestId: 9,
      session,
      type: "job",
    });
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith({
        context: { attempt, jobId: 3, session, type: "edge-job" },
        fault: { code: "abi", message: "Edge worker job route policy does not match its initialized policy" },
        generation: attempt.backendGeneration,
        role: "one-click-clear-edge",
        type: "wasm-fault",
      }),
    );
    postMessage.mockClear();

    dispatch({
      attempt,
      job: {
        ...job,
        id: 4,
        stepRouteStartState: { resolvedStateKey: "01", resolvedY: 0 },
      },
      requestId: 10,
      session,
      type: "job",
    });
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith({
        context: { attempt, jobId: 4, session, type: "edge-job" },
        fault: { code: "abi", message: "One-Click Clear edge job has an invalid canonical Step state" },
        generation: attempt.backendGeneration,
        role: "one-click-clear-edge",
        type: "wasm-fault",
      }),
    );
    postMessage.mockClear();

    dispatch({ attempt, job, requestId: 11, session, type: "job" });
    await vi.waitFor(() =>
      expect(postMessage.mock.calls.filter(([message]) => message.type === "job-result")).toHaveLength(1),
    );
    dispatch({ attempt, job: { ...job, id: 6 }, requestId: 12, session, type: "job" });
    await vi.waitFor(() =>
      expect(postMessage.mock.calls.filter(([message]) => message.type === "job-result")).toHaveLength(2),
    );

    const jobResults = postMessage.mock.calls
      .map(([message]) => message)
      .filter(
        (message): message is Extract<GraphwarOneClickClearEdgeWorkerResponse, { type: "job-result" }> =>
          message.type === "job-result",
      );
    for (const response of jobResults) {
      expect(response.result.route?.[0]).toEqual(job.startPoint);
      expect(response.result.route?.at(-1)).toEqual(job.targetPoint);
      expect(BigInt(response.result.stepRouteEndState?.resolvedStateKey ?? "0")).toBeGreaterThan(
        0x7fff_ffff_ffff_ffffn,
      );
    }
    expect(runRouteTask.mock.calls.filter(([command]) => command === 1)).toHaveLength(1);
    expect(runRouteTask.mock.calls.filter(([command]) => command === 10)).toHaveLength(2);
    const createContextCallIndex = runRouteTask.mock.calls.findIndex(([command]) => command === 1);
    const createContextCall = runRouteTask.mock.calls[createContextCallIndex];
    const runtime = runRouteTask.mock.instances[createContextCallIndex];
    if (!createContextCall || !(runtime instanceof GraphwarWasmKernelRuntime)) {
      throw new Error("Expected retained route-context command");
    }
    const createInputPointer = createContextCall[1];
    const createInputView = new DataView(runtime.buffer, createInputPointer, 52);
    const contextValuesPointer = createInputView.getUint32(8, true);
    expect(createInputView.getUint32(48, true)).toBe(1);
    expect(new Float64Array(runtime.buffer, contextValuesPointer, 14)[9]).toBe(4);
    expect(mocks.buildThetaRoute).not.toHaveBeenCalled();
    expect(mocks.buildVisibilityRoute).not.toHaveBeenCalled();
  });
});

function dispatch(request: GraphwarBackendControlMessage | GraphwarOneClickClearEdgeWorkerRequest) {
  if (!handleMessage) {
    throw new Error("Edge worker message handler was not registered");
  }
  handleMessage({ data: request } as MessageEvent<unknown>);
}
