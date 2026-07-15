import { describe, expect, it } from "vitest";

import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "./game/constants";
import { planePixelsToGraphUnits } from "./geometry";

describe("plane pixel distance conversion", () => {
  it("uses the selected axis span and native plane dimension", () => {
    const bounds = { maxX: -50, maxY: 9, minX: 50, minY: -9 };

    expect(planePixelsToGraphUnits(2, bounds, "x")).toBe(200 / GRAPHWAR_PLANE_LENGTH);
    expect(planePixelsToGraphUnits(-2, bounds, "y")).toBe(36 / GRAPHWAR_PLANE_HEIGHT);
  });
});
