import { GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import type { BoundsRect, GraphBounds, PixelPoint } from "../../core/types";
import type {
  GraphwarTrajectoryFormulaSettings,
  GraphwarTrajectoryTargetCircle,
} from "../../formula/trajectory/sampling";
import type { GraphwarPathfindingRouteMode } from "../routing/mode";
import type { GraphwarOneClickClearPathWorkerInput } from "../runtime/protocol";
import type { GraphwarOneClickClearCandidate } from "./search";

/** 一键清图搜索只消费已经解析成功的寻路容差，避免底层知道输入框和本地化文案。 */
export interface GraphwarOneClickClearSearchTolerances {
  /** 障碍和坐标系边界命中检测的内收值，单位为 Graphwar 原始平面像素。 */
  boundaryExpansionPlanePixels: number;
  /** 一键清图删点局部命中检查半径，单位为 Graphwar 原始平面像素。 */
  oneClickClearDeleteCheckRadiusPlanePixels: number;
  /** 几何路线规划容差，单位为 Graphwar 原始平面像素。 */
  routePlanningTolerancePlanePixels: number;
}

export type GraphwarOneClickClearSearchPreflightFailureReason =
  | "invalid-settings"
  | "missing-current-path"
  | "missing-obstacle-mask"
  | "unsupported-mode";

interface GraphwarOneClickClearSearchPreflightOptions {
  /** 成功解析后的 Graphwar 坐标边界；缺失时应保持页面原设置错误语义。 */
  bounds: GraphBounds | undefined;
  /** 前缀目标应懒创建，确保失败分支不额外读取当前检测命中圈。 */
  createPrefixTarget: () => GraphwarTrajectoryTargetCircle | undefined;
  /** 障碍 mask 应在路径和模式通过后再读取，保留原来的预检顺序。 */
  getObstacleMask: () => Uint8Array | undefined;
  /** 当前路径点数量；一键清图必须从已有路径尾部继续。 */
  pathPointCount: number;
  /** 成功解析后的 DAG 建边 worker 数量；缺失时应保持页面原设置错误语义。 */
  pathfindingWorkerCount: number | undefined;
  /** 成功解析后的寻路容差；缺失时应保持页面原设置错误语义。 */
  tolerances: GraphwarOneClickClearSearchTolerances | undefined;
  /** 当前公式模式是否不支持一键清图；用函数保留原来的校验顺序。 */
  unsupportedMode: () => boolean;
}

export type GraphwarOneClickClearSearchPreflightResult =
  | {
      /** 成功预检后，页面可直接用这些稳定快照构造 worker input。 */
      bounds: GraphBounds;
      dagEdgeWorkerCount: number;
      obstacleMask: Uint8Array;
      ok: true;
      prefixTarget: GraphwarTrajectoryTargetCircle | undefined;
      tolerances: GraphwarOneClickClearSearchTolerances;
    }
  | {
      /** 失败原因由页面映射成本地化状态和等级。 */
      ok: false;
      reason: GraphwarOneClickClearSearchPreflightFailureReason;
    };

interface GraphwarOneClickClearSearchInputOptions {
  /** 成功预检后的 Graphwar 坐标边界。 */
  bounds: GraphBounds;
  /** 截图内 Graphwar 坐标系矩形。 */
  boundsRect: BoundsRect;
  /** 一键清图 DAG 入口候选，顺序应保持目标收集 Module 输出。 */
  candidates: readonly GraphwarOneClickClearCandidate[];
  /** DAG 建边 worker 数量；页面继续负责输入解析和范围限制。 */
  dagEdgeWorkerCount: number;
  /** 全路径命中统计候选，不应被起点右侧规则过滤。 */
  hitCandidates: readonly GraphwarOneClickClearCandidate[];
  /** 当前路径快照；构造 input 时应复制，避免异步搜索读到后续编辑。 */
  pathPoints: readonly PixelPoint[];
  /** 当前路径尾点对应的预检命中圈；缺失时 worker 沿用无前缀目标语义。 */
  prefixTarget: GraphwarTrajectoryTargetCircle | undefined;
  /** 页面侧基础障碍 mask 的稳定 id，用于 worker 内 route mask cache。 */
  routeMaskCacheId: number;
  /** 几何路线算法模式；普通智能寻路和一键清图使用同一个开关。 */
  routeMode: GraphwarPathfindingRouteMode;
  /** 页面侧基础障碍 mask；worker 内部按 route tolerance 派生 route mask。 */
  routeObstacleMask: Uint8Array;
  /** 当前公式采样设置。 */
  settings: GraphwarTrajectoryFormulaSettings;
  /** 函数模拟用障碍 mask。 */
  simulationMask: Uint8Array | undefined;
  /** 成功预检后的寻路容差。 */
  tolerances: GraphwarOneClickClearSearchTolerances;
}

/** 按原运行顺序校验一键清图入口；底层只返回原因，不生成用户可见文案。 */
export function createGraphwarOneClickClearSearchPreflight(
  options: GraphwarOneClickClearSearchPreflightOptions,
): GraphwarOneClickClearSearchPreflightResult {
  if (!options.bounds || !options.tolerances || options.pathfindingWorkerCount === undefined) {
    return { ok: false, reason: "invalid-settings" };
  }
  if (options.unsupportedMode()) {
    return { ok: false, reason: "unsupported-mode" };
  }
  if (options.pathPointCount === 0) {
    return { ok: false, reason: "missing-current-path" };
  }

  const obstacleMask = options.getObstacleMask();
  if (!obstacleMask) {
    return { ok: false, reason: "missing-obstacle-mask" };
  }

  return {
    bounds: options.bounds,
    dagEdgeWorkerCount: options.pathfindingWorkerCount,
    obstacleMask,
    ok: true,
    prefixTarget: options.createPrefixTarget(),
    tolerances: options.tolerances,
  };
}

/** 构造可跨 Worker 传递的一键清图输入；当前路径应在这里集中成异步搜索快照。 */
export function createGraphwarOneClickClearSearchInput(
  options: GraphwarOneClickClearSearchInputOptions,
): GraphwarOneClickClearPathWorkerInput {
  return {
    boundaryExpansion: options.tolerances.boundaryExpansionPlanePixels,
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    candidates: options.candidates,
    dagEdgeWorkerCount: options.dagEdgeWorkerCount,
    // Worker 内删点命中检查在截图坐标里量距离，因此在协议边界从 Graphwar 平面像素换算为截图像素。
    deleteHitCheckRadiusPixels:
      options.tolerances.oneClickClearDeleteCheckRadiusPlanePixels * (options.boundsRect.width / GRAPHWAR_PLANE_LENGTH),
    hitCandidates: options.hitCandidates,
    pathPoints: [...options.pathPoints],
    prefixTarget: options.prefixTarget,
    routeMaskCacheId: options.routeMaskCacheId,
    routeMode: options.routeMode,
    routeObstacleMask: options.routeObstacleMask,
    routeTolerancePlanePixels: options.tolerances.routePlanningTolerancePlanePixels,
    settings: options.settings,
    simulationBoundaryExpansion: options.tolerances.boundaryExpansionPlanePixels,
    simulationMask: options.simulationMask,
  };
}
