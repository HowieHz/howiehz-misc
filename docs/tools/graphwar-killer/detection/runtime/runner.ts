/** 主线程侧 Graphwar 截图识别 runner，集中管理 Worker 生命周期、取消和同步 fallback。 */
import {
  createGraphwarTypescriptWorkerBackendConfiguration,
  graphwarBackendAttemptIdentitiesAreEqual,
  isGraphwarBackendControlMessage,
  type GraphwarBackendAttemptIdentity,
  type GraphwarBackendControlMessage,
  type GraphwarWorkerBackendConfiguration,
  type GraphwarWorkerBackendSelection,
  GraphwarWasmFault,
} from "../../core/algorithm-backend";
import {
  createGraphwarAuthoritativeTaskCoordinator,
  type GraphwarAuthoritativeAttemptContext,
  type GraphwarAuthoritativeResultCommitContext,
  type GraphwarAuthoritativeTask,
} from "../../core/authoritative-task";
import { createGraphwarWorkerBackendSlot } from "../../core/worker-backend";
import { detectGraphwarObjectsInBounds, detectGraphwarPlayArea } from "../objects";
import type {
  GraphwarObjectDetectionInstrumentation,
  GraphwarObjectDetectionStage,
  GraphwarObjectsDetectionResult,
} from "../objects";
import type {
  GraphwarAutoDetectionInput,
  GraphwarAutoDetectionResult,
  GraphwarBoundsDetectionInput,
  GraphwarBoundsOnlyDetectionInput,
  GraphwarBoundsOnlyDetectionResult,
  GraphwarDetectionWorkerRequest,
  GraphwarDetectionWorkerResponse,
  GraphwarDetectionWorkerStage,
  GraphwarDetectionWorkerSuccessResponse,
  GraphwarDetectionWorkerTimingDetail,
  GraphwarDetectionWorkerTimingEntry,
} from "./protocol";
import { measureDetectionStage } from "./timing";

export type { GraphwarDetectionWorkerStage };
export type { GraphwarDetectionWorkerTimingDetail };
export type { GraphwarDetectionWorkerTimingEntry };

/** 检测任务被用户取消或新任务替代。 */
export class GraphwarDetectionCancelledError extends Error {
  constructor() {
    super("Graphwar detection cancelled");
    this.name = "GraphwarDetectionCancelledError";
  }
}

/** 判断错误是否只是检测任务被取消，页面不应当展示为失败。 */
export function isGraphwarDetectionCancelledError(error: unknown) {
  return error instanceof GraphwarDetectionCancelledError;
}

/** 单次检测运行时的页面回调。 */
export interface GraphwarDetectionRunOptions<
  TResult extends GraphwarDetectionWorkerSuccessResponse["result"] = GraphwarDetectionWorkerSuccessResponse["result"],
> {
  /** Workflow result stays provisional until this asynchronous generation-gated commit finishes. */
  commitResult?: (
    result: TResult,
    timings: readonly GraphwarDetectionWorkerTimingEntry[],
    context: GraphwarAuthoritativeResultCommitContext,
  ) => Promise<void> | void;
  /** Worker 进入耗时阶段时通知页面更新状态。 */
  onStage?: (stage: GraphwarDetectionWorkerStage) => void;
  /** Worker 或同步 fallback 完成后返回各识别阶段的准确耗时。 */
  onTimings?: (timings: readonly GraphwarDetectionWorkerTimingEntry[]) => void;
}

/** 当前权威 detection outer task；Worker 与同步 fallback 共用同一 commit gate。 */
interface PendingDetectionAttempt {
  /** 当前 outer task 中唯一可提交的 backend attempt。 */
  attempt: GraphwarBackendAttemptIdentity;
  /** 发送给 Worker 的请求 id。 */
  id: number;
  /** 当前 attempt 的所有非终态事件都必须通过 coordinator publish。 */
  publish: (event: GraphwarDetectionAttemptEvent) => boolean;
  /** Promise 失败回调。 */
  reject: (reason?: unknown) => void;
  /** Promise 成功回调。 */
  resolve: (value: GraphwarDetectionAttemptResult) => void;
  /** 当前请求的任务类型；成功响应必须与它一致。 */
  taskType: GraphwarDetectionWorkerRequest["task"]["type"];
}

/** Detection main Worker 与 nested template Worker 共用的 backend 生命周期注入点。 */
export interface GraphwarDetectionRunnerOptions {
  backendConfiguration?: GraphwarWorkerBackendConfiguration;
  createBackendSelection?: () => GraphwarWorkerBackendSelection;
  /** Returning a newer generation authorizes this runner to replace the faulted attempt with TS cold replay. */
  onWasmFault?: (message: Extract<GraphwarBackendControlMessage, { type: "wasm-fault" }>) => number | undefined;
}

type GraphwarDetectionAttemptResult = GraphwarDetectionWorkerSuccessResponse extends infer TResponse
  ? TResponse extends GraphwarDetectionWorkerSuccessResponse
    ? Pick<TResponse, "result" | "taskType" | "timings">
    : never
  : never;

interface GraphwarDetectionAttemptEvent {
  stage: GraphwarDetectionWorkerStage;
}

/** 创建页面可复用的检测 runner。 */
export function createGraphwarDetectionRunner(options: GraphwarDetectionRunnerOptions = {}) {
  if (options.backendConfiguration && options.createBackendSelection) {
    throw new TypeError("Detection runner cannot combine fixed and dynamic backend selection");
  }
  const fixedBackendConfiguration =
    options.backendConfiguration ?? createGraphwarTypescriptWorkerBackendConfiguration(0);
  const createBackendSelection =
    options.createBackendSelection ??
    (() => ({
      generation: fixedBackendConfiguration.generation,
      promise: Promise.resolve(fixedBackendConfiguration),
    }));
  let worker: Worker | undefined;
  let workerBackendSlot: ReturnType<typeof createGraphwarWorkerBackendSlot> | undefined;
  let workerConfiguration: GraphwarWorkerBackendConfiguration | undefined;
  let nextRequestId = 1;
  let pendingAttempt: PendingDetectionAttempt | undefined;
  let activeTask: GraphwarAuthoritativeTask<GraphwarDetectionAttemptResult> | undefined;

  const coordinator = createGraphwarAuthoritativeTaskCoordinator<
    GraphwarDetectionWorkerRequest["task"],
    GraphwarDetectionWorkerRequest["task"],
    GraphwarDetectionAttemptResult,
    GraphwarDetectionAttemptEvent
  >({
    cloneInput: cloneGraphwarDetectionTask,
    cloneSnapshotForAttempt: cloneGraphwarDetectionTask,
    executeAttempt,
  });

  /** 懒创建检测 Worker；不支持 Worker 的环境会走同步 fallback。 */
  function ensureWorker(configuration: GraphwarWorkerBackendConfiguration) {
    if (typeof Worker === "undefined") {
      return undefined;
    }
    if (worker && workerConfiguration && isSameBackendConfiguration(workerConfiguration, configuration)) {
      return worker;
    }
    resetWorker();

    const createdWorker = new Worker(new URL("../../workers/detection/main.worker.ts", import.meta.url), {
      name: "graphwar-detection",
      type: "module",
    });
    worker = createdWorker;
    createdWorker.addEventListener(
      "message",
      (event: MessageEvent<GraphwarBackendControlMessage | GraphwarDetectionWorkerResponse>) => {
        handleWorkerMessage(createdWorker, event);
      },
    );
    createdWorker.addEventListener("messageerror", () => {
      rejectPendingTaskFromWorker(
        createdWorker,
        new Error("Graphwar detection worker message could not be deserialized"),
      );
    });
    createdWorker.addEventListener("error", (event: ErrorEvent) => {
      rejectPendingTaskFromWorker(createdWorker, event.error instanceof Error ? event.error : new Error(event.message));
    });
    let initializationError: Error | undefined;
    let initializationFault: Extract<GraphwarBackendControlMessage, { type: "wasm-fault" }> | undefined;
    let isBackendSlotCreated = false;
    const createdBackendSlot = createGraphwarWorkerBackendSlot({
      configuration,
      onInfrastructureFailure: (error) => {
        if (isBackendSlotCreated) {
          rejectPendingTaskFromWorker(createdWorker, error);
        } else {
          initializationError = error;
        }
      },
      onWasmFault: (message) => {
        if (isBackendSlotCreated) {
          handleWasmFaultFromWorker(createdWorker, message);
        } else {
          initializationFault = message;
          initializationError = new GraphwarWasmFault(message.fault.code, message.fault.message);
        }
      },
      role: "detection-main",
      worker: createdWorker,
    });
    isBackendSlotCreated = true;
    const backendState = createdBackendSlot.getState();
    if (initializationError) {
      if (initializationFault) {
        const replacementGeneration = options.onWasmFault?.(initializationFault);
        if (replacementGeneration !== undefined) {
          coordinator.replayGenerationAsTypescript(initializationFault.generation, replacementGeneration);
        }
      }
      if (worker === createdWorker) {
        worker = undefined;
        workerBackendSlot = undefined;
        workerConfiguration = undefined;
      }
      createdWorker.terminate();
      throw initializationError;
    }
    if (backendState.type === "failed") {
      if (worker === createdWorker) {
        worker = undefined;
        workerBackendSlot = undefined;
        workerConfiguration = undefined;
      }
      createdWorker.terminate();
      throw backendState.error;
    }
    workerBackendSlot = createdBackendSlot;
    workerConfiguration = configuration;
    return createdWorker;
  }

  /** 执行自动检测流程，先识别坐标系边界，再在边界内识别对象。 */
  function detectAuto(
    input: GraphwarAutoDetectionInput,
    options?: GraphwarDetectionRunOptions<GraphwarAutoDetectionResult>,
  ) {
    return runDetectionTask<GraphwarAutoDetectionResult>(
      {
        imageData: input.imageData,
        soldierSettings: input.soldierSettings,
        thresholds: input.thresholds,
        type: "detect-auto",
      },
      options,
    );
  }

  /** 只识别坐标系边界，供手动“识别边界”按钮使用。 */
  function detectBounds(
    input: GraphwarBoundsOnlyDetectionInput,
    options?: GraphwarDetectionRunOptions<GraphwarBoundsOnlyDetectionResult>,
  ) {
    return runDetectionTask<GraphwarBoundsOnlyDetectionResult>(
      {
        imageData: input.imageData,
        type: "detect-bounds-only",
      },
      options,
    );
  }

  /** 执行已知边界内的对象识别，复用自动检测的 Worker 管线。 */
  function detectObjectsInBounds(
    input: GraphwarBoundsDetectionInput,
    options?: GraphwarDetectionRunOptions<GraphwarObjectsDetectionResult>,
  ) {
    return runDetectionTask<GraphwarObjectsDetectionResult>(
      {
        edgeRect: input.edgeRect,
        imageData: input.imageData,
        soldierSettings: input.soldierSettings,
        thresholds: input.thresholds,
        type: "detect-bounds",
      },
      options,
    );
  }

  /** 为一次公开检测同步固定 master RGBA snapshot，再等待 backend selection。 */
  function runDetectionTask<TResult extends GraphwarDetectionWorkerSuccessResponse["result"]>(
    taskInput: GraphwarDetectionWorkerRequest["task"],
    runOptions: GraphwarDetectionRunOptions<TResult> | undefined,
  ) {
    cancel();
    const task = coordinator.beginTask(taskInput, createBackendSelection(), {
      commitResult: async (completed, context) => {
        if (runOptions?.commitResult) {
          await runOptions.commitResult(completed.result as TResult, completed.timings, context);
          return;
        }
        context.commit(() => runOptions?.onTimings?.(completed.timings));
      },
      onEvent: (event) => runOptions?.onStage?.(event.stage),
    });
    activeTask = task;
    return task.promise.then(
      (completed) => {
        if (activeTask === task) {
          activeTask = undefined;
        }
        return completed.result as TResult;
      },
      (error) => {
        if (activeTask === task) {
          activeTask = undefined;
        }
        throw error;
      },
    );
  }

  /** 每个 attempt 只消费自己的 snapshot；Worker transfer 不能 detach coordinator 的 master copy。 */
  function executeAttempt(
    context: GraphwarAuthoritativeAttemptContext<GraphwarDetectionWorkerRequest["task"], GraphwarDetectionAttemptEvent>,
  ) {
    const activeWorker = ensureWorker(context.backendConfiguration);
    if (!activeWorker) {
      const completed = runDetectionTaskSynchronously(context.snapshot, (stage) => context.publish({ stage }));
      return { cancel: () => undefined, result: Promise.resolve(completed) };
    }

    const request: GraphwarDetectionWorkerRequest = {
      attempt: context.attempt,
      id: nextRequestId,
      task: context.snapshot,
    };
    nextRequestId += 1;
    let rejectAttempt: (reason?: unknown) => void = () => undefined;
    const result = new Promise<GraphwarDetectionAttemptResult>((resolve, reject) => {
      rejectAttempt = reject;
      const attempt: PendingDetectionAttempt = {
        attempt: request.attempt,
        id: request.id,
        publish: context.publish,
        reject,
        resolve,
        taskType: request.task.type,
      };
      pendingAttempt = attempt;
      try {
        const imageBuffer = request.task.imageData.data.buffer;
        activeWorker.postMessage(request, imageBuffer instanceof ArrayBuffer ? [imageBuffer] : []);
      } catch (error) {
        rejectAttemptFromWorker(attempt, error);
      }
    });
    return {
      cancel: () => {
        const attempt = pendingAttempt;
        if (attempt?.attempt === request.attempt) {
          pendingAttempt = undefined;
          rejectAttempt(new GraphwarDetectionCancelledError());
        }
        resetWorker();
      },
      result,
    };
  }

  /** 取消当前检测并丢弃 Worker，避免旧任务继续占用资源或回写状态。 */
  function cancel() {
    const task = activeTask;
    if (!task) {
      return false;
    }
    activeTask = undefined;
    return task.cancel(new GraphwarDetectionCancelledError());
  }

  /** 关闭 runner 时释放 Worker，并让挂起任务按取消处理。 */
  function close() {
    cancel();
    resetWorker();
  }

  /** 只接收当前 request id、attempt 和 commit gate 都仍权威的 Worker 消息。 */
  function handleWorkerMessage(
    sourceWorker: Worker,
    event: MessageEvent<GraphwarBackendControlMessage | GraphwarDetectionWorkerResponse>,
  ) {
    if (worker !== sourceWorker) {
      return;
    }
    if (isGraphwarBackendControlMessage(event.data)) {
      if (event.data.role === "detection-main") {
        workerBackendSlot?.handleMessage(event.data);
      } else if (event.data.role === "detection-template" && event.data.type === "wasm-fault") {
        handleWasmFaultFromWorker(sourceWorker, event.data);
      } else {
        rejectPendingTaskFromWorker(sourceWorker, new Error("Detection Worker returned invalid backend control"));
      }
      return;
    }
    const attempt = pendingAttempt;
    if (!attempt) {
      return;
    }
    const response = event.data;
    if (response.id !== attempt.id || !graphwarBackendAttemptIdentitiesAreEqual(response.attempt, attempt.attempt)) {
      // Backend replacement 会沿用 outer task；旧 attempt 的迟到消息只作废，不能使新 attempt 失败。
      return;
    }
    if (response.type === "stage") {
      attempt.publish({ stage: response.stage });
      return;
    }

    if (response.type === "error") {
      rejectAttemptFromWorker(attempt, new Error(response.message));
      return;
    }
    if (response.taskType !== attempt.taskType) {
      rejectAttemptFromWorker(attempt, new Error("Detection Worker returned a mismatched task result"));
      return;
    }
    pendingAttempt = undefined;
    attempt.resolve(response);
  }

  /** Root 或 nested Worker 的 typed fault 直接通知页面 fuse，不进入 detection infrastructure fallback。 */
  function handleWasmFaultFromWorker(
    sourceWorker: Worker,
    message: Extract<GraphwarBackendControlMessage, { type: "wasm-fault" }>,
  ) {
    if (worker !== sourceWorker) {
      return;
    }
    const attempt = pendingAttempt;
    if (
      attempt &&
      message.context.type !== "initialization" &&
      !graphwarBackendAttemptIdentitiesAreEqual(message.context.attempt, attempt.attempt)
    ) {
      return;
    }
    const replacementGeneration = options.onWasmFault?.(message);
    if (
      replacementGeneration !== undefined &&
      coordinator.replayGenerationAsTypescript(message.generation, replacementGeneration)
    ) {
      return;
    }
    if (attempt) {
      rejectAttemptFromWorker(attempt, new GraphwarWasmFault(message.fault.code, message.fault.message));
    } else {
      resetWorker();
    }
  }

  /** 统一拒绝挂起任务并丢弃当前 Worker。 */
  function rejectPendingTask(error: Error) {
    const attempt = pendingAttempt;
    if (attempt) {
      rejectAttemptFromWorker(attempt, error);
      return;
    }
    activeTask?.fail(error);
    resetWorker();
  }

  /** 迟到的旧 Worker 基础设施事件不得使当前 outer task 失败。 */
  function rejectPendingTaskFromWorker(sourceWorker: Worker, error: Error) {
    if (worker === sourceWorker) {
      rejectPendingTask(error);
    }
  }

  /** Ordinary Worker failures reject only this task and preserve the fixed no-replay matrix. */
  function rejectAttemptFromWorker(attempt: PendingDetectionAttempt, error: unknown) {
    if (pendingAttempt !== attempt) {
      return;
    }
    pendingAttempt = undefined;
    attempt.reject(error);
    resetWorker();
  }

  /** 终止当前 Worker；下一次检测会重新懒创建。 */
  function resetWorker() {
    if (!worker) {
      return;
    }
    worker.terminate();
    worker = undefined;
    workerBackendSlot = undefined;
    workerConfiguration = undefined;
  }

  return {
    cancel,
    close,
    detectAuto,
    detectBounds,
    detectObjectsInBounds,
    replayGenerationAsTypescript: coordinator.replayGenerationAsTypescript,
  };
}

/** 在无 Worker 环境中同步执行完整自动检测，并保留阶段耗时回调。 */
function detectAutoSynchronously(
  input: GraphwarAutoDetectionInput,
  onStage: (stage: GraphwarDetectionWorkerStage) => void,
): { result: GraphwarAutoDetectionResult; timings: readonly GraphwarDetectionWorkerTimingEntry[] } {
  onStage("detecting-bounds");
  const timings: GraphwarDetectionWorkerTimingEntry[] = [];
  const edgeRect = measureDetectionStage(timings, "detecting-bounds", () => detectGraphwarPlayArea(input.imageData));
  if (!edgeRect) {
    return { result: { edgeRect: undefined }, timings };
  }

  onStage("detecting-objects");
  const objects = detectGraphwarObjectsInBounds(
    input.imageData,
    edgeRect,
    input.thresholds,
    input.soldierSettings,
    createObjectDetectionInstrumentation(timings),
  );
  return {
    result: {
      edgeRect,
      objects,
    },
    timings,
  };
}

/** 在无 Worker 环境中同步执行边界识别。 */
function detectBoundsSynchronously(
  input: GraphwarBoundsOnlyDetectionInput,
  onStage: (stage: GraphwarDetectionWorkerStage) => void,
): { result: GraphwarBoundsOnlyDetectionResult; timings: readonly GraphwarDetectionWorkerTimingEntry[] } {
  onStage("detecting-bounds");
  const timings: GraphwarDetectionWorkerTimingEntry[] = [];
  const edgeRect = measureDetectionStage(timings, "detecting-bounds", () => detectGraphwarPlayArea(input.imageData));
  return { result: { edgeRect }, timings };
}

/** 在无 Worker 环境中同步执行边界内对象检测。 */
function detectObjectsInBoundsSynchronously(
  input: GraphwarBoundsDetectionInput,
  onStage: (stage: GraphwarDetectionWorkerStage) => void,
) {
  onStage("detecting-objects");
  const timings: GraphwarDetectionWorkerTimingEntry[] = [];
  return {
    result: detectGraphwarObjectsInBounds(
      input.imageData,
      input.edgeRect,
      input.thresholds,
      input.soldierSettings,
      createObjectDetectionInstrumentation(timings),
    ),
    timings,
  };
}

/** 无 Worker 时仍从 attempt snapshot 执行完整 TS cold path。 */
function runDetectionTaskSynchronously(
  task: GraphwarDetectionWorkerRequest["task"],
  onStage: (stage: GraphwarDetectionWorkerStage) => void,
): GraphwarDetectionAttemptResult {
  if (task.type === "detect-bounds-only") {
    return { ...detectBoundsSynchronously(task, onStage), taskType: "detect-bounds-only" };
  }
  if (task.type === "detect-auto") {
    return { ...detectAutoSynchronously(task, onStage), taskType: "detect-auto" };
  }
  return { ...detectObjectsInBoundsSynchronously(task, onStage), taskType: "detect-bounds" };
}

/** Master 与 attempt 都持有 owned RGBA；任何 Worker transfer 只会 detach attempt copy。 */
function cloneGraphwarDetectionTask(
  task: GraphwarDetectionWorkerRequest["task"],
): GraphwarDetectionWorkerRequest["task"] {
  const imageData = {
    data: new Uint8ClampedArray(task.imageData.data),
    height: task.imageData.height,
    width: task.imageData.width,
  } as ImageData;
  if (task.type === "detect-bounds-only") {
    return {
      imageData,
      type: "detect-bounds-only",
    };
  }

  const soldierSettings = task.soldierSettings;
  const cloneableSharedInput = {
    imageData,
    soldierSettings: soldierSettings
      ? {
          candidateTopRatio: soldierSettings.candidateTopRatio,
          maximumSoldierCount: soldierSettings.maximumSoldierCount,
          templateMatchingWorkerCount: soldierSettings.templateMatchingWorkerCount,
        }
      : undefined,
    thresholds: {
      minArea: task.thresholds.minArea,
    },
  };

  if (task.type === "detect-auto") {
    return {
      ...cloneableSharedInput,
      type: "detect-auto",
    };
  }

  return {
    ...cloneableSharedInput,
    edgeRect: {
      height: task.edgeRect.height,
      width: task.edgeRect.width,
      x: task.edgeRect.x,
      y: task.edgeRect.y,
    },
    type: "detect-bounds",
  };
}

/** A reused main Worker is valid only for the exact generation and backend material it was initialized with. */
function isSameBackendConfiguration(
  left: GraphwarWorkerBackendConfiguration,
  right: GraphwarWorkerBackendConfiguration,
) {
  return (
    left.generation === right.generation &&
    left.backend.type === right.backend.type &&
    (left.backend.type === "typescript" ||
      (right.backend.type === "wasm" && left.backend.module === right.backend.module))
  );
}

/** 将对象识别内部阶段计时接入 Worker timing 列表。 */
function createObjectDetectionInstrumentation(
  timings: GraphwarDetectionWorkerTimingEntry[],
): GraphwarObjectDetectionInstrumentation {
  return {
    measureStage: <TResult>(stage: GraphwarObjectDetectionStage, task: () => TResult) =>
      measureDetectionStage(timings, stage, task),
  };
}
