import { delimiter, dirname, extname, join } from "node:path";
import { execPath } from "node:process";
import { fileURLToPath, URL } from "node:url";

import { collectFiles, runCommand } from "./utils.js";

const packageRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const testSourceRoot = join(packageRoot, "src", "test", "java");
const buildRoot = join(packageRoot, "build");
const productionClassesRoot = join(buildRoot, "classes");
const testClassesRoot = join(buildRoot, "test-classes");

runCommand(execPath, [join(packageRoot, "scripts", "build.js")], packageRoot);

const sources = collectFiles(testSourceRoot, (file) => extname(file) === ".java");

runCommand(
  "javac",
  [
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
  ],
  packageRoot,
);
runCommand(
  "java",
  ["-cp", `${testClassesRoot}${delimiter}${productionClassesRoot}`, "top.howiehz.graphwar.agent.GraphwarAgentApiTest"],
  packageRoot,
);
