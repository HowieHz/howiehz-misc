import { describe, expect, it } from "vitest";

import { floorToDecimalPlaces, graphXAdvancesStrictly, nextDownDouble, nextUpDouble } from "./numbers";

describe("Graphwar double ordering", () => {
  it("accepts exactly one representable step but rejects equality and non-finite values", () => {
    expect(graphXAdvancesStrictly(1, nextUpDouble(1))).toBe(true);
    expect(graphXAdvancesStrictly(-1, nextUpDouble(-1))).toBe(true);
    expect(graphXAdvancesStrictly(1, 1)).toBe(false);
    expect(graphXAdvancesStrictly(-0, 0)).toBe(false);
    expect(graphXAdvancesStrictly(Number.NEGATIVE_INFINITY, 0)).toBe(false);
    expect(graphXAdvancesStrictly(0, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("decimal floor", () => {
  it("never moves right across decimal boundaries or at maximum precision", () => {
    for (const [value, decimalPlaces] of [
      [nextDownDouble(1.2345), 4],
      [1.2345, 4],
      [nextUpDouble(1.2345), 4],
      [nextDownDouble(-1.2345), 4],
      [-1.2345, 4],
      [nextUpDouble(-1.2345), 4],
      [nextDownDouble(0.123456789012345), 15],
      [nextUpDouble(-0.123456789012345), 15],
    ] as const) {
      expect(floorToDecimalPlaces(value, decimalPlaces)).toBeLessThanOrEqual(value);
    }
  });

  it("uses mathematical floor rather than truncation for negative values", () => {
    expect(floorToDecimalPlaces(-1.23451, 4)).toBe(-1.2346);
  });
});
