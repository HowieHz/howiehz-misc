import { describe, expect, it } from "vitest";

import {
  applyCompatibilityTestAnswer,
  createCompatibilitySession,
  createCompatibilityTestState,
  getCurrentCompatibilityTestStep,
  getNextAnswerableCompatibilityTestStep,
  skipCachedCompatibilityTestSteps,
  type CompatibilityTestAlgorithm,
  type TargetRange,
} from "../src/compatibility-test/index.ts";

interface Scenario {
  algorithm?: CompatibilityTestAlgorithm;
  targetCount: number;
  answers: boolean[];
  expectedPromptRanges: TargetRange[][];
  expectedDebugSteps?: DebugStep[];
  expectedResult: number[];
}

interface DebugStep {
  activeTargetRange: TargetRange;
  pendingTargetRanges: readonly TargetRange[];
  confirmedTargetRanges: readonly TargetRange[];
  requiresAnswer: boolean;
}

interface StepTrace {
  promptRanges: readonly TargetRange[];
  requiresAnswer: boolean;
}

const scenarios: Record<string, Scenario> = {
  "4 pick 1": {
    targetCount: 4,
    answers: [true, false, true],
    expectedPromptRanges: [[range(1, 2)], [range(1, 1)], [range(2, 2)]],
    expectedDebugSteps: [
      {
        activeTargetRange: range(1, 2),
        pendingTargetRanges: [],
        confirmedTargetRanges: [],
        requiresAnswer: true,
      },
      {
        activeTargetRange: range(1, 1),
        pendingTargetRanges: [],
        confirmedTargetRanges: [],
        requiresAnswer: true,
      },
      {
        activeTargetRange: range(2, 2),
        pendingTargetRanges: [],
        confirmedTargetRanges: [],
        requiresAnswer: true,
      },
    ],
    expectedResult: [2],
  },
  "9 pick 2": {
    targetCount: 9,
    answers: [false, false, true, true, false, true, true, false, true],
    expectedPromptRanges: [
      [range(1, 5)],
      [range(6, 9)],
      [range(1, 3), range(6, 9)],
      [range(1, 2), range(6, 9)],
      [range(1, 1), range(6, 9)],
      [range(2, 2), range(6, 9)],
      [range(2, 2), range(6, 7)],
      [range(2, 2), range(6, 6)],
      [range(2, 2), range(7, 7)],
    ],
    expectedDebugSteps: [
      {
        activeTargetRange: range(1, 5),
        pendingTargetRanges: [],
        confirmedTargetRanges: [],
        requiresAnswer: true,
      },
      {
        activeTargetRange: range(6, 9),
        pendingTargetRanges: [],
        confirmedTargetRanges: [],
        requiresAnswer: true,
      },
      {
        activeTargetRange: range(1, 3),
        pendingTargetRanges: [range(6, 9)],
        confirmedTargetRanges: [],
        requiresAnswer: true,
      },
      {
        activeTargetRange: range(1, 2),
        pendingTargetRanges: [range(6, 9)],
        confirmedTargetRanges: [],
        requiresAnswer: true,
      },
      {
        activeTargetRange: range(1, 1),
        pendingTargetRanges: [range(6, 9)],
        confirmedTargetRanges: [],
        requiresAnswer: true,
      },
      {
        activeTargetRange: range(2, 2),
        pendingTargetRanges: [range(6, 9)],
        confirmedTargetRanges: [],
        requiresAnswer: true,
      },
      {
        activeTargetRange: range(6, 9),
        pendingTargetRanges: [],
        confirmedTargetRanges: [range(2, 2)],
        requiresAnswer: false,
      },
      {
        activeTargetRange: range(6, 7),
        pendingTargetRanges: [],
        confirmedTargetRanges: [range(2, 2)],
        requiresAnswer: true,
      },
      {
        activeTargetRange: range(6, 6),
        pendingTargetRanges: [],
        confirmedTargetRanges: [range(2, 2)],
        requiresAnswer: true,
      },
      {
        activeTargetRange: range(7, 7),
        pendingTargetRanges: [],
        confirmedTargetRanges: [range(2, 2)],
        requiresAnswer: true,
      },
    ],
    expectedResult: [2, 7],
  },
  "23 pick 2": {
    targetCount: 23,
    answers: [true, true, false, false, true, false, true, false, true],
    expectedPromptRanges: [
      [range(1, 12)],
      [range(1, 6)],
      [range(1, 3)],
      [range(4, 6)],
      [range(1, 2), range(4, 6)],
      [range(1, 1), range(4, 6)],
      [range(2, 2), range(4, 6)],
      [range(2, 2), range(4, 5)],
      [range(2, 2), range(6, 6)],
    ],
    expectedResult: [2, 6],
  },
  "128 pick 2": {
    targetCount: 128,
    answers: [false, false, true, true, true, true, true, false, true, true, true, true, true, false, true, true],
    expectedPromptRanges: [
      [range(1, 64)],
      [range(65, 128)],
      [range(1, 32), range(65, 128)],
      [range(1, 16), range(65, 128)],
      [range(1, 8), range(65, 128)],
      [range(1, 4), range(65, 128)],
      [range(1, 2), range(65, 128)],
      [range(1, 1), range(65, 128)],
      [range(2, 2), range(65, 128)],
      [range(2, 2), range(65, 96)],
      [range(2, 2), range(65, 80)],
      [range(2, 2), range(65, 72)],
      [range(2, 2), range(65, 68)],
      [range(2, 2), range(65, 66)],
      [range(2, 2), range(67, 68)],
      [range(2, 2), range(67, 67)],
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
    expectedPromptRanges: [
      [range(1, 14)],
      [range(15, 27)],
      [range(1, 7), range(15, 27)],
      [range(8, 27)],
      [range(1, 4), range(8, 27)],
      [range(1, 2), range(8, 27)],
      [range(1, 1), range(8, 27)],
      [range(1, 1), range(8, 11), range(15, 27)],
      [range(1, 1), range(8, 9), range(15, 27)],
      [range(1, 1), range(10, 11), range(15, 27)],
      [range(1, 1), range(10, 10), range(15, 27)],
      [range(1, 1), range(11, 11), range(15, 27)],
      [range(1, 1), range(11, 11), range(15, 21)],
      [range(1, 1), range(11, 11), range(22, 27)],
      [range(1, 1), range(11, 11), range(22, 24)],
      [range(1, 1), range(11, 11), range(22, 23)],
      [range(1, 1), range(11, 11), range(22, 22)],
    ],
    expectedResult: [1, 11, 22],
  },
};

describe("compatibility test engine", () => {
  it("provides a simple session API with concrete targets", () => {
    const session = createCompatibilitySession(["A", "B", "C", "D"]);

    expect(session.current()).toEqual({
      status: "testing",
      targetNumbers: [1, 2],
      targets: ["A", "B"],
    });

    expect(session.answer(true)).toEqual({
      status: "testing",
      targetNumbers: [1],
      targets: ["A"],
    });

    expect(session.answer(false)).toEqual({
      status: "testing",
      targetNumbers: [2],
      targets: ["B"],
    });

    expect(session.answer(true)).toEqual({
      status: "complete",
      targetNumbers: [2],
      targets: ["B"],
    });
  });

  it("completes the simple session API with no incompatible targets", () => {
    const session = createCompatibilitySession(["A"]);

    expect(session.answer(false)).toEqual({
      status: "complete",
      targetNumbers: [],
      targets: [],
    });
  });

  it("rejects answers after a simple session is complete", () => {
    const session = createCompatibilitySession(["A"]);

    session.answer(false);

    expect(() => session.answer(true)).toThrow("cannot answer after the compatibility session is complete");
  });

  it("undoes the latest simple session answer", () => {
    const session = createCompatibilitySession(["A", "B", "C", "D"]);

    session.answer(true);
    expect(session.answer(false)).toEqual({
      status: "testing",
      targetNumbers: [2],
      targets: ["B"],
    });

    expect(session.undo()).toEqual({
      status: "testing",
      targetNumbers: [1],
      targets: ["A"],
    });
  });

  it("undoes a completed simple session", () => {
    const session = createCompatibilitySession(["A"]);

    expect(session.answer(false)).toEqual({
      status: "complete",
      targetNumbers: [],
      targets: [],
    });

    expect(session.undo()).toEqual({
      status: "testing",
      targetNumbers: [1],
      targets: ["A"],
    });
  });

  it("keeps simple session undo idempotent without answer history", () => {
    const session = createCompatibilitySession(["A", "B"]);

    expect(session.undo()).toEqual({
      status: "testing",
      targetNumbers: [1],
      targets: ["A"],
    });
  });

  it("rejects empty simple sessions", () => {
    expect(() => createCompatibilitySession([])).toThrow("targets must contain at least one item");
  });

  it("supports switching the simple session API to leave-one-out", () => {
    const session = createCompatibilitySession(["A", "B", "C"], {
      algorithm: "leave-one-out",
    });

    expect(session.current()).toEqual({
      status: "testing",
      targetNumbers: [2, 3],
      targets: ["B", "C"],
    });

    expect(session.answer(true)).toEqual({
      status: "testing",
      targetNumbers: [1, 3],
      targets: ["A", "C"],
    });

    expect(session.answer(false)).toEqual({
      status: "testing",
      targetNumbers: [1, 2],
      targets: ["A", "B"],
    });

    expect(session.answer(true)).toEqual({
      status: "complete",
      targetNumbers: [2],
      targets: ["B"],
    });
  });

  it("keeps single-target leave-one-out sessions actionable", () => {
    const session = createCompatibilitySession(["A"], {
      algorithm: "leave-one-out",
    });

    expect(session.current()).toEqual({
      status: "testing",
      targetNumbers: [1],
      targets: ["A"],
    });

    expect(session.answer(true)).toEqual({
      status: "complete",
      targetNumbers: [1],
      targets: ["A"],
    });
  });

  it("completes single-target leave-one-out sessions without issues", () => {
    const session = createCompatibilitySession(["A"], {
      algorithm: "leave-one-out",
    });

    expect(session.answer(false)).toEqual({
      status: "complete",
      targetNumbers: [],
      targets: [],
    });
  });

  it("rebuilds leave-one-out sessions with undo", () => {
    const session = createCompatibilitySession(["A", "B", "C"], {
      algorithm: "leave-one-out",
    });

    session.answer(true);
    expect(session.answer(false)).toEqual({
      status: "testing",
      targetNumbers: [1, 2],
      targets: ["A", "B"],
    });

    expect(session.undo()).toEqual({
      status: "testing",
      targetNumbers: [1, 3],
      targets: ["A", "C"],
    });
  });

  for (const [name, scenario] of Object.entries(scenarios)) {
    it(`matches sample ${name}`, () => {
      const result = runScenario(scenario);

      expect(result.promptRanges).toEqual(scenario.expectedPromptRanges);
      expect(result.resultTargets).toEqual(scenario.expectedResult);
    });
  }

  it("keeps cached steps in the trace without materializing prompts", () => {
    const result = runScenario(scenarios["9 pick 2"]);

    expect(result.steps).toContainEqual({
      promptRanges: [range(2, 2), range(6, 9)],
      requiresAnswer: false,
    });
  });

  it("returns the next answerable step from the low-level state API", () => {
    const state = createCompatibilityTestState(9);

    expect(getNextAnswerableCompatibilityTestStep(state)?.promptTargetRanges).toEqual([range(1, 5)]);

    applyCompatibilityTestAnswer(state, false);

    expect(getCurrentCompatibilityTestStep(state)).toMatchObject({
      promptTargetRanges: [range(6, 9)],
      requiresAnswer: true,
    });

    applyCompatibilityTestAnswer(state, false);

    expect(getCurrentCompatibilityTestStep(state)).toMatchObject({
      promptTargetRanges: [range(1, 3), range(6, 9)],
      requiresAnswer: true,
    });

    applyCompatibilityTestAnswer(state, true);
    applyCompatibilityTestAnswer(state, true);
    applyCompatibilityTestAnswer(state, false);
    applyCompatibilityTestAnswer(state, true);

    expect(getCurrentCompatibilityTestStep(state)).toMatchObject({
      promptTargetRanges: [range(2, 2), range(6, 9)],
      requiresAnswer: false,
    });

    expect(getNextAnswerableCompatibilityTestStep(state)).toMatchObject({
      promptTargetRanges: [range(2, 2), range(6, 7)],
      requiresAnswer: true,
    });
  });

  it("supports leave-one-out in the low-level state API", () => {
    const state = createCompatibilityTestState(4, { algorithm: "leave-one-out" });

    expect(getCurrentCompatibilityTestStep(state)).toMatchObject({
      promptTargetRanges: [range(2, 4)],
      requiresAnswer: true,
    });

    applyCompatibilityTestAnswer(state, true);

    expect(getCurrentCompatibilityTestStep(state)).toMatchObject({
      promptTargetRanges: [range(1, 1), range(3, 4)],
      requiresAnswer: true,
    });

    applyCompatibilityTestAnswer(state, false);
    applyCompatibilityTestAnswer(state, true);

    expect(getCurrentCompatibilityTestStep(state)).toMatchObject({
      promptTargetRanges: [range(1, 3)],
      requiresAnswer: true,
    });

    applyCompatibilityTestAnswer(state, true);

    expect(state.resultTargets).toEqual([2]);
  });

  it("keeps single-target leave-one-out prompts non-empty in the low-level state API", () => {
    const state = createCompatibilityTestState(1, { algorithm: "leave-one-out" });

    expect(getCurrentCompatibilityTestStep(state)).toMatchObject({
      promptTargetRanges: [range(1, 1)],
      promptTargetCount: 1,
      requiresAnswer: true,
    });

    applyCompatibilityTestAnswer(state, true);

    expect(state.resultTargets).toEqual([1]);
    expect(state.stopped).toBe(true);
  });

  it("keeps range-based debug steps for internal tracing", () => {
    for (const scenario of Object.values(scenarios)) {
      if (!scenario.expectedDebugSteps) {
        continue;
      }

      const result = runScenario(scenario);

      expect(result.debugSteps).toEqual(scenario.expectedDebugSteps);
    }
  });

  it("stops safely when every test result is pass", () => {
    const state = createCompatibilityTestState(9);
    const promptRanges: (readonly TargetRange[])[] = [];
    let step = getCurrentCompatibilityTestStep(state);
    let guard = 0;

    while (step) {
      guard += 1;
      expect(guard).toBeLessThanOrEqual(32);

      if (!step.requiresAnswer) {
        step = skipCachedCompatibilityTestSteps(state);
        continue;
      }

      promptRanges.push(copyRanges(step.promptTargetRanges));
      applyCompatibilityTestAnswer(state, false);
      step = getCurrentCompatibilityTestStep(state);
    }

    expect(state.stopped).toBe(true);
    expect(state.resultTargets).toEqual([]);
    expect(promptRanges).toEqual([
      [range(1, 5)],
      [range(6, 9)],
      [range(1, 3), range(6, 9)],
      [range(4, 9)],
      [range(1, 2), range(4, 9)],
      [range(3, 9)],
      [range(1, 1), range(3, 9)],
      [range(2, 9)],
      [range(1, 9)],
    ]);
  });

  it("confirms the full target set before accepting an all-pass leave-one-out result", () => {
    const state = createCompatibilityTestState(3, { algorithm: "leave-one-out" });
    const promptRanges: (readonly TargetRange[])[] = [];
    let step = getCurrentCompatibilityTestStep(state);

    while (step) {
      if (!step.requiresAnswer) {
        step = skipCachedCompatibilityTestSteps(state);
        continue;
      }

      promptRanges.push(copyRanges(step.promptTargetRanges));
      applyCompatibilityTestAnswer(state, false);
      step = getCurrentCompatibilityTestStep(state);
    }

    expect(promptRanges).toEqual([[range(2, 3)], [range(1, 1), range(3, 3)], [range(1, 2)], [range(1, 3)]]);
    expect(state.resultTargets).toEqual([]);
  });

  it("represents very large tests as ranges", () => {
    const state = createCompatibilityTestState(9_999_999);
    const step = getCurrentCompatibilityTestStep(state);

    expect(step?.promptTargetRanges).toEqual([range(1, 5_000_000)]);
    expect(step?.promptTargetCount).toBe(5_000_000);
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
  const state = createCompatibilityTestState(scenario.targetCount, {
    algorithm: scenario.algorithm,
  });
  const promptRanges: (readonly TargetRange[])[] = [];
  const steps: StepTrace[] = [];
  const debugSteps: DebugStep[] = [];
  let answerIndex = 0;
  let step = getCurrentCompatibilityTestStep(state);

  while (step) {
    debugSteps.push({
      activeTargetRange: { ...step.debug.activeTargetRange },
      pendingTargetRanges: copyRanges(step.debug.pendingTargetRanges),
      confirmedTargetRanges: copyRanges(step.debug.confirmedTargetRanges),
      requiresAnswer: step.requiresAnswer,
    });
    steps.push({
      promptRanges: copyRanges(step.promptTargetRanges),
      requiresAnswer: step.requiresAnswer,
    });

    if (!step.requiresAnswer) {
      step = skipCachedCompatibilityTestSteps(state);
      continue;
    }

    promptRanges.push(copyRanges(step.promptTargetRanges));
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
    debugSteps,
    promptRanges,
    resultTargets: state.resultTargets,
    steps,
  };
}

function range(start: number, end: number): TargetRange {
  return { start, end };
}

function copyRanges(ranges: readonly TargetRange[]) {
  return ranges.map((range) => ({ ...range }));
}
