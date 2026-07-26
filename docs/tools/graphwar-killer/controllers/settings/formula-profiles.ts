import { DEFAULT_FORMULA_DECIMAL_PLACES } from "../../core/numbers";
import { graphwarToolDefaults } from "../../core/tool/defaults";
import type { AlgorithmMode, EquationMode } from "../../core/types";
import { resolveFormulaModeDefinition } from "../../formula/mode-contract";
import { parseGraphwarFormulaPrecision, parseGraphwarFormulaSteepness } from "./validation";

/** 单个 Solver 游戏模式独立保留的公式偏好。 */
export interface GraphwarFormulaProfile {
  algorithm: AlgorithmMode;
  /** 当前游戏模式独立保留的“保留小数位”原始输入。 */
  precisionText: string;
  /** 当前游戏模式独立保留的“陡峭度 k”原始输入。 */
  steepnessText: string;
  /** 即使当前游戏模式或算法不消费该选项，也保留邪道模式偏好。 */
  isStepGlitchModeEnabled: boolean;
  /** 即使当前算法不消费该选项，也保留 Step 防溢出偏好。 */
  isStepOverflowProtectionEnabled: boolean;
}

/** 按 Graphwar 三种游戏模式分别保存的 Solver 公式偏好。 */
export interface GraphwarFormulaProfiles {
  y: GraphwarFormulaProfile;
  dy: GraphwarFormulaProfile;
  ddy: GraphwarFormulaProfile;
}

const defaultFormulaPreferences = {
  precisionText: String(DEFAULT_FORMULA_DECIMAL_PLACES),
  isStepGlitchModeEnabled: true,
  isStepOverflowProtectionEnabled: true,
  steepnessText: String(graphwarToolDefaults.steepness),
} as const;

/** 为会话创建全新默认值，避免调用方共享可变的 profile 对象。 */
export function createDefaultGraphwarFormulaProfiles(): GraphwarFormulaProfiles {
  return {
    y: { algorithm: "abs", ...defaultFormulaPreferences },
    dy: { algorithm: "step", ...defaultFormulaPreferences },
    /**
     * 二阶导游戏模式默认值来自保留 4 位小数的 soft Step Graphwar 兼容 RK4 整数扫描。
     *
     * 样例发射点为 `(-23.376623376623378, 2.5974025974025974)`，目标点为 `(-19 + 2i, -2i), i=0..7`。在扫描范围 `1..3000` 内，k=153 是目标 y
     * 误差均不超过 1px 的最大整数：最大误差为 0.99924px，而 k=154 会达到 1.00598px；末段平台延伸至 x=25 时的最大误差为 0.83838px。
     *
     * 每个目标 x 的 y 由相邻真实接受点线性插值得出，再按每游戏单位 `770 / 50` 像素换算；末段平台结果取 x=-5 至右边界 x=25 之间所有真实接受点的最大误差。
     *
     * 同一 profile 值也供双 ABS y'' 使用，但双 ABS 未参与本次扫描，不能继承该误差边界。对于 Step，这个样例折中会把满高跳变宽度从 k=210 时的 0.99752px 增加到 k=153 时的
     * 1.36915px，因此上述实测误差不是通用保证。
     */
    ddy: { algorithm: "step", ...defaultFormulaPreferences, steepnessText: "153" },
  };
}

/** 直接读取选中游戏模式的 profile，不复制也不耦合相邻配置。 */
export function getGraphwarFormulaProfile(profiles: GraphwarFormulaProfiles, equation: EquationMode) {
  return profiles[equation];
}

/** 只替换选中游戏模式的 profile，并保留所有未指定偏好。 */
export function updateGraphwarFormulaProfile(
  profiles: GraphwarFormulaProfiles,
  equation: EquationMode,
  update: Partial<GraphwarFormulaProfile>,
): GraphwarFormulaProfiles {
  const current = profiles[equation];
  return {
    ...profiles,
    [equation]: {
      algorithm: update.algorithm ?? current.algorithm,
      precisionText: update.precisionText ?? current.precisionText,
      steepnessText: update.steepnessText ?? current.steepnessText,
      isStepGlitchModeEnabled: update.isStepGlitchModeEnabled ?? current.isStepGlitchModeEnabled,
      isStepOverflowProtectionEnabled:
        update.isStepOverflowProtectionEnabled ?? current.isStepOverflowProtectionEnabled,
    },
  };
}

/** 按每个托管公式模式的实际设置档案校验其保留输入。 */
export function graphwarFormulaProfilesAreValidForManagedMode(profiles: GraphwarFormulaProfiles) {
  for (const equation of ["y", "dy", "ddy"] as const) {
    const profile = profiles[equation];
    if (
      parseGraphwarFormulaPrecision(profile.precisionText) === undefined ||
      (resolveFormulaModeDefinition(profile.algorithm, equation).formulaSettings.type !== "standard" &&
        parseGraphwarFormulaSteepness(profile.steepnessText) === undefined)
    ) {
      return false;
    }
  }
  return true;
}
