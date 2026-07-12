import type { BoundsRect, GraphBounds, PixelPoint } from "../../../core/types";
import {
  createAllowedTargetRect as createGraphwarAllowedTargetRect,
  createGraphwarSoldierHitCircle,
  createMinimumForwardTargetPoint as createGraphwarMinimumForwardTargetPoint,
  createSearchStartSoldierAimPoint as createGraphwarSearchStartSoldierAimPoint,
  createSmartPathfindingSoldierTarget as createGraphwarSmartPathfindingSoldierTarget,
  getRightmostPathPoint as getGraphwarRightmostPathPoint,
  graphwarSoldierContainsHitPoint,
  graphwarSoldierIsOnNonPositiveGraphX,
  type GraphwarHitCircle,
  type GraphwarSmartPathfindingSoldierTarget,
  type GraphwarTargetingGeometry,
  type GraphwarTargetingSoldier,
} from "../../../pathfinding/targeting";

interface ReadonlyRef<T> {
  readonly value: T;
}

interface GraphwarTargetingContextOptions<TSoldier extends GraphwarTargetingSoldier> {
  /** 当前截图坐标系矩形；目标规则应始终使用页面当前标定。 */
  boundsRect: ReadonlyRef<BoundsRect>;
  /** 当前 Graphwar 坐标范围；无效时目标选择应保持原失败语义。 */
  getBounds: () => GraphBounds | undefined;
  /** 当前目标可选区域；不存在时应阻止目标选择。 */
  getTargetBoundsRect: () => BoundsRect | undefined;
  /** 当前路径；第一个点用于识别发射士兵，最后一点用于默认 x+ 起点。 */
  pathPixels: ReadonlyRef<readonly PixelPoint[]>;
  /** 当前算法是否要求普通落点使用士兵中心；单点寻路可另带 x+ 边缘 fallback。 */
  requireExactSoldierCenter: () => boolean;
  /** Agent 可提供权威阵营；返回 undefined 时截图识别继续使用 x<=0 规则。 */
  isFriendlySoldier?: (soldier: TSoldier) => boolean | undefined;
}

export interface GraphwarTargetingContextController<TSoldier extends GraphwarTargetingSoldier> {
  /** 根据当前路径尾点截出实际可点击区域。 */
  createAllowedTargetRect: () => BoundsRect | undefined;
  /** 创建当前目标规则的坐标映射输入。 */
  createGeometry: () => GraphwarTargetingGeometry | undefined;
  /** 按指定起点把 x 不够的目标改为同 y 的最小 double x+ 点。 */
  createMinimumForwardTargetPoint: (point: PixelPoint, startPoint?: PixelPoint) => PixelPoint | undefined;
  /** 为士兵生成第一瞄点：中心可达用中心，否则用最小 x 步长推进到圆内。 */
  createSearchStartSoldierAimPoint: (startPoint: PixelPoint | undefined, soldier: TSoldier) => PixelPoint | undefined;
  /** 从士兵创建命中圆，统一目标选择和弹道命中判定。 */
  createSoldierHitCircle: (soldier: TSoldier) => GraphwarHitCircle;
  /** 构造智能寻路士兵目标；Step 可携带命中圈 x+ 边缘 fallback。 */
  createSmartPathfindingSoldierTarget: (
    startPoint: PixelPoint,
    soldier: TSoldier,
  ) => GraphwarSmartPathfindingSoldierTarget | undefined;
  /** 获取 Graphwar x 最大的已选路径点，用于过滤当前目标。 */
  getRightmostPathPoint: () => PixelPoint | undefined;
  /** Agent 权威阵营优先；缺失时 x<=0 的非发射士兵视为友方障碍。 */
  isFriendlyObstacleSoldier: (soldier: TSoldier) => boolean;
  /** 优先使用 Agent 友军标记；缺失阵营时回退发射侧规则，中心线可作为发射点。 */
  isSoldierOnLaunchSide: (soldier: TSoldier) => boolean;
}

/** 集中把页面当前状态适配为 Graphwar 目标选择规则，避免页面散落 bounds/path 组合逻辑。 */
export function useGraphwarTargetingContext<TSoldier extends GraphwarTargetingSoldier>(
  options: GraphwarTargetingContextOptions<TSoldier>,
): GraphwarTargetingContextController<TSoldier> {
  /** 创建当前目标规则的坐标映射输入；无效 bounds 应保持原来的失败语义。 */
  function createGeometry() {
    const bounds = options.getBounds();
    return bounds ? { bounds, boundsRect: options.boundsRect.value } : undefined;
  }

  /** 创建当前目标规则的可点击区域输入；目标区域无效时应阻止目标选择。 */
  function createArea() {
    const geometry = createGeometry();
    const targetBoundsRect = options.getTargetBoundsRect();
    return geometry && targetBoundsRect ? { ...geometry, targetBoundsRect } : undefined;
  }

  function createAllowedTargetRect() {
    const area = createArea();
    return area ? createGraphwarAllowedTargetRect(area, options.pathPixels.value.at(-1)) : undefined;
  }

  function createMinimumForwardTargetPoint(point: PixelPoint, startPoint = options.pathPixels.value.at(-1)) {
    const area = createArea();
    return area ? createGraphwarMinimumForwardTargetPoint(point, area, startPoint) : undefined;
  }

  function createSearchStartSoldierAimPoint(startPoint: PixelPoint | undefined, soldier: TSoldier) {
    const area = createArea();
    return area
      ? createGraphwarSearchStartSoldierAimPoint(startPoint, soldier, area, options.requireExactSoldierCenter())
      : undefined;
  }

  function createSmartPathfindingSoldierTarget(startPoint: PixelPoint, soldier: TSoldier) {
    const area = createArea();
    return area
      ? createGraphwarSmartPathfindingSoldierTarget(startPoint, soldier, area, options.requireExactSoldierCenter())
      : undefined;
  }

  function createSoldierHitCircle(soldier: TSoldier) {
    return createGraphwarSoldierHitCircle(soldier);
  }

  function getRightmostPathPoint() {
    const geometry = createGeometry();
    return geometry && options.pathPixels.value.length > 0
      ? getGraphwarRightmostPathPoint(options.pathPixels.value, geometry)
      : undefined;
  }

  /** Agent 阵营优先；截图数据缺少阵营时才回退到 x<=0 发射侧规则。 */
  function isSoldierOnLaunchSide(soldier: TSoldier) {
    const authoritative = options.isFriendlySoldier?.(soldier);
    if (authoritative !== undefined) {
      return authoritative;
    }
    const geometry = createGeometry();
    return geometry ? graphwarSoldierIsOnNonPositiveGraphX(soldier, geometry) : false;
  }

  /** 排除发射士兵后按权威阵营判断友方；截图数据继续回退到发射侧规则。 */
  function isFriendlyObstacleSoldier(soldier: TSoldier) {
    const geometry = createGeometry();
    if (!geometry || soldierMatchesLaunchPoint(soldier)) {
      return false;
    }
    const authoritative = options.isFriendlySoldier?.(soldier);
    if (authoritative !== undefined) {
      return authoritative;
    }
    return graphwarSoldierIsOnNonPositiveGraphX(soldier, geometry);
  }

  /** 一键清图以第一个路径点作为发射士兵，后续路径点都是普通控制点。 */
  function soldierMatchesLaunchPoint(soldier: TSoldier) {
    const firstPoint = options.pathPixels.value[0];
    return Boolean(firstPoint && graphwarSoldierContainsHitPoint(soldier, firstPoint));
  }

  return {
    createAllowedTargetRect,
    createGeometry,
    createMinimumForwardTargetPoint,
    createSearchStartSoldierAimPoint,
    createSmartPathfindingSoldierTarget,
    createSoldierHitCircle,
    getRightmostPathPoint,
    isFriendlyObstacleSoldier,
    isSoldierOnLaunchSide,
  };
}
