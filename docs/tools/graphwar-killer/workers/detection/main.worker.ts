/** 在 Web Worker 中执行耗时的 Graphwar 截图识别，避免阻塞页面主线程。 */
import {
  createGraphwarWasmSessionIdentity,
  graphwarBackendAttemptIdentitiesAreEqual,
  graphwarWasmSessionIdentitiesAreEqual,
  isGraphwarWasmFault,
  type GraphwarBackendAttemptIdentity,
  type GraphwarBackendControlMessage,
  type GraphwarBackendInitializationMessage,
  GraphwarWasmFault,
} from "../../core/algorithm-backend";
import { nowMs } from "../../core/time";
import type { BoundsRect } from "../../core/types";
import {
  createGraphwarWorkerBackendRuntime,
  createGraphwarWorkerBackendSlot,
  executeGraphwarWorkerTask,
} from "../../core/worker-backend";
import {
  collectSoldierTemplateCenterCandidatesForMatching,
  createSoldierDetectionBoxes,
  detectGraphwarObstaclesInBounds,
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
  GraphwarBoundsOnlyDetectionResult,
  GraphwarDetectionWorkerTask,
  GraphwarDetectionWorkerRequest,
  GraphwarDetectionWorkerResponse,
  GraphwarDetectionWorkerStage,
  GraphwarDetectionWorkerTimingDetail,
  GraphwarDetectionWorkerTimingEntry,
} from "../../detection/runtime/protocol";
import { measureDetectionStage } from "../../detection/runtime/timing";
import type {
  GraphwarSoldierTemplateWorkerRequest,
  GraphwarSoldierTemplateWorkerResponse,
} from "../../detection/template/protocol";

/** 当前 Worker 暴露给 TypeScript 的最小消息接口。 */
interface GraphwarDetectionWorkerScope {
  /** 接收主线程检测请求。 */
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<GraphwarBackendInitializationMessage | GraphwarDetectionWorkerRequest>) => void,
  ) => void;
  /** 向主线程发送阶段、成功或错误响应。 */
  postMessage: (
    message: GraphwarBackendControlMessage | GraphwarDetectionWorkerResponse,
    transfer?: Transferable[],
  ) => void;
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

/** Detection request id 与 backend attempt 必须作为一份下传身份同行。 */
type GraphwarDetectionRequestContext = Pick<GraphwarDetectionWorkerRequest, "attempt" | "id">;

/** Task type 与 result 原子同行，构造响应时不靠类型断言恢复关联。 */
type GraphwarDetectionSuccessPayload =
  | { result: GraphwarAutoDetectionResult; taskType: "detect-auto" }
  | { result: GraphwarBoundsOnlyDetectionResult; taskType: "detect-bounds-only" }
  | { result: GraphwarObjectsDetectionResult; taskType: "detect-bounds" };

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

/** 已触发 module 加载、尚未收到候选任务的模板 Worker。 */
interface StartedSoldierTemplateWorker {
  /** 当前 lane 正在执行的请求；用于拒绝旧 session typed fault。 */
  activeRequest?: Pick<GraphwarSoldierTemplateWorkerRequest, "attempt" | "id" | "session">;
  /** Nested Worker 的 backend control slot。 */
  backendSlot: ReturnType<typeof createGraphwarWorkerBackendSlot>;
  /** 移除启动期错误监听；派发后由请求监听接管。 */
  cleanupStartupListener: () => void;
  /** Module 加载期间发生的首个错误。 */
  startupError?: Error;
  /** 明确 instantiate/ABI fault；不能进入普通 template fallback。 */
  startupWasmFault?: Error;
  worker: Worker;
  workerIndex: number;
}

/** 提前启动的原子结果；构造失败不能留下可误用的半组 Worker。 */
type SoldierTemplateWorkerStartup =
  | { type: "available"; workers: StartedSoldierTemplateWorker[] }
  | { error: Error; requestedWorkerCount: number; type: "failed" };

const workerScope = self as unknown as GraphwarDetectionWorkerScope;
const backendRuntime = createGraphwarWorkerBackendRuntime({
  postControlMessage: (message) => workerScope.postMessage(message),
  role: "detection-main",
});

/** 接收主线程请求，并将异步检测交给统一的协议分派入口。 */
workerScope.addEventListener("message", (event) => {
  if (backendRuntime.handleMessage(event.data)) {
    return;
  }
  void runDetectionRequest(event.data);
});

/** 分发主线程检测请求，并把所有异常转成 Worker 响应。 */
async function runDetectionRequest(request: GraphwarDetectionWorkerRequest) {
  const requestContext: GraphwarDetectionRequestContext = { attempt: request.attempt, id: request.id };
  const timings: GraphwarDetectionWorkerTimingEntry[] = [];
  try {
    await executeGraphwarWorkerTask(
      backendRuntime,
      request.attempt,
      { attempt: request.attempt, type: "task" },
      async () => {
        if (request.task.type === "detect-auto") {
          await runAutoDetectionTask(requestContext, request.task, timings);
          return;
        }
        if (request.task.type === "detect-bounds-only") {
          postStage(requestContext, "detecting-bounds");
          postSuccess(
            requestContext,
            {
              result: {
                edgeRect: measureDetectionStage(timings, "detecting-bounds", () =>
                  detectGraphwarPlayArea(request.task.imageData),
                ),
              },
              taskType: "detect-bounds-only",
            },
            timings,
          );
          return;
        }

        const task = request.task;
        postStage(requestContext, "detecting-objects");
        postSuccess(
          requestContext,
          {
            result: await detectGraphwarObjectsInBoundsWithTemplateWorkers(
              requestContext,
              task.imageData,
              task.edgeRect,
              task.thresholds,
              task.soldierSettings,
              timings,
            ),
            taskType: "detect-bounds",
          },
          timings,
        );
      },
    );
  } catch (error) {
    workerScope.postMessage({
      attempt: request.attempt,
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
      type: "error",
    });
  }
}

/** 执行自动检测任务，只有识别到平面边界后才继续对象检测。 */
async function runAutoDetectionTask(
  requestContext: GraphwarDetectionRequestContext,
  task: Extract<GraphwarDetectionWorkerTask, { type: "detect-auto" }>,
  timings: GraphwarDetectionWorkerTimingEntry[],
) {
  postStage(requestContext, "detecting-bounds");
  const edgeRect = measureDetectionStage(timings, "detecting-bounds", () => detectGraphwarPlayArea(task.imageData));
  if (!edgeRect) {
    postSuccess(requestContext, { result: { edgeRect: undefined }, taskType: "detect-auto" }, timings);
    return;
  }

  postStage(requestContext, "detecting-objects");
  postSuccess(
    requestContext,
    {
      result: {
        edgeRect,
        objects: await detectGraphwarObjectsInBoundsWithTemplateWorkers(
          requestContext,
          task.imageData,
          edgeRect,
          task.thresholds,
          task.soldierSettings,
          timings,
        ),
      },
      taskType: "detect-auto",
    },
    timings,
  );
}

/** 在已知边界内识别士兵和障碍，并允许模板匹配并行化。 */
async function detectGraphwarObjectsInBoundsWithTemplateWorkers(
  requestContext: GraphwarDetectionRequestContext,
  imageData: ImageData,
  edgeRect: BoundsRect,
  thresholds: GraphwarObstacleDetectionThresholds,
  soldierSettings: GraphwarSoldierDetectionSettings | undefined,
  timings: GraphwarDetectionWorkerTimingEntry[],
): Promise<GraphwarObjectsDetectionResult> {
  const settings = getGraphwarSoldierDetectionSettings(soldierSettings);
  const scale = getGraphwarDetectionScale(edgeRect);
  /*
   * new Worker 会立即开始加载 module。让加载与同步候选扫描重叠，待候选完整后再发送任务；
   * Worker 绝不观察半成品候选或像素副本，串行和 fallback 的业务语义保持不变。
   * 2026-07-28 用 16 张真实截图、4 Workers 交错测试各 384 次：中位数约从 135.5ms 降到
   * 134.8ms（-0.5%），均值约改善 0.8%。收益很小，后续调整必须继续覆盖低/高候选截图。
   */
  const startup = startSoldierTemplateWorkers(settings.templateMatchingWorkerCount, requestContext.attempt);
  const warnings: GraphwarDetectionWarning[] = [];
  let matches: SoldierMatchCandidate[];
  try {
    const candidates = measureDetectionStage(timings, "collecting-soldier-candidates", () =>
      collectSoldierTemplateCenterCandidatesForMatching(imageData, edgeRect, settings),
    );
    matches = await measureDetectionStageAsync(timings, "matching-soldier-templates", async () => {
      const matched = await matchSoldierTemplatesWithOptionalWorkers(
        requestContext,
        imageData,
        edgeRect,
        scale,
        candidates,
        startup,
        timings,
        warnings,
      );
      return measureDetectionDetail(timings, "matching-soldier-templates", { type: "template-matching-merge" }, () =>
        finalizeSoldierTemplateMatches(matched, scale, settings),
      );
    });
  } finally {
    if (startup.type === "available") {
      for (const started of startup.workers) {
        started.cleanupStartupListener();
        started.worker.terminate();
      }
    }
  }
  const soldiers = createSoldierDetectionBoxes(matches, edgeRect);
  const obstacles = detectGraphwarObstaclesInBounds(imageData, edgeRect, thresholds, soldiers, {
    measureStage: <TResult>(stage: GraphwarObjectDetectionStage, task: () => TResult) =>
      measureDetectionStage(timings, stage, task),
  } satisfies GraphwarObjectDetectionInstrumentation);
  return warnings.length ? { obstacles, soldiers, warnings } : { obstacles, soldiers };
}

/** 根据设置选择串行或多 Worker 模板匹配，失败时降级为串行。 */
async function matchSoldierTemplatesWithOptionalWorkers(
  requestContext: GraphwarDetectionRequestContext,
  imageData: ImageData,
  edgeRect: BoundsRect,
  scale: number,
  candidates: readonly SoldierTemplateCenterCandidate[],
  startup: SoldierTemplateWorkerStartup,
  timings: GraphwarDetectionWorkerTimingEntry[],
  warnings: GraphwarDetectionWarning[],
) {
  if (candidates.length <= 1) {
    return matchSoldierTemplatesSerial(imageData, edgeRect, scale, candidates, timings, "serial", 1);
  }
  if (startup.type === "failed") {
    warnings.push({ code: "template-matching-worker-fallback", message: startup.error.message });
    recordDetectionTimingDetail(timings, "matching-soldier-templates", 0, {
      mode: "parallel-fallback",
      type: "template-matching-mode",
      workerCount: startup.requestedWorkerCount,
    });
    return matchSoldierTemplatesSerial(imageData, edgeRect, scale, candidates, timings, "fallback", 1);
  }
  const startedWorkers = startup.workers;
  if (startedWorkers.length === 0) {
    return matchSoldierTemplatesSerial(imageData, edgeRect, scale, candidates, timings, "serial", 1);
  }

  const laneCount = Math.min(startedWorkers.length, candidates.length);
  try {
    const matches = await runSoldierTemplateWorkerTasks(
      requestContext,
      imageData,
      edgeRect,
      scale,
      candidates,
      laneCount,
      startedWorkers,
      timings,
    );
    recordDetectionTimingDetail(timings, "matching-soldier-templates", 0, {
      mode: "parallel",
      type: "template-matching-mode",
      workerCount: laneCount,
    });
    return matches;
  } catch (error) {
    if (isGraphwarWasmFault(error)) {
      throw error;
    }
    warnings.push({
      code: "template-matching-worker-fallback",
      message: error instanceof Error ? error.message : String(error),
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
  requestContext: GraphwarDetectionRequestContext,
  imageData: ImageData,
  edgeRect: BoundsRect,
  scale: number,
  candidates: readonly SoldierTemplateCenterCandidate[],
  laneCount: number,
  startedWorkers: readonly StartedSoldierTemplateWorker[],
  timings: GraphwarDetectionWorkerTimingEntry[],
) {
  const session = createGraphwarWasmSessionIdentity(requestContext.attempt, requestContext.id, "detection");
  const handles: SoldierTemplateWorkerHandle[] = [];
  try {
    measureDetectionDetail(timings, "matching-soldier-templates", { type: "template-matching-dispatch" }, () => {
      const tasks: SoldierTemplateWorkerTask[] = [];
      for (let index = 0; index < laneCount; index += 1) {
        tasks.push({
          // 连续均分候选，保持 lane 顺序和原合并顺序一致。
          candidates: candidates.slice(
            Math.floor((index * candidates.length) / laneCount),
            Math.floor(((index + 1) * candidates.length) / laneCount),
          ),
          // 每个 buffer 只能转移一次；lane 必须拥有独立的截图像素。
          imageData: new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height),
          workerIndex: index + 1,
        });
      }
      // 先完成全部像素复制；任一复制失败时都不留下已启动的半组 Worker。
      for (const task of tasks) {
        const started = startedWorkers[task.workerIndex - 1];
        if (!started) {
          throw new Error(`Template worker ${task.workerIndex} was not started`);
        }
        handles.push(
          createSoldierTemplateWorkerHandle(started, requestContext.attempt, session, task, edgeRect, scale),
        );
      }
    });

    const matches: SoldierMatchCandidate[] = [];
    for (const settled of await Promise.all(
      handles.map(async (handle) => ({ handle, result: await handle.promise })),
    )) {
      recordDetectionTimingDetail(timings, "matching-soldier-templates", settled.result.elapsedMs, {
        type: "template-matching-worker",
        workerIndex: settled.handle.workerIndex,
      });
      matches.push(...settled.result.matches);
    }
    return matches;
  } finally {
    for (const handle of handles) {
      handle.cleanup();
    }
    // 失败时也必须先终止未分配候选的已启动 siblings，再进入 main 串行 fallback。
    for (const started of startedWorkers) {
      started.cleanupStartupListener();
      started.worker.terminate();
    }
  }
}

/** 提前启动配置数量的 Worker；候选数稍后确定，多余实例由调用方统一终止。 */
function startSoldierTemplateWorkers(workerCount: number, attempt: GraphwarBackendAttemptIdentity) {
  const startedWorkers: StartedSoldierTemplateWorker[] = [];
  if (workerCount <= 1 || typeof Worker === "undefined") {
    return { type: "available", workers: startedWorkers } satisfies SoldierTemplateWorkerStartup;
  }
  try {
    for (let workerIndex = 1; workerIndex <= workerCount; workerIndex += 1) {
      const worker = new Worker(new URL("./template.worker.ts", import.meta.url), {
        name: `graphwar-soldier-template-${workerIndex}`,
        type: "module",
      });
      let isInitializing = true;
      let activeRequest: StartedSoldierTemplateWorker["activeRequest"];
      let startupError: Error | undefined;
      let startupWasmFault: Error | undefined;
      /** 候选扫描期间先消费 backend control；业务响应只可能在派发候选后出现。 */
      const handleStartupMessage = (event: MessageEvent<unknown>) => {
        if (isInitializing || !backendSlot.handleMessage(event.data)) {
          startupError ??= new Error(`Worker ${workerIndex}: returned a task message before template dispatch`);
        }
      };
      /** 候选扫描期间先保存 module 加载错误，派发时再进入原有 fallback。 */
      const handleStartupError = (event: ErrorEvent) => {
        startupError ??=
          event.error instanceof Error ? event.error : new Error(`Worker ${workerIndex}: ${event.message}`);
      };
      worker.addEventListener("message", handleStartupMessage);
      worker.addEventListener("error", handleStartupError);
      const backendSlot = createGraphwarWorkerBackendSlot({
        configuration: backendRuntime.getNestedConfiguration(attempt),
        onInfrastructureFailure: (error) => {
          startupError ??= error;
        },
        onWasmFault: (message) => {
          const fault = new GraphwarWasmFault(message.fault.code, message.fault.message);
          if (message.fault.code === "module-clone") {
            startupError ??= fault;
            return;
          }
          workerScope.postMessage(message);
          startupWasmFault ??= fault.markReported();
        },
        role: "detection-template",
        shouldAcceptWasmFault: (message) => {
          if (message.context.type === "initialization") {
            return true;
          }
          return (
            message.context.type === "template-shard" &&
            activeRequest !== undefined &&
            message.context.shardId === activeRequest.id &&
            graphwarBackendAttemptIdentitiesAreEqual(message.context.attempt, activeRequest.attempt) &&
            graphwarWasmSessionIdentitiesAreEqual(message.context.session, activeRequest.session)
          );
        },
        worker,
      });
      isInitializing = false;
      const started: StartedSoldierTemplateWorker = {
        backendSlot,
        cleanupStartupListener: () => {
          worker.removeEventListener("message", handleStartupMessage);
          worker.removeEventListener("error", handleStartupError);
        },
        get startupError() {
          return startupError;
        },
        get startupWasmFault() {
          return startupWasmFault;
        },
        get activeRequest() {
          return activeRequest;
        },
        set activeRequest(request) {
          activeRequest = request;
        },
        worker,
        workerIndex,
      };
      startedWorkers.push(started);
    }
    return { type: "available", workers: startedWorkers } satisfies SoldierTemplateWorkerStartup;
  } catch (error) {
    for (const started of startedWorkers) {
      started.cleanupStartupListener();
      started.worker.terminate();
    }
    return {
      error: error instanceof Error ? error : new Error(String(error)),
      requestedWorkerCount: workerCount,
      type: "failed",
    } satisfies SoldierTemplateWorkerStartup;
  }
}

/** 创建单个模板匹配子 Worker 的 Promise 封装和清理钩子。 */
function createSoldierTemplateWorkerHandle(
  started: StartedSoldierTemplateWorker,
  attempt: GraphwarBackendAttemptIdentity,
  session: ReturnType<typeof createGraphwarWasmSessionIdentity>,
  task: SoldierTemplateWorkerTask,
  edgeRect: BoundsRect,
  scale: number,
): SoldierTemplateWorkerHandle {
  const { worker } = started;
  let cleanup: (() => void) | undefined;
  const promise = new Promise<{ elapsedMs: number; matches: SoldierMatchCandidate[] }>((resolve, reject) => {
    started.cleanupStartupListener();
    if (started.startupError) {
      reject(started.startupError);
      return;
    }
    if (started.startupWasmFault) {
      reject(started.startupWasmFault);
      return;
    }
    const request: GraphwarSoldierTemplateWorkerRequest = {
      attempt,
      candidates: task.candidates,
      edgeRect,
      id: task.workerIndex,
      imageData: task.imageData,
      scale,
      session,
    };
    started.activeRequest = request;
    /** 只结算当前请求的首个有效响应，避免迟到消息污染结果。 */
    const handleMessage = (event: MessageEvent<GraphwarSoldierTemplateWorkerResponse>) => {
      if (started.backendSlot.handleMessage(event.data)) {
        const backendState = started.backendSlot.getState();
        if (backendState.type === "failed") {
          cleanup?.();
          reject(started.startupWasmFault ?? backendState.error);
        }
        return;
      }
      const response = event.data;
      if (response.id !== request.id || !graphwarBackendAttemptIdentitiesAreEqual(response.attempt, request.attempt)) {
        cleanup?.();
        reject(new Error(`Worker ${task.workerIndex}: returned an unexpected request identity`));
        return;
      }
      cleanup?.();
      if (response.type === "error") {
        reject(new Error(`Worker ${task.workerIndex}: ${response.message}`));
        return;
      }
      resolve({ elapsedMs: response.elapsedMs, matches: response.matches });
    };
    /** 将结构化克隆失败转换为当前 lane 的失败结果。 */
    const handleMessageError = () => {
      cleanup?.();
      reject(new Error(`Worker ${task.workerIndex}: message could not be deserialized`));
    };
    /** 将子 Worker 运行时异常传递给并行 fallback。 */
    const handleError = (event: ErrorEvent) => {
      cleanup?.();
      reject(event.error instanceof Error ? event.error : new Error(`Worker ${task.workerIndex}: ${event.message}`));
    };
    /** 统一解绑 lane 监听器，确保成功、失败和最终回收共用清理路径。 */
    cleanup = () => {
      started.activeRequest = undefined;
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

/** 通知主线程当前检测阶段，便于页面显示进度。 */
function postStage(requestContext: GraphwarDetectionRequestContext, stage: GraphwarDetectionWorkerStage) {
  workerScope.postMessage({ ...requestContext, stage, type: "stage" });
}

/** 统一构造成功响应，task type 与 result 已由原子 payload 保持关联。 */
function postSuccess(
  requestContext: GraphwarDetectionRequestContext,
  payload: GraphwarDetectionSuccessPayload,
  timings: readonly GraphwarDetectionWorkerTimingEntry[],
) {
  const response = { ...requestContext, ...payload, timings, type: "success" as const };
  // 纯边界结果没有 mask；其余结果只转移最终障碍 mask 的 buffer。
  const buffer =
    payload.taskType === "detect-bounds"
      ? payload.result.obstacles.mask.buffer
      : payload.taskType === "detect-auto" && payload.result.edgeRect !== undefined
        ? payload.result.objects.obstacles.mask.buffer
        : undefined;
  workerScope.postMessage(response, buffer instanceof ArrayBuffer ? [buffer] : []);
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
