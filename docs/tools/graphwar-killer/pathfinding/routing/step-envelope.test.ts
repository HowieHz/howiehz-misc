import { describe, expect, it } from "vitest";

import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import type { GraphBounds } from "../../core/types";
import {
  createGraphwarPlaneMaskSummedArea,
  createGraphwarStepEnvelope,
  graphwarStepEnvelopeHitsPlaneMask,
  mapGraphClosedRegionToPlaneMask,
} from "./step-envelope";

const bounds: GraphBounds = {
  maxX: GRAPHWAR_PLANE_LENGTH,
  maxY: GRAPHWAR_PLANE_HEIGHT,
  minX: 0,
  minY: 0,
};

function createEmptyMask() {
  return new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
}

describe("strict Step envelope", () => {
  it("accepts xs=x0 and rejects an envelope that would start before x0", () => {
    const exact = createGraphwarStepEnvelope({
      centerX: 200,
      endX: 300,
      resolvedEndY: 200,
      resolvedStartY: 300,
      startX: 100,
    });
    expect(exact.ok).toBe(true);
    if (exact.ok) {
      expect(exact.envelope.xs).toBe(100);
      expect(exact.envelope.h).toEqual({ maxX: 100, maxY: 300, minX: 100, minY: 300 });
    }

    expect(
      createGraphwarStepEnvelope({
        centerX: 199,
        endX: 300,
        resolvedEndY: 200,
        resolvedStartY: 300,
        startX: 100,
      }),
    ).toEqual({ ok: false, reason: "symmetric-start-before-segment" });
  });

  it("normalizes upward, downward, and zero-height rectangles through one geometry path", () => {
    const upward = createGraphwarStepEnvelope({
      centerX: 200,
      endX: 300,
      resolvedEndY: 300,
      resolvedStartY: 100,
      startX: 100,
    });
    const downward = createGraphwarStepEnvelope({
      centerX: 200,
      endX: 300,
      resolvedEndY: 100,
      resolvedStartY: 300,
      startX: 100,
    });
    const level = createGraphwarStepEnvelope({
      centerX: 200,
      endX: 300,
      resolvedEndY: 200,
      resolvedStartY: 200,
      startX: 100,
    });

    expect(upward.ok && upward.envelope.r0).toEqual({ maxX: 200, maxY: 200, minX: 100, minY: 100 });
    expect(downward.ok && downward.envelope.r0).toEqual({ maxX: 200, maxY: 300, minX: 100, minY: 200 });
    expect(level.ok && level.envelope.r1.minY).toBe(200);
    expect(level.ok && level.envelope.r1.maxY).toBe(200);
  });

  it("treats grid-line edge and corner contact as blocked", () => {
    const pointRegion = mapGraphClosedRegionToPlaneMask({ maxX: 100, maxY: 300, minX: 100, minY: 300 }, bounds);
    expect(pointRegion).toEqual({ maxX: 100, maxY: 150, minX: 99, minY: 149 });

    const result = createGraphwarStepEnvelope({
      centerX: 200,
      endX: 300,
      resolvedEndY: 200,
      resolvedStartY: 300,
      startX: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !pointRegion) {
      return;
    }

    const mask = createEmptyMask();
    mask[pointRegion.minY * GRAPHWAR_PLANE_LENGTH + pointRegion.minX] = 1;
    expect(graphwarStepEnvelopeHitsPlaneMask(result.envelope, bounds, createGraphwarPlaneMaskSummedArea(mask), 0)).toBe(
      true,
    );
  });

  it("uses the same closed-domain query for empty and horizontally mirrored maps", () => {
    const result = createGraphwarStepEnvelope({
      centerX: 200,
      endX: 300,
      resolvedEndY: 200,
      resolvedStartY: 300,
      startX: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const emptyArea = createGraphwarPlaneMaskSummedArea(createEmptyMask());
    expect(graphwarStepEnvelopeHitsPlaneMask(result.envelope, bounds, emptyArea, 0)).toBe(false);
    expect(
      graphwarStepEnvelopeHitsPlaneMask(
        result.envelope,
        { ...bounds, maxX: 0, minX: GRAPHWAR_PLANE_LENGTH },
        emptyArea,
        0,
      ),
    ).toBe(false);
  });
});
