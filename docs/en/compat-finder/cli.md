# CLI

`compat-finder` provides two CLI subcommands: `interactive` for guided troubleshooting, and `next` for one-step calculations from existing answers.

## Help

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

## Locale

CLI messages can be localized with a command-line option or environment variables.

Priority:

1. Command-line option: `--locale` / `-l`
2. Environment variable: `COMPAT_FINDER_LOCALE`
3. Environment variable: `LC_ALL`
4. Environment variable: `LC_MESSAGES`
5. Environment variable: `LANG`
6. Default: `en`

Supported locales:

- `en`
- `zh-Hans`

Legacy Simplified Chinese locale tags such as `zh-CN` and `zh-SG` are normalized to `zh-Hans`.  
Unsupported explicit values, including other Chinese variants such as `zh-TW` and `zh-Hant`, are rejected instead of being silently switched to English.  
Unsupported locale values from environment variables are ignored while the resolver continues through the priority list and finally falls back to `en`.

## Algorithms

Both CLI subcommands accept `--algorithm <name>` and `--algo <name>`.

- `binary-split`: the default troubleshooting algorithm
- `leave-one-out`: test by excluding one target per round

For example:

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

## Locale Examples

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

## Commands

### `interactive`

Start a full interactive troubleshooting flow:

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

Supported input:

- `y` / `yes` / `issue` / `1` / `true`: the issue reproduces
- `n` / `no` / `pass` / `0` / `false`: the issue does not reproduce
- `u` / `undo`: undo the previous answer
- `q` / `quit`: quit

### `next`

Calculate the next targets to test from existing answers, or return the final result:

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

Returned fields:

- `status`: `testing` means the current `targets` should be tested; `complete` means the final result is available
- `targetCount`: the total number of targets in the current check
- `targets`: when `status` is `testing`, the targets to test; when `status` is `complete`, the final result
- `extraAnswerCount`: optional; returned only when `status` is `complete` and extra `answers` values were provided

Supported `answers` values:

- `y` / `yes` / `issue` / `1` / `true`: the issue reproduces
- `n` / `no` / `pass` / `0` / `false`: the issue does not reproduce

If `answers` includes extra values after the session is already complete, the CLI still returns the final result and adds `extraAnswerCount` to the JSON output.

Example 1:

::: code-group

```sh [npm]
npx compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y"
```

```sh [pnpm]
pnpm dlx compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y"
```

```sh [yarn]
yarn dlx compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y"
```

```sh [bun]
bunx compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y"
```

```sh [deno]
deno run npm:compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y"
```

```sh [vlt]
vlx compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y"
```

```sh [vp]
vp exec compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y"
```

:::

Expected JSON output:

```json
{
  "status": "testing",
  "targetCount": 3,
  "targets": ["Alpha"]
}
```

Example 2:

::: code-group

```sh [npm]
npx compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n"
```

```sh [pnpm]
pnpm dlx compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n"
```

```sh [yarn]
yarn dlx compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n"
```

```sh [bun]
bunx compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n"
```

```sh [deno]
deno run npm:compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n"
```

```sh [vlt]
vlx compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n"
```

```sh [vp]
vp exec compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n"
```

:::

Expected JSON output:

```json
{
  "status": "testing",
  "targetCount": 3,
  "targets": ["Beta"]
}
```

Example 3:

::: code-group

```sh [npm]
npx compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n,n"
```

```sh [pnpm]
pnpm dlx compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n,n"
```

```sh [yarn]
yarn dlx compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n,n"
```

```sh [bun]
bunx compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n,n"
```

```sh [deno]
deno run npm:compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n,n"
```

```sh [vlt]
vlx compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n,n"
```

```sh [vp]
vp exec compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n,n"
```

:::

Expected JSON output:

```json
{
  "status": "complete",
  "targetCount": 3,
  "targets": ["Alpha", "Beta"]
}
```
