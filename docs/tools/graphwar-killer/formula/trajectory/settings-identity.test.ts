import { describe, expect, it } from "vitest";

import type { AlgorithmMode, EquationMode } from "../../core/types";
import type { GraphwarTrajectoryFormulaSettings } from "./sampling";
import {
  createGraphwarTrajectoryFormulaSettingsIdentity,
  createGraphwarTrajectoryFormulaSettingsIdentityKey,
  graphwarTrajectoryFormulaSettingsAreEquivalent,
} from "./settings-identity";

const baseSettings: GraphwarTrajectoryFormulaSettings = {
  algorithm: "step",
  decimalPlaces: 4,
  equation: "dy",
  steepness: 67,
  isStepGlitchModeEnabled: false,
  isStepOverflowProtectionEnabled: true,
};

describe("Graphwar trajectory formula settings identity", () => {
  it.each(
    (["abs", "step", "pchip", "akima"] satisfies AlgorithmMode[]).flatMap((algorithm) =>
      (["y", "dy", "ddy"] satisfies EquationMode[]).flatMap((equation) => [
        [algorithm, equation, false] as const,
        [algorithm, equation, true] as const,
      ]),
    ),
  )(
    "preserves the legacy canonical key for %s %s with Step-glitch request %s",
    (algorithm, equation, isStepGlitchModeEnabled) => {
      const settings: GraphwarTrajectoryFormulaSettings = {
        ...baseSettings,
        algorithm,
        equation,
        formulaPathSteepness: 71,
        secondOrderLaunchAngleMode: "display-rounded",
        steepness: 68,
        isStepGlitchModeEnabled,
        isStepOverflowProtectionEnabled: false,
      };
      const expectedIdentity = {
        algorithm,
        decimalPlaces: settings.decimalPlaces,
        equation,
        ...(algorithm === "step" ? { formulaPathSteepness: settings.formulaPathSteepness } : {}),
        ...(equation === "ddy" ? { secondOrderLaunchAngleMode: settings.secondOrderLaunchAngleMode } : {}),
        ...(algorithm === "step" || (algorithm === "abs" && equation === "ddy")
          ? { steepness: settings.steepness }
          : {}),
        stepGlitchMode: isStepGlitchModeEnabled && algorithm === "step" && equation !== "y",
        ...(algorithm === "step" && equation !== "y"
          ? { stepOverflowProtection: settings.isStepOverflowProtectionEnabled }
          : {}),
      };

      expect(createGraphwarTrajectoryFormulaSettingsIdentity(settings)).toEqual(expectedIdentity);
      expect(createGraphwarTrajectoryFormulaSettingsIdentityKey(settings)).toBe(JSON.stringify(expectedIdentity));
    },
  );

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
    expect(identity({ equation: "dy", isStepOverflowProtectionEnabled: false })).not.toEqual(
      identity({ equation: "dy", isStepOverflowProtectionEnabled: true }),
    );
    expect(identity({ equation: "y", isStepOverflowProtectionEnabled: false })).toEqual(
      identity({ equation: "y", isStepOverflowProtectionEnabled: true }),
    );
    expect(identity({ algorithm: "abs", equation: "ddy", isStepOverflowProtectionEnabled: false })).toEqual(
      identity({ algorithm: "abs", equation: "ddy", isStepOverflowProtectionEnabled: true }),
    );
  });

  it("normalizes dormant glitch preferences and leaves mask identity to callers", () => {
    expect(identity({ equation: "dy", isStepGlitchModeEnabled: false })).not.toEqual(
      identity({ equation: "dy", isStepGlitchModeEnabled: true }),
    );
    expect(identity({ equation: "y", isStepGlitchModeEnabled: false })).toEqual(
      identity({ equation: "y", isStepGlitchModeEnabled: true }),
    );
    expect(identity({ algorithm: "abs", equation: "dy", isStepGlitchModeEnabled: false })).toEqual(
      identity({ algorithm: "abs", equation: "dy", isStepGlitchModeEnabled: true }),
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
