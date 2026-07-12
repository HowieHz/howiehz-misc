---
aside: false
publish: false
published: 2026-06-23T12:00:00+08:00
---

# Graphwar 杀手

从 [Graphwar](https://graphwar.com/graphwar_1/index.html) 截图或 Agent 状态生成函数，也可以预览已有函数的轨迹。所有计算均在本地完成。

<!-- autocorrect-disable -->
<script setup lang="ts">
import GraphwarKillerPage from "./GraphwarKillerPage.vue";
import { graphwarKillerLocale } from "./locale";
</script>

<GraphwarKillerPage :locale="graphwarKillerLocale" />
<!-- autocorrect-enable -->

## 表达式语法 {#graphwar-killer-expression-syntax}

| 类别     | 支持内容                                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 变量     | `x`、`y`、`y'`                                                                                                                            |
| 运算符   | `+`、`-`、`/`、`*`、`^`、括号，以及 `2x`、`2sin(x)` 形式的隐式乘法                                                                        |
| 函数     | `sqrt()`、`log()`、`ln()`、`abs()`、`sin()`（别名 `sen()`）、`cos()`、`tan()`（别名 `tg()`）、`exp()`；`log` 以 10 为底，`ln` 以 `e` 为底 |
| 常量     | `e`、`pi`                                                                                                                                 |
| 兼容行为 | 默认按 Graphwar 原版规则将 `y'` 视为 `y`，并跳过未知字符；可在“高级设定”中关闭                                                            |

## 使用说明 {#graphwar-killer-instructions}

### 基本流程 {#graphwar-killer-basic-workflow}

1. 上传、拖入、粘贴或截取 Graphwar 画面。需要准确数据时，也可以开启“使用 Agent”并读取状态。
2. 确认坐标边界、士兵和障碍。自动识别不准确时，可手工修正边界和障碍。
3. 在生成公式模式下，先选择自己的士兵，再添加目标或中间路径点。复制生成的函数到 Graphwar 即可使用。
4. 在模拟轨迹模式下，选择发射士兵并输入函数。`y''` 还需要填写发射角。

工具会为 `y`、`y'`、`y''` 分别保存算法设定。默认使用 `y` 双绝对值、`y'` 阶跃函数（邪道模式）和 `y''` 阶跃函数。

### 画布工具 {#graphwar-killer-canvas-interaction}

- “吸附士兵”让点选位置吸附到识别出的士兵，并使用真实命中圈。
- “碰撞检查”用于手工解算和轨迹模拟。路径规划、一键清图和托管模式始终检查碰撞。
- “路径规划”在点选目标后自动寻找绕障路线。数据不完整时，界面会显示缺少的条件。

### 路径规划 {#graphwar-killer-smart-pathfinding}

路径规划从当前路径末端寻找绕障路线，生成函数，并在更新路径前验证完整轨迹。

“一键清图”从当前路径末端开始，寻找 `x+` 方向的可用士兵，并尽量规划命中更多目标的路线。

#### 支持情况 {#graphwar-killer-pathfinding-support}

| 函数算法         | 游戏模式         | 路径规划 | 一键清图 | 路线特点           |
| ---------------- | ---------------- | -------- | -------- | ------------------ |
| 双绝对值         | `y`、`y'`        | 支持     | 支持     | 两点直连           |
| 阶跃函数         | `y`、`y'`、`y''` | 支持     | 支持     | 直角路线           |
| 阶跃函数（邪道） | `y'`             | 支持     | 支持     | 横向扫描、纵向瞬移 |
| PCHIP            | `y`、`y'`、`y''` | 支持     | —        | 平滑曲线           |
| Akima            | `y`、`y'`、`y''` | 支持     | —        | 平滑曲线           |

#### 目标选择 {#graphwar-killer-pathfinding-targets}

- 所有结果都会通过完整轨迹验证后再更新路径。
- 阶跃路径规划优先瞄准命中圈中心；失败后再尝试命中圈 `x+` 侧的内边缘。
- 同一 x 上有多个士兵时，邪道一键清图会为它们分配不同的命中圈位置，使路径继续向右推进。
- 邪道一键清图按 x 从左到右处理目标。当前目标不可达时，会跳过它并继续尝试右侧目标。
- “删点优化”默认关闭。开启后会尝试删除多余控制点，最终轨迹验证不会省略。

#### 寻路算法 {#graphwar-killer-pathfinding-engines}

| 算法       | 特点                                                                |
| ---------- | ------------------------------------------------------------------- |
| 惰性可视图 | 默认算法，通常更快、路线更直，但复杂障碍下可能漏掉可行路线          |
| Theta*     | 通常较慢，但更适合复杂障碍                                          |
| X+ 扫描    | 阶跃 `y'` 邪道模式自动使用；沿 x 正方向扫描，并在需要时尝试纵向瞬移 |

### 邪道模式 {#graphwar-killer-step-glitch-mode}

邪道模式仅用于阶跃 `y'`。普通阶跃路线遇到障碍时，它会尝试生成纵向瞬移项，因此需要准确的障碍和士兵位置。推荐通过 Agent 读取游戏状态。

### 托管模式 {#graphwar-killer-managed-mode}

开启“使用 Agent”并填写有效地址后即可使用托管模式。托管会在房间内自动准备本地玩家，并在己方回合读取状态、计算一键清图和发射。

如果某个游戏模式的算法不支持一键清图，开启托管时会先列出需要调整的设定，并在确认后修改。搜索完成后会短暂显示耗时并立即提交发射，不等待页面渲染。

回合只剩 3 秒时，托管会发射已经验证的最佳方案；没有可用方案时，会提交跳过回合函数。它不会故意撞击障碍作为兜底，以免改变地图并为对手打开通道。

托管期间请让页面保持在前台，以免浏览器限制后台任务而延迟发射。

### 如何使用 Graphwar Agent {#graphwar-killer-agent-help}

将 [`graphwar-agent.jar`](/graphwar-agent.jar) 放入游戏目录，然后在该目录运行：

```bash
java -javaagent:graphwar-agent.jar -jar graphwar.jar
```

该命令会同时启动 Graphwar Agent 和游戏。回到工具后开启“使用 Agent”，即可读取状态或开启托管模式。更多信息请查看 [Graphwar Agent](https://github.com/HowieHz/howiehz-misc/tree/main/packages/graphwar-agent)。
