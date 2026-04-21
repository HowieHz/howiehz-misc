# compat-finder CLI

Use this reference when the user is already working in the CLI, wants the next compat-finder round, needs to choose `interactive` versus `next`, asks about locale or undo, or wants help turning a folder or ordered target list into a compat-finder triage loop.

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

Pick the CLI command that matches the user's workflow:

- `interactive`:
  use for a guided terminal session where the user runs the real test after each round and reports the result back.
- `next`:
  use for deterministic "what should I test next?" calculations from an ordered target list and prior answers.

Supported commands:

- `compat-finder interactive --count 4`
- `compat-finder i -c 4 -n "A,B,C,D"`
- `compat-finder next -c 4 -a "y,n"`
- `compat-finder n -c 4 -a "issue,pass,1,0" -n "A,B,C,D"`

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
- `extraAnswerCount`: optional; returned only when `status` is `complete` and extra answers were provided

`next` validation details:

- `--answers` may be empty.
- `--answers` is normalized from the accepted truthy/falsy vocabulary above.
- If the provided answers already complete the session and extra answers remain, `next` still returns the final result and includes `extraAnswerCount`.

## Triage Modes

Use this mode split before answering:

- interactive guided triage:
  the user runs the real test manually after each round, and the agent should compute the next targets and ask for `issue` or `pass`.
- automatic triage:
  the agent runs the real test loop. Confirm the exact command or procedure, the `issue` versus `pass` rule, and any setup constraint before running anything.

Prefer this interactive response shape:

```text
Mode: interactive guided triage
Known answers: <normalized prior answers>
Next targets to test: <targets>
How to reply: report `issue` if the problem reproduces, `pass` if it does not
```

For automatic triage, report each round with:

- tested targets
- exact command or short procedure
- observed signal
- normalized `issue` or `pass` result
- next targets or final conclusion

If the real test cannot be interpreted confidently, stop and label it as an execution problem instead of guessing a product result.

## Broad Scan Setup

When the user starts from a folder, mod list, plugin pack, build list, or feature-flag set instead of a ready-made compat-finder session:

1. Identify the concrete target set.
2. Identify the real test command or manual procedure that can run only the selected subset.
3. Identify the `issue` versus `pass` rule.
4. Only then continue as automatic triage.

If the request is "scan this folder" but there is no way yet to launch or test only the currently selected subset, stop and ask for that missing execution detail.

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
