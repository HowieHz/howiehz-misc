import { DEFAULT_BAD_MS, DEFAULT_GOOD_MS, DEFAULT_PERFECT_MS, type JudgementThresholds } from "./types";

/** The three judgement-window text fields before validation. */
export interface ThresholdInputText {
  perfectMs: string;
  goodMs: string;
  badMs: string;
}

/** Clamping limits for each judgement window, in milliseconds. */
export const THRESHOLD_LIMITS = {
  perfect: { min: 10, max: 200 },
  good: { min: 20, max: 400 },
  bad: { min: 50, max: 800 },
} as const;

/** Parse and normalize threshold text into valid, ordered values (perfect ≤ good ≤ bad). */
export function parseThresholds(text: ThresholdInputText): JudgementThresholds {
  const perfectMs = readThreshold(text.perfectMs, DEFAULT_PERFECT_MS, THRESHOLD_LIMITS.perfect);
  const goodMs = Math.max(readThreshold(text.goodMs, DEFAULT_GOOD_MS, THRESHOLD_LIMITS.good), perfectMs);
  const badMs = Math.max(readThreshold(text.badMs, DEFAULT_BAD_MS, THRESHOLD_LIMITS.bad), goodMs);
  return { perfectMs, goodMs, badMs };
}

function readThreshold(text: string, fallback: number, limits: { min: number; max: number }): number {
  const parsed = Number.parseFloat(text);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, limits.min), limits.max);
}
