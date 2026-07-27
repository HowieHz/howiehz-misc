import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const compilerPath = join(packageRoot, "node_modules", "assemblyscript", "bin", "asc.js");
const LIMB_BITS = 32n;
const LIMB_MASK = 0xffff_ffffn;

let compiledHarness;

async function instantiateHarness() {
  compiledHarness ??= await WebAssembly.compile(await compileHarness());
  const instance = await WebAssembly.instantiate(compiledHarness);
  instance.exports.initializeArena(256);
  return instance.exports;
}

function splitMagnitude(value) {
  const limbs = [];
  let remaining = value < 0n ? -value : value;
  while (remaining !== 0n) {
    limbs.push(Number(remaining & LIMB_MASK));
    remaining >>= LIMB_BITS;
  }
  return limbs;
}

function reserveMagnitude(exports, value, capacity = Math.max(1, splitMagnitude(value).length)) {
  const limbs = splitMagnitude(value);
  assert.ok(limbs.length <= capacity);
  const pointer = exports.reserveArena(capacity * Uint32Array.BYTES_PER_ELEMENT, Uint32Array.BYTES_PER_ELEMENT);
  const storage = new Uint32Array(exports.memory.buffer, pointer, capacity);
  storage.fill(0);
  storage.set(limbs);
  return { count: limbs.length, pointer };
}

function readSignedMagnitude(exports, sign, pointer, count) {
  const view = new DataView(exports.memory.buffer);
  let magnitude = 0n;
  for (let index = count - 1; index >= 0; index -= 1) {
    magnitude = (magnitude << LIMB_BITS) | BigInt(view.getUint32(pointer + index * 4, true));
  }
  return sign < 0 ? -magnitude : magnitude;
}

function addDirect(exports, left, right, capacity) {
  const leftMagnitude = reserveMagnitude(exports, left);
  const rightMagnitude = reserveMagnitude(exports, right);
  const resultSignPointer = exports.reserveArena(Int32Array.BYTES_PER_ELEMENT, Int32Array.BYTES_PER_ELEMENT);
  const resultPointer = exports.reserveArena(capacity * Uint32Array.BYTES_PER_ELEMENT, Uint32Array.BYTES_PER_ELEMENT);
  new Uint32Array(exports.memory.buffer, resultPointer, capacity).fill(0xa5a5_a5a5);
  const resultCount = exports.addSignedLimbs(
    left === 0n ? 0 : left < 0n ? -1 : 1,
    leftMagnitude.pointer,
    leftMagnitude.count,
    right === 0n ? 0 : right < 0n ? -1 : 1,
    rightMagnitude.pointer,
    rightMagnitude.count,
    resultSignPointer,
    resultPointer,
    capacity,
  );
  const resultSign = new DataView(exports.memory.buffer).getInt32(resultSignPointer, true);
  return {
    count: resultCount,
    sign: resultSign,
    value: readSignedMagnitude(exports, resultSign, resultPointer, resultCount),
  };
}

function writeState(exports, statePointer, value) {
  const view = new DataView(exports.memory.buffer);
  const capacity = view.getUint32(statePointer + 8, true);
  const limbPointer = view.getUint32(statePointer + 12, true);
  const limbs = splitMagnitude(value);
  assert.ok(limbs.length <= capacity);
  const storage = new Uint32Array(exports.memory.buffer, limbPointer, capacity);
  storage.fill(0);
  storage.set(limbs);
  view.setInt32(statePointer, value === 0n ? 0 : value < 0n ? -1 : 1, true);
  view.setUint32(statePointer + 4, limbs.length, true);
}

function readState(exports, statePointer) {
  const view = new DataView(exports.memory.buffer);
  const sign = view.getInt32(statePointer, true);
  const count = view.getUint32(statePointer + 4, true);
  const limbPointer = view.getUint32(statePointer + 12, true);
  return {
    count,
    limbPointer,
    sign,
    value: readSignedMagnitude(exports, sign, limbPointer, count),
  };
}

test("compares canonical and zero-extended multi-limb magnitudes", async () => {
  const exports = await instantiateHarness();
  const lowerValue = (1n << 127n) + (7n << 64n) + 11n;
  const higherValue = lowerValue + (1n << 96n);
  const lower = reserveMagnitude(exports, lowerValue);
  const higher = reserveMagnitude(exports, higherValue);
  const zeroExtended = reserveMagnitude(exports, lowerValue, lower.count + 2);

  assert.equal(exports.compareSignedLimbMagnitudes(lower.pointer, lower.count, higher.pointer, higher.count), -1);
  assert.equal(exports.compareSignedLimbMagnitudes(higher.pointer, higher.count, lower.pointer, lower.count), 1);
  assert.equal(
    exports.compareSignedLimbMagnitudes(lower.pointer, lower.count, zeroExtended.pointer, lower.count + 2),
    0,
  );
});

test("adds positive and negative values across carry and borrow chains", async () => {
  const exports = await instantiateHarness();
  const allLowLimbsSet = (1n << 96n) - 1n;
  const carryResult = addDirect(exports, allLowLimbsSet, 1n, 4);
  assert.deepEqual(carryResult, { count: 4, sign: 1, value: 1n << 96n });

  const negativeCarryResult = addDirect(exports, -allLowLimbsSet, -1n, 4);
  assert.deepEqual(negativeCarryResult, { count: 4, sign: -1, value: -(1n << 96n) });

  const borrowLeft = (1n << 128n) + 3n;
  const borrowRight = (1n << 96n) + 5n;
  const positiveBorrowResult = addDirect(exports, borrowLeft, -borrowRight, 5);
  assert.deepEqual(positiveBorrowResult, {
    count: splitMagnitude(borrowLeft - borrowRight).length,
    sign: 1,
    value: borrowLeft - borrowRight,
  });

  const negativeBorrowResult = addDirect(exports, borrowRight, -borrowLeft, 5);
  assert.deepEqual(negativeBorrowResult, {
    count: splitMagnitude(borrowLeft - borrowRight).length,
    sign: -1,
    value: borrowRight - borrowLeft,
  });
});

test("canonicalizes exact cancellation to signless zero", async () => {
  const exports = await instantiateHarness();
  const value = (1n << 160n) + (9n << 65n) + 17n;
  assert.deepEqual(addDirect(exports, value, -value, 6), { count: 0, sign: 0, value: 0n });

  const statePointer = exports.createSignedLimbState(6);
  writeState(exports, statePointer, value);
  const opposite = reserveMagnitude(exports, -value);
  exports.addSignedMagnitudeToState(statePointer, -1, opposite.pointer, opposite.count);
  const state = readState(exports, statePointer);
  assert.deepEqual({ count: state.count, sign: state.sign, value: state.value }, { count: 0, sign: 0, value: 0n });
  assert.deepEqual(Array.from(new Uint32Array(exports.memory.buffer, state.limbPointer, 6)), [0, 0, 0, 0, 0, 0]);
});

test("updates reusable state safely when the result aliases its inputs", async () => {
  const exports = await instantiateHarness();
  const statePointer = exports.createSignedLimbState(6);
  const initialValue = (1n << 96n) + 0xffff_ffffn;
  writeState(exports, statePointer, initialValue);

  let state = readState(exports, statePointer);
  exports.addSignedMagnitudeToState(statePointer, state.sign, state.limbPointer, state.count);
  assert.equal(readState(exports, statePointer).value, initialValue * 2n);

  const increment = reserveMagnitude(exports, (1n << 128n) + 1n);
  exports.addSignedMagnitudeToState(statePointer, 1, increment.pointer, increment.count);
  assert.equal(readState(exports, statePointer).value, initialValue * 2n + (1n << 128n) + 1n);

  const largerNegative = reserveMagnitude(exports, (1n << 160n) + 7n);
  exports.addSignedMagnitudeToState(statePointer, -1, largerNegative.pointer, largerNegative.count);
  assert.equal(readState(exports, statePointer).value, initialValue * 2n + (1n << 128n) + 1n - ((1n << 160n) + 7n));
});

test("traps instead of truncating carry beyond caller capacity", async () => {
  const exports = await instantiateHarness();
  const left = reserveMagnitude(exports, (1n << 64n) - 1n);
  const right = reserveMagnitude(exports, 1n);
  const resultSignPointer = exports.reserveArena(4, 4);
  const resultPointer = exports.reserveArena(8, 4);
  assert.throws(
    () =>
      exports.addSignedLimbs(
        1,
        left.pointer,
        left.count,
        1,
        right.pointer,
        right.count,
        resultSignPointer,
        resultPointer,
        2,
      ),
    WebAssembly.RuntimeError,
  );

  const stateExports = await instantiateHarness();
  const statePointer = stateExports.createSignedLimbState(2);
  writeState(stateExports, statePointer, (1n << 64n) - 1n);
  const stateIncrement = reserveMagnitude(stateExports, 1n);
  assert.throws(
    () => stateExports.addSignedMagnitudeToState(statePointer, 1, stateIncrement.pointer, stateIncrement.count),
    WebAssembly.RuntimeError,
  );
});

async function compileHarness() {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "graphwar-limb-integer-test-"));
  const sourcePath = join(packageRoot, "test", `.limb-integer-harness.${process.pid}.${Date.now()}.ts`);
  const outputPath = join(temporaryDirectory, "limb-integer-harness.wasm");
  try {
    await writeFile(
      sourcePath,
      [
        "export {",
        "  addSignedLimbs,",
        "  addSignedMagnitudeToState,",
        "  compareSignedLimbMagnitudes,",
        "  createSignedLimbState,",
        '} from "../assembly/limb-integer";',
        'export { initializeArena, reserveArena } from "../assembly/memory";',
      ].join("\n"),
      "utf8",
    );
    await execFileAsync(
      process.execPath,
      [compilerPath, sourcePath, "--runtime", "stub", "--optimize", "--outFile", outputPath],
      { cwd: packageRoot },
    );
    return await readFile(outputPath);
  } finally {
    await rm(sourcePath, { force: true });
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
