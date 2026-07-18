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
  /**
   * 生成公式的路径质量目标，单位为 Graphwar 原始平面像素。
   *
   * 它用于停止可选控制点补偿，并作为 Step sigmoid 尾差和命中圈边缘回退的安全预算；不是浮点 epsilon、公式理论可达精度、士兵命中半径或公式有效性的硬阈值。最终正确性仍由最终文本等价 compiled state 按
   * Graphwar 的命中、碰撞、边界和停止规则完整回放决定。
   */
  formulaPathQualityTargetPlanePixels: number;
  /** 放大镜预览窗口尺寸。 */
  magnifierSize: number;
  /** 放大镜默认缩放倍数。 */
  magnifierZoom: number;
  /**
   * Step y/y' 公式 profile 共用的默认陡峭度。
   *
   * 满高 450px 的 sigmoid 在上下边缘各保留 0.5px 时，横向跨度为：
   *
   * `2 * ln((450 - 0.5) / 0.5) / k`
   *
   * 一个 Graphwar 横向像素为 `50 / 770`。要求跨度不超过该值，可得 `k >= 209.4795`，因此整数默认值向上取整为 210。
   */
  steepness: number;
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
  formulaPathQualityTargetPlanePixels: 1,
  magnifierSize: 132,
  magnifierZoom: 3,
  steepness: 210,
  obstacleMinArea: 50,
  soldierTemplateCandidateTopRatio: 0.1,
  templateMatchingWorkerCount: 4,
  pathfindingWorkerCount: 4,
  liveClickPreviewWorkerCount: 4,
  maximumSoldierCount: 40,
};
