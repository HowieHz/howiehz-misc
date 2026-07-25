import { formulaModeUsesSteepness, formulaModeUsesStepGlitch } from "../generation/capabilities";
import type { GraphwarTrajectoryFormulaSettings } from "./sampling";

/** 只保留当前算法和方程实际消费字段的 canonical 公式设置身份。 */
export function createGraphwarTrajectoryFormulaSettingsIdentity(settings: GraphwarTrajectoryFormulaSettings) {
  return {
    algorithm: settings.algorithm,
    decimalPlaces: settings.decimalPlaces,
    equation: settings.equation,
    ...(settings.algorithm === "step"
      ? { formulaPathSteepness: settings.formulaPathSteepness ?? settings.steepness }
      : {}),
    ...(settings.equation === "ddy"
      ? { secondOrderLaunchAngleMode: settings.secondOrderLaunchAngleMode ?? "full-precision" }
      : {}),
    ...(formulaModeUsesSteepness(settings.algorithm, settings.equation) ? { steepness: settings.steepness } : {}),
    stepGlitchMode: formulaModeUsesStepGlitch(settings.algorithm, settings.equation, settings.stepGlitchMode),
    ...(settings.algorithm === "step" && settings.equation !== "y"
      ? { stepOverflowProtection: settings.stepOverflowProtection }
      : {}),
  };
}

/** 把 canonical 设置固化为不可受调用方后续原地修改影响的值身份。 */
export function createGraphwarTrajectoryFormulaSettingsIdentityKey(settings: GraphwarTrajectoryFormulaSettings) {
  return JSON.stringify(createGraphwarTrajectoryFormulaSettingsIdentity(settings));
}

/** 判断两组设置是否会生成并执行相同公式；mask 和 sign protection 由调用方单独核对。 */
export function graphwarTrajectoryFormulaSettingsAreEquivalent(
  left: GraphwarTrajectoryFormulaSettings,
  right: GraphwarTrajectoryFormulaSettings,
) {
  return (
    createGraphwarTrajectoryFormulaSettingsIdentityKey(left) ===
    createGraphwarTrajectoryFormulaSettingsIdentityKey(right)
  );
}
