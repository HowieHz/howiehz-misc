import { Midi } from "@tonejs/midi";

import { PIANO_MAX_MIDI, PIANO_MIN_MIDI, type NoteEvent, type TempoEvent } from "./types";

/** One MIDI track, with its notes filtered to the playable range. */
export interface ScoreTrack {
  index: number;
  name: string;
  noteCount: number;
  notes: NoteEvent[];
}

/** A parsed MIDI score with all fields the game needs. */
export interface ParsedScore {
  notes: NoteEvent[];
  baseBpm: number;
  duration: number;
  trackCount: number;
  minMidi: number;
  maxMidi: number;
  tempos: TempoEvent[];
  /** Measure start times in score seconds. */
  barTimes: number[];
  /** Per-track notes, used to let the player pick which tracks to play. */
  tracks: ScoreTrack[];
}

/** Parse a MIDI buffer into piano notes (21–108) with second-based timing. */
export function parseMidiScore(data: ArrayBuffer | Uint8Array, allowOverlap = false): ParsedScore {
  const midi = new Midi(data);
  const tracks: ScoreTrack[] = midi.tracks.map((track, index) => {
    const trackNotes: NoteEvent[] = [];
    for (const note of track.notes) {
      if (note.midi >= PIANO_MIN_MIDI && note.midi <= PIANO_MAX_MIDI) {
        trackNotes.push({ midi: note.midi, time: note.time, duration: note.duration, velocity: note.velocity });
      }
    }
    trackNotes.sort((left, right) => left.time - right.time || left.midi - right.midi);
    return { index, name: track.name, noteCount: trackNotes.length, notes: trackNotes };
  });
  const allNotes = tracks.flatMap((track) => track.notes);
  const mergedNotes = allowOverlap ? sortByTime(allNotes) : normalizeNoteOverlaps(allNotes);

  const tempos = midi.header.tempos.map((tempo) => ({ ticks: tempo.ticks, bpm: tempo.bpm }));
  const baseBpm = tempos[0]?.bpm ?? 120;
  let minMidi = PIANO_MAX_MIDI;
  let maxMidi = PIANO_MIN_MIDI;
  let duration = 0;
  for (const note of mergedNotes) {
    minMidi = Math.min(minMidi, note.midi);
    maxMidi = Math.max(maxMidi, note.midi);
    duration = Math.max(duration, note.time + note.duration);
  }
  if (mergedNotes.length === 0) {
    minMidi = PIANO_MIN_MIDI;
    maxMidi = PIANO_MAX_MIDI;
  }

  const signatures: { ticks: number; timeSignature: number[] }[] =
    midi.header.timeSignatures.length > 0 ? midi.header.timeSignatures : [{ ticks: 0, timeSignature: [4, 4] }];
  const barTimes: number[] = [];
  for (let index = 0; index < signatures.length; index += 1) {
    const signature = signatures[index];
    if (!signature) {
      continue;
    }
    const numerator = signature.timeSignature[0] ?? 4;
    const denominator = signature.timeSignature[1] ?? 4;
    const ticksPerMeasure = midi.header.ppq * numerator * (4 / denominator);
    if (ticksPerMeasure <= 0) {
      continue;
    }
    const nextSignature = signatures[index + 1];
    const endTicks = nextSignature ? nextSignature.ticks : Number.POSITIVE_INFINITY;
    for (let ticks = signature.ticks; ticks < endTicks; ticks += ticksPerMeasure) {
      const seconds = midi.header.ticksToSeconds(ticks);
      if (seconds > duration + 1) {
        break;
      }
      barTimes.push(seconds);
    }
  }

  return {
    notes: mergedNotes,
    baseBpm,
    duration,
    trackCount: midi.tracks.length,
    minMidi,
    maxMidi,
    tempos,
    barTimes,
    tracks,
  };
}

/** Rebuild a score from the selected MIDI tracks, merging overlaps again. */
export function selectScoreTracks(
  score: ParsedScore,
  trackIndices: readonly number[],
  allowOverlap = false,
): ParsedScore {
  const selected = new Set(trackIndices);
  const selectedNotes = score.tracks.filter((track) => selected.has(track.index)).flatMap((track) => track.notes);
  const notes = allowOverlap ? sortByTime(selectedNotes) : normalizeNoteOverlaps(selectedNotes);

  let minMidi = PIANO_MAX_MIDI;
  let maxMidi = PIANO_MIN_MIDI;
  let duration = 0;
  for (const note of notes) {
    minMidi = Math.min(minMidi, note.midi);
    maxMidi = Math.max(maxMidi, note.midi);
    duration = Math.max(duration, note.time + note.duration);
  }
  if (notes.length === 0) {
    minMidi = PIANO_MIN_MIDI;
    maxMidi = PIANO_MAX_MIDI;
  }

  // Keep the full measure grid so bar lines still line up with the whole arrangement.
  return { ...score, notes, minMidi, maxMidi, duration };
}

/** Sort notes by time, then pitch. */
function sortByTime(notes: readonly NoteEvent[]): NoteEvent[] {
  return [...notes].sort((left, right) => left.time - right.time || left.midi - right.midi);
}

/**
 * Normalize same-pitch overlaps so one key is never held twice at once: a later attack ends the previous note at that
 * attack (re-strike), while notes that start together collapse into the longer hold. Different pitches never interact.
 */
function normalizeNoteOverlaps(notes: readonly NoteEvent[]): NoteEvent[] {
  const grouped = [...notes].sort((left, right) => left.midi - right.midi || left.time - right.time);
  const normalized: NoteEvent[] = [];
  for (const note of grouped) {
    const last = normalized[normalized.length - 1];
    if (last && last.midi === note.midi) {
      const lastEnd = last.time + last.duration;
      if (note.time <= last.time + 1e-6) {
        // Same attack (a duplicate from another track): keep the longer hold.
        last.duration = Math.max(lastEnd, note.time + note.duration) - last.time;
        last.velocity = Math.max(last.velocity, note.velocity);
        continue;
      }
      if (note.time < lastEnd - 1e-6) {
        // Overlapping re-attack: end the previous note at the new attack.
        last.duration = note.time - last.time;
      }
    }
    normalized.push({ ...note });
  }
  return normalized.sort((left, right) => left.time - right.time || left.midi - right.midi);
}

/** Encode recorded notes into a MIDI file, with a single tempo or a full tempo map. */
export function encodeMidi(notes: readonly NoteEvent[], tempo: number | readonly TempoEvent[]): Uint8Array {
  const midi = new Midi();
  if (typeof tempo === "number") {
    midi.header.setTempo(tempo);
  } else if (tempo.length > 0) {
    midi.header.tempos = tempo.map((entry) => ({ ticks: entry.ticks, bpm: entry.bpm }));
    midi.header.update();
  } else {
    midi.header.setTempo(120);
  }

  const track = midi.addTrack();
  for (const note of notes) {
    track.addNote({ midi: note.midi, time: note.time, duration: note.duration, velocity: note.velocity });
  }
  return midi.toArray();
}
