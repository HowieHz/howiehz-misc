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
  /** Step 邪道从左到右求解结果；只可作为精确追加路径的候选前缀。 */
  stepGlitchFormulaPrefix?: GraphwarStepGlitchFormulaPrefix;
}

/** 已求解 Step 邪道前缀；公式 Module 会逐项核对后再决定是否复用。 */
export interface GraphwarStepGlitchFormulaPrefix {
  /** 求解时使用的同一坐标边界。 */
  readonly bounds: GraphBounds;
  /** 未应用邪道修正前的公式点，用来确认追加项没有反向改变历史发射点或中心。 */
  readonly initialFormulaPoints: readonly GraphPoint[];
  /** 调用方传入的原始 Graphwar 路径点。 */
  readonly points: readonly GraphPoint[];
  /** 从左到右求解时修正过的前缀公式点。 */
  readonly refinedFormulaPoints: readonly GraphPoint[];
  /** 求解时使用的同一设置快照；mask 也通过该对象身份绑定。 */
  readonly settings: GraphwarTrajectoryFormulaSettings;
  /** 公式是否启用了 sign 除零保护。 */
  readonly signEpsilon: number;
  /** 求解时用于计算发射边缘的士兵中心。 */
  readonly soldierCenter?: GraphPoint;
  /** 每段初始包络是否需要邪道。 */
  readonly stepGlitchRequirements: readonly boolean[];
  /** 每段已经选定的邪道替换项。 */
  readonly stepGlitchSegments: readonly (StepGlitchSegment | undefined)[];
  /** 邪道后普通段已经解析出的实际高度差。 */
  readonly stepSegmentDeltaYs: readonly (number | undefined)[];
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
  /** 无序必达目标中已经命中的数量。 */
  reachedRequiredTargetCount: number;
  /** 无序必达目标全部完成的采样点索引；-1 表示尚未全部命中。 */
  requiredTargetsHitIndex: number;
  /** Graphwar 规则采样出的游戏坐标轨迹。 */
  sample: GraphwarTrajectorySample;
  /** 完成有序目标序列的采样点索引，-1 表示未完成。 */
  targetHitIndex: number;
  /** 各无序跟踪目标首次命中的采样点索引；-1 表示未命中。 */
  trackedTargetHitIndexes: number[];
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

/** 多目标验证结果：新增目标保持顺序，历史必达目标只要求全部命中。 */
export interface GraphwarPathTargetSequenceResult {
  /** 目标或障碍导致的早停原因。 */
  earlyStopReason?: GraphwarTrajectoryEarlyStopReason;
  /** 已按顺序命中的目标数量。 */
  reachedTargetCount: number;
  /** 无序必达目标中已经命中的数量。 */
  reachedRequiredTargetCount: number;
  /** 首次碰到障碍的采样点索引，-1 表示未碰到。 */
  obstacleHitIndex: number;
  /** True 表示有序目标和无序必达目标都在撞障碍前完成。 */
  reachesTargetSequenceBeforeObstacle: boolean;
  /** 原始 Graphwar 采样结果，供调试和成本统计使用。 */
  sample: GraphwarTrajectorySample;
  /** 实际检查过的采样点数量。 */
  samplePointCount: number;
  /** 完成有序目标序列的采样点索引；-1 表示未完成。 */
  targetHitIndex: number;
  /** 无序必达目标全部完成的采样点索引；-1 表示未完成。 */
  requiredTargetsHitIndex: number;
  /** 各无序跟踪目标首次命中的采样点索引；-1 表示未命中。 */
  trackedTargetHitIndexes: number[];
  /** 截图像素轨迹，页面可直接绘制。 */
  visiblePixels: PixelPoint[];
}

/** 命中后续播模式会在目标 x 主动停止；障碍先停或采样未到 x 都不能作为可继续前缀。 */
export function graphwarTrajectoryReachesGraphXBeforeObstacle(
  result: Pick<GraphwarPathTrajectoryResult, "earlyStopReason" | "sample">,
  graphX: number,
) {
  const lastPoint = result.sample.points.at(-1);
  return (
    result.earlyStopReason !== "obstacle" && Number.isFinite(graphX) && Boolean(lastPoint && lastPoint.x >= graphX)
  );
}

/** 完整回放中，有序和无序必达目标完成后必须仍有非障碍采样点到达指定 x。 */
export function graphwarTrajectoryReachesGraphXAfterTargetsBeforeObstacle(
  result: Pick<
    GraphwarPathTargetSequenceResult,
    "obstacleHitIndex" | "requiredTargetsHitIndex" | "sample" | "targetHitIndex"
  >,
  graphX: number,
) {
  const lastSafeIndex = result.obstacleHitIndex >= 0 ? result.obstacleHitIndex - 1 : result.sample.points.length - 1;
  const lastSafePoint = result.sample.points[lastSafeIndex];
  const targetsHitIndex = Math.max(result.targetHitIndex, result.requiredTargetsHitIndex);
  return (
    Number.isFinite(graphX) &&
    targetsHitIndex >= 0 &&
    targetsHitIndex <= lastSafeIndex &&
    Boolean(lastSafePoint && lastSafePoint.x >= graphX)
  );
}

/** 把路径点和 Graphwar 数值保护规则整理成一次采样可复用的公式上下文。 */
export function createGraphwarTrajectoryFormulaContext(options: {
  bounds: GraphBounds;
  points: readonly GraphPoint[];
  settings: GraphwarTrajectoryFormulaSettings;
  soldierCenter?: GraphPoint;
  stepGlitchFormulaPrefix?: GraphwarStepGlitchFormulaPrefix;
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
    stepGlitchFormulaPrefix: state.stepGlitchFormulaPrefix,
  };
}

interface TrajectoryFormulaState {
  compiledMaterials: CompiledGraphwarFormulaMaterials;
  formulaEvaluation: FormulaEvaluationOptions;
  formulaPoints: GraphPoint[];
  signEpsilon: number;
  stepGlitchFormulaPrefix?: GraphwarStepGlitchFormulaPrefix;
}

interface StepSimulationRefinement {
  formulaPoints: readonly GraphPoint[];
  stepGlitchSegments: readonly (StepGlitchSegment | undefined)[];
  stepSegmentDeltaYs: readonly (number | undefined)[];
}

const GRAPHWAR_STEP_GLITCH_MIN_STEP = createGraphwarStepGlitchMinStep();
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
  prefixInitialState: GraphwarTrajectorySamplingState | undefined;
  prefixFormula: StepGlitchPrefixFormula;
  segmentStartY: number;
  soldierCenter: GraphPoint;
}

interface StepGlitchPrefixFormulaContext {
  baseDeltaYs: readonly (number | undefined)[];
  baseDisabledSegments: readonly boolean[];
  baseSegments: readonly (StepGlitchSegment | undefined)[];
  segmentIndex: number;
  signEpsilon: number;
}

interface StepGlitchPrefixFormula {
  compiledMaterials: CompiledGraphwarFormulaMaterials;
  formulaEvaluation: FormulaEvaluationOptions;
}

/** 先按原始 sign 求解；只有实际采样踩中折点时才用 epsilon 重建一次。 */
function createResolvedTrajectoryFormulaState(options: {
  bounds: GraphBounds;
  points: readonly GraphPoint[];
  settings: GraphwarTrajectoryFormulaSettings;
  soldierCenter?: GraphPoint;
  stepGlitchFormulaPrefix?: GraphwarStepGlitchFormulaPrefix;
}): TrajectoryFormulaState {
  const plainState = createTrajectoryFormulaState(options, 0);
  if (resolveSignEpsilonRequirement(options, plainState) === 0) {
    return plainState;
  }

  // 无保护状态已经踩中 sign 折点时，应保留 epsilon 并用同一 sign 重新生成公式点。
  return createTrajectoryFormulaState(options, GRAPHWAR_TOOL_SIGN_EPSILON);
}

/** 求解一次 Step 邪道段并编译最终公式材料；最终文本回放负责裁决残余尾值误差。 */
function createTrajectoryFormulaState(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
    soldierCenter?: GraphPoint;
    stepGlitchFormulaPrefix?: GraphwarStepGlitchFormulaPrefix;
  },
  signEpsilon: number,
): TrajectoryFormulaState {
  let formulaPoints = createResolvedFormulaPathPoints(options, signEpsilon);
  const stepGlitchRequirements = createStepGlitchRequirements(options, formulaPoints);
  let stepGlitchSegments: readonly (StepGlitchSegment | undefined)[] | undefined;
  let stepSegmentDeltaYs: readonly (number | undefined)[] | undefined;
  let stepGlitchFormulaPrefix: GraphwarStepGlitchFormulaPrefix | undefined;
  if (stepGlitchRequirements) {
    const solved = refineStepSegmentsWithSimulation(
      options,
      formulaPoints,
      stepGlitchRequirements,
      signEpsilon,
      options.stepGlitchFormulaPrefix,
    );
    stepGlitchSegments = solved.stepGlitchSegments;
    stepSegmentDeltaYs = solved.stepSegmentDeltaYs;
    stepGlitchFormulaPrefix = {
      bounds: { ...options.bounds },
      initialFormulaPoints: formulaPoints.map((point) => createGraphPoint(point.x, point.y)),
      points: options.points.map((point) => createGraphPoint(point.x, point.y)),
      refinedFormulaPoints: solved.formulaPoints.map((point) => createGraphPoint(point.x, point.y)),
      settings: { ...options.settings },
      signEpsilon,
      ...(options.soldierCenter
        ? { soldierCenter: createGraphPoint(options.soldierCenter.x, options.soldierCenter.y) }
        : {}),
      stepGlitchRequirements: [...stepGlitchRequirements],
      stepGlitchSegments: [...stepGlitchSegments],
      stepSegmentDeltaYs: [...stepSegmentDeltaYs],
    };

    // 求解后的替换项只回算一次发射边缘和普通段中心；候选整式随后会做权威文本回放。
    formulaPoints = createResolvedFormulaPathPoints(options, signEpsilon, stepGlitchSegments, stepSegmentDeltaYs);
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
    stepGlitchFormulaPrefix,
  };
}

/** 集中绑定最终公式和临时前缀探针共用的 Step 数值选项。 */
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

/** 从左到右按真实落点求解邪道段，并修正邪道后第一个普通 Step 的累计原点。 */
function refineStepSegmentsWithSimulation(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
    soldierCenter?: GraphPoint;
  },
  formulaPoints: readonly GraphPoint[],
  stepGlitchRequirements: readonly boolean[],
  signEpsilon: number,
  prefix: GraphwarStepGlitchFormulaPrefix | undefined,
): StepSimulationRefinement {
  const mask = options.settings.stepGlitchObstacleMask;
  const soldierCenter = options.soldierCenter ?? formulaPoints[0];
  if (!mask || !soldierCenter || options.points.length < 2) {
    return { formulaPoints, stepGlitchSegments: [], stepSegmentDeltaYs: [] };
  }

  let reusableSegmentCount = 0;
  if (
    prefix &&
    prefix.bounds.maxX === options.bounds.maxX &&
    prefix.bounds.maxY === options.bounds.maxY &&
    prefix.bounds.minX === options.bounds.minX &&
    prefix.bounds.minY === options.bounds.minY &&
    prefix.settings.algorithm === options.settings.algorithm &&
    prefix.settings.decimalPlaces === options.settings.decimalPlaces &&
    prefix.settings.equation === options.settings.equation &&
    prefix.settings.formulaPathSteepness === options.settings.formulaPathSteepness &&
    prefix.settings.steepness === options.settings.steepness &&
    prefix.settings.stepGlitchMode === options.settings.stepGlitchMode &&
    prefix.settings.stepGlitchObstacleMask === options.settings.stepGlitchObstacleMask &&
    prefix.settings.stepOverflowProtection === options.settings.stepOverflowProtection &&
    prefix.signEpsilon === signEpsilon &&
    prefix.soldierCenter?.x === options.soldierCenter?.x &&
    prefix.soldierCenter?.y === options.soldierCenter?.y &&
    prefix.points.length <= options.points.length &&
    prefix.initialFormulaPoints.length === prefix.points.length &&
    prefix.refinedFormulaPoints.length === prefix.points.length &&
    prefix.stepGlitchRequirements.length === prefix.points.length - 1 &&
    prefix.stepGlitchSegments.length === prefix.points.length - 1 &&
    prefix.stepSegmentDeltaYs.length === prefix.points.length - 1
  ) {
    reusableSegmentCount = prefix.stepGlitchSegments.length;
    for (let index = 0; index < prefix.points.length; index += 1) {
      const oldPoint = prefix.points[index];
      const point = options.points[index];
      const oldFormulaPoint = prefix.initialFormulaPoints[index];
      const formulaPoint = formulaPoints[index];
      if (
        !oldPoint ||
        !point ||
        oldPoint.x !== point.x ||
        oldPoint.y !== point.y ||
        !oldFormulaPoint ||
        !formulaPoint ||
        oldFormulaPoint.x !== formulaPoint.x ||
        oldFormulaPoint.y !== formulaPoint.y ||
        (index < reusableSegmentCount && prefix.stepGlitchRequirements[index] !== stepGlitchRequirements[index])
      ) {
        reusableSegmentCount = 0;
        break;
      }
    }
  }

  const reusablePrefix = reusableSegmentCount > 0 ? prefix : undefined;
  const refinedSegments: (StepGlitchSegment | undefined)[] = reusablePrefix
    ? [...reusablePrefix.stepGlitchSegments]
    : new Array(stepGlitchRequirements.length);
  const refinedDeltaYs: (number | undefined)[] = reusablePrefix
    ? [...reusablePrefix.stepSegmentDeltaYs]
    : new Array(stepGlitchRequirements.length);
  refinedSegments.length = stepGlitchRequirements.length;
  refinedDeltaYs.length = stepGlitchRequirements.length;
  // 求解只依赖已经接受的左侧前缀；关闭全部未来项后，追加控制点不会迫使历史段重新求解。
  const disabledSegments = stepGlitchRequirements.map(() => true);
  const refinedFormulaPoints = [...formulaPoints];
  if (reusablePrefix) {
    for (let index = 0; index <= reusableSegmentCount; index += 1) {
      refinedFormulaPoints[index] = reusablePrefix.refinedFormulaPoints[index];
    }
    disabledSegments.fill(false, 0, reusableSegmentCount);
  }

  for (let segmentIndex = reusableSegmentCount; segmentIndex < options.points.length - 1; segmentIndex += 1) {
    const previousSegment = segmentIndex > 0 ? refinedSegments[segmentIndex - 1] : undefined;
    // 普通段只有紧跟邪道时才需要按真实落点修正；其余段没有可计算的新状态。
    if (!stepGlitchRequirements[segmentIndex] && !previousSegment) {
      disabledSegments[segmentIndex] = false;
      continue;
    }
    const prefixFormula = createStepGlitchPrefixFormula(options, refinedFormulaPoints, {
      baseDeltaYs: refinedDeltaYs,
      baseDisabledSegments: disabledSegments,
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
    const nextSegment = stepGlitchRequirements[segmentIndex]
      ? selectStepGlitchSegmentCandidate(options, refinedFormulaPoints, {
          baseDeltaYs: refinedDeltaYs,
          baseDisabledSegments: disabledSegments,
          baseSegments: refinedSegments,
          deltaYOverride: nextDeltaYOverride,
          formulaCenterX:
            nextFormulaPoint?.x ?? refinedFormulaPoints[segmentIndex + 1]?.x ?? options.points[segmentIndex + 1].x,
          mask,
          prefixInitialState: startSample.resumeState,
          prefixFormula,
          segmentIndex,
          segmentStartY: startSample.point.y,
          signEpsilon,
          soldierCenter,
        })
      : undefined;
    // 邪道段会把实际 y 带偏；后续普通 step 的 ΔY 和中心点都要从模拟器落点继续累计。
    refinedSegments[segmentIndex] = nextSegment;
    refinedDeltaYs[segmentIndex] = nextDeltaYOverride;
    disabledSegments[segmentIndex] = false;
    if (nextFormulaPoint) {
      refinedFormulaPoints[segmentIndex + 1] = nextFormulaPoint;
    }
  }

  return {
    formulaPoints: refinedFormulaPoints,
    stepGlitchSegments: refinedSegments,
    stepSegmentDeltaYs: refinedDeltaYs,
  };
}

interface StepSegmentStartSample {
  point: GraphPoint;
  resumeState?: GraphwarTrajectorySamplingState;
}

/** 编译不含当前段和未求解邪道段的前缀公式，供段起点与窗口探针共享。 */
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
  const disabledSegments = [...context.baseDisabledSegments];
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

/** 用同一份前缀公式推进到指定 x；已有段起点状态时只采样尚未验证的后缀。 */
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
  initialState?: GraphwarTrajectorySamplingState,
) {
  return sampleGraphwarTrajectory({
    algorithm: options.settings.algorithm,
    bounds: options.bounds,
    equation: options.settings.equation,
    compiledFormulaMaterials: prefixFormula.compiledMaterials,
    formulaEvaluation: prefixFormula.formulaEvaluation,
    initialState,
    points: formulaPoints,
    shouldStop: (point) => point.x >= stopX,
    soldierCenter,
    steepness: options.settings.steepness,
  });
}

/** 取得当前段开始处的真实接受点和可恢复状态，供本段所有窗口探针复用。 */
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
  return actualStartPoint && Number.isFinite(actualStartPoint.y) && sample.endState
    ? { point: actualStartPoint, resumeState: sample.endState }
    : undefined;
}

/** 按窗口从宽到窄测试六档 RK4 贡献量，并返回落点误差最小的单跳候选。 */
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
    const preJumpSample = sampleStepGlitchPreJump(
      options,
      formulaPoints,
      candidateContext,
      windowedJump,
      candidateContext.prefixInitialState,
    );
    if (!preJumpSample) {
      continue;
    }
    const replacementDeltaY = source.targetY - preJumpSample.point.y;
    const gateY = createStepGlitchFormulaGateY(source.targetY, replacementDeltaY, options.settings.decimalPlaces);
    // epsilon 会让关闭的 x 门保留尾值；原始 sign 门严格为零时，六档候选共享门左状态。
    const candidateInitialState = candidateContext.signEpsilon === 0 ? preJumpSample.resumeState : undefined;
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
      if (
        !landingPoint ||
        !Number.isFinite(landingPoint.y) ||
        countStepGlitchJumps(sample.points, candidate) !== 1 ||
        stepGlitchSampleHitsObstacle(sample.points, options.bounds, candidateContext.mask)
      ) {
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
      baseDisabledSegments: context.baseDisabledSegments,
      baseSegments: context.baseSegments,
      segmentIndex: context.segmentIndex,
      signEpsilon: context.signEpsilon,
    }),
  };
}

/** 编译当前邪道替换项，并从可复用门左状态推进到右门。 */
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
  const candidateDisabledSegments = [...context.baseDisabledSegments];
  candidateSegments[context.segmentIndex] = candidate;
  candidateDeltaYs[context.segmentIndex] = context.deltaYOverride;
  candidateDisabledSegments[context.segmentIndex] = false;
  const formulaEvaluation = createTrajectoryFormulaEvaluation(
    options,
    formulaPoints,
    context.signEpsilon,
    candidateSegments,
    candidateDeltaYs,
    candidateDisabledSegments,
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

/** 从段起点继续到窗口左门，并保留门左最后一个真实采样状态。 */
function sampleStepGlitchPreJump(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
  },
  formulaPoints: readonly GraphPoint[],
  context: StepGlitchCandidateContext,
  jump: StepGlitchJump,
  initialState: GraphwarTrajectorySamplingState | undefined,
): StepGlitchPreJumpSample | undefined {
  const sample = sampleStepGlitchPrefix(
    options,
    formulaPoints,
    context.prefixFormula,
    context.soldierCenter,
    jump.startX,
    initialState,
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
      previousPoint: previousIndex > 0 ? sample.points[previousIndex - 1] : initialState?.previousPoint,
      sampleIndex: (initialState?.sampleIndex ?? 0) + previousIndex,
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

/** Graphwar 缩步只会尝试 STEP_SIZE/2^n；邪道项的 D 需要按最后一个实际档位估算。 */
function createGraphwarStepGlitchMinStep() {
  let step = GRAPHWAR_STEP_SIZE;
  while (step > GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE) {
    step /= 2;
  }
  return step;
}

/** 只标记初始包络命中障碍的段；正式窗口和导数等真实跳前高度可用后再求。 */
function createStepGlitchRequirements(
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

  const requirements: boolean[] = [];
  let hasRequiredSegment = false;
  for (let index = 1; index < options.points.length; index += 1) {
    const previous = options.points[index - 1];
    const target = options.points[index];
    const formulaCenterX = formulaPoints[index]?.x ?? target.x;
    const required = stepGlitchObstacleEnvelopeHitsObstacle(previous, target, formulaCenterX, options.bounds, mask);
    requirements.push(required);
    hasRequiredSegment ||= required;
  }
  return hasRequiredSegment ? requirements : undefined;
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

/** 候选窗口只允许跳跃线段穿障碍；每个真实接受点仍必须落在空白 cell。 */
function stepGlitchSampleHitsObstacle(points: readonly GraphPoint[], bounds: GraphBounds, mask: Uint8Array) {
  for (const point of points) {
    const planeX = graphXToPlaneX(point.x, bounds);
    const planeY = graphYToPlaneY(point.y, bounds);
    if (
      planeX < 0 ||
      planeX >= GRAPHWAR_PLANE_LENGTH ||
      planeY < 0 ||
      planeY >= GRAPHWAR_PLANE_HEIGHT ||
      mask[planeY * GRAPHWAR_PLANE_LENGTH + planeX]
    ) {
      return true;
    }
  }
  return false;
}

/** 用士兵中心到 x+ 边界的一次保守区间决定抗溢出写法，避免发射边缘与公式互相迭代。 */
function createResolvedFormulaPathPoints(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
    soldierCenter?: GraphPoint;
  },
  signEpsilon: number,
  stepGlitchSegments?: readonly (StepGlitchSegment | undefined)[],
  stepSegmentDeltaYs?: readonly (number | undefined)[],
) {
  const rangeStart = options.soldierCenter ?? options.points[0];
  return createFormulaPathPoints(
    options.points,
    options.settings,
    createTrajectoryFormulaEvaluation(
      options,
      rangeStart ? [rangeStart] : [],
      signEpsilon,
      stepGlitchSegments,
      stepSegmentDeltaYs,
    ),
  );
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
  /** 完成有序目标和无序必达目标后继续采样到该 Graphwar x。 */
  continueAfterTargetsUntilGraphX?: number;
  /** 默认完成全部验证目标时立刻停；传 false 时继续采样，通常配合 continueAfterTargetsUntilGraphX。 */
  stopOnTargetsComplete?: boolean;
  /** 目标命中圆半径，单位为截图像素；显式 targetSequence 会覆盖该默认半径。 */
  targetHitRadiusPixels?: number;
  skipInitialStop?: boolean;
  /** 不要求命中顺序，但全部命中后才能视为验证完成的目标圆。 */
  requiredTargets?: readonly GraphwarTrajectoryTargetCircle[];
  targetPoint?: PixelPoint;
  targetSequence?: readonly GraphwarTrajectoryTargetCircle[];
  targetSequencePoints?: readonly PixelPoint[];
  /** 只记录首次命中位置、不影响停止条件的无序目标圆。 */
  trackedTargets?: readonly GraphwarTrajectoryTargetCircle[];
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
  /** 命中后继续回放到该 Graphwar x；用于确认目标控制点确实可达。 */
  continueAfterTargetUntilGraphX?: number;
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
    ...(options.continueAfterTargetUntilGraphX === undefined
      ? {}
      : {
          continueAfterTargetsUntilGraphX: options.continueAfterTargetUntilGraphX,
          stopOnTargetsComplete: false,
        }),
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

/** 验证有序目标和无序必达目标；一键清图用它确认优化后没有丢失任何击杀。 */
export function sampleGraphwarPathTargetSequence(options: {
  boundaryExpansion?: number;
  bounds: GraphBounds;
  boundsRect: BoundsRect;
  collectVisiblePixels?: boolean;
  /** 完成有序目标和无序必达目标后继续回放到该 Graphwar x。 */
  continueAfterTargetsUntilGraphX?: number;
  obstacleMask?: Uint8Array;
  points: readonly PixelPoint[];
  /** 不要求命中顺序，但全部命中后才能视为验证完成的目标圆。 */
  requiredTargets?: readonly GraphwarTrajectoryTargetCircle[];
  settings: GraphwarTrajectoryFormulaSettings;
  /** 默认目标命中圆半径，单位为截图像素；显式 targetCircles 会覆盖。 */
  targetHitRadiusPixels: number;
  targetCircles?: readonly GraphwarTrajectoryTargetCircle[];
  targetPoints: readonly PixelPoint[];
  /** False 时目标序列完成后继续自然采样，直到障碍、边界或模拟器自身停止。 */
  stopOnTargetsComplete?: boolean;
  /** 只记录首次命中位置、不参与顺序和停止条件的目标圆。 */
  trackedTargets?: readonly GraphwarTrajectoryTargetCircle[];
}): GraphwarPathTargetSequenceResult {
  const targetSequence =
    options.targetCircles ??
    options.targetPoints.map((center) => ({
      center,
      radius: options.targetHitRadiusPixels,
    }));
  const trackedTargets = options.trackedTargets ?? [];
  const requiredTargets = options.requiredTargets ?? [];
  if (targetSequence.length === 0 && requiredTargets.length === 0 && trackedTargets.length === 0) {
    return {
      obstacleHitIndex: -1,
      reachedRequiredTargetCount: 0,
      reachedTargetCount: 0,
      reachesTargetSequenceBeforeObstacle: true,
      requiredTargetsHitIndex: -1,
      sample: createEmptyTrajectorySample(),
      samplePointCount: 0,
      targetHitIndex: -1,
      trackedTargetHitIndexes: [],
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
      obstacleHitIndex: -1,
      reachedRequiredTargetCount: 0,
      reachedTargetCount: 0,
      reachesTargetSequenceBeforeObstacle: false,
      requiredTargetsHitIndex: -1,
      sample: createEmptyTrajectorySample(),
      samplePointCount: 0,
      targetHitIndex: -1,
      trackedTargetHitIndexes: trackedTargets.map(() => -1),
      visiblePixels: [],
    };
  }

  const stopOnTargetsComplete =
    options.continueAfterTargetsUntilGraphX === undefined ? options.stopOnTargetsComplete : false;
  const result = sampleGraphwarFormulaTrajectory({
    bounds: options.bounds,
    boundsRect: options.boundsRect,
    collision: {
      boundaryExpansion: options.boundaryExpansion,
      mask: options.obstacleMask,
    },
    collectVisiblePixels: options.collectVisiblePixels,
    ...(options.continueAfterTargetsUntilGraphX === undefined
      ? {}
      : { continueAfterTargetsUntilGraphX: options.continueAfterTargetsUntilGraphX }),
    context,
    requiredTargets,
    ...(stopOnTargetsComplete === undefined ? {} : { stopOnTargetsComplete }),
    targetHitRadiusPixels: options.targetHitRadiusPixels,
    targetSequence,
    trackedTargets,
  });
  return {
    earlyStopReason: result.earlyStopReason,
    obstacleHitIndex: result.obstacleHitIndex,
    reachedRequiredTargetCount: result.reachedRequiredTargetCount,
    reachedTargetCount: result.reachedTargetCount,
    reachesTargetSequenceBeforeObstacle:
      result.reachedTargetCount >= targetSequence.length && result.reachedRequiredTargetCount >= requiredTargets.length,
    requiredTargetsHitIndex: result.requiredTargetsHitIndex,
    sample: result.sample,
    samplePointCount: result.sample.points.length,
    targetHitIndex: result.targetHitIndex,
    trackedTargetHitIndexes: result.trackedTargetHitIndexes,
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

/** 创建 sampleGraphwarTrajectory 的早停回调，并把命中、障碍和可见像素指标集中记录。 */
function createGraphwarTrajectoryStopTracker(options: {
  bounds: GraphBounds;
  boundsRect: BoundsRect;
  collision?: GraphwarTrajectoryCollisionSettings;
  collectVisiblePixels?: boolean;
  initialReachedTargetCount?: number;
  continueAfterTargetsUntilGraphX?: number;
  stopOnTargetsComplete?: boolean;
  /** 默认目标命中圆半径，单位为截图像素；显式 targetSequence 会覆盖。 */
  targetHitRadiusPixels?: number;
  targetPoint?: PixelPoint;
  requiredTargets?: readonly GraphwarTrajectoryTargetCircle[];
  targetSequence?: readonly GraphwarTrajectoryTargetCircle[];
  targetSequencePoints?: readonly PixelPoint[];
  trackedTargets?: readonly GraphwarTrajectoryTargetCircle[];
}) {
  const targetSequence =
    options.targetSequence ??
    createTrajectoryTargetSequenceFromPoints(
      options.targetSequencePoints ?? (options.targetPoint ? [options.targetPoint] : []),
      options.targetHitRadiusPixels,
    );
  const boundsRect = options.boundsRect;
  const collisionMask = options.collision?.mask;
  const targetRadiusSquares = targetSequence.map((target) => target.radius * target.radius);
  const requiredTargets = options.requiredTargets ?? [];
  const requiredTargetHits = new Uint8Array(requiredTargets.length);
  const requiredTargetRadiusSquares = requiredTargets.map((target) => target.radius * target.radius);
  const trackedTargets = options.trackedTargets ?? [];
  const trackedTargetHitIndexes = trackedTargets.map(() => -1);
  const trackedTargetRadiusSquares = trackedTargets.map((target) => target.radius * target.radius);
  // 采样点循环会高频判障碍；这里预先归一化边界和比例，循环内只做乘法与整数化。
  const collisionBoundaryExpansion = Math.floor(options.collision?.boundaryExpansion ?? 0);
  const collisionPlaneScaleX = GRAPHWAR_PLANE_LENGTH / boundsRect.width;
  const collisionPlaneScaleY = GRAPHWAR_PLANE_HEIGHT / boundsRect.height;
  const visiblePixels: PixelPoint[] = [];
  let earlyStopReason: GraphwarTrajectoryEarlyStopReason | undefined;
  let obstacleHitIndex = -1;
  let reachedRequiredTargetCount = 0;
  let targetHitIndex = -1;
  let requiredTargetsHitIndex = -1;
  let reachedTargetCount = Math.min(options.initialReachedTargetCount ?? 0, targetSequence.length);

  return {
    shouldStop(point: GraphPoint, _previousPoint: GraphPoint | undefined, index: number) {
      const pixel = graphToImagePoint(point, options.bounds, boundsRect);
      if (options.collectVisiblePixels) {
        visiblePixels.push(pixel);
      }

      // Graphwar 从第 1 个采样点开始判士兵命中；先收齐同点的无序命中，再进入停止判定。
      if (index > 0) {
        for (let targetIndex = 0; targetIndex < requiredTargets.length; targetIndex += 1) {
          if (requiredTargetHits[targetIndex]) {
            continue;
          }
          const target = requiredTargets[targetIndex];
          if (!target) {
            continue;
          }
          const targetDx = pixel.x - target.center.x;
          const targetDy = pixel.y - target.center.y;
          if (targetDx * targetDx + targetDy * targetDy >= requiredTargetRadiusSquares[targetIndex]) {
            continue;
          }
          requiredTargetHits[targetIndex] = 1;
          reachedRequiredTargetCount += 1;
        }

        for (let targetIndex = 0; targetIndex < trackedTargets.length; targetIndex += 1) {
          if (trackedTargetHitIndexes[targetIndex] !== -1) {
            continue;
          }
          const target = trackedTargets[targetIndex];
          if (!target) {
            continue;
          }
          const targetDx = pixel.x - target.center.x;
          const targetDy = pixel.y - target.center.y;
          if (targetDx * targetDx + targetDy * targetDy >= trackedTargetRadiusSquares[targetIndex]) {
            continue;
          }
          trackedTargetHitIndexes[targetIndex] = index;
        }

        while (reachedTargetCount < targetSequence.length) {
          const target = targetSequence[reachedTargetCount];
          if (!target) {
            break;
          }
          const targetDx = pixel.x - target.center.x;
          const targetDy = pixel.y - target.center.y;
          if (targetDx * targetDx + targetDy * targetDy >= targetRadiusSquares[reachedTargetCount]) {
            break;
          }
          reachedTargetCount += 1;
        }
      }
      const targetSequenceReached = targetSequence.length > 0 && reachedTargetCount >= targetSequence.length;
      const requiredTargetsReached = reachedRequiredTargetCount >= requiredTargets.length;
      const allTargetsReached = reachedTargetCount >= targetSequence.length && requiredTargetsReached;
      if (targetSequenceReached && targetHitIndex < 0) {
        targetHitIndex = index;
      }
      if (requiredTargets.length > 0 && requiredTargetsReached && requiredTargetsHitIndex < 0) {
        requiredTargetsHitIndex = index;
      }
      if (
        options.stopOnTargetsComplete !== false &&
        (targetSequence.length > 0 || requiredTargets.length > 0) &&
        allTargetsReached
      ) {
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
        allTargetsReached &&
        options.continueAfterTargetsUntilGraphX !== undefined &&
        point.x >= options.continueAfterTargetsUntilGraphX
      ) {
        return true;
      }
      return false;
    },
    createResult(sample: GraphwarTrajectorySample): GraphwarTrajectorySampleResult {
      return {
        earlyStopReason,
        obstacleHitIndex,
        reachedRequiredTargetCount,
        reachedTargetCount,
        requiredTargetsHitIndex,
        sample,
        targetHitIndex,
        trackedTargetHitIndexes,
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
