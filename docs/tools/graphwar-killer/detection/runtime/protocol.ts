import type { GraphwarBackendAttemptIdentity } from "../../core/algorithm-backend";
import type { BoundsRect } from "../../core/types";
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

/** Worker 内一个可展示的检测阶段耗时。 */
export interface GraphwarDetectionWorkerTimingEntry {
  /** 被测量的识别阶段。 */
  stage: GraphwarDetectionWorkerStage;
  /** 阶段耗时，单位毫秒。 */
  elapsedMs: number;
  /** 存在时作为主阶段下的调试子项展示。 */
  detail?: GraphwarDetectionWorkerTimingDetail;
}

/** 模板匹配的执行模式和分段耗时，用于解释并行及 fallback 行为。 */
export type GraphwarDetectionWorkerTimingDetail =
  | { type: "template-matching-mode"; mode: "serial"; workerCount: number }
  | { type: "template-matching-mode"; mode: "parallel"; workerCount: number }
  | { type: "template-matching-mode"; mode: "parallel-fallback"; workerCount: number }
  | { type: "template-matching-dispatch" }
  | { type: "template-matching-worker"; workerIndex: number }
  | { type: "template-matching-serial" }
  | { type: "template-matching-fallback-serial" }
  | { type: "template-matching-merge" };

/** 自动识别边界与对象所需的完整截图输入。 */
export interface GraphwarAutoDetectionInput {
  /** 当前截图像素。 */
  imageData: ImageData;
  /** 障碍识别阈值。 */
  thresholds: GraphwarObstacleDetectionThresholds;
  /** 未提供时跳过士兵检测。 */
  soldierSettings?: GraphwarSoldierDetectionSettings;
}

/** 只识别坐标系边界，不受对象识别参数影响。 */
export interface GraphwarBoundsOnlyDetectionInput {
  imageData: ImageData;
}

/** 在已知坐标系边界内识别对象的输入。 */
export interface GraphwarBoundsDetectionInput extends GraphwarAutoDetectionInput {
  edgeRect: BoundsRect;
}

/** 对象只会与已识别的坐标系边界一同存在。 */
export type GraphwarAutoDetectionResult =
  | { edgeRect: undefined }
  | { edgeRect: BoundsRect; objects: GraphwarObjectsDetectionResult };

/** 未识别到边界时 `edgeRect` 不存在。 */
export interface GraphwarBoundsOnlyDetectionResult {
  edgeRect?: BoundsRect;
}

export type GraphwarDetectionWorkerTask =
  | ({ type: "detect-auto" } & GraphwarAutoDetectionInput)
  | ({ type: "detect-bounds-only" } & GraphwarBoundsOnlyDetectionInput)
  | ({ type: "detect-bounds" } & GraphwarBoundsDetectionInput);

/** 主线程发给独占 Detection Worker 的类型化请求。 */
export interface GraphwarDetectionWorkerRequest {
  /** 当前 outer task 中唯一可提交的 backend attempt。 */
  attempt: GraphwarBackendAttemptIdentity;
  /** 单调递增，用于忽略迟到响应。 */
  id: number;
  task: GraphwarDetectionWorkerTask;
}

/** `taskType` 与对应 result 原子关联。 */
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

/** Worker 发回主线程的阶段、成功或错误响应。 */
export type GraphwarDetectionWorkerResponse =
  | GraphwarDetectionWorkerSuccessResponse
  | { attempt: GraphwarBackendAttemptIdentity; id: number; message: string; type: "error" }
  | {
      attempt: GraphwarBackendAttemptIdentity;
      id: number;
      stage: GraphwarDetectionWorkerStage;
      type: "stage";
    };
