import { GraphwarValidatedWasmRuntime, GraphwarWasmFault } from "../algorithm-backend";
import { createGraphwarGameConstantData, GRAPHWAR_GAME_CONSTANT_COUNT } from "../game/constants";
import { writeGraphwarWasmFloat64Values } from "./abi";

/** 当前单版本 Adapter 要求的 Graphwar kernel exports。 */
export const graphwarWasmRequiredFunctionExports = [
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
] as const;

type GraphwarWasmRequiredFunctionExport = (typeof graphwarWasmRequiredFunctionExports)[number];
const graphwarWasmRuntimeConstructionToken = Symbol("GraphwarWasmRuntimeConstructionToken");
const SMART_PATHFINDING_INPUT_BYTE_LENGTH = 80;
const SMART_PATHFINDING_RESULT_BYTE_LENGTH = 96;
const ONE_CLICK_TARGET_ASSIGNMENT_INPUT_BYTE_LENGTH = 120;
const ONE_CLICK_TARGET_ASSIGNMENT_RESULT_BYTE_LENGTH = 24;
const ONE_CLICK_CLEAR_INPUT_BYTE_LENGTH = 72;
const ONE_CLICK_CLEAR_LEGACY_INPUT_BYTE_LENGTH = 64;
const ONE_CLICK_CLEAR_DAG_INPUT_BYTE_LENGTH = 96;
const ONE_CLICK_CLEAR_EVIDENCE_INPUT_BYTE_LENGTH = 120;
const ONE_CLICK_CLEAR_RESULT_BYTE_LENGTH = 56;
const ONE_CLICK_CLEAR_RESUME_INPUT_BYTE_LENGTH = 16;

interface GraphwarWasmArenaExports {
  getArenaAllocatorCallCount: () => number;
  getArenaBase: () => number;
  getArenaCanaryStatus: () => number;
  getArenaCapacity: () => number;
  getArenaCursor: () => number;
  getArenaPeak: () => number;
  initializeArena: (initialCapacity: number) => number;
  initializeGraphwarGameConstants: (pointer: number, count: number) => number;
  markArena: () => number;
  reserveArena: (byteLength: number, alignment: number) => number;
  resetArena: (markToken: number) => void;
  resetArenaAfterFault: (markToken: number) => void;
}

interface GraphwarWasmAlgorithmExports {
  beginDetectionTask: (inputPointer: number, inputByteLength: number) => number;
  resumeDetectionTask: (sessionPointer: number, workPointer: number, workCount: number) => number;
  runDetectionTemplateShard: (inputPointer: number, inputByteLength: number) => number;
  runFormula: (command: number, inputPointer: number, inputByteLength: number) => number;
  runRouteTask: (command: number, inputPointer: number, inputByteLength: number) => number;
  assignOneClickTargets: (inputPointer: number, inputByteLength: number) => number;
  runSmartPathfinding: (inputPointer: number, inputByteLength: number) => number;
  beginOneClickClear: (inputPointer: number, inputByteLength: number) => number;
  cancelOneClickClear: (requestNonce: number) => void;
  resumeOneClickClear: (inputPointer: number, inputByteLength: number) => number;
  runTrajectory: (inputPointer: number, inputByteLength: number) => number;
}

type GraphwarWasmRuntimeExports = GraphwarWasmArenaExports & GraphwarWasmAlgorithmExports;

/** Atomic diagnostic snapshot used by soak tests and later benchmark reporting. */
export interface GraphwarWasmArenaDiagnostics {
  allocatorCallCount: number;
  capacityBytes: number;
  cursor: number;
  isCanaryIntact: true;
  peakUsedBytes: number;
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
  readonly #exports: GraphwarWasmRuntimeExports;

  private constructor(memory: WebAssembly.Memory, exports: GraphwarWasmRuntimeExports, arenaBase: number) {
    super();
    this.arenaBase = arenaBase;
    this.memory = memory;
    this.#exports = exports;
  }

  /** 模块私有构造 gate；任意调用方不能把未经验证的 instance 伪装成合法 runtime。 */
  static createValidated(
    token: symbol,
    memory: WebAssembly.Memory,
    exports: GraphwarWasmRuntimeExports,
    arenaBase: number,
  ) {
    if (token !== graphwarWasmRuntimeConstructionToken) {
      throw new GraphwarWasmFault("abi", "Graphwar WASM runtime construction bypassed validation");
    }
    return new GraphwarWasmKernelRuntime(memory, exports, arenaBase);
  }

  /** 当前 raw memory buffer；getter 会在每个可能的 `memory.grow` 后重新读取。 */
  get buffer() {
    return this.memory.buffer;
  }

  /** 当前已分配 arena 的排他上界；每次读取都跨过 raw export 验证，避免 reset/grow 后保留旧值。 */
  get arenaCursor() {
    let cursor: number;
    try {
      cursor = this.#exports.getArenaCursor();
    } catch (error) {
      throw normalizeGraphwarWasmRuntimeError(error, "Graphwar WASM arena cursor could not be read", "trap");
    }
    if (!isPositiveU32(cursor) || cursor < this.arenaBase || cursor > this.buffer.byteLength) {
      throw new GraphwarWasmFault("output", "Graphwar WASM arena returned an invalid cursor");
    }
    return cursor;
  }

  /** Reads one internally consistent arena snapshot and rejects allocator/canary ownership violations. */
  getArenaDiagnostics(): GraphwarWasmArenaDiagnostics {
    let allocatorCallCount: number;
    let canaryStatus: number;
    let capacityBytes: number;
    let cursor: number;
    let peakUsedBytes: number;
    try {
      allocatorCallCount = this.#exports.getArenaAllocatorCallCount();
      canaryStatus = this.#exports.getArenaCanaryStatus();
      capacityBytes = this.#exports.getArenaCapacity();
      cursor = this.#exports.getArenaCursor();
      peakUsedBytes = this.#exports.getArenaPeak();
    } catch (error) {
      throw normalizeGraphwarWasmRuntimeError(error, "Graphwar WASM arena diagnostics could not be read", "trap");
    }
    if (
      allocatorCallCount !== 1 ||
      canaryStatus !== 1 ||
      !isPositiveU32(capacityBytes) ||
      this.arenaBase + capacityBytes !== this.buffer.byteLength ||
      !isPositiveU32(cursor) ||
      cursor < this.arenaBase ||
      cursor > this.buffer.byteLength ||
      !isU32(peakUsedBytes) ||
      peakUsedBytes > capacityBytes
    ) {
      throw new GraphwarWasmFault("output", "Graphwar WASM arena diagnostics are inconsistent");
    }
    return {
      allocatorCallCount,
      capacityBytes,
      cursor,
      isCanaryIntact: true,
      peakUsedBytes,
    };
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
      const pointer = this.#exports.reserveArena(byteLength, alignment);
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
      const token = this.#exports.markArena();
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
      this.#exports.resetArena(markToken);
    } catch (error) {
      throw normalizeGraphwarWasmRuntimeError(error, "Graphwar WASM arena reset failed", "allocation");
    }
  }

  /** Fault cleanup may unwind command-owned nested marks, but still requires a proven caller-owned ancestor. */
  resetArenaAfterFault(markToken: number) {
    try {
      this.#exports.resetArenaAfterFault(markToken);
    } catch (error) {
      throw normalizeGraphwarWasmRuntimeError(error, "Graphwar WASM faulted arena reset failed", "allocation");
    }
  }

  /** Clears the kernel's retained one-click identity before its owner rewinds the arena mark. */
  cancelOneClickClear(requestNonce: number) {
    if (!isPositiveU32(requestNonce)) {
      throw new GraphwarWasmFault("input", "Graphwar WASM one-click-clear request nonce must be a positive uint32");
    }
    try {
      this.#exports.cancelOneClickClear(requestNonce);
    } catch (error) {
      throw normalizeGraphwarWasmRuntimeError(error, "Graphwar WASM one-click-clear cancellation failed", "trap");
    }
  }

  /** Executes the synchronous detection core until it completes or reaches an external-work boundary. */
  beginDetectionTask(inputPointer: number, inputByteLength: number) {
    if (!isU32(inputPointer) || !isU32(inputByteLength)) {
      throw new GraphwarWasmFault("input", "Graphwar WASM detection fields must be uint32 values");
    }
    let resultPointer: number;
    try {
      resultPointer = this.#exports.beginDetectionTask(inputPointer, inputByteLength);
    } catch (error) {
      throw normalizeGraphwarWasmRuntimeError(error, "Graphwar WASM detection command failed", "trap");
    }
    const cursor = this.arenaCursor;
    if (
      !isPositiveU32(resultPointer) ||
      resultPointer % 8 !== 0 ||
      resultPointer < this.arenaBase ||
      resultPointer >= cursor
    ) {
      throw new GraphwarWasmFault("output", "Graphwar WASM detection returned an invalid result pointer");
    }
    return resultPointer;
  }

  /** Continues an exact retained detection session pointer after a stage or external-work boundary. */
  resumeDetectionTask(sessionPointer: number, workPointer = 0, workCount = 0) {
    if (!isU32(sessionPointer) || !isU32(workPointer) || !isU32(workCount)) {
      throw new GraphwarWasmFault("input", "Graphwar WASM detection session pointer must be a uint32 value");
    }
    let resultPointer: number;
    try {
      resultPointer = this.#exports.resumeDetectionTask(sessionPointer, workPointer, workCount);
    } catch (error) {
      throw normalizeGraphwarWasmRuntimeError(error, "Graphwar WASM detection resume failed", "trap");
    }
    const cursor = this.arenaCursor;
    if (
      !isPositiveU32(resultPointer) ||
      resultPointer % 8 !== 0 ||
      resultPointer < this.arenaBase ||
      resultPointer >= cursor
    ) {
      throw new GraphwarWasmFault("output", "Graphwar WASM detection resume returned an invalid result pointer");
    }
    return resultPointer;
  }

  /** Scores one complete template shard and validates its returned result-record pointer. */
  runDetectionTemplateShard(inputPointer: number, inputByteLength: number) {
    if (!isU32(inputPointer) || !isU32(inputByteLength)) {
      throw new GraphwarWasmFault("input", "Graphwar WASM template-shard fields must be uint32 values");
    }
    let resultPointer: number;
    try {
      resultPointer = this.#exports.runDetectionTemplateShard(inputPointer, inputByteLength);
    } catch (error) {
      throw normalizeGraphwarWasmRuntimeError(error, "Graphwar WASM template shard failed", "trap");
    }
    const cursor = this.arenaCursor;
    if (
      !isPositiveU32(resultPointer) ||
      resultPointer % 8 !== 0 ||
      resultPointer < this.arenaBase ||
      resultPointer >= cursor
    ) {
      throw new GraphwarWasmFault("output", "Graphwar WASM template shard returned an invalid result pointer");
    }
    return resultPointer;
  }

  /** 执行一个 typed formula-domain command；具体 result layout 仍由命令 Adapter 完整验证。 */
  runFormula(command: number, inputPointer: number, inputByteLength: number) {
    if (!isU32(command) || !isU32(inputPointer) || !isU32(inputByteLength)) {
      throw new GraphwarWasmFault("input", "Graphwar WASM formula command fields must be uint32 values");
    }
    let resultPointer: number;
    try {
      resultPointer = this.#exports.runFormula(command, inputPointer, inputByteLength);
    } catch (error) {
      throw normalizeGraphwarWasmRuntimeError(error, "Graphwar WASM formula command failed", "trap");
    }
    if (command === 0) {
      if (resultPointer !== 0) {
        throw new GraphwarWasmFault("output", "Graphwar WASM formula no-op returned an unexpected result");
      }
      return resultPointer;
    }
    const cursor = this.arenaCursor;
    if (
      !isPositiveU32(resultPointer) ||
      resultPointer % 8 !== 0 ||
      resultPointer < this.arenaBase ||
      resultPointer >= cursor
    ) {
      throw new GraphwarWasmFault("output", "Graphwar WASM formula command returned an invalid result pointer");
    }
    return resultPointer;
  }

  /** Executes one complete trajectory command and validates its returned arena pointer. */
  runTrajectory(inputPointer: number, inputByteLength: number) {
    if (!isU32(inputPointer) || !isU32(inputByteLength)) {
      throw new GraphwarWasmFault("input", "Graphwar WASM trajectory fields must be uint32 values");
    }
    let resultPointer: number;
    try {
      resultPointer = this.#exports.runTrajectory(inputPointer, inputByteLength);
    } catch (error) {
      throw normalizeGraphwarWasmRuntimeError(error, "Graphwar WASM trajectory command failed", "trap");
    }
    const cursor = this.arenaCursor;
    if (
      !isPositiveU32(resultPointer) ||
      resultPointer % 8 !== 0 ||
      resultPointer < this.arenaBase ||
      resultPointer >= cursor
    ) {
      throw new GraphwarWasmFault("output", "Graphwar WASM trajectory returned an invalid result pointer");
    }
    return resultPointer;
  }

  /** Executes one route-context or collision command and validates its returned arena pointer. */
  runRouteTask(command: number, inputPointer: number, inputByteLength: number) {
    if (!isU32(command) || !isU32(inputPointer) || !isU32(inputByteLength)) {
      throw new GraphwarWasmFault("input", "Graphwar WASM route command fields must be uint32 values");
    }
    let resultPointer: number;
    try {
      resultPointer = this.#exports.runRouteTask(command, inputPointer, inputByteLength);
    } catch (error) {
      throw normalizeGraphwarWasmRuntimeError(error, "Graphwar WASM route command failed", "trap");
    }
    const cursor = this.arenaCursor;
    if (
      !isPositiveU32(resultPointer) ||
      resultPointer % 4 !== 0 ||
      resultPointer < this.arenaBase ||
      resultPointer >= cursor
    ) {
      throw new GraphwarWasmFault("output", "Graphwar WASM route command returned an invalid result pointer");
    }
    return resultPointer;
  }

  /** Executes the versioned one-click target-assignment composition command. */
  assignOneClickTargets(inputPointer: number, inputByteLength: number) {
    validateFixedCommandInput(
      this,
      inputPointer,
      inputByteLength,
      ONE_CLICK_TARGET_ASSIGNMENT_INPUT_BYTE_LENGTH,
      "one-click target assignment",
    );
    let resultPointer: number;
    try {
      resultPointer = this.#exports.assignOneClickTargets(inputPointer, inputByteLength);
    } catch (error) {
      throw normalizeGraphwarWasmRuntimeError(error, "Graphwar WASM one-click target assignment failed", "trap");
    }
    validateResultRecordPointer(
      this,
      resultPointer,
      ONE_CLICK_TARGET_ASSIGNMENT_RESULT_BYTE_LENGTH,
      "one-click target assignment",
    );
    return resultPointer;
  }

  /** Executes the complete smart-pathfinding composition and validates its result record pointer. */
  runSmartPathfinding(inputPointer: number, inputByteLength: number) {
    validateFixedCommandInput(
      this,
      inputPointer,
      inputByteLength,
      SMART_PATHFINDING_INPUT_BYTE_LENGTH,
      "smart-pathfinding",
    );
    let resultPointer: number;
    try {
      resultPointer = this.#exports.runSmartPathfinding(inputPointer, inputByteLength);
    } catch (error) {
      throw normalizeGraphwarWasmRuntimeError(error, "Graphwar WASM smart-pathfinding command failed", "trap");
    }
    validateResultRecordPointer(this, resultPointer, SMART_PATHFINDING_RESULT_BYTE_LENGTH, "smart-pathfinding");
    return resultPointer;
  }

  /** Starts a complete one-click-clear session and validates its result/session record pointer. */
  beginOneClickClear(inputPointer: number, inputByteLength: number) {
    validateFixedCommandInput(
      this,
      inputPointer,
      inputByteLength,
      [
        ONE_CLICK_CLEAR_LEGACY_INPUT_BYTE_LENGTH,
        ONE_CLICK_CLEAR_INPUT_BYTE_LENGTH,
        ONE_CLICK_CLEAR_DAG_INPUT_BYTE_LENGTH,
        ONE_CLICK_CLEAR_EVIDENCE_INPUT_BYTE_LENGTH,
      ],
      "one-click-clear",
    );
    let resultPointer: number;
    try {
      resultPointer = this.#exports.beginOneClickClear(inputPointer, inputByteLength);
    } catch (error) {
      throw normalizeGraphwarWasmRuntimeError(error, "Graphwar WASM one-click-clear begin failed", "trap");
    }
    validateResultRecordPointer(this, resultPointer, ONE_CLICK_CLEAR_RESULT_BYTE_LENGTH, "one-click-clear begin");
    return resultPointer;
  }

  /** Resumes one exact one-click-clear session after an externally completed edge batch. */
  resumeOneClickClear(inputPointer: number, inputByteLength: number) {
    validateFixedCommandInput(
      this,
      inputPointer,
      inputByteLength,
      ONE_CLICK_CLEAR_RESUME_INPUT_BYTE_LENGTH,
      "one-click-clear resume",
    );
    let resultPointer: number;
    try {
      resultPointer = this.#exports.resumeOneClickClear(inputPointer, inputByteLength);
    } catch (error) {
      throw normalizeGraphwarWasmRuntimeError(error, "Graphwar WASM one-click-clear resume failed", "trap");
    }
    validateResultRecordPointer(this, resultPointer, ONE_CLICK_CLEAR_RESULT_BYTE_LENGTH, "one-click-clear resume");
    return resultPointer;
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
  const runtimeExports = exports as unknown as GraphwarWasmRuntimeExports;
  const initialArenaCapacity = dependencies.initialArenaCapacity ?? 65_536;
  if (!Number.isSafeInteger(initialArenaCapacity) || initialArenaCapacity <= 0 || initialArenaCapacity > 0xffff_ffff) {
    throw new GraphwarWasmFault("input", "Graphwar WASM initial arena capacity is invalid");
  }

  let base: number;
  try {
    base = runtimeExports.initializeArena(initialArenaCapacity);
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
    capacity = runtimeExports.getArenaCapacity();
    arenaState = {
      allocatorCallCount: runtimeExports.getArenaAllocatorCallCount(),
      base: runtimeExports.getArenaBase(),
      canaryStatus: runtimeExports.getArenaCanaryStatus(),
      cursor: runtimeExports.getArenaCursor(),
      peak: runtimeExports.getArenaPeak(),
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

  const runtime = GraphwarWasmKernelRuntime.createValidated(
    graphwarWasmRuntimeConstructionToken,
    memory,
    runtimeExports,
    base,
  );
  const mark = runtime.markArena();
  try {
    const constantData = createGraphwarGameConstantData();
    if (constantData.length !== GRAPHWAR_GAME_CONSTANT_COUNT) {
      throw new GraphwarWasmFault("abi", "Graphwar game constant layout is inconsistent");
    }
    const expectedAcknowledgment = calculateGraphwarGameConstantAcknowledgment(constantData);
    const constants = writeGraphwarWasmFloat64Values(runtime, constantData);
    let acknowledgment: number;
    try {
      acknowledgment = runtimeExports.initializeGraphwarGameConstants(constants.pointer, constants.length);
    } catch (error) {
      throw new GraphwarWasmFault(
        "abi",
        normalizeErrorMessage(error, "Graphwar WASM game constants initialization failed"),
      );
    }
    if (acknowledgment !== expectedAcknowledgment) {
      throw new GraphwarWasmFault("abi", "Graphwar WASM game constants initialization was not acknowledged");
    }
  } finally {
    runtime.resetArena(mark);
  }
  if (runtime.arenaCursor !== base) {
    throw new GraphwarWasmFault("abi", "Graphwar WASM game constants initialization leaked arena memory");
  }
  return runtime;
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

/** Fixed command records must already be allocated inside the retained arena before crossing the ABI. */
function validateFixedCommandInput(
  runtime: GraphwarWasmKernelRuntime,
  inputPointer: number,
  inputByteLength: number,
  expectedByteLength: number | readonly number[],
  commandName: string,
) {
  if (!isPositiveU32(inputPointer) || inputPointer % 4 !== 0) {
    throw new GraphwarWasmFault("input", `Graphwar WASM ${commandName} input pointer is invalid`);
  }
  const expectedByteLengths = Array.isArray(expectedByteLength) ? expectedByteLength : [expectedByteLength];
  if (!expectedByteLengths.includes(inputByteLength)) {
    throw new GraphwarWasmFault(
      "input",
      `Graphwar WASM ${commandName} input must be exactly ${expectedByteLengths.join(" or ")} bytes`,
    );
  }
  const cursor = runtime.arenaCursor;
  if (inputPointer < runtime.arenaBase || inputPointer > 0xffff_ffff - inputByteLength) {
    throw new GraphwarWasmFault("input", `Graphwar WASM ${commandName} input range is outside the arena`);
  }
  if (inputPointer + inputByteLength > cursor) {
    throw new GraphwarWasmFault("input", `Graphwar WASM ${commandName} input range is not allocated`);
  }
}

/** Result records are flat u32 envelopes; the full record must be retained before adapters read it. */
function validateResultRecordPointer(
  runtime: GraphwarWasmKernelRuntime,
  resultPointer: number,
  resultByteLength: number,
  commandName: string,
) {
  if (!isPositiveU32(resultPointer) || resultPointer % 8 !== 0) {
    throw new GraphwarWasmFault("output", `Graphwar WASM ${commandName} returned an invalid result pointer`);
  }
  const cursor = runtime.arenaCursor;
  if (resultPointer < runtime.arenaBase || resultPointer > 0xffff_ffff - resultByteLength) {
    throw new GraphwarWasmFault("output", `Graphwar WASM ${commandName} result range is outside the arena`);
  }
  if (resultPointer + resultByteLength > cursor) {
    throw new GraphwarWasmFault("output", `Graphwar WASM ${commandName} result record is truncated`);
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

/** Formula command tags and canonical null pointers permit zero-valued u32 fields. */
function isU32(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

/** Mirrors the raw kernel's allocation-free FNV-1a handshake over the exact uploaded f64 bytes. */
function calculateGraphwarGameConstantAcknowledgment(values: Float64Array) {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  let hash = 0x811c9dc5;
  for (const value of bytes) {
    hash = Math.imul(hash ^ value, 0x01000193) >>> 0;
  }
  return hash | 0;
}

/** 编译期 guard，保留测试和后续 wrapper 使用的 export name 联合。 */
export type GraphwarWasmKernelFunctionName = GraphwarWasmRequiredFunctionExport;
