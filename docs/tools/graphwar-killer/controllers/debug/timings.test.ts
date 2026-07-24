import { describe, expect, it } from "vitest";

import { appendOneClickClearSearchWorkerTimings, type SmartPathfindingDebugTimingEntry } from "./timings";

describe("one-click clear search timing remainder", () => {
  it("subtracts only top-level worker stages from the search parent", () => {
    const timings: SmartPathfindingDebugTimingEntry[] = [{ elapsedMs: 100, stage: "one-click-clear-search" }];

    appendOneClickClearSearchWorkerTimings(timings, [
      { elapsedMs: 10, stage: "validate-direct-trajectory" },
      { elapsedMs: 30, stage: "scan-step-glitch" },
      { elapsedMs: 20, stage: "validate-final" },
      { elapsedMs: 7, stage: "route-pathfinding" },
      { elapsedMs: 3, stage: "route-map-pixels" },
    ]);

    expect(timings).toContainEqual({
      detail: "outside-search-stages",
      elapsedMs: 40,
      stage: "one-click-clear-search",
    });
  });
});
