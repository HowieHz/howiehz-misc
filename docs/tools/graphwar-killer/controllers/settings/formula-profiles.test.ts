import { describe, expect, it } from "vitest";

import {
  applyGraphwarManagedFormulaProfileRepairPlan,
  createDefaultGraphwarFormulaProfiles,
  createGraphwarManagedFormulaProfileRepairPlan,
  getGraphwarFormulaProfile,
  graphwarFormulaProfileSupportsOneClickClear,
  updateGraphwarFormulaProfile,
  type GraphwarFormulaProfiles,
} from "./formula-profiles";

describe("formula profiles", () => {
  it("creates the three product defaults without sharing profile objects", () => {
    const profiles = createDefaultGraphwarFormulaProfiles();
    const secondProfiles = createDefaultGraphwarFormulaProfiles();

    expect(profiles).toEqual({
      y: { algorithm: "abs" },
      dy: { algorithm: "step", stepGlitchModeEnabled: true },
      ddy: { algorithm: "step" },
    });
    expect(secondProfiles).not.toBe(profiles);
    expect(secondProfiles.y).not.toBe(profiles.y);
    expect(secondProfiles.dy).not.toBe(profiles.dy);
    expect(secondProfiles.ddy).not.toBe(profiles.ddy);
  });

  it("reads and updates one selected profile without leaking into its neighbours", () => {
    const original = createDefaultGraphwarFormulaProfiles();
    const withDerivativeAlgorithm = updateGraphwarFormulaProfile(original, "dy", { algorithm: "akima" });
    const updated = updateGraphwarFormulaProfile(withDerivativeAlgorithm, "dy", {
      stepGlitchModeEnabled: false,
    });

    expect(getGraphwarFormulaProfile(updated, "dy")).toEqual({
      algorithm: "akima",
      stepGlitchModeEnabled: false,
    });
    expect(updated.y).toBe(original.y);
    expect(updated.ddy).toBe(original.ddy);
    expect(original.dy).toEqual({ algorithm: "step", stepGlitchModeEnabled: true });
  });

  it("keeps the glitch preference exclusive to the first-derivative profile", () => {
    const profiles = createDefaultGraphwarFormulaProfiles();

    expect(
      updateGraphwarFormulaProfile(profiles, "y", {
        algorithm: "pchip",
        stepGlitchModeEnabled: true,
      }).y,
    ).toEqual({ algorithm: "pchip" });
    expect(
      updateGraphwarFormulaProfile(profiles, "ddy", {
        algorithm: "akima",
        stepGlitchModeEnabled: true,
      }).ddy,
    ).toEqual({ algorithm: "akima" });
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
      y: { algorithm: "pchip" },
      dy: { algorithm: "abs", stepGlitchModeEnabled: false },
      ddy: { algorithm: "akima" },
    };
    const plan = createGraphwarManagedFormulaProfileRepairPlan(profiles);

    expect(plan).toEqual({
      y: { algorithm: "abs" },
      ddy: { algorithm: "step" },
    });

    const repaired = applyGraphwarManagedFormulaProfileRepairPlan(profiles, plan);
    expect(repaired).toEqual({
      y: { algorithm: "abs" },
      dy: { algorithm: "abs", stepGlitchModeEnabled: false },
      ddy: { algorithm: "step" },
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

  it("is idempotent after the first confirmed repair", () => {
    const profiles: GraphwarFormulaProfiles = {
      y: { algorithm: "akima" },
      dy: { algorithm: "pchip", stepGlitchModeEnabled: false },
      ddy: { algorithm: "abs" },
    };
    const repaired = applyGraphwarManagedFormulaProfileRepairPlan(
      profiles,
      createGraphwarManagedFormulaProfileRepairPlan(profiles),
    );
    const secondPlan = createGraphwarManagedFormulaProfileRepairPlan(repaired);

    expect(repaired.ddy).toEqual({ algorithm: "abs" });
    expect(secondPlan).toEqual({});
    expect(applyGraphwarManagedFormulaProfileRepairPlan(repaired, secondPlan)).toBe(repaired);
  });
});
