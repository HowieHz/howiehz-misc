import type { SoldierMatchCandidate, SoldierTemplateCenterCandidate } from "../../detection/objects";
import type { GraphwarDetectionWorkerStage, GraphwarDetectionWorkerTask } from "../../detection/runtime/protocol";
import { GraphwarWasmFault, type GraphwarWasmSessionIdentity } from "../algorithm-backend";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../game/constants";
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

const DETECTION_INPUT_BYTE_LENGTH = 160;
const DETECTION_RESULT_BYTE_LENGTH = 96;
const DETECTION_CANDIDATE_BYTE_LENGTH = 32;
const DETECTION_MATCH_BYTE_LENGTH = 72;
const DETECTION_SHARD_BYTE_LENGTH = 16;
const DETECTION_TEMPLATE_SHARD_RESULT_BYTE_LENGTH = 16;
const DETECTION_RESULT_COMPLETE = 1;
const DETECTION_RESULT_RUNNING = 2;
const DETECTION_RESULT_FLAG_HAS_EDGE_RECT = 1;
const DETECTION_STAGE_BOUNDS_START = 1;
const DETECTION_STAGE_BOUNDS_END = 2;
const DETECTION_STAGE_CANDIDATES_START = 3;
const DETECTION_STAGE_CANDIDATES_END = 4;
const DETECTION_STAGE_TEMPLATES_START = 5;
const DETECTION_STAGE_TEMPLATES_END = 6;
const DETECTION_STAGE_OBSTACLE_MASK_START = 7;
const DETECTION_STAGE_OBSTACLE_MASK_END = 8;
const DETECTION_STAGE_COMPONENTS_START = 9;
const DETECTION_STAGE_COMPONENTS_END = 10;

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

export interface GraphwarWasmDetectionObjectsResult {
  edgeRect: BoundsRect;
  matches: readonly GraphwarWasmDetectionTemplateMatch[];
  obstacleCount: number;
  obstacleMask: Uint8Array;
  stageEvents: readonly GraphwarWasmDetectionStageEvent[];
  taskType: "detect-auto" | "detect-bounds";
}

export interface GraphwarWasmDetectionCandidate extends SoldierTemplateCenterCandidate {
  candidateIndex: number;
}

export interface GraphwarWasmDetectionTemplateMatch extends SoldierMatchCandidate {
  candidateIndex: number;
}

export interface GraphwarWasmDetectionTemplateShard {
  candidates: readonly GraphwarWasmDetectionCandidate[];
  id: number;
}

export interface GraphwarWasmDetectionTemplateShardResult {
  id: number;
  matches: readonly GraphwarWasmDetectionTemplateMatch[];
  session: GraphwarWasmSessionIdentity;
}

export type GraphwarWasmDetectionBoundsPhaseState = GraphwarWasmSessionState<GraphwarWasmDetectionBoundsResult>;

type ActiveDetectionCommand = {
  handle: GraphwarWasmSessionHandle;
  mark: number;
  sessionDataMinimumPointer: number;
  task: GraphwarDetectionWorkerTask;
  templateNames: readonly string[];
} & (
  | { phase: "bounds-pending" }
  | { phase: "candidates-pending" }
  | {
      candidates: readonly GraphwarWasmDetectionCandidate[];
      phase: "templates-pending";
      shards: readonly GraphwarWasmDetectionTemplateShard[];
    }
  | { matches: readonly GraphwarWasmDetectionTemplateMatch[]; phase: "obstacle-mask-pending" }
  | { matches: readonly GraphwarWasmDetectionTemplateMatch[]; phase: "components-pending" }
);

interface RawDetectionResult {
  candidates: readonly GraphwarWasmDetectionCandidate[];
  edgeRect?: BoundsRect;
  matches: readonly GraphwarWasmDetectionTemplateMatch[];
  obstacleCount: number;
  obstacleMask?: Uint8Array;
  sessionPointer: number;
  shards: readonly { candidateCount: number; candidateStart: number; id: number }[];
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
        view.setUint32(40, packed.templates.profile.pointer, true);
        view.setUint32(44, packed.templates.profile.length, true);
        view.setUint32(48, packed.templates.baseFlags.pointer, true);
        view.setUint32(52, packed.templates.baseFlags.length, true);
        view.setUint32(56, packed.templates.baseGeometry.pointer, true);
        view.setUint32(60, packed.templates.baseGeometry.length, true);
        view.setUint32(64, packed.templates.basePixelRanges.pointer, true);
        view.setUint32(68, packed.templates.basePixelRanges.length, true);
        view.setUint32(72, packed.templates.pixelCoordinates.pointer, true);
        view.setUint32(76, packed.templates.pixelCoordinates.length, true);
        view.setUint32(80, packed.templates.templateRecords.pointer, true);
        view.setUint32(84, packed.templates.templateRecords.length, true);
        view.setUint32(88, packed.templates.signatureColors.pointer, true);
        view.setUint32(92, packed.templates.signatureColors.length, true);
      }
      const sessionDataMinimumPointer = commandPointer + DETECTION_INPUT_BYTE_LENGTH;
      const outputMinimumPointer = runtime.arenaCursor;
      const resultPointer = runtime.beginDetectionTask(commandPointer, DETECTION_INPUT_BYTE_LENGTH);
      const result = copyGraphwarWasmDetectionResult(
        runtime,
        resultPointer,
        outputMinimumPointer,
        sessionDataMinimumPointer,
        options.task.type,
        options.task.type === "detect-bounds" ? [DETECTION_STAGE_CANDIDATES_START] : [DETECTION_STAGE_BOUNDS_START],
        packed.type === "detect-bounds-only" ? [] : packed.templates.templateNames,
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
        phase: options.task.type === "detect-bounds" ? "candidates-pending" : "bounds-pending",
        sessionDataMinimumPointer,
        task: options.task,
        templateNames: packed.type === "detect-bounds-only" ? [] : packed.templates.templateNames,
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
      resetDetectionArenaAfterFault(runtime, mark);
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
      const result = copyGraphwarWasmDetectionResult(
        runtime,
        resultPointer,
        outputMinimumPointer,
        command.sessionDataMinimumPointer,
        command.task.type,
        command.task.type === "detect-auto"
          ? [DETECTION_STAGE_BOUNDS_END, DETECTION_STAGE_CANDIDATES_START]
          : [DETECTION_STAGE_BOUNDS_END],
        command.templateNames,
      );
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
      activeCommand = { ...command, phase: "candidates-pending" };
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
        resetDetectionArenaAfterFault(runtime, command.mark);
      }
      throw error;
    }
  }

  function resumeCandidates(handle: GraphwarWasmSessionHandle) {
    const command = requireActiveCommand(handle);
    if (command.phase !== "candidates-pending") {
      throw new GraphwarWasmAdapterError("invalid-session-state", "Detection candidates phase is no longer pending");
    }
    try {
      const sessionPointer = sessions.getSessionPointer(handle);
      const outputMinimumPointer = runtime.arenaCursor;
      const result = copyGraphwarWasmDetectionResult(
        runtime,
        runtime.resumeDetectionTask(sessionPointer),
        outputMinimumPointer,
        command.sessionDataMinimumPointer,
        command.task.type,
        [DETECTION_STAGE_CANDIDATES_END, DETECTION_STAGE_TEMPLATES_START],
        command.templateNames,
      );
      validateResultEdgeRect(command.task, result.edgeRect);
      if (result.state !== DETECTION_RESULT_RUNNING || result.sessionPointer !== sessionPointer) {
        throwDetectionResultError("Candidate collection must retain its exact detection session");
      }
      const shards = result.shards.map((shard) => ({
        candidates: result.candidates.slice(shard.candidateStart, shard.candidateStart + shard.candidateCount),
        id: shard.id,
      }));
      activeCommand = { ...command, candidates: result.candidates, phase: "templates-pending", shards };
      return {
        candidates: result.candidates,
        edgeRect: result.edgeRect,
        handle,
        shards,
        stageEvents: result.stageEvents,
        taskType: result.taskType,
        type: shards.length ? ("waiting-template-shards" as const) : ("running" as const),
      };
    } catch (error) {
      discardActiveCommandAfterFault(command, handle);
      throw error;
    }
  }

  function resumeTemplates(
    handle: GraphwarWasmSessionHandle,
    shardResults: readonly GraphwarWasmDetectionTemplateShardResult[] = [],
  ) {
    const command = requireActiveCommand(handle);
    if (command.phase !== "templates-pending") {
      throw new GraphwarWasmAdapterError("invalid-session-state", "Detection template phase is no longer pending");
    }
    for (const shardResult of shardResults) {
      sessions.validateSessionIdentity(handle, shardResult.session);
    }
    const orderedMatches = validateAndOrderShardResults(command, shardResults);
    return resumeTemplatesWithMatches(command, handle, orderedMatches);
  }

  /** Ordinary child failure discards every shard and asks the main WASM instance to score all candidates. */
  function resumeTemplatesSerial(handle: GraphwarWasmSessionHandle) {
    const command = requireActiveCommand(handle);
    if (command.phase !== "templates-pending") {
      throw new GraphwarWasmAdapterError("invalid-session-state", "Detection template phase is no longer pending");
    }
    return resumeTemplatesWithMatches(command, handle, []);
  }

  function resumeTemplatesWithMatches(
    command: Extract<ActiveDetectionCommand, { phase: "templates-pending" }>,
    handle: GraphwarWasmSessionHandle,
    orderedMatches: readonly GraphwarWasmDetectionTemplateMatch[],
  ) {
    try {
      const sessionPointer = sessions.getSessionPointer(handle);
      const packedMatches = orderedMatches.length ? packTemplateMatches(runtime, orderedMatches, command) : undefined;
      const outputMinimumPointer = runtime.arenaCursor;
      const result = copyGraphwarWasmDetectionResult(
        runtime,
        runtime.resumeDetectionTask(sessionPointer, packedMatches?.pointer, packedMatches?.length),
        outputMinimumPointer,
        command.sessionDataMinimumPointer,
        command.task.type,
        [DETECTION_STAGE_TEMPLATES_END, DETECTION_STAGE_OBSTACLE_MASK_START],
        command.templateNames,
      );
      validateResultEdgeRect(command.task, result.edgeRect);
      if (
        result.state !== DETECTION_RESULT_RUNNING ||
        result.sessionPointer !== sessionPointer ||
        result.shards.length !== 0 ||
        result.matches.length > command.candidates.length
      ) {
        throwDetectionResultError("Template scoring returned an inconsistent retained detection session");
      }
      if (result.obstacleMask || result.obstacleCount !== 0) {
        throwDetectionResultError("Template scoring returned obstacle output before its phase");
      }
      activeCommand = { ...command, matches: result.matches, phase: "obstacle-mask-pending" };
      return {
        edgeRect: result.edgeRect,
        handle,
        matches: result.matches,
        stageEvents: result.stageEvents,
        taskType: result.taskType,
        type: "running" as const,
      };
    } catch (error) {
      discardActiveCommandAfterFault(command, handle);
      throw error;
    }
  }

  function resumeObstacleMask(handle: GraphwarWasmSessionHandle) {
    const command = requireActiveCommand(handle);
    if (command.phase !== "obstacle-mask-pending") {
      throw new GraphwarWasmAdapterError("invalid-session-state", "Detection obstacle-mask phase is no longer pending");
    }
    try {
      const sessionPointer = sessions.getSessionPointer(handle);
      const outputMinimumPointer = runtime.arenaCursor;
      const result = copyGraphwarWasmDetectionResult(
        runtime,
        runtime.resumeDetectionTask(sessionPointer),
        outputMinimumPointer,
        command.sessionDataMinimumPointer,
        command.task.type,
        [DETECTION_STAGE_OBSTACLE_MASK_END, DETECTION_STAGE_COMPONENTS_START],
        command.templateNames,
      );
      validateResultEdgeRect(command.task, result.edgeRect);
      if (
        result.state !== DETECTION_RESULT_RUNNING ||
        result.sessionPointer !== sessionPointer ||
        result.obstacleMask ||
        result.obstacleCount !== 0
      ) {
        throwDetectionResultError("Obstacle source-mask phase returned an inconsistent retained session");
      }
      activeCommand = { ...command, phase: "components-pending" };
      return {
        edgeRect: result.edgeRect,
        handle,
        matches: command.matches,
        stageEvents: result.stageEvents,
        taskType: result.taskType,
        type: "running" as const,
      };
    } catch (error) {
      discardActiveCommandAfterFault(command, handle);
      throw error;
    }
  }

  function resumeObstacleComponents(
    handle: GraphwarWasmSessionHandle,
  ): Extract<GraphwarWasmSessionState<GraphwarWasmDetectionObjectsResult>, { type: "complete" }> {
    const command = requireActiveCommand(handle);
    if (command.phase !== "components-pending") {
      throw new GraphwarWasmAdapterError("invalid-session-state", "Detection component phase is no longer pending");
    }
    try {
      const sessionPointer = sessions.getSessionPointer(handle);
      const outputMinimumPointer = runtime.arenaCursor;
      const result = copyGraphwarWasmDetectionResult(
        runtime,
        runtime.resumeDetectionTask(sessionPointer),
        outputMinimumPointer,
        command.sessionDataMinimumPointer,
        command.task.type,
        [DETECTION_STAGE_COMPONENTS_END],
        command.templateNames,
      );
      validateResultEdgeRect(command.task, result.edgeRect);
      if (
        result.state !== DETECTION_RESULT_COMPLETE ||
        result.sessionPointer !== 0 ||
        !result.edgeRect ||
        !result.obstacleMask ||
        result.taskType === "detect-bounds-only" ||
        result.matches.length !== command.matches.length
      ) {
        throwDetectionResultError("Completed obstacle filtering returned an inconsistent detection result");
      }
      for (let index = 0; index < result.matches.length; index += 1) {
        const match = result.matches[index];
        const expected = command.matches[index];
        if (
          match.candidateIndex !== expected.candidateIndex ||
          !Object.is(match.sourceCenterX, expected.sourceCenterX) ||
          !Object.is(match.sourceCenterY, expected.sourceCenterY) ||
          match.isMirrored !== expected.isMirrored ||
          match.votes !== expected.votes ||
          match.templateName !== expected.templateName ||
          !Object.is(match.score, expected.score) ||
          !Object.is(match.fixedScore, expected.fixedScore) ||
          !Object.is(match.foregroundScore, expected.foregroundScore) ||
          !Object.is(match.playerScore, expected.playerScore) ||
          !Object.is(match.signatureScore, expected.signatureScore)
        ) {
          throwDetectionResultError("Completed obstacle filtering changed its retained template matches");
        }
      }
      const complete = sessions.completeSession(handle, {
        edgeRect: result.edgeRect,
        matches: result.matches,
        obstacleCount: result.obstacleCount,
        obstacleMask: result.obstacleMask,
        stageEvents: result.stageEvents,
        taskType: result.taskType,
      });
      activeCommand = undefined;
      runtime.resetArena(command.mark);
      return complete;
    } catch (error) {
      discardActiveCommandAfterFault(command, handle);
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

  function discardActiveCommandAfterFault(command: ActiveDetectionCommand, handle: GraphwarWasmSessionHandle) {
    if (activeCommand?.handle === handle) {
      activeCommand = undefined;
      sessions.cancelSession(handle);
      resetDetectionArenaAfterFault(runtime, command.mark);
    }
  }

  return {
    begin,
    cancel,
    resumeBounds,
    resumeCandidates,
    resumeObstacleComponents,
    resumeObstacleMask,
    resumeTemplates,
    resumeTemplatesSerial,
  };
}

/** Runs one template Worker shard entirely in its Worker-local WASM instance. */
export function runGraphwarWasmDetectionTemplateShard(
  runtime: GraphwarWasmKernelRuntime,
  input: {
    candidates: readonly GraphwarWasmDetectionCandidate[];
    edgeRect: BoundsRect;
    imageData: ImageData;
  },
) {
  if (input.candidates.length === 0) {
    throw new GraphwarWasmAdapterError("invalid-work-batch", "Detection template shard cannot be empty");
  }
  const mark = runtime.markArena();
  try {
    const task = {
      edgeRect: input.edgeRect,
      imageData: input.imageData,
      soldierSettings: { candidateTopRatio: 1, maximumSoldierCount: 1, templateMatchingWorkerCount: 1 },
      thresholds: { minArea: 0 },
      type: "detect-bounds",
    } satisfies GraphwarDetectionWorkerTask;
    const packed = packGraphwarWasmDetectionInput(runtime, task);
    if (packed.type !== "detect-bounds") {
      throw new GraphwarWasmAdapterError("invalid-session-state", "Template shard did not produce known bounds input");
    }
    const candidatePointer = runtime.reserveArena(input.candidates.length * DETECTION_CANDIDATE_BYTE_LENGTH, 8);
    const candidateView = new DataView(
      runtime.buffer,
      candidatePointer,
      input.candidates.length * DETECTION_CANDIDATE_BYTE_LENGTH,
    );
    for (let index = 0; index < input.candidates.length; index += 1) {
      const candidate = input.candidates[index];
      const offset = index * DETECTION_CANDIDATE_BYTE_LENGTH;
      candidateView.setFloat64(offset, validateGraphwarWasmFiniteNumber(candidate.x, "candidate.x"), true);
      candidateView.setFloat64(offset + 8, validateGraphwarWasmFiniteNumber(candidate.y, "candidate.y"), true);
      const votes = validateGraphwarWasmU32(candidate.votes, "candidate.votes");
      if (votes === 0) {
        throw new GraphwarWasmAdapterError("invalid-work-batch", "Detection template candidate votes must be positive");
      }
      candidateView.setUint32(offset + 16, votes, true);
      candidateView.setUint32(offset + 20, candidate.isMirrored ? 1 : 0, true);
      candidateView.setUint32(offset + 24, validateGraphwarWasmU32(candidate.candidateIndex, "candidate.index"), true);
      candidateView.setUint32(offset + 28, 0, true);
    }
    const commandPointer = runtime.reserveArena(DETECTION_INPUT_BYTE_LENGTH, 8);
    new Uint8Array(runtime.buffer, commandPointer, DETECTION_INPUT_BYTE_LENGTH).fill(0);
    const view = new DataView(runtime.buffer, commandPointer, DETECTION_INPUT_BYTE_LENGTH);
    view.setUint32(0, detectionTaskTags[packed.type], true);
    view.setUint32(4, packed.image.width, true);
    view.setUint32(8, packed.image.height, true);
    view.setUint32(12, packed.image.rgba.pointer, true);
    view.setUint32(16, packed.image.rgba.length, true);
    view.setUint32(20, packed.settings.pointer, true);
    view.setUint32(24, packed.settings.length, true);
    view.setUint32(28, packed.edgeRect.pointer, true);
    view.setUint32(32, packed.edgeRect.length, true);
    view.setUint32(40, packed.templates.profile.pointer, true);
    view.setUint32(44, packed.templates.profile.length, true);
    view.setUint32(48, packed.templates.baseFlags.pointer, true);
    view.setUint32(52, packed.templates.baseFlags.length, true);
    view.setUint32(56, packed.templates.baseGeometry.pointer, true);
    view.setUint32(60, packed.templates.baseGeometry.length, true);
    view.setUint32(64, packed.templates.basePixelRanges.pointer, true);
    view.setUint32(68, packed.templates.basePixelRanges.length, true);
    view.setUint32(72, packed.templates.pixelCoordinates.pointer, true);
    view.setUint32(76, packed.templates.pixelCoordinates.length, true);
    view.setUint32(80, packed.templates.templateRecords.pointer, true);
    view.setUint32(84, packed.templates.templateRecords.length, true);
    view.setUint32(88, packed.templates.signatureColors.pointer, true);
    view.setUint32(92, packed.templates.signatureColors.length, true);
    view.setFloat64(96, input.edgeRect.x, true);
    view.setFloat64(104, input.edgeRect.y, true);
    view.setFloat64(112, input.edgeRect.width, true);
    view.setFloat64(120, input.edgeRect.height, true);
    view.setUint32(128, candidatePointer, true);
    view.setUint32(132, input.candidates.length, true);
    const outputMinimumPointer = runtime.arenaCursor;
    const resultPointer = runtime.runDetectionTemplateShard(commandPointer, DETECTION_INPUT_BYTE_LENGTH);
    try {
      const resultRange = validateGraphwarWasmMemoryRange(
        runtime,
        { length: 1, pointer: resultPointer },
        {
          alignment: 8,
          elementByteLength: DETECTION_TEMPLATE_SHARD_RESULT_BYTE_LENGTH,
          minimumPointer: outputMinimumPointer,
        },
      );
      const resultView = new DataView(resultRange.buffer, resultRange.byteOffset, resultRange.byteLength);
      if (resultView.getUint32(8, true) !== 0 || resultView.getUint32(12, true) !== 0) {
        throwDetectionResultError("Detection template shard result has nonzero reserved fields");
      }
      const matches = copyDetectionMatches(
        runtime,
        resultView.getUint32(0, true),
        resultView.getUint32(4, true),
        outputMinimumPointer,
        resultPointer,
        packed.templates.templateNames,
      );
      if (matches.length !== input.candidates.length) {
        throwDetectionResultError("Detection template shard did not score every candidate");
      }
      for (let index = 0; index < matches.length; index += 1) {
        const match = matches[index];
        const candidate = input.candidates[index];
        if (
          match.candidateIndex !== candidate.candidateIndex ||
          !Object.is(match.sourceCenterX, candidate.x) ||
          !Object.is(match.sourceCenterY, candidate.y) ||
          match.isMirrored !== candidate.isMirrored ||
          match.votes !== candidate.votes
        ) {
          throwDetectionResultError("Detection template shard changed candidate identity");
        }
      }
      return matches;
    } catch (error) {
      if (error instanceof GraphwarWasmAdapterError) {
        throw new GraphwarWasmFault("output", error.message);
      }
      throw error;
    }
  } finally {
    runtime.resetArena(mark);
  }
}

function validateAndOrderShardResults(
  command: Extract<ActiveDetectionCommand, { phase: "templates-pending" }>,
  shardResults: readonly GraphwarWasmDetectionTemplateShardResult[],
) {
  if (command.shards.length === 0) {
    if (shardResults.length !== 0) {
      throw new GraphwarWasmAdapterError("unexpected-work-id", "Serial detection cannot consume template shards");
    }
    return [];
  }
  if (shardResults.length !== command.shards.length) {
    throw new GraphwarWasmAdapterError("missing-work-id", "Detection template shard batch is incomplete");
  }
  const byId = new Map<number, GraphwarWasmDetectionTemplateShardResult>();
  for (const result of shardResults) {
    if (byId.has(result.id)) {
      throw new GraphwarWasmAdapterError("duplicate-work-id", `Detection template shard ${result.id} is duplicated`);
    }
    byId.set(result.id, result);
  }
  const orderedMatches: GraphwarWasmDetectionTemplateMatch[] = [];
  for (const shard of command.shards) {
    const result = byId.get(shard.id);
    if (!result) {
      throw new GraphwarWasmAdapterError("missing-work-id", `Detection template shard ${shard.id} is missing`);
    }
    if (result.matches.length !== shard.candidates.length) {
      throw new GraphwarWasmAdapterError(
        "invalid-work-batch",
        `Detection template shard ${shard.id} has the wrong length`,
      );
    }
    for (let index = 0; index < result.matches.length; index += 1) {
      const match = result.matches[index];
      const candidate = shard.candidates[index];
      if (match.candidateIndex !== candidate.candidateIndex) {
        throw new GraphwarWasmAdapterError("invalid-work-batch", "Detection template match changed candidate identity");
      }
      orderedMatches.push(match);
    }
    byId.delete(shard.id);
  }
  if (byId.size) {
    throw new GraphwarWasmAdapterError("unexpected-work-id", "Detection template result belongs to another batch");
  }
  return orderedMatches;
}

function packTemplateMatches(
  runtime: GraphwarWasmKernelRuntime,
  matches: readonly GraphwarWasmDetectionTemplateMatch[],
  command: Extract<ActiveDetectionCommand, { phase: "templates-pending" }>,
) {
  const pointer = runtime.reserveArena(matches.length * DETECTION_MATCH_BYTE_LENGTH, 8);
  const view = new DataView(runtime.buffer, pointer, matches.length * DETECTION_MATCH_BYTE_LENGTH);
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const candidate = command.candidates[index];
    if (
      match.candidateIndex !== index ||
      !Object.is(match.sourceCenterX, candidate.x) ||
      !Object.is(match.sourceCenterY, candidate.y) ||
      match.isMirrored !== candidate.isMirrored ||
      match.votes !== candidate.votes
    ) {
      throw new GraphwarWasmAdapterError("invalid-work-batch", "Detection template match does not match its candidate");
    }
    const templateNameIndex = command.templateNames.indexOf(match.templateName);
    if (templateNameIndex < 0) {
      throw new GraphwarWasmAdapterError("invalid-work-batch", "Detection template match uses an unknown template");
    }
    const offset = index * DETECTION_MATCH_BYTE_LENGTH;
    view.setFloat64(offset, validateGraphwarWasmFiniteNumber(match.sourceCenterX, "match.sourceCenterX"), true);
    view.setFloat64(offset + 8, validateGraphwarWasmFiniteNumber(match.sourceCenterY, "match.sourceCenterY"), true);
    view.setFloat64(offset + 16, validateDetectionScore(match.score, "score"), true);
    view.setFloat64(offset + 24, validateDetectionScore(match.fixedScore, "fixedScore"), true);
    view.setFloat64(offset + 32, validateDetectionScore(match.foregroundScore, "foregroundScore"), true);
    view.setFloat64(offset + 40, validateDetectionScore(match.playerScore, "playerScore"), true);
    view.setFloat64(offset + 48, validateDetectionScore(match.signatureScore, "signatureScore"), true);
    view.setUint32(offset + 56, validateGraphwarWasmU32(match.votes, "match.votes"), true);
    view.setUint32(offset + 60, match.isMirrored ? 1 : 0, true);
    view.setUint32(offset + 64, templateNameIndex, true);
    view.setUint32(offset + 68, match.candidateIndex, true);
  }
  return { length: matches.length, pointer };
}

/** Validates one raw phase result and copies all values before the next export may grow memory. */
export function copyGraphwarWasmDetectionResult(
  runtime: Pick<GraphwarWasmKernelRuntime, "arenaBase" | "arenaCursor" | "buffer">,
  resultPointer: number,
  outputMinimumPointer: number,
  sessionDataMinimumPointer: number,
  expectedTaskType: GraphwarDetectionWorkerTask["type"],
  expectedStageTags: readonly number[],
  templateNames: readonly string[],
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
  if (view.getUint32(92, true) !== 0) {
    throwDetectionResultError("Detection result has nonzero reserved fields");
  }
  const stageTags = copyGraphwarWasmUint32Values(
    runtime,
    { length: view.getUint32(16, true), pointer: view.getUint32(12, true) },
    outputMinimumPointer,
  );
  if (stageTags.byteLength > 0 && view.getUint32(12, true) + stageTags.byteLength > resultPointer) {
    throwDetectionResultError("Detection stage events overlap or follow their result record");
  }
  const hasExpectedStages =
    stageTags.length === expectedStageTags.length &&
    stageTags.every((stageTag, index) => stageTag === expectedStageTags[index]);
  const isNoBoundsCompletion =
    state === DETECTION_RESULT_COMPLETE &&
    (flags & DETECTION_RESULT_FLAG_HAS_EDGE_RECT) === 0 &&
    expectedStageTags.length === 2 &&
    expectedStageTags[0] === DETECTION_STAGE_BOUNDS_END &&
    stageTags.length === 1 &&
    stageTags[0] === DETECTION_STAGE_BOUNDS_END;
  if (!hasExpectedStages && !isNoBoundsCompletion) {
    throwDetectionResultError("Detection bounds stages are missing or out of order");
  }
  const stageEvents = Array.from(stageTags, (stageTag): GraphwarWasmDetectionStageEvent => {
    const tag = validateGraphwarWasmEnumValue(
      stageTag,
      [
        DETECTION_STAGE_BOUNDS_START,
        DETECTION_STAGE_BOUNDS_END,
        DETECTION_STAGE_CANDIDATES_START,
        DETECTION_STAGE_CANDIDATES_END,
        DETECTION_STAGE_TEMPLATES_START,
        DETECTION_STAGE_TEMPLATES_END,
        DETECTION_STAGE_OBSTACLE_MASK_START,
        DETECTION_STAGE_OBSTACLE_MASK_END,
        DETECTION_STAGE_COMPONENTS_START,
        DETECTION_STAGE_COMPONENTS_END,
      ],
      "detection.stage",
    );
    if (tag === DETECTION_STAGE_BOUNDS_START || tag === DETECTION_STAGE_BOUNDS_END) {
      return { phase: tag === DETECTION_STAGE_BOUNDS_START ? "start" : "end", stage: "detecting-bounds" };
    }
    if (tag === DETECTION_STAGE_CANDIDATES_START || tag === DETECTION_STAGE_CANDIDATES_END) {
      return {
        phase: tag === DETECTION_STAGE_CANDIDATES_START ? "start" : "end",
        stage: "collecting-soldier-candidates",
      };
    }
    if (tag === DETECTION_STAGE_TEMPLATES_START || tag === DETECTION_STAGE_TEMPLATES_END) {
      return {
        phase: tag === DETECTION_STAGE_TEMPLATES_START ? "start" : "end",
        stage: "matching-soldier-templates",
      };
    }
    if (tag === DETECTION_STAGE_OBSTACLE_MASK_START || tag === DETECTION_STAGE_OBSTACLE_MASK_END) {
      return {
        phase: tag === DETECTION_STAGE_OBSTACLE_MASK_START ? "start" : "end",
        stage: "building-obstacle-mask",
      };
    }
    return {
      phase: tag === DETECTION_STAGE_COMPONENTS_START ? "start" : "end",
      stage: "filtering-obstacle-components",
    };
  });

  const candidates = copyDetectionCandidates(
    runtime,
    view.getUint32(64, true),
    view.getUint32(68, true),
    sessionDataMinimumPointer,
    resultPointer,
  );
  const shards = copyDetectionShards(
    runtime,
    view.getUint32(24, true),
    view.getUint32(28, true),
    outputMinimumPointer,
    resultPointer,
    candidates.length,
  );
  const matches = copyDetectionMatches(
    runtime,
    view.getUint32(72, true),
    view.getUint32(76, true),
    sessionDataMinimumPointer,
    resultPointer,
    templateNames,
  );
  const maskRange = validateGraphwarWasmMemoryRange(
    runtime,
    { length: view.getUint32(84, true), pointer: view.getUint32(80, true) },
    { alignment: 1, elementByteLength: 1, minimumPointer: sessionDataMinimumPointer },
  );
  if (maskRange.byteLength > 0 && maskRange.byteOffset + maskRange.byteLength > resultPointer) {
    throwDetectionResultError("Detection obstacle mask overlaps or follows its result record");
  }
  const obstacleMask = new Uint8Array(maskRange.buffer, maskRange.byteOffset, maskRange.elementLength).slice();
  let solidPixelCount = 0;
  for (const value of obstacleMask) {
    if (value !== 0 && value !== 1) {
      throwDetectionResultError("Detection obstacle mask contains a non-binary value");
    }
    solidPixelCount += value;
  }
  const obstacleCount = validateGraphwarWasmU32(view.getUint32(88, true), "detection.obstacleCount");
  if (
    (obstacleMask.length !== 0 && obstacleMask.length !== GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT) ||
    (obstacleMask.length === 0 && obstacleCount !== 0) ||
    (solidPixelCount === 0) !== (obstacleCount === 0) ||
    obstacleCount > solidPixelCount
  ) {
    throwDetectionResultError("Detection obstacle mask and component count form a half-state");
  }
  assertDetectionOutputRangesAreDisjoint([
    {
      byteLength: view.getUint32(16, true) * Uint32Array.BYTES_PER_ELEMENT,
      label: "stages",
      pointer: view.getUint32(12, true),
    },
    {
      byteLength: view.getUint32(68, true) * DETECTION_CANDIDATE_BYTE_LENGTH,
      label: "candidates",
      pointer: view.getUint32(64, true),
    },
    {
      byteLength: view.getUint32(28, true) * DETECTION_SHARD_BYTE_LENGTH,
      label: "shards",
      pointer: view.getUint32(24, true),
    },
    {
      byteLength: view.getUint32(76, true) * DETECTION_MATCH_BYTE_LENGTH,
      label: "matches",
      pointer: view.getUint32(72, true),
    },
    { byteLength: view.getUint32(84, true), label: "mask", pointer: view.getUint32(80, true) },
  ]);

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
    candidates,
    ...(edgeRect ? { edgeRect } : {}),
    matches,
    obstacleCount,
    ...(obstacleMask.length ? { obstacleMask } : {}),
    sessionPointer: validateGraphwarWasmU32(view.getUint32(20, true), "detection.sessionPointer"),
    stageEvents,
    state,
    shards,
    taskType: expectedTaskType,
  };
}

function assertDetectionOutputRangesAreDisjoint(
  ranges: readonly { byteLength: number; label: string; pointer: number }[],
): void {
  const populatedRanges = ranges.filter((range) => range.byteLength > 0);
  for (let leftIndex = 0; leftIndex < populatedRanges.length; leftIndex += 1) {
    const left = populatedRanges[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < populatedRanges.length; rightIndex += 1) {
      const right = populatedRanges[rightIndex];
      if (left.pointer < right.pointer + right.byteLength && right.pointer < left.pointer + left.byteLength) {
        throwDetectionResultError(`Detection ${left.label} and ${right.label} ranges overlap`);
      }
    }
  }
}

function copyDetectionCandidates(
  runtime: Pick<GraphwarWasmKernelRuntime, "arenaBase" | "arenaCursor" | "buffer">,
  pointer: number,
  count: number,
  minimumPointer: number,
  resultPointer: number,
): GraphwarWasmDetectionCandidate[] {
  const range = validateGraphwarWasmMemoryRange(
    runtime,
    { length: count, pointer },
    { alignment: 8, elementByteLength: DETECTION_CANDIDATE_BYTE_LENGTH, minimumPointer },
  );
  if (range.byteLength && range.byteOffset + range.byteLength > resultPointer) {
    throwDetectionResultError("Detection candidates overlap or follow their result record");
  }
  const candidates: GraphwarWasmDetectionCandidate[] = [];
  for (let index = 0; index < range.elementLength; index += 1) {
    const view = new DataView(
      range.buffer,
      range.byteOffset + index * DETECTION_CANDIDATE_BYTE_LENGTH,
      DETECTION_CANDIDATE_BYTE_LENGTH,
    );
    const candidateIndex = validateGraphwarWasmU32(view.getUint32(24, true), "detection.candidateIndex");
    const reserved = validateGraphwarWasmU32(view.getUint32(28, true), "detection.candidateReserved");
    if (candidateIndex !== index || reserved !== 0) {
      throwDetectionResultError("Detection candidates are not in canonical stable order");
    }
    const mirrored = validateGraphwarWasmEnumValue(view.getUint32(20, true), [0, 1], "detection.candidateMirrored");
    const votes = validateGraphwarWasmU32(view.getUint32(16, true), "detection.candidateVotes");
    if (votes === 0) {
      throwDetectionResultError("Detection candidate votes must be positive");
    }
    candidates.push({
      candidateIndex,
      isMirrored: mirrored === 1,
      votes,
      x: validateGraphwarWasmFiniteNumber(view.getFloat64(0, true), "detection.candidateX"),
      y: validateGraphwarWasmFiniteNumber(view.getFloat64(8, true), "detection.candidateY"),
    });
  }
  return candidates;
}

function copyDetectionShards(
  runtime: Pick<GraphwarWasmKernelRuntime, "arenaBase" | "arenaCursor" | "buffer">,
  pointer: number,
  count: number,
  minimumPointer: number,
  resultPointer: number,
  candidateCount: number,
) {
  const range = validateGraphwarWasmMemoryRange(
    runtime,
    { length: count, pointer },
    { alignment: 4, elementByteLength: DETECTION_SHARD_BYTE_LENGTH, minimumPointer },
  );
  if (range.byteLength && range.byteOffset + range.byteLength > resultPointer) {
    throwDetectionResultError("Detection shard descriptors overlap or follow their result record");
  }
  const shards: { candidateCount: number; candidateStart: number; id: number }[] = [];
  let nextCandidateStart = 0;
  for (let index = 0; index < range.elementLength; index += 1) {
    const view = new DataView(
      range.buffer,
      range.byteOffset + index * DETECTION_SHARD_BYTE_LENGTH,
      DETECTION_SHARD_BYTE_LENGTH,
    );
    const id = validateGraphwarWasmU32(view.getUint32(0, true), "detection.shardId");
    const candidateStart = validateGraphwarWasmU32(view.getUint32(4, true), "detection.shardCandidateStart");
    const shardCandidateCount = validateGraphwarWasmU32(view.getUint32(8, true), "detection.shardCandidateCount");
    if (
      id !== index + 1 ||
      candidateStart !== nextCandidateStart ||
      shardCandidateCount === 0 ||
      view.getUint32(12, true) !== 0
    ) {
      throwDetectionResultError("Detection shards do not form a canonical contiguous batch");
    }
    nextCandidateStart += shardCandidateCount;
    if (nextCandidateStart > candidateCount) {
      throwDetectionResultError("Detection shard candidate range is out of bounds");
    }
    shards.push({ candidateCount: shardCandidateCount, candidateStart, id });
  }
  if (shards.length && nextCandidateStart !== candidateCount) {
    throwDetectionResultError("Detection shards do not cover every candidate");
  }
  return shards;
}

function copyDetectionMatches(
  runtime: Pick<GraphwarWasmKernelRuntime, "arenaBase" | "arenaCursor" | "buffer">,
  pointer: number,
  count: number,
  minimumPointer: number,
  resultPointer: number,
  templateNames: readonly string[],
): GraphwarWasmDetectionTemplateMatch[] {
  const range = validateGraphwarWasmMemoryRange(
    runtime,
    { length: count, pointer },
    { alignment: 8, elementByteLength: DETECTION_MATCH_BYTE_LENGTH, minimumPointer },
  );
  if (range.byteLength && range.byteOffset + range.byteLength > resultPointer) {
    throwDetectionResultError("Detection matches overlap or follow their result record");
  }
  const matches: GraphwarWasmDetectionTemplateMatch[] = [];
  for (let index = 0; index < range.elementLength; index += 1) {
    const view = new DataView(
      range.buffer,
      range.byteOffset + index * DETECTION_MATCH_BYTE_LENGTH,
      DETECTION_MATCH_BYTE_LENGTH,
    );
    const nameIndex = validateGraphwarWasmU32(view.getUint32(64, true), "detection.matchNameIndex");
    const templateName = templateNames[nameIndex];
    if (templateName === undefined) {
      throwDetectionResultError("Detection match references an unknown template name");
    }
    const match = {
      candidateIndex: validateGraphwarWasmU32(view.getUint32(68, true), "detection.matchCandidateIndex"),
      fixedScore: validateDetectionScore(view.getFloat64(24, true), "fixedScore"),
      foregroundScore: validateDetectionScore(view.getFloat64(32, true), "foregroundScore"),
      isMirrored: validateGraphwarWasmEnumValue(view.getUint32(60, true), [0, 1], "detection.matchMirrored") === 1,
      playerScore: validateDetectionScore(view.getFloat64(40, true), "playerScore"),
      score: validateDetectionScore(view.getFloat64(16, true), "score"),
      signatureScore: validateDetectionScore(view.getFloat64(48, true), "signatureScore"),
      sourceCenterX: validateGraphwarWasmFiniteNumber(view.getFloat64(0, true), "detection.matchX"),
      sourceCenterY: validateGraphwarWasmFiniteNumber(view.getFloat64(8, true), "detection.matchY"),
      templateName,
      votes: validateGraphwarWasmU32(view.getUint32(56, true), "detection.matchVotes"),
    } satisfies GraphwarWasmDetectionTemplateMatch;
    if (match.votes === 0) {
      throwDetectionResultError("Detection match votes must be positive");
    }
    matches.push(match);
  }
  return matches;
}

function validateDetectionScore(value: unknown, fieldName: string) {
  const score = validateGraphwarWasmFiniteNumber(value, `detection.${fieldName}`);
  if (score < 0 || score > 1) {
    throwDetectionResultError(`Detection ${fieldName} lies outside 0..1`);
  }
  return score;
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

/** The original command fault stays authoritative; a failed cleanup only confirms that this instance must be discarded. */
function resetDetectionArenaAfterFault(runtime: GraphwarWasmKernelRuntime, mark: number): void {
  try {
    runtime.resetArenaAfterFault(mark);
  } catch {
    // The page-level fuse destroys a faulted instance, so cleanup cannot replace the diagnostic that caused it.
  }
}
