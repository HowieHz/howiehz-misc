import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";

import { encodeMidi, parseMidiScore, selectScoreTracks } from "./midi-io";

describe("parseMidiScore", () => {
  it("round-trips encoded notes with a single tempo", () => {
    const bytes = encodeMidi(
      [
        { midi: 60, time: 0.5, duration: 0.25, velocity: 0.8 },
        { midi: 64, time: 1, duration: 0.5, velocity: 0.6 },
      ],
      120,
    );
    const parsed = parseMidiScore(bytes);
    expect(parsed.baseBpm).toBeCloseTo(120);
    expect(parsed.notes).toHaveLength(2);
    expect(parsed.notes[0].midi).toBe(60);
    expect(parsed.notes[0].time).toBeCloseTo(0.5);
    expect(parsed.notes[0].velocity).toBeCloseTo(0.8, 1);
  });

  it("filters notes outside the 88-key range", () => {
    const bytes = encodeMidi(
      [
        { midi: 60, time: 0, duration: 0.2, velocity: 0.8 },
        { midi: 0, time: 0, duration: 0.2, velocity: 0.8 },
        { midi: 127, time: 0, duration: 0.2, velocity: 0.8 },
      ],
      120,
    );
    const parsed = parseMidiScore(bytes);
    expect(parsed.notes.map((note) => note.midi)).toEqual([60]);
  });

  it("preserves a tempo map when provided", () => {
    const bytes = encodeMidi(
      [{ midi: 60, time: 1, duration: 0.2, velocity: 0.8 }],
      [
        { ticks: 0, bpm: 100 },
        { ticks: 480, bpm: 200 },
      ],
    );
    const parsed = parseMidiScore(bytes);
    expect(parsed.tempos).toHaveLength(2);
    expect(parsed.tempos[0].bpm).toBe(100);
    expect(parsed.tempos[1].bpm).toBe(200);
  });

  it("emits measure bar times from the time signature", () => {
    const parsed = parseMidiScore(encodeMidi([{ midi: 60, time: 0, duration: 3.9, velocity: 0.8 }], 120));
    expect(parsed.barTimes[0]).toBeCloseTo(0);
    expect(parsed.barTimes[1]).toBeCloseTo(2);
  });

  it("splits overlapping same-pitch notes at the new attack", () => {
    const midi = new Midi();
    midi.header.setTempo(120);
    midi.addTrack().addNote({ midi: 60, time: 0, duration: 1, velocity: 0.8 });
    midi.addTrack().addNote({ midi: 60, time: 0.5, duration: 1, velocity: 0.6 });
    const parsed = parseMidiScore(midi.toArray());
    expect(parsed.notes).toHaveLength(2);
    expect(parsed.notes[0]?.duration).toBeCloseTo(0.5);
    expect(parsed.notes[1]?.time).toBeCloseTo(0.5);
    expect(parsed.notes[1]?.duration).toBeCloseTo(1);
  });

  it("collapses same-pitch notes that start together", () => {
    const midi = new Midi();
    midi.header.setTempo(120);
    midi.addTrack().addNote({ midi: 60, time: 0, duration: 1, velocity: 0.8 });
    midi.addTrack().addNote({ midi: 60, time: 0, duration: 2, velocity: 0.6 });
    const parsed = parseMidiScore(midi.toArray());
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.notes[0]?.duration).toBeCloseTo(2);
  });

  it("keeps overlapping notes when allowOverlap is true", () => {
    const midi = new Midi();
    midi.header.setTempo(120);
    midi.addTrack().addNote({ midi: 60, time: 0, duration: 1, velocity: 0.8 });
    midi.addTrack().addNote({ midi: 60, time: 0.5, duration: 1, velocity: 0.6 });
    const parsed = parseMidiScore(midi.toArray(), true);
    expect(parsed.notes).toHaveLength(2);
    expect(parsed.notes[0]?.duration).toBeCloseTo(1);
    expect(parsed.notes[1]?.time).toBeCloseTo(0.5);
  });

  it("rebuilds the score from selected tracks", () => {
    const midi = new Midi();
    midi.header.setTempo(120);
    midi.addTrack().addNote({ midi: 60, time: 0, duration: 0.5, velocity: 0.8 });
    midi.addTrack().addNote({ midi: 72, time: 0, duration: 0.5, velocity: 0.8 });
    const score = parseMidiScore(midi.toArray());
    expect(score.tracks).toHaveLength(2);
    const onlySecond = selectScoreTracks(score, [1]);
    expect(onlySecond.notes.map((note) => note.midi)).toEqual([72]);
  });

  it("handles an empty score", () => {
    const parsed = parseMidiScore(encodeMidi([], 90));
    expect(parsed.notes).toEqual([]);
    expect(parsed.baseBpm).toBeCloseTo(90);
    expect(parsed.minMidi).toBe(21);
    expect(parsed.maxMidi).toBe(108);
  });
});
