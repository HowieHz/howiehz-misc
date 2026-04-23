# 安装

## 环境要求

- 作为库使用：兼容 ESM 的运行时
- 作为 CLI 使用：Node.js `^20 || ^22 || >=24`

## 安装

使用你偏好的包管理器安装 `compat-finder`：

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

安装后即可导入：

```ts
import { createCompatibilitySession } from "compat-finder";
```

## 使用 CLI

如果你只是想先试一下 CLI，也可以不安装，直接临时运行：

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

## 下一步

- 继续阅读 [快速开始](./quick-start)
- 需要完整命令说明时，查看 [命令行工具](./cli)
