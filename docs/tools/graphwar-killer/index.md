---
aside: false
publish: false
published: 2026-06-23T12:00:00+08:00
---

# Graphwar 杀手

解算器模式下标定 [Graphwar](https://graphwar.com/graphwar_1/index.html) 截图坐标并点选路径，生成函数表达式。模拟器模式下输入函数表达式，模拟结果。所有计算均在本地完成。

<!-- autocorrect-disable -->
<script setup lang="ts">
import GraphwarKillerPage from "./GraphwarKillerPage.vue";
import { graphwarKillerLocale } from "./locale";
</script>

<GraphwarKillerPage :locale="graphwarKillerLocale" />
<!-- autocorrect-enable -->

## 使用说明 {#graphwar-killer-instructions}

### 基本流程 {#graphwar-killer-basic-workflow}

- 输入来源：
  - 截图识别：上传、拖入或粘贴 Graphwar 截图，填写坐标范围和游戏模式；也可以依次使用“识别边界”和“识别士兵/障碍”。
  - Agent 读取：需要准确的游戏状态时，开启“使用 Agent”，确认 Agent 地址后选择“读取状态”。
- 模式介绍：
  - 解算器模式：先点选自己的士兵，再添加目标或中间路径点，最后将生成的函数复制到 Graphwar。
  - 模拟器模式：选择初始发射士兵并输入函数；`y''` 模式还需要输入发射角。

### 特色功能 {#graphwar-killer-features}

#### 智能光标 {#graphwar-killer-smart-cursor}

点选路径时自动吸附到识别出的士兵中心，并启用障碍和边界碰撞模拟。

#### 智能寻路 {#graphwar-killer-smart-pathfinding}

点选一个目标后，从当前路径末端自动寻找绕开识别障碍的路线，再生成函数并用模拟器验证弹道。

##### 一键清图 {#graphwar-killer-one-click-clear}

从当前路径末端出发，筛选士兵中心位于 `x+` 方向的可用目标，规划出击杀数尽可能多的路线。

#### 邪道模式 {#graphwar-killer-step-glitch-mode}

仅对阶跃函数的 `y'` 模式生效。普通阶跃的近似路径区域内存在障碍时，邪道模式会尝试生成用于纵向跨越障碍的瞬移项；该模式需要障碍数据和准确的士兵位置，推荐通过 Agent 读取游戏状态。

### 表达式语法 {#graphwar-killer-expression-syntax}

| 类别     | 支持内容                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 变量     | 可用 `x`、`y`、`y'`。                                                                                                                                   |
| 运算符   | 可用 `+`、`-`、`/`、`*`、`^`，并支持括号和 `2x`、`2sin(x)` 这样的隐式乘法。                                                                             |
| 函数     | 可用 `sqrt()`、`log()`、`ln()`、`abs()`、`sin()`（别名 `sen()`）、`cos()`、`tan()`（别名 `tg()`）、`exp()`；`log` 是以 10 为底的对数，`ln` 是自然对数。 |
| 常量     | 可用 `e`、`pi`。                                                                                                                                        |
| 兼容行为 | 默认兼容 Graphwar 原版：将 `y'` 视为 `y`，并忽略未知字符；两项均可在“高级设定”中关闭。                                                                  |

### 如何使用 Graphwar Agent {#graphwar-killer-agent-help}

将 [`graphwar-agent.jar`](/graphwar-agent.jar) 放入游戏目录，然后在该目录运行：

```bash
java -javaagent:graphwar-agent.jar -jar graphwar.jar
```

该命令会同时启动 Graphwar Agent 和游戏。回到工具后开启“使用 Agent”，即可使用“读取状态”获取当前游戏状态。更多信息请查看 [Graphwar Agent](https://github.com/HowieHz/howiehz-misc/tree/main/packages/graphwar-agent)。

### 寻路功能相关说明 {#graphwar-killer-pathfinding-details}

#### 支持情况 {#graphwar-killer-pathfinding-support}

<!-- markdownlint-disable MD013 -->

| 函数算法 | 邪道[^pathfinding-glitch]                          | 游戏模式         | 智能寻路[^pathfinding-solver-only]                 | 一键清图[^pathfinding-solver-only]                 | 目标候选点                                                               | 主要特点 | 时间复杂度[^pathfinding-complexity]                                |
| -------- | -------------------------------------------------- | ---------------- | -------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------ |
| 双绝对值 | <span title="不适用" aria-label="不适用">⛔️</span> | `y`、`y'`        | <span title="支持" aria-label="支持">✅</span>     | <span title="支持" aria-label="支持">✅</span>     | 智能寻路：单目标点模式[^pathfinding-single-target]<br>一键清图：士兵中心 | 两点直连 | 智能寻路 O(R)<br>一键清图 O(N²R)                                   |
| 双绝对值 | <span title="不适用" aria-label="不适用">⛔️</span> | `y''`            | <span title="不支持" aria-label="不支持">❌</span> | <span title="不支持" aria-label="不支持">❌</span> | —                                                                        | 两点直连 | —                                                                  |
| 阶跃     | <span title="关闭" aria-label="关闭">❌</span>     | `y`、`y'`、`y''` | <span title="支持" aria-label="支持">✅</span>     | <span title="支持" aria-label="支持">✅</span>     | 智能寻路：中心优先模式[^pathfinding-center-first]<br>一键清图：士兵中心  | 走直角   | 智能寻路 O(R)，最多执行 2 次<br>一键清图 O(N·D·R)，D 最坏为 O(2^N) |
| 阶跃     | <span title="开启" aria-label="开启">✅</span>     | `y'`             | <span title="不支持" aria-label="不支持">❌</span> | <span title="不支持" aria-label="不支持">❌</span> | —                                                                        | 走直角   | —                                                                  |
| PCHIP    | <span title="不适用" aria-label="不适用">⛔️</span> | `y`、`y'`、`y''` | <span title="支持" aria-label="支持">✅</span>     | <span title="不支持" aria-label="不支持">❌</span> | 智能寻路：单目标点模式[^pathfinding-single-target]                       | 曲线拟合 | 智能寻路 O(R)                                                      |
| Akima    | <span title="不适用" aria-label="不适用">⛔️</span> | `y`、`y'`、`y''` | <span title="支持" aria-label="支持">✅</span>     | <span title="不支持" aria-label="不支持">❌</span> | 智能寻路：单目标点模式[^pathfinding-single-target]                       | 曲线拟合 | 智能寻路 O(R)                                                      |

<!-- markdownlint-enable MD013 -->

[^pathfinding-glitch]: 邪道模式开关只对阶跃 `y'` 生效。

[^pathfinding-solver-only]: 模拟器模式不提供智能寻路或一键清图。

[^pathfinding-single-target]: 单目标点模式只会尝试一个目标点。点选士兵时，中心可用就使用中心，否则改用命中圈内的可用位置；目标确定后，即使寻路或完整弹道验证失败，也不会再换目标点重试。普通点击不在 `x+` 方向时，会移到同一 `y` 上最靠近当前路径末端的可用 `x+` 位置。

[^pathfinding-center-first]: 中心优先模式最多按“士兵中心 → 命中圈 `x+` 侧内边缘”的顺序尝试两个目标点。中心可用时先尝试中心；这次尝试失败后，再以内边缘完整重跑一次。中心一开始不可用时，直接使用内边缘。

[^pathfinding-complexity]: 这里只计算寻找绕障路线本身，不包含生成函数、模拟弹道、检查命中、删点和失败后重选；完整步骤见[计算流程](#graphwar-killer-pathfinding-workflows)。`N` 是一键清图实际参与规划的士兵数：不含发射士兵，并按“允许友伤”和 `x+` 方向筛选。`D` 是阶跃一键清图因不同实际落点而分别保留的情况总数。`R` 是[寻路算法说明](#graphwar-killer-pathfinding-engines)中单次寻路的复杂度。

#### 计算流程 {#graphwar-killer-pathfinding-workflows}

<!-- markdownlint-disable MD013 -->

<table tabindex="0">
  <thead>
    <tr>
      <th scope="col">设定</th>
      <th scope="col">流程</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>
        <table class="graphwar-workflow-settings" role="presentation">
          <tbody>
            <tr>
              <td>智能寻路</td>
            </tr>
            <tr class="graphwar-workflow-settings__group-start">
              <td>双绝对值 · <code>y</code>、<code>y'</code></td>
            </tr>
            <tr>
              <td>PCHIP、Akima · <code>y</code>、<code>y'</code>、<code>y''</code></td>
            </tr>
          </tbody>
        </table>
      </td>
      <td>检查当前路径和目标 → 必要时把目标移到可用位置 → 按“快速模式”选择的算法寻找绕障路线 → 生成函数并模拟弹道 → 检查 <code>x+</code> 方向、目标命中、障碍和边界 → 删除不必要的新增路径点并重新模拟 → 更新路径。失败时不再尝试其他目标点。</td>
    </tr>
    <tr>
      <td>
        <table class="graphwar-workflow-settings" role="presentation">
          <tbody>
            <tr>
              <td>智能寻路</td>
            </tr>
            <tr class="graphwar-workflow-settings__group-start">
              <td>阶跃 · <code>y</code>、<code>y'</code>、<code>y''</code></td>
            </tr>
            <tr class="graphwar-workflow-settings__group-start">
              <td>邪道模式关闭</td>
            </tr>
          </tbody>
        </table>
      </td>
      <td>检查当前阶跃路径的实际落点 → 优先选择士兵中心，必要时使用命中圈 <code>x+</code> 侧内边缘 → 寻找每一步都能避开障碍的阶跃路线 → 生成完整函数并从头模拟 → 检查目标命中、障碍和边界 → 中心目标失败时改用内边缘再试一次 → 删除不必要的新增路径点并重新模拟 → 更新路径。</td>
    </tr>
    <tr>
      <td>
        <table class="graphwar-workflow-settings" role="presentation">
          <tbody>
            <tr>
              <td>一键清图</td>
            </tr>
            <tr class="graphwar-workflow-settings__group-start">
              <td>双绝对值 · <code>y</code>、<code>y'</code></td>
            </tr>
          </tbody>
        </table>
      </td>
      <td>检查当前路径 → 收集 <code>x+</code> 方向的士兵中心 → 尝试起点到各目标、各目标之间的绕障路线 → 选择预计能命中最多士兵的顺序 → 逐段生成函数并模拟 → 排除模拟失败的连接并重新选择 → 删除不必要的路径点并从头模拟 → 更新路径和实际命中结果。</td>
    </tr>
    <tr>
      <td>
        <table class="graphwar-workflow-settings" role="presentation">
          <tbody>
            <tr>
              <td>一键清图</td>
            </tr>
            <tr class="graphwar-workflow-settings__group-start">
              <td>阶跃 · <code>y</code>、<code>y'</code>、<code>y''</code></td>
            </tr>
            <tr class="graphwar-workflow-settings__group-start">
              <td>邪道模式关闭</td>
            </tr>
          </tbody>
        </table>
      </td>
      <td>检查当前阶跃路径的实际落点 → 同一士兵因前面路线不同而产生多个实际落点时，分别继续尝试 → 逐段检查能否避开障碍并接上前一段 → 选择预计能命中最多士兵的顺序 → 从发射点生成并模拟完整函数 → 排除失败的连接并重新选择 → 删除不必要的路径点并从头模拟 → 更新路径和实际命中结果。</td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-enable MD013 -->

#### 寻路算法说明 {#graphwar-killer-pathfinding-engines}

<!-- markdownlint-disable MD013 -->

| 快速模式                                                       | 寻路算法        | 用于                | 主要特点                                                                                                     | 当前实现最坏时间复杂度[^routing-complexity]                                                          |
| -------------------------------------------------------------- | --------------- | ------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| <span title="开启（默认）" aria-label="开启（默认）">✅</span> | 惰性可视图      | 智能寻路 + 一键清图 | 从障碍轮廓挑少量路径点来绕路，通常更快、路线更直；障碍复杂时可能找不到 Theta* 能找到的路线[^routing-cache]。 | 首次 O(P² + C + T² + T·V·(L + log V))；缓存命中时省去 P²，但仍需 O(C) 扫描轮廓。非阶跃模式最坏 T=V。 |
| <span title="关闭" aria-label="关闭">❌</span>                 | 定制有向 Theta* | 智能寻路 + 一键清图 | 在 770×450 网格中向 `x+` 方向逐步找路，通常更慢，但更容易绕过复杂障碍[^routing-cache]。                      | O(P + T[H² + H(L + log T)] + Q²L)；缓存命中时省去 P。                                                |

<!-- markdownlint-enable MD013 -->

[^routing-complexity]: `P` 是 770×450 网格的格子总数；`C` 是简化后障碍轮廓的点数；`V` 是本次惰性可视图使用的备选路径点数；`T` 是实际检查备选路径点的总次数，同一点因到达方式不同或后来找到更好路线，可能重复检查；`H` 是网格高度 450；`L` 是检查一条直线或一段阶跃时经过的格子数；`Q` 是最终路径点数。

[^routing-cache]: 障碍、`x+` 方向和相关容差不变时，会复用已经处理好的障碍数据，省去重复准备；缓存只影响速度，不改变路线。一键清图只在本次任务内复用，并行任务各自保存一份。
