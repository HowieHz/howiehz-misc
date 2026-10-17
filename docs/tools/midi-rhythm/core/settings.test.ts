import { describe, expect, it } from "vitest";

import { parseThresholds } from "./settings";

describe("parseThresholds", () => {
  it("keeps valid ordered values", () => {
    expect(parseThresholds({ perfectMs: "50", goodMs: "120", badMs: "250" })).toEqual({
      perfectMs: 50,
      goodMs: 120,
      badMs: 250,
    });
  });

  it("falls back to defaults for non-numeric text", () => {
    expect(parseThresholds({ perfectMs: "", goodMs: "abc", badMs: "250" })).toEqual({
      perfectMs: 80,
      goodMs: 160,
      badMs: 250,
    });
  });

  it("clamps into the allowed range", () => {
    expect(parseThresholds({ perfectMs: "0", goodMs: "999", badMs: "1" })).toEqual({
      perfectMs: 10,
      goodMs: 400,
      badMs: 400,
    });
  });

  it("enforces perfect ≤ good ≤ bad ordering", () => {
    expect(parseThresholds({ perfectMs: "150", goodMs: "100", badMs: "90" })).toEqual({
      perfectMs: 150,
      goodMs: 150,
      badMs: 150,
    });
  });
});
