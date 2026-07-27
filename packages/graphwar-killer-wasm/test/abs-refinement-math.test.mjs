import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const compilerPath = join(packageRoot, "node_modules", "assemblyscript", "bin", "asc.js");
const fixturePath = join(packageRoot, "test", "fixtures", "abs-refinement-math-harness.ts");

const qualitySize = 16;
const boundsSize = 32;
const pulseInputSize = 80;
const pulseResultSize = 16;

async function instantiateHarness() {
  const directory = await mkdtemp(join(tmpdir(), "graphwar-abs-refinement-"));
  const outputPath = join(directory, "harness.wasm");
  try {
    await execFileAsync(
      process.execPath,
      [compilerPath, fixturePath, "--runtime", "stub", "--optimize", "--outFile", outputPath],
      { cwd: packageRoot },
    );
    const module = await WebAssembly.compile(await readFile(outputPath));
    const instance = await WebAssembly.instantiate(module, {});
    instance.exports.initializeArena(64 * 1024);
    return { directory, exports: instance.exports };
  } catch (error) {
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
}

async function withHarness(run) {
  const harness = await instantiateHarness();
  try {
    await run(harness.exports);
  } finally {
    await rm(harness.directory, { force: true, recursive: true });
  }
}

function reserveFloat64Records(exports, values) {
  const pointer = exports.reserveArena(values.length * Float64Array.BYTES_PER_ELEMENT, Float64Array.BYTES_PER_ELEMENT);
  new Float64Array(exports.memory.buffer, pointer, values.length).set(values);
  return pointer;
}

function expectFloatEquivalent(actual, expected, label, maximumUlps = 64n) {
  if (Number.isNaN(expected)) {
    assert.ok(Number.isNaN(actual), `${label}: expected NaN, received ${actual}`);
    return;
  }
  if (!Number.isFinite(expected) || Object.is(expected, 0)) {
    assert.ok(Object.is(actual, expected), `${label}: expected ${expected}, received ${actual}`);
    return;
  }
  assert.ok(Number.isFinite(actual), `${label}: expected finite ${expected}, received ${actual}`);
  assert.ok(ulpDistance(actual, expected) <= maximumUlps, `${label}: ${actual} differs from ${expected}`);
}

const floatBits = new DataView(new ArrayBuffer(8));

function orderedFloatBits(value) {
  floatBits.setFloat64(0, value, false);
  const bits = floatBits.getBigUint64(0, false);
  return bits >> 63n === 0n ? bits | (1n << 63n) : ~bits;
}

function ulpDistance(left, right) {
  const leftBits = orderedFloatBits(left);
  const rightBits = orderedFloatBits(right);
  return leftBits >= rightBits ? leftBits - rightBits : rightBits - leftBits;
}

function pulseProgress(x, centerX, steepness) {
  const argument = steepness * (x - centerX);
  if (argument >= 0) {
    return 1 / (1 + Math.exp(-argument));
  }
  const exponential = Math.exp(argument);
  return exponential / (1 + exponential);
}

function pulseResponse(launchX, targetX, centerX, steepness) {
  const response = pulseProgress(targetX, centerX, steepness) - pulseProgress(launchX, centerX, steepness);
  return response > 0 && Number.isFinite(response) ? response : Number.NaN;
}

function pulseDisplacementResponse(launchX, targetX, centerX, steepness) {
  const launchArgument = steepness * (launchX - centerX);
  const targetArgument = steepness * (targetX - centerX);
  const softplus = (value) => (value >= 0 ? value + Math.log1p(Math.exp(-value)) : Math.log1p(Math.exp(value)));
  return (
    (softplus(targetArgument) - softplus(launchArgument)) / steepness -
    pulseProgress(launchX, centerX, steepness) * (targetX - launchX)
  );
}

test("matches ABS second-derivative target and landing-quality math", async () => {
  await withHarness((exports) => {
    const targets = [-1, 2, 0, 4, 2, 1];
    const states = [-0.9, 2.2, 0.35, 0.1, 3.6, -0.7, 2.1, 1.2, 0.15];
    const targetPointer = reserveFloat64Records(exports, targets);
    const statePointer = reserveFloat64Records(exports, states);
    const qualityPointer = exports.reserveArena(qualitySize, 8);
    exports.writeAbsSecondDerivativeLandingQuality(
      statePointer,
      targetPointer,
      3,
      0.00001,
      450,
      -15,
      15,
      qualityPointer,
    );
    const quality = new Float64Array(exports.memory.buffer, qualityPointer, 2);
    let derivativeError = 0;
    let positionError = 0;
    for (let index = 0; index < 3; index += 1) {
      const stateX = states[index * 3];
      const stateY = states[index * 3 + 1];
      const stateDy = states[index * 3 + 2];
      const targetDy =
        index < 2 ? (targets[(index + 1) * 2 + 1] - stateY) / Math.max(targets[(index + 1) * 2] - stateX, 0.00001) : 0;
      derivativeError = Math.max(derivativeError, Math.abs(stateDy - targetDy));
      positionError = Math.max(positionError, (Math.abs(stateY - targets[index * 2 + 1]) * 450) / 30);
    }
    expectFloatEquivalent(quality[0], derivativeError, "derivative quality");
    expectFloatEquivalent(quality[1], positionError, "position quality");
    expectFloatEquivalent(
      exports.calculateAbsSecondDerivativeTargetDy(1, 2, 1, 1, 5, 0.00001),
      300_000,
      "minimum-x target derivative",
    );
    assert.ok(Object.is(exports.calculateAbsSecondDerivativeTargetDy(1, 2, 0, 0, 0, 0.00001), 0));
  });
});

test("preserves the layered landing-quality ordering and terminal tie-break", async () => {
  await withHarness((exports) => {
    const candidatePointer = reserveFloat64Records(exports, [4, 0.8]);
    const bestPointer = reserveFloat64Records(exports, [1, 1.2]);
    assert.equal(exports.isSecondOrderLandingQualityBetter(candidatePointer, bestPointer, 0, 1, 0, 0, 0), 1);
    assert.equal(exports.isSecondOrderLandingQualityBetter(candidatePointer, bestPointer, 1, 1, 0, 0, 0), 1);

    new Float64Array(exports.memory.buffer, candidatePointer, 2).set([2, 1.4]);
    assert.equal(exports.isSecondOrderLandingQualityBetter(candidatePointer, bestPointer, 1, 1, 0, 0, 0), 0);

    new Float64Array(exports.memory.buffer, candidatePointer, 2).set([0.5, 0.9]);
    new Float64Array(exports.memory.buffer, bestPointer, 2).set([0.5, 0.7]);
    assert.equal(exports.isSecondOrderLandingQualityBetter(candidatePointer, bestPointer, 1, 1, 0.1, 0.2, 1), 1);
    assert.equal(exports.isSecondOrderLandingQualityBetter(candidatePointer, bestPointer, 1, 1, 0.3, 0.2, 1), 0);

    new Float64Array(exports.memory.buffer, candidatePointer, 2).set([9, 0.8]);
    new Float64Array(exports.memory.buffer, bestPointer, 2).set([1, 0.7]);
    assert.equal(exports.isSecondOrderLandingQualityBetter(candidatePointer, bestPointer, 1, 0.75, 0, 0, 0), 0);
    assert.equal(exports.isSecondOrderLandingQualityBetter(candidatePointer, bestPointer, 1, 0.85, 0, 0, 0), 0);
  });
});

test("matches secant, sigmoid response, displacement, and terminal probe bounds", async () => {
  await withHarness((exports) => {
    expectFloatEquivalent(exports.calculateSecantZero(2, 3, 5, -1), 4.25, "secant zero");
    for (const [launchX, targetX, centerX, steepness] of [
      [-4, 3, 0.25, 8],
      [-50, 50, 0, 1],
      [0.2, 0.7, 0.5, 120],
    ]) {
      expectFloatEquivalent(
        exports.evaluateAbsSecondDerivativePulseProgress(targetX, centerX, steepness),
        pulseProgress(targetX, centerX, steepness),
        "pulse progress",
      );
      expectFloatEquivalent(
        exports.calculateAbsSecondDerivativePulseResponse(launchX, targetX, centerX, steepness),
        pulseResponse(launchX, targetX, centerX, steepness),
        "pulse response",
      );
      expectFloatEquivalent(
        exports.calculateAbsSecondDerivativePulseDisplacementResponse(launchX, targetX, centerX, steepness),
        pulseDisplacementResponse(launchX, targetX, centerX, steepness),
        "pulse displacement",
      );
    }
    assert.ok(Number.isNaN(exports.calculateAbsSecondDerivativePulseResponse(2, 1, 0, 4)));

    const boundsPointer = reserveFloat64Records(exports, [-25, 25, -15, 15]);
    const probePointer = exports.reserveArena(boundsSize, 8);
    exports.writeAbsSecondDerivativeTerminalProbeBounds(boundsPointer, probePointer);
    assert.deepEqual(
      [...new Float64Array(exports.memory.buffer, probePointer, 4)],
      [-25, 25, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY],
    );
  });
});

test("resolves fixed and shifted pulses from caller-supplied graph-unit budgets", async () => {
  await withHarness((exports) => {
    const inputPointer = exports.reserveArena(pulseInputSize, 8);
    const resultPointer = exports.reserveArena(pulseResultSize, 8);
    const view = new DataView(exports.memory.buffer);
    view.setFloat64(inputPointer, 1.75, true);
    view.setFloat64(inputPointer + 8, 1.2, true);
    view.setFloat64(inputPointer + 16, 0.8, true);
    view.setFloat64(inputPointer + 24, 12, true);
    view.setFloat64(inputPointer + 32, -1.5, true);
    view.setFloat64(inputPointer + 40, -0.5, true);
    view.setFloat64(inputPointer + 48, 1, true);
    view.setFloat64(inputPointer + 56, 0.05, true);
    view.setFloat64(inputPointer + 64, 0.2, true);
    view.setInt32(inputPointer + 72, 4, true);
    view.setUint32(inputPointer + 76, 1, true);
    exports.resolveAbsSecondDerivativePulse(inputPointer, resultPointer);
    let result = new Float64Array(exports.memory.buffer, resultPointer, 2);
    expectFloatEquivalent(result[0], 0.8, "fixed pulse center");
    expectFloatEquivalent(result[1], 1.75 / pulseResponse(-1.5, 1.2, 0.8, 12), "fixed pulse slope");

    view.setUint32(inputPointer + 76, 0, true);
    exports.resolveAbsSecondDerivativePulse(inputPointer, resultPointer);
    result = new Float64Array(exports.memory.buffer, resultPointer, 2);
    assert.ok(result[0] < 1);
    assert.ok(Number.isFinite(result[1]));
    const firstCenter = result[0];

    view.setFloat64(inputPointer + 64, 0.01, true);
    exports.resolveAbsSecondDerivativePulse(inputPointer, resultPointer);
    result = new Float64Array(exports.memory.buffer, resultPointer, 2);
    assert.notEqual(result[0], firstCenter, "position target must remain caller-controlled");
  });
});

test("uses only raw arena scratch across repeated pulse resolution", async () => {
  await withHarness((exports) => {
    const rootCursor = exports.getArenaCursor();
    const mark = exports.markArena();
    const inputPointer = exports.reserveArena(pulseInputSize, 8);
    const resultPointer = exports.reserveArena(pulseResultSize, 8);
    const stableCursor = exports.getArenaCursor();
    const view = new DataView(exports.memory.buffer);
    view.setFloat64(inputPointer, 2, true);
    view.setFloat64(inputPointer + 8, 1.2, true);
    view.setFloat64(inputPointer + 24, 8, true);
    view.setFloat64(inputPointer + 32, -2, true);
    view.setFloat64(inputPointer + 40, -1, true);
    view.setFloat64(inputPointer + 48, 1, true);
    view.setFloat64(inputPointer + 56, 0.05, true);
    view.setFloat64(inputPointer + 64, 0.08, true);
    view.setInt32(inputPointer + 72, 6, true);
    for (let iteration = 0; iteration < 2_000; iteration += 1) {
      exports.resolveAbsSecondDerivativePulse(inputPointer, resultPointer);
      assert.equal(exports.getArenaCursor(), stableCursor);
      assert.equal(exports.getArenaCanaryStatus(), 1);
    }
    assert.equal(exports.getArenaAllocatorCallCount(), 1);
    exports.resetArena(mark);
    assert.equal(exports.getArenaCursor(), rootCursor);
  });
});
