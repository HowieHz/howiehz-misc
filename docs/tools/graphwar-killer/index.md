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
import graphwarAgentInfo from "../../public/graphwar-agent.json";
import { graphwarKillerLocale } from "./locale";

const graphwarAgentSourceUrl = `https://github.com/HowieHz/howiehz-misc/commit/${graphwarAgentInfo.sourceCommit}`;
</script>

<GraphwarKillerPage :locale="graphwarKillerLocale" />
<!-- autocorrect-enable -->

## 表达式语法 {#graphwar-killer-expression-syntax}

| 类别           | 支持内容                                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 变量           | `x`、`y`、`y'`                                                                                                                                                                                          |
| 运算符         | `+`、`-`、`/`、`*`、`^`、括号，以及 `2x`、`2sin(x)` 形式的隐式乘法                                                                                                                                      |
| 优先级与结合性 | 由低到高为 `+ = -（二元） < -（一元） < * < / < ^`。二元 `-` 表示加上一元负号，因此 `1-2` 和 `1+-2` 都按 `1+(-2)` 计算。重复的同一二元运算符按右结合解析，如 `1+2+3` 为 `1+(2+3)`，`1/2/3` 为 `1/(2/3)` |
| 函数           | `sqrt()`、`log()`、`ln()`、`abs()`、`sin()`（别名 `sen()`）、`cos()`、`tan()`（别名 `tg()`）、`exp()`；`log` 以 10 为底，`ln` 以 `e` 为底                                                               |
| 常量           | `e`、`pi`                                                                                                                                                                                               |
| 兼容行为       | 默认按 Graphwar 原版规则将 `y'` 视为 `y`，并跳过未知字符；可在“高级设定”中关闭                                                                                                                          |

## 使用说明 {#graphwar-killer-instructions}

### 基本流程 {#graphwar-killer-basic-workflow}

1. 上传、拖入、粘贴或截取 Graphwar 画面。需要准确数据时，也可以开启“使用 Agent”并读取状态。
2. 确认坐标边界、士兵和障碍。自动识别不准确时，可手工修正边界和障碍。
3. 在生成公式模式下，先选择自己的士兵，再添加目标或中间路径点。复制生成的函数到 Graphwar 即可使用。
4. 在模拟轨迹模式下，选择发射士兵并输入函数。`y''` 还需要填写发射角。

工具会为 `y`、`y'`、`y''` 分别保存算法设定。默认使用 `y` 双绝对值、`y'` 阶跃函数（邪道模式）和 `y''` 阶跃函数（邪道模式）。

### 画布工具 {#graphwar-killer-canvas-interaction}

- “吸附士兵”让点选位置吸附到识别出的士兵，并使用真实命中圈。
- “碰撞检查”用于手工解算和轨迹模拟。路径规划、一键清图和托管模式始终检查碰撞。
- “路径规划”在点选目标后自动寻找绕障路线。数据不完整时，界面会显示缺少的条件。

### 路径规划 {#graphwar-killer-smart-pathfinding}

路径规划从当前路径末端寻找绕障路线，生成函数，并在更新路径前验证完整轨迹。

阶跃单目标路径规划优先瞄准命中圈中心；失败后再尝试命中圈 `x+` 侧的内边缘。

“一键清图”从当前路径末端开始，寻找 `x+` 方向的可用士兵，并尽量规划命中更多目标的路线。

#### 支持情况 {#graphwar-killer-pathfinding-support}

| 函数算法         | 游戏模式         | 路径规划 | 一键清图 | 路线特点           |
| ---------------- | ---------------- | -------- | -------- | ------------------ |
| 双绝对值         | `y`、`y'`、`y''` | 支持     | 支持     | 两点直连、平滑折点 |
| 阶跃函数         | `y`、`y'`、`y''` | 支持     | 支持     | 直角路线           |
| 阶跃函数（邪道） | `y'`、`y''`      | 支持     | 支持     | 横向扫描、纵向瞬移 |
| PCHIP            | `y`、`y'`、`y''` | 支持     | —        | 平滑曲线           |
| Akima            | `y`、`y'`、`y''` | 支持     | —        | 平滑曲线           |

#### 一键清图瞄准规则 {#graphwar-killer-pathfinding-targets}

- 优先瞄准士兵圆心；若圆心不在当前路径终点右侧，则改瞄准命中圈内最靠右的可用位置。
- 多个士兵的 x 坐标相同时，会在各自命中圈内错开瞄准位置，尽量让路径继续向右推进。
- 更新路径前会验证完整轨迹；弹道顺路命中的士兵也会计入结果。
- 开启“删点优化”后，会在不影响命中的前提下尝试缩短路径。

#### 寻路算法 {#graphwar-killer-pathfinding-engines}

| 算法       | 特点                                                               |
| ---------- | ------------------------------------------------------------------ |
| 惰性可视图 | 默认算法，通常更快、路线更直，但复杂障碍下可能漏掉可行路线         |
| Theta*     | 通常较慢，但更适合复杂障碍                                         |
| X+ 扫描    | 阶跃 ODE 邪道模式自动使用；沿 x 正方向扫描，并在需要时尝试纵向瞬移 |

### 邪道模式 {#graphwar-killer-step-glitch-mode}

邪道模式适用于阶跃 `y'` 和 `y''`。普通阶跃无法绕过障碍时，会尝试用纵向瞬移继续路径；有障碍数据时仍会验证碰撞。需要准确越障时，推荐使用 Agent。

### 托管模式 {#graphwar-killer-managed-mode}

开启“使用 Agent”并填写有效地址后即可使用托管模式。托管会在房间内自动准备本地玩家，并在己方回合读取状态、计算一键清图和发射。

页面取得实时 Agent 状态后，会在“开火”按钮左侧显示当前回合倒计时；手动读取、托管轮询和开火前检查都会校准该时间。

如果某个游戏模式的算法不支持一键清图，开启托管时会先列出需要调整的设定，并在确认后修改。搜索完成后会短暂显示耗时并立即提交发射，不等待页面渲染。

托管始终在后台保存当前最佳公式。“搜索动画”只控制页面预览，不影响搜索或截止时发射。

开启“搜索动画”时，新最佳方案的控制点会先显示；对应轨迹生成期间保留上一方案的完整轨迹，新轨迹就绪后再替换。

回合达到设定的发射预留时间时，托管会发射已经验证的最佳方案；没有可用方案时，会提交跳过回合函数。它不会故意撞击障碍作为兜底，以免改变地图并为对手打开通道。

托管期间请让页面保持在前台，以免浏览器限制后台任务而延迟发射。

### 如何使用 Graphwar Agent {#graphwar-killer-agent-help}

将 [`graphwar-agent.jar`](/graphwar-agent.jar) 放入游戏目录。

::: details graphwar-agent.jar 文件信息

- 文件大小：`{{ graphwarAgentInfo.fileSize.toLocaleString("en-US") }}` 字节
- MD5：`{{ graphwarAgentInfo.md5 }}`
- SHA-256：`{{ graphwarAgentInfo.sha256 }}`
- 版本号：`{{ graphwarAgentInfo.version }}`
- 构建来源提交时间：`{{ graphwarAgentInfo.sourceCommitTime }}`
- 构建来源：<a :href="graphwarAgentSourceUrl"><code>{{ graphwarAgentInfo.sourceCommitShort }}</code></a>

:::

然后在该目录运行：

```bash
java -javaagent:graphwar-agent.jar -jar graphwar.jar
```

该命令会同时启动 Graphwar Agent 和游戏。回到页面后开启“使用 Agent”，即可读取状态或开启托管模式。

Windows Steam 版的 Graphwar 可以直接使用游戏自带的 Java：

```shell
.\jre1.8\bin\java.exe -javaagent:graphwar-agent.jar -jar graphwar.jar
```

::: details Graphwar Agent 启动选项

如需设置启动选项，请在 Agent JAR 路径后追加 `=...`。多个选项用逗号分隔：

```shell
java -javaagent:graphwar-agent.jar=token=auto,maxRequestHeaderBytes=16384,maxRequestBodyBytes=1048576 -jar graphwar.jar
```

| 选项                    | 用途                                  | 默认值                                                  | 可接受值                                      |
| ----------------------- | ------------------------------------- | ------------------------------------------------------- | --------------------------------------------- |
| `port`                  | 设置 HTTP 监听端口                    | `17900`；占用时再尝试后续 100 个端口（`17901`–`18000`） | `1`–`65535`；显式设置后不再尝试其他端口       |
| `token`                 | 启用 bearer token 鉴权                | 不启用鉴权                                              | `auto`，或 1–4096 个不含逗号的可见 ASCII 字符 |
| `maxRequestHeaderBytes` | 限制 HTTP 请求头大小                  | `8192`                                                  | `8192`–`1048576`                              |
| `maxRequestBodyBytes`   | 限制单次 API 提交的 JSON 数据大小     | `65536`                                                 | `1024`–`16777216`                             |
| `maxFunctionBytes`      | 限制单次提交的函数大小（按 UTF-8 计） | `65536`                                                 | `1`–`1048576`，且不会超过实际请求体上限       |
| `maxFunctionTokens`     | 限制 Graphwar 实际求值 token 数       | `3072`                                                  | `1`–`4432`                                    |

默认值保留了较保守的栈和延迟余量。同时把两个公式限制提高到可选最大值时，后台校验可能持续数秒。发射 POST 仍会立即返回；客户端必须先按 pending 响应的 `Retry-After` 等待，再轮询其 `Location`，直至命令结束。

:::

更多信息请查看 [Graphwar Agent](https://github.com/HowieHz/howiehz-misc/tree/main/packages/graphwar-agent)。
