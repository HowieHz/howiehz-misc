# compat-finder

`compat-finder` is a TypeScript library and CLI for troubleshooting compatibility issues across multiple targets.

It helps you find one or more incompatible targets with fewer rounds of testing.

## Features

- **Zero runtime dependencies**: keeps installs lightweight and predictable.
- **Efficient troubleshooting algorithm**: the default strategy combines binary search with divide-and-conquer, usually requiring fewer test rounds to reach a result.
- **More than simple binary search**: results can include one or more incompatible targets.
- **Multiple integration options**: choose from a guided CLI, a ready-to-use session API, or an advanced API for custom flows.
- **Works across runtimes**: ships ESM output and runs in browsers and other ESM-compatible runtimes.
- **Localized CLI**: available in English and Simplified Chinese.

## Compatibility

- Library: ships ESM output; runs in browsers and other ESM-compatible runtimes.
- CLI: requires Node.js `^20 || ^22 || >=24`; supports English and Simplified Chinese.

## Reading Guide

- [Getting Started](./getting-started): runtime requirements, installation, and the shortest path to using the library or CLI
- [API Reference](./api): session API, low-level state API, range utilities, and key types
- [CLI](./cli): help output, locale handling, algorithms, and commands
- [Work with AI](./ai): Agent Skill installation and prompt examples
- [Online Tool](./online-tool): hosted demo and source location

## Related Projects

`compat-finder` is a TypeScript rewrite of [HowieHz/plugin-compatibility-checking-tool](https://github.com/HowieHz/plugin-compatibility-checking-tool).
