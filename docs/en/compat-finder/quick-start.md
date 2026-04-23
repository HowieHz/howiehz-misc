# Quick Start

## Library Example

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

Pass `{ algorithm: "leave-one-out" }` as the second argument to use a leave-one-out workflow instead of the default `binary-split` search.

## CLI Example

Run a full interactive check:

```bash
compat-finder interactive --count 4
```

Run a single-step calculation and print the next result:

```bash
compat-finder next -c 3 -n "Alpha,Beta,Gamma" -a "y,n"
```

Switch algorithms when needed:

```bash
compat-finder next -c 4 --algorithm leave-one-out -n "A,B,C,D" -a "issue,pass"
```

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
