# graphwar-agent

English | [简体中文](./README.zh.md)

graphwar-agent is a local Java agent for the official Graphwar client.

It exposes soldier coordinates, obstacle data, and function submission for the match currently rendered by the client as a localhost-only HTTP API. It does this without modifying the official client.

## Why graphwar-agent

- **No official client modifications**: loaded with `-javaagent`; no unpacking or replacing the official jar.
- **No runtime dependencies**: the agent code depends only on the JDK, and the build scripts call only `javac` and `jar`.
- **Reads official state directly**: reads the current `GameData`, players, soldiers, and obstacle map from `Graphwar.Graphwar#getGameData()`.
- **Accurate obstacle detection**: reuses Graphwar's own collision rule, where every non-white terrain pixel is blocking.
- **Submits functions through the original logic**: the HTTP endpoint ultimately calls `GameData#sendFunction(String)`. That reuses the original turn checks, function validation, and firing message.
- **Returns two coordinate spaces**: returns Graphwar's internal `world` coordinates and the current screen-oriented `view` coordinates, plus mathematical game coordinates.
- **Official-client compatibility**: silences expected exception noise. Fixes one official client bug: after a room kick, a failed rejoin can leave the lobby stuck.

## Build

First make sure the JDK tools are available on your `PATH`:

```shell
java -version
javac -version
jar --version
```

JDK 17 or 21 is recommended. The build emits Java 8 bytecode.

Run this from the repository root:

```shell
pnpm --filter graphwar-agent build
```

The built jar is written to:

```text
packages/graphwar-agent/build/libs/graphwar-agent.jar
```

Sync the jar used for docs-site downloads:

```shell
pnpm --filter graphwar-agent sync:public
```

CI runs this sync automatically as part of the graphwar-agent build flow. If `docs/public/graphwar-agent.jar` is missing or its effective contents differ, PRs from this repository will automatically commit the update.

The comparison ignores build metadata such as the source commit, commit time, and jar generation environment.

Clean build artifacts:

```shell
pnpm --filter graphwar-agent clean
```

## Usage

Add `-javaagent` when starting the official Graphwar client:

Linux / macOS:

```shell
java -javaagent:packages/graphwar-agent/build/libs/graphwar-agent.jar -jar path/to/graphwar.jar
```

Windows PowerShell:

```powershell
java -javaagent:packages/graphwar-agent/build/libs/graphwar-agent.jar -jar path\to\graphwar.jar
```

By default, the agent listens on `127.0.0.1:17900`. If `17900` is already in use, it scans the next 100 ports. It prints the selected address to stderr:

```text
[graphwar-agent] version 0.0.0
[graphwar-agent] source commit 000000000000 (2026-01-01T00:00:00+00:00)
[graphwar-agent] port 17900 unavailable; selected 17901
[graphwar-agent] listening on http://127.0.0.1:17901
```

If a caller requires a fixed port, specify it explicitly:

Linux / macOS:

```shell
java -javaagent:packages/graphwar-agent/build/libs/graphwar-agent.jar=port=17901 -jar path/to/graphwar.jar
```

Windows PowerShell:

```powershell
java -javaagent:packages/graphwar-agent/build/libs/graphwar-agent.jar=port=17901 -jar path\to\graphwar.jar
```

An explicit port uses strict mode: startup fails if the port is unavailable, and the agent will not switch ports automatically.

On startup, you should see the `version` and `source commit` lines first. If you only see `listening`, the `graphwar-agent.jar` in the game directory is usually outdated.

## Reading State

Health check:

Linux / macOS:

```shell
curl http://127.0.0.1:17900/health
```

Windows PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:17900/health
```

Read the current state:

Linux / macOS:

```shell
curl http://127.0.0.1:17900/state
```

Windows PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:17900/state
```

`/state` returns:

- `agent`: agent version, source commit, and commit time.
- `plane`: Graphwar plane dimensions and game-coordinate length.
- `available`: whether match state can currently be read.
- `terrainReversed`: whether the current client is rendering terrain in reverse.
- `gameState`, `gameMode`, `currentTurn`: current game state.
- `players[].soldiers[]`: each soldier's alive state, angle, `world` coordinates, and `view` coordinates.
- `obstacleMask`: obstacle data dimensions, values, and download URL.

Before a match starts, `available` is `false`, and `reason` explains which piece of state is missing.

Submit a function:

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

The request body for `POST /function` is the UTF-8 function text. This is equivalent to submitting the current text in the official game's function input box:

- Returns `409` if it is not the local player's turn, the match has not started, or a function is currently being drawn.
- Returns `400` if the function is empty or cannot be parsed by Graphwar's official `Function`.
- Second-derivative mode uses the current soldier angle from the game. Angle adjustment still uses the official client's own key handling.

Download obstacle data in the current screen orientation:

Linux / macOS:

```shell
curl -L -o obstacle-mask.bin "http://127.0.0.1:17900/obstacle-mask.bin?space=view"
```

Windows PowerShell:

```powershell
Invoke-WebRequest http://127.0.0.1:17900/obstacle-mask.bin?space=view -OutFile obstacle-mask.bin
```

Download obstacle data in Graphwar's internal orientation:

Linux / macOS:

```shell
curl -L -o obstacle-mask.world.bin "http://127.0.0.1:17900/obstacle-mask.bin?space=world"
```

Windows PowerShell:

```powershell
Invoke-WebRequest http://127.0.0.1:17900/obstacle-mask.bin?space=world -OutFile obstacle-mask.world.bin
```

Obstacle data format:

- Size: `770 * 450` bytes.
- Index: `y * 770 + x`.
- Value `1`: blocking.
- Value `0`: empty.

## Coordinates

Graphwar's internal plane dimensions come from the official `GraphServer.Constants`:

```text
PLANE_LENGTH = 770
PLANE_HEIGHT = 450
PLANE_GAME_LENGTH = 50
```

`world.pixel` is Graphwar's internal 770x450 coordinate space.

`view.pixel` is the coordinate space for the current client rendering orientation. When `terrainReversed` is `true`, Graphwar's drawing logic mirrors the x coordinate.

`*.game` is the mathematical game coordinate converted from the adjacent pixel coordinate:

```text
gameX = (pixelX - 770 / 2) * 50 / 770
gameY = (450 / 2 - pixelY) * 50 / 770
```

Soldier center points follow `GraphPlane` drawing logic:

```text
viewX = 770 - worldX
```

Obstacle data is mirrored by pixel cell:

```text
viewX = 769 - worldX
```

## Implementation Notes

- The agent does not use JVMTI. Bytecode patches stay narrow. They only handle known official-client edge cases.
- The HTTP server binds only to `127.0.0.1`.
- Graphwar state is read through reflection because the official jar is not a compile-time dependency of this package.
- The obstacle rule comes from the official `Obstacle#collidePoint`: `terrain.getRGB(x, y) != -1` means blocking.
- Coordinate conversion uses the inverse formulas of the official `GraphPlane#convertX` / `GraphPlane#convertY`.
