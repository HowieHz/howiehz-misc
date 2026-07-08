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

/** 自动识别任务结果；找不到坐标系边界时只返回空 edgeRect。 */
export interface GraphwarAutoDetectionResult {
  /** 自动推断出的坐标系边界；undefined 表示未识别到坐标系边界。 */
  edgeRect?: BoundsRect;
  /** 坐标系边界存在时识别到的对象。 */
  objects?: GraphwarObjectsDetectionResult;
}

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
  /** 单调递增请求 id，用于忽略过期 Worker 响应。 */
  id: number;
  /** 具体检测任务。 */
  task: GraphwarDetectionWorkerTask;
}

/** Worker 完成识别后的成功响应；结果类型由 taskType 区分。 */
export type GraphwarDetectionWorkerSuccessResponse =
  | {
      id: number;
      result: GraphwarAutoDetectionResult;
      taskType: "detect-auto";
      timings: readonly GraphwarDetectionWorkerTimingEntry[];
      type: "success";
    }
  | {
      id: number;
      result: GraphwarBoundsOnlyDetectionResult;
      taskType: "detect-bounds-only";
      timings: readonly GraphwarDetectionWorkerTimingEntry[];
      type: "success";
    }
  | {
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
      id: number;
      message: string;
      type: "error";
    }
  | {
      id: number;
      stage: GraphwarDetectionWorkerStage;
      type: "stage";
    };
