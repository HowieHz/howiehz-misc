import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import type { GraphwarBackendExecution } from "../../core/algorithm-backend";
import type { GraphwarAuthoritativeResultCommitContext } from "../../core/authoritative-task";
import type { GraphwarObjectsDetectionResult } from "../../detection/objects";
import {
  createGraphwarDetectionRunner,
  type GraphwarDetectionRunOptions,
  type GraphwarDetectionWorkerTimingEntry,
} from "../../detection/runtime/runner";
import { graphwarKillerLocale } from "../../locale";
import { useGraphwarDetectionWorkflow } from "./workflow";

describe("Graphwar detection workflow commit gate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("publishes only the replay whose result commit lease survives the queued paint", async () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    let runOptions: GraphwarDetectionRunOptions<GraphwarObjectsDetectionResult> | undefined;
    let resolveRunner: ((result: GraphwarObjectsDetectionResult) => void) | undefined;
    const runnerPromise = new Promise<GraphwarObjectsDetectionResult>((resolve) => {
      resolveRunner = resolve;
    });
    const runner: ReturnType<typeof createGraphwarDetectionRunner> = {
      cancel: vi.fn(() => true),
      close: vi.fn(),
      detectAuto: () => Promise.reject(new Error("Unexpected automatic detection")),
      detectBounds: () => Promise.reject(new Error("Unexpected bounds detection")),
      detectObjectsInBounds: (_input, options) => {
        runOptions = options;
        return runnerPromise;
      },
      replayGenerationAsTypescript: vi.fn(() => false),
    };
    const applyDetectedObstacles = vi.fn();
    const createTimingEntriesFromWorker = vi.fn(() => []);
    const finishTimings = vi.fn();
    const detectedSoldiers = ref([]);
    const workflow = useGraphwarDetectionWorkflow({
      boundsRect: ref({ height: 10, width: 10, x: 0, y: 0 }),
      debug: {
        createTimingEntriesFromWorker,
        finishTimings,
        measureStage: (_timings, _stage, task) => task(),
      },
      detectedSoldiers,
      effects: {
        applyDetectedBounds: vi.fn(),
        applyDetectedObstacles,
        clearDetectedObjectSideEffects: vi.fn(),
        clearSmartPathfindingStatus: vi.fn(),
        flashBoundsRect: vi.fn(),
        flashDetectedSoldiers: vi.fn(),
        invalidatePathfindingCaches: vi.fn(),
        markScreenshotResult: vi.fn(),
        setToolModeToPath: vi.fn(),
      },
      formatElapsedDuration: (elapsedMs) => `${elapsedMs}ms`,
      getLocale: () => graphwarKillerLocale,
      getSettings: () => ({
        candidateTopRatio: 1,
        maximumSoldierCount: 40,
        minArea: 1,
        ok: true,
        templateMatchingWorkerCount: 2,
      }),
      hasActiveBounds: () => true,
      image: {
        canSchedule: () => true,
        getImageData: () => ({ data: new Uint8ClampedArray(4), height: 1, width: 1 }) as ImageData,
        isReady: () => true,
      },
      runner,
    });
    const workflowPromise = workflow.detectInCurrentBounds();
    await vi.waitFor(() => expect(animationFrames).toHaveLength(1));
    animationFrames.shift()?.(0);
    await vi.waitFor(() => expect(runOptions?.commitResult).toBeTypeOf("function"));

    const oldResult = createObjectsResult(1);
    const replayResult = createObjectsResult(2);
    const oldTiming = [{ elapsedMs: 1, stage: "detecting-objects" }] satisfies GraphwarDetectionWorkerTimingEntry[];
    const replayTiming = [{ elapsedMs: 2, stage: "detecting-objects" }] satisfies GraphwarDetectionWorkerTimingEntry[];
    const oldBackendExecution = { effective: "wasm", requested: "wasm" } satisfies GraphwarBackendExecution;
    const replayBackendExecution = {
      effective: "typescript",
      fallbackReason: "trap: detection trapped",
      requested: "wasm",
    } satisfies GraphwarBackendExecution;
    const rejectedCommit = createCommitContext(() => false);
    const oldCommitPromise = runOptions?.commitResult?.(oldResult, oldTiming, oldBackendExecution, rejectedCommit);
    await vi.waitFor(() => expect(animationFrames).toHaveLength(1));
    animationFrames.shift()?.(1);
    await oldCommitPromise;

    expect(applyDetectedObstacles).not.toHaveBeenCalled();
    expect(createTimingEntriesFromWorker).not.toHaveBeenCalled();
    expect(finishTimings).not.toHaveBeenCalled();

    const acceptedCommit = createCommitContext((publish) => {
      publish();
      return true;
    });
    const replayCommitPromise = runOptions?.commitResult?.(
      replayResult,
      replayTiming,
      replayBackendExecution,
      acceptedCommit,
    );
    await vi.waitFor(() => expect(animationFrames).toHaveLength(1));
    animationFrames.shift()?.(2);
    await replayCommitPromise;
    resolveRunner?.(replayResult);
    await workflowPromise;

    expect(applyDetectedObstacles).toHaveBeenCalledExactlyOnceWith(replayResult.obstacles);
    expect(createTimingEntriesFromWorker).toHaveBeenCalledExactlyOnceWith(replayTiming);
    expect(finishTimings).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      [],
      replayBackendExecution,
      expect.any(Number),
    );
    expect(workflow.isInProgress.value).toBe(false);
  });
});

function createObjectsResult(count: number): GraphwarObjectsDetectionResult {
  return {
    obstacles: { count, mask: new Uint8Array([count]) },
    soldiers: [],
  };
}

function createCommitContext(
  commit: GraphwarAuthoritativeResultCommitContext["commit"],
): GraphwarAuthoritativeResultCommitContext {
  return {
    attempt: { attemptId: 1, backendGeneration: 1, outerTaskId: 1 },
    commit,
  };
}
