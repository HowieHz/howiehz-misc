/** 汇总页面折叠面板标题状态，用于提示配置、识别和寻路结果。 */
/** 标题状态类型，与页面提示样式一一对应。 */
export type HeaderStatusKind = "info" | "success" | "warning" | "error";

/** 折叠面板标题旁显示的短状态。 */
export interface HeaderStatus {
  /** 状态文案；空字符串表示不显示。 */
  message: string;
  /** 状态样式语义。 */
  kind: HeaderStatusKind;
}

export const emptyHeaderStatus: HeaderStatus = { message: "", kind: "info" };

/**
 * 创建标题状态；空文案统一折叠成共享空状态，减少页面空值判断。
 *
 * @param message 要显示的状态文案。
 * @param kind 状态样式语义。
 */
export function createHeaderStatus(message: string, kind: HeaderStatusKind = "info"): HeaderStatus {
  return message ? { message, kind } : emptyHeaderStatus;
}

/**
 * 返回第一条有文案的状态，用于按优先级选择面板标题提示。
 *
 * @param statuses 按优先级排列的候选状态。
 */
export function getFirstHeaderStatus(...statuses: readonly HeaderStatus[]): HeaderStatus {
  return statuses.find((status) => status.message) ?? emptyHeaderStatus;
}

/** 智能寻路面板标题状态的全部输入，集中建模避免模板里散落优先级判断。 */
export interface SmartPathfindingHeaderStatusInput {
  /** 智能寻路是否启用。 */
  smartPathfindingEnabled: boolean;
  /** 智能寻路参数校验错误。 */
  smartPathfindingSettingsMessage: string;
  /** 智能寻路运行状态文案。 */
  smartPathfindingStatusMessage: string;
  /** 智能寻路运行状态等级。 */
  smartPathfindingStatusKind: HeaderStatusKind;
  /** 未启用智能寻路时的引导文案。 */
  enableHintMessage: string;
  /** 无更高优先级状态时的普通提示。 */
  hintMessage: string;
}

/** 按校验错误、运行状态和提示的顺序选择智能寻路标题状态。 */
export function getSmartPathfindingHeaderStatus(input: SmartPathfindingHeaderStatusInput): HeaderStatus {
  if (!input.smartPathfindingEnabled) {
    return createHeaderStatus(input.enableHintMessage);
  }
  const smartPathfindingStatus = createHeaderStatus(
    input.smartPathfindingStatusMessage,
    input.smartPathfindingStatusKind,
  );
  return getFirstHeaderStatus(
    createHeaderStatus(input.smartPathfindingSettingsMessage, "error"),
    smartPathfindingStatus.kind === "success" ? emptyHeaderStatus : smartPathfindingStatus,
    smartPathfindingStatus,
    createHeaderStatus(input.hintMessage),
  );
}
