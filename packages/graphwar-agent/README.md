# Graphwar Agent

**English** | [简体中文](./README.zh.md)

Graphwar Agent is a dependency-free Java agent for the official Graphwar client. It exposes live match and room state, obstacle masks, ready controls, and recoverable shot submission through an HTTP API bound to `127.0.0.1`.

API v3 is intentionally incompatible with v2. The normative contract is [API.md](./API.md); the machine-readable companion is [openapi.yaml](./openapi.yaml).

## Install and start

1. [Download `graphwar-agent.jar`](../../docs/public/graphwar-agent.jar).
2. Place it next to `graphwar.jar`.
3. Start Graphwar:

```shell
java -javaagent:graphwar-agent.jar -jar graphwar.jar
```

The agent listens on `http://127.0.0.1:17900` by default. If that port is busy, it searches the next 100 ports and prints the selected address. Supplying `port` requires that exact port:

```shell
java -javaagent:graphwar-agent.jar=port=17901 -jar graphwar.jar
```

Options are comma-separated after the agent jar path:

```shell
java -javaagent:graphwar-agent.jar=token=auto,maxRequestBodyBytes=1048576 -jar graphwar.jar
```

| Option                    |                      Default | Accepted values                                            |
| ------------------------- | ---------------------------: | ---------------------------------------------------------- |
| `port`                    | `17900` with fallback search | `1`–`65535`; an explicit value disables fallback           |
| `token`                   |      authentication disabled | `auto`, or 1–4096 printable ASCII characters without comma |
| `maxRequestBodyBytes`     |                      `65536` | `1024`–`16777216`                                          |
| `maxFunctionBytes`        |                      `16384` | `1`–`1048576`, capped to the effective request-body limit  |
| `maxFunctionNestingDepth` |                        `256` | `1`–`4096`                                                 |

Startup logs report the build version, source commit, effective limits, authentication token when enabled, and listening address. `GET /health` is always public and reports API version 3, build provenance, whether authentication is required, and the effective limits.

## Security

The server binds only to loopback, but it deliberately permits browser access through CORS and Private Network Access. Authentication is disabled by default, so an untrusted web page with local-network permission may control a running Agent.

Use `token=auto` or an explicit `token=...` when this matters:

```http
Authorization: Bearer TOKEN
```

The token is printed at startup and is not persisted. `/health` remains unauthenticated; every other API endpoint requires the bearer token when authentication is enabled. Without authentication, stop Graphwar or the Agent before browsing untrusted pages.

Shot submission uses a bounded 50-record idempotency ledger and one dedicated Graphwar call worker. A permanently stuck official call is never replaced with another worker; restart Graphwar to recover. See [API.md](./API.md) for the exact recovery, memory-bound, and concurrency semantics.
