import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GraphwarWasmFault,
  isGraphwarBackendControlMessage,
  type GraphwarBackendAttemptIdentity,
  type GraphwarBackendControlMessage,
} from "../../core/algorithm-backend";
import { GraphwarWasmAdapterError } from "../../core/wasm/abi";
import type { GraphwarDetectionWorkerRequest, GraphwarDetectionWorkerResponse } from "../../detection/runtime/protocol";
import type {
  GraphwarSoldierTemplateWorkerRequest,
  GraphwarSoldierTemplateWorkerResponse,
} from "../../detection/template/protocol";

const objectMocks = vi.hoisted(() => ({
  collectCandidates: vi.fn(),
  controller: {
    begin: vi.fn(),
    cancel: vi.fn(),
    resumeCandidates: vi.fn(),
    resumeBounds: vi.fn(),
    resumeObstacleComponents: vi.fn(),
    resumeObstacleMask: vi.fn(),
    resumeTemplates: vi.fn(),
    resumeTemplatesSerial: vi.fn(),
  },
  createBoxes: vi.fn(),
  createController: vi.fn(),
  detectPlayArea: vi.fn(),
  detectObstacles: vi.fn(),
  finalizeMatches: vi.fn(),
  getScale: vi.fn(),
  getSettings: vi.fn(),
  matchTemplates: vi.fn(),
  reportWasmFault: vi.fn(),
  runWasmShard: vi.fn(),
}));

vi.mock("../../core/wasm/detection-adapter", () => ({
  createGraphwarWasmDetectionController: objectMocks.createController,
  runGraphwarWasmDetectionTemplateShard: objectMocks.runWasmShard,
}));

vi.mock("../../core/wasm/runtime", () => ({
  GraphwarWasmKernelRuntime: class GraphwarWasmKernelRuntime {
    readonly isTestRuntime = true;
  },
}));

vi.mock("../../detection/objects", () => ({
  collectSoldierTemplateCenterCandidatesForMatching: objectMocks.collectCandidates,
  createSoldierDetectionBoxes: objectMocks.createBoxes,
  detectGraphwarObstaclesInBounds: objectMocks.detectObstacles,
  detectGraphwarPlayArea: objectMocks.detectPlayArea,
  finalizeSoldierTemplateMatches: objectMocks.finalizeMatches,
  getGraphwarDetectionScale: objectMocks.getScale,
  getGraphwarSoldierDetectionSettings: objectMocks.getSettings,
  matchSoldierTemplates: objectMocks.matchTemplates,
}));

vi.mock("../../core/worker-backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../core/worker-backend")>();
  const { GraphwarWasmKernelRuntime } = await import("../../core/wasm/runtime");
  return {
    ...original,
    createGraphwarWorkerBackendRuntime: (options: {
      postControlMessage: (message: GraphwarBackendControlMessage) => void;
      role: "detection-main";
    }) => {
      let configuration:
        | { backend: Extract<GraphwarBackendControlMessage, { type: "backend-init" }>["backend"]; generation: number }
        | undefined;
      return {
        getNestedConfiguration: () => {
          if (!configuration) {
            throw new Error("Backend was not initialized");
          }
          return configuration;
        },
        handleMessage: (message: unknown) => {
          if (!isGraphwarBackendControlMessage(message) || message.type !== "backend-init") {
            return false;
          }
          configuration = { backend: message.backend, generation: message.generation };
          queueMicrotask(() =>
            options.postControlMessage({
              backend: message.backend.type,
              generation: message.generation,
              role: options.role,
              type: "backend-ready",
            }),
          );
          return true;
        },
        reportWasmFault: (context: Parameters<typeof objectMocks.reportWasmFault>[0], error: GraphwarWasmFault) => {
          objectMocks.reportWasmFault(context, error);
          if (!configuration) {
            throw new Error("Backend was not initialized");
          }
          options.postControlMessage({
            context,
            fault: error.toDescriptor(),
            generation: configuration.generation,
            role: options.role,
            type: "wasm-fault",
          });
        },
        waitForBackend: async () => ({
          generation: 1,
          runtime: Object.create(GraphwarWasmKernelRuntime.prototype),
          type: "wasm" as const,
        }),
      };
    },
  };
});

const originalSelfDescriptor = Object.getOwnPropertyDescriptor(globalThis, "self");
const originalImageDataDescriptor = Object.getOwnPropertyDescriptor(globalThis, "ImageData");
const originalWorkerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
const attempt = {
  attemptId: 1,
  backendGeneration: 1,
  outerTaskId: 1,
} satisfies GraphwarBackendAttemptIdentity;
const emptyModule = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
const postMessage = vi.fn<(message: GraphwarBackendControlMessage | GraphwarDetectionWorkerResponse) => void>();
let handleMessage:
  | ((event: MessageEvent<GraphwarBackendControlMessage | GraphwarDetectionWorkerRequest>) => void)
  | undefined;
let laneBehavior: "module-clone" | "ordinary-failure" | "stale-success" | "success" | "typed-fault" =
  "ordinary-failure";

beforeAll(async () => {
  Object.defineProperty(globalThis, "ImageData", { configurable: true, value: FakeImageData });
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: FakeTemplateWorker });
  Object.defineProperty(globalThis, "self", {
    configurable: true,
    value: {
      addEventListener: (
        type: "message",
        listener: (event: MessageEvent<GraphwarBackendControlMessage | GraphwarDetectionWorkerRequest>) => void,
      ) => {
        if (type === "message") {
          handleMessage = listener;
        }
      },
      postMessage,
    },
  });
  await import("./main.worker");
  dispatch({
    backend: { module: emptyModule, type: "wasm" },
    generation: 1,
    role: "detection-main",
    type: "backend-init",
  });
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
});

afterAll(() => {
  restoreGlobal("self", originalSelfDescriptor);
  restoreGlobal("ImageData", originalImageDataDescriptor);
  restoreGlobal("Worker", originalWorkerDescriptor);
});

beforeEach(() => {
  postMessage.mockClear();
  FakeTemplateWorker.instances.length = 0;
  laneBehavior = "ordinary-failure";
  objectMocks.collectCandidates.mockReturnValue([
    { isMirrored: false, votes: 2, x: 1, y: 1 },
    { isMirrored: true, votes: 1, x: 2, y: 2 },
  ]);
  objectMocks.createBoxes.mockReturnValue([]);
  objectMocks.createController.mockReturnValue(objectMocks.controller);
  objectMocks.detectObstacles.mockReturnValue({ count: 0, mask: new Uint8Array(770 * 450) });
  objectMocks.finalizeMatches.mockReturnValue([]);
  objectMocks.getScale.mockReturnValue(1);
  objectMocks.getSettings.mockReturnValue({
    candidateTopRatio: 1,
    maximumSoldierCount: 40,
    templateMatchingWorkerCount: 2,
  });
  objectMocks.matchTemplates.mockReset();
  objectMocks.reportWasmFault.mockReset();
  objectMocks.runWasmShard.mockReset();
  for (const method of Object.values(objectMocks.controller)) {
    method.mockReset();
  }
  const session = { backendGeneration: 1, nonce: 1, requestId: 7, taskType: "detection" };
  const edgeRect = { height: 10, width: 10, x: 0, y: 0 };
  const candidates = [
    { candidateIndex: 0, isMirrored: false, votes: 2, x: 1, y: 1 },
    { candidateIndex: 1, isMirrored: true, votes: 1, x: 2, y: 2 },
  ];
  objectMocks.controller.begin.mockReturnValue({
    edgeRect,
    handle: session,
    stageEvents: [{ phase: "start", stage: "collecting-soldier-candidates" }],
    taskType: "detect-bounds",
    type: "running",
  });
  objectMocks.controller.resumeCandidates.mockReturnValue({
    candidates,
    edgeRect,
    handle: session,
    shards: candidates.map((candidate, index) => ({ candidates: [candidate], id: index + 1 })),
    stageEvents: [
      { phase: "end", stage: "collecting-soldier-candidates" },
      { phase: "start", stage: "matching-soldier-templates" },
    ],
    taskType: "detect-bounds",
    type: "waiting-template-shards",
  });
  objectMocks.controller.resumeBounds.mockReturnValue({
    result: {
      edgeRect: undefined,
      stageEvents: [{ phase: "end", stage: "detecting-bounds" }],
      taskType: "detect-bounds-only",
    },
    type: "complete",
  });
  objectMocks.controller.resumeTemplatesSerial.mockReturnValue({
    edgeRect,
    handle: session,
    matches: [],
    stageEvents: [
      { phase: "end", stage: "matching-soldier-templates" },
      { phase: "start", stage: "building-obstacle-mask" },
    ],
    taskType: "detect-bounds",
    type: "running",
  });
  objectMocks.controller.resumeObstacleMask.mockReturnValue({
    edgeRect,
    handle: session,
    matches: [],
    stageEvents: [
      { phase: "end", stage: "building-obstacle-mask" },
      { phase: "start", stage: "filtering-obstacle-components" },
    ],
    taskType: "detect-bounds",
    type: "running",
  });
  objectMocks.controller.resumeObstacleComponents.mockReturnValue({
    result: {
      edgeRect,
      matches: [],
      obstacleCount: 0,
      obstacleMask: new Uint8Array(770 * 450),
      stageEvents: [{ phase: "end", stage: "filtering-obstacle-components" }],
      taskType: "detect-bounds",
    },
    type: "complete",
  });
  objectMocks.matchTemplates.mockImplementation(() => {
    expect(FakeTemplateWorker.instances.every((worker) => worker.isTerminated)).toBe(true);
    return [];
  });
  objectMocks.runWasmShard.mockImplementation(() => {
    expect(FakeTemplateWorker.instances.every((worker) => worker.isTerminated)).toBe(true);
    return [];
  });
});

describe("Detection template Worker failure handling", () => {
  it("terminates every lane before ordinary serial fallback starts", async () => {
    objectMocks.getSettings.mockReturnValue({
      candidateTopRatio: 1,
      maximumSoldierCount: 40,
      templateMatchingWorkerCount: 4,
    });
    dispatchDetectionRequest();

    await vi.waitFor(() => expect(postMessage.mock.calls.some(([message]) => message.type === "success")).toBe(true));
    expect(FakeTemplateWorker.instances).toHaveLength(4);
    expect(FakeTemplateWorker.instances.every((worker) => worker.isTerminated)).toBe(true);
    expect(objectMocks.controller.resumeTemplatesSerial).toHaveBeenCalledOnce();
    expect(objectMocks.matchTemplates).not.toHaveBeenCalled();
    expect(objectMocks.collectCandidates).not.toHaveBeenCalled();
    expect(objectMocks.detectObstacles).not.toHaveBeenCalled();
    expect(getSuccessResponse()?.timings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: { mode: "parallel-fallback", type: "template-matching-mode", workerCount: 2 },
          stage: "matching-soldier-templates",
        }),
        expect.objectContaining({
          detail: { type: "template-matching-fallback-serial" },
          stage: "matching-soldier-templates",
        }),
      ]),
    );
  });

  it("fails fast on a typed child fault while another lane never responds", async () => {
    laneBehavior = "typed-fault";
    dispatchDetectionRequest();

    await vi.waitFor(() =>
      expect(postMessage.mock.calls.some(([message]) => message.type === "wasm-fault")).toBe(true),
    );
    expect(FakeTemplateWorker.instances.every((worker) => worker.isTerminated)).toBe(true);
    expect(objectMocks.matchTemplates).not.toHaveBeenCalled();
    expect(objectMocks.reportWasmFault).not.toHaveBeenCalled();
    expect(
      postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "wasm-fault"),
    ).toEqual([
      {
        context: {
          attempt,
          session: { backendGeneration: 1, nonce: 1, requestId: 7, taskType: "detection" },
          shardId: 1,
          type: "template-shard",
        },
        fault: { code: "trap", message: "template trapped" },
        generation: 1,
        role: "detection-template",
        type: "wasm-fault",
      },
    ]);
    expect(postMessage.mock.calls.some(([message]) => message.type === "success" || message.type === "error")).toBe(
      false,
    );
  });

  it("publishes malformed main-controller output as a typed WASM fault", async () => {
    objectMocks.controller.resumeObstacleComponents.mockImplementation(() => {
      throw new GraphwarWasmAdapterError("invalid-detection-result", "detection mask length is malformed", "output");
    });
    dispatchDetectionRequest();

    await vi.waitFor(() =>
      expect(postMessage.mock.calls.some(([message]) => message.type === "wasm-fault")).toBe(true),
    );
    expect(postMessage.mock.calls.some(([message]) => message.type === "success" || message.type === "error")).toBe(
      false,
    );
    expect(
      postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "wasm-fault"),
    ).toEqual([
      {
        context: { attempt, type: "task" },
        fault: { code: "output", message: "detection mask length is malformed" },
        generation: 1,
        role: "detection-main",
        type: "wasm-fault",
      },
    ]);
  });

  it("keeps nested Module clone failure on the main-WASM fallback path", async () => {
    laneBehavior = "module-clone";
    dispatchDetectionRequest();

    await vi.waitFor(() => expect(postMessage.mock.calls.some(([message]) => message.type === "success")).toBe(true));
    expect(objectMocks.controller.resumeTemplatesSerial).toHaveBeenCalledOnce();
    expect(postMessage.mock.calls.some(([message]) => message.type === "wasm-fault")).toBe(false);
    expect(getSuccessResponse()?.timings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: { mode: "parallel-fallback", type: "template-matching-mode", workerCount: 2 },
          stage: "matching-soldier-templates",
        }),
        expect.objectContaining({
          detail: { type: "template-matching-fallback-serial" },
          stage: "matching-soldier-templates",
        }),
      ]),
    );
  });

  it("records main-WASM serial template scoring time", async () => {
    objectMocks.controller.resumeCandidates.mockReturnValue({
      candidates: [],
      edgeRect: { height: 10, width: 10, x: 0, y: 0 },
      handle: { backendGeneration: 1, nonce: 1, requestId: 7, taskType: "detection" },
      shards: [],
      stageEvents: [
        { phase: "end", stage: "collecting-soldier-candidates" },
        { phase: "start", stage: "matching-soldier-templates" },
      ],
      taskType: "detect-bounds",
      type: "waiting-template-shards",
    });
    dispatchDetectionRequest();

    await vi.waitFor(() => expect(postMessage.mock.calls.some(([message]) => message.type === "success")).toBe(true));
    expect(getSuccessResponse()?.timings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: { mode: "serial", type: "template-matching-mode", workerCount: 1 },
          stage: "matching-soldier-templates",
        }),
        expect.objectContaining({
          detail: { type: "template-matching-serial" },
          stage: "matching-soldier-templates",
        }),
      ]),
    );
  });

  it("rejects stale template success identity before main-WASM fallback", async () => {
    laneBehavior = "stale-success";
    dispatchDetectionRequest();

    await vi.waitFor(() => expect(postMessage.mock.calls.some(([message]) => message.type === "success")).toBe(true));
    expect(objectMocks.controller.resumeTemplatesSerial).toHaveBeenCalledOnce();
    expect(postMessage.mock.calls.some(([message]) => message.type === "wasm-fault")).toBe(false);
  });

  it.each(["detect-bounds-only", "detect-auto"] as const)(
    "runs %s bounds phases through the WASM controller without TS detection",
    async (taskType) => {
      objectMocks.controller.begin.mockReturnValue({
        handle: { backendGeneration: 1, nonce: 2, requestId: 9, taskType: "detection" },
        stageEvents: [{ phase: "start", stage: "detecting-bounds" }],
        taskType,
        type: "running",
      });
      objectMocks.controller.resumeBounds.mockReturnValue({
        result: {
          edgeRect: undefined,
          stageEvents: [{ phase: "end", stage: "detecting-bounds" }],
          taskType,
        },
        type: "complete",
      });
      dispatch({
        attempt,
        id: 9,
        task:
          taskType === "detect-auto"
            ? {
                imageData: new FakeImageData(new Uint8ClampedArray(400), 10, 10) as ImageData,
                soldierSettings: { candidateTopRatio: 1, maximumSoldierCount: 40, templateMatchingWorkerCount: 2 },
                thresholds: { minArea: 1 },
                type: taskType,
              }
            : {
                imageData: new FakeImageData(new Uint8ClampedArray(400), 10, 10) as ImageData,
                type: taskType,
              },
      });

      await vi.waitFor(() => expect(postMessage.mock.calls.some(([message]) => message.type === "success")).toBe(true));
      expect(objectMocks.controller.resumeBounds).toHaveBeenCalledOnce();
      expect(objectMocks.detectPlayArea).not.toHaveBeenCalled();
      expect(objectMocks.collectCandidates).not.toHaveBeenCalled();
      expect(FakeTemplateWorker.instances).toHaveLength(0);
      expect(FakeTemplateWorker.instances.every((worker) => worker.isTerminated)).toBe(true);
    },
  );

  it("returns every successful child shard to the WASM controller", async () => {
    laneBehavior = "success";
    objectMocks.controller.resumeTemplates.mockImplementation((_handle, shardResults) => {
      expect(shardResults.map((result: { id: number }) => result.id)).toEqual([1, 2]);
      return (
        objectMocks.controller.resumeTemplatesSerial.mock.results[0]?.value ?? {
          edgeRect: { height: 10, width: 10, x: 0, y: 0 },
          handle: { backendGeneration: 1, nonce: 1, requestId: 7, taskType: "detection" },
          matches: [],
          stageEvents: [
            { phase: "end", stage: "matching-soldier-templates" },
            { phase: "start", stage: "building-obstacle-mask" },
          ],
          taskType: "detect-bounds",
          type: "running",
        }
      );
    });
    dispatchDetectionRequest();

    await vi.waitFor(() => expect(postMessage.mock.calls.some(([message]) => message.type === "success")).toBe(true));
    expect(objectMocks.controller.resumeTemplates).toHaveBeenCalledOnce();
    expect(objectMocks.controller.resumeTemplatesSerial).not.toHaveBeenCalled();
  });
});

class FakeImageData {
  readonly data: Uint8ClampedArray;
  readonly height: number;
  readonly width: number;

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.height = height;
    this.width = width;
  }
}

class FakeTemplateWorker {
  static readonly instances: FakeTemplateWorker[] = [];

  isTerminated = false;
  private readonly listeners = {
    error: [] as ((event: ErrorEvent) => void)[],
    message: [] as ((
      event: MessageEvent<GraphwarBackendControlMessage | GraphwarSoldierTemplateWorkerResponse>,
    ) => void)[],
    messageerror: [] as ((event: MessageEvent) => void)[],
  };

  constructor() {
    FakeTemplateWorker.instances.push(this);
  }

  addEventListener(type: "error" | "message" | "messageerror", listener: EventListener) {
    this.listeners[type].push(listener as never);
  }

  removeEventListener(type: "error" | "message" | "messageerror", listener: EventListener) {
    const listeners = this.listeners[type];
    const index = listeners.indexOf(listener as never);
    if (index >= 0) {
      listeners.splice(index, 1);
    }
  }

  postMessage(message: GraphwarBackendControlMessage | GraphwarSoldierTemplateWorkerRequest) {
    if (isGraphwarBackendControlMessage(message)) {
      if (message.type !== "backend-init") {
        throw new Error("Template Worker only accepts backend initialization control messages");
      }
      if (laneBehavior === "module-clone") {
        queueMicrotask(() =>
          this.emit({
            context: { type: "initialization" },
            fault: { code: "module-clone", message: "nested module could not be cloned" },
            generation: message.generation,
            role: "detection-template",
            type: "wasm-fault",
          }),
        );
        return;
      }
      queueMicrotask(() =>
        this.emit({
          backend: message.backend.type,
          generation: message.generation,
          role: "detection-template",
          type: "backend-ready",
        }),
      );
      return;
    }
    if (message.id !== 1 && laneBehavior !== "success") {
      return;
    }
    if (laneBehavior === "ordinary-failure") {
      queueMicrotask(() => this.fail("lane failed"));
      return;
    }
    if (laneBehavior === "stale-success") {
      queueMicrotask(() =>
        this.emit({
          attempt: message.attempt,
          candidateIndexes: message.candidates.map((_, index) => message.candidateStart + index),
          elapsedMs: 0,
          id: message.id,
          matches: [],
          session: { ...message.session, nonce: message.session.nonce + 1 },
          type: "success",
        }),
      );
      return;
    }
    if (laneBehavior === "success") {
      queueMicrotask(() =>
        this.emit({
          attempt: message.attempt,
          candidateIndexes: message.candidates.map((_, index) => message.candidateStart + index),
          elapsedMs: 0,
          id: message.id,
          matches: message.candidates.map((candidate) => ({
            fixedScore: 0,
            foregroundScore: 0,
            isMirrored: candidate.isMirrored,
            playerScore: 0,
            score: 0,
            signatureScore: 0,
            sourceCenterX: candidate.x,
            sourceCenterY: candidate.y,
            templateName: "stub",
            votes: candidate.votes,
          })),
          session: message.session,
          type: "success",
        }),
      );
      return;
    }
    queueMicrotask(() =>
      this.emit({
        context: {
          attempt: message.attempt,
          session: message.session,
          shardId: message.id,
          type: "template-shard",
        },
        fault: { code: "trap", message: "template trapped" },
        generation: message.attempt.backendGeneration,
        role: "detection-template",
        type: "wasm-fault",
      }),
    );
  }

  terminate() {
    this.isTerminated = true;
  }

  private emit(message: GraphwarBackendControlMessage | GraphwarSoldierTemplateWorkerResponse) {
    const event = { data: message } as MessageEvent<
      GraphwarBackendControlMessage | GraphwarSoldierTemplateWorkerResponse
    >;
    for (const listener of [...this.listeners.message]) {
      listener(event);
    }
  }

  private fail(message: string) {
    const event = { error: new Error(message), message } as ErrorEvent;
    for (const listener of [...this.listeners.error]) {
      listener(event);
    }
  }
}

function dispatch(message: GraphwarBackendControlMessage | GraphwarDetectionWorkerRequest) {
  if (!handleMessage) {
    throw new Error("Detection worker message handler was not registered");
  }
  handleMessage({ data: message } as MessageEvent<GraphwarBackendControlMessage | GraphwarDetectionWorkerRequest>);
}

function dispatchDetectionRequest() {
  dispatch({
    attempt,
    id: 7,
    task: {
      edgeRect: { height: 10, width: 10, x: 0, y: 0 },
      imageData: new FakeImageData(new Uint8ClampedArray(400), 10, 10) as ImageData,
      soldierSettings: { candidateTopRatio: 1, maximumSoldierCount: 40, templateMatchingWorkerCount: 2 },
      thresholds: { minArea: 1 },
      type: "detect-bounds",
    },
  });
}

function getSuccessResponse() {
  return postMessage.mock.calls
    .map(([message]) => message)
    .find(
      (message): message is Extract<GraphwarDetectionWorkerResponse, { type: "success" }> => message.type === "success",
    );
}

function restoreGlobal(name: "ImageData" | "Worker" | "self", descriptor: PropertyDescriptor | undefined) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, name);
  }
}
