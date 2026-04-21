# compat-finder CLI

## Run Without Installing

To run the CLI without installing it:

```bash
npx compat-finder --help

# or

pnpm dlx compat-finder --help

# or

yarn dlx compat-finder --help

# or

bunx compat-finder --help
```

## Commands

Use `interactive` for a guided terminal session and `next` for a one-shot result.

Supported commands:

- `compat-finder interactive --count 4`
- `compat-finder i -c 4 -n "A,B,C,D"`
- `compat-finder next -c 4 -a "y,n"`
- `compat-finder n -c 4 -a "issue,pass,1,0" -n "A,B,C,D"`

## Locale

Locale resolution order:

1. `--locale` or `-l`
2. `COMPAT_FINDER_LOCALE`
3. `LC_ALL`
4. `LC_MESSAGES`
5. `LANG`
6. fallback `en`

Supported locales:

- `en`
- `zh-Hans`

Locale normalization:

- `zh-CN`, `zh-SG`, and POSIX-style variants such as `zh_CN.UTF-8` normalize to `zh-Hans`.
- Unsupported explicit `--locale` values are rejected, including other Chinese variants such as `zh-TW` and `zh-Hant`.
- Unsupported environment locale values are ignored while resolution continues, then fallback `en` is used if no supported locale is detected.

## Answers

Accepted answer values:

- truthy: `y`, `yes`, `issue`, `1`, `true`
- falsy: `n`, `no`, `pass`, `0`, `false`

`interactive` also accepts:

- `u` or `undo`
- `q` or `quit`

`next` returns:

- `status`: `testing` or `complete`
- `targetCount`: total targets in the session
- `targets`: user-provided names or fallback labels for the current prompt or final result
