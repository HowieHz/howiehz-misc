# Graphwar Agent

**English** | [简体中文](./README.zh.md)

Graphwar Agent is a Java agent for the official Graphwar client and requires no additional runtime dependencies. It listens only on `127.0.0.1` and provides live match and room state, obstacle masks, room readiness controls, and shot commands whose results remain queryable after a request timeout.

The current API version is v3. The full specification is [API.md](./API.md); the machine-readable definition is [openapi.yaml](./openapi.yaml).

## Install and start

1. [Download `graphwar-agent.jar`](../../docs/public/graphwar-agent.jar).
2. Place it next to `graphwar.jar`.
3. Start Graphwar:

```shell
java -javaagent:graphwar-agent.jar -jar graphwar.jar
```

The Agent listens on `http://127.0.0.1:17900` by default. If that port is busy, it tries the next 100 ports and prints the selected address. Setting `port` explicitly disables fallback:

```shell
java -javaagent:graphwar-agent.jar=port=17901 -jar graphwar.jar
```

To set multiple options, pass a comma-separated list after the Agent JAR path:

```shell
java -javaagent:graphwar-agent.jar=token=auto,maxRequestHeaderBytes=16384,maxRequestBodyBytes=1048576 -jar graphwar.jar
```

| Option                  | Purpose                                      | Default                                                    | Accepted values                                             |
| ----------------------- | -------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| `port`                  | Set the HTTP listening port                  | `17900`; if busy, try the next 100 ports (`17901`–`18000`) | `1`–`65535`; an explicit value disables fallback            |
| `token`                 | Enable bearer-token authentication           | Authentication disabled                                    | `auto`, or 1–4096 visible ASCII characters excluding commas |
| `maxRequestHeaderBytes` | Limit HTTP request-header size               | `8192`                                                     | `8192`–`1048576`                                            |
| `maxRequestBodyBytes`   | Limit the JSON data accepted per API request | `65536`                                                    | `1024`–`16777216`                                           |
| `maxFunctionBytes`      | Limit submitted function size in UTF-8 bytes | `65536`                                                    | `1`–`65536`, capped to the effective request-body limit     |
| `maxFunctionTokens`     | Limit effective Graphwar evaluation tokens   | `3072`                                                     | `1`–`3072`                                                  |

Startup logs show the Agent version, source commit, effective limits, authentication token when enabled, and listening address. `GET /health` is always public and reports API version 3, build information, whether authentication is required, and the effective limits.

## Security

The server binds only to loopback, but it permits browser access through CORS and Private Network Access. Authentication is disabled by default, so an untrusted web page with local-network access may control a running Agent.

Use `token=auto` or an explicit `token=...` when you need to restrict local access:

```http
Authorization: Bearer TOKEN
```

The token is printed at startup and is not persisted. `/health` remains unauthenticated; every other API endpoint requires the bearer token when authentication is enabled. Without authentication, stop Graphwar or the Agent before browsing untrusted pages.

The Agent keeps at most 50 shot records to recognize repeated requests. It removes completed records only when it needs room for a new record or observes a new game. Records still needed by the active call or current turn are preserved, so command history cannot consume memory without limit.

All Graphwar shot calls run on one dedicated worker. If a call hangs permanently, the Agent does not start a replacement worker; restart Graphwar to recover.

See [API.md](./API.md) for timeout recovery, record cleanup, and concurrency rules.
