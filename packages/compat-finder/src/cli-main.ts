import process from "node:process";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";

import {
  applyCompatibilityTestAnswer,
  createCompatibilityTestState,
  getCurrentCompatibilityTestStep,
  skipCachedCompatibilityTestSteps,
  takeTargetsFromRanges,
  type CompatibilityTestState,
  type CompatibilityTestStep,
  type TargetRange,
} from "./compatibility-test.ts";
import {
  getCliMessages,
  normalizeCliLocale,
  resolveCliLocale,
  type CliLocale,
  type CliMessages,
} from "./locales/index.ts";

type CliCommand = "interactive" | "next";
type HelpScope = "command" | "root";

interface NextCommandResult {
  status: "complete" | "testing";
  targetCount: number;
  targets: string[];
}

interface CliOptions {
  answers: boolean[];
  command: CliCommand;
  count?: number;
  names: string[];
  help: boolean;
  helpScope: HelpScope;
  locale: CliLocale;
}

interface ParsedArgsResult {
  options: CliOptions;
  error?: string;
}

interface HelpSection {
  lines: readonly string[];
  title: string;
}

interface CommandDefinition {
  alias: string;
  description: string;
  options: readonly string[];
  sections: readonly HelpSection[];
  usageLines: readonly string[];
}

const CLI_COMMAND_NAME = "compat-finder";
const COMMAND_ALIASES: Record<CliCommand, string> = {
  interactive: "i",
  next: "n",
};

const buildCommandDefinitions = (messages: CliMessages): Record<CliCommand, CommandDefinition> => ({
  interactive: {
    alias: "i",
    description: messages.commands.interactive.description,
    options: [
      `--count, -c <number>   ${messages.countOptionDescription}`,
      `--names, -n <items>    ${messages.commands.interactive.namesOptionDescription}`,
      `--locale, -l <locale>  ${messages.localeOptionDescription}`,
      `--help, -h             ${messages.helpOptionDescription}`,
    ],
    sections: [
      {
        lines: ["i"],
        title: messages.aliasesTitle,
      },
      {
        lines: messages.commands.interactive.exampleLines,
        title: messages.examplesTitle,
      },
      ...messages.commands.interactive.extraSections,
    ],
    usageLines: [
      formatCommandUsage("interactive", messages.commands.interactive.usageSuffix),
      formatDefaultInteractiveUsage(messages.commands.interactive.usageSuffix),
    ],
  },
  next: {
    alias: "n",
    description: messages.commands.next.description,
    options: [
      `--count, -c <number>   ${messages.countOptionDescription}`,
      `--answers, -a <items>  ${messages.commands.next.answerOptionDescription ?? ""}`,
      `--names, -n <items>    ${messages.commands.next.namesOptionDescription}`,
      `--locale, -l <locale>  ${messages.localeOptionDescription}`,
      `--help, -h             ${messages.helpOptionDescription}`,
    ],
    sections: [
      {
        lines: ["n"],
        title: messages.aliasesTitle,
      },
      {
        lines: messages.commands.next.outputFieldLines ?? [],
        title: messages.commands.next.outputFieldTitle ?? "",
      },
      {
        lines: messages.commands.next.answerHelpLines ?? [],
        title: "answers",
      },
      {
        lines: messages.commands.next.exampleLines,
        title: messages.examplesTitle,
      },
      {
        lines: [
          formatCommandUsage("next", '-c 3 -a "y"'),
          "{",
          '  "status": "testing",',
          '  "targetCount": 3,',
          '  "targets": ["目标 1"]',
          "}",
          "",
          formatCommandUsage("next", '-c 3 -a "y,n"'),
          "{",
          '  "status": "testing",',
          '  "targetCount": 3,',
          '  "targets": ["目标 2"]',
          "}",
          "",
          formatCommandUsage("next", '-c 3 -a "y,n,n"'),
          "{",
          '  "status": "complete",',
          '  "targetCount": 3,',
          '  "targets": ["目标 1", "目标 2"]',
          "}",
        ],
        title: messages.commands.next.outputExampleTitle ?? "",
      },
    ],
    usageLines: [formatCommandUsage("next", messages.commands.next.usageSuffix)],
  },
});

/**
 * Runs the command-line entrypoint.
 *
 * @returns A promise that resolves when command execution completes.
 */
export async function main(): Promise<void> {
  const { options, error } = parseCliArgs(process.argv.slice(2));
  const messages = getCliMessages(options.locale);

  if (error) {
    printCliError(error, messages);
    return;
  }

  if (options.help) {
    console.log(
      options.helpScope === "root"
        ? getRootHelpText(options.locale)
        : getCommandHelpText(options.command, options.locale),
    );
    return;
  }

  const targetCount = options.count;
  if (targetCount === undefined) {
    printCliError(messages.errors.missingCount, messages);
    return;
  }

  const targetNames = normalizeTargetNames(targetCount, options.names);
  if (options.command === "interactive") {
    await runInteractiveCli(targetCount, targetNames, options.locale);
    return;
  }

  const result = getNextCommandResult(targetCount, targetNames, options.answers, options.locale);
  console.log(JSON.stringify(result, null, 2));
}

function getCommandHelpText(command: CliCommand, locale: CliLocale): string {
  const messages = getCliMessages(locale);
  const definition = buildCommandDefinitions(messages)[command];
  return [
    messages.commandTitle(command),
    "",
    `${messages.usageTitle}:`,
    ...definition.usageLines.map((line) => `  ${line}`),
    "",
    `${messages.optionsTitle}:`,
    ...definition.options.map((line) => `  ${line}`),
    ...definition.sections.flatMap((section) => ["", `${section.title}:`, ...section.lines.map((line) => `  ${line}`)]),
  ].join("\n");
}

/**
 * Parses CLI arguments into normalized options.
 *
 * @param args The raw argument list without the executable and script paths.
 * @returns The parsed options and an optional validation error.
 */
export function parseCliArgs(args: readonly string[], env: NodeJS.ProcessEnv = process.env): ParsedArgsResult {
  const options: CliOptions = {
    answers: [],
    command: "interactive",
    names: [],
    help: false,
    helpScope: "command",
    locale: resolveCliLocale(getOptionValue(args, "--locale", "-l"), env),
  };
  const messages = getCliMessages(options.locale);

  let index = 0;
  const firstArg = args[0];

  if (firstArg === "--help" || firstArg === "-h") {
    options.help = true;
    const helpTarget = resolveCommandAlias(args[1]);
    if (helpTarget) {
      options.command = helpTarget;
      options.helpScope = "command";
    } else {
      options.helpScope = "root";
    }
    return { options };
  }

  if (firstArg && !firstArg.startsWith("-")) {
    const resolvedCommand = resolveCommandAlias(firstArg);
    if (!resolvedCommand) {
      return {
        options,
        error: messages.errors.unknownCommand(firstArg),
      };
    }

    options.command = resolvedCommand;
    index = 1;
  }

  for (; index < args.length; index += 1) {
    const current = args[index];

    if (current === "--help" || current === "-h") {
      options.help = true;
      options.helpScope = "command";
      continue;
    }

    if (current === "--count" || current === "-c") {
      const value = args[index + 1];
      if (value === undefined) {
        return {
          options,
          error: messages.errors.missingCountValue,
        };
      }

      const count = Number.parseInt(value, 10);
      if (!/^\d+$/.test(value) || count < 1) {
        return {
          options,
          error: messages.errors.invalidCount,
        };
      }

      options.count = count;
      index += 1;
      continue;
    }

    if (current === "--answers" || current === "-a") {
      const value = args[index + 1];
      if (value === undefined) {
        return {
          options,
          error: messages.errors.missingAnswers,
        };
      }

      const parsedAnswers = parseAnswerList(value);
      if (parsedAnswers === undefined) {
        return {
          options,
          error: messages.errors.invalidAnswers,
        };
      }

      options.answers = parsedAnswers;
      index += 1;
      continue;
    }

    if (current === "--names" || current === "-n") {
      const value = args[index + 1];
      if (value === undefined) {
        return {
          options,
          error: messages.errors.missingNames,
        };
      }

      options.names = splitNames(value);
      index += 1;
      continue;
    }

    if (current === "--locale" || current === "-l") {
      const value = args[index + 1];
      if (value === undefined) {
        return {
          options,
          error: messages.errors.missingLocale,
        };
      }

      const requestedLocale = normalizeCliLocale(value);
      if (requestedLocale === undefined) {
        return {
          options,
          error: messages.errors.unsupportedLocale(value),
        };
      }

      options.locale = requestedLocale;
      index += 1;
      continue;
    }

    return {
      options,
      error: messages.errors.unknownArgument(current),
    };
  }

  return { options };
}

/**
 * Returns the root help text shown by the CLI.
 *
 * @returns The root help text.
 */
export function getRootHelpText(locale: CliLocale = "zh-Hans"): string {
  const messages = getCliMessages(locale);
  return [
    messages.rootTitle,
    "",
    `${messages.usageTitle}:`,
    `  ${messages.rootUsage}`,
    "",
    `${messages.subcommandsTitle}:`,
    ...getCommandListLines(messages),
    "",
    `${messages.commonOptionsTitle}:`,
    `  --locale, -l <locale>  ${messages.localeOptionDescription}`,
    `  --help, -h             ${messages.helpOptionDescription}`,
    "",
    `${messages.examplesTitle}:`,
    `  ${formatHelpCommand("interactive")}`,
    `  ${formatHelpCommand("next")}`,
  ].join("\n");
}

function getCommandListLines(messages: CliMessages): string[] {
  const commandDefinitions = buildCommandDefinitions(messages);
  return (Object.entries(commandDefinitions) as [CliCommand, (typeof commandDefinitions)[CliCommand]][]).map(
    ([command, definition]) => `  ${command} (${definition.alias})`.padEnd(25) + definition.description,
  );
}

function formatCommandUsage(command: CliCommand, suffix = ""): string {
  return `${CLI_COMMAND_NAME} ${command}${suffix ? ` ${suffix}` : ""}`;
}

function formatHelpCommand(command: CliCommand): string {
  return `${CLI_COMMAND_NAME} --help ${command}`;
}

function formatDefaultInteractiveUsage(suffix: string): string {
  return `${CLI_COMMAND_NAME} ${suffix}`;
}

function printCliError(message: string, messages: CliMessages): void {
  console.error(message);
  console.error("");
  console.error(messages.errorHelpHint);
  process.exitCode = 1;
}

function resolveCommandAlias(token: string | undefined): CliCommand | undefined {
  for (const [command, alias] of Object.entries(COMMAND_ALIASES) as [CliCommand, string][]) {
    if (token === command || token === alias) {
      return command;
    }
  }

  return undefined;
}

function getOptionValue(args: readonly string[], ...optionNames: readonly string[]): string | undefined {
  const index = args.findIndex((arg) => optionNames.includes(arg));
  return index === -1 ? undefined : args[index + 1];
}

function splitNames(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseAnswerList(value: string): boolean[] | undefined {
  const normalizedValue = value.trim();
  if (normalizedValue === "") {
    return [];
  }

  const answers: boolean[] = [];
  for (const token of normalizedValue.split(",")) {
    const parsedAnswer = parseAnswer(token.trim().toLowerCase());
    if (parsedAnswer === undefined) {
      return undefined;
    }

    answers.push(parsedAnswer);
  }

  return answers;
}

function normalizeTargetNames(targetCount: number, names: readonly string[]): string[] {
  return Array.from({ length: targetCount }, (_, index) => names[index] ?? "");
}

function getTargetLabel(targetNames: readonly string[], index: number, messages: CliMessages): string {
  const customName = targetNames[index - 1]?.trim();
  return customName && customName.length > 0 ? customName : messages.defaultTargetLabel(index);
}

function formatTargetNames(targetNames: readonly string[], targets: readonly number[], messages: CliMessages): string {
  return targets.map((target) => getTargetLabel(targetNames, target, messages)).join(",");
}

function getAllTargetsFromRanges(ranges: readonly TargetRange[]): number[] {
  return takeTargetsFromRanges(ranges, getTargetRangeCount(ranges));
}

function getTargetRangeCount(ranges: readonly TargetRange[]): number {
  return ranges.reduce((total, range) => total + Math.max(range.end - range.start + 1, 0), 0);
}

/**
 * Returns the next CLI result for single-step execution.
 *
 * @param targetCount The total number of targets in the session.
 * @param targetNames The target labels to use in the output.
 * @param answers The answers that have already been applied.
 * @returns A JSON-ready result for the next step or the final outcome.
 */
export function getNextCommandResult(
  targetCount: number,
  targetNames: readonly string[],
  answers: readonly boolean[],
  locale: CliLocale = "zh-Hans",
): NextCommandResult {
  const messages = getCliMessages(locale);
  const state = rebuildStateFromAnswers(targetCount, answers);
  let step = getCurrentCompatibilityTestStep(state);

  while (step && !step.requiresAnswer) {
    skipCachedCompatibilityTestSteps(state);
    step = getCurrentCompatibilityTestStep(state);
  }

  if (!step) {
    return {
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

/**
 * Runs the interactive CLI workflow.
 *
 * @param targetCount The total number of targets in the session.
 * @param targetNames The target labels to use in prompts and results.
 * @returns A promise that resolves when the interactive session ends.
 */
async function runInteractiveCli(
  targetCount: number,
  targetNames: readonly string[],
  locale: CliLocale,
): Promise<void> {
  const messages = getCliMessages(locale);
  const rl = readline.createInterface({ input, output });
  const history: boolean[] = [];
  let state = createCompatibilityTestState(targetCount);

  console.log(messages.interactive.start(targetCount));
  console.log(messages.interactive.usageHint);

  try {
    while (true) {
      let step = getCurrentCompatibilityTestStep(state);
      while (step && !step.requiresAnswer) {
        skipCachedCompatibilityTestSteps(state);
        step = getCurrentCompatibilityTestStep(state);
      }

      if (!step) {
        printResult(targetNames, state, messages);
        return;
      }

      printPrompt(step, targetNames, messages);
      const answer = await rl.question("> ");
      const normalizedAnswer = answer.trim().toLowerCase();

      if (normalizedAnswer === "q" || normalizedAnswer === "quit") {
        console.log(messages.interactive.exited);
        return;
      }

      if (normalizedAnswer === "u" || normalizedAnswer === "undo") {
        if (history.length === 0) {
          console.log(messages.interactive.emptyUndoHistory);
          continue;
        }

        history.pop();
        state = rebuildStateFromAnswers(targetCount, history);
        console.log(messages.interactive.restoredPreviousStep);
        continue;
      }

      const parsedAnswer = parseAnswer(normalizedAnswer);
      if (parsedAnswer === undefined) {
        console.log(messages.interactive.invalidInput);
        continue;
      }

      history.push(parsedAnswer);
      applyCompatibilityTestAnswer(state, parsedAnswer);
    }
  } finally {
    rl.close();
  }
}

function printPrompt(step: CompatibilityTestStep, targetNames: readonly string[], messages: CliMessages): void {
  const targets = getAllTargetsFromRanges(step.promptTargetRanges);
  console.log("");
  console.log(messages.interactive.promptTargetCount(step.promptTargetCount));
  console.log(formatTargetNames(targetNames, targets, messages));
}

function parseAnswer(value: string): boolean | undefined {
  if (value === "y" || value === "yes" || value === "issue" || value === "1" || value === "true") {
    return true;
  }

  if (value === "n" || value === "no" || value === "pass" || value === "0" || value === "false") {
    return false;
  }

  return undefined;
}

function rebuildStateFromAnswers(targetCount: number, answers: readonly boolean[]): CompatibilityTestState {
  const nextState = createCompatibilityTestState(targetCount);

  for (const answer of answers) {
    applyCompatibilityTestAnswer(nextState, answer);
    if (nextState.stopped) {
      break;
    }

    skipCachedCompatibilityTestSteps(nextState);
  }

  return nextState;
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
