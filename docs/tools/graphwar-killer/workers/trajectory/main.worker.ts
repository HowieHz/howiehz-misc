import {
  calculateGraphwarTrajectory,
  getGraphwarTrajectoryCalculationWorkerRequestIdentity,
  isGraphwarTrajectoryCalculationWorkerRequest,
  type GraphwarTrajectoryCalculationWorkerResponse,
} from "../../controllers/path/trajectory-calculation";

/** 主轨迹 Worker 使用的最小全局作用域接口。 */
interface GraphwarTrajectoryWorkerScope {
  addEventListener: (type: "message", listener: (event: MessageEvent<unknown>) => void) => void;
  postMessage: (message: GraphwarTrajectoryCalculationWorkerResponse) => void;
}

const workerScope = self as unknown as GraphwarTrajectoryWorkerScope;

/** 同步执行一个原子主轨迹请求，并回传带原请求 id 的结果。 */
workerScope.addEventListener("message", (event) => {
  const request = event.data;
  if (!isGraphwarTrajectoryCalculationWorkerRequest(request)) {
    const identity = getGraphwarTrajectoryCalculationWorkerRequestIdentity(request);
    if (identity) {
      workerScope.postMessage({
        ...identity,
        outcome: { message: "Invalid trajectory worker request", ok: false, stage: "trajectory" },
      });
    }
    return;
  }
  workerScope.postMessage({
    attempt: request.attempt,
    id: request.id,
    outcome: calculateGraphwarTrajectory(request.input),
  });
});
