import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { env, execPath, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pnpmCliPath = env.npm_execpath;
if (!pnpmCliPath) {
  throw new Error("pnpm did not provide npm_execpath");
}

// The root runner builds the shared WASM once, so the WASM package and docs run unit-only scripts below.
const testSuites = [
  pnpmTask("compat-finder", "--filter", "compat-finder", "test"),
  pnpmTask("Graphwar Agent OpenAPI", "--filter", "graphwar-agent", "openapi:test"),
  pnpmTask("Graphwar Agent", "--filter", "graphwar-agent", "test"),
  pnpmTask("Graphwar Killer WASM", "--filter", "graphwar-killer-wasm", "test:unit"),
  pnpmTask("Graphwar Killer", "--filter", "docs", "test:unit"),
];

async function main() {
  const buildResult = await run(pnpmTask("Graphwar Killer WASM build", "--filter", "graphwar-killer-wasm", "build"));
  if (!buildResult.isSuccessful) {
    throw new Error("Graphwar Killer WASM build failed");
  }

  stdout.write(`[test] Running ${testSuites.map((suite) => suite.name).join(", ")} in parallel\n`);
  const results = await Promise.all(testSuites.map(run));
  const failedSuites = results.filter((result) => !result.isSuccessful).map((result) => result.name);
  if (failedSuites.length > 0) {
    throw new Error(`Failed test suites: ${failedSuites.join(", ")}`);
  }
}

function pnpmTask(name, ...args) {
  return { args: [pnpmCliPath, ...args], command: execPath, name };
}

/** Runs one visible child process and returns its status after all parallel suites settle. */
function run({ args, command, name }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: "inherit" });
    child.once("error", () => resolve({ isSuccessful: false, name }));
    child.once("close", (code, signal) => {
      resolve({ isSuccessful: code === 0 && signal === null, name });
    });
  });
}

main().catch((error) => {
  stderr.write(`${error.message}\n`);
  exit(1);
});
