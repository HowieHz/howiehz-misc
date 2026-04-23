import {
  COMPATIBILITY_TEST_ALGORITHMS,
  type CompatibilityTestAlgorithm,
  type TargetRange,
} from "../compatibility-test/index.ts";
import type { CliMessages } from "../locales/index.ts";
import { CLI_COMMANDS, type CliCommand } from "./types.ts";

export const CLI_COMMAND_NAME = "compat-finder";

export const COMMAND_ALIASES: Record<CliCommand, string> = {
  interactive: "i",
  next: "n",
};

export function resolveCommandAlias(token: string | undefined): CliCommand | undefined {
  for (const command of CLI_COMMANDS) {
    const alias = COMMAND_ALIASES[command];
    if (token === command || token === alias) {
      return command;
    }
  }

  return undefined;
}

export function getOptionValue(args: readonly string[], ...optionNames: readonly string[]): string | undefined {
  const index = args.findIndex((arg) => optionNames.includes(arg));
  return index === -1 ? undefined : args[index + 1];
}

export function splitNames(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function parseAnswer(value: string): boolean | undefined {
  if (value === "y" || value === "yes" || value === "issue" || value === "1" || value === "true") {
    return true;
  }

  if (value === "n" || value === "no" || value === "pass" || value === "0" || value === "false") {
    return false;
  }

  return undefined;
}

export function parseAnswerList(value: string): boolean[] | undefined {
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

export function parseAlgorithm(value: string): CompatibilityTestAlgorithm | undefined {
  for (const algorithm of COMPATIBILITY_TEST_ALGORITHMS) {
    if (algorithm === value) {
      return algorithm;
    }
  }

  return undefined;
}

export function normalizeTargetNames(targetCount: number, names: readonly string[]): string[] {
  return Array.from({ length: targetCount }, (_, index) => names[index] ?? "");
}

export function getTargetLabel(targetNames: readonly string[], index: number, messages: CliMessages): string {
  const customName = targetNames[index - 1]?.trim();
  return customName && customName.length > 0 ? customName : messages.defaultTargetLabel(index);
}

export function formatTargetNames(
  targetNames: readonly string[],
  targets: readonly number[],
  messages: CliMessages,
): string {
  return targets.map((target) => getTargetLabel(targetNames, target, messages)).join(",");
}

export function getTargetRangeCount(ranges: readonly TargetRange[]): number {
  return ranges.reduce((total, range) => total + Math.max(range.end - range.start + 1, 0), 0);
}
