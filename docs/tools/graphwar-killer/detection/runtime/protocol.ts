import { isGraphwarBackendAttemptIdentity } from "../../core/algorithm-backend";
import type { GraphwarBackendAttemptIdentity } from "../../core/algorithm-backend";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import type { BoundsRect } from "../../core/types";
/** Web Worker 和主线程之间传递 Graphwar 截图识别任务的协议类型。 */
import type {
  GraphwarObjectsDetectionResult,
  GraphwarObstacleDetectionThresholds,
  GraphwarSoldierDetectionSettings,
} from "../objects";

/** Worker 内部识别阶段；主线程负责映射成本地化状态文本。 */
export type GraphwarDetectionWorkerStage =
  | "building-obstacle-mask"
  | "collecting-soldier-candidates"
  | "detecting-bounds"
  | "detecting-objects"
  | "filtering-obstacle-components"
  | "matching-soldier-templates";

/** Worker 内部精确测量的识别阶段耗时。 */
export interface GraphwarDetectionWorkerTimingEntry {
  /** 被测量的识别阶段。 */
  stage: GraphwarDetectionWorkerStage;
  /** 阶段耗时，单位毫秒。 */
  elapsedMs: number;
  /** 细分耗时展示文案 key；存在时页面会显示为主阶段下的子项。 */
  detail?: GraphwarDetectionWorkerTimingDetail;
}

/** 模板匹配阶段的细分耗时和执行模式，供调试面板解释并行/fallback 行为。 */
export type GraphwarDetectionWorkerTimingDetail =
  | { type: "template-matching-mode"; mode: "serial"; workerCount: number }
  | { type: "template-matching-mode"; mode: "parallel"; workerCount: number }
  | { type: "template-matching-mode"; mode: "parallel-fallback"; workerCount: number }
  | { type: "template-matching-dispatch" }
  | { type: "template-matching-worker"; workerIndex: number }
  | { type: "template-matching-serial" }
  | { type: "template-matching-fallback-serial" }
  | { type: "template-matching-merge" };

/** 自动识别坐标系边界并识别对象。 */
export interface GraphwarAutoDetectionInput {
  /** 当前截图像素。 */
  imageData: ImageData;
  /** 障碍识别阈值。 */
  thresholds: GraphwarObstacleDetectionThresholds;
  /** 士兵识别设定。 */
  soldierSettings?: GraphwarSoldierDetectionSettings;
}

/** 只识别坐标系边界；不读取士兵和障碍设置，避免边界按钮被对象识别参数阻塞。 */
export interface GraphwarBoundsOnlyDetectionInput {
  /** 当前截图像素。 */
  imageData: ImageData;
}

/** 在指定坐标系边界内识别对象。 */
export interface GraphwarBoundsDetectionInput extends GraphwarAutoDetectionInput {
  /** 已确定的坐标系边界。 */
  edgeRect: BoundsRect;
}

/** 自动识别任务的互斥结果；对象只会与已识别的坐标系边界一同存在。 */
export type GraphwarAutoDetectionResult =
  | {
      /** Undefined 明确表示未识别到坐标系边界。 */
      edgeRect: undefined;
    }
  | {
      /** 自动推断出的坐标系边界。 */
      edgeRect: BoundsRect;
      /** 在同一坐标系边界内识别到的对象。 */
      objects: GraphwarObjectsDetectionResult;
    };

/** 只识别坐标系边界的结果；undefined 表示未识别到坐标系边界。 */
export interface GraphwarBoundsOnlyDetectionResult {
  /** 自动推断出的坐标系边界；undefined 表示未识别到坐标系边界。 */
  edgeRect?: BoundsRect;
}

/** Worker 可执行的识别任务：完整自动识别、仅识别边界，或在已有边界内识别对象。 */
export type GraphwarDetectionWorkerTask =
  | ({
      type: "detect-auto";
    } & GraphwarAutoDetectionInput)
  | ({
      type: "detect-bounds-only";
    } & GraphwarBoundsOnlyDetectionInput)
  | ({
      type: "detect-bounds";
    } & GraphwarBoundsDetectionInput);

/** 主线程发给 Worker 的一次识别请求。 */
export interface GraphwarDetectionWorkerRequest {
  /** 当前 outer task 中唯一可提交的 backend attempt。 */
  attempt: GraphwarBackendAttemptIdentity;
  /** 单调递增请求 id，用于忽略过期 Worker 响应。 */
  id: number;
  /** 具体检测任务。 */
  task: GraphwarDetectionWorkerTask;
}

/** Worker 完成识别后的成功响应；结果类型由 taskType 区分。 */
export type GraphwarDetectionWorkerSuccessResponse =
  | {
      attempt: GraphwarBackendAttemptIdentity;
      id: number;
      result: GraphwarAutoDetectionResult;
      taskType: "detect-auto";
      timings: readonly GraphwarDetectionWorkerTimingEntry[];
      type: "success";
    }
  | {
      attempt: GraphwarBackendAttemptIdentity;
      id: number;
      result: GraphwarBoundsOnlyDetectionResult;
      taskType: "detect-bounds-only";
      timings: readonly GraphwarDetectionWorkerTimingEntry[];
      type: "success";
    }
  | {
      attempt: GraphwarBackendAttemptIdentity;
      id: number;
      result: GraphwarObjectsDetectionResult;
      taskType: "detect-bounds";
      timings: readonly GraphwarDetectionWorkerTimingEntry[];
      type: "success";
    };

/** Worker 发回主线程的完整响应集合，包含阶段通知、成功和错误。 */
export type GraphwarDetectionWorkerResponse =
  | GraphwarDetectionWorkerSuccessResponse
  | {
      attempt: GraphwarBackendAttemptIdentity;
      id: number;
      message: string;
      type: "error";
    }
  | {
      attempt: GraphwarBackendAttemptIdentity;
      id: number;
      stage: GraphwarDetectionWorkerStage;
      type: "stage";
    };

/** 在 Worker 入口验证页面发来的完整 detection request envelope。 */
export function isGraphwarDetectionWorkerRequest(value: unknown): value is GraphwarDetectionWorkerRequest {
  if (!isRecord(value) || !isGraphwarBackendAttemptIdentity(value.attempt) || !isRequestId(value.id)) {
    return false;
  }
  const task = value.task;
  if (!isRecord(task) || !isImageDataLike(task.imageData)) {
    return false;
  }
  if (task.type === "detect-bounds-only") {
    return true;
  }
  if (task.type !== "detect-auto" && task.type !== "detect-bounds") {
    return false;
  }
  if (!isObstacleThresholds(task.thresholds) || !isSoldierSettings(task.soldierSettings)) {
    return false;
  }
  return task.type === "detect-auto" || isBoundsRect(task.edgeRect);
}

/** 在页面入口验证 detection Worker 返回的 attempt envelope 和可提交 payload 外形。 */
export function isGraphwarDetectionWorkerResponse(value: unknown): value is GraphwarDetectionWorkerResponse {
  if (!isRecord(value) || !isGraphwarBackendAttemptIdentity(value.attempt) || !isRequestId(value.id)) {
    return false;
  }
  if (value.type === "stage") {
    return isGraphwarDetectionWorkerStage(value.stage);
  }
  if (value.type === "error") {
    return typeof value.message === "string";
  }
  if (value.type !== "success" || !Array.isArray(value.timings) || !value.timings.every(isTimingEntry)) {
    return false;
  }
  if (value.taskType === "detect-auto") {
    return isAutoDetectionResult(value.result);
  }
  if (value.taskType === "detect-bounds-only") {
    return isBoundsOnlyDetectionResult(value.result);
  }
  return value.taskType === "detect-bounds" && isObjectsDetectionResult(value.result);
}

function isGraphwarDetectionWorkerStage(value: unknown): value is GraphwarDetectionWorkerStage {
  return (
    value === "building-obstacle-mask" ||
    value === "collecting-soldier-candidates" ||
    value === "detecting-bounds" ||
    value === "detecting-objects" ||
    value === "filtering-obstacle-components" ||
    value === "matching-soldier-templates"
  );
}

function isTimingEntry(value: unknown): value is GraphwarDetectionWorkerTimingEntry {
  return (
    isRecord(value) &&
    isGraphwarDetectionWorkerStage(value.stage) &&
    typeof value.elapsedMs === "number" &&
    Number.isFinite(value.elapsedMs) &&
    value.elapsedMs >= 0 &&
    (value.detail === undefined || isGraphwarDetectionWorkerTimingDetail(value.detail))
  );
}

function isAutoDetectionResult(value: unknown): value is GraphwarAutoDetectionResult {
  if (!isRecord(value)) {
    return false;
  }
  if (value.edgeRect === undefined) {
    return value.objects === undefined;
  }
  return isBoundsRect(value.edgeRect) && isObjectsDetectionResult(value.objects);
}

function isBoundsOnlyDetectionResult(value: unknown): value is GraphwarBoundsOnlyDetectionResult {
  return isRecord(value) && (value.edgeRect === undefined || isBoundsRect(value.edgeRect));
}

function isObjectsDetectionResult(value: unknown): value is GraphwarObjectsDetectionResult {
  return (
    isRecord(value) &&
    isObstacleMap(value.obstacles) &&
    Array.isArray(value.soldiers) &&
    value.soldiers.every(isDetectionBox) &&
    (value.warnings === undefined ||
      (Array.isArray(value.warnings) &&
        value.warnings.every(
          (warning) =>
            isRecord(warning) &&
            warning.code === "template-matching-worker-fallback" &&
            typeof warning.message === "string",
        )))
  );
}

function isObstacleMap(value: unknown) {
  if (!isRecord(value) || !(value.mask instanceof Uint8Array) || !isNonNegativeSafeInteger(value.count)) {
    return false;
  }
  return value.mask.length === GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT && value.count <= value.mask.length;
}

function isDetectionBox(value: unknown) {
  if (!isRecord(value) || !isBoundsRect(value)) {
    return false;
  }
  return (
    isFiniteNumber(value.sourceCenterX) &&
    isFiniteNumber(value.sourceCenterY) &&
    isFiniteNumber(value.visualCenterX) &&
    isFiniteNumber(value.visualCenterY) &&
    isNonNegativeFiniteNumber(value.hitRadius) &&
    isNonNegativeFiniteNumber(value.visualRadius) &&
    isNonNegativeFiniteNumber(value.selectionRadius) &&
    typeof value.templateName === "string" &&
    value.templateName.length > 0 &&
    typeof value.isMirrored === "boolean" &&
    isNonNegativeFiniteNumber(value.confidence) &&
    value.confidence <= 1 &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.kind === "soldier"
  );
}

function isGraphwarDetectionWorkerTimingDetail(value: unknown): value is GraphwarDetectionWorkerTimingDetail {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }
  if (value.type === "template-matching-mode") {
    return (
      (value.mode === "serial" || value.mode === "parallel" || value.mode === "parallel-fallback") &&
      isPositiveSafeInteger(value.workerCount)
    );
  }
  if (value.type === "template-matching-worker") {
    return isPositiveSafeInteger(value.workerIndex);
  }
  return (
    value.type === "template-matching-dispatch" ||
    value.type === "template-matching-serial" ||
    value.type === "template-matching-fallback-serial" ||
    value.type === "template-matching-merge"
  );
}

function isImageDataLike(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }
  const width = value.width;
  const height = value.height;
  if (!isPositiveSafeInteger(width) || !isPositiveSafeInteger(height)) {
    return false;
  }
  return value.data instanceof Uint8ClampedArray && value.data.length === width * height * 4;
}

function isObstacleThresholds(value: unknown) {
  return isRecord(value) && isNonNegativeFiniteNumber(value.minArea);
}

function isSoldierSettings(value: unknown) {
  return (
    value === undefined ||
    (isRecord(value) &&
      isNonNegativeFiniteNumber(value.candidateTopRatio) &&
      value.candidateTopRatio > 0 &&
      value.candidateTopRatio <= 1 &&
      isPositiveSafeInteger(value.maximumSoldierCount) &&
      isPositiveSafeInteger(value.templateMatchingWorkerCount))
  );
}

function isBoundsRect(value: unknown): value is BoundsRect {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    value.width > 0 &&
    isFiniteNumber(value.height) &&
    value.height > 0
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isRequestId(value: unknown) {
  return isPositiveSafeInteger(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
