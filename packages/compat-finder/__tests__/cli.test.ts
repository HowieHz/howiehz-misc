import { describe, expect, it } from "vitest";

import { getCommandHelpText, getNextCommandResult, getRootHelpText, parseCliArgs } from "../src/cli/index.ts";
import { normalizeCliLocale, resolveCliLocale } from "../src/locales/index.ts";

const TARGET_NAMES = ["Alpha", "Beta", "Gamma", "Delta"] as const;
const ZH_CN_ENV = { LANG: "zh_CN.UTF-8" } as const;

describe("compatibility test cli", () => {
  it("parses count and names", () => {
    const result = parseCliArgs(["interactive", "--count", "3", "--names", "Alpha, Beta,Gamma"], ZH_CN_ENV);

    expect(result).toMatchObject({
      options: {
        command: "interactive",
        count: 3,
        names: ["Alpha", "Beta", "Gamma"],
      },
    });
  });

  it("supports short aliases for subcommands", () => {
    const interactiveResult = parseCliArgs(["i", "--count", "3"], ZH_CN_ENV);
    const nextResult = parseCliArgs(["n", "--count", "3"], ZH_CN_ENV);

    expect(interactiveResult.options.command).toBe("interactive");
    expect(nextResult.options.command).toBe("next");
  });

  it("accepts help without other arguments", () => {
    const result = parseCliArgs(["--help"], ZH_CN_ENV);

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

    expect(helpText).toContain("compat-finder <子命令> [参数]");
    expect(helpText).toContain("interactive (i)");
    expect(helpText).toContain("next (n)");
    expect(helpText).toContain("--algorithm, --algo <name>");
    expect(helpText).toContain("默认：binary-split");
  });

  it("returns localized root help text", () => {
    const helpText = getRootHelpText("en");

    expect(helpText).toContain("compat-finder <subcommand> [options]");
    expect(helpText).toContain("interactive (i)");
    expect(helpText).toContain("next (n)");
    expect(helpText).toContain("default: binary-split");
  });

  it("localizes next help output examples", () => {
    const enHelpText = getCommandHelpText("next", "en");
    const zhHelpText = getCommandHelpText("next", "zh-Hans");

    expect(enHelpText).toContain('"targets": ["Target 1"]');
    expect(enHelpText).not.toContain('"targets": ["目标 1"]');
    expect(zhHelpText).toContain('"targets": ["目标 1"]');
  });

  it("keeps interactive as the default command for backward compatibility", () => {
    const result = parseCliArgs(["--count", "2"], ZH_CN_ENV);

    expect(result).toMatchObject({
      options: {
        command: "interactive",
        count: 2,
      },
    });
  });

  it("parses next answers", () => {
    const result = parseCliArgs(["next", "--count", "4", "--answers", "issue,pass,1,0"], ZH_CN_ENV);

    expect(result).toMatchObject({
      options: {
        answers: [true, false, true, false],
        command: "next",
        count: 4,
      },
    });
  });

  it("parses the algorithm option", () => {
    const result = parseCliArgs(["next", "--count", "4", "--algorithm", "leave-one-out"], ZH_CN_ENV);

    expect(result).toMatchObject({
      options: {
        algorithm: "leave-one-out",
        command: "next",
        count: 4,
      },
    });
  });

  it("parses the algorithm alias", () => {
    const result = parseCliArgs(["next", "--count", "4", "--algo", "leave-one-out"], ZH_CN_ENV);

    expect(result).toMatchObject({
      options: {
        algorithm: "leave-one-out",
        command: "next",
        count: 4,
      },
    });
  });

  it("rejects invalid algorithms", () => {
    const result = parseCliArgs(["next", "--count", "4", "--algorithm", "linear"], ZH_CN_ENV);

    expect(result.error).toBe("参数 --algorithm 仅支持 binary-split 和 leave-one-out。");
  });

  it("rejects invalid next answers", () => {
    const result = parseCliArgs(["next", "--count", "4", "--answers", "issue,wat"], ZH_CN_ENV);

    expect(result.error).toBe("参数 --answers 仅支持 y/n、yes/no、issue/pass、1/0、true/false。");
  });

  it("parses extra answers and leaves semantic validation to next execution", () => {
    const result = parseCliArgs(["next", "--count", "1", "--answers", "pass,issue"], ZH_CN_ENV);

    expect(result).toMatchObject({
      options: {
        answers: [false, true],
        command: "next",
        count: 1,
      },
    });
  });

  it("rejects invalid count", () => {
    const result = parseCliArgs(["--count", "0"], ZH_CN_ENV);

    expect(result.error).toBe("参数 --count 必须是大于 0 的整数。");
  });

  it("rejects unknown arguments", () => {
    const result = parseCliArgs(["interactive", "--wat"], ZH_CN_ENV);

    expect(result.error).toBe("未知参数：--wat");
  });

  it("rejects unknown subcommands", () => {
    const result = parseCliArgs(["wat", "--count", "2"], ZH_CN_ENV);

    expect(result.error).toBe("未知子命令：wat");
  });

  it("parses the locale option", () => {
    const result = parseCliArgs(["next", "--locale", "en", "--count", "2"], ZH_CN_ENV);

    expect(result.options.locale).toBe("en");
  });

  it("parses the locale short option", () => {
    const result = parseCliArgs(["next", "-l", "en", "--count", "2"], ZH_CN_ENV);

    expect(result.options.locale).toBe("en");
  });

  it("rejects unsupported locales", () => {
    const result = parseCliArgs(["next", "--locale", "fr", "--count", "2"], ZH_CN_ENV);

    expect(result.error).toBe("不支持的语言：fr");
  });

  it("rejects unsupported explicit Chinese locale variants", () => {
    const result = parseCliArgs(["next", "--locale", "zh-TW", "--count", "2"], ZH_CN_ENV);

    expect(result.error).toBe("不支持的语言：zh-TW");
  });

  it("keeps subcommand context for help", () => {
    const interactiveResult = parseCliArgs(["interactive", "--help"], ZH_CN_ENV);
    const nextResult = parseCliArgs(["next", "--help"], ZH_CN_ENV);

    expect(interactiveResult.options.command).toBe("interactive");
    expect(interactiveResult.options.help).toBe(true);
    expect(nextResult.options.command).toBe("next");
    expect(nextResult.options.help).toBe(true);
  });

  it("supports root help followed by a subcommand name", () => {
    const result = parseCliArgs(["--help", "next"], ZH_CN_ENV);

    expect(result.options.command).toBe("next");
    expect(result.options.help).toBe(true);
    expect(result.options.helpScope).toBe("command");
  });

  it("supports root help followed by a subcommand alias", () => {
    const interactiveResult = parseCliArgs(["--help", "i"], ZH_CN_ENV);
    const nextResult = parseCliArgs(["--help", "n"], ZH_CN_ENV);

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

  it("returns leave-one-out prompts when requested", () => {
    const result = getNextCommandResult(4, TARGET_NAMES, [true, false], "en", "leave-one-out");

    expect(result).toEqual({
      status: "testing",
      targetCount: 4,
      targets: ["Alpha", "Beta", "Delta"],
    });
  });

  it("keeps single-target leave-one-out next prompts non-empty", () => {
    const result = getNextCommandResult(1, ["Only"], [], "en", "leave-one-out");

    expect(result).toEqual({
      status: "testing",
      targetCount: 1,
      targets: ["Only"],
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

  it("returns a typed next result for cli execution", () => {
    expect(getNextCommandResult(4, TARGET_NAMES, [true, false])).toEqual({
      status: "testing",
      targetCount: 4,
      targets: ["Beta"],
    });
  });

  it("rethrows unrelated next execution failures", () => {
    expect(() => getNextCommandResult(0, ["Only"], [], "en")).toThrow(
      "targetCount must be an integer greater than or equal to 1",
    );
  });

  it("returns a complete result with extra answer metadata", () => {
    expect(getNextCommandResult(1, ["Only"], [false, true], "en")).toEqual({
      extraAnswerCount: 1,
      status: "complete",
      targetCount: 1,
      targets: [],
    });
  });

  it("reports how many extra answers were provided", () => {
    expect(getNextCommandResult(1, ["Only"], [false, true, false], "en")).toEqual({
      extraAnswerCount: 2,
      status: "complete",
      targetCount: 1,
      targets: [],
    });
  });

  it("does not include extra answer metadata while testing", () => {
    expect(getNextCommandResult(4, TARGET_NAMES, [true, false])).not.toHaveProperty("extraAnswerCount");
  });

  it("localizes default target names in next results", () => {
    const result = getNextCommandResult(2, [], [], "en");

    expect(result).toEqual({
      status: "testing",
      targetCount: 2,
      targets: ["Target 1"],
    });
  });

  it("normalizes locale values", () => {
    expect(normalizeCliLocale("zh_CN.UTF-8")).toBe("zh-Hans");
    expect(normalizeCliLocale("zh_CN@pinyin")).toBe("zh-Hans");
    expect(normalizeCliLocale("zh_CN.UTF-8@pinyin")).toBe("zh-Hans");
    expect(normalizeCliLocale("zh-Hans")).toBe("zh-Hans");
    expect(normalizeCliLocale("zh-Hans-CN")).toBe("zh-Hans");
    expect(normalizeCliLocale("zh_Hans_CN@pinyin")).toBe("zh-Hans");
    expect(normalizeCliLocale("zh-TW")).toBeUndefined();
    expect(normalizeCliLocale("zh-Hant")).toBeUndefined();
    expect(normalizeCliLocale("en_US.UTF-8")).toBe("en");
    expect(normalizeCliLocale("C")).toBeUndefined();
  });

  it("resolves locale by explicit option, environment, and fallback order", () => {
    expect(resolveCliLocale("en", { COMPAT_FINDER_LOCALE: "zh-Hans" })).toBe("en");
    expect(resolveCliLocale(undefined, { COMPAT_FINDER_LOCALE: "zh-Hans" })).toBe("zh-Hans");
    expect(resolveCliLocale(undefined, { COMPAT_FINDER_LOCALE: "zh-CN" })).toBe("zh-Hans");
    expect(resolveCliLocale(undefined, { LC_ALL: "zh_CN.UTF-8", LANG: "en_US.UTF-8" })).toBe("zh-Hans");
    expect(resolveCliLocale(undefined, {})).toBe("en");
  });
});
