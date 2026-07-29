/** Graphwar WASM raw ABI 边界工具；调用方不得保留指向可变 linear memory 的 view。 */

const UINT32_MAX = 0xffff_ffff;
const UINT32_ADDRESS_SPACE_SIZE = UINT32_MAX + 1;

/** 在页面映射为 typed fault 前，Adapter failure 与正常 Graphwar 算法结果保持独立。 */
export type GraphwarWasmAdapterErrorCode =
  | "duplicate-work-id"
  | "invalid-alignment"
  | "invalid-detection-result"
  | "invalid-enum"
  | "invalid-finite-number"
  | "invalid-expression-program"
  | "invalid-formula-input"
  | "invalid-formula-result"
  | "invalid-image-data"
  | "invalid-index"
  | "invalid-memory-buffer"
  | "invalid-point-data"
  | "invalid-path-error"
  | "invalid-protection-bits"
  | "invalid-session-handle"
  | "invalid-session-identity"
  | "invalid-session-pointer"
  | "invalid-session-state"
  | "invalid-u32"
  | "invalid-work-batch"
  | "missing-work-id"
  | "range-out-of-bounds"
  | "range-overflow"
  | "session-nonce-overflow"
  | "session-pointer-in-use"
  | "unexpected-work-id";

/** 本地 Adapter error；后续 runtime 层负责把它序列化为 Graphwar WASM fault。 */
export class GraphwarWasmAdapterError extends Error {
  /** 稳定且机器可读的 failure 分类。 */
  readonly code: GraphwarWasmAdapterErrorCode;

  constructor(code: GraphwarWasmAdapterErrorCode, message: string) {
    super(message);
    this.name = "GraphwarWasmAdapterError";
    this.code = code;
  }
}

/** Adapter 与合成边界测试使用的最小 memory surface。 */
export interface GraphwarWasmMemorySource {
  /** Raw arena 的固定首字节；module globals 与 guard 必须位于此前。 */
  readonly arenaBase: number;
  /** 当前已分配区间的排他上界；reset/grow 后必须读取最新值。 */
  readonly arenaCursor: number;
  /** 当前非 shared linear-memory buffer；memory.grow 可能在调用之间替换它。 */
  readonly buffer: ArrayBuffer;
}

/** 唯一 pack Adapter 使用的 raw arena surface。 */
export interface GraphwarWasmArenaMemorySource extends GraphwarWasmMemorySource {
  /** 预留字节，并可能在返回前增长或替换 `buffer`。 */
  reserveArena: (byteLength: number, alignment: number) => number;
}

/** Flat WASM result array 的 pointer 与元素数量。 */
export interface GraphwarWasmMemorySlice {
  /** Memory32 linear memory 中的字节偏移。 */
  pointer: number;
  /** 元素数量，不是字节数量。 */
  length: number;
}

/** 验证 slice 所需的元素布局与 raw arena 下界。 */
export interface GraphwarWasmMemoryLayout {
  /** Pointer 必须满足的字节对齐。 */
  alignment: number;
  /** 单个元素占用的字节数。 */
  elementByteLength: number;
  /** 可选的更窄调用方下界；不能放宽 memory source 自身的 arenaBase。 */
  minimumPointer?: number;
}

/** 与验证时观察到的精确当前 memory buffer 绑定的已验证范围。 */
export interface GraphwarWasmValidatedMemoryRange {
  /** 验证时从 memory 新读取的 buffer。 */
  buffer: ArrayBuffer;
  /** 范围的总字节长度。 */
  byteLength: number;
  /** 已验证的字节偏移。 */
  byteOffset: number;
  /** 原始元素数量。 */
  elementLength: number;
}

/** 把一个 JavaScript number 验证为 memory32 无符号整数。 */
export function validateGraphwarWasmU32(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new GraphwarWasmAdapterError("invalid-u32", `${fieldName} must be a uint32`);
  }
  return value;
}

/**
 * 针对当前 memory buffer 验证 pointer、数量、对齐与字节范围。
 *
 * 空数组只使用规范 `(pointer=0, length=0)` 表示。非空数组不能指向零地址、module globals、runtime guard，也不能越过刚读取的 buffer。
 */
export function validateGraphwarWasmMemoryRange(
  memory: GraphwarWasmMemorySource,
  slice: GraphwarWasmMemorySlice,
  layout: GraphwarWasmMemoryLayout,
): GraphwarWasmValidatedMemoryRange {
  const pointer = validateGraphwarWasmU32(slice.pointer, "pointer");
  const length = validateGraphwarWasmU32(slice.length, "length");
  const alignment = validatePositiveGraphwarWasmU32(layout.alignment, "alignment");
  const elementByteLength = validatePositiveGraphwarWasmU32(layout.elementByteLength, "elementByteLength");
  const sourceArenaBase = validateGraphwarWasmU32(memory.arenaBase, "arenaBase");
  const sourceArenaCursor = validateGraphwarWasmU32(memory.arenaCursor, "arenaCursor");
  const requestedMinimumPointer = validateGraphwarWasmU32(layout.minimumPointer ?? sourceArenaBase, "minimumPointer");
  const minimumPointer = Math.max(sourceArenaBase, requestedMinimumPointer);
  if (!Number.isInteger(Math.log2(alignment))) {
    throw new GraphwarWasmAdapterError("invalid-alignment", "alignment must be a positive power of two");
  }

  const buffer = memory.buffer;
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > UINT32_ADDRESS_SPACE_SIZE) {
    throw new GraphwarWasmAdapterError("invalid-memory-buffer", "WASM memory must expose a non-shared memory32 buffer");
  }
  if (sourceArenaBase === 0 || sourceArenaCursor < sourceArenaBase || sourceArenaCursor > buffer.byteLength) {
    throw new GraphwarWasmAdapterError("invalid-memory-buffer", "WASM arena ownership bounds are inconsistent");
  }

  if (length === 0) {
    if (pointer !== 0) {
      throw new GraphwarWasmAdapterError("range-out-of-bounds", "empty WASM arrays must use a null pointer");
    }
    return { buffer, byteLength: 0, byteOffset: 0, elementLength: 0 };
  }
  if (pointer === 0 || pointer < minimumPointer) {
    throw new GraphwarWasmAdapterError("range-out-of-bounds", "WASM pointer is outside the raw arena");
  }
  if (pointer % alignment !== 0) {
    throw new GraphwarWasmAdapterError("invalid-alignment", "WASM pointer does not satisfy its element alignment");
  }

  // 先约束两个运算再计算，保证后续 Number 算术保持精确。
  if (length > Math.floor(UINT32_ADDRESS_SPACE_SIZE / elementByteLength)) {
    throw new GraphwarWasmAdapterError("range-overflow", "WASM array byte length exceeds memory32");
  }
  const byteLength = length * elementByteLength;
  if (pointer > UINT32_ADDRESS_SPACE_SIZE - byteLength) {
    throw new GraphwarWasmAdapterError("range-overflow", "WASM array end address wraps memory32");
  }
  const end = pointer + byteLength;
  if (end > sourceArenaCursor) {
    throw new GraphwarWasmAdapterError("range-out-of-bounds", "WASM array extends beyond the allocated raw arena");
  }
  return { buffer, byteLength, byteOffset: pointer, elementLength: length };
}

/** 重新读取 memory.buffer，验证 byte slice 并返回 owned copy。 */
export function copyGraphwarWasmBytes(
  memory: GraphwarWasmMemorySource,
  slice: GraphwarWasmMemorySlice,
  minimumPointer = 0,
): Uint8Array {
  const range = validateGraphwarWasmMemoryRange(memory, slice, {
    alignment: 1,
    elementByteLength: 1,
    minimumPointer,
  });
  return new Uint8Array(range.buffer, range.byteOffset, range.elementLength).slice();
}

/** 重新读取 memory.buffer，验证对齐的 f64 slice 并返回 owned copy。 */
export function copyGraphwarWasmFloat64Values(
  memory: GraphwarWasmMemorySource,
  slice: GraphwarWasmMemorySlice,
  minimumPointer = 0,
): Float64Array {
  const range = validateGraphwarWasmMemoryRange(memory, slice, {
    alignment: Float64Array.BYTES_PER_ELEMENT,
    elementByteLength: Float64Array.BYTES_PER_ELEMENT,
    minimumPointer,
  });
  return new Float64Array(range.buffer, range.byteOffset, range.elementLength).slice();
}

/** 重新读取 memory.buffer，验证对齐的 u32 slice 并返回 owned copy。 */
export function copyGraphwarWasmUint32Values(
  memory: GraphwarWasmMemorySource,
  slice: GraphwarWasmMemorySlice,
  minimumPointer = 0,
): Uint32Array {
  const range = validateGraphwarWasmMemoryRange(memory, slice, {
    alignment: Uint32Array.BYTES_PER_ELEMENT,
    elementByteLength: Uint32Array.BYTES_PER_ELEMENT,
    minimumPointer,
  });
  return new Uint32Array(range.buffer, range.byteOffset, range.elementLength).slice();
}

/** 一次预留并复制 bytes；若 memory 增长，则重新构造目标 view。 */
export function writeGraphwarWasmBytes(
  arena: GraphwarWasmArenaMemorySource,
  values: Uint8Array,
  minimumPointer = 0,
): GraphwarWasmMemorySlice {
  if (values.length === 0) {
    return { length: 0, pointer: 0 };
  }
  const range = reserveGraphwarWasmMemoryRange(arena, values.length, 1, 1, minimumPointer);
  new Uint8Array(range.buffer, range.byteOffset, range.elementLength).set(values);
  return { length: range.elementLength, pointer: range.byteOffset };
}

/** 一次预留并复制 f64 值；若 memory 增长，则重新构造目标 view。 */
export function writeGraphwarWasmFloat64Values(
  arena: GraphwarWasmArenaMemorySource,
  values: Float64Array,
  minimumPointer = 0,
): GraphwarWasmMemorySlice {
  if (values.length === 0) {
    return { length: 0, pointer: 0 };
  }
  const range = reserveGraphwarWasmMemoryRange(
    arena,
    values.length,
    Float64Array.BYTES_PER_ELEMENT,
    Float64Array.BYTES_PER_ELEMENT,
    minimumPointer,
  );
  new Float64Array(range.buffer, range.byteOffset, range.elementLength).set(values);
  return { length: range.elementLength, pointer: range.byteOffset };
}

/** 一次预留并复制 u32 值；若 memory 增长，则重新构造目标 view。 */
export function writeGraphwarWasmUint32Values(
  arena: GraphwarWasmArenaMemorySource,
  values: Uint32Array,
  minimumPointer = 0,
): GraphwarWasmMemorySlice {
  if (values.length === 0) {
    return { length: 0, pointer: 0 };
  }
  const range = reserveGraphwarWasmMemoryRange(
    arena,
    values.length,
    Uint32Array.BYTES_PER_ELEMENT,
    Uint32Array.BYTES_PER_ELEMENT,
    minimumPointer,
  );
  new Uint32Array(range.buffer, range.byteOffset, range.elementLength).set(values);
  return { length: range.elementLength, pointer: range.byteOffset };
}

/** 要求输出字段为有限数，包括可恢复轨迹状态坐标。 */
export function validateGraphwarWasmFiniteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new GraphwarWasmAdapterError("invalid-finite-number", `${fieldName} must be finite`);
  }
  return value;
}

/** 只接受精确的 path-error 域：省略、非负有限数或正无穷。 */
export function validateGraphwarWasmPathError(value: unknown, fieldName = "pathError"): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value === Number.NEGATIVE_INFINITY) {
    throw new GraphwarWasmAdapterError(
      "invalid-path-error",
      `${fieldName} must be non-negative, positive infinity, or omitted`,
    );
  }
  return value;
}

/** 把数值 ABI tag 限制在当前 Adapter 显式声明的 enum 集合内。 */
export function validateGraphwarWasmEnumValue<const TValue extends number>(
  value: unknown,
  allowedValues: readonly TValue[],
  fieldName: string,
): TValue {
  if (typeof value !== "number" || !allowedValues.some((allowedValue) => value === allowedValue)) {
    throw new GraphwarWasmAdapterError("invalid-enum", `${fieldName} contains an unsupported enum value`);
  }
  return value as TValue;
}

/** 拒绝当前 command layout 未声明的任意 protection-role bit。 */
export function validateGraphwarWasmProtectionBits(
  value: unknown,
  allowedBits: number,
  fieldName = "protectionBits",
): number {
  const bits = validateGraphwarWasmU32(value, fieldName);
  const allowed = validateGraphwarWasmU32(allowedBits, "allowedProtectionBits");
  if ((bits & allowed) >>> 0 !== bits) {
    throw new GraphwarWasmAdapterError(
      "invalid-protection-bits",
      `${fieldName} contains unsupported protection-role bits`,
    );
  }
  return bits;
}

/** 验证严格为正的 u32 layout 字段。 */
function validatePositiveGraphwarWasmU32(value: unknown, fieldName: string) {
  const validated = validateGraphwarWasmU32(value, fieldName);
  if (validated === 0) {
    throw new GraphwarWasmAdapterError("invalid-u32", `${fieldName} must be greater than zero`);
  }
  return validated;
}

/** 证明 memory32 字节数安全后才预留 pack 目标，并验证最新 buffer。 */
function reserveGraphwarWasmMemoryRange(
  arena: GraphwarWasmArenaMemorySource,
  elementLength: number,
  elementByteLength: number,
  alignment: number,
  minimumPointer: number,
) {
  const length = validateGraphwarWasmU32(elementLength, "length");
  if (length > Math.floor(UINT32_ADDRESS_SPACE_SIZE / elementByteLength)) {
    throw new GraphwarWasmAdapterError("range-overflow", "WASM input byte length exceeds memory32");
  }
  const pointer = arena.reserveArena(length * elementByteLength, alignment);
  return validateGraphwarWasmMemoryRange(arena, { length, pointer }, { alignment, elementByteLength, minimumPointer });
}
