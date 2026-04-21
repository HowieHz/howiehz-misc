# Skills Generation Information

This document contains information about how these skills were generated and how to keep them synchronized with the package documentation and source files.

## Generation Details

**Generated from package sources at:**

- **Commit SHA**: `7c1bd0c1ad9d5b64ea1907405ea463764ec379a8`
- **Date**: 2026-04-21
- **Commit**: compat-finder: check tools and handle blockers

**Source documentation:**

- Package docs: `/packages/compat-finder/README.md`
- Package docs (Chinese): `/packages/compat-finder/README.zh.md`
- Source code: `/packages/compat-finder/src`
- Tests: `/packages/compat-finder/__tests__`
- Package manifest: `/packages/compat-finder/package.json`

**Generation date**: 2026-04-21

## Structure

```text
packages/compat-finder/skills/
├── GENERATION.md
└── compat-finder/
    ├── SKILL.md
    ├── agents/
    │   └── openai.yaml
    ├── evals/
    │   └── evals.json
    └── references/
        ├── cli-and-api.md
        └── package-map.md
```

## File Naming Convention

Reference files are named by scope:

- `cli-and-api.md` - CLI behavior, answers, locales, and library API usage
- `package-map.md` - Package layout, tests, workspace commands, and update guidance

## Reference Files

### Core References (2 files)

- `cli-and-api.md` - CLI commands, locale handling, answer vocabulary, and TypeScript API flow
- `package-map.md` - Source file responsibilities, tests, docs, and workspace commands

## How to Update Skills

When compat-finder documentation or behavior changes:

### 1. Check for Package Changes

```bash
# Get changes in the package since generation
git diff 7c1bd0c..HEAD -- packages/compat-finder/

# List changed package files
git diff --name-only 7c1bd0c..HEAD -- packages/compat-finder/

# Get summary of package changes
git log --oneline 7c1bd0c..HEAD -- packages/compat-finder/
```

### 2. Update Process

**For minor changes** (wording, examples, help text clarifications):

- Update the relevant file in `compat-finder/references/`
- Update `compat-finder/SKILL.md` if the quick-start workflow or triggering guidance changes
- Update package README sections if the user-facing examples or installation flow change

**For CLI or API changes:**

- Update `compat-finder/references/cli-and-api.md`
- Update `compat-finder/SKILL.md` examples and workflow steps
- Update `/packages/compat-finder/README.md` and `/packages/compat-finder/README.zh.md` when public usage changes
- Update this file's reference summary if the scope of the references changes

**For package structure changes:**

- Update `compat-finder/references/package-map.md`
- Update the structure tree in this file
- Update this file with the new SHA and date

### 3. Update Checklist

- [ ] Read the diff of `packages/compat-finder/` since the last generation
- [ ] Update affected files in `compat-finder/references/`
- [ ] Update `compat-finder/SKILL.md` examples and workflow guidance
- [ ] Update `compat-finder/evals/evals.json` when workflow guidance changes need regression coverage
- [ ] Update `/packages/compat-finder/README.md` and `/packages/compat-finder/README.zh.md` if needed
- [ ] Update this `GENERATION.md` with the new SHA and date

## Style Guidelines

- Practical, actionable guidance
- Short examples that match real compatibility-troubleshooting scenarios
- Favor package-specific behavior over generic AI advice
- Keep `SKILL.md` focused on workflows and move detail into `references/`

## Version History

| Date       | SHA     | Changes                                                                    |
| ---------- | ------- | -------------------------------------------------------------------------- |
| 2026-04-21 | 7c1bd0c | Add tool availability checks, automatic triage blockers, and blocker eval  |
| 2026-04-21 | b7e1c9f | Add compat-finder skill evals and compact triage response shapes           |
| 2026-04-21 | 54db511 | Improve compat-finder skill docs and metadata                              |
| 2026-04-21 | a7d5a9b | Improve compat-finder skill command prerequisites and triage reporting     |
| 2026-04-21 | 075fe30 | Sync library session example with askUser, answer, and undo flow           |
| 2026-04-21 | 1984a7c | Expand README examples and refresh the generated skill baseline            |
| 2026-04-21 | eeac00c | Update locale guidance to zh-Hans and align API behavior notes with JSDoc  |
| 2026-04-20 | 03fe803 | Initial compat-finder skill generation with CLI/API and package references |

---

Last updated: 2026-04-21
Current SHA: 7c1bd0c
