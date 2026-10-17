import type { NoteEvent } from "./types";

/** Minimum recorded note duration in seconds, so exported notes are never zero-length. */
const MIN_NOTE_DURATION = 0.01;

/**
 * Accumulates note-on/note-off pairs into a list of completed notes. Times are relative to the recording start and
 * velocities are normalized (0–1).
 */
export class RecordingBuffer {
  private readonly active = new Map<number, { start: number; velocity: number }>();
  private readonly completed: NoteEvent[] = [];

  noteOn(time: number, midi: number, velocity: number): void {
    const held = this.active.get(midi);
    if (held !== undefined) {
      this.finish(held, time, midi);
    }
    this.active.set(midi, { start: time, velocity });
  }

  noteOff(time: number, midi: number): void {
    const held = this.active.get(midi);
    if (held !== undefined) {
      this.finish(held, time, midi);
    }
  }

  reset(): void {
    this.active.clear();
    this.completed.length = 0;
  }

  snapshot(): NoteEvent[] {
    return this.completed.slice().sort((left, right) => left.time - right.time || left.midi - right.midi);
  }

  private finish(held: { start: number; velocity: number }, end: number, midi: number): void {
    this.completed.push({
      midi,
      time: held.start,
      duration: Math.max(end - held.start, MIN_NOTE_DURATION),
      velocity: held.velocity,
    });
    this.active.delete(midi);
  }
}
