/**
 * Represents an inclusive range of 1-based target indexes.
 */
export interface TargetRange {
  start: number;
  end: number;
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
  /** Whether the caller needs to provide a new answer for this step. If false, call `skipCachedCompatibilityTestSteps`. */
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

/**
 * Represents the mutable state of a compatibility test session.
 *
 * Keep this object and pass the same instance back to the API functions for the
 * lifetime of the session.
 */
export interface CompatibilityTestState {
  targetCount: number;
  /** Encoded path of the active search branch. */
  insideArrow: string;
  /** Encoded paths of deferred search branches. */
  outsideArrows: string[];
  /** Targets already confirmed by previous narrowing steps. */
  definedTargets: number[];
  cachedResults: Map<string, boolean>;
  stopped: boolean;
  /** Final 1-based target indexes. Meaningful only after the session is complete. */
  resultTargets: number[];
}

/**
 * Creates a new compatibility test session.
 *
 * @param targetCount The total number of targets to evaluate. Must be an integer greater than or equal to 1.
 * @returns A new mutable session state.
 * @throws {Error} Thrown when `targetCount` is not an integer greater than or equal to 1.
 */
export function createCompatibilityTestState(targetCount: number): CompatibilityTestState {
  if (!Number.isInteger(targetCount) || targetCount < 1) {
    throw new Error("targetCount must be an integer greater than or equal to 1");
  }

  return {
    targetCount,
    insideArrow: "l",
    outsideArrows: [],
    definedTargets: [],
    cachedResults: new Map<string, boolean>(),
    stopped: false,
    resultTargets: [],
  };
}

/**
 * Returns the current step for the provided session state.
 *
 * @param state The session state to inspect.
 * @returns The current step, or `undefined` when the session is already complete.
 */
export function getCurrentCompatibilityTestStep(state: CompatibilityTestState): CompatibilityTestStep | undefined {
  if (state.stopped) {
    return undefined;
  }

  const promptTargetRanges = getPromptTargetRanges(state);
  const cacheKey = getTargetSetKey(promptTargetRanges);

  return {
    promptTargetRanges,
    promptTargetCount: countTargetsInRanges(promptTargetRanges),
    debug: getCompatibilityTestDebugStep(state),
    requiresAnswer: !state.cachedResults.has(cacheKey),
  };
}

/**
 * Applies one answer and advances the session state.
 *
 * @param state The session state to update.
 * @param hasIssue Whether the current prompt reproduces the compatibility issue.
 * @returns The next step, or `undefined` when the session is already complete or becomes complete after this answer.
 */
export function applyCompatibilityTestAnswer(
  state: CompatibilityTestState,
  hasIssue: boolean,
): CompatibilityTestStep | undefined {
  const currentStep = getCurrentCompatibilityTestStep(state);
  if (!currentStep) {
    return undefined;
  }

  const cacheKey = getTargetSetKey(currentStep.promptTargetRanges);
  state.cachedResults.set(cacheKey, hasIssue);
  if (!hasIssue && isFullTargetSet(state, currentStep.promptTargetRanges)) {
    stopCompatibilityTest(state, []);
    return undefined;
  }

  advanceCompatibilityTestState(state, hasIssue);
  return getCurrentCompatibilityTestStep(state);
}

/**
 * Advances through cached steps until a new answer is required or the session completes.
 *
 * @param state The session state to advance.
 * @returns The next uncached step, or `undefined` when the session is already complete or becomes complete while skipping cached steps.
 */
export function skipCachedCompatibilityTestSteps(state: CompatibilityTestState): CompatibilityTestStep | undefined {
  let step = getCurrentCompatibilityTestStep(state);
  while (step && !step.requiresAnswer) {
    const cacheKey = getTargetSetKey(step.promptTargetRanges);
    if (!state.cachedResults.get(cacheKey) && isFullTargetSet(state, step.promptTargetRanges)) {
      stopCompatibilityTest(state, []);
      return undefined;
    }

    advanceCompatibilityTestState(state, state.cachedResults.get(cacheKey) ?? false);
    step = getCurrentCompatibilityTestStep(state);
  }

  return step;
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

function resolveArrowRange(state: CompatibilityTestState, arrow: string): TargetRange {
  let range = { start: 1, end: state.targetCount };
  for (const sign of arrow) {
    const pivot = Math.floor((getRangeLength(range) + 1) / 2);
    if (sign === "l") {
      range = {
        start: range.start,
        end: range.start + pivot - 1,
      };
    } else if (sign === "r") {
      range = {
        start: range.start + pivot,
        end: range.end,
      };
    }
  }

  return range;
}

function getPromptTargetRanges(state: CompatibilityTestState): TargetRange[] {
  return normalizeRanges([
    resolveArrowRange(state, state.insideArrow),
    ...state.outsideArrows.map((arrow) => resolveArrowRange(state, arrow)),
    ...state.definedTargets.map((target) => ({ start: target, end: target })),
  ]);
}

function getCompatibilityTestDebugStep(state: CompatibilityTestState): CompatibilityTestDebugStep {
  return {
    activeTargetRange: resolveArrowRange(state, state.insideArrow),
    pendingTargetRanges: state.outsideArrows.map((arrow) => resolveArrowRange(state, arrow)),
    confirmedTargetRanges: state.definedTargets.map((target) => ({ start: target, end: target })),
  };
}

/** Advances the session using the latest test result. */
function advanceCompatibilityTestState(state: CompatibilityTestState, hasIssue: boolean): void {
  if (hasIssue) {
    advanceIssueState(state);
    return;
  }

  advancePassState(state);
}

/** Narrows the active branch after a failing result. */
function advanceIssueState(state: CompatibilityTestState): void {
  const insideRange = resolveArrowRange(state, state.insideArrow);
  if (getRangeLength(insideRange) === 1) {
    if (state.outsideArrows.length === 0) {
      state.resultTargets = [insideRange.start, ...state.definedTargets].sort((left, right) => left - right);
      state.stopped = true;
      return;
    }

    state.definedTargets.push(insideRange.start);
    const nextInsideArrow = state.outsideArrows.at(-1);
    if (nextInsideArrow === undefined) {
      state.stopped = true;
      return;
    }

    state.insideArrow = nextInsideArrow;
    state.outsideArrows.pop();
    return;
  }

  state.insideArrow += "l";
}

/** Moves to the next branch after a passing result. */
function advancePassState(state: CompatibilityTestState): void {
  if (state.insideArrow.endsWith("l")) {
    state.insideArrow = `${state.insideArrow.slice(0, -1)}r`;
    return;
  }

  state.outsideArrows.push(state.insideArrow);
  state.insideArrow = `${state.insideArrow.slice(0, -1)}ll`;
}

function getTargetSetKey(ranges: readonly TargetRange[]): string {
  return normalizeRanges(ranges)
    .map((range) => (range.start === range.end ? String(range.start) : `${range.start}-${range.end}`))
    .join(",");
}

/** Returns whether the given ranges cover the full target set. */
function isFullTargetSet(state: CompatibilityTestState, ranges: readonly TargetRange[]): boolean {
  const normalizedRanges = normalizeRanges(ranges);
  return (
    normalizedRanges.length === 1 && normalizedRanges[0].start === 1 && normalizedRanges[0].end === state.targetCount
  );
}

/** Marks the session as finished and stores the final result. */
function stopCompatibilityTest(state: CompatibilityTestState, resultTargets: readonly number[]): void {
  state.resultTargets = [...resultTargets];
  state.stopped = true;
}

function getRangeLength(range: TargetRange): number {
  return Math.max(range.end - range.start + 1, 0);
}

function normalizeRanges(ranges: readonly TargetRange[]): TargetRange[] {
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
