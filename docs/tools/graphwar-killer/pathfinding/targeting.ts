import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../core/game/constants";
import {
  createMinimumForwardPointAtGraphY,
  graphXAdvancesFromPoint,
  pathFollowsGraphRule,
} from "../core/game/forward-rule";
/** Graphwar 目标选择规则；页面和寻路流程应复用同一套 x+ 与命中圈语义。 */
import { imageToGraphPoint, xPlusGoesRight } from "../core/geometry";
import { createPixelPoint } from "../core/types";
import type { BoundsRect, GraphBounds, PixelPoint } from "../core/types";

/** 可被目标规则消费的 Graphwar 士兵数据；页面检测框只需满足这些字段。 */
export interface GraphwarTargetingSoldier {
  /** 士兵命中圆半径，单位为截图像素。 */
  hitRadius: number;
  /** Graphwar 源码中心点 x，命中、发射和路径点都应使用它。 */
  sourceCenterX: number;
  /** Graphwar 源码中心点 y，命中、发射和路径点都应使用它。 */
  sourceCenterY: number;
}

/** 目标规则需要的当前坐标映射信息。 */
export interface GraphwarTargetingGeometry {
  /** 当前 Graphwar 坐标边界。 */
  bounds: GraphBounds;
  /** 截图内的 Graphwar 平面矩形。 */
  boundsRect: BoundsRect;
}

/** 目标规则需要的可点击区域；已经包含边界外扩后的收缩结果。 */
export interface GraphwarTargetingArea extends GraphwarTargetingGeometry {
  /** 当前可选目标区域，边界视为有效。 */
  targetBoundsRect: BoundsRect;
}

/** 命中圈判定：中心是 Graphwar 士兵源码中心，半径是源码 hitRadius。 */
export interface GraphwarHitCircle {
  /** 命中圈中心。 */
  center: PixelPoint;
  /** 命中圈半径，单位为截图像素。 */
  radius: number;
}

/** 士兵命中圈的 x+ 检查结果：center 优先，edge 表示只能瞄准最小前进线。 */
export interface GraphwarSoldierAimCheckResult {
  /** 通过哪一级检查。 */
  kind: "center" | "edge";
  /** 点击该士兵时首选追加或寻路的点。 */
  point: PixelPoint;
}

/** 智能寻路目标；几何路径可瞄准推进后的点，弹道仍应命中原命中圈。 */
export interface GraphwarSmartPathfindingSoldierTarget {
  /** 弹道必须命中的目标圈。 */
  hitCircle: GraphwarHitCircle;
  /** 几何路径要连接到的点。 */
  targetPoint: PixelPoint;
}

/** 按当前边界外扩把棋盘内部收缩成可选目标区域。 */
export function createBoundsRectWithBoundaryExpansion(rect: BoundsRect, boundaryExpansion: number) {
  const horizontalInset = (boundaryExpansion / GRAPHWAR_PLANE_LENGTH) * rect.width;
  const verticalInset = (boundaryExpansion / GRAPHWAR_PLANE_HEIGHT) * rect.height;
  if (horizontalInset * 2 >= rect.width || verticalInset * 2 >= rect.height) {
    return undefined;
  }

  return {
    x: rect.x + horizontalInset,
    y: rect.y + verticalInset,
    width: rect.width - horizontalInset * 2,
    height: rect.height - verticalInset * 2,
  };
}

/** 根据当前 x+ 最小前进线截出实际可点击区域。 */
export function createAllowedTargetRect(area: GraphwarTargetingArea, startPoint?: PixelPoint) {
  if (!startPoint) {
    return area.targetBoundsRect;
  }

  const minForwardPixelX = getMinimumForwardPixelX(startPoint, area);
  if (
    minForwardPixelX === undefined ||
    minForwardPixelX < area.targetBoundsRect.x ||
    minForwardPixelX > area.targetBoundsRect.x + area.targetBoundsRect.width
  ) {
    return undefined;
  }

  if (xPlusGoesRight(area.bounds)) {
    return {
      x: minForwardPixelX,
      y: area.targetBoundsRect.y,
      width: area.targetBoundsRect.x + area.targetBoundsRect.width - minForwardPixelX,
      height: area.targetBoundsRect.height,
    };
  }

  return {
    x: area.targetBoundsRect.x,
    y: area.targetBoundsRect.y,
    width: minForwardPixelX - area.targetBoundsRect.x,
    height: area.targetBoundsRect.height,
  };
}

/** 读取 Graphwar 士兵源码中心；命中、发射和路径点都应使用这个点。 */
export function getGraphwarSoldierCenter(soldier: GraphwarTargetingSoldier) {
  return createPixelPoint(soldier.sourceCenterX, soldier.sourceCenterY);
}

/** 从士兵创建命中圆，统一目标选择和弹道命中判定。 */
export function createGraphwarSoldierHitCircle(soldier: GraphwarTargetingSoldier): GraphwarHitCircle {
  return {
    center: getGraphwarSoldierCenter(soldier),
    radius: soldier.hitRadius,
  };
}

/** 判断路径点是否落在 Graphwar 士兵实际命中圈内。 */
export function graphwarSoldierContainsHitPoint(soldier: GraphwarTargetingSoldier, point: PixelPoint) {
  const center = getGraphwarSoldierCenter(soldier);
  return Math.hypot(point.x - center.x, point.y - center.y) <= soldier.hitRadius;
}

/** 为士兵生成第一瞄点：中心可达用中心，否则用最小 x 步长推进到圆内。 */
export function createSearchStartSoldierAimPoint(
  startPoint: PixelPoint | undefined,
  soldier: GraphwarTargetingSoldier,
  area: GraphwarTargetingArea,
) {
  return createSoldierAimCheckResult(startPoint, soldier, area)?.point;
}

/** 检查士兵中心点和 x+ 边缘点是否满足最小前进规则，保留首个可用结果。 */
export function createSoldierAimCheckResult(
  startPoint: PixelPoint | undefined,
  soldier: GraphwarTargetingSoldier,
  area: GraphwarTargetingArea,
): GraphwarSoldierAimCheckResult | undefined {
  const center = getGraphwarSoldierCenter(soldier);
  if (!startPoint) {
    return pointIsInsideTargetBounds(center, area) ? { kind: "center", point: center } : undefined;
  }

  if (soldierAimPointPassesMinimumForwardCheck(center, startPoint, area)) {
    return { kind: "center", point: center };
  }

  // 第二检查仅把命中圈 x+ 边缘作为“是否可选中”的资格线；
  // 真正落点固定为 lastX 的下一个可表示 double，y 保持命中圈中心，避免点击偏移改变目标。
  if (!graphwarPointAdvances(startPoint, createSoldierHitCircleXPlusEdgePoint(soldier, area), area)) {
    return undefined;
  }

  const minimumForwardPoint = createMinimumForwardSoldierTargetPoint(startPoint, soldier, area);
  return minimumForwardPoint ? { kind: "edge", point: minimumForwardPoint } : undefined;
}

/** 构造普通智能寻路的士兵目标：路径连到可用瞄点，弹道仍必须打中原命中圈。 */
export function createSmartPathfindingSoldierTarget(
  startPoint: PixelPoint,
  soldier: GraphwarTargetingSoldier,
  area: GraphwarTargetingArea,
): GraphwarSmartPathfindingSoldierTarget | undefined {
  const targetPoint = createSearchStartSoldierAimPoint(startPoint, soldier, area);
  if (!targetPoint) {
    return undefined;
  }

  return {
    hitCircle: createGraphwarSoldierHitCircle(soldier),
    targetPoint,
  };
}

/** 按指定起点把 x 不够的目标改为同 y 的最小 double x+ 点；无剩余空间时返回 undefined。 */
export function createMinimumForwardTargetPoint(
  point: PixelPoint,
  area: GraphwarTargetingArea,
  startPoint?: PixelPoint,
) {
  if (!startPoint) {
    return pointIsInsideTargetBounds(point, area) ? point : undefined;
  }

  if (point.y < area.targetBoundsRect.y || point.y > area.targetBoundsRect.y + area.targetBoundsRect.height) {
    return undefined;
  }

  const targetGraph = imageToGraphPoint(point, area.bounds, area.boundsRect);

  // 设计意图：非士兵点击如果落在 x+ 打击范围左侧，目标应移到
  // “最后一个路径点之后的下一个可表示 double x”，y 保持点击值；这里不做
  // 障碍、寻路或额外命中判断，只检查最终 xy 是否仍在可用边界内。
  const targetPoint = graphXReachesMinimumForward(targetGraph.x, startPoint, area)
    ? point
    : createMinimumForwardPointAtGraphY(startPoint, targetGraph.y, area.bounds, area.boundsRect);
  if (!targetPoint) {
    return undefined;
  }
  return pointIsInsideTargetBounds(targetPoint, area) ? targetPoint : undefined;
}

/** 生成最小 double x+ 处、且 y 保持士兵命中圈中心的目标点。 */
export function createMinimumForwardSoldierTargetPoint(
  startPoint: PixelPoint,
  soldier: GraphwarTargetingSoldier,
  area: GraphwarTargetingArea,
) {
  const center = getGraphwarSoldierCenter(soldier);
  const centerGraph = imageToGraphPoint(center, area.bounds, area.boundsRect);
  const targetPoint = createMinimumForwardPointAtGraphY(startPoint, centerGraph.y, area.bounds, area.boundsRect);
  if (!targetPoint) {
    return undefined;
  }
  return pointIsInsideTargetBounds(targetPoint, area) && graphwarSoldierContainsHitPoint(soldier, targetPoint)
    ? targetPoint
    : undefined;
}

/** 返回当前起点之后最小 double x+ 对应的截图 x，用于绘制可点区域预览。 */
export function getMinimumForwardPixelX(startPoint: PixelPoint, geometry: GraphwarTargetingGeometry) {
  const startGraph = imageToGraphPoint(startPoint, geometry.bounds, geometry.boundsRect);
  return createMinimumForwardPointAtGraphY(startPoint, startGraph.y, geometry.bounds, geometry.boundsRect)?.x;
}

/** 判断两个截图点映射到 Graphwar 后是否严格 x+。 */
export function graphwarPointAdvances(startPoint: PixelPoint, point: PixelPoint, geometry: GraphwarTargetingGeometry) {
  return pathFollowsGraphRule([startPoint, point], geometry.bounds, geometry.boundsRect);
}

/** 判断士兵中心是否位于起点 x+ 侧；命中圆边缘不参与候选过滤。 */
export function graphwarSoldierReachesForward(
  soldier: GraphwarTargetingSoldier,
  startPoint: PixelPoint,
  geometry: GraphwarTargetingGeometry,
) {
  return graphwarPointAdvances(startPoint, getGraphwarSoldierCenter(soldier), geometry);
}

/** 判断检测框中心是否在 Graphwar x<0 一侧。 */
export function graphwarSoldierIsOnNegativeGraphX(
  soldier: GraphwarTargetingSoldier,
  geometry: GraphwarTargetingGeometry,
) {
  const center = imageToGraphPoint(getGraphwarSoldierCenter(soldier), geometry.bounds, geometry.boundsRect);
  return center.x < 0;
}

/** 获取 Graphwar x 最大的已选路径点，用于过滤当前目标。 */
export function getRightmostPathPoint(points: readonly PixelPoint[], geometry: GraphwarTargetingGeometry) {
  let rightmostPoint: PixelPoint | undefined;
  let rightmostGraphX = -Infinity;
  for (const point of points) {
    const graphPoint = imageToGraphPoint(point, geometry.bounds, geometry.boundsRect);
    if (!rightmostPoint || graphPoint.x > rightmostGraphX) {
      rightmostPoint = point;
      rightmostGraphX = graphPoint.x;
    }
  }
  return rightmostPoint;
}

/** 判断点是否在考虑边界外扩后的可用目标区域内。 */
function pointIsInsideTargetBounds(point: PixelPoint, area: GraphwarTargetingArea) {
  return pointIsInsideBoundsRect(point, area.targetBoundsRect);
}

/** 判断点是否在指定截图矩形内，边界视为有效。 */
function pointIsInsideBoundsRect(point: PixelPoint, rect: BoundsRect) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

/** 判断一个士兵候选点是否严格沿 Graphwar x+ 前进，并且没有越出收缩边界。 */
function soldierAimPointPassesMinimumForwardCheck(
  point: PixelPoint,
  startPoint: PixelPoint,
  area: GraphwarTargetingArea,
) {
  return pointIsInsideTargetBounds(point, area) && graphwarPointAdvances(startPoint, point, area);
}

/** 返回士兵命中圈在 x+ 方向上的边缘点，y 固定为命中圈中心。 */
function createSoldierHitCircleXPlusEdgePoint(soldier: GraphwarTargetingSoldier, geometry: GraphwarTargetingGeometry) {
  const center = getGraphwarSoldierCenter(soldier);
  const xPlusIsRight = xPlusGoesRight(geometry.bounds);
  return createPixelPoint(center.x + (xPlusIsRight ? soldier.hitRadius : -soldier.hitRadius), center.y);
}

/** 判断给定 Graphwar x 是否已经严格位于截图起点对应的 Graphwar x+ 方向。 */
function graphXReachesMinimumForward(graphX: number, startPoint: PixelPoint, geometry: GraphwarTargetingGeometry) {
  return graphXAdvancesFromPoint(startPoint, graphX, geometry.bounds, geometry.boundsRect);
}
