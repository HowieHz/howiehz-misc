---
name: compat-finder
description: Handles compat-finder CLI triage and TypeScript integrations. Triggers when the user is using compat-finder, continuing a compat-finder narrowing session, interpreting `interactive` or `next` output or CLI parser errors, choosing between guided and automatic triage, selecting between `binary-split` and `leave-one-out`, or turning ordered versions, plugins, mods, flags, or config targets into a compat-finder workflow. Also covers locale, undo, accepted answers, extra-answer validation, persistence, save/resume, and session API versus lower-level state API questions. Excludes generic test planning, git bisect, and unrelated troubleshooting.
---

# Compat Finder

Start with one path and read only the matching reference:

- CLI triage or CLI questions:
  Read [references/cli.md](./references/cli.md). Use this for `interactive` vs `next`, next targets, prior `issue`/`pass` answers, locale, undo, parser errors, built-in algorithm selection, broad scan setup, or interpreting compat-finder JSON output.
- TypeScript integration:
  Read [references/library-api.md](./references/library-api.md). Use this for installation, `createCompatibilitySession`, algorithm selection, save/resume support, lower-level state helpers, or custom UI integrations.

Keep the answer anchored to the user's current compat-finder state. Do not expand into generic QA planning, folder-debugging advice, or git bisect unless the user is explicitly leaving compat-finder behind.

## Route The Request

1. CLI triage:
   The user is already running compat-finder, asks what to test next, wants guided vs automatic triage, asks about CLI output or errors, asks which built-in algorithm to use, or wants to derive a target list for compat-finder. Read [references/cli.md](./references/cli.md).
2. Library integration:
   The user wants to embed compat-finder in code, pick between `binary-split` and `leave-one-out`, persist state, resume sessions, or drive a custom UI. Read [references/library-api.md](./references/library-api.md).
3. Out of scope:
   The user wants generic regression isolation, manual QA planning, or a custom algorithm that should not use compat-finder. Do not force this skill.

If earlier turns already established compat-finder context, treat short follow-ups such as "what should I test next?" or "can I undo that round?" as still in scope.

## Inference Limits

Infer only the minimum needed to keep the workflow moving.

It is safe to infer:

- whether the request fits CLI triage or library integration
- whether `interactive` or `next` is the better CLI entrypoint
- whether the caller should stay on the default `binary-split` algorithm or explicitly switch to `leave-one-out`
- how to normalize provided answers to compat-finder's accepted vocabulary
- the next target set to test from already-known compat-finder answers

Do not invent:

- a real test command or pass/issue rule for automatic triage
- a subset-launch procedure for a folder scan when none exists yet
- a custom search algorithm when the user asked about compat-finder

## Success Criteria

Before answering, make sure:

- the path is explicit: CLI triage, integration, or out of scope
- the next action is concrete
- CLI answers and results are normalized to `issue` or `pass` when applicable
- blockers are called out as missing execution details instead of guessed results
- integration guidance defaults to `createCompatibilitySession(targets)` unless the caller explicitly needs lower-level control
