import {
  graphwarBackendAttemptIdentitiesAreEqual,
  graphwarWasmSessionIdentitiesAreEqual,
  type GraphwarBackendAttemptIdentity,
  type GraphwarBackendControlMessage,
  type GraphwarBackendInitializationMessage,
} from "../../../core/algorithm-backend";
import { createGraphwarWorkerBackendRuntime, executeGraphwarWorkerTask } from "../../../core/worker-backend";
/** 一键清图 DAG 边消费者 worker：初始化一次私有上下文，然后按需处理单条边。 */
import {
  buildOneClickClearDagEdgeRoute,
  type GraphwarOneClickClearDagEdgeRouteBuildContext,
} from "../../../pathfinding/one-click-clear/edge-route";
import { createGraphwarThetaStarScratch } from "../../../pathfinding/routing/theta-star";
import type {
  GraphwarOneClickClearEdgeWorkerRequest,
  GraphwarOneClickClearEdgeWorkerResponse,
} from "../../../pathfinding/runtime/protocol";

/** 当前 edge Worker 暴露给 TypeScript 的最小消息接口。 */
interface GraphwarOneClickClearEdgeWorkerScope {
  /** 接收 master Worker 发来的初始化和单边 job。 */
  addEventListener: (
    type: "message",
    listener: (
      event: MessageEvent<GraphwarBackendInitializationMessage | GraphwarOneClickClearEdgeWorkerRequest>,
    ) => void,
  ) => void;
  /** 返回 ready、单边结果或错误。 */
  postMessage: (message: GraphwarBackendControlMessage | GraphwarOneClickClearEdgeWorkerResponse) => void;
}

const workerScope = self as unknown as GraphwarOneClickClearEdgeWorkerScope;
const backendRuntime = createGraphwarWorkerBackendRuntime({
  postControlMessage: (message) => workerScope.postMessage(message),
  role: "one-click-clear-edge",
});

/** 一键清图边 Worker 初始化后持有的只读搜索上下文。 */
type EdgeWorkerContext = GraphwarOneClickClearDagEdgeRouteBuildContext & {
  /** Master request attempt that owns every init/job/result in this child Worker. */
  attempt: GraphwarBackendAttemptIdentity;
  /** Master request session，防止复用 Worker 时接收旧 job/fault。 */
  session: GraphwarOneClickClearEdgeWorkerRequest["session"];
  /** 子 Worker 序号，用于响应路由。 */
  workerIndex: number;
};

let context: EdgeWorkerContext | undefined;

/** 接收初始化或单边任务，并复用同一个 Worker 私有上下文。 */
workerScope.addEventListener("message", (event) => {
  if (backendRuntime.handleMessage(event.data)) {
    return;
  }
  const request = event.data;
  void handleRequest(request);
});

/** 处理 edge Worker 消息：init 建立本 worker 的 routeMask 绑定 cache，job 复用共享单边建路规则。 */
async function handleRequest(request: GraphwarOneClickClearEdgeWorkerRequest) {
  try {
    const faultContext =
      request.type === "init"
        ? ({ attempt: request.attempt, session: request.session, type: "edge-session" } as const)
        : ({
            attempt: request.attempt,
            jobId: request.job.id,
            session: request.session,
            type: "edge-job",
          } as const);
    await executeGraphwarWorkerTask(backendRuntime, request.attempt, faultContext, async () => {
      if (request.type === "init") {
        if (context) {
          throw new Error("Edge worker was already initialized");
        }
        const visibilityGraphObstacleData =
          request.context.routeMode === "visibility-graph" ? request.context.visibilityGraphObstacleData : undefined;
        const thetaStarScratch =
          request.context.routeMode === "theta-star" ? createGraphwarThetaStarScratch() : undefined;
        const sharedContext = {
          attempt: request.attempt,
          bounds: request.context.bounds,
          boundsRect: request.context.boundsRect,
          boundaryExpansion: request.context.boundaryExpansion,
          routeMask: request.context.routeMask,
          routeTolerancePlanePixels: request.context.routeTolerancePlanePixels,
          session: request.session,
          workerIndex: request.context.workerIndex,
          ...(thetaStarScratch ? { thetaStarScratch } : {}),
          ...(visibilityGraphObstacleData ? { visibilityGraphObstacleData } : {}),
        };
        if (request.context.type === "stateless") {
          context = {
            ...sharedContext,
            routeMode: request.context.routeMode,
            type: request.context.type,
          };
        } else {
          if (request.context.stepRouteRuntime.routeMask !== request.context.routeMask) {
            throw new Error("Step-stateful runtime does not match its route mask");
          }
          context = {
            ...sharedContext,
            routeMode: request.context.routeMode,
            runtime: request.context.stepRouteRuntime,
            type: request.context.type,
          };
        }
        postResponse({
          attempt: request.attempt,
          type: "ready",
          workerIndex: request.context.workerIndex,
        });
        return;
      }

      const activeContext = context;
      if (!activeContext) {
        throw new Error("Edge worker was not initialized");
      }
      if (!graphwarBackendAttemptIdentitiesAreEqual(request.attempt, activeContext.attempt)) {
        throw new Error("Edge worker job attempt does not match its initialized attempt");
      }
      if (!graphwarWasmSessionIdentitiesAreEqual(request.session, activeContext.session)) {
        throw new Error("Edge worker job session does not match its initialized session");
      }
      if ((request.job.stepRouteStartState !== undefined) !== (activeContext.type === "step-stateful")) {
        throw new Error("Edge worker job route state does not match its initialized policy");
      }
      postResponse({
        attempt: request.attempt,
        requestId: request.requestId,
        result: await buildOneClickClearDagEdgeRoute(activeContext, request.job),
        type: "job-result",
        workerIndex: activeContext.workerIndex,
      });
    });
  } catch (error) {
    postResponse({
      attempt: request.attempt,
      message: error instanceof Error ? error.message : String(error),
      type: "error",
      workerIndex: request.type === "init" ? request.context.workerIndex : (context?.workerIndex ?? 0),
    });
  }
}

/** 将 edge Worker 的就绪、结果或错误响应发回 master。 */
function postResponse(response: GraphwarOneClickClearEdgeWorkerResponse) {
  workerScope.postMessage(response);
}
