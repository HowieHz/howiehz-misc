import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const wasmPath = join(packageRoot, "build", "graphwar-kernel.wasm");

const FORMULA_COMMAND_EVALUATE_EXPRESSION_BATCH = 1;
const EXPRESSION_INPUT_BYTE_LENGTH = 36;
const FORMULA_RESULT_BYTE_LENGTH = 48;
const FLOAT64_BYTE_LENGTH = Float64Array.BYTES_PER_ELEMENT;
const SIGN_BIT = 0x8000_0000_0000_0000n;
const U64_MASK = 0xffff_ffff_ffff_ffffn;

const Opcode = Object.freeze({
  Abs: 8,
  Add: 1,
  Constant: 16,
  Cos: 10,
  Divide: 4,
  DY: 15,
  Ln: 12,
  Log10: 7,
  Multiply: 3,
  Negate: 2,
  Pow: 5,
  Sin: 9,
  Sqrt: 6,
  Tan: 11,
  X: 13,
  Y: 14,
});

let compiledModule;

async function instantiateKernel(initialCapacity = 64) {
  compiledModule ??= await WebAssembly.compile(await readFile(wasmPath));
  const instance = await WebAssembly.instantiate(compiledModule);
  instance.exports.initializeArena(initialCapacity);
  return instance.exports;
}

function reserveValues(exports, values, TypedArray) {
  if (values.length === 0) {
    return 0;
  }
  const byteLength = values.length * TypedArray.BYTES_PER_ELEMENT;
  const pointer = exports.reserveArena(byteLength, TypedArray.BYTES_PER_ELEMENT);
  new TypedArray(exports.memory.buffer, pointer, values.length).set(values);
  return pointer;
}

function writeExpressionInput(exports, { constants = [], dy = [0], maximumStackSize, opcodes, x = [0], y = [0] }) {
  assert.equal(x.length, y.length);
  assert.equal(x.length, dy.length);

  const opcodePointer = reserveValues(exports, opcodes, Uint8Array);
  const constantPointer = reserveValues(exports, constants, Float64Array);
  const xPointer = reserveValues(exports, x, Float64Array);
  const yPointer = reserveValues(exports, y, Float64Array);
  const dyPointer = reserveValues(exports, dy, Float64Array);
  const inputPointer = exports.reserveArena(EXPRESSION_INPUT_BYTE_LENGTH, Uint32Array.BYTES_PER_ELEMENT);
  const view = new DataView(exports.memory.buffer);
  view.setUint32(inputPointer, opcodePointer, true);
  view.setUint32(inputPointer + 4, opcodes.length, true);
  view.setUint32(inputPointer + 8, constantPointer, true);
  view.setUint32(inputPointer + 12, constants.length, true);
  view.setUint32(inputPointer + 16, maximumStackSize, true);
  view.setUint32(inputPointer + 20, xPointer, true);
  view.setUint32(inputPointer + 24, yPointer, true);
  view.setUint32(inputPointer + 28, dyPointer, true);
  view.setUint32(inputPointer + 32, x.length, true);
  return inputPointer;
}

function readExpressionResult(exports, resultPointer) {
  const view = new DataView(exports.memory.buffer);
  assert.equal(resultPointer % FLOAT64_BYTE_LENGTH, 0);
  assert.equal(view.getUint32(resultPointer, true), 0);
  assert.equal(view.getUint32(resultPointer + 4, true), 0);
  assert.equal(view.getUint32(resultPointer + 8, true), 0);
  assert.equal(view.getUint32(resultPointer + 12, true), 0);
  assert.equal(view.getFloat64(resultPointer + 24, true), 0);
  assert.equal(view.getUint32(resultPointer + 32, true), 0);
  assert.equal(view.getUint32(resultPointer + 36, true), 0);
  assert.equal(view.getUint32(resultPointer + 40, true), 0);
  assert.equal(
    new Uint8Array(exports.memory.buffer, resultPointer, FORMULA_RESULT_BYTE_LENGTH).length,
    FORMULA_RESULT_BYTE_LENGTH,
  );

  const valuePointer = view.getUint32(resultPointer + 16, true);
  const valueCount = view.getUint32(resultPointer + 20, true);
  if (valueCount === 0) {
    assert.equal(valuePointer, 0);
    return [];
  }
  assert.equal(valuePointer % FLOAT64_BYTE_LENGTH, 0);
  return [...new Float64Array(exports.memory.buffer, valuePointer, valueCount)];
}

async function evaluateProgram(program) {
  const exports = await instantiateKernel();
  const inputPointer = writeExpressionInput(exports, program);
  const resultPointer = exports.runFormula(
    FORMULA_COMMAND_EVALUATE_EXPRESSION_BATCH,
    inputPointer,
    EXPRESSION_INPUT_BYTE_LENGTH,
  );
  return readExpressionResult(exports, resultPointer);
}

const bitView = new DataView(new ArrayBuffer(FLOAT64_BYTE_LENGTH));

function orderedFloatBits(value) {
  bitView.setFloat64(0, value, false);
  const bits = bitView.getBigUint64(0, false);
  return (bits & SIGN_BIT) === 0n ? bits | SIGN_BIT : ~bits & U64_MASK;
}

function rawFloatBits(value) {
  bitView.setFloat64(0, value, false);
  return bitView.getBigUint64(0, false);
}

function getUlpDistance(left, right) {
  const leftBits = orderedFloatBits(left);
  const rightBits = orderedFloatBits(right);
  return leftBits >= rightBits ? leftBits - rightBits : rightBits - leftBits;
}

test("evaluates all 16 canonical expression opcodes", async () => {
  const cases = [
    { expected: 5, maximumStackSize: 2, opcodes: [Opcode.Add, Opcode.X, Opcode.Y], x: 2, y: 3 },
    { expected: -2, maximumStackSize: 1, opcodes: [Opcode.Negate, Opcode.X], x: 2 },
    { expected: 6, maximumStackSize: 2, opcodes: [Opcode.Multiply, Opcode.X, Opcode.Y], x: 2, y: 3 },
    { expected: 2, maximumStackSize: 2, opcodes: [Opcode.Divide, Opcode.X, Opcode.Y], x: 6, y: 3 },
    { expected: 8, maximumStackSize: 2, opcodes: [Opcode.Pow, Opcode.X, Opcode.Y], x: 2, y: 3 },
    { expected: 3, maximumStackSize: 1, opcodes: [Opcode.Sqrt, Opcode.X], x: 9 },
    { expected: 2, maximumStackSize: 1, opcodes: [Opcode.Log10, Opcode.X], x: 100 },
    { expected: 3, maximumStackSize: 1, opcodes: [Opcode.Abs, Opcode.X], x: -3 },
    { expected: 1, maximumStackSize: 1, opcodes: [Opcode.Sin, Opcode.X], x: Math.PI / 2 },
    { expected: 1, maximumStackSize: 1, opcodes: [Opcode.Cos, Opcode.X], x: 0 },
    { expected: 1, maximumStackSize: 1, opcodes: [Opcode.Tan, Opcode.X], x: Math.PI / 4 },
    { expected: 1, maximumStackSize: 1, opcodes: [Opcode.Ln, Opcode.X], x: Math.E },
    { expected: 7, maximumStackSize: 1, opcodes: [Opcode.X], x: 7 },
    { expected: 8, maximumStackSize: 1, opcodes: [Opcode.Y], y: 8 },
    { dy: 9, expected: 9, maximumStackSize: 1, opcodes: [Opcode.DY] },
    { constants: [10], expected: 10, maximumStackSize: 1, opcodes: [Opcode.Constant] },
  ];

  for (const { constants = [], dy = 0, expected, maximumStackSize, opcodes, x = 0, y = 0 } of cases) {
    const actual = await evaluateProgram({
      constants: new Float64Array(constants),
      dy: new Float64Array([dy]),
      maximumStackSize,
      opcodes: new Uint8Array(opcodes),
      x: new Float64Array([x]),
      y: new Float64Array([y]),
    });
    assert.ok(Math.abs(actual[0] - expected) <= 1e-15, `${opcodes[0]} produced ${actual[0]}`);
  }
});

test("uses the reverse constant cursor and reverse-prefix divide/pow operand order", async () => {
  const [constantCursorValue] = await evaluateProgram({
    constants: new Float64Array([2, 3, 4]),
    maximumStackSize: 2,
    opcodes: new Uint8Array([Opcode.Add, Opcode.Constant, Opcode.Multiply, Opcode.Constant, Opcode.Constant]),
  });
  assert.equal(constantCursorValue, 14);

  const [operandOrderValue] = await evaluateProgram({
    constants: new Float64Array([2]),
    maximumStackSize: 2,
    opcodes: new Uint8Array([Opcode.Divide, Opcode.X, Opcode.Pow, Opcode.Y, Opcode.Constant]),
    x: new Float64Array([18]),
    y: new Float64Array([3]),
  });
  assert.equal(operandOrderValue, 2);
});

test("batches x/y/dy inputs through one dynamically reserved operand stack", async () => {
  const actual = await evaluateProgram({
    maximumStackSize: 2,
    opcodes: new Uint8Array([Opcode.Add, Opcode.X, Opcode.Multiply, Opcode.Y, Opcode.DY]),
    x: new Float64Array([1, 2, 3]),
    y: new Float64Array([4, 5, 6]),
    dy: new Float64Array([7, 8, 9]),
  });
  assert.deepEqual(actual, [29, 42, 57]);

  const empty = await evaluateProgram({
    maximumStackSize: 1,
    opcodes: new Uint8Array([Opcode.X]),
    x: new Float64Array(),
    y: new Float64Array(),
    dy: new Float64Array(),
  });
  assert.deepEqual(empty, []);
});

test("evaluates a canonical program whose exact operand stack is 128 values deep", async () => {
  const opcodes = new Uint8Array(255);
  opcodes.fill(Opcode.Add, 0, 127);
  opcodes.fill(Opcode.Constant, 127);
  const constants = Float64Array.from({ length: 128 }, (_, index) => index + 1);

  const [actual] = await evaluateProgram({ constants, maximumStackSize: 128, opcodes });
  assert.equal(actual, (128 * 129) / 2);
});

test("traps malformed programs instead of evaluating a partial operand stack", async () => {
  const malformedPrograms = [
    { constants: new Float64Array(), maximumStackSize: 0, opcodes: new Uint8Array() },
    { constants: new Float64Array(), maximumStackSize: 1, opcodes: new Uint8Array([0]) },
    {
      constants: new Float64Array(),
      maximumStackSize: 1,
      opcodes: new Uint8Array([Opcode.Add, Opcode.X]),
    },
    {
      constants: new Float64Array(),
      maximumStackSize: 2,
      opcodes: new Uint8Array([Opcode.X, Opcode.Y]),
    },
    { constants: new Float64Array(), maximumStackSize: 1, opcodes: new Uint8Array([Opcode.Constant]) },
    { constants: new Float64Array(), maximumStackSize: 2, opcodes: new Uint8Array([Opcode.X]) },
  ];

  for (const program of malformedPrograms) {
    const exports = await instantiateKernel();
    const inputPointer = writeExpressionInput(exports, program);
    assert.throws(
      () => exports.runFormula(FORMULA_COMMAND_EVALUATE_EXPRESSION_BATCH, inputPointer, EXPRESSION_INPUT_BYTE_LENGTH),
      WebAssembly.RuntimeError,
    );
  }
});

test("preserves signed zero through VM operations", async () => {
  const cases = [
    { constants: [-0], opcodes: [Opcode.Constant], expected: -0 },
    { constants: [0], opcodes: [Opcode.Negate, Opcode.Constant], expected: -0 },
    { constants: [-0], opcodes: [Opcode.Abs, Opcode.Constant], expected: 0 },
    { constants: [-0, 2], opcodes: [Opcode.Divide, Opcode.Constant, Opcode.Constant], expected: -0 },
    { constants: [-0, 3], opcodes: [Opcode.Pow, Opcode.Constant, Opcode.Constant], expected: -0 },
  ];

  for (const { constants, expected, opcodes } of cases) {
    const [actual] = await evaluateProgram({
      constants: new Float64Array(constants),
      maximumStackSize: opcodes.length > 2 ? 2 : 1,
      opcodes: new Uint8Array(opcodes),
    });
    assert.equal(Object.is(actual, expected), true, `${opcodes[0]} lost the zero sign`);
  }
});

test("normalizes only final NaN/Infinity and permits finite recovery from intermediate Infinity", async () => {
  for (const constants of [[Number.POSITIVE_INFINITY], [Number.NaN]]) {
    const [actual] = await evaluateProgram({
      constants: new Float64Array(constants),
      maximumStackSize: 1,
      opcodes: new Uint8Array([Opcode.Constant]),
    });
    assert.equal(Number.isNaN(actual), true);
  }

  const [reciprocalInfinity] = await evaluateProgram({
    constants: new Float64Array([1, Number.POSITIVE_INFINITY]),
    maximumStackSize: 2,
    opcodes: new Uint8Array([Opcode.Divide, Opcode.Constant, Opcode.Constant]),
  });
  assert.equal(reciprocalInfinity, 0);

  const [nestedRecovery] = await evaluateProgram({
    constants: new Float64Array([1, 1, 0]),
    maximumStackSize: 2,
    opcodes: new Uint8Array([Opcode.Divide, Opcode.Constant, Opcode.Divide, Opcode.Constant, Opcode.Constant]),
  });
  assert.equal(nestedRecovery, 0);
});

test("keeps extreme finite pow results within the 64 ULP numerical gate", async () => {
  const cases = [
    [1.0000000000000002, 1_000_000],
    [0.9999999999999999, 1_000_000],
    [-1.0000000000000002, 999_999],
    [2, 1_023],
    [2, -1_074],
    [1e-200, 2],
    [1e200, -2],
  ];

  for (const [base, exponent] of cases) {
    const expected = Math.pow(base, exponent);
    const [actual] = await evaluateProgram({
      constants: new Float64Array([base, exponent]),
      maximumStackSize: 2,
      opcodes: new Uint8Array([Opcode.Pow, Opcode.Constant, Opcode.Constant]),
    });
    assert.equal(Number.isFinite(actual), true);
    assert.ok(
      getUlpDistance(actual, expected) <= 64n,
      `${base}^${exponent} differed by ${getUlpDistance(actual, expected)} ULP`,
    );
  }

  for (const [base, exponent] of [
    [2, 1_024],
    [-2, 0.5],
  ]) {
    const [actual] = await evaluateProgram({
      constants: new Float64Array([base, exponent]),
      maximumStackSize: 2,
      opcodes: new Uint8Array([Opcode.Pow, Opcode.Constant, Opcode.Constant]),
    });
    assert.equal(Number.isNaN(actual), true);
  }
});

test("matches original Java raw bits for a sampled exponential expression", async () => {
  // Graphwar's PolishNotationFunction evaluated e^(-((x-8)^2)) to these exact raw bits.
  const x = new Float64Array([-100, 0, 7.999999999999999, 8, 8.000000000000002, 16, 100]);
  const actual = await evaluateProgram({
    constants: new Float64Array([Math.E, 8, 2]),
    dy: new Float64Array(x.length),
    maximumStackSize: 3,
    opcodes: new Uint8Array([
      Opcode.Pow,
      Opcode.Constant,
      Opcode.Negate,
      Opcode.Pow,
      Opcode.Add,
      Opcode.X,
      Opcode.Negate,
      Opcode.Constant,
      Opcode.Constant,
    ]),
    x,
    y: new Float64Array(x.length),
  });

  assert.deepEqual(actual.map(rawFloatBits), [
    0n,
    0x3a29_69d4_7321_e4e4n,
    0x3ff0_0000_0000_0000n,
    0x3ff0_0000_0000_0000n,
    0x3ff0_0000_0000_0000n,
    0x3a29_69d4_7321_e4e4n,
    0n,
  ]);
});
