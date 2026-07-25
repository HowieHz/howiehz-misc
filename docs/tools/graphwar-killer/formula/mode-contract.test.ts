import { describe, expect, it } from "vitest";

import type { AlgorithmMode, EquationMode } from "../core/types";
import { FORMULA_MODE_DEFINITIONS, resolveFormulaModeContract } from "./mode-contract";
import type {
  FormulaAppendPrefixContinuation,
  FormulaDeleteInfluence,
  FormulaModeKey,
  FormulaPathSearchPolicy,
  FormulaPathSearchProfile,
  FormulaRefinementProfile,
  FormulaSettingsProfile,
} from "./mode-contract";

interface ExpectedFormulaModeContract {
  algorithm: AlgorithmMode;
  appendPrefixContinuation: FormulaAppendPrefixContinuation["type"];
  deleteInfluence: FormulaDeleteInfluence["type"];
  equation: EquationMode;
  formulaRefinement: FormulaRefinementProfile["type"];
  formulaSettings: FormulaSettingsProfile["type"];
  pathSearchProfile: FormulaPathSearchProfile["type"];
  requestedPathSearchPolicy: FormulaPathSearchPolicy["type"];
}

const EXPECTED_FORMULA_MODE_CONTRACTS = [
  ["abs", "y", "direct", "standard", "physical-continuation", "adjacent-local", "stateless", "stateless"],
  [
    "abs",
    "dy",
    "position-compensation",
    "standard",
    "physical-continuation",
    "adjacent-local",
    "stateless",
    "stateless",
  ],
  ["abs", "ddy", "abs-second-derivative", "steepness", "cold-replay", "global", "stateless", "stateless"],
  ["step", "y", "direct", "step", "cold-replay", "global", "step-stateful", "step-stateful"],
  ["step", "dy", "position-compensation", "step-ode", "cold-replay", "global", "step-glitch-capable", "step-glitch"],
  ["step", "ddy", "position-compensation", "step-ode", "cold-replay", "global", "step-glitch-capable", "step-glitch"],
  ["pchip", "y", "direct", "standard", "cold-replay", "global", "stateless", "stateless"],
  ["pchip", "dy", "direct", "standard", "cold-replay", "global", "stateless", "stateless"],
  ["pchip", "ddy", "direct", "standard", "cold-replay", "global", "stateless", "stateless"],
  ["akima", "y", "direct", "standard", "cold-replay", "global", "stateless", "stateless"],
  ["akima", "dy", "direct", "standard", "cold-replay", "global", "stateless", "stateless"],
  ["akima", "ddy", "direct", "standard", "cold-replay", "global", "stateless", "stateless"],
] satisfies [
  AlgorithmMode,
  EquationMode,
  FormulaRefinementProfile["type"],
  FormulaSettingsProfile["type"],
  FormulaAppendPrefixContinuation["type"],
  FormulaDeleteInfluence["type"],
  FormulaPathSearchProfile["type"],
  FormulaPathSearchPolicy["type"],
][];

describe("formula mode contract", () => {
  it("defines exactly the 4 x 3 formula mode directory", () => {
    expect(Object.keys(FORMULA_MODE_DEFINITIONS).toSorted()).toEqual(
      (
        [
          "abs:y",
          "abs:dy",
          "abs:ddy",
          "step:y",
          "step:dy",
          "step:ddy",
          "pchip:y",
          "pchip:dy",
          "pchip:ddy",
          "akima:y",
          "akima:dy",
          "akima:ddy",
        ] satisfies FormulaModeKey[]
      ).toSorted(),
    );
  });

  it.each(EXPECTED_FORMULA_MODE_CONTRACTS)(
    "resolves the %s %s static profiles and Step-glitch request",
    (
      algorithm,
      equation,
      formulaRefinement,
      formulaSettings,
      appendPrefixContinuation,
      deleteInfluence,
      pathSearchProfile,
      requestedPathSearchPolicy,
    ) => {
      const dormant = resolveFormulaModeContract(algorithm, equation, false);
      const requested = resolveFormulaModeContract(algorithm, equation, true);

      expect({
        algorithm: requested.algorithm,
        appendPrefixContinuation: requested.appendPrefixContinuation.type,
        deleteInfluence: requested.deleteInfluence.type,
        equation: requested.equation,
        formulaRefinement: requested.formulaRefinement.type,
        formulaSettings: requested.formulaSettings.type,
        pathSearchProfile: requested.pathSearchProfile.type,
        requestedPathSearchPolicy: requested.pathSearchPolicy.type,
      } satisfies ExpectedFormulaModeContract).toEqual({
        algorithm,
        appendPrefixContinuation,
        deleteInfluence,
        equation,
        formulaRefinement,
        formulaSettings,
        pathSearchProfile,
        requestedPathSearchPolicy,
      });
      expect(dormant.pathSearchPolicy.type).toBe(pathSearchProfile === "stateless" ? "stateless" : "step-stateful");
    },
  );
});
