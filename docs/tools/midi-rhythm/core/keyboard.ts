import { PIANO_MAX_MIDI, PIANO_MIN_MIDI } from "./types";

/**
 * QWERTY two-row piano layout. Each entry maps a `KeyboardEvent.key` to a semitone offset from the home C; white keys
 * sit on the home row and black keys on the row above.
 */
const KEY_TO_SEMITONE = new Map<string, number>([
  ["a", 0], // C
  ["w", 1], // C#
  ["s", 2], // D
  ["e", 3], // D#
  ["d", 4], // E
  ["f", 5], // F
  ["t", 6], // F#
  ["g", 7], // G
  ["y", 8], // G#
  ["h", 9], // A
  ["u", 10], // A#
  ["j", 11], // B
  ["k", 12], // C+1
  ["o", 13], // C#+1
  ["l", 14], // D+1
  ["p", 15], // D#+1
  [";", 16], // E+1
  ["'", 17], // F+1
]);

/** MIDI number of the home C (C2) before octave shifting. */
const KEYBOARD_BASE_MIDI = 36;

/** Convert a keyboard key into a MIDI note, or `undefined` when unmapped or out of range. */
export function keyToMidi(key: string, octaveShift: number): number | undefined {
  const semitone = KEY_TO_SEMITONE.get(key.toLowerCase());
  if (semitone === undefined) {
    return undefined;
  }
  const midi = KEYBOARD_BASE_MIDI + semitone + octaveShift * 12;
  if (midi < PIANO_MIN_MIDI || midi > PIANO_MAX_MIDI) {
    return undefined;
  }
  return midi;
}

/** Reverse lookup: the keyboard character shown on a key for a MIDI note, or `undefined` when out of the layout. */
export function midiToKeyLabel(midi: number, octaveShift: number): string | undefined {
  const semitone = midi - (KEYBOARD_BASE_MIDI + octaveShift * 12);
  if (semitone < 0 || semitone >= 18) {
    return undefined;
  }
  for (const [key, value] of KEY_TO_SEMITONE) {
    if (value === semitone) {
      return key.toUpperCase();
    }
  }
  return undefined;
}
