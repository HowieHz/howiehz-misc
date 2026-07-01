/** Graphwar 固定平面上的几何寻路工具；页面和 worker 共用同一套图搜索实现。 */
import { xPlusGoesRight } from "./geometry";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "./graphwar";
import { clampNumber, nearlyEqual, roundToDecimalPlaces } from "./numbers";
import { createPixelPoint } from "./types";
import type { BoundsRect, GraphBounds, PixelPoint } from "./types";

/** Graphwar 原始 770x450 平面网格点，所有几何寻路都在这个固定网格上运行。 */
export interface PlaneGridPoint {
  /** 平面网格 x。 */
  x: number;
  /** 平面网格 y。 */
  y: number;
}

/** 页面搜索动画需要的图搜索快照；worker 不传回调时不会产生该数据。 */
export interface GraphwarPathfindingPreview {
  /** 最近通过可见性检查的边。 */
  acceptedEdges: readonly [PlaneGridPoint, PlaneGridPoint][];
  /** 当前搜索中最有希望的回溯路径。 */
  bestPath: readonly PlaneGridPoint[];
  /** 当前预览显示的候选点。 */
  candidates: readonly PlaneGridPoint[];
  /** 当前扩展点。 */
  current?: PlaneGridPoint;
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
  /** 判断一条有向边是否满足 Graphwar x+ 规则；默认要求 next.x > previous.x。 */
  canAdvance?: (previous: PlaneGridPoint, next: PlaneGridPoint) => boolean;
  /** 长循环取消检查；只由页面交互侧传入。 */
  isCancelled?: () => boolean;
  /** 搜索回调；页面用于动画，worker 保持为空。 */
  onPreview?: (preview: GraphwarPathfindingPreview) => void;
  /** 按需获取可见图障碍数据；直连成功或提前失败时不会触发。 */
  getVisibilityGraphObstacleData?: () => GraphwarVisibilityGraphObstacleData;
  /** 已按 route tolerance 膨胀或腐蚀后的障碍 mask。 */
  routeMask: Uint8Array;
  /** 当前 route tolerance，供轮廓 RDP 简化计算 epsilon。 */
  routeTolerancePlanePixels?: number;
  /** 同一个固定 mask 上复用的可见图障碍轮廓，避免批量寻路时反复扫描障碍。 */
  visibilityGraphObstacleData?: GraphwarVisibilityGraphObstacleData;
  /** 路径起点，截图像素坐标。 */
  startPoint: PixelPoint;
  /** 路径终点，截图像素坐标。 */
  targetPoint: PixelPoint;
  /** 页面动画用的调度钩子；worker 不传时算法保持同步执行。 */
  yieldControl?: () => Promise<void> | void;
}

/** 预构建可见图障碍数据的输入；调用方需要在使用期间保持 routeMask 不变。 */
export interface GraphwarVisibilityGraphObstacleDataOptions {
  /** 当前 Graphwar 坐标边界，用于判断是否需要镜像到 x+ 搜索坐标系。 */
  bounds: GraphBounds;
  /** 已按 route tolerance 膨胀或腐蚀后的障碍 mask。 */
  routeMask: Uint8Array;
  /** 当前 route tolerance，供轮廓 RDP 简化计算 epsilon。 */
  routeTolerancePlanePixels?: number;
}

/** 与固定 mask、x+ 方向和 route tolerance 绑定的可见图障碍轮廓缓存。 */
export interface GraphwarVisibilityGraphObstacleData {
  /** 已按 mirror/tolerance 简化过的障碍轮廓。 */
  readonly contours: readonly VisibilityGraphObstacleContour[];
  /** 是否把原始平面镜像到 x+ 搜索坐标系。 */
  readonly mirrored: boolean;
  /** 缓存所属 mask；用引用相等防止跨友伤模式或跨容差误用。 */
  readonly routeMask: Uint8Array;
  /** 缓存所属 route tolerance。 */
  readonly routeTolerancePlanePixels: number;
}

/** RouteMask 中一个 4 邻域障碍连通域，后续会从其边界生成可见性图候选点。 */
interface RouteMaskComponent {
  /** 连通域外框，用于限制边界扫描范围。 */
  bounds: {
    maxX: number;
    maxY: number;
    minX: number;
    minY: number;
  };
  /** 连通域几何中心，用于候选点排序和 fallback 选点。 */
  centroid: PlaneGridPoint;
  /** 连通域内全部阻挡网格。 */
  cells: PlaneGridPoint[];
  /** 连通域网格 key 集合，用于快速判断点是否属于该组件。 */
  cellSet: Set<string>;
}

/** 连通域边界轮廓点，并保留它来自哪个阻挡 cell。 */
interface BoundaryContourPoint extends PlaneGridPoint {
  /** 产生该边界点的阻挡 cell。 */
  sourceCell: PlaneGridPoint;
}

/** RDP 轮廓简化待处理或已简化的开区间端点下标。 */
interface BoundaryContourRange {
  /** 区间终点在原始轮廓数组中的下标。 */
  endIndex: number;
  /** 区间起点在原始轮廓数组中的下标。 */
  startIndex: number;
}

/** 一个已经简化、可被多条路径候选过滤复用的障碍边界轮廓。 */
interface VisibilityGraphObstacleContour {
  /** 轮廓所属连通域；选自由候选点时仍需要中心和 cell 集合。 */
  component: RouteMaskComponent;
  /** 已按 route tolerance 简化的闭合轮廓点。 */
  points: BoundaryContourPoint[];
  /** 简化轮廓有符号面积，用于过滤明显凹角。 */
  signedArea: number;
}

/** Lazy visibility search 的排序代价：先短路径，再少折线段。 */
interface PathfindingCost {
  /** 当前路径累计欧氏长度平方近似。 */
  length: number;
  /** 当前路径折线段数量。 */
  segments: number;
}

/** 可见性图搜索中一个候选点的最优已知状态。 */
interface VisibilitySearchState {
  /** 对应 candidates 数组下标。 */
  candidateIndex: number;
  /** 从起点到该候选点的当前最优代价。 */
  cost: PathfindingCost;
  /** 回溯路径时使用的上一个候选点下标。 */
  previousIndex?: number;
}

/** 记录 mask cache 使用的是膨胀还是腐蚀，避免正负半径 key 冲突。 */
const enum RouteMaskOperation {
  /** 扩大障碍，要求路线离障碍更远。 */
  Dilate = "dilate",
  /** 缩小障碍，允许路线在更窄缝隙里尝试。 */
  Erode = "erode",
}

/** 边界点落在障碍上时，向外搜索可站立候选点的最大半径。 */
const GRAPHWAR_PATHFINDING_CONTOUR_FREE_CELL_SEARCH_RADIUS = 3;
/** 页面动画每帧最多显示的可见边数量，避免 SVG 预览过重。 */
const GRAPHWAR_PATHFINDING_PREVIEW_EDGE_LIMIT = 24;
/** 页面动画每帧最多显示的候选点数量。 */
const GRAPHWAR_PATHFINDING_PREVIEW_CANDIDATE_LIMIT = 64;
/** 图搜索每扩展若干候选点后发送一次预览，平衡可视反馈和性能。 */
const GRAPHWAR_PATHFINDING_PREVIEW_EXPANSION_INTERVAL = 8;

/** 8 邻域偏移，用于从 mask cell 追踪连通边界。 */
const EIGHT_CONNECTED_OFFSETS: readonly PlaneGridPoint[] = [
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
];

/** 在固定 Graphwar 平面上构造 x+ 单调有向 Lazy Visibility Graph，输出几何可行的绕障折线。 */
export async function buildSmartPathfindingPathForMask(options: GraphwarPathfindingOptions) {
  // 统一镜像到 x+ 搜索坐标系，调用方始终拿到原始平面坐标系下的路径。
  const mirrored = !xPlusGoesRight(options.bounds);
  const start = mirrorPlaneGridPoint(imagePointToPlaneGridPoint(options.startPoint, options.boundsRect), mirrored);
  const target = mirrorPlaneGridPoint(imagePointToPlaneGridPoint(options.targetPoint, options.boundsRect), mirrored);
  const canAdvance = options.canAdvance
    ? (previous: PlaneGridPoint, next: PlaneGridPoint) =>
        options.canAdvance?.(mirrorPlaneGridPoint(previous, mirrored), mirrorPlaneGridPoint(next, mirrored)) ?? false
    : (previous: PlaneGridPoint, next: PlaneGridPoint) => next.x > previous.x;
  if (
    pointHitsPlaneMask(start, options.routeMask, mirrored, options.boundaryExpansion) ||
    pointHitsPlaneMask(target, options.routeMask, mirrored, options.boundaryExpansion)
  ) {
    return undefined;
  }

  if (!canAdvance(start, target) && !pointsEqual(start, target)) {
    return undefined;
  }

  if (
    canAdvance(start, target) &&
    !lineHitsPlaneMask(start, target, options.routeMask, mirrored, options.boundaryExpansion)
  ) {
    const directPath = [start, target];
    options.onPreview?.({
      acceptedEdges: [[start, target]],
      bestPath: directPath,
      candidates: directPath,
      current: start,
      mirrored,
    });
    return directPath.map((point) => mirrorPlaneGridPoint(point, mirrored));
  }

  const candidates = collectVisibilityGraphCandidates({
    boundaryExpansion: options.boundaryExpansion,
    canAdvance,
    mirrored,
    routeMask: options.routeMask,
    routeTolerancePlanePixels: options.routeTolerancePlanePixels ?? 1,
    start,
    target,
    visibilityGraphObstacleData: options.visibilityGraphObstacleData ?? options.getVisibilityGraphObstacleData?.(),
  });
  const path = await findLazyVisibilityGraphPath({
    boundaryExpansion: options.boundaryExpansion,
    canAdvance,
    candidates,
    isCancelled: options.isCancelled,
    mirrored,
    onPreview: options.onPreview,
    routeMask: options.routeMask,
    startIndex: 0,
    targetIndex: 1,
    yieldControl: options.yieldControl,
  });
  return path?.map((point) => mirrorPlaneGridPoint(point, mirrored));
}

/** 为固定 route mask 预构建障碍连通域和简化轮廓，供同一批路径搜索复用。 */
export function createGraphwarVisibilityGraphObstacleData(
  options: GraphwarVisibilityGraphObstacleDataOptions,
): GraphwarVisibilityGraphObstacleData {
  const mirrored = !xPlusGoesRight(options.bounds);
  return createVisibilityGraphObstacleDataForMirroredMask({
    mirrored,
    routeMask: options.routeMask,
    routeTolerancePlanePixels: options.routeTolerancePlanePixels ?? 1,
  });
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

/** 从障碍连通域轮廓提取可见性图候选点，并加入起点和终点。 */
function collectVisibilityGraphCandidates({
  boundaryExpansion,
  canAdvance,
  mirrored,
  routeMask,
  routeTolerancePlanePixels,
  start,
  target,
  visibilityGraphObstacleData,
}: {
  boundaryExpansion: number;
  canAdvance: (previous: PlaneGridPoint, next: PlaneGridPoint) => boolean;
  mirrored: boolean;
  routeMask: Uint8Array;
  routeTolerancePlanePixels: number;
  start: PlaneGridPoint;
  target: PlaneGridPoint;
  visibilityGraphObstacleData?: GraphwarVisibilityGraphObstacleData;
}) {
  const candidateMap = new Map<string, PlaneGridPoint>();
  const startKey = createPlaneGridPointKey(start);
  const targetKey = createPlaneGridPointKey(target);
  const minPathX = Math.min(start.x, target.x);
  const maxPathX = Math.max(start.x, target.x);
  const obstacleData = getCompatibleVisibilityGraphObstacleData({
    mirrored,
    routeMask,
    routeTolerancePlanePixels,
    visibilityGraphObstacleData,
  });

  for (const contour of obstacleData.contours) {
    const simplifiedContour = contour.points;
    for (let index = 0; index < simplifiedContour.length; index += 1) {
      const previous = simplifiedContour[(index - 1 + simplifiedContour.length) % simplifiedContour.length];
      const current = simplifiedContour[index];
      const next = simplifiedContour[(index + 1) % simplifiedContour.length];
      if (!current || !previous || !next) {
        continue;
      }
      if (isNearCollinear(previous, current, next) || isClearlyConcave(previous, current, next, contour.signedArea)) {
        continue;
      }

      const candidate = selectNearbyFreeCellCandidate({
        boundaryExpansion,
        boundaryPoint: current,
        component: contour.component,
        maxPathX,
        minPathX,
        mirrored,
        routeMask,
      });
      if (!candidate) {
        continue;
      }
      if (!canAdvance(start, candidate) && !canAdvance(candidate, target)) {
        continue;
      }

      const key = createPlaneGridPointKey(candidate);
      if (key !== startKey && key !== targetKey && !candidateMap.has(key)) {
        candidateMap.set(key, candidate);
      }
    }
  }

  return [start, target, ...[...candidateMap.values()].sort((left, right) => left.x - right.x || left.y - right.y)];
}

function getCompatibleVisibilityGraphObstacleData({
  mirrored,
  routeMask,
  routeTolerancePlanePixels,
  visibilityGraphObstacleData,
}: {
  mirrored: boolean;
  routeMask: Uint8Array;
  routeTolerancePlanePixels: number;
  visibilityGraphObstacleData?: GraphwarVisibilityGraphObstacleData;
}) {
  // 友伤模式、镜像方向和 route tolerance 都会改变轮廓；不匹配时宁可重建，避免复用错误候选。
  if (
    visibilityGraphObstacleData &&
    visibilityGraphObstacleData.mirrored === mirrored &&
    visibilityGraphObstacleData.routeMask === routeMask &&
    nearlyEqual(visibilityGraphObstacleData.routeTolerancePlanePixels, routeTolerancePlanePixels)
  ) {
    return visibilityGraphObstacleData;
  }
  return createVisibilityGraphObstacleDataForMirroredMask({
    mirrored,
    routeMask,
    routeTolerancePlanePixels,
  });
}

function createVisibilityGraphObstacleDataForMirroredMask({
  mirrored,
  routeMask,
  routeTolerancePlanePixels,
}: {
  mirrored: boolean;
  routeMask: Uint8Array;
  routeTolerancePlanePixels: number;
}): GraphwarVisibilityGraphObstacleData {
  const epsilon = clampNumber(Math.abs(routeTolerancePlanePixels) * 0.75, 1, 6);
  const contours: VisibilityGraphObstacleContour[] = [];
  for (const component of collectRouteMaskComponents(routeMask, mirrored)) {
    for (const contour of collectComponentBoundaryContours(component)) {
      const points = simplifyClosedBoundaryContour(contour, epsilon);
      contours.push({
        component,
        points,
        signedArea: calculateSignedArea(points),
      });
    }
  }
  return {
    contours,
    mirrored,
    routeMask,
    routeTolerancePlanePixels,
  };
}

/** 用 BFS 收集 route mask 中的 8 邻域阻挡连通域。 */
function collectRouteMaskComponents(mask: Uint8Array, mirrored: boolean) {
  const components: RouteMaskComponent[] = [];
  const visited = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
  for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
    for (let x = 0; x < GRAPHWAR_PLANE_LENGTH; x += 1) {
      const start = { x, y };
      const startIndex = createPlaneGridPointIndex(start);
      if (visited[startIndex] || !routeMaskCellIsBlocked(start, mask, mirrored)) {
        continue;
      }

      const cells: PlaneGridPoint[] = [];
      const cellSet = new Set<string>();
      const queue: PlaneGridPoint[] = [start];
      visited[startIndex] = 1;
      let queueIndex = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let sumX = 0;
      let sumY = 0;

      while (queueIndex < queue.length) {
        const cell = queue[queueIndex];
        queueIndex += 1;
        if (!cell) {
          continue;
        }

        cells.push(cell);
        cellSet.add(createPlaneGridPointKey(cell));
        minX = Math.min(minX, cell.x);
        maxX = Math.max(maxX, cell.x);
        minY = Math.min(minY, cell.y);
        maxY = Math.max(maxY, cell.y);
        sumX += cell.x;
        sumY += cell.y;

        for (const offset of EIGHT_CONNECTED_OFFSETS) {
          const next = { x: cell.x + offset.x, y: cell.y + offset.y };
          if (!isInsidePlane(next.x, next.y)) {
            continue;
          }
          const nextIndex = createPlaneGridPointIndex(next);
          if (visited[nextIndex] || !routeMaskCellIsBlocked(next, mask, mirrored)) {
            continue;
          }
          visited[nextIndex] = 1;
          queue.push(next);
        }
      }

      components.push({
        bounds: { maxX, maxY, minX, minY },
        cells,
        cellSet,
        centroid: {
          x: sumX / cells.length,
          y: sumY / cells.length,
        },
      });
    }
  }
  return components;
}

/** 将连通域边界边按方向串成闭合轮廓。 */
function collectComponentBoundaryContours(component: RouteMaskComponent) {
  const edges = collectComponentBoundaryEdges(component);
  const contours: BoundaryContourPoint[][] = [];
  const adjacency = new Map<string, number[]>();
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    if (!edge) {
      continue;
    }
    const key = createPlaneGridPointKey(edge.start);
    const outgoingEdges = adjacency.get(key);
    if (outgoingEdges) {
      outgoingEdges.push(index);
    } else {
      adjacency.set(key, [index]);
    }
  }
  for (const outgoingEdges of adjacency.values()) {
    outgoingEdges.sort((leftIndex, rightIndex) => compareBoundaryEdges(edges[leftIndex], edges[rightIndex]));
  }

  const unusedEdgeIndexes = new Set(edges.map((_, index) => index));
  while (unusedEdgeIndexes.size > 0) {
    const firstEdgeIndex = unusedEdgeIndexes.values().next().value as number | undefined;
    if (firstEdgeIndex === undefined) {
      break;
    }

    const firstEdge = edges[firstEdgeIndex];
    if (!firstEdge) {
      unusedEdgeIndexes.delete(firstEdgeIndex);
      continue;
    }

    const contour: BoundaryContourPoint[] = [];
    const startKey = createPlaneGridPointKey(firstEdge.start);
    let edgeIndex: number | undefined = firstEdgeIndex;
    for (let step = 0; edgeIndex !== undefined && step <= edges.length; step += 1) {
      const edge = edges[edgeIndex];
      unusedEdgeIndexes.delete(edgeIndex);
      if (!edge) {
        break;
      }

      contour.push({ ...edge.start, sourceCell: edge.sourceCell });
      const endKey = createPlaneGridPointKey(edge.end);
      if (endKey === startKey) {
        break;
      }

      const nextEdgeIndexes = adjacency.get(endKey)?.filter((index) => unusedEdgeIndexes.has(index)) ?? [];
      edgeIndex = selectNextBoundaryEdgeIndex(edge, nextEdgeIndexes, edges);
    }

    if (contour.length >= 3) {
      contours.push(contour);
    }
  }
  return contours;
}

/** 枚举连通域外露的 cell 边界边。 */
function collectComponentBoundaryEdges(component: RouteMaskComponent) {
  const edges: {
    end: PlaneGridPoint;
    sourceCell: PlaneGridPoint;
    start: PlaneGridPoint;
  }[] = [];
  for (const cell of component.cells) {
    if (!component.cellSet.has(createPlaneGridPointKey({ x: cell.x, y: cell.y - 1 }))) {
      edges.push({
        end: { x: cell.x + 1, y: cell.y },
        sourceCell: cell,
        start: { x: cell.x, y: cell.y },
      });
    }
    if (!component.cellSet.has(createPlaneGridPointKey({ x: cell.x + 1, y: cell.y }))) {
      edges.push({
        end: { x: cell.x + 1, y: cell.y + 1 },
        sourceCell: cell,
        start: { x: cell.x + 1, y: cell.y },
      });
    }
    if (!component.cellSet.has(createPlaneGridPointKey({ x: cell.x, y: cell.y + 1 }))) {
      edges.push({
        end: { x: cell.x, y: cell.y + 1 },
        sourceCell: cell,
        start: { x: cell.x + 1, y: cell.y + 1 },
      });
    }
    if (!component.cellSet.has(createPlaneGridPointKey({ x: cell.x - 1, y: cell.y }))) {
      edges.push({
        end: { x: cell.x, y: cell.y },
        sourceCell: cell,
        start: { x: cell.x, y: cell.y + 1 },
      });
    }
  }
  return edges;
}

/** 将闭合轮廓拆成两条开链后执行 RDP 简化。 */
function simplifyClosedBoundaryContour(contour: BoundaryContourPoint[], epsilon: number) {
  if (contour.length <= 3) {
    return contour;
  }

  const startIndex = contour.reduce(
    (bestIndex, point, index) => (comparePlaneGridPoints(point, contour[bestIndex]) < 0 ? index : bestIndex),
    0,
  );
  const start = contour[startIndex];
  if (!start) {
    return contour;
  }

  const endIndex = contour.reduce((bestIndex, point, index) => {
    const best = contour[bestIndex];
    if (!best) {
      return index;
    }
    return planeGridPointDistanceSquared(start, point) > planeGridPointDistanceSquared(start, best) ? index : bestIndex;
  }, startIndex);

  if (endIndex === startIndex) {
    return contour;
  }

  const firstChain = collectCircularContourChain(contour, startIndex, endIndex);
  const secondChain = collectCircularContourChain(contour, endIndex, startIndex);
  const firstSimplified = simplifyOpenBoundaryContour(firstChain, epsilon);
  const secondSimplified = simplifyOpenBoundaryContour(secondChain, epsilon);
  return [...firstSimplified.slice(0, -1), ...secondSimplified.slice(0, -1)];
}

/** 按环形索引提取从起点到终点的轮廓链，包含两端。 */
function collectCircularContourChain(contour: BoundaryContourPoint[], startIndex: number, endIndex: number) {
  const chain: BoundaryContourPoint[] = [];
  for (let index = startIndex; index !== endIndex; index = (index + 1) % contour.length) {
    const point = contour[index];
    if (point) {
      chain.push(point);
    }
  }
  const end = contour[endIndex];
  if (end) {
    chain.push(end);
  }
  return chain;
}

/** 用显式栈执行 RDP 开轮廓简化，避免复杂障碍边界触发深递归。 */
function simplifyOpenBoundaryContour(points: BoundaryContourPoint[], epsilon: number): BoundaryContourPoint[] {
  if (points.length <= 2) {
    return points;
  }

  if (!points[0] || !points.at(-1)) {
    return points;
  }

  const pendingRanges: BoundaryContourRange[] = [{ startIndex: 0, endIndex: points.length - 1 }];
  const keptRanges: BoundaryContourRange[] = [];
  while (pendingRanges.length > 0) {
    const range = pendingRanges.pop();
    if (!range) {
      continue;
    }

    const start = points[range.startIndex];
    const end = points[range.endIndex];
    if (!start || !end || range.endIndex - range.startIndex <= 1) {
      keptRanges.push(range);
      continue;
    }

    let maxDistance = -Infinity;
    let splitIndex = range.startIndex;
    for (let index = range.startIndex + 1; index < range.endIndex; index += 1) {
      const point = points[index];
      if (!point) {
        continue;
      }
      const distance = distanceToLineSegment(point, start, end);
      if (distance > maxDistance) {
        maxDistance = distance;
        splitIndex = index;
      }
    }

    if (maxDistance <= epsilon) {
      keptRanges.push(range);
      continue;
    }

    // 先压右半段再压左半段，让 pop() 优先处理左侧，叶区间自然保持轮廓顺序。
    pendingRanges.push({ startIndex: splitIndex, endIndex: range.endIndex });
    pendingRanges.push({ startIndex: range.startIndex, endIndex: splitIndex });
  }

  // keptRanges 通常远少于原始点；直接拼叶区间端点，避免再分配标记数组并全量扫描 points。
  const simplified: BoundaryContourPoint[] = [];
  for (const range of keptRanges) {
    const start = points[range.startIndex];
    const end = points[range.endIndex];
    if (!start || !end) {
      continue;
    }
    if (simplified.at(-1) !== start) {
      simplified.push(start);
    }
    if (simplified.at(-1) !== end) {
      simplified.push(end);
    }
  }
  return simplified.length > 0 ? simplified : points;
}

/** 在边界点周围寻找离障碍最近且偏外侧的可通行候选点。 */
function selectNearbyFreeCellCandidate({
  boundaryExpansion,
  boundaryPoint,
  component,
  maxPathX,
  minPathX,
  mirrored,
  routeMask,
}: {
  boundaryExpansion: number;
  boundaryPoint: PlaneGridPoint;
  component: RouteMaskComponent;
  maxPathX: number;
  minPathX: number;
  mirrored: boolean;
  routeMask: Uint8Array;
}) {
  let bestCandidate: PlaneGridPoint | undefined;
  let bestDistanceToBoundary = Infinity;
  let bestDistanceToCentroid = -Infinity;

  for (let radius = 1; radius <= GRAPHWAR_PATHFINDING_CONTOUR_FREE_CELL_SEARCH_RADIUS; radius += 1) {
    for (let yOffset = -radius; yOffset <= radius; yOffset += 1) {
      for (let xOffset = -radius; xOffset <= radius; xOffset += 1) {
        if (Math.max(Math.abs(xOffset), Math.abs(yOffset)) !== radius) {
          continue;
        }

        const candidate = {
          x: Math.round(boundaryPoint.x + xOffset),
          y: Math.round(boundaryPoint.y + yOffset),
        };
        if (
          candidate.x < minPathX ||
          candidate.x > maxPathX ||
          pointHitsPlaneMask(candidate, routeMask, mirrored, boundaryExpansion)
        ) {
          continue;
        }

        const distanceToBoundary = planeGridPointDistanceSquared(candidate, boundaryPoint);
        const distanceToCentroid = planeGridPointDistanceSquared(candidate, component.centroid);
        if (
          distanceToBoundary < bestDistanceToBoundary ||
          (distanceToBoundary === bestDistanceToBoundary && distanceToCentroid > bestDistanceToCentroid) ||
          (distanceToBoundary === bestDistanceToBoundary &&
            distanceToCentroid === bestDistanceToCentroid &&
            (!bestCandidate || comparePlaneGridPoints(candidate, bestCandidate) < 0))
        ) {
          bestCandidate = candidate;
          bestDistanceToBoundary = distanceToBoundary;
          bestDistanceToCentroid = distanceToCentroid;
        }
      }
    }

    if (bestCandidate) {
      return bestCandidate;
    }
  }
  return undefined;
}

/** 在候选点之间惰性检查可见边，用 A* 风格代价搜索路径。 */
async function findLazyVisibilityGraphPath({
  boundaryExpansion,
  canAdvance,
  candidates,
  isCancelled,
  mirrored,
  onPreview,
  routeMask,
  startIndex,
  targetIndex,
  yieldControl,
}: {
  boundaryExpansion: number;
  canAdvance: (previous: PlaneGridPoint, next: PlaneGridPoint) => boolean;
  candidates: readonly PlaneGridPoint[];
  isCancelled?: () => boolean;
  mirrored: boolean;
  onPreview?: (preview: GraphwarPathfindingPreview) => void;
  routeMask: Uint8Array;
  startIndex: number;
  targetIndex: number;
  yieldControl?: () => Promise<void> | void;
}) {
  const states = new Map<number, VisibilitySearchState>([
    [startIndex, { candidateIndex: startIndex, cost: { length: 0, segments: 0 } }],
  ]);
  const openIndexes = new Set<number>([startIndex]);
  const closedIndexes = new Set<number>();
  const acceptedEdges: [PlaneGridPoint, PlaneGridPoint][] = [];
  let expansionCount = 0;

  while (openIndexes.size > 0) {
    if (isCancelled?.()) {
      return undefined;
    }

    const currentIndex = selectBestOpenCandidateIndex(openIndexes, states, candidates, targetIndex);
    if (currentIndex === undefined) {
      return undefined;
    }

    openIndexes.delete(currentIndex);
    const currentState = states.get(currentIndex);
    const currentPoint = candidates[currentIndex];
    if (!currentState || !currentPoint) {
      continue;
    }

    if (currentIndex === targetIndex) {
      const path = reconstructVisibilitySearchPath(targetIndex, states, candidates);
      onPreview?.({
        acceptedEdges,
        bestPath: path,
        candidates: limitPreviewCandidates(candidates, candidates[currentIndex] ?? candidates[startIndex]),
        current: currentPoint,
        mirrored,
      });
      return path;
    }

    closedIndexes.add(currentIndex);
    for (let nextIndex = 0; nextIndex < candidates.length; nextIndex += 1) {
      if (nextIndex === currentIndex || closedIndexes.has(nextIndex)) {
        continue;
      }

      const nextPoint = candidates[nextIndex];
      if (
        !nextPoint ||
        !canAdvance(currentPoint, nextPoint) ||
        lineHitsPlaneMask(currentPoint, nextPoint, routeMask, mirrored, boundaryExpansion)
      ) {
        continue;
      }

      acceptedEdges.push([currentPoint, nextPoint]);
      if (acceptedEdges.length > GRAPHWAR_PATHFINDING_PREVIEW_EDGE_LIMIT) {
        acceptedEdges.splice(0, acceptedEdges.length - GRAPHWAR_PATHFINDING_PREVIEW_EDGE_LIMIT);
      }

      const nextCost = {
        length: currentState.cost.length + planeGridPointDistance(currentPoint, nextPoint),
        segments: currentState.cost.segments + 1,
      };
      const previousNextState = states.get(nextIndex);
      if (previousNextState && comparePathfindingCosts(previousNextState.cost, nextCost) <= 0) {
        continue;
      }

      states.set(nextIndex, {
        candidateIndex: nextIndex,
        cost: nextCost,
        previousIndex: currentIndex,
      });
      openIndexes.add(nextIndex);
    }

    expansionCount += 1;
    if (
      expansionCount % GRAPHWAR_PATHFINDING_PREVIEW_EXPANSION_INTERVAL === 0 &&
      !(await reportVisibilitySearchProgress({
        acceptedEdges,
        candidates,
        currentIndex,
        isCancelled,
        mirrored,
        onPreview,
        openIndexes,
        startIndex,
        states,
        targetIndex,
        yieldControl,
      }))
    ) {
      return undefined;
    }
  }
  return undefined;
}

/** 上报一次可见性搜索预览，并按需让出主线程控制权。 */
async function reportVisibilitySearchProgress({
  acceptedEdges,
  candidates,
  currentIndex,
  isCancelled,
  mirrored,
  onPreview,
  openIndexes,
  startIndex,
  states,
  targetIndex,
  yieldControl,
}: {
  acceptedEdges: readonly [PlaneGridPoint, PlaneGridPoint][];
  candidates: readonly PlaneGridPoint[];
  currentIndex: number;
  isCancelled?: () => boolean;
  mirrored: boolean;
  onPreview?: (preview: GraphwarPathfindingPreview) => void;
  openIndexes: ReadonlySet<number>;
  startIndex: number;
  states: ReadonlyMap<number, VisibilitySearchState>;
  targetIndex: number;
  yieldControl?: () => Promise<void> | void;
}) {
  if (isCancelled?.()) {
    return false;
  }

  const bestOpenIndex = selectBestOpenCandidateIndex(openIndexes, states, candidates, targetIndex) ?? currentIndex;
  const current = candidates[currentIndex];
  onPreview?.({
    acceptedEdges,
    bestPath: reconstructVisibilitySearchPath(bestOpenIndex, states, candidates),
    candidates: limitPreviewCandidates(candidates, current ?? candidates[startIndex]),
    current,
    mirrored,
  });

  const yielded = yieldControl?.();
  if (yielded) {
    await yielded;
  }
  return !isCancelled?.();
}

/** 从 open 集合中选择估计总代价最小的候选点。 */
function selectBestOpenCandidateIndex(
  openIndexes: ReadonlySet<number>,
  states: ReadonlyMap<number, VisibilitySearchState>,
  candidates: readonly PlaneGridPoint[],
  targetIndex: number,
) {
  let bestIndex: number | undefined;
  for (const index of openIndexes) {
    if (
      bestIndex === undefined ||
      compareSearchQueueCandidates(index, bestIndex, states, candidates, targetIndex) < 0
    ) {
      bestIndex = index;
    }
  }
  return bestIndex;
}

/** 比较两个搜索候选点的 A* 排序优先级。 */
function compareSearchQueueCandidates(
  leftIndex: number,
  rightIndex: number,
  states: ReadonlyMap<number, VisibilitySearchState>,
  candidates: readonly PlaneGridPoint[],
  targetIndex: number,
) {
  const leftState = states.get(leftIndex);
  const rightState = states.get(rightIndex);
  const leftPoint = candidates[leftIndex];
  const rightPoint = candidates[rightIndex];
  const target = candidates[targetIndex];
  if (!leftState || !rightState || !leftPoint || !rightPoint || !target) {
    return leftIndex - rightIndex;
  }

  const leftF = {
    length: leftState.cost.length + planeGridPointDistance(leftPoint, target),
    segments: leftState.cost.segments,
  };
  const rightF = {
    length: rightState.cost.length + planeGridPointDistance(rightPoint, target),
    segments: rightState.cost.segments,
  };
  return (
    comparePathfindingCosts(leftF, rightF) ||
    leftState.cost.length - rightState.cost.length ||
    Math.abs(target.x - leftPoint.x) - Math.abs(target.x - rightPoint.x) ||
    Math.abs(target.y - leftPoint.y) - Math.abs(target.y - rightPoint.y) ||
    leftIndex - rightIndex
  );
}

/** 沿 previousIndex 回溯可见性搜索路径。 */
function reconstructVisibilitySearchPath(
  targetIndex: number,
  states: ReadonlyMap<number, VisibilitySearchState>,
  candidates: readonly PlaneGridPoint[],
) {
  const path: PlaneGridPoint[] = [];
  let currentIndex: number | undefined = targetIndex;
  const seenIndexes = new Set<number>();
  while (currentIndex !== undefined && !seenIndexes.has(currentIndex)) {
    seenIndexes.add(currentIndex);
    const point = candidates[currentIndex];
    const state = states.get(currentIndex);
    if (!point || !state) {
      break;
    }
    path.push(point);
    currentIndex = state.previousIndex;
  }
  return path.reverse();
}

/** 限制页面预览候选点数量，优先显示当前点附近的候选点。 */
function limitPreviewCandidates(candidates: readonly PlaneGridPoint[], current?: PlaneGridPoint) {
  if (candidates.length <= GRAPHWAR_PATHFINDING_PREVIEW_CANDIDATE_LIMIT) {
    return candidates;
  }

  const start = candidates[0];
  const target = candidates[1];
  if (!start || !target) {
    return candidates.slice(0, GRAPHWAR_PATHFINDING_PREVIEW_CANDIDATE_LIMIT);
  }
  const anchor = current ?? start;
  const selected = candidates
    .slice(2)
    .sort(
      (left, right) =>
        planeGridPointDistanceSquared(left, anchor) - planeGridPointDistanceSquared(right, anchor) ||
        comparePlaneGridPoints(left, right),
    )
    .slice(0, GRAPHWAR_PATHFINDING_PREVIEW_CANDIDATE_LIMIT - 2);
  return [start, target, ...selected];
}

/** 按起终点和方向角稳定排序边界边。 */
function compareBoundaryEdges(
  left:
    | {
        end: PlaneGridPoint;
        start: PlaneGridPoint;
      }
    | undefined,
  right:
    | {
        end: PlaneGridPoint;
        start: PlaneGridPoint;
      }
    | undefined,
) {
  if (!left || !right) {
    return left ? -1 : right ? 1 : 0;
  }
  return (
    comparePlaneGridPoints(left.start, right.start) ||
    comparePlaneGridPoints(left.end, right.end) ||
    angleForBoundaryEdge(left) - angleForBoundaryEdge(right)
  );
}

/** 从可选出边中选择相对上一条边转角最小的下一条边。 */
function selectNextBoundaryEdgeIndex(
  previousEdge: {
    end: PlaneGridPoint;
    start: PlaneGridPoint;
  },
  edgeIndexes: readonly number[],
  edges: readonly {
    end: PlaneGridPoint;
    start: PlaneGridPoint;
  }[],
) {
  return edgeIndexes.reduce<number | undefined>((bestIndex, edgeIndex) => {
    const edge = edges[edgeIndex];
    if (!edge) {
      return bestIndex;
    }
    if (bestIndex === undefined) {
      return edgeIndex;
    }
    const bestEdge = edges[bestIndex];
    if (!bestEdge) {
      return edgeIndex;
    }
    const edgeTurn = normalizedTurnAngle(previousEdge, edge);
    const bestTurn = normalizedTurnAngle(previousEdge, bestEdge);
    return edgeTurn < bestTurn || (edgeTurn === bestTurn && compareBoundaryEdges(edge, bestEdge) < 0)
      ? edgeIndex
      : bestIndex;
  }, undefined);
}

/** 计算从上一条边转向下一条边的归一化逆时针角度。 */
function normalizedTurnAngle(
  previousEdge: {
    end: PlaneGridPoint;
    start: PlaneGridPoint;
  },
  nextEdge: {
    end: PlaneGridPoint;
    start: PlaneGridPoint;
  },
) {
  const previousAngle = angleForBoundaryEdge(previousEdge);
  const nextAngle = angleForBoundaryEdge(nextEdge);
  return (nextAngle - previousAngle + Math.PI * 2) % (Math.PI * 2);
}

/** 计算边界有向边的方向角。 */
function angleForBoundaryEdge(edge: { end: PlaneGridPoint; start: PlaneGridPoint }) {
  return Math.atan2(edge.end.y - edge.start.y, edge.end.x - edge.start.x);
}

/** 计算多边形有符号面积，用于判断轮廓朝向。 */
function calculateSignedArea(points: readonly PlaneGridPoint[]) {
  let doubledArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (!current || !next) {
      continue;
    }
    doubledArea += current.x * next.y - next.x * current.y;
  }
  return doubledArea / 2;
}

/** 判断三点是否近似共线，避免保留不必要的候选拐点。 */
function isNearCollinear(previous: PlaneGridPoint, current: PlaneGridPoint, next: PlaneGridPoint) {
  return distanceToLineSegment(current, previous, next) <= 0.75;
}

/** 判断当前拐点是否明显为凹角，凹角不适合作为绕障候选点。 */
function isClearlyConcave(previous: PlaneGridPoint, current: PlaneGridPoint, next: PlaneGridPoint, signedArea: number) {
  const crossProduct = cross(previous, current, next);
  if (Math.abs(crossProduct) <= 1) {
    return false;
  }
  return signedArea * crossProduct < 0;
}

/** 计算点到线段的最短欧氏距离。 */
function distanceToLineSegment(point: PlaneGridPoint, start: PlaneGridPoint, end: PlaneGridPoint) {
  const lengthSquared = planeGridPointDistanceSquared(start, end);
  if (lengthSquared === 0) {
    return planeGridPointDistance(point, start);
  }

  const ratio = clampNumber(
    ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / lengthSquared,
    0,
    1,
  );
  return planeGridPointDistance(point, {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
  });
}

/** 计算三点组成的二维叉积。 */
function cross(previous: PlaneGridPoint, current: PlaneGridPoint, next: PlaneGridPoint) {
  return (current.x - previous.x) * (next.y - current.y) - (current.y - previous.y) * (next.x - current.x);
}

/** 判断指定平面 cell 在 route mask 中是否阻挡。 */
function routeMaskCellIsBlocked(point: PlaneGridPoint, mask: Uint8Array, mirrored: boolean) {
  if (!isInsidePlane(point.x, point.y)) {
    return false;
  }
  const x = mirrored ? GRAPHWAR_PLANE_LENGTH - 1 - point.x : point.x;
  return Boolean(mask[point.y * GRAPHWAR_PLANE_LENGTH + x]);
}

/** 比较路径搜索代价，先少折线段，再短路径长度。 */
function comparePathfindingCosts(left: PathfindingCost, right: PathfindingCost) {
  return left.segments - right.segments || (nearlyEqual(left.length, right.length) ? 0 : left.length - right.length);
}

/** 按平面坐标稳定比较两个网格点。 */
function comparePlaneGridPoints(left: PlaneGridPoint, right: PlaneGridPoint) {
  return left.x - right.x || left.y - right.y;
}

/** 判断两个平面网格点坐标是否相同。 */
function pointsEqual(left: PlaneGridPoint, right: PlaneGridPoint) {
  return left.x === right.x && left.y === right.y;
}

/** 创建平面网格点的字符串 key。 */
function createPlaneGridPointKey(point: PlaneGridPoint) {
  return `${point.x};${point.y}`;
}

/** 创建平面网格点在 770x450 mask 中的一维下标。 */
function createPlaneGridPointIndex(point: PlaneGridPoint) {
  return point.y * GRAPHWAR_PLANE_LENGTH + point.x;
}

/** 判断坐标是否位于固定 Graphwar 平面内。 */
function isInsidePlane(x: number, y: number) {
  return x >= 0 && x < GRAPHWAR_PLANE_LENGTH && y >= 0 && y < GRAPHWAR_PLANE_HEIGHT;
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

/** 计算两个平面网格点的欧氏距离平方，避免无谓开方。 */
function planeGridPointDistanceSquared(left: PlaneGridPoint, right: PlaneGridPoint) {
  return (right.x - left.x) ** 2 + (right.y - left.y) ** 2;
}

/** 将截图像素点映射到未裁剪的平面网格坐标，供裁剪入口复用。 */
function imagePointToRawPlaneGridPoint(point: PixelPoint, edgeRect: BoundsRect): PlaneGridPoint {
  return {
    x: Math.floor(((point.x - edgeRect.x) / edgeRect.width) * GRAPHWAR_PLANE_LENGTH),
    y: Math.floor(((point.y - edgeRect.y) / edgeRect.height) * GRAPHWAR_PLANE_HEIGHT),
  };
}
