/** 负责按 Graphwar 公式规则采样轨迹，并判断路径与目标/障碍的交互。 */
import { GRAPHWAR_TOOL_SIGN_EPSILON, buildFormula } from "./formula";
import type { FormulaEvaluationOptions } from "./formula";
import { graphToImagePoint, imageToGraphPoint } from "./geometry";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "./graphwar";
import {
  createGraphwarFormulaPathPoints,
  getGraphwarLaunchAngle,
  sampleGraphwarExpressionTrajectory,
  sampleGraphwarTrajectory,
} from "./simulator";
import type {
  GraphwarExpressionParserOptions,
  GraphwarTrajectorySample,
  GraphwarTrajectorySamplingState,
} from "./simulator";
import type { AlgorithmMode, BoundsRect, EquationMode, GraphBounds, GraphPoint, PixelPoint } from "./types";

/** Graphwar 原始 770x450 平面上的网格点，用于把像素轨迹映射到障碍 mask。 */
interface PlaneGridPoint {
  /** 平面网格 x。 */
  x: number;
  /** 平面网格 y。 */
  y: number;
}

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

/** 一次轨迹采样可复用的公式上下文，避免多个验证入口重复整理路径点和保护参数。 */
export interface GraphwarTrajectoryFormulaContext {
  /** 按当前小数位生成的最终 Graphwar 表达式；验证时按 Graphwar parser 重新解析成 double。 */
  expression: string;
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
  /** 边界内缩像素，防止弹道贴边时被当作可通行。 */
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
  const formulaPoints = createFormulaPathPoints(options.points, options.settings);
  // 先用零 epsilon 干跑一次，只有轨迹真正会踩到符号折点时才让输出公式带保护值。
  const signEpsilon = formulaPathNeedsSignEpsilon({
    bounds: options.bounds,
    formulaPoints,
    settings: options.settings,
    soldierCenter: options.soldierCenter,
  })
    ? GRAPHWAR_TOOL_SIGN_EPSILON
    : 0;
  const formulaEvaluation = createGraphwarFormulaEvaluationOptions(
    options.bounds,
    formulaPoints,
    options.settings,
    signEpsilon,
  );
  return {
    expression: buildFormula(
      formulaPoints,
      options.settings.steepness,
      options.settings.equation,
      options.settings.algorithm,
      options.settings.decimalPlaces,
      formulaEvaluation,
    ).expression,
    formulaEvaluation,
    formulaPoints,
    settings: options.settings,
    signEpsilon,
    soldierCenter: options.soldierCenter,
  };
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
  soldierMarkerRadius?: number;
  skipInitialStop?: boolean;
  targetPoint?: PixelPoint;
  targetSequence?: readonly GraphwarTrajectoryTargetCircle[];
  targetSequencePoints?: readonly PixelPoint[];
}): GraphwarTrajectorySampleResult {
  const stopTracker = createGraphwarTrajectoryStopTracker(options);
  const sample = sampleGraphwarExpressionTrajectory({
    bounds: options.bounds,
    equation: options.context.settings.equation,
    expression: options.context.expression,
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
  soldierMarkerRadius: number;
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
    soldierMarkerRadius: options.soldierMarkerRadius,
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
  soldierMarkerRadius: number;
  targetCircles?: readonly GraphwarTrajectoryTargetCircle[];
  targetPoints: readonly PixelPoint[];
}): GraphwarPathTargetSequenceResult {
  const targetSequence =
    options.targetCircles ??
    options.targetPoints.map((center) => ({
      center,
      radius: options.soldierMarkerRadius,
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
    soldierMarkerRadius: options.soldierMarkerRadius,
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
  soldierMarkerRadius: number;
  targetPoint: PixelPoint;
}) {
  if (options.points.length === 0) {
    return -1;
  }
  for (let index = 1; index < options.points.length; index += 1) {
    if (
      graphwarTrajectoryPointHitsTarget(
        options.points[index],
        options.bounds,
        options.boundsRect,
        options.targetPoint,
        options.soldierMarkerRadius,
      )
    ) {
      return index;
    }
  }
  return -1;
}

/** 生成 Graphwar 实际公式点；路径点和发射点保持 double 精度，只有最终表达式文本会按小数位格式化。 */
function createFormulaPathPoints(points: readonly GraphPoint[], settings: GraphwarTrajectoryFormulaSettings) {
  return points.length < 2
    ? [...points]
    : createGraphwarFormulaPathPoints({
        algorithm: settings.algorithm,
        equation: settings.equation,
        formulaEvaluation: {
          stepOverflowProtection: settings.stepOverflowProtection,
        },
        points,
        steepness: settings.formulaPathSteepness ?? settings.steepness,
      });
}

/** 创建预编译 evaluator 需要的数值选项，把 overflow range 和 sign epsilon 固定在上下文里。 */
function createGraphwarFormulaEvaluationOptions(
  bounds: GraphBounds,
  points: readonly GraphPoint[],
  settings: GraphwarTrajectoryFormulaSettings,
  signEpsilon: number,
): FormulaEvaluationOptions {
  return {
    stepOverflowProtectionRange: createStepOverflowProtectionRange(bounds, points),
    stepOverflowProtection: settings.stepOverflowProtection,
    signEpsilon,
  };
}

/** Graphwar 只会沿 x+ 方向采样；抗溢出判断只需要覆盖从发射点到右侧边界的 x 区间。 */
function createStepOverflowProtectionRange(bounds: GraphBounds, points: readonly GraphPoint[]) {
  const startPoint = points[0];
  if (!startPoint) {
    return undefined;
  }

  return {
    minX: startPoint.x,
    maxX: Math.max(bounds.minX, bounds.maxX),
  };
}

/** 判断稳定符号近似是否必须启用 epsilon，避免无需要时改变 Graphwar 原始数值行为。 */
function formulaPathNeedsSignEpsilon(options: {
  bounds: GraphBounds;
  formulaPoints: readonly GraphPoint[];
  settings: GraphwarTrajectoryFormulaSettings;
  soldierCenter?: GraphPoint;
}) {
  if (!options.soldierCenter || options.formulaPoints.length < 2) {
    return false;
  }

  let hasZeroSignArgument = false;
  sampleGraphwarTrajectory({
    algorithm: options.settings.algorithm,
    bounds: options.bounds,
    equation: options.settings.equation,
    formulaEvaluation: {
      stepOverflowProtectionRange: createStepOverflowProtectionRange(options.bounds, options.formulaPoints),
      stepOverflowProtection: options.settings.stepOverflowProtection,
      onSignArgument(value) {
        if (value === 0) {
          hasZeroSignArgument = true;
        }
      },
      signEpsilon: 0,
    },
    points: options.formulaPoints,
    soldierCenter: options.soldierCenter,
    steepness: options.settings.steepness,
  });
  return hasZeroSignArgument;
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
  soldierMarkerRadius?: number;
  targetPoint?: PixelPoint;
  targetSequence?: readonly GraphwarTrajectoryTargetCircle[];
  targetSequencePoints?: readonly PixelPoint[];
}) {
  const targetSequence =
    options.targetSequence ??
    createTrajectoryTargetSequenceFromPoints(
      options.targetSequencePoints ?? (options.targetPoint ? [options.targetPoint] : []),
      options.soldierMarkerRadius,
    );
  const visiblePixels: PixelPoint[] = [];
  let earlyStopReason: GraphwarTrajectoryEarlyStopReason | undefined;
  let obstacleHitIndex = -1;
  let targetHitIndex = -1;
  let reachedTargetCount = Math.min(options.initialReachedTargetCount ?? 0, targetSequence.length);

  return {
    shouldStop(point: GraphPoint, _previousPoint: GraphPoint | undefined, index: number) {
      const pixel = graphToImagePoint(point, options.bounds, options.boundsRect);
      if (options.collectVisiblePixels) {
        visiblePixels.push(pixel);
      }

      // Graphwar 从第 1 个采样点开始判士兵命中，起点不参与命中检测。
      while (index > 0 && reachedTargetCount < targetSequence.length) {
        const target = targetSequence[reachedTargetCount];
        if (!target || !graphwarPixelPointHitsTarget(pixel, target.center, target.radius)) {
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

      // 障碍 mask 的边界扩张在像素转平面格点后判断，和自动寻路的模拟障碍保持一致。
      if (
        options.collision?.mask &&
        graphwarPixelPointHitsMask(
          pixel,
          options.boundsRect,
          options.collision.mask,
          options.collision.boundaryExpansion,
        )
      ) {
        obstacleHitIndex = index;
        earlyStopReason = "obstacle";
        return true;
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
  soldierMarkerRadius: number | undefined,
): GraphwarTrajectoryTargetCircle[] {
  if (soldierMarkerRadius === undefined) {
    return [];
  }
  return points.map((center) => ({ center, radius: soldierMarkerRadius }));
}

/** 判断单个 Graphwar 采样点映射到截图后是否落入目标圆。 */
function graphwarTrajectoryPointHitsTarget(
  point: GraphPoint,
  bounds: GraphBounds,
  boundsRect: BoundsRect,
  targetPoint: PixelPoint,
  soldierMarkerRadius: number,
) {
  const pixel = graphToImagePoint(point, bounds, boundsRect);
  return graphwarPixelPointHitsTarget(pixel, targetPoint, soldierMarkerRadius);
}

/** 像素点到目标中心距离小于士兵半径即视为命中。 */
function graphwarPixelPointHitsTarget(point: PixelPoint, targetPoint: PixelPoint, soldierMarkerRadius: number) {
  return Math.hypot(point.x - targetPoint.x, point.y - targetPoint.y) < soldierMarkerRadius;
}

/** 判断像素点映射到 Graphwar 原始平面后是否碰到模拟障碍 mask。 */
function graphwarPixelPointHitsMask(
  point: PixelPoint,
  boundsRect: BoundsRect,
  mask: Uint8Array,
  boundaryExpansion = 0,
) {
  return pointHitsPlaneMask(imagePointToRawPlaneGridPoint(point, boundsRect), mask, boundaryExpansion);
}

/** 将截图像素映射到未裁剪的 Graphwar 原始平面网格。 */
function imagePointToRawPlaneGridPoint(point: PixelPoint, boundsRect: BoundsRect): PlaneGridPoint {
  return {
    x: Math.floor(((point.x - boundsRect.x) / boundsRect.width) * GRAPHWAR_PLANE_LENGTH),
    y: Math.floor(((point.y - boundsRect.y) / boundsRect.height) * GRAPHWAR_PLANE_HEIGHT),
  };
}

/** 越过收缩边界或命中 mask 都视为障碍。 */
function pointHitsPlaneMask(point: PlaneGridPoint, mask: Uint8Array, boundaryExpansion: number) {
  if (!isInsidePlaneWithBoundaryExpansion(point.x, point.y, boundaryExpansion)) {
    return true;
  }
  return Boolean(mask[point.y * GRAPHWAR_PLANE_LENGTH + point.x]);
}

/** 判断平面点是否在收缩后的可模拟区域内。 */
function isInsidePlaneWithBoundaryExpansion(x: number, y: number, boundaryExpansion: number) {
  const expansion = Math.max(0, Math.floor(boundaryExpansion));
  return (
    x >= expansion && x < GRAPHWAR_PLANE_LENGTH - expansion && y >= expansion && y < GRAPHWAR_PLANE_HEIGHT - expansion
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
