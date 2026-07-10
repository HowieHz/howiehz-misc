import { computed, nextTick, ref, watch } from "vue";

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
import type {
  GraphwarTrajectoryCollisionSettings,
  GraphwarTrajectoryFormulaSettings,
} from "../../formula/trajectory/sampling";
import {
  type GraphwarTrajectoryCalculationFailureStage,
  type GraphwarTrajectoryCalculationInput,
  type GraphwarTrajectoryCalculationResult,
  type GraphwarTrajectoryWarningReason,
} from "./trajectory-calculation";
import { createGraphwarTrajectoryRunner, isGraphwarTrajectoryCancelledError } from "./trajectory-runner";

export type { GraphwarTrajectoryWarningReason } from "./trajectory-calculation";

interface ReadonlyRef<T> {
  readonly value: T;
}

export type GraphwarTrajectoryCalculationStatus =
  | { type: "idle" }
  | { type: "in-progress" }
  | { elapsedMs: number; type: "success" }
  | { message: string; stage: GraphwarTrajectoryCalculationFailureStage; type: "failure" };

interface PublishedTrajectoryResult {
  /** 当前画布展示的完整轨迹快照。 */
  displayedTrajectory?: PublishedTrajectorySnapshot;
  /** 模拟器最后一次成功的完整轨迹。 */
  simulatorTrajectory?: PublishedTrajectorySnapshot;
  /** 求解器最后一次成功的完整结果；公式、角度和轨迹必须成组保留。 */
  solver?: {
    formulaResult: FormulaResult;
    secondOrderLaunchAngleDegrees?: number;
    trajectory: PublishedTrajectorySnapshot;
  };
}

type PublishedTrajectorySnapshot = Pick<GraphwarTrajectoryCalculationResult, "curvePoints" | "warningReason">;

interface GraphwarTrajectoryResultOptions {
  /** 碰撞采样应使用页面当前障碍和边界收缩配置。 */
  getCollisionSettings: () => GraphwarTrajectoryCollisionSettings | undefined;
  /** 模拟容差无效时不能把缺失碰撞设置误当成“无障碍”。 */
  collisionSettingsValid: ReadonlyRef<boolean>;
  /** 坐标映射由页面统一提供，避免轨迹 Module 自行读取输入框文本。 */
  geometry: {
    /** 当前截图坐标系矩形。 */
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
    /** Step 漏洞模式是否启用；只有 y'= 模式和存在障碍 mask 时会生效。 */
    stepGlitchModeEnabled: ReadonlyRef<boolean>;
    /** Step 漏洞模式近似探测普通 sigmoid 路径区域时使用的模拟 mask。 */
    getStepGlitchObstacleMask: () => Uint8Array | undefined;
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
  /** 当前计算 Worker 已永久降级到主线程时的具体原因。 */
  calculationFallbackReason: ReadonlyRef<string>;
  /** 当前主公式和轨迹计算状态。 */
  calculationStatus: ReadonlyRef<GraphwarTrajectoryCalculationStatus>;
  /** 创建像素路径验证入口使用的公式采样设置。 */
  createPathTrajectoryFormulaSettings: () => GraphwarTrajectoryFormulaSettings;
  /** 页面卸载时取消任务、计时器并关闭常驻 Worker。 */
  dispose: () => void;
  /** 有效小数位；无效输入时回退到页面默认值。 */
  formulaOutputDecimalPlaces: ReadonlyRef<number>;
  /** 最后一次完整成功的求解器公式；模拟器计算不会覆盖该快照。 */
  formulaResult: ReadonlyRef<FormulaResult | undefined>;
  /** 当前公式采样设置。 */
  graphwarTrajectoryFormulaSettings: ReadonlyRef<GraphwarTrajectoryFormulaSettings>;
  /** 最后一次完整成功的求解器二阶发射角，单位为度。 */
  secondOrderLaunchAngleDegrees: ReadonlyRef<number | undefined>;
  /** 模拟器二阶发射角，单位为弧度。 */
  simulatorLaunchAngleRadians: ReadonlyRef<number | undefined>;
  /** 当前工作流恢复或新计算成功的主轨迹 SVG polyline points。 */
  plottedCurvePoints: ReadonlyRef<string>;
  /** 当前展示轨迹的提示原因。 */
  trajectoryWarningReason: ReadonlyRef<GraphwarTrajectoryWarningReason | undefined>;
}

const trajectoryCalculationSuccessVisibleMs = 2000;

/** 管理公式设置、异步主轨迹计算、原子结果和计算状态。 */
export function useGraphwarTrajectoryResult(
  options: GraphwarTrajectoryResultOptions,
): GraphwarTrajectoryResultController {
  const formulaOutputDecimalPlaces = computed(() => options.settings.precisionDecimalPlaces.value);
  const formulaSteepness = computed(() => options.settings.steepness.value);
  const simulatorLaunchAngleRadians = computed(() => {
    if (options.settings.equationMode.value !== "ddy") {
      return undefined;
    }
    const angle = options.simulator.parseNumber(options.simulator.launchAngleText.value);
    return angle === undefined ? undefined : (angle * Math.PI) / 180;
  });
  const graphwarTrajectoryFormulaSettings = computed<GraphwarTrajectoryFormulaSettings>(() => {
    const stepGlitchMode =
      options.settings.stepGlitchModeEnabled.value &&
      options.settings.algorithmMode.value === "step" &&
      options.settings.equationMode.value === "dy";
    const stepGlitchObstacleMask = stepGlitchMode ? options.settings.getStepGlitchObstacleMask() : undefined;
    return {
      algorithm: options.settings.algorithmMode.value,
      decimalPlaces: formulaOutputDecimalPlaces.value,
      equation: options.settings.equationMode.value,
      formulaPathSteepness: formulaSteepness.value,
      steepness: formulaSteepness.value,
      stepGlitchMode,
      ...(stepGlitchObstacleMask ? { stepGlitchObstacleMask } : {}),
      stepOverflowProtection: options.settings.stepOverflowProtectionEnabled.value,
    };
  });

  const calculationFallbackReason = ref("");
  const calculationStatus = ref<GraphwarTrajectoryCalculationStatus>({ type: "idle" });
  const publishedResult = ref<PublishedTrajectoryResult>({});
  const formulaResult = computed(() => publishedResult.value.solver?.formulaResult);
  const plottedCurvePoints = computed(() => publishedResult.value.displayedTrajectory?.curvePoints ?? "");
  const secondOrderLaunchAngleDegrees = computed(() => publishedResult.value.solver?.secondOrderLaunchAngleDegrees);
  const trajectoryWarningReason = computed(() => publishedResult.value.displayedTrajectory?.warningReason);
  const trajectoryCalculationInput = computed(createTrajectoryCalculationInput);
  const runner = createGraphwarTrajectoryRunner({
    onFallback: (reason) => {
      calculationFallbackReason.value ||= reason;
    },
    waitForFallbackPaint,
  });
  let activeGeneration = 0;
  let pendingFrame: number | undefined;
  let pendingInput: GraphwarTrajectoryCalculationInput | undefined;
  let successTimer: ReturnType<typeof setTimeout> | undefined;

  watch(
    trajectoryCalculationInput,
    (input) => {
      activeGeneration += 1;
      runner.cancel();
      clearSuccessTimer();
      if (!input) {
        cancelPendingFrame();
        pendingInput = undefined;
        calculationStatus.value = { type: "idle" };
        clearCalculatedResult(options.settings.toolWorkflowMode.value);
        return;
      }

      // 切换工作流时先恢复其完整快照，避免等待新任务期间展示另一工作流的轨迹。
      const current = publishedResult.value;
      const trajectory = input.type === "solver" ? current.solver?.trajectory : current.simulatorTrajectory;
      if (trajectory && current.displayedTrajectory !== trajectory) {
        publishedResult.value = {
          ...current,
          displayedTrajectory: trajectory,
        };
      }
      calculationStatus.value = { type: "in-progress" };
      pendingInput = input;
      // 一帧内只投递最后一份输入，避免连续编辑反复轮换 Worker。
      if (pendingFrame === undefined) {
        if (typeof requestAnimationFrame === "undefined") {
          startPendingCalculation();
        } else {
          pendingFrame = requestAnimationFrame(() => {
            pendingFrame = undefined;
            startPendingCalculation();
          });
        }
      }
    },
    { immediate: true },
  );

  /** 像素路径验证仍需同步读取轻量公式设置，不能等待主轨迹 Worker。 */
  function createPathTrajectoryFormulaSettings(): GraphwarTrajectoryFormulaSettings {
    return graphwarTrajectoryFormulaSettings.value;
  }

  /** 取走当前帧合并后的输入，并只允许对应 generation 发布异步结果。 */
  function startPendingCalculation() {
    const input = pendingInput;
    pendingInput = undefined;
    if (!input) {
      return;
    }

    const generation = activeGeneration;
    void runner
      .run(input)
      .then(({ elapsedMs, outcome }) => {
        if (generation !== activeGeneration) {
          return;
        }
        if (!outcome.ok) {
          clearCalculatedResult(input.type);
          calculationStatus.value = {
            message: outcome.message,
            stage: outcome.stage,
            type: "failure",
          };
          return;
        }

        if (!publishCalculatedResult(input.type, outcome.result)) {
          calculationStatus.value = {
            message: "The solver returned no formula result.",
            stage: "formula",
            type: "failure",
          };
          return;
        }
        calculationStatus.value = { elapsedMs, type: "success" };
        successTimer = setTimeout(() => {
          if (generation === activeGeneration && calculationStatus.value.type === "success") {
            calculationStatus.value = { type: "idle" };
          }
          successTimer = undefined;
        }, trajectoryCalculationSuccessVisibleMs);
      })
      .catch((error: unknown) => {
        if (generation !== activeGeneration || isGraphwarTrajectoryCancelledError(error)) {
          return;
        }
        clearCalculatedResult(input.type);
        calculationStatus.value = {
          message: error instanceof Error ? error.message : String(error),
          stage: "trajectory",
          type: "failure",
        };
      });
  }

  /** 从当前工作流构造可结构化克隆的完整输入；无效页面状态直接停留在空结果。 */
  function createTrajectoryCalculationInput(): GraphwarTrajectoryCalculationInput | undefined {
    const bounds = options.geometry.getBounds();
    if (!bounds || !options.collisionSettingsValid.value) {
      return undefined;
    }

    const collision = options.getCollisionSettings();
    const base = {
      bounds,
      boundsRect: options.geometry.boundsRect.value,
      ...(collision ? { collision } : {}),
    };
    if (options.settings.toolWorkflowMode.value === "simulator") {
      const soldierCenter = options.path.mappedPathPoints.value[0];
      const expression = options.simulator.formulaText.value;
      if (
        !soldierCenter ||
        !expression.trim() ||
        (options.settings.equationMode.value === "ddy" && simulatorLaunchAngleRadians.value === undefined)
      ) {
        return undefined;
      }
      return {
        ...base,
        equation: options.settings.equationMode.value,
        expression,
        ...(simulatorLaunchAngleRadians.value === undefined
          ? {}
          : { launchAngleRadians: simulatorLaunchAngleRadians.value }),
        parser: {
          parseDerivativeAsY: options.simulator.parseDerivativeAsY.value,
          skipUnknownCharacters: options.simulator.skipUnknownCharacters.value,
        },
        soldierCenter,
        type: "simulator",
      };
    }

    const points = options.path.mappedPathPoints.value;
    if (
      points.length < 2 ||
      !options.settings.precisionValid.value ||
      (options.settings.algorithmMode.value === "step" && !options.settings.steepnessValid.value) ||
      (options.settings.algorithmMode.value === "abs" && options.settings.equationMode.value === "ddy") ||
      options.settings.isEquationModeDisabled(options.settings.equationMode.value)
    ) {
      return undefined;
    }

    const targetPoint = options.path.pathPixels.value.at(-1);
    const targetHitRadiusPixels = options.getTargetHitRadiusPixels();
    return {
      ...base,
      points,
      settings: graphwarTrajectoryFormulaSettings.value,
      ...(targetPoint ? { targetPoint } : {}),
      ...(targetHitRadiusPixels === undefined ? {} : { targetHitRadiusPixels }),
      type: "solver",
    };
  }

  /** 一次发布完整结果，避免公式、角度、轨迹和警告被观察到中间状态。 */
  function publishCalculatedResult(
    inputType: GraphwarTrajectoryCalculationInput["type"],
    result: GraphwarTrajectoryCalculationResult,
  ) {
    const trajectory = {
      curvePoints: result.curvePoints,
      ...(result.warningReason === undefined ? {} : { warningReason: result.warningReason }),
    };
    if (inputType === "simulator") {
      publishedResult.value = {
        ...(publishedResult.value.solver ? { solver: publishedResult.value.solver } : {}),
        displayedTrajectory: trajectory,
        simulatorTrajectory: trajectory,
      };
      return true;
    }
    if (!result.formulaResult) {
      clearCalculatedResult("solver");
      return false;
    }

    publishedResult.value = {
      displayedTrajectory: trajectory,
      ...(publishedResult.value.simulatorTrajectory
        ? { simulatorTrajectory: publishedResult.value.simulatorTrajectory }
        : {}),
      solver: {
        formulaResult: result.formulaResult,
        ...(result.secondOrderLaunchAngleDegrees === undefined
          ? {}
          : { secondOrderLaunchAngleDegrees: result.secondOrderLaunchAngleDegrees }),
        trajectory,
      },
    };
    return true;
  }

  /** 当前工作流结果失效时清除该快照，保留另一工作流供用户返回。 */
  function clearCalculatedResult(inputType: GraphwarTrajectoryCalculationInput["type"]) {
    const current = publishedResult.value;
    publishedResult.value =
      inputType === "solver"
        ? current.simulatorTrajectory
          ? { simulatorTrajectory: current.simulatorTrajectory }
          : {}
        : current.solver
          ? { solver: current.solver }
          : {};
  }

  /** 取消尚未投递的帧任务，防止空输入或卸载后继续启动 Worker。 */
  function cancelPendingFrame() {
    if (pendingFrame === undefined) {
      return;
    }
    if (typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(pendingFrame);
    }
    pendingFrame = undefined;
  }

  /** 清除上一轮成功提示计时，避免旧计时器覆盖新计算状态。 */
  function clearSuccessTimer() {
    if (successTimer === undefined) {
      return;
    }
    clearTimeout(successTimer);
    successTimer = undefined;
  }

  /** 双帧等待跨过一次实际绘制，避免主线程长任务抢在状态提示上屏前执行。 */
  async function waitForFallbackPaint() {
    await nextTick();
    if (typeof requestAnimationFrame === "undefined") {
      return;
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }

  /** 页面卸载时使迟到结果失效，并释放帧、计时器和 Worker。 */
  function dispose() {
    activeGeneration += 1;
    pendingInput = undefined;
    cancelPendingFrame();
    clearSuccessTimer();
    runner.close();
  }

  return {
    calculationFallbackReason,
    calculationStatus,
    createPathTrajectoryFormulaSettings,
    dispose,
    formulaOutputDecimalPlaces,
    formulaResult,
    graphwarTrajectoryFormulaSettings,
    plottedCurvePoints,
    secondOrderLaunchAngleDegrees,
    simulatorLaunchAngleRadians,
    trajectoryWarningReason,
  };
}
