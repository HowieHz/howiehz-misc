# Graphwar Agent

[English](./README.md) | **简体中文**

Graphwar Agent 是用于官方 Graphwar 客户端的无运行时依赖 Java Agent。它通过只监听 `127.0.0.1` 的 HTTP API，提供实时对局与房间状态、障碍 mask、准备控制和可恢复的发射提交。

API v3 与 v2 有意不兼容。英文权威规范见 [API.md](./API.md)，机器可读定义见 [openapi.yaml](./openapi.yaml)。

## 安装与启动

1. [下载 `graphwar-agent.jar`](../../docs/public/graphwar-agent.jar)。
2. 将它放到 `graphwar.jar` 旁边。
3. 启动 Graphwar：

```shell
java -javaagent:graphwar-agent.jar -jar graphwar.jar
```

Agent 默认监听 `http://127.0.0.1:17900`。端口被占用时，它会搜索后续 100 个端口，并打印最终地址。显式指定 `port` 后只使用该端口：

```shell
java -javaagent:graphwar-agent.jar=port=17901 -jar graphwar.jar
```

多个选项在 Agent jar 路径后以逗号分隔：

```shell
java -javaagent:graphwar-agent.jar=token=auto,maxRequestBodyBytes=1048576 -jar graphwar.jar
```

| 选项                      |                默认值 | 可接受值                                        |
| ------------------------- | --------------------: | ----------------------------------------------- |
| `port`                    | `17900`，允许回退搜索 | `1`–`65535`；显式指定后禁用回退                 |
| `token`                   |            不启用鉴权 | `auto`，或 1–4096 个不含逗号的可打印 ASCII 字符 |
| `maxRequestBodyBytes`     |               `65536` | `1024`–`16777216`                               |
| `maxFunctionBytes`        |               `16384` | `1`–`1048576`，且不会超过实际请求体上限         |
| `maxFunctionNestingDepth` |                 `256` | `1`–`4096`                                      |

启动日志会打印构建版本、源码 commit、实际生效的限制、启用鉴权时的 token，以及监听地址。无需鉴权的 `GET /health` 会返回 API 版本 3、构建来源、是否需要鉴权和实际限制。

## 安全说明

服务只绑定本机回环地址，但会通过 CORS 和 Private Network Access 允许浏览器访问。鉴权默认关闭，因此获得本地网络权限的不受信任网页可能控制正在运行的 Agent。

有此风险时，请使用 `token=auto` 或显式 `token=...`：

```http
Authorization: Bearer TOKEN
```

token 会在启动时打印，不会持久化。即使启用鉴权，`/health` 仍公开；其他所有 API 端点都必须携带 bearer token。未启用鉴权时，浏览不受信任页面前请关闭 Graphwar 或 Agent。

发射提交使用最多 50 条记录的有界幂等账本，以及唯一的 Graphwar 调用线程。官方调用永久卡死后不会创建替代线程，必须重启 Graphwar 才能恢复。完整的恢复、内存上限和并发语义见 [API.md](./API.md)。
