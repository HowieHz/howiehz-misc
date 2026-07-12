# Graphwar Agent

[English](./README.md) | **简体中文**

Graphwar Agent 是官方 Graphwar 客户端的本地 Java Agent。它通过仅监听本机的 HTTP API 提供准确的游戏状态、障碍数据、房间准备控制和带防误发校验的射击能力，不需要修改官方 jar。

## 主要功能

- 直接读取当前对局、玩家、士兵和障碍状态
- 返回屏幕方向、内部方向和数学游戏坐标
- 通过回合 token 与战场 revision 防止过期射击请求
- 读取赛前房间，并设置本地玩家的准备状态
- 修复官方客户端的房间重连卡死和透明度渲染异常

Agent 运行时只依赖 JDK，HTTP 服务只绑定 `127.0.0.1`。

## 快速开始

1. [下载 `graphwar-agent.jar`](../../docs/public/graphwar-agent.jar)。
2. 将它放到 `graphwar.jar` 旁边。
3. 使用 `-javaagent` 启动 Graphwar：

Linux / macOS：

```shell
java -javaagent:graphwar-agent.jar -jar graphwar.jar
```

Windows PowerShell:

```powershell
java -javaagent:graphwar-agent.jar -jar graphwar.jar
```

Agent 默认监听 `http://127.0.0.1:17900`。端口被占用时会在后续 100 个端口中选择可用端口，并打印实际地址：

```text
[graphwar-agent] port 17900 unavailable; selected 17901
[graphwar-agent] listening on http://127.0.0.1:17901
```

需要固定端口时，在 Agent 路径后添加 `=port=端口号`：

```shell
java -javaagent:graphwar-agent.jar=port=17901 -jar graphwar.jar
```

显式端口不可用时，Agent 会直接启动失败。启动日志应包含 `version` 和 `source commit`；如果只有 `listening`，通常说明使用了旧版 jar。

> [!WARNING]
> Agent 允许浏览器页面通过 CORS 和 Private Network Access 访问本机 API，且不提供令牌鉴权。浏览不受信任的页面时，请关闭 Agent。

## HTTP API

以下示例使用默认地址 `http://127.0.0.1:17900`。如果日志显示了其他端口，请替换示例中的端口。

Agent 正常运行时，`GET /health` 返回纯文本 `ok`。

| 方法   | 路径                         | 用途                         |
| ------ | ---------------------------- | ---------------------------- |
| `GET`  | `/health`                    | 检查 Agent 是否可用          |
| `GET`  | `/state`                     | 读取当前对局快照             |
| `GET`  | `/room`                      | 读取当前赛前房间             |
| `POST` | `/ready`                     | 设置所有本地玩家的准备状态   |
| `POST` | `/shot`                      | 校验并提交一次射击           |
| `GET`  | `/obstacle-mask.bin?space=…` | 下载屏幕或内部方向的障碍数据 |

### 读取对局状态

```shell
curl http://127.0.0.1:17900/state
```

PowerShell：

```powershell
Invoke-RestMethod http://127.0.0.1:17900/state
```

`/state` 使用 API 版本 2。所有响应都包含：

- `plane`：`width`、`height` 和数学游戏坐标宽度 `gameLength`
- `apiVersion`：当前为 `2`
- `capabilities`：布尔能力标记 `shot`、`room`、`ready` 和 `worldObstacleMask`
- `agent`：`version`、`sourceCommit`、`sourceCommitShort` 和 `sourceCommitTime`
- `available`：当前是否有可用的活跃对局快照

`available` 为 `false` 时，响应还会包含 `reason`，并省略对局字段。`available` 为 `true` 时，响应包含：

- `gameInstanceId`：客户端创建新战场时变化
- `turnToken`：标识当前玩家和士兵回合；没有当前玩家时为 `null`
- `battleRevision`：当前模式、方向、玩家归属和队伍、士兵状态和位置，以及内部障碍的 SHA-256 revision
- `remainingTurnMs`：当前回合剩余毫秒数
- `drawingFunction`、`exploding` 和 `phase`：当前射击状态；`phase` 为 `aiming`、`drawing` 或 `exploding`
- `terrainReversed`：当前客户端是否反向显示地形
- `gameState` 和 `gameMode`：`gameMode` 的 `0`、`1`、`2` 分别对应 `y`、`y'`、`y''`
- `currentTurn` 和 `currentTurnPlayerId`：当前发射玩家的列表索引和协议 ID；没有有效当前玩家时为 `-1`
- `players[]`：`index`、`playerId` / `id`、`team`、`name`、`local`、`computer`、`ready`、`disconnected`、`currentTurnSoldier` / `currentTurnSoldierIndex` 和 `soldiers`
- `players[].soldiers[]`：`index` / `soldierIndex`、`alive`、`exploding`、`rendered`、弧度制 `angle`，以及 `world` / `view` 坐标
- `world` 和 `view`：各自包含 `pixel` 和对应的数学 `game` 坐标，坐标内含 `x`、`y`
- `obstacleMask`：`available`、`width`、`height`、`blockedValue`、`emptyValue`、`defaultSpace`、`viewMirrored`、`revision`、`revisionHeader`、`viewUrl` 和 `worldUrl`

### 房间与准备状态

读取当前赛前房间：

```shell
curl http://127.0.0.1:17900/room
```

在所有正常客户端阶段，`GET /room` 都返回 `200`。不在 `PRE_GAME` 房间时，响应包含 `available: false` 和稳定的 `reason`。可用响应包含 `gameState`、`gameMode`、`leader` 和 `players`；每名玩家包含 `index`、`id`、`name`、`team`、`local`、`computer`、`ready`、`numSoldiers` 和 `disconnected`。无法读取客户端 API 时返回 `500`。

远端玩家的 `computer` 为 `null`，因为原版协议不提供该信息。首次同步也可能遗漏远端玩家的准备状态；服务端下次更新前，该玩家可能会短暂显示为未准备。

此接口只读取当前房间，不提供大厅列表、创建或加入房间，也不主动推送更新；需要新状态时请再次请求。

设置所有本地玩家的准备状态：

```shell
curl -X POST -H "Content-Type: text/plain; charset=utf-8" --data-binary "true" http://127.0.0.1:17900/ready
```

PowerShell：

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:17900/ready -ContentType "text/plain; charset=utf-8" -Body "true"
```

请求体必须是小写 `true` 或 `false`，其他内容返回 `400`。即使当前本地状态已经相同，每次请求仍会通过原版逻辑发送目标状态。

成功响应包含 `ok: true`，并将 `requestedReady` 设为提交的 `true` 或 `false`。这只表示命令已经发送，请重新读取 `/room` 确认状态。不在赛前房间或没有本地玩家时返回 `409`；无法调用客户端 API 时返回 `500`。

### 提交射击

使用最近一次 `/state` 返回的 `turnToken` 和 `battleRevision`：

```shell
curl -X POST \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary '{"function":"sin(x)","turnToken":"TURN_TOKEN","battleRevision":"sha256:REVISION"}' \
  http://127.0.0.1:17900/shot
```

请求结构：

```json
{
  "function": "sin(x)",
  "turnToken": "不透明回合 token",
  "battleRevision": "sha256:不透明战场 revision",
  "angleRadians": 0.25
}
```

`function`、`turnToken` 和 `battleRevision` 必填。只有二阶微分模式（`gameMode: 2`）需要 `angleRadians`；其他模式禁止提供。角度必须是 `[-pi/2, pi/2]` 内的有限弧度值。

| 状态码 | 含义                                                                       |
| ------ | -------------------------------------------------------------------------- |
| `200`  | 射击已排队，并返回 `{ "ok": true }`                                        |
| `400`  | JSON、函数、字段或模式参数无效                                             |
| `409`  | 状态已过期、不是本地真人回合、回合已截止、正在结算，或该回合已经提交过射击 |
| `500`  | 无法读取或调用官方客户端 API                                               |

Agent 会在首次可能产生射击副作用前占用该 `turnToken`。请求已经发出但响应丢失时不要重试，同一 token 会被拒绝。

二阶微分模式下，调整角度和发射仍是原版协议中的两条消息。自动射击正在提交时，不要同时在原版界面调整角度或开火。

### 下载障碍数据

Graphwar 内部方向使用 `space=world`。省略 `space` 或使用其他值时，返回当前屏幕的 `view` 方向：

```shell
curl -L -o obstacle-mask.bin "http://127.0.0.1:17900/obstacle-mask.bin?space=view"
curl -L -o obstacle-mask.world.bin "http://127.0.0.1:17900/obstacle-mask.bin?space=world"
```

PowerShell：

```powershell
Invoke-WebRequest http://127.0.0.1:17900/obstacle-mask.bin?space=view -OutFile obstacle-mask.bin
```

响应包含 `X-Graphwar-Battle-Revision`，浏览器可以通过 CORS 读取。它必须与 `/state.battleRevision` 一致；不同表示两次请求之间状态发生了变化，应丢弃障碍数据并重新读取。

障碍数据固定为 `770 * 450` 字节，索引是 `y * 770 + x`。值 `1` 表示阻挡，`0` 表示空白。

没有可用的活跃对局或障碍快照时返回 `409`；无法读取客户端状态时返回 `500`。

## 坐标

Graphwar 平面尺寸为 `770 * 450`，数学游戏坐标的宽度为 `50`。

- `world.pixel`：Graphwar 内部像素坐标
- `view.pixel`：当前客户端实际显示方向的像素坐标
- `*.game`：与对应 pixel 坐标换算出的数学游戏坐标

```text
gameX = (pixelX - 770 / 2) * 50 / 770
gameY = (450 / 2 - pixelY) * 50 / 770
```

地形反向显示时，士兵中心使用 `viewX = 770 - worldX`，障碍像素格使用 `viewX = 769 - worldX`。

## 开发与维护

需要 JDK 17 或 21，以及仓库要求的 Node.js 和 pnpm。在仓库根目录运行：

```shell
pnpm --filter graphwar-agent build
pnpm --filter graphwar-agent test
pnpm --filter graphwar-agent sync:public
pnpm --filter graphwar-agent clean
```

构建会生成 Java 8 字节码，产物位于 `packages/graphwar-agent/build/libs/graphwar-agent.jar`。`sync:public` 将它同步到 `docs/public/graphwar-agent.jar`，CI 会检查公开 jar 是否与构建结果一致。
