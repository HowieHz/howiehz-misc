# 安装

## 环境要求

- 作为库使用：兼容 ESM 的运行时
- 作为 CLI 使用：Node.js `^20 || ^22 || >=24`

## 安装

使用你偏好的包管理器安装：

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

安装后即可导入：

```ts
import { createCompatibilitySession } from "compat-finder";
```

## 临时执行 CLI

也可以不安装，直接临时运行命令行工具：

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

## 下一步

- 先看 [快速开始](./quick-start)
- 需要完整参数说明时看 [命令行工具](./cli)
