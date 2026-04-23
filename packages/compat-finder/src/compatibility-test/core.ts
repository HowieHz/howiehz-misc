/**
 * Represents an inclusive range of 1-based target indexes.
 */
export interface TargetRange {
  start: number;
  end: number;
}

export const COMPATIBILITY_TEST_ALGORITHMS = ["binary-split", "leave-one-out"] as const;

export type CompatibilityTestAlgorithm = (typeof COMPATIBILITY_TEST_ALGORITHMS)[number];

export const DEFAULT_COMPATIBILITY_TEST_ALGORITHM = "binary-split";

export interface CompatibilityTestOptions {
  algorithm?: CompatibilityTestAlgorithm;
}

/**
 * Describes the next step to present to the caller.
 */
export interface CompatibilityTestStep {
  /** Ranges of 1-based target indexes to test in the current step. */
  promptTargetRanges: readonly TargetRange[];
  /** Number of targets covered by `promptTargetRanges`. */
  promptTargetCount: number;
  /** Internal range-based search state for diagnostics and advanced UIs. */
  debug: CompatibilityTestDebugStep;
  /** Whether the caller needs to provide a new answer for this step. If false, call `getNextAnswerableCompatibilityTestStep` or `skipCachedCompatibilityTestSteps`. */
  requiresAnswer: boolean;
}

/**
 * Exposes the current internal search state in range form.
 */
export interface CompatibilityTestDebugStep {
  /** The currently active search range. */
  activeTargetRange: TargetRange;
  /** Deferred search ranges that may be revisited later. */
  pendingTargetRanges: readonly TargetRange[];
  /** Ranges already confirmed by previous narrowing steps. */
  confirmedTargetRanges: readonly TargetRange[];
}

export interface CompatibilityTestStateBase {
  targetCount: number;
  algorithm: CompatibilityTestAlgorithm;
  /** Targets already confirmed by previous narrowing steps. */
  definedTargets: number[];
  cachedResults: Map<string, boolean>;
  stopped: boolean;
  /** Final 1-based target indexes. Meaningful only after the session is complete. */
  resultTargets: number[];
}

export type CompatibilityTestState =
  | import("./engine/binary-split.ts").BinarySplitCompatibilityTestState
  | import("./engine/leave-one-out.ts").LeaveOneOutCompatibilityTestState;

export type CompatibilitySessionStep<Target> =
  | CompatibilitySessionTestingStep<Target>
  | CompatibilitySessionCompleteStep<Target>;

export interface CompatibilitySessionTestingStep<Target> {
  status: "testing";
  /** 1-based target numbers to test in this step. */
  targetNumbers: number[];
  /** Targets to test in this step, preserving the input target values. */
  targets: Target[];
}

export interface CompatibilitySessionCompleteStep<Target> {
  status: "complete";
  /** 1-based target numbers identified as incompatible. */
  targetNumbers: number[];
  /** Targets identified as incompatible, preserving the input target values. */
  targets: Target[];
}

export interface CompatibilitySession<Target> {
  /** Reads the current answerable step or final result. */
  current: () => CompatibilitySessionStep<Target>;
  /**
   * Applies one answer and returns the next step.
   *
   * `true` means the issue appears with the current targets.
   * `false` means the issue does not appear with the current targets.
   */
  answer: (hasIssue: boolean) => CompatibilitySessionStep<Target>;
  /** Removes the latest answer and returns the restored current step. */
  undo: () => CompatibilitySessionStep<Target>;
}

/**
 * Counts the number of targets covered by the provided ranges.
 *
 * @param ranges The ranges to count.
 * @returns The total number of covered targets.
 */
export function countTargetsInRanges(ranges: readonly TargetRange[]): number {
  return ranges.reduce((total, range) => total + getRangeLength(range), 0);
}

/**
 * Expands target ranges into target indexes up to the provided limit.
 *
 * @param ranges The ranges to expand.
 * @param limit The maximum number of targets to return.
 * @returns The expanded target indexes, in ascending order.
 */
export function takeTargetsFromRanges(ranges: readonly TargetRange[], limit: number): number[] {
  if (limit <= 0) {
    return [];
  }

  const targets: number[] = [];
  for (const range of ranges) {
    for (let target = range.start; target <= range.end && targets.length < limit; target += 1) {
      targets.push(target);
    }

    if (targets.length >= limit) {
      break;
    }
  }

  return targets;
}

/**
 * Returns the normalized intersection of two target range lists.
 *
 * @param leftRanges The left-hand operand.
 * @param rightRanges The right-hand operand.
 * @returns The normalized intersection ranges.
 */
export function intersectTargetRanges(
  leftRanges: readonly TargetRange[],
  rightRanges: readonly TargetRange[],
): TargetRange[] {
  const left = normalizeRanges(leftRanges);
  const right = normalizeRanges(rightRanges);
  const intersections: TargetRange[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    const leftRange = left[leftIndex];
    const rightRange = right[rightIndex];
    const start = Math.max(leftRange.start, rightRange.start);
    const end = Math.min(leftRange.end, rightRange.end);

    if (start <= end) {
      intersections.push({ start, end });
    }

    if (leftRange.end < rightRange.end) {
      leftIndex += 1;
    } else {
      rightIndex += 1;
    }
  }

  return intersections;
}

/**
 * Removes excluded ranges from the source ranges and returns the normalized remainder.
 *
 * @param sourceRanges The source ranges.
 * @param excludedRanges The ranges to remove from the source.
 * @returns The normalized remainder.
 */
export function subtractTargetRanges(
  sourceRanges: readonly TargetRange[],
  excludedRanges: readonly TargetRange[],
): TargetRange[] {
  const source = normalizeRanges(sourceRanges);
  const excluded = normalizeRanges(excludedRanges);
  const result: TargetRange[] = [];
  let excludedIndex = 0;

  for (const sourceRange of source) {
    let cursor = sourceRange.start;

    while (excludedIndex < excluded.length && excluded[excludedIndex].end < cursor) {
      excludedIndex += 1;
    }

    let scanIndex = excludedIndex;
    while (scanIndex < excluded.length && excluded[scanIndex].start <= sourceRange.end) {
      const excludedRange = excluded[scanIndex];

      if (excludedRange.start > cursor) {
        result.push({ start: cursor, end: Math.min(excludedRange.start - 1, sourceRange.end) });
      }

      cursor = Math.max(cursor, excludedRange.end + 1);
      if (cursor > sourceRange.end) {
        break;
      }

      scanIndex += 1;
    }

    if (cursor <= sourceRange.end) {
      result.push({ start: cursor, end: sourceRange.end });
    }
  }

  return result;
}

export function getTargetSetKey(ranges: readonly TargetRange[]): string {
  return normalizeRanges(ranges)
    .map((range) => (range.start === range.end ? String(range.start) : `${range.start}-${range.end}`))
    .join(",");
}

/** Returns whether the given ranges cover the full target set. */
export function isFullTargetSet(state: CompatibilityTestStateBase, ranges: readonly TargetRange[]): boolean {
  const normalizedRanges = normalizeRanges(ranges);
  return (
    normalizedRanges.length === 1 && normalizedRanges[0].start === 1 && normalizedRanges[0].end === state.targetCount
  );
}

/** Marks the session as finished and stores the final result. */
export function stopCompatibilityTest(state: CompatibilityTestStateBase, resultTargets: readonly number[]): void {
  state.resultTargets = [...resultTargets];
  state.stopped = true;
}

export function getRangeLength(range: TargetRange): number {
  return Math.max(range.end - range.start + 1, 0);
}

export function normalizeRanges(ranges: readonly TargetRange[]): TargetRange[] {
  const sortedRanges = ranges
    .filter((range) => range.start <= range.end)
    .map((range) => ({ start: range.start, end: range.end }))
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const normalizedRanges: TargetRange[] = [];
  for (const range of sortedRanges) {
    const previousRange = normalizedRanges.at(-1);
    if (!previousRange || range.start > previousRange.end + 1) {
      normalizedRanges.push(range);
      continue;
    }

    previousRange.end = Math.max(previousRange.end, range.end);
  }

  return normalizedRanges;
}
