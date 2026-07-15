import { DEFAULT_FORMULA_DECIMAL_PLACES } from "../../core/numbers";
import { graphwarToolDefaults } from "../../core/tool/defaults";
import type { AlgorithmMode, EquationMode } from "../../core/types";
import { formulaModeUsesSteepness } from "../../formula/generation/capabilities";
import { supportsOneClickClear } from "../../pathfinding/one-click-clear/support";
import { parseGraphwarFormulaPrecision, parseGraphwarFormulaSteepness } from "./validation";

/** One Solver equation's independently retained formula preferences. */
export interface GraphwarFormulaProfile {
  algorithm: AlgorithmMode;
  /** Raw decimal-place input retained independently for this equation. */
  precisionText: string;
  /** Raw steepness input retained independently for this equation. */
  steepnessText: string;
  /** Glitch-mode preference retained even when the current equation or algorithm cannot consume it. */
  stepGlitchModeEnabled: boolean;
  /** Step overflow preference retained even when the current algorithm cannot consume it. */
  stepOverflowProtectionEnabled: boolean;
}

/** Solver formula preferences keyed by Graphwar's three equation modes. */
export interface GraphwarFormulaProfiles {
  y: GraphwarFormulaProfile;
  dy: GraphwarFormulaProfile;
  ddy: GraphwarFormulaProfile;
}

type GraphwarFormulaProfileRepair = Pick<GraphwarFormulaProfile, "algorithm"> &
  Partial<Pick<GraphwarFormulaProfile, "stepGlitchModeEnabled">>;

/** A sparse, immutable description of the unsupported profile fields managed mode must replace. */
export type GraphwarManagedFormulaProfileRepairPlan = Partial<Record<EquationMode, GraphwarFormulaProfileRepair>>;

const defaultFormulaPreferences = {
  precisionText: String(DEFAULT_FORMULA_DECIMAL_PLACES),
  stepGlitchModeEnabled: true,
  stepOverflowProtectionEnabled: true,
  steepnessText: String(graphwarToolDefaults.steepness),
} as const;

/** Creates fresh session defaults so callers never share mutable profile objects. */
export function createDefaultGraphwarFormulaProfiles(): GraphwarFormulaProfiles {
  return {
    y: { algorithm: "abs", ...defaultFormulaPreferences },
    dy: { algorithm: "step", ...defaultFormulaPreferences },
    ddy: { algorithm: "step", ...defaultFormulaPreferences },
  };
}

/** Reads the selected equation profile without copying or coupling neighbouring profiles. */
export function getGraphwarFormulaProfile(profiles: GraphwarFormulaProfiles, equation: EquationMode) {
  return profiles[equation];
}

/** Replaces only the selected equation profile while retaining every unspecified preference. */
export function updateGraphwarFormulaProfile(
  profiles: GraphwarFormulaProfiles,
  equation: EquationMode,
  update: Partial<GraphwarFormulaProfile>,
): GraphwarFormulaProfiles {
  const current = profiles[equation];
  return {
    ...profiles,
    [equation]: {
      algorithm: update.algorithm ?? current.algorithm,
      precisionText: update.precisionText ?? current.precisionText,
      steepnessText: update.steepnessText ?? current.steepnessText,
      stepGlitchModeEnabled: update.stepGlitchModeEnabled ?? current.stepGlitchModeEnabled,
      stepOverflowProtectionEnabled: update.stepOverflowProtectionEnabled ?? current.stepOverflowProtectionEnabled,
    },
  };
}

/** Delegates support decisions to the one-click-clear implementation's authoritative contract. */
export function graphwarFormulaProfileSupportsOneClickClear(profiles: GraphwarFormulaProfiles, equation: EquationMode) {
  return supportsOneClickClear(profiles[equation].algorithm);
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
    plan.ddy = { algorithm: "step", stepGlitchModeEnabled: true };
  }
  return plan;
}

/** Applies a confirmed repair plan as one profile-map replacement while preserving every unplanned profile. */
export function applyGraphwarManagedFormulaProfileRepairPlan(
  profiles: GraphwarFormulaProfiles,
  plan: GraphwarManagedFormulaProfileRepairPlan,
): GraphwarFormulaProfiles {
  let repaired = profiles;
  for (const equation of ["y", "dy", "ddy"] as const) {
    const update = plan[equation];
    if (update) {
      repaired = updateGraphwarFormulaProfile(repaired, equation, update);
    }
  }
  return repaired;
}

/** Validates every formula profile exactly as managed mode will use it after applying required repairs. */
export function graphwarFormulaProfilesAreValidForManagedMode(profiles: GraphwarFormulaProfiles) {
  const repaired = applyGraphwarManagedFormulaProfileRepairPlan(
    profiles,
    createGraphwarManagedFormulaProfileRepairPlan(profiles),
  );
  for (const equation of ["y", "dy", "ddy"] as const) {
    const profile = repaired[equation];
    if (
      parseGraphwarFormulaPrecision(profile.precisionText) === undefined ||
      (formulaModeUsesSteepness(profile.algorithm, equation) &&
        parseGraphwarFormulaSteepness(profile.steepnessText) === undefined)
    ) {
      return false;
    }
  }
  return true;
}
