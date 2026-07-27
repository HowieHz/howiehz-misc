import {
  graphwarBackendAttemptIdentitiesAreEqual,
  isGraphwarBackendAttemptIdentity,
} from "../../core/algorithm-backend";
import type { GraphwarBackendAttemptIdentity } from "../../core/algorithm-backend";
import type { BoundsRect } from "../../core/types";
import type { SoldierMatchCandidate, SoldierTemplateCenterCandidate } from "../objects";

/** 主 Worker 发给士兵模板匹配子 Worker 的评分请求。 */
export interface GraphwarSoldierTemplateWorkerRequest {
  /** 与 parent detection task 相同的 backend attempt。 */
  attempt: GraphwarBackendAttemptIdentity;
  /** 子 Worker 请求 id，通常等于 workerIndex。 */
  id: number;
  /** 子 Worker 独占的截图像素；buffer 会被转移。 */
  imageData: ImageData;
  /** 已识别的 Graphwar 平面边界。 */
  edgeRect: BoundsRect;
  /** Graphwar 原始平面到截图像素的缩放比例。 */
  scale: number;
  /** 当前子 Worker 负责评分的候选中心。 */
  candidates: readonly SoldierTemplateCenterCandidate[];
}

/** 士兵模板匹配子 Worker 的成功或错误响应。 */
export type GraphwarSoldierTemplateWorkerResponse =
  | {
      /** 与请求完全相同的 backend attempt。 */
      attempt: GraphwarBackendAttemptIdentity;
      /** 对应请求 id。 */
      id: number;
      /** 子 Worker 评分耗时，单位毫秒。 */
      elapsedMs: number;
      /** 当前候选切片中的模板匹配结果。 */
      matches: SoldierMatchCandidate[];
      /** 成功响应标记。 */
      type: "success";
    }
  | {
      /** 与请求完全相同的 backend attempt。 */
      attempt: GraphwarBackendAttemptIdentity;
      /** 对应请求 id。 */
      id: number;
      /** 序列化后的错误消息。 */
      message: string;
      /** 错误响应标记。 */
      type: "error";
    };

/** 验证 template Worker 收到的完整 request envelope。 */
export function isGraphwarSoldierTemplateWorkerRequest(value: unknown): value is GraphwarSoldierTemplateWorkerRequest {
  return (
    isRecord(value) &&
    isGraphwarBackendAttemptIdentity(value.attempt) &&
    isPositiveSafeInteger(value.id) &&
    isImageDataLike(value.imageData) &&
    isBoundsRect(value.edgeRect) &&
    isFiniteNumber(value.scale) &&
    value.scale > 0 &&
    Array.isArray(value.candidates) &&
    value.candidates.every(isTemplateCenterCandidate)
  );
}

/** 验证 template Worker 发回的 attempt envelope 和 lane payload。 */
export function isGraphwarSoldierTemplateWorkerResponse(
  value: unknown,
): value is GraphwarSoldierTemplateWorkerResponse {
  if (!isRecord(value) || !isGraphwarBackendAttemptIdentity(value.attempt) || !isPositiveSafeInteger(value.id)) {
    return false;
  }
  if (value.type === "error") {
    return typeof value.message === "string";
  }
  return (
    value.type === "success" &&
    typeof value.elapsedMs === "number" &&
    Number.isFinite(value.elapsedMs) &&
    value.elapsedMs >= 0 &&
    Array.isArray(value.matches) &&
    value.matches.every(isSoldierMatchCandidate)
  );
}

/** 同时校验 lane request id 和完整 backend attempt，错配由 parent 走普通 fallback。 */
export function isGraphwarSoldierTemplateWorkerResponseForRequest(
  request: GraphwarSoldierTemplateWorkerRequest,
  value: unknown,
): value is GraphwarSoldierTemplateWorkerResponse {
  return (
    isGraphwarSoldierTemplateWorkerResponse(value) &&
    value.id === request.id &&
    graphwarBackendAttemptIdentitiesAreEqual(value.attempt, request.attempt)
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

function isBoundsRect(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y) &&
    typeof value.width === "number" &&
    Number.isFinite(value.width) &&
    value.width > 0 &&
    typeof value.height === "number" &&
    Number.isFinite(value.height) &&
    value.height > 0
  );
}

function isTemplateCenterCandidate(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.isMirrored === "boolean" &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isNonNegativeSafeInteger(value.votes)
  );
}

function isSoldierMatchCandidate(value: unknown) {
  return (
    isRecord(value) &&
    isFiniteNumber(value.sourceCenterX) &&
    isFiniteNumber(value.sourceCenterY) &&
    typeof value.templateName === "string" &&
    value.templateName.length > 0 &&
    typeof value.isMirrored === "boolean" &&
    isFiniteNumber(value.score) &&
    isFiniteNumber(value.fixedScore) &&
    isFiniteNumber(value.foregroundScore) &&
    isFiniteNumber(value.playerScore) &&
    isFiniteNumber(value.signatureScore) &&
    isNonNegativeSafeInteger(value.votes)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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
