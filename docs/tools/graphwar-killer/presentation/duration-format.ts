import { formatDecimal } from "../core/numbers";

/** 将毫秒耗时格式化成检测、寻路和状态栏使用的短文本。 */
export function formatElapsedDuration(elapsedMs: number) {
  if (elapsedMs <= 0) {
    return "0 ms";
  }
  if (elapsedMs < 1000) {
    return `${Math.max(1, Math.round(elapsedMs))} ms`;
  }
  return `${formatDecimal(elapsedMs / 1000, elapsedMs < 10000 ? 2 : 1)} s`;
}
