import { describe, expect, it } from "vitest";

import { graphToImagePoint, imageToGraphPoint } from "../../core/geometry";
import { imagePointToPlaneGridPoint } from "../../core/plane-grid";
import { createGraphPoint } from "../../core/types";
import type { BoundsRect, GraphBounds, PixelPoint } from "../../core/types";
import { sampleGraphwarPathTargetSequence } from "../../formula/trajectory/sampling";
import {
  createGraphwarStepRouteModel,
  createGraphwarStepRouteSummedArea,
  validateGraphwarStepRoutePath,
} from "../routing/step-route";
import { buildGraphwarOneClickClearPath } from "./search";

const bounds: GraphBounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
const boundsRect: BoundsRect = { height: 450, width: 770, x: 0, y: 0 };
const settings = {
  algorithm: "step" as const,
  decimalPlaces: 4,
  equation: "y" as const,
  steepness: 67,
  stepGlitchMode: false,
  stepOverflowProtection: true,
};

describe("One-click clear optimization", () => {
  it("uses the sequential glitch scanner instead of DAG edge routing", async () => {
    const start = toImagePoint(-20, 0);
    const lower = toImagePoint(-10, -2);
    const upper = toImagePoint(-10, 2);
    const simulationMask = new Uint8Array(770 * 450);
    const candidates = [
      {
        enemy: true,
        hitCenter: upper,
        hitRadius: 24,
        id: "upper",
      },
      {
        enemy: true,
        hitCenter: lower,
        hitRadius: 24,
        id: "lower",
      },
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
      pathPoints: [start],
      routeMask: { mask: simulationMask, routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      settings: {
        ...settings,
        equation: "dy",
        stepGlitchMode: true,
        stepGlitchObstacleMask: simulationMask,
      },
      simulationBoundaryExpansion: 0,
      simulationMask,
    });

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.targetIds).toEqual(["lower", "upper"]);
      const graphPoints = result.pathPoints.map((point) => imageToGraphPoint(point, bounds, boundsRect));
      for (let index = 1; index < graphPoints.length; index += 1) {
        const previous = graphPoints[index - 1];
        const point = graphPoints[index];
        if (!previous || !point) {
          throw new Error("Expected a dense one-click-clear path");
        }
        expect(point.x).toBeGreaterThan(previous.x);
      }
    }
  });

  it("reuses the validated DAG edge prefix after a failed suffix is disabled", async () => {
    const start = toImagePoint(-20, 0);
    const first = toImagePoint(-15, 0);
    const second = toImagePoint(-10, 0);
    const failed = toImagePoint(-5, 0);
    const alternative = toImagePoint(0, 0);
    const backward = toImagePoint(-12, 0);
    const forward = toImagePoint(-7, 0);
    const simulationMask = new Uint8Array(770 * 450);
    const candidates = [
      { enemy: true, hitCenter: first, hitRadius: 2, id: "first" },
      { enemy: true, hitCenter: second, hitRadius: 2, id: "second" },
      { enemy: true, hitCenter: failed, hitRadius: 2, id: "failed" },
      { enemy: true, hitCenter: alternative, hitRadius: 2, id: "alternative" },
    ];
    let segmentSampleCount = 0;

    const result = await buildGraphwarOneClickClearPath({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      buildDagEdges: async (request) => ({
        routes: request.jobs.flatMap((job) => {
          const startX = imageToGraphPoint(job.startPoint, bounds, boundsRect).x;
          const targetX = imageToGraphPoint(job.targetPoint, bounds, boundsRect).x;
          if ((startX === -20 && targetX === -15) || (startX === -15 && targetX === -10)) {
            return [{ jobId: job.id, route: [job.startPoint, job.targetPoint] }];
          }
          if (startX === -10 && targetX === -5) {
            return [{ jobId: job.id, route: [job.startPoint, backward, job.targetPoint] }];
          }
          if (startX === -10 && targetX === 0) {
            return [{ jobId: job.id, route: [job.startPoint, forward, job.targetPoint] }];
          }
          return [];
        }),
        timings: [],
      }),
      candidates,
      deleteHitCheckRadiusPixels: 0,
      hitCandidates: candidates,
      onDebugTiming: (timing) => {
        if (timing.stage === "segment-sample-trajectory") {
          segmentSampleCount += 1;
        }
      },
      pathPoints: [start],
      routeMask: { mask: simulationMask, routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      settings: {
        ...settings,
        algorithm: "abs",
      },
      simulationBoundaryExpansion: 0,
      simulationMask,
    });

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.pathPoints.at(-1)).toEqual(alternative);
      expect(result.targetIds).toEqual(["first", "second", "failed", "alternative"]);
    }
    expect(segmentSampleCount).toBe(3);
  });

  it("reuses the exact final validation produced after local ABS point deletion", async () => {
    const start = toImagePoint(-20, 0);
    const middle = toImagePoint(-15, 0);
    const target = toImagePoint(-10, 0);
    const simulationMask = new Uint8Array(770 * 450);
    const candidate = { enemy: true, hitCenter: target, hitRadius: 2, id: "target" };
    let finalValidationCount = 0;

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
      deleteHitCheckRadiusPixels: 2,
      hitCandidates: [candidate],
      onDebugTiming: (timing) => {
        if (timing.stage === "validate-final") {
          finalValidationCount += 1;
        }
      },
      pathPoints: [start],
      routeMask: { mask: simulationMask, routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      settings: {
        ...settings,
        algorithm: "abs",
      },
      simulationBoundaryExpansion: 0,
      simulationMask,
    });

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.pathPoints).toEqual([start, target]);
      expect(result.targetIds).toEqual(["target"]);
    }
    expect(finalValidationCount).toBe(1);
  });

  it("discards failed deletion evidence before validating the original ABS route", async () => {
    const start = toImagePoint(-20, 0);
    const middle = toImagePoint(-15, 4);
    const target = toImagePoint(-10, 4);
    const candidate = { enemy: true, hitCenter: target, hitRadius: 2, id: "target" };
    const absSettings = { ...settings, algorithm: "abs" as const };
    const directSample = sampleGraphwarPathTargetSequence({
      bounds,
      boundsRect,
      points: [start, target],
      settings: absSettings,
      targetCircles: [{ center: target, radius: candidate.hitRadius }],
      targetHitRadiusPixels: candidate.hitRadius,
      targetPoints: [target],
    });
    const obstacleGraphPoint = directSample.sample.points.find((point) => point.x >= -15);
    if (!obstacleGraphPoint) {
      throw new Error("Expected the direct ABS trajectory to reach the obstacle x");
    }
    const obstacle = imagePointToPlaneGridPoint(graphToImagePoint(obstacleGraphPoint, bounds, boundsRect), boundsRect);
    const simulationMask = new Uint8Array(770 * 450);
    simulationMask[obstacle.y * 770 + obstacle.x] = 1;
    let finalValidationCount = 0;

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
      deleteHitCheckRadiusPixels: 2,
      hitCandidates: [candidate],
      onDebugTiming: (timing) => {
        if (timing.stage === "validate-final") {
          finalValidationCount += 1;
        }
      },
      pathPoints: [start],
      routeMask: { mask: new Uint8Array(770 * 450), routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      settings: absSettings,
      simulationBoundaryExpansion: 0,
      simulationMask,
    });

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.pathPoints).toEqual([start, middle, target]);
      expect(result.targetIds).toEqual(["target"]);
    }
    expect(finalValidationCount).toBe(2);
  });

  it("keeps a control point when deleting it violates the strict Step envelope", async () => {
    const start = toImagePoint(-20, 0);
    const middle = toImagePoint(-15, 4);
    const target = toImagePoint(-10, 4);
    const routeMask = new Uint8Array(770 * 450);
    const obstacle = imagePointToPlaneGridPoint(toImagePoint(-10.1, 2), boundsRect);
    routeMask[obstacle.y * 770 + obstacle.x] = 1;

    const model = createGraphwarStepRouteModel(0, settings);
    expect(model).toBeDefined();
    if (!model) {
      return;
    }
    const summedArea = createGraphwarStepRouteSummedArea(routeMask);
    const validateStepRoute = (points: readonly PixelPoint[]) =>
      validateGraphwarStepRoutePath({
        boundaryInset: 0,
        bounds,
        boundsRect,
        model,
        points,
        summedArea,
      }).ok;

    expect(validateStepRoute([start, middle, target])).toBe(true);
    expect(validateStepRoute([start, target])).toBe(false);

    const result = await buildGraphwarOneClickClearPath({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      buildDagEdges: async (request) => ({
        routes: request.jobs.map((job) => ({
          jobId: job.id,
          resolvedEndStateKey: "40000",
          resolvedEndY: 4,
          route: [job.startPoint, middle, job.targetPoint],
        })),
        timings: [],
      }),
      candidates: [
        {
          enemy: true,
          hitCenter: target,
          hitRadius: 2,
          id: "target",
        },
      ],
      deleteHitCheckRadiusPixels: 0,
      hitCandidates: [
        {
          enemy: true,
          hitCenter: target,
          hitRadius: 2,
          id: "target",
        },
      ],
      pathPoints: [start],
      routeMask: { mask: routeMask, routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      settings,
      simulationBoundaryExpansion: 0,
      validateStepRoute,
    });

    expect(result.type).toBe("success");
    if (result.type === "success") {
      // 末端控制点可删，因为水平尾段仍会命中目标；绕开严格障碍的 middle 必须保留。
      expect(result.pathPoints).toEqual([start, middle]);
    }
  });
});

function toImagePoint(x: number, y: number) {
  return graphToImagePoint(createGraphPoint(x, y), bounds, boundsRect);
}
