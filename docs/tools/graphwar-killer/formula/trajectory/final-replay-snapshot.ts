import { pixelCirclesEqual, pixelPointsEqual } from "../../core/geometry";
import { createGraphPoint, createPixelPoint } from "../../core/types";
import type { BoundsRect, GraphBounds, PixelPoint } from "../../core/types";
import type { GraphwarTrajectorySamplingState } from "../simulation/simulator";
import type {
  GraphwarTrajectoryFormulaSettings,
  GraphwarTrajectorySampleResult,
  GraphwarTrajectoryTargetCircle,
} from "./sampling";
import { createGraphwarTrajectoryFormulaSettingsIdentityKey } from "./settings-identity";

/** 完整回放请求的精确身份；sample result 是证据输出，不参与请求匹配。 */
export interface GraphwarFinalReplayIdentity {
  boundaryExpansion: number;
  bounds: GraphBounds;
  boundsRect: BoundsRect;
  formulaSettingsIdentity: string;
  path: readonly PixelPoint[];
  /** 只允许提升自然停止、不中途按目标早停且已收集可见像素的完整回放。 */
  replaySemantics: "full-natural-visible";
  requiredTargets: readonly GraphwarTrajectoryTargetCircle[];
  simulationMask: Uint8Array;
  simulationMaskCacheId: number;
  targetControlPoints: readonly PixelPoint[];
  targetSequence: readonly GraphwarTrajectoryTargetCircle[];
  trackedTargets: readonly GraphwarTrajectoryTargetCircle[];
}

/** 跨 Module 保存的完整回放快照；身份和结果都在捕获时隔离可变数组。 */
export interface GraphwarFinalReplaySnapshot extends GraphwarFinalReplayIdentity {
  result: GraphwarTrajectorySampleResult;
}

/** 捕获或匹配完整回放时使用的算法无关请求材料。 */
export interface GraphwarFinalReplayRequest {
  boundaryExpansion?: number;
  bounds: GraphBounds;
  boundsRect: BoundsRect;
  formulaSettings: GraphwarTrajectoryFormulaSettings;
  path: readonly PixelPoint[];
  /** Producer 必须显式声明 result 满足完整自然可见回放 contract。 */
  replaySemantics: "full-natural-visible";
  requiredTargets: readonly GraphwarTrajectoryTargetCircle[];
  simulationMask: Uint8Array;
  simulationMaskCacheId: number;
  targetControlPoints: readonly PixelPoint[];
  targetSequence: readonly GraphwarTrajectoryTargetCircle[];
  trackedTargets: readonly GraphwarTrajectoryTargetCircle[];
}

/** 一次性复制完整回放输入与输出，避免 scanner/search seam 两侧分别维护字段同步知识。 */
export function captureGraphwarFinalReplaySnapshot(
  request: GraphwarFinalReplayRequest & { result: GraphwarTrajectorySampleResult },
): GraphwarFinalReplaySnapshot {
  return {
    boundaryExpansion: normalizeBoundaryExpansion(request.boundaryExpansion),
    bounds: { ...request.bounds },
    boundsRect: { ...request.boundsRect },
    formulaSettingsIdentity: createGraphwarTrajectoryFormulaSettingsIdentityKey(request.formulaSettings),
    path: request.path.map(copyPixelPoint),
    replaySemantics: request.replaySemantics,
    requiredTargets: request.requiredTargets.map(copyTargetCircle),
    result: copyGraphwarTrajectorySampleResult(request.result),
    simulationMask: request.simulationMask.slice(),
    simulationMaskCacheId: request.simulationMaskCacheId,
    targetControlPoints: request.targetControlPoints.map(copyPixelPoint),
    targetSequence: request.targetSequence.map(copyTargetCircle),
    trackedTargets: request.trackedTargets.map(copyTargetCircle),
  };
}

/** 逐项精确匹配当前请求；任一身份失配都让调用方沿原 cold final replay 路径重算。 */
export function graphwarFinalReplaySnapshotMatches(
  snapshot: GraphwarFinalReplaySnapshot,
  request: GraphwarFinalReplayRequest,
) {
  return (
    snapshot.boundaryExpansion === normalizeBoundaryExpansion(request.boundaryExpansion) &&
    snapshot.simulationMaskCacheId === request.simulationMaskCacheId &&
    graphwarBoundsEqual(snapshot.bounds, request.bounds) &&
    graphwarBoundsRectEqual(snapshot.boundsRect, request.boundsRect) &&
    graphwarPixelPathsEqual(snapshot.path, request.path) &&
    snapshot.replaySemantics === request.replaySemantics &&
    graphwarPixelPathsEqual(snapshot.targetControlPoints, request.targetControlPoints) &&
    graphwarTargetCircleSequencesEqual(snapshot.targetSequence, request.targetSequence) &&
    graphwarTargetCircleSequencesEqual(snapshot.requiredTargets, request.requiredTargets) &&
    graphwarTargetCircleSequencesEqual(snapshot.trackedTargets, request.trackedTargets) &&
    graphwarByteArraysEqual(snapshot.simulationMask, request.simulationMask) &&
    snapshot.formulaSettingsIdentity === createGraphwarTrajectoryFormulaSettingsIdentityKey(request.formulaSettings)
  );
}

/** 路径按原始像素 double 值和顺序精确比较。 */
export function graphwarPixelPathsEqual(left: readonly PixelPoint[], right: readonly PixelPoint[]) {
  return left.length === right.length && left.every((point, index) => pixelPointsEqual(point, right[index]));
}

/** Mask 按全部字节精确比较，拒绝同引用原地变更后的旧证据。 */
export function graphwarByteArraysEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

/** 目标圆顺序属于回放语义，不能只比较数量或集合。 */
function graphwarTargetCircleSequencesEqual(
  left: readonly GraphwarTrajectoryTargetCircle[],
  right: readonly GraphwarTrajectoryTargetCircle[],
) {
  return left.length === right.length && left.every((target, index) => pixelCirclesEqual(target, right[index]));
}

/** Graphwar 坐标边界必须逐字段保持同一 double 身份。 */
function graphwarBoundsEqual(left: GraphBounds, right: GraphBounds) {
  return (
    Object.is(left.minX, right.minX) &&
    Object.is(left.maxX, right.maxX) &&
    Object.is(left.minY, right.minY) &&
    Object.is(left.maxY, right.maxY)
  );
}

/** 截图坐标矩形必须逐字段保持同一 double 身份。 */
function graphwarBoundsRectEqual(left: BoundsRect, right: BoundsRect) {
  return (
    Object.is(left.x, right.x) &&
    Object.is(left.y, right.y) &&
    Object.is(left.width, right.width) &&
    Object.is(left.height, right.height)
  );
}

/** Worker 输入允许小数或负值时沿用采样层的非负整数归一化语义。 */
function normalizeBoundaryExpansion(value: number | undefined) {
  return Math.max(0, Math.floor(value ?? 0));
}

/** 深复制完整 sample result，使快照不共享轨迹、命中索引或可见像素数组。 */
function copyGraphwarTrajectorySampleResult(result: GraphwarTrajectorySampleResult): GraphwarTrajectorySampleResult {
  return {
    ...(result.earlyStopReason === undefined ? {} : { earlyStopReason: result.earlyStopReason }),
    obstacleHitIndex: result.obstacleHitIndex,
    ...(result.pathError === undefined ? {} : { pathError: result.pathError }),
    reachedRequiredTargetCount: result.reachedRequiredTargetCount,
    reachedTargetCount: result.reachedTargetCount,
    requiredTargetsHitIndex: result.requiredTargetsHitIndex,
    sample: {
      ...(result.sample.endState ? { endState: copySamplingState(result.sample.endState) } : {}),
      points: result.sample.points.map((point) => createGraphPoint(point.x, point.y)),
      stopReason: result.sample.stopReason,
    },
    targetHitIndex: result.targetHitIndex,
    trackedTargetHitIndexes: [...result.trackedTargetHitIndexes],
    visiblePixels: result.visiblePixels.map(copyPixelPoint),
  };
}

/** 复制 RK4 恢复状态，保留可选导数和上一接受点。 */
function copySamplingState(state: GraphwarTrajectorySamplingState): GraphwarTrajectorySamplingState {
  return {
    currentPoint: createGraphPoint(state.currentPoint.x, state.currentPoint.y),
    ...(state.dy === undefined ? {} : { dy: state.dy }),
    ...(state.previousDy === undefined ? {} : { previousDy: state.previousDy }),
    ...(state.previousPoint ? { previousPoint: createGraphPoint(state.previousPoint.x, state.previousPoint.y) } : {}),
    sampleIndex: state.sampleIndex,
  };
}

/** 复制像素点并保留品牌类型。 */
function copyPixelPoint(point: PixelPoint) {
  return createPixelPoint(point.x, point.y);
}

/** 复制命中圆，避免请求侧后续原地修改。 */
function copyTargetCircle(target: GraphwarTrajectoryTargetCircle): GraphwarTrajectoryTargetCircle {
  return { center: copyPixelPoint(target.center), radius: target.radius };
}
