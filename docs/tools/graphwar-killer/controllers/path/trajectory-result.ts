import { computed, nextTick, ref, watch } from "vue";

import type {
  AlgorithmMode,
  BoundsRect,
  EquationMode,
  FormulaResult,
  GraphBounds,
  GraphPoint,
  GraphwarSecondOrderLaunchAngleMode,
  PixelPoint,
  ReadonlyValue as ReadonlyRef,
  ToolWorkflowMode,
} from "../../core/types";
import { formulaModeUsesSteepness, formulaModeUsesStepGlitch } from "../../formula/generation/capabilities";
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

export type GraphwarTrajectoryCalculationStatus =
  | { type: "idle" }
  | { type: "in-progress" }
  | { elapsedMs: number; type: "success" }
  | { message: string; stage: GraphwarTrajectoryCalculationFailureStage; type: "failure" };

/** 同一公式、执行角和轨迹组成的原子结果；显示度数不能代替 Agent 使用的原始弧度。 */
interface PublishedFormulaTrajectoryResult {
  formulaResult: FormulaResult;
  secondOrderLaunchAngleMode?: GraphwarSecondOrderLaunchAngleMode;
  secondOrderLaunchAngleDegrees?: number;
  secondOrderLaunchAngleRadians?: number;
  trajectory: PublishedTrajectorySnapshot;
}

/** 页面一次发布的求解结果、轨迹和警告快照。 */
interface PublishedTrajectoryResult {
  /** 当前画布展示的完整轨迹快照。 */
  displayedTrajectory?: PublishedTrajectorySnapshot;
  /** 模拟器最后一次成功的完整轨迹。 */
  simulatorTrajectory?: PublishedTrajectorySnapshot;
  /** 求解器最后一次成功的完整结果；公式、角度和轨迹必须成组保留。 */
  solver?: PublishedFormulaTrajectoryResult;
  /** 一键清图搜索中的已验证公式预览；独立存放，取消预览即可恢复正式结果。 */
  incumbentPreview?: PublishedFormulaTrajectoryResult;
}

type PublishedTrajectorySnapshot = Pick<
  GraphwarTrajectoryCalculationResult,
  "curvePoints" | "pathError" | "targetMissed" | "warningReason"
>;

/** 轨迹结果控制器读取的页面设置、输入和状态依赖。 */
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
    /** Y''= 当前执行模型消费完整建议角，还是调用方指定的两位小数执行角。 */
    secondOrderLaunchAngleMode?: ReadonlyRef<GraphwarSecondOrderLaunchAngleMode>;
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
    /** 邪道模式是否启用；仅 Step ODE 生效，障碍 mask 只决定是否额外验证碰撞。 */
    stepGlitchModeEnabled: ReadonlyRef<boolean>;
    /** 邪道扫描和最终候选验证共用的模拟 mask。 */
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

/** 统一管理轨迹任务、已发布结果和页面展示状态的控制器。 */
export interface GraphwarTrajectoryResultController {
  /** 当前计算 Worker 已永久降级到主线程时的具体原因。 */
  calculationFallbackReason: ReadonlyRef<string>;
  /** 当前主公式和轨迹计算状态。 */
  calculationStatus: ReadonlyRef<GraphwarTrajectoryCalculationStatus>;
  /** 丢弃搜索公式预览并恢复此前的正式求解器结果。 */
  clearIncumbentPreview: () => void;
  /** 仅当已显示预览与待提交检查点一致时转为正式结果；不会重新采样公式。 */
  commitIncumbentPreview: (expression: string, launchAngleRadians?: number) => boolean;
  /** 提交已验证公式；匹配待绘制预览时复用该任务，否则直接发布无曲线结果。 */
  commitIncumbentResult: (expression: string, launchAngleRadians?: number) => void;
  /** 创建像素路径验证入口使用的公式采样设置。 */
  createPathTrajectoryFormulaSettings: () => GraphwarTrajectoryFormulaSettings;
  /** 页面卸载时取消任务、计时器并关闭常驻 Worker。 */
  dispose: () => void;
  /** 有效小数位；无效输入时回退到页面默认值。 */
  formulaOutputDecimalPlaces: ReadonlyRef<number>;
  /** 最后一次完整成功的求解器公式；模拟器计算不会覆盖该快照。 */
  formulaResult: ReadonlyRef<FormulaResult | undefined>;
  /** 当前是否由搜索 incumbent 覆盖正式求解器结果。 */
  incumbentPreviewActive: ReadonlyRef<boolean>;
  /** 当前公式采样设置。 */
  graphwarTrajectoryFormulaSettings: ReadonlyRef<GraphwarTrajectoryFormulaSettings>;
  /** 最后一次完整成功的求解器二阶发射角，单位为度。 */
  secondOrderLaunchAngleDegrees: ReadonlyRef<number | undefined>;
  /** 当前求解器结果实际验收的二阶发射角，单位为弧度；Agent 提交必须原样复用。 */
  secondOrderLaunchAngleRadians: ReadonlyRef<number | undefined>;
  /** 当前展示轨迹的普通控制点最大纵向误差。 */
  pathError: ReadonlyRef<number | undefined>;
  /** 模拟器二阶发射角，单位为弧度。 */
  simulatorLaunchAngleRadians: ReadonlyRef<number | undefined>;
  /** 当前工作流恢复或新计算成功的主轨迹 SVG polyline points。 */
  plottedCurvePoints: ReadonlyRef<string>;
  /** 直接采样主搜索已经验证的公式；latest-only 绘图不会阻塞寻路 Worker。 */
  publishIncumbentPreview: (expression: string, launchAngleRadians?: number) => void;
  /** 当前展示轨迹的提示原因。 */
  trajectoryWarningReason: ReadonlyRef<GraphwarTrajectoryWarningReason | undefined>;
  /** 当前展示的 Y''= 是否按显式两位小数执行角回放后未命中。 */
  targetMissed: ReadonlyRef<boolean>;
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
    const equation = options.settings.equationMode.value;
    const stepGlitchMode = formulaModeUsesStepGlitch(
      options.settings.algorithmMode.value,
      options.settings.equationMode.value,
      options.settings.stepGlitchModeEnabled.value,
    );
    const stepGlitchObstacleMask = stepGlitchMode ? options.settings.getStepGlitchObstacleMask() : undefined;
    return {
      algorithm: options.settings.algorithmMode.value,
      decimalPlaces: formulaOutputDecimalPlaces.value,
      equation,
      ...(equation === "ddy"
        ? { secondOrderLaunchAngleMode: options.settings.secondOrderLaunchAngleMode?.value ?? "full-precision" }
        : {}),
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
  const incumbentPreviewActive = computed(() => publishedResult.value.incumbentPreview !== undefined);
  const activeFormulaResult = computed(() => publishedResult.value.incumbentPreview ?? publishedResult.value.solver);
  const activeTrajectory = computed(
    () => publishedResult.value.incumbentPreview?.trajectory ?? publishedResult.value.displayedTrajectory,
  );
  const formulaResult = computed(() => activeFormulaResult.value?.formulaResult);
  const plottedCurvePoints = computed(() => activeTrajectory.value?.curvePoints ?? "");
  const secondOrderLaunchAngleDegrees = computed(() => activeFormulaResult.value?.secondOrderLaunchAngleDegrees);
  const secondOrderLaunchAngleRadians = computed(() => {
    const result = activeFormulaResult.value;
    if (
      !result ||
      result.secondOrderLaunchAngleMode !== graphwarTrajectoryFormulaSettings.value.secondOrderLaunchAngleMode
    ) {
      return undefined;
    }
    return result.secondOrderLaunchAngleRadians;
  });
  const pathError = computed(() => activeTrajectory.value?.pathError);
  const trajectoryWarningReason = computed(() => activeTrajectory.value?.warningReason);
  const targetMissed = computed(() => activeTrajectory.value?.targetMissed ?? false);
  const trajectoryCalculationInput = computed(createTrajectoryCalculationInput);
  const runner = createGraphwarTrajectoryRunner({
    onFallback: (reason) => {
      calculationFallbackReason.value ||= reason;
    },
    waitForFallbackPaint,
  });
  let activeGeneration = 0;
  let incumbentPreviewSolverHandoff = false;
  let pendingIncumbentPreview:
    | {
        commitOnPublish: boolean;
        expression: string;
        launchAngleRadians?: number;
        secondOrderLaunchAngleMode?: GraphwarSecondOrderLaunchAngleMode;
      }
    | undefined;
  let pendingFrame: number | undefined;
  let pendingInput: GraphwarTrajectoryCalculationInput | undefined;
  let skipNextSolverCalculation = false;
  let successTimer: ReturnType<typeof setTimeout> | undefined;

  watch(
    trajectoryCalculationInput,
    (input) => {
      if (input?.type === "solver" && skipNextSolverCalculation && pendingIncumbentPreview?.commitOnPublish) {
        // 控制点已经正式写回，但这份精确公式的展示采样仍可继续；不能由响应式路径更新把它取消。
        skipNextSolverCalculation = false;
        cancelPendingFrame();
        pendingInput = undefined;
        calculationStatus.value = { type: "idle" };
        return;
      }
      if (pendingIncumbentPreview?.commitOnPublish && publishedResult.value.incumbentPreview) {
        // 后续设置变化使待提交公式失效时，改由新的正式 solver 结果原子接管旧预览。
        incumbentPreviewSolverHandoff = true;
      }
      activeGeneration += 1;
      pendingIncumbentPreview = undefined;
      runner.cancel();
      clearSuccessTimer();
      if (input?.type === "solver" && skipNextSolverCalculation) {
        // 取消提升已经携带搜索验证过的完整公式；控制点写回只改变正式路径，不应再做一次展示回放。
        skipNextSolverCalculation = false;
        cancelPendingFrame();
        pendingInput = undefined;
        calculationStatus.value = { type: "idle" };
        return;
      }
      skipNextSolverCalculation = false;
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

  /**
   * 绘制一键清图主搜索自然产生的已验证公式。
   *
   * 这里故意只做展示采样，不从控制点重新解算公式，也不等待结果后再通知寻路；runner 的 latest-wins 语义会终止落后的绘图任务，避免高频 incumbent 排队拖慢页面。
   */
  function publishIncumbentPreview(expression: string, launchAngleRadians?: number) {
    const bounds = options.geometry.getBounds();
    const soldierCenter = options.path.mappedPathPoints.value[0];
    if (!bounds || !soldierCenter || !options.collisionSettingsValid.value || !expression.trim()) {
      return;
    }

    activeGeneration += 1;
    const generation = activeGeneration;
    cancelPendingFrame();
    pendingInput = undefined;
    clearSuccessTimer();
    calculationStatus.value = { type: "idle" };
    const secondOrderLaunchAngleMode = getIncumbentSecondOrderLaunchAngleMode(launchAngleRadians);
    const pendingPreview = {
      commitOnPublish: false,
      expression,
      ...(launchAngleRadians === undefined ? {} : { launchAngleRadians }),
      ...(secondOrderLaunchAngleMode === undefined ? {} : { secondOrderLaunchAngleMode }),
    };
    pendingIncumbentPreview = pendingPreview;
    // 新公式和新曲线必须原子上屏；等待期间保留上一完整快照，避免空窗或公式与曲线错配。
    const collision = options.getCollisionSettings();
    void runner
      .run({
        bounds,
        boundsRect: options.geometry.boundsRect.value,
        ...(collision ? { collision } : {}),
        equation: options.settings.equationMode.value,
        expression,
        ...(launchAngleRadians === undefined ? {} : { launchAngleRadians }),
        soldierCenter,
        type: "simulator",
      })
      .then(({ outcome }) => {
        if (generation !== activeGeneration || pendingIncumbentPreview !== pendingPreview) {
          return;
        }
        pendingIncumbentPreview = undefined;
        if (!outcome.ok) {
          if (pendingPreview.commitOnPublish) {
            publishCommittedIncumbentWithoutTrajectory(pendingPreview);
          }
          return;
        }
        const trajectory = createPublishedTrajectorySnapshot(outcome.result);
        const preview: PublishedFormulaTrajectoryResult = {
          formulaResult: { expression, terms: [] },
          ...(secondOrderLaunchAngleMode === undefined ? {} : { secondOrderLaunchAngleMode }),
          ...(launchAngleRadians === undefined
            ? {}
            : {
                secondOrderLaunchAngleDegrees: (launchAngleRadians * 180) / Math.PI,
                secondOrderLaunchAngleRadians: launchAngleRadians,
              }),
          trajectory,
        };
        publishedResult.value = pendingPreview.commitOnPublish
          ? {
              displayedTrajectory: trajectory,
              ...(publishedResult.value.simulatorTrajectory
                ? { simulatorTrajectory: publishedResult.value.simulatorTrajectory }
                : {}),
              solver: preview,
            }
          : { ...publishedResult.value, incumbentPreview: preview };
      })
      .catch((error: unknown) => {
        if (generation !== activeGeneration || pendingIncumbentPreview !== pendingPreview) {
          return;
        }
        pendingIncumbentPreview = undefined;
        if (isGraphwarTrajectoryCancelledError(error)) {
          return;
        }
        if (pendingPreview.commitOnPublish) {
          publishCommittedIncumbentWithoutTrajectory(pendingPreview);
        }
        // 预览失败不能降级主搜索或清除最后一条有效公式；下一条 incumbent 仍可继续覆盖。
      });
  }

  /** 终态预览采样失败时仍提交已验证公式和控制点，但不把旧曲线冒充为新公式轨迹。 */
  function publishCommittedIncumbentWithoutTrajectory(preview: {
    expression: string;
    launchAngleRadians?: number;
    secondOrderLaunchAngleMode?: GraphwarSecondOrderLaunchAngleMode;
  }) {
    publishedResult.value = {
      ...(publishedResult.value.simulatorTrajectory
        ? { simulatorTrajectory: publishedResult.value.simulatorTrajectory }
        : {}),
      solver: {
        formulaResult: { expression: preview.expression, terms: [] },
        ...(preview.launchAngleRadians === undefined
          ? {}
          : {
              secondOrderLaunchAngleDegrees: (preview.launchAngleRadians * 180) / Math.PI,
              secondOrderLaunchAngleMode: preview.secondOrderLaunchAngleMode ?? "full-precision",
              secondOrderLaunchAngleRadians: preview.launchAngleRadians,
            }),
        trajectory: { curvePoints: "" },
      },
    };
  }

  /** 搜索输入失效时只移除预览覆盖，正式求解器快照仍可继续显示。 */
  function clearIncumbentPreview() {
    if (!publishedResult.value.incumbentPreview && !pendingIncumbentPreview) {
      return;
    }
    activeGeneration += 1;
    incumbentPreviewSolverHandoff = false;
    pendingIncumbentPreview = undefined;
    skipNextSolverCalculation = false;
    runner.cancel();
    clearSuccessTimer();
    calculationStatus.value = { type: "idle" };
    const { incumbentPreview: _preview, ...formalResult } = publishedResult.value;
    publishedResult.value = formalResult;
  }

  /** 用户最终化当前结果时复用已经绘制的公式和轨迹，不为提交控制点再跑一次展示采样。 */
  function commitIncumbentPreview(expression: string, launchAngleRadians?: number) {
    const preview = publishedResult.value.incumbentPreview;
    const secondOrderLaunchAngleMode = getIncumbentSecondOrderLaunchAngleMode(launchAngleRadians);
    if (
      !preview ||
      preview.formulaResult.expression !== expression ||
      preview.secondOrderLaunchAngleMode !== secondOrderLaunchAngleMode ||
      preview.secondOrderLaunchAngleRadians !== launchAngleRadians
    ) {
      return false;
    }
    activeGeneration += 1;
    incumbentPreviewSolverHandoff = false;
    pendingIncumbentPreview = undefined;
    runner.cancel();
    clearSuccessTimer();
    calculationStatus.value = { type: "idle" };
    const { incumbentPreview: _preview, ...formalResult } = publishedResult.value;
    publishedResult.value = {
      ...formalResult,
      displayedTrajectory: preview.trajectory,
      solver: preview,
    };
    skipNextSolverCalculation = true;
    return true;
  }

  /** 复用匹配的待绘制预览；没有任务时只采样已验证表达式，不从控制点重算公式。 */
  function commitIncumbentResult(expression: string, launchAngleRadians?: number) {
    const secondOrderLaunchAngleMode = getIncumbentSecondOrderLaunchAngleMode(launchAngleRadians);
    if (commitPendingIncumbentPreview(expression, launchAngleRadians, secondOrderLaunchAngleMode)) {
      return;
    }

    publishIncumbentPreview(expression, launchAngleRadians);
    if (commitPendingIncumbentPreview(expression, launchAngleRadians, secondOrderLaunchAngleMode)) {
      return;
    }

    publishCommittedIncumbentWithoutTrajectory({
      expression,
      ...(launchAngleRadians === undefined ? {} : { launchAngleRadians }),
      ...(secondOrderLaunchAngleMode === undefined ? {} : { secondOrderLaunchAngleMode }),
    });
    skipNextSolverCalculation = true;
  }

  /** 把同一表达式的在途绘图任务标记为终态，路径写回后不得取消或重复采样。 */
  function commitPendingIncumbentPreview(
    expression: string,
    launchAngleRadians: number | undefined,
    secondOrderLaunchAngleMode: GraphwarSecondOrderLaunchAngleMode | undefined,
  ) {
    if (
      pendingIncumbentPreview?.expression !== expression ||
      pendingIncumbentPreview.secondOrderLaunchAngleMode !== secondOrderLaunchAngleMode ||
      pendingIncumbentPreview.launchAngleRadians !== launchAngleRadians
    ) {
      return false;
    }

    pendingIncumbentPreview.commitOnPublish = true;
    skipNextSolverCalculation = true;
    return true;
  }

  /** Incumbent 只有携带 Y'' 发射角时才需要绑定当前执行精度身份。 */
  function getIncumbentSecondOrderLaunchAngleMode(launchAngleRadians: number | undefined) {
    return launchAngleRadians === undefined
      ? undefined
      : (graphwarTrajectoryFormulaSettings.value.secondOrderLaunchAngleMode ?? "full-precision");
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

        if (!publishCalculatedResult(input, outcome.result)) {
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
      (formulaModeUsesSteepness(options.settings.algorithmMode.value, options.settings.equationMode.value) &&
        !options.settings.steepnessValid.value) ||
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
    input: GraphwarTrajectoryCalculationInput,
    result: GraphwarTrajectoryCalculationResult,
  ) {
    const trajectory = createPublishedTrajectorySnapshot(result);
    if (input.type === "simulator") {
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

    const preserveIncumbentPreview = !incumbentPreviewSolverHandoff && publishedResult.value.incumbentPreview;
    incumbentPreviewSolverHandoff = false;
    publishedResult.value = {
      displayedTrajectory: trajectory,
      ...(preserveIncumbentPreview ? { incumbentPreview: preserveIncumbentPreview } : {}),
      ...(publishedResult.value.simulatorTrajectory
        ? { simulatorTrajectory: publishedResult.value.simulatorTrajectory }
        : {}),
      solver: {
        formulaResult: result.formulaResult,
        ...(input.settings.equation === "ddy"
          ? { secondOrderLaunchAngleMode: input.settings.secondOrderLaunchAngleMode ?? "full-precision" }
          : {}),
        ...(result.secondOrderLaunchAngleDegrees === undefined
          ? {}
          : { secondOrderLaunchAngleDegrees: result.secondOrderLaunchAngleDegrees }),
        ...(result.secondOrderLaunchAngleRadians === undefined
          ? {}
          : { secondOrderLaunchAngleRadians: result.secondOrderLaunchAngleRadians }),
        trajectory,
      },
    };
    return true;
  }

  /** 当前工作流结果失效时清除该快照，保留另一工作流供用户返回。 */
  function clearCalculatedResult(inputType: GraphwarTrajectoryCalculationInput["type"]) {
    const current = publishedResult.value;
    if (inputType === "solver" && incumbentPreviewSolverHandoff && current.incumbentPreview) {
      // 最终 solver 异常时继续显示最后一条完整验证预览，不能退回空画布。
      incumbentPreviewSolverHandoff = false;
      return;
    }
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
    incumbentPreviewSolverHandoff = false;
    pendingIncumbentPreview = undefined;
    pendingInput = undefined;
    cancelPendingFrame();
    clearSuccessTimer();
    runner.close();
  }

  return {
    calculationFallbackReason,
    calculationStatus,
    clearIncumbentPreview,
    commitIncumbentResult,
    commitIncumbentPreview,
    createPathTrajectoryFormulaSettings,
    dispose,
    formulaOutputDecimalPlaces,
    formulaResult,
    graphwarTrajectoryFormulaSettings,
    incumbentPreviewActive,
    plottedCurvePoints,
    pathError,
    publishIncumbentPreview,
    secondOrderLaunchAngleDegrees,
    secondOrderLaunchAngleRadians,
    simulatorLaunchAngleRadians,
    trajectoryWarningReason,
    targetMissed,
  };
}

/** 把 Worker 结果收敛为可原子发布的轨迹快照，避免正式结果和 incumbent 漏传不同警告字段。 */
function createPublishedTrajectorySnapshot(result: GraphwarTrajectoryCalculationResult): PublishedTrajectorySnapshot {
  return {
    curvePoints: result.curvePoints,
    ...(result.pathError === undefined ? {} : { pathError: result.pathError }),
    ...(result.targetMissed === undefined ? {} : { targetMissed: result.targetMissed }),
    ...(result.warningReason === undefined ? {} : { warningReason: result.warningReason }),
  };
}
