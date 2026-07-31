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

/** Creates the complete diagnostic state for an attempt that executes its selected backend directly. */
export function createGraphwarBackendExecution(
  backend: GraphwarAlgorithmBackendType,
):
  | Extract<GraphwarBackendExecution, { requested: "typescript" }>
  | Extract<GraphwarBackendExecution, { effective: "wasm" }> {
  return backend === "wasm"
    ? { effective: "wasm", requested: "wasm" }
    : { effective: "typescript", requested: "typescript" };
}

/** Creates the only legal cross-backend diagnostic state after a requested WASM attempt falls back to TypeScript. */
export function createGraphwarBackendFallbackExecution(
  fallbackReason: string,
): Extract<GraphwarBackendExecution, { effective: "typescript"; requested: "wasm" }> {
  const reason = fallbackReason.trim();
  if (!reason) {
    throw new TypeError("Graphwar backend fallback requires a non-empty reason");
  }
  return { effective: "typescript", fallbackReason: reason, requested: "wasm" };
}

/** 稳定外层任务与当前获准 commit 的可替换 backend attempt 身份。 */
export interface GraphwarBackendAttemptIdentity {
  readonly attemptId: number;
  readonly backendGeneration: number;
  readonly outerTaskId: number;
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
  readonly backendGeneration: number;
  readonly nonce: number;
  readonly requestId: number;
  readonly taskType: "detection" | "one-click-clear";
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
      session: GraphwarWasmSessionIdentity;
      type: "edge-session";
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
  private hasReported = false;

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

  /** 同一进程内的 parent/root 传播链是否已经发布过 control 消息。 */
  get hasBeenReported() {
    return this.hasReported;
  }

  /** 精确 child provenance 发布成功后标记，避免 root 再发布泛化 task fault。 */
  markReported() {
    this.hasReported = true;
    return this;
  }
}

/** 为某个 generation 创建 Worker slot 时发送的原子 backend 材料。 */
export type GraphwarWorkerBackendInitialization =
  | {
      readonly type: "typescript";
    }
  | {
      readonly module: WebAssembly.Module;
      readonly type: "wasm";
    };

/** Worker initialization and the caller-visible execution state must stay one legal atomic configuration. */
export type GraphwarWorkerBackendConfiguration =
  | {
      readonly backend: Extract<GraphwarWorkerBackendInitialization, { type: "typescript" }>;
      readonly backendExecution: Extract<GraphwarBackendExecution, { effective: "typescript" }>;
      readonly generation: number;
    }
  | {
      readonly backend: Extract<GraphwarWorkerBackendInitialization, { type: "wasm" }>;
      readonly backendExecution: Extract<GraphwarBackendExecution, { effective: "wasm" }>;
      readonly generation: number;
    };

/** Outer task 在入口原子取得的 generation 与最终固定 backend。 */
export interface GraphwarWorkerBackendSelection {
  readonly generation: number;
  readonly promise: Promise<GraphwarWorkerBackendConfiguration>;
}

/** 默认关闭 WASM 时，所有现有 Worker 都使用同一份 TypeScript 初始化配置。 */
export function createGraphwarTypescriptWorkerBackendConfiguration(
  generation: number,
  fallbackReason?: string,
): Extract<GraphwarWorkerBackendConfiguration, { backend: { type: "typescript" } }> {
  assertGraphwarBackendGeneration(generation);
  const backendExecution: Extract<GraphwarBackendExecution, { effective: "typescript" }> = fallbackReason
    ? createGraphwarBackendFallbackExecution(fallbackReason)
    : { effective: "typescript", requested: "typescript" };
  return Object.freeze({
    backend: Object.freeze({ type: "typescript" as const }),
    backendExecution: Object.freeze(backendExecution),
    generation,
  });
}

/** 页面 loader 编译成功后，为 Worker structured clone 绑定权威 module。 */
export function createGraphwarWasmWorkerBackendConfiguration(
  generation: number,
  module: WebAssembly.Module,
): Extract<GraphwarWorkerBackendConfiguration, { backend: { type: "wasm" } }> {
  assertGraphwarBackendGeneration(generation);
  if (!isWebAssemblyModule(module)) {
    throw new TypeError("Graphwar WASM worker backend requires a WebAssembly.Module");
  }
  return Object.freeze({
    backend: Object.freeze({ module, type: "wasm" as const }),
    backendExecution: Object.freeze({ effective: "wasm" as const, requested: "wasm" as const }),
    generation,
  });
}

/** Backend 生命周期消息独立于业务 task id 与 result。 */
export type GraphwarBackendControlMessage =
  | {
      backend: GraphwarWorkerBackendInitialization;
      backendExecution: GraphwarBackendExecution;
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

/** Worker 的入站 control 只有初始化；ready/fault 只从 Worker 返回 parent。 */
export type GraphwarBackendInitializationMessage = Extract<GraphwarBackendControlMessage, { type: "backend-init" }>;

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

/** Nested Worker 的 session provenance 使用完整字段比较，不接受同 generation 的部分匹配。 */
export function graphwarWasmSessionIdentitiesAreEqual(
  left: GraphwarWasmSessionIdentity,
  right: GraphwarWasmSessionIdentity,
) {
  return (
    left.backendGeneration === right.backendGeneration &&
    left.nonce === right.nonce &&
    left.requestId === right.requestId &&
    left.taskType === right.taskType
  );
}

/** Parent Worker 从内部单调 request id 构造不可复用的 nested session 身份。 */
export function createGraphwarWasmSessionIdentity(
  attempt: GraphwarBackendAttemptIdentity,
  requestId: number,
  taskType: GraphwarWasmSessionIdentity["taskType"],
): GraphwarWasmSessionIdentity {
  if (!isNonNegativeSafeInteger(requestId) || requestId >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Graphwar WASM session request id must leave room for a positive nonce");
  }
  return {
    backendGeneration: attempt.backendGeneration,
    nonce: requestId + 1,
    requestId,
    taskType,
  };
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
  if (value.type === "edge-session") {
    return (
      value.session.taskType === "one-click-clear" &&
      value.session.backendGeneration === value.attempt.backendGeneration &&
      !("shardId" in value) &&
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
    if (
      !isGraphwarWorkerBackendInitialization(value.backend) ||
      !isGraphwarBackendExecution(value.backendExecution) ||
      "context" in value ||
      "fault" in value
    ) {
      return false;
    }
    return value.backend.type === "wasm"
      ? value.backendExecution.effective === "wasm"
      : value.backendExecution.effective === "typescript";
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
  if (context.type === "initialization") {
    return true;
  }
  if (context.attempt.backendGeneration !== value.generation) {
    return false;
  }
  if (value.role === "detection-template") {
    return context.type === "template-shard";
  }
  if (value.role === "one-click-clear-edge") {
    return context.type === "edge-session" || context.type === "edge-job";
  }
  return context.type === "task";
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
