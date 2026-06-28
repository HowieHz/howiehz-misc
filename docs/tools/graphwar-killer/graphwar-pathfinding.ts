/** Graphwar 固定平面上的几何寻路工具；页面和 worker 共用同一套 DP 实现。 */
import { xPlusGoesRight } from "./geometry";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "./graphwar";
import { clampNumber, doublePrecisionTolerance, nearlyEqual, roundToDecimalPlaces } from "./numbers";
import { createPixelPoint } from "./types";
import type { BoundsRect, GraphBounds, PixelPoint } from "./types";

/** Graphwar 原始 770x450 平面网格点，所有几何寻路都在这个固定网格上运行。 */
export interface PlaneGridPoint {
  /** 平面网格 x。 */
  x: number;
  /** 平面网格 y。 */
  y: number;
}

/** 同一 x 列上连续可通行的 y 区间，用于压缩 DP 候选点。 */
export interface SafeInterval {
  /** 可通行区间起始 y。 */
  start: number;
  /** 可通行区间结束 y。 */
  end: number;
}

/** 页面搜索动画需要的列扫描快照；worker 不传回调时不会产生该数据。 */
export interface GraphwarPathfindingPreview {
  /** 当前扫描列，位于镜像后的 x+ 搜索坐标系。 */
  x: number;
  /** 当前列的可通行区间。 */
  intervals: readonly SafeInterval[];
  /** 当前列实际参与 DP 的候选点。 */
  candidates: PlaneGridPoint[];
  /** 是否把原始平面镜像到 x+ 搜索坐标系。 */
  mirrored: boolean;
}

/** 按固定平面 mask 构造一条几何可行路径所需的纯数据和可选调度回调。 */
export interface GraphwarPathfindingOptions {
  /** 当前 Graphwar 坐标边界，用于判断 x+ 方向。 */
  bounds: GraphBounds;
  /** 截图内的 Graphwar 平面矩形，用于像素点和平面点互转。 */
  boundsRect: BoundsRect;
  /** 障碍和收缩边界命中检测用的外扩像素。 */
  boundaryExpansion: number;
  /** 强制逐列搜索，跳过直线可见性提前返回。 */
  forceColumnSearch?: boolean;
  /** 可选列安全区间缓存，同一 route mask 的多次搜索可以复用。 */
  intervalCache?: Map<string, SafeInterval[]>;
  /** 长循环取消检查；只由页面交互侧传入。 */
  isCancelled?: () => boolean;
  /** 搜索列回调；页面用于动画，worker 保持为空。 */
  onPreview?: (preview: GraphwarPathfindingPreview) => void;
  /** 已按 route tolerance 膨胀或腐蚀后的障碍 mask。 */
  routeMask: Uint8Array;
  /** 平面 x 方向列扫描步长。 */
  searchStepPlanePixels: number;
  /** 是否用直线可见性简化 DP 结果，默认开启。 */
  simplifyByLineOfSight?: boolean;
  /** 路径起点，截图像素坐标。 */
  startPoint: PixelPoint;
  /** 路径终点，截图像素坐标。 */
  targetPoint: PixelPoint;
  /** 页面动画用的调度钩子；worker 不传时算法保持同步执行。 */
  yieldControl?: () => Promise<void> | void;
}

/** Route tolerance 枚举输入；页面解析和 worker 请求只需满足这三个字段。 */
export interface GraphwarRouteToleranceRange {
  /** 最大路线容差，单位为固定平面像素。 */
  routeMaxTolerancePlanePixels: number;
  /** 最小路线容差，单位为固定平面像素。 */
  routeMinTolerancePlanePixels: number;
  /** 容差扫描步长，单位为固定平面像素。 */
  routeStepPlanePixels: number;
}

/** 几何寻路的动态规划状态，previous 链用于回溯最终折线。 */
interface PathfindingState {
  /** 当前平面网格点。 */
  point: PlaneGridPoint;
  /** 从起点到当前点的累计代价。 */
  cost: number;
  /** 上一列选中的状态。 */
  previous?: PathfindingState;
}

/** 记录 mask cache 使用的是膨胀还是腐蚀，避免正负半径 key 冲突。 */
const enum RouteMaskOperation {
  /** 扩大障碍，要求路线离障碍更远。 */
  Dilate = "dilate",
  /** 缩小障碍，允许路线在更窄缝隙里尝试。 */
  Erode = "erode",
}

/** 在固定 Graphwar 平面上按 x 列做安全区间 DP，输出几何可行的绕障折线。 */
export async function buildSmartPathfindingPathForMask(options: GraphwarPathfindingOptions) {
  // 统一镜像到 x+ 搜索坐标系，调用方始终拿到原始平面坐标系下的路径。
  const mirrored = !xPlusGoesRight(options.bounds);
  const start = mirrorPlaneGridPoint(imagePointToPlaneGridPoint(options.startPoint, options.boundsRect), mirrored);
  const target = mirrorPlaneGridPoint(imagePointToPlaneGridPoint(options.targetPoint, options.boundsRect), mirrored);
  if (
    lineHitsPlaneMask(start, start, options.routeMask, mirrored, options.boundaryExpansion) ||
    lineHitsPlaneMask(target, target, options.routeMask, mirrored, options.boundaryExpansion)
  ) {
    return undefined;
  }
  if (start.x === target.x) {
    return lineHitsPlaneMask(start, target, options.routeMask, mirrored, options.boundaryExpansion)
      ? undefined
      : [start, target].map((point) => mirrorPlaneGridPoint(point, mirrored));
  }
  if (start.x > target.x) {
    return undefined;
  }

  if (
    !options.forceColumnSearch &&
    !lineHitsPlaneMask(start, target, options.routeMask, mirrored, options.boundaryExpansion)
  ) {
    return [start, target].map((point) => mirrorPlaneGridPoint(point, mirrored));
  }

  const searchColumns = collectSmartPathfindingSearchColumns(start.x, target.x, options.searchStepPlanePixels);
  const anchorYs = collectSmartPathfindingAnchorYs(start.y, target.y);
  let currentStates: PathfindingState[] = [{ point: start, cost: 0 }];
  for (let columnIndex = 0; columnIndex < searchColumns.length; columnIndex += 1) {
    const x = searchColumns[columnIndex];
    const intervals = collectCachedSafeIntervals(
      options.intervalCache,
      options.routeMask,
      x,
      mirrored,
      options.boundaryExpansion,
    );
    const candidates = collectColumnCandidatePoints(intervals, x, x === target.x ? target.y : undefined, anchorYs);
    const progressResult = maybeReportPathfindingProgress(options, columnIndex, x, intervals, candidates, mirrored);
    if (isPromiseLike(progressResult)) {
      if (!(await progressResult)) {
        return undefined;
      }
    } else if (!progressResult) {
      return undefined;
    }

    if (candidates.length === 0) {
      return undefined;
    }

    const nextStates: PathfindingState[] = [];
    for (const candidate of candidates) {
      let bestState: PathfindingState | undefined;
      for (const state of currentStates) {
        if (lineHitsPlaneMask(state.point, candidate, options.routeMask, mirrored, options.boundaryExpansion)) {
          continue;
        }

        const cost = state.cost + planeGridPointDistance(state.point, candidate);
        if (!bestState || cost < bestState.cost) {
          bestState = { point: candidate, cost, previous: state };
        }
      }
      if (bestState) {
        nextStates.push(bestState);
      }
    }

    if (nextStates.length === 0) {
      return undefined;
    }
    currentStates = nextStates;
  }

  const finalState = currentStates
    .filter((state) => state.point.y === target.y)
    .reduce<PathfindingState | undefined>(
      (bestState, state) => (!bestState || state.cost < bestState.cost ? state : bestState),
      undefined,
    );
  if (!finalState) {
    return undefined;
  }

  const path = reconstructPathfindingPath(finalState);
  return (
    options.simplifyByLineOfSight === false
      ? path
      : simplifyPlanePathByLineOfSight(path, options.routeMask, mirrored, options.boundaryExpansion)
  ).map((point) => mirrorPlaneGridPoint(point, mirrored));
}

/** 枚举路线容差，优先尝试最小容差，失败后逐步放宽或收紧 mask。 */
export function collectSmartPathfindingRouteTolerances(tolerances: GraphwarRouteToleranceRange) {
  const values: number[] = [];
  const min = tolerances.routeMinTolerancePlanePixels;
  const max = tolerances.routeMaxTolerancePlanePixels;
  const step = tolerances.routeStepPlanePixels;
  for (let value = min; value <= max + createRouteToleranceStepBoundaryTolerance(min, max, step); value += step) {
    values.push(Math.min(value, max));
  }
  const lastValue = values.at(-1);
  if (lastValue === undefined || !nearlyEqual(lastValue, max)) {
    values.push(max);
  }
  return [...new Set(values.map((value) => roundToDecimalPlaces(value, 6)))];
}

/** 给 route tolerance 累加枚举留出 double 舍入余量，避免跳过理论上等于 max 的最后一步。 */
function createRouteToleranceStepBoundaryTolerance(min: number, max: number, step: number) {
  return doublePrecisionTolerance(min, max, step);
}

/** 按有效圆形半径和形态学方向生成 route mask cache key。 */
export function createRouteMaskCacheKey(radius: number) {
  const normalizedRadius = Number.isFinite(radius) ? radius : 0;
  // Dilation/erosion uses a circular radius. Keep enough precision in the key so
  // radius values on different lattice-distance thresholds do not share a mask.
  return normalizedRadius < 0
    ? `${RouteMaskOperation.Erode}:${roundToDecimalPlaces(Math.max(0, -normalizedRadius), 6)}`
    : `${RouteMaskOperation.Dilate}:${roundToDecimalPlaces(Math.max(0, normalizedRadius), 6)}`;
}

/** 读取或计算某列安全区间，减少 DP 重复扫描同一 mask 列。 */
export function collectCachedSafeIntervals(
  cache: Map<string, SafeInterval[]> | undefined,
  mask: Uint8Array,
  x: number,
  mirrored: boolean,
  boundaryExpansion: number,
) {
  if (!cache) {
    return collectSafeIntervals(mask, x, mirrored, boundaryExpansion);
  }

  // Candidate sampling changes per target, but the safe vertical spans for a
  // column only depend on mask orientation and boundary expansion.
  const key = `${x};${mirrored ? 1 : 0};${Math.max(0, Math.floor(boundaryExpansion))}`;
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const intervals = collectSafeIntervals(mask, x, mirrored, boundaryExpansion);
  cache.set(key, intervals);
  return intervals;
}

/** 扫描单列可通行 y 区间，把连续空白格压缩成候选范围。 */
export function collectSafeIntervals(mask: Uint8Array, x: number, mirrored: boolean, boundaryExpansion: number) {
  const intervals: SafeInterval[] = [];
  let startY: number | undefined;
  for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
    const blocked = pointHitsPlaneMask({ x, y }, mask, mirrored, boundaryExpansion);
    if (!blocked && startY === undefined) {
      startY = y;
    }
    if ((blocked || y === GRAPHWAR_PLANE_HEIGHT - 1) && startY !== undefined) {
      const endY = blocked ? y - 1 : y;
      if (endY >= startY) {
        intervals.push({ start: startY, end: endY });
      }
      startY = undefined;
    }
  }
  return intervals;
}

/** 在平面网格上采样线段，判断两点之间是否被障碍或边界收缩阻断。 */
export function lineHitsPlaneMask(
  start: PlaneGridPoint,
  end: PlaneGridPoint,
  mask: Uint8Array,
  mirrored: boolean,
  boundaryExpansion: number,
) {
  const steps = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  if (steps === 0) {
    return pointHitsPlaneMask(start, mask, mirrored, boundaryExpansion);
  }

  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps;
    const point = {
      x: Math.round(start.x + (end.x - start.x) * ratio),
      y: Math.round(start.y + (end.y - start.y) * ratio),
    };
    if (pointHitsPlaneMask(point, mask, mirrored, boundaryExpansion)) {
      return true;
    }
  }
  return false;
}

/** 判断平面点是否碰到障碍；mirrored 让 x- 地图复用同一套 x+ DP。 */
export function pointHitsPlaneMask(
  point: PlaneGridPoint,
  mask: Uint8Array,
  mirrored: boolean,
  boundaryExpansion: number,
) {
  const x = mirrored ? GRAPHWAR_PLANE_LENGTH - 1 - point.x : point.x;
  if (!isInsidePlaneWithBoundaryExpansion(x, point.y, boundaryExpansion)) {
    return true;
  }
  return Boolean(mask[point.y * GRAPHWAR_PLANE_LENGTH + x]);
}

/** 将实际平面点镜像到 x+ 搜索坐标系。 */
export function mirrorPlaneGridPoint(point: PlaneGridPoint, mirrored: boolean): PlaneGridPoint {
  return {
    x: mirrored ? GRAPHWAR_PLANE_LENGTH - 1 - point.x : point.x,
    y: point.y,
  };
}

/** 将平面 cell 中心映射回截图像素，避免路径贴 cell 边缘。 */
export function planeGridCellCenterToImagePoint(point: PlaneGridPoint, edgeRect: BoundsRect) {
  return planeToImagePoint({ x: point.x + 0.5, y: point.y + 0.5 }, edgeRect);
}

/** 将 Graphwar 原始平面坐标映射到截图像素。 */
export function planeToImagePoint(point: PlaneGridPoint, edgeRect: BoundsRect) {
  return createPixelPoint(
    edgeRect.x + (point.x / GRAPHWAR_PLANE_LENGTH) * edgeRect.width,
    edgeRect.y + (point.y / GRAPHWAR_PLANE_HEIGHT) * edgeRect.height,
  );
}

/** 将截图像素映射到平面网格，并裁剪到 770x450 内。 */
export function imagePointToPlaneGridPoint(point: PixelPoint, edgeRect: BoundsRect): PlaneGridPoint {
  const rawPoint = imagePointToRawPlaneGridPoint(point, edgeRect);
  return {
    x: clampNumber(rawPoint.x, 0, GRAPHWAR_PLANE_LENGTH - 1),
    y: clampNumber(rawPoint.y, 0, GRAPHWAR_PLANE_HEIGHT - 1),
  };
}

/** 页面长循环每四列让出一次，worker 不传调度回调时保持同步扫描。 */
function maybeReportPathfindingProgress(
  options: GraphwarPathfindingOptions,
  columnIndex: number,
  x: number,
  intervals: readonly SafeInterval[],
  candidates: PlaneGridPoint[],
  mirrored: boolean,
): boolean | Promise<boolean> {
  if (columnIndex % 4 !== 0) {
    return true;
  }
  if (options.isCancelled?.()) {
    return false;
  }
  options.onPreview?.({ x, intervals, candidates, mirrored });
  const yielded = options.yieldControl?.();
  if (!yielded) {
    return !options.isCancelled?.();
  }
  return Promise.resolve(yielded).then(() => !options.isCancelled?.());
}

/** 只在调用方真的返回 Promise-like 时进入 await，避免 worker 列扫描被微任务切碎。 */
function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === "object" && value !== null && "then" in value;
}

/** 收集 DP 扫描列，强制包含目标列避免步长不能整除时错过终点。 */
function collectSmartPathfindingSearchColumns(startX: number, targetX: number, searchStepPlanePixels: number) {
  const step = Math.max(1, Math.round(searchStepPlanePixels));
  const columns: number[] = [];
  for (let x = startX + step; x < targetX; x += step) {
    columns.push(x);
  }
  columns.push(targetX);
  return columns;
}

/** 生成起点到终点之间的 y 锚点，让 DP 候选更偏向平滑路径。 */
function collectSmartPathfindingAnchorYs(startY: number, targetY: number) {
  return [
    startY,
    Math.round(startY * 0.75 + targetY * 0.25),
    Math.round((startY + targetY) / 2),
    Math.round(startY * 0.25 + targetY * 0.75),
    targetY,
  ];
}

/** 从安全区间、目标 y 和锚点 y 生成当前列候选点。 */
function collectColumnCandidatePoints(
  intervals: SafeInterval[],
  x: number,
  requiredY?: number,
  anchorYs: readonly number[] = [],
) {
  const yValues = new Set<number>();
  for (const interval of intervals) {
    for (const y of collectIntervalSampleYs(interval)) {
      yValues.add(y);
    }
    for (const y of anchorYs) {
      if (y >= interval.start && y <= interval.end) {
        yValues.add(y);
      }
    }
  }
  if (
    requiredY !== undefined &&
    intervals.some((interval) => requiredY >= interval.start && requiredY <= interval.end)
  ) {
    yValues.add(requiredY);
  }

  return [...yValues].sort((left, right) => left - right).map((y) => ({ x, y }));
}

/** 对安全区间采样端点和四分位点，兼顾贴边绕障和居中穿行。 */
function collectIntervalSampleYs(interval: SafeInterval) {
  const span = interval.end - interval.start;
  const samples = new Set<number>([interval.start, interval.end]);
  if (span >= 2) {
    samples.add(Math.round(interval.start + span * 0.25));
    samples.add(Math.round(interval.start + span * 0.5));
    samples.add(Math.round(interval.start + span * 0.75));
  }
  return [...samples].filter((y) => y >= interval.start && y <= interval.end);
}

/** 沿 previous 链回溯 DP 终点状态。 */
function reconstructPathfindingPath(state: PathfindingState) {
  const points: PlaneGridPoint[] = [];
  let currentState: PathfindingState | undefined = state;
  while (currentState) {
    points.push(currentState.point);
    currentState = currentState.previous;
  }
  return points.reverse();
}

/** 用直线可见性删除中间 DP 点，缩短最终公式路径。 */
function simplifyPlanePathByLineOfSight(
  points: PlaneGridPoint[],
  mask: Uint8Array,
  mirrored: boolean,
  boundaryExpansion: number,
) {
  if (points.length <= 2) {
    return points;
  }

  const simplified = [points[0]];
  let anchorIndex = 0;
  while (anchorIndex < points.length - 1) {
    let furthestVisibleIndex = anchorIndex + 1;
    for (let index = anchorIndex + 2; index < points.length; index += 1) {
      if (lineHitsPlaneMask(points[anchorIndex], points[index], mask, mirrored, boundaryExpansion)) {
        break;
      }
      furthestVisibleIndex = index;
    }
    simplified.push(points[furthestVisibleIndex]);
    anchorIndex = furthestVisibleIndex;
  }
  return simplified;
}

/** 判断点是否在收缩后的 Graphwar 平面内部，贴边视为障碍。 */
function isInsidePlaneWithBoundaryExpansion(x: number, y: number, boundaryExpansion: number) {
  const expansion = Math.max(0, Math.floor(boundaryExpansion));
  return (
    x >= expansion && x < GRAPHWAR_PLANE_LENGTH - expansion && y >= expansion && y < GRAPHWAR_PLANE_HEIGHT - expansion
  );
}

/** DP 转移代价使用欧氏距离，偏好更短更平滑的折线。 */
function planeGridPointDistance(left: PlaneGridPoint, right: PlaneGridPoint) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

/** 将截图像素点映射到未裁剪的平面网格坐标，供裁剪入口复用。 */
function imagePointToRawPlaneGridPoint(point: PixelPoint, edgeRect: BoundsRect): PlaneGridPoint {
  return {
    x: Math.floor(((point.x - edgeRect.x) / edgeRect.width) * GRAPHWAR_PLANE_LENGTH),
    y: Math.floor(((point.y - edgeRect.y) / edgeRect.height) * GRAPHWAR_PLANE_HEIGHT),
  };
}
