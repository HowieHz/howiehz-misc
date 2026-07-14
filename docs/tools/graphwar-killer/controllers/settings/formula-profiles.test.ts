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

const defaultFormulaInputText = { precisionText: "4", steepnessText: "210" } as const;

describe("formula profiles", () => {
  it("creates the three product defaults without sharing profile objects", () => {
    const profiles = createDefaultGraphwarFormulaProfiles();
    const secondProfiles = createDefaultGraphwarFormulaProfiles();

    expect(profiles).toEqual({
      y: { algorithm: "abs", ...defaultFormulaInputText },
      dy: { algorithm: "step", ...defaultFormulaInputText, stepGlitchModeEnabled: true },
      ddy: { algorithm: "step", ...defaultFormulaInputText, stepGlitchModeEnabled: true },
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
      stepGlitchModeEnabled: false,
    });

    expect(getGraphwarFormulaProfile(updated, "dy")).toEqual({
      algorithm: "akima",
      precisionText: "6",
      steepnessText: "67",
      stepGlitchModeEnabled: false,
    });
    expect(updated.y).toBe(original.y);
    expect(updated.ddy).toBe(original.ddy);
    expect(original.dy).toEqual({ algorithm: "step", ...defaultFormulaInputText, stepGlitchModeEnabled: true });
  });

  it("keeps independent glitch preferences for the two ODE profiles", () => {
    const profiles = createDefaultGraphwarFormulaProfiles();

    expect(
      updateGraphwarFormulaProfile(profiles, "y", {
        algorithm: "pchip",
        stepGlitchModeEnabled: true,
      }).y,
    ).toEqual({ algorithm: "pchip", ...defaultFormulaInputText });
    expect(
      updateGraphwarFormulaProfile(profiles, "ddy", {
        algorithm: "akima",
        stepGlitchModeEnabled: true,
      }).ddy,
    ).toEqual({ algorithm: "akima", ...defaultFormulaInputText, stepGlitchModeEnabled: true });
    expect(profiles.dy.stepGlitchModeEnabled).toBe(true);
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
      y: { algorithm: "pchip", precisionText: "1", steepnessText: "11" },
      dy: { algorithm: "abs", precisionText: "2", steepnessText: "22", stepGlitchModeEnabled: false },
      ddy: { algorithm: "akima", precisionText: "3", steepnessText: "33", stepGlitchModeEnabled: false },
    };
    const plan = createGraphwarManagedFormulaProfileRepairPlan(profiles);

    expect(plan).toEqual({
      y: { algorithm: "abs" },
      ddy: { algorithm: "step", stepGlitchModeEnabled: true },
    });

    const repaired = applyGraphwarManagedFormulaProfileRepairPlan(profiles, plan);
    expect(repaired).toEqual({
      y: { algorithm: "abs", precisionText: "1", steepnessText: "11" },
      dy: { algorithm: "abs", precisionText: "2", steepnessText: "22", stepGlitchModeEnabled: false },
      ddy: { algorithm: "step", precisionText: "3", steepnessText: "33", stepGlitchModeEnabled: true },
    });
    expect(repaired.dy).toBe(profiles.dy);
    expect(profiles.y.algorithm).toBe("pchip");
    expect(profiles.ddy.algorithm).toBe("akima");
  });

  it("uses the managed derivative fallback only when that profile is unsupported", () => {
    const unsupported = updateGraphwarFormulaProfile(createDefaultGraphwarFormulaProfiles(), "dy", {
      algorithm: "pchip",
      stepGlitchModeEnabled: false,
    });

    expect(createGraphwarManagedFormulaProfileRepairPlan(unsupported)).toEqual({
      dy: { algorithm: "step", stepGlitchModeEnabled: true },
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
      y: { algorithm: "akima", ...defaultFormulaInputText },
      dy: { algorithm: "pchip", ...defaultFormulaInputText, stepGlitchModeEnabled: false },
      ddy: { algorithm: "abs", ...defaultFormulaInputText, stepGlitchModeEnabled: false },
    };
    const repaired = applyGraphwarManagedFormulaProfileRepairPlan(
      profiles,
      createGraphwarManagedFormulaProfileRepairPlan(profiles),
    );
    const secondPlan = createGraphwarManagedFormulaProfileRepairPlan(repaired);

    expect(repaired.ddy).toEqual({ algorithm: "abs", ...defaultFormulaInputText, stepGlitchModeEnabled: false });
    expect(secondPlan).toEqual({});
    expect(applyGraphwarManagedFormulaProfileRepairPlan(repaired, secondPlan)).toBe(repaired);
  });
});
