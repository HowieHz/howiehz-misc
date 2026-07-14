import type { PixelPoint } from "../../core/types";
import {
  getGraphwarSoldierCenter,
  graphwarSoldierContainsHitPoint,
  graphwarSoldierIsOnNonPositiveGraphX,
  graphwarSoldierMatchesLaunchPoint,
  graphwarSoldierReachesForward,
  type GraphwarTargetingGeometry,
  type GraphwarTargetingSoldier,
} from "../targeting";
import type { GraphwarOneClickClearCandidate } from "./search";

/** 一键清图目标收集只需要稳定 id、命中圈和 Graphwar 源码中心。 */
export interface GraphwarOneClickClearTargetSoldier extends GraphwarTargetingSoldier {
  /** 识别结果里的稳定士兵 id。 */
  id: string;
}

/** 一键清图从当前路径、坐标映射和士兵集合派生候选所需的输入。 */
export interface GraphwarOneClickClearTargetCollectionOptions<
  TSoldier extends GraphwarOneClickClearTargetSoldier = GraphwarOneClickClearTargetSoldier,
> {
  /** 是否允许把友方士兵作为清图候选。 */
  friendlyFireEnabled: boolean;
  /** 当前坐标映射；缺失时一键清图入口候选应保持空结果。 */
  geometry: GraphwarTargetingGeometry | undefined;
  /** 当前路径像素点；第一个点视为发射士兵，最后一个点是一键清图起点。 */
  pathPoints: readonly PixelPoint[];
  /** 当前识别到的士兵，顺序应保持检测结果顺序。 */
  soldiers: readonly TSoldier[];
  /** Agent 可提供权威阵营；返回 undefined 时截图识别继续使用 x<=0 规则。 */
  isFriendlySoldier?: (soldier: TSoldier) => boolean | undefined;
}

/** 收集一键清图 DAG 入口候选；入口候选必须位于当前路径尾点的 x+ 侧。 */
export function createGraphwarOneClickClearCandidates<TSoldier extends GraphwarOneClickClearTargetSoldier>(
  options: GraphwarOneClickClearTargetCollectionOptions<TSoldier>,
): GraphwarOneClickClearCandidate[] {
  const startPoint = options.pathPoints.at(-1);
  if (!startPoint || !options.geometry) {
    return [];
  }

  const candidates: GraphwarOneClickClearCandidate[] = [];
  for (const soldier of options.soldiers) {
    const candidate = createOneClickClearTargetCandidate(options, soldier);
    if (
      !candidate ||
      // 只排除当前尾点已经命中的士兵，避免下一次清图重复追加同一目标；不持久化历史命中约束。
      graphwarSoldierContainsHitPoint(soldier, startPoint) ||
      !graphwarSoldierReachesForward(soldier, startPoint, options.geometry)
    ) {
      continue;
    }

    candidates.push(candidate);
  }
  return candidates;
}

/** 收集整条弹道可统计命中的士兵；这里只排除发射士兵，不按当前路径尾点右侧过滤。 */
export function createGraphwarOneClickClearHitCandidates<TSoldier extends GraphwarOneClickClearTargetSoldier>(
  options: GraphwarOneClickClearTargetCollectionOptions<TSoldier>,
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

/** 排除发射士兵和禁用的友军后，把检测结果投影为稳定清图候选。 */
function createOneClickClearTargetCandidate<TSoldier extends GraphwarOneClickClearTargetSoldier>(
  options: GraphwarOneClickClearTargetCollectionOptions<TSoldier>,
  soldier: TSoldier,
): GraphwarOneClickClearCandidate | undefined {
  if (graphwarSoldierMatchesLaunchPoint(options.pathPoints, soldier)) {
    return undefined;
  }

  const friendly = options.isFriendlySoldier?.(soldier) ?? isOneClickClearFriendlySoldier(options.geometry, soldier);
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

/** 当前规则下 x<=0 的非发射士兵视为友方；geometry 缺失时应沿用页面原本的非友方语义。 */
function isOneClickClearFriendlySoldier(
  geometry: GraphwarTargetingGeometry | undefined,
  soldier: GraphwarOneClickClearTargetSoldier,
) {
  return Boolean(geometry && graphwarSoldierIsOnNonPositiveGraphX(soldier, geometry));
}
