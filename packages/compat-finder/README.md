# compat-finder

[![Open on npmx][npmx-version-src]][npmx-href]
[![npm downloads][npmx-downloads-src]][npmx-href]
[![CI][ci-src]][ci-href]

English | [简体中文](./README.zh.md)

compat-finder is a library and CLI for troubleshooting compatibility issues across multiple targets.

## Features

- Guided compatibility narrowing for libraries, plugins, mods, and other target lists
- Simple session API for most integrations, plus a lower-level state API for advanced flows
- Built-in `binary-split` and `leave-one-out` algorithms
- ESM library support for browsers and other ESM runtimes
- Node.js CLI with English and Simplified Chinese output

## Documentation

Full documentation lives at [howiehz.top/misc/en/compat-finder](https://howiehz.top/misc/en/compat-finder/).

## Install

```bash
npm install compat-finder
```

Then you can create a compatibility session:

```ts
import { createCompatibilitySession } from "compat-finder";
```

You can also run the command-line tool without installing it first:

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

CLI example:

```bash
compat-finder next -c 4 --algorithm leave-one-out -n "A,B,C,D" -a "issue,pass"
```

For full documentation, visit [howiehz.top/misc/en/compat-finder](https://howiehz.top/misc/en/compat-finder/).

## Related Projects

compat-finder is a TypeScript rewrite of [HowieHz/plugin-compatibility-checking-tool](https://github.com/HowieHz/plugin-compatibility-checking-tool).

## Licenses

This project is licensed under the [MIT License](https://raw.githubusercontent.com/howiehz/howiehz-misc/HEAD/packages/compat-finder/LICENSE).

<!-- Badges -->

[npmx-version-src]: https://npmx.dev/api/registry/badge/version/compat-finder
[npmx-downloads-src]: https://npmx.dev/api/registry/badge/downloads-month/compat-finder
[npmx-href]: https://npmx.dev/compat-finder
[ci-src]: https://github.com/HowieHz/howiehz-misc/actions/workflows/nodejs-ci.yml/badge.svg
[ci-href]: https://github.com/HowieHz/howiehz-misc/actions/workflows/nodejs-ci.yml
