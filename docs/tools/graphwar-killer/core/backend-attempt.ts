import { graphwarBackendAttemptIdentitiesAreEqual } from "./algorithm-backend";
import type { GraphwarBackendAttemptIdentity } from "./algorithm-backend";

/**
 * 为稳定 outer task 与可替换 backend attempt 创建 runner 本地权限 gate。
 *
 * Gate 独占身份分配与 generation 撤销。每次 event、cache 写入、结果应用和公开结算前，调用方都必须立即通过 `canCommit`；仅收到 Worker result 并不代表它仍有提交权限。
 */
export function createGraphwarBackendAttemptGate() {
  const activeTasks = new Map<number, GraphwarBackendAttemptIdentity>();
  const revokedGenerations = new Set<number>();
  let nextAttemptId = 1;
  let nextOuterTaskId = 1;

  /** 以第一个 backend attempt 开始新的公开操作。 */
  function beginOuterTask(backendGeneration: number): GraphwarBackendAttemptIdentity {
    assertUsableGeneration(backendGeneration);
    const identity = createIdentity(backendGeneration, nextOuterTaskId);
    nextOuterTaskId = incrementIdentity(nextOuterTaskId, "outer task id");
    activeTasks.set(identity.outerTaskId, identity);
    return identity;
  }

  /** 只替换 backend attempt，同时保留公开 outer task id。 */
  function replaceAttempt(
    currentIdentity: GraphwarBackendAttemptIdentity,
    backendGeneration: number,
  ): GraphwarBackendAttemptIdentity {
    assertUsableGeneration(backendGeneration);
    const current = requireCurrentAttempt(currentIdentity);
    const replacement = createIdentity(backendGeneration, current.outerTaskId);
    activeTasks.set(replacement.outerTaskId, replacement);
    return replacement;
  }

  /** 同一 generation 首个 fault 赢得 fuse compare-and-set；并发或迟到 fault 返回 false。 */
  function revokeGeneration(backendGeneration: number) {
    assertGeneration(backendGeneration);
    if (revokedGenerations.has(backendGeneration)) {
      return false;
    }
    revokedGenerations.add(backendGeneration);
    return true;
  }

  /** 检查完整 attempt 身份，并确认其 generation 仍有 commit 权限。 */
  function canCommit(identity: GraphwarBackendAttemptIdentity) {
    const current = activeTasks.get(identity.outerTaskId);
    return (
      current !== undefined &&
      graphwarBackendAttemptIdentitiesAreEqual(current, identity) &&
      !revokedGenerations.has(identity.backendGeneration)
    );
  }

  /** 精确提交一次终态结果。 */
  function completeOuterTask(identity: GraphwarBackendAttemptIdentity) {
    requireCurrentAttempt(identity);
    if (revokedGenerations.has(identity.backendGeneration)) {
      throw new Error("Revoked Graphwar backend attempt cannot complete its outer task");
    }
    activeTasks.delete(identity.outerTaskId);
  }

  /** 用户取消或输入替换会撤销 outer task 的全部 attempt，且不安装 replay。 */
  function cancelOuterTask(identity: GraphwarBackendAttemptIdentity) {
    requireCurrentAttempt(identity);
    activeTasks.delete(identity.outerTaskId);
  }

  /** 创建完整身份并推进 runner 全局 attempt 计数器。 */
  function createIdentity(backendGeneration: number, outerTaskId: number): GraphwarBackendAttemptIdentity {
    const identity = { attemptId: nextAttemptId, backendGeneration, outerTaskId };
    nextAttemptId = incrementIdentity(nextAttemptId, "attempt id");
    return identity;
  }

  /** 在任何替换或终态迁移前拒绝 stale attempt。 */
  function requireCurrentAttempt(identity: GraphwarBackendAttemptIdentity) {
    const current = activeTasks.get(identity.outerTaskId);
    if (!current || !graphwarBackendAttemptIdentitiesAreEqual(current, identity)) {
      throw new Error("Graphwar backend attempt is no longer authoritative");
    }
    return current;
  }

  /** 新任务不能绑定到已被 fuse 撤销的 generation。 */
  function assertUsableGeneration(backendGeneration: number) {
    assertGeneration(backendGeneration);
    if (revokedGenerations.has(backendGeneration)) {
      throw new Error("Graphwar backend generation has been revoked");
    }
  }

  return {
    beginOuterTask,
    canCommit,
    cancelOuterTask,
    completeOuterTask,
    replaceAttempt,
    revokeGeneration,
  };
}

function assertGeneration(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Graphwar backend generation must be a non-negative safe integer");
  }
}

function incrementIdentity(value: number, fieldName: string) {
  if (value >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`Graphwar ${fieldName} exhausted safe integer space`);
  }
  return value + 1;
}
