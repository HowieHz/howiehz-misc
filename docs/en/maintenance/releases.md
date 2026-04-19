---
publish: false
outline: deep
---

# Release Guide

## Released Packages

The npm packages currently released from this repository through Changesets are:

- [`compat-finder`](https://www.npmjs.com/package/compat-finder): [changelog](https://github.com/HowieHz/howiehz-misc/blob/main/packages/compat-finder/CHANGELOG.md)

## Versioning

All published packages follow semantic versioning in the form `MAJOR.MINOR.PATCH`.

- `patch`: bug fixes, wording updates, and internal improvements with no breaking changes
- `minor`: new backward-compatible capabilities, such as new CLI options or additional exported APIs
- `major`: breaking changes, such as removed APIs or changed CLI compatibility behavior or output contracts

## Pre-release Checklist

Before cutting a release, confirm the following:

1. Every feature PR intended for the release has already been merged.
2. All CI checks relevant to the release have passed.

## Release Flow Overview

This repository uses Changesets for versioning and changelog generation, and [`release-packages.yml`](https://github.com/HowieHz/howiehz-misc/blob/main/.github/workflows/release-packages.yml) to create release PRs and publish to npm.

The flow has two stages:

1. After a normal PR is merged into `main`, npm publishing does not happen immediately. The workflow creates or updates a release PR first.
2. After the release PR is merged into `main`, the workflow performs the actual npm publish.

## Build Provenance Verification

The release pipeline follows GitHub's recommended reusable-workflow pattern: package builds, `npm pack` packaging, artifact upload, and artifact attestation issuance all happen inside the reusable build workflow.

Before npm publishing begins, the workflow runs `gh attestation verify` against every generated `.tgz` package to confirm each file was produced and signed by the expected reusable build workflow. Publishing continues only after verification passes, so the packages released to npm have verifiable provenance and have not been tampered with.
