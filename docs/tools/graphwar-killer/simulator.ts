import {
  evaluateAbsConnectorFirstDerivativeY,
  evaluateAbsConnectorY,
  evaluateStepFirstDerivativeY,
  evaluateStepSecondDerivativeY,
  evaluateStepY,
} from "./formula";
import type { FormulaEvaluationOptions } from "./formula";
import {
  GRAPHWAR_ANGLE_ERROR,
  GRAPHWAR_FUNC_MAX_STEP_DISTANCE_SQUARED,
  GRAPHWAR_FUNC_MAX_STEPS,
  GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE,
  GRAPHWAR_GAME_SOLDIER_RADIUS,
  GRAPHWAR_MAX_ANGLE_LOOPS,
  GRAPHWAR_STEP_SIZE,
} from "./graphwar";
import { graphwarToolDefaults } from "./tool-defaults";
import { createGraphPoint } from "./types";
import type { AlgorithmMode, EquationMode, GraphBounds, GraphPoint } from "./types";

interface SampleGraphwarTrajectoryOptions {
  algorithm: AlgorithmMode;
  bounds: GraphBounds;
  equation: EquationMode;
  formulaEvaluation?: FormulaEvaluationOptions;
  points: readonly GraphPoint[];
  soldierCenter: GraphPoint;
  steepness: number;
}

export interface CreateGraphwarFormulaPathOptions {
  algorithm: AlgorithmMode;
  equation: EquationMode;
  formulaEvaluation?: FormulaEvaluationOptions;
  points: readonly GraphPoint[];
  steepness: number;
}

type SecondOrderState = GraphPoint & {
  dy: number;
};

type TrajectoryStopReason = "completed" | "invalid" | "max-steps" | "out-of-bounds" | "too-steep" | "unsupported";

export interface GraphwarTrajectorySample {
  points: GraphPoint[];
  stopReason: TrajectoryStopReason;
}

type FirstOrderEvaluator = (x: number, y: number) => number;
type SecondOrderEvaluator = (x: number, y: number, dy: number) => number;

/** 把用户点选的士兵中心转换为 Graphwar 实际发射边缘点，供公式生成使用。 */
export function createGraphwarFormulaPathPoints(options: CreateGraphwarFormulaPathOptions): GraphPoint[] {
  if (options.points.length < 2) {
    return [...options.points];
  }

  let formulaPoints = [...options.points];
  const soldierCenter = options.points[0];
  for (let index = 0; index < graphwarToolDefaults.formulaLaunchPointIterations; index += 1) {
    const launchPoint = getLaunchPoint({ ...options, points: formulaPoints }, soldierCenter);
    if (!isFinitePoint(launchPoint)) {
      return formulaPoints;
    }

    const nextFormulaPoints = [launchPoint, ...options.points.slice(1)];
    if (distanceSquared(formulaPoints[0], launchPoint) <= graphwarToolDefaults.formulaLaunchPointToleranceSquared) {
      return nextFormulaPoints;
    }
    formulaPoints = nextFormulaPoints;
  }

  return formulaPoints;
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

/** 计算 Graphwar 实际使用或需要手调的发射角。 */
export function getGraphwarLaunchAngle(
  options: CreateGraphwarFormulaPathOptions,
  soldierCenter = options.points[0],
) {
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

  return sampleByBisection(launchPoint, options.bounds, (previous, step) => {
    const x = previous.x + step;
    return createGraphPoint(x, evaluateY(x) + offset);
  });
}

/** 模拟 y'= 模式：先迭代发射角，再从士兵边缘开始做一阶 RK4。 */
function sampleFirstOrderEquation(options: SampleGraphwarTrajectoryOptions) {
  const evaluateDY = createFirstOrderEvaluator(options);
  const launchPoint = getLaunchPoint(options, options.soldierCenter);
  if (!isFinitePoint(launchPoint)) {
    return createTrajectorySample([], "invalid");
  }

  return sampleByBisection(launchPoint, options.bounds, (previous, step) =>
    rk4FirstOrderStep(previous, step, evaluateDY),
  );
}

/** 模拟 y''= 模式：使用建议发射角和 tan(angle) 作为初始 y'，再做二阶 RK4。 */
function sampleSecondOrderEquation(options: SampleGraphwarTrajectoryOptions) {
  if (options.algorithm !== "step") {
    return createTrajectorySample([], "unsupported");
  }

  const evaluateDDY = createSecondOrderEvaluator(options);
  const angle = getLaunchAngle(options, options.soldierCenter);
  const launchPoint = getLaunchPoint(options, options.soldierCenter);
  const launchState = createSecondOrderState(launchPoint.x, launchPoint.y, Math.tan(angle));
  if (!isFinitePoint(launchState) || !Number.isFinite(launchState.dy)) {
    return createTrajectorySample([], "invalid");
  }

  return sampleByBisection(launchState, options.bounds, (previous, step) =>
    rk4SecondOrderStep(previous, step, evaluateDDY),
  );
}

/** 按 Graphwar 当前模式计算真实发射点；传入的 center 是用户点选的士兵中心。 */
function getLaunchPoint(options: CreateGraphwarFormulaPathOptions, center: GraphPoint) {
  const angle = getLaunchAngle(options, center);
  return Number.isFinite(angle) ? moveFromSoldierCenter(center, angle) : center;
}

/** 按 Graphwar 当前模式计算发射角。 */
function getLaunchAngle(options: CreateGraphwarFormulaPathOptions, center: GraphPoint) {
  if (options.equation === "y") {
    return getNormalStartAngle(center.x, createYEvaluator(options));
  }
  if (options.equation === "dy") {
    return getFirstOrderStartAngle(center, createFirstOrderEvaluator(options));
  }
  if (options.algorithm !== "step") {
    return Number.NaN;
  }
  return getSecondOrderStartAngle(center, options);
}

/** 创建普通 y= 模式使用的函数值计算器。 */
function createYEvaluator(options: CreateGraphwarFormulaPathOptions) {
  return options.algorithm === "abs"
    ? (x: number) => evaluateAbsConnectorY(x, options.points)
    : (x: number) => evaluateStepY(x, options.points, options.steepness, options.formulaEvaluation);
}

/** 创建 y'= 模式使用的一阶导计算器。 */
function createFirstOrderEvaluator(options: CreateGraphwarFormulaPathOptions): FirstOrderEvaluator {
  return options.algorithm === "abs"
    ? (x) => evaluateAbsConnectorFirstDerivativeY(x, options.points, options.formulaEvaluation)
    : (x) => evaluateStepFirstDerivativeY(x, options.points, options.steepness);
}

/** 创建 y''= 模式使用的二阶导计算器。 */
function createSecondOrderEvaluator(options: CreateGraphwarFormulaPathOptions): SecondOrderEvaluator {
  return (x) => evaluateStepSecondDerivativeY(x, options.points, options.steepness, options.formulaEvaluation);
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

/** y'' 模式需要手调角度；按发射边缘点处的目标曲线斜率做固定点迭代。 */
function getSecondOrderStartAngle(center: GraphPoint, options: CreateGraphwarFormulaPathOptions) {
  let angle = Math.atan(evaluateStepFirstDerivativeY(center.x, options.points, options.steepness));
  let error = Number.POSITIVE_INFINITY;

  for (let index = 0; error > GRAPHWAR_ANGLE_ERROR && index < GRAPHWAR_MAX_ANGLE_LOOPS; index += 1) {
    const launchPoint = moveFromSoldierCenter(center, angle);
    const nextAngle = Math.atan(evaluateStepFirstDerivativeY(launchPoint.x, options.points, options.steepness));
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
) {
  const samples: GraphPoint[] = [createGraphPoint(start.x, start.y)];
  let previous = start;

  for (let index = 1; index < GRAPHWAR_FUNC_MAX_STEPS; index += 1) {
    const next = findNextSample(previous, calculateNext);
    if (!next.ok) {
      return createTrajectorySample(samples, next.stopReason);
    }

    samples.push(createGraphPoint(next.point.x, next.point.y));
    previous = next.point;
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
) {
  let step = GRAPHWAR_STEP_SIZE;
  let next = calculateNext(previous, step);

  while (isFinitePoint(next) && distanceSquared(previous, next) > GRAPHWAR_FUNC_MAX_STEP_DISTANCE_SQUARED) {
    if (next.x - previous.x <= GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE) {
      return { ok: false as const, stopReason: "too-steep" as const };
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

function createSecondOrderState(x: number, y: number, dy: number): SecondOrderState {
  return { ...createGraphPoint(x, y), dy };
}

function createTrajectorySample(points: GraphPoint[], stopReason: TrajectoryStopReason): GraphwarTrajectorySample {
  return { points, stopReason };
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
