import type { AlgorithmMode, EquationMode } from "../../core/types";

/** Step 全模式和 ABS y'' 会把陡峭度写入最终公式；其他组合不应被该输入阻塞。 */
export function formulaModeUsesSteepness(algorithm: AlgorithmMode, equation: EquationMode) {
  return algorithm === "step" || (algorithm === "abs" && equation === "ddy");
}

/** Step ODE 与双 ABS y' 从真实接受点继续生成下一段，避免理论控制点误差逐段累计。 */
export function formulaModeUsesPositionCompensation(algorithm: AlgorithmMode, equation: EquationMode) {
  return (algorithm === "step" && equation !== "y") || (algorithm === "abs" && equation === "dy");
}

/** 只有 ODE 的 Step 能把受阻段替换为硬 Step。 */
export function formulaModeSupportsStepGlitch(algorithm: AlgorithmMode, equation: EquationMode) {
  return algorithm === "step" && equation !== "y";
}

/** Step 邪道只替换受阻的 Step ODE 段；调用方据此统一选择扫描器和 mask。 */
export function formulaModeUsesStepGlitch(
  algorithm: AlgorithmMode,
  equation: EquationMode,
  stepGlitchModeEnabled: boolean,
) {
  return stepGlitchModeEnabled && formulaModeSupportsStepGlitch(algorithm, equation);
}
