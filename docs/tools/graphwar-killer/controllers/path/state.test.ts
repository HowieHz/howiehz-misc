import { describe, expect, it } from "vitest";
import { ref } from "vue";

import { createPixelPoint } from "../../core/types";
import { useGraphwarPathState } from "./state";

describe("Graphwar path state", () => {
  it("atomically replaces the active solver path", () => {
    const state = useGraphwarPathState(ref("solver"));
    const start = createPixelPoint(10, 100);
    const route = createPixelPoint(50, 80);
    const target = createPixelPoint(100, 100);

    state.applyValidatedPath([start, route, target]);

    expect(state.solverPathPixels.value).toEqual([start, route, target]);
  });

  it("writes validated paths into the active simulator workflow", () => {
    const state = useGraphwarPathState(ref("simulator"));
    const point = createPixelPoint(10, 100);

    state.applyValidatedPath([point]);

    expect(state.simulatorPathPixels.value).toEqual([point]);
    expect(state.solverPathPixels.value).toEqual([]);
  });
});
