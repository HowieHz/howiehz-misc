import { nextTick, ref, type Ref } from "vue";

import { nowMs } from "../../core/time";
import type { BoundsRect } from "../../core/types";
import type { GraphwarDetectionBox, GraphwarObjectsDetectionResult } from "../../detection/objects";
import {
  createGraphwarDetectionRunner,
  isGraphwarDetectionCancelledError,
  type GraphwarDetectionWorkerStage,
  type GraphwarDetectionWorkerTimingEntry,
} from "../../detection/runtime/runner";
import type { GraphwarKillerLocale } from "../../locale-types";
import type { DetectionDebugTimingEntry } from "../debug/timings";

const graphwarDetectionRefreshDelayMs = 180;

/** 识别状态等级，与面板标题和智能寻路状态样式对齐。 */
export type DetectionStatusKind = "info" | "success" | "warning" | "error";
/** 检测运行来源；自动识别开关只应控制 auto 来源，不应取消用户手动点击的识别。 */
export type GraphwarDetectionRunTrigger = "auto" | "manual";

type GraphwarDetectionSettingsResult =
  | {
      ok: true;
      candidateTopRatio: number;
      maximumSoldierCount: number;
      minArea: number;
      templateMatchingWorkerCount: number;
    }
  | { ok: false; message: string };

interface GraphwarDetectionWorkflowOptions {
  /** 调试计时应复用页面现有聚合规则，避免检测 Module 关心展示行。 */
  debug: {
    createTimingEntriesFromWorker: (
      timings: readonly GraphwarDetectionWorkerTimingEntry[],
    ) => DetectionDebugTimingEntry[];
    finishTimings: (
      runId: number,
      startedAt: number,
      timings: readonly DetectionDebugTimingEntry[],
      completedAt?: number,
    ) => void;
    measureStage: <TResult>(
      timings: DetectionDebugTimingEntry[],
      stage: DetectionDebugTimingEntry["stage"],
      task: () => TResult,
    ) => TResult;
  };
  /** 检测结果落地会影响路径缓存、障碍、舞台反馈和悬停状态；这些副作用仍由页面定义。 */
  effects: {
    applyDetectedObstacles: (obstacles: GraphwarObjectsDetectionResult["obstacles"]) => void;
    clearDetectedObjectSideEffects: () => void;
    clearSmartPathfindingStatus: () => void;
    flashBoundsRect: () => void;
    flashDetectedSoldiers: () => void;
    invalidatePathfindingCaches: () => void;
    applyDetectedBounds: (bounds: BoundsRect) => void;
    onSmartCursorDisabled: () => void;
    setToolModeToPath: () => void;
  };
  /** 截图和像素读取应继续由截图 workflow 持有。 */
  image: {
    /** 延迟自动识别只需要已有图片 URL；像素读取失败应在实际运行时展示错误。 */
    canSchedule: () => boolean;
    getImageData: () => ImageData | undefined;
    isReady: () => boolean;
  };
  /** 检测成功文案应复用页面统一耗时格式。 */
  formatElapsedDuration: (elapsedMs: number) => string;
  /** 本地化文案由页面传入，保证与面板当前 locale 同步。 */
  getLocale: () => GraphwarKillerLocale;
  /** 当前检测输入设置；无效输入应阻止 worker 运行并展示原校验文案。 */
  getSettings: () => GraphwarDetectionSettingsResult;
  /** 当前截图边界是否已经由用户框选或识别确认。 */
  hasActiveBounds: () => boolean;
  /** 手动或自动边界内对象识别应使用页面当前标定矩形。 */
  boundsRect: Ref<BoundsRect>;
  /** 识别结果仍由页面持有，供舞台、寻路和目标过滤共享。 */
  detectedSoldiers: Ref<GraphwarDetectionBox[]>;
}

export interface GraphwarDetectionWorkflowController {
  /** 自动识别开关；关闭后保留当前识别结果供用户继续编辑。 */
  autoDetectionEnabled: Ref<boolean>;
  /** 取消当前检测任务，并按调用场景决定是否显示取消提示。 */
  cancel: (showStatus: boolean) => boolean;
  /** 清除检测运行、状态和识别对象。 */
  clear: () => void;
  /** 页面卸载时释放检测 Worker 和延迟任务。 */
  dispose: () => void;
  /** 从外部精确数据源写入边界、士兵和障碍结果。 */
  applyExternalResult: (bounds: BoundsRect, result: GraphwarObjectsDetectionResult, statusMessage: string) => void;
  /** 使用 Canvas 像素自动检测 Graphwar 坐标系边界，再按该边界识别士兵和障碍。 */
  detect: (trigger?: GraphwarDetectionRunTrigger) => Promise<void>;
  /** 使用 Canvas 像素只识别 Graphwar 坐标系边界，并清除旧对象结果。 */
  detectBounds: (trigger?: GraphwarDetectionRunTrigger) => Promise<void>;
  /** 在当前手动/自动边界内重新识别对象，不重新推断坐标系区域。 */
  detectInCurrentBounds: (trigger?: GraphwarDetectionRunTrigger) => Promise<void>;
  /** 检测任务是否正在运行。 */
  inProgress: Ref<boolean>;
  /** 判断异步检测回调是否仍属于当前运行。 */
  isActiveRun: (runId: number) => boolean;
  /** 延迟重新识别，合并连续设置变化，避免每次输入都立即读像素。 */
  schedule: () => void;
  /** 设置检测状态主文案，并清掉上一轮警告详情。 */
  setStatus: (message: string, kind: DetectionStatusKind) => void;
  /** 智能光标开关；关闭时应清掉士兵悬停。 */
  smartCursorEnabled: Ref<boolean>;
  /** 检测状态主文案。 */
  status: Ref<string>;
  /** 检测状态等级。 */
  statusKind: Ref<DetectionStatusKind>;
  /** 检测非致命警告详情。 */
  statusWarningTitle: Ref<string>;
  /** 检测非致命警告文案。 */
  statusWarning: Ref<string>;
  /** 切换自动识别。 */
  toggleAutoDetection: () => void;
  /** 切换智能光标。 */
  toggleSmartCursor: () => void;
}

/** 管理 Graphwar 截图识别的运行状态、debounce、Worker 调度和结果落地。 */
export function useGraphwarDetectionWorkflow(
  options: GraphwarDetectionWorkflowOptions,
): GraphwarDetectionWorkflowController {
  const detectionRunner = createGraphwarDetectionRunner();
  const status = ref("");
  const statusKind = ref<DetectionStatusKind>("info");
  const statusWarning = ref("");
  const statusWarningTitle = ref("");
  const inProgress = ref(false);
  const autoDetectionEnabled = ref(true);
  const smartCursorEnabled = ref(true);
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let activeRunTrigger: GraphwarDetectionRunTrigger | undefined;
  let runId = 0;

  /** 取消尚未开始的自动重识别，避免关闭开关后仍执行晚到任务。 */
  function clearScheduledDetection() {
    if (!refreshTimer) {
      return;
    }

    clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }

  /** 清除检测运行、状态和识别对象。 */
  function clear() {
    clearScheduledDetection();
    if (!stopActiveRun()) {
      runId += 1;
      activeRunTrigger = undefined;
    }
    setStatus("", "info");
    clearDetectedObjects();
  }

  /** 清除识别对象和依赖缓存，并保留检测状态文字。 */
  function clearDetectedObjects() {
    options.effects.invalidatePathfindingCaches();
    options.detectedSoldiers.value = [];
    options.effects.clearDetectedObjectSideEffects();
    options.effects.clearSmartPathfindingStatus();
  }

  /** 从 Agent 等精确外部来源写入结果，复用检测完成后的缓存和舞台副作用。 */
  function applyExternalResult(bounds: BoundsRect, result: GraphwarObjectsDetectionResult, statusMessage: string) {
    clearScheduledDetection();
    if (!stopActiveRun()) {
      runId += 1;
      activeRunTrigger = undefined;
    }

    options.effects.clearSmartPathfindingStatus();
    options.effects.applyDetectedBounds(bounds);
    options.effects.invalidatePathfindingCaches();
    options.detectedSoldiers.value = result.soldiers;
    options.effects.flashBoundsRect();
    options.effects.flashDetectedSoldiers();
    options.effects.applyDetectedObstacles(result.obstacles);
    setStatus(statusMessage, "success");
  }

  /** 开始一次新的检测运行，并让旧异步响应自动失效。 */
  function beginRun(trigger: GraphwarDetectionRunTrigger) {
    clearScheduledDetection();
    runId += 1;
    activeRunTrigger = trigger;
    inProgress.value = true;
    return runId;
  }

  /** 判断异步检测回调是否仍属于当前运行。 */
  function isActiveRun(activeRunId: number) {
    return activeRunId === runId;
  }

  /** 只结束当前检测运行，避免旧任务覆盖新任务状态。 */
  function finishRun(activeRunId: number) {
    if (isActiveRun(activeRunId)) {
      inProgress.value = false;
      activeRunTrigger = undefined;
    }
  }

  /** 终止已经开始的检测任务；调用方决定是否展示取消文案。 */
  function stopActiveRun() {
    if (!inProgress.value) {
      return false;
    }

    runId += 1;
    detectionRunner.cancel();
    inProgress.value = false;
    activeRunTrigger = undefined;
    return true;
  }

  /** 取消当前检测任务，并按调用场景决定是否显示取消提示。 */
  function cancel(showStatus: boolean) {
    clearScheduledDetection();
    if (!stopActiveRun()) {
      return false;
    }

    if (showStatus) {
      setStatus(options.getLocale().status.detection.cancelled, "warning");
    }
    return true;
  }

  /** 设置检测状态主文案，并清掉上一轮警告详情。 */
  function setStatus(message: string, kind: DetectionStatusKind) {
    status.value = message;
    statusKind.value = kind;
    statusWarning.value = "";
    statusWarningTitle.value = "";
  }

  /** 将 Worker fallback 等非致命警告附加到检测状态上。 */
  function setStatusWarnings(warnings: NonNullable<GraphwarObjectsDetectionResult["warnings"]> | undefined) {
    if (!warnings?.length) {
      return;
    }

    const locale = options.getLocale();
    statusWarning.value = locale.status.detection.partialWarning;
    statusWarningTitle.value = warnings.map((warning) => locale.status.detection.warningTitle(warning)).join("\n");
  }

  /** 等待检测状态渲染到页面，让长耗时阶段前用户能看到进度。 */
  function waitForStatusPaint() {
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  /** 展示检测阶段状态，并在绘制后确认任务仍然有效。 */
  async function showStage(activeRunId: number, message: string) {
    if (!isActiveRun(activeRunId)) {
      return false;
    }
    setStatus(`${message}${options.getLocale().status.detection.stopSuffix}`, "warning");
    await nextTick();
    await waitForStatusPaint();
    return isActiveRun(activeRunId);
  }

  /** 延迟重新识别，合并连续设置变化，避免每次输入都立即读像素。 */
  function schedule() {
    if (!options.image.canSchedule() || !autoDetectionEnabled.value || !options.hasActiveBounds()) {
      clearScheduledDetection();
      return;
    }
    clearScheduledDetection();
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      if (!options.image.canSchedule() || !autoDetectionEnabled.value || !options.hasActiveBounds()) {
        return;
      }

      void detectInCurrentBounds("auto");
    }, graphwarDetectionRefreshDelayMs);
  }

  /** 收敛截图读取和像素读取；边界识别不应被对象识别设置阻塞。 */
  function getBoundsDetectionInput(timings: DetectionDebugTimingEntry[]) {
    const locale = options.getLocale();
    if (!options.image.isReady()) {
      setStatus(locale.status.detection.uploadFirst, "error");
      return undefined;
    }

    const imageData = options.debug.measureStage(timings, "preparing-pixels", () => options.image.getImageData());
    if (!imageData) {
      setStatus(locale.status.detection.noPixels, "error");
      return undefined;
    }
    return { imageData };
  }

  /** 收敛对象识别设置校验；后续检测入口只处理识别策略。 */
  function getDetectionInput(timings: DetectionDebugTimingEntry[]) {
    const boundsInput = getBoundsDetectionInput(timings);
    if (!boundsInput) {
      return undefined;
    }

    const detectionSettings = options.getSettings();
    if (!detectionSettings.ok) {
      setStatus(detectionSettings.message, "error");
      return undefined;
    }
    return {
      imageData: boundsInput.imageData,
      soldierSettings: {
        candidateTopRatio: detectionSettings.candidateTopRatio,
        maximumSoldierCount: detectionSettings.maximumSoldierCount,
        templateMatchingWorkerCount: detectionSettings.templateMatchingWorkerCount,
      },
      thresholds: {
        minArea: detectionSettings.minArea,
      },
    };
  }

  /** 使用 Canvas 像素只识别 Graphwar 坐标系边界。 */
  async function detectBounds(trigger: GraphwarDetectionRunTrigger = "manual") {
    const activeRunId = beginRun(trigger);
    const startedAt = nowMs();
    const timings: DetectionDebugTimingEntry[] = [];
    let debugTimingsFinalized = false;
    try {
      if (!(await showStage(activeRunId, options.getLocale().status.detection.preparingPixels))) {
        return;
      }
      const detectionInput = getBoundsDetectionInput(timings);
      if (!detectionInput || !isActiveRun(activeRunId)) {
        return;
      }

      const result = await detectionRunner.detectBounds(
        { imageData: detectionInput.imageData },
        {
          onStage: (stage) => {
            void showWorkerStage(activeRunId, stage);
          },
          onTimings: (workerTimings) => {
            timings.push(...options.debug.createTimingEntriesFromWorker(workerTimings));
          },
        },
      );
      if (!isActiveRun(activeRunId)) {
        return;
      }
      if (!result.edgeRect) {
        clearDetectedObjects();
        setStatus(options.getLocale().status.detection.noBounds, "error");
        return;
      }

      await applyBoundsResult(result.edgeRect, activeRunId, startedAt, timings);
      debugTimingsFinalized = true;
      if (!isActiveRun(activeRunId)) {
        return;
      }
      options.effects.setToolModeToPath();
    } catch (error) {
      handleError(error, activeRunId);
    } finally {
      if (!debugTimingsFinalized) {
        options.debug.finishTimings(activeRunId, startedAt, timings);
      }
      finishRun(activeRunId);
    }
  }

  /** 使用 Canvas 像素自动检测 Graphwar 坐标系边界，再按该边界识别士兵和障碍。 */
  async function detect(trigger: GraphwarDetectionRunTrigger = "manual") {
    const activeRunId = beginRun(trigger);
    const startedAt = nowMs();
    const timings: DetectionDebugTimingEntry[] = [];
    let debugTimingsFinalized = false;
    try {
      if (!(await showStage(activeRunId, options.getLocale().status.detection.preparingPixels))) {
        return;
      }
      const detectionInput = getDetectionInput(timings);
      if (!detectionInput || !isActiveRun(activeRunId)) {
        return;
      }

      const result = await detectionRunner.detectAuto(
        {
          imageData: detectionInput.imageData,
          soldierSettings: detectionInput.soldierSettings,
          thresholds: detectionInput.thresholds,
        },
        {
          onStage: (stage) => {
            void showWorkerStage(activeRunId, stage);
          },
          onTimings: (workerTimings) => {
            timings.push(...options.debug.createTimingEntriesFromWorker(workerTimings));
          },
        },
      );
      if (!isActiveRun(activeRunId)) {
        return;
      }
      if (!result.edgeRect || !result.objects) {
        clearDetectedObjects();
        setStatus(options.getLocale().status.detection.noBounds, "error");
        return;
      }

      options.effects.applyDetectedBounds(result.edgeRect);
      await applyResult(result.objects, "auto", activeRunId, true, startedAt, timings);
      debugTimingsFinalized = true;
      if (!isActiveRun(activeRunId)) {
        return;
      }
      options.effects.setToolModeToPath();
    } catch (error) {
      handleError(error, activeRunId);
    } finally {
      if (!debugTimingsFinalized) {
        options.debug.finishTimings(activeRunId, startedAt, timings);
      }
      finishRun(activeRunId);
    }
  }

  /** 在当前手动/自动边界内重新识别对象，不重新推断坐标系区域。 */
  async function detectInCurrentBounds(trigger: GraphwarDetectionRunTrigger = "manual") {
    if (!options.hasActiveBounds()) {
      if (trigger === "manual") {
        setStatus(options.getLocale().status.detection.needBounds, "error");
      }
      return;
    }

    const activeRunId = beginRun(trigger);
    const startedAt = nowMs();
    const timings: DetectionDebugTimingEntry[] = [];
    let debugTimingsFinalized = false;
    try {
      if (!(await showStage(activeRunId, options.getLocale().status.detection.preparingPixels))) {
        return;
      }
      const detectionInput = getDetectionInput(timings);
      if (!detectionInput || !isActiveRun(activeRunId)) {
        return;
      }

      const result = await detectionRunner.detectObjectsInBounds(
        {
          edgeRect: options.boundsRect.value,
          imageData: detectionInput.imageData,
          soldierSettings: detectionInput.soldierSettings,
          thresholds: detectionInput.thresholds,
        },
        {
          onStage: (stage) => {
            void showWorkerStage(activeRunId, stage);
          },
          onTimings: (workerTimings) => {
            timings.push(...options.debug.createTimingEntriesFromWorker(workerTimings));
          },
        },
      );
      await applyResult(result, "current", activeRunId, false, startedAt, timings);
      debugTimingsFinalized = true;
    } catch (error) {
      handleError(error, activeRunId);
    } finally {
      if (!debugTimingsFinalized) {
        options.debug.finishTimings(activeRunId, startedAt, timings);
      }
      finishRun(activeRunId);
    }
  }

  /** 将边界识别结果写回页面，并清掉依赖旧边界的对象结果。 */
  async function applyBoundsResult(
    edgeRect: BoundsRect,
    activeRunId: number,
    startedAt = nowMs(),
    timings: DetectionDebugTimingEntry[] = [],
  ) {
    if (!isActiveRun(activeRunId)) {
      return;
    }
    if (!(await showStage(activeRunId, options.getLocale().status.detection.updatingResults))) {
      return;
    }
    options.debug.measureStage(timings, "updating-results", () => {
      options.effects.applyDetectedBounds(edgeRect);
      clearDetectedObjects();
      options.effects.flashBoundsRect();
    });
    let completedAt = nowMs();
    const elapsed = () => options.formatElapsedDuration(completedAt - startedAt);
    options.debug.measureStage(timings, "setting-status", () => {
      completedAt = nowMs();
      setStatus(options.getLocale().status.detection.detectedBounds(elapsed()), "success");
      completedAt = nowMs();
    });
    options.debug.finishTimings(activeRunId, startedAt, timings, completedAt);
  }

  /** 将 Worker 返回的士兵/障碍识别结果写回页面状态。 */
  async function applyResult(
    result: GraphwarObjectsDetectionResult,
    source: "auto" | "current",
    activeRunId: number,
    flashBounds = false,
    startedAt = nowMs(),
    timings: DetectionDebugTimingEntry[] = [],
  ) {
    options.effects.clearSmartPathfindingStatus();
    if (!isActiveRun(activeRunId)) {
      return;
    }
    if (!(await showStage(activeRunId, options.getLocale().status.detection.updatingResults))) {
      return;
    }
    options.debug.measureStage(timings, "updating-results", () => {
      options.effects.invalidatePathfindingCaches();
      options.detectedSoldiers.value = result.soldiers;
      options.effects.flashDetectedSoldiers();
      if (flashBounds) {
        options.effects.flashBoundsRect();
      }
      options.effects.applyDetectedObstacles(result.obstacles);
    });
    let completedAt = nowMs();
    const elapsed = () => options.formatElapsedDuration(completedAt - startedAt);
    options.debug.measureStage(timings, "setting-status", () => {
      completedAt = nowMs();
      const locale = options.getLocale();
      setStatus(
        source === "auto"
          ? locale.status.detection.detectedWithAutoBounds(options.detectedSoldiers.value.length, elapsed())
          : locale.status.detection.detectedCurrentBounds(options.detectedSoldiers.value.length, elapsed()),
        "success",
      );
      setStatusWarnings(result.warnings);
      completedAt = nowMs();
    });
    options.debug.finishTimings(activeRunId, startedAt, timings, completedAt);
  }

  /** 将 Worker 阶段枚举映射成用户可读的检测进度。 */
  async function showWorkerStage(activeRunId: number, stage: GraphwarDetectionWorkerStage) {
    const locale = options.getLocale();
    const message =
      stage === "detecting-bounds" ? locale.status.detection.detectingBounds : locale.status.detection.detectingObjects;
    await showStage(activeRunId, message);
  }

  /** 只展示当前检测运行的真实错误，忽略取消造成的预期异常。 */
  function handleError(error: unknown, activeRunId: number) {
    if (!isActiveRun(activeRunId) || isGraphwarDetectionCancelledError(error)) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    setStatus(options.getLocale().status.detection.failed(message), "error");
  }

  /** 切换自动识别；关闭后保留当前识别结果供用户继续编辑。 */
  function toggleAutoDetection() {
    autoDetectionEnabled.value = !autoDetectionEnabled.value;
    if (!autoDetectionEnabled.value) {
      clearScheduledDetection();
      if (activeRunTrigger === "auto") {
        stopActiveRun();
      }
    }
  }

  /** 切换智能光标；关闭时清掉士兵悬停，避免残留高亮。 */
  function toggleSmartCursor() {
    smartCursorEnabled.value = !smartCursorEnabled.value;
    if (!smartCursorEnabled.value) {
      options.effects.onSmartCursorDisabled();
    }
  }

  /** 页面卸载时释放检测 Worker 和延迟任务。 */
  function dispose() {
    detectionRunner.close();
    clearScheduledDetection();
  }

  return {
    autoDetectionEnabled,
    cancel,
    clear,
    applyExternalResult,
    detect,
    detectBounds,
    detectInCurrentBounds,
    dispose,
    inProgress,
    isActiveRun,
    schedule,
    setStatus,
    smartCursorEnabled,
    status,
    statusKind,
    statusWarning,
    statusWarningTitle,
    toggleAutoDetection,
    toggleSmartCursor,
  };
}
