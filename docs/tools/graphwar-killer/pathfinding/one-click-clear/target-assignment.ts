import { createMinimumForwardPointAtGraphY } from "../../core/game/forward-rule";
import { createStrictPixelCircleXPlusIntegerEdgePoint, imageToGraphPoint, xPlusGoesRight } from "../../core/geometry";
import { clampNumber, graphXAdvancesStrictly, nextDownDouble, nextUpDouble } from "../../core/numbers";
import { createPixelPoint } from "../../core/types";
import type { BoundsRect, GraphBounds, PixelPoint } from "../../core/types";

/** 一键清图共享目标分配所需的截图像素命中圈；命中对象由调用方原样携带。 */
export interface GraphwarOneClickClearAssignmentCandidate<THitCircle = unknown> {
  /** 士兵真实命中圆心。 */
  center: PixelPoint;
  /** 调用方使用的原始命中对象。 */
  hitCircle: THitCircle;
  /** 截图像素中的真实命中半径。 */
  hitRadius: number;
  /** 候选输入中的稳定序号。 */
  sourceIndex: number;
}

/** 保留候选信息并附加共享分配得到的几何建路点。 */
export type GraphwarOneClickClearAssignedTarget<
  TTarget extends GraphwarOneClickClearAssignmentCandidate = GraphwarOneClickClearAssignmentCandidate,
> = TTarget & { routePoint: PixelPoint };

/** 一键清图共享目标分配所需的坐标映射、路径尾点和可用边界。 */
export interface GraphwarOneClickClearTargetAssignmentOptions<
  TTarget extends GraphwarOneClickClearAssignmentCandidate = GraphwarOneClickClearAssignmentCandidate,
> {
  /** 当前 Graphwar 坐标边界。 */
  bounds: GraphBounds;
  /** 截图内的 Graphwar 平面矩形。 */
  boundsRect: BoundsRect;
  /** 保持检测输入顺序的士兵候选。 */
  candidates: readonly TTarget[];
  /** 当前一键清图路径尾点。 */
  pathTail: PixelPoint;
  /** 可用区域最下方的截图 y 闭边界。 */
  usableMaxY: number;
  /** 可用区域最右方的截图 x 闭边界。 */
  usableMaxX: number;
  /** 可用区域最上方的截图 y 闭边界。 */
  usableMinY: number;
  /** 可用区域最左方的截图 x 闭边界。 */
  usableMinX: number;
}

/** 单个目标在统一递增的 Graph x+ 方向上可使用的闭区间。 */
interface TargetSafeXInterval {
  /** 靠近 Graph x- 的安全边界。 */
  left: number;
  /** 靠近 Graph x+ 的安全边界。 */
  right: number;
}

/** 已确定圆心或安全边缘初始落点的内部目标。 */
interface PreparedTarget<TTarget extends GraphwarOneClickClearAssignmentCandidate> {
  candidate: TTarget;
  initialForwardX: number;
  initialKind: "center" | "edge";
  initialRoutePoint: PixelPoint;
  safeInterval: TargetSafeXInterval;
}

/** 子组分配结果；lastControlForwardX 只记录能接入严格递增控制点序列的落点。 */
interface TargetSubgroupAssignment<TTarget extends GraphwarOneClickClearAssignmentCandidate> {
  assignedTargets: GraphwarOneClickClearAssignedTarget<TTarget>[];
  lastControlForwardX: number;
}

/**
 * 为所有一键清图模式分配目标落点。
 *
 * 初始 x 只负责分组；每组先放只能使用命中圆 x+ 边缘的目标，再放圆心目标。分配失败的目标保留初始落点，最终结果按分配后的 x 和稳定 y 优先级重新排序，供普通 DAG 和邪道扫描共享。
 */
export function assignGraphwarOneClickClearTargetRoutePoints<TTarget extends GraphwarOneClickClearAssignmentCandidate>(
  options: GraphwarOneClickClearTargetAssignmentOptions<TTarget>,
): GraphwarOneClickClearAssignedTarget<TTarget>[] {
  const xPlusIsRight = xPlusGoesRight(options.bounds);
  const pathTailForwardX = toForwardX(options.pathTail.x, xPlusIsRight);
  const pathTailGraphX = imageToGraphPoint(options.pathTail, options.bounds, options.boundsRect).x;
  const preparedTargets: PreparedTarget<TTarget>[] = [];

  for (const candidate of options.candidates) {
    const prepared = prepareTarget(candidate, options, xPlusIsRight, pathTailGraphX);
    if (prepared) {
      preparedTargets.push(prepared);
    }
  }
  preparedTargets.sort(
    (left, right) =>
      left.initialForwardX - right.initialForwardX ||
      right.candidate.center.y - left.candidate.center.y ||
      left.candidate.sourceIndex - right.candidate.sourceIndex,
  );

  const assignedTargets: GraphwarOneClickClearAssignedTarget<TTarget>[] = [];
  let lastControlForwardX = pathTailForwardX;
  let groupStart = 0;
  while (groupStart < preparedTargets.length) {
    const firstTarget = preparedTargets[groupStart];
    if (!firstTarget) {
      break;
    }
    let groupEnd = groupStart + 1;
    while (
      groupEnd < preparedTargets.length &&
      preparedTargets[groupEnd]?.initialRoutePoint.x === firstTarget.initialRoutePoint.x
    ) {
      groupEnd += 1;
    }

    const group = preparedTargets.slice(groupStart, groupEnd);
    const nextGroupForwardX = preparedTargets[groupEnd]?.initialForwardX;
    const edgeResult = assignTargetSubgroup(
      group.filter((target) => target.initialKind === "edge"),
      options,
      xPlusIsRight,
      lastControlForwardX,
      { open: false, value: firstTarget.initialForwardX },
    );
    assignedTargets.push(...edgeResult.assignedTargets);
    lastControlForwardX = edgeResult.lastControlForwardX;

    const centerTargets = group.filter((target) => target.initialKind === "center");
    const centerRightBoundary =
      nextGroupForwardX === undefined
        ? undefined
        : {
            open: true,
            value: nextGroupForwardX,
          };
    const centerResult = assignTargetSubgroup(
      centerTargets,
      options,
      xPlusIsRight,
      lastControlForwardX,
      centerRightBoundary,
    );
    assignedTargets.push(...centerResult.assignedTargets);
    lastControlForwardX = centerResult.lastControlForwardX;
    groupStart = groupEnd;
  }

  return assignedTargets.sort(
    (left, right) =>
      toForwardX(left.routePoint.x, xPlusIsRight) - toForwardX(right.routePoint.x, xPlusIsRight) ||
      right.center.y - left.center.y ||
      left.sourceIndex - right.sourceIndex,
  );
}

/** 计算候选的自身安全区间，并选择圆心或 x+ 安全边缘作为初始落点。 */
function prepareTarget<TTarget extends GraphwarOneClickClearAssignmentCandidate>(
  candidate: TTarget,
  options: GraphwarOneClickClearTargetAssignmentOptions<TTarget>,
  xPlusIsRight: boolean,
  pathTailGraphX: number,
): PreparedTarget<TTarget> | undefined {
  if (
    !Number.isFinite(candidate.center.x) ||
    !Number.isFinite(candidate.center.y) ||
    !Number.isFinite(candidate.hitRadius) ||
    candidate.hitRadius <= 0 ||
    candidate.center.y < options.usableMinY ||
    candidate.center.y > options.usableMaxY
  ) {
    return undefined;
  }

  const safeEdgePoint = createStrictPixelCircleXPlusIntegerEdgePoint(
    candidate.center,
    candidate.hitRadius,
    options.usableMinX,
    options.usableMaxX,
    xPlusIsRight,
  );
  const centerIsUsable = candidate.center.x >= options.usableMinX && candidate.center.x <= options.usableMaxX;
  const safeMinPixelX = Math.max(options.usableMinX, nextUpDouble(candidate.center.x - candidate.hitRadius));
  const safeMaxPixelX = Math.min(options.usableMaxX, nextDownDouble(candidate.center.x + candidate.hitRadius));
  if (safeMinPixelX > safeMaxPixelX) {
    return undefined;
  }
  const safeInterval = {
    left: toForwardX(xPlusIsRight ? safeMinPixelX : safeMaxPixelX, xPlusIsRight),
    right: toForwardX(xPlusIsRight ? safeMaxPixelX : safeMinPixelX, xPlusIsRight),
  };

  const centerGraphX = imageToGraphPoint(candidate.center, options.bounds, options.boundsRect).x;
  if (graphXAdvancesStrictly(pathTailGraphX, centerGraphX)) {
    return centerIsUsable
      ? {
          candidate,
          initialForwardX: toForwardX(candidate.center.x, xPlusIsRight),
          initialKind: "center",
          initialRoutePoint: candidate.center,
          safeInterval,
        }
      : undefined;
  }
  if (!safeEdgePoint) {
    return undefined;
  }

  return graphXAdvancesStrictly(pathTailGraphX, imageToGraphPoint(safeEdgePoint, options.bounds, options.boundsRect).x)
    ? {
        candidate,
        initialForwardX: toForwardX(safeEdgePoint.x, xPlusIsRight),
        initialKind: "edge",
        initialRoutePoint: safeEdgePoint,
        safeInterval,
      }
    : undefined;
}

/** 按 y 优先级稳定贪心分配一个边缘或圆心子组，失败项保留自己的初始落点。 */
function assignTargetSubgroup<TTarget extends GraphwarOneClickClearAssignmentCandidate>(
  targets: readonly PreparedTarget<TTarget>[],
  options: GraphwarOneClickClearTargetAssignmentOptions<TTarget>,
  xPlusIsRight: boolean,
  previousControlForwardX: number,
  requestedRightBoundary: { open: boolean; value: number } | undefined,
): TargetSubgroupAssignment<TTarget> {
  if (targets.length === 0) {
    return { assignedTargets: [], lastControlForwardX: previousControlForwardX };
  }

  const orderedTargets = [...targets].sort(
    (left, right) =>
      right.candidate.center.y - left.candidate.center.y || left.candidate.sourceIndex - right.candidate.sourceIndex,
  );
  const minimumSafeX = Math.min(...orderedTargets.map((target) => target.safeInterval.left));
  const maximumSafeX = Math.max(...orderedTargets.map((target) => target.safeInterval.right));
  let leftBoundary = Math.max(previousControlForwardX, minimumSafeX);
  let leftBoundaryOpen = previousControlForwardX >= minimumSafeX;
  const rightBoundary =
    requestedRightBoundary && requestedRightBoundary.value <= maximumSafeX
      ? requestedRightBoundary
      : { open: false, value: maximumSafeX };
  const assignedTargets: GraphwarOneClickClearAssignedTarget<TTarget>[] = [];

  for (let index = 0; index < orderedTargets.length; index += 1) {
    const target = orderedTargets[index];
    if (!target) {
      continue;
    }
    const remainingCount = orderedTargets.length - index;
    let idealX: number;
    if (
      targets.length === 1 &&
      target.initialKind === "center" &&
      target.initialForwardX > previousControlForwardX &&
      (!rightBoundary.open || target.initialForwardX < rightBoundary.value)
    ) {
      idealX = target.initialForwardX;
    } else if (leftBoundaryOpen) {
      idealX = leftBoundary + (rightBoundary.value - leftBoundary) / (remainingCount + (rightBoundary.open ? 1 : 0));
    } else {
      idealX = leftBoundary;
    }

    const targetRightBoundary = Math.min(target.safeInterval.right, rightBoundary.value);
    let assignedForwardX = clampNumber(idealX, target.safeInterval.left, targetRightBoundary);
    if (leftBoundaryOpen && assignedForwardX <= leftBoundary) {
      const previousPoint = createPixelPoint(fromForwardX(leftBoundary, xPlusIsRight), target.candidate.center.y);
      const graphY = imageToGraphPoint(target.candidate.center, options.bounds, options.boundsRect).y;
      const minimumForwardPoint = createMinimumForwardPointAtGraphY(
        previousPoint,
        graphY,
        options.bounds,
        options.boundsRect,
      );
      assignedForwardX = minimumForwardPoint
        ? toForwardX(minimumForwardPoint.x, xPlusIsRight)
        : Number.POSITIVE_INFINITY;
    }

    const routePoint = createPixelPoint(fromForwardX(assignedForwardX, xPlusIsRight), target.candidate.center.y);
    const routeGraphX = imageToGraphPoint(routePoint, options.bounds, options.boundsRect).x;
    const previousGraphX = imageToGraphPoint(
      createPixelPoint(fromForwardX(previousControlForwardX, xPlusIsRight), target.candidate.center.y),
      options.bounds,
      options.boundsRect,
    ).x;
    const insideOwnCircle = (routePoint.x - target.candidate.center.x) ** 2 < target.candidate.hitRadius ** 2;
    const assignmentIsValid =
      Number.isFinite(assignedForwardX) &&
      assignedForwardX >= target.safeInterval.left &&
      assignedForwardX <= target.safeInterval.right &&
      (rightBoundary.open ? assignedForwardX < rightBoundary.value : assignedForwardX <= rightBoundary.value) &&
      graphXAdvancesStrictly(previousGraphX, routeGraphX) &&
      insideOwnCircle;

    assignedTargets.push({
      ...target.candidate,
      routePoint: assignmentIsValid ? routePoint : target.initialRoutePoint,
    });
    if (assignmentIsValid) {
      previousControlForwardX = assignedForwardX;
      leftBoundary = assignedForwardX;
      leftBoundaryOpen = true;
    }
  }

  return { assignedTargets, lastControlForwardX: previousControlForwardX };
}

/** 将截图 x 投影到统一递增的 Graph x+ 方向。 */
function toForwardX(pixelX: number, xPlusIsRight: boolean) {
  return xPlusIsRight ? pixelX : -pixelX;
}

/** 将统一递增的一维坐标还原成截图像素 x。 */
function fromForwardX(forwardX: number, xPlusIsRight: boolean) {
  return xPlusIsRight ? forwardX : -forwardX;
}
