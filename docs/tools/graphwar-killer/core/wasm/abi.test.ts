import { describe, expect, it } from "vitest";

import {
  copyGraphwarWasmBytes,
  copyGraphwarWasmFloat64Values,
  copyGraphwarWasmUint32Values,
  GraphwarWasmAdapterError,
  validateGraphwarWasmEnumValue,
  validateGraphwarWasmFiniteNumber,
  validateGraphwarWasmMemoryRange,
  validateGraphwarWasmPathError,
  validateGraphwarWasmProtectionBits,
  validateGraphwarWasmU32,
  writeGraphwarWasmBytes,
  writeGraphwarWasmFloat64Values,
  writeGraphwarWasmUint32Values,
  type GraphwarWasmAdapterErrorCode,
} from "./abi";

describe("Graphwar WASM memory ABI", () => {
  it("accepts u32 endpoints and rejects fractional, negative, and overflowing values", () => {
    expect(validateGraphwarWasmU32(0, "value")).toBe(0);
    expect(validateGraphwarWasmU32(0xffff_ffff, "value")).toBe(0xffff_ffff);
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 0x1_0000_0000, "1"]) {
      expectAdapterError(() => validateGraphwarWasmU32(value, "value"), "invalid-u32");
    }
  });

  it("validates canonical empty and aligned in-arena ranges", () => {
    const memory = { arenaBase: 16, arenaCursor: 96, buffer: new ArrayBuffer(128) };
    expect(
      validateGraphwarWasmMemoryRange(memory, { length: 0, pointer: 0 }, { alignment: 8, elementByteLength: 8 }),
    ).toMatchObject({ byteLength: 0, byteOffset: 0, elementLength: 0 });
    expect(
      validateGraphwarWasmMemoryRange(memory, { length: 4, pointer: 32 }, { alignment: 8, elementByteLength: 8 }),
    ).toMatchObject({ byteLength: 32, byteOffset: 32, elementLength: 4 });

    expectAdapterError(
      () => validateGraphwarWasmMemoryRange(memory, { length: 0, pointer: 16 }, { alignment: 1, elementByteLength: 1 }),
      "range-out-of-bounds",
    );
    expectAdapterError(
      () => validateGraphwarWasmMemoryRange(memory, { length: 1, pointer: 8 }, { alignment: 8, elementByteLength: 8 }),
      "range-out-of-bounds",
    );
    expectAdapterError(
      () => validateGraphwarWasmMemoryRange(memory, { length: 1, pointer: 18 }, { alignment: 8, elementByteLength: 8 }),
      "invalid-alignment",
    );
    expectAdapterError(
      () => validateGraphwarWasmMemoryRange(memory, { length: 1, pointer: 16 }, { alignment: 3, elementByteLength: 8 }),
      "invalid-alignment",
    );
    expectAdapterError(
      () => validateGraphwarWasmMemoryRange(memory, { length: 1, pointer: 96 }, { alignment: 8, elementByteLength: 8 }),
      "range-out-of-bounds",
    );
  });

  it("rejects byte-count overflow, address wrap, and current-buffer overrun independently", () => {
    const memory = { arenaBase: 8, arenaCursor: 128, buffer: new ArrayBuffer(128) };
    expectAdapterError(
      () =>
        validateGraphwarWasmMemoryRange(
          memory,
          { length: 0xffff_ffff, pointer: 8 },
          { alignment: 8, elementByteLength: 8 },
        ),
      "range-overflow",
    );
    expectAdapterError(
      () =>
        validateGraphwarWasmMemoryRange(
          memory,
          { length: 2, pointer: 0xffff_fff8 },
          { alignment: 8, elementByteLength: 8 },
        ),
      "range-overflow",
    );
    expectAdapterError(
      () => validateGraphwarWasmMemoryRange(memory, { length: 8, pointer: 96 }, { alignment: 8, elementByteLength: 8 }),
      "range-out-of-bounds",
    );
  });

  it("refreshes memory.buffer after grow and returns owned typed-array copies", () => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const source = createMemorySource(memory);
    const oldBuffer = memory.buffer;
    new Uint8Array(oldBuffer).set([1, 2, 3, 4], 16);
    const firstCopy = copyGraphwarWasmBytes(source, { length: 4, pointer: 16 }, 8);

    memory.grow(1);
    expect(oldBuffer.byteLength).toBe(0);
    new Uint8Array(memory.buffer).set([5, 6, 7, 8], 16);
    const secondCopy = copyGraphwarWasmBytes(source, { length: 4, pointer: 16 }, 8);
    new Uint8Array(memory.buffer)[16] = 99;

    expect(firstCopy).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(secondCopy).toEqual(new Uint8Array([5, 6, 7, 8]));
  });

  it("copies aligned f64 and u32 arrays without exposing mutable WASM views", () => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const source = createMemorySource(memory);
    new Float64Array(memory.buffer, 16, 2).set([Math.PI, -4]);
    new Uint32Array(memory.buffer, 32, 2).set([7, 0xffff_ffff]);

    const floats = copyGraphwarWasmFloat64Values(source, { length: 2, pointer: 16 }, 8);
    const integers = copyGraphwarWasmUint32Values(source, { length: 2, pointer: 32 }, 8);
    new Float64Array(memory.buffer, 16, 2).fill(0);
    new Uint32Array(memory.buffer, 32, 2).fill(0);

    expect(floats).toEqual(new Float64Array([Math.PI, -4]));
    expect(integers).toEqual(new Uint32Array([7, 0xffff_ffff]));
  });

  it("packs owned byte, f64, and u32 inputs after refreshing a grown buffer", () => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    let cursor = 65_520;
    const arena = {
      arenaBase: 8,
      get arenaCursor() {
        return cursor;
      },
      get buffer() {
        return memory.buffer;
      },
      reserveArena(byteLength: number, alignment: number) {
        cursor = Math.ceil(cursor / alignment) * alignment;
        if (cursor + byteLength > memory.buffer.byteLength) {
          memory.grow(1);
        }
        const pointer = cursor;
        cursor += byteLength;
        return pointer;
      },
    };
    const oldBuffer = memory.buffer;
    const bytes = writeGraphwarWasmBytes(arena, new Uint8Array([1, 2, 3]), 8);
    const floats = writeGraphwarWasmFloat64Values(arena, new Float64Array([Math.PI, -4]), 8);
    const integers = writeGraphwarWasmUint32Values(arena, new Uint32Array([7, 0xffff_ffff]), 8);

    expect(oldBuffer.byteLength).toBe(0);
    expect(copyGraphwarWasmBytes(arena, bytes, 8)).toEqual(new Uint8Array([1, 2, 3]));
    expect(copyGraphwarWasmFloat64Values(arena, floats, 8)).toEqual(new Float64Array([Math.PI, -4]));
    expect(copyGraphwarWasmUint32Values(arena, integers, 8)).toEqual(new Uint32Array([7, 0xffff_ffff]));
  });

  it("uses canonical null slices for empty pack inputs without reserving", () => {
    const arena = {
      arenaBase: 8,
      arenaCursor: 8,
      buffer: new ArrayBuffer(64),
      reserveArena: () => {
        throw new Error("empty inputs must not reserve");
      },
    };
    expect(writeGraphwarWasmBytes(arena, new Uint8Array())).toEqual({ length: 0, pointer: 0 });
    expect(writeGraphwarWasmFloat64Values(arena, new Float64Array())).toEqual({ length: 0, pointer: 0 });
    expect(writeGraphwarWasmUint32Values(arena, new Uint32Array())).toEqual({ length: 0, pointer: 0 });
  });

  it("rejects shared memory buffers", () => {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    const source = createMemorySource(memory);
    expectAdapterError(
      () => validateGraphwarWasmMemoryRange(source, { length: 1, pointer: 8 }, { alignment: 1, elementByteLength: 1 }),
      "invalid-memory-buffer",
    );
  });
});

describe("Graphwar WASM scalar ABI", () => {
  it("requires finite state values", () => {
    expect(validateGraphwarWasmFiniteNumber(-12.5, "endState.y")).toBe(-12.5);
    for (const value of [Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, undefined]) {
      expectAdapterError(() => validateGraphwarWasmFiniteNumber(value, "endState.y"), "invalid-finite-number");
    }
  });

  it("accepts only the declared path-error domain", () => {
    expect(validateGraphwarWasmPathError(undefined)).toBeUndefined();
    expect(validateGraphwarWasmPathError(0)).toBe(0);
    expect(validateGraphwarWasmPathError(12.5)).toBe(12.5);
    expect(validateGraphwarWasmPathError(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    for (const value of [-1, Number.NaN, Number.NEGATIVE_INFINITY, "1"]) {
      expectAdapterError(() => validateGraphwarWasmPathError(value), "invalid-path-error");
    }
  });

  it("validates current enum tags and protection-role bits", () => {
    expect(validateGraphwarWasmEnumValue(2, [1, 2, 4] as const, "resultType")).toBe(2);
    expectAdapterError(() => validateGraphwarWasmEnumValue(3, [1, 2, 4] as const, "resultType"), "invalid-enum");

    expect(validateGraphwarWasmProtectionBits(0b0101, 0b0111)).toBe(0b0101);
    expect(validateGraphwarWasmProtectionBits(0, 0b0111)).toBe(0);
    expectAdapterError(() => validateGraphwarWasmProtectionBits(0b1000, 0b0111), "invalid-protection-bits");
  });
});

/** 断言本地 Adapter 分类，不让测试耦合人类可读文案。 */
function expectAdapterError(task: () => unknown, code: GraphwarWasmAdapterErrorCode) {
  let error: unknown;
  try {
    task();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(GraphwarWasmAdapterError);
  expect(error).toMatchObject({ code });
}

/** 将可增长 memory 包装成每次读取最新 buffer/cursor 的测试 raw arena。 */
function createMemorySource(memory: WebAssembly.Memory) {
  return {
    arenaBase: 8,
    get arenaCursor() {
      return memory.buffer.byteLength;
    },
    get buffer() {
      return memory.buffer as ArrayBuffer;
    },
  };
}
