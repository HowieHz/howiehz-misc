import type { GraphwarWasmSessionIdentity } from "../algorithm-backend";
import {
  GraphwarWasmAdapterError,
  validateGraphwarWasmMemoryRange,
  validateGraphwarWasmU32,
  type GraphwarWasmMemorySource,
} from "./abi";

const UINT32_MAX = 0xffff_ffff;
const graphwarWasmSessionHandleBrand = Symbol("GraphwarWasmSessionHandle");

/** 只有会暂停等待外部 Worker batch 的粗粒度命令拥有 WASM session。 */
export type GraphwarWasmSessionTaskType = "detection" | "one-click-clear";

/** 公开 session 身份。raw core pointer 保持 controller 私有；精确对象身份可防止调用方复制数值字段伪造 session。 */
export interface GraphwarWasmSessionHandle extends GraphwarWasmSessionIdentity {
  /** 拥有此 session 的 backend generation。 */
  readonly backendGeneration: number;
  /** Instance 内单调身份；pointer 复用不会复用此值。 */
  readonly nonce: number;
  /** 所属 Worker 内稳定的 request id。 */
  readonly requestId: number;
  /** Handle 代表的粗粒度 core command。 */
  readonly taskType: GraphwarWasmSessionTaskType;
  /** 私有 runtime brand；调用方无法按结构构造合法 handle。 */
  readonly [graphwarWasmSessionHandleBrand]: true;
}

/** 暂停的 detection session 返回的 template work。 */
export interface GraphwarWasmTemplateShardBatch {
  /** 稳定 shard id，按升序消费顺序保存。 */
  readonly shardIds: readonly number[];
}

/** 暂停的 one-click-clear session 返回的 edge work。 */
export interface GraphwarWasmEdgeBatch {
  /** 稳定 DAG job id，按升序消费顺序保存。 */
  readonly jobIds: readonly number[];
}

/** Template shard result 除稳定 id 外还可携带任意已验证 payload。 */
export interface GraphwarWasmTemplateShardResult {
  /** 暂停 core session 发出的 shard descriptor id。 */
  readonly shardId: number;
}

/** Edge result 除稳定 job id 外还可携带任意已验证 payload。 */
export interface GraphwarWasmEdgeJobResult {
  /** 暂停 core session 发出的 DAG job id。 */
  readonly jobId: number;
}

/** 同步及外部暂停 core command 的完整合法状态空间。 */
export type GraphwarWasmSessionState<TResult = unknown> =
  | {
      handle: GraphwarWasmSessionHandle;
      type: "running";
    }
  | {
      handle: GraphwarWasmSessionHandle;
      type: "waiting-template-shards";
      work: GraphwarWasmTemplateShardBatch;
    }
  | {
      handle: GraphwarWasmSessionHandle;
      type: "waiting-edge-batch";
      work: GraphwarWasmEdgeBatch;
    }
  | {
      result: TResult;
      type: "complete";
    };

/** 在 begin-command 边界同时建立身份与 raw pointer。 */
export interface GraphwarWasmSessionStart {
  /** 当前 backend generation。 */
  backendGeneration: number;
  /** Begin export 返回的私有 raw-arena pointer。 */
  pointer: number;
  /** 稳定 Worker request id。 */
  requestId: number;
  /** 粗粒度 command 类型。 */
  taskType: GraphwarWasmSessionTaskType;
}

interface ActiveGraphwarWasmSessionBase {
  handle: GraphwarWasmSessionHandle;
  pointer: number;
}

/** 内部 ownership 镜像公开状态联合，waiting evidence 不可能存在于 running 半状态。 */
type ActiveGraphwarWasmSession =
  | (ActiveGraphwarWasmSessionBase & { state: "running" })
  | (ActiveGraphwarWasmSessionBase & {
      expectedWorkIds: readonly number[];
      state: "waiting-edge-batch";
    })
  | (ActiveGraphwarWasmSessionBase & {
      expectedWorkIds: readonly number[];
      state: "waiting-template-shards";
    });

/** 外部 batch 恢复 session 时返回的有序结果。 */
export interface GraphwarWasmSessionResume<TResult> {
  /** 按 core 原先发出的稳定 id 重排后的结果。 */
  results: readonly TResult[];
  /** Batch 被接受后，session 返回同步 core 执行。 */
  state: Extract<GraphwarWasmSessionState, { type: "running" }>;
}

/**
 * 为每个 WASM instance 创建一个 session controller。
 *
 * Controller 隐式拥有 raw pointer 与 mark；调用方只获得 branded identity。session 完成或取消会先删除 ownership，随后 arena 地址才可复用。
 */
export function createGraphwarWasmSessionController(memory: GraphwarWasmMemorySource) {
  const activeSessions = new Map<GraphwarWasmSessionHandle, ActiveGraphwarWasmSession>();
  const activePointers = new Set<number>();
  let nextNonce = 1;

  /** 开始 running session，并把全部 provenance 原子绑定到新 nonce。 */
  function beginSession(start: GraphwarWasmSessionStart): Extract<GraphwarWasmSessionState, { type: "running" }> {
    const backendGeneration = validateGraphwarWasmU32(start.backendGeneration, "backendGeneration", "abi");
    const requestId = validateGraphwarWasmU32(start.requestId, "requestId", "abi");
    const pointer = validateGraphwarWasmU32(start.pointer, "sessionPointer", "abi");
    if (pointer === 0) {
      throw new GraphwarWasmAdapterError("invalid-session-pointer", "session pointer must be non-zero");
    }
    try {
      validateGraphwarWasmMemoryRange(memory, { length: 1, pointer }, { alignment: 1, elementByteLength: 1 });
    } catch (error) {
      if (!(error instanceof GraphwarWasmAdapterError)) {
        throw error;
      }
      throw new GraphwarWasmAdapterError(
        "invalid-session-pointer",
        "session pointer must belong to the currently allocated raw arena",
      );
    }
    if (start.taskType !== "detection" && start.taskType !== "one-click-clear") {
      throw new GraphwarWasmAdapterError("invalid-session-identity", "session task type is unsupported");
    }
    if (activePointers.has(pointer)) {
      throw new GraphwarWasmAdapterError(
        "session-pointer-in-use",
        "session pointer already belongs to an active session",
      );
    }
    if (nextNonce > UINT32_MAX) {
      throw new GraphwarWasmAdapterError("session-nonce-overflow", "session nonce exhausted uint32 space");
    }

    const handle = Object.freeze({
      [graphwarWasmSessionHandleBrand]: true as const,
      backendGeneration,
      nonce: nextNonce,
      requestId,
      taskType: start.taskType,
    }) satisfies GraphwarWasmSessionHandle;
    nextNonce += 1;
    activeSessions.set(handle, { handle, pointer, state: "running" });
    activePointers.add(pointer);
    return { handle, type: "running" };
  }

  /** 暂停 detection，直到精确的已发出 template shard 集合可用。 */
  function waitForTemplateShards(
    handle: GraphwarWasmSessionHandle,
    shardIds: readonly number[],
  ): Extract<GraphwarWasmSessionState, { type: "waiting-template-shards" }> {
    const session = requireRunningSession(handle, "detection");
    const expectedWorkIds = normalizeExpectedWorkIds(shardIds, "shardIds");
    activeSessions.set(handle, { ...session, expectedWorkIds, state: "waiting-template-shards" });
    return {
      handle,
      type: "waiting-template-shards",
      work: Object.freeze({ shardIds: expectedWorkIds }),
    };
  }

  /** 接受一个完整 shard 集合，恢复稳定 id 顺序后再继续 core 执行。 */
  function resumeTemplateShards<TResult extends GraphwarWasmTemplateShardResult>(
    handle: GraphwarWasmSessionHandle,
    results: readonly TResult[],
  ): GraphwarWasmSessionResume<TResult> {
    const session = requireWaitingSession(handle, "detection", "waiting-template-shards");
    const orderedResults = validateAndOrderWorkResults(session, results, (result) => result.shardId, "shardId");
    activeSessions.set(handle, { handle, pointer: session.pointer, state: "running" });
    return { results: orderedResults, state: { handle, type: "running" } };
  }

  /** 暂停 one-click-clear，直到精确的已发出 DAG edge job 集合可用。 */
  function waitForEdgeBatch(
    handle: GraphwarWasmSessionHandle,
    jobIds: readonly number[],
  ): Extract<GraphwarWasmSessionState, { type: "waiting-edge-batch" }> {
    const session = requireRunningSession(handle, "one-click-clear");
    const expectedWorkIds = normalizeExpectedWorkIds(jobIds, "jobIds");
    activeSessions.set(handle, { ...session, expectedWorkIds, state: "waiting-edge-batch" });
    return {
      handle,
      type: "waiting-edge-batch",
      work: Object.freeze({ jobIds: expectedWorkIds }),
    };
  }

  /** 接受一个完整 edge batch，恢复稳定 job id 顺序后再继续 core 执行。 */
  function resumeEdgeBatch<TResult extends GraphwarWasmEdgeJobResult>(
    handle: GraphwarWasmSessionHandle,
    results: readonly TResult[],
  ): GraphwarWasmSessionResume<TResult> {
    const session = requireWaitingSession(handle, "one-click-clear", "waiting-edge-batch");
    const orderedResults = validateAndOrderWorkResults(session, results, (result) => result.jobId, "jobId");
    activeSessions.set(handle, { handle, pointer: session.pointer, state: "running" });
    return { results: orderedResults, state: { handle, type: "running" } };
  }

  /** 完成 running command，先撤销 handle，再返回不可变 complete 状态。 */
  function completeSession<TResult>(
    handle: GraphwarWasmSessionHandle,
    result: TResult,
  ): Extract<GraphwarWasmSessionState<TResult>, { type: "complete" }> {
    const session = requireRunningSession(handle, handle.taskType);
    revokeSession(session);
    return { result, type: "complete" };
  }

  /** 取消任意 active 状态，并使 handle 的后续所有使用失效。 */
  function cancelSession(handle: GraphwarWasmSessionHandle): void {
    revokeSession(requireActiveSession(handle));
  }

  /** 只为精确且仍 active 的 handle 解析私有 raw pointer。 */
  function getSessionPointer(handle: GraphwarWasmSessionHandle): number {
    return requireActiveSession(handle).pointer;
  }

  /** 生成 nested shard/job 消息携带的可克隆 provenance，不暴露 branded handle。 */
  function getSessionIdentity(handle: GraphwarWasmSessionHandle): GraphwarWasmSessionIdentity {
    requireActiveSession(handle);
    return {
      backendGeneration: handle.backendGeneration,
      nonce: handle.nonce,
      requestId: handle.requestId,
      taskType: handle.taskType,
    };
  }

  /** 接受每个 nested response 的 shard/job payload 前，验证完整可克隆身份。 */
  function validateSessionIdentity(handle: GraphwarWasmSessionHandle, identity: unknown) {
    requireActiveSession(handle);
    if (
      typeof identity !== "object" ||
      identity === null ||
      !("backendGeneration" in identity) ||
      identity.backendGeneration !== handle.backendGeneration ||
      !("nonce" in identity) ||
      identity.nonce !== handle.nonce ||
      !("requestId" in identity) ||
      identity.requestId !== handle.requestId ||
      !("taskType" in identity) ||
      identity.taskType !== handle.taskType
    ) {
      throw new GraphwarWasmAdapterError("invalid-session-identity", "nested work session identity does not match");
    }
  }

  /** 拒绝伪造、已完成、已取消和 stale handle。 */
  function requireActiveSession(handle: GraphwarWasmSessionHandle) {
    const session = activeSessions.get(handle);
    if (!session || session.handle !== handle) {
      throw new GraphwarWasmAdapterError("invalid-session-handle", "session handle is not active in this instance");
    }
    return session;
  }

  /** 执行下一个同步 core command 前要求精确 task 身份与 running 状态。 */
  function requireRunningSession(handle: GraphwarWasmSessionHandle, taskType: GraphwarWasmSessionTaskType) {
    const session = requireActiveSession(handle);
    if (handle.taskType !== taskType || session.state !== "running") {
      throw new GraphwarWasmAdapterError("invalid-session-state", "session cannot perform this running transition");
    }
    return session;
  }

  /** 接受外部 work 前要求精确 paused 状态与 task 类型。 */
  function requireWaitingSession<TState extends "waiting-edge-batch" | "waiting-template-shards">(
    handle: GraphwarWasmSessionHandle,
    taskType: GraphwarWasmSessionTaskType,
    state: TState,
  ): Extract<ActiveGraphwarWasmSession, { state: TState }> {
    const session = requireActiveSession(handle);
    if (handle.taskType !== taskType || session.state !== state) {
      throw new GraphwarWasmAdapterError("invalid-session-state", "session is not waiting for this work batch");
    }
    // 上方判别字段相等已证明精确 waiting 分支；TypeScript 无法关联泛型 literal。
    return session as Extract<ActiveGraphwarWasmSession, { state: TState }>;
  }

  /** 撤销 session 的 pointer ownership 与全部合法迁移。 */
  function revokeSession(session: ActiveGraphwarWasmSession) {
    activeSessions.delete(session.handle);
    activePointers.delete(session.pointer);
  }

  return {
    beginSession,
    cancelSession,
    completeSession,
    getSessionIdentity,
    getSessionPointer,
    resumeEdgeBatch,
    resumeTemplateShards,
    validateSessionIdentity,
    waitForEdgeBatch,
    waitForTemplateShards,
  };
}

/** 验证并规范化一个 paused work descriptor 发出的稳定 id。 */
function normalizeExpectedWorkIds(ids: readonly number[], fieldName: string): readonly number[] {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new GraphwarWasmAdapterError("invalid-work-batch", `${fieldName} must contain at least one id`);
  }
  const seenIds = new Set<number>();
  const normalized = ids.map((id) => {
    const validatedId = validateGraphwarWasmU32(id, fieldName, "abi");
    if (seenIds.has(validatedId)) {
      throw new GraphwarWasmAdapterError("duplicate-work-id", `${fieldName} contains duplicate id ${validatedId}`);
    }
    seenIds.add(validatedId);
    return validatedId;
  });
  normalized.sort((left, right) => left - right);
  return Object.freeze(normalized);
}

/** 验证完整 result 集合，并按 core 的稳定 id 顺序返回。 */
function validateAndOrderWorkResults<TResult>(
  session: Extract<ActiveGraphwarWasmSession, { state: "waiting-edge-batch" | "waiting-template-shards" }>,
  results: readonly TResult[],
  getId: (result: TResult) => unknown,
  fieldName: string,
): readonly TResult[] {
  if (!Array.isArray(results)) {
    throw new GraphwarWasmAdapterError("invalid-work-batch", "session results must be an array");
  }
  const expectedWorkIds = session.expectedWorkIds;
  const expectedIdSet = new Set(expectedWorkIds);
  const resultsById = new Map<number, TResult>();
  for (const result of results) {
    const id = validateGraphwarWasmU32(getId(result), fieldName, "abi");
    if (resultsById.has(id)) {
      throw new GraphwarWasmAdapterError("duplicate-work-id", `session results contain duplicate id ${id}`);
    }
    if (!expectedIdSet.has(id)) {
      throw new GraphwarWasmAdapterError("unexpected-work-id", `session results contain unexpected id ${id}`);
    }
    resultsById.set(id, result);
  }
  const orderedResults: TResult[] = [];
  for (const id of expectedWorkIds) {
    const result = resultsById.get(id);
    if (result === undefined) {
      throw new GraphwarWasmAdapterError("missing-work-id", `session results are missing id ${id}`);
    }
    orderedResults.push(result);
  }
  return orderedResults;
}
