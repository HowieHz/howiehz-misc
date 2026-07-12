import type { AlgorithmMode, EquationMode } from "../../core/types";
import { supportsOneClickClear } from "../../pathfinding/one-click-clear/support";

/** One Solver equation's independently retained formula preferences. */
export interface GraphwarFormulaProfile {
  algorithm: AlgorithmMode;
  /** Only the first-derivative profile stores this preference. */
  stepGlitchModeEnabled?: boolean;
}

/** Solver formula preferences keyed by Graphwar's three equation modes. */
export interface GraphwarFormulaProfiles {
  y: GraphwarFormulaProfile;
  dy: GraphwarFormulaProfile & { stepGlitchModeEnabled: boolean };
  ddy: GraphwarFormulaProfile;
}

/** A sparse, immutable description of the unsupported profiles managed mode must replace. */
export type GraphwarManagedFormulaProfileRepairPlan = Partial<GraphwarFormulaProfiles>;

/** Creates fresh session defaults so callers never share mutable profile objects. */
export function createDefaultGraphwarFormulaProfiles(): GraphwarFormulaProfiles {
  return {
    y: { algorithm: "abs" },
    dy: { algorithm: "step", stepGlitchModeEnabled: true },
    ddy: { algorithm: "step" },
  };
}

/** Reads the selected equation profile without copying or coupling neighbouring profiles. */
export function getGraphwarFormulaProfile(profiles: GraphwarFormulaProfiles, equation: EquationMode) {
  return profiles[equation];
}

/** Replaces only the selected profile and strips the derivative-only preference from other equations. */
export function updateGraphwarFormulaProfile(
  profiles: GraphwarFormulaProfiles,
  equation: EquationMode,
  update: Partial<GraphwarFormulaProfile>,
): GraphwarFormulaProfiles {
  if (equation === "dy") {
    return {
      ...profiles,
      dy: {
        ...profiles.dy,
        ...update,
        algorithm: update.algorithm ?? profiles.dy.algorithm,
        stepGlitchModeEnabled: update.stepGlitchModeEnabled ?? profiles.dy.stepGlitchModeEnabled,
      },
    };
  }

  return {
    ...profiles,
    [equation]: { algorithm: update.algorithm ?? profiles[equation].algorithm },
  };
}

/** Delegates support decisions to the one-click-clear implementation's authoritative contract. */
export function graphwarFormulaProfileSupportsOneClickClear(profiles: GraphwarFormulaProfiles, equation: EquationMode) {
  return supportsOneClickClear(profiles[equation].algorithm, equation);
}

/** Projects only unsupported profiles onto managed mode's supported fallbacks without mutating the input. */
export function createGraphwarManagedFormulaProfileRepairPlan(
  profiles: GraphwarFormulaProfiles,
): GraphwarManagedFormulaProfileRepairPlan {
  const plan: GraphwarManagedFormulaProfileRepairPlan = {};
  if (!graphwarFormulaProfileSupportsOneClickClear(profiles, "y")) {
    plan.y = { algorithm: "abs" };
  }
  if (!graphwarFormulaProfileSupportsOneClickClear(profiles, "dy")) {
    plan.dy = { algorithm: "step", stepGlitchModeEnabled: true };
  }
  if (!graphwarFormulaProfileSupportsOneClickClear(profiles, "ddy")) {
    plan.ddy = { algorithm: "step" };
  }
  return plan;
}

/** Applies a confirmed repair plan as one profile-map replacement while preserving every unplanned profile. */
export function applyGraphwarManagedFormulaProfileRepairPlan(
  profiles: GraphwarFormulaProfiles,
  plan: GraphwarManagedFormulaProfileRepairPlan,
): GraphwarFormulaProfiles {
  if (!plan.y && !plan.dy && !plan.ddy) {
    return profiles;
  }
  return {
    y: plan.y ? { algorithm: plan.y.algorithm } : profiles.y,
    dy: plan.dy ?? profiles.dy,
    ddy: plan.ddy ? { algorithm: plan.ddy.algorithm } : profiles.ddy,
  };
}
