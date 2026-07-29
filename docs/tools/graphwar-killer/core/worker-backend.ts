import {
  createGraphwarTypescriptBackendContext,
  createGraphwarWasmBackendContext,
  GraphwarValidatedWasmRuntime,
  GraphwarWasmFault,
  isGraphwarBackendControlMessage,
  isGraphwarWasmFault,
  type GraphwarAlgorithmBackendContext,
  type GraphwarBackendAttemptIdentity,
  type GraphwarBackendControlMessage,
  type GraphwarBackendInitializationMessage,
  type GraphwarWasmFaultContext,
  type GraphwarWorkerBackendConfiguration,
  type GraphwarWorkerRole,
} from "./algorithm-backend";
import { GraphwarWasmAdapterError } from "./wasm/abi";
import { instantiateGraphwarWasmRuntime } from "./wasm/runtime";

/** 主线程或 parent Worker 对一个实际 Worker slot 的原子初始化状态。 */
export type GraphwarWorkerBackendSlotState =
  | {
      backend: GraphwarWorkerBackendConfiguration["backend"]["type"];
      generation: number;
      type: "initializing";
    }
  | {
      backend: GraphwarWorkerBackendConfiguration["backend"]["type"];
      generation: number;
      type: "ready";
    }
  | { error: Error; generation: number; type: "failed" };

interface GraphwarWorkerMessagePort {
  postMessage(message: unknown): void;
}

interface GraphwarWorkerBackendSlotOptions {
  configuration: GraphwarWorkerBackendConfiguration;
  onInfrastructureFailure: (error: Error) => void;
  onWasmFault: (message: Extract<GraphwarBackendControlMessage, { type: "wasm-fault" }>) => void;
  /** Nested slot 只接受仍属于当前 session/shard/job 的 fault；root slot 可省略。 */
  shouldAcceptWasmFault?: (message: Extract<GraphwarBackendControlMessage, { type: "wasm-fault" }>) => boolean;
  role: GraphwarWorkerRole;
  worker: GraphwarWorkerMessagePort;
}

/**
 * 创建实际 Worker 后立即发送 backend-init，并独占 ready/fault control 响应。
 *
 * 业务 handler 只需先调用 `handleMessage`；返回 true 表示消息已被 control 层消费。
 */
export function createGraphwarWorkerBackendSlot(options: GraphwarWorkerBackendSlotOptions) {
  const { configuration, role, worker } = options;
  let state: GraphwarWorkerBackendSlotState = {
    backend: configuration.backend.type,
    generation: configuration.generation,
    type: "initializing",
  };

  try {
    worker.postMessage({
      backend: configuration.backend,
      generation: configuration.generation,
      role,
      type: "backend-init",
    } satisfies GraphwarBackendControlMessage);
  } catch (error) {
    const normalizedError = normalizeError(error, "Graphwar worker backend initialization could not be posted");
    state = { error: normalizedError, generation: configuration.generation, type: "failed" };
    if (configuration.backend.type === "wasm" && isDataCloneError(error)) {
      options.onWasmFault({
        context: { type: "initialization" },
        fault: { code: "module-clone", message: normalizedError.message },
        generation: configuration.generation,
        role,
        type: "wasm-fault",
      });
    } else {
      options.onInfrastructureFailure(normalizedError);
    }
  }

  /** 只消费独立 control envelope；业务消息原样留给 runner。 */
  function handleMessage(value: unknown): value is GraphwarBackendControlMessage {
    if (!isGraphwarBackendControlMessage(value)) {
      return false;
    }
    if (value.generation !== configuration.generation) {
      return true;
    }
    if (value.role !== role || value.type === "backend-init") {
      failInfrastructure(new Error("Graphwar worker returned an unexpected backend control message"));
      return true;
    }
    if (value.type === "backend-ready") {
      if (value.backend !== configuration.backend.type || state.type !== "initializing") {
        failInfrastructure(new Error("Graphwar worker returned an inconsistent backend-ready message"));
        return true;
      }
      state = { backend: value.backend, generation: value.generation, type: "ready" };
      return true;
    }

    if (configuration.backend.type !== "wasm") {
      failInfrastructure(new Error("TypeScript worker returned an unexpected WASM fault"));
      return true;
    }
    if (options.shouldAcceptWasmFault && !options.shouldAcceptWasmFault(value)) {
      return true;
    }
    state = {
      error: new GraphwarWasmFault(value.fault.code, value.fault.message),
      generation: value.generation,
      type: "failed",
    };
    options.onWasmFault(value);
    return true;
  }

  function failInfrastructure(error: Error) {
    state = { error, generation: configuration.generation, type: "failed" };
    options.onInfrastructureFailure(error);
  }

  return {
    getState: () => state,
    handleMessage,
  };
}

/** Worker 内部持有的初始化状态；runtime 与配置只能在 ready 分支同时存在。 */
type GraphwarWorkerBackendRuntimeState =
  | { type: "uninitialized" }
  | {
      configuration: GraphwarWorkerBackendConfiguration;
      promise: Promise<GraphwarAlgorithmBackendContext | undefined>;
      type: "initializing";
    }
  | {
      configuration: GraphwarWorkerBackendConfiguration;
      context: GraphwarAlgorithmBackendContext;
      type: "ready";
    }
  | {
      configuration: GraphwarWorkerBackendConfiguration;
      fault: GraphwarWasmFault;
      type: "failed";
    };

interface GraphwarWorkerBackendRuntimeOptions {
  instantiateRuntime?: (module: WebAssembly.Module) => Promise<GraphwarValidatedWasmRuntime>;
  postControlMessage: (message: GraphwarBackendControlMessage) => void;
  role: GraphwarWorkerRole;
}

/** Worker 侧按消息顺序异步实例化一次 backend，并让随后业务任务等待同一 initialization promise。 */
export function createGraphwarWorkerBackendRuntime(options: GraphwarWorkerBackendRuntimeOptions) {
  const instantiateRuntime = options.instantiateRuntime ?? instantiateGraphwarWasmRuntime;
  let state: GraphwarWorkerBackendRuntimeState = { type: "uninitialized" };

  /** Backend-init 是唯一由本控制器消费的入站 control 消息。 */
  function handleMessage(value: unknown): value is GraphwarBackendInitializationMessage {
    if (!isGraphwarBackendControlMessage(value) || value.type !== "backend-init") {
      return false;
    }
    if (value.role !== options.role || state.type !== "uninitialized") {
      const generation = value.generation;
      const message = "Graphwar worker received an invalid backend initialization";
      if (value.backend.type === "typescript") {
        throw new Error(message);
      }
      const fault = new GraphwarWasmFault("abi", message);
      state = {
        configuration: { backend: value.backend, generation },
        fault,
        type: "failed",
      };
      postFault(generation, { type: "initialization" }, fault);
      return true;
    }

    const configuration = { backend: value.backend, generation: value.generation };
    const promise = initialize(configuration);
    state = { configuration, promise, type: "initializing" };
    return true;
  }

  /** 业务任务进入算法前等待初始化，并严格绑定完整 attempt generation。 */
  async function waitForBackend(attempt: GraphwarBackendAttemptIdentity) {
    if (state.type === "uninitialized") {
      throw new Error("Graphwar worker backend was not initialized");
    }
    if (state.type === "initializing") {
      await state.promise;
    }
    if (state.type === "failed") {
      throw state.fault;
    }
    if (state.type !== "ready" || state.configuration.generation !== attempt.backendGeneration) {
      throw new Error("Graphwar worker task generation does not match its initialized backend");
    }
    return state.context;
  }

  /** Parent Worker 创建 nested Worker 时复用同一 module 与 generation，不重新 fetch/compile。 */
  function getNestedConfiguration(attempt: GraphwarBackendAttemptIdentity): GraphwarWorkerBackendConfiguration {
    if (state.type !== "ready" || state.configuration.generation !== attempt.backendGeneration) {
      throw new Error("Graphwar nested worker backend does not match the parent task generation");
    }
    return state.configuration;
  }

  /** 未来 WASM command 的 typed fault 由同一 control channel 报告，不落入普通业务 error。 */
  function reportWasmFault(context: GraphwarWasmFaultContext, error: unknown) {
    if (state.type !== "ready" || state.configuration.backend.type !== "wasm") {
      throw new Error("Graphwar worker cannot report a WASM fault without an active WASM backend");
    }
    const fault = isGraphwarWasmFault(error)
      ? error
      : new GraphwarWasmFault("trap", normalizeError(error, "Graphwar WASM task failed").message);
    const generation =
      context.type === "initialization" ? getConfigurationGeneration() : context.attempt.backendGeneration;
    postFault(generation, context, fault);
  }

  async function initialize(configuration: GraphwarWorkerBackendConfiguration) {
    let context: GraphwarAlgorithmBackendContext;
    try {
      if (configuration.backend.type === "typescript") {
        await Promise.resolve();
        context = createGraphwarTypescriptBackendContext(configuration.generation);
      } else {
        context = createGraphwarWasmBackendContext(
          configuration.generation,
          await instantiateRuntime(configuration.backend.module),
        );
      }
    } catch (error) {
      if (configuration.backend.type === "typescript") {
        throw error;
      }
      const fault = isGraphwarWasmFault(error)
        ? error
        : new GraphwarWasmFault("instantiate", normalizeError(error, "Graphwar WASM instantiation failed").message);
      if (state.type === "initializing" && state.configuration === configuration) {
        state = { configuration, fault, type: "failed" };
        postFault(configuration.generation, { type: "initialization" }, fault);
      }
      return undefined;
    }
    if (state.type !== "initializing" || state.configuration !== configuration) {
      return undefined;
    }
    state = { configuration, context, type: "ready" };
    options.postControlMessage({
      backend: configuration.backend.type,
      generation: configuration.generation,
      role: options.role,
      type: "backend-ready",
    });
    return context;
  }

  function getConfigurationGeneration() {
    if (state.type === "uninitialized") {
      throw new Error("Graphwar worker backend was not initialized");
    }
    return state.configuration.generation;
  }

  function postFault(generation: number, context: GraphwarWasmFaultContext, fault: GraphwarWasmFault) {
    options.postControlMessage({
      context,
      fault: fault.toDescriptor(),
      generation,
      role: options.role,
      type: "wasm-fault",
    });
  }

  return {
    getNestedConfiguration,
    getState: () => state,
    handleMessage,
    reportWasmFault,
    waitForBackend,
  };
}

/**
 * 统一 Worker 初始化等待与运行期 typed fault 上报。
 *
 * 初始化 typed fault 已由 runtime 自己发布，任务阶段 fault 才在这里附带精确来源身份发布；普通业务或 transport 异常继续抛给各 role 的既有错误路径。
 */
export async function executeGraphwarWorkerTask<TResult>(
  runtime: Pick<ReturnType<typeof createGraphwarWorkerBackendRuntime>, "reportWasmFault" | "waitForBackend">,
  attempt: GraphwarBackendAttemptIdentity,
  faultContext: Exclude<GraphwarWasmFaultContext, { type: "initialization" }>,
  task: (context: GraphwarAlgorithmBackendContext) => TResult | Promise<TResult>,
): Promise<{ result: TResult; type: "complete" } | { type: "wasm-fault" }> {
  try {
    const context = await runtime.waitForBackend(attempt);
    try {
      return { result: await task(context), type: "complete" };
    } catch (error) {
      const fault = normalizeGraphwarWasmTaskFault(context, error);
      if (!fault) {
        throw error;
      }
      if (!fault.hasBeenReported) {
        runtime.reportWasmFault(faultContext, fault);
        fault.markReported();
      }
      return { type: "wasm-fault" };
    }
  } catch (error) {
    if (isGraphwarWasmFault(error)) {
      return { type: "wasm-fault" };
    }
    throw error;
  }
}

/** Adapter failures become typed faults only at the Worker boundary that owns an effective WASM task. */
function normalizeGraphwarWasmTaskFault(
  context: GraphwarAlgorithmBackendContext,
  error: unknown,
): GraphwarWasmFault | undefined {
  if (isGraphwarWasmFault(error)) {
    return error;
  }
  if (context.type !== "wasm" || !(error instanceof GraphwarWasmAdapterError)) {
    return undefined;
  }
  return new GraphwarWasmFault(error.faultDomain, error.message);
}

function normalizeError(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message.trim()) {
    return error;
  }
  const message = error === undefined ? "" : String(error).trim();
  return new Error(message || fallbackMessage);
}

/** Structured clone 规范只把 DataCloneError 视为 Module 无法克隆；其余同步异常是 transport failure。 */
function isDataCloneError(error: unknown) {
  return typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "DataCloneError";
}
