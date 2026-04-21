---
name: compat-finder
description: Guide compatibility issue triage with the compat-finder package. Use whenever Codex has an ordered target list plus pass/issue results, needs to choose next targets, continue an unfinished compat-finder session, decide between guided and automatic triage, choose the compat-finder CLI or TypeScript API, interpret `interactive` or `next` output, or implement, test, or document changes under `packages/compat-finder`.
---

# Compat Finder

Start by choosing the smallest matching workflow. Read only the referenced file needed for that workflow:

- Continue or plan a compatibility check:
  Read [references/cli-and-api.md](./references/cli-and-api.md). Prefer the CLI when the user wants the next targets to test or a terminal session.
- Embed the engine into code:
  Read [references/cli-and-api.md](./references/cli-and-api.md). Prefer the TypeScript session API unless the caller explicitly needs low-level range control.
- Change or review the package implementation:
  Read [references/package-map.md](./references/package-map.md) before opening source files or tests.

Keep the response centered on the user's actual triage state. Avoid re-explaining the whole package unless the request is explicitly about package internals.

Run package commands from the repository root. Assume Node.js, pnpm, and workspace dependencies are available only after verifying the relevant command can run; if dependency setup is missing, report the missing prerequisite instead of guessing at results.

Before continuing a compatibility check, determine which triage mode the user wants:

- interactive guided triage:
  The user runs the real test after each step and reports whether the issue reproduced. Act like a conversational wrapper around the CLI flow and do not ask for the test command or machine-executable success criteria up front.
- automatic triage:
  Codex runs the real test loop, interprets each result, and continues until it can summarize the conclusion. Before starting, confirm how to execute the real test, how to detect `issue` versus `pass`, and any setup or environment constraints that affect the result.

If the user asks for a broad "scan" or "find what breaks" task, treat it as automatic triage only after target discovery, the real test command or procedure, and the issue/pass signal are concrete enough to execute.

Concrete user prompts this skill should handle:

- "I have 12 browser extension versions and I tested `issue, pass` for the first two compat-finder prompts. Tell me the next versions to try; I will run the test myself."
- "Automatically narrow which one of these five feature flags breaks login. Use `pnpm test:login -- --flags <targets>` and treat exit code 0 as pass, nonzero as issue."
- "I'm changing the compat-finder CLI locale output. Which source files, tests, README examples, and validation commands need to stay aligned?"

## Choose The Interface

Use the CLI when the user already has targets and wants one of these outcomes:

- wants an interactive narrowing flow in the terminal via `interactive`
- wants a stateless "what should I test next?" answer via `next`
- wants localized help or output for `en` or `zh-Hans`

Use the library API when the caller needs to:

- embed the high-level `createCompatibilitySession` flow
- persist session state in their own app
- render prompts in a custom UI
- inspect `CompatibilityTestStep.debug` or operate directly on target ranges
- replay answers and skip cached steps programmatically

Prefer `createCompatibilitySession(targets)` for integrations. Drop to the low-level state helpers only when the caller truly needs custom prompt-range handling or debug-oriented control.

## Handle Missing Triage Details

When the user omits triage details or real-test execution details, infer only the minimum needed to keep the compat-finder workflow moving.

It is safe to infer:

- whether `interactive` or `next` fits the current request
- how to normalize provided answers to `issue`/`pass` or `true`/`false`
- the next target set to test from existing answers

Do not invent new screening criteria, test procedures, or toggle semantics.
In automatic triage mode, when missing details affect what counts as an issue, how the test is executed, or which checks should be enabled, state the assumption explicitly and ask the user to confirm before continuing.
In interactive guided triage mode, do not block on test-command details that only the user needs to execute locally.

## Continue Or Plan A Compatibility Check

When the user provides target names and prior answers, prefer `compat-finder next` because it is deterministic and JSON-friendly.

Use this mode split before running commands or asking the user to test:

1. Ask whether the user wants interactive guided triage or automatic triage unless the request already makes that clear.
2. For interactive guided triage, compute the next targets and ask the user to run the test and report back `issue` or `pass`.
3. For automatic triage, confirm the test command, environment, and issue/pass decision rule before running anything.
4. Then continue the compat-finder loop until the next step or final result is clear.

During automatic triage, report each completed round with the tested targets, the command or procedure used, the observed signal, the normalized `issue` or `pass` answer, and the next targets or final result. At the end, summarize the incompatible target set, assumptions, and any runs that could not be interpreted confidently.

Use this sequence:

1. Normalize the target count and optional names.
2. Normalize answers to booleans using the accepted CLI vocabulary.
3. Run `next` to get either the next `targets` or the final result.
4. If the task is conversational, restate the JSON result in plain language after verifying it.

Examples:

```bash
pnpm cli:compat-finder -- next -c 4 -n "Alpha,Beta,Gamma,Delta" -a "y,n"
npx compat-finder next -c 4 -a "issue,pass"
```

If the user wants a full terminal-driven session, use:

```bash
pnpm cli:compat-finder -- interactive -c 4 -n "Alpha,Beta,Gamma,Delta"
```

If the user reports results from a real test run instead of raw CLI answers, translate them back into `issue` or `pass` before deciding the next targets.

## Embed the Engine

For most code integrations, use `createCompatibilitySession(targets)` and follow this loop:

1. Create a session with the user's target list.
2. Read the current step with `session.current()`.
3. Test `step.targets`.
4. Feed the result back with `session.answer(hasIssue)`.
5. Use `session.undo()` if the latest answer was entered by mistake.
6. Read final `step.targets` after `step.status === "complete"`.

Use the lower-level state API only when the caller needs custom range/debug control:

1. Create state with `createCompatibilityTestState(targetCount)`.
2. Read the current step with `getCurrentCompatibilityTestStep(state)`.
3. If `requiresAnswer` is false, call `skipCachedCompatibilityTestSteps(state)`.
4. Convert `promptTargetRanges` to concrete targets with `takeTargetsFromRanges(...)`.
5. Collect the test result and feed it back with `applyCompatibilityTestAnswer(state, hasIssue)`.
6. Read `state.resultTargets` after completion.

Do not reimplement the search algorithm unless the task explicitly requires changing package internals; reuse the exported session API instead.

## Modify the Package

When editing `packages/compat-finder`, check the package map reference before changing code. In particular:

- Keep CLI behavior aligned with the README examples and localized help text.
- Update or add Vitest coverage for parser changes, output changes, and algorithm changes.
- Use the package scripts from the workspace root:
  - `pnpm compat-finder:test`
  - `pnpm compat-finder:build`
- If exported API behavior changes, update both `README.md` and `README.zh.md`.

## Validation

After edits, run the narrowest useful checks first.

- For docs-only skill changes, run `pnpm exec markdownlint --fix "packages/compat-finder/skills/**/*.md"` and `pnpm exec oxfmt --write "packages/compat-finder/skills/**/*.{yaml,md}"`.
- For package behavior changes, run `pnpm compat-finder:test`.
- For build-facing changes, also run `pnpm compat-finder:build`.
