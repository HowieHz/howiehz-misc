import {
  GRAPHWAR_FUNC_MAX_STEP_DISTANCE_SQUARED,
  GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE,
  GRAPHWAR_GAME_SOLDIER_RADIUS,
  GRAPHWAR_PLANE_HEIGHT,
  GRAPHWAR_PLANE_LENGTH,
  GRAPHWAR_STEP_SIZE,
} from "../../core/game/constants";
import {
  graphToImagePoint,
  graphXToPlaneX,
  graphYToPlaneY,
  imageToGraphPoint,
  planePixelsToGraphUnits,
} from "../../core/geometry";
import { MAX_FORMULA_DECIMAL_PLACES, floorToDecimalPlaces } from "../../core/numbers";
import { planePointIsInsideBoundaryExpansion } from "../../core/plane-grid";
import { graphwarToolDefaults } from "../../core/tool/defaults";
import { createGraphPoint } from "../../core/types";
import type {
  AlgorithmMode,
  BoundsRect,
  EquationMode,
  FormulaResult,
  GraphBounds,
  GraphPoint,
  GraphwarSecondOrderLaunchAngleMode,
  PixelPoint,
} from "../../core/types";
/** 负责按 Graphwar 公式规则采样轨迹，并判断路径与目标/障碍的交互。 */
import { buildFormula, compileGraphwarFormulaMaterials } from "../generation/build";
import type { CompiledGraphwarFormulaMaterials, GraphwarSignProtection } from "../generation/build";
import { formulaModeUsesPositionCompensation, formulaModeUsesStepGlitch } from "../generation/capabilities";
import { graphwarSignProtectionEquals } from "../generation/sign-protection";
import type { GraphwarSignRole } from "../generation/sign-protection";
import {
  calculateStepFormulaCenterX,
  createStepOverflowProtectionRange,
  getStepGlitchFormulaDecimalPlaces,
  quantizeFormulaCoefficient,
  quantizeFormulaOffsetCenter,
  quantizeStepFormulaCenterX,
  quantizeStepFormulaSteepness,
  resolveStepFormulaTransition,
} from "../generation/step-numeric-strategy";
import type { FormulaEvaluationOptions, StepGlitchSegment } from "../generation/step-numeric-strategy";
import {
  createGraphwarFormulaPathPoints,
  GraphwarFormulaConvergenceError,
  getGraphwarLaunchAngle,
  isGraphwarFormulaConvergenceError,
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
  /** 普通公式参数的小数位偏好；Step 邪道为保持门和跳转有效可提升到最低必要精度。 */
  decimalPlaces: number;
  /** Graphwar 对公式文本的解释模式。 */
  equation: EquationMode;
  /** Y''= 最终回放消费完整 double 建议角，还是调用方指定的两位小数执行角；省略时使用完整角度。 */
  secondOrderLaunchAngleMode?: GraphwarSecondOrderLaunchAngleMode;
  /** 路径生成公式时的 steepness；省略时使用 steepness。 */
  formulaPathSteepness?: number;
  /** Step 或 ABS y'' 公式的陡峭度。 */
  steepness: number;
  /** 是否允许 ODE 的 Step 在普通段无法安全连接时把当前段替换为硬 Step 邪道项。 */
  stepGlitchMode: boolean;
  /** 邪道扫描和候选碰撞验证共用的 Graphwar 原始平面 mask；无障碍数据时可以省略。 */
  stepGlitchObstacleMask?: Uint8Array;
  /** 是否允许 step 公式启用 exp 抗溢出保护。 */
  stepOverflowProtection: boolean;
}

/** 一次轨迹采样可复用的公式上下文，避免多个验证入口重复整理路径点、输出文本和保护参数。 */
export interface GraphwarTrajectoryFormulaContext {
  /** 最终文本等价的公式材料；文本生成、sign 探测和内部采样应复用同一份结构。 */
  compiledMaterials: CompiledGraphwarFormulaMaterials;
  /** 最终公式生成结果；expression 用于页面展示、复制和实际发射。 */
  formulaResult: FormulaResult;
  /** 传给公式 evaluator 的数值保护选项。 */
  formulaEvaluation: FormulaEvaluationOptions;
  /** 已按发射点和 step 中心调整过的 Graphwar 路径点，保留 double 精度。 */
  formulaPoints: GraphPoint[];
  /** Y''= 当前执行模型真正消费的发射角；其他方程省略。 */
  launchAngleRadians?: number;
  /** 原始公式采样设置，随上下文一起传递以保证求值模式一致。 */
  settings: GraphwarTrajectoryFormulaSettings;
  /** 按原始路径段保存的局部 sign 保护快照。 */
  signProtection: GraphwarSignProtection;
  /** 可选士兵中心；存在时可直接计算 Graphwar 发射角。 */
  soldierCenter?: GraphPoint;
  /** 邪道从左到右求解结果；只可作为精确追加路径的候选前缀。 */
  stepGlitchFormulaPrefix?: GraphwarStepGlitchFormulaPrefix;
}

/** 已求解邪道前缀；公式 Module 会逐项核对后再决定是否复用。 */
export interface GraphwarStepGlitchFormulaPrefix {
  /** 求解时使用的同一坐标边界。 */
  readonly bounds: GraphBounds;
  /** 未应用邪道修正前的公式点，用来确认追加项没有反向改变历史发射点或中心。 */
  readonly initialFormulaPoints: readonly GraphPoint[];
  /** 调用方传入的原始 Graphwar 路径点。 */
  readonly points: readonly GraphPoint[];
  /** 从左到右求解时修正过的前缀公式点。 */
  readonly refinedFormulaPoints: readonly GraphPoint[];
  /** 已确认段在下一控制 x 后的首个真实 RK4 接受点；首段保持 undefined 并重新解析枪口。 */
  readonly segmentStartPoints: readonly (GraphPoint | undefined)[];
  /** Y''= hard Step 验证和后续前缀回放共同消费的有效发射角。 */
  readonly launchAngleRadians?: number;
  /** 求解时使用的同一设置快照；mask 也通过该对象身份绑定。 */
  readonly settings: GraphwarTrajectoryFormulaSettings;
  /** 求解该前缀时使用的局部 sign 保护快照。 */
  readonly signProtection: GraphwarSignProtection;
  /** 求解时用于计算发射边缘的士兵中心。 */
  readonly soldierCenter?: GraphPoint;
  /** 每段是否因固定窗口、真实障碍或 soft Step 回放失败而需要 hard Step。 */
  readonly stepGlitchRequirements: readonly boolean[];
  /** 每段已经选定的邪道替换项。 */
  readonly stepGlitchSegments: readonly (StepGlitchSegment | undefined)[];
  /** 邪道后普通段已经解析出的实际高度差。 */
  readonly stepSegmentDeltaYs: readonly (number | undefined)[];
}

/** 扫描器已经选定的邪道 x 窗口；存在时公式求解只验证这一档，不再自行重选宽度。 */
export interface GraphwarStepGlitchXWindow {
  readonly endX: number;
  readonly startX: number;
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
  /** 普通质量点的最大纵向误差，单位为 Graphwar 原始平面像素；没有质量点时省略。 */
  pathError?: number;
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
  /** 普通质量点的最大纵向误差，单位为 Graphwar 原始平面像素；没有质量点时省略。 */
  pathError?: number;
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
  /** 普通质量点的最大纵向误差，单位为 Graphwar 原始平面像素；没有质量点时省略。 */
  pathError?: number;
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
  /** 与本次验证轨迹严格对应的最终公式；空目标或无效路径没有公式上下文。 */
  formulaContext?: GraphwarTrajectoryFormulaContext;
}

/** 标记统一求解入口中真正的轨迹采样异常；未标记异常仍属于公式构建阶段。 */
export class GraphwarTrajectoryResolutionError extends Error {
  readonly stage = "trajectory";

  constructor(error: unknown) {
    super(error instanceof Error ? error.message : String(error));
    this.name = "GraphwarTrajectoryResolutionError";
  }
}

/** 标记 soft 与 hard Step 都无法连接某段；候选搜索可淘汰该路径，主轨迹则保留“模拟失败”阶段。 */
class GraphwarStepSegmentConnectionError extends GraphwarTrajectoryResolutionError {
  constructor(segmentIndex: number) {
    super(`Step segment ${segmentIndex} could not be connected by either soft or hard replay.`);
    this.name = "GraphwarStepSegmentConnectionError";
  }
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

/**
 * 比较自动候选的最后一级路径质量。
 *
 * 没有质量点时不参与 tie-break；有限误差优于 Infinity，双方 Infinity 时返回 0 以保持稳定顺序。
 */
export function compareGraphwarPathErrors(left: number | undefined, right: number | undefined) {
  if (left === undefined || right === undefined) {
    return 0;
  }
  const leftIsFinite = Number.isFinite(left);
  const rightIsFinite = Number.isFinite(right);
  if (leftIsFinite && rightIsFinite) {
    return left - right;
  }
  if (leftIsFinite) {
    return -1;
  }
  return rightIsFinite ? 1 : 0;
}

/**
 * 按最终回放中第一个 x >= target.x 的原版接受点测量纵向路径误差。
 *
 * Graphwar 始终沿坐标 x+ 采样，截图镜像不改变这里的比较方向。未走到控制线返回 Infinity，避免用 轨迹末点掩盖缺失状态；空质量点集合返回 undefined。
 */
export function measureGraphwarFormulaPathError(
  samplePoints: readonly GraphPoint[],
  qualityPoints: readonly GraphPoint[],
  bounds: GraphBounds,
) {
  if (qualityPoints.length === 0) {
    return undefined;
  }
  const ySpan = Math.abs(bounds.maxY - bounds.minY);
  if (!(ySpan > 0) || !Number.isFinite(ySpan)) {
    return Number.POSITIVE_INFINITY;
  }

  let pathError = 0;
  let sampleIndex = 0;
  for (const target of qualityPoints) {
    while (sampleIndex < samplePoints.length && samplePoints[sampleIndex].x < target.x) {
      sampleIndex += 1;
    }
    const acceptedPoint = samplePoints[sampleIndex];
    if (!acceptedPoint) {
      return Number.POSITIVE_INFINITY;
    }
    const pointError = (Math.abs(acceptedPoint.y - target.y) * GRAPHWAR_PLANE_HEIGHT) / ySpan;
    if (!Number.isFinite(pointError)) {
      return Number.POSITIVE_INFINITY;
    }
    pathError = Math.max(pathError, pointError);
  }
  return pathError;
}

/**
 * 一次完成生成公式求解、局部 sign 探测和带早停的轨迹验证。
 *
 * 保护集合变化会使分母 epsilon 在旧门前产生尾值，因此每次重试都从发射点开始，并创建全新的命中统计器。
 */
export function resolveGraphwarTrajectory(options: {
  bounds: GraphBounds;
  boundsRect: BoundsRect;
  collision?: GraphwarTrajectoryCollisionSettings;
  collectVisiblePixels?: boolean;
  continueAfterTargetsUntilGraphX?: number;
  /** 从 initialState 续播时已经命中的无序目标前缀；整路重跑时会自动清零。 */
  initialReachedRequiredTargetCount?: number;
  initialReachedTargetCount?: number;
  initialState?: GraphwarTrajectorySamplingState;
  points: readonly GraphPoint[];
  /** 不受真实命中圆约束的普通控制点；只用于非阻塞路径质量统计。 */
  qualityPoints?: readonly GraphPoint[];
  requiredTargets?: readonly GraphwarTrajectoryTargetCircle[];
  settings: GraphwarTrajectoryFormulaSettings;
  /** 与 initialState 成对保存的保护快照；公式配置或路径身份不匹配时调用方不得传入。 */
  signProtection?: GraphwarSignProtection;
  skipInitialStop?: boolean;
  soldierCenter?: GraphPoint;
  stepGlitchFormulaPrefix?: GraphwarStepGlitchFormulaPrefix;
  stepGlitchXWindows?: readonly (GraphwarStepGlitchXWindow | undefined)[];
  stopOnTargetsComplete?: boolean;
  targetHitRadiusPixels?: number;
  targetPoint?: PixelPoint;
  targetSequence?: readonly GraphwarTrajectoryTargetCircle[];
  targetSequencePoints?: readonly PixelPoint[];
  trackedTargets?: readonly GraphwarTrajectoryTargetCircle[];
}): { context: GraphwarTrajectoryFormulaContext; result: GraphwarTrajectorySampleResult } {
  const prefix = options.stepGlitchFormulaPrefix;
  let signProtection = [
    ...(options.signProtection ??
      (prefix && stepGlitchPrefixMatchesSource(options, prefix) ? prefix.signProtection : [])),
  ];
  let initialState = options.initialState;
  while (true) {
    const stateResult = createTrajectoryFormulaState(options, signProtection);
    if (stateResult.status === "protection-changed") {
      signProtection = [...stateResult.signProtection];
      initialState = undefined;
      continue;
    }

    const state = stateResult.state;
    const nextSignProtection = [...signProtection];
    let changed = false;
    const stopTracker = createGraphwarTrajectoryStopTracker({
      ...options,
      initialReachedRequiredTargetCount: initialState ? options.initialReachedRequiredTargetCount : 0,
      initialReachedTargetCount: initialState ? options.initialReachedTargetCount : 0,
    });
    let sample: GraphwarTrajectorySample;
    try {
      sample = sampleGraphwarTrajectory({
        algorithm: options.settings.algorithm,
        bounds: options.bounds,
        equation: options.settings.equation,
        compiledFormulaMaterials: state.compiledMaterials,
        formulaEvaluation: {
          ...state.formulaEvaluation,
          onZeroSignArgument(segmentIndex, role) {
            changed = addGraphwarSignProtection(nextSignProtection, segmentIndex, role) || changed;
          },
        },
        initialState,
        ...(state.launchAngleRadians === undefined ? {} : { launchAngleRadians: state.launchAngleRadians }),
        points: state.formulaPoints,
        secondOrderLaunchAngleMode: options.settings.secondOrderLaunchAngleMode,
        shouldStop: stopTracker.shouldStop,
        skipInitialStop: initialState ? options.skipInitialStop : false,
        soldierCenter: options.soldierCenter ?? state.formulaPoints[0],
        steepness: options.settings.steepness,
      });
    } catch (error) {
      if (isGraphwarFormulaConvergenceError(error)) {
        throw error;
      }
      throw new GraphwarTrajectoryResolutionError(error);
    }
    if (changed) {
      // 当前成功前缀属于旧保护集合；只重置坐标而保留命中计数会制造不存在的验证证据。
      signProtection = nextSignProtection;
      initialState = undefined;
      continue;
    }

    const context = finalizeGraphwarTrajectoryFormulaContext(options, state);
    return { context, result: stopTracker.createResult(sample) };
  }
}

/** 候选搜索只淘汰明确的公式收敛或 Step 连接失败；实现异常必须继续暴露。 */
export function tryResolveGraphwarTrajectoryCandidate(
  options: Parameters<typeof resolveGraphwarTrajectory>[0],
): ReturnType<typeof resolveGraphwarTrajectory> | undefined {
  try {
    return resolveGraphwarTrajectory(options);
  } catch (error) {
    if (isGraphwarFormulaConvergenceError(error) || error instanceof GraphwarStepSegmentConnectionError) {
      return undefined;
    }
    throw error;
  }
}

/** 保护位会改变整条公式的 double 轨迹，只能从相同边界、设置、士兵和原始路径前缀继承。更昂贵的公式点与邪道段核对仍留给实际前缀复用分支。 */
function stepGlitchPrefixMatchesSource(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
    soldierCenter?: GraphPoint;
  },
  prefix: GraphwarStepGlitchFormulaPrefix | undefined,
) {
  if (
    !formulaModeUsesStepGlitch(
      options.settings.algorithm,
      options.settings.equation,
      options.settings.stepGlitchMode,
    ) ||
    !prefix ||
    prefix.bounds.maxX !== options.bounds.maxX ||
    prefix.bounds.maxY !== options.bounds.maxY ||
    prefix.bounds.minX !== options.bounds.minX ||
    prefix.bounds.minY !== options.bounds.minY ||
    prefix.settings.algorithm !== options.settings.algorithm ||
    prefix.settings.decimalPlaces !== options.settings.decimalPlaces ||
    prefix.settings.equation !== options.settings.equation ||
    prefix.settings.secondOrderLaunchAngleMode !== options.settings.secondOrderLaunchAngleMode ||
    prefix.settings.formulaPathSteepness !== options.settings.formulaPathSteepness ||
    prefix.settings.steepness !== options.settings.steepness ||
    prefix.settings.stepGlitchMode !== options.settings.stepGlitchMode ||
    prefix.settings.stepGlitchObstacleMask !== options.settings.stepGlitchObstacleMask ||
    prefix.settings.stepOverflowProtection !== options.settings.stepOverflowProtection ||
    prefix.soldierCenter?.x !== options.soldierCenter?.x ||
    prefix.soldierCenter?.y !== options.soldierCenter?.y ||
    prefix.points.length > options.points.length
  ) {
    return false;
  }
  for (let index = 0; index < prefix.points.length; index += 1) {
    if (prefix.points[index]?.x !== options.points[index]?.x || prefix.points[index]?.y !== options.points[index]?.y) {
      return false;
    }
  }
  return true;
}

/** 保护集合稳定后才生成可发射文本，避免为必然丢弃的中间状态反复拼接表达式。 */
function finalizeGraphwarTrajectoryFormulaContext(
  options: {
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
    soldierCenter?: GraphPoint;
  },
  state: TrajectoryFormulaState,
): GraphwarTrajectoryFormulaContext {
  const formulaResult = buildFormula(
    state.formulaPoints,
    options.settings.steepness,
    options.settings.equation,
    options.settings.algorithm,
    options.settings.decimalPlaces,
    {
      compiledMaterials: state.compiledMaterials,
      signProtection: state.signProtection,
      stepOverflowProtection: state.formulaEvaluation.stepOverflowProtection,
      stepOverflowProtectionRange: state.formulaEvaluation.stepOverflowProtectionRange,
    },
  );
  return {
    compiledMaterials: state.compiledMaterials,
    formulaResult,
    formulaEvaluation: state.formulaEvaluation,
    formulaPoints: state.formulaPoints,
    ...(state.launchAngleRadians === undefined ? {} : { launchAngleRadians: state.launchAngleRadians }),
    settings: options.settings,
    signProtection: state.signProtection,
    soldierCenter: options.soldierCenter,
    stepGlitchFormulaPrefix: state.stepGlitchFormulaPrefix,
  };
}

/** 一轮公式求解稳定后供文本生成和轨迹采样共用的状态。 */
interface TrajectoryFormulaState {
  compiledMaterials: CompiledGraphwarFormulaMaterials;
  formulaEvaluation: FormulaEvaluationOptions;
  formulaPoints: GraphPoint[];
  launchAngleRadians?: number;
  signProtection: GraphwarSignProtection;
  stepGlitchFormulaPrefix?: GraphwarStepGlitchFormulaPrefix;
}

/** 把新证据写入可变副本；返回值让调用方只在保护集合真正扩大时重算。 */
function addGraphwarSignProtection(protection: number[], segmentIndex: number, role: GraphwarSignRole) {
  const previous = protection[segmentIndex] ?? 0;
  const next = previous | role;
  if (next === previous) {
    return false;
  }
  protection[segmentIndex] = next;
  return true;
}

/** 从实际模拟落点修正 ODE 各段公式材料和邪道替换项。 */
interface StepSimulationRefinement {
  /** 最后一段候选已从枪口验证通过的保护集合；可直接用于最终编译，不反向改写冻结前缀。 */
  acceptedSignProtection?: GraphwarSignProtection;
  formulaPoints: readonly GraphPoint[];
  /** Y''= hard Step 候选完整回放时使用的有效发射角。 */
  launchAngleRadians?: number;
  segmentStartPoints: readonly (GraphPoint | undefined)[];
  /** 选中候选可能确认新的逻辑 sign 保护；调用方必须在继续求解前整轮重启。 */
  signProtection?: GraphwarSignProtection;
  stepGlitchSegments: readonly (StepGlitchSegment | undefined)[];
  stepSegmentDeltaYs: readonly (number | undefined)[];
}

/** ABS y'' 按真实二阶状态重新求出的折点脉冲和段起点。 */
interface AbsSecondDerivativeSimulationRefinement {
  launchAngleRadians?: number;
  pulseCenterXs: readonly (number | undefined)[];
  pulseDeltaSlopes: readonly (number | undefined)[];
  segmentStartPoints: readonly (GraphPoint | undefined)[];
}

/** ABS y'' 在控制线后的首个真实接受状态；位置和右导数优化必须消费同一快照。 */
interface AbsSecondDerivativeTargetState {
  dy: number;
  point: GraphPoint;
}

/** 只限制异常固定点路径的工作量；正常退出由一像素契约或最终文本量化状态决定。 */
const ABS_SECOND_DERIVATIVE_MAX_REFINEMENT_ITERATIONS = 100;
/** 解析响应不是 RK4 本身；保留少量带内余量，避免系数量化把理论边界重新推到 1px 外。 */
const SECOND_ORDER_POSITION_CORRECTION_TARGET_FACTOR = 0.9;

/** 邪道候选及其求值过程中确认的 sign 保护。 */
interface StepGlitchCandidateSelection {
  /** Y''= 候选完整回放时使用的有效发射角。 */
  launchAngleRadians?: number;
  segment: StepGlitchSegment;
  signProtection: GraphwarSignProtection;
}

/** 二阶候选只把 1px 当作排序分层；层内优先减小真实控制线导数，不建立新的失败阈值。 */
interface SecondOrderLandingQuality {
  derivativeError: number;
  positionErrorPlanePixels: number;
}

/** 一份已完整回放且可原子恢复的 ABS y'' 脉冲状态与真实控制线质量。 */
interface AbsSecondDerivativeRefinementCandidate {
  pulseCenterXs: (number | undefined)[];
  pulseDeltaSlopes: (number | undefined)[];
  quality: SecondOrderLandingQuality;
  targetStates: AbsSecondDerivativeTargetState[];
}

/** Graphwar 只按二分缩步；直接推导最后一个不大于源码下限的实际档位。 */
const GRAPHWAR_STEP_GLITCH_MIN_STEP =
  GRAPHWAR_STEP_SIZE / 2 ** Math.ceil(Math.log2(GRAPHWAR_STEP_SIZE / GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE));
// 初始 0.01 可用两位小数精确表示；每缩半一次多保留一位，确保左门仍是严格的 R-w。
const GRAPHWAR_STEP_GLITCH_INITIAL_WINDOW_DECIMAL_PLACES = Math.max(0, Math.ceil(-Math.log10(GRAPHWAR_STEP_SIZE)));
// 一阶 RK4 更新量是 h*(k1 + 2*k2 + 2*k3 + k4)/6。邪道门函数临界时，
// 4 次采样里可能只有部分 k 取到 D，其余近似 0；因此有效位移是 factor*h*D。
// 权重 {1, 2, 2, 1}/6 的非零子集和去重后只有这六档：1/6、1/3、1/2、2/3、5/6、1。
// 每个 x 窗口按 D = ΔY / (factor * minStep) 回放六档，只从恰好一次邪道跳转的候选中择优。
const STEP_GLITCH_RK4_CONTRIBUTION_FACTORS = [1, 5 / 6, 2 / 3, 1 / 2, 1 / 3, 1 / 6] as const;
// 二阶邪道的纵跳 a4 与恢复 a1 都取 braking，权重和为 1+1；RK4 总权重 6 除以它得到速度项系数 3。
const STEP_GLITCH_SECOND_ORDER_BRAKING_WEIGHT = 2;
const STEP_GLITCH_SECOND_ORDER_BRAKING_DERIVATIVE_FACTOR = 3;
// 直接相位 acceleration 只取 a2/a3，权重比 (2+2)/(1+1)=2；armed 最小步则取 a1/a2/a3，权重和为 5。
const STEP_GLITCH_SECOND_ORDER_DIRECT_ACCELERATION_BRAKING_RATIO = 2;
const STEP_GLITCH_SECOND_ORDER_ARMED_ACCELERATION_WEIGHT = 5;
// 在恢复 a1 后关闭脉冲，但要早于位于 1.5h 的 a2/a3；取二者中点 1.25h。
const STEP_GLITCH_SECOND_ORDER_PULSE_END_STEP_FACTOR = 1.25;

/** 比较两个二阶真实状态；位置尚未达标时先纠正位置，达标后再优化目标导数及可选次级导数。 */
function isSecondOrderLandingQualityBetter(
  candidate: SecondOrderLandingQuality,
  best: SecondOrderLandingQuality | undefined,
  candidateDerivativeTieBreaker?: number,
  bestDerivativeTieBreaker?: number,
) {
  if (!best) {
    return true;
  }
  const target = graphwarToolDefaults.formulaPathQualityTargetPlanePixels;
  const candidateWithinTarget = candidate.positionErrorPlanePixels <= target;
  const bestWithinTarget = best.positionErrorPlanePixels <= target;
  if (candidateWithinTarget !== bestWithinTarget) {
    return candidateWithinTarget;
  }
  if (!candidateWithinTarget && candidate.positionErrorPlanePixels !== best.positionErrorPlanePixels) {
    return candidate.positionErrorPlanePixels < best.positionErrorPlanePixels;
  }
  if (candidate.derivativeError !== best.derivativeError) {
    return candidate.derivativeError < best.derivativeError;
  }
  if (
    candidateDerivativeTieBreaker !== undefined &&
    bestDerivativeTieBreaker !== undefined &&
    candidateDerivativeTieBreaker !== bestDerivativeTieBreaker
  ) {
    return candidateDerivativeTieBreaker < bestDerivativeTieBreaker;
  }
  return candidate.positionErrorPlanePixels < best.positionErrorPlanePixels;
}

/** 从真实控制线状态提取 Step y'' 排序质量；缺失 y' 的采样不能参与零速度优化。 */
function createStepSecondOrderLandingQuality(
  sample: GraphwarTrajectorySample,
  targetY: number,
  bounds: GraphBounds,
): SecondOrderLandingQuality | undefined {
  const landingPoint = sample.stopReason === "stopped" ? sample.points.at(-1) : undefined;
  const landingDerivative = sample.endState?.dy;
  const verticalSpan = Math.abs(bounds.maxY - bounds.minY);
  return landingPoint &&
    landingDerivative !== undefined &&
    Number.isFinite(landingPoint.y) &&
    Number.isFinite(landingDerivative) &&
    verticalSpan > 0
    ? {
        derivativeError: Math.abs(landingDerivative),
        positionErrorPlanePixels: (Math.abs(landingPoint.y - targetY) * GRAPHWAR_PLANE_HEIGHT) / verticalSpan,
      }
    : undefined;
}
/** 评估同一段所有邪道窗口和 RK4 档位时复用的不可变上下文。 */
interface StepGlitchCandidateContext extends StepGlitchPrefixFormulaContext {
  deltaYOverride: number | undefined;
  mask: Uint8Array | undefined;
  launchAngleRadians: number | undefined;
  prefixInitialState: GraphwarTrajectorySamplingState | undefined;
  prefixFormula: StepGlitchPrefixFormula;
  soldierCenter: GraphPoint;
  xWindow: GraphwarStepGlitchXWindow | undefined;
}

/** 已接受邪道前缀的公式材料及逐段覆盖状态。 */
interface StepGlitchPrefixFormulaContext {
  baseDeltaYs: readonly (number | undefined)[];
  baseDisabledSegments: readonly boolean[];
  baseSegments: readonly (StepGlitchSegment | undefined)[];
  baseStartPoints: readonly (GraphPoint | undefined)[];
  segmentIndex: number;
  signProtection: GraphwarSignProtection;
  /** 前缀只含已经正式接受的段，发现的零值可直接提交并触发整轮重启。 */
  onZeroSignArgument: (segmentIndex: number, role: GraphwarSignRole) => void;
}

/** 邪道前缀探针使用的已编译公式。 */
interface StepGlitchPrefixFormula {
  compiledMaterials: CompiledGraphwarFormulaMaterials;
  formulaEvaluation: FormulaEvaluationOptions;
}

/** 按一份固定局部保护集合求解真实段起点与邪道替换项，并编译最终公式材料。 */
function createTrajectoryFormulaState(
  options: {
    bounds: GraphBounds;
    /** 最终完整回放使用的真实碰撞设置。 */
    collision?: GraphwarTrajectoryCollisionSettings;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
    soldierCenter?: GraphPoint;
    stepGlitchFormulaPrefix?: GraphwarStepGlitchFormulaPrefix;
    stepGlitchXWindows?: readonly (GraphwarStepGlitchXWindow | undefined)[];
  },
  signProtection: GraphwarSignProtection,
):
  | { status: "protection-changed"; signProtection: GraphwarSignProtection }
  | { status: "resolved"; state: TrajectoryFormulaState } {
  let formulaPoints = createResolvedFormulaPathPoints(options, signProtection);
  const stepGlitchRequirements =
    createStepGlitchRequirements(options, formulaPoints) ??
    new Array(Math.max(0, options.points.length - 1)).fill(false);
  let stepGlitchSegments: readonly (StepGlitchSegment | undefined)[] | undefined;
  let stepSegmentDeltaYs: readonly (number | undefined)[] | undefined;
  let segmentStartPoints: readonly (GraphPoint | undefined)[] | undefined;
  let absSecondDerivativePulseCenterXs: readonly (number | undefined)[] | undefined;
  let absSecondDerivativePulseDeltaSlopes: readonly (number | undefined)[] | undefined;
  let absSecondDerivativeLaunchAngleRadians: number | undefined;
  let stepLaunchAngleRadians: number | undefined;
  let stepGlitchFormulaPrefix: GraphwarStepGlitchFormulaPrefix | undefined;
  let resolvedSignProtection = signProtection;
  if (options.settings.algorithm === "abs" && options.settings.equation === "ddy") {
    const solved = refineAbsSecondDerivativeSegmentsWithSimulation(options, formulaPoints, signProtection);
    segmentStartPoints = solved.segmentStartPoints;
    absSecondDerivativeLaunchAngleRadians = solved.launchAngleRadians;
    absSecondDerivativePulseCenterXs = solved.pulseCenterXs;
    absSecondDerivativePulseDeltaSlopes = solved.pulseDeltaSlopes;
  } else if (formulaModeUsesPositionCompensation(options.settings.algorithm, options.settings.equation)) {
    const solved = refineStepSegmentsWithSimulation(
      options,
      formulaPoints,
      stepGlitchRequirements,
      signProtection,
      options.stepGlitchFormulaPrefix,
    );
    if (solved.signProtection) {
      return { status: "protection-changed", signProtection: solved.signProtection };
    }
    stepGlitchSegments = solved.stepGlitchSegments;
    stepSegmentDeltaYs = solved.stepSegmentDeltaYs;
    segmentStartPoints = solved.segmentStartPoints;
    stepLaunchAngleRadians = solved.launchAngleRadians;
    resolvedSignProtection = solved.acceptedSignProtection ?? signProtection;
    if (
      formulaModeUsesStepGlitch(options.settings.algorithm, options.settings.equation, options.settings.stepGlitchMode)
    ) {
      stepGlitchFormulaPrefix = {
        bounds: { ...options.bounds },
        initialFormulaPoints: formulaPoints.map((point) => createGraphPoint(point.x, point.y)),
        points: options.points.map((point) => createGraphPoint(point.x, point.y)),
        refinedFormulaPoints: solved.formulaPoints.map((point) => createGraphPoint(point.x, point.y)),
        segmentStartPoints: solved.segmentStartPoints.map((point) =>
          point ? createGraphPoint(point.x, point.y) : undefined,
        ),
        ...(stepLaunchAngleRadians === undefined ? {} : { launchAngleRadians: stepLaunchAngleRadians }),
        settings: { ...options.settings },
        signProtection: [...resolvedSignProtection],
        ...(options.soldierCenter
          ? { soldierCenter: createGraphPoint(options.soldierCenter.x, options.soldierCenter.y) }
          : {}),
        stepGlitchRequirements: [...stepGlitchRequirements],
        stepGlitchSegments: [...stepGlitchSegments],
        stepSegmentDeltaYs: [...stepSegmentDeltaYs],
      };
    }

    // 求解后的替换项只回算一次发射边缘和普通段中心；最终预编译模拟负责裁决残余尾值误差。
    formulaPoints = createResolvedFormulaPathPoints(
      options,
      resolvedSignProtection,
      stepGlitchSegments,
      stepSegmentDeltaYs,
      segmentStartPoints,
    );
  }

  const formulaEvaluation = createTrajectoryFormulaEvaluation(
    options,
    formulaPoints,
    resolvedSignProtection,
    stepGlitchSegments,
    stepSegmentDeltaYs,
    segmentStartPoints,
    undefined,
    absSecondDerivativePulseDeltaSlopes,
    absSecondDerivativePulseCenterXs,
  );
  const compiledMaterials = compileGraphwarFormulaMaterials(
    formulaPoints,
    options.settings.steepness,
    options.settings.algorithm,
    formulaEvaluation,
  );
  const soldierCenter = options.soldierCenter ?? formulaPoints[0];
  const launchAngleRadians =
    stepLaunchAngleRadians ??
    absSecondDerivativeLaunchAngleRadians ??
    (options.settings.equation === "ddy" && soldierCenter
      ? getGraphwarLaunchAngle(
          {
            algorithm: options.settings.algorithm,
            compiledFormulaMaterials: compiledMaterials,
            equation: options.settings.equation,
            formulaEvaluation,
            points: formulaPoints,
            secondOrderLaunchAngleMode: options.settings.secondOrderLaunchAngleMode,
            steepness: options.settings.steepness,
          },
          soldierCenter,
        )
      : undefined);
  if (options.settings.equation === "ddy" && !Number.isFinite(launchAngleRadians)) {
    throw new GraphwarFormulaConvergenceError("Second-order formula has no finite execution angle.");
  }
  return {
    status: "resolved",
    state: {
      compiledMaterials,
      formulaEvaluation,
      formulaPoints,
      ...(launchAngleRadians === undefined ? {} : { launchAngleRadians }),
      signProtection: [...resolvedSignProtection],
      stepGlitchFormulaPrefix,
    },
  };
}

/** 集中绑定最终公式和逐段 prefix 探针共用的数值选项。 */
function createTrajectoryFormulaEvaluation(
  options: {
    bounds: GraphBounds;
    settings: GraphwarTrajectoryFormulaSettings;
  },
  formulaPoints: readonly GraphPoint[],
  signProtection: GraphwarSignProtection,
  stepGlitchSegments?: readonly (StepGlitchSegment | undefined)[],
  stepSegmentDeltaYs?: readonly (number | undefined)[],
  segmentStartPoints?: readonly (GraphPoint | undefined)[],
  disabledSegments?: readonly boolean[],
  absSecondDerivativePulseDeltaSlopes?: readonly (number | undefined)[],
  absSecondDerivativePulseCenterXs?: readonly (number | undefined)[],
): FormulaEvaluationOptions {
  return {
    disabledSegments,
    absSecondDerivativePulseCenterXs,
    absSecondDerivativePulseDeltaSlopes,
    equation: options.settings.equation,
    formulaDecimalPlaces: options.settings.decimalPlaces,
    segmentStartPoints,
    signProtection,
    stepGlitchSegments,
    stepSegmentDeltaYs,
    stepOverflowProtection: options.settings.stepOverflowProtection,
    stepOverflowProtectionRange: createStepOverflowProtectionRange(options.bounds, formulaPoints),
  };
}

/** 从枪口逐段重放 ABS y''，让每个平滑脉冲按真实 y/y' 接上下一目标；每轮修正下一轮再从枪口校正。 */
function refineAbsSecondDerivativeSegmentsWithSimulation(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
    soldierCenter?: GraphPoint;
  },
  formulaPoints: readonly GraphPoint[],
  signProtection: GraphwarSignProtection,
): AbsSecondDerivativeSimulationRefinement {
  const segmentCount = Math.max(0, options.points.length - 1);
  const targets = options.points.slice(1);
  const pulseCenterXs: (number | undefined)[] = new Array(segmentCount);
  const pulseDeltaSlopes: (number | undefined)[] = new Array(segmentCount);
  const segmentStartPoints: (GraphPoint | undefined)[] = new Array(segmentCount);
  if (segmentCount === 0) {
    return { pulseCenterXs, pulseDeltaSlopes, segmentStartPoints };
  }
  const soldierCenter = options.soldierCenter ?? options.points[0];
  const finalPoint = formulaPoints.at(-1);
  if (!soldierCenter || !finalPoint) {
    throw new GraphwarFormulaConvergenceError("ABS second-order path endpoints are missing.");
  }
  const finalX = finalPoint.x;
  const formulaSteepness = quantizeStepFormulaSteepness(options.settings.steepness, options.settings.decimalPlaces);
  const launchAngleRadians = getAbsSecondDerivativeLaunchAngle(options, soldierCenter);
  if (!(formulaSteepness > 0)) {
    throw new GraphwarFormulaConvergenceError("ABS second-order pulse steepness is not positive.");
  }

  // 基线遍历保留原控制线中心，用于移中心初始化无法继续时恢复有限公式。
  for (let pulseIndex = 0; pulseIndex < segmentCount - 1; pulseIndex += 1) {
    const startSample = sampleAbsSecondDerivativePrefix(
      options,
      formulaPoints,
      signProtection,
      pulseDeltaSlopes,
      pulseCenterXs,
      soldierCenter,
      formulaPoints[pulseIndex + 1].x,
    );
    const startPoint = startSample.points.at(-1);
    const startDy = startSample.endState?.dy;
    const target = options.points[pulseIndex + 2];
    if (
      startSample.stopReason !== "stopped" ||
      !startPoint ||
      !target ||
      startDy === undefined ||
      !Number.isFinite(startPoint.y) ||
      !Number.isFinite(startDy)
    ) {
      throw new GraphwarFormulaConvergenceError("ABS second-order segment prefix did not converge.");
    }
    if (pulseIndex > 0) {
      segmentStartPoints[pulseIndex] = startPoint;
    }

    const wantedDeltaSlope = calculateAbsSecondDerivativeTargetDy({ dy: startDy, point: startPoint }, target) - startDy;
    pulseCenterXs[pulseIndex] = quantizeStepFormulaCenterX(
      formulaPoints[pulseIndex + 1].x,
      options.settings.decimalPlaces,
    );
    pulseDeltaSlopes[pulseIndex] = wantedDeltaSlope;
  }

  // 移中心遍历必须消费自己的真实接受状态，不得借用 baseline 的接受点。
  const shiftedPulseCenterXs: (number | undefined)[] = new Array(segmentCount);
  const shiftedPulseDeltaSlopes: (number | undefined)[] = new Array(segmentCount);
  let shiftedInitializationIsFinite = true;
  for (let pulseIndex = 0; pulseIndex < segmentCount - 1; pulseIndex += 1) {
    const startSample = sampleAbsSecondDerivativePrefix(
      options,
      formulaPoints,
      signProtection,
      shiftedPulseDeltaSlopes,
      shiftedPulseCenterXs,
      soldierCenter,
      formulaPoints[pulseIndex + 1].x,
    );
    const startPoint = startSample.points.at(-1);
    const startDy = startSample.endState?.dy;
    const target = options.points[pulseIndex + 2];
    if (
      startSample.stopReason !== "stopped" ||
      !startPoint ||
      !target ||
      startDy === undefined ||
      !Number.isFinite(startPoint.y) ||
      !Number.isFinite(startDy)
    ) {
      shiftedInitializationIsFinite = false;
      break;
    }
    const shiftedPulse = resolveAbsSecondDerivativePulse(
      calculateAbsSecondDerivativeTargetDy({ dy: startDy, point: startPoint }, target) - startDy,
      {
        acceptedX: startPoint.x,
        bounds: options.bounds,
        decimalPlaces: options.settings.decimalPlaces,
        formulaSteepness,
        launchX: formulaPoints[0].x,
        startX: pulseIndex === 0 ? formulaPoints[0].x : options.points[pulseIndex].x,
        targetX: formulaPoints[pulseIndex + 1].x,
      },
    );
    if (!Number.isFinite(shiftedPulse.centerX) || !Number.isFinite(shiftedPulse.deltaSlope)) {
      shiftedInitializationIsFinite = false;
      break;
    }
    shiftedPulseCenterXs[pulseIndex] = shiftedPulse.centerX;
    shiftedPulseDeltaSlopes[pulseIndex] = shiftedPulse.deltaSlope;
  }

  // 原控制线中心是 legacy 有限基线；必须先成为 best，提前转向才能作为可失败的改善候选。
  const terminalPulseIndex = segmentCount - 1;
  const baselineTerminalPrefix = sampleAbsSecondDerivativePrefix(
    options,
    formulaPoints,
    signProtection,
    pulseDeltaSlopes,
    pulseCenterXs,
    soldierCenter,
    finalX,
    undefined,
    createAbsSecondDerivativeTerminalProbeBounds(options.bounds),
  );
  const baselineTerminalState = baselineTerminalPrefix.endState;
  if (
    baselineTerminalPrefix.stopReason !== "stopped" ||
    !baselineTerminalState ||
    baselineTerminalState.dy === undefined ||
    !Number.isFinite(baselineTerminalState.dy)
  ) {
    throw new GraphwarFormulaConvergenceError("ABS second-order terminal prefix did not converge.");
  }
  pulseCenterXs[terminalPulseIndex] = quantizeStepFormulaCenterX(finalX, options.settings.decimalPlaces);
  pulseDeltaSlopes[terminalPulseIndex] = 0;
  // 无末脉冲可能已经命中位置带；必须让它与后续刹车状态按同一质量规则竞争。
  let unbrakedInitialization: AbsSecondDerivativeRefinementCandidate | undefined;
  try {
    const targetStates = sampleAbsSecondDerivativeTargetStates(
      options,
      formulaPoints,
      signProtection,
      pulseDeltaSlopes,
      pulseCenterXs,
      soldierCenter,
      targets,
    );
    const quality = createAbsSecondDerivativeLandingQuality(targetStates, targets, options.bounds);
    if (Number.isFinite(quality.positionErrorPlanePixels) && Number.isFinite(quality.derivativeError)) {
      unbrakedInitialization = {
        pulseCenterXs: [...pulseCenterXs],
        pulseDeltaSlopes: [...pulseDeltaSlopes],
        quality,
        targetStates,
      };
    }
  } catch (error) {
    if (!isGraphwarFormulaConvergenceError(error)) {
      throw error;
    }
  }
  pulseDeltaSlopes[terminalPulseIndex] = -baselineTerminalState.dy;

  // 后续平滑脉冲在中心左侧仍有尾值；ABS y'' 是唯一必须从枪口整组回放的跨段补偿模式。
  const visitedPulseStates = new Set<string>();
  let bestPulseCenterXs: (number | undefined)[] | undefined;
  let bestPulseDeltaSlopes: (number | undefined)[] | undefined;
  let bestTargetStates: AbsSecondDerivativeTargetState[] | undefined;
  let bestRefinementQuality: SecondOrderLandingQuality | undefined;
  let fallbackInitialization: AbsSecondDerivativeRefinementCandidate | undefined;
  let terminalPulseIsResolved = true;
  let shiftedInitializationPending = shiftedInitializationIsFinite;
  for (
    let refinementIteration = 0;
    refinementIteration < ABS_SECOND_DERIVATIVE_MAX_REFINEMENT_ITERATIONS;
    refinementIteration += 1
  ) {
    if (terminalPulseIsResolved) {
      terminalPulseIsResolved = false;
    } else {
      try {
        resolveAbsSecondDerivativeTerminalPulse(
          options,
          formulaPoints,
          signProtection,
          pulseDeltaSlopes,
          pulseCenterXs,
          soldierCenter,
          formulaSteepness,
          finalX,
        );
      } catch (error) {
        if (bestPulseDeltaSlopes && isGraphwarFormulaConvergenceError(error)) {
          break;
        }
        throw error;
      }
    }

    // 最终系数、脉冲中心和有效发射角共同决定执行行为；key 不读取量化前的修正变量。
    const quantizedCoefficients: number[] = [];
    let stateIsFinite = true;
    for (let pulseIndex = 0; pulseIndex < pulseDeltaSlopes.length; pulseIndex += 1) {
      const deltaSlope = pulseDeltaSlopes[pulseIndex];
      if (deltaSlope === undefined) {
        stateIsFinite = false;
        break;
      }
      const coefficient = quantizeFormulaCoefficient(formulaSteepness * deltaSlope, options.settings.decimalPlaces);
      pulseDeltaSlopes[pulseIndex] = coefficient / formulaSteepness;
      if (!Number.isFinite(coefficient) || !Number.isFinite(pulseDeltaSlopes[pulseIndex])) {
        stateIsFinite = false;
        break;
      }
      quantizedCoefficients.push(Object.is(coefficient, -0) ? 0 : coefficient);
    }
    for (const centerX of pulseCenterXs) {
      stateIsFinite &&= centerX !== undefined && Number.isFinite(centerX);
    }
    stateIsFinite &&= Number.isFinite(launchAngleRadians);
    if (!stateIsFinite) {
      if (bestPulseDeltaSlopes) {
        break;
      }
      throw new GraphwarFormulaConvergenceError("ABS second-order refinement has no finite execution state.");
    }

    const pulseState = `${quantizedCoefficients.join("|")}|centers:${pulseCenterXs.join("|")}|launch:${Object.is(launchAngleRadians, -0) ? 0 : launchAngleRadians}`;
    if (visitedPulseStates.has(pulseState)) {
      break;
    }
    visitedPulseStates.add(pulseState);

    let targetStates: AbsSecondDerivativeTargetState[];
    try {
      targetStates = sampleAbsSecondDerivativeTargetStates(
        options,
        formulaPoints,
        signProtection,
        pulseDeltaSlopes,
        pulseCenterXs,
        soldierCenter,
        targets,
      );
    } catch (error) {
      if (!bestRefinementQuality && fallbackInitialization && isGraphwarFormulaConvergenceError(error)) {
        pulseCenterXs.splice(0, pulseCenterXs.length, ...fallbackInitialization.pulseCenterXs);
        pulseDeltaSlopes.splice(0, pulseDeltaSlopes.length, ...fallbackInitialization.pulseDeltaSlopes);
        targetStates = fallbackInitialization.targetStates;
        fallbackInitialization = undefined;
      } else {
        if (bestPulseDeltaSlopes && isGraphwarFormulaConvergenceError(error)) {
          break;
        }
        throw error;
      }
    }
    const refinementQuality = createAbsSecondDerivativeLandingQuality(targetStates, targets, options.bounds);
    if (
      !Number.isFinite(refinementQuality.positionErrorPlanePixels) ||
      !Number.isFinite(refinementQuality.derivativeError)
    ) {
      if (bestPulseDeltaSlopes) {
        break;
      }
      throw new GraphwarFormulaConvergenceError("ABS second-order refinement has no finite residual.");
    }
    if (!isSecondOrderLandingQualityBetter(refinementQuality, bestRefinementQuality)) {
      break;
    }
    bestRefinementQuality = refinementQuality;
    bestPulseCenterXs = [...pulseCenterXs];
    bestPulseDeltaSlopes = [...pulseDeltaSlopes];
    bestTargetStates = targetStates;

    if (shiftedInitializationPending) {
      shiftedInitializationPending = false;
      try {
        // shifted 必须先证明整条前缀可推进；否则保留 baseline，并让同一迭代继续位置修正。
        resolveAbsSecondDerivativeTerminalPulse(
          options,
          formulaPoints,
          signProtection,
          shiftedPulseDeltaSlopes,
          shiftedPulseCenterXs,
          soldierCenter,
          formulaSteepness,
          finalX,
        );
        let shiftedInitializationChangesExecutionState = false;
        for (let pulseIndex = 0; pulseIndex < segmentCount; pulseIndex += 1) {
          const shiftedDeltaSlope = shiftedPulseDeltaSlopes[pulseIndex];
          if (
            shiftedDeltaSlope === undefined ||
            shiftedPulseCenterXs[pulseIndex] !== pulseCenterXs[pulseIndex] ||
            quantizeFormulaCoefficient(formulaSteepness * shiftedDeltaSlope, options.settings.decimalPlaces) !==
              quantizedCoefficients[pulseIndex]
          ) {
            shiftedInitializationChangesExecutionState = true;
            break;
          }
        }
        if (shiftedInitializationChangesExecutionState) {
          fallbackInitialization = {
            pulseCenterXs: bestPulseCenterXs,
            pulseDeltaSlopes: bestPulseDeltaSlopes,
            quality: bestRefinementQuality,
            targetStates: bestTargetStates,
          };
          bestRefinementQuality = undefined;
          pulseCenterXs.splice(0, pulseCenterXs.length, ...shiftedPulseCenterXs);
          pulseDeltaSlopes.splice(0, pulseDeltaSlopes.length, ...shiftedPulseDeltaSlopes);
          terminalPulseIsResolved = true;
          continue;
        }
      } catch (error) {
        if (!isGraphwarFormulaConvergenceError(error)) {
          throw error;
        }
      }
    }

    if (refinementQuality.positionErrorPlanePixels <= graphwarToolDefaults.formulaPathQualityTargetPlanePixels) {
      let worstPulseIndex = -1;
      let worstDerivativeError = 0;
      for (let pulseIndex = 0; pulseIndex < segmentCount - 1; pulseIndex += 1) {
        const targetState = targetStates[pulseIndex];
        const nextTarget = targets[pulseIndex + 1];
        if (nextTarget) {
          const derivativeError = calculateAbsSecondDerivativeTargetDy(targetState, nextTarget) - targetState.dy;
          if (Math.abs(derivativeError) > Math.abs(worstDerivativeError)) {
            worstPulseIndex = pulseIndex;
            worstDerivativeError = derivativeError;
          }
        }
      }
      if (worstPulseIndex >= 0) {
        const worstDeltaSlope = pulseDeltaSlopes[worstPulseIndex];
        const worstPulseCenterX = pulseCenterXs[worstPulseIndex];
        const worstTargetState = targetStates[worstPulseIndex];
        if (worstDeltaSlope !== undefined && worstPulseCenterX !== undefined && worstTargetState) {
          // 平滑脉冲存在跨点尾值；每轮只把当前最差内点推进半步，由下一次真实整组回放决定是否继续。
          pulseDeltaSlopes[worstPulseIndex] =
            worstDeltaSlope +
            worstDerivativeError /
              (2 *
                calculateAbsSecondDerivativePulseResponse(
                  formulaPoints[0].x,
                  worstTargetState.point.x,
                  worstPulseCenterX,
                  formulaSteepness,
                ));
        }
      }
    } else {
      if (segmentCount === 2) {
        const launchX = soldierCenter.x + GRAPHWAR_GAME_SOLDIER_RADIUS * Math.cos(launchAngleRadians);
        const firstCenterX = pulseCenterXs[0];
        const secondCenterX = pulseCenterXs[1];
        const firstDeltaSlope = pulseDeltaSlopes[0];
        const secondDeltaSlope = pulseDeltaSlopes[1];
        if (
          firstCenterX !== undefined &&
          secondCenterX !== undefined &&
          firstDeltaSlope !== undefined &&
          secondDeltaSlope !== undefined
        ) {
          const firstPulseAtFirstTarget = calculateAbsSecondDerivativePulseDisplacementResponse(
            launchX,
            targetStates[0].point.x,
            firstCenterX,
            formulaSteepness,
          );
          const secondPulseAtFirstTarget = calculateAbsSecondDerivativePulseDisplacementResponse(
            launchX,
            targetStates[0].point.x,
            secondCenterX,
            formulaSteepness,
          );
          const firstPulseAtSecondTarget = calculateAbsSecondDerivativePulseDisplacementResponse(
            launchX,
            targetStates[1].point.x,
            firstCenterX,
            formulaSteepness,
          );
          const secondPulseAtSecondTarget = calculateAbsSecondDerivativePulseDisplacementResponse(
            launchX,
            targetStates[1].point.x,
            secondCenterX,
            formulaSteepness,
          );
          const determinant =
            firstPulseAtFirstTarget * secondPulseAtSecondTarget - secondPulseAtFirstTarget * firstPulseAtSecondTarget;
          const firstPositionError = targets[0].y - targetStates[0].point.y;
          const secondPositionError = targets[1].y - targetStates[1].point.y;
          if (determinant !== 0 && Number.isFinite(determinant)) {
            const firstCorrection =
              (firstPositionError * secondPulseAtSecondTarget - secondPulseAtFirstTarget * secondPositionError) /
              determinant;
            const secondCorrection =
              (firstPulseAtFirstTarget * secondPositionError - firstPositionError * firstPulseAtSecondTarget) /
              determinant;
            if (Number.isFinite(firstCorrection) && Number.isFinite(secondCorrection)) {
              pulseDeltaSlopes[0] = firstDeltaSlope + firstCorrection;
              pulseDeltaSlopes[1] = secondDeltaSlope + secondCorrection;
              // 位置方程同时消费末脉冲；下一轮必须先评估这对原子修正，再恢复末点零速度优化。
              terminalPulseIsResolved = true;
              continue;
            }
          }
        }
      }
      const firstDeltaSlope = pulseDeltaSlopes[0];
      const firstCenterX = pulseCenterXs[0];
      const positionTargetGraphUnits = planePixelsToGraphUnits(
        graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
        options.bounds,
        "y",
      );
      const positionCorrectionTargetGraphUnits =
        positionTargetGraphUnits * SECOND_ORDER_POSITION_CORRECTION_TARGET_FACTOR;
      if (
        firstDeltaSlope !== undefined &&
        firstCenterX !== undefined &&
        firstDeltaSlope !== 0 &&
        Math.abs(targets[0].y - targetStates[0].point.y) > positionTargetGraphUnits
      ) {
        const firstPositionError = targets[0].y - targetStates[0].point.y;
        const wantedCenterX =
          firstCenterX -
          (firstPositionError - Math.sign(firstPositionError) * positionCorrectionTargetGraphUnits) / firstDeltaSlope;
        let correctedCenterX = quantizeStepFormulaCenterX(wantedCenterX, options.settings.decimalPlaces);
        if (correctedCenterX === firstCenterX && wantedCenterX > firstCenterX) {
          // 向右修正小于一个十进制档位时，floor 会重复旧 key；推进一档后仍由真实回放裁决。
          correctedCenterX = quantizeStepFormulaCenterX(
            firstCenterX + 10 ** -options.settings.decimalPlaces,
            options.settings.decimalPlaces,
          );
        }
        if (Number.isFinite(correctedCenterX)) {
          pulseCenterXs[0] = correctedCenterX;
          if (terminalPulseIndex === 0 && correctedCenterX !== firstCenterX) {
            // 单段路径的首脉冲也是末脉冲；下一轮先回放这对中心/系数，不能先让末脉冲求解覆盖中心。
            terminalPulseIsResolved = true;
          }
        }
      }
      const launchX = soldierCenter.x + GRAPHWAR_GAME_SOLDIER_RADIUS * Math.cos(launchAngleRadians);
      const correctedFirstCenterX = pulseCenterXs[0];
      const appliedSlopeCorrections: { centerX: number; deltaSlope: number }[] = [];
      for (let pulseIndex = 0; pulseIndex < segmentCount - 1; pulseIndex += 1) {
        const target = targets[pulseIndex + 1];
        const targetPoint = targetStates[pulseIndex + 1].point;
        const deltaSlope = pulseDeltaSlopes[pulseIndex];
        if (deltaSlope !== undefined) {
          const pulseCenterX = pulseCenterXs[pulseIndex];
          if (pulseCenterX === undefined) {
            continue;
          }
          let correctedTargetY =
            targetPoint.y +
            (correctedFirstCenterX !== undefined &&
            correctedFirstCenterX !== firstCenterX &&
            firstDeltaSlope !== undefined &&
            firstCenterX !== undefined
              ? firstDeltaSlope *
                (calculateAbsSecondDerivativePulseDisplacementResponse(
                  launchX,
                  targetPoint.x,
                  correctedFirstCenterX,
                  formulaSteepness,
                ) -
                  calculateAbsSecondDerivativePulseDisplacementResponse(
                    launchX,
                    targetPoint.x,
                    firstCenterX,
                    formulaSteepness,
                  ))
              : 0);
          for (const appliedCorrection of appliedSlopeCorrections) {
            correctedTargetY +=
              appliedCorrection.deltaSlope *
              calculateAbsSecondDerivativePulseDisplacementResponse(
                launchX,
                targetPoint.x,
                appliedCorrection.centerX,
                formulaSteepness,
              );
          }
          const positionError = target.y - correctedTargetY;
          if (Math.abs(positionError) <= positionTargetGraphUnits) {
            continue;
          }
          const positionResponse = calculateAbsSecondDerivativePulseDisplacementResponse(
            launchX,
            targetPoint.x,
            pulseCenterX,
            formulaSteepness,
          );
          if (!(positionResponse > 0) || !Number.isFinite(positionResponse)) {
            continue;
          }
          const correction =
            (positionError - Math.sign(positionError) * positionCorrectionTargetGraphUnits) / positionResponse;
          const currentCoefficient = quantizedCoefficients[pulseIndex];
          let correctedCoefficient = quantizeFormulaCoefficient(
            formulaSteepness * (deltaSlope + correction),
            options.settings.decimalPlaces,
          );
          if (correctedCoefficient === currentCoefficient) {
            correctedCoefficient = quantizeFormulaCoefficient(
              currentCoefficient + Math.sign(correction) * 10 ** -options.settings.decimalPlaces,
              options.settings.decimalPlaces,
            );
          }
          const correctedDeltaSlope = correctedCoefficient / formulaSteepness;
          pulseDeltaSlopes[pulseIndex] = correctedDeltaSlope;
          // 右侧目标消费文本实际交付的量化脉冲；下一轮完整回放再校正未来脉冲的左尾。
          const appliedCorrection = correctedDeltaSlope - deltaSlope;
          if (appliedCorrection !== 0) {
            appliedSlopeCorrections.push({ centerX: pulseCenterX, deltaSlope: appliedCorrection });
          }
        }
      }
    }
  }
  for (const initialization of [unbrakedInitialization, fallbackInitialization]) {
    if (initialization && isSecondOrderLandingQualityBetter(initialization.quality, bestRefinementQuality)) {
      // 所有初始化使用同一分层规则；shifted 和刹车都不能绕过 1px 位置带。
      bestRefinementQuality = initialization.quality;
      bestPulseCenterXs = initialization.pulseCenterXs;
      bestPulseDeltaSlopes = initialization.pulseDeltaSlopes;
      bestTargetStates = initialization.targetStates;
    }
  }
  if (!bestPulseCenterXs || !bestPulseDeltaSlopes || !bestTargetStates) {
    throw new GraphwarFormulaConvergenceError("ABS second-order refinement has no finite execution state.");
  }
  // 重复、分层残差持平/恶化或工作量上限都恢复历史最佳；1px 只切换位置/导数优先级。
  pulseCenterXs.splice(0, pulseCenterXs.length, ...bestPulseCenterXs);
  pulseDeltaSlopes.splice(0, pulseDeltaSlopes.length, ...bestPulseDeltaSlopes);

  // 内点冻结后，末脉冲仍按整条路径排序；末点 y' 只在全局导数误差持平时作为次级目标。
  const terminalCenterX = pulseCenterXs[terminalPulseIndex];
  let bestTerminalDeltaSlope = pulseDeltaSlopes[terminalPulseIndex];
  const bestTerminalState = bestTargetStates[terminalPulseIndex];
  if (terminalCenterX === undefined || bestTerminalDeltaSlope === undefined || !bestTerminalState) {
    throw new GraphwarFormulaConvergenceError("ABS second-order terminal state is missing.");
  }
  let bestTerminalQuality = createAbsSecondDerivativeLandingQuality(bestTargetStates, targets, options.bounds);
  let bestTerminalTargetStates = bestTargetStates;
  let bestTerminalDy = bestTerminalState.dy;
  let bestTerminalPoint = bestTerminalState.point;
  if (quantizeFormulaCoefficient(formulaSteepness * bestTerminalDeltaSlope, options.settings.decimalPlaces) !== 0) {
    pulseDeltaSlopes[terminalPulseIndex] = 0;
    try {
      const zeroTerminalStates = sampleAbsSecondDerivativeTargetStates(
        options,
        formulaPoints,
        signProtection,
        pulseDeltaSlopes,
        pulseCenterXs,
        soldierCenter,
        targets,
      );
      const zeroTerminalState = zeroTerminalStates[terminalPulseIndex];
      const zeroTerminalQuality = createAbsSecondDerivativeLandingQuality(zeroTerminalStates, targets, options.bounds);
      if (
        isSecondOrderLandingQualityBetter(
          zeroTerminalQuality,
          bestTerminalQuality,
          Math.abs(zeroTerminalState.dy),
          Math.abs(bestTerminalDy),
        )
      ) {
        bestTerminalDeltaSlope = 0;
        bestTerminalQuality = zeroTerminalQuality;
        bestTerminalTargetStates = zeroTerminalStates;
        bestTerminalDy = zeroTerminalState.dy;
        bestTerminalPoint = zeroTerminalState.point;
      }
    } catch (error) {
      if (!isGraphwarFormulaConvergenceError(error)) {
        throw error;
      }
    }
  }
  let oppositeTerminalDeltaSlope: number | undefined;
  let oppositeTerminalDy: number | undefined;
  let rejectedTerminalDeltaSlope: number | undefined;
  const visitedTerminalCoefficients = new Set([
    quantizeFormulaCoefficient(formulaSteepness * bestTerminalDeltaSlope, options.settings.decimalPlaces),
  ]);
  const terminalLaunchX = soldierCenter.x + GRAPHWAR_GAME_SOLDIER_RADIUS * Math.cos(launchAngleRadians);
  let nextTerminalDeltaSlope: number | undefined;
  if (bestTerminalQuality.positionErrorPlanePixels > graphwarToolDefaults.formulaPathQualityTargetPlanePixels) {
    const positionStates: { error: number; response: number }[] = [];
    let worstTargetIndex = 0;
    for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
      const positionError = targets[targetIndex].y - bestTerminalTargetStates[targetIndex].point.y;
      const positionResponse = calculateAbsSecondDerivativePulseDisplacementResponse(
        terminalLaunchX,
        bestTerminalTargetStates[targetIndex].point.x,
        terminalCenterX,
        formulaSteepness,
      );
      if (!Number.isFinite(positionError) || !(positionResponse > 0) || !Number.isFinite(positionResponse)) {
        positionStates.length = 0;
        break;
      }
      positionStates.push({ error: positionError, response: positionResponse });
      if (Math.abs(positionError) > Math.abs(positionStates[worstTargetIndex].error)) {
        worstTargetIndex = targetIndex;
      }
    }
    const worstPositionState = positionStates[worstTargetIndex];
    if (worstPositionState) {
      // 只解析当前最坏残差与各限制点等幅反号的有限候选；真实整组回放仍是唯一裁决。
      let bestCorrection = 0;
      let bestPredictedError = Math.abs(worstPositionState.error);
      for (const positionState of positionStates) {
        const correction =
          (worstPositionState.error + positionState.error) / (worstPositionState.response + positionState.response);
        if (!Number.isFinite(correction) || correction * worstPositionState.error <= 0) {
          continue;
        }
        let predictedError = 0;
        for (const predictedState of positionStates) {
          predictedError = Math.max(
            predictedError,
            Math.abs(predictedState.error - correction * predictedState.response),
          );
        }
        if (predictedError < bestPredictedError) {
          bestCorrection = correction;
          bestPredictedError = predictedError;
        }
      }
      if (bestCorrection !== 0) {
        nextTerminalDeltaSlope = bestTerminalDeltaSlope + bestCorrection;
      }
    }
  }
  let terminalProposalTargetsPosition = nextTerminalDeltaSlope !== undefined;
  pulseDeltaSlopes[terminalPulseIndex] =
    nextTerminalDeltaSlope ??
    bestTerminalDeltaSlope -
      bestTerminalDy /
        calculateAbsSecondDerivativePulseResponse(
          formulaPoints[0].x,
          bestTerminalPoint.x,
          terminalCenterX,
          formulaSteepness,
        );
  for (
    let refinementIteration = 0;
    refinementIteration < ABS_SECOND_DERIVATIVE_MAX_REFINEMENT_ITERATIONS;
    refinementIteration += 1
  ) {
    const pendingTerminalDeltaSlope = pulseDeltaSlopes[terminalPulseIndex];
    if (pendingTerminalDeltaSlope === undefined) {
      break;
    }
    const terminalCoefficient = quantizeFormulaCoefficient(
      formulaSteepness * pendingTerminalDeltaSlope,
      options.settings.decimalPlaces,
    );
    const terminalDeltaSlope = terminalCoefficient / formulaSteepness;
    pulseDeltaSlopes[terminalPulseIndex] = terminalDeltaSlope;
    if (
      !Number.isFinite(terminalCoefficient) ||
      !Number.isFinite(terminalDeltaSlope) ||
      visitedTerminalCoefficients.has(terminalCoefficient)
    ) {
      break;
    }
    visitedTerminalCoefficients.add(terminalCoefficient);

    let targetStates: AbsSecondDerivativeTargetState[];
    try {
      targetStates = sampleAbsSecondDerivativeTargetStates(
        options,
        formulaPoints,
        signProtection,
        pulseDeltaSlopes,
        pulseCenterXs,
        soldierCenter,
        targets,
      );
    } catch (error) {
      if (isGraphwarFormulaConvergenceError(error)) {
        break;
      }
      throw error;
    }
    const terminalState = targetStates[terminalPulseIndex];
    const terminalQuality = createAbsSecondDerivativeLandingQuality(targetStates, targets, options.bounds);
    if (
      !isSecondOrderLandingQualityBetter(
        terminalQuality,
        bestTerminalQuality,
        Math.abs(terminalState.dy),
        Math.abs(bestTerminalDy),
      )
    ) {
      if (terminalProposalTargetsPosition) {
        // 带外位置只提出一次解析 minimax 候选；真实整组回放未改善就恢复 best 并停止。
        break;
      }
      if (terminalState.dy * bestTerminalDy < 0) {
        // 异号候选不替换历史最佳，只提供一次真实 RK4 割线根的另一端。
        oppositeTerminalDeltaSlope = terminalDeltaSlope;
        oppositeTerminalDy = terminalState.dy;
        pulseDeltaSlopes[terminalPulseIndex] = calculateSecantZero(
          bestTerminalDeltaSlope,
          bestTerminalDy,
          terminalDeltaSlope,
          terminalState.dy,
        );
        continue;
      }
      if (Math.abs(terminalState.dy) < Math.abs(bestTerminalDy)) {
        // 直跳零根可能越出位置带；同号拒绝点与历史最佳之间继续二分可用的刹车量。
        rejectedTerminalDeltaSlope = terminalDeltaSlope;
        pulseDeltaSlopes[terminalPulseIndex] = (bestTerminalDeltaSlope + terminalDeltaSlope) / 2;
        continue;
      }
      break;
    }
    const previousTerminalDeltaSlope = bestTerminalDeltaSlope;
    const previousTerminalDy = bestTerminalDy;
    bestTerminalQuality = terminalQuality;
    bestTerminalDeltaSlope = terminalDeltaSlope;
    bestTerminalDy = terminalState.dy;
    terminalProposalTargetsPosition = false;
    if (bestTerminalDy * previousTerminalDy < 0) {
      oppositeTerminalDeltaSlope = previousTerminalDeltaSlope;
      oppositeTerminalDy = previousTerminalDy;
    }
    if (
      oppositeTerminalDeltaSlope !== undefined &&
      oppositeTerminalDy !== undefined &&
      bestTerminalDy * oppositeTerminalDy < 0
    ) {
      pulseDeltaSlopes[terminalPulseIndex] = calculateSecantZero(
        bestTerminalDeltaSlope,
        bestTerminalDy,
        oppositeTerminalDeltaSlope,
        oppositeTerminalDy,
      );
    } else if (rejectedTerminalDeltaSlope !== undefined) {
      pulseDeltaSlopes[terminalPulseIndex] = (bestTerminalDeltaSlope + rejectedTerminalDeltaSlope) / 2;
    } else if (terminalState.dy !== previousTerminalDy) {
      pulseDeltaSlopes[terminalPulseIndex] = calculateSecantZero(
        bestTerminalDeltaSlope,
        terminalState.dy,
        previousTerminalDeltaSlope,
        previousTerminalDy,
      );
    } else {
      pulseDeltaSlopes[terminalPulseIndex] =
        bestTerminalDeltaSlope -
        terminalState.dy /
          calculateAbsSecondDerivativePulseResponse(
            formulaPoints[0].x,
            terminalState.point.x,
            terminalCenterX,
            formulaSteepness,
          );
    }
  }
  pulseDeltaSlopes[terminalPulseIndex] = bestTerminalDeltaSlope;

  const finalTargetStates = sampleAbsSecondDerivativeTargetStates(
    options,
    formulaPoints,
    signProtection,
    pulseDeltaSlopes,
    pulseCenterXs,
    soldierCenter,
    targets,
  );
  for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
    const acceptedPoint = finalTargetStates[targetIndex].point;
    if (targetIndex + 1 < segmentCount) {
      segmentStartPoints[targetIndex + 1] = acceptedPoint;
    }
  }
  return {
    launchAngleRadians,
    pulseCenterXs,
    pulseDeltaSlopes,
    segmentStartPoints,
  };
}

/** ABS y'' 始终使用士兵中心到原始首目标的解析角；补偿公式点不得反向改变角度身份。 */
function getAbsSecondDerivativeLaunchAngle(
  options: { points: readonly GraphPoint[]; settings: GraphwarTrajectoryFormulaSettings },
  soldierCenter: GraphPoint,
) {
  return getGraphwarLaunchAngle(
    {
      algorithm: "abs",
      equation: "ddy",
      points: options.points,
      secondOrderLaunchAngleMode: options.settings.secondOrderLaunchAngleMode,
      steepness: options.settings.steepness,
    },
    soldierCenter,
  );
}

/** 与 ABS y' 的逐段补偿一致：真实接受点指向下一原始目标；末点右侧水平。 */
function calculateAbsSecondDerivativeTargetDy(
  state: AbsSecondDerivativeTargetState,
  nextTarget: GraphPoint | undefined,
) {
  return nextTarget
    ? (nextTarget.y - state.point.y) / Math.max(nextTarget.x - state.point.x, GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE)
    : 0;
}

/** 以每个真实接受点的折线右导数和整条路径最大位置误差评估 ABS y'' 状态。 */
function createAbsSecondDerivativeLandingQuality(
  targetStates: readonly AbsSecondDerivativeTargetState[],
  targets: readonly GraphPoint[],
  bounds: GraphBounds,
): SecondOrderLandingQuality {
  let derivativeError = 0;
  let positionErrorPlanePixels = 0;
  for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
    const targetState = targetStates[targetIndex];
    derivativeError = Math.max(
      derivativeError,
      Math.abs(targetState.dy - calculateAbsSecondDerivativeTargetDy(targetState, targets[targetIndex + 1])),
    );
    positionErrorPlanePixels = Math.max(
      positionErrorPlanePixels,
      (Math.abs(targetState.point.y - targets[targetIndex].y) * GRAPHWAR_PLANE_HEIGHT) /
        Math.abs(bounds.maxY - bounds.minY),
    );
  }
  return { derivativeError, positionErrorPlanePixels };
}

/** 用两个真实采样状态的割线估计 y=0 对应的参数。 */
function calculateSecantZero(x: number, y: number, otherX: number, otherY: number) {
  return x - (y * (x - otherX)) / (y - otherY);
}

/** 计算一个固定中心平滑脉冲从发射点到真实控制线实际交付的速度变化比例。 */
function calculateAbsSecondDerivativePulseResponse(
  launchX: number,
  targetX: number,
  centerX: number,
  formulaSteepness: number,
) {
  const response =
    evaluateAbsSecondDerivativePulseProgress(targetX, centerX, formulaSteepness) -
    evaluateAbsSecondDerivativePulseProgress(launchX, centerX, formulaSteepness);
  return response > 0 && Number.isFinite(response) ? response : Number.NaN;
}

/** 计算一个单位斜率脉冲从真实发射点到目标线累计形成的纵向位移。 */
function calculateAbsSecondDerivativePulseDisplacementResponse(
  launchX: number,
  targetX: number,
  centerX: number,
  formulaSteepness: number,
) {
  const launchArgument = formulaSteepness * (launchX - centerX);
  const targetArgument = formulaSteepness * (targetX - centerX);
  const softplus = (value: number) => (value >= 0 ? value + Math.log1p(Math.exp(-value)) : Math.log1p(Math.exp(value)));
  return (
    (softplus(targetArgument) - softplus(launchArgument)) / formulaSteepness -
    evaluateAbsSecondDerivativePulseProgress(launchX, centerX, formulaSteepness) * (targetX - launchX)
  );
}

/** 稳定求值 ABS y'' 脉冲积分后的 sigmoid 进度，供速度和位移响应共用。 */
function evaluateAbsSecondDerivativePulseProgress(x: number, centerX: number, formulaSteepness: number) {
  const argument = formulaSteepness * (x - centerX);
  if (argument >= 0) {
    return 1 / (1 + Math.exp(-argument));
  }
  const exponential = Math.exp(argument);
  return exponential / (1 + exponential);
}

/** 末脉冲关闭后的假想 y 可以出界；只保留真实 x 边界来取得仍可被刹车救回的入射速度。 */
function createAbsSecondDerivativeTerminalProbeBounds(bounds: GraphBounds): GraphBounds {
  return { ...bounds, maxY: Number.POSITIVE_INFINITY, minY: Number.NEGATIVE_INFINITY };
}

/** 在 1px 位置预算内解析脉冲；中心已固定时只按真实交付比例重算幅度。 */
function resolveAbsSecondDerivativePulse(
  wantedDeltaSlope: number,
  options: {
    acceptedX: number;
    bounds: GraphBounds;
    centerX?: number;
    decimalPlaces: number;
    formulaSteepness: number;
    launchX: number;
    startX: number;
    targetX: number;
  },
) {
  if (options.centerX !== undefined) {
    return {
      centerX: options.centerX,
      deltaSlope:
        wantedDeltaSlope /
        calculateAbsSecondDerivativePulseResponse(
          options.launchX,
          options.acceptedX,
          options.centerX,
          options.formulaSteepness,
        ),
    };
  }
  let centerX = quantizeStepFormulaCenterX(options.targetX, options.decimalPlaces);
  let deltaSlope = wantedDeltaSlope;
  const maximumCenterOffset = Math.max(
    0,
    options.targetX - options.startX - planePixelsToGraphUnits(1, options.bounds, "x"),
  );
  const scaledPositionBudget =
    options.formulaSteepness *
    planePixelsToGraphUnits(graphwarToolDefaults.formulaPathQualityTargetPlanePixels, options.bounds, "y");
  // 中心预算依赖幅度，幅度又依赖控制线已交付比例；两次有界交替即返回可执行近似。
  for (let transition = 0; transition < 2; transition += 1) {
    const absoluteDeltaSlope = Math.abs(deltaSlope);
    centerX = quantizeStepFormulaCenterX(
      options.targetX -
        (absoluteDeltaSlope > 0 && Number.isFinite(absoluteDeltaSlope)
          ? Math.min(
              maximumCenterOffset,
              Math.max(0, Math.log(Math.expm1(scaledPositionBudget / absoluteDeltaSlope)) / options.formulaSteepness),
            )
          : 0),
      options.decimalPlaces,
    );
    if (!(centerX < options.targetX)) {
      return { centerX, deltaSlope: wantedDeltaSlope };
    }
    deltaSlope =
      wantedDeltaSlope /
      calculateAbsSecondDerivativePulseResponse(options.launchX, options.acceptedX, centerX, options.formulaSteepness);
  }
  return { centerX, deltaSlope };
}

/** 关闭旧末脉冲读取真实入射 y'，再把同一个中心与幅度作为不可拆分状态写回。 */
function resolveAbsSecondDerivativeTerminalPulse(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
  },
  formulaPoints: readonly GraphPoint[],
  signProtection: GraphwarSignProtection,
  pulseDeltaSlopes: (number | undefined)[],
  pulseCenterXs: (number | undefined)[],
  soldierCenter: GraphPoint,
  formulaSteepness: number,
  finalX: number,
) {
  const terminalPulseIndex = pulseDeltaSlopes.length - 1;
  pulseDeltaSlopes[terminalPulseIndex] = undefined;
  const terminalPrefix = sampleAbsSecondDerivativePrefix(
    options,
    formulaPoints,
    signProtection,
    pulseDeltaSlopes,
    pulseCenterXs,
    soldierCenter,
    finalX,
    undefined,
    createAbsSecondDerivativeTerminalProbeBounds(options.bounds),
  );
  const terminalState = terminalPrefix.endState;
  if (
    terminalPrefix.stopReason !== "stopped" ||
    !terminalState ||
    terminalState.dy === undefined ||
    !Number.isFinite(terminalState.dy)
  ) {
    throw new GraphwarFormulaConvergenceError("ABS second-order terminal prefix did not converge.");
  }
  const resolvedPulse = resolveAbsSecondDerivativePulse(-terminalState.dy, {
    acceptedX: terminalState.currentPoint.x,
    bounds: options.bounds,
    centerX: pulseCenterXs[terminalPulseIndex],
    decimalPlaces: options.settings.decimalPlaces,
    formulaSteepness,
    launchX: formulaPoints[0].x,
    startX: options.points[terminalPulseIndex].x,
    targetX: finalX,
  });
  if (!Number.isFinite(resolvedPulse.centerX) || !Number.isFinite(resolvedPulse.deltaSlope)) {
    throw new GraphwarFormulaConvergenceError("ABS second-order terminal pulse is not finite.");
  }
  pulseCenterXs[terminalPulseIndex] = resolvedPulse.centerX;
  pulseDeltaSlopes[terminalPulseIndex] = resolvedPulse.deltaSlope;
}

/** 用当前完整脉冲状态一次回放，并收集每条目标线后的首个真实位置和 y'。 */
function sampleAbsSecondDerivativeTargetStates(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
  },
  formulaPoints: readonly GraphPoint[],
  signProtection: GraphwarSignProtection,
  pulseDeltaSlopes: readonly (number | undefined)[],
  pulseCenterXs: readonly (number | undefined)[],
  soldierCenter: GraphPoint,
  targets: readonly GraphPoint[],
) {
  const finalTarget = targets.at(-1);
  if (!finalTarget) {
    return [];
  }
  const targetStates: AbsSecondDerivativeTargetState[] = [];
  let targetIndex = 0;
  const targetSample = sampleAbsSecondDerivativePrefix(
    options,
    formulaPoints,
    signProtection,
    pulseDeltaSlopes,
    pulseCenterXs,
    soldierCenter,
    finalTarget.x,
    (state) => {
      while (targetIndex < targets.length && state.currentPoint.x >= targets[targetIndex].x) {
        if (state.dy === undefined || !Number.isFinite(state.dy)) {
          break;
        }
        targetStates.push({ dy: state.dy, point: state.currentPoint });
        targetIndex += 1;
      }
    },
  );
  if (targetSample.stopReason !== "stopped" || targetStates.length !== targets.length) {
    throw new GraphwarFormulaConvergenceError("ABS second-order compensated target did not converge.");
  }
  for (const state of targetStates) {
    if (!Number.isFinite(state.point.x) || !Number.isFinite(state.point.y)) {
      throw new GraphwarFormulaConvergenceError("ABS second-order compensated target did not converge.");
    }
  }
  return targetStates;
}

/** 编译一组 ABS y'' 前缀脉冲，并按 Graphwar 原始 RK4 规则推进到指定 x。 */
function sampleAbsSecondDerivativePrefix(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
  },
  formulaPoints: readonly GraphPoint[],
  signProtection: GraphwarSignProtection,
  pulseDeltaSlopes: readonly (number | undefined)[],
  pulseCenterXs: readonly (number | undefined)[],
  soldierCenter: GraphPoint,
  stopX: number,
  onAcceptedState?: (state: GraphwarTrajectorySamplingState) => void,
  samplingBounds: GraphBounds = options.bounds,
) {
  const formulaEvaluation = createTrajectoryFormulaEvaluation(
    options,
    formulaPoints,
    signProtection,
    undefined,
    undefined,
    undefined,
    undefined,
    pulseDeltaSlopes,
    pulseCenterXs,
  );
  return sampleGraphwarTrajectory({
    algorithm: "abs",
    bounds: samplingBounds,
    compiledFormulaMaterials: compileGraphwarFormulaMaterials(
      formulaPoints,
      options.settings.steepness,
      "abs",
      formulaEvaluation,
    ),
    equation: "ddy",
    formulaEvaluation,
    launchAngleRadians: getAbsSecondDerivativeLaunchAngle(options, soldierCenter),
    points: formulaPoints,
    secondOrderLaunchAngleMode: options.settings.secondOrderLaunchAngleMode,
    shouldStop: (point, _previousPoint, _index, state) => {
      onAcceptedState?.(state);
      return point.x >= stopX;
    },
    soldierCenter,
    steepness: options.settings.steepness,
  });
}

/** 从左到右重放已接受 prefix，并从每个真实接受点生成下一段。 */
function refineStepSegmentsWithSimulation(
  options: {
    bounds: GraphBounds;
    /** 障碍-only soft 回退必须由同次最终回放裁决真实碰撞。 */
    collision?: GraphwarTrajectoryCollisionSettings;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
    soldierCenter?: GraphPoint;
    stepGlitchXWindows?: readonly (GraphwarStepGlitchXWindow | undefined)[];
  },
  formulaPoints: readonly GraphPoint[],
  stepGlitchRequirements: boolean[],
  signProtection: GraphwarSignProtection,
  prefix: GraphwarStepGlitchFormulaPrefix | undefined,
): StepSimulationRefinement {
  const mask = options.settings.stepGlitchObstacleMask;
  const soldierCenter = options.soldierCenter ?? formulaPoints[0];
  const stepGlitchMode = formulaModeUsesStepGlitch(
    options.settings.algorithm,
    options.settings.equation,
    options.settings.stepGlitchMode,
  );
  if (!soldierCenter || options.points.length < 2) {
    return { formulaPoints, segmentStartPoints: [], stepGlitchSegments: [], stepSegmentDeltaYs: [] };
  }

  let reusableSegmentCount = 0;
  // requirement 没有 hard 段只可能是依赖最终 collision 的 soft 兜底；跨请求不能冻结这份临时裁决。
  if (
    prefix &&
    stepGlitchPrefixMatchesSource(options, prefix) &&
    graphwarSignProtectionPrefixMatches(prefix.signProtection, signProtection, Math.max(0, prefix.points.length - 1)) &&
    prefix.initialFormulaPoints.length === prefix.points.length &&
    prefix.refinedFormulaPoints.length === prefix.points.length &&
    prefix.segmentStartPoints.length === prefix.points.length - 1 &&
    prefix.stepGlitchRequirements.length === prefix.points.length - 1 &&
    prefix.stepGlitchSegments.length === prefix.points.length - 1 &&
    prefix.stepSegmentDeltaYs.length === prefix.points.length - 1 &&
    !prefix.stepGlitchRequirements.some((required, index) => required && prefix.stepGlitchSegments[index] === undefined)
  ) {
    reusableSegmentCount = prefix.stepGlitchSegments.length;
    // soft 失败是冻结前缀的因果证据；追加后缀不应把已接受 hard Step 重新解释成 soft 段。
    for (let index = 0; index < reusableSegmentCount; index += 1) {
      stepGlitchRequirements[index] ||= prefix.stepGlitchRequirements[index] === true;
    }
    for (let index = 0; index < prefix.points.length; index += 1) {
      const oldPoint = prefix.points[index];
      const point = options.points[index];
      if (
        !oldPoint ||
        !point ||
        oldPoint.x !== point.x ||
        oldPoint.y !== point.y ||
        (index < reusableSegmentCount &&
          (options.settings.algorithm === "step" || options.stepGlitchXWindows !== undefined) &&
          prefix.stepGlitchRequirements[index] !== stepGlitchRequirements[index])
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
  const segmentStartPoints: (GraphPoint | undefined)[] = reusablePrefix
    ? [...reusablePrefix.segmentStartPoints]
    : new Array(stepGlitchRequirements.length);
  refinedSegments.length = stepGlitchRequirements.length;
  refinedDeltaYs.length = stepGlitchRequirements.length;
  segmentStartPoints.length = stepGlitchRequirements.length;
  // 已接受段的参数保持冻结；每次关闭当前和未来项并重放 prefix，只更新下一段的真实起点。
  const disabledSegments = stepGlitchRequirements.map(() => true);
  const refinedFormulaPoints = [...formulaPoints];
  const nextSignProtection = [...signProtection];
  let launchAngleRadians = reusablePrefix?.launchAngleRadians;
  let acceptedSignProtection: GraphwarSignProtection | undefined;
  let nextSegmentStartSample: StepSegmentStartSample | undefined;
  let signProtectionChanged = false;
  const onZeroSignArgument = (segmentIndex: number, role: GraphwarSignRole) => {
    signProtectionChanged = addGraphwarSignProtection(nextSignProtection, segmentIndex, role) || signProtectionChanged;
  };
  if (reusablePrefix) {
    for (let index = 0; index <= reusableSegmentCount; index += 1) {
      refinedFormulaPoints[index] = reusablePrefix.refinedFormulaPoints[index];
    }
    disabledSegments.fill(false, 0, reusableSegmentCount);
  }

  for (let segmentIndex = reusableSegmentCount; segmentIndex < options.points.length - 1; segmentIndex += 1) {
    const previousSegment = segmentIndex > 0 ? refinedSegments[segmentIndex - 1] : undefined;
    const prefixFormula = createStepGlitchPrefixFormula(options, refinedFormulaPoints, {
      baseDeltaYs: refinedDeltaYs,
      baseDisabledSegments: disabledSegments,
      baseSegments: refinedSegments,
      baseStartPoints: segmentStartPoints,
      segmentIndex,
      signProtection,
      onZeroSignArgument,
    });
    const startSample =
      segmentIndex === 0
        ? { point: refinedFormulaPoints[0] }
        : (nextSegmentStartSample ??
          sampleStepSegmentStart(options, refinedFormulaPoints, prefixFormula, {
            launchAngleRadians,
            previousSegment,
            segmentIndex,
            soldierCenter,
          }));
    if (signProtectionChanged) {
      return {
        formulaPoints: refinedFormulaPoints,
        segmentStartPoints,
        signProtection: nextSignProtection,
        stepGlitchSegments: refinedSegments,
        stepSegmentDeltaYs: refinedDeltaYs,
      };
    }
    if (!startSample || !Number.isFinite(startSample.point.y)) {
      break;
    }

    // 首段枪口由最终发射角重新解析；后续段保留首个真实接受点，禁止插值制造不可恢复状态。
    segmentStartPoints[segmentIndex] = segmentIndex === 0 ? undefined : startSample.point;
    // Step 旧 sigmoid 在控制 x 后仍会收敛；用 prefix 续播到目标 x，避免把这段尾值重复算进下一项。
    let nextDeltaYOverride = refinedFormulaPoints[segmentIndex + 1].y - startSample.point.y;
    let prefixTargetSample: GraphwarTrajectorySample | undefined;
    if (options.settings.algorithm === "step") {
      prefixTargetSample = sampleStepGlitchPrefix(
        options,
        refinedFormulaPoints,
        prefixFormula,
        launchAngleRadians,
        soldierCenter,
        options.points[segmentIndex + 1].x,
        startSample.resumeState,
      );
      const targetPoint = prefixTargetSample.points.at(-1);
      if (prefixTargetSample.stopReason !== "stopped" || !targetPoint || !Number.isFinite(targetPoint.y)) {
        break;
      }
      nextDeltaYOverride = refinedFormulaPoints[segmentIndex + 1].y - targetPoint.y;
    }
    const nextFormulaPoint = createStepSegmentFormulaPointAfterRefinement(
      options,
      refinedFormulaPoints,
      segmentIndex,
      startSample.point,
      nextDeltaYOverride,
    );
    if (signProtectionChanged) {
      return {
        formulaPoints: refinedFormulaPoints,
        segmentStartPoints,
        signProtection: nextSignProtection,
        stepGlitchSegments: refinedSegments,
        stepSegmentDeltaYs: refinedDeltaYs,
      };
    }
    const fixedWindow = options.stepGlitchXWindows?.[segmentIndex];
    const candidateContext: StepGlitchCandidateContext = {
      baseDeltaYs: refinedDeltaYs,
      baseDisabledSegments: disabledSegments,
      baseSegments: refinedSegments,
      baseStartPoints: segmentStartPoints,
      deltaYOverride: nextDeltaYOverride,
      launchAngleRadians,
      mask,
      prefixInitialState: startSample.resumeState,
      prefixFormula,
      segmentIndex,
      signProtection,
      onZeroSignArgument,
      soldierCenter,
      xWindow: fixedWindow,
    };
    let acceptedSoftDeltaYOverride: number | undefined = nextDeltaYOverride;
    let acceptedSoftFormulaPoint = nextFormulaPoint;
    let acceptedSoftStartSample: StepSegmentStartSample | undefined;
    let softReplayFailed = false;
    let softReplayHitsObstacle = false;
    if (
      fixedWindow === undefined &&
      (stepGlitchMode || (options.settings.algorithm === "step" && options.settings.equation === "ddy"))
    ) {
      let softSelection = sampleStepSoftPositionCandidate(
        options,
        refinedFormulaPoints,
        candidateContext,
        nextFormulaPoint,
        startSample.resumeState,
      );
      if (
        options.settings.equation === "ddy" &&
        prefixTargetSample &&
        graphwarSignProtectionEquals(softSelection.result.signProtection, candidateContext.signProtection)
      ) {
        const bestSoftQuality = createStepSecondOrderLandingQuality(
          softSelection.result.sample,
          options.points[segmentIndex + 1].y,
          options.bounds,
        );
        const prefixDerivative = prefixTargetSample.endState?.dy;
        const positionDerivative = softSelection.result.sample.endState?.dy;
        const positionDeltaY = candidateContext.deltaYOverride;
        // 位置已进入 1px 后只尝试一次 canonical 零速度候选；残余 y' 本身不会触发 hard Step。
        if (
          bestSoftQuality &&
          bestSoftQuality.positionErrorPlanePixels <= graphwarToolDefaults.formulaPathQualityTargetPlanePixels &&
          prefixDerivative !== undefined &&
          positionDerivative !== undefined &&
          positionDeltaY !== undefined &&
          Number.isFinite(prefixDerivative) &&
          Number.isFinite(positionDerivative) &&
          Number.isFinite(positionDeltaY) &&
          positionDerivative !== prefixDerivative &&
          positionDeltaY !== 0
        ) {
          const derivativeDeltaY =
            positionDeltaY - (positionDerivative * positionDeltaY) / (positionDerivative - prefixDerivative);
          if (Number.isFinite(derivativeDeltaY) && !Object.is(derivativeDeltaY, positionDeltaY)) {
            const positionHitsObstacle = Boolean(
              mask && stepGlitchSampleHitsObstacle(softSelection.result.sample.points, options.bounds, mask),
            );
            const derivativeSelection = sampleStepSoftPositionCandidate(
              options,
              refinedFormulaPoints,
              { ...candidateContext, deltaYOverride: derivativeDeltaY },
              createStepSegmentFormulaPointAfterRefinement(
                options,
                refinedFormulaPoints,
                segmentIndex,
                startSample.point,
                derivativeDeltaY,
              ),
              startSample.resumeState,
            );
            const derivativeQuality = createStepSecondOrderLandingQuality(
              derivativeSelection.result.sample,
              options.points[segmentIndex + 1].y,
              options.bounds,
            );
            const derivativeIsUsable =
              derivativeQuality &&
              (!mask ||
                !stepGlitchSampleHitsObstacle(derivativeSelection.result.sample.points, options.bounds, mask) ||
                positionHitsObstacle);
            if (derivativeIsUsable && isSecondOrderLandingQualityBetter(derivativeQuality, bestSoftQuality)) {
              softSelection = derivativeSelection;
            }
          }
        }
      }
      const softCandidate = softSelection.result;
      if (!graphwarSignProtectionEquals(softCandidate.signProtection, signProtection)) {
        return {
          formulaPoints: refinedFormulaPoints,
          segmentStartPoints,
          signProtection: softCandidate.signProtection,
          stepGlitchSegments: refinedSegments,
          stepSegmentDeltaYs: refinedDeltaYs,
        };
      }

      acceptedSoftDeltaYOverride = softSelection.deltaYOverride;
      acceptedSoftFormulaPoint = softSelection.formulaPoint;
      const acceptedPoint = softCandidate.sample.points.at(-1);
      if (acceptedPoint && Number.isFinite(acceptedPoint.y) && softCandidate.sample.endState) {
        acceptedSoftStartSample = { point: acceptedPoint, resumeState: softCandidate.sample.endState };
      }
      const verticalSpan = Math.abs(options.bounds.maxY - options.bounds.minY);
      // 1px 只决定是否值得尝试 hard Step，不替代最终命中、碰撞、边界和文本等价回放。
      const pathError =
        acceptedPoint && verticalSpan > 0
          ? (Math.abs(acceptedPoint.y - options.points[segmentIndex + 1].y) * GRAPHWAR_PLANE_HEIGHT) / verticalSpan
          : Number.POSITIVE_INFINITY;
      softReplayFailed =
        softCandidate.sample.stopReason !== "stopped" ||
        !Number.isFinite(pathError) ||
        pathError > graphwarToolDefaults.formulaPathQualityTargetPlanePixels;
      softReplayHitsObstacle = Boolean(
        mask && stepGlitchSampleHitsObstacle(softCandidate.sample.points, options.bounds, mask),
      );
      if (stepGlitchMode) {
        stepGlitchRequirements[segmentIndex] ||= softReplayFailed || softReplayHitsObstacle;
      }
    }
    const selection = stepGlitchRequirements[segmentIndex]
      ? selectStepGlitchSegmentCandidate(options, refinedFormulaPoints, candidateContext)
      : undefined;
    if (signProtectionChanged) {
      return {
        formulaPoints: refinedFormulaPoints,
        segmentStartPoints,
        signProtection: nextSignProtection,
        stepGlitchSegments: refinedSegments,
        stepSegmentDeltaYs: refinedDeltaYs,
      };
    }
    if (selection && !graphwarSignProtectionEquals(selection.signProtection, signProtection)) {
      if (segmentIndex < options.points.length - 2) {
        // 后面仍有未求段时，新保护会改变它们的真实起点，必须用同一保护继续整轮求解。
        return {
          formulaPoints: refinedFormulaPoints,
          segmentStartPoints,
          signProtection: selection.signProtection,
          stepGlitchSegments: refinedSegments,
          stepSegmentDeltaYs: refinedDeltaYs,
        };
      }
      // 最后一段候选已经携带新保护从枪口完整验证；保留冻结前缀，直接用该保护编译最终公式。
      acceptedSignProtection = selection.signProtection;
    }
    if (selection?.launchAngleRadians !== undefined) {
      launchAngleRadians = selection.launchAngleRadians;
    }
    if (
      !selection &&
      (fixedWindow !== undefined ||
        (stepGlitchMode && (softReplayFailed || (softReplayHitsObstacle && !options.collision?.mask))))
    ) {
      // 几何失败不能回退；障碍-only soft 只有交给同次最终碰撞回放时，才可保留既有命中/碰撞顺序。
      throw new GraphwarStepSegmentConnectionError(segmentIndex);
    }
    // 当前段一经接受便冻结；soft 已有最终文本等价的真实末状态，下一段直接续播，hard 仍从枪口重放。
    refinedSegments[segmentIndex] = selection?.segment;
    refinedDeltaYs[segmentIndex] = selection ? nextDeltaYOverride : acceptedSoftDeltaYOverride;
    disabledSegments[segmentIndex] = false;
    refinedFormulaPoints[segmentIndex + 1] = selection ? nextFormulaPoint : acceptedSoftFormulaPoint;
    nextSegmentStartSample = selection ? undefined : acceptedSoftStartSample;
  }

  return {
    ...(acceptedSignProtection ? { acceptedSignProtection } : {}),
    formulaPoints: refinedFormulaPoints,
    ...(launchAngleRadians === undefined ? {} : { launchAngleRadians }),
    segmentStartPoints,
    stepGlitchSegments: refinedSegments,
    stepSegmentDeltaYs: refinedDeltaYs,
  };
}

/** 回放现有位置补偿候选；y' 和 y'' soft 分支共用同一份最终文本等价入口。 */
function sampleStepSoftPositionCandidate(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
  },
  formulaPoints: readonly GraphPoint[],
  context: StepGlitchCandidateContext,
  formulaPoint: GraphPoint,
  initialState: GraphwarTrajectorySamplingState | undefined,
) {
  const candidateFormulaPoints = [...formulaPoints];
  candidateFormulaPoints[context.segmentIndex + 1] = formulaPoint;
  return {
    deltaYOverride: context.deltaYOverride,
    formulaPoint,
    result: sampleStepSegmentCandidateWithSignProtection(
      options,
      candidateFormulaPoints,
      context,
      undefined,
      options.points[context.segmentIndex + 1].x,
      context.segmentIndex === 0 ? undefined : initialState,
    ),
  };
}

/** 追加段可新增自己的保护位；只有前缀已有段的保护变化才会使冻结参数失效。 */
function graphwarSignProtectionPrefixMatches(
  prefix: GraphwarSignProtection,
  current: GraphwarSignProtection,
  segmentCount: number,
) {
  for (let index = 0; index < segmentCount; index += 1) {
    if ((prefix[index] ?? 0) !== (current[index] ?? 0)) {
      return false;
    }
  }
  return true;
}

/** 段起点探针的实际落点及可继续采样的前缀状态。 */
interface StepSegmentStartSample {
  point: GraphPoint;
  resumeState?: GraphwarTrajectorySamplingState;
}

/** 编译不含当前及未来段的已接受 prefix，供段起点与硬 Step 窗口探针共享。 */
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
    context.signProtection,
    prefixSegments,
    prefixDeltaYs,
    context.baseStartPoints,
    disabledSegments,
  );
  formulaEvaluation.onZeroSignArgument = context.onZeroSignArgument;
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
  launchAngleRadians: number | undefined,
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
    ...(launchAngleRadians === undefined ? {} : { launchAngleRadians }),
    points: formulaPoints,
    secondOrderLaunchAngleMode: options.settings.secondOrderLaunchAngleMode,
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
    launchAngleRadians: number | undefined;
    previousSegment: StepGlitchSegment | undefined;
    segmentIndex: number;
    soldierCenter: GraphPoint;
  },
): StepSegmentStartSample | undefined {
  const stopX = createStepSegmentRefinementStopX(options.points[context.segmentIndex].x, context.previousSegment);
  const sample = sampleStepGlitchPrefix(
    options,
    formulaPoints,
    prefixFormula,
    context.launchAngleRadians,
    context.soldierCenter,
    stopX,
  );
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
  const previous = options.points[candidateContext.segmentIndex];
  const target = options.points[candidateContext.segmentIndex + 1];
  if (!previous || !target || !(target.x > previous.x)) {
    return undefined;
  }
  const fixedWindow = candidateContext.xWindow;
  const horizontalLaunchX = candidateContext.soldierCenter.x + GRAPHWAR_GAME_SOLDIER_RADIUS;
  const launchWindowRequired =
    candidateContext.segmentIndex === 0 && target.x <= horizontalLaunchX && fixedWindow === undefined;
  const launchAngleRadians =
    launchWindowRequired && options.settings.equation === "ddy"
      ? (target.y < candidateContext.soldierCenter.y ? -1 : 1) *
        Math.acos(
          Math.min(1, Math.max(0, (target.x - candidateContext.soldierCenter.x) / (2 * GRAPHWAR_GAME_SOLDIER_RADIUS))),
        )
      : candidateContext.launchAngleRadians;
  const replayContext =
    launchAngleRadians === candidateContext.launchAngleRadians
      ? candidateContext
      : { ...candidateContext, launchAngleRadians };
  // 用户小数位只约束普通参数；邪道从最低必要精度逐档提升，15 表示小数位而不是有效数字。
  for (
    let glitchDecimalPlaces = getStepGlitchFormulaDecimalPlaces(options.settings.decimalPlaces);
    glitchDecimalPlaces <= MAX_FORMULA_DECIMAL_PLACES;
    glitchDecimalPlaces += 1
  ) {
    // hard Step 已由固定窗口、真实障碍或 soft 回放失败触发；mask 不再决定能力是否存在。
    const targetY = quantizeFormulaOffsetCenter(
      formulaPoints[candidateContext.segmentIndex + 1].y,
      glitchDecimalPlaces,
    );
    const jumps: StepGlitchJump[] = [];
    if (
      fixedWindow &&
      fixedWindow.startX > previous.x &&
      fixedWindow.endX > fixedWindow.startX &&
      target.x >= fixedWindow.endX
    ) {
      jumps.push({ ...fixedWindow, step: GRAPHWAR_STEP_GLITCH_MIN_STEP });
    } else if (launchWindowRequired) {
      // 目标控制线位于水平枪口左侧时，普通目标窗口永远无法参与发射状态。
      // y' 让 hard 门覆盖整个枪口角固定点；y'' 从实际水平枪口后开始，并携带该次发射状态完成脉冲回放。
      const launchX =
        options.settings.equation === "ddy" && launchAngleRadians !== undefined
          ? candidateContext.soldierCenter.x + GRAPHWAR_GAME_SOLDIER_RADIUS * Math.cos(launchAngleRadians)
          : horizontalLaunchX;
      const startX =
        options.settings.equation === "dy"
          ? quantizeFormulaOffsetCenter(candidateContext.soldierCenter.x, glitchDecimalPlaces)
          : quantizeFormulaOffsetCenter(launchX + GRAPHWAR_STEP_SIZE, glitchDecimalPlaces);
      const endX = quantizeFormulaOffsetCenter(
        launchX + (options.settings.equation === "dy" ? GRAPHWAR_STEP_SIZE : 2 * GRAPHWAR_STEP_SIZE),
        glitchDecimalPlaces,
      );
      if (endX > startX) {
        jumps.push({ endX, startX, step: GRAPHWAR_STEP_GLITCH_MIN_STEP });
      }
    } else if (!fixedWindow) {
      // 普通公式仍从 0.01 逐档缩半；扫描候选传入固定窗口时只验证已选中的一档。
      for (
        let windowWidth = GRAPHWAR_STEP_SIZE, windowDecimalPlaces = GRAPHWAR_STEP_GLITCH_INITIAL_WINDOW_DECIMAL_PLACES;
        windowWidth >= GRAPHWAR_STEP_GLITCH_MIN_STEP;
        windowWidth /= 2, windowDecimalPlaces += 1
      ) {
        const jump = createStepGlitchJump(previous.x, target.x, windowWidth, glitchDecimalPlaces, windowDecimalPlaces);
        if (jump) {
          jumps.push(jump);
        }
      }
    }

    for (const windowedJump of jumps) {
      // 同一窗口的六档 RK4 候选共享左门和跳前高度；只需为不同 factor 改写 D。
      const preJumpSample =
        launchWindowRequired && options.settings.equation === "dy"
          ? {
              point: createGraphPoint(
                windowedJump.startX,
                candidateContext.soldierCenter.y +
                  (targetY < candidateContext.soldierCenter.y
                    ? -GRAPHWAR_GAME_SOLDIER_RADIUS
                    : GRAPHWAR_GAME_SOLDIER_RADIUS),
              ),
              // 首段 y' 候选会从枪口完整重放；这里只提供反解 D 所需的近竖直枪口高度。
              resumeState: { currentPoint: candidateContext.soldierCenter, sampleIndex: 0 },
            }
          : sampleStepGlitchPreJump(
              options,
              formulaPoints,
              replayContext,
              windowedJump,
              candidateContext.prefixInitialState,
            );
      if (!preJumpSample) {
        continue;
      }
      const replacementDeltaY = targetY - preJumpSample.point.y;
      let bestSegment: StepGlitchSegment | undefined;
      let bestSignProtection: GraphwarSignProtection | undefined;
      let bestLaunchAngleRadians: number | undefined;
      let bestError = Number.POSITIVE_INFINITY;
      let bestSecondOrderQuality: SecondOrderLandingQuality | undefined;
      const candidates: StepGlitchSegment[] = [];
      if (options.settings.equation === "dy") {
        const gateY = createStepGlitchFormulaGateY(targetY, replacementDeltaY, glitchDecimalPlaces);
        for (const factor of STEP_GLITCH_RK4_CONTRIBUTION_FACTORS) {
          candidates.push(
            createStepFirstOrderGlitchSegment(
              windowedJump,
              targetY,
              gateY,
              replacementDeltaY,
              factor,
              glitchDecimalPlaces,
            ),
          );
        }
      } else {
        const resumeDerivative = preJumpSample.resumeState.dy;
        if (resumeDerivative !== undefined && Number.isFinite(resumeDerivative)) {
          const h = windowedJump.step;
          const directDeltaY = targetY - preJumpSample.resumeState.currentPoint.y - h * resumeDerivative;
          // 位移反解沿用 RK4 权重：direct 的 a2/a3 给出 h²/3，armed 由粗步 a4 的 h*armStep/6
          // 和下一最小步 a1/a2/a3 的 h²/2 组成；这些系数只描述加速相位，不是经验调参。
          const directAcceleration = (3 * directDeltaY) / h ** 2;
          let armStep = GRAPHWAR_STEP_SIZE;
          while (armStep > h && preJumpSample.resumeState.currentPoint.x + armStep / 2 > windowedJump.startX) {
            armStep /= 2;
          }
          const armedDeltaY = targetY - preJumpSample.resumeState.currentPoint.y - (armStep + h) * resumeDerivative;
          const armedAcceleration = armedDeltaY / ((h * armStep) / 6 + h ** 2 / 2);
          // 纵跳的 a4 和下一最小步长的 a1 共用刹车脉冲；加速负责位移，刹车以真实前缀 y' 为初态尽力把落点速度归零。
          // 直接相位在 a2/a3 加速；武装相位先让粗跨门步的 a4 加速，再由 a1/a2/a3 完成纵跳。
          for (const profile of [
            {
              acceleration: directAcceleration,
              braking:
                (-STEP_GLITCH_SECOND_ORDER_BRAKING_DERIVATIVE_FACTOR * resumeDerivative) / h -
                STEP_GLITCH_SECOND_ORDER_DIRECT_ACCELERATION_BRAKING_RATIO * directAcceleration,
              deltaY: directDeltaY,
              pulseEndX: preJumpSample.resumeState.currentPoint.x + STEP_GLITCH_SECOND_ORDER_PULSE_END_STEP_FACTOR * h,
            },
            {
              acceleration: armedAcceleration,
              braking:
                (-STEP_GLITCH_SECOND_ORDER_BRAKING_DERIVATIVE_FACTOR * resumeDerivative) / h -
                (armedAcceleration * (STEP_GLITCH_SECOND_ORDER_ARMED_ACCELERATION_WEIGHT + armStep / h)) /
                  STEP_GLITCH_SECOND_ORDER_BRAKING_WEIGHT,
              deltaY: armedDeltaY,
              pulseEndX:
                preJumpSample.resumeState.currentPoint.x + armStep + STEP_GLITCH_SECOND_ORDER_PULSE_END_STEP_FACTOR * h,
            },
          ]) {
            if (
              !Number.isFinite(profile.acceleration) ||
              !(profile.pulseEndX > windowedJump.startX) ||
              !(profile.pulseEndX < windowedJump.endX) ||
              Math.abs(profile.deltaY) <= 2 * GRAPHWAR_GAME_SOLDIER_RADIUS
            ) {
              continue;
            }
            const gateY = quantizeFormulaOffsetCenter(
              targetY + (profile.deltaY < 0 ? GRAPHWAR_GAME_SOLDIER_RADIUS : -GRAPHWAR_GAME_SOLDIER_RADIUS),
              glitchDecimalPlaces,
            );
            candidates.push({
              acceleration: profile.acceleration,
              accelerationGateY: gateY,
              braking: profile.braking,
              // 两个互补 y 门在目标命中圈近侧交接，确保武装相位的 a4 已能刹车。
              brakingGateY: gateY,
              endX: windowedJump.endX,
              equation: "ddy",
              formulaDecimalPlaces: glitchDecimalPlaces,
              pulseEndX: profile.pulseEndX,
              startX: windowedJump.startX,
              targetY,
            });
          }
        }
      }
      for (const candidate of candidates) {
        const candidateResult = sampleStepSegmentCandidateWithSignProtection(
          options,
          formulaPoints,
          replayContext,
          candidate,
          candidate.endX,
          // 枪口窗口会改变首段发射状态；已有保护也会改变左门前状态，两者都必须从枪口重放。
          !launchWindowRequired && (candidateContext.signProtection[candidateContext.segmentIndex] ?? 0) === 0
            ? preJumpSample.resumeState
            : undefined,
        );
        const sample = candidateResult.sample;
        const landingPoint = sample.stopReason === "stopped" ? sample.points[sample.points.length - 1] : undefined;
        const secondOrderQuality =
          candidate.equation === "ddy"
            ? createStepSecondOrderLandingQuality(sample, candidate.targetY, options.bounds)
            : undefined;
        if (
          !landingPoint ||
          !Number.isFinite(landingPoint.y) ||
          (candidate.equation === "ddy" && !secondOrderQuality) ||
          countStepGlitchJumps(sample.points, candidate) !== 1 ||
          (candidateContext.mask && stepGlitchSampleHitsObstacle(sample.points, options.bounds, candidateContext.mask))
        ) {
          continue;
        }

        const error = Math.abs(landingPoint.y - candidate.targetY);
        if (
          secondOrderQuality
            ? isSecondOrderLandingQualityBetter(secondOrderQuality, bestSecondOrderQuality)
            : error < bestError
        ) {
          bestError = error;
          bestSecondOrderQuality = secondOrderQuality;
          bestLaunchAngleRadians = candidateResult.launchAngleRadians;
          bestSegment = candidate;
          bestSignProtection = candidateResult.signProtection;
        }
      }
      if (bestSegment && bestSignProtection) {
        return {
          ...(bestLaunchAngleRadians === undefined ? {} : { launchAngleRadians: bestLaunchAngleRadians }),
          segment: bestSegment,
          signProtection: bestSignProtection,
        } satisfies StepGlitchCandidateSelection;
      }
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
      baseStartPoints: context.baseStartPoints,
      segmentIndex: context.segmentIndex,
      signProtection: context.signProtection,
      onZeroSignArgument: context.onZeroSignArgument,
    }),
  };
}

/** Soft/hard 候选新增保护只留在本地；只有调用方接受该候选时才允许提交。 */
function sampleStepSegmentCandidateWithSignProtection(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
  },
  formulaPoints: readonly GraphPoint[],
  context: StepGlitchCandidateContext,
  candidate: StepGlitchSegment | undefined,
  stopX: number,
  initialState: GraphwarTrajectorySamplingState | undefined,
) {
  let signProtection = [...context.signProtection];
  let reusableInitialState = initialState;
  while (true) {
    const nextSignProtection = [...signProtection];
    let changed = false;
    const candidateResult = sampleStepSegmentCandidate(
      options,
      formulaPoints,
      context,
      candidate,
      stopX,
      signProtection,
      (segmentIndex, role) => {
        changed = addGraphwarSignProtection(nextSignProtection, segmentIndex, role) || changed;
      },
      reusableInitialState,
    );
    if (!changed) {
      return { ...candidateResult, signProtection };
    }
    // 一次模拟必须对应一份不变的公式；本轮只收集证据，下轮再启用保护并从发射点重跑。
    signProtection = nextSignProtection;
    reusableInitialState = undefined;
  }
}

/** 编译一个固定保护集合下的 soft/hard 段候选，并推进到验收控制线。 */
function sampleStepSegmentCandidate(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
  },
  formulaPoints: readonly GraphPoint[],
  context: StepGlitchCandidateContext,
  candidate: StepGlitchSegment | undefined,
  stopX: number,
  signProtection: GraphwarSignProtection,
  onZeroSignArgument: (segmentIndex: number, role: GraphwarSignRole) => void,
  initialState: GraphwarTrajectorySamplingState | undefined,
) {
  const candidateSegments = [...context.baseSegments];
  const candidateDeltaYs = [...context.baseDeltaYs];
  const candidateDisabledSegments = [...context.baseDisabledSegments];
  candidateSegments[context.segmentIndex] = candidate;
  candidateDeltaYs[context.segmentIndex] = context.deltaYOverride;
  candidateDisabledSegments[context.segmentIndex] = false;
  const candidateFormulaPoints =
    context.segmentIndex === 0 && initialState === undefined
      ? createResolvedFormulaPathPoints(
          options,
          signProtection,
          candidateSegments,
          candidateDeltaYs,
          context.baseStartPoints,
        )
      : formulaPoints;
  const formulaEvaluation = createTrajectoryFormulaEvaluation(
    options,
    candidateFormulaPoints,
    signProtection,
    candidateSegments,
    candidateDeltaYs,
    context.baseStartPoints,
    candidateDisabledSegments,
  );
  formulaEvaluation.onZeroSignArgument = onZeroSignArgument;
  const compiledMaterials = compileGraphwarFormulaMaterials(
    candidateFormulaPoints,
    options.settings.steepness,
    options.settings.algorithm,
    formulaEvaluation,
  );
  const launchAngleRadians =
    options.settings.equation === "ddy"
      ? (context.launchAngleRadians ??
        getGraphwarLaunchAngle(
          {
            algorithm: options.settings.algorithm,
            compiledFormulaMaterials: compiledMaterials,
            equation: options.settings.equation,
            formulaEvaluation,
            points: candidateFormulaPoints,
            secondOrderLaunchAngleMode: options.settings.secondOrderLaunchAngleMode,
            steepness: options.settings.steepness,
          },
          context.soldierCenter,
        ))
      : undefined;
  return {
    ...(launchAngleRadians === undefined ? {} : { launchAngleRadians }),
    sample: sampleGraphwarTrajectory({
      algorithm: options.settings.algorithm,
      bounds: options.bounds,
      equation: options.settings.equation,
      compiledFormulaMaterials: compiledMaterials,
      formulaEvaluation,
      initialState,
      ...(launchAngleRadians === undefined ? {} : { launchAngleRadians }),
      points: candidateFormulaPoints,
      secondOrderLaunchAngleMode: options.settings.secondOrderLaunchAngleMode,
      shouldStop: (point) => point.x >= stopX,
      soldierCenter: context.soldierCenter,
      steepness: options.settings.steepness,
    }),
  };
}

/** 统计候选窗口内真实发生的跨门次数，拒绝重复触发的邪道项。 */
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

/** 左门前的插值高度和从上一个真实接受点恢复的状态。 */
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
    context.launchAngleRadians,
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
      ...(sample.endState?.previousDy === undefined ? {} : { dy: sample.endState.previousDy }),
      previousPoint: previousIndex > 0 ? sample.points[previousIndex - 1] : initialState?.previousPoint,
      sampleIndex: (initialState?.sampleIndex ?? 0) + previousIndex,
    },
  };
}

/** 选择普通段起点探针的停止 x，前一邪道窗口必须先完整关闭。 */
function createStepSegmentRefinementStopX(pointX: number, previousSegment: StepGlitchSegment | undefined) {
  // 前一段是邪道段时，要等局部 x 窗口关闭后再取落点；否则会把跳前 y 误当成下一段起点。
  return previousSegment ? previousSegment.endX : pointX;
}

/** 邪道落点改变累计平台后，重算下一普通段的最终公式中心。 */
function createStepSegmentFormulaPointAfterRefinement(
  options: {
    bounds: GraphBounds;
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
  if (options.settings.algorithm !== "step" || deltaYOverride === undefined) {
    return formulaTarget;
  }

  const formulaSteepness = quantizeStepFormulaSteepness(options.settings.steepness, options.settings.decimalPlaces);
  const transition = resolveStepFormulaTransition(
    formulaTarget.y - deltaYOverride,
    formulaTarget.y,
    options.settings.equation,
    formulaSteepness,
    options.settings.decimalPlaces,
  );
  // 邪道后的普通段要按 canonical 有效 ΔY 重算中心；否则低精度文本会与内部中心脱节。
  return createGraphPoint(
    calculateStepFormulaCenterX(
      actualStartPoint.x,
      target.x,
      transition.effectiveDeltaY,
      formulaSteepness,
      options.bounds,
    ),
    formulaTarget.y,
  );
}

/** 先记录固定窗口和真实障碍触发；逐段 soft 回放会在求解时补充失败原因。 */
function createStepGlitchRequirements(
  options: {
    bounds: GraphBounds;
    points: readonly GraphPoint[];
    settings: GraphwarTrajectoryFormulaSettings;
    stepGlitchXWindows?: readonly (GraphwarStepGlitchXWindow | undefined)[];
  },
  formulaPoints: readonly GraphPoint[],
) {
  const mask = options.settings.stepGlitchObstacleMask;
  if (
    !formulaModeUsesStepGlitch(
      options.settings.algorithm,
      options.settings.equation,
      options.settings.stepGlitchMode,
    ) ||
    options.points.length < 2
  ) {
    return undefined;
  }

  const requirements: boolean[] = [];
  for (let index = 1; index < options.points.length; index += 1) {
    const previous = options.points[index - 1];
    const target = options.points[index];
    // 扫描器显式传入逐段结果时，undefined 就表示该段已直连通过；普通 Step 求解才使用旧包络粗筛。
    requirements.push(
      options.stepGlitchXWindows
        ? options.stepGlitchXWindows[index - 1] !== undefined
        : Boolean(
            mask &&
            stepGlitchObstacleEnvelopeHitsObstacle(previous, target, formulaPoints[index].x, options.bounds, mask),
          ),
    );
  }
  return requirements;
}

type StepGlitchJump = NonNullable<ReturnType<typeof createStepGlitchJump>>;

/** 把 y 门关在目标命中圈近侧，并按最终负 offset 的文本规则量化。 */
function createStepGlitchFormulaGateY(targetY: number, deltaY: number, decimalPlaces: number) {
  if (deltaY === 0) {
    return targetY;
  }

  // 进入命中圈就应关闭 y 门：上跳关在下沿，下跳关在上沿，避免窗口内重复触发。
  const gateY = deltaY > 0 ? targetY - GRAPHWAR_GAME_SOLDIER_RADIUS : targetY + GRAPHWAR_GAME_SOLDIER_RADIUS;
  return quantizeFormulaOffsetCenter(gateY, decimalPlaces);
}

/** 量化邪道窗口两扇 x 门；左门可按更高精度保住严格非零宽度。 */
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
    // 左门在公式里打印为 x-startX，必须量化负 offset 后再恢复中心值。
    startX: quantizeFormulaOffsetCenter(formulaEndX - width, startDecimalPlaces),
  };
}

/** 把窗口和目标位移组合成可直接交给公式编译器的邪道段。 */
function createStepFirstOrderGlitchSegment(
  jump: StepGlitchJump,
  targetY: number,
  gateY: number,
  replacementDeltaY: number,
  contributionFactor: number,
  formulaDecimalPlaces: number,
): StepGlitchSegment {
  return {
    derivative: replacementDeltaY / (contributionFactor * jump.step),
    endX: jump.endX,
    equation: "dy",
    formulaDecimalPlaces,
    gateY,
    startX: jump.startX,
    targetY,
  };
}

/** 按最终小数位建立一个严格位于当前段内的非零邪道窗口。 */
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
  const startPlaneX = Math.floor(graphXToPlaneX(clippedMinX, bounds));
  const endPlaneX = Math.floor(graphXToPlaneX(clippedMaxX, bounds));
  const startPlaneY = Math.floor(graphYToPlaneY(clippedMinY, bounds));
  const endPlaneY = Math.floor(graphYToPlaneY(clippedMaxY, bounds));
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

/** 候选窗口只允许跳跃线段穿障碍；每个真实接受点仍必须落在空白 cell。 */
function stepGlitchSampleHitsObstacle(points: readonly GraphPoint[], bounds: GraphBounds, mask: Uint8Array) {
  for (const point of points) {
    const planeX = Math.floor(graphXToPlaneX(point.x, bounds));
    const planeY = Math.floor(graphYToPlaneY(point.y, bounds));
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
  signProtection: GraphwarSignProtection,
  stepGlitchSegments?: readonly (StepGlitchSegment | undefined)[],
  stepSegmentDeltaYs?: readonly (number | undefined)[],
  segmentStartPoints?: readonly (GraphPoint | undefined)[],
) {
  const rangeStart = options.soldierCenter ?? options.points[0];
  return createFormulaPathPoints(
    options.points,
    options.bounds,
    options.settings,
    createTrajectoryFormulaEvaluation(
      options,
      rangeStart ? [rangeStart] : [],
      signProtection,
      stepGlitchSegments,
      stepSegmentDeltaYs,
      segmentStartPoints,
    ),
  );
}

/** 用已整理好的公式上下文计算 Graphwar 实际需要的发射角。 */
export function getGraphwarTrajectoryLaunchAngle(
  context: GraphwarTrajectoryFormulaContext,
  soldierCenter = context.soldierCenter,
) {
  if (context.launchAngleRadians !== undefined) {
    return context.launchAngleRadians;
  }
  return soldierCenter
    ? getGraphwarLaunchAngle(
        {
          algorithm: context.settings.algorithm,
          equation: context.settings.equation,
          compiledFormulaMaterials: context.compiledMaterials,
          formulaEvaluation: context.formulaEvaluation,
          points: context.formulaPoints,
          secondOrderLaunchAngleMode: context.settings.secondOrderLaunchAngleMode,
          steepness: context.settings.steepness,
        },
        soldierCenter,
      )
    : Number.NaN;
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
  if (mappedPoints.length < 2) {
    return createEmptyPathTrajectoryResult();
  }
  const resolved = tryResolveGraphwarTrajectoryCandidate({
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
    points: mappedPoints,
    qualityPoints: mappedPoints.slice(1, -1),
    settings: options.settings,
    soldierCenter: mappedPoints[0],
    targetHitRadiusPixels: options.targetHitRadiusPixels,
    targetPoint: options.hitTargetPoint,
  });
  if (!resolved) {
    return createEmptyPathTrajectoryResult();
  }
  const { result } = resolved;
  return {
    earlyStopReason: result.earlyStopReason,
    reachesTargetBeforeObstacle: result.targetHitIndex >= 0,
    sample: result.sample,
    ...(result.pathError === undefined ? {} : { pathError: result.pathError }),
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
  /** 与真实命中圆对应的路径控制点；这些点不重复参加 1px 路径质量统计。 */
  targetControlPoints?: readonly PixelPoint[];
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
  if (mappedPoints.length < 2) {
    return createFailedPathTargetSequenceResult(trackedTargets.length);
  }
  const targetControlPoints =
    options.targetControlPoints ?? (targetSequence.length > 0 ? options.points.slice(-1) : []);
  const qualityPoints = mappedPoints.filter(
    (_point, index) =>
      index > 0 &&
      !targetControlPoints.some(
        (targetPoint) => targetPoint.x === options.points[index]?.x && targetPoint.y === options.points[index]?.y,
      ),
  );

  const stopOnTargetsComplete =
    options.continueAfterTargetsUntilGraphX === undefined ? options.stopOnTargetsComplete : false;
  const resolved = tryResolveGraphwarTrajectoryCandidate({
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
    points: mappedPoints,
    qualityPoints,
    requiredTargets,
    settings: options.settings,
    soldierCenter: mappedPoints[0],
    ...(stopOnTargetsComplete === undefined ? {} : { stopOnTargetsComplete }),
    targetHitRadiusPixels: options.targetHitRadiusPixels,
    targetSequence,
    trackedTargets,
  });
  if (!resolved) {
    return createFailedPathTargetSequenceResult(trackedTargets.length);
  }
  const { context, result } = resolved;
  return {
    earlyStopReason: result.earlyStopReason,
    obstacleHitIndex: result.obstacleHitIndex,
    reachedRequiredTargetCount: result.reachedRequiredTargetCount,
    reachedTargetCount: result.reachedTargetCount,
    reachesTargetSequenceBeforeObstacle:
      result.reachedTargetCount >= targetSequence.length && result.reachedRequiredTargetCount >= requiredTargets.length,
    requiredTargetsHitIndex: result.requiredTargetsHitIndex,
    sample: result.sample,
    ...(result.pathError === undefined ? {} : { pathError: result.pathError }),
    samplePointCount: result.sample.points.length,
    targetHitIndex: result.targetHitIndex,
    trackedTargetHitIndexes: result.trackedTargetHitIndexes,
    visiblePixels: result.visiblePixels,
    formulaContext: context,
  };
}

/** 生成 Graphwar 实际公式点；路径点和发射点保持 double 精度，只有最终表达式文本会按小数位格式化。 */
function createFormulaPathPoints(
  points: readonly GraphPoint[],
  bounds: GraphBounds,
  settings: GraphwarTrajectoryFormulaSettings,
  formulaEvaluation: FormulaEvaluationOptions,
) {
  return points.length < 2
    ? [...points]
    : createGraphwarFormulaPathPoints({
        algorithm: settings.algorithm,
        bounds,
        equation: settings.equation,
        formulaEvaluation,
        points,
        secondOrderLaunchAngleMode: settings.secondOrderLaunchAngleMode,
        steepness: settings.formulaPathSteepness ?? settings.steepness,
      });
}

/** 创建 sampleGraphwarTrajectory 的早停回调，并把命中、障碍和可见像素指标集中记录。 */
function createGraphwarTrajectoryStopTracker(options: {
  bounds: GraphBounds;
  boundsRect: BoundsRect;
  collision?: GraphwarTrajectoryCollisionSettings;
  collectVisiblePixels?: boolean;
  initialReachedRequiredTargetCount?: number;
  initialReachedTargetCount?: number;
  continueAfterTargetsUntilGraphX?: number;
  /** 不受真实命中圆约束的普通控制点；只参与最终回放后的质量统计。 */
  qualityPoints?: readonly GraphPoint[];
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
  const reachedRequiredTargetCountAtStart = Math.min(
    options.initialReachedRequiredTargetCount ?? 0,
    requiredTargets.length,
  );
  const requiredTargetHits = new Uint8Array(requiredTargets.length);
  requiredTargetHits.fill(1, 0, reachedRequiredTargetCountAtStart);
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
  let reachedRequiredTargetCount = reachedRequiredTargetCountAtStart;
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
        // 续播前缀已经证明了前 N 个必达目标；从 N 开始扫描，避免每个采样点重复检查历史目标。
        for (
          let targetIndex = reachedRequiredTargetCountAtStart;
          targetIndex < requiredTargets.length;
          targetIndex += 1
        ) {
          if (requiredTargetHits[targetIndex]) {
            continue;
          }
          const target = requiredTargets[targetIndex];
          if (!target) {
            continue;
          }
          const targetDx = pixel.x - target.center.x;
          const targetDy = pixel.y - target.center.y;
          if (!(targetDx * targetDx + targetDy * targetDy < requiredTargetRadiusSquares[targetIndex])) {
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
          if (!(targetDx * targetDx + targetDy * targetDy < trackedTargetRadiusSquares[targetIndex])) {
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
          if (!(targetDx * targetDx + targetDy * targetDy < targetRadiusSquares[reachedTargetCount])) {
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
          !planePointIsInsideBoundaryExpansion(planeX, planeY, collisionBoundaryExpansion) ||
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
      const pathError = measureGraphwarFormulaPathError(sample.points, options.qualityPoints ?? [], options.bounds);
      return {
        earlyStopReason,
        obstacleHitIndex,
        reachedRequiredTargetCount,
        reachedTargetCount,
        requiredTargetsHitIndex,
        sample,
        ...(pathError === undefined ? {} : { pathError }),
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

/** 创建缺少路径点或目标时的空路径验证结果。 */
function createEmptyPathTrajectoryResult(): GraphwarPathTrajectoryResult {
  return {
    reachesTargetBeforeObstacle: false,
    sample: createEmptyTrajectorySample(),
    samplePointCount: 0,
    visiblePixels: [],
  };
}

/** 候选公式收敛失败时返回可判定的失败结果；其他异常继续向调用方暴露。 */
function createFailedPathTargetSequenceResult(trackedTargetCount: number): GraphwarPathTargetSequenceResult {
  return {
    obstacleHitIndex: -1,
    reachedRequiredTargetCount: 0,
    reachedTargetCount: 0,
    reachesTargetSequenceBeforeObstacle: false,
    requiredTargetsHitIndex: -1,
    sample: createEmptyTrajectorySample(),
    samplePointCount: 0,
    targetHitIndex: -1,
    trackedTargetHitIndexes: Array.from({ length: trackedTargetCount }, () => -1),
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
