---
name: compat-finder
description: Guides compat-finder troubleshooting and integrations. Use whenever the user is actively using compat-finder, continuing a compat-finder session, or clearly trying to turn versions, plugins, mods, flags, or file-based plugin or mod targets into a compat-finder workflow, even if they do not repeat the package name in every follow-up. Handle prior `issue`/`pass` results, `interactive` or `next` output, one-off CLI usage, broad folder-to-target setup, locale or undo questions, and TypeScript session/state API integrations. Do not use for generic test planning, unrelated troubleshooting, or git bisect style workflows that do not involve compat-finder.
---

# Compat Finder

Start with the smallest matching workflow. Read only the reference you need:

- Continue or plan a compat-finder check:
  Read [references/cli.md](./references/cli.md). Use this when the user needs the next targets to test, wants a guided terminal flow, needs install/run instructions for the CLI, or wants help interpreting `interactive` or `next` output.
- Embed compat-finder into code:
  Read [references/library-api.md](./references/library-api.md). Use this when the user is integrating compat-finder into an app, service, script, or custom UI.

Keep the response centered on the user's current compat-finder state. Do not broaden into generic troubleshooting advice when the request is really about another tool or workflow.

Before running commands, verify that the required tool is available instead of assuming compat-finder, `npx`, `npm`, or the caller's package manager is already installed.

Typical requests this skill should handle:

- "I already have `issue, pass`. What should I test next?"
- "Should I use `interactive` or `next` for this CLI session?"
- "Turn this mods folder and launch command into a compat-finder triage loop."
- "How do I persist and resume a compat-finder session in my UI?"

## Route The Request

Choose one path before answering:

1. CLI triage:
   The user wants the next targets to test, wants a guided terminal loop, has prior compat-finder answers or JSON output, or wants to run compat-finder without embedding it into code. Read [references/cli.md](./references/cli.md).
2. Library integration:
   The user wants to add compat-finder to code, persist session state, render a custom UI, or use the TypeScript session/state APIs. Read [references/library-api.md](./references/library-api.md).

If the request is not actually about compat-finder, do not force this skill onto it. Examples that should usually stay outside this skill:

- generic "what should I test next?" requests with no compat-finder context
- git bisect or commit-level regression isolation
- general QA planning, feature-flag strategy, or incident response workflows that do not use compat-finder

If earlier turns already established compat-finder context, treat short follow-ups such as "what should I test next?" or "can I undo that round?" as still in scope even when the user does not repeat the package name.

## Choose The Triage Mode

When handling CLI troubleshooting, determine which mode fits first:

- interactive guided triage:
  The user runs the real test after each round and reports whether the issue reproduces. Act like a conversational wrapper around the CLI flow. Do not ask for the test command up front when the user is doing the real test manually.
- automatic triage:
  The agent runs the real test loop and keeps advancing. Before starting, confirm the exact test command or procedure, the `issue` versus `pass` rule, and any setup constraints that affect interpretation.

If the user asks for a broad "scan" or "find what breaks" task, treat it as automatic triage only after the target list, real test command or procedure, and issue/pass signal are concrete enough to execute.

## Handle Broad Scan Requests

When the user starts from a folder, mod pack, plugin directory, or another broad collection instead of a ready-made target list, first turn the request into an executable compat-finder workflow:

1. Identify the concrete target set:
   list the specific plugins, mods, builds, flags, or file-based plugin/mod targets that will become compat-finder targets.
2. Identify the real test procedure:
   define the exact command or manual procedure that tests only the currently selected targets.
3. Identify the `issue` versus `pass` rule:
   map the observed behavior to compat-finder's normalized vocabulary.
4. Only then continue as automatic triage.

For directory-style requests, prefer this shape:

```text
Mode: automatic triage
Targets: <the concrete target names that will be tested>
How the targets were derived: <directory listing, manifest entries, feature flag list, or other source>
Real test command or procedure: <exact command or short procedure using only the selected targets>
`issue` rule: <what counts as reproducing the problem>
`pass` rule: <what counts as not reproducing it>
Next step: <run the first compat-finder round or ask for the missing detail that blocks it>
```

If the user only says "scan this folder" but there is no way yet to test a selected subset, stop and ask for the missing execution detail instead of pretending compat-finder can infer one.

## Continue Or Plan A CLI Check

When the user already has target names and prior answers, prefer `compat-finder next` because it is deterministic and JSON-friendly. Use [references/cli.md](./references/cli.md) for accepted answer values, CLI syntax, locale behavior, and install/run examples.

Use this sequence:

1. Decide whether the request is interactive guided triage or automatic triage unless that is already explicit.
2. Normalize target names, target count, and any provided answers to the accepted compat-finder vocabulary.
3. For interactive guided triage:
   compute the next targets and ask the user to run the test and report back `issue` or `pass`.
4. For automatic triage:
   confirm the test command, environment, and issue/pass rule before running anything.
5. Continue until the next step or final result is clear.

For interactive guided triage, prefer this response shape:

```text
Mode: interactive guided triage
Known answers: <normalized prior answers>
Next targets to test: <targets>
How to reply: report `issue` if the problem reproduces, `pass` if it does not
```

For automatic triage, report each completed round with:

- tested targets
- exact command or short procedure
- observed signal
- normalized `issue` or `pass` result
- next targets or final conclusion

If the real test cannot be interpreted confidently, stop instead of guessing. Distinguish between:

- a product result:
  the real test ran and the observed signal maps cleanly to `issue` or `pass`
- an execution problem:
  the real test did not run correctly, setup is incomplete, or the signal is ambiguous

When blocked, prefer this response shape:

```text
Mode: automatic triage
Tested targets: <targets or "not run">
Command or procedure: <exact command or short procedure>
Blocker: <missing dependency, setup issue, ambiguous signal, or other execution problem>
Why it is blocked: <brief evidence>
What is needed: <the exact clarification or environment fix required>
```

## Handle Integration Requests

For most code integrations, prefer `createCompatibilitySession(targets)`. Use [references/library-api.md](./references/library-api.md) for the concrete session loop, install step, API details, and lower-level state helpers.

Only drop to the lower-level state API when the caller explicitly needs custom prompt-range handling, custom persistence, cached-step control, or debug-oriented access to the underlying state.

Do not reimplement the search algorithm unless the task explicitly requires changing package internals.

## Handle Missing Details

Infer only the minimum needed to keep the workflow moving.

It is safe to infer:

- whether the request fits CLI triage or library integration
- whether `interactive` or `next` fits the current CLI request
- how to normalize provided answers to compat-finder's accepted `issue`/`pass` style vocabulary
- the next target set to test from already-known compat-finder answers

Do not invent new pass/fail rules, test procedures, target ordering, or toggle semantics.
In automatic triage mode, when missing details affect what counts as an issue, how the test is executed, or which checks should run, state the assumption explicitly and ask the user to confirm before continuing.

## Success Criteria

Before sending the answer, verify that it matches the chosen workflow:

- the triage mode or integration path is explicit
- the next action is concrete instead of re-explaining compat-finder in general terms
- prior answers and new results are normalized to compat-finder's accepted `issue` or `pass` vocabulary when applicable
- the user's real test command, procedure, or persistence requirement is preserved instead of being silently rewritten
- blockers are labeled as execution problems instead of guessed product results
- integration guidance defaults to `createCompatibilitySession(targets)` unless the caller explicitly needs lower-level control such as persistence or cached-step handling
