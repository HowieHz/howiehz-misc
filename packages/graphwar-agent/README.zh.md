# graphwar-agent

graphwar-agent 是一个给官方 Graphwar 客户端使用的本地 Java Agent。

它在不修改官方 jar 的前提下，把当前对局里正在渲染的士兵坐标、障碍数据和函数提交能力暴露成只监听本机的 HTTP 接口。

## 为什么用 graphwar-agent

- **不改官方客户端**：通过 `-javaagent` 加载，不解包、不替换官方 jar。
- **无运行时依赖**：agent 代码只依赖 JDK，构建脚本也只调用 `javac` 和 `jar`。
- **直接读取官方状态**：从 `Graphwar.Graphwar#getGameData()` 读取当前 `GameData`、玩家、士兵和障碍图。
- **障碍判定精确**：复用 Graphwar 自己的判定规则，非白色 terrain 像素即阻挡。
- **提交函数走官方逻辑**：HTTP 接口最终调用 `GameData#sendFunction(String)`，复用原版的回合判断、函数校验和发射消息。
- **同时给出两套坐标**：返回 Graphwar 内部 `world` 坐标和当前屏幕方向的 `view` 坐标，并附带数学游戏坐标。
- **静默原版倒计时噪声**：官方代码取消开局倒计时时会中断睡眠线程并打印 `InterruptedException`，agent 只移除这条预期日志，不改变倒计时逻辑。

## 构建

先确保本机 `PATH` 中有 JDK 工具：

```shell
java -version
javac -version
jar --version
```

推荐使用 JDK 17 或 21。构建产物会输出 Java 8 字节码。

在仓库根目录运行：

```shell
pnpm --filter graphwar-agent build
```

构建后的 jar 位于：

```text
packages/graphwar-agent/build/libs/graphwar-agent.jar
```

同步文档站下载用的 jar：

```shell
pnpm --filter graphwar-agent sync:public
```

CI 会在 graphwar-agent 构建流程里自动执行同步；如果 `docs/public/graphwar-agent.jar` 缺失或有效内容不一致，同仓库 PR 会自动提交更新。比较时会忽略源码 commit、commit 时间和 jar 生成环境这类构建信息。

清理构建产物：

```shell
pnpm --filter graphwar-agent clean
```

## 用法

启动官方 Graphwar 时加上 `-javaagent`：

Linux / macOS:

```shell
java -javaagent:packages/graphwar-agent/build/libs/graphwar-agent.jar -jar path/to/graphwar.jar
```

Windows PowerShell:

```powershell
java -javaagent:packages/graphwar-agent/build/libs/graphwar-agent.jar -jar path\to\graphwar.jar
```

默认监听 `127.0.0.1:17900`。如果 `17900` 被占用，会向后扫描 100 个端口，并在 stderr 打印实际地址：

```text
[graphwar-agent] version 0.0.0
[graphwar-agent] source commit 000000000000 (2026-01-01T00:00:00+00:00)
[graphwar-agent] port 17900 unavailable; selected 17901
[graphwar-agent] listening on http://127.0.0.1:17901
```

如果调用方必须固定端口，可以显式指定：

Linux / macOS:

```shell
java -javaagent:packages/graphwar-agent/build/libs/graphwar-agent.jar=port=17901 -jar path/to/graphwar.jar
```

Windows PowerShell:

```powershell
java -javaagent:packages/graphwar-agent/build/libs/graphwar-agent.jar=port=17901 -jar path\to\graphwar.jar
```

显式端口是严格模式：端口不可用时启动失败，不会自动切换。

启动时应先看到 `version` 和 `source commit` 两行。如果只看到 `listening`，通常说明游戏目录里的 `graphwar-agent.jar` 不是当前构建的 jar。

## 读取状态

健康检查：

Linux / macOS:

```shell
curl http://127.0.0.1:17900/health
```

Windows PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:17900/health
```

读取当前状态：

Linux / macOS:

```shell
curl http://127.0.0.1:17900/state
```

Windows PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:17900/state
```

`/state` 会返回：

- `agent`：agent 版本、源码 commit 和 commit 时间。
- `plane`：Graphwar 平面尺寸和游戏坐标长度。
- `available`：当前是否已经能读到对局状态。
- `terrainReversed`：当前客户端是否反向渲染地形。
- `gameState`、`gameMode`、`currentTurn`：当前游戏状态。
- `players[].soldiers[]`：每个士兵的存活状态、角度、`world` 坐标和 `view` 坐标。
- `obstacleMask`：障碍数据的尺寸、取值和下载地址。

对局未开始时，`available` 为 `false`，`reason` 会说明缺少哪部分状态。

提交函数：

Linux / macOS:

```shell
curl -X POST \
  -H "Content-Type: text/plain; charset=utf-8" \
  --data-binary "sin(x)" \
  http://127.0.0.1:17900/function
```

Windows PowerShell:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:17900/function -ContentType "text/plain; charset=utf-8" -Body "sin(x)"
```

`POST /function` 的请求体就是 UTF-8 函数文本。它等价于在官方游戏的函数输入框里提交当前文本：

- 当前不是本地玩家回合、对局未开始、函数正在绘制中时返回 `409`。
- 函数为空或不能被 Graphwar 官方 `Function` 解析时返回 `400`。
- 二阶微分模式会使用游戏里当前士兵角度；调整角度仍按官方客户端自己的按键逻辑进行。

下载当前屏幕方向的障碍数据：

Linux / macOS:

```shell
curl -L -o obstacle-mask.bin "http://127.0.0.1:17900/obstacle-mask.bin?space=view"
```

Windows PowerShell:

```powershell
Invoke-WebRequest http://127.0.0.1:17900/obstacle-mask.bin?space=view -OutFile obstacle-mask.bin
```

下载 Graphwar 内部方向的障碍数据：

Linux / macOS:

```shell
curl -L -o obstacle-mask.world.bin "http://127.0.0.1:17900/obstacle-mask.bin?space=world"
```

Windows PowerShell:

```powershell
Invoke-WebRequest http://127.0.0.1:17900/obstacle-mask.bin?space=world -OutFile obstacle-mask.world.bin
```

障碍数据格式：

- 大小：`770 * 450` 字节。
- 索引：`y * 770 + x`。
- 值 `1`：阻挡。
- 值 `0`：空白。

## 坐标说明

Graphwar 的内部平面尺寸来自官方 `GraphServer.Constants`：

```text
PLANE_LENGTH = 770
PLANE_HEIGHT = 450
PLANE_GAME_LENGTH = 50
```

`world.pixel` 是 Graphwar 内部 770x450 坐标。

`view.pixel` 是当前客户端实际渲染方向的坐标。`terrainReversed` 为 `true` 时，x 坐标会按 Graphwar 绘制逻辑镜像。

`*.game` 是从相邻 pixel 坐标换算出的数学游戏坐标：

```text
gameX = (pixelX - 770 / 2) * 50 / 770
gameY = (450 / 2 - pixelY) * 50 / 770
```

士兵中心点跟随 `GraphPlane` 绘制逻辑：

```text
viewX = 770 - worldX
```

障碍数据按像素格镜像：

```text
viewX = 769 - worldX
```

## 实现备注

- Agent 不做 JVMTI 和字节码改写。
- HTTP 服务只绑定 `127.0.0.1`。
- 读取 Graphwar 状态时使用反射，因为官方 jar 不作为本包的编译依赖。
- 障碍规则来自官方 `Obstacle#collidePoint`：`terrain.getRGB(x, y) != -1` 即阻挡。
- 坐标换算来自官方 `GraphPlane#convertX` / `GraphPlane#convertY` 的反向公式。
