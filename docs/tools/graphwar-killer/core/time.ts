/**
 * 返回统一的毫秒计时值，供页面、Worker 和测试环境复用同一套 elapsedMs 语义。
 *
 * 浏览器优先使用 performance.now()，避免系统时钟调整影响耗时统计；缺少 performance 的 SSR/测试环境回退 Date。
 */
export function nowMs() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

/** 执行同步阶段并在成功或抛错后统一追加耗时，避免各工作流重复维护 finally 计时。 */
export function measureSyncStage<TResult, TStage>(
  timings: { elapsedMs: number; stage: TStage }[],
  stage: TStage,
  task: () => TResult,
) {
  const startedAt = nowMs();
  try {
    return task();
  } finally {
    timings.push({ elapsedMs: nowMs() - startedAt, stage });
  }
}
