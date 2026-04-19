import { describe, expect, it } from "vitest";

import { getNextCommandResult, getRootHelpText, parseCliArgs } from "../cli.ts";

const TARGET_NAMES = ["Alpha", "Beta", "Gamma", "Delta"] as const;

describe("compatibility test cli", () => {
  it("parses count and names", () => {
    const result = parseCliArgs(["interactive", "--count", "3", "--names", "Alpha, Beta,Gamma"]);

    expect(result).toMatchObject({
      options: {
        command: "interactive",
        count: 3,
        names: ["Alpha", "Beta", "Gamma"],
      },
    });
  });

  it("supports short aliases for subcommands", () => {
    const interactiveResult = parseCliArgs(["i", "--count", "3"]);
    const nextResult = parseCliArgs(["n", "--count", "3"]);

    expect(interactiveResult.options.command).toBe("interactive");
    expect(nextResult.options.command).toBe("next");
  });

  it("accepts help without other arguments", () => {
    const result = parseCliArgs(["--help"]);

    expect(result).toMatchObject({
      options: {
        command: "interactive",
        help: true,
        helpScope: "root",
      },
    });
  });

  it("returns dedicated root help text", () => {
    const helpText = getRootHelpText();

    expect(helpText).toContain("compat-test <子命令> [参数]");
    expect(helpText).toContain("interactive (i)");
    expect(helpText).toContain("next (n)");
  });

  it("keeps interactive as the default command for backward compatibility", () => {
    const result = parseCliArgs(["--count", "2"]);

    expect(result).toMatchObject({
      options: {
        command: "interactive",
        count: 2,
      },
    });
  });

  it("parses next answers", () => {
    const result = parseCliArgs(["next", "--count", "4", "--answers", "issue,pass,1,0"]);

    expect(result).toMatchObject({
      options: {
        answers: [true, false, true, false],
        command: "next",
        count: 4,
      },
    });
  });

  it("rejects invalid next answers", () => {
    const result = parseCliArgs(["next", "--count", "4", "--answers", "issue,wat"]);

    expect(result.error).toBe("参数 --answers 仅支持 y/n、yes/no、issue/pass、1/0、true/false。");
  });

  it("rejects invalid count", () => {
    const result = parseCliArgs(["--count", "0"]);

    expect(result.error).toBe("参数 --count 必须是大于 0 的整数。");
  });

  it("rejects unknown arguments", () => {
    const result = parseCliArgs(["interactive", "--wat"]);

    expect(result.error).toBe("未知参数：--wat");
  });

  it("rejects unknown subcommands", () => {
    const result = parseCliArgs(["wat", "--count", "2"]);

    expect(result.error).toBe("未知子命令：wat");
  });

  it("keeps subcommand context for help", () => {
    const interactiveResult = parseCliArgs(["interactive", "--help"]);
    const nextResult = parseCliArgs(["next", "--help"]);

    expect(interactiveResult.options.command).toBe("interactive");
    expect(interactiveResult.options.help).toBe(true);
    expect(nextResult.options.command).toBe("next");
    expect(nextResult.options.help).toBe(true);
  });

  it("supports root help followed by a subcommand name", () => {
    const result = parseCliArgs(["--help", "next"]);

    expect(result.options.command).toBe("next");
    expect(result.options.help).toBe(true);
    expect(result.options.helpScope).toBe("command");
  });

  it("supports root help followed by a subcommand alias", () => {
    const interactiveResult = parseCliArgs(["--help", "i"]);
    const nextResult = parseCliArgs(["--help", "n"]);

    expect(interactiveResult.options.command).toBe("interactive");
    expect(interactiveResult.options.help).toBe(true);
    expect(interactiveResult.options.helpScope).toBe("command");
    expect(nextResult.options.command).toBe("next");
    expect(nextResult.options.help).toBe(true);
    expect(nextResult.options.helpScope).toBe("command");
  });

  it("returns the next testing prompt as json-ready data", () => {
    const result = getNextCommandResult(4, TARGET_NAMES, [true, false]);

    expect(result).toEqual({
      status: "testing",
      targetCount: 4,
      targets: ["Beta"],
    });
  });

  it("returns a complete result as json-ready data", () => {
    const result = getNextCommandResult(4, TARGET_NAMES, [true, false, true]);

    expect(result).toEqual({
      status: "complete",
      targetCount: 4,
      targets: ["Beta"],
    });
  });
});
