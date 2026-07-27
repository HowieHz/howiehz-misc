import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { GraphwarWasmFault } from "../algorithm-backend";
import {
  compileGraphwarWasmModule,
  graphwarWasmRequiredFunctionExports,
  GraphwarWasmKernelRuntime,
  instantiateGraphwarWasmRuntime,
  validateGraphwarWasmModule,
} from "./runtime";

const kernelPath = resolve("packages/graphwar-killer-wasm/build/graphwar-kernel.wasm");

async function readKernelBytes() {
  return readFile(kernelPath);
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
) {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const arenaBase = 1024;
  let arenaCursor = arenaBase;
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
    reserveArena: (byteLength: number, alignment: number) => {
      const pointer = reservePointer(arenaCursor, byteLength, alignment);
      arenaCursor = pointer + byteLength;
      return pointer;
    },
  });
  return {
    instance: { exports: { ...exports, memory } } as unknown as WebAssembly.Instance,
  };
}
