import {
  GraphwarWasmAdapterError,
  copyGraphwarWasmFloat64Values,
  copyGraphwarWasmUint32Values,
  validateGraphwarWasmEnumValue,
  validateGraphwarWasmFiniteNumber,
  validateGraphwarWasmMemoryRange,
  validateGraphwarWasmU32,
  writeGraphwarWasmFloat64Values,
  writeGraphwarWasmUint32Values,
  type GraphwarWasmMemorySource,
} from "./abi";
import type { GraphwarWasmKernelRuntime } from "./runtime";
import type { GraphwarWasmPoint } from "./task-adapter";

/** Versioned flat records shared by the AssemblyScript composition exports. */
export const graphwarWasmCompositionLayout = {
  oneClickEdgeJobByteLength: 48,
  oneClickEdgeResultByteLength: 28,
  oneClickInputByteLength: 64,
  oneClickResultByteLength: 52,
  oneClickResumeByteLength: 16,
  oneClickSessionByteLength: 104,
  smartInputByteLength: 56,
  smartResultByteLength: 32,
} as const;

const smartInputMagic = 0x534d_4152;
const smartInputVersion = 1;
const smartInputDeleteOptimizationFlag = 1;
const smartResultMagic = 0x534d_5253;
const oneClickInputMagic = 0x4f_434c_52;
const oneClickInputVersion = 1;
const oneClickDeleteOptimizationFlag = 1;
const oneClickStepStatefulFlag = 2;
const oneClickTargetOrderDescendingFlag = 4;
const oneClickResultMagic = 0x4f_4352_53;
const oneClickSessionMagic = 0x4f_4353_53;
const oneClickSessionWaitingPhase = 1;
const oneClickEdgeStartSentinel = 0xffff_ffff;

const smartInput = {
  flags: 8,
  pointsX: 12,
  pointsY: 16,
  pointCount: 20,
  sourcePointCount: 24,
  targetX: 28,
  targetY: 36,
  targetRadius: 44,
  routeContext: 52,
} as const;

const smartResult = {
  magic: 0,
  status: 4,
  pointsX: 8,
  pointsY: 12,
  pointCount: 16,
  removedPointCount: 20,
  validated: 24,
} as const;

const oneClickInput = {
  flags: 8,
  candidateX: 12,
  candidateY: 16,
  candidateRadius: 20,
  candidateFlags: 24,
  candidateCount: 28,
  pathX: 32,
  pathY: 36,
  pathCount: 40,
  routeContext: 44,
  requestNonce: 48,
  verticalVariationScale: 56,
} as const;

const oneClickResult = {
  magic: 0,
  status: 4,
  session: 8,
  edgeJobs: 12,
  edgeJobCount: 16,
  targetOrder: 20,
  targetCount: 24,
  pathX: 28,
  pathY: 32,
  pathCount: 36,
  selectedEdgeCount: 40,
  nonce: 44,
  requestNonce: 48,
} as const;

const oneClickEdgeJob = {
  id: 0,
  from: 4,
  to: 8,
  startX: 16,
  startY: 24,
  targetX: 32,
  targetY: 40,
} as const;

const oneClickEdgeResult = {
  id: 0,
  reachable: 4,
  routeX: 8,
  routeY: 12,
  routeCount: 16,
  sessionNonce: 20,
  requestNonce: 24,
} as const;

const oneClickSession = {
  magic: 0,
  nonce: 4,
  phase: 8,
  flags: 12,
  targetX: 16,
  targetY: 20,
  targetRadius: 24,
  targetCount: 28,
  pathX: 32,
  pathY: 36,
  pathCount: 40,
  edgeJobs: 44,
  edgeJobCount: 48,
  resultPathX: 52,
  resultPathY: 56,
  resultPathCount: 60,
  completedFlags: 64,
  completedCount: 68,
  route: 72,
  routePointCount: 76,
  routeCapacity: 80,
  targetOrder: 84,
  requestNonce: 88,
  verticalVariationScale: 96,
} as const;

const oneClickResume = {
  session: 0,
  nonce: 4,
  work: 8,
  workCount: 12,
} as const;

export interface GraphwarWasmSmartPathfindingInput {
  readonly isDeleteOptimizationEnabled: boolean;
  readonly points: readonly GraphwarWasmPoint[];
  readonly routeContextPointer?: number;
  readonly sourcePointCount: number;
  readonly target: GraphwarWasmPoint;
  readonly targetRadius: number;
}

export type GraphwarWasmSmartPathfindingResult =
  | {
      readonly points: readonly GraphwarWasmPoint[];
      readonly removedPointCount: number;
      readonly status: "failure";
    }
  | {
      readonly isValidated: true;
      readonly points: readonly GraphwarWasmPoint[];
      readonly removedPointCount: number;
      readonly status: "success";
    };

export interface GraphwarWasmOneClickCandidate {
  readonly hitCenter: GraphwarWasmPoint;
  readonly hitRadius: number;
  readonly isEnemy: boolean;
}

export interface GraphwarWasmOneClickClearInput {
  readonly candidates: readonly GraphwarWasmOneClickCandidate[];
  readonly isDeleteOptimizationEnabled: boolean;
  readonly isStepStateful: boolean;
  /** Sorts image-x descending when Graphwar's native x+ direction is mirrored. */
  readonly isTargetOrderDescending?: boolean;
  readonly path: readonly GraphwarWasmPoint[];
  readonly requestNonce: number;
  readonly routeContextPointer?: number;
  /** Graphwar-unit vertical variation per image-pixel y unit. */
  readonly verticalVariationScale?: number;
}

export interface GraphwarWasmOneClickEdgeJob {
  readonly from: number;
  readonly id: number;
  readonly startPoint: GraphwarWasmPoint;
  readonly targetPoint: GraphwarWasmPoint;
  readonly to: number;
}

export interface GraphwarWasmOneClickEdgeResult {
  readonly jobId: number;
  /** Session nonce prevents a result from another retained arena session being accepted. */
  readonly requestNonce: number;
  readonly reachable: boolean;
  readonly route?: readonly GraphwarWasmPoint[];
  /** Request nonce prevents a result from an older outer task/attempt being accepted. */
  readonly sessionNonce: number;
}

export type GraphwarWasmOneClickClearResult =
  | {
      readonly path: readonly GraphwarWasmPoint[];
      readonly selectedEdgeCount: number;
      readonly status: "complete" | "failure";
      readonly targetOrder: readonly number[];
    }
  | {
      readonly edgeJobs: readonly GraphwarWasmOneClickEdgeJob[];
      readonly handle: GraphwarWasmOneClickSession;
      readonly status: "waiting-edge-batch";
      readonly targetOrder: readonly number[];
    };

/** A retained one-click session owns its arena mark until complete or cancel. */
export interface GraphwarWasmOneClickSession {
  readonly edgeJobs: readonly GraphwarWasmOneClickEdgeJob[];
  readonly nonce: number;
  readonly requestNonce: number;
  readonly targetOrder: readonly number[];
  cancel(): void;
  resume(results: readonly GraphwarWasmOneClickEdgeResult[]): GraphwarWasmOneClickClearResult;
}

interface DecodedOneClickSessionIdentity {
  readonly nonce: number;
  readonly pointer: number;
  readonly requestNonce: number;
}

interface DecodedWaitingOneClickResult {
  readonly __session: DecodedOneClickSessionIdentity;
  readonly edgeJobs: readonly GraphwarWasmOneClickEdgeJob[];
  readonly status: "waiting-edge-batch";
  readonly targetOrder: readonly number[];
}

type DecodedOneClickResult =
  | Exclude<GraphwarWasmOneClickClearResult, { status: "waiting-edge-batch" }>
  | DecodedWaitingOneClickResult;

/** Runs smart composition and returns owned point data before releasing scratch memory. */
export function runGraphwarWasmSmartPathfinding(
  runtime: GraphwarWasmKernelRuntime,
  input: GraphwarWasmSmartPathfindingInput,
): GraphwarWasmSmartPathfindingResult {
  const mark = runtime.markArena();
  try {
    const packed = packSmartInput(runtime, input);
    const commandPointer = runtime.reserveArena(graphwarWasmCompositionLayout.smartInputByteLength, 8);
    writeSmartInput(runtime, commandPointer, packed);
    const resultPointer = runtime.runSmartPathfinding(
      commandPointer,
      graphwarWasmCompositionLayout.smartInputByteLength,
    );
    const result = copySmartResult(runtime, resultPointer, input.points.length);
    runtime.resetArena(mark);
    return result;
  } catch (error) {
    runtime.resetArenaAfterFault(mark);
    throw error;
  }
}

/** Starts a retained one-click session; waiting sessions keep one atomic arena mark. */
export function beginGraphwarWasmOneClickClear(
  runtime: GraphwarWasmKernelRuntime,
  input: GraphwarWasmOneClickClearInput,
): GraphwarWasmOneClickClearResult {
  const mark = runtime.markArena();
  let keepsMark = false;
  let hasBegunSessionCommand = false;
  let beginArenaCursor = 0;
  try {
    const packed = packOneClickInput(runtime, input);
    const commandPointer = runtime.reserveArena(graphwarWasmCompositionLayout.oneClickInputByteLength, 8);
    writeOneClickInput(runtime, commandPointer, packed);
    // begin may publish a retained session before a later runtime/result-boundary failure reaches this adapter.
    // Mark the command as started before crossing the boundary so the catch path always releases that session.
    hasBegunSessionCommand = true;
    beginArenaCursor = runtime.arenaCursor;
    const resultPointer = runtime.beginOneClickClear(
      commandPointer,
      graphwarWasmCompositionLayout.oneClickInputByteLength,
    );
    const decoded = copyOneClickResult(runtime, resultPointer, packed.requestNonce, packed.verticalVariationScale);
    if (decoded.status !== "waiting-edge-batch") {
      runtime.resetArena(mark);
      return decoded;
    }
    const session = createOneClickSession(runtime, mark, decoded, packed.verticalVariationScale);
    keepsMark = true;
    return { ...decoded, handle: session };
  } catch (error) {
    if (keepsMark) {
      throw error;
    }
    try {
      // A begin that traps while another session is already active has not allocated
      // anything for this command. Only cancel after this invocation advanced its
      // arena, and bind the cleanup to the request identity as a second guard.
      if (hasBegunSessionCommand && runtime.arenaCursor > beginArenaCursor) {
        runtime.cancelOneClickClear(input.requestNonce);
      }
    } finally {
      runtime.resetArenaAfterFault(mark);
    }
    throw error;
  }
}

function packSmartInput(runtime: GraphwarWasmKernelRuntime, input: GraphwarWasmSmartPathfindingInput) {
  const points = validatePoints(input.points, "points");
  const sourcePointCount = validateGraphwarWasmU32(input.sourcePointCount, "sourcePointCount", "input");
  if (sourcePointCount > points.length) {
    throw new GraphwarWasmAdapterError("invalid-index", "sourcePointCount exceeds point count", "input");
  }
  const target = validatePoint(input.target, "target");
  const targetRadius = validateNonNegativeFinite(input.targetRadius, "targetRadius");
  const routeContextPointer = validateOptionalPointer(input.routeContextPointer, "routeContextPointer");
  return {
    flags: input.isDeleteOptimizationEnabled ? smartInputDeleteOptimizationFlag : 0,
    pointsX: writeGraphwarWasmFloat64Values(runtime, new Float64Array(points.map(({ x }) => x)), runtime.arenaBase),
    pointsY: writeGraphwarWasmFloat64Values(runtime, new Float64Array(points.map(({ y }) => y)), runtime.arenaBase),
    pointCount: points.length,
    routeContextPointer,
    sourcePointCount,
    target,
    targetRadius,
  };
}

function writeSmartInput(
  runtime: GraphwarWasmKernelRuntime,
  pointer: number,
  packed: ReturnType<typeof packSmartInput>,
) {
  const view = new DataView(runtime.buffer, pointer, graphwarWasmCompositionLayout.smartInputByteLength);
  view.setUint32(0, smartInputMagic, true);
  view.setUint32(4, smartInputVersion, true);
  view.setUint32(smartInput.flags, packed.flags, true);
  view.setUint32(smartInput.pointsX, packed.pointsX.pointer, true);
  view.setUint32(smartInput.pointsY, packed.pointsY.pointer, true);
  view.setUint32(smartInput.pointCount, packed.pointCount, true);
  view.setUint32(smartInput.sourcePointCount, packed.sourcePointCount, true);
  view.setFloat64(smartInput.targetX, packed.target.x, true);
  view.setFloat64(smartInput.targetY, packed.target.y, true);
  view.setFloat64(smartInput.targetRadius, packed.targetRadius, true);
  view.setUint32(smartInput.routeContext, packed.routeContextPointer, true);
}

export function copySmartResult(
  runtime: GraphwarWasmMemorySource,
  resultPointer: number,
  originalPointCount: number,
): GraphwarWasmSmartPathfindingResult {
  const view = readRecord(runtime, resultPointer, graphwarWasmCompositionLayout.smartResultByteLength, 8);
  if (view.getUint32(smartResult.magic, true) !== smartResultMagic) {
    throw new GraphwarWasmAdapterError("invalid-session-pointer", "smart result magic is invalid", "output");
  }
  const status = validateGraphwarWasmEnumValue(
    view.getUint32(smartResult.status, true),
    [0, 1] as const,
    "smart status",
  );
  const pointCount = validateGraphwarWasmU32(view.getUint32(smartResult.pointCount, true), "smart point count");
  const points = copyPointSoA(
    runtime,
    view.getUint32(smartResult.pointsX, true),
    view.getUint32(smartResult.pointsY, true),
    pointCount,
  );
  const removedPointCount = validateGraphwarWasmU32(
    view.getUint32(smartResult.removedPointCount, true),
    "smart removed point count",
  );
  const validatedOriginalPointCount = validateGraphwarWasmU32(
    originalPointCount,
    "smart original point count",
    "input",
  );
  if (
    pointCount > validatedOriginalPointCount ||
    removedPointCount > validatedOriginalPointCount ||
    removedPointCount > validatedOriginalPointCount - pointCount ||
    (status === 1 && removedPointCount + pointCount !== validatedOriginalPointCount) ||
    (status === 1 && pointCount === 0) ||
    (status === 0 && (pointCount !== 0 || removedPointCount !== 0))
  ) {
    throw new GraphwarWasmAdapterError("invalid-index", "smart removed point count is inconsistent", "output");
  }
  const validated = view.getUint32(smartResult.validated, true);
  if (validated > 1 || (status === 1 && validated !== 1) || (status === 0 && validated !== 0)) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "smart result validation flag is inconsistent",
      "output",
    );
  }
  return status === 1
    ? { isValidated: true, points, removedPointCount, status: "success" }
    : { points, removedPointCount, status: "failure" };
}

function packOneClickInput(runtime: GraphwarWasmKernelRuntime, input: GraphwarWasmOneClickClearInput) {
  const candidates = input.candidates.map((candidate, index) => ({
    flags: candidate.isEnemy ? 1 : 0,
    radius: validateNonNegativeFinite(candidate.hitRadius, `candidates[${index}].hitRadius`),
    point: validatePoint(candidate.hitCenter, `candidates[${index}].hitCenter`),
  }));
  const path = validatePoints(input.path, "path");
  const requestNonce = validateGraphwarWasmU32(input.requestNonce, "requestNonce", "input");
  if (requestNonce === 0) {
    throw new GraphwarWasmAdapterError("invalid-session-identity", "requestNonce must be non-zero", "input");
  }
  const verticalVariationScale = validateNonNegativeFinite(input.verticalVariationScale ?? 1, "verticalVariationScale");
  return {
    candidateFlags: writeGraphwarWasmUint32Values(
      runtime,
      Uint32Array.from(candidates, ({ flags }) => flags),
      runtime.arenaBase,
    ),
    candidateX: writeGraphwarWasmFloat64Values(
      runtime,
      new Float64Array(candidates.map(({ point }) => point.x)),
      runtime.arenaBase,
    ),
    candidateY: writeGraphwarWasmFloat64Values(
      runtime,
      new Float64Array(candidates.map(({ point }) => point.y)),
      runtime.arenaBase,
    ),
    candidateRadius: writeGraphwarWasmFloat64Values(
      runtime,
      new Float64Array(candidates.map(({ radius }) => radius)),
      runtime.arenaBase,
    ),
    flags:
      (input.isDeleteOptimizationEnabled ? oneClickDeleteOptimizationFlag : 0) |
      (input.isStepStateful ? oneClickStepStatefulFlag : 0) |
      (input.isTargetOrderDescending ? oneClickTargetOrderDescendingFlag : 0),
    pathX: writeGraphwarWasmFloat64Values(runtime, new Float64Array(path.map(({ x }) => x)), runtime.arenaBase),
    pathY: writeGraphwarWasmFloat64Values(runtime, new Float64Array(path.map(({ y }) => y)), runtime.arenaBase),
    pathCount: path.length,
    requestNonce,
    routeContextPointer: validateOptionalPointer(input.routeContextPointer, "routeContextPointer"),
    verticalVariationScale,
  };
}

function writeOneClickInput(
  runtime: GraphwarWasmKernelRuntime,
  pointer: number,
  packed: ReturnType<typeof packOneClickInput>,
) {
  const view = new DataView(runtime.buffer, pointer, graphwarWasmCompositionLayout.oneClickInputByteLength);
  view.setUint32(0, oneClickInputMagic, true);
  view.setUint32(4, oneClickInputVersion, true);
  view.setUint32(oneClickInput.flags, packed.flags, true);
  view.setUint32(oneClickInput.candidateX, packed.candidateX.pointer, true);
  view.setUint32(oneClickInput.candidateY, packed.candidateY.pointer, true);
  view.setUint32(oneClickInput.candidateRadius, packed.candidateRadius.pointer, true);
  view.setUint32(oneClickInput.candidateFlags, packed.candidateFlags.pointer, true);
  view.setUint32(oneClickInput.candidateCount, packed.candidateX.length, true);
  view.setUint32(oneClickInput.pathX, packed.pathX.pointer, true);
  view.setUint32(oneClickInput.pathY, packed.pathY.pointer, true);
  view.setUint32(oneClickInput.pathCount, packed.pathCount, true);
  view.setUint32(oneClickInput.routeContext, packed.routeContextPointer, true);
  view.setUint32(oneClickInput.requestNonce, packed.requestNonce, true);
  view.setFloat64(oneClickInput.verticalVariationScale, packed.verticalVariationScale, true);
}

function copyOneClickResult(
  runtime: GraphwarWasmMemorySource,
  resultPointer: number,
  expectedRequestNonce?: number,
  expectedVerticalVariationScale?: number,
): DecodedOneClickResult {
  const view = readRecord(runtime, resultPointer, graphwarWasmCompositionLayout.oneClickResultByteLength, 8);
  if (view.getUint32(oneClickResult.magic, true) !== oneClickResultMagic) {
    throw new GraphwarWasmAdapterError("invalid-session-pointer", "one-click result magic is invalid", "output");
  }
  const status = validateGraphwarWasmEnumValue(
    view.getUint32(oneClickResult.status, true),
    [0, 1, 2] as const,
    "one-click status",
  );
  const resultNonce = validateGraphwarWasmU32(view.getUint32(oneClickResult.nonce, true), "one-click result nonce");
  const resultRequestNonce = validateGraphwarWasmU32(
    view.getUint32(oneClickResult.requestNonce, true),
    "one-click result request nonce",
  );
  if (resultNonce === 0 || resultRequestNonce === 0) {
    throw new GraphwarWasmAdapterError("invalid-session-identity", "one-click result has an invalid nonce", "output");
  }
  if (expectedRequestNonce !== undefined && resultRequestNonce !== expectedRequestNonce) {
    throw new GraphwarWasmAdapterError("invalid-session-identity", "one-click result request nonce is stale", "output");
  }
  const sessionPointer = validateGraphwarWasmU32(view.getUint32(oneClickResult.session, true), "session pointer");
  const edgeJobPointer = validateGraphwarWasmU32(view.getUint32(oneClickResult.edgeJobs, true), "edge job pointer");
  const edgeJobCount = validateGraphwarWasmU32(view.getUint32(oneClickResult.edgeJobCount, true), "edge job count");
  const targetCount = validateGraphwarWasmU32(view.getUint32(oneClickResult.targetCount, true), "target count");
  const targetOrder = copyGraphwarWasmUint32Values(
    runtime,
    { pointer: view.getUint32(oneClickResult.targetOrder, true), length: targetCount },
    runtime.arenaBase,
  );
  validatePermutation(targetOrder, targetCount, "target order");
  const path = copyPointSoA(
    runtime,
    view.getUint32(oneClickResult.pathX, true),
    view.getUint32(oneClickResult.pathY, true),
    validateGraphwarWasmU32(view.getUint32(oneClickResult.pathCount, true), "one-click path count"),
  );
  const selectedEdgeCount = validateGraphwarWasmU32(
    view.getUint32(oneClickResult.selectedEdgeCount, true),
    "selected edge count",
  );
  if (selectedEdgeCount > targetCount) {
    throw new GraphwarWasmAdapterError("invalid-index", "one-click selected edge count exceeds target count", "output");
  }
  if (status === 1) {
    if (
      sessionPointer === 0 ||
      edgeJobCount === 0 ||
      edgeJobPointer === 0 ||
      view.getUint32(oneClickResult.pathX, true) !== 0 ||
      view.getUint32(oneClickResult.pathY, true) !== 0 ||
      view.getUint32(oneClickResult.pathCount, true) !== 0 ||
      selectedEdgeCount !== 0
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "waiting one-click result has no session batch",
        "output",
      );
    }
    const session = readOneClickSession(
      runtime,
      sessionPointer,
      edgeJobPointer,
      edgeJobCount,
      targetCount,
      view.getUint32(oneClickResult.targetOrder, true),
      resultRequestNonce,
      expectedVerticalVariationScale,
    );
    if (session.nonce !== resultNonce) {
      throw new GraphwarWasmAdapterError("invalid-session-identity", "one-click result nonce is stale", "output");
    }
    return {
      __session: {
        nonce: session.nonce,
        pointer: session.pointer,
        requestNonce: session.requestNonce,
      },
      edgeJobs: session.edgeJobs,
      status: "waiting-edge-batch",
      targetOrder: Array.from(session.targetOrder),
    };
  }
  if (sessionPointer !== 0 || edgeJobPointer !== 0 || edgeJobCount !== 0) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "completed one-click result retains session state",
      "output",
    );
  }
  if (status === 2 && selectedEdgeCount !== 0) {
    throw new GraphwarWasmAdapterError("invalid-session-state", "failed one-click result selected an edge", "output");
  }
  if (status === 0 && (selectedEdgeCount === 0 || path.length === 0)) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "completed one-click result has no selected path",
      "output",
    );
  }
  return {
    path,
    selectedEdgeCount,
    status: status === 0 ? "complete" : "failure",
    targetOrder: Array.from(targetOrder),
  };
}

function createOneClickSession(
  runtime: GraphwarWasmKernelRuntime,
  mark: number,
  decoded: DecodedWaitingOneClickResult,
  verticalVariationScale: number,
): GraphwarWasmOneClickSession {
  let isActive = true;
  const sessionPointer = decoded.__session.pointer;
  const nonce = decoded.__session.nonce;
  const requestNonce = decoded.__session.requestNonce;
  let currentEdgeJobs = decoded.edgeJobs;
  let currentTargetOrder = decoded.targetOrder;

  const finish = (isFault: boolean) => {
    if (!isActive) return;
    isActive = false;
    try {
      runtime.cancelOneClickClear(requestNonce);
    } finally {
      if (isFault) runtime.resetArenaAfterFault(mark);
      else runtime.resetArena(mark);
    }
  };

  return {
    get edgeJobs() {
      return currentEdgeJobs;
    },
    nonce,
    requestNonce,
    get targetOrder() {
      return currentTargetOrder;
    },
    cancel() {
      finish(false);
    },
    resume(results) {
      if (!isActive) {
        throw new GraphwarWasmAdapterError("invalid-session-state", "one-click session is no longer active", "input");
      }
      try {
        const work = packEdgeResults(runtime, results, currentEdgeJobs, nonce, requestNonce);
        const envelopePointer = runtime.reserveArena(graphwarWasmCompositionLayout.oneClickResumeByteLength, 4);
        const envelope = new DataView(
          runtime.buffer,
          envelopePointer,
          graphwarWasmCompositionLayout.oneClickResumeByteLength,
        );
        envelope.setUint32(oneClickResume.session, sessionPointer, true);
        envelope.setUint32(oneClickResume.nonce, nonce, true);
        envelope.setUint32(oneClickResume.work, work.pointer, true);
        envelope.setUint32(oneClickResume.workCount, work.count, true);
        const resultPointer = runtime.resumeOneClickClear(
          envelopePointer,
          graphwarWasmCompositionLayout.oneClickResumeByteLength,
        );
        const decodedResult = copyOneClickResult(runtime, resultPointer, requestNonce, verticalVariationScale);
        if (decodedResult.status === "waiting-edge-batch") {
          const nextSession = decodedResult.__session;
          if (nextSession.pointer !== sessionPointer || nextSession.nonce !== nonce) {
            throw new GraphwarWasmAdapterError(
              "invalid-session-identity",
              "one-click session identity changed",
              "output",
            );
          }
          currentEdgeJobs = decodedResult.edgeJobs;
          currentTargetOrder = decodedResult.targetOrder;
          return {
            edgeJobs: decodedResult.edgeJobs,
            handle: this,
            status: "waiting-edge-batch",
            targetOrder: decodedResult.targetOrder,
          };
        }
        finish(false);
        return decodedResult;
      } catch (error) {
        finish(true);
        throw error;
      }
    },
  };
}

function packEdgeResults(
  runtime: GraphwarWasmKernelRuntime,
  results: readonly GraphwarWasmOneClickEdgeResult[],
  jobs: readonly GraphwarWasmOneClickEdgeJob[],
  expectedSessionNonce: number,
  expectedRequestNonce: number,
) {
  if (results.length !== jobs.length) {
    throw new GraphwarWasmAdapterError(
      "invalid-work-batch",
      "one-click edge result count does not match the session",
      "input",
    );
  }
  const seen = new Uint8Array(jobs.length);
  const records = runtime.reserveArena(results.length * graphwarWasmCompositionLayout.oneClickEdgeResultByteLength, 4);
  for (const [index, result] of results.entries()) {
    const jobId = validateGraphwarWasmU32(result.jobId, `edgeResults[${index}].jobId`, "input");
    const sessionNonce = validateGraphwarWasmU32(result.sessionNonce, `edgeResults[${index}].sessionNonce`, "input");
    const requestNonce = validateGraphwarWasmU32(result.requestNonce, `edgeResults[${index}].requestNonce`, "input");
    if (sessionNonce !== expectedSessionNonce || requestNonce !== expectedRequestNonce) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        `edge result ${jobId} belongs to another one-click session`,
        "input",
      );
    }
    if (jobId >= jobs.length) {
      throw new GraphwarWasmAdapterError("unexpected-work-id", `edge result ${jobId} is not in the session`, "input");
    }
    if (seen[jobId] !== 0) {
      throw new GraphwarWasmAdapterError("duplicate-work-id", `edge result ${jobId} is duplicated`, "input");
    }
    seen[jobId] = 1;
    if (typeof result.reachable !== "boolean") {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        `edge result ${jobId} reachable flag is not boolean`,
        "input",
      );
    }
    const route = result.reachable ? validatePoints(result.route ?? [], `edgeResults[${index}].route`) : [];
    if (result.reachable && route.length < 2) {
      throw new GraphwarWasmAdapterError(
        "invalid-point-data",
        "reachable edge route must contain at least two points",
        "input",
      );
    }
    if (!result.reachable && result.route !== undefined) {
      throw new GraphwarWasmAdapterError(
        "invalid-point-data",
        `unreachable edge result ${jobId} must not carry a route`,
        "input",
      );
    }
    if (result.reachable) {
      const job = jobs[jobId];
      const first = route[0];
      const last = route.at(-1);
      if (!job || !first || !last || !pointsEqual(first, job.startPoint) || !pointsEqual(last, job.targetPoint)) {
        throw new GraphwarWasmAdapterError(
          "invalid-point-data",
          `edge result ${jobId} endpoints do not match its job descriptor`,
          "input",
        );
      }
    }
    const routeX = writeGraphwarWasmFloat64Values(
      runtime,
      new Float64Array(route.map(({ x }) => x)),
      runtime.arenaBase,
    );
    const routeY = writeGraphwarWasmFloat64Values(
      runtime,
      new Float64Array(route.map(({ y }) => y)),
      runtime.arenaBase,
    );
    const view = new DataView(
      runtime.buffer,
      records + index * graphwarWasmCompositionLayout.oneClickEdgeResultByteLength,
      graphwarWasmCompositionLayout.oneClickEdgeResultByteLength,
    );
    view.setUint32(oneClickEdgeResult.id, jobId, true);
    view.setUint32(oneClickEdgeResult.reachable, result.reachable ? 1 : 0, true);
    view.setUint32(oneClickEdgeResult.routeX, routeX.pointer, true);
    view.setUint32(oneClickEdgeResult.routeY, routeY.pointer, true);
    view.setUint32(oneClickEdgeResult.routeCount, route.length, true);
    view.setUint32(oneClickEdgeResult.sessionNonce, sessionNonce, true);
    view.setUint32(oneClickEdgeResult.requestNonce, requestNonce, true);
  }
  for (const [jobId, value] of seen.entries()) {
    if (value === 0) {
      throw new GraphwarWasmAdapterError("missing-work-id", `edge result ${jobId} is missing`, "input");
    }
  }
  return { count: results.length, pointer: records };
}

function readOneClickSession(
  runtime: GraphwarWasmMemorySource,
  pointer: number,
  edgeJobPointer: number,
  edgeJobCount: number,
  targetCount: number,
  targetOrderPointer: number,
  expectedRequestNonce?: number,
  expectedVerticalVariationScale?: number,
) {
  const view = readRecord(runtime, pointer, graphwarWasmCompositionLayout.oneClickSessionByteLength, 8);
  if (view.getUint32(oneClickSession.magic, true) !== oneClickSessionMagic) {
    throw new GraphwarWasmAdapterError("invalid-session-pointer", "one-click session magic is invalid", "output");
  }
  const nonce = validateGraphwarWasmU32(view.getUint32(oneClickSession.nonce, true), "session nonce");
  const requestNonce = validateGraphwarWasmU32(
    view.getUint32(oneClickSession.requestNonce, true),
    "session request nonce",
  );
  const flags = view.getUint32(oneClickSession.flags, true);
  if (
    nonce === 0 ||
    requestNonce === 0 ||
    (flags & ~7) !== 0 ||
    view.getUint32(oneClickSession.phase, true) !== oneClickSessionWaitingPhase
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "one-click session is not waiting for edge work",
      "output",
    );
  }
  if (expectedRequestNonce !== undefined && requestNonce !== expectedRequestNonce) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "one-click session request nonce is stale",
      "output",
    );
  }
  const verticalVariationScale = validateGraphwarWasmFiniteNumber(
    view.getFloat64(oneClickSession.verticalVariationScale, true),
    "session vertical variation scale",
    "output",
  );
  if (verticalVariationScale < 0) {
    throw new GraphwarWasmAdapterError(
      "invalid-finite-number",
      "session vertical variation scale is negative",
      "output",
    );
  }
  if (
    expectedVerticalVariationScale !== undefined &&
    !Object.is(verticalVariationScale, expectedVerticalVariationScale)
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "one-click session vertical variation scale changed",
      "output",
    );
  }
  const sessionTargetCount = validateGraphwarWasmU32(
    view.getUint32(oneClickSession.targetCount, true),
    "session target count",
  );
  if (sessionTargetCount !== targetCount) {
    throw new GraphwarWasmAdapterError("invalid-session-identity", "one-click session target count changed", "output");
  }
  const targetOrderValue = validateGraphwarWasmU32(
    view.getUint32(oneClickSession.targetOrder, true),
    "session target order pointer",
  );
  if (targetOrderValue !== targetOrderPointer) {
    throw new GraphwarWasmAdapterError("invalid-session-identity", "one-click session target order changed", "output");
  }
  const targetOrder = copyGraphwarWasmUint32Values(
    runtime,
    { pointer: targetOrderValue, length: targetCount },
    runtime.arenaBase,
  );
  validatePermutation(targetOrder, targetCount, "session target order");
  const targetX = copySessionFloat64Values(
    runtime,
    view.getUint32(oneClickSession.targetX, true),
    targetCount,
    "session target x",
  );
  const targetY = copySessionFloat64Values(
    runtime,
    view.getUint32(oneClickSession.targetY, true),
    targetCount,
    "session target y",
  );
  const targetRadius = copySessionFloat64Values(
    runtime,
    view.getUint32(oneClickSession.targetRadius, true),
    targetCount,
    "session target radius",
  );
  for (const [index, radius] of targetRadius.entries()) {
    if (radius < 0) {
      throw new GraphwarWasmAdapterError(
        "invalid-finite-number",
        `session target radius ${index} is negative`,
        "output",
      );
    }
  }
  const pathCount = validateGraphwarWasmU32(view.getUint32(oneClickSession.pathCount, true), "session path count");
  const path = copySessionPoints(
    runtime,
    view.getUint32(oneClickSession.pathX, true),
    view.getUint32(oneClickSession.pathY, true),
    pathCount,
    "session path",
  );
  const sessionJobPointer = validateGraphwarWasmU32(
    view.getUint32(oneClickSession.edgeJobs, true),
    "session edge job pointer",
  );
  const sessionJobCount = validateGraphwarWasmU32(
    view.getUint32(oneClickSession.edgeJobCount, true),
    "session edge job count",
  );
  if (
    sessionJobPointer !== edgeJobPointer ||
    sessionJobCount !== edgeJobCount ||
    sessionJobCount === 0 ||
    sessionJobPointer === 0
  ) {
    throw new GraphwarWasmAdapterError("invalid-session-identity", "one-click session edge batch changed", "output");
  }
  if (
    view.getUint32(oneClickSession.completedFlags, true) !== 0 ||
    view.getUint32(oneClickSession.completedCount, true) !== 0 ||
    view.getUint32(oneClickSession.resultPathX, true) !== 0 ||
    view.getUint32(oneClickSession.resultPathY, true) !== 0 ||
    view.getUint32(oneClickSession.resultPathCount, true) !== 0 ||
    view.getUint32(oneClickSession.route, true) !== 0 ||
    view.getUint32(oneClickSession.routePointCount, true) !== 0 ||
    view.getUint32(oneClickSession.routeCapacity, true) !== 0
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "waiting one-click session contains completed state",
      "output",
    );
  }
  const edgeJobs = copyEdgeJobs(
    runtime,
    edgeJobPointer,
    edgeJobCount,
    targetCount,
    targetOrder,
    targetX,
    targetY,
    path,
  );
  return { edgeJobs, nonce, pointer, requestNonce, targetOrder };
}

function copyEdgeJobs(
  runtime: GraphwarWasmMemorySource,
  pointer: number,
  count: number,
  targetCount: number,
  targetOrder: Uint32Array,
  targetX: Float64Array,
  targetY: Float64Array,
  path: readonly GraphwarWasmPoint[],
): GraphwarWasmOneClickEdgeJob[] {
  const range = validateGraphwarWasmMemoryRange(
    runtime,
    { pointer, length: count * graphwarWasmCompositionLayout.oneClickEdgeJobByteLength },
    { alignment: 8, elementByteLength: 1, minimumPointer: runtime.arenaBase },
  );
  const view = new DataView(range.buffer, range.byteOffset, range.byteLength);
  return Array.from({ length: count }, (_, index) => {
    const offset = index * graphwarWasmCompositionLayout.oneClickEdgeJobByteLength;
    const id = validateGraphwarWasmU32(view.getUint32(offset + oneClickEdgeJob.id, true), `edgeJobs[${index}].id`);
    const fromValue = view.getUint32(offset + oneClickEdgeJob.from, true);
    const from =
      fromValue === oneClickEdgeStartSentinel ? -1 : validateGraphwarWasmU32(fromValue, `edgeJobs[${index}].from`);
    const to = validateGraphwarWasmU32(view.getUint32(offset + oneClickEdgeJob.to, true), `edgeJobs[${index}].to`);
    if (id !== index || to >= targetCount || (from >= 0 && (from >= targetCount || from >= to))) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        `edge job ${index} has invalid DAG indices`,
        "output",
      );
    }
    const expectedTarget = {
      x: targetX[targetOrder[to]],
      y: targetY[targetOrder[to]],
    };
    const expectedStart =
      from < 0
        ? (path.at(-1) ?? { x: 0, y: 0 })
        : {
            x: targetX[targetOrder[from]],
            y: targetY[targetOrder[from]],
          };
    const startPoint = {
      x: validateGraphwarWasmFiniteNumber(
        view.getFloat64(offset + oneClickEdgeJob.startX, true),
        `edgeJobs[${index}].startX`,
      ),
      y: validateGraphwarWasmFiniteNumber(
        view.getFloat64(offset + oneClickEdgeJob.startY, true),
        `edgeJobs[${index}].startY`,
      ),
    };
    const targetPoint = {
      x: validateGraphwarWasmFiniteNumber(
        view.getFloat64(offset + oneClickEdgeJob.targetX, true),
        `edgeJobs[${index}].targetX`,
      ),
      y: validateGraphwarWasmFiniteNumber(
        view.getFloat64(offset + oneClickEdgeJob.targetY, true),
        `edgeJobs[${index}].targetY`,
      ),
    };
    if (!pointsEqual(startPoint, expectedStart) || !pointsEqual(targetPoint, expectedTarget)) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        `edge job ${index} endpoints do not match its target descriptors`,
        "output",
      );
    }
    return {
      from,
      id,
      startPoint,
      targetPoint,
      to,
    };
  });
}

function copyPointSoA(runtime: GraphwarWasmMemorySource, xPointer: number, yPointer: number, count: number) {
  const xs = copyGraphwarWasmFloat64Values(runtime, { pointer: xPointer, length: count }, runtime.arenaBase);
  const ys = copyGraphwarWasmFloat64Values(runtime, { pointer: yPointer, length: count }, runtime.arenaBase);
  return Array.from(xs, (x, index) => ({
    x: validateGraphwarWasmFiniteNumber(x, `point[${index}].x`),
    y: validateGraphwarWasmFiniteNumber(ys[index], `point[${index}].y`),
  }));
}

function copySessionFloat64Values(
  runtime: GraphwarWasmMemorySource,
  pointer: number,
  count: number,
  fieldName: string,
) {
  if (count === 0) {
    if (pointer !== 0) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        `${fieldName} has a pointer for an empty array`,
        "output",
      );
    }
    return new Float64Array();
  }
  const values = copyGraphwarWasmFloat64Values(runtime, { pointer, length: count }, runtime.arenaBase);
  return Float64Array.from(values, (value, index) => validateGraphwarWasmFiniteNumber(value, `${fieldName}[${index}]`));
}

function copySessionPoints(
  runtime: GraphwarWasmMemorySource,
  xPointer: number,
  yPointer: number,
  count: number,
  fieldName: string,
) {
  if (count === 0) {
    if (xPointer !== 0 || yPointer !== 0) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        `${fieldName} has a pointer for an empty array`,
        "output",
      );
    }
    return [];
  }
  const xs = copySessionFloat64Values(runtime, xPointer, count, `${fieldName}.x`);
  const ys = copySessionFloat64Values(runtime, yPointer, count, `${fieldName}.y`);
  return Array.from(xs, (x, index) => ({ x, y: ys[index] }));
}

function pointsEqual(left: GraphwarWasmPoint, right: GraphwarWasmPoint) {
  return Object.is(left.x, right.x) && Object.is(left.y, right.y);
}

function readRecord(runtime: GraphwarWasmMemorySource, pointer: number, byteLength: number, alignment: number) {
  const range = validateGraphwarWasmMemoryRange(
    runtime,
    { pointer, length: byteLength },
    { alignment, elementByteLength: 1, minimumPointer: runtime.arenaBase },
  );
  return new DataView(range.buffer, range.byteOffset, range.byteLength);
}

function validatePoints(points: readonly GraphwarWasmPoint[], fieldName: string) {
  return points.map((point, index) => validatePoint(point, `${fieldName}[${index}]`));
}

function validatePoint(point: GraphwarWasmPoint, fieldName: string) {
  return {
    x: validateGraphwarWasmFiniteNumber(point.x, `${fieldName}.x`, "input"),
    y: validateGraphwarWasmFiniteNumber(point.y, `${fieldName}.y`, "input"),
  };
}

function validateNonNegativeFinite(value: unknown, fieldName: string) {
  const validated = validateGraphwarWasmFiniteNumber(value, fieldName, "input");
  if (validated < 0) {
    throw new GraphwarWasmAdapterError("invalid-finite-number", `${fieldName} must be non-negative`, "input");
  }
  return validated;
}

function validateOptionalPointer(value: unknown, fieldName: string) {
  const pointer = value === undefined ? 0 : validateGraphwarWasmU32(value, fieldName, "input");
  if (pointer !== 0 && pointer % 8 !== 0) {
    throw new GraphwarWasmAdapterError("invalid-alignment", `${fieldName} must be eight-byte aligned`, "input");
  }
  return pointer;
}

function validatePermutation(values: Uint32Array, length: number, fieldName: string) {
  const seen = new Uint8Array(length);
  for (const [index, value] of values.entries()) {
    if (value >= length || seen[value] !== 0) {
      throw new GraphwarWasmAdapterError("invalid-index", `${fieldName}[${index}] is not a permutation`, "output");
    }
    seen[value] = 1;
  }
}
