# compat-finder Library API

## Contents

- Install
- Session API
- Algorithm Selection
- Lower-Level State API
- Persistence Notes
- Example Loops

## Install

To use the library API, install the package first:

```bash
npm install compat-finder

# or

pnpm add compat-finder

# or

yarn add compat-finder

# or

bun add compat-finder
```

## Session API

Use `createCompatibilitySession(targets)` for most integrations.

Simple session API:

- `session.current()` reads the current step or final result.
- `session.answer(true)` means the issue appears with the current targets.
- `session.answer(false)` means the issue does not appear with the current targets.
- `session.undo()` removes the latest answer and returns to the previous step.
- Returned steps contain `status`, `targets`, and 1-based `targetNumbers`.

Typical integration loop:

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

console.log(step.targets);

function askUser(targets: readonly string[]): "issue" | "pass" | "undo" {
  console.log("Targets to test:", targets);
  return "issue"; // "issue" if it reproduces, "pass" if not, or "undo".
}
```

Use the high-level session API when the caller only needs to keep the in-memory session alive for the current process or browser tab.
If the user explicitly needs to resume after refresh, restart, or in another process or worker, switch to the lower-level state API instead.

## Algorithm Selection

Session and state creation accept an optional algorithm:

- `binary-split`:
  default search strategy
- `leave-one-out`:
  exclude one target per round

For example:

```ts
const session = createCompatibilitySession(targets, {
  algorithm: "leave-one-out",
});
```

```ts
const state = createCompatibilityTestState(targets.length, {
  algorithm: "leave-one-out",
});
```

Use `leave-one-out` when the caller explicitly wants the sequential exclusion workflow.
Keep `binary-split` as the default recommendation otherwise.

## Lower-Level State API

These lower-level helpers are exported from the public `compat-finder` package entrypoint.
The public helpers are implemented under `src/compatibility-test/`, but consumers should still import them from `compat-finder`:

```ts
import {
  applyCompatibilityTestAnswer,
  createCompatibilityTestState,
  getNextAnswerableCompatibilityTestStep,
  takeTargetsFromRanges,
} from "compat-finder";
```

Key lower-level helpers:

- `createCompatibilityTestState(targetCount, options?)`
- `getNextAnswerableCompatibilityTestStep(state)`
- `getCurrentCompatibilityTestStep(state)`
- `applyCompatibilityTestAnswer(state, hasIssue)`
- `skipCachedCompatibilityTestSteps(state)`
- `takeTargetsFromRanges(ranges, limit)`
- `countTargetsInRanges(ranges)`
- `intersectTargetRanges(leftRanges, rightRanges)`
- `subtractTargetRanges(sourceRanges, excludedRanges)`

Important behavior:

- `createCompatibilitySession(targets)` requires at least one target and throws `targets must contain at least one item` otherwise.
- `createCompatibilityTestState(targetCount)` requires an integer greater than or equal to 1 and throws otherwise.
- Supported algorithms are `binary-split` and `leave-one-out`.
- Omitting the algorithm uses `binary-split`.
- Single-target sessions are valid. The first testing step simply contains that one target.
- Target indexes are 1-based.
- `CompatibilityTestState` is mutable and owned by the caller.
- `CompatibilityTestStep.requiresAnswer === false` means the same prompt was already cached and should usually be skipped.
- `state.resultTargets` is populated only after the session stops.
- A full-target-set pass stops the session with an empty result.
- `takeTargetsFromRanges` returns expanded target indexes.
- `intersectTargetRanges` and `subtractTargetRanges` return normalized target ranges.

Use the lower-level state API when the caller explicitly needs:

- persistence or resume support across refreshes, restarts, or background jobs
- custom prompt-range handling
- cached-step control
- debug-oriented access to the underlying state machine

## Persistence Notes

Persistence considerations:

- `createCompatibilitySession(targets)` does not expose a restorable state object, so it is not the right default when the caller needs save/resume behavior.
- `CompatibilityTestState.cachedResults` is a `Map<string, boolean>`, so a direct `JSON.stringify(state)` will not preserve it correctly.
- When persisting state, serialize the map explicitly and recreate it when loading.

Example persistence shape:

```ts
import { type CompatibilityTestState } from "compat-finder";

type StoredCompatibilityState = Omit<CompatibilityTestState, "cachedResults"> & {
  cachedResults: Array<[string, boolean]>;
};

function serializeState(state: CompatibilityTestState): StoredCompatibilityState {
  return {
    ...state,
    cachedResults: Array.from(state.cachedResults.entries()),
  };
}

function deserializeState(saved: StoredCompatibilityState): CompatibilityTestState {
  return {
    ...saved,
    cachedResults: new Map(saved.cachedResults),
  };
}
```

## Example Loops

Advanced integration loop:

```ts
import {
  applyCompatibilityTestAnswer,
  createCompatibilityTestState,
  getNextAnswerableCompatibilityTestStep,
  takeTargetsFromRanges,
} from "compat-finder";

const state = createCompatibilityTestState(targetNames.length);
let step = getNextAnswerableCompatibilityTestStep(state);

while (step) {
  const targets = takeTargetsFromRanges(step.promptTargetRanges, step.promptTargetCount);
  const hasIssue = await runRealTest(targets);
  applyCompatibilityTestAnswer(state, hasIssue);
  step = getNextAnswerableCompatibilityTestStep(state);
}

console.log(state.resultTargets);
```
