# osu-beatmap-converter

**English** | [简体中文](./README.zh-Hans.md)

Zero-runtime-dependency conversion core for converting osu!standard beatmaps to osu!mania 1K, 2K, or 4K.

This private workspace package is consumed by the docs site and is not published to npm. It only processes strings supplied by the caller.

## Library

```ts
import { convertOsuBeatmapDetailed } from "osu-beatmap-converter";

const result = convertOsuBeatmapDetailed(inputText, {
  keys: 4,
  removeSv: "all",
  mania2k: {
    mainKey: 1,
    trillStartKey: 1,
    minimumJackTimeInterval: 200,
    maximumNumberOfJackNotes: 1,
  },
});

console.log(result.content);
```

`convertOsuBeatmap(input, options)` returns output text. `convertOsuBeatmapDetailed(input, options)` also returns the source mode, requested key count, and serialized object count. Both functions only process the supplied string.

| Option                             | Values                                   | Meaning                                                                                                                                                                |
| ---------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keys`                             | `1`, `2`, `4`                            | Required target Mania key count.                                                                                                                                       |
| `removeSv`                         | `none`, `all`, `inherited_timing_points` | `none` keeps all SV; `all` keeps the first row in `[TimingPoints]` and removes the rest; `inherited_timing_points` removes inherited timing points (green lines) only. |
| `mania2k.mainKey`                  | `1`, `2`                                 | Output lane number for ordinary notes in the 1K-to-multi-key pass; numbering starts at `1`.                                                                            |
| `mania2k.trillStartKey`            | `1`, `2`                                 | Output lane number for the first note when a jack is split into a trill segment; numbering starts at `1`.                                                              |
| `mania2k.minimumJackTimeInterval`  | non-negative milliseconds                | Consecutive notes closer than this interval belong to one jack.                                                                                                        |
| `mania2k.maximumNumberOfJackNotes` | non-negative integer                     | A longer jack becomes a trill alternating between output lanes 1 and 2.                                                                                                |

Lanes are numbered `1`, `2`, `3`, and so on from left to right. Ordinary notes use `mainKey`. When a jack is split into a trill segment, its first note uses `trillStartKey`, then later notes alternate between lanes `1` and `2`. 4K output keeps four lanes, but this converter currently writes notes only to lanes `1` and `2`.

The library defaults to `removeSv: "none"` (keep all SV); unspecified `mania2k` fields use the documented defaults. Public API input is validated at the JavaScript boundary.

## Conversion Rules

- Standard circles become Mania taps; sliders and spinners become holds.
- Standard 2K and 4K use the converter's jack/trill pass.
- Metadata is changed to Mania, the requested key count, and `BeatmapSetID:-1`. Output objects use fixed Mania coordinates and normalized sample values.
- Only osu!standard input is accepted. Taiko conversion is still in development; Mania and Catch input are unsupported.

## Online Tool

The [online converter](https://howiehz.top/misc/tools/osu-beatmap-converter/) supports local batch conversion, downloads, and a beatmap preview. Files stay in the browser and are never uploaded.

## Development

```bash
pnpm --filter osu-beatmap-converter build
pnpm --filter osu-beatmap-converter test
```

The regression suite covers the four supplied `.osu` examples across every supported key count and SV mode, plus malformed and unsupported mode declarations.

## License

This project is licensed under the [BSD 3-Clause License](./LICENSE).
