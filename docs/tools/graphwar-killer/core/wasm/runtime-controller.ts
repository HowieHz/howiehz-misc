import {
  createGraphwarTypescriptWorkerBackendConfiguration,
  createGraphwarWasmWorkerBackendConfiguration,
  isGraphwarWasmFault,
  type GraphwarWorkerBackendConfiguration,
  type GraphwarWorkerBackendSelection,
} from "../algorithm-backend";
import { GRAPHWAR_KERNEL_WASM_URL } from "./kernel-asset";
import { compileGraphwarWasmModule } from "./runtime";

/** 页面会话内唯一的 Graphwar WASM loader 状态。 */
export type GraphwarWasmRuntimeState =
  | { readonly generation: number; readonly type: "off" }
  | {
      readonly abortController: AbortController;
      readonly generation: number;
      readonly modulePromise: Promise<WebAssembly.Module>;
      readonly type: "loading";
    }
  | { readonly generation: number; readonly module: WebAssembly.Module; readonly type: "ready" }
  | { readonly generation: number; readonly reason: string; readonly type: "degraded" };

interface GraphwarWasmRuntimeControllerDependencies {
  compileModule?: (url: string, signal: AbortSignal) => Promise<WebAssembly.Module>;
  createAbortController?: () => AbortController;
  url?: string;
}

interface GraphwarLoadingSelection {
  promise: Promise<GraphwarWorkerBackendConfiguration>;
  resolve: (configuration: GraphwarWorkerBackendConfiguration) => void;
}

/**
 * 管理页面级 load/abort/retry/fuse，并为等待 loading 的 outer task 固定一次 backend 选择。
 *
 * `WebAssembly.compile` 无法取消；关闭只 abort fetch，并先解析旧 generation 的等待者为 TS，迟到 compile 结果随后因 generation 失配被丢弃。
 */
export function createGraphwarWasmRuntimeController(dependencies: GraphwarWasmRuntimeControllerDependencies = {}) {
  const compileModule = dependencies.compileModule ?? compileGraphwarWasmModule;
  const createAbortController = dependencies.createAbortController ?? (() => new AbortController());
  const url = dependencies.url ?? GRAPHWAR_KERNEL_WASM_URL;
  const listeners = new Set<(state: GraphwarWasmRuntimeState) => void>();
  const loadingSelections = new Map<number, GraphwarLoadingSelection>();
  let state: GraphwarWasmRuntimeState = { generation: 0, type: "off" };

  /** 开启时立即加载；ready/loading 状态下重复开启复用同一份 module promise。 */
  function enable() {
    if (state.type === "loading") {
      return state.modulePromise;
    }
    if (state.type === "ready") {
      return Promise.resolve(state.module);
    }

    const generation = incrementGeneration(state.generation);
    const abortController = createAbortController();
    let resolveSelection: (configuration: GraphwarWorkerBackendConfiguration) => void = () => undefined;
    const selectionPromise = new Promise<GraphwarWorkerBackendConfiguration>((resolve) => {
      resolveSelection = resolve;
    });
    loadingSelections.set(generation, { promise: selectionPromise, resolve: resolveSelection });

    let modulePromise: Promise<WebAssembly.Module>;
    try {
      modulePromise = compileModule(url, abortController.signal).then((module) => {
        // 统一在 loader 边界验证 Module brand，避免 fake/custom loader 让状态停在不可用的 ready 半状态。
        createGraphwarWasmWorkerBackendConfiguration(generation, module);
        return module;
      });
    } catch (error) {
      modulePromise = Promise.reject(error);
    }
    setState({ abortController, generation, modulePromise, type: "loading" });
    void modulePromise.then(
      (module) => completeLoading(generation, modulePromise, module),
      (error) => failLoading(generation, modulePromise, error),
    );
    return modulePromise;
  }

  /** 关闭会同步换代；所有已经等待旧 loading 的任务永久固定为本次 TS generation。 */
  function disable() {
    if (state.type === "off") {
      return;
    }

    const previousState = state;
    const generation = incrementGeneration(previousState.generation);
    setState({ generation, type: "off" });
    if (previousState.type === "loading") {
      previousState.abortController.abort();
    }
    // ready 通知期间重入关闭时，旧 loading selection 仍可能尚未结算。
    resolveLoadingAsTypescript(previousState.generation, generation);
  }

  /** 当前 generation 首个明确 WASM fault 赢得 CAS，并提升到可供 TS replay 使用的新 generation。 */
  function degrade(expectedGeneration: number, error: unknown) {
    if (state.type === "off" || state.type === "degraded" || state.generation !== expectedGeneration) {
      return false;
    }

    const previousState = state;
    const generation = incrementGeneration(previousState.generation);
    setState({ generation, reason: normalizeFaultReason(error), type: "degraded" });
    if (previousState.type === "loading") {
      previousState.abortController.abort();
    }
    resolveLoadingAsTypescript(previousState.generation, generation);
    return true;
  }

  /** 为新 outer task 解析一次 backend；loading 等待者不会追随后续重新开启的 generation。 */
  function createWorkerBackendSelection(): GraphwarWorkerBackendSelection {
    const selectionState = state;
    if (selectionState.type === "ready") {
      return {
        generation: selectionState.generation,
        promise: Promise.resolve(
          createGraphwarWasmWorkerBackendConfiguration(selectionState.generation, selectionState.module),
        ),
      };
    }
    if (selectionState.type === "loading") {
      const selection = loadingSelections.get(selectionState.generation);
      if (!selection) {
        throw new Error("Graphwar WASM loading selection is missing");
      }
      return { generation: selectionState.generation, promise: selection.promise };
    }
    return {
      generation: selectionState.generation,
      promise: Promise.resolve(createGraphwarTypescriptWorkerBackendConfiguration(selectionState.generation)),
    };
  }

  /** 兼容只关心最终配置的调用方；coordinator 应优先使用原子 selection。 */
  function resolveWorkerBackend(): Promise<GraphwarWorkerBackendConfiguration> {
    return createWorkerBackendSelection().promise;
  }

  /** 订阅原子状态迁移；调用方自行决定是否立即读取初始状态。 */
  function subscribe(listener: (nextState: GraphwarWasmRuntimeState) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function completeLoading(generation: number, modulePromise: Promise<WebAssembly.Module>, module: WebAssembly.Module) {
    if (state.type !== "loading" || state.generation !== generation || state.modulePromise !== modulePromise) {
      return;
    }
    setState({ generation, module, type: "ready" });
    const selection = loadingSelections.get(generation);
    loadingSelections.delete(generation);
    selection?.resolve(createGraphwarWasmWorkerBackendConfiguration(generation, module));
  }

  function failLoading(generation: number, modulePromise: Promise<WebAssembly.Module>, error: unknown) {
    if (state.type !== "loading" || state.generation !== generation || state.modulePromise !== modulePromise) {
      return;
    }
    // 主动关闭会先换代，因此只有仍权威的异常 abort 才会到达这里，并应按 loader fault 熔断。
    const replayGeneration = incrementGeneration(generation);
    setState({ generation: replayGeneration, reason: normalizeFaultReason(error), type: "degraded" });
    resolveLoadingAsTypescript(generation, replayGeneration);
  }

  function resolveLoadingAsTypescript(loadingGeneration: number, typescriptGeneration: number) {
    const selection = loadingSelections.get(loadingGeneration);
    loadingSelections.delete(loadingGeneration);
    selection?.resolve(createGraphwarTypescriptWorkerBackendConfiguration(typescriptGeneration));
  }

  function setState(nextState: GraphwarWasmRuntimeState) {
    state = snapshotRuntimeState(nextState);
    for (const listener of [...listeners]) {
      try {
        listener(snapshotRuntimeState(state));
      } catch {
        // 观察者异常不能中断 abort、selection 结算或 generation 换代。
      }
    }
  }

  return {
    createWorkerBackendSelection,
    degrade,
    disable,
    enable,
    getState: () => snapshotRuntimeState(state),
    resolveWorkerBackend,
    subscribe,
  };
}

/** 状态资源保持原子，但观察者只获得冻结的外层快照，不能改写 controller guard。 */
function snapshotRuntimeState(state: GraphwarWasmRuntimeState): GraphwarWasmRuntimeState {
  return Object.freeze({ ...state });
}

function incrementGeneration(generation: number) {
  if (!Number.isSafeInteger(generation) || generation < 0 || generation >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Graphwar WASM backend generation exhausted safe integer space");
  }
  return generation + 1;
}

function normalizeFaultReason(error: unknown) {
  if (isGraphwarWasmFault(error)) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  const message = error === undefined ? "" : String(error).trim();
  return message || "Graphwar WASM failed";
}
