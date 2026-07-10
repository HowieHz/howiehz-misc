/** 士兵模板匹配子 worker：只负责候选切片评分，不做全局排序和重叠抑制。 */
import { nowMs } from "../../core/time";
import { matchSoldierTemplates } from "../../detection/objects";
import type {
  GraphwarSoldierTemplateWorkerRequest,
  GraphwarSoldierTemplateWorkerResponse,
} from "../../detection/template/protocol";

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

/** 对单个候选切片完成同步评分，并把异常序列化为 lane 错误。 */
workerScope.addEventListener("message", (event) => {
  const request = event.data;
  const startedAt = nowMs();
  try {
    // 先完成评分再读取 elapsedMs；该顺序不能依赖响应对象的属性求值位置。
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
