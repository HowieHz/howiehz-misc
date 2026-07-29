import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isGraphwarBackendControlMessage,
  type GraphwarBackendAttemptIdentity,
  type GraphwarBackendControlMessage,
} from "../../core/algorithm-backend";
import type { GraphwarDetectionWorkerRequest, GraphwarDetectionWorkerResponse } from "../../detection/runtime/protocol";
import type {
  GraphwarSoldierTemplateWorkerRequest,
  GraphwarSoldierTemplateWorkerResponse,
} from "../../detection/template/protocol";

const objectMocks = vi.hoisted(() => ({
  collectCandidates: vi.fn(),
  createBoxes: vi.fn(),
  detectObstacles: vi.fn(),
  finalizeMatches: vi.fn(),
  getScale: vi.fn(),
  getSettings: vi.fn(),
  matchTemplates: vi.fn(),
  reportWasmFault: vi.fn(),
}));

vi.mock("../../detection/objects", () => ({
  collectSoldierTemplateCenterCandidatesForMatching: objectMocks.collectCandidates,
  createSoldierDetectionBoxes: objectMocks.createBoxes,
  detectGraphwarObstaclesInBounds: objectMocks.detectObstacles,
  detectGraphwarPlayArea: vi.fn(),
  finalizeSoldierTemplateMatches: objectMocks.finalizeMatches,
  getGraphwarDetectionScale: objectMocks.getScale,
  getGraphwarSoldierDetectionSettings: objectMocks.getSettings,
  matchSoldierTemplates: objectMocks.matchTemplates,
}));

vi.mock("../../core/worker-backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../core/worker-backend")>();
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
        reportWasmFault: objectMocks.reportWasmFault,
        waitForBackend: async () => undefined,
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
let laneBehavior: "ordinary-failure" | "typed-fault" = "ordinary-failure";

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
  objectMocks.matchTemplates.mockImplementation(() => {
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
    expect(objectMocks.matchTemplates).toHaveBeenCalledOnce();
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
          session: { backendGeneration: 1, nonce: 8, requestId: 7, taskType: "detection" },
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
    if (message.id !== 1) {
      return;
    }
    if (laneBehavior === "ordinary-failure") {
      queueMicrotask(() => this.fail("lane failed"));
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

function restoreGlobal(name: "ImageData" | "Worker" | "self", descriptor: PropertyDescriptor | undefined) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, name);
  }
}
