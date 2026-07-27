/**
 * 几何寻路启发式的规范数据源。
 *
 * TypeScript 搜索和 WASM session 初始化必须同时消费这里的值，避免预览节流、轮廓简化和候选枚举策略漂移。
 */
export const graphwarVisibilityGraphHeuristics = {
  /** 单格面积内的 cross 可能只是边界追踪噪声，不按凹角删除。 */
  concaveCrossTolerance: 1,
  /** 近共线阈值，容忍栅格化锯齿，但仍保留肉眼可见的折线拐点。 */
  collinearDistanceTolerance: 0.75,
  /** 边界点落在障碍上时，向外搜索可站立候选点的最大半径。 */
  contourFreeCellSearchRadius: 3,
  /** Route tolerance 到 RDP epsilon 的折算系数。 */
  rdpEpsilonRouteToleranceRatio: 0.75,
  /** RDP epsilon 上限，避免大 route tolerance 抹掉窄障碍拐点。 */
  rdpMaxEpsilon: 6,
  /** RDP epsilon 下限，避免原始像素锯齿产生过密候选点。 */
  rdpMinEpsilon: 1,
  /** 页面动画每帧最多显示的候选点数量。 */
  previewCandidateLimit: 64,
  /** 页面动画每帧最多显示的可见边数量。 */
  previewEdgeLimit: 24,
  /** 图搜索每扩展若干候选点后发送一次预览。 */
  previewExpansionInterval: 8,
} as const;

/** Theta* 搜索和预览的规范启发式数据。 */
export const graphwarThetaStarHeuristics = {
  /** 页面动画每隔若干扩展点刷新一次。 */
  previewExpansionInterval: 128,
  /** 搜索动画最多展示的候选点数量。 */
  previewCandidateLimit: 64,
  /** 搜索动画最多保留的已接受边数量。 */
  previewEdgeLimit: 24,
} as const;

/** Theta* 只向 x+ 前方探测这些列。 */
export const graphwarThetaStarLookaheadColumnOffsets = [1, 2, 4, 8, 16, 32, 64, 128] as const;

/** 为每个 WASM route session 生成独立的 Theta* 前视列数据。 */
export function createGraphwarThetaStarLookaheadColumnOffsetData() {
  return Uint8Array.from(graphwarThetaStarLookaheadColumnOffsets);
}

/**
 * 为 WASM session 生成稳定顺序的路线策略数值。
 *
 * 返回新数组，避免调用方修改全局策略；字段顺序由同文件测试锁定。
 */
export function createGraphwarRoutePolicyData() {
  return new Float64Array([
    graphwarVisibilityGraphHeuristics.concaveCrossTolerance,
    graphwarVisibilityGraphHeuristics.collinearDistanceTolerance,
    graphwarVisibilityGraphHeuristics.contourFreeCellSearchRadius,
    graphwarVisibilityGraphHeuristics.rdpEpsilonRouteToleranceRatio,
    graphwarVisibilityGraphHeuristics.rdpMaxEpsilon,
    graphwarVisibilityGraphHeuristics.rdpMinEpsilon,
    graphwarVisibilityGraphHeuristics.previewCandidateLimit,
    graphwarVisibilityGraphHeuristics.previewEdgeLimit,
    graphwarVisibilityGraphHeuristics.previewExpansionInterval,
    graphwarThetaStarHeuristics.previewCandidateLimit,
    graphwarThetaStarHeuristics.previewEdgeLimit,
    graphwarThetaStarHeuristics.previewExpansionInterval,
  ]);
}
