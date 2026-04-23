import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";

import {
  DEFAULT_COMPATIBILITY_TEST_ALGORITHM,
  applyCompatibilityTestAnswer,
  createCompatibilityTestState,
  getNextAnswerableCompatibilityTestStep,
  takeTargetsFromRanges,
  type CompatibilityTestAlgorithm,
  type CompatibilityTestState,
  type CompatibilityTestStep,
  type TargetRange,
} from "../compatibility-test/index.ts";
import { getCliMessages, type CliLocale, type CliMessages } from "../locales/index.ts";
import type { NextCommandResult, RebuiltCliState } from "./types.ts";
import { formatTargetNames, getTargetLabel, getTargetRangeCount, normalizeTargetNames, parseAnswer } from "./utils.ts";

export function getNextCommandResult(
  targetCount: number,
  targetNames: readonly string[],
  answers: readonly boolean[],
  locale: CliLocale = "zh-Hans",
  algorithm: CompatibilityTestAlgorithm = DEFAULT_COMPATIBILITY_TEST_ALGORITHM,
): NextCommandResult {
  const { extraAnswerCount, state, step } = rebuildStateFromAnswers(targetCount, answers, algorithm);
  return buildNextCommandResult(targetCount, targetNames, state, step, extraAnswerCount, locale);
}

export async function runInteractiveCli(
  targetCount: number,
  targetNames: readonly string[],
  locale: CliLocale,
  algorithm: CompatibilityTestAlgorithm,
): Promise<void> {
  const messages = getCliMessages(locale);
  const rl = readline.createInterface({ input, output });
  const history: boolean[] = [];
  let state = createCompatibilityTestState(targetCount, { algorithm });

  console.log(messages.interactive.start(targetCount));
  console.log(messages.interactive.usageHint);

  try {
    while (true) {
      const nextState = await runInteractiveCliStep(targetCount, targetNames, history, state, algorithm, messages, rl);
      if (!nextState) {
        return;
      }

      state = nextState;
    }
  } finally {
    rl.close();
  }
}

export function normalizeCliTargetNames(targetCount: number, names: readonly string[]): string[] {
  return normalizeTargetNames(targetCount, names);
}

function buildNextCommandResult(
  targetCount: number,
  targetNames: readonly string[],
  state: CompatibilityTestState,
  step: CompatibilityTestStep | undefined,
  extraAnswerCount: number,
  locale: CliLocale,
): NextCommandResult {
  const messages = getCliMessages(locale);
  if (!step) {
    return {
      ...(extraAnswerCount > 0 ? { extraAnswerCount } : {}),
      status: "complete",
      targetCount,
      targets: state.resultTargets.map((target) => getTargetLabel(targetNames, target, messages)),
    };
  }

  const promptTargets = getAllTargetsFromRanges(step.promptTargetRanges);
  return {
    status: "testing",
    targetCount,
    targets: promptTargets.map((target) => getTargetLabel(targetNames, target, messages)),
  };
}

function getAllTargetsFromRanges(ranges: readonly TargetRange[]): number[] {
  return takeTargetsFromRanges(ranges, getTargetRangeCount(ranges));
}

function printPrompt(step: CompatibilityTestStep, targetNames: readonly string[], messages: CliMessages): void {
  const targets = getAllTargetsFromRanges(step.promptTargetRanges);
  console.log("");
  console.log(messages.interactive.promptTargetCount(step.promptTargetCount));
  console.log(formatTargetNames(targetNames, targets, messages));
}

async function runInteractiveCliStep(
  targetCount: number,
  targetNames: readonly string[],
  history: boolean[],
  state: CompatibilityTestState,
  algorithm: CompatibilityTestAlgorithm,
  messages: CliMessages,
  rl: readline.Interface,
): Promise<CompatibilityTestState | undefined> {
  const step = getNextAnswerableCompatibilityTestStep(state);
  if (!step) {
    printResult(targetNames, state, messages);
    return undefined;
  }

  printPrompt(step, targetNames, messages);
  const action = getInteractiveAction(await rl.question("> "));
  return resolveInteractiveCliAction(action, targetCount, history, state, algorithm, messages);
}

function getInteractiveAction(answer: string): boolean | "quit" | "undo" | undefined {
  const normalizedAnswer = answer.trim().toLowerCase();
  if (normalizedAnswer === "q" || normalizedAnswer === "quit") {
    return "quit";
  }

  if (normalizedAnswer === "u" || normalizedAnswer === "undo") {
    return "undo";
  }

  return parseAnswer(normalizedAnswer);
}

function printInteractiveExit(messages: CliMessages): void {
  console.log(messages.interactive.exited);
}

function printInteractiveInvalidInput(messages: CliMessages): void {
  console.log(messages.interactive.invalidInput);
}

function resolveInteractiveCliAction(
  action: boolean | "quit" | "undo" | undefined,
  targetCount: number,
  history: boolean[],
  state: CompatibilityTestState,
  algorithm: CompatibilityTestAlgorithm,
  messages: CliMessages,
): CompatibilityTestState | undefined {
  if (action === "quit") {
    printInteractiveExit(messages);
    return undefined;
  }

  if (action === "undo") {
    return tryRestorePreviousInteractiveStep(targetCount, history, state, algorithm, messages);
  }

  if (action === undefined) {
    printInteractiveInvalidInput(messages);
    return state;
  }

  applyInteractiveAnswer(state, history, action);
  return state;
}

function tryRestorePreviousInteractiveStep(
  targetCount: number,
  history: boolean[],
  state: CompatibilityTestState,
  algorithm: CompatibilityTestAlgorithm,
  messages: CliMessages,
): CompatibilityTestState {
  if (history.length === 0) {
    console.log(messages.interactive.emptyUndoHistory);
    return state;
  }

  history.pop();
  console.log(messages.interactive.restoredPreviousStep);
  return rebuildStateFromAnswers(targetCount, history, algorithm).state;
}

function applyInteractiveAnswer(state: CompatibilityTestState, history: boolean[], answer: boolean): void {
  history.push(answer);
  applyCompatibilityTestAnswer(state, answer);
}

function rebuildStateFromAnswers(
  targetCount: number,
  answers: readonly boolean[],
  algorithm: CompatibilityTestAlgorithm,
): RebuiltCliState {
  const nextState = createCompatibilityTestState(targetCount, { algorithm });
  let extraAnswerCount = 0;
  let step = getNextAnswerableCompatibilityTestStep(nextState);

  for (const answer of answers) {
    if (!step) {
      extraAnswerCount += 1;
      continue;
    }

    applyCompatibilityTestAnswer(nextState, answer);
    step = getNextAnswerableCompatibilityTestStep(nextState);
  }

  return {
    extraAnswerCount,
    state: nextState,
    step,
  };
}

function printResult(targetNames: readonly string[], state: CompatibilityTestState, messages: CliMessages): void {
  console.log("");
  if (state.resultTargets.length === 0) {
    console.log(messages.result.completeWithoutIssues);
    return;
  }

  console.log(messages.result.completeWithIssues(state.resultTargets.length));
  console.log(formatTargetNames(targetNames, state.resultTargets, messages));
}
