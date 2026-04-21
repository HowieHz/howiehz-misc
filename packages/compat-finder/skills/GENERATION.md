# Skills Generation Information

This document contains information about how these skills were generated and how to keep them synchronized with the package documentation and source files.

## Generation Details

**Generated from package sources at:**

- **Commit SHA**: `2c4331f4c246947e2f0695edcf762f0e07d8a2b5`
- **Date**: 2026-04-21
- **Commit**: compat-finder: update docs, SHA, and wording

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
        └── cli-and-api.md
```

## File Naming Convention

Reference files are named by scope:

- `cli-and-api.md` - CLI behavior, answers, locales, and library API usage

## Reference Files

### Core References (1 file)

- `cli-and-api.md` - CLI commands, locale handling, answer vocabulary, and TypeScript API flow

## How to Update Skills

When compat-finder documentation or behavior changes:

### 1. Check for Package Changes

```bash
# Get changes in the package since generation
git diff 2c4331f..HEAD -- packages/compat-finder/

# List changed package files
git diff --name-only 2c4331f..HEAD -- packages/compat-finder/

# Get summary of package changes
git log --oneline 2c4331f..HEAD -- packages/compat-finder/
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
| 2026-04-21 | 2c4331f | Update generation metadata and agent-neutral wording                       |
| 2026-04-21 | 625f51e | Add createCompatibilitySession API                                         |
| 2026-04-21 | 52df9f0 | Expand README examples and refresh the generated skill baseline            |
| 2026-04-21 | 640710d | Update locale guidance to zh-Hans and align API behavior notes with JSDoc  |
| 2026-04-20 | 00366e2 | Initial compat-finder skill generation with CLI/API and package references |

---

Last updated: 2026-04-21
Current SHA: 2c4331f
