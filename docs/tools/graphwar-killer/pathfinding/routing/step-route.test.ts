import { describe, expect, it } from "vitest";

import { imagePointToPlaneGridPoint } from "../../core/plane-grid";
import { createGraphPoint, createPixelPoint } from "../../core/types";
import type { BoundsRect, GraphBounds } from "../../core/types";
import { createGraphwarPlaneMaskSummedArea } from "./step-envelope";
import {
  createGraphwarStepPathfindingEdgeEvaluator,
  createGraphwarStepRouteModel,
  evaluateGraphwarStepRouteTransition,
} from "./step-route";

const bounds: GraphBounds = { maxX: 1024, maxY: 512, minX: 0, minY: 0 };
const boundsRect: BoundsRect = { height: 512, width: 1024, x: 0, y: 0 };
const emptyArea = createGraphwarPlaneMaskSummedArea(new Uint8Array(770 * 450));

describe("stateful Step route evaluation", () => {
  it("rejects effective ODE Glitch Mode combinations", () => {
    const base = {
      algorithm: "step" as const,
      decimalPlaces: 0,
      formulaPathSteepness: 67,
      steepness: 67,
      stepGlitchMode: true,
    };

    expect(createGraphwarStepRouteModel(200, { ...base, equation: "y" })).toBeDefined();
    expect(createGraphwarStepRouteModel(200, { ...base, equation: "dy" })).toBeUndefined();
    expect(createGraphwarStepRouteModel(200, { ...base, equation: "ddy" })).toBeUndefined();
  });

  it("uses the incoming label state instead of projecting from the route origin", () => {
    const model = createGraphwarStepRouteModel(200, {
      algorithm: "step",
      decimalPlaces: 0,
      equation: "y",
      steepness: 67,
    });
    expect(model).toBeDefined();
    if (!model) {
      return;
    }

    const exactStartPoint = createPixelPoint(128, 311);
    const exactTargetPoint = createPixelPoint(512, 311.5);
    const evaluator = createGraphwarStepPathfindingEdgeEvaluator({
      boundaryInset: 0,
      bounds,
      boundsRect,
      exactStartPoint,
      exactTargetPoint,
      model,
      resolvedStartY: 201,
      summedArea: emptyArea,
    });
    const start = imagePointToPlaneGridPoint(exactStartPoint, boundsRect);
    const target = imagePointToPlaneGridPoint(exactTargetPoint, boundsRect);

    expect(evaluator.evaluateEdge(start, target, 201)?.nextRouteState).toBe(200);
    expect(evaluator.evaluateEdge(start, target, 200)?.nextRouteState).toBe(201);
  });

  it("reconstructs the incoming plateau from its canonical integer key", () => {
    const model = createGraphwarStepRouteModel(0, {
      algorithm: "step",
      decimalPlaces: 0,
      equation: "y",
      steepness: 67,
    });
    expect(model).toBeDefined();
    if (!model) {
      return;
    }

    const result = evaluateGraphwarStepRouteTransition(
      model,
      999,
      createGraphPoint(100, 1),
      createGraphPoint(300, 2),
      { boundaryInset: 0, bounds, summedArea: emptyArea },
      "1",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transition.resolvedStartY).toBe(1);
      expect(result.transition.resolvedEndY).toBe(2);
      expect(result.transition.routeStateKey).toBe("2");
    }
  });
});
