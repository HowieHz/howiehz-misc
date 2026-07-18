import { describe, expect, it } from "vitest";

import type { GraphwarAgentAvailableState } from "./client";
import { createGraphwarAgentDebugDownloads, createGraphwarAgentDebugFiles } from "./debug-files";

const firstState = { battleRevision: "first" } as GraphwarAgentAvailableState;
const secondState = { battleRevision: "second" } as GraphwarAgentAvailableState;

describe("Graphwar Agent debug files", () => {
  it("exports a timestamp-matched pair that preserves state and world-mask bytes", () => {
    const mask = new Uint8Array([0, 1, 1, 0]);
    const exportedAt = new Date("2026-07-12T15:30:45.123Z");
    const downloads = createGraphwarAgentDebugDownloads(firstState, mask, { exportedAt });

    expect(downloads.state.fileName).toBe("state-2026-07-12T15-30-45-123Z.json");
    expect(downloads.obstacle.fileName).toBe("obstacle-mask-2026-07-12T15-30-45-123Z.bin");
    expect(JSON.parse(downloads.state.content as string)).toEqual(firstState);
    expect(new Uint8Array(downloads.obstacle.content as ArrayBuffer)).toEqual(mask);

    const automaticDownloads = createGraphwarAgentDebugDownloads(firstState, mask, {
      exportedAt,
      failureKind: "deadline",
    });
    expect(automaticDownloads.state.fileName).toBe("clear-failure-deadline-state-2026-07-12T15-30-45-123Z.json");
    expect(automaticDownloads.obstacle.fileName).toBe(
      "clear-failure-deadline-obstacle-mask-2026-07-12T15-30-45-123Z.bin",
    );
  });

  it("accepts state and obstacle files in either order", () => {
    const stateFirst = createGraphwarAgentDebugFiles();
    const stateFirstBuffer = new ArrayBuffer(1);
    expect(stateFirst.setState(firstState)).toBeUndefined();
    expect(stateFirst.setObstacleBuffer(stateFirstBuffer)).toEqual({
      obstacleBuffer: stateFirstBuffer,
      state: firstState,
    });

    const obstacleFirst = createGraphwarAgentDebugFiles();
    const obstacleFirstBuffer = new ArrayBuffer(2);
    expect(obstacleFirst.setObstacleBuffer(obstacleFirstBuffer)).toBeUndefined();
    expect(obstacleFirst.setState(firstState)).toEqual({
      obstacleBuffer: obstacleFirstBuffer,
      state: firstState,
    });
  });

  it("drops the old obstacle when replacing state and starts empty after clear", () => {
    const files = createGraphwarAgentDebugFiles();
    const oldBuffer = new ArrayBuffer(1);
    files.setObstacleBuffer(oldBuffer);
    expect(files.setState(firstState)).toEqual({ obstacleBuffer: oldBuffer, state: firstState });

    expect(files.setState(secondState)).toBeUndefined();
    const nextBuffer = new ArrayBuffer(2);
    expect(files.setObstacleBuffer(nextBuffer)).toEqual({ obstacleBuffer: nextBuffer, state: secondState });

    files.clear();
    expect(files.setObstacleBuffer(new ArrayBuffer(3))).toBeUndefined();
  });
});
