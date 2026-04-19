import process from "node:process";

import { defineConfig, type UserConfigExport } from "tsdown";

const isDevBuild = process.env.npm_lifecycle_event === "build";

const tsdownConfig: UserConfigExport = defineConfig([
  {
    dts: {
      build: true,
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
      ignoreRules: ['cjs-resolves-to-esm'],
    },
  },
  {
    dts: false,
    entry: {
      cli: "src/cli.ts",
    },
    platform: "node",
    sourcemap: isDevBuild,
  },
]);

export default tsdownConfig;
