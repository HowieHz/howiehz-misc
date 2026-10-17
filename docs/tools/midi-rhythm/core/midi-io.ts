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
export function parseMidiScore(data: ArrayBuffer | Uint8Array): ParsedScore {
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
  const mergedNotes = mergeOverlappingNotes(tracks.flatMap((track) => track.notes));

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
export function selectScoreTracks(score: ParsedScore, trackIndices: readonly number[]): ParsedScore {
  const selected = new Set(trackIndices);
  const notes = mergeOverlappingNotes(
    score.tracks.filter((track) => selected.has(track.index)).flatMap((track) => track.notes),
  );

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

/**
 * Merge same-pitch notes whose time ranges overlap, which is common when a multi-track MIDI repeats the same part
 * across tracks. The result is one held note per key press.
 */
function mergeOverlappingNotes(notes: readonly NoteEvent[]): NoteEvent[] {
  const grouped = [...notes].sort((left, right) => left.midi - right.midi || left.time - right.time);
  const merged: NoteEvent[] = [];
  for (const note of grouped) {
    const last = merged[merged.length - 1];
    if (last && last.midi === note.midi && note.time < last.time + last.duration - 1e-6) {
      last.duration = Math.max(last.time + last.duration, note.time + note.duration) - last.time;
      last.velocity = Math.max(last.velocity, note.velocity);
      continue;
    }
    merged.push({ ...note });
  }
  return merged.sort((left, right) => left.time - right.time || left.midi - right.midi);
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
