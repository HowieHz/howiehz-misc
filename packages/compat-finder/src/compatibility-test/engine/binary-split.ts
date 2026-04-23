import {
  normalizeRanges,
  getRangeLength,
  type CompatibilityTestDebugStep,
  type CompatibilityTestStateBase,
  type TargetRange,
} from "../core.ts";

export interface BinarySplitCompatibilityTestState extends CompatibilityTestStateBase {
  algorithm: "binary-split";
  /** Encoded path of the active search branch. */
  insideArrow: string;
  /** Encoded paths of deferred search branches. */
  outsideArrows: string[];
}

export function createBinarySplitCompatibilityTestState(targetCount: number): BinarySplitCompatibilityTestState {
  return {
    targetCount,
    algorithm: "binary-split",
    insideArrow: "l",
    outsideArrows: [],
    definedTargets: [],
    cachedResults: new Map<string, boolean>(),
    stopped: false,
    resultTargets: [],
  };
}

export function getBinarySplitPromptTargetRanges(state: BinarySplitCompatibilityTestState): TargetRange[] {
  return normalizeRanges([
    resolveArrowRange(state, state.insideArrow),
    ...state.outsideArrows.map((arrow) => resolveArrowRange(state, arrow)),
    ...state.definedTargets.map((target) => ({ start: target, end: target })),
  ]);
}

export function getBinarySplitCompatibilityTestDebugStep(
  state: BinarySplitCompatibilityTestState,
): CompatibilityTestDebugStep {
  return {
    activeTargetRange: resolveArrowRange(state, state.insideArrow),
    pendingTargetRanges: state.outsideArrows.map((arrow) => resolveArrowRange(state, arrow)),
    confirmedTargetRanges: state.definedTargets.map((target) => ({ start: target, end: target })),
  };
}

/** Advances the session using the latest test result. */
export function advanceBinarySplitState(state: BinarySplitCompatibilityTestState, hasIssue: boolean): void {
  if (hasIssue) {
    advanceBinarySplitIssueState(state);
    return;
  }

  advanceBinarySplitPassState(state);
}

function resolveArrowRange(state: BinarySplitCompatibilityTestState, arrow: string): TargetRange {
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

/** Narrows the active branch after a failing result. */
function advanceBinarySplitIssueState(state: BinarySplitCompatibilityTestState): void {
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
function advanceBinarySplitPassState(state: BinarySplitCompatibilityTestState): void {
  if (state.insideArrow.endsWith("l")) {
    state.insideArrow = `${state.insideArrow.slice(0, -1)}r`;
    return;
  }

  state.outsideArrows.push(state.insideArrow);
  state.insideArrow = `${state.insideArrow.slice(0, -1)}ll`;
}
