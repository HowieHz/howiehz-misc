---
publish: false
outline: deep
---

# Release Guide

## Release-Managed Packages

The npm packages currently released from this repository through Changesets are:

- [`compat-finder`](https://www.npmjs.com/package/compat-finder): [changelog](https://github.com/HowieHz/howiehz-misc/blob/main/packages/compat-finder/CHANGELOG.md)
- `blogsclub-signin-helper`: not published to npm; its `.user.js` asset is uploaded to GitHub Releases and stable versions are synchronized by a Greasy Fork webhook.

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

This repository uses Changesets for versioning and changelog generation, and [`release-packages.yml`](https://github.com/HowieHz/howiehz-misc/blob/main/.github/workflows/release-packages.yml) to create release PRs and publish either npm packages or GitHub Release assets according to the package type.

The flow has two stages:

1. After a normal PR is merged into `main`, publishing does not happen immediately. The workflow creates or updates a release PR first.
2. After the release PR is merged into `main`, the workflow publishes the npm package or GitHub Release asset.

## Build Provenance Verification

The release pipeline follows GitHub's recommended reusable-workflow pattern: package builds, `npm pack` packaging, artifact upload, and artifact attestation issuance all happen inside the reusable build workflow.

Before npm publishing begins, the workflow runs `gh attestation verify` against every generated `.tgz` package to confirm each file was produced and signed by the expected reusable build workflow. Publishing continues only after verification passes, so the packages released to npm have verifiable provenance and have not been tampered with.

## Greasy Fork Synchronization

`blogsclub-signin-helper` is not published to npm. The release workflow keeps and uploads this GitHub Release asset:

```text
blogsclub-signin-helper.user.js
```

After every GitHub Release succeeds, the release workflow publishes each stable userscript asset to `dist-userscript` at `<package-name>/<asset-filename>`. A package name must be a plain directory name.
Pre-releases with `-` in their version keep their GitHub Release asset but do not update that branch. Publishing fully replaces the released package directory without touching other package directories; unchanged content creates no commit.

Generate a secret on Greasy Fork's [webhook information page](https://greasyfork.org/zh-CN/users/webhook-info), then add a webhook in the GitHub repository under Settings → Webhooks. Use the Payload URL shown by Greasy Fork, select `application/json`, enable only Push events, and keep the webhook active.

Set the Greasy Fork sync URL to:

```text
https://raw.githubusercontent.com/HowieHz/howiehz-misc/dist-userscript/blogsclub-signin-helper/blogsclub-signin-helper.user.js
```

After switching to this URL, manually synchronize once in Greasy Fork. Then, after the Changesets release PR is merged, a stable release updates the branch after its GitHub Release succeeds, and the Push webhook triggers Greasy Fork to update the script. If branch publication fails, the GitHub Release remains intact; use **Re-run failed jobs** in Actions to retry.
