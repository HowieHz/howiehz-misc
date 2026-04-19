# compat-finder

English | [**简体中文**](./README.zh.md)

compat-finder is an engine and command-line tool for finding compatibility issues across multiple targets.

It is a TypeScript rewrite of [HowieHz/plugin-compatibility-checking-tool](https://github.com/HowieHz/plugin-compatibility-checking-tool).

## Install

Install with a package manager:

```bash
pnpm add compat-finder
```

You can also run the command-line tool without installing it first:

```bash
npx compat-finder --help
```

## Quick Start

### Command-line example

Run an interactive compatibility check:

```bash
compat-finder interactive --count 4
```

Run a single-step calculation and print the result:

```bash
compat-finder next -c 3 -a "y,n"
```

Expected JSON output:

```json
{
  "status": "testing",
  "targetCount": 3,
  "targets": ["目标 2"]
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

See the full [API](#api) documentation for exported APIs.

## CLI

### Help

```bash
compat-finder --help
compat-finder --help interactive
compat-finder --help next
```

### Commands

#### `interactive`

Start an interactive compatibility check:

```bash
compat-finder interactive --count 4
compat-finder i -c 4 -n "A,B,C,D"
```

Supported input:

- `y` / `yes` / `issue` / `1`: the issue is present
- `n` / `no` / `pass` / `0`: the issue is not present
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

- `y` / `yes` / `issue` / `1` / `true`: the issue is present
- `n` / `no` / `pass` / `0` / `false`: the issue is not present

Example 1:

```bash
compat-finder next -c 3 -a "y"
```

Expected JSON output:

```json
{
  "status": "testing",
  "targetCount": 3,
  "targets": ["目标 1"]
}
```

Example 2:

```bash
compat-finder next -c 3 -a "y,n"
```

Expected JSON output:

```json
{
  "status": "testing",
  "targetCount": 3,
  "targets": ["目标 2"]
}
```

Example 3:

```bash
compat-finder next -c 3 -a "y,n,n"
```

Expected JSON output:

```json
{
  "status": "complete",
  "targetCount": 3,
  "targets": ["目标 1", "目标 2"]
}
```

## API

Core exports:

- `createCompatibilityTestState(targetCount)`: creates a compatibility check state
- `getCurrentCompatibilityTestStep(state)`: returns the current step
- `applyCompatibilityTestAnswer(state, hasIssue)`: applies the answer for the current step
- `skipCachedCompatibilityTestSteps(state)`: skips steps that already have cached answers
- `takeTargetsFromRanges(ranges, limit)`: expands ranges into target indexes

## Online Tool

The online version is available at [docs/tools/compatibility-test](../../docs/tools/compatibility-test/).

## Source Layout

- [src/compatibility-test.ts](./src/compatibility-test.ts) contains the TypeScript engine implementation
- [src/cli-main.ts](./src/cli-main.ts) contains the command-line tool logic
- [src/cli.ts](./src/cli.ts) is the command-line entrypoint
- [src/legacy.py](./src/legacy.py) contains the original Python implementation
- [`__tests__`](./__tests__/) contains tests for the engine and command-line tool
