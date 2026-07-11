import { describe, expect, it } from "vitest";

import type { GraphwarTargetingSoldier } from "../../../pathfinding/targeting";
import { useGraphwarTargetingContext } from "./context";

interface OwnedSoldier extends GraphwarTargetingSoldier {
  friendly?: boolean;
}

const bounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
const boundsRect = { height: 450, width: 770, x: 0, y: 0 };

describe("Graphwar targeting context ownership", () => {
  it("prefers Agent ownership over the launch-side x range", () => {
    const context = useGraphwarTargetingContext<OwnedSoldier>({
      boundsRect: { value: boundsRect },
      getBounds: () => bounds,
      getTargetBoundsRect: () => boundsRect,
      isFriendlySoldier: (soldier) => soldier.friendly,
      pathPixels: { value: [] },
      requireExactSoldierCenter: () => false,
    });

    expect(
      context.isSoldierOnLaunchSide({ friendly: false, hitRadius: 7, sourceCenterX: 385, sourceCenterY: 200 }),
    ).toBe(false);
    expect(
      context.isSoldierOnLaunchSide({ friendly: true, hitRadius: 7, sourceCenterX: 600, sourceCenterY: 200 }),
    ).toBe(true);
    expect(
      context.isFriendlyObstacleSoldier({ friendly: false, hitRadius: 7, sourceCenterX: 385, sourceCenterY: 200 }),
    ).toBe(false);
    expect(
      context.isFriendlyObstacleSoldier({ friendly: true, hitRadius: 7, sourceCenterX: 600, sourceCenterY: 200 }),
    ).toBe(true);
  });

  it("keeps the x-range fallback for screenshot detections", () => {
    const context = useGraphwarTargetingContext<OwnedSoldier>({
      boundsRect: { value: boundsRect },
      getBounds: () => bounds,
      getTargetBoundsRect: () => boundsRect,
      isFriendlySoldier: (soldier) => soldier.friendly,
      pathPixels: { value: [] },
      requireExactSoldierCenter: () => false,
    });

    expect(context.isSoldierOnLaunchSide({ hitRadius: 7, sourceCenterX: 385, sourceCenterY: 200 })).toBe(true);
    expect(context.isSoldierOnLaunchSide({ hitRadius: 7, sourceCenterX: 600, sourceCenterY: 200 })).toBe(false);
  });
});
