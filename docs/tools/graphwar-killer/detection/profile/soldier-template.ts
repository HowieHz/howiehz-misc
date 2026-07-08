/** 士兵模板 Profile 集中经验阈值和 Graphwar 20x20 贴图几何，检测流程应只消费这些常量。 */

/** Graphwar 士兵贴图源码画布是 20x20，Soldier.x/y 位于画布中心。 */
export const graphwarSoldierCanvasCenter = 10;
/** 非镜像士兵 alpha 外框在 20x20 画布里的视觉中心 x。 */
export const graphwarSoldierVisibleCenterX = 9.5;
/** 士兵 alpha 外框在 20x20 画布里的视觉中心 y。 */
export const graphwarSoldierVisibleCenterY = 9.5;
/** 镜像士兵 alpha 外框在 20x20 画布里的视觉中心 x。 */
export const graphwarSoldierMirrorVisibleCenterX = 10.5;

/** 固定像素分数阈值来自测试素材最终匹配点全局最低分；-0.05 容忍压缩、缩放和抗锯齿。 */
export const graphwarSoldierTemplateMinimumFixedScore = 0.80524047124047127 - 0.05;
/** 前景形状分数阈值来自测试素材最终匹配点全局最低分；-0.05 容忍压缩、缩放和抗锯齿。 */
export const graphwarSoldierTemplateMinimumForegroundScore = 0.69445266272189365 - 0.05;
/** 玩家色分数阈值来自测试素材最终匹配点全局最低分；-0.05 容忍压缩、缩放和抗锯齿。 */
export const graphwarSoldierTemplateMinimumPlayerScore = 0.60552198292591419 - 0.05;
/** 动画签名分数阈值来自测试素材最终匹配点全局最低分；-0.05 容忍压缩、缩放和抗锯齿。 */
export const graphwarSoldierTemplateMinimumSignatureScore = 0.71937830687830706 - 0.05;

/** 测试素材里无限制候选最终匹配点都在 votes 前 10%，因此模板评分前默认只保留前 10%。 */
export const defaultGraphwarSoldierTemplateCandidateTopRatio = 0.1;
/** Graphwar 游戏设定默认最多 40 个士兵；用于重叠抑制后的最终检测数量上限。 */
export const defaultGraphwarMaximumSoldierCount = 40;
/** 模板匹配默认并行 worker 数；页面会限制用户输入范围。 */
export const defaultGraphwarTemplateMatchingWorkerCount = 4;
/** 同一士兵附近会产生多个高分中心候选；低于这个源码像素间距的匹配视为同一士兵。 */
export const graphwarSoldierGenerationMinimumAxisGap = 20;
