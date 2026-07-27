import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(dirname(packageRoot));
const fixtureRoot = join(packageRoot, "test", "fixtures", "vite-asset");

test("Vite emits a hashed standalone WASM asset under the /misc/ base", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "graphwar-kernel-vite-"));
  const viteCliPath = join(repositoryRoot, "docs", "node_modules", "vite", "bin", "vite.js");
  try {
    await execFileAsync(
      process.execPath,
      [
        viteCliPath,
        "build",
        fixtureRoot,
        "--base",
        "/misc/",
        "--assetsInlineLimit",
        "100000000",
        "--outDir",
        outputRoot,
        "--emptyOutDir",
      ],
      { cwd: repositoryRoot },
    );

    const pendingDirectories = [outputRoot];
    const files = [];
    while (pendingDirectories.length > 0) {
      const currentDirectory = pendingDirectories.pop();
      const entries = await readdir(currentDirectory, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = join(currentDirectory, entry.name);
        if (entry.isDirectory()) {
          pendingDirectories.push(entryPath);
        } else {
          files.push(entryPath);
        }
      }
    }
    const wasmFiles = files.filter((file) => file.endsWith(".wasm"));
    assert.equal(wasmFiles.length, 1);
    assert.match(relative(outputRoot, wasmFiles[0]).replaceAll("\\", "/"), /^assets\/graphwar-kernel-[\w-]+\.wasm$/);

    const javascriptFiles = files.filter((file) => file.endsWith(".js"));
    const javascript = (await Promise.all(javascriptFiles.map((file) => readFile(file, "utf8")))).join("\n");
    assert.match(javascript, /\/misc\/assets\/graphwar-kernel-[\w-]+\.wasm/);
    assert.doesNotMatch(javascript, /data:application\/wasm/);

    const sourceWasm = await readFile(join(packageRoot, "build", "graphwar-kernel.wasm"));
    const emittedWasm = await readFile(wasmFiles[0]);
    assert.deepEqual(emittedWasm, sourceWasm);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
