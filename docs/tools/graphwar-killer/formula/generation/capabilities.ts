import type { AlgorithmMode, EquationMode } from "../../core/types";

/** Step 全模式和 ABS y'' 会把陡峭度写入最终公式；其他组合不应被该输入阻塞。 */
export function formulaModeUsesSteepness(algorithm: AlgorithmMode, equation: EquationMode) {
  return algorithm === "step" || (algorithm === "abs" && equation === "ddy");
}
