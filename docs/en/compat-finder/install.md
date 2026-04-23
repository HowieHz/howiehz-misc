# Install

## Requirements

- Library usage: any ESM-compatible runtime
- CLI usage: Node.js `^20 || ^22 || >=24`

## Install the Package

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

Then import it:

```ts
import { createCompatibilitySession } from "compat-finder";
```

## Using the CLI

If you only want to try the CLI first, you can also run it ad hoc:

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

## Next

- Continue with [Quick Start](./quick-start)
- Jump to [CLI](./cli) for the full command reference
