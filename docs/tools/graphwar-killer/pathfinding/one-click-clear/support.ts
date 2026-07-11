import type { AlgorithmMode, EquationMode } from "../../core/types";

/** Returns whether one-click clear implements the selected algorithm and equation contract. */
export function supportsOneClickClear(algorithm: AlgorithmMode, equation: EquationMode) {
  return algorithm === "step" || (algorithm === "abs" && equation !== "ddy");
}
