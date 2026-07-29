import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GraphwarBackendAttemptIdentity, GraphwarBackendControlMessage } from "../../core/algorithm-backend";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { createGraphPoint, createPixelPoint } from "../../core/types";
import type {
  GraphwarStepGlitchFormulaBoundaryState,
  GraphwarStepGlitchFormulaPrefix,
} from "../../formula/trajectory/sampling";
import type {
  GraphwarOneClickClearBuildOptions,
  GraphwarOneClickClearIncumbent,
} from "../../pathfinding/one-click-clear/search";
import type {
  GraphwarStepGlitchPrefixEvidence,
  GraphwarStepGlitchReplayEvidence,
} from "../../pathfinding/routing/step-glitch-scan";
import type {
  GraphwarOneClickClearPathWorkerInput,
  GraphwarPathfindingWorkerRequest,
  GraphwarPathfindingWorkerResponse,
  GraphwarSmartPathfindingPathInput,
} from "../../pathfinding/runtime/protocol";

const mocks = vi.hoisted(() => ({
  buildOneClickClearPath: vi.fn(),
  scanStepGlitchPath: vi.fn(),
  validateTrajectory: vi.fn(),
}));

vi.mock("../../pathfinding/one-click-clear/search", () => ({
  buildGraphwarOneClickClearPath: mocks.buildOneClickClearPath,
}));

vi.mock("../../pathfinding/routing/step-glitch-scan", () => ({
  createGraphwarStepGlitchPrefixEvidence: vi.fn(
    (options: {
      acceptedPoint: ReturnType<typeof createGraphPoint>;
      formulaEvidence: GraphwarStepGlitchPrefixEvidence["formulaEvidence"];
      prefixTarget: GraphwarStepGlitchPrefixEvidence["replayIdentity"]["prefixTarget"];
      simulationBoundaryExpansion?: number;
      simulationMask: Uint8Array;
    }) => ({
      acceptedPoint: createGraphPoint(options.acceptedPoint.x, options.acceptedPoint.y),
      formulaEvidence: options.formulaEvidence,
      replayIdentity: {
        boundaryExpansion: Math.max(0, Math.floor(options.simulationBoundaryExpansion ?? 0)),
        prefixTarget: options.prefixTarget,
        simulationMask: options.simulationMask.slice(),
      },
    }),
  ),
  scanGraphwarStepGlitchPath: mocks.scanStepGlitchPath,
}));

vi.mock("../../pathfinding/smart/trajectory", () => ({
  createGraphwarSmartPathfindingTrajectoryResult: mocks.validateTrajectory,
}));

const originalSelfDescriptor = Object.getOwnPropertyDescriptor(globalThis, "self");
const attempt = {
  attemptId: 1,
  backendGeneration: 0,
  outerTaskId: 1,
} satisfies GraphwarBackendAttemptIdentity;
const postMessage = vi.fn<(message: GraphwarBackendControlMessage | GraphwarPathfindingWorkerResponse) => void>();
let handleMessage:
  | ((event: MessageEvent<GraphwarBackendControlMessage | GraphwarPathfindingWorkerRequest>) => void)
  | undefined;

beforeAll(async () => {
  Object.defineProperty(globalThis, "self", {
    configurable: true,
    value: {
      addEventListener: (
        type: "message",
        listener: (event: MessageEvent<GraphwarBackendControlMessage | GraphwarPathfindingWorkerRequest>) => void,
      ) => {
        if (type === "message") {
          handleMessage = listener;
        }
      },
      postMessage,
    },
  });
  await import("./main.worker");
  handleMessage?.({
    data: {
      backend: { type: "typescript" },
      generation: 0,
      role: "pathfinding-master",
      type: "backend-init",
    },
  } as MessageEvent<GraphwarBackendControlMessage>);
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
  postMessage.mockClear();
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
  mocks.buildOneClickClearPath.mockReset();
  mocks.scanStepGlitchPath.mockReset();
  mocks.validateTrajectory.mockReset();
  mocks.validateTrajectory.mockReturnValue({ reachesTargetBeforeObstacle: true, visiblePixels: [] });
});

describe("Anytime one-click-clear progress", () => {
  it("posts a validated incumbent before the final response with the same request id", async () => {
    const input = createOneClickClearInput();
    const incumbent: GraphwarOneClickClearIncumbent = {
      expression: "0",
      pathPoints: input.pathPoints.map((point) => createPixelPoint(point.x, point.y)),
      trajectoryPoints: input.pathPoints.map((point) => createPixelPoint(point.x, point.y)),
    };
    mocks.buildOneClickClearPath.mockImplementation(async (options: GraphwarOneClickClearBuildOptions) => {
      options.onValidatedIncumbent?.(incumbent);
      return {
        elapsedMs: 3,
        expression: incumbent.expression,
        expandedStates: 2,
        pathPoints: [...input.pathPoints],
        targetIds: ["target"],
        type: "success" as const,
      };
    });
    if (!handleMessage) {
      throw new Error("Pathfinding worker message handler was not registered");
    }

    handleMessage(
      new MessageEvent<GraphwarPathfindingWorkerRequest>("message", {
        data: {
          attempt,
          id: 41,
          task: {
            shouldCollectDiagnostics: true,
            input,
            shouldReportIncumbents: true,
            type: "build-one-click-clear-path",
          },
        },
      }),
    );
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));

    expect(postMessage.mock.calls[0]?.[0]).toMatchObject({
      attempt,
      id: 41,
      progress: {
        diagnostics: {
          counters: {
            incumbentReportCount: 1,
            incumbentTrajectoryPointLoad: incumbent.trajectoryPoints.length,
          },
        },
        incumbent,
      },
      type: "one-click-clear-incumbent",
    });
    expect(postMessage.mock.calls[1]?.[0]).toMatchObject({
      attempt,
      id: 41,
      result: {
        diagnostics: {
          counters: {
            incumbentReportCount: 1,
            incumbentTrajectoryPointLoad: incumbent.trajectoryPoints.length,
          },
        },
      },
      taskType: "build-one-click-clear-path",
      type: "success",
    });
  });

  it("keeps the incumbent callback disabled for ordinary one-click-clear requests", async () => {
    const input = createOneClickClearInput();
    mocks.buildOneClickClearPath.mockImplementation(async (options: GraphwarOneClickClearBuildOptions) => {
      expect(options.onValidatedIncumbent).toBeUndefined();
      return {
        elapsedMs: 1,
        expandedStates: 0,
        reason: "no-usable-target" as const,
        type: "failure" as const,
      };
    });
    if (!handleMessage) {
      throw new Error("Pathfinding worker message handler was not registered");
    }

    handleMessage(
      new MessageEvent<GraphwarPathfindingWorkerRequest>("message", {
        data: {
          attempt,
          id: 42,
          task: {
            input,
            shouldReportIncumbents: false,
            type: "build-one-click-clear-path",
          },
        },
      }),
    );
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));

    expect(postMessage.mock.calls[0]?.[0]).toMatchObject({
      attempt,
      id: 42,
      taskType: "build-one-click-clear-path",
      type: "success",
    });
  });

  it.each(["pchip", "akima"] as const)("passes a stateless %s task through the Worker adapter", async (algorithm) => {
    const input = createOneClickClearInput();
    input.settings = { ...input.settings, algorithm };
    mocks.buildOneClickClearPath.mockImplementation(async (options: GraphwarOneClickClearBuildOptions) => {
      expect(options.formulaMode?.settings.algorithm).toBe(algorithm);
      return {
        elapsedMs: 1,
        expandedStates: 0,
        reason: "no-usable-target" as const,
        type: "failure" as const,
      };
    });
    if (!handleMessage) {
      throw new Error("Pathfinding worker message handler was not registered");
    }

    handleMessage(
      new MessageEvent<GraphwarPathfindingWorkerRequest>("message", {
        data: {
          attempt,
          id: 43,
          task: {
            input,
            shouldReportIncumbents: false,
            type: "build-one-click-clear-path",
          },
        },
      }),
    );
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));

    expect(postMessage.mock.calls[0]?.[0]).toMatchObject({
      attempt,
      id: 43,
      result: { result: { reason: "no-usable-target", type: "failure" } },
      taskType: "build-one-click-clear-path",
      type: "success",
    });
  });

  it("reuses Step glitch evidence from a failed search whose incumbent may be retained", async () => {
    const input = createOneClickClearInput();
    const targetPoint = createPixelPoint(300, 225);
    const adoptedPath = [...input.pathPoints, targetPoint];
    const prefixTarget = { center: targetPoint, radius: 7 };
    input.settings = { ...input.settings, equation: "dy", isStepGlitchModeEnabled: true };
    input.simulationMask = new Uint8Array(770 * 450);
    input.simulationMaskCacheId = 904;
    mocks.buildOneClickClearPath
      .mockImplementationOnce(async (options: GraphwarOneClickClearBuildOptions) => {
        options.onValidatedStepGlitchPath?.({
          path: adoptedPath,
          prefixEvidence: {
            acceptedPoint: createGraphPoint(-5, 1),
            formulaEvidence: { prefix: createMockStepGlitchFormulaPrefix() },
            replayIdentity: {
              boundaryExpansion: input.simulationBoundaryExpansion,
              prefixTarget,
              simulationMask: input.simulationMask?.slice() ?? new Uint8Array(),
            },
          },
          targetSequence: [prefixTarget],
        });
        return { elapsedMs: 1, expandedStates: 1, reason: "no-usable-target", type: "failure" as const };
      })
      .mockImplementationOnce(async (options: GraphwarOneClickClearBuildOptions) => {
        expect(options.stepGlitchPrefixEvidence).toMatchObject({ acceptedPoint: createGraphPoint(-5, 1) });
        return { elapsedMs: 1, expandedStates: 0, reason: "no-candidate", type: "failure" as const };
      });

    if (!handleMessage) {
      throw new Error("Pathfinding worker message handler was not registered");
    }
    handleMessage(
      new MessageEvent<GraphwarPathfindingWorkerRequest>("message", {
        data: {
          attempt,
          id: 43,
          task: {
            input,
            shouldReportIncumbents: true,
            type: "build-one-click-clear-path",
          },
        },
      }),
    );
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));

    postMessage.mockClear();
    handleMessage(
      new MessageEvent<GraphwarPathfindingWorkerRequest>("message", {
        data: {
          attempt,
          id: 44,
          task: {
            input: { ...input, pathPoints: adoptedPath, prefixTarget },
            shouldReportIncumbents: true,
            type: "build-one-click-clear-path",
          },
        } satisfies GraphwarPathfindingWorkerRequest,
      }),
    );
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
  });
});

describe("Step glitch smart-path validation", () => {
  it("reuses the scanner replay when both validations share the same mask", async () => {
    const mask = createPlaneMask();
    const input = createStepGlitchInput(mask, mask);
    const path = [input.sourcePath[0], input.targetPoint];
    mockHit(path);

    const response = await dispatchSmartPathRequest(input);

    expect(mocks.validateTrajectory).not.toHaveBeenCalled();
    expect(response.result).toMatchObject({ path });
  });

  it("keeps the full trajectory validation when the formula mask differs", async () => {
    const input = createStepGlitchInput(createPlaneMask(), createPlaneMask());
    mockHit([input.sourcePath[0], input.targetPoint]);
    mocks.validateTrajectory.mockReturnValue({ reachesTargetBeforeObstacle: false, visiblePixels: [] });

    const response = await dispatchSmartPathRequest(input);

    expect(mocks.scanStepGlitchPath.mock.calls[0]?.[0].formulaMode.settings.stepGlitchObstacleMask).toBe(
      input.simulationMask,
    );
    expect(mocks.validateTrajectory).toHaveBeenCalledTimes(1);
    expect(response.result).toMatchObject({ failureReason: "trajectory" });
  });

  it("still rejects a scanner path that violates the Graph x rule", async () => {
    const mask = createPlaneMask();
    const input = createStepGlitchInput(mask, mask);
    mockHit([input.targetPoint, input.sourcePath[0]]);

    const response = await dispatchSmartPathRequest(input);

    expect(mocks.validateTrajectory).not.toHaveBeenCalled();
    expect(response.result).toMatchObject({ failureReason: "graph-rule" });
  });

  it("reuses the last exact successful formula across an irrelevant settings change", async () => {
    const mask = createPlaneMask();
    const first = createStepGlitchInput(mask, mask);
    first.simulationMaskCacheId = 701;
    const firstPath = [first.sourcePath[0], first.targetPoint];
    const formulaPoints = [createGraphPoint(-10, 0), createGraphPoint(-5, 1)];
    const stepGlitchFormulaPrefix: GraphwarStepGlitchFormulaPrefix = {
      bounds: { ...first.bounds },
      initialFormulaPoints: formulaPoints,
      points: formulaPoints,
      refinedFormulaPoints: formulaPoints,
      segmentStartPoints: [undefined],
      settings: { ...first.settings },
      signProtection: [],
      stepGlitchRequirements: [false],
      stepGlitchSegments: [undefined],
      stepSegmentDeltaYs: [undefined],
    };
    mockHit(firstPath, stepGlitchFormulaPrefix);
    await dispatchSmartPathRequest(first);

    postMessage.mockClear();
    const secondTarget = createPixelPoint(300, 225);
    const second: GraphwarSmartPathfindingPathInput = {
      ...first,
      hitTarget: { center: secondTarget, radius: 10 },
      prefixTarget: first.hitTarget,
      settings: { ...first.settings, secondOrderLaunchAngleMode: "display-rounded" },
      sourcePath: firstPath,
      targetPoint: secondTarget,
    };
    mockHit([...firstPath, secondTarget]);

    await dispatchSmartPathRequest(second);

    expect(mocks.scanStepGlitchPath).toHaveBeenCalledTimes(2);
    expect(mocks.scanStepGlitchPath.mock.calls[1]?.[0]).toMatchObject({
      prefixEvidence: {
        acceptedPoint: createGraphPoint(0, 0),
        formulaEvidence: { prefix: { points: formulaPoints, settings: second.settings } },
      },
    });
    expect(mocks.scanStepGlitchPath.mock.calls[1]?.[0].prefixEvidence?.formulaEvidence).not.toHaveProperty(
      "boundaryState",
    );
  });

  it("rejects prefix evidence after an effective settings change", async () => {
    const mask = createPlaneMask();
    const first = createStepGlitchInput(mask, mask);
    first.simulationMaskCacheId = 731;
    const firstPath = [first.sourcePath[0], first.targetPoint];
    mockHit(firstPath);
    await dispatchSmartPathRequest(first);

    postMessage.mockClear();
    const secondTarget = createPixelPoint(300, 225);
    const changed: GraphwarSmartPathfindingPathInput = {
      ...first,
      hitTarget: { center: secondTarget, radius: 10 },
      prefixTarget: first.hitTarget,
      settings: { ...first.settings, steepness: first.settings.steepness + 1 },
      sourcePath: firstPath,
      targetPoint: secondTarget,
    };
    mockHit([...firstPath, secondTarget]);

    await dispatchSmartPathRequest(changed);

    expect(mocks.scanStepGlitchPath.mock.calls[1]?.[0]).not.toHaveProperty("prefixEvidence");
  });

  it("reuses prefix evidence when the previous target was an ordinary point", async () => {
    const mask = createPlaneMask();
    const first = createStepGlitchInput(mask, mask);
    first.simulationMaskCacheId = 751;
    const firstPath = [first.sourcePath[0], first.targetPoint];
    mockHit(firstPath);
    await dispatchSmartPathRequest(first);

    postMessage.mockClear();
    const secondTarget = createPixelPoint(300, 225);
    const second: GraphwarSmartPathfindingPathInput = {
      ...first,
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
    const mask = createPlaneMask();
    const first = createStepGlitchInput(mask, mask);
    first.simulationMaskCacheId = 801;
    const firstPath = [first.sourcePath[0], first.targetPoint];
    mockHit(firstPath);
    await dispatchSmartPathRequest(first);

    postMessage.mockClear();
    const nextTarget = createPixelPoint(300, 225);
    const changedMask: GraphwarSmartPathfindingPathInput = {
      ...first,
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
    isDeleteOptimizationEnabled: false,
    hitTarget: { center: createPixelPoint(200, 225), radius: 10 },
    isPreviewEnabled: false,
    routeMaskCacheId: 1,
    routeMode: "visibility-graph",
    routeObstacleMask: createPlaneMask(),
    routeTolerancePlanePixels: 2,
    settings: {
      algorithm: "step",
      decimalPlaces: 4,
      equation: "dy",
      steepness: 67,
      isStepGlitchModeEnabled: true,
      stepGlitchObstacleMask: formulaMask,
      isStepOverflowProtectionEnabled: true,
    },
    simulationBoundaryExpansion: 0,
    simulationMask,
    simulationMaskCacheId: 1,
    sourcePath: [sourcePoint],
    targetPoint: createPixelPoint(200, 225),
  };
}

/** 构造不触发 Step 前缀校验的一键清图 Worker 输入。 */
function createOneClickClearInput(): GraphwarOneClickClearPathWorkerInput {
  return {
    boundaryExpansion: 0,
    bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
    boundsRect: { height: 450, width: 770, x: 0, y: 0 },
    candidates: [],
    dagEdgeWorkerCount: 1,
    isDeleteOptimizationEnabled: false,
    deleteHitCheckRadiusPixels: 0,
    hitCandidates: [],
    pathPoints: [createPixelPoint(100, 225), createPixelPoint(200, 225)],
    routeMaskCacheId: 1,
    routeMode: "visibility-graph",
    routeObstacleMask: new Uint8Array(770 * 450),
    routeTolerancePlanePixels: 2,
    settings: {
      algorithm: "abs",
      decimalPlaces: 4,
      equation: "y",
      steepness: 67,
      isStepGlitchModeEnabled: false,
      isStepOverflowProtectionEnabled: true,
    },
    simulationBoundaryExpansion: 0,
    simulationMaskCacheId: 0,
  };
}

function createPlaneMask() {
  return new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
}

/** 让邪道 scanner 返回一条已完整回放成功的精确路径。 */
function mockHit(
  path: GraphwarSmartPathfindingPathInput["sourcePath"],
  stepGlitchFormulaPrefix?: GraphwarStepGlitchFormulaPrefix,
) {
  const prefix = stepGlitchFormulaPrefix ?? createMockStepGlitchFormulaPrefix();
  const boundaryState = { prefix } as unknown as GraphwarStepGlitchFormulaBoundaryState;
  mocks.scanStepGlitchPath.mockReturnValue({
    acceptedPoint: createGraphPoint(0, 0),
    expandedStates: 1,
    path,
    reachedTargetCount: 1,
    replayEvidence: {
      formulaContext: {
        stepGlitchFormulaEvidence: { boundaryState, prefix },
      } as unknown as GraphwarStepGlitchReplayEvidence["formulaContext"],
      trajectoryPoints: path,
    },
    status: "hit",
    timings: [],
  });
}

/** Worker 单元测试只消费 formula evidence 身份，其余 prefix 数值由 scanner 专项测试覆盖。 */
function createMockStepGlitchFormulaPrefix() {
  return { points: [], settings: {} } as unknown as GraphwarStepGlitchFormulaPrefix;
}

async function dispatchSmartPathRequest(input: GraphwarSmartPathfindingPathInput) {
  if (!handleMessage) {
    throw new Error("Pathfinding worker message handler was not registered");
  }

  handleMessage({
    data: {
      attempt,
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
