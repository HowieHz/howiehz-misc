import type { GraphwarBackendAttemptIdentity, GraphwarWasmSessionIdentity } from "../../core/algorithm-backend";
import type { BoundsRect } from "../../core/types";
import type { SoldierMatchCandidate, SoldierTemplateCenterCandidate } from "../objects";

/** 主 Worker 发给士兵模板匹配子 Worker 的评分请求。 */
export interface GraphwarSoldierTemplateWorkerRequest {
  /** 与 parent detection task 相同的 backend attempt。 */
  attempt: GraphwarBackendAttemptIdentity;
  /** 子 Worker 请求 id，通常等于 workerIndex。 */
  id: number;
  /** Parent detection core session；typed fault 必须带回同一份来源身份。 */
  session: GraphwarWasmSessionIdentity;
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
      /** 与父检测任务相同，用于拒绝迟到 lane 响应。 */
      attempt: GraphwarBackendAttemptIdentity;
      /** 对应子 Worker 请求 id。 */
      id: number;
      /** 当前候选切片的评分耗时，单位毫秒。 */
      elapsedMs: number;
      /** 当前候选切片的模板匹配结果。 */
      matches: SoldierMatchCandidate[];
      type: "success";
    }
  | {
      attempt: GraphwarBackendAttemptIdentity;
      id: number;
      message: string;
      type: "error";
    };
