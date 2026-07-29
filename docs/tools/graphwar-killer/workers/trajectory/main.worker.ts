import {
  calculateGraphwarTrajectory,
  type GraphwarTrajectoryCalculationWorkerRequest,
  type GraphwarTrajectoryCalculationWorkerResponse,
} from "../../controllers/path/trajectory-calculation";
import type { GraphwarBackendControlMessage, GraphwarBackendInitializationMessage } from "../../core/algorithm-backend";
import { createGraphwarWorkerBackendRuntime, executeGraphwarWorkerTask } from "../../core/worker-backend";

/** 主轨迹 Worker 使用的最小全局作用域接口。 */
interface GraphwarTrajectoryWorkerScope {
  addEventListener: (
    type: "message",
    listener: (
      event: MessageEvent<GraphwarBackendInitializationMessage | GraphwarTrajectoryCalculationWorkerRequest>,
    ) => void,
  ) => void;
  postMessage: (message: GraphwarBackendControlMessage | GraphwarTrajectoryCalculationWorkerResponse) => void;
}

const workerScope = self as unknown as GraphwarTrajectoryWorkerScope;
const backendRuntime = createGraphwarWorkerBackendRuntime({
  postControlMessage: (message) => workerScope.postMessage(message),
  role: "trajectory",
});

/** 同步执行一个原子主轨迹请求，并回传带原请求 id 的结果。 */
workerScope.addEventListener("message", (event) => {
  if (backendRuntime.handleMessage(event.data)) {
    return;
  }
  void runTrajectoryRequest(event.data);
});

/** 业务请求按消息顺序等待当前 Worker 的唯一 backend 初始化。 */
async function runTrajectoryRequest(request: GraphwarTrajectoryCalculationWorkerRequest) {
  const execution = await executeGraphwarWorkerTask(
    backendRuntime,
    request.attempt,
    { attempt: request.attempt, type: "task" },
    () => calculateGraphwarTrajectory(request.input),
  );
  if (execution.type === "wasm-fault") {
    return;
  }
  workerScope.postMessage({
    attempt: request.attempt,
    id: request.id,
    outcome: execution.result,
  });
}
