---
aside: false
publish: false
published: 2026-09-04T00:00:00+08:00
---

# Beatmap Converter: osu!std -> osu!mania

This page reads, converts, and downloads batches of local `.osu` files in the browser. No file contents are uploaded.

<!-- autocorrect-disable -->
<script setup lang="ts">
import OsuBeatmapConverter from "../../../tools/osu-beatmap-converter/OsuBeatmapConverter.vue";
</script>

<OsuBeatmapConverter language="en" />
<!-- autocorrect-enable -->

## Parameters

| Parameter                            | Effect                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Target keys                          | Choose 1K, 2K, or 4K for the output map.                                                            |
| SV handling                          | Keep all speed changes, remove all speed changes, or remove green-line speed changes only.          |
| Jack split strategy                  | Use a preset to set the two jack parameters below, or choose Custom to tune them yourself.          |
| Ordinary note lane number            | Choose the lane for ordinary notes. Lanes are numbered 1, 2, 3, and so on from left to right.       |
| Trill segment first-note lane number | Choose the lane for the first note in a trill segment; later notes alternate between lanes 1 and 2. |
| Minimum jack interval                | Adjacent notes closer than this interval are treated as one jack segment.                           |
| Maximum jack notes                   | A jack segment longer than this becomes a trill segment.                                            |

The page starts at 2K with the Default preset. With 1K selected, the four lane and jack settings do not affect the result, so they are disabled. Choosing files or changing a setting refreshes the preview immediately; download buttons stay visible, remain disabled before and during conversion, and become enabled when conversion finishes.

## Conversion Rules

- Standard circles become Mania notes; sliders and spinners become holds.
- Only Standard input is accepted for now. Taiko conversion is in development; Mania and Catch input are not supported.

The preview shows the current BPM, beat lines, red BPM/meter timing points, green SV timing points, and taps/holds. The beatmap viewport navigator above it shows the current measure start at its left; its long bar marks the current preview range. Drag or click it, or use the left and right arrow keys to move it.
