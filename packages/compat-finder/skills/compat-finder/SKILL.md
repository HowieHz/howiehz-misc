---
name: compat-finder
description: Guide compatibility issue triage with the compat-finder package in this repository. Use when Codex needs to plan or continue a compatibility check across multiple targets, choose between the compat-finder CLI and TypeScript API, interpret interactive or next command results, map user-reported test outcomes to the next targets to verify, or implement and document changes under packages/compat-finder.
---

# Compat Finder

## Overview

Use this skill to work effectively with the `packages/compat-finder` package as either a CLI tool or a TypeScript library.
Prefer this skill when the task is about narrowing incompatible targets, continuing an existing test session, or editing the package itself.

## Quick Start

Start by deciding which of these tasks the user actually wants:

- Continue or plan a compatibility check:
  Read [references/cli-and-api.md](./references/cli-and-api.md) and use the CLI when the user wants a concrete next step from known answers.
- Embed the engine into code:
  Read [references/cli-and-api.md](./references/cli-and-api.md) and wire the TypeScript state-machine API into the caller.
- Change or review the package implementation:
  Read [references/package-map.md](./references/package-map.md) first, then inspect the relevant source and tests.

## Choose the Interface

Use the CLI when the user already has a list of targets and either:

- wants an interactive narrowing flow in the terminal via `interactive`
- wants a stateless "what should I test next?" answer via `next`
- wants localized help or output for `en` or `zh-CN`

Use the library API when the caller needs to:

- persist session state in their own app
- render prompts in a custom UI
- inspect `CompatibilityTestStep.debug` or operate directly on target ranges
- replay answers and skip cached steps programmatically

## Continue a Compatibility Check

When the user provides target names and prior answers, prefer `compat-finder next` because it is deterministic and JSON-friendly.

Use this pattern:

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

## Embed the Engine

For code integration, keep the state in the caller and follow this loop:

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

- For docs-only skill changes, run the skill validator on this skill directory.
- For package behavior changes, run `pnpm compat-finder:test`.
- For build-facing changes, also run `pnpm compat-finder:build`.
