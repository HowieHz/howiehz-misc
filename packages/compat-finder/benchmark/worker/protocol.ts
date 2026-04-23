import { type CompatibilityTestAlgorithm } from "../../src/compatibility-test/index.ts";
import { type BenchmarkChart, type ExactTargetCountStats } from "../types.ts";

export type BenchmarkWorkerTask = ComputeTargetCountStatsWorkerTask | RenderChartWorkerTask;

export interface ComputeTargetCountStatsWorkerTask {
  type: "compute-target-count-stats";
  algorithm: CompatibilityTestAlgorithm;
  targetCount: number;
}

export interface RenderChartWorkerTask {
  type: "render-chart";
  chart: BenchmarkChart;
}

export type BenchmarkWorkerResult = ComputeTargetCountStatsWorkerResult | RenderChartWorkerResult;

export interface ComputeTargetCountStatsWorkerResult {
  type: "compute-target-count-stats";
  algorithm: CompatibilityTestAlgorithm;
  stats: ExactTargetCountStats;
  targetCount: number;
}

export interface RenderChartWorkerResult {
  type: "render-chart";
  chartId: string;
  svg: string;
}
