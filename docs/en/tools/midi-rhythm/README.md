# MIDI Rhythm Game

**English** | [简体中文](../../tools/midi-rhythm/)

Read and play `.mid` scores in the browser with a MIDI keyboard or the QWERTY keyboard. Files never leave your device.

## Features

- **Input**: Web MIDI preferred; falls back to the QWERTY keyboard, with optional key hints on the piano keys.
- **Judgement**: Perfect / Good / Bad / Miss tiers with adjustable windows; a wrong key counts as a miss.
- **Modes**: judged play (load a score, judge, record, replay) and free recording (play freely and record).
- **Sound**: a capsule switch between "Play on press" and "Auto-play", plus "Mute sound source"; tones include built-in synths and local SoundFont (`.sf2`).
- **Helpers**: speed control, 4-beat count-in, metronome, adjustable look-ahead, bar lines, audio offset and latency calibration; changing timing settings mid-run shows a restart notice.
- **Export**: export your performance as `.mid`; judged mode keeps the score tempo, free recording writes your chosen BPM.
- **Accessibility**: judgement and status are announced through `aria-live`.

## Workflow

1. Drop or choose a `.mid` score; tick "Playback mode" to review a previously exported performance.
2. Pick judged play or free recording, then set the speed (free recording can also set the metronome BPM).
3. Start and play; the falling notes show combo and Perfect / Good / Bad / Miss counts.
4. After the run finishes, export your performance as a `.mid` file.

## Source Structure

- [index.md](./index.md) is the tool page.
- [MidiRhythm.vue](../../tools/midi-rhythm/MidiRhythm.vue) provides the play, judgement, recording, and export UI.
- [presentation/controls/](../../tools/midi-rhythm/presentation/controls/) holds reusable controls such as the toggle switch.
- [types/sfumato.d.ts](../../tools/midi-rhythm/types/sfumato.d.ts) declares the types for the `sfumato` SoundFont player.
- [core/](../../tools/midi-rhythm/core/) holds the testable judgement, timing, MIDI I/O, recording, keyboard-mapping, and settings-validation core.
