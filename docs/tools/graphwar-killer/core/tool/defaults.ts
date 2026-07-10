/** 保存 Graphwar 杀手页面初始尺寸、坐标标定和识别阈值默认值。 */
interface GraphwarToolDefaults {
  /** 默认工作区画布宽度，匹配示例截图比例。 */
  canvasWidth: number;
  /** 默认工作区画布高度，匹配示例截图比例。 */
  canvasHeight: number;
  /** 默认 Graphwar 平面在示例截图中的像素边界。 */
  boundsRect: {
    /** 默认平面左上角 x。 */
    x: number;
    /** 默认平面左上角 y。 */
    y: number;
    /** 默认平面宽度。 */
    width: number;
    /** 默认平面高度。 */
    height: number;
  };
  /** Step 在目标 x 处允许的纵向尾差，单位为 Graphwar 原始平面像素。 */
  targetRangePixelTolerance: number;
  /** 放大镜预览窗口尺寸。 */
  magnifierSize: number;
  /** 放大镜默认缩放倍数。 */
  magnifierZoom: number;
  /** Step 算法默认陡峭度，兼顾函数长度和接近垂直阶跃的效果。 */
  steepness: number;
  /** 发射点固定点迭代次数上限，避免公式点调整陷入长循环。 */
  formulaLaunchPointIterations: number;
  /** 自动障碍识别保留连通域的默认最小面积。 */
  obstacleMinArea: number;
  /** 士兵模板候选投票排序后参与完整匹配的默认比例。 */
  soldierTemplateCandidateTopRatio: number;
  /** 士兵模板匹配默认子 Worker 数量。 */
  templateMatchingWorkerCount: number;
  /** 几何寻路默认 Worker 数量。 */
  pathfindingWorkerCount: number;
  /** 实时点击预览默认 Worker 数量；高频 pointermove 需要多 lane 吸收短时抖动。 */
  liveClickPreviewWorkerCount: number;
  /** 默认最多保留的士兵识别数量，防止噪点生成过多目标。 */
  maximumSoldierCount: number;
}

/** 工具自己的默认值和容差；这些值不来自 Graphwar 源码 Constants.java。 */
export const graphwarToolDefaults: GraphwarToolDefaults = {
  canvasWidth: 1000,
  canvasHeight: 562,
  boundsRect: {
    x: 16.77,
    y: 45.89,
    width: 770,
    height: 450.72,
  },
  targetRangePixelTolerance: 1,
  magnifierSize: 132,
  magnifierZoom: 3,
  steepness: 67,
  formulaLaunchPointIterations: 8,
  obstacleMinArea: 50,
  soldierTemplateCandidateTopRatio: 0.1,
  templateMatchingWorkerCount: 4,
  pathfindingWorkerCount: 4,
  liveClickPreviewWorkerCount: 4,
  maximumSoldierCount: 40,
};
