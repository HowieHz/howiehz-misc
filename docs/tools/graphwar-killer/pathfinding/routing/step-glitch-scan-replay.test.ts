import { beforeEach, describe, expect, it, vi } from "vitest";

import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { graphToImagePoint } from "../../core/geometry";
import { createGraphPoint } from "../../core/types";
import type { BoundsRect, GraphBounds } from "../../core/types";

const replayMockState = vi.hoisted(() => ({ targetHitIndex: 1 }));

vi.mock("../../formula/trajectory/sampling", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../formula/trajectory/sampling")>();
  return {
    ...original,
    sampleGraphwarFormulaTrajectory: vi.fn(() => ({
      earlyStopReason: "obstacle" as const,
      obstacleHitIndex: 2,
      reachedTargetCount: 1,
      sample: {
        points: [
          { x: -7, y: 0 },
          { x: -6, y: 0 },
          { x: -5.99, y: 0 },
        ],
        stopReason: "stopped" as const,
      },
      targetHitIndex: replayMockState.targetHitIndex,
      trackedTargetHitIndexes: [],
      visiblePixels: [],
    })),
  };
});

import { scanGraphwarStepGlitchPath } from "./step-glitch-scan";

const bounds: GraphBounds = { maxX: -4, maxY: 10, minX: -12, minY: -10 };
const boundsRect: BoundsRect = {
  height: GRAPHWAR_PLANE_HEIGHT,
  width: GRAPHWAR_PLANE_LENGTH,
  x: 0,
  y: 0,
};

describe("Step glitch scanner replay acceptance", () => {
  beforeEach(() => {
    replayMockState.targetHitIndex = 1;
  });

  it("accepts a target sequence completed at a safe control-x sample", () => {
    expect(scanDirectTarget().status).toBe("hit");
  });

  it("rejects a target sequence completed only on the obstacle sample", () => {
    replayMockState.targetHitIndex = 2;

    expect(scanDirectTarget().status).toBe("no-path");
  });
});

function scanDirectTarget() {
  const start = graphToImagePoint(createGraphPoint(-11, 0), bounds, boundsRect);
  const target = graphToImagePoint(createGraphPoint(-6, 0), bounds, boundsRect);
  return scanGraphwarStepGlitchPath({
    bounds,
    boundsRect,
    hitTarget: { center: target, radius: 12 },
    settings: {
      algorithm: "step",
      decimalPlaces: 4,
      equation: "dy",
      steepness: 67,
      stepGlitchMode: true,
      stepOverflowProtection: true,
    },
    simulationMask: new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT),
    sourcePath: [start],
    targetPoint: target,
  });
}
