import { describe, expect, it } from "vitest";

import type { GraphwarTrajectoryFormulaSettings } from "./sampling";
import {
  createGraphwarTrajectoryFormulaSettingsIdentity,
  graphwarTrajectoryFormulaSettingsAreEquivalent,
} from "./settings-identity";

const baseSettings: GraphwarTrajectoryFormulaSettings = {
  algorithm: "step",
  decimalPlaces: 4,
  equation: "dy",
  steepness: 67,
  stepGlitchMode: false,
  stepOverflowProtection: true,
};

describe("Graphwar trajectory formula settings identity", () => {
  it("only separates Y'' execution modes for second-order equations", () => {
    expect(identity({ equation: "ddy", secondOrderLaunchAngleMode: undefined })).toEqual(
      identity({ equation: "ddy", secondOrderLaunchAngleMode: "full-precision" }),
    );
    expect(identity({ equation: "ddy", secondOrderLaunchAngleMode: "display-rounded" })).not.toEqual(
      identity({ equation: "ddy", secondOrderLaunchAngleMode: "full-precision" }),
    );
    expect(identity({ equation: "dy", secondOrderLaunchAngleMode: "display-rounded" })).toEqual(
      identity({ equation: "dy", secondOrderLaunchAngleMode: "full-precision" }),
    );
  });

  it("uses the effective formula-path steepness only for Step", () => {
    expect(identity({ formulaPathSteepness: undefined })).toEqual(identity({ formulaPathSteepness: 67 }));
    expect(identity({ formulaPathSteepness: 68 })).not.toEqual(identity({ formulaPathSteepness: 67 }));
    expect(identity({ algorithm: "abs", formulaPathSteepness: 68 })).toEqual(
      identity({ algorithm: "abs", formulaPathSteepness: 67 }),
    );
  });

  it("only includes steepness for Step and ABS Y'' formulas", () => {
    expect(identity({ algorithm: "step", steepness: 68 })).not.toEqual(identity({ algorithm: "step", steepness: 67 }));
    expect(identity({ algorithm: "abs", equation: "ddy", steepness: 68 })).not.toEqual(
      identity({ algorithm: "abs", equation: "ddy", steepness: 67 }),
    );
    expect(identity({ algorithm: "abs", equation: "dy", steepness: 68 })).toEqual(
      identity({ algorithm: "abs", equation: "dy", steepness: 67 }),
    );
    expect(identity({ algorithm: "pchip", equation: "ddy", steepness: 68 })).toEqual(
      identity({ algorithm: "pchip", equation: "ddy", steepness: 67 }),
    );
  });

  it("only includes overflow protection for Step ODE formulas", () => {
    expect(identity({ equation: "dy", stepOverflowProtection: false })).not.toEqual(
      identity({ equation: "dy", stepOverflowProtection: true }),
    );
    expect(identity({ equation: "y", stepOverflowProtection: false })).toEqual(
      identity({ equation: "y", stepOverflowProtection: true }),
    );
    expect(identity({ algorithm: "abs", equation: "ddy", stepOverflowProtection: false })).toEqual(
      identity({ algorithm: "abs", equation: "ddy", stepOverflowProtection: true }),
    );
  });

  it("normalizes dormant glitch preferences and leaves mask identity to callers", () => {
    expect(identity({ equation: "dy", stepGlitchMode: false })).not.toEqual(
      identity({ equation: "dy", stepGlitchMode: true }),
    );
    expect(identity({ equation: "y", stepGlitchMode: false })).toEqual(
      identity({ equation: "y", stepGlitchMode: true }),
    );
    expect(identity({ algorithm: "abs", equation: "dy", stepGlitchMode: false })).toEqual(
      identity({ algorithm: "abs", equation: "dy", stepGlitchMode: true }),
    );
    expect(
      graphwarTrajectoryFormulaSettingsAreEquivalent(
        { ...baseSettings, stepGlitchObstacleMask: new Uint8Array([0]) },
        { ...baseSettings, stepGlitchObstacleMask: new Uint8Array([1]) },
      ),
    ).toBe(true);
  });
});

/** 只覆盖当前用例关心的设置，避免测试矩阵重复完整默认值。 */
function identity(overrides: Partial<GraphwarTrajectoryFormulaSettings>) {
  return createGraphwarTrajectoryFormulaSettingsIdentity({ ...baseSettings, ...overrides });
}
