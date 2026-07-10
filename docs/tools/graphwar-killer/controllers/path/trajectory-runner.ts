import { createGraphPoint, createPixelPoint } from "../../core/types";
import type {
  GraphwarTrajectoryCalculationInput,
  GraphwarTrajectoryCalculationOutcome,
  GraphwarTrajectoryCalculationWorkerRequest,
  GraphwarTrajectoryCalculationWorkerResponse,
} from "./trajectory-calculation";
import { calculateGraphwarTrajectory } from "./trajectory-calculation";

/** 主轨迹任务被取消、被更新输入替代，或 runner 已关闭。 */
export class GraphwarTrajectoryCancelledError extends Error {
  constructor() {
    super("Graphwar trajectory calculation cancelled");
    this.name = "GraphwarTrajectoryCancelledError";
  }
}

/** 取消属于正常的 latest-wins 流程，不应作为解算失败展示。 */
export function isGraphwarTrajectoryCancelledError(error: unknown) {
  return error instanceof GraphwarTrajectoryCancelledError;
}

export interface GraphwarTrajectoryRunResult {
  /** 函数解算和轨迹模拟的原子结果。 */
  outcome: GraphwarTrajectoryCalculationOutcome;
  /** 从 run 调用到结果可写回页面的端到端耗时。 */
  elapsedMs: number;
}

export interface GraphwarTrajectoryRunnerOptions {
  /** 测试注入点；页面默认创建专用 module Worker。 */
  createWorker?: () => Worker;
  /** 端到端计时入口。 */
  now?: () => number;
  /** Worker 永久不可用时通知页面显示持续降级警告。 */
  onFallback?: (reason: string) => void;
  /** 每次主线程降级任务前先让浏览器绘制状态，再执行可能很慢的同步计算。 */
  waitForFallbackPaint?: () => Promise<void>;
}

interface PendingTrajectoryTask {
  generation: number;
  id: number;
  input: GraphwarTrajectoryCalculationInput;
  reject: (reason?: unknown) => void;
  resolve: (value: GraphwarTrajectoryRunResult) => void;
  settled: boolean;
  startedAt: number;
  workerFailureCount: number;
}

interface TrajectoryWorkerSlot {
  activeTask?: PendingTrajectoryTask;
  worker: Worker;
}

const WORKER_SLOT_TARGET = 2;

/**
 * 创建主轨迹 runner。
 *
 * 同一时刻只有一个权威任务；第二个常驻 Worker 作为热备，让新输入可以先终止旧计算，再立即使用已经加载的 Worker，而不必等待旧同步循环响应取消消息。
 */
export function createGraphwarTrajectoryRunner(options: GraphwarTrajectoryRunnerOptions = {}) {
  const createWorker = options.createWorker ?? createDefaultTrajectoryWorker;
  const now = options.now ?? getCurrentTime;
  const workerSlots: TrajectoryWorkerSlot[] = [];
  let closed = false;
  let currentTask: PendingTrajectoryTask | undefined;
  let generation = 0;
  let nextRequestId = 1;
  let workerFallback = false;

  function run(input: GraphwarTrajectoryCalculationInput) {
    const startedAt = now();
    if (closed) {
      return Promise.reject<GraphwarTrajectoryRunResult>(new GraphwarTrajectoryCancelledError());
    }

    cancelCurrentTask();
    generation += 1;
    // PostMessage 不能克隆 Vue reactive proxy；进入 runner 时统一固定为本次任务的纯数据快照。
    let taskInput: GraphwarTrajectoryCalculationInput;
    try {
      taskInput = cloneGraphwarTrajectoryCalculationInput(input);
    } catch (error) {
      return Promise.reject<GraphwarTrajectoryRunResult>(
        normalizeError(error, "Graphwar trajectory input could not be cloned"),
      );
    }
    const taskGeneration = generation;
    const requestId = nextRequestId;
    nextRequestId += 1;

    return new Promise<GraphwarTrajectoryRunResult>((resolve, reject) => {
      const task: PendingTrajectoryTask = {
        generation: taskGeneration,
        id: requestId,
        input: taskInput,
        reject,
        resolve,
        settled: false,
        startedAt,
        workerFailureCount: 0,
      };
      currentTask = task;
      if (workerFallback) {
        void runOnMainThread(task);
        return;
      }
      startWorkerTask(task);
    });
  }

  /** 取消权威任务；忙碌 Worker 必须硬终止，避免过期 Step 计算继续占用 CPU。 */
  function cancel() {
    generation += 1;
    cancelCurrentTask();
  }

  /** 页面卸载后永久关闭 runner，并释放热备 Worker。 */
  function close() {
    if (closed) {
      return;
    }
    closed = true;
    cancel();
    for (const slot of [...workerSlots]) {
      terminateWorkerSlot(slot);
    }
  }

  function cancelCurrentTask() {
    const task = currentTask;
    if (!task) {
      return;
    }

    currentTask = undefined;
    const activeSlot = workerSlots.find((slot) => slot.activeTask === task);
    if (activeSlot) {
      terminateWorkerSlot(activeSlot);
    }
    settleTask(task, () => task.reject(new GraphwarTrajectoryCancelledError()));
  }

  function startWorkerTask(task: PendingTrajectoryTask) {
    if (!isCurrentTask(task)) {
      return;
    }

    const idleSlot = workerSlots.find((slot) => !slot.activeTask);
    if (idleSlot) {
      postWorkerTask(idleSlot, task);
      return;
    }

    const created = tryCreateWorkerSlot();
    if (created.slot) {
      postWorkerTask(created.slot, task);
      return;
    }
    handleWorkerInfrastructureFailure(task, created.error);
  }

  function postWorkerTask(slot: TrajectoryWorkerSlot, task: PendingTrajectoryTask) {
    slot.activeTask = task;
    try {
      slot.worker.postMessage({
        id: task.id,
        input: task.input,
      } satisfies GraphwarTrajectoryCalculationWorkerRequest);
    } catch (error) {
      slot.activeTask = undefined;
      terminateWorkerSlot(slot);
      handleWorkerInfrastructureFailure(task, normalizeError(error, "Graphwar trajectory worker request failed"));
      return;
    }

    ensureHotSpare();
  }

  function ensureHotSpare() {
    while (!closed && !workerFallback && workerSlots.length < WORKER_SLOT_TARGET) {
      const created = tryCreateWorkerSlot();
      if (!created.slot) {
        return;
      }
    }
  }

  function tryCreateWorkerSlot():
    | { error: Error; slot?: undefined }
    | { error?: undefined; slot: TrajectoryWorkerSlot } {
    let worker: Worker | undefined;
    try {
      worker = createWorker();
      const slot: TrajectoryWorkerSlot = { worker };
      worker.addEventListener("message", (event: MessageEvent<GraphwarTrajectoryCalculationWorkerResponse>) =>
        handleWorkerMessage(slot, event),
      );
      worker.addEventListener("messageerror", () =>
        handleWorkerFailure(slot, new Error("Graphwar trajectory worker response could not be deserialized")),
      );
      worker.addEventListener("error", (event: ErrorEvent) =>
        handleWorkerFailure(
          slot,
          event.error instanceof Error ? event.error : new Error(event.message || "Graphwar trajectory worker failed"),
        ),
      );
      workerSlots.push(slot);
      return { slot };
    } catch (error) {
      worker?.terminate();
      return { error: normalizeError(error, "Graphwar trajectory worker is unavailable") };
    }
  }

  function handleWorkerMessage(
    slot: TrajectoryWorkerSlot,
    event: MessageEvent<GraphwarTrajectoryCalculationWorkerResponse>,
  ) {
    const task = slot.activeTask;
    if (workerSlots.indexOf(slot) < 0 || !task || !isCurrentTask(task)) {
      return;
    }
    const response = event.data as unknown;
    if (!isWorkerResponseEnvelope(response)) {
      handleWorkerFailure(slot, new Error("Graphwar trajectory worker returned an invalid response"));
      return;
    }
    if (response.id !== task.id) {
      handleWorkerFailure(slot, new Error("Graphwar trajectory worker returned an unexpected request id"));
      return;
    }
    const outcome = response.outcome;
    if (!isGraphwarTrajectoryCalculationOutcome(outcome, task.input.type)) {
      handleWorkerFailure(slot, new Error("Graphwar trajectory worker returned an invalid outcome"));
      return;
    }

    slot.activeTask = undefined;
    currentTask = undefined;
    settleTask(task, () =>
      task.resolve({
        elapsedMs: getElapsedMs(now, task.startedAt),
        outcome,
      }),
    );
  }

  function handleWorkerFailure(slot: TrajectoryWorkerSlot, error: Error) {
    if (workerSlots.indexOf(slot) < 0) {
      return;
    }

    const task = slot.activeTask;
    slot.activeTask = undefined;
    terminateWorkerSlot(slot);
    if (!task || !isCurrentTask(task)) {
      // 空闲 Worker 异步失败时等下一次任务再补建，避免故障环境中连续创建失败 Worker。
      return;
    }
    handleWorkerInfrastructureFailure(task, error);
  }

  function handleWorkerInfrastructureFailure(task: PendingTrajectoryTask, error: Error) {
    if (!isCurrentTask(task)) {
      return;
    }

    // 第一次基础设施失败优先换到热备；热备也失败才永久回退主线程。
    if (task.workerFailureCount === 0) {
      task.workerFailureCount = 1;
      startWorkerTask(task);
      return;
    }

    enterMainThreadFallback(error);
    void runOnMainThread(task);
  }

  function enterMainThreadFallback(error: Error) {
    if (workerFallback) {
      return;
    }

    workerFallback = true;
    for (const slot of [...workerSlots]) {
      terminateWorkerSlot(slot);
    }
    const reason = error.message;
    try {
      options.onFallback?.(reason);
    } catch {
      // 状态渲染回调异常不能阻止保底计算继续执行。
    }
  }

  async function waitForFallbackStatusPaint() {
    try {
      await options.waitForFallbackPaint?.();
    } catch {
      // 浏览器绘制等待失败时仍需继续执行主线程保底计算。
    }
  }

  async function runOnMainThread(task: PendingTrajectoryTask) {
    await waitForFallbackStatusPaint();
    if (!isCurrentTask(task)) {
      return;
    }

    let outcome: GraphwarTrajectoryCalculationOutcome;
    try {
      outcome = calculateGraphwarTrajectory(task.input);
    } catch (error) {
      if (!isCurrentTask(task)) {
        return;
      }
      currentTask = undefined;
      settleTask(task, () => task.reject(normalizeError(error, "Graphwar trajectory main-thread fallback failed")));
      return;
    }
    if (!isCurrentTask(task)) {
      return;
    }
    currentTask = undefined;
    settleTask(task, () =>
      task.resolve({
        elapsedMs: getElapsedMs(now, task.startedAt),
        outcome,
      }),
    );
  }

  function isCurrentTask(task: PendingTrajectoryTask) {
    return !closed && currentTask === task && task.generation === generation && !task.settled;
  }

  function settleTask(task: PendingTrajectoryTask, callback: () => void) {
    if (task.settled) {
      return;
    }
    task.settled = true;
    callback();
  }

  function terminateWorkerSlot(slot: TrajectoryWorkerSlot) {
    const index = workerSlots.indexOf(slot);
    if (index >= 0) {
      workerSlots.splice(index, 1);
    }
    slot.activeTask = undefined;
    slot.worker.terminate();
  }

  return {
    cancel,
    close,
    run,
  };
}

function createDefaultTrajectoryWorker() {
  if (typeof Worker === "undefined") {
    throw new Error("Web Worker is unavailable");
  }
  return new Worker(new URL("../../workers/trajectory/main.worker.ts", import.meta.url), {
    name: "graphwar-main-trajectory",
    type: "module",
  });
}

function getCurrentTime() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function getElapsedMs(now: () => number, startedAt: number) {
  const elapsedMs = now() - startedAt;
  return Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
}

function normalizeError(error: unknown, fallbackMessage: string) {
  return error instanceof Error ? error : new Error(error === undefined ? fallbackMessage : String(error));
}

function isWorkerResponseEnvelope(response: unknown): response is { id: number; outcome?: unknown } {
  return typeof response === "object" && response !== null && "id" in response && typeof response.id === "number";
}

function isGraphwarTrajectoryCalculationOutcome(
  outcome: unknown,
  inputType: GraphwarTrajectoryCalculationInput["type"],
): outcome is GraphwarTrajectoryCalculationOutcome {
  if (typeof outcome !== "object" || outcome === null || !("ok" in outcome)) {
    return false;
  }
  if (outcome.ok === true) {
    if (!("result" in outcome) || typeof outcome.result !== "object" || outcome.result === null) {
      return false;
    }
    const result = outcome.result;
    if (!("curvePoints" in result) || typeof result.curvePoints !== "string") {
      return false;
    }
    if (
      "secondOrderLaunchAngleDegrees" in result &&
      result.secondOrderLaunchAngleDegrees !== undefined &&
      !Number.isFinite(result.secondOrderLaunchAngleDegrees)
    ) {
      return false;
    }
    if (
      "warningReason" in result &&
      result.warningReason !== undefined &&
      !isGraphwarTrajectoryWarningReason(result.warningReason)
    ) {
      return false;
    }
    const formulaResult = "formulaResult" in result ? result.formulaResult : undefined;
    return inputType === "solver" ? isFormulaResult(formulaResult) : formulaResult === undefined;
  }
  return (
    outcome.ok === false &&
    "message" in outcome &&
    typeof outcome.message === "string" &&
    "stage" in outcome &&
    (outcome.stage === "formula" || outcome.stage === "trajectory")
  );
}

function isFormulaResult(value: unknown) {
  if (typeof value !== "object" || value === null || !("expression" in value) || !("terms" in value)) {
    return false;
  }
  return (
    typeof value.expression === "string" &&
    Array.isArray(value.terms) &&
    value.terms.every(
      (term) =>
        typeof term === "object" &&
        term !== null &&
        "x" in term &&
        Number.isFinite(term.x) &&
        "deltaY" in term &&
        Number.isFinite(term.deltaY),
    )
  );
}

function isGraphwarTrajectoryWarningReason(value: unknown) {
  return (
    value === "invalid" ||
    value === "max-steps" ||
    value === "obstacle" ||
    value === "out-of-bounds" ||
    value === "too-steep"
  );
}

/** 深拷贝输入，且让同源 collision/glitch mask 在请求快照里继续共用同一份副本。 */
function cloneGraphwarTrajectoryCalculationInput(
  input: GraphwarTrajectoryCalculationInput,
): GraphwarTrajectoryCalculationInput {
  const sourceCollisionMask = input.collision?.mask;
  const collisionMask = sourceCollisionMask ? new Uint8Array(sourceCollisionMask) : undefined;
  const base = {
    bounds: {
      maxX: input.bounds.maxX,
      maxY: input.bounds.maxY,
      minX: input.bounds.minX,
      minY: input.bounds.minY,
    },
    boundsRect: {
      height: input.boundsRect.height,
      width: input.boundsRect.width,
      x: input.boundsRect.x,
      y: input.boundsRect.y,
    },
    ...(input.collision
      ? {
          collision: {
            ...(input.collision.boundaryExpansion === undefined
              ? {}
              : { boundaryExpansion: input.collision.boundaryExpansion }),
            ...(collisionMask ? { mask: collisionMask } : {}),
          },
        }
      : {}),
  };

  if (input.type === "simulator") {
    return {
      ...base,
      equation: input.equation,
      expression: input.expression,
      ...(input.launchAngleRadians === undefined ? {} : { launchAngleRadians: input.launchAngleRadians }),
      ...(input.parser ? { parser: { ...input.parser } } : {}),
      soldierCenter: createGraphPoint(input.soldierCenter.x, input.soldierCenter.y),
      type: "simulator",
    };
  }

  const sourceGlitchMask = input.settings.stepGlitchObstacleMask;
  const glitchMask = sourceGlitchMask
    ? sourceGlitchMask === sourceCollisionMask && collisionMask
      ? collisionMask
      : new Uint8Array(sourceGlitchMask)
    : undefined;
  return {
    ...base,
    points: input.points.map((point) => createGraphPoint(point.x, point.y)),
    settings: {
      algorithm: input.settings.algorithm,
      decimalPlaces: input.settings.decimalPlaces,
      equation: input.settings.equation,
      ...(input.settings.formulaPathSteepness === undefined
        ? {}
        : { formulaPathSteepness: input.settings.formulaPathSteepness }),
      steepness: input.settings.steepness,
      stepGlitchMode: input.settings.stepGlitchMode,
      ...(glitchMask ? { stepGlitchObstacleMask: glitchMask } : {}),
      stepOverflowProtection: input.settings.stepOverflowProtection,
    },
    ...(input.targetHitRadiusPixels === undefined ? {} : { targetHitRadiusPixels: input.targetHitRadiusPixels }),
    ...(input.targetPoint ? { targetPoint: createPixelPoint(input.targetPoint.x, input.targetPoint.y) } : {}),
    type: "solver",
  };
}
