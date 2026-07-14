/** Shared iterative filesystem and process helpers for Graphwar Agent scripts. */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Collects matching files without recursion so deeply nested source trees cannot grow the call stack. */
export function collectFiles(rootDirectory, acceptsFile = () => true) {
  const files = [];
  const pendingDirectories = [rootDirectory];

  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop();
    if (!directory) {
      break;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(entryPath);
      } else if (entry.isFile() && acceptsFile(entryPath)) {
        files.push(entryPath);
      }
    }
  }

  return files;
}

/** Runs one build tool in the package and fails immediately on a nonzero exit. */
export function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}
