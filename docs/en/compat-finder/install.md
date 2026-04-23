# Install

## Requirements

- Library usage: any ESM-compatible runtime
- CLI usage: Node.js `^20 || ^22 || >=24`

## Install the Package

Install `compat-finder` with your preferred package manager:

::: code-group

```npm
npm install compat-finder
```

```pnpm
pnpm add compat-finder
```

```yarn
yarn add compat-finder
```

```bun
bun add compat-finder
```

```deno
deno add npm:compat-finder
```

```vlt
vlt install compat-finder
```

```vp
vp add compat-finder
```

:::

Then import it:

```ts
import { createCompatibilitySession } from "compat-finder";
```

## Run the CLI Without Installing

If you only want to try the CLI first, you can also run it ad hoc:

::: code-group

```npm
npx compat-finder --help
```

```pnpm
pnpm dlx compat-finder --help
```

```yarn
yarn dlx compat-finder --help
```

```bun
bunx compat-finder --help
```

```deno
deno run npm:compat-finder --help
```

```vlt
vlx compat-finder --help
```

```vp
vp exec compat-finder
```

:::

## Next

- Continue with [Quick Start](./quick-start)
- Jump to [CLI](./cli) for the full command reference
