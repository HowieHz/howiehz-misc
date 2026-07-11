import {
  GRAPHWAR_FUNC_MAX_STEP_DISTANCE_SQUARED,
  GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE,
  GRAPHWAR_GAME_SOLDIER_RADIUS,
  GRAPHWAR_PLANE_HEIGHT,
  GRAPHWAR_PLANE_LENGTH,
  GRAPHWAR_STEP_SIZE,
} from "../../core/game/constants";
import { graphToImagePoint, imageToGraphPoint } from "../../core/geometry";
import { MAX_FORMULA_DECIMAL_PLACES, floorToDecimalPlaces, roundToDecimalPlaces } from "../../core/numbers";
import { createGraphPoint } from "../../core/types";
import type {
  AlgorithmMode,
  BoundsRect,
  EquationMode,
  FormulaResult,
  GraphBounds,
  GraphPoint,
  PixelPoint,
} from "../../core/types";
/** 负责按 Graphwar 公式规则采样轨迹，并判断路径与目标/障碍的交互。 */
import { buildFormula, compileGraphwarFormulaMaterials, formulaUsesStableSignRatio } from "../generation/build";
import type { CompiledGraphwarFormulaMaterials } from "../generation/build";
import {
  GRAPHWAR_TOOL_SIGN_EPSILON,
  calculateStepFormulaCenterX,
  createStepOverflowProtectionRange,
  probeSignEpsilonRequirement,
  quantizeStepFormulaSteepness,
  resolveStepFormulaTransition,
} from "../generation/step-numeric-strategy";
import type { FormulaEvaluationOptions, StepGlitchSegment } from "../generation/step-numeric-strategy";
import {
  createGraphwarFormulaPathPoints,
  getGraphwarLaunchAngle,
  sampleGraphwarExpressionTrajectory,
  sampleGraphwarTrajectory,
} from "../simulation/simulator";
import type {
  GraphwarExpressionParserOptions,
  GraphwarTrajectorySample,
  GraphwarTrajectorySamplingState,
} from "../simulation/simulator";

/** 轨迹采样主动提前停止的原因；只记录与目标/障碍判定有关的短路。 */
export type GraphwarTrajectoryEarlyStopReason = "obstacle" | "target";

/** 由页面设置折叠出的公式采样配置，确保 UI、worker 和 finalizer 使用同一组规则。 */
export interface GraphwarTrajectoryFormulaSettings {
  /** 路径点转公式的算法。 */
  algorithm: AlgorithmMode;
  /** 最终公式文本的小数位；只限制表达式参数，不约分路径点或发射点。 */
  decimalPlaces: number;
  /** Graphwar 对公式文本的解释模式。 */
  equation: EquationMode;
  /** 路径生成公式时的 steepness；省略时使用 steepness。 */
  formulaPathSteepness?: number;
  /** Step 公式的陡峭度。 */
  steepness: number;
  /** 是否允许 step y'= 在普通 sigmoid 路径区域受阻时替换为邪道门函数项。 */
  stepGlitchMode: boolean;
  /** Step 邪道模式近似探测普通 sigmoid 路径区域时使用的 Graphwar 原始平面 mask。 */
  stepGlitchObstacleMask?: Uint8Array;
  /** 是否允许 step 公式启用 exp 抗溢出保护。 */
  stepOverflowProtection: boolean;
}

/** 一次轨迹采样可复用的公式上下文，避免多个验证入口重复整理路径点、输出文本和保护参数。 */
export interface GraphwarTrajectoryFormulaContext {
  /** 最终文本等价的公式材料；文本生成、sign 探测和内部采样应复用同一份结构。 */
  compiledMaterials: CompiledGraphwarFormulaMaterials;
  /** 公式生成结果；expression 与 playbackExpression 必须保持同一份最终文本。 */
  formulaResult: FormulaResult;
  /** 按当前小数位生成的最终 Graphwar 表达式；UI 展示、复制和验证回放都应使用这同一份文本。 */
  playbackExpression: string;
  /** 传给公式 evaluator 的数值保护选项。 */
  formulaEvaluation: FormulaEvaluationOptions;
  /** 已按发射点和 step 中心调整过的 Graphwar 路径点，保留 double 精度。 */
  formulaPoints: GraphPoint[];
  /** 原始公式采样设置，随上下文一起传递以保证求值模式一致。 */
  settings: GraphwarTrajectoryFormulaSettings;
  /** 轨迹确实会经过符号折点时使用的除零保护值。 */
  signEpsilon: number;
  /** 可选士兵中心；存在时可直接计算 Graphwar 发射角。 */
  soldierCenter?: GraphPoint;
}

/** 轨迹碰撞判定配置，单独建模是为了让目标命中和障碍命中共用同一采样管线。 */
export interface GraphwarTrajectoryCollisionSettings {
  /** 边界内缩值，单位为 Graphwar 原始平面像素，防止弹道贴边时被当作可通行。 */
  boundaryExpansion?: number;
  /** Graphwar 原始 770x450 平面上的障碍 mask。 */
  mask?: Uint8Array;
}

/** 弹道需要按顺序命中的目标圆；一键清图用它区分不同士兵的真实命中半径。 */
export interface GraphwarTrajectoryTargetCircle {
  /** 目标圆心，截图像素坐标。 */
  center: PixelPoint;
  /** 目标命中半径，截图像素。 */
  radius: number;
}

/** 低层采样结果，保留可见像素、命中序列和早停位置供不同调用方二次包装。 */
export interface GraphwarTrajectorySampleResult {
  /** 主动早停原因；未设置表示按 Graphwar 原始停止条件结束。 */
  earlyStopReason?: GraphwarTrajectoryEarlyStopReason;
  /** 首次碰到障碍的采样点索引，-1 表示未碰到。 */
  obstacleHitIndex: number;
  /** 按顺序已经命中的目标数量。 */
  reachedTargetCount: number;
  /** Graphwar 规则采样出的游戏坐标轨迹。 */
  sample: GraphwarTrajectorySample;
  /** 首次命中当前目标的采样点索引，-1 表示未命中。 */
  targetHitIndex: number;
  /** 映射回截图后的可绘制轨迹像素。 */
  visiblePixels: PixelPoint[];
}

/** 单目标路径验证结果，一键清图和智能寻路用它判断弹道是否先命中目标。 */
export interface GraphwarPathTrajectoryResult {
  /** 目标或障碍导致的早停原因。 */
  earlyStopReason?: GraphwarTrajectoryEarlyStopReason;
  /** True 表示轨迹在碰到障碍前命中目标。 */
  reachesTargetBeforeObstacle: boolean;
  /** 原始 Graphwar 采样结果，供调试和成本统计使用。 */
  sample: GraphwarTrajectorySample;
  /** 实际检查过的采样点数量。 */
  samplePointCount: number;
  /** 截图像素轨迹，页面可直接绘制。 */
  visiblePixels: PixelPoint[];
}

/** 多目标顺序验证结果，最终路线优化用它保证删点后仍按原击杀顺序命中。 */
export interface GraphwarPathTargetSequenceResult {
  /** 目标或障碍导致的早停原因。 */
  earlyStopReason?: GraphwarTrajectoryEarlyStopReason;
  /** 已按顺序命中的目标数量。 */
  reachedTargetCount: number;
  /** True 表示所有目标都在撞障碍前按序命中。 */
  reachesTargetSequenceBeforeObstacle: boolean;
  /** 原始 Graphwar 采样结果，供调试和成本统计使用。 */
  sample: GraphwarTrajectorySample;
  /** 实际检查过的采样点数量。 */
  samplePointCount: number;
  /** 截图像素轨迹，页面可直接绘制。 */
  visiblePixels: PixelPoint[];
}

/** 把路径点和 Graphwar 数值保护规则整理成一次采样可复用的公式上下文。 */
export function createGraphwarTrajectoryFormulaContext(options: {
  bounds: GraphBounds;
  points: readonly GraphPoint[];
  settings: GraphwarTrajectoryFormulaSettings;
  soldierCenter?: GraphPoint;
}): GraphwarTrajectoryFormulaContext {
  const state = createResolvedTrajectoryFormulaState(options);
  const formulaResult = buildFormula(
    state.formulaPoints,
    options.settings.steepness,
    options.settings.equation,
    options.settings.algorithm,
    options.settings.decimalPlaces,
    {
      compiledMaterials: state.compiledMaterials,
      signEpsilon: state.signEpsilon,
      stepOverflowProtection: state.formulaEvaluation.stepOverflowProtection,
      stepOverflowProtectionRange: state.formulaEvaluation.stepOverflowProtectionRange,
    },
  );
  return {
    // 先生成最终公式文本并保存；后续验证必须回放这份文本，而不是直接调用内存里的 evaluator。
    compiledMaterials: state.compiledMaterials,
    playbackExpression: formulaResult.expression,
    formulaResult,
    formulaEvaluation: state.formulaEvaluation,
    formulaPoints: state.formulaPoints,
    settings: options.settings,
    signEpsilon: state.signEpsilon,
    soldierCenter: options.soldierCenter,
  };
}

interface TrajectoryFormulaState {
  compiledMaterials: CompiledGraphwarFormulaMaterials;
  formulaEvaluation: FormulaEvaluationOptions;
  formulaPoints: GraphPoint[];
  signEpsilon: number;
}

interface StepSimulationRefinement {
  stepGlitchSegments: readonly (StepGlitchSegment | undefined)[];
  stepSegmentDeltaYs: readonly (number | undefined)[];
}

const GRAPHWAR_STEP_GLITCH_MIN_STEP = createGraphwarStepGlitchMinStep();
/** 邪道项会反向改变发射点；少量外层迭代让替换项、普通补偿和中心互相收敛。 */
const STEP_FORMULA_REFINEMENT_PASSES = 3;
// 初始 0.01 可用两位小数精确表示；每缩半一次多保留一位，确保左门仍是严格的 R-w。
const GRAPHWAR_STEP_GLITCH_INITIAL_WINDOW_DECIMAL_PLACES = Math.max(0, Math.ceil(-Math.log10(GRAPHWAR_STEP_SIZE)));
// 一阶 RK4 更新量是 h*(k1 + 2*k2 + 2*k3 + k4)/6。邪道门函数临界时，
// 4 次采样里可能只有部分 k 取到 D，其余近似 0；因此有效位移是 factor*h*D。
// 权重 {1, 2, 2, 1}/6 的非零子集和去重后只有这六档：1/6、1/3、1/2、2/3、5/6、1。
// 每个 x 窗口按 D = ΔY / (factor * minStep) 回放六档，只从恰好一次邪道跳转的候选中择优。
const STEP_GLITCH_RK4_CONTRIBUTION_FACTORS = [1, 5 / 6, 2 / 3, 1 / 2, 1 / 3, 1 / 6] as const;

interface StepGlitchCandidateContext extends StepGlitchPrefixFormulaContext {
  deltaYOverride: number | undefined;
  formulaCenterX: number;
  mask: Uint8Array;
  prefixFormula: StepGlitchPrefixFormula;
  segmentStartY: number;
  soldierCenter: GraphPoint;
}

interface StepGlitchPrefixFormulaContext {
  baseDeltaYs: readonly (number | undefined)[];
  baseSegments: readonly (StepGlitchSegment | undefined)[];
  segmentIndex: number;
  signEpsilon: number;
}

interface StepGlitchPrefixFormula {
  compiledMaterials: CompiledGraphwarFormulaMaterials;
  formulaEvaluation: FormulaEvaluationOptions;
}

function createResolvedTrajectoryFormulaState(options: {
  bounds: GraphBounds;
  points: readonly GraphPoint[];
  settings: GraphwarTrajectoryFormulaSettings;
  soldierCenter?: GraphPoint;
}): TrajectoryFormulaState {
  const plainState = createTrajectoryFormulaState(options, 0);
  if (resolveSignEpsilonRequirement(options, plainState) === 0) {
    return plainState;
  }

  // 无保护状态已经踩中 sign 折点时，应保留 epsilon 并用同一 sign 重新生成公式点。
  return createTrajectoryFormulaState(options, GRAPHWAR_TOOL_SIGN_EPSILON);
}

function createTrajectoryFormulaState(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
    soldierCenter?: GraphPoint;
  },
  signEpsilon: number,
): TrajectoryFormulaState {
  let formulaPoints = createResolvedFormulaPathPoints(options, signEpsilon);
  let stepGlitchSegments: readonly (StepGlitchSegment | undefined)[] | undefined = createStepGlitchSegments(
    options,
    formulaPoints,
  );
  let stepSegmentDeltaYs: readonly (number | undefined)[] | undefined;
  if (stepGlitchSegments) {
    for (let pass = 0; pass < STEP_FORMULA_REFINEMENT_PASSES; pass += 1) {
      const refined = refineStepSegmentsWithSimulation(
        options,
        formulaPoints,
        stepGlitchSegments,
        stepSegmentDeltaYs,
        signEpsilon,
      );
      if (refined) {
        stepGlitchSegments = refined.stepGlitchSegments;
        stepSegmentDeltaYs = refined.stepSegmentDeltaYs;
      }

      // 最终替换项也会改变发射角和发射边缘点；必须把它们喂回原有固定点迭代后再验一次候选。
      const nextFormulaPoints = createResolvedFormulaPathPoints(
        options,
        signEpsilon,
        stepGlitchSegments,
        stepSegmentDeltaYs,
      );
      const stable = !refined && sameGraphPoints(formulaPoints, nextFormulaPoints);
      formulaPoints = nextFormulaPoints;
      if (stable) {
        break;
      }
    }
  }

  const formulaEvaluation = createTrajectoryFormulaEvaluation(
    options,
    formulaPoints,
    signEpsilon,
    stepGlitchSegments,
    stepSegmentDeltaYs,
  );
  const compiledMaterials = compileGraphwarFormulaMaterials(
    formulaPoints,
    options.settings.steepness,
    options.settings.algorithm,
    formulaEvaluation,
  );
  return {
    compiledMaterials,
    formulaEvaluation,
    formulaPoints,
    signEpsilon,
  };
}

function createTrajectoryFormulaEvaluation(
  options: {
    bounds: GraphBounds;
    settings: GraphwarTrajectoryFormulaSettings;
  },
  formulaPoints: readonly GraphPoint[],
  signEpsilon: number,
  stepGlitchSegments?: readonly (StepGlitchSegment | undefined)[],
  stepSegmentDeltaYs?: readonly (number | undefined)[],
  stepDisabledSegments?: readonly boolean[],
): FormulaEvaluationOptions {
  return {
    equation: options.settings.equation,
    formulaDecimalPlaces: options.settings.decimalPlaces,
    signEpsilon,
    stepGlitchSegments,
    stepSegmentDeltaYs,
    stepDisabledSegments,
    stepOverflowProtection: options.settings.stepOverflowProtection,
    stepOverflowProtectionRange: createStepOverflowProtectionRange(options.bounds, formulaPoints),
  };
}

function refineStepSegmentsWithSimulation(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
    soldierCenter?: GraphPoint;
  },
  formulaPoints: readonly GraphPoint[],
  stepGlitchSegments: readonly (StepGlitchSegment | undefined)[] | undefined,
  stepSegmentDeltaYs: readonly (number | undefined)[] | undefined,
  signEpsilon: number,
): StepSimulationRefinement | undefined {
  const mask = options.settings.stepGlitchObstacleMask;
  const soldierCenter = options.soldierCenter ?? formulaPoints[0];
  if (!stepGlitchSegments || !mask || !soldierCenter || options.points.length < 2) {
    return undefined;
  }

  const refinedSegments = [...stepGlitchSegments];
  const refinedDeltaYs = [...(stepSegmentDeltaYs ?? [])];
  const refinedFormulaPoints = [...formulaPoints];
  let changed = false;

  for (let segmentIndex = 0; segmentIndex < options.points.length - 1; segmentIndex += 1) {
    const previousSegment = segmentIndex > 0 ? refinedSegments[segmentIndex - 1] : undefined;
    const prefixFormula = createStepGlitchPrefixFormula(options, refinedFormulaPoints, {
      baseDeltaYs: refinedDeltaYs,
      baseSegments: refinedSegments,
      segmentIndex,
      signEpsilon,
    });
    const startSample =
      segmentIndex === 0
        ? { point: refinedFormulaPoints[0] }
        : sampleStepSegmentStart(options, refinedFormulaPoints, prefixFormula, {
            previousSegment,
            segmentIndex,
            soldierCenter,
          });
    if (!startSample || !Number.isFinite(startSample.point.y)) {
      break;
    }

    const nextDeltaY = createStepSegmentDeltaYFromActualStart(
      options,
      refinedFormulaPoints,
      segmentIndex,
      startSample.point.y,
    );
    // 邪道项替换了整段普通 sigmoid；即使落点正好等于控制点，也必须重建下一段累计原点。
    const nextDeltaYOverride = previousSegment ? nextDeltaY : undefined;
    const nextFormulaPoint = createStepSegmentFormulaPointAfterRefinement(
      options,
      refinedFormulaPoints,
      segmentIndex,
      startSample.point,
      nextDeltaYOverride,
    );
    const nextSegment = selectStepGlitchSegmentCandidate(options, refinedFormulaPoints, {
      baseDeltaYs: refinedDeltaYs,
      baseSegments: refinedSegments,
      deltaYOverride: nextDeltaYOverride,
      formulaCenterX:
        nextFormulaPoint?.x ?? refinedFormulaPoints[segmentIndex + 1]?.x ?? options.points[segmentIndex + 1].x,
      mask,
      prefixFormula,
      segmentIndex,
      segmentStartY: startSample.point.y,
      signEpsilon,
      soldierCenter,
    });
    if (
      sameStepGlitchSegment(refinedSegments[segmentIndex], nextSegment) &&
      refinedDeltaYs[segmentIndex] === nextDeltaYOverride &&
      sameGraphPoint(refinedFormulaPoints[segmentIndex + 1], nextFormulaPoint)
    ) {
      continue;
    }

    // 邪道段会把实际 y 带偏；后续普通 step 的 ΔY 和中心点都要从模拟器落点继续累计。
    refinedSegments[segmentIndex] = nextSegment;
    refinedDeltaYs[segmentIndex] = nextDeltaYOverride;
    if (nextFormulaPoint) {
      refinedFormulaPoints[segmentIndex + 1] = nextFormulaPoint;
    }
    changed = true;
  }

  return changed ? { stepGlitchSegments: refinedSegments, stepSegmentDeltaYs: refinedDeltaYs } : undefined;
}

interface StepSegmentStartSample {
  point: GraphPoint;
}

/** 编译不含当前段的前缀公式；段起点和各窗口的跳前探测共用它，避免 seed 邪道项污染恢复状态。 */
function createStepGlitchPrefixFormula(
  options: {
    bounds: GraphBounds;
    settings: GraphwarTrajectoryFormulaSettings;
  },
  formulaPoints: readonly GraphPoint[],
  context: StepGlitchPrefixFormulaContext,
): StepGlitchPrefixFormula {
  const prefixSegments = [...context.baseSegments];
  const prefixDeltaYs = [...context.baseDeltaYs];
  const disabledSegments: boolean[] = [];
  prefixSegments[context.segmentIndex] = undefined;
  disabledSegments[context.segmentIndex] = true;
  const formulaEvaluation = createTrajectoryFormulaEvaluation(
    options,
    formulaPoints,
    context.signEpsilon,
    prefixSegments,
    prefixDeltaYs,
    disabledSegments,
  );
  return {
    compiledMaterials: compileGraphwarFormulaMaterials(
      formulaPoints,
      options.settings.steepness,
      options.settings.algorithm,
      formulaEvaluation,
    ),
    formulaEvaluation,
  };
}

function sampleStepGlitchPrefix(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
  },
  formulaPoints: readonly GraphPoint[],
  prefixFormula: StepGlitchPrefixFormula,
  soldierCenter: GraphPoint,
  stopX: number,
) {
  return sampleGraphwarTrajectory({
    algorithm: options.settings.algorithm,
    bounds: options.bounds,
    equation: options.settings.equation,
    compiledFormulaMaterials: prefixFormula.compiledMaterials,
    formulaEvaluation: prefixFormula.formulaEvaluation,
    points: formulaPoints,
    shouldStop: (point) => point.x >= stopX,
    soldierCenter,
    steepness: options.settings.steepness,
  });
}

function sampleStepSegmentStart(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
  },
  formulaPoints: readonly GraphPoint[],
  prefixFormula: StepGlitchPrefixFormula,
  context: {
    previousSegment: StepGlitchSegment | undefined;
    segmentIndex: number;
    soldierCenter: GraphPoint;
  },
): StepSegmentStartSample | undefined {
  const stopX = createStepSegmentRefinementStopX(options.points[context.segmentIndex].x, context.previousSegment);
  const sample = sampleStepGlitchPrefix(options, formulaPoints, prefixFormula, context.soldierCenter, stopX);
  if (sample.stopReason !== "stopped") {
    return undefined;
  }

  const actualStartPoint = sample.points[sample.points.length - 1];
  return actualStartPoint && Number.isFinite(actualStartPoint.y) ? { point: actualStartPoint } : undefined;
}

function selectStepGlitchSegmentCandidate(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
  },
  formulaPoints: readonly GraphPoint[],
  context: StepGlitchCandidateContext,
) {
  const candidateContext = createStepGlitchCandidateContext(options, formulaPoints, context);
  const source = createStepGlitchCandidateSource(
    options,
    formulaPoints,
    candidateContext.segmentIndex,
    candidateContext.formulaCenterX,
    candidateContext.segmentStartY,
    options.settings.decimalPlaces,
    candidateContext.mask,
  );
  if (!source) {
    return undefined;
  }

  // 从 0.01 开始逐档缩半；当前窗口出现单跳候选后立即采用，不再测试更窄窗口。
  for (
    let windowWidth = GRAPHWAR_STEP_SIZE, windowDecimalPlaces = GRAPHWAR_STEP_GLITCH_INITIAL_WINDOW_DECIMAL_PLACES;
    windowWidth >= GRAPHWAR_STEP_GLITCH_MIN_STEP;
    windowWidth /= 2, windowDecimalPlaces += 1
  ) {
    const previous = options.points[candidateContext.segmentIndex];
    const target = options.points[candidateContext.segmentIndex + 1];
    const windowedJump = createStepGlitchJump(
      previous.x,
      target.x,
      windowWidth,
      options.settings.decimalPlaces,
      windowDecimalPlaces,
    );
    if (!windowedJump) {
      continue;
    }

    // 同一窗口的六档 RK4 候选共享左门和跳前高度；只需为不同 factor 改写 D。
    const preJumpSample = sampleStepGlitchPreJump(options, formulaPoints, candidateContext, windowedJump);
    if (!preJumpSample) {
      continue;
    }
    const replacementDeltaY = source.targetY - preJumpSample.point.y;
    const gateY = createStepGlitchFormulaGateY(source.targetY, replacementDeltaY, options.settings.decimalPlaces);
    // epsilon 尾值或邪道落点覆盖都会改变候选的完整系数集；此时不能拼接旧公式采出的前缀状态。
    const candidateInitialState =
      candidateContext.signEpsilon === 0 && candidateContext.deltaYOverride === undefined
        ? preJumpSample.resumeState
        : undefined;
    let bestSegment: StepGlitchSegment | undefined;
    let bestError = Number.POSITIVE_INFINITY;
    for (const factor of STEP_GLITCH_RK4_CONTRIBUTION_FACTORS) {
      const candidate = createStepGlitchSegmentFromJump(windowedJump, source.targetY, gateY, replacementDeltaY, factor);
      const sample = sampleStepGlitchCandidate(
        options,
        formulaPoints,
        candidateContext,
        candidate,
        candidateInitialState,
      );
      const landingPoint = sample.stopReason === "stopped" ? sample.points[sample.points.length - 1] : undefined;
      if (!landingPoint || !Number.isFinite(landingPoint.y) || countStepGlitchJumps(sample.points, candidate) !== 1) {
        continue;
      }

      const error = Math.abs(landingPoint.y - candidate.targetY);
      if (error < bestError) {
        bestError = error;
        bestSegment = candidate;
      }
    }
    if (bestSegment) {
      return bestSegment;
    }
  }
  return undefined;
}

/** ΔY 覆盖会改写后续 canonical 系数；候选的跳前探针必须先用同一份覆盖量重编译。 */
function createStepGlitchCandidateContext(
  options: {
    bounds: GraphBounds;
    settings: GraphwarTrajectoryFormulaSettings;
  },
  formulaPoints: readonly GraphPoint[],
  context: StepGlitchCandidateContext,
): StepGlitchCandidateContext {
  if (context.deltaYOverride === undefined) {
    return context;
  }

  const baseDeltaYs = [...context.baseDeltaYs];
  baseDeltaYs[context.segmentIndex] = context.deltaYOverride;
  return {
    ...context,
    baseDeltaYs,
    prefixFormula: createStepGlitchPrefixFormula(options, formulaPoints, {
      baseDeltaYs,
      baseSegments: context.baseSegments,
      segmentIndex: context.segmentIndex,
      signEpsilon: context.signEpsilon,
    }),
  };
}

function sampleStepGlitchCandidate(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
  },
  formulaPoints: readonly GraphPoint[],
  context: StepGlitchCandidateContext,
  candidate: StepGlitchSegment,
  initialState: GraphwarTrajectorySamplingState | undefined,
) {
  const candidateSegments = [...context.baseSegments];
  const candidateDeltaYs = [...context.baseDeltaYs];
  candidateSegments[context.segmentIndex] = candidate;
  candidateDeltaYs[context.segmentIndex] = context.deltaYOverride;
  const formulaEvaluation = createTrajectoryFormulaEvaluation(
    options,
    formulaPoints,
    context.signEpsilon,
    candidateSegments,
    candidateDeltaYs,
  );
  const compiledMaterials = compileGraphwarFormulaMaterials(
    formulaPoints,
    options.settings.steepness,
    options.settings.algorithm,
    formulaEvaluation,
  );
  return sampleGraphwarTrajectory({
    algorithm: options.settings.algorithm,
    bounds: options.bounds,
    equation: options.settings.equation,
    compiledFormulaMaterials: compiledMaterials,
    formulaEvaluation,
    initialState,
    points: formulaPoints,
    shouldStop: (point) => point.x >= candidate.endX,
    soldierCenter: context.soldierCenter,
    steepness: options.settings.steepness,
  });
}

function countStepGlitchJumps(points: readonly GraphPoint[], candidate: StepGlitchSegment) {
  let jumpCount = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (point.x < candidate.startX || previous.x > candidate.endX) {
      continue;
    }

    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    // 官方 ODE 只会在 x 步长到达下限时接受仍然超距的点；每个这样的相邻段就是一次邪道跳转。
    if (dx <= GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE && dx * dx + dy * dy > GRAPHWAR_FUNC_MAX_STEP_DISTANCE_SQUARED) {
      jumpCount += 1;
      if (jumpCount > 1) {
        return jumpCount;
      }
    }
  }
  return jumpCount;
}

interface StepGlitchPreJumpSample {
  point: GraphPoint;
  resumeState: GraphwarTrajectorySamplingState;
}

function sampleStepGlitchPreJump(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
  },
  formulaPoints: readonly GraphPoint[],
  context: StepGlitchCandidateContext,
  jump: StepGlitchJump,
): StepGlitchPreJumpSample | undefined {
  const sample = sampleStepGlitchPrefix(
    options,
    formulaPoints,
    context.prefixFormula,
    context.soldierCenter,
    jump.startX,
  );
  const crossingIndex = sample.points.length - 1;
  const previousIndex = crossingIndex - 1;
  const crossingPoint = sample.points[sample.points.length - 1];
  const previousPoint = sample.points[previousIndex];
  if (
    sample.stopReason !== "stopped" ||
    !previousPoint ||
    !crossingPoint ||
    !(previousPoint.x < jump.startX) ||
    !(crossingPoint.x >= jump.startX) ||
    !(crossingPoint.x > previousPoint.x)
  ) {
    return undefined;
  }

  // 探针可能一步跨过左门；在门线上插值高度，但从门左真实接受点恢复，让候选重新计算跨门 RK4。
  const ratio = (jump.startX - previousPoint.x) / (crossingPoint.x - previousPoint.x);
  const point = createGraphPoint(jump.startX, previousPoint.y + ratio * (crossingPoint.y - previousPoint.y));
  return {
    point,
    resumeState: {
      currentPoint: previousPoint,
      previousPoint: previousIndex > 0 ? sample.points[previousIndex - 1] : undefined,
      // 前缀探针始终从发射点开始，因此本地 points 下标就是全局 sampleIndex。
      sampleIndex: previousIndex,
    },
  };
}

function createStepSegmentRefinementStopX(pointX: number, previousSegment: StepGlitchSegment | undefined) {
  // 前一段是邪道段时，要等局部 x 窗口关闭后再取落点；否则会把跳前 y 误当成下一段起点。
  return previousSegment ? previousSegment.endX : pointX;
}

function createStepSegmentDeltaYFromActualStart(
  options: {
    points: readonly GraphPoint[];
  },
  formulaPoints: readonly GraphPoint[],
  segmentIndex: number,
  actualStartY: number,
) {
  const target = options.points[segmentIndex + 1];
  const formulaTargetY = formulaPoints[segmentIndex + 1]?.y ?? target.y;
  return formulaTargetY - actualStartY;
}

function createStepSegmentFormulaPointAfterRefinement(
  options: {
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
  },
  formulaPoints: readonly GraphPoint[],
  segmentIndex: number,
  actualStartPoint: GraphPoint,
  deltaYOverride: number | undefined,
) {
  const formulaTarget = formulaPoints[segmentIndex + 1];
  const target = options.points[segmentIndex + 1];
  if (deltaYOverride === undefined || !formulaTarget || !target) {
    return formulaTarget;
  }

  const formulaSteepness = quantizeStepFormulaSteepness(options.settings.steepness, options.settings.decimalPlaces);
  const transition = resolveStepFormulaTransition(
    actualStartPoint.y,
    formulaTarget.y,
    options.settings.equation,
    formulaSteepness,
    options.settings.decimalPlaces,
  );
  // 邪道后的普通段要按 canonical 有效 ΔY 重算中心；否则低精度文本会与内部中心脱节。
  return createGraphPoint(
    calculateStepFormulaCenterX(actualStartPoint.x, target.x, transition.effectiveDeltaY, formulaSteepness),
    formulaTarget.y,
  );
}

function sameStepGlitchSegment(left: StepGlitchSegment | undefined, right: StepGlitchSegment | undefined) {
  if (!left || !right) {
    return left === right;
  }

  return (
    left.derivative === right.derivative &&
    left.endX === right.endX &&
    left.gateY === right.gateY &&
    left.startX === right.startX &&
    left.targetY === right.targetY
  );
}

function sameGraphPoint(left: GraphPoint | undefined, right: GraphPoint | undefined) {
  if (!left || !right) {
    return left === right;
  }

  return left.x === right.x && left.y === right.y;
}

/** Graphwar 缩步只会尝试 STEP_SIZE/2^n；邪道项的 D 需要按最后一个实际档位估算。 */
function createGraphwarStepGlitchMinStep() {
  let step = GRAPHWAR_STEP_SIZE;
  while (step > GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE) {
    step /= 2;
  }
  return step;
}

function createStepGlitchSegments(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
  },
  formulaPoints: readonly GraphPoint[],
) {
  const mask = options.settings.stepGlitchObstacleMask;
  if (
    !options.settings.stepGlitchMode ||
    options.settings.algorithm !== "step" ||
    options.settings.equation !== "dy" ||
    !mask ||
    options.points.length < 2
  ) {
    return undefined;
  }

  const segments: (StepGlitchSegment | undefined)[] = [];
  let hasGlitchSegment = false;
  for (let index = 1; index < options.points.length; index += 1) {
    const previous = options.points[index - 1];
    const target = options.points[index];
    const formulaPreviousY = formulaPoints[index - 1]?.y ?? previous.y;
    const formulaTargetY = formulaPoints[index]?.y ?? target.y;
    const formulaCenterX = formulaPoints[index]?.x ?? target.x;
    const targetY = createStepGlitchFormulaTargetY(formulaTargetY, options.settings.decimalPlaces);
    const replacementDeltaY = targetY - formulaPreviousY;
    const gateY = createStepGlitchFormulaGateY(targetY, replacementDeltaY, options.settings.decimalPlaces);
    const segment = createStepGlitchSegment(
      previous,
      target,
      formulaCenterX,
      targetY,
      gateY,
      replacementDeltaY,
      options.settings.decimalPlaces,
      options.bounds,
      mask,
    );
    segments.push(segment);
    hasGlitchSegment ||= Boolean(segment);
  }
  return hasGlitchSegment ? segments : undefined;
}

type StepGlitchJump = NonNullable<ReturnType<typeof createStepGlitchJump>>;

interface StepGlitchCandidateSource {
  targetY: number;
}

function createStepGlitchCandidateSource(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
  },
  formulaPoints: readonly GraphPoint[],
  segmentIndex: number,
  formulaCenterX: number,
  segmentStartY: number,
  decimalPlaces: number,
  mask: Uint8Array,
): StepGlitchCandidateSource | undefined {
  const previous = options.points[segmentIndex];
  const target = options.points[segmentIndex + 1];
  const formulaTargetY = formulaPoints[segmentIndex + 1]?.y ?? target.y;
  const targetY = createStepGlitchFormulaTargetY(formulaTargetY, decimalPlaces);
  const segmentStart = createGraphPoint(previous.x, segmentStartY);
  if (
    !(target.x > previous.x) ||
    !stepGlitchObstacleEnvelopeHitsObstacle(segmentStart, target, formulaCenterX, options.bounds, mask)
  ) {
    return undefined;
  }

  return { targetY };
}

function createStepGlitchFormulaTargetY(targetY: number, decimalPlaces: number) {
  // D 按最终公式小数位里的目标中心计算，避免文本回放和候选搜索目标不一致。
  return -roundToDecimalPlaces(-targetY, decimalPlaces);
}

function createStepGlitchFormulaGateY(targetY: number, deltaY: number, decimalPlaces: number) {
  if (deltaY === 0) {
    return targetY;
  }

  // 进入命中圈就应关闭 y 门：上跳关在下沿，下跳关在上沿，避免窗口内重复触发。
  const gateY = deltaY > 0 ? targetY - GRAPHWAR_GAME_SOLDIER_RADIUS : targetY + GRAPHWAR_GAME_SOLDIER_RADIUS;
  return -roundToDecimalPlaces(-gateY, decimalPlaces);
}

function createStepGlitchFormulaXWindow(
  targetX: number,
  width: number,
  decimalPlaces: number,
  windowDecimalPlaces: number,
) {
  const formulaEndX = floorToDecimalPlaces(targetX, decimalPlaces);
  const startDecimalPlaces = Math.min(MAX_FORMULA_DECIMAL_PLACES, Math.max(decimalPlaces, windowDecimalPlaces));
  return {
    endX: formulaEndX,
    startX: createStepGlitchFormulaXGate(formulaEndX - width, startDecimalPlaces),
  };
}

function createStepGlitchFormulaXGate(x: number, decimalPlaces: number) {
  return -roundToDecimalPlaces(-x, decimalPlaces);
}

function createStepGlitchSegment(
  previous: GraphPoint,
  target: GraphPoint,
  formulaCenterX: number,
  targetY: number,
  gateY: number,
  replacementDeltaY: number,
  decimalPlaces: number,
  bounds: GraphBounds,
  mask: Uint8Array,
): StepGlitchSegment | undefined {
  if (!stepGlitchObstacleEnvelopeHitsObstacle(previous, target, formulaCenterX, bounds, mask)) {
    return undefined;
  }

  const jump = createWidestStepGlitchJump(previous.x, target.x, decimalPlaces);
  if (!jump) {
    return undefined;
  }

  return createStepGlitchSegmentFromJump(jump, targetY, gateY, replacementDeltaY, 1);
}

function createStepGlitchSegmentFromJump(
  jump: StepGlitchJump,
  targetY: number,
  gateY: number,
  replacementDeltaY: number,
  contributionFactor: number,
): StepGlitchSegment {
  return {
    derivative: replacementDeltaY / (contributionFactor * jump.step),
    endX: jump.endX,
    gateY,
    startX: jump.startX,
    targetY,
  };
}

function createStepGlitchJump(
  previousX: number,
  targetX: number,
  width: number,
  decimalPlaces: number,
  windowDecimalPlaces: number,
) {
  if (!(targetX > previousX)) {
    return undefined;
  }

  const window = createStepGlitchFormulaXWindow(targetX, width, decimalPlaces, windowDecimalPlaces);
  if (!(window.endX > window.startX) || !(window.startX > previousX)) {
    return undefined;
  }
  return { ...window, step: GRAPHWAR_STEP_GLITCH_MIN_STEP };
}

function createWidestStepGlitchJump(previousX: number, targetX: number, decimalPlaces: number) {
  for (
    let width = GRAPHWAR_STEP_SIZE, windowDecimalPlaces = GRAPHWAR_STEP_GLITCH_INITIAL_WINDOW_DECIMAL_PLACES;
    width >= GRAPHWAR_STEP_GLITCH_MIN_STEP;
    width /= 2, windowDecimalPlaces += 1
  ) {
    const jump = createStepGlitchJump(previousX, targetX, width, decimalPlaces, windowDecimalPlaces);
    if (jump) {
      return jump;
    }
  }
  return undefined;
}

/** 用普通 sigmoid 的近似水平前缀和两块半高矩形做粗筛，避免把探测绑到某个邪道窗口。 */
function stepGlitchObstacleEnvelopeHitsObstacle(
  previous: GraphPoint,
  target: GraphPoint,
  formulaCenterX: number,
  bounds: GraphBounds,
  mask: Uint8Array,
) {
  if (
    !Number.isFinite(previous.x) ||
    !Number.isFinite(previous.y) ||
    !Number.isFinite(target.x) ||
    !Number.isFinite(target.y) ||
    !Number.isFinite(formulaCenterX) ||
    !(target.x > previous.x)
  ) {
    return false;
  }

  const centerX = Math.min(target.x, Math.max(previous.x, formulaCenterX));
  const symmetricStartX = Math.min(centerX, Math.max(previous.x, 2 * centerX - target.x));
  const midpointY = (previous.y + target.y) / 2;
  return (
    stepGlitchGraphRegionHitsObstacle(previous.x, symmetricStartX, previous.y, previous.y, bounds, mask) ||
    stepGlitchGraphRegionHitsObstacle(symmetricStartX, centerX, previous.y, midpointY, bounds, mask) ||
    stepGlitchGraphRegionHitsObstacle(centerX, target.x, midpointY, target.y, bounds, mask)
  );
}

/** 将 Graphwar 轴对齐区域映射到障碍 mask，闭区间扫描并在首个障碍像素处早停。 */
function stepGlitchGraphRegionHitsObstacle(
  startX: number,
  endX: number,
  startY: number,
  endY: number,
  bounds: GraphBounds,
  mask: Uint8Array,
) {
  const boundsMinX = Math.min(bounds.minX, bounds.maxX);
  const boundsMaxX = Math.max(bounds.minX, bounds.maxX);
  const boundsMinY = Math.min(bounds.minY, bounds.maxY);
  const boundsMaxY = Math.max(bounds.minY, bounds.maxY);
  const regionMinX = Math.min(startX, endX);
  const regionMaxX = Math.max(startX, endX);
  const regionMinY = Math.min(startY, endY);
  const regionMaxY = Math.max(startY, endY);
  if (regionMaxX < boundsMinX || regionMinX > boundsMaxX || regionMaxY < boundsMinY || regionMinY > boundsMaxY) {
    return false;
  }

  const clippedMinX = Math.max(regionMinX, boundsMinX);
  const clippedMaxX = Math.min(regionMaxX, boundsMaxX);
  const clippedMinY = Math.max(regionMinY, boundsMinY);
  const clippedMaxY = Math.min(regionMaxY, boundsMaxY);
  const startPlaneX = graphXToPlaneX(clippedMinX, bounds);
  const endPlaneX = graphXToPlaneX(clippedMaxX, bounds);
  const startPlaneY = graphYToPlaneY(clippedMinY, bounds);
  const endPlaneY = graphYToPlaneY(clippedMaxY, bounds);
  const minX = Math.max(0, Math.min(GRAPHWAR_PLANE_LENGTH - 1, startPlaneX, endPlaneX));
  const maxX = Math.max(0, Math.min(GRAPHWAR_PLANE_LENGTH - 1, Math.max(startPlaneX, endPlaneX)));
  const minY = Math.max(0, Math.min(GRAPHWAR_PLANE_HEIGHT - 1, startPlaneY, endPlaneY));
  const maxY = Math.max(0, Math.min(GRAPHWAR_PLANE_HEIGHT - 1, Math.max(startPlaneY, endPlaneY)));
  for (let y = minY; y <= maxY; y += 1) {
    const rowOffset = y * GRAPHWAR_PLANE_LENGTH;
    for (let x = minX; x <= maxX; x += 1) {
      if (mask[rowOffset + x]) {
        return true;
      }
    }
  }
  return false;
}

function graphXToPlaneX(x: number, bounds: GraphBounds) {
  return Math.floor(((x - bounds.minX) / (bounds.maxX - bounds.minX)) * GRAPHWAR_PLANE_LENGTH);
}

function graphYToPlaneY(y: number, bounds: GraphBounds) {
  return Math.floor(((bounds.maxY - y) / (bounds.maxY - bounds.minY)) * GRAPHWAR_PLANE_HEIGHT);
}

const FORMULA_PATH_RANGE_RESOLUTION_PASSES = 3;

function createResolvedFormulaPathPoints(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
  },
  signEpsilon: number,
  stepGlitchSegments?: readonly (StepGlitchSegment | undefined)[],
  stepSegmentDeltaYs?: readonly (number | undefined)[],
) {
  let formulaEvaluation: FormulaEvaluationOptions = {
    equation: options.settings.equation,
    formulaDecimalPlaces: options.settings.decimalPlaces,
    signEpsilon,
    stepGlitchSegments,
    stepSegmentDeltaYs,
    stepOverflowProtection: options.settings.stepOverflowProtection,
  };
  let formulaPoints = createFormulaPathPoints(options.points, options.settings, formulaEvaluation);
  if (!formulaPathNeedsRangeResolution(options.settings)) {
    return formulaPoints;
  }

  for (let pass = 0; pass < FORMULA_PATH_RANGE_RESOLUTION_PASSES; pass += 1) {
    formulaEvaluation = createTrajectoryFormulaEvaluation(
      options,
      formulaPoints,
      signEpsilon,
      stepGlitchSegments,
      stepSegmentDeltaYs,
    );
    const nextFormulaPoints = createFormulaPathPoints(options.points, options.settings, formulaEvaluation);
    if (sameGraphPoints(formulaPoints, nextFormulaPoints)) {
      return formulaPoints;
    }
    formulaPoints = nextFormulaPoints;
  }
  return formulaPoints;
}

/** 只有 step 导数模式的 exp 抗溢出判断依赖采样范围；其他算法不应额外重跑发射点迭代。 */
function formulaPathNeedsRangeResolution(settings: GraphwarTrajectoryFormulaSettings) {
  return settings.algorithm === "step" && settings.equation !== "y" && settings.stepOverflowProtection;
}

function resolveSignEpsilonRequirement(
  options: {
    bounds: GraphBounds;
    settings: GraphwarTrajectoryFormulaSettings;
    soldierCenter?: GraphPoint;
  },
  state: TrajectoryFormulaState,
) {
  const soldierCenter = options.soldierCenter;
  if (
    !soldierCenter ||
    state.formulaPoints.length < 2 ||
    !formulaUsesStableSignRatio(
      state.formulaPoints,
      options.settings.steepness,
      options.settings.equation,
      options.settings.algorithm,
      state.formulaEvaluation,
      state.compiledMaterials,
    )
  ) {
    return 0;
  }

  return probeSignEpsilonRequirement((onSignArgument) => {
    // 应先确认最终文本里确实存在 sign 子表达式，再按同一份公式材料探测采样点是否踩中折点。
    sampleGraphwarTrajectory({
      algorithm: options.settings.algorithm,
      bounds: options.bounds,
      equation: options.settings.equation,
      compiledFormulaMaterials: state.compiledMaterials,
      formulaEvaluation: {
        ...state.formulaEvaluation,
        onSignArgument,
      },
      points: state.formulaPoints,
      soldierCenter,
      steepness: options.settings.steepness,
    });
  })
    ? GRAPHWAR_TOOL_SIGN_EPSILON
    : 0;
}

/** 用已整理好的公式上下文计算 Graphwar 实际需要的发射角。 */
export function getGraphwarTrajectoryLaunchAngle(
  context: GraphwarTrajectoryFormulaContext,
  soldierCenter = context.soldierCenter,
) {
  return soldierCenter
    ? getGraphwarLaunchAngle(
        {
          algorithm: context.settings.algorithm,
          equation: context.settings.equation,
          compiledFormulaMaterials: context.compiledMaterials,
          formulaEvaluation: context.formulaEvaluation,
          points: context.formulaPoints,
          steepness: context.settings.steepness,
        },
        soldierCenter,
      )
    : Number.NaN;
}

/** 采样由路径点生成的公式轨迹，并统一处理可选的目标、障碍和可见像素收集。 */
export function sampleGraphwarFormulaTrajectory(options: {
  bounds: GraphBounds;
  boundsRect: BoundsRect;
  collision?: GraphwarTrajectoryCollisionSettings;
  collectVisiblePixels?: boolean;
  context: GraphwarTrajectoryFormulaContext;
  initialReachedTargetCount?: number;
  initialState?: GraphwarTrajectorySamplingState;
  /** 完成目标序列后继续采样到该 Graphwar x；用于把清图增量状态推进到目标右侧离开点。 */
  continueAfterTargetSequenceUntilGraphX?: number;
  /** 默认完成目标序列时立刻停；传 false 时继续采样，通常配合 continueAfterTargetSequenceUntilGraphX。 */
  stopOnTargetSequenceComplete?: boolean;
  /** 目标命中圆半径，单位为截图像素；显式 targetSequence 会覆盖该默认半径。 */
  targetHitRadiusPixels?: number;
  skipInitialStop?: boolean;
  targetPoint?: PixelPoint;
  targetSequence?: readonly GraphwarTrajectoryTargetCircle[];
  targetSequencePoints?: readonly PixelPoint[];
}): GraphwarTrajectorySampleResult {
  const stopTracker = createGraphwarTrajectoryStopTracker(options);
  // 必须按最终公式文本重新解析回放：小数位和 Graphwar parser 行为都是验证对象的一部分。
  const sample = sampleGraphwarExpressionTrajectory({
    bounds: options.bounds,
    equation: options.context.settings.equation,
    expression: options.context.playbackExpression,
    initialState: options.initialState,
    launchAngleRadians:
      options.context.settings.equation === "ddy" ? getGraphwarTrajectoryLaunchAngle(options.context) : undefined,
    shouldStop: stopTracker.shouldStop,
    skipInitialStop: options.skipInitialStop,
    soldierCenter: options.context.soldierCenter ?? options.context.formulaPoints[0],
  });
  return stopTracker.createResult(sample);
}

/** 采样用户直接输入的表达式轨迹；表达式本身不参与公式点和精度整理。 */
export function sampleGraphwarExpressionTrajectoryWithStops(options: {
  bounds: GraphBounds;
  boundsRect: BoundsRect;
  collision?: GraphwarTrajectoryCollisionSettings;
  collectVisiblePixels?: boolean;
  equation: EquationMode;
  expression: string;
  launchAngleRadians?: number;
  parser?: GraphwarExpressionParserOptions;
  soldierCenter: GraphPoint;
}): GraphwarTrajectorySampleResult {
  const stopTracker = createGraphwarTrajectoryStopTracker(options);
  const sample = sampleGraphwarExpressionTrajectory({
    bounds: options.bounds,
    equation: options.equation,
    expression: options.expression,
    launchAngleRadians: options.launchAngleRadians,
    parser: options.parser,
    shouldStop: stopTracker.shouldStop,
    soldierCenter: options.soldierCenter,
  });
  return stopTracker.createResult(sample);
}

/** 验证一条像素路径生成的公式轨迹是否在撞障碍前命中目标，并返回可绘制轨迹。 */
export function sampleGraphwarPathTrajectory(options: {
  boundaryExpansion?: number;
  bounds: GraphBounds;
  boundsRect: BoundsRect;
  hitTargetPoint?: PixelPoint;
  obstacleMask?: Uint8Array;
  points: readonly PixelPoint[];
  settings: GraphwarTrajectoryFormulaSettings;
  /** 目标命中圆半径，单位为截图像素。 */
  targetHitRadiusPixels: number;
}): GraphwarPathTrajectoryResult {
  if (!options.hitTargetPoint) {
    return createEmptyPathTrajectoryResult();
  }

  // 调用方只提供页面像素路径；采样 Module 内部统一换算 Graphwar 坐标和公式点。
  const mappedPoints = options.points.map((point) => imageToGraphPoint(point, options.bounds, options.boundsRect));
  const context = createGraphwarTrajectoryFormulaContext({
    bounds: options.bounds,
    points: mappedPoints,
    settings: options.settings,
    soldierCenter: mappedPoints[0],
  });
  if (context.formulaPoints.length < 2) {
    return createEmptyPathTrajectoryResult();
  }

  const result = sampleGraphwarFormulaTrajectory({
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    collision: {
      boundaryExpansion: options.boundaryExpansion,
      mask: options.obstacleMask,
    },
    collectVisiblePixels: true,
    context,
    targetHitRadiusPixels: options.targetHitRadiusPixels,
    targetPoint: options.hitTargetPoint,
  });
  return {
    earlyStopReason: result.earlyStopReason,
    reachesTargetBeforeObstacle: result.targetHitIndex >= 0,
    sample: result.sample,
    samplePointCount: result.sample.points.length,
    visiblePixels: result.visiblePixels,
  };
}

/** 验证轨迹是否按顺序命中一组目标；一键清图用它确认优化后路径没有丢失击杀顺序。 */
export function sampleGraphwarPathTargetSequence(options: {
  boundaryExpansion?: number;
  bounds: GraphBounds;
  boundsRect: BoundsRect;
  collectVisiblePixels?: boolean;
  obstacleMask?: Uint8Array;
  points: readonly PixelPoint[];
  settings: GraphwarTrajectoryFormulaSettings;
  /** 默认目标命中圆半径，单位为截图像素；显式 targetCircles 会覆盖。 */
  targetHitRadiusPixels: number;
  targetCircles?: readonly GraphwarTrajectoryTargetCircle[];
  targetPoints: readonly PixelPoint[];
}): GraphwarPathTargetSequenceResult {
  const targetSequence =
    options.targetCircles ??
    options.targetPoints.map((center) => ({
      center,
      radius: options.targetHitRadiusPixels,
    }));
  if (targetSequence.length === 0) {
    return {
      reachedTargetCount: 0,
      reachesTargetSequenceBeforeObstacle: true,
      sample: createEmptyTrajectorySample(),
      samplePointCount: 0,
      visiblePixels: [],
    };
  }

  // 顺序命中校验也从像素路径开始，避免页面和 worker 各自重复公式采样细节。
  const mappedPoints = options.points.map((point) => imageToGraphPoint(point, options.bounds, options.boundsRect));
  const context = createGraphwarTrajectoryFormulaContext({
    bounds: options.bounds,
    points: mappedPoints,
    settings: options.settings,
    soldierCenter: mappedPoints[0],
  });
  if (context.formulaPoints.length < 2) {
    return {
      reachedTargetCount: 0,
      reachesTargetSequenceBeforeObstacle: false,
      sample: createEmptyTrajectorySample(),
      samplePointCount: 0,
      visiblePixels: [],
    };
  }

  const result = sampleGraphwarFormulaTrajectory({
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    collision: {
      boundaryExpansion: options.boundaryExpansion,
      mask: options.obstacleMask,
    },
    collectVisiblePixels: options.collectVisiblePixels,
    context,
    targetHitRadiusPixels: options.targetHitRadiusPixels,
    targetSequence,
  });
  return {
    earlyStopReason: result.earlyStopReason,
    reachedTargetCount: result.reachedTargetCount,
    reachesTargetSequenceBeforeObstacle: result.reachedTargetCount >= targetSequence.length,
    sample: result.sample,
    samplePointCount: result.sample.points.length,
    visiblePixels: result.visiblePixels,
  };
}

/** 找出预览轨迹首次碰到目标圆的采样点索引，供页面决定提示和截断显示。 */
export function findGraphwarTrajectoryTargetHitIndex(options: {
  bounds: GraphBounds;
  boundsRect: BoundsRect;
  points: readonly GraphPoint[];
  /** 目标命中圆半径，单位为截图像素。 */
  targetHitRadiusPixels: number;
  targetPoint: PixelPoint;
}) {
  if (options.points.length === 0) {
    return -1;
  }
  // 预览目标半径固定，提前平方后用距离平方比较，避免每个采样点 Math.hypot 开方。
  const targetRadiusSquared = options.targetHitRadiusPixels * options.targetHitRadiusPixels;
  for (let index = 1; index < options.points.length; index += 1) {
    const pixel = graphToImagePoint(options.points[index], options.bounds, options.boundsRect);
    const targetDx = pixel.x - options.targetPoint.x;
    const targetDy = pixel.y - options.targetPoint.y;
    if (targetDx * targetDx + targetDy * targetDy < targetRadiusSquared) {
      return index;
    }
  }
  return -1;
}

/** 生成 Graphwar 实际公式点；路径点和发射点保持 double 精度，只有最终表达式文本会按小数位格式化。 */
function createFormulaPathPoints(
  points: readonly GraphPoint[],
  settings: GraphwarTrajectoryFormulaSettings,
  formulaEvaluation: FormulaEvaluationOptions,
) {
  return points.length < 2
    ? [...points]
    : createGraphwarFormulaPathPoints({
        algorithm: settings.algorithm,
        equation: settings.equation,
        formulaEvaluation,
        points,
        steepness: settings.formulaPathSteepness ?? settings.steepness,
      });
}

function sameGraphPoints(left: readonly GraphPoint[], right: readonly GraphPoint[]) {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index].x !== right[index].x || left[index].y !== right[index].y) {
      return false;
    }
  }
  return true;
}

/** 创建 sampleGraphwarTrajectory 的早停回调，并把命中、障碍和可见像素指标集中记录。 */
function createGraphwarTrajectoryStopTracker(options: {
  bounds: GraphBounds;
  boundsRect: BoundsRect;
  collision?: GraphwarTrajectoryCollisionSettings;
  collectVisiblePixels?: boolean;
  initialReachedTargetCount?: number;
  continueAfterTargetSequenceUntilGraphX?: number;
  stopOnTargetSequenceComplete?: boolean;
  /** 默认目标命中圆半径，单位为截图像素；显式 targetSequence 会覆盖。 */
  targetHitRadiusPixels?: number;
  targetPoint?: PixelPoint;
  targetSequence?: readonly GraphwarTrajectoryTargetCircle[];
  targetSequencePoints?: readonly PixelPoint[];
}) {
  const targetSequence =
    options.targetSequence ??
    createTrajectoryTargetSequenceFromPoints(
      options.targetSequencePoints ?? (options.targetPoint ? [options.targetPoint] : []),
      options.targetHitRadiusPixels,
    );
  const boundsRect = options.boundsRect;
  const collisionMask = options.collision?.mask;
  // 采样点循环会高频判障碍；这里预先归一化边界和比例，循环内只做乘法与整数化。
  const collisionBoundaryExpansion = Math.floor(options.collision?.boundaryExpansion ?? 0);
  const collisionPlaneScaleX = GRAPHWAR_PLANE_LENGTH / boundsRect.width;
  const collisionPlaneScaleY = GRAPHWAR_PLANE_HEIGHT / boundsRect.height;
  const visiblePixels: PixelPoint[] = [];
  let earlyStopReason: GraphwarTrajectoryEarlyStopReason | undefined;
  let obstacleHitIndex = -1;
  let targetHitIndex = -1;
  let reachedTargetCount = Math.min(options.initialReachedTargetCount ?? 0, targetSequence.length);

  return {
    shouldStop(point: GraphPoint, _previousPoint: GraphPoint | undefined, index: number) {
      const pixel = graphToImagePoint(point, options.bounds, boundsRect);
      if (options.collectVisiblePixels) {
        visiblePixels.push(pixel);
      }

      // Graphwar 从第 1 个采样点开始判士兵命中，起点不参与命中检测。
      while (index > 0 && reachedTargetCount < targetSequence.length) {
        const target = targetSequence[reachedTargetCount];
        if (!target) {
          break;
        }
        const targetDx = pixel.x - target.center.x;
        const targetDy = pixel.y - target.center.y;
        if (targetDx * targetDx + targetDy * targetDy >= target.radius * target.radius) {
          break;
        }
        reachedTargetCount += 1;
      }
      const targetSequenceReached = targetSequence.length > 0 && reachedTargetCount >= targetSequence.length;
      if (targetSequenceReached && targetHitIndex < 0) {
        targetHitIndex = index;
      }
      if (options.stopOnTargetSequenceComplete !== false && targetSequenceReached) {
        earlyStopReason = "target";
        return true;
      }

      if (collisionMask) {
        const planeX = Math.floor((pixel.x - boundsRect.x) * collisionPlaneScaleX);
        const planeY = Math.floor((pixel.y - boundsRect.y) * collisionPlaneScaleY);
        // 障碍 mask 的边界收缩在像素转平面格点后判断；展开热路径，避免每个采样点创建临时对象。
        if (
          !isInsidePlaneWithBoundaryExpansion(planeX, planeY, collisionBoundaryExpansion) ||
          Boolean(collisionMask[planeY * GRAPHWAR_PLANE_LENGTH + planeX])
        ) {
          obstacleHitIndex = index;
          earlyStopReason = "obstacle";
          return true;
        }
      }
      if (
        targetSequenceReached &&
        options.continueAfterTargetSequenceUntilGraphX !== undefined &&
        point.x >= options.continueAfterTargetSequenceUntilGraphX
      ) {
        return true;
      }
      return false;
    },
    createResult(sample: GraphwarTrajectorySample): GraphwarTrajectorySampleResult {
      return {
        earlyStopReason,
        obstacleHitIndex,
        reachedTargetCount,
        sample,
        targetHitIndex,
        visiblePixels,
      };
    },
  };
}

/** 没有半径时不创建目标序列，避免把未配置的目标误判为 0 半径命中。 */
function createTrajectoryTargetSequenceFromPoints(
  points: readonly PixelPoint[],
  targetHitRadiusPixels: number | undefined,
): GraphwarTrajectoryTargetCircle[] {
  if (targetHitRadiusPixels === undefined) {
    return [];
  }
  return points.map((center) => ({ center, radius: targetHitRadiusPixels }));
}

/** 判断平面点是否在收缩后的可模拟区域内。 */
function isInsidePlaneWithBoundaryExpansion(x: number, y: number, boundaryExpansion: number) {
  return (
    x >= boundaryExpansion &&
    x < GRAPHWAR_PLANE_LENGTH - boundaryExpansion &&
    y >= boundaryExpansion &&
    y < GRAPHWAR_PLANE_HEIGHT - boundaryExpansion
  );
}

/** 创建缺少路径点或目标时的空路径验证结果。 */
function createEmptyPathTrajectoryResult(): GraphwarPathTrajectoryResult {
  return {
    reachesTargetBeforeObstacle: false,
    sample: createEmptyTrajectorySample(),
    samplePointCount: 0,
    visiblePixels: [],
  };
}

/** 创建空采样，stopReason 使用 unsupported 表示没有可运行的 Graphwar 轨迹。 */
function createEmptyTrajectorySample(): GraphwarTrajectorySample {
  return {
    points: [],
    stopReason: "unsupported",
  };
}
