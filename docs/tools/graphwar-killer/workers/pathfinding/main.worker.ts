import {
  createGraphwarWasmSessionIdentity,
  graphwarBackendAttemptIdentitiesAreEqual,
  graphwarWasmSessionIdentitiesAreEqual,
  type GraphwarBackendAttemptIdentity,
  type GraphwarBackendControlMessage,
  type GraphwarBackendInitializationMessage,
  type GraphwarAlgorithmBackendContext,
  GraphwarWasmFault,
} from "../../core/algorithm-backend";
import {
  normalizeAutomaticPathPointForMinimumForwardStep,
  normalizePathPointForStrictForward,
  pathFollowsGraphRule,
} from "../../core/game/forward-rule";
import { graphToImagePoint, imageToGraphPoint, xPlusGoesRight } from "../../core/geometry";
import {
  imagePointToPlaneGridPoint,
  mirrorPlaneGridPoint,
  planeGridCellCenterToImagePoint,
} from "../../core/plane-grid";
import { measureSyncStage, nowMs } from "../../core/time";
import { graphwarToolDefaults } from "../../core/tool/defaults";
import type { GraphBounds, PixelPoint } from "../../core/types";
import { createGraphwarWasmRouteContext } from "../../core/wasm/route-adapter";
import { GraphwarWasmKernelRuntime } from "../../core/wasm/runtime";
import {
  createGraphwarWasmStepGlitchContext,
  createGraphwarWasmStepGlitchContextInput,
  createGraphwarWasmStepGlitchScanCommandInput,
  type GraphwarWasmStepGlitchGeometryTestContext,
} from "../../core/wasm/step-glitch-adapter";
import {
  createGraphwarWorkerBackendRuntime,
  createGraphwarWorkerBackendSlot,
  executeGraphwarWorkerTask,
} from "../../core/worker-backend";
/** Graphwar 几何寻路 master worker：普通寻路直接跑，一键清图 DAG 边交给子 worker pool。 */
import { dilateObstacleMask } from "../../detection/objects";
import { resolveFormulaModeContract } from "../../formula/mode-contract";
import { createGraphwarTrajectoryFormulaMode } from "../../formula/trajectory/sampling";
import type {
  GraphwarTrajectoryFormulaMode,
  GraphwarTrajectoryFormulaSettings,
  GraphwarTrajectoryTargetCircle,
} from "../../formula/trajectory/sampling";
import { compareGraphwarPathErrors } from "../../formula/trajectory/sampling";
import { createGraphwarTrajectoryFormulaSettingsIdentity } from "../../formula/trajectory/settings-identity";
import { buildOneClickClearDagEdgeRoute } from "../../pathfinding/one-click-clear/edge-route";
import type { GraphwarOneClickClearDagEdgeRouteBuildContext } from "../../pathfinding/one-click-clear/edge-route";
import type {
  GraphwarOneClickClearDagEdgeBuildJob,
  GraphwarOneClickClearDagEdgeBuildResult,
  GraphwarOneClickClearDagEdgeRoute,
  GraphwarOneClickClearDebugTiming,
} from "../../pathfinding/one-click-clear/search";
import { buildGraphwarOneClickClearPath } from "../../pathfinding/one-click-clear/search";
import { resolveGraphwarPathSearchPolicy } from "../../pathfinding/routing/policy";
import type { GraphwarPathSearchPolicy, GraphwarPathSearchRuntimePolicy } from "../../pathfinding/routing/policy";
import type { GraphwarPlaneMaskSummedArea } from "../../pathfinding/routing/step-envelope";
import {
  createGraphwarStepGlitchPrefixEvidence,
  replayGraphwarStepGlitchPathToControlX,
  scanGraphwarStepGlitchPath,
  type GraphwarStepGlitchPrefixEvidence,
  type GraphwarStepGlitchScanTimingStage,
} from "../../pathfinding/routing/step-glitch-scan";
import {
  createGraphwarStepPathfindingEdgeEvaluator,
  createGraphwarStepRouteModel,
  createGraphwarStepRouteSummedArea,
  validateGraphwarStepRoutePath,
} from "../../pathfinding/routing/step-route";
import type { GraphwarStepRouteModel } from "../../pathfinding/routing/step-route";
import {
  buildGraphwarThetaStarPathForMask,
  createGraphwarThetaStarScratch,
} from "../../pathfinding/routing/theta-star";
import type { GraphwarThetaStarScratch } from "../../pathfinding/routing/theta-star";
import {
  buildGraphwarVisibilityGraphPathForMask,
  createRouteMaskCacheKey,
  createGraphwarVisibilityGraphObstacleData,
} from "../../pathfinding/routing/visibility-graph";
import type {
  GraphwarPathfindingOptions,
  GraphwarPathfindingPreview,
  GraphwarVisibilityGraphObstacleData,
} from "../../pathfinding/routing/visibility-graph";
import {
  createGraphwarPathfindingDebugMetrics,
  type GraphwarPathfindingDebugMetrics,
} from "../../pathfinding/runtime/diagnostics";
import type {
  GraphwarOneClickClearDagEdgesWorkerInput,
  GraphwarOneClickClearEdgeWorkerRequest,
  GraphwarOneClickClearEdgeWorkerResponse,
  GraphwarOneClickClearEdgeWorkerRouteInit,
  GraphwarOneClickClearEdgeWorkerSharedInit,
  GraphwarOneClickClearEdgeWorkerJobResult,
  GraphwarOneClickClearPathWorkerInput,
  GraphwarOneClickClearPathWorkerResult,
  GraphwarPathfindingRouteInput,
  GraphwarPathfindingRouteResult,
  GraphwarPathfindingWorkerRequest,
  GraphwarPathfindingWorkerResponse,
  GraphwarSmartPathfindingPathInput,
  GraphwarSmartPathfindingPathResult,
  GraphwarSmartPathfindingWorkerTiming,
} from "../../pathfinding/runtime/protocol";
import { createGraphwarSmartPathfindingTrajectoryResult } from "../../pathfinding/smart/trajectory";

/** 当前 master Worker 暴露给 TypeScript 的最小消息接口。 */
interface GraphwarPathfindingWorkerScope {
  /** 接收主线程几何寻路请求。 */
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<GraphwarBackendInitializationMessage | GraphwarPathfindingWorkerRequest>) => void,
  ) => void;
  /** 返回预览、成功或错误响应。 */
  postMessage: (message: GraphwarBackendControlMessage | GraphwarPathfindingWorkerResponse) => void;
}

const workerScope = self as unknown as GraphwarPathfindingWorkerScope;
const backendRuntime = createGraphwarWorkerBackendRuntime({
  postControlMessage: (message) => workerScope.postMessage(message),
  role: "pathfinding-master",
});

/** WASM-selected tasks must never silently execute the TypeScript core when their runtime is malformed. */
function getWasmRuntime(backend: GraphwarAlgorithmBackendContext) {
  if (backend.type !== "wasm") {
    return undefined;
  }
  if (!(backend.runtime instanceof GraphwarWasmKernelRuntime)) {
    throw new GraphwarWasmFault("abi", "Pathfinding Worker received an incompatible WASM runtime");
  }
  return backend.runtime;
}

/** Master Worker 缓存的一份可视图障碍数据。 */
interface MasterVisibilityGraphCacheEntry {
  /** Master worker 内部保留的 route mask 引用；cache 引用相等检查必须用它。 */
  routeMask: Uint8Array;
  /** 与 routeMask、方向和 route tolerance 绑定的可视图 cache。 */
  visibilityGraphObstacleData: GraphwarVisibilityGraphObstacleData;
}

/** Route mask 查询结果及其缓存耗时。 */
interface MasterRouteMaskLookup {
  /** Worker 查询是否复用了已按 tolerance 派生的 route mask。 */
  hasCacheHit: boolean;
  /** 查询或构建耗时。 */
  elapsedMs: number;
  /** 可直接交给几何寻路的 route mask。 */
  mask: Uint8Array;
  /** Step 请求按需构建的二维前缀和；ABS 请求保持 undefined。 */
  summedArea?: GraphwarPlaneMaskSummedArea;
}

/** 基础 mask 派生后的路线 mask 与可选可视图数据。 */
interface MasterRouteMaskCacheEntry {
  mask: Uint8Array;
  summedArea?: GraphwarPlaneMaskSummedArea;
}

/** 一份原子 Step 路由能力同时携带两个等价 backend 的完整输入。 */
interface RouteRuntimeOptions {
  typescript: Pick<
    GraphwarPathfindingOptions,
    "estimateRemainingSecondaryCost" | "evaluateEdge" | "initialRouteState" | "initialRouteStateKey"
  >;
  wasm: {
    exactStartPoint: PixelPoint;
    exactTargetPoint: PixelPoint;
    model: GraphwarStepRouteModel;
    routeOriginPoint: PixelPoint;
    resolvedStartStateKey: string;
    resolvedStartY: number;
  };
}

/** Step 路线复用的包络模型和同 mask 前缀和。 */
interface StepRouteValidationContext {
  model: GraphwarStepRouteModel;
  summedArea: GraphwarPlaneMaskSummedArea;
}

/** Step 智能寻路额外绑定已验证 prefix 的平台状态。 */
interface SmartStepRouteContext extends StepRouteValidationContext {
  /** 已验证 prefix 末端的累计平台高度。 */
  resolvedStartY: number;
  /** 已验证 prefix 末端的 canonical 平台身份。 */
  resolvedStartStateKey: string;
}

/** Step-glitch job 必须把扫描与最终回放共用的碰撞 mask 绑定到策略生命周期。 */
interface SmartStepGlitchRouteContext {
  simulationMask: Uint8Array;
}

type SmartPathSearchRuntimePolicy = GraphwarPathSearchRuntimePolicy<SmartStepRouteContext, SmartStepGlitchRouteContext>;
type OneClickClearPathSearchRuntimePolicy = GraphwarPathSearchRuntimePolicy<
  StepRouteValidationContext,
  SmartStepGlitchRouteContext
>;

/** Master route mask 缓存只需读取的输入字段。 */
interface MasterRouteMaskSourceInput {
  /** 当前 Graphwar 坐标边界。 */
  bounds: GraphBounds;
  /** 页面侧基础障碍 mask；worker 内部按 route tolerance 派生 route mask。 */
  routeObstacleMask: Uint8Array;
  /** 页面侧基础障碍 mask 的稳定 id。 */
  routeMaskCacheId: number;
  /** 当前 route tolerance。 */
  routeTolerancePlanePixels: number;
}

/** 一个边 Worker 的就绪、任务与完成状态。 */
interface EdgeWorkerHandle {
  /** 当前 job 与 session 内请求号是同一份在途身份；失败 fallback 会整体丢弃。 */
  activeRequest?: { job: GraphwarOneClickClearDagEdgeBuildJob; requestId: number };
  /** Nested edge Worker 的 backend control slot。 */
  backendSlot: ReturnType<typeof createGraphwarWorkerBackendSlot>;
  /** 清理事件监听器。 */
  cleanup: () => void;
  /** 完整初始化从发送到 ready，再到终止只沿单向状态机推进。 */
  state: "created" | "finished" | "initializing" | "ready";
  /** 子 worker 创建时间。 */
  startedAt: number;
  /** 实际子 worker。 */
  worker: Worker;
  /** 子 worker 序号。 */
  workerIndex: number;
}

/** 边 Worker 批次聚合的建模、寻路和映射耗时。 */
interface EdgeRouteTimingTotals {
  /** 平面几何寻路累计耗时。 */
  routePathfindingElapsedMs: number;
  /** 平面路线映射到截图像素的累计耗时。 */
  routeMapPixelsElapsedMs: number;
}

type OneClickClearDagEdgeSessionState = "disposed" | "failed" | "fallback" | "idle" | "running";

/** 普通 DAG 建边只支持几何路线；Step-glitch 由独立的 x+ scanner 处理。 */
type OneClickClearDagEdgePolicy = Exclude<GraphwarPathSearchPolicy, { type: "step-glitch" }>;

/** 当前 DAG 建边批次的作业、结果和结算状态。 */
interface OneClickClearDagEdgeBatch {
  /** 已完成 job id；worker 失败时只串行补跑剩余项。 */
  completedJobIds: Set<number>;
  /** 本批输入 job，顺序也是最终结果的稳定顺序。 */
  jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[];
  /** 下一个尚未分配给 worker 的 job 下标。 */
  nextJobIndex: number;
  /** Promise 失败出口。 */
  reject: (error: Error) => void;
  /** 按 job id 保存结果，避免并行完成顺序影响输出。 */
  routesByJobId: Map<number, GraphwarOneClickClearDagEdgeRoute>;
  /** Promise 成功出口。 */
  resolve: (result: GraphwarOneClickClearDagEdgeBuildResult) => void;
  /** 本批是否已结束；迟到消息必须忽略。 */
  isSettled: boolean;
  /** 本批累计的实际建路耗时。 */
  totals: EdgeRouteTimingTotals;
  /** 本批实际可参与调度的 worker 数。 */
  workerCount: number;
}

/** 一次复用 edge Worker 池的请求级会话。 */
interface OneClickClearDagEdgeSession {
  /** 结束本次一键清图请求，并返回每个 child worker 唯一的一条生命周期 timing。 */
  dispose: () => GraphwarOneClickClearDebugTiming[];
  /** 使用同一静态上下文构建下一批动态 DAG 边。批次必须串行调用。 */
  runBatch: (jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[]) => Promise<GraphwarOneClickClearDagEdgeBuildResult>;
}

const masterRouteMaskCache = new Map<string, MasterRouteMaskCacheEntry>();
const masterStepSummedAreaCache = new WeakMap<Uint8Array, GraphwarPlaneMaskSummedArea>();
const masterThetaStarScratch = createGraphwarThetaStarScratch();
const masterVisibilityGraphCache = new Map<string, MasterVisibilityGraphCacheEntry>();
let masterStepGlitchEvidence: MasterStepGlitchEvidence | undefined;

/** Master 缓存的邪道前缀证据及其输入身份。 */
interface MasterStepGlitchEvidence extends GraphwarStepGlitchPrefixEvidence {
  /** 只有精确最终整式输入相同才能复用 acceptedPoint。 */
  key: string;
}

/** 接收页面请求，并将异步搜索交给统一的 master 分派入口。 */
workerScope.addEventListener("message", (event) => {
  if (backendRuntime.handleMessage(event.data)) {
    return;
  }
  const request = event.data;
  void handleRequest(request);
});

/** 将单个 master 请求分派到对应搜索流程，并统一序列化异常。 */
async function handleRequest(request: GraphwarPathfindingWorkerRequest) {
  try {
    await executeGraphwarWorkerTask(
      backendRuntime,
      request.attempt,
      { attempt: request.attempt, type: "task" },
      async (backend) => {
        if (request.task.type === "find-route") {
          const input = request.task.input;
          postResponse({
            attempt: request.attempt,
            id: request.id,
            result: await findRouteForMask(
              request.id,
              request.attempt,
              input,
              masterVisibilityGraphCache.get(createMasterVisibilityGraphCacheKey(input))?.routeMask ?? input.routeMask,
              undefined,
              getWasmRuntime(backend),
            ),
            taskType: "find-route",
            type: "success",
          });
          return;
        }

        if (request.task.type === "find-smart-path") {
          postResponse({
            attempt: request.attempt,
            id: request.id,
            result: await findSmartPath(
              request.id,
              request.attempt,
              request.task.input,
              request.task.shouldCollectDiagnostics === true,
              getWasmRuntime(backend),
            ),
            taskType: "find-smart-path",
            type: "success",
          });
          return;
        }

        if (request.task.type === "build-one-click-clear-dag-edges") {
          postResponse({
            attempt: request.attempt,
            id: request.id,
            result: await buildOneClickClearDagEdges(
              request.id,
              request.attempt,
              request.task.input,
              getWasmRuntime(backend),
            ),
            taskType: "build-one-click-clear-dag-edges",
            type: "success",
          });
          return;
        }

        postResponse({
          attempt: request.attempt,
          id: request.id,
          result: await buildOneClickClearPath(
            request.id,
            request.attempt,
            request.task.input,
            request.task.shouldReportIncumbents,
            request.task.shouldCollectDiagnostics === true,
            getWasmRuntime(backend),
          ),
          taskType: "build-one-click-clear-path",
          type: "success",
        });
      },
    );
  } catch (error) {
    postResponse({
      attempt: request.attempt,
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
      type: "error",
    });
  }
}

/** 在给定 route mask 上运行所选几何路由器，并归集搜索与可视图缓存耗时。 */
async function findRouteForMask(
  id: number,
  attempt: GraphwarBackendAttemptIdentity,
  input: GraphwarPathfindingRouteInput,
  routeMask: Uint8Array,
  runtimeOptions?: RouteRuntimeOptions,
  wasmRuntime?: GraphwarWasmKernelRuntime,
): Promise<GraphwarPathfindingRouteResult> {
  let visibilityCache: GraphwarPathfindingRouteResult["visibilityCache"] = "skipped";
  let visibilityCacheElapsedMs = 0;
  const searchStartedAt = nowMs();
  const postPreview = input.isPreviewEnabled
    ? (preview: GraphwarPathfindingPreview) =>
        postResponse({
          attempt,
          id,
          preview,
          type: "preview",
        })
    : undefined;
  // A Step WASM command is selected only with its complete model and exact initial state; other custom edge evaluators
  // remain TypeScript-only rather than being silently weakened to stateless geometry.
  if (wasmRuntime) {
    const wasmContext = createGraphwarWasmRouteContext(wasmRuntime, {
      boundaryExpansion: input.boundaryExpansion,
      bounds: input.bounds,
      boundsRect: input.boundsRect,
      routeOriginPoint: imageToGraphPoint(
        runtimeOptions?.wasm.routeOriginPoint ?? input.startPoint,
        input.bounds,
        input.boundsRect,
      ),
      // `routeMask` 已完成 morphology；真实 tolerance 仍决定 visibility contour 的 RDP epsilon。
      routeTolerancePlanePixels: input.routeTolerancePlanePixels,
      sourceMask: routeMask,
      sourceMaskType: "route",
      ...(runtimeOptions
        ? {
            stepRouteModel: {
              ...runtimeOptions.wasm.model,
              qualityTargetPlanePixels: graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
            },
          }
        : {}),
    });
    try {
      const isMirrored = !xPlusGoesRight(input.bounds);
      const start = mirrorPlaneGridPoint(imagePointToPlaneGridPoint(input.startPoint, input.boundsRect), isMirrored);
      const target = mirrorPlaneGridPoint(imagePointToPlaneGridPoint(input.targetPoint, input.boundsRect), isMirrored);
      const wasmStepRoute = runtimeOptions?.wasm;
      const retainedStepRoute = wasmContext.stepRoute;
      let result;
      if (wasmStepRoute) {
        if (!retainedStepRoute) {
          throw new GraphwarWasmFault("abi", "Pathfinding WASM route context did not retain its Step model");
        }
        result =
          input.routeMode === "theta-star"
            ? retainedStepRoute.findThetaStarPath({
                exactStart: imageToGraphPoint(wasmStepRoute.exactStartPoint, input.bounds, input.boundsRect),
                exactTarget: imageToGraphPoint(wasmStepRoute.exactTargetPoint, input.bounds, input.boundsRect),
                initialState: {
                  resolvedY: wasmStepRoute.resolvedStartY,
                  routeStateKey: wasmStepRoute.resolvedStartStateKey,
                },
                shouldCollectPreviews: input.isPreviewEnabled,
                start,
                target,
              })
            : retainedStepRoute.findVisibilityGraphPath({
                exactStart: imageToGraphPoint(wasmStepRoute.exactStartPoint, input.bounds, input.boundsRect),
                exactTarget: imageToGraphPoint(wasmStepRoute.exactTargetPoint, input.bounds, input.boundsRect),
                initialState: {
                  resolvedY: wasmStepRoute.resolvedStartY,
                  routeStateKey: wasmStepRoute.resolvedStartStateKey,
                },
                shouldCollectPreviews: input.isPreviewEnabled,
                start,
                target,
              });
      } else {
        result =
          input.routeMode === "theta-star"
            ? wasmContext.findThetaStarPath(start, target, input.isPreviewEnabled)
            : wasmContext.findVisibilityGraphPath(start, target, input.isPreviewEnabled);
      }
      for (const preview of result.previews) {
        postPreview?.({
          acceptedEdges: preview.acceptedEdges.map(([from, to]) => [
            { x: from.x, y: from.y },
            { x: to.x, y: to.y },
          ]),
          bestPath: preview.bestPath.map((point) => ({ x: point.x, y: point.y })),
          candidates: preview.candidates.map((point) => ({ x: point.x, y: point.y })),
          ...(preview.current ? { current: { x: preview.current.x, y: preview.current.y } } : {}),
          isMirrored: preview.isMirrored,
        });
      }
      return {
        ...(result.type === "success"
          ? { path: result.path.map((point) => mirrorPlaneGridPoint(point, isMirrored)) }
          : {}),
        searchElapsedMs: Math.max(0, nowMs() - searchStartedAt),
        visibilityCache: "skipped",
        visibilityCacheElapsedMs: 0,
      };
    } finally {
      wasmContext.dispose();
    }
  }
  const path =
    input.routeMode === "theta-star"
      ? await buildGraphwarThetaStarPathForMask({
          bounds: input.bounds,
          boundsRect: input.boundsRect,
          boundaryExpansion: input.boundaryExpansion,
          ...runtimeOptions?.typescript,
          onPreview: postPreview,
          routeMask,
          routeTolerancePlanePixels: input.routeTolerancePlanePixels,
          scratch: masterThetaStarScratch,
          startPoint: input.startPoint,
          targetPoint: input.targetPoint,
        })
      : await buildGraphwarVisibilityGraphPathForMask({
          bounds: input.bounds,
          boundsRect: input.boundsRect,
          boundaryExpansion: input.boundaryExpansion,
          ...runtimeOptions?.typescript,
          getVisibilityGraphObstacleData: () => {
            const startedAt = nowMs();
            const lookup = getMasterVisibilityGraphObstacleData(input, routeMask);
            visibilityCache = lookup.hasCacheHit ? "hit" : "miss";
            visibilityCacheElapsedMs += nowMs() - startedAt;
            return lookup.data;
          },
          onPreview: postPreview,
          routeMask,
          routeTolerancePlanePixels: input.routeTolerancePlanePixels,
          startPoint: input.startPoint,
          targetPoint: input.targetPoint,
        });

  return {
    ...(path ? { path } : {}),
    searchElapsedMs: Math.max(0, nowMs() - searchStartedAt - visibilityCacheElapsedMs),
    visibilityCache,
    visibilityCacheElapsedMs,
  };
}

/** 完成智能寻路的几何搜索、轨迹验证和路径删点。 */
async function findSmartPath(
  id: number,
  attempt: GraphwarBackendAttemptIdentity,
  input: GraphwarSmartPathfindingPathInput,
  shouldCollectDiagnostics: boolean,
  wasmRuntime?: GraphwarWasmKernelRuntime,
): Promise<GraphwarSmartPathfindingPathResult> {
  const formulaMode = createGraphwarTrajectoryFormulaMode(input.settings);
  const pathSearchPolicy = resolveGraphwarPathSearchPolicy(formulaMode.contract, input.routeMode);
  const debugMetrics = shouldCollectDiagnostics
    ? createGraphwarPathfindingDebugMetrics(
        pathSearchPolicy.type === "step-glitch",
        wasmRuntime ? { effective: "wasm", requested: "wasm" } : { effective: "typescript", requested: "typescript" },
      )
    : undefined;
  const result = await findSmartPathResult(
    id,
    attempt,
    input,
    formulaMode,
    debugMetrics,
    pathSearchPolicy,
    wasmRuntime,
  );
  return debugMetrics ? { ...result, diagnostics: debugMetrics } : result;
}

/** 执行智能寻路业务逻辑；外层统一附加可选诊断，避免每个早退分支重复组装。 */
async function findSmartPathResult(
  id: number,
  attempt: GraphwarBackendAttemptIdentity,
  input: GraphwarSmartPathfindingPathInput,
  formulaMode: GraphwarTrajectoryFormulaMode,
  debugMetrics: GraphwarPathfindingDebugMetrics | undefined,
  pathSearchPolicy: GraphwarPathSearchPolicy,
  wasmRuntime?: GraphwarWasmKernelRuntime,
): Promise<GraphwarSmartPathfindingPathResult> {
  const timings: GraphwarSmartPathfindingWorkerTiming[] = [];
  const startPoint = input.sourcePath.at(-1);
  const routeOriginPoint = input.sourcePath[0];
  if (!startPoint || !routeOriginPoint) {
    return { failureReason: "route", timings };
  }

  if (pathSearchPolicy.type === "step-glitch") {
    return input.simulationMask
      ? findStepGlitchSmartPath(
          input,
          formulaMode,
          timings,
          { ...pathSearchPolicy, runtime: { simulationMask: input.simulationMask } },
          debugMetrics,
          wasmRuntime,
        )
      : { failureReason: "route", timings };
  }

  const routeMaskLookup = getMasterRouteMaskFromBase(input, pathSearchPolicy.type === "step-stateful");
  timings.push({
    elapsedMs: routeMaskLookup.elapsedMs,
    stage: routeMaskLookup.hasCacheHit ? "route-mask-cache-hit" : "route-mask-cache-miss",
  });

  let runtimePolicy: SmartPathSearchRuntimePolicy;
  if (pathSearchPolicy.type === "step-stateful") {
    const model = createGraphwarStepRouteModel(
      imageToGraphPoint(routeOriginPoint, input.bounds, input.boundsRect).y,
      input.settings,
    );
    if (!model || !routeMaskLookup.summedArea) {
      return { failureReason: "route", timings };
    }

    const prefixValidation = validateGraphwarStepRoutePath({
      boundaryInset: input.boundaryExpansion,
      bounds: input.bounds,
      boundsRect: input.boundsRect,
      model,
      points: input.sourcePath,
      summedArea: routeMaskLookup.summedArea,
    });
    if (!prefixValidation.ok) {
      return {
        failureReason: "route",
        ...(prefixValidation.invalidSegmentIndex === undefined
          ? {}
          : { invalidSegmentIndex: prefixValidation.invalidSegmentIndex }),
        timings,
      };
    }
    if (prefixValidation.routeStateKey === undefined) {
      return { failureReason: "route", timings };
    }
    runtimePolicy = {
      ...pathSearchPolicy,
      runtime: {
        model,
        resolvedStartY: prefixValidation.resolvedEndY,
        resolvedStartStateKey: prefixValidation.routeStateKey,
        summedArea: routeMaskLookup.summedArea,
      },
    };
  } else {
    runtimePolicy = pathSearchPolicy;
  }

  const routeRuntimeOptions: RouteRuntimeOptions | undefined =
    runtimePolicy.type === "step-stateful"
      ? {
          typescript: createGraphwarStepPathfindingEdgeEvaluator({
            boundaryInset: input.boundaryExpansion,
            bounds: input.bounds,
            boundsRect: input.boundsRect,
            exactStartPoint: startPoint,
            exactTargetPoint: input.targetPoint,
            model: runtimePolicy.runtime.model,
            resolvedStartY: runtimePolicy.runtime.resolvedStartY,
            resolvedStartStateKey: runtimePolicy.runtime.resolvedStartStateKey,
            summedArea: runtimePolicy.runtime.summedArea,
          }),
          wasm: {
            exactStartPoint: startPoint,
            exactTargetPoint: input.targetPoint,
            model: runtimePolicy.runtime.model,
            routeOriginPoint,
            resolvedStartStateKey: runtimePolicy.runtime.resolvedStartStateKey,
            resolvedStartY: runtimePolicy.runtime.resolvedStartY,
          },
        }
      : undefined;

  const routeResult = await findRouteForMask(
    id,
    attempt,
    {
      boundaryExpansion: input.boundaryExpansion,
      bounds: input.bounds,
      boundsRect: input.boundsRect,
      isPreviewEnabled: input.isPreviewEnabled,
      routeMask: routeMaskLookup.mask,
      routeMaskCacheId: input.routeMaskCacheId,
      routeMode: runtimePolicy.routeMode,
      routeTolerancePlanePixels: input.routeTolerancePlanePixels,
      startPoint,
      targetPoint: input.targetPoint,
    },
    routeMaskLookup.mask,
    routeRuntimeOptions,
    wasmRuntime,
  );
  timings.push(
    {
      elapsedMs: routeResult.visibilityCacheElapsedMs,
      stage:
        routeResult.visibilityCache === "hit"
          ? "visibility-cache-hit"
          : routeResult.visibilityCache === "miss"
            ? "visibility-cache-miss"
            : "visibility-cache-skipped",
    },
    {
      elapsedMs: routeResult.searchElapsedMs,
      stage: "search-route",
    },
  );
  if (!routeResult.path || routeResult.path.length < 2) {
    return { failureReason: "route", timings };
  }

  const normalizedPath = normalizeSmartPathfindingPathFromPlanePath(routeResult.path, input.targetPoint, input);
  const validation = measureSyncStage(timings, "validate-trajectory", () =>
    validateSmartPathfindingTrajectory(input, normalizedPath, formulaMode, runtimePolicy, debugMetrics, wasmRuntime),
  );
  if (!validation.followsGraphRule) {
    return { failureReason: "graph-rule", timings };
  }
  if (!validation.reachesTargetBeforeObstacle) {
    return {
      ...(validation.blockedPoint ? { blockedPoint: validation.blockedPoint } : {}),
      failureReason: "trajectory",
      timings,
    };
  }

  const path =
    input.isDeleteOptimizationEnabled && normalizedPath.length > 3
      ? measureSyncStage(timings, "optimize-path", () =>
          optimizeSmartPathfindingPath(input, normalizedPath, formulaMode, runtimePolicy, debugMetrics, wasmRuntime),
        )
      : normalizedPath;
  return { path, timings };
}

/** Step ODE 邪道单目标直接扫描控制点；不经过普通 route mask、Theta* 或可视图。 */
function findStepGlitchSmartPath(
  input: GraphwarSmartPathfindingPathInput,
  formulaMode: GraphwarTrajectoryFormulaMode,
  timings: GraphwarSmartPathfindingWorkerTiming[],
  pathSearchPolicy: Extract<SmartPathSearchRuntimePolicy, { type: "step-glitch" }>,
  debugMetrics?: GraphwarPathfindingDebugMetrics,
  wasmRuntime?: GraphwarWasmKernelRuntime,
): GraphwarSmartPathfindingPathResult {
  const simulationMask = pathSearchPolicy.runtime.simulationMask;
  const scannerFormulaMode =
    formulaMode.settings.stepGlitchObstacleMask === simulationMask
      ? formulaMode
      : createGraphwarTrajectoryFormulaMode({
          ...formulaMode.settings,
          stepGlitchObstacleMask: simulationMask,
        });
  if (wasmRuntime) {
    return findStepGlitchSmartPathWithWasm(input, scannerFormulaMode, timings, pathSearchPolicy, wasmRuntime);
  }
  const prefixEvidence = getMasterStepGlitchEvidence(input, input.sourcePath, input.prefixTarget);
  const scanResult = scanGraphwarStepGlitchPath({
    bounds: input.bounds,
    boundsRect: input.boundsRect,
    debugMetrics,
    hitTarget: input.hitTarget,
    ...(prefixEvidence ? { prefixEvidence } : {}),
    ...(input.prefixTarget ? { prefixTarget: input.prefixTarget } : {}),
    // 单目标请求只从当前尾点继续；更早运行命中的士兵不属于本次目标。
    requiredTargets: [],
    formulaMode: scannerFormulaMode,
    simulationBoundaryExpansion: input.simulationBoundaryExpansion,
    simulationMask,
    sourcePath: input.sourcePath,
    targetPoint: input.targetPoint,
  });
  appendStepGlitchScanTimings(timings, scanResult.timings);
  if (scanResult.status !== "hit") {
    const blockedPoint = scanResult.blockedPoint
      ? graphToImagePoint(scanResult.blockedPoint, input.bounds, input.boundsRect)
      : undefined;
    return {
      ...(blockedPoint ? { blockedPoint } : {}),
      failureReason: blockedPoint ? "trajectory" : "route",
      timings,
    };
  }

  const validation = measureSyncStage(timings, "validate-trajectory", () => {
    if (formulaMode.settings.stepGlitchObstacleMask !== simulationMask) {
      return validateSmartPathfindingTrajectory(input, scanResult.path, formulaMode, pathSearchPolicy, debugMetrics);
    }

    // Scanner 已用同一公式 mask 完整回放到目标控制点；这里只保留不依赖轨迹采样的 x+ 规则检查。
    const followsGraphRule = pathFollowsGraphRule(scanResult.path, input.bounds, input.boundsRect);
    return {
      followsGraphRule,
      reachesTargetBeforeObstacle: followsGraphRule,
    };
  });
  if (!validation.followsGraphRule) {
    return { failureReason: "graph-rule", timings };
  }
  if (!validation.reachesTargetBeforeObstacle) {
    return {
      ...(validation.blockedPoint ? { blockedPoint: validation.blockedPoint } : {}),
      failureReason: "trajectory",
      timings,
    };
  }

  let path = scanResult.path;
  let resultPrefixEvidence = createGraphwarStepGlitchPrefixEvidence({
    acceptedPoint: scanResult.acceptedPoint,
    formulaEvidence: scanResult.replayEvidence.formulaContext.stepGlitchFormulaEvidence,
    prefixTarget: input.hitTarget,
    requiredTargets: [],
    simulationBoundaryExpansion: input.simulationBoundaryExpansion,
    simulationMask,
  });
  if (input.isDeleteOptimizationEnabled && formulaMode.settings.stepGlitchObstacleMask === simulationMask) {
    const optimized = measureSyncStage(timings, "optimize-path", () =>
      optimizeStepGlitchSmartPath(
        input,
        path,
        formulaMode,
        input.hitTarget,
        resultPrefixEvidence,
        prefixEvidence,
        debugMetrics,
      ),
    );
    path = optimized.path;
    resultPrefixEvidence = optimized.prefixEvidence;
  } else if (input.isDeleteOptimizationEnabled) {
    path = measureSyncStage(timings, "optimize-path", () =>
      optimizeSmartPathfindingPath(input, path, formulaMode, pathSearchPolicy, debugMetrics),
    );
  }
  setMasterStepGlitchEvidence(input, path, resultPrefixEvidence);
  return { path, timings };
}

/** Effective WASM smart Step-glitch path: one retained context owns scan and deletion replays. */
export function findStepGlitchSmartPathWithWasm(
  input: GraphwarSmartPathfindingPathInput,
  scannerFormulaMode: GraphwarTrajectoryFormulaMode,
  timings: GraphwarSmartPathfindingWorkerTiming[],
  pathSearchPolicy: Extract<SmartPathSearchRuntimePolicy, { type: "step-glitch" }>,
  wasmRuntime: GraphwarWasmKernelRuntime,
): GraphwarSmartPathfindingPathResult {
  const simulationMask = pathSearchPolicy.runtime.simulationMask;
  const prefixEvidence = getMasterStepGlitchEvidence(input, input.sourcePath, input.prefixTarget);
  const contextResult = createGraphwarWasmStepGlitchContext(
    wasmRuntime,
    createGraphwarWasmStepGlitchContextInput({
      bounds: input.bounds,
      boundsRect: input.boundsRect,
      formulaMode: scannerFormulaMode,
      ...(prefixEvidence ? { prefixEvidence } : {}),
      ...(input.prefixTarget ? { prefixTarget: input.prefixTarget } : {}),
      requiredTargets: [],
      simulationBoundaryExpansion: input.simulationBoundaryExpansion,
      simulationMask,
      sourcePath: input.sourcePath,
    }),
  );
  if (contextResult.status !== "ready") {
    return { failureReason: "route", timings };
  }

  const scanner = contextResult.context;
  try {
    const scanStartedAt = nowMs();
    const scanResult = scanner.scanRaw(
      createGraphwarWasmStepGlitchScanCommandInput({
        hitTarget: input.hitTarget,
        targetPoint: input.targetPoint,
      }),
    );
    timings.push({ elapsedMs: Math.max(0, nowMs() - scanStartedAt), stage: "search-route" });
    if (scanResult.status !== "hit") {
      const blockedPoint = scanResult.blockedPoint
        ? graphToImagePoint(scanResult.blockedPoint, input.bounds, input.boundsRect)
        : undefined;
      return {
        ...(blockedPoint ? { blockedPoint } : {}),
        failureReason: blockedPoint ? "trajectory" : "route",
        timings,
      };
    }
    const evidence = scanResult.evidence?.owned;
    if (!evidence) {
      throw new GraphwarWasmFault("abi", "Step-glitch WASM scan returned no owned evidence");
    }
    let path = [...evidence.path];
    if (!pathFollowsGraphRule(path, input.bounds, input.boundsRect)) {
      return { failureReason: "graph-rule", timings };
    }
    if (input.isDeleteOptimizationEnabled && path.length > 3) {
      path = measureSyncStage(timings, "optimize-path", () =>
        optimizeStepGlitchSmartPathWithWasm(scanner, input, path),
      );
    }
    // The production evidence ABI intentionally carries no complete prefix evidence; do not publish a synthetic one.
    return { path, timings };
  } finally {
    scanner.dispose();
  }
}

/** WASM deletion replay keeps the same greedy acceptance order as the TypeScript scanner. */
function optimizeStepGlitchSmartPathWithWasm(
  scanner: GraphwarWasmStepGlitchGeometryTestContext,
  input: GraphwarSmartPathfindingPathInput,
  points: readonly PixelPoint[],
): PixelPoint[] {
  let optimized = [...points];
  const firstOptimizableIndex = Math.max(1, input.sourcePath.length);
  const controlX = imageToGraphPoint(input.targetPoint, input.bounds, input.boundsRect).x;
  for (let index = firstOptimizableIndex; index < optimized.length - 1 && optimized.length > 2;) {
    const candidatePath = [...optimized.slice(0, index), ...optimized.slice(index + 1)];
    if (!pathFollowsGraphRule(candidatePath, input.bounds, input.boundsRect)) {
      index += 1;
      continue;
    }
    const replay = scanner.replayRaw({
      controlX,
      finalValidation: { type: "none" },
      path: candidatePath,
      targetSequence: [input.hitTarget],
      type: "replay",
      windows: { type: "automatic" },
    });
    if (replay.status !== "hit") {
      index += 1;
      continue;
    }
    optimized = candidatePath;
  }
  return optimized;
}

/** 删除单目标邪道路线的非锚点，并随精确成功路径更新可发布公式前缀。 */
function optimizeStepGlitchSmartPath(
  input: GraphwarSmartPathfindingPathInput,
  points: readonly PixelPoint[],
  formulaMode: GraphwarTrajectoryFormulaMode,
  target: GraphwarTrajectoryTargetCircle,
  prefixEvidence: GraphwarStepGlitchPrefixEvidence,
  sourcePrefixEvidence: GraphwarStepGlitchPrefixEvidence | undefined,
  debugMetrics?: GraphwarPathfindingDebugMetrics,
) {
  let optimized = [...points];
  let optimizedPrefixEvidence = prefixEvidence;
  const firstOptimizableIndex = Math.max(1, input.sourcePath.length);
  for (let index = firstOptimizableIndex; index < optimized.length - 1 && optimized.length > 2;) {
    const candidatePath = [...optimized.slice(0, index), ...optimized.slice(index + 1)];
    if (!pathFollowsGraphRule(candidatePath, input.bounds, input.boundsRect) || !input.simulationMask) {
      index += 1;
      continue;
    }
    const replay = replayGraphwarStepGlitchPathToControlX({
      bounds: input.bounds,
      boundsRect: input.boundsRect,
      controlX: imageToGraphPoint(input.targetPoint, input.bounds, input.boundsRect).x,
      debugMetrics,
      formulaMode,
      path: candidatePath,
      requiredTargets: [],
      ...(sourcePrefixEvidence ? { prefixEvidence: sourcePrefixEvidence } : {}),
      simulationBoundaryExpansion: input.simulationBoundaryExpansion,
      simulationMask: input.simulationMask,
      sourcePath: input.sourcePath,
      targetSequence: [target],
    });
    if (replay.status === "miss") {
      index += 1;
      continue;
    }
    optimized = candidatePath;
    optimizedPrefixEvidence = createGraphwarStepGlitchPrefixEvidence({
      acceptedPoint: replay.acceptedPoint,
      formulaEvidence: replay.replayEvidence.formulaContext.stepGlitchFormulaEvidence,
      prefixTarget: target,
      requiredTargets: [],
      simulationBoundaryExpansion: input.simulationBoundaryExpansion,
      simulationMask: input.simulationMask,
    });
  }
  return {
    path: optimized,
    prefixEvidence: optimizedPrefixEvidence,
  };
}

/** 判断邪道证据是否可复用所需的最小输入。 */
interface MasterStepGlitchEvidenceContext {
  bounds: GraphBounds;
  boundsRect: GraphwarSmartPathfindingPathInput["boundsRect"];
  settings: GraphwarTrajectoryFormulaSettings;
  simulationBoundaryExpansion: number;
  simulationMask?: Uint8Array;
  simulationMaskCacheId: number;
}

/** 只在 Master 精确 key 命中时返回恢复点，并把等价 mask 设置重绑到本次请求。 */
function getMasterStepGlitchEvidence(
  input: MasterStepGlitchEvidenceContext,
  path: readonly PixelPoint[],
  prefixTarget: GraphwarTrajectoryTargetCircle | undefined,
): GraphwarStepGlitchPrefixEvidence | undefined {
  if (!masterStepGlitchEvidence || !isMasterStepGlitchEvidenceEnabled(input)) {
    return undefined;
  }
  const key = createMasterStepGlitchEvidenceKey(input, path, prefixTarget);
  if (masterStepGlitchEvidence.key !== key) {
    return undefined;
  }
  return createGraphwarStepGlitchPrefixEvidence({
    acceptedPoint: masterStepGlitchEvidence.acceptedPoint,
    formulaEvidence: {
      prefix: {
        ...masterStepGlitchEvidence.formulaEvidence.prefix,
        settings: input.settings,
      },
    },
    prefixTarget: masterStepGlitchEvidence.replayIdentity.prefixTarget,
    requiredTargets: [],
    simulationBoundaryExpansion: masterStepGlitchEvidence.replayIdentity.boundaryExpansion,
    simulationMask: masterStepGlitchEvidence.replayIdentity.simulationMask,
  });
}

/** 保存最近一条完整验证成功的邪道路径证据；下一次写入直接替换旧证据。 */
function setMasterStepGlitchEvidence(
  input: MasterStepGlitchEvidenceContext,
  path: readonly PixelPoint[],
  prefixEvidence: GraphwarStepGlitchPrefixEvidence,
) {
  if (!isMasterStepGlitchEvidenceEnabled(input)) {
    return;
  }
  const prefixOnlyEvidence = createGraphwarStepGlitchPrefixEvidence({
    acceptedPoint: prefixEvidence.acceptedPoint,
    // Master 只缓存 prefix-only 分支，局部 RK4 boundary 和历史 required targets 不跨 job。
    formulaEvidence: { prefix: prefixEvidence.formulaEvidence.prefix },
    prefixTarget: prefixEvidence.replayIdentity.prefixTarget,
    requiredTargets: [],
    simulationBoundaryExpansion: prefixEvidence.replayIdentity.boundaryExpansion,
    simulationMask: prefixEvidence.replayIdentity.simulationMask,
  });
  masterStepGlitchEvidence = {
    ...prefixOnlyEvidence,
    key: createMasterStepGlitchEvidenceKey(input, path, prefixEvidence.replayIdentity.prefixTarget),
  };
}

/** 判断 master Worker 是否应保存 Step 邪道前缀证据。 */
function isMasterStepGlitchEvidenceEnabled(input: MasterStepGlitchEvidenceContext) {
  return Boolean(input.simulationMask && input.settings.stepGlitchObstacleMask === input.simulationMask);
}

/** Evidence 证明的是精确最终整式；任何会改变公式或碰撞语义的输入都进入 key。 */
function createMasterStepGlitchEvidenceKey(
  input: MasterStepGlitchEvidenceContext,
  path: readonly PixelPoint[],
  prefixTarget: GraphwarTrajectoryTargetCircle | undefined,
) {
  return JSON.stringify([
    "step-glitch-evidence-v1",
    [input.bounds.minX, input.bounds.maxX, input.bounds.minY, input.bounds.maxY],
    [input.boundsRect.x, input.boundsRect.y, input.boundsRect.width, input.boundsRect.height],
    input.simulationBoundaryExpansion,
    input.simulationMaskCacheId,
    createGraphwarTrajectoryFormulaSettingsIdentity(input.settings),
    path.map((point) => [point.x, point.y]),
    // Evidence 只恢复精确公式前缀，不保存历史士兵：后续请求从路径尾点继续，但不承诺重命中旧目标。
    prefixTarget ? [prefixTarget.center.x, prefixTarget.center.y, prefixTarget.radius] : undefined,
  ]);
}

/** 把邪道扫描阶段追加到智能寻路 Worker 耗时。 */
function appendStepGlitchScanTimings(
  timings: GraphwarSmartPathfindingWorkerTiming[],
  scanTimings: readonly { elapsedMs: number; stage: GraphwarStepGlitchScanTimingStage }[],
) {
  for (const timing of scanTimings) {
    timings.push({
      elapsedMs: timing.elapsedMs,
      stage:
        timing.stage === "validate-direct"
          ? "validate-direct-trajectory"
          : timing.stage === "prepare-prefix"
            ? "prepare-pathfinding-prefix"
            : timing.stage === "scan-candidates"
              ? "search-route"
              : timing.stage,
    });
  }
}

/** 获取或派生 master 私有 route mask，并按需补齐 Step 前缀和。 */
function getMasterRouteMaskFromBase(
  input: MasterRouteMaskSourceInput,
  shouldCreateSummedArea = false,
): MasterRouteMaskLookup {
  const startedAt = nowMs();
  const cacheKey = [input.routeMaskCacheId, createRouteMaskCacheKey(input.routeTolerancePlanePixels)].join("|");
  const cached = masterRouteMaskCache.get(cacheKey);
  if (cached) {
    if (shouldCreateSummedArea && !cached.summedArea) {
      cached.summedArea = getOrCreateMasterStepSummedArea(cached.mask);
    }
    return {
      hasCacheHit: true,
      elapsedMs: nowMs() - startedAt,
      mask: cached.mask,
      ...(cached.summedArea ? { summedArea: cached.summedArea } : {}),
    };
  }

  const mask = dilateObstacleMask(input.routeObstacleMask, input.routeTolerancePlanePixels);
  const entry: MasterRouteMaskCacheEntry = {
    mask,
    ...(shouldCreateSummedArea ? { summedArea: getOrCreateMasterStepSummedArea(mask) } : {}),
  };
  masterRouteMaskCache.set(cacheKey, entry);
  return {
    hasCacheHit: false,
    elapsedMs: nowMs() - startedAt,
    mask,
    ...(entry.summedArea ? { summedArea: entry.summedArea } : {}),
  };
}

/** Master 内同一个 route mask 的 Step 前缀和只构建一次，供 smart 与多批 DAG 建边复用。 */
function getOrCreateMasterStepSummedArea(mask: Uint8Array) {
  const cached = masterStepSummedAreaCache.get(mask);
  if (cached) {
    return cached;
  }
  const summedArea = createGraphwarStepRouteSummedArea(mask);
  masterStepSummedAreaCache.set(mask, summedArea);
  return summedArea;
}

/** 获取与 mask、方向和容差匹配的可视图预处理数据。 */
function getMasterVisibilityGraphObstacleData(
  input: Pick<GraphwarPathfindingRouteInput, "bounds" | "routeMaskCacheId" | "routeTolerancePlanePixels">,
  routeMask: Uint8Array,
) {
  const cacheKey = createMasterVisibilityGraphCacheKey(input);
  const cached = masterVisibilityGraphCache.get(cacheKey);
  if (cached) {
    return {
      hasCacheHit: true,
      data: cached.visibilityGraphObstacleData,
    };
  }

  const data = createGraphwarVisibilityGraphObstacleData({
    bounds: input.bounds,
    routeMask,
    routeTolerancePlanePixels: input.routeTolerancePlanePixels,
  });
  masterVisibilityGraphCache.set(cacheKey, {
    routeMask,
    visibilityGraphObstacleData: data,
  });
  return {
    hasCacheHit: false,
    data,
  };
}

/** 为可视图预处理生成包含方向语义的稳定 cache key。 */
function createMasterVisibilityGraphCacheKey(
  input: Pick<GraphwarPathfindingRouteInput, "bounds" | "routeMaskCacheId" | "routeTolerancePlanePixels">,
) {
  return [
    input.routeMaskCacheId,
    input.bounds.maxX > input.bounds.minX ? "x-right" : "x-left",
    input.routeTolerancePlanePixels,
  ].join("|");
}

/** 将平面网格路线映射回截图路径，并恢复精确目标点。 */
function normalizeSmartPathfindingPathFromPlanePath(
  pathfindingPath: readonly { x: number; y: number }[],
  targetPoint: PixelPoint,
  input: Pick<GraphwarSmartPathfindingPathInput, "bounds" | "boundsRect" | "sourcePath">,
) {
  const appendPoints = pathfindingPath
    .slice(1)
    .map((pathPoint, index, points) =>
      index === points.length - 1 ? targetPoint : planeGridCellCenterToImagePoint(pathPoint, input.boundsRect),
    );
  const normalizedPoints = [...input.sourcePath];
  for (let index = 0; index < appendPoints.length; index += 1) {
    const point = appendPoints[index];
    if (!point) {
      continue;
    }
    // 中间 cell-center 是工具自动创建的空间点；末点恢复用户精确目标，只要求严格 x+。
    normalizedPoints.push(
      index === appendPoints.length - 1
        ? normalizePathPointForStrictForward(point, normalizedPoints.at(-1), input.bounds, input.boundsRect)
        : normalizeAutomaticPathPointForMinimumForwardStep(
            point,
            normalizedPoints.at(-1),
            input.bounds,
            input.boundsRect,
          ),
    );
  }
  return normalizedPoints;
}

/** 用 Graphwar 规则、Step 包络和真实轨迹共同验证候选路径。 */
function validateSmartPathfindingTrajectory(
  input: GraphwarSmartPathfindingPathInput,
  points: readonly PixelPoint[],
  formulaMode: GraphwarTrajectoryFormulaMode,
  pathSearchPolicy: SmartPathSearchRuntimePolicy,
  debugMetrics?: GraphwarPathfindingDebugMetrics,
  wasmRuntime?: GraphwarWasmKernelRuntime,
) {
  if (!pathFollowsGraphRule(points, input.bounds, input.boundsRect)) {
    return {
      followsGraphRule: false,
      reachesTargetBeforeObstacle: false,
    };
  }
  if (
    pathSearchPolicy.type === "step-stateful" &&
    !validateGraphwarStepRoutePath({
      boundaryInset: input.boundaryExpansion,
      bounds: input.bounds,
      boundsRect: input.boundsRect,
      model: pathSearchPolicy.runtime.model,
      points,
      summedArea: pathSearchPolicy.runtime.summedArea,
    }).ok
  ) {
    return {
      followsGraphRule: true,
      reachesTargetBeforeObstacle: false,
    };
  }

  const result = createGraphwarSmartPathfindingTrajectoryResult({
    boundaryExpansion: input.simulationBoundaryExpansion,
    bounds: input.bounds,
    boundsRect: input.boundsRect,
    debugMetrics,
    formulaMode,
    hitTarget: input.hitTarget,
    obstacleMask: input.simulationMask,
    points,
    targetHitRadiusPixels: input.hitTarget.radius,
    ...(wasmRuntime ? { wasmRuntime } : {}),
  });
  return {
    ...(result.blockedPoint ? { blockedPoint: result.blockedPoint } : {}),
    followsGraphRule: true,
    ...(result.pathError === undefined ? {} : { pathError: result.pathError }),
    reachesTargetBeforeObstacle: result.reachesTargetBeforeObstacle,
  };
}

/** 反复移除新增控制点；同一轮都少一个点时，路径质量只作为硬验收后的最后一级 tie-break。 */
function optimizeSmartPathfindingPath(
  input: GraphwarSmartPathfindingPathInput,
  points: readonly PixelPoint[],
  formulaMode: GraphwarTrajectoryFormulaMode,
  pathSearchPolicy: SmartPathSearchRuntimePolicy,
  debugMetrics?: GraphwarPathfindingDebugMetrics,
  wasmRuntime?: GraphwarWasmKernelRuntime,
) {
  let optimized = [...points];
  let changed = true;
  const firstOptimizableIndex = Math.max(1, input.sourcePath.length);
  while (changed) {
    changed = false;
    let bestCandidate: PixelPoint[] | undefined;
    let bestPathError: number | undefined;
    for (let index = firstOptimizableIndex; index < optimized.length - 1 && optimized.length > 2; index += 1) {
      const candidatePath = [...optimized.slice(0, index), ...optimized.slice(index + 1)];
      const validation = validateSmartPathfindingTrajectory(
        input,
        candidatePath,
        formulaMode,
        pathSearchPolicy,
        debugMetrics,
        wasmRuntime,
      );
      if (
        validation.followsGraphRule &&
        validation.reachesTargetBeforeObstacle &&
        (!bestCandidate || compareGraphwarPathErrors(validation.pathError, bestPathError) < 0)
      ) {
        bestCandidate = candidatePath;
        bestPathError = validation.pathError;
      }
    }
    if (bestCandidate) {
      optimized = bestCandidate;
      changed = true;
    }
  }
  return optimized;
}

/** 在 master 内执行完整一键清图，并管理请求级 edge Worker session。 */
async function buildOneClickClearPath(
  requestId: number,
  attempt: GraphwarBackendAttemptIdentity,
  input: GraphwarOneClickClearPathWorkerInput,
  shouldReportIncumbents: boolean,
  shouldCollectDiagnostics: boolean,
  wasmRuntime?: GraphwarWasmKernelRuntime,
): Promise<GraphwarOneClickClearPathWorkerResult> {
  const startedAt = nowMs();
  const timings: GraphwarOneClickClearDebugTiming[] = [];
  const formulaMode = createGraphwarTrajectoryFormulaMode(input.settings);
  const pathSearchSelection = resolveGraphwarPathSearchPolicy(formulaMode.contract, input.routeMode);
  const debugMetrics = shouldCollectDiagnostics
    ? createGraphwarPathfindingDebugMetrics(
        pathSearchSelection.type === "step-glitch",
        wasmRuntime ? { effective: "wasm", requested: "wasm" } : { effective: "typescript", requested: "typescript" },
      )
    : undefined;
  const routeMaskLookup = getMasterRouteMaskFromBase(input, pathSearchSelection.type === "step-stateful");
  timings.push({
    elapsedMs: routeMaskLookup.elapsedMs,
    stage: routeMaskLookup.hasCacheHit ? "route-mask-cache-hit" : "route-mask-cache-miss",
  });
  let pathSearchPolicy: OneClickClearPathSearchRuntimePolicy;
  if (pathSearchSelection.type === "step-stateful") {
    const originPoint = input.pathPoints[0];
    const model =
      originPoint && routeMaskLookup.summedArea
        ? createGraphwarStepRouteModel(imageToGraphPoint(originPoint, input.bounds, input.boundsRect).y, input.settings)
        : undefined;
    if (!model || !routeMaskLookup.summedArea) {
      return createOneClickClearPreflightBlockedResult(startedAt, timings, debugMetrics);
    }
    const runtime = { model, summedArea: routeMaskLookup.summedArea };
    const validationStartedAt = nowMs();
    const prefixValidation = validateGraphwarStepRoutePath({
      boundaryInset: input.boundaryExpansion,
      bounds: input.bounds,
      boundsRect: input.boundsRect,
      model: runtime.model,
      points: input.pathPoints,
      summedArea: runtime.summedArea,
    });
    timings.push({
      elapsedMs: nowMs() - validationStartedAt,
      stage: "validate-prefix",
    });
    if (!prefixValidation.ok) {
      return createOneClickClearPreflightBlockedResult(
        startedAt,
        timings,
        debugMetrics,
        prefixValidation.invalidSegmentIndex,
      );
    }
    pathSearchPolicy = { ...pathSearchSelection, runtime };
  } else if (pathSearchSelection.type === "step-glitch") {
    if (!input.simulationMask) {
      return createOneClickClearPreflightBlockedResult(startedAt, timings, debugMetrics);
    }
    pathSearchPolicy = { ...pathSearchSelection, runtime: { simulationMask: input.simulationMask } };
  } else {
    pathSearchPolicy = pathSearchSelection;
  }
  let dagEdgeSession: OneClickClearDagEdgeSession | undefined;
  let validatedStepGlitchEvidence:
    | {
        path: readonly PixelPoint[];
        prefixEvidence: GraphwarStepGlitchPrefixEvidence;
      }
    | undefined;
  let result: GraphwarOneClickClearPathWorkerResult["result"];
  try {
    // incumbent 只是观察通道；开启搜索动画或托管上报不能改变精确前缀 evidence 的复用语义。
    const prefixEvidence =
      pathSearchPolicy.type === "step-glitch"
        ? getMasterStepGlitchEvidence(input, input.pathPoints, input.prefixTarget)
        : undefined;
    result = await buildGraphwarOneClickClearPath({
      boundaryExpansion: input.boundaryExpansion,
      buildDagEdges: (request) => {
        dagEdgeSession ??= createOneClickClearDagEdgeSession(requestId, attempt, request, wasmRuntime);
        return dagEdgeSession.runBatch(request.jobs);
      },
      bounds: input.bounds,
      boundsRect: input.boundsRect,
      candidates: input.candidates,
      formulaMode,
      ...(debugMetrics ? { debugMetrics } : {}),
      dagEdgeWorkerCount: input.dagEdgeWorkerCount,
      isDeleteOptimizationEnabled: input.isDeleteOptimizationEnabled,
      deleteHitCheckRadiusPixels: input.deleteHitCheckRadiusPixels,
      hitCandidates: input.hitCandidates,
      isCancelled: () => false,
      onDebugTiming: (timing) => timings.push(timing),
      ...(shouldReportIncumbents
        ? {
            onValidatedIncumbent: (incumbent) => {
              if (!debugMetrics) {
                postResponse({
                  attempt,
                  id: requestId,
                  progress: { incumbent },
                  type: "one-click-clear-incumbent",
                });
                return;
              }
              debugMetrics.counters.incumbentReportCount += 1;
              debugMetrics.counters.incumbentTrajectoryPointLoad += incumbent.trajectoryPoints.length;
              const messageStartedAt = nowMs();
              postResponse({
                attempt,
                id: requestId,
                progress: { diagnostics: debugMetrics, incumbent },
                type: "one-click-clear-incumbent",
              });
              debugMetrics.timings.incumbentMessageSendElapsedMs += nowMs() - messageStartedAt;
            },
          }
        : {}),
      ...(pathSearchPolicy.type === "step-glitch"
        ? {
            onValidatedStepGlitchPath: (evidence) => {
              validatedStepGlitchEvidence = evidence;
            },
            ...(prefixEvidence ? { stepGlitchPrefixEvidence: prefixEvidence } : {}),
          }
        : {}),
      pathPoints: input.pathPoints,
      ...(input.prefixTarget ? { prefixTarget: input.prefixTarget } : {}),
      routeMask: {
        mask: routeMaskLookup.mask,
        routeTolerancePlanePixels: input.routeTolerancePlanePixels,
      },
      routeMode: input.routeMode,
      simulationBoundaryExpansion: input.simulationBoundaryExpansion,
      ...(input.simulationMask ? { simulationMask: input.simulationMask } : {}),
      simulationMaskCacheId: input.simulationMaskCacheId,
      ...(wasmRuntime ? { wasmRuntime } : {}),
      ...(pathSearchPolicy.type === "step-stateful"
        ? {
            validateStepRoute: (points) =>
              validateGraphwarStepRoutePath({
                boundaryInset: input.boundaryExpansion,
                bounds: input.bounds,
                boundsRect: input.boundsRect,
                model: pathSearchPolicy.runtime.model,
                points,
                summedArea: pathSearchPolicy.runtime.summedArea,
              }).ok,
          }
        : {}),
    });
  } finally {
    if (dagEdgeSession) {
      timings.push(...dagEdgeSession.dispose());
    }
  }
  if (validatedStepGlitchEvidence) {
    // failure 也可能由主线程提升最后一个自然 incumbent；exact path key 可安全保存该恢复证据。
    setMasterStepGlitchEvidence(input, validatedStepGlitchEvidence.path, validatedStepGlitchEvidence.prefixEvidence);
  }
  return { ...(debugMetrics ? { diagnostics: debugMetrics } : {}), result, timings };
}

/** Worker 内缺少 stateful runtime 或 prefix 无效时统一返回原 preflight-blocked 语义。 */
function createOneClickClearPreflightBlockedResult(
  startedAt: number,
  timings: GraphwarOneClickClearDebugTiming[],
  debugMetrics?: GraphwarPathfindingDebugMetrics,
  invalidSegmentIndex?: number,
): GraphwarOneClickClearPathWorkerResult {
  return {
    ...(debugMetrics ? { diagnostics: debugMetrics } : {}),
    result: {
      elapsedMs: nowMs() - startedAt,
      expandedStates: 0,
      ...(invalidSegmentIndex === undefined ? {} : { invalidSegmentIndex }),
      reason: "preflight-blocked",
      type: "failure",
    },
    timings,
  };
}

/** 复用请求级 edge session 构建一批 DAG 边并收集子 Worker 耗时。 */
async function buildOneClickClearDagEdges(
  requestId: number,
  attempt: GraphwarBackendAttemptIdentity,
  input: GraphwarOneClickClearDagEdgesWorkerInput,
  wasmRuntime?: GraphwarWasmKernelRuntime,
): Promise<GraphwarOneClickClearDagEdgeBuildResult> {
  const session = createOneClickClearDagEdgeSession(requestId, attempt, input, wasmRuntime);
  try {
    const result = await session.runBatch(input.jobs);
    return {
      routes: result.routes,
      timings: [...result.timings, ...session.dispose()],
    };
  } catch (error) {
    session.dispose();
    throw error;
  }
}

/**
 * 一次一键清图请求共用的 DAG 建边 session。
 *
 * Step 动态 DAG 会按 x 层多次提交批次；session 让 child worker、可视图预处理和 Theta* scratch 跨批次复用。
 */
function createOneClickClearDagEdgeSession(
  requestId: number,
  attempt: GraphwarBackendAttemptIdentity,
  input: GraphwarOneClickClearDagEdgesWorkerInput,
  wasmRuntime?: GraphwarWasmKernelRuntime,
): OneClickClearDagEdgeSession {
  const requestedWorkerCount = Math.floor(input.workerCount);
  const configuredWorkerCount =
    Number.isFinite(requestedWorkerCount) && requestedWorkerCount > 0 ? requestedWorkerCount : 1;
  const pathSearchPolicy = resolveGraphwarPathSearchPolicy(
    resolveFormulaModeContract(input.settings.algorithm, input.settings.equation, false),
    input.routeMode,
  );
  if (pathSearchPolicy.type === "step-glitch") {
    throw new Error("Step-glitch does not build ordinary DAG edges");
  }
  const handles: EdgeWorkerHandle[] = [];
  const workerTimings: GraphwarOneClickClearDebugTiming[] = [];
  let activeBatch: OneClickClearDagEdgeBatch | undefined;
  let fallbackWorkerCount = 1;
  let nextRequestId = 1;
  let serialBatchRunning = false;
  let serialRouteContext: GraphwarOneClickClearDagEdgeRouteBuildContext | undefined;
  let sharedInit: GraphwarOneClickClearEdgeWorkerSharedInit | undefined;
  let state: OneClickClearDagEdgeSessionState = "idle";
  let wasmFault: GraphwarWasmFault | undefined;
  const sessionIdentity = createGraphwarWasmSessionIdentity(attempt, requestId, "one-click-clear");

  /** 终止并解绑单个 edge Worker，且只记录一次生命周期耗时。 */
  const finishWorker = (handle: EdgeWorkerHandle) => {
    if (handle.state === "finished") {
      return;
    }
    handle.state = "finished";
    handle.activeRequest = undefined;
    handle.cleanup();
    handle.worker.terminate();
    workerTimings.push({
      detail: {
        type: "dag-edge-worker",
        workerIndex: handle.workerIndex,
      },
      elapsedMs: nowMs() - handle.startedAt,
      stage: "build-dag-edges",
    });
  };

  /** 结束请求级 session，并拒绝尚未结算的活动批次。 */
  const dispose = () => {
    if (state === "disposed") {
      return [];
    }
    state = "disposed";
    const batch = activeBatch;
    activeBatch = undefined;
    if (batch && !batch.isSettled) {
      batch.isSettled = true;
      batch.reject(new Error("One-Click Clear DAG edge session was disposed"));
    }
    for (const handle of handles) {
      finishWorker(handle);
    }
    serialRouteContext?.wasmRouteContext?.dispose();
    serialRouteContext = undefined;
    return workerTimings.splice(0);
  };

  /** 串行执行一组 jobs，并保护批次不得重入。 */
  const runSerialJobs = async (jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[]) => {
    if (serialBatchRunning) {
      throw new Error("One-Click Clear DAG edge batches must run sequentially");
    }
    serialBatchRunning = true;
    try {
      // 只有真正进入串行路径时才支付预处理成本；后续 fallback 批次复用同一上下文。
      serialRouteContext ??= createOneClickClearSerialRouteContext(input, wasmRuntime);
      return await runOneClickClearDagEdgeJobsSerial(serialRouteContext, jobs);
    } finally {
      serialBatchRunning = false;
    }
  };

  /** 将串行结果包装成与并行路径一致的批次响应。 */
  const runSerialBatch = async (
    jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[],
    mode: "parallel-fallback" | "serial",
    workerCount: number,
  ) => {
    const serial = await runSerialJobs(jobs);
    return createOneClickClearDagEdgeBuildResult(serial.routes, mode, workerCount, serial.totals);
  };

  /** 在所有 jobs 完成后按提交顺序结算并行批次。 */
  const resolveParallelBatch = (batch: OneClickClearDagEdgeBatch) => {
    if (batch.isSettled || batch.completedJobIds.size < batch.jobs.length) {
      return;
    }
    batch.isSettled = true;
    activeBatch = undefined;
    state = "idle";
    batch.resolve(
      createOneClickClearDagEdgeBuildResult(
        collectOneClickClearDagEdgeBatchRoutes(batch),
        "parallel",
        batch.workerCount,
        batch.totals,
      ),
    );
  };

  /** 子 Worker 不可用时终止池，并只补跑尚未完成的 jobs。 */
  const switchToSerialFallback = () => {
    if (state === "disposed" || state === "failed" || state === "fallback") {
      return;
    }
    const batch = activeBatch;
    fallbackWorkerCount = Math.max(fallbackWorkerCount, batch?.workerCount ?? handles.length, 1);
    state = "fallback";
    for (const handle of handles) {
      finishWorker(handle);
    }
    if (!batch || batch.isSettled) {
      return;
    }

    batch.isSettled = true;
    activeBatch = undefined;
    // 已完成的并行 job 已写入 batch，串行 fallback 只补跑剩余部分。
    void runSerialJobs(batch.jobs.filter((job) => !batch.completedJobIds.has(job.id)))
      .then((serial) => {
        for (const route of serial.routes) {
          batch.routesByJobId.set(route.jobId, route);
        }
        batch.resolve(
          createOneClickClearDagEdgeBuildResult(
            collectOneClickClearDagEdgeBatchRoutes(batch),
            "parallel-fallback",
            fallbackWorkerCount,
            {
              routeMapPixelsElapsedMs: batch.totals.routeMapPixelsElapsedMs + serial.totals.routeMapPixelsElapsedMs,
              routePathfindingElapsedMs:
                batch.totals.routePathfindingElapsedMs + serial.totals.routePathfindingElapsedMs,
            },
          ),
        );
      })
      .catch((error: unknown) => {
        batch.reject(error instanceof Error ? error : new Error(String(error)));
      });
  };

  /** Child typed fault 先终止全部 siblings/session 并拒绝批次，再原样通知页面 fuse。 */
  const failWithWasmFault = (message: Extract<GraphwarBackendControlMessage, { type: "wasm-fault" }>) => {
    if (state === "disposed" || state === "failed") {
      return;
    }
    const fault = new GraphwarWasmFault(message.fault.code, message.fault.message);
    wasmFault = fault;
    state = "failed";
    const batch = activeBatch;
    activeBatch = undefined;
    for (const handle of handles) {
      finishWorker(handle);
    }
    if (batch && !batch.isSettled) {
      batch.isSettled = true;
      batch.reject(wasmFault);
    }
    workerScope.postMessage(message);
    fault.markReported();
  };

  /** 向空闲且就绪的 edge Worker 分配当前批次的下一个 job。 */
  const assignNextJob = (handle: EdgeWorkerHandle) => {
    const batch = activeBatch;
    if (state !== "running" || !batch || batch.isSettled || handle.state !== "ready" || handle.activeRequest) {
      return;
    }
    const job = batch.jobs[batch.nextJobIndex];
    if (!job) {
      resolveParallelBatch(batch);
      return;
    }
    batch.nextJobIndex += 1;

    const requestId = nextRequestId;
    nextRequestId += 1;
    handle.activeRequest = { job, requestId };
    try {
      handle.worker.postMessage({
        attempt,
        job,
        requestId,
        session: sessionIdentity,
        type: "job",
      } satisfies GraphwarOneClickClearEdgeWorkerRequest);
    } catch {
      handle.activeRequest = undefined;
      switchToSerialFallback();
    }
  };

  /** 校验请求身份后合并单边结果，并继续驱动该 Worker。 */
  const handleJobResult = (
    handle: EdgeWorkerHandle,
    requestId: number,
    result: GraphwarOneClickClearEdgeWorkerJobResult,
  ) => {
    const batch = activeBatch;
    const activeRequest = handle.activeRequest;
    if (state !== "running" || !batch || batch.isSettled) {
      return;
    }
    if (
      !activeRequest ||
      activeRequest.requestId !== requestId ||
      activeRequest.job.id !== result.jobId ||
      (result.type !== "unreachable" && result.type !== activeRequest.job.type)
    ) {
      switchToSerialFallback();
      return;
    }

    batch.completedJobIds.add(result.jobId);
    batch.totals.routePathfindingElapsedMs += result.routePathfindingElapsedMs;
    batch.totals.routeMapPixelsElapsedMs += result.routeMapPixelsElapsedMs;
    batch.routesByJobId.set(result.jobId, createOneClickClearDagEdgeRoute(result));
    handle.activeRequest = undefined;
    assignNextJob(handle);
    resolveParallelBatch(batch);
  };

  /** 创建 edge Worker 并立即触发 module 加载；完整 init 等 Master 预处理结束后发送。 */
  const createEdgeWorkerHandle = (workerIndex: number) => {
    const worker = new Worker(new URL("./one-click-clear/edge.worker.ts", import.meta.url), {
      name: `graphwar-one-click-clear-edge-${workerIndex}`,
      type: "module",
    });
    const backendSlot = createGraphwarWorkerBackendSlot({
      configuration: backendRuntime.getNestedConfiguration(attempt),
      onInfrastructureFailure: () => switchToSerialFallback(),
      onWasmFault: (message) => {
        if (message.fault.code === "module-clone") {
          switchToSerialFallback();
          return;
        }
        failWithWasmFault(message);
      },
      role: "one-click-clear-edge",
      shouldAcceptWasmFault: (message) => {
        if (message.context.type === "initialization") {
          return true;
        }
        if (
          (message.context.type !== "edge-session" && message.context.type !== "edge-job") ||
          !graphwarBackendAttemptIdentitiesAreEqual(message.context.attempt, attempt) ||
          !graphwarWasmSessionIdentitiesAreEqual(message.context.session, sessionIdentity)
        ) {
          return false;
        }
        const activeHandle = handles.find((candidate) => candidate.worker === worker);
        return message.context.type === "edge-session" || message.context.jobId === activeHandle?.activeRequest?.job.id;
      },
      worker,
    });
    if (backendSlot.getState().type === "failed") {
      worker.terminate();
      return undefined;
    }
    const handle: EdgeWorkerHandle = {
      backendSlot,
      cleanup: () => cleanup(),
      startedAt: nowMs(),
      state: "created",
      worker,
      workerIndex,
    };
    /** 将 edge Worker 响应路由到就绪、失败或 job 结算流程。 */
    const handleMessage = (event: MessageEvent<GraphwarOneClickClearEdgeWorkerResponse>) => {
      const response = event.data;
      if (handle.state === "finished") {
        return;
      }
      if (handle.backendSlot.handleMessage(response)) {
        return;
      }
      if (response.workerIndex !== handle.workerIndex) {
        switchToSerialFallback();
        return;
      }
      if (!graphwarBackendAttemptIdentitiesAreEqual(response.attempt, attempt)) {
        switchToSerialFallback();
        return;
      }
      if (response.type === "ready") {
        if (handle.state !== "initializing") {
          switchToSerialFallback();
          return;
        }
        handle.state = "ready";
        assignNextJob(handle);
        return;
      }
      if (response.type === "error") {
        switchToSerialFallback();
        return;
      }
      handleJobResult(handle, response.requestId, response.result);
    };
    /** 将消息反序列化失败切换到串行 fallback。 */
    const handleMessageError = () => switchToSerialFallback();
    /** 将 edge Worker 运行时失败切换到串行 fallback。 */
    const handleError = () => switchToSerialFallback();
    /** 统一解绑 edge Worker 的事件监听器。 */
    const cleanup = () => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("messageerror", handleMessageError);
      worker.removeEventListener("error", handleError);
    };
    worker.addEventListener("message", handleMessage);
    worker.addEventListener("messageerror", handleMessageError);
    worker.addEventListener("error", handleError);
    handles.push(handle);
    return handle;
  };

  /** 将同一条消息中的 mask 与共享 cache 原子发送，structured clone 会保留二者的引用绑定。 */
  const initializeEdgeWorkerHandle = (handle: EdgeWorkerHandle, init: GraphwarOneClickClearEdgeWorkerSharedInit) => {
    if (handle.state !== "created") {
      return;
    }
    handle.state = "initializing";
    try {
      handle.worker.postMessage({
        attempt,
        context: { ...init, workerIndex: handle.workerIndex },
        session: sessionIdentity,
        type: "init",
      } satisfies GraphwarOneClickClearEdgeWorkerRequest);
    } catch {
      switchToSerialFallback();
    }
  };

  /** 初始化并行批次状态，并启动所有可用 Worker。 */
  const runParallelBatch = (jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[], workerCount: number) =>
    new Promise<GraphwarOneClickClearDagEdgeBuildResult>((resolve, reject) => {
      const batch: OneClickClearDagEdgeBatch = {
        completedJobIds: new Set(),
        jobs,
        nextJobIndex: 0,
        reject,
        resolve,
        routesByJobId: new Map(),
        isSettled: false,
        totals: {
          routeMapPixelsElapsedMs: 0,
          routePathfindingElapsedMs: 0,
        },
        workerCount,
      };
      activeBatch = batch;
      state = "running";
      while (handles.length < workerCount && state === "running") {
        try {
          createEdgeWorkerHandle(handles.length + 1);
        } catch {
          switchToSerialFallback();
        }
      }
      if (state !== "running") {
        return;
      }
      try {
        /*
         * Worker module 加载与这次同步预处理并行。可视图数据只构建一次，再由 structured clone
         * 分发私有副本，避免每个 Worker 重复扫描同一 mask；Theta* 没有共享预处理。
         * 2026-07-28 用真实 346,500-byte mask、40 条 visibility edge、4 Workers 交错测试：
         * 56 次中位数从约 196.3ms 变为 202.5ms（+3.2%）。当前仍保留该编排以验证其他地形和
         * 更重批次；不要只凭这组小批次删除，也不要把 cache clone 成本忽略不计。
         *
         * Step-stateful 还在这里构建一次 model 和约 1.39MB summed-area，再随 init 分发，避免
         * 4 Workers 重复扫描 mask。2026-07-28 同一真实 mask、40 条 Step edge 的热态交错测试
         * 各 56 次：结果均为 38 条可达，中位数约 278.9ms 降到 276.0ms，均值约改善 1.0%。
         */
        sharedInit ??= prepareGraphwarOneClickClearEdgeWorkerSharedInit(
          input,
          pathSearchPolicy,
          wasmRuntime !== undefined,
        );
      } catch {
        switchToSerialFallback();
        return;
      }
      for (const handle of handles) {
        initializeEdgeWorkerHandle(handle, sharedInit);
        assignNextJob(handle);
      }
    });

  /** 选择空批次、串行、fallback 或并行执行路径，并强制批次串行提交。 */
  const runBatch = async (jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[]) => {
    if (state === "disposed") {
      throw new Error("One-Click Clear DAG edge session is disposed");
    }
    if (state === "failed") {
      throw wasmFault ?? new GraphwarWasmFault("trap", "One-Click Clear edge Worker backend failed");
    }
    if (state === "running" || serialBatchRunning) {
      throw new Error("One-Click Clear DAG edge batches must run sequentially");
    }
    if (jobs.length === 0) {
      return { routes: [], timings: [] };
    }
    if (state === "fallback") {
      return runSerialBatch(jobs, "parallel-fallback", fallbackWorkerCount);
    }

    if (typeof Worker === "undefined" || configuredWorkerCount <= 1 || (handles.length === 0 && jobs.length <= 1)) {
      state = "running";
      try {
        return await runSerialBatch(jobs, "serial", 1);
      } finally {
        if (state === "running") {
          state = "idle";
        }
      }
    }

    return runParallelBatch(jobs, Math.min(configuredWorkerCount, jobs.length));
  };

  return { dispose, runBatch };
}

/**
 * 在 Master 唯一构造完整的请求级 Worker init，避免 cache/runtime 半状态扩散到调度层。
 *
 * 调用发生在 child Worker 创建之后，使 module 加载与同步预处理重叠；每个 Worker 随后只追加 lane 身份。
 */
function prepareGraphwarOneClickClearEdgeWorkerSharedInit(
  input: GraphwarOneClickClearDagEdgesWorkerInput,
  policy: OneClickClearDagEdgePolicy,
  isWasmBackend: boolean,
): GraphwarOneClickClearEdgeWorkerSharedInit {
  const routeInit = (
    policy.routeMode === "visibility-graph"
      ? {
          routeMode: policy.routeMode,
          routePreprocessing: isWasmBackend
            ? ({ type: "wasm" } as const)
            : ({
                type: "typescript",
                visibilityGraphObstacleData: createGraphwarVisibilityGraphObstacleData({
                  bounds: input.bounds,
                  routeMask: input.routeMask,
                  routeTolerancePlanePixels: input.routeTolerancePlanePixels,
                }),
              } as const),
        }
      : { routeMode: policy.routeMode }
  ) satisfies GraphwarOneClickClearEdgeWorkerRouteInit;
  const initBase = {
    bounds: input.bounds,
    boundsRect: input.boundsRect,
    boundaryExpansion: input.boundaryExpansion,
    routeOriginPoint: input.routeOriginPoint,
    routeMask: input.routeMask,
    routeTolerancePlanePixels: input.routeTolerancePlanePixels,
    ...routeInit,
  };
  if (policy.type === "stateless") {
    return { ...initBase, type: policy.type };
  }

  const model = createGraphwarStepRouteModel(
    imageToGraphPoint(input.routeOriginPoint, input.bounds, input.boundsRect).y,
    input.settings,
  );
  if (!model) {
    throw new Error("Step-stateful DAG route has no valid numeric model");
  }
  return {
    ...initBase,
    stepRouteRuntime: {
      model,
      routeMask: input.routeMask,
      summedArea: getOrCreateMasterStepSummedArea(input.routeMask),
    },
    type: policy.type,
  };
}

/** 串行与 parallel-fallback 共用同一份请求级预处理材料。 */
function createOneClickClearSerialRouteContext(
  input: GraphwarOneClickClearDagEdgesWorkerInput,
  wasmRuntime?: GraphwarWasmKernelRuntime,
): GraphwarOneClickClearDagEdgeRouteBuildContext {
  const pathSearchPolicy = resolveGraphwarPathSearchPolicy(
    resolveFormulaModeContract(input.settings.algorithm, input.settings.equation, false),
    input.routeMode,
  );
  if (pathSearchPolicy.type === "step-glitch") {
    throw new Error("Step-glitch does not build ordinary DAG edges");
  }
  const visibilityGraphObstacleData =
    !wasmRuntime && pathSearchPolicy.routeMode === "visibility-graph"
      ? createGraphwarVisibilityGraphObstacleData({
          bounds: input.bounds,
          routeMask: input.routeMask,
          routeTolerancePlanePixels: input.routeTolerancePlanePixels,
        })
      : undefined;
  const thetaStarScratch: GraphwarThetaStarScratch | undefined =
    pathSearchPolicy.routeMode === "theta-star" ? createGraphwarThetaStarScratch() : undefined;
  const contextBase = {
    boundaryExpansion: input.boundaryExpansion,
    bounds: input.bounds,
    boundsRect: input.boundsRect,
    routeMask: input.routeMask,
    routeTolerancePlanePixels: input.routeTolerancePlanePixels,
    ...(thetaStarScratch ? { thetaStarScratch } : {}),
    ...(visibilityGraphObstacleData ? { visibilityGraphObstacleData } : {}),
  };
  if (pathSearchPolicy.type === "stateless") {
    return {
      ...contextBase,
      ...pathSearchPolicy,
      ...(wasmRuntime
        ? {
            wasmRouteContext: createGraphwarWasmRouteContext(wasmRuntime, {
              boundaryExpansion: input.boundaryExpansion,
              bounds: input.bounds,
              boundsRect: input.boundsRect,
              routeOriginPoint: imageToGraphPoint(input.routeOriginPoint, input.bounds, input.boundsRect),
              routeTolerancePlanePixels: input.routeTolerancePlanePixels,
              sourceMask: input.routeMask,
              sourceMaskType: "route",
            }),
          }
        : {}),
    };
  }
  const model = createGraphwarStepRouteModel(
    imageToGraphPoint(input.routeOriginPoint, input.bounds, input.boundsRect).y,
    input.settings,
  );
  if (!model) {
    throw new Error("Step-stateful DAG route has no valid numeric model");
  }
  return {
    ...contextBase,
    ...pathSearchPolicy,
    runtime: {
      model,
      routeMask: input.routeMask,
      summedArea: getOrCreateMasterStepSummedArea(input.routeMask),
    },
    ...(wasmRuntime
      ? {
          wasmRouteContext: createGraphwarWasmRouteContext(wasmRuntime, {
            boundaryExpansion: input.boundaryExpansion,
            bounds: input.bounds,
            boundsRect: input.boundsRect,
            routeOriginPoint: imageToGraphPoint(input.routeOriginPoint, input.bounds, input.boundsRect),
            routeTolerancePlanePixels: input.routeTolerancePlanePixels,
            sourceMask: input.routeMask,
            sourceMaskType: "route",
            stepRouteModel: {
              ...model,
              qualityTargetPlanePixels: graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
            },
          }),
        }
      : {}),
  };
}

/** 按输入顺序串行建边；调用方负责 session 状态与 mode timing。 */
async function runOneClickClearDagEdgeJobsSerial(
  context: GraphwarOneClickClearDagEdgeRouteBuildContext,
  jobs: readonly GraphwarOneClickClearDagEdgeBuildJob[],
) {
  const routes: GraphwarOneClickClearDagEdgeRoute[] = [];
  const totals: EdgeRouteTimingTotals = {
    routeMapPixelsElapsedMs: 0,
    routePathfindingElapsedMs: 0,
  };
  for (const job of jobs) {
    const result = await buildOneClickClearDagEdgeRoute(context, job);
    totals.routePathfindingElapsedMs += result.routePathfindingElapsedMs;
    totals.routeMapPixelsElapsedMs += result.routeMapPixelsElapsedMs;
    routes.push(createOneClickClearDagEdgeRoute(result));
  }
  return { routes, totals };
}

/** 统一构造 DAG 建边结果及其执行模式和几何耗时。 */
function createOneClickClearDagEdgeBuildResult(
  routes: readonly GraphwarOneClickClearDagEdgeRoute[],
  mode: "parallel" | "parallel-fallback" | "serial",
  workerCount: number,
  totals: EdgeRouteTimingTotals,
): GraphwarOneClickClearDagEdgeBuildResult {
  return {
    routes,
    timings: [
      {
        detail: {
          mode,
          type: "dag-edge-mode",
          workerCount,
        },
        elapsedMs: 0,
        stage: "build-dag-edges",
      },
      {
        elapsedMs: totals.routePathfindingElapsedMs,
        stage: "route-pathfinding",
      },
      {
        elapsedMs: totals.routeMapPixelsElapsedMs,
        stage: "route-map-pixels",
      },
    ],
  };
}

/** 并行完成顺序不稳定；最终始终按提交 jobs 顺序合并。 */
function collectOneClickClearDagEdgeBatchRoutes(batch: OneClickClearDagEdgeBatch): GraphwarOneClickClearDagEdgeRoute[] {
  return batch.jobs.map((job) => {
    const route = batch.routesByJobId.get(job.id);
    if (!route) {
      throw new Error("One-Click Clear DAG edge batch is missing a completed job result");
    }
    return route;
  });
}

/** 去掉 Worker timing 后保留同一个原子 DAG 边结果。 */
function createOneClickClearDagEdgeRoute(
  result: GraphwarOneClickClearEdgeWorkerJobResult,
): GraphwarOneClickClearDagEdgeRoute {
  if (result.type === "unreachable") {
    return { jobId: result.jobId, type: result.type };
  }
  if (result.type === "stateless") {
    return { jobId: result.jobId, route: result.route, type: result.type };
  }
  return {
    jobId: result.jobId,
    route: result.route,
    stepRouteEndState: result.stepRouteEndState,
    type: result.type,
  };
}

/** 将 master 响应发送到主线程。 */
function postResponse(response: GraphwarPathfindingWorkerResponse) {
  workerScope.postMessage(response);
}
