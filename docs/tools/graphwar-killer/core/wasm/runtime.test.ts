import { describe, expect, it, vi } from "vitest";

import { GraphwarWasmFault } from "../algorithm-backend";
import { createGraphwarGameConstantData } from "../game/constants";
import { graphwarWasmCompositionLayout } from "./composition-adapter";
import { readGraphwarKernelBytes } from "./kernel-test-fixture";
import {
  compileGraphwarWasmModule,
  graphwarWasmRequiredFunctionExports,
  GraphwarWasmKernelRuntime,
  instantiateGraphwarWasmRuntime,
  validateGraphwarWasmModule,
} from "./runtime";

async function readKernelBytes() {
  return readGraphwarKernelBytes();
}

async function compileKernel() {
  return WebAssembly.compile(await readKernelBytes());
}

describe("Graphwar WASM runtime boundary", () => {
  it("fetches and compiles once without instantiating on the main-thread path", async () => {
    const bytes = await readKernelBytes();
    const module = await compileKernel();
    const compile = vi.fn(async () => module);
    const fetch = vi.fn(async () => ({
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      ok: true,
      status: 200,
    }));

    await expect(
      compileGraphwarWasmModule("/kernel.wasm", new AbortController().signal, { compile, fetch }),
    ).resolves.toBe(module);
    expect(fetch).toHaveBeenCalledOnce();
    expect(compile).toHaveBeenCalledOnce();
  });

  it("keeps an active abort separate from the WASM fuse", async () => {
    const controller = new AbortController();
    const abortError = new Error("cancelled by user");
    const fetch = vi.fn(async () => {
      controller.abort();
      throw abortError;
    });

    await expect(compileGraphwarWasmModule("/kernel.wasm", controller.signal, { fetch })).rejects.toBe(abortError);
  });

  it.each([
    {
      code: "load",
      dependencies: { fetch: async () => ({ arrayBuffer: async () => new ArrayBuffer(0), ok: false, status: 503 }) },
    },
    {
      code: "load",
      dependencies: {
        fetch: async () => ({
          arrayBuffer: async () => Promise.reject(new Error("read failed")),
          ok: true,
          status: 200,
        }),
      },
    },
    {
      code: "compile",
      dependencies: {
        compile: async () => Promise.reject(new Error("compile failed")),
        fetch: async () => ({ arrayBuffer: async () => new ArrayBuffer(8), ok: true, status: 200 }),
      },
    },
  ] as const)("classifies loader failure as $code", async ({ code, dependencies }) => {
    await expect(
      compileGraphwarWasmModule("/kernel.wasm", new AbortController().signal, dependencies),
    ).rejects.toMatchObject({ code });
  });

  it("rejects modules with imports or incomplete exports", async () => {
    const emptyModule = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
    expect(() => validateGraphwarWasmModule(emptyModule)).toThrow(GraphwarWasmFault);
    expect(() => validateGraphwarWasmModule({} as WebAssembly.Module)).toThrow(GraphwarWasmFault);
  });

  it("validates and initializes the real kernel exactly once", async () => {
    const module = await compileKernel();
    expect(WebAssembly.Module.exports(module).map(({ name }) => name)).toEqual(
      expect.arrayContaining(["memory", ...graphwarWasmRequiredFunctionExports]),
    );

    const runtime = await instantiateGraphwarWasmRuntime(module, { initialArenaCapacity: 128 });
    expect(runtime).toBeInstanceOf(GraphwarWasmKernelRuntime);
    const pointer = runtime.reserveArena(8, 8);
    expect(pointer % 8).toBe(0);
    const mark = runtime.markArena();
    runtime.reserveArena(16, 16);
    runtime.resetArena(mark);
    expect(runtime.runFormula(0, 0, 0)).toBe(0);
  });

  it("validates formula command fields and result ownership", async () => {
    const runtime = await instantiateGraphwarWasmRuntime(await compileKernel(), {
      instantiate: async () => createSyntheticArenaInstance((previousCursor) => previousCursor).instance,
    });

    expect(() => runtime.runFormula(-1, 0, 0)).toThrowError(GraphwarWasmFault);
    expect(() => runtime.runFormula(1, 0, 0)).toThrowError(GraphwarWasmFault);
  });

  it("rejects malformed smart input before crossing the WASM boundary", async () => {
    const arena = createSyntheticArenaInstance(
      (previousCursor, _byteLength, alignment) => Math.ceil(previousCursor / alignment) * alignment,
    );
    const rawExports = arena.instance.exports as unknown as Record<string, (...args: number[]) => number>;
    const runSmartPathfinding = vi.fn(() => 0);
    rawExports.runSmartPathfinding = runSmartPathfinding;
    const runtime = await instantiateGraphwarWasmRuntime(await compileKernel(), {
      instantiate: async () => arena.instance,
    });
    const inputPointer = runtime.reserveArena(graphwarWasmCompositionLayout.smartInputByteLength, 4);

    expect(() => runtime.runSmartPathfinding(inputPointer, 55)).toThrowError(GraphwarWasmFault);
    expect(() =>
      runtime.runSmartPathfinding(inputPointer + 2, graphwarWasmCompositionLayout.smartInputByteLength),
    ).toThrowError(GraphwarWasmFault);
    expect(() =>
      runtime.runSmartPathfinding(runtime.arenaCursor, graphwarWasmCompositionLayout.smartInputByteLength),
    ).toThrowError(GraphwarWasmFault);
    expect(runSmartPathfinding).not.toHaveBeenCalled();
  });

  it("requires an atomic one-click work batch and accepts aligned flat records", async () => {
    const arena = createSyntheticArenaInstance(
      (previousCursor, _byteLength, alignment) => Math.ceil(previousCursor / alignment) * alignment,
    );
    const rawExports = arena.instance.exports as unknown as Record<string, (...args: number[]) => number>;
    const reserveResult = (byteLength: number) => rawExports.reserveArena(byteLength, 8);
    rawExports.runSmartPathfinding = () => reserveResult(graphwarWasmCompositionLayout.smartResultByteLength);
    rawExports.beginOneClickClear = () => reserveResult(56);
    rawExports.resumeOneClickClear = () => reserveResult(56);
    const runtime = await instantiateGraphwarWasmRuntime(await compileKernel(), {
      instantiate: async () => arena.instance,
    });

    const inputPointer = runtime.reserveArena(graphwarWasmCompositionLayout.smartInputByteLength, 4);
    expect(runtime.runSmartPathfinding(inputPointer, graphwarWasmCompositionLayout.smartInputByteLength) % 8).toBe(0);
    expect(runtime.beginOneClickClear(inputPointer, 64) % 8).toBe(0);

    const resumePointer = runtime.reserveArena(16, 4);
    expect(runtime.resumeOneClickClear(resumePointer, 16) % 8).toBe(0);
    expect(() => runtime.resumeOneClickClear(resumePointer, 15)).toThrowError(GraphwarWasmFault);
    expect(() => runtime.resumeOneClickClear(resumePointer + 2, 16)).toThrowError(GraphwarWasmFault);
  });

  it("rejects a result pointer whose fixed record would extend past the arena cursor", async () => {
    const arena = createSyntheticArenaInstance((previousCursor) => previousCursor);
    const rawExports = arena.instance.exports as unknown as Record<string, (...args: number[]) => number>;
    rawExports.runSmartPathfinding = () => rawExports.getArenaCursor() - 4;
    const runtime = await instantiateGraphwarWasmRuntime(await compileKernel(), {
      instantiate: async () => arena.instance,
    });
    const inputPointer = runtime.reserveArena(graphwarWasmCompositionLayout.smartInputByteLength, 4);

    expect(() =>
      runtime.runSmartPathfinding(inputPointer, graphwarWasmCompositionLayout.smartInputByteLength),
    ).toThrowError(GraphwarWasmFault);
  });

  it("uploads the canonical game constants once and releases the initialization scratch", async () => {
    let uploadedConstants: number[] = [];
    const arena = createSyntheticArenaInstance(
      (previousCursor) => previousCursor,
      (memory, pointer, count) => {
        uploadedConstants = Array.from(new Float64Array(memory.buffer, pointer, count));
        return calculateGameConstantAcknowledgment(new Uint8Array(memory.buffer, pointer, count * 8));
      },
    );
    const runtime = await instantiateGraphwarWasmRuntime(await compileKernel(), {
      instantiate: async () => arena.instance,
    });

    expect(uploadedConstants).toEqual(Array.from(createGraphwarGameConstantData()));
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects a no-op kernel that returns a fixed success value without snapshotting the constants", async () => {
    const arena = createSyntheticArenaInstance(
      (previousCursor) => previousCursor,
      () => 1,
    );
    await expect(
      instantiateGraphwarWasmRuntime(await compileKernel(), { instantiate: async () => arena.instance }),
    ).rejects.toMatchObject({ code: "abi" });
  });

  it("does not expose an unchecked runtime construction path", async () => {
    const instance = await WebAssembly.instantiate(await compileKernel());
    expect(() =>
      GraphwarWasmKernelRuntime.createValidated(
        Symbol("forged"),
        instance.exports.memory as WebAssembly.Memory,
        {} as never,
        1,
      ),
    ).toThrow(GraphwarWasmFault);
  });

  it.each([
    { label: "before the arena base", pointer: 512 },
    { label: "after the current cursor", pointer: 2048 },
  ])("rejects an allocation returned $label", async ({ pointer }) => {
    const arena = createSyntheticArenaInstance(() => pointer);
    const runtime = await instantiateGraphwarWasmRuntime(await compileKernel(), {
      instantiate: async () => arena.instance,
    });

    expect(() => runtime.reserveArena(8, 8)).toThrowError(GraphwarWasmFault);
  });

  it("rejects an allocator that overlaps a previous allocation", async () => {
    let callCount = 0;
    const arena = createSyntheticArenaInstance((previousCursor, byteLength) => {
      callCount += 1;
      return callCount === 1 ? previousCursor : previousCursor - byteLength;
    });
    const runtime = await instantiateGraphwarWasmRuntime(await compileKernel(), {
      instantiate: async () => arena.instance,
    });

    expect(runtime.reserveArena(8, 8)).toBe(1024);
    expect(() => runtime.reserveArena(8, 8)).toThrowError(GraphwarWasmFault);
  });

  it.each([0, -1, 1.5, 0x1_0000_0000])("rejects invalid initial arena capacity %s", async (capacity) => {
    await expect(
      instantiateGraphwarWasmRuntime(await compileKernel(), { initialArenaCapacity: capacity }),
    ).rejects.toMatchObject({
      code: "input",
    });
  });

  it("separates instantiate and arena traps", async () => {
    const module = await compileKernel();
    await expect(
      instantiateGraphwarWasmRuntime(module, { instantiate: async () => Promise.reject(new Error("no instance")) }),
    ).rejects.toMatchObject({ code: "instantiate" });
    await expect(instantiateGraphwarWasmRuntime(module, { initialArenaCapacity: 0xffff_ffff })).rejects.toMatchObject({
      code: "trap",
    });
  });
});

/** 构造一个通过初始化校验、但可注入错误 reserve pointer 的 synthetic instance。 */
function createSyntheticArenaInstance(
  reservePointer: (previousCursor: number, byteLength: number, alignment: number) => number,
  initializeGameConstants: (memory: WebAssembly.Memory, pointer: number, count: number) => number = (
    memory,
    pointer,
    count,
  ) => calculateGameConstantAcknowledgment(new Uint8Array(memory.buffer, pointer, count * 8)),
) {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const arenaBase = 1024;
  let arenaCursor = arenaBase;
  let nextMarkToken = 1;
  let isGameConstantDataInitialized = false;
  const markFrames: { cursor: number; token: number }[] = [];
  const exports = Object.fromEntries(graphwarWasmRequiredFunctionExports.map((name) => [name, () => 0])) as Record<
    string,
    (...args: number[]) => number
  >;
  Object.assign(exports, {
    getArenaAllocatorCallCount: () => 1,
    getArenaBase: () => arenaBase,
    getArenaCanaryStatus: () => 1,
    getArenaCapacity: () => memory.buffer.byteLength - arenaBase,
    getArenaCursor: () => arenaCursor,
    getArenaPeak: () => 0,
    initializeArena: () => arenaBase,
    initializeGraphwarGameConstants: (pointer: number, count: number) => {
      const expectedAcknowledgment = calculateGameConstantAcknowledgment(
        new Uint8Array(memory.buffer, pointer, count * 8),
      );
      const acknowledgment = initializeGameConstants(memory, pointer, count);
      isGameConstantDataInitialized = acknowledgment === expectedAcknowledgment;
      return acknowledgment;
    },
    markArena: () => {
      const token = nextMarkToken;
      nextMarkToken += 1;
      markFrames.push({ cursor: arenaCursor, token });
      return token;
    },
    reserveArena: (byteLength: number, alignment: number) => {
      const pointer = isGameConstantDataInitialized
        ? reservePointer(arenaCursor, byteLength, alignment)
        : Math.ceil(arenaCursor / alignment) * alignment;
      arenaCursor = pointer + byteLength;
      return pointer;
    },
    resetArena: (token: number) => {
      const frame = markFrames.pop();
      if (frame === undefined || frame.token !== token) {
        throw new Error("invalid synthetic arena mark");
      }
      arenaCursor = frame.cursor;
    },
  });
  return {
    instance: { exports: { ...exports, memory } } as unknown as WebAssembly.Instance,
  };
}

/** Matches the raw kernel handshake while keeping synthetic runtime tests independent of production internals. */
function calculateGameConstantAcknowledgment(bytes: Uint8Array) {
  let hash = 0x811c9dc5;
  for (const value of bytes) {
    hash = Math.imul(hash ^ value, 0x01000193) >>> 0;
  }
  return hash | 0;
}
