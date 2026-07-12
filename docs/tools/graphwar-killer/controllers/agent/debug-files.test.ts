import { describe, expect, it } from "vitest";

import type { GraphwarAgentAvailableState } from "./client";
import { createGraphwarAgentDebugFiles } from "./debug-files";

const firstState = { battleRevision: "first" } as GraphwarAgentAvailableState;
const secondState = { battleRevision: "second" } as GraphwarAgentAvailableState;

describe("Graphwar Agent debug files", () => {
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
