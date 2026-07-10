import type { BoundsRect, EquationMode, FormulaResult, GraphBounds, GraphPoint, PixelPoint } from "../../core/types";
import type { GraphwarExpressionParserOptions } from "../../formula/simulation/simulator";
import {
  createGraphwarTrajectoryFormulaContext,
  findGraphwarTrajectoryTargetHitIndex,
  getGraphwarTrajectoryLaunchAngle,
  sampleGraphwarExpressionTrajectoryWithStops,
  sampleGraphwarFormulaTrajectory,
  type GraphwarTrajectoryCollisionSettings,
  type GraphwarTrajectoryFormulaContext,
  type GraphwarTrajectoryFormulaSettings,
  type GraphwarTrajectorySampleResult,
} from "../../formula/trajectory/sampling";
import { formatVisibleTrajectoryPoints } from "../../presentation/stage/svg-polyline";

/** 轨迹结果提示原因；页面负责把原因映射成本地化文案。 */
export type GraphwarTrajectoryWarningReason = "invalid" | "max-steps" | "obstacle" | "out-of-bounds" | "too-steep";

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
  /** 求解器生成的最终公式；模拟器不设置。 */
  formulaResult?: FormulaResult;
  /** Y''= 求解器建议的发射角，单位为度。 */
  secondOrderLaunchAngleDegrees?: number;
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

export interface GraphwarTrajectoryCalculationWorkerRequest {
  id: number;
  input: GraphwarTrajectoryCalculationInput;
}

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

function calculateSolverTrajectory(
  input: Extract<GraphwarTrajectoryCalculationInput, { type: "solver" }>,
): GraphwarTrajectoryCalculationOutcome {
  let prepared: PreparedSolverCalculation;
  try {
    if (input.points.length < 2) {
      throw new Error("At least two solver points are required.");
    }

    const context = createGraphwarTrajectoryFormulaContext({
      bounds: input.bounds,
      points: input.points,
      settings: input.settings,
      soldierCenter: input.points[0],
    });
    if (context.formulaPoints.length < 2) {
      throw new Error("The solver did not produce enough formula points.");
    }

    const launchAngleRadians =
      input.settings.equation === "ddy" ? getGraphwarTrajectoryLaunchAngle(context, input.points[0]) : Number.NaN;
    const launchAngleDegrees = (launchAngleRadians * 180) / Math.PI;
    prepared = {
      context,
      formulaResult: context.formulaResult,
      ...(Number.isFinite(launchAngleDegrees) ? { secondOrderLaunchAngleDegrees: launchAngleDegrees } : {}),
    };
  } catch (error) {
    return createFailureOutcome("formula", error);
  }

  try {
    const sampleResult = sampleGraphwarFormulaTrajectory({
      bounds: input.bounds,
      boundsRect: input.boundsRect,
      ...(input.collision ? { collision: input.collision } : {}),
      collectVisiblePixels: true,
      context: prepared.context,
    });
    const targetHitIndex = findTargetHitIndex(input, sampleResult);
    const obstacleHitIndex = prioritizeTargetOverLaterObstacle(targetHitIndex, sampleResult.obstacleHitIndex);
    const warningReason = resolveWarningReason(sampleResult, targetHitIndex, obstacleHitIndex);
    return {
      ok: true,
      result: {
        curvePoints: formatVisibleTrajectoryPoints(sampleResult.visiblePixels, obstacleHitIndex),
        formulaResult: prepared.formulaResult,
        ...(prepared.secondOrderLaunchAngleDegrees === undefined
          ? {}
          : { secondOrderLaunchAngleDegrees: prepared.secondOrderLaunchAngleDegrees }),
        ...(warningReason ? { warningReason } : {}),
      },
    };
  } catch (error) {
    return createFailureOutcome("trajectory", error);
  }
}

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
        ...(warningReason ? { warningReason } : {}),
      },
    };
  } catch (error) {
    return createFailureOutcome("trajectory", error);
  }
}

interface PreparedSolverCalculation {
  context: GraphwarTrajectoryFormulaContext;
  formulaResult: FormulaResult;
  secondOrderLaunchAngleDegrees?: number;
}

function findTargetHitIndex(
  input: Extract<GraphwarTrajectoryCalculationInput, { type: "solver" }>,
  sampleResult: GraphwarTrajectorySampleResult,
) {
  if (!input.targetPoint || input.targetHitRadiusPixels === undefined) {
    return -1;
  }
  return findGraphwarTrajectoryTargetHitIndex({
    bounds: input.bounds,
    boundsRect: input.boundsRect,
    points: sampleResult.sample.points,
    targetHitRadiusPixels: input.targetHitRadiusPixels,
    targetPoint: input.targetPoint,
  });
}

/** 命中目标后的碰撞不影响当前路径成功提示，保持与原主线程实现一致。 */
function prioritizeTargetOverLaterObstacle(targetHitIndex: number, obstacleHitIndex: number) {
  return targetHitIndex >= 0 && obstacleHitIndex >= targetHitIndex ? -1 : obstacleHitIndex;
}

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
