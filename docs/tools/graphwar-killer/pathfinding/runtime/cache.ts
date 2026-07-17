import { nowMs } from "../../core/time";
import { clonePixelPoint, type BoundsRect, type GraphBounds, type PixelPoint } from "../../core/types";
import { addSoldierAreasToObstacleMask, dilateObstacleMask, type GraphwarDetectionBox } from "../../detection/objects";
import { formulaModeUsesStepGlitch } from "../../formula/generation/capabilities";
import type { GraphwarTrajectoryFormulaSettings } from "../../formula/trajectory/sampling";
import type { GraphwarOneClickClearCandidate } from "../one-click-clear/search";
import { createRouteMaskCacheKey } from "../routing/visibility-graph";
import type {
  GraphwarOneClickClearPathWorkerInput,
  GraphwarOneClickClearPathWorkerResult,
  GraphwarSmartPathfindingPathInput,
  GraphwarSmartPathfindingPathResult,
} from "./protocol";

const smartPathfindingResultCacheLimit = 64;
const oneClickClearResultCacheLimit = 16;

/** 页面侧 route tolerance 派生 mask 缓存项。 */
export interface GraphwarRouteMaskCacheEntry {
  /** 页面内基础障碍 mask 稳定 id；Worker 用它识别同一个 base mask。 */
  id: number;
  /** 膨胀或腐蚀后的 mask。 */
  mask: Uint8Array;
}

/** 结果缓存命中/未命中的调试耗时，调用方负责并入页面调试列表。 */
export interface GraphwarPathfindingResultCacheTimingEntry {
  /** 缓存查询耗时，单位毫秒。 */
  elapsedMs: number;
  /** 被测量的页面侧结果缓存阶段。 */
  stage:
    | "one-click-clear-result-cache-hit"
    | "one-click-clear-result-cache-miss"
    | "result-cache-hit"
    | "result-cache-miss";
}

/** 单个原始 mask 最近一次友军障碍派生结果。 */
interface FriendlyObstacleMaskCacheEntry {
  /** 派生 mask 输入摘要；同一个原始 mask 在不同士兵/边界设置下不能混用。 */
  key: string;
  /** 已写入友方士兵区域的障碍 mask。 */
  mask: Uint8Array;
}

/** 集中维护智能寻路页面侧缓存，避免页面脚本知道每个缓存的失效和 clone 细节。 */
export function createGraphwarPathfindingCacheController() {
  const obstacleMaskIds = new WeakMap<Uint8Array, number>();
  const routeMaskCache = new WeakMap<Uint8Array, Map<string, GraphwarRouteMaskCacheEntry>>();
  const friendlyObstacleMaskCache = new WeakMap<Uint8Array, FriendlyObstacleMaskCacheEntry>();
  const smartPathfindingResultCache = new Map<string, GraphwarSmartPathfindingPathResult>();
  const oneClickClearResultCache = new Map<string, GraphwarOneClickClearPathWorkerResult>();
  let nextRouteMaskCacheId = 1;

  /** 读取并深复制普通智能寻路缓存结果。 */
  function getCachedSmartPathfindingResult(
    cacheKey: string,
    onTiming?: (timing: GraphwarPathfindingResultCacheTimingEntry) => void,
  ) {
    const startedAt = nowMs();
    const cached = smartPathfindingResultCache.get(cacheKey);
    onTiming?.({
      elapsedMs: nowMs() - startedAt,
      stage: cached ? "result-cache-hit" : "result-cache-miss",
    });
    return cached ? cloneSmartPathfindingPathResult(cached) : undefined;
  }

  /** 去除本次耗时后缓存普通智能寻路结果。 */
  function cacheSmartPathfindingResult(cacheKey: string, result: GraphwarSmartPathfindingPathResult) {
    setBoundedResultCacheEntry(
      smartPathfindingResultCache,
      cacheKey,
      cloneSmartPathfindingPathResultWithoutTimings(result),
      smartPathfindingResultCacheLimit,
    );
  }

  /** 读取并深复制一键清图缓存结果。 */
  function getCachedOneClickClearResult(
    cacheKey: string,
    onTiming?: (timing: GraphwarPathfindingResultCacheTimingEntry) => void,
  ) {
    const startedAt = nowMs();
    const cached = oneClickClearResultCache.get(cacheKey);
    onTiming?.({
      elapsedMs: nowMs() - startedAt,
      stage: cached ? "one-click-clear-result-cache-hit" : "one-click-clear-result-cache-miss",
    });
    return cached ? cloneOneClickClearPathWorkerResult(cached) : undefined;
  }

  /** 去除本次耗时后缓存一键清图结果。 */
  function cacheOneClickClearResult(cacheKey: string, result: GraphwarOneClickClearPathWorkerResult) {
    setBoundedResultCacheEntry(
      oneClickClearResultCache,
      cacheKey,
      cloneOneClickClearPathWorkerResultWithoutTimings(result),
      oneClickClearResultCacheLimit,
    );
  }

  /** 为可选 mask 返回稳定 id，缺失时使用不冲突的零值。 */
  function getOptionalMaskCacheId(mask: Uint8Array | undefined) {
    return mask ? getMaskCacheId(mask) : 0;
  }

  /** 编码所有影响普通智能寻路结果的输入。 */
  function createSmartPathfindingResultCacheKey(input: GraphwarSmartPathfindingPathInput) {
    return JSON.stringify([
      "smart-path-result-v3",
      createGraphBoundsCacheKey(input.bounds),
      createBoundsRectCacheKey(input.boundsRect),
      input.boundaryExpansion,
      input.deleteOptimizationEnabled,
      input.routeMode,
      input.routeMaskCacheId,
      input.routeTolerancePlanePixels,
      input.simulationBoundaryExpansion,
      input.simulationMaskCacheId,
      createTrajectorySettingsCacheKey(input.settings, getOptionalMaskCacheId(input.settings.stepGlitchObstacleMask)),
      createPointArrayCacheKey(input.sourcePath),
      input.prefixTarget ? createTargetCircleCacheKey(input.prefixTarget) : undefined,
      createPointCacheKey(input.targetPoint),
      createTargetCircleCacheKey(input.hitTarget),
    ]);
  }

  /** 编码所有影响一键清图结果的输入。 */
  function createOneClickClearResultCacheKey(input: GraphwarOneClickClearPathWorkerInput) {
    // 规范输入复用 simulation 快照 id；低层 fallback 仍按实际公式 mask 区分结果身份。
    const stepGlitchObstacleMaskId =
      input.settings.stepGlitchObstacleMask === input.simulationMask
        ? input.simulationMaskCacheId
        : getOptionalMaskCacheId(input.settings.stepGlitchObstacleMask);
    return JSON.stringify([
      "one-click-clear-result-v4",
      createGraphBoundsCacheKey(input.bounds),
      createBoundsRectCacheKey(input.boundsRect),
      input.boundaryExpansion,
      input.deleteOptimizationEnabled,
      input.deleteHitCheckRadiusPixels,
      input.routeMode,
      input.routeMaskCacheId,
      input.routeTolerancePlanePixels,
      input.simulationBoundaryExpansion,
      input.simulationMaskCacheId,
      createTrajectorySettingsCacheKey(input.settings, stepGlitchObstacleMaskId),
      createPointArrayCacheKey(input.pathPoints),
      input.prefixTarget ? createTargetCircleCacheKey(input.prefixTarget) : undefined,
      input.candidates.map(createOneClickClearCandidateCacheKey),
      input.hitCandidates.map(createOneClickClearCandidateCacheKey),
    ]);
  }

  /** 复用同一原始 mask 与友军集合对应的障碍副本。 */
  function getCachedFriendlyObstacleMask(
    sourceMask: Uint8Array,
    edgeRect: BoundsRect,
    friendlySoldiers: readonly GraphwarDetectionBox[],
    soldierHitRadiusPixels: number,
  ) {
    const key = createFriendlyObstacleMaskCacheKey(edgeRect, friendlySoldiers, soldierHitRadiusPixels);
    const cached = friendlyObstacleMaskCache.get(sourceMask);
    if (cached?.key === key) {
      return cached.mask;
    }

    const mask = new Uint8Array(sourceMask);
    addSoldierAreasToObstacleMask(mask, edgeRect, friendlySoldiers, soldierHitRadiusPixels);
    friendlyObstacleMaskCache.set(sourceMask, {
      key,
      mask,
    });
    return mask;
  }

  /** 读取指定路线容差的派生 mask。 */
  function getCachedRouteMask(mask: Uint8Array, routeTolerance: number): GraphwarRouteMaskCacheEntry {
    return getCachedRouteMaskWithStatus(mask, routeTolerance).entry;
  }

  /** 为 mask 对象分配页面生命周期内稳定的缓存 id。 */
  function getMaskCacheId(mask: Uint8Array) {
    const cached = obstacleMaskIds.get(mask);
    if (cached !== undefined) {
      return cached;
    }

    const id = nextRouteMaskCacheId;
    nextRouteMaskCacheId += 1;
    obstacleMaskIds.set(mask, id);
    return id;
  }

  /** 读取或构建路线 mask，并同时返回命中状态。 */
  function getCachedRouteMaskWithStatus(mask: Uint8Array, routeTolerance: number) {
    const key = createRouteMaskCacheKey(routeTolerance);
    let entries = routeMaskCache.get(mask);
    if (!entries) {
      entries = new Map<string, GraphwarRouteMaskCacheEntry>();
      routeMaskCache.set(mask, entries);
    }

    const cached = entries.get(key);
    if (cached) {
      return {
        cacheHit: true,
        entry: cached,
      };
    }

    const entry: GraphwarRouteMaskCacheEntry = {
      id: getMaskCacheId(mask),
      mask: dilateObstacleMask(mask, routeTolerance),
    };
    entries.set(key, entry);
    return {
      cacheHit: false,
      entry,
    };
  }

  /** 清空依赖路径设置的结果缓存，保留仍可复用的 mask 缓存。 */
  function invalidateResultCache() {
    smartPathfindingResultCache.clear();
    oneClickClearResultCache.clear();
  }

  return {
    cacheOneClickClearResult,
    cacheSmartPathfindingResult,
    createOneClickClearResultCacheKey,
    createSmartPathfindingResultCacheKey,
    getCachedFriendlyObstacleMask,
    getCachedOneClickClearResult,
    getCachedRouteMask,
    getCachedRouteMaskWithStatus,
    getCachedSmartPathfindingResult,
    getMaskCacheId,
    invalidateResultCache,
  };
}

/** 结果缓存按 FIFO 做小容量上限，避免连续尝试大量目标时长期持有大路径数组。 */
function setBoundedResultCacheEntry<TResult>(
  cache: Map<string, TResult>,
  cacheKey: string,
  result: TResult,
  limit: number,
) {
  if (cache.has(cacheKey)) {
    cache.delete(cacheKey);
  }
  cache.set(cacheKey, result);
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") {
      return;
    }
    cache.delete(oldestKey);
  }
}

/** 把 Graphwar 坐标范围编码成 JSON key 片段。 */
function createGraphBoundsCacheKey(bounds: GraphBounds) {
  return [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY];
}

/** 把截图边界编码成 JSON key 片段。 */
function createBoundsRectCacheKey(rect: BoundsRect) {
  return [rect.x, rect.y, rect.width, rect.height];
}

/** 把像素点编码成 JSON key 片段。 */
function createPointCacheKey(point: PixelPoint) {
  return [point.x, point.y];
}

/** 按原顺序编码像素路径。 */
function createPointArrayCacheKey(points: readonly PixelPoint[]) {
  return points.map(createPointCacheKey);
}

/** 把目标圆编码成 JSON key 片段。 */
function createTargetCircleCacheKey(target: { center: PixelPoint; radius: number }) {
  return [createPointCacheKey(target.center), target.radius];
}

/** 只编码实际影响本次轨迹的公式设置与 mask 身份。 */
function createTrajectorySettingsCacheKey(
  settings: GraphwarTrajectoryFormulaSettings,
  stepGlitchObstacleMaskId: number,
) {
  const stepGlitchMode = formulaModeUsesStepGlitch(settings.algorithm, settings.equation, settings.stepGlitchMode);
  return [
    settings.algorithm,
    settings.decimalPlaces,
    settings.equation,
    settings.secondOrderLaunchAngleMode ?? "full-precision",
    settings.formulaPathSteepness,
    settings.steepness,
    stepGlitchMode,
    // 只有实际生效的 Step 邪道才消费障碍 mask；休眠偏好不能分裂缓存身份。
    stepGlitchMode ? stepGlitchObstacleMaskId : 0,
    settings.stepOverflowProtection,
  ];
}

/** 把一键清图候选编码成稳定 key 片段。 */
function createOneClickClearCandidateCacheKey(candidate: GraphwarOneClickClearCandidate) {
  return [candidate.id, candidate.enemy, createPointCacheKey(candidate.hitCenter), candidate.hitRadius];
}

/** 复制普通智能寻路结果并移除请求级耗时。 */
function cloneSmartPathfindingPathResultWithoutTimings(result: GraphwarSmartPathfindingPathResult) {
  return {
    ...cloneSmartPathfindingPathResult(result),
    timings: [],
  };
}

/** 深复制普通智能寻路结果的小型可变结构。 */
function cloneSmartPathfindingPathResult(
  result: GraphwarSmartPathfindingPathResult,
): GraphwarSmartPathfindingPathResult {
  return {
    ...(result.blockedPoint ? { blockedPoint: clonePixelPoint(result.blockedPoint) } : {}),
    ...(result.failureReason ? { failureReason: result.failureReason } : {}),
    ...(result.invalidSegmentIndex === undefined ? {} : { invalidSegmentIndex: result.invalidSegmentIndex }),
    ...(result.path ? { path: result.path.map(clonePixelPoint) } : {}),
    timings: result.timings.map((timing) => ({
      elapsedMs: timing.elapsedMs,
      stage: timing.stage,
    })),
  };
}

/** 复制一键清图 Worker 结果并移除请求级耗时。 */
function cloneOneClickClearPathWorkerResultWithoutTimings(result: GraphwarOneClickClearPathWorkerResult) {
  return {
    result: cloneOneClickClearResult(result.result),
    timings: [],
  };
}

/** 深复制一键清图 Worker 结果和耗时明细。 */
function cloneOneClickClearPathWorkerResult(
  result: GraphwarOneClickClearPathWorkerResult,
): GraphwarOneClickClearPathWorkerResult {
  return {
    result: cloneOneClickClearResult(result.result),
    timings: result.timings.map((timing) => ({
      detail: timing.detail,
      elapsedMs: timing.elapsedMs,
      stage: timing.stage,
    })),
  };
}

/** 按成功或失败分支复制一键清图业务结果。 */
function cloneOneClickClearResult(result: GraphwarOneClickClearPathWorkerResult["result"]) {
  if (result.type === "success") {
    return {
      elapsedMs: result.elapsedMs,
      expression: result.expression,
      expandedStates: result.expandedStates,
      ...(result.launchAngleRadians === undefined ? {} : { launchAngleRadians: result.launchAngleRadians }),
      pathPoints: result.pathPoints.map(clonePixelPoint),
      targetIds: [...result.targetIds],
      type: result.type,
    };
  }

  return {
    elapsedMs: result.elapsedMs,
    expandedStates: result.expandedStates,
    ...(result.invalidSegmentIndex === undefined ? {} : { invalidSegmentIndex: result.invalidSegmentIndex }),
    reason: result.reason,
    type: result.type,
  };
}

/** 输入相同才复用派生 mask；士兵写入顺序不影响结果，因此按稳定 key 排序。 */
function createFriendlyObstacleMaskCacheKey(
  edgeRect: BoundsRect,
  friendlySoldiers: readonly GraphwarDetectionBox[],
  soldierHitRadiusPixels: number,
) {
  const soldierKeys = friendlySoldiers.map(createFriendlySoldierObstacleMaskCacheKey).sort();
  return [edgeRect.x, edgeRect.y, edgeRect.width, edgeRect.height, soldierHitRadiusPixels, ...soldierKeys].join("|");
}

/** 把单个友军命中区域编码成稳定 mask key 片段。 */
function createFriendlySoldierObstacleMaskCacheKey(soldier: GraphwarDetectionBox) {
  return [soldier.id, soldier.sourceCenterX, soldier.sourceCenterY, soldier.hitRadius].join(":");
}
