/** 封装 Graphwar 公式模拟器，按游戏步进规则计算轨迹和停止原因。 */
import { compileFormulaEvaluator } from "./formula";
import type { FormulaEvaluationOptions } from "./formula";
import {
  GRAPHWAR_ANGLE_ERROR,
  GRAPHWAR_FUNC_MAX_STEP_DISTANCE_SQUARED,
  GRAPHWAR_FUNC_MAX_STEPS,
  GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE,
  GRAPHWAR_GAME_SOLDIER_RADIUS,
  GRAPHWAR_MAX_ANGLE_LOOPS,
  GRAPHWAR_PLANE_GAME_LENGTH,
  GRAPHWAR_PLANE_LENGTH,
  GRAPHWAR_STEP_SIZE,
} from "./graphwar";
import { graphwarToolDefaults } from "./tool-defaults";
import { createGraphPoint } from "./types";
import type { AlgorithmMode, EquationMode, GraphBounds, GraphPoint } from "./types";

/** 采样由路径点生成的公式时的完整输入，保持与 Graphwar 原版步进参数隔离。 */
interface SampleGraphwarTrajectoryOptions {
  /** 路径点转公式的算法。 */
  algorithm: AlgorithmMode;
  /** 当前 Graphwar 坐标边界，用于出界判断。 */
  bounds: GraphBounds;
  /** Graphwar 对公式文本的解释模式。 */
  equation: EquationMode;
  /** 可选数值保护配置，确保模拟和生成公式时的 evaluator 一致。 */
  formulaEvaluation?: FormulaEvaluationOptions;
  /** 已按 Graphwar 坐标表示的公式控制点。 */
  points: readonly GraphPoint[];
  /** 每个采样点后的早停钩子，用于目标/障碍验证。 */
  shouldStop?: (point: GraphPoint, previousPoint: GraphPoint | undefined, index: number) => boolean;
  /** 士兵中心；Graphwar 实际发射点会从这里沿角度偏移半径。 */
  soldierCenter: GraphPoint;
  /** Step 算法陡峭度。 */
  steepness: number;
}

const STEP_CENTER_MARGIN = GRAPHWAR_PLANE_GAME_LENGTH / GRAPHWAR_PLANE_LENGTH;
const STEP_TARGET_VERTICAL_TOLERANCE =
  (graphwarToolDefaults.targetRangePixelTolerance * GRAPHWAR_PLANE_GAME_LENGTH) / GRAPHWAR_PLANE_LENGTH;
/** 发射点迭代收敛阈值取 Graphwar 最小 x 步长的 1/10，避免无意义抖动。 */
const FORMULA_LAUNCH_POINT_TOLERANCE = GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE / 10;
/** 发射点收敛比较使用距离平方，避免每轮开方。 */
const FORMULA_LAUNCH_POINT_TOLERANCE_SQUARED = FORMULA_LAUNCH_POINT_TOLERANCE ** 2;

/** 采样用户直接输入表达式的输入；表达式模式不经过路径点编译。 */
export interface SampleGraphwarExpressionTrajectoryOptions {
  /** 当前 Graphwar 坐标边界，用于出界判断。 */
  bounds: GraphBounds;
  /** Graphwar 对表达式的解释模式。 */
  equation: EquationMode;
  /** 用户输入的 Graphwar 表达式文本。 */
  expression: string;
  /** Y''= 模式可手动给定发射角；省略时沿用工具建议值。 */
  launchAngleRadians?: number;
  /** Graphwar 表达式解析兼容选项。 */
  parser?: GraphwarExpressionParserOptions;
  /** 每个采样点后的早停钩子，用于目标/障碍验证。 */
  shouldStop?: (point: GraphPoint, previousPoint: GraphPoint | undefined, index: number) => boolean;
  /** 士兵中心；Graphwar 实际发射点会从这里沿角度偏移半径。 */
  soldierCenter: GraphPoint;
}

/** 用户输入表达式的 Graphwar 源码兼容解析选项。 */
export interface GraphwarExpressionParserOptions {
  /** 是否跳过 Graphwar 表达式中无法识别的字符。 */
  skipUnknownCharacters: boolean;
  /** 是否复刻原版 token 正则顺序，把 y' 当作 y 后再处理剩余 apostrophe。 */
  parseDerivativeAsY: boolean;
}

/** 创建游戏实际公式点所需的路径和模式配置。 */
export interface CreateGraphwarFormulaPathOptions {
  /** 路径点转公式的算法。 */
  algorithm: AlgorithmMode;
  /** Graphwar 对公式文本的解释模式。 */
  equation: EquationMode;
  /** 可选数值保护配置，保证发射角迭代和采样使用同一求值行为。 */
  formulaEvaluation?: FormulaEvaluationOptions;
  /** 用户选择或 worker 生成的 Graphwar 路径点。 */
  points: readonly GraphPoint[];
  /** Step 算法陡峭度。 */
  steepness: number;
}

/** 二阶 RK4 积分状态；dy 需要随 y 一起推进。 */
type SecondOrderState = GraphPoint & {
  /** 当前 y'。 */
  dy: number;
};

/** 模拟器停止原因，直接映射 Graphwar 原版采样限制和工具早停。 */
type TrajectoryStopReason =
  | "completed"
  | "invalid"
  | "max-steps"
  | "out-of-bounds"
  | "stopped"
  | "too-steep"
  | "unsupported";

/** Graphwar 规则采样的轨迹结果。 */
export interface GraphwarTrajectorySample {
  /** 按 Graphwar 游戏坐标记录的轨迹点。 */
  points: GraphPoint[];
  /** 采样停止原因，用于 UI 提示和 worker 调试统计。 */
  stopReason: TrajectoryStopReason;
}

/** Y'=f(x,y) 模式使用的一阶导求值器。 */
type FirstOrderEvaluator = (x: number, y: number) => number;
/** Y''=f(x,y,y') 模式使用的二阶导求值器。 */
type SecondOrderEvaluator = (x: number, y: number, dy: number) => number;

/** Graphwar 原版 PolishNotationFunction 使用的简单数值 token。 */
interface GraphwarExpressionToken {
  /** Token 类型编号；顺序参与原版优先级重排。 */
  type: GraphwarExpressionTokenType;
  /** 常量 token 的数值。 */
  value?: number;
}

/** Graphwar 表达式 token 编号；数值顺序会影响 reorderGraphwarExpressionTokens 的原版兼容优先级。 */
const enum GraphwarExpressionTokenType {
  /** 加法 token。 */
  Add = 1,
  /** 减号 token；Graphwar 原版把它作为一元负号处理。 */
  Subtract = 2,
  /** 乘法 token。 */
  Multiply = 3,
  /** 除法 token。 */
  Divide = 4,
  /** 幂运算 token。 */
  Pow = 5,
  /** Sqrt 函数 token。 */
  Sqrt = 6,
  /** Log10 函数 token。 */
  Log = 7,
  /** Abs 函数 token。 */
  Abs = 8,
  /** Sin/sen 函数 token。 */
  Sin = 9,
  /** Cos 函数 token。 */
  Cos = 10,
  /** Tan/tg 函数 token。 */
  Tan = 11,
  /** Ln 函数 token。 */
  Ln = 12,
  /** X 变量 token。 */
  X = 13,
  /** Y 变量 token。 */
  Y = 14,
  /** Y' 变量 token。 */
  DY = 15,
  /** 数字常量 token。 */
  Value = 16,
  /** 左括号 token，只参与重排时的嵌套层级计算。 */
  LeftBracket = 17,
  /** 右括号 token，只参与重排时的嵌套层级计算。 */
  RightBracket = 18,
}

/** 把用户点选的士兵中心转换为 Graphwar 实际发射边缘点，供公式生成使用。 */
export function createGraphwarFormulaPathPoints(options: CreateGraphwarFormulaPathOptions): GraphPoint[] {
  if (options.points.length < 2) {
    return [...options.points];
  }

  let formulaPoints = createStepAdjustedFormulaPathPoints(options, options.points);
  const soldierCenter = options.points[0];
  for (let index = 0; index < graphwarToolDefaults.formulaLaunchPointIterations; index += 1) {
    const launchPoint = getLaunchPoint({ ...options, points: formulaPoints }, soldierCenter);
    if (!isFinitePoint(launchPoint)) {
      return formulaPoints;
    }

    const nextTargetPoints = [launchPoint, ...options.points.slice(1)];
    const nextFormulaPoints = createStepAdjustedFormulaPathPoints(options, nextTargetPoints);
    if (distanceSquared(formulaPoints[0], launchPoint) <= FORMULA_LAUNCH_POINT_TOLERANCE_SQUARED) {
      return nextFormulaPoints;
    }
    formulaPoints = nextFormulaPoints;
  }

  return formulaPoints;
}

/**
 * Step mode path points are user-facing targets. The formula's c value is the sigmoid midpoint, so move each midpoint
 * left enough that the curve is already near the target height at target x.
 */
function createStepAdjustedFormulaPathPoints(
  options: CreateGraphwarFormulaPathOptions,
  targetPoints: readonly GraphPoint[],
) {
  if (
    options.algorithm !== "step" ||
    targetPoints.length < 2 ||
    options.steepness <= 0 ||
    !Number.isFinite(options.steepness)
  ) {
    return [...targetPoints];
  }

  const formulaPoints = [targetPoints[0]];
  for (let index = 1; index < targetPoints.length; index += 1) {
    const previousTarget = targetPoints[index - 1];
    const target = targetPoints[index];
    formulaPoints.push(createGraphPoint(calculateStepCenterX(previousTarget, target, options.steepness), target.y));
  }
  return formulaPoints;
}

/** 将 step 中心向左移动，让曲线在用户目标 x 处已经足够接近目标 y。 */
function calculateStepCenterX(previousTarget: GraphPoint, target: GraphPoint, steepness: number) {
  const deltaY = target.y - previousTarget.y;
  const availableOffset = target.x - previousTarget.x - STEP_CENTER_MARGIN;
  const requiredProgress = 1 - STEP_TARGET_VERTICAL_TOLERANCE / Math.abs(deltaY);
  if (deltaY === 0 || requiredProgress <= 0.5 || availableOffset <= 0 || !Number.isFinite(availableOffset)) {
    return target.x;
  }

  const centerOffset = Math.log(requiredProgress / (1 - requiredProgress)) / steepness;
  return target.x - Math.min(centerOffset, availableOffset);
}

/** 使用 Graphwar 的采样、步长二分和 RK4 规则生成预览轨迹点。 */
export function sampleGraphwarTrajectory(options: SampleGraphwarTrajectoryOptions) {
  if (options.points.length < 2) {
    return createTrajectorySample([], "unsupported");
  }
  if (options.equation === "y") {
    return sampleNormalFunction(options);
  }
  if (options.equation === "dy") {
    return sampleFirstOrderEquation(options);
  }
  return sampleSecondOrderEquation(options);
}

/** 使用用户输入的 Graphwar 表达式生成预览轨迹点。 */
export function sampleGraphwarExpressionTrajectory(options: SampleGraphwarExpressionTrajectoryOptions) {
  const evaluateExpression = createGraphwarExpressionEvaluator(options.expression, options.parser);
  if (!evaluateExpression) {
    return createTrajectorySample([], "invalid");
  }

  if (options.equation === "y") {
    return sampleNormalExpression(options, (x) => evaluateExpression(x, 0, 0));
  }
  if (options.equation === "dy") {
    return sampleFirstOrderExpression(options, (x, y) => evaluateExpression(x, y, 0));
  }
  if (options.launchAngleRadians === undefined || !Number.isFinite(options.launchAngleRadians)) {
    return createTrajectorySample([], "invalid");
  }
  return sampleSecondOrderExpression(options, (x, y, dy) => evaluateExpression(x, y, dy));
}

/** 计算 Graphwar 实际使用或需要手调的发射角。 */
export function getGraphwarLaunchAngle(options: CreateGraphwarFormulaPathOptions, soldierCenter = options.points[0]) {
  return soldierCenter ? getLaunchAngle(options, soldierCenter) : Number.NaN;
}

/** 模拟普通 y= 模式：从士兵边缘出发，并让 Graphwar 自动给函数加常数平移。 */
function sampleNormalFunction(options: SampleGraphwarTrajectoryOptions) {
  const evaluateY = createYEvaluator(options);
  const launchPoint = getLaunchPoint(options, options.soldierCenter);
  const offset = launchPoint.y - evaluateY(launchPoint.x);
  if (!isFinitePoint(launchPoint) || !Number.isFinite(offset)) {
    return createTrajectorySample([], "invalid");
  }

  return sampleByBisection(
    launchPoint,
    options.bounds,
    (previous, step) => {
      const x = previous.x + step;
      return createGraphPoint(x, evaluateY(x) + offset);
    },
    { shouldStop: options.shouldStop, stopAtMinStep: true },
  );
}

/** 模拟 y'= 模式：先迭代发射角，再从士兵边缘开始做一阶 RK4。 */
function sampleFirstOrderEquation(options: SampleGraphwarTrajectoryOptions) {
  const evaluateDY = createFirstOrderEvaluator(options);
  const launchPoint = getLaunchPoint(options, options.soldierCenter);
  if (!isFinitePoint(launchPoint)) {
    return createTrajectorySample([], "invalid");
  }

  return sampleByBisection(
    launchPoint,
    options.bounds,
    (previous, step) => rk4FirstOrderStep(previous, step, evaluateDY),
    { shouldStop: options.shouldStop, stopAtMinStep: false },
  );
}

/** 模拟 y''= 模式：使用建议发射角和 tan(angle) 作为初始 y'，再做二阶 RK4。 */
function sampleSecondOrderEquation(options: SampleGraphwarTrajectoryOptions) {
  if (options.algorithm === "abs") {
    return createTrajectorySample([], "unsupported");
  }

  const evaluateDDY = createSecondOrderEvaluator(options);
  const angle = getLaunchAngle(options, options.soldierCenter);
  const launchPoint = getLaunchPoint(options, options.soldierCenter);
  const launchState = createSecondOrderState(launchPoint.x, launchPoint.y, Math.tan(angle));
  if (!isFinitePoint(launchState) || !Number.isFinite(launchState.dy)) {
    return createTrajectorySample([], "invalid");
  }

  return sampleByBisection(
    launchState,
    options.bounds,
    (previous, step) => rk4SecondOrderStep(previous, step, evaluateDDY),
    { shouldStop: options.shouldStop, stopAtMinStep: false },
  );
}

/** 采样用户表达式的 y= 模式，并按 Graphwar 规则给函数值加发射点偏移。 */
function sampleNormalExpression(options: SampleGraphwarExpressionTrajectoryOptions, evaluateY: (x: number) => number) {
  const angle = getNormalStartAngle(options.soldierCenter.x, evaluateY);
  const launchPoint = Number.isFinite(angle)
    ? moveFromSoldierCenter(options.soldierCenter, angle)
    : options.soldierCenter;
  const offset = launchPoint.y - evaluateY(launchPoint.x);
  if (!isFinitePoint(launchPoint) || !Number.isFinite(offset)) {
    return createTrajectorySample([], "invalid");
  }

  return sampleByBisection(
    launchPoint,
    options.bounds,
    (previous, step) => {
      const x = previous.x + step;
      return createGraphPoint(x, evaluateY(x) + offset);
    },
    { shouldStop: options.shouldStop, stopAtMinStep: true },
  );
}

/** 采样用户表达式的 y'= 模式，发射角由一阶方程迭代得到。 */
function sampleFirstOrderExpression(
  options: SampleGraphwarExpressionTrajectoryOptions,
  evaluateDY: FirstOrderEvaluator,
) {
  const angle = getFirstOrderStartAngle(options.soldierCenter, evaluateDY);
  const launchPoint = moveFromSoldierCenter(options.soldierCenter, angle);
  if (!isFinitePoint(launchPoint)) {
    return createTrajectorySample([], "invalid");
  }

  return sampleByBisection(
    launchPoint,
    options.bounds,
    (previous, step) => rk4FirstOrderStep(previous, step, evaluateDY),
    { shouldStop: options.shouldStop, stopAtMinStep: false },
  );
}

/** 采样用户表达式的 y''= 模式，发射角来自用户输入或工具建议。 */
function sampleSecondOrderExpression(
  options: SampleGraphwarExpressionTrajectoryOptions,
  evaluateDDY: SecondOrderEvaluator,
) {
  const angle = options.launchAngleRadians ?? Number.NaN;
  const launchPoint = moveFromSoldierCenter(options.soldierCenter, angle);
  const launchState = createSecondOrderState(launchPoint.x, launchPoint.y, Math.tan(angle));
  if (!isFinitePoint(launchState) || !Number.isFinite(launchState.dy)) {
    return createTrajectorySample([], "invalid");
  }

  return sampleByBisection(
    launchState,
    options.bounds,
    (previous, step) => rk4SecondOrderStep(previous, step, evaluateDDY),
    { shouldStop: options.shouldStop, stopAtMinStep: false },
  );
}

/** 按 Graphwar 当前模式计算真实发射点；传入的 center 是用户点选的士兵中心。 */
function getLaunchPoint(options: CreateGraphwarFormulaPathOptions, center: GraphPoint) {
  const angle = getLaunchAngle(options, center);
  if (options.equation === "y" && !Number.isFinite(angle)) {
    return center;
  }
  return moveFromSoldierCenter(center, angle);
}

/** 按 Graphwar 当前模式计算发射角。 */
function getLaunchAngle(options: CreateGraphwarFormulaPathOptions, center: GraphPoint) {
  if (options.equation === "y") {
    return getNormalStartAngle(center.x, createYEvaluator(options));
  }
  if (options.equation === "dy") {
    return getFirstOrderStartAngle(center, createFirstOrderEvaluator(options));
  }
  if (options.algorithm === "abs") {
    return Number.NaN;
  }
  return getSecondOrderStartAngle(center, options);
}

/** 创建普通 y= 模式使用的函数值计算器。 */
function createYEvaluator(options: CreateGraphwarFormulaPathOptions) {
  return compileFormulaEvaluator(options.points, options.steepness, options.algorithm, options.formulaEvaluation)
    .evaluateY;
}

/** 创建 y'= 模式使用的一阶导计算器。 */
function createFirstOrderEvaluator(options: CreateGraphwarFormulaPathOptions): FirstOrderEvaluator {
  return compileFormulaEvaluator(options.points, options.steepness, options.algorithm, options.formulaEvaluation)
    .evaluateFirstDerivativeY;
}

/** 创建 y''= 模式使用的二阶导计算器。 */
function createSecondOrderEvaluator(options: CreateGraphwarFormulaPathOptions): SecondOrderEvaluator {
  return compileFormulaEvaluator(options.points, options.steepness, options.algorithm, options.formulaEvaluation)
    .evaluateSecondDerivativeY;
}

/** 模拟 Graphwar 普通 y= 模式按函数有限差分迭代初始发射角。 */
function getNormalStartAngle(centerX: number, evaluateY: (x: number) => number) {
  const startTangent = (evaluateY(centerX + GRAPHWAR_STEP_SIZE) - evaluateY(centerX)) / GRAPHWAR_STEP_SIZE;
  let angle = Math.atan(startTangent);
  let error = Number.POSITIVE_INFINITY;

  for (let index = 0; error > GRAPHWAR_ANGLE_ERROR && index < GRAPHWAR_MAX_ANGLE_LOOPS; index += 1) {
    const finalX = centerX + GRAPHWAR_GAME_SOLDIER_RADIUS * Math.cos(angle);
    const tangent = (evaluateY(finalX + GRAPHWAR_STEP_SIZE) - evaluateY(finalX)) / GRAPHWAR_STEP_SIZE;
    const nextAngle = Math.atan(tangent);
    error = Math.abs(nextAngle - angle);
    angle = nextAngle;
  }

  return angle;
}

/** 模拟 Graphwar y'= 模式用一次 RK4 预测斜率并迭代初始发射角。 */
function getFirstOrderStartAngle(center: GraphPoint, evaluateDY: FirstOrderEvaluator) {
  let angle = 0;
  let error = Number.POSITIVE_INFINITY;

  for (let index = 0; error > GRAPHWAR_ANGLE_ERROR && index < GRAPHWAR_MAX_ANGLE_LOOPS; index += 1) {
    const finalPoint = moveFromSoldierCenter(center, angle);
    const nextPoint = rk4FirstOrderStep(finalPoint, GRAPHWAR_STEP_SIZE, evaluateDY);
    const tangent = (nextPoint.y - finalPoint.y) / (nextPoint.x - finalPoint.x);
    const nextAngle = Math.atan(tangent);
    error = Math.abs(nextAngle - angle);
    angle = nextAngle;
  }

  return angle;
}

/** Y'' 模式需要手调角度；按发射边缘点处的目标曲线斜率做固定点迭代。 */
function getSecondOrderStartAngle(center: GraphPoint, options: CreateGraphwarFormulaPathOptions) {
  const evaluateDY = createFirstOrderEvaluator(options);
  let angle = Math.atan(evaluateDY(center.x, center.y));
  let error = Number.POSITIVE_INFINITY;

  for (let index = 0; error > GRAPHWAR_ANGLE_ERROR && index < GRAPHWAR_MAX_ANGLE_LOOPS; index += 1) {
    const launchPoint = moveFromSoldierCenter(center, angle);
    const nextAngle = Math.atan(evaluateDY(launchPoint.x, launchPoint.y));
    error = Math.abs(nextAngle - angle);
    angle = nextAngle;
  }

  return angle;
}

/** 从士兵中心沿发射角移动一个 Graphwar 士兵半径。 */
function moveFromSoldierCenter(center: GraphPoint, angle: number): GraphPoint {
  return createGraphPoint(
    center.x + GRAPHWAR_GAME_SOLDIER_RADIUS * Math.cos(angle),
    center.y + GRAPHWAR_GAME_SOLDIER_RADIUS * Math.sin(angle),
  );
}

/** 用 Graphwar 的相邻点距离阈值和最小 x 步长执行采样；距离过大时对步长二分。 */
function sampleByBisection<TPoint extends GraphPoint>(
  start: TPoint,
  bounds: GraphBounds,
  calculateNext: (previous: TPoint, step: number) => TPoint,
  options: {
    shouldStop?: (point: GraphPoint, previousPoint: GraphPoint | undefined, index: number) => boolean;
    stopAtMinStep: boolean;
  },
) {
  const samples: GraphPoint[] = [createGraphPoint(start.x, start.y)];
  let previous = start;
  if (options.shouldStop?.(start, undefined, 0)) {
    return createTrajectorySample(samples, "stopped");
  }

  for (let index = 1; index < GRAPHWAR_FUNC_MAX_STEPS; index += 1) {
    const next = findNextSample(previous, calculateNext, options);
    if (!next.ok) {
      return createTrajectorySample(samples, next.stopReason);
    }

    samples.push(createGraphPoint(next.point.x, next.point.y));
    const previousPoint = previous;
    previous = next.point;
    if (options.shouldStop?.(next.point, previousPoint, index)) {
      return createTrajectorySample(samples, "stopped");
    }
    if (isOutsideGraphBounds(next.point, bounds)) {
      return createTrajectorySample(samples, "out-of-bounds");
    }
  }

  return createTrajectorySample(samples, "max-steps");
}

/** 计算下一采样点；若相邻点距离过大则反复把 x 步长减半。 */
function findNextSample<TPoint extends GraphPoint>(
  previous: TPoint,
  calculateNext: (previous: TPoint, step: number) => TPoint,
  options: { stopAtMinStep: boolean },
) {
  let step = GRAPHWAR_STEP_SIZE;
  let next = calculateNext(previous, step);

  while (isFinitePoint(next) && distanceSquared(previous, next) > GRAPHWAR_FUNC_MAX_STEP_DISTANCE_SQUARED) {
    if (next.x - previous.x <= GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE) {
      return options.stopAtMinStep
        ? { ok: false as const, stopReason: "too-steep" as const }
        : { ok: true as const, point: next };
    }

    step /= 2;
    next = calculateNext(previous, step);
  }

  return isFinitePoint(next)
    ? { ok: true as const, point: next }
    : { ok: false as const, stopReason: "invalid" as const };
}

/** 一阶微分方程 y'=f(x,y) 的 RK4 单步。 */
function rk4FirstOrderStep(point: GraphPoint, step: number, evaluateDY: FirstOrderEvaluator): GraphPoint {
  const k1 = evaluateDY(point.x, point.y);
  const k2 = evaluateDY(point.x + 0.5 * step, point.y + 0.5 * step * k1);
  const k3 = evaluateDY(point.x + 0.5 * step, point.y + 0.5 * step * k2);
  const k4 = evaluateDY(point.x + step, point.y + step * k3);

  return createGraphPoint(point.x + step, point.y + (step / 6) * (k1 + 2 * k2 + 2 * k3 + k4));
}

/** 二阶微分方程 y''=f(x,y,y') 的 RK4 单步。 */
function rk4SecondOrderStep(
  state: SecondOrderState,
  step: number,
  evaluateDDY: SecondOrderEvaluator,
): SecondOrderState {
  const k11 = state.dy;
  const k12 = evaluateDDY(state.x, state.y, state.dy);

  const k21 = state.dy + (step / 2) * k12;
  const k22 = evaluateDDY(state.x + step / 2, state.y + (step / 2) * k11, state.dy + (step / 2) * k12);

  const k31 = state.dy + (step / 2) * k22;
  const k32 = evaluateDDY(state.x + step / 2, state.y + (step / 2) * k21, state.dy + (step / 2) * k22);

  const k41 = state.dy + step * k32;
  const k42 = evaluateDDY(state.x + step, state.y + step * k31, state.dy + step * k32);

  return createSecondOrderState(
    state.x + step,
    state.y + (step / 6) * (k11 + 2 * k21 + 2 * k31 + k41),
    state.dy + (step / 6) * (k12 + 2 * k22 + 2 * k32 + k42),
  );
}

/** 创建带 y' 的二阶积分状态。 */
function createSecondOrderState(x: number, y: number, dy: number): SecondOrderState {
  return { ...createGraphPoint(x, y), dy };
}

/** 创建轨迹采样结果，统一 stopReason 结构。 */
function createTrajectorySample(points: GraphPoint[], stopReason: TrajectoryStopReason): GraphwarTrajectorySample {
  return { points, stopReason };
}

/** 编译用户输入表达式，只暴露 Graphwar 支持的一小组数学函数。 */
function createGraphwarExpressionEvaluator(expression: string, parserOptions?: GraphwarExpressionParserOptions) {
  const polishTokens = parseGraphwarExpression(expression, parserOptions);
  if (!polishTokens) {
    return undefined;
  }

  return createGraphwarPolishExpressionEvaluator(polishTokens);
}

/** 按 Graphwar PolishNotationFunction 的 token 规则解析用户表达式。 */
function parseGraphwarExpression(
  expression: string,
  parserOptions?: GraphwarExpressionParserOptions,
): GraphwarExpressionToken[] | undefined {
  const regularTokens = tokenizeGraphwarExpression(expression, parserOptions);
  if (!regularTokens || regularTokens.length === 0) {
    return undefined;
  }
  const polishTokens: GraphwarExpressionToken[] = [];
  if (!reorderGraphwarExpressionTokens(polishTokens, regularTokens, 0, regularTokens.length - 1)) {
    return undefined;
  }
  return graphwarPolishValuesNeeded(polishTokens) === 0 ? polishTokens : undefined;
}

/** 模拟 Graphwar 对普通输入的简单 token 化，包括 exp=>e^、逗号小数和隐式乘法。 */
function tokenizeGraphwarExpression(
  expression: string,
  parserOptions: GraphwarExpressionParserOptions = {
    parseDerivativeAsY: false,
    skipUnknownCharacters: false,
  },
): GraphwarExpressionToken[] | undefined {
  const tokens: GraphwarExpressionToken[] = [];
  const source = expression.toLowerCase().replaceAll("-", "+-").replaceAll("exp", "e^").replaceAll(",", ".");
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    const rest = source.slice(index);
    const numberMatch = rest.match(/^[0-9]*\.?[0-9]+/);
    if (numberMatch) {
      tokens.push({ type: GraphwarExpressionTokenType.Value, value: Number(numberMatch[0]) });
      index += numberMatch[0].length;
      continue;
    }

    const token = readGraphwarExpressionToken(rest, parserOptions);
    if (!token) {
      if (parserOptions.skipUnknownCharacters) {
        index += 1;
        continue;
      }
      return undefined;
    }
    tokens.push(token.token);
    index += token.length;
  }

  return insertGraphwarImplicitMultiplications(tokens);
}

/** 读取当前位置的 Graphwar 表达式 token，保留原版函数名和 y' 解析差异开关。 */
function readGraphwarExpressionToken(
  rest: string,
  parserOptions: GraphwarExpressionParserOptions,
): { length: number; token: GraphwarExpressionToken } | undefined {
  if (!parserOptions.parseDerivativeAsY && rest.startsWith("y'")) {
    return { length: 2, token: { type: GraphwarExpressionTokenType.DY } };
  }

  const namedTokens: [string, GraphwarExpressionTokenType, number?][] = [
    ["sqrt", GraphwarExpressionTokenType.Sqrt],
    ["log", GraphwarExpressionTokenType.Log],
    ["abs", GraphwarExpressionTokenType.Abs],
    ["sen", GraphwarExpressionTokenType.Sin],
    ["sin", GraphwarExpressionTokenType.Sin],
    ["cos", GraphwarExpressionTokenType.Cos],
    ["tan", GraphwarExpressionTokenType.Tan],
    ["tg", GraphwarExpressionTokenType.Tan],
    ["ln", GraphwarExpressionTokenType.Ln],
    ["pi", GraphwarExpressionTokenType.Value, Math.PI],
  ];
  for (const [text, type, value] of namedTokens) {
    if (rest.startsWith(text)) {
      return { length: text.length, token: { type, value } };
    }
  }

  const charTokens: Record<string, GraphwarExpressionToken> = {
    "(": { type: GraphwarExpressionTokenType.LeftBracket },
    ")": { type: GraphwarExpressionTokenType.RightBracket },
    "+": { type: GraphwarExpressionTokenType.Add },
    "-": { type: GraphwarExpressionTokenType.Subtract },
    "*": { type: GraphwarExpressionTokenType.Multiply },
    "/": { type: GraphwarExpressionTokenType.Divide },
    "^": { type: GraphwarExpressionTokenType.Pow },
    e: { type: GraphwarExpressionTokenType.Value, value: Math.E },
    x: { type: GraphwarExpressionTokenType.X },
    y: { type: GraphwarExpressionTokenType.Y },
  };
  return charTokens[rest[0]] ? { length: 1, token: charTokens[rest[0]] } : undefined;
}

/** 在相邻值 token 之间插入 Graphwar 支持的隐式乘法。 */
function insertGraphwarImplicitMultiplications(tokens: GraphwarExpressionToken[]) {
  const result: GraphwarExpressionToken[] = [];
  for (const token of tokens) {
    const previous = result.at(-1);
    if (previous && graphwarTokensAreImplicitMultiplication(previous.type, token.type)) {
      result.push({ type: GraphwarExpressionTokenType.Multiply });
    }
    result.push(token);
  }
  return result;
}

/** 判断两个相邻 token 是否需要补乘号，模拟 Graphwar 输入容错。 */
function graphwarTokensAreImplicitMultiplication(
  previousType: GraphwarExpressionTokenType,
  nextType: GraphwarExpressionTokenType,
) {
  return (
    graphwarExpressionTokenIsValueLike(previousType) &&
    (graphwarExpressionTokenCanStartValue(nextType) ||
      nextType === GraphwarExpressionTokenType.LeftBracket ||
      getGraphwarExpressionTokenParamCount(nextType) === 1)
  );
}

/** 判断 token 是否可以作为值表达式的起点。 */
function graphwarExpressionTokenCanStartValue(type: GraphwarExpressionTokenType) {
  return (
    type === GraphwarExpressionTokenType.Value ||
    type === GraphwarExpressionTokenType.X ||
    type === GraphwarExpressionTokenType.Y ||
    type === GraphwarExpressionTokenType.DY
  );
}

/** 判断 token 是否能作为隐式乘法左侧的值表达式。 */
function graphwarExpressionTokenIsValueLike(type: GraphwarExpressionTokenType) {
  return (
    type === GraphwarExpressionTokenType.Value ||
    type === GraphwarExpressionTokenType.X ||
    type === GraphwarExpressionTokenType.Y ||
    type === GraphwarExpressionTokenType.DY ||
    type === GraphwarExpressionTokenType.RightBracket
  );
}

/** 按 Graphwar 原版优先级规则把普通 token 区间重排为前缀 Polish token。 */
function reorderGraphwarExpressionTokens(
  output: GraphwarExpressionToken[],
  input: GraphwarExpressionToken[],
  start: number,
  end: number,
): boolean {
  if (start > end || start >= input.length) {
    return false;
  }

  let next = -1;
  let nextNest = Number.POSITIVE_INFINITY;
  let nest = 0;
  for (let index = start; index <= end; index += 1) {
    const type = input[index].type;
    if (type === GraphwarExpressionTokenType.LeftBracket) {
      nest += 1;
    } else if (type === GraphwarExpressionTokenType.RightBracket) {
      nest -= 1;
    } else if (nest < nextNest || (nest === nextNest && (next === -1 || type < input[next].type))) {
      next = index;
      nextNest = nest;
    }
  }
  if (next === -1) {
    return false;
  }

  const token = input[next];
  const paramCount = getGraphwarExpressionTokenParamCount(token.type);
  output.push(token);
  if (paramCount === 1) {
    reorderGraphwarExpressionTokens(output, input, next + 1, end);
  } else if (paramCount === 2) {
    const leftExists = reorderGraphwarExpressionTokens(output, input, start, next - 1);
    if (token.type === GraphwarExpressionTokenType.Add && !leftExists) {
      output.push({ type: GraphwarExpressionTokenType.Value, value: 0 });
    }
    reorderGraphwarExpressionTokens(output, input, next + 1, end);
  }
  return true;
}

/** 校验 Polish token 序列是否刚好消费一个表达式值。 */
function graphwarPolishValuesNeeded(tokens: readonly GraphwarExpressionToken[]) {
  let valuesNeeded = 1;
  for (let index = 0; index < tokens.length; index += 1) {
    valuesNeeded += graphwarExpressionTokenIsOperation(tokens[index].type)
      ? getGraphwarExpressionTokenParamCount(tokens[index].type) - 1
      : -1;
    if (valuesNeeded === 0 && index + 1 < tokens.length) {
      return -1;
    }
  }
  return valuesNeeded;
}

/** 为编译后的 Polish 表达式创建可复用栈，避免每个采样点重新分配。 */
function createGraphwarPolishExpressionEvaluator(tokens: readonly GraphwarExpressionToken[]) {
  const stack = new Array<number>(tokens.length);
  return (x: number, y: number, dy: number) => evaluateGraphwarPolishExpression(tokens, stack, x, y, dy);
}

/** 从后向前求值 Graphwar 前缀 Polish 表达式。 */
function evaluateGraphwarPolishExpression(
  tokens: readonly GraphwarExpressionToken[],
  stack: number[],
  x: number,
  y: number,
  dy: number,
) {
  let stackSize = 0;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];

    switch (token.type) {
      case GraphwarExpressionTokenType.Add:
        if (stackSize < 2) {
          return Number.NaN;
        }
        stack[stackSize - 2] += stack[stackSize - 1];
        stackSize -= 1;
        break;
      case GraphwarExpressionTokenType.Subtract:
        if (stackSize < 1) {
          return Number.NaN;
        }
        stack[stackSize - 1] = -stack[stackSize - 1];
        break;
      case GraphwarExpressionTokenType.Multiply:
        if (stackSize < 2) {
          return Number.NaN;
        }
        stack[stackSize - 2] *= stack[stackSize - 1];
        stackSize -= 1;
        break;
      case GraphwarExpressionTokenType.Divide:
        if (stackSize < 2) {
          return Number.NaN;
        }
        stack[stackSize - 2] = stack[stackSize - 1] / stack[stackSize - 2];
        stackSize -= 1;
        break;
      case GraphwarExpressionTokenType.Pow:
        if (stackSize < 2) {
          return Number.NaN;
        }
        stack[stackSize - 2] = Math.pow(stack[stackSize - 1], stack[stackSize - 2]);
        stackSize -= 1;
        break;
      case GraphwarExpressionTokenType.Sqrt:
        if (stackSize < 1) {
          return Number.NaN;
        }
        stack[stackSize - 1] = Math.sqrt(stack[stackSize - 1]);
        break;
      case GraphwarExpressionTokenType.Log:
        if (stackSize < 1) {
          return Number.NaN;
        }
        stack[stackSize - 1] = Math.log10(stack[stackSize - 1]);
        break;
      case GraphwarExpressionTokenType.Abs:
        if (stackSize < 1) {
          return Number.NaN;
        }
        stack[stackSize - 1] = Math.abs(stack[stackSize - 1]);
        break;
      case GraphwarExpressionTokenType.Sin:
        if (stackSize < 1) {
          return Number.NaN;
        }
        stack[stackSize - 1] = Math.sin(stack[stackSize - 1]);
        break;
      case GraphwarExpressionTokenType.Cos:
        if (stackSize < 1) {
          return Number.NaN;
        }
        stack[stackSize - 1] = Math.cos(stack[stackSize - 1]);
        break;
      case GraphwarExpressionTokenType.Tan:
        if (stackSize < 1) {
          return Number.NaN;
        }
        stack[stackSize - 1] = Math.tan(stack[stackSize - 1]);
        break;
      case GraphwarExpressionTokenType.Ln:
        if (stackSize < 1) {
          return Number.NaN;
        }
        stack[stackSize - 1] = Math.log(stack[stackSize - 1]);
        break;
      case GraphwarExpressionTokenType.X:
        stack[stackSize] = x;
        stackSize += 1;
        break;
      case GraphwarExpressionTokenType.Y:
        stack[stackSize] = y;
        stackSize += 1;
        break;
      case GraphwarExpressionTokenType.DY:
        stack[stackSize] = dy;
        stackSize += 1;
        break;
      case GraphwarExpressionTokenType.Value:
        stack[stackSize] = token.value ?? Number.NaN;
        stackSize += 1;
        break;
      default:
        return Number.NaN;
    }
  }

  const value = stackSize === 1 ? stack[0] : Number.NaN;
  return Number.isFinite(value) ? value : Number.NaN;
}

/** 判断 token 是否为 Graphwar 表达式运算符。 */
function graphwarExpressionTokenIsOperation(type: GraphwarExpressionTokenType) {
  return type >= GraphwarExpressionTokenType.Add && type <= GraphwarExpressionTokenType.Ln;
}

/** 返回 Graphwar 运算符需要的参数个数。 */
function getGraphwarExpressionTokenParamCount(type: GraphwarExpressionTokenType) {
  if (type === GraphwarExpressionTokenType.Subtract) {
    return 1;
  }
  if (type >= GraphwarExpressionTokenType.Add && type <= GraphwarExpressionTokenType.Pow) {
    return 2;
  }
  if (type >= GraphwarExpressionTokenType.Sqrt && type <= GraphwarExpressionTokenType.Ln) {
    return 1;
  }
  return 0;
}

/** 比较两个采样点的 Graphwar 游戏坐标距离平方。 */
function distanceSquared(left: GraphPoint, right: GraphPoint) {
  return (right.x - left.x) ** 2 + (right.y - left.y) ** 2;
}

/** Graphwar 原版出平面会触发 Obstacle.collidePoint，等价于边界碰撞。 */
function isOutsideGraphBounds(point: GraphPoint, bounds: GraphBounds) {
  const minX = Math.min(bounds.minX, bounds.maxX);
  const maxX = Math.max(bounds.minX, bounds.maxX);
  const minY = Math.min(bounds.minY, bounds.maxY);
  const maxY = Math.max(bounds.minY, bounds.maxY);
  return point.x < minX || point.x > maxX || point.y < minY || point.y > maxY;
}

/** SVG 预览不能接收 NaN 或 Infinity。 */
function isFinitePoint(point: GraphPoint) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
