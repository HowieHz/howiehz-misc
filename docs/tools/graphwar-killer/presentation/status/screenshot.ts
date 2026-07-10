export type GraphwarScreenshotStatusKind = "success" | "warning" | "error";

export interface GraphwarScreenshotHeaderStatus {
  /** 标题右侧主状态文案；空字符串表示不显示。 */
  message: string;
  /** 主状态颜色语义。 */
  kind: GraphwarScreenshotStatusKind;
  /** 主状态 hover 详情。 */
  title: string;
}

export const emptyGraphwarScreenshotHeaderStatus: GraphwarScreenshotHeaderStatus = {
  kind: "warning",
  message: "",
  title: "",
};

/** 按路径错误、当前计算状态、长期模式建议的顺序选择截图标题主状态。 */
export function getGraphwarScreenshotHeaderStatus(options: {
  agentRecommendation: string;
  calculationStatus: GraphwarScreenshotHeaderStatus;
  pathError: string;
}): GraphwarScreenshotHeaderStatus {
  if (options.pathError) {
    return {
      kind: "error",
      message: options.pathError,
      title: options.pathError,
    };
  }
  if (options.calculationStatus.message) {
    return options.calculationStatus;
  }
  if (options.agentRecommendation) {
    return {
      kind: "warning",
      message: options.agentRecommendation,
      title: options.agentRecommendation,
    };
  }
  return emptyGraphwarScreenshotHeaderStatus;
}
