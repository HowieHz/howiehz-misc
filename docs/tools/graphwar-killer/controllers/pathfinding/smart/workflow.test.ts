import { describe, expect, it } from "vitest";

import { createPixelPoint } from "../../../core/types";
import type { SmartPathfindingDebugTimingEntry } from "../../debug/timings";
import { useGraphwarSmartPathfindingRunWorkflow } from "./workflow";

describe("smart pathfinding workflow debug timings", () => {
  it("keeps the last completed timings until the current run settles", async () => {
    let current = true;
    let displayedStages = ["last-complete"];
    let resolvePending: (() => void) | undefined;
    let pending = false;
    const workflow = useGraphwarSmartPathfindingRunWorkflow<string>({
      debug: {
        isEnabled: () => true,
        onOutcome: () => undefined,
        registerRun: () => undefined,
      },
      applyPath: () => undefined,
      buildPath: async () => {
        if (pending) {
          await new Promise<void>((resolve) => {
            resolvePending = resolve;
          });
        }
        return { hasResultCacheHit: false, path: [createPixelPoint(1, 2)], type: "success" };
      },
      finishDebugTimings: (_startedAt, timings) => {
        displayedStages = timings.map((timing) => timing.stage);
        return [...timings];
      },
      finishRun: () => true,
      getFailureMessage: () => "failure",
      getSuccessMessage: () => "success",
      isRunCurrent: () => current,
      measureStage: measureStage,
      now: () => 0,
      setStatus: () => undefined,
      startRun: () => 1,
    });

    await expect(
      workflow.run({ collectTarget: () => "target", prepare: () => false, preflight: () => true }),
    ).resolves.toBe(false);
    expect(displayedStages).toEqual(["last-complete"]);

    await expect(workflow.run({ collectTarget: () => "target", preflight: () => false })).resolves.toBe(false);
    expect(displayedStages).toContain("preflight");

    displayedStages = ["last-complete"];
    pending = true;
    const cancelledRun = workflow.run({ collectTarget: () => "target", preflight: () => true });
    await Promise.resolve();
    current = false;
    resolvePending?.();
    await expect(cancelledRun).resolves.toBe(false);
    expect(displayedStages).toEqual(["last-complete"]);

    current = true;
    pending = false;
    await expect(workflow.run({ collectTarget: () => "target", preflight: () => true })).resolves.toBe(true);
    expect(displayedStages).toContain("apply-result");
  });
});

/** 记录同步阶段，模拟页面调试计时器而不依赖真实时钟。 */
function measureStage<TResult>(
  timings: SmartPathfindingDebugTimingEntry[] | undefined,
  stage: SmartPathfindingDebugTimingEntry["stage"],
  task: () => TResult,
) {
  try {
    return task();
  } finally {
    timings?.push({ elapsedMs: 0, stage });
  }
}
