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
const CLI_HELP_HINT = "使用 --help 查看帮助。";
const COMMAND_DEFINITIONS: Record<CliCommand, CommandDefinition> = {
  interactive: {
    alias: "i",
    description: "启动交互式排查流程",
    options: [
      "--count, -c <number>   测试目标总数，必须是大于 0 的整数",
      "--names, -n <items>    目标名称列表，使用英文逗号分隔；可选",
      "--help, -h             显示帮助",
    ],
    sections: [
      {
        lines: ["i"],
        title: "别名",
      },
      {
        lines: [formatCommandUsage("interactive", "-c 4"), formatCommandUsage("interactive", '-c 4 -n "A,B,C,D"')],
        title: "示例",
      },
      {
        lines: [
          "CLI 会逐轮给出需要测试的目标。",
          "你只需要根据实际结果输入：",
          "  y / yes / issue / 1    表示“有兼容性问题”",
          "  n / no / pass / 0      表示“没有兼容性问题”",
          "  u / undo               撤回上一步",
          "  q / quit               退出",
        ],
        title: "交互说明",
      },
    ],
    usageLines: [
      formatCommandUsage("interactive", "--count <数量> [--names <名称列表>]"),
      formatDefaultInteractiveUsage("--count <数量> [--names <名称列表>]"),
    ],
  },
  next: {
    alias: "n",
    description: "执行单步排查计算并输出结果",
    options: [
      "--count, -c <number>   测试目标总数，必须是大于 0 的整数",
      "--answers, -a <items>  已有回答列表，使用英文逗号分隔；可选",
      "--names, -n <items>    目标名称列表，使用英文逗号分隔；可选",
      "--help, -h             显示帮助",
    ],
    sections: [
      {
        lines: ["n"],
        title: "别名",
      },
      {
        lines: [
          "status                 testing 表示当前需要按 targets 列表进行测试；complete 表示已经得到最终结果",
          "targetCount            本轮排查的测试目标总数",
          "targets                testing 时表示当前需要测试的目标列表；complete 时表示最终结果列表",
        ],
        title: "返回字段说明",
      },
      {
        lines: [
          "y / yes / issue / 1 / true      表示“有兼容性问题”",
          "n / no / pass / 0 / false       表示“没有兼容性问题”",
        ],
        title: "answers 取值说明",
      },
      {
        lines: ['--answers "issue,pass,1,0"'],
        title: "单步模式 answers 示例",
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
        title: "单步模式输出示例（3 个目标）",
      },
    ],
    usageLines: [formatCommandUsage("next", "--count <数量> [--answers <回答列表>] [--names <名称列表>]")],
  },
};

export async function main() {
  const { options, error } = parseCliArgs(process.argv.slice(2));

  if (error) {
    printCliError(error);
    return;
  }

  if (options.help) {
    console.log(options.helpScope === "root" ? getRootHelpText() : getCommandHelpText(options.command));
    return;
  }

  const targetCount = options.count;
  if (targetCount === undefined) {
    printCliError("缺少必填参数 --count。");
    return;
  }

  const targetNames = normalizeTargetNames(targetCount, options.names);
  if (options.command === "interactive") {
    await runInteractiveCli(targetCount, targetNames);
    return;
  }

  const result = getNextCommandResult(targetCount, targetNames, options.answers);
  console.log(JSON.stringify(result, null, 2));
}

function getCommandHelpText(command: CliCommand) {
  const definition = COMMAND_DEFINITIONS[command];
  return [
    `兼容性问题排查命令行工具：${command}`,
    "",
    "用法：",
    ...definition.usageLines.map((line) => `  ${line}`),
    "",
    "参数：",
    ...definition.options.map((line) => `  ${line}`),
    ...definition.sections.flatMap((section) => [
      "",
      `${section.title}：`,
      ...section.lines.map((line) => `  ${line}`),
    ]),
  ].join("\n");
}

export function parseCliArgs(args: readonly string[]): ParsedArgsResult {
  const options: CliOptions = {
    answers: [],
    command: "interactive",
    names: [],
    help: false,
    helpScope: "command",
  };

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
        error: `未知子命令：${firstArg}`,
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
          error: "参数 --count 缺少值。",
        };
      }

      const count = Number.parseInt(value, 10);
      if (!/^\d+$/.test(value) || count < 1) {
        return {
          options,
          error: "参数 --count 必须是大于 0 的整数。",
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
          error: "参数 --answers 缺少值。",
        };
      }

      const parsedAnswers = parseAnswerList(value);
      if (parsedAnswers === undefined) {
        return {
          options,
          error: "参数 --answers 仅支持 y/n、yes/no、issue/pass、1/0、true/false。",
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
          error: "参数 --names 缺少值。",
        };
      }

      options.names = splitNames(value);
      index += 1;
      continue;
    }

    return {
      options,
      error: `未知参数：${current}`,
    };
  }

  return { options };
}

export function getRootHelpText() {
  return [
    "兼容性问题排查命令行工具",
    "",
    "用法：",
    `  ${CLI_COMMAND_NAME} <子命令> [参数]`,
    "",
    "子命令：",
    ...getCommandListLines(),
    "",
    "通用参数：",
    "  --help, -h             显示帮助",
    "",
    "示例：",
    `  ${formatHelpCommand("interactive")}`,
    `  ${formatHelpCommand("next")}`,
  ].join("\n");
}

function getCommandListLines() {
  return (Object.entries(COMMAND_DEFINITIONS) as [CliCommand, (typeof COMMAND_DEFINITIONS)[CliCommand]][]).map(
    ([command, definition]) => `  ${command} (${definition.alias})`.padEnd(25) + definition.description,
  );
}

function formatCommandUsage(command: CliCommand, suffix = "") {
  return `${CLI_COMMAND_NAME} ${command}${suffix ? ` ${suffix}` : ""}`;
}

function formatHelpCommand(command: CliCommand) {
  return `${CLI_COMMAND_NAME} --help ${command}`;
}

function formatDefaultInteractiveUsage(suffix: string) {
  return `${CLI_COMMAND_NAME} ${suffix}`;
}

function printCliError(message: string) {
  console.error(message);
  console.error("");
  console.error(CLI_HELP_HINT);
  process.exitCode = 1;
}

function resolveCommandAlias(token: string | undefined): CliCommand | undefined {
  if (token === "interactive" || token === "i") {
    return "interactive";
  }

  if (token === "next" || token === "n") {
    return "next";
  }

  return undefined;
}

function splitNames(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseAnswerList(value: string) {
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

function normalizeTargetNames(targetCount: number, names: readonly string[]) {
  return Array.from({ length: targetCount }, (_, index) => names[index] ?? "");
}

function getTargetLabel(targetNames: readonly string[], index: number) {
  const customName = targetNames[index - 1]?.trim();
  return customName && customName.length > 0 ? customName : `目标 ${index}`;
}

function formatTargetNames(targetNames: readonly string[], targets: readonly number[]) {
  return targets.map((target) => getTargetLabel(targetNames, target)).join(",");
}

function getAllTargetsFromRanges(ranges: readonly TargetRange[]) {
  return takeTargetsFromRanges(ranges, getTargetRangeCount(ranges));
}

function getTargetRangeCount(ranges: readonly TargetRange[]) {
  return ranges.reduce((total, range) => total + Math.max(range.end - range.start + 1, 0), 0);
}

export function getNextCommandResult(
  targetCount: number,
  targetNames: readonly string[],
  answers: readonly boolean[],
): NextCommandResult {
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
      targets: state.resultTargets.map((target) => getTargetLabel(targetNames, target)),
    };
  }

  const promptTargets = getAllTargetsFromRanges(step.promptTargetRanges);
  return {
    status: "testing",
    targetCount,
    targets: promptTargets.map((target) => getTargetLabel(targetNames, target)),
  };
}

async function runInteractiveCli(targetCount: number, targetNames: readonly string[]) {
  const rl = readline.createInterface({ input, output });
  const history: boolean[] = [];
  let state = createCompatibilityTestState(targetCount);

  console.log(`已开始兼容性问题排查，共 ${targetCount} 个目标。`);
  console.log("输入 y/n 回答是否复现问题，输入 u 撤回上一步，输入 q 退出。");

  try {
    while (true) {
      let step = getCurrentCompatibilityTestStep(state);
      while (step && !step.requiresAnswer) {
        skipCachedCompatibilityTestSteps(state);
        step = getCurrentCompatibilityTestStep(state);
      }

      if (!step) {
        printResult(targetNames, state);
        return;
      }

      printPrompt(step, targetNames);
      const answer = await rl.question("> ");
      const normalizedAnswer = answer.trim().toLowerCase();

      if (normalizedAnswer === "q" || normalizedAnswer === "quit") {
        console.log("已退出。");
        return;
      }

      if (normalizedAnswer === "u" || normalizedAnswer === "undo") {
        if (history.length === 0) {
          console.log("当前没有可撤回的步骤。");
          continue;
        }

        history.pop();
        state = rebuildStateFromAnswers(targetCount, history);
        console.log("已撤回到上一步。");
        continue;
      }

      const parsedAnswer = parseAnswer(normalizedAnswer);
      if (parsedAnswer === undefined) {
        console.log("无效输入。请输入 y / n / u / q。");
        continue;
      }

      history.push(parsedAnswer);
      applyCompatibilityTestAnswer(state, parsedAnswer);
    }
  } finally {
    rl.close();
  }
}

function printPrompt(step: CompatibilityTestStep, targetNames: readonly string[]) {
  const targets = getAllTargetsFromRanges(step.promptTargetRanges);
  console.log("");
  console.log(`本次请测试 ${step.promptTargetCount} 个目标：`);
  console.log(formatTargetNames(targetNames, targets));
}

function parseAnswer(value: string) {
  if (value === "y" || value === "yes" || value === "issue" || value === "1" || value === "true") {
    return true;
  }

  if (value === "n" || value === "no" || value === "pass" || value === "0" || value === "false") {
    return false;
  }

  return undefined;
}

function rebuildStateFromAnswers(targetCount: number, answers: readonly boolean[]) {
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

function printResult(targetNames: readonly string[], state: CompatibilityTestState) {
  console.log("");
  if (state.resultTargets.length === 0) {
    console.log("测试完成，不存在兼容性问题。");
    return;
  }

  console.log(`测试完成，下列 ${state.resultTargets.length} 个目标有兼容性问题：`);
  console.log(formatTargetNames(targetNames, state.resultTargets));
}
