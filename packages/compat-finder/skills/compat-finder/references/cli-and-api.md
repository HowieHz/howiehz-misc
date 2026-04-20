# compat-finder CLI and API

## CLI

Use `interactive` for a terminal session and `next` for a one-shot result.

Supported commands:

- `compat-finder interactive --count 4`
- `compat-finder i -c 4 -n "A,B,C,D"`
- `compat-finder next -c 4 -a "y,n"`
- `compat-finder n -c 4 -a "issue,pass,1,0" -n "A,B,C,D"`

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

Accepted answers:

- truthy: `y`, `yes`, `issue`, `1`, `true`
- falsy: `n`, `no`, `pass`, `0`, `false`

`interactive` also accepts:

- `u` or `undo`
- `q` or `quit`

`next` returns:

- `status`: `testing` or `complete`
- `targetCount`: total targets in the session
- `targets`: names or fallback labels for the current prompt or final result

## State-Machine API

Primary exports from `src/compatibility-test.ts`:

- `createCompatibilityTestState(targetCount)`
- `getCurrentCompatibilityTestStep(state)`
- `applyCompatibilityTestAnswer(state, hasIssue)`
- `skipCachedCompatibilityTestSteps(state)`
- `takeTargetsFromRanges(ranges, limit)`
- `countTargetsInRanges(ranges)`
- `intersectTargetRanges(leftRanges, rightRanges)`
- `subtractTargetRanges(sourceRanges, excludedRanges)`

Important behavior:

- `createCompatibilityTestState(targetCount)` requires an integer greater than or equal to 1 and throws otherwise.
- Target indexes are 1-based.
- `CompatibilityTestState` is mutable and owned by the caller.
- `CompatibilityTestStep.requiresAnswer === false` means the same prompt was already cached and should usually be skipped.
- `state.resultTargets` is populated only after the session stops.
- A full-target-set pass stops the session with an empty result.
- `takeTargetsFromRanges` returns expanded target indexes.
- `intersectTargetRanges` and `subtractTargetRanges` return normalized target ranges.

Useful integration loop:

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
