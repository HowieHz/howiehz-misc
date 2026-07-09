/** 一键清图 DAG 边消费者 worker：初始化一次私有上下文，然后按需处理单条边。 */
import { buildOneClickClearDagEdgeRoute } from "../../../pathfinding/one-click-clear/edge-route";
import { createGraphwarVisibilityGraphObstacleData } from "../../../pathfinding/routing/visibility-graph";
import type { GraphwarVisibilityGraphObstacleData } from "../../../pathfinding/routing/visibility-graph";
import type {
  GraphwarOneClickClearEdgeWorkerInit,
  GraphwarOneClickClearEdgeWorkerRequest,
  GraphwarOneClickClearEdgeWorkerResponse,
} from "../../../pathfinding/runtime/protocol";

/** 当前 edge Worker 暴露给 TypeScript 的最小消息接口。 */
interface GraphwarOneClickClearEdgeWorkerScope {
  /** 接收 master Worker 发来的初始化和单边 job。 */
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<GraphwarOneClickClearEdgeWorkerRequest>) => void,
  ) => void;
  /** 返回 ready、单边结果或错误。 */
  postMessage: (message: GraphwarOneClickClearEdgeWorkerResponse) => void;
}

const workerScope = self as unknown as GraphwarOneClickClearEdgeWorkerScope;

interface EdgeWorkerContext extends GraphwarOneClickClearEdgeWorkerInit {
  /** 本 worker 私有可视图 cache，绑定本 worker 自己收到的 routeMask 引用；Theta* 模式不需要。 */
  visibilityGraphObstacleData?: GraphwarVisibilityGraphObstacleData;
}

let context: EdgeWorkerContext | undefined;

workerScope.addEventListener("message", (event: MessageEvent<GraphwarOneClickClearEdgeWorkerRequest>) => {
  void handleRequest(event.data);
});

/** 处理 edge Worker 消息：init 建立本 worker 的 routeMask 绑定 cache，job 复用共享单边建路规则。 */
async function handleRequest(request: GraphwarOneClickClearEdgeWorkerRequest) {
  try {
    if (request.type === "init") {
      /*
       * Edge Worker 不能复用主线程可视图 cache：cache 用 routeMask 引用相等判断兼容性。
       * 只有可视图模式需要在本 worker 内创建，才能绑定本 worker 收到的 routeMask。
       */
      const visibilityGraphObstacleData =
        request.context.routeMode === "visibility-graph"
          ? createGraphwarVisibilityGraphObstacleData({
              bounds: request.context.bounds,
              routeMask: request.context.routeMask,
              routeTolerancePlanePixels: request.context.routeTolerancePlanePixels,
            })
          : undefined;
      context = {
        ...request.context,
        ...(visibilityGraphObstacleData ? { visibilityGraphObstacleData } : {}),
      };
      postResponse({
        type: "ready",
        workerIndex: request.context.workerIndex,
      });
      return;
    }

    const activeContext = context;
    if (!activeContext) {
      throw new Error("Edge worker was not initialized");
    }
    const result = await buildOneClickClearDagEdgeRoute(activeContext, request.job);
    postResponse({
      requestId: request.requestId,
      result,
      type: "job-result",
      workerIndex: activeContext.workerIndex,
    });
  } catch (error) {
    postResponse({
      message: error instanceof Error ? error.message : String(error),
      type: "error",
      workerIndex: request.type === "init" ? request.context.workerIndex : (context?.workerIndex ?? 0),
    });
  }
}

function postResponse(response: GraphwarOneClickClearEdgeWorkerResponse) {
  workerScope.postMessage(response);
}
