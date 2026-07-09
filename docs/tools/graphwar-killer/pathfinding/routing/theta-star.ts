import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { xPlusGoesRight } from "../../core/geometry";
import { imagePointToPlaneGridPoint, mirrorPlaneGridPoint, type PlaneGridPoint } from "../../core/plane-grid";
import {
  lineHitsPlaneMask,
  pointHitsPlaneMask,
  type GraphwarPathfindingOptions,
  type GraphwarPathfindingPreview,
} from "./visibility-graph";

interface ThetaStarOpenNode {
  /** 平面网格一维下标。 */
  index: number;
  /** A* 排序代价。 */
  priority: number;
  /** 入队时的最优已知 gScore；弹出时用于跳过旧副本。 */
  routeCost: number;
}

/** 一列里连续可通行的 y 区间；端点都可落点。 */
interface ThetaStarColumnFreeSpan {
  maxY: number;
  minY: number;
}

interface ThetaStarFreeSpanCache {
  /** 障碍和边界外扩值参与可通行区间计算，必须一起校验。 */
  boundaryExpansion: number;
  /** 按 x+ 搜索坐标系缓存的列区间。 */
  columns: readonly ThetaStarColumnFreeSpan[][];
  /** 是否镜像到 x+ 搜索坐标系。 */
  mirrored: boolean;
  /** 区间所属的 route mask 引用。 */
  routeMask: Uint8Array;
}

interface ThetaStarSearchContext {
  boundaryExpansion: number;
  canAdvance: (previous: PlaneGridPoint, next: PlaneGridPoint) => boolean;
  mirrored: boolean;
  onPreview?: (preview: GraphwarPathfindingPreview) => void;
  routeMask: Uint8Array;
  start: PlaneGridPoint;
  target: PlaneGridPoint;
}

export interface GraphwarThetaStarScratch {
  /** 当前节点扩展时复用的 y 候选列表，避免热循环反复分配小数组。 */
  candidateYs: number[];
  /** 已关闭节点标记。 */
  closed: Uint8Array;
  /** 可通行列区间 cache；同一个 worker 处理同一个 route mask 的多条边时复用。 */
  freeSpanCache?: ThetaStarFreeSpanCache;
  /** 起点到对应节点的最短已知代价。 */
  gScore: Float64Array;
  /** 路径回溯父节点。 */
  parentIndexes: Int32Array;
  /** 本轮搜索写过的节点；结束时只重置这些位置，不再全图 fill。 */
  touchedIndexes: number[];
}

export interface GraphwarThetaStarPathfindingOptions extends GraphwarPathfindingOptions {
  /** 调用方可复用的工作区；一键清图 worker 会用它减少重复分配和全图清空。 */
  scratch?: GraphwarThetaStarScratch;
}

const THETA_STAR_HEURISTICS = {
  /** 页面动画每隔若干扩展点刷新一次，避免大量 postMessage 抢占搜索时间。 */
  previewExpansionInterval: 128,
  /** 搜索动画最多展示的候选点数量，和可视图预览保持同量级。 */
  previewCandidateLimit: 64,
  /** 搜索动画最多保留的已接受边数量。 */
  previewEdgeLimit: 24,
} as const;

/*
 * 下一步仍只推进到 x+1，避免退化成全可见图；y 候选来自前方列的自由区间边界，
 * 让搜索能提前朝障碍上下边缘移动，而不是撞到障碍列后才做大幅跳转。
 */
const THETA_STAR_LOOKAHEAD_COLUMN_OFFSETS: readonly number[] = [1, 2, 4, 8, 16, 32, 64, 128];

const GRAPHWAR_PLANE_CELL_COUNT = GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT;

export function createGraphwarThetaStarScratch(): GraphwarThetaStarScratch {
  const gScore = new Float64Array(GRAPHWAR_PLANE_CELL_COUNT);
  const parentIndexes = new Int32Array(GRAPHWAR_PLANE_CELL_COUNT);
  gScore.fill(Infinity);
  parentIndexes.fill(-1);
  return {
    candidateYs: [],
    closed: new Uint8Array(GRAPHWAR_PLANE_CELL_COUNT),
    gScore,
    parentIndexes,
    touchedIndexes: [],
  };
}

/** 用有向 Theta* 在固定 Graphwar 平面 mask 上搜索更穷尽的 x+ 绕障路线。 */
export async function buildGraphwarThetaStarPathForMask(options: GraphwarThetaStarPathfindingOptions) {
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

  const scratch = options.scratch ?? createGraphwarThetaStarScratch();
  let path: PlaneGridPoint[] | undefined;
  try {
    resetThetaStarSearchScratch(scratch);
    path = await findThetaStarPath({
      boundaryExpansion: options.boundaryExpansion,
      canAdvance,
      isCancelled: options.isCancelled,
      mirrored,
      onPreview: options.onPreview,
      routeMask: options.routeMask,
      scratch,
      start,
      target,
      yieldControl: options.yieldControl,
    });
  } finally {
    resetThetaStarSearchScratch(scratch);
  }
  return path?.map((point) => mirrorPlaneGridPoint(point, mirrored));
}

async function findThetaStarPath({
  boundaryExpansion,
  canAdvance,
  isCancelled,
  mirrored,
  onPreview,
  routeMask,
  scratch,
  start,
  target,
  yieldControl,
}: ThetaStarSearchContext & {
  isCancelled?: () => boolean;
  scratch: GraphwarThetaStarScratch;
  yieldControl?: () => Promise<void> | void;
}) {
  const startIndex = createPlaneGridPointIndex(start);
  const targetIndex = createPlaneGridPointIndex(target);
  const { closed, gScore, parentIndexes } = scratch;
  const freeSpansByColumn = getThetaStarFreeSpansByColumn({
    boundaryExpansion,
    mirrored,
    routeMask,
    scratch,
  });

  const openSet = new ThetaStarOpenSet();
  const acceptedEdges: [PlaneGridPoint, PlaneGridPoint][] | undefined = onPreview ? [] : undefined;
  setThetaStarNodeState(scratch, startIndex, 0, startIndex);
  openSet.push({
    index: startIndex,
    priority: planeGridPointDistance(start, target),
    routeCost: 0,
  });

  let expansionCount = 0;
  while (openSet.size > 0) {
    if (isCancelled?.()) {
      return undefined;
    }

    const currentNode = openSet.pop();
    if (!currentNode || closed[currentNode.index] || currentNode.routeCost !== gScore[currentNode.index]) {
      continue;
    }

    const current = createPlaneGridPointFromIndex(currentNode.index);
    if (currentNode.index === targetIndex) {
      const rawPath = reconstructThetaStarPath(targetIndex, parentIndexes);
      const path = simplifyThetaStarPath(rawPath, {
        boundaryExpansion,
        canAdvance,
        mirrored,
        routeMask,
        start,
        target,
      });
      onPreview?.({
        acceptedEdges: acceptedEdges ?? [],
        bestPath: path,
        candidates: collectThetaStarPreviewCandidates(openSet, currentNode.index, startIndex, targetIndex),
        current,
        mirrored,
      });
      return path;
    }

    if (canAdvance(current, target) && edgeIsClear(current, target, routeMask, mirrored, boundaryExpansion)) {
      if (acceptedEdges) {
        recordAcceptedEdge(acceptedEdges, current, target);
      }
      const rawPath = [...reconstructThetaStarPath(currentNode.index, parentIndexes), target];
      const path = simplifyThetaStarPath(rawPath, {
        boundaryExpansion,
        canAdvance,
        mirrored,
        routeMask,
        start,
        target,
      });
      onPreview?.({
        acceptedEdges: acceptedEdges ?? [],
        bestPath: path,
        candidates: collectThetaStarPreviewCandidates(openSet, currentNode.index, startIndex, targetIndex),
        current,
        mirrored,
      });
      return path;
    }

    closed[currentNode.index] = 1;
    const nextX = current.x + 1;
    if (nextX > target.x) {
      continue;
    }
    const candidateYs = collectNextColumnCandidateYs({
      current,
      freeSpansByColumn,
      nextX,
      scratch,
      target,
    });
    for (const nextY of candidateYs) {
      const next = { x: nextX, y: nextY };
      if (
        !relaxThetaStarNeighbor({
          acceptedEdges,
          boundaryExpansion,
          canAdvance,
          current,
          currentIndex: currentNode.index,
          mirrored,
          next,
          openSet,
          routeMask,
          scratch,
          target,
        })
      ) {
        continue;
      }
    }

    expansionCount += 1;
    if (
      expansionCount % THETA_STAR_HEURISTICS.previewExpansionInterval === 0 &&
      !(await reportThetaStarProgress({
        acceptedEdges,
        currentIndex: currentNode.index,
        isCancelled,
        mirrored,
        onPreview,
        openSet,
        parentIndexes,
        startIndex,
        targetIndex,
        yieldControl,
      }))
    ) {
      return undefined;
    }
  }
  return undefined;
}

function relaxThetaStarNeighbor({
  acceptedEdges,
  boundaryExpansion,
  canAdvance,
  current,
  currentIndex,
  mirrored,
  next,
  openSet,
  routeMask,
  scratch,
  target,
}: Pick<ThetaStarSearchContext, "boundaryExpansion" | "canAdvance" | "mirrored" | "routeMask" | "target"> & {
  acceptedEdges?: [PlaneGridPoint, PlaneGridPoint][];
  current: PlaneGridPoint;
  currentIndex: number;
  next: PlaneGridPoint;
  openSet: ThetaStarOpenSet;
  scratch: GraphwarThetaStarScratch;
}) {
  const { gScore, parentIndexes } = scratch;
  const nextIndex = createPlaneGridPointIndex(next);
  const parentIndex = parentIndexes[currentIndex];
  const parent = parentIndex >= 0 ? createPlaneGridPointFromIndex(parentIndex) : current;
  let routeFrom = current;
  let routeFromIndex = currentIndex;

  if (
    parentIndex >= 0 &&
    parentIndex !== currentIndex &&
    canAdvance(parent, next) &&
    edgeIsClear(parent, next, routeMask, mirrored, boundaryExpansion)
  ) {
    routeFrom = parent;
    routeFromIndex = parentIndex;
  } else if (!canAdvance(current, next) || !edgeIsClear(current, next, routeMask, mirrored, boundaryExpansion)) {
    return false;
  }

  const routeCost = gScore[routeFromIndex] + planeGridPointDistance(routeFrom, next);
  if (routeCost >= gScore[nextIndex]) {
    return false;
  }

  setThetaStarNodeState(scratch, nextIndex, routeCost, routeFromIndex);
  openSet.push({
    index: nextIndex,
    priority: routeCost + planeGridPointDistance(next, target),
    routeCost,
  });
  if (acceptedEdges) {
    recordAcceptedEdge(acceptedEdges, routeFrom, next);
  }
  return true;
}

function collectNextColumnCandidateYs({
  current,
  freeSpansByColumn,
  nextX,
  scratch,
  target,
}: {
  current: PlaneGridPoint;
  freeSpansByColumn: readonly ThetaStarColumnFreeSpan[][];
  nextX: number;
  scratch: GraphwarThetaStarScratch;
  target: PlaneGridPoint;
}) {
  const candidateYs = scratch.candidateYs;
  candidateYs.length = 0;
  const nextColumnSpans = freeSpansByColumn[nextX] ?? [];
  addThetaStarCandidateY(candidateYs, current.y, nextColumnSpans);
  addThetaStarCandidateY(candidateYs, target.y, nextColumnSpans);

  for (const offset of THETA_STAR_LOOKAHEAD_COLUMN_OFFSETS) {
    const lookaheadX = Math.min(target.x, current.x + offset);
    const lookaheadSpans = freeSpansByColumn[lookaheadX] ?? [];
    for (const span of lookaheadSpans) {
      addThetaStarCandidateY(candidateYs, span.minY, nextColumnSpans);
      addThetaStarCandidateY(candidateYs, span.maxY, nextColumnSpans);
    }
  }

  candidateYs.sort(
    (left, right) =>
      Math.abs(left - current.y) - Math.abs(right - current.y) ||
      Math.abs(left - target.y) - Math.abs(right - target.y) ||
      left - right,
  );
  return candidateYs;
}

function addThetaStarCandidateY(
  candidateYs: number[],
  candidateY: number,
  nextColumnSpans: readonly ThetaStarColumnFreeSpan[],
) {
  if (!columnFreeSpansIncludeY(nextColumnSpans, candidateY) || candidateYs.includes(candidateY)) {
    return;
  }
  candidateYs.push(candidateY);
}

function columnFreeSpansIncludeY(spans: readonly ThetaStarColumnFreeSpan[], y: number) {
  for (const span of spans) {
    if (y >= span.minY && y <= span.maxY) {
      return true;
    }
  }
  return false;
}

function getThetaStarFreeSpansByColumn({
  boundaryExpansion,
  mirrored,
  routeMask,
  scratch,
}: Pick<ThetaStarSearchContext, "boundaryExpansion" | "mirrored" | "routeMask"> & {
  scratch: GraphwarThetaStarScratch;
}) {
  const cached = scratch.freeSpanCache;
  if (
    cached &&
    cached.boundaryExpansion === boundaryExpansion &&
    cached.mirrored === mirrored &&
    cached.routeMask === routeMask
  ) {
    return cached.columns;
  }

  const columns: ThetaStarColumnFreeSpan[][] = [];
  const point = { x: 0, y: 0 };
  for (let x = 0; x < GRAPHWAR_PLANE_LENGTH; x += 1) {
    point.x = x;
    columns.push(collectThetaStarColumnFreeSpans(point, routeMask, mirrored, boundaryExpansion));
  }
  scratch.freeSpanCache = {
    boundaryExpansion,
    columns,
    mirrored,
    routeMask,
  };
  return columns;
}

function collectThetaStarColumnFreeSpans(
  point: PlaneGridPoint,
  routeMask: Uint8Array,
  mirrored: boolean,
  boundaryExpansion: number,
) {
  const spans: ThetaStarColumnFreeSpan[] = [];
  let spanStartY: number | undefined;
  for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
    point.y = y;
    const free = !pointHitsPlaneMask(point, routeMask, mirrored, boundaryExpansion);
    if (free && spanStartY === undefined) {
      spanStartY = y;
      continue;
    }
    if (!free && spanStartY !== undefined) {
      spans.push({ minY: spanStartY, maxY: y - 1 });
      spanStartY = undefined;
    }
  }
  if (spanStartY !== undefined) {
    spans.push({ minY: spanStartY, maxY: GRAPHWAR_PLANE_HEIGHT - 1 });
  }
  return spans;
}

function setThetaStarNodeState(
  scratch: GraphwarThetaStarScratch,
  index: number,
  routeCost: number,
  parentIndex: number,
) {
  if (scratch.parentIndexes[index] === -1) {
    scratch.touchedIndexes.push(index);
  }
  scratch.gScore[index] = routeCost;
  scratch.parentIndexes[index] = parentIndex;
  scratch.closed[index] = 0;
}

function resetThetaStarSearchScratch(scratch: GraphwarThetaStarScratch) {
  for (const index of scratch.touchedIndexes) {
    scratch.gScore[index] = Infinity;
    scratch.parentIndexes[index] = -1;
    scratch.closed[index] = 0;
  }
  scratch.touchedIndexes.length = 0;
  scratch.candidateYs.length = 0;
}

async function reportThetaStarProgress({
  acceptedEdges,
  currentIndex,
  isCancelled,
  mirrored,
  onPreview,
  openSet,
  parentIndexes,
  startIndex,
  targetIndex,
  yieldControl,
}: {
  acceptedEdges: readonly [PlaneGridPoint, PlaneGridPoint][] | undefined;
  currentIndex: number;
  isCancelled?: () => boolean;
  mirrored: boolean;
  onPreview?: (preview: GraphwarPathfindingPreview) => void;
  openSet: ThetaStarOpenSet;
  parentIndexes: Int32Array;
  startIndex: number;
  targetIndex: number;
  yieldControl?: () => Promise<void> | void;
}) {
  if (isCancelled?.()) {
    return false;
  }

  onPreview?.({
    acceptedEdges: acceptedEdges ?? [],
    bestPath: reconstructThetaStarPath(currentIndex, parentIndexes),
    candidates: collectThetaStarPreviewCandidates(openSet, currentIndex, startIndex, targetIndex),
    current: createPlaneGridPointFromIndex(currentIndex),
    mirrored,
  });

  const yielded = yieldControl?.();
  if (yielded) {
    await yielded;
  }
  return !isCancelled?.();
}

function simplifyThetaStarPath(path: readonly PlaneGridPoint[], context: ThetaStarSearchContext) {
  if (path.length <= 2) {
    return [...path];
  }

  const simplified: PlaneGridPoint[] = [];
  let anchorIndex = 0;
  while (anchorIndex < path.length) {
    const anchor = path[anchorIndex];
    if (!anchor) {
      break;
    }
    simplified.push(anchor);
    if (anchorIndex >= path.length - 1) {
      break;
    }

    let nextIndex = anchorIndex + 1;
    for (let candidateIndex = path.length - 1; candidateIndex > anchorIndex + 1; candidateIndex -= 1) {
      const candidate = path[candidateIndex];
      if (
        candidate &&
        context.canAdvance(anchor, candidate) &&
        edgeIsClear(anchor, candidate, context.routeMask, context.mirrored, context.boundaryExpansion)
      ) {
        nextIndex = candidateIndex;
        break;
      }
    }
    anchorIndex = nextIndex;
  }
  return simplified;
}

function reconstructThetaStarPath(targetIndex: number, parentIndexes: Int32Array) {
  const path: PlaneGridPoint[] = [];
  let currentIndex = targetIndex;
  const seenIndexes = new Set<number>();
  while (currentIndex >= 0 && !seenIndexes.has(currentIndex)) {
    seenIndexes.add(currentIndex);
    path.push(createPlaneGridPointFromIndex(currentIndex));
    const parentIndex = parentIndexes[currentIndex];
    if (parentIndex === currentIndex) {
      break;
    }
    currentIndex = parentIndex;
  }
  return path.reverse();
}

function collectThetaStarPreviewCandidates(
  openSet: ThetaStarOpenSet,
  currentIndex: number,
  startIndex: number,
  targetIndex: number,
) {
  const indexes = new Set<number>([startIndex, targetIndex, currentIndex]);
  for (const index of openSet.snapshotIndexes(THETA_STAR_HEURISTICS.previewCandidateLimit)) {
    indexes.add(index);
    if (indexes.size >= THETA_STAR_HEURISTICS.previewCandidateLimit) {
      break;
    }
  }
  return [...indexes].map(createPlaneGridPointFromIndex);
}

function recordAcceptedEdge(
  acceptedEdges: [PlaneGridPoint, PlaneGridPoint][],
  start: PlaneGridPoint,
  target: PlaneGridPoint,
) {
  acceptedEdges.push([start, target]);
  if (acceptedEdges.length > THETA_STAR_HEURISTICS.previewEdgeLimit) {
    acceptedEdges.splice(0, acceptedEdges.length - THETA_STAR_HEURISTICS.previewEdgeLimit);
  }
}

function edgeIsClear(
  start: PlaneGridPoint,
  target: PlaneGridPoint,
  routeMask: Uint8Array,
  mirrored: boolean,
  boundaryExpansion: number,
) {
  return !lineHitsPlaneMask(start, target, routeMask, mirrored, boundaryExpansion);
}

function createPlaneGridPointIndex(point: PlaneGridPoint) {
  return point.y * GRAPHWAR_PLANE_LENGTH + point.x;
}

function createPlaneGridPointFromIndex(index: number): PlaneGridPoint {
  return {
    x: index % GRAPHWAR_PLANE_LENGTH,
    y: Math.floor(index / GRAPHWAR_PLANE_LENGTH),
  };
}

function planeGridPointDistance(left: PlaneGridPoint, right: PlaneGridPoint) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function pointsEqual(left: PlaneGridPoint, right: PlaneGridPoint) {
  return left.x === right.x && left.y === right.y;
}

class ThetaStarOpenSet {
  private readonly nodes: ThetaStarOpenNode[] = [];

  get size() {
    return this.nodes.length;
  }

  push(node: ThetaStarOpenNode) {
    this.nodes.push(node);
    this.bubbleUp(this.nodes.length - 1);
  }

  pop() {
    const first = this.nodes[0];
    const last = this.nodes.pop();
    if (!first || !last) {
      return first;
    }
    if (this.nodes.length > 0) {
      this.nodes[0] = last;
      this.sinkDown(0);
    }
    return first;
  }

  snapshotIndexes(limit: number) {
    return this.nodes
      .slice(0, limit)
      .sort(compareThetaStarOpenNodes)
      .map((node) => node.index);
  }

  private bubbleUp(startIndex: number) {
    let index = startIndex;
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const node = this.nodes[index];
      const parent = this.nodes[parentIndex];
      if (!node || !parent || compareThetaStarOpenNodes(node, parent) >= 0) {
        break;
      }
      this.nodes[index] = parent;
      this.nodes[parentIndex] = node;
      index = parentIndex;
    }
  }

  private sinkDown(startIndex: number) {
    let index = startIndex;
    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      let bestIndex = index;
      const best = this.nodes[bestIndex];
      const left = this.nodes[leftIndex];
      const right = this.nodes[rightIndex];

      if (left && best && compareThetaStarOpenNodes(left, best) < 0) {
        bestIndex = leftIndex;
      }
      const nextBest = this.nodes[bestIndex];
      if (right && nextBest && compareThetaStarOpenNodes(right, nextBest) < 0) {
        bestIndex = rightIndex;
      }
      if (bestIndex === index) {
        break;
      }

      const node = this.nodes[index];
      const child = this.nodes[bestIndex];
      if (!node || !child) {
        break;
      }
      this.nodes[index] = child;
      this.nodes[bestIndex] = node;
      index = bestIndex;
    }
  }
}

function compareThetaStarOpenNodes(left: ThetaStarOpenNode, right: ThetaStarOpenNode) {
  return left.priority - right.priority || left.routeCost - right.routeCost || left.index - right.index;
}
