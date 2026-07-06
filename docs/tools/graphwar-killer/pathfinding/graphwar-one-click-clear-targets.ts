import type { PixelPoint } from "../core/types";
import type { GraphwarOneClickClearCandidate } from "./graphwar-one-click-clear";
import {
  getGraphwarSoldierCenter,
  graphwarSoldierContainsHitPoint,
  graphwarSoldierIsOnNegativeGraphX,
  graphwarSoldierReachesForward,
  type GraphwarTargetingGeometry,
  type GraphwarTargetingSoldier,
} from "./graphwar-targeting";

/** 一键清图目标收集只需要稳定 id、命中圈和 Graphwar 源码中心。 */
export interface GraphwarOneClickClearTargetSoldier extends GraphwarTargetingSoldier {
  /** 识别结果里的稳定士兵 id。 */
  id: string;
}

export interface GraphwarOneClickClearTargetCollectionOptions {
  /** 是否允许把友方士兵作为清图候选。 */
  friendlyFireEnabled: boolean;
  /** 当前坐标映射；缺失时一键清图入口候选应保持空结果。 */
  geometry: GraphwarTargetingGeometry | undefined;
  /** 当前路径像素点；第一个点视为发射士兵，最后一个点是一键清图起点。 */
  pathPoints: readonly PixelPoint[];
  /** 当前识别到的士兵，顺序应保持检测结果顺序。 */
  soldiers: readonly GraphwarOneClickClearTargetSoldier[];
}

/** 收集一键清图 DAG 入口候选；入口候选必须位于当前路径尾点的 x+ 侧。 */
export function createGraphwarOneClickClearCandidates(
  options: GraphwarOneClickClearTargetCollectionOptions,
): GraphwarOneClickClearCandidate[] {
  const startPoint = options.pathPoints.at(-1);
  if (!startPoint || !options.geometry) {
    return [];
  }

  const candidates: GraphwarOneClickClearCandidate[] = [];
  for (const soldier of options.soldiers) {
    const candidate = createOneClickClearTargetCandidate(options, soldier);
    if (!candidate || !graphwarSoldierReachesForward(soldier, startPoint, options.geometry)) {
      continue;
    }

    candidates.push(candidate);
  }
  return candidates;
}

/** 收集整条弹道可统计命中的士兵；这里只排除发射士兵，不按当前路径尾点右侧过滤。 */
export function createGraphwarOneClickClearHitCandidates(
  options: GraphwarOneClickClearTargetCollectionOptions,
): GraphwarOneClickClearCandidate[] {
  const candidates: GraphwarOneClickClearCandidate[] = [];
  for (const soldier of options.soldiers) {
    const candidate = createOneClickClearTargetCandidate(options, soldier);
    if (candidate) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

function createOneClickClearTargetCandidate(
  options: GraphwarOneClickClearTargetCollectionOptions,
  soldier: GraphwarOneClickClearTargetSoldier,
): GraphwarOneClickClearCandidate | undefined {
  if (isOneClickClearLaunchSoldier(options.pathPoints, soldier)) {
    return undefined;
  }

  const friendly = isOneClickClearFriendlySoldier(options.geometry, soldier);
  if (friendly && !options.friendlyFireEnabled) {
    return undefined;
  }

  const center = getGraphwarSoldierCenter(soldier);
  return {
    enemy: !friendly,
    hitCenter: center,
    hitRadius: soldier.hitRadius,
    id: soldier.id,
  };
}

/** 第一个路径点对应发射士兵；一键清图不应把它作为清图目标或命中统计。 */
function isOneClickClearLaunchSoldier(pathPoints: readonly PixelPoint[], soldier: GraphwarOneClickClearTargetSoldier) {
  const firstPoint = pathPoints[0];
  return Boolean(firstPoint && graphwarSoldierContainsHitPoint(soldier, firstPoint));
}

/** 当前规则下 x<0 的非发射士兵视为友方；geometry 缺失时应沿用页面原本的非友方语义。 */
function isOneClickClearFriendlySoldier(
  geometry: GraphwarTargetingGeometry | undefined,
  soldier: GraphwarOneClickClearTargetSoldier,
) {
  return Boolean(geometry && graphwarSoldierIsOnNegativeGraphX(soldier, geometry));
}
