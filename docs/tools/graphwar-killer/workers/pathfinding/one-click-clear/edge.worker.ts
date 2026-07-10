import { imageToGraphPoint } from "../../../core/geometry";
/** 一键清图 DAG 边消费者 worker：初始化一次私有上下文，然后按需处理单条边。 */
import { buildOneClickClearDagEdgeRoute } from "../../../pathfinding/one-click-clear/edge-route";
import type { GraphwarPlaneMaskSummedArea } from "../../../pathfinding/routing/step-envelope";
import {
  createGraphwarStepRouteModel,
  createGraphwarStepRouteSummedArea,
} from "../../../pathfinding/routing/step-route";
import type { GraphwarStepRouteModel } from "../../../pathfinding/routing/step-route";
import { createGraphwarThetaStarScratch } from "../../../pathfinding/routing/theta-star";
import type { GraphwarThetaStarScratch } from "../../../pathfinding/routing/theta-star";
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
  /** Step 批次缺少状态化 runtime 时必须拒绝边，不能回退为 ABS 直线。 */
  stepRouteRequired: boolean;
  /** 本 worker 共用的 Step 数值模型。 */
  stepRouteModel?: GraphwarStepRouteModel;
  /** 本 worker 共用的 Step route mask 二维前缀和。 */
  stepRouteSummedArea?: GraphwarPlaneMaskSummedArea;
  /** 本 worker 私有 Theta* 工作区；同一批 DAG 边复用，避免每条边分配和清空全图数组。 */
  thetaStarScratch?: GraphwarThetaStarScratch;
  /** 本 worker 私有可视图 cache，绑定本 worker 自己收到的 routeMask 引用；Theta* 模式不需要。 */
  visibilityGraphObstacleData?: GraphwarVisibilityGraphObstacleData;
}

let context: EdgeWorkerContext | undefined;

/** 接收初始化或单边任务，并复用同一个 Worker 私有上下文。 */
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
      const thetaStarScratch =
        request.context.routeMode === "theta-star" ? createGraphwarThetaStarScratch() : undefined;
      const stepRouteModel = createGraphwarStepRouteModel(
        imageToGraphPoint(request.context.routeOriginPoint, request.context.bounds, request.context.boundsRect).y,
        request.context.settings,
      );
      context = {
        ...request.context,
        stepRouteRequired: request.context.settings.algorithm === "step",
        ...(stepRouteModel
          ? {
              stepRouteModel,
              stepRouteSummedArea: createGraphwarStepRouteSummedArea(request.context.routeMask),
            }
          : {}),
        ...(thetaStarScratch ? { thetaStarScratch } : {}),
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
    postResponse({
      requestId: request.requestId,
      result: await buildOneClickClearDagEdgeRoute(activeContext, request.job),
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

/** 将 edge Worker 的就绪、结果或错误响应发回 master。 */
function postResponse(response: GraphwarOneClickClearEdgeWorkerResponse) {
  workerScope.postMessage(response);
}
