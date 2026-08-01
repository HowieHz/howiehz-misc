import { beforeAll, describe, expect, it } from "vitest";

import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { createPixelPoint, type BoundsRect, type GraphBounds } from "../../core/types";
import { readGraphwarKernelBytes } from "../../core/wasm/kernel-test-fixture";
import { instantiateGraphwarWasmRuntime } from "../../core/wasm/runtime";
import { createGraphwarTrajectoryFormulaMode } from "../../formula/trajectory/sampling";
import type {
  GraphwarOneClickClearBuildOptions,
  GraphwarOneClickClearDagEdgeBuildJob,
  GraphwarOneClickClearDagEdgeBuildRequest,
} from "./search";
import { buildGraphwarOneClickClearPath } from "./search";

const bounds: GraphBounds = { maxX: -25, maxY: 15, minX: 25, minY: -15 };
const boundsRect: BoundsRect = { height: GRAPHWAR_PLANE_HEIGHT, width: GRAPHWAR_PLANE_LENGTH, x: 0, y: 0 };
const emptyMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
let kernelModule: WebAssembly.Module;

beforeAll(async () => {
  kernelModule = await WebAssembly.compile(await readGraphwarKernelBytes());
});

describe("one-click-clear mirrored WASM guard", () => {
  it("falls back to forward-ordered TypeScript edge jobs", async () => {
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule);
    const start = createPixelPoint(700, 225);
    const candidates = [
      { id: "left", isEnemy: true, hitCenter: createPixelPoint(650, 225), hitRadius: 30 },
      { id: "far-left", isEnemy: true, hitCenter: createPixelPoint(550, 225), hitRadius: 30 },
    ];
    const requests: GraphwarOneClickClearDagEdgeBuildRequest[] = [];

    const result = await buildGraphwarOneClickClearPath({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      buildDagEdges: async (request) => {
        requests.push(request);
        return { routes: [], timings: [] };
      },
      candidates,
      deleteHitCheckRadiusPixels: 0,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "y",
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
        steepness: 67,
      }),
      hitCandidates: candidates,
      isDeleteOptimizationEnabled: false,
      pathPoints: [start],
      routeMask: { mask: emptyMask, routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      simulationBoundaryExpansion: 0,
      simulationMaskCacheId: 0,
      wasmRequestNonce: 17,
      wasmRuntime: runtime,
    } satisfies GraphwarOneClickClearBuildOptions);

    expect(result.type).toBe("failure");
    const jobs = requests.flatMap(({ jobs: batch }) => batch);
    expect(jobs).toHaveLength(3);
    expect(jobs.filter(({ from }) => from === -1).map(({ targetPoint }) => targetPoint.x)).toEqual([650, 550]);
    expect(jobs.every(isStatelessJob)).toBe(true);
  });
});

function isStatelessJob(
  job: GraphwarOneClickClearDagEdgeBuildJob,
): job is Extract<GraphwarOneClickClearDagEdgeBuildJob, { type: "stateless" }> {
  return job.type === "stateless";
}
