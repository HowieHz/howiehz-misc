/** 在 Web Worker 中执行耗时的 Graphwar 截图识别，避免阻塞页面主线程。 */
import { detectGraphwarObjectsInBounds, detectGraphwarPlayArea } from "./graphwar-detection";
import type { GraphwarObjectDetectionInstrumentation, GraphwarObjectDetectionStage } from "./graphwar-detection";
import type {
  GraphwarAutoDetectionResult,
  GraphwarDetectionWorkerTask,
  GraphwarDetectionWorkerRequest,
  GraphwarDetectionWorkerResponse,
  GraphwarDetectionWorkerStage,
  GraphwarDetectionWorkerTimingEntry,
} from "./graphwar-detection-worker-types";

interface GraphwarDetectionWorkerScope {
  addEventListener: (type: "message", listener: (event: MessageEvent<GraphwarDetectionWorkerRequest>) => void) => void;
  postMessage: (message: GraphwarDetectionWorkerResponse, transfer?: Transferable[]) => void;
}

const workerScope = self as unknown as GraphwarDetectionWorkerScope;

workerScope.addEventListener("message", (event) => {
  const request = event.data;
  const timings: GraphwarDetectionWorkerTimingEntry[] = [];
  try {
    if (request.task.type === "detect-auto") {
      runAutoDetectionTask(request.id, request.task, timings);
      return;
    }

    const task = request.task;
    postStage(request.id, "detecting-objects");
    postSuccess(
      request.id,
      "detect-bounds",
      detectGraphwarObjectsInBounds(
        task.imageData,
        task.edgeRect,
        task.thresholds,
        task.soldierSettings,
        createObjectDetectionInstrumentation(timings),
      ),
      timings,
    );
  } catch (error) {
    postError(request.id, error);
  }
});

function runAutoDetectionTask(
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
      objects: detectGraphwarObjectsInBounds(
        task.imageData,
        edgeRect,
        task.thresholds,
        task.soldierSettings,
        createObjectDetectionInstrumentation(timings),
      ),
    },
    timings,
  );
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
