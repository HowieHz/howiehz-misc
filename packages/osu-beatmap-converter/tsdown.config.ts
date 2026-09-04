import { defineConfig, type UserConfigExport } from "tsdown";

/** Build the browser-safe conversion library without runtime dependencies. */
const tsdownConfig: UserConfigExport = defineConfig([
  {
    tsconfig: "tsconfig.neutral.json",
    entry: {
      index: "src/index.ts",
    },
    platform: "neutral",
  },
]);

export default tsdownConfig;
