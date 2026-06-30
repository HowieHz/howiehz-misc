/** 士兵模板匹配子 worker：只负责候选切片评分，不做全局排序和重叠抑制。 */
import { matchSoldierTemplates } from "../graphwar-detection";
import type {
  GraphwarSoldierTemplateWorkerRequest,
  GraphwarSoldierTemplateWorkerResponse,
} from "./graphwar-soldier-template-worker-types";

interface GraphwarSoldierTemplateWorkerScope {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<GraphwarSoldierTemplateWorkerRequest>) => void,
  ) => void;
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

function nowMs() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
