/** 单次执行 attempt 选用的 Graphwar 生产算法 backend。 */
export type GraphwarAlgorithmBackendType = "typescript" | "wasm";

/**
 * 已由 Adapter 验证 module、exports 和 memory 的 WASM runtime 名义基类。
 *
 * 核心合约刻意不公开构造函数和 raw export 结构；具体 Adapter 独占 runtime 验证，并只在边界验证成功后构造子类。
 */
export abstract class GraphwarValidatedWasmRuntime {
  /** 防止结构相似但未经验证的普通对象满足 runtime 合约。 */
  protected readonly graphwarValidatedWasmRuntimeBrand: true;

  protected constructor() {
    this.graphwarValidatedWasmRuntimeBrand = true;
  }
}

/**
 * 单次 attempt 的完整 backend 上下文。
 *
 * 两个分支都携带 commit gate 使用的 generation；只有 WASM 分支能携带已验证 runtime，因此类型不能表达“WASM 缺 runtime”或“TypeScript 携带 runtime”两种非法内部状态。
 */
export type GraphwarAlgorithmBackendContext =
  | {
      generation: number;
      type: "typescript";
    }
  | {
      generation: number;
      runtime: GraphwarValidatedWasmRuntime;
      type: "wasm";
    };

/** 为权威 backend generation 创建已验证的 TypeScript backend 上下文。 */
export function createGraphwarTypescriptBackendContext(
  generation: number,
): Extract<GraphwarAlgorithmBackendContext, { type: "typescript" }> {
  assertGraphwarBackendGeneration(generation);
  return { generation, type: "typescript" };
}

/** 在 Adapter 构造名义 runtime 后创建已验证的 WASM backend 上下文。 */
export function createGraphwarWasmBackendContext(
  generation: number,
  runtime: GraphwarValidatedWasmRuntime,
): Extract<GraphwarAlgorithmBackendContext, { type: "wasm" }> {
  assertGraphwarBackendGeneration(generation);
  if (!(runtime instanceof GraphwarValidatedWasmRuntime)) {
    throw new TypeError("Graphwar WASM backend requires a validated runtime");
  }
  return { generation, runtime, type: "wasm" };
}

/** 请求 backend、实际 backend 与 fallback 原因必须作为一个原子诊断值传递。 */
export type GraphwarBackendExecution =
  | {
      effective: "typescript";
      requested: "typescript";
    }
  | {
      effective: "wasm";
      requested: "wasm";
    }
  | {
      effective: "typescript";
      fallbackReason: string;
      requested: "wasm";
    };

/** 稳定外层任务与当前获准 commit 的可替换 backend attempt 身份。 */
export interface GraphwarBackendAttemptIdentity {
  attemptId: number;
  backendGeneration: number;
  outerTaskId: number;
}

/** 通用业务 payload envelope；每个 task、event 和 result 都必须携带完整可替换 attempt 身份。 */
export interface GraphwarBackendAttemptEnvelope<TPayload> {
  attempt: GraphwarBackendAttemptIdentity;
  payload: TPayload;
}

/** 所有会执行 Graphwar 生产算法核心的 Worker role。 */
export type GraphwarWorkerRole =
  | "trajectory"
  | "live-click-preview"
  | "detection-main"
  | "detection-template"
  | "pathfinding-master"
  | "one-click-clear-edge";

/** 可能触发页面 session WASM fuse 的 loader、Adapter 或 runtime 故障分类。 */
export type GraphwarWasmFaultCode =
  | "unavailable"
  | "load"
  | "compile"
  | "module-clone"
  | "instantiate"
  | "abi"
  | "input"
  | "allocation"
  | "trap"
  | "event"
  | "output";

/** Worker control 消息使用的可克隆 typed WASM failure payload。 */
export interface GraphwarWasmFaultDescriptor {
  code: GraphwarWasmFaultCode;
  message: string;
}

/** 子 Worker fault provenance 使用的可克隆 session 身份，不暴露 raw arena pointer。 */
export interface GraphwarWasmSessionIdentity {
  backendGeneration: number;
  nonce: number;
  requestId: number;
  taskType: "detection" | "one-click-clear";
}

/** Typed WASM fault 跨 Worker 边界时附带的精确命令上下文。 */
export type GraphwarWasmFaultContext =
  | { type: "initialization" }
  | { attempt: GraphwarBackendAttemptIdentity; type: "task" }
  | {
      attempt: GraphwarBackendAttemptIdentity;
      session: GraphwarWasmSessionIdentity;
      shardId: number;
      type: "template-shard";
    }
  | {
      attempt: GraphwarBackendAttemptIdentity;
      jobId: number;
      session: GraphwarWasmSessionIdentity;
      type: "edge-job";
    };

/** 进程内 typed WASM 故障；正常收敛、取消和 Worker failure 使用各自独立的错误类型。 */
export class GraphwarWasmFault extends Error {
  readonly code: GraphwarWasmFaultCode;

  constructor(code: GraphwarWasmFaultCode, message: string) {
    if (!isNonEmptyString(message)) {
      throw new TypeError("Graphwar WASM fault message must not be empty");
    }
    super(message);
    this.name = "GraphwarWasmFault";
    this.code = code;
  }

  /** 生成跨 Worker 边界传递的可克隆 payload。 */
  toDescriptor(): GraphwarWasmFaultDescriptor {
    return { code: this.code, message: this.message };
  }
}

/** 为某个 generation 创建 Worker slot 时发送的原子 backend 材料。 */
export type GraphwarWorkerBackendInitialization =
  | {
      type: "typescript";
    }
  | {
      module: WebAssembly.Module;
      type: "wasm";
    };

/** Backend 生命周期消息独立于业务 task id 与 result。 */
export type GraphwarBackendControlMessage =
  | {
      backend: GraphwarWorkerBackendInitialization;
      generation: number;
      role: GraphwarWorkerRole;
      type: "backend-init";
    }
  | {
      backend: GraphwarAlgorithmBackendType;
      generation: number;
      role: GraphwarWorkerRole;
      type: "backend-ready";
    }
  | {
      context: GraphwarWasmFaultContext;
      fault: GraphwarWasmFaultDescriptor;
      generation: number;
      role: GraphwarWorkerRole;
      type: "wasm-fault";
    };

/** 验证在真实 runtime 边界重建的 backend 上下文。 */
export function isGraphwarAlgorithmBackendContext(value: unknown): value is GraphwarAlgorithmBackendContext {
  if (!isRecord(value) || !isGraphwarBackendGeneration(value.generation)) {
    return false;
  }
  if (value.type === "typescript") {
    return !("runtime" in value);
  }
  return value.type === "wasm" && value.runtime instanceof GraphwarValidatedWasmRuntime;
}

/** 验证 requested/effective backend 的三种合法诊断状态。 */
export function isGraphwarBackendExecution(value: unknown): value is GraphwarBackendExecution {
  if (!isRecord(value)) {
    return false;
  }
  if (value.requested === "typescript") {
    return value.effective === "typescript" && !("fallbackReason" in value);
  }
  if (value.requested !== "wasm") {
    return false;
  }
  if (value.effective === "wasm") {
    return !("fallbackReason" in value);
  }
  return value.effective === "typescript" && isNonEmptyString(value.fallbackReason);
}

/** 验证业务 event 与 result 必须携带的完整身份。 */
export function isGraphwarBackendAttemptIdentity(value: unknown): value is GraphwarBackendAttemptIdentity {
  return (
    isRecord(value) &&
    isNonNegativeSafeInteger(value.attemptId) &&
    isGraphwarBackendGeneration(value.backendGeneration) &&
    isNonNegativeSafeInteger(value.outerTaskId)
  );
}

/** 所有 Worker commit gate 共用的精确比较；部分 id 匹配永远不具有提交权限。 */
export function graphwarBackendAttemptIdentitiesAreEqual(
  left: GraphwarBackendAttemptIdentity,
  right: GraphwarBackendAttemptIdentity,
) {
  return (
    left.attemptId === right.attemptId &&
    left.backendGeneration === right.backendGeneration &&
    left.outerTaskId === right.outerTaskId
  );
}

/** 验证业务 envelope，并只把领域 payload 边界委托给调用方。 */
export function isGraphwarBackendAttemptEnvelope<TPayload>(
  value: unknown,
  isPayload: (payload: unknown) => payload is TPayload,
): value is GraphwarBackendAttemptEnvelope<TPayload> {
  return (
    isRecord(value) && isGraphwarBackendAttemptIdentity(value.attempt) && "payload" in value && isPayload(value.payload)
  );
}

/** 验证一个生产 Worker role，不接受任意字符串。 */
export function isGraphwarWorkerRole(value: unknown): value is GraphwarWorkerRole {
  return (
    value === "trajectory" ||
    value === "live-click-preview" ||
    value === "detection-main" ||
    value === "detection-template" ||
    value === "pathfinding-master" ||
    value === "one-click-clear-edge"
  );
}

/** 验证可克隆的 typed WASM fault payload。 */
export function isGraphwarWasmFaultDescriptor(value: unknown): value is GraphwarWasmFaultDescriptor {
  return isRecord(value) && isGraphwarWasmFaultCode(value.code) && isNonEmptyString(value.message);
}

/** Parent 操作页面 fuse 前，验证 task/child fault provenance。 */
export function isGraphwarWasmFaultContext(value: unknown): value is GraphwarWasmFaultContext {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type === "initialization") {
    return !("attempt" in value) && !("session" in value) && !("shardId" in value) && !("jobId" in value);
  }
  if (!isGraphwarBackendAttemptIdentity(value.attempt)) {
    return false;
  }
  if (value.type === "task") {
    return !("session" in value) && !("shardId" in value) && !("jobId" in value);
  }
  if (!isGraphwarWasmSessionIdentity(value.session)) {
    return false;
  }
  if (value.type === "template-shard") {
    return (
      value.session.taskType === "detection" &&
      value.session.backendGeneration === value.attempt.backendGeneration &&
      isNonNegativeSafeInteger(value.shardId) &&
      !("jobId" in value)
    );
  }
  return (
    value.type === "edge-job" &&
    value.session.taskType === "one-click-clear" &&
    value.session.backendGeneration === value.attempt.backendGeneration &&
    isNonNegativeSafeInteger(value.jobId) &&
    !("shardId" in value)
  );
}

/** 收窄进程内异常，同时避免把普通 Error 与 WASM fault 混为一类。 */
export function isGraphwarWasmFault(value: unknown): value is GraphwarWasmFault {
  return value instanceof GraphwarWasmFault;
}

/** 验证独立的 Worker backend 生命周期消息。 */
export function isGraphwarBackendControlMessage(value: unknown): value is GraphwarBackendControlMessage {
  if (!isRecord(value) || !isGraphwarBackendGeneration(value.generation) || !isGraphwarWorkerRole(value.role)) {
    return false;
  }
  if (value.type === "backend-init") {
    return isGraphwarWorkerBackendInitialization(value.backend) && !("context" in value) && !("fault" in value);
  }
  if (value.type === "backend-ready") {
    return isGraphwarAlgorithmBackendType(value.backend) && !("context" in value) && !("fault" in value);
  }
  if (
    value.type !== "wasm-fault" ||
    "backend" in value ||
    !isGraphwarWasmFaultContext(value.context) ||
    !isGraphwarWasmFaultDescriptor(value.fault)
  ) {
    return false;
  }
  const context = value.context;
  return (
    context.type === "initialization" ||
    (context.attempt.backendGeneration === value.generation &&
      (context.type === "template-shard"
        ? value.role === "detection-template"
        : context.type !== "edge-job" || value.role === "one-click-clear-edge"))
  );
}

function isGraphwarWasmSessionIdentity(value: unknown): value is GraphwarWasmSessionIdentity {
  return (
    isRecord(value) &&
    isGraphwarBackendGeneration(value.backendGeneration) &&
    isNonNegativeSafeInteger(value.nonce) &&
    value.nonce > 0 &&
    isNonNegativeSafeInteger(value.requestId) &&
    (value.taskType === "detection" || value.taskType === "one-click-clear")
  );
}

/** Backend generation 从零开始，并在 Worker structured clone 后保持精确。 */
function isGraphwarBackendGeneration(value: unknown): value is number {
  return isNonNegativeSafeInteger(value);
}

/** 拒绝非法内部构造，不静默归一化 generation。 */
function assertGraphwarBackendGeneration(generation: number) {
  if (!isGraphwarBackendGeneration(generation)) {
    throw new RangeError("Graphwar backend generation must be a non-negative safe integer");
  }
}

/** 验证原子初始化分支，包括真实且可克隆的 WebAssembly.Module。 */
function isGraphwarWorkerBackendInitialization(value: unknown): value is GraphwarWorkerBackendInitialization {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type === "typescript") {
    return !("module" in value);
  }
  return value.type === "wasm" && isWebAssemblyModule(value.module);
}

/** WebAssembly.Module.exports 可在当前 realm 做 brand 检查，不依赖可伪造的对象结构。 */
function isWebAssemblyModule(value: unknown): value is WebAssembly.Module {
  if (typeof WebAssembly === "undefined" || typeof WebAssembly.Module !== "function") {
    return false;
  }
  try {
    WebAssembly.Module.exports(value as WebAssembly.Module);
    return true;
  } catch {
    return false;
  }
}

/** 验证稳定公开的 backend literal。 */
function isGraphwarAlgorithmBackendType(value: unknown): value is GraphwarAlgorithmBackendType {
  return value === "typescript" || value === "wasm";
}

/** Typed fuse 分类进入页面状态或诊断前进行验证。 */
function isGraphwarWasmFaultCode(value: unknown): value is GraphwarWasmFaultCode {
  return (
    value === "unavailable" ||
    value === "load" ||
    value === "compile" ||
    value === "module-clone" ||
    value === "instantiate" ||
    value === "abi" ||
    value === "input" ||
    value === "allocation" ||
    value === "trap" ||
    value === "event" ||
    value === "output"
  );
}

/** Worker id 与 generation 必须能进行精确整数比较。 */
function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Fault 原因发布前已经归一化，不能是空占位文本。 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** 未知 Worker 消息必须先收窄为对象，才能访问字段。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
