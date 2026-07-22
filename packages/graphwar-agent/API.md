# Graphwar Agent HTTP API v3

This document is the normative specification for Graphwar Agent API v3. The companion [OpenAPI document](./openapi.yaml) describes the HTTP and JSON shapes. If the two documents conflict, this document takes precedence.

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119 and RFC 8174 when, and only when, they appear in all capitals.

The current API version is v3. A v3 implementation MUST NOT silently expose the removed `/shot`, `/ready`, or `/obstacle-mask.bin` v2 behavior under those paths.

## 1. Scope and endpoint summary

The reference Agent exposes one API version at a time on a loopback HTTP server:

| Method | Path                        | Purpose                                                   |
| ------ | --------------------------- | --------------------------------------------------------- |
| `GET`  | `/health`                   | Read API, authentication, build, and limit information    |
| `GET`  | `/state`                    | Read an active-match snapshot                             |
| `GET`  | `/room`                     | Read a pre-game-room snapshot                             |
| `PUT`  | `/room/ready`               | Set the target ready state of every local player          |
| `POST` | `/shots`                    | Create a shot command or return the matching existing one |
| `GET`  | `/shots/{requestId}`        | Read one retained shot command                            |
| `GET`  | `/obstacle-masks/world.bin` | Read the world-oriented obstacle mask                     |
| `GET`  | `/obstacle-masks/view.bin`  | Read the current-view-oriented obstacle mask              |

There is no command-list endpoint. Clients MUST retain their own `requestId` and SHOULD use `/state.shotCommand` to recover the current turn after a page reload or lost local state.

## 2. Transport and common behavior

- The reference implementation MUST bind only to `127.0.0.1`.
- JSON request and response bodies MUST use UTF-8.
- JSON responses use `Content-Type: application/json; charset=utf-8`.
- Obstacle responses use `Content-Type: application/octet-stream`.
- Responses MUST include `Cache-Control: no-store`.
- Request bodies for `POST /shots` and `PUT /room/ready` MUST include a valid, nonnegative decimal `Content-Length`.
- The reference server does not read or allocate request bodies for other method and path combinations; authentication and routing still determine their normal response.
- Chunked or any other `Transfer-Encoding` is unsupported and MUST be rejected.
- `POST /shots` and `PUT /room/ready` MUST use the exact `application/json` media type; parameters such as
  `charset=utf-8` MAY follow it, but prefix lookalikes such as `application/jsonp` MUST be rejected.
- Unknown JSON fields and duplicate JSON fields MUST be rejected for the two request objects.
- Clients MUST treat connection failure, connection closure, and timeout as transport failures rather than attempting to parse them as API errors.

The reference server supports HTTP/1.x requests, closes every response connection, and applies a five-second socket read timeout. Replicas MAY use a different HTTP stack, but MUST preserve the observable API semantics in this document.

### 2.1 CORS and Private Network Access

The reference server returns:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, If-Match
Access-Control-Expose-Headers: ETag, Location, Retry-After
Access-Control-Allow-Private-Network: true
```

An `OPTIONS` request MUST return `204 No Content` before authentication. Browser clients SHOULD still handle user-agent permission prompts and Private Network Access policy failures as transport failures.

### 2.2 Optional bearer authentication

Authentication is disabled by default. Deployments support three startup modes:

| Startup setting   | Behavior                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| no `token` option | Authentication is disabled                                                                             |
| `token=auto`      | Generate a 256-bit token with `SecureRandom`, encode it as unpadded base64url, and print it at startup |
| `token=VALUE`     | Use and print 1–4096 visible ASCII characters excluding comma                                          |

When authentication is enabled, every endpoint except `/health` and preflight `OPTIONS` MUST require:

```http
Authorization: Bearer TOKEN
```

Missing or incorrect credentials return `401 authentication-required` and a `WWW-Authenticate: Bearer` header.
The reference server enforces the fixed header-size limit and checks authentication before reading or allocating the request body.
Implementations SHOULD compare credentials without data-dependent early exit. Invalid explicit token syntax fails Agent startup.
Tokens MUST NOT be placed in URLs and are not persisted by the reference Agent.

Because the API permits wildcard browser origins and local network access, operators who leave authentication disabled SHOULD stop the Agent before browsing untrusted pages.

### 2.3 JSON error envelope

HTTP-layer failures use this shape:

```json
{
  "error": {
    "code": "request-id-conflict",
    "message": "The request ID is already associated with different shot content"
  }
}
```

Clients MUST make decisions from `error.code`, not `error.message`. Messages are diagnostic text and MAY change. A command that was successfully created but finished as `failed` or `unknown` is a normal shot-command resource, not an HTTP error; see section 6.

Common stable HTTP error codes are:

| HTTP status | Code                        | Meaning                                                                                          |
| ----------: | --------------------------- | ------------------------------------------------------------------------------------------------ |
|       `400` | `bad-request`               | Invalid request line, headers, `Content-Length`, target, UTF-8, or unsupported transfer encoding |
|       `400` | `invalid-ready-request`     | Invalid ready JSON                                                                               |
|       `400` | `invalid-shot-request`      | Invalid shot JSON or request field set                                                           |
|       `400` | `invalid-request-id`        | Non-canonical shot resource ID in the path                                                       |
|       `401` | `authentication-required`   | Missing or incorrect bearer token                                                                |
|       `404` | `route-not-found`           | No route exists at the requested path                                                            |
|       `404` | `shot-command-not-found`    | The requested command is unknown or was removed from stored history                              |
|       `405` | `method-not-allowed`        | The path exists but does not accept the method                                                   |
|       `409` | `request-id-conflict`       | A retained ID is associated with different shot content                                          |
|       `409` | `room-unavailable`          | Ready state cannot be changed in the current client state                                        |
|       `409` | `obstacle-mask-unavailable` | No active obstacle snapshot is available                                                         |
|       `411` | `content-length-required`   | A JSON request endpoint omitted `Content-Length`                                                 |
|       `412` | `battle-revision-changed`   | `If-Match` does not match the current obstacle revision                                          |
|       `413` | `request-body-too-large`    | The body exceeds the configured byte limit                                                       |
|       `415` | `unsupported-media-type`    | A JSON endpoint did not receive `application/json`                                               |
|       `428` | `if-match-required`         | An obstacle request omitted `If-Match`                                                           |
|       `431` | `request-headers-too-large` | Request headers exceed the configured byte limit                                                 |
|       `500` | `internal-error`            | The official client or Agent failed unexpectedly                                                 |
|       `503` | `server-busy`               | All Graphwar-dependent HTTP request slots are occupied                                           |

A `405` response MUST include `Allow`. Successfully parsed API errors MUST use the JSON envelope, but a server overloaded before it can accept or parse a request MAY close the transport without an API response.

## 3. Health and deployment limits

`GET /health` is always unauthenticated and returns:

```json
{
  "apiVersion": 3,
  "isAuthenticationRequired": false,
  "limits": {
    "maxRequestHeaderBytes": 8192,
    "maxRequestBodyBytes": 65536,
    "maxFunctionBytes": 16384,
    "maxFunctionNestingDepth": 256
  },
  "agent": {
    "version": "2.0.0",
    "sourceCommit": "0123456789abcdef0123456789abcdef01234567",
    "sourceCommitShort": "0123456789ab",
    "sourceCommitTime": "2026-01-01T00:00:00+00:00"
  }
}
```

Clients MUST verify `apiVersion === 3` before using protected endpoints. `agent` values are build information for diagnostics; source archives without Git metadata MAY report `unknown`.

### 3.1 Limits

The reference implementation applies these limits before invoking the official parser:

| Limit                     |         Default | Configurable range | Notes                                                                    |
| ------------------------- | --------------: | -----------------: | ------------------------------------------------------------------------ |
| `maxRequestHeaderBytes`   |          `8192` |   `8192`–`1048576` | Maximum request-header bytes, including the terminating empty line       |
| `maxRequestBodyBytes`     |         `65536` |  `1024`–`16777216` | Maximum JSON data accepted in one API request; checked before allocation |
| `maxFunctionBytes`        |         `16384` |      `1`–`1048576` | UTF-8 bytes after JSON decoding; capped to the effective body limit      |
| `maxFunctionNestingDepth` |           `256` |         `1`–`4096` | Maximum open-parenthesis depth from an iterative scan                    |
| Stored shot commands      |    `50` records |              fixed | Old safe records are removed when space is needed                        |
| Synchronous shot wait     |       `5000` ms |              fixed | Does not cancel the official call                                        |
| Shot worker stack hint    | `2097152` bytes |              fixed | A JVM/platform hint, not a guaranteed exact stack size                   |
| Graphwar HTTP slots       |             `6` |              fixed | Leaves two of eight workers available for health and command reads       |

The configurable startup names are the names returned by `/health.limits`. Invalid or out-of-range numeric options are ignored by the reference implementation. The effective `maxFunctionBytes` MUST NOT exceed `maxRequestBodyBytes`.

Graphwar itself defines no formula-length limit, and its original parser recursively rebuilds expression trees.
The defaults above are conservative engineering limits selected after local JDK 21 stress checks of the
original parser using flat operations, parenthesis nesting, unary nesting, dense tokens, and encoded network
payloads. They are not claims about a natural Graphwar protocol maximum. The original source under
`tmp/graphwar` is design evidence only and MUST NOT become a runtime, build, or conformance-test dependency.

Replicas MUST reject inputs outside the advertised effective limits before invoking recursive official code. The nesting precheck MUST be iterative or otherwise independently bounded. Raising the limits increases parser, stack, and memory risk; no unlimited mode exists.

## 4. Match state

`GET /state` returns `200` for both available and normally unavailable client states. It returns `500 internal-error` only when the Agent cannot copy or serialize the client state safely.

Every response contains:

- `plane`: fixed geometry (`width: 770`, `height: 450`, `gameLength: 50.0`)
- `apiVersion: 3`
- static `capabilities`
- `agent` build information
- `observedAtEpochMs`: Unix epoch milliseconds when the Agent formed the state snapshot
- `isAvailable`

Static capabilities describe implemented protocol features; they do not describe momentary game state:

```json
{
  "canSubmitShots": true,
  "canReadRoom": true,
  "canSetReady": true,
  "canReadWorldObstacleMask": true
}
```

Clients MUST NOT interpret `capabilities.canSubmitShots` as permission to submit now. Available state separately exposes dynamic `canAcceptShotCommands`.

### 4.1 Unavailable state

```json
{
  "plane": { "width": 770, "height": 450, "gameLength": 50.0 },
  "apiVersion": 3,
  "capabilities": {
    "canSubmitShots": true,
    "canReadRoom": true,
    "canSetReady": true,
    "canReadWorldObstacleMask": true
  },
  "agent": {
    "version": "2.0.0",
    "sourceCommit": "unknown",
    "sourceCommitShort": "unknown",
    "sourceCommitTime": "unknown"
  },
  "observedAtEpochMs": 1735689600000,
  "isAvailable": false,
  "reason": "game-not-started"
}
```

Stable unavailable reasons are:

- `graphwar-window-not-found`
- `game-data-not-initialized`
- `game-not-started`

Match-only fields MUST be omitted when `isAvailable` is false.

### 4.2 Available state

An available response adds:

```json
{
  "isAvailable": true,
  "gameInstanceId": "550e8400-e29b-41d4-a716-446655440000",
  "turnToken": "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
  "battleRevision": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "remainingTurnMs": 42000,
  "phase": "aiming",
  "isTerrainReversed": false,
  "equationMode": "y",
  "currentPlayerIndex": 0,
  "currentPlayerId": 7,
  "canAcceptShotCommands": true,
  "shotCommand": null,
  "obstacleMask": {
    "width": 770,
    "height": 450,
    "blockedValue": 1,
    "emptyValue": 0,
    "isViewMirrored": false,
    "revision": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "viewUrl": "/obstacle-masks/view.bin",
    "worldUrl": "/obstacle-masks/world.bin"
  },
  "players": []
}
```

- `gameInstanceId` changes when the Agent observes a different `GameData` or obstacle identity.
- `observedAtEpochMs` is the Agent wall-clock time, in Unix epoch milliseconds, when this `/state` snapshot was formed. Clients can combine it with `remainingTurnMs` to remove response age before anchoring a local monotonic countdown.
- `turnToken` changes with the official turn marker, player ID, or soldier index. It is `null` when no current player is valid.
- `battleRevision` is a lowercase SHA-256 revision over pathfinding-relevant state: equation mode, orientation, player ownership/team/connectivity, soldier life/explosion/position, and the world obstacle mask. Turn cursors and angles are intentionally excluded.
- `phase` is `aiming`, `drawing`, or `exploding`.
- `equationMode` is `y`, `dy`, or `ddy`.
- Missing current player IDs and indexes use `null`, never negative sentinels.
- `canAcceptShotCommands` is false while the single shot execution slot is occupied. It says nothing about token freshness, turn ownership, remaining time, or formula validity.
- `shotCommand` is `null` or the retained non-failed command for this exact game instance and turn token:

```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "claimed"
}
```

The summary status is one of `validating`, `claimed`, `submitted`, or `unknown`. Full details remain available from `/shots/{requestId}` while the record is retained.

### 4.3 Players, soldiers, and coordinates

An active player has this shape:

```json
{
  "playerIndex": 0,
  "playerId": 7,
  "team": 1,
  "name": "Player",
  "isLocal": true,
  "isComputerControlled": false,
  "isReady": true,
  "isConnected": true,
  "currentSoldierIndex": 0,
  "soldiers": []
}
```

`playerIndex` and `soldierIndex` are positions in the current arrays. `playerId` is the Graphwar protocol identity. A missing current soldier uses `null`.

A soldier contains:

```json
{
  "soldierIndex": 0,
  "isAlive": true,
  "isRendered": true,
  "angleRadians": 0.0,
  "world": {
    "pixel": { "x": 385, "y": 225 },
    "game": { "x": 0.0, "y": 0.0 }
  },
  "view": {
    "pixel": { "x": 385, "y": 225 },
    "game": { "x": 0.0, "y": 0.0 }
  }
}
```

`isRendered` remains true for an exploding soldier even after `isAlive` becomes false. The coordinate conversion is:

```text
gameX = (pixelX - 770 / 2) * 50 / 770
gameY = (450 / 2 - pixelY) * 50 / 770
```

When terrain is reversed, soldier point coordinates use `viewX = 770 - worldX`; mask cells use `viewX = 769 - worldX`.

## 5. Room and ready state

### 5.1 Read the room

`GET /room` returns `200` for both available and normally unavailable room states.

Unavailable response:

```json
{
  "isAvailable": false,
  "reason": "not-in-pre-game-room"
}
```

Stable reasons are `graphwar-window-not-found`, `game-data-not-initialized`, and `not-in-pre-game-room`.

Available response:

```json
{
  "isAvailable": true,
  "equationMode": "y",
  "isLeader": true,
  "players": [
    {
      "playerIndex": 0,
      "playerId": 7,
      "name": "Player",
      "team": 1,
      "isLocal": true,
      "isComputerControlled": false,
      "isReady": true,
      "numSoldiers": 5,
      "isConnected": true
    }
  ]
}
```

For a remote room player, `isComputerControlled` is `null` because the original protocol does not expose the runtime subtype. The endpoint is a snapshot; it does not list, create, join, or subscribe to rooms.

### 5.2 Set ready state

`PUT /room/ready` accepts exactly:

```json
{
  "isReady": true
}
```

It sets the target state for every local player using the original client method and returns:

```json
{
  "isReady": true
}
```

The operation can be repeated safely: players already in the requested state MUST NOT receive a duplicate ready update. The response confirms the requested target, not server synchronization; clients SHOULD read `/room` again to observe the resulting room snapshot.

Outside a pre-game room, or when no local player exists, the endpoint returns `409 room-unavailable`.

## 6. Shot command resources

Each shot submission creates a command that clients can query later. The Agent stores at most 50 command records. Repeating the same retained request ID and content returns the existing command without calling Graphwar again. This tells clients only how the Agent handled the request; Graphwar itself does not confirm execution with the request ID.

### 6.1 Create or replay a command

`POST /shots` accepts:

```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "gameInstanceId": "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
  "function": "sin(x)",
  "turnToken": "6ba7b811-9dad-41d1-80b4-00c04fd430c8",
  "battleRevision": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "angleRadians": 0.25
}
```

Rules:

- `requestId` and `gameInstanceId` MUST be canonical lowercase UUID strings.
- Clients SHOULD generate each request ID with `crypto.randomUUID()` or an equivalently secure UUID generator and MUST NOT deliberately reuse it for different content.
- `turnToken` MUST be the canonical lowercase UUID copied from one available state snapshot.
- `battleRevision` MUST match `sha256:` followed by 64 lowercase hexadecimal digits and MUST be copied from the
  same state snapshot. These fixed shapes keep the memory used by all 50 stored command records predictable.
- `function` MUST be present as a JSON string. An empty or semantically invalid function establishes a `failed`
  command rather than an HTTP parsing error.
- Every decoded string MUST contain valid Unicode scalar values; unpaired UTF-16 surrogates are rejected before
  fingerprinting so distinct request content cannot collapse to the same UTF-8 replacement sequence.
- `angleRadians` MUST be a JSON number. Clients MUST keep it finite and within `[-pi/2, pi/2]`; semantic range
  failures establish a `failed` command.
- `angleRadians` is REQUIRED in `ddy` mode and MUST be omitted in `y` and `dy` modes.
- Clients MUST copy game identity, token, and revision from one recent `/state` snapshot.

Once the JSON fields and ID formats are accepted, the Agent creates a command record even when validation later fails. The first creation returns `201 Created` with `Location: /shots/{requestId}`. Repeating retained identical content returns `200 OK` and the existing record without repeating the Graphwar side effect.

The Agent fingerprints `gameInstanceId`, function UTF-8 bytes, `turnToken`, `battleRevision`, and exact optional angle bits with unambiguous length-prefix encoding and SHA-256. The fingerprint is internal and MUST NOT appear in responses. A retained `requestId` with different content returns `409 request-id-conflict`.

Concurrent identical replays MUST return the currently observable record without waiting for the creator. A response in `validating` or `claimed` includes `Retry-After: 1`. Clients SHOULD query the `Location` resource rather than invent a new request ID.

### 6.2 Read a command

`GET /shots/{requestId}` accepts only a canonical lowercase UUID path segment. A retained command returns `200`. An unknown or removed ID returns `404 shot-command-not-found`.

The complete resource is:

```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "gameInstanceId": "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
  "turnToken": "6ba7b811-9dad-41d1-80b4-00c04fd430c8",
  "battleRevision": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "status": "submitted",
  "createdAtEpochMs": 1784635200000,
  "updatedAtEpochMs": 1784635200012
}
```

The resource MUST NOT expose the function, angle, request fingerprint, internal exception, or transition history. Epoch timestamps are diagnostic wall-clock values; clients MUST NOT use them to decide whether a command is safe to retry or has timed out.

### 6.3 State machine and guarantees

Public states are:

```text
validating -> failed
validating -> claimed -> submitted
                      -> unknown
```

| Status       | Meaning                                                                                     | Client action                                                                      |
| ------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `validating` | The record exists, but the one-time turn token has not been claimed                         | Query this command; do not submit another command                                  |
| `claimed`    | The token is irreversibly consumed and the original call is in progress or has not returned | Query this command; never retry the shot                                           |
| `submitted`  | The original `setAngle` when applicable and `sendFunction` calls returned normally          | Continue observing `/state`; do not interpret this as a hit or completed animation |
| `failed`     | The Agent knows this command did not claim its token or perform a possible shot side effect | Inspect `error`; read fresh state before any new command                           |
| `unknown`    | The Agent cannot prove the original side-effect outcome                                     | Never retry automatically; retain the command for diagnosis                        |

The Agent MUST claim the one-time turn token immediately before the first possible shot side effect. A claim MUST NOT be rolled back. Errors after claim transition to `unknown`; defensive unexpected failures MAY also use `unknown` whenever absence of side effects cannot be proven.

`submitted` means only that the Agent's calls into the official client returned normally. Graphwar does not carry `requestId` in an execution acknowledgment, so the API MUST NOT invent `executed`, `completed`, `hit`, or equivalent states. Clients observe `phase`, `turnToken`, and `gameInstanceId` through `/state` to detect subsequent game progress.

A `failed` resource includes:

```json
{
  "error": {
    "code": "turn-token-stale",
    "message": "Graphwar turn token is stale",
    "canRetryWithNewRequestId": false
  }
}
```

`canRetryWithNewRequestId: true` means only that this command is proven not to have claimed the token or caused a possible shot side effect. It does not advise immediate retry. The client MUST first read fresh `/state`; Graphwar Killer does not automatically retry shot submission from this flag.

An `unknown` resource contains `error.code` and `error.message` but MUST omit `canRetryWithNewRequestId`.

Stable command error codes are:

| Code                         | Typical status                             | `canRetryWithNewRequestId` when failed |
| ---------------------------- | ------------------------------------------ | -------------------------------------- |
| `shot-executor-busy`         | `failed`                                   | `true`                                 |
| `function-empty`             | `failed`                                   | `true`                                 |
| `function-too-large`         | `failed`                                   | `true`                                 |
| `function-nesting-too-deep`  | `failed`                                   | `true`                                 |
| `malformed-function`         | `failed`                                   | `true`                                 |
| `angle-required`             | `failed`                                   | `true`                                 |
| `angle-not-allowed`          | `failed`                                   | `true`                                 |
| `angle-out-of-range`         | `failed`                                   | `true`                                 |
| `invalid-shot-request`       | `failed`                                   | `true`                                 |
| `turn-token-stale`           | `failed`                                   | `false`                                |
| `turn-token-used`            | `failed`                                   | `false`                                |
| `battle-revision-stale`      | `failed`                                   | `false`                                |
| `game-instance-stale`        | `failed`                                   | `false`                                |
| `turn-expired`               | `failed`                                   | `false`                                |
| `shot-already-resolving`     | `failed`                                   | `false`                                |
| `graphwar-state-unavailable` | `failed`                                   | `true`                                 |
| `graphwar-call-failed`       | `unknown`                                  | omitted                                |
| `internal-error`             | `failed` before claim, otherwise `unknown` | `true` when failed, otherwise omitted  |

### 6.4 Synchronous wait and the single execution slot

The reference Agent uses exactly one dedicated daemon worker for original shot calls and requests a 2 MiB thread stack. The stack size is a JVM/platform hint, while input limits are the primary guard.

`POST /shots` waits synchronously for at most five seconds. This wait timeout MUST NOT cancel, interrupt, replace, or duplicate the original Graphwar call. If the task remains active, the POST returns its current `validating` or `claimed` resource and the single execution slot remains occupied. New command IDs are recorded as `failed/shot-executor-busy`; they are never queued behind the stuck call.

When the original task later returns, the record changes to `submitted` or `unknown` and the slot becomes available. If it never returns, recovery requires restarting Graphwar/the Agent. Java cannot safely terminate an arbitrary stuck thread, and an implementation MUST NOT create replacement workers that could accumulate or execute concurrent original shots.

The original submission holds Graphwar's `GameData` monitor from mutable-state validation through angle mutation
and `sendFunction`. If it becomes stuck while holding that monitor, only `GET /health` and authenticated
`GET /shots/{requestId}` are guaranteed to remain responsive. The reference server admits at most six concurrent
Graphwar-dependent handlers, reserving two of its eight workers for those recovery routes; excess dependent
requests receive `503 server-busy`. `/state`, `/room`, ready changes, and obstacle reads may wait for the same
monitor. Clients MUST use command queries for recovery and MUST NOT repeatedly queue state requests during command
recovery.

Static `capabilities.canSubmitShots` remains true because the implementation supports the feature. Dynamic `/state.canAcceptShotCommands` is false while the slot is occupied, whenever `/state` itself can be read.

### 6.5 Stored command limit and cleanup

The Agent stores at most 50 command records. Records are not removed merely because time has passed.

- The command occupying the single Graphwar execution slot MUST NOT be removed.
- A non-failed command for the currently observed game instance and turn token MUST be kept until a later state observation changes that identity.
- When another record is needed, the Agent removes the oldest finished record that is not active and is not the current turn's non-failed command.
- With a valid single-slot state, at least one such record is always available when 50 records are stored. If internal state corruption leaves none, creation fails with `500 internal-error`, no command is created, and the record count remains 50.
- When `/state` observes a new game instance, finished records from older instances are removed, except the unique active record.
- An active old-game record remains queryable and keeps the single execution slot occupied until it completes.
- The Agent does not keep a permanent list of removed request IDs, because that list could grow without limit.

Each record stores only small identifiers, timestamps, status/error data, and a SHA-256 fingerprint. The Agent keeps function text only while the command is active and releases it after completion. Replicas MUST enforce the same fixed limit and MUST NOT let command history, transition history, errors, or request bodies grow without limit.

After a record is removed, `GET` returns `404`. Posting the removed ID again may create a new record because the Agent keeps no permanent ID history. Old game identity and turn tokens still protect against duplicate side effects, but clients MUST treat UUIDs as single-use and MUST NOT rely on how the Agent handles an ID after its record has been removed.

### 6.6 Lost-response recovery

The required client flow is:

1. Read `/state` and confirm API version, static capabilities, `canAcceptShotCommands`, local turn ownership, phase, and remaining time.
2. Generate one canonical lowercase UUID.
3. POST `/shots` once.
4. If the HTTP response is lost or times out, replay the exact same request ID and content or query `/shots/{requestId}`.
5. If the command is `validating` or `claimed`, follow `Retry-After` and query it again.
6. Treat `submitted`, `failed`, and `unknown` according to section 6.3.
7. While the command remains `validating` or `claimed`, query only the command resource; do not accumulate
   timed-out `/state` requests behind a possibly held `GameData` monitor.
8. Resume `/state` polling after the command reaches a terminal status.

A client MUST NOT change content while preserving `requestId`, and MUST NOT generate a new ID merely because the POST transport result was unknown.
Every POST or GET command response MUST match the expected request ID, game instance, turn token, and battle revision;
otherwise the client MUST treat the Agent as incompatible rather than accepting another command's terminal state.
After its local POST result deadline, a client SHOULD abort that HTTP transport to bound browser resources, then
continue with the same command ID. Aborting the transport is not cancellation of the Agent command and MUST NOT be
treated as permission to create a new ID.

## 7. Obstacle masks

Both mask endpoints require a strong entity tag copied from `/state.battleRevision`:

```http
GET /obstacle-masks/world.bin HTTP/1.1
If-Match: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
```

The reference implementation accepts exactly one quoted strong tag. It does not accept `*`, weak tags, or lists. If the current revision differs, it returns `412 battle-revision-changed` without returning stale bytes.

Successful response:

```http
HTTP/1.1 200 OK
Content-Type: application/octet-stream
ETag: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
```

The body is exactly `770 * 450 = 346500` bytes in row-major order at `y * 770 + x`. Byte `1` is blocked and byte `0` is empty.

- `world.bin` uses Graphwar's internal obstacle orientation.
- `view.bin` mirrors each row when `isTerrainReversed` is true.

The `ETag` MUST equal the conditioned revision and `/state.obstacleMask.revision`. Missing `If-Match` returns `428 if-match-required`; unavailable game state returns `409 obstacle-mask-unavailable`.

## 8. Conformance checklist

A compatible replica MUST test at least the following:

- `/health` stays public and reports API version, effective limits, authentication requirement, and build information.
- Protected endpoints reject missing/incorrect bearer credentials only when authentication is enabled.
- Every public boolean follows the `is*`, `can*`, or similarly affirmative predicate naming in this contract; negative-state booleans and v2 aliases are absent.
- Available and unavailable `/state` and `/room` branches follow their exact null/omission rules.
- Numeric Graphwar `gameState`/`gameMode` values and generic `id`/`index` aliases are absent.
- Ready updates skip local players already in the requested state.
- Both mask orientations, mirroring, exact byte layout, quoted `ETag`, required `If-Match`, and revision mismatch are tested.
- Canonical lowercase UUID validation, unknown/duplicate JSON fields, mode-dependent angle rules, formula bytes, and iterative nesting limits are tested.
- Same-ID/same-content replay produces no duplicate side effect.
- Same-ID/different-content returns `409 request-id-conflict`.
- Concurrent replay returns the current command without waiting for the original task.
- Token claim occurs immediately before the first possible shot side effect and is never rolled back.
- Post-claim exceptions become `unknown`; clients are never told they can retry such a command.
- A five-second POST wait does not cancel or replace a stuck official call.
- Only one original shot worker can exist, and a stuck worker prevents further original calls.
- Command queries and health remain responsive when a claimed call holds the `GameData` monitor.
- Stored command count never exceeds 50; active and current-turn records are preserved; the oldest safe finished records are removed; and an impossible full state returns `500 internal-error` without creating a record.
- New-game cleanup retains the unique active old-game command while removing safe finished history.
- Function text is released after a command finishes, and transition history is not stored.
- Transport and business failures use stable machine-readable error codes rather than parsing English messages.

Clients SHOULD validate their implementation against [openapi.yaml](./openapi.yaml) in addition to these behavioral tests.
