export type CliLocale = "en" | "zh-CN";

export interface CliHelpSectionMessages {
  lines: readonly string[];
  title: string;
}

export interface CliCommandMessages {
  answerHelpLines?: readonly string[];
  answerOptionDescription?: string;
  description: string;
  exampleLines: readonly string[];
  extraSections: readonly CliHelpSectionMessages[];
  namesOptionDescription: string;
  outputExampleTitle?: string;
  outputFieldLines?: readonly string[];
  outputFieldTitle?: string;
  usageSuffix: string;
}

export interface CliMessages {
  aliasesTitle: string;
  commandTitle: (command: string) => string;
  commands: {
    interactive: CliCommandMessages;
    next: CliCommandMessages;
  };
  commonOptionsTitle: string;
  countOptionDescription: string;
  defaultTargetLabel: (index: number) => string;
  errorHelpHint: string;
  errors: {
    invalidAnswers: string;
    invalidCount: string;
    missingAnswers: string;
    missingCount: string;
    missingCountValue: string;
    missingLocale: string;
    missingNames: string;
    unknownArgument: (argument: string) => string;
    unknownCommand: (command: string) => string;
    unsupportedLocale: (locale: string) => string;
  };
  examplesTitle: string;
  generalOptionsTitle: string;
  helpOptionDescription: string;
  interactive: {
    emptyUndoHistory: string;
    exited: string;
    invalidInput: string;
    promptTargetCount: (count: number) => string;
    restoredPreviousStep: string;
    start: (count: number) => string;
    usageHint: string;
  };
  localeOptionDescription: string;
  optionsTitle: string;
  result: {
    completeWithIssues: (count: number) => string;
    completeWithoutIssues: string;
  };
  rootTitle: string;
  rootUsage: string;
  subcommandsTitle: string;
  usageTitle: string;
}
