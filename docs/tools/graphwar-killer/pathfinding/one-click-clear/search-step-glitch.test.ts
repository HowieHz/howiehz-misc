import { beforeEach, describe, expect, it, vi } from "vitest";

import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { graphToImagePoint, imageToGraphPoint } from "../../core/geometry";
import { imageXToNearestPlaneColumn, planeXToImageX } from "../../core/plane-grid";
import { createGraphPoint, createPixelPoint } from "../../core/types";
import type { BoundsRect, GraphBounds, PixelPoint } from "../../core/types";
import type { GraphwarPathfindingRouteMode } from "../routing/mode";

const scanMockState = vi.hoisted(() => ({
  outcomes: [] as ("hit" | "no-path")[],
  scanners: [] as {
    hasPrefixEvidence: boolean;
    requiredTargets: { center: { x: number; y: number }; radius: number }[];
    sourcePath: { x: number; y: number }[];
  }[],
  scans: [] as { scannerId: number; targetPoint: { x: number; y: number } }[],
}));
const samplingMockState = vi.hoisted(() => ({
  resolveTrajectory: undefined as
    | (typeof import("../../formula/trajectory/sampling"))["resolveGraphwarTrajectory"]
    | undefined,
  formulaContextCalls: 0,
  formulaContextInitialStatePresent: [] as boolean[],
  pathTargetSequenceCalls: 0,
  requiredTargets: [] as { x: number; y: number }[][],
  targetSequences: [] as { x: number; y: number }[][],
}));

vi.mock("../../formula/trajectory/sampling", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../formula/trajectory/sampling")>();
  samplingMockState.resolveTrajectory = original.resolveGraphwarTrajectory;
  return {
    ...original,
    resolveGraphwarTrajectory: vi.fn((options: Parameters<typeof original.resolveGraphwarTrajectory>[0]) => {
      return original.resolveGraphwarTrajectory(options);
    }),
    tryResolveGraphwarTrajectoryCandidate: vi.fn(
      (options: Parameters<typeof original.tryResolveGraphwarTrajectoryCandidate>[0]) => {
        samplingMockState.formulaContextCalls += 1;
        samplingMockState.formulaContextInitialStatePresent.push(options.initialState !== undefined);
        return original.tryResolveGraphwarTrajectoryCandidate(options);
      },
    ),
    sampleGraphwarPathTargetSequence: vi.fn(
      (options: Parameters<typeof original.sampleGraphwarPathTargetSequence>[0]) => {
        samplingMockState.pathTargetSequenceCalls += 1;
        samplingMockState.requiredTargets.push((options.requiredTargets ?? []).map((target) => ({ ...target.center })));
        samplingMockState.targetSequences.push((options.targetCircles ?? []).map((target) => ({ ...target.center })));
        return original.sampleGraphwarPathTargetSequence(options);
      },
    ),
  };
});

vi.mock("../routing/step-glitch-scan", async (importOriginal) => {
  const original = await importOriginal<typeof import("../routing/step-glitch-scan")>();
  return {
    ...original,
    createGraphwarStepGlitchPrefixScanner: vi.fn(
      (options: Parameters<typeof original.createGraphwarStepGlitchPrefixScanner>[0]) => {
        const scannerId = scanMockState.scanners.length;
        scanMockState.scanners.push({
          hasPrefixEvidence: options.prefixEvidence !== undefined,
          requiredTargets: (options.requiredTargets ?? []).map((target) => ({
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
              const path = [...options.sourcePath, target.targetPoint];
              const resolveTrajectory = samplingMockState.resolveTrajectory;
              if (!resolveTrajectory) {
                throw new Error("Formula context test factory is unavailable");
              }
              const graphPoints = path.map((point) => imageToGraphPoint(point, options.bounds, options.boundsRect));
              return {
                acceptedPoint: { x: 0, y: 0 },
                expandedStates: 1,
                formulaContext: resolveTrajectory({
                  bounds: options.bounds,
                  boundsRect: options.boundsRect,
                  points: graphPoints,
                  settings: { ...options.settings, stepGlitchMode: false },
                  soldierCenter: graphPoints[0],
                }).context,
                path,
                reachedTargetCount: (options.requiredTargets?.length ?? 0) + 1,
                status: "hit" as const,
                timings: [],
                trajectoryPoints: path,
              };
            }
            return {
              expandedStates: 1,
              reachedTargetCount: options.requiredTargets?.length ?? 0,
              status: "no-path" as const,
              timings: [],
            };
          },
        };
      },
    ),
  };
});

import { buildGraphwarOneClickClearPath, type GraphwarOneClickClearIncumbent } from "./search";

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
    samplingMockState.pathTargetSequenceCalls = 0;
    samplingMockState.formulaContextCalls = 0;
    samplingMockState.formulaContextInitialStatePresent.length = 0;
    samplingMockState.requiredTargets.length = 0;
    samplingMockState.targetSequences.length = 0;
  });

  it.each([
    { isDeleteOptimizationEnabled: false, routeMode: "visibility-graph" },
    { isDeleteOptimizationEnabled: true, routeMode: "visibility-graph" },
    { isDeleteOptimizationEnabled: false, routeMode: "theta-star" },
    { isDeleteOptimizationEnabled: true, routeMode: "theta-star" },
  ] as const)(
    "permanently skips no-path with $routeMode and deletion=$isDeleteOptimizationEnabled",
    async ({ isDeleteOptimizationEnabled, routeMode }) => {
      scanMockState.outcomes.push("no-path", "hit");
      const start = toPixel(-11, 0);
      const missed = toPixel(-9, 8);
      const hit = toPixel(-6, 0);
      const assignedHit = toNativeColumnPoint(hit);
      const simulationMask = createEmptyMask();
      const debugStages: string[] = [];
      const candidates = [
        { enemy: true, hitCenter: missed, hitRadius: 2, id: "missed" },
        { enemy: true, hitCenter: hit, hitRadius: 12, id: "hit" },
      ];

      const result = await buildGraphwarOneClickClearPath({
        ...createOptions(start, candidates, simulationMask, routeMode, isDeleteOptimizationEnabled),
        onDebugTiming: (timing) => debugStages.push(timing.stage),
      });

      expect(scanMockState.scanners).toHaveLength(1);
      expect(scanMockState.scans.map((scan) => scan.scannerId)).toEqual([0, 0]);
      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.targetIds).toEqual(["hit"]);
        expect(result.pathPoints.at(-1)).toEqual(assignedHit);
      }
      expect(samplingMockState.pathTargetSequenceCalls).toBe(1);
      expect(debugStages.includes("optimize-path")).toBe(isDeleteOptimizationEnabled);
      expect(debugStages).toContain("validate-final");
    },
  );

  it("keeps a fixed prefix edge-by-edge, reuses it after failure, and counts an incidental skipped hit", async () => {
    scanMockState.outcomes.push("hit", "hit", "no-path", "hit", "hit");
    const start = toPixel(-11, 0);
    const targetPoints = [-10, -9, -8, -7, -6].map((x) => toPixel(x, 0));
    const assignedTargetPoints = targetPoints.map(toNativeColumnPoint);
    const candidates = targetPoints.map((hitCenter, index) => ({
      enemy: true,
      hitCenter,
      hitRadius: 12,
      id: String(index + 2),
    }));
    const simulationMask = createEmptyMask();
    const incumbents: GraphwarOneClickClearIncumbent[] = [];

    const result = await buildGraphwarOneClickClearPath({
      ...createOptions(start, candidates, simulationMask, "visibility-graph"),
      onValidatedIncumbent: (incumbent) => incumbents.push(incumbent),
    });

    expect(scanMockState.scans.map((scan) => scan.scannerId)).toEqual([0, 1, 2, 2, 3]);
    expect(scanMockState.scanners.map((scanner) => scanner.sourcePath.length)).toEqual([1, 2, 3, 4]);
    expect(scanMockState.scanners.map((scanner) => scanner.hasPrefixEvidence)).toEqual([false, true, true, true]);
    expect(scanMockState.scanners.map((scanner) => scanner.requiredTargets.length)).toEqual([0, 1, 2, 3]);
    expect(scanMockState.scanners[3]?.requiredTargets.map((target) => target.center)).toEqual([
      targetPoints[0],
      targetPoints[1],
      targetPoints[3],
    ]);
    expect(scanMockState.scans.filter((scan) => scan.targetPoint.x === targetPoints[2]?.x)).toHaveLength(1);
    expect(incumbents.map((incumbent) => incumbent.pathPoints)).toEqual([
      [start, assignedTargetPoints[0]],
      [start, assignedTargetPoints[0], assignedTargetPoints[1]],
      [start, assignedTargetPoints[0], assignedTargetPoints[1], assignedTargetPoints[3]],
      [start, assignedTargetPoints[0], assignedTargetPoints[1], assignedTargetPoints[3], assignedTargetPoints[4]],
    ]);
    // Four intermediate publications reuse scanner validation; only the normal final safety pass samples here.
    expect(samplingMockState.formulaContextCalls).toBe(0);
    expect(samplingMockState.pathTargetSequenceCalls).toBe(1);
    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.pathPoints).toEqual([
        start,
        assignedTargetPoints[0],
        assignedTargetPoints[1],
        assignedTargetPoints[3],
        assignedTargetPoints[4],
      ]);
      expect(result.targetIds).toEqual(["2", "3", "4", "5", "6"]);
    }
  });

  it("assigns distinct native columns within one preferred-column group and omits exhausted targets", async () => {
    scanMockState.outcomes.push("hit", "no-path");
    const start = toPixel(-11, 0);
    const centerX = toPixel(-6, 0).x;
    const candidates = [
      { enemy: true, hitCenter: createPixelPoint(centerX, 320), hitRadius: 0.6, id: "first-small" },
      { enemy: true, hitCenter: createPixelPoint(centerX, 280), hitRadius: 5, id: "wide" },
      { enemy: true, hitCenter: createPixelPoint(centerX, 240), hitRadius: 0.6, id: "exhausted-1" },
      { enemy: true, hitCenter: createPixelPoint(centerX, 200), hitRadius: 0.6, id: "exhausted-2" },
      { enemy: true, hitCenter: createPixelPoint(centerX, 160), hitRadius: 0.6, id: "exhausted-3" },
    ];

    await buildGraphwarOneClickClearPath(
      createOptions(start, candidates, createEmptyMask(), "visibility-graph", false),
    );

    expect(scanMockState.scans.map((scan) => scan.scannerId)).toEqual([0, 1]);
    expect(scanMockState.scans.map((scan) => scan.targetPoint)).toEqual([
      createPixelPoint(577, 320),
      createPixelPoint(578, 280),
    ]);
  });

  it("does not carry an old path target into a new request", async () => {
    scanMockState.outcomes.push("hit");
    const start = toPixel(-11, 0);
    const oldTarget = toPixel(-9, 0);
    const nextTarget = toPixel(-6, 0);
    const simulationMask = createEmptyMask();
    const result = await buildGraphwarOneClickClearPath({
      ...createOptions(
        start,
        [{ enemy: true, hitCenter: nextTarget, hitRadius: 12, id: "next" }],
        simulationMask,
        "visibility-graph",
      ),
      pathPoints: [start, oldTarget],
      prefixTarget: { center: oldTarget, radius: 12 },
    });

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.targetIds).toEqual(["next"]);
    }
    expect(samplingMockState.requiredTargets.at(-1)).toEqual([]);
    expect(samplingMockState.targetSequences.at(-1)).toEqual([nextTarget]);
  });

  it("does not report success when every new target fails", async () => {
    scanMockState.outcomes.push("no-path");
    const start = toPixel(-11, 0);
    const oldTarget = toPixel(-9, 0);
    const missedTarget = toPixel(-6, 8);
    const simulationMask = createEmptyMask();
    const result = await buildGraphwarOneClickClearPath({
      ...createOptions(
        start,
        [{ enemy: true, hitCenter: missedTarget, hitRadius: 2, id: "missed" }],
        simulationMask,
        "visibility-graph",
      ),
      pathPoints: [start, oldTarget],
      prefixTarget: { center: oldTarget, radius: 12 },
    });

    expect(result).toMatchObject({ reason: "no-usable-target", type: "failure" });
  });

  it("does not turn an old path tail into a target during final validation", async () => {
    scanMockState.outcomes.push("hit");
    const start = toPixel(-11, 0);
    const ordinaryTail = toPixel(-9, 4);
    const nextTarget = toPixel(-6, 0);
    const simulationMask = createEmptyMask();
    const result = await buildGraphwarOneClickClearPath({
      ...createOptions(
        start,
        [{ enemy: true, hitCenter: nextTarget, hitRadius: 12, id: "next" }],
        simulationMask,
        "visibility-graph",
      ),
      pathPoints: [start, ordinaryTail],
      prefixTarget: { center: ordinaryTail, radius: 1 },
    });

    expect(result.type).toBe("success");
    expect(samplingMockState.targetSequences.at(-1)).toEqual([nextTarget]);
  });

  it("starts a new request without historical target constraints", async () => {
    scanMockState.outcomes.push("hit");
    const start = toPixel(-11, 0);
    const tail = toPixel(-9, 0);
    const nextTarget = toPixel(-8, 0);
    const simulationMask = createEmptyMask();
    const result = await buildGraphwarOneClickClearPath({
      ...createOptions(
        start,
        [{ enemy: true, hitCenter: nextTarget, hitRadius: 12, id: "next" }],
        simulationMask,
        "visibility-graph",
      ),
      pathPoints: [start, tail],
      prefixTarget: { center: tail, radius: 1 },
    });

    expect(result.type).toBe("success");
    expect(scanMockState.scanners[0]?.requiredTargets).toEqual([]);
    expect(samplingMockState.requiredTargets.at(-1)).toEqual([]);
    expect(samplingMockState.targetSequences.at(-1)).toEqual([nextTarget]);
  });

  it("keeps current-request target anchors during point deletion", async () => {
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
      expect(result.pathPoints).toEqual([start, toNativeColumnPoint(first), toNativeColumnPoint(second)]);
    }
  });

  it("rejects a hit that collides before reaching the assigned target x", async () => {
    // The real scanner reports no-path because its hit contract already includes reaching the assigned control x.
    scanMockState.outcomes.push("no-path");
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

  it("replays ABS y'' candidates from the muzzle instead of reusing a smooth-tail prefix", async () => {
    const start = toPixel(-11, 0);
    const first = toPixel(-9, 0);
    const second = toPixel(-6, 0);
    const candidates = [
      { enemy: true, hitCenter: first, hitRadius: 12, id: "first" },
      { enemy: true, hitCenter: second, hitRadius: 12, id: "second" },
    ];

    const result = await buildGraphwarOneClickClearPath({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      buildDagEdges: async (request) => ({
        routes: request.jobs.map((job) => ({ jobId: job.id, route: [job.startPoint, job.targetPoint] })),
        timings: [],
      }),
      candidates,
      isDeleteOptimizationEnabled: false,
      deleteHitCheckRadiusPixels: 0,
      hitCandidates: candidates,
      pathPoints: [start],
      routeMask: { mask: createEmptyMask(), routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      settings: {
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 210,
        stepGlitchMode: false,
        stepOverflowProtection: false,
      },
      simulationBoundaryExpansion: 0,
      simulationMaskCacheId: 1,
    });

    expect(result.type).toBe("success");
    expect(samplingMockState.formulaContextCalls).toBe(2);
    expect(samplingMockState.formulaContextInitialStatePresent).toEqual([false, false]);
  });
});

function createOptions(
  start: PixelPoint,
  candidates: { enemy: boolean; hitCenter: PixelPoint; hitRadius: number; id: string }[],
  simulationMask: Uint8Array,
  routeMode: GraphwarPathfindingRouteMode,
  isDeleteOptimizationEnabled = true,
) {
  return {
    boundaryExpansion: 0,
    bounds,
    boundsRect,
    buildDagEdges: () => {
      throw new Error("Step glitch clear must not build DAG edges");
    },
    candidates,
    isDeleteOptimizationEnabled,
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
    simulationMaskCacheId: 1,
  };
}

function createEmptyMask() {
  return new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
}

function toPixel(x: number, y: number) {
  return graphToImagePoint(createGraphPoint(x, y), bounds, boundsRect);
}

/** 将测试命中圆心投影到生产分配器使用的最近原生列，y 保持真实中心。 */
function toNativeColumnPoint(point: PixelPoint) {
  return createPixelPoint(planeXToImageX(imageXToNearestPlaneColumn(point.x, boundsRect, false), boundsRect), point.y);
}
