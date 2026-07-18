# Graphwar 杀手

[English](../../en/tools/graphwar-killer/) | **简体中文**

Graphwar 杀手在解算器模式下标定 [Graphwar](https://graphwar.com/graphwar_1/index.html) 截图坐标并生成函数表达式，在模拟器模式下输入函数表达式并模拟结果。

“结果转分数”只后处理显示、复制和 Agent 发射使用的对外公式，内部求解、轨迹回放和缓存仍使用原始小数。转换优先输出直观的十进制最简分数；若 Graphwar 分别按 `double` 解析分子、分母后会改变运行值，则改用原小数 `double` 值的精确有理数。仍无法保证等价的小数会原样保留，并在开关旁提示；同一结果的显示、复制、手动发射和托管发射使用同一转换规则。

## 在线体验

[开始使用 Graphwar 杀手](https://howiehz.top/misc/tools/graphwar-killer/)

## 源码结构

- [index.md](./index.md)：中文工具页面入口。
- [GraphwarKillerPage.vue](./GraphwarKillerPage.vue)：中英文共享的工具页面。
- [core/](./core/)：基础类型、坐标换算、数值工具和统一计时入口；`game/` 包含 Graphwar 游戏常量和前进规则，`tool/` 包含工具默认配置。
- [formula/](./formula/)：公式相关模块；`generation/` 包含公式生成和 step 数值策略，`expression/` 包含表达式 evaluator，`simulation/` 包含 Graphwar 轨迹模拟器，`trajectory/` 包含路径/目标/障碍采样封装。
- [detection/](./detection/)：截图识别相关模块；`objects.ts` 包含坐标系边界、障碍和士兵识别，`profile/` 包含识别经验阈值，`runtime/` 包含 runner 和 worker 消息类型，`template/` 包含模板匹配子任务协议。
- [pathfinding/](./pathfinding/)：路径规划相关模块；`routing/` 包含共享几何寻路算法，`smart/` 包含普通智能寻路，`one-click-clear/` 包含一键清图，`runtime/` 包含缓存、runner 和 worker 消息类型，`targeting.ts` 提供共享目标选择规则。
- [controllers/](./controllers/)：页面控制器；`agent/` 包含 Agent 读取、手动调试文件和清图失败自动导出，`debug/` 包含调试入口与耗时，`screenshot/` 包含截图输入，`settings/` 包含输入校验，`detection/` 包含识别流程，`path/` 包含路径状态与编辑，`pathfinding/` 包含寻路会话，`stage/` 包含舞台交互，`result/` 包含结果操作。
- [presentation/](./presentation/)：展示层模块；页面面板按 `settings/`、`detection/`、`pathfinding/`、`action/`、`screenshot/`、`result/`
  分组，目录内用 `MainPanel.vue`/`AdvancedPanel.vue` 表达主面板，跨页面复用的面板模型放在同目录 `*-model.ts`；`dom/` 包含 DOM
  事件适配工具，`stage/` 包含截图舞台 SVG 覆盖层和 polyline points 格式化，`status/` 包含状态文案聚合与耗时格式化。
- [workers/](./workers/)：Web Worker 入口文件；`trajectory/` 包含主轨迹 worker，`live-click-preview/` 包含实时预览 worker，`detection/` 包含截图识别主 worker 和模板匹配子 worker，`pathfinding/` 包含寻路主 worker，`pathfinding/one-click-clear/` 包含一键清图边 worker。
- [locale.ts](./locale.ts)：中文页面文案；英文文案在 [英文页面目录](../../en/tools/graphwar-killer/locale.ts) 的 `locale.ts`。

## 一键清图目标分配

全部一键清图公式模式共享同一套命中圈目标分配：圆心不能从当前路径尾点严格向 `x+` 推进时，使用严格圆内且位于可用边界的最外侧安全整数像素；同初始 x 目标按 y 稳定分配，并按最终 x 建立普通有向无环图层或邪道扫描层。几何建路只调整 `routePoint.x`，最终弹道仍用士兵真实圆心和半径复验。

## 已知改进点

- 普通智能寻路当前只验证几何寻路返回的单条路线；若该路线的真实弹道验证失败，理论上仍可能存在另一条绕法可用。后续可尝试禁边重试或 K-shortest paths（多候选路线）来逐条验证候选路线；同一能力也可复用于一键清图的单次 DAG 建边，让每条 DAG 边不只依赖第一条几何路线。
