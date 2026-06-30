/** Web Worker 和主线程之间传递 Graphwar 截图识别任务的协议类型。 */
import type { GraphwarObjectsDetectionResult, GraphwarObstacleDetectionThresholds } from "./graphwar-detection";
import type { BoundsRect } from "./types";

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
}

/** 自动识别棋盘边界并识别对象。 */
export interface GraphwarAutoDetectionInput {
  /** 当前截图像素。 */
  imageData: ImageData;
  /** 障碍识别阈值。 */
  thresholds: GraphwarObstacleDetectionThresholds;
}

/** 在指定棋盘边界内识别对象。 */
export interface GraphwarBoundsDetectionInput extends GraphwarAutoDetectionInput {
  /** 已确定的棋盘边界。 */
  edgeRect: BoundsRect;
}

/** 自动识别任务结果；找不到棋盘时只返回空 edgeRect。 */
export interface GraphwarAutoDetectionResult {
  /** 自动推断出的棋盘边界；undefined 表示未识别到棋盘。 */
  edgeRect?: BoundsRect;
  /** 棋盘边界存在时识别到的对象。 */
  objects?: GraphwarObjectsDetectionResult;
}

/** Worker 可执行的两类识别任务：自动找边界，或使用已有边界只识别对象。 */
export type GraphwarDetectionWorkerTask =
  | ({
      type: "detect-auto";
    } & GraphwarAutoDetectionInput)
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
