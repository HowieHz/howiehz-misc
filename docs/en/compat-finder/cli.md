# CLI

compat-finder provides two CLI subcommands: `interactive` for guided troubleshooting, and `next` for one-step calculations from existing answers.

## Help

```bash
compat-finder --help
```

```bash
compat-finder --help interactive
```

```bash
compat-finder --help next
```

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

- `binary-split`: the default narrowing strategy
- `leave-one-out`: test by excluding one target per round

For example:

```bash
compat-finder interactive -c 5 --algo leave-one-out
```

## Locale Examples

```bash
compat-finder --locale zh-Hans --help
```

```bash
compat-finder -l zh-Hans next -c 3 -a "y,n"
```

```bash
COMPAT_FINDER_LOCALE=zh-Hans compat-finder next -c 3 -a "y,n"
```

## Commands

### `interactive`

Start a full interactive troubleshooting flow:

```bash
compat-finder interactive --count 4
```

```bash
compat-finder i -c 4 -n "A,B,C,D"
```

```bash
compat-finder interactive -c 4 --algo leave-one-out
```

Supported input:

- `y` / `yes` / `issue` / `1` / `true`: the issue reproduces
- `n` / `no` / `pass` / `0` / `false`: the issue does not reproduce
- `u` / `undo`: undo the previous answer
- `q` / `quit`: quit

### `next`

Calculate the next targets to test from existing answers, or return the final result:

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

```bash
compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y"
```

Expected JSON output:

```json
{
  "status": "testing",
  "targetCount": 3,
  "targets": ["Alpha"]
}
```

Example 2:

```bash
compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n"
```

Expected JSON output:

```json
{
  "status": "testing",
  "targetCount": 3,
  "targets": ["Beta"]
}
```

Example 3:

```bash
compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n,n"
```

Expected JSON output:

```json
{
  "status": "complete",
  "targetCount": 3,
  "targets": ["Alpha", "Beta"]
}
```
