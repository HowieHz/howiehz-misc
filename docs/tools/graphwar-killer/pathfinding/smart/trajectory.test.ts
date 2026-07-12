import { describe, expect, it } from "vitest";

import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { graphToImagePoint } from "../../core/geometry";
import { createGraphPoint } from "../../core/types";
import type { BoundsRect, GraphBounds } from "../../core/types";
import { createGraphwarSmartPathfindingTrajectoryResult } from "./trajectory";

const bounds: GraphBounds = { maxX: -4, maxY: 10, minX: -12, minY: -10 };
const boundsRect: BoundsRect = { height: GRAPHWAR_PLANE_HEIGHT, width: GRAPHWAR_PLANE_LENGTH, x: 0, y: 0 };

describe("Step glitch smart trajectory validation", () => {
  it("rejects an early circle hit when an obstacle blocks the assigned target x", () => {
    const start = toPixel(-11, 0);
    const target = toPixel(-6, 0);
    const obstacleMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    const wallX = Math.floor(toPixel(-8, 0).x);
    for (let row = 0; row < GRAPHWAR_PLANE_HEIGHT; row += 1) {
      obstacleMask[row * GRAPHWAR_PLANE_LENGTH + wallX] = 1;
    }

    const result = createGraphwarSmartPathfindingTrajectoryResult({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      hitTarget: { center: target, radius: 300 },
      obstacleMask,
      points: [start, target],
      settings: {
        algorithm: "step",
        decimalPlaces: 4,
        equation: "dy",
        steepness: 67,
        stepGlitchMode: true,
        stepGlitchObstacleMask: obstacleMask,
        stepOverflowProtection: true,
      },
      targetHitRadiusPixels: 300,
    });

    expect(result.reachesTargetBeforeObstacle).toBe(false);
    expect(result.blockedPoint).toBeDefined();
  });

  it("validates only the target requested by this single-target search", () => {
    const start = toPixel(-11, 0);
    const target = toPixel(-8, 0);

    const result = createGraphwarSmartPathfindingTrajectoryResult({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      hitTarget: { center: target, radius: 2 },
      obstacleMask: new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT),
      points: [start, target],
      settings: {
        algorithm: "step",
        decimalPlaces: 4,
        equation: "y",
        steepness: 67,
        stepGlitchMode: false,
        stepOverflowProtection: true,
      },
      targetHitRadiusPixels: 2,
    });

    expect(result.reachesTargetBeforeObstacle).toBe(true);
  });
});

function toPixel(x: number, y: number) {
  return graphToImagePoint(createGraphPoint(x, y), bounds, boundsRect);
}
