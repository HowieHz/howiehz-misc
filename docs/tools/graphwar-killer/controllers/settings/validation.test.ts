import { describe, expect, it } from "vitest";

import { parseGraphwarManagedTimingMilliseconds } from "./validation";

describe("managed timing validation", () => {
  it.each([
    ["0.001", 1],
    ["0.5", 500],
    ["3", 3000],
    ["12.345", 12_345],
    ["60", 60_000],
  ])("parses %s seconds as integer milliseconds", (text, milliseconds) => {
    expect(parseGraphwarManagedTimingMilliseconds(text)).toEqual({ milliseconds, type: "valid" });
  });

  it.each([
    ["", "number"],
    ["value", "number"],
    ["0", "range"],
    ["60.001", "range"],
    ["0.0009", "precision"],
    ["0.0010", "precision"],
    ["1.2345", "precision"],
    ["1e-3", "precision"],
    ["0x1", "precision"],
    ["1.0000000000000002", "precision"],
  ] as const)("rejects %s as %s", (text, type) => {
    expect(parseGraphwarManagedTimingMilliseconds(text)).toEqual({ type });
  });
});
