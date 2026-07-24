import { GraphwarAgentClientError } from "../../controllers/agent/client";
import type { GraphwarKillerLocale } from "../../locale-types";

/** 将 Agent 内部错误分类和状态码转换为当前页面语言的用户文案。 */
export function createGraphwarAgentFailureReason(locale: GraphwarKillerLocale, error: unknown) {
  return locale.status.agent.failureReason(
    error instanceof GraphwarAgentClientError ? error.kind : undefined,
    error instanceof Error ? error.message : String(error),
    error instanceof GraphwarAgentClientError ? error.code : undefined,
  );
}
