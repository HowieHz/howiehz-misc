import { readFile } from "node:fs/promises";

const kernelUrl = new URL("../../../../../packages/graphwar-killer-wasm/build/graphwar-kernel.wasm", import.meta.url);

/** Reads the workspace-built kernel without depending on the test runner's current directory. */
export function readGraphwarKernelBytes() {
  return readFile(kernelUrl);
}
