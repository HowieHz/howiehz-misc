import { buildFormula } from "../../formula/generation/build";
import { createStepOverflowProtectionRange } from "../../formula/generation/step-numeric-strategy";
import type { GraphwarTrajectoryFormulaContext } from "../../formula/trajectory/sampling";
import { snapshotGraphwarVisibleTrajectoryPoints } from "../../formula/trajectory/visible-points";
import type { BoundsRect } from "../types";
import { createGraphPoint, createPixelPoint, type PixelPoint } from "../types";
import {
  GraphwarWasmAdapterError,
  copyGraphwarWasmFloat64Values,
  copyGraphwarWasmUint32Values,
  validateGraphwarWasmEnumValue,
  validateGraphwarWasmFiniteNumber,
  validateGraphwarWasmMemoryRange,
  validateGraphwarWasmPathError,
  validateGraphwarWasmU32,
  writeGraphwarWasmBytes,
  writeGraphwarWasmFloat64Values,
  writeGraphwarWasmUint32Values,
  type GraphwarWasmMemorySource,
} from "./abi";
import {
  packGraphwarWasmTrajectoryCommandTemplate,
  prepareGraphwarWasmFormulaLaunch,
  runGraphwarWasmTrajectory,
  type GraphwarWasmFormulaLaunchResult,
  type GraphwarWasmTrajectoryResult,
} from "./formula-adapter";
import type { GraphwarWasmKernelRuntime } from "./runtime";
import {
  graphwarWasmRouteContextByteLength,
  type GraphwarWasmFormulaInputDescriptor,
  type GraphwarWasmPoint,
  type GraphwarWasmStopPolicy,
} from "./task-adapter";

/** Versioned flat records shared by the AssemblyScript composition exports. */
export const graphwarWasmCompositionLayout = {
  oneClickEdgeJobByteLength: 56,
  oneClickEdgeResultByteLength: 48,
  oneClickInputByteLength: 96,
  oneClickInputEvidenceByteLength: 120,
  oneClickResultByteLength: 64,
  oneClickResumeByteLength: 16,
  oneClickSessionByteLength: 160,
  oneClickTargetAssignmentInputByteLength: 120,
  oneClickTargetAssignmentResultByteLength: 24,
  smartInputByteLength: 88,
  smartResultByteLength: 112,
  oneClickStepStateDedupInputByteLength: 40,
  oneClickStepStateDedupResultByteLength: 16,
  oneClickStepDagExpansionInputByteLength: 64,
  oneClickStepDagExpansionResultByteLength: 16,
  oneClickStepDagExpansionJobByteLength: 48,
  oneClickIncumbentCompareInputByteLength: 56,
  oneClickIncumbentCompareResultByteLength: 12,
  oneClickIncumbentEventInputByteLength: 56,
  oneClickIncumbentEventSessionByteLength: 56,
  oneClickIncumbentEventResultByteLength: 20,
} as const;

const smartInputMagic = 0x534d_4152;
const smartInputVersion = 4;
const smartInputDeleteOptimizationFlag = 1;
const smartInputRouteContextValidationFlag = 2;
const smartInputGraphValidationFlag = 4;
const smartInputTrajectoryValidationFlag = 8;
const smartInputTerminalPointDeletionFlag = 16;
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
const oneClickRouteValidationNone = 0;
const oneClickRouteValidationValidated = 1;
const oneClickTargetAssignmentInputMagic = 0x4f_4341_53;
const oneClickTargetAssignmentInputVersion = 1;
const oneClickTargetAssignmentMirroredFlag = 1;
const oneClickTargetAssignmentResultMagic = 0x4f_4341_52;
// Route commands 1..10 and Step-glitch commands 11..20 share runRouteTask.
const oneClickStepStateDedupCommand = 21;
const oneClickStepStateDedupMagic = 0x4f_4344_50;
const oneClickStepStateDedupVersion = 1;
const oneClickStepDagExpansionCommand = 22;
const oneClickStepDagExpansionMagic = 0x4f_434a_45;
const oneClickStepDagExpansionVersion = 1;
const oneClickStepDagExpansionStartFlag = 1;
const oneClickIncumbentCompareCommand = 24;
const oneClickIncumbentCompareMagic = 0x4f_4349_43;
const oneClickIncumbentCompareVersion = 1;
const oneClickIncumbentCompareInputAlignmentReservedOffset = 36;
const oneClickIncumbentCompareInputReservedOffset = 52;
const oneClickIncumbentEventCommand = 26;
const oneClickIncumbentEventMagic = 0x4f_4349_45;
const oneClickIncumbentEventVersion = 1;
const oneClickIncumbentEventBeginOperation = 1;
const oneClickIncumbentEventConsiderOperation = 2;
const oneClickIncumbentEventInputSessionPointerOffset = 12;
const oneClickIncumbentEventInputRequestNonceOffset = 16;
const oneClickIncumbentEventInputAttemptIdOffset = 20;
const oneClickIncumbentEventInputGenerationOffset = 24;
const oneClickIncumbentEventInputOuterTaskIdOffset = 28;
const oneClickIncumbentEventInputCandidateTargetCountOffset = 32;
const oneClickIncumbentEventInputCandidatePointCountOffset = 36;
const oneClickIncumbentEventInputCandidatePathErrorOffset = 40;
const oneClickIncumbentEventInputCandidatePathErrorFlagOffset = 48;
const oneClickIncumbentEventInputReservedOffset = 52;

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
  protectedPointIndexes: 80,
  protectedPointIndexCount: 84,
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
  reachedRequiredTargetCount: 96,
  reachedTargetCount: 100,
  sourcePointIndexes: 104,
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
  dagNodeTargets: 92,
  dagNodeResolvedY: 96,
  dagNodeKeyOffsets: 100,
  dagNodeKeyLengths: 104,
  dagNodeKeyBytes: 108,
  dagNodeKeyByteLength: 112,
  dagNodeEvidenceCount: 116,
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
  routeValidation: 56,
  removedPointCount: 60,
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
  stateKey: 28,
  stateKeyLength: 32,
  targetIndex: 36,
  resolvedY: 40,
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
  routeContext: 108,
  nodeTargets: 120,
  nodeResolvedY: 124,
  nodeKeyOffsets: 128,
  nodeKeyLengths: 132,
  nodeKeyBytes: 136,
  nodeKeyByteLength: 140,
  nodeEvidenceCount: 144,
  layerCursor: 148,
} as const;

const oneClickResume = {
  session: 0,
  nonce: 4,
  work: 8,
  workCount: 12,
} as const;

const oneClickTargetAssignmentInput = {
  flags: 8,
  candidateX: 12,
  candidateY: 16,
  candidateRadius: 20,
  candidateSourceIndex: 24,
  candidateCount: 28,
  pathTailX: 32,
  pathTailY: 40,
  boundsRectX: 48,
  boundsRectY: 56,
  boundsRectWidth: 64,
  boundsRectHeight: 72,
  usableRectX: 80,
  usableRectY: 88,
  usableRectWidth: 96,
  usableRectHeight: 104,
  boundaryExpansion: 112,
} as const;

const oneClickTargetAssignmentResult = {
  magic: 0,
  status: 4,
  sourceIndex: 8,
  routeX: 12,
  routeY: 16,
  count: 20,
} as const;

const oneClickStepStateDedupInput = {
  targetIndexes: 8,
  keyOffsets: 12,
  keyBytes: 16,
  keyLengths: 20,
  resolvedY: 24,
  count: 28,
  keyByteLength: 32,
} as const;

const oneClickStepStateDedupResult = {
  magic: 0,
  status: 4,
  nodeIds: 8,
  nodeCount: 12,
} as const;

const oneClickStepDagExpansionInput = {
  flags: 8,
  targetX: 12,
  targetY: 16,
  targetGraphX: 20,
  targetCount: 24,
  sourceNodeIds: 28,
  sourceTargets: 32,
  sourceCount: 36,
  startX: 40,
  startY: 48,
  nodeCount: 56,
} as const;

const oneClickStepDagExpansionResult = {
  magic: 0,
  status: 4,
  jobs: 8,
  jobCount: 12,
} as const;

const oneClickStepDagExpansionJob = {
  id: 0,
  fromNodeId: 4,
  fromTargetIndex: 8,
  toTargetIndex: 12,
  startX: 16,
  startY: 24,
  targetX: 32,
  targetY: 40,
} as const;

interface GraphwarWasmSmartPathfindingInputBase {
  /** One-click routes may stop on a target before their terminal control point. */
  readonly allowTerminalPointDeletion?: boolean;
  readonly isDeleteOptimizationEnabled: boolean;
  readonly points: readonly GraphwarWasmPoint[];
  /** Number of ordered targets that belong to an already-proven prefix. */
  readonly prefixTargetCount?: number;
  /** Source indexes that candidate deletion must preserve, such as target anchors. */
  readonly protectedPointIndexes?: readonly number[];
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

/**
 * One-click ordinary composition input. The smart kernel owns the candidate deletion/replay loop; the adapter owns the
 * final evidence copy and binds it to the path returned by that same attempt.
 */
export interface GraphwarWasmOneClickTrajectoryCompositionInput {
  /** Allow the trajectory-aware kernel to remove the final generated point. */
  readonly allowTerminalPointDeletion?: boolean;
  readonly isDeleteOptimizationEnabled: boolean;
  readonly points: readonly GraphwarWasmPoint[];
  /** Ordered-target count already proven by the retained prefix; excluded from failure-edge progress. */
  readonly prefixTargetCount?: number;
  readonly sourcePointCount: number;
  /** Optional anchors that must remain an ordered subsequence of the result. */
  readonly targetAnchors?: readonly GraphwarWasmPoint[];
  /** Source indexes for `targetAnchors`; binds repeated coordinates to one occurrence. */
  readonly targetAnchorIndexes?: readonly number[];
  readonly trajectoryValidation: GraphwarWasmSmartTrajectoryValidation;
  /**
   * Retained route contexts provide their own route identity/evidence. This callback is intentionally local to the
   * adapter boundary; it is never sent through the WASM ABI as a business callback.
   */
  readonly runSmartPathfinding?: (
    input: Omit<
      Extract<
        GraphwarWasmSmartPathfindingInput,
        { readonly trajectoryValidation: GraphwarWasmSmartTrajectoryValidation }
      >,
      "routeContextPointer" | "routeValidationEvidence"
    >,
  ) => GraphwarWasmSmartPathfindingResult;
  readonly routeContextPointer?: number;
  readonly routeValidationEvidence?: GraphwarWasmSmartRouteValidationEvidence;
}

/**
 * Incumbent-ready evidence copied from one successful final replay. The selected path, formula context, and visible
 * trajectory are kept in one payload so callers cannot rebuild an incumbent by combining separate attempts.
 */
export interface GraphwarWasmOneClickTrajectoryIncumbentEvidence {
  readonly formulaContext: GraphwarTrajectoryFormulaContext;
  readonly path: readonly PixelPoint[];
  /** Input-path indexes retained by the successful smart composition. */
  readonly sourcePointIndexes: readonly number[];
  readonly trajectory: GraphwarWasmTrajectoryResult;
  readonly trajectoryPoints: readonly PixelPoint[];
}

export type GraphwarWasmOneClickTrajectoryCompositionResult =
  | {
      readonly reachedTargetCount?: number;
      readonly reason: "graph-rule" | "route-obstacle" | "target" | "trajectory";
      readonly status: "failure";
    }
  | {
      readonly formula: Extract<GraphwarWasmFormulaLaunchResult, { status: "success" }>;
      readonly incumbentEvidence: GraphwarWasmOneClickTrajectoryIncumbentEvidence;
      readonly path: readonly GraphwarWasmPoint[];
      readonly removedPointCount: number;
      readonly targetAnchors: readonly GraphwarWasmPoint[];
      readonly targetOrder: readonly GraphwarWasmPoint[];
      readonly trajectory: GraphwarWasmTrajectoryResult;
      readonly status: "success";
      /** Input-path indexes retained by the successful composition. */
      readonly sourcePointIndexes: readonly number[];
    };

export interface GraphwarWasmSmartRouteValidationEvidence {
  /** Forward-plane integer points used only by the retained route-context validator. */
  readonly points: readonly GraphwarWasmPoint[];
  /** Continuous Graphwar x values paired by index with `points`. */
  readonly graphX: readonly number[];
}

/**
 * One-click normal DAG validation uses the same multi-target trajectory command as the standalone trajectory Worker.
 * Keeping this boundary here prevents the search module from rebuilding formula materials or sampling a TS candidate
 * after the WASM edge composition has selected it.
 */
export interface GraphwarWasmOneClickTrajectoryValidationInput {
  readonly descriptor: GraphwarWasmFormulaInputDescriptor;
  readonly stop: Extract<GraphwarWasmStopPolicy, { type: "targets" }>;
}

export interface GraphwarWasmOneClickTrajectoryValidationResult {
  readonly formula: Extract<GraphwarWasmFormulaLaunchResult, { status: "success" }>;
  readonly trajectory: GraphwarWasmTrajectoryResult;
}

export type GraphwarWasmSmartPathfindingResult =
  | {
      readonly blockedPoint?: GraphwarWasmPoint;
      readonly failureReason?: "graph-rule" | "route-obstacle" | "target" | "trajectory";
      readonly reachedRequiredTargetCount: number;
      readonly reachedTargetCount: number;
      readonly points: readonly GraphwarWasmPoint[];
      readonly removedPointCount: number;
      readonly status: "failure";
    }
  | {
      readonly reachedRequiredTargetCount: number;
      readonly reachedTargetCount: number;
      readonly points: readonly GraphwarWasmPoint[];
      readonly removedPointCount: number;
      /** Source indexes for `points`, in strictly increasing input order. */
      readonly sourcePointIndexes: readonly number[];
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

/** Raw candidate identity and hit circle consumed by the WASM assignment command. */
export interface GraphwarWasmOneClickTargetAssignmentCandidate {
  readonly center: GraphwarWasmPoint;
  readonly hitRadius: number;
  readonly sourceIndex: number;
}

/** Versioned target-assignment input; all geometry is screenshot-pixel based. */
export interface GraphwarWasmOneClickTargetAssignmentInput {
  readonly boundaryExpansion: number;
  readonly boundsRect: BoundsRect;
  readonly candidates: readonly GraphwarWasmOneClickTargetAssignmentCandidate[];
  readonly isMirrored: boolean;
  readonly pathTail: GraphwarWasmPoint;
  readonly usableRect: BoundsRect;
}

/** Ordered assignment result; sourceIndex is the caller-owned candidate identity. */
export interface GraphwarWasmOneClickTargetAssignmentResult {
  /** Candidate hit geometry retained by the adapter for the returned source identity. */
  readonly hitCenter: GraphwarWasmPoint;
  readonly hitRadius: number;
  readonly routePoint: GraphwarWasmPoint;
  readonly sourceIndex: number;
}

export interface GraphwarWasmOneClickClearInput {
  readonly candidates: readonly GraphwarWasmOneClickCandidate[];
  /** Optional full DAG descriptor; when present WASM consumes these jobs verbatim. */
  readonly dagJobs?: readonly GraphwarWasmOneClickDagJob[];
  /** Atomic Step node evidence paired by node id with an explicit stateful DAG. */
  readonly dagNodeEvidence?: readonly GraphwarWasmOneClickStepStateEvidence[];
  /** Optional legacy upper bound for interned DAG nodes; omitted values are derived from job identities. */
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

/** Canonical Step node evidence; WASM owns target/state identity interning. */
export interface GraphwarWasmOneClickStepStateEvidence {
  readonly resolvedStateKey: string;
  readonly resolvedY: number;
  readonly targetIndex: number;
}

/** Target geometry and source-node identities consumed by one bounded stateful DAG expansion. */
export interface GraphwarWasmOneClickStepDagExpansionInput {
  readonly isStartExpansion: boolean;
  readonly nodeCount: number;
  readonly sourceNodes: readonly {
    readonly nodeId: number;
    readonly targetIndex: number;
  }[];
  readonly startPoint: GraphwarWasmPoint;
  readonly targets: readonly {
    readonly graphX: number;
    readonly routePoint: GraphwarWasmPoint;
  }[];
}

/** Stable edge descriptor emitted by the bounded stateful DAG expansion command. */
export interface GraphwarWasmOneClickStepDagExpansionJob {
  readonly fromNodeId: number;
  readonly fromTargetIndex: number;
  readonly id: number;
  readonly startPoint: GraphwarWasmPoint;
  readonly targetPoint: GraphwarWasmPoint;
  readonly toTargetIndex: number;
}

export interface GraphwarWasmOneClickStepStateInternResult {
  /** Stable node id for each input record, assigned by first occurrence. */
  readonly nodeIds: readonly number[];
  readonly nodeCount: number;
}

/**
 * Incremental terminal-state merge owned by the WASM composition boundary. `batchNodeIds` is aligned with the newly
 * completed edge routes; `newNodes` contains only first occurrences that extend the retained evidence table.
 */
export interface GraphwarWasmOneClickStepStateMergeResult {
  readonly batchNodeIds: readonly number[];
  readonly newNodes: readonly {
    readonly evidence: GraphwarWasmOneClickStepStateEvidence;
    readonly id: number;
  }[];
  readonly nodeCount: number;
}

/** One edge-worker result; absence of successor evidence is the normal unreachable business result. */
export interface GraphwarWasmOneClickStepStateEdgeResult {
  readonly jobId: number;
  readonly successor?: GraphwarWasmOneClickStepStateEvidence;
}

/** Complete retained Step layer batch. Jobs and results must have the same stable identity set. */
export interface GraphwarWasmOneClickStepStateLayerInput {
  readonly jobs: readonly { readonly id: number; readonly targetIndex: number }[];
  readonly layerIndex: number;
  readonly results: readonly GraphwarWasmOneClickStepStateEdgeResult[];
}

/** Layer merge result keeps each edge job bound to its adapter-owned successor node. */
export interface GraphwarWasmOneClickStepStateLayerResult extends GraphwarWasmOneClickStepStateMergeResult {
  readonly jobNodeIds: readonly { readonly jobId: number; readonly nodeId?: number }[];
}

/** Edge route and terminal Step evidence stay bound while a retained layer is consumed. */
export type GraphwarWasmOneClickStepStateLayerRouteResult =
  | { readonly jobId: number }
  | {
      readonly jobId: number;
      readonly nodeId: number;
      readonly route: readonly GraphwarWasmPoint[];
      readonly successor: GraphwarWasmOneClickStepStateEvidence;
    };

/**
 * Adapter-retained Step evidence validated by WASM interning. Callers receive copies only; node identity and evidence
 * cannot be spliced by mutating a previously completed edge batch.
 */
export interface GraphwarWasmOneClickStepStateTable {
  readonly evidence: readonly GraphwarWasmOneClickStepStateEvidence[];
  /** Number of DAG layers consumed by this retained table. */
  readonly layerCursor: number;
  readonly nodeCount: number;
  append(batch: readonly GraphwarWasmOneClickStepStateEvidence[]): GraphwarWasmOneClickStepStateMergeResult;
  /** Consumes one ordered layer; retries or skipped layers are typed session faults. */
  consumeLayer(input: GraphwarWasmOneClickStepStateLayerInput): GraphwarWasmOneClickStepStateLayerResult;
  /** Invalidates the retained cursor so a cancelled DAG cannot be resumed accidentally. */
  cancel(): void;
}

/** Consumes one stateful layer without allowing route/state evidence to be recombined by the caller. */
export function consumeGraphwarWasmOneClickStepStateLayer(
  table: GraphwarWasmOneClickStepStateTable,
  input: Omit<GraphwarWasmOneClickStepStateLayerInput, "results"> & {
    readonly results: readonly (GraphwarWasmOneClickStepStateEdgeResult & {
      readonly route?: readonly GraphwarWasmPoint[];
    })[];
  },
): GraphwarWasmOneClickStepStateLayerResult & {
  readonly routes: readonly GraphwarWasmOneClickStepStateLayerRouteResult[];
} {
  const resultByJobId = new Map<number, (typeof input.results)[number]>();
  for (const result of input.results) {
    if (resultByJobId.has(result.jobId)) {
      throw new GraphwarWasmAdapterError(
        "duplicate-work-id",
        `Step state layer route ${result.jobId} is duplicated`,
        "input",
      );
    }
    if ((result.route === undefined) !== (result.successor === undefined)) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        `Step state layer route ${result.jobId} must include route and successor together`,
        "input",
      );
    }
    resultByJobId.set(result.jobId, result);
  }
  const consumed = table.consumeLayer(input);
  const nodeIdByJobId = new Map(consumed.jobNodeIds.map(({ jobId, nodeId }) => [jobId, nodeId]));
  const routes = input.jobs.map(({ id }) => {
    const result = resultByJobId.get(id);
    if (!result) {
      throw new GraphwarWasmAdapterError("invalid-work-batch", `Step state layer route ${id} is missing`, "input");
    }
    const nodeId = nodeIdByJobId.get(id);
    if (result.route === undefined) {
      return { jobId: id };
    }
    if (nodeId === undefined || result.successor === undefined) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        `Step state layer route ${id} lost its successor node`,
        "output",
      );
    }
    return {
      jobId: id,
      nodeId,
      route: result.route.map(({ x, y }) => ({ x, y })),
      successor: { ...result.successor },
    };
  });
  return { ...consumed, routes };
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
  /** Stateful Step successor evidence is inseparable from its reachable route. */
  readonly successor?: GraphwarWasmOneClickStepStateEvidence;
}

export type GraphwarWasmOneClickClearResult =
  | {
      readonly path: readonly GraphwarWasmPoint[];
      readonly routeValidation?: { readonly removedPointCount: number; readonly type: "route-only" };
      readonly selectedEdgeIds: readonly number[];
      readonly selectedEdgeCount: number;
      readonly status: "complete";
      readonly targetOrder: readonly number[];
    }
  | {
      readonly path: readonly GraphwarWasmPoint[];
      readonly selectedEdgeIds: readonly number[];
      readonly selectedEdgeCount: number;
      readonly status: "failure";
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
  /** Retained state evidence is published only for explicit stateful sessions. */
  readonly stepStateEvidence?: readonly GraphwarWasmOneClickStepStateEvidence[];
  /** Number of accepted stateful edge batches. */
  readonly layerCursor: number;
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
  readonly routeContextPointer: number;
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
  readonly nodeTargetsPointer: number;
  readonly nodeResolvedYPointer: number;
  readonly nodeKeyOffsetsPointer: number;
  readonly nodeKeyLengthsPointer: number;
  readonly nodeKeyBytesPointer: number;
  readonly nodeKeyByteLength: number;
  readonly nodeEvidenceCount: number;
  readonly stepStateEvidence?: readonly GraphwarWasmOneClickStepStateEvidence[];
  readonly layerCursor: number;
}

interface OneClickOutputBoundary {
  readonly minimumPointer: number;
  readonly additionalRanges: readonly OneClickMemoryRange[];
  readonly forbiddenRanges: readonly OneClickMemoryRange[];
  readonly expectedPath?: readonly GraphwarWasmPoint[];
  readonly expectedWork?: readonly GraphwarWasmOneClickEdgeResult[];
  readonly retainedSession?: OneClickRetainedSession;
  readonly expectedRouteContextPointer?: number;
}

type OneClickRangeSource = "fresh" | "session" | "session-array";

function createOneClickOutputBoundary(
  minimumPointer: number,
  retainedSession?: OneClickRetainedSession,
  additionalRanges: readonly OneClickMemoryRange[] = [],
  forbiddenRanges: readonly OneClickMemoryRange[] = [],
  expectedWork?: readonly GraphwarWasmOneClickEdgeResult[],
  expectedPath?: readonly GraphwarWasmPoint[],
  expectedRouteContextPointer?: number,
): OneClickOutputBoundary {
  return {
    additionalRanges,
    expectedPath,
    expectedRouteContextPointer,
    expectedWork,
    forbiddenRanges,
    minimumPointer,
    retainedSession,
  };
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

function oneClickPointsOrderedSubsequence(
  source: readonly GraphwarWasmPoint[],
  candidate: readonly GraphwarWasmPoint[],
) {
  if (candidate.length === 0 || source.length === 0 || !pointsEqual(candidate[0], source[0])) return false;
  if (!pointsEqual(candidate.at(-1) ?? { x: 0, y: 0 }, source.at(-1) ?? { x: 0, y: 0 })) return false;
  let sourceIndex = 0;
  for (const point of candidate) {
    while (sourceIndex < source.length && !pointsEqual(source[sourceIndex] ?? { x: 0, y: 0 }, point)) {
      sourceIndex += 1;
    }
    if (sourceIndex >= source.length) return false;
    sourceIndex += 1;
  }
  return true;
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
  routeValidationRemovedPointCount?: number,
) {
  assertOneClickArrayEqual(targetOrder, retainedSession.targetOrder, "terminal target order");
  validateOneClickWorkEvidence(retainedSession, expectedWork);
  if (retainedSession.completedCount + expectedWork.length !== retainedSession.edgeJobCount) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "terminal one-click result does not contain a complete edge work batch",
      "output",
    );
  }
  if (status === "failure") {
    if (selectedEdgeIds.length !== 0 || !oneClickPointsArraysEqual(path, retainedSession.path)) {
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
  const isRouteOnlyOptimized =
    retainedSession.routeContextPointer !== 0 && (retainedSession.flags & oneClickDeleteOptimizationFlag) !== 0;
  if (
    !oneClickPointsArraysEqual(path, expectedPath) &&
    (!isRouteOnlyOptimized || !oneClickPointsOrderedSubsequence(expectedPath, path))
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "terminal path does not match the retained prefix",
      "output",
    );
  }
  if (isRouteOnlyOptimized) {
    if (
      routeValidationRemovedPointCount === undefined ||
      routeValidationRemovedPointCount !== expectedPath.length - path.length
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "route-only optimized path has inconsistent removed-point evidence",
        "output",
      );
    }
    let searchStart = retainedSession.path.length > 0 ? retainedSession.path.length - 1 : 0;
    for (const jobId of selectedEdgeIds) {
      const job = jobsById.get(jobId);
      if (!job) continue;
      const targetIndex = path.findIndex((point, index) => index >= searchStart && pointsEqual(point, job.targetPoint));
      if (targetIndex < 0) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-identity",
          "route-only optimized path dropped a selected target anchor",
          "output",
        );
      }
      searchStart = targetIndex + 1;
    }
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
    if (
      (retainedSession.flags & oneClickExplicitDagFlag) !== 0 &&
      (retainedSession.flags & oneClickStepStatefulFlag) !== 0
    ) {
      const job = retainedSession.edgeJobs[result.jobId];
      const successor = result.successor;
      if (result.reachable !== (successor !== undefined)) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-identity",
          `stateful edge ${result.jobId} changed route/evidence presence`,
          "output",
        );
      }
      if (successor) {
        const expected = job?.toNodeId === undefined ? undefined : retainedSession.stepStateEvidence?.[job.toNodeId];
        if (
          !expected ||
          successor.targetIndex !== expected.targetIndex ||
          successor.resolvedStateKey !== expected.resolvedStateKey ||
          !Object.is(successor.resolvedY, expected.resolvedY)
        ) {
          throw new GraphwarWasmAdapterError(
            "invalid-session-identity",
            `stateful edge ${result.jobId} changed successor evidence`,
            "output",
          );
        }
      }
    } else if (result.successor !== undefined) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        `non-stateful edge ${result.jobId} carries successor evidence`,
        "output",
      );
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
    if (
      (retainedSession.flags & oneClickExplicitDagFlag) !== 0 &&
      (retainedSession.flags & oneClickStepStatefulFlag) !== 0
    ) {
      const job = retainedSession.edgeJobs[jobId];
      const successor = result.successor;
      const expected = job?.toNodeId === undefined ? undefined : retainedSession.stepStateEvidence?.[job.toNodeId];
      if (result.reachable !== (successor !== undefined)) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-identity",
          `one-click stateful edge ${jobId} changed route/evidence presence`,
          "output",
        );
      }
      if (
        successor &&
        (!expected ||
          successor.targetIndex !== expected.targetIndex ||
          successor.resolvedStateKey !== expected.resolvedStateKey ||
          !Object.is(successor.resolvedY, expected.resolvedY))
      ) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-identity",
          `one-click stateful edge ${jobId} changed successor evidence`,
          "output",
        );
      }
    } else if (result.successor !== undefined) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        `one-click edge ${jobId} carries successor evidence`,
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
  shouldAllowExactDuplicates = true,
) {
  const uniqueRanges = shouldAllowExactDuplicates
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

function assertOneClickRangesDoNotOverlap(
  candidates: readonly OneClickMemoryRange[],
  liveRanges: readonly OneClickMemoryRange[],
  fieldName: string,
  allowedExactAliases: readonly OneClickMemoryRange[] = [],
) {
  assertOneClickRangesDisjoint(candidates, `${fieldName} candidates`, false);
  for (const candidate of candidates) {
    for (const live of liveRanges) {
      if (!oneClickRangesOverlap(live, candidate)) continue;
      const isAllowedExactAlias =
        oneClickRangeMatches(live, candidate) &&
        allowedExactAliases.some((allowed) => oneClickRangeMatches(allowed, candidate));
      if (!isAllowedExactAlias) {
        throw new GraphwarWasmAdapterError(
          "range-out-of-bounds",
          `${fieldName} overlaps a live one-click range (${candidate.pointer}/${candidate.length} and ${live.pointer}/${live.length})`,
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

function copyOneClickStepStateEvidence(
  runtime: GraphwarWasmMemorySource,
  pointers: {
    readonly targets: number;
    readonly resolvedY: number;
    readonly keyOffsets: number;
    readonly keyLengths: number;
    readonly keyBytes: number;
    readonly keyByteLength: number;
  },
  count: number,
  boundary: OneClickOutputBoundary,
  source: OneClickRangeSource,
): GraphwarWasmOneClickStepStateEvidence[] {
  if (count === 0) {
    if (
      pointers.targets !== 0 ||
      pointers.resolvedY !== 0 ||
      pointers.keyOffsets !== 0 ||
      pointers.keyLengths !== 0 ||
      pointers.keyBytes !== 0 ||
      pointers.keyByteLength !== 0
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "empty Step evidence has retained pointers",
        "output",
      );
    }
    return [];
  }
  if (pointers.keyByteLength === 0) {
    throw new GraphwarWasmAdapterError("invalid-session-state", "Step evidence has no key bytes", "output");
  }
  const targets = copyOneClickUint32Values(runtime, pointers.targets, count, boundary, "session node targets", source);
  const resolvedY = copyOneClickFloat64Values(
    runtime,
    pointers.resolvedY,
    count,
    boundary,
    "session node resolved Y",
    source,
  );
  const keyOffsets = copyOneClickUint32Values(
    runtime,
    pointers.keyOffsets,
    count + 1,
    boundary,
    "session node key offsets",
    source,
  );
  const keyLengths = copyOneClickUint32Values(
    runtime,
    pointers.keyLengths,
    count,
    boundary,
    "session node key lengths",
    source,
  );
  const keyRange = readOneClickRange(
    runtime,
    pointers.keyBytes,
    pointers.keyByteLength,
    1,
    boundary,
    "session node key bytes",
    source,
  );
  const keyBytes = new Uint8Array(keyRange.buffer, keyRange.byteOffset, keyRange.byteLength);
  const seen = new Set<string>();
  return Array.from({ length: count }, (_, index) => {
    const start = keyOffsets[index] ?? 0;
    const end = keyOffsets[index + 1] ?? 0;
    const length = keyLengths[index] ?? 0;
    const y = resolvedY[index];
    const targetIndex = targets[index];
    if (
      targetIndex === undefined ||
      y === undefined ||
      start > end ||
      end > keyBytes.length ||
      end - start !== length
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        `session node evidence ${index} is malformed`,
        "output",
      );
    }
    let resolvedStateKey = "";
    for (let keyIndex = start; keyIndex < end; keyIndex += 1) {
      const code = keyBytes[keyIndex];
      if (code === undefined || code > 0x7f) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-identity",
          `session node evidence ${index} key is not ASCII`,
          "output",
        );
      }
      resolvedStateKey += String.fromCharCode(code);
    }
    try {
      if (BigInt(resolvedStateKey).toString() !== resolvedStateKey) throw new Error("non-canonical");
    } catch {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        `session node evidence ${index} key is not canonical`,
        "output",
      );
    }
    const identity = `${targetIndex}:${resolvedStateKey}`;
    if (seen.has(identity)) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        "session node evidence identity is duplicated",
        "output",
      );
    }
    seen.add(identity);
    validateGraphwarWasmFiniteNumber(y, `session node evidence ${index} resolved Y`, "output");
    return { resolvedStateKey, resolvedY: y, targetIndex };
  });
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

/**
 * Runs ordinary one-click validation and deletion as one coarse WASM composition boundary. The final trajectory replay
 * is copied here so the selected path and its formula/evidence provenance cannot be recombined by a caller from
 * separate attempts.
 */
export function runGraphwarWasmOneClickTrajectoryComposition(
  runtime: GraphwarWasmKernelRuntime,
  input: GraphwarWasmOneClickTrajectoryCompositionInput,
): GraphwarWasmOneClickTrajectoryCompositionResult {
  const points = validatePoints(input.points, "points");
  const sourcePointCount = validateGraphwarWasmU32(input.sourcePointCount, "sourcePointCount", "input");
  if (sourcePointCount > points.length) {
    throw new GraphwarWasmAdapterError(
      "invalid-index",
      "one-click trajectory composition sourcePointCount exceeds point count",
      "input",
    );
  }
  const targetAnchors =
    input.targetAnchors?.map((point, index) => validatePoint(point, `targetAnchors[${index}]`)) ?? [];
  const protectedPointIndexes = findOneClickProtectedPointIndexes(points, targetAnchors, input.targetAnchorIndexes);
  const orderedTargets = input.trajectoryValidation.stop.orderedTargets;
  const finalTarget = orderedTargets.at(-1);
  if (!finalTarget) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "one-click trajectory composition requires an ordered target",
      "input",
    );
  }
  const prefixTargetCount = validateGraphwarWasmU32(input.prefixTargetCount ?? 0, "prefixTargetCount", "input");
  if (prefixTargetCount > orderedTargets.length) {
    throw new GraphwarWasmAdapterError(
      "invalid-index",
      "one-click trajectory composition prefixTargetCount exceeds ordered target count",
      "input",
    );
  }
  const smartInput = {
    ...(input.allowTerminalPointDeletion === undefined
      ? {}
      : { allowTerminalPointDeletion: input.allowTerminalPointDeletion }),
    isDeleteOptimizationEnabled: input.isDeleteOptimizationEnabled,
    points,
    prefixTargetCount,
    protectedPointIndexes,
    sourcePointCount,
    target: finalTarget.center,
    targetRadius: validateNonNegativeFinite(finalTarget.radius, "trajectoryValidation.stop.target.radius"),
    trajectoryValidation: {
      descriptor: input.trajectoryValidation.descriptor,
      stop: {
        ...input.trajectoryValidation.stop,
        // Smart candidate replay only needs ordered/required target state. The
        // final replay below owns visible pixels and tracked-target evidence.
        shouldCollectVisiblePixels: false,
        shouldStopOnTargetsComplete: true,
        trackedTargets: [],
      },
      type: "trajectory" as const,
    },
  } satisfies Omit<GraphwarWasmSmartPathfindingInput, "routeContextPointer" | "routeValidationEvidence">;
  const smartResult = input.runSmartPathfinding
    ? input.runSmartPathfinding(smartInput)
    : runGraphwarWasmSmartPathfinding(runtime, {
        ...smartInput,
        ...(input.routeContextPointer === undefined ? {} : { routeContextPointer: input.routeContextPointer }),
        ...(input.routeValidationEvidence === undefined
          ? {}
          : { routeValidationEvidence: input.routeValidationEvidence }),
      });
  if (smartResult.status !== "success") {
    const reachedTargetCount = Math.min(
      targetAnchors.length + 1,
      Math.max(0, smartResult.reachedRequiredTargetCount + smartResult.reachedTargetCount - prefixTargetCount),
    );
    return {
      reachedTargetCount,
      reason: smartResult.failureReason ?? "trajectory",
      status: "failure",
    };
  }

  const selectedPath = smartResult.points.map((point) => ({ x: point.x, y: point.y }));
  const sourcePointIndexes = smartResult.sourcePointIndexes;
  if (sourcePointIndexes.length !== selectedPath.length) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "one-click smart result source indexes do not match its path",
      "output",
    );
  }
  if (
    targetAnchors.length > 0 &&
    protectedPointIndexes.some((sourceIndex) => !sourcePointIndexes.includes(sourceIndex))
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "one-click trajectory composition dropped a target anchor",
      "output",
    );
  }
  const removedPointCount = points.length - selectedPath.length;
  if (removedPointCount !== smartResult.removedPointCount) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "one-click trajectory composition returned an inconsistent removed-point count",
      "output",
    );
  }

  const selectedGraphPoints = mapOneClickPixelPointsToGraphPoints(
    selectedPath,
    input.trajectoryValidation.descriptor.bounds,
    input.trajectoryValidation.stop.boundsRect,
  );
  const firstSelectedGraphPoint = selectedGraphPoints[0];
  if (!firstSelectedGraphPoint) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "one-click trajectory composition returned an empty selected path",
      "output",
    );
  }
  const selectedQualityPoints = input.trajectoryValidation.stop.qualityPoints.filter((qualityPoint) =>
    selectedGraphPoints.some((point) => pointsEqual(point, qualityPoint)),
  );
  const finalDescriptor: GraphwarWasmFormulaInputDescriptor = {
    ...input.trajectoryValidation.descriptor,
    points: selectedGraphPoints,
    soldierCenter: firstSelectedGraphPoint,
  };
  const finalStop: Extract<GraphwarWasmStopPolicy, { type: "targets" }> = {
    ...input.trajectoryValidation.stop,
    qualityPoints: selectedQualityPoints,
  };
  const finalOutcome = runGraphwarWasmOneClickTrajectoryValidation(runtime, {
    descriptor: finalDescriptor,
    stop: finalStop,
  });
  if (!finalOutcome) {
    return { reason: "trajectory", status: "failure" };
  }
  const { formula, trajectory } = finalOutcome;
  const obstacleSampleIndex = trajectory.obstacle.type === "hit" ? trajectory.obstacle.sampleIndex : -1;
  const hasReachedTargetSequence =
    trajectory.reachedTargetCount >= finalStop.orderedTargets.length &&
    trajectory.reachedRequiredTargetCount >= finalStop.requiredTargets.length;
  if (
    !hasReachedTargetSequence ||
    (obstacleSampleIndex >= 0 && (trajectory.targetHitIndex < 0 || trajectory.targetHitIndex > obstacleSampleIndex))
  ) {
    return { reason: "trajectory", status: "failure" };
  }
  const incumbentEvidence = createOneClickTrajectoryIncumbentEvidence(
    finalDescriptor,
    selectedPath,
    sourcePointIndexes,
    formula,
    trajectory,
  );
  return {
    formula,
    incumbentEvidence,
    path: selectedPath,
    sourcePointIndexes,
    removedPointCount,
    targetAnchors,
    targetOrder: finalStop.orderedTargets.map((target) => ({ ...target.center })),
    trajectory,
    status: "success",
  };
}

/** Builds the caller-facing incumbent atom from the exact final formula/trajectory replay. */
function createOneClickTrajectoryIncumbentEvidence(
  descriptor: GraphwarWasmFormulaInputDescriptor,
  selectedPath: readonly GraphwarWasmPoint[],
  sourcePointIndexes: readonly number[],
  formula: Extract<GraphwarWasmFormulaLaunchResult, { status: "success" }>,
  trajectory: GraphwarWasmTrajectoryResult,
): GraphwarWasmOneClickTrajectoryIncumbentEvidence {
  const formulaPoints = formula.formulaPoints.map((point) => createGraphPoint(point.x, point.y));
  const signProtection = [...trajectory.continuationEvidence.observedSignProtection];
  const formulaSettings = {
    ...descriptor.settings,
    ...(descriptor.settings.stepGlitchObstacleMask === undefined
      ? {}
      : { stepGlitchObstacleMask: descriptor.settings.stepGlitchObstacleMask.slice() }),
  };
  const stepOverflowProtectionRange = createStepOverflowProtectionRange(descriptor.bounds, formulaPoints);
  const formulaEvaluation = {
    equation: formulaSettings.equation,
    formulaDecimalPlaces: formulaSettings.decimalPlaces,
    isStepOverflowProtectionEnabled: formulaSettings.isStepOverflowProtectionEnabled,
    signProtection,
    stepOverflowProtectionRange,
  };
  const formulaContext: GraphwarTrajectoryFormulaContext = {
    compiledMaterials: formula.compiledMaterials,
    formulaEvaluation,
    formulaPoints,
    formulaResult: buildFormula(
      formulaPoints,
      formulaSettings.steepness,
      formulaSettings.equation,
      formulaSettings.algorithm,
      formulaSettings.decimalPlaces,
      {
        compiledMaterials: formula.compiledMaterials,
        isStepOverflowProtectionEnabled: formulaSettings.isStepOverflowProtectionEnabled,
        signProtection,
        stepOverflowProtectionRange,
      },
    ),
    ...(trajectory.launchAngleRadians === undefined ? {} : { launchAngleRadians: trajectory.launchAngleRadians }),
    settings: formulaSettings,
    signProtection,
    soldierCenter: createGraphPoint(trajectory.launchPoint.x, trajectory.launchPoint.y),
  };
  const obstacleSampleIndex = trajectory.obstacle.type === "hit" ? trajectory.obstacle.sampleIndex : -1;
  const trajectoryPoints = snapshotGraphwarVisibleTrajectoryPoints(trajectory.visiblePixels, obstacleSampleIndex).map(
    (point) => createPixelPoint(point.x, point.y),
  );
  return {
    formulaContext,
    path: selectedPath.map((point) => createPixelPoint(point.x, point.y)),
    sourcePointIndexes: [...sourcePointIndexes],
    trajectory,
    trajectoryPoints,
  };
}

function mapOneClickPixelPointsToGraphPoints(
  points: readonly GraphwarWasmPoint[],
  bounds: GraphwarWasmFormulaInputDescriptor["bounds"],
  boundsRect: BoundsRect,
) {
  const minX = validateGraphwarWasmFiniteNumber(bounds.minX, "trajectoryValidation.descriptor.bounds.minX", "input");
  const maxX = validateGraphwarWasmFiniteNumber(bounds.maxX, "trajectoryValidation.descriptor.bounds.maxX", "input");
  const minY = validateGraphwarWasmFiniteNumber(bounds.minY, "trajectoryValidation.descriptor.bounds.minY", "input");
  const maxY = validateGraphwarWasmFiniteNumber(bounds.maxY, "trajectoryValidation.descriptor.bounds.maxY", "input");
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
      "one-click trajectory composition coordinate mapping is degenerate",
      "input",
    );
  }
  return points.map((point, index) => {
    const pixel = validatePoint(point, `selectedPath[${index}]`);
    return {
      x: validateGraphwarWasmFiniteNumber(
        minX + ((pixel.x - rectX) / rectWidth) * (maxX - minX),
        `selectedPath[${index}].graphX`,
        "output",
      ),
      y: validateGraphwarWasmFiniteNumber(
        maxY - ((pixel.y - rectY) / rectHeight) * (maxY - minY),
        `selectedPath[${index}].graphY`,
        "output",
      ),
    };
  });
}

function findOneClickProtectedPointIndexes(
  points: readonly GraphwarWasmPoint[],
  anchors: readonly GraphwarWasmPoint[],
  explicitIndexes: readonly number[] | undefined,
) {
  if (explicitIndexes !== undefined) {
    if (explicitIndexes.length !== anchors.length) {
      throw new GraphwarWasmAdapterError(
        "invalid-index",
        "one-click trajectory composition target anchor indexes must match anchors",
        "input",
      );
    }
    const indexes = validateProtectedPointIndexes(explicitIndexes, points.length);
    for (const [anchorIndex, sourceIndex] of indexes.entries()) {
      const anchor = anchors[anchorIndex];
      const point = points[sourceIndex];
      if (!anchor || !point || !pointsEqual(anchor, point)) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-identity",
          `one-click trajectory composition target anchor ${anchorIndex} does not match its source index`,
          "input",
        );
      }
    }
    return indexes;
  }
  const indexes: number[] = [];
  let searchIndex = 0;
  for (const anchor of anchors) {
    let matchCount = 0;
    for (let index = searchIndex; index < points.length; index += 1) {
      if (pointsEqual(points[index] ?? { x: 0, y: 0 }, anchor)) {
        matchCount += 1;
      }
    }
    if (matchCount > 1) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        "one-click trajectory composition target anchor coordinate is ambiguous",
        "input",
      );
    }
    while (searchIndex < points.length && !pointsEqual(points[searchIndex] ?? { x: 0, y: 0 }, anchor)) {
      searchIndex += 1;
    }
    if (searchIndex >= points.length) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        "one-click trajectory composition target anchor is not a source point",
        "input",
      );
    }
    indexes.push(searchIndex);
    searchIndex += 1;
  }
  return indexes;
}

export interface GraphwarWasmOneClickIncumbentScore {
  readonly pathError?: number;
  readonly pointCount: number;
  readonly targetCount: number;
}

export interface GraphwarWasmOneClickIncumbentEventIdentity {
  readonly attemptId: number;
  readonly backendGeneration: number;
  readonly outerTaskId: number;
  readonly requestNonce: number;
}

export interface GraphwarWasmOneClickIncumbentEvent {
  readonly sequence: number;
}

export interface GraphwarWasmOneClickIncumbentEventSession {
  consider(
    score: GraphwarWasmOneClickIncumbentScore,
  ):
    | { readonly event?: never; readonly isBetter: false }
    | { readonly event: GraphwarWasmOneClickIncumbentEvent; readonly isBetter: true };
  dispose(): void;
}

/** Lets effective WASM composition own incumbent tie-breaks while TS keeps event payload construction. */
export function compareGraphwarWasmOneClickIncumbent(
  runtime: GraphwarWasmKernelRuntime,
  candidate: GraphwarWasmOneClickIncumbentScore,
  current: GraphwarWasmOneClickIncumbentScore,
): boolean {
  const candidateTargetCount = validateGraphwarWasmU32(candidate.targetCount, "candidate.targetCount", "input");
  const candidatePointCount = validateGraphwarWasmU32(candidate.pointCount, "candidate.pointCount", "input");
  const currentTargetCount = validateGraphwarWasmU32(current.targetCount, "current.targetCount", "input");
  const currentPointCount = validateGraphwarWasmU32(current.pointCount, "current.pointCount", "input");
  const candidatePathError = validateGraphwarWasmPathError(candidate.pathError, "candidate.pathError", "input");
  const currentPathError = validateGraphwarWasmPathError(current.pathError, "current.pathError", "input");
  const mark = runtime.markArena();
  try {
    const commandPointer = runtime.reserveArena(
      graphwarWasmCompositionLayout.oneClickIncumbentCompareInputByteLength,
      8,
    );
    const inputView = new DataView(
      runtime.buffer,
      commandPointer,
      graphwarWasmCompositionLayout.oneClickIncumbentCompareInputByteLength,
    );
    inputView.setUint32(0, oneClickIncumbentCompareMagic, true);
    inputView.setUint32(4, oneClickIncumbentCompareVersion, true);
    inputView.setUint32(8, candidateTargetCount, true);
    inputView.setUint32(12, candidatePointCount, true);
    inputView.setFloat64(16, candidatePathError ?? 0, true);
    inputView.setUint32(24, candidatePathError === undefined ? 0 : 1, true);
    inputView.setUint32(28, currentTargetCount, true);
    inputView.setUint32(32, currentPointCount, true);
    inputView.setUint32(oneClickIncumbentCompareInputAlignmentReservedOffset, 0, true);
    inputView.setFloat64(40, currentPathError ?? 0, true);
    inputView.setUint32(48, currentPathError === undefined ? 0 : 1, true);
    inputView.setUint32(oneClickIncumbentCompareInputReservedOffset, 0, true);
    const outputMinimumPointer = runtime.arenaCursor;
    const resultPointer = runtime.runRouteTask(
      oneClickIncumbentCompareCommand,
      commandPointer,
      graphwarWasmCompositionLayout.oneClickIncumbentCompareInputByteLength,
    );
    const range = validateGraphwarWasmMemoryRange(
      runtime,
      { length: 1, pointer: resultPointer },
      {
        alignment: 4,
        elementByteLength: graphwarWasmCompositionLayout.oneClickIncumbentCompareResultByteLength,
        minimumPointer: outputMinimumPointer,
      },
    );
    const resultView = new DataView(range.buffer, range.byteOffset, range.byteLength);
    if (resultView.getUint32(0, true) !== oneClickIncumbentCompareMagic || resultView.getUint32(8, true) !== 0) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "one-click incumbent comparison returned malformed result",
        "output",
      );
    }
    const status = resultView.getUint32(4, true);
    if (status > 1) {
      throw new GraphwarWasmAdapterError(
        "invalid-enum",
        "one-click incumbent comparison returned an invalid status",
        "output",
      );
    }
    runtime.resetArena(mark);
    return status === 1;
  } catch (error) {
    runtime.resetArenaAfterFault(mark);
    throw error;
  }
}

/** Retains one request's incumbent score and event sequence inside the WASM arena. */
export function beginGraphwarWasmOneClickIncumbentEventSession(
  runtime: GraphwarWasmKernelRuntime,
  identity: GraphwarWasmOneClickIncumbentEventIdentity,
): GraphwarWasmOneClickIncumbentEventSession {
  const mark = runtime.markArena();
  let isActive = true;
  try {
    const requestNonce = validateGraphwarWasmU32(identity.requestNonce, "incumbentEvent.requestNonce", "input");
    const attemptId = validateGraphwarWasmU32(identity.attemptId, "incumbentEvent.attemptId", "input");
    const backendGeneration = validateGraphwarWasmU32(
      identity.backendGeneration,
      "incumbentEvent.backendGeneration",
      "input",
    );
    const outerTaskId = validateGraphwarWasmU32(identity.outerTaskId, "incumbentEvent.outerTaskId", "input");
    const beginPointer = runtime.reserveArena(graphwarWasmCompositionLayout.oneClickIncumbentEventInputByteLength, 8);
    const writeIdentity = (view: DataView, operation: number, sessionPointer: number) => {
      view.setUint32(0, oneClickIncumbentEventMagic, true);
      view.setUint32(4, oneClickIncumbentEventVersion, true);
      view.setUint32(8, operation, true);
      view.setUint32(oneClickIncumbentEventInputSessionPointerOffset, sessionPointer, true);
      view.setUint32(oneClickIncumbentEventInputRequestNonceOffset, requestNonce, true);
      view.setUint32(oneClickIncumbentEventInputAttemptIdOffset, attemptId, true);
      view.setUint32(oneClickIncumbentEventInputGenerationOffset, backendGeneration, true);
      view.setUint32(oneClickIncumbentEventInputOuterTaskIdOffset, outerTaskId, true);
    };
    new Uint8Array(
      runtime.buffer,
      beginPointer,
      graphwarWasmCompositionLayout.oneClickIncumbentEventInputByteLength,
    ).fill(0);
    writeIdentity(
      new DataView(runtime.buffer, beginPointer, graphwarWasmCompositionLayout.oneClickIncumbentEventInputByteLength),
      oneClickIncumbentEventBeginOperation,
      0,
    );
    const outputMinimumPointer = runtime.arenaCursor;
    const resultPointer = runtime.runRouteTask(
      oneClickIncumbentEventCommand,
      beginPointer,
      graphwarWasmCompositionLayout.oneClickIncumbentEventInputByteLength,
    );
    const resultRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: 1, pointer: resultPointer },
      {
        alignment: 4,
        elementByteLength: graphwarWasmCompositionLayout.oneClickIncumbentEventResultByteLength,
        minimumPointer: outputMinimumPointer,
      },
    );
    const resultView = new DataView(resultRange.buffer, resultRange.byteOffset, resultRange.byteLength);
    if (
      resultView.getUint32(0, true) !== oneClickIncumbentEventMagic ||
      resultView.getUint32(4, true) !== 0 ||
      resultView.getUint32(8, true) !== 0 ||
      resultView.getUint32(16, true) !== 0
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "one-click incumbent event session returned malformed begin result",
        "output",
      );
    }
    const sessionPointer = validateGraphwarWasmU32(
      resultView.getUint32(12, true),
      "incumbentEvent.sessionPointer",
      "output",
    );
    const sessionRange = validateGraphwarWasmMemoryRange(
      runtime,
      { length: 1, pointer: sessionPointer },
      {
        alignment: 8,
        elementByteLength: graphwarWasmCompositionLayout.oneClickIncumbentEventSessionByteLength,
        minimumPointer: mark,
      },
    );
    const sessionView = new DataView(sessionRange.buffer, sessionRange.byteOffset, sessionRange.byteLength);
    if (
      sessionView.getUint32(0, true) !== oneClickIncumbentEventMagic ||
      sessionView.getUint32(4, true) !== oneClickIncumbentEventVersion ||
      sessionView.getUint32(8, true) !== requestNonce ||
      sessionView.getUint32(12, true) !== attemptId ||
      sessionView.getUint32(16, true) !== backendGeneration ||
      sessionView.getUint32(20, true) !== outerTaskId ||
      sessionView.getUint32(24, true) !== 0 ||
      sessionView.getUint32(28, true) !== 0 ||
      sessionView.getUint32(32, true) !== 0xffff_ffff ||
      sessionView.getUint32(48, true) !== 0 ||
      sessionView.getUint32(52, true) !== 0
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        "one-click incumbent event session identity is invalid",
        "output",
      );
    }

    const dispose = () => {
      if (!isActive) return;
      isActive = false;
      runtime.resetArena(mark);
    };
    return {
      consider(score) {
        if (!isActive) {
          throw new GraphwarWasmAdapterError(
            "invalid-session-state",
            "one-click incumbent event session is no longer active",
            "input",
          );
        }
        const targetCount = validateGraphwarWasmU32(score.targetCount, "incumbentEvent.targetCount", "input");
        const pointCount = validateGraphwarWasmU32(score.pointCount, "incumbentEvent.pointCount", "input");
        const pathError = validateGraphwarWasmPathError(score.pathError, "incumbentEvent.pathError", "input");
        const eventMark = runtime.markArena();
        try {
          const pointer = runtime.reserveArena(graphwarWasmCompositionLayout.oneClickIncumbentEventInputByteLength, 8);
          const view = new DataView(
            runtime.buffer,
            pointer,
            graphwarWasmCompositionLayout.oneClickIncumbentEventInputByteLength,
          );
          writeIdentity(view, oneClickIncumbentEventConsiderOperation, sessionPointer);
          view.setUint32(oneClickIncumbentEventInputCandidateTargetCountOffset, targetCount, true);
          view.setUint32(oneClickIncumbentEventInputCandidatePointCountOffset, pointCount, true);
          view.setFloat64(oneClickIncumbentEventInputCandidatePathErrorOffset, pathError ?? 0, true);
          view.setUint32(
            oneClickIncumbentEventInputCandidatePathErrorFlagOffset,
            pathError === undefined ? 0 : 1,
            true,
          );
          view.setUint32(oneClickIncumbentEventInputReservedOffset, 0, true);
          const resultMinimumPointer = runtime.arenaCursor;
          const result = runtime.runRouteTask(
            oneClickIncumbentEventCommand,
            pointer,
            graphwarWasmCompositionLayout.oneClickIncumbentEventInputByteLength,
          );
          const range = validateGraphwarWasmMemoryRange(
            runtime,
            { length: 1, pointer: result },
            {
              alignment: 4,
              elementByteLength: graphwarWasmCompositionLayout.oneClickIncumbentEventResultByteLength,
              minimumPointer: resultMinimumPointer,
            },
          );
          const output = new DataView(range.buffer, range.byteOffset, range.byteLength);
          if (
            output.getUint32(0, true) !== oneClickIncumbentEventMagic ||
            output.getUint32(12, true) !== sessionPointer ||
            output.getUint32(16, true) !== 0
          ) {
            throw new GraphwarWasmAdapterError(
              "invalid-session-identity",
              "one-click incumbent event session returned a mismatched result",
              "output",
            );
          }
          const status = output.getUint32(4, true);
          if (status > 1) {
            throw new GraphwarWasmAdapterError(
              "invalid-enum",
              "one-click incumbent event session returned an invalid status",
              "output",
            );
          }
          const sequence = output.getUint32(8, true);
          if (status === 1 && sequence === 0) {
            throw new GraphwarWasmAdapterError(
              "invalid-session-state",
              "one-click incumbent event session emitted a zero sequence",
              "output",
            );
          }
          runtime.resetArena(eventMark);
          return status === 1 ? { event: { sequence }, isBetter: true as const } : { isBetter: false as const };
        } catch (error) {
          runtime.resetArenaAfterFault(eventMark);
          throw error;
        }
      },
      dispose,
    };
  } catch (error) {
    runtime.resetArenaAfterFault(mark);
    throw error;
  }
}

/** Runs the WASM-owned one-click target assignment and returns ordered owned points. */
export function assignGraphwarWasmOneClickTargetRoutePoints(
  runtime: GraphwarWasmKernelRuntime,
  input: GraphwarWasmOneClickTargetAssignmentInput,
): GraphwarWasmOneClickTargetAssignmentResult[] {
  const mark = runtime.markArena();
  try {
    const packed = packOneClickTargetAssignmentInput(runtime, input);
    const commandPointer = runtime.reserveArena(
      graphwarWasmCompositionLayout.oneClickTargetAssignmentInputByteLength,
      8,
    );
    writeOneClickTargetAssignmentInput(runtime, commandPointer, packed);
    const outputMinimumPointer = runtime.arenaCursor;
    const resultPointer = runtime.assignOneClickTargets(
      commandPointer,
      graphwarWasmCompositionLayout.oneClickTargetAssignmentInputByteLength,
    );
    const result = copyOneClickTargetAssignmentResult(runtime, resultPointer, packed, outputMinimumPointer);
    runtime.resetArena(mark);
    return result;
  } catch (error) {
    runtime.resetArenaAfterFault(mark);
    throw error;
  }
}

/** Interns Step DAG identities in one raw WASM call; no JS Map owns effective-WASM dedup. */
export function internGraphwarWasmOneClickStepStates(
  runtime: GraphwarWasmKernelRuntime,
  evidence: readonly GraphwarWasmOneClickStepStateEvidence[],
): GraphwarWasmOneClickStepStateInternResult {
  const mark = runtime.markArena();
  try {
    if (evidence.length === 0) {
      runtime.resetArena(mark);
      return { nodeCount: 0, nodeIds: [] };
    }
    const targetIndexes = evidence.map((entry, index) => {
      const targetIndex = validateGraphwarWasmU32(entry.targetIndex, `stepStates[${index}].targetIndex`, "input");
      const resolvedY = validateGraphwarWasmFiniteNumber(entry.resolvedY, `stepStates[${index}].resolvedY`, "input");
      if (!Number.isInteger(targetIndex)) {
        throw new GraphwarWasmAdapterError(
          "invalid-index",
          `stepStates[${index}].targetIndex is not an integer`,
          "input",
        );
      }
      if (!Number.isFinite(resolvedY)) {
        throw new GraphwarWasmAdapterError(
          "invalid-finite-number",
          `stepStates[${index}].resolvedY is not finite`,
          "input",
        );
      }
      try {
        if (BigInt(entry.resolvedStateKey).toString() !== entry.resolvedStateKey) {
          throw new Error("non-canonical");
        }
      } catch {
        throw new GraphwarWasmAdapterError(
          "invalid-session-identity",
          `stepStates[${index}].resolvedStateKey is not canonical`,
          "input",
        );
      }
      return targetIndex;
    });
    const keyBytes = new Uint8Array(evidence.reduce((length, entry) => length + entry.resolvedStateKey.length, 0));
    const keyOffsets = new Uint32Array(evidence.length + 1);
    const keyLengths = new Uint32Array(evidence.length);
    let keyOffset = 0;
    for (const [index, entry] of evidence.entries()) {
      keyOffsets[index] = keyOffset;
      keyLengths[index] = entry.resolvedStateKey.length;
      for (let characterIndex = 0; characterIndex < entry.resolvedStateKey.length; characterIndex += 1) {
        const code = entry.resolvedStateKey.charCodeAt(characterIndex);
        if (code > 0x7f) {
          throw new GraphwarWasmAdapterError(
            "invalid-session-identity",
            `stepStates[${index}] key is not ASCII`,
            "input",
          );
        }
        keyBytes[keyOffset + characterIndex] = code;
      }
      keyOffset += entry.resolvedStateKey.length;
    }
    keyOffsets[evidence.length] = keyOffset;
    const packedTargets = writeGraphwarWasmUint32Values(runtime, Uint32Array.from(targetIndexes), runtime.arenaBase);
    const packedOffsets = writeGraphwarWasmUint32Values(runtime, keyOffsets, runtime.arenaBase);
    const packedLengths = writeGraphwarWasmUint32Values(runtime, keyLengths, runtime.arenaBase);
    const packedKeys = writeGraphwarWasmBytes(runtime, keyBytes, runtime.arenaBase);
    const packedResolvedY = writeGraphwarWasmFloat64Values(
      runtime,
      new Float64Array(evidence.map((entry) => entry.resolvedY)),
      runtime.arenaBase,
    );
    const commandPointer = runtime.reserveArena(graphwarWasmCompositionLayout.oneClickStepStateDedupInputByteLength, 8);
    const command = new DataView(
      runtime.buffer,
      commandPointer,
      graphwarWasmCompositionLayout.oneClickStepStateDedupInputByteLength,
    );
    command.setUint32(0, oneClickStepStateDedupMagic, true);
    command.setUint32(4, oneClickStepStateDedupVersion, true);
    command.setUint32(oneClickStepStateDedupInput.targetIndexes, packedTargets.pointer, true);
    command.setUint32(oneClickStepStateDedupInput.keyOffsets, packedOffsets.pointer, true);
    command.setUint32(oneClickStepStateDedupInput.keyBytes, packedKeys.pointer, true);
    command.setUint32(oneClickStepStateDedupInput.keyLengths, packedLengths.pointer, true);
    command.setUint32(oneClickStepStateDedupInput.resolvedY, packedResolvedY.pointer, true);
    command.setUint32(oneClickStepStateDedupInput.count, evidence.length, true);
    command.setUint32(oneClickStepStateDedupInput.keyByteLength, packedKeys.length, true);
    const outputMinimumPointer = runtime.arenaCursor;
    const resultPointer = runtime.runRouteTask(
      oneClickStepStateDedupCommand,
      commandPointer,
      graphwarWasmCompositionLayout.oneClickStepStateDedupInputByteLength,
    );
    const resultRange = validateGraphwarWasmMemoryRange(
      runtime,
      { pointer: resultPointer, length: graphwarWasmCompositionLayout.oneClickStepStateDedupResultByteLength },
      { alignment: 8, elementByteLength: 1, minimumPointer: outputMinimumPointer, sliceFaultDomain: "output" },
    );
    const result = new DataView(resultRange.buffer, resultRange.byteOffset, resultRange.byteLength);
    if (result.getUint32(oneClickStepStateDedupResult.magic, true) !== oneClickStepStateDedupMagic) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-pointer",
        "Step state dedup result magic is invalid",
        "output",
      );
    }
    if (result.getUint32(oneClickStepStateDedupResult.status, true) !== 0) {
      throw new GraphwarWasmAdapterError("invalid-enum", "Step state dedup result status is invalid", "output");
    }
    const nodeCount = validateGraphwarWasmU32(
      result.getUint32(oneClickStepStateDedupResult.nodeCount, true),
      "Step state dedup node count",
      "output",
    );
    if (nodeCount > evidence.length) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Step state dedup node count exceeds input count",
        "output",
      );
    }
    const nodePointer = validateGraphwarWasmU32(
      result.getUint32(oneClickStepStateDedupResult.nodeIds, true),
      "Step state dedup node pointer",
      "output",
    );
    const nodeIds =
      evidence.length === 0
        ? []
        : Array.from(
            copyGraphwarWasmUint32Values(
              runtime,
              { pointer: nodePointer, length: evidence.length },
              outputMinimumPointer,
            ),
          );
    const observedNodeCount = nodeIds.reduce((maximum, nodeId) => Math.max(maximum, nodeId + 1), 0);
    if (observedNodeCount !== nodeCount || nodeIds.some((nodeId) => nodeId >= nodeCount)) {
      throw new GraphwarWasmAdapterError("invalid-session-state", "Step state dedup node ids are invalid", "output");
    }
    runtime.resetArena(mark);
    return { nodeCount: observedNodeCount, nodeIds };
  } catch (error) {
    runtime.resetArenaAfterFault(mark);
    throw error;
  }
}

/**
 * Merges one completed edge batch into the retained Step evidence table.
 *
 * The full prefix is sent through the existing raw command so WASM remains authoritative for identity interning. A
 * valid retained table must already be canonical (`nodeId === evidence index`); any splice, sparse id, target range
 * mismatch, or duplicate key with a different Y is rejected before the caller can construct a DAG node.
 */
export function mergeGraphwarWasmOneClickStepStateEvidence(
  runtime: GraphwarWasmKernelRuntime,
  input: {
    readonly batch: readonly GraphwarWasmOneClickStepStateEvidence[];
    readonly existing: readonly GraphwarWasmOneClickStepStateEvidence[];
    readonly targetCount: number;
  },
): GraphwarWasmOneClickStepStateMergeResult {
  const targetCount = validateGraphwarWasmU32(input.targetCount, "step state target count", "input");
  const existingCount = input.existing.length;
  const allEvidence = [...input.existing, ...input.batch];
  for (const [index, entry] of allEvidence.entries()) {
    if (entry.targetIndex >= targetCount) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        `stepStates[${index}].targetIndex is outside the retained target table`,
        "input",
      );
    }
  }
  if (allEvidence.length === 0) {
    return { batchNodeIds: [], newNodes: [], nodeCount: 0 };
  }

  const interned = internGraphwarWasmOneClickStepStates(runtime, allEvidence);
  if (interned.nodeIds.length !== allEvidence.length) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "Step state merge returned an incomplete identity mapping",
      "output",
    );
  }
  for (let index = 0; index < existingCount; index += 1) {
    if (interned.nodeIds[index] !== index) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        "Step state merge changed a retained node identity",
        "output",
      );
    }
  }

  const newNodes: {
    evidence: GraphwarWasmOneClickStepStateEvidence;
    id: number;
  }[] = [];
  for (const [index, evidence] of input.batch.entries()) {
    const nodeId = interned.nodeIds[existingCount + index];
    if (nodeId === undefined || nodeId >= interned.nodeCount) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Step state merge returned an invalid batch node id",
        "output",
      );
    }
    if (nodeId === existingCount + newNodes.length) {
      newNodes.push({
        evidence: {
          resolvedStateKey: evidence.resolvedStateKey,
          resolvedY: evidence.resolvedY,
          targetIndex: evidence.targetIndex,
        },
        id: nodeId,
      });
    } else if (nodeId >= existingCount + newNodes.length) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Step state merge returned a sparse node id",
        "output",
      );
    }
  }
  if (interned.nodeCount !== existingCount + newNodes.length) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "Step state merge returned an inconsistent node count",
      "output",
    );
  }
  return {
    batchNodeIds: interned.nodeIds.slice(existingCount),
    newNodes,
    nodeCount: interned.nodeCount,
  };
}

/** Creates a retained evidence table so production callers do not own a parallel identity array. */
export function createGraphwarWasmOneClickStepStateTable(
  runtime: GraphwarWasmKernelRuntime,
  input: {
    readonly initial?: readonly GraphwarWasmOneClickStepStateEvidence[];
    readonly targetCount: number;
  },
): GraphwarWasmOneClickStepStateTable {
  const targetCount = validateGraphwarWasmU32(input.targetCount, "step state target count", "input");
  let retainedEvidence = input.initial?.map((entry) => ({ ...entry })) ?? [];
  let layerCursor = 0;
  const consumedJobIds = new Set<number>();
  let isActive = true;
  if (retainedEvidence.length > 0) {
    const initialMerge = mergeGraphwarWasmOneClickStepStateEvidence(runtime, {
      batch: retainedEvidence,
      existing: [],
      targetCount,
    });
    if (
      initialMerge.nodeCount !== retainedEvidence.length ||
      initialMerge.batchNodeIds.some((nodeId, index) => nodeId !== index)
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "initial Step state evidence is not canonical",
        "output",
      );
    }
  }

  return {
    get evidence() {
      return retainedEvidence.map((entry) => ({ ...entry }));
    },
    get layerCursor() {
      return layerCursor;
    },
    get nodeCount() {
      return retainedEvidence.length;
    },
    append(batch) {
      if (!isActive) {
        throw new GraphwarWasmAdapterError("invalid-session-state", "Step state table is no longer active", "input");
      }
      const copiedBatch = batch.map((entry) => ({ ...entry }));
      if (copiedBatch.length === 0) {
        return { batchNodeIds: [], newNodes: [], nodeCount: retainedEvidence.length };
      }
      const merged = mergeGraphwarWasmOneClickStepStateEvidence(runtime, {
        batch: copiedBatch,
        existing: retainedEvidence,
        targetCount,
      });
      if (merged.nodeCount < retainedEvidence.length) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Step state table lost retained evidence",
          "output",
        );
      }
      retainedEvidence = [...retainedEvidence, ...merged.newNodes.map(({ evidence }) => ({ ...evidence }))];
      if (retainedEvidence.length !== merged.nodeCount) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          "Step state table returned an inconsistent node count",
          "output",
        );
      }
      return {
        batchNodeIds: [...merged.batchNodeIds],
        newNodes: merged.newNodes.map(({ evidence, id }) => ({ evidence: { ...evidence }, id })),
        nodeCount: merged.nodeCount,
      };
    },
    consumeLayer(input) {
      const validatedLayerIndex = validateGraphwarWasmU32(input.layerIndex, "step state layer index", "input");
      if (validatedLayerIndex !== layerCursor) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          `Step state layer ${validatedLayerIndex} is outside retained cursor ${layerCursor}`,
          "input",
        );
      }
      if (input.jobs.length !== input.results.length) {
        throw new GraphwarWasmAdapterError(
          "invalid-work-batch",
          "Step state layer jobs and results must have the same count",
          "input",
        );
      }
      const jobsById = new Map<number, number>();
      for (const [index, job] of input.jobs.entries()) {
        const jobId = validateGraphwarWasmU32(job.id, `step state jobs[${index}].id`, "input");
        const targetIndex = validateGraphwarWasmU32(job.targetIndex, `step state jobs[${index}].targetIndex`, "input");
        if (consumedJobIds.has(jobId)) {
          throw new GraphwarWasmAdapterError(
            "unexpected-work-id",
            `Step state layer job ${jobId} was already consumed`,
            "input",
          );
        }
        if (targetIndex >= targetCount) {
          throw new GraphwarWasmAdapterError(
            "invalid-session-identity",
            `Step state layer job ${jobId} targets outside the retained target table`,
            "input",
          );
        }
        if (jobsById.has(jobId)) {
          throw new GraphwarWasmAdapterError(
            "duplicate-work-id",
            `Step state layer job ${jobId} is duplicated`,
            "input",
          );
        }
        jobsById.set(jobId, targetIndex);
      }
      const seenResultIds = new Set<number>();
      const successfulResults: GraphwarWasmOneClickStepStateEdgeResult[] = [];
      for (const [index, result] of input.results.entries()) {
        const jobId = validateGraphwarWasmU32(result.jobId, `step state results[${index}].jobId`, "input");
        const targetIndex = jobsById.get(jobId);
        if (targetIndex === undefined) {
          throw new GraphwarWasmAdapterError(
            "unexpected-work-id",
            `Step state result ${jobId} is not in the retained layer`,
            "input",
          );
        }
        if (seenResultIds.has(jobId)) {
          throw new GraphwarWasmAdapterError(
            "duplicate-work-id",
            `Step state layer result ${jobId} is duplicated`,
            "input",
          );
        }
        seenResultIds.add(jobId);
        if (result.successor) {
          const successorTargetIndex = validateGraphwarWasmU32(
            result.successor.targetIndex,
            `step state results[${index}].successor.targetIndex`,
            "input",
          );
          if (successorTargetIndex !== targetIndex) {
            throw new GraphwarWasmAdapterError(
              "invalid-session-identity",
              `Step state result ${jobId} changed its successor target`,
              "input",
            );
          }
          successfulResults.push({
            jobId,
            successor: {
              resolvedStateKey: result.successor.resolvedStateKey,
              resolvedY: result.successor.resolvedY,
              targetIndex: successorTargetIndex,
            },
          });
        }
      }
      for (const jobId of jobsById.keys()) {
        if (!seenResultIds.has(jobId)) {
          throw new GraphwarWasmAdapterError(
            "invalid-work-batch",
            `Step state layer is missing result ${jobId}`,
            "input",
          );
        }
      }
      const merged = this.append(successfulResults.flatMap((result) => (result.successor ? [result.successor] : [])));
      const nodeIdsByJobId = new Map<number, number>();
      for (const [index, result] of successfulResults.entries()) {
        const nodeId = merged.batchNodeIds[index];
        if (nodeId === undefined) {
          throw new GraphwarWasmAdapterError(
            "invalid-session-state",
            `Step state layer result ${result.jobId} lost its successor node`,
            "output",
          );
        }
        nodeIdsByJobId.set(result.jobId, nodeId);
      }
      layerCursor += 1;
      for (const jobId of jobsById.keys()) {
        consumedJobIds.add(jobId);
      }
      return {
        ...merged,
        jobNodeIds: input.results.map((result) => {
          const nodeId = nodeIdsByJobId.get(result.jobId);
          return nodeId === undefined ? { jobId: result.jobId } : { jobId: result.jobId, nodeId };
        }),
      };
    },
    cancel() {
      isActive = false;
    },
  };
}

/** Expands one stateful Step DAG layer in WASM; edge route execution stays with the existing Worker boundary. */
export function expandGraphwarWasmOneClickStepDagJobs(
  runtime: GraphwarWasmKernelRuntime,
  input: GraphwarWasmOneClickStepDagExpansionInput,
): GraphwarWasmOneClickStepDagExpansionJob[] {
  const mark = runtime.markArena();
  try {
    const targets = input.targets.map((target, index) => ({
      graphX: validateGraphwarWasmFiniteNumber(target.graphX, `targets[${index}].graphX`, "input"),
      routePoint: validatePoint(target.routePoint, `targets[${index}].routePoint`),
    }));
    for (let index = 1; index < targets.length; index += 1) {
      const previous = targets[index - 1];
      const current = targets[index];
      if (previous && current && current.graphX < previous.graphX) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-identity",
          `targets[${index}] is not ordered by graph x`,
          "input",
        );
      }
    }
    const sourceNodes = input.sourceNodes.map((source, index) => ({
      nodeId: validateGraphwarWasmU32(source.nodeId, `sourceNodes[${index}].nodeId`, "input"),
      targetIndex: validateGraphwarWasmU32(source.targetIndex, `sourceNodes[${index}].targetIndex`, "input"),
    }));
    const nodeCount = validateGraphwarWasmU32(input.nodeCount, "nodeCount", "input");
    const startPoint = validatePoint(input.startPoint, "startPoint");
    if (input.isStartExpansion && (sourceNodes.length !== 0 || nodeCount !== 0)) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "start stateful DAG expansion cannot carry source nodes",
        "input",
      );
    }
    if (!input.isStartExpansion && sourceNodes.some(({ nodeId }) => nodeId >= nodeCount)) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        "stateful DAG expansion source node is outside the retained evidence table",
        "input",
      );
    }
    const seenNodeIds = new Set<number>();
    let previousTargetIndex = -1;
    for (const [index, source] of sourceNodes.entries()) {
      if (seenNodeIds.has(source.nodeId)) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-identity",
          `sourceNodes[${index}] duplicates a source node id`,
          "input",
        );
      }
      if (source.targetIndex >= targets.length || source.targetIndex < previousTargetIndex) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-identity",
          `sourceNodes[${index}] is not ordered by target layer`,
          "input",
        );
      }
      seenNodeIds.add(source.nodeId);
      previousTargetIndex = source.targetIndex;
    }
    const targetX = writeGraphwarWasmFloat64Values(
      runtime,
      new Float64Array(targets.map(({ routePoint }) => routePoint.x)),
      runtime.arenaBase,
    );
    const targetY = writeGraphwarWasmFloat64Values(
      runtime,
      new Float64Array(targets.map(({ routePoint }) => routePoint.y)),
      runtime.arenaBase,
    );
    const targetGraphX = writeGraphwarWasmFloat64Values(
      runtime,
      new Float64Array(targets.map(({ graphX }) => graphX)),
      runtime.arenaBase,
    );
    const sourceNodeIds = writeGraphwarWasmUint32Values(
      runtime,
      Uint32Array.from(sourceNodes, ({ nodeId }) => nodeId),
      runtime.arenaBase,
    );
    const sourceTargets = writeGraphwarWasmUint32Values(
      runtime,
      Uint32Array.from(sourceNodes, ({ targetIndex }) => targetIndex),
      runtime.arenaBase,
    );
    const commandPointer = runtime.reserveArena(
      graphwarWasmCompositionLayout.oneClickStepDagExpansionInputByteLength,
      8,
    );
    const command = new DataView(
      runtime.buffer,
      commandPointer,
      graphwarWasmCompositionLayout.oneClickStepDagExpansionInputByteLength,
    );
    command.setUint32(0, oneClickStepDagExpansionMagic, true);
    command.setUint32(4, oneClickStepDagExpansionVersion, true);
    command.setUint32(
      oneClickStepDagExpansionInput.flags,
      input.isStartExpansion ? oneClickStepDagExpansionStartFlag : 0,
      true,
    );
    command.setUint32(oneClickStepDagExpansionInput.targetX, targetX.pointer, true);
    command.setUint32(oneClickStepDagExpansionInput.targetY, targetY.pointer, true);
    command.setUint32(oneClickStepDagExpansionInput.targetGraphX, targetGraphX.pointer, true);
    command.setUint32(oneClickStepDagExpansionInput.targetCount, targets.length, true);
    command.setUint32(oneClickStepDagExpansionInput.sourceNodeIds, sourceNodeIds.pointer, true);
    command.setUint32(oneClickStepDagExpansionInput.sourceTargets, sourceTargets.pointer, true);
    command.setUint32(oneClickStepDagExpansionInput.sourceCount, sourceNodes.length, true);
    command.setFloat64(oneClickStepDagExpansionInput.startX, startPoint.x, true);
    command.setFloat64(oneClickStepDagExpansionInput.startY, startPoint.y, true);
    command.setUint32(oneClickStepDagExpansionInput.nodeCount, nodeCount, true);
    const outputMinimumPointer = runtime.arenaCursor;
    const resultPointer = runtime.runRouteTask(
      oneClickStepDagExpansionCommand,
      commandPointer,
      graphwarWasmCompositionLayout.oneClickStepDagExpansionInputByteLength,
    );
    const resultRange = validateGraphwarWasmMemoryRange(
      runtime,
      { pointer: resultPointer, length: graphwarWasmCompositionLayout.oneClickStepDagExpansionResultByteLength },
      { alignment: 8, elementByteLength: 1, minimumPointer: outputMinimumPointer, sliceFaultDomain: "output" },
    );
    const result = new DataView(resultRange.buffer, resultRange.byteOffset, resultRange.byteLength);
    if (result.getUint32(oneClickStepDagExpansionResult.magic, true) !== oneClickStepDagExpansionMagic) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-pointer",
        "Step DAG expansion result magic is invalid",
        "output",
      );
    }
    if (result.getUint32(oneClickStepDagExpansionResult.status, true) !== 0) {
      throw new GraphwarWasmAdapterError("invalid-enum", "Step DAG expansion result status is invalid", "output");
    }
    const jobCount = validateGraphwarWasmU32(
      result.getUint32(oneClickStepDagExpansionResult.jobCount, true),
      "Step DAG expansion job count",
      "output",
    );
    const expectedJobCount = input.isStartExpansion
      ? targets.length
      : sourceNodes.reduce((count, source) => {
          const sourceGraphX = targets[source.targetIndex]?.graphX;
          if (sourceGraphX === undefined) {
            return count;
          }
          return count + targets.slice(source.targetIndex + 1).filter(({ graphX }) => graphX > sourceGraphX).length;
        }, 0);
    if (jobCount !== expectedJobCount) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        "Step DAG expansion returned an incomplete job batch",
        "output",
      );
    }
    const jobPointer = validateGraphwarWasmU32(
      result.getUint32(oneClickStepDagExpansionResult.jobs, true),
      "Step DAG expansion job pointer",
      "output",
    );
    const jobRange = validateGraphwarWasmMemoryRange(
      runtime,
      { pointer: jobPointer, length: jobCount * graphwarWasmCompositionLayout.oneClickStepDagExpansionJobByteLength },
      { alignment: 8, elementByteLength: 1, minimumPointer: outputMinimumPointer, sliceFaultDomain: "output" },
    );
    const jobView = new DataView(jobRange.buffer, jobRange.byteOffset, jobRange.byteLength);
    const sourceNodesById = new Map(sourceNodes.map((source) => [source.nodeId, source]));
    const jobIdentities = new Set<string>();
    const jobs = Array.from({ length: jobCount }, (_, index) => {
      const offset = index * graphwarWasmCompositionLayout.oneClickStepDagExpansionJobByteLength;
      const id = validateGraphwarWasmU32(
        jobView.getUint32(offset + oneClickStepDagExpansionJob.id, true),
        `jobs[${index}].id`,
        "output",
      );
      if (id !== index) {
        throw new GraphwarWasmAdapterError("unexpected-work-id", `jobs[${index}] has an unstable id`, "output");
      }
      const fromNodeId = validateGraphwarWasmU32(
        jobView.getUint32(offset + oneClickStepDagExpansionJob.fromNodeId, true),
        `jobs[${index}].fromNodeId`,
        "output",
      );
      const fromTargetIndex = validateGraphwarWasmU32(
        jobView.getUint32(offset + oneClickStepDagExpansionJob.fromTargetIndex, true),
        `jobs[${index}].fromTargetIndex`,
        "output",
      );
      const toTargetIndex = validateGraphwarWasmU32(
        jobView.getUint32(offset + oneClickStepDagExpansionJob.toTargetIndex, true),
        `jobs[${index}].toTargetIndex`,
        "output",
      );
      const start = {
        x: validateGraphwarWasmFiniteNumber(
          jobView.getFloat64(offset + oneClickStepDagExpansionJob.startX, true),
          `jobs[${index}].startX`,
          "output",
        ),
        y: validateGraphwarWasmFiniteNumber(
          jobView.getFloat64(offset + oneClickStepDagExpansionJob.startY, true),
          `jobs[${index}].startY`,
          "output",
        ),
      };
      const target = {
        x: validateGraphwarWasmFiniteNumber(
          jobView.getFloat64(offset + oneClickStepDagExpansionJob.targetX, true),
          `jobs[${index}].targetX`,
          "output",
        ),
        y: validateGraphwarWasmFiniteNumber(
          jobView.getFloat64(offset + oneClickStepDagExpansionJob.targetY, true),
          `jobs[${index}].targetY`,
          "output",
        ),
      };
      const expectedTarget = targets[toTargetIndex]?.routePoint;
      const expectedStart = fromNodeId === 0xffff_ffff ? startPoint : targets[fromTargetIndex]?.routePoint;
      const sourceNode = sourceNodesById.get(fromNodeId);
      const identity = `${fromNodeId}:${toTargetIndex}`;
      if (jobIdentities.has(identity)) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-identity",
          `jobs[${index}] duplicates a source/target identity`,
          "output",
        );
      }
      jobIdentities.add(identity);
      if (
        !expectedTarget ||
        !expectedStart ||
        !pointsEqual(target, expectedTarget) ||
        !pointsEqual(start, expectedStart) ||
        (input.isStartExpansion
          ? fromNodeId !== 0xffff_ffff || fromTargetIndex !== 0xffff_ffff
          : fromNodeId === 0xffff_ffff ||
            fromNodeId >= nodeCount ||
            sourceNode?.targetIndex !== fromTargetIndex ||
            fromTargetIndex >= targets.length ||
            toTargetIndex <= fromTargetIndex)
      ) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-identity",
          `jobs[${index}] does not preserve stateful DAG endpoint identity`,
          "output",
        );
      }
      return {
        fromNodeId,
        fromTargetIndex,
        id,
        startPoint: start,
        targetPoint: target,
        toTargetIndex,
      };
    });
    runtime.resetArena(mark);
    return jobs;
  } catch (error) {
    runtime.resetArenaAfterFault(mark);
    throw error;
  }
}

/**
 * Validates one complete one-click route in one WASM-owned formula/trajectory attempt. The launch result is copied
 * separately so callers can format the already-selected canonical materials without resolving the formula in TS.
 */
export function runGraphwarWasmOneClickTrajectoryValidation(
  runtime: GraphwarWasmKernelRuntime,
  input: GraphwarWasmOneClickTrajectoryValidationInput,
): GraphwarWasmOneClickTrajectoryValidationResult | undefined {
  const mark = runtime.markArena();
  try {
    const formula = prepareGraphwarWasmFormulaLaunch(runtime, input.descriptor);
    if (formula.status !== "success") {
      runtime.resetArena(mark);
      return undefined;
    }
    const trajectory = runGraphwarWasmTrajectory(runtime, {
      descriptor: input.descriptor,
      start: { type: "cold" },
      stop: input.stop,
    });
    if (!trajectory) {
      runtime.resetArena(mark);
      return undefined;
    }
    runtime.resetArena(mark);
    return { formula, trajectory };
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
    const commandPointer = runtime.reserveArena(packed.inputByteLength, 8);
    writeOneClickInput(runtime, commandPointer, packed);
    // begin may publish a retained session before a later runtime/result-boundary failure reaches this adapter.
    // Mark the command as started before crossing the boundary so the catch path always releases that session.
    hasBegunSessionCommand = true;
    beginArenaCursor = runtime.arenaCursor;
    const resultPointer = runtime.beginOneClickClear(commandPointer, packed.inputByteLength);
    const decoded = copyOneClickResult(
      runtime,
      resultPointer,
      packed.requestNonce,
      packed.verticalVariationScale,
      input.dagJobs ? packed.dagNodeCount : undefined,
      createOneClickOutputBoundary(
        beginArenaCursor,
        undefined,
        [],
        [],
        undefined,
        packed.path,
        packed.routeContextPointer,
      ),
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
  const protectedPointIndexes = validateProtectedPointIndexes(input.protectedPointIndexes, points.length);
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
  const protectedPointIndexSlice = writeGraphwarWasmUint32Values(
    runtime,
    new Uint32Array(protectedPointIndexes),
    runtime.arenaBase,
  );
  const hasGraphValidation = routeContextPointer !== 0 || input.trajectoryValidation.type === "trajectory";
  return {
    flags:
      (input.isDeleteOptimizationEnabled ? smartInputDeleteOptimizationFlag : 0) |
      (input.allowTerminalPointDeletion === true ? smartInputTerminalPointDeletionFlag : 0) |
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
    protectedPointIndexes: protectedPointIndexSlice,
  };
}

function validateProtectedPointIndexes(indexes: readonly number[] | undefined, pointCount: number) {
  if (indexes === undefined) {
    return [];
  }
  const validated: number[] = [];
  let previousIndex = -1;
  for (const [position, index] of indexes.entries()) {
    const value = validateGraphwarWasmU32(index, `protectedPointIndexes[${position}]`, "input");
    if (value >= pointCount || value <= previousIndex) {
      throw new GraphwarWasmAdapterError(
        "invalid-index",
        "protected point indexes must be strictly increasing source indexes",
        "input",
      );
    }
    validated.push(value);
    previousIndex = value;
  }
  return validated;
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
  const orderedTargets = validation.stop.orderedTargets;
  const orderedTarget = orderedTargets.at(-1);
  if (
    orderedTargets.length === 0 ||
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
      "smart trajectory stop policy does not match the final requested target",
      "input",
    );
  }
  const qualityPoints = validatePoints(validation.stop.qualityPoints, "trajectoryValidation.stop.qualityPoints");
  let descriptorIndex = 1;
  for (const [qualityIndex, point] of qualityPoints.entries()) {
    while (descriptorIndex < descriptorPoints.length - 1) {
      const descriptorPoint = descriptorPoints[descriptorIndex];
      if (descriptorPoint && pointsEqual(descriptorPoint, point)) {
        break;
      }
      descriptorIndex += 1;
    }
    if (descriptorIndex >= descriptorPoints.length - 1) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        `smart trajectory quality point ${qualityIndex} is not an ordered candidate point`,
        "input",
      );
    }
    descriptorIndex += 1;
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
  view.setUint32(smartInput.protectedPointIndexes, packed.protectedPointIndexes.pointer, true);
  view.setUint32(smartInput.protectedPointIndexCount, packed.protectedPointIndexes.length, true);
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
  const reachedRequiredTargetCount = validateGraphwarWasmU32(
    view.getUint32(smartResult.reachedRequiredTargetCount, true),
    "smart reached required target count",
  );
  const reachedTargetCount = validateGraphwarWasmU32(
    view.getUint32(smartResult.reachedTargetCount, true),
    "smart reached target count",
  );
  const hasTrajectoryValidation = input.trajectoryValidation.type === "trajectory";
  const requiredTargetLimit = hasTrajectoryValidation ? input.trajectoryValidation.stop.requiredTargets.length : 0;
  const orderedTargetLimit = hasTrajectoryValidation ? input.trajectoryValidation.stop.orderedTargets.length : 0;
  if (
    reachedRequiredTargetCount > requiredTargetLimit ||
    reachedTargetCount > orderedTargetLimit ||
    (!hasTrajectoryValidation && (reachedRequiredTargetCount !== 0 || reachedTargetCount !== 0))
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "smart target progress exceeds its trajectory validation identity",
      "output",
    );
  }
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
  const sourcePointIndexPointer = validateGraphwarWasmU32(
    view.getUint32(smartResult.sourcePointIndexes, true),
    "smart source-point-index pointer",
    "output",
  );
  const outputInputIndexes: number[] =
    status === 1
      ? Array.from(
          copyGraphwarWasmUint32Values(
            runtime,
            { pointer: sourcePointIndexPointer, length: pointCount },
            nestedOutputMinimumPointer,
          ),
        )
      : [];
  if (status === 0 && sourcePointIndexPointer !== 0) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "smart failure retains source-point provenance",
      "output",
    );
  }
  if (status === 1) {
    const inputLastPoint = validatedInputPoints.at(-1);
    const outputLastPoint = points.at(-1);
    const canDeleteTerminalPoint =
      input.allowTerminalPointDeletion === true &&
      input.isDeleteOptimizationEnabled &&
      input.trajectoryValidation.type === "trajectory";
    if (
      !inputLastPoint ||
      !outputLastPoint ||
      (!canDeleteTerminalPoint && !pointsEqual(inputLastPoint, outputLastPoint))
    ) {
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
    let previousInputIndex = -1;
    for (const [outputIndex, inputIndex] of outputInputIndexes.entries()) {
      if (
        inputIndex >= validatedOriginalPointCount ||
        inputIndex <= previousInputIndex ||
        !pointsEqual(validatedInputPoints[inputIndex] ?? { x: 0, y: 0 }, points[outputIndex] ?? { x: 0, y: 0 })
      ) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          `smart result source index ${inputIndex} is not an ordered source point`,
          "output",
        );
      }
      previousInputIndex = inputIndex;
    }
    const protectedPointIndexes = validateProtectedPointIndexes(
      input.protectedPointIndexes,
      validatedOriginalPointCount,
    );
    for (const protectedPointIndex of protectedPointIndexes) {
      if (!outputInputIndexes.includes(protectedPointIndex)) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-identity",
          `smart result dropped protected source point ${protectedPointIndex}`,
          "output",
        );
      }
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
      reachedRequiredTargetCount,
      reachedTargetCount,
      points,
      removedPointCount,
      status: "failure",
    };
  }
  return {
    reachedRequiredTargetCount,
    reachedTargetCount,
    points,
    removedPointCount,
    sourcePointIndexes: outputInputIndexes,
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
  const routeContextPointer = validateOptionalPointer(input.routeContextPointer, "routeContextPointer");
  if (routeContextPointer !== 0 && input.isDeleteOptimizationEnabled) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "one-click route-context composition cannot enable deletion without trajectory evidence",
      "input",
    );
  }
  const targetOrderKeys = input.targetOrderKeys
    ? input.targetOrderKeys.map((value, index) => validateGraphwarWasmU32(value, `targetOrderKeys[${index}]`, "input"))
    : [];
  if (targetOrderKeys.length !== 0 && targetOrderKeys.length !== candidates.length) {
    throw new GraphwarWasmAdapterError("invalid-index", "targetOrderKeys must match candidate count", "input");
  }
  const dagJobs = input.dagJobs ? input.dagJobs.map((job, index) => validateDagJob(job, index, candidates.length)) : [];
  const declaredDagNodeCount = input.dagJobs
    ? input.dagNodeCount === undefined
      ? undefined
      : validateGraphwarWasmU32(input.dagNodeCount, "dagNodeCount", "input")
    : undefined;
  const derivedDagNodeCount = deriveOneClickDagNodeCount(dagJobs);
  if (input.dagJobs && dagJobs.length > 0 && (declaredDagNodeCount ?? derivedDagNodeCount) === 0) {
    throw new GraphwarWasmAdapterError("invalid-session-state", "dagNodeCount must be positive", "input");
  }
  if (input.dagJobs && dagJobs.length === 0 && declaredDagNodeCount !== undefined && declaredDagNodeCount !== 0) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "dagNodeCount must be zero when dagJobs is empty",
      "input",
    );
  }
  const dagNodeCount = declaredDagNodeCount ?? derivedDagNodeCount;
  const dagNodeEvidenceIdentities = new Set<string>();
  const dagNodeEvidence = input.dagNodeEvidence
    ? input.dagNodeEvidence.map((entry, index) => {
        const targetIndex = validateGraphwarWasmU32(
          entry.targetIndex,
          `dagNodeEvidence[${index}].targetIndex`,
          "input",
        );
        const resolvedY = validateGraphwarWasmFiniteNumber(
          entry.resolvedY,
          `dagNodeEvidence[${index}].resolvedY`,
          "input",
        );
        if (targetIndex >= candidates.length) {
          throw new GraphwarWasmAdapterError(
            "invalid-index",
            `dagNodeEvidence[${index}] references an unknown target`,
            "input",
          );
        }
        try {
          if (BigInt(entry.resolvedStateKey).toString() !== entry.resolvedStateKey) {
            throw new Error("non-canonical");
          }
        } catch {
          throw new GraphwarWasmAdapterError(
            "invalid-session-identity",
            `dagNodeEvidence[${index}].resolvedStateKey is not canonical`,
            "input",
          );
        }
        const identity = `${targetIndex}:${entry.resolvedStateKey}`;
        if (dagNodeEvidenceIdentities.has(identity)) {
          throw new GraphwarWasmAdapterError(
            "invalid-session-identity",
            `dagNodeEvidence[${index}] duplicates a target/state identity`,
            "input",
          );
        }
        dagNodeEvidenceIdentities.add(identity);
        return { resolvedStateKey: entry.resolvedStateKey, resolvedY, targetIndex };
      })
    : [];
  if (dagNodeEvidence.length > 0 && (!input.dagJobs || !input.isStepStateful)) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "dagNodeEvidence requires an explicit stateful DAG",
      "input",
    );
  }
  if (input.isStepStateful && input.dagJobs && dagNodeEvidence.length !== dagNodeCount) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "stateful DAG node evidence count does not match dagNodeCount",
      "input",
    );
  }
  const dagEdgeIdentities = new Set<string>();
  const dagNodeTargetBindings = new Map<number, number>();
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
    bindDagNodeTarget(dagNodeTargetBindings, job.fromNodeId, job.from, index);
    bindDagNodeTarget(dagNodeTargetBindings, job.toNodeId, job.to, index);
  }
  validateDagNodeAcyclic(dagJobs);
  if (!input.dagJobs && input.dagNodeCount !== undefined) {
    throw new GraphwarWasmAdapterError("invalid-session-state", "dagNodeCount requires dagJobs", "input");
  }
  const dagNodeTargetEvidence = new Uint32Array(dagNodeEvidence.map(({ targetIndex }) => targetIndex));
  const dagNodeResolvedY = new Float64Array(dagNodeEvidence.map(({ resolvedY }) => resolvedY));
  const dagNodeKeyOffsets = new Uint32Array(dagNodeEvidence.length === 0 ? 0 : dagNodeEvidence.length + 1);
  const dagNodeKeyLengths = new Uint32Array(dagNodeEvidence.length);
  const dagNodeKeyByteLength = dagNodeEvidence.reduce(
    (length, { resolvedStateKey }) => length + resolvedStateKey.length,
    0,
  );
  const dagNodeKeyBytes = new Uint8Array(dagNodeKeyByteLength);
  let dagNodeKeyOffset = 0;
  for (const [index, { resolvedStateKey }] of dagNodeEvidence.entries()) {
    dagNodeKeyOffsets[index] = dagNodeKeyOffset;
    dagNodeKeyLengths[index] = resolvedStateKey.length;
    for (let characterIndex = 0; characterIndex < resolvedStateKey.length; characterIndex += 1) {
      const code = resolvedStateKey.charCodeAt(characterIndex);
      if (code > 0x7f) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-identity",
          `dagNodeEvidence[${index}].resolvedStateKey is not ASCII`,
          "input",
        );
      }
      dagNodeKeyBytes[dagNodeKeyOffset + characterIndex] = code;
    }
    dagNodeKeyOffset += resolvedStateKey.length;
  }
  dagNodeKeyOffsets[dagNodeEvidence.length] = dagNodeKeyOffset;
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
    dagNodeEvidenceCount: dagNodeEvidence.length,
    dagNodeKeyByteLength,
    dagNodeKeyBytes: writeGraphwarWasmBytes(runtime, dagNodeKeyBytes, runtime.arenaBase),
    dagNodeKeyLengths: writeGraphwarWasmUint32Values(runtime, dagNodeKeyLengths, runtime.arenaBase),
    dagNodeKeyOffsets: writeGraphwarWasmUint32Values(runtime, dagNodeKeyOffsets, runtime.arenaBase),
    dagNodeIds: writeGraphwarWasmUint32Values(runtime, dagNodeIds, runtime.arenaBase),
    dagNodeResolvedY: writeGraphwarWasmFloat64Values(runtime, dagNodeResolvedY, runtime.arenaBase),
    dagNodeTargets: writeGraphwarWasmUint32Values(runtime, dagNodeTargetEvidence, runtime.arenaBase),
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
    routeContextPointer,
    targetOrderKeys: writeGraphwarWasmUint32Values(runtime, Uint32Array.from(targetOrderKeys), runtime.arenaBase),
    verticalVariationScale,
    inputByteLength:
      dagNodeEvidence.length > 0 || (input.dagJobs !== undefined && input.isStepStateful)
        ? graphwarWasmCompositionLayout.oneClickInputEvidenceByteLength
        : graphwarWasmCompositionLayout.oneClickInputByteLength,
  };
}

/** The retained session owns node-table sizing; sparse retry descriptors use max-id + 1. */
function deriveOneClickDagNodeCount(dagJobs: readonly GraphwarWasmOneClickDagJob[]) {
  let maximumNodeId = -1;
  for (const job of dagJobs) {
    if (job.fromNodeId !== oneClickEdgeStartSentinel) {
      maximumNodeId = Math.max(maximumNodeId, job.fromNodeId);
    }
    maximumNodeId = Math.max(maximumNodeId, job.toNodeId);
  }
  return maximumNodeId + 1;
}

/** A retained node identity must represent one target column across every edge. */
function bindDagNodeTarget(nodeTargets: Map<number, number>, nodeId: number, targetIndex: number, jobIndex: number) {
  if (nodeId === oneClickEdgeStartSentinel) {
    return;
  }
  const previousTargetIndex = nodeTargets.get(nodeId);
  if (previousTargetIndex !== undefined && previousTargetIndex !== targetIndex) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      `dagJobs[${jobIndex}] reuses DAG node ${nodeId} for target ${targetIndex}, previously bound to ${previousTargetIndex}`,
      "input",
    );
  }
  nodeTargets.set(nodeId, targetIndex);
}

function packOneClickTargetAssignmentInput(
  runtime: GraphwarWasmKernelRuntime,
  input: GraphwarWasmOneClickTargetAssignmentInput,
) {
  const boundsRect = validateTargetAssignmentRect(input.boundsRect, "boundsRect");
  const usableRect = validateTargetAssignmentRect(input.usableRect, "usableRect");
  const pathTail = validatePoint(input.pathTail, "pathTail");
  const boundaryExpansion = validateNonNegativeFinite(input.boundaryExpansion, "boundaryExpansion");
  const sourceIndexes = new Set<number>();
  const candidates = input.candidates.flatMap((candidate, index) => {
    const sourceIndex = validateGraphwarWasmU32(candidate.sourceIndex, `candidates[${index}].sourceIndex`, "input");
    if (sourceIndexes.has(sourceIndex)) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        `candidates[${index}].sourceIndex is duplicated`,
        "input",
      );
    }
    sourceIndexes.add(sourceIndex);
    const radius = candidate.hitRadius;
    if (typeof radius !== "number" || !Number.isFinite(radius) || radius <= 0) {
      return [];
    }
    if (
      typeof candidate.center.x !== "number" ||
      !Number.isFinite(candidate.center.x) ||
      typeof candidate.center.y !== "number" ||
      !Number.isFinite(candidate.center.y)
    ) {
      return [];
    }
    return [{ point: validatePoint(candidate.center, `candidates[${index}].center`), radius, sourceIndex }];
  });
  return {
    boundaryExpansion,
    boundsRect,
    candidateSourceIndex: writeGraphwarWasmUint32Values(
      runtime,
      Uint32Array.from(candidates, ({ sourceIndex }) => sourceIndex),
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
    candidateGeometryBySourceIndex: new Map(
      candidates.map(({ point, radius, sourceIndex }) => [sourceIndex, { center: point, radius }]),
    ),
    flags: input.isMirrored ? oneClickTargetAssignmentMirroredFlag : 0,
    pathTail,
    usableRect,
  };
}

function validateTargetAssignmentRect(rect: BoundsRect, fieldName: string): BoundsRect {
  const x = validateGraphwarWasmFiniteNumber(rect.x, `${fieldName}.x`, "input");
  const y = validateGraphwarWasmFiniteNumber(rect.y, `${fieldName}.y`, "input");
  const width = validateGraphwarWasmFiniteNumber(rect.width, `${fieldName}.width`, "input");
  const height = validateGraphwarWasmFiniteNumber(rect.height, `${fieldName}.height`, "input");
  if (width <= 0 || height <= 0) {
    throw new GraphwarWasmAdapterError("invalid-finite-number", `${fieldName} dimensions must be positive`, "input");
  }
  return { height, width, x, y };
}

function writeOneClickTargetAssignmentInput(
  runtime: GraphwarWasmKernelRuntime,
  pointer: number,
  packed: ReturnType<typeof packOneClickTargetAssignmentInput>,
) {
  const view = new DataView(
    runtime.buffer,
    pointer,
    graphwarWasmCompositionLayout.oneClickTargetAssignmentInputByteLength,
  );
  view.setUint32(0, oneClickTargetAssignmentInputMagic, true);
  view.setUint32(4, oneClickTargetAssignmentInputVersion, true);
  view.setUint32(oneClickTargetAssignmentInput.flags, packed.flags, true);
  view.setUint32(oneClickTargetAssignmentInput.candidateX, packed.candidateX.pointer, true);
  view.setUint32(oneClickTargetAssignmentInput.candidateY, packed.candidateY.pointer, true);
  view.setUint32(oneClickTargetAssignmentInput.candidateRadius, packed.candidateRadius.pointer, true);
  view.setUint32(oneClickTargetAssignmentInput.candidateSourceIndex, packed.candidateSourceIndex.pointer, true);
  view.setUint32(oneClickTargetAssignmentInput.candidateCount, packed.candidateX.length, true);
  view.setFloat64(oneClickTargetAssignmentInput.pathTailX, packed.pathTail.x, true);
  view.setFloat64(oneClickTargetAssignmentInput.pathTailY, packed.pathTail.y, true);
  view.setFloat64(oneClickTargetAssignmentInput.boundsRectX, packed.boundsRect.x, true);
  view.setFloat64(oneClickTargetAssignmentInput.boundsRectY, packed.boundsRect.y, true);
  view.setFloat64(oneClickTargetAssignmentInput.boundsRectWidth, packed.boundsRect.width, true);
  view.setFloat64(oneClickTargetAssignmentInput.boundsRectHeight, packed.boundsRect.height, true);
  view.setFloat64(oneClickTargetAssignmentInput.usableRectX, packed.usableRect.x, true);
  view.setFloat64(oneClickTargetAssignmentInput.usableRectY, packed.usableRect.y, true);
  view.setFloat64(oneClickTargetAssignmentInput.usableRectWidth, packed.usableRect.width, true);
  view.setFloat64(oneClickTargetAssignmentInput.usableRectHeight, packed.usableRect.height, true);
  view.setFloat64(oneClickTargetAssignmentInput.boundaryExpansion, packed.boundaryExpansion, true);
}

function copyOneClickTargetAssignmentResult(
  runtime: GraphwarWasmMemorySource,
  resultPointer: number,
  packed: ReturnType<typeof packOneClickTargetAssignmentInput>,
  outputMinimumPointer: number,
): GraphwarWasmOneClickTargetAssignmentResult[] {
  const resultRange = validateGraphwarWasmMemoryRange(
    runtime,
    {
      length: graphwarWasmCompositionLayout.oneClickTargetAssignmentResultByteLength,
      pointer: resultPointer,
    },
    {
      alignment: 8,
      elementByteLength: 1,
      minimumPointer: outputMinimumPointer,
      sliceFaultDomain: "output",
    },
  );
  const view = new DataView(resultRange.buffer, resultRange.byteOffset, resultRange.byteLength);
  if (view.getUint32(oneClickTargetAssignmentResult.magic, true) !== oneClickTargetAssignmentResultMagic) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-pointer",
      "target-assignment result magic is invalid",
      "output",
    );
  }
  if (view.getUint32(oneClickTargetAssignmentResult.status, true) !== 0) {
    throw new GraphwarWasmAdapterError("invalid-enum", "target-assignment result status is invalid", "output");
  }
  const count = validateGraphwarWasmU32(view.getUint32(oneClickTargetAssignmentResult.count, true), "assignment count");
  if (count > packed.candidateX.length) {
    throw new GraphwarWasmAdapterError("invalid-index", "target-assignment count exceeds candidate count", "output");
  }
  const sourceIndexPointer = validateGraphwarWasmU32(
    view.getUint32(oneClickTargetAssignmentResult.sourceIndex, true),
    "assignment source-index pointer",
  );
  const routeXPointer = validateGraphwarWasmU32(
    view.getUint32(oneClickTargetAssignmentResult.routeX, true),
    "assignment route-x pointer",
  );
  const routeYPointer = validateGraphwarWasmU32(
    view.getUint32(oneClickTargetAssignmentResult.routeY, true),
    "assignment route-y pointer",
  );
  const boundary = createOneClickOutputBoundary(outputMinimumPointer);
  const sourceIndexes = copyOneClickUint32Values(
    runtime,
    sourceIndexPointer,
    count,
    boundary,
    "assignment source indexes",
    "fresh",
  );
  const routeXs = copyOneClickFloat64Values(runtime, routeXPointer, count, boundary, "assignment route x", "fresh");
  const routeYs = copyOneClickFloat64Values(runtime, routeYPointer, count, boundary, "assignment route y", "fresh");
  const inputSourceIndexSet = new Set(
    copyGraphwarWasmUint32Values(runtime, packed.candidateSourceIndex, runtime.arenaBase),
  );
  const sourceIndexSet = new Set<number>();
  for (const [index, sourceIndex] of sourceIndexes.entries()) {
    if (sourceIndexSet.has(sourceIndex) || !inputSourceIndexSet.has(sourceIndex)) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        `assignment source index ${sourceIndex} is duplicated or unknown`,
        "output",
      );
    }
    sourceIndexSet.add(sourceIndex);
    const routeX = validateGraphwarWasmFiniteNumber(routeXs[index], `assignment[${index}].routePoint.x`, "output");
    const routeY = validateGraphwarWasmFiniteNumber(routeYs[index], `assignment[${index}].routePoint.y`, "output");
    const candidate = packed.candidateGeometryBySourceIndex.get(sourceIndex);
    if (!candidate) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        `assignment[${index}] source index has no retained candidate geometry`,
        "output",
      );
    }
    if (routeY !== candidate.center.y || (routeX - candidate.center.x) ** 2 >= candidate.radius ** 2) {
      throw new GraphwarWasmAdapterError(
        "invalid-point-data",
        `assignment[${index}].routePoint is not inside its source candidate hit circle`,
        "output",
      );
    }
    if (
      routeX < packed.usableRect.x ||
      routeX >= packed.usableRect.x + packed.usableRect.width ||
      routeY < packed.usableRect.y ||
      routeY >= packed.usableRect.y + packed.usableRect.height
    ) {
      throw new GraphwarWasmAdapterError(
        "invalid-point-data",
        `assignment[${index}].routePoint is outside usableRect`,
        "output",
      );
    }
  }
  return sourceIndexes.map((sourceIndex, index) => {
    const candidate = packed.candidateGeometryBySourceIndex.get(sourceIndex);
    if (!candidate) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        `assignment[${index}] source index has no retained candidate geometry`,
        "output",
      );
    }
    return {
      hitCenter: { ...candidate.center },
      hitRadius: candidate.radius,
      routePoint: { x: routeXs[index] ?? 0, y: routeYs[index] ?? 0 },
      sourceIndex,
    };
  });
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
  const view = new DataView(runtime.buffer, pointer, packed.inputByteLength);
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
  if (packed.inputByteLength === graphwarWasmCompositionLayout.oneClickInputEvidenceByteLength) {
    view.setUint32(oneClickInput.dagNodeTargets, packed.dagNodeTargets.pointer, true);
    view.setUint32(oneClickInput.dagNodeResolvedY, packed.dagNodeResolvedY.pointer, true);
    view.setUint32(oneClickInput.dagNodeKeyOffsets, packed.dagNodeKeyOffsets.pointer, true);
    view.setUint32(oneClickInput.dagNodeKeyLengths, packed.dagNodeKeyLengths.pointer, true);
    view.setUint32(oneClickInput.dagNodeKeyBytes, packed.dagNodeKeyBytes.pointer, true);
    view.setUint32(oneClickInput.dagNodeKeyByteLength, packed.dagNodeKeyByteLength, true);
    view.setUint32(oneClickInput.dagNodeEvidenceCount, packed.dagNodeEvidenceCount, true);
  }
}

function copyOneClickResult(
  runtime: GraphwarWasmMemorySource,
  resultPointer: number,
  expectedRequestNonce?: number,
  expectedVerticalVariationScale?: number,
  expectedDagNodeCount?: number,
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
  const routeValidation = validateGraphwarWasmEnumValue(
    view.getUint32(oneClickResult.routeValidation, true),
    [oneClickRouteValidationNone, oneClickRouteValidationValidated] as const,
    "one-click route validation",
  );
  const removedPointCount = validateGraphwarWasmU32(
    view.getUint32(oneClickResult.removedPointCount, true),
    "one-click removed point count",
  );
  const expectedRouteContextPointer =
    boundary.retainedSession?.routeContextPointer ?? boundary.expectedRouteContextPointer ?? 0;
  if (routeValidation === oneClickRouteValidationValidated && expectedRouteContextPointer === 0) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "one-click route validation has no retained route context",
      "output",
    );
  }
  if (status === 0 && expectedRouteContextPointer !== 0 && routeValidation !== oneClickRouteValidationValidated) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "complete one-click result is missing route validation evidence",
      "output",
    );
  }
  if (status !== 0 && (routeValidation !== oneClickRouteValidationNone || removedPointCount !== 0)) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "non-terminal one-click result carries route validation evidence",
      "output",
    );
  }
  if (status === 2 && (routeValidation !== oneClickRouteValidationNone || removedPointCount !== 0)) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-state",
      "failed one-click result carries route validation evidence",
      "output",
    );
  }
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
      expectedDagNodeCount,
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
        boundary.expectedPath,
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
  const targetOrderRange = {
    alignment: Uint32Array.BYTES_PER_ELEMENT,
    length: targetCount * Uint32Array.BYTES_PER_ELEMENT,
    pointer: targetOrderPointer,
  } satisfies OneClickMemoryRange;
  const selectedEdgeIdsRange = {
    alignment: Uint32Array.BYTES_PER_ELEMENT,
    length: selectedEdgeCount * Uint32Array.BYTES_PER_ELEMENT,
    pointer: selectedEdgeIdsPointer,
  } satisfies OneClickMemoryRange;
  const pathXRange = {
    alignment: Float64Array.BYTES_PER_ELEMENT,
    length: pathCount * Float64Array.BYTES_PER_ELEMENT,
    pointer: pathXPointer,
  } satisfies OneClickMemoryRange;
  const pathYRange = {
    alignment: Float64Array.BYTES_PER_ELEMENT,
    length: pathCount * Float64Array.BYTES_PER_ELEMENT,
    pointer: pathYPointer,
  } satisfies OneClickMemoryRange;
  const terminalRanges = [targetOrderRange, selectedEdgeIdsRange, pathXRange, pathYRange].filter(
    ({ length }) => length > 0,
  );
  // A terminal record may reuse only the retained array for the same semantic field:
  // target order, or the matching source-path axis on a normal failure. Selected IDs
  // and successful paths must always be newly published output ranges.
  const liveRanges = [
    ...boundary.additionalRanges,
    ...(boundary.retainedSession?.ranges ?? []),
    ...boundary.forbiddenRanges,
  ].filter(({ length }) => length > 0);
  // Terminal fields must not overlap each other even when their pointers happen to
  // match a retained range. This keeps each published field's ownership explicit.
  assertOneClickRangesDisjoint(terminalRanges, "one-click terminal output", false);
  const allowedTerminalAliases = {
    targetOrder: retainedSession
      ? {
          alignment: Uint32Array.BYTES_PER_ELEMENT,
          length: targetCount * Uint32Array.BYTES_PER_ELEMENT,
          pointer: retainedSession.targetOrderPointer,
        }
      : undefined,
    pathX:
      retainedSession && status === 2
        ? {
            alignment: Float64Array.BYTES_PER_ELEMENT,
            length: pathCount * Float64Array.BYTES_PER_ELEMENT,
            pointer: retainedSession.pathXPointer,
          }
        : undefined,
    pathY:
      retainedSession && status === 2
        ? {
            alignment: Float64Array.BYTES_PER_ELEMENT,
            length: pathCount * Float64Array.BYTES_PER_ELEMENT,
            pointer: retainedSession.pathYPointer,
          }
        : undefined,
  };
  assertOneClickRangesDoNotOverlap(
    targetOrderRange.length > 0 ? [targetOrderRange] : [],
    liveRanges,
    "one-click terminal target order",
    allowedTerminalAliases.targetOrder ? [allowedTerminalAliases.targetOrder] : [],
  );
  assertOneClickRangesDoNotOverlap(
    selectedEdgeIdsRange.length > 0 ? [selectedEdgeIdsRange] : [],
    liveRanges,
    "one-click terminal selected edge ids",
  );
  assertOneClickRangesDoNotOverlap(
    pathXRange.length > 0 ? [pathXRange] : [],
    liveRanges,
    "one-click terminal path x",
    allowedTerminalAliases.pathX ? [allowedTerminalAliases.pathX] : [],
  );
  assertOneClickRangesDoNotOverlap(
    pathYRange.length > 0 ? [pathYRange] : [],
    liveRanges,
    "one-click terminal path y",
    allowedTerminalAliases.pathY ? [allowedTerminalAliases.pathY] : [],
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
      routeValidation === oneClickRouteValidationValidated ? removedPointCount : undefined,
    );
  }
  return {
    path,
    ...(routeValidation === oneClickRouteValidationValidated
      ? { routeValidation: { removedPointCount, type: "route-only" as const } }
      : {}),
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
    get stepStateEvidence() {
      return currentRetainedSession?.stepStateEvidence?.map((evidence) => ({ ...evidence }));
    },
    get layerCursor() {
      return currentRetainedSession?.layerCursor ?? 0;
    },
    cancel() {
      finish(false);
    },
    resume(results) {
      if (!isActive) {
        throw new GraphwarWasmAdapterError("invalid-session-state", "one-click session is no longer active", "input");
      }
      try {
        const isStatefulDag =
          (currentRetainedSession?.flags ?? 0) & oneClickExplicitDagFlag
            ? ((currentRetainedSession?.flags ?? 0) & oneClickStepStatefulFlag) !== 0
            : false;
        const work = packEdgeResults(runtime, results, currentEdgeJobs, nonce, requestNonce, isStatefulDag);
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
          undefined,
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
  isStatefulDag: boolean,
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
    const successor = result.successor;
    if (isStatefulDag) {
      if (result.reachable !== (successor !== undefined)) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-state",
          `stateful edge result ${jobId} must bind route and successor evidence together`,
          "input",
        );
      }
      if (successor) {
        const successorTargetIndex = validateGraphwarWasmU32(
          successor.targetIndex,
          `edgeResults[${index}].successor.targetIndex`,
          "input",
        );
        if (successorTargetIndex !== job.to) {
          throw new GraphwarWasmAdapterError(
            "invalid-session-identity",
            `edge result ${jobId} changed its successor target`,
            "input",
          );
        }
        validateGraphwarWasmFiniteNumber(successor.resolvedY, `edgeResults[${index}].successor.resolvedY`, "input");
        try {
          if (BigInt(successor.resolvedStateKey).toString() !== successor.resolvedStateKey)
            throw new Error("non-canonical");
        } catch {
          throw new GraphwarWasmAdapterError(
            "invalid-session-identity",
            `edgeResults[${index}].successor.resolvedStateKey is not canonical`,
            "input",
          );
        }
        if ([...successor.resolvedStateKey].some((character) => character.charCodeAt(0) > 0x7f)) {
          throw new GraphwarWasmAdapterError(
            "invalid-session-identity",
            `edgeResults[${index}].successor.resolvedStateKey is not ASCII`,
            "input",
          );
        }
      }
    } else if (successor !== undefined) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-state",
        `stateless edge result ${jobId} carries Step successor evidence`,
        "input",
      );
    }
    const packedSuccessorKey = successor
      ? writeGraphwarWasmBytes(
          runtime,
          Uint8Array.from([...successor.resolvedStateKey].map((character) => character.charCodeAt(0))),
          runtime.arenaBase,
        )
      : { pointer: 0, length: 0 };
    if (packedSuccessorKey.length > 0) {
      ranges.push({ alignment: 1, length: packedSuccessorKey.length, pointer: packedSuccessorKey.pointer });
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
    view.setUint32(oneClickEdgeResult.stateKey, packedSuccessorKey.pointer, true);
    view.setUint32(oneClickEdgeResult.stateKeyLength, packedSuccessorKey.length, true);
    view.setUint32(oneClickEdgeResult.targetIndex, successor?.targetIndex ?? 0, true);
    view.setFloat64(oneClickEdgeResult.resolvedY, successor?.resolvedY ?? 0, true);
    normalizedResults.push(
      result.reachable
        ? {
            jobId,
            reachable: true,
            requestNonce,
            route,
            sessionNonce,
            ...(successor ? { successor: { ...successor } } : {}),
          }
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
  expectedDagNodeCount?: number,
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
  const routeContextPointer = readPointer(oneClickSession.routeContext, "session route context pointer");
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
  if (
    boundary.expectedRouteContextPointer !== undefined &&
    routeContextPointer !== boundary.expectedRouteContextPointer
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "one-click session route context identity changed",
      "output",
    );
  }
  if (retainedSession && retainedSession.routeContextPointer !== routeContextPointer) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "one-click retained route context identity changed",
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
  if (expectedDagNodeCount !== undefined && dagNodeCount !== expectedDagNodeCount) {
    throw new GraphwarWasmAdapterError(
      "invalid-session-identity",
      "one-click session DAG node count changed before publication",
      "output",
    );
  }
  const isStatefulDag = isExplicitDag && (flags & oneClickStepStatefulFlag) !== 0;
  const layerCursor = validateGraphwarWasmU32(
    view.getUint32(oneClickSession.layerCursor, true),
    "session layer cursor",
    "output",
  );
  const nodeTargetsPointer = readPointer(oneClickSession.nodeTargets, "session node targets pointer");
  const nodeResolvedYPointer = readPointer(oneClickSession.nodeResolvedY, "session node resolved Y pointer");
  const nodeKeyOffsetsPointer = readPointer(oneClickSession.nodeKeyOffsets, "session node key offsets pointer");
  const nodeKeyLengthsPointer = readPointer(oneClickSession.nodeKeyLengths, "session node key lengths pointer");
  const nodeKeyBytesPointer = readPointer(oneClickSession.nodeKeyBytes, "session node key bytes pointer");
  const nodeKeyByteLength = validateGraphwarWasmU32(
    view.getUint32(oneClickSession.nodeKeyByteLength, true),
    "session node key byte length",
    "output",
  );
  const nodeEvidenceCount = validateGraphwarWasmU32(
    view.getUint32(oneClickSession.nodeEvidenceCount, true),
    "session node evidence count",
    "output",
  );
  const stepStateEvidence = isStatefulDag
    ? copyOneClickStepStateEvidence(
        runtime,
        {
          targets: nodeTargetsPointer,
          resolvedY: nodeResolvedYPointer,
          keyOffsets: nodeKeyOffsetsPointer,
          keyLengths: nodeKeyLengthsPointer,
          keyBytes: nodeKeyBytesPointer,
          keyByteLength: nodeKeyByteLength,
        },
        nodeEvidenceCount,
        sessionBoundary,
        sessionArraySource,
      )
    : [];
  if (!isStatefulDag) {
    if (
      layerCursor !== 0 ||
      nodeTargetsPointer !== 0 ||
      nodeResolvedYPointer !== 0 ||
      nodeKeyOffsetsPointer !== 0 ||
      nodeKeyLengthsPointer !== 0 ||
      nodeKeyBytesPointer !== 0 ||
      nodeKeyByteLength !== 0 ||
      nodeEvidenceCount !== 0
    ) {
      throw new GraphwarWasmAdapterError("invalid-session-state", "stateless session carries Step evidence", "output");
    }
  } else if (stepStateEvidence.length !== dagNodeCount) {
    throw new GraphwarWasmAdapterError("invalid-session-identity", "stateful session evidence count changed", "output");
  }
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
  if (boundary.expectedPath && !oneClickPointsArraysEqual(path, boundary.expectedPath)) {
    throw new GraphwarWasmAdapterError("invalid-session-identity", "one-click session source path changed", "output");
  }
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
    const expectedLayerCursor =
      retainedSession.layerCursor +
      (isStatefulDag &&
      (boundary.expectedWork?.length ?? 0) > 0 &&
      (boundary.expectedWork?.length ?? 0) === retainedSession.edgeJobCount - retainedSession.completedCount
        ? 1
        : 0);
    if (layerCursor !== expectedLayerCursor) {
      throw new GraphwarWasmAdapterError(
        "invalid-session-identity",
        "one-click retained state layer cursor changed unexpectedly",
        "output",
      );
    }
    if (
      stepStateEvidence.length !== (retainedSession.stepStateEvidence?.length ?? 0) ||
      stepStateEvidence.some((evidence, index) => {
        const previous = retainedSession.stepStateEvidence?.[index];
        return (
          !previous ||
          evidence.targetIndex !== previous.targetIndex ||
          evidence.resolvedStateKey !== previous.resolvedStateKey ||
          !Object.is(evidence.resolvedY, previous.resolvedY)
        );
      })
    ) {
      throw new GraphwarWasmAdapterError("invalid-session-identity", "one-click Step evidence changed", "output");
    }
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
  } else if (layerCursor === 0xffff_ffff) {
    throw new GraphwarWasmAdapterError("invalid-session-state", "stateful session layer cursor is exhausted", "output");
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
    ...(isStatefulDag
      ? [
          { alignment: 4, length: dagNodeCount * Uint32Array.BYTES_PER_ELEMENT, pointer: nodeTargetsPointer },
          { alignment: 8, length: dagNodeCount * Float64Array.BYTES_PER_ELEMENT, pointer: nodeResolvedYPointer },
          { alignment: 4, length: (dagNodeCount + 1) * Uint32Array.BYTES_PER_ELEMENT, pointer: nodeKeyOffsetsPointer },
          { alignment: 4, length: dagNodeCount * Uint32Array.BYTES_PER_ELEMENT, pointer: nodeKeyLengthsPointer },
          { alignment: 1, length: nodeKeyByteLength, pointer: nodeKeyBytesPointer },
        ]
      : []),
    ...(routeContextPointer === 0
      ? []
      : [{ alignment: 8, length: graphwarWasmRouteContextByteLength, pointer: routeContextPointer }]),
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
    const retainedEvidence = retainedSession.stepStateEvidence;
    if (
      (retainedSession.flags & oneClickExplicitDagFlag) !== 0 &&
      (retainedSession.flags & oneClickStepStatefulFlag) !== 0
    ) {
      if (
        nodeTargetsPointer !== retainedSession.nodeTargetsPointer ||
        nodeResolvedYPointer !== retainedSession.nodeResolvedYPointer ||
        nodeKeyOffsetsPointer !== retainedSession.nodeKeyOffsetsPointer ||
        nodeKeyLengthsPointer !== retainedSession.nodeKeyLengthsPointer ||
        nodeKeyBytesPointer !== retainedSession.nodeKeyBytesPointer ||
        nodeKeyByteLength !== retainedSession.nodeKeyByteLength ||
        nodeEvidenceCount !== retainedSession.nodeEvidenceCount ||
        stepStateEvidence.length !== (retainedEvidence?.length ?? 0)
      ) {
        throw new GraphwarWasmAdapterError(
          "invalid-session-identity",
          "one-click Step evidence storage changed",
          "output",
        );
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
    ...(routeContextPointer === 0
      ? []
      : [{ alignment: 8, length: graphwarWasmRouteContextByteLength, pointer: routeContextPointer }]),
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
    ...(isStatefulDag
      ? [
          { alignment: 4, length: dagNodeCount * Uint32Array.BYTES_PER_ELEMENT, pointer: nodeTargetsPointer },
          { alignment: 8, length: dagNodeCount * Float64Array.BYTES_PER_ELEMENT, pointer: nodeResolvedYPointer },
          { alignment: 4, length: (dagNodeCount + 1) * Uint32Array.BYTES_PER_ELEMENT, pointer: nodeKeyOffsetsPointer },
          { alignment: 4, length: dagNodeCount * Uint32Array.BYTES_PER_ELEMENT, pointer: nodeKeyLengthsPointer },
          { alignment: 1, length: nodeKeyByteLength, pointer: nodeKeyBytesPointer },
        ]
      : []),
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
      routeContextPointer,
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
      nodeTargetsPointer,
      nodeResolvedYPointer,
      nodeKeyOffsetsPointer,
      nodeKeyLengthsPointer,
      nodeKeyBytesPointer,
      nodeKeyByteLength,
      nodeEvidenceCount,
      stepStateEvidence: isStatefulDag ? stepStateEvidence.map((evidence) => ({ ...evidence })) : undefined,
      layerCursor,
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
