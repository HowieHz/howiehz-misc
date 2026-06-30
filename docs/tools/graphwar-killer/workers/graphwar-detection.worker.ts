/** 在 Web Worker 中执行耗时的 Graphwar 截图识别，避免阻塞页面主线程。 */
import {
  collectSoldierTemplateCenterCandidatesForMatching,
  createSoldierDetectionBoxes,
  detectGraphwarObstaclesInBounds,
  detectGraphwarObjectsInBounds,
  detectGraphwarPlayArea,
  finalizeSoldierTemplateMatches,
  getGraphwarDetectionScale,
  getGraphwarSoldierDetectionSettings,
  matchSoldierTemplates,
} from "../graphwar-detection";
import type {
  GraphwarDetectionWarning,
  GraphwarObjectDetectionInstrumentation,
  GraphwarObjectDetectionStage,
  GraphwarObjectsDetectionResult,
  GraphwarObstacleDetectionThresholds,
  GraphwarSoldierDetectionSettings,
  SoldierMatchCandidate,
  SoldierTemplateCenterCandidate,
} from "../graphwar-detection";
import type {
  GraphwarAutoDetectionResult,
  GraphwarDetectionWorkerTask,
  GraphwarDetectionWorkerRequest,
  GraphwarDetectionWorkerResponse,
  GraphwarDetectionWorkerStage,
  GraphwarDetectionWorkerTimingDetail,
  GraphwarDetectionWorkerTimingEntry,
} from "../graphwar-detection-worker-types";
import type { BoundsRect } from "../types";
import type {
  GraphwarSoldierTemplateWorkerRequest,
  GraphwarSoldierTemplateWorkerResponse,
} from "./graphwar-soldier-template-worker-types";

interface GraphwarDetectionWorkerScope {
  addEventListener: (type: "message", listener: (event: MessageEvent<GraphwarDetectionWorkerRequest>) => void) => void;
  postMessage: (message: GraphwarDetectionWorkerResponse, transfer?: Transferable[]) => void;
}

interface SoldierTemplateWorkerTask {
  candidates: SoldierTemplateCenterCandidate[];
  imageData: ImageData;
  workerIndex: number;
}

interface SoldierTemplateWorkerHandle {
  cleanup: () => void;
  promise: Promise<{ elapsedMs: number; matches: SoldierMatchCandidate[] }>;
  worker: Worker;
  workerIndex: number;
}

const workerScope = self as unknown as GraphwarDetectionWorkerScope;

workerScope.addEventListener("message", (event) => {
  void runDetectionRequest(event.data);
});

async function runDetectionRequest(request: GraphwarDetectionWorkerRequest) {
  const timings: GraphwarDetectionWorkerTimingEntry[] = [];
  try {
    if (request.task.type === "detect-auto") {
      await runAutoDetectionTask(request.id, request.task, timings);
      return;
    }

    const task = request.task;
    postStage(request.id, "detecting-objects");
    postSuccess(
      request.id,
      "detect-bounds",
      await detectGraphwarObjectsInBoundsWithTemplateWorkers(
        task.imageData,
        task.edgeRect,
        task.thresholds,
        task.soldierSettings,
        timings,
      ),
      timings,
    );
  } catch (error) {
    postError(request.id, error);
  }
}

async function runAutoDetectionTask(
  id: number,
  task: Extract<GraphwarDetectionWorkerTask, { type: "detect-auto" }>,
  timings: GraphwarDetectionWorkerTimingEntry[],
) {
  postStage(id, "detecting-bounds");
  const edgeRect = measureDetectionStage(timings, "detecting-bounds", () => detectGraphwarPlayArea(task.imageData));
  if (!edgeRect) {
    postSuccess(id, "detect-auto", { edgeRect: undefined }, timings);
    return;
  }

  postStage(id, "detecting-objects");
  postSuccess(
    id,
    "detect-auto",
    {
      edgeRect,
      objects: await detectGraphwarObjectsInBoundsWithTemplateWorkers(
        task.imageData,
        edgeRect,
        task.thresholds,
        task.soldierSettings,
        timings,
      ),
    },
    timings,
  );
}

async function detectGraphwarObjectsInBoundsWithTemplateWorkers(
  imageData: ImageData,
  edgeRect: BoundsRect,
  thresholds: GraphwarObstacleDetectionThresholds,
  soldierSettings: GraphwarSoldierDetectionSettings | undefined,
  timings: GraphwarDetectionWorkerTimingEntry[],
): Promise<GraphwarObjectsDetectionResult> {
  const settings = getGraphwarSoldierDetectionSettings(soldierSettings);
  const scale = getGraphwarDetectionScale(edgeRect);
  const candidates = measureDetectionStage(timings, "collecting-soldier-candidates", () =>
    collectSoldierTemplateCenterCandidatesForMatching(imageData, edgeRect, settings),
  );
  const warnings: GraphwarDetectionWarning[] = [];
  const matches = await measureDetectionStageAsync(timings, "matching-soldier-templates", async () => {
    const matched = await matchSoldierTemplatesWithOptionalWorkers(
      imageData,
      edgeRect,
      scale,
      candidates,
      settings.templateMatchingWorkerCount,
      timings,
      warnings,
    );
    return measureDetectionDetail(timings, "matching-soldier-templates", { type: "template-matching-merge" }, () =>
      finalizeSoldierTemplateMatches(matched, scale, settings),
    );
  });
  const soldiers = createSoldierDetectionBoxes(matches, edgeRect);
  const obstacles = detectGraphwarObstaclesInBounds(
    imageData,
    edgeRect,
    thresholds,
    soldiers,
    createObjectDetectionInstrumentation(timings),
  );
  return warnings.length ? { obstacles, soldiers, warnings } : { obstacles, soldiers };
}

async function matchSoldierTemplatesWithOptionalWorkers(
  imageData: ImageData,
  edgeRect: BoundsRect,
  scale: number,
  candidates: readonly SoldierTemplateCenterCandidate[],
  workerCount: number,
  timings: GraphwarDetectionWorkerTimingEntry[],
  warnings: GraphwarDetectionWarning[],
) {
  if (workerCount <= 1 || candidates.length <= 1 || typeof Worker === "undefined") {
    return matchSoldierTemplatesSerial(imageData, edgeRect, scale, candidates, timings, "serial", 1);
  }

  const laneCount = Math.min(workerCount, candidates.length);
  try {
    const matches = await runSoldierTemplateWorkerTasks(imageData, edgeRect, scale, candidates, laneCount, timings);
    recordDetectionTimingDetail(timings, "matching-soldier-templates", 0, {
      mode: "parallel",
      type: "template-matching-mode",
      workerCount: laneCount,
    });
    return matches;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push({
      code: "template-matching-worker-fallback",
      message,
    });
    recordDetectionTimingDetail(timings, "matching-soldier-templates", 0, {
      mode: "parallel-fallback",
      type: "template-matching-mode",
      workerCount: laneCount,
    });
    return matchSoldierTemplatesSerial(imageData, edgeRect, scale, candidates, timings, "fallback", 1);
  }
}

function matchSoldierTemplatesSerial(
  imageData: ImageData,
  edgeRect: BoundsRect,
  scale: number,
  candidates: readonly SoldierTemplateCenterCandidate[],
  timings: GraphwarDetectionWorkerTimingEntry[],
  mode: "serial" | "fallback",
  workerCount: number,
) {
  if (mode === "serial") {
    recordDetectionTimingDetail(timings, "matching-soldier-templates", 0, {
      mode: "serial",
      type: "template-matching-mode",
      workerCount,
    });
  }
  return measureDetectionDetail(
    timings,
    "matching-soldier-templates",
    { type: mode === "serial" ? "template-matching-serial" : "template-matching-fallback-serial" },
    () => matchSoldierTemplates(imageData, edgeRect, scale, candidates),
  );
}

async function runSoldierTemplateWorkerTasks(
  imageData: ImageData,
  edgeRect: BoundsRect,
  scale: number,
  candidates: readonly SoldierTemplateCenterCandidate[],
  laneCount: number,
  timings: GraphwarDetectionWorkerTimingEntry[],
) {
  const handles: SoldierTemplateWorkerHandle[] = [];
  try {
    measureDetectionDetail(timings, "matching-soldier-templates", { type: "template-matching-dispatch" }, () => {
      const tasks = createSoldierTemplateWorkerTasks(imageData, candidates, laneCount);
      for (const task of tasks) {
        handles.push(createSoldierTemplateWorkerHandle(task, edgeRect, scale));
      }
    });

    const settledResults = await Promise.allSettled(
      handles.map(async (handle) => ({ handle, result: await handle.promise })),
    );
    const failures: string[] = [];
    const matches: SoldierMatchCandidate[] = [];
    for (const settled of settledResults) {
      if (settled.status === "rejected") {
        failures.push(settled.reason instanceof Error ? settled.reason.message : String(settled.reason));
        continue;
      }

      recordDetectionTimingDetail(timings, "matching-soldier-templates", settled.value.result.elapsedMs, {
        type: "template-matching-worker",
        workerIndex: settled.value.handle.workerIndex,
      });
      matches.push(...settled.value.result.matches);
    }
    if (failures.length) {
      throw new Error(failures.join("\n"));
    }
    return matches;
  } finally {
    for (const handle of handles) {
      handle.cleanup();
      handle.worker.terminate();
    }
  }
}

function createSoldierTemplateWorkerTasks(
  imageData: ImageData,
  candidates: readonly SoldierTemplateCenterCandidate[],
  laneCount: number,
) {
  const tasks: SoldierTemplateWorkerTask[] = [];
  for (let index = 0; index < laneCount; index += 1) {
    const start = Math.floor((index * candidates.length) / laneCount);
    const end = Math.floor(((index + 1) * candidates.length) / laneCount);
    tasks.push({
      candidates: candidates.slice(start, end),
      imageData: cloneImageData(imageData),
      workerIndex: index + 1,
    });
  }
  return tasks;
}

function createSoldierTemplateWorkerHandle(
  task: SoldierTemplateWorkerTask,
  edgeRect: BoundsRect,
  scale: number,
): SoldierTemplateWorkerHandle {
  const worker = new Worker(new URL("./graphwar-soldier-template.worker.ts", import.meta.url), {
    name: `graphwar-soldier-template-${task.workerIndex}`,
    type: "module",
  });
  let cleanup: (() => void) | undefined;
  const promise = new Promise<{ elapsedMs: number; matches: SoldierMatchCandidate[] }>((resolve, reject) => {
    const request: GraphwarSoldierTemplateWorkerRequest = {
      candidates: task.candidates,
      edgeRect,
      id: task.workerIndex,
      imageData: task.imageData,
      scale,
    };
    const handleMessage = (event: MessageEvent<GraphwarSoldierTemplateWorkerResponse>) => {
      const response = event.data;
      if (response.id !== request.id) {
        return;
      }
      cleanup?.();
      if (response.type === "error") {
        reject(new Error(`Worker ${task.workerIndex}: ${response.message}`));
        return;
      }
      resolve({ elapsedMs: response.elapsedMs, matches: response.matches });
    };
    const handleMessageError = () => {
      cleanup?.();
      reject(new Error(`Worker ${task.workerIndex}: message could not be deserialized`));
    };
    const handleError = (event: ErrorEvent) => {
      cleanup?.();
      reject(event.error instanceof Error ? event.error : new Error(`Worker ${task.workerIndex}: ${event.message}`));
    };
    cleanup = () => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("messageerror", handleMessageError);
      worker.removeEventListener("error", handleError);
    };
    worker.addEventListener("message", handleMessage);
    worker.addEventListener("messageerror", handleMessageError);
    worker.addEventListener("error", handleError);
    try {
      worker.postMessage(request, [request.imageData.data.buffer]);
    } catch (error) {
      cleanup?.();
      reject(error);
    }
  });
  return {
    cleanup: () => cleanup?.(),
    promise,
    worker,
    workerIndex: task.workerIndex,
  };
}

function cloneImageData(imageData: ImageData) {
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
}

function postStage(id: number, stage: GraphwarDetectionWorkerStage) {
  workerScope.postMessage({ id, stage, type: "stage" });
}

function postSuccess(
  id: number,
  taskType: "detect-auto",
  result: GraphwarAutoDetectionResult,
  timings: readonly GraphwarDetectionWorkerTimingEntry[],
): void;
function postSuccess(
  id: number,
  taskType: "detect-bounds",
  result: ReturnType<typeof detectGraphwarObjectsInBounds>,
  timings: readonly GraphwarDetectionWorkerTimingEntry[],
): void;
function postSuccess(
  id: number,
  taskType: "detect-auto" | "detect-bounds",
  result: GraphwarAutoDetectionResult | ReturnType<typeof detectGraphwarObjectsInBounds>,
  timings: readonly GraphwarDetectionWorkerTimingEntry[],
) {
  const response =
    taskType === "detect-auto"
      ? { id, result: result as GraphwarAutoDetectionResult, taskType, timings, type: "success" as const }
      : {
          id,
          result: result as ReturnType<typeof detectGraphwarObjectsInBounds>,
          taskType,
          timings,
          type: "success" as const,
        };
  workerScope.postMessage(response, collectTransferList(result));
}

function postError(id: number, error: unknown) {
  workerScope.postMessage({
    id,
    message: error instanceof Error ? error.message : String(error),
    type: "error",
  });
}

function collectTransferList(result: GraphwarAutoDetectionResult | ReturnType<typeof detectGraphwarObjectsInBounds>) {
  const mask = "obstacles" in result ? result.obstacles.mask : result.objects?.obstacles.mask;
  const buffer = mask?.buffer;
  return buffer instanceof ArrayBuffer ? [buffer] : [];
}

function measureDetectionStage<TResult>(
  timings: GraphwarDetectionWorkerTimingEntry[],
  stage: GraphwarDetectionWorkerStage,
  task: () => TResult,
) {
  const startedAt = nowMs();
  try {
    return task();
  } finally {
    timings.push({
      elapsedMs: nowMs() - startedAt,
      stage,
    });
  }
}

async function measureDetectionStageAsync<TResult>(
  timings: GraphwarDetectionWorkerTimingEntry[],
  stage: GraphwarDetectionWorkerStage,
  task: () => Promise<TResult>,
) {
  const startedAt = nowMs();
  const innerTimingStartIndex = timings.length;
  try {
    return await task();
  } finally {
    const innerTimings = timings.splice(innerTimingStartIndex);
    timings.push({
      elapsedMs: nowMs() - startedAt,
      stage,
    });
    timings.push(...innerTimings);
  }
}

function measureDetectionDetail<TResult>(
  timings: GraphwarDetectionWorkerTimingEntry[],
  stage: GraphwarDetectionWorkerStage,
  detail: GraphwarDetectionWorkerTimingDetail,
  task: () => TResult,
) {
  const startedAt = nowMs();
  try {
    return task();
  } finally {
    recordDetectionTimingDetail(timings, stage, nowMs() - startedAt, detail);
  }
}

function recordDetectionTimingDetail(
  timings: GraphwarDetectionWorkerTimingEntry[],
  stage: GraphwarDetectionWorkerStage,
  elapsedMs: number,
  detail: GraphwarDetectionWorkerTimingDetail,
) {
  timings.push({
    detail,
    elapsedMs,
    stage,
  });
}

function createObjectDetectionInstrumentation(
  timings: GraphwarDetectionWorkerTimingEntry[],
): GraphwarObjectDetectionInstrumentation {
  return {
    measureStage: <TResult>(stage: GraphwarObjectDetectionStage, task: () => TResult) =>
      measureDetectionStage(timings, stage, task),
  };
}

function nowMs() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
