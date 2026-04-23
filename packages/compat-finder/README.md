# Compatibility Finder

[![Open on npmx][npmx-version-src]][npmx-href]
[![npm downloads][npmx-downloads-src]][npmx-href]
[![CI][ci-src]][ci-href]

English | [简体中文](./README.zh.md)

compat-finder is a library and CLI for troubleshooting compatibility issues across multiple targets.

It helps you find one or more incompatible targets with fewer rounds of testing.

## Why use compat-finder

- **Zero runtime dependencies**: Keeps installs lightweight and predictable.
- **Efficient troubleshooting algorithm**: The default strategy combines binary search with divide-and-conquer, usually requiring fewer test rounds to reach a result.
- **More than simple binary search**: Results can include one or more incompatible targets.
- **Multiple integration options**: Choose from a guided CLI, a ready-to-use session API, or an advanced API for custom flows.
- **Works across runtimes**: Ships ESM output and runs in browsers and other ESM-compatible runtimes.
- **Localized CLI**: Available in English and Simplified Chinese.

## Documentation

For full documentation, visit [howiehz.top/misc/en/compat-finder](https://howiehz.top/misc/en/compat-finder/).

## Install

```bash
npm install compat-finder
```

Then import it and create a session:

```ts
import { createCompatibilitySession } from "compat-finder";

const session = createCompatibilitySession(["A", "B"]);
```

If you only want to try the CLI first, you can run it without installing:

```bash
npx compat-finder --help
```

## Usage

Library example:

```ts
import { createCompatibilitySession } from "compat-finder";

const session = createCompatibilitySession(["A", "B", "C", "D"]);

let step = session.current();

while (step.status === "testing") {
  const result = askUser(step.targets);

  if (result === "undo") {
    step = session.undo();
    continue;
  }

  step = session.answer(result === "issue");
}

console.log("Result:", step.targets);

function askUser(targets: readonly string[]): "issue" | "pass" | "undo" {
  console.log("Targets to test:", targets);
  // For browsers, this can read from prompt(), buttons, or forms.
  // For Node.js, this can read from readline, a test script, or your own CLI.
  return "issue"; // "issue" if it reproduces, "pass" if not, or "undo".
}
```

CLI examples:

Start a guided troubleshooting flow:

```bash
npx compat-finder interactive --count 4
```

Calculate the next targets to test from existing answers:

```bash
npx compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n"
```

Expected JSON output:

```json
{
  "status": "testing",
  "targetCount": 3,
  "targets": ["Beta"]
}
```

For full command and API details, see the docs linked above.

## Try It Online

No installation required. Open it in your browser:

[Compatibility Issue Finder](https://howiehz.top/misc/en/tools/compatibility-test/)

## Related Projects

compat-finder is a TypeScript rewrite of [HowieHz/plugin-compatibility-checking-tool](https://github.com/HowieHz/plugin-compatibility-checking-tool).

## License

This project is licensed under the [MIT License](https://raw.githubusercontent.com/howiehz/howiehz-misc/HEAD/packages/compat-finder/LICENSE).

<!-- Badges -->

[npmx-version-src]: https://npmx.dev/api/registry/badge/version/compat-finder
[npmx-downloads-src]: https://npmx.dev/api/registry/badge/downloads-month/compat-finder
[npmx-href]: https://npmx.dev/compat-finder
[ci-src]: https://github.com/HowieHz/howiehz-misc/actions/workflows/nodejs-ci.yml/badge.svg
[ci-href]: https://github.com/HowieHz/howiehz-misc/actions/workflows/nodejs-ci.yml
