import { createGraphPoint } from "../../core/types";
import type { BoundsRect, GraphBounds, GraphPoint } from "../../core/types";
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
      startQueuedTaskIfPossible();
    }
    return true;
  }

  function cancel() {
    generation += 1;
    latestSettledRequestId = nextRequestId - 1;
    settleTaskAsCancelled(queuedTask);
    queuedTask = undefined;
    queuedTaskInput = undefined;
    for (const slot of workerSlots) {
      if (slot.activeTask) {
        slot.activeTask.cancelled = true;
        settleTaskAsCancelled(slot.activeTask);
      }
    }
  }

  function close() {
    cancel();
    for (const slot of workerSlots) {
      slot.worker.terminate();
    }
    workerSlots.length = 0;
  }

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

  function handleWorkerMessage(
    slot: LiveClickPreviewWorkerSlot,
    event: MessageEvent<GraphwarLiveClickPreviewWorkerResponse>,
  ) {
    const task = slot.activeTask;
    const response = event.data;
    if (!task || task.id !== response.id) {
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

  function startQueuedTaskIfPossible() {
    if (!queuedTask || !queuedTaskInput) {
      trimIdleWorkerSlots();
      return;
    }

    const task = queuedTask;
    const input = queuedTaskInput;
    if (startTaskIfPossible(task, input)) {
      queuedTask = undefined;
      queuedTaskInput = undefined;
      return;
    }
    trimIdleWorkerSlots();
  }

  function settleTaskAsResult(task: PendingLiveClickPreviewTask, result: GraphwarLiveClickPreviewRenderResult) {
    if (task.generation !== generation || task.cancelled || task.id < latestSettledRequestId) {
      settleTaskAsCancelled(task);
      return;
    }

    latestSettledRequestId = task.id;
    settleTask(task, () => task.resolve(result));
  }

  function settleTaskAsError(task: PendingLiveClickPreviewTask, error: Error) {
    if (task.generation !== generation || task.cancelled || task.id < latestSettledRequestId) {
      settleTaskAsCancelled(task);
      return;
    }

    latestSettledRequestId = task.id;
    settleTask(task, () => task.reject(error));
  }

  function settleTaskAsCancelled(task: PendingLiveClickPreviewTask | undefined) {
    if (!task) {
      return;
    }

    task.cancelled = true;
    settleTask(task, () => task.reject(new GraphwarLiveClickPreviewCancelledError()));
  }

  function settleTask(task: PendingLiveClickPreviewTask, callback: () => void) {
    if (task.settled) {
      return;
    }

    task.settled = true;
    callback();
  }

  function resetWorkerSlot(slot: LiveClickPreviewWorkerSlot) {
    const index = workerSlots.indexOf(slot);
    if (index >= 0) {
      workerSlots.splice(index, 1);
    }
    slot.worker.terminate();
  }

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

  function getActiveTaskCount() {
    let count = 0;
    for (const slot of workerSlots) {
      if (slot.activeTask) {
        count += 1;
      }
    }
    return count;
  }

  function getWorkerCountLimit() {
    const count = options.workerCount.value;
    return Number.isInteger(count) && count >= 1
      ? Math.min(count, GRAPHWAR_LIVE_CLICK_PREVIEW_WORKER_COUNT_MAXIMUM)
      : 1;
  }

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

function createGuideOnlyRenderResult(): GraphwarLiveClickPreviewRenderResult {
  return {
    curvePoints: "",
    elapsedMs: 0,
  };
}

function cloneRenderInput(input: GraphwarLiveClickPreviewRenderInput): GraphwarLiveClickPreviewRenderInput {
  const base = {
    bounds: cloneGraphBounds(input.bounds),
    boundsRect: cloneBoundsRect(input.boundsRect),
    ...(input.collision ? { collision: cloneCollisionSettings(input.collision) } : {}),
  };
  if (input.type === "expression") {
    return {
      ...base,
      equation: input.equation,
      expression: input.expression,
      ...(input.launchAngleRadians === undefined ? {} : { launchAngleRadians: input.launchAngleRadians }),
      ...(input.parser ? { parser: { ...input.parser } } : {}),
      soldierCenter: cloneGraphPoint(input.soldierCenter),
      type: "expression",
    };
  }

  return {
    ...base,
    points: input.points.map(cloneGraphPoint),
    settings: {
      algorithm: input.settings.algorithm,
      decimalPlaces: input.settings.decimalPlaces,
      equation: input.settings.equation,
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

function cloneCollisionSettings(settings: NonNullable<GraphwarLiveClickPreviewRenderInput["collision"]>) {
  return {
    ...(settings.boundaryExpansion === undefined ? {} : { boundaryExpansion: settings.boundaryExpansion }),
    ...(settings.mask ? { mask: settings.mask } : {}),
  };
}

function cloneGraphBounds(bounds: GraphBounds) {
  return {
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    minX: bounds.minX,
    minY: bounds.minY,
  };
}

function cloneBoundsRect(rect: BoundsRect) {
  return {
    height: rect.height,
    width: rect.width,
    x: rect.x,
    y: rect.y,
  };
}

function cloneGraphPoint(point: GraphPoint) {
  return createGraphPoint(point.x, point.y);
}
