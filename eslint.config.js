import { resolve } from "node:path";

import { includeIgnoreFile } from "@eslint/compat";
import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import oxlint from "eslint-plugin-oxlint";
import pluginVue from "eslint-plugin-vue";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import vueParser from "vue-eslint-parser";

const gitignorePath = resolve(import.meta.dirname, ".gitignore");

const browserLanguageOptions = {
  ecmaVersion: "latest",
  sourceType: "module",
  globals: {
    ...globals.browser,
  },
};

const vueLanguageOptions = {
  ...browserLanguageOptions,
  parser: vueParser,
  parserOptions: {
    parser: {
      // Script parser for `<script>`
      js: "espree",
      // Script parser for `<script lang="ts">`
      ts: tsParser,
      // Script parser for vue directives (e.g. `v-if=` or `:attribute=`)
      // and vue interpolations (e.g. `{{variable}}`).
      // If not specified, the parser determined by `<script lang ="...">` is used.
      "<template>": "espree",
    },
  },
  globals: {
    ...browserLanguageOptions.globals,
    ...globals.vue,
  },
};

export default defineConfig(
  globalIgnores(["public/assets/lib/**/*"]),
  includeIgnoreFile(gitignorePath),
  js.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  {
    // Browser-side TS used by the VitePress theme.
    files: ["docs/.vitepress/theme/**/*.ts"],
    languageOptions: browserLanguageOptions,
  },
  {
    // Browser-side Vue SFCs used by the VitePress theme and tool pages.
    files: ["docs/**/*.vue"],
    languageOptions: vueLanguageOptions,
  },
  {
    // Node-side config/build/tooling and package runtime code.
    files: [
      "docs/.vitepress/config.ts",
      "docs/.vitepress/data/**/*.ts",
      "docs/.vitepress/utils/**/*.ts",
      "docs/**/*.node.data.ts",
      "packages/compat-finder/src/cli/**/*.ts",
      "packages/compat-finder/src/locales/**/*.ts",
      "packages/compat-finder/benchmark/**/*.ts",
      "packages/compat-finder/tsdown.config.ts",
      "packages/compat-finder/bin/**/*.mjs",
      "packages/compat-finder/__tests__/**/*.ts",
      "eslint.config.js",
      "stylelint.config.js",
      ".github/scripts/*.ts",
      ".github/scripts/*.js",
    ],

    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Neutral ESM/typing entrypoints that do not need browser or Node globals.
    files: [
      "docs/.vitepress/types/**/*.d.ts",
      "packages/compat-finder/src/index.ts",
      "packages/compat-finder/src/compatibility-test/**/*.ts",
    ],

    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
  },
  ...oxlint.buildFromOxlintConfigFile("./.oxlintrc.json"),
);
