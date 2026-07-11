# graphwar-agent

[English](./README.md) | **简体中文**

graphwar-agent 是一个给官方 Graphwar 客户端使用的本地 Java Agent。

它不会修改官方客户端。它会把赛前房间状态与准备控制，以及当前对局的一致状态快照、障碍数据和带防误发校验的射击能力，暴露成只监听本机的 HTTP 接口。

## 为什么用 graphwar-agent

- **不改官方客户端**：通过 `-javaagent` 加载，不解包、不替换官方 jar。
- **无运行时依赖**：agent 代码只依赖 JDK，构建脚本也只调用 `javac` 和 `jar`。
- **直接读取官方状态**：从 `Graphwar.Graphwar#getGameData()` 读取当前 `GameData`、玩家、士兵和障碍图。
- **障碍判定精确**：复用 Graphwar 自己的判定规则，非白色 terrain 像素即阻挡。
- **射击走原版逻辑并防误发**：HTTP 接口先校验精确回合与战场 revision，需要时再调用 `GameData#setAngle(double)`，最后调用 `GameData#sendFunction(String)`。
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

可用的 `/state` 响应使用 API 版本 2，并返回：

- `apiVersion`：当前为 `2`。
- `capabilities`：布尔能力标记 `shot`、`room`、`ready` 与 `worldObstacleMask`。
- `agent`：agent 版本、源码 commit 和 commit 时间。
- `plane`：Graphwar 平面尺寸和游戏坐标长度。
- `available`：当前是否已经能读到对局状态。
- `gameInstanceId`：官方客户端创建新战场时变化的不透明 ID。
- `turnToken`：精确标识当前回合的不透明 ID；即使同一士兵和坐标再次出现也会变化。
- `battleRevision`：对游戏模式、当前视角方向、玩家归属/队伍、士兵存活/渲染状态与世界坐标、世界障碍 mask 计算出的 SHA-256 revision。
- `remainingTurnMs`：`GameData#getRemainingTime()` 报告的权威剩余回合毫秒数。
- `drawingFunction`、`exploding` 与 `phase`：结算状态；`phase` 为 `aiming`、`drawing`、`exploding` 或 `inactive`。
- `terrainReversed`：当前客户端是否反向渲染地形。
- `gameState`、`gameMode`、`currentTurn` 与 `currentTurnPlayerId`：当前游戏状态和发射方归属。
- `players[]`：协议 `id` / `playerId`、列表 `index`、队伍、本地/电脑/准备/断线状态和当前士兵索引。
- `players[].soldiers[]`：`index` / `soldierIndex`、存活/渲染状态、弧度角，以及 `world` 和 `view` 坐标。
- `obstacleMask`：障碍尺寸、下载地址，以及用于核对下载 mask 的 revision/header。

不在活跃对局中时，`available` 为 `false`，`reason` 会说明缺少哪部分状态。API 元数据仍会返回，调用方可以区分“暂无对局”和 Agent 版本过旧。

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

不在 `PRE_GAME` 阶段时，响应改为 `available: false`，并附带稳定的 `reason`。此接口只覆盖当前赛前房间，不提供大厅房间列表、创建或加入房间、UI，也不提供服务端推送事件。需要新状态时请轮询 `GET /room`。

仅监听回环地址可以阻止远端主机访问，但 Agent 会主动开放 CORS 与 Private Network Access，供浏览器页面调用。因此，任何获准访问本地网络的网页来源都能控制 Agent；浏览不受信任的页面时不要让 Agent 继续运行。API 不额外添加令牌鉴权。

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

使用最近一次 `/state` 的值提交一次带校验的射击：

Linux / macOS:

```shell
curl -X POST \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary '{"function":"sin(x)","turnToken":"TURN_TOKEN","battleRevision":"sha256:REVISION"}' \
  http://127.0.0.1:17900/shot
```

Windows PowerShell:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:17900/shot -ContentType "application/json; charset=utf-8" -Body '{"function":"sin(x)","turnToken":"TURN_TOKEN","battleRevision":"sha256:REVISION"}'
```

`POST /shot` 只接受以下 JSON 结构：

```json
{
  "function": "sin(x)",
  "turnToken": "不透明回合 token",
  "battleRevision": "sha256:不透明战场 revision",
  "angleRadians": 0.25
}
```

`function`、`turnToken` 和 `battleRevision` 必填。只有二阶微分模式（`gameMode: 2`）必须提供 `angleRadians`；普通与一阶微分模式（`gameMode: 0`、`1`）禁止提供。角度单位为弧度，必须是 `[-pi/2, pi/2]` 内的有限数。

- 原版调用成功排队后返回 `200` 与 `{ "ok": true }`。
- JSON 格式错误、存在未知字段、Graphwar 函数非法或模式/角度不匹配时返回 `400`。
- token/revision 已过期、当前不是本地真人玩家回合、回合已截止、函数正在结算，或同一回合 token 已提交时返回 `409`。
- 无法反射或调用官方客户端 API 时返回 `500`。

Agent 会在第一个可能产生射击副作用的操作前 claim token。如果响应丢失，请勿重试；同一 token 会被有意拒绝。原 `POST /function` 已删除并返回 `404`。

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

每个成功的 mask 响应都包含：

```text
X-Graphwar-Battle-Revision: sha256:...
```

必须将此 header 与 `/state.battleRevision`（也可从 `/state.obstacleMask.revision` 读取）比较。若不同，说明两次请求之间状态已变化，应丢弃 mask 并重新读取状态。Agent 已通过 CORS 显式暴露此 header，浏览器可以直接读取。

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
- 活跃状态与障碍数据会在持有官方入站消息同一把 `GameData` monitor 时复制；不可变副本完成后才在锁外生成 JSON。
- `/shot` 会在该 monitor 内复核并 claim 安全值；二阶微分模式依次排队 `SET_ANGLE` 与 `FIRE_FUNC`。原版协议仍把它们作为两条消息，因此这里保证的是本地原子校验，不是服务端网络事务。托管正在提交射击时，不要同时在原版 UI 中调整角度或开火。
- 原版客户端在构造首次同步的玩家时会丢弃 `ready` 值。初次同步后，`/room` 可能把远端玩家报告为未准备，直到服务端随后发送准备状态更新。
- 障碍规则来自官方 `Obstacle#collidePoint`：`terrain.getRGB(x, y) != -1` 即阻挡。
- 坐标换算来自官方 `GraphPlane#convertX` / `GraphPlane#convertY` 的反向公式。
