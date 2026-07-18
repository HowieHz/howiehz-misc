import { describe, expect, it } from "vitest";

import type { EquationMode } from "../../core/types";
import {
  formulaModeSupportsStepGlitch,
  formulaModeUsesPositionCompensation,
  formulaModeUsesStepGlitch,
} from "./capabilities";

describe("formula mode capabilities", () => {
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
