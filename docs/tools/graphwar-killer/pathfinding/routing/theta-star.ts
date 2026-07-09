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

interface ThetaStarSearchContext {
  boundaryExpansion: number;
  canAdvance: (previous: PlaneGridPoint, next: PlaneGridPoint) => boolean;
  mirrored: boolean;
  onPreview?: (preview: GraphwarPathfindingPreview) => void;
  routeMask: Uint8Array;
  start: PlaneGridPoint;
  target: PlaneGridPoint;
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
 * Theta* 在常规 8 邻域上只允许每前进 1px 纵向移动 1px，容易错过 Graphwar 中近似竖直的有效控制段。
 * 这里仍保持 x+ 单调，但允许一个 x+ cell 搭配更大的 y 跳步；每条跳步边都会做真实 mask 线段碰撞检查。
 */
const THETA_STAR_Y_OFFSETS: readonly number[] = [
  0, -1, 1, -2, 2, -3, 3, -4, 4, -6, 6, -8, 8, -12, 12, -16, 16, -24, 24, -32, 32, -48, 48, -64, 64,
];

/** 用有向 Theta* 在固定 Graphwar 平面 mask 上搜索更穷尽的 x+ 绕障路线。 */
export async function buildGraphwarThetaStarPathForMask(options: GraphwarPathfindingOptions) {
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

  const path = await findThetaStarPath({
    boundaryExpansion: options.boundaryExpansion,
    canAdvance,
    isCancelled: options.isCancelled,
    mirrored,
    onPreview: options.onPreview,
    routeMask: options.routeMask,
    start,
    target,
    yieldControl: options.yieldControl,
  });
  return path?.map((point) => mirrorPlaneGridPoint(point, mirrored));
}

async function findThetaStarPath({
  boundaryExpansion,
  canAdvance,
  isCancelled,
  mirrored,
  onPreview,
  routeMask,
  start,
  target,
  yieldControl,
}: ThetaStarSearchContext & {
  isCancelled?: () => boolean;
  yieldControl?: () => Promise<void> | void;
}) {
  const startIndex = createPlaneGridPointIndex(start);
  const targetIndex = createPlaneGridPointIndex(target);
  const gScore = new Float64Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
  const parentIndexes = new Int32Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
  const closed = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
  gScore.fill(Infinity);
  parentIndexes.fill(-1);

  const openSet = new ThetaStarOpenSet();
  const acceptedEdges: [PlaneGridPoint, PlaneGridPoint][] | undefined = onPreview ? [] : undefined;
  gScore[startIndex] = 0;
  parentIndexes[startIndex] = startIndex;
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

    closed[currentNode.index] = 1;
    for (const yOffset of THETA_STAR_Y_OFFSETS) {
      const next = { x: current.x + 1, y: current.y + yOffset };
      if (next.x > target.x || !isInsidePlane(next.x, next.y)) {
        continue;
      }
      if (
        pointHitsPlaneMask(next, routeMask, mirrored, boundaryExpansion) ||
        !relaxThetaStarNeighbor({
          acceptedEdges,
          boundaryExpansion,
          canAdvance,
          closed,
          current,
          currentIndex: currentNode.index,
          gScore,
          mirrored,
          next,
          openSet,
          parentIndexes,
          routeMask,
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
  closed,
  current,
  currentIndex,
  gScore,
  mirrored,
  next,
  openSet,
  parentIndexes,
  routeMask,
  target,
}: Pick<ThetaStarSearchContext, "boundaryExpansion" | "canAdvance" | "mirrored" | "routeMask" | "target"> & {
  acceptedEdges?: [PlaneGridPoint, PlaneGridPoint][];
  closed: Uint8Array;
  current: PlaneGridPoint;
  currentIndex: number;
  gScore: Float64Array;
  next: PlaneGridPoint;
  openSet: ThetaStarOpenSet;
  parentIndexes: Int32Array;
}) {
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

  gScore[nextIndex] = routeCost;
  parentIndexes[nextIndex] = routeFromIndex;
  closed[nextIndex] = 0;
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

function isInsidePlane(x: number, y: number) {
  return x >= 0 && x < GRAPHWAR_PLANE_LENGTH && y >= 0 && y < GRAPHWAR_PLANE_HEIGHT;
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
