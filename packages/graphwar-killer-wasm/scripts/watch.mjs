import { spawn } from "node:child_process";
import { watch, watchFile, unwatchFile } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const assemblyDirectory = join(packageRoot, "assembly");
const asconfigPath = join(packageRoot, "asconfig.json");
const buildScriptPath = join(packageRoot, "scripts", "build.mjs");
const outputPath = join(packageRoot, "build", "graphwar-kernel.wasm");

let activeBuildProcess;
let rebuildTimer;
let isBuildRunning = false;
let shouldRebuild = false;
let shouldStop = false;

async function runBuild() {
  if (isBuildRunning) {
    shouldRebuild = true;
    return;
  }

  isBuildRunning = true;
  do {
    shouldRebuild = false;
    activeBuildProcess = spawn(process.execPath, [buildScriptPath], {
      cwd: packageRoot,
      stdio: "inherit",
    });
    const exitCode = await new Promise((resolve) => {
      activeBuildProcess.once("error", () => resolve(1));
      activeBuildProcess.once("exit", resolve);
    });
    activeBuildProcess = undefined;
    if (exitCode !== 0 && !shouldStop) {
      console.error(`Graphwar kernel build failed with exit code ${exitCode ?? 1}. Watching for another change.`);
    }
  } while (shouldRebuild && !shouldStop);
  isBuildRunning = false;
}

function scheduleBuild() {
  if (shouldStop) {
    return;
  }
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    void runBuild();
  }, 100);
}

async function isKernelCurrent() {
  let outputModifiedTime;
  try {
    outputModifiedTime = (await stat(outputPath)).mtimeMs;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }

  const inputPaths = [asconfigPath, buildScriptPath];
  const assemblyEntries = await readdir(assemblyDirectory, { recursive: true });
  for (const relativePath of assemblyEntries) {
    if (relativePath.endsWith(".ts")) {
      inputPaths.push(join(assemblyDirectory, relativePath));
    }
  }
  for (const inputPath of inputPaths) {
    if ((await stat(inputPath)).mtimeMs > outputModifiedTime) {
      return false;
    }
  }
  return true;
}

const assemblyWatcher = watch(assemblyDirectory, { recursive: true }, scheduleBuild);
watchFile(asconfigPath, { interval: 500 }, scheduleBuild);
watchFile(buildScriptPath, { interval: 500 }, scheduleBuild);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    shouldStop = true;
    clearTimeout(rebuildTimer);
    assemblyWatcher.close();
    unwatchFile(asconfigPath);
    unwatchFile(buildScriptPath);
    activeBuildProcess?.kill(signal);
  });
}

if (!(await isKernelCurrent())) {
  await runBuild();
}
console.log("Watching Graphwar kernel sources for changes.");
