import { describe, expect, it } from "vitest";

import type { AlgorithmMode, EquationMode } from "../../core/types";
import { resolveFormulaModeContract } from "../../formula/mode-contract";
import { resolveGraphwarPathSearchPolicy } from "./policy";

const modes = (["abs", "step", "pchip", "akima"] as const).flatMap((algorithm) =>
  (["y", "dy", "ddy"] as const).map((equation) => [algorithm, equation] as const),
);

describe("Graphwar path search policies", () => {
  it.each(modes)("derives %s %s from the formula contract for both route preferences", (algorithm, equation) => {
    for (const routeMode of ["visibility-graph", "theta-star"] as const) {
      const ordinary = resolveGraphwarPathSearchPolicy(
        resolveFormulaModeContract(algorithm, equation, false),
        routeMode,
      );
      const requested = resolveGraphwarPathSearchPolicy(
        resolveFormulaModeContract(algorithm, equation, true),
        routeMode,
      );
      const canUseStepGlitch = algorithm === "step" && equation !== "y";
      const expectedOrdinaryType = algorithm === "step" ? "step-stateful" : "stateless";

      expect(ordinary).toEqual({ routeMode, type: expectedOrdinaryType });
      expect(requested).toEqual(canUseStepGlitch ? { type: "step-glitch" } : { routeMode, type: expectedOrdinaryType });
    }
  });
});

// Matrix tuple inference intentionally stays tied to the closed public enums.
modes satisfies readonly (readonly [AlgorithmMode, EquationMode])[];
