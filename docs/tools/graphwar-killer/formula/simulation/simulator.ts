import {
  GRAPHWAR_ANGLE_ERROR,
  GRAPHWAR_FUNC_MAX_STEP_DISTANCE_SQUARED,
  GRAPHWAR_FUNC_MAX_STEPS,
  GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE,
  GRAPHWAR_GAME_SOLDIER_RADIUS,
  GRAPHWAR_MAX_ANGLE_LOOPS,
  GRAPHWAR_STEP_SIZE,
} from "../../core/game/constants";
import { graphwarToolDefaults } from "../../core/tool/defaults";
import { createGraphPoint } from "../../core/types";
import type { AlgorithmMode, EquationMode, GraphBounds, GraphPoint } from "../../core/types";
import { createGraphwarExpressionEvaluator } from "../expression/evaluator";
import type { GraphwarExpressionParserOptions } from "../expression/evaluator";
/** 封装 Graphwar 公式模拟器，按游戏步进规则计算轨迹和停止原因。 */
import { compileFormulaEvaluator } from "../generation/build";
import type { CompiledGraphwarFormulaMaterials, FormulaEvaluationOptions } from "../generation/build";
import { calculateStepFormulaCenterX, resolveStepFormula } from "../generation/step-numeric-strategy";
export { calculateStepFormulaCenterX } from "../generation/step-numeric-strategy";
export type { GraphwarExpressionParserOptions } from "../expression/evaluator";

/** 采样由路径点生成的公式时的完整输入，保持与 Graphwar 原版步进参数隔离。 */
export interface SampleGraphwarTrajectoryOptions {
  /** 路径点转公式的算法。 */
  algorithm: AlgorithmMode;
  /** 当前 Graphwar 坐标边界，用于出界判断。 */
  bounds: GraphBounds;
  /** Graphwar 对公式文本的解释模式。 */
  equation: EquationMode;
  /** 可选数值保护配置，确保模拟和生成公式时的 evaluator 一致。 */
  formulaEvaluation?: FormulaEvaluationOptions;
  /** 已按最终文本规则预编译的公式材料；用于候选验证热路径复用。 */
  compiledFormulaMaterials?: CompiledGraphwarFormulaMaterials;
  /** 已按 Graphwar 坐标表示的公式控制点。 */
  points: readonly GraphPoint[];
  /** 每个采样点后的早停钩子，用于目标/障碍验证。 */
  shouldStop?: (point: GraphPoint, previousPoint: GraphPoint | undefined, index: number) => boolean;
  /** 已验证前缀的采样状态；传入后从该点继续推进，而不是重新从发射点采样。 */
  initialState?: GraphwarTrajectorySamplingState;
  /** 士兵中心；Graphwar 实际发射点会从这里沿角度偏移半径。 */
  soldierCenter: GraphPoint;
  /** 从 initialState 继续时避免重复检查已经接受的前缀命中点。 */
  skipInitialStop?: boolean;
  /** Step 算法陡峭度。 */
  steepness: number;
}

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
  /** 已验证前缀的采样状态；传入后从该点继续推进。 */
  initialState?: GraphwarTrajectorySamplingState;
  /** 士兵中心；Graphwar 实际发射点会从这里沿角度偏移半径。 */
  soldierCenter: GraphPoint;
  /** 从 initialState 继续时避免重复检查已经接受的前缀命中点。 */
  skipInitialStop?: boolean;
}

/** 创建游戏实际公式点所需的路径和模式配置。 */
export interface CreateGraphwarFormulaPathOptions {
  /** 路径点转公式的算法。 */
  algorithm: AlgorithmMode;
  /** Graphwar 对公式文本的解释模式。 */
  equation: EquationMode;
  /** 可选数值保护配置，保证发射角迭代和采样使用同一求值行为。 */
  formulaEvaluation?: FormulaEvaluationOptions;
  /** 已按最终文本规则预编译的公式材料；用于避免发射角迭代重复建段。 */
  compiledFormulaMaterials?: CompiledGraphwarFormulaMaterials;
  /** 用户选择或 worker 生成的 Graphwar 路径点。 */
  points: readonly GraphPoint[];
  /** Step 算法陡峭度。 */
  steepness: number;
}

/** 模拟器停止原因，直接映射 Graphwar 原版采样限制和工具早停。 */
export type TrajectoryStopReason =
  | "completed"
  | "invalid"
  | "max-steps"
  | "out-of-bounds"
  | "stopped"
  | "too-steep"
  | "unsupported";

/** 可恢复采样状态；dy 只在 y''= 模式需要，普通 y= 和 y'= 模式保持为空。 */
export interface GraphwarTrajectorySamplingState {
  /** 当前 Graphwar 采样点。 */
  currentPoint: GraphPoint;
  /** 当前采样点的上一个点；早停逻辑需要它判断穿越关系时可复用。 */
  previousPoint?: GraphPoint;
  /** 当前点在 Graphwar 采样序列里的下标。 */
  sampleIndex: number;
  /** Y''= 模式的当前 y'；其他模式不设置。 */
  dy?: number;
}

/** Graphwar 规则采样的轨迹结果。 */
export interface GraphwarTrajectorySample {
  /** 最后一个采样点对应的可恢复状态。 */
  endState?: GraphwarTrajectorySamplingState;
  /** 按 Graphwar 游戏坐标记录的轨迹点。 */
  points: GraphPoint[];
  /** 采样停止原因，用于 UI 提示和 worker 调试统计。 */
  stopReason: TrajectoryStopReason;
}

/** 二阶 RK4 积分状态；dy 需要随 y 一起推进。 */
type SecondOrderState = GraphPoint & {
  /** 当前 y'。 */
  dy: number;
};

/** 内部 stepper 单步结果；调用方只看到 Graphwar 点和可缓存状态。 */
type GraphwarTrajectoryStepperResult =
  | {
      ok: true;
      point: GraphPoint;
      previousPoint: GraphPoint;
      sampleIndex: number;
      state: GraphwarTrajectorySamplingState;
    }
  | {
      ok: false;
      state: GraphwarTrajectorySamplingState;
      stopReason: TrajectoryStopReason;
    };

/** 可恢复采样器封装了当前模式的 evaluator、offset 和二分步长规则。 */
interface GraphwarTrajectoryStepper {
  /** 当前可缓存状态。 */
  state: GraphwarTrajectorySamplingState;
  /** 推进一个 Graphwar 采样点。 */
  step: () => GraphwarTrajectoryStepperResult;
}

/** Y'=f(x,y) 模式使用的一阶导求值器。 */
type FirstOrderEvaluator = (x: number, y: number) => number;
/** Y''=f(x,y,y') 模式使用的二阶导求值器。 */
type SecondOrderEvaluator = (x: number, y: number, dy: number) => number;

/** 把用户点选的士兵中心转换为 Graphwar 实际发射边缘点，供公式生成使用。 */
export function createGraphwarFormulaPathPoints(options: CreateGraphwarFormulaPathOptions): GraphPoint[] {
  if (options.points.length < 2) {
    return [...options.points];
  }

  let formulaPoints = createStepAdjustedFormulaPathPoints(options, options.points);
  const soldierCenter = options.points[0];
  // 原版只消费最终公式；工具还需让“整条公式算出的发射边缘点”反向收敛为公式首点，因此额外做固定点迭代。
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

/** Step 点击点是用户目标；先解析 canonical 有效 ΔY，再把 sigmoid 中心左移到目标 x 前。 */
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

  const resolvedFormula = resolveStepFormula(
    targetPoints,
    options.steepness,
    options.equation,
    options.formulaEvaluation,
  );
  const formulaPoints = [targetPoints[0]];
  for (let index = 1; index < targetPoints.length; index += 1) {
    const previousTarget = targetPoints[index - 1];
    const target = targetPoints[index];
    const transition = resolvedFormula.transitions[index - 1];
    formulaPoints.push(
      createGraphPoint(
        calculateStepFormulaCenterX(
          previousTarget.x,
          target.x,
          transition?.effectiveDeltaY ?? Number.NaN,
          resolvedFormula.formulaSteepness,
        ),
        target.y,
      ),
    );
  }
  return formulaPoints;
}

/** 使用 Graphwar 的采样、步长二分和 RK4 规则生成预览轨迹点。 */
export function sampleGraphwarTrajectory(options: SampleGraphwarTrajectoryOptions) {
  const stepperResult = createGraphwarTrajectoryStepper(options);
  if (!stepperResult.ok) {
    return createTrajectorySample([], stepperResult.stopReason);
  }

  return sampleWithTrajectoryStepper(stepperResult.stepper, options);
}

/** 创建可恢复的 Graphwar 轨迹采样器，供完整采样和增量前缀验证共用。 */
export function createGraphwarTrajectoryStepper(options: SampleGraphwarTrajectoryOptions) {
  if (options.points.length < 2) {
    return { ok: false as const, stopReason: "unsupported" as const };
  }
  if (options.equation === "y") {
    return createNormalFunctionStepper(options);
  }
  if (options.equation === "dy") {
    return createFirstOrderEquationStepper(options);
  }
  return createSecondOrderEquationStepper(options);
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
function createNormalFunctionStepper(options: SampleGraphwarTrajectoryOptions) {
  const evaluateY = createYEvaluator(options);
  const launchPoint = getLaunchPoint(options, options.soldierCenter);
  const offset = launchPoint.y - evaluateY(launchPoint.x);
  if (!isFinitePoint(launchPoint) || !Number.isFinite(offset)) {
    return { ok: false as const, stopReason: "invalid" as const };
  }

  return createBisectionTrajectoryStepper(
    launchPoint,
    options.bounds,
    (previous, step) => {
      const x = previous.x + step;
      return createGraphPoint(x, evaluateY(x) + offset);
    },
    { initialState: options.initialState, stopAtMinStep: true },
  );
}

/** 模拟 y'= 模式：先迭代发射角，再从士兵边缘开始做一阶 RK4。 */
function createFirstOrderEquationStepper(options: SampleGraphwarTrajectoryOptions) {
  const evaluateDY = createFirstOrderEvaluator(options);
  const launchPoint = getLaunchPoint(options, options.soldierCenter);
  if (!isFinitePoint(launchPoint)) {
    return { ok: false as const, stopReason: "invalid" as const };
  }

  return createBisectionTrajectoryStepper(
    launchPoint,
    options.bounds,
    (previous, step) => rk4FirstOrderStep(previous, step, evaluateDY),
    // Graphwar 原版 ODE 循环在 x 步长缩到下限后仍接受过长线段；这会产生穿墙隧穿。
    { initialState: options.initialState, stopAtMinStep: false },
  );
}

/** 模拟 y''= 模式：使用建议发射角和 tan(angle) 作为初始 y'，再做二阶 RK4。 */
function createSecondOrderEquationStepper(options: SampleGraphwarTrajectoryOptions) {
  if (options.algorithm === "abs") {
    return { ok: false as const, stopReason: "unsupported" as const };
  }

  const evaluateDDY = createSecondOrderEvaluator(options);
  const angle = getLaunchAngle(options, options.soldierCenter);
  const launchPoint = getLaunchPoint(options, options.soldierCenter);
  const launchState = createSecondOrderState(launchPoint.x, launchPoint.y, Math.tan(angle));
  if (!isFinitePoint(launchState) || !Number.isFinite(launchState.dy)) {
    return { ok: false as const, stopReason: "invalid" as const };
  }

  return createBisectionTrajectoryStepper(
    launchState,
    options.bounds,
    (previous, step) => rk4SecondOrderStep(previous, step, evaluateDDY),
    // 保持和一阶 ODE 相同的原版隧穿行为，避免预览误判会在陡峭段爆炸。
    { initialState: options.initialState, stopAtMinStep: false },
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
    {
      initialState: options.initialState,
      shouldStop: options.shouldStop,
      skipInitialStop: options.skipInitialStop,
      stopAtMinStep: true,
    },
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
    {
      initialState: options.initialState,
      shouldStop: options.shouldStop,
      skipInitialStop: options.skipInitialStop,
      stopAtMinStep: false,
    },
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
    {
      initialState: options.initialState,
      shouldStop: options.shouldStop,
      skipInitialStop: options.skipInitialStop,
      stopAtMinStep: false,
    },
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
  return compileFormulaEvaluator(
    options.points,
    options.steepness,
    options.algorithm,
    createEquationAwareFormulaEvaluation(options),
    options.compiledFormulaMaterials,
  ).evaluateY;
}

/** 创建 y'= 模式使用的一阶导计算器。 */
function createFirstOrderEvaluator(options: CreateGraphwarFormulaPathOptions): FirstOrderEvaluator {
  return compileFormulaEvaluator(
    options.points,
    options.steepness,
    options.algorithm,
    createEquationAwareFormulaEvaluation(options),
    options.compiledFormulaMaterials,
  ).evaluateFirstDerivativeY;
}

/** 创建 y''= 模式使用的二阶导计算器。 */
function createSecondOrderEvaluator(options: CreateGraphwarFormulaPathOptions): SecondOrderEvaluator {
  return compileFormulaEvaluator(
    options.points,
    options.steepness,
    options.algorithm,
    createEquationAwareFormulaEvaluation(options),
    options.compiledFormulaMaterials,
  ).evaluateSecondDerivativeY;
}

/** 独立调用模拟器时也要把方程传给 Step 编译器，不能默认退回 y= 的 canonical 系数。 */
function createEquationAwareFormulaEvaluation(options: CreateGraphwarFormulaPathOptions): FormulaEvaluationOptions {
  return options.formulaEvaluation?.equation === options.equation
    ? options.formulaEvaluation
    : { ...options.formulaEvaluation, equation: options.equation };
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

/** 用可恢复 stepper 执行完整采样；早停回调仍只在这里集中调用。 */
function sampleWithTrajectoryStepper(
  stepper: GraphwarTrajectoryStepper,
  options: Pick<SampleGraphwarTrajectoryOptions, "shouldStop" | "skipInitialStop">,
) {
  const samples: GraphPoint[] = [stepper.state.currentPoint];
  if (
    !options.skipInitialStop &&
    options.shouldStop?.(stepper.state.currentPoint, stepper.state.previousPoint, stepper.state.sampleIndex)
  ) {
    return createTrajectorySample(samples, "stopped", stepper.state);
  }

  while (true) {
    const next = stepper.step();
    if (!next.ok) {
      return createTrajectorySample(samples, next.stopReason, next.state);
    }

    samples.push(next.point);
    if (options.shouldStop?.(next.point, next.previousPoint, next.sampleIndex)) {
      return createTrajectorySample(samples, "stopped", next.state);
    }
  }
}

/** 用 Graphwar 的相邻点距离阈值和最小 x 步长执行采样；距离过大时对步长二分。 */
function sampleByBisection<TPoint extends GraphPoint>(
  start: TPoint,
  bounds: GraphBounds,
  calculateNext: (previous: TPoint, step: number) => TPoint,
  options: {
    initialState?: GraphwarTrajectorySamplingState;
    shouldStop?: (point: GraphPoint, previousPoint: GraphPoint | undefined, index: number) => boolean;
    skipInitialStop?: boolean;
    stopAtMinStep: boolean;
  },
) {
  const stepperResult = createBisectionTrajectoryStepper(start, bounds, calculateNext, {
    initialState: options.initialState,
    stopAtMinStep: options.stopAtMinStep,
  });
  return sampleWithTrajectoryStepper(stepperResult.stepper, options);
}

/** 创建只负责物理推进的二分步进器；命中/障碍早停由外层统一处理。 */
function createBisectionTrajectoryStepper<TPoint extends GraphPoint>(
  start: TPoint,
  bounds: GraphBounds,
  calculateNext: (previous: TPoint, step: number) => TPoint,
  options: { initialState?: GraphwarTrajectorySamplingState; stopAtMinStep: boolean },
) {
  const initialPoint = createInitialBisectionPoint(start, options.initialState);
  let previous = initialPoint;
  let state = createTrajectorySamplingState(
    initialPoint,
    options.initialState?.previousPoint,
    options.initialState?.sampleIndex ?? 0,
  );
  const stepper: GraphwarTrajectoryStepper = {
    get state() {
      return state;
    },
    step() {
      if (state.sampleIndex >= GRAPHWAR_FUNC_MAX_STEPS - 1) {
        return { ok: false as const, state, stopReason: "max-steps" as const };
      }

      const next = findNextSample(previous, calculateNext, options);
      if (!next.ok) {
        return { ok: false as const, state, stopReason: next.stopReason };
      }

      const previousPoint = createGraphPoint(previous.x, previous.y);
      previous = next.point;
      state = createTrajectorySamplingState(next.point, previousPoint, state.sampleIndex + 1);
      if (isOutsideGraphBounds(next.point, bounds)) {
        return { ok: false as const, state, stopReason: "out-of-bounds" as const };
      }

      return {
        ok: true as const,
        point: state.currentPoint,
        previousPoint,
        sampleIndex: state.sampleIndex,
        state,
      };
    },
  };
  return { ok: true as const, stepper };
}

/** 优先使用缓存前缀的当前物理点，避免只恢复 sampleIndex 而从发射点重新推进。 */
function createInitialBisectionPoint<TPoint extends GraphPoint>(
  start: TPoint,
  initialState: GraphwarTrajectorySamplingState | undefined,
): TPoint {
  if (!initialState) {
    return start;
  }
  if (isSecondOrderState(start)) {
    return createSecondOrderState(
      initialState.currentPoint.x,
      initialState.currentPoint.y,
      initialState.dy ?? 0,
    ) as unknown as TPoint;
  }
  return createGraphPoint(initialState.currentPoint.x, initialState.currentPoint.y) as TPoint;
}

/** 把内部点状态复制成可安全缓存的 Graphwar 采样状态。 */
function createTrajectorySamplingState<TPoint extends GraphPoint>(
  current: TPoint,
  previousPoint: GraphPoint | undefined,
  sampleIndex: number,
): GraphwarTrajectorySamplingState {
  return {
    currentPoint: createGraphPoint(current.x, current.y),
    dy: isSecondOrderState(current) ? current.dy : undefined,
    previousPoint,
    sampleIndex,
  };
}

/** 收窄二阶积分状态，避免普通 GraphPoint 的品牌字段影响 dy 类型推断。 */
function isSecondOrderState(point: GraphPoint): point is SecondOrderState {
  return "dy" in point && typeof point.dy === "number";
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
      // y= 会在这里爆炸；ODE 官方源码的 for 条件会直接退出并继续用当前过长点。
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
function createTrajectorySample(
  points: GraphPoint[],
  stopReason: TrajectoryStopReason,
  endState?: GraphwarTrajectorySamplingState,
): GraphwarTrajectorySample {
  return { endState, points, stopReason };
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
