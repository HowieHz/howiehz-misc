import { computed } from "vue";

import { formatSvgNumber } from "../../core/numbers";
import type {
  AlgorithmMode,
  BoundsRect,
  EquationMode,
  FormulaResult,
  GraphBounds,
  GraphPoint,
  PixelPoint,
  ToolWorkflowMode,
} from "../../core/types";
import {
  createGraphwarTrajectoryFormulaContext,
  findGraphwarTrajectoryTargetHitIndex,
  getGraphwarTrajectoryLaunchAngle,
  sampleGraphwarExpressionTrajectoryWithStops,
  sampleGraphwarFormulaTrajectory,
  type GraphwarTrajectoryCollisionSettings,
  type GraphwarTrajectoryFormulaSettings,
} from "../../formula/trajectory/sampling";

interface ReadonlyRef<T> {
  readonly value: T;
}

/** 轨迹结果提示原因；页面应负责把原因映射成本地化文案。 */
export type GraphwarTrajectoryWarningReason = "invalid" | "max-steps" | "obstacle" | "out-of-bounds" | "too-steep";

interface GraphwarTrajectoryResultOptions {
  /** 碰撞采样应使用页面当前障碍和边界收缩配置。 */
  getCollisionSettings: () => GraphwarTrajectoryCollisionSettings | undefined;
  /** 坐标映射由页面统一提供，避免轨迹 Module 自行读取输入框文本。 */
  geometry: {
    /** 当前截图棋盘矩形。 */
    boundsRect: ReadonlyRef<BoundsRect>;
    /** 当前有效 Graphwar 坐标范围；无效时应保持原来的空结果语义。 */
    getBounds: () => GraphBounds | undefined;
  };
  /** 公式生成和采样设置。 */
  settings: {
    /** 当前公式算法。 */
    algorithmMode: ReadonlyRef<AlgorithmMode>;
    /** 当前 Graphwar 公式解释模式。 */
    equationMode: ReadonlyRef<EquationMode>;
    /** 判断当前公式模式是否被页面禁用。 */
    isEquationModeDisabled: (mode: EquationMode) => boolean;
    /** 公式输出小数位；无效输入时应使用页面默认值。 */
    precisionDecimalPlaces: ReadonlyRef<number>;
    /** 公式输出小数位是否来自合法输入。 */
    precisionValid: ReadonlyRef<boolean>;
    /** Step 陡峭度；无效输入时应使用页面默认值。 */
    steepness: ReadonlyRef<number>;
    /** Step 陡峭度是否来自合法输入。 */
    steepnessValid: ReadonlyRef<boolean>;
    /** 是否允许 Step 公式启用 exp 抗溢出保护。 */
    stepOverflowProtectionEnabled: ReadonlyRef<boolean>;
    /** 当前工具工作流。 */
    toolWorkflowMode: ReadonlyRef<ToolWorkflowMode>;
  };
  /** 模拟器表达式输入和解析策略。 */
  simulator: {
    /** 用户输入的模拟器表达式。 */
    formulaText: ReadonlyRef<string>;
    /** 用户输入的二阶发射角，单位为度。 */
    launchAngleText: ReadonlyRef<string>;
    /** 是否把导数 token 解析为 y。 */
    parseDerivativeAsY: ReadonlyRef<boolean>;
    /** 页面统一的数字解析策略。 */
    parseNumber: (value: string) => number | undefined;
    /** 是否跳过未知字符。 */
    skipUnknownCharacters: ReadonlyRef<boolean>;
  };
  /** 当前路径点数据。 */
  path: {
    /** 当前路径的 Graphwar 坐标。 */
    mappedPathPoints: ReadonlyRef<readonly GraphPoint[]>;
    /** 当前路径的截图像素坐标。 */
    pathPixels: ReadonlyRef<readonly PixelPoint[]>;
  };
  /** 默认目标命中半径，单位为截图像素；无有效 bounds 时不可用。 */
  getTargetHitRadiusPixels: () => number | undefined;
}

export interface GraphwarTrajectoryResultController {
  /** 创建像素路径验证入口使用的公式采样设置。 */
  createPathTrajectoryFormulaSettings: () => GraphwarTrajectoryFormulaSettings;
  /** 有效小数位；无效输入时回退到页面默认值。 */
  formulaOutputDecimalPlaces: ReadonlyRef<number>;
  /** 当前公式生成结果；无效配置或模拟器模式返回 undefined。 */
  formulaResult: ReadonlyRef<FormulaResult | undefined>;
  /** 当前公式采样设置。 */
  graphwarTrajectoryFormulaSettings: ReadonlyRef<GraphwarTrajectoryFormulaSettings>;
  /** 当前二阶发射角，单位为度。 */
  secondOrderLaunchAngleDegrees: ReadonlyRef<number | undefined>;
  /** 模拟器二阶发射角，单位为弧度。 */
  simulatorLaunchAngleRadians: ReadonlyRef<number | undefined>;
  /** 当前主轨迹 SVG polyline points。 */
  plottedCurvePoints: ReadonlyRef<string>;
  /** 轨迹提示原因；页面应负责映射本地化文本。 */
  trajectoryWarningReason: ReadonlyRef<GraphwarTrajectoryWarningReason | undefined>;
}

/** 管理公式生成、模拟器采样和主轨迹命中/障碍结果。 */
export function useGraphwarTrajectoryResult(
  options: GraphwarTrajectoryResultOptions,
): GraphwarTrajectoryResultController {
  const formulaOutputDecimalPlaces = computed(() => options.settings.precisionDecimalPlaces.value);
  const formulaSteepness = computed(() => options.settings.steepness.value);
  const graphwarTrajectoryFormulaSettings = computed<GraphwarTrajectoryFormulaSettings>(() => ({
    algorithm: options.settings.algorithmMode.value,
    decimalPlaces: formulaOutputDecimalPlaces.value,
    equation: options.settings.equationMode.value,
    formulaPathSteepness: formulaSteepness.value,
    steepness: formulaSteepness.value,
    stepOverflowProtection: options.settings.stepOverflowProtectionEnabled.value,
  }));

  const graphwarTrajectoryFormulaContext = computed(() => {
    const bounds = options.geometry.getBounds();
    if (!bounds) {
      return undefined;
    }
    return createGraphwarTrajectoryFormulaContext({
      bounds,
      points: options.path.mappedPathPoints.value,
      settings: graphwarTrajectoryFormulaSettings.value,
      soldierCenter: options.path.mappedPathPoints.value[0],
    });
  });

  function createPathTrajectoryFormulaSettings(): GraphwarTrajectoryFormulaSettings {
    return graphwarTrajectoryFormulaSettings.value;
  }

  const formulaResult = computed(() => {
    if (options.settings.toolWorkflowMode.value !== "solver") {
      return undefined;
    }
    const context = graphwarTrajectoryFormulaContext.value;
    if (!context || context.formulaPoints.length < 2) {
      return undefined;
    }
    if (options.settings.algorithmMode.value === "step" && !options.settings.steepnessValid.value) {
      return undefined;
    }
    if (!options.settings.precisionValid.value) {
      return undefined;
    }
    if (options.settings.algorithmMode.value === "abs" && options.settings.equationMode.value === "ddy") {
      return undefined;
    }
    if (options.settings.isEquationModeDisabled(options.settings.equationMode.value)) {
      return undefined;
    }

    // UI 展示和复制应直接复用采样上下文里的最终文本，避免同一热路径重复格式化公式材料。
    return context.formulaResult;
  });

  const secondOrderLaunchAngleDegrees = computed(() => {
    const context = graphwarTrajectoryFormulaContext.value;
    if (
      options.settings.equationMode.value !== "ddy" ||
      options.settings.toolWorkflowMode.value !== "solver" ||
      options.settings.isEquationModeDisabled(options.settings.equationMode.value) ||
      (options.settings.algorithmMode.value === "step" && !options.settings.steepnessValid.value) ||
      !context ||
      context.formulaPoints.length < 2
    ) {
      return undefined;
    }

    const angle = (getGraphwarTrajectoryLaunchAngle(context, options.path.mappedPathPoints.value[0]) * 180) / Math.PI;
    return Number.isFinite(angle) ? angle : undefined;
  });

  const simulatorLaunchAngleRadians = computed(() => {
    if (options.settings.equationMode.value !== "ddy") {
      return undefined;
    }
    const angle = options.simulator.parseNumber(options.simulator.launchAngleText.value);
    return angle === undefined ? undefined : (angle * Math.PI) / 180;
  });

  const trajectoryValidationTargetPoint = computed(() =>
    options.settings.toolWorkflowMode.value === "solver" && options.path.pathPixels.value.length >= 2
      ? options.path.pathPixels.value.at(-1)
      : undefined,
  );

  const trajectorySampleResult = computed(() => {
    const bounds = options.geometry.getBounds();
    if (options.settings.toolWorkflowMode.value === "simulator") {
      if (!bounds || options.path.mappedPathPoints.value.length < 1 || !options.simulator.formulaText.value.trim()) {
        return undefined;
      }

      return sampleGraphwarExpressionTrajectoryWithStops({
        bounds,
        boundsRect: options.geometry.boundsRect.value,
        collision: options.getCollisionSettings(),
        collectVisiblePixels: true,
        equation: options.settings.equationMode.value,
        expression: options.simulator.formulaText.value,
        launchAngleRadians: simulatorLaunchAngleRadians.value,
        parser: {
          parseDerivativeAsY: options.simulator.parseDerivativeAsY.value,
          skipUnknownCharacters: options.simulator.skipUnknownCharacters.value,
        },
        soldierCenter: options.path.mappedPathPoints.value[0],
      });
    }

    const context = graphwarTrajectoryFormulaContext.value;
    if (
      !formulaResult.value ||
      !bounds ||
      (options.settings.algorithmMode.value === "step" && !options.settings.steepnessValid.value) ||
      !context ||
      context.formulaPoints.length < 2
    ) {
      return undefined;
    }

    return sampleGraphwarFormulaTrajectory({
      bounds,
      boundsRect: options.geometry.boundsRect.value,
      collision: options.getCollisionSettings(),
      collectVisiblePixels: true,
      context,
    });
  });
  const trajectorySample = computed(() => trajectorySampleResult.value?.sample);

  const trajectoryTargetHitIndex = computed(() => {
    const bounds = options.geometry.getBounds();
    const sample = trajectorySample.value;
    const targetPoint = trajectoryValidationTargetPoint.value;
    const targetHitRadiusPixels = options.getTargetHitRadiusPixels();
    if (!sample || !bounds || !targetPoint || targetHitRadiusPixels === undefined) {
      return -1;
    }

    return findGraphwarTrajectoryTargetHitIndex({
      bounds,
      boundsRect: options.geometry.boundsRect.value,
      points: sample.points,
      targetHitRadiusPixels,
      targetPoint,
    });
  });

  const trajectoryObstacleHitIndex = computed(() => {
    const obstacleHitIndex = trajectorySampleResult.value?.obstacleHitIndex ?? -1;
    const targetHitIndex = trajectoryTargetHitIndex.value;
    // 目标之后才撞障碍不影响“当前路径命中目标”的提示。
    return targetHitIndex >= 0 && obstacleHitIndex >= targetHitIndex ? -1 : obstacleHitIndex;
  });

  const trajectoryWarningReason = computed<GraphwarTrajectoryWarningReason | undefined>(() => {
    if (trajectoryObstacleHitIndex.value >= 0) {
      return "obstacle";
    }
    if (trajectoryTargetHitIndex.value >= 0) {
      return undefined;
    }

    const stopReason = trajectorySample.value?.stopReason;
    if (!stopReason || stopReason === "completed" || stopReason === "unsupported" || stopReason === "stopped") {
      return undefined;
    }
    if (stopReason === "too-steep" || stopReason === "max-steps" || stopReason === "out-of-bounds") {
      return stopReason;
    }
    return "invalid";
  });

  const plottedCurvePoints = computed(() => {
    const result = trajectorySampleResult.value;
    return result ? formatVisibleTrajectoryPoints(result.visiblePixels, trajectoryObstacleHitIndex.value) : "";
  });

  return {
    createPathTrajectoryFormulaSettings,
    formulaOutputDecimalPlaces,
    formulaResult,
    graphwarTrajectoryFormulaSettings,
    plottedCurvePoints,
    secondOrderLaunchAngleDegrees,
    simulatorLaunchAngleRadians,
    trajectoryWarningReason,
  };
}

/** 将已映射到截图坐标的轨迹点格式化为 SVG polyline；hitIndex 指定目标或障碍截断位置。 */
export function formatVisibleTrajectoryPoints(points: readonly PixelPoint[], hitIndex: number) {
  const sampledPoints = hitIndex >= 0 ? points.slice(0, hitIndex + 1) : points;
  return sampledPoints.map((point) => `${formatSvgNumber(point.x)},${formatSvgNumber(point.y)}`).join(" ");
}
