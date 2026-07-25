import { resolveFormulaModeContract } from "../mode-contract";
import type { GraphwarTrajectoryFormulaSettings } from "./sampling";

/** 只保留当前算法和方程实际消费字段的 canonical 公式设置身份。 */
export function createGraphwarTrajectoryFormulaSettingsIdentity(settings: GraphwarTrajectoryFormulaSettings) {
  const modeContract = resolveFormulaModeContract(
    settings.algorithm,
    settings.equation,
    settings.isStepGlitchModeEnabled,
  );
  return {
    algorithm: settings.algorithm,
    decimalPlaces: settings.decimalPlaces,
    equation: settings.equation,
    ...(modeContract.formulaSettings.type === "step" || modeContract.formulaSettings.type === "step-ode"
      ? { formulaPathSteepness: settings.formulaPathSteepness ?? settings.steepness }
      : {}),
    ...(settings.equation === "ddy"
      ? { secondOrderLaunchAngleMode: settings.secondOrderLaunchAngleMode ?? "full-precision" }
      : {}),
    ...(modeContract.formulaSettings.type === "standard" ? {} : { steepness: settings.steepness }),
    // 旧字段名属于 canonical cache JSON 协议，输入字段重命名不能改变既有 key。
    stepGlitchMode: modeContract.pathSearchPolicy.type === "step-glitch",
    ...(modeContract.formulaSettings.type === "step-ode"
      ? { stepOverflowProtection: settings.isStepOverflowProtectionEnabled }
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
