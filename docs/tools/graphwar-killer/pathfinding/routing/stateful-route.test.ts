import { describe, expect, it } from "vitest";

import { createPixelPoint } from "../../core/types";
import type { BoundsRect, GraphBounds } from "../../core/types";
import { buildGraphwarThetaStarPathForMask } from "./theta-star";
import { buildGraphwarVisibilityGraphPathForMask } from "./visibility-graph";
import type { GraphwarPathfindingEdgeEvaluator } from "./visibility-graph";

const bounds: GraphBounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
const boundsRect: BoundsRect = { height: 450, width: 770, x: 0, y: 0 };
const startPoint = createPixelPoint(10.5, 100.5);
const targetPoint = createPixelPoint(14.5, 100.5);

describe.each([
  ["Visibility Graph", buildGraphwarVisibilityGraphPathForMask],
  ["Theta*", buildGraphwarThetaStarPathForMask],
] as const)("stateful %s routing", (_, buildPath) => {
  it("carries the canonical key through expansion and simplification", async () => {
    const routeMask = new Uint8Array(770 * 450);
    // 单格障碍只负责给 Visibility Graph 提供绕行候选；自定义边判定拥有最终可用性语义。
    routeMask[100 * 770 + 12] = 1;
    const observedKeys: (string | undefined)[] = [];
    const evaluateEdge: GraphwarPathfindingEdgeEvaluator = (previous, next, routeState, routeStateKey) => {
      observedKeys.push(routeStateKey);
      if (routeStateKey !== String(Math.round(routeState))) {
        return undefined;
      }
      // 强制两种路由器至少走一次扩展；后续 shortcut 仍必须带上更新后的 key。
      if (previous.x === 10 && next.x === 14) {
        return undefined;
      }
      const nextState = routeState + 1;
      return {
        nextRouteState: nextState,
        nextRouteStateKey: String(nextState),
        secondaryCost: Math.abs(next.y - previous.y),
      };
    };

    const path = await buildPath({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      evaluateEdge,
      initialRouteState: 0,
      initialRouteStateKey: "0",
      routeMask,
      routeTolerancePlanePixels: 1,
      startPoint,
      targetPoint,
    });

    expect(path?.length).toBeGreaterThanOrEqual(3);
    expect(observedKeys).toContain("0");
    expect(observedKeys.some((key) => key !== undefined && key !== "0")).toBe(true);
  });
});
