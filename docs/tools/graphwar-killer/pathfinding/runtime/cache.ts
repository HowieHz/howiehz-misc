import { nowMs } from "../../core/time";
import { createPixelPoint, type BoundsRect, type GraphBounds, type PixelPoint } from "../../core/types";
import { addSoldierAreasToObstacleMask, dilateObstacleMask, type GraphwarDetectionBox } from "../../detection/objects";
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

  function cacheSmartPathfindingResult(cacheKey: string, result: GraphwarSmartPathfindingPathResult) {
    setBoundedResultCacheEntry(
      smartPathfindingResultCache,
      cacheKey,
      cloneSmartPathfindingPathResultWithoutTimings(result),
      smartPathfindingResultCacheLimit,
    );
  }

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

  function cacheOneClickClearResult(cacheKey: string, result: GraphwarOneClickClearPathWorkerResult) {
    setBoundedResultCacheEntry(
      oneClickClearResultCache,
      cacheKey,
      cloneOneClickClearPathWorkerResultWithoutTimings(result),
      oneClickClearResultCacheLimit,
    );
  }

  function getOptionalMaskCacheId(mask: Uint8Array | undefined) {
    return mask ? getMaskCacheId(mask) : 0;
  }

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
      input.committedTargets.map((target) => createTargetCircleCacheKey(target.hitCircle)),
      input.prefixTarget ? createTargetCircleCacheKey(input.prefixTarget) : undefined,
      createPointCacheKey(input.targetPoint),
      createTargetCircleCacheKey(input.hitTarget),
    ]);
  }

  function createOneClickClearResultCacheKey(input: GraphwarOneClickClearPathWorkerInput) {
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
      createTrajectorySettingsCacheKey(input.settings, getOptionalMaskCacheId(input.settings.stepGlitchObstacleMask)),
      createPointArrayCacheKey(input.pathPoints),
      // 成功结果会原样回写目标锚点；同一路径和命中圈的不同锚点不能共享结果。
      input.committedTargets.map(createCommittedTargetCacheKey),
      input.prefixTarget ? createTargetCircleCacheKey(input.prefixTarget) : undefined,
      input.candidates.map(createOneClickClearCandidateCacheKey),
      input.hitCandidates.map(createOneClickClearCandidateCacheKey),
    ]);
  }

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

  function getCachedRouteMask(mask: Uint8Array, routeTolerance: number): GraphwarRouteMaskCacheEntry {
    return getCachedRouteMaskWithStatus(mask, routeTolerance).entry;
  }

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

function createGraphBoundsCacheKey(bounds: GraphBounds) {
  return [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY];
}

function createBoundsRectCacheKey(rect: BoundsRect) {
  return [rect.x, rect.y, rect.width, rect.height];
}

function createPointCacheKey(point: PixelPoint) {
  return [point.x, point.y];
}

function createPointArrayCacheKey(points: readonly PixelPoint[]) {
  return points.map(createPointCacheKey);
}

function createTargetCircleCacheKey(target: { center: PixelPoint; radius: number }) {
  return [createPointCacheKey(target.center), target.radius];
}

function createCommittedTargetCacheKey(target: GraphwarOneClickClearPathWorkerInput["committedTargets"][number]) {
  return [createTargetCircleCacheKey(target.hitCircle), target.anchor ? createPointCacheKey(target.anchor) : null];
}

function createTrajectorySettingsCacheKey(
  settings: GraphwarTrajectoryFormulaSettings,
  stepGlitchObstacleMaskId: number,
) {
  return [
    settings.algorithm,
    settings.decimalPlaces,
    settings.equation,
    settings.formulaPathSteepness,
    settings.steepness,
    settings.stepGlitchMode,
    // 邪道模式按普通 sigmoid 近似路径区域决定是否替换为门函数；mask 变化必须让 worker 结果缓存失效。
    settings.stepGlitchMode ? stepGlitchObstacleMaskId : 0,
    settings.stepOverflowProtection,
  ];
}

function createOneClickClearCandidateCacheKey(candidate: GraphwarOneClickClearCandidate) {
  return [candidate.id, candidate.enemy, createPointCacheKey(candidate.hitCenter), candidate.hitRadius];
}

function cloneSmartPathfindingPathResultWithoutTimings(result: GraphwarSmartPathfindingPathResult) {
  return {
    ...cloneSmartPathfindingPathResult(result),
    timings: [],
  };
}

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

function cloneOneClickClearPathWorkerResultWithoutTimings(result: GraphwarOneClickClearPathWorkerResult) {
  return {
    result: cloneOneClickClearResult(result.result),
    timings: [],
  };
}

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

function cloneOneClickClearResult(result: GraphwarOneClickClearPathWorkerResult["result"]) {
  if (result.type === "success") {
    return {
      elapsedMs: result.elapsedMs,
      expandedStates: result.expandedStates,
      pathPoints: result.pathPoints.map(clonePixelPoint),
      targetIds: [...result.targetIds],
      targetSequence: result.targetSequence.map((target) => ({
        ...(target.anchor ? { anchor: clonePixelPoint(target.anchor) } : {}),
        hitCircle: cloneTargetCircle(target.hitCircle),
      })),
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

function cloneTargetCircle(target: { center: PixelPoint; radius: number }) {
  return {
    center: clonePixelPoint(target.center),
    radius: target.radius,
  };
}

function clonePixelPoint(point: PixelPoint) {
  return createPixelPoint(point.x, point.y);
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

function createFriendlySoldierObstacleMaskCacheKey(soldier: GraphwarDetectionBox) {
  return [soldier.id, soldier.sourceCenterX, soldier.sourceCenterY, soldier.hitRadius].join(":");
}
