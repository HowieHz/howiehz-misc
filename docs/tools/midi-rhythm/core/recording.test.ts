import { describe, expect, it } from "vitest";

import { RecordingBuffer } from "./recording";

describe("RecordingBuffer", () => {
  it("completes notes from note-on/note-off pairs", () => {
    const buffer = new RecordingBuffer();
    buffer.noteOn(0, 60, 0.8);
    buffer.noteOff(0.5, 60);
    expect(buffer.snapshot()).toEqual([{ midi: 60, time: 0, duration: 0.5, velocity: 0.8 }]);
  });

  it("closes a held note on re-strike", () => {
    const buffer = new RecordingBuffer();
    buffer.noteOn(0, 60, 0.8);
    buffer.noteOn(0.4, 60, 0.9);
    expect(buffer.snapshot()).toEqual([{ midi: 60, time: 0, duration: 0.4, velocity: 0.8 }]);
  });

  it("sorts the snapshot by time", () => {
    const buffer = new RecordingBuffer();
    buffer.noteOn(1, 62, 0.7);
    buffer.noteOff(1.2, 62);
    buffer.noteOn(0, 60, 0.8);
    buffer.noteOff(0.4, 60);
    expect(buffer.snapshot().map((note) => note.midi)).toEqual([60, 62]);
  });

  it("ignores note-off without a matching note-on", () => {
    const buffer = new RecordingBuffer();
    buffer.noteOff(0.5, 60);
    expect(buffer.snapshot()).toEqual([]);
  });

  it("clamps zero-length notes to a minimum duration", () => {
    const buffer = new RecordingBuffer();
    buffer.noteOn(0, 60, 0.8);
    buffer.noteOff(0, 60);
    expect(buffer.snapshot()[0].duration).toBeGreaterThan(0);
  });
});
