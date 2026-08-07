import { describe, expect, it } from "vitest";

import { GRAPHWAR_SOLDIER_VISIBLE_SIZE } from "../../core/game/constants";
import { createGraphwarSoldierTemplateCanonicalData } from "../objects";
import {
  createGraphwarSoldierTemplateProfileData,
  graphwarSoldierCanvasCenter,
  graphwarSoldierGenerationMinimumAxisGap,
  graphwarSoldierMirrorVisibleCenterX,
  graphwarSoldierTemplateMinimumFixedScore,
  graphwarSoldierTemplateMinimumForegroundScore,
  graphwarSoldierTemplateMinimumPlayerScore,
  graphwarSoldierTemplateMinimumSignatureScore,
  graphwarSoldierVisibleCenterX,
  graphwarSoldierVisibleCenterY,
} from "./soldier-template";

describe("Graphwar soldier template canonical data", () => {
  it("packs the profile fields in a stable per-instance layout", () => {
    const first = createGraphwarSoldierTemplateProfileData();
    expect([...first]).toEqual([
      graphwarSoldierCanvasCenter,
      graphwarSoldierVisibleCenterX,
      graphwarSoldierVisibleCenterY,
      graphwarSoldierMirrorVisibleCenterX,
      graphwarSoldierTemplateMinimumFixedScore,
      graphwarSoldierTemplateMinimumForegroundScore,
      graphwarSoldierTemplateMinimumPlayerScore,
      graphwarSoldierTemplateMinimumSignatureScore,
      graphwarSoldierGenerationMinimumAxisGap,
      GRAPHWAR_SOLDIER_VISIBLE_SIZE / 2,
    ]);

    first[0] = 0;
    expect(createGraphwarSoldierTemplateProfileData()[0]).toBe(graphwarSoldierCanvasCenter);
  });

  it("derives normal and isMirrored WASM data from the templates used by TypeScript", () => {
    const data = createGraphwarSoldierTemplateCanonicalData();
    expect([...data.baseFlags]).toEqual([0, 1]);
    expect([...data.baseGeometry]).toEqual([
      graphwarSoldierVisibleCenterX,
      graphwarSoldierVisibleCenterY,
      graphwarSoldierMirrorVisibleCenterX,
      graphwarSoldierVisibleCenterY,
    ]);
    expect(data.basePixelRanges).toHaveLength(16);
    expect(data.pixelCoordinates.length % 2).toBe(0);
    expect(data.templateRecords.length % 5).toBe(0);
    expect(data.signatureColors.length).toBeGreaterThan(0);
    expect(data.templateNames).toHaveLength(10);
    for (let index = 0; index < data.templateRecords.length; index += 5) {
      const [baseIndex, nameIndex, coordinateOffset, colorOffset, count] = data.templateRecords.subarray(
        index,
        index + 5,
      );
      expect(baseIndex).toBeLessThan(data.baseFlags.length);
      expect(nameIndex).toBeLessThan(data.templateNames.length);
      expect(coordinateOffset + count).toBeLessThanOrEqual(data.pixelCoordinates.length / 2);
      expect(colorOffset + count).toBeLessThanOrEqual(data.signatureColors.length);
    }

    data.baseFlags[0] = 1;
    data.templateRecords[0] = 99;
    const replacement = createGraphwarSoldierTemplateCanonicalData();
    expect([...replacement.baseFlags]).toEqual([0, 1]);
    expect(replacement.templateRecords[0]).toBe(0);
  });
});
