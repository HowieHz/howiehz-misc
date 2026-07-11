# graphwar-agent

[English](./README.md) | **简体中文**

graphwar-agent 是一个给官方 Graphwar 客户端使用的本地 Java Agent。

它不会修改官方客户端。它会把赛前房间状态与准备控制，以及当前对局里的士兵坐标、障碍数据和函数提交能力，暴露成只监听本机的 HTTP 接口。

## 为什么用 graphwar-agent

- **不改官方客户端**：通过 `-javaagent` 加载，不解包、不替换官方 jar。
- **无运行时依赖**：agent 代码只依赖 JDK，构建脚本也只调用 `javac` 和 `jar`。
- **直接读取官方状态**：从 `Graphwar.Graphwar#getGameData()` 读取当前 `GameData`、玩家、士兵和障碍图。
- **障碍判定精确**：复用 Graphwar 自己的判定规则，非白色 terrain 像素即阻挡。
- **提交函数走原版逻辑**：HTTP 接口最终调用 `GameData#sendFunction(String)`。这样会复用原版的回合判断、函数校验和发射消息。
- **同时给出两套坐标**：返回 Graphwar 内部 `world` 坐标和当前屏幕方向的 `view` 坐标，并附带数学游戏坐标。
- **官方客户端兼容修复**：静默预期异常噪声。修复一个官方客户端 bug：被踢出房间后，如果重进房间失败，大厅可能卡住。

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

运行无外部依赖的 API 回归测试：

```shell
pnpm --filter graphwar-agent test
```

构建后的 jar 位于：

```text
packages/graphwar-agent/build/libs/graphwar-agent.jar
```

同步文档站下载用的 jar：

```shell
pnpm --filter graphwar-agent sync:public
```

CI 会在 graphwar-agent 构建流程里自动执行同步。如果 `docs/public/graphwar-agent.jar` 缺失或有效内容不一致，同仓库 PR 会自动提交更新。

比较时会包含源码 commit 与 commit 时间，以便 CI 在源码提交产生后刷新溯源信息；`Created-By` 等 jar 生成环境信息仍会忽略。

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

默认监听 `127.0.0.1:17900`。如果 `17900` 被占用，会向后扫描 100 个端口。实际地址会打印到 stderr：

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

启动时应先看到 `version` 和 `source commit` 两行。如果只看到 `listening`，通常说明游戏目录里的 `graphwar-agent.jar` 不是当前构建。

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

### 房间状态与准备控制

读取当前赛前房间：

Linux / macOS:

```shell
curl http://127.0.0.1:17900/room
```

Windows PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:17900/room
```

无论客户端处于哪个阶段，`GET /room` 都返回 `200`。只有客户端位于 `PRE_GAME` 房间时，`available` 才为 `true`：

```json
{
  "available": true,
  "gameState": 1,
  "gameMode": 0,
  "leader": false,
  "players": [
    {
      "index": 0,
      "id": 12,
      "name": "Player",
      "team": 1,
      "local": true,
      "computer": false,
      "ready": false,
      "numSoldiers": 2,
      "disconnected": false
    }
  ]
}
```

`leader` 表示本地客户端是否为房主。每个玩家包含当前列表 `index`、协议 `id`、`name`、`team`、归属状态（`local`）、准备状态、士兵数和连接状态。本地玩家的 `computer` 为 `true` 或 `false`；远端玩家则为 `null`，因为原版协议不会提供远端玩家是否由电脑控制。

不在 `PRE_GAME` 阶段时，响应改为 `available: false`，并附带稳定的 `reason`。此接口只覆盖当前赛前房间，不提供大厅房间列表、创建或加入房间、UI，也不提供服务端推送事件。需要新状态时请轮询 `GET /room`。它与其他接口一样，以仅监听本机作为安全边界，不额外添加令牌鉴权。

按原版准备按钮的行为，为所有本地玩家设置准备状态：

Linux / macOS:

```shell
curl -X POST \
  -H "Content-Type: text/plain; charset=utf-8" \
  --data-binary "true" \
  http://127.0.0.1:17900/ready
```

Windows PowerShell:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:17900/ready -ContentType "text/plain; charset=utf-8" -Body "true"
```

`POST /ready` 的请求体必须严格为小写 `true` 或 `false`，其他内容均返回 `400`。每次请求都会通过原版逻辑向所有本地玩家发送目标状态，即使本地观察到的状态已经相同也不会跳过。成功响应只表示命令已发送：

```json
{ "ok": true, "requestedReady": true }
```

服务端响应后，请轮询 `GET /room` 确认其报告的状态。不在 `PRE_GAME` 阶段或客户端没有本地玩家时，`POST /ready` 返回 `409`。

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

`POST /function` 的请求体就是 UTF-8 函数文本。这等价于在官方游戏的函数输入框里提交当前文本：

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

`view.pixel` 是当前客户端实际渲染方向的坐标。`terrainReversed` 为 `true` 时，Graphwar 绘制逻辑会镜像 x 坐标。

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

- Agent 不做 JVMTI。字节码补丁保持小范围。它们只处理已知的官方客户端边界问题。
- HTTP 服务只绑定 `127.0.0.1`。
- 读取 Graphwar 状态时使用反射，因为官方 jar 不作为本包的编译依赖。
- 原版客户端在构造首次同步的玩家时会丢弃 `ready` 值。初次同步后，`/room` 可能把远端玩家报告为未准备，直到服务端随后发送准备状态更新。
- 障碍规则来自官方 `Obstacle#collidePoint`：`terrain.getRGB(x, y) != -1` 即阻挡。
- 坐标换算来自官方 `GraphPlane#convertX` / `GraphPlane#convertY` 的反向公式。
