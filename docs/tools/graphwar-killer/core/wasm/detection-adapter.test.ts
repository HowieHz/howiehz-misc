import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  collectSoldierTemplateCenterCandidatesForMatching,
  countObstacleMaskComponents,
  createSoldierDetectionBoxes,
  detectGraphwarObstaclesInBounds,
  detectGraphwarPlayArea,
  finalizeSoldierTemplateMatches,
  getGraphwarDetectionScale,
  matchSoldierTemplates,
} from "../../detection/objects";
import type { GraphwarDetectionWorkerTask } from "../../detection/runtime/protocol";
import { GraphwarWasmFault } from "../algorithm-backend";
import {
  GraphwarWasmAdapterError,
  type GraphwarWasmAdapterErrorCode,
  type GraphwarWasmAdapterFaultDomain,
} from "./abi";
import {
  copyGraphwarWasmDetectionResult,
  createGraphwarWasmDetectionController,
  runGraphwarWasmDetectionTemplateShard,
} from "./detection-adapter";
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
    expect(known).toMatchObject({
      edgeRect,
      stageEvents: [{ phase: "start", stage: "collecting-soldier-candidates" }],
      taskType: "detect-bounds",
      type: "running",
    });
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

  it("matches candidate, template shard, stable merge, and nested arena semantics", async () => {
    const imageData = createWhiteImage(120, 72);
    const edgeRect = { height: 64, width: 110, x: 5, y: 3 };
    for (const [x, y] of [
      [24, 22],
      [25, 22],
      [91, 44],
      [92, 44],
    ] as const) {
      setPixel(imageData, x, y, 0xff, 0xe8, 0x20);
    }
    const settings = { candidateTopRatio: 1, maximumSoldierCount: 40, templateMatchingWorkerCount: 4 };
    const task = {
      edgeRect,
      imageData,
      soldierSettings: settings,
      thresholds: { minArea: 3 },
      type: "detect-bounds",
    } satisfies GraphwarDetectionWorkerTask;
    const expectedCandidates = collectSoldierTemplateCenterCandidatesForMatching(imageData, edgeRect, settings);
    expect(expectedCandidates.length).toBeGreaterThan(1);

    const runtime = await createRuntime(module);
    const controller = createGraphwarWasmDetectionController(runtime);
    const started = controller.begin({ backendGeneration: 4, requestId: 19, task });
    const candidateState = controller.resumeCandidates(started.handle);
    expect(candidateState.candidates.map(({ candidateIndex: _, ...candidate }) => candidate)).toEqual(
      expectedCandidates,
    );
    expect(candidateState.shards.map((shard) => shard.id)).toEqual(
      Array.from({ length: Math.min(4, expectedCandidates.length) }, (_, index) => index + 1),
    );

    const retainedCursor = runtime.arenaCursor;
    const largeFallbackImage = createWhiteImage(802, 632);
    const byteLengthBeforeFallback = runtime.buffer.byteLength;
    runGraphwarWasmDetectionTemplateShard(runtime, {
      candidates: [{ candidateIndex: 0, isMirrored: false, votes: 1, x: 100, y: 100 }],
      edgeRect: { height: 600, width: 780, x: 5, y: 4 },
      imageData: largeFallbackImage,
    });
    expect(runtime.buffer.byteLength).toBeGreaterThan(byteLengthBeforeFallback);
    expect(runtime.arenaCursor).toBe(retainedCursor);
    const shardResults = candidateState.shards.map((shard) => {
      const matches = runGraphwarWasmDetectionTemplateShard(runtime, {
        candidates: shard.candidates,
        edgeRect,
        imageData,
      });
      expect(runtime.arenaCursor).toBe(retainedCursor);
      const expectedMatches = matchSoldierTemplates(
        imageData,
        edgeRect,
        getGraphwarDetectionScale(edgeRect),
        shard.candidates,
      );
      expect(matches.map(({ candidateIndex: _, ...match }) => match)).toEqual(expectedMatches);
      return { id: shard.id, matches, session: candidateState.handle };
    });
    const completedTemplates = controller.resumeTemplates(started.handle, shardResults.reverse());
    const expectedMatches = finalizeSoldierTemplateMatches(
      matchSoldierTemplates(imageData, edgeRect, getGraphwarDetectionScale(edgeRect), expectedCandidates),
      getGraphwarDetectionScale(edgeRect),
      settings,
    );
    expect(completedTemplates.matches.map(({ candidateIndex: _, ...match }) => match)).toEqual(expectedMatches);
    expect(controller.resumeObstacleMask(started.handle).stageEvents).toEqual([
      { phase: "end", stage: "building-obstacle-mask" },
      { phase: "start", stage: "filtering-obstacle-components" },
    ]);
    const completed = controller.resumeObstacleComponents(started.handle);
    expect(completed.result).toMatchObject({ obstacleCount: 0 });
    expect(completed.result.obstacleMask).toEqual(new Uint8Array(770 * 450));
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("keeps serial and 1/2/4/N shard configurations equivalent", async () => {
    const { edgeRect, imageData } = createTemplateCandidateFixture();
    for (const templateMatchingWorkerCount of [1, 2, 4, 9]) {
      const settings = { candidateTopRatio: 1, maximumSoldierCount: 40, templateMatchingWorkerCount };
      const task = {
        edgeRect,
        imageData,
        soldierSettings: settings,
        thresholds: { minArea: 3 },
        type: "detect-bounds",
      } satisfies GraphwarDetectionWorkerTask;
      const expectedCandidates = collectSoldierTemplateCenterCandidatesForMatching(imageData, edgeRect, settings);
      const runtime = await createRuntime(module);
      const controller = createGraphwarWasmDetectionController(runtime);
      const started = controller.begin({ backendGeneration: 7, requestId: templateMatchingWorkerCount, task });
      const candidateState = controller.resumeCandidates(started.handle);
      expect(candidateState.shards).toHaveLength(
        templateMatchingWorkerCount === 1 ? 0 : Math.min(templateMatchingWorkerCount, expectedCandidates.length),
      );
      const shardResults = candidateState.shards.map((shard) => ({
        id: shard.id,
        matches: runGraphwarWasmDetectionTemplateShard(runtime, { candidates: shard.candidates, edgeRect, imageData }),
        session: candidateState.handle,
      }));
      const result = controller.resumeTemplates(started.handle, shardResults.reverse());
      expect(result.matches.map(({ candidateIndex: _, ...match }) => match)).toEqual(
        finalizeSoldierTemplateMatches(
          matchSoldierTemplates(imageData, edgeRect, getGraphwarDetectionScale(edgeRect), expectedCandidates),
          getGraphwarDetectionScale(edgeRect),
          settings,
        ),
      );
      controller.resumeObstacleMask(started.handle);
      controller.resumeObstacleComponents(started.handle);
      expect(runtime.arenaCursor).toBe(runtime.arenaBase);
    }
  });

  it("discards an issued shard batch and recomputes every candidate in the main WASM instance", async () => {
    const { edgeRect, imageData } = createTemplateCandidateFixture();
    const settings = { candidateTopRatio: 1, maximumSoldierCount: 40, templateMatchingWorkerCount: 4 };
    const task = {
      edgeRect,
      imageData,
      soldierSettings: settings,
      thresholds: { minArea: 3 },
      type: "detect-bounds",
    } satisfies GraphwarDetectionWorkerTask;
    const runtime = await createRuntime(module);
    const controller = createGraphwarWasmDetectionController(runtime);
    const started = controller.begin({ backendGeneration: 7, requestId: 19, task });
    const candidates = controller.resumeCandidates(started.handle);

    expect(candidates.shards.length).toBeGreaterThan(1);
    const templates = controller.resumeTemplatesSerial(started.handle);

    expect(templates.matches.map(({ candidateIndex: _, ...match }) => match)).toEqual(
      finalizeSoldierTemplateMatches(
        matchSoldierTemplates(
          imageData,
          edgeRect,
          getGraphwarDetectionScale(edgeRect),
          collectSoldierTemplateCenterCandidatesForMatching(imageData, edgeRect, settings),
        ),
        getGraphwarDetectionScale(edgeRect),
        settings,
      ),
    );
    expect(templates.edgeRect).toEqual(edgeRect);
    controller.resumeObstacleMask(started.handle);
    controller.resumeObstacleComponents(started.handle);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects missing, duplicate, and foreign shard results without polluting the session", async () => {
    const { edgeRect, imageData } = createTemplateCandidateFixture();
    const task = {
      edgeRect,
      imageData,
      soldierSettings: { candidateTopRatio: 1, maximumSoldierCount: 40, templateMatchingWorkerCount: 2 },
      thresholds: { minArea: 3 },
      type: "detect-bounds",
    } satisfies GraphwarDetectionWorkerTask;
    const runtime = await createRuntime(module);
    const controller = createGraphwarWasmDetectionController(runtime);
    const started = controller.begin({ backendGeneration: 8, requestId: 31, task });
    const candidateState = controller.resumeCandidates(started.handle);
    const results = candidateState.shards.map((shard) => ({
      id: shard.id,
      matches: runGraphwarWasmDetectionTemplateShard(runtime, { candidates: shard.candidates, edgeRect, imageData }),
      session: candidateState.handle,
    }));
    expectAdapterErrorCode(() => controller.resumeTemplates(started.handle, []), "missing-work-id");
    expectAdapterErrorCode(
      () =>
        controller.resumeTemplates(
          started.handle,
          results.map((result) => results[0] ?? result),
        ),
      "duplicate-work-id",
    );
    expectAdapterErrorCode(
      () =>
        controller.resumeTemplates(
          started.handle,
          results.map((result) => ({ ...result, id: result.id + 20 })),
        ),
      "missing-work-id",
    );
    expectAdapterErrorCode(
      () =>
        controller.resumeTemplates(
          started.handle,
          results.map((result) => ({
            ...result,
            session: { ...result.session, nonce: result.session.nonce + 1 },
          })),
        ),
      "invalid-session-identity",
    );
    expectAdapterErrorCode(
      () =>
        controller.resumeTemplates(
          started.handle,
          results.map((result) => ({
            ...result,
            session: { ...result.session, taskType: "one-click-clear" as const },
          })),
        ),
      "invalid-session-identity",
    );
    controller.resumeTemplates(started.handle, results);
    expectAdapterErrorCode(() => controller.resumeTemplates(started.handle, results), "invalid-session-state");
    controller.cancel(started.handle);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects malformed result state, stage order, and edge records at the Adapter boundary", () => {
    const buffer = new ArrayBuffer(256);
    const memory = { arenaBase: 8, arenaCursor: 256, buffer };
    const resultPointer = 64;
    const stagePointer = 48;
    const resultView = new DataView(buffer, resultPointer, 96);
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
    expect(
      copyGraphwarWasmDetectionResult(memory, resultPointer, 32, 32, "detect-bounds-only", [1, 2], []),
    ).toMatchObject({
      edgeRect: { height: 4, width: 3, x: 1, y: 2 },
      state: 1,
    });

    resultView.setUint32(0, 99, true);
    expectAdapterErrorCode(
      () => copyGraphwarWasmDetectionResult(memory, resultPointer, 32, 32, "detect-bounds-only", [1, 2], []),
      "invalid-enum",
      "output",
    );
    resultView.setUint32(0, 1, true);
    resultView.setFloat64(32, Number.NaN, true);
    expectAdapterErrorCode(
      () => copyGraphwarWasmDetectionResult(memory, resultPointer, 32, 32, "detect-bounds-only", [1, 2], []),
      "invalid-finite-number",
      "output",
    );
    resultView.setFloat64(32, 1, true);

    stages.set([2, 1]);
    expectDetectionResultError(() =>
      copyGraphwarWasmDetectionResult(memory, resultPointer, 32, 32, "detect-bounds-only", [1, 2], []),
    );
    stages.set([1, 2]);
    resultView.setFloat64(48, 0, true);
    expectDetectionResultError(() =>
      copyGraphwarWasmDetectionResult(memory, resultPointer, 32, 32, "detect-bounds-only", [1, 2], []),
    );
  });

  it("matches obstacle resampling, morphology, guide removal, soldier clearing, and component restoration", async () => {
    const imageData = createWhiteImage(140, 90);
    const edgeRect = { height: 80, width: 130, x: 5, y: 4 };
    for (let x = 24; x <= 52; x += 1) {
      // red > green used to underflow an unsigned `green - red` green-pixel check in WASM.
      setPixel(imageData, x, 21, 170, 160, 130);
      setPixel(imageData, x, 42, 170, 160, 130);
    }
    for (let y = 22; y < 42; y += 1) {
      setPixel(imageData, 24, y, 170, 160, 130);
      setPixel(imageData, 52, y, 170, 160, 130);
    }
    for (let y = 22; y < 42; y += 1) {
      for (let x = 25; x < 52; x += 1) {
        setPixel(imageData, x, y, 64, 64, 64);
      }
    }
    for (let y = 34; y < 58; y += 1) {
      for (let x = 66; x < 93; x += 1) {
        setPixel(imageData, x, y, 88, 88, 88);
      }
    }
    const task = {
      edgeRect,
      imageData,
      soldierSettings: { candidateTopRatio: 1, maximumSoldierCount: 40, templateMatchingWorkerCount: 1 },
      thresholds: { minArea: 12 },
      type: "detect-bounds",
    } satisfies GraphwarDetectionWorkerTask;
    const runtime = await createRuntime(module);
    const controller = createGraphwarWasmDetectionController(runtime);
    const started = controller.begin({ backendGeneration: 9, requestId: 41, task });
    const candidates = controller.resumeCandidates(started.handle);
    const templates = controller.resumeTemplates(started.handle);
    expect(candidates.shards).toHaveLength(0);
    const byteLengthBeforeObstacleScratch = runtime.buffer.byteLength;
    controller.resumeObstacleMask(started.handle);
    expect(runtime.buffer.byteLength).toBeGreaterThan(byteLengthBeforeObstacleScratch);
    const completed = controller.resumeObstacleComponents(started.handle);
    const expected = detectGraphwarObstaclesInBounds(
      imageData,
      edgeRect,
      task.thresholds,
      createSoldierDetectionBoxes(
        templates.matches.map(({ candidateIndex: _, ...match }) => match),
        edgeRect,
      ),
    );
    expect(completed.result.obstacleCount).toBe(expected.count);
    expect(completed.result.obstacleMask).toEqual(expected.mask);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
    expect(runtime.getArenaDiagnostics()).toMatchObject({ allocatorCallCount: 1, isCanaryIntact: true });
  });

  it("preserves bounding-box restoration count when one seed component encloses another", async () => {
    const imageData = createWhiteImage(780, 460);
    const edgeRect = { height: 450, width: 770, x: 5, y: 4 };
    for (let y = 100; y <= 250; y += 1) {
      for (let x = 100; x <= 110; x += 1) {
        setPixel(imageData, edgeRect.x + x, edgeRect.y + y, 64);
      }
    }
    for (const startY of [100, 240]) {
      for (let y = startY; y <= startY + 10; y += 1) {
        for (let x = 100; x <= 300; x += 1) {
          setPixel(imageData, edgeRect.x + x, edgeRect.y + y, 64);
        }
      }
    }
    for (let y = 160; y <= 180; y += 1) {
      for (let x = 200; x <= 220; x += 1) {
        setPixel(imageData, edgeRect.x + x, edgeRect.y + y, 64);
      }
    }
    const task = {
      edgeRect,
      imageData,
      soldierSettings: { candidateTopRatio: 1, maximumSoldierCount: 40, templateMatchingWorkerCount: 1 },
      thresholds: { minArea: 3 },
      type: "detect-bounds",
    } satisfies GraphwarDetectionWorkerTask;
    const expected = detectGraphwarObstaclesInBounds(imageData, edgeRect, task.thresholds, []);
    expect(expected.count).toBe(1);
    expect(countObstacleMaskComponents(expected.mask)).toBe(2);

    const runtime = await createRuntime(module);
    const controller = createGraphwarWasmDetectionController(runtime);
    const completed = runCompleteObstacleTask(controller, task, 43);
    expect(completed.result.obstacleMask).toEqual(expected.mask);
    expect(completed.result.obstacleCount).toBe(expected.count);
  });

  it("removes accepted soldier visual regions before restoring obstacle details", async () => {
    const imageData = createWhiteImage(120, 72);
    const edgeRect = { height: 64, width: 110, x: 5, y: 3 };
    for (let y = 26; y <= 42; y += 1) {
      for (let x = 51; x <= 69; x += 1) {
        setPixel(imageData, x, y, 56, 56, 56);
      }
    }
    setPixel(imageData, 60, 34, 0xff, 0xe8, 0x20);
    setPixel(imageData, 61, 34, 0xff, 0xe8, 0x20);
    const task = {
      edgeRect,
      imageData,
      soldierSettings: { candidateTopRatio: 1, maximumSoldierCount: 40, templateMatchingWorkerCount: 2 },
      thresholds: { minArea: 3 },
      type: "detect-bounds",
    } satisfies GraphwarDetectionWorkerTask;
    const runtime = await createRuntime(module);
    const controller = createGraphwarWasmDetectionController(runtime);
    const started = controller.begin({ backendGeneration: 10, requestId: 42, task });
    const candidates = controller.resumeCandidates(started.handle);
    expect(candidates.shards.length).toBeGreaterThan(0);
    const shardResults = candidates.shards.map((shard) => ({
      id: shard.id,
      matches: runGraphwarWasmDetectionTemplateShard(runtime, {
        candidates: shard.candidates,
        edgeRect,
        imageData,
      }).map((match) => ({
        ...match,
        fixedScore: 1,
        foregroundScore: 1,
        playerScore: 1,
        score: 1,
        signatureScore: 1,
      })),
      session: candidates.handle,
    }));
    const templates = controller.resumeTemplates(started.handle, shardResults);
    expect(templates.matches.length).toBeGreaterThan(0);
    controller.resumeObstacleMask(started.handle);
    const completed = controller.resumeObstacleComponents(started.handle);
    const soldiers = createSoldierDetectionBoxes(
      templates.matches.map(({ candidateIndex: _, ...match }) => match),
      edgeRect,
    );
    const expected = detectGraphwarObstaclesInBounds(imageData, edgeRect, task.thresholds, soldiers);
    const withoutSoldiers = detectGraphwarObstaclesInBounds(imageData, edgeRect, task.thresholds, []);
    expect(completed.result.obstacleMask).toEqual(expected.mask);
    expect(completed.result.obstacleCount).toBe(expected.count);
    expect(completed.result.obstacleMask).not.toEqual(withoutSoldiers.mask);
  });

  it("reuses the obstacle arena high-water mark across alternating large and small tasks", async () => {
    const runtime = await createRuntime(module);
    const controller = createGraphwarWasmDetectionController(runtime);
    const largeImage = createWhiteImage(802, 632);
    const smallImage = createWhiteImage(96, 64);
    for (let componentIndex = 0; componentIndex < 8; componentIndex += 1) {
      const startX = 40 + (componentIndex % 4) * 160;
      const startY = 90 + Math.floor(componentIndex / 4) * 220;
      for (let y = startY; y < startY + 12; y += 1) {
        for (let x = startX; x < startX + 12; x += 1) {
          setPixel(largeImage, x, y, 48);
        }
      }
      setPixel(largeImage, 80 + componentIndex * 70, 45, 0xff, 0xe8, 0x20);
      setPixel(largeImage, 81 + componentIndex * 70, 45, 0xff, 0xe8, 0x20);
    }
    const createTask = (imageData: ImageData) =>
      ({
        edgeRect: { height: imageData.height - 8, width: imageData.width - 10, x: 5, y: 4 },
        imageData,
        soldierSettings: { candidateTopRatio: 1, maximumSoldierCount: 40, templateMatchingWorkerCount: 1 },
        thresholds: { minArea: 3 },
        type: "detect-bounds",
      }) satisfies GraphwarDetectionWorkerTask;
    const largeTask = createTask(largeImage);
    const smallTask = createTask(smallImage);

    const warmResult = runCompleteObstacleTask(controller, largeTask, 1);
    expect(warmResult.candidateCount).toBeGreaterThan(0);
    expect(warmResult.result.obstacleCount).toBeGreaterThan(0);
    const stableByteLength = runtime.buffer.byteLength;
    const stablePeak = runtime.getArenaDiagnostics().peakUsedBytes;
    for (let iteration = 0; iteration < 4; iteration += 1) {
      const result = runCompleteObstacleTask(controller, iteration % 2 === 0 ? smallTask : largeTask, iteration + 2);
      expect(result.candidateCount > 0).toBe(iteration % 2 !== 0);
      expect(result.result.obstacleCount > 0).toBe(iteration % 2 !== 0);
      expect(runtime.buffer.byteLength).toBe(stableByteLength);
      expect(runtime.arenaCursor).toBe(runtime.arenaBase);
      expect(runtime.getArenaDiagnostics()).toMatchObject({
        allocatorCallCount: 1,
        isCanaryIntact: true,
        peakUsedBytes: stablePeak,
      });
    }
  });

  it("rejects aliased detection output arrays", () => {
    const buffer = new ArrayBuffer(512);
    const memory = { arenaBase: 8, arenaCursor: 512, buffer };
    const sharedPointer = 64;
    const resultPointer = 160;
    const resultView = new DataView(buffer, resultPointer, 96);
    resultView.setUint32(0, 1, true);
    resultView.setUint32(4, 1, true);
    resultView.setUint32(12, sharedPointer, true);
    resultView.setUint32(16, 2, true);
    resultView.setUint32(64, sharedPointer, true);
    resultView.setUint32(68, 1, true);
    new Uint32Array(buffer, sharedPointer, 2).set([1, 2]);
    const candidateView = new DataView(buffer, sharedPointer, 32);
    candidateView.setUint32(16, 1, true);

    expectDetectionResultError(() =>
      copyGraphwarWasmDetectionResult(memory, resultPointer, 32, 32, "detect-bounds-only", [1, 2], []),
    );
  });

  it("rejects an obstacle mask that overlaps its result record", () => {
    const fixture = createCompletedObstacleResultMemory();
    fixture.resultView.setUint32(80, fixture.maskPointer + 8, true);
    expectDetectionResultError(() =>
      copyGraphwarWasmDetectionResult(fixture.memory, fixture.resultPointer, 32, 32, "detect-bounds", [10], []),
    );
  });

  it("binds obstacle component count to the actual solid mask pixels", () => {
    const fixture = createCompletedObstacleResultMemory();
    expect(
      copyGraphwarWasmDetectionResult(fixture.memory, fixture.resultPointer, 32, 32, "detect-bounds", [10], []),
    ).toMatchObject({ obstacleCount: 0, obstacleMask: new Uint8Array(770 * 450) });

    fixture.mask[0] = 1;
    expectDetectionResultError(() =>
      copyGraphwarWasmDetectionResult(fixture.memory, fixture.resultPointer, 32, 32, "detect-bounds", [10], []),
    );
    fixture.resultView.setUint32(88, 2, true);
    expectDetectionResultError(() =>
      copyGraphwarWasmDetectionResult(fixture.memory, fixture.resultPointer, 32, 32, "detect-bounds", [10], []),
    );
  });

  it("unwinds an obstacle command's leaked nested mark without replacing the original fault", async () => {
    const runtime = await createRuntime(module);
    const controller = createGraphwarWasmDetectionController(runtime);
    const task = {
      edgeRect: { height: 56, width: 86, x: 5, y: 4 },
      imageData: createWhiteImage(96, 64),
      soldierSettings: { candidateTopRatio: 1, maximumSoldierCount: 40, templateMatchingWorkerCount: 1 },
      thresholds: { minArea: 3 },
      type: "detect-bounds",
    } satisfies GraphwarDetectionWorkerTask;
    const started = controller.begin({ backendGeneration: 13, requestId: 1, task });
    controller.resumeCandidates(started.handle);
    controller.resumeTemplates(started.handle);
    const fault = new GraphwarWasmFault("trap", "injected obstacle scratch trap");
    vi.spyOn(runtime, "resumeDetectionTask").mockImplementationOnce(() => {
      runtime.markArena();
      throw fault;
    });

    let thrown: unknown;
    try {
      controller.resumeObstacleMask(started.handle);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(fault);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
    expect(runtime.getArenaDiagnostics()).toMatchObject({ allocatorCallCount: 1, isCanaryIntact: true });

    runCompleteObstacleTask(controller, task, 2);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("classifies malformed template output and changed candidate identity as a typed output fault", async () => {
    const { edgeRect, imageData } = createTemplateCandidateFixture();
    const settings = { candidateTopRatio: 1, maximumSoldierCount: 40, templateMatchingWorkerCount: 2 };
    const [candidate] = collectSoldierTemplateCenterCandidatesForMatching(imageData, edgeRect, settings);
    expect(candidate).toBeDefined();
    const runtime = await createRuntime(module);
    const runShard = runtime.runDetectionTemplateShard.bind(runtime);
    vi.spyOn(runtime, "runDetectionTemplateShard").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runShard(inputPointer, inputByteLength);
      const resultView = new DataView(runtime.buffer, resultPointer, 16);
      const matchPointer = resultView.getUint32(0, true);
      const matchView = new DataView(runtime.buffer, matchPointer, 72);
      matchView.setFloat64(0, matchView.getFloat64(0, true) + 1, true);
      return resultPointer;
    });

    let error: unknown;
    try {
      runGraphwarWasmDetectionTemplateShard(runtime, {
        candidates: [{ ...candidate, candidateIndex: 0 }],
        edgeRect,
        imageData,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(GraphwarWasmFault);
    expect(error).toMatchObject({ code: "output" });
  });
});

function runCompleteObstacleTask(
  controller: ReturnType<typeof createGraphwarWasmDetectionController>,
  task: Extract<GraphwarDetectionWorkerTask, { type: "detect-bounds" }>,
  requestId: number,
) {
  const started = controller.begin({ backendGeneration: 12, requestId, task });
  const candidates = controller.resumeCandidates(started.handle);
  expect(candidates.shards).toHaveLength(0);
  controller.resumeTemplates(started.handle);
  controller.resumeObstacleMask(started.handle);
  return {
    candidateCount: candidates.candidates.length,
    result: controller.resumeObstacleComponents(started.handle).result,
  };
}

function createCompletedObstacleResultMemory() {
  const maskLength = 770 * 450;
  const maskPointer = 64;
  const resultPointer = 346_568;
  const buffer = new ArrayBuffer(resultPointer + 96);
  const memory = { arenaBase: 8, arenaCursor: buffer.byteLength, buffer };
  new Uint32Array(buffer, 32, 1)[0] = 10;
  const resultView = new DataView(buffer, resultPointer, 96);
  resultView.setUint32(0, 1, true);
  resultView.setUint32(4, 3, true);
  resultView.setUint32(8, 1, true);
  resultView.setUint32(12, 32, true);
  resultView.setUint32(16, 1, true);
  resultView.setFloat64(32, 1, true);
  resultView.setFloat64(40, 2, true);
  resultView.setFloat64(48, 770, true);
  resultView.setFloat64(56, 450, true);
  resultView.setUint32(80, maskPointer, true);
  resultView.setUint32(84, maskLength, true);
  return {
    mask: new Uint8Array(buffer, maskPointer, maskLength),
    maskPointer,
    memory,
    resultPointer,
    resultView,
  };
}

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

function createTemplateCandidateFixture() {
  const imageData = createWhiteImage(120, 72);
  const edgeRect = { height: 64, width: 110, x: 5, y: 3 };
  for (const [x, y] of [
    [24, 22],
    [25, 22],
    [91, 44],
    [92, 44],
  ] as const) {
    setPixel(imageData, x, y, 0xff, 0xe8, 0x20);
  }
  return { edgeRect, imageData };
}

function expectDetectionResultError(task: () => unknown): void {
  expectAdapterErrorCode(task, "invalid-detection-result", "output");
}

function expectAdapterErrorCode(
  task: () => unknown,
  code: GraphwarWasmAdapterErrorCode,
  faultDomain?: GraphwarWasmAdapterFaultDomain,
): void {
  let error: unknown;
  try {
    task();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(GraphwarWasmAdapterError);
  expect(error).toMatchObject({ code, ...(faultDomain === undefined ? {} : { faultDomain }) });
}

function setPixel(image: ImageData, x: number, y: number, red: number, green = red, blue = red): void {
  const offset = (y * image.width + x) * 4;
  image.data[offset] = red;
  image.data[offset + 1] = green;
  image.data[offset + 2] = blue;
  image.data[offset + 3] = 255;
}
