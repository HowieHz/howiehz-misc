import path from "node:path";
import { fileURLToPath } from "node:url";

import { includeIgnoreFile } from "@eslint/compat";
import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import oxlint from "eslint-plugin-oxlint";
import pluginVue from "eslint-plugin-vue";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import vueParser from "vue-eslint-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gitignorePath = path.resolve(__dirname, ".gitignore");

export default defineConfig(
  globalIgnores(["public/assets/lib/**/*"]),
  includeIgnoreFile(gitignorePath),
  js.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  {
    files: ["docs/.vitepress/theme/**/*.ts"],

    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ["docs/.vitepress/**/*.vue"],

    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
      },
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
    },
  },
  {
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
      ".github/scripts/*.js",
    ],

    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
  {
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
