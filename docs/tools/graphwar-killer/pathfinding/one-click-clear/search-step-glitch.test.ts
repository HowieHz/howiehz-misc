import { beforeEach, describe, expect, it, vi } from "vitest";

import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { graphToImagePoint } from "../../core/geometry";
import { createGraphPoint } from "../../core/types";
import type { BoundsRect, GraphBounds, PixelPoint } from "../../core/types";
import type { GraphwarPathfindingRouteMode } from "../routing/mode";

const scanMockState = vi.hoisted(() => ({
  outcomes: [] as ("hit" | "no-path")[],
  scanners: [] as {
    requiredTargets: { center: { x: number; y: number }; radius: number }[];
    sourcePath: { x: number; y: number }[];
  }[],
  scans: [] as { scannerId: number; targetPoint: { x: number; y: number } }[],
}));

vi.mock("../routing/step-glitch-scan", async (importOriginal) => {
  const original = await importOriginal<typeof import("../routing/step-glitch-scan")>();
  return {
    ...original,
    createGraphwarStepGlitchPrefixScanner: vi.fn(
      (options: Parameters<typeof original.createGraphwarStepGlitchPrefixScanner>[0]) => {
        const scannerId = scanMockState.scanners.length;
        scanMockState.scanners.push({
          requiredTargets: (options.requiredTargetSequence ?? []).map((target) => ({
            center: { ...target.center },
            radius: target.radius,
          })),
          sourcePath: options.sourcePath.map((point) => ({ ...point })),
        });
        return {
          scan: (target: Parameters<ReturnType<typeof original.createGraphwarStepGlitchPrefixScanner>["scan"]>[0]) => {
            const outcome = scanMockState.outcomes.shift();
            if (!outcome) {
              throw new Error("Missing Step glitch scanner mock outcome");
            }
            scanMockState.scans.push({ scannerId, targetPoint: { ...target.targetPoint } });
            if (outcome === "hit") {
              return {
                acceptedPoint: { x: 0, y: 0 },
                expandedStates: 1,
                path: [...options.sourcePath, target.targetPoint],
                reachedTargetCount: (options.requiredTargetSequence?.length ?? 0) + 1,
                status: "hit" as const,
              };
            }
            return {
              expandedStates: 1,
              reachedTargetCount: options.requiredTargetSequence?.length ?? 0,
              status: "no-path" as const,
            };
          },
        };
      },
    ),
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
    scanMockState.outcomes.length = 0;
    scanMockState.scanners.length = 0;
    scanMockState.scans.length = 0;
  });

  it.each(["visibility-graph", "theta-star"] as const)(
    "permanently skips no-path with %s and applies the matching deletion policy",
    async (routeMode) => {
      scanMockState.outcomes.push("no-path", "hit");
      const start = toPixel(-11, 0);
      const missed = toPixel(-9, 8);
      const hit = toPixel(-6, 0);
      const simulationMask = createEmptyMask();
      const debugStages: string[] = [];
      const candidates = [
        { enemy: true, hitCenter: missed, hitRadius: 2, id: "missed" },
        { enemy: true, hitCenter: hit, hitRadius: 12, id: "hit" },
      ];

      const result = await buildGraphwarOneClickClearPath({
        ...createOptions(start, candidates, simulationMask, routeMode),
        onDebugTiming: (timing) => debugStages.push(timing.stage),
      });

      expect(scanMockState.scanners).toHaveLength(1);
      expect(scanMockState.scans.map((scan) => scan.scannerId)).toEqual([0, 0]);
      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.targetIds).toEqual(["hit"]);
        expect(result.pathPoints.at(-1)).toEqual(hit);
      }
      expect(debugStages.includes("optimize-path")).toBe(stepGlitchModeRunsPointDeletion(routeMode));
    },
  );

  it("commits a fixed prefix edge-by-edge, reuses it after failure, and counts an incidental skipped hit", async () => {
    scanMockState.outcomes.push("hit", "hit", "no-path", "hit", "hit");
    const start = toPixel(-11, 0);
    const targetPoints = [-10, -9, -8, -7, -6].map((x) => toPixel(x, 0));
    const candidates = targetPoints.map((hitCenter, index) => ({
      enemy: true,
      hitCenter,
      hitRadius: 12,
      id: String(index + 2),
    }));
    const simulationMask = createEmptyMask();

    const result = await buildGraphwarOneClickClearPath({
      ...createOptions(start, candidates, simulationMask, "visibility-graph"),
    });

    expect(scanMockState.scans.map((scan) => scan.scannerId)).toEqual([0, 1, 2, 2, 3]);
    expect(scanMockState.scanners.map((scanner) => scanner.sourcePath.length)).toEqual([1, 2, 3, 4]);
    expect(scanMockState.scanners.map((scanner) => scanner.requiredTargets.length)).toEqual([0, 1, 2, 3]);
    expect(scanMockState.scanners[3]?.requiredTargets.map((target) => target.center)).toEqual([
      targetPoints[0],
      targetPoints[1],
      targetPoints[3],
    ]);
    expect(scanMockState.scans.filter((scan) => scan.targetPoint.x === targetPoints[2]?.x)).toHaveLength(1);
    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.pathPoints).toEqual([start, targetPoints[0], targetPoints[1], targetPoints[3], targetPoints[4]]);
      expect(result.targetIds).toEqual(["2", "3", "4", "5", "6"]);
    }
  });

  it("keeps committed target anchors during point deletion", async () => {
    scanMockState.outcomes.push("hit", "hit");
    const start = toPixel(-11, 0);
    const first = toPixel(-9, 0);
    const second = toPixel(-6, 0);
    const candidates = [
      { enemy: true, hitCenter: first, hitRadius: 12, id: "first" },
      { enemy: true, hitCenter: second, hitRadius: 12, id: "second" },
    ];
    const simulationMask = createEmptyMask();

    const result = await buildGraphwarOneClickClearPath({
      ...createOptions(start, candidates, simulationMask, "theta-star"),
    });

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.pathPoints).toEqual([start, first, second]);
    }
  });

  it("rejects a hit that collides before reaching the assigned target x", async () => {
    scanMockState.outcomes.push("hit");
    const start = toPixel(-11, 0);
    const target = toPixel(-6, 0);
    const simulationMask = createEmptyMask();
    const wallX = Math.floor(toPixel(-8, 0).x);
    for (let row = 0; row < GRAPHWAR_PLANE_HEIGHT; row += 1) {
      simulationMask[row * GRAPHWAR_PLANE_LENGTH + wallX] = 1;
    }
    const candidates = [{ enemy: true, hitCenter: target, hitRadius: 300, id: "early-hit" }];

    const result = await buildGraphwarOneClickClearPath({
      ...createOptions(start, candidates, simulationMask, "visibility-graph"),
    });

    expect(result).toMatchObject({ reason: "no-usable-target", type: "failure" });
  });
});

function createOptions(
  start: PixelPoint,
  candidates: { enemy: boolean; hitCenter: PixelPoint; hitRadius: number; id: string }[],
  simulationMask: Uint8Array,
  routeMode: GraphwarPathfindingRouteMode,
) {
  return {
    boundaryExpansion: 0,
    bounds,
    boundsRect,
    buildDagEdges: () => {
      throw new Error("Step glitch clear must not build DAG edges");
    },
    candidates,
    deleteHitCheckRadiusPixels: 0,
    hitCandidates: candidates,
    pathPoints: [start],
    routeMask: { mask: simulationMask, routeTolerancePlanePixels: 2 },
    routeMode,
    settings: {
      algorithm: "step" as const,
      decimalPlaces: 4,
      equation: "dy" as const,
      steepness: 67,
      stepGlitchMode: true,
      stepGlitchObstacleMask: simulationMask,
      stepOverflowProtection: true,
    },
    simulationBoundaryExpansion: 0,
    simulationMask,
  };
}

function stepGlitchModeRunsPointDeletion(routeMode: GraphwarPathfindingRouteMode) {
  return routeMode === "theta-star";
}

function createEmptyMask() {
  return new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
}

function toPixel(x: number, y: number) {
  return graphToImagePoint(createGraphPoint(x, y), bounds, boundsRect);
}
