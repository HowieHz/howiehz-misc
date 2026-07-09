# Graphwar 杀手

[English](../../en/tools/graphwar-killer/) | **简体中文**

Graphwar 杀手在解算器模式下标定 [Graphwar](https://graphwar.com/graphwar_1/index.html) 截图坐标并生成函数表达式，在模拟器模式下输入函数表达式并模拟结果。

## 在线体验

[开始使用 Graphwar 杀手](https://howiehz.top/misc/tools/graphwar-killer/)

## 源码结构

- [index.md](./index.md)：中文工具页面入口。
- [GraphwarKillerPage.vue](./GraphwarKillerPage.vue)：中英文共享的工具页面。
- [core/](./core/)：基础类型、坐标换算、数值工具和统一计时入口；`game/` 包含 Graphwar 游戏常量和前进规则，`tool/` 包含工具默认配置。
- [formula/](./formula/)：公式相关模块；`generation/` 包含公式生成和 step 数值策略，`expression/` 包含表达式 evaluator，`simulation/` 包含 Graphwar 轨迹模拟器，`trajectory/` 包含路径/目标/障碍采样封装。
- [detection/](./detection/)：截图识别相关模块；`objects.ts` 包含坐标系边界、障碍和士兵识别，`profile/` 包含识别经验阈值，`runtime/` 包含 runner 和 worker 消息类型，`template/` 包含模板匹配子任务协议。
- [pathfinding/](./pathfinding/)：路径规划相关模块；`routing/` 包含共享几何寻路算法，`smart/` 包含普通智能寻路，`one-click-clear/` 包含一键清图，`runtime/` 包含缓存、runner 和 worker 消息类型，`targeting.ts` 提供共享目标选择规则。
- [controllers/](./controllers/)：页面控制器；`debug/` 包含调试入口与耗时，`screenshot/` 包含截图输入，`settings/` 包含输入校验，`detection/` 包含识别流程，`path/` 包含路径状态与编辑，`pathfinding/` 包含寻路会话，`stage/` 包含舞台交互，`result/` 包含结果操作。
- [presentation/](./presentation/)：展示层模块；页面面板按 `settings/`、`detection/`、`pathfinding/`、`action/`、`screenshot/`、`result/`
  分组，目录内用 `MainPanel.vue`/`AdvancedPanel.vue` 表达主面板；`dom/` 包含 DOM 事件适配工具，`stage/` 包含截图舞台 SVG 覆盖层和 polyline points 格式化，`status/` 包含状态文案聚合与耗时格式化。
- [workers/](./workers/)：Web Worker 入口文件；`detection/` 包含截图识别主 worker 和模板匹配子 worker，`pathfinding/` 包含寻路主 worker，`pathfinding/one-click-clear/` 包含一键清图边 worker。
- [locale.ts](./locale.ts)：中文页面文案；英文文案在 [英文页面目录](../../en/tools/graphwar-killer/locale.ts) 的 `locale.ts`。

## 已知改进点

- 非 step 算法的内部 compiled evaluator 仍可能存在 Graphwar 浮点求值顺序偏差。Graphwar 原版重排表达式时，同层操作符会选择最左侧操作符作为根，因此 `a+b+c` 会按 `a+(b+c)` 求值；当前 `abs`、`pchip`、`akima` 的部分内部累加仍使用 JS 左结合累加。
  最终轨迹验证会回放最终公式文本，但发射点/发射角等内部预计算在极端抵消或溢出边缘可能产生微小偏差。
  后续应让非 step compiled evaluator 复用 Graphwar 表达式 evaluator，或按最终公式 AST 与 Graphwar 右结合顺序回放；`step` 分支已按 Graphwar 数值语义处理。
- 一键清图候选当前按士兵命中圆中心是否在当前路径末端的 x+（严格向右推进）侧过滤，并用中心点建立 DAG（有向无环图）；普通智能寻路点士兵时允许“中心不满足 x+，但命中圆 x+ 边缘可达”的目标。后续若要对齐两者，应让一键清图候选区分 `routePoint`（几何寻路目标点）和 `hitCenter`（命中圆中心，弹道验证目标）/命中圆。
- 普通智能寻路当前只验证几何寻路返回的单条路线；若该路线的真实弹道验证失败，理论上仍可能存在另一条绕法可用。后续可尝试禁边重试或 K-shortest paths（多候选路线）来逐条验证候选路线；同一能力也可复用于一键清图的单次 DAG 建边，让每条 DAG 边不只依赖第一条几何路线。
