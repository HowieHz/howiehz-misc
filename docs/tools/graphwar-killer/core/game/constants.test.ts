import { describe, expect, it } from "vitest";

import {
  GRAPHWAR_AUTO_CONTROL_POINT_MIN_FORWARD_PLANE_PIXELS,
  GRAPHWAR_FUNC_LAST_BISECTED_X_STEP_DISTANCE,
} from "./constants";

describe("Graphwar derived constants", () => {
  it("keeps spatial planning and the source-compatible final bisection step distinct", () => {
    expect(GRAPHWAR_AUTO_CONTROL_POINT_MIN_FORWARD_PLANE_PIXELS).toBe(1);
    expect(GRAPHWAR_FUNC_LAST_BISECTED_X_STEP_DISTANCE).toBe(0.000009765625);
  });
});
