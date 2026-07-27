import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const wasmPath = join(packageRoot, "build", "graphwar-kernel.wasm");
const kernelModule = WebAssembly.compile(await readFile(wasmPath));
const gameConstants = new Float64Array([770, 450, 50, 7, 15, 0.01, 20_000, 0.001, 0.00001, Math.PI / 360, 100]);
const inputByteLength = 176;

test("cold-replays launch-only zero-sign evidence before publishing ABS dy", async () => {
  const exports = await instantiateKernel();
  const mark = exports.markArena();
  const result = runLaunch(exports, {
    equation: 2,
    points: [
      [0, 0],
      [1, 1],
    ],
    soldierCenter: [-(7 * 50) / 770, 0],
  });

  assert.equal(result.status, 1);
  assert.deepEqual(result.protection, [1]);
  assert.deepEqual(result.formulaPoints, [
    [0, 0],
    [1, 1],
  ]);
  assert.equal(result.materials[0]?.coefficient, 0.5);
  exports.resetArena(mark);
  assert.equal(exports.getArenaCursor(), exports.getArenaBase());
  assert.equal(exports.getArenaAllocatorCallCount(), 1);
  assert.equal(exports.getArenaCanaryStatus(), 1);
});

test("cold-refines ABS second-derivative pulses from the raw descriptor", async () => {
  const exports = await instantiateKernel();
  const mark = exports.markArena();
  const result = runLaunch(exports, {
    equation: 3,
    points: [
      [-23.376623376623378, 2.5974025974025974],
      [-19, 0],
      [-17, -1.2],
      [-15, 2],
      [-13, -2],
    ],
    soldierCenter: [-23.376623376623378, 2.5974025974025974],
    steepness: 10,
  });

  assert.equal(result.status, 1);
  assert.equal(result.auxiliaryValue, 10);
  assert.equal(result.materials.length, 4);
  assert.ok(
    result.materials.every(({ coefficient, centerX }) => Number.isFinite(coefficient) && Number.isFinite(centerX)),
  );
  assert.ok(result.materials.some(({ centerX }, index) => centerX !== result.formulaPoints[index + 1]?.[0]));
  exports.resetArena(mark);
  assert.equal(exports.getArenaCursor(), exports.getArenaBase());
  assert.equal(exports.getArenaAllocatorCallCount(), 1);
  assert.equal(exports.getArenaCanaryStatus(), 1);
});

test("uses the raw quality target and rejects production ABS refinement overrides", async () => {
  const points = [
    [-23.376623376623378, 2.5974025974025974],
    [-19, 0],
    [-17, -1.2],
    [-15, 2],
    [-13, -2],
  ];
  const exports = await instantiateKernel();
  const mark = exports.markArena();
  const strict = runLaunch(exports, {
    equation: 3,
    points,
    qualityTarget: 0.25,
    soldierCenter: points[0],
    steepness: 10,
  });
  exports.resetArena(mark);
  const relaxedMark = exports.markArena();
  const relaxed = runLaunch(exports, {
    equation: 3,
    points,
    qualityTarget: 8,
    soldierCenter: points[0],
    steepness: 10,
  });
  assert.notDeepEqual(relaxed.materials, strict.materials);
  exports.resetArena(relaxedMark);

  for (const overrideOffset of [28, 32, 120, 124, 128, 132, 136, 140, 144]) {
    const overrideMark = exports.markArena();
    assert.throws(
      () =>
        runLaunch(exports, {
          equation: 3,
          overrideOffset,
          points,
          soldierCenter: points[0],
          steepness: 10,
        }),
      WebAssembly.RuntimeError,
    );
    exports.resetArena(overrideMark);
  }
  assert.equal(exports.getArenaCursor(), exports.getArenaBase());
  assert.equal(exports.getArenaAllocatorCallCount(), 1);
  assert.equal(exports.getArenaCanaryStatus(), 1);
});

async function instantiateKernel() {
  const instance = await WebAssembly.instantiate(await kernelModule);
  const exports = instance.exports;
  exports.initializeArena(1_048_576);
  const mark = exports.markArena();
  const pointer = writeFloat64Values(exports, gameConstants);
  exports.initializeGraphwarGameConstants(pointer, gameConstants.length);
  exports.resetArena(mark);
  return exports;
}

function runLaunch(exports, { equation, overrideOffset, points, qualityTarget = 1, soldierCenter, steepness = 210 }) {
  const pointXPointer = writeFloat64Values(
    exports,
    points.map(([x]) => x),
  );
  const pointYPointer = writeFloat64Values(
    exports,
    points.map(([, y]) => y),
  );
  const overridePointer =
    overrideOffset === undefined ? 0 : writeFloat64Values(exports, new Float64Array(points.length));
  const inputPointer = exports.reserveArena(inputByteLength, 8);
  new Uint8Array(exports.memory.buffer, inputPointer, inputByteLength).fill(0);
  const view = new DataView(exports.memory.buffer);
  view.setInt32(inputPointer, 1, true);
  view.setInt32(inputPointer + 4, equation, true);
  view.setInt32(inputPointer + 8, 4, true);
  view.setUint32(inputPointer + 16, points.length, true);
  view.setUint32(inputPointer + 20, pointXPointer, true);
  view.setUint32(inputPointer + 24, pointYPointer, true);
  view.setFloat64(inputPointer + 56, steepness, true);
  view.setFloat64(inputPointer + 64, -25, true);
  view.setFloat64(inputPointer + 72, 25, true);
  view.setFloat64(inputPointer + 80, -15, true);
  view.setFloat64(inputPointer + 88, 15, true);
  view.setFloat64(inputPointer + 96, soldierCenter[0], true);
  view.setFloat64(inputPointer + 104, soldierCenter[1], true);
  view.setFloat64(inputPointer + 152, steepness, true);
  view.setFloat64(inputPointer + 168, qualityTarget, true);
  if (overrideOffset !== undefined) {
    view.setUint32(inputPointer + overrideOffset, overridePointer, true);
  }

  const resultPointer = exports.runFormula(4, inputPointer, inputByteLength);
  const status = view.getInt32(resultPointer, true);
  const protectionPointer = view.getUint32(resultPointer + 60, true);
  const protectionCount = view.getUint32(resultPointer + 64, true);
  const formulaPointCount = view.getUint32(resultPointer + 68, true);
  const formulaPointXPointer = view.getUint32(resultPointer + 72, true);
  const formulaPointYPointer = view.getUint32(resultPointer + 76, true);
  const formulaPoints = [];
  for (let index = 0; index < formulaPointCount; index += 1) {
    formulaPoints.push([
      view.getFloat64(formulaPointXPointer + index * 8, true),
      view.getFloat64(formulaPointYPointer + index * 8, true),
    ]);
  }
  const materialResultPointer = view.getUint32(resultPointer + 48, true);
  const materialPointer = view.getUint32(materialResultPointer + 4, true);
  const materialCount = view.getUint32(materialResultPointer + 8, true);
  const materialStride = view.getUint32(materialResultPointer + 12, true);
  const materials = [];
  for (let index = 0; index < materialCount; index += 1) {
    const pointer = materialPointer + index * materialStride;
    materials.push(
      equation === 3
        ? { centerX: view.getFloat64(pointer + 8, true), coefficient: view.getFloat64(pointer, true) }
        : { coefficient: view.getFloat64(pointer, true) },
    );
  }
  return {
    auxiliaryValue: view.getFloat64(materialResultPointer + 24, true),
    formulaPoints,
    materials,
    protection: Array.from({ length: protectionCount }, (_, index) =>
      view.getUint32(protectionPointer + index * 4, true),
    ),
    status,
  };
}

function writeFloat64Values(exports, values) {
  const pointer = exports.reserveArena(values.length * 8, 8);
  new Float64Array(exports.memory.buffer, pointer, values.length).set(values);
  return pointer;
}
