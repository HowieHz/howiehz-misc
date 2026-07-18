import { GRAPHWAR_AUTO_CONTROL_POINT_MIN_FORWARD_PLANE_PIXELS, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { xPlusGoesRight } from "../../core/geometry";
import {
  forwardColumnToPlaneColumn,
  imageXToNearestPlaneColumn,
  imageXToPlaneX,
  planeColumnToForwardColumn,
  planeXToForwardX,
  planeXToImageX,
} from "../../core/plane-grid";
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

/** 一键清图共享目标分配所需的坐标映射、路径尾点和半开可用区域。 */
export interface GraphwarOneClickClearTargetAssignmentOptions<
  TTarget extends GraphwarOneClickClearAssignmentCandidate = GraphwarOneClickClearAssignmentCandidate,
> {
  /** 当前 Graphwar 坐标边界；只用于确定截图中的 x+ 方向。 */
  bounds: GraphBounds;
  /** 截图内的 Graphwar 平面矩形。 */
  boundsRect: BoundsRect;
  /** 保持检测输入顺序的士兵候选。 */
  candidates: readonly TTarget[];
  /** 当前一键清图路径尾点。 */
  pathTail: PixelPoint;
  /** 自动建路点可使用的半开截图矩形。 */
  usableRect: BoundsRect;
}

/** 已投影到首选原生 forward 列、等待稳定贪心分配的目标。 */
interface PreparedTarget<TTarget extends GraphwarOneClickClearAssignmentCandidate> {
  /** 原始候选及其真实命中对象。 */
  candidate: TTarget;
  /** 最近原生列映射到统一 x+ 坐标后的身份。 */
  preferredForwardColumn: number;
}

/**
 * 按 Graphwar 原生整数列为一键清图目标分配自动建路点。
 *
 * 单目标优先士兵中心所属列；同列多目标从最小合法 forward 列开始稳定贪心，为后续目标保留空间。每个目标最多检查 770 个列，失败目标不返回占位点。
 */
export function assignGraphwarOneClickClearTargetRoutePoints<TTarget extends GraphwarOneClickClearAssignmentCandidate>(
  options: GraphwarOneClickClearTargetAssignmentOptions<TTarget>,
): GraphwarOneClickClearAssignedTarget<TTarget>[] {
  if (
    !Number.isFinite(options.usableRect.x) ||
    !Number.isFinite(options.usableRect.y) ||
    !Number.isFinite(options.usableRect.width) ||
    !Number.isFinite(options.usableRect.height) ||
    options.usableRect.width <= 0 ||
    options.usableRect.height <= 0
  ) {
    return [];
  }

  const mirrored = !xPlusGoesRight(options.bounds);
  const preparedTargets: PreparedTarget<TTarget>[] = [];
  for (const candidate of options.candidates) {
    if (
      !Number.isFinite(candidate.center.x) ||
      !Number.isFinite(candidate.center.y) ||
      !Number.isFinite(candidate.hitRadius) ||
      candidate.hitRadius <= 0 ||
      candidate.center.y < options.usableRect.y ||
      candidate.center.y >= options.usableRect.y + options.usableRect.height
    ) {
      continue;
    }

    preparedTargets.push({
      candidate,
      preferredForwardColumn: planeColumnToForwardColumn(
        imageXToNearestPlaneColumn(candidate.center.x, options.boundsRect, mirrored),
        mirrored,
      ),
    });
  }
  preparedTargets.sort(
    (left, right) =>
      left.preferredForwardColumn - right.preferredForwardColumn ||
      right.candidate.center.y - left.candidate.center.y ||
      left.candidate.sourceIndex - right.candidate.sourceIndex,
  );

  const assignedTargets: GraphwarOneClickClearAssignedTarget<TTarget>[] = [];
  let previousForwardX = planeXToForwardX(imageXToPlaneX(options.pathTail.x, options.boundsRect), mirrored);
  let groupStart = 0;
  while (groupStart < preparedTargets.length) {
    const firstTarget = preparedTargets[groupStart];
    if (!firstTarget) {
      break;
    }

    let groupEnd = groupStart + 1;
    while (
      groupEnd < preparedTargets.length &&
      preparedTargets[groupEnd]?.preferredForwardColumn === firstTarget.preferredForwardColumn
    ) {
      groupEnd += 1;
    }
    const preferCenterColumn = groupEnd - groupStart === 1;

    for (let targetIndex = groupStart; targetIndex < groupEnd; targetIndex += 1) {
      const target = preparedTargets[targetIndex];
      if (!target) {
        continue;
      }

      const minimumForwardColumn = Math.max(
        0,
        Math.ceil(previousForwardX + GRAPHWAR_AUTO_CONTROL_POINT_MIN_FORWARD_PLANE_PIXELS),
      );
      if (minimumForwardColumn >= GRAPHWAR_PLANE_LENGTH) {
        continue;
      }

      // 单目标先检查中心所属列；失败后与同列多目标一样，从最小允许列顺序扫描。
      let forwardColumn =
        preferCenterColumn && target.preferredForwardColumn >= minimumForwardColumn
          ? target.preferredForwardColumn
          : minimumForwardColumn;
      let enumeratingFromMinimum = forwardColumn === minimumForwardColumn;
      let checkedColumnCount = 0;
      while (forwardColumn < GRAPHWAR_PLANE_LENGTH && checkedColumnCount < GRAPHWAR_PLANE_LENGTH) {
        const imageX = planeXToImageX(forwardColumnToPlaneColumn(forwardColumn, mirrored), options.boundsRect);
        checkedColumnCount += 1;
        if (
          imageX >= options.usableRect.x &&
          imageX < options.usableRect.x + options.usableRect.width &&
          forwardColumn - previousForwardX >= GRAPHWAR_AUTO_CONTROL_POINT_MIN_FORWARD_PLANE_PIXELS &&
          (imageX - target.candidate.center.x) ** 2 < target.candidate.hitRadius ** 2
        ) {
          assignedTargets.push({
            ...target.candidate,
            routePoint: createPixelPoint(imageX, target.candidate.center.y),
          });
          previousForwardX = forwardColumn;
          break;
        }

        if (!enumeratingFromMinimum) {
          forwardColumn = minimumForwardColumn;
          enumeratingFromMinimum = true;
        } else {
          forwardColumn += 1;
          // 中心列已经单独检查过；跳过它可保证每个目标最多检查 770 个不同列。
          if (preferCenterColumn && forwardColumn === target.preferredForwardColumn) {
            forwardColumn += 1;
          }
        }
      }
    }

    groupStart = groupEnd;
  }

  return assignedTargets;
}
