import { describe, expect, it } from "vitest";

import { graphwarKillerLocale as englishLocale } from "../../../../en/tools/graphwar-killer/locale";
import { GraphwarAgentClientError } from "../../controllers/agent/client";
import { graphwarKillerLocale as chineseLocale } from "../../locale";
import { createGraphwarAgentFailureReason } from "./agent";

describe("Graphwar Agent status", () => {
  it.each([
    ["graphwar-window-not-found", "未找到 Graphwar 游戏窗口", "The Graphwar game window was not found"],
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

  it("does not expose an internal Agent error message", () => {
    const error = new GraphwarAgentClientError("transient", "raw server detail", 500, undefined, "internal-error");

    expect(createGraphwarAgentFailureReason(chineseLocale, error)).toBe("Graphwar Agent 内部错误");
    expect(createGraphwarAgentFailureReason(englishLocale, error)).toBe("Graphwar Agent encountered an internal error");
  });

  it("explains the managed-mode setting that must be corrected after authentication fails", () => {
    const error = new GraphwarAgentClientError(
      "invalid-request",
      "A valid bearer token is required",
      401,
      undefined,
      "authentication-required",
    );

    expect(
      chineseLocale.smartPathfinding.managed.invalidRequest(createGraphwarAgentFailureReason(chineseLocale, error)),
    ).toBe("Agent 拒绝请求，托管已关闭：Agent 访问令牌未设置或无效");
    expect(
      englishLocale.smartPathfinding.managed.invalidRequest(createGraphwarAgentFailureReason(englishLocale, error)),
    ).toBe("Managed mode stopped because the Agent rejected the request: The Agent access token is missing or invalid");
  });

  it.each([
    ["bad-request", "invalid-request", "Agent 无法解析请求", "The Agent could not parse the request"],
    ["invalid-ready-request", "invalid-request", "准备状态请求无效", "The ready-state request is invalid"],
    ["invalid-shot-request", "invalid-request", "发射请求无效", "The shot request is invalid"],
    ["invalid-request-id", "invalid-request", "发射请求 ID 格式无效", "The shot request ID format is invalid"],
    [
      "authentication-required",
      "invalid-request",
      "Agent 访问令牌未设置或无效",
      "The Agent access token is missing or invalid",
    ],
    [
      "route-not-found",
      "incompatible",
      "Agent 地址错误或缺少所需的 v3 API 路由，请检查 Agent 地址或升级 Agent",
      "The Agent address is incorrect or a required v3 API route is missing; check the address or upgrade the Agent",
    ],
    ["shot-command-not-found", "conflict", "Agent 找不到该发射命令", "The Agent could not find this shot command"],
    [
      "method-not-allowed",
      "incompatible",
      "Agent 地址错误或不支持所需的 v3 API 方法，请检查 Agent 地址或升级 Agent",
      "The Agent address is incorrect or the required v3 API method is unsupported; check the address or upgrade the Agent",
    ],
    [
      "request-id-conflict",
      "conflict",
      "发射请求 ID 与已有命令冲突",
      "The shot request ID conflicts with an existing command",
    ],
    [
      "room-unavailable",
      "conflict",
      "当前房间无法更改准备状态",
      "The ready state cannot be changed in the current room",
    ],
    ["obstacle-mask-unavailable", "conflict", "当前没有可用的障碍快照", "No obstacle snapshot is currently available"],
    ["content-length-required", "invalid-request", "请求缺少 Content-Length", "The request is missing Content-Length"],
    [
      "battle-revision-changed",
      "conflict",
      "Graphwar 战场状态已变化，请重试",
      "The Graphwar battlefield changed; try again",
    ],
    [
      "request-body-too-large",
      "invalid-request",
      "请求数据超过 Agent 限制",
      "The request data exceeds the Agent limit",
    ],
    [
      "unsupported-media-type",
      "invalid-request",
      "请求数据格式不受 Agent 支持",
      "The Agent does not support the request data format",
    ],
    [
      "if-match-required",
      "conflict",
      "障碍请求缺少战场版本",
      "The obstacle request is missing the battlefield revision",
    ],
    [
      "request-headers-too-large",
      "invalid-request",
      "请求头超过 Agent 限制",
      "The request headers exceed the Agent limit",
    ],
    ["internal-error", "transient", "Graphwar Agent 内部错误", "Graphwar Agent encountered an internal error"],
    [
      "server-busy",
      "transient",
      "Agent 的 Graphwar 请求槽正忙，请稍后重试",
      "The Agent's Graphwar request slots are busy; try again shortly",
    ],
  ] as const)("localizes the v3 HTTP code %s", (code, kind, chinese, english) => {
    const error = new GraphwarAgentClientError(kind, "raw detail", undefined, undefined, code);

    expect(createGraphwarAgentFailureReason(chineseLocale, error)).toBe(chinese);
    expect(createGraphwarAgentFailureReason(englishLocale, error)).toBe(english);
  });

  it.each([
    ["function-empty", "发射函数不能为空", "The shot function cannot be empty"],
    ["function-too-large", "发射函数超过 Agent 大小限制", "The shot function exceeds the Agent size limit"],
    ["function-too-complex", "发射函数复杂度超过 Agent 限制", "The shot function exceeds the Agent complexity limit"],
    ["malformed-function", "发射函数格式无效", "The shot function is malformed"],
    ["angle-required", "当前方程模式需要发射角度", "The current equation mode requires a shot angle"],
    ["angle-not-allowed", "当前方程模式不接受发射角度", "The current equation mode does not accept a shot angle"],
    ["angle-out-of-range", "发射角度超出允许范围", "The shot angle is outside the allowed range"],
    ["turn-token-stale", "当前回合令牌已失效", "The current turn token is no longer current"],
    ["turn-token-used", "当前回合已经提交过发射命令", "A shot command has already been submitted for this turn"],
    ["battle-revision-stale", "发射前战场状态已变化", "The battlefield changed before the shot was executed"],
    ["game-instance-stale", "当前对局已发生变化", "The current match has changed"],
    ["turn-expired", "当前回合已经结束", "The current turn has ended"],
    ["shot-already-resolving", "当前回合的发射正在结算", "The shot for this turn is already resolving"],
    ["graphwar-state-unavailable", "Graphwar 当前无法接受发射命令", "Graphwar cannot accept a shot command right now"],
    [
      "graphwar-call-failed",
      "Graphwar 执行发射时失败，结果未知",
      "Graphwar failed while executing the shot; the result is unknown",
    ],
    ["internal-error", "Graphwar Agent 内部错误", "Graphwar Agent encountered an internal error"],
    ["invalid-shot-request", "发射请求无效", "The shot request is invalid"],
    ["shot-executor-busy", "Agent 正在处理上一条发射命令", "The Agent is still processing the previous shot command"],
  ] as const)("localizes the v3 shot-command code %s", (code, chinese, english) => {
    const error = new GraphwarAgentClientError("command", "raw detail", undefined, undefined, code);

    expect(createGraphwarAgentFailureReason(chineseLocale, error)).toBe(chinese);
    expect(createGraphwarAgentFailureReason(englishLocale, error)).toBe(english);
  });

  it("uses a safe fallback for a future shot-command error code", () => {
    expect(
      createGraphwarAgentFailureReason(
        chineseLocale,
        new GraphwarAgentClientError("command", "sensitive raw detail", undefined, undefined, "future-command-error"),
      ),
    ).toBe("Graphwar Agent 返回了未知的发射错误");
    expect(
      createGraphwarAgentFailureReason(
        englishLocale,
        new GraphwarAgentClientError("command", "sensitive raw detail", undefined, undefined, "future-command-error"),
      ),
    ).toBe("Graphwar Agent returned an unknown shot error");
  });
});
