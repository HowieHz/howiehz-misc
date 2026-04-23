import { DEFAULT_COMPATIBILITY_TEST_ALGORITHM } from "../compatibility-test/index.ts";
import { getCliMessages, normalizeCliLocale, resolveCliLocale, type CliMessages } from "../locales/index.ts";
import type { CliOptions, ParsedArgsResult } from "./types.ts";
import { getOptionValue, parseAlgorithm, parseAnswerList, resolveCommandAlias, splitNames } from "./utils.ts";

interface CliOptionParseResult {
  consumedArgs?: number;
  error?: string;
}

export function parseCliArgs(args: readonly string[], env: NodeJS.ProcessEnv = process.env): ParsedArgsResult {
  const options: CliOptions = {
    algorithm: DEFAULT_COMPATIBILITY_TEST_ALGORITHM,
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
    const result = parseCliOption(args, index, options, messages);
    if (result.error) {
      return {
        options,
        error: result.error,
      };
    }

    if (result.consumedArgs === undefined) {
      return {
        options,
        error: messages.errors.unknownArgument(args[index] ?? ""),
      };
    }

    index += result.consumedArgs;
  }

  return { options };
}

function parseCliOption(
  args: readonly string[],
  index: number,
  options: CliOptions,
  messages: CliMessages,
): CliOptionParseResult {
  const current = args[index];

  if (current === "--help" || current === "-h") {
    options.help = true;
    options.helpScope = "command";
    return { consumedArgs: 0 };
  }

  if (current === "--count" || current === "-c") {
    return parseCountOption(args[index + 1], options, messages);
  }

  if (current === "--answers" || current === "-a") {
    return parseAnswersOption(args[index + 1], options, messages);
  }

  if (current === "--algorithm" || current === "--algo") {
    return parseAlgorithmOption(args[index + 1], options, messages);
  }

  if (current === "--names" || current === "-n") {
    return parseNamesOption(args[index + 1], options, messages);
  }

  if (current === "--locale" || current === "-l") {
    return parseLocaleOption(args[index + 1], options, messages);
  }

  return {};
}

function parseCountOption(value: string | undefined, options: CliOptions, messages: CliMessages): CliOptionParseResult {
  if (value === undefined) {
    return { error: messages.errors.missingCountValue };
  }

  const count = Number.parseInt(value, 10);
  if (!/^\d+$/.test(value) || count < 1) {
    return { error: messages.errors.invalidCount };
  }

  options.count = count;
  return { consumedArgs: 1 };
}

function parseAnswersOption(
  value: string | undefined,
  options: CliOptions,
  messages: CliMessages,
): CliOptionParseResult {
  if (value === undefined) {
    return { error: messages.errors.missingAnswers };
  }

  const parsedAnswers = parseAnswerList(value);
  if (parsedAnswers === undefined) {
    return { error: messages.errors.invalidAnswers };
  }

  options.answers = parsedAnswers;
  return { consumedArgs: 1 };
}

function parseAlgorithmOption(
  value: string | undefined,
  options: CliOptions,
  messages: CliMessages,
): CliOptionParseResult {
  if (value === undefined) {
    return { error: messages.errors.missingAlgorithm };
  }

  const algorithm = parseAlgorithm(value);
  if (algorithm === undefined) {
    return { error: messages.errors.invalidAlgorithm };
  }

  options.algorithm = algorithm;
  return { consumedArgs: 1 };
}

function parseNamesOption(value: string | undefined, options: CliOptions, messages: CliMessages): CliOptionParseResult {
  if (value === undefined) {
    return { error: messages.errors.missingNames };
  }

  options.names = splitNames(value);
  return { consumedArgs: 1 };
}

function parseLocaleOption(
  value: string | undefined,
  options: CliOptions,
  messages: CliMessages,
): CliOptionParseResult {
  if (value === undefined) {
    return { error: messages.errors.missingLocale };
  }

  const requestedLocale = normalizeCliLocale(value);
  if (requestedLocale === undefined) {
    return { error: messages.errors.unsupportedLocale(value) };
  }

  options.locale = requestedLocale;
  return { consumedArgs: 1 };
}
