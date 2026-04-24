import process from "node:process";

import { defineConfig, type UserConfigExport } from "tsdown";

const lifecycleEvent = process.env.npm_lifecycle_event ?? "";
const isReleaseBuild = lifecycleEvent === "build:release";

const tsdownConfig: UserConfigExport = defineConfig([
  {
    tsconfig: "tsconfig.neutral.json",
    dts: {
      sourcemap: !isReleaseBuild,
    },
    entry: {
      index: "src/index.ts",
    },
    platform: "neutral",
    sourcemap: !isReleaseBuild,
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
      sourcemap: !isReleaseBuild,
    },
    entry: {
      cli: "src/cli/index.ts",
    },
    platform: "node",
    sourcemap: !isReleaseBuild,
  },
]);

export default tsdownConfig;
