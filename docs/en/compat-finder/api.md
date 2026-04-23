# API Reference

Use `createCompatibilitySession` for most integrations.

## Simple Session API

- `createCompatibilitySession(targets, options?)`: create a compatibility session from your target list
- `session.current()`: read the current step or final result
- `session.answer(hasIssue)`: submit one result and move to the next step
- `session.undo()`: remove the latest answer and return to the previous step

### Session Steps

- `status`: `testing` means the current `targets` should be tested; `complete` means the final result is available
- `targets`: target values from the original input list
- `targetNumbers`: 1-based target numbers for display or logs

`session.answer(true)` means the issue appears with the current targets.  
`session.answer(false)` means the issue does not appear with the current targets.  
`session.undo()` is useful when the latest answer was entered by mistake.  
`createCompatibilitySession(targets)` requires at least one target.

### Algorithm Selection

- Default: `binary-split`
- Alternative: `leave-one-out`
- Example: `createCompatibilitySession(targets, { algorithm: "leave-one-out" })`

## Advanced API

The lower-level API exposes the mutable range-based state machine for custom UIs, persistence, and diagnostics.

If you only need a higher-level flow that already manages the session for you, you usually do not need to start here.

### Session Lifecycle

- `createCompatibilityTestState(targetCount, options?)`: create a new session
- `getNextAnswerableCompatibilityTestStep(state)`: read the next actionable step and automatically skip cached steps
- `getCurrentCompatibilityTestStep(state)`: read the current step, or `undefined` when complete
- `applyCompatibilityTestAnswer(state, hasIssue)`: apply one answer and advance the session
- `skipCachedCompatibilityTestSteps(state)`: fast-forward through cached steps

### Range Utilities

- `takeTargetsFromRanges(ranges, limit)`: expand ranges into target indexes
- `countTargetsInRanges(ranges)`: count targets covered by ranges
- `intersectTargetRanges(leftRanges, rightRanges)`: intersect two range lists
- `subtractTargetRanges(sourceRanges, excludedRanges)`: remove one range list from another

### Key Types

- `CompatibilityTestState`: mutable session state
- `CompatibilityTestStep`: current step to present to the caller
- `CompatibilityTestDebugStep`: internal search state in range form
- `CompatibilityTestAlgorithm`: built-in algorithm names
- `CompatibilityTestOptions`: shared option bag for session and state creation
- `TargetRange`: inclusive target index range

For parameter details and behavior guarantees, see the inline JSDoc under `src/compatibility-test/`.
