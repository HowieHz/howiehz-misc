import { beforeAll, describe, expect, it } from "vitest";

import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { graphToImagePoint } from "../../core/geometry";
import { createGraphPoint } from "../../core/types";
import type { BoundsRect, GraphBounds, PixelPoint } from "../../core/types";
import { readGraphwarKernelBytes } from "../../core/wasm/kernel-test-fixture";
import { instantiateGraphwarWasmRuntime } from "../../core/wasm/runtime";
import { createGraphwarTrajectoryFormulaMode } from "../../formula/trajectory/sampling";
import { buildGraphwarOneClickClearPath, type GraphwarOneClickClearBuildOptions } from "./search";

const bounds: GraphBounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
const boundsRect: BoundsRect = {
  height: GRAPHWAR_PLANE_HEIGHT,
  width: GRAPHWAR_PLANE_LENGTH,
  x: 0,
  y: 0,
};
const sourcePath = [
  graphToImagePoint(createGraphPoint(-24, 12), bounds, boundsRect),
  graphToImagePoint(createGraphPoint(-22.857142857142858, 13.571428571428571), bounds, boundsRect),
];
const noGlitchSourcePath = [
  graphToImagePoint(createGraphPoint(-24, 12), bounds, boundsRect),
  graphToImagePoint(createGraphPoint(-20, 10), bounds, boundsRect),
];
const targetPoint = graphToImagePoint(createGraphPoint(-22.84714285714286, 1.7532467532467528), bounds, boundsRect);
let kernelModule: WebAssembly.Module;

beforeAll(async () => {
  kernelModule = await WebAssembly.compile(await readGraphwarKernelBytes());
});

describe("one-click-clear real WASM Step-glitch integration", () => {
  it("returns target ids from command-18 final validation without a TypeScript replay", async () => {
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule);
    const result = await buildGraphwarOneClickClearPath(createOptions(new Uint8Array(planeCellCount), runtime));

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.targetIds).toEqual(["target"]);
      expect(result.trajectoryPoints.length).toBeGreaterThan(0);
    }
  });

  it("publishes exact evidence for an automatic glitch segment", async () => {
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule);
    let published:
      | Parameters<NonNullable<GraphwarOneClickClearBuildOptions["onValidatedStepGlitchPath"]>>[0]
      | undefined;
    const result = await buildGraphwarOneClickClearPath(
      createOptions(new Uint8Array(planeCellCount), runtime, (evidence) => {
        published = evidence;
      }),
    );

    expect(result.type).toBe("success");
    expect(published).toBeDefined();
    if (!published) return;
    expect(published.path.length).toBeGreaterThan(0);
    expect(published.prefixEvidence.formulaEvidence.prefix.points).toHaveLength(published.path.length);
    expect(published.prefixEvidence.formulaEvidence.prefix.segmentStartPoints).toHaveLength(published.path.length - 1);
  });

  it("accepts a published no-glitch prefix on the next request", async () => {
    let published:
      | Parameters<NonNullable<GraphwarOneClickClearBuildOptions["onValidatedStepGlitchPath"]>>[0]
      | undefined;
    const firstTarget = graphToImagePoint(createGraphPoint(-10, 5), bounds, boundsRect);
    const firstCandidate = { isEnemy: true, hitCenter: firstTarget, hitRadius: 2, id: "first" };
    const firstRuntime = await instantiateGraphwarWasmRuntime(kernelModule);
    const first = await buildGraphwarOneClickClearPath({
      ...createOptions(new Uint8Array(planeCellCount), firstRuntime, (evidence) => (published = evidence)),
      candidates: [firstCandidate],
      hitCandidates: [firstCandidate],
      pathPoints: noGlitchSourcePath,
    });
    expect(first.type).toBe("success");
    expect(published).toBeDefined();
    if (!published || first.type !== "success") return;

    const nextTarget = graphToImagePoint(createGraphPoint(-5, 3), bounds, boundsRect);
    const nextCandidate = { isEnemy: true, hitCenter: nextTarget, hitRadius: 2, id: "next" };
    const secondRuntime = await instantiateGraphwarWasmRuntime(kernelModule);
    const second = await buildGraphwarOneClickClearPath({
      ...createOptions(new Uint8Array(planeCellCount), secondRuntime),
      candidates: [nextCandidate],
      hitCandidates: [nextCandidate],
      pathPoints: first.pathPoints,
      prefixTarget: published.targetSequence.at(-1),
      stepGlitchPrefixEvidence: published.prefixEvidence,
    });
    expect(second.type).toBe("success");
  });

  it("publishes each accepted no-glitch prefix checkpoint", async () => {
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule);
    const firstTarget = graphToImagePoint(createGraphPoint(-10, 5), bounds, boundsRect);
    const nextTarget = graphToImagePoint(createGraphPoint(-5, 3), bounds, boundsRect);
    const firstCandidate = { isEnemy: true, hitCenter: firstTarget, hitRadius: 2, id: "first" };
    const nextCandidate = { isEnemy: true, hitCenter: nextTarget, hitRadius: 2, id: "next" };
    const published: Parameters<NonNullable<GraphwarOneClickClearBuildOptions["onValidatedStepGlitchPath"]>>[0][] = [];
    const result = await buildGraphwarOneClickClearPath({
      ...createOptions(new Uint8Array(planeCellCount), runtime, (evidence) => published.push(evidence)),
      candidates: [firstCandidate, nextCandidate],
      hitCandidates: [firstCandidate, nextCandidate],
      pathPoints: noGlitchSourcePath,
    });

    expect(result.type).toBe("success");
    expect(published).toHaveLength(2);
    expect(published[0]?.targetSequence).toHaveLength(1);
    expect(published[1]?.targetSequence).toHaveLength(2);
  });

  it("keeps a target hit but removes a later obstacle sample from the published trajectory", async () => {
    const baselineRuntime = await instantiateGraphwarWasmRuntime(kernelModule);
    const baseline = await buildGraphwarOneClickClearPath(
      createOptions(new Uint8Array(planeCellCount), baselineRuntime),
    );
    expect(baseline.type).toBe("success");
    if (baseline.type !== "success") throw new Error("expected the baseline target to be reachable");

    const obstaclePoint = baseline.trajectoryPoints.at(-2);
    if (!obstaclePoint) throw new Error("expected a natural trajectory beyond the target");
    const simulationMask = new Uint8Array(planeCellCount);
    simulationMask[toMaskIndex(obstaclePoint)] = 1;
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule);
    const result = await buildGraphwarOneClickClearPath(createOptions(simulationMask, runtime));

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.targetIds).toEqual(["target"]);
      expect(result.trajectoryPoints.some((point) => toMaskIndex(point) === toMaskIndex(obstaclePoint))).toBe(false);
      expect(result.trajectoryPoints.length).toBeLessThan(baseline.trajectoryPoints.length);
    }
  });
});

const planeCellCount = GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT;

function createOptions(
  simulationMask: Uint8Array,
  wasmRuntime: Awaited<ReturnType<typeof instantiateGraphwarWasmRuntime>>,
  onValidatedStepGlitchPath?: GraphwarOneClickClearBuildOptions["onValidatedStepGlitchPath"],
): GraphwarOneClickClearBuildOptions {
  const candidate = { isEnemy: true, hitCenter: targetPoint, hitRadius: 2, id: "target" };
  return {
    boundaryExpansion: 0,
    bounds,
    boundsRect,
    buildDagEdges: () => {
      throw new Error("Step-glitch clear must not build DAG edges");
    },
    candidates: [candidate],
    deleteHitCheckRadiusPixels: 0,
    formulaMode: createGraphwarTrajectoryFormulaMode({
      algorithm: "step",
      decimalPlaces: 4,
      equation: "dy",
      isStepGlitchModeEnabled: true,
      isStepOverflowProtectionEnabled: true,
      steepness: 67,
      stepGlitchObstacleMask: simulationMask,
    }),
    hitCandidates: [candidate],
    isDeleteOptimizationEnabled: false,
    onValidatedStepGlitchPath,
    pathPoints: sourcePath,
    routeMask: { mask: simulationMask, routeTolerancePlanePixels: 2 },
    routeMode: "visibility-graph",
    simulationBoundaryExpansion: 0,
    simulationMask,
    simulationMaskCacheId: 1,
    wasmRuntime,
  };
}

function toMaskIndex(point: PixelPoint) {
  const x = Math.max(0, Math.min(GRAPHWAR_PLANE_LENGTH - 1, Math.trunc(point.x)));
  const y = Math.max(0, Math.min(GRAPHWAR_PLANE_HEIGHT - 1, Math.trunc(point.y)));
  return y * GRAPHWAR_PLANE_LENGTH + x;
}
