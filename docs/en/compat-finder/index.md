# compat-finder

compat-finder is a TypeScript library and CLI for troubleshooting compatibility issues across multiple targets.

It is a good fit when you need to:

- narrow down problematic targets across plugins, mods, extensions, or middleware
- embed a guided compatibility workflow into your own app
- run an interactive check in the CLI or compute the next step from existing answers
- hand the workflow to AI tools or other automation

## Features

- Simple session API for most integrations: `createCompatibilitySession`
- Lower-level state API for custom UIs, persistence, and resume flows
- Built-in `binary-split` and `leave-one-out` algorithms
- CLI support for English and Simplified Chinese
- Works both as an ESM library and a Node.js CLI

## Reading Guide

- [Install](./install): runtime requirements, package manager installs, and ad-hoc CLI usage
- [Quick Start](./quick-start): the shortest path to a working library or CLI flow
- [API Reference](./api): session API, low-level state API, range utilities, and key types
- [CLI](./cli): help output, locale handling, algorithms, and commands
- [Work with AI](./ai): Agent Skill installation and prompt examples
- [Online Tool](./online-tool): hosted demo and source location

## Compatibility

- Library: ESM-only. It has no Node.js built-in dependencies and can also run in browsers and other ESM-compatible runtimes
- CLI: requires Node.js `^20 || ^22 || >=24`; supports English and Simplified Chinese

## Related Projects

compat-finder is a TypeScript rewrite of [HowieHz/plugin-compatibility-checking-tool](https://github.com/HowieHz/plugin-compatibility-checking-tool).
