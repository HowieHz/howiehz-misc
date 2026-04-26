import {
  takeTargetsFromRanges,
  type CompatibilitySession,
  type CompatibilitySessionStep,
  type CompatibilityTestOptions,
  type CompatibilityTestStep,
} from "./core.ts";
import {
  applyCompatibilityTestAnswer,
  createCompatibilityTestState,
  getNextAnswerableCompatibilityTestStep,
} from "./state.ts";

/**
 * Creates a high-level compatibility test session.
 *
 * Use this API for most integrations. It hides the range-based state machine and returns the concrete target values to
 * test at each step.
 *
 * @param targets The targets to evaluate. Must contain at least one item.
 * @param options Optional engine configuration. Defaults to the existing `binary-split` algorithm.
 * @returns A session with `current()`, `answer(hasIssue)`, and `undo()` methods.
 */
export function createCompatibilitySession<Target>(
  targets: readonly Target[],
  options: CompatibilityTestOptions = {},
): CompatibilitySession<Target> {
  if (targets.length < 1) {
    throw new Error("targets must contain at least one item");
  }

  const algorithm = options.algorithm;
  let state = createCompatibilityTestState(targets.length, { algorithm });
  const answers: boolean[] = [];

  const toSessionStep = (): CompatibilitySessionStep<Target> => {
    const step = getNextAnswerableCompatibilityTestStep(state);
    if (!step) {
      return createCompleteSessionStep(targets, state.resultTargets);
    }

    return createTestingSessionStep(targets, step);
  };

  return {
    answer(hasIssue) {
      if (state.stopped) {
        throw new Error("cannot answer after the compatibility session is complete");
      }

      answers.push(hasIssue);
      applyCompatibilityTestAnswer(state, hasIssue);
      return toSessionStep();
    },
    current: toSessionStep,
    undo() {
      answers.pop();
      state = rebuildSessionState(targets.length, algorithm, answers);
      return toSessionStep();
    },
  };
}

function createCompleteSessionStep<Target>(
  targets: readonly Target[],
  resultTargets: readonly number[],
): CompatibilitySessionStep<Target> {
  const targetNumbers = [...resultTargets];
  return {
    status: "complete",
    targetNumbers,
    targets: getTargetsByNumber(targets, targetNumbers),
  };
}

function createTestingSessionStep<Target>(
  targets: readonly Target[],
  step: CompatibilityTestStep,
): CompatibilitySessionStep<Target> {
  const targetNumbers = takeTargetsFromRanges(step.promptTargetRanges, step.promptTargetCount);
  return {
    status: "testing",
    targetNumbers,
    targets: getTargetsByNumber(targets, targetNumbers),
  };
}

function rebuildSessionState(
  targetCount: number,
  algorithm: CompatibilityTestOptions["algorithm"],
  answers: readonly boolean[],
) {
  const state = createCompatibilityTestState(targetCount, { algorithm });

  for (const answer of answers) {
    applyCompatibilityTestAnswer(state, answer);
    getNextAnswerableCompatibilityTestStep(state);
  }

  return state;
}

function getTargetsByNumber<Target>(targets: readonly Target[], targetNumbers: readonly number[]): Target[] {
  return targetNumbers.map((targetNumber) => getTargetByNumber(targets, targetNumber));
}

function getTargetByNumber<Target>(targets: readonly Target[], targetNumber: number): Target {
  const target = targets[targetNumber - 1];
  if (target === undefined) {
    throw new Error(`target ${targetNumber} is out of bounds for a target list of length ${targets.length}`);
  }

  return target;
}
