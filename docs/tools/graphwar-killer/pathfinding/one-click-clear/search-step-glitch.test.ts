import { beforeEach, describe, expect, it, vi } from "vitest";

import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { graphToImagePoint, imageToGraphPoint } from "../../core/geometry";
import { imageXToNearestPlaneColumn, planeXToImageX } from "../../core/plane-grid";
import { createGraphPoint, createPixelPoint } from "../../core/types";
import type { BoundsRect, GraphBounds, PixelPoint } from "../../core/types";
import { captureGraphwarFinalReplaySnapshot } from "../../formula/trajectory/final-replay-snapshot";
import type { GraphwarPathfindingRouteMode } from "../routing/mode";

const scanMockState = vi.hoisted(() => ({
  finalEvidenceMode: "none" as "none" | "valid" | "wrong-mask" | "wrong-path" | "wrong-tracked-order",
  gatePoint: undefined as PixelPoint | undefined,
  outcomes: [] as ("hit" | "no-path")[],
  scanners: [] as {
    hasBoundaryState: boolean;
    hasPrefixEvidence: boolean;
    isFormulaMaskSimulationMask: boolean;
    requiredTargets: { center: { x: number; y: number }; radius: number }[];
    sourcePath: { x: number; y: number }[];
  }[],
  scans: [] as {
    hasFinalValidation: boolean;
    scannerId: number;
    targetPoint: { x: number; y: number };
    trackedTargetCount: number;
  }[],
}));
const samplingMockState = vi.hoisted(() => ({
  candidateTargetSequences: [] as { x: number; y: number }[][],
  resolveTrajectory: undefined as
    | (typeof import("../../formula/trajectory/sampling"))["resolveGraphwarTrajectory"]
    | undefined,
  formulaContextCalls: 0,
  formulaContextInitialStatePresent: [] as boolean[],
  pathTargetSequenceCalls: 0,
  resolvedContinuationCalls: 0,
  requiredTargets: [] as { x: number; y: number }[][],
  shouldStripStepGlitchFormulaEvidence: false,
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
        samplingMockState.formulaContextInitialStatePresent.push(options.start?.type === "continuation");
        samplingMockState.candidateTargetSequences.push(
          (options.targetSequence ?? []).map((target) => ({ ...target.center })),
        );
        return original.tryResolveGraphwarTrajectoryCandidate(options);
      },
    ),
    sampleGraphwarPathTargetSequence: vi.fn(
      (options: Parameters<typeof original.sampleGraphwarPathTargetSequence>[0]) => {
        samplingMockState.pathTargetSequenceCalls += 1;
        samplingMockState.requiredTargets.push((options.requiredTargets ?? []).map((target) => ({ ...target.center })));
        samplingMockState.targetSequences.push((options.targetCircles ?? []).map((target) => ({ ...target.center })));
        const result = original.sampleGraphwarPathTargetSequence(options);
        if (!samplingMockState.shouldStripStepGlitchFormulaEvidence || !result.formulaContext) {
          return result;
        }
        const { stepGlitchFormulaEvidence: _stepGlitchFormulaEvidence, ...formulaContext } = result.formulaContext;
        return { ...result, formulaContext };
      },
    ),
    tryContinueResolvedGraphwarTrajectory: vi.fn(
      (options: Parameters<typeof original.tryContinueResolvedGraphwarTrajectory>[0]) => {
        samplingMockState.resolvedContinuationCalls += 1;
        return original.tryContinueResolvedGraphwarTrajectory(options);
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
          hasBoundaryState: options.prefixEvidence?.formulaEvidence.boundaryState !== undefined,
          hasPrefixEvidence: options.prefixEvidence !== undefined,
          isFormulaMaskSimulationMask: options.settings.stepGlitchObstacleMask === options.simulationMask,
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
            scanMockState.scans.push({
              hasFinalValidation: target.finalValidation !== undefined,
              scannerId,
              targetPoint: { ...target.targetPoint },
              trackedTargetCount: target.finalValidation?.trackedTargets.length ?? 0,
            });
            if (outcome === "hit") {
              const path = [
                ...options.sourcePath,
                ...(scanMockState.gatePoint ? [{ ...scanMockState.gatePoint }] : []),
                target.targetPoint,
              ];
              const resolveTrajectory = samplingMockState.resolveTrajectory;
              if (!resolveTrajectory) {
                throw new Error("Formula context test factory is unavailable");
              }
              const graphPoints = path.map((point) => imageToGraphPoint(point, options.bounds, options.boundsRect));
              const lastGraphPoint = graphPoints.at(-1);
              if (!lastGraphPoint) {
                throw new Error("Step glitch scanner mock path is empty");
              }
              const shouldCreateFinalEvidence =
                scanMockState.finalEvidenceMode !== "none" && target.finalValidation !== undefined;
              const resolution = resolveTrajectory({
                bounds: options.bounds,
                boundsRect: options.boundsRect,
                ...(shouldCreateFinalEvidence
                  ? {
                      collectVisiblePixels: true,
                      collision: {
                        boundaryExpansion: options.simulationBoundaryExpansion,
                        mask: options.simulationMask,
                      },
                    }
                  : {}),
                points: graphPoints,
                ...(shouldCreateFinalEvidence
                  ? {
                      qualityPoints: graphPoints.filter(
                        (_point, index) =>
                          index > 0 &&
                          !target.finalValidation?.targetControlPoints.some(
                            (targetPoint) => targetPoint.x === path[index]?.x && targetPoint.y === path[index]?.y,
                          ),
                      ),
                      requiredTargets: options.requiredTargets,
                    }
                  : {}),
                settings: options.settings,
                soldierCenter: graphPoints[0],
                ...(options.prefixEvidence
                  ? { stepGlitchFormulaEvidence: options.prefixEvidence.formulaEvidence }
                  : {}),
                ...(shouldCreateFinalEvidence
                  ? {
                      stopOnTargetsComplete: false,
                      targetSequence: [target.hitTarget],
                      trackedTargets: target.finalValidation?.trackedTargets,
                    }
                  : {}),
              });
              const finalValidationPath = path.map((point) => createPixelPoint(point.x, point.y));
              if (scanMockState.finalEvidenceMode === "wrong-path" && finalValidationPath.length > 0) {
                const lastPoint = finalValidationPath[finalValidationPath.length - 1];
                if (lastPoint) {
                  finalValidationPath[finalValidationPath.length - 1] = createPixelPoint(lastPoint.x, lastPoint.y + 1);
                }
              }
              const finalValidationMask = options.simulationMask.slice();
              if (scanMockState.finalEvidenceMode === "wrong-mask" && finalValidationMask.length > 0) {
                finalValidationMask[0] = (finalValidationMask[0] ?? 0) ^ 1;
              }
              const finalValidationTrackedTargets = [...(target.finalValidation?.trackedTargets ?? [])];
              if (scanMockState.finalEvidenceMode === "wrong-tracked-order") {
                finalValidationTrackedTargets.reverse();
              }
              const stepGlitchFormulaEvidence = resolution.context.stepGlitchFormulaEvidence;
              if (!stepGlitchFormulaEvidence) {
                throw new Error("Step glitch scanner mock resolution is missing formula evidence");
              }
              const finalValidation = shouldCreateFinalEvidence
                ? captureGraphwarFinalReplaySnapshot({
                    boundaryExpansion: options.simulationBoundaryExpansion,
                    bounds: options.bounds,
                    boundsRect: options.boundsRect,
                    formulaSettings: options.settings,
                    path: finalValidationPath,
                    replaySemantics: "full-natural-visible",
                    requiredTargets: options.requiredTargets ?? [],
                    result: resolution.result,
                    simulationMask: finalValidationMask,
                    simulationMaskCacheId: target.finalValidation?.simulationMaskCacheId ?? 0,
                    targetControlPoints: target.finalValidation?.targetControlPoints ?? [],
                    targetSequence: [target.hitTarget],
                    trackedTargets: finalValidationTrackedTargets,
                  })
                : undefined;
              return {
                acceptedPoint: { x: 0, y: 0 },
                expandedStates: 1,
                path,
                reachedTargetCount: (options.requiredTargets?.length ?? 0) + 1,
                replayEvidence: {
                  ...(finalValidation ? { finalValidation } : {}),
                  formulaContext: { ...resolution.context, stepGlitchFormulaEvidence },
                  trajectoryPoints: path,
                },
                status: "hit" as const,
                timings: [],
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
    scanMockState.finalEvidenceMode = "none";
    scanMockState.gatePoint = undefined;
    scanMockState.outcomes.length = 0;
    scanMockState.scanners.length = 0;
    scanMockState.scans.length = 0;
    samplingMockState.pathTargetSequenceCalls = 0;
    samplingMockState.resolvedContinuationCalls = 0;
    samplingMockState.candidateTargetSequences.length = 0;
    samplingMockState.formulaContextCalls = 0;
    samplingMockState.formulaContextInitialStatePresent.length = 0;
    samplingMockState.requiredTargets.length = 0;
    samplingMockState.shouldStripStepGlitchFormulaEvidence = false;
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

  it("promotes the final scan's complete replay without a cold final validation", async () => {
    scanMockState.finalEvidenceMode = "valid";
    scanMockState.outcomes.push("hit");
    const start = toPixel(-11, 0);
    const target = toPixel(-6, 0);
    const candidates = [{ enemy: true, hitCenter: target, hitRadius: 12, id: "target" }];
    const debugStages: string[] = [];

    const result = await buildGraphwarOneClickClearPath({
      ...createOptions(start, candidates, createEmptyMask(), "visibility-graph", false),
      onDebugTiming: (timing) => debugStages.push(timing.stage),
    });

    expect(result.type).toBe("success");
    expect(scanMockState.scans).toEqual([expect.objectContaining({ hasFinalValidation: true, trackedTargetCount: 1 })]);
    expect(samplingMockState.pathTargetSequenceCalls).toBe(0);
    expect(debugStages).not.toContain("validate-final");
  });

  it("rejects a successful Step final validation without formula evidence", async () => {
    scanMockState.outcomes.push("hit");
    samplingMockState.shouldStripStepGlitchFormulaEvidence = true;
    const start = toPixel(-11, 0);
    const target = toPixel(-6, 0);
    const candidates = [{ enemy: true, hitCenter: target, hitRadius: 12, id: "target" }];

    await expect(
      buildGraphwarOneClickClearPath(createOptions(start, candidates, createEmptyMask(), "visibility-graph", false)),
    ).rejects.toThrow("Validated Step glitch path is missing its formula evidence.");
  });

  it("normalizes a different formula mask to the explicit simulation mask before producing evidence", async () => {
    scanMockState.finalEvidenceMode = "valid";
    scanMockState.outcomes.push("hit");
    const start = toPixel(-11, 0);
    const target = toPixel(-6, 0);
    const candidates = [{ enemy: true, hitCenter: target, hitRadius: 12, id: "target" }];
    const simulationMask = createEmptyMask();
    const options = createOptions(start, candidates, simulationMask, "visibility-graph", false);

    const result = await buildGraphwarOneClickClearPath({
      ...options,
      settings: { ...options.settings, stepGlitchObstacleMask: createEmptyMask() },
    });

    expect(result.type).toBe("success");
    expect(scanMockState.scanners[0]?.isFormulaMaskSimulationMask).toBe(true);
    expect(samplingMockState.pathTargetSequenceCalls).toBe(0);
  });

  it("keeps the request snapshot when external formula settings mutate after direct replay", async () => {
    scanMockState.finalEvidenceMode = "valid";
    scanMockState.outcomes.push("hit");
    const start = toPixel(-11, 0);
    const target = toPixel(-6, 0);
    const candidates = [{ enemy: true, hitCenter: target, hitRadius: 12, id: "target" }];
    const options = createOptions(start, candidates, createEmptyMask(), "visibility-graph", false);
    const debugStages: string[] = [];

    const result = await buildGraphwarOneClickClearPath({
      ...options,
      onDebugTiming: (timing) => debugStages.push(timing.stage),
      yieldControl: () => {
        options.settings.steepness += 1;
      },
    });

    expect(result.type).toBe("success");
    expect(samplingMockState.pathTargetSequenceCalls).toBe(0);
    expect(debugStages).not.toContain("validate-final");
  });

  it("keeps the request snapshot when the external formula mask mutates after direct replay", async () => {
    scanMockState.finalEvidenceMode = "valid";
    scanMockState.outcomes.push("hit");
    const start = toPixel(-11, 0);
    const target = toPixel(-6, 0);
    const candidates = [{ enemy: true, hitCenter: target, hitRadius: 12, id: "target" }];
    const options = createOptions(start, candidates, createEmptyMask(), "visibility-graph", false);
    const debugStages: string[] = [];

    const result = await buildGraphwarOneClickClearPath({
      ...options,
      onDebugTiming: (timing) => debugStages.push(timing.stage),
      yieldControl: () => {
        const changedMask = createEmptyMask();
        changedMask[0] = 1;
        options.settings.stepGlitchObstacleMask = changedMask;
      },
    });

    expect(result.type).toBe("success");
    expect(samplingMockState.pathTargetSequenceCalls).toBe(0);
    expect(debugStages).not.toContain("validate-final");
  });

  it.each(["wrong-mask", "wrong-path"] as const)(
    "falls back when final replay evidence has $finalEvidenceMode",
    async (finalEvidenceMode) => {
      scanMockState.finalEvidenceMode = finalEvidenceMode;
      scanMockState.outcomes.push("hit");
      const start = toPixel(-11, 0);
      const target = toPixel(-6, 0);
      const candidates = [{ enemy: true, hitCenter: target, hitRadius: 12, id: "target" }];
      const debugStages: string[] = [];

      const result = await buildGraphwarOneClickClearPath({
        ...createOptions(start, candidates, createEmptyMask(), "visibility-graph", false),
        onDebugTiming: (timing) => debugStages.push(timing.stage),
      });

      expect(result.type).toBe("success");
      expect(samplingMockState.pathTargetSequenceCalls).toBe(1);
      expect(debugStages).toContain("validate-final");
    },
  );

  it("falls back when final replay tracked targets have the same count in a different order", async () => {
    scanMockState.finalEvidenceMode = "wrong-tracked-order";
    scanMockState.outcomes.push("hit", "hit");
    const start = toPixel(-11, 0);
    const first = toPixel(-9, 0);
    const second = toPixel(-6, 0);
    const candidates = [
      { enemy: true, hitCenter: first, hitRadius: 12, id: "first" },
      { enemy: true, hitCenter: second, hitRadius: 12, id: "second" },
    ];
    const debugStages: string[] = [];

    const result = await buildGraphwarOneClickClearPath({
      ...createOptions(start, candidates, createEmptyMask(), "visibility-graph", false),
      onDebugTiming: (timing) => debugStages.push(timing.stage),
    });

    expect(result.type).toBe("success");
    expect(samplingMockState.pathTargetSequenceCalls).toBe(1);
    expect(debugStages).toContain("validate-final");
  });

  it("discards final replay evidence after point deletion changes the path", async () => {
    scanMockState.finalEvidenceMode = "valid";
    scanMockState.gatePoint = toPixel(-8, 0);
    scanMockState.outcomes.push("hit");
    const start = toPixel(-11, 0);
    const target = toPixel(-6, 0);
    const candidates = [{ enemy: true, hitCenter: target, hitRadius: 12, id: "target" }];
    const debugStages: string[] = [];

    const result = await buildGraphwarOneClickClearPath({
      ...createOptions(start, candidates, createEmptyMask(), "visibility-graph", true),
      onDebugTiming: (timing) => debugStages.push(timing.stage),
    });

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.pathPoints).toEqual([start, toNativeColumnPoint(target)]);
    }
    // 一次验证删点候选，一次 cold 最终统计；旧路径证据不得随新公式继续。
    expect(samplingMockState.pathTargetSequenceCalls).toBe(2);
    expect(debugStages).toContain("validate-final");
  });

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
    expect(scanMockState.scanners.map((scanner) => scanner.hasBoundaryState)).toEqual([false, true, true, true]);
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

  it("cold-replays ABS y'' appends before continuing the unchanged final formula", async () => {
    const start = toPixel(-11, 0);
    const tail = toPixel(-10, 0);
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
      pathPoints: [start, tail],
      prefixTarget: { center: tail, radius: 12 },
      routeMask: { mask: createEmptyMask(), routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      settings: {
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 210,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: false,
      },
      simulationBoundaryExpansion: 0,
      simulationMaskCacheId: 1,
    });

    expect(result.type).toBe("success");
    expect(samplingMockState.formulaContextCalls).toBe(2);
    expect(samplingMockState.formulaContextInitialStatePresent).toEqual([false, false]);
    expect(samplingMockState.resolvedContinuationCalls).toBe(1);
    expect(samplingMockState.candidateTargetSequences.every((sequence) => sequence[0]?.x === tail.x)).toBe(true);
  });

  it("continues the newly validated ABS y'' formula after deleting a control point", async () => {
    const start = toPixel(-11, 0);
    const middle = toPixel(-8, 0);
    const target = toPixel(-6, 0);
    const candidate = { enemy: true, hitCenter: target, hitRadius: 12, id: "target" };

    const result = await buildGraphwarOneClickClearPath({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      buildDagEdges: async (request) => ({
        routes: request.jobs.map((job) => ({
          jobId: job.id,
          route: [job.startPoint, middle, job.targetPoint],
        })),
        timings: [],
      }),
      candidates: [candidate],
      deleteHitCheckRadiusPixels: 0,
      hitCandidates: [candidate],
      isDeleteOptimizationEnabled: true,
      pathPoints: [start],
      routeMask: { mask: createEmptyMask(), routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      settings: {
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 210,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: false,
      },
      simulationBoundaryExpansion: 0,
      simulationMaskCacheId: 1,
    });

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.pathPoints).toHaveLength(2);
      expect(result.pathPoints).not.toContain(middle);
    }
    // 两次 wrapper 调用分别验证“删除 middle 成功”和“删除末目标失败”；最终统计不再增加第三次 cold wrapper。
    expect(samplingMockState.pathTargetSequenceCalls).toBe(2);
    expect(samplingMockState.formulaContextInitialStatePresent).toEqual([false]);
    expect(samplingMockState.resolvedContinuationCalls).toBe(1);
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
      isStepGlitchModeEnabled: true,
      stepGlitchObstacleMask: simulationMask,
      isStepOverflowProtectionEnabled: true,
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
