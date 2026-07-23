import type { BoundsRect, EquationMode, FormulaResult, GraphBounds, GraphPoint, PixelPoint } from "../../core/types";
import type { GraphwarExpressionParserOptions } from "../../formula/simulation/simulator";
import {
  getGraphwarTrajectoryLaunchAngle,
  GraphwarTrajectoryResolutionError,
  resolveGraphwarTrajectory,
  sampleGraphwarExpressionTrajectoryWithStops,
  type GraphwarTrajectoryCollisionSettings,
  type GraphwarTrajectoryFormulaSettings,
  type GraphwarTrajectorySampleResult,
} from "../../formula/trajectory/sampling";
import { formatVisibleTrajectoryPoints, getVisibleTrajectoryPointCount } from "../../presentation/stage/svg-polyline";

/** 轨迹结果提示原因；页面负责把原因映射成本地化文案。 */
export type GraphwarTrajectoryWarningReason = "invalid" | "max-steps" | "obstacle" | "out-of-bounds" | "too-steep";

/** 求解器和模拟器轨迹请求共享的坐标与碰撞输入。 */
interface GraphwarTrajectoryCalculationInputBase {
  /** 当前有效 Graphwar 坐标范围。 */
  bounds: GraphBounds;
  /** 当前截图坐标系矩形。 */
  boundsRect: BoundsRect;
  /** 当前障碍和边界收缩配置。 */
  collision?: GraphwarTrajectoryCollisionSettings;
}

/** 主轨迹的一次完整解算输入；判别联合避免 Worker 猜测当前页面工作流。 */
export type GraphwarTrajectoryCalculationInput =
  | (GraphwarTrajectoryCalculationInputBase & {
      /** 使用控制点解算公式并模拟。 */
      type: "solver";
      /** 当前 Graphwar 路径点，首点同时是士兵中心。 */
      points: readonly GraphPoint[];
      /** 当前公式生成和采样设置。 */
      settings: GraphwarTrajectoryFormulaSettings;
      /** 最后一个路径点对应的截图像素目标。 */
      targetPoint?: PixelPoint;
      /** 目标命中半径，单位为截图像素。 */
      targetHitRadiusPixels?: number;
    })
  | (GraphwarTrajectoryCalculationInputBase & {
      /** 直接模拟用户输入的表达式。 */
      type: "simulator";
      /** 当前公式解释模式。 */
      equation: EquationMode;
      /** 用户输入的表达式。 */
      expression: string;
      /** Y''= 模式的发射角，单位为弧度。 */
      launchAngleRadians?: number;
      /** Graphwar 表达式解析兼容选项。 */
      parser?: GraphwarExpressionParserOptions;
      /** 当前士兵中心。 */
      soldierCenter: GraphPoint;
    });

/** Worker 返回给页面原子替换的完整主轨迹结果。 */
export interface GraphwarTrajectoryCalculationResult {
  /** 已格式化给 SVG polyline 使用的轨迹点字符串。 */
  curvePoints: string;
  /** 与 Graphwar 函数 step 一一对应的可见轨迹像素前缀。 */
  trajectoryPoints: readonly PixelPoint[];
  /** 求解器生成的最终公式；模拟器不设置。 */
  formulaResult?: FormulaResult;
  /** Y''= 求解器建议的发射角，单位为度。 */
  secondOrderLaunchAngleDegrees?: number;
  /** Y''= 最终回放实际消费的发射角，单位为弧度；Agent 提交必须原样复用。 */
  secondOrderLaunchAngleRadians?: number;
  /** 普通控制点的最大纵向误差，单位为 Graphwar 原始平面像素；没有质量点时省略。 */
  pathError?: number;
  /** 显式使用两位小数执行角的 Y''= 回放没有命中目标；不阻止最佳努力公式输出。 */
  hasTargetMissWarning?: boolean;
  /** 正常完成采样后的轨迹提示原因。 */
  warningReason?: GraphwarTrajectoryWarningReason;
}

/** 异常所在阶段，用于页面区分“解算函数失败”和“模拟轨迹失败”。 */
export type GraphwarTrajectoryCalculationFailureStage = "formula" | "trajectory";

/** 业务停止原因仍属于成功；只有抛异常才返回失败 outcome。 */
export type GraphwarTrajectoryCalculationOutcome =
  | {
      ok: true;
      result: GraphwarTrajectoryCalculationResult;
    }
  | {
      message: string;
      ok: false;
      stage: GraphwarTrajectoryCalculationFailureStage;
    };

/** 主线程发送给轨迹 Worker 的带编号请求。 */
export interface GraphwarTrajectoryCalculationWorkerRequest {
  id: number;
  input: GraphwarTrajectoryCalculationInput;
}

/** 轨迹 Worker 返回给主线程的带编号结果。 */
export interface GraphwarTrajectoryCalculationWorkerResponse {
  id: number;
  outcome: GraphwarTrajectoryCalculationOutcome;
}

/** 一次完成公式解算和主轨迹模拟；保持纯函数，供 Worker 与主线程降级共用。 */
export function calculateGraphwarTrajectory(
  input: GraphwarTrajectoryCalculationInput,
): GraphwarTrajectoryCalculationOutcome {
  return input.type === "solver" ? calculateSolverTrajectory(input) : calculateSimulatorTrajectory(input);
}

/** 分阶段解算求解器输入，让公式生成与轨迹模拟异常保留各自的页面错误语义。 */
function calculateSolverTrajectory(
  input: Extract<GraphwarTrajectoryCalculationInput, { type: "solver" }>,
): GraphwarTrajectoryCalculationOutcome {
  let resolved: ReturnType<typeof resolveGraphwarTrajectory>;
  let launchAngleRadians: number;
  const isTargetCircleConfigured = input.targetPoint !== undefined && input.targetHitRadiusPixels !== undefined;
  try {
    if (input.points.length < 2) {
      throw new Error("At least two solver points are required.");
    }

    resolved = resolveGraphwarTrajectory({
      bounds: input.bounds,
      boundsRect: input.boundsRect,
      ...(input.collision ? { collision: input.collision } : {}),
      collectVisiblePixels: true,
      points: input.points,
      qualityPoints: input.points.slice(1, isTargetCircleConfigured ? -1 : input.points.length),
      settings: input.settings,
      soldierCenter: input.points[0],
      // 主轨迹必须继续画到自然停止点；目标只记录首次命中，不能为了统计截短曲线。
      stopOnTargetsComplete: false,
      ...(input.targetPoint && input.targetHitRadiusPixels !== undefined
        ? {
            targetHitRadiusPixels: input.targetHitRadiusPixels,
            targetPoint: input.targetPoint,
          }
        : {}),
    });
    if (resolved.context.formulaPoints.length < 2) {
      throw new Error("The solver did not produce enough formula points.");
    }
    launchAngleRadians =
      input.settings.equation === "ddy"
        ? getGraphwarTrajectoryLaunchAngle(resolved.context, input.points[0])
        : Number.NaN;
  } catch (error) {
    return createFailureOutcome(error instanceof GraphwarTrajectoryResolutionError ? error.stage : "formula", error);
  }

  try {
    const { context, result: sampleResult } = resolved;
    const hasTargetMissWarning = isTargetCircleConfigured && sampleResult.targetHitIndex < 0;
    // 只有显式使用两位小数执行角的 Y''= 保留最佳努力公式；完整精度结果和其它方程都严格命中。
    if (
      hasTargetMissWarning &&
      !(input.settings.equation === "ddy" && input.settings.secondOrderLaunchAngleMode === "display-rounded")
    ) {
      return createFailureOutcome("trajectory", new Error("The final formula trajectory did not hit its target."));
    }
    // 命中目标后的碰撞不影响当前路径成功提示，保持与原主线程实现一致。
    const warningReason = resolveWarningReason(
      sampleResult,
      sampleResult.targetHitIndex,
      sampleResult.targetHitIndex >= 0 && sampleResult.obstacleHitIndex >= sampleResult.targetHitIndex
        ? -1
        : sampleResult.obstacleHitIndex,
    );
    return {
      ok: true,
      result: {
        // Graphwar never draws the collision sample itself, even when the target was already reached there.
        curvePoints: formatVisibleTrajectoryPoints(sampleResult.visiblePixels, sampleResult.obstacleHitIndex),
        formulaResult: context.formulaResult,
        ...(sampleResult.pathError === undefined ? {} : { pathError: sampleResult.pathError }),
        ...(Number.isFinite(launchAngleRadians)
          ? {
              secondOrderLaunchAngleDegrees: (launchAngleRadians * 180) / Math.PI,
              secondOrderLaunchAngleRadians: launchAngleRadians,
            }
          : {}),
        ...(hasTargetMissWarning ? { hasTargetMissWarning: true } : {}),
        trajectoryPoints: sampleResult.visiblePixels.slice(
          0,
          getVisibleTrajectoryPointCount(sampleResult.visiblePixels, sampleResult.obstacleHitIndex),
        ),
        ...(warningReason ? { warningReason } : {}),
      },
    };
  } catch (error) {
    return createFailureOutcome("trajectory", error);
  }
}

/** 模拟器不生成公式，只把表达式采样异常归入轨迹阶段。 */
function calculateSimulatorTrajectory(
  input: Extract<GraphwarTrajectoryCalculationInput, { type: "simulator" }>,
): GraphwarTrajectoryCalculationOutcome {
  try {
    const sampleResult = sampleGraphwarExpressionTrajectoryWithStops({
      bounds: input.bounds,
      boundsRect: input.boundsRect,
      ...(input.collision ? { collision: input.collision } : {}),
      collectVisiblePixels: true,
      equation: input.equation,
      expression: input.expression,
      ...(input.launchAngleRadians === undefined ? {} : { launchAngleRadians: input.launchAngleRadians }),
      ...(input.parser ? { parser: input.parser } : {}),
      soldierCenter: input.soldierCenter,
    });
    const warningReason = resolveWarningReason(sampleResult, -1, sampleResult.obstacleHitIndex);
    return {
      ok: true,
      result: {
        curvePoints: formatVisibleTrajectoryPoints(sampleResult.visiblePixels, sampleResult.obstacleHitIndex),
        trajectoryPoints: sampleResult.visiblePixels.slice(
          0,
          getVisibleTrajectoryPointCount(sampleResult.visiblePixels, sampleResult.obstacleHitIndex),
        ),
        ...(warningReason ? { warningReason } : {}),
      },
    };
  } catch (error) {
    return createFailureOutcome("trajectory", error);
  }
}

/** 把采样停止原因和命中顺序收敛为页面唯一的轨迹提示。 */
function resolveWarningReason(
  sampleResult: GraphwarTrajectorySampleResult,
  targetHitIndex: number,
  obstacleHitIndex: number,
): GraphwarTrajectoryWarningReason | undefined {
  if (obstacleHitIndex >= 0) {
    return "obstacle";
  }
  if (targetHitIndex >= 0) {
    return undefined;
  }

  const stopReason = sampleResult.sample.stopReason;
  if (stopReason === "too-steep" || stopReason === "max-steps" || stopReason === "out-of-bounds") {
    return stopReason;
  }
  if (stopReason === "invalid") {
    return "invalid";
  }
  return undefined;
}

/** 将任意抛出值规范化为可跨 Worker 边界传输的阶段失败结果。 */
function createFailureOutcome(
  stage: GraphwarTrajectoryCalculationFailureStage,
  error: unknown,
): GraphwarTrajectoryCalculationOutcome {
  return {
    message: error instanceof Error ? error.message : String(error),
    ok: false,
    stage,
  };
}
