import { describe, expect, it } from "vitest";

import type { AlgorithmMode } from "../../core/types";
import { supportsOneClickClear } from "./support";

describe("one-click-clear support", () => {
  it.each([
    ["abs", [true, true, false]],
    ["step", [true, true, true]],
    ["pchip", [false, false, false]],
    ["akima", [false, false, false]],
  ] satisfies [AlgorithmMode, boolean[]][])("reports the %s equation matrix", (algorithm, expected) => {
    expect((["y", "dy", "ddy"] as const).map((equation) => supportsOneClickClear(algorithm, equation))).toEqual(
      expected,
    );
  });
});
