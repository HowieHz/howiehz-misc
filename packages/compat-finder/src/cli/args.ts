import { DEFAULT_COMPATIBILITY_TEST_ALGORITHM } from "../compatibility-test/index.ts";
import { getCliMessages, normalizeCliLocale, resolveCliLocale } from "../locales/index.ts";
import type { CliOptions, ParsedArgsResult } from "./types.ts";
import { getOptionValue, parseAlgorithm, parseAnswerList, resolveCommandAlias, splitNames } from "./utils.ts";

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

    if (current === "--algorithm" || current === "--algo") {
      const value = args[index + 1];
      if (value === undefined) {
        return {
          options,
          error: messages.errors.missingAlgorithm,
        };
      }

      const algorithm = parseAlgorithm(value);
      if (algorithm === undefined) {
        return {
          options,
          error: messages.errors.invalidAlgorithm,
        };
      }

      options.algorithm = algorithm;
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
