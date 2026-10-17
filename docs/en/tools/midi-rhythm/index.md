---
aside: false
publish: false
published: 2026-10-18T00:00:00+08:00
---

# MIDI Rhythm Game

Read and play `.mid` scores in the browser with a MIDI keyboard or the QWERTY keyboard. Supports speed control, lenient judgement, performance export, and review. Files never leave the device.

<!-- autocorrect-disable -->
<script setup lang="ts">
import MidiRhythm from "../../../tools/midi-rhythm/MidiRhythm.vue";
</script>

<MidiRhythm language="en" />
<!-- autocorrect-enable -->

## Usage

- **Import MIDI**: drop or choose a `.mid` file as the score; for multi-track files, tick the tracks you want to play, and overlapping same-pitch notes are split at the new attack (enable "Allow overlapping notes" to keep them as-is). To replay a previously exported performance, tick "Playback mode".
- **Mode**: judged play (play along, judged and recorded) or free recording (play freely and record).
- **Playback mode**: replays the performance, lights up the keys, and judges every note as perfect.
- **Input**: Web MIDI is preferred; when unsupported, use QWERTY — white keys `A S D F G H J K L ; '`, black keys `W E T Y U O P`, `Z`/`X` (or arrow keys) shift octaves, Space starts, pauses, or resumes.
- **Key hints**: in Settings choose Auto / Show / Hide to show keyboard characters on the keys.
- **Speed**: the slider ranges 0.25×–3× and shows the effective BPM; judgement windows stay fixed in milliseconds.
- **Count-in**: starting or resuming plays a 4-beat metronome count-in before the music begins.
- **Metronome**: available in both judged and free modes; judged mode follows the score BPM (with speed), free recording uses your chosen BPM.
- **Display**: adjust how many seconds of upcoming notes the playfield shows (3 s by default), and toggle bar lines and bar numbers (off by default).
- **Latency calibration**: audio output latency is compensated automatically; use "Audio offset" to nudge the audio against the visuals and "Latency calibration" to nudge judgement, both in ms.
- **Judgement**: defaults are Perfect ≤80 ms, Good ≤160 ms, Bad ≤300 ms (adjustable); beyond that is a miss, and a wrong key counts as a miss. Perfect is wide enough that the ear cannot hear an obvious offset.
- **Sound**: capsule switch between "Play on press" and "Auto-play"; the adjacent "Mute sound source" silences everything and disables the switch (for a piano with its own sound). Playback mode forces auto-play; free recording forces play-on-press.
- **Tone**: pick a built-in synth tone (electric piano by default), or load a local SoundFont (`.sf2`) library and choose a preset.
- **Apply changes**: judgement windows, speed, and sound settings changed during play/pause take effect after a restart.
- **Export performed MIDI**: both modes record your playing and can export `.mid`; judged mode keeps the score's tempo, free recording writes your chosen metronome BPM.
- **Fullscreen**: use the "Fullscreen" button or press `F11` to keep only the play area.

The page shows the score's note range by default (one octave of padding); enable "Show all 88 keys" in Settings to see the whole piano.
