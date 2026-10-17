import type { JudgementResult, JudgementStats, JudgementThresholds, ScoreNote } from "./types";

/** Score weights for the three hit tiers. */
export const PERFECT_WEIGHT = 1;
export const GOOD_WEIGHT = 0.6;
export const BAD_WEIGHT = 0.2;

/** Create an empty judgement stat accumulator. */
export function createEmptyStats(): JudgementStats {
  return { perfect: 0, good: 0, bad: 0, missed: 0, extraMiss: 0, combo: 0, maxCombo: 0, score: 0 };
}

/** Fold one judgement result into the running stats, maintaining combo and score. */
export function applyResult(stats: JudgementStats, result: JudgementResult): JudgementStats {
  if (result.type === "hit") {
    if (result.tier === "perfect") {
      const combo = stats.combo + 1;
      return {
        ...stats,
        perfect: stats.perfect + 1,
        combo,
        maxCombo: Math.max(stats.maxCombo, combo),
        score: stats.score + PERFECT_WEIGHT,
      };
    }
    if (result.tier === "good") {
      const combo = stats.combo + 1;
      return {
        ...stats,
        good: stats.good + 1,
        combo,
        maxCombo: Math.max(stats.maxCombo, combo),
        score: stats.score + GOOD_WEIGHT,
      };
    }
    return { ...stats, bad: stats.bad + 1, combo: 0, score: stats.score + BAD_WEIGHT };
  }
  if (result.type === "missed") {
    return { ...stats, missed: stats.missed + 1, combo: 0 };
  }
  return { ...stats, extraMiss: stats.extraMiss + 1, combo: 0 };
}

interface PendingNote {
  midi: number;
  time: number;
  judged: boolean;
}

/** Real-time judgement engine over a sorted score. */
export class JudgementEngine {
  private readonly notes: PendingNote[];
  private readonly perfectSeconds: number;
  private readonly goodSeconds: number;
  private readonly badSeconds: number;
  private nextIndex = 0;
  private pendingCount: number;

  constructor(scoreNotes: readonly ScoreNote[], thresholds: JudgementThresholds) {
    this.notes = scoreNotes
      .map((note) => ({ midi: note.midi, time: note.time, judged: false }))
      .sort((left, right) => left.time - right.time || left.midi - right.midi);
    this.perfectSeconds = thresholds.perfectMs / 1000;
    this.goodSeconds = thresholds.goodMs / 1000;
    this.badSeconds = thresholds.badMs / 1000;
    this.pendingCount = this.notes.length;
  }

  get totalNotes(): number {
    return this.notes.length;
  }

  get remainingNotes(): number {
    return this.pendingCount;
  }

  /** Mark every note whose bad window has closed as missed; returns the misses. */
  advance(now: number): JudgementResult[] {
    const results: JudgementResult[] = [];
    while (this.nextIndex < this.notes.length) {
      const note = this.notes[this.nextIndex];
      if (note.judged) {
        this.nextIndex += 1;
        continue;
      }
      if (note.time + this.badSeconds > now) {
        break;
      }
      note.judged = true;
      this.pendingCount -= 1;
      results.push({ type: "missed", midi: note.midi, noteTime: note.time });
      this.nextIndex += 1;
    }
    return results;
  }

  /** Judge a key press at `now`; always returns a hit or an extra miss. */
  press(now: number, midi: number): JudgementResult {
    const lower = now - this.badSeconds;
    const upper = now + this.badSeconds;
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = this.nextIndex; index < this.notes.length; index += 1) {
      const note = this.notes[index];
      if (note.judged || note.midi !== midi || note.time < lower) {
        continue;
      }
      if (note.time > upper) {
        break;
      }
      const distance = Math.abs(note.time - now);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    if (bestIndex === -1) {
      return { type: "extraMiss", midi };
    }

    const note = this.notes[bestIndex];
    note.judged = true;
    this.pendingCount -= 1;
    const offsetSeconds = now - note.time;
    const tier =
      Math.abs(offsetSeconds) <= this.perfectSeconds
        ? "perfect"
        : Math.abs(offsetSeconds) <= this.goodSeconds
          ? "good"
          : "bad";
    return { type: "hit", tier, midi: note.midi, noteTime: note.time, offsetSeconds };
  }
}
