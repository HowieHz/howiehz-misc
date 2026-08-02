import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const buildDirectory = join(packageRoot, "build");
const wasmPath = join(buildDirectory, "graphwar-kernel.wasm");
const roleExports = [
  "beginDetectionTask",
  "resumeDetectionTask",
  "runDetectionTemplateShard",
  "runFormula",
  "runTrajectory",
  "runRouteTask",
  "assignOneClickTargets",
  "runSmartPathfinding",
  "beginOneClickClear",
  "cancelOneClickClear",
  "resumeOneClickClear",
];
const arenaExports = [
  "initializeArena",
  "initializeGraphwarGameConstants",
  "reserveArena",
  "markArena",
  "resetArena",
  "resetArenaAfterFault",
  "getArenaBase",
  "getArenaCursor",
  "getArenaPeak",
  "getArenaCapacity",
  "getArenaAllocatorCallCount",
  "getArenaCanaryStatus",
];

async function compileKernel() {
  const bytes = await readFile(wasmPath);
  return WebAssembly.compile(bytes);
}

async function instantiateKernel() {
  const module = await compileKernel();
  const instance = await WebAssembly.instantiate(module, {
    env: {
      abort() {
        throw new WebAssembly.RuntimeError("AssemblyScript abort");
      },
    },
  });
  return { module, exports: instance.exports };
}

test("builds one raw kernel with the required memory and role exports", async () => {
  const files = await readdir(buildDirectory);
  assert.deepEqual(files.sort(), ["graphwar-kernel.wasm"]);

  const module = await compileKernel();
  const exports = new Set(WebAssembly.Module.exports(module).map(({ name }) => name));
  assert.deepEqual([...exports].sort(), ["memory", ...arenaExports, ...roleExports].sort());
  for (const managedRuntimeExport of ["__new", "__renew", "__pin", "__unpin", "__collect"]) {
    assert.equal(exports.has(managedRuntimeExport), false, `managed runtime export leaked: ${managedRuntimeExport}`);
  }
  assert.deepEqual(WebAssembly.Module.imports(module), []);
});

test("traps before initialization and rejects repeated initialization", async () => {
  const { exports } = await instantiateKernel();
  for (const roleExport of roleExports) {
    assert.throws(() => exports[roleExport](), WebAssembly.RuntimeError);
  }
  assert.throws(() => exports.reserveArena(8, 8), WebAssembly.RuntimeError);

  const base = exports.initializeArena(64);
  assert.equal(base, exports.getArenaBase());
  assert.equal(exports.getArenaCursor(), base);
  assert.equal(exports.getArenaAllocatorCallCount(), 1);
  assert.throws(() => exports.initializeArena(64), WebAssembly.RuntimeError);
});

test("permanently consumes initialization even when the first request is invalid", async () => {
  const { exports } = await instantiateKernel();
  assert.throws(() => exports.initializeArena(0), WebAssembly.RuntimeError);
  assert.equal(exports.getArenaAllocatorCallCount(), 0);
  assert.throws(() => exports.initializeArena(64), WebAssembly.RuntimeError);

  const allocatedFailure = await instantiateKernel();
  assert.throws(() => allocatedFailure.exports.initializeArena(0xffff_ffff), WebAssembly.RuntimeError);
  assert.equal(allocatedFailure.exports.getArenaAllocatorCallCount(), 1);
  assert.throws(() => allocatedFailure.exports.initializeArena(64), WebAssembly.RuntimeError);
});

test("validates and snapshots one raw game-constant record", async () => {
  const validConstants = new Float64Array([100, 50, 20, 3, 6, 0.1, 1_000, 0.5, 0.01, 0.02, 30]);
  const { exports } = await instantiateKernel();
  assert.throws(() => exports.initializeGraphwarGameConstants(0, validConstants.length), WebAssembly.RuntimeError);
  exports.initializeArena(256);
  const mark = exports.markArena();
  const pointer = exports.reserveArena(validConstants.byteLength, Float64Array.BYTES_PER_ELEMENT);
  new Float64Array(exports.memory.buffer, pointer, validConstants.length).set(validConstants);
  assert.equal(
    exports.initializeGraphwarGameConstants(pointer, validConstants.length),
    calculateGameConstantAcknowledgment(new Uint8Array(validConstants.buffer)),
  );
  assert.throws(
    () => exports.initializeGraphwarGameConstants(pointer, validConstants.length),
    WebAssembly.RuntimeError,
  );
  exports.resetArena(mark);

  const retryableFailure = await instantiateKernel();
  retryableFailure.exports.initializeArena(256);
  const invalidPointer = retryableFailure.exports.reserveArena(
    validConstants.byteLength,
    Float64Array.BYTES_PER_ELEMENT,
  );
  const invalidConstants = validConstants.slice();
  invalidConstants[0] += 0.5;
  new Float64Array(retryableFailure.exports.memory.buffer, invalidPointer, invalidConstants.length).set(
    invalidConstants,
  );
  assert.throws(
    () => retryableFailure.exports.initializeGraphwarGameConstants(invalidPointer, invalidConstants.length),
    WebAssembly.RuntimeError,
  );
  invalidConstants[0] = validConstants[0];
  invalidConstants[8] = invalidConstants[5] * 2;
  new Float64Array(retryableFailure.exports.memory.buffer, invalidPointer, invalidConstants.length).set(
    invalidConstants,
  );
  assert.throws(
    () => retryableFailure.exports.initializeGraphwarGameConstants(invalidPointer, invalidConstants.length),
    WebAssembly.RuntimeError,
  );
  new Float64Array(retryableFailure.exports.memory.buffer, invalidPointer, validConstants.length).set(validConstants);
  assert.equal(
    retryableFailure.exports.initializeGraphwarGameConstants(invalidPointer, validConstants.length),
    calculateGameConstantAcknowledgment(new Uint8Array(validConstants.buffer)),
  );
});

function calculateGameConstantAcknowledgment(bytes) {
  let hash = 0x811c9dc5;
  for (const value of bytes) {
    hash = Math.imul(hash ^ value, 0x01000193) >>> 0;
  }
  return hash | 0;
}

test("grows during initialization to provide the requested raw capacity", async () => {
  const { exports } = await instantiateKernel();
  const oldBuffer = exports.memory.buffer;
  const requestedCapacity = oldBuffer.byteLength * 2;
  const base = exports.initializeArena(requestedCapacity);

  assert.notEqual(exports.memory.buffer, oldBuffer);
  assert.equal(oldBuffer.byteLength, 0);
  assert.ok(exports.getArenaCapacity() >= requestedCapacity);
  assert.equal(base + exports.getArenaCapacity(), exports.memory.buffer.byteLength);
});

test("supports aligned reserve and provenance-bearing LIFO mark/reset", async () => {
  const { exports } = await instantiateKernel();
  const base = exports.initializeArena(64);
  const rootMark = exports.markArena();
  const firstPointer = exports.reserveArena(7, 8);
  assert.equal(firstPointer % 8, 0);

  const outerCursor = exports.getArenaCursor();
  const outerMark = exports.markArena();
  const secondPointer = exports.reserveArena(9, 16);
  assert.equal(secondPointer % 16, 0);
  const innerCursor = exports.getArenaCursor();
  const innerMark = exports.markArena();
  exports.reserveArena(23, 4);
  assert.throws(() => exports.resetArena(outerMark), WebAssembly.RuntimeError);
  assert.throws(() => exports.resetArena(base + 1), WebAssembly.RuntimeError);
  exports.resetArena(innerMark);
  assert.equal(exports.getArenaCursor(), innerCursor);
  assert.throws(() => exports.resetArena(innerMark), WebAssembly.RuntimeError);
  exports.resetArena(outerMark);
  assert.equal(exports.getArenaCursor(), outerCursor);
  exports.resetArena(rootMark);
  assert.equal(exports.getArenaCursor(), base);
  assert.throws(() => exports.resetArena(rootMark), WebAssembly.RuntimeError);

  const replacementMark = exports.markArena();
  assert.notEqual(replacementMark, rootMark);
  assert.throws(() => exports.resetArena(rootMark), WebAssembly.RuntimeError);
  exports.resetArena(replacementMark);

  assert.throws(() => exports.reserveArena(1, 0), WebAssembly.RuntimeError);
  assert.throws(() => exports.reserveArena(1, 3), WebAssembly.RuntimeError);
  assert.throws(() => exports.reserveArena(0xffff_ffff, 1), WebAssembly.RuntimeError);
});

test("fault cleanup validates an ancestor before unwinding nested marks", async () => {
  const { exports } = await instantiateKernel();
  const base = exports.initializeArena(64);
  const rootMark = exports.markArena();
  exports.reserveArena(17, 8);
  exports.markArena();
  exports.reserveArena(31, 16);
  exports.markArena();
  exports.reserveArena(47, 8);

  exports.resetArenaAfterFault(rootMark);
  assert.equal(exports.getArenaCursor(), base);

  const retainedMark = exports.markArena();
  exports.reserveArena(9, 8);
  exports.markArena();
  const cursorBeforeInvalidReset = exports.getArenaCursor();
  assert.throws(() => exports.resetArenaAfterFault(rootMark), WebAssembly.RuntimeError);
  assert.equal(exports.getArenaCursor(), cursorBeforeInvalidReset);
  exports.resetArenaAfterFault(retainedMark);
  assert.equal(exports.getArenaCursor(), base);
});

test("grows a continuous arena and requires callers to refresh detached views", async () => {
  const { exports } = await instantiateKernel();
  const base = exports.initializeArena(64);
  const seedPointer = exports.reserveArena(4, 1);
  const oldBuffer = exports.memory.buffer;
  const oldView = new Uint8Array(oldBuffer);
  oldView.set([17, 34, 51, 68], seedPointer);

  const requestedBytes = oldBuffer.byteLength * 2;
  exports.reserveArena(requestedBytes, 16);
  assert.notEqual(exports.memory.buffer, oldBuffer);
  assert.equal(oldBuffer.byteLength, 0);

  const refreshedView = new Uint8Array(exports.memory.buffer);
  assert.deepEqual([...refreshedView.subarray(seedPointer, seedPointer + 4)], [17, 34, 51, 68]);
  assert.equal(exports.getArenaCapacity(), exports.memory.buffer.byteLength - base);
});

test("keeps allocator count, canary, cursor, and high-water stable across long-lived reuse", async () => {
  const { exports } = await instantiateKernel();
  const base = exports.initializeArena(64);
  const reservationBytes = exports.memory.buffer.byteLength * 2;

  for (let iteration = 0; iteration < 5_000; iteration += 1) {
    const markToken = exports.markArena();
    exports.reserveArena(reservationBytes, 16);
    exports.resetArena(markToken);
  }

  const stableByteLength = exports.memory.buffer.byteLength;
  const stablePeak = exports.getArenaPeak();
  for (const roleExport of roleExports.filter(
    (name) =>
      name !== "beginDetectionTask" &&
      name !== "resumeDetectionTask" &&
      name !== "runDetectionTemplateShard" &&
      name !== "runRouteTask" &&
      name !== "assignOneClickTargets" &&
      name !== "runSmartPathfinding" &&
      name !== "beginOneClickClear" &&
      name !== "cancelOneClickClear" &&
      name !== "resumeOneClickClear",
  )) {
    assert.equal(exports[roleExport](), 0);
  }
  const detectionMark = exports.markArena();
  const rgbaPointer = exports.reserveArena(4, 1);
  new Uint8Array(exports.memory.buffer, rgbaPointer, 4).fill(255);
  const detectionInputPointer = exports.reserveArena(160, 8);
  const detectionInput = new DataView(exports.memory.buffer, detectionInputPointer, 160);
  detectionInput.setUint32(0, 1, true);
  detectionInput.setUint32(4, 1, true);
  detectionInput.setUint32(8, 1, true);
  detectionInput.setUint32(12, rgbaPointer, true);
  detectionInput.setUint32(16, 4, true);
  const detectionBeginResult = exports.beginDetectionTask(detectionInputPointer, 160);
  assert.ok(detectionBeginResult > detectionInputPointer);
  const detectionSessionPointer = new DataView(exports.memory.buffer, detectionBeginResult, 96).getUint32(20, true);
  assert.equal(detectionSessionPointer, detectionInputPointer);
  assert.ok(exports.resumeDetectionTask(detectionSessionPointer, 0, 0) > detectionBeginResult);
  assert.throws(() => exports.resumeDetectionTask(detectionSessionPointer, 0, 0), WebAssembly.RuntimeError);
  exports.resetArena(detectionMark);
  for (let iteration = 0; iteration < 5_000; iteration += 1) {
    const markToken = exports.markArena();
    exports.reserveArena(reservationBytes, 16);
    exports.resetArena(markToken);
  }

  assert.equal(exports.memory.buffer.byteLength, stableByteLength);
  assert.equal(exports.getArenaCursor(), base);
  assert.equal(exports.getArenaPeak(), stablePeak);
  assert.equal(exports.getArenaAllocatorCallCount(), 1);
  assert.equal(exports.getArenaCanaryStatus(), 1);
});

test("detects arena-header corruption before another raw operation", async () => {
  const { exports } = await instantiateKernel();
  const base = exports.initializeArena(64);
  const view = new DataView(exports.memory.buffer);
  view.setUint32(base - 16, 0, true);

  assert.equal(exports.getArenaCanaryStatus(), 0);
  assert.throws(() => exports.markArena(), WebAssembly.RuntimeError);
});

test("watch mode keeps the synchronized kernel and waits without an initial rebuild", async () => {
  const modifiedTimeBeforeWatch = (await stat(wasmPath)).mtimeMs;
  const watchProcess = spawn(process.execPath, [join(packageRoot, "scripts", "watch.mjs")], {
    cwd: packageRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let watchOutput = "";
  try {
    await new Promise((resolve, reject) => {
      const readyTimeout = setTimeout(
        () => reject(new Error(`watch mode did not become ready:\n${watchOutput}`)),
        5_000,
      );
      const collectOutput = (chunk) => {
        watchOutput += chunk.toString();
        if (watchOutput.includes("Watching Graphwar kernel sources for changes.")) {
          clearTimeout(readyTimeout);
          resolve();
        }
      };
      watchProcess.stdout.on("data", collectOutput);
      watchProcess.stderr.on("data", collectOutput);
      watchProcess.once("error", reject);
      watchProcess.once("exit", (exitCode) => reject(new Error(`watch mode exited early with code ${exitCode}.`)));
    });
    assert.equal((await stat(wasmPath)).mtimeMs, modifiedTimeBeforeWatch);
  } finally {
    if (watchProcess.exitCode === null && watchProcess.signalCode === null) {
      watchProcess.kill("SIGTERM");
      await new Promise((resolve) => watchProcess.once("exit", resolve));
    }
  }
});

test("guards the source and release configuration against managed hot-path allocation", async () => {
  const assemblyDirectory = join(packageRoot, "assembly");
  const sourceFiles = (await readdir(assemblyDirectory, { recursive: true })).filter((file) => file.endsWith(".ts"));
  const sources = await Promise.all(
    sourceFiles.map(async (file) => ({ file, source: await readFile(join(assemblyDirectory, file), "utf8") })),
  );
  const executableSources = sources.map(({ file, source }) => ({
    file,
    source: source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/\b(?:from|import)\s+["'][^"']+["']/g, ""),
  }));
  const combinedSource = executableSources.map(({ source }) => source).join("\n");
  const heapAllocMatches = combinedSource.match(/\bheap\.alloc\s*\(/g) ?? [];
  assert.equal(heapAllocMatches.length, 1);

  const trajectorySource = executableSources.find(({ file }) => file === "trajectory.ts")?.source ?? "";
  const stepGlitchSource = executableSources.find(({ file }) => file === "step-glitch.ts")?.source ?? "";
  const pathfindingSource = executableSources.find(({ file }) => file === "pathfinding.ts")?.source ?? "";
  const trajectoryRequestReferenceFiles = executableSources
    .filter(({ source }) => /\brunTrajectoryRequest\b/.test(source))
    .map(({ file }) => file)
    .sort();
  assert.deepEqual(trajectoryRequestReferenceFiles, ["pathfinding.ts", "step-glitch.ts", "trajectory.ts"]);
  assert.equal((combinedSource.match(/\brunTrajectoryRequest\b/g) ?? []).length, 8);
  assert.equal((trajectorySource.match(/\brunTrajectoryRequest\b/g) ?? []).length, 2);
  assert.equal((stepGlitchSource.match(/\brunTrajectoryRequest\b/g) ?? []).length, 3);
  assert.equal((pathfindingSource.match(/\brunTrajectoryRequest\b/g) ?? []).length, 3);
  assert.equal((combinedSource.match(/\brunTrajectoryRequest\s*\(/g) ?? []).length, 6);
  assert.equal((trajectorySource.match(/\brunTrajectoryRequest\s*\(/g) ?? []).length, 2);
  assert.equal((stepGlitchSource.match(/\brunTrajectoryRequest\s*\(/g) ?? []).length, 2);
  assert.equal((pathfindingSource.match(/\brunTrajectoryRequest\s*\(/g) ?? []).length, 2);
  assert.match(stepGlitchSource, /import \{ runTrajectoryRequest(?:, runTrajectoryRequestWithMetadata)? \} ;/);
  const prepareLaunchReferenceFiles = executableSources
    .filter(({ source }) => /\brunPrepareLaunch\b/.test(source))
    .map(({ file }) => file)
    .sort();
  assert.deepEqual(prepareLaunchReferenceFiles, ["formula-launch.ts", "formula.ts", "step-glitch.ts", "trajectory.ts"]);
  assert.equal((combinedSource.match(/\brunPrepareLaunch\b/g) ?? []).length, 7);
  assert.equal((stepGlitchSource.match(/\brunPrepareLaunch\b/g) ?? []).length, 2);
  assert.equal((combinedSource.match(/\brunPrepareLaunch\s*\(/g) ?? []).length, 4);
  assert.equal((stepGlitchSource.match(/\brunPrepareLaunch\s*\(/g) ?? []).length, 1);
  assert.match(stepGlitchSource, /import \{ runPrepareLaunch \} ;/);
  assert.doesNotMatch(
    stepGlitchSource,
    /\b(?:evaluateFormulaMaterialValue|replayFormulaTrajectoryScalar\w*|rk4|bisection)\b/i,
  );

  const forbiddenPatterns = [
    /\bheap\.(?:realloc|free)\s*\(/,
    /\bnew\b/,
    /\b(?:Array|StaticArray|ArrayBuffer|Map|Set|WeakMap|WeakSet|string|String)\b/,
    /\[[^\]]*]/s,
    /["'`]/,
    /\.toFixed\s*\(/,
    /\.toString\s*\(/,
    /\bError\b/,
    /\b__new\b/,
  ];
  for (const { file, source } of executableSources) {
    for (const pattern of forbiddenPatterns) {
      assert.equal(pattern.test(source), false, `${file} contains forbidden source: ${pattern}`);
    }
  }

  const entrySource = await readFile(join(assemblyDirectory, "index.ts"), "utf8");
  assert.equal(/\bfunction\b/.test(entrySource), false);

  const asconfig = JSON.parse(await readFile(join(packageRoot, "asconfig.json"), "utf8"));
  assert.deepEqual(Object.keys(asconfig.targets), ["release"]);
  assert.equal(asconfig.targets.release.outFile, "build/graphwar-kernel.wasm");
  assert.equal(asconfig.targets.release.runtime, "stub");
  assert.equal(asconfig.targets.release.optimize, true);
  assert.equal(asconfig.options, undefined);

  const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert.equal(packageJson.devDependencies.assemblyscript, "0.28.20");
  assert.equal(packageJson.scripts.build, "node scripts/build.mjs");
  assert.equal(packageJson.scripts.watch, "node scripts/watch.mjs");
  const buildScript = await readFile(join(packageRoot, "scripts", "build.mjs"), "utf8");
  assert.match(buildScript, /compilerProcess\.kill\(signal\)/);
  assert.match(buildScript, /process\.kill\(process\.pid, receivedSignal\)/);

  const guardDirectory = await mkdtemp(join(tmpdir(), "graphwar-kernel-guard-"));
  try {
    const compilerPath = join(packageRoot, "node_modules", "assemblyscript", "bin", "asc.js");
    const guardWasmPath = join(guardDirectory, "kernel.wasm");
    const guardWatPath = join(guardDirectory, "kernel.wat");
    await execFileAsync(
      process.execPath,
      [
        compilerPath,
        "assembly/index.ts",
        "--target",
        "release",
        "--outFile",
        guardWasmPath,
        "--textFile",
        guardWatPath,
      ],
      { cwd: packageRoot },
    );
    const wat = await readFile(guardWatPath, "utf8");
    // One write initializes the stub runtime in $~start; the other is initializeArena's sole allocation.
    assert.equal((wat.match(/global\.set \$~lib\/rt\/stub\/offset/g) ?? []).length, 2);
    assert.doesNotMatch(wat, /\$~lib\/(?:array|arraybuffer|string|staticarray|map|set)\b|\b__new\b|\b__renew\b/);
  } finally {
    await rm(guardDirectory, { recursive: true, force: true });
  }
});

test("publishes a one-click session only after its waiting result is allocated", async () => {
  const source = await readFile(join(packageRoot, "assembly", "pathfinding.ts"), "utf8");
  const waitingResult = source.indexOf(
    "const resultPointer = writeOneClickResult(\n    Layout.ONE_CLICK_RESULT_STATUS_WAITING_EDGE_BATCH,",
  );
  const publish = source.indexOf("activeOneClickSessionPointer = sessionPointer;", waitingResult);
  const returnResult = source.indexOf("return resultPointer;", publish);

  assert.ok(waitingResult >= 0, "waiting one-click result allocation is present");
  assert.ok(publish > waitingResult, "active session is published after result allocation");
  assert.ok(returnResult > publish, "published session is returned after the publication write");
});
