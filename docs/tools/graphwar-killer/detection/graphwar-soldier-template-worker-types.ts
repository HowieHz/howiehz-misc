import type { BoundsRect } from "../core/types";
import type { SoldierMatchCandidate, SoldierTemplateCenterCandidate } from "./graphwar-detection";

/** 主 Worker 发给士兵模板匹配子 Worker 的评分请求。 */
export interface GraphwarSoldierTemplateWorkerRequest {
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
      /** 对应请求 id。 */
      id: number;
      /** 序列化后的错误消息。 */
      message: string;
      /** 错误响应标记。 */
      type: "error";
    };
