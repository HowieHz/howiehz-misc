import { describe, expect, it } from "vitest";

import {
  applyCompatibilityTestAnswer,
  createCompatibilityTestState,
  getCurrentCompatibilityTestStep,
  skipCachedCompatibilityTestSteps,
  type CompatibilityTestStep,
} from "../compatibility-test";

interface Scenario {
  targetCount: number;
  answers: boolean[];
  expectedPrompts: number[][];
  expectedDebugSteps?: DebugStep[];
  expectedResult: number[];
}

interface DebugStep {
  inside: readonly number[];
  outside: readonly (readonly number[])[];
  defined: readonly number[];
  requiresAnswer: boolean;
}

const scenarios: Record<string, Scenario> = {
  "4 pick 1": {
    targetCount: 4,
    answers: [true, false, true],
    expectedPrompts: [[1, 2], [1], [2]],
    expectedDebugSteps: [
      { inside: [1, 2], outside: [], defined: [], requiresAnswer: true },
      { inside: [1], outside: [], defined: [], requiresAnswer: true },
      { inside: [2], outside: [], defined: [], requiresAnswer: true },
    ],
    expectedResult: [2],
  },
  "9 pick 2": {
    targetCount: 9,
    answers: [false, false, true, true, false, true, true, false, true],
    expectedPrompts: [
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9],
      [1, 2, 3, 6, 7, 8, 9],
      [1, 2, 6, 7, 8, 9],
      [1, 6, 7, 8, 9],
      [2, 6, 7, 8, 9],
      [2, 6, 7],
      [2, 6],
      [2, 7],
    ],
    expectedDebugSteps: [
      { inside: [1, 2, 3, 4, 5], outside: [], defined: [], requiresAnswer: true },
      { inside: [6, 7, 8, 9], outside: [], defined: [], requiresAnswer: true },
      { inside: [1, 2, 3], outside: [[6, 7, 8, 9]], defined: [], requiresAnswer: true },
      { inside: [1, 2], outside: [[6, 7, 8, 9]], defined: [], requiresAnswer: true },
      { inside: [1], outside: [[6, 7, 8, 9]], defined: [], requiresAnswer: true },
      { inside: [2], outside: [[6, 7, 8, 9]], defined: [], requiresAnswer: true },
      { inside: [6, 7, 8, 9], outside: [], defined: [2], requiresAnswer: false },
      { inside: [6, 7], outside: [], defined: [2], requiresAnswer: true },
      { inside: [6], outside: [], defined: [2], requiresAnswer: true },
      { inside: [7], outside: [], defined: [2], requiresAnswer: true },
    ],
    expectedResult: [2, 7],
  },
  "23 pick 2": {
    targetCount: 23,
    answers: [true, true, false, false, true, false, true, false, true],
    expectedPrompts: [
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      [1, 2, 3, 4, 5, 6],
      [1, 2, 3],
      [4, 5, 6],
      [1, 2, 4, 5, 6],
      [1, 4, 5, 6],
      [2, 4, 5, 6],
      [2, 4, 5],
      [2, 6],
    ],
    expectedResult: [2, 6],
  },
  "128 pick 2": {
    targetCount: 128,
    answers: [false, false, true, true, true, true, true, false, true, true, true, true, true, false, true, true],
    expectedPrompts: [
      range(1, 64),
      range(65, 128),
      [...range(1, 32), ...range(65, 128)],
      [...range(1, 16), ...range(65, 128)],
      [...range(1, 8), ...range(65, 128)],
      [...range(1, 4), ...range(65, 128)],
      [...range(1, 2), ...range(65, 128)],
      [1, ...range(65, 128)],
      [2, ...range(65, 128)],
      [2, ...range(65, 96)],
      [2, ...range(65, 80)],
      [2, ...range(65, 72)],
      [2, ...range(65, 68)],
      [2, 65, 66],
      [2, 67, 68],
      [2, 67],
    ],
    expectedResult: [2, 67],
  },
  "27 pick 3": {
    targetCount: 27,
    answers: [
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      true,
      true,
      true,
    ],
    expectedPrompts: [
      range(1, 14),
      range(15, 27),
      [...range(1, 7), ...range(15, 27)],
      [...range(8, 14), ...range(15, 27)],
      [...range(1, 4), ...range(8, 27)],
      [1, 2, ...range(8, 27)],
      [1, ...range(8, 27)],
      [1, ...range(8, 11), ...range(15, 27)],
      [1, 8, 9, ...range(15, 27)],
      [1, 10, 11, ...range(15, 27)],
      [1, 10, ...range(15, 27)],
      [1, 11, ...range(15, 27)],
      [1, 11, ...range(15, 21)],
      [1, 11, ...range(22, 27)],
      [1, 11, 22, 23, 24],
      [1, 11, 22, 23],
      [1, 11, 22],
    ],
    expectedResult: [1, 11, 22],
  },
};

describe("compatibility test engine", () => {
  for (const [name, scenario] of Object.entries(scenarios)) {
    it(`matches sample ${name}`, () => {
      const result = runScenario(scenario);

      expect(result.prompts).toEqual(scenario.expectedPrompts);
      expect(result.resultTargets).toEqual(scenario.expectedResult);
    });
  }

  it("includes cached debug steps for 9 pick 2", () => {
    const result = runScenario(scenarios["9 pick 2"]);

    expect(result.debugSteps).toEqual(scenarios["9 pick 2"].expectedDebugSteps);
  });

  it("stops safely when every test result is pass", () => {
    const state = createCompatibilityTestState(9);
    const prompts: (readonly number[])[] = [];
    let step = getCurrentCompatibilityTestStep(state);
    let guard = 0;

    while (step) {
      guard += 1;
      expect(guard).toBeLessThanOrEqual(32);

      if (!step.requiresAnswer) {
        step = skipCachedCompatibilityTestSteps(state);
        continue;
      }

      prompts.push(step.promptTargets);
      applyCompatibilityTestAnswer(state, false);
      step = getCurrentCompatibilityTestStep(state);
    }

    expect(state.stopped).toBe(true);
    expect(state.resultTargets).toEqual([]);
    expect(prompts).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9],
      [1, 2, 3, 6, 7, 8, 9],
      [4, 5, 6, 7, 8, 9],
      [1, 2, 4, 5, 6, 7, 8, 9],
      [3, 4, 5, 6, 7, 8, 9],
      [1, 3, 4, 5, 6, 7, 8, 9],
      [2, 3, 4, 5, 6, 7, 8, 9],
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
    ]);
  });

  it("rejects invalid target counts", () => {
    expect(() => createCompatibilityTestState(0)).toThrow("targetCount must be an integer greater than or equal to 1");
    expect(() => createCompatibilityTestState(-1)).toThrow("targetCount must be an integer greater than or equal to 1");
    expect(() => createCompatibilityTestState(1.5)).toThrow(
      "targetCount must be an integer greater than or equal to 1",
    );
  });
});

function runScenario(scenario: Scenario) {
  const state = createCompatibilityTestState(scenario.targetCount);
  const prompts: (readonly number[])[] = [];
  const debugSteps: DebugStep[] = [];
  let answerIndex = 0;
  let step = getCurrentCompatibilityTestStep(state);

  while (step) {
    debugSteps.push(toDebugStep(step));

    if (!step.requiresAnswer) {
      step = skipCachedCompatibilityTestSteps(state);
      continue;
    }

    prompts.push(step.promptTargets);
    const answer = scenario.answers[answerIndex];
    if (answer === undefined) {
      throw new Error(`Missing answer for prompt ${answerIndex}`);
    }

    answerIndex += 1;
    applyCompatibilityTestAnswer(state, answer);
    step = getCurrentCompatibilityTestStep(state);
  }

  expect(answerIndex).toBe(scenario.answers.length);
  return {
    prompts,
    debugSteps,
    resultTargets: state.resultTargets,
  };
}

function toDebugStep(step: CompatibilityTestStep): DebugStep {
  return {
    inside: step.insideTargets,
    outside: step.outsideTargetGroups,
    defined: step.definedTargets,
    requiresAnswer: step.requiresAnswer,
  };
}

function range(start: number, end: number) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}
