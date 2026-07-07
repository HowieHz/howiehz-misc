# Graphwar 杀手

[English](../../en/tools/graphwar-killer/) | **简体中文**

Graphwar 杀手在解算器模式下标定 [Graphwar](https://graphwar.com/graphwar_1/index.html) 截图坐标并生成函数表达式，在模拟器模式下输入函数表达式并模拟结果。

## 在线体验

[开始使用 Graphwar 杀手](https://howiehz.top/misc/tools/graphwar-killer/)

## 源码结构

- [index.md](./index.md)：中文工具页面入口。
- [GraphwarKillerPage.vue](./GraphwarKillerPage.vue)：中英文共享的工具页面。
- [core/](./core/)：Graphwar 常量、坐标换算、数值工具、基础类型和前进规则。
- [formula/](./formula/)：表达式解析、公式生成、轨迹采样和模拟器逻辑。
- [detection/](./detection/)：截图识别、障碍 mask、士兵模板匹配和识别 worker 消息类型。
- [pathfinding/](./pathfinding/)：智能寻路、一键清图、寻路缓存、runner 和 worker 消息类型。
- [composables/](./composables/)：截图输入、路径编辑、智能寻路会话等页面状态。
- [presentation/](./presentation/)：展示层模块，包含页面面板、截图舞台 SVG 覆盖层、状态文案聚合与耗时格式化。
- [workers/](./workers/)：Web Worker 入口文件。
- [locale.ts](./locale.ts)：中文页面文案；英文文案在 [英文页面目录](../../en/tools/graphwar-killer/locale.ts) 的 `locale.ts`。

## 已知改进点

- 一键清图候选当前按士兵命中圆中心是否在当前路径末端的 x+（严格向右推进）侧过滤，并用中心点建立 DAG（有向无环图）；普通智能寻路点士兵时允许“中心不满足 x+，但命中圆 x+ 边缘可达”的目标。后续若要对齐两者，应让一键清图候选区分 `routePoint`（几何寻路目标点）和 `hitCenter`（命中圆中心，弹道验证目标）/命中圆。
- 普通智能寻路当前只验证几何寻路返回的单条路线；若该路线的真实弹道验证失败，理论上仍可能存在另一条绕法可用。后续可尝试禁边重试或 K-shortest paths（多候选路线）来逐条验证候选路线；同一能力也可复用于一键清图的单次 DAG 建边，让每条 DAG 边不只依赖第一条几何路线。
