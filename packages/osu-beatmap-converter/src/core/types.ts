/**
 * Shared domain contracts for the converter. These types describe the supported Standard input boundary, normalized hit
 * objects, conversion settings, and the structured result consumed by the docs preview.
 */
/** Source mode accepted by the parser; malformed and unsupported input is `unknown`. */
export type SourceMode = "osu!" | "unknown";

/**
 * Controls which timing points survive conversion. `none` keeps all points, `all` keeps only the first row after the
 * `[TimingPoints]` header, and `inherited_timing_points` removes green lines.
 */
export type RemoveSvMode = "none" | "all" | "inherited_timing_points";

/** Options used by the 1K-to-2K jack/trill pass. */
export interface Mania2kOptions {
  /** One-based output lane number used by ordinary converted notes. */
  mainKey: 1 | 2;
  /** One-based output lane number assigned to the first note of each detected long jack. */
  trillStartKey: 1 | 2;
  /** Maximum interval, in milliseconds, considered part of a jack. */
  minimumJackTimeInterval: number;
  /** Number of jack notes allowed before alternating lanes as a trill. */
  maximumNumberOfJackNotes: number;
}

/** Public conversion settings. Unspecified values use the documented defaults. */
export interface ConversionOptions {
  /** Number of output Mania lanes supported by the converter. */
  keys: 1 | 2 | 4;
  /** Timing-point cleanup mode; defaults to preserving all points. */
  removeSv?: RemoveSvMode;
  /** Optional 1K-to-2K lane conversion settings. */
  mania2k?: Partial<Mania2kOptions>;
}

/** Normalized Standard object used by the serializer and lane conversion pass. */
export interface ManiaHitObject {
  /** Object kind after input-specific parsing. */
  type: "hit circle" | "hold" | "unknown";
  /** Start time in milliseconds. */
  startTime: number;
  /** End time in milliseconds; circles use the start time. */
  endTime: number;
  /** One-based output lane index in the generated Mania map. */
  key: number;
}

/** Parsed sections needed by the converter. All line endings are normalized to `\n`. */
export interface ParsedBeatmap {
  /** All source lines before `[HitObjects]`, normalized to newline-terminated strings. */
  metadata: string[];
  /** Non-empty raw object rows after the `[HitObjects]` header. */
  hitObjects: string[];
  /** Ruleset determined from the source metadata. */
  mode: SourceMode;
}

/** Conversion output plus provenance for callers that need reporting details. */
export interface ConversionResult {
  /** Complete `.osu` text ready to write to disk. */
  content: string;
  /** Successful conversions always originate from osu!standard. */
  sourceMode: "osu!";
  /** Requested output lane count. */
  outputKeys: number;
  /** Number of serialized output objects. */
  objectCount: number;
}
