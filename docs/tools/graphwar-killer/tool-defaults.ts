interface GraphwarToolDefaults {
  canvasWidth: number;
  canvasHeight: number;
  boundsRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  pathVerticalPixelTolerance: number;
  magnifierSize: number;
  magnifierZoom: number;
  steepness: number;
  formulaLaunchPointIterations: number;
  formulaLaunchPointToleranceSquared: number;
  stepSignEpsilon: number;
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
  pathVerticalPixelTolerance: 1.5,
  magnifierSize: 132,
  magnifierZoom: 3,
  steepness: 67,
  formulaLaunchPointIterations: 8,
  formulaLaunchPointToleranceSquared: 1e-12,
  stepSignEpsilon: 0.000000000000001,
};
