# Graphwar Killer ABS 折线寻路替换计划

## 目标

将 `docs/tools/graphwar-killer` 的旧列扫描 DP 寻路替换为更适合 ABS 公式的纯折线寻路：

- 路径只能沿 Graphwar 的 x+ 方向前进。
- 转角角度不受限制。
- 主目标是最少线段/最少 ABS 控制点。
- 副目标是路径总长度更短。
- 障碍可能是圆形，也可能是不规则形状。
- 直接替换旧寻路，不保留旧列 DP fallback。
- 成功后仍使用现有 Graphwar 真实轨迹模拟验证。

## 已锁定设计

使用 **x+ 单调有向 Lazy Visibility Graph + 弱 A\***。

### 搜索空间

每个节点是 Graphwar 固定平面上的 `PlaneGridPoint` 候选点：

- 起点。
- 终点。
- 从障碍连通域像素边界轮廓提取、RDP 简化、过滤后的关键点。

每条边表示两点之间的一条直线折线段。边在扩展时按需检查，不提前构建完整图。

### 边合法条件

从 `a` 到 `b` 的边必须同时满足：

- 满足当前 Graphwar 最小 x 精度规则，等价于后续能通过 `pathFollowsGraphRule`。
- `lineHitsPlaneMask(a, b, routeMask, mirrored, boundaryExpansion) === false`。

不是简单 `b.x > a.x`。搜索阶段应复用或抽出当前 `pathAdvancesEnough` / `pathFollowsGraphRule` 的核心判断，避免生成后续一定会被页面拒绝的路径。

### 代价

使用词典序代价：

```ts
cost = {
  segments: previous.segments + 1,
  length: previous.length + distance(a, b),
};
```

比较顺序：

1. `segments` 更少。
2. `length` 更短。

### 启发式

第一版使用弱启发式，接近 Dijkstra，优先保证“最少线段”不会被错误启发式破坏：

```ts
h = {
  segments: 0,
  length: euclideanDistance(node, target),
};
```

`f = g + h` 后仍按词典序排序。

Tie-break 顺序：

1. `f.segments` 少。
2. `f.length` 小。
3. `g.length` 小。
4. `x` 更接近 `target.x`。
5. `y` 更接近 `target.y`。
6. 原始 candidate index 小。

### 直线提前返回

保留直线可见提前返回：

- 起点、终点未撞 `routeMask`/边界。
- 起点到终点满足 Graphwar 最小 x 精度规则。
- 起点到终点直线不撞 `routeMask`。

满足时直接返回 `[start, target]`。这是最少线段的最优解。

### 容差枚举

沿用现有 UI 语义：

- 从 `routeMinTolerancePlanePixels` 开始。
- 到 `routeMaxTolerancePlanePixels` 结束。
- 按 `routeStepPlanePixels` 枚举。
- 每个容差生成一个 `routeMask`。
- 新算法在当前 `routeMask` 上搜索。
- 几何路径找到后仍做真实轨迹验证。
- 验证失败则继续下一个容差。
- 全部失败则智能寻路失败。

不增加独立的“候选点外推距离”参数；安全距离统一由现有寻路最小值/最大值控制。

## 障碍候选点生成

### 连通域

先对当前 `routeMask` 做连通域，再逐个组件处理：

- 使用 8 邻接。
- 每个组件单独提轮廓、简化、过滤。
- 组件级处理有利于质心、凹凸判断和后续优化。

### 轮廓

第一版使用像素边界轮廓，不使用 blocked cell 中心轮廓。

原因：

- 更接近 mask 几何边界。
- 更适合生成可见图关键点。
- blocked cell 中心点容易被 `pointHitsPlaneMask` 过滤，或产生贴边不稳定问题。

### RDP 简化

对每个组件轮廓运行 Ramer-Douglas-Peucker 简化。

`epsilon` 使用：

```ts
epsilon = clamp(Math.abs(routeTolerance) * 0.75, 1, 6);
```

含义：

- 最小 1 px：去除像素锯齿。
- 最大 6 px：避免简化过头。
- 容差越大，轮廓简化略强。

### 边界点转候选点

RDP 得到的是边界关键点；最终候选点使用邻近 free cell 中心。

对每个关键边界点，在半径 `1..3` 内寻找可通行格点，优先级：

1. free cell。
2. 离边界点最近。
3. 更远离该组件质心。
4. 满足 x 范围约束。

常量：

```ts
const GRAPHWAR_PATHFINDING_CONTOUR_FREE_CELL_SEARCH_RADIUS = 3;
```

候选点最终必须满足：

```ts
!pointHitsPlaneMask(candidate, routeMask, mirrored, boundaryExpansion);
```

### 候选点过滤

第一版采用保守过滤：

- 共线或近共线点丢掉。
- 明确凹点丢掉。
- 明确凸点保留。
- 判断不清楚时保留。
- blocked 内部点丢掉。
- 不满足 free cell 的点丢掉。
- 明显不可能参与当前 x+ 路径的点丢掉：
  - 中间候选点应在起点和终点的 x 范围内。
  - 对后续边仍以 Graphwar 最小 x 精度规则为准。

原则：宁可多留候选点，也不要激进过滤到漏路。

### 去重和顺序

候选点按整数 `x;y` 去重。

排序保持稳定：

1. `start`
2. `target`
3. 其余候选点按 `x` 升序。
4. `x` 相同按 `y` 升序。

## Lazy A\* 扩展策略

第一版扩展当前节点时，检查所有满足 x+ 精度方向约束的候选点，不做邻域裁剪。

理由：

- 保证完整性。
- Graphwar 平面只有 770x450。
- RDP 和候选点过滤后规模应可控。
- 性能不够时再增加空间索引或 x 距离裁剪。

找不到路径时直接失败：

- 不自动加局部采样点。
- 不 fallback 旧列 DP。
- 后续如果实测漏路，再补候选点生成策略。

## 预览动画

旧动画是列扫描动画；新算法没有列，因此替换为图搜索动画。

### 显示内容

保留：

- 起点到目标的直连参考线。
- 当前 best path 蓝色闪烁折线。
- 优化阶段黄色大圈删点动画。

新增/改语义：

- 候选点：绿色小点。
- 当前扩展点：黄色小圈。
- 最近通过可见性检查的边：绿色线。

不显示：

- rejected edges。
- 扫描列。
- 安全区间。
- 列候选区间段。

### Preview 数据结构

替换 `GraphwarPathfindingPreview` 为图搜索语义：

```ts
export interface GraphwarPathfindingPreview {
  acceptedEdges: readonly [PlaneGridPoint, PlaneGridPoint][];
  bestPath: readonly PlaneGridPoint[];
  candidates: readonly PlaneGridPoint[];
  current?: PlaneGridPoint;
  mirrored: boolean;
}
```

### Preview 常量

```ts
const GRAPHWAR_PATHFINDING_PREVIEW_EDGE_LIMIT = 24;
const GRAPHWAR_PATHFINDING_PREVIEW_CANDIDATE_LIMIT = 64;
const GRAPHWAR_PATHFINDING_PREVIEW_EXPANSION_INTERVAL = 8;
```

含义：

- 只显示最近 24 条 accepted edges。
- 候选点最多显示 64 个。
- A\* 每扩展 8 个节点触发一次 preview 和 `yieldControl`。

候选点超过 64 个时：

- 起点始终显示。
- 终点始终显示。
- 其余按到当前扩展点距离排序取最近 62 个。
- 尚无 current 时，按到起点距离排序。

搜索未到终点时的 `bestPath`：

- 使用 open set 当前 `f` 最小节点的回溯路径。
- 找到终点后显示完整终点路径。

## 页面和 UI 调整

### 删除旧搜索步长

新算法不再使用 `searchStepPlanePixels`。

需要删除或隐藏：

- UI 的“搜索步长”输入。
- `pathfindingSearchStepText`。
- `ParsedObstacleTolerances.searchStepPlanePixels`。
- 校验中对搜索步长的要求。
- `GraphwarPathfindingOptions.searchStepPlanePixels`。
- 只服务旧动画的 `getSmartPathfindingImageXStep`。

### 删除旧列扫描 preview

删除：

- `SafeInterval` preview 语义。
- `smartPathfindingPreviewColumn`。
- `smartPathfindingPreviewSegments`。
- scan line SVG。
- candidate segment SVG。
- `graphwar-killer__pathfinding-scan-line` 样式。
- `graphwar-killer__pathfinding-candidate-segment` 样式。

保留并改语义：

- `smartPathfindingPreviewPoints`：候选点/前沿点。
- `smartPathfindingPreviewPath`：best path / 几何候选路径。
- `smartPathfindingPreviewConnection`：start-target 参考线。
- `pathfindingOptimizationPreviewPoint`：删点优化阶段。

### 删除旧 fallback

删除/废弃：

- `forceColumnSearch`。
- `simplifyByLineOfSight` 入口选项。
- 直线几何成功但真实轨迹失败后的第二次列扫描逻辑。

真实轨迹验证失败时：

- 继续下一个 `routeTolerance`。
- 所有容差失败则智能寻路失败。

## 实施顺序

1. 更新 `graphwar-pathfinding.ts` 类型和常量。
2. 实现 8 邻接连通域。
3. 实现像素边界轮廓提取。
4. 实现 RDP 简化。
5. 实现保守候选点过滤和 free cell 选择。
6. 实现 x+ 精度边规则入口。
7. 实现 Lazy Visibility A\*。
8. 替换 `buildSmartPathfindingPathForMask` 的核心搜索。
9. 更新 `GraphwarKillerPage.vue` 调用侧，删除旧 fallback。
10. 更新页面 preview 状态、SVG 和样式。
11. 删除搜索步长 UI 和相关校验。
12. 保留并验证现有轨迹验证与删点优化。

## 验证清单

- `pnpm lint`
- `pnpm docs:build`
- 手动检查：
  - 直线可见时返回两点路径。
  - 障碍绕行时路径为纯折线，控制点明显减少。
  - 路径始终 x+，并通过 `pathFollowsGraphRule`。
  - 真实轨迹验证失败时会尝试下一个容差。
  - 所有容差失败时智能寻路失败。
  - 动画显示候选点、当前扩展点、最近 accepted edges 和 best path。
  - 不再显示扫描列和安全区间。

## 已知风险

- 候选点来自简化轮廓，不是严格理论全局最优。
- RDP 或凹点过滤过强可能漏路；第一版采取保守过滤。
- `lineHitsPlaneMask` 是现有整数采样，贴边场景可能需要后续升级为 supercover line。
- 第一版扩展所有候选点，障碍极多时可能慢；后续可加空间索引或裁剪。
- ABS 公式真实轨迹不一定严格沿几何折线，因此必须保留现有轨迹验证。
