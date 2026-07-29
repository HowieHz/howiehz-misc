import type { GraphwarDetectionWorkerStage, GraphwarDetectionWorkerTask } from "../../detection/runtime/protocol";
import type { BoundsRect } from "../types";
import {
  GraphwarWasmAdapterError,
  copyGraphwarWasmUint32Values,
  validateGraphwarWasmEnumValue,
  validateGraphwarWasmFiniteNumber,
  validateGraphwarWasmMemoryRange,
  validateGraphwarWasmU32,
} from "./abi";
import { GraphwarWasmKernelRuntime } from "./runtime";
import {
  createGraphwarWasmSessionController,
  type GraphwarWasmSessionHandle,
  type GraphwarWasmSessionState,
} from "./session";
import { packGraphwarWasmDetectionInput } from "./task-adapter";

const DETECTION_INPUT_BYTE_LENGTH = 40;
const DETECTION_RESULT_BYTE_LENGTH = 64;
const DETECTION_RESULT_COMPLETE = 1;
const DETECTION_RESULT_RUNNING = 2;
const DETECTION_RESULT_FLAG_HAS_EDGE_RECT = 1;
const DETECTION_STAGE_BOUNDS_START = 1;
const DETECTION_STAGE_BOUNDS_END = 2;

const detectionTaskTags = {
  "detect-bounds-only": 1,
  "detect-auto": 2,
  "detect-bounds": 3,
} as const satisfies Record<GraphwarDetectionWorkerTask["type"], number>;

export interface GraphwarWasmDetectionStageEvent {
  phase: "end" | "start";
  stage: GraphwarDetectionWorkerStage;
}

export interface GraphwarWasmDetectionBoundsResult {
  edgeRect?: BoundsRect;
  stageEvents: readonly GraphwarWasmDetectionStageEvent[];
  taskType: "detect-auto" | "detect-bounds-only";
}

export interface GraphwarWasmDetectionRunningResult {
  edgeRect?: BoundsRect;
  stageEvents: readonly GraphwarWasmDetectionStageEvent[];
  taskType: GraphwarDetectionWorkerTask["type"];
}

export type GraphwarWasmDetectionBoundsPhaseState = GraphwarWasmSessionState<GraphwarWasmDetectionBoundsResult>;

type ActiveDetectionCommand = {
  handle: GraphwarWasmSessionHandle;
  mark: number;
  task: GraphwarDetectionWorkerTask;
} & ({ phase: "bounds-pending" } | { phase: "objects-pending" });

interface RawDetectionResult {
  edgeRect?: BoundsRect;
  sessionPointer: number;
  stageEvents: readonly GraphwarWasmDetectionStageEvent[];
  state: typeof DETECTION_RESULT_COMPLETE | typeof DETECTION_RESULT_RUNNING;
  taskType: GraphwarDetectionWorkerTask["type"];
}

/** Owns every detection session and its arena mark for one validated Worker-local WASM instance. */
export function createGraphwarWasmDetectionController(runtime: GraphwarWasmKernelRuntime) {
  const sessions = createGraphwarWasmSessionController(runtime);
  let activeCommand: ActiveDetectionCommand | undefined;

  function begin(options: {
    backendGeneration: number;
    requestId: number;
    task: GraphwarDetectionWorkerTask;
  }): Extract<GraphwarWasmDetectionBoundsPhaseState, { type: "running" }> & GraphwarWasmDetectionRunningResult {
    if (activeCommand) {
      throw new GraphwarWasmAdapterError("invalid-session-state", "Detection runtime already owns an active command");
    }
    const mark = runtime.markArena();
    let handle: GraphwarWasmSessionHandle | undefined;
    try {
      const packed = packGraphwarWasmDetectionInput(runtime, options.task);
      const commandPointer = runtime.reserveArena(DETECTION_INPUT_BYTE_LENGTH, 8);
      new Uint8Array(runtime.buffer, commandPointer, DETECTION_INPUT_BYTE_LENGTH).fill(0);
      const view = new DataView(runtime.buffer, commandPointer, DETECTION_INPUT_BYTE_LENGTH);
      view.setUint32(0, detectionTaskTags[packed.type], true);
      view.setUint32(4, packed.image.width, true);
      view.setUint32(8, packed.image.height, true);
      view.setUint32(12, packed.image.rgba.pointer, true);
      view.setUint32(16, packed.image.rgba.length, true);
      if (packed.type !== "detect-bounds-only") {
        view.setUint32(20, packed.settings.pointer, true);
        view.setUint32(24, packed.settings.length, true);
        if (packed.type === "detect-bounds") {
          view.setUint32(28, packed.edgeRect.pointer, true);
          view.setUint32(32, packed.edgeRect.length, true);
        }
      }
      const outputMinimumPointer = runtime.arenaCursor;
      const resultPointer = runtime.beginDetectionTask(commandPointer, DETECTION_INPUT_BYTE_LENGTH);
      const result = copyGraphwarWasmDetectionResult(
        runtime,
        resultPointer,
        outputMinimumPointer,
        options.task.type,
        options.task.type === "detect-bounds" ? [] : [DETECTION_STAGE_BOUNDS_START],
      );
      if (result.state !== DETECTION_RESULT_RUNNING || result.sessionPointer !== commandPointer) {
        throwDetectionResultError("Detection begin must return its exact running command pointer");
      }
      validateResultEdgeRect(options.task, result.edgeRect);
      handle = sessions.beginSession({
        backendGeneration: options.backendGeneration,
        pointer: result.sessionPointer,
        requestId: options.requestId,
        taskType: "detection",
      }).handle;
      activeCommand = {
        handle,
        mark,
        phase: options.task.type === "detect-bounds" ? "objects-pending" : "bounds-pending",
        task: options.task,
      };
      return {
        ...(result.edgeRect ? { edgeRect: result.edgeRect } : {}),
        handle,
        stageEvents: result.stageEvents,
        taskType: result.taskType,
        type: "running",
      };
    } catch (error) {
      if (handle) {
        sessions.cancelSession(handle);
      }
      runtime.resetArena(mark);
      throw error;
    }
  }

  function resumeBounds(
    handle: GraphwarWasmSessionHandle,
  ):
    | (Extract<GraphwarWasmDetectionBoundsPhaseState, { type: "running" }> & GraphwarWasmDetectionRunningResult)
    | Extract<GraphwarWasmDetectionBoundsPhaseState, { type: "complete" }> {
    const command = requireActiveCommand(handle);
    if (command.phase !== "bounds-pending") {
      throw new GraphwarWasmAdapterError("invalid-session-state", "Detection bounds phase is no longer pending");
    }
    try {
      const sessionPointer = sessions.getSessionPointer(handle);
      const outputMinimumPointer = runtime.arenaCursor;
      const resultPointer = runtime.resumeDetectionTask(sessionPointer);
      const result = copyGraphwarWasmDetectionResult(runtime, resultPointer, outputMinimumPointer, command.task.type, [
        DETECTION_STAGE_BOUNDS_END,
      ]);
      validateResultEdgeRect(command.task, result.edgeRect);
      if (result.state === DETECTION_RESULT_COMPLETE) {
        if (result.sessionPointer !== 0 || result.taskType === "detect-bounds") {
          throwDetectionResultError("Completed detection has inconsistent task or session identity");
        }
        const complete = sessions.completeSession(handle, {
          ...(result.edgeRect ? { edgeRect: result.edgeRect } : {}),
          stageEvents: result.stageEvents,
          taskType: result.taskType,
        });
        activeCommand = undefined;
        runtime.resetArena(command.mark);
        return complete;
      }
      if (result.sessionPointer !== sessionPointer || !result.edgeRect) {
        throwDetectionResultError("Running object detection must retain its exact session and edge rectangle");
      }
      activeCommand = { ...command, phase: "objects-pending" };
      return {
        edgeRect: result.edgeRect,
        handle,
        stageEvents: result.stageEvents,
        taskType: result.taskType,
        type: "running",
      };
    } catch (error) {
      if (activeCommand?.handle === handle) {
        activeCommand = undefined;
        sessions.cancelSession(handle);
        runtime.resetArena(command.mark);
      }
      throw error;
    }
  }

  function cancel(handle: GraphwarWasmSessionHandle): void {
    const command = requireActiveCommand(handle);
    sessions.cancelSession(handle);
    activeCommand = undefined;
    runtime.resetArena(command.mark);
  }

  function requireActiveCommand(handle: GraphwarWasmSessionHandle): ActiveDetectionCommand {
    if (activeCommand?.handle !== handle) {
      throw new GraphwarWasmAdapterError("invalid-session-handle", "detection session handle is not active");
    }
    return activeCommand;
  }

  return { begin, cancel, resumeBounds };
}

/** Validates one raw phase result and copies all values before the next export may grow memory. */
export function copyGraphwarWasmDetectionResult(
  runtime: Pick<GraphwarWasmKernelRuntime, "arenaBase" | "arenaCursor" | "buffer">,
  resultPointer: number,
  outputMinimumPointer: number,
  expectedTaskType: GraphwarDetectionWorkerTask["type"],
  expectedStageTags: readonly number[],
): RawDetectionResult {
  const resultRange = validateGraphwarWasmMemoryRange(
    runtime,
    { length: 1, pointer: resultPointer },
    { alignment: 8, elementByteLength: DETECTION_RESULT_BYTE_LENGTH, minimumPointer: outputMinimumPointer },
  );
  const view = new DataView(resultRange.buffer, resultRange.byteOffset, resultRange.byteLength);
  const state = validateGraphwarWasmEnumValue(
    view.getUint32(0, true),
    [DETECTION_RESULT_COMPLETE, DETECTION_RESULT_RUNNING],
    "detection.state",
  );
  const taskTag = validateGraphwarWasmEnumValue(view.getUint32(4, true), [1, 2, 3], "detection.task");
  if (taskTag !== detectionTaskTags[expectedTaskType]) {
    throwDetectionResultError("Detection result task does not match its command");
  }
  const flags = validateGraphwarWasmU32(view.getUint32(8, true), "detection.flags");
  if ((flags & ~DETECTION_RESULT_FLAG_HAS_EDGE_RECT) !== 0) {
    throwDetectionResultError("Detection result contains unsupported flags");
  }
  if (view.getUint32(24, true) !== 0 || view.getUint32(28, true) !== 0) {
    throwDetectionResultError("Bounds phase cannot expose external work");
  }

  const stageTags = copyGraphwarWasmUint32Values(
    runtime,
    { length: view.getUint32(16, true), pointer: view.getUint32(12, true) },
    outputMinimumPointer,
  );
  if (stageTags.byteLength > 0 && view.getUint32(12, true) + stageTags.byteLength > resultPointer) {
    throwDetectionResultError("Detection stage events overlap or follow their result record");
  }
  if (
    stageTags.length !== expectedStageTags.length ||
    stageTags.some((stageTag, index) => stageTag !== expectedStageTags[index])
  ) {
    throwDetectionResultError("Detection bounds stages are missing or out of order");
  }
  const stageEvents = Array.from(stageTags, (stageTag): GraphwarWasmDetectionStageEvent => {
    const tag = validateGraphwarWasmEnumValue(
      stageTag,
      [DETECTION_STAGE_BOUNDS_START, DETECTION_STAGE_BOUNDS_END],
      "detection.stage",
    );
    return { phase: tag === DETECTION_STAGE_BOUNDS_START ? "start" : "end", stage: "detecting-bounds" };
  });

  const hasEdgeRect = (flags & DETECTION_RESULT_FLAG_HAS_EDGE_RECT) !== 0;
  const rawEdgeRect = {
    height: view.getFloat64(56, true),
    width: view.getFloat64(48, true),
    x: view.getFloat64(32, true),
    y: view.getFloat64(40, true),
  };
  const edgeRect = hasEdgeRect ? validateDetectionEdgeRect(rawEdgeRect) : undefined;
  if (!hasEdgeRect && Object.values(rawEdgeRect).some((value) => !Object.is(value, 0))) {
    throwDetectionResultError("Detection result without bounds must zero its edge record");
  }
  return {
    ...(edgeRect ? { edgeRect } : {}),
    sessionPointer: validateGraphwarWasmU32(view.getUint32(20, true), "detection.sessionPointer"),
    stageEvents,
    state,
    taskType: expectedTaskType,
  };
}

function validateResultEdgeRect(task: GraphwarDetectionWorkerTask, edgeRect: BoundsRect | undefined): void {
  if (!edgeRect) {
    if (task.type === "detect-bounds") {
      throwDetectionResultError("Known-bounds detection must preserve its edge rectangle");
    }
    return;
  }
  if (task.type === "detect-bounds") {
    if (
      !Object.is(edgeRect.x, task.edgeRect.x) ||
      !Object.is(edgeRect.y, task.edgeRect.y) ||
      !Object.is(edgeRect.width, task.edgeRect.width) ||
      !Object.is(edgeRect.height, task.edgeRect.height)
    ) {
      throwDetectionResultError("Known detection bounds changed across the WASM boundary");
    }
    return;
  }
  if (
    !Number.isInteger(edgeRect.x) ||
    !Number.isInteger(edgeRect.y) ||
    !Number.isInteger(edgeRect.width) ||
    !Number.isInteger(edgeRect.height) ||
    edgeRect.x < 0 ||
    edgeRect.y < 0 ||
    edgeRect.x + edgeRect.width > task.imageData.width ||
    edgeRect.y + edgeRect.height > task.imageData.height
  ) {
    throwDetectionResultError("Detected edge rectangle lies outside its source image pixel grid");
  }
}

function validateDetectionEdgeRect(rect: BoundsRect): BoundsRect {
  const x = validateGraphwarWasmFiniteNumber(rect.x, "detection.edgeRect.x");
  const y = validateGraphwarWasmFiniteNumber(rect.y, "detection.edgeRect.y");
  const width = validateGraphwarWasmFiniteNumber(rect.width, "detection.edgeRect.width");
  const height = validateGraphwarWasmFiniteNumber(rect.height, "detection.edgeRect.height");
  if (width <= 0 || height <= 0) {
    throwDetectionResultError("Detection edge rectangle must have positive dimensions");
  }
  return { height, width, x, y };
}

function throwDetectionResultError(message: string): never {
  throw new GraphwarWasmAdapterError("invalid-detection-result", message);
}
