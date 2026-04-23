import type { CliLocale, CliMessages } from "../locales/index.ts";
import { getCliMessages } from "../locales/index.ts";
import { CLI_COMMANDS, type CliCommand, type CommandDefinition } from "./types.ts";
import { CLI_COMMAND_NAME } from "./utils.ts";

const buildCommandDefinitions = (messages: CliMessages) =>
  ({
    interactive: {
      alias: "i",
      description: messages.commands.interactive.description,
      options: [
        `--count, -c <number>   ${messages.countOptionDescription}`,
        `--names, -n <items>    ${messages.commands.interactive.namesOptionDescription}`,
        `--algorithm, --algo <name> ${messages.algorithmOptionDescription}`,
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
        `--algorithm, --algo <name> ${messages.algorithmOptionDescription}`,
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
          lines: getNextOutputExampleLines(messages),
          title: messages.commands.next.outputExampleTitle ?? "",
        },
      ],
      usageLines: [formatCommandUsage("next", messages.commands.next.usageSuffix)],
    },
  }) satisfies Record<CliCommand, CommandDefinition>;

export function getCommandHelpText(command: CliCommand, locale: CliLocale): string {
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
    `  --algorithm, --algo <name> ${messages.algorithmOptionDescription}`,
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
  return CLI_COMMANDS.map((command) => {
    const definition = commandDefinitions[command];
    return `  ${command} (${definition.alias})`.padEnd(25) + definition.description;
  });
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

function getNextOutputExampleLines(messages: CliMessages): string[] {
  const firstTarget = messages.defaultTargetLabel(1);
  const secondTarget = messages.defaultTargetLabel(2);

  return [
    formatCommandUsage("next", '-c 3 -a "y"'),
    "{",
    '  "status": "testing",',
    '  "targetCount": 3,',
    `  "targets": ["${firstTarget}"]`,
    "}",
    "",
    formatCommandUsage("next", '-c 3 -a "y,n"'),
    "{",
    '  "status": "testing",',
    '  "targetCount": 3,',
    `  "targets": ["${secondTarget}"]`,
    "}",
    "",
    formatCommandUsage("next", '-c 3 -a "y,n,n"'),
    "{",
    '  "status": "complete",',
    '  "targetCount": 3,',
    `  "targets": ["${firstTarget}", "${secondTarget}"]`,
    "}",
  ];
}
