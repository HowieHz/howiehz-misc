import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPixelPoint } from "../../core/types";
import type { GraphwarOneClickClearIncumbent } from "../one-click-clear/search";
import type {
  GraphwarOneClickClearPathWorkerInput,
  GraphwarOneClickClearPathWorkerResult,
  GraphwarPathfindingWorkerRequest,
  GraphwarPathfindingWorkerResponse,
} from "./protocol";
import { createGraphwarPathfindingRunner, isGraphwarPathfindingCancelledError } from "./runner";

const originalWorkerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");

beforeEach(() => {
  FakeWorker.instances.length = 0;
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: FakeWorker,
  });
});

afterEach(() => {
  if (originalWorkerDescriptor) {
    Object.defineProperty(globalThis, "Worker", originalWorkerDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "Worker");
  }
});

describe("Graphwar pathfinding runner incumbents", () => {
  it("preserves the deletion preference in the cloned Worker request", async () => {
    const runner = createGraphwarPathfindingRunner();
    const input = createInput();
    input.deleteOptimizationEnabled = true;
    const resultPromise = runner.buildOneClickClearPath(input);
    const worker = getWorker(0);
    const request = getOneClickClearRequest(worker, 0);

    expect(request.task.input.deleteOptimizationEnabled).toBe(true);
    worker.emit({
      id: request.id,
      result: createResult(),
      taskType: "build-one-click-clear-path",
      type: "success",
    });
    await resultPromise;
    runner.close();
  });

  it("opts into progress and forwards the current request's incumbent", async () => {
    const onIncumbent = vi.fn();
    const runner = createGraphwarPathfindingRunner();
    const resultPromise = runner.buildOneClickClearPath(createInput(), { onIncumbent });
    const worker = getWorker(0);
    const request = getOneClickClearRequest(worker, 0);
    const incumbent = createIncumbent("target");

    expect(request.task.reportIncumbents).toBe(true);
    worker.emit({ id: request.id, incumbent, type: "one-click-clear-incumbent" });

    expect(onIncumbent).toHaveBeenCalledWith(incumbent);
    worker.emit({
      id: request.id,
      result: createResult(),
      taskType: "build-one-click-clear-path",
      type: "success",
    });
    await expect(resultPromise).resolves.toEqual(createResult());
    runner.close();
  });

  it("ignores superseded and explicitly cancelled progress", async () => {
    const firstProgress = vi.fn();
    const secondProgress = vi.fn();
    const runner = createGraphwarPathfindingRunner();
    const first = runner.buildOneClickClearPath(createInput(), { onIncumbent: firstProgress });
    const firstError = first.catch((error: unknown) => error);
    const firstWorker = getWorker(0);
    const firstRequest = getOneClickClearRequest(firstWorker, 0);

    const second = runner.buildOneClickClearPath(createInput(), { onIncumbent: secondProgress });
    const secondError = second.catch((error: unknown) => error);
    const secondWorker = getWorker(1);
    const secondRequest = getOneClickClearRequest(secondWorker, 0);
    firstWorker.emit({
      id: firstRequest.id,
      incumbent: createIncumbent("stale"),
      type: "one-click-clear-incumbent",
    });

    expect(isGraphwarPathfindingCancelledError(await firstError)).toBe(true);
    expect(firstProgress).not.toHaveBeenCalled();
    expect(secondProgress).not.toHaveBeenCalled();

    runner.cancel();
    secondWorker.emit({
      id: secondRequest.id,
      incumbent: createIncumbent("cancelled"),
      type: "one-click-clear-incumbent",
    });

    expect(isGraphwarPathfindingCancelledError(await secondError)).toBe(true);
    expect(secondProgress).not.toHaveBeenCalled();
    expect(firstWorker.terminated).toBe(true);
    expect(secondWorker.terminated).toBe(true);
    runner.close();
  });
});

class FakeWorker {
  static readonly instances: FakeWorker[] = [];
  readonly requests: GraphwarPathfindingWorkerRequest[] = [];
  terminated = false;
  private readonly listeners = {
    error: [] as ((event: ErrorEvent) => void)[],
    message: [] as ((event: MessageEvent<GraphwarPathfindingWorkerResponse>) => void)[],
    messageerror: [] as ((event: MessageEvent) => void)[],
  };

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: "error" | "message" | "messageerror", listener: EventListener) {
    this.listeners[type].push(listener as never);
  }

  postMessage(request: GraphwarPathfindingWorkerRequest) {
    this.requests.push(request);
  }

  terminate() {
    this.terminated = true;
  }

  /** 测试刻意允许已终止 Worker 发出迟到消息，以验证请求身份防护。 */
  emit(response: GraphwarPathfindingWorkerResponse) {
    const event = { data: response } as MessageEvent<GraphwarPathfindingWorkerResponse>;
    for (const listener of this.listeners.message) {
      listener(event);
    }
  }
}

/** 返回测试创建的指定 Worker，缺失时立即暴露生命周期错误。 */
function getWorker(index: number) {
  const worker = FakeWorker.instances[index];
  if (!worker) {
    throw new Error(`Expected pathfinding Worker ${index}`);
  }
  return worker;
}

/** 读取并收窄一键清图请求。 */
function getOneClickClearRequest(worker: FakeWorker, index: number) {
  const request = worker.requests[index];
  if (!request || request.task.type !== "build-one-click-clear-path") {
    throw new Error("Expected one-click-clear Worker request");
  }
  return { id: request.id, task: request.task };
}

/** 构造无需执行实际搜索的纯数据输入。 */
function createInput(): GraphwarOneClickClearPathWorkerInput {
  return {
    boundaryExpansion: 0,
    bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
    boundsRect: { height: 450, width: 770, x: 0, y: 0 },
    candidates: [],
    committedTargets: [],
    dagEdgeWorkerCount: 1,
    deleteOptimizationEnabled: false,
    deleteHitCheckRadiusPixels: 0,
    hitCandidates: [],
    pathPoints: [createPixelPoint(100, 225)],
    routeMaskCacheId: 1,
    routeMode: "visibility-graph",
    routeObstacleMask: new Uint8Array(770 * 450),
    routeTolerancePlanePixels: 2,
    settings: {
      algorithm: "abs",
      decimalPlaces: 4,
      equation: "y",
      steepness: 67,
      stepGlitchMode: false,
      stepOverflowProtection: true,
    },
    simulationBoundaryExpansion: 0,
    simulationMaskCacheId: 0,
  };
}

/** 构造可识别来源的 progress payload。 */
function createIncumbent(id: string): GraphwarOneClickClearIncumbent {
  return {
    expression: "0",
    pathPoints: [createPixelPoint(100, 225), createPixelPoint(200, 225)],
    targetCount: 1,
    targetIds: [id],
    targetSequence: [],
  };
}

/** 构造 master Worker 的最终任务结果。 */
function createResult(): GraphwarOneClickClearPathWorkerResult {
  return {
    result: {
      elapsedMs: 1,
      expandedStates: 1,
      pathPoints: [createPixelPoint(100, 225), createPixelPoint(200, 225)],
      targetIds: ["target"],
      targetSequence: [],
      type: "success",
    },
    timings: [],
  };
}
