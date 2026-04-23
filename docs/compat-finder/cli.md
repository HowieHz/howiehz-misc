# 命令行工具

`compat-finder` 提供两个 CLI 子命令：`interactive` 用于引导式排查，`next` 用于根据已有回答做单步推导。

## 帮助

```bash
compat-finder --help
```

```bash
compat-finder --help interactive
```

```bash
compat-finder --help next
```

## 输出语言

CLI 文案可以通过命令行参数或环境变量设置输出语言。

优先级：

1. 命令行参数：`--locale` / `-l`
2. 环境变量：`COMPAT_FINDER_LOCALE`
3. 环境变量：`LC_ALL`
4. 环境变量：`LC_MESSAGES`
5. 环境变量：`LANG`
6. 默认值：`en`

支持的语言：

- `en`
- `zh-Hans`

兼容旧的简体中文 locale 标签，例如 `zh-CN` 与 `zh-SG` 会被归一化为 `zh-Hans`。  
显式传入不支持的值时会直接报错，包括 `zh-TW`、`zh-Hant` 等其他中文变体，不会静默切换到英文。  
环境变量中的不支持值会被忽略，并继续按优先级查找；如果最终没有匹配到支持语言，则回退到 `en`。

## 算法

两个 CLI 子命令都支持 `--algorithm <名称>` 和 `--algo <名称>`。

- `binary-split`：默认排查算法
- `leave-one-out`：每轮排除 1 个目标进行测试

例如：

```bash
compat-finder interactive -c 5 --algo leave-one-out
```

## 语言示例

```bash
compat-finder --locale zh-Hans --help
```

```bash
compat-finder -l zh-Hans next -c 3 -a "y,n"
```

```bash
COMPAT_FINDER_LOCALE=zh-Hans compat-finder next -c 3 -a "y,n"
```

## 子命令

### `interactive`

启动一轮完整的交互式排查流程：

```bash
compat-finder interactive --count 4
```

```bash
compat-finder i -c 4 -n "A,B,C,D"
```

```bash
compat-finder interactive -c 4 --algo leave-one-out
```

支持以下输入：

- `y` / `yes` / `issue` / `1` / `true`：表示“有兼容性问题”
- `n` / `no` / `pass` / `0` / `false`：表示“没有兼容性问题”
- `u` / `undo`：撤回上一步
- `q` / `quit`：退出

### `next`

根据已有回答，计算下一步应测试的目标，或直接返回最终结果：

```bash
compat-finder next -c 3
```

```bash
compat-finder n -c 3 -a "y,n"
```

```bash
compat-finder next -c 4 -a "issue,pass,1,0" -n "A,B,C,D"
```

```bash
compat-finder next -c 4 --algo leave-one-out -a "issue,pass" -n "A,B,C,D"
```

返回字段说明：

- `status`：`testing` 表示当前需要按 `targets` 列表进行测试；`complete` 表示已经得到最终结果
- `targetCount`：本轮排查的测试目标总数
- `targets`：`testing` 时表示当前需要测试的目标列表；`complete` 时表示最终结果列表
- `extraAnswerCount`：可选；仅在结果为 `complete` 且传入了多余 `answers` 值时返回

`answers` 支持以下取值：

- `y` / `yes` / `issue` / `1` / `true`：表示“有兼容性问题”
- `n` / `no` / `pass` / `0` / `false`：表示“没有兼容性问题”

如果传入的 `answers` 在会话结束后还有多余值，CLI 仍会返回最终结果，并在 JSON 输出中附带 `extraAnswerCount`。

示例 1：

```bash
compat-finder next -c 3 -a "y"
```

预期输出为以下 JSON：

```json
{
  "status": "testing",
  "targetCount": 3,
  "targets": ["目标 1"]
}
```

示例 2：

```bash
compat-finder next -c 3 -a "y,n"
```

预期输出为以下 JSON：

```json
{
  "status": "testing",
  "targetCount": 3,
  "targets": ["目标 2"]
}
```

示例 3：

```bash
compat-finder next -c 3 -a "y,n,n"
```

预期输出为以下 JSON：

```json
{
  "status": "complete",
  "targetCount": 3,
  "targets": ["目标 1", "目标 2"]
}
```
