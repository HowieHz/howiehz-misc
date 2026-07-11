import { beforeEach, describe, expect, it, vi } from "vitest";

import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { graphToImagePoint } from "../../core/geometry";
import { createGraphPoint } from "../../core/types";
import type { BoundsRect, GraphBounds } from "../../core/types";
import type { GraphwarPathfindingRouteMode } from "../routing/mode";

const scanMockState = vi.hoisted(() => ({
  firstResult: "no-path" as "limit" | "no-path" | "passable",
  sourcePaths: [] as { x: number; y: number }[][],
}));

vi.mock("../routing/step-glitch-scan", async (importOriginal) => {
  const original = await importOriginal<typeof import("../routing/step-glitch-scan")>();
  return {
    ...original,
    scanGraphwarStepGlitchPath: vi.fn((options: Parameters<typeof original.scanGraphwarStepGlitchPath>[0]) => {
      scanMockState.sourcePaths.push(options.sourcePath.map((point) => ({ ...point })));
      if (scanMockState.sourcePaths.length > 1) {
        return original.scanGraphwarStepGlitchPath(options);
      }
      if (scanMockState.firstResult === "passable") {
        return {
          acceptedPoint: { x: -8, y: 8 },
          expandedStates: 1,
          limitReached: false,
          path: [...options.sourcePath, options.targetPoint],
          reachedTargetCount: 0,
          status: "passable" as const,
        };
      }
      return {
        expandedStates: 1,
        limitReached: scanMockState.firstResult === "limit",
        reachedTargetCount: 0,
        reason: scanMockState.firstResult,
        status: "blocked" as const,
      };
    }),
  };
});

import { buildGraphwarOneClickClearPath } from "./search";

const bounds: GraphBounds = { maxX: -4, maxY: 10, minX: -12, minY: -10 };
const boundsRect: BoundsRect = {
  height: GRAPHWAR_PLANE_HEIGHT,
  width: GRAPHWAR_PLANE_LENGTH,
  x: 0,
  y: 0,
};

describe("Step glitch one-click-clear target retries", () => {
  beforeEach(() => {
    scanMockState.sourcePaths.length = 0;
  });

  it.each(
    (["passable", "no-path", "limit"] as const).flatMap((firstResult) =>
      (["visibility-graph", "theta-star"] as const).map((routeMode) => ({ firstResult, routeMode })),
    ),
  )(
    "retries after $firstResult with $routeMode and applies the matching deletion policy",
    async ({ firstResult, routeMode }) => {
      scanMockState.firstResult = firstResult;
      const start = toPixel(-11, 0);
      const missed = toPixel(-9, 8);
      const hit = toPixel(-6, 0);
      const simulationMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
      const debugStages: string[] = [];
      const candidates = [
        { enemy: true, hitCenter: missed, hitRadius: 2, id: "missed" },
        { enemy: true, hitCenter: hit, hitRadius: 12, id: "hit" },
      ];

      const result = await buildGraphwarOneClickClearPath({
        boundaryExpansion: 0,
        bounds,
        boundsRect,
        buildDagEdges: () => {
          throw new Error("Step glitch clear must not build DAG edges");
        },
        candidates,
        deleteHitCheckRadiusPixels: 0,
        hitCandidates: candidates,
        onDebugTiming: (timing) => debugStages.push(timing.stage),
        pathPoints: [start],
        routeMask: { mask: simulationMask, routeTolerancePlanePixels: 2 },
        routeMode,
        settings: {
          algorithm: "step",
          decimalPlaces: 4,
          equation: "dy",
          steepness: 67,
          stepGlitchMode: true,
          stepGlitchObstacleMask: simulationMask,
          stepOverflowProtection: true,
        },
        simulationBoundaryExpansion: 0,
        simulationMask,
      });

      expect(scanMockState.sourcePaths).toHaveLength(2);
      expect(scanMockState.sourcePaths[1]).toEqual([start]);
      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.targetIds).toEqual(["hit"]);
      }
      expect(debugStages.includes("optimize-path")).toBe(stepGlitchModeRunsPointDeletion(routeMode));
    },
  );
});

function stepGlitchModeRunsPointDeletion(routeMode: GraphwarPathfindingRouteMode) {
  return routeMode === "theta-star";
}

function toPixel(x: number, y: number) {
  return graphToImagePoint(createGraphPoint(x, y), bounds, boundsRect);
}
