# 命令行工具

`compat-finder` 提供两个 CLI 子命令：`interactive` 用于引导式排查，`next` 用于根据已有回答做单步推导。

## 帮助

::: code-group

```sh [npm]
npx compat-finder --help
npx compat-finder --help interactive
npx compat-finder --help next
```

```sh [pnpm]
pnpm dlx compat-finder --help
pnpm dlx compat-finder --help interactive
pnpm dlx compat-finder --help next
```

```sh [yarn]
yarn dlx compat-finder --help
yarn dlx compat-finder --help interactive
yarn dlx compat-finder --help next
```

```sh [bun]
bunx compat-finder --help
bunx compat-finder --help interactive
bunx compat-finder --help next
```

```sh [deno]
deno run npm:compat-finder --help
deno run npm:compat-finder --help interactive
deno run npm:compat-finder --help next
```

```sh [vlt]
vlx compat-finder --help
vlx compat-finder --help interactive
vlx compat-finder --help next
```

```sh [vp]
vp exec compat-finder --help
vp exec compat-finder --help interactive
vp exec compat-finder --help next
```

:::

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

::: code-group

```sh [npm]
npx compat-finder interactive -c 5 --algo leave-one-out
```

```sh [pnpm]
pnpm dlx compat-finder interactive -c 5 --algo leave-one-out
```

```sh [yarn]
yarn dlx compat-finder interactive -c 5 --algo leave-one-out
```

```sh [bun]
bunx compat-finder interactive -c 5 --algo leave-one-out
```

```sh [deno]
deno run npm:compat-finder interactive -c 5 --algo leave-one-out
```

```sh [vlt]
vlx compat-finder interactive -c 5 --algo leave-one-out
```

```sh [vp]
vp exec compat-finder interactive -c 5 --algo leave-one-out
```

:::

## 语言示例

::: code-group

```sh [npm]
npx compat-finder --locale zh-Hans --help
npx compat-finder -l zh-Hans next -c 3 -a "y,n"
COMPAT_FINDER_LOCALE=zh-Hans npx compat-finder next -c 3 -a "y,n"
```

```sh [pnpm]
pnpm dlx compat-finder --locale zh-Hans --help
pnpm dlx compat-finder -l zh-Hans next -c 3 -a "y,n"
COMPAT_FINDER_LOCALE=zh-Hans pnpm dlx compat-finder next -c 3 -a "y,n"
```

```sh [yarn]
yarn dlx compat-finder --locale zh-Hans --help
yarn dlx compat-finder -l zh-Hans next -c 3 -a "y,n"
COMPAT_FINDER_LOCALE=zh-Hans yarn dlx compat-finder next -c 3 -a "y,n"
```

```sh [bun]
bunx compat-finder --locale zh-Hans --help
bunx compat-finder -l zh-Hans next -c 3 -a "y,n"
COMPAT_FINDER_LOCALE=zh-Hans bunx compat-finder next -c 3 -a "y,n"
```

```sh [deno]
deno run npm:compat-finder --locale zh-Hans --help
deno run npm:compat-finder -l zh-Hans next -c 3 -a "y,n"
COMPAT_FINDER_LOCALE=zh-Hans deno run npm:compat-finder next -c 3 -a "y,n"
```

```sh [vlt]
vlx compat-finder --locale zh-Hans --help
vlx compat-finder -l zh-Hans next -c 3 -a "y,n"
COMPAT_FINDER_LOCALE=zh-Hans vlx compat-finder next -c 3 -a "y,n"
```

```sh [vp]
vp exec compat-finder --locale zh-Hans --help
vp exec compat-finder -l zh-Hans next -c 3 -a "y,n"
COMPAT_FINDER_LOCALE=zh-Hans vp exec compat-finder next -c 3 -a "y,n"
```

:::

## 子命令

### `interactive`

启动一轮完整的交互式排查流程：

::: code-group

```sh [npm]
npx compat-finder interactive --count 4
npx compat-finder i -c 4 -n "A,B,C,D"
npx compat-finder interactive -c 4 --algo leave-one-out
```

```sh [pnpm]
pnpm dlx compat-finder interactive --count 4
pnpm dlx compat-finder i -c 4 -n "A,B,C,D"
pnpm dlx compat-finder interactive -c 4 --algo leave-one-out
```

```sh [yarn]
yarn dlx compat-finder interactive --count 4
yarn dlx compat-finder i -c 4 -n "A,B,C,D"
yarn dlx compat-finder interactive -c 4 --algo leave-one-out
```

```sh [bun]
bunx compat-finder interactive --count 4
bunx compat-finder i -c 4 -n "A,B,C,D"
bunx compat-finder interactive -c 4 --algo leave-one-out
```

```sh [deno]
deno run npm:compat-finder interactive --count 4
deno run npm:compat-finder i -c 4 -n "A,B,C,D"
deno run npm:compat-finder interactive -c 4 --algo leave-one-out
```

```sh [vlt]
vlx compat-finder interactive --count 4
vlx compat-finder i -c 4 -n "A,B,C,D"
vlx compat-finder interactive -c 4 --algo leave-one-out
```

```sh [vp]
vp exec compat-finder interactive --count 4
vp exec compat-finder i -c 4 -n "A,B,C,D"
vp exec compat-finder interactive -c 4 --algo leave-one-out
```

:::

支持以下输入：

- `y` / `yes` / `issue` / `1` / `true`：表示“有兼容性问题”
- `n` / `no` / `pass` / `0` / `false`：表示“没有兼容性问题”
- `u` / `undo`：撤回上一步
- `q` / `quit`：退出

### `next`

根据已有回答，计算下一步应测试的目标，或直接返回最终结果：

::: code-group

```sh [npm]
npx compat-finder next -c 3
npx compat-finder n -c 3 -a "y,n"
npx compat-finder next -c 4 -a "issue,pass,1,0" -n "A,B,C,D"
npx compat-finder next -c 4 --algo leave-one-out -a "issue,pass" -n "A,B,C,D"
```

```sh [pnpm]
pnpm dlx compat-finder next -c 3
pnpm dlx compat-finder n -c 3 -a "y,n"
pnpm dlx compat-finder next -c 4 -a "issue,pass,1,0" -n "A,B,C,D"
pnpm dlx compat-finder next -c 4 --algo leave-one-out -a "issue,pass" -n "A,B,C,D"
```

```sh [yarn]
yarn dlx compat-finder next -c 3
yarn dlx compat-finder n -c 3 -a "y,n"
yarn dlx compat-finder next -c 4 -a "issue,pass,1,0" -n "A,B,C,D"
yarn dlx compat-finder next -c 4 --algo leave-one-out -a "issue,pass" -n "A,B,C,D"
```

```sh [bun]
bunx compat-finder next -c 3
bunx compat-finder n -c 3 -a "y,n"
bunx compat-finder next -c 4 -a "issue,pass,1,0" -n "A,B,C,D"
bunx compat-finder next -c 4 --algo leave-one-out -a "issue,pass" -n "A,B,C,D"
```

```sh [deno]
deno run npm:compat-finder next -c 3
deno run npm:compat-finder n -c 3 -a "y,n"
deno run npm:compat-finder next -c 4 -a "issue,pass,1,0" -n "A,B,C,D"
deno run npm:compat-finder next -c 4 --algo leave-one-out -a "issue,pass" -n "A,B,C,D"
```

```sh [vlt]
vlx compat-finder next -c 3
vlx compat-finder n -c 3 -a "y,n"
vlx compat-finder next -c 4 -a "issue,pass,1,0" -n "A,B,C,D"
vlx compat-finder next -c 4 --algo leave-one-out -a "issue,pass" -n "A,B,C,D"
```

```sh [vp]
vp exec compat-finder next -c 3
vp exec compat-finder n -c 3 -a "y,n"
vp exec compat-finder next -c 4 -a "issue,pass,1,0" -n "A,B,C,D"
vp exec compat-finder next -c 4 --algo leave-one-out -a "issue,pass" -n "A,B,C,D"
```

:::

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

::: code-group

```sh [npm]
npx compat-finder next -c 3 -a "y"
```

```sh [pnpm]
pnpm dlx compat-finder next -c 3 -a "y"
```

```sh [yarn]
yarn dlx compat-finder next -c 3 -a "y"
```

```sh [bun]
bunx compat-finder next -c 3 -a "y"
```

```sh [deno]
deno run npm:compat-finder next -c 3 -a "y"
```

```sh [vlt]
vlx compat-finder next -c 3 -a "y"
```

```sh [vp]
vp exec compat-finder next -c 3 -a "y"
```

:::

预期输出为以下 JSON：

```json
{
  "status": "testing",
  "targetCount": 3,
  "targets": ["目标 1"]
}
```

示例 2：

::: code-group

```sh [npm]
npx compat-finder next -c 3 -a "y,n"
```

```sh [pnpm]
pnpm dlx compat-finder next -c 3 -a "y,n"
```

```sh [yarn]
yarn dlx compat-finder next -c 3 -a "y,n"
```

```sh [bun]
bunx compat-finder next -c 3 -a "y,n"
```

```sh [deno]
deno run npm:compat-finder next -c 3 -a "y,n"
```

```sh [vlt]
vlx compat-finder next -c 3 -a "y,n"
```

```sh [vp]
vp exec compat-finder next -c 3 -a "y,n"
```

:::

预期输出为以下 JSON：

```json
{
  "status": "testing",
  "targetCount": 3,
  "targets": ["目标 2"]
}
```

示例 3：

::: code-group

```sh [npm]
npx compat-finder next -c 3 -a "y,n,n"
```

```sh [pnpm]
pnpm dlx compat-finder next -c 3 -a "y,n,n"
```

```sh [yarn]
yarn dlx compat-finder next -c 3 -a "y,n,n"
```

```sh [bun]
bunx compat-finder next -c 3 -a "y,n,n"
```

```sh [deno]
deno run npm:compat-finder next -c 3 -a "y,n,n"
```

```sh [vlt]
vlx compat-finder next -c 3 -a "y,n,n"
```

```sh [vp]
vp exec compat-finder next -c 3 -a "y,n,n"
```

:::

预期输出为以下 JSON：

```json
{
  "status": "complete",
  "targetCount": 3,
  "targets": ["目标 1", "目标 2"]
}
```
