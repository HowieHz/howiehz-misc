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

/** 保留候选信息并把建路点替换为严格 x+ 分配结果。 */
export type GraphwarStepGlitchAssignedTarget<
  TTarget extends GraphwarStepGlitchTargetCandidate = GraphwarStepGlitchTargetCandidate,
> = Omit<TTarget, "routePoint"> & { routePoint: PixelPoint };

/** Step 邪道目标分配所需的有序候选、边界和发射方向。 */
export interface GraphwarStepGlitchTargetAssignmentOptions<
  TTarget extends GraphwarStepGlitchTargetCandidate = GraphwarStepGlitchTargetCandidate,
> {
  /** 已按士兵中心 x+ 顺序排列的候选。 */
  candidates: readonly TTarget[];
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

/** 为同中心 x 的士兵分配稳定、沿 Graph x+ 严格前进且位于所有像素命中圆内部的控制点。 */
export function assignGraphwarStepGlitchTargetRoutePoints<TTarget extends GraphwarStepGlitchTargetCandidate>(
  options: GraphwarStepGlitchTargetAssignmentOptions<TTarget>,
): GraphwarStepGlitchAssignedTarget<TTarget>[] {
  const assignedTargets: GraphwarStepGlitchAssignedTarget<TTarget>[] = [];
  const pathTailForwardX = toForwardX(options.pathTailX, options.xPlusIsRight);
  let lastAssignedForwardX: number | undefined;
  let groupStart = 0;

  while (groupStart < options.candidates.length) {
    const firstCandidate = options.candidates[groupStart];
    if (!firstCandidate) {
      break;
    }
    const groupCenterX = firstCandidate.center.x;
    let groupEnd = groupStart + 1;
    while (groupEnd < options.candidates.length && options.candidates[groupEnd]?.center.x === groupCenterX) {
      groupEnd += 1;
    }

    const group = options.candidates.slice(groupStart, groupEnd);
    const interval = createStepGlitchSafeXInterval(group, options);
    if (interval) {
      const leftAnchor = selectStepGlitchLeftAnchor(interval, pathTailForwardX, lastAssignedForwardX);
      const nextCandidate = options.candidates[groupEnd];
      const nextCenterForwardX = nextCandidate ? toForwardX(nextCandidate.center.x, options.xPlusIsRight) : undefined;
      const rightAnchor = numberIsInsideInterval(nextCenterForwardX, interval) ? nextCenterForwardX : undefined;
      // 固定地图顺序可跨发射士兵复用前缀；相同 y 沿用输入序号，避免识别结果抖动。
      const orderedGroup = [...group].sort(
        (left, right) => right.center.y - left.center.y || left.sourceIndex - right.sourceIndex,
      );
      const assignedForwardXs = createStepGlitchAssignedXs(
        orderedGroup.length,
        toForwardX(groupCenterX, options.xPlusIsRight),
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
            routePoint: createPixelPoint(
              options.xPlusIsRight ? assignedForwardX : -assignedForwardX,
              candidate.center.y,
            ),
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

/** 取严格圆内最外侧的整数像素中心，给实际落点保留不足一个像素的数值余量。 */
function createStrictCircleXInterval(centerX: number, radius: number): StepGlitchSafeXInterval | undefined {
  const left = Math.floor(centerX - radius) + 1;
  const right = Math.ceil(centerX + radius) - 1;
  if ((left - centerX) ** 2 < radius ** 2 && (right - centerX) ** 2 < radius ** 2 && left <= right) {
    return { left, right };
  }
  return Number.isFinite(centerX) && radius > 0 ? { left: centerX, right: centerX } : undefined;
}

/** 选择安全区间内最靠 x+ 的既有锚点。 */
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

/** 判断有限值是否位于闭区间内，并为调用方收窄类型。 */
function numberIsInsideInterval(value: number | undefined, interval: StepGlitchSafeXInterval): value is number {
  return value !== undefined && Number.isFinite(value) && value >= interval.left && value <= interval.right;
}

/** 单例保留圆心；只有同 x 多目标才在锚点和严格命中区间之间均分。 */
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
  if (count === 1) {
    return [centerX];
  }
  if (leftAnchor !== undefined && rightAnchor !== undefined) {
    return Array.from({ length: count }, (_, index) =>
      interpolateStepGlitchX(leftAnchor, rightAnchor, index + 1, count + 1),
    );
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
  return Array.from({ length: count }, (_, index) =>
    interpolateStepGlitchX(interval.left, interval.right, index, count - 1),
  );
}

/** 验证分配点沿 Graph x+ 严格前进、位于安全区间内且没有越过前方锚点。 */
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
      assignedX <= previousX ||
      (rightAnchor !== undefined && assignedX >= rightAnchor)
    ) {
      return false;
    }
    previousX = assignedX;
  }
  return true;
}

/** 按整数序号在线性区间内分配一个控制点 x。 */
function interpolateStepGlitchX(left: number, right: number, numerator: number, denominator: number) {
  return left + ((right - left) * numerator) / denominator;
}

/** 将截图 x 投影到统一递增的 Graph x+ 方向。 */
function toForwardX(pixelX: number, xPlusIsRight: boolean) {
  return xPlusIsRight ? pixelX : -pixelX;
}
