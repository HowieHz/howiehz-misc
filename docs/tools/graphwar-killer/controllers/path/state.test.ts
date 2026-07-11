import { describe, expect, it } from "vitest";
import { ref } from "vue";

import { createPixelPoint } from "../../core/types";
import type { GraphwarCommittedTarget } from "../../pathfinding/targeting";
import { useGraphwarPathState } from "./state";

describe("Graphwar path committed targets", () => {
  it("upserts an exact target without changing its first-hit order", () => {
    const state = useGraphwarPathState(ref("solver"));
    const first = createTarget(100, 100, 12);
    const second = createTarget(200, 100, 12);
    state.commitTarget(first);
    state.commitTarget(second);
    state.commitTarget({ ...first, anchor: createPixelPoint(102, 100) });

    expect(state.committedTargets.value).toEqual([{ ...first, anchor: createPixelPoint(102, 100) }, second]);
  });

  it("keeps ordinary edits and rebinds an edited target anchor by path index", () => {
    const state = useGraphwarPathState(ref("solver"));
    const start = createPixelPoint(10, 100);
    const route = createPixelPoint(50, 80);
    const anchor = createPixelPoint(100, 100);
    state.applyValidatedPath([start, route, anchor], [createTarget(100, 100, 12, anchor)]);

    state.pathPixels.value = [start, createPixelPoint(55, 85), createPixelPoint(105, 100)];

    expect(state.committedTargets.value).toEqual([createTarget(100, 100, 12, createPixelPoint(105, 100))]);
  });

  it("removes an anchored target moved outside its hit circle", () => {
    const state = useGraphwarPathState(ref("solver"));
    const start = createPixelPoint(10, 100);
    const anchor = createPixelPoint(100, 100);
    state.applyValidatedPath([start, anchor], [createTarget(100, 100, 12, anchor)]);

    state.pathPixels.value = [start, createPixelPoint(120, 100)];

    expect(state.committedTargets.value).toEqual([]);
  });

  it("removes a deleted anchor while preserving unanchored actual hits", () => {
    const state = useGraphwarPathState(ref("solver"));
    const start = createPixelPoint(10, 100);
    const anchor = createPixelPoint(100, 100);
    const incidental = createTarget(80, 90, 12);
    state.applyValidatedPath([start, anchor], [createTarget(100, 100, 12, anchor), incidental]);

    state.pathPixels.value = [start];

    expect(state.committedTargets.value).toEqual([incidental]);
  });
});

function createTarget(
  centerX: number,
  centerY: number,
  radius: number,
  anchor?: ReturnType<typeof createPixelPoint>,
): GraphwarCommittedTarget {
  return {
    ...(anchor ? { anchor } : {}),
    hitCircle: {
      center: createPixelPoint(centerX, centerY),
      radius,
    },
  };
}
