import { describe, expect, it } from "vitest";

import { keyToMidi, midiToKeyLabel } from "./keyboard";

describe("keyToMidi", () => {
  it("maps the home row to white keys starting at C2", () => {
    expect(keyToMidi("a", 0)).toBe(36); // C2
    expect(keyToMidi("s", 0)).toBe(38); // D2
    expect(keyToMidi("d", 0)).toBe(40); // E2
    expect(keyToMidi("f", 0)).toBe(41); // F2
    expect(keyToMidi("g", 0)).toBe(43); // G2
    expect(keyToMidi("h", 0)).toBe(45); // A2
    expect(keyToMidi("j", 0)).toBe(47); // B2
  });

  it("maps the upper row to black keys", () => {
    expect(keyToMidi("w", 0)).toBe(37); // C#2
    expect(keyToMidi("e", 0)).toBe(39); // D#2
    expect(keyToMidi("t", 0)).toBe(42); // F#2
    expect(keyToMidi("y", 0)).toBe(44); // G#2
    expect(keyToMidi("u", 0)).toBe(46); // A#2
  });

  it("shifts octaves", () => {
    expect(keyToMidi("a", 1)).toBe(48); // C3
    expect(keyToMidi("h", -2)).toBe(21); // A0, lowest key
    expect(keyToMidi("k", 5)).toBe(108); // C8, highest key
  });

  it("rejects unmapped keys", () => {
    expect(keyToMidi("z", 0)).toBeUndefined();
    expect(keyToMidi("1", 0)).toBeUndefined();
    expect(keyToMidi("", 0)).toBeUndefined();
  });

  it("rejects keys that fall outside the 88-key piano", () => {
    expect(keyToMidi("a", -2)).toBeUndefined(); // 12 < A0
    expect(keyToMidi("'", 5)).toBeUndefined(); // 113 > C8
  });
});

describe("midiToKeyLabel", () => {
  it("maps white and black keys to their keyboard characters", () => {
    expect(midiToKeyLabel(36, 0)).toBe("A"); // C2
    expect(midiToKeyLabel(37, 0)).toBe("W"); // C#2
    expect(midiToKeyLabel(47, 0)).toBe("J"); // B2
    expect(midiToKeyLabel(48, 0)).toBe("K"); // C3
  });

  it("follows the octave shift", () => {
    expect(midiToKeyLabel(48, 1)).toBe("A"); // C3 becomes home C when shifted up
  });

  it("returns undefined outside the layout", () => {
    expect(midiToKeyLabel(21, 0)).toBeUndefined(); // A0, below home C
    expect(midiToKeyLabel(108, 0)).toBeUndefined(); // C8, far above
  });
});
