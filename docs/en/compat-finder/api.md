# API Reference

Most integrations should start with the [Simple Session API](#simple-session-api).

## Simple Session API

- `createCompatibilitySession<Target>(targets: readonly Target[], options?: CompatibilityTestOptions): CompatibilitySession<Target>`: create a compatibility session from your target list

### Returned Object: `CompatibilitySession<Target>`

- `current(): CompatibilitySessionStep<Target>`: read the current step or final result
- `answer(hasIssue: boolean): CompatibilitySessionStep<Target>`: submit one result and move to the next step
- `undo(): CompatibilitySessionStep<Target>`: remove the latest answer and return to the previous step

### Return Value of `current()` / `answer()` / `undo()`

Shape:

```js
// status === "testing"
{
  status: "testing",
  targets: ["B", "C"],
  targetNumbers: [2, 3],
}

// status === "complete"
{
  status: "complete",
  targets: ["C"],
  targetNumbers: [3],
}
```

- When `status: "testing"`:
  `targets` is the list of target values to test in the current round
  `targetNumbers` is the list of 1-based indexes for those targets in the original `targets` input list
- When `status: "complete"`:
  `targets` is the final list of incompatible target values
  `targetNumbers` is the list of 1-based indexes for those targets in the original `targets` input list

### Call Semantics

- `answer(true)`: the issue appears with the current targets
- `answer(false)`: the issue does not appear with the current targets
- `undo()`: remove the latest answer
- `createCompatibilitySession(targets)`: `targets` must contain at least one item

### Algorithm Selection

Only pass `algorithm` when you want to switch strategies.

- Omit `algorithm`: use the default `binary-split` strategy
- Set `algorithm: "leave-one-out"`: switch to testing by excluding one target per round
- Default usage: `createCompatibilitySession(targets)`
- Switching example: `createCompatibilitySession(targets, { algorithm: "leave-one-out" })`

## Advanced API

The lower-level API exposes the mutable range-based state machine for custom UIs, persistence, and diagnostics.

If you only need a higher-level flow that already manages the session for you, you usually do not need to start here.

### State Factory

- `createCompatibilityTestState(targetCount: number, options?: CompatibilityTestOptions): CompatibilityTestState`: create a new troubleshooting state

### State Object: `CompatibilityTestState`

- This is a mutable state object. The lower-level helpers below read from it and update it in place.

### State Operations

- `getNextAnswerableCompatibilityTestStep(state: CompatibilityTestState): CompatibilityTestStep | undefined`: read the next step that actually needs an answer, automatically skipping cached steps
- `getCurrentCompatibilityTestStep(state: CompatibilityTestState): CompatibilityTestStep | undefined`: read the current step, or `undefined` when complete
- `applyCompatibilityTestAnswer(state: CompatibilityTestState, hasIssue: boolean): CompatibilityTestStep | undefined`: apply one result and advance the state
- `skipCachedCompatibilityTestSteps(state: CompatibilityTestState): CompatibilityTestStep | undefined`: fast-forward through cached steps

### Step Return Value: `CompatibilityTestStep`

- `promptTargetRanges`: target ranges to test in the current step
- `promptTargetCount`: number of targets covered by the current step
- `debug`: internal search state for diagnostics or custom UIs
- `requiresAnswer`: whether the caller needs to provide a new result for this step

Shape:

```js
{
  promptTargetRanges: [{ start: 2, end: 3 }],
  promptTargetCount: 2,
  debug: {
    activeTargetRange: { start: 1, end: 4 },
    pendingTargetRanges: [],
    confirmedTargetRanges: [],
  },
  requiresAnswer: true,
}
```

### Call Semantics

- `createCompatibilityTestState(targetCount)`: `targetCount` must be an integer greater than or equal to `1`
- `applyCompatibilityTestAnswer(state, true)`: the issue appears with the current step
- `applyCompatibilityTestAnswer(state, false)`: the issue does not appear with the current step
- These lower-level helpers mutate the same `state` object in place
- `undefined` return value: troubleshooting is complete

### Range Utilities

- `takeTargetsFromRanges(ranges: readonly TargetRange[], limit: number): number[]`: expand ranges into target indexes
- `countTargetsInRanges(ranges: readonly TargetRange[]): number`: count targets covered by ranges
- `intersectTargetRanges(leftRanges: readonly TargetRange[], rightRanges: readonly TargetRange[]): TargetRange[]`: intersect two range lists
- `subtractTargetRanges(sourceRanges: readonly TargetRange[], excludedRanges: readonly TargetRange[]): TargetRange[]`: remove one range list from another

### Key Types

- `CompatibilityTestState`: mutable session state
- `CompatibilityTestStep`: current step to present to the caller
- `CompatibilityTestDebugStep`: internal search state in range form
- `CompatibilityTestAlgorithm`: built-in algorithm names
- `CompatibilityTestOptions`: shared option bag for session and state creation
- `TargetRange`: inclusive target index range

For parameter details and behavior guarantees, see the inline JSDoc under [src/compatibility-test](https://github.com/HowieHz/howiehz-misc/tree/main/packages/compat-finder/src/compatibility-test).
