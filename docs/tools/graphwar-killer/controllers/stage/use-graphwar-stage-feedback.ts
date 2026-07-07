import { ref, type Ref } from "vue";

import type { GraphwarDetectionBox } from "../../detection/objects";

const graphwarStageFeedbackFlashMs = 1600;

export interface GraphwarStageFeedbackController {
  /** 边界框是否处于短暂高亮状态。 */
  boundsFlashActive: Ref<boolean>;
  /** 清理士兵识别闪烁动画，避免下一次检测继承旧动画状态。 */
  clearDetectionSoldierFlash: () => void;
  /** 清理一键清图命中闪烁，避免旧结果在下一次操作后继续提示。 */
  clearOneClickClearHitFlash: () => void;
  /** 当前识别结果是否处于士兵标记闪烁状态。 */
  detectionSoldierFlashActive: Ref<boolean>;
  /** 清理舞台反馈持有的帧任务和定时器。 */
  dispose: () => void;
  /** 触发一次短暂边界高亮，帮助用户确认自动识别或手动框选结果。 */
  flashBoundsRect: () => void;
  /** 在检测完成后触发一次士兵标记闪烁，帮助用户定位识别结果。 */
  flashDetectedSoldiers: () => void;
  /** 一键清图完成后只高亮结果里的命中士兵，和全量识别闪烁区分开。 */
  flashOneClickClearHitSoldiers: (targetIds: readonly string[]) => void;
  /** 一键清图命中士兵是否处于闪烁状态。 */
  oneClickClearHitFlashActive: Ref<boolean>;
  /** 本次一键清图需要高亮的命中士兵。 */
  oneClickClearHitFlashSoldiers: Ref<GraphwarDetectionBox[]>;
}

/** 管理舞台短反馈状态；触发时机和检测结果语义仍应由页面工作流持有。 */
export function useGraphwarStageFeedback(
  detectedSoldiers: Ref<GraphwarDetectionBox[]>,
): GraphwarStageFeedbackController {
  const boundsFlashActive = ref(false);
  const detectionSoldierFlashActive = ref(false);
  const oneClickClearHitFlashActive = ref(false);
  const oneClickClearHitFlashSoldiers = ref<GraphwarDetectionBox[]>([]);
  let boundsFlashFrame: number | undefined;
  let boundsFlashTimer: ReturnType<typeof setTimeout> | undefined;
  let detectionSoldierFlashFrame: number | undefined;
  let detectionSoldierFlashTimer: ReturnType<typeof setTimeout> | undefined;
  let oneClickClearHitFlashFrame: number | undefined;
  let oneClickClearHitFlashTimer: ReturnType<typeof setTimeout> | undefined;

  /** 清理士兵识别闪烁动画，避免下一次检测继承旧动画状态。 */
  function clearDetectionSoldierFlash() {
    detectionSoldierFlashActive.value = false;
    if (detectionSoldierFlashFrame !== undefined) {
      cancelAnimationFrame(detectionSoldierFlashFrame);
      detectionSoldierFlashFrame = undefined;
    }
    if (detectionSoldierFlashTimer) {
      clearTimeout(detectionSoldierFlashTimer);
      detectionSoldierFlashTimer = undefined;
    }
  }

  /** 在检测完成后触发一次士兵标记闪烁，帮助用户定位识别结果。 */
  function flashDetectedSoldiers() {
    clearDetectionSoldierFlash();
    if (detectedSoldiers.value.length === 0) {
      return;
    }

    detectionSoldierFlashFrame = requestAnimationFrame(() => {
      detectionSoldierFlashFrame = undefined;
      detectionSoldierFlashActive.value = true;
      detectionSoldierFlashTimer = setTimeout(() => {
        detectionSoldierFlashActive.value = false;
        detectionSoldierFlashTimer = undefined;
      }, graphwarStageFeedbackFlashMs);
    });
  }

  /** 清理一键清图命中闪烁，避免旧结果在下一次操作后继续提示。 */
  function clearOneClickClearHitFlash() {
    oneClickClearHitFlashActive.value = false;
    oneClickClearHitFlashSoldiers.value = [];
    if (oneClickClearHitFlashFrame !== undefined) {
      cancelAnimationFrame(oneClickClearHitFlashFrame);
      oneClickClearHitFlashFrame = undefined;
    }
    if (oneClickClearHitFlashTimer) {
      clearTimeout(oneClickClearHitFlashTimer);
      oneClickClearHitFlashTimer = undefined;
    }
  }

  /** 一键清图完成后只高亮结果里的命中士兵，和全量识别闪烁区分开。 */
  function flashOneClickClearHitSoldiers(targetIds: readonly string[]) {
    clearOneClickClearHitFlash();
    const targetIdSet = new Set(targetIds);
    oneClickClearHitFlashSoldiers.value = detectedSoldiers.value.filter((soldier) => targetIdSet.has(soldier.id));
    if (oneClickClearHitFlashSoldiers.value.length === 0) {
      return;
    }

    oneClickClearHitFlashFrame = requestAnimationFrame(() => {
      oneClickClearHitFlashFrame = undefined;
      oneClickClearHitFlashActive.value = true;
      oneClickClearHitFlashTimer = setTimeout(() => {
        oneClickClearHitFlashActive.value = false;
        oneClickClearHitFlashTimer = undefined;
      }, graphwarStageFeedbackFlashMs);
    });
  }

  /** 触发一次短暂边界高亮，帮助用户确认自动识别或手动框选结果。 */
  function flashBoundsRect() {
    boundsFlashActive.value = false;
    if (boundsFlashFrame !== undefined) {
      cancelAnimationFrame(boundsFlashFrame);
    }
    if (boundsFlashTimer) {
      clearTimeout(boundsFlashTimer);
    }

    boundsFlashFrame = requestAnimationFrame(() => {
      boundsFlashFrame = undefined;
      boundsFlashActive.value = true;
      boundsFlashTimer = setTimeout(() => {
        boundsFlashActive.value = false;
        boundsFlashTimer = undefined;
      }, graphwarStageFeedbackFlashMs);
    });
  }

  /** 清理边界高亮任务，页面卸载后不应再回写状态。 */
  function clearBoundsFlash() {
    boundsFlashActive.value = false;
    if (boundsFlashFrame !== undefined) {
      cancelAnimationFrame(boundsFlashFrame);
      boundsFlashFrame = undefined;
    }
    if (boundsFlashTimer) {
      clearTimeout(boundsFlashTimer);
      boundsFlashTimer = undefined;
    }
  }

  /** 页面卸载时清理所有舞台反馈任务。 */
  function dispose() {
    clearBoundsFlash();
    clearDetectionSoldierFlash();
    clearOneClickClearHitFlash();
  }

  return {
    boundsFlashActive,
    clearDetectionSoldierFlash,
    clearOneClickClearHitFlash,
    detectionSoldierFlashActive,
    dispose,
    flashBoundsRect,
    flashDetectedSoldiers,
    flashOneClickClearHitSoldiers,
    oneClickClearHitFlashActive,
    oneClickClearHitFlashSoldiers,
  };
}
