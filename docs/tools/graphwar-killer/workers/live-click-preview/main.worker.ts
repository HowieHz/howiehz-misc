import { renderGraphwarLiveClickPreview } from "../../controllers/stage/live-click-preview-render";
import type {
  GraphwarLiveClickPreviewWorkerRequest,
  GraphwarLiveClickPreviewWorkerResponse,
} from "../../controllers/stage/live-click-preview-render";

/** 实时预览 Worker 使用的最小全局作用域接口。 */
interface GraphwarLiveClickPreviewWorkerScope {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<GraphwarLiveClickPreviewWorkerRequest>) => void,
  ) => void;
  postMessage: (message: GraphwarLiveClickPreviewWorkerResponse) => void;
}

const workerScope = self as unknown as GraphwarLiveClickPreviewWorkerScope;

/** 同步渲染一个预览请求，并将异常收敛为协议错误响应。 */
workerScope.addEventListener("message", (event) => {
  const request = event.data;
  try {
    workerScope.postMessage({
      id: request.id,
      result: renderGraphwarLiveClickPreview(request.input),
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
