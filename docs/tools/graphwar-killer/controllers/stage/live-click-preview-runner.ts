import { createGraphPoint } from "../../core/types";
import type { BoundsRect, GraphBounds, GraphPoint } from "../../core/types";
import { renderGraphwarLiveClickPreview } from "./live-click-preview-render";
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
  id: number;
  reject: (reason?: unknown) => void;
  resolve: (value: GraphwarLiveClickPreviewRenderResult) => void;
}

/** 创建实时预览 runner；每次新落点会取消旧 Worker 任务，只保留最新结果。 */
export function createGraphwarLiveClickPreviewRunner() {
  let worker: Worker | undefined;
  let nextRequestId = 1;
  let pendingTask: PendingLiveClickPreviewTask | undefined;

  function render(input: GraphwarLiveClickPreviewRenderInput) {
    cancel();
    const activeWorker = ensureWorker();
    if (!activeWorker) {
      return Promise.resolve().then(() => renderGraphwarLiveClickPreview(cloneRenderInput(input)));
    }

    const request: GraphwarLiveClickPreviewWorkerRequest = {
      id: nextRequestId,
      input,
    };
    nextRequestId += 1;
    return new Promise<GraphwarLiveClickPreviewRenderResult>((resolve, reject) => {
      pendingTask = {
        id: request.id,
        reject,
        resolve,
      };
      try {
        activeWorker.postMessage(cloneWorkerRequest(request));
      } catch (error) {
        pendingTask = undefined;
        reject(error);
      }
    });
  }

  function cancel() {
    if (!pendingTask) {
      return;
    }
    pendingTask.reject(new GraphwarLiveClickPreviewCancelledError());
    pendingTask = undefined;
    resetWorker();
  }

  function close() {
    cancel();
    resetWorker();
  }

  function ensureWorker() {
    if (typeof Worker === "undefined") {
      return undefined;
    }
    if (worker) {
      return worker;
    }

    worker = new Worker(new URL("../../workers/live-click-preview/main.worker.ts", import.meta.url), {
      name: "graphwar-live-click-preview",
      type: "module",
    });
    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("messageerror", handleWorkerMessageError);
    worker.addEventListener("error", handleWorkerError);
    return worker;
  }

  function handleWorkerMessage(event: MessageEvent<GraphwarLiveClickPreviewWorkerResponse>) {
    const response = event.data;
    if (!pendingTask || pendingTask.id !== response.id) {
      return;
    }

    const completedTask = pendingTask;
    pendingTask = undefined;
    if (response.type === "error") {
      completedTask.reject(new Error(response.message));
      resetWorker();
      return;
    }
    completedTask.resolve(response.result);
  }

  function handleWorkerMessageError() {
    rejectPendingTask(new Error("Graphwar live click preview worker message could not be deserialized"));
  }

  function handleWorkerError(event: ErrorEvent) {
    rejectPendingTask(event.error instanceof Error ? event.error : new Error(event.message));
  }

  function rejectPendingTask(error: Error) {
    if (!pendingTask) {
      return;
    }
    pendingTask.reject(error);
    pendingTask = undefined;
    resetWorker();
  }

  function resetWorker() {
    if (!worker) {
      return;
    }
    worker.terminate();
    worker = undefined;
  }

  return {
    cancel,
    close,
    render,
  };
}

function cloneWorkerRequest(request: GraphwarLiveClickPreviewWorkerRequest): GraphwarLiveClickPreviewWorkerRequest {
  return {
    id: request.id,
    input: cloneRenderInput(request.input),
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
