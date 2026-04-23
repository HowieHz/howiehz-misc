# compat-finder

[![Open on npmx][npmx-version-src]][npmx-href]
[![npm downloads][npmx-downloads-src]][npmx-href]
[![CI][ci-src]][ci-href]

English | [简体中文](./README.zh.md)

compat-finder is a library and CLI for troubleshooting compatibility issues across multiple targets.

[Compatibility](#compatibility) | [Install](#install) | [Quick Start](#quick-start) | [API Reference](#api-reference) | [CLI](#cli) | [Work with AI](#work-with-ai) | [Online Tool](#online-tool)

## Compatibility

- Library: ESM-only. It has no Node.js built-in dependencies and can also run in browsers and other ESM-compatible runtimes
- CLI: requires Node.js `^20 || ^22 || >=24`; supports English and Simplified Chinese

## Install

Install with your preferred package manager:

```bash
npm install compat-finder

# or

pnpm add compat-finder

# or

yarn add compat-finder

# or

bun add compat-finder
```

Then you can create a compatibility session:

```ts
import { createCompatibilitySession } from "compat-finder";
```

You can also run the command-line tool without installing it first:

```bash
npx compat-finder --help

# or

pnpm dlx compat-finder --help

# or

yarn dlx compat-finder --help

# or

bunx compat-finder --help
```

## Quick Start

### Library example

```ts
import { createCompatibilitySession } from "compat-finder";

const session = createCompatibilitySession(["A", "B", "C", "D"]);

let step = session.current();

while (step.status === "testing") {
  const result = askUser(step.targets);

  if (result === "undo") {
    step = session.undo();
    continue;
  }

  step = session.answer(result === "issue");
}

console.log("Result:", step.targets);

function askUser(targets: readonly string[]): "issue" | "pass" | "undo" {
  console.log("Targets to test:", targets);
  // For browsers, this can read from prompt(), buttons, or forms.
  // For Node.js, this can read from readline, a test script, or your own CLI.
  return "issue"; // "issue" if it reproduces, "pass" if not, or "undo".
}
```

Pass `{ algorithm: "leave-one-out" }` as the second argument to use a leave-one-out workflow instead of the default `binary-split` search.

See [API Reference](#api-reference) for the full exported API.

### Command-line example

Run an interactive compatibility check:

```bash
compat-finder interactive --count 4
```

Run a single-step calculation and print the next result:

```bash
compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n"
```

Switch algorithms when needed:

```bash
compat-finder next -c 4 --algorithm leave-one-out -n "A,B,C,D" -a "issue,pass"
```

Expected JSON output:

```json
{
  "status": "testing",
  "targetCount": 3,
  "targets": ["Beta"]
}
```

See the full [CLI](#cli) documentation for commands and options.

## API Reference

Use `createCompatibilitySession` for most integrations.

Simple session API:

- `createCompatibilitySession(targets, options?)`: create a compatibility session from your target list
- `session.current()`: read the current step or final result
- `session.answer(hasIssue)`: submit one result and move to the next step
- `session.undo()`: remove the latest answer and return to the previous step

Session steps:

- `status`: `testing` means the current `targets` should be tested; `complete` means the final result is available
- `targets`: target values from the original input list
- `targetNumbers`: 1-based target numbers for display or logs

`session.answer(true)` means the issue appears with the current targets.
`session.answer(false)` means the issue does not appear with the current targets.
`session.undo()` is useful when the latest answer was entered by mistake.
`createCompatibilitySession(targets)` requires at least one target.

Algorithm selection:

- Default: `binary-split`
- Alternative: `leave-one-out`
- Example: `createCompatibilitySession(targets, { algorithm: "leave-one-out" })`

### Advanced API

The lower-level API exposes the mutable range-based state machine for custom UIs and diagnostics.

Session lifecycle:

- `createCompatibilityTestState(targetCount, options?)`: create a new session
- `getNextAnswerableCompatibilityTestStep(state)`: read the next actionable step and automatically skip cached steps
- `getCurrentCompatibilityTestStep(state)`: read the current step, or `undefined` when complete
- `applyCompatibilityTestAnswer(state, hasIssue)`: apply one answer and advance the session
- `skipCachedCompatibilityTestSteps(state)`: fast-forward through cached steps

Range utilities:

- `takeTargetsFromRanges(ranges, limit)`: expand ranges into target indexes
- `countTargetsInRanges(ranges)`: count targets covered by ranges
- `intersectTargetRanges(leftRanges, rightRanges)`: intersect two range lists
- `subtractTargetRanges(sourceRanges, excludedRanges)`: remove one range list from another

Key types:

- `CompatibilityTestState`: mutable session state
- `CompatibilityTestStep`: current step to present to the caller
- `CompatibilityTestDebugStep`: internal search state in range form
- `CompatibilityTestAlgorithm`: built-in algorithm names
- `CompatibilityTestOptions`: shared option bag for session and state creation
- `TargetRange`: inclusive target index range

For parameter details and behavior guarantees, see the inline JSDoc under [src/compatibility-test/](./src/compatibility-test).

## CLI

### Help

```bash
compat-finder --help
```

```bash
compat-finder --help interactive
```

```bash
compat-finder --help next
```

### Locale

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

### Algorithms

Both CLI subcommands accept `--algorithm <name>` and `--algo <name>`.

- `binary-split`: the default narrowing strategy
- `leave-one-out`: test by excluding one target per round

For example:

```bash
compat-finder interactive -c 5 --algo leave-one-out
```

Locale examples:

```bash
compat-finder --locale zh-Hans --help
```

```bash
compat-finder -l zh-Hans next -c 3 -a "y,n"
```

```bash
COMPAT_FINDER_LOCALE=zh-Hans compat-finder next -c 3 -a "y,n"
```

### Commands

#### `interactive`

Start an interactive compatibility check:

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

#### `next`

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

## Work with AI

compat-finder provides an [Agent Skill](https://agentskills.io/) that helps AI agents understand the compatibility troubleshooting workflows, CLI usage, and TypeScript API for this package.

### Installation

Install the compat-finder skill into your AI agent:

```bash
npx skills add HowieHz/howiehz-misc --skill compat-finder
```

The skill source code is available in [skills/compat-finder](./skills/compat-finder).

### Example Prompts

Once installed, you can ask agents to help with compat-finder tasks:

```text
I need to track down a compatibility issue across Plugin 1, Plugin 2, Plugin 3, and Plugin 4. Walk me through the next tests and narrow it down from my results.
```

```text
Scan my game's mods folder with compat-finder and find which mods are breaking startup.
```

```text
Build a compat-finder powered troubleshooting flow into my app so users can find plugin conflicts on their own.
```

```text
My compat-finder UI needs to save a troubleshooting session and resume it after a page refresh. Which API should I use, and what state should I persist?
```

### What's Included

The compat-finder skill covers:

- How to choose between one-off CLI usage and library integration
- CLI commands, options, locales, and supported answer formats
- Built-in algorithm selection, including `binary-split` and `leave-one-out`
- Guided and one-shot troubleshooting workflows
- Help turning broad requests, such as testing a mods or plugins folder, into a concrete compat-finder workflow
- The TypeScript session API and the lower-level state API
- When advanced integrations should use the lower-level state API to persist or resume sessions
- How to choose between guided triage, automatic triage, and app integration workflows

## Online Tool

Try it online: [compatibility issue finder](https://howiehz.top/misc/en/tools/compatibility-test/)

The online tool source is available at [compatibility-test](../../docs/en/tools/compatibility-test).

## Related Projects

compat-finder is a TypeScript rewrite of [HowieHz/plugin-compatibility-checking-tool](https://github.com/HowieHz/plugin-compatibility-checking-tool).

## Licenses

This project is licensed under the [MIT License](https://raw.githubusercontent.com/howiehz/howiehz-misc/HEAD/packages/compat-finder/LICENSE).

<!-- Badges -->

[npmx-version-src]: https://npmx.dev/api/registry/badge/version/compat-finder
[npmx-downloads-src]: https://npmx.dev/api/registry/badge/downloads-month/compat-finder
[npmx-href]: https://npmx.dev/compat-finder
[ci-src]: https://github.com/HowieHz/howiehz-misc/actions/workflows/nodejs-ci.yml/badge.svg
[ci-href]: https://github.com/HowieHz/howiehz-misc/actions/workflows/nodejs-ci.yml
