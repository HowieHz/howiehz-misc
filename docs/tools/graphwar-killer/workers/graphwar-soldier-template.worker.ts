/** 士兵模板匹配子 worker：只负责候选切片评分，不做全局排序和重叠抑制。 */
import { matchSoldierTemplates } from "../graphwar-detection";
import type {
  GraphwarSoldierTemplateWorkerRequest,
  GraphwarSoldierTemplateWorkerResponse,
} from "./graphwar-soldier-template-worker-types";

/** 当前子 Worker 暴露给 TypeScript 的最小消息接口。 */
interface GraphwarSoldierTemplateWorkerScope {
  /** 接收主 Worker 分配的候选切片。 */
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<GraphwarSoldierTemplateWorkerRequest>) => void,
  ) => void;
  /** 返回当前切片的模板匹配结果。 */
  postMessage: (message: GraphwarSoldierTemplateWorkerResponse) => void;
}

const workerScope = self as unknown as GraphwarSoldierTemplateWorkerScope;

workerScope.addEventListener("message", (event) => {
  const request = event.data;
  const startedAt = nowMs();
  try {
    const matches = matchSoldierTemplates(request.imageData, request.edgeRect, request.scale, request.candidates);
    workerScope.postMessage({
      elapsedMs: nowMs() - startedAt,
      id: request.id,
      matches,
      type: "success",
    });
  } catch (error) {
    workerScope.postMessage({
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
      type: "error",
    });
  }
});

/** 获取高精度时间戳，兼容没有 performance 的 Worker 环境。 */
function nowMs() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
