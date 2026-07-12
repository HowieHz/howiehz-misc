# Graphwar Agent

**English** | [简体中文](./README.zh.md)

Graphwar Agent is a local Java agent for the official Graphwar client. It provides accurate game state, obstacle data, pre-game ready controls, and guarded shot submission through a localhost-only HTTP API without modifying the official jar.

## Features

- Reads current match, player, soldier, and obstacle state directly from the client
- Returns screen-oriented, internal, and mathematical game coordinates
- Rejects stale shots with a turn token and battlefield revision
- Reads pre-game rooms and controls the ready state of local players
- Fixes an official-client room rejoin lockup and opacity rendering loop

The agent has no runtime dependency beyond the JDK. Its HTTP server binds only to `127.0.0.1`.

## Quick Start

1. [Download `graphwar-agent.jar`](../../docs/public/graphwar-agent.jar).
2. Place it next to `graphwar.jar`.
3. Start Graphwar with `-javaagent`:

Linux / macOS:

```shell
java -javaagent:graphwar-agent.jar -jar graphwar.jar
```

Windows PowerShell:

```powershell
java -javaagent:graphwar-agent.jar -jar graphwar.jar
```

The agent listens on `http://127.0.0.1:17900` by default. If that port is busy, it selects an available port from the next 100 and prints the address:

```text
[graphwar-agent] port 17900 unavailable; selected 17901
[graphwar-agent] listening on http://127.0.0.1:17901
```

To require a fixed port, append `=port=PORT` to the agent path:

```shell
java -javaagent:graphwar-agent.jar=port=17901 -jar graphwar.jar
```

The agent exits if an explicit port is unavailable. Startup logs should include `version` and `source commit`; seeing only `listening` usually means the jar is outdated.

> [!WARNING]
> Any browser page granted local-network access can control the API through CORS and Private Network Access, and the API has no token authentication. Stop the agent before browsing untrusted pages.

## HTTP API

The examples below use `http://127.0.0.1:17900`. Replace the port if the startup log shows another address.

`GET /health` returns plain-text `ok` when the Agent is running.

| Method | Path                         | Purpose                                  |
| ------ | ---------------------------- | ---------------------------------------- |
| `GET`  | `/health`                    | Check whether the agent is available     |
| `GET`  | `/state`                     | Read the current match snapshot          |
| `GET`  | `/room`                      | Read the current pre-game room           |
| `POST` | `/ready`                     | Set the ready state of all local players |
| `POST` | `/shot`                      | Validate and submit one shot             |
| `GET`  | `/obstacle-mask.bin?space=…` | Download view or world obstacle data     |

### Read Match State

```shell
curl http://127.0.0.1:17900/state
```

PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:17900/state
```

`/state` uses API version 2. Every response includes:

- `plane`: `width`, `height`, and mathematical `gameLength`
- `apiVersion`: currently `2`
- `capabilities`: boolean `shot`, `room`, `ready`, and `worldObstacleMask` flags
- `agent`: `version`, `sourceCommit`, `sourceCommitShort`, and `sourceCommitTime`
- `available`: whether an active match snapshot is available

When `available` is `false`, the response also includes `reason` and omits match fields. When it is `true`, the response includes:

- `gameInstanceId`: changes when the client creates a new battlefield
- `turnToken`: identifies the current player and soldier turn, or `null` when no current player exists
- `battleRevision`: SHA-256 revision of the mode, orientation, player ownership and teams, soldier state and positions, and world obstacles
- `remainingTurnMs`: remaining turn time in milliseconds
- `drawingFunction`, `exploding`, and `phase`: current shot state; `phase` is `aiming`, `drawing`, or `exploding`
- `terrainReversed`: whether the current client view reverses the terrain
- `gameState` and `gameMode`: `gameMode` is `0` for `y`, `1` for `y'`, or `2` for `y''`
- `currentTurn` and `currentTurnPlayerId`: list index and protocol ID of the current firing player, or `-1` when no current player is valid
- `players[]`: `index`, `playerId` / `id`, `team`, `name`, `local`, `computer`, `ready`, `disconnected`, `currentTurnSoldier` / `currentTurnSoldierIndex`, and `soldiers`
- `players[].soldiers[]`: `index` / `soldierIndex`, `alive`, `exploding`, `rendered`, `angle` in radians, and `world` / `view` coordinates
- `world` and `view`: each contains `pixel` and corresponding mathematical `game` coordinates with `x` and `y`
- `obstacleMask`: `available`, `width`, `height`, `blockedValue`, `emptyValue`, `defaultSpace`, `viewMirrored`, `revision`, `revisionHeader`, `viewUrl`, and `worldUrl`

### Room and Ready State

Read the current pre-game room:

```shell
curl http://127.0.0.1:17900/room
```

In every normal client phase, `GET /room` returns `200`. Outside a `PRE_GAME` room, it returns `available: false` with a stable `reason`. An available response includes `gameState`, `gameMode`, `leader`, and `players`. Each player contains `index`, `id`, `name`, `team`, `local`, `computer`, `ready`, `numSoldiers`, and `disconnected`. The endpoint returns `500` if the client API cannot be read.

`computer` is `null` for remote players because the original protocol does not expose that information. Initial synchronization can also omit a remote player's ready state, so that player may briefly appear not ready until the next server update.

This endpoint reads only the current room; it does not list, create, or join rooms and does not push updates. Request it again when fresh state is needed.

Set the ready state of all local players:

```shell
curl -X POST -H "Content-Type: text/plain; charset=utf-8" --data-binary "true" http://127.0.0.1:17900/ready
```

PowerShell:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:17900/ready -ContentType "text/plain; charset=utf-8" -Body "true"
```

The request body must be lowercase `true` or `false`; any other body returns `400`. Every request sends the requested state through the original client logic, even if the local state already matches.

A successful response contains `ok: true` and sets `requestedReady` to the submitted `true` or `false`. This means the command was sent; read `/room` again to confirm the reported state. The endpoint returns `409` outside a pre-game room or when no local player exists, and `500` if the client API cannot be called.

### Submit a Shot

Use the `turnToken` and `battleRevision` from the latest `/state` response:

```shell
curl -X POST \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary '{"function":"sin(x)","turnToken":"TURN_TOKEN","battleRevision":"sha256:REVISION"}' \
  http://127.0.0.1:17900/shot
```

Request shape:

```json
{
  "function": "sin(x)",
  "turnToken": "opaque turn token",
  "battleRevision": "sha256:opaque battlefield revision",
  "angleRadians": 0.25
}
```

`function`, `turnToken`, and `battleRevision` are required. `angleRadians` is required only in second-derivative mode (`gameMode: 2`) and forbidden in other modes. It must be a finite value in radians within `[-pi/2, pi/2]`.

| Status | Meaning                                                                                                                                              |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `200`  | The shot was queued and `{ "ok": true }` was returned                                                                                                |
| `400`  | The JSON, function, field set, or mode-specific parameters are invalid                                                                               |
| `409`  | State is stale, the current turn does not belong to a local human, time expired, a function is drawing or exploding, or a shot was already submitted |
| `500`  | The official client API could not be read or called                                                                                                  |

The agent claims the `turnToken` before the first possible shot side effect. Do not retry if the request was sent but its response was lost; the same token will be rejected.

In second-derivative mode, changing the angle and firing remain two messages in the original protocol. Do not adjust the angle or fire through the original UI while an automated shot is being submitted.

### Download Obstacle Data

Use `space=world` for Graphwar's internal orientation. Missing or any other `space` value uses the current `view` orientation:

```shell
curl -L -o obstacle-mask.bin "http://127.0.0.1:17900/obstacle-mask.bin?space=view"
curl -L -o obstacle-mask.world.bin "http://127.0.0.1:17900/obstacle-mask.bin?space=world"
```

PowerShell:

```powershell
Invoke-WebRequest http://127.0.0.1:17900/obstacle-mask.bin?space=view -OutFile obstacle-mask.bin
```

The response includes `X-Graphwar-Battle-Revision`, which is exposed to browsers through CORS. It must match `/state.battleRevision`; if it does not, state changed between requests, so discard the obstacle data and read a new snapshot.

Obstacle data is always `770 * 450` bytes and uses the index `y * 770 + x`. A value of `1` is blocking; `0` is empty.

The endpoint returns `409` when no active obstacle snapshot is available and `500` when the client state cannot be read.

## Coordinates

The Graphwar plane is `770 * 450` pixels, and its mathematical game-coordinate width is `50`.

- `world.pixel`: Graphwar's internal pixel coordinates
- `view.pixel`: pixel coordinates in the current client orientation
- `*.game`: mathematical game coordinates converted from the corresponding pixel coordinates

```text
gameX = (pixelX - 770 / 2) * 50 / 770
gameY = (450 / 2 - pixelY) * 50 / 770
```

When terrain is reversed, soldier centers use `viewX = 770 - worldX`, while obstacle cells use `viewX = 769 - worldX`.

## Development and Maintenance

Install JDK 17 or 21 and the Node.js and pnpm versions required by this repository. Run these commands from the repository root:

```shell
pnpm --filter graphwar-agent build
pnpm --filter graphwar-agent test
pnpm --filter graphwar-agent sync:public
pnpm --filter graphwar-agent clean
```

The build emits Java 8 bytecode at `packages/graphwar-agent/build/libs/graphwar-agent.jar`. `sync:public` copies it to `docs/public/graphwar-agent.jar`; CI verifies that the public jar matches the build.
