import { nextDownDouble, nextUpDouble } from "../../core/numbers";
import { createPixelPoint } from "../../core/types";
import type { PixelPoint } from "../../core/types";

/** Step 邪道清图分配所需的截图像素目标；hitCircle 由调用方原样携带。 */
export interface GraphwarStepGlitchTargetCandidate<THitCircle = unknown> {
  /** 士兵中心；候选输入应已按 x+ 方向排列。 */
  center: PixelPoint;
  /** 调用方使用的原始命中圈。 */
  hitCircle: THitCircle;
  /** 截图像素中的命中半径。 */
  hitRadius: number;
  /** 当前建路点；输出会保留 y 并替换 x。 */
  routePoint: PixelPoint;
  /** 候选输入中的稳定序号。 */
  sourceIndex: number;
}

export type GraphwarStepGlitchAssignedTarget<
  TTarget extends GraphwarStepGlitchTargetCandidate = GraphwarStepGlitchTargetCandidate,
> = Omit<TTarget, "routePoint"> & { routePoint: PixelPoint };

export interface GraphwarStepGlitchTargetAssignmentOptions<
  TTarget extends GraphwarStepGlitchTargetCandidate = GraphwarStepGlitchTargetCandidate,
> {
  /** 已按士兵中心 x+ 顺序排列的候选。 */
  candidates: readonly TTarget[];
  /** 发射士兵起始像素 y；同 x 组内优先分配纵向变化较小的士兵。 */
  pathStartY: number;
  /** 启动路径尾点像素 x；所有输出必须位于其 x+ 侧。 */
  pathTailX: number;
  /** Simulation 边界内可用的最右像素 x。 */
  usableMaxX: number;
  /** Simulation 边界内可用的最左像素 x。 */
  usableMinX: number;
  /** Graphwar x+ 是否对应截图向右。 */
  xPlusIsRight: boolean;
}

interface StepGlitchSafeXInterval {
  /** 沿 x+ 方向的一维坐标下界。 */
  left: number;
  /** 沿 x+ 方向的一维坐标上界。 */
  right: number;
}

// 圆周减法和平方可能让相邻几个 double 仍判为边界；失败时回退圆心，优先保证严格命中。
const MAX_STRICT_EDGE_NUDGES = 64;

/** 为同中心 x 的士兵分配稳定、严格递增且位于所有像素命中圆内部的控制点。 */
export function assignGraphwarStepGlitchTargetRoutePoints<TTarget extends GraphwarStepGlitchTargetCandidate>(
  options: GraphwarStepGlitchTargetAssignmentOptions<TTarget>,
): GraphwarStepGlitchAssignedTarget<TTarget>[] {
  const assignedTargets: GraphwarStepGlitchAssignedTarget<TTarget>[] = [];
  const pathTailForwardX = toForwardX(options.pathTailX, options.xPlusIsRight);
  let lastAssignedForwardX: number | undefined;
  let groupStart = 0;

  while (groupStart < options.candidates.length) {
    const groupCenterX = options.candidates[groupStart]?.center.x;
    let groupEnd = groupStart + 1;
    while (groupEnd < options.candidates.length && options.candidates[groupEnd]?.center.x === groupCenterX) {
      groupEnd += 1;
    }

    const group = options.candidates.slice(groupStart, groupEnd);
    const interval = createStepGlitchSafeXInterval(group, options);
    if (interval) {
      const groupCenterForwardX = toForwardX(groupCenterX ?? Number.NaN, options.xPlusIsRight);
      const nextCenterForwardX = toForwardX(options.candidates[groupEnd]?.center.x ?? Number.NaN, options.xPlusIsRight);
      const leftAnchor = selectStepGlitchLeftAnchor(interval, pathTailForwardX, lastAssignedForwardX);
      const rightAnchor = numberIsInsideInterval(nextCenterForwardX, interval) ? nextCenterForwardX : undefined;
      const orderedGroup = [...group].sort((left, right) =>
        compareStepGlitchTargetOrder(left, right, options.pathStartY),
      );
      const assignedForwardXs = createStepGlitchAssignedXs(
        orderedGroup.length,
        groupCenterForwardX,
        interval,
        leftAnchor,
        rightAnchor,
      );

      if (
        stepGlitchAssignmentsAreValid(
          assignedForwardXs,
          interval,
          lastAssignedForwardX ?? pathTailForwardX,
          rightAnchor,
        )
      ) {
        for (let index = 0; index < orderedGroup.length; index += 1) {
          const candidate = orderedGroup[index];
          const assignedForwardX = assignedForwardXs[index];
          if (!candidate || assignedForwardX === undefined || !Number.isFinite(candidate.center.y)) {
            continue;
          }

          assignedTargets.push({
            ...candidate,
            routePoint: createPixelPoint(fromForwardX(assignedForwardX, options.xPlusIsRight), candidate.center.y),
          });
          lastAssignedForwardX = assignedForwardX;
        }
      }
    }

    groupStart = groupEnd;
  }

  return assignedTargets;
}

function createStepGlitchSafeXInterval(
  targets: readonly GraphwarStepGlitchTargetCandidate[],
  options: Pick<GraphwarStepGlitchTargetAssignmentOptions, "usableMaxX" | "usableMinX" | "xPlusIsRight">,
): StepGlitchSafeXInterval | undefined {
  const usableStart = toForwardX(options.usableMinX, options.xPlusIsRight);
  const usableEnd = toForwardX(options.usableMaxX, options.xPlusIsRight);
  let left = Math.min(usableStart, usableEnd);
  let right = Math.max(usableStart, usableEnd);

  for (const target of targets) {
    if (
      !Number.isFinite(target.center.x) ||
      !Number.isFinite(target.center.y) ||
      !Number.isFinite(target.hitRadius) ||
      target.hitRadius <= 0
    ) {
      return undefined;
    }

    const centerX = toForwardX(target.center.x, options.xPlusIsRight);
    const targetInterval = createStrictCircleXInterval(centerX, target.hitRadius);
    if (!targetInterval) {
      return undefined;
    }
    left = Math.max(left, targetInterval.left);
    right = Math.min(right, targetInterval.right);
  }
  return left <= right ? { left, right } : undefined;
}

/** 用与轨迹采样相同的严格圆内判定寻找最靠近圆周的可表示像素 x。 */
function createStrictCircleXInterval(centerX: number, radius: number): StepGlitchSafeXInterval | undefined {
  const left = nudgeCircleEdgeInside(centerX - radius, centerX, radius, true);
  const right = nudgeCircleEdgeInside(centerX + radius, centerX, radius, false);
  return left !== undefined && right !== undefined && left <= right ? { left, right } : undefined;
}

function nudgeCircleEdgeInside(edgeX: number, centerX: number, radius: number, moveRight: boolean) {
  let x = edgeX;
  for (let attempt = 0; attempt < MAX_STRICT_EDGE_NUDGES; attempt += 1) {
    if ((x - centerX) ** 2 < radius ** 2) {
      return x;
    }
    x = moveRight ? nextUpDouble(x) : nextDownDouble(x);
  }
  return Number.isFinite(centerX) && radius > 0 ? centerX : undefined;
}

function selectStepGlitchLeftAnchor(
  interval: StepGlitchSafeXInterval,
  pathTailX: number,
  lastAssignedX: number | undefined,
) {
  let anchor: number | undefined;
  for (const value of [pathTailX, lastAssignedX]) {
    if (numberIsInsideInterval(value, interval) && (anchor === undefined || value > anchor)) {
      anchor = value;
    }
  }
  return anchor;
}

function numberIsInsideInterval(value: number | undefined, interval: StepGlitchSafeXInterval): value is number {
  return value !== undefined && Number.isFinite(value) && value >= interval.left && value <= interval.right;
}

function compareStepGlitchTargetOrder(
  left: GraphwarStepGlitchTargetCandidate,
  right: GraphwarStepGlitchTargetCandidate,
  pathStartY: number,
) {
  return (
    Math.abs(left.center.y - pathStartY) - Math.abs(right.center.y - pathStartY) ||
    right.center.y - left.center.y ||
    left.sourceIndex - right.sourceIndex
  );
}

function createStepGlitchAssignedXs(
  count: number,
  centerX: number,
  interval: StepGlitchSafeXInterval,
  leftAnchor: number | undefined,
  rightAnchor: number | undefined,
) {
  if (count <= 0) {
    return [];
  }
  if (leftAnchor !== undefined && rightAnchor !== undefined) {
    return createEvenlySpacedInteriorXs(count, leftAnchor, rightAnchor);
  }
  if (leftAnchor !== undefined) {
    return Array.from({ length: count }, (_, index) =>
      interpolateStepGlitchX(leftAnchor, interval.right, index + 1, count),
    );
  }
  if (rightAnchor !== undefined) {
    return Array.from({ length: count }, (_, index) =>
      interpolateStepGlitchX(interval.left, rightAnchor, index, count),
    );
  }
  if (count === 1) {
    return [centerX];
  }
  return Array.from({ length: count }, (_, index) =>
    interpolateStepGlitchX(interval.left, interval.right, index, count - 1),
  );
}

function stepGlitchAssignmentsAreValid(
  assignedXs: readonly number[],
  interval: StepGlitchSafeXInterval,
  previousX: number,
  rightAnchor: number | undefined,
) {
  for (const assignedX of assignedXs) {
    if (
      !Number.isFinite(assignedX) ||
      assignedX < interval.left ||
      assignedX > interval.right ||
      assignedX < nextUpDouble(previousX) ||
      (rightAnchor !== undefined && assignedX >= rightAnchor)
    ) {
      return false;
    }
    previousX = assignedX;
  }
  return true;
}

function createEvenlySpacedInteriorXs(count: number, left: number, right: number) {
  return Array.from({ length: count }, (_, index) => interpolateStepGlitchX(left, right, index + 1, count + 1));
}

function interpolateStepGlitchX(left: number, right: number, numerator: number, denominator: number) {
  return left + ((right - left) * numerator) / denominator;
}

function toForwardX(pixelX: number, xPlusIsRight: boolean) {
  return xPlusIsRight ? pixelX : -pixelX;
}

function fromForwardX(forwardX: number, xPlusIsRight: boolean) {
  return xPlusIsRight ? forwardX : -forwardX;
}
