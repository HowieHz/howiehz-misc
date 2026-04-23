import process from "node:process";

import { getCliMessages } from "../locales/index.ts";
import { parseCliArgs } from "./args.ts";
import { getNextCommandResult, normalizeCliTargetNames, runInteractiveCli } from "./execution.ts";
import { getCommandHelpText, getRootHelpText } from "./help.ts";
import type { ParsedArgsResult } from "./types.ts";

export { getCommandHelpText, getNextCommandResult, getRootHelpText, parseCliArgs };
export type { ParsedArgsResult };

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

  const targetNames = normalizeCliTargetNames(targetCount, options.names);
  switch (options.command) {
    case "interactive":
      await runInteractiveCli(targetCount, targetNames, options.locale, options.algorithm);
      return;
    case "next": {
      const result = getNextCommandResult(targetCount, targetNames, options.answers, options.locale, options.algorithm);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    default:
      return assertNever(options.command);
  }
}

function printCliError(message: string, messages: ReturnType<typeof getCliMessages>): void {
  console.error(message);
  console.error("");
  console.error(messages.errorHelpHint);
  process.exitCode = 1;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported CLI command: ${String(value)}`);
}
