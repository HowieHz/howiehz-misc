import { Midi } from "@tonejs/midi";

import { PIANO_MAX_MIDI, PIANO_MIN_MIDI, type NoteEvent, type TempoEvent } from "./types";

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
}

/** Parse a MIDI buffer into piano notes (21–108) with second-based timing. */
export function parseMidiScore(data: ArrayBuffer | Uint8Array): ParsedScore {
  const midi = new Midi(data);
  const notes: NoteEvent[] = [];
  for (const track of midi.tracks) {
    for (const note of track.notes) {
      if (note.midi >= PIANO_MIN_MIDI && note.midi <= PIANO_MAX_MIDI) {
        notes.push({ midi: note.midi, time: note.time, duration: note.duration, velocity: note.velocity });
      }
    }
  }
  notes.sort((left, right) => left.time - right.time || left.midi - right.midi);

  const tempos = midi.header.tempos.map((tempo) => ({ ticks: tempo.ticks, bpm: tempo.bpm }));
  const baseBpm = tempos[0]?.bpm ?? 120;
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

  return { notes, baseBpm, duration, trackCount: midi.tracks.length, minMidi, maxMidi, tempos, barTimes };
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
