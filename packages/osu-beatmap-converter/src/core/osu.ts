/**
 * Osu! file-format helpers: inspect the `[General]` mode, rewrite metadata, filter timing points, and translate
 * Standard hit-object rows into normalized Mania objects. The functions here are format/domain operations used by the
 * orchestration in `converter.ts`, not browser or file-system adapters.
 */
import type { Mania2kOptions, ManiaHitObject, ParsedBeatmap, RemoveSvMode, SourceMode } from "./types.ts";

/**
 * Read the single `Mode` declaration in `[General]`.
 *
 * Mode is the external boundary that selects the object grammar, so malformed, duplicate, missing, or misplaced
 * declarations must not silently become Standard.
 */
export function getMode(metadata: readonly string[]): SourceMode {
  let isInGeneral = false;
  let mode: string | undefined;
  for (const line of metadata) {
    const trimmed = line.trim();
    if (/^\[[^\]]+\]$/.test(trimmed)) {
      isInGeneral = trimmed === "[General]";
      continue;
    }
    if (!trimmed.startsWith("Mode:")) {
      continue;
    }
    if (!isInGeneral || mode !== undefined) {
      return "unknown";
    }
    mode = trimmed.slice("Mode:".length).trim();
  }
  if (mode === "0") {
    return "osu!";
  }
  return "unknown";
}

/** Rewrite only metadata fields whose values describe the output ruleset. */
export function toManiaMetadata(metadata: readonly string[], keys: number): string[] {
  return metadata.map((line) => {
    if (line.startsWith("CircleSize:")) {
      return `CircleSize:${keys}\n`;
    }
    if (line.startsWith("BeatmapSetID:")) {
      return "BeatmapSetID:-1\n";
    }
    if (line.trim().startsWith("Mode:")) {
      return "Mode: 3\n";
    }
    return line;
  });
}

/**
 * Remove timing points according to the selected mode: `none` keeps all, `all` keeps only the first row after the
 * `[TimingPoints]` header, and `inherited_timing_points` removes green lines.
 */
export function removeSv(metadata: readonly string[], mode: RemoveSvMode): string[] {
  if (mode === "none") {
    return [...metadata];
  }
  const result: string[] = [];
  let isInTimingPoints = false;
  let isFirstTimingPoint = false;
  for (const line of metadata) {
    const trimmed = line.trim();
    if (trimmed === "[TimingPoints]") {
      isInTimingPoints = true;
      isFirstTimingPoint = true;
      result.push(line);
      continue;
    }
    if (isInTimingPoints && (trimmed === "" || trimmed.startsWith("["))) {
      isInTimingPoints = false;
    }
    if (!isInTimingPoints || isFirstTimingPoint) {
      result.push(line);
      isFirstTimingPoint = false;
      continue;
    }
    if (mode === "inherited_timing_points" && line.trim().split(",").at(-2) !== "0") {
      result.push(line);
    }
  }
  return result;
}

/** Parse source objects, map them to Mania lanes, and apply the optional 2K pass. */
export function convertHitObjects(parsed: ParsedBeatmap, keys: number, options: Mania2kOptions): ManiaHitObject[] {
  const mania = parseHitObjects(parsed.metadata, parsed.hitObjects).map((object) => ({
    ...object,
    key: 1,
  }));
  if (keys === 1) {
    return mania;
  }
  return convert1kTo2k(mania, options);
}

/** Parse osu!standard CSV rows into normalized Mania objects. */
function parseHitObjects(metadata: readonly string[], lines: readonly string[]): ManiaHitObject[] {
  const timing = readTimingPoints(metadata);
  const sliderMultiplier = Number(
    metadata
      .find((line) => line.startsWith("SliderMultiplier:"))
      ?.slice("SliderMultiplier:".length)
      .trim() ?? 0,
  );
  return lines.map((line) => {
    const fields = line.split(",");
    const bits = finiteNumber(fields[3], "object type");
    const startTime = finiteNumber(fields[2], "start time");
    if (bits & 1) {
      return { type: "hit circle", startTime, endTime: startTime, key: 1 };
    }
    if (bits & 2) {
      return {
        type: "hold",
        startTime,
        endTime:
          startTime + sliderDuration(finiteNumber(fields[7], "slider length"), startTime, timing, sliderMultiplier),
        key: 1,
      };
    }
    if (bits & 8) {
      return { type: "hold", startTime, endTime: finiteNumber(fields[5], "spinner end time"), key: 1 };
    }
    return { type: "unknown", startTime: 0, endTime: 0, key: 1 };
  });
}

/** Read timing points in reverse declaration order so a later same-offset line wins when resolving a note time. */
function readTimingPoints(metadata: readonly string[]): TimingPoint[] {
  const start = metadata.findIndex((line) => line.trim() === "[TimingPoints]");
  if (start < 0) {
    return [];
  }
  const points: TimingPoint[] = [];
  for (const line of metadata.slice(start + 1)) {
    if (!line.trim() || line.trim().startsWith("[")) {
      break;
    }
    const fields = line.trim().split(",");
    const offset = Number(fields[0]);
    const beatLength = Number(fields[1]);
    if (fields.length >= 2 && Number.isFinite(offset) && Number.isFinite(beatLength)) {
      points.unshift({ offset, beatLength, uninherited: fields.at(-2) === "1" });
    }
  }
  return points.sort((a, b) => b.offset - a.offset);
}

interface TimingPoint {
  /** Time at which this timing point becomes active. */
  offset: number;
  /** Beat length for red lines or signed inherited-SV value for green lines. */
  beatLength: number;
  /** Whether the point is a red timing line. */
  uninherited: boolean;
}

/** Compute a slider's duration from the active red line and inherited SV multiplier. */
function sliderDuration(
  length: number,
  startTime: number,
  timing: readonly TimingPoint[],
  sliderMultiplier: number,
): number {
  const red = timing.find((point) => point.offset <= startTime && point.uninherited);
  const current = timing.find((point) => point.offset <= startTime);
  if (
    !red ||
    !current ||
    !Number.isFinite(length) ||
    !Number.isFinite(sliderMultiplier) ||
    sliderMultiplier <= 0 ||
    !Number.isFinite(red.beatLength) ||
    red.beatLength <= 0
  ) {
    return 0;
  }
  const sv = current.uninherited ? 1 : 100 / -current.beatLength;
  if (!Number.isFinite(sv) || sv <= 0) {
    return 0;
  }
  return (length / (sliderMultiplier * 100 * sv)) * red.beatLength;
}

/** Convert a required object field to a finite number with a useful parse error. */
function finiteNumber(raw: string | undefined, name: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${name} in hit object.`);
  }
  return value;
}

/** Apply the ordinary-lane and long-jack/trill algorithm in place. */
function convert1kTo2k(objects: ManiaHitObject[], options: Mania2kOptions): ManiaHitObject[] {
  if (objects.length === 0) {
    return objects;
  }
  for (const object of objects) {
    object.key = options.mainKey;
  }
  let stack: number[] = [];
  const stacks: number[][] = [];
  for (let index = 1; index <= objects.length; index += 1) {
    const interval =
      index < objects.length ? objects[index].startTime - objects[index - 1].startTime : Number.POSITIVE_INFINITY;
    if (interval < options.minimumJackTimeInterval) {
      if (stack.length === 0) {
        stack.push(index - 1, index);
      } else {
        stack.push(index);
      }
      continue;
    }
    if (stack.length > options.maximumNumberOfJackNotes) {
      stacks.push(stack);
    }
    stack = [];
  }
  for (const longJack of stacks) {
    objects[longJack[0]].key = options.trillStartKey;
    for (let index = 1; index < longJack.length; index += 1) {
      objects[longJack[index]].key = objects[longJack[index - 1]].key === 1 ? 2 : 1;
    }
  }
  return objects;
}
