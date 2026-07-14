import type { AlgorithmMode } from "../../core/types";

/** Returns whether one-click clear implements the selected algorithm contract. */
export function supportsOneClickClear(algorithm: AlgorithmMode) {
  return algorithm === "step" || algorithm === "abs";
}
