/** 完全来自 Graphwar 源码 Constants.java 的数值。 */
export const graphwarSourceConstants = {
  planeLength: 770,
  planeHeight: 450,
  planeGameLength: 50,
  soldierRadius: 7,
  stepSize: 0.01,
  funcMaxSteps: 20000,
  funcMaxStepDistanceSquared: 0.001,
  funcMinXStepDistance: 0.00001,
  angleError: Math.PI / 360,
  maxAngleLoops: 100,
} as const;

/** Graphwar 源码 Constants.java 里的坐标平面像素宽度。 */
export const GRAPHWAR_PLANE_LENGTH = graphwarSourceConstants.planeLength;

/** Graphwar 源码 Constants.java 里的坐标平面像素高度。 */
export const GRAPHWAR_PLANE_HEIGHT = graphwarSourceConstants.planeHeight;

/** Graphwar 源码 Constants.java 里 x 轴对应的游戏坐标宽度。 */
export const GRAPHWAR_PLANE_GAME_LENGTH = graphwarSourceConstants.planeGameLength;

/** Graphwar 源码 Constants.java 里的士兵像素半径。 */
export const GRAPHWAR_SOLDIER_RADIUS = graphwarSourceConstants.soldierRadius;

/** Graphwar 源码 Constants.java 里的默认函数积分步长。 */
export const GRAPHWAR_STEP_SIZE = graphwarSourceConstants.stepSize;

/** Graphwar 源码 Constants.java 里的函数最大采样步数。 */
export const GRAPHWAR_FUNC_MAX_STEPS = graphwarSourceConstants.funcMaxSteps;

/** Graphwar 源码 Constants.java 里的函数相邻采样点最大距离平方。 */
export const GRAPHWAR_FUNC_MAX_STEP_DISTANCE_SQUARED = graphwarSourceConstants.funcMaxStepDistanceSquared;

/** Graphwar 源码 Constants.java 里的函数最小 x 步长。 */
export const GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE = graphwarSourceConstants.funcMinXStepDistance;

/** Graphwar 源码 Constants.java 里的发射角迭代误差阈值。 */
export const GRAPHWAR_ANGLE_ERROR = graphwarSourceConstants.angleError;

/** Graphwar 源码 Constants.java 里的发射角最大迭代次数。 */
export const GRAPHWAR_MAX_ANGLE_LOOPS = graphwarSourceConstants.maxAngleLoops;

/** 默认 x 范围来自 PLANE_GAME_LENGTH：±50/2。 */
export const GRAPHWAR_DEFAULT_X_LIMIT = GRAPHWAR_PLANE_GAME_LENGTH / 2;

/** 默认 ±y = 450/2*50/770 = 14.61038961038961，来源：Graphwar 源码 Constants.java 和 GraphPlane.convertY。 */
export const GRAPHWAR_VISIBLE_Y_LIMIT =
  ((GRAPHWAR_PLANE_HEIGHT / 2) * GRAPHWAR_PLANE_GAME_LENGTH) / GRAPHWAR_PLANE_LENGTH;

/** Graphwar 里士兵半径换算到游戏坐标后的长度。 */
export const GRAPHWAR_GAME_SOLDIER_RADIUS =
  (GRAPHWAR_SOLDIER_RADIUS * GRAPHWAR_PLANE_GAME_LENGTH) / GRAPHWAR_PLANE_LENGTH;
