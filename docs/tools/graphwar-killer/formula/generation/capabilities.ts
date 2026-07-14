import type { AlgorithmMode, EquationMode } from "../../core/types";

/** Step 全模式和 ABS y'' 会把陡峭度写入最终公式；其他组合不应被该输入阻塞。 */
export function formulaModeUsesSteepness(algorithm: AlgorithmMode, equation: EquationMode) {
  return algorithm === "step" || (algorithm === "abs" && equation === "ddy");
}

/** Step 邪道只适用于 ODE；调用方用这一处判定统一选择扫描器、mask 和缓存规范值。 */
export function formulaModeUsesStepGlitch(
  algorithm: AlgorithmMode,
  equation: EquationMode,
  stepGlitchModeEnabled: boolean,
) {
  return stepGlitchModeEnabled && algorithm === "step" && equation !== "y";
}
