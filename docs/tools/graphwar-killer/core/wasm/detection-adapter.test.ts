import { beforeAll, describe, expect, it } from "vitest";

import { detectGraphwarPlayArea } from "../../detection/objects";
import type { GraphwarDetectionWorkerTask } from "../../detection/runtime/protocol";
import { GraphwarWasmAdapterError, type GraphwarWasmAdapterErrorCode } from "./abi";
import { copyGraphwarWasmDetectionResult, createGraphwarWasmDetectionController } from "./detection-adapter";
import { readGraphwarKernelBytes } from "./kernel-test-fixture";
import { instantiateGraphwarWasmRuntime, type GraphwarWasmKernelRuntime } from "./runtime";

describe("Graphwar WASM detection bounds", () => {
  let module: WebAssembly.Module;

  beforeAll(async () => {
    module = await WebAssembly.compile(await readGraphwarKernelBytes());
  });

  it("matches the TypeScript edge rectangle with observable start/end stage boundaries", async () => {
    const imageData = createAxisFixture(101, 63, [10, 50, 90], [8, 31, 56]);
    const runtime = await createRuntime(module);
    const controller = createGraphwarWasmDetectionController(runtime);
    const started = controller.begin({
      backendGeneration: 3,
      requestId: 7,
      task: { imageData, type: "detect-bounds-only" },
    });
    expect(started).toMatchObject({
      stageEvents: [{ phase: "start", stage: "detecting-bounds" }],
      taskType: "detect-bounds-only",
      type: "running",
    });
    expect(controller.resumeBounds(started.handle)).toEqual({
      result: {
        edgeRect: detectGraphwarPlayArea(imageData),
        stageEvents: [{ phase: "end", stage: "detecting-bounds" }],
        taskType: "detect-bounds-only",
      },
      type: "complete",
    });
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("preserves a normal no-bounds result and releases its complete session", async () => {
    const imageData = createWhiteImage(64, 40);
    const runtime = await createRuntime(module);
    const controller = createGraphwarWasmDetectionController(runtime);
    const started = controller.begin({
      backendGeneration: 1,
      requestId: 1,
      task: { imageData, thresholds: { minArea: 10 }, type: "detect-auto" },
    });
    expect(controller.resumeBounds(started.handle)).toEqual({
      result: {
        stageEvents: [{ phase: "end", stage: "detecting-bounds" }],
        taskType: "detect-auto",
      },
      type: "complete",
    });
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("retains an atomic object session for detected and caller-supplied bounds", async () => {
    const imageData = createAxisFixture(101, 63, [10, 50, 90], [8, 31, 56]);
    const autoRuntime = await createRuntime(module);
    const autoController = createGraphwarWasmDetectionController(autoRuntime);
    const autoStarted = autoController.begin({
      backendGeneration: 2,
      requestId: 5,
      task: { imageData, thresholds: { minArea: 10 }, type: "detect-auto" },
    });
    expect(autoController.resumeBounds(autoStarted.handle)).toMatchObject({
      edgeRect: detectGraphwarPlayArea(imageData),
      handle: autoStarted.handle,
      taskType: "detect-auto",
      type: "running",
    });
    expectAdapterErrorCode(() => autoController.resumeBounds(autoStarted.handle), "invalid-session-state");
    expectAdapterErrorCode(
      () =>
        autoController.begin({
          backendGeneration: 2,
          requestId: 7,
          task: { imageData, type: "detect-bounds-only" },
        }),
      "invalid-session-state",
    );
    autoController.cancel(autoStarted.handle);
    expect(autoRuntime.arenaCursor).toBe(autoRuntime.arenaBase);

    const edgeRect = { height: 45.5, width: 77.25, x: 3.5, y: 4.25 };
    const knownTask = {
      edgeRect,
      imageData,
      thresholds: { minArea: 10 },
      type: "detect-bounds",
    } satisfies GraphwarDetectionWorkerTask;
    const knownRuntime = await createRuntime(module);
    const knownController = createGraphwarWasmDetectionController(knownRuntime);
    const known = knownController.begin({ backendGeneration: 2, requestId: 6, task: knownTask });
    expect(known).toMatchObject({ edgeRect, stageEvents: [], taskType: "detect-bounds", type: "running" });
    knownController.cancel(known.handle);
    expect(knownRuntime.arenaCursor).toBe(knownRuntime.arenaBase);
  });

  it("matches stable selection across dimensions, thick axes, and sub-threshold noise", async () => {
    const runtime = await createRuntime(module);
    const fixtures = [
      createAxisFixture(160, 100, [15, 80, 145], [12, 50, 88]),
      createAxisFixture(203, 123, [20, 101, 181], [15, 61, 108], 2),
      createAxisFixture(
        190,
        112,
        [6, 22, 38, 54, 70, 86, 102, 118, 134, 150, 166, 182],
        [5, 14, 23, 32, 41, 50, 59, 68, 77, 86, 95, 104],
      ),
    ];
    for (const imageData of fixtures) {
      for (let x = 1; x < Math.floor(imageData.width / 5); x += 1) {
        setPixel(imageData, x, 2, 0);
      }
      const controller = createGraphwarWasmDetectionController(runtime);
      const started = controller.begin({
        backendGeneration: 1,
        requestId: imageData.width,
        task: { imageData, type: "detect-bounds-only" },
      });
      const complete = controller.resumeBounds(started.handle);
      const expectedEdgeRect = detectGraphwarPlayArea(imageData);
      expect(expectedEdgeRect).toBeDefined();
      expect(complete.type).toBe("complete");
      if (complete.type === "complete") {
        expect(complete.result.edgeRect).toEqual(expectedEdgeRect);
      }
    }
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects malformed result state, stage order, and edge records at the Adapter boundary", () => {
    const buffer = new ArrayBuffer(256);
    const memory = { arenaBase: 8, arenaCursor: 256, buffer };
    const resultPointer = 64;
    const stagePointer = 48;
    const resultView = new DataView(buffer, resultPointer, 64);
    resultView.setUint32(0, 1, true);
    resultView.setUint32(4, 1, true);
    resultView.setUint32(8, 1, true);
    resultView.setUint32(12, stagePointer, true);
    resultView.setUint32(16, 2, true);
    resultView.setFloat64(32, 1, true);
    resultView.setFloat64(40, 2, true);
    resultView.setFloat64(48, 3, true);
    resultView.setFloat64(56, 4, true);
    const stages = new Uint32Array(buffer, stagePointer, 2);
    stages.set([1, 2]);
    expect(copyGraphwarWasmDetectionResult(memory, resultPointer, 32, "detect-bounds-only", [1, 2])).toMatchObject({
      edgeRect: { height: 4, width: 3, x: 1, y: 2 },
      state: 1,
    });

    stages.set([2, 1]);
    expectDetectionResultError(() =>
      copyGraphwarWasmDetectionResult(memory, resultPointer, 32, "detect-bounds-only", [1, 2]),
    );
    stages.set([1, 2]);
    resultView.setFloat64(48, 0, true);
    expectDetectionResultError(() =>
      copyGraphwarWasmDetectionResult(memory, resultPointer, 32, "detect-bounds-only", [1, 2]),
    );
  });
});

async function createRuntime(module: WebAssembly.Module): Promise<GraphwarWasmKernelRuntime> {
  return instantiateGraphwarWasmRuntime(module, { initialArenaCapacity: 64 });
}

function createWhiteImage(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  return { data, height, width } as ImageData;
}

function createAxisFixture(
  width: number,
  height: number,
  verticalAxes: readonly number[],
  horizontalAxes: readonly number[],
  thickness = 1,
): ImageData {
  const image = createWhiteImage(width, height);
  for (const x of verticalAxes) {
    for (let offset = 0; offset < thickness; offset += 1) {
      for (let y = 0; y < height; y += 1) {
        setPixel(image, x + offset, y, 0);
      }
    }
  }
  for (const y of horizontalAxes) {
    for (let offset = 0; offset < thickness; offset += 1) {
      for (let x = 0; x < width; x += 1) {
        setPixel(image, x, y + offset, 0);
      }
    }
  }
  return image;
}

function expectDetectionResultError(task: () => unknown): void {
  expectAdapterErrorCode(task, "invalid-detection-result");
}

function expectAdapterErrorCode(task: () => unknown, code: GraphwarWasmAdapterErrorCode): void {
  let error: unknown;
  try {
    task();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(GraphwarWasmAdapterError);
  expect(error).toMatchObject({ code });
}

function setPixel(image: ImageData, x: number, y: number, value: number): void {
  const offset = (y * image.width + x) * 4;
  image.data[offset] = value;
  image.data[offset + 1] = value;
  image.data[offset + 2] = value;
  image.data[offset + 3] = 255;
}
