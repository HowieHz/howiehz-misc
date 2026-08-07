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
const wasmPath = join(packageRoot, "build", "graphwar-kernel.wasm");
const compilerPath = join(packageRoot, "node_modules", "assemblyscript", "bin", "asc.js");

const FORMULA_COMMAND_CANONICAL_DECIMAL = 5;
const DECIMAL_INPUT_BYTE_LENGTH = 16;
const DECIMAL_RESULT_BYTE_LENGTH = 32;
const MAX_DECIMAL_PLACES = 15;

let compiledModule;

async function instantiateKernel(initialCapacity = 64) {
  compiledModule ??= await WebAssembly.compile(await readFile(wasmPath));
  const instance = await WebAssembly.instantiate(compiledModule);
  instance.exports.initializeArena(initialCapacity);
  return instance.exports;
}

function normalizeZero(value, decimalPlaces) {
  return Math.abs(value) < 0.5 * 10 ** -decimalPlaces ? 0 : value;
}

function expandExponentialNotation(value) {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(value);
  if (!match) {
    return value;
  }
  const [, sign, integerPart, fractionPart = "", exponentText] = match;
  const exponent = Number(exponentText);
  const digits = `${integerPart}${fractionPart}`;
  const decimalIndex = integerPart.length + exponent;
  if (decimalIndex <= 0) {
    return `${sign}0.${"0".repeat(-decimalIndex)}${digits}`;
  }
  if (decimalIndex >= digits.length) {
    return `${sign}${digits}${"0".repeat(decimalIndex - digits.length)}`;
  }
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function canonicalIntegerUnits(value, decimalPlaces) {
  const formatted = expandExponentialNotation(value.toFixed(decimalPlaces))
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
  const [integerPart, fractionPart = ""] = formatted.split(".");
  return BigInt(`${integerPart}${fractionPart.padEnd(decimalPlaces, "0")}`);
}

function expectedCanonicalDecimal(value, decimalPlaces) {
  if (!Number.isFinite(value)) {
    return { decimalPlaces, digits: "", roundedValue: value, sign: 0, units: 0n };
  }
  const normalizedValue = normalizeZero(value, decimalPlaces);
  if (normalizedValue === 0) {
    return { decimalPlaces, digits: "0", roundedValue: 0, sign: 0, units: 0n };
  }

  const magnitude = Math.abs(normalizedValue);
  let units;
  let roundedValue;
  units = canonicalIntegerUnits(magnitude, decimalPlaces);
  roundedValue = Number(normalizedValue.toFixed(decimalPlaces));
  return {
    decimalPlaces,
    digits: units.toString(),
    roundedValue,
    sign: normalizedValue < 0 ? -1 : 1,
    units,
  };
}

function writeDecimalInput(exports, value, decimalPlaces) {
  const pointer = exports.reserveArena(DECIMAL_INPUT_BYTE_LENGTH, Float64Array.BYTES_PER_ELEMENT);
  const view = new DataView(exports.memory.buffer);
  view.setFloat64(pointer, value, true);
  view.setInt32(pointer + 8, decimalPlaces, true);
  view.setUint32(pointer + 12, 0, true);
  return pointer;
}

function readCanonicalDecimal(exports, resultPointer) {
  assert.equal(resultPointer % Float64Array.BYTES_PER_ELEMENT, 0);
  const view = new DataView(exports.memory.buffer);
  const sign = view.getInt32(resultPointer, true);
  const digitPointer = view.getUint32(resultPointer + 4, true);
  const digitCount = view.getUint32(resultPointer + 8, true);
  const decimalPlaces = view.getInt32(resultPointer + 12, true);
  const limbPointer = view.getUint32(resultPointer + 16, true);
  const limbCount = view.getUint32(resultPointer + 20, true);
  const roundedValue = view.getFloat64(resultPointer + 24, true);
  const digits =
    digitCount === 0 ? "" : new TextDecoder().decode(new Uint8Array(exports.memory.buffer, digitPointer, digitCount));
  let units = 0n;
  for (let index = limbCount - 1; index >= 0; index -= 1) {
    units = (units << 32n) | BigInt(view.getUint32(limbPointer + index * Uint32Array.BYTES_PER_ELEMENT, true));
  }
  assert.equal(new Uint8Array(exports.memory.buffer, resultPointer, DECIMAL_RESULT_BYTE_LENGTH).length, 32);
  return { decimalPlaces, digits, roundedValue, sign, units };
}

function assertSameNumber(actual, expected) {
  if (Number.isNaN(expected)) {
    assert.equal(Number.isNaN(actual), true);
  } else {
    assert.equal(Object.is(actual, expected), true);
  }
}

function assertCanonicalResult(actual, expected) {
  assert.equal(actual.sign, expected.sign);
  assert.equal(actual.digits, expected.digits);
  assert.equal(actual.decimalPlaces, expected.decimalPlaces);
  assert.equal(actual.units, expected.units);
  assertSameNumber(actual.roundedValue, expected.roundedValue);
}

function adjacentFloat(value, direction) {
  const buffer = new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false);
  const bits = view.getBigUint64(0, false);
  view.setBigUint64(0, direction < 0 ? bits - 1n : bits + 1n, false);
  return view.getFloat64(0, false);
}

function evaluateCanonicalDecimal(exports, value, decimalPlaces) {
  const inputPointer = writeDecimalInput(exports, value, decimalPlaces);
  const resultPointer = exports.runFormula(FORMULA_COMMAND_CANONICAL_DECIMAL, inputPointer, DECIMAL_INPUT_BYTE_LENGTH);
  return readCanonicalDecimal(exports, resultPointer);
}

test("matches normalizeZero/toFixed golden ties, carries, signs, and 0..15 places", async () => {
  const exports = await instantiateKernel();
  const cases = [
    [2.5, 0],
    [-2.5, 0],
    [1.25, 1],
    [-1.25, 1],
    [2.675, 2],
    [9.999, 2],
    [99.95, 1],
    [-0, 15],
    [-0.00049, 3],
    [0.0005, 3],
    [-0.0005, 3],
    [1.2345678901234567, 15],
    [-1.2345678901234567, 15],
    [Number.MIN_VALUE, 15],
    [-Number.MIN_VALUE, 15],
    [Number.POSITIVE_INFINITY, 4],
    [Number.NEGATIVE_INFINITY, 4],
    [Number.NaN, 4],
  ];

  for (const [value, decimalPlaces] of cases) {
    const mark = exports.markArena();
    assertCanonicalResult(
      evaluateCanonicalDecimal(exports, value, decimalPlaces),
      expectedCanonicalDecimal(value, decimalPlaces),
    );
    exports.resetArena(mark);
  }
});

test("keeps shortest canonical units beyond i64, including Number#toString values at least 1e21", async () => {
  const exports = await instantiateKernel();
  const belowExponentialThreshold = adjacentFloat(1e21, -1);
  const aboveExponentialThreshold = adjacentFloat(1e21, 1);
  for (const [value, decimalPlaces] of [
    [1e20, 15],
    [-1e20, 15],
    [belowExponentialThreshold, 15],
    [1e21, 15],
    [aboveExponentialThreshold, 15],
    [-belowExponentialThreshold, 15],
    [-aboveExponentialThreshold, 15],
    [Number.MAX_VALUE, 15],
    [-Number.MAX_VALUE, 0],
  ]) {
    const mark = exports.markArena();
    const actual = evaluateCanonicalDecimal(exports, value, decimalPlaces);
    const expected = expectedCanonicalDecimal(value, decimalPlaces);
    assertCanonicalResult(actual, expected);
    assert.ok(actual.units > 0x7fff_ffff_ffff_ffffn);
    exports.resetArena(mark);
  }

  assert.equal(
    evaluateCanonicalDecimal(exports, Number.MAX_VALUE, 15).digits,
    `${Number.MAX_VALUE.toString().replace(".", "").replace("e+308", "")}${"0".repeat(292 + 15)}`,
  );
});

test("differentially matches JS fixed rounding across deterministic finite bit patterns", async () => {
  const exports = await instantiateKernel();
  const bitView = new DataView(new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT));
  let state = 0x9e37_79b9_7f4a_7c15n;
  const nextBits = () => {
    state ^= state >> 12n;
    state ^= (state << 25n) & 0xffff_ffff_ffff_ffffn;
    state ^= state >> 27n;
    return (state * 0x2545_f491_4f6c_dd1dn) & 0xffff_ffff_ffff_ffffn;
  };

  for (let index = 0; index < 2_000; index += 1) {
    bitView.setBigUint64(0, nextBits(), false);
    const value = bitView.getFloat64(0, false);
    if (!Number.isFinite(value)) {
      continue;
    }
    const decimalPlaces = index % (MAX_DECIMAL_PLACES + 1);
    const mark = exports.markArena();
    try {
      assertCanonicalResult(
        evaluateCanonicalDecimal(exports, value, decimalPlaces),
        expectedCanonicalDecimal(value, decimalPlaces),
      );
    } catch (error) {
      throw new Error(`bit-pattern case ${index}, value=${value}, places=${decimalPlaces}`, { cause: error });
    }
    exports.resetArena(mark);
  }
  assert.equal(exports.getArenaCanaryStatus(), 1);
});

async function compileLimbHarness() {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "graphwar-limb-test-"));
  const sourcePath = join(packageRoot, "test", `.limb-harness.${process.pid}.${Date.now()}.ts`);
  const outputPath = join(temporaryDirectory, "limb-harness.wasm");
  await writeFile(
    sourcePath,
    [
      'export { createSignedLimbState, resetSignedLimbState, signedLimbToF64 } from "../assembly/core/limb-integer";',
      'export { addQuantizedDecimalUnits } from "../assembly/core/decimal";',
      'export { initializeArena } from "../assembly/core/memory";',
    ].join("\n"),
    "utf8",
  );
  try {
    await execFileAsync(
      process.execPath,
      [compilerPath, sourcePath, "--runtime", "stub", "--optimize", "--outFile", outputPath],
      { cwd: packageRoot },
    );
    return { bytes: await readFile(outputPath), temporaryDirectory };
  } finally {
    await rm(sourcePath, { force: true });
  }
}

function writeSignedState(exports, statePointer, value) {
  const view = new DataView(exports.memory.buffer);
  const magnitude = value < 0n ? -value : value;
  const limbs = [];
  let remaining = magnitude;
  while (remaining !== 0n) {
    limbs.push(Number(remaining & 0xffff_ffffn));
    remaining >>= 32n;
  }
  const capacity = view.getUint32(statePointer + 8, true);
  const limbPointer = view.getUint32(statePointer + 12, true);
  assert.ok(limbs.length <= capacity);
  new Uint32Array(exports.memory.buffer, limbPointer, capacity).fill(0);
  new Uint32Array(exports.memory.buffer, limbPointer, limbs.length).set(limbs);
  view.setInt32(statePointer, value === 0n ? 0 : value < 0n ? -1 : 1, true);
  view.setUint32(statePointer + 4, limbs.length, true);
}

function readSignedState(exports, statePointer) {
  const view = new DataView(exports.memory.buffer);
  const sign = view.getInt32(statePointer, true);
  const count = view.getUint32(statePointer + 4, true);
  const limbPointer = view.getUint32(statePointer + 12, true);
  let magnitude = 0n;
  for (let index = count - 1; index >= 0; index -= 1) {
    magnitude = (magnitude << 32n) | BigInt(view.getUint32(limbPointer + index * 4, true));
  }
  return sign < 0 ? -magnitude : magnitude;
}

test("rounds arbitrary signed limbs like Number(bigint) and reuses accumulator storage", async () => {
  const { bytes, temporaryDirectory } = await compileLimbHarness();
  try {
    const instance = await WebAssembly.instantiate(bytes);
    const exports = instance.instance.exports;
    exports.initializeArena(64);
    const statePointer = exports.createSignedLimbState(40);
    for (const value of [
      2n ** 53n + 1n,
      2n ** 53n + 3n,
      -(2n ** 53n + 1n),
      2n ** 54n + 2n,
      2n ** 54n + 6n,
      -(2n ** 54n + 2n),
      -(2n ** 54n + 6n),
      2n ** 100n + 2n ** 47n,
      24_918_394_899_649_603n * 10n ** 87n,
      24_918_394_899_649_604n * 10n ** 87n,
      2n ** 1024n - 2n ** 970n - 1n,
      2n ** 1024n - 2n ** 970n,
      2n ** 1024n - 2n ** 970n + 1n,
    ]) {
      writeSignedState(exports, statePointer, value);
      assertSameNumber(exports.signedLimbToF64(statePointer), Number(value));
    }

    exports.resetSignedLimbState(statePointer);
    exports.addQuantizedDecimalUnits(statePointer, 2.4918394899649603e103, 6);
    assert.equal(readSignedState(exports, statePointer), canonicalIntegerUnits(2.4918394899649603e103, 6));
    exports.resetSignedLimbState(statePointer);
    exports.addQuantizedDecimalUnits(statePointer, 1e20, 15);
    exports.addQuantizedDecimalUnits(statePointer, -1, 15);
    assertSameNumber(exports.signedLimbToF64(statePointer), Number(10n ** 35n - 10n ** 15n));
    exports.resetSignedLimbState(statePointer);
    assert.equal(exports.signedLimbToF64(statePointer), 0);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("rejects invalid decimal protocol values", async () => {
  for (const decimalPlaces of [-1, 16]) {
    const exports = await instantiateKernel();
    const inputPointer = writeDecimalInput(exports, 1, decimalPlaces);
    assert.throws(
      () => exports.runFormula(FORMULA_COMMAND_CANONICAL_DECIMAL, inputPointer, DECIMAL_INPUT_BYTE_LENGTH),
      WebAssembly.RuntimeError,
    );
  }

  const exports = await instantiateKernel();
  const inputPointer = writeDecimalInput(exports, 1, 4);
  assert.throws(() => exports.runFormula(FORMULA_COMMAND_CANONICAL_DECIMAL, inputPointer, 8), WebAssembly.RuntimeError);
});
