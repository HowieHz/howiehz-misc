import process from "node:process";

import { defineConfig, type UserConfigExport } from "tsdown";

const isDevBuild = process.env.npm_lifecycle_event === "build";

const tsdownConfig: UserConfigExport = defineConfig([
  {
    tsconfig: "tsconfig.neutral.json",
    dts: {
      sourcemap: isDevBuild,
    },
    entry: {
      index: "src/index.ts",
    },
    platform: "neutral",
    sourcemap: isDevBuild,
    publint: {
      strict: true,
    },
    attw: {
      profile: "esm-only",
    },
  },
  {
    tsconfig: "tsconfig.node.json",
    dts: {
      sourcemap: isDevBuild,
    },
    entry: {
      cli: "src/cli.ts",
    },
    platform: "node",
    sourcemap: isDevBuild,
  },
]);

export default tsdownConfig;
