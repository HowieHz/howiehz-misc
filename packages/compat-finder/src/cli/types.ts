import type {
  CompatibilityTestAlgorithm,
  CompatibilityTestState,
  CompatibilityTestStep,
} from "../compatibility-test/index.ts";
import type { CliLocale, CliMessages } from "../locales/index.ts";

export const CLI_COMMANDS = ["interactive", "next"] as const;

export type CliCommand = (typeof CLI_COMMANDS)[number];
export type HelpScope = "command" | "root";

export type NextCommandResult =
  | {
      status: "testing";
      targetCount: number;
      targets: string[];
    }
  | {
      extraAnswerCount?: number;
      status: "complete";
      targetCount: number;
      targets: string[];
    };

export interface RebuiltCliState {
  extraAnswerCount: number;
  state: CompatibilityTestState;
  step: CompatibilityTestStep | undefined;
}

export interface CliOptions {
  algorithm: CompatibilityTestAlgorithm;
  answers: boolean[];
  command: CliCommand;
  count?: number;
  names: string[];
  help: boolean;
  helpScope: HelpScope;
  locale: CliLocale;
}

export interface ParsedArgsResult {
  options: CliOptions;
  error?: string;
}

export interface HelpSection {
  lines: readonly string[];
  title: string;
}

export interface CommandDefinition {
  alias: string;
  description: string;
  options: readonly string[];
  sections: readonly HelpSection[];
  usageLines: readonly string[];
}

export interface PromptRenderContext {
  messages: CliMessages;
  targetNames: readonly string[];
}
