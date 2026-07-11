import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { delimiter, dirname, extname, join } from "node:path";
import { execPath } from "node:process";
import { fileURLToPath, URL } from "node:url";

const packageRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const testSourceRoot = join(packageRoot, "src", "test", "java");
const buildRoot = join(packageRoot, "build");
const productionClassesRoot = join(buildRoot, "classes");
const testClassesRoot = join(buildRoot, "test-classes");

/** Runs one build tool and fails the test immediately on a nonzero exit. */
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

run(execPath, [join(packageRoot, "scripts", "build.js")]);

const sources = [];
const pendingDirectories = [testSourceRoot];
while (pendingDirectories.length > 0) {
  const directory = pendingDirectories.pop();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      pendingDirectories.push(path);
    } else if (entry.isFile() && extname(entry.name) === ".java") {
      sources.push(path);
    }
  }
}

run("javac", [
  "--release",
  "8",
  "-Xlint:-options",
  "-encoding",
  "UTF-8",
  "-cp",
  productionClassesRoot,
  "-d",
  testClassesRoot,
  ...sources,
]);
run("java", [
  "-cp",
  `${testClassesRoot}${delimiter}${productionClassesRoot}`,
  "top.howiehz.graphwar.agent.GraphwarAgentApiTest",
]);
