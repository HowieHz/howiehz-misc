import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { env, execPath, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pnpmCliPath = env.npm_execpath;
if (!pnpmCliPath) {
  throw new Error("pnpm did not provide npm_execpath");
}

// Build shared test dependencies once, so package and docs suites can run unit-only scripts below.
const compatFinderSuite = pnpmTask("compat-finder", "--filter", "compat-finder", "test");
const docsSuite = pnpmTask("Graphwar Killer", "--filter", "docs", "test:unit");
const nonVitestSuites = [
  pnpmTask("Graphwar Agent OpenAPI", "--filter", "graphwar-agent", "openapi:test"),
  pnpmTask("Graphwar Agent", "--filter", "graphwar-agent", "test"),
  pnpmTask("Graphwar Killer WASM", "--filter", "graphwar-killer-wasm", "test:unit"),
];

async function main() {
  const buildResults = await Promise.all([
    run(pnpmTask("Graphwar Killer WASM build", "--filter", "graphwar-killer-wasm", "build")),
    run(pnpmTask("osu-beatmap-converter build", "--filter", "osu-beatmap-converter", "build")),
  ]);
  const failedBuild = buildResults.find((result) => !result.isSuccessful);
  if (failedBuild) {
    throw new Error(`${failedBuild.name} failed`);
  }

  stdout.write(
    `[test] Running ${compatFinderSuite.name} and ${nonVitestSuites.map((suite) => suite.name).join(", ")} in parallel\n`,
  );
  const nonVitestResultsPromise = Promise.all(nonVitestSuites.map(run));
  const compatFinderResult = await run(compatFinderSuite);

  // Vitest manages its own worker pool; keep the two Vitest suites from oversubscribing low-core CI runners.
  stdout.write(`[test] Running ${docsSuite.name} after ${compatFinderSuite.name}\n`);
  const docsResult = await run(docsSuite);
  const results = [compatFinderResult, docsResult, ...(await nonVitestResultsPromise)];
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
