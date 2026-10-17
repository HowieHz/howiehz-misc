import { describe, expect, it } from "vitest";

import { applyResult, createEmptyStats, JudgementEngine } from "./judgment";
import { DEFAULT_BAD_MS, DEFAULT_GOOD_MS, DEFAULT_PERFECT_MS } from "./types";

const thresholds = { perfectMs: DEFAULT_PERFECT_MS, goodMs: DEFAULT_GOOD_MS, badMs: DEFAULT_BAD_MS };

describe("JudgementEngine", () => {
  it("scores a perfect hit inside the tightest window", () => {
    const engine = new JudgementEngine([{ midi: 60, time: 1 }], thresholds);
    expect(engine.advance(1)).toEqual([]);
    expect(engine.press(1, 60)).toEqual({ type: "hit", tier: "perfect", midi: 60, noteTime: 1, offsetSeconds: 0 });
  });

  it("classifies good and bad offsets", () => {
    const goodEngine = new JudgementEngine([{ midi: 60, time: 1 }], thresholds);
    goodEngine.advance(1.125);
    expect(goodEngine.press(1.125, 60)).toEqual({
      type: "hit",
      tier: "good",
      midi: 60,
      noteTime: 1,
      offsetSeconds: 0.125,
    });

    const badEngine = new JudgementEngine([{ midi: 60, time: 1 }], thresholds);
    badEngine.advance(1.25);
    expect(badEngine.press(1.25, 60)).toEqual({
      type: "hit",
      tier: "bad",
      midi: 60,
      noteTime: 1,
      offsetSeconds: 0.25,
    });
  });

  it("marks a note missed once its bad window closes", () => {
    const engine = new JudgementEngine([{ midi: 60, time: 1 }], thresholds);
    expect(engine.advance(1.3)).toEqual([{ type: "missed", midi: 60, noteTime: 1 }]);
  });

  it("returns an extra miss when a key matches no note", () => {
    const engine = new JudgementEngine([{ midi: 60, time: 1 }], thresholds);
    engine.advance(1);
    expect(engine.press(1, 61)).toEqual({ type: "extraMiss", midi: 61 });
  });

  it("matches the nearest note of the same pitch within the window", () => {
    const engine = new JudgementEngine(
      [
        { midi: 60, time: 1 },
        { midi: 60, time: 1.2 },
      ],
      thresholds,
    );
    engine.advance(1.18);
    const result = engine.press(1.18, 60);
    expect(result.type).toBe("hit");
    if (result.type === "hit") {
      expect(result.tier).toBe("perfect");
      expect(result.noteTime).toBe(1.2);
      expect(result.offsetSeconds).toBeCloseTo(-0.02);
    }
  });
});

describe("applyResult", () => {
  it("maintains combo on perfect/good and resets on miss", () => {
    let stats = createEmptyStats();
    stats = applyResult(stats, { type: "hit", tier: "perfect", midi: 60, noteTime: 0, offsetSeconds: 0 });
    stats = applyResult(stats, { type: "hit", tier: "good", midi: 62, noteTime: 1, offsetSeconds: 0.0625 });
    expect(stats.combo).toBe(2);
    expect(stats.maxCombo).toBe(2);
    stats = applyResult(stats, { type: "missed", midi: 64, noteTime: 2 });
    expect(stats.combo).toBe(0);
    expect(stats.missed).toBe(1);
  });

  it("resets combo on bad hits", () => {
    let stats = createEmptyStats();
    stats = applyResult(stats, { type: "hit", tier: "perfect", midi: 60, noteTime: 0, offsetSeconds: 0 });
    stats = applyResult(stats, { type: "hit", tier: "bad", midi: 62, noteTime: 1, offsetSeconds: 0.2 });
    expect(stats.combo).toBe(0);
    expect(stats.bad).toBe(1);
    expect(stats.score).toBeCloseTo(1.2);
  });

  it("accumulates extra misses without touching the score", () => {
    let stats = createEmptyStats();
    stats = applyResult(stats, { type: "hit", tier: "perfect", midi: 60, noteTime: 0, offsetSeconds: 0 });
    stats = applyResult(stats, { type: "extraMiss", midi: 61 });
    expect(stats.combo).toBe(0);
    expect(stats.extraMiss).toBe(1);
    expect(stats.score).toBe(1);
  });
});
