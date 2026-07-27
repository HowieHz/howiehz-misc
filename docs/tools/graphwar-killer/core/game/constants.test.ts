import { describe, expect, it } from "vitest";

import {
  GRAPHWAR_AUTO_CONTROL_POINT_MIN_FORWARD_PLANE_PIXELS,
  GRAPHWAR_FUNC_LAST_BISECTED_X_STEP_DISTANCE,
  GRAPHWAR_GAME_CONSTANT_COUNT,
  createGraphwarGameConstantData,
  graphwarSourceConstants,
} from "./constants";

describe("Graphwar derived constants", () => {
  it("keeps spatial planning and the source-compatible final bisection step distinct", () => {
    expect(GRAPHWAR_AUTO_CONTROL_POINT_MIN_FORWARD_PLANE_PIXELS).toBe(1);
    expect(GRAPHWAR_FUNC_LAST_BISECTED_X_STEP_DISTANCE).toBe(0.000009765625);
  });

  it("packs the source constants in one stable per-instance layout", () => {
    const first = createGraphwarGameConstantData();
    expect(first).toHaveLength(GRAPHWAR_GAME_CONSTANT_COUNT);
    expect([...first]).toEqual([
      graphwarSourceConstants.planeLength,
      graphwarSourceConstants.planeHeight,
      graphwarSourceConstants.planeGameLength,
      graphwarSourceConstants.soldierRadius,
      graphwarSourceConstants.soldierSelectionRadius,
      graphwarSourceConstants.stepSize,
      graphwarSourceConstants.funcMaxSteps,
      graphwarSourceConstants.funcMaxStepDistanceSquared,
      graphwarSourceConstants.funcMinXStepDistance,
      graphwarSourceConstants.angleError,
      graphwarSourceConstants.maxAngleLoops,
    ]);

    first[0] = 0;
    expect(createGraphwarGameConstantData()[0]).toBe(graphwarSourceConstants.planeLength);
  });
});
