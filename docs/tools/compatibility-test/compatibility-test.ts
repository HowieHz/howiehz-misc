export interface TargetRange {
  start: number;
  end: number;
}

export interface CompatibilityTestStep {
  promptTargetRanges: readonly TargetRange[];
  promptTargetCount: number;
  debug: CompatibilityTestDebugStep;
  requiresAnswer: boolean;
}

export interface CompatibilityTestDebugStep {
  insideTargetRange: TargetRange;
  outsideTargetRanges: readonly TargetRange[];
  definedTargetRanges: readonly TargetRange[];
}

export interface CompatibilityTestState {
  targetCount: number;
  insideArrow: string;
  outsideArrows: string[];
  definedTargets: number[];
  cachedResults: Map<string, boolean>;
  stopped: boolean;
  resultTargets: number[];
}

/**
 * Creates the initial state for the compatibility test flow.
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
 * Builds the current step shown to the user from the internal arrow-based state.
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
 * Records the current answer and advances the state machine once.
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
 * Automatically skips repeated prompt sets that already have cached answers.
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

export function countTargetsInRanges(ranges: readonly TargetRange[]) {
  return ranges.reduce((total, range) => total + getRangeLength(range), 0);
}

export function takeTargetsFromRanges(ranges: readonly TargetRange[], limit: number) {
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

export function intersectTargetRanges(leftRanges: readonly TargetRange[], rightRanges: readonly TargetRange[]) {
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

export function subtractTargetRanges(sourceRanges: readonly TargetRange[], excludedRanges: readonly TargetRange[]) {
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
    insideTargetRange: resolveArrowRange(state, state.insideArrow),
    outsideTargetRanges: state.outsideArrows.map((arrow) => resolveArrowRange(state, arrow)),
    definedTargetRanges: state.definedTargets.map((target) => ({ start: target, end: target })),
  };
}

/**
 * Dispatches to the next transition branch based on the latest test result.
 */
function advanceCompatibilityTestState(state: CompatibilityTestState, hasIssue: boolean) {
  if (hasIssue) {
    advanceIssueState(state);
    return;
  }

  advancePassState(state);
}

/**
 * Narrows the currently suspected subset when the tested group still reproduces the issue.
 */
function advanceIssueState(state: CompatibilityTestState) {
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

/**
 * Moves to the sibling subset, or promotes the current subset into the outside stack when needed.
 */
function advancePassState(state: CompatibilityTestState) {
  if (state.insideArrow.endsWith("l")) {
    state.insideArrow = `${state.insideArrow.slice(0, -1)}r`;
    return;
  }

  state.outsideArrows.push(state.insideArrow);
  state.insideArrow = `${state.insideArrow.slice(0, -1)}ll`;
}

function getTargetSetKey(ranges: readonly TargetRange[]) {
  return normalizeRanges(ranges)
    .map((range) => (range.start === range.end ? String(range.start) : `${range.start}-${range.end}`))
    .join(",");
}

/**
 * Checks whether the current prompt already spans the full target set.
 */
function isFullTargetSet(state: CompatibilityTestState, ranges: readonly TargetRange[]) {
  const normalizedRanges = normalizeRanges(ranges);
  return (
    normalizedRanges.length === 1 && normalizedRanges[0].start === 1 && normalizedRanges[0].end === state.targetCount
  );
}

/**
 * Marks the state machine as finished and stores the final incompatible targets.
 */
function stopCompatibilityTest(state: CompatibilityTestState, resultTargets: readonly number[]) {
  state.resultTargets = [...resultTargets];
  state.stopped = true;
}

function getRangeLength(range: TargetRange) {
  return Math.max(range.end - range.start + 1, 0);
}

function normalizeRanges(ranges: readonly TargetRange[]) {
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
