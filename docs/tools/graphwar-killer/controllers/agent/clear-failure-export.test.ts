import { describe, expect, it, vi } from "vitest";

import {
  createGraphwarAgentClearFailureExportQueue,
  createGraphwarAgentClearFailureSceneKey,
  type GraphwarAgentClearFailureExportRequest,
  type GraphwarAgentPathfindingDebugBundle,
} from "./clear-failure-export";
import type { GraphwarAgentAvailableState } from "./client";

/** 创建自动导出测试只会读取的最小已完成报告。 */
function createBundle(gameInstanceId: string, turnToken: string | undefined, battleRevision: string) {
  return {
    report: {
      attempts: [],
      completedAt: "2026-07-24T00:00:01.000Z",
      elapsedMs: 1000,
      outcome: { type: "failure" },
      pageTimings: [],
      path: [],
      sceneSource: "agent",
      schemaVersion: 1,
      settings: {
        formula: {
          algorithm: "step",
          decimalPlaces: 4,
          equation: "y",
          steepness: 67,
          stepGlitchMode: false,
          stepOverflowProtection: true,
        },
        isDeleteOptimizationEnabled: false,
        isFriendlyFireEnabled: false,
        isResultCacheEnabled: true,
        isSearchAnimationEnabled: true,
        routeMode: "visibility-graph",
      },
      startedAt: "2026-07-24T00:00:00.000Z",
      taskType: "one-click-clear",
    },
    sceneState: { battleRevision, gameInstanceId, turnToken } as GraphwarAgentAvailableState,
    sourceObstacleMask: new Uint8Array([1, 2, 3]),
  } satisfies GraphwarAgentPathfindingDebugBundle;
}

/** 刷新队列中 await 产生的微任务。 */
async function flushQueue() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("Graphwar Agent clear-failure export queue", () => {
  it("deduplicates the full scene key before queuing and freezes state and mask bytes", async () => {
    const requests: GraphwarAgentClearFailureExportRequest[] = [];
    const queue = createGraphwarAgentClearFailureExportQueue({
      exportRequest: (request) => {
        requests.push(request);
      },
    });
    const bundle = createBundle("game", "turn", "revision");
    const duplicateBundle = createBundle("game", "turn", "revision");

    expect(queue.enqueue("incomplete", bundle)).toBe(true);
    bundle.sourceObstacleMask[0] = 9;
    bundle.sceneState.battleRevision = "changed";
    bundle.report.elapsedMs = 9999;
    expect(queue.enqueue("search-error", duplicateBundle)).toBe(false);
    await flushQueue();

    expect(requests).toHaveLength(1);
    const request = requests[0];
    if (!request) {
      throw new Error("Expected the registered export request to run");
    }
    expect(request.worldObstacleMask).toEqual(new Uint8Array([1, 2, 3]));
    expect(request.state.battleRevision).toBe("revision");
    expect(request.report.elapsedMs).toBe(1000);
    expect(createGraphwarAgentClearFailureSceneKey(request.state)).toBe('["game","turn","revision"]');
    expect(
      createGraphwarAgentClearFailureSceneKey(createBundle("game\u0000turn", "revision", "tail").sceneState),
    ).not.toBe(createGraphwarAgentClearFailureSceneKey(createBundle("game", "turn\u0000revision", "tail").sceneState));
    expect(
      createGraphwarAgentClearFailureSceneKey(createBundle("game", undefined, "revision").sceneState),
    ).toBeUndefined();
  });

  it("serializes different scenes and clears only work that has not started", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const events: string[] = [];
    const queue = createGraphwarAgentClearFailureExportQueue({
      exportRequest: async (request) => {
        events.push(`start:${request.state.gameInstanceId}`);
        if (request.state.gameInstanceId === "first") {
          await firstPending;
        }
        events.push(`finish:${request.state.gameInstanceId}`);
      },
    });

    expect(queue.enqueue("deadline", createBundle("first", "turn", "revision"))).toBe(true);
    expect(events).toEqual([]);
    await Promise.resolve();
    expect(events).toEqual(["start:first"]);
    expect(queue.enqueue("search-failure", createBundle("second", "turn", "revision"))).toBe(true);

    queue.clearPending();
    releaseFirst?.();
    await flushQueue();
    expect(events).toEqual(["start:first", "finish:first"]);
  });

  it("does not retry a failed scene and continues with the next scene", async () => {
    const attempts: string[] = [];
    const onExportFailed = vi.fn();
    const first = createBundle("first", "turn", "revision");
    const queue = createGraphwarAgentClearFailureExportQueue({
      exportRequest: (request) => {
        attempts.push(request.state.gameInstanceId);
        if (request.state.gameInstanceId === "first") {
          throw new Error("download failed");
        }
      },
      onExportFailed,
    });

    expect(queue.enqueue("search-error", first)).toBe(true);
    expect(queue.enqueue("deadline", first)).toBe(false);
    expect(queue.enqueue("incomplete", createBundle("second", "turn", "revision"))).toBe(true);
    await flushQueue();

    expect(attempts).toEqual(["first", "second"]);
    expect(onExportFailed).toHaveBeenCalledOnce();
  });
});
