import { ref, type Ref } from "vue";

const debugActivationHoldMs = 3000;
const debugActivationCountdownStepMs = 100;
const debugActivationCountdownVisibleAfterMs = 1000;
const debugActivationSuccessFlashMs = 2000;

interface GraphwarDebugActivationOptions {
  /** 普通短按或已启用调试后的点击行为；高级设置展开状态应继续由页面持有。 */
  toggleAdvancedSettings: () => void;
}

export interface GraphwarDebugActivationController {
  /** 取消当前长按启用流程。 */
  cancelHold: () => void;
  /** 当前是否已启用调试信息。 */
  debugInfoEnabled: Ref<boolean>;
  /** 清理长按和成功闪烁定时器。 */
  dispose: () => void;
  /** 结束当前长按启用流程，短按时触发普通设置展开。 */
  finishHold: () => void;
  /** 调试长按倒计时剩余毫秒；undefined 表示尚不展示倒计时。 */
  remainingMs: Ref<number | undefined>;
  /** 开始长按启用流程。 */
  startHold: (event: PointerEvent) => void;
  /** 是否展示调试启用成功反馈。 */
  successVisible: Ref<boolean>;
}

/** 管理调试入口的长按状态、倒计时和成功闪烁；页面只负责展示文案和高级设置展开状态。 */
export function useGraphwarDebugActivation(options: GraphwarDebugActivationOptions): GraphwarDebugActivationController {
  const debugInfoEnabled = ref(false);
  const remainingMs = ref<number>();
  const successVisible = ref(false);
  let countdownTimer: ReturnType<typeof setInterval> | undefined;
  let startedAt: number | undefined;
  let successTimer: ReturnType<typeof setTimeout> | undefined;
  let activationTimer: ReturnType<typeof setTimeout> | undefined;
  let triggered = false;

  /** 通过长按高级设置入口启用调试信息，避免普通用户误触。 */
  function startHold(event: PointerEvent) {
    if (event.button !== 0) {
      return;
    }
    if (debugInfoEnabled.value) {
      options.toggleAdvancedSettings();
      return;
    }

    clearHold();
    clearSuccessFlash();
    triggered = false;
    startedAt = nowMs();
    updateCountdown();
    countdownTimer = setInterval(updateCountdown, debugActivationCountdownStepMs);
    activationTimer = setTimeout(() => {
      triggered = true;
      debugInfoEnabled.value = true;
      clearHold();
      flashSuccess();
    }, debugActivationHoldMs);
  }

  /** 结束调试入口长按；未触发调试时保留普通点击展开设置。 */
  function finishHold() {
    const shouldToggleAdvancedSettings = !debugInfoEnabled.value && !triggered && startedAt !== undefined;
    clearHold();
    if (shouldToggleAdvancedSettings) {
      options.toggleAdvancedSettings();
    }
    triggered = false;
  }

  /** 鼠标移出或取消时终止调试长按流程。 */
  function cancelHold() {
    clearHold();
    triggered = false;
  }

  /** 清理长按和成功闪烁定时器，应在页面卸载时调用。 */
  function dispose() {
    clearHold();
    clearSuccessFlash();
  }

  /** 清理调试长按的定时器和倒计时状态。 */
  function clearHold() {
    if (activationTimer) {
      clearTimeout(activationTimer);
      activationTimer = undefined;
    }
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = undefined;
    }
    startedAt = undefined;
    remainingMs.value = undefined;
  }

  /** 更新调试长按倒计时，只在长按超过提示阈值后显示。 */
  function updateCountdown() {
    if (startedAt === undefined) {
      return;
    }

    const elapsedMs = nowMs() - startedAt;
    remainingMs.value =
      elapsedMs < debugActivationCountdownVisibleAfterMs ? undefined : Math.max(0, debugActivationHoldMs - elapsedMs);
  }

  /** 短暂显示调试模式已启用的成功反馈。 */
  function flashSuccess() {
    successVisible.value = true;
    if (successTimer) {
      clearTimeout(successTimer);
    }
    successTimer = setTimeout(() => {
      successVisible.value = false;
      successTimer = undefined;
    }, debugActivationSuccessFlashMs);
  }

  /** 清理调试启用成功闪烁，防止卸载或重新长按后残留。 */
  function clearSuccessFlash() {
    successVisible.value = false;
    if (!successTimer) {
      return;
    }

    clearTimeout(successTimer);
    successTimer = undefined;
  }

  return {
    cancelHold,
    debugInfoEnabled,
    dispose,
    finishHold,
    remainingMs,
    startHold,
    successVisible,
  };
}

/** 获取高精度时间戳，用于长按判定。 */
function nowMs() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
