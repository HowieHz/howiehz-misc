/**
 * 用户可录入的相对关系等级。
 *
 * 正向等级表示 `baseName` 高于 `targetName`，负向等级表示反过来，“same”表示相近。
 */
export type RelationLevel = "much-better" | "quite-better" | "better" | "same" | "worse" | "quite-worse" | "much-worse";

/** 评分锚点角色。 */
export type AnchorRole = "best" | "worst";

/** 关系图中的作品节点。 */
export interface CompareItem {
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

/** 用于把相对位置映射到绝对分的相对最佳/相对最差评分锚点。 */
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

// 节点 CSS 尺寸也是 13% x 7%，这里用同一比例做碰撞和边端点裁剪。
const GRAPH_NODE_WIDTH = 13;
const GRAPH_NODE_HEIGHT = 7;
const GRAPH_EDGE_NODE_HALF_WIDTH = GRAPH_NODE_WIDTH / 2;
const GRAPH_EDGE_NODE_HALF_HEIGHT = GRAPH_NODE_HEIGHT / 2;
// 横向距离小于约一个节点宽时，近垂直边优先从同侧绕出。
const GRAPH_VERTICAL_EDGE_ROUTE_WIDTH = GRAPH_NODE_WIDTH * 1.25;
// 横向距离小于半个多节点宽时，两端走同侧，避免左右侧切换产生 S 形硬弯。
const GRAPH_SAME_SIDE_EDGE_ROUTE_WIDTH = GRAPH_NODE_WIDTH * 0.75;
// 侧边端口额外留出的横向绘图空隙，单位是 SVG 百分比坐标。
const GRAPH_SIDE_EDGE_REPULSION_GAP = 4;
// 节点纵向使用 8%-92% 的主区域，给边框和“高/低”角标留出上下边距。
const GRAPH_VERTICAL_SPREAD = 84;
// 少量节点时的基础图高度；再小会挤压节点内两行文字。
const GRAPH_VIEWPORT_BASE_HEIGHT = 380;
// 每增加 1 个相对位置跨度，视口增加的像素高度。
const GRAPH_VIEWPORT_OFFSET_HEIGHT = 48;
// 限制关系图面板高度，避免极端输入把页面撑得过长。
const GRAPH_VIEWPORT_MAX_HEIGHT = 620;
// 绝对评分扩展输出的默认范围；相对位置求解本身不依赖这个范围。
const SCORE_MIN = 1;
const SCORE_MAX = 10;
// 迭代次数给约束松弛足够收敛空间；图规模很小，2000 次仍然很轻。
const OFFSET_SOLVER_ITERATIONS = 2000;
// 下限未满足时的主推力，偏大一点让明显违反关系能快速拉开。
const OFFSET_SOLVER_STEP = 0.18;
// 下限满足后的弱回拉，只收掉多余空隙，不压坏链条推出的必要差距。
const OFFSET_SOLVER_SLACK_STEP = 0.005;
// 同源同档目标的对齐力，弱于主推力，避免覆盖其它关系。
const OFFSET_SOLVER_SIBLING_STEP = 0.08;
// 收敛容差；小于展示精度很多，避免可见抖动。
const OFFSET_SOLVER_EPSILON = 1e-5;

/**
 * 标准化作品名或表单文本，去掉首尾空白并把连续空白折叠成单个空格。
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
 * `A-B` 与 `B-A` 会得到同一个 key，用于禁止同一对作品录入多条矛盾或重复关系。
 *
 * @param left - 关系一侧的作品名。
 * @param right - 关系另一侧的作品名。
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
 * 先用关系 delta 求出每个作品的相对位置，再把相对位置映射到纵向坐标，并按连通分量与同层节点做横向排布。
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
  return avoidGraphItemOverlap(layoutLeafItemsWithNeighbors(layoutGraphItems(items, records), records), records);
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
  items: readonly CompareItem[],
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
        buildGraphEdge(edgeDraft, getParallelEdgeOffset(edgeIndex, edgeGroup.length), items, records),
      ),
  );
}

/**
 * 把相对位置映射成绝对分。
 *
 * 若同时存在相对最佳和相对最差锚点，会使用二者建立线性映射；若只有一个锚点，则按相对位置差值平移。
 *
 * @param items - 已计算相对位置的节点。
 * @param anchors - 用户给出的相对最佳/相对最差评分锚点。
 * @returns 以作品名索引的分数表，未能映射时值为 `undefined`。
 */
export function mapScores(items: readonly CompareItem[], anchors: ScoreAnchors) {
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
 * 从分数表中读取指定作品的映射分数。
 *
 * @param name - 作品名。
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
 * 把评分限制在工具允许的绝对评分范围内。
 *
 * @param value - 原始评分。
 * @returns 限制后的评分。
 */
export function clampScore(value: number) {
  return Math.min(Math.max(value, SCORE_MIN), SCORE_MAX);
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
export function getGraphViewportHeight(items: readonly CompareItem[]) {
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
 * 用一维约束松弛求解每个作品的相对位置。
 *
 * “差不多”是等式吸引；其它关系先保证下限，满足后再用很弱的力贴近标称差距。 同一节点下同档关系的目标会轻微对齐，避免两个“好一点”被解成明显不同高度。 每个连通分量单独归零均值，避免整体平移影响展示。
 */
function solveOffsets(records: readonly RelationRecord[]) {
  const names = Array.from(new Set(records.flatMap((record) => [record.baseName, record.targetName])));
  const offsets = new Map(names.map((name) => [name, 0]));
  const activeRecords = records.filter((record) => getRecordWeight(record) > 0);
  for (const componentNames of getOffsetComponents(names, activeRecords)) {
    const componentOffsets = solveOffsetComponent(componentNames, activeRecords);
    for (const [name, offset] of componentOffsets) {
      offsets.set(name, Math.abs(offset) < 1e-10 ? 0 : offset);
    }
  }
  return offsets;
}

/** 读取关系权重；无效或负数权重按 0 处理。 */
function getRecordWeight(record: RelationRecord) {
  const weight = record.weight ?? 1;
  return Number.isFinite(weight) ? Math.max(weight, 0) : 0;
}

/** 按有效关系划分求解用连通分量；权重为 0 的关系不影响相对位置。 */
function getOffsetComponents(names: readonly string[], records: readonly RelationRecord[]) {
  const neighbors = new Map(names.map((name) => [name, new Set<string>()]));
  for (const record of records) {
    neighbors.get(record.baseName)?.add(record.targetName);
    neighbors.get(record.targetName)?.add(record.baseName);
  }

  const components: string[][] = [];
  const visited = new Set<string>();
  for (const name of names) {
    if (visited.has(name)) {
      continue;
    }

    const component: string[] = [];
    const queue = [name];
    visited.add(name);
    let index = 0;
    while (index < queue.length) {
      const current = queue[index];
      component.push(current);
      for (const neighbor of neighbors.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
      index += 1;
    }
    components.push(component);
  }
  return components;
}

/** 为单个连通分量解出满足关系下限的相对位置。 */
function solveOffsetComponent(names: readonly string[], records: readonly RelationRecord[]) {
  const result = new Map(names.map((name) => [name, 0]));
  if (names.length <= 1) {
    return result;
  }

  const nameSet = new Set(names);
  const componentRecords = records.filter((record) => nameSet.has(record.baseName) && nameSet.has(record.targetName));
  const siblingGroups = getOffsetSiblingGroups(componentRecords);
  const values = new Map(names.map((name) => [name, 0]));

  for (let iteration = 0; iteration < OFFSET_SOLVER_ITERATIONS; iteration += 1) {
    let maxError = 0;
    for (const record of componentRecords) {
      const baseValue = values.get(record.baseName) ?? 0;
      const targetValue = values.get(record.targetName) ?? 0;
      const currentGap = baseValue - targetValue;
      const error = getOffsetConstraintError(currentGap, record.delta);
      if (Math.abs(error) <= OFFSET_SOLVER_EPSILON) {
        continue;
      }

      const step = isOffsetConstraintViolated(currentGap, record.delta) ? OFFSET_SOLVER_STEP : OFFSET_SOLVER_SLACK_STEP;
      const push = error * Math.min(getRecordWeight(record), 10) * step;
      values.set(record.baseName, baseValue + push / 2);
      values.set(record.targetName, targetValue - push / 2);
      maxError = Math.max(maxError, Math.abs(error));
    }

    applyOffsetSiblingAlignment(values, siblingGroups);
    centerOffsetValues(values);
    if (maxError <= OFFSET_SOLVER_EPSILON) {
      break;
    }
  }

  for (const name of names) {
    result.set(name, values.get(name) ?? 0);
  }
  return result;
}

/** 收集同一个高分节点下、同一差值档位的目标节点。 */
function getOffsetSiblingGroups(records: readonly RelationRecord[]) {
  const groups = new Map<string, string[]>();
  for (const record of records) {
    if (record.delta === 0) {
      continue;
    }

    const parentName = record.delta > 0 ? record.baseName : record.targetName;
    const childName = record.delta > 0 ? record.targetName : record.baseName;
    const key = `${parentName}\u0000${Math.abs(record.delta)}`;
    groups.set(key, [...(groups.get(key) ?? []), childName]);
  }

  return Array.from(groups.values())
    .map((group) => Array.from(new Set(group)))
    .filter((group) => group.length > 1);
}

/** 同源同档目标轻微对齐，保留其它关系造成的必要差异。 */
function applyOffsetSiblingAlignment(values: Map<string, number>, groups: readonly (readonly string[])[]) {
  for (const group of groups) {
    const average = group.reduce((total, name) => total + (values.get(name) ?? 0), 0) / group.length;
    for (const name of group) {
      const value = values.get(name) ?? 0;
      values.set(name, value + (average - value) * OFFSET_SOLVER_SIBLING_STEP);
    }
  }
}

/** 计算一条关系当前还差多少；正数表示需要拉大，负数表示需要拉近。 */
function getOffsetConstraintError(currentGap: number, targetGap: number) {
  if (targetGap === 0) {
    return -currentGap;
  }
  return targetGap - currentGap;
}

/** 判断方向关系是否还没有满足下限。 */
function isOffsetConstraintViolated(currentGap: number, targetGap: number) {
  if (targetGap === 0) {
    return true;
  }
  return targetGap > 0 ? currentGap < targetGap : currentGap > targetGap;
}

/** 把连通分量的相对位置均值归零。 */
function centerOffsetValues(values: Map<string, number>) {
  const mean = Array.from(values.values()).reduce((total, value) => total + value, 0) / values.size;
  for (const [name, value] of values) {
    values.set(name, value - mean);
  }
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
function buildGraphEdge(
  edgeDraft: GraphEdgeDraft,
  curveOffset: number,
  items: readonly CompareItem[],
  records: readonly RelationRecord[],
): GraphEdge {
  const effectiveCurveOffset = getEffectiveCurveOffset(edgeDraft, curveOffset, items, records);
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
function getEffectiveCurveOffset(
  edgeDraft: GraphEdgeDraft,
  curveOffset: number,
  items: readonly CompareItem[],
  records: readonly RelationRecord[],
) {
  if (curveOffset !== 0) {
    return curveOffset;
  }
  if (Math.abs(edgeDraft.fromY - edgeDraft.toY) < 1) {
    // 同高顶部连线只需要轻微拱起，4% 足够看出曲线又不抢节点空间。
    return 4;
  }
  if (Math.abs(edgeDraft.fromX - edgeDraft.toX) < GRAPH_VERTICAL_EDGE_ROUTE_WIDTH) {
    // 近垂直线绕到左右侧时需要比普通曲线更明显，7% 大约是半个节点宽。
    return getVerticalEdgeSide(edgeDraft, items, records) * 7;
  }
  // 普通斜线给 3% 默认弯曲，避免大量直线显得生硬。
  return 3;
}

/**
 * 给近垂直边选择更空的一侧。
 *
 * 近垂直边固定走右侧会和右侧节点挤在一起；这里比较左右走廊的节点占用，选择更宽松的方向。
 */
function getVerticalEdgeSide(
  edgeDraft: GraphEdgeDraft,
  items: readonly CompareItem[],
  records: readonly RelationRecord[],
) {
  const leftScore = getVerticalEdgeSideClearance(edgeDraft, items, records, -1);
  const rightScore = getVerticalEdgeSideClearance(edgeDraft, items, records, 1);
  if (leftScore !== rightScore) {
    return leftScore > rightScore ? -1 : 1;
  }
  return edgeDraft.toX >= edgeDraft.fromX ? 1 : -1;
}

/** 计算近垂直边某一侧走廊的空旷程度，数值越大越宽松。 */
function getVerticalEdgeSideClearance(
  edgeDraft: GraphEdgeDraft,
  items: readonly CompareItem[],
  records: readonly RelationRecord[],
  side: -1 | 1,
) {
  // 走廊放在节点边缘外约 7%，用来估算这侧是否会撞到其它节点。
  const corridorX = (edgeDraft.fromX + edgeDraft.toX) / 2 + side * (GRAPH_EDGE_NODE_HALF_WIDTH + 7);
  const minY = Math.min(edgeDraft.fromY, edgeDraft.toY) - GRAPH_NODE_HEIGHT;
  const maxY = Math.max(edgeDraft.fromY, edgeDraft.toY) + GRAPH_NODE_HEIGHT;
  const blockingItems = items.filter(
    (item) => item.name !== edgeDraft.fromName && item.name !== edgeDraft.toName && item.y >= minY && item.y <= maxY,
  );
  const clearance =
    blockingItems.length === 0 ? 100 : Math.min(...blockingItems.map((item) => Math.abs(item.x - corridorX)));
  return clearance - getEndpointSideUsagePenalty(edgeDraft, items, records, side);
}

/** 近垂直边避开端点这一侧已有的关系边，减少多条线挤在同一侧。 */
function getEndpointSideUsagePenalty(
  edgeDraft: GraphEdgeDraft,
  items: readonly CompareItem[],
  records: readonly RelationRecord[],
  side: -1 | 1,
) {
  const itemByName = new Map(items.map((item) => [item.name, item]));
  const endpoints = [
    { name: edgeDraft.fromName, x: edgeDraft.fromX, y: edgeDraft.fromY },
    { name: edgeDraft.toName, x: edgeDraft.toX, y: edgeDraft.toY },
  ];
  let penalty = 0;

  for (const endpoint of endpoints) {
    for (const record of records) {
      if (record.id === edgeDraft.id) {
        continue;
      }
      if (record.baseName !== endpoint.name && record.targetName !== endpoint.name) {
        continue;
      }

      const neighborName = getRelationNeighborName(record, endpoint.name);
      const neighbor = itemByName.get(neighborName);
      if (!neighbor) {
        continue;
      }
      if (Math.abs(neighbor.y - endpoint.y) <= GRAPH_EDGE_NODE_HALF_HEIGHT) {
        continue;
      }

      const neighborSide = Math.sign(neighbor.x - endpoint.x);
      if (neighborSide === side) {
        // 已有端口占用比普通节点遮挡更该避开，所以给一个足以翻转左右选择的惩罚。
        penalty += 40;
      }
    }
  }

  return penalty;
}

/** 计算近同高边的顶部二次贝塞尔控制点。 */
function getTopSideEdgeControl(endpoints: GraphEdgeEndpoints, curveOffset: number) {
  // 顶部线最少抬 5%，否则短边几乎看不出弧度。
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

  // 水平手柄约占横距 42%，但最多 9%，防止远距离边过度外扩。
  const horizontalHandle = Math.max(absCurveOffset, Math.min(Math.abs(deltaX) * 0.42, 9));
  // 垂直手柄随高度差增长，至少 1.2% 才不会退化成折线感。
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
  // 平行边每层错开 5%，足够区分，又不会绕出节点区域太远。
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

  // 24 个角度桶约等于每 7.5 度一档，用来合并视觉上近似共线的边。
  const angleBucket = Math.round(Math.atan2(unitY, unitX) / (Math.PI / 24));
  // 法向偏移每 3% 一档，避免几乎同线的边被分散到不同组。
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

  if (Math.abs(deltaX) < GRAPH_SAME_SIDE_EDGE_ROUTE_WIDTH) {
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
function layoutGraphItems(items: readonly CompareItem[], records: readonly RelationRecord[]) {
  const componentIds = getGraphComponentIds(items, records);
  const nodeDegrees = getGraphNodeDegrees(records);
  const componentGroups = new Map<number, CompareItem[]>();
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

  const laidOutItems = components.flatMap((component, componentIndex) => {
    const centerX = getGraphComponentCenter(componentIndex, components.length);
    const rows = new Map<string, CompareItem[]>();
    for (const item of component) {
      const rowKey = item.y.toFixed(2);
      rows.set(rowKey, [...(rows.get(rowKey) ?? []), item]);
    }

    return Array.from(rows.values()).flatMap((rowItems) => layoutGraphRowItems(rowItems, nodeDegrees, centerX));
  });

  return optimizeGraphRowOrder(laidOutItems, records, nodeDegrees).sort((left, right) => left.id - right.id);
}

/**
 * 在同一高度内交换横向位置，尽量让同层连线更短、跨层连线少交叉。
 *
 * 这里只复用已经算好的横向槽位，不改变节点高度，也不改变整体宽松度。
 */
function optimizeGraphRowOrder(
  items: readonly CompareItem[],
  records: readonly RelationRecord[],
  nodeDegrees: ReadonlyMap<string, number>,
) {
  const itemByName = new Map(items.map((item) => [item.name, { ...item }]));
  const rowGroups = new Map<string, CompareItem[]>();
  for (const item of itemByName.values()) {
    const rowKey = item.y.toFixed(2);
    rowGroups.set(rowKey, [...(rowGroups.get(rowKey) ?? []), item]);
  }

  for (let iteration = 0; iteration < 2; iteration += 1) {
    for (const rowItems of rowGroups.values()) {
      if (rowItems.length === 1) {
        const item = itemByName.get(rowItems[0].name) ?? rowItems[0];
        itemByName.set(item.name, getOptimizedSingleGraphRowItem(item, records, itemByName));
        continue;
      }
      if (rowItems.length < 3) {
        continue;
      }

      const currentRow = rowItems.map((item) => itemByName.get(item.name) ?? item);
      const optimizedRow = getOptimizedGraphRow(currentRow, records, nodeDegrees, itemByName);
      for (const item of optimizedRow) {
        itemByName.set(item.name, item);
      }
    }
  }

  return items.map((item) => itemByName.get(item.name) ?? item);
}

/** 单节点层也尝试横向换位，避免无关的近层节点挤在同一条通道里。 */
function getOptimizedSingleGraphRowItem(
  item: CompareItem,
  records: readonly RelationRecord[],
  itemByName: ReadonlyMap<string, CompareItem>,
) {
  const candidates = getSingleRowItemCandidateXs(item, records, itemByName);
  return candidates
    .map((x) => ({ item: { ...item, x }, score: getSingleGraphRowItemScore({ ...item, x }, records, itemByName) }))
    .toSorted((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }
      return Math.abs(left.item.x - item.x) - Math.abs(right.item.x - item.x);
    })[0].item;
}

/** 给单节点层生成少量直觉候选位置：当前点、邻居附近、已有列附近。 */
function getSingleRowItemCandidateXs(
  item: CompareItem,
  records: readonly RelationRecord[],
  itemByName: ReadonlyMap<string, CompareItem>,
) {
  const candidates = new Set([item.x, 50]);
  const neighborXs: number[] = [];
  for (const record of records) {
    const neighborName = getRelationNeighborName(record, item.name);
    const neighbor = itemByName.get(neighborName);
    if (!neighbor) {
      continue;
    }
    neighborXs.push(neighbor.x);
    candidates.add(neighbor.x);
  }
  if (neighborXs.length > 0) {
    candidates.add(neighborXs.reduce((total, x) => total + x, 0) / neighborXs.length);
  }

  return Array.from(candidates, (x) => clampNumber(x, 8, 92));
}

/** 获取关系中与指定节点相连的另一端；不在关系内则返回空字符串。 */
function getRelationNeighborName(record: RelationRecord, name: string) {
  if (record.baseName === name) {
    return record.targetName;
  }
  if (record.targetName === name) {
    return record.baseName;
  }
  return "";
}

/** 单节点层的横向评分：连线别太长，也要远离没有直接关系的近层节点。 */
function getSingleGraphRowItemScore(
  item: CompareItem,
  records: readonly RelationRecord[],
  itemByName: ReadonlyMap<string, CompareItem>,
) {
  let directRelationScore = 0;
  for (const record of records) {
    const neighborName = getRelationNeighborName(record, item.name);
    const neighbor = itemByName.get(neighborName);
    if (neighbor) {
      directRelationScore += Math.abs(neighbor.x - item.x);
      directRelationScore += getSideEdgeRepulsionScore(item, neighbor);
    }
  }

  let proximityPenalty = 0;
  for (const other of itemByName.values()) {
    if (other.name === item.name || hasDirectRelation(item.name, other.name, records)) {
      continue;
    }

    const verticalGap = Math.abs(other.y - item.y);
    // 只惩罚相邻几层的无关节点；超过三倍节点高度基本不会视觉互挡。
    if (verticalGap > GRAPH_NODE_HEIGHT * 3) {
      continue;
    }

    const horizontalGap = Math.abs(other.x - item.x);
    // 两个多节点宽以内开始算拥挤，垂直越近惩罚越强。
    proximityPenalty +=
      Math.max(0, GRAPH_NODE_WIDTH * 2.2 - horizontalGap) * (1 - verticalGap / (GRAPH_NODE_HEIGHT * 3));
  }
  // 无关近邻只是次要避让，权重压到 0.35 防止压过直接连线长度。
  return directRelationScore + proximityPenalty * 0.35;
}

/** 侧边出入需要留出绘图空隙，避免边从两张卡片之间的窄缝硬挤过去。 */
function getSideEdgeRepulsionScore(item: CompareItem, neighbor: CompareItem) {
  if (Math.abs(item.y - neighbor.y) <= GRAPH_EDGE_NODE_HALF_HEIGHT) {
    return 0;
  }

  const horizontalGap = Math.abs(item.x - neighbor.x);
  if (horizontalGap <= GRAPH_SAME_SIDE_EDGE_ROUTE_WIDTH) {
    return 0;
  }

  const sideEdgeGap = horizontalGap - GRAPH_NODE_WIDTH;
  // 侧边线留白不足时给候选位置加重罚，避免边贴着卡片挤过去。
  return Math.max(0, GRAPH_SIDE_EDGE_REPULSION_GAP - sideEdgeGap) * 8;
}

/** 穷举小行的槽位交换方案，选择线条代价最低的排布。 */
function getOptimizedGraphRow(
  rowItems: readonly CompareItem[],
  records: readonly RelationRecord[],
  nodeDegrees: ReadonlyMap<string, number>,
  itemByName: ReadonlyMap<string, CompareItem>,
) {
  const lockedItem = findGraphRowCenterItem(rowItems, nodeDegrees);
  const slots = rowItems.toSorted((left, right) => left.x - right.x).map((item) => item.x);
  const lockedSlot = lockedItem
    ? slots.reduce(
        (best, slot) => (Math.abs(slot - lockedItem.x) < Math.abs(best - lockedItem.x) ? slot : best),
        slots[0],
      )
    : undefined;
  const freeSlots = lockedSlot === undefined ? slots : slots.filter((slot) => slot !== lockedSlot);
  const freeItems = lockedItem ? rowItems.filter((item) => item.name !== lockedItem.name) : [...rowItems];

  let bestRow = rowItems.map((item) => ({ ...item }));
  let bestScore = getGraphRowOrderScore(bestRow, records, itemByName);
  if (rowItems.length <= 7) {
    for (const permutation of getPermutations(freeItems)) {
      const candidate = permutation.map((item, index) => ({ ...item, x: freeSlots[index] }));
      if (lockedItem && lockedSlot !== undefined) {
        candidate.push({ ...lockedItem, x: lockedSlot });
      }

      const score = getGraphRowOrderScore(candidate, records, itemByName);
      if (score < bestScore - 0.001) {
        bestScore = score;
        bestRow = candidate;
      }
    }
    return bestRow;
  }

  return optimizeGraphRowByAdjacentSwap(bestRow, lockedItem?.name, records, itemByName);
}

/** 大行只做相邻交换，避免全排列爆炸。 */
function optimizeGraphRowByAdjacentSwap(
  rowItems: readonly CompareItem[],
  lockedName: string | undefined,
  records: readonly RelationRecord[],
  itemByName: ReadonlyMap<string, CompareItem>,
) {
  const optimizedItems = rowItems.toSorted((left, right) => left.x - right.x).map((item) => ({ ...item }));
  let pass = 0;
  while (pass < optimizedItems.length) {
    let changed = false;
    for (let index = 0; index < optimizedItems.length - 1; index += 1) {
      if (optimizedItems[index].name === lockedName || optimizedItems[index + 1].name === lockedName) {
        continue;
      }

      const beforeScore = getGraphRowOrderScore(optimizedItems, records, itemByName);
      [optimizedItems[index].x, optimizedItems[index + 1].x] = [optimizedItems[index + 1].x, optimizedItems[index].x];
      const afterScore = getGraphRowOrderScore(optimizedItems, records, itemByName);
      if (afterScore < beforeScore - 0.001) {
        changed = true;
      } else {
        [optimizedItems[index].x, optimizedItems[index + 1].x] = [optimizedItems[index + 1].x, optimizedItems[index].x];
      }
    }
    if (!changed) {
      break;
    }
    pass += 1;
  }

  return optimizedItems;
}

/** 计算同一行排布的线条代价，数值越小表示越少交叉、越少绕线。 */
function getGraphRowOrderScore(
  rowItems: readonly CompareItem[],
  records: readonly RelationRecord[],
  itemByName: ReadonlyMap<string, CompareItem>,
) {
  const rowItemByName = new Map(rowItems.map((item) => [item.name, item]));
  const rowNames = new Set(rowItemByName.keys());
  const externalEdges: { fromX: number; toX: number; side: number }[] = [];
  let score = 0;

  for (const record of records) {
    const baseItem = rowItemByName.get(record.baseName) ?? itemByName.get(record.baseName);
    const targetItem = rowItemByName.get(record.targetName) ?? itemByName.get(record.targetName);
    if (!baseItem || !targetItem) {
      continue;
    }

    const baseInRow = rowNames.has(record.baseName);
    const targetInRow = rowNames.has(record.targetName);
    if (baseInRow && targetInRow) {
      score += Math.abs(baseItem.x - targetItem.x) * (record.delta === 0 ? 2 : 1);
      continue;
    }

    if (baseInRow !== targetInRow) {
      const rowItem = baseInRow ? baseItem : targetItem;
      const outsideItem = baseInRow ? targetItem : baseItem;
      score += Math.abs(rowItem.x - outsideItem.x) * 0.08;
      externalEdges.push({
        fromX: rowItem.x,
        toX: outsideItem.x,
        side: Math.sign(outsideItem.y - rowItem.y),
      });
    }
  }

  for (let leftIndex = 0; leftIndex < externalEdges.length; leftIndex += 1) {
    const left = externalEdges[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < externalEdges.length; rightIndex += 1) {
      const right = externalEdges[rightIndex];
      if (left.side !== right.side || left.side === 0) {
        continue;
      }
      if ((left.fromX - right.fromX) * (left.toX - right.toX) < 0) {
        score += 20;
      }
    }
  }

  return score;
}

/** 生成小数组的全排列；调用方只用于 7 个以内的同层节点。 */
function getPermutations<T>(items: readonly T[]) {
  const permutations: T[][] = [];
  const used = Array(items.length).fill(false);
  const current: T[] = [];

  const visit = () => {
    if (current.length === items.length) {
      permutations.push([...current]);
      return;
    }

    for (let index = 0; index < items.length; index += 1) {
      if (used[index]) {
        continue;
      }
      used[index] = true;
      current.push(items[index]);
      visit();
      current.pop();
      used[index] = false;
    }
  };

  visit();
  return permutations;
}

/**
 * 把单连接叶子节点贴近唯一邻居。
 *
 * 叶子节点通常不应该占据主干中线；优先与唯一邻居上下对齐，有同层冲突时再挂到邻居左右侧。
 */
function layoutLeafItemsWithNeighbors(items: readonly CompareItem[], records: readonly RelationRecord[]) {
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
function getLeafItemX(item: CompareItem, neighbor: CompareItem, items: readonly CompareItem[]) {
  const alignedClearance = getRowClearance(item, neighbor.x, items);
  // 同列至少留出一个节点宽再加 2% 呼吸空间，叶子才直接挂在邻居正上/下。
  if (alignedClearance >= GRAPH_NODE_WIDTH + 2) {
    return neighbor.x;
  }

  // 同列不够时左右挂 18%，约一个半节点宽，通常能避开邻居列。
  const leafOffset = 18;
  const candidates = [clampNumber(neighbor.x - leafOffset, 8, 92), clampNumber(neighbor.x + leafOffset, 8, 92)];
  return candidates
    .map((x) => ({
      x,
      clearance: getRowClearance(item, x, items),
      // 两侧都可用时略偏离中心，让主干区域优先留给高连接度节点。
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
function getRowClearance(item: CompareItem, x: number, items: readonly CompareItem[]) {
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
function layoutGraphRowItems(items: readonly CompareItem[], nodeDegrees: ReadonlyMap<string, number>, centerX: number) {
  const centerItem = findGraphRowCenterItem(items, nodeDegrees);
  // 同层最多每 27% 放一个节点；节点多时压到 81% 可用宽度内。
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
function findGraphRowCenterItem(items: readonly CompareItem[], nodeDegrees: ReadonlyMap<string, number>) {
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

/** 判断两个节点之间是否存在直接关系。 */
function hasDirectRelation(left: string, right: string, records: readonly RelationRecord[]) {
  const pairKey = createRelationPairKey(left, right);
  return (
    pairKey !== undefined &&
    records.some((record) => createRelationPairKey(record.baseName, record.targetName) === pairKey)
  );
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
function getGraphComponentIds(items: readonly CompareItem[], records: readonly RelationRecord[]) {
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
  // 两三个独立分量先靠近中心；分量很多时再逐步用满横向空间。
  const componentStep = Math.min(28, 84 / (count - 1));
  return clampNumber(50 + (index - (count - 1) / 2) * componentStep, 8, 92);
}

/** 获取一组节点按名称排序后的第一个名称。 */
function getFirstGraphItemName(items: readonly CompareItem[]) {
  return sortGraphItemsByName(items).at(0)?.name ?? "";
}

/** 按中文环境名称排序节点。 */
function sortGraphItemsByName(items: readonly CompareItem[]) {
  return items.toSorted((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}

/**
 * 对重叠节点做推开。
 *
 * 只调整 x，避免破坏“相对位置相同则同高”的图形语义。
 */
function avoidGraphItemOverlap(items: readonly CompareItem[], records: readonly RelationRecord[]) {
  const relaxedItems = items.map((item) => ({ ...item }));
  const relationPairKeys = new Set(
    records.flatMap((record) => {
      const pairKey = createRelationPairKey(record.baseName, record.targetName);
      return pairKey === undefined ? [] : [pairKey];
    }),
  );
  // 30 轮足够把小图里的重叠逐步推开，继续增加收益很低。
  for (let iteration = 0; iteration < 30; iteration += 1) {
    const sidePortSides = getGraphSidePortSides(relaxedItems, records);
    for (let leftIndex = 0; leftIndex < relaxedItems.length; leftIndex += 1) {
      const left = relaxedItems[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < relaxedItems.length; rightIndex += 1) {
        const right = relaxedItems[rightIndex];
        applySideEdgeRepulsion(left, right, relationPairKeys);
        applySidePortRepulsion(left, right, sidePortSides);

        const deltaX = right.x - left.x;
        const deltaY = right.y - left.y;
        const overlapX = GRAPH_NODE_WIDTH - Math.abs(deltaX);
        const overlapY = GRAPH_NODE_HEIGHT - Math.abs(deltaY);
        if (overlapX <= 0 || overlapY <= 0) {
          continue;
        }

        // 每侧推开一半重叠，再加 0.35% 防止刚好贴边。
        const pushX = (overlapX / 2 + 0.35) * (deltaX >= 0 ? 1 : -1);
        left.x = clampNumber(left.x - pushX, 8, 92);
        right.x = clampNumber(right.x + pushX, 8, 92);
      }
    }
  }
  return relaxedItems;
}

/** 收集每个节点当前正在使用的左右侧出入口。 */
function getGraphSidePortSides(items: readonly CompareItem[], records: readonly RelationRecord[]) {
  const itemByName = new Map(items.map((item) => [item.name, item]));
  const portSides = new Map<string, Set<-1 | 1>>();
  const addPort = (name: string, side: -1 | 1) => {
    portSides.set(name, (portSides.get(name) ?? new Set()).add(side));
  };

  for (const record of records) {
    const baseItem = itemByName.get(record.baseName);
    const targetItem = itemByName.get(record.targetName);
    if (!baseItem || !targetItem || Math.abs(baseItem.y - targetItem.y) <= GRAPH_EDGE_NODE_HALF_HEIGHT) {
      continue;
    }

    const deltaX = targetItem.x - baseItem.x;
    if (Math.abs(deltaX) < GRAPH_SAME_SIDE_EDGE_ROUTE_WIDTH) {
      continue;
    }

    const fromSide = (deltaX >= 0 ? 1 : -1) as -1 | 1;
    addPort(baseItem.name, fromSide);
    addPort(targetItem.name, -fromSide as -1 | 1);
  }

  return portSides;
}

/** 有侧边出入的关系要给边留空，避免两个卡片贴得太近。 */
function applySideEdgeRepulsion(left: CompareItem, right: CompareItem, relationPairKeys: ReadonlySet<string>) {
  const pairKey = createRelationPairKey(left.name, right.name);
  if (pairKey === undefined || !relationPairKeys.has(pairKey)) {
    return;
  }
  if (Math.abs(left.y - right.y) <= GRAPH_EDGE_NODE_HALF_HEIGHT) {
    return;
  }

  const deltaX = right.x - left.x;
  const horizontalGap = Math.abs(deltaX);
  const targetGap = GRAPH_NODE_WIDTH + GRAPH_SIDE_EDGE_REPULSION_GAP;
  if (horizontalGap <= GRAPH_SAME_SIDE_EDGE_ROUTE_WIDTH || horizontalGap >= targetGap) {
    return;
  }

  // 关系两端太近时各退一半，再加 0.2% 防止线贴边。
  const pushX = ((targetGap - horizontalGap) / 2 + 0.2) * (deltaX >= 0 ? 1 : -1);
  left.x = clampNumber(left.x - pushX, 8, 92);
  right.x = clampNumber(right.x + pushX, 8, 92);
}

/** 侧边端口会占用绘图通道；附近节点靠到这一侧时轻轻推开。 */
function applySidePortRepulsion(
  left: CompareItem,
  right: CompareItem,
  portSides: ReadonlyMap<string, ReadonlySet<-1 | 1>>,
) {
  for (const side of portSides.get(left.name) ?? []) {
    repelFromSidePort(left, right, side);
  }
  for (const side of portSides.get(right.name) ?? []) {
    repelFromSidePort(right, left, side);
  }
}

/** 对单个侧边端口施加水平斥力。 */
function repelFromSidePort(owner: CompareItem, other: CompareItem, side: -1 | 1) {
  const deltaX = other.x - owner.x;
  if (deltaX * side <= 0) {
    return;
  }

  const verticalGap = Math.abs(other.y - owner.y);
  // 端口斥力只影响相邻高度，1.4 倍节点高外基本不会视觉冲突。
  const verticalRange = GRAPH_NODE_HEIGHT * 1.4;
  if (verticalGap >= verticalRange) {
    return;
  }

  const horizontalGap = Math.abs(deltaX);
  const targetGap = GRAPH_NODE_WIDTH + GRAPH_SIDE_EDGE_REPULSION_GAP;
  if (horizontalGap >= targetGap) {
    return;
  }

  const falloff = 1 - verticalGap / verticalRange;
  // 端口斥力比实体碰撞弱，0.16 只做视觉疏散；主要让靠近端口的节点移动。
  const pushX = (targetGap - horizontalGap + 0.15) * falloff * 0.16;
  owner.x = clampNumber(owner.x - side * pushX * 0.35, 8, 92);
  other.x = clampNumber(other.x + side * pushX * 0.65, 8, 92);
}

/** 在节点列表中查找有效的评分锚点。 */
function findAnchor(items: readonly CompareItem[], anchor: ScoreAnchor | undefined) {
  if (!anchor || !Number.isFinite(anchor.score)) {
    return undefined;
  }
  const item = items.find((candidate) => candidate.name === anchor.name);
  return item ? { item, score: anchor.score } : undefined;
}
