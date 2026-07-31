import { describe, expect, it } from "vitest";

import type { GraphwarBackendExecution } from "../../core/algorithm-backend";
import { graphwarKillerLocale } from "../../locale";
import {
  appendOneClickClearSearchWorkerTimings,
  type SmartPathfindingDebugTimingEntry,
  useGraphwarDebugTimings,
} from "./timings";

describe("detection backend timing diagnostics", () => {
  it.each([
    { effective: "typescript", requested: "typescript" },
    { effective: "wasm", requested: "wasm" },
    { effective: "typescript", fallbackReason: "trap: detection trapped", requested: "wasm" },
  ] satisfies GraphwarBackendExecution[])("retains the atomic execution record %#", (backendExecution) => {
    const controller = useGraphwarDebugTimings({
      getLocale: () => graphwarKillerLocale,
      isDetectionRunActive: () => true,
    });

    controller.finishDetectionDebugTimings(1, 10, [{ elapsedMs: 2, stage: "detecting-bounds" }], backendExecution, 15);

    expect(controller.detectionDebugTimingRecord.value).toEqual({
      backendExecution,
      timings: [
        { elapsedMs: 2, stage: "detecting-bounds" },
        { elapsedMs: 3, stage: "outside-stages" },
        { elapsedMs: 5, stage: "total" },
      ],
      type: "backend",
    });
  });
});

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
