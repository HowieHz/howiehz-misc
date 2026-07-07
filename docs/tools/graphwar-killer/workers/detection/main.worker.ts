/** 在 Web Worker 中执行耗时的 Graphwar 截图识别，避免阻塞页面主线程。 */
import type { BoundsRect } from "../../core/types";
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
} from "../../detection/objects";
import type {
  GraphwarDetectionWarning,
  GraphwarObjectDetectionInstrumentation,
  GraphwarObjectDetectionStage,
  GraphwarObjectsDetectionResult,
  GraphwarObstacleDetectionThresholds,
  GraphwarSoldierDetectionSettings,
  SoldierMatchCandidate,
  SoldierTemplateCenterCandidate,
} from "../../detection/objects";
import type {
  GraphwarAutoDetectionResult,
  GraphwarDetectionWorkerTask,
  GraphwarDetectionWorkerRequest,
  GraphwarDetectionWorkerResponse,
  GraphwarDetectionWorkerStage,
  GraphwarDetectionWorkerTimingDetail,
  GraphwarDetectionWorkerTimingEntry,
} from "../../detection/runtime/worker-types";
import type {
  GraphwarSoldierTemplateWorkerRequest,
  GraphwarSoldierTemplateWorkerResponse,
} from "../../detection/template/worker-types";

/** 当前 Worker 暴露给 TypeScript 的最小消息接口。 */
interface GraphwarDetectionWorkerScope {
  /** 接收主线程检测请求。 */
  addEventListener: (type: "message", listener: (event: MessageEvent<GraphwarDetectionWorkerRequest>) => void) => void;
  /** 向主线程发送阶段、成功或错误响应。 */
  postMessage: (message: GraphwarDetectionWorkerResponse, transfer?: Transferable[]) => void;
}

/** 分配给单个士兵模板匹配子 Worker 的候选切片。 */
interface SoldierTemplateWorkerTask {
  /** 当前子 Worker 负责评分的候选中心。 */
  candidates: SoldierTemplateCenterCandidate[];
  /** 复制后的截图像素，buffer 会被转移给子 Worker。 */
  imageData: ImageData;
  /** 子 Worker 序号，用于日志和 timing 展示。 */
  workerIndex: number;
}

/** 子 Worker 生命周期句柄，集中管理结果 Promise 和事件解绑。 */
interface SoldierTemplateWorkerHandle {
  /** 解绑 Worker 事件监听。 */
  cleanup: () => void;
  /** 子 Worker 返回的匹配结果和耗时。 */
  promise: Promise<{ elapsedMs: number; matches: SoldierMatchCandidate[] }>;
  /** 实际模板匹配子 Worker。 */
  worker: Worker;
  /** 子 Worker 序号，用于 timing detail。 */
  workerIndex: number;
}

const workerScope = self as unknown as GraphwarDetectionWorkerScope;

workerScope.addEventListener("message", (event) => {
  void runDetectionRequest(event.data);
});

/** 分发主线程检测请求，并把所有异常转成 Worker 响应。 */
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

/** 执行自动检测任务，只有识别到平面边界后才继续对象检测。 */
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

/** 在已知边界内识别士兵和障碍，并允许模板匹配并行化。 */
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

/** 根据设置选择串行或多 Worker 模板匹配，失败时降级为串行。 */
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

/** 在当前线程执行模板匹配，并记录串行或 fallback 模式。 */
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

/** 分发模板候选到子 Worker，并汇总成功结果或失败原因。 */
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

/** 按候选数量切分模板匹配任务，并复制 ImageData 给每个子 Worker。 */
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

/** 创建单个模板匹配子 Worker 的 Promise 封装和清理钩子。 */
function createSoldierTemplateWorkerHandle(
  task: SoldierTemplateWorkerTask,
  edgeRect: BoundsRect,
  scale: number,
): SoldierTemplateWorkerHandle {
  const worker = new Worker(new URL("./soldier-template.worker.ts", import.meta.url), {
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

/** 复制 ImageData，避免同一个 buffer 被转移给多个子 Worker。 */
function cloneImageData(imageData: ImageData) {
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
}

/** 通知主线程当前检测阶段，便于页面显示进度。 */
function postStage(id: number, stage: GraphwarDetectionWorkerStage) {
  workerScope.postMessage({ id, stage, type: "stage" });
}

/** 发送自动检测成功响应，并转移可复用的大型 buffer。 */
function postSuccess(
  id: number,
  taskType: "detect-auto",
  result: GraphwarAutoDetectionResult,
  timings: readonly GraphwarDetectionWorkerTimingEntry[],
): void;
/** 发送边界内检测成功响应，并转移可复用的大型 buffer。 */
function postSuccess(
  id: number,
  taskType: "detect-bounds",
  result: ReturnType<typeof detectGraphwarObjectsInBounds>,
  timings: readonly GraphwarDetectionWorkerTimingEntry[],
): void;
/** 统一构造成功响应，保持主线程按 taskType 精确收窄结果类型。 */
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

/** 把 Worker 内异常序列化成主线程可显示的错误消息。 */
function postError(id: number, error: unknown) {
  workerScope.postMessage({
    id,
    message: error instanceof Error ? error.message : String(error),
    type: "error",
  });
}

/** 收集检测结果中可转移的 mask buffer，减少跨线程复制。 */
function collectTransferList(result: GraphwarAutoDetectionResult | ReturnType<typeof detectGraphwarObjectsInBounds>) {
  const mask = "obstacles" in result ? result.obstacles.mask : result.objects?.obstacles.mask;
  const buffer = mask?.buffer;
  return buffer instanceof ArrayBuffer ? [buffer] : [];
}

/** 包装同步检测阶段计时，用于主阶段耗时统计。 */
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

/** 包装异步阶段计时，并把阶段内细分 timing 放在主阶段之后。 */
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

/** 包装子步骤计时，用于模板匹配 dispatch/worker/merge 明细。 */
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

/** 记录带 detail 的检测 timing 条目。 */
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

/** 把对象检测内部 instrumentation 接入 Worker timing 结构。 */
function createObjectDetectionInstrumentation(
  timings: GraphwarDetectionWorkerTimingEntry[],
): GraphwarObjectDetectionInstrumentation {
  return {
    measureStage: <TResult>(stage: GraphwarObjectDetectionStage, task: () => TResult) =>
      measureDetectionStage(timings, stage, task),
  };
}

/** 获取高精度时间戳，兼容没有 performance 的 Worker 环境。 */
function nowMs() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
