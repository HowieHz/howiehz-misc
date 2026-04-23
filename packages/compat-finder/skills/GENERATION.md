# Skills Generation Information

This document contains information about how these skills were generated and how to keep them synchronized with the package documentation and source files.

## Generation Details

**Generated from package sources at:**

- **Commit SHA**: `b971a447d0204d637a1f0486bad6787343515c97`
- **Date**: 2026-04-24
- **Commit**: docs: update compat-finder refs & generation

**Source documentation:**

- Package docs: `/packages/compat-finder/README.md`
- Package docs (Chinese): `/packages/compat-finder/README.zh.md`
- Source code: `/packages/compat-finder/src`
- Tests: `/packages/compat-finder/__tests__`
- Package manifest: `/packages/compat-finder/package.json`

**Generation date**: 2026-04-24

## Structure

```text
packages/compat-finder/skills/
├── GENERATION.md
└── compat-finder/
    ├── SKILL.md
    ├── agents/
    │   └── openai.yaml
    ├── evals/
    │   ├── evals.json
    │   └── trigger-evals.json
    └── references/
        ├── cli.md
        └── library-api.md
```

## File Naming Convention

Reference files are named by scope:

- `cli.md` - CLI commands, answers, locales, and command-line triage flow
- `library-api.md` - package installation and TypeScript API usage

## Reference Files

### Core References (2 files)

- `cli.md` - CLI commands, locale handling, answer vocabulary, and command-line troubleshooting flow
- `library-api.md` - package installation, session API usage, and lower-level state API guidance

## How to Update Skills

When compat-finder documentation or behavior changes:

### 1. Check for Package Changes

```bash
# Get changes in the package since generation
git diff b971a44..HEAD -- packages/compat-finder/

# List changed package files
git diff --name-only b971a44..HEAD -- packages/compat-finder/

# Get summary of package changes
git log --oneline b971a44..HEAD -- packages/compat-finder/
```

### 2. Update Process

**For minor changes** (wording, examples, help text clarifications):

- Update the relevant file in `compat-finder/references/`
- Update `compat-finder/SKILL.md` if the quick-start workflow or triggering guidance changes
- Update `compat-finder/agents/openai.yaml` when the trigger summary or default prompt should stay aligned with `SKILL.md`
- Update `compat-finder/evals/trigger-evals.json` if the trigger boundary changes
- Update package README sections if the user-facing examples or installation flow change

**For CLI or API changes:**

- Update `compat-finder/references/cli.md` and/or `compat-finder/references/library-api.md`
- Update `compat-finder/SKILL.md` examples and workflow steps
- Update `compat-finder/agents/openai.yaml` when trigger wording, routing guidance, or the default prompt summary changes
- Update `/packages/compat-finder/README.md` and `/packages/compat-finder/README.zh.md` when public usage changes
- Update this file's reference summary if the scope of the references changes

### 3. Update Checklist

- [ ] Read the diff of `packages/compat-finder/` since the last generation
- [ ] Update affected files in `compat-finder/references/`
- [ ] Update `compat-finder/SKILL.md` examples and workflow guidance
- [ ] Update `compat-finder/agents/openai.yaml` when trigger wording or routing guidance changes
- [ ] Update `compat-finder/evals/trigger-evals.json` when the trigger boundary changes
- [ ] Update `compat-finder/evals/evals.json` when workflow guidance changes need regression coverage
- [ ] Update `/packages/compat-finder/README.md` and `/packages/compat-finder/README.zh.md` if needed
- [ ] Update this `GENERATION.md` with the new SHA and date

## Style Guidelines

- Practical, actionable guidance
- Short examples that match real compatibility-troubleshooting scenarios
- Favor package-specific behavior over generic AI advice
- Keep `SKILL.md` focused on routing and decision points; move detail into `references/`
- Add a table of contents to long reference files so partial reads still expose the available sections
- Write `SKILL.md` descriptions in third person so discovery metadata stays consistent

## Version History

| Date       | SHA     | Changes                                                                             |
| ---------- | ------- | ----------------------------------------------------------------------------------- |
| 2026-04-24 | b971a44 | Update compat-finder references and refresh generation metadata                     |
| 2026-04-23 | 9a41b17 | Add algorithm selection, document `leave-one-out`, and refresh generated skill/docs |
| 2026-04-21 | 625f51e | Add createCompatibilitySession API                                                  |
| 2026-04-21 | 52df9f0 | Expand README examples and refresh the generated skill baseline                     |
| 2026-04-21 | 640710d | Update locale guidance to zh-Hans and align API behavior notes with JSDoc           |
| 2026-04-20 | 00366e2 | Initial compat-finder skill generation with CLI/API and package references          |

---

Last updated: 2026-04-24
Current SHA: b971a44
