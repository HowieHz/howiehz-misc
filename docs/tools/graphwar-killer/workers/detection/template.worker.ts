/** 士兵模板匹配子 worker：只负责候选切片评分，不做全局排序和重叠抑制。 */
import {
  GraphwarWasmFault,
  type GraphwarBackendControlMessage,
  type GraphwarBackendInitializationMessage,
} from "../../core/algorithm-backend";
import { nowMs } from "../../core/time";
import {
  runGraphwarWasmDetectionTemplateShard,
  type GraphwarWasmDetectionCandidate,
} from "../../core/wasm/detection-adapter";
import { GraphwarWasmKernelRuntime } from "../../core/wasm/runtime";
import { createGraphwarWorkerBackendRuntime, executeGraphwarWorkerTask } from "../../core/worker-backend";
import { matchSoldierTemplates } from "../../detection/objects";
import type {
  GraphwarSoldierTemplateWorkerRequest,
  GraphwarSoldierTemplateWorkerResponse,
} from "../../detection/template/protocol";

/** 当前子 Worker 暴露给 TypeScript 的最小消息接口。 */
interface GraphwarSoldierTemplateWorkerScope {
  /** 接收主 Worker 分配的候选切片。 */
  addEventListener: (
    type: "message",
    listener: (
      event: MessageEvent<GraphwarBackendInitializationMessage | GraphwarSoldierTemplateWorkerRequest>,
    ) => void,
  ) => void;
  /** 返回当前切片的模板匹配结果。 */
  postMessage: (message: GraphwarBackendControlMessage | GraphwarSoldierTemplateWorkerResponse) => void;
}

const workerScope = self as unknown as GraphwarSoldierTemplateWorkerScope;
const backendRuntime = createGraphwarWorkerBackendRuntime({
  postControlMessage: (message) => workerScope.postMessage(message),
  role: "detection-template",
});

/** 对单个候选切片完成同步评分，并把异常序列化为 lane 错误。 */
workerScope.addEventListener("message", (event) => {
  if (backendRuntime.handleMessage(event.data)) {
    return;
  }
  void runTemplateRequest(event.data);
});

/** 模板任务等待当前 child Worker 的 backend，实例化故障只走 typed control channel。 */
async function runTemplateRequest(request: GraphwarSoldierTemplateWorkerRequest) {
  try {
    const execution = await executeGraphwarWorkerTask(
      backendRuntime,
      request.attempt,
      {
        attempt: request.attempt,
        session: request.session,
        shardId: request.id,
        type: "template-shard",
      },
      (context) => {
        const startedAt = nowMs();
        const candidates = request.candidates.map(
          (candidate, index) =>
            ({
              ...candidate,
              candidateIndex: request.candidateStart + index,
            }) satisfies GraphwarWasmDetectionCandidate,
        );
        let scoredMatches;
        if (context.type === "wasm") {
          if (!(context.runtime instanceof GraphwarWasmKernelRuntime)) {
            throw new GraphwarWasmFault("abi", "Detection template Worker received an incompatible WASM runtime");
          }
          scoredMatches = runGraphwarWasmDetectionTemplateShard(context.runtime, {
            candidates,
            edgeRect: request.edgeRect,
            imageData: request.imageData,
          });
        } else {
          scoredMatches = matchSoldierTemplates(
            request.imageData,
            request.edgeRect,
            request.scale,
            request.candidates,
          ).map((match, index) => ({ ...match, candidateIndex: request.candidateStart + index }));
        }
        // 先完成评分再读取 elapsedMs；该顺序不能依赖响应对象的属性求值位置。
        return {
          candidateIndexes: scoredMatches.map((match) => match.candidateIndex),
          elapsedMs: nowMs() - startedAt,
          matches: scoredMatches.map(({ candidateIndex: _, ...match }) => match),
        };
      },
    );
    if (execution.type === "wasm-fault") {
      return;
    }
    workerScope.postMessage({
      attempt: request.attempt,
      candidateIndexes: execution.result.candidateIndexes,
      elapsedMs: execution.result.elapsedMs,
      id: request.id,
      matches: execution.result.matches,
      session: request.session,
      type: "success",
    });
  } catch (error) {
    workerScope.postMessage({
      attempt: request.attempt,
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
      session: request.session,
      type: "error",
    });
  }
}
