import type { AlgorithmMode, EquationMode } from "../../core/types";
import { resolveFormulaModeContract, resolveFormulaModeDefinition } from "../mode-contract";

/** Step 全模式和 ABS y'' 会把陡峭度写入最终公式；其他组合不应被该输入阻塞。 */
export function formulaModeUsesSteepness(algorithm: AlgorithmMode, equation: EquationMode) {
  return resolveFormulaModeDefinition(algorithm, equation).formulaSettings.type !== "standard";
}

/** ODE 与双 ABS y'/y'' 都从真实接受点继续生成下一段，避免理论控制点误差逐段累计。 */
export function formulaModeUsesPositionCompensation(algorithm: AlgorithmMode, equation: EquationMode) {
  return resolveFormulaModeDefinition(algorithm, equation).formulaRefinement.type !== "direct";
}

/** 只有 ABS y=/y'= 追加新项时不会反向改变已有公式前缀，可安全续播其物理状态。 */
export function formulaModePreservesPrefixWhenAppending(algorithm: AlgorithmMode, equation: EquationMode) {
  return resolveFormulaModeDefinition(algorithm, equation).appendPrefixContinuation.type === "physical-continuation";
}

/** ABS y=/y'= 删点只替换相邻连接段，控制折线的局部命中可作为顺路士兵命中的保守证明。 */
export function formulaModeSupportsLocalDeleteHitProof(algorithm: AlgorithmMode, equation: EquationMode) {
  return resolveFormulaModeDefinition(algorithm, equation).deleteInfluence.type === "adjacent-local";
}

/** 只有 ODE 的 Step 能把受阻段替换为硬 Step。 */
export function formulaModeSupportsStepGlitch(algorithm: AlgorithmMode, equation: EquationMode) {
  return resolveFormulaModeDefinition(algorithm, equation).pathSearchProfile.type === "step-glitch-capable";
}

/** Step 邪道只替换受阻的 Step ODE 段；调用方据此统一选择扫描器和 mask。 */
export function formulaModeUsesStepGlitch(
  algorithm: AlgorithmMode,
  equation: EquationMode,
  isStepGlitchModeEnabled: boolean,
) {
  return (
    resolveFormulaModeContract(algorithm, equation, isStepGlitchModeEnabled).pathSearchPolicy.type === "step-glitch"
  );
}
