import { renderGraphwarLiveClickPreview } from "../../controllers/stage/live-click-preview-render";
import type {
  GraphwarLiveClickPreviewWorkerRequest,
  GraphwarLiveClickPreviewWorkerResponse,
} from "../../controllers/stage/live-click-preview-render";

interface GraphwarLiveClickPreviewWorkerScope {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<GraphwarLiveClickPreviewWorkerRequest>) => void,
  ) => void;
  postMessage: (message: GraphwarLiveClickPreviewWorkerResponse) => void;
}

const workerScope = self as unknown as GraphwarLiveClickPreviewWorkerScope;

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
