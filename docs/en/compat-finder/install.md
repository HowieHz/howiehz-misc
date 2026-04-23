# Install

## Requirements

- Library usage: any ESM-compatible runtime
- CLI usage: Node.js `^20 || ^22 || >=24`

## Install the Package

Install with your preferred package manager:

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

:::

Then import it:

```ts
import { createCompatibilitySession } from "compat-finder";
```

## Run the CLI Without Installing

You can also run the CLI ad hoc:

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

:::

## Next

- Continue with [Quick Start](./quick-start)
- Jump to [CLI](./cli) for the full command reference
