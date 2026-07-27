import { describe, expect, it } from "vitest";

import {
  createGraphwarRoutePolicyData,
  createGraphwarThetaStarLookaheadColumnOffsetData,
  graphwarThetaStarHeuristics,
  graphwarThetaStarLookaheadColumnOffsets,
  graphwarVisibilityGraphHeuristics,
} from "./canonical-data";

describe("Graphwar route policy canonical data", () => {
  it("keeps the TypeScript heuristics and WASM initialization layout on one source", () => {
    expect([...createGraphwarRoutePolicyData()]).toEqual([
      graphwarVisibilityGraphHeuristics.concaveCrossTolerance,
      graphwarVisibilityGraphHeuristics.collinearDistanceTolerance,
      graphwarVisibilityGraphHeuristics.contourFreeCellSearchRadius,
      graphwarVisibilityGraphHeuristics.rdpEpsilonRouteToleranceRatio,
      graphwarVisibilityGraphHeuristics.rdpMaxEpsilon,
      graphwarVisibilityGraphHeuristics.rdpMinEpsilon,
      graphwarVisibilityGraphHeuristics.previewCandidateLimit,
      graphwarVisibilityGraphHeuristics.previewEdgeLimit,
      graphwarVisibilityGraphHeuristics.previewExpansionInterval,
      graphwarThetaStarHeuristics.previewCandidateLimit,
      graphwarThetaStarHeuristics.previewEdgeLimit,
      graphwarThetaStarHeuristics.previewExpansionInterval,
    ]);
    expect([...graphwarThetaStarLookaheadColumnOffsets]).toEqual([1, 2, 4, 8, 16, 32, 64, 128]);
    const offsets = createGraphwarThetaStarLookaheadColumnOffsetData();
    offsets[0] = 99;
    expect(createGraphwarThetaStarLookaheadColumnOffsetData()[0]).toBe(1);
  });

  it("returns a fresh route policy array for each WASM session", () => {
    const first = createGraphwarRoutePolicyData();
    first[0] = 99;
    expect(createGraphwarRoutePolicyData()[0]).toBe(graphwarVisibilityGraphHeuristics.concaveCrossTolerance);
  });
});
