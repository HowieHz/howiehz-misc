import { GraphwarValidatedWasmRuntime, GraphwarWasmFault } from "../algorithm-backend";

/** 当前单版本 Adapter 要求的 Graphwar kernel exports。 */
export const graphwarWasmRequiredFunctionExports = [
  "beginDetectionTask",
  "resumeDetectionTask",
  "runFormula",
  "runTrajectory",
  "runRouteTask",
  "runSmartPathfinding",
  "beginOneClickClear",
  "resumeOneClickClear",
  "initializeArena",
  "reserveArena",
  "markArena",
  "resetArena",
  "getArenaBase",
  "getArenaCursor",
  "getArenaPeak",
  "getArenaCapacity",
  "getArenaAllocatorCallCount",
  "getArenaCanaryStatus",
] as const;

type GraphwarWasmRequiredFunctionExport = (typeof graphwarWasmRequiredFunctionExports)[number];
const graphwarWasmRuntimeConstructionToken = Symbol("GraphwarWasmRuntimeConstructionToken");

interface GraphwarWasmArenaExports {
  getArenaAllocatorCallCount: () => number;
  getArenaBase: () => number;
  getArenaCanaryStatus: () => number;
  getArenaCapacity: () => number;
  getArenaCursor: () => number;
  getArenaPeak: () => number;
  initializeArena: (initialCapacity: number) => number;
  markArena: () => number;
  reserveArena: (byteLength: number, alignment: number) => number;
  resetArena: (markToken: number) => void;
}

/** Fetch/compile 注入点让 loader failure 可稳定测试，同时不增加第二条生产路径。 */
export interface GraphwarWasmCompileDependencies {
  compile?: (bytes: BufferSource) => Promise<WebAssembly.Module>;
  fetch?: (url: string, init: RequestInit) => Promise<Pick<Response, "arrayBuffer" | "ok" | "status">>;
}

/** 仅用于 Worker 实例化的注入点。 */
export interface GraphwarWasmInstantiationDependencies {
  initialArenaCapacity?: number;
  instantiate?: (module: WebAssembly.Module) => Promise<WebAssembly.Instance>;
}

/**
 * 已验证的 Worker 本地 Graphwar kernel runtime。
 *
 * Raw instance exports 保持私有。ABI Adapter 只接收 memory 与受检 arena 操作；后续算法 wrapper 应在此处增加 command 专用签名，而不是泄漏无类型的 exports map。
 */
export class GraphwarWasmKernelRuntime extends GraphwarValidatedWasmRuntime {
  readonly arenaBase: number;
  readonly memory: WebAssembly.Memory;
  readonly #arena: GraphwarWasmArenaExports;

  private constructor(memory: WebAssembly.Memory, arena: GraphwarWasmArenaExports, arenaBase: number) {
    super();
    this.arenaBase = arenaBase;
    this.memory = memory;
    this.#arena = arena;
  }

  /** 模块私有构造 gate；任意调用方不能把未经验证的 instance 伪装成合法 runtime。 */
  static createValidated(
    token: symbol,
    memory: WebAssembly.Memory,
    arena: GraphwarWasmArenaExports,
    arenaBase: number,
  ) {
    if (token !== graphwarWasmRuntimeConstructionToken) {
      throw new GraphwarWasmFault("abi", "Graphwar WASM runtime construction bypassed validation");
    }
    return new GraphwarWasmKernelRuntime(memory, arena, arenaBase);
  }

  /** 当前 raw memory buffer；getter 会在每个可能的 `memory.grow` 后重新读取。 */
  get buffer() {
    return this.memory.buffer;
  }

  /** 当前已分配 arena 的排他上界；每次读取都跨过 raw export 验证，避免 reset/grow 后保留旧值。 */
  get arenaCursor() {
    let cursor: number;
    try {
      cursor = this.#arena.getArenaCursor();
    } catch (error) {
      throw normalizeGraphwarWasmRuntimeError(error, "Graphwar WASM arena cursor could not be read", "trap");
    }
    if (!isPositiveU32(cursor) || cursor < this.arenaBase || cursor > this.buffer.byteLength) {
      throw new GraphwarWasmFault("output", "Graphwar WASM arena returned an invalid cursor");
    }
    return cursor;
  }

  /** 预留 raw arena 字节；memory 可能增长，因此调用方随后必须重新读取 `memory.buffer`。 */
  reserveArena(byteLength: number, alignment: number) {
    if (!isPositiveU32(byteLength)) {
      throw new GraphwarWasmFault("input", "Graphwar WASM arena reservation length must be a positive uint32");
    }
    if (!isPositiveU32(alignment) || !Number.isInteger(Math.log2(alignment))) {
      throw new GraphwarWasmFault("input", "Graphwar WASM arena reservation alignment must be a power-of-two uint32");
    }
    const previousCursor = this.arenaCursor;
    const expectedPointer = Math.ceil(previousCursor / alignment) * alignment;
    try {
      const pointer = this.#arena.reserveArena(byteLength, alignment);
      const currentCursor = this.arenaCursor;
      if (!isPositiveU32(pointer) || pointer !== expectedPointer || pointer + byteLength !== currentCursor) {
        throw new GraphwarWasmFault("output", "Graphwar WASM arena returned an invalid allocation range");
      }
      return pointer;
    } catch (error) {
      throw normalizeGraphwarWasmRuntimeError(error, "Graphwar WASM arena reservation failed", "allocation");
    }
  }

  /** 开始一个 LIFO scratch scope。 */
  markArena() {
    try {
      const token = this.#arena.markArena();
      if (!isPositiveU32(token)) {
        throw new GraphwarWasmFault("output", "Graphwar WASM arena returned an invalid mark token");
      }
      return token;
    } catch (error) {
      throw normalizeGraphwarWasmRuntimeError(error, "Graphwar WASM arena mark failed", "allocation");
    }
  }

  /** 释放精确匹配的当前 LIFO scratch scope。 */
  resetArena(markToken: number) {
    try {
      this.#arena.resetArena(markToken);
    } catch (error) {
      throw normalizeGraphwarWasmRuntimeError(error, "Graphwar WASM arena reset failed", "allocation");
    }
  }
}

/** 加载并验证唯一 Graphwar kernel module，不在主线程实例化。 */
export async function compileGraphwarWasmModule(
  url: string,
  signal: AbortSignal,
  dependencies: GraphwarWasmCompileDependencies = {},
) {
  if (typeof WebAssembly === "undefined") {
    throw new GraphwarWasmFault("unavailable", "WebAssembly is unavailable");
  }

  const fetchWasm = dependencies.fetch ?? globalThis.fetch;
  if (typeof fetchWasm !== "function") {
    throw new GraphwarWasmFault("unavailable", "Fetch is unavailable for the Graphwar WASM kernel");
  }

  let response: Pick<Response, "arrayBuffer" | "ok" | "status">;
  try {
    response = await fetchWasm(url, { signal });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    throw new GraphwarWasmFault("load", normalizeErrorMessage(error, "Graphwar WASM request failed"));
  }
  if (!response.ok) {
    throw new GraphwarWasmFault("load", `Graphwar WASM request failed with status ${response.status}`);
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    throw new GraphwarWasmFault("load", normalizeErrorMessage(error, "Graphwar WASM response could not be read"));
  }

  let module: WebAssembly.Module;
  try {
    module = await (dependencies.compile ?? WebAssembly.compile)(bytes);
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    throw new GraphwarWasmFault("compile", normalizeErrorMessage(error, "Graphwar WASM compilation failed"));
  }
  validateGraphwarWasmModule(module);
  return module;
}

/** 实例化并初始化一个独立的 Worker 本地 raw-memory runtime。 */
export async function instantiateGraphwarWasmRuntime(
  module: WebAssembly.Module,
  dependencies: GraphwarWasmInstantiationDependencies = {},
) {
  validateGraphwarWasmModule(module);

  let instance: WebAssembly.Instance;
  try {
    instance = await (dependencies.instantiate ?? WebAssembly.instantiate)(module);
  } catch (error) {
    throw new GraphwarWasmFault("instantiate", normalizeErrorMessage(error, "Graphwar WASM instantiation failed"));
  }

  const exports = instance.exports;
  const memory = exports.memory;
  if (!(memory instanceof WebAssembly.Memory) || !(memory.buffer instanceof ArrayBuffer)) {
    throw new GraphwarWasmFault("abi", "Graphwar WASM memory export is missing or shared");
  }
  if (memory.buffer.byteLength === 0 || memory.buffer.byteLength % 65_536 !== 0) {
    throw new GraphwarWasmFault("abi", "Graphwar WASM memory has an invalid byte length");
  }

  for (const name of graphwarWasmRequiredFunctionExports) {
    if (typeof exports[name] !== "function") {
      throw new GraphwarWasmFault("abi", `Graphwar WASM function export is missing: ${name}`);
    }
  }

  // 上方已检查每个字段；断言只补充 WebAssembly reflection 无法表达的 arena 精确签名。
  // 初始化结果及后续所有 result layout 仍在 runtime 验证。
  const arena = exports as unknown as GraphwarWasmArenaExports;
  const initialArenaCapacity = dependencies.initialArenaCapacity ?? 65_536;
  if (!Number.isSafeInteger(initialArenaCapacity) || initialArenaCapacity <= 0 || initialArenaCapacity > 0xffff_ffff) {
    throw new GraphwarWasmFault("input", "Graphwar WASM initial arena capacity is invalid");
  }

  let base: number;
  try {
    base = arena.initializeArena(initialArenaCapacity);
  } catch (error) {
    throw normalizeGraphwarWasmRuntimeError(error, "Graphwar WASM arena initialization failed", "allocation");
  }
  const buffer = memory.buffer;
  let capacity: number;
  let arenaState: {
    allocatorCallCount: number;
    base: number;
    canaryStatus: number;
    cursor: number;
    peak: number;
  };
  try {
    capacity = arena.getArenaCapacity();
    arenaState = {
      allocatorCallCount: arena.getArenaAllocatorCallCount(),
      base: arena.getArenaBase(),
      canaryStatus: arena.getArenaCanaryStatus(),
      cursor: arena.getArenaCursor(),
      peak: arena.getArenaPeak(),
    };
  } catch (error) {
    throw normalizeGraphwarWasmRuntimeError(error, "Graphwar WASM arena state could not be read", "trap");
  }
  if (
    !isPositiveU32(base) ||
    arenaState.base !== base ||
    arenaState.cursor !== base ||
    arenaState.peak !== 0 ||
    !isPositiveU32(capacity) ||
    base + capacity !== buffer.byteLength ||
    arenaState.allocatorCallCount !== 1 ||
    arenaState.canaryStatus !== 1
  ) {
    throw new GraphwarWasmFault("abi", "Graphwar WASM arena initialization returned an inconsistent state");
  }

  return GraphwarWasmKernelRuntime.createValidated(graphwarWasmRuntimeConstructionToken, memory, arena, base);
}

/** 严格验证当前唯一 module 结构；此处刻意不做 ABI 版本协商。 */
export function validateGraphwarWasmModule(module: WebAssembly.Module) {
  let imports: WebAssembly.ModuleImportDescriptor[];
  let exports: WebAssembly.ModuleExportDescriptor[];
  try {
    imports = WebAssembly.Module.imports(module);
    exports = WebAssembly.Module.exports(module);
  } catch {
    throw new GraphwarWasmFault("abi", "Graphwar WASM module is invalid");
  }
  if (imports.length !== 0) {
    throw new GraphwarWasmFault("abi", "Graphwar WASM module must not import host functions or memory");
  }

  const exportKinds = new Map(exports.map((item) => [item.name, item.kind]));
  if (exportKinds.get("memory") !== "memory") {
    throw new GraphwarWasmFault("abi", "Graphwar WASM memory export is missing");
  }
  for (const name of graphwarWasmRequiredFunctionExports) {
    if (exportKinds.get(name) !== "function") {
      throw new GraphwarWasmFault("abi", `Graphwar WASM function export is missing: ${name}`);
    }
  }
}

/** Runtime trap 与普通 Adapter validation failure 保持可区分。 */
function normalizeGraphwarWasmRuntimeError(
  error: unknown,
  fallbackMessage: string,
  fallbackCode: "allocation" | "trap",
) {
  return error instanceof GraphwarWasmFault
    ? error
    : new GraphwarWasmFault(
        error instanceof WebAssembly.RuntimeError ? "trap" : fallbackCode,
        normalizeErrorMessage(error, fallbackMessage),
      );
}

/** 保留有用的边界错误文本，同时不接受空消息。 */
function normalizeErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  const message = error === undefined ? "" : String(error).trim();
  return message || fallbackMessage;
}

/** Arena pointer 与 capacity 使用非零 u32。 */
function isPositiveU32(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 0xffff_ffff;
}

/** 编译期 guard，保留测试和后续 wrapper 使用的 export name 联合。 */
export type GraphwarWasmKernelFunctionName = GraphwarWasmRequiredFunctionExport;
