import {
  renderGraphwarLiveClickPreview,
  renderGraphwarLiveClickPreviewWithWasm,
  type GraphwarLiveClickPreviewWorkerRequest,
} from "../../controllers/stage/live-click-preview-render";
import type { GraphwarLiveClickPreviewWorkerResponse } from "../../controllers/stage/live-click-preview-render";
import {
  GraphwarWasmFault,
  type GraphwarBackendControlMessage,
  type GraphwarBackendInitializationMessage,
} from "../../core/algorithm-backend";
import { GraphwarWasmKernelRuntime } from "../../core/wasm/runtime";
import { createGraphwarWorkerBackendRuntime, executeGraphwarWorkerTask } from "../../core/worker-backend";

/** 实时预览 Worker 使用的最小全局作用域接口。 */
interface GraphwarLiveClickPreviewWorkerScope {
  addEventListener: (
    type: "message",
    listener: (
      event: MessageEvent<GraphwarBackendInitializationMessage | GraphwarLiveClickPreviewWorkerRequest>,
    ) => void,
  ) => void;
  postMessage: (message: GraphwarBackendControlMessage | GraphwarLiveClickPreviewWorkerResponse) => void;
}

const workerScope = self as unknown as GraphwarLiveClickPreviewWorkerScope;
const backendRuntime = createGraphwarWorkerBackendRuntime({
  postControlMessage: (message) => workerScope.postMessage(message),
  role: "live-click-preview",
});

/** 同步渲染一个预览请求，并将异常收敛为协议错误响应。 */
workerScope.addEventListener("message", (event) => {
  if (backendRuntime.handleMessage(event.data)) {
    return;
  }
  void runPreviewRequest(event.data);
});

/** 初始化失败由 control channel 报告；算法输入失败仍保留原业务错误响应。 */
async function runPreviewRequest(request: GraphwarLiveClickPreviewWorkerRequest) {
  try {
    const execution = await executeGraphwarWorkerTask(
      backendRuntime,
      request.attempt,
      { attempt: request.attempt, type: "task" },
      (backend) => {
        if (backend.type !== "wasm") {
          return renderGraphwarLiveClickPreview(request.input);
        }
        if (!(backend.runtime instanceof GraphwarWasmKernelRuntime)) {
          throw new GraphwarWasmFault("abi", "Graphwar live preview Worker received an incompatible WASM runtime");
        }
        return renderGraphwarLiveClickPreviewWithWasm(backend.runtime, request.input);
      },
    );
    if (execution.type === "wasm-fault") {
      return;
    }
    workerScope.postMessage({
      attempt: request.attempt,
      id: request.id,
      result: execution.result,
      type: "success",
    });
  } catch (error) {
    workerScope.postMessage({
      attempt: request.attempt,
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
      type: "error",
    });
  }
}
