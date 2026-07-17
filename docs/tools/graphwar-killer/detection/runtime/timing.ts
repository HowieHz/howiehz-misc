import { measureSyncStage } from "../../core/time";
import type { GraphwarDetectionWorkerStage, GraphwarDetectionWorkerTimingEntry } from "./protocol";

/** 统一测量同步检测阶段，让主线程 fallback 与 Worker 产出相同 timing 结构。 */
export function measureDetectionStage<TResult>(
  timings: GraphwarDetectionWorkerTimingEntry[],
  stage: GraphwarDetectionWorkerStage,
  task: () => TResult,
) {
  return measureSyncStage(timings, stage, task);
}
