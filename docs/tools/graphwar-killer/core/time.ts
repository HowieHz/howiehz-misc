/**
 * 返回统一的毫秒计时值，供页面、Worker 和测试环境复用同一套 elapsedMs 语义。
 *
 * 浏览器优先使用 performance.now()，避免系统时钟调整影响耗时统计；缺少 performance 的 SSR/测试环境回退 Date。
 */
export function nowMs() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
