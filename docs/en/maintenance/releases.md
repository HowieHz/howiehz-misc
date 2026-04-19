---
publish: false
outline: deep
---

# Release Guide

## Published Packages

The npm packages currently released from this repository through Changesets include:

- `compat-finder`

Its package-level changelog is maintained in:

- [`packages/compat-finder/CHANGELOG.md`](https://github.com/HowieHz/howiehz-misc/blob/main/packages/compat-finder/CHANGELOG.md)

## Versioning

`compat-finder` uses semantic versioning in the form `MAJOR.MINOR.PATCH`.

- `patch`: bug fixes, wording tweaks, or internal improvements with no breaking change
- `minor`: new backward-compatible capabilities, such as new CLI options or additional exported APIs
- `major`: breaking changes, such as removed APIs or changed CLI compatibility behavior or output contracts

## Initial Setup

Before enabling automated publishing, make sure:

1. The GitHub repository has an `NPM_TOKEN` secret configured.
2. The npm account has permission to publish `compat-finder`.
3. The package name, entrypoints, and publish contents in `packages/compat-finder/package.json` have been verified.
4. `packages/compat-finder/README.md`, `README.zh.md`, and `LICENSE` are ready and intended to ship with the package.
5. Each package that is expected to ship has already passed a local packing check, such as `pnpm --filter compat-finder pack` or `npm publish --dry-run`.

## Pre-release Checklist

Before preparing a release, it is worth checking the following in order:

1. Every feature PR intended for this release has already been merged.
2. Each releasable change includes a matching `.changeset/*.md` file.
3. PRs that do not need a release do not include accidental changesets.
4. Each package changelog has not been edited manually in a way that conflicts with Changesets output.
5. `name`, `exports`, `bin`, `types`, and `files` in each releasable package still match the intended publish output.
6. At least one local verification run has completed successfully:
   - `pnpm fmt`
   - `pnpm lint`
   - `pnpm test`
   - `pnpm --filter <package-name> pack` for each affected package

## Release Model

This repository uses Changesets for versioning and changelog generation, and [`release-compat-finder.yml`](https://github.com/HowieHz/howiehz-misc/blob/main/.github/workflows/release-compat-finder.yml) to automate the release PR and npm publish flow for workspace packages.

The overall flow has two stages:

1. A normal PR is merged into `main`
   This does not publish to npm immediately. It creates or updates a release PR first.
2. The release PR is merged into `main`
   This is the point where the actual npm publish happens.

## Standard Release Flow

### Submit a Releasable Change

If a change affects any published workspace package, run:

```bash
pnpm changeset
```

After that:

1. select the affected published package or packages
2. choose the appropriate bump level: `patch`, `minor`, or `major`
3. write a user-facing release note
4. commit the generated `.changeset/*.md` file together with the code changes

These changes usually do not need a changeset:

- docs-site content updates only
- maintenance-doc updates only
- internal cleanup that does not affect published package behavior

### After a Normal PR Is Merged

When a PR containing a changeset is merged into `main`, [`release-compat-finder.yml`](https://github.com/HowieHz/howiehz-misc/blob/main/.github/workflows/release-compat-finder.yml) automatically creates or updates a release PR. That PR collects the pending release changes across all affected workspace packages:

- package version bumps
- generated `CHANGELOG.md` entries

If multiple changesets are merged over time, the workflow keeps updating the same release PR instead of opening a brand-new one every time.

### What to Review in the Release PR

Before merging the release PR, check at least:

1. whether the version bump is correct
2. whether the `CHANGELOG.md` entries are accurate, concise, and user-facing
3. whether only the intended workspace package release changes are included
4. whether unrelated code changes have been mixed into the release commit

### After the Release PR Is Merged

Once the release PR is merged into `main`, the same workflow automatically:

1. installs dependencies
2. runs `pnpm changeset:publish`
3. publishes the new version to npm

At this stage:

- `changeset version` has already happened when the release PR was created
- the post-merge publish stage is only responsible for publishing the prepared version to npm
- on success, every package included in that release PR becomes available on npm at its new version

## Local Verification

If you want to simulate the important pre-publish steps locally, use the following sequence.

### Generate a Changeset

```bash
pnpm changeset
```

### Apply Version Bumps and Changelog Updates Locally

```bash
pnpm changeset:version
```

This consumes the current `.changeset/*.md` files and updates the corresponding package files:

- `package.json`
- `CHANGELOG.md`

### Inspect the Tarball Contents

Run this for each package you expect to ship:

```bash
pnpm --filter <package-name> pack
```

If you only want a publish simulation, you can also run:

```bash
npm publish --dry-run
```

### Publish Manually

If you really need to, you can still run:

```bash
pnpm changeset:publish
```

In normal maintenance, the GitHub Actions release flow should remain the default path so local and CI publish state do not drift.

## Local Commands

These commands are mainly for local verification or troubleshooting:

- Generate a changeset: `pnpm changeset`
- Apply version bumps and changelog updates locally: `pnpm changeset:version`
- Publish manually: `pnpm changeset:publish`
- Inspect the package tarball contents: `pnpm --filter compat-finder pack`

## Troubleshooting

### The Workflow Did Not Create a Release PR

Check these first:

1. whether the merged PR actually included `.changeset/*.md`
2. whether `release-compat-finder.yml` completed successfully
3. whether repository or branch rules blocked the bot from updating the release PR

### A Release PR Exists, but npm Was Not Published

That is expected. The release PR only prepares the version bump and changelog. npm publishing happens only after that release PR itself is merged into `main`.

### Publish Failed

Check these first:

1. whether `NPM_TOKEN` exists and is still valid
2. whether the npm account still has permission to publish the affected package
3. whether the target version already exists on npm
4. whether the `prepack` build succeeds in CI
5. whether the publish entrypoints in `package.json` still match the generated `dist/` output

## Maintenance Conventions

- Normal feature PRs should not manually edit the `version` field of released packages.
- Released package `CHANGELOG.md` files are managed by Changesets and normally should not be hand-written version by version.
- PRs that only change docs or repository metadata do not need a changeset.
