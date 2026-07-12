import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

/** Compile Vue SFCs in the same Vitest suite as the Graphwar Killer's plain TypeScript modules. */
export default defineConfig({
  plugins: [vue()],
});
