import { describe, expect, it } from "vitest";

import type { AlgorithmMode, EquationMode } from "../../core/types";
import {
  formulaModePreservesPrefixWhenAppending,
  formulaModeSupportsStepGlitch,
  formulaModeUsesPositionCompensation,
  formulaModeUsesStepGlitch,
} from "./capabilities";

describe("formula mode capabilities", () => {
  it.each([
    ["abs", "y", true],
    ["abs", "dy", true],
    ["abs", "ddy", false],
    ["step", "y", false],
    ["step", "dy", false],
    ["step", "ddy", false],
    ["pchip", "y", false],
    ["pchip", "dy", false],
    ["pchip", "ddy", false],
    ["akima", "y", false],
    ["akima", "dy", false],
    ["akima", "ddy", false],
  ] satisfies [AlgorithmMode, EquationMode, boolean][])(
    "reports whether appending preserves the %s %s physical prefix",
    (algorithm, equation, expected) => {
      expect(formulaModePreservesPrefixWhenAppending(algorithm, equation)).toBe(expected);
    },
  );

  it.each(["y", "dy", "ddy"] satisfies EquationMode[])("disables ABS %s glitch semantics", (equation) => {
    expect(formulaModeSupportsStepGlitch("abs", equation)).toBe(false);
    expect(formulaModeUsesStepGlitch("abs", equation, true)).toBe(false);
  });

  it("enables position compensation for both ABS ODE modes and Step ODE modes", () => {
    expect(formulaModeUsesPositionCompensation("abs", "y")).toBe(false);
    expect(formulaModeUsesPositionCompensation("abs", "dy")).toBe(true);
    expect(formulaModeUsesPositionCompensation("abs", "ddy")).toBe(true);
    expect(formulaModeUsesPositionCompensation("step", "dy")).toBe(true);
    expect(formulaModeUsesPositionCompensation("step", "ddy")).toBe(true);
  });
});
