import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { graphToImagePoint, imageToGraphPoint } from "../../core/geometry";
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
  createStepOverflowProtectionRange,
  probeSignEpsilonRequirement,
} from "../generation/step-numeric-strategy";
import type { FormulaEvaluationOptions } from "../generation/step-numeric-strategy";
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
  },
  signEpsilon: number,
): TrajectoryFormulaState {
  const formulaPoints = createResolvedFormulaPathPoints(options, signEpsilon);
  const formulaEvaluation = createTrajectoryFormulaEvaluation(options, formulaPoints, signEpsilon);
  return {
    compiledMaterials: compileGraphwarFormulaMaterials(
      formulaPoints,
      options.settings.steepness,
      options.settings.algorithm,
      formulaEvaluation,
    ),
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
): FormulaEvaluationOptions {
  return {
    formulaDecimalPlaces: options.settings.decimalPlaces,
    signEpsilon,
    stepOverflowProtection: options.settings.stepOverflowProtection,
    stepOverflowProtectionRange: createStepOverflowProtectionRange(options.bounds, formulaPoints),
  };
}

const FORMULA_PATH_RANGE_RESOLUTION_PASSES = 3;

function createResolvedFormulaPathPoints(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
  },
  signEpsilon: number,
) {
  let formulaEvaluation: FormulaEvaluationOptions = {
    formulaDecimalPlaces: options.settings.decimalPlaces,
    signEpsilon,
    stepOverflowProtection: options.settings.stepOverflowProtection,
  };
  let formulaPoints = createFormulaPathPoints(options.points, options.settings, formulaEvaluation);
  if (!formulaPathNeedsRangeResolution(options.settings)) {
    return formulaPoints;
  }

  for (let pass = 0; pass < FORMULA_PATH_RANGE_RESOLUTION_PASSES; pass += 1) {
    formulaEvaluation = createTrajectoryFormulaEvaluation(options, formulaPoints, signEpsilon);
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
