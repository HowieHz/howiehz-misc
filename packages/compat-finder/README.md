# compat-finder

English | [简体中文](./README.zh.md)

compat-finder is an engine and command-line tool for finding compatibility issues across multiple targets.

[Compatibility](#compatibility) | [Install](#install) | [Quick Start](#quick-start) | [CLI](#cli) | [API Reference](#api-reference) | [Work with AI](#work-with-ai) | [Online Tool](#online-tool) | [Related Projects](#related-projects)

## Compatibility

- Library: ESM-only. It has no Node.js built-in dependencies and can also run in browsers and other ESM-compatible runtimes
- CLI: requires Node.js `^20 || ^22 || >=24`; supports English and Simplified Chinese

## Install

Install with a package manager:

```bash
npm install compat-finder
pnpm add compat-finder
yarn add compat-finder
bun add compat-finder
```

You can also run the command-line tool without installing it first:

```bash
npx compat-finder --help
pnpm dlx compat-finder --help
yarn dlx compat-finder --help
bunx compat-finder --help
```

## Quick Start

### Command-line example

Run an interactive compatibility check:

```bash
compat-finder interactive --count 4
```

Run a single-step calculation and print the next result:

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

See the full [CLI](#cli) documentation for commands and options.

### Library example

```ts
import {
  applyCompatibilityTestAnswer,
  createCompatibilityTestState,
  getCurrentCompatibilityTestStep,
  skipCachedCompatibilityTestSteps,
  takeTargetsFromRanges,
} from "compat-finder";

const targetNames = ["A", "B", "C", "D"];
const state = createCompatibilityTestState(targetNames.length);

let step = getCurrentCompatibilityTestStep(state);
while (step) {
  if (!step.requiresAnswer) {
    step = skipCachedCompatibilityTestSteps(state);
    continue;
  }

  const targets = takeTargetsFromRanges(step.promptTargetRanges, step.promptTargetCount);
  console.log(
    "Targets to test:",
    targets.map((target) => targetNames[target - 1]),
  );

  const hasIssue = true;
  applyCompatibilityTestAnswer(state, hasIssue);
  step = getCurrentCompatibilityTestStep(state);
}

console.log(
  "Result:",
  state.resultTargets.map((target) => targetNames[target - 1]),
);
```

See the full [API Reference](#api-reference) overview for exported APIs.

## CLI

### Help

```bash
compat-finder --help
compat-finder --help interactive
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

Examples:

```bash
compat-finder --locale zh-Hans --help
compat-finder -l zh-Hans next -c 3 -a "y,n"
COMPAT_FINDER_LOCALE=zh-Hans compat-finder next -c 3 -a "y,n"
```

### Commands

#### `interactive`

Start an interactive compatibility check:

```bash
compat-finder interactive --count 4
compat-finder i -c 4 -n "A,B,C,D"
```

Supported input:

- `y` / `yes` / `issue` / `1`: the issue reproduces
- `n` / `no` / `pass` / `0`: the issue does not reproduce
- `u` / `undo`: undo the previous answer
- `q` / `quit`: quit

#### `next`

Calculate the next targets to test from existing answers, or return the final result:

```bash
compat-finder next -c 3
compat-finder n -c 3 -a "y,n"
compat-finder next -c 4 -a "issue,pass,1,0" -n "A,B,C,D"
```

Returned fields:

- `status`: `testing` means the current `targets` should be tested; `complete` means the final result is available
- `targetCount`: the total number of targets in the current check
- `targets`: when `status` is `testing`, the targets to test; when `status` is `complete`, the final result

Supported `answers` values:

- `y` / `yes` / `issue` / `1` / `true`: the issue reproduces
- `n` / `no` / `pass` / `0` / `false`: the issue does not reproduce

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

## API Reference

The library API is built around one mutable session state.

Session lifecycle:

- `createCompatibilityTestState(targetCount)`: create a new session
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
- `TargetRange`: inclusive target index range

For parameter details and behavior guarantees, see the inline JSDoc in [src/compatibility-test.ts](./src/compatibility-test.ts).

## Work with AI

compat-finder provides an AI coding agent skill that helps agents understand the package's compatibility-check workflow, CLI commands, and TypeScript API.

### Installation

Install the compat-finder skill to your AI coding agent:

```bash
npx skills add HowieHz/howiehz-misc --skill compat-finder --full-depth
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

### What's Included

The compat-finder skill provides knowledge about:

- CLI commands, options, locales, and answer formats
- Interactive and one-shot compatibility-check workflows
- The TypeScript state-machine API and target range utilities
- Package source layout, tests, and workspace commands
- Documentation update expectations for CLI and API changes

## Online Tool

Try it online: [compatibility issue finder](https://howiehz.top/misc/en/tools/compatibility-test/)

The online tool source is available at [compatibility-test](../../docs/en/tools/compatibility-test).

## Related Projects

compat-finder is a TypeScript rewrite of [HowieHz/plugin-compatibility-checking-tool](https://github.com/HowieHz/plugin-compatibility-checking-tool).
