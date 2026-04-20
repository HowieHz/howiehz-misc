# Skills Generation Information

This document contains information about how these skills were generated and how to keep them synchronized with the package documentation and source files.

## Generation Details

**Generated from package sources at:**

- **Commit SHA**: `03fe80352da09d73b1c2ec5756e900ba32f37502`
- **Date**: 2026-04-20
- **Commit**: Refine compat-finder example prompts

**Source documentation:**

- Package docs: `/packages/compat-finder/README.md`
- Package docs (Chinese): `/packages/compat-finder/README.zh.md`
- Source code: `/packages/compat-finder/src`
- Tests: `/packages/compat-finder/__tests__`
- Package manifest: `/packages/compat-finder/package.json`

**Generation date**: 2026-04-20

## Structure

```text
packages/compat-finder/skills/
├── GENERATION.md
└── compat-finder/
    ├── SKILL.md
    ├── agents/
    │   └── openai.yaml
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
git diff 03fe803..HEAD -- packages/compat-finder/

# List changed package files
git diff --name-only 03fe803..HEAD -- packages/compat-finder/

# Get summary of package changes
git log --oneline 03fe803..HEAD -- packages/compat-finder/
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
- [ ] Update `/packages/compat-finder/README.md` and `/packages/compat-finder/README.zh.md` if needed
- [ ] Update this `GENERATION.md` with the new SHA and date

## Style Guidelines

- Practical, actionable guidance
- Short examples that match real compatibility-troubleshooting scenarios
- Favor package-specific behavior over generic AI advice
- Keep `SKILL.md` focused on workflows and move detail into `references/`

## Version History

| Date       | SHA     | Changes                                                                       |
| ---------- | ------- | ----------------------------------------------------------------------------- |
| 2026-04-21 | eeac00c | Update locale guidance to zh-Hans and align API behavior notes with JSDoc     |
| 2026-04-20 | 03fe803 | Initial compat-finder skill generation with CLI/API and package references    |

---

Last updated: 2026-04-21
Current SHA: eeac00c
