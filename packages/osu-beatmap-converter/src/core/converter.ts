/**
 * Public conversion workflow: validate browser-facing options, parse a Standard beatmap, apply timing/object
 * conversion, and serialize the resulting osu!mania text. This module owns orchestration and output metadata; low-level
 * osu! section parsing lives in `osu.ts`.
 */
import { convertHitObjects, getMode, removeSv, toManiaMetadata } from "./osu.ts";
import type { ConversionOptions, ConversionResult, Mania2kOptions, ManiaHitObject, ParsedBeatmap } from "./types.ts";

const DEFAULT_MANIA_2K: Mania2kOptions = {
  mainKey: 1,
  trillStartKey: 1,
  minimumJackTimeInterval: 200,
  maximumNumberOfJackNotes: 1,
};

/** Parse the metadata and hit-object sections while normalizing line endings. */
export function parseOsuBeatmap(input: string): ParsedBeatmap {
  const lines = input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const hitObjectsIndex = lines.findIndex((line) => line.trim() === "[HitObjects]");
  if (hitObjectsIndex < 0) {
    throw new Error("The input does not contain a [HitObjects] section.");
  }

  const metadata = lines.slice(0, hitObjectsIndex).map((line) => `${line}\n`);
  const hitObjects = lines.slice(hitObjectsIndex + 1).filter((line) => line.trim() !== "");
  return { metadata, hitObjects, mode: getMode(metadata) };
}

/** Convert a beatmap and return only the generated `.osu` text. */
export function convertOsuBeatmap(input: string, options: ConversionOptions): string {
  return convertOsuBeatmapDetailed(input, options).content;
}

/** Convert a beatmap and retain source mode and object-count information for the UI. */
export function convertOsuBeatmapDetailed(input: string, options: ConversionOptions): ConversionResult {
  validateOptions(options);
  const parsed = parseOsuBeatmap(input);
  if (parsed.mode !== "osu!") {
    throw new Error("Only osu!standard beatmaps are supported.");
  }

  const mania2k = { ...DEFAULT_MANIA_2K, ...options.mania2k };
  const metadata = toManiaMetadata(removeSv(parsed.metadata, options.removeSv ?? "none"), options.keys);
  const objects = convertHitObjects(parsed, options.keys, mania2k);
  const outputObjects = objects.filter((object) => object.type !== "unknown");
  return {
    content: `${metadata.join("")}[HitObjects]\n${outputObjects.map((object) => serializeObject(object, options.keys)).join("")}`,
    sourceMode: parsed.mode,
    outputKeys: options.keys,
    objectCount: outputObjects.length,
  };
}

/** Serialize a normalized object in the fixed osu!mania coordinate and sample format. */
function serializeObject(object: ManiaHitObject, keys: number): string {
  // osu!mania stores lane centers in the 512px playfield and uses y=192 for these generated objects.
  const x = Math.trunc(((object.key - 0.5) * 512) / keys);
  if (object.type === "hit circle") {
    return `${x},192,${object.startTime},1,0,0:0:0:0:\n`;
  }
  if (object.type === "hold") {
    return `${x},192,${object.startTime},128,0,${object.endTime}:0:0:0:0:\n`;
  }
  return "";
}

/** Validate untyped public API input before it reaches conversion logic. */
function validateOptions(options: ConversionOptions): void {
  if (!options || typeof options !== "object") {
    throw new Error("options are required.");
  }
  if (![1, 2, 4].includes(options.keys)) {
    throw new Error("keys must be one of 1, 2, or 4.");
  }
  if (
    options.removeSv !== undefined &&
    options.removeSv !== "none" &&
    options.removeSv !== "all" &&
    options.removeSv !== "inherited_timing_points"
  ) {
    throw new Error("removeSv must be none, all, or inherited_timing_points.");
  }
  // TypeScript callers can only supply a partial options object; JavaScript callers need this public-boundary check.
  if (
    options.mania2k !== undefined &&
    (typeof options.mania2k !== "object" || options.mania2k === null || Array.isArray(options.mania2k))
  ) {
    throw new Error("mania2k must be an object.");
  }
  if (options.mania2k?.minimumJackTimeInterval !== undefined && options.mania2k.minimumJackTimeInterval < 0) {
    throw new Error("minimumJackTimeInterval must be non-negative.");
  }
  if (
    options.mania2k?.maximumNumberOfJackNotes !== undefined &&
    (!Number.isInteger(options.mania2k.maximumNumberOfJackNotes) || options.mania2k.maximumNumberOfJackNotes < 0)
  ) {
    throw new Error("maximumNumberOfJackNotes must be a non-negative integer.");
  }
  for (const [name, value] of Object.entries(options.mania2k ?? {})) {
    if (!Number.isFinite(value)) {
      throw new Error(`${name} must be a finite number.`);
    }
  }
  for (const name of ["mainKey", "trillStartKey"] as const) {
    const value = options.mania2k?.[name];
    if (value !== undefined && value !== 1 && value !== 2) {
      throw new Error(`${name} must be 1 or 2.`);
    }
  }
}
