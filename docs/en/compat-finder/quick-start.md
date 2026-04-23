# Quick Start

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

The default `binary-split` strategy combines binary search with divide-and-conquer.  
Pass `{ algorithm: "leave-one-out" }` as the second argument to use a leave-one-out workflow instead.

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

Switch algorithms when needed:

::: code-group

```sh [npm]
npx compat-finder next -c 4 --algorithm leave-one-out -n "A,B,C,D" -a "issue,pass"
```

```sh [pnpm]
pnpm dlx compat-finder next -c 4 --algorithm leave-one-out -n "A,B,C,D" -a "issue,pass"
```

```sh [yarn]
yarn dlx compat-finder next -c 4 --algorithm leave-one-out -n "A,B,C,D" -a "issue,pass"
```

```sh [bun]
bunx compat-finder next -c 4 --algorithm leave-one-out -n "A,B,C,D" -a "issue,pass"
```

```sh [deno]
deno run npm:compat-finder next -c 4 --algorithm leave-one-out -n "A,B,C,D" -a "issue,pass"
```

```sh [vlt]
vlx compat-finder next -c 4 --algorithm leave-one-out -n "A,B,C,D" -a "issue,pass"
```

```sh [vp]
vp exec compat-finder next -c 4 --algorithm leave-one-out -n "A,B,C,D" -a "issue,pass"
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

- Continue with [API Reference](./api)
- Or jump to [CLI](./cli)
