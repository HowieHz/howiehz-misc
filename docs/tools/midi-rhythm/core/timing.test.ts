import { describe, expect, it } from "vitest";

import { clampSpeed, effectiveBpm, noteWallTime, SPEED_MAX, SPEED_MIN } from "./timing";

describe("clampSpeed", () => {
  it("clamps into the allowed range", () => {
    expect(clampSpeed(0)).toBe(SPEED_MIN);
    expect(clampSpeed(1)).toBe(1);
    expect(clampSpeed(99)).toBe(SPEED_MAX);
  });
});

describe("effectiveBpm", () => {
  it("scales the base tempo", () => {
    expect(effectiveBpm(120, 1)).toBe(120);
    expect(effectiveBpm(120, 2)).toBe(240);
    expect(effectiveBpm(90, 0.5)).toBe(45);
  });
});

describe("noteWallTime", () => {
  it("divides by the speed multiplier", () => {
    expect(noteWallTime(2, 2)).toBe(1);
    expect(noteWallTime(2, 0.5)).toBe(4);
  });
});
