# Graphwar 杀手

[English](../../en/tools/graphwar-killer/) | **简体中文**

Graphwar 杀手在解算器模式下标定 [Graphwar](https://graphwar.com/graphwar_1/index.html) 截图坐标并生成函数表达式，在模拟器模式下输入函数表达式并模拟结果。

## 在线体验

[开始使用 Graphwar 杀手](https://howiehz.top/misc/tools/graphwar-killer/)

## 源码结构

- [index.md](./index.md) 是中文工具页面入口。
- [GraphwarKillerPage.vue](./GraphwarKillerPage.vue) 是中英文共享工具页面实现。
- [composables/](./composables/) 放页面侧工作流状态 Module，例如截图输入、路径编辑和智能寻路会话。
- [graphwar-pathfinding-cache.ts](./graphwar-pathfinding-cache.ts) 集中维护智能寻路页面侧缓存，避免页面实现直接管理缓存失效和克隆细节。
- [locale.ts](./locale.ts) 提供中文页面文案；英文文案在 [英文页面目录](../../en/tools/graphwar-killer/locale.ts) 的 `locale.ts`。

## 已知改进点

- 一键清图候选当前按士兵命中圆中心是否在当前路径末端的 x+（严格向右推进）侧过滤，并用中心点建立 DAG（有向无环图）；普通智能寻路点士兵时允许“中心不满足 x+，但命中圆 x+ 边缘可达”的目标。后续若要对齐两者，应让一键清图候选区分 `routePoint`（几何寻路目标点）和 `hitCenter`（命中圆中心，弹道验证目标）/命中圆。
- 普通智能寻路当前只验证几何寻路返回的单条路线；若该路线的真实弹道验证失败，理论上仍可能存在另一条绕法可用。后续可尝试禁边重试或 K-shortest paths（多候选路线）来逐条验证候选路线；同一能力也可复用于一键清图的单次 DAG 建边，让每条 DAG 边不只依赖第一条几何路线。
