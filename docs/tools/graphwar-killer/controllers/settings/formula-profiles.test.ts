import { describe, expect, it } from "vitest";

import {
  applyGraphwarManagedFormulaProfileRepairPlan,
  createDefaultGraphwarFormulaProfiles,
  createGraphwarManagedFormulaProfileRepairPlan,
  getGraphwarFormulaProfile,
  graphwarFormulaProfileSupportsOneClickClear,
  graphwarFormulaProfilesAreValidForManagedMode,
  updateGraphwarFormulaProfile,
  type GraphwarFormulaProfiles,
} from "./formula-profiles";

const defaultFormulaPreferences = {
  precisionText: "4",
  steepnessText: "210",
  isStepGlitchModeEnabled: true,
  isStepOverflowProtectionEnabled: true,
} as const;

describe("formula profiles", () => {
  it("creates the three product defaults without sharing profile objects", () => {
    const profiles = createDefaultGraphwarFormulaProfiles();
    const secondProfiles = createDefaultGraphwarFormulaProfiles();

    expect(profiles).toEqual({
      y: { algorithm: "abs", ...defaultFormulaPreferences },
      dy: { algorithm: "step", ...defaultFormulaPreferences },
      ddy: { algorithm: "step", ...defaultFormulaPreferences, steepnessText: "153" },
    });
    expect(secondProfiles).not.toBe(profiles);
    expect(secondProfiles.y).not.toBe(profiles.y);
    expect(secondProfiles.dy).not.toBe(profiles.dy);
    expect(secondProfiles.ddy).not.toBe(profiles.ddy);
  });

  it("reads and updates one selected profile without leaking into its neighbours", () => {
    const original = createDefaultGraphwarFormulaProfiles();
    const withDerivativeAlgorithm = updateGraphwarFormulaProfile(original, "dy", {
      algorithm: "akima",
      precisionText: "6",
      steepnessText: "67",
    });
    const updated = updateGraphwarFormulaProfile(withDerivativeAlgorithm, "dy", {
      isStepGlitchModeEnabled: false,
    });

    expect(getGraphwarFormulaProfile(updated, "dy")).toEqual({
      algorithm: "akima",
      precisionText: "6",
      steepnessText: "67",
      isStepGlitchModeEnabled: false,
      isStepOverflowProtectionEnabled: true,
    });
    expect(updated.y).toBe(original.y);
    expect(updated.ddy).toBe(original.ddy);
    expect(original.dy).toEqual({ algorithm: "step", ...defaultFormulaPreferences });
  });

  it.each(["y", "dy", "ddy"] as const)("keeps inactive formula preferences isolated for %s", (equation) => {
    const profiles = createDefaultGraphwarFormulaProfiles();
    const updated = updateGraphwarFormulaProfile(profiles, equation, {
      algorithm: "pchip",
      precisionText: "1",
      isStepGlitchModeEnabled: false,
      isStepOverflowProtectionEnabled: false,
      steepnessText: "67",
    });

    expect(updated[equation]).toEqual({
      algorithm: "pchip",
      precisionText: "1",
      isStepGlitchModeEnabled: false,
      isStepOverflowProtectionEnabled: false,
      steepnessText: "67",
    });
    for (const otherEquation of ["y", "dy", "ddy"] as const) {
      if (otherEquation !== equation) {
        expect(updated[otherEquation]).toBe(profiles[otherEquation]);
      }
    }
  });

  it.each([
    ["y", "abs", true],
    ["dy", "abs", true],
    ["ddy", "abs", true],
    ["y", "step", true],
    ["dy", "pchip", false],
  ] as const)("reports %s %s support through the authoritative contract", (equation, algorithm, supported) => {
    const profiles = updateGraphwarFormulaProfile(createDefaultGraphwarFormulaProfiles(), equation, { algorithm });

    expect(graphwarFormulaProfileSupportsOneClickClear(profiles, equation)).toBe(supported);
  });

  it("repairs only unsupported profiles and retains supported custom preferences", () => {
    const profiles: GraphwarFormulaProfiles = {
      y: {
        algorithm: "pchip",
        precisionText: "1",
        steepnessText: "11",
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: false,
      },
      dy: {
        algorithm: "abs",
        precisionText: "2",
        steepnessText: "22",
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      },
      ddy: {
        algorithm: "akima",
        precisionText: "3",
        steepnessText: "33",
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: false,
      },
    };
    const plan = createGraphwarManagedFormulaProfileRepairPlan(profiles);

    expect(plan).toEqual({
      y: { algorithm: "abs" },
      ddy: { algorithm: "step", isStepGlitchModeEnabled: true },
    });

    const repaired = applyGraphwarManagedFormulaProfileRepairPlan(profiles, plan);
    expect(repaired).toEqual({
      y: {
        algorithm: "abs",
        precisionText: "1",
        steepnessText: "11",
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: false,
      },
      dy: {
        algorithm: "abs",
        precisionText: "2",
        steepnessText: "22",
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      },
      ddy: {
        algorithm: "step",
        precisionText: "3",
        steepnessText: "33",
        isStepGlitchModeEnabled: true,
        isStepOverflowProtectionEnabled: false,
      },
    });
    expect(repaired.dy).toBe(profiles.dy);
    expect(profiles.y.algorithm).toBe("pchip");
    expect(profiles.ddy.algorithm).toBe("akima");
  });

  it("uses the managed derivative fallback only when that profile is unsupported", () => {
    const unsupported = updateGraphwarFormulaProfile(createDefaultGraphwarFormulaProfiles(), "dy", {
      algorithm: "pchip",
      isStepGlitchModeEnabled: false,
    });

    expect(createGraphwarManagedFormulaProfileRepairPlan(unsupported)).toEqual({
      dy: { algorithm: "step", isStepGlitchModeEnabled: true },
    });
  });

  it("rejects an invalid precision retained by a non-current managed profile", () => {
    const profiles = updateGraphwarFormulaProfile(createDefaultGraphwarFormulaProfiles(), "dy", {
      precisionText: "invalid",
    });

    expect(graphwarFormulaProfilesAreValidForManagedMode(profiles)).toBe(false);
  });

  it("validates steepness against the algorithm selected by the managed repair", () => {
    const profiles = updateGraphwarFormulaProfile(createDefaultGraphwarFormulaProfiles(), "ddy", {
      algorithm: "akima",
      steepnessText: "invalid",
    });

    expect(createGraphwarManagedFormulaProfileRepairPlan(profiles).ddy?.algorithm).toBe("step");
    expect(graphwarFormulaProfilesAreValidForManagedMode(profiles)).toBe(false);
  });

  it("ignores invalid steepness in profiles whose final algorithm does not consume it", () => {
    let profiles = updateGraphwarFormulaProfile(createDefaultGraphwarFormulaProfiles(), "y", {
      algorithm: "pchip",
      steepnessText: "invalid",
    });
    profiles = updateGraphwarFormulaProfile(profiles, "dy", {
      algorithm: "abs",
      steepnessText: "invalid",
    });

    expect(createGraphwarManagedFormulaProfileRepairPlan(profiles).y?.algorithm).toBe("abs");
    expect(graphwarFormulaProfilesAreValidForManagedMode(profiles)).toBe(true);
  });

  it("is idempotent after the first confirmed repair", () => {
    const profiles: GraphwarFormulaProfiles = {
      y: { algorithm: "akima", ...defaultFormulaPreferences },
      dy: { algorithm: "pchip", ...defaultFormulaPreferences, isStepGlitchModeEnabled: false },
      ddy: { algorithm: "abs", ...defaultFormulaPreferences, isStepGlitchModeEnabled: false },
    };
    const repaired = applyGraphwarManagedFormulaProfileRepairPlan(
      profiles,
      createGraphwarManagedFormulaProfileRepairPlan(profiles),
    );
    const secondPlan = createGraphwarManagedFormulaProfileRepairPlan(repaired);

    expect(repaired.ddy).toEqual({ algorithm: "abs", ...defaultFormulaPreferences, isStepGlitchModeEnabled: false });
    expect(secondPlan).toEqual({});
    expect(applyGraphwarManagedFormulaProfileRepairPlan(repaired, secondPlan)).toBe(repaired);
  });
});
