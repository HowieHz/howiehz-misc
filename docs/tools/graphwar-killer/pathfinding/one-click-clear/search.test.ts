import { describe, expect, it } from "vitest";

import { graphToImagePoint, imageToGraphPoint } from "../../core/geometry";
import { imagePointToPlaneGridPoint } from "../../core/plane-grid";
import { createGraphPoint, createPixelPoint } from "../../core/types";
import type { BoundsRect, GraphBounds, PixelPoint } from "../../core/types";
import { sampleGraphwarPathTargetSequence } from "../../formula/trajectory/sampling";
import { snapshotGraphwarVisibleTrajectoryPoints } from "../../formula/trajectory/visible-points";
import {
  createGraphwarStepRouteModel,
  createGraphwarStepRouteSummedArea,
  validateGraphwarStepRoutePath,
} from "../routing/step-route";
import {
  buildGraphwarOneClickClearPath,
  type GraphwarOneClickClearCandidate,
  type GraphwarOneClickClearDagEdgeBuildRequest,
  type GraphwarOneClickClearIncumbent,
} from "./search";

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
const statelessSplineModes = [
  ["pchip", "y"],
  ["pchip", "dy"],
  ["pchip", "ddy"],
  ["akima", "y"],
  ["akima", "dy"],
  ["akima", "ddy"],
] as const;

describe("One-click clear optimization", () => {
  it("builds an ordinary DAG target at the next legal native column when the center does not advance", async () => {
    const requests: GraphwarOneClickClearDagEdgeBuildRequest[] = [];
    const start = createPixelPoint(200, 225);
    const candidate = {
      enemy: true,
      hitCenter: createPixelPoint(198.25, 225),
      hitRadius: 5,
      id: "edge",
    };

    await buildGraphwarOneClickClearPath(createDagCaptureOptions(start, [candidate], requests));

    expect(requests).toHaveLength(1);
    expect(requests[0]?.jobs.map((job) => job.targetPoint)).toEqual([createPixelPoint(201, 225)]);
  });

  it("builds ordinary DAG topology from the final x assigned to equal-center targets", async () => {
    const requests: GraphwarOneClickClearDagEdgeBuildRequest[] = [];
    const start = createPixelPoint(200, 225);
    const centerX = 300;
    const candidates = [
      { enemy: true, hitCenter: createPixelPoint(centerX, 250), hitRadius: 3, id: "large-y" },
      { enemy: true, hitCenter: createPixelPoint(centerX, 200), hitRadius: 3, id: "small-y" },
    ];

    await buildGraphwarOneClickClearPath(createDagCaptureOptions(start, candidates, requests));

    const jobs = requests[0]?.jobs ?? [];
    const startTargets = jobs.filter((job) => job.from === -1).map((job) => job.targetPoint);
    expect(startTargets).toHaveLength(2);
    expect(startTargets[0]?.x).toBeLessThan(startTargets[1]?.x ?? Number.NEGATIVE_INFINITY);
    expect(jobs).toContainEqual(
      expect.objectContaining({ from: 0, startPoint: startTargets[0], targetPoint: startTargets[1], to: 1 }),
    );
  });

  it("publishes each validated DAG prefix without an extra fallback search", async () => {
    const start = toImagePoint(-20, 0);
    const first = toImagePoint(-15, 0);
    const second = toImagePoint(-10, 0);
    const candidates = [
      { enemy: true, hitCenter: first, hitRadius: 2, id: "first" },
      { enemy: true, hitCenter: second, hitRadius: 2, id: "second" },
    ];
    const events: string[] = [];
    const incumbents: GraphwarOneClickClearIncumbent[] = [];
    let finalValidationCount = 0;
    let segmentValidationCount = 0;

    const result = await buildGraphwarOneClickClearPath({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      buildDagEdges: async (request) => {
        events.push(`batch:${request.jobs.length}`);
        return {
          routes: request.jobs.map((job) => ({
            jobId: job.id,
            route: [job.startPoint, job.targetPoint],
          })),
          timings: [],
        };
      },
      candidates,
      isDeleteOptimizationEnabled: false,
      deleteHitCheckRadiusPixels: 0,
      hitCandidates: candidates,
      onDebugTiming: (timing) => {
        if (timing.stage === "validate-final") {
          finalValidationCount += 1;
        }
        if (timing.stage === "segment-sample-trajectory") {
          segmentValidationCount += 1;
        }
      },
      onValidatedIncumbent: (incumbent) => {
        events.push("incumbent");
        incumbents.push(incumbent);
      },
      pathPoints: [start],
      routeMask: { mask: new Uint8Array(770 * 450), routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      settings: { ...settings, algorithm: "abs" },
      simulationBoundaryExpansion: 0,
      simulationMaskCacheId: 0,
    });

    expect(result.type).toBe("success");
    expect(events[0]).toBe("batch:3");
    expect(events.filter((event) => event.startsWith("batch:"))).toEqual(["batch:3"]);
    expect(incumbents.map((incumbent) => incumbent.pathPoints)).toEqual([
      [start, first],
      [start, first, second],
    ]);
    expect(incumbents.every((incumbent) => incumbent.trajectoryPoints.length >= 2)).toBe(true);
    expect(incumbents[1]?.trajectoryPoints.slice(0, incumbents[0]?.trajectoryPoints.length)).toEqual(
      incumbents[0]?.trajectoryPoints,
    );
    expect(segmentValidationCount).toBe(2);
    expect(finalValidationCount).toBe(1);
    expect(incumbents[0]?.expression).not.toBe("");
    expect(incumbents[0]).not.toHaveProperty("targetCount");
    expect(incumbents[0]).not.toHaveProperty("targetIds");
    expect(incumbents[0]).not.toHaveProperty("targetSequence");
  });

  it("keeps the natural prefix when the completed result has identical business metrics", async () => {
    const start = toImagePoint(-20, 0);
    const first = toImagePoint(-15, 0);
    const second = toImagePoint(-10, 0);
    const incumbents: GraphwarOneClickClearIncumbent[] = [];

    const result = await buildGraphwarOneClickClearPath({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      buildDagEdges: async (request) => ({
        routes: request.jobs.map((job) => ({
          jobId: job.id,
          ...(job.targetPoint.x === first.x && job.targetPoint.y === first.y
            ? { route: [job.startPoint, job.targetPoint] }
            : {}),
        })),
        timings: [],
      }),
      candidates: [
        { enemy: true, hitCenter: first, hitRadius: 2, id: "first" },
        { enemy: true, hitCenter: second, hitRadius: 2, id: "second" },
      ],
      deleteHitCheckRadiusPixels: 0,
      hitCandidates: [
        { enemy: true, hitCenter: first, hitRadius: 2, id: "first" },
        { enemy: true, hitCenter: second, hitRadius: 2, id: "second" },
      ],
      onValidatedIncumbent: (incumbent) => incumbents.push(incumbent),
      pathPoints: [start],
      routeMask: { mask: new Uint8Array(770 * 450), routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      settings: { ...settings, algorithm: "abs" },
      simulationBoundaryExpansion: 0,
      simulationMaskCacheId: 0,
    });

    expect(result.type).toBe("success");
    expect(incumbents).toHaveLength(1);
    if (result.type === "success") {
      expect(incumbents.at(-1)?.pathPoints).toEqual(result.pathPoints);
      expect(incumbents.at(-1)?.expression).toBe(result.expression);
      expect(incumbents.at(-1)?.trajectoryPoints.length).toBeGreaterThan(1);
      expect(result.trajectoryPoints.length).toBeGreaterThanOrEqual(incumbents.at(-1)?.trajectoryPoints.length ?? 0);
    }
  });

  it("reports failure after publishing the longest naturally validated prefix", async () => {
    const start = toImagePoint(-20, 0);
    const first = toImagePoint(-15, 0);
    const second = toImagePoint(-10, 0);
    const backward = toImagePoint(-16, 0);
    const candidates = [
      { enemy: true, hitCenter: first, hitRadius: 2, id: "first" },
      { enemy: true, hitCenter: second, hitRadius: 2, id: "second" },
    ];
    const incumbents: GraphwarOneClickClearIncumbent[] = [];
    let cancelled = false;

    const result = await buildGraphwarOneClickClearPath({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      buildDagEdges: async (request) => ({
        routes: request.jobs.map((job) => ({
          jobId: job.id,
          route:
            job.targetPoint.x === first.x
              ? [job.startPoint, job.targetPoint]
              : [job.startPoint, backward, job.targetPoint],
        })),
        timings: [],
      }),
      candidates,
      deleteHitCheckRadiusPixels: 0,
      hitCandidates: candidates,
      isCancelled: () => cancelled,
      onValidatedIncumbent: (incumbent) => {
        incumbents.push(incumbent);
        cancelled = true;
      },
      pathPoints: [start],
      routeMask: { mask: new Uint8Array(770 * 450), routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      settings: { ...settings, algorithm: "abs" },
      simulationBoundaryExpansion: 0,
      simulationMaskCacheId: 0,
    });

    expect(result).toMatchObject({ type: "failure" });
    expect(incumbents.map((incumbent) => incumbent.pathPoints)).toEqual([[start, first]]);
  });

  it("includes the validated Y'' launch angle in an incumbent", async () => {
    const start = toImagePoint(-20, 0);
    const target = toImagePoint(-10, 0);
    const candidate = { enemy: true, hitCenter: target, hitRadius: 2, id: "target" };
    const incumbents: GraphwarOneClickClearIncumbent[] = [];
    let buildCount = 0;

    const result = await buildGraphwarOneClickClearPath({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      buildDagEdges: async (request) => {
        buildCount += 1;
        return {
          routes: request.jobs.map((job) => ({
            jobId: job.id,
            route: [job.startPoint, job.targetPoint],
            stepRouteEndState: { resolvedStateKey: "0", resolvedY: 0 },
          })),
          timings: [],
        };
      },
      candidates: [candidate],
      deleteHitCheckRadiusPixels: 0,
      hitCandidates: [candidate],
      onValidatedIncumbent: (incumbent) => incumbents.push(incumbent),
      pathPoints: [start],
      routeMask: { mask: new Uint8Array(770 * 450), routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      settings: { ...settings, equation: "ddy" },
      simulationBoundaryExpansion: 0,
      simulationMaskCacheId: 0,
      validateStepRoute: () => true,
    });

    expect(result.type).toBe("success");
    expect(buildCount).toBe(1);
    expect(incumbents).toHaveLength(1);
    expect(incumbents[0]?.launchAngleRadians).toBeTypeOf("number");
    expect(Number.isFinite(incumbents[0]?.launchAngleRadians)).toBe(true);
    expect(incumbents[0]?.trajectoryPoints.length).toBeGreaterThan(1);
    if (result.type === "success") {
      expect(result.launchAngleRadians).toBe(incumbents[0]?.launchAngleRadians);
      expect(result.trajectoryPoints.length).toBeGreaterThanOrEqual(incumbents[0]?.trajectoryPoints.length ?? 0);
    }
  });

  it("does not publish a geometry route that fails formula validation", async () => {
    const start = toImagePoint(-20, 0);
    const backward = toImagePoint(-22, 0);
    const target = toImagePoint(-10, 0);
    const candidate = { enemy: true, hitCenter: target, hitRadius: 2, id: "target" };
    const incumbents: GraphwarOneClickClearIncumbent[] = [];
    let buildCount = 0;

    const result = await buildGraphwarOneClickClearPath({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      buildDagEdges: async (request) => {
        buildCount += 1;
        return {
          routes: request.jobs.map((job) => ({
            jobId: job.id,
            route: [job.startPoint, backward, job.targetPoint],
          })),
          timings: [],
        };
      },
      candidates: [candidate],
      deleteHitCheckRadiusPixels: 0,
      hitCandidates: [candidate],
      onValidatedIncumbent: (incumbent) => incumbents.push(incumbent),
      pathPoints: [start],
      routeMask: { mask: new Uint8Array(770 * 450), routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      settings: { ...settings, algorithm: "abs" },
      simulationBoundaryExpansion: 0,
      simulationMaskCacheId: 0,
    });

    expect(result.type).toBe("failure");
    expect(buildCount).toBe(1);
    expect(incumbents).toEqual([]);
  });

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
    const glitchSettings = {
      ...settings,
      equation: "dy" as const,
      stepGlitchMode: true,
      stepGlitchObstacleMask: simulationMask,
    };
    let finalValidationCount = 0;

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
      onDebugTiming: (timing) => {
        if (timing.stage === "validate-final") {
          finalValidationCount += 1;
        }
      },
      pathPoints: [start],
      routeMask: { mask: simulationMask, routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      settings: glitchSettings,
      simulationBoundaryExpansion: 0,
      simulationMaskCacheId: 1,
    });

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.targetIds).toEqual(["lower", "upper"]);
      expect(result.trajectoryPoints.length).toBeGreaterThan(1);
      const graphPoints = result.pathPoints.map((point) => imageToGraphPoint(point, bounds, boundsRect));
      for (let index = 1; index < graphPoints.length; index += 1) {
        const previous = graphPoints[index - 1];
        const point = graphPoints[index];
        if (!previous || !point) {
          throw new Error("Expected a dense one-click-clear path");
        }
        expect(point.x).toBeGreaterThan(previous.x);
      }

      const coldValidation = sampleGraphwarPathTargetSequence({
        boundaryExpansion: 0,
        bounds,
        boundsRect,
        collectVisiblePixels: true,
        obstacleMask: simulationMask,
        points: result.pathPoints,
        requiredTargets: [{ center: lower, radius: 24 }],
        settings: glitchSettings,
        stopOnTargetsComplete: false,
        targetCircles: [{ center: upper, radius: 24 }],
        targetControlPoints: result.pathPoints.slice(1),
        targetHitRadiusPixels: 24,
        targetPoints: [upper],
        trackedTargets: candidates.map((candidate) => ({
          center: candidate.hitCenter,
          radius: candidate.hitRadius,
        })),
      });
      const coldHitIds = candidates
        .map((candidate, index) => ({
          hitIndex: coldValidation.trackedTargetHitIndexes[index] ?? -1,
          id: candidate.id,
        }))
        .filter((candidate) => candidate.hitIndex >= 0)
        .sort((left, right) => left.hitIndex - right.hitIndex)
        .map((candidate) => candidate.id);

      expect(coldValidation.reachesTargetSequenceBeforeObstacle).toBe(true);
      expect(coldValidation.formulaContext?.formulaResult.expression).toBe(result.expression);
      expect(coldValidation.formulaContext?.launchAngleRadians).toBe(result.launchAngleRadians);
      expect(result.targetIds).toEqual(coldHitIds);
      expect(result.trajectoryPoints).toEqual(
        snapshotGraphwarVisibleTrajectoryPoints(coldValidation.visiblePixels, coldValidation.obstacleHitIndex),
      );
    }
    expect(finalValidationCount).toBe(0);
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
      simulationMaskCacheId: 1,
    });

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.pathPoints.at(-1)).toEqual(alternative);
      expect(result.targetIds).toEqual(["first", "second", "failed", "alternative"]);
    }
    expect(segmentSampleCount).toBe(3);
  });

  it.each(["abs", "step", "pchip", "akima"] as const)(
    "allows %s to add a target from the existing path tail without prior-run constraints",
    async (algorithm) => {
      const start = toImagePoint(-20, 0);
      const tail = toImagePoint(-15, 0);
      const nextTarget = toImagePoint(-10, 0);
      const simulationMask = new Uint8Array(770 * 450);
      const candidate = { enemy: true, hitCenter: nextTarget, hitRadius: 4, id: "next" };

      const result = await buildGraphwarOneClickClearPath({
        boundaryExpansion: 0,
        bounds,
        boundsRect,
        buildDagEdges: async (request) => ({
          routes: request.jobs.map((job) => ({
            jobId: job.id,
            route: [job.startPoint, job.targetPoint],
            stepRouteEndState: { resolvedStateKey: "0", resolvedY: 0 },
          })),
          timings: [],
        }),
        candidates: [candidate],
        deleteHitCheckRadiusPixels: 0,
        hitCandidates: [candidate],
        pathPoints: [start, tail],
        prefixTarget: { center: tail, radius: 4 },
        routeMask: { mask: simulationMask, routeTolerancePlanePixels: 2 },
        routeMode: "visibility-graph",
        settings: { ...settings, algorithm },
        simulationBoundaryExpansion: 0,
        simulationMask,
        simulationMaskCacheId: 1,
        validateStepRoute: () => true,
      });

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.targetIds).toEqual(["next"]);
      }
    },
  );

  it.each(statelessSplineModes)(
    "validates a stateless %s %s route through the shared DAG",
    async (algorithm, equation) => {
      const start = toImagePoint(-20, 0);
      const tail = toImagePoint(-15, 0);
      const nextTarget = toImagePoint(-10, 0);
      const simulationMask = new Uint8Array(770 * 450);
      const candidate = { enemy: true, hitCenter: nextTarget, hitRadius: 4, id: "next" };

      const result = await buildGraphwarOneClickClearPath({
        boundaryExpansion: 0,
        bounds,
        boundsRect,
        buildDagEdges: async (request) => ({
          routes: request.jobs.map((job) => ({ jobId: job.id, route: [job.startPoint, job.targetPoint] })),
          timings: [],
        }),
        candidates: [candidate],
        deleteHitCheckRadiusPixels: 0,
        hitCandidates: [candidate],
        pathPoints: [start, tail],
        prefixTarget: { center: tail, radius: 4 },
        routeMask: { mask: simulationMask, routeTolerancePlanePixels: 2 },
        routeMode: "visibility-graph",
        settings: { ...settings, algorithm, equation },
        simulationBoundaryExpansion: 0,
        simulationMask,
        simulationMaskCacheId: 1,
      });

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.targetIds).toEqual(["next"]);
      }
    },
  );

  it.each(statelessSplineModes)(
    "preserves target order for a stateless %s %s cold replay",
    async (algorithm, equation) => {
      const start = toImagePoint(-20, 0);
      const first = toImagePoint(-15, 0);
      const second = toImagePoint(-10, 0);
      const simulationMask = new Uint8Array(770 * 450);
      const candidates = [
        { enemy: true, hitCenter: first, hitRadius: 4, id: "first" },
        { enemy: true, hitCenter: second, hitRadius: 4, id: "second" },
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
        deleteHitCheckRadiusPixels: 0,
        hitCandidates: candidates,
        pathPoints: [start],
        routeMask: { mask: simulationMask, routeTolerancePlanePixels: 2 },
        routeMode: "visibility-graph",
        settings: { ...settings, algorithm, equation },
        simulationBoundaryExpansion: 0,
        simulationMask,
        simulationMaskCacheId: 1,
      });

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.targetIds).toEqual(["first", "second"]);
      }
    },
  );

  it.each(statelessSplineModes)(
    "rejects a stateless %s %s route that hits the simulation mask",
    async (algorithm, equation) => {
      const start = toImagePoint(-20, 0);
      const target = toImagePoint(-10, 0);
      const candidate = { enemy: true, hitCenter: target, hitRadius: 4, id: "target" };
      const splineSettings = { ...settings, algorithm, equation };
      const directSample = sampleGraphwarPathTargetSequence({
        bounds,
        boundsRect,
        points: [start, target],
        settings: splineSettings,
        targetCircles: [{ center: target, radius: candidate.hitRadius }],
        targetHitRadiusPixels: candidate.hitRadius,
        targetPoints: [target],
      });
      const obstacleGraphPoint = directSample.sample.points.find((point) => point.x >= -15);
      if (!obstacleGraphPoint) {
        throw new Error(`Expected ${algorithm} ${equation} to reach the obstacle x`);
      }
      const obstacle = imagePointToPlaneGridPoint(
        graphToImagePoint(obstacleGraphPoint, bounds, boundsRect),
        boundsRect,
      );
      const simulationMask = new Uint8Array(770 * 450);
      simulationMask[obstacle.y * 770 + obstacle.x] = 1;

      const result = await buildGraphwarOneClickClearPath({
        boundaryExpansion: 0,
        bounds,
        boundsRect,
        buildDagEdges: async (request) => ({
          routes: request.jobs.map((job) => ({ jobId: job.id, route: [job.startPoint, job.targetPoint] })),
          timings: [],
        }),
        candidates: [candidate],
        deleteHitCheckRadiusPixels: 0,
        hitCandidates: [candidate],
        pathPoints: [start],
        routeMask: { mask: new Uint8Array(770 * 450), routeTolerancePlanePixels: 2 },
        routeMode: "visibility-graph",
        settings: splineSettings,
        simulationBoundaryExpansion: 0,
        simulationMask,
        simulationMaskCacheId: 1,
      });

      expect(result).toMatchObject({ reason: "no-usable-target", type: "failure" });
    },
  );

  it.each(statelessSplineModes)(
    "revalidates stateless %s %s deletion and the returned final replay",
    async (algorithm, equation) => {
      const start = toImagePoint(-20, 0);
      const middle = toImagePoint(-15, 0);
      const target = toImagePoint(-10, 0);
      const simulationMask = new Uint8Array(770 * 450);
      const candidate = { enemy: true, hitCenter: target, hitRadius: 4, id: "target" };
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
        deleteHitCheckRadiusPixels: 0,
        hitCandidates: [candidate],
        isDeleteOptimizationEnabled: true,
        onDebugTiming: (timing) => {
          if (timing.stage === "validate-final") {
            finalValidationCount += 1;
          }
        },
        pathPoints: [start],
        routeMask: { mask: simulationMask, routeTolerancePlanePixels: 2 },
        routeMode: "visibility-graph",
        settings: { ...settings, algorithm, equation },
        simulationBoundaryExpansion: 0,
        simulationMask,
        simulationMaskCacheId: 1,
      });

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.pathPoints).toEqual([start, target]);
        expect(result.targetIds).toEqual(["target"]);
      }
      expect(finalValidationCount).toBe(1);
    },
  );

  it.each(["pchip", "akima"] as const)("returns a failed edge for a stateless %s route", async (algorithm) => {
    const start = toImagePoint(-20, 0);
    const target = toImagePoint(-10, 0);
    const candidate = { enemy: true, hitCenter: target, hitRadius: 4, id: "target" };

    const result = await buildGraphwarOneClickClearPath({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      buildDagEdges: async (request) => ({
        routes: request.jobs.map((job) => ({ jobId: job.id })),
        timings: [],
      }),
      candidates: [candidate],
      deleteHitCheckRadiusPixels: 0,
      hitCandidates: [candidate],
      pathPoints: [start],
      routeMask: { mask: new Uint8Array(770 * 450), routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      settings: { ...settings, algorithm },
      simulationBoundaryExpansion: 0,
      simulationMaskCacheId: 1,
    });

    expect(result).toMatchObject({ type: "failure" });
  });

  it.each([
    { resolvedStateKey: "0", resolvedY: Number.NaN },
    { resolvedStateKey: "invalid", resolvedY: 0 },
  ])("rejects an invalid Step state returned across the Worker seam", async (stepRouteEndState) => {
    const start = toImagePoint(-20, 0);
    const target = toImagePoint(-10, 0);
    const candidate = { enemy: true, hitCenter: target, hitRadius: 4, id: "target" };

    const result = await buildGraphwarOneClickClearPath({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      buildDagEdges: async (request) => ({
        routes: request.jobs.map((job) => ({
          jobId: job.id,
          route: [job.startPoint, job.targetPoint],
          stepRouteEndState,
        })),
        timings: [],
      }),
      candidates: [candidate],
      deleteHitCheckRadiusPixels: 0,
      hitCandidates: [candidate],
      pathPoints: [start],
      routeMask: { mask: new Uint8Array(770 * 450), routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      settings,
      simulationBoundaryExpansion: 0,
      simulationMaskCacheId: 1,
      validateStepRoute: () => true,
    });

    expect(result).toMatchObject({ type: "failure" });
  });

  it.each(["pchip", "akima"] as const)(
    "rejects a %s append when the new spline invalidates the existing prefix target",
    async (algorithm) => {
      const start = toImagePoint(-20, 0);
      const tail = toImagePoint(-5, -2);
      const nextTarget = toImagePoint(20, -14);
      const simulationMask = new Uint8Array(770 * 450);
      const prefixTarget = { center: tail, radius: 0.01 };
      const candidate = { enemy: true, hitCenter: nextTarget, hitRadius: 4, id: "next" };
      const splineSettings = { ...settings, algorithm };
      const prefixValidation = sampleGraphwarPathTargetSequence({
        bounds,
        boundsRect,
        points: [start, tail],
        settings: splineSettings,
        targetCircles: [prefixTarget],
        targetHitRadiusPixels: prefixTarget.radius,
        targetPoints: [tail],
      });
      const appendedTargetValidation = sampleGraphwarPathTargetSequence({
        bounds,
        boundsRect,
        points: [start, tail, nextTarget],
        settings: splineSettings,
        targetCircles: [{ center: nextTarget, radius: candidate.hitRadius }],
        targetHitRadiusPixels: candidate.hitRadius,
        targetPoints: [nextTarget],
      });

      expect(prefixValidation.reachesTargetSequenceBeforeObstacle).toBe(true);
      expect(appendedTargetValidation.reachesTargetSequenceBeforeObstacle).toBe(true);

      const result = await buildGraphwarOneClickClearPath({
        boundaryExpansion: 0,
        bounds,
        boundsRect,
        buildDagEdges: async (request) => ({
          routes: request.jobs.map((job) => ({ jobId: job.id, route: [job.startPoint, job.targetPoint] })),
          timings: [],
        }),
        candidates: [candidate],
        deleteHitCheckRadiusPixels: 0,
        hitCandidates: [candidate],
        pathPoints: [start, tail],
        prefixTarget,
        routeMask: { mask: simulationMask, routeTolerancePlanePixels: 2 },
        routeMode: "visibility-graph",
        settings: splineSettings,
        simulationBoundaryExpansion: 0,
        simulationMask,
        simulationMaskCacheId: 1,
      });

      expect(result).toMatchObject({ reason: "no-usable-target", type: "failure" });
    },
  );

  it("reuses the ABS proof for earlier targets in the current request", async () => {
    const start = toImagePoint(-20, 0);
    const tail = toImagePoint(-15, 0);
    const first = toImagePoint(-10, 0);
    const second = toImagePoint(-5, 0);
    const simulationMask = new Uint8Array(770 * 450);
    const candidates = [
      { enemy: true, hitCenter: first, hitRadius: 4, id: "first" },
      { enemy: true, hitCenter: second, hitRadius: 4, id: "second" },
    ];
    let segmentSampleCount = 0;

    const result = await buildGraphwarOneClickClearPath({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      buildDagEdges: async (request) => ({
        routes: request.jobs.map((job) => ({ jobId: job.id, route: [job.startPoint, job.targetPoint] })),
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
      pathPoints: [start, tail],
      prefixTarget: { center: tail, radius: 4 },
      routeMask: { mask: simulationMask, routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      settings: { ...settings, algorithm: "abs" },
      simulationBoundaryExpansion: 0,
      simulationMask,
      simulationMaskCacheId: 1,
    });

    expect(result.type).toBe("success");
    expect(segmentSampleCount).toBe(2);
  });

  it("keeps current-request target validation independent from an existing path tail", async () => {
    const start = toImagePoint(-20, 0);
    const tail = toImagePoint(-15, 0);
    const first = toImagePoint(-10, 0);
    const second = toImagePoint(-7, 0);
    const simulationMask = new Uint8Array(770 * 450);
    const candidates = [
      { enemy: true, hitCenter: first, hitRadius: 4, id: "first" },
      { enemy: true, hitCenter: second, hitRadius: 4, id: "second" },
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
      deleteHitCheckRadiusPixels: 0,
      hitCandidates: candidates,
      pathPoints: [start, tail],
      prefixTarget: { center: tail, radius: 4 },
      routeMask: { mask: simulationMask, routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      settings: { ...settings, algorithm: "abs" },
      simulationBoundaryExpansion: 0,
      simulationMask,
      simulationMaskCacheId: 1,
    });

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.targetIds).toEqual(["first", "second"]);
    }
  });

  it("reuses the exact final validation produced after local ABS point deletion", async () => {
    const start = toImagePoint(-20, 0);
    const middle = toImagePoint(-15, 0);
    const target = toImagePoint(-10, 0);
    const simulationMask = new Uint8Array(770 * 450);
    const candidate = { enemy: true, hitCenter: target, hitRadius: 2, id: "target" };
    const incumbents: GraphwarOneClickClearIncumbent[] = [];
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
      onValidatedIncumbent: (incumbent) => incumbents.push(incumbent),
      pathPoints: [start],
      routeMask: { mask: simulationMask, routeTolerancePlanePixels: 2 },
      routeMode: "visibility-graph",
      settings: {
        ...settings,
        algorithm: "abs",
      },
      simulationBoundaryExpansion: 0,
      simulationMask,
      simulationMaskCacheId: 1,
    });

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.pathPoints).toEqual([start, target]);
      expect(result.targetIds).toEqual(["target"]);
      expect(incumbents.at(-1)?.pathPoints).toEqual(result.pathPoints);
      expect(incumbents.at(-1)?.expression).toBe(result.expression);
      expect(incumbents.at(-1)?.trajectoryPoints).toEqual(result.trajectoryPoints);
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
      simulationMaskCacheId: 1,
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
          route: [job.startPoint, middle, job.targetPoint],
          stepRouteEndState: { resolvedStateKey: "40000", resolvedY: 4 },
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
      simulationMaskCacheId: 0,
      validateStepRoute,
    });

    expect(result.type).toBe("success");
    if (result.type === "success") {
      // 末端控制点可删，因为水平尾段仍会命中目标；绕开严格障碍的 middle 必须保留。
      expect(result.pathPoints).toEqual([start, middle]);
    }
  });
});

/** 创建只捕获普通 DAG 建边请求、不返回可用几何边的搜索选项。 */
function createDagCaptureOptions(
  start: PixelPoint,
  candidates: GraphwarOneClickClearCandidate[],
  requests: GraphwarOneClickClearDagEdgeBuildRequest[],
) {
  return {
    boundaryExpansion: 0,
    bounds,
    boundsRect,
    buildDagEdges: async (request: GraphwarOneClickClearDagEdgeBuildRequest) => {
      requests.push(request);
      return { routes: [], timings: [] };
    },
    candidates,
    isDeleteOptimizationEnabled: false,
    deleteHitCheckRadiusPixels: 0,
    hitCandidates: candidates,
    pathPoints: [start],
    routeMask: { mask: new Uint8Array(770 * 450), routeTolerancePlanePixels: 2 },
    routeMode: "visibility-graph" as const,
    settings: { ...settings, algorithm: "abs" as const },
    simulationBoundaryExpansion: 0,
    simulationMaskCacheId: 0,
  };
}

function toImagePoint(x: number, y: number) {
  return graphToImagePoint(createGraphPoint(x, y), bounds, boundsRect);
}
