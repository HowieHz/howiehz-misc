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

  it("limits ABS position compensation to y' while retaining Step ODE compensation", () => {
    expect(formulaModeUsesPositionCompensation("abs", "y")).toBe(false);
    expect(formulaModeUsesPositionCompensation("abs", "dy")).toBe(true);
    expect(formulaModeUsesPositionCompensation("abs", "ddy")).toBe(false);
    expect(formulaModeUsesPositionCompensation("step", "dy")).toBe(true);
    expect(formulaModeUsesPositionCompensation("step", "ddy")).toBe(true);
  });
});
