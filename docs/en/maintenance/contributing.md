---
publish: false
outline: deep
---

# Maintenance Guide

This document is for repository maintainers and code contributors. If you only want to submit or revise public site content, see the [Contribution Guide](/en/maintenance/submission).

## Project Structure

- `docs/`: the VitePress site and online tool pages
- `packages/compat-finder/`: the compatibility-check engine and command-line package

## Development Environment

### Install Dependencies

Install Node.js and pnpm first, then run this in the repository root:

```bash
pnpm install
```

### Common Commands

#### Docs Site

- Start the docs development server with hot reload: `pnpm docs:watch`
- Build the docs site: `pnpm docs:build`
- Build the docs site and start the preview server: `pnpm docs:preview`

#### compat-finder Package

- Build the package: `pnpm compat-finder:build`
- Start watch mode: `pnpm compat-finder:watch`
- Run package tests: `pnpm compat-finder:test`

#### Local Checks

- Format files: `pnpm fmt`
- Run linting and type checks: `pnpm lint`
- Run all tests: `pnpm test`

## Using Vue in Markdown

VitePress compiles every Markdown file into a Vue single-file component, so components, template expressions, and `<script setup>` logic can all be used directly in Markdown. Before editing those pages, it is worth reading the [official VitePress guide](https://vitepress.dev/guide/using-vue).

Keep raw HTML template blocks contiguous and structurally clean. Do not insert arbitrary blank lines inside containers such as `<select>...</select>`, or the `vite:vue` / Vue SFC compiler may report template parse errors during development or build.

## CI Checks

### Repository-wide Checks

[`nodejs-ci.yml`](https://github.com/HowieHz/howiehz-misc/blob/main/.github/workflows/nodejs-ci.yml) runs on pull requests and pushes to `main`. It mainly covers:

- `pnpm fmt`
- `pnpm lint`
- `pnpm test`

Formatting and some auto-fix steps may commit corrections back to the PR automatically.

### PR Build Checks

- [`pr-docs-build.yml`](https://github.com/HowieHz/howiehz-misc/blob/main/.github/workflows/pr-docs-build.yml): verifies that the docs site builds successfully
- [`pr-compat-finder-build.yml`](https://github.com/HowieHz/howiehz-misc/blob/main/.github/workflows/pr-compat-finder-build.yml): verifies that the `compat-finder` package builds successfully

## Contribution Conventions

### Release-affecting Changes

If a change affects the published `compat-finder` package, run:

```bash
pnpm changeset
```

Then:

1. Select `compat-finder`
2. Choose the appropriate semver bump: `patch`, `minor`, or `major`
3. Write a clear release note for the change
4. Commit the generated `.changeset/*.md` file together with the code changes

Docs-only changes, site content changes, or changes that do not affect the published package do not need a changeset.

### Content and Tool Pages

If you are editing public content pages or tool docs, also refer to:

- the [Contribution Guide](/en/maintenance/submission)
- the `README.md` file in the relevant directory when available

## Releases

See the [Release Guide](./releases.md) for versioning rules, release PR behavior, and publish steps.
