import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";

const packageRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

rmSync(join(packageRoot, "build"), { force: true, recursive: true });
