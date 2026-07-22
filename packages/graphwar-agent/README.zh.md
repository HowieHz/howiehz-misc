# Graphwar Agent

[English](./README.md) | **简体中文**

Graphwar Agent 是面向 Graphwar 官方客户端的 Java Agent，无需额外运行时依赖。它只监听 `127.0.0.1`，通过 HTTP API 提供实时对局与房间状态、障碍 mask、准备状态控制和可恢复的发射提交。

当前 API 版本为 v3。英文权威规范见 [API.md](./API.md)，机器可读定义见 [openapi.yaml](./openapi.yaml)。

## 安装与启动

1. [下载 `graphwar-agent.jar`](../../docs/public/graphwar-agent.jar)。
2. 将它放到 `graphwar.jar` 旁边。
3. 启动 Graphwar：

```shell
java -javaagent:graphwar-agent.jar -jar graphwar.jar
```

Agent 默认监听 `http://127.0.0.1:17900`。如果端口已被占用，它会依次尝试后续 100 个端口，并打印最终地址。显式设置 `port` 时不会尝试其他端口：

```shell
java -javaagent:graphwar-agent.jar=port=17901 -jar graphwar.jar
```

如需同时设置多个选项，请在 Agent JAR 路径后的参数中用逗号分隔：

```shell
java -javaagent:graphwar-agent.jar=token=auto,maxRequestBodyBytes=1048576 -jar graphwar.jar
```

| 选项                      | 用途                          | 默认值                                                  | 可接受值                                      |
| ------------------------- | ----------------------------- | ------------------------------------------------------- | --------------------------------------------- |
| `port`                    | 设置 HTTP 监听端口            | `17900`；占用时再尝试后续 100 个端口（`17901`–`18000`） | `1`–`65535`；显式设置后不再尝试其他端口       |
| `token`                   | 启用 bearer token 鉴权        | 不启用鉴权                                              | `auto`，或 1–4096 个不含逗号的可见 ASCII 字符 |
| `maxRequestBodyBytes`     | 限制 JSON 请求体大小          | `65536`                                                 | `1024`–`16777216`                             |
| `maxFunctionBytes`        | 限制函数字符串的 UTF-8 字节数 | `16384`                                                 | `1`–`1048576`，且不会超过实际请求体上限       |
| `maxFunctionNestingDepth` | 限制函数表达式的最大嵌套深度  | `256`                                                   | `1`–`4096`                                    |

启动日志会显示 Agent 版本、源码 commit、实际生效的限制、启用鉴权时的 token，以及监听地址。无需鉴权的 `GET /health` 会返回 API 版本 3、构建来源、是否需要鉴权和实际限制。

## 安全说明

服务只绑定本机回环地址，但会通过 CORS 和 Private Network Access 允许浏览器访问。鉴权默认关闭，因此获得本地网络访问权限的不受信任网页可能控制正在运行的 Agent。

需要防范此风险时，请使用 `token=auto` 或显式 `token=...`：

```http
Authorization: Bearer TOKEN
```

token 会显示在启动日志中，不会持久化。即使启用鉴权，`/health` 仍公开；其他所有 API 端点都必须携带 bearer token。未启用鉴权时，访问不受信任网页前请关闭 Graphwar 或 Agent。

发射命令保存在最多 50 条记录的有界幂等账本中，并由唯一的 Graphwar 调用线程执行。若官方调用永久卡死，Agent 不会启动替代线程；必须重启 Graphwar 才能恢复。完整的恢复、内存上限和并发语义见 [API.md](./API.md)。
