/** 保存 Graphwar 杀手页面初始尺寸、坐标标定和识别阈值默认值。 */
interface GraphwarToolDefaults {
  canvasWidth: number;
  canvasHeight: number;
  boundsRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  targetRangePixelTolerance: number;
  magnifierSize: number;
  magnifierZoom: number;
  steepness: number;
  formulaLaunchPointIterations: number;
  obstacleMinArea: number;
  soldierTemplateCandidateTopRatio: number;
  templateMatchingWorkerCount: number;
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
  targetRangePixelTolerance: 1.5,
  magnifierSize: 132,
  magnifierZoom: 3,
  steepness: 67,
  formulaLaunchPointIterations: 8,
  obstacleMinArea: 50,
  soldierTemplateCandidateTopRatio: 0.1,
  templateMatchingWorkerCount: 4,
  maximumSoldierCount: 40,
};
