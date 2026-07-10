import { nowMs } from "../../core/time";
import type { GraphwarDetectionWorkerStage, GraphwarDetectionWorkerTimingEntry } from "./protocol";

/** 统一测量同步检测阶段，让主线程 fallback 与 Worker 产出相同 timing 结构。 */
export function measureDetectionStage<TResult>(
  timings: GraphwarDetectionWorkerTimingEntry[],
  stage: GraphwarDetectionWorkerStage,
  task: () => TResult,
) {
  const startedAt = nowMs();
  try {
    return task();
  } finally {
    timings.push({
      elapsedMs: nowMs() - startedAt,
      stage,
    });
  }
}
