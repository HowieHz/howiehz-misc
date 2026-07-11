import { describe, expect, it } from "vitest";

import { createPixelPoint } from "../../core/types";
import { createGraphwarOneClickClearHitCandidates, type GraphwarOneClickClearTargetSoldier } from "./targets";

const geometry = {
  bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
  boundsRect: { height: 450, width: 770, x: 0, y: 0 },
};
const soldiers: GraphwarOneClickClearTargetSoldier[] = [
  { hitRadius: 7, id: "shooter", sourceCenterX: 385, sourceCenterY: 100 },
  { hitRadius: 7, id: "same-team-right", sourceCenterX: 500, sourceCenterY: 100 },
  { hitRadius: 7, id: "enemy-left", sourceCenterX: 300, sourceCenterY: 100 },
];

describe("one-click-clear authoritative teams", () => {
  it("uses Agent ownership instead of the screenshot x-range heuristic", () => {
    const candidates = createGraphwarOneClickClearHitCandidates({
      friendlyFireEnabled: false,
      geometry,
      isFriendlySoldier: (soldier) => soldier.id === "same-team-right",
      pathPoints: [createPixelPoint(385, 100)],
      soldiers,
    });

    expect(candidates.map((candidate) => candidate.id)).toEqual(["enemy-left"]);
    expect(candidates[0]?.enemy).toBe(true);
  });

  it("keeps the x-range heuristic for screenshot recognition", () => {
    const candidates = createGraphwarOneClickClearHitCandidates({
      friendlyFireEnabled: false,
      geometry,
      pathPoints: [createPixelPoint(385, 100)],
      soldiers,
    });

    expect(candidates.map((candidate) => candidate.id)).toEqual(["same-team-right"]);
  });

  it("includes authoritative friendlies only when friendly fire is enabled", () => {
    const candidates = createGraphwarOneClickClearHitCandidates({
      friendlyFireEnabled: true,
      geometry,
      isFriendlySoldier: (soldier) => soldier.id === "same-team-right",
      pathPoints: [createPixelPoint(385, 100)],
      soldiers,
    });

    expect(candidates.map(({ enemy, id }) => ({ enemy, id }))).toEqual([
      { enemy: false, id: "same-team-right" },
      { enemy: true, id: "enemy-left" },
    ]);
  });
});
