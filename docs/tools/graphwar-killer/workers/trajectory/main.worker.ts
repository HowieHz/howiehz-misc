import {
  calculateGraphwarTrajectory,
  type GraphwarTrajectoryCalculationWorkerRequest,
  type GraphwarTrajectoryCalculationWorkerResponse,
} from "../../controllers/path/trajectory-calculation";

interface GraphwarTrajectoryWorkerScope {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<GraphwarTrajectoryCalculationWorkerRequest>) => void,
  ) => void;
  postMessage: (message: GraphwarTrajectoryCalculationWorkerResponse) => void;
}

const workerScope = self as unknown as GraphwarTrajectoryWorkerScope;

/** 同步执行一个原子主轨迹请求，并回传带原请求 id 的结果。 */
workerScope.addEventListener("message", (event) => {
  const request = event.data;
  workerScope.postMessage({
    id: request.id,
    outcome: calculateGraphwarTrajectory(request.input),
  });
});
