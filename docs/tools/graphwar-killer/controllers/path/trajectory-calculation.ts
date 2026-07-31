import {
  isGraphwarWasmFault,
  type GraphwarBackendAttemptIdentity,
  type GraphwarBackendExecution,
} from "../../core/algorithm-backend";
import type { BoundsRect, EquationMode, FormulaResult, GraphBounds, GraphPoint, PixelPoint } from "../../core/types";
import {
  runGraphwarWasmExpressionBatch,
  runGraphwarWasmTrajectory,
  prepareGraphwarWasmFormulaLaunch,
} from "../../core/wasm/formula-adapter";
import type { GraphwarWasmKernelRuntime } from "../../core/wasm/runtime";
import type { GraphwarWasmStopPolicy } from "../../core/wasm/task-adapter";
import { parseGraphwarExpressionProgram } from "../../formula/expression/evaluator";
import { buildFormula } from "../../formula/generation/build";
import type { GraphwarExpressionParserOptions } from "../../formula/simulation/simulator";
import {
  createGraphwarTrajectoryFormulaMode,
  getGraphwarTrajectoryLaunchAngle,
  GraphwarTrajectoryResolutionError,
  resolveGraphwarTrajectory,
  sampleGraphwarExpressionTrajectoryWithStops,
  sampleGraphwarExpressionTrajectoryWithStopsAndEvaluator,
  type GraphwarTrajectoryCollisionSettings,
  type GraphwarTrajectoryFormulaMode,
  type GraphwarTrajectoryFormulaSettings,
  type GraphwarTrajectorySampleResult,
} from "../../formula/trajectory/sampling";
import { snapshotGraphwarVisibleTrajectoryPoints } from "../../formula/trajectory/visible-points";
import { formatVisibleTrajectoryPoints } from "../../presentation/stage/svg-polyline";

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
      /** 最后一个路径点及其命中半径必须作为同一份目标证据出现。 */
      target?: {
        hitRadiusPixels: number;
        point: PixelPoint;
      };
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
  /** Y''= 显示度数与最终回放弧度必须作为同一份发射证据出现。 */
  secondOrderLaunchAngle?: {
    degrees: number;
    radians: number;
  };
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
  /** Stable outer task and currently authoritative backend attempt. */
  attempt: GraphwarBackendAttemptIdentity;
  id: number;
  input: GraphwarTrajectoryCalculationInput;
}

/** 轨迹 Worker 返回给主线程的带编号结果。 */
export interface GraphwarTrajectoryCalculationWorkerResponse {
  /** Exact request attempt; stale or mismatched results cannot commit. */
  attempt: GraphwarBackendAttemptIdentity;
  /** Atomic requested/effective backend record for trajectory diagnostics. */
  backendExecution: GraphwarBackendExecution;
  id: number;
  outcome: GraphwarTrajectoryCalculationOutcome;
}

/** 一次完成公式解算和主轨迹模拟；保持纯函数，供 Worker 与主线程降级共用。 */
export function calculateGraphwarTrajectory(
  input: GraphwarTrajectoryCalculationInput,
): GraphwarTrajectoryCalculationOutcome {
  return input.type === "solver"
    ? calculateSolverTrajectory(input, createGraphwarTrajectoryFormulaMode(input.settings))
    : calculateSimulatorTrajectory(input);
}

/** Executes solver trajectories and simulator expression arithmetic through the shared WASM adapters. */
export function calculateGraphwarTrajectoryWithWasm(
  runtime: GraphwarWasmKernelRuntime,
  input: GraphwarTrajectoryCalculationInput,
): GraphwarTrajectoryCalculationOutcome {
  if (input.type !== "solver") {
    return calculateSimulatorTrajectoryWithWasm(runtime, input);
  }
  try {
    if (input.points.length < 2) {
      throw new Error("At least two solver points are required.");
    }
    const descriptor = {
      bounds: input.bounds,
      points: input.points,
      settings: input.settings,
      soldierCenter: input.points[0],
    };
    const launch = prepareGraphwarWasmFormulaLaunch(runtime, descriptor);
    if (launch.status !== "success") {
      return { message: "The WASM solver could not prepare a launch.", ok: false, stage: "formula" };
    }
    const target = input.target;
    const stop: GraphwarWasmStopPolicy = {
      boundsRect: input.boundsRect,
      collision: input.collision?.mask
        ? { boundaryExpansion: input.collision.boundaryExpansion ?? 0, mask: input.collision.mask, type: "mask" }
        : { type: "none" },
      continueAfterTargetsUntilGraphX: { type: "none" },
      orderedTargets: target
        ? [
            {
              // The WASM kernel converts accepted graph points to screenshot pixels before hit testing.
              center: target.point,
              radius: target.hitRadiusPixels,
            },
          ]
        : [],
      qualityPoints: input.points.slice(1, target ? -1 : input.points.length),
      requiredTargets: [],
      shouldCollectVisiblePixels: true,
      shouldStopOnTargetsComplete: false,
      trackedTargets: [],
      type: "targets",
    };
    const sampled = runGraphwarWasmTrajectory(runtime, { descriptor, start: { type: "cold" }, stop });
    if (!sampled) {
      return { message: "The WASM solver returned an invalid launch.", ok: false, stage: "formula" };
    }
    const obstacleHitPoint =
      sampled.obstacle.type === "hit" ? sampled.visiblePixels[sampled.obstacle.sampleIndex] : undefined;
    const hasTargetMissWarning =
      target !== undefined &&
      sampled.targetHitIndex < 0 &&
      (!obstacleHitPoint || obstacleHitPoint.x >= target.point.x + target.hitRadiusPixels);
    if (
      hasTargetMissWarning &&
      !(input.settings.equation === "ddy" && input.settings.secondOrderLaunchAngleMode === "display-rounded")
    ) {
      return createFailureOutcome("trajectory", new Error("The final formula trajectory did not hit its target."));
    }
    const warningReason = resolveWasmWarningReason(
      sampled.stopReason,
      sampled.targetHitIndex,
      sampled.obstacle.type === "hit" ? sampled.obstacle.sampleIndex : -1,
    );
    const formulaResult = buildFormula(
      input.points,
      input.settings.steepness,
      input.settings.equation,
      input.settings.algorithm,
      input.settings.decimalPlaces,
    );
    return {
      ok: true,
      result: {
        curvePoints: formatVisibleTrajectoryPoints(
          sampled.visiblePixels,
          sampled.obstacle.type === "hit" ? sampled.obstacle.sampleIndex : -1,
        ),
        formulaResult,
        ...(sampled.pathError === undefined ? {} : { pathError: sampled.pathError }),
        ...(sampled.launchAngleRadians === undefined
          ? {}
          : {
              secondOrderLaunchAngle: {
                degrees: (sampled.launchAngleRadians * 180) / Math.PI,
                radians: sampled.launchAngleRadians,
              },
            }),
        ...(hasTargetMissWarning ? { hasTargetMissWarning: true } : {}),
        ...(warningReason ? { warningReason } : {}),
        trajectoryPoints: snapshotGraphwarVisibleTrajectoryPoints(
          sampled.visiblePixels,
          sampled.obstacle.type === "hit" ? sampled.obstacle.sampleIndex : -1,
        ),
      },
    };
  } catch (error) {
    if (isGraphwarWasmFault(error)) {
      throw error;
    }
    return createFailureOutcome("trajectory", error);
  }
}

/** Maps the WASM stop discriminator to the public warning contract without treating normal stops as faults. */
function resolveWasmWarningReason(
  stopReason: number,
  targetHitIndex: number,
  obstacleHitIndex: number,
): GraphwarTrajectoryWarningReason | undefined {
  if (obstacleHitIndex >= 0 && !(targetHitIndex >= 0 && obstacleHitIndex >= targetHitIndex)) {
    return "obstacle";
  }
  if (targetHitIndex >= 0) {
    return undefined;
  }
  if (stopReason === 3) {
    return "max-steps";
  }
  if (stopReason === 4) {
    return "out-of-bounds";
  }
  if (stopReason === 5) {
    return "too-steep";
  }
  if (stopReason === 2) {
    return "invalid";
  }
  return undefined;
}

/** Runs simulator expression arithmetic through the canonical WASM expression VM while retaining Java step/stop policy. */
function calculateSimulatorTrajectoryWithWasm(
  runtime: GraphwarWasmKernelRuntime,
  input: Extract<GraphwarTrajectoryCalculationInput, { type: "simulator" }>,
): GraphwarTrajectoryCalculationOutcome {
  try {
    const program = parseGraphwarExpressionProgram(input.expression, input.parser);
    if (!program) {
      return calculateSimulatorTrajectory(input);
    }
    const evaluateExpression = (x: number, y: number, dy: number) => {
      const values = runGraphwarWasmExpressionBatch(runtime, {
        program,
        values: [{ dy, x, y }],
      });
      return values[0] ?? Number.NaN;
    };
    const sampleResult = sampleGraphwarExpressionTrajectoryWithStopsAndEvaluator(
      {
        bounds: input.bounds,
        boundsRect: input.boundsRect,
        ...(input.collision ? { collision: input.collision } : {}),
        collectVisiblePixels: true,
        equation: input.equation,
        expression: input.expression,
        ...(input.launchAngleRadians === undefined ? {} : { launchAngleRadians: input.launchAngleRadians }),
        ...(input.parser ? { parser: input.parser } : {}),
        soldierCenter: input.soldierCenter,
      },
      evaluateExpression,
    );
    const warningReason = resolveWarningReason(sampleResult, -1, sampleResult.obstacleHitIndex);
    return {
      ok: true,
      result: {
        curvePoints: formatVisibleTrajectoryPoints(sampleResult.visiblePixels, sampleResult.obstacleHitIndex),
        trajectoryPoints: snapshotGraphwarVisibleTrajectoryPoints(
          sampleResult.visiblePixels,
          sampleResult.obstacleHitIndex,
        ),
        ...(warningReason ? { warningReason } : {}),
      },
    };
  } catch (error) {
    if (isGraphwarWasmFault(error)) {
      throw error;
    }
    return createFailureOutcome("trajectory", error);
  }
}

/** 分阶段解算求解器输入，让公式生成与轨迹模拟异常保留各自的页面错误语义。 */
function calculateSolverTrajectory(
  input: Extract<GraphwarTrajectoryCalculationInput, { type: "solver" }>,
  formulaMode: GraphwarTrajectoryFormulaMode,
): GraphwarTrajectoryCalculationOutcome {
  let resolved: ReturnType<typeof resolveGraphwarTrajectory>;
  let launchAngleRadians: number;
  try {
    if (input.points.length < 2) {
      throw new Error("At least two solver points are required.");
    }

    resolved = resolveGraphwarTrajectory({
      bounds: input.bounds,
      boundsRect: input.boundsRect,
      ...(input.collision ? { collision: input.collision } : {}),
      collectVisiblePixels: true,
      formulaMode,
      points: input.points,
      qualityPoints: input.points.slice(1, input.target ? -1 : input.points.length),
      soldierCenter: input.points[0],
      // 主轨迹必须继续画到自然停止点；目标只记录首次命中，不能为了统计截短曲线。
      stopOnTargetsComplete: false,
      ...(input.target
        ? {
            targetHitRadiusPixels: input.target.hitRadiusPixels,
            targetPoint: input.target.point,
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
    const obstacleHitPoint =
      sampleResult.obstacleHitIndex >= 0 ? sampleResult.visiblePixels[sampleResult.obstacleHitIndex] : undefined;
    // 目标圆右边界前的碰撞会阻止继续命中；越过该边界后的碰撞不能掩盖真实轨迹偏差。
    const hasTargetMissWarning =
      input.target !== undefined &&
      sampleResult.targetHitIndex < 0 &&
      (!obstacleHitPoint || obstacleHitPoint.x >= input.target.point.x + input.target.hitRadiusPixels);
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
              secondOrderLaunchAngle: {
                degrees: (launchAngleRadians * 180) / Math.PI,
                radians: launchAngleRadians,
              },
            }
          : {}),
        ...(hasTargetMissWarning ? { hasTargetMissWarning: true } : {}),
        trajectoryPoints: snapshotGraphwarVisibleTrajectoryPoints(
          sampleResult.visiblePixels,
          sampleResult.obstacleHitIndex,
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
        trajectoryPoints: snapshotGraphwarVisibleTrajectoryPoints(
          sampleResult.visiblePixels,
          sampleResult.obstacleHitIndex,
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
  if (isGraphwarWasmFault(error)) {
    throw error;
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    ok: false,
    stage,
  };
}
