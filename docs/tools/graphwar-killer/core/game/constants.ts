/** 集中保存来自 Graphwar 源码和工具推导出的游戏常量。 */
/** 完全来自 Graphwar 源码 Constants.java 的数值。 */
export const graphwarSourceConstants = {
  planeLength: 770,
  planeHeight: 450,
  planeGameLength: 50,
  soldierRadius: 7,
  soldierSelectionRadius: 15,
  stepSize: 0.01,
  funcMaxSteps: 20000,
  funcMaxStepDistanceSquared: 0.001,
  funcMinXStepDistance: 0.00001,
  angleError: Math.PI / 360,
  maxAngleLoops: 100,
} as const;

/** Graphwar 源码 Constants.java 里的坐标平面像素宽度。 */
export const GRAPHWAR_PLANE_LENGTH = graphwarSourceConstants.planeLength;

/**
 * 自动空间控制点至少前进的原生平面像素数。
 *
 * ULP 只保证 double 严格有序，原版 RK4 最后二分档位又属于公式采样漏洞；二者都不能替代游戏平面上可分辨的真实位移。
 */
export const GRAPHWAR_AUTO_CONTROL_POINT_MIN_FORWARD_PLANE_PIXELS = 1;

/** Graphwar 源码 Constants.java 里的坐标平面像素高度。 */
export const GRAPHWAR_PLANE_HEIGHT = graphwarSourceConstants.planeHeight;

/** Graphwar 源码 Constants.java 里 x 轴对应的游戏坐标宽度。 */
export const GRAPHWAR_PLANE_GAME_LENGTH = graphwarSourceConstants.planeGameLength;

/** 原版函数碰撞和发射点偏移使用的士兵命中半径，单位：Graphwar 平面像素。 */
export const GRAPHWAR_SOLDIER_RADIUS = graphwarSourceConstants.soldierRadius;

/** 原版生成士兵/障碍时使用的安全间距；不是工具 UI 里的选中圈或命中圈。 */
export const GRAPHWAR_SOLDIER_SELECTION_RADIUS = graphwarSourceConstants.soldierSelectionRadius;

/** 原版士兵 PNG 的透明画布尺寸；不代表可见身体大小，也不参与命中判定。 */
export const GRAPHWAR_SOLDIER_SPRITE_SIZE = 20;

/** 工具从原版合成士兵图量出的可见身体外框宽高；可视半径是该值的一半。 */
export const GRAPHWAR_SOLDIER_VISIBLE_SIZE = 17;

/** Graphwar 源码 Constants.java 里的默认函数积分步长。 */
export const GRAPHWAR_STEP_SIZE = graphwarSourceConstants.stepSize;

/** Graphwar 源码 Constants.java 里的函数最大采样步数。 */
export const GRAPHWAR_FUNC_MAX_STEPS = graphwarSourceConstants.funcMaxSteps;

/** Graphwar 源码 Constants.java 里的函数相邻采样点最大距离平方。 */
export const GRAPHWAR_FUNC_MAX_STEP_DISTANCE_SQUARED = graphwarSourceConstants.funcMaxStepDistanceSquared;

/** Graphwar 源码 Constants.java 里的函数最小 x 步长。 */
export const GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE = graphwarSourceConstants.funcMinXStepDistance;

/** Graphwar 从默认步长逐档二分后，最后一个不大于源码下限的实际 x 步长。 */
export const GRAPHWAR_FUNC_LAST_BISECTED_X_STEP_DISTANCE =
  GRAPHWAR_STEP_SIZE / 2 ** Math.ceil(Math.log2(GRAPHWAR_STEP_SIZE / GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE));

/** Graphwar 源码 Constants.java 里的发射角迭代误差阈值。 */
export const GRAPHWAR_ANGLE_ERROR = graphwarSourceConstants.angleError;

/** Graphwar 源码 Constants.java 里的发射角最大迭代次数。 */
export const GRAPHWAR_MAX_ANGLE_LOOPS = graphwarSourceConstants.maxAngleLoops;

/** 默认 x 范围来自 PLANE_GAME_LENGTH：±50/2。 */
export const GRAPHWAR_DEFAULT_X_LIMIT = GRAPHWAR_PLANE_GAME_LENGTH / 2;

/** 默认 ±y = 450/2*50/770 = 14.61038961038961，来源：Graphwar 源码 Constants.java 和 GraphPlane.convertY。 */
export const GRAPHWAR_VISIBLE_Y_LIMIT =
  ((GRAPHWAR_PLANE_HEIGHT / 2) * GRAPHWAR_PLANE_GAME_LENGTH) / GRAPHWAR_PLANE_LENGTH;

/** 与 GRAPHWAR_SOLDIER_RADIUS 同一个命中半径，只是从平面像素换算到 Graphwar 游戏坐标。 */
export const GRAPHWAR_GAME_SOLDIER_RADIUS =
  (GRAPHWAR_SOLDIER_RADIUS * GRAPHWAR_PLANE_GAME_LENGTH) / GRAPHWAR_PLANE_LENGTH;
