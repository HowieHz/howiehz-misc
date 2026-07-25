import type { AlgorithmMode, EquationMode } from "../core/types";

/** 穷尽 Graphwar Killer 当前四种公式算法与三种方程的合法组合。 */
export type FormulaModeKey = `${AlgorithmMode}:${EquationMode}`;

/** 轨迹层只选择现有的三种公式细化流程；具体方程数学仍留在数值内核。 */
export type FormulaRefinementProfile =
  | { readonly type: "direct" }
  | { readonly type: "position-compensation" }
  | { readonly type: "abs-second-derivative" };

/** 设置身份档案集中说明模式实际消费的公式参数。 */
export type FormulaSettingsProfile =
  | { readonly type: "standard" }
  | { readonly type: "steepness" }
  | { readonly type: "step" }
  | { readonly type: "step-ode" };

/** 追加控制点后能否继续复用旧公式前缀的物理状态。 */
export type FormulaAppendPrefixContinuation =
  | { readonly type: "physical-continuation" }
  | { readonly type: "cold-replay" };

/** 删除控制点对公式其余区段的影响范围。 */
export type FormulaDeleteInfluence = { readonly type: "adjacent-local" } | { readonly type: "global" };

/** 静态目录中的路径状态档案；可请求邪道的 Step ODE 仍以普通 Step 状态为基础。 */
export type FormulaPathSearchProfile =
  | { readonly type: "stateless" }
  | { readonly type: "step-stateful" }
  | { readonly type: "step-glitch-capable" };

/** 解析 request 后的原子路径策略；邪道生命周期不能拆成可独立启用的扫描或证据开关。 */
export type FormulaPathSearchPolicy =
  | { readonly type: "stateless" }
  | { readonly type: "step-stateful" }
  | { readonly type: "step-glitch" };

/** 单个合法公式模式的静态定义。 */
export interface FormulaModeDefinition {
  readonly algorithm: AlgorithmMode;
  readonly appendPrefixContinuation: FormulaAppendPrefixContinuation;
  readonly deleteInfluence: FormulaDeleteInfluence;
  readonly equation: EquationMode;
  readonly formulaRefinement: FormulaRefinementProfile;
  readonly formulaSettings: FormulaSettingsProfile;
  readonly pathSearchProfile: FormulaPathSearchProfile;
}

/** 页面或 Adapter 解析出的模式契约；单个内部 job 应沿调用链复用同一对象。 */
export interface FormulaModeContract extends FormulaModeDefinition {
  readonly pathSearchPolicy: FormulaPathSearchPolicy;
}

const DIRECT_REFINEMENT = { type: "direct" } as const satisfies FormulaRefinementProfile;
const POSITION_COMPENSATION = { type: "position-compensation" } as const satisfies FormulaRefinementProfile;
const ABS_SECOND_DERIVATIVE_REFINEMENT = {
  type: "abs-second-derivative",
} as const satisfies FormulaRefinementProfile;

const STANDARD_SETTINGS = { type: "standard" } as const satisfies FormulaSettingsProfile;
const STEEPNESS_SETTINGS = { type: "steepness" } as const satisfies FormulaSettingsProfile;
const STEP_SETTINGS = { type: "step" } as const satisfies FormulaSettingsProfile;
const STEP_ODE_SETTINGS = { type: "step-ode" } as const satisfies FormulaSettingsProfile;

const PHYSICAL_APPEND_CONTINUATION = {
  type: "physical-continuation",
} as const satisfies FormulaAppendPrefixContinuation;
const COLD_APPEND_REPLAY = { type: "cold-replay" } as const satisfies FormulaAppendPrefixContinuation;
const ADJACENT_LOCAL_DELETE = { type: "adjacent-local" } as const satisfies FormulaDeleteInfluence;
const GLOBAL_DELETE = { type: "global" } as const satisfies FormulaDeleteInfluence;

const STATELESS_PATH_SEARCH = { type: "stateless" } as const satisfies FormulaPathSearchProfile;
const STEP_STATEFUL_PATH_SEARCH = { type: "step-stateful" } as const satisfies FormulaPathSearchProfile;
const STEP_GLITCH_CAPABLE_PATH_SEARCH = {
  type: "step-glitch-capable",
} as const satisfies FormulaPathSearchProfile;

/**
 * 公式模式唯一组合根。
 *
 * Fixed-formula suffix continuation 是全部 12 种模式共享的执行内核能力，故不复制进每项定义；这里仅记录追加新公式后真正不同的 prefix contract。
 */
export const FORMULA_MODE_DEFINITIONS = {
  "abs:y": {
    algorithm: "abs",
    appendPrefixContinuation: PHYSICAL_APPEND_CONTINUATION,
    deleteInfluence: ADJACENT_LOCAL_DELETE,
    equation: "y",
    formulaRefinement: DIRECT_REFINEMENT,
    formulaSettings: STANDARD_SETTINGS,
    pathSearchProfile: STATELESS_PATH_SEARCH,
  },
  "abs:dy": {
    algorithm: "abs",
    appendPrefixContinuation: PHYSICAL_APPEND_CONTINUATION,
    deleteInfluence: ADJACENT_LOCAL_DELETE,
    equation: "dy",
    formulaRefinement: POSITION_COMPENSATION,
    formulaSettings: STANDARD_SETTINGS,
    pathSearchProfile: STATELESS_PATH_SEARCH,
  },
  "abs:ddy": {
    algorithm: "abs",
    appendPrefixContinuation: COLD_APPEND_REPLAY,
    deleteInfluence: GLOBAL_DELETE,
    equation: "ddy",
    formulaRefinement: ABS_SECOND_DERIVATIVE_REFINEMENT,
    formulaSettings: STEEPNESS_SETTINGS,
    pathSearchProfile: STATELESS_PATH_SEARCH,
  },
  "step:y": {
    algorithm: "step",
    appendPrefixContinuation: COLD_APPEND_REPLAY,
    deleteInfluence: GLOBAL_DELETE,
    equation: "y",
    formulaRefinement: DIRECT_REFINEMENT,
    formulaSettings: STEP_SETTINGS,
    pathSearchProfile: STEP_STATEFUL_PATH_SEARCH,
  },
  "step:dy": {
    algorithm: "step",
    appendPrefixContinuation: COLD_APPEND_REPLAY,
    deleteInfluence: GLOBAL_DELETE,
    equation: "dy",
    formulaRefinement: POSITION_COMPENSATION,
    formulaSettings: STEP_ODE_SETTINGS,
    pathSearchProfile: STEP_GLITCH_CAPABLE_PATH_SEARCH,
  },
  "step:ddy": {
    algorithm: "step",
    appendPrefixContinuation: COLD_APPEND_REPLAY,
    deleteInfluence: GLOBAL_DELETE,
    equation: "ddy",
    formulaRefinement: POSITION_COMPENSATION,
    formulaSettings: STEP_ODE_SETTINGS,
    pathSearchProfile: STEP_GLITCH_CAPABLE_PATH_SEARCH,
  },
  "pchip:y": {
    algorithm: "pchip",
    appendPrefixContinuation: COLD_APPEND_REPLAY,
    deleteInfluence: GLOBAL_DELETE,
    equation: "y",
    formulaRefinement: DIRECT_REFINEMENT,
    formulaSettings: STANDARD_SETTINGS,
    pathSearchProfile: STATELESS_PATH_SEARCH,
  },
  "pchip:dy": {
    algorithm: "pchip",
    appendPrefixContinuation: COLD_APPEND_REPLAY,
    deleteInfluence: GLOBAL_DELETE,
    equation: "dy",
    formulaRefinement: DIRECT_REFINEMENT,
    formulaSettings: STANDARD_SETTINGS,
    pathSearchProfile: STATELESS_PATH_SEARCH,
  },
  "pchip:ddy": {
    algorithm: "pchip",
    appendPrefixContinuation: COLD_APPEND_REPLAY,
    deleteInfluence: GLOBAL_DELETE,
    equation: "ddy",
    formulaRefinement: DIRECT_REFINEMENT,
    formulaSettings: STANDARD_SETTINGS,
    pathSearchProfile: STATELESS_PATH_SEARCH,
  },
  "akima:y": {
    algorithm: "akima",
    appendPrefixContinuation: COLD_APPEND_REPLAY,
    deleteInfluence: GLOBAL_DELETE,
    equation: "y",
    formulaRefinement: DIRECT_REFINEMENT,
    formulaSettings: STANDARD_SETTINGS,
    pathSearchProfile: STATELESS_PATH_SEARCH,
  },
  "akima:dy": {
    algorithm: "akima",
    appendPrefixContinuation: COLD_APPEND_REPLAY,
    deleteInfluence: GLOBAL_DELETE,
    equation: "dy",
    formulaRefinement: DIRECT_REFINEMENT,
    formulaSettings: STANDARD_SETTINGS,
    pathSearchProfile: STATELESS_PATH_SEARCH,
  },
  "akima:ddy": {
    algorithm: "akima",
    appendPrefixContinuation: COLD_APPEND_REPLAY,
    deleteInfluence: GLOBAL_DELETE,
    equation: "ddy",
    formulaRefinement: DIRECT_REFINEMENT,
    formulaSettings: STANDARD_SETTINGS,
    pathSearchProfile: STATELESS_PATH_SEARCH,
  },
} as const satisfies Readonly<Record<FormulaModeKey, FormulaModeDefinition>>;

/** 返回静态模式定义；Record key 让算法或方程扩展时在编译期暴露遗漏。 */
export function resolveFormulaModeDefinition(algorithm: AlgorithmMode, equation: EquationMode): FormulaModeDefinition {
  // 两个参数都是封闭联合，其模板组合必为 FormulaModeKey；TypeScript 尚不能保留该表达式的模板字面量类型。
  return FORMULA_MODE_DEFINITIONS[`${algorithm}:${equation}` as FormulaModeKey];
}

/** 把页面 feature request 解析为当前模式唯一合法的原子工作流契约。 */
export function resolveFormulaModeContract(
  algorithm: AlgorithmMode,
  equation: EquationMode,
  isStepGlitchModeRequested: boolean,
): FormulaModeContract {
  const definition = resolveFormulaModeDefinition(algorithm, equation);
  const pathSearchPolicy: FormulaPathSearchPolicy =
    definition.pathSearchProfile.type === "stateless"
      ? { type: "stateless" }
      : definition.pathSearchProfile.type === "step-glitch-capable" && isStepGlitchModeRequested
        ? { type: "step-glitch" }
        : { type: "step-stateful" };
  return { ...definition, pathSearchPolicy };
}
