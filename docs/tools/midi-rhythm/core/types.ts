/** Lowest MIDI note on an 88-key piano (A0). */
export const PIANO_MIN_MIDI = 21;
/** Highest MIDI note on an 88-key piano (C8). */
export const PIANO_MAX_MIDI = 108;
/** Number of keys on an 88-key piano. */
export const PIANO_KEY_COUNT = PIANO_MAX_MIDI - PIANO_MIN_MIDI + 1;

/** Default judgement window thresholds in milliseconds, from tightest to loosest. */
export const DEFAULT_PERFECT_MS = 80;
export const DEFAULT_GOOD_MS = 160;
export const DEFAULT_BAD_MS = 300;

/** Default metronome tempo for free recording, in BPM. */
export const DEFAULT_METRONOME_BPM = 120;

/** A note event with second-based timing and normalized velocity (0–1). */
export interface NoteEvent {
  midi: number;
  time: number;
  duration: number;
  velocity: number;
}

/** A tempo change in ticks, used to preserve a score's tempo map when exporting. */
export interface TempoEvent {
  ticks: number;
  bpm: number;
}

/** A score note reduced to the fields the judgement engine needs. */
export interface ScoreNote {
  midi: number;
  time: number;
}

/** Adjustable judgement windows in milliseconds. */
export interface JudgementThresholds {
  perfectMs: number;
  goodMs: number;
  badMs: number;
}

/** A hit within the perfect, good, or bad window. */
export interface HitResult {
  type: "hit";
  tier: "perfect" | "good" | "bad";
  midi: number;
  noteTime: number;
  offsetSeconds: number;
}

/** A score note that expired without being hit. */
export interface MissedNoteResult {
  type: "missed";
  midi: number;
  noteTime: number;
}

/** A key press that matched no expected note. */
export interface ExtraMissResult {
  type: "extraMiss";
  midi: number;
}

export type JudgementResult = HitResult | MissedNoteResult | ExtraMissResult;

/** Running judgement counters and combo state. */
export interface JudgementStats {
  perfect: number;
  good: number;
  bad: number;
  missed: number;
  extraMiss: number;
  combo: number;
  maxCombo: number;
  score: number;
}
