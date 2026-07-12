# graphwar-agent

English | [简体中文](./README.zh.md)

graphwar-agent is a local Java agent for the official Graphwar client.

It exposes pre-game room state and ready control, plus consistent match snapshots, obstacle data, and guarded shot submission, as a localhost-only HTTP API. It does this without modifying the official client.

## Why graphwar-agent

- **No official client modifications**: loaded with `-javaagent`; no unpacking or replacing the official jar.
- **No runtime dependencies**: the agent code depends only on the JDK, and the build scripts call only `javac` and `jar`.
- **Reads official state directly**: reads the current `GameData`, players, soldiers, and obstacle map from `Graphwar.Graphwar#getGameData()`.
- **Accurate obstacle detection**: reuses Graphwar's own collision rule, where every non-white terrain pixel is blocking.
- **Submits guarded shots through the original logic**: the HTTP endpoint validates an exact turn and battlefield revision before calling `GameData#setAngle(double)` when needed and `GameData#sendFunction(String)`.
- **Returns two coordinate spaces**: returns Graphwar's internal `world` coordinates and the current screen-oriented `view` coordinates, plus mathematical game coordinates.
- **Official-client compatibility**: silences expected exception noise. Fixes a failed-room-rejoin lockup and prevents invalid fade opacity from trapping the renderer in an exception loop.

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

Run the dependency-free API regression tests:

```shell
pnpm --filter graphwar-agent test
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

The comparison includes the source commit and commit time so CI can refresh provenance after the source commit exists. It ignores jar-generation metadata such as `Created-By`.

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

Active `/state` responses use API version 2 and include:

- `apiVersion`: currently `2`.
- `capabilities`: boolean `shot`, `room`, `ready`, and `worldObstacleMask` feature flags.
- `agent`: agent version, source commit, and commit time.
- `plane`: Graphwar plane dimensions and game-coordinate length.
- `available`: whether match state can currently be read.
- `gameInstanceId`: opaque ID that changes when the official client creates a new battlefield.
- `turnToken`: opaque ID for the exact current turn. It changes even if the same soldier and positions recur.
- `battleRevision`: SHA-256 revision of the game mode, current view orientation, player ownership/team state, soldier alive/render state and world positions, and world obstacle mask.
- `remainingTurnMs`: remaining turn time reported by `GameData#getRemainingTime()`.
- `drawingFunction`, `exploding`, and `phase`: resolution state. `phase` is `aiming`, `drawing`, `exploding`, or `inactive`.
- `terrainReversed`: whether the current client is rendering terrain in reverse.
- `gameState`, `gameMode`, `currentTurn`, and `currentTurnPlayerId`: current game state and shooter ownership.
- `players[]`: protocol `id` / `playerId`, list `index`, team, local/computer/ready/disconnected state, and current soldier index.
- `players[].soldiers[]`: `index` / `soldierIndex`, alive/render state, angle in radians, and `world` and `view` coordinates.
- `obstacleMask`: obstacle dimensions, URLs, and the revision/header used to verify a downloaded mask.

Outside an active match, `available` is `false`, and `reason` explains which piece of state is missing. API metadata remains present so callers can distinguish an unavailable match from an outdated agent.

### Room State and Ready Control

Read the current pre-game room:

Linux / macOS:

```shell
curl http://127.0.0.1:17900/room
```

Windows PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:17900/room
```

`GET /room` returns `200` in every client phase. `available` is `true` only while the client is in a `PRE_GAME` room:

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

`leader` reports whether the local client is the room leader. Each player has its current list `index`, protocol `id`, `name`, `team`, ownership (`local`), ready state, soldier count, and connection state. `computer` is `true` or `false` for a local player, but `null` for a remote player because the official protocol does not expose whether a remote player is computer-controlled.

Outside `PRE_GAME`, the response instead has `available: false` and a stable `reason`. This endpoint covers only the current pre-game room: it does not expose the lobby room list or provide room creation, joining, UI, or server-sent events. Poll `GET /room` when updated state is needed.

The loopback binding blocks remote hosts, but CORS and Private Network Access are intentionally open so browser pages can call the API. Any browser origin granted local-network access can therefore control the Agent; do not keep it running while browsing untrusted pages. The API does not add token authentication.

Set the ready state for every local player, using the same behavior as the official ready button:

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

The body for `POST /ready` must be exactly lowercase `true` or `false`; any other body returns `400`. Every request sends the requested state through the official logic for all local players, even when the locally observed state already matches. A successful response means the command was sent:

```json
{ "ok": true, "requestedReady": true }
```

Poll `GET /room` to confirm the state reported after the server responds. `POST /ready` returns `409` outside `PRE_GAME` or when the client has no local players.

Submit one guarded shot using values from the latest `/state` response:

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

`POST /shot` accepts exactly this JSON shape:

```json
{
  "function": "sin(x)",
  "turnToken": "opaque turn token",
  "battleRevision": "sha256:opaque battlefield revision",
  "angleRadians": 0.25
}
```

`function`, `turnToken`, and `battleRevision` are required. `angleRadians` is required only for second-derivative mode (`gameMode: 2`) and forbidden in normal and first-derivative modes (`gameMode: 0` and `1`). Angles must be finite radians in `[-pi/2, pi/2]`.

- Returns `200` with `{ "ok": true }` after the original calls have been queued.
- Returns `400` for malformed or unknown JSON fields, an invalid Graphwar function, or a mode/angle mismatch.
- Returns `409` when the token or revision is stale, the turn is not owned by a local human, the turn expired, a function is resolving, or the same turn token was already submitted.
- Returns `500` when the official client API cannot be reflected or invoked.

The agent claims the token before the first possible shot side effect. Do not retry a request whose response was lost: the same token is intentionally rejected. The former `POST /function` endpoint has been removed and returns `404`.

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

Every successful mask response includes:

```text
X-Graphwar-Battle-Revision: sha256:...
```

Compare this header with `/state.battleRevision` (also available as `/state.obstacleMask.revision`). If the values differ, state changed between the two requests; discard the mask and read a new snapshot. Browsers can read the header through CORS because the agent exposes it explicitly.

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
- `GraphPlane` float-alpha calls are clamped at the AWT boundary because Graphwar uses the non-monotonic wall clock for fade timers and otherwise retries an invalid opacity on every repaint.
- The HTTP server binds only to `127.0.0.1`.
- Graphwar state is read through reflection because the official jar is not a compile-time dependency of this package.
- Active state and obstacle data are copied while holding the same `GameData` monitor used by official incoming-message handling. JSON serialization happens after the immutable copy is complete.
- `/shot` rechecks and claims its safety values while holding that monitor, then queues `SET_ANGLE` before `FIRE_FUNC` for second-derivative mode. Those remain two messages in the unmodified official protocol, so this is a local atomic guard rather than a server-side network transaction. Do not adjust the angle or fire through the official UI while managed mode is submitting a shot.
- The official client discards the initial `ready` value while constructing a synchronized player. After that initial sync, `/room` can report a remote player as not ready until the server sends a later ready-state update.
- The obstacle rule comes from the official `Obstacle#collidePoint`: `terrain.getRGB(x, y) != -1` means blocking.
- Coordinate conversion uses the inverse formulas of the official `GraphPlane#convertX` / `GraphPlane#convertY`.
