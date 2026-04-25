# compat-finder

`compat-finder` is a TypeScript library and CLI for troubleshooting compatibility issues across multiple targets.

It helps you find one or more incompatible targets with fewer rounds of testing.

## Features

- **Zero runtime dependencies**: keeps installs lightweight and reduces supply-chain risk.
- **Efficient troubleshooting algorithm**: the default strategy combines binary search with divide-and-conquer, usually requiring fewer test rounds to reach a result.
- **More than simple binary search**: results can include one or more incompatible targets.
- **Multiple integration options**: choose from a guided CLI, a ready-to-use session API, or an advanced API for custom flows.
- **Works across runtimes**: ships ESM output and runs in browsers and other ESM-compatible runtimes.
- **Localized CLI**: available in English and Simplified Chinese.

## Supported Environments

- Library: ships ESM output; runs in browsers and other ESM-compatible runtimes.
- CLI: requires Node.js `^22 || >=24`; supports English and Simplified Chinese.

## Reading Guide

- [Getting Started](./getting-started): complete one troubleshooting run first and learn the basics of the library and CLI
- [Work with AI](./ai): use AI to organize targets, generate commands, or integrate the troubleshooting flow
- [Try It Online](./online-tool): start a troubleshooting run in the browser without installing anything
- [CLI](./cli): check the basic CLI workflow, common commands, and available options
- [API Reference](./api): integrate `compat-finder` into your own project or tooling
- [Algorithm Performance](./algorithm-performance): compare the two algorithms and decide when to switch

## Related Projects

`compat-finder` was refactored from [HowieHz/plugin-compatibility-checking-tool](https://github.com/HowieHz/plugin-compatibility-checking-tool).
