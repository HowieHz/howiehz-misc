# Beatmap Converter: osu!std -> osu!mania

**English** | [简体中文](../../../tools/osu-beatmap-converter/)

Convert multiple local `.osu` files to osu!mania beatmaps. Files are read, converted, and downloaded in the browser and never leave the device.

## Workflow

1. Drop or choose multiple `.osu` files. Each file becomes an independent queue row that can be appended or removed.
2. Set the target key count, SV handling, and every 1K-to-multi-key parameter.
3. Select Start conversion. Each row independently reports its result or error.
4. After conversion, inspect BPM, red/green timing lines, notes, and the full-map navigator before downloading each result or all results.

The beatmap viewport navigator sits above the preview and shows the current measure start at its left. Its long bar marks the current preview range; drag or click it, or use the left and right arrow keys to move through the map. Red lines are BPM/meter timing points and green lines are SV timing points. It is an inspection window, not a full beatmap player.

## Supported scope

Only osu!standard input is currently supported: circles become taps, sliders and spinners become holds. Taiko conversion is in development; Mania and Catch input are not supported. See [the online page](./) and [the core README](../../../../packages/osu-beatmap-converter/README.md) for the exact rules.
