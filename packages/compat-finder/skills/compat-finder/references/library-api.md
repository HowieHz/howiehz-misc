# compat-finder Library API

## Install

To use the library API, install the package first:

```bash
npm install compat-finder
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

## Lower-Level State API

Lower-level exports from `src/compatibility-test.ts`:

- `createCompatibilityTestState(targetCount)`
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
- Target indexes are 1-based.
- `CompatibilityTestState` is mutable and owned by the caller.
- `CompatibilityTestStep.requiresAnswer === false` means the same prompt was already cached and should usually be skipped.
- `state.resultTargets` is populated only after the session stops.
- A full-target-set pass stops the session with an empty result.
- `takeTargetsFromRanges` returns expanded target indexes.
- `intersectTargetRanges` and `subtractTargetRanges` return normalized target ranges.

Advanced integration loop:

```ts
const state = createCompatibilityTestState(targetNames.length);
let step = getCurrentCompatibilityTestStep(state);

while (step) {
  if (!step.requiresAnswer) {
    step = skipCachedCompatibilityTestSteps(state);
    continue;
  }

  const targets = takeTargetsFromRanges(step.promptTargetRanges, step.promptTargetCount);
  const hasIssue = await runRealTest(targets);
  step = applyCompatibilityTestAnswer(state, hasIssue);
}

console.log(state.resultTargets);
```
