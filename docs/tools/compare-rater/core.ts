/**
 * 用户可录入的相对关系等级。
 *
 * 正向等级表示 `baseName` 高于 `targetName`，负向等级表示反过来，“same” 表示相近。
 */
export type RelationLevel = "much-better" | "better" | "same" | "worse" | "much-worse";

/** 评分锚点角色。 */
export type AnchorRole = "best" | "worst";

/** 关系图中的番剧节点。 */
export interface AnimeItem {
  id: number;
  name: string;
  /** 一维相对位置；数值越大表示相对越好。 */
  offset: number;
  score: number | undefined;
  x: number;
  y: number;
}

/** 用户录入的一条相对比较关系。 */
export interface RelationRecord {
  id: number;
  baseName: string;
  targetName: string;
  level: RelationLevel;
  /** 目标相对差值，语义为 `baseName - targetName`。 */
  delta: number;
  /** 求解时这条关系的影响强度，默认是 1。 */
  weight?: number;
}

/** 用户给某个节点绑定的绝对评分。 */
export interface ScoreAnchor {
  name: string;
  score: number;
}

/** 用于把相对位置映射到 1-5 分的最高/最低评分锚点。 */
export interface ScoreAnchors {
  best?: ScoreAnchor;
  worst?: ScoreAnchor;
}

/** 可直接渲染到 SVG 的关系边。 */
export interface GraphEdge {
  id: number;
  path: string;
  /** 是否显示箭头；“差不多”关系没有方向，不显示箭头。 */
  hasArrow: boolean;
  relationLevel: RelationLevel;
}

/** 生成 SVG path 前的边草稿。 */
interface GraphEdgeDraft {
  id: number;
  fromName: string;
  fromX: number;
  fromY: number;
  toName: string;
  toX: number;
  toY: number;
  /** 是否显示箭头；由关系方向和评分映射共同决定。 */
  hasArrow: boolean;
  relationLevel: RelationLevel;
  /** 用于把近似共线的边分到同组，方便错开曲线。 */
  lineKey: string;
}

/** 从节点中心裁剪到节点边缘后的边端点。 */
interface GraphEdgeEndpoints {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 起点所在侧边，`-1` 为左侧，`0` 为顶部，`1` 为右侧。 */
  fromSide: -1 | 0 | 1;
  /** 终点所在侧边，`-1` 为左侧，`0` 为顶部，`1` 为右侧。 */
  toSide: -1 | 0 | 1;
}

const GRAPH_NODE_WIDTH = 15;
const GRAPH_NODE_HEIGHT = 10;
const GRAPH_EDGE_NODE_HALF_WIDTH = 6.8;
const GRAPH_EDGE_NODE_HALF_HEIGHT = 5;
const GRAPH_VERTICAL_SPREAD = 84;
const GRAPH_VIEWPORT_BASE_HEIGHT = 380;
const GRAPH_VIEWPORT_OFFSET_HEIGHT = 48;
const GRAPH_VIEWPORT_MAX_HEIGHT = 620;

/**
 * 标准化番剧名或表单文本，去掉首尾空白并把连续空白折叠成单个空格。
 *
 * @param value - 用户输入的原始文本。
 * @returns 可用于比较、存储和展示的文本。
 */
export function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * 创建无方向的关系去重键。
 *
 * `A-B` 与 `B-A` 会得到同一个 key，用于禁止同一对番剧录入多条矛盾或重复关系。
 *
 * @param left - 关系一侧的番剧名。
 * @param right - 关系另一侧的番剧名。
 * @returns 可比较的 pair key；任一名称为空时返回 `undefined`。
 */
export function createRelationPairKey(left: string, right: string) {
  const normalizedLeft = normalizeName(left);
  const normalizedRight = normalizeName(right);
  if (!normalizedLeft || !normalizedRight) {
    return undefined;
  }
  return [normalizedLeft, normalizedRight].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")).join("\u0000");
}

/**
 * 根据关系记录生成图节点。
 *
 * 先用关系 delta 求出每部番的相对位置，再把相对位置映射到纵向坐标，并按连通分量与同层节点做横向排布。
 *
 * @param records - 用户录入的相对关系。
 * @returns 可直接渲染或交给弹簧动画过渡的图节点。
 */
export function buildGraphItems(records: readonly RelationRecord[]) {
  const offsets = solveOffsets(records);
  const entries = Array.from(offsets.entries()).sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return left[0].localeCompare(right[0], "zh-Hans-CN");
  });

  const minOffset = Math.min(...entries.map((entry) => entry[1]), 0);
  const maxOffset = Math.max(...entries.map((entry) => entry[1]), 0);
  const span = Math.max(maxOffset - minOffset, 1);

  const items = entries.map(([name, offset], index) => {
    const progress = (offset - minOffset) / span;
    return {
      id: index + 1,
      name,
      offset,
      score: undefined,
      x: 50,
      y: 50 - (progress - 0.5) * GRAPH_VERTICAL_SPREAD,
    };
  });
  return avoidGraphItemOverlap(layoutLeafItemsWithNeighbors(layoutGraphItems(items, records), records));
}

/**
 * 根据关系、节点位置和当前分数生成 SVG 边路径。
 *
 * 非“差不多”关系会按高分指向低分决定箭头方向；多条近似重叠的边会自动增加曲线偏移。
 *
 * @param records - 用户录入的相对关系。
 * @param items - 当前图节点位置，动画中可传入插值后的节点。
 * @param scores - 当前映射分数，用于决定箭头方向。
 * @returns SVG path 与边样式元数据。
 */
export function buildGraphEdges(
  records: readonly RelationRecord[],
  items: readonly AnimeItem[],
  scores: ReadonlyMap<string, number | undefined>,
) {
  const itemByName = new Map(items.map((item) => [item.name, item]));
  const edgeDrafts = records.flatMap<GraphEdgeDraft>((record) => {
    const direction = getDirectedRelation(record, scores);
    const fromItem = itemByName.get(direction.fromName);
    const toItem = itemByName.get(direction.toName);
    if (!fromItem || !toItem) {
      return [];
    }

    return [
      {
        id: record.id,
        fromName: direction.fromName,
        fromX: fromItem.x,
        fromY: fromItem.y,
        toName: direction.toName,
        toX: toItem.x,
        toY: toItem.y,
        hasArrow: direction.hasArrow,
        relationLevel: record.level,
        lineKey: getGraphEdgeLineKey(fromItem.x, fromItem.y, toItem.x, toItem.y),
      },
    ];
  });
  const edgeGroups = new Map<string, GraphEdgeDraft[]>();
  for (const edgeDraft of edgeDrafts) {
    edgeGroups.set(edgeDraft.lineKey, [...(edgeGroups.get(edgeDraft.lineKey) ?? []), edgeDraft]);
  }

  return Array.from(edgeGroups.values()).flatMap((edgeGroup) =>
    edgeGroup
      .toSorted((left, right) => left.id - right.id)
      .map((edgeDraft, edgeIndex) =>
        buildGraphEdge(edgeDraft, getParallelEdgeOffset(edgeIndex, edgeGroup.length), items),
      ),
  );
}

/**
 * 把相对位置映射成 1-5 分。
 *
 * 若同时存在最高和最低锚点，会使用二者建立线性映射；若只有一个锚点，则按相对位置差值平移。
 *
 * @param items - 已计算相对位置的节点。
 * @param anchors - 用户给出的最高/最低评分锚点。
 * @returns 以番剧名索引的分数表，未能映射时值为 `undefined`。
 */
export function mapScores(items: readonly AnimeItem[], anchors: ScoreAnchors) {
  const scores = new Map<string, number | undefined>();
  const best = findAnchor(items, anchors.best);
  const worst = findAnchor(items, anchors.worst);

  if (!best && !worst) {
    return scores;
  }

  const bestOffset = best ? roundOffsetForDisplay(best.item.offset) : undefined;
  const worstOffset = worst ? roundOffsetForDisplay(worst.item.offset) : undefined;
  if (
    best &&
    worst &&
    best.item.name !== worst.item.name &&
    bestOffset !== undefined &&
    worstOffset !== undefined &&
    bestOffset !== worstOffset
  ) {
    const highAnchor = bestOffset >= worstOffset ? best : worst;
    const lowAnchor = highAnchor === best ? worst : best;
    const highOffset = roundOffsetForDisplay(highAnchor.item.offset);
    const lowOffset = roundOffsetForDisplay(lowAnchor.item.offset);
    const highScore = Math.max(best.score, worst.score);
    const lowScore = Math.min(best.score, worst.score);
    const scale = (highScore - lowScore) / (highOffset - lowOffset);
    const intercept = highScore - scale * highOffset;
    for (const item of items) {
      scores.set(item.name, clampScore(intercept + scale * roundOffsetForDisplay(item.offset)));
    }
    return scores;
  }

  const anchor = best ?? worst;
  if (!anchor) {
    return scores;
  }

  for (const item of items) {
    scores.set(
      item.name,
      clampScore(anchor.score + (roundOffsetForDisplay(item.offset) - roundOffsetForDisplay(anchor.item.offset))),
    );
  }
  return scores;
}

/**
 * 从分数表中读取指定番剧的映射分数。
 *
 * @param name - 番剧名。
 * @param scores - `mapScores` 生成的分数表。
 * @returns 映射分数；不存在时为 `undefined`。
 */
export function mappedScore(name: string, scores: ReadonlyMap<string, number | undefined>) {
  return scores.get(name);
}

/**
 * 把数值限制在闭区间内。
 *
 * @param value - 待限制的数值。
 * @param minValue - 最小值。
 * @param maxValue - 最大值。
 * @returns 落在 `[minValue, maxValue]` 内的数值。
 */
export function clampNumber(value: number, minValue: number, maxValue: number) {
  return Math.min(Math.max(value, minValue), maxValue);
}

/**
 * 把评分限制在工具允许的 1-5 分范围内。
 *
 * @param value - 原始评分。
 * @returns 限制后的评分。
 */
export function clampScore(value: number) {
  return Math.min(Math.max(value, 1), 5);
}

/**
 * 格式化相对位置。
 *
 * @param value - 原始相对位置。
 * @returns 保留两位小数的展示文本。
 */
export function formatOffset(value: number) {
  return roundOffsetForDisplay(value).toFixed(2);
}

/**
 * 把相对位置舍入到展示精度。
 *
 * 分数映射也使用同一精度，保证“看起来相同”的相对位置不会因为浮点误差映射出不同分数。
 *
 * @param value - 原始相对位置。
 * @returns 保留两位小数的数值，且不会返回 `-0`。
 */
export function roundOffsetForDisplay(value: number) {
  const roundedValue = Math.round(value * 100) / 100;
  return Object.is(roundedValue, -0) ? 0 : roundedValue;
}

/**
 * 根据相对位置跨度给关系图计算视口高度。
 *
 * @param items - 当前图节点。
 * @returns 视口最小高度，单位为 px。
 */
export function getGraphViewportHeight(items: readonly AnimeItem[]) {
  if (items.length === 0) {
    return GRAPH_VIEWPORT_BASE_HEIGHT;
  }

  const minOffset = Math.min(...items.map((item) => item.offset));
  const maxOffset = Math.max(...items.map((item) => item.offset));
  const offsetSpan = Math.max(maxOffset - minOffset, 1);
  return Math.round(
    clampNumber(
      GRAPH_VIEWPORT_BASE_HEIGHT + offsetSpan * GRAPH_VIEWPORT_OFFSET_HEIGHT,
      GRAPH_VIEWPORT_BASE_HEIGHT,
      GRAPH_VIEWPORT_MAX_HEIGHT,
    ),
  );
}

/**
 * 用迭代松弛法求解每个番剧的一维相对位置。
 *
 * 每条关系提供一个目标差值 `base - target = delta`。冲突关系会被平均折中，最终整体均值归零。
 */
function solveOffsets(records: readonly RelationRecord[]) {
  const names = Array.from(new Set(records.flatMap((record) => [record.baseName, record.targetName])));
  const offsets = new Map(names.map((name) => [name, 0]));
  if (names.length === 0) {
    return offsets;
  }

  for (let iteration = 0; iteration < 180; iteration += 1) {
    const nextOffsets = new Map(offsets);
    for (const record of records) {
      const baseOffset = offsets.get(record.baseName) ?? 0;
      const targetOffset = offsets.get(record.targetName) ?? 0;
      const error = baseOffset - targetOffset - record.delta;
      const correction = error * 0.18 * (record.weight ?? 1);
      nextOffsets.set(record.baseName, (nextOffsets.get(record.baseName) ?? 0) - correction);
      nextOffsets.set(record.targetName, (nextOffsets.get(record.targetName) ?? 0) + correction);
    }

    const average = Array.from(nextOffsets.values()).reduce((total, value) => total + value, 0) / names.length;
    for (const name of names) {
      nextOffsets.set(name, (nextOffsets.get(name) ?? 0) - average);
    }
    offsets.clear();
    for (const [name, value] of nextOffsets) {
      offsets.set(name, value);
    }
  }

  return offsets;
}

/**
 * 把用户录入的关系转换为渲染方向。
 *
 * “差不多”没有箭头；其它关系优先按当前映射分数决定高低，分数相同或缺失时退回到原始 delta。
 */
function getDirectedRelation(record: RelationRecord, scores: ReadonlyMap<string, number | undefined>) {
  if (record.delta === 0) {
    return {
      fromName: record.targetName,
      toName: record.baseName,
      hasArrow: false,
    };
  }

  const baseScore = scores.get(record.baseName);
  const targetScore = scores.get(record.targetName);
  const actualDelta = baseScore !== undefined && targetScore !== undefined ? baseScore - targetScore : record.delta;
  const baseIsHigher = Math.abs(actualDelta) < 0.005 ? record.delta > 0 : actualDelta > 0;
  if (baseIsHigher) {
    return {
      fromName: record.baseName,
      toName: record.targetName,
      hasArrow: true,
    };
  }

  return {
    fromName: record.targetName,
    toName: record.baseName,
    hasArrow: true,
  };
}

/**
 * 把一条边草稿转换成具体 SVG path。
 *
 * 根据端点位置选择直线、同侧二次贝塞尔或异侧三次贝塞尔。
 */
function buildGraphEdge(edgeDraft: GraphEdgeDraft, curveOffset: number, items: readonly AnimeItem[]): GraphEdge {
  const effectiveCurveOffset = getEffectiveCurveOffset(edgeDraft, curveOffset, items);
  const endpoints = trimEdgeLine(edgeDraft.fromX, edgeDraft.fromY, edgeDraft.toX, edgeDraft.toY, effectiveCurveOffset);
  const { x1, y1, x2, y2 } = endpoints;
  if (endpoints.fromSide === 0 && endpoints.toSide === 0) {
    const control = getTopSideEdgeControl(endpoints, effectiveCurveOffset);
    return {
      id: edgeDraft.id,
      path: `M ${x1.toFixed(2)} ${y1.toFixed(2)} Q ${control.x.toFixed(2)} ${control.y.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}`,
      hasArrow: edgeDraft.hasArrow,
      relationLevel: edgeDraft.relationLevel,
    };
  }

  if (effectiveCurveOffset === 0) {
    return {
      id: edgeDraft.id,
      path: `M ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)}`,
      hasArrow: edgeDraft.hasArrow,
      relationLevel: edgeDraft.relationLevel,
    };
  }

  if (endpoints.fromSide === endpoints.toSide) {
    const control = getSameSideEdgeControl(endpoints, effectiveCurveOffset);
    return {
      id: edgeDraft.id,
      path: `M ${x1.toFixed(2)} ${y1.toFixed(2)} Q ${control.x.toFixed(2)} ${control.y.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}`,
      hasArrow: edgeDraft.hasArrow,
      relationLevel: edgeDraft.relationLevel,
    };
  }

  const controls = getOppositeSideEdgeControls(endpoints, effectiveCurveOffset);
  return {
    id: edgeDraft.id,
    path: `M ${x1.toFixed(2)} ${y1.toFixed(2)} C ${controls.c1x.toFixed(2)} ${controls.c1y.toFixed(2)} ${controls.c2x.toFixed(2)} ${controls.c2y.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    hasArrow: edgeDraft.hasArrow,
    relationLevel: edgeDraft.relationLevel,
  };
}

/**
 * 计算边的实际曲线偏移。
 *
 * 没有并行边偏移时，也给水平、近垂直和普通边提供少量默认弯曲，降低线条重叠和直线突兀感。
 */
function getEffectiveCurveOffset(edgeDraft: GraphEdgeDraft, curveOffset: number, items: readonly AnimeItem[]) {
  if (curveOffset !== 0) {
    return curveOffset;
  }
  if (Math.abs(edgeDraft.fromY - edgeDraft.toY) < 1) {
    return 4;
  }
  if (Math.abs(edgeDraft.fromX - edgeDraft.toX) < GRAPH_NODE_WIDTH * 1.25) {
    return getVerticalEdgeSide(edgeDraft, items) * 7;
  }
  return 3;
}

/**
 * 给近垂直边选择更空的一侧。
 *
 * 近垂直边固定走右侧会和右侧节点挤在一起；这里比较左右走廊的节点占用，选择更宽松的方向。
 */
function getVerticalEdgeSide(edgeDraft: GraphEdgeDraft, items: readonly AnimeItem[]) {
  const leftScore = getVerticalEdgeSideClearance(edgeDraft, items, -1);
  const rightScore = getVerticalEdgeSideClearance(edgeDraft, items, 1);
  if (leftScore !== rightScore) {
    return leftScore > rightScore ? -1 : 1;
  }
  return edgeDraft.toX >= edgeDraft.fromX ? 1 : -1;
}

/** 计算近垂直边某一侧走廊的空旷程度，数值越大越宽松。 */
function getVerticalEdgeSideClearance(edgeDraft: GraphEdgeDraft, items: readonly AnimeItem[], side: -1 | 1) {
  const corridorX = (edgeDraft.fromX + edgeDraft.toX) / 2 + side * (GRAPH_EDGE_NODE_HALF_WIDTH + 7);
  const minY = Math.min(edgeDraft.fromY, edgeDraft.toY) - GRAPH_NODE_HEIGHT;
  const maxY = Math.max(edgeDraft.fromY, edgeDraft.toY) + GRAPH_NODE_HEIGHT;
  const blockingItems = items.filter(
    (item) => item.name !== edgeDraft.fromName && item.name !== edgeDraft.toName && item.y >= minY && item.y <= maxY,
  );
  if (blockingItems.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.min(...blockingItems.map((item) => Math.abs(item.x - corridorX)));
}

/** 计算近同高边的顶部二次贝塞尔控制点。 */
function getTopSideEdgeControl(endpoints: GraphEdgeEndpoints, curveOffset: number) {
  const lift = Math.max(Math.abs(curveOffset), 5);
  return {
    x: (endpoints.x1 + endpoints.x2) / 2,
    y: Math.min(endpoints.y1, endpoints.y2) - lift,
  };
}

/** 计算同侧出发/到达边的二次贝塞尔控制点。 */
function getSameSideEdgeControl(endpoints: GraphEdgeEndpoints, curveOffset: number) {
  const absCurveOffset = Math.abs(curveOffset);
  return {
    x: (endpoints.x1 + endpoints.x2) / 2 + endpoints.fromSide * absCurveOffset,
    y: (endpoints.y1 + endpoints.y2) / 2,
  };
}

/**
 * 计算异侧出发/到达边的三次贝塞尔控制点。
 *
 * 起点和终点的控制点都朝各自节点外侧延伸，使曲线先离开节点再转向目标。
 */
function getOppositeSideEdgeControls(endpoints: GraphEdgeEndpoints, curveOffset: number) {
  const absCurveOffset = Math.abs(curveOffset);
  const deltaX = endpoints.x2 - endpoints.x1;
  const deltaY = endpoints.y2 - endpoints.y1;
  if (Math.abs(endpoints.y2 - endpoints.y1) < 1) {
    const verticalOffset = Math.abs(curveOffset);
    return {
      c1x: endpoints.x1 + deltaX / 3,
      c1y: endpoints.y1 - verticalOffset,
      c2x: endpoints.x2 - deltaX / 3,
      c2y: endpoints.y2 - verticalOffset,
    };
  }

  const horizontalHandle = Math.max(absCurveOffset, Math.min(Math.abs(deltaX) * 0.42, 9));
  const verticalHandle = Math.min(Math.abs(deltaY) / 3, Math.max(1.2, Math.abs(deltaY) * 0.18));
  const verticalDirection = deltaY >= 0 ? 1 : -1;
  return {
    c1x: endpoints.x1 + endpoints.fromSide * horizontalHandle,
    c1y: endpoints.y1 + verticalDirection * verticalHandle,
    c2x: endpoints.x2 + endpoints.toSide * horizontalHandle,
    c2y: endpoints.y2 - verticalDirection * verticalHandle,
  };
}

/** 给同一条视觉直线上的多条边分配交错偏移。 */
function getParallelEdgeOffset(index: number, count: number) {
  if (count <= 1) {
    return 0;
  }
  const distance = Math.floor(index / 2) + 1;
  const direction = index % 2 === 0 ? -1 : 1;
  return direction * distance * 5;
}

/**
 * 生成近似共线边的分组 key。
 *
 * 方向会归一化，所以 A->B 与 B->A 会被视为同一条视觉直线。
 */
function getGraphEdgeLineKey(x1: number, y1: number, x2: number, y2: number) {
  const deltaX = x2 - x1;
  const deltaY = y2 - y1;
  const length = Math.hypot(deltaX, deltaY);
  if (length === 0) {
    return "point";
  }

  let unitX = deltaX / length;
  let unitY = deltaY / length;
  if (unitX < 0 || (Math.abs(unitX) < 0.001 && unitY < 0)) {
    unitX *= -1;
    unitY *= -1;
  }

  const angleBucket = Math.round(Math.atan2(unitY, unitX) / (Math.PI / 24));
  const offsetBucket = Math.round((x1 * unitY - y1 * unitX) / 3);
  return `${angleBucket}:${offsetBucket}`;
}

/**
 * 把边端点从节点中心裁剪到节点边缘附近。
 *
 * 近同高关系使用顶部中心互联；其它关系使用左右侧边，供贝塞尔控制点判断外扩方向。
 */
function trimEdgeLine(fromX: number, fromY: number, toX: number, toY: number, curveOffset: number): GraphEdgeEndpoints {
  const deltaX = toX - fromX;
  const deltaY = toY - fromY;
  const halfNodeWidth = GRAPH_EDGE_NODE_HALF_WIDTH;
  if (Math.abs(deltaY) <= GRAPH_EDGE_NODE_HALF_HEIGHT) {
    return {
      x1: fromX,
      y1: fromY - GRAPH_EDGE_NODE_HALF_HEIGHT,
      x2: toX,
      y2: toY - GRAPH_EDGE_NODE_HALF_HEIGHT,
      fromSide: 0,
      toSide: 0,
    };
  }

  if (Math.abs(deltaX) < GRAPH_NODE_WIDTH * 0.75) {
    const side = (curveOffset === 0 ? (deltaY >= 0 ? 1 : -1) : Math.sign(curveOffset)) as -1 | 1;
    return {
      x1: fromX + side * halfNodeWidth,
      y1: fromY,
      x2: toX + side * halfNodeWidth,
      y2: toY,
      fromSide: side,
      toSide: side,
    };
  }

  const fromSide = (deltaX >= 0 ? 1 : -1) as -1 | 1;
  const toSide = -fromSide as -1 | 1;
  return {
    x1: fromX + fromSide * halfNodeWidth,
    y1: fromY,
    x2: toX - fromSide * halfNodeWidth,
    y2: toY,
    fromSide,
    toSide,
  };
}

/**
 * 对节点做整体图布局。
 *
 * 先按连通分量分组，再把同一相对位置的节点排成横向行，最后保持原始 id 顺序返回。
 */
function layoutGraphItems(items: readonly AnimeItem[], records: readonly RelationRecord[]) {
  const componentIds = getGraphComponentIds(items, records);
  const nodeDegrees = getGraphNodeDegrees(records);
  const componentGroups = new Map<number, AnimeItem[]>();
  for (const item of items) {
    const componentId = componentIds.get(item.name) ?? item.id;
    componentGroups.set(componentId, [...(componentGroups.get(componentId) ?? []), item]);
  }

  const components = Array.from(componentGroups.values()).sort((left, right) => {
    const leftMaxOffset = Math.max(...left.map((item) => item.offset));
    const rightMaxOffset = Math.max(...right.map((item) => item.offset));
    if (rightMaxOffset !== leftMaxOffset) {
      return rightMaxOffset - leftMaxOffset;
    }
    return getFirstGraphItemName(left).localeCompare(getFirstGraphItemName(right), "zh-Hans-CN");
  });

  return components
    .flatMap((component, componentIndex) => {
      const centerX = getGraphComponentCenter(componentIndex, components.length);
      const rows = new Map<string, AnimeItem[]>();
      for (const item of component) {
        const rowKey = item.y.toFixed(2);
        rows.set(rowKey, [...(rows.get(rowKey) ?? []), item]);
      }

      return Array.from(rows.values()).flatMap((rowItems) => layoutGraphRowItems(rowItems, nodeDegrees, centerX));
    })
    .sort((left, right) => left.id - right.id);
}

/**
 * 把单连接叶子节点贴近唯一邻居。
 *
 * 叶子节点通常不应该占据主干中线；优先与唯一邻居上下对齐，有同层冲突时再挂到邻居左右侧。
 */
function layoutLeafItemsWithNeighbors(items: readonly AnimeItem[], records: readonly RelationRecord[]) {
  const neighborMap = getGraphNeighborNames(records);
  const itemByName = new Map(items.map((item) => [item.name, item]));
  return items.map((item) => {
    const neighbors = neighborMap.get(item.name);
    if (!neighbors || neighbors.size !== 1) {
      return item;
    }

    const neighbor = itemByName.get(Array.from(neighbors)[0]);
    if (!neighbor || Math.abs(neighbor.y - item.y) < 0.01) {
      return item;
    }

    return {
      ...item,
      x: getLeafItemX(item, neighbor, items),
    };
  });
}

/** 给叶子节点选择相对唯一邻居最直觉的位置。 */
function getLeafItemX(item: AnimeItem, neighbor: AnimeItem, items: readonly AnimeItem[]) {
  const alignedClearance = getRowClearance(item, neighbor.x, items);
  if (alignedClearance >= GRAPH_NODE_WIDTH + 2) {
    return neighbor.x;
  }

  const leafOffset = 18;
  const candidates = [clampNumber(neighbor.x - leafOffset, 8, 92), clampNumber(neighbor.x + leafOffset, 8, 92)];
  return candidates
    .map((x) => ({
      x,
      clearance: getRowClearance(item, x, items),
      centerPenalty: Math.abs(x - 50) * 0.01,
    }))
    .toSorted((left, right) => {
      if (right.clearance !== left.clearance) {
        return right.clearance - left.clearance;
      }
      return right.centerPenalty - left.centerPenalty;
    })[0].x;
}

/** 计算候选横坐标与同一行其它节点的最近距离。 */
function getRowClearance(item: AnimeItem, x: number, items: readonly AnimeItem[]) {
  const sameRowItems = items.filter(
    (candidate) => candidate.name !== item.name && Math.abs(candidate.y - item.y) < GRAPH_NODE_HEIGHT,
  );
  if (sameRowItems.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.min(...sameRowItems.map((candidate) => Math.abs(candidate.x - x)));
}

/**
 * 排布同一行的节点。
 *
 * 若存在度数明显最高的中心节点，则让它居中，其它节点左右交错；否则按名称均匀铺开。
 */
function layoutGraphRowItems(items: readonly AnimeItem[], nodeDegrees: ReadonlyMap<string, number>, centerX: number) {
  const centerItem = findGraphRowCenterItem(items, nodeDegrees);
  const rowStep = Math.min(27, 81 / Math.max(items.length, 1));

  if (!centerItem) {
    const sortedItems = sortGraphItemsByName(items);
    return sortedItems.map((item, rowIndex) => ({
      ...item,
      x: clampNumber(centerX + (rowIndex - (sortedItems.length - 1) / 2) * rowStep, 8, 92),
    }));
  }

  const sideItems = sortGraphItemsByName(items.filter((item) => item.name !== centerItem.name));
  return [
    {
      ...centerItem,
      x: centerX,
    },
    ...sideItems.map((item, sideIndex) => {
      const distance = Math.floor(sideIndex / 2) + 1;
      const direction = sideIndex % 2 === 0 ? -1 : 1;
      return {
        ...item,
        x: clampNumber(centerX + direction * distance * rowStep, 8, 92),
      };
    }),
  ];
}

/**
 * 查找同一行中是否存在适合作为中心的节点。
 *
 * 只有第一名度数严格高于第二名时才返回，避免无依据地偏置同层节点。
 */
function findGraphRowCenterItem(items: readonly AnimeItem[], nodeDegrees: ReadonlyMap<string, number>) {
  if (items.length < 2) {
    return undefined;
  }

  const rankedItems = items.toSorted((left, right) => {
    const degreeDelta = (nodeDegrees.get(right.name) ?? 0) - (nodeDegrees.get(left.name) ?? 0);
    if (degreeDelta !== 0) {
      return degreeDelta;
    }
    return left.name.localeCompare(right.name, "zh-Hans-CN");
  });
  const centerItem = rankedItems.at(0);
  const centerDegree = centerItem ? (nodeDegrees.get(centerItem.name) ?? 0) : 0;
  const nextDegree = rankedItems.at(1) ? (nodeDegrees.get(rankedItems[1].name) ?? 0) : 0;
  return centerItem && centerDegree > nextDegree ? centerItem : undefined;
}

/** 统计每个节点参与的关系数量。 */
function getGraphNodeDegrees(records: readonly RelationRecord[]) {
  const degrees = new Map<string, number>();
  for (const record of records) {
    degrees.set(record.baseName, (degrees.get(record.baseName) ?? 0) + 1);
    degrees.set(record.targetName, (degrees.get(record.targetName) ?? 0) + 1);
  }
  return degrees;
}

/** 收集每个节点直接相连的邻居名称。 */
function getGraphNeighborNames(records: readonly RelationRecord[]) {
  const neighbors = new Map<string, Set<string>>();
  for (const record of records) {
    neighbors.set(record.baseName, (neighbors.get(record.baseName) ?? new Set()).add(record.targetName));
    neighbors.set(record.targetName, (neighbors.get(record.targetName) ?? new Set()).add(record.baseName));
  }
  return neighbors;
}

/** 用并查集计算每个节点所在的连通分量。 */
function getGraphComponentIds(items: readonly AnimeItem[], records: readonly RelationRecord[]) {
  const names = new Set(items.map((item) => item.name));
  const parents = new Map(Array.from(names, (name) => [name, name]));

  const find = (name: string): string => {
    const parent = parents.get(name) ?? name;
    if (parent === name) {
      return parent;
    }
    const root = find(parent);
    parents.set(name, root);
    return root;
  };

  const unite = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parents.set(rightRoot, leftRoot);
    }
  };

  for (const record of records) {
    if (names.has(record.baseName) && names.has(record.targetName)) {
      unite(record.baseName, record.targetName);
    }
  }

  const roots = Array.from(new Set(Array.from(names, (name) => find(name)))).sort((left, right) =>
    left.localeCompare(right, "zh-Hans-CN"),
  );
  const rootIds = new Map(roots.map((root, index) => [root, index + 1]));
  return new Map(Array.from(names, (name) => [name, rootIds.get(find(name)) ?? 0]));
}

/** 计算连通分量的横向中心点。 */
function getGraphComponentCenter(index: number, count: number) {
  if (count <= 1) {
    return 50;
  }
  const minX = 8;
  const maxX = 92;
  return minX + (index / (count - 1)) * (maxX - minX);
}

/** 获取一组节点按名称排序后的第一个名称。 */
function getFirstGraphItemName(items: readonly AnimeItem[]) {
  return sortGraphItemsByName(items).at(0)?.name ?? "";
}

/** 按中文环境名称排序节点。 */
function sortGraphItemsByName(items: readonly AnimeItem[]) {
  return items.toSorted((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}

/**
 * 对重叠节点做横向推开。
 *
 * 只调整 x，不调整 y，避免破坏“上高下低”的相对分数语义。
 */
function avoidGraphItemOverlap(items: readonly AnimeItem[]) {
  const relaxedItems = items.map((item) => ({ ...item }));
  for (let iteration = 0; iteration < 30; iteration += 1) {
    for (let leftIndex = 0; leftIndex < relaxedItems.length; leftIndex += 1) {
      const left = relaxedItems[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < relaxedItems.length; rightIndex += 1) {
        const right = relaxedItems[rightIndex];
        const deltaX = right.x - left.x;
        const deltaY = right.y - left.y;
        const overlapX = GRAPH_NODE_WIDTH - Math.abs(deltaX);
        const overlapY = GRAPH_NODE_HEIGHT - Math.abs(deltaY);
        if (overlapX <= 0 || overlapY <= 0) {
          continue;
        }

        const pushX = (overlapX / 2 + 0.35) * (deltaX >= 0 ? 1 : -1);
        left.x = clampNumber(left.x - pushX, 8, 92);
        right.x = clampNumber(right.x + pushX, 8, 92);
      }
    }
  }
  return relaxedItems;
}

/** 在节点列表中查找有效的评分锚点。 */
function findAnchor(items: readonly AnimeItem[], anchor: ScoreAnchor | undefined) {
  if (!anchor || !Number.isFinite(anchor.score)) {
    return undefined;
  }
  const item = items.find((candidate) => candidate.name === anchor.name);
  return item ? { item, score: anchor.score } : undefined;
}
