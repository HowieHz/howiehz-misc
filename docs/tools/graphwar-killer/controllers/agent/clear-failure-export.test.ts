import { describe, expect, it, vi } from "vitest";

import {
  createGraphwarAgentClearFailureExportQueue,
  createGraphwarAgentClearFailureSceneKey,
  type GraphwarAgentClearFailureExportRequest,
} from "./clear-failure-export";
import type { GraphwarAgentAvailableState, GraphwarAgentSnapshot } from "./client";

/** 创建自动导出测试只会读取的最小权威快照。 */
function createSnapshot(gameInstanceId: string, turnToken: string | undefined, battleRevision: string) {
  return {
    state: { battleRevision, gameInstanceId, turnToken } as GraphwarAgentAvailableState,
    worldObstacleMask: new Uint8Array([1, 2, 3]),
  } as GraphwarAgentSnapshot;
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
    const snapshot = createSnapshot("game", "turn", "revision");
    const duplicateSnapshot = createSnapshot("game", "turn", "revision");

    expect(queue.enqueue("incomplete", snapshot)).toBe(true);
    snapshot.worldObstacleMask[0] = 9;
    snapshot.state.battleRevision = "changed";
    expect(queue.enqueue("search-error", duplicateSnapshot)).toBe(false);
    await flushQueue();

    expect(requests).toHaveLength(1);
    const request = requests[0];
    if (!request) {
      throw new Error("Expected the registered export request to run");
    }
    expect(request.worldObstacleMask).toEqual(new Uint8Array([1, 2, 3]));
    expect(request.state.battleRevision).toBe("revision");
    expect(createGraphwarAgentClearFailureSceneKey(request.state)).toBe('["game","turn","revision"]');
    expect(
      createGraphwarAgentClearFailureSceneKey(createSnapshot("game\u0000turn", "revision", "tail").state),
    ).not.toBe(createGraphwarAgentClearFailureSceneKey(createSnapshot("game", "turn\u0000revision", "tail").state));
    expect(
      createGraphwarAgentClearFailureSceneKey(createSnapshot("game", undefined, "revision").state),
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

    expect(queue.enqueue("deadline", createSnapshot("first", "turn", "revision"))).toBe(true);
    expect(events).toEqual([]);
    await Promise.resolve();
    expect(events).toEqual(["start:first"]);
    expect(queue.enqueue("search-failure", createSnapshot("second", "turn", "revision"))).toBe(true);

    queue.clearPending();
    releaseFirst?.();
    await flushQueue();
    expect(events).toEqual(["start:first", "finish:first"]);
  });

  it("does not retry a failed scene and continues with the next scene", async () => {
    const attempts: string[] = [];
    const onExportFailed = vi.fn();
    const first = createSnapshot("first", "turn", "revision");
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
    expect(queue.enqueue("incomplete", createSnapshot("second", "turn", "revision"))).toBe(true);
    await flushQueue();

    expect(attempts).toEqual(["first", "second"]);
    expect(onExportFailed).toHaveBeenCalledOnce();
  });
});
