import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GraphwarValidatedWasmRuntime,
  type GraphwarBackendAttemptIdentity,
  type GraphwarBackendControlMessage,
} from "../../core/algorithm-backend";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { imageToGraphPoint } from "../../core/geometry";
import { createGraphPoint, createPixelPoint } from "../../core/types";
import { GraphwarWasmAdapterError } from "../../core/wasm/abi";
import type { GraphwarWasmKernelRuntime } from "../../core/wasm/runtime";
import { createGraphwarWorkerBackendRuntime, executeGraphwarWorkerTask } from "../../core/worker-backend";
import type {
  GraphwarStepGlitchFormulaBoundaryState,
  GraphwarStepGlitchFormulaPrefix,
} from "../../formula/trajectory/sampling";
import { createGraphwarTrajectoryFormulaMode } from "../../formula/trajectory/sampling";
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
  runSmartPathfinding: vi.fn(),
  createStepGlitchContext: vi.fn(),
  createStepGlitchContextInput: vi.fn((input: unknown) => input),
  createStepGlitchScanCommandInput: vi.fn((input: unknown) => ({ ...(input as object), type: "scan" })),
  composeStepGlitchSmartPath: vi.fn(),
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
      requiredTargets: GraphwarStepGlitchPrefixEvidence["replayIdentity"]["requiredTargets"];
      simulationBoundaryExpansion?: number;
      simulationMask: Uint8Array;
    }) => ({
      acceptedPoint: createGraphPoint(options.acceptedPoint.x, options.acceptedPoint.y),
      evidenceIdentity: { canonical: "mock-prefix-evidence", simulationMask: options.simulationMask.slice() },
      formulaEvidence: options.formulaEvidence,
      replayIdentity: {
        boundaryExpansion: Math.max(0, Math.floor(options.simulationBoundaryExpansion ?? 0)),
        prefixTarget: options.prefixTarget,
        requiredTargets: options.requiredTargets,
        simulationMask: options.simulationMask.slice(),
      },
    }),
  ),
  scanGraphwarStepGlitchPath: mocks.scanStepGlitchPath,
}));

vi.mock("../../pathfinding/smart/trajectory", () => ({
  createGraphwarSmartPathfindingTrajectoryResult: mocks.validateTrajectory,
}));

vi.mock("../../core/wasm/step-glitch-adapter", () => ({
  createGraphwarWasmStepGlitchContext: mocks.createStepGlitchContext,
  createGraphwarWasmStepGlitchContextInput: mocks.createStepGlitchContextInput,
  createGraphwarWasmStepGlitchScanCommandInput: mocks.createStepGlitchScanCommandInput,
  composeGraphwarWasmStepGlitchSmartPath: mocks.composeStepGlitchSmartPath,
}));

vi.mock("../../core/wasm/composition-adapter", () => ({
  runGraphwarWasmSmartPathfinding: mocks.runSmartPathfinding,
}));

const originalSelfDescriptor = Object.getOwnPropertyDescriptor(globalThis, "self");
const attempt = {
  attemptId: 1,
  backendGeneration: 0,
  outerTaskId: 1,
} satisfies GraphwarBackendAttemptIdentity;

class TestValidatedRuntime extends GraphwarValidatedWasmRuntime {
  readonly role: "pathfinding-master";

  constructor() {
    super();
    this.role = "pathfinding-master";
  }
}

const postMessage = vi.fn<(message: GraphwarBackendControlMessage | GraphwarPathfindingWorkerResponse) => void>();
let handleMessage:
  | ((event: MessageEvent<GraphwarBackendControlMessage | GraphwarPathfindingWorkerRequest>) => void)
  | undefined;
let findOrdinarySmartPathWithWasm: typeof import("./main.worker").findOrdinarySmartPathWithWasm | undefined;
let findStepGlitchSmartPathWithWasm: typeof import("./main.worker").findStepGlitchSmartPathWithWasm | undefined;
let mapWasmSmartFailureReason: typeof import("./main.worker").mapWasmSmartFailureReason | undefined;

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
  ({ findOrdinarySmartPathWithWasm, findStepGlitchSmartPathWithWasm, mapWasmSmartFailureReason } =
    await import("./main.worker"));
  handleMessage?.({
    data: {
      backend: { type: "typescript" },
      backendExecution: { effective: "typescript", requested: "typescript" },
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
  mocks.createStepGlitchContext.mockReset();
  mocks.createStepGlitchContextInput.mockClear();
  mocks.createStepGlitchScanCommandInput.mockClear();
  mocks.composeStepGlitchSmartPath.mockReset();
  mocks.runSmartPathfinding.mockReset();
  mocks.scanStepGlitchPath.mockReset();
  mocks.validateTrajectory.mockReset();
  mocks.validateTrajectory.mockReturnValue({ reachesTargetBeforeObstacle: true, visiblePixels: [] });
  mocks.composeStepGlitchSmartPath.mockImplementation(
    (input: { initialEvidence: unknown; initialPath: readonly unknown[] }) => ({
      evidence: input.initialEvidence,
      path: input.initialPath,
      replayCount: 0,
      status: "success",
    }),
  );
});

describe("WASM smart failure classification", () => {
  it("keeps target misses as trajectory failures and route obstacles as route failures", () => {
    if (!mapWasmSmartFailureReason) {
      throw new Error("WASM smart failure mapper was not exported");
    }

    expect(mapWasmSmartFailureReason("graph-rule")).toBe("graph-rule");
    expect(mapWasmSmartFailureReason("target")).toBe("trajectory");
    expect(mapWasmSmartFailureReason("trajectory")).toBe("trajectory");
    expect(mapWasmSmartFailureReason("route-obstacle")).toBe("route");
    expect(mapWasmSmartFailureReason(undefined)).toBe("route");
  });
});

describe("Ordinary WASM smart-path composition", () => {
  it("packs the trajectory identity and publishes the WASM result without a TypeScript trajectory replay", () => {
    const input = createOrdinarySmartPathInput();
    const normalizedPath = [
      input.sourcePath[0],
      createPixelPoint(150, 210),
      createPixelPoint(180, 220),
      input.targetPoint,
    ];
    const wasmPath = [normalizedPath[0], normalizedPath[2], normalizedPath[3]];
    const formulaMode = createGraphwarTrajectoryFormulaMode(input.settings);
    const graphPoints = normalizedPath.map((point) => imageToGraphPoint(point, input.bounds, input.boundsRect));
    mocks.runSmartPathfinding.mockReturnValue({
      points: wasmPath,
      removedPointCount: 1,
      status: "success",
      validation: {
        target: { center: input.hitTarget.center, radius: input.hitTarget.radius },
        type: "trajectory",
      },
    });
    const run = findOrdinarySmartPathWithWasm;
    if (!run) {
      throw new Error("Ordinary WASM smart-path runner was not exported");
    }

    const result = run(input, normalizedPath, formulaMode, { runSmartPathfinding: mocks.runSmartPathfinding }, []);

    expect(result.path).toEqual(wasmPath);
    expect(result.timings).toEqual([expect.objectContaining({ stage: "optimize-path" })]);
    expect(mocks.runSmartPathfinding).toHaveBeenCalledWith({
      isDeleteOptimizationEnabled: true,
      points: normalizedPath,
      sourcePointCount: input.sourcePath.length,
      target: input.hitTarget.center,
      targetRadius: input.hitTarget.radius,
      trajectoryValidation: {
        descriptor: {
          bounds: input.bounds,
          points: graphPoints,
          settings: formulaMode.settings,
          soldierCenter: graphPoints[0],
        },
        stop: {
          boundsRect: input.boundsRect,
          collision: {
            boundaryExpansion: input.simulationBoundaryExpansion,
            mask: input.simulationMask,
            type: "mask",
          },
          continueAfterTargetsUntilGraphX: { type: "none" },
          orderedTargets: [input.hitTarget],
          qualityPoints: graphPoints.slice(1, -1),
          requiredTargets: [],
          shouldCollectVisiblePixels: false,
          shouldStopOnTargetsComplete: true,
          trackedTargets: [],
          type: "targets",
        },
        type: "trajectory",
      },
    });
    expect(mocks.validateTrajectory).not.toHaveBeenCalled();
  });

  it("keeps short candidates out of deletion and packs an explicit no-collision stop", () => {
    const input = createOrdinarySmartPathInput();
    delete input.simulationMask;
    const normalizedPath = [input.sourcePath[0], createPixelPoint(150, 210), input.targetPoint];
    mocks.runSmartPathfinding.mockReturnValue({
      points: normalizedPath,
      removedPointCount: 0,
      status: "success",
      validation: {
        target: { center: input.hitTarget.center, radius: input.hitTarget.radius },
        type: "trajectory",
      },
    });
    const run = findOrdinarySmartPathWithWasm;
    if (!run) {
      throw new Error("Ordinary WASM smart-path runner was not exported");
    }

    const result = run(
      input,
      normalizedPath,
      createGraphwarTrajectoryFormulaMode(input.settings),
      { runSmartPathfinding: mocks.runSmartPathfinding },
      [],
    );

    expect(mocks.runSmartPathfinding).toHaveBeenCalledWith(
      expect.objectContaining({
        isDeleteOptimizationEnabled: false,
        trajectoryValidation: expect.objectContaining({
          stop: expect.objectContaining({ collision: { type: "none" } }),
          type: "trajectory",
        }),
      }),
    );
    expect(result.timings).toEqual([expect.objectContaining({ stage: "validate-trajectory" })]);
    expect(mocks.validateTrajectory).not.toHaveBeenCalled();
  });

  it("forwards the WASM trajectory blocked point without a TypeScript replay", () => {
    const input = createOrdinarySmartPathInput();
    const normalizedPath = [input.sourcePath[0], createPixelPoint(150, 210), input.targetPoint];
    const blockedPoint = { x: 175.25, y: 224.5 };
    mocks.runSmartPathfinding.mockReturnValue({
      blockedPoint,
      failureReason: "trajectory",
      points: [],
      removedPointCount: 0,
      status: "failure",
    });
    const run = findOrdinarySmartPathWithWasm;
    if (!run) {
      throw new Error("Ordinary WASM smart-path runner was not exported");
    }

    const result = run(
      input,
      normalizedPath,
      createGraphwarTrajectoryFormulaMode(input.settings),
      { runSmartPathfinding: mocks.runSmartPathfinding },
      [],
    );

    expect(result).toMatchObject({
      blockedPoint: createPixelPoint(blockedPoint.x, blockedPoint.y),
      failureReason: "trajectory",
    });
    expect(mocks.validateTrajectory).not.toHaveBeenCalled();
  });

  it("turns malformed smart output into a pathfinding typed WASM fault", async () => {
    const input = createOrdinarySmartPathInput();
    const normalizedPath = [input.sourcePath[0], input.targetPoint];
    const run = findOrdinarySmartPathWithWasm;
    if (!run) {
      throw new Error("Ordinary WASM smart-path runner was not exported");
    }
    const outbound: GraphwarBackendControlMessage[] = [];
    const module = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
    const backendRuntime = createGraphwarWorkerBackendRuntime({
      instantiateRuntime: async () => new TestValidatedRuntime(),
      postControlMessage: (message) => outbound.push(message),
      role: "pathfinding-master",
    });
    backendRuntime.handleMessage({
      backend: { module, type: "wasm" },
      backendExecution: { effective: "wasm", requested: "wasm" },
      generation: attempt.backendGeneration,
      role: "pathfinding-master",
      type: "backend-init",
    });

    await expect(
      executeGraphwarWorkerTask(backendRuntime, attempt, { attempt, type: "task" }, () =>
        run(
          input,
          normalizedPath,
          createGraphwarTrajectoryFormulaMode(input.settings),
          {
            runSmartPathfinding: () => {
              throw new GraphwarWasmAdapterError("invalid-session-state", "malformed smart result", "output");
            },
          },
          [],
        ),
      ),
    ).resolves.toEqual({ type: "wasm-fault" });
    expect(outbound).toEqual([
      { backend: "wasm", generation: attempt.backendGeneration, role: "pathfinding-master", type: "backend-ready" },
      {
        context: { attempt, type: "task" },
        fault: { code: "output", message: "malformed smart result" },
        generation: attempt.backendGeneration,
        role: "pathfinding-master",
        type: "wasm-fault",
      },
    ]);
  });
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
            evidenceIdentity: {
              canonical: "mock-prefix-evidence",
              simulationMask: input.simulationMask?.slice() ?? new Uint8Array(),
            },
            formulaEvidence: { prefix: createMockStepGlitchFormulaPrefix() },
            replayIdentity: {
              boundaryExpansion: input.simulationBoundaryExpansion,
              prefixTarget,
              requiredTargets: [{ center: input.pathPoints[0] ?? targetPoint, radius: 7 }],
              simulationMask: input.simulationMask?.slice() ?? new Uint8Array(),
            },
          },
          targetSequence: [prefixTarget],
        });
        return { elapsedMs: 1, expandedStates: 1, reason: "no-usable-target", type: "failure" as const };
      })
      .mockImplementationOnce(async (options: GraphwarOneClickClearBuildOptions) => {
        expect(options.stepGlitchPrefixEvidence).toMatchObject({ acceptedPoint: createGraphPoint(-5, 1) });
        expect(options.stepGlitchPrefixEvidence?.replayIdentity.requiredTargets).toEqual([]);
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
  it("uses the retained WASM scan/replay context without TS scanner or trajectory calls", () => {
    const mask = createPlaneMask();
    const input = createStepGlitchInput(mask, mask);
    input.isDeleteOptimizationEnabled = true;
    const wasmPath = [input.sourcePath[0], createPixelPoint(130, 225), createPixelPoint(160, 225), input.targetPoint];
    const scanner = {
      dispose: vi.fn(),
      replayRaw: vi.fn().mockReturnValue({ status: "hit" }),
      scanRaw: vi.fn().mockReturnValue({
        evidence: { owned: { path: wasmPath } },
        status: "hit",
      }),
    };
    mocks.createStepGlitchContext.mockReturnValue({ context: scanner, status: "ready" });
    mocks.composeStepGlitchSmartPath.mockReturnValue({
      evidence: { owned: { path: wasmPath } },
      path: [input.sourcePath[0], createPixelPoint(160, 225), input.targetPoint],
      replayCount: 1,
      status: "success",
    });
    const run = findStepGlitchSmartPathWithWasm;
    if (!run) {
      throw new Error("WASM smart-path runner was not exported");
    }

    const result = run(
      input,
      createGraphwarTrajectoryFormulaMode(input.settings),
      [],
      { runtime: { simulationMask: mask }, type: "step-glitch" },
      {} as GraphwarWasmKernelRuntime,
    );

    expect(result.path).toEqual([input.sourcePath[0], createPixelPoint(160, 225), input.targetPoint]);
    expect(scanner.scanRaw).toHaveBeenCalledOnce();
    expect(scanner.replayRaw).not.toHaveBeenCalled();
    expect(mocks.composeStepGlitchSmartPath).toHaveBeenCalledWith(
      expect.objectContaining({
        initialPath: wasmPath,
        isDeleteOptimizationEnabled: true,
        sourcePointCount: input.sourcePath.length,
      }),
    );
    expect(scanner.dispose).toHaveBeenCalledOnce();
    expect(mocks.scanStepGlitchPath).not.toHaveBeenCalled();
    expect(mocks.validateTrajectory).not.toHaveBeenCalled();
  });

  it("revalidates a WASM candidate with the requested Formula Mode when masks differ", () => {
    const simulationMask = createPlaneMask();
    const formulaMask = createPlaneMask();
    formulaMask[0] = 1;
    const input = createStepGlitchInput(simulationMask, formulaMask);
    input.isDeleteOptimizationEnabled = true;
    const scannedPath = [input.sourcePath[0], input.targetPoint];
    const scanner = {
      dispose: vi.fn(),
      replayRaw: vi.fn(),
      scanRaw: vi.fn().mockReturnValue({ evidence: { owned: { path: scannedPath } }, status: "hit" }),
    };
    mocks.createStepGlitchContext.mockReturnValue({ context: scanner, status: "ready" });
    mocks.validateTrajectory.mockReturnValue({ reachesTargetBeforeObstacle: false, visiblePixels: [] });

    const scannerFormulaMode = createGraphwarTrajectoryFormulaMode({
      ...input.settings,
      stepGlitchObstacleMask: simulationMask,
    });
    const requestedFormulaMode = createGraphwarTrajectoryFormulaMode(input.settings);
    const run = findStepGlitchSmartPathWithWasm;
    if (!run) {
      throw new Error("WASM smart-path runner was not exported");
    }

    const result = run(
      input,
      scannerFormulaMode,
      [],
      { runtime: { simulationMask }, type: "step-glitch" },
      {} as GraphwarWasmKernelRuntime,
      requestedFormulaMode,
    );

    expect(result).toMatchObject({ failureReason: "trajectory" });
    expect(mocks.composeStepGlitchSmartPath).toHaveBeenCalledWith(
      expect.objectContaining({ isDeleteOptimizationEnabled: false }),
    );
    expect(mocks.validateTrajectory).toHaveBeenCalledWith(
      expect.objectContaining({ formulaMode: requestedFormulaMode }),
    );
    expect(scanner.dispose).toHaveBeenCalledOnce();
  });

  it("does not publish a malformed composition result", () => {
    const mask = createPlaneMask();
    const input = createStepGlitchInput(mask, mask);
    input.isDeleteOptimizationEnabled = true;
    const scannedPath = [input.sourcePath[0], createPixelPoint(160, 225), input.targetPoint];
    const scanner = {
      dispose: vi.fn(),
      replayRaw: vi.fn(),
      scanRaw: vi.fn().mockReturnValue({ evidence: { owned: { path: scannedPath } }, status: "hit" }),
    };
    mocks.createStepGlitchContext.mockReturnValue({ context: scanner, status: "ready" });
    mocks.composeStepGlitchSmartPath.mockImplementation(() => {
      throw new GraphwarWasmAdapterError("invalid-session-state", "malformed composition result", "output");
    });
    const run = findStepGlitchSmartPathWithWasm;
    if (!run) {
      throw new Error("WASM smart-path runner was not exported");
    }

    expect(() =>
      run(
        input,
        createGraphwarTrajectoryFormulaMode(input.settings),
        [],
        { runtime: { simulationMask: mask }, type: "step-glitch" },
        {} as GraphwarWasmKernelRuntime,
      ),
    ).toThrow("malformed composition result");
    expect(scanner.replayRaw).not.toHaveBeenCalled();
    expect(scanner.dispose).toHaveBeenCalledOnce();
  });

  it("maps a normal command-20 composition miss without publishing a path", () => {
    const mask = createPlaneMask();
    const input = createStepGlitchInput(mask, mask);
    input.isDeleteOptimizationEnabled = true;
    const scannedPath = [input.sourcePath[0], createPixelPoint(160, 225), input.targetPoint];
    const scanner = {
      dispose: vi.fn(),
      replayRaw: vi.fn(),
      scanRaw: vi.fn().mockReturnValue({ evidence: { owned: { path: scannedPath } }, status: "hit" }),
    };
    mocks.createStepGlitchContext.mockReturnValue({ context: scanner, status: "ready" });
    mocks.composeStepGlitchSmartPath.mockReturnValue({
      failureReason: "trajectory",
      replayCount: 1,
      status: "failure",
    });

    const run = findStepGlitchSmartPathWithWasm;
    if (!run) {
      throw new Error("WASM smart-path runner was not exported");
    }
    const result = run(
      input,
      createGraphwarTrajectoryFormulaMode(input.settings),
      [],
      { runtime: { simulationMask: mask }, type: "step-glitch" },
      {} as GraphwarWasmKernelRuntime,
    );

    expect(result).toMatchObject({ failureReason: "trajectory" });
    expect(result.path).toBeUndefined();
    expect(scanner.dispose).toHaveBeenCalledOnce();
  });

  it("keeps the scanner path when composition accepts no deletion", () => {
    const mask = createPlaneMask();
    const input = createStepGlitchInput(mask, mask);
    input.isDeleteOptimizationEnabled = true;
    const scannedPath = [
      input.sourcePath[0],
      createPixelPoint(130, 225),
      createPixelPoint(160, 225),
      input.targetPoint,
    ];
    const scanner = {
      dispose: vi.fn(),
      replayRaw: vi.fn().mockReturnValue({ status: "miss" }),
      scanRaw: vi.fn().mockReturnValue({ evidence: { owned: { path: scannedPath } }, status: "hit" }),
    };
    mocks.createStepGlitchContext.mockReturnValue({ context: scanner, status: "ready" });
    mocks.composeStepGlitchSmartPath.mockReturnValue({
      evidence: { owned: { path: scannedPath } },
      path: scannedPath,
      replayCount: 1,
      status: "success",
    });
    const run = findStepGlitchSmartPathWithWasm;
    if (!run) {
      throw new Error("WASM smart-path runner was not exported");
    }

    const result = run(
      input,
      createGraphwarTrajectoryFormulaMode(input.settings),
      [],
      { runtime: { simulationMask: mask }, type: "step-glitch" },
      {} as GraphwarWasmKernelRuntime,
    );

    expect(result.path).toEqual(scannedPath);
    expect(mocks.composeStepGlitchSmartPath).toHaveBeenCalledOnce();
    expect(scanner.dispose).toHaveBeenCalledOnce();
  });

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

/** 构造普通 WASM smart composition 的完整 trajectory identity。 */
function createOrdinarySmartPathInput(): GraphwarSmartPathfindingPathInput {
  const sourcePoint = createPixelPoint(100, 225);
  return {
    boundaryExpansion: 1,
    bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
    boundsRect: { height: 450, width: 770, x: 0, y: 0 },
    isDeleteOptimizationEnabled: true,
    hitTarget: { center: createPixelPoint(205, 225), radius: 10 },
    isPreviewEnabled: false,
    routeMaskCacheId: 1,
    routeMode: "visibility-graph",
    routeObstacleMask: createPlaneMask(),
    routeTolerancePlanePixels: 2,
    settings: {
      algorithm: "pchip",
      decimalPlaces: 4,
      equation: "y",
      steepness: 67,
      isStepGlitchModeEnabled: false,
      isStepOverflowProtectionEnabled: true,
    },
    simulationBoundaryExpansion: 2,
    simulationMask: createPlaneMask(),
    simulationMaskCacheId: 2,
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
