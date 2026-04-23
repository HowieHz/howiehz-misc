# Getting Started

This page shows how to install `compat-finder` and start using it from the library or CLI as quickly as possible.

## Requirements

- Library usage: any ESM-compatible runtime
- CLI usage: Node.js `^20 || ^22 || >=24`

## Installation

Install `compat-finder` with your preferred package manager:

::: code-group

```sh [npm]
npm install compat-finder
```

```sh [pnpm]
pnpm add compat-finder
```

```sh [yarn]
yarn add compat-finder
```

```sh [bun]
bun add compat-finder
```

```sh [deno]
deno add npm:compat-finder
```

```sh [vlt]
vlt install compat-finder
```

```sh [vp]
vp add compat-finder
```

:::

Then import it and create a session:

```ts
import { createCompatibilitySession } from "compat-finder";

const session = createCompatibilitySession(["A", "B"]);
```

If you just want to try the CLI, you can run it without installing it first:

::: code-group

```sh [npm]
npx compat-finder --help
```

```sh [pnpm]
pnpm dlx compat-finder --help
```

```sh [yarn]
yarn dlx compat-finder --help
```

```sh [bun]
bunx compat-finder --help
```

```sh [deno]
deno run npm:compat-finder --help
```

```sh [vlt]
vlx compat-finder --help
```

```sh [vp]
vp exec compat-finder
```

:::

## Library Example

The example below shows the smallest useful `compat-finder` session:

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
  return "issue";
}
```

## CLI Example

If you would rather start in the terminal, try these commands first.

Run a full interactive check:

::: code-group

```sh [npm]
npx compat-finder interactive --count 4
```

```sh [pnpm]
pnpm dlx compat-finder interactive --count 4
```

```sh [yarn]
yarn dlx compat-finder interactive --count 4
```

```sh [bun]
bunx compat-finder interactive --count 4
```

```sh [deno]
deno run npm:compat-finder interactive --count 4
```

```sh [vlt]
vlx compat-finder interactive --count 4
```

```sh [vp]
vp exec compat-finder interactive --count 4
```

:::

Calculate the next targets to test from existing answers:

::: code-group

```sh [npm]
npx compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n"
```

```sh [pnpm]
pnpm dlx compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n"
```

```sh [yarn]
yarn dlx compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n"
```

```sh [bun]
bunx compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n"
```

```sh [deno]
deno run npm:compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n"
```

```sh [vlt]
vlx compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n"
```

```sh [vp]
vp exec compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n"
```

:::

Expected JSON output:

```json
{
  "status": "testing",
  "targetCount": 3,
  "targets": ["Beta"]
}
```

## Next

- Learn how to [Work with AI](./ai)
- Go to [Try It Online](./online-tool)
- Or jump to [CLI](./cli)
- View [API Reference](./api)
