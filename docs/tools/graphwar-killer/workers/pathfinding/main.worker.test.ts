import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createGraphPoint, createPixelPoint } from "../../core/types";
import type {
  GraphwarPathfindingWorkerRequest,
  GraphwarPathfindingWorkerResponse,
  GraphwarSmartPathfindingPathInput,
} from "../../pathfinding/runtime/protocol";

const mocks = vi.hoisted(() => ({
  scanStepGlitchPath: vi.fn(),
  validateTrajectory: vi.fn(),
}));

vi.mock("../../pathfinding/routing/step-glitch-scan", () => ({
  scanGraphwarStepGlitchPath: mocks.scanStepGlitchPath,
}));

vi.mock("../../pathfinding/smart/trajectory", () => ({
  createGraphwarSmartPathfindingTrajectoryResult: mocks.validateTrajectory,
}));

const originalSelfDescriptor = Object.getOwnPropertyDescriptor(globalThis, "self");
const postMessage = vi.fn<(message: GraphwarPathfindingWorkerResponse) => void>();
let handleMessage: ((event: MessageEvent<GraphwarPathfindingWorkerRequest>) => void) | undefined;

beforeAll(async () => {
  Object.defineProperty(globalThis, "self", {
    configurable: true,
    value: {
      addEventListener: (
        type: "message",
        listener: (event: MessageEvent<GraphwarPathfindingWorkerRequest>) => void,
      ) => {
        if (type === "message") {
          handleMessage = listener;
        }
      },
      postMessage,
    },
  });
  await import("./main.worker");
});

afterAll(() => {
  if (originalSelfDescriptor) {
    Object.defineProperty(globalThis, "self", originalSelfDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "self");
  }
});

beforeEach(() => {
  postMessage.mockClear();
  mocks.scanStepGlitchPath.mockReset();
  mocks.validateTrajectory.mockReset();
  mocks.validateTrajectory.mockReturnValue({ reachesTargetBeforeObstacle: true, visiblePixels: [] });
});

describe("Step glitch smart-path validation", () => {
  it("reuses the scanner replay when both validations share the same mask", async () => {
    const mask = new Uint8Array(1);
    const input = createStepGlitchInput(mask, mask);
    const path = [input.sourcePath[0], input.targetPoint];
    mockHit(path);

    const response = await dispatchSmartPathRequest(input);

    expect(mocks.validateTrajectory).not.toHaveBeenCalled();
    expect(response.result).toMatchObject({ path });
  });

  it("keeps the full trajectory validation when the formula mask differs", async () => {
    const input = createStepGlitchInput(new Uint8Array(1), new Uint8Array(1));
    mockHit([input.sourcePath[0], input.targetPoint]);
    mocks.validateTrajectory.mockReturnValue({ reachesTargetBeforeObstacle: false, visiblePixels: [] });

    const response = await dispatchSmartPathRequest(input);

    expect(mocks.validateTrajectory).toHaveBeenCalledTimes(1);
    expect(response.result).toMatchObject({ failureReason: "trajectory" });
  });

  it("still rejects a scanner path that violates the Graph x rule", async () => {
    const mask = new Uint8Array(1);
    const input = createStepGlitchInput(mask, mask);
    mockHit([input.targetPoint, input.sourcePath[0]]);

    const response = await dispatchSmartPathRequest(input);

    expect(mocks.validateTrajectory).not.toHaveBeenCalled();
    expect(response.result).toMatchObject({ failureReason: "graph-rule" });
  });

  it("reuses the last exact successful formula as the next scanner prefix", async () => {
    const mask = new Uint8Array(1);
    const first = createStepGlitchInput(mask, mask);
    first.simulationMaskCacheId = 701;
    const firstPath = [first.sourcePath[0], first.targetPoint];
    mockHit(firstPath);
    await dispatchSmartPathRequest(first);

    postMessage.mockClear();
    const secondTarget = createPixelPoint(300, 225);
    const second: GraphwarSmartPathfindingPathInput = {
      ...first,
      committedTargets: [{ anchor: first.targetPoint, hitCircle: first.hitTarget }],
      hitTarget: { center: secondTarget, radius: 10 },
      prefixTarget: first.hitTarget,
      sourcePath: firstPath,
      targetPoint: secondTarget,
    };
    mockHit([...firstPath, secondTarget]);

    await dispatchSmartPathRequest(second);

    expect(mocks.scanStepGlitchPath).toHaveBeenCalledTimes(2);
    expect(mocks.scanStepGlitchPath.mock.calls[1]?.[0]).toMatchObject({
      prefixEvidence: { acceptedPoint: createGraphPoint(0, 0) },
    });
  });

  it("reuses prefix evidence when the previous target was an ordinary point", async () => {
    const mask = new Uint8Array(1);
    const first = createStepGlitchInput(mask, mask);
    first.simulationMaskCacheId = 751;
    const firstPath = [first.sourcePath[0], first.targetPoint];
    mockHit(firstPath);
    await dispatchSmartPathRequest(first);

    postMessage.mockClear();
    const secondTarget = createPixelPoint(300, 225);
    const second: GraphwarSmartPathfindingPathInput = {
      ...first,
      committedTargets: [],
      hitTarget: { center: secondTarget, radius: 10 },
      prefixTarget: first.hitTarget,
      sourcePath: firstPath,
      targetPoint: secondTarget,
    };
    mockHit([...firstPath, secondTarget]);

    await dispatchSmartPathRequest(second);

    expect(mocks.scanStepGlitchPath.mock.calls[1]?.[0]).toMatchObject({
      prefixEvidence: { acceptedPoint: createGraphPoint(0, 0) },
    });
  });

  it("rejects prefix evidence after the simulation mask id changes", async () => {
    const mask = new Uint8Array(1);
    const first = createStepGlitchInput(mask, mask);
    first.simulationMaskCacheId = 801;
    const firstPath = [first.sourcePath[0], first.targetPoint];
    mockHit(firstPath);
    await dispatchSmartPathRequest(first);

    postMessage.mockClear();
    const nextTarget = createPixelPoint(300, 225);
    const changedMask: GraphwarSmartPathfindingPathInput = {
      ...first,
      committedTargets: [{ anchor: first.targetPoint, hitCircle: first.hitTarget }],
      hitTarget: { center: nextTarget, radius: 10 },
      prefixTarget: first.hitTarget,
      simulationMaskCacheId: 802,
      sourcePath: firstPath,
      targetPoint: nextTarget,
    };
    mockHit([...firstPath, nextTarget]);

    await dispatchSmartPathRequest(changedMask);

    expect(mocks.scanStepGlitchPath.mock.calls[1]?.[0]).not.toHaveProperty("prefixEvidence");
  });
});

function createStepGlitchInput(simulationMask: Uint8Array, formulaMask: Uint8Array): GraphwarSmartPathfindingPathInput {
  const sourcePoint = createPixelPoint(100, 225);
  return {
    boundaryExpansion: 0,
    bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
    boundsRect: { height: 450, width: 770, x: 0, y: 0 },
    committedTargets: [],
    hitTarget: { center: createPixelPoint(200, 225), radius: 10 },
    previewEnabled: false,
    routeMaskCacheId: 1,
    routeMode: "visibility-graph",
    routeObstacleMask: new Uint8Array(1),
    routeTolerancePlanePixels: 2,
    settings: {
      algorithm: "step",
      decimalPlaces: 4,
      equation: "dy",
      steepness: 67,
      stepGlitchMode: true,
      stepGlitchObstacleMask: formulaMask,
      stepOverflowProtection: true,
    },
    simulationBoundaryExpansion: 0,
    simulationMask,
    simulationMaskCacheId: 1,
    sourcePath: [sourcePoint],
    targetPoint: createPixelPoint(200, 225),
  };
}

function mockHit(path: GraphwarSmartPathfindingPathInput["sourcePath"]) {
  mocks.scanStepGlitchPath.mockReturnValue({
    acceptedPoint: createGraphPoint(0, 0),
    expandedStates: 1,
    path,
    reachedTargetCount: 1,
    status: "hit",
    timings: [],
  });
}

async function dispatchSmartPathRequest(input: GraphwarSmartPathfindingPathInput) {
  if (!handleMessage) {
    throw new Error("Pathfinding worker message handler was not registered");
  }

  handleMessage({
    data: {
      id: 1,
      task: { input, type: "find-smart-path" },
    },
  } as MessageEvent<GraphwarPathfindingWorkerRequest>);
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
  const response = postMessage.mock.calls[0]?.[0];
  if (!response || response.type !== "success" || response.taskType !== "find-smart-path") {
    throw new Error("Expected a successful smart-path worker response");
  }
  return response;
}
