import {
  GraphwarWasmAdapterError,
  copyGraphwarWasmFloat64Values,
  validateGraphwarWasmEnumValue,
  validateGraphwarWasmFiniteNumber,
  validateGraphwarWasmMemoryRange,
  validateGraphwarWasmU32,
  writeGraphwarWasmFloat64Values,
  writeGraphwarWasmUint32Values,
  type GraphwarWasmMemorySource,
} from "./abi";
import { packGraphwarWasmTrajectoryCommandTemplate } from "./formula-adapter";
import type { GraphwarWasmKernelRuntime } from "./runtime";
import type { GraphwarWasmFormulaInputDescriptor, GraphwarWasmPoint, GraphwarWasmStopPolicy } from "./task-adapter";

/** Versioned flat records shared by the AssemblyScript composition exports. */
export const graphwarWasmCompositionLayout = {
  oneClickEdgeJobByteLength: 56,
  oneClickEdgeResultByteLength: 28,
  oneClickInputByteLength: 96,
  oneClickResultByteLength: 56,
  oneClickResumeByteLength: 16,
  oneClickSessionByteLength: 112,
  smartInputByteLength: 80,
  smartResultByteLength: 96,
} as const;

const smartInputMagic = 0x534d_4152;
const smartInputVersion = 2;
const smartInputDeleteOptimizationFlag = 1;
const smartInputRouteContextValidationFlag = 2;
const smartInputGraphValidationFlag = 4;
const smartInputTrajectoryValidationFlag = 8;
const smartResultMagic = 0x534d_5253;
const oneClickInputMagic = 0x4f_434c_52;
const oneClickInputVersion = 1;
const oneClickDeleteOptimizationFlag = 1;
const oneClickStepStatefulFlag = 2;
const oneClickTargetOrderDescendingFlag = 4;
const oneClickExplicitDagFlag = 8;
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
  routePointsX: 52,
  routePointsY: 56,
  routeContext: 60,
  routeGraphX: 64,
  trajectoryCommand: 72,
  trajectoryCommandByteLength: 76,
} as const;

const smartResult = {
  magic: 0,
  status: 4,
  pointsX: 8,
  pointsY: 12,
  pointCount: 16,
  removedPointCount: 20,
  validated: 24,
  failureReason: 28,
  outputGraphX: 32,
  outputRouteX: 36,
  outputRouteY: 40,
  evidenceCount: 44,
  validationRole: 48,
  detailFlags: 52,
  targetX: 56,
  targetY: 64,
  targetRadius: 72,
  blockedPointX: 80,
  blockedPointY: 88,
} as const;

const smartFailureReason = {
  none: 0,
  target: 1,
  graphRule: 2,
  routeObstacle: 3,
  trajectory: 4,
} as const;

const smartValidationRole = {
  none: 0,
  routeOnly: 1,
  trajectory: 2,
} as const;

const smartResultBlockedPointFlag = 1;

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
  targetOrderKeys: 64,
  targetOrderKeyCount: 68,
  dagJobs: 72,
  dagJobCount: 76,
  dagNodeIds: 80,
  dagNodeIdCount: 84,
  dagNodeCount: 88,
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
  selectedEdgeIds: 52,
} as const;

const oneClickEdgeJob = {
  id: 0,
  from: 4,
  to: 8,
  startX: 16,
  startY: 24,
  targetX: 32,
  targetY: 40,
  fromNodeId: 48,
  toNodeId: 52,
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
  nodeCount: 104,
} as const;

const oneClickResume = {
  session: 0,
  nonce: 4,
  work: 8,
  workCount: 12,
} as const;

interface GraphwarWasmSmartPathfindingInputBase {
  readonly isDeleteOptimizationEnabled: boolean;
  readonly points: readonly GraphwarWasmPoint[];
  readonly routeContextPointer?: number;
  /** Atomic route evidence: quantized mask points and their continuous Graphwar x identity. */
  readonly routeValidationEvidence?: GraphwarWasmSmartRouteValidationEvidence;
  readonly sourcePointCount: number;
  readonly target: GraphwarWasmPoint;
  readonly targetRadius: number;
}

export interface GraphwarWasmSmartTrajectoryValidation {
  readonly descriptor: GraphwarWasmFormulaInputDescriptor;
  readonly stop: Extract<GraphwarWasmStopPolicy, { type: "targets" }>;
  readonly type: "trajectory";
}

/** Route-only is an explicit test/partial-composition state; production smart requests use trajectory validation. */
export type GraphwarWasmSmartPathfindingInput = GraphwarWasmSmartPathfindingInputBase &
  (
    | { readonly trajectoryValidation: { readonly type: "route-only" } }
    | { readonly trajectoryValidation: GraphwarWasmSmartTrajectoryValidation }
  );

export interface GraphwarWasmSmartRouteValidationEvidence {
  /** Forward-plane integer points used only by the retained route-context validator. */
  readonly points: readonly GraphwarWasmPoint[];
  /** Continuous Graphwar x values paired by index with `points`. */
  readonly graphX: readonly number[];
}

export type GraphwarWasmSmartPathfindingResult =
  | {
      readonly blockedPoint?: GraphwarWasmPoint;
      readonly failureReason?: "graph-rule" | "route-obstacle" | "target" | "trajectory";
      readonly points: readonly GraphwarWasmPoint[];
      readonly removedPointCount: number;
      readonly status: "failure";
    }
  | {
      readonly points: readonly GraphwarWasmPoint[];
      readonly removedPointCount: number;
      readonly status: "success";
      readonly validation: {
        readonly target: { readonly center: GraphwarWasmPoint; readonly radius: number };
        readonly type: "route-only" | "trajectory";
      };
    };

export interface GraphwarWasmOneClickCandidate {
  readonly hitCenter: GraphwarWasmPoint;
  readonly hitRadius: number;
  readonly isEnemy: boolean;
}

export interface GraphwarWasmOneClickClearInput {
  readonly candidates: readonly GraphwarWasmOneClickCandidate[];
  /** Optional full DAG descriptor; when present WASM consumes these jobs verbatim. */
  readonly dagJobs?: readonly GraphwarWasmOneClickDagJob[];
  /** Number of interned DAG nodes referenced by dagJobs. */
  readonly dagNodeCount?: number;
  readonly isDeleteOptimizationEnabled: boolean;
  readonly isStepStateful: boolean;
  /** Sorts image-x descending when Graphwar's native x+ direction is mirrored. */
  readonly isTargetOrderDescending?: boolean;
  readonly path: readonly GraphwarWasmPoint[];
  readonly requestNonce: number;
  readonly routeContextPointer?: number;
  /** Quantized forward-plane columns used to preserve target-assignment identity. */
  readonly targetOrderKeys?: readonly number[];
  /** Graphwar-unit vertical variation per image-pixel y unit. */
  readonly verticalVariationScale?: number;
}

export interface GraphwarWasmOneClickEdgeJob {
  readonly from: number;
  readonly id: number;
  readonly startPoint: GraphwarWasmPoint;
  readonly targetPoint: GraphwarWasmPoint;
  readonly to: number;
  /** Adapter-interned node identities, present for explicit DAG sessions. */
  readonly fromNodeId?: number;
  readonly toNodeId?: number;
}

/** Full DAG edge descriptor with identities that remain valid for arbitrary-precision Step keys. */
export interface GraphwarWasmOneClickDagJob extends GraphwarWasmOneClickEdgeJob {
  readonly fromNodeId: number;
  readonly toNodeId: number;
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
      readonly selectedEdgeIds: readonly number[];
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
  readonly dagNodeCount?: number;
  cancel(): void;
  resume(results: readonly GraphwarWasmOneClickEdgeResult[]): GraphwarWasmOneClickClearResult;
}

interface DecodedOneClickSessionIdentity {
  readonly nonce: number;
  readonly pointer: number;
  readonly requestNonce: number;
}

interface OneClickMemoryRange {
  readonly alignment: number;
  readonly length: number;
  readonly pointer: number;
}

interface OneClickRetainedRoute {
  readonly points: readonly GraphwarWasmPoint[];
  readonly xPointer: number;
  readonly yPointer: number;
}

interface PackedOneClickEdgeResults {
  readonly count: number;
  readonly pointer: number;
  readonly ranges: readonly OneClickMemoryRange[];
  readonly results: readonly GraphwarWasmOneClickEdgeResult[];
}

interface OneClickRetainedSession {
  readonly completedFlags: readonly number[];
  readonly completedFlagsPointer: number;
  readonly completedCount: number;
  readonly completedRoutes: readonly (readonly GraphwarWasmPoint[] | undefined)[];
  readonly edgeJobCount: number;
  readonly edgeJobPointer: number;
  readonly edgeJobs: readonly GraphwarWasmOneClickEdgeJob[];
  readonly flags: number;
  readonly isExplicitDag: boolean;
  readonly dagNodeCount: number;
  readonly nonce: number;
  readonly pathCount: number;
  readonly pathXPointer: number;
  readonly pathYPointer: number;
  readonly pointer: number;
  readonly ranges: readonly OneClickMemoryRange[];
  readonly path: readonly GraphwarWasmPoint[];
  readonly requestNonce: number;
  readonly routeCountByJob: readonly number[];
  readonly routesByJob: readonly (OneClickRetainedRoute | undefined)[];
  readonly routeCountPointer: number;
  readonly routeXPointer: number;
  readonly routeYPointer: number;
  readonly targetOrderPointer: number;
  readonly targetOrder: readonly number[];
  readonly targetRadiusPointer: number;
  readonly targetRadius: readonly number[];
  readonly targetXPointer: number;
  readonly targetX: readonly number[];
  readonly targetYPointer: number;
  readonly targetY: readonly number[];
}

interface OneClickOutputBoundary {
  readonly minimumPointer: number;
  readonly additionalRanges: readonly OneClickMemoryRange[];
  readonly forbiddenRanges: readonly OneClickMemoryRange[];
  readonly expectedPath?: readonly GraphwarWasmPoint[];
  readonly expectedWork?: readonly GraphwarWasmOneClickEdgeResult[];
  readonly retainedSession?: OneClickRetainedSession;
}

type OneClickRangeSource = "fresh" | "session" | "session-array";

function createOneClickOutputBoundary(
  minimumPointer: number,
  retainedSession?: OneClickRetainedSession,
  additionalRanges: readonly OneClickMemoryRange[] = [],
  forbiddenRanges: readonly OneClickMemoryRange[] = [],
  expectedWork?: readonly GraphwarWasmOneClickEdgeResult[],
  expectedPath?: readonly GraphwarWasmPoint[],
): OneClickOutputBoundary {
  return { additionalRanges, expectedPath, expectedWork, forbiddenRanges, minimumPointer, retainedSession };
}

function oneClickRangeMatches(left: OneClickMemoryRange, right: OneClickMemoryRange) {
  return left.pointer === right.pointer && left.length === right.length && left.alignment === right.alignment;
}

function oneClickRangesOverlap(left: OneClickMemoryRange, right: OneClickMemoryRange) {
  return left.pointer < right.pointer + right.length && right.pointer < left.pointer + left.length;
}

function oneClickNumberArraysEqual(left: ArrayLike<number>, right: ArrayLike<number>) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!Object.is(left[index], right[index])) return false;
  }
  return true;
}

function oneClickPointsArraysEqual(left: readonly GraphwarWasmPoint[], right: readonly GraphwarWasmPoint[]) {
  return (
    left.length === right.length &&
    left.every((point, index) => {
      const other = right[index];
      return other !== undefined && pointsEqual(point, other);
    })
  );
}

function oneClickJobsEqual(
  left: readonly GraphwarWasmOneClickEdgeJob[],
  right: readonly GraphwarWasmOneClickEdgeJob[],
) {
  return (
    left.length === right.length &&
    left.every((job, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        job.id === other.id &&
        job.from === other.from &&
        job.to === other.to &&
        job.fromNodeId === other.fromNodeId &&
        job.toNodeId === other.toNodeId &&
        pointsEqual(job.startPoint, other.startPoint) &&
        pointsEqual(job.targetPoint, other.targetPoint)
      );
    })
  );
}

function cloneOneClickPoint(point: GraphwarWasmPoint): GraphwarWasmPoint {
  return { x: point.x, y: point.y };
}

function cloneOneClickEdgeJob(job: GraphwarWasmOneClickEdgeJob): GraphwarWasmOneClickEdgeJob {
  return {
    from: job.from,
    id: job.id,
    startPoint: cloneOneClickPoint(job.startPoint),
    targetPoint: cloneOneClickPoint(job.targetPoint),
    to: job.to,
    ...(job.fromNodeId === undefined ? {} : { fromNodeId: job.fromNodeId }),
    ...(job.toNodeId === undefined ? {} : { toNodeId: job.toNodeId }),
  };
}

function cloneOneClickEdgeJobs(jobs: readonly GraphwarWasmOneClickEdgeJob[]) {
  return jobs.map(cloneOneClickEdgeJob);
}

function validateOneClickTerminalEvidence(
  retainedSession: OneClickRetainedSession,
  selectedEdgeIds: readonly number[],
  path: readonly GraphwarWasmPoint[],
  targetOrder: readonly number[],
  status: "complete" | "failure",
  expectedWork: readonly GraphwarWasmOneClickEdgeResult[] = [],
) {
  assertOneClickArrayEqual(targetOrder, retainedSession.targetOrder, "terminal target order");
  validateOneClickWorkEvidence(retainedSession, expectedWork);
  if (status === "failure") {
    if (
      retainedSession.completedCount + expectedWork.length !== retainedSession.edgeJobCount ||
      selectedEdgeIds.length !== 0 ||
      !oneClickPointsArraysEqual(path, retainedSession.path)
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "failed one-click result does not retain a completed source path",
        "output",
      );
    }
    return;
  }
  if (selectedEdgeIds.length === 0 || selectedEdgeIds.length > retainedSession.edgeJobs.length) {
    throw new GraphwarWasmAdapterError("invalid-session-state", "terminal selected edge ids are invalid", "output");
  }
  const jobsById = new Map(retainedSession.edgeJobs.map((job) => [job.id, job]));
  const seen = new Set<number>();
  let previousTarget = -1;
  const expectedRoutes = new Map<number, readonly GraphwarWasmPoint[]>();
  for (const result of expectedWork) {
    if (result.reachable && result.route) {
      expectedRoutes.set(result.jobId, result.route);
    }
  }
  const getRoute = (jobId: number) => expectedRoutes.get(jobId) ?? retainedSession.completedRoutes[jobId];
  let previousJob: GraphwarWasmOneClickEdgeJob | undefined;
  for (const jobId of selectedEdgeIds) {
    if (seen.has(jobId)) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        "terminal selected edge ids are duplicated",
        "output",
      );
    }
    seen.add(jobId);
    const job = jobsById.get(jobId);
    if (!job) {
      throw new GraphwarWasmAdapterError("invalid-session-identity", "terminal selected edge id is unknown", "output");
    }
    const isChain = previousJob
      ? retainedSession.isExplicitDag
        ? job.fromNodeId === previousJob.toNodeId
        : job.from === previousTarget
      : job.from === -1 && (!retainedSession.isExplicitDag || job.fromNodeId === oneClickEdgeStartSentinel);
    if (!isChain) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        "terminal selected edge ids do not form a contiguous chain",
        "output",
      );
    }
    previousTarget = job.to;
    const route = getRoute(jobId);
    if (!route || route.length < 2) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        "terminal selected edge is not reachable",
        "output",
      );
    }
    const lastRoutePoint = route.at(-1);
    if (!pointsEqual(route[0], job.startPoint) || !lastRoutePoint || !pointsEqual(lastRoutePoint, job.targetPoint)) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        "terminal selected edge route endpoints changed",
        "output",
      );
    }
    previousJob = job;
  }
  const expectedPath = [...retainedSession.path];
  const firstJob = jobsById.get(selectedEdgeIds[0] ?? -1);
  const lastJob = jobsById.get(selectedEdgeIds.at(-1) ?? -1);
  if (!firstJob || !lastJob) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "terminal selected edge identity is incomplete",
      "output",
    );
  }
  if (
    retainedSession.path.length > 0 &&
    !pointsEqual(path.at(retainedSession.path.length - 1) ?? { x: 0, y: 0 }, firstJob.startPoint)
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "terminal path does not preserve its source endpoint",
      "output",
    );
  }
  for (const [index, jobId] of selectedEdgeIds.entries()) {
    const route = getRoute(jobId);
    if (!route) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        "terminal selected edge has no route evidence",
        "output",
      );
    }
    const routeStart = index === 0 && expectedPath.length === 0 ? 0 : 1;
    if (routeStart === 1 && !pointsEqual(expectedPath.at(-1) ?? { x: 0, y: 0 }, route[0])) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        "terminal selected routes are discontinuous",
        "output",
      );
    }
    expectedPath.push(...route.slice(routeStart));
  }
  if (!oneClickPointsArraysEqual(path, expectedPath)) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "terminal path does not match the retained prefix",
      "output",
    );
  }
  const terminalPoint = path.at(-1);
  if (!terminalPoint || !lastJob || !pointsEqual(terminalPoint, lastJob.targetPoint)) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "terminal path does not reach its selected target",
      "output",
    );
  }
}

function validateOneClickWorkEvidence(
  retainedSession: OneClickRetainedSession,
  results: readonly GraphwarWasmOneClickEdgeResult[],
) {
  for (const result of results) {
    const wasCompleted = retainedSession.completedFlags[result.jobId] === 1;
    const retainedRoute = retainedSession.completedRoutes[result.jobId];
    if (wasCompleted) {
      if (Boolean(retainedRoute) !== result.reachable) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-identity",
          `edge ${result.jobId} reachability changed while resuming one-click clear`,
          "output",
        );
      }
      if (retainedRoute && (!result.route || !oneClickPointsArraysEqual(result.route, retainedRoute))) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-identity",
          `edge ${result.jobId} route evidence changed while resuming one-click clear`,
          "output",
        );
      }
    }
  }
}

function validateOneClickRetainedContent(
  retainedSession: OneClickRetainedSession,
  current: {
    readonly completedCount: number;
    readonly completedFlags: readonly number[];
    readonly completedRoutes: readonly (readonly GraphwarWasmPoint[] | undefined)[];
    readonly dagNodeCount: number;
    readonly edgeJobs: readonly GraphwarWasmOneClickEdgeJob[];
    readonly flags: number;
    readonly path: readonly GraphwarWasmPoint[];
    readonly targetOrder: readonly number[];
    readonly targetRadius: readonly number[];
    readonly targetX: readonly number[];
    readonly targetY: readonly number[];
  },
  expectedWork: readonly GraphwarWasmOneClickEdgeResult[],
) {
  validateOneClickImmutableSessionContent(retainedSession, current);
  if (current.completedCount !== retainedSession.completedCount + expectedWork.length) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "one-click retained completed count changed unexpectedly",
      "output",
    );
  }
  const workById = new Map(expectedWork.map((result) => [result.jobId, result]));
  for (let jobId = 0; jobId < retainedSession.edgeJobCount; jobId += 1) {
    const previousFlag = retainedSession.completedFlags[jobId];
    const currentFlag = current.completedFlags[jobId];
    const previousRoute = retainedSession.completedRoutes[jobId];
    const currentRoute = current.completedRoutes[jobId];
    if (previousFlag === 1) {
      if (currentFlag !== 1 || Boolean(currentRoute) !== Boolean(previousRoute)) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-identity",
          `one-click completed edge ${jobId} was mutated while resuming`,
          "output",
        );
      }
      if (previousRoute && (!currentRoute || !oneClickPointsArraysEqual(currentRoute, previousRoute))) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-identity",
          `one-click completed edge ${jobId} route was mutated while resuming`,
          "output",
        );
      }
      continue;
    }
    if (currentFlag === 0) {
      if (currentRoute) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          `one-click pending edge ${jobId} unexpectedly has a route`,
          "output",
        );
      }
      continue;
    }
    if (currentFlag !== 1) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        `one-click completed flag ${jobId} is invalid after resume`,
        "output",
      );
    }
    const result = workById.get(jobId);
    if (!result || Boolean(currentRoute) !== result.reachable) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        `one-click edge ${jobId} changed without matching resume evidence`,
        "output",
      );
    }
    if (
      result.reachable &&
      (!result.route || !currentRoute || !oneClickPointsArraysEqual(result.route, currentRoute))
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        `one-click edge ${jobId} route does not match resume evidence`,
        "output",
      );
    }
  }
}

function validateOneClickImmutableSessionContent(
  retainedSession: OneClickRetainedSession,
  current: {
    readonly edgeJobs?: readonly GraphwarWasmOneClickEdgeJob[];
    readonly dagNodeCount: number;
    readonly flags: number;
    readonly path: readonly GraphwarWasmPoint[];
    readonly targetOrder: readonly number[];
    readonly targetRadius: readonly number[];
    readonly targetX: readonly number[];
    readonly targetY: readonly number[];
  },
) {
  if (
    current.flags !== retainedSession.flags ||
    current.dagNodeCount !== retainedSession.dagNodeCount ||
    !oneClickNumberArraysEqual(current.targetOrder, retainedSession.targetOrder) ||
    !oneClickNumberArraysEqual(current.targetX, retainedSession.targetX) ||
    !oneClickNumberArraysEqual(current.targetY, retainedSession.targetY) ||
    !oneClickNumberArraysEqual(current.targetRadius, retainedSession.targetRadius) ||
    !oneClickPointsArraysEqual(current.path, retainedSession.path) ||
    (current.edgeJobs !== undefined && !oneClickJobsEqual(current.edgeJobs, retainedSession.edgeJobs))
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "one-click retained session content changed",
      "output",
    );
  }
}

function assertOneClickRangesDisjoint(
  ranges: readonly OneClickMemoryRange[],
  fieldName: string,
  allowExactDuplicates = true,
) {
  const uniqueRanges = allowExactDuplicates
    ? ranges.filter((range, index) => ranges.findIndex((candidate) => oneClickRangeMatches(candidate, range)) === index)
    : ranges;
  for (let index = 0; index < uniqueRanges.length; index += 1) {
    const range = uniqueRanges[index];
    if (!range) continue;
    for (let otherIndex = index + 1; otherIndex < uniqueRanges.length; otherIndex += 1) {
      const other = uniqueRanges[otherIndex];
      if (other && oneClickRangesOverlap(range, other)) {
        throw new GraphwarWasmAdapterError(
          "range-out-of-bounds",
          `${fieldName} contains overlapping ranges (${range.pointer}/${range.length} and ${other.pointer}/${other.length})`,
          "output",
        );
      }
    }
  }
}

function assertOneClickRangeDoesNotOverlap(
  candidate: OneClickMemoryRange,
  liveRanges: readonly OneClickMemoryRange[],
  fieldName: string,
) {
  for (const live of liveRanges) {
    if (oneClickRangesOverlap(live, candidate) && !oneClickRangeMatches(live, candidate)) {
      throw new GraphwarWasmAdapterError(
        "range-out-of-bounds",
        `${fieldName} overlaps a live one-click range (${candidate.pointer}/${candidate.length} and ${live.pointer}/${live.length})`,
        "output",
      );
    }
  }
}

function readOneClickRange(
  runtime: GraphwarWasmMemorySource,
  pointer: number,
  byteLength: number,
  alignment: number,
  boundary: OneClickOutputBoundary,
  fieldName: string,
  source: OneClickRangeSource = "session-array",
): ReturnType<typeof validateGraphwarWasmMemoryRange> {
  const range = validateGraphwarWasmMemoryRange(
    runtime,
    { pointer, length: byteLength },
    { alignment, elementByteLength: 1, minimumPointer: runtime.arenaBase, sliceFaultDomain: "output" },
  );
  const candidate = { alignment, length: byteLength, pointer } satisfies OneClickMemoryRange;
  const liveRanges = [
    ...boundary.additionalRanges,
    ...(boundary.retainedSession?.ranges ?? []),
    ...boundary.forbiddenRanges,
  ].filter(({ length }) => length > 0);
  assertOneClickRangesDisjoint(liveRanges, `${fieldName} boundary`);
  assertOneClickRangeDoesNotOverlap(candidate, liveRanges, fieldName);
  if (boundary.forbiddenRanges.some((forbidden) => oneClickRangesOverlap(forbidden, candidate))) {
    throw new GraphwarWasmAdapterError(
      "range-out-of-bounds",
      `${fieldName} overlaps a reserved one-click range`,
      "output",
    );
  }
  const isFresh = pointer >= boundary.minimumPointer;
  const isRetained =
    boundary.retainedSession?.ranges.some((allowed) => oneClickRangeMatches(allowed, candidate)) ?? false;
  const isAdditional = boundary.additionalRanges.some((allowed) => oneClickRangeMatches(allowed, candidate));
  const isAllowed =
    source === "fresh"
      ? isFresh
      : source === "session"
        ? boundary.retainedSession
          ? isRetained
          : isFresh
        : boundary.retainedSession
          ? isRetained || isAdditional
          : isFresh;
  if (!isAllowed) {
    throw new GraphwarWasmAdapterError(
      "range-out-of-bounds",
      `${fieldName} is outside the current one-click output ranges`,
      "output",
    );
  }
  return range;
}

function assertOneClickArrayEqual(actual: ArrayLike<number>, expected: ArrayLike<number>, fieldName: string): void {
  if (!oneClickNumberArraysEqual(actual, expected)) {
    throw new GraphwarWasmAdapterError("invalid-session-identity", `${fieldName} changed`, "output");
  }
}

function readOneClickRecord(
  runtime: GraphwarWasmMemorySource,
  pointer: number,
  byteLength: number,
  alignment: number,
  boundary: OneClickOutputBoundary,
  fieldName: string,
  source: OneClickRangeSource,
) {
  const range = readOneClickRange(runtime, pointer, byteLength, alignment, boundary, fieldName, source);
  return new DataView(range.buffer, range.byteOffset, range.byteLength);
}

function copyOneClickUint32Values(
  runtime: GraphwarWasmMemorySource,
  pointer: number,
  length: number,
  boundary: OneClickOutputBoundary,
  fieldName: string,
  source: OneClickRangeSource,
) {
  if (length === 0) {
    if (pointer !== 0) {
      throw new GraphwarWasmAdapterError("range-out-of-bounds", `${fieldName} has an unexpected pointer`, "output");
    }
    return [];
  }
  const range = readOneClickRange(
    runtime,
    pointer,
    length * Uint32Array.BYTES_PER_ELEMENT,
    Uint32Array.BYTES_PER_ELEMENT,
    boundary,
    fieldName,
    source,
  );
  return Array.from(new Uint32Array(range.buffer, range.byteOffset, length));
}

function copyOneClickFloat64Values(
  runtime: GraphwarWasmMemorySource,
  pointer: number,
  length: number,
  boundary: OneClickOutputBoundary,
  fieldName: string,
  source: OneClickRangeSource,
) {
  if (length === 0) {
    if (pointer !== 0) {
      throw new GraphwarWasmAdapterError("range-out-of-bounds", `${fieldName} has an unexpected pointer`, "output");
    }
    return [];
  }
  const range = readOneClickRange(
    runtime,
    pointer,
    length * Float64Array.BYTES_PER_ELEMENT,
    Float64Array.BYTES_PER_ELEMENT,
    boundary,
    fieldName,
    source,
  );
  return Array.from(new Float64Array(range.buffer, range.byteOffset, length));
}

function copyOneClickPoints(
  runtime: GraphwarWasmMemorySource,
  xPointer: number,
  yPointer: number,
  count: number,
  boundary: OneClickOutputBoundary,
  fieldName: string,
  source: OneClickRangeSource,
) {
  if (count > 0) {
    const xRange = {
      alignment: Float64Array.BYTES_PER_ELEMENT,
      length: count * Float64Array.BYTES_PER_ELEMENT,
      pointer: xPointer,
    } satisfies OneClickMemoryRange;
    const yRange = {
      alignment: Float64Array.BYTES_PER_ELEMENT,
      length: count * Float64Array.BYTES_PER_ELEMENT,
      pointer: yPointer,
    } satisfies OneClickMemoryRange;
    assertOneClickRangesDisjoint([xRange, yRange], `${fieldName} arrays`, false);
  }
  const xs = copyOneClickFloat64Values(runtime, xPointer, count, boundary, `${fieldName}.x`, source);
  const ys = copyOneClickFloat64Values(runtime, yPointer, count, boundary, `${fieldName}.y`, source);
  return Array.from(xs, (x, index) => ({
    x: validateGraphwarWasmFiniteNumber(x, `${fieldName}[${index}].x`, "output"),
    y: validateGraphwarWasmFiniteNumber(ys[index], `${fieldName}[${index}].y`, "output"),
  }));
}

interface DecodedWaitingOneClickResult {
  readonly __session: DecodedOneClickSessionIdentity;
  readonly edgeJobs: readonly GraphwarWasmOneClickEdgeJob[];
  readonly dagNodeCount: number;
  readonly retainedSession: OneClickRetainedSession;
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
    const outputMinimumPointer = runtime.arenaCursor;
    const resultPointer = runtime.runSmartPathfinding(
      commandPointer,
      graphwarWasmCompositionLayout.smartInputByteLength,
    );
    const result = copySmartResult(runtime, resultPointer, input, outputMinimumPointer);
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
    const decoded = copyOneClickResult(
      runtime,
      resultPointer,
      packed.requestNonce,
      packed.verticalVariationScale,
      createOneClickOutputBoundary(beginArenaCursor, undefined, [], [], undefined, packed.path),
    );
    if (decoded.status !== "waiting-edge-batch") {
      runtime.resetArena(mark);
      return decoded;
    }
    const session = createOneClickSession(runtime, mark, decoded, packed.verticalVariationScale);
    keepsMark = true;
    return {
      edgeJobs: session.edgeJobs,
      handle: session,
      status: "waiting-edge-batch",
      targetOrder: session.targetOrder,
    };
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
  const routeValidationEvidence = input.routeValidationEvidence
    ? {
        graphX: validateRouteValidationGraphX(input.routeValidationEvidence.graphX),
        points: validateRouteValidationPoints(input.routeValidationEvidence.points),
      }
    : undefined;
  if (
    routeContextPointer !== 0 &&
    (routeValidationEvidence === undefined ||
      routeValidationEvidence.points.length !== points.length ||
      routeValidationEvidence.graphX.length !== points.length)
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-index",
      "route validation evidence must match points when a route context is supplied",
      "input",
    );
  }
  if (routeContextPointer === 0 && routeValidationEvidence !== undefined) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "route validation evidence requires a route context",
      "input",
    );
  }
  const trajectoryCommand =
    input.trajectoryValidation.type === "trajectory"
      ? packSmartTrajectoryCommand(runtime, input.trajectoryValidation, points, target, targetRadius)
      : { byteLength: 0, pointer: 0 };
  const hasGraphValidation = routeContextPointer !== 0 || input.trajectoryValidation.type === "trajectory";
  return {
    flags:
      (input.isDeleteOptimizationEnabled ? smartInputDeleteOptimizationFlag : 0) |
      (routeContextPointer !== 0 ? smartInputRouteContextValidationFlag : 0) |
      (hasGraphValidation ? smartInputGraphValidationFlag : 0) |
      (input.trajectoryValidation.type === "trajectory" ? smartInputTrajectoryValidationFlag : 0),
    routePointsX:
      routeContextPointer === 0
        ? { pointer: 0, length: 0 }
        : writeGraphwarWasmFloat64Values(
            runtime,
            new Float64Array(routeValidationEvidence?.points.map(({ x }) => x) ?? []),
            runtime.arenaBase,
          ),
    routePointsY:
      routeContextPointer === 0
        ? { pointer: 0, length: 0 }
        : writeGraphwarWasmFloat64Values(
            runtime,
            new Float64Array(routeValidationEvidence?.points.map(({ y }) => y) ?? []),
            runtime.arenaBase,
          ),
    routeGraphX:
      routeContextPointer === 0
        ? { pointer: 0, length: 0 }
        : writeGraphwarWasmFloat64Values(
            runtime,
            new Float64Array(routeValidationEvidence?.graphX ?? []),
            runtime.arenaBase,
          ),
    pointsX: writeGraphwarWasmFloat64Values(runtime, new Float64Array(points.map(({ x }) => x)), runtime.arenaBase),
    pointsY: writeGraphwarWasmFloat64Values(runtime, new Float64Array(points.map(({ y }) => y)), runtime.arenaBase),
    pointCount: points.length,
    routeContextPointer,
    sourcePointCount,
    target,
    targetRadius,
    trajectoryCommand,
  };
}

/** Binds the formula path, target stop, and pixel-to-graph mapping before the raw template enters WASM. */
function packSmartTrajectoryCommand(
  runtime: GraphwarWasmKernelRuntime,
  validation: GraphwarWasmSmartTrajectoryValidation,
  points: readonly GraphwarWasmPoint[],
  target: GraphwarWasmPoint,
  targetRadius: number,
) {
  if (validation.descriptor.settings.isStepGlitchModeEnabled) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "ordinary smart trajectory validation does not accept Step-glitch formula modes",
      "input",
    );
  }
  const descriptorPoints = validatePoints(validation.descriptor.points, "trajectoryValidation.descriptor.points");
  if (descriptorPoints.length !== points.length || descriptorPoints.length < 2) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "smart trajectory descriptor points must match the complete candidate path",
      "input",
    );
  }
  const bounds = validation.descriptor.bounds;
  const minX = validateGraphwarWasmFiniteNumber(bounds.minX, "trajectoryValidation.descriptor.bounds.minX", "input");
  const maxX = validateGraphwarWasmFiniteNumber(bounds.maxX, "trajectoryValidation.descriptor.bounds.maxX", "input");
  const minY = validateGraphwarWasmFiniteNumber(bounds.minY, "trajectoryValidation.descriptor.bounds.minY", "input");
  const maxY = validateGraphwarWasmFiniteNumber(bounds.maxY, "trajectoryValidation.descriptor.bounds.maxY", "input");
  const boundsRect = validation.stop.boundsRect;
  const rectX = validateGraphwarWasmFiniteNumber(boundsRect.x, "trajectoryValidation.stop.boundsRect.x", "input");
  const rectY = validateGraphwarWasmFiniteNumber(boundsRect.y, "trajectoryValidation.stop.boundsRect.y", "input");
  const rectWidth = validateGraphwarWasmFiniteNumber(
    boundsRect.width,
    "trajectoryValidation.stop.boundsRect.width",
    "input",
  );
  const rectHeight = validateGraphwarWasmFiniteNumber(
    boundsRect.height,
    "trajectoryValidation.stop.boundsRect.height",
    "input",
  );
  if (maxX === minX || maxY === minY || !(rectWidth > 0) || !(rectHeight > 0)) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "smart trajectory coordinate mapping is degenerate",
      "input",
    );
  }
  for (const [index, point] of points.entries()) {
    const expectedPoint = {
      x: minX + ((point.x - rectX) / rectWidth) * (maxX - minX),
      y: maxY - ((point.y - rectY) / rectHeight) * (maxY - minY),
    };
    const descriptorPoint = descriptorPoints[index];
    if (!descriptorPoint || !pointsEqual(descriptorPoint, expectedPoint)) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        `smart trajectory descriptor point ${index} does not match its pixel path point`,
        "input",
      );
    }
  }
  const firstDescriptorPoint = descriptorPoints[0];
  if (!firstDescriptorPoint || !pointsEqual(firstDescriptorPoint, validation.descriptor.soldierCenter)) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "smart trajectory soldier center must match the first formula point",
      "input",
    );
  }
  const [orderedTarget] = validation.stop.orderedTargets;
  if (
    validation.stop.orderedTargets.length !== 1 ||
    validation.stop.requiredTargets.length !== 0 ||
    validation.stop.trackedTargets.length !== 0 ||
    validation.stop.continueAfterTargetsUntilGraphX.type !== "none" ||
    validation.stop.shouldCollectVisiblePixels ||
    !validation.stop.shouldStopOnTargetsComplete ||
    !orderedTarget ||
    !pointsEqual(orderedTarget.center, target) ||
    !Object.is(validateNonNegativeFinite(orderedTarget.radius, "trajectoryValidation.stop.target.radius"), targetRadius)
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "smart trajectory stop policy does not match the single requested target",
      "input",
    );
  }
  const qualityPoints = validatePoints(validation.stop.qualityPoints, "trajectoryValidation.stop.qualityPoints");
  const expectedQualityPoints = descriptorPoints.slice(1, -1);
  if (
    qualityPoints.length !== expectedQualityPoints.length ||
    qualityPoints.some((point, index) => {
      const expectedPoint = expectedQualityPoints[index];
      return expectedPoint === undefined || !pointsEqual(point, expectedPoint);
    })
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "smart trajectory quality points must be the candidate's internal graph points",
      "input",
    );
  }
  return packGraphwarWasmTrajectoryCommandTemplate(runtime, {
    descriptor: validation.descriptor,
    start: { type: "cold" },
    stop: validation.stop,
  });
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
  view.setUint32(smartInput.routePointsX, packed.routePointsX.pointer, true);
  view.setUint32(smartInput.routePointsY, packed.routePointsY.pointer, true);
  view.setUint32(smartInput.routeContext, packed.routeContextPointer, true);
  view.setUint32(smartInput.routeGraphX, packed.routeGraphX.pointer, true);
  view.setUint32(smartInput.trajectoryCommand, packed.trajectoryCommand.pointer, true);
  view.setUint32(smartInput.trajectoryCommandByteLength, packed.trajectoryCommand.byteLength, true);
}

export function copySmartResult(
  runtime: GraphwarWasmMemorySource,
  resultPointer: number,
  input: GraphwarWasmSmartPathfindingInput,
  outputMinimumPointer: number,
): GraphwarWasmSmartPathfindingResult {
  const view = readRecord(
    runtime,
    resultPointer,
    graphwarWasmCompositionLayout.smartResultByteLength,
    8,
    outputMinimumPointer,
  );
  const nestedOutputMinimumPointer = resultPointer + graphwarWasmCompositionLayout.smartResultByteLength;
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
    nestedOutputMinimumPointer,
  );
  const removedPointCount = validateGraphwarWasmU32(
    view.getUint32(smartResult.removedPointCount, true),
    "smart removed point count",
  );
  const validatedInputPoints = validatePoints(input.points, "points");
  const validatedSourcePointCount = validateGraphwarWasmU32(input.sourcePointCount, "sourcePointCount", "input");
  const validatedOriginalPointCount = validatedInputPoints.length;
  if (
    pointCount > validatedOriginalPointCount ||
    removedPointCount > validatedOriginalPointCount ||
    removedPointCount > validatedOriginalPointCount - pointCount ||
    (status === 1 && removedPointCount + pointCount !== validatedOriginalPointCount) ||
    (status === 1 && (pointCount === 0 || pointCount < validatedSourcePointCount)) ||
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
  const failureReason = validateGraphwarWasmEnumValue(
    view.getUint32(smartResult.failureReason, true),
    [
      smartFailureReason.none,
      smartFailureReason.target,
      smartFailureReason.graphRule,
      smartFailureReason.routeObstacle,
      smartFailureReason.trajectory,
    ] as const,
    "smart failure reason",
  );
  if (status === 1 && failureReason !== smartFailureReason.none) {
    throw new GraphwarWasmAdapterError("invalid-session-state", "smart success contains a failure reason", "output");
  }
  const validationRole = validateGraphwarWasmEnumValue(
    view.getUint32(smartResult.validationRole, true),
    [smartValidationRole.none, smartValidationRole.routeOnly, smartValidationRole.trajectory] as const,
    "smart validation role",
  );
  const expectedValidationRole =
    input.trajectoryValidation.type === "trajectory" ? smartValidationRole.trajectory : smartValidationRole.routeOnly;
  const rawTargetX = view.getFloat64(smartResult.targetX, true);
  const rawTargetY = view.getFloat64(smartResult.targetY, true);
  const rawTargetRadius = view.getFloat64(smartResult.targetRadius, true);
  if (status === 1) {
    const targetX = validateGraphwarWasmFiniteNumber(rawTargetX, "smart.target.x");
    const targetY = validateGraphwarWasmFiniteNumber(rawTargetY, "smart.target.y");
    const targetRadius = validateGraphwarWasmFiniteNumber(rawTargetRadius, "smart.target.radius");
    if (
      validationRole !== expectedValidationRole ||
      targetRadius < 0 ||
      !Object.is(targetX, input.target.x) ||
      !Object.is(targetY, input.target.y) ||
      !Object.is(targetRadius, input.targetRadius)
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        "smart success validation role or target identity does not match its request",
        "output",
      );
    }
  } else if (
    validationRole !== smartValidationRole.none ||
    !Object.is(rawTargetX, 0) ||
    !Object.is(rawTargetY, 0) ||
    !Object.is(rawTargetRadius, 0)
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "smart failure retains success-only validation identity",
      "output",
    );
  }
  const isFailureReasonAllowed =
    status === 1
      ? failureReason === smartFailureReason.none
      : input.trajectoryValidation.type === "trajectory"
        ? failureReason === smartFailureReason.graphRule || failureReason === smartFailureReason.trajectory
        : failureReason !== smartFailureReason.trajectory;
  if (!isFailureReasonAllowed) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "smart failure reason does not belong to its validation role",
      "output",
    );
  }
  const detailFlags = validateGraphwarWasmU32(view.getUint32(smartResult.detailFlags, true), "smart detail flags");
  if ((detailFlags & ~smartResultBlockedPointFlag) !== 0) {
    throw new GraphwarWasmAdapterError("invalid-session-state", "smart result contains unsupported details", "output");
  }
  const rawBlockedPointX = view.getFloat64(smartResult.blockedPointX, true);
  const rawBlockedPointY = view.getFloat64(smartResult.blockedPointY, true);
  const hasBlockedPoint = (detailFlags & smartResultBlockedPointFlag) !== 0;
  const blockedPoint = hasBlockedPoint
    ? {
        x: validateGraphwarWasmFiniteNumber(rawBlockedPointX, "smart.blockedPoint.x"),
        y: validateGraphwarWasmFiniteNumber(rawBlockedPointY, "smart.blockedPoint.y"),
      }
    : undefined;
  if (
    (hasBlockedPoint && (status !== 0 || failureReason !== smartFailureReason.trajectory)) ||
    (!hasBlockedPoint && (!Object.is(rawBlockedPointX, 0) || !Object.is(rawBlockedPointY, 0)))
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "smart blocked-point evidence does not match its failure",
      "output",
    );
  }
  const outputInputIndexes: number[] = [];
  if (status === 1) {
    const inputLastPoint = validatedInputPoints.at(-1);
    const outputLastPoint = points.at(-1);
    if (!inputLastPoint || !outputLastPoint || !pointsEqual(inputLastPoint, outputLastPoint)) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "smart result does not preserve the candidate target point",
        "output",
      );
    }
    if (
      input.trajectoryValidation.type === "route-only" &&
      !smartTargetPointMatches(inputLastPoint, input.target, input.targetRadius)
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        "smart result target identity does not satisfy the requested target radius",
        "output",
      );
    }
    for (let index = 0; index < validatedSourcePointCount; index += 1) {
      const inputPoint = validatedInputPoints[index];
      const outputPoint = points[index];
      if (!inputPoint || !outputPoint || !pointsEqual(inputPoint, outputPoint)) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "smart result does not preserve the source prefix",
          "output",
        );
      }
    }
    let inputIndex = 0;
    for (const [outputIndex, outputPoint] of points.entries()) {
      while (inputIndex < validatedOriginalPointCount) {
        const inputPoint = validatedInputPoints[inputIndex];
        if (inputPoint && pointsEqual(inputPoint, outputPoint)) {
          break;
        }
        inputIndex += 1;
      }
      if (inputIndex >= validatedOriginalPointCount) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          `smart result point ${outputIndex} is not an ordered source point`,
          "output",
        );
      }
      outputInputIndexes.push(inputIndex);
      inputIndex += 1;
    }
  }
  const evidenceCount = validateGraphwarWasmU32(
    view.getUint32(smartResult.evidenceCount, true),
    "smart evidence count",
  );
  const hasGraphEvidence =
    input.routeValidationEvidence !== undefined || input.trajectoryValidation.type === "trajectory";
  const expectedEvidenceCount = status === 1 && hasGraphEvidence ? pointCount : 0;
  if (evidenceCount !== expectedEvidenceCount) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "smart result evidence count does not match its validation state",
      "output",
    );
  }
  const outputGraphX = copySessionFloat64Values(
    runtime,
    view.getUint32(smartResult.outputGraphX, true),
    evidenceCount,
    "smart.outputGraphX",
    nestedOutputMinimumPointer,
  );
  const expectedRouteEvidenceCount = status === 1 && input.routeValidationEvidence ? pointCount : 0;
  const outputRoutePoints = copySessionPoints(
    runtime,
    view.getUint32(smartResult.outputRouteX, true),
    view.getUint32(smartResult.outputRouteY, true),
    expectedRouteEvidenceCount,
    "smart.outputRoutePoints",
    nestedOutputMinimumPointer,
  );
  if (status === 1 && hasGraphEvidence) {
    for (const [outputIndex, inputIndex] of outputInputIndexes.entries()) {
      const expectedGraphX =
        input.trajectoryValidation.type === "trajectory"
          ? input.trajectoryValidation.descriptor.points[inputIndex]?.x
          : input.routeValidationEvidence?.graphX[inputIndex];
      if (expectedGraphX === undefined || !Object.is(outputGraphX[outputIndex], expectedGraphX)) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-identity",
          `smart graph evidence ${outputIndex} does not match its source point`,
          "output",
        );
      }
      if (input.routeValidationEvidence) {
        const expectedRoutePoint = input.routeValidationEvidence.points[inputIndex];
        const outputRoutePoint = outputRoutePoints[outputIndex];
        if (!expectedRoutePoint || !outputRoutePoint || !pointsEqual(outputRoutePoint, expectedRoutePoint)) {
          throw new GraphwarWasmAdapterError(
            "invalid-session-identity",
            `smart route evidence ${outputIndex} does not match its source point`,
            "output",
          );
        }
      }
    }
  }
  if (status === 0) {
    const reason =
      failureReason === smartFailureReason.target
        ? "target"
        : failureReason === smartFailureReason.graphRule
          ? "graph-rule"
          : failureReason === smartFailureReason.routeObstacle
            ? "route-obstacle"
            : failureReason === smartFailureReason.trajectory
              ? "trajectory"
              : undefined;
    return {
      ...(blockedPoint ? { blockedPoint } : {}),
      ...(reason === undefined ? {} : { failureReason: reason }),
      points,
      removedPointCount,
      status: "failure",
    };
  }
  return {
    points,
    removedPointCount,
    status: "success",
    validation: {
      target: { center: { x: rawTargetX, y: rawTargetY }, radius: rawTargetRadius },
      type: validationRole === smartValidationRole.trajectory ? "trajectory" : "route-only",
    },
  };
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
  const targetOrderKeys = input.targetOrderKeys
    ? input.targetOrderKeys.map((value, index) => validateGraphwarWasmU32(value, `targetOrderKeys[${index}]`, "input"))
    : [];
  if (targetOrderKeys.length !== 0 && targetOrderKeys.length !== candidates.length) {
    throw new GraphwarWasmAdapterError("invalid-index", "targetOrderKeys must match candidate count", "input");
  }
  const dagJobs = input.dagJobs ? input.dagJobs.map((job, index) => validateDagJob(job, index, candidates.length)) : [];
  const dagNodeCount = input.dagJobs ? validateGraphwarWasmU32(input.dagNodeCount ?? 0, "dagNodeCount", "input") : 0;
  if (input.dagJobs && dagJobs.length > 0 && dagNodeCount === 0) {
    throw new GraphwarWasmAdapterError("invalid-session-state", "dagNodeCount must be positive", "input");
  }
  if (input.dagJobs && dagJobs.length === 0 && dagNodeCount !== 0) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "dagNodeCount must be zero when dagJobs is empty",
      "input",
    );
  }
  const dagEdgeIdentities = new Set<string>();
  for (const [index, job] of dagJobs.entries()) {
    if (
      job.toNodeId >= dagNodeCount ||
      (job.fromNodeId !== oneClickEdgeStartSentinel && job.fromNodeId >= dagNodeCount)
    ) {
      throw new GraphwarWasmAdapterError("invalid-index", `dagJobs[${index}] references an unknown DAG node`, "input");
    }
    const identity = `${job.fromNodeId}:${job.toNodeId}`;
    if (dagEdgeIdentities.has(identity)) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        `dagJobs[${index}] duplicates a DAG node identity`,
        "input",
      );
    }
    dagEdgeIdentities.add(identity);
  }
  validateDagNodeAcyclic(dagJobs);
  if (!input.dagJobs && input.dagNodeCount !== undefined) {
    throw new GraphwarWasmAdapterError("invalid-session-state", "dagNodeCount requires dagJobs", "input");
  }
  const dagNodeIds = new Uint32Array(dagJobs.length * 2);
  dagJobs.forEach((job, index) => {
    dagNodeIds[index * 2] = job.fromNodeId;
    dagNodeIds[index * 2 + 1] = job.toNodeId;
  });
  return {
    candidateFlags: writeGraphwarWasmUint32Values(
      runtime,
      Uint32Array.from(candidates, ({ flags }) => flags),
      runtime.arenaBase,
    ),
    dagJobs: writeOneClickDagJobs(runtime, dagJobs),
    dagNodeCount,
    dagNodeIds: writeGraphwarWasmUint32Values(runtime, dagNodeIds, runtime.arenaBase),
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
      (input.isTargetOrderDescending ? oneClickTargetOrderDescendingFlag : 0) |
      (input.dagJobs ? oneClickExplicitDagFlag : 0),
    path,
    pathX: writeGraphwarWasmFloat64Values(runtime, new Float64Array(path.map(({ x }) => x)), runtime.arenaBase),
    pathY: writeGraphwarWasmFloat64Values(runtime, new Float64Array(path.map(({ y }) => y)), runtime.arenaBase),
    pathCount: path.length,
    requestNonce,
    routeContextPointer: validateOptionalPointer(input.routeContextPointer, "routeContextPointer"),
    targetOrderKeys: writeGraphwarWasmUint32Values(runtime, Uint32Array.from(targetOrderKeys), runtime.arenaBase),
    verticalVariationScale,
  };
}

function validateDagJob(job: GraphwarWasmOneClickDagJob, index: number, targetCount: number) {
  const id = validateGraphwarWasmU32(job.id, `dagJobs[${index}].id`, "input");
  if (id !== index) {
    throw new GraphwarWasmAdapterError("unexpected-work-id", `dagJobs[${index}] id is not stable`, "input");
  }
  const from = job.from === -1 ? -1 : validateGraphwarWasmU32(job.from, `dagJobs[${index}].from`, "input");
  const to = validateGraphwarWasmU32(job.to, `dagJobs[${index}].to`, "input");
  if (to >= targetCount || (from >= 0 && from >= to)) {
    throw new GraphwarWasmAdapterError("invalid-index", `dagJobs[${index}] has invalid target indices`, "input");
  }
  const fromNodeId = validateGraphwarWasmU32(job.fromNodeId, `dagJobs[${index}].fromNodeId`, "input");
  const toNodeId = validateGraphwarWasmU32(job.toNodeId, `dagJobs[${index}].toNodeId`, "input");
  if (toNodeId === oneClickEdgeStartSentinel || (from === -1 && fromNodeId !== oneClickEdgeStartSentinel)) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      `dagJobs[${index}] has invalid start identity`,
      "input",
    );
  }
  if (from >= 0 && (fromNodeId === oneClickEdgeStartSentinel || fromNodeId === toNodeId)) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      `dagJobs[${index}] has invalid source identity`,
      "input",
    );
  }
  return {
    from,
    fromNodeId,
    id,
    startPoint: validatePoint(job.startPoint, `dagJobs[${index}].startPoint`),
    targetPoint: validatePoint(job.targetPoint, `dagJobs[${index}].targetPoint`),
    to,
    toNodeId,
  };
}

function validateDagNodeAcyclic(jobs: readonly ReturnType<typeof validateDagJob>[]) {
  const indegree = new Map<number, number>();
  const outgoing = new Map<number, number[]>();
  for (const job of jobs) {
    if (job.fromNodeId === oneClickEdgeStartSentinel) {
      indegree.set(job.toNodeId, indegree.get(job.toNodeId) ?? 0);
      continue;
    }
    indegree.set(job.fromNodeId, indegree.get(job.fromNodeId) ?? 0);
    indegree.set(job.toNodeId, (indegree.get(job.toNodeId) ?? 0) + 1);
    const successors = outgoing.get(job.fromNodeId);
    if (successors) {
      successors.push(job.toNodeId);
    } else {
      outgoing.set(job.fromNodeId, [job.toNodeId]);
    }
  }
  const ready = Array.from(indegree.entries())
    .filter(([, degree]) => degree === 0)
    .map(([nodeId]) => nodeId);
  let processedCount = 0;
  while (ready.length > 0) {
    const nodeId = ready.pop();
    if (nodeId === undefined) {
      break;
    }
    processedCount += 1;
    for (const successor of outgoing.get(nodeId) ?? []) {
      const nextDegree = (indegree.get(successor) ?? 0) - 1;
      indegree.set(successor, nextDegree);
      if (nextDegree === 0) {
        ready.push(successor);
      }
    }
  }
  if (processedCount !== indegree.size) {
    throw new GraphwarWasmAdapterError("invalid-session-state", "DAG node identities contain a cycle", "input");
  }
}

function writeOneClickDagJobs(runtime: GraphwarWasmKernelRuntime, jobs: readonly ReturnType<typeof validateDagJob>[]) {
  if (jobs.length === 0) {
    return { length: 0, pointer: 0 };
  }
  const pointer = runtime.reserveArena(jobs.length * graphwarWasmCompositionLayout.oneClickEdgeJobByteLength, 8);
  const view = new DataView(
    runtime.buffer,
    pointer,
    jobs.length * graphwarWasmCompositionLayout.oneClickEdgeJobByteLength,
  );
  jobs.forEach((job, index) => {
    const offset = index * graphwarWasmCompositionLayout.oneClickEdgeJobByteLength;
    view.setUint32(offset + oneClickEdgeJob.id, job.id, true);
    view.setUint32(offset + oneClickEdgeJob.from, job.from === -1 ? oneClickEdgeStartSentinel : job.from, true);
    view.setUint32(offset + oneClickEdgeJob.to, job.to, true);
    view.setFloat64(offset + oneClickEdgeJob.startX, job.startPoint.x, true);
    view.setFloat64(offset + oneClickEdgeJob.startY, job.startPoint.y, true);
    view.setFloat64(offset + oneClickEdgeJob.targetX, job.targetPoint.x, true);
    view.setFloat64(offset + oneClickEdgeJob.targetY, job.targetPoint.y, true);
    view.setUint32(offset + oneClickEdgeJob.fromNodeId, job.fromNodeId, true);
    view.setUint32(offset + oneClickEdgeJob.toNodeId, job.toNodeId, true);
  });
  return { length: jobs.length, pointer };
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
  view.setUint32(oneClickInput.targetOrderKeys, packed.targetOrderKeys.pointer, true);
  view.setUint32(oneClickInput.targetOrderKeyCount, packed.targetOrderKeys.length, true);
  view.setUint32(oneClickInput.dagJobs, packed.dagJobs.pointer, true);
  view.setUint32(oneClickInput.dagJobCount, packed.dagJobs.length, true);
  view.setUint32(oneClickInput.dagNodeIds, packed.dagNodeIds.pointer, true);
  view.setUint32(oneClickInput.dagNodeIdCount, packed.dagNodeIds.length, true);
  view.setUint32(oneClickInput.dagNodeCount, packed.dagNodeCount, true);
}

function copyOneClickResult(
  runtime: GraphwarWasmMemorySource,
  resultPointer: number,
  expectedRequestNonce?: number,
  expectedVerticalVariationScale?: number,
  boundary: OneClickOutputBoundary = createOneClickOutputBoundary(runtime.arenaBase),
): DecodedOneClickResult {
  const view = readOneClickRecord(
    runtime,
    resultPointer,
    graphwarWasmCompositionLayout.oneClickResultByteLength,
    8,
    boundary,
    "one-click result",
    "fresh",
  );
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
  const targetOrderPointer = validateGraphwarWasmU32(
    view.getUint32(oneClickResult.targetOrder, true),
    "target order pointer",
  );
  const pathXPointer = validateGraphwarWasmU32(view.getUint32(oneClickResult.pathX, true), "one-click path x pointer");
  const pathYPointer = validateGraphwarWasmU32(view.getUint32(oneClickResult.pathY, true), "one-click path y pointer");
  const pathCount = validateGraphwarWasmU32(view.getUint32(oneClickResult.pathCount, true), "one-click path count");
  const selectedEdgeCount = validateGraphwarWasmU32(
    view.getUint32(oneClickResult.selectedEdgeCount, true),
    "selected edge count",
  );
  const selectedEdgeIdsPointer = validateGraphwarWasmU32(
    view.getUint32(oneClickResult.selectedEdgeIds, true),
    "selected edge ids pointer",
  );
  if (selectedEdgeCount === 0 && selectedEdgeIdsPointer !== 0) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "one-click result has selected edge ids without selected edges",
      "output",
    );
  }
  const selectedEdgeLimit = boundary.retainedSession?.edgeJobCount ?? targetCount;
  if (selectedEdgeCount > selectedEdgeLimit) {
    throw new GraphwarWasmAdapterError(
      "invalid-index",
      "one-click selected edge count exceeds target count or retained edge count",
      "output",
    );
  }
  if (status === 1) {
    if (
      sessionPointer === 0 ||
      edgeJobCount === 0 ||
      edgeJobPointer === 0 ||
      pathXPointer !== 0 ||
      pathYPointer !== 0 ||
      pathCount !== 0 ||
      selectedEdgeCount !== 0 ||
      selectedEdgeIdsPointer !== 0
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
      targetOrderPointer,
      resultRequestNonce,
      expectedVerticalVariationScale,
      createOneClickOutputBoundary(
        boundary.minimumPointer,
        boundary.retainedSession,
        [
          ...boundary.additionalRanges,
          { alignment: 8, length: graphwarWasmCompositionLayout.oneClickSessionByteLength, pointer: sessionPointer },
        ],
        [
          ...boundary.forbiddenRanges,
          { alignment: 8, length: graphwarWasmCompositionLayout.oneClickResultByteLength, pointer: resultPointer },
        ],
        boundary.expectedWork,
      ),
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
      dagNodeCount: session.dagNodeCount,
      edgeJobs: session.edgeJobs,
      retainedSession: session.retainedSession,
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
  const retainedSession = boundary.retainedSession;
  if (retainedSession && resultNonce !== retainedSession.nonce) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "terminal one-click result nonce is stale",
      "output",
    );
  }
  if (status === 2 && selectedEdgeCount !== 0) {
    throw new GraphwarWasmAdapterError("invalid-session-state", "failed one-click result selected an edge", "output");
  }
  const nestedBoundary = createOneClickOutputBoundary(
    boundary.minimumPointer,
    boundary.retainedSession,
    boundary.additionalRanges,
    [
      ...boundary.forbiddenRanges,
      { alignment: 8, length: graphwarWasmCompositionLayout.oneClickResultByteLength, pointer: resultPointer },
    ],
    boundary.expectedWork,
  );
  const terminalRanges = [
    {
      alignment: Uint32Array.BYTES_PER_ELEMENT,
      length: targetCount * Uint32Array.BYTES_PER_ELEMENT,
      pointer: targetOrderPointer,
    },
    {
      alignment: Uint32Array.BYTES_PER_ELEMENT,
      length: selectedEdgeCount * Uint32Array.BYTES_PER_ELEMENT,
      pointer: selectedEdgeIdsPointer,
    },
    {
      alignment: Float64Array.BYTES_PER_ELEMENT,
      length: pathCount * Float64Array.BYTES_PER_ELEMENT,
      pointer: pathXPointer,
    },
    {
      alignment: Float64Array.BYTES_PER_ELEMENT,
      length: pathCount * Float64Array.BYTES_PER_ELEMENT,
      pointer: pathYPointer,
    },
  ].filter(({ length }) => length > 0);
  // A terminal record may legitimately reuse retained session arrays (for example,
  // a normal no-route failure), but its newly published arrays must never alias one
  // another or an unrelated live range.
  assertOneClickRangesDisjoint(terminalRanges, "one-click terminal output", false);
  assertOneClickRangesDisjoint(
    [
      ...boundary.additionalRanges,
      ...(boundary.retainedSession?.ranges ?? []),
      ...boundary.forbiddenRanges,
      ...terminalRanges,
    ].filter(({ length }) => length > 0),
    "one-click terminal output",
  );
  const targetOrder = copyOneClickUint32Values(
    runtime,
    targetOrderPointer,
    targetCount,
    nestedBoundary,
    "one-click target order",
    "session-array",
  );
  validatePermutation(targetOrder, targetCount, "target order");
  if (retainedSession && !oneClickNumberArraysEqual(targetOrder, retainedSession.targetOrder)) {
    throw new GraphwarWasmAdapterError("invalid-session-identity", "terminal target order changed", "output");
  }
  if (retainedSession && targetOrderPointer !== retainedSession.targetOrderPointer) {
    throw new GraphwarWasmAdapterError("invalid-session-identity", "terminal target order pointer changed", "output");
  }
  const selectedEdgeIds = copyOneClickUint32Values(
    runtime,
    selectedEdgeIdsPointer,
    selectedEdgeCount,
    nestedBoundary,
    "selected edge ids",
    "fresh",
  );
  if (status === 2 && selectedEdgeIds.length !== 0) {
    throw new GraphwarWasmAdapterError("invalid-session-state", "failed one-click result selected an edge", "output");
  }
  const path = copyOneClickPoints(
    runtime,
    pathXPointer,
    pathYPointer,
    pathCount,
    nestedBoundary,
    "one-click path",
    retainedSession && status === 2 ? "session-array" : "fresh",
  );
  if (status === 2 && boundary.expectedPath && !oneClickPointsArraysEqual(path, boundary.expectedPath)) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "failed one-click result changed its retained source path",
      "output",
    );
  }
  if (status === 0 && (!retainedSession || selectedEdgeCount === 0 || path.length === 0)) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "completed one-click result has no selected path",
      "output",
    );
  }
  if (retainedSession) {
    validateOneClickTerminalEvidence(
      retainedSession,
      selectedEdgeIds,
      path,
      targetOrder,
      status === 0 ? "complete" : "failure",
      boundary.expectedWork,
    );
  }
  return {
    path,
    selectedEdgeIds: Array.from(selectedEdgeIds),
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
  let currentEdgeJobs = cloneOneClickEdgeJobs(decoded.edgeJobs);
  let currentTargetOrder = Array.from(decoded.targetOrder);
  let currentRetainedSession = decoded.retainedSession;

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
      return cloneOneClickEdgeJobs(currentEdgeJobs);
    },
    nonce,
    requestNonce,
    get targetOrder() {
      return Array.from(currentTargetOrder);
    },
    dagNodeCount: decoded.dagNodeCount,
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
        const outputMinimumPointer = runtime.arenaCursor;
        const resultPointer = runtime.resumeOneClickClear(
          envelopePointer,
          graphwarWasmCompositionLayout.oneClickResumeByteLength,
        );
        const decodedResult = copyOneClickResult(
          runtime,
          resultPointer,
          requestNonce,
          verticalVariationScale,
          createOneClickOutputBoundary(outputMinimumPointer, currentRetainedSession, work.ranges, [], work.results),
        );
        if (decodedResult.status === "waiting-edge-batch") {
          const nextSession = decodedResult.__session;
          if (nextSession.pointer !== sessionPointer || nextSession.nonce !== nonce) {
            throw new GraphwarWasmAdapterError(
              "invalid-session-identity",
              "one-click session identity changed",
              "output",
            );
          }
          currentEdgeJobs = cloneOneClickEdgeJobs(decodedResult.edgeJobs);
          currentTargetOrder = Array.from(decodedResult.targetOrder);
          currentRetainedSession = decodedResult.retainedSession;
          return {
            edgeJobs: cloneOneClickEdgeJobs(decodedResult.edgeJobs),
            handle: this,
            status: "waiting-edge-batch",
            targetOrder: Array.from(decodedResult.targetOrder),
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
): PackedOneClickEdgeResults {
  if (results.length > jobs.length) {
    throw new GraphwarWasmAdapterError(
      "invalid-work-batch",
      "one-click edge result count exceeds the pending session work",
      "input",
    );
  }
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const seen = new Set<number>();
  const ranges: OneClickMemoryRange[] = [];
  const normalizedResults: GraphwarWasmOneClickEdgeResult[] = [];
  const records =
    results.length === 0
      ? 0
      : runtime.reserveArena(results.length * graphwarWasmCompositionLayout.oneClickEdgeResultByteLength, 4);
  if (records !== 0) {
    ranges.push({
      alignment: 4,
      length: results.length * graphwarWasmCompositionLayout.oneClickEdgeResultByteLength,
      pointer: records,
    });
  }
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
    const job = jobsById.get(jobId);
    if (!job) {
      throw new GraphwarWasmAdapterError("unexpected-work-id", `edge result ${jobId} is not in the session`, "input");
    }
    if (seen.has(jobId)) {
      throw new GraphwarWasmAdapterError("duplicate-work-id", `edge result ${jobId} is duplicated`, "input");
    }
    seen.add(jobId);
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
    if (route.length > 0) {
      ranges.push(
        {
          alignment: Float64Array.BYTES_PER_ELEMENT,
          length: route.length * Float64Array.BYTES_PER_ELEMENT,
          pointer: routeX.pointer,
        },
        {
          alignment: Float64Array.BYTES_PER_ELEMENT,
          length: route.length * Float64Array.BYTES_PER_ELEMENT,
          pointer: routeY.pointer,
        },
      );
    }
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
    normalizedResults.push(
      result.reachable
        ? { jobId, reachable: true, requestNonce, route, sessionNonce }
        : { jobId, reachable: false, requestNonce, sessionNonce },
    );
  }
  assertOneClickRangesDisjoint(ranges, "one-click edge work");
  return { count: results.length, pointer: records, ranges, results: normalizedResults };
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
  boundary: OneClickOutputBoundary = createOneClickOutputBoundary(runtime.arenaBase),
) {
  const range = readOneClickRange(
    runtime,
    pointer,
    graphwarWasmCompositionLayout.oneClickSessionByteLength,
    8,
    boundary,
    "one-click session",
    "session",
  );
  const view = new DataView(range.buffer, range.byteOffset, range.byteLength);
  const sessionBoundary = boundary;
  const retainedSession = boundary.retainedSession;
  const sessionArraySource: OneClickRangeSource = retainedSession ? "session-array" : "fresh";
  if (
    retainedSession &&
    retainedSession.nonce !==
      validateGraphwarWasmU32(
        new DataView(runtime.buffer, view.byteOffset, view.byteLength).getUint32(oneClickSession.nonce, true),
        "session nonce",
      )
  ) {
    throw new GraphwarWasmAdapterError("invalid-session-identity", "one-click session nonce changed", "output");
  }
  const retainedPointer = boundary.retainedSession?.pointer;
  if (retainedPointer !== undefined && retainedPointer !== pointer) {
    throw new GraphwarWasmAdapterError("invalid-session-identity", "one-click session pointer changed", "output");
  }
  const readPointer = (offset: number, fieldName: string) =>
    validateGraphwarWasmU32(
      new DataView(runtime.buffer, view.byteOffset, view.byteLength).getUint32(offset, true),
      fieldName,
    );
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
    (flags & ~15) !== 0 ||
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
  const isExplicitDag = (flags & oneClickExplicitDagFlag) !== 0;
  const dagNodeCount = validateGraphwarWasmU32(
    view.getUint32(oneClickSession.nodeCount, true),
    "session DAG node count",
  );
  const targetOrderValue = validateGraphwarWasmU32(
    view.getUint32(oneClickSession.targetOrder, true),
    "session target order pointer",
  );
  if (targetOrderValue !== targetOrderPointer) {
    throw new GraphwarWasmAdapterError("invalid-session-identity", "one-click session target order changed", "output");
  }
  const targetOrder = copyOneClickUint32Values(
    runtime,
    targetOrderValue,
    targetCount,
    sessionBoundary,
    "session target order",
    sessionArraySource,
  );
  validatePermutation(targetOrder, targetCount, "session target order");
  const targetXPointer = readPointer(oneClickSession.targetX, "session target x pointer");
  const targetX = copyOneClickFloat64Values(
    runtime,
    targetXPointer,
    targetCount,
    sessionBoundary,
    "session target x",
    sessionArraySource,
  );
  const targetYPointer = readPointer(oneClickSession.targetY, "session target y pointer");
  const targetY = copyOneClickFloat64Values(
    runtime,
    targetYPointer,
    targetCount,
    sessionBoundary,
    "session target y",
    sessionArraySource,
  );
  const targetRadiusPointer = readPointer(oneClickSession.targetRadius, "session target radius pointer");
  const targetRadius = copyOneClickFloat64Values(
    runtime,
    targetRadiusPointer,
    targetCount,
    sessionBoundary,
    "session target radius",
    sessionArraySource,
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
  const pathXPointer = readPointer(oneClickSession.pathX, "session path x pointer");
  const pathYPointer = readPointer(oneClickSession.pathY, "session path y pointer");
  const path = copyOneClickPoints(
    runtime,
    pathXPointer,
    pathYPointer,
    pathCount,
    sessionBoundary,
    "session path",
    sessionArraySource,
  );
  if (retainedSession) {
    validateOneClickImmutableSessionContent(retainedSession, {
      dagNodeCount,
      flags,
      path,
      targetOrder,
      targetRadius,
      targetX,
      targetY,
    });
  }
  const sessionJobPointer = validateGraphwarWasmU32(
    view.getUint32(oneClickSession.edgeJobs, true),
    "session edge job pointer",
  );
  const sessionJobCount = validateGraphwarWasmU32(
    view.getUint32(oneClickSession.edgeJobCount, true),
    "session edge job count",
  );
  if (sessionJobPointer === 0 || sessionJobCount === 0) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "waiting one-click session has no full edge batch",
      "output",
    );
  }
  if (
    view.getUint32(oneClickSession.resultPathX, true) !== 0 ||
    view.getUint32(oneClickSession.resultPathY, true) !== 0 ||
    view.getUint32(oneClickSession.resultPathCount, true) !== 0
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "waiting one-click session already has a final path",
      "output",
    );
  }
  const completedFlagsPointer = validateGraphwarWasmU32(
    view.getUint32(oneClickSession.completedFlags, true),
    "session completed flags pointer",
  );
  const completedCount = validateGraphwarWasmU32(
    view.getUint32(oneClickSession.completedCount, true),
    "session completed count",
  );
  if (completedFlagsPointer === 0 || completedCount > sessionJobCount) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "one-click session completed state is invalid",
      "output",
    );
  }
  const completedFlagsRange = readOneClickRange(
    runtime,
    completedFlagsPointer,
    sessionJobCount,
    1,
    sessionBoundary,
    "session completed flags",
    sessionArraySource,
  );
  const completedFlags = new Uint8Array(
    completedFlagsRange.buffer,
    completedFlagsRange.byteOffset,
    completedFlagsRange.elementLength,
  ).slice();
  const routeXPointer = readPointer(oneClickSession.route, "session route x pointer");
  const routeCountPointer = readPointer(oneClickSession.routePointCount, "session route point count pointer");
  const routeYPointer = readPointer(oneClickSession.routeCapacity, "session route y pointer");
  const currentSessionRanges = [
    { alignment: 8, length: graphwarWasmCompositionLayout.oneClickSessionByteLength, pointer },
    {
      alignment: 8,
      length: sessionJobCount * graphwarWasmCompositionLayout.oneClickEdgeJobByteLength,
      pointer: sessionJobPointer,
    },
    { alignment: 4, length: targetCount * Uint32Array.BYTES_PER_ELEMENT, pointer: targetOrderValue },
    { alignment: 8, length: targetCount * Float64Array.BYTES_PER_ELEMENT, pointer: targetXPointer },
    { alignment: 8, length: targetCount * Float64Array.BYTES_PER_ELEMENT, pointer: targetYPointer },
    { alignment: 8, length: targetCount * Float64Array.BYTES_PER_ELEMENT, pointer: targetRadiusPointer },
    { alignment: 8, length: pathCount * Float64Array.BYTES_PER_ELEMENT, pointer: pathXPointer },
    { alignment: 8, length: pathCount * Float64Array.BYTES_PER_ELEMENT, pointer: pathYPointer },
    { alignment: 1, length: sessionJobCount, pointer: completedFlagsPointer },
    { alignment: 4, length: sessionJobCount * Uint32Array.BYTES_PER_ELEMENT, pointer: routeXPointer },
    { alignment: 4, length: sessionJobCount * Uint32Array.BYTES_PER_ELEMENT, pointer: routeCountPointer },
    { alignment: 4, length: sessionJobCount * Uint32Array.BYTES_PER_ELEMENT, pointer: routeYPointer },
  ].filter(({ length }) => length > 0);
  assertOneClickRangesDisjoint(currentSessionRanges, "one-click session arrays", false);
  assertOneClickRangesDisjoint(
    [
      ...boundary.additionalRanges,
      ...(boundary.retainedSession?.ranges ?? []),
      ...boundary.forbiddenRanges,
      ...currentSessionRanges,
    ],
    "one-click session arrays",
  );
  if (retainedSession) {
    const expected = {
      completedFlagsPointer,
      edgeJobCount: sessionJobCount,
      edgeJobPointer: sessionJobPointer,
      pathCount,
      pathXPointer,
      pathYPointer,
      routeCountPointer,
      routeXPointer,
      routeYPointer,
      targetOrderPointer: targetOrderValue,
      targetRadiusPointer,
      targetXPointer,
      targetYPointer,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (value !== retainedSession[key as keyof typeof expected]) {
        throw new GraphwarWasmAdapterError("invalid-session-identity", `one-click retained ${key} changed`, "output");
      }
    }
  }
  const routeXByJob = copyOneClickUint32Values(
    runtime,
    routeXPointer,
    sessionJobCount,
    sessionBoundary,
    "session route x",
    sessionArraySource,
  );
  const routeCountByJob = copyOneClickUint32Values(
    runtime,
    routeCountPointer,
    sessionJobCount,
    sessionBoundary,
    "session route point count",
    sessionArraySource,
  );
  const routeYByJob = copyOneClickUint32Values(
    runtime,
    routeYPointer,
    sessionJobCount,
    sessionBoundary,
    "session route y",
    sessionArraySource,
  );
  let observedCompletedCount = 0;
  const completedRoutes: (readonly GraphwarWasmPoint[] | undefined)[] = Array.from(
    { length: sessionJobCount },
    () => undefined,
  );
  for (const [jobId, flag] of completedFlags.entries()) {
    if (flag > 1) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        `session completed flag ${jobId} is not boolean`,
        "output",
      );
    }
    const routeX = routeXByJob[jobId];
    const routeY = routeYByJob[jobId];
    const routeCount = routeCountByJob[jobId];
    if (flag === 0) {
      if (routeX !== 0 || routeY !== 0 || routeCount !== 0) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          `pending edge ${jobId} retains route data`,
          "output",
        );
      }
      continue;
    }
    observedCompletedCount += 1;
    if (routeCount === 0) {
      if (routeX !== 0 || routeY !== 0) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          `unreachable edge ${jobId} retains route data`,
          "output",
        );
      }
      continue;
    }
    if (routeX === 0 || routeY === 0 || routeCount < 2) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        `completed edge ${jobId} has no valid route`,
        "output",
      );
    }
    if (retainedSession) {
      const retainedRoute = retainedSession.routesByJob[jobId];
      if (retainedRoute && (routeX !== retainedRoute.xPointer || routeY !== retainedRoute.yPointer)) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-identity",
          `completed edge ${jobId} route pointers changed while resuming`,
          "output",
        );
      }
    }
    completedRoutes[jobId] = copyOneClickPoints(
      runtime,
      routeX,
      routeY,
      routeCount,
      sessionBoundary,
      `session route ${jobId}`,
      sessionArraySource,
    );
  }
  if (observedCompletedCount !== completedCount) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "one-click session completed count does not match its flags",
      "output",
    );
  }
  const pendingCount = sessionJobCount - completedCount;
  if (edgeJobCount !== pendingCount || (pendingCount === 0 ? edgeJobPointer !== 0 : edgeJobPointer === 0)) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "one-click result does not contain exactly the pending edge batch",
      "output",
    );
  }
  const fullEdgeJobs = copyEdgeJobs(
    runtime,
    sessionJobPointer,
    sessionJobCount,
    targetCount,
    targetOrder,
    targetX,
    targetY,
    path,
    dagNodeCount,
    isExplicitDag,
    { boundary: sessionBoundary, isStableJobIdRequired: true, jobIdLimit: sessionJobCount, source: sessionArraySource },
  );
  const edgeJobs = copyEdgeJobs(
    runtime,
    edgeJobPointer,
    edgeJobCount,
    targetCount,
    targetOrder,
    targetX,
    targetY,
    path,
    dagNodeCount,
    isExplicitDag,
    { boundary: sessionBoundary, isStableJobIdRequired: false, jobIdLimit: sessionJobCount, source: "fresh" },
  );
  const fullJobsById = new Map(fullEdgeJobs.map((job) => [job.id, job]));
  if (retainedSession) {
    validateOneClickRetainedContent(
      retainedSession,
      {
        completedCount,
        completedFlags: Array.from(completedFlags),
        completedRoutes,
        dagNodeCount,
        edgeJobs: fullEdgeJobs,
        flags,
        path,
        targetOrder,
        targetRadius,
        targetX,
        targetY,
      },
      boundary.expectedWork ?? [],
    );
  }
  const pendingIds = new Set<number>();
  for (const job of edgeJobs) {
    if (completedFlags[job.id] !== 0) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        `completed edge ${job.id} was returned in the pending batch`,
        "output",
      );
    }
    const fullJob = fullJobsById.get(job.id);
    if (
      !fullJob ||
      fullJob.from !== job.from ||
      fullJob.to !== job.to ||
      fullJob.startPoint.x !== job.startPoint.x ||
      fullJob.startPoint.y !== job.startPoint.y ||
      fullJob.targetPoint.x !== job.targetPoint.x ||
      fullJob.targetPoint.y !== job.targetPoint.y ||
      fullJob.fromNodeId !== job.fromNodeId ||
      fullJob.toNodeId !== job.toNodeId
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        `pending edge ${job.id} does not match its retained descriptor`,
        "output",
      );
    }
    pendingIds.add(job.id);
  }
  for (const [jobId, flag] of completedFlags.entries()) {
    if ((flag === 0) !== pendingIds.has(jobId)) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        `pending edge batch is missing edge ${jobId}`,
        "output",
      );
    }
  }
  if (!isExplicitDag && dagNodeCount !== targetCount) {
    throw new GraphwarWasmAdapterError("invalid-session-identity", "one-click session node count changed", "output");
  }
  if (isExplicitDag && dagNodeCount === 0) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "explicit one-click session has no DAG nodes",
      "output",
    );
  }
  const retainedRanges: OneClickMemoryRange[] = [
    { alignment: 8, length: graphwarWasmCompositionLayout.oneClickSessionByteLength, pointer },
    {
      alignment: 8,
      length: sessionJobCount * graphwarWasmCompositionLayout.oneClickEdgeJobByteLength,
      pointer: sessionJobPointer,
    },
    { alignment: 4, length: targetCount * Uint32Array.BYTES_PER_ELEMENT, pointer: targetOrderValue },
    { alignment: 8, length: targetCount * Float64Array.BYTES_PER_ELEMENT, pointer: targetXPointer },
    { alignment: 8, length: targetCount * Float64Array.BYTES_PER_ELEMENT, pointer: targetYPointer },
    { alignment: 8, length: targetCount * Float64Array.BYTES_PER_ELEMENT, pointer: targetRadiusPointer },
    { alignment: 8, length: pathCount * Float64Array.BYTES_PER_ELEMENT, pointer: pathXPointer },
    { alignment: 8, length: pathCount * Float64Array.BYTES_PER_ELEMENT, pointer: pathYPointer },
    { alignment: 1, length: sessionJobCount, pointer: completedFlagsPointer },
    { alignment: 4, length: sessionJobCount * Uint32Array.BYTES_PER_ELEMENT, pointer: routeXPointer },
    { alignment: 4, length: sessionJobCount * Uint32Array.BYTES_PER_ELEMENT, pointer: routeCountPointer },
    { alignment: 4, length: sessionJobCount * Uint32Array.BYTES_PER_ELEMENT, pointer: routeYPointer },
  ].filter(({ length }) => length > 0);
  for (const [jobId, flag] of completedFlags.entries()) {
    if (flag !== 1) continue;
    const routeCount = routeCountByJob[jobId];
    if (routeCount === 0) continue;
    const routeX = routeXByJob[jobId];
    const routeY = routeYByJob[jobId];
    retainedRanges.push(
      { alignment: 8, length: routeCount * Float64Array.BYTES_PER_ELEMENT, pointer: routeX },
      { alignment: 8, length: routeCount * Float64Array.BYTES_PER_ELEMENT, pointer: routeY },
    );
  }
  assertOneClickRangesDisjoint(retainedRanges, "one-click retained session", false);
  assertOneClickRangesDisjoint(
    [
      ...boundary.additionalRanges,
      ...(boundary.retainedSession?.ranges ?? []),
      ...boundary.forbiddenRanges,
      ...retainedRanges,
    ].filter(({ length }) => length > 0),
    "one-click retained session",
  );
  for (const retainedRange of retainedRanges) {
    validateGraphwarWasmMemoryRange(
      runtime,
      { pointer: retainedRange.pointer, length: retainedRange.length },
      {
        alignment: retainedRange.alignment,
        elementByteLength: 1,
        minimumPointer: runtime.arenaBase,
        sliceFaultDomain: "output",
      },
    );
  }
  const routesByJob = completedRoutes.map((points, jobId) =>
    points
      ? {
          points,
          xPointer: routeXByJob[jobId] ?? 0,
          yPointer: routeYByJob[jobId] ?? 0,
        }
      : undefined,
  );
  return {
    dagNodeCount,
    edgeJobs,
    nonce,
    pointer,
    requestNonce,
    retainedSession: {
      completedFlags: Array.from(completedFlags),
      completedFlagsPointer,
      completedCount,
      completedRoutes,
      edgeJobCount: sessionJobCount,
      edgeJobPointer: sessionJobPointer,
      edgeJobs: fullEdgeJobs,
      flags,
      isExplicitDag,
      dagNodeCount,
      nonce,
      pathCount,
      pathXPointer,
      pathYPointer,
      pointer,
      ranges: retainedRanges,
      path,
      requestNonce,
      routeCountByJob: Array.from(routeCountByJob),
      routesByJob,
      routeCountPointer,
      routeXPointer,
      routeYPointer,
      targetOrderPointer: targetOrderValue,
      targetOrder: Array.from(targetOrder),
      targetRadiusPointer,
      targetRadius: Array.from(targetRadius),
      targetXPointer,
      targetX: Array.from(targetX),
      targetYPointer,
      targetY: Array.from(targetY),
    },
    targetOrder,
  };
}

function copyEdgeJobs(
  runtime: GraphwarWasmMemorySource,
  pointer: number,
  count: number,
  targetCount: number,
  targetOrder: readonly number[],
  targetX: readonly number[],
  targetY: readonly number[],
  path: readonly GraphwarWasmPoint[],
  dagNodeCount: number,
  isExplicitDag: boolean,
  options: {
    readonly boundary?: OneClickOutputBoundary;
    readonly isStableJobIdRequired: boolean;
    readonly jobIdLimit: number;
    readonly source?: OneClickRangeSource;
  },
): GraphwarWasmOneClickEdgeJob[] {
  const range = readOneClickRange(
    runtime,
    pointer,
    count * graphwarWasmCompositionLayout.oneClickEdgeJobByteLength,
    8,
    options.boundary ?? createOneClickOutputBoundary(runtime.arenaBase),
    "edge jobs",
    options.source ?? "fresh",
  );
  const view = new DataView(range.buffer, range.byteOffset, range.byteLength);
  const jobIds = new Set<number>();
  const edgeIdentities = new Set<string>();
  return Array.from({ length: count }, (_, index) => {
    const offset = index * graphwarWasmCompositionLayout.oneClickEdgeJobByteLength;
    const id = validateGraphwarWasmU32(view.getUint32(offset + oneClickEdgeJob.id, true), `edgeJobs[${index}].id`);
    const fromValue = view.getUint32(offset + oneClickEdgeJob.from, true);
    const from =
      fromValue === oneClickEdgeStartSentinel ? -1 : validateGraphwarWasmU32(fromValue, `edgeJobs[${index}].from`);
    const to = validateGraphwarWasmU32(view.getUint32(offset + oneClickEdgeJob.to, true), `edgeJobs[${index}].to`);
    const fromNodeId = validateGraphwarWasmU32(
      view.getUint32(offset + oneClickEdgeJob.fromNodeId, true),
      `edgeJobs[${index}].fromNodeId`,
    );
    const toNodeId = validateGraphwarWasmU32(
      view.getUint32(offset + oneClickEdgeJob.toNodeId, true),
      `edgeJobs[${index}].toNodeId`,
    );
    if (id >= options.jobIdLimit || (options.isStableJobIdRequired && id !== index) || jobIds.has(id)) {
      throw new GraphwarWasmAdapterError(
        options.isStableJobIdRequired ? "unexpected-work-id" : "duplicate-work-id",
        `edge job ${id} does not have a unique retained identity`,
        "output",
      );
    }
    jobIds.add(id);
    if (
      to >= targetCount ||
      (from >= 0 && (from >= targetCount || from >= to)) ||
      toNodeId === oneClickEdgeStartSentinel ||
      toNodeId >= dagNodeCount ||
      (from < 0 && fromNodeId !== oneClickEdgeStartSentinel) ||
      (from >= 0 &&
        (fromNodeId === oneClickEdgeStartSentinel || fromNodeId >= dagNodeCount || fromNodeId === toNodeId)) ||
      (!isExplicitDag && (fromNodeId !== fromValue || toNodeId !== to))
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        `edge job ${index} has invalid DAG indices`,
        "output",
      );
    }
    if (isExplicitDag) {
      const identity = `${fromNodeId}:${toNodeId}`;
      if (edgeIdentities.has(identity)) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-identity",
          `edge job ${index} duplicates a DAG node identity`,
          "output",
        );
      }
      edgeIdentities.add(identity);
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
      ...(isExplicitDag ? { fromNodeId, toNodeId } : {}),
    };
  });
}

function copyPointSoA(
  runtime: GraphwarWasmMemorySource,
  xPointer: number,
  yPointer: number,
  count: number,
  minimumPointer = runtime.arenaBase,
) {
  const xs = copyGraphwarWasmFloat64Values(runtime, { pointer: xPointer, length: count }, minimumPointer, "output");
  const ys = copyGraphwarWasmFloat64Values(runtime, { pointer: yPointer, length: count }, minimumPointer, "output");
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
  minimumPointer = runtime.arenaBase,
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
  const values = copyGraphwarWasmFloat64Values(runtime, { pointer, length: count }, minimumPointer, "output");
  return Float64Array.from(values, (value, index) => validateGraphwarWasmFiniteNumber(value, `${fieldName}[${index}]`));
}

function copySessionPoints(
  runtime: GraphwarWasmMemorySource,
  xPointer: number,
  yPointer: number,
  count: number,
  fieldName: string,
  minimumPointer = runtime.arenaBase,
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
  const xs = copySessionFloat64Values(runtime, xPointer, count, `${fieldName}.x`, minimumPointer);
  const ys = copySessionFloat64Values(runtime, yPointer, count, `${fieldName}.y`, minimumPointer);
  return Array.from(xs, (x, index) => ({ x, y: ys[index] }));
}

function pointsEqual(left: GraphwarWasmPoint, right: GraphwarWasmPoint) {
  return Object.is(left.x, right.x) && Object.is(left.y, right.y);
}

function smartTargetPointMatches(point: GraphwarWasmPoint, target: GraphwarWasmPoint, targetRadius: number) {
  const deltaX = point.x - target.x;
  const deltaY = point.y - target.y;
  const distanceSquared = deltaX * deltaX + deltaY * deltaY;
  return targetRadius === 0 ? distanceSquared === 0 : distanceSquared <= targetRadius * targetRadius;
}

function readRecord(
  runtime: GraphwarWasmMemorySource,
  pointer: number,
  byteLength: number,
  alignment: number,
  minimumPointer = runtime.arenaBase,
) {
  const range = validateGraphwarWasmMemoryRange(
    runtime,
    { pointer, length: byteLength },
    { alignment, elementByteLength: 1, minimumPointer, sliceFaultDomain: "output" },
  );
  return new DataView(range.buffer, range.byteOffset, range.byteLength);
}

function validatePoints(points: readonly GraphwarWasmPoint[], fieldName: string) {
  return points.map((point, index) => validatePoint(point, `${fieldName}[${index}]`));
}

function validateRouteValidationPoints(points: readonly GraphwarWasmPoint[]) {
  return points.map((point, index) => {
    const validated = validatePoint(point, `routeValidationPoints[${index}]`);
    if (
      !Number.isInteger(validated.x) ||
      !Number.isInteger(validated.y) ||
      validated.x < -2_147_483_648 ||
      validated.x > 2_147_483_647 ||
      validated.y < -2_147_483_648 ||
      validated.y > 2_147_483_647
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-index",
        `routeValidationPoints[${index}] must contain signed 32-bit integer coordinates`,
        "input",
      );
    }
    return validated;
  });
}

function validateRouteValidationGraphX(values: readonly number[]) {
  return values.map((value, index) =>
    validateGraphwarWasmFiniteNumber(value, `routeValidationGraphX[${index}]`, "input"),
  );
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

function validatePermutation(values: ArrayLike<number>, length: number, fieldName: string) {
  if (values.length !== length) {
    throw new GraphwarWasmAdapterError("invalid-index", `${fieldName} is not a permutation`, "output");
  }
  const seen = new Uint8Array(length);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined || !Number.isInteger(value) || value < 0 || value >= length || seen[value] !== 0) {
      throw new GraphwarWasmAdapterError("invalid-index", `${fieldName}[${index}] is not a permutation`, "output");
    }
    seen[value] = 1;
  }
}
