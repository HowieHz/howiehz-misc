import {
  DEFAULT_COMPATIBILITY_TEST_ALGORITHM,
  countTargetsInRanges,
  getTargetSetKey,
  isFullTargetSet,
  stopCompatibilityTest,
  type CompatibilityTestAlgorithm,
  type CompatibilityTestOptions,
  type CompatibilityTestState,
  type CompatibilityTestStep,
  type TargetRange,
} from "./core.ts";
import {
  advanceBinarySplitState,
  createBinarySplitCompatibilityTestState,
  getBinarySplitCompatibilityTestDebugStep,
  getBinarySplitPromptTargetRanges,
} from "./engine/binary-split.ts";
import {
  advanceLeaveOneOutState,
  createLeaveOneOutCompatibilityTestState,
  getLeaveOneOutCompatibilityTestDebugStep,
  getLeaveOneOutPromptTargetRanges,
} from "./engine/leave-one-out.ts";

type CompatibilityTestStateForAlgorithm<Algorithm extends CompatibilityTestAlgorithm> = Extract<
  CompatibilityTestState,
  { algorithm: Algorithm }
>;

interface CompatibilityTestAlgorithmDefinition<Algorithm extends CompatibilityTestAlgorithm> {
  advanceState: (state: CompatibilityTestStateForAlgorithm<Algorithm>, hasIssue: boolean) => void;
  createState: (targetCount: number) => CompatibilityTestStateForAlgorithm<Algorithm>;
  getDebugStep: (state: CompatibilityTestStateForAlgorithm<Algorithm>) => CompatibilityTestStep["debug"];
  getPromptTargetRanges: (state: CompatibilityTestStateForAlgorithm<Algorithm>) => TargetRange[];
}

const COMPATIBILITY_TEST_ALGORITHM_DEFINITIONS = {
  "binary-split": {
    advanceState: advanceBinarySplitState,
    createState: createBinarySplitCompatibilityTestState,
    getDebugStep: getBinarySplitCompatibilityTestDebugStep,
    getPromptTargetRanges: getBinarySplitPromptTargetRanges,
  },
  "leave-one-out": {
    advanceState: advanceLeaveOneOutState,
    createState: createLeaveOneOutCompatibilityTestState,
    getDebugStep: getLeaveOneOutCompatibilityTestDebugStep,
    getPromptTargetRanges: getLeaveOneOutPromptTargetRanges,
  },
} satisfies {
  [Algorithm in CompatibilityTestAlgorithm]: CompatibilityTestAlgorithmDefinition<Algorithm>;
};

/**
 * Creates a new compatibility test session.
 *
 * @param targetCount The total number of targets to evaluate. Must be an integer greater than or equal to 1.
 * @param options Optional engine configuration. Defaults to the existing `binary-split` algorithm.
 * @returns A new mutable session state.
 * @throws {Error} Thrown when `targetCount` is not an integer greater than or equal to 1.
 */
export function createCompatibilityTestState(
  targetCount: number,
  options: CompatibilityTestOptions = {},
): CompatibilityTestState {
  if (!Number.isInteger(targetCount) || targetCount < 1) {
    throw new Error("targetCount must be an integer greater than or equal to 1");
  }

  const algorithm = options.algorithm ?? DEFAULT_COMPATIBILITY_TEST_ALGORITHM;
  return createStateForAlgorithm(targetCount, algorithm);
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
 * Returns the current answerable step, automatically skipping cached steps.
 *
 * This helper is the preferred low-level entrypoint for callers that want the
 * next actionable prompt without manually coordinating
 * `getCurrentCompatibilityTestStep` and `skipCachedCompatibilityTestSteps`.
 *
 * @param state The session state to inspect and advance through cached steps.
 * @returns The next step that requires a new answer, or `undefined` when the
 * session is already complete or becomes complete while skipping cached steps.
 */
export function getNextAnswerableCompatibilityTestStep(
  state: CompatibilityTestState,
): CompatibilityTestStep | undefined {
  const step = getCurrentCompatibilityTestStep(state);
  return step && !step.requiresAnswer ? skipCachedCompatibilityTestSteps(state) : step;
}

function getPromptTargetRanges(state: CompatibilityTestState): TargetRange[] {
  switch (state.algorithm) {
    case "binary-split":
      return getAlgorithmDefinition(state.algorithm).getPromptTargetRanges(state);
    case "leave-one-out":
      return getAlgorithmDefinition(state.algorithm).getPromptTargetRanges(state);
  }
}

function getCompatibilityTestDebugStep(state: CompatibilityTestState): CompatibilityTestStep["debug"] {
  switch (state.algorithm) {
    case "binary-split":
      return getAlgorithmDefinition(state.algorithm).getDebugStep(state);
    case "leave-one-out":
      return getAlgorithmDefinition(state.algorithm).getDebugStep(state);
  }
}

function advanceCompatibilityTestState(state: CompatibilityTestState, hasIssue: boolean): void {
  switch (state.algorithm) {
    case "binary-split":
      getAlgorithmDefinition(state.algorithm).advanceState(state, hasIssue);
      return;
    case "leave-one-out":
      getAlgorithmDefinition(state.algorithm).advanceState(state, hasIssue);
      return;
  }
}

function createStateForAlgorithm(targetCount: number, algorithm: CompatibilityTestAlgorithm): CompatibilityTestState {
  switch (algorithm) {
    case "binary-split":
      return getAlgorithmDefinition(algorithm).createState(targetCount);
    case "leave-one-out":
      return getAlgorithmDefinition(algorithm).createState(targetCount);
  }
}

function getAlgorithmDefinition(algorithm: "binary-split"): CompatibilityTestAlgorithmDefinition<"binary-split">;
function getAlgorithmDefinition(algorithm: "leave-one-out"): CompatibilityTestAlgorithmDefinition<"leave-one-out">;
function getAlgorithmDefinition(algorithm: CompatibilityTestAlgorithm) {
  return COMPATIBILITY_TEST_ALGORITHM_DEFINITIONS[algorithm];
}
