import type { GraphwarClearFailureExportKind } from "../pathfinding/one-click-clear/outcome";
import type { GraphwarAgentAvailableState, GraphwarAgentSnapshot } from "./client";

/** 已去重并冻结的自动导出任务。 */
export interface GraphwarAgentClearFailureExportRequest {
  failureKind: GraphwarClearFailureExportKind;
  state: GraphwarAgentAvailableState;
  worldObstacleMask: Uint8Array;
}

/** 自动导出队列的任务执行与失败反馈。 */
interface GraphwarAgentClearFailureExportQueueOptions {
  exportRequest: (request: GraphwarAgentClearFailureExportRequest) => Promise<void> | void;
  onExportFailed?: (error: unknown) => void;
}

/** 页面持有的自动导出队列生命周期。 */
export interface GraphwarAgentClearFailureExportQueue {
  /** 清除尚未开始的任务；当前任务继续完成，已登记局面仍保持去重。 */
  clearPending: () => void;
  /** 先按权威局面登记再排队；缺少回合标识或已经登记时返回 false。 */
  enqueue: (failureKind: GraphwarClearFailureExportKind, snapshot: GraphwarAgentSnapshot) => boolean;
}

/** 创建同局面只执行一次、不同局面串行执行的自动导出队列。 */
export function createGraphwarAgentClearFailureExportQueue(
  options: GraphwarAgentClearFailureExportQueueOptions,
): GraphwarAgentClearFailureExportQueue {
  const registeredSceneKeys = new Set<string>();
  const pendingRequests: GraphwarAgentClearFailureExportRequest[] = [];
  let processing = false;

  /** 使用不透明字段的完整三元组，避免同回合不同 battle revision 被误判为同一局面。 */
  function enqueue(failureKind: GraphwarClearFailureExportKind, snapshot: GraphwarAgentSnapshot) {
    const sceneKey = createGraphwarAgentClearFailureSceneKey(snapshot.state);
    if (!sceneKey || registeredSceneKeys.has(sceneKey)) {
      return false;
    }

    // 先登记再排队，保证并发失败分支无法重复下载；复制 mask，避免等待期间共享缓存被改写。
    registeredSceneKeys.add(sceneKey);
    pendingRequests.push({
      failureKind,
      state: structuredClone(snapshot.state),
      worldObstacleMask: snapshot.worldObstacleMask.slice(),
    });
    if (!processing) {
      processing = true;
      // 截止回调只负责登记；下载在微任务中开始，避免占用 incumbent/跳过函数的认领关键路径。
      queueMicrotask(() => void processPendingRequests());
    }
    return true;
  }

  /** 用迭代消费避免任务量增长时形成递归 Promise 链。 */
  async function processPendingRequests() {
    try {
      while (true) {
        const request = pendingRequests.shift();
        if (!request) {
          break;
        }
        try {
          await options.exportRequest(request);
        } catch (error) {
          // 自动导出是诊断旁路：失败不重试，也不能阻塞后续不同局面。
          try {
            options.onExportFailed?.(error);
          } catch {
            // 失败反馈同样属于旁路，不能让展示层异常截断队列。
          }
        }
      }
    } finally {
      processing = false;
    }
  }

  return {
    clearPending: () => {
      pendingRequests.length = 0;
    },
    enqueue,
  };
}

/** 构造自动导出去重键；非瞄准态没有 turn token，不能代表一次有效清图局面。 */
export function createGraphwarAgentClearFailureSceneKey(state: GraphwarAgentAvailableState) {
  return state.turnToken ? JSON.stringify([state.gameInstanceId, state.turnToken, state.battleRevision]) : undefined;
}
