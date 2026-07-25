import { beforeEach, describe, expect, it, vi } from "vitest";

import { planeGridCellCenterToImagePoint } from "../../core/plane-grid";
import { createPixelPoint } from "../../core/types";
import { createGraphwarStepRouteModel, createGraphwarStepRouteSummedArea } from "../routing/step-route";

const mocks = vi.hoisted(() => ({
  buildVisibilityRoute: vi.fn(),
}));

vi.mock("../routing/visibility-graph", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../routing/visibility-graph")>()),
  buildGraphwarVisibilityGraphPathForMask: mocks.buildVisibilityRoute,
}));

import { buildOneClickClearDagEdgeRoute } from "./edge-route";
import type { GraphwarOneClickClearDagEdgeBuildJob } from "./search";

const context = {
  boundaryExpansion: 0,
  bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
  boundsRect: { height: 450, width: 770, x: 0, y: 0 },
  routeMask: new Uint8Array(770 * 450),
  routeMode: "visibility-graph" as const,
  routeTolerancePlanePixels: 0,
  type: "stateless" as const,
};

describe("one-click-clear DAG edge native forward distance", () => {
  beforeEach(() => mocks.buildVisibilityRoute.mockReset());

  it.each([
    {
      name: "first automatic cell center is too close to the exact start",
      route: [
        { x: 100, y: 224 },
        { x: 101, y: 224 },
        { x: 110, y: 224 },
      ],
      startX: 100.9,
      targetX: 111,
    },
    {
      name: "exact target is too close to the previous automatic cell center",
      route: [
        { x: 100, y: 224 },
        { x: 101, y: 224 },
        { x: 102, y: 224 },
      ],
      startX: 100,
      targetX: 102,
    },
  ])("rejects an edge when $name", async ({ route, startX, targetX }) => {
    mocks.buildVisibilityRoute.mockResolvedValue(route);

    const result = await buildOneClickClearDagEdgeRoute(context, createJob(startX, targetX));

    expect(result.route).toBeUndefined();
  });

  it("keeps cell centers when every mapped segment advances by at least one native pixel", async () => {
    mocks.buildVisibilityRoute.mockResolvedValue([
      { x: 100, y: 224 },
      { x: 101, y: 224 },
      { x: 103, y: 224 },
    ]);

    const result = await buildOneClickClearDagEdgeRoute(context, createJob(100.4, 103));

    expect(result.route).toEqual([
      createPixelPoint(100.4, 225),
      planeGridCellCenterToImagePoint({ x: 101, y: 224 }, context.boundsRect),
      createPixelPoint(103, 225),
    ]);
  });

  it("returns an atomic Step end state for a job with matching runtime", async () => {
    mocks.buildVisibilityRoute.mockResolvedValue([
      { x: 100, y: 224 },
      { x: 101, y: 224 },
      { x: 103, y: 224 },
    ]);
    const result = await buildOneClickClearDagEdgeRoute(
      {
        ...context,
        runtime: createStepRouteRuntime(),
        type: "step-stateful",
      },
      {
        ...createJob(100.4, 103),
        stepRouteStartState: { resolvedStateKey: "0", resolvedY: 0 },
      },
    );

    expect(result.stepRouteEndState).toEqual({ resolvedStateKey: "0", resolvedY: 0 });
  });

  it.each([
    {
      name: "runtime is unavailable",
      runtime: undefined,
      stepRouteStartState: { resolvedStateKey: "0", resolvedY: 0 },
    },
    {
      name: "start state is unavailable",
      runtime: createStepRouteRuntime(),
      stepRouteStartState: undefined,
    },
  ])("rejects a Step half-state when $name", async ({ runtime, stepRouteStartState }) => {
    const routeContext = runtime ? { ...context, runtime, type: "step-stateful" as const } : context;
    const result = await buildOneClickClearDagEdgeRoute(routeContext, {
      ...createJob(100.4, 103),
      ...(stepRouteStartState ? { stepRouteStartState } : {}),
    });

    expect(mocks.buildVisibilityRoute).not.toHaveBeenCalled();
    expect(result.route).toBeUndefined();
  });

  it.each([
    { name: "resolvedY is not finite", stepRouteStartState: { resolvedStateKey: "0", resolvedY: Number.NaN } },
    { name: "state key is not an integer", stepRouteStartState: { resolvedStateKey: "invalid", resolvedY: 0 } },
    { name: "state key is not canonical", stepRouteStartState: { resolvedStateKey: "01", resolvedY: 0 } },
  ])("rejects an invalid Step state when $name", async ({ stepRouteStartState }) => {
    const result = await buildOneClickClearDagEdgeRoute(
      { ...context, runtime: createStepRouteRuntime(), type: "step-stateful" },
      { ...createJob(100.4, 103), stepRouteStartState },
    );

    expect(mocks.buildVisibilityRoute).not.toHaveBeenCalled();
    expect(result.route).toBeUndefined();
  });
});

/** 创建只携带单边建路必需字段的测试 job。 */
function createJob(startX: number, targetX: number): GraphwarOneClickClearDagEdgeBuildJob {
  return {
    from: -1,
    id: 1,
    startPoint: createPixelPoint(startX, 225),
    targetPoint: createPixelPoint(targetX, 225),
    to: 0,
  };
}

/** 创建测试共享的完整 Step runtime；无效测试设置应立即暴露。 */
function createStepRouteRuntime() {
  const model = createGraphwarStepRouteModel(0, {
    decimalPlaces: 2,
    equation: "y",
    steepness: 1,
  });
  if (!model) {
    throw new Error("Expected valid Step route model");
  }
  return {
    model,
    summedArea: createGraphwarStepRouteSummedArea(context.routeMask),
  };
}
