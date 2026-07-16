import { createGraphPoint } from "../../core/types";
import type {
  GraphwarLiveClickPreviewRenderInput,
  GraphwarLiveClickPreviewRenderResult,
  GraphwarLiveClickPreviewWorkerRequest,
  GraphwarLiveClickPreviewWorkerResponse,
} from "./live-click-preview-render";

/** 实时预览任务被新鼠标位置替代。 */
class GraphwarLiveClickPreviewCancelledError extends Error {
  constructor() {
    super("Graphwar live click preview cancelled");
    this.name = "GraphwarLiveClickPreviewCancelledError";
  }
}

/** 判断实时预览失败是否只是正常的 latest-wins 取消。 */
export function isGraphwarLiveClickPreviewCancelledError(error: unknown) {
  return error instanceof GraphwarLiveClickPreviewCancelledError;
}

interface PendingLiveClickPreviewTask {
  cancelled: boolean;
  generation: number;
  id: number;
  reject: (reason?: unknown) => void;
  resolve: (value: GraphwarLiveClickPreviewRenderResult) => void;
  settled: boolean;
}

interface GraphwarLiveClickPreviewRunnerOptions {
  /** 已由页面校验/归一化的并行 Worker 数；runner 仍会二次 clamp 作为安全边界。 */
  workerCount: ReadonlyRef<number>;
}

interface ReadonlyRef<T> {
  readonly value: T;
}

interface LiveClickPreviewWorkerSlot {
  activeTask?: PendingLiveClickPreviewTask;
  worker: Worker;
}

export const GRAPHWAR_LIVE_CLICK_PREVIEW_WORKER_COUNT_MAXIMUM = 16;

/** 创建实时预览 runner；常驻 Worker 并行处理已开始任务，等待槽只保留最新落点。 */
export function createGraphwarLiveClickPreviewRunner(options: GraphwarLiveClickPreviewRunnerOptions) {
  const workerSlots: LiveClickPreviewWorkerSlot[] = [];
  let generation = 0;
  let latestSettledRequestId = 0;
  // 单个 runner 内的请求全序号；JS 安全整数空间足够一个浏览器会话使用，不做回绕分支。
  let nextRequestId = 1;
  let queuedTask: PendingLiveClickPreviewTask | undefined;
  let queuedTaskInput: GraphwarLiveClickPreviewRenderInput | undefined;
  let workerUnavailable = false;

  /** 复制可变输入外壳，并立即调度或替换等待中的预览任务。 */
  function render(input: GraphwarLiveClickPreviewRenderInput) {
    const requestId = nextRequestId;
    nextRequestId += 1;
    return new Promise<GraphwarLiveClickPreviewRenderResult>((resolve, reject) => {
      const task: PendingLiveClickPreviewTask = {
        cancelled: false,
        generation,
        id: requestId,
        reject,
        resolve,
        settled: false,
      };
      if (isWorkerUnavailable()) {
        settleTaskAsResult(task, createGuideOnlyRenderResult());
        return;
      }

      const taskInput = cloneRenderInput(input);
      if (startTaskIfPossible(task, taskInput)) {
        return;
      }

      // 高频 pointermove 只保留一个等待中的最新输入；已经开始的任务不硬中断。
      settleTaskAsCancelled(queuedTask);
      queuedTask = task;
      queuedTaskInput = taskInput;
    });
  }

  /** 尝试为任务获取一个槽位并完成协议投递。 */
  function startTaskIfPossible(task: PendingLiveClickPreviewTask, input: GraphwarLiveClickPreviewRenderInput) {
    const slot = claimIdleWorkerSlot();
    if (!slot) {
      if (workerUnavailable) {
        settleTaskAsResult(task, createGuideOnlyRenderResult());
        return true;
      }
      return false;
    }

    slot.activeTask = task;
    try {
      slot.worker.postMessage({
        id: task.id,
        input,
      } satisfies GraphwarLiveClickPreviewWorkerRequest);
    } catch (error) {
      slot.activeTask = undefined;
      settleTaskAsError(task, error instanceof Error ? error : new Error(String(error)));
      resetWorkerSlot(slot);
    }
    return true;
  }

  /** 取消当前预览上下文，并保留没有承载任务的热 Worker。 */
  function cancel() {
    generation += 1;
    latestSettledRequestId = nextRequestId - 1;
    settleTaskAsCancelled(queuedTask);
    queuedTask = undefined;
    queuedTaskInput = undefined;
    // 上下文已经失效时，旧任务既不能展示也不应继续占满池；空闲热 Worker 仍可复用。
    for (let index = workerSlots.length - 1; index >= 0; index -= 1) {
      const slot = workerSlots[index];
      const task = slot.activeTask;
      if (!task) {
        continue;
      }
      slot.activeTask = undefined;
      settleTaskAsCancelled(task);
      resetWorkerSlot(slot);
    }
  }

  /** 永久关闭 runner 并释放整个 Worker 池。 */
  function close() {
    cancel();
    for (const slot of workerSlots) {
      slot.worker.terminate();
    }
    workerSlots.length = 0;
  }

  /** 在并行上限内复用空闲槽，必要时懒创建 Worker。 */
  function claimIdleWorkerSlot() {
    if (isWorkerUnavailable()) {
      return undefined;
    }
    if (getActiveTaskCount() >= getWorkerCountLimit()) {
      return undefined;
    }
    for (const slot of workerSlots) {
      if (!slot.activeTask) {
        return slot;
      }
    }

    let worker: Worker;
    try {
      worker = new Worker(new URL("../../workers/live-click-preview/main.worker.ts", import.meta.url), {
        name: "graphwar-live-click-preview",
        type: "module",
      });
    } catch {
      // 首个 Worker 无法构造时多半是 CSP/WebView/module worker 限制；只保留外层引导虚线，避免退回主线程采样卡住交互。
      if (workerSlots.length === 0) {
        workerUnavailable = true;
      }
      return undefined;
    }

    const slot: LiveClickPreviewWorkerSlot = { worker };
    slot.worker.addEventListener("message", (event: MessageEvent<GraphwarLiveClickPreviewWorkerResponse>) =>
      handleWorkerMessage(slot, event),
    );
    slot.worker.addEventListener("messageerror", () => handleWorkerFailure(slot));
    slot.worker.addEventListener("error", () => handleWorkerFailure(slot));
    workerSlots.push(slot);
    return slot;
  }

  /** 校验槽位响应，并继续调度最新等待任务。 */
  function handleWorkerMessage(
    slot: LiveClickPreviewWorkerSlot,
    event: MessageEvent<GraphwarLiveClickPreviewWorkerResponse>,
  ) {
    const task = slot.activeTask;
    if (!task) {
      return;
    }
    const response: unknown = event.data;
    if (!isWorkerResponseForRequest(response, task.id)) {
      // 当前 slot 同时只处理一个请求；id/envelope 不匹配说明 Worker 协议已失效，沿用现有降级路径。
      handleWorkerFailure(slot);
      return;
    }

    slot.activeTask = undefined;
    if (response.type === "error") {
      settleTaskAsError(task, new Error(response.message));
      startQueuedTaskIfPossible();
      return;
    }

    settleTaskAsResult(task, response.result);
    startQueuedTaskIfPossible();
  }

  /** 将异步 Worker 故障转换成引导线降级，并释放整个池。 */
  function handleWorkerFailure(slot: LiveClickPreviewWorkerSlot) {
    if (workerSlots.indexOf(slot) < 0) {
      return;
    }

    // 异步加载/运行失败通常表示当前环境跑不了这个 Worker；降级为外层虚线，不回主线程采样。
    workerUnavailable = true;
    for (const workerSlot of workerSlots) {
      if (workerSlot.activeTask) {
        settleTaskAsResult(workerSlot.activeTask, createGuideOnlyRenderResult());
        workerSlot.activeTask = undefined;
      }
      workerSlot.worker.terminate();
    }
    workerSlots.length = 0;
    startQueuedTaskIfPossible();
  }

  /** 从等待槽原子取出最新任务，并在有容量时启动它。 */
  function startQueuedTaskIfPossible() {
    if (!queuedTask || !queuedTaskInput) {
      trimIdleWorkerSlots();
      return;
    }

    // 先原子移出队列，避免 postMessage 同步抛错时重入并再次投递同一任务。
    const task = queuedTask;
    const input = queuedTaskInput;
    queuedTask = undefined;
    queuedTaskInput = undefined;
    if (startTaskIfPossible(task, input)) {
      return;
    }
    queuedTask = task;
    queuedTaskInput = input;
    trimIdleWorkerSlots();
  }

  /** 只允许当前 generation 中最新完成的结果成功写回。 */
  function settleTaskAsResult(task: PendingLiveClickPreviewTask, result: GraphwarLiveClickPreviewRenderResult) {
    if (task.generation !== generation || task.cancelled || task.id < latestSettledRequestId) {
      settleTaskAsCancelled(task);
      return;
    }

    latestSettledRequestId = task.id;
    settleTask(task, () => task.resolve(result));
  }

  /** 只向仍然权威的任务传播渲染错误。 */
  function settleTaskAsError(task: PendingLiveClickPreviewTask, error: Error) {
    if (task.generation !== generation || task.cancelled || task.id < latestSettledRequestId) {
      settleTaskAsCancelled(task);
      return;
    }

    latestSettledRequestId = task.id;
    settleTask(task, () => task.reject(error));
  }

  /** 将存在的任务幂等结算为正常取消。 */
  function settleTaskAsCancelled(task: PendingLiveClickPreviewTask | undefined) {
    if (!task) {
      return;
    }

    task.cancelled = true;
    settleTask(task, () => task.reject(new GraphwarLiveClickPreviewCancelledError()));
  }

  /** 保证每个预览任务的 Promise 只结算一次。 */
  function settleTask(task: PendingLiveClickPreviewTask, callback: () => void) {
    if (task.settled) {
      return;
    }

    task.settled = true;
    callback();
  }

  /** 从池中移除并终止一个不可再用的槽位。 */
  function resetWorkerSlot(slot: LiveClickPreviewWorkerSlot) {
    const index = workerSlots.indexOf(slot);
    if (index >= 0) {
      workerSlots.splice(index, 1);
    }
    slot.worker.terminate();
  }

  /** 按当前配置回收超出并行上限的空闲槽位。 */
  function trimIdleWorkerSlots() {
    let idleBudget = Math.max(0, getWorkerCountLimit() - getActiveTaskCount());
    for (let index = 0; index < workerSlots.length; index += 1) {
      const slot = workerSlots[index];
      if (slot.activeTask) {
        continue;
      }
      if (idleBudget > 0) {
        idleBudget -= 1;
        continue;
      }
      workerSlots.splice(index, 1);
      index -= 1;
      slot.worker.terminate();
    }
  }

  /** 统计当前真正占用 Worker 的预览任务数。 */
  function getActiveTaskCount() {
    let count = 0;
    for (const slot of workerSlots) {
      if (slot.activeTask) {
        count += 1;
      }
    }
    return count;
  }

  /** 将响应式配置收窄到 runner 支持的并行范围。 */
  function getWorkerCountLimit() {
    const count = options.workerCount.value;
    return Number.isInteger(count) && count >= 1
      ? Math.min(count, GRAPHWAR_LIVE_CLICK_PREVIEW_WORKER_COUNT_MAXIMUM)
      : 1;
  }

  /** 记录当前环境是否已确定无法使用实时预览 Worker。 */
  function isWorkerUnavailable() {
    if (workerUnavailable || typeof Worker === "undefined") {
      workerUnavailable = true;
      return true;
    }
    return false;
  }

  return {
    cancel,
    close,
    render,
  };
}

/** 创建只保留外层引导线的降级结果。 */
function createGuideOnlyRenderResult(): GraphwarLiveClickPreviewRenderResult {
  return {
    curvePoints: "",
    elapsedMs: 0,
  };
}

/** 复制标量与点数组，隔离排队期间的界面修改；大型 mask 保留引用，投递时由 structured clone 复制。 */
function cloneRenderInput(input: GraphwarLiveClickPreviewRenderInput): GraphwarLiveClickPreviewRenderInput {
  const bounds = input.bounds;
  const boundsRect = input.boundsRect;
  const collision = input.collision;
  const base = {
    bounds: {
      maxX: bounds.maxX,
      maxY: bounds.maxY,
      minX: bounds.minX,
      minY: bounds.minY,
    },
    boundsRect: {
      height: boundsRect.height,
      width: boundsRect.width,
      x: boundsRect.x,
      y: boundsRect.y,
    },
    ...(collision
      ? {
          collision: {
            ...(collision.boundaryExpansion === undefined ? {} : { boundaryExpansion: collision.boundaryExpansion }),
            ...(collision.mask ? { mask: collision.mask } : {}),
          },
        }
      : {}),
  };
  if (input.type === "expression") {
    return {
      ...base,
      equation: input.equation,
      expression: input.expression,
      ...(input.launchAngleRadians === undefined ? {} : { launchAngleRadians: input.launchAngleRadians }),
      ...(input.parser ? { parser: { ...input.parser } } : {}),
      soldierCenter: createGraphPoint(input.soldierCenter.x, input.soldierCenter.y),
      type: "expression",
    };
  }

  return {
    ...base,
    points: input.points.map((point) => createGraphPoint(point.x, point.y)),
    settings: {
      algorithm: input.settings.algorithm,
      decimalPlaces: input.settings.decimalPlaces,
      equation: input.settings.equation,
      ...(input.settings.secondOrderLaunchAngleMode === undefined
        ? {}
        : { secondOrderLaunchAngleMode: input.settings.secondOrderLaunchAngleMode }),
      ...(input.settings.formulaPathSteepness === undefined
        ? {}
        : { formulaPathSteepness: input.settings.formulaPathSteepness }),
      steepness: input.settings.steepness,
      stepGlitchMode: input.settings.stepGlitchMode,
      ...(input.settings.stepGlitchObstacleMask
        ? { stepGlitchObstacleMask: input.settings.stepGlitchObstacleMask }
        : {}),
      stepOverflowProtection: input.settings.stepOverflowProtection,
    },
    type: "formula",
  };
}

/** 验证响应属于预期请求且满足成功或失败协议。 */
function isWorkerResponseForRequest(
  value: unknown,
  requestId: number,
): value is GraphwarLiveClickPreviewWorkerResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const response = value as Record<string, unknown>;
  if (response.id !== requestId) {
    return false;
  }
  if (response.type === "error") {
    return typeof response.message === "string";
  }
  if (response.type !== "success" || !response.result || typeof response.result !== "object") {
    return false;
  }
  const result = response.result as Record<string, unknown>;
  return typeof result.curvePoints === "string" && typeof result.elapsedMs === "number";
}
