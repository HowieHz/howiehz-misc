---
publish: false
outline: deep
---

# Maintenance Guide

This document is for repository maintainers and code contributors. If you only want to submit or revise public site content, see the [Contribution Guide](/en/maintenance/submission).

## Primary Directories

- `docs/`: the VitePress site and online tool pages
- `packages/compat-finder/`: the compatibility troubleshooting library and CLI

## Development Environment

### Install Dependencies

Install Node.js and pnpm first, then run this in the repository root:

```bash
pnpm install
```

If you need to format Java code or build `graphwar-agent`, make sure `java`, `javac`, and `jar` are available on `PATH`. JDK 21 is recommended and is also used in CI.

## Common Commands

### Docs Site

- Start the docs development server with hot reload: `pnpm docs:watch`
- Build the docs site: `pnpm docs:build`
- Build the docs site and start the preview server: `pnpm docs:preview`

### compat-finder Package

- Run the CLI directly: `pnpm compat-finder:cli`
- Build the package: `pnpm compat-finder:build`
- Start watch mode: `pnpm compat-finder:watch`
- Run package tests: `pnpm compat-finder:test`

### Local Checks

- Format files: `pnpm fmt`. Java files are formatted with `google-java-format` in AOSP style, and the formatter jar is cached under `.cache/google-java-format/`
- Run linting and type checks: `pnpm lint`
- Run all tests: `pnpm test`

### Changesets

- Create a release note entry: `pnpm changeset`
- Add a changeset when a change affects any published workspace package; do not add one for docs-only changes, public content edits, or internal cleanup that does not affect published package behavior
- Follow the prompt to select the affected published package and the appropriate semver bump: `patch`, `minor`, or `major`
- Commit the generated `.changeset/*.md` file together with the code changes

## CI Checks

### Repository-wide Checks

[`nodejs-ci.yml`](https://github.com/HowieHz/howiehz-misc/blob/main/.github/workflows/nodejs-ci.yml) runs on pull requests and pushes to `main`. It mainly covers:

- `pnpm fmt`
- `pnpm lint`
- `pnpm test`

Formatting and some auto-fix steps may commit corrections back automatically when the PR branch is in this repository. When the PR branch is in a fork, CI runs checks only; if fixes are produced, CI uploads `ci-autofix.patch`. Contributors can copy the patch link from the CI job summary and run the matching commands locally on the PR branch.

Linux / macOS:

```shell
curl -L -o ci-autofix.patch "<ci-autofix.patch link>" && git apply ci-autofix.patch
```

Windows PowerShell:

```powershell
Invoke-WebRequest -Uri "<ci-autofix.patch link>" -OutFile ci-autofix.patch; git apply ci-autofix.patch
```

### PR Build Checks

- [`pr-docs-build.yml`](https://github.com/HowieHz/howiehz-misc/blob/main/.github/workflows/pr-docs-build.yml): verifies that the docs site builds successfully
- [`pr-compat-finder-build.yml`](https://github.com/HowieHz/howiehz-misc/blob/main/.github/workflows/pr-compat-finder-build.yml): verifies that the `compat-finder` package builds successfully

## Related Documentation

If you are editing public content pages or tool documentation, also refer to:

- the [Contribution Guide](/en/maintenance/submission)
- the `README.md` file in the relevant directory when available

## Release Guide

See the [Release Guide](./releases.md) for release flow, versioning rules, and release PR behavior.
