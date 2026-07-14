import { describe, expect, it } from "vitest";

import type { AlgorithmMode } from "../../core/types";
import { supportsOneClickClear } from "./support";

describe("one-click-clear support", () => {
  it.each([
    ["abs", true],
    ["step", true],
    ["pchip", false],
    ["akima", false],
  ] satisfies [AlgorithmMode, boolean][])("reports %s support", (algorithm, expected) => {
    expect(supportsOneClickClear(algorithm)).toBe(expected);
  });
});
