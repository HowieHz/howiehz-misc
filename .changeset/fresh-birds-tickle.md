---
"compat-finder": minor
---

Add `getNextAnswerableCompatibilityTestStep(state)` as the primary low-level helper, align the CLI and docs around it, and make `compat-finder next` return `extraAnswerCount` instead of failing on extra `--answers` values.
