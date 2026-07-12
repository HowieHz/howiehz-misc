import { describe, expect, it } from "vitest";

import { graphwarKillerLocale as englishLocale } from "../../../../en/tools/graphwar-killer/locale";
import { GraphwarAgentClientError } from "../../controllers/agent/client";
import { graphwarKillerLocale as chineseLocale } from "../../locale";
import { createGraphwarAgentFailureReason } from "./agent";

describe("Graphwar Agent status", () => {
  it.each([
    ["game-data-not-initialized", "Graphwar 游戏数据尚未初始化", "Graphwar game data has not initialized"],
    ["game-not-active", "当前没有进行中的对局", "No game is currently active"],
    ["game-not-started", "游戏尚未开始", "Game has not started"],
    ["not-in-pre-game-room", "当前不在游戏房间", "Not currently in a game room"],
  ])("localizes the %s availability code", (code, chinese, english) => {
    const error = new GraphwarAgentClientError("unavailable", code);

    expect(createGraphwarAgentFailureReason(chineseLocale, error)).toBe(chinese);
    expect(createGraphwarAgentFailureReason(englishLocale, error)).toBe(english);
  });

  it.each([
    ["conflict", "Graphwar 状态已变化，请重试"],
    ["incompatible", "Graphwar Agent 版本或返回数据不兼容，请升级 Agent"],
    ["invalid-request", "发送给 Graphwar Agent 的请求无效"],
    ["transient", "网络或 Graphwar Agent 暂时不可用"],
  ] as const)("localizes the %s client error without exposing its English detail", (kind, expected) => {
    expect(createGraphwarAgentFailureReason(chineseLocale, new GraphwarAgentClientError(kind, "raw detail"))).toBe(
      expected,
    );
  });

  it("keeps an unknown availability code visible without presenting it as user-facing prose", () => {
    const error = new GraphwarAgentClientError("unavailable", "future-agent-state");

    expect(createGraphwarAgentFailureReason(chineseLocale, error)).toBe("Agent 返回未知状态：future-agent-state");
    expect(createGraphwarAgentFailureReason(englishLocale, error)).toBe(
      "Agent returned an unknown state: future-agent-state",
    );
  });
});
