/**
 * Stable core barrel: re-export the public conversion functions and domain types without exposing implementation
 * helpers such as timing-point resolution or lane assignment.
 */
export type {
  ConversionOptions,
  ConversionResult,
  Mania2kOptions,
  ManiaHitObject,
  ParsedBeatmap,
  RemoveSvMode,
  SourceMode,
} from "./types.ts";
export { convertOsuBeatmap, convertOsuBeatmapDetailed, parseOsuBeatmap } from "./converter.ts";
