import { describe, expect, it } from "vitest";

import { createGraphPoint, createPixelPoint } from "../../core/types";
import {
  captureGraphwarFinalReplaySnapshot,
  graphwarFinalReplaySnapshotMatches,
  type GraphwarFinalReplayRequest,
} from "./final-replay-snapshot";
import type { GraphwarTrajectorySampleResult } from "./sampling";

const settings = {
  algorithm: "step" as const,
  decimalPlaces: 4,
  equation: "dy" as const,
  steepness: 67,
  stepGlitchMode: true,
  stepOverflowProtection: true,
};

describe("Graphwar final replay snapshot", () => {
  it("copies every mutable request and result array before crossing the Module seam", () => {
    const request = createRequest();
    const result = createResult();
    const snapshot = captureGraphwarFinalReplaySnapshot({ ...request, result });

    const pathPoint = request.path[0];
    const requiredTarget = request.requiredTargets[0];
    const targetControlPoint = request.targetControlPoints[0];
    const targetSequenceEntry = request.targetSequence[0];
    const trackedTarget = request.trackedTargets[0];
    const samplePoint = result.sample.points[0];
    const endState = result.sample.endState;
    const visiblePixel = result.visiblePixels[0];
    if (
      !pathPoint ||
      !requiredTarget ||
      !targetControlPoint ||
      !targetSequenceEntry ||
      !trackedTarget ||
      !samplePoint ||
      !endState ||
      !visiblePixel
    ) {
      throw new Error("Snapshot copy fixture is incomplete");
    }

    pathPoint.x += 1;
    requiredTarget.center.y += 1;
    request.simulationMask[0] = 1;
    targetControlPoint.y += 1;
    targetSequenceEntry.radius += 1;
    trackedTarget.center.x += 1;
    samplePoint.y += 1;
    endState.currentPoint.x += 1;
    result.trackedTargetHitIndexes[0] = 99;
    visiblePixel.x += 1;

    expect(snapshot.path[0]).toEqual(createPixelPoint(10, 20));
    expect(snapshot.requiredTargets[0]?.center).toEqual(createPixelPoint(30, 40));
    expect(snapshot.simulationMask[0]).toBe(0);
    expect(snapshot.targetControlPoints[0]).toEqual(createPixelPoint(50, 60));
    expect(snapshot.targetSequence[0]?.radius).toBe(3);
    expect(snapshot.trackedTargets[0]?.center).toEqual(createPixelPoint(70, 80));
    expect(snapshot.result.sample.points[0]).toEqual(createGraphPoint(-10, 0));
    expect(snapshot.result.sample.endState?.currentPoint).toEqual(createGraphPoint(-5, 1));
    expect(snapshot.result.trackedTargetHitIndexes).toEqual([2]);
    expect(snapshot.result.visiblePixels[0]).toEqual(createPixelPoint(100, 200));
  });

  it("matches an unchanged complete replay request", () => {
    const request = createRequest();
    const snapshot = captureGraphwarFinalReplaySnapshot({ ...request, result: createResult() });

    expect(graphwarFinalReplaySnapshotMatches(snapshot, request)).toBe(true);
  });

  it.each([
    ["boundary expansion", (request: GraphwarFinalReplayRequest) => ({ ...request, boundaryExpansion: 2 })],
    ["bounds", (request: GraphwarFinalReplayRequest) => ({ ...request, bounds: { ...request.bounds, maxX: 26 } })],
    [
      "bounds rect",
      (request: GraphwarFinalReplayRequest) => ({ ...request, boundsRect: { ...request.boundsRect, width: 769 } }),
    ],
    [
      "formula settings",
      (request: GraphwarFinalReplayRequest) => ({
        ...request,
        formulaSettings: { ...request.formulaSettings, decimalPlaces: 5 },
      }),
    ],
    [
      "path",
      (request: GraphwarFinalReplayRequest) => ({
        ...request,
        path: [createPixelPoint(10, 20), createPixelPoint(31, 40)],
      }),
    ],
    [
      "required target order",
      (request: GraphwarFinalReplayRequest) => ({
        ...request,
        requiredTargets: [...request.requiredTargets].reverse(),
      }),
    ],
    [
      "simulation mask bytes",
      (request: GraphwarFinalReplayRequest) => {
        const simulationMask = request.simulationMask.slice();
        simulationMask[0] = 1;
        return { ...request, simulationMask };
      },
    ],
    [
      "simulation mask cache identity",
      (request: GraphwarFinalReplayRequest) => ({ ...request, simulationMaskCacheId: 8 }),
    ],
    [
      "target control points",
      (request: GraphwarFinalReplayRequest) => ({
        ...request,
        targetControlPoints: [createPixelPoint(50, 61)],
      }),
    ],
    [
      "target sequence",
      (request: GraphwarFinalReplayRequest) => ({
        ...request,
        targetSequence: [{ center: createPixelPoint(51, 60), radius: 3 }],
      }),
    ],
    [
      "tracked targets",
      (request: GraphwarFinalReplayRequest) => ({
        ...request,
        trackedTargets: [{ center: createPixelPoint(70, 80), radius: 5 }],
      }),
    ],
  ] as const)("rejects a snapshot when %s differs", (_name, change) => {
    const request = createRequest();
    const snapshot = captureGraphwarFinalReplaySnapshot({ ...request, result: createResult() });

    expect(graphwarFinalReplaySnapshotMatches(snapshot, change(request))).toBe(false);
  });
});

/** 创建带两项 required target 的请求，顺序失配测试不会退化成恒等数组。 */
function createRequest(): GraphwarFinalReplayRequest {
  return {
    boundaryExpansion: 1,
    bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
    boundsRect: { height: 450, width: 770, x: 0, y: 0 },
    formulaSettings: settings,
    path: [createPixelPoint(10, 20), createPixelPoint(30, 40)],
    replaySemantics: "full-natural-visible",
    requiredTargets: [
      { center: createPixelPoint(30, 40), radius: 2 },
      { center: createPixelPoint(40, 50), radius: 2 },
    ],
    simulationMask: new Uint8Array(770 * 450),
    simulationMaskCacheId: 7,
    targetControlPoints: [createPixelPoint(50, 60)],
    targetSequence: [{ center: createPixelPoint(50, 60), radius: 3 }],
    trackedTargets: [{ center: createPixelPoint(70, 80), radius: 4 }],
  };
}

/** 创建覆盖 sample/endState/索引/可见像素的完整输出。 */
function createResult(): GraphwarTrajectorySampleResult {
  return {
    obstacleHitIndex: -1,
    reachedRequiredTargetCount: 2,
    reachedTargetCount: 1,
    requiredTargetsHitIndex: 2,
    sample: {
      endState: {
        currentPoint: createGraphPoint(-5, 1),
        dy: 0.5,
        previousDy: 0.4,
        previousPoint: createGraphPoint(-5.1, 0.9),
        sampleIndex: 2,
      },
      points: [createGraphPoint(-10, 0), createGraphPoint(-5, 1)],
      stopReason: "stopped",
    },
    targetHitIndex: 1,
    trackedTargetHitIndexes: [2],
    visiblePixels: [createPixelPoint(100, 200)],
  };
}
