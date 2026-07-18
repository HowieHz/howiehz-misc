import { computed, ref, type Ref } from "vue";

import type { ReadonlyValue as ReadonlyRef, ToolWorkflowMode, TransferStatus } from "../../core/types";

const graphwarCopyStatusFlashMs = 2000;

/** 复制公式操作的按钮与无障碍反馈文案。 */
interface GraphwarResultCopyMessages {
  /** 默认复制按钮文案。 */
  buttonDefault: string;
  /** 复制失败后的临时按钮文案。 */
  buttonError: string;
  /** 复制成功后的临时按钮文案。 */
  buttonSuccess: string;
  /** 复制失败后的无障碍播报文案。 */
  error: string;
  /** 复制成功后的无障碍播报文案。 */
  success: string;
}

/** 结果操作控制器读取的模式、公式和副作用依赖。 */
interface GraphwarResultActionsOptions {
  /** 复制反馈文案应由页面从当前 locale 投影，避免本 Module 持有整包 locale。 */
  getCopyMessages: () => GraphwarResultCopyMessages;
  /** 模拟器表达式输入；复制时应保留用户原始文本。 */
  simulatorFormulaText: Ref<string>;
  /** 模拟器发射角输入；清空模拟器时应与表达式一起清理。 */
  simulatorLaunchAngleText: Ref<string>;
  /** 求解器最终输出文本；允许页面在复制前应用纯展示后处理。 */
  solverFormulaText: ReadonlyRef<string>;
  /** 当前主工作流；决定复制 solver 结果还是模拟器输入。 */
  toolWorkflowMode: ReadonlyRef<ToolWorkflowMode>;
}

/** 管理公式复制、模拟器清空和短时反馈状态的控制器。 */
export interface GraphwarResultActionsController {
  /** 是否允许清空模拟器输入。 */
  canClearSimulatorInputs: ReadonlyRef<boolean>;
  /** 是否允许复制当前公式文本。 */
  canCopyFormula: ReadonlyRef<boolean>;
  /** 清空模拟器表达式和二阶发射角输入。 */
  clearSimulatorInputs: () => void;
  /** 当前复制按钮文案。 */
  copyButtonText: ReadonlyRef<string>;
  /** 复制当前可用的 Graphwar 表达式。 */
  copyFormula: () => Promise<void>;
  /** 清理复制反馈定时器，应在页面卸载时调用。 */
  dispose: () => void;
  /** 无障碍状态播报文案。 */
  statusAnnouncement: ReadonlyRef<string>;
}

/** 管理结果复制、短反馈和模拟器清空；页面不应直接持有复制计时器。 */
export function useGraphwarResultActions(options: GraphwarResultActionsOptions): GraphwarResultActionsController {
  const copyStatus = ref<TransferStatus>("idle");
  let copyStatusTimer: ReturnType<typeof setTimeout> | undefined;

  const copyButtonText = computed(() => {
    const messages = options.getCopyMessages();
    if (copyStatus.value === "success") {
      return messages.buttonSuccess;
    }
    if (copyStatus.value === "error") {
      return messages.buttonError;
    }
    return messages.buttonDefault;
  });
  const canCopyFormula = computed(() =>
    options.toolWorkflowMode.value === "solver"
      ? !!options.solverFormulaText.value
      : !!options.simulatorFormulaText.value.trim(),
  );
  const canClearSimulatorInputs = computed(
    () => !!options.simulatorFormulaText.value || !!options.simulatorLaunchAngleText.value,
  );
  const statusAnnouncement = computed(() => {
    const messages = options.getCopyMessages();
    if (copyStatus.value === "success") {
      return messages.success;
    }
    if (copyStatus.value === "error") {
      return messages.error;
    }
    return "";
  });

  /** 复制当前生成或输入的 Graphwar 表达式，保留原有按钮可用性和空文本保护。 */
  async function copyFormula() {
    const text =
      options.toolWorkflowMode.value === "solver"
        ? options.solverFormulaText.value
        : options.simulatorFormulaText.value;
    if (!canCopyFormula.value || !text) {
      return;
    }

    try {
      await copyText(text);
      setCopyStatus("success");
    } catch {
      setCopyStatus("error");
    }
  }

  /** 清除模拟器输入后应同步复位复制反馈，避免旧成功或失败文案误导用户。 */
  function clearSimulatorInputs() {
    options.simulatorFormulaText.value = "";
    options.simulatorLaunchAngleText.value = "";
    setCopyStatus("idle");
  }

  /** 页面卸载时应取消自动复位任务，避免卸载后继续回写响应式状态。 */
  function dispose() {
    if (copyStatusTimer) {
      clearTimeout(copyStatusTimer);
      copyStatusTimer = undefined;
    }
  }

  /** 设置临时复制反馈文本，并在短时间后自动清除。 */
  function setCopyStatus(status: TransferStatus) {
    copyStatus.value = status;
    if (copyStatusTimer) {
      clearTimeout(copyStatusTimer);
      copyStatusTimer = undefined;
    }

    if (status !== "idle") {
      copyStatusTimer = setTimeout(() => {
        copyStatus.value = "idle";
        copyStatusTimer = undefined;
      }, graphwarCopyStatusFlashMs);
    }
  }

  return {
    canClearSimulatorInputs,
    canCopyFormula,
    clearSimulatorInputs,
    copyButtonText,
    copyFormula,
    dispose,
    statusAnnouncement,
  };
}

/** 使用 Clipboard API 复制文本；API 不可用时回退到隐藏 textarea 命令。 */
async function copyText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard API unavailable");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();

  if (document.execCommand("copy")) {
    textarea.remove();
    return;
  }
  textarea.remove();
  throw new Error("Copy failed");
}
