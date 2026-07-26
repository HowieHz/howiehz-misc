import { spawn } from "node:child_process";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const buildDirectory = join(packageRoot, "build");
const outputPath = join(buildDirectory, "graphwar-kernel.wasm");
const temporaryOutputPath = join(buildDirectory, `.graphwar-kernel.${process.pid}.${Date.now()}.wasm`);
const compilerPath = join(packageRoot, "node_modules", "assemblyscript", "bin", "asc.js");

await mkdir(buildDirectory, { recursive: true });
let compilerProcess;
let receivedSignal;
try {
  compilerProcess = spawn(
    process.execPath,
    [compilerPath, "assembly/index.ts", "--target", "release", "--outFile", temporaryOutputPath],
    {
      cwd: packageRoot,
      stdio: "inherit",
    },
  );
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      receivedSignal = signal;
      compilerProcess.kill(signal);
    });
  }
  const exitCode = await new Promise((resolve, reject) => {
    compilerProcess.once("error", reject);
    compilerProcess.once("exit", resolve);
  });

  if (receivedSignal !== undefined) {
    process.exitCode = 1;
  } else if (exitCode !== 0) {
    process.exitCode = exitCode ?? 1;
  } else {
    await rename(temporaryOutputPath, outputPath);
  }
} finally {
  await rm(temporaryOutputPath, { force: true });
}

if (receivedSignal !== undefined) {
  process.kill(process.pid, receivedSignal);
}
