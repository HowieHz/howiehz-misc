#!/usr/bin/env node

import * as module from "node:module";

const [major] = process.version.slice(1).split(".");
const COMPATIBILITY_PAGE =
  "Visit https://howiehz.top/misc/en/compat-finder/ to see compat-finder documentation and release notes.";

// We don't use a version parser here because:
//  1. this wrapper should stay tiny and dependency-free
//  2. we want the error to happen before loading the built CLI bundle
if (Number(major) < 22) {
  console.error(`ERROR: compat-finder requires at least Node.js v22
The current version of Node.js is ${process.version}
${COMPATIBILITY_PAGE}`);
  process.exit(1);
}

// We need to load the compile cache before importing the built CLI bundle.
try {
  module.enableCompileCache?.();
} catch {
  // Ignore compile cache setup failures.
}

globalThis.compatFinderStartedAt = Date.now();

const { main } = await import(new URL("../dist/cli.mjs", import.meta.url));
await main();
